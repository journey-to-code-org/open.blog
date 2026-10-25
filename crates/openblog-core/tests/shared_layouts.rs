//! Sequential and side-by-side presentation of one approved reflection (ADR 0032): the arranged
//! Post, the arranged preview, the approval binding of the arrangement, and the part marker.

use openblog_core::approval::ApprovalSet;
use openblog_core::assembly::{assemble, assemble_for, with_subject_for, AssemblyError};
use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind,
};
use openblog_core::config::SiteConfig;
use openblog_core::contributor::Contributor;
use openblog_core::draft::DraftSet;
use openblog_core::preview::build_for;
use openblog_core::reflection::{ReflectionLayout, ReflectionStructure, LAYOUT_CSS, PART_MARKER};
use openblog_core::SourceFile;

const T: i64 = 1_800_000_000;
const DATE: &str = "2030-01-31T09:00:00Z";
const ALL: [&str; 3] = ["ann", "bo", "cy"];

fn record() -> SharedPublication {
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: "shared-0a1b2c3d4e5f".into(),
        title: "On \"attention\": a <b>duet</b>".into(),
        guiding_question: "What did you notice?".into(),
        sources: vec![NewSourceReference {
            kind: SourceKind::Video,
            title: "The Art of Noticing".into(),
            url: "https://www.youtube.com/watch?v=abc123".into(),
            ..NewSourceReference::default()
        }],
        creator: NewParticipant {
            admin_user: "ann-admin".into(),
            contributor_id: "ann".into(),
            display_name: "Ann".into(),
        },
    })
    .unwrap();
    record.collaboration.participants[0].id = "ann".into();
    record.authorization.bindings[0].participant_id = "ann".into();
    for (id, name) in [("bo", "Bo"), ("cy", "Cy")] {
        record.collaboration.participants.push(Participant {
            id: id.into(),
            display_name: name.into(),
            profile_url: None,
        });
        record.authorization.bindings.push(IdentityBinding {
            admin_user: format!("{id}-admin"),
            contributor_id: id.into(),
            participant_id: id.into(),
            roles: vec![AuthorizationRole::Contributor],
        });
    }
    record
}

fn drafts(texts: &[(&str, &str)]) -> DraftSet {
    let mut set = DraftSet::new(&ALL).unwrap();
    for (who, text) in texts {
        set.save(who, who, 0, text, T).unwrap();
    }
    set
}

fn structure(json: &str) -> ReflectionStructure {
    ReflectionStructure::from_json(json).unwrap()
}

/// Ann and Bo answer twice each, interleaved: a1 b1 a2 b2.
fn interleaved(layout: &str, revision: u64) -> ReflectionStructure {
    structure(&format!(
        r#"{{"version":1,"revision":{revision},"layout":"{layout}","rounds":[
            {{"id":"r1","roundPrompt":"What stood out? <b>x</b>","turns":[{{"draft":"ann","part":0}},{{"draft":"bo","part":0}}]}},
            {{"id":"r2","turns":[{{"draft":"ann","part":1}},{{"draft":"bo","part":1}}]}}]}}"#
    ))
}

fn two_part(first: &str, second: &str) -> String {
    format!("{first}\n{PART_MARKER}\n{second}")
}

fn world() -> DraftSet {
    drafts(&[
        ("ann", &two_part("ANN-ONE", "ANN-TWO")),
        ("bo", &two_part("BO-ONE", "BO-TWO")),
    ])
}

fn approve_all(
    record: &SharedPublication,
    s: Option<&ReflectionStructure>,
    set: &DraftSet,
) -> ApprovalSet {
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        let seen = with_subject_for(record, s, set, &ALL, |subject| {
            approvals.binding_for(subject, who).unwrap()
        });
        with_subject_for(record, s, set, &ALL, |subject| {
            approvals.approve(who, who, subject, &seen, true, T)
        })
        .unwrap();
    }
    approvals
}

fn index(haystack: &str, needle: &str) -> usize {
    haystack
        .find(needle)
        .unwrap_or_else(|| panic!("missing {needle}"))
}

fn in_order(haystack: &str, needles: &[&str]) -> bool {
    let at: Vec<usize> = needles.iter().map(|n| index(haystack, n)).collect();
    at.windows(2).all(|pair| pair[0] < pair[1])
}

const READING: [&str; 4] = ["ANN-ONE", "BO-ONE", "ANN-TWO", "BO-TWO"];

#[test]
fn a_piece_without_a_structure_keeps_participant_order_and_never_shows_the_marker() {
    let record = record();
    let set = world();
    let approvals = approve_all(&record, None, &set);
    let made = assemble(&record, &set, &approvals, &ALL, DATE).unwrap();
    assert!(!made.source.contains("openblog:part"), "{}", made.source);
    assert!(!made.source.contains("ob-reflection"));
    assert!(index(&made.source, "ANN-TWO") < index(&made.source, "BO-ONE"));
    // The parts of a draft stay separate paragraphs.
    assert!(made.source.contains("ANN-ONE\n\nANN-TWO"));
}

#[test]
fn the_arranged_post_follows_the_reading_order_and_credits_each_author_once() {
    let record = record();
    let set = world();
    let s = interleaved("sequential", 1);
    let approvals = approve_all(&record, Some(&s), &set);
    let made = assemble_for(&record, Some(&s), &set, &approvals, &ALL, DATE).unwrap();
    assert!(in_order(&made.source, &READING), "{}", made.source);
    assert!(!made.source.contains("openblog:part"));
    assert_eq!(made.credits.matches("\"contributor\"").count(), 2);
    assert!(index(&made.credits, "ann") < index(&made.credits, "bo"));
    // Every turn has its own heading, so attribution never depends on position.
    assert_eq!(
        made.source.matches("<h2 class=\"ob-turn-author\">").count(),
        4
    );
    // The round prompt is escaped text, once, before the answers.
    assert!(made.source.contains("What stood out? &lt;b&gt;x&lt;/b&gt;"));
    assert!(!made.source.contains("<b>x</b>"));
    assert!(index(&made.source, "What stood out") < index(&made.source, "ANN-ONE"));
    assert!(made.source.contains("ob-reflection-sequential ob-lanes-1"));
}

#[test]
fn side_by_side_is_the_same_dom_order_with_lane_classes_only() {
    let record = record();
    let set = world();
    let side = interleaved("sequential", 1).with_layout(ReflectionLayout::SideBySide);
    let approvals = approve_all(&record, Some(&side), &set);
    let made = assemble_for(&record, Some(&side), &set, &approvals, &ALL, DATE).unwrap();
    assert!(made
        .source
        .contains("ob-reflection-side-by-side ob-lanes-2"));
    assert!(made.source.contains("ob-lane-0") && made.source.contains("ob-lane-1"));
    assert!(in_order(&made.source, &READING));
    // No inline style, script or position is written: CSS alone places the lanes.
    for forbidden in ["style=", "<script", "data-"] {
        assert!(!made.source.contains(forbidden), "{forbidden}");
    }
}

#[test]
fn unequal_numbers_of_parts_arrange_without_blank_gaps() {
    let record = record();
    let set = drafts(&[("ann", &two_part("ANN-ONE", "ANN-TWO")), ("bo", "BO-ONLY")]);
    let s = structure(
        r#"{"version":1,"revision":1,"layout":"sideBySide","rounds":[{"id":"r1","turns":[
            {"draft":"ann","part":0},{"draft":"bo","part":0},{"draft":"ann","part":1}]}]}"#,
    );
    let approvals = approve_all(&record, Some(&s), &set);
    let made = assemble_for(&record, Some(&s), &set, &approvals, &ALL, DATE).unwrap();
    assert_eq!(made.source.matches("<section class=\"ob-turn").count(), 3);
    assert!(index(&made.source, "BO-ONLY") < index(&made.source, "ANN-TWO"));
}

#[test]
fn changing_the_layout_or_the_arrangement_makes_standing_approvals_stale_at_the_gate() {
    let record = record();
    let set = world();
    let s = interleaved("sequential", 1);
    let approvals = approve_all(&record, Some(&s), &set);
    assert!(assemble_for(&record, Some(&s), &set, &approvals, &ALL, DATE).is_ok());
    let blocked = |changed: Option<&ReflectionStructure>| {
        matches!(
            assemble_for(&record, changed, &set, &approvals, &ALL, DATE),
            Err(AssemblyError::Blocked { missing }) if missing == ["Ann", "Bo", "Cy"]
        )
    };
    // The layout alone.
    assert!(blocked(Some(&s.with_layout(ReflectionLayout::SideBySide))));
    // The turn order alone.
    let mut reordered = s.clone();
    reordered.rounds[0].turns.reverse();
    assert!(blocked(Some(&reordered)));
    // A round prompt alone.
    let mut prompted = s.clone();
    prompted.rounds[1].round_prompt = Some("New".into());
    assert!(blocked(Some(&prompted)));
    // Removing the structure is also a change to what readers see.
    assert!(blocked(None));
    // Saving an identical arrangement under a newer revision changes nothing a reader sees.
    let mut resaved = s.clone();
    resaved.revision = 2;
    assert!(assemble_for(&record, Some(&resaved), &set, &approvals, &ALL, DATE).is_ok());
    // Approvals given before any structure existed do not survive the first one either.
    let plain = approve_all(&record, None, &set);
    assert!(assemble(&record, &set, &plain, &ALL, DATE).is_ok());
    assert!(assemble_for(&record, Some(&s), &set, &plain, &ALL, DATE).is_err());
}

#[test]
fn a_stale_or_unsupported_arrangement_publishes_nothing() {
    let record = record();
    let set = world();
    let missing_part = structure(
        r#"{"version":1,"revision":1,"layout":"sequential","rounds":[{"id":"r1","turns":[{"draft":"ann","part":5}]}]}"#,
    );
    let approvals = approve_all(&record, Some(&missing_part), &set);
    assert_eq!(
        assemble_for(&record, Some(&missing_part), &set, &approvals, &ALL, DATE),
        Err(AssemblyError::Invalid)
    );
    let dialogue = interleaved("alternatingDialogue", 1);
    let approvals = approve_all(&record, Some(&dialogue), &set);
    assert_eq!(
        assemble_for(&record, Some(&dialogue), &set, &approvals, &ALL, DATE),
        Err(AssemblyError::Invalid)
    );
}

#[test]
fn hostile_names_and_markup_cannot_break_out_of_the_arrangement() {
    let mut record = record();
    record.collaboration.participants[0].display_name = "<script>alert(1)</script> Ann".into();
    let s = structure(
        r#"{"version":1,"revision":1,"layout":"sideBySide","rounds":[{"id":"r1","turns":[{"draft":"ann","part":0},{"draft":"bo","part":0}]}]}"#,
    );
    let set = drafts(&[("ann", "Ann words"), ("bo", "Bo <script>x</script>")]);
    let approvals = approve_all(&record, Some(&s), &set);
    assert_eq!(
        assemble_for(&record, Some(&s), &set, &approvals, &ALL, DATE),
        Err(AssemblyError::UnsafeMarkup)
    );
    let set = drafts(&[("ann", "Ann words"), ("bo", "Bo words")]);
    let approvals = approve_all(&record, Some(&s), &set);
    let made = assemble_for(&record, Some(&s), &set, &approvals, &ALL, DATE).unwrap();
    assert!(!made.source.contains("<script>"));
    assert!(made
        .source
        .contains("&lt;script&gt;alert(1)&lt;/script&gt; Ann"));
}

#[test]
fn the_arranged_post_loads_through_the_production_pipeline_in_reading_order() {
    let record = record();
    let set = world();
    let s = interleaved("sideBySide", 1);
    let approvals = approve_all(&record, Some(&s), &set);
    let made = assemble_for(&record, Some(&s), &set, &approvals, &ALL, DATE).unwrap();
    let mut config = SiteConfig::default();
    for (id, name) in [("ann", "Ann"), ("bo", "Bo"), ("cy", "Cy")] {
        config.contributors.insert(
            id.into(),
            Contributor {
                name: name.into(),
                ..Contributor::default()
            },
        );
    }
    let post = openblog_core::model::load_post_with_credits(
        &SourceFile {
            path: made.path.clone(),
            contents: made.source.clone(),
        },
        &config,
        config.render_options(),
        Some(&SourceFile {
            path: made.credits_path.clone(),
            contents: made.credits.clone(),
        }),
    )
    .unwrap();
    let html = &post.html;
    assert!(
        html.contains("class=\"ob-reflection ob-reflection-side-by-side ob-lanes-2\""),
        "{html}"
    );
    assert!(in_order(html, &READING), "{html}");
    assert!(
        !html.contains("openblog:part") && !html.contains("<!--"),
        "{html}"
    );
    assert_eq!(
        html.matches("<section class=\"ob-turn").count(),
        4,
        "{html}"
    );
    assert_eq!(html.matches("</section>").count(), 4, "{html}");
}

#[test]
fn the_preview_arranges_what_the_requester_may_read_and_shows_one_placeholder_for_the_rest() {
    let record = record();
    let set = world();
    let s = interleaved("sideBySide", 1);
    let approvals = ApprovalSet::new();
    let config = SiteConfig::default();
    let options = config.render_options();
    let shown = build_for(&record, Some(&s), &set, &approvals, "ann", &ALL, options).unwrap();
    // Bo's draft is private to Bo: nothing of it reaches Ann's preview, and neither does the marker.
    assert!(!shown.document.contains("BO-ONE") && !shown.document.contains("BO-TWO"));
    assert!(!shown.document.contains("openblog:part"));
    assert!(shown.document.contains("ANN-ONE") && shown.document.contains("ANN-TWO"));
    assert!(shown.document.contains("ob-reflection-side-by-side"));
    assert!(!shown.complete && shown.seen.is_none());
    assert!(
        shown
            .document
            .matches("Not shared with you at its current revision")
            .count()
            >= 2
    );
    // The same piece for Bo reads Bo's turns and hides Ann's.
    let theirs = build_for(&record, Some(&s), &set, &approvals, "bo", &ALL, options).unwrap();
    assert!(theirs.document.contains("BO-ONE") && !theirs.document.contains("ANN-ONE"));
    assert!(
        shown.document.contains("grid-column"),
        "the preview carries the layout rules"
    );
}

#[test]
fn a_complete_arranged_preview_hands_out_the_binding_the_gate_checks() {
    let record = record();
    let mut set = world();
    set.set_policy(openblog_core::draft::RevealPolicy::Voluntary);
    set.mark_ready("ann", 1, &ALL).unwrap();
    set.mark_ready("bo", 1, &ALL).unwrap();
    let s = interleaved("sequential", 1);
    let approvals = ApprovalSet::new();
    let config = SiteConfig::default();
    let options = config.render_options();
    let shown = build_for(&record, Some(&s), &set, &approvals, "ann", &ALL, options).unwrap();
    assert!(shown.complete);
    let gate = with_subject_for(&record, Some(&s), &set, &ALL, |subject| {
        approvals.binding_for(subject, "ann").unwrap()
    });
    assert_eq!(shown.seen.as_deref(), Some(gate.as_str()));
    assert!(in_order(&shown.document, &READING));
    // A preview of another arrangement hands out a different binding.
    let other = build_for(
        &record,
        Some(&s.with_layout(ReflectionLayout::SideBySide)),
        &set,
        &approvals,
        "ann",
        &ALL,
        options,
    )
    .unwrap();
    assert_ne!(other.seen, shown.seen);
    // An arrangement that cannot be read against the drafts is never complete or approvable.
    let broken = structure(
        r#"{"version":1,"revision":1,"layout":"sequential","rounds":[{"id":"r1","turns":[{"draft":"ann","part":9}]}]}"#,
    );
    let refused = build_for(
        &record,
        Some(&broken),
        &set,
        &approvals,
        "ann",
        &ALL,
        options,
    )
    .unwrap();
    assert!(!refused.complete && refused.seen.is_none());
    assert!(!refused.document.contains("ANN-ONE"));
}

#[test]
fn the_preview_without_a_structure_strips_the_marker_too() {
    let record = record();
    let set = world();
    let config = SiteConfig::default();
    let options = config.render_options();
    let shown = build_for(
        &record,
        None,
        &set,
        &ApprovalSet::new(),
        "ann",
        &ALL,
        options,
    )
    .unwrap();
    assert!(!shown.document.contains("openblog:part") && !shown.document.contains("<!--"));
    assert!(shown.document.contains("ANN-ONE") && shown.document.contains("ANN-TWO"));
}

#[test]
fn the_public_stylesheet_carries_exactly_the_layout_rules_the_preview_uses() {
    let base = include_str!("../../../web/base.css");
    assert!(base.contains(LAYOUT_CSS.trim()));
    // Placement is gated to wide screens and never to print, and the narrow default is a flow.
    assert!(LAYOUT_CSS.contains("@media screen and (min-width: 48em)"));
    assert!(!LAYOUT_CSS.contains("order:"));
    assert!(!LAYOUT_CSS.contains("float"));
}

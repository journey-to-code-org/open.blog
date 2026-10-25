//! The publish gate's pure half: a piece is assembled only from exact approvals, the Post it makes
//! loads through the production pipeline with its credits, and nothing private reaches it.

use openblog_core::approval::{ApprovalSet, Readiness};
use openblog_core::assembly::{
    assemble, post_path, with_subject, AssemblyError, Outcome, MAX_OUTCOME_BYTES,
};
use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind,
};
use openblog_core::config::SiteConfig;
use openblog_core::contributor::Contributor;
use openblog_core::draft::DraftSet;
use openblog_core::preview::build as preview;
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

/// Approve for `who` the exact piece `set` holds, through the binding the gate itself computes.
fn approve(record: &SharedPublication, set: &DraftSet, approvals: &mut ApprovalSet, who: &str) {
    let seen = with_subject(record, set, &ALL, |subject| {
        approvals.binding_for(subject, who).unwrap()
    });
    with_subject(record, set, &ALL, |subject| {
        approvals.approve(who, who, subject, &seen, true, T)
    })
    .unwrap();
}

#[test]
fn the_gate_binding_equals_the_one_the_preview_hands_out() {
    let record = record();
    let set = drafts(&[("ann", "Ann words"), ("bo", "Bo words")]);
    let approvals = ApprovalSet::new();
    let mut voluntary = set.clone();
    voluntary.set_policy(openblog_core::draft::RevealPolicy::Voluntary);
    voluntary.mark_ready("ann", 1, &ALL).unwrap();
    voluntary.mark_ready("bo", 1, &ALL).unwrap();
    let shown = preview(
        &record,
        &voluntary,
        &approvals,
        "ann",
        &ALL,
        SiteConfig::default().render_options(),
    )
    .unwrap();
    let gate = with_subject(&record, &voluntary, &ALL, |subject| {
        approvals.binding_for(subject, "ann").unwrap()
    });
    assert_eq!(shown.seen.as_deref(), Some(gate.as_str()));
}

#[test]
fn nothing_is_assembled_until_every_required_author_approved_the_current_piece() {
    let record = record();
    let set = drafts(&[("ann", "Ann words"), ("bo", "Bo words")]);
    let mut approvals = ApprovalSet::new();
    let refused = |approvals: &ApprovalSet| assemble(&record, &set, approvals, &ALL, DATE);
    // Only names come back, never prose.
    assert_eq!(
        refused(&approvals),
        Err(AssemblyError::Blocked {
            missing: vec!["Ann".into(), "Bo".into(), "Cy".into()]
        })
    );
    approve(&record, &set, &mut approvals, "ann");
    approve(&record, &set, &mut approvals, "bo");
    // Cy has written nothing but under the default policy every author must still approve.
    assert!(matches!(
        refused(&approvals),
        Err(AssemblyError::Blocked { missing }) if missing == ["Cy"]
    ));
    approve(&record, &set, &mut approvals, "cy");
    let made = refused(&approvals).unwrap();
    assert_eq!(made.path, post_path(&record));
    assert!(made.source.contains("Ann words") && made.source.contains("Bo words"));
    assert!(made.source.find("Ann words") < made.source.find("Bo words"));
}

#[test]
fn a_changed_piece_blocks_only_the_authors_whose_approval_it_invalidates() {
    let record = record();
    let mut set = drafts(&[("ann", "Ann words"), ("bo", "Bo words")]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&record, &set, &mut approvals, who);
    }
    assert!(assemble(&record, &set, &approvals, &ALL, DATE).is_ok());
    set.save("ann", "ann", 1, "Ann changed her mind", T + 1)
        .unwrap();
    assert!(matches!(
        assemble(&record, &set, &approvals, &ALL, DATE),
        Err(AssemblyError::Blocked { missing }) if missing == ["Ann", "Cy"]
    ));
    // Removing an author changes the author set, which every approval is bound to.
    let two = ["ann", "bo"];
    let mut again = ApprovalSet::new();
    for who in ALL {
        approve(&record, &set, &mut again, who);
    }
    assert!(assemble(&record, &set, &again, &ALL, DATE).is_ok());
    assert!(assemble(&record, &set, &again, &two, DATE).is_err());
}

#[test]
fn a_withdrawn_draft_is_never_published_even_with_old_approvals() {
    let record = record();
    let mut set = drafts(&[("ann", "Ann words"), ("bo", "Bo SECRET words")]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&record, &set, &mut approvals, who);
    }
    set.withdraw("bo", "bo").unwrap();
    match assemble(&record, &set, &approvals, &ALL, DATE) {
        Ok(made) => assert!(!made.source.contains("SECRET")),
        Err(error) => assert!(!format!("{error:?}").contains("SECRET")),
    }
}

#[test]
fn the_post_loads_through_the_production_pipeline_with_ordered_credits_and_attribution() {
    let record = record();
    let set = drafts(&[
        ("ann", "Ann words"),
        (
            "cy",
            "Cy [fine](https://example.org/a) and [local](/about/#x) words",
        ),
    ]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&record, &set, &mut approvals, who);
    }
    let made = assemble(&record, &set, &approvals, &ALL, DATE).unwrap();
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
    assert!(!post.draft);
    assert_eq!(post.title, "On \"attention\": a <b>duet</b>");
    // Credit follows written sections only (Bo wrote nothing), in section order.
    let authors: Vec<&str> = post.authors().map(|c| c.contributor_id.as_str()).collect();
    assert_eq!(authors, ["ann", "cy"]);
    let attribution = post
        .shared_attribution
        .as_ref()
        .expect("approved attribution");
    assert_eq!(
        attribution.question.as_deref(),
        Some("What did you notice?")
    );
    assert!(!post.html.contains("javascript:"), "{}", post.html);
    // Nothing private rides along.
    for private in [
        "ann-admin",
        "bo-admin",
        "token",
        "invitation",
        "approv",
        "revision",
    ] {
        assert!(
            !made.source.to_ascii_lowercase().contains(private)
                && !made.credits.to_ascii_lowercase().contains(private),
            "{private}"
        );
    }
}

#[test]
fn a_piece_without_a_title_or_a_section_is_invalid_not_blocked() {
    let mut untitled = record();
    untitled.title = Some("   ".into());
    let set = drafts(&[("ann", "Ann words")]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&untitled, &set, &mut approvals, who);
    }
    assert_eq!(
        assemble(&untitled, &set, &approvals, &ALL, DATE),
        Err(AssemblyError::Invalid)
    );
    let empty = drafts(&[]);
    assert_eq!(
        assemble(&record(), &empty, &ApprovalSet::new(), &ALL, DATE),
        Err(AssemblyError::Invalid)
    );
    assert_eq!(
        with_subject(&record(), &empty, &ALL, |s| ApprovalSet::new().evaluate(s)),
        Err(openblog_core::approval::ApprovalError::Invalid)
    );
    let _ = Readiness::Ready;
}

#[test]
fn outcomes_round_trip_and_reject_anything_else() {
    for outcome in [Outcome::scheduled(T, "ann-admin"), Outcome::published(T)] {
        assert_eq!(Outcome::from_json(&outcome.to_json()), Some(outcome));
    }
    for bad in [
        r#"{"state":"published","version":1,"publishedAt":-1}"#,
        r#"{"state":"published","version":2,"publishedAt":1}"#,
        r#"{"state":"published","version":1,"publishedAt":1,"note":"x"}"#,
        r#"{"state":"scheduled","version":1,"publishAt":1,"requestedBy":"Not Valid!"}"#,
        r#"{"state":"unknown","version":1}"#,
        "not json",
    ] {
        assert_eq!(Outcome::from_json(bad), None, "{bad}");
    }
    assert_eq!(Outcome::from_json(&" ".repeat(MAX_OUTCOME_BYTES + 1)), None);
}

#[test]
fn unsafe_markup_in_any_section_refuses_the_whole_piece_even_when_approved() {
    let record = record();
    for hostile in [
        "Bo <script>alert(1)</script> words",
        "<div onclick=\"x()\">Bo</div>",
        "Bo <img src=x onerror=alert(1)> words",
        "Bo [odd](javascript:alert(1)) words",
        "Bo [odd](java&#115;cript:alert(1)) words",
        "Bo [odd](JaVaScRiPt:alert(1)) words",
        "Bo ![odd](data:text/html;base64,AAAA) words",
        "[odd]

[odd]: vbscript:x",
    ] {
        let set = drafts(&[("ann", "Ann words"), ("bo", hostile)]);
        let mut approvals = ApprovalSet::new();
        for who in ALL {
            approve(&record, &set, &mut approvals, who);
        }
        assert_eq!(
            assemble(&record, &set, &approvals, &ALL, DATE),
            Err(AssemblyError::UnsafeMarkup),
            "{hostile}"
        );
    }
    // Markup shown as code is text, not HTML.
    let set = drafts(&[(
        "ann",
        "Use `<b>` and

```html
<script>x</script>
```",
    )]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&record, &set, &mut approvals, who);
    }
    assert!(assemble(&record, &set, &approvals, &ALL, DATE).is_ok());
}

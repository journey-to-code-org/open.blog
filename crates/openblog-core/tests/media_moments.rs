//! Media moments (ADR 0072, 0073): located, attributed quotations and observations in a shared
//! reflection's sources, private until revealed with a draft, bound into approval when proposed
//! for the piece, and refused safely when the input is hostile or stale.

use std::collections::BTreeMap;

use openblog_core::approval::{
    ApprovalPolicy, ApprovalRequirement, ApprovalScope, ApprovalSet, ApprovalState, Readiness,
};
use openblog_core::assembly::{with_subject, with_subject_and_moments};
use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind,
};
use openblog_core::draft::DraftSet;
use openblog_core::media_moment::{
    timestamp_value, MomentError, MomentField, MomentInput, MomentIntent, MomentRule, MomentSet,
    Quotation, QuotationProvenance, QuotationRights, MAX_MOMENTS, MAX_MOMENT_SET_BYTES,
    MAX_QUOTATION_CHARS,
};
use openblog_core::research_notes::{Locator, LocatorKind};
use openblog_core::synthesis::SynthesisSet;

const T: i64 = 1_800_000_000;
const ALL: [&str; 3] = ["ann", "bo", "cy"];
const VIDEO: &str = "source-1";
const PODCAST: &str = "source-2";
const ARTICLE: &str = "source-3";
const BOOK: &str = "source-4";
const OTHER: &str = "source-5";

/// A shared reflection on five sources: a YouTube video, a podcast episode, an article, a book
/// with an ISBN, and a talk with no link at all.
fn record() -> SharedPublication {
    let source = |kind, title: &str, url: &str| NewSourceReference {
        kind,
        title: title.into(),
        url: url.into(),
        ..NewSourceReference::default()
    };
    let mut book = source(SourceKind::Book, "Deep Work", "");
    book.isbn = "978-1-4555-8669-1".into();
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: "shared-0a1b2c3d4e5f".into(),
        title: "Attention, together".into(),
        guiding_question: "What did you notice?".into(),
        sources: vec![
            source(
                SourceKind::Video,
                "The Art of Noticing",
                "https://www.youtube.com/watch?v=abcdefghijk",
            ),
            source(
                SourceKind::Podcast,
                "Slow Radio, episode 12",
                "https://podcasts.example/slow-radio/12",
            ),
            source(
                SourceKind::Article,
                "On Looking",
                "https://journal.example/on-looking",
            ),
            book,
            source(SourceKind::Other, "A talk in the park", ""),
        ],
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

fn locator(kind: LocatorKind, value: &str, to: Option<&str>) -> Locator {
    Locator {
        kind,
        value: value.into(),
        to: to.map(str::to_string),
        extra: BTreeMap::new(),
    }
}

fn at(value: &str) -> Locator {
    locator(LocatorKind::Timestamp, value, None)
}

fn span(value: &str, to: &str) -> Locator {
    locator(LocatorKind::Timestamp, value, Some(to))
}

fn quote(text: &str, rights: QuotationRights) -> Quotation {
    Quotation {
        text: text.into(),
        speaker: None,
        language: None,
        rights,
        provenance: QuotationProvenance::Transcribed,
    }
}

fn observe(source: &str, locators: Vec<Locator>, text: &str) -> MomentInput {
    MomentInput {
        source: source.into(),
        locators,
        quotation: None,
        observation: Some(text.into()),
        intent: MomentIntent::Private,
    }
}

fn publish(mut input: MomentInput) -> MomentInput {
    input.intent = MomentIntent::Publication;
    input
}

fn add(set: &mut MomentSet, who: &str, input: MomentInput) -> Result<String, MomentError> {
    let sources = record().sources;
    let revision = set.revision();
    set.add(who, &ALL, revision, &sources, input)
}

#[test]
fn fixtures_cover_video_podcast_article_book_ranges_unknown_duration_and_several_sources() {
    let record = record();
    let mut set = MomentSet::new();
    let video = add(
        &mut set,
        "ann",
        observe(VIDEO, vec![at("1:02:03.5")], "The pause is the point."),
    )
    .unwrap();
    let range = add(
        &mut set,
        "ann",
        observe(VIDEO, vec![span("90", "2:15")], "The whole second act."),
    )
    .unwrap();
    let podcast = add(
        &mut set,
        "bo",
        observe(
            PODCAST,
            vec![locator(LocatorKind::Chapter, "3", None), at("41:07")],
            "The host changes her mind here.",
        ),
    )
    .unwrap();
    let article = add(
        &mut set,
        "bo",
        observe(
            ARTICLE,
            vec![locator(LocatorKind::Section, "Looking up", None)],
            "Compare with the video.",
        ),
    )
    .unwrap();
    let book = add(
        &mut set,
        "cy",
        MomentInput {
            quotation: Some(quote(
                "Clarity about what matters provides clarity about what does not.",
                QuotationRights::BriefQuotation,
            )),
            observation: None,
            ..observe(
                BOOK,
                vec![
                    locator(LocatorKind::Chapter, "2", None),
                    locator(LocatorKind::Page, "40", Some("41")),
                ],
                "",
            )
        },
    )
    .unwrap();
    let talk = add(
        &mut set,
        "cy",
        observe(
            OTHER,
            vec![
                at("12:00"),
                locator(LocatorKind::Extension("x-slide".into()), "7", None),
            ],
            "No recording exists.",
        ),
    )
    .unwrap();

    let moment = |id: &str| {
        set.own(id_owner(&set, id), &ALL)
            .unwrap()
            .into_iter()
            .find(|m| m.id() == id)
            .unwrap()
            .clone()
    };
    fn id_owner<'a>(set: &'a MomentSet, id: &str) -> &'a str {
        for who in ALL {
            if set.own(who, &ALL).unwrap().iter().any(|m| m.id() == id) {
                return who;
            }
        }
        panic!("no owner for {id}")
    }

    // Ranges and unknown duration: no duration is needed, and one only answers when known.
    let (start, end) = moment(&range).time_range().unwrap();
    assert_eq!((start.seconds, end.map(|e| e.seconds)), (90, Some(135)));
    assert_eq!(moment(&video).within_duration(None), None);
    assert_eq!(moment(&video).within_duration(Some(3_600)), Some(false));
    assert_eq!(moment(&video).within_duration(Some(4_000)), Some(true));
    assert_eq!(moment(&article).within_duration(Some(10)), None);

    // Links derive from the source's own stored address, with the time only where it is known.
    let link = moment(&video).link(&record.sources).unwrap();
    assert_eq!(
        link.href,
        "https://www.youtube.com/watch?v=abcdefghijk&t=3723s"
    );
    assert!(link.at_time);
    let link = moment(&podcast).link(&record.sources).unwrap();
    assert_eq!(link.href, "https://podcasts.example/slow-radio/12");
    assert!(!link.at_time, "an unknown provider keeps the original link");
    assert!(moment(&book).link(&record.sources).is_none());
    assert!(moment(&talk).link(&record.sources).is_none());

    // Several sources, each kept by id.
    let sources: Vec<String> = [&video, &podcast, &article, &book, &talk]
        .iter()
        .map(|id| moment(id).source().to_string())
        .collect();
    assert_eq!(sources, [VIDEO, PODCAST, ARTICLE, BOOK, OTHER]);

    // The stored form loads back unchanged.
    assert_eq!(MomentSet::from_json(&set.to_json()).unwrap(), set);
}

#[test]
fn locations_support_timestamps_and_textual_locators_only_where_the_source_has_them() {
    let fits = MomentError::Rule(MomentRule::LocatorDoesNotFitSource);
    let mut set = MomentSet::new();
    let cases: Vec<(&str, Vec<Locator>, Result<(), MomentError>)> = vec![
        (BOOK, vec![at("10")], Err(fits)),
        (ARTICLE, vec![at("10")], Err(fits)),
        (
            VIDEO,
            vec![locator(LocatorKind::Page, "4", None)],
            Err(fits),
        ),
        (
            PODCAST,
            vec![locator(LocatorKind::Page, "4", None)],
            Err(fits),
        ),
        (
            BOOK,
            vec![locator(LocatorKind::Folio, "12r", None)],
            Err(fits),
        ),
        (VIDEO, vec![at("10"), at("20")], Err(fits)),
        (VIDEO, vec![span("20", "10")], Err(fits)),
        (VIDEO, vec![span("20", "0:20.000")], Err(fits)),
        (VIDEO, vec![span("20", "20.5")], Ok(())),
        (
            VIDEO,
            vec![locator(LocatorKind::Chapter, "Intro", None)],
            Ok(()),
        ),
        (
            OTHER,
            vec![locator(LocatorKind::Page, "3", None), at("1:00")],
            Ok(()),
        ),
        (
            BOOK,
            vec![locator(LocatorKind::Canonical, "514a", Some("520a"))],
            Ok(()),
        ),
        (
            VIDEO,
            vec![at("1:5")],
            Err(MomentError::Invalid(MomentField::Locators)),
        ),
        (
            VIDEO,
            vec![at("soon")],
            Err(MomentError::Invalid(MomentField::Locators)),
        ),
        (
            VIDEO,
            vec![],
            Err(MomentError::Invalid(MomentField::Locators)),
        ),
        (
            VIDEO,
            vec![at("10"); 9],
            Err(MomentError::Invalid(MomentField::Locators)),
        ),
        (
            BOOK,
            vec![locator(LocatorKind::Page, "4; page 5", None)],
            Err(MomentError::Invalid(MomentField::Locators)),
        ),
        (
            BOOK,
            vec![
                locator(LocatorKind::Page, "4", None),
                locator(LocatorKind::Page, "4", None),
            ],
            Err(MomentError::Invalid(MomentField::Locators)),
        ),
        (
            "source-9",
            vec![at("10")],
            Err(MomentError::Invalid(MomentField::Source)),
        ),
    ];
    for (source, locators, expected) in cases {
        let before = set.clone();
        let result = add(&mut set, "ann", observe(source, locators.clone(), "noted")).map(|_| ());
        assert_eq!(result, expected, "{source} {locators:?}");
        if expected.is_err() {
            assert_eq!(set, before, "a refused moment changes nothing");
        }
    }

    // A locator with the notebook's private extension fields does not load as a moment's.
    let mut extra = at("10");
    extra.extra.insert("note".into(), serde_json::json!("x"));
    assert_eq!(
        add(&mut set, "ann", observe(VIDEO, vec![extra], "noted")),
        Err(MomentError::Invalid(MomentField::Locators))
    );
}

#[test]
fn timestamps_compare_exactly_whatever_their_form() {
    assert_eq!(timestamp_value("1:00"), timestamp_value("60"));
    assert_eq!(timestamp_value("1:00:00.10"), timestamp_value("3600.1"));
    assert!(timestamp_value("59.95") < timestamp_value("60"));
    assert!(timestamp_value("60.05") > timestamp_value("60"));
    assert_eq!(timestamp_value("1:60"), None);
    assert_eq!(timestamp_value("99999999999999999999999"), None);
}

#[test]
fn quotation_speaker_source_participant_and_observation_stay_distinct() {
    let record = record();
    let mut set = MomentSet::new();
    let text = "  Attention is the beginning\n\tof devotion.  ";
    let id = add(
        &mut set,
        "bo",
        MomentInput {
            source: PODCAST.into(),
            locators: vec![span("12:30", "12:41")],
            quotation: Some(Quotation {
                text: text.into(),
                speaker: Some("Mary Oliver".into()),
                language: Some("en".into()),
                rights: QuotationRights::BriefQuotation,
                provenance: QuotationProvenance::Transcribed,
            }),
            observation: Some("I had never heard it read aloud.".into()),
            intent: MomentIntent::Publication,
        },
    )
    .unwrap();
    let moment = set.own("bo", &ALL).unwrap()[0].clone();
    assert_eq!(moment.id(), id);
    // Who made it comes from the requester; the speaker is who spoke in the source; the source is
    // the record's reference; the quotation is kept exactly; the observation is Bo's own words.
    assert_eq!(moment.participant(), "bo");
    let quotation = moment.quotation().unwrap();
    assert_eq!(quotation.text, text, "quoted text is stored exactly");
    assert_eq!(quotation.speaker.as_deref(), Some("Mary Oliver"));
    assert_eq!(moment.source(), PODCAST);
    assert_eq!(
        record.sources[1].title, "Slow Radio, episode 12",
        "source attribution stays the record's, not the speaker's"
    );
    assert_eq!(
        moment.observation(),
        Some("I had never heard it read aloud.")
    );

    let stored: serde_json::Value = serde_json::from_str(&set.to_json()).unwrap();
    let stored = &stored["moments"][0];
    assert_eq!(stored["participant"], "bo");
    assert_eq!(stored["source"], PODCAST);
    assert_eq!(stored["quotation"]["text"], text);
    assert_eq!(stored["quotation"]["speaker"], "Mary Oliver");
    assert_eq!(stored["quotation"]["rights"], "briefQuotation");
    assert_eq!(stored["quotation"]["provenance"], "transcribed");
    assert_eq!(stored["observation"], "I had never heard it read aloud.");
    assert_eq!(stored["locators"][0]["kind"], "timestamp");
    assert_eq!(stored["locators"][0]["to"], "12:41");

    // A moment says something: a bare location is refused.
    let mut empty = observe(VIDEO, vec![at("1")], "x");
    empty.observation = None;
    assert_eq!(
        add(&mut set, "bo", empty),
        Err(MomentError::Invalid(MomentField::Content))
    );
}

#[test]
fn rights_and_provenance_are_explicit_and_unknown_rights_never_reach_the_piece() {
    let mut set = MomentSet::new();
    let unknown = MomentInput {
        quotation: Some(quote("Words.", QuotationRights::Unknown)),
        observation: None,
        ..observe(VIDEO, vec![at("5")], "")
    };
    let id = add(&mut set, "ann", unknown.clone()).unwrap();
    assert_eq!(
        add(&mut set, "ann", publish(unknown.clone())),
        Err(MomentError::Rule(MomentRule::RightsUnknown))
    );
    let sources = record().sources;
    let revision = set.revision();
    assert_eq!(
        set.edit(
            "ann",
            &ALL,
            revision,
            &sources,
            &id,
            publish(unknown.clone())
        ),
        Err(MomentError::Rule(MomentRule::RightsUnknown))
    );
    let mut known = publish(unknown);
    known.quotation.as_mut().unwrap().rights = QuotationRights::Permission;
    set.edit("ann", &ALL, revision, &sources, &id, known)
        .unwrap();

    // A stored quotation without a rights or provenance status does not load.
    for field in ["rights", "provenance"] {
        let mut stored: serde_json::Value = serde_json::from_str(&set.to_json()).unwrap();
        stored["moments"][0]["quotation"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(
            MomentSet::from_json(&stored.to_string()).is_err(),
            "{field}"
        );
    }
    // Nor does a stored publication moment whose rights are unknown.
    let mut stored: serde_json::Value = serde_json::from_str(&set.to_json()).unwrap();
    stored["moments"][0]["quotation"]["rights"] = "unknown".into();
    assert!(MomentSet::from_json(&stored.to_string()).is_err());
}

#[test]
fn untrusted_markdown_metadata_urls_and_identities_fail_safely_without_echoing_them() {
    let mut set = MomentSet::new();
    let markup = MomentError::Rule(MomentRule::Markup);
    for (observation, expected) in [
        ("<script>alert(1)</script>", Err(markup)),
        ("see <img src=x onerror=alert(1)>", Err(markup)),
        ("![pixel](https://tracker.example/p.gif)", Err(markup)),
        ("# Heading", Err(markup)),
        ("[run](javascript:alert(1))", Err(markup)),
        ("[here](/relative)", Err(markup)),
        ("note[^1]\n\n[^1]: reaches out", Err(markup)),
        (
            "bidi \u{202e}txt",
            Err(MomentError::Invalid(MomentField::Observation)),
        ),
        (
            "nul \u{0}",
            Err(MomentError::Invalid(MomentField::Observation)),
        ),
        ("   ", Err(MomentError::Invalid(MomentField::Observation))),
        ("[the talk](https://example.com/talk) *moved* me", Ok(())),
    ] {
        let result = add(&mut set, "ann", observe(VIDEO, vec![at("1")], observation)).map(|_| ());
        assert_eq!(result, expected, "{observation:?}");
        if let (Err(error), false) = (result, observation.trim().is_empty()) {
            assert!(!error.to_string().contains(observation.trim()));
        }
    }

    let long = "a".repeat(MAX_QUOTATION_CHARS + 1);
    for (quotation, expected) in [
        (
            Quotation {
                speaker: Some("Name\nInjected: header".into()),
                ..quote("ok", QuotationRights::BriefQuotation)
            },
            MomentField::Speaker,
        ),
        (
            Quotation {
                speaker: Some("\u{2067}evil".into()),
                ..quote("ok", QuotationRights::BriefQuotation)
            },
            MomentField::Speaker,
        ),
        (
            Quotation {
                language: Some("not a tag!".into()),
                ..quote("ok", QuotationRights::BriefQuotation)
            },
            MomentField::Language,
        ),
        (
            quote(&long, QuotationRights::BriefQuotation),
            MomentField::Quotation,
        ),
        (
            quote("line\u{2028}sep", QuotationRights::BriefQuotation),
            MomentField::Quotation,
        ),
        (
            quote("\u{202d}override", QuotationRights::BriefQuotation),
            MomentField::Quotation,
        ),
    ] {
        let input = MomentInput {
            quotation: Some(quotation),
            observation: None,
            ..observe(VIDEO, vec![at("1")], "")
        };
        assert_eq!(
            add(&mut set, "ann", input),
            Err(MomentError::Invalid(expected))
        );
    }

    // Stored state: unknown fields (a token, a credit, a visibility switch, a URL of its own) and a
    // minted id ahead of the counter do not load.
    let good = set.to_json();
    for (path, value) in [
        ("/token", serde_json::json!("secret")),
        ("/moments/0/url", serde_json::json!("https://evil.example")),
        ("/moments/0/credit", serde_json::json!("x")),
        ("/moments/0/visibility", serde_json::json!("public")),
        ("/moments/0/participant", serde_json::json!("../ann")),
        ("/moments/0/id", serde_json::json!("moment-99")),
        ("/moments/0/locators/0/kind", serde_json::json!("minute")),
        ("/version", serde_json::json!(2)),
    ] {
        let mut stored: serde_json::Value = serde_json::from_str(&good).unwrap();
        let (parent, key) = path.rsplit_once('/').unwrap();
        stored.pointer_mut(parent).unwrap()[key] = value;
        let error = MomentSet::from_json(&stored.to_string()).unwrap_err();
        assert_eq!(error, MomentError::Invalid(MomentField::Limit), "{path}");
        assert!(!error.to_string().contains("secret"));
    }
    assert!(MomentSet::from_json(&" ".repeat(MAX_MOMENT_SET_BYTES + 1)).is_err());
}

#[test]
fn only_the_owner_changes_a_moment_and_strangers_learn_nothing() {
    let sources = record().sources;
    let mut set = MomentSet::new();
    let id = add(&mut set, "ann", observe(VIDEO, vec![at("1")], "mine")).unwrap();
    let revision = set.revision();
    let before = set.clone();
    let input = observe(VIDEO, vec![at("2")], "taken");

    // Another author, and an id that does not exist, get the same refusal.
    assert_eq!(
        set.edit("bo", &ALL, revision, &sources, &id, input.clone()),
        Err(MomentError::Denied)
    );
    assert_eq!(
        set.edit("bo", &ALL, revision, &sources, "moment-404", input.clone()),
        Err(MomentError::Denied)
    );
    assert_eq!(
        set.remove("bo", &ALL, revision, &id),
        Err(MomentError::Denied)
    );
    // Someone who is not an author is refused everything, reads included.
    for stranger in ["mallory", "ann-admin", ""] {
        assert_eq!(
            set.add(stranger, &ALL, revision, &sources, input.clone()),
            Err(MomentError::Denied)
        );
        assert_eq!(set.own(stranger, &ALL).err(), Some(MomentError::Denied));
        assert_eq!(
            set.revealed(stranger, &ALL, "ann", Some(1), &sources).err(),
            Some(MomentError::Denied)
        );
    }
    // A moment keeps its source for life.
    assert_eq!(
        set.edit(
            "ann",
            &ALL,
            revision,
            &sources,
            &id,
            observe(PODCAST, vec![at("1")], "x")
        ),
        Err(MomentError::Invalid(MomentField::Source))
    );
    assert_eq!(set, before);
    // Others' own lists never include Ann's moments.
    assert!(set.own("bo", &ALL).unwrap().is_empty());
}

#[test]
fn concurrent_changes_are_refused_as_stale_and_change_nothing() {
    let sources = record().sources;
    let mut set = MomentSet::new();
    let read = set.revision();
    set.add(
        "ann",
        &ALL,
        read,
        &sources,
        observe(VIDEO, vec![at("1")], "first"),
    )
    .unwrap();
    let before = set.clone();
    // Bo read the same revision as Ann; his write lands second.
    assert_eq!(
        set.add(
            "bo",
            &ALL,
            read,
            &sources,
            observe(VIDEO, vec![at("2")], "second")
        ),
        Err(MomentError::Stale)
    );
    let id = set.own("ann", &ALL).unwrap()[0].id().to_string();
    assert_eq!(
        set.edit(
            "ann",
            &ALL,
            read,
            &sources,
            &id,
            observe(VIDEO, vec![at("3")], "edit")
        ),
        Err(MomentError::Stale)
    );
    assert_eq!(set.remove("ann", &ALL, read, &id), Err(MomentError::Stale));
    assert_eq!(set, before);
    // An unchanged edit is not a change.
    let current = set.revision();
    set.edit(
        "ann",
        &ALL,
        current,
        &sources,
        &id,
        observe(VIDEO, vec![at("1")], "first"),
    )
    .unwrap();
    assert_eq!(set.revision(), current);
}

#[test]
fn the_set_refuses_to_grow_past_its_limits_and_a_full_set_still_loads() {
    let sources = record().sources;
    let mut set = MomentSet::new();
    let observation = "w ".repeat(4_000);
    let quotation = "q".repeat(MAX_QUOTATION_CHARS);
    for n in 0..MAX_MOMENTS {
        let who = ALL[n % 3];
        let input = MomentInput {
            quotation: Some(Quotation {
                speaker: Some("S".repeat(200)),
                ..quote(&quotation, QuotationRights::OpenLicense)
            }),
            ..publish(observe(
                VIDEO,
                (0..8)
                    .map(|i| {
                        if i == 0 {
                            span("1", "2")
                        } else {
                            locator(
                                LocatorKind::Section,
                                &format!("{i}{}", "s".repeat(190)),
                                None,
                            )
                        }
                    })
                    .collect(),
                &observation,
            ))
        };
        let revision = set.revision();
        set.add(who, &ALL, revision, &sources, input).unwrap();
    }
    let revision = set.revision();
    assert_eq!(
        set.add(
            "ann",
            &ALL,
            revision,
            &sources,
            observe(VIDEO, vec![at("1")], "one more")
        ),
        Err(MomentError::Invalid(MomentField::Limit))
    );
    let json = set.to_json();
    assert!(json.len() < MAX_MOMENT_SET_BYTES);
    assert_eq!(MomentSet::from_json(&json).unwrap(), set);
}

/// Ann wrote at revision 1; Bo may read it (the caller's `DraftSet::view` check).
#[test]
fn moments_stay_private_until_sealed_to_the_draft_revision_another_author_may_read() {
    let sources = record().sources;
    let mut set = MomentSet::new();
    add(
        &mut set,
        "ann",
        observe(VIDEO, vec![at("1")], "private note"),
    )
    .unwrap();
    let shared = add(
        &mut set,
        "ann",
        publish(observe(VIDEO, vec![at("2")], "for the piece")),
    )
    .unwrap();
    let nothing: Vec<String> = Vec::new();
    let ids = |set: &MomentSet, readable: Option<u64>| -> Vec<String> {
        set.revealed("bo", &ALL, "ann", readable, &sources)
            .unwrap()
            .iter()
            .map(|m| m.id().to_string())
            .collect()
    };

    // Not sealed yet: nothing, exactly as for an author with no moments.
    assert_eq!(ids(&set, Some(1)), nothing);
    assert_eq!(
        set.revealed("bo", &ALL, "cy", Some(1), &sources)
            .unwrap()
            .len(),
        0
    );
    assert!(!set.is_sealed("ann", 1, &sources));
    assert!(
        set.is_sealed("cy", 1, &sources),
        "nothing to seal is sealed"
    );

    // Ann reveals draft revision 1: her publication moments go with it, her private one never.
    assert_eq!(set.seal("ann", &ALL, 1, &sources), Ok(true));
    assert_eq!(ids(&set, Some(1)), vec![shared.clone()]);
    assert!(set.is_sealed("ann", 1, &sources));
    // Bo cannot read Ann's latest revision (an older reveal, or none): nothing.
    assert_eq!(ids(&set, None), nothing);
    assert_eq!(ids(&set, Some(2)), nothing);

    // An edit after the reveal stays private, and re-sealing the same revision does not take it.
    let revision = set.revision();
    set.edit(
        "ann",
        &ALL,
        revision,
        &sources,
        &shared,
        publish(observe(VIDEO, vec![at("2")], "rewritten after the reveal")),
    )
    .unwrap();
    assert_eq!(ids(&set, Some(1)), nothing);
    assert_eq!(set.seal("ann", &ALL, 1, &sources), Ok(false));
    assert_eq!(ids(&set, Some(1)), nothing);
    // There is no revision 0 to seal.
    assert_eq!(set.seal("ann", &ALL, 0, &sources), Err(MomentError::Denied));
    // Revealing a newer revision shares the edit.
    assert_eq!(set.seal("ann", &ALL, 2, &sources), Ok(true));
    assert_eq!(ids(&set, Some(2)), vec![shared.clone()]);
    // Sealing an older revision never moves the seal back.
    assert_eq!(set.seal("ann", &ALL, 1, &sources), Ok(false));
    assert_eq!(ids(&set, Some(2)), vec![shared]);

    // A private edit never disturbs what was revealed.
    let private = set.own("ann", &ALL).unwrap()[0].id().to_string();
    let revision = set.revision();
    set.edit(
        "ann",
        &ALL,
        revision,
        &sources,
        &private,
        observe(VIDEO, vec![at("1")], "still private"),
    )
    .unwrap();
    assert_eq!(ids(&set, Some(2)).len(), 1);

    // Someone who is not an author cannot seal.
    assert_eq!(
        set.seal("mallory", &ALL, 3, &sources),
        Err(MomentError::Denied)
    );
}

#[test]
fn a_removed_author_loses_their_moments_and_restoring_them_does_not_bring_them_back() {
    let sources = record().sources;
    let mut set = MomentSet::new();
    add(
        &mut set,
        "cy",
        publish(observe(VIDEO, vec![at("1")], "cy's")),
    )
    .unwrap();
    set.seal("cy", &ALL, 1, &sources).unwrap();
    add(&mut set, "ann", observe(VIDEO, vec![at("2")], "ann's")).unwrap();
    let remaining = ["ann", "bo"];
    assert!(set.reconcile(&remaining));
    assert!(!set.reconcile(&remaining));
    assert!(set.own("cy", &ALL).unwrap().is_empty());
    assert!(set.attributed_participants().is_empty());
    assert_eq!(set.own("ann", &ALL).unwrap().len(), 1);
    // While Cy is not an author, nothing of theirs is revealed even with a matching seal.
    let mut stale = MomentSet::new();
    add(
        &mut stale,
        "cy",
        publish(observe(VIDEO, vec![at("1")], "cy's")),
    )
    .unwrap();
    stale.seal("cy", &ALL, 1, &sources).unwrap();
    assert!(stale
        .revealed("ann", &remaining, "cy", Some(1), &sources)
        .unwrap()
        .is_empty());
}

fn drafts(texts: &[(&str, &str)]) -> DraftSet {
    let mut set = DraftSet::new(&ALL).unwrap();
    for (who, text) in texts {
        set.save(who, who, 0, text, T).unwrap();
    }
    set
}

fn approve(
    record: &SharedPublication,
    drafts: &DraftSet,
    moments: &MomentSet,
    approvals: &mut ApprovalSet,
    who: &str,
) {
    let synthesis = SynthesisSet::new();
    let seen = with_subject_and_moments(record, None, drafts, &synthesis, moments, &ALL, |s| {
        approvals.binding_for(s, who).unwrap()
    });
    with_subject_and_moments(record, None, drafts, &synthesis, moments, &ALL, |s| {
        approvals.approve(who, who, s, &seen, true, T)
    })
    .unwrap();
}

fn state(
    record: &SharedPublication,
    drafts: &DraftSet,
    moments: &MomentSet,
    approvals: &ApprovalSet,
    who: &str,
) -> ApprovalState {
    with_subject_and_moments(
        record,
        None,
        drafts,
        &SynthesisSet::new(),
        moments,
        &ALL,
        |s| approvals.state(s, who),
    )
}

#[test]
fn publication_moments_join_the_approval_binding_and_private_ones_never_do() {
    let mut record = record();
    let drafts = drafts(&[("ann", "Ann words"), ("bo", "Bo words")]);
    let mut moments = MomentSet::new();
    let mut approvals = ApprovalSet::new();

    // With no moments the subject is exactly the one the existing builder makes.
    let plain = with_subject(&record, None, &drafts, &SynthesisSet::new(), &ALL, |s| {
        approvals.binding_for(s, "ann").unwrap()
    });
    let with_none = with_subject_and_moments(
        &record,
        None,
        &drafts,
        &SynthesisSet::new(),
        &moments,
        &ALL,
        |s| approvals.binding_for(s, "ann").unwrap(),
    );
    assert_eq!(plain, with_none);

    approve(&record, &drafts, &moments, &mut approvals, "ann");
    let private = add(
        &mut moments,
        "bo",
        observe(PODCAST, vec![at("1")], "private"),
    )
    .unwrap();
    assert_eq!(
        state(&record, &drafts, &moments, &approvals, "ann"),
        ApprovalState::Approved,
        "a private moment is not part of the piece"
    );

    // Proposing it for the piece stales the approval.
    let revision = moments.revision();
    moments
        .edit(
            "bo",
            &ALL,
            revision,
            &record.sources,
            &private,
            publish(observe(PODCAST, vec![at("1")], "private")),
        )
        .unwrap();
    assert_eq!(
        state(&record, &drafts, &moments, &approvals, "ann"),
        ApprovalState::Stale
    );
    approve(&record, &drafts, &moments, &mut approvals, "ann");

    // Editing it, or the public face of its source, stales it again.
    let revision = moments.revision();
    moments
        .edit(
            "bo",
            &ALL,
            revision,
            &record.sources,
            &private,
            publish(observe(PODCAST, vec![span("1", "4")], "private")),
        )
        .unwrap();
    assert_eq!(
        state(&record, &drafts, &moments, &approvals, "ann"),
        ApprovalState::Stale
    );
    approve(&record, &drafts, &moments, &mut approvals, "ann");
    record.sources[1].title = "Slow Radio, episode 13".into();
    assert_eq!(
        state(&record, &drafts, &moments, &approvals, "ann"),
        ApprovalState::Stale
    );

    // The frame carries digests only: no quotation, observation, speaker, name or link.
    let frame = moments.binding_frame(&record.sources);
    assert_eq!(frame[0], "moments:1");
    assert!(frame[1..]
        .iter()
        .all(|digest| digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())));
}

#[test]
fn whoever_proposes_a_moment_must_approve_the_piece_under_every_policy() {
    let record = record();
    // Cy wrote no section, so under "contributing authors" Cy would not be required...
    let drafts = drafts(&[("ann", "Ann words"), ("bo", "Bo words")]);
    let mut approvals = ApprovalSet::new();
    approvals.set_policy(ApprovalPolicy {
        requirement: ApprovalRequirement::ContributingAuthors,
        scope: ApprovalScope::OwnSections,
    });
    let mut moments = MomentSet::new();
    approve(&record, &drafts, &moments, &mut approvals, "ann");
    approve(&record, &drafts, &moments, &mut approvals, "bo");
    let ready = |moments: &MomentSet, approvals: &ApprovalSet| {
        with_subject_and_moments(
            &record,
            None,
            &drafts,
            &SynthesisSet::new(),
            moments,
            &ALL,
            |s| approvals.evaluate(s).unwrap(),
        )
    };
    assert_eq!(ready(&moments, &approvals), Readiness::Ready);

    // ...but a moment Cy proposes for the piece makes Cy a required approver.
    add(
        &mut moments,
        "cy",
        publish(observe(
            ARTICLE,
            vec![locator(LocatorKind::Page, "3", None)],
            "Cy saw this",
        )),
    )
    .unwrap();
    match ready(&moments, &approvals) {
        Readiness::Blocked { missing, .. } => {
            assert_eq!(missing, vec!["ann", "bo", "cy"]);
        }
        Readiness::Ready => panic!("a proposed moment must block until its owner approves"),
    }
    for who in ALL {
        approve(&record, &drafts, &moments, &mut approvals, who);
    }
    assert_eq!(ready(&moments, &approvals), Readiness::Ready);
}

#[test]
fn a_publication_moment_whose_source_no_longer_fits_is_reported_unresolved() {
    let mut record = record();
    let mut moments = MomentSet::new();
    let id = add(
        &mut moments,
        "ann",
        publish(observe(OTHER, vec![at("3:00")], "at the talk")),
    )
    .unwrap();
    add(
        &mut moments,
        "ann",
        observe(OTHER, vec![at("4:00")], "private"),
    )
    .unwrap();
    assert!(moments.unresolved(&record.sources).is_empty());
    // The talk is re-described as a book: a book has no timeline.
    record.sources[4].kind = SourceKind::Book;
    assert_eq!(moments.unresolved(&record.sources), vec![id.as_str()]);
    record.sources.truncate(4);
    assert_eq!(moments.unresolved(&record.sources), vec![id.as_str()]);
}

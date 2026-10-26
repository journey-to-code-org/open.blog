//! Future-question and source-suggestion records (RD13.1, ADRs 0190 to 0195):
//! one more kind in the one participation policy, untrusted by default,
//! private to the editors, never entering the Source Library by itself, with
//! acceptance meaning editorial interest and nothing more.

use openblog_core::date::DateTime;
use openblog_core::feedback_provenance::FeedbackChannel;
use openblog_core::future_suggestion::{
    convert, duplicate_groups, library_candidate, normalize_suggestion_url, source_key, About,
    Conversion, ConversionError, ConversionKind, ErrorCode, ReaderAttribution, Standing,
    Submission, Suggestion, SuggestionType, ACCEPTANCE_NOTICE, KIND, MAX_CONVERSIONS,
    MAX_TEXT_CHARS,
};
use openblog_core::moderation::{
    is_public, may_view, Actor, ItemFacts, ModerationAction, ModerationPolicy, ModerationState,
    PolicyError, ReasonCode, Request, RetentionStep, Submission as NewItem, View,
};
use openblog_core::participation::{ParticipationKind, ParticipationMode};
use serde_json::{json, Value};

const WORK: &str = "/posts/tides/";
const WORKS: [&str; 1] = [WORK];
const ADMIN: Actor<'static> = Actor::SiteAdmin {
    admin_user: "owner",
};
const COORDINATOR: Actor<'static> = Actor::Coordinator {
    admin_user: "coord",
    works: &WORKS,
};
const CONTRIBUTOR: Actor<'static> = Actor::ContributingAuthor {
    admin_user: "writer",
    works: &WORKS,
};

fn time(value: &str) -> DateTime {
    DateTime::parse(value).expect("test time")
}

fn received() -> DateTime {
    time("2026-10-26T10:00:00Z")
}

fn submission(extra: Value) -> Value {
    let mut value = json!({
        "version": 1,
        "kind": "future-suggestion",
        "type": "text",
        "text": "Her letters from the 1850 survey would help with the tide tables.",
    });
    for (key, field) in extra.as_object().expect("object") {
        value[key] = field.clone();
    }
    value
}

fn parse(value: &Value) -> Result<Submission, openblog_core::future_suggestion::SuggestionError> {
    Submission::from_json(&value.to_string())
}

fn code(value: &Value) -> ErrorCode {
    parse(value).expect_err("must be refused").code
}

fn receive(value: &Value) -> Suggestion {
    Suggestion::receive(
        parse(value).expect("valid"),
        WORK,
        received(),
        FeedbackChannel::Hosted,
    )
    .expect("received")
}

fn facts(state: ModerationState) -> ItemFacts<'static> {
    ItemFacts {
        id: "item-1",
        kind: KIND,
        work: Some(WORK),
        parent: None,
        state,
        version: 3,
        revision: 1,
        approved_revision: (state == ModerationState::Approved).then_some(1),
        clarification_asked: None,
        clarification_consent: true,
        content_retained: true,
        state_since: received(),
    }
}

fn decide(
    actor: Actor<'static>,
    action: ModerationAction,
    item: &ItemFacts<'static>,
    reason: Option<ReasonCode>,
) -> Result<openblog_core::moderation::Decision, PolicyError> {
    ModerationPolicy::default().decide(
        item,
        &Request {
            actor,
            action,
            expected_version: item.version,
            reason,
            at: time("2026-10-27T10:00:00Z"),
            reported_item: None,
        },
    )
}

// ---------------------------------------------------------------------------
// The record

#[test]
fn every_type_round_trips_to_the_same_canonical_json() {
    let full = submission(json!({
        "type": "video",
        "url": "https://Example.org/watch?v=1",
        "hints": {
            "title": "The 1850 survey",
            "creators": ["A. Surveyor"],
            "year": "c. 1850",
            "publisher": "Admiralty",
            "identifiers": [{ "scheme": "doi", "value": "10.1234/example" }]
        },
        "about": { "series": "tides" },
        "attribution": { "name": "  Ada   Lovelace ", "publishName": true },
        "contact": { "address": "ada@example.org", "followUp": true }
    }));
    let record = Suggestion::receive(
        parse(&full).unwrap(),
        WORK,
        received(),
        FeedbackChannel::Hosted,
    )
    .unwrap();
    assert_eq!(
        record.submission.url.as_deref(),
        Some("https://example.org/watch?v=1")
    );
    assert_eq!(record.credit(), Some("Ada Lovelace"));
    let text = record.to_json();
    let again = Suggestion::from_json(&text).unwrap();
    assert_eq!(again, record);
    assert_eq!(again.to_json(), text, "canonical output is deterministic");
    // A submission serializes the same way every time, in a fixed order.
    let submission = parse(&full).unwrap();
    assert_eq!(
        submission.to_json(),
        Submission::from_json(&submission.to_json())
            .unwrap()
            .to_json()
    );

    for kind in SuggestionType::ALL {
        let value = if kind == SuggestionType::Question {
            submission_of(kind, json!({}))
        } else {
            submission_of(kind, json!({ "url": "https://example.org/x" }))
        };
        assert_eq!(parse(&value).unwrap().suggestion_type, kind);
        assert_eq!(SuggestionType::from_id(kind.id()), Some(kind));
    }
}

fn submission_of(kind: SuggestionType, extra: Value) -> Value {
    let mut value = submission(extra);
    value["type"] = kind.id().into();
    value
}

#[test]
fn a_record_is_strict_about_version_kind_type_fields_and_size() {
    assert_eq!(
        code(&submission(json!({ "type": "poem" }))),
        ErrorCode::UnknownType
    );
    assert_eq!(
        code(&submission(json!({ "kind": "question" }))),
        ErrorCode::WrongKind
    );
    assert_eq!(
        code(&submission(json!({ "text": "" }))),
        ErrorCode::InvalidText
    );
    assert_eq!(
        code(&submission(json!({ "text": "  " }))),
        ErrorCode::InvalidText
    );
    assert_eq!(
        code(&submission(
            json!({ "text": "x".repeat(MAX_TEXT_CHARS + 1) })
        )),
        ErrorCode::InvalidText
    );
    assert_eq!(
        code(&submission(json!({ "text": "a\u{202e}b" }))),
        ErrorCode::InvalidText
    );
    assert_eq!(
        code(&submission(json!({ "rank": 3 }))),
        ErrorCode::Malformed
    );
    assert_eq!(
        code(&submission(json!({ "votes": 3 }))),
        ErrorCode::Malformed
    );
    assert_eq!(
        code(&submission(json!({ "version": 2 }))),
        ErrorCode::UnsupportedVersion
    );
    assert_eq!(
        code(&submission(json!({ "version": 0 }))),
        ErrorCode::Malformed
    );
    assert_eq!(
        Submission::from_json("not json").unwrap_err().code,
        ErrorCode::Malformed
    );
    assert_eq!(
        Submission::from_json(&" ".repeat(20_000)).unwrap_err().code,
        ErrorCode::TooLarge
    );
    // Hints are strict too.
    assert_eq!(
        code(&submission(
            json!({ "hints": { "title": "t", "rating": 5 } })
        )),
        ErrorCode::Malformed
    );
    assert_eq!(
        code(&submission(
            json!({ "hints": { "creators": vec!["a"; 9] } })
        )),
        ErrorCode::InvalidHint
    );
    assert_eq!(
        code(&submission(
            json!({ "hints": { "identifiers": [{ "scheme": "isbn", "value": "123" }] } })
        )),
        ErrorCode::InvalidHint
    );
    assert_eq!(
        code(&submission(
            json!({ "hints": { "title": "x".repeat(301) } })
        )),
        ErrorCode::InvalidHint
    );
    // A question is words only.
    assert_eq!(
        code(&submission_of(
            SuggestionType::Question,
            json!({ "url": "https://example.org/" })
        )),
        ErrorCode::NotForQuestion
    );
    assert_eq!(
        code(&submission_of(
            SuggestionType::Question,
            json!({ "hints": { "title": "t" } })
        )),
        ErrorCode::NotForQuestion
    );
    // The target is a series slug or a published page, exactly one.
    for about in [
        json!({}),
        json!({ "series": "Tides" }),
        json!({ "series": "a", "article": "/posts/a/" }),
        json!({ "article": "posts/a" }),
        json!({ "article": "/posts/../a/" }),
        json!({ "topic": "x" }),
        json!("tides"),
    ] {
        assert_eq!(
            code(&submission(json!({ "about": about }))),
            ErrorCode::InvalidAbout
        );
    }
    let about = parse(&submission(json!({ "about": { "article": "/posts/a/" } }))).unwrap();
    assert_eq!(about.about, Some(About::Article("/posts/a/".into())));
}

#[test]
fn unsafe_urls_are_refused_and_safe_ones_normalized() {
    for url in [
        "javascript:alert(1)",
        "data:text/html,<script>1</script>",
        "file:///etc/passwd",
        "ftp://example.org/x",
        "//example.org/x",
        "example.org/x",
        "https://user:pw@example.org/x",
        "https://localhost/x",
        "https://intranet/x",
        "https://printer.local/x",
        "https://service.internal/x",
        "http://127.0.0.1/x",
        "http://10.0.0.5/x",
        "http://192.168.1.1/x",
        "http://169.254.169.254/latest",
        "http://100.64.0.1/x",
        "http://[::1]/x",
        "http://[fd00::1]/x",
        "http://[fe80::1]/x",
        "https://exa mple.org/x",
        "https://example.org/\u{202e}x",
        " https://example.org/x",
        "",
    ] {
        assert_eq!(normalize_suggestion_url(url), None, "{url:?}");
        assert_eq!(
            code(&submission(json!({ "url": url }))),
            ErrorCode::InvalidUrl,
            "{url:?}"
        );
    }
    let long = format!("https://example.org/{}", "a".repeat(2_100));
    assert_eq!(
        code(&submission(json!({ "url": long }))),
        ErrorCode::InvalidUrl
    );
    assert_eq!(
        normalize_suggestion_url("HTTPS://Example.ORG:443/a b/../c#top").as_deref(),
        None,
        "whitespace is refused, never repaired"
    );
    assert_eq!(
        normalize_suggestion_url("https://Example.ORG/a/../c").as_deref(),
        Some("https://example.org/c")
    );
    assert_eq!(
        normalize_suggestion_url("https://münchen.example/x").as_deref(),
        Some("https://xn--mnchen-3ya.example/x")
    );
}

#[test]
fn missing_metadata_is_allowed_and_named_for_the_editor() {
    let bare = receive(&submission_of(SuggestionType::Video, json!({})));
    assert_eq!(
        bare.missing_metadata(),
        ["a link or identifier", "a title", "a creator"]
    );
    let partial = receive(&submission_of(
        SuggestionType::Text,
        json!({ "url": "https://example.org/a", "hints": { "title": "T" } }),
    ));
    assert_eq!(partial.missing_metadata(), ["a creator"]);
    let question = receive(&submission_of(SuggestionType::Question, json!({})));
    assert!(question.missing_metadata().is_empty());
}

// ---------------------------------------------------------------------------
// Attribution and contact

#[test]
fn display_is_anonymous_unless_the_reader_agreed_to_show_a_name() {
    let anonymous = receive(&submission(json!({})));
    assert_eq!(anonymous.credit(), None);
    let private = receive(&submission(json!({ "attribution": { "name": "Ada" } })));
    assert_eq!(
        private.credit(),
        None,
        "a name given but not agreed to be shown"
    );
    let shown = receive(&submission(
        json!({ "attribution": { "name": "Ada", "publishName": true } }),
    ));
    assert_eq!(shown.credit(), Some("Ada"));
    assert_eq!(
        code(&submission(
            json!({ "attribution": { "publishName": true } })
        )),
        ErrorCode::ConsentWithoutName
    );
    assert_eq!(
        code(&submission(
            json!({ "attribution": { "name": "x".repeat(81) } })
        )),
        ErrorCode::InvalidName
    );
    assert_eq!(
        code(&submission(
            json!({ "attribution": { "name": "a\u{202e}b" } })
        )),
        ErrorCode::InvalidName
    );
    assert_eq!(
        code(&submission(
            json!({ "attribution": { "name": "Ada", "email": "a@b.c" } })
        )),
        ErrorCode::Malformed
    );
}

#[test]
fn contact_is_optional_consented_and_never_printed() {
    assert!(receive(&submission(json!({}))).submission.contact.is_none());
    let with = receive(&submission(
        json!({ "contact": { "address": "ada@example.org", "followUp": true } }),
    ));
    let debug = format!("{with:?}");
    assert!(!debug.contains("ada@example.org"), "{debug}");
    assert!(debug.contains("<private>"));
    assert_eq!(
        code(&submission(
            json!({ "contact": { "address": "ada@example.org", "followUp": false } })
        )),
        ErrorCode::ContactWithoutConsent
    );
    assert_eq!(
        code(&submission(
            json!({ "contact": { "address": "ada@example.org" } })
        )),
        ErrorCode::Malformed
    );
    for address in [
        "",
        "ada",
        "ada@",
        "@example.org",
        "ada@example",
        "Ada <ada@example.org>",
        "ada@example.org, bob@example.org",
        "ada @example.org",
        "ada@exa mple.org",
        "ada..b@example.org",
        ".ada@example.org",
        "ada@-example.org",
        "ada@example..org",
        "\"ada\"@example.org",
        "ada@example.org\r\nBcc: x@y.z",
        "ada@exämple.org",
    ] {
        assert_eq!(
            code(&submission(
                json!({ "contact": { "address": address, "followUp": true } })
            )),
            ErrorCode::InvalidContact,
            "{address:?}"
        );
    }
}

#[test]
fn contact_and_an_unshown_name_reach_only_the_site_admin_and_the_submitter() {
    let record = receive(&submission(json!({
        "attribution": { "name": "Ada" },
        "contact": { "address": "ada@example.org", "followUp": true }
    })));
    let item = facts(ModerationState::Approved);
    for (actor, sees) in [
        (ADMIN, true),
        (Actor::Submitter, true),
        (COORDINATOR, false),
        (CONTRIBUTOR, false),
        (Actor::Public, false),
        (Actor::System, false),
    ] {
        let view = record.editor_view(&actor, &item, ParticipationMode::Open);
        assert_eq!(view.contact.is_some(), sees, "{actor:?}");
        assert_eq!(view.name.is_some(), sees, "{actor:?}");
        assert_eq!(view.text, record.submission.text);
        assert_eq!(view.notice, ACCEPTANCE_NOTICE);
        assert!(!format!("{view:?}").contains("ada@example.org") || sees);
        assert_eq!(
            may_view(
                &actor,
                &item,
                ParticipationMode::Open,
                View::PrivateIdentity
            ),
            sees
        );
    }
    // A name the reader agreed to show is not private.
    let shown = receive(&submission(
        json!({ "attribution": { "name": "Ada", "publishName": true } }),
    ));
    let view = shown.editor_view(&COORDINATOR, &item, ParticipationMode::Open);
    assert_eq!(view.name.as_deref(), Some("Ada"));
}

// ---------------------------------------------------------------------------
// The stored row

#[test]
fn a_stored_row_reads_back_to_the_same_suggestion() {
    let record = receive(&submission(json!({
        "type": "source",
        "url": "https://example.org/archive",
        "hints": { "title": "Survey archive" },
        "about": { "series": "tides" },
        "attribution": { "name": "Ada", "publishName": false },
        "contact": { "address": "ada@example.org", "followUp": true }
    })));
    let details = record.stored_details();
    assert_eq!(details["type"], "source");
    assert!(details.get("name").is_none() && details.get("attribution").is_none());
    let receipt = serde_json::from_str::<Value>(&record.to_json()).unwrap()["receipt"].clone();
    let back = Suggestion::from_stored(
        &record.submission.text,
        record.revision,
        &details,
        &receipt,
        &record.submission.attribution,
    )
    .unwrap();
    assert_eq!(back, record);
    // A stored row is as strict as a submission.
    let mut bad = details.clone();
    bad["rank"] = json!(1);
    assert!(
        Suggestion::from_stored("t", 1, &bad, &receipt, &ReaderAttribution::default()).is_err()
    );
    assert!(
        Suggestion::from_stored("t", 0, &details, &receipt, &ReaderAttribution::default()).is_err()
    );
    let mut bad_receipt = receipt.clone();
    bad_receipt["work"] = json!("https://elsewhere.example/");
    assert_eq!(
        Suggestion::from_stored(
            "t",
            1,
            &details,
            &bad_receipt,
            &ReaderAttribution::default()
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidWork
    );
    // Reading a record newer than this version is refused, not guessed.
    let mut newer: Value = serde_json::from_str(&record.to_json()).unwrap();
    newer["version"] = json!(2);
    assert_eq!(
        Suggestion::from_json(&newer.to_string()).unwrap_err().code,
        ErrorCode::UnsupportedVersion
    );
    // A clarified text is the next revision and changes nothing else.
    let clarified = record.clarified("Here is what I meant.").unwrap();
    assert_eq!(clarified.revision, 2);
    assert_eq!(clarified.submission.url, record.submission.url);
    assert!(record.clarified("").is_err());
}

// ---------------------------------------------------------------------------
// Duplicates

#[test]
fn the_same_source_sent_again_is_grouped_for_the_editor_and_never_counted() {
    let url = |value: &str| {
        receive(&submission_of(
            SuggestionType::Text,
            json!({ "url": value }),
        ))
    };
    let a = url("https://www.example.org/paper/?utm_source=x&b=2&a=1#intro");
    let b = url("http://example.org/paper?a=1&b=2");
    let c = url("https://example.org/other");
    let doi_a = receive(&submission(
        json!({ "hints": { "identifiers": [{ "scheme": "doi", "value": "10.1234/ABC" }] } }),
    ));
    let doi_b = receive(&submission(
        json!({ "hints": { "identifiers": [{ "scheme": "doi", "value": "https://doi.org/10.1234/abc" }] } }),
    ));
    let isbn_a = receive(&submission(
        json!({ "hints": { "identifiers": [{ "scheme": "isbn", "value": "978-0-306-40615-7" }] } }),
    ));
    let isbn_b = receive(&submission(
        json!({ "hints": { "identifiers": [{ "scheme": "isbn", "value": "9780306406157" }] } }),
    ));
    let none = receive(&submission(json!({})));
    assert_eq!(source_key(&a.submission), source_key(&b.submission));
    assert_ne!(source_key(&a.submission), source_key(&c.submission));
    assert_eq!(source_key(&none.submission), None);
    let groups = duplicate_groups(&[
        ("z-isbn-2", &isbn_b),
        ("m-url-1", &a),
        ("n-url-2", &b),
        ("c", &c),
        ("k-doi-1", &doi_a),
        ("a-isbn-1", &isbn_a),
        ("l-doi-2", &doi_b),
        ("none", &none),
    ]);
    assert_eq!(
        groups,
        vec![
            vec!["a-isbn-1".to_string(), "z-isbn-2".to_string()],
            vec!["k-doi-1".to_string(), "l-doi-2".to_string()],
            vec!["m-url-1".to_string(), "n-url-2".to_string()],
        ]
    );
    // An identifier outranks a link, so one source with both stays one source.
    let both = receive(&submission(json!({
        "url": "https://example.org/other",
        "hints": { "identifiers": [{ "scheme": "doi", "value": "10.1234/abc" }] }
    })));
    assert_eq!(source_key(&both.submission), source_key(&doi_a.submission));
}

// ---------------------------------------------------------------------------
// The one participation and moderation policy

#[test]
fn the_kind_is_one_more_row_of_the_registry_and_never_public() {
    assert_eq!(ParticipationKind::from_id("future-suggestion"), Some(KIND));
    let rules = KIND.rules();
    assert!(!rules.publishable && rules.editorial && rules.clarification);
    for state in ModerationState::ALL {
        for mode in ParticipationMode::ALL {
            assert!(!is_public(&facts(state), mode), "{state:?} {mode:?}");
        }
    }
}

#[test]
fn a_submission_is_pending_only_where_the_mode_is_open_and_anyone_may_send_one() {
    let policy = ModerationPolicy::default();
    let new = |mode, actor| NewItem {
        id: "item-1",
        actor,
        kind: KIND,
        work: Some(WORK),
        mode,
        parent: None,
        parent_target: None,
        author_grant: None,
        clarification_consent: true,
        at: received(),
    };
    let admitted = policy
        .admit(&new(ParticipationMode::Open, Actor::Public))
        .unwrap();
    assert_eq!(admitted.state, ModerationState::Pending);
    assert!(admitted.clarification_consent);
    assert_eq!(
        policy
            .admit(&new(ParticipationMode::Hidden, Actor::Public))
            .unwrap_err(),
        PolicyError::Unavailable
    );
    assert_eq!(
        policy
            .admit(&new(ParticipationMode::Locked, Actor::Public))
            .unwrap_err(),
        PolicyError::Closed
    );
    assert_eq!(
        policy
            .admit(&new(ParticipationMode::Open, ADMIN))
            .unwrap_err(),
        PolicyError::Denied,
        "the author side never submits as a reader"
    );
}

#[test]
fn acceptance_admits_to_the_queue_and_publishes_nothing_and_is_kept() {
    let pending = facts(ModerationState::Pending);
    let accepted = decide(ADMIN, ModerationAction::Approve, &pending, None).unwrap();
    assert_eq!(accepted.item.to, ModerationState::Approved);
    let approved = facts(ModerationState::Approved);
    assert!(!is_public(&approved, ParticipationMode::Open));
    // An accepted idea is not purged on the closed-item clock.
    let policy = ModerationPolicy::default();
    assert_eq!(
        policy.retention_due(&approved, time("2030-01-01T00:00:00Z")),
        None
    );
    // An editor can close it again, with a decline reason, and then the
    // ordinary closed-item retention applies.
    let removed = decide(
        COORDINATOR,
        ModerationAction::Remove,
        &approved,
        Some(ReasonCode::OffTopic),
    )
    .unwrap();
    assert_eq!(removed.item.to, ModerationState::Removed);
    let closed = ItemFacts {
        state: ModerationState::Removed,
        approved_revision: None,
        ..approved
    };
    assert_eq!(
        policy.retention_due(&closed, time("2030-01-01T00:00:00Z")),
        Some(RetentionStep::PurgeContent)
    );
    // A contributing author and the public never decide.
    for actor in [CONTRIBUTOR, Actor::Public, Actor::Submitter] {
        assert_eq!(
            decide(actor, ModerationAction::Approve, &pending, None).unwrap_err(),
            PolicyError::Denied
        );
    }
    // The text a clarification request asked about is never accepted.
    let asked = ItemFacts {
        clarification_asked: Some(1),
        ..pending
    };
    assert_eq!(
        decide(ADMIN, ModerationAction::Approve, &asked, None).unwrap_err(),
        PolicyError::NotAllowed
    );
    assert!(ACCEPTANCE_NOTICE.contains("does not mean they agree"));
    assert!(ACCEPTANCE_NOTICE.contains("permission"));
}

#[test]
fn the_reader_may_withdraw_and_a_purged_suggestion_cannot_be_acted_on() {
    for state in [
        ModerationState::Pending,
        ModerationState::Clarification,
        ModerationState::Approved,
    ] {
        let item = facts(state);
        let withdrawn = decide(Actor::Submitter, ModerationAction::Withdraw, &item, None).unwrap();
        assert_eq!(withdrawn.item.to, ModerationState::Withdrawn, "{state:?}");
        // The audit event names no text, name or contact.
        let audit = withdrawn.item.audit.to_json().to_string();
        assert!(!audit.contains("@") && !audit.contains("Ada"), "{audit}");
    }
    let policy = ModerationPolicy::default();
    let withdrawn = facts(ModerationState::Withdrawn);
    assert_eq!(
        policy.retention_due(&withdrawn, received()),
        Some(RetentionStep::PurgeContent)
    );
    let purged = ItemFacts {
        content_retained: false,
        ..facts(ModerationState::Approved)
    };
    assert_eq!(
        decide(
            ADMIN,
            ModerationAction::Remove,
            &purged,
            Some(ReasonCode::Other)
        )
        .unwrap_err(),
        PolicyError::ContentPurged
    );
    // Standing says it plainly.
    assert_eq!(
        Standing::of(ModerationState::Withdrawn, &[]),
        Standing::Withdrawn
    );
    assert_eq!(
        Standing::of(ModerationState::Pending, &[]),
        Standing::Received
    );
    assert_eq!(
        Standing::of(ModerationState::Clarification, &[]),
        Standing::NeedsClarification
    );
    assert_eq!(
        Standing::of(ModerationState::Approved, &[]),
        Standing::Interested
    );
    assert_eq!(
        Standing::of(ModerationState::Rejected, &[]),
        Standing::Declined
    );
    assert_eq!(
        Standing::of(ModerationState::Removed, &[]),
        Standing::Declined
    );
    assert!(!Standing::Interested.label().to_lowercase().contains("true"));
}

// ---------------------------------------------------------------------------
// Conversion and the Source Library

#[test]
fn only_an_accepted_suggestion_can_be_linked_and_the_link_carries_nothing_of_the_reader() {
    let at = time("2026-11-01T09:00:00Z");
    let approved = facts(ModerationState::Approved);
    let link = convert(
        &ADMIN,
        &approved,
        &[],
        ConversionKind::Draft,
        "tide-tables",
        at,
    )
    .unwrap();
    assert_eq!(link.by, "owner");
    let text = link.to_value().to_string();
    for private in ["Ada", "ada@example.org", "survey", "letters"] {
        assert!(!text.contains(private), "{text}");
    }
    assert_eq!(Conversion::from_value(&link.to_value()).unwrap(), link);
    assert_eq!(
        Standing::of(ModerationState::Approved, std::slice::from_ref(&link)),
        Standing::Converted
    );

    for state in [
        ModerationState::Pending,
        ModerationState::Clarification,
        ModerationState::Rejected,
        ModerationState::Removed,
        ModerationState::Withdrawn,
    ] {
        assert_eq!(
            convert(
                &ADMIN,
                &facts(state),
                &[],
                ConversionKind::Series,
                "tides",
                at
            )
            .unwrap_err(),
            ConversionError::NotAccepted,
            "{state:?}"
        );
    }
    let purged = ItemFacts {
        content_retained: false,
        ..approved
    };
    assert_eq!(
        convert(&ADMIN, &purged, &[], ConversionKind::Series, "tides", at).unwrap_err(),
        ConversionError::NotAccepted
    );
    for actor in [CONTRIBUTOR, Actor::Public, Actor::Submitter, Actor::System] {
        assert_eq!(
            convert(&actor, &approved, &[], ConversionKind::Series, "tides", at).unwrap_err(),
            ConversionError::Denied
        );
    }
    let other = ItemFacts {
        kind: ParticipationKind::Question,
        ..approved
    };
    assert_eq!(
        convert(&ADMIN, &other, &[], ConversionKind::Series, "tides", at).unwrap_err(),
        ConversionError::WrongKind
    );
    assert_eq!(
        convert(
            &ADMIN,
            &approved,
            &[],
            ConversionKind::Series,
            "Not A Slug",
            at
        )
        .unwrap_err(),
        ConversionError::InvalidTarget
    );
    assert_eq!(
        convert(
            &ADMIN,
            &approved,
            std::slice::from_ref(&link),
            ConversionKind::Draft,
            "tide-tables",
            at
        )
        .unwrap_err(),
        ConversionError::AlreadyLinked
    );
    // The same id under another kind is another target.
    assert!(convert(
        &ADMIN,
        &approved,
        std::slice::from_ref(&link),
        ConversionKind::Series,
        "tide-tables",
        at
    )
    .is_ok());
    let many: Vec<Conversion> = (0..MAX_CONVERSIONS)
        .map(|n| Conversion {
            id: format!("d{n}"),
            ..link.clone()
        })
        .collect();
    assert_eq!(
        convert(
            &ADMIN,
            &approved,
            &many,
            ConversionKind::Draft,
            "one-more",
            at
        )
        .unwrap_err(),
        ConversionError::TooMany
    );
    // A stored link is read as strictly as a submission.
    let mut bad = link.to_value();
    bad["name"] = json!("Ada");
    assert!(Conversion::from_value(&bad).is_err());
    let mut bad = link.to_value();
    bad["kind"] = json!("episode");
    assert!(Conversion::from_value(&bad).is_err());
}

#[test]
fn a_library_candidate_is_unverified_hints_and_only_for_an_author_of_an_accepted_suggestion() {
    let record = receive(&submission(json!({
        "type": "text",
        "url": "https://example.org/survey",
        "hints": { "title": "The 1850 survey", "creators": ["A. Surveyor"], "year": "1850" },
        "attribution": { "name": "Ada", "publishName": true },
        "contact": { "address": "ada@example.org", "followUp": true }
    })));
    let approved = facts(ModerationState::Approved);
    let candidate = library_candidate(&record, &COORDINATOR, &approved).unwrap();
    assert!(candidate.unverified);
    assert_eq!(candidate.hints.title.as_deref(), Some("The 1850 survey"));
    let text = format!("{candidate:?}");
    for private in ["Ada", "ada@example.org", "letters"] {
        assert!(!text.contains(private), "{text}");
    }
    assert_eq!(
        library_candidate(&record, &COORDINATOR, &facts(ModerationState::Pending)).unwrap_err(),
        ConversionError::NotAccepted
    );
    assert_eq!(
        library_candidate(&record, &CONTRIBUTOR, &approved).unwrap_err(),
        ConversionError::Denied
    );
    let question = receive(&submission_of(SuggestionType::Question, json!({})));
    assert_eq!(
        library_candidate(&question, &ADMIN, &approved).unwrap_err(),
        ConversionError::WrongKind
    );
}

#[test]
fn nothing_in_the_record_reaches_the_source_library_or_any_public_output() {
    // The module neither reads nor writes the library or any publication
    // projection: it may only borrow the library's identifier check.
    let source = include_str!("../src/future_suggestion.rs");
    for forbidden in [
        "SourceLibrary",
        "SourceRecord",
        "SourceIndex",
        "std::fs",
        "publication_boundary",
        "OutputFile",
        "feeds",
        "render::",
    ] {
        assert!(
            !source.contains(forbidden),
            "future_suggestion.rs mentions {forbidden}"
        );
    }
    assert!(source.contains("use crate::source_library::check_identifier;"));
}

//! Third Perspective contracts (ADRs 0106 to 0109): response categories,
//! the four distinct stages, consent records, the lifecycle on the one
//! moderation state machine, and the one public projection.

use openblog_core::third_perspective::{
    ApprovalRequest, ConsentChange, ConsentChoices, ConsentOutcome, ErrorCode, FeatureSelection,
    Intake, LifecycleError, LocalReflection, ModerationFacts, ModerationState, PerspectiveTarget,
    PublishedWork, ReaderAttribution, ResponseCategory, Stage, SubmissionRequest, SubmittedCopy,
    TargetStatus, KIND_ID, KIND_LABEL, MAX_BODY_CHARS, MAX_CONSENT_RECORDS, READER_ROLE,
};
use openblog_core::DateTime;
use serde_json::{json, Value};

const REV_A: &str = "p1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REV_B: &str = "p1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST: &str = "0123456789abcdef0123456789abcdef";

fn receipt() -> String {
    "5e".repeat(32)
}

fn time(value: &str) -> DateTime {
    DateTime::parse(value).expect("test time")
}

fn received() -> DateTime {
    time("2026-10-26T10:00:00Z")
}

fn hosted() -> Intake {
    Intake::Hosted {
        receipt_digest: receipt(),
    }
}

fn local(attribution: ReaderAttribution) -> LocalReflection {
    LocalReflection {
        work: "/posts/tides/".into(),
        revision: REV_A.into(),
        target: PerspectiveTarget::Work,
        category: None,
        body: "Another way to read the ending.".into(),
        attribution,
        seen_at: None,
    }
}

fn consent(clarification: bool, feature: bool) -> ConsentChoices {
    ConsentChoices {
        publish: true,
        clarification,
        feature,
    }
}

fn submitted(attribution: ReaderAttribution) -> SubmittedCopy {
    local(attribution)
        .submission(consent(true, false))
        .receive(received(), hosted())
        .expect("a valid submission")
}

fn facts(state: ModerationState) -> ModerationFacts {
    let approved = state == ModerationState::Approved;
    ModerationFacts {
        state,
        revision: 1,
        approved_revision: approved.then_some(1),
        approved_consent: approved.then_some(1),
        content_retained: true,
    }
}

fn approved_at(revision: u32, consent: u32) -> ModerationFacts {
    ModerationFacts {
        state: ModerationState::Approved,
        revision,
        approved_revision: Some(revision),
        approved_consent: Some(consent),
        content_retained: true,
    }
}

fn tides() -> PublishedWork {
    PublishedWork {
        path: "/posts/tides/".into(),
        revision: REV_A.into(),
        credited: vec!["Ada Lovelace".into(), "Grace Hopper".into()],
    }
}

fn whole() -> TargetStatus {
    TargetStatus::Current { section: None }
}

fn change(publish: bool, attribution: ReaderAttribution) -> ConsentChange {
    ConsentChange {
        publish,
        attribution,
        clarification: true,
        feature: false,
    }
}

fn request_json(overrides: Value) -> String {
    let mut request = json!({
        "version": 1,
        "kind": "third-perspective",
        "work": "/posts/tides/",
        "revision": REV_A,
        "target": {"version": 1, "kind": "work"},
        "body": "Another way to read the ending.",
        "consent": {"publish": true}
    });
    for (key, value) in overrides.as_object().expect("overrides object") {
        if value.is_null() {
            request.as_object_mut().unwrap().remove(key);
        } else {
            request[key] = value.clone();
        }
    }
    request.to_string()
}

fn request_error(overrides: Value) -> ErrorCode {
    match SubmissionRequest::from_json(&request_json(overrides)) {
        Ok(request) => {
            request
                .receive(received(), hosted())
                .expect_err("the request is refused")
                .code
        }
        Err(error) => error.code,
    }
}

// ---------------------------------------------------------------------------
// State fixtures

fn fixture_facts(value: &Value) -> ModerationFacts {
    let number = |key: &str| value[key].as_u64().map(|n| n as u32);
    ModerationFacts {
        state: ModerationState::from_id(value["state"].as_str().unwrap()).expect("state id"),
        revision: number("revision").unwrap(),
        approved_revision: number("approvedRevision"),
        approved_consent: number("approvedConsent"),
        content_retained: value["contentRetained"].as_bool().unwrap(),
    }
}

fn fixture_work(value: Option<&Value>) -> PublishedWork {
    match value {
        None => tides(),
        Some(value) => PublishedWork {
            path: value["path"].as_str().unwrap().into(),
            revision: value["revision"].as_str().unwrap().into(),
            credited: value["credited"]
                .as_array()
                .unwrap()
                .iter()
                .map(|name| name.as_str().unwrap().to_string())
                .collect(),
        },
    }
}

fn fixture_target(value: Option<&Value>, record: &Value) -> TargetStatus {
    match value {
        None => TargetStatus::Current {
            section: record["provenance"]["target"]["section"]
                .as_str()
                .map(str::to_string),
        },
        Some(value) => match value["state"].as_str().unwrap() {
            "current" => TargetStatus::Current {
                section: value["section"].as_str().map(str::to_string),
            },
            "stale" => TargetStatus::Stale {
                section_present: value["sectionPresent"].as_bool().unwrap(),
            },
            other => panic!("unknown target state {other}"),
        },
    }
}

#[test]
fn state_fixtures_give_each_copy_its_stage_and_only_its_public_form() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/third-perspective-states.json")).unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 30);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let record = &case["record"];
        let copy = SubmittedCopy::from_json(&record.to_string())
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let canonical: Value = serde_json::from_str(&copy.to_json()).unwrap();
        assert_eq!(&canonical, record, "{name}: the record is canonical");

        let facts = fixture_facts(&case["moderation"]);
        let shown = case.get("shown").and_then(Value::as_bool).unwrap_or(true);
        let work = fixture_work(case.get("work"));
        let target = fixture_target(case.get("target"), record);
        let expect = &case["expect"];

        assert_eq!(
            Stage::of(&facts).id(),
            expect["stage"].as_str().unwrap(),
            "{name}: stage"
        );
        let public = copy.approved_response(&facts, shown, &work, &target);
        let public_json = public
            .as_ref()
            .map(|response| serde_json::from_str::<Value>(&response.to_json()).unwrap())
            .unwrap_or(Value::Null);
        assert_eq!(public_json, expect["public"], "{name}: public projection");

        if let Some(response) = &public {
            assert_eq!(response.role, READER_ROLE, "{name}: always a reader");
            let text = response.to_json();
            for private in [
                receipt().as_str(),
                "mikey",
                "09:41",
                "seenAt",
                "receivedAt",
                "consents",
                "intake",
                "revision\"",
                "publishName",
                "hosted",
                "manual",
            ] {
                assert!(!text.contains(private), "{name}: `{private}` is private");
            }
            for credit in &work.credited {
                assert!(
                    !text.contains(credit.as_str()),
                    "{name}: never an author's name"
                );
                assert!(!response.heading().contains(credit.as_str()));
            }
            let private_name = copy.consent().attribution.name.clone();
            if response.name.is_none() {
                if let Some(private_name) = private_name {
                    assert!(!text.contains(&private_name), "{name}: unpublished name");
                }
            }
        }

        if let Some(feature) = case.get("feature") {
            let selection = FeatureSelection {
                selected_by: feature["selectedBy"].as_str().unwrap().into(),
                revision: feature["revision"].as_u64().unwrap() as u32,
            };
            let featured = copy.featured(&facts, shown, &work, &target, &selection);
            assert_eq!(
                featured.is_some(),
                expect["featured"].as_bool().unwrap(),
                "{name}: featured"
            );
            if let Some(featured) = featured {
                assert_eq!(Some(&featured.response), public.as_ref());
            }
        }
        if let Some(matches) = expect.get("nameMatchesCredit") {
            assert_eq!(
                copy.name_matches_credit(&work.credited),
                matches.as_bool().unwrap(),
                "{name}: moderation hint"
            );
        }
    }
}

#[test]
fn state_fixtures_cover_every_required_situation() {
    let fixture = include_str!("fixtures/third-perspective-states.json");
    for situation in [
        "withdrawal",
        "revised consent",
        "deleted",
        "rejected content",
        "stale article",
        "group-authored work",
    ] {
        assert!(fixture.contains(situation), "a fixture covers {situation}");
    }
}

// ---------------------------------------------------------------------------
// Response categories

#[test]
fn categories_are_optional_descriptive_prompts_never_scores_or_sides() {
    let copy = submitted(ReaderAttribution::anonymous());
    assert_eq!(
        copy.category, None,
        "a reflection without a category is complete"
    );
    let public = copy
        .approved_response(&facts(ModerationState::Approved), true, &tides(), &whole())
        .unwrap();
    assert!(!public.to_json().contains("category"));

    let verdicts = [
        "agree", "disagree", "correct", "wrong", "right", "better", "best", "worse", "vote",
        "score", "rating", "rank", "like", "winner", "side", "author", "true", "false", "verdict",
    ];
    for category in ResponseCategory::ALL {
        assert_eq!(ResponseCategory::from_id(category.id()), Some(category));
        for text in [category.id(), category.label(), category.prompt()] {
            let words: Vec<String> = text
                .to_lowercase()
                .split(|c: char| !c.is_alphanumeric())
                .map(str::to_string)
                .collect();
            for verdict in verdicts {
                assert!(
                    !words.iter().any(|word| word == verdict),
                    "`{text}` reads as a verdict or a side ({verdict})"
                );
            }
        }
        let request = request_json(json!({"category": category.id()}));
        let copy = SubmissionRequest::from_json(&request)
            .unwrap()
            .receive(received(), hosted())
            .unwrap();
        assert_eq!(copy.category, Some(category));
    }
    assert_eq!(
        request_error(json!({"category": "agree-with-ada"})),
        ErrorCode::UnknownCategory
    );
    assert_eq!(request_error(json!({"category": 3})), ErrorCode::Malformed);
}

// ---------------------------------------------------------------------------
// Four distinct stages

#[test]
fn local_reflection_submitted_copy_approved_response_and_featured_publication_are_distinct() {
    let draft = local(ReaderAttribution::named("Mina Okafor", true));
    assert_eq!(draft.stage(), Stage::Local);

    let mut copy = draft
        .submission(consent(true, false))
        .receive(received(), hosted())
        .unwrap();
    let pending = facts(ModerationState::Pending);
    assert_eq!(Stage::of(&pending), Stage::Submitted);
    assert_eq!(
        copy.approved_response(&pending, true, &tides(), &whole()),
        None,
        "a submitted copy is private"
    );

    let binding = copy
        .check_approval(
            &pending,
            &ApprovalRequest {
                moderator: "mikey",
                seen_revision: 1,
                seen_consent: 1,
                at: time("2026-10-26T12:00:00Z"),
            },
        )
        .unwrap();
    assert_eq!((binding.revision, binding.consent), (1, 1));
    assert_eq!(binding.approved_by, "mikey");

    let approved = approved_at(binding.revision, binding.consent);
    let response = copy
        .approved_response(&approved, true, &tides(), &whole())
        .expect("an approved response");
    assert_eq!(response.name.as_deref(), Some("Mina Okafor"));
    assert_eq!(
        response.heading(),
        "Third Perspective from Mina Okafor, a reader"
    );

    let selection = FeatureSelection {
        selected_by: "mikey".into(),
        revision: 1,
    };
    assert_eq!(
        copy.featured(&approved, true, &tides(), &whole(), &selection),
        None,
        "approval alone never features a reflection"
    );
    let outcome = copy
        .revise_consent(
            &approved,
            ConsentChange {
                feature: true,
                ..change(true, ReaderAttribution::named("Mina Okafor", true))
            },
            time("2026-10-27T08:00:00Z"),
        )
        .unwrap();
    assert_eq!(outcome, ConsentOutcome::Recorded);
    assert_eq!(copy.consent().feature_revision, Some(1));
    let featured = copy
        .featured(&approved, true, &tides(), &whole(), &selection)
        .expect("featured with consent for the approved revision");
    assert_eq!(featured.response, response);
    assert!(featured.to_json().starts_with("{\"response\":{"));
    assert_eq!(
        copy.featured(
            &approved,
            true,
            &tides(),
            &whole(),
            &FeatureSelection {
                selected_by: String::new(),
                revision: 1
            }
        ),
        None,
        "a feature names the editor who chose it"
    );
}

// ---------------------------------------------------------------------------
// Anonymous display, never anonymous provenance

#[test]
fn anonymous_display_keeps_full_moderation_provenance() {
    let copy = submitted(ReaderAttribution::anonymous());
    let record: Value = serde_json::from_str(&copy.to_json()).unwrap();
    assert_eq!(record["intake"]["receiptDigest"], json!(receipt()));
    assert_eq!(record["provenance"]["channel"], json!("hosted"));
    assert_eq!(
        record["provenance"]["receivedAt"],
        json!("2026-10-26T10:00:00Z")
    );
    assert_eq!(record["provenance"]["revision"], json!(REV_A));

    let public = copy
        .approved_response(&facts(ModerationState::Approved), true, &tides(), &whole())
        .unwrap();
    assert_eq!(public.name, None);
    assert_eq!(public.heading(), "Third Perspective from a reader");
    assert!(!public.to_json().contains(&receipt()));

    let manual = local(ReaderAttribution::anonymous())
        .submission(consent(false, false))
        .receive(
            received(),
            Intake::Manual {
                entered_by: "mikey".into(),
            },
        )
        .unwrap();
    assert!(manual.to_json().contains("\"enteredBy\":\"mikey\""));
    assert!(manual.to_json().contains("\"channel\":\"manual\""));
}

#[test]
fn a_copy_without_provenance_of_who_can_act_for_it_is_refused() {
    let record: Value =
        serde_json::from_str(&submitted(ReaderAttribution::anonymous()).to_json()).unwrap();
    let refused = |edit: &dyn Fn(&mut Value)| {
        let mut record = record.clone();
        edit(&mut record);
        SubmittedCopy::from_json(&record.to_string())
            .expect_err("refused")
            .code
    };
    assert_eq!(
        refused(&|r| {
            r.as_object_mut().unwrap().remove("intake");
        }),
        ErrorCode::Malformed
    );
    assert_eq!(
        refused(&|r| r["intake"] = json!({})),
        ErrorCode::InvalidIntake
    );
    assert_eq!(
        refused(&|r| r["intake"] = json!({"receiptDigest": receipt(), "enteredBy": "mikey"})),
        ErrorCode::InvalidIntake
    );
    assert_eq!(
        refused(&|r| r["intake"] = json!({"receiptDigest": "not-a-digest"})),
        ErrorCode::InvalidIntake
    );
    assert_eq!(
        refused(&|r| r["intake"] = json!({"enteredBy": "mikey"})),
        ErrorCode::InvalidIntake,
        "a manual intake on a hosted copy"
    );
    assert_eq!(
        refused(&|r| {
            r["intake"] = json!({"enteredBy": "Not An Admin"});
            r["provenance"]["channel"] = json!("manual");
        }),
        ErrorCode::InvalidIntake
    );
    assert_eq!(
        refused(&|r| r["intake"]["receiptToken"] = json!("secret")),
        ErrorCode::Malformed,
        "no other identity rides along"
    );
    assert_eq!(
        refused(&|r| r["provenance"]["email"] = json!("reader@example.com")),
        ErrorCode::Malformed
    );
}

#[test]
fn every_approval_names_its_moderator() {
    let copy = submitted(ReaderAttribution::anonymous());
    let pending = facts(ModerationState::Pending);
    for moderator in ["", " ", "two words", "tab\there"] {
        assert_eq!(
            copy.check_approval(
                &pending,
                &ApprovalRequest {
                    moderator,
                    seen_revision: 1,
                    seen_consent: 1,
                    at: received(),
                },
            ),
            Err(LifecycleError::AnonymousModerator)
        );
    }
}

// ---------------------------------------------------------------------------
// Submission format and content limits

#[test]
fn submissions_are_bounded_plain_text_with_consent_to_publish() {
    let copy = SubmissionRequest::from_json(&request_json(json!({
        "body": "  First line.\r\n\r\nSecond\rline.\t  ",
        "attribution": {"name": "  Mina   Okafor ", "publishName": true},
        "seenAt": "2026-10-26T11:00:00Z",
        "consent": {"publish": true, "clarification": true}
    })))
    .unwrap()
    .receive(received(), hosted())
    .unwrap();
    assert_eq!(copy.body, "First line.\n\nSecond\nline.");
    assert_eq!(
        copy.consent().attribution.name.as_deref(),
        Some("Mina Okafor")
    );
    assert_eq!(
        copy.provenance.seen_at, None,
        "a reader clock ahead is dropped"
    );
    assert!(copy.consent().clarification);
    assert_eq!(copy.consent().feature_revision, None);

    let long = "a".repeat(MAX_BODY_CHARS + 1);
    let longest = "é".repeat(MAX_BODY_CHARS);
    assert!(
        SubmissionRequest::from_json(&request_json(json!({"body": longest})))
            .unwrap()
            .receive(received(), hosted())
            .is_ok()
    );
    assert_eq!(request_error(json!({"body": long})), ErrorCode::InvalidBody);
    assert_eq!(
        request_error(json!({"body": " \n "})),
        ErrorCode::InvalidBody
    );
    assert_eq!(
        request_error(json!({"body": "bell\u{7}"})),
        ErrorCode::InvalidBody
    );
    assert_eq!(
        request_error(json!({"body": "flip\u{202e}"})),
        ErrorCode::InvalidBody
    );
    assert_eq!(
        request_error(json!({"attribution": {"name": "x".repeat(81), "publishName": true}})),
        ErrorCode::InvalidName
    );
    assert_eq!(
        request_error(json!({"attribution": {"publishName": true}})),
        ErrorCode::ConsentWithoutName
    );
    assert_eq!(
        request_error(json!({"consent": {"publish": false}})),
        ErrorCode::PublicationConsentRequired
    );
    assert_eq!(request_error(json!({"consent": {}})), ErrorCode::Malformed);
    assert_eq!(
        request_error(json!({"consent": null})),
        ErrorCode::Malformed
    );
    assert_eq!(request_error(json!({"vote": "ada"})), ErrorCode::Malformed);
    assert_eq!(request_error(json!({"rating": 5})), ErrorCode::Malformed);
    assert_eq!(
        request_error(json!({"kind": "comment"})),
        ErrorCode::WrongKind
    );
    assert_eq!(
        request_error(json!({"version": 2})),
        ErrorCode::UnsupportedVersion
    );
    assert_eq!(
        request_error(json!({"work": "posts/tides"})),
        ErrorCode::InvalidWork
    );
    assert_eq!(
        request_error(json!({"revision": "r1"})),
        ErrorCode::InvalidRevision
    );
    assert_eq!(
        request_error(json!({"seenAt": "yesterday"})),
        ErrorCode::InvalidTime
    );
    assert_eq!(
        SubmissionRequest::from_json(&"x".repeat(40 * 1024))
            .unwrap_err()
            .code,
        ErrorCode::TooLarge
    );

    let request = SubmissionRequest::from_json(&request_json(json!({
        "category": "question",
        "target": {"version": 1, "kind": "section", "section": "methods", "digest": DIGEST},
        "consent": {"publish": true, "clarification": false, "feature": true}
    })))
    .unwrap();
    assert_eq!(
        SubmissionRequest::from_json(&request.to_json()).unwrap(),
        request
    );
    let copy = request.receive(received(), hosted()).unwrap();
    assert_eq!(copy.consent().feature_revision, Some(1));
}

#[test]
fn targets_use_the_passage_target_json_restricted_to_the_work_or_a_section() {
    let read = |value: Value| PerspectiveTarget::from_value(&value);
    let work = read(json!({"version": 1, "kind": "work"})).unwrap();
    assert_eq!(work, PerspectiveTarget::Work);
    assert_eq!(work.to_json(), r#"{"version":1,"kind":"work"}"#);
    let section =
        read(json!({"version": 1, "kind": "section", "section": "methods", "digest": DIGEST}))
            .unwrap();
    assert_eq!(
        section.to_json(),
        format!(r#"{{"version":1,"kind":"section","section":"methods","digest":"{DIGEST}"}}"#)
    );
    let opening = read(json!({"version": 1, "kind": "section"})).unwrap();
    assert_eq!(
        opening,
        PerspectiveTarget::Section {
            section: None,
            digest: None
        },
        "the text before the first heading"
    );

    let code = |value: Value| read(value).unwrap_err().code;
    assert_eq!(
        code(
            json!({"version": 1, "kind": "quote", "section": "methods", "exact": "tides", "prefix": "", "suffix": "", "start": 0})
        ),
        ErrorCode::TargetNotAllowed
    );
    assert_eq!(
        code(json!({"version": 1, "kind": "work", "section": "methods"})),
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        code(json!({"version": 1, "kind": "section", "exact": "tides"})),
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        code(json!({"version": 1, "kind": "section", "digest": "ABC"})),
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        code(json!({"version": 1, "kind": "section", "section": "two words"})),
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        code(json!({"version": 1, "kind": "section", "section": "x".repeat(201)})),
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        code(json!({"version": 1, "kind": "work", "note": "x"})),
        ErrorCode::InvalidTarget
    );
    assert_eq!(
        code(json!({"version": 2, "kind": "work"})),
        ErrorCode::UnsupportedVersion
    );
    assert_eq!(code(json!({"kind": "work"})), ErrorCode::InvalidTarget);
    assert_eq!(code(json!("work")), ErrorCode::InvalidTarget);
}

// ---------------------------------------------------------------------------
// Consent records and the lifecycle

#[test]
fn narrowing_consent_takes_effect_at_once_and_widening_waits_for_a_decision() {
    let mut copy = submitted(ReaderAttribution::named("Mina Okafor", true));
    let approved = facts(ModerationState::Approved);
    let later = time("2026-10-27T08:00:00Z");

    let outcome = copy
        .revise_consent(
            &approved,
            change(true, ReaderAttribution::named("Mina Okafor", false)),
            later,
        )
        .unwrap();
    assert_eq!(outcome, ConsentOutcome::Recorded);
    assert_eq!(copy.consent().number, 2);
    let public = copy
        .approved_response(&approved, true, &tides(), &whole())
        .unwrap();
    assert_eq!(public.name, None, "hiding a name applies at once");

    assert_eq!(
        copy.revise_consent(
            &approved,
            change(true, ReaderAttribution::named("Mina Okafor", true)),
            later
        ),
        Err(LifecycleError::WideningAfterDecision)
    );
    assert_eq!(
        copy.revise_consent(
            &approved,
            change(true, ReaderAttribution::named("Mina Okafor", false)),
            later
        ),
        Err(LifecycleError::Unchanged)
    );
    assert_eq!(
        copy.revise_consent(
            &approved,
            change(true, ReaderAttribution::named("Mina Okafor", false)),
            received()
        ),
        Err(LifecycleError::InvalidTime)
    );
    for state in [ModerationState::Rejected, ModerationState::Removed] {
        assert_eq!(
            copy.clone().revise_consent(
                &facts(state),
                change(true, ReaderAttribution::named("Mina Okafor", true)),
                later
            ),
            Err(LifecycleError::WideningAfterDecision)
        );
    }
    assert!(SubmittedCopy::from_json(&copy.to_json()).is_ok());
}

#[test]
fn consent_revised_before_a_decision_binds_into_the_approval() {
    let mut copy = submitted(ReaderAttribution::named("Mina Okafor", false));
    let pending = facts(ModerationState::Pending);
    copy.revise_consent(
        &pending,
        change(true, ReaderAttribution::named("Mina Okafor", true)),
        time("2026-10-26T11:00:00Z"),
    )
    .unwrap();
    let request = |seen_revision, seen_consent| ApprovalRequest {
        moderator: "mikey",
        seen_revision,
        seen_consent,
        at: time("2026-10-26T12:00:00Z"),
    };
    assert_eq!(
        copy.check_approval(&pending, &request(1, 1)),
        Err(LifecycleError::StaleConsent),
        "a moderator who saw the earlier consent must look again"
    );
    let binding = copy.check_approval(&pending, &request(1, 2)).unwrap();
    assert_eq!(binding.consent, 2);
    let public = copy
        .approved_response(&approved_at(1, 2), true, &tides(), &whole())
        .unwrap();
    assert_eq!(public.name.as_deref(), Some("Mina Okafor"));
    let public = copy
        .approved_response(&approved_at(1, 1), true, &tides(), &whole())
        .unwrap();
    assert_eq!(
        public.name, None,
        "the name was not part of what was approved"
    );
}

#[test]
fn revoking_publication_is_a_final_withdrawal() {
    let later = time("2026-10-27T08:00:00Z");
    for state in [
        ModerationState::Pending,
        ModerationState::Clarification,
        ModerationState::Approved,
    ] {
        let mut copy = submitted(ReaderAttribution::named("Mina Okafor", true));
        assert_eq!(
            copy.revise_consent(
                &facts(state),
                change(false, ReaderAttribution::anonymous()),
                later
            ),
            Ok(ConsentOutcome::Withdraw)
        );
        let revoked = copy.consent();
        assert!(!revoked.publish && !revoked.attribution.publish_name);
        assert_eq!(revoked.attribution.name.as_deref(), Some("Mina Okafor"));
        assert_eq!(
            copy.approved_response(&facts(state), true, &tides(), &whole()),
            None
        );
        assert_eq!(
            copy.revise_consent(
                &facts(state),
                change(true, ReaderAttribution::anonymous()),
                later
            ),
            Err(LifecycleError::Closed),
            "never un-revoked"
        );
        assert!(SubmittedCopy::from_json(&copy.to_json()).is_ok());
    }

    let mut rejected = submitted(ReaderAttribution::anonymous());
    assert_eq!(
        rejected.revise_consent(
            &facts(ModerationState::Rejected),
            change(false, ReaderAttribution::anonymous()),
            later
        ),
        Ok(ConsentOutcome::Recorded),
        "no withdrawal applies to rejected content, but it can never be approved again"
    );
    assert_eq!(
        rejected.check_approval(
            &facts(ModerationState::Pending),
            &ApprovalRequest {
                moderator: "mikey",
                seen_revision: 1,
                seen_consent: 2,
                at: later,
            },
        ),
        Err(LifecycleError::PublicationNotConsented),
        "reopened after revocation"
    );

    let mut withdrawn = submitted(ReaderAttribution::anonymous());
    assert_eq!(
        withdrawn.revise_consent(
            &facts(ModerationState::Withdrawn),
            change(true, ReaderAttribution::anonymous()),
            later
        ),
        Err(LifecycleError::Closed)
    );
    let purged = ModerationFacts {
        content_retained: false,
        ..facts(ModerationState::Removed)
    };
    assert_eq!(
        withdrawn.revise_consent(
            &purged,
            change(false, ReaderAttribution::anonymous()),
            later
        ),
        Err(LifecycleError::ContentPurged),
        "deleted text has no consent left to change"
    );
}

#[test]
fn feature_consent_binds_to_one_approved_revision() {
    let later = time("2026-10-27T08:00:00Z");
    let feature = ConsentChange {
        feature: true,
        ..change(true, ReaderAttribution::anonymous())
    };
    let mut copy = submitted(ReaderAttribution::anonymous());
    assert_eq!(
        copy.revise_consent(&facts(ModerationState::Rejected), feature.clone(), later),
        Err(LifecycleError::FeatureNotAvailable)
    );
    copy.revise_consent(&facts(ModerationState::Pending), feature.clone(), later)
        .unwrap();
    assert_eq!(copy.consent().feature_revision, Some(1));

    // A clarification replaces the text: the old feature consent does not
    // cover the new revision until the reader renews it.
    let clarification = facts(ModerationState::Clarification);
    let revision = copy
        .clarify(&clarification, "A clearer reading of the ending.", later)
        .unwrap();
    assert_eq!(revision, 2);
    let approved = approved_at(2, 2);
    let selection = FeatureSelection {
        selected_by: "mikey".into(),
        revision: 2,
    };
    assert_eq!(
        copy.featured(&approved, true, &tides(), &whole(), &selection),
        None
    );
    copy.revise_consent(&approved, feature, time("2026-10-28T08:00:00Z"))
        .unwrap();
    assert_eq!(copy.consent().feature_revision, Some(2));
    assert!(copy
        .featured(&approved, true, &tides(), &whole(), &selection)
        .is_some());
    assert_eq!(
        copy.featured(&approved, false, &tides(), &whole(), &selection),
        None,
        "never featured while the kind is hidden"
    );
}

#[test]
fn a_clarification_replaces_the_text_and_only_the_answer_can_be_approved() {
    let mut copy = submitted(ReaderAttribution::anonymous());
    let later = time("2026-10-27T08:00:00Z");
    for state in [
        ModerationState::Pending,
        ModerationState::Approved,
        ModerationState::Rejected,
    ] {
        assert_eq!(
            copy.clone().clarify(&facts(state), "New text.", later),
            Err(LifecycleError::NotInClarification)
        );
    }
    let clarification = facts(ModerationState::Clarification);
    assert_eq!(
        copy.clone().clarify(&clarification, "  ", later),
        Err(LifecycleError::InvalidBody)
    );
    assert_eq!(
        copy.clone()
            .clarify(&clarification, "New text.", time("2026-10-25T08:00:00Z")),
        Err(LifecycleError::InvalidTime)
    );
    copy.clarify(&clarification, "A clearer reading of the ending.", later)
        .unwrap();
    assert_eq!(copy.revision, 2);
    assert_eq!(copy.revised_at, Some(later));
    assert_eq!(
        copy.clone().clarify(&clarification, "Again.", later),
        Err(LifecycleError::OutOfStep),
        "facts from before the answer are out of step"
    );

    let pending = ModerationFacts {
        revision: 2,
        ..facts(ModerationState::Pending)
    };
    let request = |seen_revision| ApprovalRequest {
        moderator: "mikey",
        seen_revision,
        seen_consent: 1,
        at: later,
    };
    assert_eq!(
        copy.check_approval(&pending, &request(1)),
        Err(LifecycleError::StaleRevision)
    );
    assert_eq!(
        copy.check_approval(&pending, &request(2)).unwrap().revision,
        2
    );
    assert_eq!(
        copy.check_approval(&facts(ModerationState::Clarification), &request(1)),
        Err(LifecycleError::OutOfStep)
    );
    assert_eq!(
        copy.check_approval(
            &ModerationFacts {
                revision: 2,
                ..facts(ModerationState::Clarification)
            },
            &request(2)
        ),
        Err(LifecycleError::NotPending)
    );
    let stored = SubmittedCopy::from_json(&copy.to_json()).unwrap();
    assert_eq!(stored, copy);
}

#[test]
fn consent_history_is_append_only_numbered_and_bounded() {
    let record: Value =
        serde_json::from_str(&submitted(ReaderAttribution::named("Mina Okafor", true)).to_json())
            .unwrap();
    let refused = |edit: &dyn Fn(&mut Value)| {
        let mut record = record.clone();
        edit(&mut record);
        SubmittedCopy::from_json(&record.to_string())
            .expect_err("refused")
            .code
    };
    let second = |extra: Value| {
        let mut consent = json!({
            "number": 2, "givenAt": "2026-10-27T08:00:00Z", "publish": true,
            "attribution": {"publishName": false}, "clarification": false
        });
        for (key, value) in extra.as_object().unwrap() {
            consent[key] = value.clone();
        }
        consent
    };
    assert_eq!(
        refused(&|r| r["consents"] = json!([])),
        ErrorCode::InvalidConsentHistory
    );
    assert_eq!(
        refused(&|r| r["consents"][0]["attribution"]["publishName"] = json!(false)),
        ErrorCode::InvalidConsentHistory,
        "the first record is what was received"
    );
    assert_eq!(
        refused(&|r| r["consents"][0]["givenAt"] = json!("2026-10-26T09:00:00Z")),
        ErrorCode::InvalidConsentHistory
    );
    assert_eq!(
        refused(&|r| r["consents"][0]["publish"] = json!(false)),
        ErrorCode::InvalidConsentHistory
    );
    assert_eq!(
        refused(&|r| r["consents"]
            .as_array_mut()
            .unwrap()
            .push(second(json!({"number": 3})))),
        ErrorCode::InvalidConsentHistory
    );
    assert_eq!(
        refused(&|r| r["consents"]
            .as_array_mut()
            .unwrap()
            .push(second(json!({"givenAt": "2026-10-25T08:00:00Z"})))),
        ErrorCode::InvalidConsentHistory
    );
    assert_eq!(
        refused(&|r| {
            let consents = r["consents"].as_array_mut().unwrap();
            consents.push(second(json!({"publish": false})));
            consents.push(second(json!({"number": 3})));
        }),
        ErrorCode::InvalidConsentHistory,
        "nothing follows a revocation"
    );
    assert_eq!(
        refused(&|r| r["consents"]
            .as_array_mut()
            .unwrap()
            .push(second(json!({"featureRevision": 2})))),
        ErrorCode::InvalidConsentHistory
    );
    assert_eq!(
        refused(&|r| r["consents"]
            .as_array_mut()
            .unwrap()
            .push(second(json!({"attribution": {"publishName": true}})))),
        ErrorCode::ConsentWithoutName
    );
    assert_eq!(
        refused(&|r| r["revision"] = json!(2)),
        ErrorCode::InvalidTime
    );
    assert_eq!(refused(&|r| r["revision"] = json!(0)), ErrorCode::Malformed);
    assert_eq!(
        refused(&|r| r["body"] = json!(" padded ")),
        ErrorCode::InvalidBody
    );
    assert_eq!(
        refused(&|r| r["version"] = json!(2)),
        ErrorCode::UnsupportedVersion
    );
    assert_eq!(
        refused(&|r| r["provenance"]["version"] = json!(2)),
        ErrorCode::UnsupportedVersion
    );

    let mut copy = submitted(ReaderAttribution::anonymous());
    let pending = facts(ModerationState::Pending);
    for step in 0..MAX_CONSENT_RECORDS - 2 {
        copy.revise_consent(
            &pending,
            ConsentChange {
                clarification: step % 2 == 1,
                ..change(true, ReaderAttribution::anonymous())
            },
            received(),
        )
        .unwrap();
    }
    assert_eq!(
        copy.revise_consent(
            &pending,
            change(true, ReaderAttribution::named("M", false)),
            received()
        ),
        Err(LifecycleError::ConsentLimit)
    );
    assert!(SubmittedCopy::from_json(&copy.to_json()).is_ok());
    assert_eq!(copy.consents.len(), MAX_CONSENT_RECORDS - 1);
    assert_eq!(
        copy.revise_consent(
            &pending,
            change(false, ReaderAttribution::named(&"x".repeat(200), true)),
            received()
        ),
        Ok(ConsentOutcome::Withdraw),
        "revocation is always possible, whatever else the change says"
    );
    assert_eq!(copy.consents.len(), MAX_CONSENT_RECORDS);
    assert!(SubmittedCopy::from_json(&copy.to_json()).is_ok());

    let mut full: Value = serde_json::from_str(&copy.to_json()).unwrap();
    full["consents"][MAX_CONSENT_RECORDS - 1]["publish"] = json!(true);
    assert_eq!(
        SubmittedCopy::from_json(&full.to_string())
            .unwrap_err()
            .code,
        ErrorCode::InvalidConsentHistory,
        "a history that leaves no slot for revocation is refused"
    );
}

// ---------------------------------------------------------------------------
// Merge seams

#[test]
fn ids_and_json_match_the_participation_and_passage_seams() {
    assert_eq!(KIND_ID, "third-perspective");
    assert_eq!(KIND_LABEL, "Third Perspective");
    assert_eq!(
        ModerationState::ALL.map(ModerationState::id),
        [
            "pending",
            "clarification",
            "approved",
            "rejected",
            "removed",
            "withdrawn"
        ]
    );
    for state in ModerationState::ALL {
        assert_eq!(ModerationState::from_id(state.id()), Some(state));
    }
    assert_eq!(ModerationState::from_id("published"), None);

    let record: Value =
        serde_json::from_str(&submitted(ReaderAttribution::named("Mina Okafor", false)).to_json())
            .unwrap();
    let keys =
        |value: &Value| -> Vec<String> { value.as_object().unwrap().keys().cloned().collect() };
    let mut provenance = keys(&record["provenance"]);
    provenance.sort();
    assert_eq!(
        provenance,
        [
            "attribution",
            "channel",
            "receivedAt",
            "revision",
            "target",
            "version",
            "work"
        ],
        "the provenance object is B5's feedback provenance record"
    );
    let text = submitted(ReaderAttribution::anonymous()).to_json();
    assert!(
        text.contains(&format!(
            r#""provenance":{{"version":1,"work":"/posts/tides/","revision":"{REV_A}","target":{{"version":1,"kind":"work"}},"receivedAt":"2026-10-26T10:00:00Z","channel":"hosted","attribution":{{"publishName":false}}}}"#
        )),
        "provenance is written in B5's field order: {text}"
    );
    assert_eq!(
        record["provenance"]["attribution"],
        json!({"name": "Mina Okafor", "publishName": false})
    );
}

#[test]
fn stage_ids_follow_the_lifecycle() {
    assert_eq!(
        Stage::of(&facts(ModerationState::Pending)),
        Stage::Submitted
    );
    assert_eq!(
        Stage::of(&facts(ModerationState::Clarification)),
        Stage::Clarification
    );
    assert_eq!(
        Stage::of(&facts(ModerationState::Approved)),
        Stage::Approved
    );
    assert_eq!(
        Stage::of(&facts(ModerationState::Withdrawn)),
        Stage::Withdrawn
    );
    assert_eq!(
        Stage::of(&ModerationFacts {
            content_retained: false,
            ..facts(ModerationState::Pending)
        }),
        Stage::Deleted
    );
    assert_eq!(Stage::Local.id(), "local");
    let updated = PublishedWork {
        revision: REV_B.into(),
        ..tides()
    };
    let response = submitted(ReaderAttribution::anonymous())
        .approved_response(&facts(ModerationState::Approved), true, &updated, &whole())
        .unwrap();
    assert!(
        response.earlier_revision,
        "read on an earlier revision of the work"
    );
}

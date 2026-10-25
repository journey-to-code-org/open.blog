//! The layout-independent reflection structure: one model for all five modes, one reading order,
//! and safe failure (ADR 0030, 0031).

use openblog_core::collaboration::CollaborationContract;
use openblog_core::reflection::{ReflectionLayout, ReflectionStructure};

fn contract(participants: usize, contributions: &[(&str, usize, &str)]) -> CollaborationContract {
    let people: Vec<String> = (0..participants)
        .map(|i| format!(r#"{{"id":"p{i}","displayName":"Person {i}"}}"#))
        .collect();
    let items: Vec<String> = contributions
        .iter()
        .map(|(id, who, text)| {
            format!(
                r#"{{"id":"{id}","participantId":"p{who}","markdown":{}}}"#,
                serde_json::to_string(text).unwrap()
            )
        })
        .collect();
    CollaborationContract::from_json(&format!(
        r#"{{"version":1,"revision":1,"participants":[{}],"contributions":[{}],"reveals":[],"layout":[],"approvals":[]}}"#,
        people.join(","),
        items.join(",")
    ))
    .unwrap()
}

fn structure(layout: &str, rounds: &str) -> String {
    format!(r#"{{"version":1,"revision":1,"layout":"{layout}","rounds":{rounds}}}"#)
}

const ROUNDS: &str = r#"[{"id":"r1","prompt":"What stayed with you?","turns":[{"contributionId":"c0"},{"contributionId":"c1"}]},{"id":"r2","turns":[{"contributionId":"c2"}]}]"#;

fn three() -> CollaborationContract {
    contract(3, &[("c0", 0, "zero"), ("c1", 1, "one"), ("c2", 2, "two")])
}

#[test]
fn every_mode_reads_the_same_model_in_the_same_order() {
    let contract = three();
    let base = ReflectionStructure::from_json(&structure("sequential", ROUNDS)).unwrap();
    for layout in ReflectionLayout::ALL {
        let order = base
            .with_layout(layout)
            .reading_order(&contract)
            .unwrap()
            .iter()
            .map(|e| e.contribution_id.to_string())
            .collect::<Vec<_>>();
        assert_eq!(order, ["c0", "c1", "c2"], "{}", layout.key());
        let entries = base.reading_order(&contract).unwrap();
        let placements = ReflectionStructure::placements(layout, &entries);
        assert_eq!(placements.len(), 3);
        assert!(placements.iter().all(|p| p.lane < p.lanes));
    }
}

#[test]
fn layout_names_parse_and_changing_layout_leaves_everything_else() {
    for key in [
        "sequential",
        "sideBySide",
        "pointCounterpoint",
        "alternatingDialogue",
        "roundtable",
    ] {
        ReflectionStructure::from_json(&structure(key, ROUNDS)).unwrap();
    }
    let base = ReflectionStructure::from_json(&structure("sequential", ROUNDS)).unwrap();
    let changed = base.with_layout(ReflectionLayout::Roundtable);
    assert_eq!(base.rounds, changed.rounds);
    assert_eq!(base.revision, changed.revision);
    let contract = three();
    assert_eq!(
        base.reading_order(&contract).unwrap(),
        changed.reading_order(&contract).unwrap()
    );
}

#[test]
fn prompt_is_read_once_before_a_rounds_answers() {
    let contract = three();
    let s = ReflectionStructure::from_json(&structure("sequential", ROUNDS)).unwrap();
    let order = s.reading_order(&contract).unwrap();
    assert_eq!(order[0].prompt, Some("What stayed with you?"));
    assert_eq!(order[1].prompt, None);
    assert_eq!(order[2].prompt, None);
    assert_eq!((order[1].round, order[2].round), (0, 1));
}

#[test]
fn unequal_counts_and_missing_turns_keep_order() {
    // p0 speaks three times, p1 once, p2 never.
    let contract = contract(
        3,
        &[("a", 0, "1"), ("b", 1, "2"), ("c", 0, "3"), ("d", 0, "")],
    );
    let s = ReflectionStructure::from_json(&structure(
        "sideBySide",
        r#"[{"id":"r1","turns":[{"contributionId":"a"},{"contributionId":"b"}]},{"id":"r2","turns":[{"contributionId":"c"},{"contributionId":"d"}]}]"#,
    ))
    .unwrap();
    let order = s.reading_order(&contract).unwrap();
    assert_eq!(
        order.iter().map(|e| e.contribution_id).collect::<Vec<_>>(),
        ["a", "b", "c", "d"]
    );
    assert!(order[3].empty && !order[0].empty);
    // Lanes follow first appearance among participants who appear; p2 takes none.
    let lanes = ReflectionStructure::placements(ReflectionLayout::SideBySide, &order);
    assert_eq!(
        lanes.iter().map(|p| p.lane).collect::<Vec<_>>(),
        [0, 1, 0, 0]
    );
    assert!(lanes.iter().all(|p| p.lanes == 2));
}

#[test]
fn placements_follow_first_appearance_for_many_participants() {
    let items: Vec<(String, usize, String)> = (0..10)
        .map(|i| (format!("c{i}"), i, format!("t{i}")))
        .collect();
    let refs: Vec<(&str, usize, &str)> = items
        .iter()
        .map(|(a, b, c)| (a.as_str(), *b, c.as_str()))
        .collect();
    let contract = contract(10, &refs);
    let s = ReflectionStructure::from_contract(&contract);
    let order = s.reading_order(&contract).unwrap();
    let table = ReflectionStructure::placements(ReflectionLayout::Roundtable, &order);
    assert_eq!(
        table.iter().map(|p| p.lane).collect::<Vec<_>>(),
        (0..10).collect::<Vec<_>>()
    );
    let pc = ReflectionStructure::placements(ReflectionLayout::PointCounterpoint, &order);
    assert_eq!(pc[0].lane, 0);
    assert!(pc[1..].iter().all(|p| p.lane == 1 && p.lanes == 2));
    let alt = ReflectionStructure::placements(ReflectionLayout::AlternatingDialogue, &order);
    assert_eq!(
        alt.iter().map(|p| p.lane).collect::<Vec<_>>(),
        [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
    );
    let seq = ReflectionStructure::placements(ReflectionLayout::Sequential, &order);
    assert!(seq.iter().all(|p| p.lanes == 1));
}

#[test]
fn single_participant_and_empty_contract_work() {
    let one = contract(1, &[("c0", 0, "solo")]);
    let s = ReflectionStructure::from_contract(&one);
    assert_eq!(s.reading_order(&one).unwrap().len(), 1);
    let none = contract(1, &[]);
    let s = ReflectionStructure::from_contract(&none);
    assert!(s.rounds.is_empty());
    assert!(s.reading_order(&none).unwrap().is_empty());
}

#[test]
fn long_content_is_carried_unchanged_and_structure_is_bounded() {
    let long = "word ".repeat(10_000);
    let contract = contract(2, &[("c0", 0, &long), ("c1", 1, "short")]);
    let s = ReflectionStructure::from_contract(&contract);
    assert_eq!(s.reading_order(&contract).unwrap()[0].markdown, long);
    let big_prompt = "x".repeat(1_001);
    assert!(ReflectionStructure::from_json(&structure(
        "sequential",
        &format!(r#"[{{"id":"r","prompt":"{big_prompt}","turns":[{{"contributionId":"c0"}}]}}]"#)
    ))
    .is_err());
    let many: Vec<String> = (0..201)
        .map(|i| format!(r#"{{"id":"r{i}","turns":[{{"contributionId":"c{i}"}}]}}"#))
        .collect();
    assert!(ReflectionStructure::from_json(&structure(
        "sequential",
        &format!("[{}]", many.join(","))
    ))
    .is_err());
    let huge = format!(
        r#"{{"version":1,"revision":1,"layout":"sequential","rounds":[],"pad":"{}"}}"#,
        "x".repeat(200_000)
    );
    assert!(ReflectionStructure::from_json(&huge).is_err());
}

#[test]
fn identity_and_positional_fields_are_forbidden() {
    for field in [
        r#""left":"c0""#,
        r#""right":"c1""#,
        r#""authorA":"c0""#,
        r#""gender":"f""#,
        r#""pronouns":"she""#,
        r#""side":"left""#,
        r#""participantId":"p0""#,
        r#""author":"p0""#,
    ] {
        let turn_level = format!(r#"[{{"id":"r","turns":[{{"contributionId":"c0",{field}}}]}}]"#);
        let round_level = format!(r#"[{{"id":"r",{field},"turns":[{{"contributionId":"c0"}}]}}]"#);
        let top =
            format!(r#"{{"version":1,"revision":1,"layout":"sequential",{field},"rounds":[]}}"#);
        assert!(
            ReflectionStructure::from_json(&structure("sequential", &turn_level)).is_err(),
            "{field}"
        );
        assert!(
            ReflectionStructure::from_json(&structure("sequential", &round_level)).is_err(),
            "{field}"
        );
        assert!(ReflectionStructure::from_json(&top).is_err(), "{field}");
    }
    // Positional or gendered layout names are not modes.
    for layout in ["leftRight", "herHim", "left"] {
        assert!(ReflectionStructure::from_json(&structure(layout, "[]")).is_err());
    }
}

#[test]
fn untrusted_values_fail_with_one_opaque_error() {
    let bad = [
        r#"[{"id":"r","turns":[]}]"#,
        r#"[{"id":"r","turns":[{"contributionId":"c0"},{"contributionId":"c0"}]}]"#,
        r#"[{"id":"r","turns":[{"contributionId":"c0"}]},{"id":"R","turns":[{"contributionId":"c1"}]}]"#,
        r#"[{"id":"has space","turns":[{"contributionId":"c0"}]}]"#,
        r#"[{"id":"r","turns":[{"contributionId":"<script>"}]}]"#,
        r#"[{"id":"r","turns":[{"contributionId":"https://x.test/?token=s3cret"}]}]"#,
        r#"[{"id":"r","prompt":"a\u202eb","turns":[{"contributionId":"c0"}]}]"#,
        r#"[{"id":"r","prompt":"line\nbreak","turns":[{"contributionId":"c0"}]}]"#,
        r#"[{"id":"r","prompt":"   ","turns":[{"contributionId":"c0"}]}]"#,
    ];
    for rounds in bad {
        let err = ReflectionStructure::from_json(&structure("sequential", rounds)).unwrap_err();
        let text = format!("{err} {err:?}");
        assert!(!text.contains("s3cret") && !text.contains("script"));
    }
    assert!(ReflectionStructure::from_json("not json").is_err());
}

#[test]
fn unresolvable_turns_return_nothing_and_leak_nothing() {
    let contract = contract(2, &[("c0", 0, "SECRET prose")]);
    let s = ReflectionStructure::from_json(&structure(
        "sequential",
        r#"[{"id":"r","turns":[{"contributionId":"c0"},{"contributionId":"gone"}]}]"#,
    ))
    .unwrap();
    let err = s.reading_order(&contract).unwrap_err();
    let text = format!("{err} {err:?}");
    assert!(!text.contains("SECRET") && !text.contains("gone"));
}

#[test]
fn markdown_is_carried_verbatim_not_interpreted() {
    let hostile = "# heading\n<script>alert(1)</script> [x](javascript:alert(1))";
    let contract = contract(1, &[("c0", 0, hostile)]);
    let s = ReflectionStructure::from_contract(&contract);
    assert_eq!(s.reading_order(&contract).unwrap()[0].markdown, hostile);
}

#[test]
fn replacement_is_revision_checked_and_never_partial() {
    let base = ReflectionStructure::from_json(&structure("sequential", ROUNDS)).unwrap();
    let next = r#"{"version":1,"revision":2,"layout":"roundtable","rounds":[{"id":"r1","turns":[{"contributionId":"c0"}]}]}"#;
    let ok = base.replace_from_json(next, 1).unwrap();
    assert_eq!(ok.layout, ReflectionLayout::Roundtable);
    assert!(
        base.replace_from_json(next, 2).is_err(),
        "stale expectation"
    );
    assert!(base
        .replace_from_json(&next.replace("\"revision\":2", "\"revision\":5"), 1)
        .is_err());
    assert!(base
        .replace_from_json(&next.replace("c0", "bad id"), 1)
        .is_err());
    assert_eq!(base.layout, ReflectionLayout::Sequential);
}

#[test]
fn structure_round_trips_as_json() {
    let base = ReflectionStructure::from_json(&structure("alternatingDialogue", ROUNDS)).unwrap();
    let again = ReflectionStructure::from_json(&serde_json::to_string(&base).unwrap()).unwrap();
    assert_eq!(base, again);
}

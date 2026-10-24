use openblog_core::collaboration::{
    CollaborationContract, MAX_CONTRACT_BYTES, MAX_MARKDOWN_BYTES, MAX_PARTICIPANTS,
};
use serde_json::{json, Value};

fn contract_with(participant_ids: &[&str]) -> Value {
    let participants = participant_ids
        .iter()
        .map(|id| json!({ "id": id, "displayName": format!("Contributor {id}") }))
        .collect::<Vec<_>>();

    json!({
        "version": 1,
        "revision": 4,
        "participants": participants,
        "contributions": [],
        "reveals": [],
        "layout": [],
        "approvals": []
    })
}

fn populated_contract() -> Value {
    json!({
        "version": 1,
        "revision": 4,
        "participants": [
            { "id": "p0", "displayName": "First" },
            { "id": "p1", "displayName": "Second", "profileUrl": "https://example.org/second" },
            { "id": "p2", "displayName": "Third" }
        ],
        "contributions": [
            { "id": "c2", "participantId": "p2", "markdown": "Third" },
            { "id": "c0", "participantId": "p0", "markdown": "First" }
        ],
        "reveals": [
            { "contributionId": "c2", "participantIds": ["p0", "p1"] },
            { "contributionId": "c0", "participantIds": ["p2"] }
        ],
        "layout": [
            { "contributionId": "c0", "region": "opening" },
            { "contributionId": "c2", "region": "response" }
        ],
        "approvals": [
            { "participantId": "p2", "revision": 4 },
            { "participantId": "p0", "revision": 4 }
        ]
    })
}

#[test]
fn participant_collections_accept_group_sizes_and_preserve_authored_order() {
    for count in [1, 2, 3, 10] {
        let ids = (0..count)
            .map(|index| format!("p{index}"))
            .collect::<Vec<_>>();
        let borrowed = ids.iter().map(String::as_str).collect::<Vec<_>>();
        let contract = CollaborationContract::from_json(&contract_with(&borrowed).to_string())
            .expect("valid group contract");

        assert_eq!(
            contract
                .participants
                .iter()
                .map(|participant| participant.id.as_str())
                .collect::<Vec<_>>(),
            borrowed
        );
    }

    let reordered =
        CollaborationContract::from_json(&contract_with(&["p2", "p0", "p1"]).to_string())
            .expect("reordered participants remain valid");
    assert_eq!(
        reordered
            .participants
            .iter()
            .map(|participant| participant.id.as_str())
            .collect::<Vec<_>>(),
        ["p2", "p0", "p1"]
    );

    let pair_contract =
        CollaborationContract::from_json(&contract_with(&["lead", "guest"]).to_string())
            .expect("pair contract");
    let pair = pair_contract
        .pair_projection()
        .expect("exactly two participants project to pair slots");
    assert_eq!(pair.first.id, "lead");
    assert_eq!(pair.second.id, "guest");
}

#[test]
fn every_collaboration_collection_preserves_order_without_pair_fields() {
    let contract = CollaborationContract::from_json(&populated_contract().to_string())
        .expect("valid populated contract");

    assert_eq!(
        contract
            .contributions
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["c2", "c0"]
    );
    assert_eq!(contract.reveals[0].participant_ids, ["p0", "p1"]);
    assert_eq!(contract.layout[0].contribution_id, "c0");
    assert_eq!(contract.approvals[0].participant_id, "p2");

    let serialized = serde_json::to_value(&contract).expect("serialize contract");
    for forbidden in [
        "left",
        "right",
        "authorA",
        "authorB",
        "firstParticipant",
        "secondParticipant",
    ] {
        assert!(serialized.get(forbidden).is_none());
    }
}

#[test]
fn duplicate_and_removed_participant_fixtures_fail_as_one_private_error() {
    let mut duplicate = populated_contract();
    duplicate["participants"][1]["id"] = json!("p0");

    let mut removed = populated_contract();
    removed["participants"] = json!([
        { "id": "p0", "displayName": "First" },
        { "id": "p1", "displayName": "Second" }
    ]);

    for invalid in [duplicate, removed] {
        let error = CollaborationContract::from_json(&invalid.to_string())
            .expect_err("invalid relationship must fail closed");
        assert_eq!(error.to_string(), "invalid collaboration contract");
        assert!(!error.to_string().contains("p2"));
    }
}

#[test]
fn untrusted_fields_identifiers_urls_and_markdown_are_bounded() {
    assert_eq!(MAX_PARTICIPANTS, 100);
    assert_eq!(MAX_CONTRACT_BYTES, 256 * 1024);
    assert_eq!(MAX_MARKDOWN_BYTES, 64 * 1024);

    let mut fixtures = Vec::new();

    let mut token = contract_with(&["p0"]);
    token["token"] = json!("participant-secret");
    fixtures.push(token);

    let mut metadata = contract_with(&["p0"]);
    metadata["participants"][0]["metadata"] = json!({ "private": "other-user-data" });
    fixtures.push(metadata);

    let mut unsafe_url = contract_with(&["p0"]);
    unsafe_url["participants"][0]["profileUrl"] = json!("javascript:alert(1)");
    fixtures.push(unsafe_url);

    let mut invalid_identity = contract_with(&["../p0"]);
    invalid_identity["participants"][0]["displayName"] = json!("Participant\u{0}name");
    fixtures.push(invalid_identity);

    let mut oversized_markdown = populated_contract();
    oversized_markdown["contributions"][0]["markdown"] = json!("x".repeat(MAX_MARKDOWN_BYTES + 1));
    fixtures.push(oversized_markdown);

    for invalid in fixtures {
        let error = CollaborationContract::from_json(&invalid.to_string())
            .expect_err("untrusted contract must fail closed");
        assert_eq!(error.to_string(), "invalid collaboration contract");
        assert!(!error.to_string().contains("participant-secret"));
        assert!(!error.to_string().contains("other-user-data"));
    }
}

#[test]
fn concurrent_replacement_is_atomic_and_revision_checked() {
    let current = CollaborationContract::from_json(&contract_with(&["p0", "p1"]).to_string())
        .expect("current contract");
    let mut replacement = contract_with(&["p1", "p0", "p2"]);
    replacement["revision"] = json!(5);

    let updated = current
        .replace_from_json(&replacement.to_string(), 4)
        .expect("matching revision replaces the whole contract");
    assert_eq!(updated.revision, 5);
    assert_eq!(updated.participants[0].id, "p1");

    let stale_error = current
        .replace_from_json(&replacement.to_string(), 3)
        .expect_err("stale replacement must fail");
    assert_eq!(stale_error.to_string(), "invalid collaboration contract");
    assert_eq!(current.revision, 4);
    assert_eq!(current.participants.len(), 2);
}

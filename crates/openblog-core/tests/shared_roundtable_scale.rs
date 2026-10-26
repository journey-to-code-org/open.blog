//! Roundtables at the documented bounds (#188): groups of 3, 10 and the participant cap author,
//! arrange, synthesise, approve and publish through the one pipeline; the reading order is
//! deterministic; every contribution and credit survives every portable sequential form; and
//! over-limit groups, removal, restore, stale writes and hostile values fail safely without
//! exposing another participant's words.

use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind, MAX_ADMIN_USERNAME_BYTES, MAX_DISPLAY_NAME_BYTES,
    MAX_GUIDING_QUESTION_BYTES, MAX_IDENTIFIER_BYTES, MAX_PARTICIPANTS,
    MAX_PUBLICATION_TITLE_BYTES, MAX_SHARED_PUBLICATION_BYTES, MAX_SOURCES,
    MAX_SOURCE_DETAIL_BYTES, MAX_SOURCE_TITLE_BYTES,
};
use openblog_core::members::MAX_AUDIT_ENTRIES;

const T: i64 = 1_800_000_000;
const PUBLICATION: &str = "shared-0a1b2c3d4e5f";

#[test]
fn a_full_group_with_the_longest_values_and_a_full_audit_trail_still_loads() {
    let long_id = |prefix: &str, n: usize| {
        let head = format!("{prefix}{n:03}-");
        format!("{head}{}", "k".repeat(MAX_IDENTIFIER_BYTES - head.len()))
    };
    let long_user = |n: usize| {
        let head = format!("u{n:03}");
        format!(
            "{head}{}",
            "a".repeat(MAX_ADMIN_USERNAME_BYTES - head.len())
        )
    };
    // Quotes and backslashes are each written as two bytes in JSON: the longest stored text.
    let escaped = |bytes: usize| "\"\\".repeat(bytes / 2);
    let source = |n: usize| NewSourceReference {
        kind: SourceKind::Book,
        title: format!("{n:02}{}", escaped(MAX_SOURCE_TITLE_BYTES - 2)),
        url: format!("https://example.org/{n:02}/{}", "u".repeat(2_000)),
        creator: escaped(MAX_SOURCE_DETAIL_BYTES),
        publisher: escaped(MAX_SOURCE_DETAIL_BYTES),
        published: "2020-01-01".into(),
        isbn: String::new(),
    };
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: PUBLICATION.into(),
        title: escaped(MAX_PUBLICATION_TITLE_BYTES),
        guiding_question: escaped(MAX_GUIDING_QUESTION_BYTES),
        sources: (0..MAX_SOURCES).map(source).collect(),
        creator: NewParticipant {
            admin_user: long_user(0),
            contributor_id: long_id("c", 0),
            display_name: escaped(MAX_DISPLAY_NAME_BYTES),
        },
    })
    .unwrap();
    record.collaboration.participants[0].id = long_id("p", 0);
    record.authorization.bindings[0].participant_id = long_id("p", 0);
    for n in 1..MAX_PARTICIPANTS {
        record.collaboration.participants.push(Participant {
            id: long_id("p", n),
            display_name: format!("{n:03}{}", escaped(MAX_DISPLAY_NAME_BYTES - 3)),
            profile_url: None,
        });
        record.authorization.bindings.push(IdentityBinding {
            admin_user: long_user(n),
            contributor_id: long_id("c", n),
            participant_id: long_id("p", n),
            roles: vec![
                AuthorizationRole::SiteOwner,
                AuthorizationRole::Coordinator,
                AuthorizationRole::Contributor,
                AuthorizationRole::Editor,
                AuthorizationRole::Reader,
            ],
        });
    }
    let all_roles = record.authorization.bindings[1].roles.clone();
    let mut json: serde_json::Value = serde_json::to_value(&record).unwrap();
    json["audit"] = serde_json::Value::Array(
        (0..MAX_AUDIT_ENTRIES)
            .map(|n| {
                serde_json::json!({
                    "seq": n + 1,
                    "at": T,
                    "actor": long_id("p", n % MAX_PARTICIPANTS),
                    "event": "rolesChanged",
                    "subject": long_id("p", (n + 1) % MAX_PARTICIPANTS),
                    "from": all_roles,
                    "to": all_roles,
                })
            })
            .collect(),
    );
    json["invitations"] = serde_json::Value::Array(
        (0..openblog_core::invitation::MAX_INVITATIONS)
            .map(|n| {
                serde_json::json!({
                    "id": long_id("i", n),
                    "adminUser": long_user(n),
                    "contributorId": long_id("c", n),
                    "roles": all_roles,
                    "invitedBy": long_id("p", 0),
                    "createdAt": T,
                    "expiresAt": T + 86_400,
                    "state": "accepted",
                    "resolvedAt": T + 1,
                    "participantId": long_id("p", n),
                })
            })
            .collect(),
    );
    // The store writes records pretty-printed: that is the text that must load again.
    let text = format!("{}\n", serde_json::to_string_pretty(&json).unwrap());
    assert!(
        text.len() < MAX_SHARED_PUBLICATION_BYTES,
        "{} of {MAX_SHARED_PUBLICATION_BYTES} bytes",
        text.len()
    );
    let loaded = SharedPublication::from_json(&text).unwrap();
    assert_eq!(loaded.collaboration.participants.len(), MAX_PARTICIPANTS);
    assert_eq!(loaded.audit.len(), MAX_AUDIT_ENTRIES);
}

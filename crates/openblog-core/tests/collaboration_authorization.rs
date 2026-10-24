use openblog_core::collaboration::{
    AuthorizationAction, AuthorizationContext, AuthorizationPolicy, AuthorizationRole,
    CollaborationContract, MAX_AUTHORIZATION_BINDINGS, MAX_AUTHORIZATION_POLICY_BYTES,
};
use serde_json::json;

fn contract(participant_ids: &[&str]) -> CollaborationContract {
    let participants = participant_ids
        .iter()
        .map(|id| json!({ "id": id, "displayName": format!("Participant {id}") }))
        .collect::<Vec<_>>();
    CollaborationContract::from_json(
        &json!({
            "version": 1,
            "revision": 3,
            "participants": participants,
            "contributions": [],
            "reveals": [],
            "layout": [],
            "approvals": []
        })
        .to_string(),
    )
    .expect("valid collaboration contract")
}

fn binding(role: &str) -> serde_json::Value {
    json!({
        "adminUser": "ada-admin",
        "contributorId": "ada",
        "participantId": "ada-participant",
        "roles": [role]
    })
}

fn policy(bindings: serde_json::Value) -> AuthorizationPolicy {
    AuthorizationPolicy::from_json(
        &json!({
            "version": 1,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": bindings
        })
        .to_string(),
    )
    .expect("valid authorization policy")
}

#[test]
fn contributor_registry_entries_and_unbound_accounts_grant_zero_access() {
    let policy = policy(json!([]));
    let collaboration = contract(&["ada-participant"]);
    let context = AuthorizationContext {
        publication_id: "shared-reflection",
        authenticated_admin_user: "ada-admin",
        active_admin_users: &["ada-admin"],
        contributor_ids: &["ada"],
        collaboration: &collaboration,
        target_participant_id: None,
    };

    let error = policy
        .authorize(&context, AuthorizationAction::ViewPublished)
        .expect_err("a contributor record and login without a binding must be denied");
    assert_eq!(error.to_string(), "collaboration access denied");
}

#[test]
fn every_role_action_combination_is_explicit_and_owned_actions_are_subject_bound() {
    use AuthorizationAction::*;
    use AuthorizationRole::*;

    let collaboration = contract(&["ada-participant", "grace-participant"]);
    let actions = [
        ViewPublished,
        ViewRevealed,
        ViewContribution,
        EditContribution,
        Invite,
        RevealContribution,
        ApproveContribution,
        Schedule,
        Publish,
        RemoveMember,
        Export,
    ];
    let cases: &[(AuthorizationRole, &str, &[AuthorizationAction])] = &[
        (
            SiteOwner,
            "siteOwner",
            &[
                ViewPublished,
                ViewRevealed,
                Invite,
                Schedule,
                Publish,
                RemoveMember,
                Export,
            ],
        ),
        (
            Coordinator,
            "coordinator",
            &[
                ViewPublished,
                ViewRevealed,
                Invite,
                Schedule,
                Publish,
                RemoveMember,
                Export,
            ],
        ),
        (
            Contributor,
            "contributor",
            &[
                ViewPublished,
                ViewRevealed,
                ViewContribution,
                EditContribution,
                RevealContribution,
                ApproveContribution,
                Export,
            ],
        ),
        (
            Editor,
            "editor",
            &[
                ViewPublished,
                ViewRevealed,
                ViewContribution,
                EditContribution,
                Export,
            ],
        ),
        (Reader, "reader", &[ViewPublished, ViewRevealed, Export]),
    ];

    for (role, wire_role, allowed) in cases {
        let policy = policy(json!([binding(wire_role)]));
        for action in actions {
            let context = AuthorizationContext {
                publication_id: "shared-reflection",
                authenticated_admin_user: "ada-admin",
                active_admin_users: &["ada-admin"],
                contributor_ids: &["ada"],
                collaboration: &collaboration,
                target_participant_id: Some("ada-participant"),
            };
            assert_eq!(
                policy.authorize(&context, action).is_ok(),
                allowed.contains(&action),
                "unexpected {role:?} decision for {action:?}"
            );
        }
    }

    let contributor = policy(json!([binding("contributor")]));
    for action in [
        ViewContribution,
        EditContribution,
        RevealContribution,
        ApproveContribution,
    ] {
        let confused_deputy = AuthorizationContext {
            publication_id: "shared-reflection",
            authenticated_admin_user: "ada-admin",
            active_admin_users: &["ada-admin"],
            contributor_ids: &["ada"],
            collaboration: &collaboration,
            target_participant_id: Some("grace-participant"),
        };
        assert!(
            contributor.authorize(&confused_deputy, action).is_err(),
            "a contributor cannot exercise {action:?} as another participant"
        );
    }
}

#[test]
fn policy_replacement_is_atomic_revision_checked_and_publication_scoped() {
    let current = policy(json!([binding("reader")]));
    let replacement = json!({
        "version": 1,
        "revision": 8,
        "publicationId": "shared-reflection",
        "bindings": [binding("contributor")]
    });

    let updated = current
        .replace_from_json(&replacement.to_string(), 7)
        .expect("matching revision and publication replace the whole policy");
    assert_eq!(updated.revision, 8);
    assert_eq!(updated.bindings[0].roles, [AuthorizationRole::Contributor]);

    assert!(current
        .replace_from_json(&replacement.to_string(), 6)
        .is_err());
    let mut wrong_publication = replacement;
    wrong_publication["publicationId"] = json!("another-publication");
    assert!(current
        .replace_from_json(&wrong_publication.to_string(), 7)
        .is_err());
    assert_eq!(current.revision, 7);
    assert_eq!(current.bindings[0].roles, [AuthorizationRole::Reader]);
}

#[test]
fn removed_renamed_and_cross_publication_identities_fail_as_one_private_error() {
    let policy = policy(json!([binding("contributor")]));
    let collaboration = contract(&["ada-participant"]);
    let removed_participant = contract(&["grace-participant"]);
    let cases = [
        AuthorizationContext {
            publication_id: "shared-reflection",
            authenticated_admin_user: "ada-admin",
            active_admin_users: &[],
            contributor_ids: &["ada"],
            collaboration: &collaboration,
            target_participant_id: None,
        },
        AuthorizationContext {
            publication_id: "shared-reflection",
            authenticated_admin_user: "ada-admin",
            active_admin_users: &["ada-admin"],
            contributor_ids: &["ada-renamed"],
            collaboration: &collaboration,
            target_participant_id: None,
        },
        AuthorizationContext {
            publication_id: "shared-reflection",
            authenticated_admin_user: "ada-admin",
            active_admin_users: &["ada-admin"],
            contributor_ids: &["ada"],
            collaboration: &removed_participant,
            target_participant_id: None,
        },
        AuthorizationContext {
            publication_id: "another-publication",
            authenticated_admin_user: "ada-admin",
            active_admin_users: &["ada-admin"],
            contributor_ids: &["ada"],
            collaboration: &collaboration,
            target_participant_id: None,
        },
    ];

    for context in cases {
        let error = policy
            .authorize(&context, AuthorizationAction::ViewPublished)
            .expect_err("stale or cross-publication identity must be denied");
        assert_eq!(error.to_string(), "collaboration access denied");
        for private_value in [
            "ada-admin",
            "ada-renamed",
            "grace-participant",
            "another-publication",
        ] {
            assert!(!error.to_string().contains(private_value));
        }
    }
}

#[test]
fn access_roles_authorize_actions_without_creating_authorship_or_approval() {
    let policy = policy(json!([{
        "adminUser": "ada-admin",
        "contributorId": "ada",
        "participantId": "ada-participant",
        "roles": ["coordinator", "contributor"]
    }]));
    let collaboration = contract(&["ada-participant"]);
    let context = AuthorizationContext {
        publication_id: "shared-reflection",
        authenticated_admin_user: "ada-admin",
        active_admin_users: &["ada-admin"],
        contributor_ids: &["ada"],
        collaboration: &collaboration,
        target_participant_id: Some("ada-participant"),
    };

    let grant = policy
        .authorize(&context, AuthorizationAction::ApproveContribution)
        .expect("the contributor role permits the participant to submit an approval");
    assert_eq!(grant.contributor_id, "ada");
    assert_eq!(grant.participant_id, "ada-participant");
    assert!(
        collaboration.approvals.is_empty(),
        "authorization must not manufacture an approval"
    );

    let serialized = serde_json::to_value(policy).expect("serialize policy");
    let encoded = serialized.to_string();
    for forbidden in ["author", "authorship", "approval", "approved"] {
        assert!(!encoded.contains(forbidden));
    }
}

#[test]
fn policy_shape_is_bounded_group_safe_and_rejects_untrusted_fields() {
    assert_eq!(MAX_AUTHORIZATION_BINDINGS, 100);
    assert_eq!(MAX_AUTHORIZATION_POLICY_BYTES, 64 * 1024);

    for count in [1, 2, 3, 10] {
        let bindings = (0..count)
            .map(|index| {
                json!({
                    "adminUser": format!("admin-{index}"),
                    "contributorId": format!("contributor-{index}"),
                    "participantId": format!("participant-{index}"),
                    "roles": ["reader"]
                })
            })
            .collect::<Vec<_>>();
        let parsed = policy(json!(bindings));
        assert_eq!(parsed.bindings.len(), count);
    }

    let fixtures = [
        json!({
            "version": 1,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": [binding("reader")],
            "token": "participant-secret"
        }),
        json!({
            "version": 1,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": [{
                "adminUser": "ada-admin",
                "contributorId": "ada",
                "participantId": "ada-participant",
                "roles": ["reader"],
                "metadata": { "private": "other-user-data" }
            }]
        }),
        json!({
            "version": 1,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": [binding("reader"), binding("editor")]
        }),
        json!({
            "version": 1,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": [{
                "adminUser": "ada-admin",
                "contributorId": "ada",
                "participantId": "ada-participant",
                "roles": ["reader", "reader"]
            }]
        }),
    ];

    for invalid in fixtures {
        let error = AuthorizationPolicy::from_json(&invalid.to_string())
            .expect_err("untrusted or ambiguous policy must fail closed");
        assert_eq!(error.to_string(), "collaboration access denied");
        assert!(!error.to_string().contains("participant-secret"));
        assert!(!error.to_string().contains("other-user-data"));
    }
}

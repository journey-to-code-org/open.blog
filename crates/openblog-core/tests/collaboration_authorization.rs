use openblog_core::{
    collaboration::{
        AuthorizationAction, AuthorizationContext, AuthorizationPolicy, AuthorizationRole,
        AuthorizationTarget, CollaborationContract, MAX_AUTHORIZATION_BINDINGS,
        MAX_AUTHORIZATION_POLICY_BYTES,
    },
    generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet,
};
use serde_json::json;

const ACTIONS: [AuthorizationAction; 11] = [
    AuthorizationAction::ViewPublished,
    AuthorizationAction::ViewRevealed,
    AuthorizationAction::ViewContribution,
    AuthorizationAction::EditContribution,
    AuthorizationAction::Invite,
    AuthorizationAction::RevealContribution,
    AuthorizationAction::ApproveContribution,
    AuthorizationAction::Schedule,
    AuthorizationAction::Publish,
    AuthorizationAction::RemoveMember,
    AuthorizationAction::Export,
];

/// One allowed (action, target) pair in the role matrix.
type Grant = (AuthorizationAction, AuthorizationTarget<'static>);

fn contract(participant_ids: &[&str]) -> CollaborationContract {
    contract_with(participant_ids, &[], &[])
}

/// A collaboration revision with `(contribution, owner)` drafts and `(contribution, viewers)`
/// reveals.
fn contract_with(
    participant_ids: &[&str],
    contributions: &[(&str, &str)],
    reveals: &[(&str, &[&str])],
) -> CollaborationContract {
    let participants = participant_ids
        .iter()
        .map(|id| json!({ "id": id, "displayName": format!("Participant {id}") }))
        .collect::<Vec<_>>();
    let contributions = contributions
        .iter()
        .map(|(id, owner)| {
            json!({ "id": id, "participantId": owner, "markdown": format!("Private {id}") })
        })
        .collect::<Vec<_>>();
    let reveals = reveals
        .iter()
        .map(|(id, viewers)| json!({ "contributionId": id, "participantIds": viewers }))
        .collect::<Vec<_>>();
    CollaborationContract::from_json(
        &json!({
            "version": 1,
            "revision": 3,
            "participants": participants,
            "contributions": contributions,
            "reveals": reveals,
            "layout": [],
            "approvals": []
        })
        .to_string(),
    )
    .expect("valid collaboration contract")
}

/// Ada and Grace each own one draft; Grace has revealed hers to Ada only.
fn group() -> CollaborationContract {
    contract_with(
        &["ada-participant", "grace-participant", "linus-participant"],
        &[
            ("ada-draft", "ada-participant"),
            ("grace-draft", "grace-participant"),
        ],
        &[("grace-draft", &["ada-participant"])],
    )
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
    AuthorizationPolicy::from_json(&policy_json(bindings).to_string())
        .expect("valid authorization policy")
}

fn policy_json(bindings: serde_json::Value) -> serde_json::Value {
    json!({
        "version": 1,
        "revision": 7,
        "publicationId": "shared-reflection",
        "bindings": bindings
    })
}

/// Ada, signed in and present in the registry and the participant collection.
fn ada<'a>(
    collaboration: &'a CollaborationContract,
    target: AuthorizationTarget<'a>,
) -> AuthorizationContext<'a> {
    AuthorizationContext {
        publication_id: "shared-reflection",
        authenticated_admin_user: "ada-admin",
        active_admin_users: &["ada-admin", "grace-admin"],
        contributor_ids: &["ada", "grace"],
        collaboration,
        target,
    }
}

/// Every target shape a request could name against `group()`, including unknown IDs.
fn every_target() -> [AuthorizationTarget<'static>; 7] {
    [
        AuthorizationTarget::Publication,
        AuthorizationTarget::Participant("ada-participant"),
        AuthorizationTarget::Participant("grace-participant"),
        AuthorizationTarget::Participant("missing-participant"),
        AuthorizationTarget::Contribution("ada-draft"),
        AuthorizationTarget::Contribution("grace-draft"),
        AuthorizationTarget::Contribution("missing-draft"),
    ]
}

#[test]
fn contributor_registry_entries_and_unbound_accounts_grant_zero_access() {
    let collaboration = group();
    // Ada has an Admin login, a registry entry, and a participant record, but no binding;
    // a binding for someone else must not leak to her either.
    let grace_only = policy(json!([{
        "adminUser": "grace-admin",
        "contributorId": "grace",
        "participantId": "grace-participant",
        "roles": ["siteOwner", "coordinator", "contributor", "editor", "reader"]
    }]));
    for policy in [policy(json!([])), grace_only] {
        for action in ACTIONS {
            for target in every_target() {
                let error = policy
                    .authorize(&ada(&collaboration, target), action)
                    .expect_err("a registry entry and login without a binding must be denied");
                assert_eq!(error.to_string(), "collaboration access denied");
            }
        }
    }
}

#[test]
fn every_role_action_combination_is_explicit() {
    use AuthorizationAction::*;
    use AuthorizationRole::*;
    use AuthorizationTarget::{Contribution as Draft, Participant, Publication};

    let collaboration = group();
    // (role, wire name, allowed (action, target) pairs); every other pair must be denied.
    let cases: &[(AuthorizationRole, &str, &[Grant])] = &[
        (
            SiteOwner,
            "siteOwner",
            &[
                (ViewPublished, Publication),
                (ViewRevealed, Draft("grace-draft")),
                (Invite, Publication),
                (Schedule, Publication),
                (Publish, Publication),
                (RemoveMember, Participant("ada-participant")),
                (RemoveMember, Participant("grace-participant")),
                (Export, Publication),
            ],
        ),
        (
            Coordinator,
            "coordinator",
            &[
                (ViewPublished, Publication),
                (ViewRevealed, Draft("grace-draft")),
                (Invite, Publication),
                (Schedule, Publication),
                (Publish, Publication),
                (RemoveMember, Participant("ada-participant")),
                (RemoveMember, Participant("grace-participant")),
                (Export, Publication),
            ],
        ),
        (
            Contributor,
            "contributor",
            &[
                (ViewPublished, Publication),
                (ViewRevealed, Draft("grace-draft")),
                (ViewContribution, Draft("ada-draft")),
                (EditContribution, Draft("ada-draft")),
                (RevealContribution, Draft("ada-draft")),
                (ApproveContribution, Participant("ada-participant")),
                (Export, Publication),
            ],
        ),
        (
            Editor,
            "editor",
            &[
                (ViewPublished, Publication),
                (ViewRevealed, Draft("grace-draft")),
                (ViewContribution, Draft("ada-draft")),
                (ViewContribution, Draft("grace-draft")),
                (EditContribution, Draft("ada-draft")),
                (EditContribution, Draft("grace-draft")),
                (Export, Publication),
            ],
        ),
        (
            Reader,
            "reader",
            &[
                (ViewPublished, Publication),
                (ViewRevealed, Draft("grace-draft")),
                (Export, Publication),
            ],
        ),
    ];

    for (role, wire_role, allowed) in cases {
        let policy = policy(json!([binding(wire_role)]));
        for action in ACTIONS {
            for target in every_target() {
                assert_eq!(
                    policy
                        .authorize(&ada(&collaboration, target), action)
                        .is_ok(),
                    allowed.contains(&(action, target)),
                    "unexpected {role:?} decision for {action:?} on {target:?}"
                );
            }
        }
    }
}

#[test]
fn confused_deputy_requests_cannot_act_for_another_participant() {
    use AuthorizationAction::*;

    // Grace's draft is not revealed to Linus, and Ada's draft is revealed to nobody.
    let collaboration = group();
    let every_role = policy(json!([{
        "adminUser": "ada-admin",
        "contributorId": "ada",
        "participantId": "ada-participant",
        "roles": ["siteOwner", "coordinator", "contributor", "editor", "reader"]
    }]));

    // Ownership comes from the server-side contract, never from the request: naming Grace's
    // draft is a request about Grace's prose however the caller labels it.
    for action in [RevealContribution, ApproveContribution] {
        for target in [
            AuthorizationTarget::Contribution("grace-draft"),
            AuthorizationTarget::Participant("grace-participant"),
        ] {
            assert!(
                every_role
                    .authorize(&ada(&collaboration, target), action)
                    .is_err(),
                "no role may {action:?} for another participant via {target:?}"
            );
        }
    }

    // A contributor can only reach another draft that has been revealed to them.
    let contributor = policy(json!([binding("contributor")]));
    for action in [ViewContribution, EditContribution, RevealContribution] {
        assert!(contributor
            .authorize(
                &ada(
                    &collaboration,
                    AuthorizationTarget::Contribution("grace-draft")
                ),
                action
            )
            .is_err());
    }

    // An editor and a viewer reach only drafts revealed to their own participant.
    let linus = |target| AuthorizationContext {
        publication_id: "shared-reflection",
        authenticated_admin_user: "linus-admin",
        active_admin_users: &["linus-admin"],
        contributor_ids: &["linus"],
        collaboration: &collaboration,
        target,
    };
    let linus_policy = policy(json!([{
        "adminUser": "linus-admin",
        "contributorId": "linus",
        "participantId": "linus-participant",
        "roles": ["siteOwner", "coordinator", "contributor", "editor", "reader"]
    }]));
    for action in [ViewRevealed, ViewContribution, EditContribution] {
        for draft in ["ada-draft", "grace-draft"] {
            assert!(
                linus_policy
                    .authorize(&linus(AuthorizationTarget::Contribution(draft)), action)
                    .is_err(),
                "{action:?} on unrevealed {draft} must be denied"
            );
        }
    }

    // A target of the wrong kind is a confused request, not a wildcard.
    for (action, target) in [
        (
            ViewPublished,
            AuthorizationTarget::Contribution("ada-draft"),
        ),
        (Publish, AuthorizationTarget::Participant("ada-participant")),
        (
            EditContribution,
            AuthorizationTarget::Participant("ada-participant"),
        ),
        (EditContribution, AuthorizationTarget::Publication),
        (
            ApproveContribution,
            AuthorizationTarget::Contribution("ada-draft"),
        ),
        (RemoveMember, AuthorizationTarget::Publication),
    ] {
        assert!(every_role
            .authorize(&ada(&collaboration, target), action)
            .is_err());
    }
}

#[test]
fn coordinators_cannot_remove_a_site_owner() {
    let collaboration = group();
    let bindings = |grace_roles: &[&str], ada_role: &str| {
        policy(json!([
            binding(ada_role),
            {
                "adminUser": "grace-admin",
                "contributorId": "grace",
                "participantId": "grace-participant",
                "roles": grace_roles
            }
        ]))
    };
    let remove_grace = ada(
        &collaboration,
        AuthorizationTarget::Participant("grace-participant"),
    );

    assert!(bindings(&["siteOwner"], "coordinator")
        .authorize(&remove_grace, AuthorizationAction::RemoveMember)
        .is_err());
    assert!(bindings(&["siteOwner"], "siteOwner")
        .authorize(&remove_grace, AuthorizationAction::RemoveMember)
        .is_ok());
    assert!(bindings(&["coordinator", "contributor"], "coordinator")
        .authorize(&remove_grace, AuthorizationAction::RemoveMember)
        .is_ok());
}

#[test]
fn policy_replacement_is_atomic_revision_checked_and_publication_scoped() {
    let current = policy(json!([binding("reader")]));
    let mut replacement = policy_json(json!([binding("contributor")]));
    replacement["revision"] = json!(8);

    let updated = current
        .replace_from_json(&replacement.to_string(), 7)
        .expect("matching revision and publication replace the whole policy");
    assert_eq!(updated.revision, 8);
    assert_eq!(updated.bindings[0].roles, [AuthorizationRole::Contributor]);

    // Stale observers, replays of the current revision, skipped revisions, a different
    // publication, and a malformed body all fail without touching the current policy.
    let mut replayed = replacement.clone();
    replayed["revision"] = json!(7);
    let mut skipped = replacement.clone();
    skipped["revision"] = json!(9);
    let mut wrong_publication = replacement.clone();
    wrong_publication["publicationId"] = json!("another-publication");
    let mut hostile = replacement.clone();
    hostile["bindings"][0]["adminUser"] = json!("<script>alert(1)</script>");
    for (source, observed) in [
        (replacement.to_string(), 6),
        (replayed.to_string(), 7),
        (skipped.to_string(), 7),
        (wrong_publication.to_string(), 7),
        (hostile.to_string(), 7),
        ("{\"version\":1,".to_string(), 7),
    ] {
        let error = current
            .replace_from_json(&source, observed)
            .expect_err("unsafe replacement must fail");
        assert_eq!(error.to_string(), "collaboration access denied");
    }
    assert_eq!(current, policy(json!([binding("reader")])));

    let exhausted = AuthorizationPolicy {
        revision: u64::MAX,
        ..current.clone()
    };
    let mut overflow = replacement;
    overflow["revision"] = json!(0);
    assert!(exhausted
        .replace_from_json(&overflow.to_string(), u64::MAX)
        .is_err());
}

#[test]
fn removed_renamed_and_cross_publication_identities_fail_as_one_private_error() {
    let policy = policy(json!([binding("contributor")]));
    let collaboration = contract_with(
        &["ada-participant"],
        &[("ada-draft", "ada-participant")],
        &[],
    );
    let removed_participant = contract(&["grace-participant"]);
    let own_draft = AuthorizationTarget::Contribution("ada-draft");
    policy
        .authorize(
            &ada(&collaboration, own_draft),
            AuthorizationAction::EditContribution,
        )
        .expect("the current binding is the positive control");
    let cases = [
        // Removed Admin user: the account no longer exists even if a session lingers.
        AuthorizationContext {
            active_admin_users: &[],
            ..ada(&collaboration, own_draft)
        },
        // Renamed contributor: the binding points at a registry key that no longer exists.
        AuthorizationContext {
            contributor_ids: &["ada-renamed"],
            ..ada(&collaboration, own_draft)
        },
        // Removed participant: the contract no longer lists the bound participant.
        ada(&removed_participant, AuthorizationTarget::Publication),
        // Cross-publication use of an otherwise valid binding.
        AuthorizationContext {
            publication_id: "another-publication",
            ..ada(&collaboration, own_draft)
        },
        // Another signed-in account claiming Ada's binding.
        AuthorizationContext {
            authenticated_admin_user: "grace-admin",
            ..ada(&collaboration, own_draft)
        },
    ];

    for context in cases {
        for action in ACTIONS {
            let error = policy
                .authorize(&context, action)
                .expect_err("stale or cross-publication identity must be denied");
            assert_eq!(error.to_string(), "collaboration access denied");
            assert_eq!(format!("{error:?}"), "AuthorizationError");
        }
    }
}

#[test]
fn access_roles_authorize_actions_without_creating_authorship_or_approval() {
    let policy = policy(json!([{
        "adminUser": "ada-admin",
        "contributorId": "ada",
        "participantId": "ada-participant",
        "roles": ["siteOwner", "coordinator", "contributor"]
    }]));
    let collaboration = group();
    let before = collaboration.clone();

    let grant = policy
        .authorize(
            &ada(
                &collaboration,
                AuthorizationTarget::Participant("ada-participant"),
            ),
            AuthorizationAction::ApproveContribution,
        )
        .expect("the contributor role permits the participant to submit an approval");
    assert_eq!(grant.contributor_id, "ada");
    assert_eq!(grant.participant_id, "ada-participant");
    for action in [AuthorizationAction::Publish, AuthorizationAction::Schedule] {
        policy
            .authorize(
                &ada(&collaboration, AuthorizationTarget::Publication),
                action,
            )
            .expect("site owner may request the action");
    }
    assert_eq!(
        collaboration, before,
        "authorization must not manufacture an approval or change drafts"
    );
    assert!(collaboration.approvals.is_empty());

    let serialized = serde_json::to_value(policy).expect("serialize policy");
    let encoded = serialized.to_string();
    for forbidden in ["author", "authorship", "approval", "approved", "credit"] {
        assert!(!encoded.contains(forbidden));
    }
}

#[test]
fn bound_identities_follow_the_admin_username_and_registry_key_rules() {
    let with = |field: &str, value: serde_json::Value| {
        let mut binding = binding("reader");
        binding[field] = value;
        AuthorizationPolicy::from_json(&policy_json(json!([binding])).to_string())
    };

    // Any Admin username can be bound, including names that are not contract identifiers.
    for admin_user in [
        "mikey",
        "mikey_1",
        "m.nichols",
        "con",
        "-x",
        "a".repeat(32).as_str(),
    ] {
        assert!(with("adminUser", json!(admin_user)).is_ok(), "{admin_user}");
    }
    for contributor_id in ["ada", "ada-lovelace", "site-2"] {
        assert!(
            with("contributorId", json!(contributor_id)).is_ok(),
            "{contributor_id}"
        );
    }

    let rejected = [
        ("adminUser", json!("")),
        ("adminUser", json!("Ada-admin")),
        ("adminUser", json!("a".repeat(33))),
        ("adminUser", json!("ada/admin")),
        ("adminUser", json!("ada admin")),
        ("adminUser", json!("\u{0430}da-admin")),
        ("adminUser", json!("ada\u{202E}nimda")),
        ("adminUser", json!("ada\u{0000}")),
        ("adminUser", json!(7)),
        ("contributorId", json!("Ada")),
        ("contributorId", json!("ada_lovelace")),
        ("contributorId", json!("ada--lovelace")),
        ("contributorId", json!("-ada")),
        ("contributorId", json!("../ada")),
        ("contributorId", json!("a".repeat(129))),
        ("participantId", json!("../ada")),
        ("participantId", json!("con")),
        ("participantId", json!("ada participant")),
        ("roles", json!([])),
        ("roles", json!("reader")),
        ("roles", json!(["admin"])),
        ("roles", json!(["Reader"])),
        ("roles", json!(["reader", "reader"])),
    ];
    for (field, value) in rejected {
        let error = with(field, value.clone())
            .expect_err("an identity that cannot be authenticated or resolved must fail");
        assert_eq!(
            error.to_string(),
            "collaboration access denied",
            "{field}: {value}"
        );
    }
}

#[test]
fn policy_shape_is_bounded_group_safe_and_rejects_untrusted_fields() {
    assert_eq!(MAX_AUTHORIZATION_BINDINGS, 100);
    assert_eq!(MAX_AUTHORIZATION_POLICY_BYTES, 64 * 1024);

    let bindings = |count: usize| {
        (0..count)
            .map(|index| {
                json!({
                    "adminUser": format!("admin-{index}"),
                    "contributorId": format!("contributor-{index}"),
                    "participantId": format!("participant-{index}"),
                    "roles": ["reader"]
                })
            })
            .collect::<Vec<_>>()
    };
    for count in [1, 2, 3, 10, MAX_AUTHORIZATION_BINDINGS] {
        let parsed = policy(json!(bindings(count)));
        assert_eq!(parsed.bindings.len(), count);
    }
    assert!(AuthorizationPolicy::from_json(
        &policy_json(json!(bindings(MAX_AUTHORIZATION_BINDINGS + 1))).to_string()
    )
    .is_err());
    let mut oversized = policy_json(json!([binding("reader")]));
    oversized["publicationId"] = json!("p".repeat(MAX_AUTHORIZATION_POLICY_BYTES));
    assert!(AuthorizationPolicy::from_json(&oversized.to_string()).is_err());

    let grace = |participant: &str| {
        json!({
            "adminUser": "grace-admin",
            "contributorId": "grace",
            "participantId": participant,
            "roles": ["reader"]
        })
    };
    let fixtures = [
        json!({
            "version": 1,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": [binding("reader")],
            "token": "participant-secret"
        }),
        policy_json(json!([{
            "adminUser": "ada-admin",
            "contributorId": "ada",
            "participantId": "ada-participant",
            "roles": ["reader"],
            "metadata": { "private": "other-user-data" }
        }])),
        policy_json(json!([{
            "adminUser": "ada-admin",
            "contributorId": "ada",
            "participantId": "ada-participant",
            "roles": ["reader"],
            "markdown": "<img src=x onerror=alert('other-user-data')>",
            "profileUrl": "javascript:alert('other-user-data')"
        }])),
        policy_json(json!([binding("reader"), binding("editor")])),
        policy_json(json!([binding("reader"), grace("Ada-Participant")])),
        policy_json(json!([binding("reader"), grace("ada-participant")])),
        json!({
            "version": 2,
            "revision": 7,
            "publicationId": "shared-reflection",
            "bindings": [binding("reader")]
        }),
        json!({
            "version": 1,
            "revision": 7,
            "publicationId": "../shared-reflection",
            "bindings": [binding("reader")]
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

/// Pins the isolation: authorization reads the policy and contract by reference and has no
/// document, renderer, feed, or filesystem seam, so hostile input and denials cannot change
/// canonical content or generated output.
#[test]
fn denied_requests_leave_canonical_content_and_public_output_unchanged() {
    let build = || {
        let site = Site::load(
            SiteConfig::from_json(r#"{"author":{"name":"Site Author"}}"#).unwrap(),
            Sources {
                posts: vec![SourceFile {
                    path: "posts/reflection.md".into(),
                    contents: "---
title: Reflection
date: 2026-10-24
---
Published body."
                        .into(),
                }],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        generate(&site, &ThemeSet::new())
            .unwrap()
            .into_iter()
            .map(|file| (file.path, file.contents))
            .collect::<Vec<_>>()
    };
    let before = build();

    let collaboration = group();
    let current = policy(json!([binding("contributor")]));
    let snapshot = (collaboration.clone(), current.clone());
    for action in ACTIONS {
        for target in every_target() {
            let _ = current.authorize(
                &AuthorizationContext {
                    authenticated_admin_user: "grace-admin",
                    ..ada(&collaboration, target)
                },
                action,
            );
        }
    }
    let mut hostile = policy_json(json!([binding("contributor")]));
    hostile["revision"] = json!(8);
    hostile["bindings"][0]["markdown"] = json!("<script>Private grace-draft</script>");
    assert!(current.replace_from_json(&hostile.to_string(), 7).is_err());
    assert!(AuthorizationPolicy::from_json(&hostile.to_string()).is_err());

    assert_eq!((collaboration, current), snapshot);
    let after = build();
    assert_eq!(before, after);
    for (_, contents) in &after {
        for private in [
            "Private grace-draft",
            "ada-admin",
            "ada-participant",
            "shared-reflection",
        ] {
            assert!(!contents.contains(private), "{private} leaked");
        }
    }
}

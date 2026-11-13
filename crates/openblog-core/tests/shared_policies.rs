//! Configurable group approval rules (ADR 0052): all, named and role-based requirements over one
//! author set, under membership churn, ties, coordinator loss, concurrent approvals and stale
//! policy versions. Every rule needs each writer's own approval; none fabricates one.

use openblog_core::approval::{
    public_metadata, ApprovalPolicy, ApprovalRequirement, ApprovalScope, ApprovalSet,
    ApprovalSubject, PolicyChange, PolicyError, Readiness, RuleAuthority, RuleGaps,
};
use openblog_core::assembly::{assemble, with_subject, AssemblyError};
use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind,
};
use openblog_core::draft::DraftSet;
use openblog_core::media_moment::MomentSet;
use openblog_core::synthesis::SynthesisSet;

const T: i64 = 1_800_000_000;
const DATE: &str = "2030-01-31T09:00:00Z";
const ALL: [&str; 4] = ["ann", "bo", "cy", "di"];

/// Ann owns and writes; Bo writes; Cy coordinates and writes nothing; Di contributes.
fn record() -> SharedPublication {
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: "shared-0a1b2c3d4e5f".into(),
        title: "On attention".into(),
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
    record.initial_approval_scope = None;
    record.initial_approval_requirement = None;
    record.collaboration.participants[0].id = "ann".into();
    record.authorization.bindings[0].participant_id = "ann".into();
    for (id, name, roles) in [
        ("bo", "Bo", vec![AuthorizationRole::Contributor]),
        (
            "cy",
            "Cy",
            vec![
                AuthorizationRole::Coordinator,
                AuthorizationRole::Contributor,
            ],
        ),
        ("di", "Di", vec![AuthorizationRole::Contributor]),
    ] {
        record.collaboration.participants.push(Participant {
            id: id.into(),
            display_name: name.into(),
            profile_url: None,
        });
        record.authorization.bindings.push(IdentityBinding {
            admin_user: format!("{id}-admin"),
            contributor_id: id.into(),
            participant_id: id.into(),
            roles,
        });
    }
    record
}

fn drafts(writers: &[&str]) -> DraftSet {
    let mut set = DraftSet::new(&ALL).unwrap();
    for who in writers {
        set.save(who, who, 0, &format!("{who} words"), T).unwrap();
    }
    set
}

fn approve(
    record: &SharedPublication,
    set: &DraftSet,
    approvals: &mut ApprovalSet,
    active: &[&str],
    who: &str,
) {
    with_subject(
        record,
        None,
        set,
        &SynthesisSet::new(),
        &MomentSet::new(),
        active,
        |subject| {
            let seen = approvals.binding_for(subject, who).unwrap();
            approvals.approve(who, who, subject, &seen, true, T)
        },
    )
    .unwrap();
}

fn gate(
    record: &SharedPublication,
    set: &DraftSet,
    approvals: &ApprovalSet,
    active: &[&str],
) -> Result<(), AssemblyError> {
    assemble(
        record,
        None,
        set,
        &SynthesisSet::new(),
        &MomentSet::new(),
        approvals,
        active,
        DATE,
    )
    .map(|_| ())
}

fn policy(requirement: ApprovalRequirement) -> ApprovalPolicy {
    ApprovalPolicy {
        requirement,
        scope: ApprovalScope::OwnSections,
    }
}

#[test]
fn numeric_quorum_never_replaces_writers_or_shrinks_when_members_leave() {
    let record = record();
    let mut drafts = drafts(&["ann", "bo"]);
    let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    assert!(approvals.set_policy(ApprovalPolicy {
        requirement: ApprovalRequirement::Quorum(3),
        scope: ApprovalScope::WholePiece,
    }));
    for who in ["ann", "cy", "di"] {
        approve(&record, &drafts, &mut approvals, &ALL, who);
    }
    assert!(matches!(
        gate(&record, &drafts, &approvals, &ALL),
        Err(AssemblyError::Blocked { .. })
    ));
    approve(&record, &drafts, &mut approvals, &ALL, "bo");
    assert_eq!(gate(&record, &drafts, &approvals, &ALL), Ok(()));
    let mut threshold = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    assert!(threshold.set_policy(ApprovalPolicy {
        requirement: ApprovalRequirement::Quorum(3),
        scope: ApprovalScope::WholePiece,
    }));
    for who in ["ann", "bo"] {
        approve(&record, &drafts, &mut threshold, &ALL, who);
    }
    assert_eq!(
        gate(&record, &drafts, &threshold, &ALL),
        Err(AssemblyError::QuorumBlocked {
            approved: 2,
            required: 3,
        })
    );
    approve(&record, &drafts, &mut threshold, &ALL, "cy");
    assert_eq!(gate(&record, &drafts, &threshold, &ALL), Ok(()));
    let remaining = ["ann", "bo"];
    assert!(gate(&record, &drafts, &approvals, &remaining).is_err());
    drafts.save("bo", "bo", 1, "changed", T + 1).unwrap();
    assert!(gate(&record, &drafts, &approvals, &ALL).is_err());
}

#[test]
fn numeric_quorum_rejects_bad_thresholds_and_unconsented_lowering() {
    let record = record();
    let drafts = drafts(&["ann", "bo"]);
    for (count, scope) in [
        (0, ApprovalScope::WholePiece),
        (101, ApprovalScope::WholePiece),
        (2, ApprovalScope::OwnSections),
    ] {
        assert!(ApprovalPolicy {
            requirement: ApprovalRequirement::Quorum(count),
            scope
        }
        .normalized()
        .is_err());
    }
    let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    let q = |count| ApprovalPolicy {
        requirement: ApprovalRequirement::Quorum(count),
        scope: ApprovalScope::WholePiece,
    };
    assert!(approvals.set_policy(q(3)));
    let restored = ApprovalSet::from_json(&approvals.to_json()).unwrap();
    assert_eq!(restored, approvals);
    with_subject(
        &record,
        None,
        &drafts,
        &SynthesisSet::new(),
        &MomentSet::new(),
        &ALL,
        |subject| {
            assert_eq!(
                approvals.change_policy(q(2), 1, true, RuleAuthority::Coordinator, subject, &ALL),
                Err(PolicyError::QuorumProtection)
            );
            assert_eq!(
                approvals.change_policy(
                    q(4),
                    1,
                    true,
                    RuleAuthority::SiteOwner,
                    subject,
                    &ALL[..3]
                ),
                Err(PolicyError::QuorumUnavailable {
                    required: 4,
                    available: 3
                })
            );
            assert_eq!(
                approvals.change_policy(q(2), 1, true, RuleAuthority::SiteOwner, subject, &ALL),
                Ok(PolicyChange::Changed { cleared: 0 })
            );
        },
    );
}

#[test]
fn losing_and_regaining_a_quorum_approval_grant_does_not_revive_consent() {
    let mut record = record();
    let drafts = drafts(&["ann", "bo"]);
    let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    assert!(approvals.set_policy(ApprovalPolicy {
        requirement: ApprovalRequirement::Quorum(3),
        scope: ApprovalScope::WholePiece,
    }));
    for who in ["ann", "bo", "cy"] {
        approve(&record, &drafts, &mut approvals, &ALL, who);
    }
    assert_eq!(gate(&record, &drafts, &approvals, &ALL), Ok(()));
    let cy = record
        .authorization
        .bindings
        .iter_mut()
        .find(|binding| binding.participant_id == "cy")
        .unwrap();
    cy.roles = vec![AuthorizationRole::Coordinator, AuthorizationRole::Editor];
    with_subject(
        &record,
        None,
        &drafts,
        &SynthesisSet::new(),
        &MomentSet::new(),
        &ALL,
        |subject| {
            assert_eq!(approvals.reconcile(subject), Ok(1));
        },
    );
    record
        .authorization
        .bindings
        .iter_mut()
        .find(|binding| binding.participant_id == "cy")
        .unwrap()
        .roles
        .push(AuthorizationRole::Contributor);
    assert_eq!(
        gate(&record, &drafts, &approvals, &ALL),
        Err(AssemblyError::QuorumBlocked {
            approved: 2,
            required: 3
        })
    );
}

#[test]
fn quorum_churn_cannot_revive_consent_even_without_reconciliation() {
    let mut record = record();
    let drafts = drafts(&["ann", "bo"]);
    let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    assert!(approvals.set_policy(ApprovalPolicy {
        requirement: ApprovalRequirement::Quorum(3),
        scope: ApprovalScope::WholePiece,
    }));
    for who in ["ann", "bo", "cy"] {
        approve(&record, &drafts, &mut approvals, &ALL, who);
    }
    assert_eq!(gate(&record, &drafts, &approvals, &ALL), Ok(()));
    record.authorization.revision += 2;
    assert!(matches!(
        gate(&record, &drafts, &approvals, &ALL),
        Err(AssemblyError::Blocked { .. })
    ));
}

#[test]
fn whole_piece_rules_cannot_revive_consent_after_membership_or_access_changes() {
    for requirement in [
        ApprovalRequirement::AllAuthors,
        ApprovalRequirement::ContributingAuthors,
        ApprovalRequirement::NamedAuthors(vec!["cy".into()]),
        ApprovalRequirement::AuthorsWithRoles(vec![AuthorizationRole::Contributor]),
    ] {
        for membership_change in [true, false] {
            let mut record = record();
            let drafts = drafts(&["ann", "bo"]);
            let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
            approvals.set_policy(ApprovalPolicy {
                requirement: requirement.clone(),
                scope: ApprovalScope::WholePiece,
            });
            for who in ALL {
                approve(&record, &drafts, &mut approvals, &ALL, who);
            }
            assert_eq!(gate(&record, &drafts, &approvals, &ALL), Ok(()));
            if membership_change {
                record.collaboration.revision += 2;
            } else {
                record.authorization.revision += 2;
            }
            assert!(
                matches!(
                    gate(&record, &drafts, &approvals, &ALL),
                    Err(AssemblyError::Blocked { .. })
                ),
                "{requirement:?}, membership_change={membership_change}"
            );
        }
    }
}

#[test]
fn credit_selection_and_reversion_invalidate_whole_piece_approvals() {
    use openblog_core::assembly::with_credit_subject_for_participants;
    use openblog_core::shared_credit::{CreditChoice, CreditChoices};

    let record = record();
    let drafts = drafts(&["ann", "bo"]);
    let active = ["ann", "bo"];
    let mut choices = CreditChoices::default();
    choices
        .select("ann", "ann", "ann", 0, CreditChoice::Uncredited)
        .unwrap();
    choices
        .select("bo", "bo", "bo", 1, CreditChoice::Uncredited)
        .unwrap();
    let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    let synthesis = SynthesisSet::new();
    let moments = MomentSet::new();
    let first_token = with_credit_subject_for_participants(
        &record,
        None,
        &drafts,
        &synthesis,
        &moments,
        &active,
        &active,
        &choices,
        |subject| {
            let token = approvals.binding_for(subject, "ann").unwrap();
            for who in active {
                let seen = approvals.binding_for(subject, who).unwrap();
                approvals
                    .approve(who, who, subject, &seen, true, T)
                    .unwrap();
            }
            assert_eq!(approvals.evaluate(subject), Ok(Readiness::Ready));
            token
        },
    )
    .unwrap();
    choices
        .select(
            "bo",
            "bo",
            "bo",
            2,
            CreditChoice::DisplayName { name: "B".into() },
        )
        .unwrap();
    choices
        .select("bo", "bo", "bo", 3, CreditChoice::Uncredited)
        .unwrap();
    with_credit_subject_for_participants(
        &record,
        None,
        &drafts,
        &synthesis,
        &moments,
        &active,
        &active,
        &choices,
        |subject| {
            assert_ne!(approvals.binding_for(subject, "ann").unwrap(), first_token);
            assert!(matches!(
                approvals.evaluate(subject),
                Ok(Readiness::Blocked { .. })
            ));
            assert!(approvals
                .approve("ann", "ann", subject, &first_token, true, T)
                .is_err());
        },
    )
    .unwrap();
}

#[test]
fn participant_rules_require_readers_and_never_waive_writer_consent() {
    let record = record();
    let drafts = drafts(&["ann", "bo"]);
    let active = ["ann", "bo"];
    let people = ["ann", "bo", "cy"];
    for requirement in [
        ApprovalRequirement::AllParticipants,
        ApprovalRequirement::ParticipantQuorum(2),
    ] {
        let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
        assert!(approvals.set_policy(ApprovalPolicy {
            requirement: requirement.clone(),
            scope: ApprovalScope::WholePiece,
        }));
        openblog_core::assembly::with_subject_for_participants(
            &record,
            None,
            &drafts,
            &SynthesisSet::new(),
            &MomentSet::new(),
            &active,
            &people,
            |subject| {
                for who in ["ann", "cy"] {
                    let seen = approvals.binding_for(subject, who).unwrap();
                    approvals
                        .approve(who, who, subject, &seen, true, T)
                        .unwrap();
                }
                assert!(matches!(
                    approvals.evaluate(subject),
                    Ok(Readiness::Blocked { .. })
                ));
                let seen = approvals.binding_for(subject, "bo").unwrap();
                approvals
                    .approve("bo", "bo", subject, &seen, true, T)
                    .unwrap();
                assert_eq!(approvals.evaluate(subject), Ok(Readiness::Ready));
                assert!(approvals.binding_for(subject, "outside").is_err());
            },
        );
        let changed = ["ann", "bo"];
        openblog_core::assembly::with_subject_for_participants(
            &record,
            None,
            &drafts,
            &SynthesisSet::new(),
            &MomentSet::new(),
            &active,
            &changed,
            |subject| {
                assert!(matches!(
                    approvals.evaluate(subject),
                    Ok(Readiness::Blocked { .. })
                ));
            },
        );
    }
}

#[test]
fn legacy_section_only_bindings_remain_unchanged_by_revision_counters() {
    let mut record = record();
    record.initial_approval_scope = None;
    let drafts = drafts(&["ann", "bo"]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&record, &drafts, &mut approvals, &ALL, who);
    }
    assert_eq!(gate(&record, &drafts, &approvals, &ALL), Ok(()));
    record.collaboration.revision += 2;
    record.authorization.revision += 2;
    assert_eq!(gate(&record, &drafts, &approvals, &ALL), Ok(()));
}

#[test]
fn new_reflections_cannot_publish_section_only_approvals() {
    let mut record = record();
    record.initial_approval_scope = Some(ApprovalScope::WholePiece);
    let mut set = drafts(&["ann", "bo"]);
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        approve(&record, &set, &mut approvals, &ALL, who);
    }
    assert_eq!(
        gate(&record, &set, &approvals, &ALL),
        Err(AssemblyError::ApprovalScope)
    );
    record.initial_approval_scope = None;
    assert_eq!(gate(&record, &set, &approvals, &ALL), Ok(()));

    record.initial_approval_scope = Some(ApprovalScope::WholePiece);
    assert!(approvals.set_policy(ApprovalPolicy {
        requirement: ApprovalRequirement::AllAuthors,
        scope: ApprovalScope::WholePiece,
    }));
    for who in ALL {
        approve(&record, &set, &mut approvals, &ALL, who);
    }
    assert_eq!(gate(&record, &set, &approvals, &ALL), Ok(()));
    set.save("bo", "bo", 1, "changed", T + 1).unwrap();
    assert!(
        matches!(gate(&record, &set, &approvals, &ALL), Err(AssemblyError::Blocked { missing }) if missing == ["Ann", "Bo", "Cy", "Di"])
    );
}

fn change(
    record: &SharedPublication,
    set: &DraftSet,
    approvals: &mut ApprovalSet,
    active: &[&str],
    next: ApprovalPolicy,
    expected: u64,
) -> Result<PolicyChange, PolicyError> {
    with_subject(
        record,
        None,
        set,
        &SynthesisSet::new(),
        &MomentSet::new(),
        active,
        |subject| {
            approvals.change_policy(
                next,
                expected,
                true,
                RuleAuthority::SiteOwner,
                subject,
                active,
            )
        },
    )
}

#[test]
fn new_record_approvals_bind_participant_attribution() {
    let mut record = record();
    let set = drafts(&["ann", "bo"]);
    let active = ["ann", "bo"];
    let mut approvals = ApprovalSet::with_scope(ApprovalScope::WholePiece);
    for who in active {
        approve(&record, &set, &mut approvals, &active, who);
    }
    assert_eq!(gate(&record, &set, &approvals, &active), Ok(()));

    record.collaboration.participants[1].display_name = "Different name".into();
    assert!(matches!(
        gate(&record, &set, &approvals, &active),
        Err(AssemblyError::Blocked { .. })
    ));
    record.collaboration.participants[1].display_name = "Bo".into();
    record.authorization.bindings[1].contributor_id = "different-profile".into();
    assert!(matches!(
        gate(&record, &set, &approvals, &active),
        Err(AssemblyError::Blocked { .. })
    ));
}

#[test]
fn legacy_record_approvals_also_bind_participant_attribution() {
    let mut record = record();
    record.initial_approval_scope = None;
    let set = drafts(&["ann", "bo"]);
    let active = ["ann", "bo"];
    let mut approvals = ApprovalSet::new();
    for who in active {
        approve(&record, &set, &mut approvals, &active, who);
    }
    record.collaboration.participants[1].display_name = "Different name".into();
    record.authorization.bindings[1].contributor_id = "different-profile".into();
    assert!(matches!(
        gate(&record, &set, &approvals, &active),
        Err(AssemblyError::Blocked { .. })
    ));
}

#[test]
fn approvals_from_before_attribution_binding_need_review_again() {
    let mut record = record();
    record.initial_approval_scope = None;
    let set = drafts(&["ann", "bo"]);
    let active = ["ann", "bo"];
    let mut approvals = ApprovalSet::new();
    let old_metadata = public_metadata(&record);
    let old_metadata: Vec<_> = old_metadata.iter().map(String::as_str).collect();
    with_subject(
        &record,
        None,
        &set,
        &SynthesisSet::new(),
        &MomentSet::new(),
        &active,
        |subject| {
            let old = ApprovalSubject {
                metadata: &old_metadata,
                ..*subject
            };
            for who in active {
                let seen = approvals.binding_for(&old, who).unwrap();
                approvals.approve(who, who, &old, &seen, true, T).unwrap();
            }
        },
    );
    assert!(matches!(
        gate(&record, &set, &approvals, &active),
        Err(AssemblyError::Blocked { .. })
    ));
    for who in active {
        approve(&record, &set, &mut approvals, &active, who);
    }
    assert_eq!(gate(&record, &set, &approvals, &active), Ok(()));
}

#[test]
fn a_role_rule_reads_the_roles_from_the_bindings_and_losing_the_coordinator_blocks() {
    let record = record();
    let set = drafts(&["ann", "bo"]);
    let mut approvals = ApprovalSet::new();
    let coordinators = policy(ApprovalRequirement::AuthorsWithRoles(vec![
        AuthorizationRole::Coordinator,
    ]));
    assert_eq!(
        change(&record, &set, &mut approvals, &ALL, coordinators, 0),
        Ok(PolicyChange::Changed { cleared: 0 })
    );
    for who in ["ann", "bo"] {
        approve(&record, &set, &mut approvals, &ALL, who);
    }
    // Cy coordinates and is an author, so Cy must approve; Di is not required.
    assert_eq!(
        gate(&record, &set, &approvals, &ALL),
        Err(AssemblyError::Blocked {
            missing: vec!["Cy".into()]
        })
    );
    approve(&record, &set, &mut approvals, &ALL, "cy");
    assert_eq!(gate(&record, &set, &approvals, &ALL), Ok(()));
    // Cy loses access: no remaining author holds the role, so the bar is not silently lowered.
    let without_cy = ["ann", "bo", "di"];
    assert_eq!(
        gate(&record, &set, &approvals, &without_cy),
        Err(AssemblyError::RuleUnmet {
            named: vec![],
            roles: vec![AuthorizationRole::Coordinator],
        })
    );
    // Promoting another author to coordinator satisfies the rule once they approve.
    let mut promoted = record.clone();
    promoted.authorization.bindings[3].roles = vec![
        AuthorizationRole::Coordinator,
        AuthorizationRole::Contributor,
    ];
    let mut fresh = ApprovalSet::new();
    fresh.set_policy(policy(ApprovalRequirement::AuthorsWithRoles(vec![
        AuthorizationRole::Coordinator,
    ])));
    for who in ["ann", "bo"] {
        approve(&promoted, &set, &mut fresh, &without_cy, who);
    }
    assert!(matches!(
        gate(&promoted, &set, &fresh, &without_cy),
        Err(AssemblyError::Blocked { missing }) if missing == ["Di"]
    ));
    approve(&promoted, &set, &mut fresh, &without_cy, "di");
    assert_eq!(gate(&promoted, &set, &fresh, &without_cy), Ok(()));
}

#[test]
fn a_withdrawn_writer_has_an_explicit_resolution_under_every_author() {
    let record = record();
    // Di wrote and then withdrew: Di has no section, so the piece is Ann's and Bo's.
    let mut set = drafts(&["ann", "bo", "di"]);
    set.withdraw("di", "di").unwrap();
    let mut approvals = ApprovalSet::new();
    for who in ["ann", "bo", "cy"] {
        approve(&record, &set, &mut approvals, &ALL, who);
    }
    // Under "every author" Di still blocks; nobody can approve for them.
    assert_eq!(
        gate(&record, &set, &approvals, &ALL),
        Err(AssemblyError::Blocked {
            missing: vec!["Di".into()]
        })
    );
    // Resolution one: Di approves the piece without their section.
    let mut by_di = approvals.clone();
    approve(&record, &set, &mut by_di, &ALL, "di");
    assert_eq!(gate(&record, &set, &by_di, &ALL), Ok(()));
    // Resolution two: a coordinator names who must approve; every writer is still required.
    let named = policy(ApprovalRequirement::NamedAuthors(vec!["cy".into()]));
    assert_eq!(
        change(&record, &set, &mut approvals, &ALL, named, 0),
        Ok(PolicyChange::Changed { cleared: 3 })
    );
    assert!(gate(&record, &set, &approvals, &ALL).is_err());
    for who in ["ann", "bo", "cy"] {
        approve(&record, &set, &mut approvals, &ALL, who);
    }
    assert_eq!(gate(&record, &set, &approvals, &ALL), Ok(()));
}

#[test]
fn a_concurrent_approval_and_policy_change_cannot_both_count() {
    let record = record();
    let set = drafts(&["ann", "bo"]);
    let loaded = ApprovalSet::new();
    // Ann reads her token, then a coordinator changes the policy from the same loaded state.
    let seen = with_subject(
        &record,
        None,
        &set,
        &SynthesisSet::new(),
        &MomentSet::new(),
        &ALL,
        |s| loaded.binding_for(s, "ann").unwrap(),
    );
    let mut changed = loaded.clone();
    change(
        &record,
        &set,
        &mut changed,
        &ALL,
        policy(ApprovalRequirement::ContributingAuthors),
        0,
    )
    .unwrap();
    // Approving against the changed set with the old token is stale; nothing is recorded.
    let before = changed.clone();
    let result = with_subject(
        &record,
        None,
        &set,
        &SynthesisSet::new(),
        &MomentSet::new(),
        &ALL,
        |s| changed.approve("ann", "ann", s, &seen, true, T),
    );
    assert_eq!(result, Err(openblog_core::approval::ApprovalError::Stale));
    assert_eq!(changed, before);
    // And an approval that landed first is cleared by the change that follows it.
    let mut approved = loaded.clone();
    approve(&record, &set, &mut approved, &ALL, "ann");
    assert_eq!(
        change(
            &record,
            &set,
            &mut approved,
            &ALL,
            policy(ApprovalRequirement::ContributingAuthors),
            0,
        ),
        Ok(PolicyChange::Changed { cleared: 1 })
    );
    assert_eq!(
        gate(&record, &set, &approved, &ALL),
        Err(AssemblyError::Blocked {
            missing: vec!["Ann".into(), "Bo".into()]
        })
    );
}

/// A small deterministic generator, so the property test needs no dependency and replays.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn pick(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn coin(&mut self) -> bool {
        self.next().is_multiple_of(2)
    }
}

#[test]
fn under_membership_churn_no_rule_publishes_without_every_writers_own_approval() {
    let base = record();
    let mut rng = Lcg(0x5eed);
    let requirements = |rng: &mut Lcg| -> ApprovalRequirement {
        match rng.pick(4) {
            0 => ApprovalRequirement::AllAuthors,
            1 => ApprovalRequirement::ContributingAuthors,
            2 => {
                let mut named: Vec<String> = ALL
                    .iter()
                    .filter(|_| rng.coin())
                    .map(|id| id.to_string())
                    .collect();
                if named.is_empty() {
                    named.push("cy".into());
                }
                ApprovalRequirement::NamedAuthors(named)
            }
            _ => ApprovalRequirement::AuthorsWithRoles(
                [
                    AuthorizationRole::SiteOwner,
                    AuthorizationRole::Coordinator,
                    AuthorizationRole::Contributor,
                ]
                .into_iter()
                .filter(|_| rng.coin())
                .chain([AuthorizationRole::Coordinator])
                .fold(Vec::new(), |mut roles, role| {
                    if !roles.contains(&role) {
                        roles.push(role);
                    }
                    roles
                }),
            ),
        }
    };
    let mut ready_seen = 0;
    for _ in 0..400 {
        // Ann always stays (she is the last owner); the others churn.
        let active: Vec<&str> = ALL
            .iter()
            .copied()
            .filter(|id| *id == "ann" || rng.coin())
            .collect();
        let writers: Vec<&str> = active
            .iter()
            .copied()
            .filter(|id| *id == "ann" || rng.coin())
            .collect();
        let set = drafts(&writers);
        let mut approvals = ApprovalSet::new();
        let requirement = requirements(&mut rng);
        approvals.set_policy(policy(requirement.clone()));
        let mut approved = Vec::new();
        for who in &active {
            if rng.pick(4) != 0 {
                approve(&base, &set, &mut approvals, &active, who);
                approved.push(*who);
            }
        }
        let readiness = with_subject(
            &base,
            None,
            &set,
            &SynthesisSet::new(),
            &MomentSet::new(),
            &active,
            |s| approvals.evaluate(s).unwrap(),
        );
        // The named list in another order is the same rule with the same answer.
        if let ApprovalRequirement::NamedAuthors(named) = &requirement {
            let mut reversed = approvals.clone();
            let mut other = named.clone();
            other.reverse();
            assert!(!reversed.set_policy(policy(ApprovalRequirement::NamedAuthors(other))));
            assert_eq!(reversed, approvals);
        }
        match &readiness {
            Readiness::Ready => {
                ready_seen += 1;
                // Every writer approved for themselves, and the gate agrees.
                for writer in &writers {
                    assert!(approved.contains(writer), "{writer} {requirement:?}");
                }
                assert_eq!(gate(&base, &set, &approvals, &active), Ok(()));
                // Every named participant is an active author who approved.
                if let ApprovalRequirement::NamedAuthors(named) = &requirement {
                    for name in named {
                        assert!(approved.contains(&name.as_str()), "{name}");
                    }
                }
            }
            Readiness::Blocked { missing, gaps } => {
                assert!(gate(&base, &set, &approvals, &active).is_err());
                // Nobody missing is someone who approved this exact piece.
                for id in missing {
                    assert!(!approved.contains(&id.as_str()) || !active.contains(&id.as_str()));
                }
                if let ApprovalRequirement::NamedAuthors(named) = &requirement {
                    let gone: Vec<String> = named
                        .iter()
                        .filter(|n| !active.contains(&n.as_str()))
                        .cloned()
                        .collect();
                    assert_eq!(gaps.named, gone);
                }
            }
            Readiness::QuorumBlocked { .. } => {
                assert!(gate(&base, &set, &approvals, &active).is_err());
            }
        }
        // The stored set never holds an approval for someone who did not give one.
        let stored: serde_json::Value = serde_json::from_str(&approvals.to_json()).unwrap();
        for approval in stored["approvals"].as_array().unwrap() {
            let id = approval["participantId"].as_str().unwrap();
            assert!(approved.contains(&id), "{id}");
        }
    }
    assert!(
        ready_seen > 20,
        "the generator reaches ready pieces: {ready_seen}"
    );
}

#[test]
fn rule_gaps_name_ids_and_roles_only() {
    let gaps = RuleGaps {
        named: vec!["cy".into()],
        roles: vec![AuthorizationRole::SiteOwner],
    };
    assert_eq!(
        serde_json::to_string(&gaps).unwrap(),
        r#"{"named":["cy"],"roles":["siteOwner"]}"#
    );
}

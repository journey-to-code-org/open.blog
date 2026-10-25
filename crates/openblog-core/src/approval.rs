//! Approval snapshots: affirmative, attributable, timestamped consent bound to exact content.
//!
//! An approval says one author affirmed that the piece, as they saw it, may be published under
//! the stated policy. It is bound to a digest of exactly what it covers, so it can never carry
//! over to different content: the author's own section revisions (or, under the whole-piece
//! scope, every section revision), plus the frame the piece is published in (the author set,
//! the order and ownership of sections, the public title and source attribution) and the policy
//! revision. Nothing is "invalidated" by a stored flag. An approval counts only while the
//! recomputed binding equals the stored one, so a change nobody thought to hook still fails
//! closed. [`ApprovalSet::reconcile`] additionally drops stale approvals durably, so removing
//! and restoring an author or reverting an edit cannot revive consent given earlier.
//!
//! Only the person approving can approve or withdraw: the requester must equal the participant,
//! so no role, including the site owner, can forge or erase another author's consent. A
//! publish grant never replaces approval (ADR 0014); [`ApprovalSet::evaluate`] is the check the
//! publish gate runs, at publish time, against the content as it is then.
//!
//! The set stores digests, never prose, tokens, or names. Every refusal about another
//! participant is the same [`ApprovalError::Denied`], and a failed call changes nothing.

use std::collections::HashSet;
use std::fmt;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::collaboration::{valid_id, SharedPublication, MAX_CONTRIBUTIONS, MAX_PARTICIPANTS};
use crate::shared_source::SharedAttribution;

pub const APPROVAL_SET_VERSION: u8 = 1;
/// The wording of the consent an approver affirms. Bumping it invalidates older approvals.
pub const CONSENT_VERSION: u8 = 1;
pub const MAX_APPROVAL_SET_BYTES: usize = 64 * 1024;
const BINDING_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalError {
    /// The requester may not do this, or the target does not exist for them.
    Denied,
    /// The approver's view of the content is no longer the current content.
    Stale,
    /// The input is malformed, unaffirmed, or exceeds a limit.
    Invalid,
}

impl fmt::Display for ApprovalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Denied => "approval access denied",
            Self::Stale => "the content changed since it was read",
            Self::Invalid => "invalid approval",
        })
    }
}

impl std::error::Error for ApprovalError {}

/// Whose approval publication needs.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalRequirement {
    /// Every author the maintainer added, whether or not they wrote a section.
    #[default]
    AllAuthors,
    /// Only authors who own at least one published section.
    ContributingAuthors,
}

/// What an approval covers, which decides which edits invalidate it.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalScope {
    /// The approver's own section revisions. Another author's edit leaves it standing.
    #[default]
    OwnSections,
    /// Every section revision. Any prose edit invalidates every approval.
    WholePiece,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalPolicy {
    #[serde(default)]
    pub requirement: ApprovalRequirement,
    #[serde(default)]
    pub scope: ApprovalScope,
}

/// One exact section revision in the piece, in publication order. `digest` is the prose-free
/// digest of the revision (`RevisionStamp::digest`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Section<'a> {
    pub contribution_id: &'a str,
    pub owner: &'a str,
    pub revision: u64,
    pub digest: &'a str,
}

/// The piece as it would be published now: the author set, ordered sections, and public metadata.
#[derive(Clone, Copy, Debug)]
pub struct ApprovalSubject<'a> {
    pub authors: &'a [&'a str],
    pub sections: &'a [Section<'a>],
    pub metadata: &'a [&'a str],
}

/// The public, approvable metadata of a record: title and the source attribution that can reach
/// a page. Private source fields and collaboration state are not part of it.
pub fn public_metadata(record: &SharedPublication) -> Vec<String> {
    let mut metadata = vec![record.title.clone().unwrap_or_default()];
    if let Some(attribution) = SharedAttribution::from_record(record) {
        metadata.push(attribution.question.unwrap_or_default());
        if let Some(source) = attribution.source {
            metadata.push(source.title);
            metadata.push(source.url.unwrap_or_default());
            metadata.push(source.kind.label().to_string());
        }
    }
    metadata
}

/// Whether publication may proceed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Readiness {
    Ready,
    /// Participants whose approval is missing or no longer matches the content. Callers decide
    /// who may see this list.
    Blocked {
        missing: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Approval {
    participant_id: String,
    approved_at: i64,
    consent_version: u8,
    binding: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalSet {
    version: u8,
    #[serde(default)]
    policy: ApprovalPolicy,
    #[serde(default)]
    policy_revision: u64,
    #[serde(default)]
    approvals: Vec<Approval>,
}

impl Default for ApprovalSet {
    fn default() -> Self {
        Self::new()
    }
}

fn put(hasher: &mut Blake2s256, part: &[u8]) {
    hasher.update((part.len() as u64).to_be_bytes());
    hasher.update(part);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

impl ApprovalSubject<'_> {
    fn is_valid(&self) -> bool {
        if self.authors.is_empty()
            || self.authors.len() > MAX_PARTICIPANTS
            || self.sections.is_empty()
            || self.sections.len() > MAX_CONTRIBUTIONS
        {
            return false;
        }
        let mut authors = HashSet::new();
        if self
            .authors
            .iter()
            .any(|id| !valid_id(id) || !authors.insert(id.to_ascii_lowercase()))
        {
            return false;
        }
        let mut sections = HashSet::new();
        self.sections.iter().all(|section| {
            valid_id(section.contribution_id)
                && sections.insert(section.contribution_id.to_ascii_lowercase())
                && self.authors.contains(&section.owner)
                && section.digest.len() <= BINDING_BYTES
        })
    }

    fn has_author(&self, participant: &str) -> bool {
        self.authors.contains(&participant)
    }

    fn required(&self, requirement: ApprovalRequirement) -> Vec<&str> {
        self.authors
            .iter()
            .copied()
            .filter(|author| match requirement {
                ApprovalRequirement::AllAuthors => true,
                ApprovalRequirement::ContributingAuthors => {
                    self.sections.iter().any(|section| section.owner == *author)
                }
            })
            .collect()
    }

    fn binding(&self, policy: ApprovalPolicy, policy_revision: u64, participant: &str) -> String {
        let mut hasher = Blake2s256::new();
        hasher.update(b"openblog-approval-binding-v1\0");
        hasher.update([CONSENT_VERSION]);
        put(&mut hasher, format!("{policy:?}").as_bytes());
        hasher.update(policy_revision.to_be_bytes());
        put(&mut hasher, participant.as_bytes());
        let mut authors = self.authors.to_vec();
        authors.sort_unstable();
        hasher.update((authors.len() as u64).to_be_bytes());
        for author in authors {
            put(&mut hasher, author.as_bytes());
        }
        hasher.update((self.metadata.len() as u64).to_be_bytes());
        for value in self.metadata {
            put(&mut hasher, value.as_bytes());
        }
        // Order and ownership are part of the frame, so reordering invalidates everyone.
        hasher.update((self.sections.len() as u64).to_be_bytes());
        for section in self.sections {
            put(&mut hasher, section.contribution_id.as_bytes());
            put(&mut hasher, section.owner.as_bytes());
        }
        // Prose revisions: only what the scope covers. An author who owns no section has no
        // prose of their own to scope to, so their approval covers the whole piece.
        let owns_prose = self.sections.iter().any(|s| s.owner == participant);
        for section in self.sections {
            if policy.scope == ApprovalScope::WholePiece
                || !owns_prose
                || section.owner == participant
            {
                put(&mut hasher, section.contribution_id.as_bytes());
                hasher.update(section.revision.to_be_bytes());
                put(&mut hasher, section.digest.as_bytes());
            }
        }
        hex(&hasher.finalize())
    }
}

impl ApprovalSet {
    pub fn new() -> Self {
        Self {
            version: APPROVAL_SET_VERSION,
            policy: ApprovalPolicy::default(),
            policy_revision: 0,
            approvals: Vec::new(),
        }
    }

    pub fn from_json(source: &str) -> Result<Self, ApprovalError> {
        if source.len() > MAX_APPROVAL_SET_BYTES {
            return Err(ApprovalError::Invalid);
        }
        let set: Self = serde_json::from_str(source).map_err(|_| ApprovalError::Invalid)?;
        if !set.is_valid() {
            return Err(ApprovalError::Invalid);
        }
        Ok(set)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("an approval set always serializes")
    }

    fn is_valid(&self) -> bool {
        let mut seen = HashSet::new();
        self.version == APPROVAL_SET_VERSION
            && self.approvals.len() <= MAX_PARTICIPANTS
            && self.approvals.iter().all(|approval| {
                valid_id(&approval.participant_id)
                    && seen.insert(approval.participant_id.to_ascii_lowercase())
                    && approval.approved_at >= 0
                    && approval.consent_version == CONSENT_VERSION
                    && approval.binding.len() == BINDING_BYTES
                    && approval
                        .binding
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit())
            })
    }

    pub fn policy(&self) -> ApprovalPolicy {
        self.policy
    }

    /// Change the policy. A real change advances the policy revision and drops every approval,
    /// because consent given under one policy is not consent under another. Setting the current
    /// policy changes nothing. Returns whether anything changed.
    pub fn set_policy(&mut self, policy: ApprovalPolicy) -> bool {
        if policy == self.policy {
            return false;
        }
        self.policy = policy;
        self.policy_revision += 1;
        self.approvals.clear();
        true
    }

    /// The token an author's approval would bind to now. An approver reads it with the content
    /// and sends it back as `seen`, so the approval covers what they read, not what exists later.
    pub fn binding_for(
        &self,
        subject: &ApprovalSubject<'_>,
        participant: &str,
    ) -> Result<String, ApprovalError> {
        if !subject.has_author(participant) {
            return Err(ApprovalError::Denied);
        }
        if !subject.is_valid() {
            return Err(ApprovalError::Invalid);
        }
        Ok(subject.binding(self.policy, self.policy_revision, participant))
    }

    /// Record `participant`'s own approval of the content whose token they read. Only the
    /// participant can approve for themselves, and only as a current author. On any error the
    /// set is unchanged.
    pub fn approve(
        &mut self,
        requester: &str,
        participant: &str,
        subject: &ApprovalSubject<'_>,
        seen: &str,
        affirmed: bool,
        now: i64,
    ) -> Result<(), ApprovalError> {
        if requester != participant || !subject.has_author(participant) {
            return Err(ApprovalError::Denied);
        }
        if !affirmed || now < 0 || !subject.is_valid() {
            return Err(ApprovalError::Invalid);
        }
        let binding = subject.binding(self.policy, self.policy_revision, participant);
        if seen != binding {
            return Err(ApprovalError::Stale);
        }
        self.approvals
            .retain(|approval| approval.participant_id != participant);
        self.approvals.push(Approval {
            participant_id: participant.to_string(),
            approved_at: now,
            consent_version: CONSENT_VERSION,
            binding,
        });
        Ok(())
    }

    /// Take back one's own approval. Nobody else can withdraw it. Returns whether one stood.
    pub fn withdraw(&mut self, requester: &str, participant: &str) -> Result<bool, ApprovalError> {
        if requester != participant {
            return Err(ApprovalError::Denied);
        }
        let before = self.approvals.len();
        self.approvals
            .retain(|approval| approval.participant_id != participant);
        Ok(self.approvals.len() != before)
    }

    fn holds(&self, subject: &ApprovalSubject<'_>, participant: &str) -> bool {
        subject.has_author(participant)
            && self.approvals.iter().any(|approval| {
                approval.participant_id == participant
                    && approval.binding
                        == subject.binding(self.policy, self.policy_revision, participant)
            })
    }

    /// Whether `participant` has a standing approval of the content as it is now.
    pub fn is_approved(&self, subject: &ApprovalSubject<'_>, participant: &str) -> bool {
        subject.is_valid() && self.holds(subject, participant)
    }

    /// Drop every approval that no longer matches the content, including those of people who
    /// are no longer authors. Routes call it in the same write as any change to prose, order,
    /// metadata, or the author set. An invalid subject changes nothing. Returns how many dropped.
    pub fn reconcile(&mut self, subject: &ApprovalSubject<'_>) -> Result<usize, ApprovalError> {
        if !subject.is_valid() {
            return Err(ApprovalError::Invalid);
        }
        let before = self.approvals.len();
        let (policy, revision) = (self.policy, self.policy_revision);
        self.approvals.retain(|approval| {
            subject.has_author(&approval.participant_id)
                && approval.binding == subject.binding(policy, revision, &approval.participant_id)
        });
        Ok(before - self.approvals.len())
    }

    /// The publish gate's question, asked against the content as it is at that moment, so an
    /// edit between scheduling and publishing blocks publication. Time itself never expires or
    /// renews an approval. An invalid subject is an error, never `Ready`.
    pub fn evaluate(&self, subject: &ApprovalSubject<'_>) -> Result<Readiness, ApprovalError> {
        if !subject.is_valid() {
            return Err(ApprovalError::Invalid);
        }
        let missing: Vec<String> = subject
            .required(self.policy.requirement)
            .into_iter()
            .filter(|author| !self.holds(subject, author))
            .map(str::to_string)
            .collect();
        Ok(if missing.is_empty() {
            Readiness::Ready
        } else {
            Readiness::Blocked { missing }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 1_800_000_000;

    struct Piece {
        authors: Vec<&'static str>,
        sections: Vec<(&'static str, &'static str, u64, &'static str)>,
        metadata: Vec<&'static str>,
    }

    impl Piece {
        fn new() -> Self {
            Self {
                authors: vec!["ann", "bo"],
                sections: vec![("ann-s", "ann", 1, "d-a1"), ("bo-s", "bo", 1, "d-b1")],
                metadata: vec!["Title", "Question?"],
            }
        }
        fn with<R>(&self, run: impl FnOnce(&ApprovalSubject<'_>) -> R) -> R {
            let sections: Vec<Section<'_>> = self
                .sections
                .iter()
                .map(|(contribution_id, owner, revision, digest)| Section {
                    contribution_id,
                    owner,
                    revision: *revision,
                    digest,
                })
                .collect();
            run(&ApprovalSubject {
                authors: &self.authors,
                sections: &sections,
                metadata: &self.metadata,
            })
        }
    }

    fn approve(set: &mut ApprovalSet, piece: &Piece, who: &str) {
        piece.with(|subject| {
            let seen = set.binding_for(subject, who).unwrap();
            set.approve(who, who, subject, &seen, true, T).unwrap();
        });
    }

    fn ready(set: &ApprovalSet, piece: &Piece) -> bool {
        piece.with(|s| set.evaluate(s).unwrap() == Readiness::Ready)
    }

    fn missing(set: &ApprovalSet, piece: &Piece) -> Vec<String> {
        piece.with(|s| match set.evaluate(s).unwrap() {
            Readiness::Blocked { missing } => missing,
            Readiness::Ready => Vec::new(),
        })
    }

    fn both() -> (ApprovalSet, Piece) {
        let mut set = ApprovalSet::new();
        let piece = Piece::new();
        approve(&mut set, &piece, "ann");
        approve(&mut set, &piece, "bo");
        (set, piece)
    }

    fn without_bo() -> Piece {
        let mut piece = Piece::new();
        piece.authors.retain(|a| *a != "bo");
        piece.sections.retain(|s| s.1 != "bo");
        piece
    }

    #[test]
    fn approval_is_affirmative_attributable_timestamped_and_revision_bound() {
        let mut set = ApprovalSet::new();
        let piece = Piece::new();
        assert_eq!(missing(&set, &piece), ["ann", "bo"]);
        piece.with(|s| {
            let seen = set.binding_for(s, "ann").unwrap();
            assert_eq!(
                set.approve("ann", "ann", s, &seen, false, T),
                Err(ApprovalError::Invalid)
            );
            assert!(!set.is_approved(s, "ann"));
            set.approve("ann", "ann", s, &seen, true, T).unwrap();
            assert!(set.is_approved(s, "ann"));
        });
        let json = set.to_json();
        assert!(json.contains("\"participantId\":\"ann\""));
        assert!(json.contains(&format!("\"approvedAt\":{T}")));
        assert!(json.contains("\"consentVersion\":1"));
        assert_eq!(ApprovalSet::from_json(&json).unwrap(), set);
    }

    #[test]
    fn an_edit_invalidates_only_the_owner_under_own_sections_scope() {
        let (set, mut piece) = both();
        assert!(ready(&set, &piece));
        piece.sections[1].2 = 2;
        piece.sections[1].3 = "d-b2";
        assert_eq!(missing(&set, &piece), ["bo"]);
        piece.with(|s| assert!(set.is_approved(s, "ann")));
    }

    #[test]
    fn whole_piece_scope_invalidates_everyone_on_any_prose_edit() {
        let mut set = ApprovalSet::new();
        set.set_policy(ApprovalPolicy {
            scope: ApprovalScope::WholePiece,
            ..Default::default()
        });
        let mut piece = Piece::new();
        approve(&mut set, &piece, "ann");
        approve(&mut set, &piece, "bo");
        assert!(ready(&set, &piece));
        piece.sections[1].3 = "d-b2";
        assert_eq!(missing(&set, &piece), ["ann", "bo"]);
    }

    #[test]
    fn metadata_reorder_and_author_set_changes_invalidate_everyone() {
        let (set, piece) = both();
        let mut renamed = Piece::new();
        renamed.metadata[0] = "Other title";
        assert_eq!(missing(&set, &renamed), ["ann", "bo"]);
        let mut reordered = Piece::new();
        reordered.sections.reverse();
        assert_eq!(missing(&set, &reordered), ["ann", "bo"]);
        let mut joined = Piece::new();
        joined.authors.push("cy");
        assert_eq!(missing(&set, &joined), ["ann", "bo", "cy"]);
        assert_eq!(missing(&set, &without_bo()), ["ann"]);
        assert!(ready(&set, &piece));
    }

    #[test]
    fn removal_and_restore_cannot_revive_consent_once_reconciled() {
        let (mut set, piece) = both();
        without_bo().with(|s| assert_eq!(set.reconcile(s), Ok(2)));
        assert_eq!(missing(&set, &piece), ["ann", "bo"]);
    }

    #[test]
    fn reconcile_keeps_matching_approvals_and_drops_stale_ones() {
        let (mut set, mut piece) = both();
        piece.sections[0].3 = "d-a2";
        piece.with(|s| assert_eq!(set.reconcile(s), Ok(1)));
        piece.sections[0].3 = "d-a1";
        assert_eq!(missing(&set, &piece), ["ann"]);
    }

    #[test]
    fn a_policy_change_drops_approvals_and_cannot_be_reverted_into_consent() {
        let (mut set, piece) = both();
        assert!(!set.set_policy(ApprovalPolicy::default()));
        assert!(ready(&set, &piece));
        assert!(set.set_policy(ApprovalPolicy {
            requirement: ApprovalRequirement::ContributingAuthors,
            ..Default::default()
        }));
        assert!(!ready(&set, &piece));
        set.set_policy(ApprovalPolicy::default());
        assert_eq!(missing(&set, &piece), ["ann", "bo"]);
    }

    #[test]
    fn requirement_policy_decides_who_must_approve() {
        let mut piece = Piece::new();
        piece.authors.push("cy");
        let mut set = ApprovalSet::new();
        approve(&mut set, &piece, "ann");
        approve(&mut set, &piece, "bo");
        assert_eq!(missing(&set, &piece), ["cy"]);
        set.set_policy(ApprovalPolicy {
            requirement: ApprovalRequirement::ContributingAuthors,
            ..Default::default()
        });
        approve(&mut set, &piece, "ann");
        approve(&mut set, &piece, "bo");
        assert!(ready(&set, &piece));
    }

    #[test]
    fn a_non_contributing_authors_approval_covers_the_whole_piece() {
        let mut piece = Piece::new();
        piece.authors.push("cy");
        let mut set = ApprovalSet::new();
        approve(&mut set, &piece, "ann");
        approve(&mut set, &piece, "bo");
        approve(&mut set, &piece, "cy");
        assert!(ready(&set, &piece));
        piece.sections[1].2 = 2;
        piece.sections[1].3 = "d-b2";
        assert_eq!(missing(&set, &piece), ["bo", "cy"]);
        piece.with(|s| assert!(set.is_approved(s, "ann")));
    }

    #[test]
    fn nobody_can_forge_or_erase_another_authors_consent() {
        let mut set = ApprovalSet::new();
        let piece = Piece::new();
        piece.with(|s| {
            let seen = set.binding_for(s, "bo").unwrap();
            for requester in ["ann", "owner", "", "BO"] {
                assert_eq!(
                    set.approve(requester, "bo", s, &seen, true, T),
                    Err(ApprovalError::Denied)
                );
            }
            // A non-author cannot approve even for themselves.
            assert_eq!(
                set.approve("owner", "owner", s, &seen, true, T),
                Err(ApprovalError::Denied)
            );
            assert_eq!(set.binding_for(s, "owner"), Err(ApprovalError::Denied));
        });
        assert_eq!(set, ApprovalSet::new());
        let (mut set, _) = both();
        let before = set.clone();
        assert_eq!(set.withdraw("owner", "bo"), Err(ApprovalError::Denied));
        assert_eq!(set.withdraw("ann", "bo"), Err(ApprovalError::Denied));
        assert_eq!(set, before);
    }

    #[test]
    fn a_stale_view_is_refused_without_changing_anything() {
        let mut set = ApprovalSet::new();
        let mut piece = Piece::new();
        let seen = piece.with(|s| set.binding_for(s, "ann").unwrap());
        piece.sections[0].3 = "d-a2";
        piece.with(|s| {
            assert_eq!(
                set.approve("ann", "ann", s, &seen, true, T),
                Err(ApprovalError::Stale)
            );
            assert_eq!(
                set.approve("ann", "ann", s, "junk", true, T),
                Err(ApprovalError::Stale)
            );
        });
        assert_eq!(set, ApprovalSet::new());
    }

    #[test]
    fn withdrawal_and_reapproval() {
        let (mut set, piece) = both();
        assert_eq!(set.withdraw("bo", "bo"), Ok(true));
        assert_eq!(set.withdraw("bo", "bo"), Ok(false));
        assert_eq!(missing(&set, &piece), ["bo"]);
        approve(&mut set, &piece, "bo");
        assert!(ready(&set, &piece));
    }

    #[test]
    fn an_edit_between_scheduling_and_publishing_blocks_and_time_changes_nothing() {
        let (set, mut piece) = both();
        // Scheduled: the approvals stand however long the delay is.
        assert!(ready(&set, &piece));
        // Publish time: the content changed since.
        piece.sections[0].2 = 2;
        piece.sections[0].3 = "d-a2";
        assert_eq!(missing(&set, &piece), ["ann"]);
    }

    #[test]
    fn invalid_subjects_never_read_as_ready() {
        let (mut set, piece) = both();
        let before = set.clone();
        let cases: [fn(&mut Piece); 5] = [
            |p| p.authors.clear(),
            |p| p.sections.clear(),
            |p| p.sections[0].1 = "stranger",
            |p| p.sections[1].0 = "ann-s",
            |p| p.authors.push("ANN"),
        ];
        for mutate in cases {
            let mut broken = Piece::new();
            mutate(&mut broken);
            broken.with(|s| {
                assert_eq!(set.evaluate(s), Err(ApprovalError::Invalid));
                assert_eq!(set.reconcile(s), Err(ApprovalError::Invalid));
                assert!(!set.is_approved(s, "ann"));
            });
        }
        assert_eq!(set, before);
        assert!(ready(&set, &piece));
    }

    #[test]
    fn untrusted_stored_data_fails_to_load() {
        let (set, _) = both();
        let good = set.to_json();
        assert!(ApprovalSet::from_json(&good).is_ok());
        let at = good.find("\"binding\":\"").unwrap() + 11;
        let short = format!("{}ab{}", &good[..at], &good[at + 64..]);
        for bad in [
            good.replace("\"ann\"", "\"an n\""),
            short,
            good.replace("\"version\":1", "\"version\":2"),
            good.replace("\"consentVersion\":1", "\"consentVersion\":9"),
            good.replace("\"approvedAt\":1800000000", "\"approvedAt\":-1"),
            good.replace("}]}", "}],\"extra\":1}"),
            good.replace("\"participantId\":\"bo\"", "\"participantId\":\"ANN\""),
            "{".to_string(),
            "x".repeat(MAX_APPROVAL_SET_BYTES + 1),
        ] {
            assert_eq!(
                ApprovalSet::from_json(&bad),
                Err(ApprovalError::Invalid),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_stored_set_holds_no_prose_names_or_revision_digests() {
        let (set, _) = both();
        let json = set.to_json();
        for secret in ["Title", "Question?", "d-a1", "d-b1", "ann-s"] {
            assert!(!json.contains(secret), "{secret}");
        }
        assert!(!format!("{set:?}").contains("Question?"));
    }

    #[test]
    fn public_metadata_follows_only_the_public_attribution() {
        use crate::collaboration::{
            NewParticipant, NewSharedPublication, NewSourceReference, SourceKind,
        };
        let mut record = SharedPublication::create(&NewSharedPublication {
            publication_id: "pub".into(),
            title: "T".into(),
            guiding_question: "Q?".into(),
            sources: vec![NewSourceReference {
                kind: SourceKind::Article,
                title: "Src".into(),
                url: "https://example.com/a".into(),
                creator: "Private Creator".into(),
                ..Default::default()
            }],
            creator: NewParticipant {
                admin_user: "owner".into(),
                contributor_id: "owner".into(),
                display_name: "Owner".into(),
            },
        })
        .unwrap();
        let before = public_metadata(&record);
        assert_eq!(&before[..4], ["T", "Q?", "Src", "https://example.com/a"]);
        assert!(!before.concat().contains("Private Creator"));
        record.collaboration.revision += 1;
        record.sources[0].creator = Some("Someone Else".into());
        assert_eq!(public_metadata(&record), before);
        record.guiding_question = Some("Other?".into());
        assert_ne!(public_metadata(&record), before);
    }
}

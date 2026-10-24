//! Group-safe contracts shared by future collaboration capabilities.

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt};

use http::Uri;

use crate::contributor;

pub const COLLABORATION_CONTRACT_VERSION: u8 = 1;
pub const MAX_CONTRACT_BYTES: usize = 256 * 1024;
pub const MAX_PARTICIPANTS: usize = 100;
pub const MAX_CONTRIBUTIONS: usize = 1_000;
pub const MAX_REVEALS: usize = 1_000;
pub const MAX_LAYOUT_ITEMS: usize = 1_000;
pub const MAX_APPROVALS: usize = MAX_PARTICIPANTS;
pub const MAX_IDENTIFIER_BYTES: usize = 128;
pub const MAX_DISPLAY_NAME_BYTES: usize = 200;
pub const MAX_PROFILE_URL_BYTES: usize = 2_048;
pub const MAX_MARKDOWN_BYTES: usize = 64 * 1024;
pub const MAX_REGION_BYTES: usize = 64;
pub const COLLABORATION_AUTHORIZATION_VERSION: u8 = 1;
pub const MAX_AUTHORIZATION_POLICY_BYTES: usize = 64 * 1024;
pub const MAX_AUTHORIZATION_BINDINGS: usize = MAX_PARTICIPANTS;
pub const MAX_ADMIN_USERNAME_BYTES: usize = 32;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CollaborationContract {
    pub version: u8,
    pub revision: u64,
    pub participants: Vec<Participant>,
    pub contributions: Vec<Contribution>,
    pub reveals: Vec<Reveal>,
    pub layout: Vec<LayoutItem>,
    pub approvals: Vec<Approval>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Contribution {
    pub id: String,
    pub participant_id: String,
    pub markdown: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Reveal {
    pub contribution_id: String,
    pub participant_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LayoutItem {
    pub contribution_id: String,
    pub region: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Approval {
    pub participant_id: String,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PairProjection<'a> {
    pub first: &'a Participant,
    pub second: &'a Participant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollaborationError {
    InvalidContract,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthorizationPolicy {
    pub version: u8,
    pub revision: u64,
    pub publication_id: String,
    pub bindings: Vec<IdentityBinding>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IdentityBinding {
    pub admin_user: String,
    pub contributor_id: String,
    pub participant_id: String,
    pub roles: Vec<AuthorizationRole>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthorizationRole {
    SiteOwner,
    Coordinator,
    Contributor,
    Editor,
    Reader,
}

/// A collaboration action an authenticated request asks to perform. Each action takes exactly one
/// [`AuthorizationTarget`] kind; a target of any other kind is denied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthorizationAction {
    /// Read the published projection. Targets the publication.
    ViewPublished,
    /// Read one contribution draft whose reveal lists the requester. Targets a contribution.
    ViewRevealed,
    /// Read one contribution draft's private content. Targets a contribution.
    ViewContribution,
    /// Change one contribution draft. Targets a contribution.
    EditContribution,
    /// Start an invitation into the publication. Targets the publication.
    Invite,
    /// Reveal one's own contribution draft. Targets a contribution.
    RevealContribution,
    /// Submit one's own approval of the current revision. Targets a participant.
    ApproveContribution,
    /// Request a publication time. Targets the publication.
    Schedule,
    /// Request publication. Targets the publication.
    Publish,
    /// Remove a participant from the publication. Targets a participant.
    RemoveMember,
    /// Export the published projection, never private collaboration state. Targets the
    /// publication.
    Export,
}

/// What a request acts on. Participant and contribution IDs come from the request and resolve
/// against the server-side collaboration contract; ownership and reveal recipients are read from
/// that contract, never from the request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthorizationTarget<'a> {
    Publication,
    Participant(&'a str),
    Contribution(&'a str),
}

/// Server-side facts for one request. Callers fill the identity fields from the authenticated
/// session, the current Admin users file, and the current contributor registry, load the policy
/// and contract from the same publication record, and authorize inside the same transaction as
/// any change the grant permits.
pub struct AuthorizationContext<'a> {
    pub publication_id: &'a str,
    pub authenticated_admin_user: &'a str,
    pub active_admin_users: &'a [&'a str],
    pub contributor_ids: &'a [&'a str],
    pub collaboration: &'a CollaborationContract,
    pub target: AuthorizationTarget<'a>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuthorizationError;

impl fmt::Display for AuthorizationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("collaboration access denied")
    }
}

impl std::error::Error for AuthorizationError {}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TargetKind {
    Publication,
    Participant,
    Contribution,
}

/// A target resolved against the contract, from the bound participant's point of view.
enum ResolvedTarget<'a> {
    Publication,
    Participant {
        id: &'a str,
        site_owner: bool,
    },
    Contribution {
        owner: &'a str,
        revealed_to_requester: bool,
    },
}

impl AuthorizationAction {
    fn target_kind(self) -> TargetKind {
        use AuthorizationAction::*;
        match self {
            ViewPublished | Invite | Schedule | Publish | Export => TargetKind::Publication,
            ApproveContribution | RemoveMember => TargetKind::Participant,
            ViewRevealed | ViewContribution | EditContribution | RevealContribution => {
                TargetKind::Contribution
            }
        }
    }
}

impl AuthorizationPolicy {
    pub fn from_json(source: &str) -> Result<Self, AuthorizationError> {
        if source.len() > MAX_AUTHORIZATION_POLICY_BYTES {
            return Err(AuthorizationError);
        }
        let policy: Self = serde_json::from_str(source).map_err(|_| AuthorizationError)?;
        if policy.version != COLLABORATION_AUTHORIZATION_VERSION
            || !valid_id(&policy.publication_id)
            || policy.bindings.len() > MAX_AUTHORIZATION_BINDINGS
        {
            return Err(AuthorizationError);
        }
        let mut admin_users = HashSet::with_capacity(policy.bindings.len());
        let mut contributor_ids = HashSet::with_capacity(policy.bindings.len());
        let mut participant_keys = HashSet::with_capacity(policy.bindings.len());
        for binding in &policy.bindings {
            let mut roles = HashSet::with_capacity(binding.roles.len());
            if !valid_admin_username(&binding.admin_user)
                || !valid_contributor_id(&binding.contributor_id)
                || !valid_id(&binding.participant_id)
                || binding.roles.is_empty()
                || !admin_users.insert(binding.admin_user.as_str())
                || !contributor_ids.insert(binding.contributor_id.as_str())
                || !participant_keys.insert(binding.participant_id.to_ascii_lowercase())
                || binding.roles.iter().any(|role| !roles.insert(*role))
            {
                return Err(AuthorizationError);
            }
        }
        Ok(policy)
    }

    /// Replace the complete publication policy after an optimistic revision check.
    /// Returning a new value keeps malformed, stale, or cross-publication input atomic.
    pub fn replace_from_json(
        &self,
        source: &str,
        expected_revision: u64,
    ) -> Result<Self, AuthorizationError> {
        if self.revision != expected_revision {
            return Err(AuthorizationError);
        }
        let replacement = Self::from_json(source)?;
        if replacement.publication_id != self.publication_id
            || expected_revision.checked_add(1) != Some(replacement.revision)
        {
            return Err(AuthorizationError);
        }
        Ok(replacement)
    }

    /// Deny by default: the request must come from an active Admin user whose binding in this
    /// publication still resolves to a registry key and a current participant, and one of the
    /// binding's roles must allow `action` on the resolved target. A grant permits the request;
    /// it never records authorship, credit, a reveal, or an approval.
    pub fn authorize<'a>(
        &'a self,
        context: &AuthorizationContext<'_>,
        action: AuthorizationAction,
    ) -> Result<&'a IdentityBinding, AuthorizationError> {
        if self.publication_id != context.publication_id
            || !context
                .active_admin_users
                .contains(&context.authenticated_admin_user)
        {
            return Err(AuthorizationError);
        }
        let binding = self
            .bindings
            .iter()
            .find(|binding| binding.admin_user == context.authenticated_admin_user)
            .ok_or(AuthorizationError)?;
        let collaboration = context.collaboration;
        if !context
            .contributor_ids
            .contains(&binding.contributor_id.as_str())
            || !collaboration
                .participants
                .iter()
                .any(|participant| participant.id == binding.participant_id)
        {
            return Err(AuthorizationError);
        }

        let own = binding.participant_id.as_str();
        let target = match (action.target_kind(), context.target) {
            (TargetKind::Publication, AuthorizationTarget::Publication) => {
                ResolvedTarget::Publication
            }
            (TargetKind::Participant, AuthorizationTarget::Participant(id)) => {
                let participant = collaboration
                    .participants
                    .iter()
                    .find(|participant| participant.id == id)
                    .ok_or(AuthorizationError)?;
                ResolvedTarget::Participant {
                    id: participant.id.as_str(),
                    site_owner: self.bindings.iter().any(|other| {
                        other.participant_id == participant.id
                            && other.roles.contains(&AuthorizationRole::SiteOwner)
                    }),
                }
            }
            (TargetKind::Contribution, AuthorizationTarget::Contribution(id)) => {
                let contribution = collaboration
                    .contributions
                    .iter()
                    .find(|contribution| contribution.id == id)
                    .ok_or(AuthorizationError)?;
                ResolvedTarget::Contribution {
                    owner: contribution.participant_id.as_str(),
                    revealed_to_requester: collaboration.reveals.iter().any(|reveal| {
                        reveal.contribution_id == contribution.id
                            && reveal.participant_ids.iter().any(|viewer| viewer == own)
                    }),
                }
            }
            _ => return Err(AuthorizationError),
        };
        if binding
            .roles
            .iter()
            .any(|role| role_allows(*role, action, &target, own))
        {
            Ok(binding)
        } else {
            Err(AuthorizationError)
        }
    }
}

/// The complete role matrix. Anything not listed is denied, so a new role or action starts with
/// no access.
fn role_allows(
    role: AuthorizationRole,
    action: AuthorizationAction,
    target: &ResolvedTarget<'_>,
    own: &str,
) -> bool {
    use AuthorizationAction::*;
    use AuthorizationRole::*;

    match (role, action, target) {
        (SiteOwner | Coordinator | Contributor | Editor | Reader, ViewPublished | Export, _) => {
            true
        }
        (
            SiteOwner | Coordinator | Contributor | Editor | Reader,
            ViewRevealed,
            ResolvedTarget::Contribution {
                revealed_to_requester,
                ..
            },
        ) => *revealed_to_requester,
        (SiteOwner | Coordinator, Invite | Schedule | Publish, _) => true,
        (SiteOwner, RemoveMember, ResolvedTarget::Participant { .. }) => true,
        (Coordinator, RemoveMember, ResolvedTarget::Participant { site_owner, .. }) => !site_owner,
        (
            Contributor,
            ViewContribution | EditContribution | RevealContribution,
            ResolvedTarget::Contribution { owner, .. },
        ) => *owner == own,
        (Contributor, ApproveContribution, ResolvedTarget::Participant { id, .. }) => *id == own,
        (
            Editor,
            ViewContribution | EditContribution,
            ResolvedTarget::Contribution {
                owner,
                revealed_to_requester,
            },
        ) => *owner == own || *revealed_to_requester,
        _ => false,
    }
}

impl fmt::Display for CollaborationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("invalid collaboration contract")
    }
}

impl std::error::Error for CollaborationError {}

impl CollaborationContract {
    pub fn from_json(source: &str) -> Result<Self, CollaborationError> {
        if source.len() > MAX_CONTRACT_BYTES {
            return Err(CollaborationError::InvalidContract);
        }
        let contract: Self =
            serde_json::from_str(source).map_err(|_| CollaborationError::InvalidContract)?;
        if !contract.is_valid() {
            return Err(CollaborationError::InvalidContract);
        }
        Ok(contract)
    }

    /// Parse a complete replacement only when the caller observed the current revision.
    /// The existing value is never mutated, so parse, validation, or concurrency failures
    /// cannot partially apply participant data.
    pub fn replace_from_json(
        &self,
        source: &str,
        expected_revision: u64,
    ) -> Result<Self, CollaborationError> {
        if self.revision != expected_revision {
            return Err(CollaborationError::InvalidContract);
        }
        let replacement = Self::from_json(source)?;
        if expected_revision.checked_add(1) != Some(replacement.revision) {
            return Err(CollaborationError::InvalidContract);
        }
        Ok(replacement)
    }

    pub fn pair_projection(&self) -> Option<PairProjection<'_>> {
        let [first, second] = self.participants.as_slice() else {
            return None;
        };
        Some(PairProjection { first, second })
    }

    fn is_valid(&self) -> bool {
        if self.version != COLLABORATION_CONTRACT_VERSION
            || self.participants.is_empty()
            || self.participants.len() > MAX_PARTICIPANTS
            || self.contributions.len() > MAX_CONTRIBUTIONS
            || self.reveals.len() > MAX_REVEALS
            || self.layout.len() > MAX_LAYOUT_ITEMS
            || self.approvals.len() > MAX_APPROVALS
        {
            return false;
        }

        let mut participant_ids = HashSet::with_capacity(self.participants.len());
        let mut participant_keys = HashSet::with_capacity(self.participants.len());
        for participant in &self.participants {
            if !valid_id(&participant.id)
                || !participant_ids.insert(participant.id.as_str())
                || !participant_keys.insert(participant.id.to_ascii_lowercase())
                || !valid_text(&participant.display_name, MAX_DISPLAY_NAME_BYTES)
                || participant
                    .profile_url
                    .as_deref()
                    .is_some_and(|url| !valid_profile_url(url))
            {
                return false;
            }
        }

        let mut contribution_ids = HashSet::with_capacity(self.contributions.len());
        let mut contribution_keys = HashSet::with_capacity(self.contributions.len());
        for contribution in &self.contributions {
            if !valid_id(&contribution.id)
                || !contribution_ids.insert(contribution.id.as_str())
                || !contribution_keys.insert(contribution.id.to_ascii_lowercase())
                || !participant_ids.contains(contribution.participant_id.as_str())
                || contribution.markdown.len() > MAX_MARKDOWN_BYTES
                || contribution.markdown.contains('\0')
            {
                return false;
            }
        }

        let mut revealed_contributions = HashSet::with_capacity(self.reveals.len());
        for reveal in &self.reveals {
            let mut viewers = HashSet::with_capacity(reveal.participant_ids.len());
            if !contribution_ids.contains(reveal.contribution_id.as_str())
                || !revealed_contributions.insert(reveal.contribution_id.as_str())
                || reveal.participant_ids.is_empty()
                || reveal.participant_ids.len() > MAX_PARTICIPANTS
                || reveal.participant_ids.iter().any(|id| {
                    !participant_ids.contains(id.as_str()) || !viewers.insert(id.as_str())
                })
            {
                return false;
            }
        }

        let mut laid_out_contributions = HashSet::with_capacity(self.layout.len());
        for item in &self.layout {
            if !contribution_ids.contains(item.contribution_id.as_str())
                || !laid_out_contributions.insert(item.contribution_id.as_str())
                || !valid_slug(&item.region, MAX_REGION_BYTES)
            {
                return false;
            }
        }

        let mut approvers = HashSet::with_capacity(self.approvals.len());
        self.approvals.iter().all(|approval| {
            participant_ids.contains(approval.participant_id.as_str())
                && approvers.insert(approval.participant_id.as_str())
                && approval.revision == self.revision
        })
    }
}

fn valid_id(value: &str) -> bool {
    valid_slug(value, MAX_IDENTIFIER_BYTES)
}

/// The Admin sign-in username rule, owned here so the CLI's users file and a binding's
/// `adminUser` cannot drift apart: every account that can sign in can be bound, and a binding
/// can never name an account that could not exist.
pub fn valid_admin_username(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_ADMIN_USERNAME_BYTES
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'.' | b'-')
        })
}

/// A binding names an existing contributor registry key, so it uses the registry key rule.
fn valid_contributor_id(value: &str) -> bool {
    value.len() <= MAX_IDENTIFIER_BYTES && contributor::valid_registry_key(value)
}

/// Opaque ASCII identifiers may later key files or URLs, so `.` is only a separator:
/// dot segments such as `.` and `..` can never be expressed, and Windows device stems are
/// refused. Contract collections compare participant and contribution IDs ASCII
/// case-insensitively, so two entries cannot share one key on a case-insensitive filesystem.
fn valid_slug(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !value.starts_with(['-', '_', '.'])
        && !value.ends_with(['-', '_', '.'])
        && !value.contains("..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && !is_windows_device_stem(value.split('.').next().unwrap_or(value))
}

fn is_windows_device_stem(stem: &str) -> bool {
    let stem = stem.to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// Identity text keeps ordinary Unicode, including joiners used by scripts and emoji, but
/// rejects controls that could reorder another participant's name or make it invisible.
fn valid_text(value: &str, max_bytes: usize) -> bool {
    value.len() <= max_bytes
        && !value.chars().any(|character| {
            character.is_control() || is_line_break(character) || is_bidi_control(character)
        })
        && value
            .chars()
            .any(|character| !character.is_whitespace() && !is_invisible(character))
}

fn is_bidi_control(character: char) -> bool {
    matches!(
        character,
        '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'
    )
}

/// Unicode line and paragraph separators are not `Cc` controls but still break a name
/// across lines.
fn is_line_break(character: char) -> bool {
    matches!(character, '\u{2028}' | '\u{2029}')
}

/// Default_Ignorable_Code_Point plus blank-rendering fillers. These remain allowed inside a
/// name, where joiners, variation selectors, and emoji tags are legitimate, but a name made only
/// of them would render as nobody.
fn is_invisible(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{034F}'
            | '\u{061C}'
            | '\u{115F}'..='\u{1160}'
            | '\u{17B4}'..='\u{17B5}'
            | '\u{180B}'..='\u{180F}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{206F}'
            | '\u{2800}'
            | '\u{3164}'
            | '\u{FE00}'..='\u{FE0F}'
            | '\u{FEFF}'
            | '\u{FFA0}'
            | '\u{FFF0}'..='\u{FFF8}'
            | '\u{1BCA0}'..='\u{1BCA3}'
            | '\u{1D159}'
            | '\u{1D173}'..='\u{1D17A}'
            | '\u{E0000}'..='\u{E0FFF}'
    )
}

/// Reuse the contributor profile-link rules, narrowed to absolute HTTPS because a
/// collaboration contract has no site context against which a relative link could resolve.
/// Non-ASCII must be percent-encoded, which keeps bidi controls out of displayed links.
fn valid_profile_url(value: &str) -> bool {
    value.len() <= MAX_PROFILE_URL_BYTES
        && value.is_ascii()
        && value
            .parse::<Uri>()
            .is_ok_and(|uri| uri.scheme_str() == Some("https"))
        && contributor::safe_profile_url(value)
}

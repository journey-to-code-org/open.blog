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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthorizationAction {
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
}

pub struct AuthorizationContext<'a> {
    pub publication_id: &'a str,
    pub authenticated_admin_user: &'a str,
    pub active_admin_users: &'a [&'a str],
    pub contributor_ids: &'a [&'a str],
    pub collaboration: &'a CollaborationContract,
    pub target_participant_id: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuthorizationError;

impl fmt::Display for AuthorizationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("collaboration access denied")
    }
}

impl std::error::Error for AuthorizationError {}

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
        let mut participant_ids = HashSet::with_capacity(policy.bindings.len());
        for binding in &policy.bindings {
            let mut roles = HashSet::with_capacity(binding.roles.len());
            if !valid_id(&binding.admin_user)
                || !valid_id(&binding.contributor_id)
                || !valid_id(&binding.participant_id)
                || binding.roles.is_empty()
                || !admin_users.insert(binding.admin_user.as_str())
                || !contributor_ids.insert(binding.contributor_id.as_str())
                || !participant_ids.insert(binding.participant_id.as_str())
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
        if !context
            .contributor_ids
            .contains(&binding.contributor_id.as_str())
            || !context
                .collaboration
                .participants
                .iter()
                .any(|participant| participant.id == binding.participant_id)
        {
            return Err(AuthorizationError);
        }

        let target = match action {
            AuthorizationAction::ViewContribution
            | AuthorizationAction::EditContribution
            | AuthorizationAction::RevealContribution
            | AuthorizationAction::ApproveContribution
            | AuthorizationAction::RemoveMember => {
                let target = context.target_participant_id.ok_or(AuthorizationError)?;
                if !context
                    .collaboration
                    .participants
                    .iter()
                    .any(|participant| participant.id == target)
                {
                    return Err(AuthorizationError);
                }
                Some(target)
            }
            _ => None,
        };
        let allowed = binding
            .roles
            .iter()
            .any(|role| role_allows(*role, action, target, &binding.participant_id));
        if !allowed {
            return Err(AuthorizationError);
        }
        Ok(binding)
    }
}

fn role_allows(
    role: AuthorizationRole,
    action: AuthorizationAction,
    target_participant_id: Option<&str>,
    own_participant_id: &str,
) -> bool {
    use AuthorizationAction::*;
    use AuthorizationRole::*;

    match (role, action) {
        (
            SiteOwner | Coordinator,
            ViewPublished | ViewRevealed | Invite | Schedule | Publish | RemoveMember | Export,
        ) => true,
        (Contributor, ViewPublished | ViewRevealed | Export) => true,
        (
            Contributor,
            ViewContribution | EditContribution | RevealContribution | ApproveContribution,
        ) => target_participant_id == Some(own_participant_id),
        (Editor, ViewPublished | ViewRevealed | ViewContribution | EditContribution | Export) => {
            true
        }
        (Reader, ViewPublished | ViewRevealed | Export) => true,
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
        for participant in &self.participants {
            if !valid_id(&participant.id)
                || !participant_ids.insert(participant.id.as_str())
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
        for contribution in &self.contributions {
            if !valid_id(&contribution.id)
                || !contribution_ids.insert(contribution.id.as_str())
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

/// Opaque ASCII identifiers may later key files or URLs, so `.` is only a separator:
/// dot segments such as `.` and `..` can never be expressed.
fn valid_slug(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !value.starts_with(['-', '_', '.'])
        && !value.ends_with(['-', '_', '.'])
        && !value.contains("..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Identity text keeps ordinary Unicode, including joiners used by scripts and emoji, but
/// rejects controls that could reorder another participant's name or make it invisible.
fn valid_text(value: &str, max_bytes: usize) -> bool {
    value.len() <= max_bytes
        && !value
            .chars()
            .any(|character| character.is_control() || is_bidi_control(character))
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

fn is_invisible(character: char) -> bool {
    matches!(
        character,
        '\u{200B}'..='\u{200D}' | '\u{2060}'..='\u{2064}' | '\u{FEFF}'
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

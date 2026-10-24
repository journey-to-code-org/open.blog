//! Group-safe contracts shared by future collaboration capabilities.

use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt};

use http::Uri;

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

fn valid_slug(value: &str, max_bytes: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && !value.starts_with(['-', '_'])
        && !value.ends_with(['-', '_'])
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn valid_text(value: &str, max_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

fn valid_profile_url(value: &str) -> bool {
    if value.len() > MAX_PROFILE_URL_BYTES
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return false;
    }
    let Ok(uri) = value.parse::<Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    uri.scheme_str() == Some("https")
        && !authority.as_str().contains('@')
        && !authority.host().is_empty()
        && authority.host() != "."
        && !authority.host().starts_with('.')
        && !authority.host().ends_with('.')
        && !authority.host().split('.').any(str::is_empty)
}

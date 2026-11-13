//! Private, participant-selected publication credit choices.

use std::collections::{BTreeMap, HashSet};

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::collaboration::{
    valid_contributor_id, valid_id, valid_text, MAX_DISPLAY_NAME_BYTES, MAX_PARTICIPANTS,
};
use crate::contributor::{normalize_registry, Contributor};

pub const CREDIT_CHOICES_VERSION: u8 = 1;
pub const MAX_CREDIT_CHOICES_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CreditChoice {
    Profile {
        contributor_id: String,
        profile: Contributor,
    },
    DisplayName {
        name: String,
    },
    Uncredited,
}

impl CreditChoice {
    fn valid(&self) -> bool {
        match self {
            Self::Profile {
                contributor_id,
                profile,
            } => {
                if !valid_contributor_id(contributor_id)
                    || !valid_text(&profile.name, MAX_DISPLAY_NAME_BYTES)
                {
                    return false;
                }
                let mut registry = BTreeMap::from([(contributor_id.clone(), profile.clone())]);
                normalize_registry(&mut registry).is_ok()
                    && registry.get(contributor_id) == Some(profile)
            }
            Self::DisplayName { name } => valid_text(name, MAX_DISPLAY_NAME_BYTES),
            Self::Uncredited => true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Selection {
    participant_id: String,
    choice: CreditChoice,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreditChoices {
    version: u8,
    revision: u64,
    selections: Vec<Selection>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CreditChoiceError {
    Denied,
    Stale,
    Invalid,
}

impl Default for CreditChoices {
    fn default() -> Self {
        Self {
            version: CREDIT_CHOICES_VERSION,
            revision: 0,
            selections: Vec::new(),
        }
    }
}

impl CreditChoices {
    pub fn from_json(text: &str) -> Result<Self, CreditChoiceError> {
        if text.len() > MAX_CREDIT_CHOICES_BYTES {
            return Err(CreditChoiceError::Invalid);
        }
        let value: Self = serde_json::from_str(text).map_err(|_| CreditChoiceError::Invalid)?;
        let mut ids = HashSet::new();
        if value.version != CREDIT_CHOICES_VERSION
            || value.selections.len() > MAX_PARTICIPANTS
            || value.selections.iter().any(|selection| {
                !valid_id(&selection.participant_id)
                    || !ids.insert(selection.participant_id.to_ascii_lowercase())
                    || !selection.choice.valid()
            })
        {
            return Err(CreditChoiceError::Invalid);
        }
        Ok(value)
    }

    pub fn to_json(&self) -> Result<String, CreditChoiceError> {
        let text = serde_json::to_string(self).map_err(|_| CreditChoiceError::Invalid)?;
        if text.len() > MAX_CREDIT_CHOICES_BYTES {
            return Err(CreditChoiceError::Invalid);
        }
        Ok(text)
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn choice(&self, participant: &str) -> Option<&CreditChoice> {
        self.selections
            .iter()
            .find(|selection| selection.participant_id == participant)
            .map(|selection| &selection.choice)
    }

    /// The caller checks current membership and supplies the requester's bound contributor ID.
    pub fn select(
        &mut self,
        requester: &str,
        participant: &str,
        bound_contributor: &str,
        expected_revision: u64,
        choice: CreditChoice,
    ) -> Result<bool, CreditChoiceError> {
        if requester != participant || !valid_id(participant) {
            return Err(CreditChoiceError::Denied);
        }
        if expected_revision != self.revision {
            return Err(CreditChoiceError::Stale);
        }
        if !choice.valid()
            || matches!(&choice, CreditChoice::Profile { contributor_id, .. } if contributor_id != bound_contributor)
            || self.selections.iter().any(|selection| {
                selection.participant_id != participant
                    && selection.participant_id.eq_ignore_ascii_case(participant)
            })
        {
            return Err(CreditChoiceError::Invalid);
        }
        if self.choice(participant) == Some(&choice) {
            return Ok(false);
        }
        let mut next = self.clone();
        let existing = next
            .selections
            .iter()
            .position(|selection| selection.participant_id == participant);
        match existing {
            Some(index) => next.selections[index].choice = choice,
            None if next.selections.len() < MAX_PARTICIPANTS => next.selections.push(Selection {
                participant_id: participant.to_string(),
                choice,
            }),
            None => return Err(CreditChoiceError::Invalid),
        }
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or(CreditChoiceError::Invalid)?;
        next.to_json()?;
        *self = next;
        Ok(true)
    }

    /// Binds every choice, including frozen profile details and the monotonic revision.
    pub fn binding(&self) -> Result<String, CreditChoiceError> {
        let text = self.to_json()?;
        Ok(Blake2s256::digest(text.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_are_explicit_self_selected_and_revision_bound() {
        let mut choices = CreditChoices::default();
        assert_eq!(choices.choice("ann"), None);
        let name = CreditChoice::DisplayName {
            name: "A. Writer".into(),
        };
        assert_eq!(
            choices.select("bo", "ann", "ann", 0, name.clone()),
            Err(CreditChoiceError::Denied)
        );
        assert_eq!(
            choices.select("ann", "ann", "ann", 1, name.clone()),
            Err(CreditChoiceError::Stale)
        );
        assert_eq!(
            choices.select("ann", "ann", "ann", 0, name.clone()),
            Ok(true)
        );
        let first = choices.binding().unwrap();
        assert_eq!(
            choices.select("ann", "ann", "ann", 1, name.clone()),
            Ok(false)
        );
        assert_eq!(
            choices.select("ann", "ann", "ann", 1, CreditChoice::Uncredited),
            Ok(true)
        );
        assert_eq!(choices.select("ann", "ann", "ann", 2, name), Ok(true));
        assert_ne!(choices.binding().unwrap(), first);
        assert_eq!(
            CreditChoices::from_json(&choices.to_json().unwrap()).unwrap(),
            choices
        );
    }

    #[test]
    fn profile_selection_requires_the_bound_identity_and_a_safe_snapshot() {
        let mut choices = CreditChoices::default();
        let mut profile = Contributor {
            name: "Ann".into(),
            ..Contributor::default()
        };
        let selection = |profile: Contributor| CreditChoice::Profile {
            contributor_id: "ann".into(),
            profile,
        };
        assert_eq!(
            choices.select("ann", "ann", "bo", 0, selection(profile.clone())),
            Err(CreditChoiceError::Invalid)
        );
        profile.url = "javascript:alert(1)".into();
        assert_eq!(
            choices.select("ann", "ann", "ann", 0, selection(profile)),
            Err(CreditChoiceError::Invalid)
        );
        assert_eq!(choices.revision(), 0);
        let safe = Contributor {
            name: "Ann".into(),
            url: "https://example.org/ann".into(),
            ..Contributor::default()
        };
        assert_eq!(
            choices.select("ann", "ann", "ann", 0, selection(safe.clone())),
            Ok(true)
        );
        let first = choices.binding().unwrap();
        let mut changed = safe;
        changed.url = "https://example.org/new".into();
        assert_eq!(
            choices.select("ann", "ann", "ann", 1, selection(changed)),
            Ok(true)
        );
        assert_ne!(first, choices.binding().unwrap());
        let text = choices.to_json().unwrap();
        assert!(text.contains("\"contributorId\":\"ann\""));
        assert_eq!(CreditChoices::from_json(&text).unwrap(), choices);
    }

    #[test]
    fn malformed_or_duplicated_choices_never_load() {
        for text in [
            r#"{"version":1,"revision":0,"selections":[{"participantId":"ann","choice":{"kind":"displayName","name":""}}]}"#,
            r#"{"version":1,"revision":0,"selections":[{"participantId":"ann","choice":{"kind":"uncredited"}},{"participantId":"ANN","choice":{"kind":"uncredited"}}]}"#,
            r#"{"version":2,"revision":0,"selections":[]}"#,
            r#"{"version":1,"revision":0,"selections":[],"unknown":true}"#,
        ] {
            assert_eq!(
                CreditChoices::from_json(text),
                Err(CreditChoiceError::Invalid)
            );
        }
        assert_eq!(
            CreditChoices::from_json(&" ".repeat(MAX_CREDIT_CHOICES_BYTES + 1)),
            Err(CreditChoiceError::Invalid)
        );
    }
}

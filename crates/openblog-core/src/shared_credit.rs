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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        public_id: Option<String>,
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
            Self::DisplayName { name, public_id } => {
                valid_text(name, MAX_DISPLAY_NAME_BYTES)
                    && public_id.as_ref().is_none_or(|id| {
                        id.len() == 32
                            && id
                                .bytes()
                                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    })
            }
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

/// A checked public projection; participant IDs remain private lookup keys and are not serialized.
pub struct PublicCredits {
    identities: BTreeMap<String, (String, Option<String>)>,
    sidecar: String,
}

impl PublicCredits {
    pub fn display_name(&self, participant: &str) -> Option<&str> {
        self.identities
            .get(participant)
            .map(|(name, _)| name.as_str())
    }

    pub fn contributor_id(&self, participant: &str) -> Option<&str> {
        self.identities
            .get(participant)
            .and_then(|(_, contributor)| contributor.as_deref())
    }

    pub fn sidecar(&self) -> &str {
        &self.sidecar
    }
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
            || value.revision < value.selections.len() as u64
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

    /// Project exactly the participants whose work reaches the post. Missing selections, legacy
    /// display names without a public random ID, and duplicate identities refuse publication.
    pub fn project(&self, participants: &[&str]) -> Result<PublicCredits, CreditChoiceError> {
        let mut identities = BTreeMap::new();
        let mut public_ids = HashSet::new();
        let mut participant_ids = HashSet::new();
        let mut credits = Vec::new();
        for participant in participants {
            if !valid_id(participant) || !participant_ids.insert(participant.to_ascii_lowercase()) {
                return Err(CreditChoiceError::Invalid);
            }
            let (name, contributor, identity) = match self.choice(participant) {
                Some(CreditChoice::Profile {
                    contributor_id,
                    profile,
                }) => (
                    profile.name.clone(),
                    Some(contributor_id.clone()),
                    Some(serde_json::json!({
                        "kind": "profile", "contributor": contributor_id, "profile": profile
                    })),
                ),
                Some(CreditChoice::DisplayName {
                    name,
                    public_id: Some(id),
                }) => (
                    name.clone(),
                    None,
                    Some(serde_json::json!({"kind":"displayName", "id":id, "name":name})),
                ),
                Some(CreditChoice::Uncredited) => ("Uncredited participant".into(), None, None),
                _ => return Err(CreditChoiceError::Invalid),
            };
            if let Some(identity) = identity {
                let key = if let Some(id) = &contributor {
                    format!("profile:{id}")
                } else {
                    format!(
                        "display:{}",
                        identity["id"].as_str().ok_or(CreditChoiceError::Invalid)?
                    )
                };
                if !public_ids.insert(key) {
                    return Err(CreditChoiceError::Invalid);
                }
                credits.push(serde_json::json!({
                    "identity": identity,
                    "roles": [{"vocabulary":"crossref", "role":"author"}]
                }));
            }
            identities.insert((*participant).to_string(), (name, contributor));
        }
        let sidecar = serde_json::to_string_pretty(&serde_json::json!({
            "version": 2, "credits": credits
        }))
        .map_err(|_| CreditChoiceError::Invalid)?;
        Ok(PublicCredits {
            identities,
            sidecar: format!("{sidecar}\n"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choices_cannot_claim_to_precede_their_first_revision() {
        let forged = r#"{"version":1,"revision":0,"selections":[{"participantId":"ann","choice":{"kind":"uncredited"}}]}"#;
        assert_eq!(
            CreditChoices::from_json(forged),
            Err(CreditChoiceError::Invalid)
        );
    }

    #[test]
    fn public_projection_requires_choices_and_leaks_no_participant_ids() {
        let mut choices = CreditChoices::default();
        choices
            .select(
                "private-ann",
                "private-ann",
                "ann",
                0,
                CreditChoice::Profile {
                    contributor_id: "ann".into(),
                    profile: Contributor {
                        name: "Ann".into(),
                        ..Contributor::default()
                    },
                },
            )
            .unwrap();
        choices
            .select(
                "private-bo",
                "private-bo",
                "bo",
                1,
                CreditChoice::DisplayName {
                    name: "Pen Name".into(),
                    public_id: Some("0123456789abcdef0123456789abcdef".into()),
                },
            )
            .unwrap();
        choices
            .select(
                "private-cy",
                "private-cy",
                "cy",
                2,
                CreditChoice::Uncredited,
            )
            .unwrap();
        let people = ["private-ann", "private-bo", "private-cy"];
        let public = choices.project(&people).unwrap();
        assert_eq!(public.display_name("private-ann"), Some("Ann"));
        assert_eq!(public.contributor_id("private-ann"), Some("ann"));
        assert_eq!(public.display_name("private-bo"), Some("Pen Name"));
        assert_eq!(public.contributor_id("private-bo"), None);
        assert_eq!(
            public.display_name("private-cy"),
            Some("Uncredited participant")
        );
        assert_eq!(public.contributor_id("private-cy"), None);
        assert!(!public.sidecar().contains("private-"));
        let (credits, _) = crate::contributor::resolve(
            &crate::config::Author::default(),
            &BTreeMap::new(),
            Some(public.sidecar()),
        )
        .unwrap();
        assert_eq!(credits.len(), 2);
        assert_eq!(credits[0].contributor.name, "Ann");
        assert_eq!(credits[1].contributor.name, "Pen Name");
        assert!(choices.project(&["private-ann", "missing"]).is_err());
        assert!(choices.project(&["private-ann", "private-ann"]).is_err());
        let mut legacy = choices.clone();
        legacy
            .select(
                "private-bo",
                "private-bo",
                "bo",
                3,
                CreditChoice::DisplayName {
                    name: "Old".into(),
                    public_id: None,
                },
            )
            .unwrap();
        assert!(legacy.project(&people).is_err());
    }

    #[test]
    fn choices_are_explicit_self_selected_and_revision_bound() {
        let mut choices = CreditChoices::default();
        assert_eq!(choices.choice("ann"), None);
        let name = CreditChoice::DisplayName {
            name: "A. Writer".into(),
            public_id: Some("0123456789abcdef0123456789abcdef".into()),
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

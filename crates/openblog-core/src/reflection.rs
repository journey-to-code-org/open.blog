//! Layout-independent structure of a shared reflection (ADR 0030, 0031).
//!
//! A [`ReflectionStructure`] says which contributions appear, in which rounds and under which
//! prompts. It names no participant, so identity always comes from the contribution it points at,
//! and it names no CSS, side or position. The five requested modes are one [`ReflectionLayout`]
//! value chosen separately: changing it never touches a round, a prompt or a word of prose.
//!
//! [`ReflectionStructure::reading_order`] is the one deterministic linear order every layout, the
//! portable output and a reader without CSS share. [`Placement`] is derived from that order for a
//! layout and is never stored. All of it is pure: parsing and validation mutate nothing, and every
//! failure is one opaque error that carries no prose, name, id or URL.

use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::collaboration::{valid_id, valid_text, CollaborationContract};

pub const REFLECTION_STRUCTURE_VERSION: u8 = 1;
pub const MAX_STRUCTURE_BYTES: usize = 128 * 1024;
pub const MAX_ROUNDS: usize = 200;
pub const MAX_TURNS_PER_ROUND: usize = 100;
pub const MAX_TOTAL_TURNS: usize = 1_000;
pub const MAX_PROMPT_BYTES: usize = 1_000;

/// The five requested presentation modes. They share one participant and contribution model.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReflectionLayout {
    #[default]
    Sequential,
    SideBySide,
    PointCounterpoint,
    AlternatingDialogue,
    Roundtable,
}

impl ReflectionLayout {
    pub const ALL: [Self; 5] = [
        Self::Sequential,
        Self::SideBySide,
        Self::PointCounterpoint,
        Self::AlternatingDialogue,
        Self::Roundtable,
    ];

    /// A stable key usable as a CSS class suffix.
    pub fn key(self) -> &'static str {
        match self {
            Self::Sequential => "sequential",
            Self::SideBySide => "side-by-side",
            Self::PointCounterpoint => "point-counterpoint",
            Self::AlternatingDialogue => "alternating-dialogue",
            Self::Roundtable => "roundtable",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReflectionStructure {
    pub version: u8,
    pub revision: u64,
    pub layout: ReflectionLayout,
    pub rounds: Vec<Round>,
}

/// One exchange step: an optional prompt and the ordered contributions that answer it. A round
/// with turns from more than one participant is an exchange.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Round {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    pub turns: Vec<Turn>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Turn {
    pub contribution_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReflectionError {
    Invalid,
}

impl fmt::Display for ReflectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("invalid reflection structure")
    }
}

impl std::error::Error for ReflectionError {}

/// One contribution in reading order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadingEntry<'a> {
    /// Zero-based position in the linear order.
    pub ordinal: usize,
    pub round: usize,
    pub round_id: &'a str,
    /// Set on the first entry of a round that has a prompt, so the prompt is read once, before
    /// the answers.
    pub prompt: Option<&'a str>,
    pub participant_id: &'a str,
    pub display_name: &'a str,
    pub contribution_id: &'a str,
    pub markdown: &'a str,
    /// The contribution has no text yet. It keeps its place so the order never shifts.
    pub empty: bool,
}

/// Where a layout may put an entry: a lane out of a count of lanes. It is derived, never stored,
/// and a layout with one lane reads top to bottom.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placement {
    pub lane: usize,
    pub lanes: usize,
}

impl ReflectionStructure {
    /// One round holding every contribution in `contract` order, the default for a publication
    /// that has not arranged anything.
    pub fn from_contract(contract: &CollaborationContract) -> Self {
        Self {
            version: REFLECTION_STRUCTURE_VERSION,
            revision: 1,
            layout: ReflectionLayout::default(),
            rounds: if contract.contributions.is_empty() {
                Vec::new()
            } else {
                vec![Round {
                    id: "round-1".into(),
                    prompt: None,
                    turns: contract
                        .contributions
                        .iter()
                        .map(|c| Turn {
                            contribution_id: c.id.clone(),
                        })
                        .collect(),
                }]
            },
        }
    }

    pub fn from_json(source: &str) -> Result<Self, ReflectionError> {
        if source.len() > MAX_STRUCTURE_BYTES {
            return Err(ReflectionError::Invalid);
        }
        let structure: Self = serde_json::from_str(source).map_err(|_| ReflectionError::Invalid)?;
        if structure.is_valid() {
            Ok(structure)
        } else {
            Err(ReflectionError::Invalid)
        }
    }

    /// Parse a whole replacement only when the caller saw the current revision. `self` is never
    /// changed, so a stale or malformed write applies nothing.
    pub fn replace_from_json(
        &self,
        source: &str,
        expected_revision: u64,
    ) -> Result<Self, ReflectionError> {
        if self.revision != expected_revision {
            return Err(ReflectionError::Invalid);
        }
        let replacement = Self::from_json(source)?;
        if expected_revision.checked_add(1) != Some(replacement.revision) {
            return Err(ReflectionError::Invalid);
        }
        Ok(replacement)
    }

    /// The same rounds, prompts and turns presented another way. Prose is not involved.
    pub fn with_layout(&self, layout: ReflectionLayout) -> Self {
        Self {
            layout,
            ..self.clone()
        }
    }

    fn is_valid(&self) -> bool {
        if self.version != REFLECTION_STRUCTURE_VERSION
            || self.rounds.len() > MAX_ROUNDS
            || self.rounds.iter().map(|r| r.turns.len()).sum::<usize>() > MAX_TOTAL_TURNS
        {
            return false;
        }
        let mut rounds = HashSet::new();
        let mut contributions = HashSet::new();
        self.rounds.iter().all(|round| {
            valid_id(&round.id)
                && rounds.insert(round.id.to_ascii_lowercase())
                && !round.turns.is_empty()
                && round.turns.len() <= MAX_TURNS_PER_ROUND
                && round
                    .prompt
                    .as_deref()
                    .is_none_or(|p| valid_text(p, MAX_PROMPT_BYTES))
                && round.turns.iter().all(|turn| {
                    valid_id(&turn.contribution_id)
                        && contributions.insert(turn.contribution_id.to_ascii_lowercase())
                })
        })
    }

    /// The deterministic linear order: rounds in order, turns in order. It does not depend on
    /// [`Self::layout`]. Fails, returning nothing, if any turn names a contribution the contract
    /// does not hold, so a stale structure can never show part of a reflection.
    pub fn reading_order<'a>(
        &'a self,
        contract: &'a CollaborationContract,
    ) -> Result<Vec<ReadingEntry<'a>>, ReflectionError> {
        let contributions: HashMap<&str, _> = contract
            .contributions
            .iter()
            .map(|c| (c.id.as_str(), c))
            .collect();
        let names: HashMap<&str, &str> = contract
            .participants
            .iter()
            .map(|p| (p.id.as_str(), p.display_name.as_str()))
            .collect();
        let mut entries = Vec::new();
        for (round_index, round) in self.rounds.iter().enumerate() {
            for (turn_index, turn) in round.turns.iter().enumerate() {
                let contribution = contributions
                    .get(turn.contribution_id.as_str())
                    .ok_or(ReflectionError::Invalid)?;
                let name = names
                    .get(contribution.participant_id.as_str())
                    .ok_or(ReflectionError::Invalid)?;
                entries.push(ReadingEntry {
                    ordinal: entries.len(),
                    round: round_index,
                    round_id: &round.id,
                    prompt: if turn_index == 0 {
                        round.prompt.as_deref()
                    } else {
                        None
                    },
                    participant_id: &contribution.participant_id,
                    display_name: name,
                    contribution_id: &contribution.id,
                    markdown: &contribution.markdown,
                    empty: contribution.markdown.trim().is_empty(),
                });
            }
        }
        Ok(entries)
    }

    /// Where `layout` places each entry of `order`. Lanes follow the order participants first
    /// appear in, so no stored field and no participant is tied to a side, and any number of
    /// participants gets a placement.
    pub fn placements(layout: ReflectionLayout, order: &[ReadingEntry<'_>]) -> Vec<Placement> {
        let mut seen: Vec<&str> = Vec::new();
        for entry in order {
            if !seen.contains(&entry.participant_id) {
                seen.push(entry.participant_id);
            }
        }
        let people = seen.len().max(1);
        order
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let person = seen
                    .iter()
                    .position(|id| *id == entry.participant_id)
                    .unwrap_or(0);
                match layout {
                    ReflectionLayout::Sequential => Placement { lane: 0, lanes: 1 },
                    ReflectionLayout::SideBySide | ReflectionLayout::Roundtable => Placement {
                        lane: person,
                        lanes: people,
                    },
                    ReflectionLayout::PointCounterpoint => Placement {
                        lane: usize::from(person != 0),
                        lanes: 2,
                    },
                    ReflectionLayout::AlternatingDialogue => Placement {
                        lane: index % 2,
                        lanes: 2,
                    },
                }
            })
            .collect()
    }
}

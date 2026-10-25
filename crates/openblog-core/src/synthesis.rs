//! Shared synthesis items: optional, attributed statements a shared reflection's authors make
//! about what their separate drafts add up to.
//!
//! An item has a kind (agreement, difference, question, application or uncertainty), untrusted
//! Markdown, and an ordered list of the authors it speaks for: one, some or all of them. Nothing
//! is required: an empty synthesis is valid, no kind has to appear, and the model never compares
//! items, so authors who disagree simply write a difference (or two overlapping ones) and
//! nothing is ever rejected for it (ADR 0036).
//!
//! The set is private collaboration state. It stores prose, so it never reaches a Post, page,
//! feed or export until a later assembly step publishes it, and [`SynthesisSet::binding_frame`]
//! hands approval a prose-free digest (never the Markdown) so an approval covers the exact items,
//! order and attribution (ADR 0020). Every change names the set revision the caller read, so a
//! concurrent change is refused as [`SynthesisError::Stale`] and a failed call changes nothing.
//! Refusals about items the requester may not touch are the same [`SynthesisError::Denied`].

use std::collections::HashSet;
use std::fmt;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::collaboration::{valid_id, MAX_PARTICIPANTS};

pub const SYNTHESIS_SET_VERSION: u8 = 1;
pub const MAX_SYNTHESIS_ITEMS: usize = 100;
pub const MAX_SYNTHESIS_MARKDOWN_BYTES: usize = 8 * 1024;
pub const MAX_SYNTHESIS_SET_BYTES: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SynthesisError {
    /// The requester is not an author, or the item is not theirs to touch or does not exist.
    Denied,
    /// The caller's view of the set is no longer the current set.
    Stale,
    /// The input is malformed or exceeds a limit.
    Invalid,
}

impl fmt::Display for SynthesisError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Denied => "synthesis access denied",
            Self::Stale => "the synthesis changed since it was read",
            Self::Invalid => "invalid synthesis",
        })
    }
}

impl std::error::Error for SynthesisError {}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SynthesisKind {
    Agreement,
    Difference,
    Question,
    Application,
    Uncertainty,
}

impl SynthesisKind {
    fn tag(self) -> &'static str {
        match self {
            Self::Agreement => "agreement",
            Self::Difference => "difference",
            Self::Question => "question",
            Self::Application => "application",
            Self::Uncertainty => "uncertainty",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SynthesisItem {
    id: String,
    kind: SynthesisKind,
    markdown: String,
    contributors: Vec<String>,
    revision: u64,
}

impl SynthesisItem {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn kind(&self) -> SynthesisKind {
        self.kind
    }
    /// Untrusted Markdown: clients render it as text or through the sanitizing renderer.
    pub fn markdown(&self) -> &str {
        &self.markdown
    }
    /// The authors this item speaks for, in the order they were attributed.
    pub fn contributors(&self) -> &[String] {
        &self.contributors
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }

    fn digest(&self) -> String {
        let mut hasher = Blake2s256::new();
        hasher.update(b"openblog-synthesis-item-v1\0");
        for part in [self.id.as_str(), self.kind.tag(), self.markdown.as_str()] {
            hasher.update((part.len() as u64).to_be_bytes());
            hasher.update(part.as_bytes());
        }
        hasher.update((self.contributors.len() as u64).to_be_bytes());
        for contributor in &self.contributors {
            hasher.update((contributor.len() as u64).to_be_bytes());
            hasher.update(contributor.as_bytes());
        }
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

/// A new item. The requester is always attributed first, then `others` in order.
#[derive(Clone, Copy, Debug)]
pub struct NewSynthesisItem<'a> {
    pub kind: SynthesisKind,
    pub markdown: &'a str,
    pub others: &'a [&'a str],
}

/// A change to an item. Attribution can only grow here: nobody can remove another author, and
/// each author takes themselves off through [`SynthesisSet::withdraw`].
#[derive(Clone, Copy, Debug, Default)]
pub struct SynthesisEdit<'a> {
    pub kind: Option<SynthesisKind>,
    pub markdown: Option<&'a str>,
    pub add_contributors: &'a [&'a str],
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SynthesisSet {
    version: u8,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    next_id: u64,
    #[serde(default)]
    items: Vec<SynthesisItem>,
}

impl Default for SynthesisSet {
    fn default() -> Self {
        Self::new()
    }
}

fn valid_markdown(markdown: &str) -> bool {
    !markdown.trim().is_empty()
        && markdown.len() <= MAX_SYNTHESIS_MARKDOWN_BYTES
        && !markdown.chars().any(|c| {
            (c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                || c == '\u{2028}'
                || c == '\u{2029}'
        })
}

fn valid_contributors(contributors: &[String]) -> bool {
    let mut seen = HashSet::new();
    !contributors.is_empty()
        && contributors.len() <= MAX_PARTICIPANTS
        && contributors
            .iter()
            .all(|id| valid_id(id) && seen.insert(id.to_ascii_lowercase()))
}

fn check_author(requester: &str, authors: &[&str]) -> Result<(), SynthesisError> {
    if authors.contains(&requester) {
        Ok(())
    } else {
        Err(SynthesisError::Denied)
    }
}

impl SynthesisSet {
    /// An empty synthesis, which is a complete and valid one.
    pub fn new() -> Self {
        Self {
            version: SYNTHESIS_SET_VERSION,
            revision: 0,
            next_id: 0,
            items: Vec::new(),
        }
    }

    pub fn from_json(source: &str) -> Result<Self, SynthesisError> {
        if source.len() > MAX_SYNTHESIS_SET_BYTES {
            return Err(SynthesisError::Invalid);
        }
        let set: Self = serde_json::from_str(source).map_err(|_| SynthesisError::Invalid)?;
        if !set.is_valid() {
            return Err(SynthesisError::Invalid);
        }
        Ok(set)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a synthesis set always serializes")
    }

    fn is_valid(&self) -> bool {
        let mut ids = HashSet::new();
        self.version == SYNTHESIS_SET_VERSION
            && self.items.len() <= MAX_SYNTHESIS_ITEMS
            && self.items.iter().all(|item| {
                valid_id(&item.id)
                    && ids.insert(item.id.to_ascii_lowercase())
                    && valid_markdown(&item.markdown)
                    && valid_contributors(&item.contributors)
            })
    }

    /// The revision callers send back as `expected` so a concurrent change is refused.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The items in publication order, for an author only. Anyone else gets `Denied`.
    pub fn view(
        &self,
        requester: &str,
        authors: &[&str],
    ) -> Result<&[SynthesisItem], SynthesisError> {
        check_author(requester, authors)?;
        Ok(&self.items)
    }

    fn guard(
        &self,
        requester: &str,
        authors: &[&str],
        expected: u64,
    ) -> Result<(), SynthesisError> {
        check_author(requester, authors)?;
        if expected != self.revision {
            return Err(SynthesisError::Stale);
        }
        Ok(())
    }

    /// Add an item. Returns its id.
    pub fn add(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        new: NewSynthesisItem<'_>,
    ) -> Result<String, SynthesisError> {
        self.guard(requester, authors, expected)?;
        if !valid_markdown(new.markdown) || self.items.len() >= MAX_SYNTHESIS_ITEMS {
            return Err(SynthesisError::Invalid);
        }
        let mut contributors = vec![requester.to_owned()];
        for other in new.others {
            if !authors.contains(other) {
                return Err(SynthesisError::Invalid);
            }
            contributors.push((*other).to_owned());
        }
        if !valid_contributors(&contributors) {
            return Err(SynthesisError::Invalid);
        }
        self.next_id += 1;
        let id = format!("syn-{}", self.next_id);
        self.revision += 1;
        self.items.push(SynthesisItem {
            id: id.clone(),
            kind: new.kind,
            markdown: new.markdown.to_owned(),
            contributors,
            revision: 1,
        });
        Ok(id)
    }

    fn position(&self, id: &str, requester: &str) -> Result<usize, SynthesisError> {
        self.items
            .iter()
            .position(|item| item.id == id && item.contributors.iter().any(|c| c == requester))
            .ok_or(SynthesisError::Denied)
    }

    /// Change an item. Only an author the item speaks for may.
    pub fn edit(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        id: &str,
        edit: SynthesisEdit<'_>,
    ) -> Result<(), SynthesisError> {
        self.guard(requester, authors, expected)?;
        let index = self.position(id, requester)?;
        let mut item = self.items[index].clone();
        if let Some(kind) = edit.kind {
            item.kind = kind;
        }
        if let Some(markdown) = edit.markdown {
            if !valid_markdown(markdown) {
                return Err(SynthesisError::Invalid);
            }
            item.markdown = markdown.to_owned();
        }
        for other in edit.add_contributors {
            if !authors.contains(other) {
                return Err(SynthesisError::Invalid);
            }
            if !item.contributors.iter().any(|c| c == other) {
                item.contributors.push((*other).to_owned());
            }
        }
        if !valid_contributors(&item.contributors) {
            return Err(SynthesisError::Invalid);
        }
        if item == self.items[index] {
            return Ok(());
        }
        item.revision += 1;
        self.items[index] = item;
        self.revision += 1;
        Ok(())
    }

    /// Take the requester's own name off an item. An item nobody speaks for any more is dropped.
    pub fn withdraw(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        id: &str,
    ) -> Result<(), SynthesisError> {
        self.guard(requester, authors, expected)?;
        let index = self.position(id, requester)?;
        self.items[index].contributors.retain(|c| c != requester);
        if self.items[index].contributors.is_empty() {
            self.items.remove(index);
        } else {
            self.items[index].revision += 1;
        }
        self.revision += 1;
        Ok(())
    }

    /// Put the items in a new order. `order` must name every item exactly once.
    pub fn reorder(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        order: &[&str],
    ) -> Result<(), SynthesisError> {
        self.guard(requester, authors, expected)?;
        let mut seen = HashSet::new();
        if order.len() != self.items.len() || !order.iter().all(|id| seen.insert(*id)) {
            return Err(SynthesisError::Invalid);
        }
        let mut next = Vec::with_capacity(order.len());
        for id in order {
            next.push(
                self.items
                    .iter()
                    .find(|item| item.id == *id)
                    .ok_or(SynthesisError::Invalid)?
                    .clone(),
            );
        }
        if next != self.items {
            self.items = next;
            self.revision += 1;
        }
        Ok(())
    }

    /// Drop attribution to anyone who is no longer an author, and any item that leaves with
    /// nobody speaking for it. Routes call this in the same write as an author-set change.
    /// Returns whether anything changed.
    pub fn reconcile(&mut self, authors: &[&str]) -> bool {
        let before = self.items.clone();
        for item in &mut self.items {
            let before_len = item.contributors.len();
            item.contributors.retain(|c| authors.contains(&c.as_str()));
            if item.contributors.len() != before_len {
                item.revision += 1;
            }
        }
        self.items.retain(|item| !item.contributors.is_empty());
        let changed = self.items != before;
        if changed {
            self.revision += 1;
        }
        changed
    }

    /// Prose-free values to append to the approval subject's metadata, so an approval is bound
    /// to the exact items, their order and their attribution. Empty for an empty synthesis, so a
    /// piece without one binds exactly as before.
    pub fn binding_frame(&self) -> Vec<String> {
        if self.items.is_empty() {
            return Vec::new();
        }
        let mut frame = vec![format!("synthesis:{}", self.items.len())];
        frame.extend(self.items.iter().map(SynthesisItem::digest));
        frame
    }
}

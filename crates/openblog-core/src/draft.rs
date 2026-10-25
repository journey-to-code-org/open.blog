//! Private contribution revisions and mutual reveal.
//!
//! A contribution draft is owned by exactly one participant and changes only by appending an
//! immutable, numbered revision. A revision is identified by its contribution, number, author
//! binding, timestamp, and a digest of its exact content; that identity ([`RevisionStamp`])
//! carries no prose. Saving is optimistic: the caller names the revision it last saw.
//!
//! Drafts become visible to others only through a mutual reveal: an exchange among two or more
//! participants in which every member commits one exact revision of their own draft. Nothing is
//! visible until the last member commits, then every member can read every committed revision in
//! the same mutation, so a reveal that is interrupted or cancelled exposes nothing. A reveal
//! never approves, publishes, or credits anything and never touches the collaboration contract.
//!
//! Every refusal about another participant's draft is the same [`DraftError::Denied`], so a
//! caller cannot read or probe the content, revisions, or state of a draft or exchange.
//! Draft and exchange ids are unique across the whole set, so an attempt to create one over an
//! id that is already taken is refused; that collision (never any content) is the only thing a
//! participant can learn about an id they do not own.

use std::collections::HashSet;
use std::fmt;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::collaboration::{valid_id, MAX_CONTRIBUTIONS, MAX_MARKDOWN_BYTES, MAX_PARTICIPANTS};
use crate::date::DateTime;

pub const DRAFT_SET_VERSION: u8 = 1;
pub const MAX_REVISIONS_PER_DRAFT: usize = 200;
pub const MAX_EXCHANGES: usize = 100;
pub const MAX_DRAFT_SET_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DraftError {
    /// The requester may not do this, or the target does not exist for them.
    Denied,
    /// The requester owns the draft but saved against a revision that is no longer current.
    Stale,
    /// The input is malformed or exceeds a limit.
    Invalid,
    /// The draft already holds every revision it may, or saving would make the stored set larger
    /// than it can be read back. Nothing was saved.
    LimitReached,
}

impl fmt::Display for DraftError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Denied => "contribution draft access denied",
            Self::Stale => "contribution draft changed since it was read",
            Self::Invalid => "invalid contribution draft",
            Self::LimitReached => "contribution draft limit reached",
        })
    }
}

impl std::error::Error for DraftError {}

/// Exact, prose-free identity of one revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionStamp {
    pub contribution_id: String,
    pub number: u64,
    pub author_participant_id: String,
    pub saved_at: String,
    pub digest: String,
}

/// What a permitted reader receives: the stamp and the exact content of that revision.
#[derive(Clone, PartialEq, Eq)]
pub struct DraftView {
    pub stamp: RevisionStamp,
    pub markdown: String,
}

impl fmt::Debug for DraftView {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DraftView")
            .field("stamp", &self.stamp)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Revision {
    number: u64,
    saved_at: i64,
    digest: String,
    markdown: String,
}

impl fmt::Debug for Revision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Revision")
            .field("number", &self.number)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Draft {
    id: String,
    owner: String,
    #[serde(default)]
    withdrawn: bool,
    revisions: Vec<Revision>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Commitment {
    participant_id: String,
    contribution_id: String,
    revision: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum ExchangeState {
    Pending,
    Revealed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Exchange {
    id: String,
    members: Vec<String>,
    state: ExchangeState,
    commitments: Vec<Commitment>,
}

/// Where a mutual reveal stands after a change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExchangeStatus {
    /// Waiting for this many more members to commit; nothing is visible yet.
    Pending { waiting_for: usize },
    /// Every member committed; each can read the others' committed revisions.
    Revealed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DraftSet {
    version: u8,
    participants: Vec<String>,
    drafts: Vec<Draft>,
    exchanges: Vec<Exchange>,
}

fn digest(owner: &str, contribution_id: &str, number: u64, markdown: &str) -> String {
    let mut hasher = Blake2s256::new();
    hasher.update(b"openblog-draft-revision-v1\0");
    for part in [owner, contribution_id] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    hasher.update(number.to_be_bytes());
    hasher.update(markdown.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_markdown(markdown: &str) -> bool {
    markdown.len() <= MAX_MARKDOWN_BYTES && !markdown.contains('\0')
}

impl DraftSet {
    /// An empty set for the publication's participants.
    pub fn new(participants: &[&str]) -> Result<Self, DraftError> {
        let set = Self {
            version: DRAFT_SET_VERSION,
            participants: participants.iter().map(|id| (*id).to_owned()).collect(),
            drafts: Vec::new(),
            exchanges: Vec::new(),
        };
        if set.is_valid() {
            Ok(set)
        } else {
            Err(DraftError::Invalid)
        }
    }

    pub fn from_json(source: &str) -> Result<Self, DraftError> {
        if source.len() > MAX_DRAFT_SET_BYTES {
            return Err(DraftError::Invalid);
        }
        let set: Self = serde_json::from_str(source).map_err(|_| DraftError::Invalid)?;
        if set.is_valid() {
            Ok(set)
        } else {
            Err(DraftError::Invalid)
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("draft set serializes")
    }

    /// Admit a participant who joined after the set was created. Idempotent; a draft set only
    /// grows its membership, so removing someone's sign-in never deletes or exposes their draft.
    pub fn admit(&mut self, participant: &str) -> Result<(), DraftError> {
        if self.is_member(participant) {
            return Ok(());
        }
        if !valid_id(participant)
            || self.participants.len() >= MAX_PARTICIPANTS
            || self
                .participants
                .iter()
                .any(|p| p.eq_ignore_ascii_case(participant))
        {
            return Err(DraftError::Invalid);
        }
        self.participants.push(participant.to_owned());
        Ok(())
    }

    fn is_member(&self, id: &str) -> bool {
        self.participants
            .iter()
            .any(|participant| participant == id)
    }

    fn draft(&self, id: &str) -> Option<&Draft> {
        self.drafts
            .iter()
            .find(|draft| draft.id.eq_ignore_ascii_case(id))
    }

    fn stamp(draft: &Draft, revision: &Revision) -> RevisionStamp {
        RevisionStamp {
            contribution_id: draft.id.clone(),
            number: revision.number,
            author_participant_id: draft.owner.clone(),
            saved_at: DateTime::from_unix(revision.saved_at).rfc3339(),
            digest: revision.digest.clone(),
        }
    }

    /// Append a revision to the requester's own draft. `expected_revision` is the number the
    /// requester last saw (0 to create). On any error the set is unchanged.
    pub fn save(
        &mut self,
        requester: &str,
        contribution_id: &str,
        expected_revision: u64,
        markdown: &str,
        now: i64,
    ) -> Result<RevisionStamp, DraftError> {
        if !self.is_member(requester) {
            return Err(DraftError::Denied);
        }
        // Ids are unique ignoring ASCII case, so look up the same way `is_valid` checks.
        let existing = self.draft(contribution_id).map(|draft| {
            (
                draft.id.clone(),
                draft.owner == requester,
                draft.withdrawn,
                draft.revisions.len() as u64,
            )
        });
        let current = existing
            .as_ref()
            .map_or(0, |(_, _, _, revisions)| *revisions);
        let contribution_id = match &existing {
            Some((id, ..)) => id.as_str(),
            None => contribution_id,
        };
        match &existing {
            // Another participant's (or a withdrawn) draft answers exactly like a missing id
            // would for a non-creating save; only creating over a taken id is refused.
            Some((_, false, _, _)) if expected_revision != 0 => return Err(DraftError::Stale),
            Some((_, false, _, _)) | Some((_, true, true, _)) => return Err(DraftError::Denied),
            Some(_) => {}
            None if !valid_id(contribution_id) || self.drafts.len() >= MAX_CONTRIBUTIONS => {
                return Err(DraftError::Invalid)
            }
            None => {}
        }
        if !valid_markdown(markdown) {
            return Err(DraftError::Invalid);
        }
        if current != expected_revision {
            return Err(DraftError::Stale);
        }
        if current as usize >= MAX_REVISIONS_PER_DRAFT {
            return Err(DraftError::LimitReached);
        }
        let number = current + 1;
        let revision = Revision {
            number,
            saved_at: now,
            digest: digest(requester, contribution_id, number, markdown),
            markdown: markdown.to_owned(),
        };
        if current == 0 {
            self.drafts.push(Draft {
                id: contribution_id.to_owned(),
                owner: requester.to_owned(),
                withdrawn: false,
                revisions: Vec::new(),
            });
        }
        let draft = self
            .drafts
            .iter_mut()
            .find(|draft| draft.id == contribution_id)
            .expect("draft exists");
        draft.revisions.push(revision);
        // The stored file, with its trailing newline, must always load again, so a save that
        // would outgrow the limit is undone and nothing changes.
        if self.to_json().len() >= MAX_DRAFT_SET_BYTES {
            let draft = self
                .drafts
                .iter_mut()
                .find(|draft| draft.id == contribution_id)
                .expect("draft exists");
            draft.revisions.pop();
            if current == 0 {
                self.drafts.pop();
            }
            return Err(DraftError::LimitReached);
        }
        let draft = self
            .drafts
            .iter()
            .find(|draft| draft.id == contribution_id)
            .expect("draft exists");
        Ok(Self::stamp(draft, draft.revisions.last().expect("pushed")))
    }

    /// Withdraw the requester's own draft from every other participant. Revisions stay for the
    /// owner; copies already read cannot be recalled. A withdrawn draft accepts no new revision
    /// or commitment, and withdrawing never changes the contract or any approval.
    pub fn withdraw(&mut self, requester: &str, contribution_id: &str) -> Result<(), DraftError> {
        let draft = self
            .drafts
            .iter_mut()
            .find(|draft| {
                draft.id.eq_ignore_ascii_case(contribution_id) && draft.owner == requester
            })
            .ok_or(DraftError::Denied)?;
        draft.withdrawn = true;
        let contribution_id = draft.id.clone();
        for exchange in &mut self.exchanges {
            if exchange.state == ExchangeState::Pending {
                exchange
                    .commitments
                    .retain(|c| c.contribution_id != contribution_id);
            }
        }
        Ok(())
    }

    /// Read a draft: the owner sees the latest revision; another participant sees only the exact
    /// revision committed to a completed exchange that lists them, and only while the draft is
    /// not withdrawn. Anything else is [`DraftError::Denied`].
    pub fn view(&self, requester: &str, contribution_id: &str) -> Result<DraftView, DraftError> {
        if !self.is_member(requester) {
            return Err(DraftError::Denied);
        }
        let draft = self.draft(contribution_id).ok_or(DraftError::Denied)?;
        let number = if draft.owner == requester {
            draft.revisions.len() as u64
        } else if draft.withdrawn {
            return Err(DraftError::Denied);
        } else {
            self.exchanges
                .iter()
                .filter(|e| e.state == ExchangeState::Revealed)
                .filter(|e| e.members.iter().any(|m| m == requester))
                .flat_map(|e| &e.commitments)
                .filter(|c| c.contribution_id.eq_ignore_ascii_case(contribution_id))
                .map(|c| c.revision)
                .max()
                .ok_or(DraftError::Denied)?
        };
        let revision = draft
            .revisions
            .iter()
            .find(|revision| revision.number == number)
            .ok_or(DraftError::Denied)?;
        Ok(DraftView {
            stamp: Self::stamp(draft, revision),
            markdown: revision.markdown.clone(),
        })
    }

    /// Open a mutual reveal among two or more participants, the requester included.
    pub fn open_exchange(
        &mut self,
        requester: &str,
        exchange_id: &str,
        members: &[&str],
    ) -> Result<ExchangeStatus, DraftError> {
        if !self.is_member(requester) || !members.contains(&requester) {
            return Err(DraftError::Denied);
        }
        let unique: HashSet<&str> = members.iter().copied().collect();
        if members.len() < 2
            || unique.len() != members.len()
            || members.len() > MAX_PARTICIPANTS
            || !members.iter().all(|m| self.is_member(m))
            || !valid_id(exchange_id)
            || self.exchanges.iter().any(|e| e.id == exchange_id)
            || self.exchanges.len() >= MAX_EXCHANGES
        {
            return Err(DraftError::Invalid);
        }
        self.exchanges.push(Exchange {
            id: exchange_id.to_owned(),
            members: members.iter().map(|m| (*m).to_owned()).collect(),
            state: ExchangeState::Pending,
            commitments: Vec::new(),
        });
        Ok(ExchangeStatus::Pending {
            waiting_for: members.len(),
        })
    }

    /// Commit one exact revision of the requester's own draft to a pending exchange. Replaces
    /// an earlier commitment of the same member. The last commitment reveals for everyone at once.
    pub fn commit(
        &mut self,
        requester: &str,
        exchange_id: &str,
        contribution_id: &str,
        revision: u64,
    ) -> Result<ExchangeStatus, DraftError> {
        let canonical = self.draft(contribution_id).map(|d| d.id.clone());
        let contribution_id = canonical.as_deref().unwrap_or(contribution_id);
        let draft_ok = self.draft(contribution_id).is_some_and(|draft| {
            draft.owner == requester
                && !draft.withdrawn
                && revision >= 1
                && revision <= draft.revisions.len() as u64
        });
        let exchange = self
            .exchanges
            .iter_mut()
            .find(|e| e.id == exchange_id && e.members.iter().any(|m| m == requester))
            .ok_or(DraftError::Denied)?;
        if !draft_ok || exchange.state != ExchangeState::Pending {
            return Err(DraftError::Denied);
        }
        exchange
            .commitments
            .retain(|c| c.participant_id != requester);
        exchange.commitments.push(Commitment {
            participant_id: requester.to_owned(),
            contribution_id: contribution_id.to_owned(),
            revision,
        });
        if exchange.commitments.len() == exchange.members.len() {
            exchange.state = ExchangeState::Revealed;
            return Ok(ExchangeStatus::Revealed);
        }
        Ok(ExchangeStatus::Pending {
            waiting_for: exchange.members.len() - exchange.commitments.len(),
        })
    }

    /// Take back the requester's commitment from a pending exchange.
    pub fn retract(
        &mut self,
        requester: &str,
        exchange_id: &str,
    ) -> Result<ExchangeStatus, DraftError> {
        let exchange = self
            .exchanges
            .iter_mut()
            .find(|e| {
                e.id == exchange_id
                    && e.state == ExchangeState::Pending
                    && e.members.iter().any(|m| m == requester)
            })
            .ok_or(DraftError::Denied)?;
        exchange
            .commitments
            .retain(|c| c.participant_id != requester);
        Ok(ExchangeStatus::Pending {
            waiting_for: exchange.members.len() - exchange.commitments.len(),
        })
    }

    /// Cancel a pending exchange; any member may. A revealed exchange cannot be undone.
    pub fn cancel(&mut self, requester: &str, exchange_id: &str) -> Result<(), DraftError> {
        let exchange = self
            .exchanges
            .iter_mut()
            .find(|e| {
                e.id == exchange_id
                    && e.state == ExchangeState::Pending
                    && e.members.iter().any(|m| m == requester)
            })
            .ok_or(DraftError::Denied)?;
        exchange.state = ExchangeState::Cancelled;
        exchange.commitments.clear();
        Ok(())
    }

    fn is_valid(&self) -> bool {
        if self.version != DRAFT_SET_VERSION
            || self.participants.is_empty()
            || self.participants.len() > MAX_PARTICIPANTS
            || self.drafts.len() > MAX_CONTRIBUTIONS
            || self.exchanges.len() > MAX_EXCHANGES
        {
            return false;
        }
        let mut seen = HashSet::new();
        if !self
            .participants
            .iter()
            .all(|p| valid_id(p) && seen.insert(p.to_ascii_lowercase()))
        {
            return false;
        }
        let mut ids = HashSet::new();
        for draft in &self.drafts {
            if !valid_id(&draft.id)
                || !ids.insert(draft.id.to_ascii_lowercase())
                || !self.is_member(&draft.owner)
                || draft.revisions.is_empty()
                || draft.revisions.len() > MAX_REVISIONS_PER_DRAFT
            {
                return false;
            }
            for (index, revision) in draft.revisions.iter().enumerate() {
                let number = index as u64 + 1;
                if revision.number != number
                    || !valid_markdown(&revision.markdown)
                    || revision.digest
                        != digest(&draft.owner, &draft.id, number, &revision.markdown)
                {
                    return false;
                }
            }
        }
        let mut exchange_ids = HashSet::new();
        for exchange in &self.exchanges {
            let members: HashSet<&str> = exchange.members.iter().map(String::as_str).collect();
            let mut committed = HashSet::new();
            if !valid_id(&exchange.id)
                || !exchange_ids.insert(exchange.id.as_str())
                || exchange.members.len() < 2
                || members.len() != exchange.members.len()
                || !members.iter().all(|m| self.is_member(m))
            {
                return false;
            }
            for c in &exchange.commitments {
                let owned = self.draft(&c.contribution_id).is_some_and(|d| {
                    d.owner == c.participant_id
                        && c.revision >= 1
                        && c.revision <= d.revisions.len() as u64
                });
                if !owned
                    || !members.contains(c.participant_id.as_str())
                    || !committed.insert(c.participant_id.as_str())
                {
                    return false;
                }
            }
            let complete = exchange.commitments.len() == exchange.members.len();
            let consistent = match exchange.state {
                ExchangeState::Pending => !complete,
                ExchangeState::Revealed => complete,
                ExchangeState::Cancelled => exchange.commitments.is_empty(),
            };
            if !consistent {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 1_800_000_000;

    fn set(ids: &[&str]) -> DraftSet {
        DraftSet::new(ids).unwrap()
    }

    #[test]
    fn saving_stops_before_the_set_outgrows_what_can_be_loaded() {
        let mut draft_set = set(&["mikey"]);
        let heavy = "\u{1}".repeat(MAX_MARKDOWN_BYTES);
        let mut saved = 0;
        let outcome = loop {
            match draft_set.save("mikey", "mikey", saved, &heavy, T) {
                Ok(_) => saved += 1,
                Err(error) => break error,
            }
        };
        assert_eq!(outcome, DraftError::LimitReached);
        assert!(saved > 1 && (saved as usize) < MAX_REVISIONS_PER_DRAFT);
        let text = draft_set.to_json();
        assert!(text.len() < MAX_DRAFT_SET_BYTES);
        assert_eq!(DraftSet::from_json(&text).unwrap(), draft_set);
    }

    #[test]
    fn the_revision_limit_has_its_own_outcome() {
        let mut draft_set = set(&["mikey"]);
        for number in 0..MAX_REVISIONS_PER_DRAFT as u64 {
            draft_set.save("mikey", "mikey", number, "a", T).unwrap();
        }
        assert_eq!(
            draft_set.save("mikey", "mikey", MAX_REVISIONS_PER_DRAFT as u64, "a", T),
            Err(DraftError::LimitReached)
        );
    }

    #[test]
    fn solo_owner_saves_reads_and_conflicts_on_stale() {
        let mut s = set(&["ada"]);
        let one = s.save("ada", "c1", 0, "first", T).unwrap();
        assert_eq!((one.number, one.author_participant_id.as_str()), (1, "ada"));
        assert_eq!(s.save("ada", "c1", 0, "again", T), Err(DraftError::Stale));
        let two = s.save("ada", "c1", 1, "second", T + 1).unwrap();
        assert_ne!(one.digest, two.digest);
        let view = s.view("ada", "c1").unwrap();
        assert_eq!((view.stamp.number, view.markdown.as_str()), (2, "second"));
        assert_eq!(s.save("ada", "c1", 5, "x", T), Err(DraftError::Stale));
        assert_eq!(
            s.open_exchange("ada", "e1", &["ada"]),
            Err(DraftError::Invalid)
        );
    }

    #[test]
    fn stamp_has_no_prose_and_debug_hides_it() {
        let mut s = set(&["ada"]);
        let stamp = s.save("ada", "c1", 0, "secret prose", T).unwrap();
        assert!(!serde_json::to_string(&stamp).unwrap().contains("secret"));
        assert!(!format!("{:?}", s.view("ada", "c1").unwrap()).contains("secret"));
        assert!(!format!("{s:?}").contains("secret"));
        assert_eq!(stamp.saved_at, DateTime::from_unix(T).rfc3339());
    }

    #[test]
    fn case_variant_ids_cannot_collide_and_the_set_reloads() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "c1", 0, "mine", T).unwrap();
        assert_eq!(s.save("bo", "C1", 0, "x", T), Err(DraftError::Denied));
        assert_eq!(s.save("ada", "C1", 1, "again", T).unwrap().number, 2);
        let reloaded = DraftSet::from_json(&s.to_json()).unwrap();
        assert_eq!(reloaded.view("ada", "c1").unwrap().stamp.number, 2);
    }

    #[test]
    fn foreign_and_missing_ids_answer_alike_for_non_creating_saves() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "c1", 0, "private", T).unwrap();
        let before = s.to_json();
        assert_eq!(
            s.save("bo", "c1", 9, "x", T),
            s.save("bo", "nope", 9, "x", T)
        );
        assert_eq!(
            s.save("bo", "c1", 1, "x", T),
            s.save("bo", "nope", 1, "x", T)
        );
        assert_eq!(s.to_json(), before);
    }

    #[test]
    fn digest_binds_author_and_content() {
        let mut s = set(&["ada", "bo"]);
        let a = s.save("ada", "c1", 0, "same", T).unwrap();
        let b = s.save("bo", "c2", 0, "same", T).unwrap();
        assert_ne!(a.digest, b.digest);
    }

    #[test]
    fn others_never_see_unrevealed_and_errors_are_uniform() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "c1", 0, "private", T).unwrap();
        let missing = s.view("bo", "nope").unwrap_err();
        assert_eq!(s.view("bo", "c1"), Err(missing));
        assert_eq!(s.view("mallory", "c1"), Err(DraftError::Denied));
        assert_eq!(s.save("bo", "c1", 0, "hijack", T), Err(DraftError::Denied));
        assert_eq!(s.save("bo", "c1", 9, "probe", T), Err(DraftError::Stale));
        assert_eq!(s.save("mallory", "c9", 0, "x", T), Err(DraftError::Denied));
        assert_eq!(s.withdraw("bo", "c1"), Err(DraftError::Denied));
    }

    #[test]
    fn pair_reveal_is_all_or_nothing_and_binds_exact_revision() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "a", 0, "ada v1", T).unwrap();
        s.save("bo", "b", 0, "bo v1", T).unwrap();
        s.open_exchange("ada", "e1", &["ada", "bo"]).unwrap();
        assert_eq!(
            s.commit("ada", "e1", "a", 1).unwrap(),
            ExchangeStatus::Pending { waiting_for: 1 }
        );
        assert_eq!(s.view("bo", "a"), Err(DraftError::Denied));
        assert_eq!(s.view("ada", "b"), Err(DraftError::Denied));
        assert_eq!(
            s.commit("bo", "e1", "b", 1).unwrap(),
            ExchangeStatus::Revealed
        );
        assert_eq!(s.view("bo", "a").unwrap().markdown, "ada v1");
        assert_eq!(s.view("ada", "b").unwrap().markdown, "bo v1");
        // Later edits stay private: the recipient still sees the committed revision.
        s.save("ada", "a", 1, "ada v2", T + 5).unwrap();
        assert_eq!(s.view("bo", "a").unwrap().markdown, "ada v1");
        assert_eq!(s.view("ada", "a").unwrap().markdown, "ada v2");
        assert_eq!(s.commit("ada", "e1", "a", 2), Err(DraftError::Denied));
    }

    #[test]
    fn reveal_excludes_non_members() {
        let mut s = set(&["ada", "bo", "cy"]);
        s.save("ada", "a", 0, "A", T).unwrap();
        s.save("bo", "b", 0, "B", T).unwrap();
        s.open_exchange("ada", "e1", &["ada", "bo"]).unwrap();
        s.commit("ada", "e1", "a", 1).unwrap();
        s.commit("bo", "e1", "b", 1).unwrap();
        assert_eq!(s.view("cy", "a"), Err(DraftError::Denied));
        assert_eq!(s.commit("cy", "e1", "a", 1), Err(DraftError::Denied));
        assert_eq!(
            s.open_exchange("cy", "e2", &["ada", "bo"]),
            Err(DraftError::Denied)
        );
    }

    #[test]
    fn group_of_three_waits_for_everyone() {
        let mut s = set(&["ada", "bo", "cy"]);
        for (who, id) in [("ada", "a"), ("bo", "b"), ("cy", "c")] {
            s.save(who, id, 0, id, T).unwrap();
        }
        s.open_exchange("cy", "g", &["ada", "bo", "cy"]).unwrap();
        s.commit("ada", "g", "a", 1).unwrap();
        s.commit("bo", "g", "b", 1).unwrap();
        assert_eq!(s.view("ada", "b"), Err(DraftError::Denied));
        assert_eq!(
            s.commit("cy", "g", "c", 1).unwrap(),
            ExchangeStatus::Revealed
        );
        assert_eq!(s.view("ada", "c").unwrap().markdown, "c");
        assert_eq!(s.view("cy", "a").unwrap().markdown, "a");
    }

    #[test]
    fn interrupted_reveal_exposes_nothing() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "a", 0, "A", T).unwrap();
        s.open_exchange("ada", "e1", &["ada", "bo"]).unwrap();
        s.commit("ada", "e1", "a", 1).unwrap();
        // Persisted mid-reveal and reloaded: still pending, still private.
        let mut s = DraftSet::from_json(&s.to_json()).unwrap();
        assert_eq!(s.view("bo", "a"), Err(DraftError::Denied));
        assert_eq!(
            s.retract("ada", "e1").unwrap(),
            ExchangeStatus::Pending { waiting_for: 2 }
        );
        s.commit("ada", "e1", "a", 1).unwrap();
        s.cancel("bo", "e1").unwrap();
        assert_eq!(s.view("bo", "a"), Err(DraftError::Denied));
        assert_eq!(s.commit("ada", "e1", "a", 1), Err(DraftError::Denied));
    }

    #[test]
    fn withdrawal_hides_from_others_and_clears_pending_commitments() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "a", 0, "A", T).unwrap();
        s.save("bo", "b", 0, "B", T).unwrap();
        s.open_exchange("ada", "e1", &["ada", "bo"]).unwrap();
        s.commit("ada", "e1", "a", 1).unwrap();
        s.withdraw("ada", "a").unwrap();
        assert_eq!(
            s.commit("bo", "e1", "b", 1).unwrap(),
            ExchangeStatus::Pending { waiting_for: 1 }
        );
        assert_eq!(s.commit("ada", "e1", "a", 1), Err(DraftError::Denied));

        s.open_exchange("bo", "e2", &["ada", "bo"]).unwrap();
        s.commit("bo", "e2", "b", 1).unwrap();
        s.save("ada", "a2", 0, "A2", T).unwrap();
        s.commit("ada", "e2", "a2", 1).unwrap();
        assert_eq!(s.view("ada", "b").unwrap().markdown, "B");
        s.withdraw("bo", "b").unwrap();
        assert_eq!(s.view("ada", "b"), Err(DraftError::Denied));
        assert_eq!(s.view("bo", "b").unwrap().markdown, "B");
        assert_eq!(s.save("bo", "b", 1, "B2", T), Err(DraftError::Denied));
    }

    #[test]
    fn failed_operations_leave_the_set_unchanged() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "a", 0, "A", T).unwrap();
        let before = s.clone();
        assert!(s.save("ada", "a", 0, "x", T).is_err());
        assert!(s.save("ada", "a", 1, "nul\0", T).is_err());
        assert!(s.save("ada", "Bad Id", 0, "x", T).is_err());
        let big = "x".repeat(MAX_MARKDOWN_BYTES + 1);
        assert!(s.save("ada", "big", 0, &big, T).is_err());
        assert!(s.open_exchange("ada", "e", &["ada", "ada"]).is_err());
        assert!(s.open_exchange("ada", "e", &["ada", "ghost"]).is_err());
        assert!(s.commit("ada", "nope", "a", 1).is_err());
        assert_eq!(s, before);
    }

    #[test]
    fn untrusted_json_fails_closed() {
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "a", 0, "A", T).unwrap();
        let good = s.to_json();
        assert!(DraftSet::from_json(&good).is_ok());
        assert!(DraftSet::from_json(&good.replace("\"A\"", "\"tampered\"")).is_err());
        let ghost = good.replace("\"owner\":\"ada\"", "\"owner\":\"ghost\"");
        assert!(DraftSet::from_json(&ghost).is_err());
        let v2 = good.replace("\"version\":1", "\"version\":2");
        assert!(DraftSet::from_json(&v2).is_err());
        assert!(DraftSet::from_json("{\"extra\":1}").is_err());
        assert!(DraftSet::from_json("nope").is_err());
        let revealed = good.replace(
            "\"exchanges\":[]",
            "\"exchanges\":[{\"id\":\"e\",\"members\":[\"ada\",\"bo\"],\"state\":\"revealed\",\"commitments\":[]}]",
        );
        assert!(DraftSet::from_json(&revealed).is_err());
    }

    #[test]
    fn reveal_changes_no_contract_approval() {
        use crate::collaboration::CollaborationContract;
        let source = r#"{"version":1,"revision":1,"participants":[{"id":"ada","displayName":"Ada"},{"id":"bo","displayName":"Bo"}],"contributions":[],"reveals":[],"layout":[],"approvals":[]}"#;
        let contract = CollaborationContract::from_json(source).unwrap();
        let mut s = set(&["ada", "bo"]);
        s.save("ada", "a", 0, "A", T).unwrap();
        s.save("bo", "b", 0, "B", T).unwrap();
        s.open_exchange("ada", "e", &["ada", "bo"]).unwrap();
        s.commit("ada", "e", "a", 1).unwrap();
        s.commit("bo", "e", "b", 1).unwrap();
        // The draft set holds no approval state and cannot reach the contract.
        assert!(contract.approvals.is_empty());
    }

    #[test]
    fn a_later_participant_can_be_admitted_without_touching_existing_drafts() {
        let mut s = set(&["ada"]);
        s.save("ada", "ada", 0, "mine", T).unwrap();
        assert_eq!(s.save("bo", "bo", 0, "x", T), Err(DraftError::Denied));
        s.admit("bo").unwrap();
        s.admit("bo").unwrap();
        assert_eq!(s.admit("not valid!"), Err(DraftError::Invalid));
        s.save("bo", "bo", 0, "theirs", T).unwrap();
        assert_eq!(s.view("ada", "ada").unwrap().markdown, "mine");
        assert_eq!(s.view("ada", "bo"), Err(DraftError::Denied));
        assert!(DraftSet::from_json(&s.to_json()).is_ok());
    }
}

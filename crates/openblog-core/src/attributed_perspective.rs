//! Stable targets at one author's section of a shared reflection, and who may
//! answer a Third Perspective about it (ADRs 0160 to 0164).
//!
//! A shared reflection publishes each author's text under that author's name
//! (ADR 0030, 0033). A reader's Third Perspective (RD10) may be about one of
//! those sections. This module answers three questions without a new storage
//! format and without a parallel policy:
//!
//! - *What does the reader point at?* An [`AttributedTarget`]: the author's
//!   contribution id, the section's place among that author's sections, and
//!   the digest of the text the reader read. It is written as an ordinary RD10
//!   section target (`ob-by-{contribution}-{nth}` plus B5's digest), so every
//!   stored copy and every reader of one already understands it. Nothing in it
//!   is visual: no side, lane, column or position in the layout.
//! - *Is it still the same section?* [`AttributedSections::resolve`] looks the
//!   target up in the sections as published now, by the author and the text,
//!   and reports [`Standing::Current`] (even if the section moved) or a
//!   [`Standing::Stale`] with the honest reason. It never points at another
//!   author's or another passage's text.
//! - *Who may answer as that author?* [`admit_response`]: only the participant
//!   who wrote the section, bound as a contributor of the publication, signed
//!   in as the account bound to them, and still the author the section was
//!   published under. A contributor registry key alone, a coordinator, a site
//!   owner, an editor or the moderation token never can. The answer is then
//!   admitted by RD12's one policy as an ordinary pending `author-response`.
//!
//! Everything here is pure. Callers bring the published post's body, the
//! shared publication record and the identities loaded in the same
//! transaction as any change.

use crate::arrangement::Arrangement;
use crate::collaboration::{
    valid_id, AuthorizationAction, AuthorizationTarget, SharedPublication, MAX_IDENTIFIER_BYTES,
};
use crate::date::DateTime;
use crate::invitation::Identities;
use crate::moderation::{
    is_public, Actor, Admission, ItemFacts, ModerationPolicy, PolicyError, Submission,
};
use crate::participation::{ParticipationKind, ParticipationMode};
use crate::passage_target::{normalize_passage_text, section_digest, PassageSelector};
use crate::reflection::MAX_TOTAL_TURNS;
use crate::third_perspective::{PerspectiveTarget, TargetStatus};

/// The reserved start of an attributed section's anchor.
pub const ANCHOR_PREFIX: &str = "ob-by-";

/// The most attributed sections one work holds (a shared reflection's turn limit).
pub const MAX_SECTIONS: usize = MAX_TOTAL_TURNS;

/// Why a target or an anchor is refused. It names the rule, never the value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetError {
    /// The anchor starts with the reserved prefix but is not written exactly
    /// as [`anchor`] writes one.
    Malformed,
    /// An attributed target must carry the digest of the text read, because
    /// the author and place alone could point at different words later.
    DigestRequired,
    /// A quotation or the whole work is not an attributed section.
    NotASection,
}

impl TargetError {
    pub fn code(self) -> &'static str {
        match self {
            TargetError::Malformed => "malformed",
            TargetError::DigestRequired => "digest-required",
            TargetError::NotASection => "not-a-section",
        }
    }
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            TargetError::Malformed => "not a valid attributed section anchor",
            TargetError::DigestRequired => {
                "an attributed section target needs the digest of its text"
            }
            TargetError::NotASection => "not a section target",
        })
    }
}

impl std::error::Error for TargetError {}

/// The anchor of the `nth` section (zero-based) written by `contribution`.
pub fn anchor(contribution: &str, nth: usize) -> String {
    format!("{ANCHOR_PREFIX}{contribution}-{nth}")
}

/// Split an anchor written by [`anchor`]. `None` when it does not start with
/// the reserved prefix (an ordinary heading id); an error when it does but is
/// not exactly canonical, so a look-alike is never half-read.
fn split_anchor(text: &str) -> Result<Option<(String, usize)>, TargetError> {
    let Some(rest) = text.strip_prefix(ANCHOR_PREFIX) else {
        return Ok(None);
    };
    let (contribution, nth) = rest.rsplit_once('-').ok_or(TargetError::Malformed)?;
    let canonical = !nth.is_empty()
        && nth.len() <= 3
        && nth.bytes().all(|byte| byte.is_ascii_digit())
        && (nth == "0" || !nth.starts_with('0'));
    if !canonical || !valid_id(contribution) || contribution.len() > MAX_IDENTIFIER_BYTES {
        return Err(TargetError::Malformed);
    }
    let nth: usize = nth.parse().map_err(|_| TargetError::Malformed)?;
    if nth >= MAX_SECTIONS {
        return Err(TargetError::Malformed);
    }
    Ok(Some((contribution.to_string(), nth)))
}

/// One author's section as the work publishes it now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributedSection {
    /// The author's contribution (draft) id, the opaque handle the shared
    /// publication uses for them. Never a name or an account.
    pub contribution: String,
    /// Zero-based place among that author's sections in reading order. A
    /// hint only: the text, not the place, decides what a target means.
    pub nth: usize,
    /// The name the section is published under.
    pub author: String,
    /// B5's digest of the section's normalized Markdown text.
    pub digest: String,
}

impl AttributedSection {
    /// The anchor a page gives this section.
    pub fn anchor(&self) -> String {
        anchor(&self.contribution, self.nth)
    }

    /// The target a reader's Third Perspective about this section stores.
    pub fn target(&self) -> AttributedTarget {
        AttributedTarget {
            contribution: self.contribution.clone(),
            nth: self.nth,
            digest: self.digest.clone(),
        }
    }
}

/// What a reader pointed at: an author's section, bound to the text read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributedTarget {
    pub contribution: String,
    pub nth: usize,
    pub digest: String,
}

impl AttributedTarget {
    /// Read an RD10 target. `Ok(None)` for the whole work and for any section
    /// whose anchor is an ordinary heading id: those keep RD10's meaning.
    pub fn from_perspective(target: &PerspectiveTarget) -> Result<Option<Self>, TargetError> {
        let passage = target.passage_target();
        let Some(section) = passage.section.as_deref() else {
            return Ok(None);
        };
        let Some((contribution, nth)) = split_anchor(section)? else {
            return Ok(None);
        };
        let PassageSelector::Section { digest } = &passage.selector else {
            return Err(TargetError::NotASection);
        };
        let digest = digest.clone().ok_or(TargetError::DigestRequired)?;
        Ok(Some(Self {
            contribution,
            nth,
            digest,
        }))
    }

    /// The same target as an ordinary RD10 section target, which is how it is
    /// stored, submitted and projected.
    pub fn perspective_target(&self) -> PerspectiveTarget {
        PerspectiveTarget::section(
            Some(anchor(&self.contribution, self.nth)),
            Some(self.digest.clone()),
        )
    }
}

/// Why an attributed target no longer points at what the reader read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StaleReason {
    /// The author still has a section there, with different text.
    SectionChanged,
    /// The author has no section with that text, or no section at all.
    SectionRemoved,
    /// Two of the author's sections hold the same text and neither is at the
    /// place the reader saw, so which one was meant cannot be told.
    Ambiguous,
}

impl StaleReason {
    pub fn id(self) -> &'static str {
        match self {
            StaleReason::SectionChanged => "section-changed",
            StaleReason::SectionRemoved => "section-removed",
            StaleReason::Ambiguous => "ambiguous",
        }
    }
}

/// Where an attributed target stands in the work as published now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Standing {
    /// The author's section with the text the reader read is there.
    Current {
        /// Where it is now.
        nth: usize,
        /// Whether it is somewhere else than the reader saw it.
        moved: bool,
        /// The name it is published under.
        author: String,
    },
    /// The text the reader read is not there. The reader's words keep the
    /// context they were written in; nothing is pointed at instead.
    Stale {
        reason: StaleReason,
        /// The name the author's remaining sections are published under, when
        /// there are any, for honest context ("Mina's section has changed").
        author: Option<String>,
    },
}

impl Standing {
    pub fn is_current(&self) -> bool {
        matches!(self, Standing::Current { .. })
    }

    /// The same standing in RD10's terms, so the one projection and the one
    /// page treatment of a Third Perspective's section apply unchanged.
    pub fn target_status(&self, contribution: &str) -> TargetStatus {
        match self {
            Standing::Current { nth, .. } => TargetStatus::Current {
                section: Some(anchor(contribution, *nth)),
            },
            Standing::Stale { author, .. } => TargetStatus::Stale {
                section_present: author.is_some(),
            },
        }
    }
}

/// Every attributed section of one work as it is published now.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AttributedSections {
    sections: Vec<AttributedSection>,
    unattributed: usize,
}

impl AttributedSections {
    /// The sections as the work's Markdown body publishes them: its arranged
    /// reflection read back (ADR 0033), each turn matched to the one
    /// participant whose display name heads it. A body that is not an arranged
    /// reflection has none, and a turn whose name matches no participant or
    /// more than one is counted but never targetable, so a renamed or
    /// duplicated name fails closed instead of guessing an author.
    pub fn from_published(record: &SharedPublication, body: &str) -> Self {
        let Some(arrangement) = Arrangement::parse(body) else {
            return Self::default();
        };
        let participants = &record.collaboration.participants;
        let mut sections: Vec<AttributedSection> = Vec::new();
        let mut unattributed = 0;
        for turn in arrangement.turns() {
            let mut named = participants
                .iter()
                .filter(|participant| participant.display_name == turn.author);
            let (Some(participant), None) = (named.next(), named.next()) else {
                unattributed += 1;
                continue;
            };
            if sections.len() >= MAX_SECTIONS {
                break;
            }
            let nth = sections
                .iter()
                .filter(|section| section.contribution == participant.id)
                .count();
            sections.push(AttributedSection {
                contribution: participant.id.clone(),
                nth,
                author: turn.author.clone(),
                digest: section_digest(&normalize_passage_text(&turn.body)),
            });
        }
        Self {
            sections,
            unattributed,
        }
    }

    /// The sections in reading order.
    pub fn sections(&self) -> &[AttributedSection] {
        &self.sections
    }

    /// How many published turns have no single matching author, so cannot be
    /// targeted.
    pub fn unattributed(&self) -> usize {
        self.unattributed
    }

    /// The section a target means now, if it is still there. By the author
    /// and the text read: the place only breaks a tie between identical
    /// sections. Never another author's section, and never a section whose
    /// text differs.
    pub fn resolve(&self, target: &AttributedTarget) -> Standing {
        let own: Vec<&AttributedSection> = self
            .sections
            .iter()
            .filter(|section| {
                section
                    .contribution
                    .eq_ignore_ascii_case(&target.contribution)
            })
            .collect();
        let Some(first) = own.first() else {
            return Standing::Stale {
                reason: StaleReason::SectionRemoved,
                author: None,
            };
        };
        let same: Vec<&AttributedSection> = own
            .iter()
            .copied()
            .filter(|section| section.digest == target.digest)
            .collect();
        let found = match same.as_slice() {
            [one] => Some(*one),
            [] => None,
            many => match many.iter().find(|section| section.nth == target.nth) {
                Some(exact) => Some(*exact),
                None => {
                    return Standing::Stale {
                        reason: StaleReason::Ambiguous,
                        author: Some(first.author.clone()),
                    }
                }
            },
        };
        match found {
            Some(section) => Standing::Current {
                nth: section.nth,
                moved: section.nth != target.nth,
                author: section.author.clone(),
            },
            None => Standing::Stale {
                reason: if own.iter().any(|section| section.nth == target.nth) {
                    StaleReason::SectionChanged
                } else {
                    StaleReason::SectionRemoved
                },
                author: Some(first.author.clone()),
            },
        }
    }
}

/// Why an author response was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResponseError {
    /// The target is not an attributed section: the generic author response
    /// of RD12 applies instead, and this module grants nothing.
    NotAttributed,
    /// The requester is not the contributor who wrote that section. The same
    /// answer for a registry key without a binding, an editor, a coordinator,
    /// a site owner, the moderation token, a binding to another participant
    /// and a binding that no longer resolves.
    Denied,
    /// The requester is that author, but the section's author cannot be
    /// confirmed as the same person now: no section by them is published, or
    /// the name it is published under is no longer theirs.
    AuthorUnconfirmed,
    /// The parent is not a public Third Perspective of this work.
    Unavailable,
    /// RD12's policy refused the response.
    Policy(PolicyError),
}

impl ResponseError {
    pub fn code(self) -> &'static str {
        match self {
            ResponseError::NotAttributed => "not-attributed",
            ResponseError::Denied => "denied",
            ResponseError::AuthorUnconfirmed => "author-unconfirmed",
            ResponseError::Unavailable => "unavailable",
            ResponseError::Policy(error) => error.code(),
        }
    }
}

impl std::fmt::Display for ResponseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "author response refused: {}", self.code())
    }
}

impl std::error::Error for ResponseError {}

/// Who answered, as the audit trail keeps it and as the page names them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Responder {
    /// The participant who wrote the section (private; never public).
    pub participant: String,
    /// The name the section, and so the answer, is published under.
    pub author: String,
    /// Where the section stood when the answer was written.
    pub standing: Standing,
}

/// Whether `admin_user` is signed in as the account bound, as a contributor,
/// to `participant` of this publication, with the account, registry key and
/// participant all still current. The one author check, used to create an
/// answer and to withdraw it; it grants no moderation. A registry key alone,
/// any other role and any other participant are all [`ResponseError::Denied`].
pub fn authorize_author(
    record: &SharedPublication,
    identities: &Identities<'_>,
    admin_user: &str,
    participant: &str,
) -> Result<(), ResponseError> {
    let binding = record
        .authorize(
            admin_user,
            identities,
            AuthorizationAction::RespondAsAuthor,
            AuthorizationTarget::Participant(participant),
        )
        .map_err(|_| ResponseError::Denied)?;
    // The action's grant already requires the participant to be the
    // requester's own; checked again so a changed table cannot widen it.
    if binding.participant_id == participant {
        Ok(())
    } else {
        Err(ResponseError::Denied)
    }
}

/// An author's answer to a Third Perspective about their own section.
#[derive(Clone, Copy)]
pub struct ResponseRequest<'a> {
    /// The new item's id, chosen by the receiver.
    pub id: &'a str,
    pub record: &'a SharedPublication,
    pub identities: &'a Identities<'a>,
    /// The signed-in Admin account, from the session.
    pub admin_user: &'a str,
    /// The account's actor on this work, from `SharedWorks::actor`.
    pub actor: Actor<'a>,
    /// The published work's path.
    pub work: &'a str,
    /// `author-response`'s mode on that work.
    pub mode: ParticipationMode,
    /// The stored Third Perspective being answered.
    pub parent: &'a ItemFacts<'a>,
    /// `third-perspective`'s mode on that work.
    pub parent_mode: ParticipationMode,
    /// The target the Third Perspective stores.
    pub parent_target: &'a PerspectiveTarget,
    /// The work's sections as published now.
    pub sections: &'a AttributedSections,
    pub at: DateTime,
}

/// A created answer: always pending, like every item, and who wrote it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributedResponse {
    pub admission: Admission,
    pub responder: Responder,
}

/// Admit an author's answer to a Third Perspective about their own section.
///
/// Checks run in a fixed order so a requester who is not that author learns
/// nothing: the target's kind, the author grant, the parent, the author's
/// standing, then RD12's [`ModerationPolicy::admit`]. A section that has since
/// changed still lets its author answer (the page says the section changed);
/// one the author no longer publishes, or under a name that is no longer
/// theirs, does not, because the person who wrote it cannot be confirmed.
pub fn admit_response(
    policy: &ModerationPolicy,
    request: &ResponseRequest<'_>,
) -> Result<AttributedResponse, ResponseError> {
    let target = AttributedTarget::from_perspective(request.parent_target)
        .map_err(|_| ResponseError::NotAttributed)?
        .ok_or(ResponseError::NotAttributed)?;
    // The actor the session resolved must be this very account, so a
    // request cannot pair one account's grant with another's actor.
    if request.actor.admin_user() != Some(request.admin_user) {
        return Err(ResponseError::Denied);
    }
    let participant = request
        .record
        .collaboration
        .participants
        .iter()
        .find(|participant| participant.id.eq_ignore_ascii_case(&target.contribution))
        .ok_or(ResponseError::Denied)?;
    authorize_author(
        request.record,
        request.identities,
        request.admin_user,
        &participant.id,
    )?;
    if request.parent.kind != ParticipationKind::ThirdPerspective
        || request.parent.work != Some(request.work)
        || !is_public(request.parent, request.parent_mode)
    {
        return Err(ResponseError::Unavailable);
    }
    let standing = request.sections.resolve(&target);
    let author = match &standing {
        Standing::Current { author, .. } => Some(author),
        Standing::Stale { author, .. } => author.as_ref(),
    };
    let Some(author) = author.filter(|name| **name == participant.display_name) else {
        return Err(ResponseError::AuthorUnconfirmed);
    };
    let admission = policy
        .admit(&Submission {
            id: request.id,
            actor: request.actor,
            kind: ParticipationKind::AuthorResponse,
            work: Some(request.work),
            mode: request.mode,
            parent: Some((request.parent, request.parent_mode)),
            clarification_consent: false,
            at: request.at,
        })
        .map_err(ResponseError::Policy)?;
    Ok(AttributedResponse {
        admission,
        responder: Responder {
            participant: participant.id.clone(),
            author: author.clone(),
            standing,
        },
    })
}

/// Whether a stored response is shown to readers: it is public itself and
/// answers a Third Perspective that is public now. A response never outlives
/// its parent's publication, and removing the parent hides it without
/// deleting it.
pub fn response_shown(
    response: &ItemFacts<'_>,
    response_mode: ParticipationMode,
    parent: &ItemFacts<'_>,
    parent_mode: ParticipationMode,
) -> bool {
    response.kind == ParticipationKind::AuthorResponse
        && response.parent == Some(parent.id)
        && response.work == parent.work
        && is_public(response, response_mode)
        && is_public(parent, parent_mode)
}

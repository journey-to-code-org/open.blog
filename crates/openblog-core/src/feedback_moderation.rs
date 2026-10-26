//! Moderating passage feedback (ADR 0083).
//!
//! A reader's submission starts pending. A moderator approves it, or rejects
//! it with a reason; an approved item can later be removed with a reason.
//! Every change names the state it expects and the item's version, so two
//! moderators can never both act on the same item, and the hosted function
//! records an audit event for each one (`openblog_feedback_events`).
//!
//! The state names are those of the participation and moderation policy
//! (RD12, #211): `pending`, `clarification`, `approved`, `rejected`,
//! `removed` and `withdrawn`. This module uses the subset B5 needs: it reads
//! every state, so an item another tool moved is shown rather than misread,
//! but offers only approve, reject and remove. The unified moderation inbox
//! (#225) can replace this module without a data migration.
//!
//! A moderator always sees where the reader's passage is now
//! ([`PassageReview`]): current, re-anchored after the page changed, or
//! stale, so nobody approves feedback about words that silently moved or are
//! gone. Approval never edits the post: accepting a suggestion is a separate
//! author edit, and a revision note is the author's own words (ADR 0075).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::model::{Post, Site};
use crate::passage_target::{PassageDocument, PassageSelector, Resolution, StaleReason};
use crate::scholarly_feedback::{HostedFeedback, ScholarlyFeedback};

/// Where an item is in moderation. Only `Approved` is ever public.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ModerationState {
    /// Received and waiting for a moderator.
    Pending,
    /// A moderator asked the submitter to clarify (RD12). Never public.
    Clarification,
    /// Accepted for publication on the post.
    Approved,
    /// Declined, with a reason. Never public.
    Rejected,
    /// Taken off the post after approval, with a reason. Never public.
    Removed,
    /// Taken back by its submitter (RD12). Never public.
    Withdrawn,
}

impl ModerationState {
    pub const ALL: [ModerationState; 6] = [
        ModerationState::Pending,
        ModerationState::Clarification,
        ModerationState::Approved,
        ModerationState::Rejected,
        ModerationState::Removed,
        ModerationState::Withdrawn,
    ];

    /// The stored id, as the `status` column holds it (ADR 0080).
    pub fn id(self) -> &'static str {
        match self {
            ModerationState::Pending => "pending",
            ModerationState::Clarification => "clarification",
            ModerationState::Approved => "approved",
            ModerationState::Rejected => "rejected",
            ModerationState::Removed => "removed",
            ModerationState::Withdrawn => "withdrawn",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|state| state.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            ModerationState::Pending => "Pending",
            ModerationState::Clarification => "Waiting for clarification",
            ModerationState::Approved => "Approved",
            ModerationState::Rejected => "Rejected",
            ModerationState::Removed => "Removed",
            ModerationState::Withdrawn => "Withdrawn",
        }
    }
}

impl Serialize for ModerationState {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.id())
    }
}

impl<'de> Deserialize<'de> for ModerationState {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let id = String::deserialize(deserializer)?;
        Self::from_id(&id).ok_or_else(|| serde::de::Error::custom("unknown moderation state"))
    }
}

/// Why a moderator declined or removed an item. Reasons are moderation
/// grounds, never a verdict on facts: there is no "incorrect" code, and a
/// rejected suggested correction is not thereby wrong. The ids are RD12's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ReasonCode {
    Spam,
    Abusive,
    PersonalData,
    OffTopic,
    Duplicate,
    Rights,
    Other,
}

impl ReasonCode {
    pub const ALL: [ReasonCode; 7] = [
        ReasonCode::Spam,
        ReasonCode::Abusive,
        ReasonCode::PersonalData,
        ReasonCode::OffTopic,
        ReasonCode::Duplicate,
        ReasonCode::Rights,
        ReasonCode::Other,
    ];

    pub fn id(self) -> &'static str {
        match self {
            ReasonCode::Spam => "spam",
            ReasonCode::Abusive => "abusive",
            ReasonCode::PersonalData => "personal-data",
            ReasonCode::OffTopic => "off-topic",
            ReasonCode::Duplicate => "duplicate",
            ReasonCode::Rights => "rights",
            ReasonCode::Other => "other",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|reason| reason.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            ReasonCode::Spam => "Spam",
            ReasonCode::Abusive => "Abusive",
            ReasonCode::PersonalData => "Contains personal data",
            ReasonCode::OffTopic => "Off topic",
            ReasonCode::Duplicate => "Duplicate",
            ReasonCode::Rights => "Rights or permission problem",
            ReasonCode::Other => "Other",
        }
    }
}

/// A change a moderator asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ModerationAction {
    /// Pending to approved: publish it on the post.
    Approve,
    /// Pending or clarification to rejected, with a reason.
    Reject,
    /// Approved to removed, with a reason: take it off the post.
    Remove,
}

impl ModerationAction {
    pub const ALL: [ModerationAction; 3] = [
        ModerationAction::Approve,
        ModerationAction::Reject,
        ModerationAction::Remove,
    ];

    pub fn id(self) -> &'static str {
        match self {
            ModerationAction::Approve => "approve",
            ModerationAction::Reject => "reject",
            ModerationAction::Remove => "remove",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            ModerationAction::Approve => "Approve",
            ModerationAction::Reject => "Reject",
            ModerationAction::Remove => "Remove from the post",
        }
    }

    /// The states this action may start from.
    pub fn from_states(self) -> &'static [ModerationState] {
        match self {
            ModerationAction::Approve => &[ModerationState::Pending],
            ModerationAction::Reject => &[ModerationState::Pending, ModerationState::Clarification],
            ModerationAction::Remove => &[ModerationState::Approved],
        }
    }

    pub fn to_state(self) -> ModerationState {
        match self {
            ModerationAction::Approve => ModerationState::Approved,
            ModerationAction::Reject => ModerationState::Rejected,
            ModerationAction::Remove => ModerationState::Removed,
        }
    }

    /// The reasons a request may give; empty means it gives none. Reject and
    /// remove need one.
    pub fn reasons(self) -> &'static [ReasonCode] {
        match self {
            ModerationAction::Approve => &[],
            ModerationAction::Reject | ModerationAction::Remove => &ReasonCode::ALL,
        }
    }

    /// The actions open to an item in `state`, in a fixed order.
    pub fn available(state: ModerationState) -> Vec<ModerationAction> {
        Self::ALL
            .into_iter()
            .filter(|action| action.from_states().contains(&state))
            .collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModerationErrorCode {
    UnknownAction,
    NotAllowed,
    ReasonRequired,
    ReasonNotAllowed,
    UnknownReason,
}

/// Why a change was refused. Nothing changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModerationError {
    pub code: ModerationErrorCode,
    pub message: String,
}

impl std::fmt::Display for ModerationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ModerationError {}

/// A checked change: from the state the moderator saw to the next one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModerationChange {
    pub action: ModerationAction,
    pub from: ModerationState,
    pub to: ModerationState,
    pub reason: Option<ReasonCode>,
}

/// Check one requested change against the item's current state. Every
/// combination this does not list is refused.
pub fn plan(
    current: ModerationState,
    action: &str,
    reason: Option<&str>,
) -> Result<ModerationChange, ModerationError> {
    let refuse = |code, message: String| Err(ModerationError { code, message });
    let Some(action) = ModerationAction::from_id(action) else {
        return refuse(
            ModerationErrorCode::UnknownAction,
            "Choose approve, reject or remove.".into(),
        );
    };
    if !action.from_states().contains(&current) {
        return refuse(
            ModerationErrorCode::NotAllowed,
            format!(
                "An item that is {} cannot be changed with {}.",
                current.label().to_lowercase(),
                action.id()
            ),
        );
    }
    let reason = match (reason.filter(|reason| !reason.is_empty()), action.reasons()) {
        (None, []) => None,
        (Some(_), []) => {
            return refuse(
                ModerationErrorCode::ReasonNotAllowed,
                format!("{} takes no reason.", action.label()),
            )
        }
        (None, _) => {
            return refuse(
                ModerationErrorCode::ReasonRequired,
                format!("Choose a reason to {}.", action.id()),
            )
        }
        (Some(id), allowed) => {
            match ReasonCode::from_id(id).filter(|code| allowed.contains(code)) {
                Some(code) => Some(code),
                None => {
                    return refuse(
                        ModerationErrorCode::UnknownReason,
                        "Choose one of the listed reasons.".into(),
                    )
                }
            }
        }
    };
    Ok(ModerationChange {
        action,
        from: current,
        to: action.to_state(),
        reason,
    })
}

/// The moderation rules as data: every state, and for each action the states
/// it starts from, the state it leads to and the reasons it takes. The hosted
/// function holds the same table; both are checked against
/// `tests/fixtures/feedback-moderation.json`.
pub fn rules() -> Value {
    let actions: serde_json::Map<String, Value> = ModerationAction::ALL
        .into_iter()
        .map(|action| {
            (
                action.id().to_string(),
                json!({
                    "from": action.from_states().iter().map(|state| state.id()).collect::<Vec<_>>(),
                    "to": action.to_state().id(),
                    "reasons": action.reasons().iter().map(|reason| reason.id()).collect::<Vec<_>>(),
                }),
            )
        })
        .collect();
    json!({
        "states": ModerationState::ALL.iter().map(|state| state.id()).collect::<Vec<_>>(),
        "actions": actions,
    })
}

/// What a moderator learns about the reader's passage before acting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PassageCheck {
    /// Seen on the revision now published, and the words are where they were.
    Current,
    /// The page changed; the same words were found again, once.
    Reanchored,
    /// The words the reader meant cannot be found as the same passage.
    Stale(StaleReason),
    /// No loaded post has the feedback's address, so nothing can be checked.
    UnknownWork,
}

impl PassageCheck {
    pub fn id(self) -> &'static str {
        match self {
            PassageCheck::Current => "current",
            PassageCheck::Reanchored => "reanchored",
            PassageCheck::Stale(_) => "stale",
            PassageCheck::UnknownWork => "unknown-work",
        }
    }

    /// Whether approving needs the moderator to confirm they read the
    /// passage as it is now: anything but a current passage does.
    pub fn needs_acknowledgement(self) -> bool {
        self != PassageCheck::Current
    }
}

fn stale_reason_id(reason: StaleReason) -> &'static str {
    match reason {
        StaleReason::QuoteNotFound => "quoteNotFound",
        StaleReason::ContextChanged => "contextChanged",
        StaleReason::Ambiguous => "ambiguous",
        StaleReason::SectionRemoved => "sectionRemoved",
        StaleReason::SectionChanged => "sectionChanged",
        StaleReason::Unverified => "unverified",
    }
}

/// The heading title of each section of a post's passage document, by
/// section index. Anchors can repeat, so each anchor takes the titles of its
/// headings in order, as the feedback form does (ADR 0082).
pub fn section_titles(post: &Post, document: &PassageDocument) -> Vec<Option<String>> {
    let mut titles: std::collections::HashMap<&str, std::collections::VecDeque<&str>> =
        std::collections::HashMap::new();
    for heading in &post.headings {
        titles
            .entry(heading.id.as_str())
            .or_default()
            .push_back(heading.text.as_str());
    }
    document
        .sections
        .iter()
        .map(|section| {
            section.anchor.as_deref().and_then(|anchor| {
                titles
                    .get_mut(anchor)
                    .and_then(|queue| queue.pop_front())
                    .map(str::to_string)
            })
        })
        .collect()
}

/// The passage of one item, read against the post as it is now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PassageReview {
    pub check: PassageCheck,
    /// The passage revision now published, when the post is known.
    pub revision_now: Option<String>,
    /// The section the passage is in now (its title, or its anchor), when
    /// the passage still resolves.
    pub section_now: Option<String>,
    /// A plain explanation for the moderator.
    pub explanation: String,
}

/// Check one item's passage against the post that has its address now.
pub fn review_passage(
    feedback: &ScholarlyFeedback,
    post: Option<(&Post, &PassageDocument)>,
) -> PassageReview {
    let Some((post, document)) = post else {
        return PassageReview {
            check: PassageCheck::UnknownWork,
            revision_now: None,
            section_now: None,
            explanation: "No post has this address now: it may have moved, been renamed or been unpublished. The passage cannot be checked, so read the note carefully before acting on it.".into(),
        };
    };
    let titles = section_titles(post, document);
    let resolution = feedback.provenance.resolve(document);
    let section_now = resolution.location().and_then(|location| {
        location
            .index
            .and_then(|index| titles.get(index).cloned().flatten())
            .or_else(|| location.section.clone())
    });
    let whole_post = matches!(feedback.provenance.target.selector, PassageSelector::Work);
    let place = || match &section_now {
        Some(section) => format!("in “{section}”"),
        None if whole_post => "about the whole post".into(),
        None => "before the first heading".into(),
    };
    let (check, explanation) = match &resolution {
        Resolution::Current(_) => (
            PassageCheck::Current,
            format!(
                "Current: the reader saw the revision that is published now, and the passage is {}.",
                place()
            ),
        ),
        Resolution::Reanchored(_) => (
            PassageCheck::Reanchored,
            format!(
                "Re-anchored: the post changed after the reader saw it. The same words were found again, once, {}. Check that they still mean what the reader read before you act.",
                place()
            ),
        ),
        Resolution::Stale(stale) => {
            let why = match stale.reason {
                StaleReason::QuoteNotFound => "the words the reader quoted are no longer in the post",
                StaleReason::ContextChanged => "the words are still there, but none of the text around them is",
                StaleReason::Ambiguous => "the words now appear in more than one place",
                StaleReason::SectionRemoved => "the section the reader meant is gone",
                StaleReason::SectionChanged => "the section the reader meant has different text now",
                StaleReason::Unverified => "the section is there, but nothing shows whether its text changed",
            };
            (
                PassageCheck::Stale(stale.reason),
                format!(
                    "Stale: the post changed after the reader saw it, and {why}. The reader's quotation is shown as they sent it; it will not be quoted on the post."
                ),
            )
        }
    };
    PassageReview {
        check,
        revision_now: Some(document.revision.clone()),
        section_now,
        explanation,
    }
}

/// The loaded post with a work's address, if any.
pub fn post_for_work<'a>(site: &'a Site, work: &str) -> Option<&'a Post> {
    site.posts.iter().find(|post| post.url == work)
}

/// One moderation item as Admin shows it to the site's moderator: the
/// reader's feedback, the passage check, the public form it would take, and
/// the actions open to it. The reader's name is shown here, to moderation
/// only, with their publication choice; the reader's own clock is not.
pub fn moderation_view(item: &HostedFeedback, site: &Site) -> Value {
    let feedback = &item.feedback;
    let provenance = &feedback.provenance;
    let post = post_for_work(site, &provenance.work);
    let document = post.map(|post| PassageDocument::of_post(post, &site.config));
    let review = review_passage(feedback, post.zip(document.as_ref()));
    let quoted = match &provenance.target.selector {
        PassageSelector::Quote(quote) => Some(quote.exact.clone()),
        _ => None,
    };
    let actions: Vec<Value> = ModerationAction::available(item.status)
        .into_iter()
        .map(|action| {
            json!({
                "action": action.id(),
                "label": action.label(),
                "reasons": action.reasons().iter().map(|reason| json!({"id": reason.id(), "label": reason.label()})).collect::<Vec<_>>(),
            })
        })
        .collect();
    let mut passage = json!({
        "check": review.check.id(),
        "explanation": review.explanation,
        "revisionSeen": provenance.revision,
        "acknowledge": review.check.needs_acknowledgement(),
    });
    if let PassageCheck::Stale(reason) = review.check {
        passage["reason"] = json!(stale_reason_id(reason));
    }
    if let Some(section) = &provenance.target.section {
        passage["sectionSeen"] = json!(section);
    }
    if let Some(section) = &review.section_now {
        passage["sectionNow"] = json!(section);
    }
    if let Some(revision) = &review.revision_now {
        passage["revisionNow"] = json!(revision);
    }
    if let Some(quoted) = quoted {
        passage["quoted"] = json!(quoted);
    }
    let mut details = json!({});
    if let Some(url) = &feedback.details.source_url {
        details["sourceUrl"] = json!(url);
    }
    if let Some(text) = &feedback.details.suggested_text {
        details["suggestedText"] = json!(text);
    }
    let mut reader = json!({ "publishName": provenance.attribution.publish_name });
    if let Some(name) = &provenance.attribution.name {
        reader["name"] = json!(name);
    }
    json!({
        "id": item.id,
        "status": item.status.id(),
        "statusLabel": item.status.label(),
        "version": item.version,
        "moderatedAt": item.moderated_at.map(crate::DateTime::rfc3339),
        "reason": item.reason.map(ReasonCode::id),
        "reasonLabel": item.reason.map(ReasonCode::label),
        "kind": feedback.kind.id(),
        "kindLabel": feedback.kind.label(),
        "body": feedback.body,
        "details": details,
        "work": provenance.work,
        "post": post.map(|post| json!({"title": post.title, "source": post.source, "url": post.url})),
        "receivedAt": provenance.received_at.rfc3339(),
        "reader": reader,
        "passage": passage,
        "publicPreview": document.as_ref().map(|document| serde_json::to_value(provenance.public(document)).expect("public provenance serializes")),
        "actions": actions,
    })
}

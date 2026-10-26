//! The one participation moderation inbox (ADR 0104).
//!
//! Hosted comments and passage feedback, and every later participation kind
//! once it has a store, are moderated in one list driven by the one state
//! machine ([`crate::moderation`]). Each item the hosted service returns is
//! read again here with a strict validator, given the actor its viewer is on
//! that item's work ([`SharedWorks::actor`]), shown only as far as
//! [`may_view`] allows, and offered exactly the actions
//! [`ModerationPolicy::decide`] accepts now, so the inbox never offers a
//! change the server would refuse and never shows what the viewer may not
//! see. Hostile text stays text: nothing here builds markup.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::date::DateTime;
use crate::feedback_moderation::{feedback_review, post_for_work};
use crate::invitation::Identities;
use crate::model::Site;
use crate::moderation::{
    allowed_reasons, is_public, may_view, Actor, ActorRole, Decision, ItemFacts, ModerationAction,
    ModerationPolicy, ModerationState, PolicyError, Principal, ReasonCode, Request, SharedWorks,
    View,
};
use crate::participation::{effective_mode, ParticipationKind, ParticipationMode};
use crate::scholarly_feedback::{is_uuid, HostedFeedback};

/// The decisions the inbox offers, in the order its cards show them. The
/// submitter's own actions (clarify, withdraw), expiry and upholding a report
/// are not the inbox's: readers and the retention job take them, and abuse
/// reports have no store yet (#226).
pub const INBOX_ACTIONS: [ModerationAction; 5] = [
    ModerationAction::Approve,
    ModerationAction::RequestClarification,
    ModerationAction::Reject,
    ModerationAction::Remove,
    ModerationAction::Reopen,
];

/// The longest page the inbox asks the hosted service for.
pub const PAGE_SIZE: usize = 50;
const MAX_PAGE_ITEMS: usize = 200;
const MAX_COMMENT_CHARS: usize = 4_000;
const MAX_NAME_CHARS: usize = 80;

/// What the hosted service can store for moderation (ADR 0105).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Protocol {
    /// `supabase/moderation.sql` was run and `OPENBLOG_MODERATION_ENABLED`
    /// set: every inbox action, versioned and audited, for every store.
    Full,
    /// The schema as it was before the inbox: comments can be approved,
    /// rejected, removed (stored as rejected) and reopened, passage feedback
    /// approved, rejected and removed (ADR 0083). Nothing else is offered.
    Legacy,
}

impl Protocol {
    pub fn id(self) -> &'static str {
        match self {
            Protocol::Full => "full",
            Protocol::Legacy => "legacy",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "full" => Some(Protocol::Full),
            "legacy" => Some(Protocol::Legacy),
            _ => None,
        }
    }

    /// Whether the hosted service can store `action` on `kind`.
    pub fn supports(self, kind: ParticipationKind, action: ModerationAction) -> bool {
        use ModerationAction::*;
        match self {
            Protocol::Full => true,
            Protocol::Legacy if kind == ParticipationKind::Comment => {
                matches!(action, Approve | Reject | Remove | Reopen)
            }
            Protocol::Legacy => {
                ParticipationKind::PASSAGE_FEEDBACK.contains(&kind)
                    && matches!(action, Approve | Reject | Remove)
            }
        }
    }
}

/// Where a hosted item is stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// `openblog_comments`.
    Comment,
    /// `openblog_feedback` (ADR 0080).
    Feedback,
}

impl Source {
    pub fn id(self) -> &'static str {
        match self {
            Source::Comment => "comment",
            Source::Feedback => "feedback",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "comment" => Some(Source::Comment),
            "feedback" => Some(Source::Feedback),
            _ => None,
        }
    }
}

/// What an item carries besides its moderation facts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    /// A comment: its author's name, which comments always show, and text.
    Comment { author_name: String, body: String },
    /// A passage feedback record with its provenance (ADRs 0078, 0079).
    Feedback(Box<HostedFeedback>),
}

/// One hosted item, read and checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InboxItem {
    pub source: Source,
    pub id: String,
    pub kind: ParticipationKind,
    pub state: ModerationState,
    pub version: u64,
    pub revision: u32,
    /// Set only while approved.
    pub approved_revision: Option<u32>,
    pub clarification_asked: Option<u32>,
    pub clarification_consent: bool,
    pub reason: Option<ReasonCode>,
    pub moderated_at: Option<DateTime>,
    pub received_at: DateTime,
    /// The published work's path.
    pub work: String,
    pub content: Content,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireComment {
    #[allow(dead_code)]
    source: String,
    id: String,
    status: String,
    version: u64,
    #[serde(default)]
    moderated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    comment: WireCommentBody,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireCommentBody {
    path: String,
    author_name: String,
    body: String,
    created_at: String,
}

/// Whether `value` is a published post path the hosted service accepts.
pub fn is_site_path(value: &str) -> bool {
    (2..=500).contains(&value.len())
        && value.starts_with('/')
        && !value.starts_with("//")
        && value.ends_with('/')
        && !value.contains(['\\', '?', '#'])
        && !value.chars().any(char::is_control)
        && !value.split('/').any(|part| matches!(part, "." | ".."))
}

/// A UTC time as the hosted service writes it: `2026-10-26T10:00:00Z`.
fn canonical_time(value: &str) -> Option<DateTime> {
    DateTime::parse(value).filter(|time| time.rfc3339() == value)
}

fn comment_text_ok(value: &str, max: usize, multiline: bool) -> bool {
    let length = value.chars().count();
    (1..=max).contains(&length)
        && value.trim() == value
        && !value
            .chars()
            .any(|c| c.is_control() && !(multiline && matches!(c, '\n' | '\r' | '\t')))
}

impl InboxItem {
    /// Read one hosted item. A bad item is refused on its own, naming what is
    /// wrong but never repeating what it holds.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        match value["source"].as_str().and_then(Source::from_id) {
            Some(Source::Comment) => Self::read_comment(value),
            Some(Source::Feedback) => Self::read_feedback(value),
            None => Err("an inbox item needs a known `source`".into()),
        }
    }

    fn read_comment(value: &Value) -> Result<Self, String> {
        let wire: WireComment = serde_json::from_value(value.clone())
            .map_err(|_| "a hosted comment has an unknown or mistyped field".to_string())?;
        if !is_uuid(&wire.id) {
            return Err("a hosted comment needs a UUID `id`".into());
        }
        let state = ModerationState::from_id(&wire.status)
            .filter(|state| {
                // Comments carry no clarification consent and no receipt.
                !matches!(
                    state,
                    ModerationState::Clarification | ModerationState::Withdrawn
                )
            })
            .ok_or("a hosted comment has a state comments cannot be in")?;
        if wire.version == 0 || wire.version > i32::MAX as u64 {
            return Err("a hosted comment needs a positive `version`".into());
        }
        let body = wire.comment;
        if !is_site_path(&body.path) {
            return Err("a hosted comment needs a post path".into());
        }
        if !comment_text_ok(&body.author_name, MAX_NAME_CHARS, false) {
            return Err(
                "a hosted comment needs a plain author name of at most 80 characters".into(),
            );
        }
        if !comment_text_ok(&body.body, MAX_COMMENT_CHARS, true) {
            return Err("a hosted comment needs text of at most 4,000 characters".into());
        }
        let received_at =
            canonical_time(&body.created_at).ok_or("a hosted comment needs a UTC `createdAt`")?;
        let moderated_at = wire
            .moderated_at
            .map(|time| canonical_time(&time).ok_or("`moderatedAt` must be a UTC time"))
            .transpose()?;
        let reason = wire
            .reason
            .map(|reason| {
                ReasonCode::from_id(&reason).ok_or("a hosted comment has an unknown reason")
            })
            .transpose()?;
        Ok(Self {
            source: Source::Comment,
            id: wire.id,
            kind: ParticipationKind::Comment,
            state,
            version: wire.version,
            revision: 1,
            approved_revision: (state == ModerationState::Approved).then_some(1),
            clarification_asked: None,
            clarification_consent: false,
            reason,
            moderated_at,
            received_at,
            work: body.path,
            content: Content::Comment {
                author_name: body.author_name,
                body: body.body,
            },
        })
    }

    fn read_feedback(value: &Value) -> Result<Self, String> {
        let mut wire = value.clone();
        if let Some(object) = wire.as_object_mut() {
            object.remove("source");
        }
        let hosted = HostedFeedback::from_value(&wire).map_err(|error| error.to_string())?;
        Ok(Self {
            source: Source::Feedback,
            id: hosted.id.clone(),
            kind: hosted.feedback.kind.participation_kind(),
            state: hosted.status,
            version: hosted.version,
            revision: hosted.revision,
            approved_revision: hosted.approved_revision,
            clarification_asked: hosted.clarification_asked,
            clarification_consent: hosted.clarification_consent,
            reason: hosted.reason,
            moderated_at: hosted.moderated_at,
            received_at: hosted.feedback.provenance.received_at,
            work: hosted.feedback.provenance.work.clone(),
            content: Content::Feedback(Box::new(hosted)),
        })
    }

    /// The facts the policy decides on.
    pub fn facts(&self) -> ItemFacts<'_> {
        ItemFacts {
            id: &self.id,
            kind: self.kind,
            work: Some(&self.work),
            parent: None,
            state: self.state,
            version: self.version,
            revision: self.revision,
            approved_revision: self.approved_revision,
            clarification_asked: self.clarification_asked,
            clarification_consent: self.clarification_consent,
            content_retained: true,
            state_since: self.moderated_at.unwrap_or(self.received_at),
        }
    }

    /// The feedback record, for a feedback item.
    pub fn feedback(&self) -> Option<&HostedFeedback> {
        match &self.content {
            Content::Feedback(hosted) => Some(hosted),
            Content::Comment { .. } => None,
        }
    }
}

/// One page of the hosted inbox.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostedPage {
    pub protocol: Protocol,
    pub items: Vec<InboxItem>,
    /// Items that failed validation, counted and never shown half-checked.
    pub invalid: usize,
    /// The opaque cursor of the next page, if there is one.
    pub next: Option<String>,
}

/// Whether `value` is a cursor the hosted service could have written.
pub fn is_cursor(value: &str) -> bool {
    (1..=160).contains(&value.len())
        && value.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b':' | b'.' | b'+' | b'~' | b'-' | b'_')
        })
}

/// Read one page of `GET /admin/moderation`.
pub fn read_page(value: &Value) -> Result<HostedPage, String> {
    let protocol = value["protocol"]
        .as_str()
        .and_then(Protocol::from_id)
        .ok_or("the hosted inbox did not say what it can store")?;
    let rows = value["items"]
        .as_array()
        .filter(|rows| rows.len() <= MAX_PAGE_ITEMS)
        .ok_or("the hosted inbox returned no list of items")?;
    let next = match &value["next"] {
        Value::Null => None,
        Value::String(cursor) if is_cursor(cursor) => Some(cursor.clone()),
        _ => return Err("the hosted inbox returned an invalid cursor".into()),
    };
    let mut items = Vec::with_capacity(rows.len());
    let mut invalid = 0;
    for row in rows {
        match InboxItem::from_value(row) {
            Ok(item) => items.push(item),
            Err(_) => invalid += 1,
        }
    }
    Ok(HostedPage {
        protocol,
        items,
        invalid,
        next,
    })
}

/// One viewer's inbox: who they are, on which site, and what the hosted
/// service can store.
pub struct Inbox<'a> {
    pub site: &'a Site,
    pub works: &'a SharedWorks<'a>,
    pub principal: Principal<'a>,
    pub identities: &'a Identities<'a>,
    pub policy: ModerationPolicy,
    pub protocol: Protocol,
    pub now: DateTime,
}

impl<'a> Inbox<'a> {
    /// The viewer's actor on this item's work (ADR 0102): never from the
    /// request, always from the session or token and the stored records.
    pub fn actor(&self, item: &InboxItem) -> Actor<'a> {
        self.works
            .actor(self.principal, Some(&item.work), self.identities)
    }

    /// The item's kind's mode on its post now; a post no longer loaded shows
    /// nothing.
    pub fn mode(&self, item: &InboxItem) -> ParticipationMode {
        post_for_work(self.site, &item.work).map_or(ParticipationMode::Hidden, |post| {
            effective_mode(&self.site.config, post, item.kind)
        })
    }

    /// Decide one request as the policy would, then refuse what the hosted
    /// service cannot store. The grant is checked first, so a viewer without
    /// one learns nothing about the item.
    pub fn decide(
        &self,
        item: &InboxItem,
        action: ModerationAction,
        expected_version: u64,
        reason: Option<ReasonCode>,
    ) -> Result<Decision, PolicyError> {
        let decision = self.policy.decide(
            &item.facts(),
            &Request {
                actor: self.actor(item),
                action,
                expected_version,
                reason,
                at: self.now,
                reported_item: None,
            },
        )?;
        if !INBOX_ACTIONS.contains(&action) || !self.protocol.supports(item.kind, action) {
            return Err(PolicyError::NotAllowed);
        }
        Ok(decision)
    }

    /// The inbox actions this viewer can take on the item now, each checked
    /// by the policy with a reason it accepts.
    pub fn actions(&self, item: &InboxItem) -> Vec<ModerationAction> {
        INBOX_ACTIONS
            .into_iter()
            .filter(|action| {
                let reason = allowed_reasons(*action, item.kind).first().copied();
                self.decide(item, *action, item.version, reason).is_ok()
            })
            .collect()
    }

    /// The item as this viewer may see it, or `None` when they may not see
    /// it at all: a viewer who holds no moderation role on its work, or a
    /// contributing author looking at an abuse report. A reader's name they
    /// did not agree to publish is shown only to the site Admin.
    pub fn view(&self, item: &InboxItem) -> Option<Value> {
        let actor = self.actor(item);
        if matches!(actor.role(), ActorRole::Public | ActorRole::System) {
            return None;
        }
        let facts = item.facts();
        let mode = self.mode(item);
        if !may_view(&actor, &facts, mode, View::Content) {
            return None;
        }
        let private_identity = may_view(&actor, &facts, mode, View::PrivateIdentity);
        let post = post_for_work(self.site, &item.work);
        let actions: Vec<Value> = self
            .actions(item)
            .into_iter()
            .map(|action| {
                json!({
                    "action": action.id(),
                    "label": action.label(),
                    "reasons": allowed_reasons(action, item.kind).iter().map(|reason| json!({"id": reason.id(), "label": reason.label()})).collect::<Vec<_>>(),
                    "guidance": guidance(&self.policy, item, action),
                })
            })
            .collect();
        let mut view = json!({
            "id": item.id,
            "source": item.source.id(),
            "kind": item.kind.id(),
            "kindLabel": item.kind.label(),
            "status": item.state.id(),
            "statusLabel": item.state.label(),
            "version": item.version,
            "revision": item.revision,
            "reason": item.reason.map(ReasonCode::id),
            "reasonLabel": item.reason.map(ReasonCode::label),
            "receivedAt": item.received_at.rfc3339(),
            "moderatedAt": item.moderated_at.map(DateTime::rfc3339),
            "work": item.work,
            "post": post.map(|post| json!({"title": post.title, "url": post.url, "source": post.source.replace('\\', "/")})),
            "role": actor.role().id(),
            "mode": mode.id(),
            "public": is_public(&facts, mode),
            "clarification": {
                "askedAboutThisText": facts.current_revision_asked(),
                "consent": item.clarification_consent,
            },
            "actions": actions,
        });
        match &item.content {
            Content::Comment { author_name, body } => {
                view["body"] = json!(body);
                view["details"] = json!({});
                // Comments always show their author's name.
                view["reader"] = json!({ "name": author_name, "publishName": true });
            }
            Content::Feedback(hosted) => {
                let feedback = &hosted.feedback;
                view["body"] = json!(feedback.body);
                let review = feedback_review(feedback, self.site);
                view["details"] = review["details"].clone();
                view["passage"] = review["passage"].clone();
                view["publicPreview"] = review["publicPreview"].clone();
                let attribution = &feedback.provenance.attribution;
                let mut reader = json!({ "publishName": attribution.publish_name });
                match &attribution.name {
                    Some(name) if private_identity || attribution.publish_name => {
                        reader["name"] = json!(name);
                    }
                    Some(_) => reader["private"] = json!(true),
                    None => {}
                }
                view["reader"] = reader;
            }
        }
        Some(view)
    }
}

/// What a moderator should know before taking `action`: what it does, and
/// for a decision that closes the item, how long its text is kept.
pub fn guidance(policy: &ModerationPolicy, item: &InboxItem, action: ModerationAction) -> String {
    let retention = if policy.retains(item.kind) {
        format!(
            "Its text is due to be purged {} days after this decision; the private record of the decision is kept for {} days.",
            policy.retention.closed_days, policy.retention.audit_days
        )
    } else {
        "Comments are kept until you act, because this site has not set participation.retention."
            .to_string()
    };
    match action {
        ModerationAction::Approve if item.kind == ParticipationKind::Comment => {
            "Shows the comment on its post.".into()
        }
        ModerationAction::Approve => {
            "Publishes the reader’s words on the post as theirs, at this revision. It never edits your post, and it does not mean you agree.".into()
        }
        ModerationAction::Reject => format!("Never shown. {retention}"),
        ModerationAction::Remove => format!("Takes it off the post. {retention}"),
        ModerationAction::RequestClarification => {
            "Asks the reader, through their private receipt, to revise it; nothing is e-mailed. The text you asked about can never be approved, only the reader’s answer can.".into()
        }
        ModerationAction::Reopen => {
            "Returns it to pending for a fresh decision, or to waiting for clarification if the reader was asked about this text and has not answered.".into()
        }
        _ => String::new(),
    }
}

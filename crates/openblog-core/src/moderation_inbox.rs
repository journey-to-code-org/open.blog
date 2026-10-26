//! The one participation moderation inbox (ADR 0104).
//!
//! Hosted comments, passage feedback and abuse reports (ADR 0130), and every
//! later participation kind once it has a store, are moderated in one list driven by the one state
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
    allowed_reasons, is_public, may_view, Actor, ActorRole, Decision, Erasure, ItemFacts,
    ModerationAction, ModerationPolicy, ModerationState, PolicyError, Principal, ReasonCode,
    Request, RetentionStep, SharedWorks, View,
};
use crate::participation::{effective_mode, ParticipationKind, ParticipationMode};
use crate::scholarly_feedback::{is_uuid, HostedFeedback};

/// The decisions the inbox offers on any item, in the order its cards show
/// them. The submitter's own actions (clarify, withdraw) and expiry are not
/// the inbox's: readers, through their receipts, and the retention job take
/// them. Upholding an abuse report ([`ModerationAction::UpholdReport`]) is
/// offered on reports alone, decided with the item the report names.
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
const MAX_TARGET_CHARS: usize = 20_000;
/// The longest abuse report a reader may write (ADR 0130).
pub const MAX_REPORT_CHARS: usize = 1_000;

/// The grounds a reader may give for an abuse report: the reasons a
/// moderator may uphold one for (ADR 0101), never a verdict on facts.
pub fn report_grounds() -> &'static [ReasonCode] {
    allowed_reasons(
        ModerationAction::UpholdReport,
        ParticipationKind::AbuseReport,
    )
}

/// The action id a site Admin sends to delete an item's text and name on a
/// reader's request ([`ModerationPolicy::erase`]).
pub const ERASE_ACTION: &str = "erase";

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
    /// The inbox's schema with `supabase/protection.sql` run and
    /// `OPENBLOG_PROTECTION_ENABLED` set (ADR 0131): everything [`Full`]
    /// stores, plus abuse reports, purged text and deletion requests.
    ///
    /// [`Full`]: Protocol::Full
    Protected,
}

impl Protocol {
    pub fn id(self) -> &'static str {
        match self {
            Protocol::Full => "full",
            Protocol::Legacy => "legacy",
            Protocol::Protected => "protected",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "full" => Some(Protocol::Full),
            "legacy" => Some(Protocol::Legacy),
            "protected" => Some(Protocol::Protected),
            _ => None,
        }
    }

    /// Whether the hosted service can store `action` on `kind`.
    pub fn supports(self, kind: ParticipationKind, action: ModerationAction) -> bool {
        use ModerationAction::*;
        match self {
            Protocol::Protected => true,
            Protocol::Full => kind != ParticipationKind::AbuseReport,
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
    /// `openblog_abuse_reports` (ADR 0130).
    Report,
}

impl Source {
    pub fn id(self) -> &'static str {
        match self {
            Source::Comment => "comment",
            Source::Feedback => "feedback",
            Source::Report => "report",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "comment" => Some(Source::Comment),
            "feedback" => Some(Source::Feedback),
            "report" => Some(Source::Report),
            _ => None,
        }
    }

    /// Whether this store holds items of `kind`.
    pub fn holds(self, kind: ParticipationKind) -> bool {
        match self {
            Source::Comment => kind == ParticipationKind::Comment,
            Source::Feedback => ParticipationKind::PASSAGE_FEEDBACK.contains(&kind),
            Source::Report => kind == ParticipationKind::AbuseReport,
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
    /// An abuse report: the reader's ground and what they wrote, if anything.
    /// It never names the reporter.
    Report {
        ground: ReasonCode,
        body: Option<String>,
    },
    /// Retention or a deletion request purged the text, details and name;
    /// only the state and the audit trail remain (ADR 0103).
    Purged,
}

/// The item an abuse report names, as the hosted service read it with the
/// report: enough for a moderator to see what was reported and for the
/// policy to decide an upholding. A feedback reader's name is never sent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReportedTarget {
    pub source: Source,
    pub id: String,
    pub kind: ParticipationKind,
    pub state: ModerationState,
    pub version: u64,
    pub revision: u32,
    /// A comment's author name, shown with it on the post.
    pub author_name: Option<String>,
    /// The text, unless it was purged.
    pub body: Option<String>,
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
    /// For an abuse report, the item it names, when that item still exists.
    pub target: Option<ReportedTarget>,
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireReport {
    #[allow(dead_code)]
    source: String,
    id: String,
    status: String,
    version: u64,
    #[serde(default)]
    moderated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    received_at: String,
    work: String,
    report: WireReportBody,
    #[serde(default)]
    target: Option<WireTarget>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireReportBody {
    ground: String,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireTarget {
    source: String,
    id: String,
    kind: String,
    status: String,
    version: u64,
    #[serde(default = "first_revision")]
    revision: u32,
    #[serde(default)]
    author_name: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

fn first_revision() -> u32 {
    1
}

/// An item whose text, details and name were purged: its facts only.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WirePurged {
    source: String,
    id: String,
    kind: String,
    status: String,
    version: u64,
    #[serde(default = "first_revision")]
    revision: u32,
    #[serde(default)]
    moderated_at: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    received_at: String,
    work: String,
    purged_at: String,
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
        if value.get("purgedAt").is_some_and(|at| !at.is_null()) {
            return Self::read_purged(value);
        }
        match value["source"].as_str().and_then(Source::from_id) {
            Some(Source::Comment) => Self::read_comment(value),
            Some(Source::Feedback) => Self::read_feedback(value),
            Some(Source::Report) => Self::read_report(value),
            None => Err("an inbox item needs a known `source`".into()),
        }
    }

    fn read_state(
        source: Source,
        status: &str,
        version: u64,
    ) -> Result<ModerationState, &'static str> {
        let state = ModerationState::from_id(status)
            .filter(|state| {
                // Comments and reports carry no clarification consent and no
                // receipt.
                source == Source::Feedback
                    || !matches!(
                        state,
                        ModerationState::Clarification | ModerationState::Withdrawn
                    )
            })
            .ok_or("a hosted item has a state its store cannot hold")?;
        if version == 0 || version > i32::MAX as u64 {
            return Err("a hosted item needs a positive `version`");
        }
        Ok(state)
    }

    fn read_reason(reason: Option<String>) -> Result<Option<ReasonCode>, &'static str> {
        reason
            .map(|reason| ReasonCode::from_id(&reason).ok_or("a hosted item has an unknown reason"))
            .transpose()
    }

    fn read_moderated_at(value: Option<String>) -> Result<Option<DateTime>, &'static str> {
        value
            .map(|time| canonical_time(&time).ok_or("`moderatedAt` must be a UTC time"))
            .transpose()
    }

    fn read_purged(value: &Value) -> Result<Self, String> {
        let wire: WirePurged = serde_json::from_value(value.clone())
            .map_err(|_| "a purged item has an unknown or mistyped field".to_string())?;
        let source = Source::from_id(&wire.source).ok_or("a purged item needs a known `source`")?;
        let kind = ParticipationKind::from_id(&wire.kind)
            .filter(|kind| source.holds(*kind))
            .ok_or("a purged item has a kind its store cannot hold")?;
        if !is_uuid(&wire.id) {
            return Err("a purged item needs a UUID `id`".into());
        }
        let state = Self::read_state(source, &wire.status, wire.version)?;
        if state == ModerationState::Approved && kind.rules().publishable {
            return Err("a purged item cannot be approved for publication".into());
        }
        if !is_site_path(&wire.work) || wire.revision == 0 {
            return Err("a purged item needs a post path and a revision".into());
        }
        let received_at =
            canonical_time(&wire.received_at).ok_or("a purged item needs a UTC `receivedAt`")?;
        canonical_time(&wire.purged_at).ok_or("a purged item needs a UTC `purgedAt`")?;
        Ok(Self {
            source,
            id: wire.id,
            kind,
            state,
            version: wire.version,
            revision: wire.revision,
            approved_revision: None,
            clarification_asked: None,
            clarification_consent: false,
            reason: Self::read_reason(wire.reason)?,
            moderated_at: Self::read_moderated_at(wire.moderated_at)?,
            received_at,
            work: wire.work,
            content: Content::Purged,
            target: None,
        })
    }

    fn read_report(value: &Value) -> Result<Self, String> {
        let wire: WireReport = serde_json::from_value(value.clone())
            .map_err(|_| "a hosted abuse report has an unknown or mistyped field".to_string())?;
        if !is_uuid(&wire.id) {
            return Err("a hosted abuse report needs a UUID `id`".into());
        }
        let state = Self::read_state(Source::Report, &wire.status, wire.version)?;
        if !is_site_path(&wire.work) {
            return Err("a hosted abuse report needs a post path".into());
        }
        let ground = ReasonCode::from_id(&wire.report.ground)
            .filter(|ground| report_grounds().contains(ground))
            .ok_or("a hosted abuse report needs one of the report grounds")?;
        let body = wire
            .report
            .body
            .map(|body| {
                comment_text_ok(&body, MAX_REPORT_CHARS, true)
                    .then_some(body)
                    .ok_or("a hosted abuse report's text must be at most 1,000 characters")
            })
            .transpose()?;
        let received_at = canonical_time(&wire.received_at)
            .ok_or("a hosted abuse report needs a UTC `receivedAt`")?;
        let target = wire.target.map(Self::read_target).transpose()?;
        Ok(Self {
            source: Source::Report,
            id: wire.id,
            kind: ParticipationKind::AbuseReport,
            state,
            version: wire.version,
            revision: 1,
            approved_revision: None,
            clarification_asked: None,
            clarification_consent: false,
            reason: Self::read_reason(wire.reason)?,
            moderated_at: Self::read_moderated_at(wire.moderated_at)?,
            received_at,
            work: wire.work,
            content: Content::Report { ground, body },
            target,
        })
    }

    fn read_target(wire: WireTarget) -> Result<ReportedTarget, String> {
        let source = Source::from_id(&wire.source)
            .filter(|source| *source != Source::Report)
            .ok_or("a reported item must be a comment or passage feedback")?;
        let kind = ParticipationKind::from_id(&wire.kind)
            .filter(|kind| source.holds(*kind))
            .ok_or("a reported item has a kind its store cannot hold")?;
        if !is_uuid(&wire.id) || wire.revision == 0 {
            return Err("a reported item needs a UUID `id` and a revision".into());
        }
        let state = Self::read_state(source, &wire.status, wire.version)?;
        let author_name = wire
            .author_name
            .filter(|_| source == Source::Comment)
            .map(|name| {
                comment_text_ok(&name, MAX_NAME_CHARS, false)
                    .then_some(name)
                    .ok_or("a reported comment needs a plain author name")
            })
            .transpose()?;
        let body = wire
            .body
            .map(|body| {
                comment_text_ok(&body, MAX_TARGET_CHARS, true)
                    .then_some(body)
                    .ok_or("a reported item's text is not plain text")
            })
            .transpose()?;
        Ok(ReportedTarget {
            source,
            id: wire.id,
            kind,
            state,
            version: wire.version,
            revision: wire.revision,
            author_name,
            body,
        })
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
            target: None,
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
            target: None,
        })
    }

    /// The facts the policy decides on.
    pub fn facts(&self) -> ItemFacts<'_> {
        ItemFacts {
            id: &self.id,
            kind: self.kind,
            work: Some(&self.work),
            parent: self.target.as_ref().map(|target| target.id.as_str()),
            state: self.state,
            version: self.version,
            revision: self.revision,
            approved_revision: self.approved_revision,
            clarification_asked: self.clarification_asked,
            clarification_consent: self.clarification_consent,
            content_retained: !matches!(self.content, Content::Purged),
            state_since: self.moderated_at.unwrap_or(self.received_at),
        }
    }

    /// The facts of the item an abuse report names, on the report's work.
    pub fn target_facts(&self) -> Option<ItemFacts<'_>> {
        let target = self.target.as_ref()?;
        Some(ItemFacts {
            id: &target.id,
            kind: target.kind,
            work: Some(&self.work),
            parent: None,
            state: target.state,
            version: target.version,
            revision: target.revision,
            approved_revision: (target.state == ModerationState::Approved)
                .then_some(target.revision),
            clarification_asked: None,
            clarification_consent: false,
            content_retained: target.body.is_some(),
            state_since: self.received_at,
        })
    }

    /// The feedback record, for a feedback item.
    pub fn feedback(&self) -> Option<&HostedFeedback> {
        match &self.content {
            Content::Feedback(hosted) => Some(hosted),
            _ => None,
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
        // Upholding a report is decided with the item it names, as the
        // hosted service read it with the report (ADR 0103).
        let target = item.target_facts();
        let reported_item = if action == ModerationAction::UpholdReport {
            target.as_ref()
        } else {
            None
        };
        let decision = self.policy.decide(
            &item.facts(),
            &Request {
                actor: self.actor(item),
                action,
                expected_version,
                reason,
                at: self.now,
                reported_item,
            },
        )?;
        let offered = INBOX_ACTIONS.contains(&action)
            || (action == ModerationAction::UpholdReport && item.source == Source::Report);
        if !offered || !self.protocol.supports(item.kind, action) {
            return Err(PolicyError::NotAllowed);
        }
        Ok(decision)
    }

    /// The decisions this viewer can take on the item now, each checked by
    /// the policy with a reason it accepts: the inbox actions, and for an
    /// abuse report, upholding it.
    pub fn actions(&self, item: &InboxItem) -> Vec<ModerationAction> {
        INBOX_ACTIONS
            .into_iter()
            .chain((item.source == Source::Report).then_some(ModerationAction::UpholdReport))
            .filter(|action| {
                let reason = allowed_reasons(*action, item.kind).first().copied();
                self.decide(item, *action, item.version, reason).is_ok()
            })
            .collect()
    }

    /// A deletion request taken by this viewer (ADR 0130): only the site
    /// Admin, only on a closed item or an upheld report, and only where the
    /// hosted service can purge ([`Protocol::Protected`]).
    pub fn erase(&self, item: &InboxItem, expected_version: u64) -> Result<Erasure, PolicyError> {
        let erasure =
            self.policy
                .erase(&item.facts(), &self.actor(item), expected_version, self.now)?;
        if self.protocol != Protocol::Protected {
            return Err(PolicyError::NotAllowed);
        }
        Ok(erasure)
    }

    /// The step retention owes the item now, if any (ADR 0103).
    pub fn retention_due(&self, item: &InboxItem) -> Option<RetentionStep> {
        self.policy.retention_due(&item.facts(), self.now)
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
        // A purged item has no content left to show; a viewer who would have
        // seen it still sees its facts, so a decision stays explainable.
        let scope = ItemFacts {
            content_retained: true,
            ..facts
        };
        if !may_view(&actor, &scope, mode, View::Content) {
            return None;
        }
        let private_identity = may_view(&actor, &facts, mode, View::PrivateIdentity);
        let post = post_for_work(self.site, &item.work);
        let mut actions: Vec<Value> = self
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
        if self.erase(item, item.version).is_ok() {
            actions.push(json!({
                "action": ERASE_ACTION,
                "label": "Delete its text and name",
                "reasons": [],
                "guidance": "For a reader who asked you to delete what they sent: deletes its text, details and any name now. The decision stays as it is, and only the private record of decisions remains. This cannot be undone.",
                "confirm": "I understand that the text and name are deleted for good.",
            }));
        }
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
            Content::Purged => {
                view["body"] = Value::Null;
                view["details"] = json!({});
                view["purged"] = json!(true);
                view["reader"] = json!({ "publishName": false });
            }
            Content::Report { ground, body } => {
                view["body"] = json!(body);
                view["details"] = json!({});
                view["reader"] = json!({ "publishName": false });
                view["report"] = json!({ "ground": ground.id(), "groundLabel": ground.label() });
                view["target"] = match &item.target {
                    Some(target) => json!({
                        "source": target.source.id(),
                        "id": target.id,
                        "kind": target.kind.id(),
                        "kindLabel": target.kind.label(),
                        "status": target.state.id(),
                        "statusLabel": target.state.label(),
                        "authorName": target.author_name,
                        "body": target.body,
                    }),
                    None => Value::Null,
                };
            }
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
        ModerationAction::Reject if item.kind == ParticipationKind::AbuseReport => {
            format!("Dismisses the report; the reported item is not changed. {retention}")
        }
        ModerationAction::Reject => format!("Never shown. {retention}"),
        ModerationAction::Remove => format!("Takes it off the post. {retention}"),
        ModerationAction::RequestClarification => {
            "Asks the reader, through their private receipt, to revise it; nothing is e-mailed. The text you asked about can never be approved, only the reader’s answer can.".into()
        }
        ModerationAction::Reopen => {
            "Returns it to pending for a fresh decision, or to waiting for clarification if the reader was asked about this text and has not answered.".into()
        }
        ModerationAction::UpholdReport => {
            let target = match item.target.as_ref().map(|target| target.state) {
                Some(ModerationState::Approved) => {
                    "Takes the reported item off its post in the same decision, with this reason."
                }
                Some(_) => "The reported item is already out of public view, so only the report changes.",
                None => "The reported item no longer exists, so only the report changes.",
            };
            format!("{target} The report itself is never published. {retention}")
        }
        _ => String::new(),
    }
}

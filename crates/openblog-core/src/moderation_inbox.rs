//! The one participation moderation inbox (ADR 0105).
//!
//! Hosted comments, passage feedback and abuse reports (ADR 0107), and every
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

use crate::correction_decision::{
    decide as decide_correction, decision_in_force, passage_check_id, standing, CorrectionDecision,
    DecisionContent, DecisionError, DecisionFacts, DecisionLog, DecisionOutcome, DecisionRequest,
    DeclineReason, Extent,
};
use crate::date::DateTime;
use crate::evidence_submission::{evidence_review, is_evidence_kind};
use crate::feedback_moderation::{feedback_review, post_for_work};
use crate::feedback_moderation::{review_passage, PassageCheck};
use crate::invitation::Identities;
use crate::model::Site;
use crate::moderation::{
    allowed_reasons, is_public, may_decide, may_view, Actor, ActorRole, Decision, Erasure,
    ItemFacts, ModerationAction, ModerationPolicy, ModerationState, PolicyError, Principal,
    ReasonCode, Request, RetentionStep, SharedWorks, View,
};
use crate::participation::{effective_mode, ParticipationKind, ParticipationMode};
use crate::passage_target::PassageDocument;
use crate::scholarly_feedback::{is_uuid, HostedFeedback};
use crate::third_perspective::{
    ApprovalBinding, ApprovalRequest, HostedPerspective, LifecycleError, PublishedWork,
    TargetStatus,
};

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
/// The longest abuse report a reader may write (ADR 0107).
pub const MAX_REPORT_CHARS: usize = 1_000;

/// The grounds a reader may give for an abuse report: the reasons a
/// moderator may uphold one for (ADR 0102), never a verdict on facts.
pub fn report_grounds() -> &'static [ReasonCode] {
    allowed_reasons(
        ModerationAction::UpholdReport,
        ParticipationKind::AbuseReport,
    )
}

/// The action id a site Admin sends to delete an item's text and name on a
/// reader's request ([`ModerationPolicy::erase`]).
pub const ERASE_ACTION: &str = "erase";

/// The inbox's action for the author's correction decision (ADR 0117). It is
/// not a moderation action: it never changes the item's state, version or
/// approval, and it is offered beside them, never instead of them.
pub const RECORD_DECISION: &str = "Record decision";

/// What the hosted service can store for moderation (ADR 0106).
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
    /// `OPENBLOG_PROTECTION_ENABLED` set (ADR 0108): everything [`Full`]
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
    /// `openblog_abuse_reports` (ADR 0107).
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
            Source::Feedback => {
                ParticipationKind::PASSAGE_FEEDBACK.contains(&kind)
                    || kind == ParticipationKind::ThirdPerspective
            }
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
    /// A Third Perspective with its consent records (ADRs 0110, 0113).
    Perspective(Box<HostedPerspective>),
    /// An abuse report: the reader's ground and what they wrote, if anything.
    /// It never names the reporter.
    Report {
        ground: ReasonCode,
        body: Option<String>,
    },
    /// Retention or a deletion request purged the text, details and name;
    /// only the state and the audit trail remain (ADR 0104).
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
        if wire["feedback"]["kind"] == ParticipationKind::ThirdPerspective.id() {
            return Self::read_perspective(&wire);
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

    fn read_perspective(wire: &Value) -> Result<Self, String> {
        let hosted = HostedPerspective::from_value(wire).map_err(|error| error.to_string())?;
        if !is_site_path(&hosted.copy.provenance.work) {
            return Err("a hosted Third Perspective needs a post path".into());
        }
        Ok(Self {
            source: Source::Feedback,
            id: hosted.id.clone(),
            kind: ParticipationKind::ThirdPerspective,
            state: hosted.state,
            version: hosted.version,
            revision: hosted.copy.revision,
            approved_revision: hosted.approved_revision,
            clarification_asked: hosted.clarification_asked,
            clarification_consent: hosted.clarification_consent,
            reason: hosted.reason,
            moderated_at: hosted.moderated_at,
            received_at: hosted.copy.provenance.received_at,
            work: hosted.copy.provenance.work.clone(),
            content: Content::Perspective(Box::new(hosted)),
            target: None,
        })
    }

    /// The Third Perspective, for an item of that kind.
    pub fn perspective(&self) -> Option<&HostedPerspective> {
        match &self.content {
            Content::Perspective(hosted) => Some(hosted),
            _ => None,
        }
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
    /// Whether the hosted service stores the consent record a Third
    /// Perspective's approval covers (ADR 0113), so it can approve one.
    pub third_perspectives: bool,
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
        third_perspectives: value["thirdPerspectives"] == true,
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
    /// [`HostedPage::third_perspectives`] of the page the items came from.
    pub third_perspectives: bool,
    pub now: DateTime,
}

impl<'a> Inbox<'a> {
    /// The viewer's actor on this item's work (ADR 0103): never from the
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
        // hosted service read it with the report (ADR 0104).
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
        // A Third Perspective is approved only where the hosted service records
        // the consent the approval covers, and only as its own check allows,
        // at the text and consent it holds now.
        if let (Some(hosted), ModerationAction::Approve) = (item.perspective(), action) {
            let consent = hosted.copy.consent().number;
            if !self.third_perspectives
                || self
                    .check_perspective_approval(item, MODERATOR_PREVIEW, item.revision, consent)
                    .is_err()
            {
                return Err(PolicyError::NotAllowed);
            }
        }
        Ok(decision)
    }

    /// `SubmittedCopy::check_approval` for a Third Perspective: the text
    /// revision and consent record the moderator saw must still be the ones
    /// in effect, and the reader must still agree to publish. Check it after
    /// [`Inbox::decide`] and send the binding with the approval.
    pub fn check_perspective_approval(
        &self,
        item: &InboxItem,
        moderator: &str,
        seen_revision: u32,
        seen_consent: u32,
    ) -> Result<ApprovalBinding, LifecycleError> {
        let hosted = item.perspective().ok_or(LifecycleError::OutOfStep)?;
        hosted.copy.check_approval(
            &hosted.facts(&item.facts()),
            &ApprovalRequest {
                moderator,
                seen_revision,
                seen_consent,
                at: self.now,
            },
        )
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

    /// A deletion request taken by this viewer (ADR 0107): only the site
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

    /// Whether this viewer may record the author's correction decision on
    /// the item now (ADR 0117): a suggested source or correction whose text
    /// is kept, pending or approved and not the text a clarification asked
    /// about, stored where the hosted service keeps decisions, and a viewer
    /// the policy lets decide on its work (the site Admin or a coordinator,
    /// as for approval). A decision never waits on moderation, and showing
    /// the reader's note stays moderation's decision.
    pub fn may_record_decision(&self, item: &InboxItem) -> bool {
        let facts = item.facts();
        item.feedback()
            .is_some_and(|hosted| hosted.decisions.is_some())
            && is_evidence_kind(item.kind)
            && matches!(
                item.state,
                ModerationState::Pending | ModerationState::Approved
            )
            && !facts.current_revision_asked()
            && may_decide(&self.actor(item), &facts)
    }

    /// The post with the item's address now, its passage check and passage
    /// revision, for a feedback item: what a correction decision records
    /// about the passage the author read.
    pub fn passage_now(&self, item: &InboxItem) -> Option<PassageNow> {
        let hosted = item.feedback()?;
        let post = post_for_work(self.site, &item.work);
        let document = post.map(|post| PassageDocument::of_post(post, &self.site.config));
        let review = review_passage(&hosted.feedback, post.zip(document.as_ref()));
        Some(PassageNow {
            post: post.map(|post| post.source.replace('\\', "/")),
            check: review.check,
            revision: review.revision_now,
        })
    }

    /// Record the author's correction decision on a feedback item (ADR 0117),
    /// decided by the one policy with this viewer's actor on the item's work:
    /// the grant first, so a viewer who may not decide learns nothing. The
    /// item's decision log is the one the hosted service returned with it;
    /// `addressed` is the log and current text revision of the item
    /// `addressedBy` names, when it names one. Nothing is changed here: the
    /// caller stores the decision, appended to the log, with its audit event.
    pub fn record_decision(
        &self,
        item: &InboxItem,
        request: DecisionDraft<'_>,
        addressed: Option<(&DecisionLog, u32)>,
    ) -> Result<CorrectionDecision, DecisionError> {
        let empty = DecisionLog::new(&item.id);
        let log = item
            .feedback()
            .and_then(|hosted| hosted.decisions.as_ref())
            .unwrap_or(&empty);
        let passage = self.passage_now(item);
        let received = item.received_at.ymd();
        let facts = DecisionFacts {
            item: item.facts(),
            received: &received,
            post: passage.as_ref().and_then(|passage| passage.post.as_deref()),
            check: passage
                .as_ref()
                .map_or(PassageCheck::UnknownWork, |passage| passage.check),
            passage_revision: passage
                .as_ref()
                .and_then(|passage| passage.revision.as_deref()),
        };
        decide_correction(
            &facts,
            log,
            addressed,
            &DecisionRequest {
                actor: self.actor(item),
                expected_decisions: request.expected_decisions,
                content: request.content,
                confirmed_check: request.confirmed_check,
                decided: request.decided,
            },
        )
    }

    /// The step retention owes the item now, if any (ADR 0104).
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
        let record_decision = self.may_record_decision(item).then(|| {
            let decisions = item
                .feedback()
                .and_then(|hosted| hosted.decisions.as_ref())
                .map_or(0, DecisionLog::len);
            let passage = self.passage_now(item);
            let mut offer = json!({
                "label": RECORD_DECISION,
                "guidance": "Records what you concluded about your work: a correction, a clarification, the source added as evidence, declined with your reason, or already addressed. It never edits the post, a citation or the Source Library, and it does not publish the reader’s note.",
                "expectedDecisions": decisions,
                "itemRevision": item.revision,
                "outcomes": DecisionOutcome::ALL.iter().map(|outcome| json!({
                    "id": outcome.id(),
                    "label": outcome_choice(*outcome),
                    "guidance": outcome_guidance(*outcome),
                    "accepted": outcome.is_accepted(),
                })).collect::<Vec<_>>(),
                "extents": Extent::ALL.iter().map(|extent| json!({
                    "id": extent.id(),
                    "label": match extent { Extent::Full => "All of it", Extent::Partial => "Part of it (say which in your rationale)" },
                })).collect::<Vec<_>>(),
                "declineReasons": DeclineReason::ALL.iter().map(|reason| json!({"id": reason.id(), "label": reason.label()})).collect::<Vec<_>>(),
                "post": passage.as_ref().and_then(|passage| passage.post.clone()),
            });
            if let Some(check) = passage
                .as_ref()
                .map(|passage| passage.check)
                .filter(|check| *check != PassageCheck::Current)
            {
                offer["confirmCheck"] = json!(passage_check_id(check));
            }
            offer
        });
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
        if let Some(record_decision) = record_decision {
            view["recordDecision"] = record_decision;
        }
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
            Content::Perspective(hosted) => {
                let copy = &hosted.copy;
                view["body"] = json!(copy.body);
                view["details"] = match copy.category {
                    Some(category) => json!({
                        "category": category.id(),
                        "categoryLabel": category.label(),
                        "prompt": category.prompt(),
                    }),
                    None => json!({}),
                };
                view["published"] = Value::Null;
                let consent = copy.consent();
                let attribution = &consent.attribution;
                let mut reader = json!({ "publishName": attribution.publish_name });
                match &attribution.name {
                    Some(name) if private_identity || attribution.publish_name => {
                        reader["name"] = json!(name);
                    }
                    Some(_) => reader["private"] = json!(true),
                    None => {}
                }
                view["reader"] = reader;
                let work = post.map(|post| PublishedWork::of_post(post, &self.site.config));
                let target = post.map(|post| {
                    let document =
                        crate::passage_target::PassageDocument::of_post(post, &self.site.config);
                    TargetStatus::from(
                        &document.resolve(&copy.provenance.target, Some(&copy.provenance.revision)),
                    )
                });
                let section = copy.provenance.target.section.clone();
                let about_work = matches!(
                    copy.provenance.target.selector,
                    crate::passage_target::PassageSelector::Work
                );
                view["perspective"] = json!({
                    "about": if about_work { "work" } else { "section" },
                    "section": section,
                    "check": match &target {
                        _ if about_work => "current",
                        Some(TargetStatus::Current { .. }) => "current",
                        Some(TargetStatus::Stale { .. }) => "stale",
                        None => "unknown-work",
                    },
                    "revision": copy.revision,
                    "revisionSeen": copy.provenance.revision,
                    "revisionNow": work.as_ref().map(|work| work.revision.clone()),
                    "consent": {
                        "number": consent.number,
                        "publish": consent.publish,
                        "showName": attribution.publish_name,
                        "clarification": consent.clarification,
                        "feature": consent.feature_revision.is_some(),
                    },
                    "approvedConsent": hosted.approved_consent,
                    "channel": if copy.can_clarify() { "hosted" } else { "manual" },
                });
                // Whether the reader's name matches a credited name says
                // something about that name, so it goes only to a viewer who
                // may see the name itself; with one credit it would reveal it.
                if private_identity || attribution.publish_name {
                    view["perspective"]["nameMatchesCredit"] = json!(work
                        .as_ref()
                        .is_some_and(|work| copy.name_matches_credit(&work.credited)));
                }
                // How it would read on the canonical page once approved now.
                view["publicPreview"] = Value::Null;
                view["perspectivePreview"] = match (&work, &target) {
                    (Some(work), Some(target)) => {
                        let approved = crate::third_perspective::ModerationFacts {
                            state: ModerationState::Approved,
                            revision: copy.revision,
                            approved_revision: Some(copy.revision),
                            approved_consent: Some(consent.number),
                            clarification_asked: None,
                            content_retained: true,
                        };
                        copy.approved_response(&approved, ParticipationMode::Open, work, target)
                            .map_or(Value::Null, |response| {
                                json!({
                                    "heading": response.heading(),
                                    "name": response.name,
                                    "about": response.about,
                                    "section": response.section,
                                    "stale": response.stale,
                                    "received": response.received,
                                })
                            })
                    }
                    _ => Value::Null,
                };
            }
            Content::Feedback(hosted) => {
                let feedback = &hosted.feedback;
                // How the item stands (ADR 0117): the reader's intent until
                // the author decides, never a correction before then.
                let empty = DecisionLog::new(&item.id);
                let log = hosted.decisions.as_ref().unwrap_or(&empty);
                let stands = standing(feedback.kind, hosted.evidence.as_ref(), log, item.revision);
                view["standing"] = json!({
                    "id": stands.id(),
                    "label": stands.label(),
                    "decided": stands.is_decided(),
                    "correction": stands.is_correction(),
                });
                if let Some(offer) = &hosted.evidence {
                    view["evidence"] = evidence_review(offer, post, self.site);
                }
                if hosted.decisions.is_some() {
                    view["decisions"] = decisions_view(log, item.revision);
                }
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

/// What the hosted service and the site say about a feedback item's passage
/// now, for a correction decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PassageNow {
    /// The source path of the post that has the item's address now.
    pub post: Option<String>,
    pub check: PassageCheck,
    /// That post's passage revision now.
    pub revision: Option<String>,
}

/// What an author sends to record a decision; who is deciding comes from the
/// session, never from here.
#[derive(Clone, Debug)]
pub struct DecisionDraft<'a> {
    /// How many decisions on the item the author saw.
    pub expected_decisions: u32,
    pub content: DecisionContent,
    /// The passage check the author read, when the passage is not current.
    pub confirmed_check: Option<PassageCheck>,
    /// `YYYY-MM-DD`, the author's local day.
    pub decided: &'a str,
}

/// How each outcome reads where the author chooses it.
fn outcome_choice(outcome: DecisionOutcome) -> &'static str {
    match outcome {
        DecisionOutcome::AcceptedAsCorrection => "Accept as a correction",
        DecisionOutcome::AcceptedAsClarification => "Accept as a clarification",
        DecisionOutcome::AcceptedAsEvidence => "Add the source as evidence",
        DecisionOutcome::Declined => "Decline",
        DecisionOutcome::AlreadyAddressed => "Already addressed",
    }
}

/// What each outcome means and needs, as the decision form says it.
fn outcome_guidance(outcome: DecisionOutcome) -> &'static str {
    match outcome {
        DecisionOutcome::AcceptedAsCorrection => "The post was in error and you changed it. Needs the post’s revision note saying what changed. Only this outcome labels the note a correction.",
        DecisionOutcome::AcceptedAsClarification => "Not an error, but unclear or incomplete; you reworded it or added context. Needs the post’s revision note.",
        DecisionOutcome::AcceptedAsEvidence => "You recorded the reader’s source as evidence on a claim in Evidence Studio, without changing the claim’s words. Needs the revision note and that evidence link.",
        DecisionOutcome::Declined => "You considered it and made no change. Needs your reason and rationale; no reason says the reader is wrong.",
        DecisionOutcome::AlreadyAddressed => "The post already reflected it. Needs the revision note that addressed it, or another reader’s item you accepted.",
    }
}

/// An item's decision log for its editors, oldest first, each with whether
/// it is in force (a decision about text a clarification has since replaced
/// is kept but not in force). Who decided is the private record's; it is
/// shown to moderators only.
pub fn decisions_view(log: &DecisionLog, item_revision: u32) -> Value {
    let in_force = decision_in_force(log, item_revision).map(|decision| decision.sequence);
    Value::Array(
        log.history()
            .iter()
            .map(|decision| {
                let mut value = decision.to_value();
                value["label"] = json!(decision.content.outcome.label());
                if let Some(reason) = decision.content.decline_reason {
                    value["declineReasonLabel"] = json!(reason.label());
                }
                value["inForce"] = json!(in_force == Some(decision.sequence));
                value
            })
            .collect(),
    )
}

/// Possible duplicates on one page of the inbox: for each feedback item, the
/// other items about the same post that point at the same passage, name the
/// same claim, evidence link, cited or offered source, or link the same
/// source. A cue for the editor to read them together, never a count, a
/// ranking or a reason to decide anything: two readers sending the same
/// suggestion are two items with two decisions (ADR 0117).
pub fn similar_items(items: &[&InboxItem]) -> std::collections::BTreeMap<String, Vec<Value>> {
    let keys = |item: &InboxItem| -> Vec<String> {
        let Some(hosted) = item.feedback() else {
            return Vec::new();
        };
        let mut keys = vec![format!(
            "target:{}",
            hosted.feedback.provenance.target.to_value()
        )];
        if let Some(url) = &hosted.feedback.details.source_url {
            keys.push(format!("url:{url}"));
        }
        if let Some(offer) = &hosted.evidence {
            for (what, id) in [
                ("claim", &offer.claim),
                ("link", &offer.evidence_link),
                ("source", &offer.citation),
                ("source", &offer.source),
            ] {
                if let Some(id) = id {
                    keys.push(format!("{what}:{id}"));
                }
            }
        }
        keys
    };
    let reason = |key: &str| match key.split(':').next() {
        Some("target") => "the same passage",
        Some("url") => "the same source link",
        Some("claim") => "the same claim",
        Some("link") => "the same evidence link",
        _ => "the same source",
    };
    let mut cues = std::collections::BTreeMap::new();
    for item in items {
        let mine = keys(item);
        let mut similar = Vec::new();
        for other in items {
            if other.id == item.id || other.work != item.work {
                continue;
            }
            let theirs = keys(other);
            if let Some(shared) = mine.iter().find(|key| theirs.contains(key)) {
                similar.push(json!({
                    "id": other.id,
                    "source": other.source.id(),
                    "kindLabel": other.kind.label(),
                    "receivedAt": other.received_at.rfc3339(),
                    "reason": reason(shared),
                }));
            }
        }
        if !similar.is_empty() {
            cues.insert(item.id.clone(), similar);
        }
    }
    cues
}
/// The moderator a listing's approval check names: the check needs one, and
/// only a decision's own check names the account that decides.
const MODERATOR_PREVIEW: &str = "inbox";

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
        ModerationAction::Approve if item.kind == ParticipationKind::ThirdPerspective => {
            "Approves exactly this text under the consent the reader gives now, to be shown on the post as a reader’s reflection, never as yours. It does not mean you agree. If the reader later hides their name or withdraws it, the page follows their choice.".into()
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

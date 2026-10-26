//! Third Perspectives: a reader's own reflection on a published work
//! (ADRs 0106 to 0109).
//!
//! A Third Perspective is another reading of a shared reflection or a post,
//! offered by a reader. It is never one of the authors' perspectives, never a
//! vote for one of them, and never public until the reader agreed to publish
//! it and a moderator approved exactly the text and the consent the reader
//! gave. It is one participation kind (`third-perspective`) in the one
//! participation and moderation policy (#211), not another comment system.
//!
//! Four things are kept apart, each its own type:
//!
//! - [`LocalReflection`]: the reader's private draft. It has no id, no
//!   provenance and no consent, and nothing here sends or stores it.
//! - [`SubmittedCopy`]: what the site received, with the reader's consent
//!   history and moderation provenance. Private to moderation.
//! - [`ApprovedResponse`]: the one public projection of an approved copy, for
//!   the canonical page only.
//! - [`FeaturedPublication`]: an approved response an editor features, which
//!   needs the reader's separate feature consent for that approved revision.
//!
//! The policy is pure. Callers bring the moderation facts (see
//! [`ModerationFacts`]) and the published work, and apply what a decision
//! returns in one write.
//!
//! Until B5 (passage targets, feedback provenance) and RD12 (participation
//! kinds, moderation) merge, this module carries minimal shapes of their
//! types with the same ids and JSON. ADR 0109 records how each one maps.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::date::DateTime;

/// The participation kind id, RD12's `ParticipationKind::ThirdPerspective`.
pub const KIND_ID: &str = "third-perspective";
/// The kind's label for readers and moderators.
pub const KIND_LABEL: &str = "Third Perspective";
/// The version of the submission and record formats; a reader refuses a
/// higher one.
pub const THIRD_PERSPECTIVE_VERSION: u64 = 1;
/// The version of a passage target (B5's `PASSAGE_TARGET_VERSION`).
pub const TARGET_VERSION: u64 = 1;
/// The version of the provenance object (B5's `FEEDBACK_PROVENANCE_VERSION`).
pub const PROVENANCE_VERSION: u64 = 1;
/// The longest reflection, as for comments and passage feedback.
pub const MAX_BODY_CHARS: usize = 4_000;
/// The longest name a reader may give, as for comments.
pub const MAX_READER_NAME_CHARS: usize = 80;
/// The longest site-relative path of a published work.
pub const MAX_WORK_PATH_CHARS: usize = 500;
/// The longest section anchor (B5's `MAX_ANCHOR_CHARS`).
pub const MAX_ANCHOR_CHARS: usize = 200;
/// The longest moderator id an approval records.
pub const MAX_MODERATOR_CHARS: usize = 64;
/// The most consent records one copy keeps; the last one is kept for a
/// revocation.
pub const MAX_CONSENT_RECORDS: usize = 50;
/// The largest serialized submission or record accepted, before parsing.
pub const MAX_JSON_BYTES: usize = 32 * 1024;

// ---------------------------------------------------------------------------
// Errors

/// Why a submission or record was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    TooLarge,
    Malformed,
    UnsupportedVersion,
    WrongKind,
    InvalidWork,
    InvalidRevision,
    InvalidTarget,
    /// A quotation target: a Third Perspective is about the work or a section.
    TargetNotAllowed,
    UnknownCategory,
    InvalidBody,
    InvalidTime,
    SeenAfterReceived,
    InvalidName,
    ConsentWithoutName,
    /// The reader did not agree to publish.
    PublicationConsentRequired,
    InvalidIntake,
    InvalidConsentHistory,
}

/// A refused submission or record. The message names the field and never
/// repeats what the reader wrote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThirdPerspectiveError {
    pub code: ErrorCode,
    pub message: String,
}

impl ThirdPerspectiveError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ThirdPerspectiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ThirdPerspectiveError {}

/// Why a consent change, a clarification or an approval was refused.
/// Nothing changed; messages name no text, identity or stored value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LifecycleError {
    /// Withdrawn, or publication consent already revoked.
    Closed,
    /// Retention already purged the text.
    ContentPurged,
    /// The copy and the moderation facts name different text revisions.
    OutOfStep,
    /// Approval applies only to a pending copy.
    NotPending,
    /// A clarification answers only an open clarification request.
    NotInClarification,
    /// The reader has not agreed to publish (or revoked it).
    PublicationNotConsented,
    /// The moderator saw another text revision.
    StaleRevision,
    /// The moderator saw another consent record.
    StaleConsent,
    /// A decision must name the moderator who made it.
    AnonymousModerator,
    /// Showing a name, or another name, after a moderator decided.
    WideningAfterDecision,
    /// No approved or undecided revision for feature consent to cover.
    FeatureNotAvailable,
    /// The change is the consent already in effect.
    Unchanged,
    ConsentLimit,
    InvalidTime,
    InvalidName,
    ConsentWithoutName,
    InvalidBody,
}

impl LifecycleError {
    pub fn code(self) -> &'static str {
        match self {
            LifecycleError::Closed => "closed",
            LifecycleError::ContentPurged => "contentPurged",
            LifecycleError::OutOfStep => "outOfStep",
            LifecycleError::NotPending => "notPending",
            LifecycleError::NotInClarification => "notInClarification",
            LifecycleError::PublicationNotConsented => "publicationNotConsented",
            LifecycleError::StaleRevision => "staleRevision",
            LifecycleError::StaleConsent => "staleConsent",
            LifecycleError::AnonymousModerator => "anonymousModerator",
            LifecycleError::WideningAfterDecision => "wideningAfterDecision",
            LifecycleError::FeatureNotAvailable => "featureNotAvailable",
            LifecycleError::Unchanged => "unchanged",
            LifecycleError::ConsentLimit => "consentLimit",
            LifecycleError::InvalidTime => "invalidTime",
            LifecycleError::InvalidName => "invalidName",
            LifecycleError::ConsentWithoutName => "consentWithoutName",
            LifecycleError::InvalidBody => "invalidBody",
        }
    }
}

impl std::fmt::Display for LifecycleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            LifecycleError::Closed => "this reflection was withdrawn",
            LifecycleError::ContentPurged => "this reflection's text is no longer kept",
            LifecycleError::OutOfStep => "the reflection changed; reload it and try again",
            LifecycleError::NotPending => "only a pending reflection can be approved",
            LifecycleError::NotInClarification => "no clarification was requested",
            LifecycleError::PublicationNotConsented => {
                "the reader has not agreed to publish this reflection"
            }
            LifecycleError::StaleRevision => "the reflection's text changed; review it again",
            LifecycleError::StaleConsent => {
                "the reader changed their consent; review it again"
            }
            LifecycleError::AnonymousModerator => "a moderation decision must name its moderator",
            LifecycleError::WideningAfterDecision => {
                "a name can be added or changed only before a moderator decides; withdraw and submit again"
            }
            LifecycleError::FeatureNotAvailable => {
                "there is no approved text to agree to feature"
            }
            LifecycleError::Unchanged => "this is already the consent in effect",
            LifecycleError::ConsentLimit => "this reflection's consent cannot change again",
            LifecycleError::InvalidTime => "the time is earlier than the last change",
            LifecycleError::InvalidName => "the name must be 1 to 80 characters of plain text",
            LifecycleError::ConsentWithoutName => "showing a name needs a name",
            LifecycleError::InvalidBody => {
                "the reflection must be 1 to 4000 characters of plain text"
            }
        })
    }
}

impl std::error::Error for LifecycleError {}

// ---------------------------------------------------------------------------
// Response categories

/// An optional prompt a reader may pick to frame their reflection. A category
/// describes what kind of thought it is, never how good it is or which
/// author it sides with: there is no score, rating, agreement or "correct"
/// category, and a reflection without one is complete.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ResponseCategory {
    AnotherReading,
    Connection,
    Experience,
    Question,
    Application,
}

impl ResponseCategory {
    pub const ALL: [ResponseCategory; 5] = [
        ResponseCategory::AnotherReading,
        ResponseCategory::Connection,
        ResponseCategory::Experience,
        ResponseCategory::Question,
        ResponseCategory::Application,
    ];

    pub fn id(self) -> &'static str {
        match self {
            ResponseCategory::AnotherReading => "another-reading",
            ResponseCategory::Connection => "connection",
            ResponseCategory::Experience => "experience",
            ResponseCategory::Question => "question",
            ResponseCategory::Application => "application",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|category| category.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            ResponseCategory::AnotherReading => "Another reading",
            ResponseCategory::Connection => "A connection",
            ResponseCategory::Experience => "From experience",
            ResponseCategory::Question => "A question",
            ResponseCategory::Application => "Putting it to use",
        }
    }

    /// The prompt a form shows beside the category.
    pub fn prompt(self) -> &'static str {
        match self {
            ResponseCategory::AnotherReading => "How do you read this, in your own way?",
            ResponseCategory::Connection => {
                "What does this bring to mind: another work, idea or source?"
            }
            ResponseCategory::Experience => "What in your own experience speaks to this?",
            ResponseCategory::Question => "What question does this leave you with?",
            ResponseCategory::Application => "How might you apply or try this?",
        }
    }
}

// ---------------------------------------------------------------------------
// Target (B5's passage target, restricted to the work or a section)

/// What a Third Perspective is about: the whole work, usually, or one
/// section. Written exactly as B5's passage target (ADR 0084):
/// `{"version":1,"kind":"work"}` or
/// `{"version":1,"kind":"section","section":"methods","digest":"…"}`. A
/// quotation target is refused: quoting a passage is passage feedback.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PerspectiveTarget {
    /// The whole work. It stays current while the work is published.
    Work,
    /// One section: its heading id (`None` for the text before the first
    /// heading) and, when known, the digest of its text.
    Section {
        section: Option<String>,
        digest: Option<String>,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireTarget {
    version: u64,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    section: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    suffix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start: Option<u64>,
}

fn is_digest(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn forbidden_in_line(character: char) -> bool {
    character.is_control() || crate::research_notes::bidi_override(character)
}

impl PerspectiveTarget {
    fn error(message: impl Into<String>) -> ThirdPerspectiveError {
        ThirdPerspectiveError::new(ErrorCode::InvalidTarget, message)
    }

    /// Check B5's anchor and digest rules.
    pub fn validate(&self) -> Result<(), ThirdPerspectiveError> {
        if let PerspectiveTarget::Section { section, digest } = self {
            if let Some(anchor) = section {
                let count = anchor.chars().count();
                if count == 0
                    || count > MAX_ANCHOR_CHARS
                    || anchor
                        .chars()
                        .any(|c| c.is_whitespace() || forbidden_in_line(c))
                {
                    return Err(Self::error(format!(
                        "`target.section` must be a heading id of 1 to {MAX_ANCHOR_CHARS} characters without spaces"
                    )));
                }
            }
            if digest
                .as_deref()
                .is_some_and(|digest| !is_digest(digest, 32))
            {
                return Err(Self::error(
                    "`target.digest` must be 32 lowercase hexadecimal digits",
                ));
            }
        }
        Ok(())
    }

    /// Read a target from its JSON value. Nothing is repaired.
    pub fn from_value(value: &Value) -> Result<Self, ThirdPerspectiveError> {
        let object = value
            .as_object()
            .ok_or_else(|| Self::error("`target` must be a JSON object"))?;
        match object.get("version").and_then(Value::as_u64) {
            Some(TARGET_VERSION) => {}
            Some(version) if version > TARGET_VERSION => {
                return Err(ThirdPerspectiveError::new(
                    ErrorCode::UnsupportedVersion,
                    format!("`target` is version {version}, newer than the version {TARGET_VERSION} this open.blog reads"),
                ))
            }
            _ => return Err(Self::error("`target` needs `version` 1")),
        }
        let wire: WireTarget = serde_json::from_value(value.clone()).map_err(|_| {
            Self::error(
                "`target` has a field this version does not define, or a field of the wrong type",
            )
        })?;
        let quoted = wire.exact.is_some()
            || wire.prefix.is_some()
            || wire.suffix.is_some()
            || wire.start.is_some();
        let target = match wire.kind.as_str() {
            "work" if wire.section.is_none() && wire.digest.is_none() && !quoted => {
                PerspectiveTarget::Work
            }
            "work" => {
                return Err(Self::error(
                    "a work target has no section or selector fields",
                ))
            }
            "section" if !quoted => PerspectiveTarget::Section {
                section: wire.section,
                digest: wire.digest,
            },
            "section" => return Err(Self::error("a section target has no quotation fields")),
            "quote" => {
                return Err(ThirdPerspectiveError::new(
                    ErrorCode::TargetNotAllowed,
                    "a Third Perspective is about the whole work or a section, not a quotation",
                ))
            }
            _ => return Err(Self::error("`target.kind` must be `work` or `section`")),
        };
        target.validate()?;
        Ok(target)
    }

    fn wire(&self) -> WireTarget {
        let (kind, section, digest) = match self {
            PerspectiveTarget::Work => ("work", None, None),
            PerspectiveTarget::Section { section, digest } => {
                ("section", section.clone(), digest.clone())
            }
        };
        WireTarget {
            version: TARGET_VERSION,
            kind: kind.into(),
            section,
            digest,
            exact: None,
            prefix: None,
            suffix: None,
            start: None,
        }
    }

    /// The JSON value.
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self.wire()).expect("a target always serializes")
    }

    /// Canonical JSON text, in B5's fixed field order.
    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.wire()).expect("a target always serializes")
    }
}

/// Where a target stands in the work as published now, from resolving it
/// (after B5 merges, `PassageDocument::resolve` from the revision the reader
/// saw). A work target is always current.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetStatus {
    /// The section is there with the text the reader saw (perhaps moved or
    /// renamed): its heading id now.
    Current { section: Option<String> },
    /// The section the reader wrote about is gone or has changed.
    Stale {
        /// Whether a section with the old heading id still exists.
        section_present: bool,
    },
}

// ---------------------------------------------------------------------------
// Reader identity and provenance (B5's shapes)

/// The reader's choice about their name, exactly B5's `ReaderAttribution`
/// (`{"name":"Ada","publishName":false}`). Anonymous unless the reader
/// explicitly agrees to show the name.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReaderAttribution {
    /// The name the reader gave, if any. Moderators see it; the public sees
    /// it only with `publish_name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The reader's explicit agreement to show `name`.
    #[serde(default)]
    pub publish_name: bool,
}

impl ReaderAttribution {
    pub fn anonymous() -> Self {
        Self::default()
    }

    pub fn named(name: &str, publish_name: bool) -> Self {
        Self {
            name: Some(name.to_string()),
            publish_name,
        }
    }

    /// The name the public may see: only one the reader agreed to show.
    pub fn public_name(&self) -> Option<&str> {
        self.name.as_deref().filter(|_| self.publish_name)
    }

    /// Whitespace collapsed, an empty name dropped.
    fn normalized(self) -> Self {
        Self {
            name: self
                .name
                .map(|name| collapse_whitespace(&name))
                .filter(|name| !name.is_empty()),
            publish_name: self.publish_name,
        }
    }

    fn check(&self) -> Result<(), ErrorCode> {
        match &self.name {
            Some(name) => {
                let count = name.chars().count();
                if count == 0
                    || count > MAX_READER_NAME_CHARS
                    || name.chars().any(forbidden_in_line)
                    || collapse_whitespace(name) != *name
                {
                    Err(ErrorCode::InvalidName)
                } else {
                    Ok(())
                }
            }
            None if self.publish_name => Err(ErrorCode::ConsentWithoutName),
            None => Ok(()),
        }
    }

    fn validate(&self, field: &str) -> Result<(), ThirdPerspectiveError> {
        self.check().map_err(|code| match code {
            ErrorCode::ConsentWithoutName => ThirdPerspectiveError::new(
                code,
                format!("`{field}.publishName` needs a name to publish"),
            ),
            _ => ThirdPerspectiveError::new(
                code,
                format!(
                    "`{field}.name` must be 1 to {MAX_READER_NAME_CHARS} characters of plain text"
                ),
            ),
        })
    }
}

/// How a copy reached the site (B5's `FeedbackChannel`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Channel {
    /// The optional hosted submission endpoint, which stamps the time.
    Hosted,
    /// Entered by an Admin user from a reader's message (the copy fallback).
    Manual,
}

/// Which text the reader saw, when, and how it arrived: B5's feedback
/// provenance (ADR 0086), with the target restricted to the work or a
/// section. Its JSON is B5's record, byte for byte.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Provenance {
    /// The published work's site-relative path, such as `/posts/tides/`.
    pub work: String,
    /// The passage revision (`p1:` and 32 hex digits) of the page the
    /// reader saw.
    pub revision: String,
    pub target: PerspectiveTarget,
    /// The reader's own clock; optional, untrusted, never after `received_at`.
    pub seen_at: Option<DateTime>,
    /// Stamped by the receiver, never taken from the reader.
    pub received_at: DateTime,
    pub channel: Channel,
    /// The name and choice the reader gave when submitting. Later changes
    /// are consent records; this stays what was received.
    pub attribution: ReaderAttribution,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireProvenance<T = Value> {
    version: u64,
    work: String,
    revision: String,
    target: T,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    seen_at: Option<String>,
    received_at: String,
    channel: Channel,
    #[serde(default)]
    attribution: ReaderAttribution,
}

/// A site-relative path to a published page (B5's `is_work_path`).
pub fn is_work_path(path: &str) -> bool {
    let count = path.chars().count();
    (2..=MAX_WORK_PATH_CHARS).contains(&count)
        && path.starts_with('/')
        && path.ends_with('/')
        && !path.contains("//")
        && !path
            .chars()
            .any(|c| matches!(c, '\\' | '?' | '#') || c.is_control() || c.is_whitespace())
        && !path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
}

/// A passage revision of any text model (B5's `is_passage_revision`).
pub fn is_passage_revision(value: &str) -> bool {
    let Some((model, digest)) = value.split_once(':') else {
        return false;
    };
    let Some(number) = model.strip_prefix('p') else {
        return false;
    };
    !number.is_empty()
        && number.len() <= 4
        && !number.starts_with('0')
        && number.bytes().all(|byte| byte.is_ascii_digit())
        && is_digest(digest, 32)
}

/// A canonical UTC time in years 0001 to 9999 (B5's rule).
fn parse_time(field: &str, value: &str) -> Result<DateTime, ThirdPerspectiveError> {
    DateTime::parse(value)
        .filter(|time| {
            time.rfc3339() == value
                && value.starts_with(|c: char| c.is_ascii_digit())
                && !value.starts_with("0000")
        })
        .ok_or_else(|| {
            ThirdPerspectiveError::new(
                ErrorCode::InvalidTime,
                format!("`{field}` must be a UTC time written like 2026-10-26T10:00:00Z"),
            )
        })
}

impl Provenance {
    pub fn validate(&self) -> Result<(), ThirdPerspectiveError> {
        if !is_work_path(&self.work) {
            return Err(ThirdPerspectiveError::new(
                ErrorCode::InvalidWork,
                "`work` must be the site-relative path of a published page, such as /posts/tides/",
            ));
        }
        if !is_passage_revision(&self.revision) {
            return Err(ThirdPerspectiveError::new(
                ErrorCode::InvalidRevision,
                "`revision` must be a passage revision such as p1: and 32 hexadecimal digits",
            ));
        }
        self.target.validate()?;
        if self.seen_at.is_some_and(|seen| seen > self.received_at) {
            return Err(ThirdPerspectiveError::new(
                ErrorCode::SeenAfterReceived,
                "`seenAt` is later than `receivedAt`",
            ));
        }
        self.attribution.validate("attribution")
    }

    fn from_value(value: &Value) -> Result<Self, ThirdPerspectiveError> {
        let malformed = |what: &str| ThirdPerspectiveError::new(ErrorCode::Malformed, what);
        match value.get("version").and_then(Value::as_u64) {
            Some(PROVENANCE_VERSION) => {}
            Some(version) if version > PROVENANCE_VERSION => {
                return Err(ThirdPerspectiveError::new(
                    ErrorCode::UnsupportedVersion,
                    format!("`provenance` is version {version}, newer than the version {PROVENANCE_VERSION} this open.blog reads"),
                ))
            }
            _ => return Err(malformed("`provenance` needs `version` 1")),
        }
        let wire: WireProvenance = serde_json::from_value(value.clone()).map_err(|_| {
            malformed("`provenance` has a field this version does not define, or a field of the wrong type")
        })?;
        Ok(Self {
            target: PerspectiveTarget::from_value(&wire.target)?,
            seen_at: wire
                .seen_at
                .as_deref()
                .map(|seen| parse_time("provenance.seenAt", seen))
                .transpose()?,
            received_at: parse_time("provenance.receivedAt", &wire.received_at)?,
            work: wire.work,
            revision: wire.revision,
            channel: wire.channel,
            attribution: wire.attribution,
        })
    }

    fn wire(&self) -> WireProvenance<WireTarget> {
        WireProvenance {
            version: PROVENANCE_VERSION,
            work: self.work.clone(),
            revision: self.revision.clone(),
            target: self.target.wire(),
            seen_at: self.seen_at.map(DateTime::rfc3339),
            received_at: self.received_at.rfc3339(),
            channel: self.channel,
            attribution: self.attribution.clone(),
        }
    }
}

/// Who can act for the submitter, kept for moderation even when the reader
/// chose to be anonymous. Anonymous display is never anonymous provenance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Intake {
    /// A hosted submission: the digest (64 lowercase hex digits) of the
    /// private receipt the reader holds. The receipt itself is never stored.
    Hosted { receipt_digest: String },
    /// A manual entry: the Admin user who entered the reader's message.
    Manual { entered_by: String },
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireIntake {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    receipt_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    entered_by: Option<String>,
}

impl Intake {
    pub fn channel(&self) -> Channel {
        match self {
            Intake::Hosted { .. } => Channel::Hosted,
            Intake::Manual { .. } => Channel::Manual,
        }
    }

    fn validate(&self) -> Result<(), ThirdPerspectiveError> {
        let valid = match self {
            Intake::Hosted { receipt_digest } => is_digest(receipt_digest, 64),
            Intake::Manual { entered_by } => crate::collaboration::valid_admin_username(entered_by),
        };
        if valid {
            Ok(())
        } else {
            Err(ThirdPerspectiveError::new(
                ErrorCode::InvalidIntake,
                "`intake` needs a receipt digest of 64 hexadecimal digits for a hosted copy, or the Admin user who entered a manual one",
            ))
        }
    }

    fn wire(&self) -> WireIntake {
        match self {
            Intake::Hosted { receipt_digest } => WireIntake {
                receipt_digest: Some(receipt_digest.clone()),
                entered_by: None,
            },
            Intake::Manual { entered_by } => WireIntake {
                receipt_digest: None,
                entered_by: Some(entered_by.clone()),
            },
        }
    }

    fn from_wire(wire: WireIntake) -> Result<Self, ThirdPerspectiveError> {
        match (wire.receipt_digest, wire.entered_by) {
            (Some(receipt_digest), None) => Ok(Intake::Hosted { receipt_digest }),
            (None, Some(entered_by)) => Ok(Intake::Manual { entered_by }),
            _ => Err(ThirdPerspectiveError::new(
                ErrorCode::InvalidIntake,
                "`intake` names exactly one of `receiptDigest` and `enteredBy`",
            )),
        }
    }
}

// ---------------------------------------------------------------------------
// Consent

/// One immutable record of what the reader agreed to. Records are numbered
/// from 1; the last is in effect. Narrowing takes effect at once, a name can
/// be added only before a moderator decides, and revoking publication is a
/// withdrawal and final.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmissionConsent {
    pub number: u32,
    pub given_at: DateTime,
    /// Agreement to publish the reflection on the canonical page once a
    /// moderator approves it. `false` only on the last record: revoked.
    pub publish: bool,
    /// The name and whether to show it with the reflection.
    pub attribution: ReaderAttribution,
    /// Agreement to be asked to clarify (RD12's clarification consent).
    pub clarification: bool,
    /// The text revision the reader agreed an editor may feature; a feature
    /// of any other revision is not covered.
    pub feature_revision: Option<u32>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireConsent {
    number: u32,
    given_at: String,
    publish: bool,
    #[serde(default)]
    attribution: ReaderAttribution,
    clarification: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    feature_revision: Option<u32>,
}

impl SubmissionConsent {
    /// Whether this record shows the reader's name differently from
    /// `before`: a name shown where none was, or another name shown.
    fn widens_name(&self, before: &SubmissionConsent) -> bool {
        self.attribution.publish_name
            && (!before.attribution.publish_name
                || self.attribution.name != before.attribution.name)
    }

    fn same_terms(&self, other: &SubmissionConsent) -> bool {
        self.publish == other.publish
            && self.attribution == other.attribution
            && self.clarification == other.clarification
            && self.feature_revision == other.feature_revision
    }
}

/// The consent a reader gives with a submission.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ConsentChoices {
    /// Must be true: a Third Perspective is offered for publication.
    pub publish: bool,
    pub clarification: bool,
    /// Agreement that an editor may feature the text as submitted.
    pub feature: bool,
}

/// A reader's change to their consent, proven by the server (their receipt
/// or an Admin user's entry of their message).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConsentChange {
    pub publish: bool,
    pub attribution: ReaderAttribution,
    pub clarification: bool,
    /// Agreement that an editor may feature the approved text (or, before a
    /// decision, the current text).
    pub feature: bool,
}

/// What a recorded consent change asks of moderation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConsentOutcome {
    /// Recorded; the public projection follows it at once.
    Recorded,
    /// Publication revoked: apply RD12's `withdraw` in the same write. Its
    /// text is purged at once.
    Withdraw,
}

// ---------------------------------------------------------------------------
// Moderation facts (RD12's shapes)

/// RD12's moderation states, with the same stored ids. Only approved can be
/// public.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ModerationState {
    Pending,
    Clarification,
    Approved,
    Rejected,
    Removed,
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
}

/// The server-side moderation facts of one copy: the fields of RD12's
/// `ItemFacts` this module reads, plus the consent record an approval bound.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModerationFacts {
    pub state: ModerationState,
    /// The text revision, raised only when a clarification replaces it.
    pub revision: u32,
    /// The revision an approval covers, set only while approved.
    pub approved_revision: Option<u32>,
    /// The consent record an approval covers, set only while approved.
    pub approved_consent: Option<u32>,
    /// Whether the text, name and consent are still stored.
    pub content_retained: bool,
}

/// Where a reflection is in its lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Stage {
    /// A private draft on the reader's device. The site holds nothing.
    Local,
    /// Received and waiting for a moderator. Private.
    Submitted,
    /// A moderator asked the reader to clarify. Private.
    Clarification,
    /// Approved: public while its kind is shown and the consent holds.
    Approved,
    /// Declined, or expired unmoderated. Private.
    Rejected,
    /// Taken down after approval. Private.
    Removed,
    /// Taken back by the reader. Private and final.
    Withdrawn,
    /// Text, name and consent purged; only the audit trail remains.
    Deleted,
}

impl Stage {
    pub fn id(self) -> &'static str {
        match self {
            Stage::Local => "local",
            Stage::Submitted => "submitted",
            Stage::Clarification => "clarification",
            Stage::Approved => "approved",
            Stage::Rejected => "rejected",
            Stage::Removed => "removed",
            Stage::Withdrawn => "withdrawn",
            Stage::Deleted => "deleted",
        }
    }

    /// The stage of a stored copy. Purged text is deleted whatever its state.
    pub fn of(facts: &ModerationFacts) -> Self {
        if !facts.content_retained {
            return Stage::Deleted;
        }
        match facts.state {
            ModerationState::Pending => Stage::Submitted,
            ModerationState::Clarification => Stage::Clarification,
            ModerationState::Approved => Stage::Approved,
            ModerationState::Rejected => Stage::Rejected,
            ModerationState::Removed => Stage::Removed,
            ModerationState::Withdrawn => Stage::Withdrawn,
        }
    }
}

/// A moderator's approval request, naming what they reviewed.
#[derive(Clone, Copy, Debug)]
pub struct ApprovalRequest<'a> {
    /// The moderator's account (RD12's audit `actorId`). Never empty.
    pub moderator: &'a str,
    pub seen_revision: u32,
    pub seen_consent: u32,
    pub at: DateTime,
}

/// What an approval binds: one text revision under one consent record,
/// decided by a named moderator. Store `revision` and `consent` with RD12's
/// approve transition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalBinding {
    pub revision: u32,
    pub consent: u32,
    pub approved_by: String,
    pub approved_at: DateTime,
}

/// The published work a reflection is shown with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishedWork {
    pub path: String,
    /// Its passage revision now.
    pub revision: String,
    /// Every name its work credits show: each author and any group.
    pub credited: Vec<String>,
}

/// An editor's choice to feature one approved revision (RD14 owns where and
/// why). It never comes from counts or reactions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureSelection {
    pub selected_by: String,
    pub revision: u32,
}

// ---------------------------------------------------------------------------
// Text

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn forbidden_in_body(character: char) -> bool {
    (character.is_control() && !matches!(character, '\t' | '\n'))
        || crate::research_notes::bidi_override(character)
}

/// A reflection as stored: line breaks as `\n`, trimmed, 1 to
/// [`MAX_BODY_CHARS`] characters of plain text. It is never read as
/// Markdown or HTML.
fn normalize_body(value: &str) -> Option<String> {
    let text = value.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.trim();
    let count = text.chars().count();
    ((1..=MAX_BODY_CHARS).contains(&count) && !text.chars().any(forbidden_in_body))
        .then(|| text.to_string())
}

fn body_error() -> ThirdPerspectiveError {
    ThirdPerspectiveError::new(
        ErrorCode::InvalidBody,
        format!("`body` must be 1 to {MAX_BODY_CHARS} characters of plain text"),
    )
}

fn read_category(id: Option<&str>) -> Result<Option<ResponseCategory>, ThirdPerspectiveError> {
    id.map(|id| {
        ResponseCategory::from_id(id).ok_or_else(|| {
            ThirdPerspectiveError::new(
                ErrorCode::UnknownCategory,
                "`category` must be one of the response categories, or left out",
            )
        })
    })
    .transpose()
}

fn read_kind(kind: &str) -> Result<(), ThirdPerspectiveError> {
    if kind == KIND_ID {
        Ok(())
    } else {
        Err(ThirdPerspectiveError::new(
            ErrorCode::WrongKind,
            format!("`kind` must be `{KIND_ID}`"),
        ))
    }
}

fn read_json(text: &str, what: &str) -> Result<Value, ThirdPerspectiveError> {
    if text.len() > MAX_JSON_BYTES {
        return Err(ThirdPerspectiveError::new(
            ErrorCode::TooLarge,
            format!("a {what} is larger than {MAX_JSON_BYTES} bytes"),
        ));
    }
    let value: Value = serde_json::from_str(text).map_err(|_| {
        ThirdPerspectiveError::new(ErrorCode::Malformed, format!("a {what} is not valid JSON"))
    })?;
    match value.get("version").and_then(Value::as_u64) {
        Some(THIRD_PERSPECTIVE_VERSION) => Ok(value),
        Some(version) if version > THIRD_PERSPECTIVE_VERSION => Err(ThirdPerspectiveError::new(
            ErrorCode::UnsupportedVersion,
            format!("this {what} is version {version}, newer than the version {THIRD_PERSPECTIVE_VERSION} this open.blog reads"),
        )),
        _ => Err(ThirdPerspectiveError::new(
            ErrorCode::Malformed,
            format!("a {what} needs `version` 1"),
        )),
    }
}

fn wire_error(what: &str) -> ThirdPerspectiveError {
    ThirdPerspectiveError::new(
        ErrorCode::Malformed,
        format!("a {what} has a field this version does not define, or a field of the wrong type"),
    )
}

// ---------------------------------------------------------------------------
// Local reflection and submission

/// A reader's private draft. It lives only on the reader's device: it has
/// no id, provenance, consent or moderation state, and becomes a
/// [`SubmissionRequest`] only when the reader chooses to send it with their
/// consent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalReflection {
    pub work: String,
    /// The passage revision of the page the reader is reading.
    pub revision: String,
    pub target: PerspectiveTarget,
    pub category: Option<ResponseCategory>,
    pub body: String,
    pub attribution: ReaderAttribution,
    pub seen_at: Option<DateTime>,
}

impl LocalReflection {
    pub fn stage(&self) -> Stage {
        Stage::Local
    }

    /// The request a reader sends, with the consent they chose.
    pub fn submission(self, consent: ConsentChoices) -> SubmissionRequest {
        SubmissionRequest {
            reflection: self,
            consent,
        }
    }
}

/// What a reader sends: their reflection and their consent. Untrusted until
/// [`SubmissionRequest::receive`] checks it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmissionRequest {
    pub reflection: LocalReflection,
    pub consent: ConsentChoices,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireRequest<T = Value> {
    version: u64,
    kind: String,
    work: String,
    revision: String,
    target: T,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    seen_at: Option<String>,
    #[serde(default)]
    attribution: ReaderAttribution,
    consent: WireChoices,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireChoices {
    publish: bool,
    #[serde(default)]
    clarification: bool,
    #[serde(default)]
    feature: bool,
}

impl SubmissionRequest {
    /// Read a request a browser sent:
    /// `{version, kind, work, revision, target, category?, body, seenAt?,
    /// attribution?, consent: {publish, clarification?, feature?}}`.
    /// `consent.publish` must be present.
    pub fn from_json(text: &str) -> Result<Self, ThirdPerspectiveError> {
        let value = read_json(text, "Third Perspective submission")?;
        let wire: WireRequest = serde_json::from_value(value)
            .map_err(|_| wire_error("Third Perspective submission"))?;
        read_kind(&wire.kind)?;
        Ok(Self {
            reflection: LocalReflection {
                target: PerspectiveTarget::from_value(&wire.target)?,
                category: read_category(wire.category.as_deref())?,
                seen_at: wire
                    .seen_at
                    .as_deref()
                    .map(|seen| parse_time("seenAt", seen))
                    .transpose()?,
                work: wire.work,
                revision: wire.revision,
                body: wire.body,
                attribution: wire.attribution,
            },
            consent: ConsentChoices {
                publish: wire.consent.publish,
                clarification: wire.consent.clarification,
                feature: wire.consent.feature,
            },
        })
    }

    pub fn to_json(&self) -> String {
        let reflection = &self.reflection;
        serde_json::to_string(&WireRequest {
            version: THIRD_PERSPECTIVE_VERSION,
            kind: KIND_ID.into(),
            work: reflection.work.clone(),
            revision: reflection.revision.clone(),
            target: reflection.target.wire(),
            category: reflection.category.map(|category| category.id().into()),
            body: reflection.body.clone(),
            seen_at: reflection.seen_at.map(DateTime::rfc3339),
            attribution: reflection.attribution.clone(),
            consent: WireChoices {
                publish: self.consent.publish,
                clarification: self.consent.clarification,
                feature: self.consent.feature,
            },
        })
        .expect("a submission always serializes")
    }

    /// The copy a receiver keeps: the hosted function stamps `received_at`
    /// itself; an Admin user entering a reader's message records when it
    /// came. Text and name are normalized, a `seen_at` later than
    /// `received_at` is dropped, and the consent becomes record 1. Without
    /// agreement to publish nothing is kept.
    pub fn receive(
        self,
        received_at: DateTime,
        intake: Intake,
    ) -> Result<SubmittedCopy, ThirdPerspectiveError> {
        if !self.consent.publish {
            return Err(ThirdPerspectiveError::new(
                ErrorCode::PublicationConsentRequired,
                "a Third Perspective is submitted for publication; `consent.publish` must be true",
            ));
        }
        let reflection = self.reflection;
        let body = normalize_body(&reflection.body).ok_or_else(body_error)?;
        let attribution = reflection.attribution.normalized();
        let copy = SubmittedCopy {
            category: reflection.category,
            body,
            revision: 1,
            revised_at: None,
            provenance: Provenance {
                work: reflection.work,
                revision: reflection.revision,
                target: reflection.target,
                seen_at: reflection.seen_at.filter(|seen| *seen <= received_at),
                received_at,
                channel: intake.channel(),
                attribution: attribution.clone(),
            },
            intake,
            consents: vec![SubmissionConsent {
                number: 1,
                given_at: received_at,
                publish: true,
                attribution,
                clarification: self.consent.clarification,
                feature_revision: self.consent.feature.then_some(1),
            }],
        };
        copy.validate()?;
        Ok(copy)
    }
}

// ---------------------------------------------------------------------------
// Submitted copy

/// The site's private copy of a submitted reflection: the current text, its
/// provenance, who can act for the submitter, and the reader's consent
/// history. Moderation data, never public as such, never a research note or
/// an author's contribution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmittedCopy {
    pub category: Option<ResponseCategory>,
    /// The current revision's text.
    pub body: String,
    /// RD12's text revision: 1, raised only by a clarification.
    pub revision: u32,
    /// When the current revision arrived; `None` for revision 1.
    pub revised_at: Option<DateTime>,
    pub provenance: Provenance,
    pub intake: Intake,
    /// Every consent record, oldest first; the last is in effect.
    pub consents: Vec<SubmissionConsent>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireRecord<P = Value> {
    version: u64,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    body: String,
    revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revised_at: Option<String>,
    provenance: P,
    intake: WireIntake,
    consents: Vec<WireConsent>,
}

impl SubmittedCopy {
    /// The consent in effect.
    pub fn consent(&self) -> &SubmissionConsent {
        self.consents
            .last()
            .expect("a validated copy has a consent record")
    }

    /// The consent record numbered `number`.
    pub fn consent_record(&self, number: u32) -> Option<&SubmissionConsent> {
        self.consents.iter().find(|record| record.number == number)
    }

    fn history_error(message: &str) -> ThirdPerspectiveError {
        ThirdPerspectiveError::new(ErrorCode::InvalidConsentHistory, message)
    }

    /// Check every rule (ADRs 0106 to 0108).
    pub fn validate(&self) -> Result<(), ThirdPerspectiveError> {
        if normalize_body(&self.body).as_deref() != Some(self.body.as_str()) {
            return Err(body_error());
        }
        self.provenance.validate()?;
        self.intake.validate()?;
        if self.intake.channel() != self.provenance.channel {
            return Err(ThirdPerspectiveError::new(
                ErrorCode::InvalidIntake,
                "`intake` does not match `provenance.channel`",
            ));
        }
        match (self.revision, self.revised_at) {
            (0, _) => {
                return Err(ThirdPerspectiveError::new(
                    ErrorCode::Malformed,
                    "`revision` starts at 1",
                ))
            }
            (1, None) => {}
            (1, Some(_)) | (_, None) => {
                return Err(ThirdPerspectiveError::new(
                    ErrorCode::InvalidTime,
                    "`revisedAt` is set exactly when `revision` is above 1",
                ))
            }
            (_, Some(revised)) if revised < self.provenance.received_at => {
                return Err(ThirdPerspectiveError::new(
                    ErrorCode::InvalidTime,
                    "`revisedAt` is earlier than `provenance.receivedAt`",
                ))
            }
            _ => {}
        }
        // The last slot is kept for a revocation.
        let limit = match self.consents.last() {
            Some(last) if last.publish => MAX_CONSENT_RECORDS - 1,
            _ => MAX_CONSENT_RECORDS,
        };
        if self.consents.is_empty() || self.consents.len() > limit {
            return Err(Self::history_error(
                "`consents` holds 1 to 49 consent records, and a revocation after them",
            ));
        }
        let first = &self.consents[0];
        if first.given_at != self.provenance.received_at
            || !first.publish
            || first.attribution != self.provenance.attribution
        {
            return Err(Self::history_error(
                "the first consent record is the one received with the submission",
            ));
        }
        let last = self.consents.len() - 1;
        for (index, record) in self.consents.iter().enumerate() {
            if record.number as usize != index + 1 {
                return Err(Self::history_error(
                    "consent records are numbered 1, 2, 3 and so on",
                ));
            }
            if index > 0 && record.given_at < self.consents[index - 1].given_at {
                return Err(Self::history_error("consent records are in time order"));
            }
            if !record.publish && (index != last || record.feature_revision.is_some()) {
                return Err(Self::history_error(
                    "revoking publication is final and covers no feature",
                ));
            }
            if record
                .feature_revision
                .is_some_and(|revision| revision == 0 || revision > self.revision)
            {
                return Err(Self::history_error(
                    "`featureRevision` names a revision of this reflection",
                ));
            }
            record.attribution.validate("consents.attribution")?;
        }
        Ok(())
    }

    /// Read a stored copy, refusing a newer version, an unknown field or any
    /// broken rule. Nothing is repaired.
    pub fn from_json(text: &str) -> Result<Self, ThirdPerspectiveError> {
        let value = read_json(text, "Third Perspective record")?;
        let wire: WireRecord =
            serde_json::from_value(value).map_err(|_| wire_error("Third Perspective record"))?;
        read_kind(&wire.kind)?;
        let consents = wire
            .consents
            .into_iter()
            .map(|record| {
                Ok(SubmissionConsent {
                    number: record.number,
                    given_at: parse_time("consents.givenAt", &record.given_at)?,
                    publish: record.publish,
                    attribution: record.attribution,
                    clarification: record.clarification,
                    feature_revision: record.feature_revision,
                })
            })
            .collect::<Result<Vec<_>, ThirdPerspectiveError>>()?;
        let copy = Self {
            category: read_category(wire.category.as_deref())?,
            body: wire.body,
            revision: wire.revision,
            revised_at: wire
                .revised_at
                .as_deref()
                .map(|revised| parse_time("revisedAt", revised))
                .transpose()?,
            provenance: Provenance::from_value(&wire.provenance)?,
            intake: Intake::from_wire(wire.intake)?,
            consents,
        };
        copy.validate()?;
        Ok(copy)
    }

    /// Canonical JSON, in a fixed field order. Private: for storage and the
    /// moderation inbox only.
    pub fn to_json(&self) -> String {
        serde_json::to_string(&WireRecord {
            version: THIRD_PERSPECTIVE_VERSION,
            kind: KIND_ID.into(),
            category: self.category.map(|category| category.id().into()),
            body: self.body.clone(),
            revision: self.revision,
            revised_at: self.revised_at.map(DateTime::rfc3339),
            provenance: self.provenance.wire(),
            intake: self.intake.wire(),
            consents: self
                .consents
                .iter()
                .map(|record| WireConsent {
                    number: record.number,
                    given_at: record.given_at.rfc3339(),
                    publish: record.publish,
                    attribution: record.attribution.clone(),
                    clarification: record.clarification,
                    feature_revision: record.feature_revision,
                })
                .collect(),
        })
        .expect("a record always serializes")
    }

    fn in_step(&self, facts: &ModerationFacts) -> Result<(), LifecycleError> {
        if !facts.content_retained {
            return Err(LifecycleError::ContentPurged);
        }
        if facts.revision != self.revision {
            return Err(LifecycleError::OutOfStep);
        }
        Ok(())
    }

    /// Whether the moderator may approve now, and what the approval binds.
    /// Check this before RD12's `approve`, and store the binding with it.
    pub fn check_approval(
        &self,
        facts: &ModerationFacts,
        request: &ApprovalRequest<'_>,
    ) -> Result<ApprovalBinding, LifecycleError> {
        let moderator = request.moderator;
        if moderator.is_empty()
            || moderator.len() > MAX_MODERATOR_CHARS
            || moderator
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
        {
            return Err(LifecycleError::AnonymousModerator);
        }
        self.in_step(facts)?;
        if facts.state != ModerationState::Pending {
            return Err(LifecycleError::NotPending);
        }
        let consent = self.consent();
        if !consent.publish {
            return Err(LifecycleError::PublicationNotConsented);
        }
        if request.seen_revision != self.revision {
            return Err(LifecycleError::StaleRevision);
        }
        if request.seen_consent != consent.number {
            return Err(LifecycleError::StaleConsent);
        }
        Ok(ApprovalBinding {
            revision: self.revision,
            consent: consent.number,
            approved_by: moderator.to_string(),
            approved_at: request.at,
        })
    }

    /// Record a consent change. Narrowing (hiding a name, declining
    /// clarification or a feature) takes effect at once in every state the
    /// text is kept. Showing a name, or another name, is accepted only while
    /// undecided (pending or clarification). Feature consent binds to the
    /// approved revision, or before a decision to the current one. Revoking
    /// publication is final and asks for RD12's withdrawal where it applies.
    pub fn revise_consent(
        &mut self,
        facts: &ModerationFacts,
        change: ConsentChange,
        at: DateTime,
    ) -> Result<ConsentOutcome, LifecycleError> {
        self.in_step(facts)?;
        let current = self.consent().clone();
        if !current.publish || facts.state == ModerationState::Withdrawn {
            return Err(LifecycleError::Closed);
        }
        if at < current.given_at {
            return Err(LifecycleError::InvalidTime);
        }
        let number = current.number + 1;
        // Revoking never depends on anything else the change says, and the
        // last of the [`MAX_CONSENT_RECORDS`] slots is kept for it.
        if !change.publish {
            self.consents.push(SubmissionConsent {
                number,
                given_at: at,
                publish: false,
                attribution: ReaderAttribution {
                    publish_name: false,
                    ..current.attribution
                },
                clarification: false,
                feature_revision: None,
            });
            return Ok(match facts.state {
                ModerationState::Pending
                | ModerationState::Clarification
                | ModerationState::Approved => ConsentOutcome::Withdraw,
                _ => ConsentOutcome::Recorded,
            });
        }
        if self.consents.len() >= MAX_CONSENT_RECORDS - 1 {
            return Err(LifecycleError::ConsentLimit);
        }
        let attribution = change.attribution.normalized();
        attribution.check().map_err(|code| match code {
            ErrorCode::ConsentWithoutName => LifecycleError::ConsentWithoutName,
            _ => LifecycleError::InvalidName,
        })?;
        let undecided = matches!(
            facts.state,
            ModerationState::Pending | ModerationState::Clarification
        );
        let feature_revision = if !change.feature {
            None
        } else if undecided {
            Some(self.revision)
        } else if facts.state == ModerationState::Approved {
            facts.approved_revision
        } else {
            current.feature_revision
        };
        if change.feature && feature_revision.is_none() {
            return Err(LifecycleError::FeatureNotAvailable);
        }
        let record = SubmissionConsent {
            number,
            given_at: at,
            publish: true,
            attribution,
            clarification: change.clarification,
            feature_revision,
        };
        if record.same_terms(&current) {
            return Err(LifecycleError::Unchanged);
        }
        if record.widens_name(&current) && !undecided {
            return Err(LifecycleError::WideningAfterDecision);
        }
        self.consents.push(record);
        Ok(ConsentOutcome::Recorded)
    }

    /// The reader's answer to a clarification request: it replaces the text
    /// as the next revision (apply RD12's `clarify` in the same write). The
    /// text asked about is never approved; a feature consent for it no
    /// longer covers the new text.
    pub fn clarify(
        &mut self,
        facts: &ModerationFacts,
        body: &str,
        at: DateTime,
    ) -> Result<u32, LifecycleError> {
        self.in_step(facts)?;
        if facts.state != ModerationState::Clarification {
            return Err(LifecycleError::NotInClarification);
        }
        if !self.consent().publish {
            return Err(LifecycleError::Closed);
        }
        let latest = self.revised_at.unwrap_or(self.provenance.received_at);
        if at < latest {
            return Err(LifecycleError::InvalidTime);
        }
        self.body = normalize_body(body).ok_or(LifecycleError::InvalidBody)?;
        self.revision += 1;
        self.revised_at = Some(at);
        Ok(self.revision)
    }

    /// Whether the name the reader gave is one the work credits, for the
    /// moderation inbox. Such a name is never shown with the reflection.
    pub fn name_matches_credit(&self, credited: &[String]) -> bool {
        self.consent()
            .attribution
            .name
            .as_deref()
            .is_some_and(|name| matches_credit(name, credited))
    }

    /// The one public form of this copy (ADR 0108), or `None` while it may
    /// not be shown: only approved, at the current revision and under a
    /// consent record that still allows publication, with the text kept and
    /// the kind shown on the work (`shown`, RD12's mode `locked` or `open`).
    /// The name appears only while both the approved and the current
    /// consent show that same name, and never when it matches a name the
    /// work credits.
    pub fn approved_response(
        &self,
        facts: &ModerationFacts,
        shown: bool,
        work: &PublishedWork,
        target: &TargetStatus,
    ) -> Option<ApprovedResponse> {
        if !shown
            || !facts.content_retained
            || facts.state != ModerationState::Approved
            || facts.revision != self.revision
            || facts.approved_revision != Some(self.revision)
            || work.path != self.provenance.work
        {
            return None;
        }
        let current = self.consent();
        let approved = self.consent_record(facts.approved_consent?)?;
        if !current.publish || !approved.publish {
            return None;
        }
        let name = match (
            approved.attribution.public_name(),
            current.attribution.public_name(),
        ) {
            (Some(approved), Some(current)) if approved == current => Some(current),
            _ => None,
        }
        .filter(|name| !matches_credit(name, &work.credited))
        .map(str::to_string);
        let (about, section, stale) = match (&self.provenance.target, target) {
            (PerspectiveTarget::Work, _) => (About::Work, None, false),
            (PerspectiveTarget::Section { .. }, TargetStatus::Current { section }) => {
                (About::Section, section.clone(), false)
            }
            (
                PerspectiveTarget::Section { section, .. },
                TargetStatus::Stale { section_present },
            ) => (
                About::Section,
                section.clone().filter(|_| *section_present),
                true,
            ),
        };
        Some(ApprovedResponse {
            kind: KIND_ID,
            role: READER_ROLE,
            work: self.provenance.work.clone(),
            about,
            section,
            stale,
            earlier_revision: self.provenance.revision != work.revision,
            category: self.category,
            body: self.body.clone(),
            name,
            received: self.provenance.received_at.ymd(),
        })
    }

    /// An approved response an editor features: only while it is public and
    /// the reader's current consent covers featuring exactly the approved
    /// revision the editor chose.
    pub fn featured(
        &self,
        facts: &ModerationFacts,
        shown: bool,
        work: &PublishedWork,
        target: &TargetStatus,
        selection: &FeatureSelection,
    ) -> Option<FeaturedPublication> {
        let response = self.approved_response(facts, shown, work, target)?;
        let covered = crate::collaboration::valid_admin_username(&selection.selected_by)
            && facts.approved_revision == Some(selection.revision)
            && self.consent().feature_revision == Some(selection.revision);
        covered.then_some(FeaturedPublication { response })
    }
}

fn matches_credit(name: &str, credited: &[String]) -> bool {
    let fold = |value: &str| collapse_whitespace(value).to_lowercase();
    let name = fold(name);
    credited.iter().any(|credit| fold(credit) == name)
}

// ---------------------------------------------------------------------------
// Public projection

/// The only role a Third Perspective is shown with.
pub const READER_ROLE: &str = "reader";

/// What an approved response is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum About {
    Work,
    Section,
}

/// The one public form of a Third Perspective: the canonical page's view of
/// an approved copy. It has no field for provenance, intake, consent,
/// moderation state, reasons, revisions, ids, the reader's clock or an
/// unpublished name, so nothing that renders it can show them. It is shown
/// apart from the authors' sections, as a reader's reflection, and never
/// joins the Post, its credits, feeds or portable exports.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedResponse {
    /// Always `third-perspective`.
    pub kind: &'static str,
    /// Always `reader`: never an author's perspective.
    pub role: &'static str,
    pub work: String,
    pub about: About,
    /// The section it is about now; for a stale section, its old heading id
    /// only while that section still exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// The section the reader wrote about has changed or gone.
    pub stale: bool,
    /// The reader read an earlier revision of the work.
    pub earlier_revision: bool,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "category_id"
    )]
    pub category: Option<ResponseCategory>,
    /// Plain text; renderers escape it and split paragraphs at blank lines.
    pub body: String,
    /// The reader's name, only with their agreement; otherwise anonymous.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The day it was received, `YYYY-MM-DD`.
    pub received: String,
}

fn category_id<S: serde::Serializer>(
    category: &Option<ResponseCategory>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match category {
        Some(category) => serializer.serialize_str(category.id()),
        None => serializer.serialize_none(),
    }
}

impl ApprovedResponse {
    /// The accessible heading a page gives it: always a reader's, never an
    /// author's or a group's.
    pub fn heading(&self) -> String {
        match &self.name {
            Some(name) => format!("{KIND_LABEL} from {name}, a reader"),
            None => format!("{KIND_LABEL} from a reader"),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a public response always serializes")
    }
}

/// An approved response an editor chose to feature, with the reader's
/// feature consent for that revision. Selection is editorial, never a count
/// or a consensus; RD14 owns its placement and context.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturedPublication {
    pub response: ApprovedResponse,
}

impl FeaturedPublication {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a featured response always serializes")
    }
}

//! Evidence submissions: a reader's suggested source or suggested correction
//! that also says which published claim or citation it concerns and which
//! published source, and where in it, the reader offers (ADR 0138).
//!
//! An evidence submission is B5's typed feedback ([`crate::scholarly_feedback`],
//! ADR 0079) of one of the two evidence kinds, `source-suggestion` or
//! `correction-suggestion`, with an optional `evidence` block. The block is
//! the reader's statement, never the author's reading: its claim, evidence
//! link and source ids are the site's own public identities (A4 claims and
//! evidence links, A1/A3 source identifiers and locators), checked here for
//! shape only and later only against what the site publishes
//! ([`PublishedReferences`]), so a reader's guess can never confirm that a
//! private claim or source exists. Nothing here is ever an A4 evidence link,
//! a citation, a Source Library record or a research note, and no field
//! ranks, counts or votes on a submission.
//!
//! Format version 1 (B5) has no block and is read unchanged. A submission
//! with a block is format version 2, which B5's readers refuse; version 1 is
//! still what every submission without evidence is written as, so B5's
//! records stay byte for byte as they are.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::claim_publication::PostEvidence;
use crate::claims::Relation;
use crate::date::DateTime;
use crate::feedback_provenance::FeedbackChannel;
use crate::knowledge_atlas::valid_id;
use crate::research_notes::LocatorKind;
use crate::scholarly_feedback::{
    reader_text, FeedbackError, FeedbackErrorCode, FeedbackKind, FeedbackSubmission,
    ScholarlyFeedback, MAX_SUBMISSION_JSON_BYTES,
};

/// The submission and record format version that carries an evidence block.
pub const EVIDENCE_SUBMISSION_VERSION: u64 = 2;
/// The most locators a reader may give for one offered source.
pub const MAX_OFFERED_LOCATORS: usize = 8;
/// The longest locator value or range end a reader may give.
pub const MAX_LOCATOR_VALUE_CHARS: usize = 64;

/// The kinds that make an evidence submission: the reader offers a source,
/// or says the passage is wrong. Questions and other interpretations carry
/// no evidence block.
pub const EVIDENCE_KINDS: [FeedbackKind; 2] = [
    FeedbackKind::SourceSuggestion,
    FeedbackKind::CorrectionSuggestion,
];

/// Whether submissions of `kind` are evidence submissions.
pub fn is_evidence_kind(kind: FeedbackKind) -> bool {
    EVIDENCE_KINDS.contains(&kind)
}

/// One position in an offered source, in the notebook's locator kinds
/// (page, folio, line, section, chapter, canonical, timestamp or an `x-`
/// kind). Reader text, never verified.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfferedLocator {
    pub kind: LocatorKind,
    pub value: String,
    pub to: Option<String>,
}

/// What a reader says about the published claims, citations and sources
/// their submission concerns. Every field is the reader's own statement.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EvidenceOffer {
    /// The id of a published claim (A4) the submission is about.
    pub claim: Option<String>,
    /// The id of a published evidence link on that claim the reader
    /// questions: a challenged citation of evidence.
    pub evidence_link: Option<String>,
    /// The id of a source the post cites that the reader questions: a
    /// challenged citation.
    pub citation: Option<String>,
    /// The id of a source the site publishes that the reader offers as
    /// evidence (a reader-suggested passage of it with `locators`).
    pub source: Option<String>,
    /// Where in `source` the reader looked.
    pub locators: Vec<OfferedLocator>,
    /// How the reader says the evidence they offer (`source` or the
    /// feedback's `details.sourceUrl`) bears on the passage or claim. The
    /// reader's reading, never the author's evidence link.
    pub stance: Option<Relation>,
}

impl EvidenceOffer {
    /// Whether the offer questions a citation: a published evidence link or
    /// a cited source.
    pub fn challenges_citation(&self) -> bool {
        self.evidence_link.is_some() || self.citation.is_some()
    }

    /// The canonical JSON of the block.
    pub fn to_value(&self) -> Value {
        let mut object = Map::new();
        let mut put = |key: &str, value: &Option<String>| {
            if let Some(value) = value {
                object.insert(key.into(), value.clone().into());
            }
        };
        put("claim", &self.claim);
        put("evidenceLink", &self.evidence_link);
        put("citation", &self.citation);
        put("source", &self.source);
        if !self.locators.is_empty() {
            let locators = self
                .locators
                .iter()
                .map(|locator| {
                    let mut item = Map::new();
                    item.insert("kind".into(), locator.kind.as_str().into());
                    item.insert("value".into(), locator.value.clone().into());
                    if let Some(to) = &locator.to {
                        item.insert("to".into(), to.clone().into());
                    }
                    Value::Object(item)
                })
                .collect();
            object.insert("locators".into(), Value::Array(locators));
        }
        if let Some(stance) = self.stance {
            object.insert("stance".into(), stance.as_str().into());
        }
        Value::Object(object)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceErrorCode {
    /// The feedback itself broke a B5 rule; see [`EvidenceError::feedback`].
    Feedback,
    TooLarge,
    Malformed,
    UnsupportedVersion,
    /// The kind is a question or another interpretation, which offer no
    /// evidence.
    NotEvidenceKind,
    /// A version 2 document without an evidence block.
    MissingEvidence,
    /// An evidence block that names nothing.
    EmptyEvidence,
    /// A claim, evidence link or source id that is not a lowercase slug.
    InvalidReference,
    LinkWithoutClaim,
    LocatorsWithoutSource,
    TooManyLocators,
    InvalidLocator,
    /// A stance with nothing offered for it to describe.
    StanceWithoutEvidence,
}

/// Why an evidence submission or record was refused. Messages name the
/// field and never repeat what the reader wrote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceError {
    pub code: EvidenceErrorCode,
    /// For [`EvidenceErrorCode::Feedback`], B5's own code.
    pub feedback: Option<FeedbackErrorCode>,
    pub message: String,
}

impl EvidenceError {
    fn new(code: EvidenceErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            feedback: None,
            message: message.into(),
        }
    }
}

impl From<FeedbackError> for EvidenceError {
    fn from(error: FeedbackError) -> Self {
        Self {
            code: EvidenceErrorCode::Feedback,
            feedback: Some(error.code),
            message: error.message,
        }
    }
}

impl std::fmt::Display for EvidenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EvidenceError {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireOffer {
    #[serde(default)]
    claim: Option<String>,
    #[serde(default)]
    evidence_link: Option<String>,
    #[serde(default)]
    citation: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    locators: Option<Vec<WireLocator>>,
    #[serde(default)]
    stance: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireLocator {
    kind: String,
    value: String,
    #[serde(default)]
    to: Option<String>,
}

fn malformed(message: &str) -> EvidenceError {
    EvidenceError::new(EvidenceErrorCode::Malformed, message)
}

/// Read and check an evidence block for a submission of `kind` whose
/// details do (or do not) include a source link. The checks run in a fixed
/// order: shape, references, link needs claim, locators, stance, emptiness.
fn read_offer(value: &Value, has_source_url: bool) -> Result<EvidenceOffer, EvidenceError> {
    if !value.is_object() {
        return Err(malformed("`evidence` must be an object"));
    }
    let wire: WireOffer = serde_json::from_value(value.clone()).map_err(|_| {
        malformed(
            "`evidence` has a field this version does not define, or a field of the wrong type",
        )
    })?;
    for (field, id) in [
        ("claim", &wire.claim),
        ("evidenceLink", &wire.evidence_link),
        ("citation", &wire.citation),
        ("source", &wire.source),
    ] {
        if id.as_deref().is_some_and(|id| !valid_id(id)) {
            return Err(EvidenceError::new(
                EvidenceErrorCode::InvalidReference,
                format!(
                    "`evidence.{field}` must be an id the site publishes: a lowercase slug of at most 64 bytes"
                ),
            ));
        }
    }
    if wire.evidence_link.is_some() && wire.claim.is_none() {
        return Err(EvidenceError::new(
            EvidenceErrorCode::LinkWithoutClaim,
            "`evidence.evidenceLink` needs the `evidence.claim` it belongs to",
        ));
    }
    let wire_locators = wire.locators.unwrap_or_default();
    if !wire_locators.is_empty() && wire.source.is_none() {
        return Err(EvidenceError::new(
            EvidenceErrorCode::LocatorsWithoutSource,
            "`evidence.locators` need the `evidence.source` they are in",
        ));
    }
    if wire_locators.len() > MAX_OFFERED_LOCATORS {
        return Err(EvidenceError::new(
            EvidenceErrorCode::TooManyLocators,
            format!("`evidence.locators` holds at most {MAX_OFFERED_LOCATORS} locators"),
        ));
    }
    let mut locators = Vec::with_capacity(wire_locators.len());
    for (index, locator) in wire_locators.into_iter().enumerate() {
        let invalid = || {
            EvidenceError::new(
                EvidenceErrorCode::InvalidLocator,
                format!(
                    "`evidence.locators[{index}]` needs a known kind (page, folio, line, section, chapter, canonical, timestamp or x-…) and a value of 1 to {MAX_LOCATOR_VALUE_CHARS} characters"
                ),
            )
        };
        let kind = LocatorKind::parse(&locator.kind).ok_or_else(invalid)?;
        let value = reader_text(&locator.value, MAX_LOCATOR_VALUE_CHARS)
            .filter(|value| !value.contains(['\n', '\r', '\t']))
            .ok_or_else(invalid)?;
        let to = locator
            .to
            .map(|to| {
                reader_text(&to, MAX_LOCATOR_VALUE_CHARS)
                    .filter(|to| !to.contains(['\n', '\r', '\t']))
                    .ok_or_else(invalid)
            })
            .transpose()?;
        locators.push(OfferedLocator { kind, value, to });
    }
    let stance = wire
        .stance
        .map(|stance| {
            Relation::ALL
                .into_iter()
                .find(|relation| relation.as_str() == stance)
                .ok_or_else(|| {
                    malformed("`evidence.stance` must be supports, contradicts or contextualizes")
                })
        })
        .transpose()?;
    if stance.is_some() && wire.source.is_none() && !has_source_url {
        return Err(EvidenceError::new(
            EvidenceErrorCode::StanceWithoutEvidence,
            "`evidence.stance` describes offered evidence: give `evidence.source` or `details.sourceUrl`",
        ));
    }
    let offer = EvidenceOffer {
        claim: wire.claim,
        evidence_link: wire.evidence_link,
        citation: wire.citation,
        source: wire.source,
        locators,
        stance,
    };
    if offer == EvidenceOffer::default() {
        return Err(EvidenceError::new(
            EvidenceErrorCode::EmptyEvidence,
            "`evidence` must name a claim, an evidence link, a citation, a source or a stance",
        ));
    }
    Ok(offer)
}

/// The version of a document, 1 or 2, or the error B5 would report.
fn read_version(value: &Value, what: &str) -> Result<u64, EvidenceError> {
    match value.get("version").and_then(Value::as_u64) {
        Some(version @ (1 | EVIDENCE_SUBMISSION_VERSION)) => Ok(version),
        Some(version) if version > EVIDENCE_SUBMISSION_VERSION => Err(EvidenceError::new(
            EvidenceErrorCode::UnsupportedVersion,
            format!(
                "this {what} is version {version}, newer than the version {EVIDENCE_SUBMISSION_VERSION} this open.blog reads"
            ),
        )),
        _ => Err(malformed(&format!("a {what} needs `version` 1 or 2"))),
    }
}

/// Split a document into its version 1 form and its evidence block,
/// refusing a block in version 1 and a version 2 document without one.
fn split(value: &Value, what: &str) -> Result<(Value, Option<Value>), EvidenceError> {
    let version = read_version(value, what)?;
    let Some(object) = value.as_object() else {
        return Err(malformed(&format!("a {what} must be an object")));
    };
    let mut plain = object.clone();
    let evidence = plain.remove("evidence");
    match (version, &evidence) {
        (1, Some(_)) => Err(malformed(&format!(
            "a version 1 {what} has no `evidence`; evidence needs version 2"
        ))),
        (2, None) => Err(EvidenceError::new(
            EvidenceErrorCode::MissingEvidence,
            format!("a version 2 {what} needs `evidence`; write it as version 1 without one"),
        )),
        _ => {
            plain.insert("version".into(), 1.into());
            Ok((Value::Object(plain), evidence))
        }
    }
}

/// What a reader sends to suggest a source or a correction, with the
/// optional evidence block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceSubmission {
    /// The B5 submission: kind, work, revision seen, target, text, details,
    /// the reader's clock and their attribution choice (ADRs 0078, 0079).
    pub feedback: FeedbackSubmission,
    pub evidence: Option<EvidenceOffer>,
}

impl EvidenceSubmission {
    /// Read a submission from JSON text, as [`FeedbackSubmission::from_json`]
    /// does, accepting version 2's evidence block.
    pub fn from_json(text: &str) -> Result<Self, EvidenceError> {
        if text.len() > MAX_SUBMISSION_JSON_BYTES {
            return Err(EvidenceError::new(
                EvidenceErrorCode::TooLarge,
                format!("a feedback submission is larger than {MAX_SUBMISSION_JSON_BYTES} bytes"),
            ));
        }
        let value: Value = serde_json::from_str(text)
            .map_err(|_| malformed("a feedback submission is not valid JSON"))?;
        Self::from_value(&value)
    }

    /// Read a submission. Checks run in a fixed order: version, every B5
    /// rule in B5's order, the kind is an evidence kind, then the block.
    pub fn from_value(value: &Value) -> Result<Self, EvidenceError> {
        let (plain, evidence) = split(value, "feedback submission")?;
        let feedback = FeedbackSubmission::from_value(&plain)?;
        if !is_evidence_kind(feedback.kind) {
            return Err(EvidenceError::new(
                EvidenceErrorCode::NotEvidenceKind,
                format!(
                    "a {} is not an evidence submission; only a source-suggestion or a correction-suggestion offers evidence",
                    feedback.kind.id()
                ),
            ));
        }
        let evidence = evidence
            .map(|block| read_offer(&block, feedback.details.source_url.is_some()))
            .transpose()?;
        Ok(Self { feedback, evidence })
    }

    /// Canonical JSON: version 1, exactly B5's form, without evidence;
    /// version 2 with it.
    pub fn to_value(&self) -> Value {
        with_evidence(self.feedback.to_value(), self.evidence.as_ref())
    }

    pub fn to_json(&self) -> String {
        self.to_value().to_string()
    }

    /// The record a receiver keeps, as [`FeedbackSubmission::receive`]
    /// makes it, with the evidence block beside it.
    pub fn receive(
        self,
        received_at: DateTime,
        channel: FeedbackChannel,
    ) -> Result<EvidenceRecord, EvidenceError> {
        Ok(EvidenceRecord {
            feedback: self.feedback.receive(received_at, channel)?,
            evidence: self.evidence,
        })
    }
}

fn with_evidence(mut value: Value, evidence: Option<&EvidenceOffer>) -> Value {
    if let (Some(evidence), Some(object)) = (evidence, value.as_object_mut()) {
        object.insert("version".into(), EVIDENCE_SUBMISSION_VERSION.into());
        object.insert("evidence".into(), evidence.to_value());
    }
    value
}

/// A received evidence submission: B5's record and the reader's evidence
/// block. Reader data, never research and never an author's evidence link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceRecord {
    pub feedback: ScholarlyFeedback,
    pub evidence: Option<EvidenceOffer>,
}

impl EvidenceRecord {
    /// `{version, kind, body, details, provenance}` as B5 writes it, with
    /// `evidence` and version 2 when there is a block.
    pub fn to_value(&self) -> Value {
        with_evidence(self.feedback.to_value(), self.evidence.as_ref())
    }

    pub fn to_json(&self) -> String {
        self.to_value().to_string()
    }

    /// Read a stored record, checking every rule again.
    pub fn from_value(value: &Value) -> Result<Self, EvidenceError> {
        let (plain, evidence) = split(value, "feedback record")?;
        let feedback = ScholarlyFeedback::from_value(&plain)?;
        if !is_evidence_kind(feedback.kind) {
            return Err(EvidenceError::new(
                EvidenceErrorCode::NotEvidenceKind,
                format!(
                    "a {} record is not an evidence submission",
                    feedback.kind.id()
                ),
            ));
        }
        let evidence = evidence
            .map(|block| read_offer(&block, feedback.details.source_url.is_some()))
            .transpose()?;
        Ok(Self { feedback, evidence })
    }

    pub fn from_json(text: &str) -> Result<Self, EvidenceError> {
        let value: Value = serde_json::from_str(text)
            .map_err(|_| malformed("a feedback record is not valid JSON"))?;
        Self::from_value(&value)
    }
}

/// What one post publishes that a reader can name: its published claims
/// with their published evidence links, and the sources it cites or its
/// published evidence uses. Built only from public output, never from the
/// private claims file or Source Library.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PublishedReferences {
    claims: BTreeMap<String, BTreeSet<String>>,
    sources: BTreeSet<String>,
}

impl PublishedReferences {
    pub fn new() -> Self {
        Self::default()
    }

    /// The claims, links and sources of a post's claim evidence projection
    /// (ADR 0075).
    pub fn from_post_evidence(post: &PostEvidence) -> Self {
        let mut references = Self::new();
        for claim in &post.claims {
            let links = claim
                .supports
                .iter()
                .chain(&claim.contradicts)
                .chain(&claim.contextualizes);
            let mut ids = BTreeSet::new();
            for link in links {
                ids.insert(link.id.clone());
                references.sources.insert(link.source.clone());
            }
            references.claims.insert(claim.id.clone(), ids);
        }
        references
    }

    /// Add a published claim and its published evidence links.
    pub fn with_claim<'a>(mut self, claim: &str, links: impl IntoIterator<Item = &'a str>) -> Self {
        self.claims
            .entry(claim.to_string())
            .or_default()
            .extend(links.into_iter().map(str::to_string));
        self
    }

    /// Add a source the post cites in its published citation notes or
    /// bibliography (ADR 0044), by its source identifier.
    pub fn with_source(mut self, source: &str) -> Self {
        self.sources.insert(source.to_string());
        self
    }

    /// Whether the post publishes this claim.
    pub fn has_claim(&self, claim: &str) -> bool {
        self.claims.contains_key(claim)
    }

    /// Whether the post publishes this evidence link on this claim.
    pub fn has_link(&self, claim: &str, link: &str) -> bool {
        self.claims
            .get(claim)
            .is_some_and(|links| links.contains(link))
    }

    /// Whether the post cites, or its published evidence uses, this source.
    pub fn has_source(&self, source: &str) -> bool {
        self.sources.contains(source)
    }

    /// Whether each reference the reader named is published here. A
    /// reference that is not published is shown as such and nothing more;
    /// it never says whether something private has that id.
    pub fn check(&self, offer: &EvidenceOffer) -> ReferenceReport {
        let status = |published: bool| {
            if published {
                ReferenceStatus::Published
            } else {
                ReferenceStatus::NotPublished
            }
        };
        let claim = offer.claim.as_deref();
        ReferenceReport {
            claim: claim.map(|claim| status(self.has_claim(claim))),
            evidence_link: offer
                .evidence_link
                .as_deref()
                .map(|link| status(claim.is_some_and(|claim| self.has_link(claim, link)))),
            citation: offer
                .citation
                .as_deref()
                .map(|source| status(self.has_source(source))),
            source: offer
                .source
                .as_deref()
                .map(|source| status(self.has_source(source))),
        }
    }
}

/// Whether a reference a reader named is part of the post's public output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceStatus {
    Published,
    /// Not published on this post now: mistyped, withdrawn since, or never
    /// public. Which of these is never said.
    NotPublished,
}

/// The status of each reference an offer names; `None` where it names none.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReferenceReport {
    pub claim: Option<ReferenceStatus>,
    pub evidence_link: Option<ReferenceStatus>,
    pub citation: Option<ReferenceStatus>,
    pub source: Option<ReferenceStatus>,
}

impl ReferenceReport {
    /// Whether some named reference is no longer (or was never) published:
    /// a stale claim or citation target.
    pub fn any_unpublished(&self) -> bool {
        [self.claim, self.evidence_link, self.citation, self.source]
            .contains(&Some(ReferenceStatus::NotPublished))
    }
}

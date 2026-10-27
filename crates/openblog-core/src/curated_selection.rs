//! Curated public-research selection: the author's explicit, revision-aware
//! choice of which already-publishable research context readers are given
//! (#192, ADR 0215-0220).
//!
//! A selection is one more projection under the publication boundary, never
//! a second one. It adds no approval of its own to research the other
//! projections withhold: it can only select what [`PublicAtlas`],
//! [`PublicComparisons`] and the source library's public description
//! ([`public_reference`]) already publish, and from the selected item only
//! the fields the author lists. The two things a selection can add are
//! text the author writes for it (a source annotation or an explanation,
//! attributed to a named person) and the choice itself. Private notes,
//! rights notes, notebook passages and every unapproved field have no place
//! in these types, so curation cannot publish them.
//!
//! Provenance is only ever copied: a relationship keeps who asserts it, on
//! what evidence, with what confidence and who disputes it; a selection
//! records where imported metadata came from only when the author said so
//! (`unrecorded` otherwise). A missing detail is listed as missing, never
//! filled in.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::atlas_publication::{PublicAtlas, PublicEvidence, PublicParty, PublicSource};
use crate::citations::{format_reference, public_identifier, public_reference, public_url_problem};
use crate::comparison_publication::{
    PublicComparison, PublicComparisons, MAX_PUBLIC_EXCERPT_CHARS,
};
use crate::knowledge_atlas::Atlas;
use crate::source_library::SourceLibrary;

/// The private file's version.
pub const SELECTIONS_VERSION: u64 = 1;
/// Names the public artifact; it has no `version` key, so it is never
/// mistaken for the private selections file.
pub const CURATED_FORMAT: &str = "openblog-curated-context";
/// The only public curated-context format version this release writes.
pub const CURATED_FORMAT_VERSION: u64 = 1;
/// The private file, relative to the project root.
pub const SELECTIONS_FILE: &str = ".openblog/private/research/selections.json";
/// The longest annotation or explanation, in characters: a comment, never a
/// republished stretch of a source.
pub const MAX_TEXT_CHARS: usize = MAX_PUBLIC_EXCERPT_CHARS;
/// The most selections one file holds.
pub const MAX_SELECTIONS: usize = 5_000;

const MAX_ID: usize = 64;
const MAX_TARGET: usize = 120;
const MAX_SHORT: usize = 200;

// ---------------------------------------------------------------- the records

/// What a selection selects. The distinctions of the research model survive:
/// a reference is a source's public description, never a citation of it; an
/// annotation is attributed commentary on a source, never a note; an
/// explanation is attributed prose about a contextual entry, never a claim.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionKind {
    /// A source of the library, by its public description.
    Reference,
    /// An approved, published atlas entry.
    ContextualEntry,
    /// A published atlas relationship, with its endpoints and evidence.
    Relationship,
    /// One published dating, with who dates it and on what evidence.
    Timeline,
    /// A published passage comparison.
    Comparison,
    /// The author's attributed text about a source.
    SourceAnnotation,
    /// The author's attributed text about a published entry.
    Explanation,
}

/// The fields a kind of selection may list.
struct Spec {
    /// Always part of the published item; not listed in `fields`.
    identity: &'static [&'static str],
    /// Listed in every selection of the kind: attribution, uncertainty and
    /// evidence cannot be left out of what readers are given.
    required: &'static [&'static str],
    /// Listed only when the author chooses them.
    optional: &'static [&'static str],
}

impl SelectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reference => "reference",
            Self::ContextualEntry => "contextual-entry",
            Self::Relationship => "relationship",
            Self::Timeline => "timeline",
            Self::Comparison => "comparison",
            Self::SourceAnnotation => "source-annotation",
            Self::Explanation => "explanation",
        }
    }

    fn spec(self) -> Spec {
        match self {
            Self::Reference => Spec {
                identity: &["key", "kind"],
                required: &["creators", "title"],
                optional: &["csl", "identifiers", "issued", "language"],
            },
            Self::ContextualEntry => Spec {
                identity: &["id", "kind", "label", "url"],
                required: &[],
                optional: &["aliases", "source", "summary"],
            },
            Self::Relationship => Spec {
                identity: &["id", "kind", "from", "to", "label", "inverseLabel"],
                required: &[
                    "assertedBy",
                    "confidence",
                    "contestedBy",
                    "evidence",
                    "standing",
                    "uncertainty",
                ],
                optional: &[],
            },
            Self::Timeline => Spec {
                identity: &["id", "owner", "ownerType", "aspect"],
                required: &[
                    "assertedBy",
                    "confidence",
                    "date",
                    "evidence",
                    "note",
                    "placement",
                    "text",
                ],
                optional: &["endYear", "startYear"],
            },
            Self::Comparison => Spec {
                identity: &["id", "label", "url"],
                required: &[
                    "confidence",
                    "correspondence",
                    "correspondenceLabel",
                    "evidence",
                    "rationale",
                    "recordedBy",
                    "uncertainty",
                    "versions",
                ],
                optional: &["wording"],
            },
            Self::SourceAnnotation | Self::Explanation => Spec {
                identity: &[],
                required: &["by", "text"],
                optional: &["locator"],
            },
        }
    }

    fn has_text(self) -> bool {
        matches!(self, Self::SourceAnnotation | Self::Explanation)
    }
}

/// Whether a selection is live. Withdrawing keeps the record, so the author
/// sees what they withdrew and can select it again.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionState {
    #[default]
    Selected,
    Withdrawn,
}

/// Where the selected metadata came from, as the author states it. Nothing
/// is inferred: a selection with no statement says `unrecorded`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "origin")]
pub enum Provenance {
    Authored,
    Imported {
        from: String,
    },
    #[default]
    Unrecorded,
}

/// One stored selection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    /// Stable identity of the selection, a lowercase slug.
    pub id: String,
    pub kind: SelectionKind,
    /// The id of what is selected: a source key, entry, relationship,
    /// dating or comparison id; for an annotation the source, for an
    /// explanation the entry.
    pub target: String,
    /// The fingerprint of the selected item and its dependencies as the
    /// author saw them when they selected it. It no longer matching makes
    /// the selection stale; it is then withheld until selected again.
    pub revision: String,
    /// The public fields the author selected: every required field of the
    /// kind, and the optional ones chosen.
    pub fields: Vec<String>,
    #[serde(default, skip_serializing_if = "is_default")]
    pub state: SelectionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub withdrawn_reason: Option<String>,
    /// For an annotation or explanation: the words the author approves.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Who the text is attributed to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    /// Where in the source the annotation applies, as the author words it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator: Option<String>,
    #[serde(default, skip_serializing_if = "is_default")]
    pub provenance: Provenance,
    /// Selections that must be published with this one. A cycle, an
    /// unknown id or a withheld requirement withholds this selection.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
    /// Fields this release does not understand, preserved verbatim and
    /// never published.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    *value == T::default()
}

/// The private selections file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionSet {
    pub version: u64,
    pub selections: Vec<Selection>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for SelectionSet {
    fn default() -> Self {
        Self {
            version: SELECTIONS_VERSION,
            selections: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

// ---------------------------------------------------------------- diagnostics of the file

/// What is wrong with a selection record or an attempt to select.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Code {
    InvalidJson,
    UnsupportedVersion,
    TooMany,
    BadId,
    DuplicateId,
    BadTarget,
    BadRevision,
    FieldNotAllowed,
    RequiredFieldMissing,
    TextRequired,
    TextNotAllowed,
    TextTooLong,
    UnsafeText,
    AttributionRequired,
    BadProvenance,
    BadRequires,
    /// An attempt to select something the projections do not publish.
    TargetNotPublished,
    /// An attempt to select a selection that does not exist.
    UnknownSelection,
}

/// A problem with one record, naming its id and field, never its text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub code: Code,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message: String,
}

fn diag(code: Code, id: Option<&str>, field: Option<&str>, message: String) -> Diagnostic {
    Diagnostic {
        code,
        id: id.map(str::to_string),
        field: field.map(str::to_string),
        message,
    }
}

fn safe_slug(text: &str, max: usize) -> bool {
    !text.is_empty()
        && text.len() <= max
        && text
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !text.starts_with('-')
}

fn safe_target(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_TARGET
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'~' | b'-'))
}

fn is_revision(text: &str) -> bool {
    text.len() == 16 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Control and bidirectional-override characters never belong in text a
/// reader is given; plain newlines do.
fn unsafe_char(c: char) -> bool {
    (c.is_control() && c != '\n')
        || matches!(c, '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

fn check_short(
    code: Code,
    id: &str,
    field: &str,
    text: &str,
    max: usize,
    out: &mut Vec<Diagnostic>,
) {
    if text.trim().is_empty() || text.chars().count() > max || text.chars().any(unsafe_char) {
        out.push(diag(
            code,
            Some(id),
            Some(field),
            format!("Selection `{id}`: `{field}` must be 1 to {max} characters with no control or direction-override characters."),
        ));
    }
}

/// Every problem with one record on its own, against the rules of its kind.
pub fn validate(selection: &Selection) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let id = selection.id.as_str();
    if !safe_slug(id, MAX_ID) {
        out.push(diag(
            Code::BadId,
            None,
            Some("id"),
            "A selection id must be a lowercase slug of at most 64 characters.".into(),
        ));
        return out;
    }
    let kind = selection.kind;
    if !safe_target(&selection.target) {
        out.push(diag(
            Code::BadTarget,
            Some(id),
            Some("target"),
            format!("Selection `{id}`: `target` must be 1 to {MAX_TARGET} letters, digits or `. _ : ~ -`."),
        ));
    }
    if !is_revision(&selection.revision) {
        out.push(diag(
            Code::BadRevision,
            Some(id),
            Some("revision"),
            format!("Selection `{id}`: `revision` must be a 16-digit hex fingerprint recorded when the item was selected."),
        ));
    }
    let spec = kind.spec();
    let allowed: BTreeSet<&str> = spec.required.iter().chain(spec.optional).copied().collect();
    let listed: BTreeSet<&str> = selection.fields.iter().map(String::as_str).collect();
    for field in &listed {
        if !allowed.contains(field) {
            out.push(diag(
                Code::FieldNotAllowed,
                Some(id),
                Some(field),
                format!(
                    "Selection `{id}`: `{field}` is not a field a {} selection can publish.",
                    kind.as_str()
                ),
            ));
        }
    }
    for field in spec.required {
        if !listed.contains(field) {
            out.push(diag(
                Code::RequiredFieldMissing,
                Some(id),
                Some(field),
                format!("Selection `{id}`: a {} selection always publishes `{field}`, so it must be listed.", kind.as_str()),
            ));
        }
    }
    match (&selection.text, kind.has_text()) {
        (Some(text), true) => {
            check_short(Code::UnsafeText, id, "text", text, MAX_TEXT_CHARS, &mut out);
            if text.chars().count() > MAX_TEXT_CHARS {
                out.push(diag(
                    Code::TextTooLong,
                    Some(id),
                    Some("text"),
                    format!("Selection `{id}`: `text` is longer than {MAX_TEXT_CHARS} characters; a source's own words belong in a rights-gated comparison."),
                ));
            }
        }
        (None, true) => out.push(diag(
            Code::TextRequired,
            Some(id),
            Some("text"),
            format!("Selection `{id}`: a {} needs the words the author approves.", kind.as_str()),
        )),
        (Some(_), false) => out.push(diag(
            Code::TextNotAllowed,
            Some(id),
            Some("text"),
            format!("Selection `{id}`: only an annotation or an explanation carries text; other kinds publish the approved item's own fields."),
        )),
        (None, false) => {}
    }
    if kind.has_text() {
        match &selection.by {
            Some(by) => check_short(Code::AttributionRequired, id, "by", by, MAX_SHORT, &mut out),
            None => out.push(diag(
                Code::AttributionRequired,
                Some(id),
                Some("by"),
                format!("Selection `{id}`: text is always attributed; `by` names who wrote it."),
            )),
        }
        if let Some(locator) = &selection.locator {
            check_short(
                Code::UnsafeText,
                id,
                "locator",
                locator,
                MAX_SHORT,
                &mut out,
            );
        }
    } else if selection.by.is_some() || selection.locator.is_some() {
        out.push(diag(
            Code::TextNotAllowed,
            Some(id),
            Some("by"),
            format!(
                "Selection `{id}`: `by` and `locator` belong only to an annotation or explanation."
            ),
        ));
    }
    if let Provenance::Imported { from } = &selection.provenance {
        check_short(
            Code::BadProvenance,
            id,
            "provenance.from",
            from,
            MAX_SHORT,
            &mut out,
        );
    }
    if let Some(reason) = &selection.withdrawn_reason {
        check_short(
            Code::UnsafeText,
            id,
            "withdrawnReason",
            reason,
            500,
            &mut out,
        );
    }
    for required in &selection.requires {
        if required == id || !safe_slug(required, MAX_ID) {
            out.push(diag(
                Code::BadRequires,
                Some(id),
                Some("requires"),
                format!("Selection `{id}`: `requires` names other selections by id, never itself."),
            ));
            break;
        }
    }
    out
}

impl SelectionSet {
    /// Read the private file. Every record is checked; the first problems
    /// are returned together, each naming its record.
    pub fn parse(text: &str) -> Result<Self, Vec<Diagnostic>> {
        let mut set: SelectionSet = serde_json::from_str(text).map_err(|error| {
            vec![diag(
                Code::InvalidJson,
                None,
                None,
                format!(
                    "The selections file is not valid: {}.",
                    first_words(&error.to_string())
                ),
            )]
        })?;
        if set.version != SELECTIONS_VERSION {
            return Err(vec![diag(
                Code::UnsupportedVersion,
                None,
                Some("version"),
                format!("The selections file is version {}; this release reads version {SELECTIONS_VERSION}.", set.version),
            )]);
        }
        if set.selections.len() > MAX_SELECTIONS {
            return Err(vec![diag(
                Code::TooMany,
                None,
                Some("selections"),
                format!("The selections file holds more than {MAX_SELECTIONS} selections."),
            )]);
        }
        let mut out = Vec::new();
        let mut seen = BTreeSet::new();
        for selection in &mut set.selections {
            selection.fields.sort();
            selection.fields.dedup();
            out.extend(validate(selection));
            if !seen.insert(selection.id.clone()) && safe_slug(&selection.id, MAX_ID) {
                out.push(diag(
                    Code::DuplicateId,
                    Some(&selection.id),
                    Some("id"),
                    format!("Selection id `{}` is used more than once.", selection.id),
                ));
            }
        }
        if out.is_empty() {
            set.selections.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(set)
        } else {
            Err(out)
        }
    }

    /// The file as written: records in id order, so saving never reorders
    /// for nothing.
    pub fn to_json(&self) -> String {
        let mut copy = self.clone();
        copy.selections.sort_by(|a, b| a.id.cmp(&b.id));
        let mut text = serde_json::to_string_pretty(&copy).unwrap_or_default();
        text.push('\n');
        text
    }

    pub fn get(&self, id: &str) -> Option<&Selection> {
        self.selections.iter().find(|s| s.id == id)
    }
}

fn first_words(text: &str) -> String {
    // serde_json's message may quote input; keep only the part before it.
    text.split(" at line")
        .next()
        .unwrap_or("")
        .chars()
        .take(80)
        .collect()
}

// ---------------------------------------------------------------- what is publishable

/// The ids of private items that exist, approved or not, so a deleted item
/// is told apart from one that is simply not approved.
#[derive(Clone, Debug, Default)]
pub struct Existing {
    pub entries: BTreeSet<String>,
    pub relationships: BTreeSet<String>,
    pub datings: BTreeSet<String>,
    pub comparisons: BTreeSet<String>,
}

impl Existing {
    pub fn of(atlas: Option<&Atlas>, alignments: Option<&crate::alignment::AlignmentSet>) -> Self {
        let mut existing = Self::default();
        if let Some(atlas) = atlas {
            existing.entries = atlas.entries.iter().map(|e| e.id.clone()).collect();
            existing.relationships = atlas.relationships.iter().map(|r| r.id.clone()).collect();
            existing.datings = atlas
                .all_datings()
                .into_iter()
                .map(|(_, dating)| dating.id.clone())
                .collect();
        }
        if let Some(set) = alignments {
            existing.comparisons = set.alignments.iter().map(|a| a.id.clone()).collect();
        }
        existing
    }
}

/// What selections are resolved against: the values the build already
/// renders, and nothing private.
#[derive(Clone, Copy, Default)]
pub struct Basis<'a> {
    pub atlas: Option<&'a PublicAtlas>,
    pub comparisons: Option<&'a PublicComparisons>,
    pub library: Option<&'a SourceLibrary>,
    pub existing: Option<&'a Existing>,
}

/// Why a selection publishes nothing. Each is a rule, never a judgement.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Why {
    /// The author withdrew it.
    Withdrawn,
    /// What it selects no longer exists.
    TargetMissing,
    /// What it selects exists but its own projection does not publish it
    /// (not approved, or the projection is off).
    NotApproved,
    /// Cannot be told whether it is missing or not approved.
    NotPublished,
    /// What was selected, or something it depends on, changed since.
    Stale,
    /// A source, endpoint or required selection it needs is not there.
    DependencyMissing,
    /// A required selection is itself withheld.
    DependencyWithheld,
    /// Its `requires` lead back to it.
    Cycle,
}

/// One selection that publishes nothing, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WithheldSelection {
    pub id: String,
    pub kind: SelectionKind,
    pub target: String,
    pub why: Why,
    /// One sentence naming ids and fields only.
    pub message: String,
}

/// A caveat on a published selection: nothing is blocked.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NoticeCode {
    /// The selected wording is withheld by its version's rights statement
    /// or length, as the comparison's own projection withholds it.
    RightsRestricted,
    /// A web address or identifier of a reference is not published.
    UnsafeUrl,
    PrivateIdentifier,
    /// The author did not say where imported metadata came from.
    ProvenanceUnrecorded,
    /// A selected field the source does not have; it is not invented.
    MissingDetail,
    /// Another dating of the same aspect is published but not selected.
    CompetingUnselected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: String,
    pub code: NoticeCode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub message: String,
}

// ---------------------------------------------------------------- the public projection

/// One published selection, with only the selected fields.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratedItem {
    /// The selection's stable id: the anchor readers and links use.
    pub id: String,
    pub kind: SelectionKind,
    pub target: String,
    /// The revision that was selected, which is the one published.
    pub revision: String,
    /// The item's identity fields and the fields the author selected, as the
    /// projection that publishes it names them.
    pub content: BTreeMap<String, Value>,
    pub provenance: Provenance,
    /// Fields selected that the source lacks. Never filled in.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub missing: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
}

/// What a context item is: the minimum a reader needs to understand an
/// item, never more than the projection that approved it publishes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContextKind {
    Entry,
    Relationship,
    Source,
}

/// An approved dependency of a selected item, included with it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub kind: ContextKind,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// For a source, its public description and plain-text rendering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<PublicSource>,
    /// The selections that need it.
    pub via: Vec<String>,
}

/// The curated projection every public representation of curated context
/// reads (#197 renders it).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCuration {
    pub format: &'static str,
    pub format_version: u64,
    /// Sorted by selection id.
    pub items: Vec<CuratedItem>,
    /// Sorted by kind then id; never holds a selected item twice.
    pub context: Vec<ContextItem>,
}

/// The outcome of resolving the selections against what is published.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolution {
    pub curation: PublicCuration,
    pub withheld: Vec<WithheldSelection>,
    pub notices: Vec<Notice>,
}

// ---------------------------------------------------------------- evaluation

#[derive(Default)]
struct Deps {
    entries: BTreeSet<String>,
    relationships: BTreeSet<String>,
    sources: BTreeSet<String>,
}

struct Evaluated {
    value: Value,
    deps: Deps,
    revision: String,
    notices: Vec<(NoticeCode, Option<String>, String)>,
    missing: Vec<String>,
}

fn fnv(parts: &[String]) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for part in parts {
        for byte in part.bytes().chain([0xff]) {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

fn json<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn party_source(party: &PublicParty, deps: &mut Deps) {
    if let Some(source) = &party.source {
        deps.sources.insert(source.clone());
    }
}

fn evidence_sources(evidence: &[PublicEvidence], deps: &mut Deps) {
    for item in evidence {
        deps.sources.insert(item.source.clone());
    }
}

fn source_public(basis: &Basis<'_>, id: &str) -> Option<PublicSource> {
    let record = basis.library?.get(id)?;
    let reference = public_reference(record);
    let text = format_reference(&reference);
    Some(PublicSource { reference, text })
}

type Failure = (Why, String);

fn not_published(basis: &Basis<'_>, kind: SelectionKind, sel: &Selection) -> Failure {
    let (id, kind_name) = (&sel.target, kind.as_str());
    let existing = basis.existing.map(|e| match kind {
        SelectionKind::ContextualEntry | SelectionKind::Explanation => e.entries.contains(id),
        SelectionKind::Relationship => e.relationships.contains(id),
        SelectionKind::Timeline => e.datings.contains(id),
        SelectionKind::Comparison => e.comparisons.contains(id),
        SelectionKind::Reference | SelectionKind::SourceAnnotation => {
            basis.library.is_some_and(|l| l.get(id).is_some())
        }
    });
    match existing {
        Some(false) => (
            Why::TargetMissing,
            format!("Selection `{}`: the {kind_name} `{id}` no longer exists.", sel.id),
        ),
        Some(true) => (
            Why::NotApproved,
            format!("Selection `{}`: the {kind_name} `{id}` is not published (not approved, or its projection is off), so it stays private.", sel.id),
        ),
        None => (
            Why::NotPublished,
            format!("Selection `{}`: the {kind_name} `{id}` is not in what the build publishes.", sel.id),
        ),
    }
}

fn evaluate(sel: &Selection, basis: &Basis<'_>) -> Result<Evaluated, Failure> {
    let kind = sel.kind;
    let mut deps = Deps::default();
    let mut notices = Vec::new();
    let mut missing = Vec::new();
    let target = sel.target.as_str();
    let miss = || not_published(basis, kind, sel);
    let entry = |id: &str| {
        basis
            .atlas
            .and_then(|a| a.entries.iter().find(|e| e.id == id))
    };
    let mut value = match kind {
        SelectionKind::Reference => {
            let record = basis.library.and_then(|l| l.get(target)).ok_or_else(miss)?;
            let reference = public_reference(record);
            for identifier in &record.identifiers {
                let field = format!("identifiers.{}", identifier.scheme);
                if !public_identifier(&identifier.scheme, &identifier.value) {
                    notices.push((
                        NoticeCode::PrivateIdentifier,
                        Some(field),
                        format!("Selection `{}`: the `{}` identifier of source `{target}` is not in a public scheme or form, so it is not published.", sel.id, identifier.scheme),
                    ));
                } else if identifier.scheme == "url"
                    && public_url_problem(&identifier.value).is_some()
                {
                    notices.push((
                        NoticeCode::UnsafeUrl,
                        Some(field),
                        format!("Selection `{}`: the web address of source `{target}` is not a public address, so it is not published.", sel.id),
                    ));
                }
            }
            json(&reference)
        }
        SelectionKind::ContextualEntry | SelectionKind::Explanation => {
            let found = entry(target).ok_or_else(miss)?;
            if let Some(source) = &found.source {
                deps.sources.insert(source.clone());
            }
            deps.entries.insert(found.id.clone());
            json(found)
        }
        SelectionKind::Relationship => {
            let found = basis
                .atlas
                .and_then(|a| a.relationship(target))
                .ok_or_else(miss)?;
            deps.entries.insert(found.from.clone());
            deps.entries.insert(found.to.clone());
            party_source(&found.asserted_by, &mut deps);
            evidence_sources(&found.evidence, &mut deps);
            for dissent in &found.contested_by {
                party_source(&dissent.by, &mut deps);
                evidence_sources(&dissent.evidence, &mut deps);
            }
            json(found)
        }
        SelectionKind::Timeline => {
            let found = basis
                .atlas
                .and_then(|a| a.datings.iter().find(|d| d.id == target))
                .ok_or_else(miss)?;
            if let Some(owner) = basis.atlas.and_then(|a| a.relationship(&found.owner)) {
                deps.relationships.insert(owner.id.clone());
                deps.entries.insert(owner.from.clone());
                deps.entries.insert(owner.to.clone());
            } else {
                deps.entries.insert(found.owner.clone());
            }
            if let Some(relative) = &found.date.relative {
                deps.entries.insert(relative.entry.clone());
            }
            party_source(&found.asserted_by, &mut deps);
            evidence_sources(&found.evidence, &mut deps);
            json(found)
        }
        SelectionKind::Comparison => {
            let found: &PublicComparison = basis
                .comparisons
                .and_then(|c| c.comparisons.iter().find(|c| c.id == target))
                .ok_or_else(miss)?;
            party_source(&found.recorded_by, &mut deps);
            evidence_sources(&found.evidence, &mut deps);
            for version in &found.versions {
                deps.sources.insert(version.source.clone());
            }
            json(found)
        }
        SelectionKind::SourceAnnotation => {
            let record = basis.library.and_then(|l| l.get(target)).ok_or_else(miss)?;
            deps.sources.insert(record.id.clone());
            json(&public_reference(record))
        }
    };
    // The text the author approved is part of the item for its revision.
    let subject_json = value.to_string();
    if kind.has_text() {
        let mut map = Map::new();
        map.insert("subject".into(), Value::String(sel.target.clone()));
        for (name, text) in [
            ("text", &sel.text),
            ("by", &sel.by),
            ("locator", &sel.locator),
        ] {
            if let Some(text) = text {
                map.insert(name.into(), Value::String(text.clone()));
            }
        }
        value = Value::Object(map);
    }
    // Dependencies, each checked against what is published.
    let mut parts = vec![subject_json];
    if kind.has_text() {
        parts.push(json(&(&sel.text, &sel.by, &sel.locator)).to_string());
    }
    for id in &deps.entries {
        let found = entry(id).ok_or_else(|| {
            (
                Why::DependencyMissing,
                format!(
                    "Selection `{}`: the entry `{id}` it needs is not published.",
                    sel.id
                ),
            )
        })?;
        parts.push(json(found).to_string());
    }
    for id in &deps.relationships {
        let found = basis
            .atlas
            .and_then(|a| a.relationship(id))
            .ok_or_else(|| {
                (
                    Why::DependencyMissing,
                    format!(
                        "Selection `{}`: the relationship `{id}` it needs is not published.",
                        sel.id
                    ),
                )
            })?;
        parts.push(json(found).to_string());
    }
    for id in &deps.sources {
        let found = source_public(basis, id).ok_or_else(|| {
            (
                Why::DependencyMissing,
                format!(
                    "Selection `{}`: the source `{id}` it needs is not in the source library.",
                    sel.id
                ),
            )
        })?;
        parts.push(json(&found).to_string());
    }
    let revision = fnv(&parts);
    // Keep identity and the selected fields; list what the source lacks.
    let spec = kind.spec();
    if let Value::Object(map) = &mut value {
        let selected: BTreeSet<&str> = sel.fields.iter().map(String::as_str).collect();
        if !kind.has_text() {
            // A reference or entry that lacks a selected field is told so;
            // for the other kinds an absent list (no dissent, no doubt) is
            // an answer, not a gap.
            if matches!(
                kind,
                SelectionKind::Reference | SelectionKind::ContextualEntry
            ) {
                for field in &sel.fields {
                    if !map.contains_key(field.as_str()) {
                        missing.push(field.clone());
                    }
                }
            }
            map.retain(|name, _| {
                spec.identity.contains(&name.as_str()) || selected.contains(name.as_str())
            });
        }
        if kind == SelectionKind::Comparison && !selected.contains("wording") {
            strip_wording(map);
        }
        if kind == SelectionKind::Comparison && selected.contains("wording") {
            note_withheld_wording(sel, map, &mut notices);
        }
    }
    if sel.provenance == Provenance::Unrecorded && kind == SelectionKind::Reference {
        notices.push((
            NoticeCode::ProvenanceUnrecorded,
            Some("provenance".into()),
            format!("Selection `{}`: where this metadata came from is not recorded, and is published as unrecorded.", sel.id),
        ));
    }
    for field in &missing {
        notices.push((
            NoticeCode::MissingDetail,
            Some(field.clone()),
            format!("Selection `{}`: `{field}` is selected but the source has none; it is left out, not invented.", sel.id),
        ));
    }
    Ok(Evaluated {
        value,
        deps,
        revision,
        notices,
        missing,
    })
}

fn strip_wording(map: &mut Map<String, Value>) {
    if let Some(Value::Array(versions)) = map.get_mut("versions") {
        for version in versions {
            if let Some(Value::Array(places)) = version.get_mut("places") {
                for place in places {
                    if let Value::Object(place) = place {
                        place.remove("text");
                        place.remove("normalized");
                        place.remove("withheld");
                    }
                }
            }
        }
    }
}

fn note_withheld_wording(
    sel: &Selection,
    map: &Map<String, Value>,
    notices: &mut Vec<(NoticeCode, Option<String>, String)>,
) {
    let Some(Value::Array(versions)) = map.get("versions") else {
        return;
    };
    for (v, version) in versions.iter().enumerate() {
        let Some(Value::Array(places)) = version.get("places") else {
            continue;
        };
        for (p, place) in places.iter().enumerate() {
            if place.get("withheld").is_some() {
                notices.push((
                    NoticeCode::RightsRestricted,
                    Some(format!("versions[{v}].places[{p}].text")),
                    format!("Selection `{}`: the wording of versions[{v}].places[{p}] is identified and located but not shown, as its version's rights statement and the excerpt limit require.", sel.id),
                ));
            }
        }
    }
}

// ---------------------------------------------------------------- resolution

/// Resolve every selection against what the build publishes. Each failure
/// is scoped to its selection: the others are resolved on their own, and
/// nothing is changed. Output is deterministic (selection id order).
pub fn resolve(set: &SelectionSet, basis: &Basis<'_>) -> Resolution {
    let mut evaluated: BTreeMap<&str, Evaluated> = BTreeMap::new();
    let mut failed: BTreeMap<&str, Failure> = BTreeMap::new();
    for sel in &set.selections {
        if sel.state == SelectionState::Withdrawn {
            failed.insert(
                &sel.id,
                (
                    Why::Withdrawn,
                    format!(
                        "Selection `{}` is withdrawn, so it publishes nothing.",
                        sel.id
                    ),
                ),
            );
            continue;
        }
        match evaluate(sel, basis) {
            Ok(done) if done.revision != sel.revision => {
                failed.insert(
                    &sel.id,
                    (
                        Why::Stale,
                        format!("Selection `{}` was selected before the {} `{}` or something it depends on changed. Check it, then select it again to publish it as it now stands.", sel.id, sel.kind.as_str(), sel.target),
                    ),
                );
            }
            Ok(done) => {
                evaluated.insert(&sel.id, done);
            }
            Err(failure) => {
                failed.insert(&sel.id, failure);
            }
        }
    }
    // Requirements: cycles first, then a withheld or missing requirement.
    let ids: BTreeSet<&str> = set.selections.iter().map(|s| s.id.as_str()).collect();
    let by_id: BTreeMap<&str, &Selection> =
        set.selections.iter().map(|s| (s.id.as_str(), s)).collect();
    for id in cycle_members(set) {
        if let Some(sel) = by_id.get(id.as_str()) {
            evaluated.remove(sel.id.as_str());
            failed.entry(&sel.id).or_insert((
                Why::Cycle,
                format!(
                    "Selection `{}` requires selections that lead back to it.",
                    sel.id
                ),
            ));
        }
    }
    loop {
        let mut changed = false;
        for sel in &set.selections {
            if !evaluated.contains_key(sel.id.as_str()) {
                continue;
            }
            for required in &sel.requires {
                let problem = if !ids.contains(required.as_str()) {
                    Some((
                        Why::DependencyMissing,
                        format!(
                            "Selection `{}` requires `{required}`, which is not a selection.",
                            sel.id
                        ),
                    ))
                } else if !evaluated.contains_key(required.as_str()) {
                    Some((
                        Why::DependencyWithheld,
                        format!(
                            "Selection `{}` requires `{required}`, which is withheld.",
                            sel.id
                        ),
                    ))
                } else {
                    None
                };
                if let Some(problem) = problem {
                    evaluated.remove(sel.id.as_str());
                    failed.insert(&sel.id, problem);
                    changed = true;
                    break;
                }
            }
        }
        if !changed {
            break;
        }
    }

    let mut items = Vec::new();
    let mut notices = Vec::new();
    let mut context: BTreeMap<(ContextKind, String), BTreeSet<String>> = BTreeMap::new();
    for sel in &set.selections {
        let Some(done) = evaluated.get(sel.id.as_str()) else {
            continue;
        };
        let Value::Object(map) = &done.value else {
            continue;
        };
        items.push(CuratedItem {
            id: sel.id.clone(),
            kind: sel.kind,
            target: sel.target.clone(),
            revision: sel.revision.clone(),
            content: map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            provenance: sel.provenance.clone(),
            missing: done.missing.clone(),
            requires: sel.requires.clone(),
        });
        for (code, field, message) in &done.notices {
            notices.push(Notice {
                id: sel.id.clone(),
                code: *code,
                field: field.clone(),
                message: message.clone(),
            });
        }
        for (kind, found) in [
            (ContextKind::Entry, &done.deps.entries),
            (ContextKind::Relationship, &done.deps.relationships),
            (ContextKind::Source, &done.deps.sources),
        ] {
            for id in found {
                context
                    .entry((kind, id.clone()))
                    .or_default()
                    .insert(sel.id.clone());
            }
        }
    }
    competing_notices(set, basis, &evaluated, &mut notices);
    // A target selected on its own is not repeated as context.
    let selected_targets: BTreeSet<(ContextKind, &str)> = set
        .selections
        .iter()
        .filter(|s| evaluated.contains_key(s.id.as_str()))
        .filter_map(|s| match s.kind {
            SelectionKind::Reference => Some((ContextKind::Source, s.target.as_str())),
            SelectionKind::ContextualEntry => Some((ContextKind::Entry, s.target.as_str())),
            SelectionKind::Relationship => Some((ContextKind::Relationship, s.target.as_str())),
            _ => None,
        })
        .collect();
    let context = context
        .into_iter()
        .filter(|((kind, id), _)| !selected_targets.contains(&(*kind, id.as_str())))
        .filter_map(|((kind, id), via)| context_item(basis, kind, id, via))
        .collect();
    let withheld = set
        .selections
        .iter()
        .filter_map(|sel| {
            failed
                .get(sel.id.as_str())
                .map(|(why, message)| WithheldSelection {
                    id: sel.id.clone(),
                    kind: sel.kind,
                    target: sel.target.clone(),
                    why: *why,
                    message: message.clone(),
                })
        })
        .collect::<Vec<_>>();
    let mut withheld = withheld;
    withheld.sort_by(|a, b| a.id.cmp(&b.id));
    items.sort_by(|a: &CuratedItem, b| a.id.cmp(&b.id));
    notices.sort_by(|a, b| (&a.id, a.code, &a.field).cmp(&(&b.id, b.code, &b.field)));
    Resolution {
        curation: PublicCuration {
            format: CURATED_FORMAT,
            format_version: CURATED_FORMAT_VERSION,
            items,
            context,
        },
        withheld,
        notices,
    }
}

fn context_item(
    basis: &Basis<'_>,
    kind: ContextKind,
    id: String,
    via: BTreeSet<String>,
) -> Option<ContextItem> {
    let via: Vec<String> = via.into_iter().collect();
    match kind {
        ContextKind::Entry => {
            let entry = basis.atlas?.entries.iter().find(|e| e.id == id)?;
            Some(ContextItem {
                kind,
                label: Some(entry.label.clone()),
                url: Some(entry.url.clone()),
                id,
                source: None,
                via,
            })
        }
        ContextKind::Relationship => {
            let relationship = basis.atlas?.relationship(&id)?;
            Some(ContextItem {
                kind,
                label: Some(format!(
                    "{} {} {}",
                    relationship.from, relationship.label, relationship.to
                )),
                url: None,
                id,
                source: None,
                via,
            })
        }
        ContextKind::Source => {
            let source = source_public(basis, &id)?;
            Some(ContextItem {
                kind,
                label: source.reference.title.clone(),
                url: None,
                id,
                source: Some(source),
                via,
            })
        }
    }
}

/// Other published datings of a selected dating's aspect that are not
/// themselves selected: the reader would see one side of a disagreement.
fn competing_notices(
    set: &SelectionSet,
    basis: &Basis<'_>,
    evaluated: &BTreeMap<&str, Evaluated>,
    notices: &mut Vec<Notice>,
) {
    let Some(atlas) = basis.atlas else { return };
    let selected: BTreeSet<&str> = set
        .selections
        .iter()
        .filter(|s| s.kind == SelectionKind::Timeline && evaluated.contains_key(s.id.as_str()))
        .map(|s| s.target.as_str())
        .collect();
    for sel in set
        .selections
        .iter()
        .filter(|s| s.kind == SelectionKind::Timeline && evaluated.contains_key(s.id.as_str()))
    {
        let Some(own) = atlas.datings.iter().find(|d| d.id == sel.target) else {
            continue;
        };
        let rivals: Vec<&str> = atlas
            .datings
            .iter()
            .filter(|d| d.owner == own.owner && d.aspect == own.aspect && d.id != own.id)
            .map(|d| d.id.as_str())
            .filter(|id| !selected.contains(id))
            .collect();
        if !rivals.is_empty() {
            notices.push(Notice {
                id: sel.id.clone(),
                code: NoticeCode::CompetingUnselected,
                field: None,
                message: format!(
                    "Selection `{}`: competing datings of the same aspect are published but not selected: {}.",
                    sel.id,
                    rivals.join(", ")
                ),
            });
        }
    }
}

/// The ids of every selection that is on a cycle of `requires`.
fn cycle_members(set: &SelectionSet) -> BTreeSet<String> {
    let graph: BTreeMap<&str, Vec<&str>> = set
        .selections
        .iter()
        .map(|s| {
            (
                s.id.as_str(),
                s.requires.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    let mut members = BTreeSet::new();
    for start in graph.keys() {
        // Walk from `start`; it is on a cycle when it can reach itself.
        let mut seen = BTreeSet::new();
        let mut stack: Vec<&str> = graph[start].clone();
        while let Some(next) = stack.pop() {
            if next == *start {
                members.insert(start.to_string());
                break;
            }
            if seen.insert(next) {
                if let Some(more) = graph.get(next) {
                    stack.extend(more.iter().copied());
                }
            }
        }
    }
    members
}

// ---------------------------------------------------------------- select and unselect

/// What the author chooses when they select something.
#[derive(Clone, Debug, Default)]
pub struct NewSelection {
    /// The selection's id; derived from the kind and target when absent.
    pub id: Option<String>,
    pub kind: Option<SelectionKind>,
    pub target: String,
    /// The optional fields chosen; every required field is always listed.
    pub optional_fields: Vec<String>,
    pub text: Option<String>,
    pub by: Option<String>,
    pub locator: Option<String>,
    pub provenance: Provenance,
    pub requires: Vec<String>,
}

fn derived_id(kind: SelectionKind, target: &str) -> String {
    let mut id = format!("{}-{}", kind.as_str(), target.to_ascii_lowercase());
    id = id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    id.truncate(MAX_ID);
    id.trim_end_matches('-').to_string()
}

impl SelectionSet {
    /// Select an item the build publishes. Refuses, naming the id, anything
    /// the projections do not publish: selecting never approves. The new
    /// record carries the revision as it stands now.
    pub fn select(
        &mut self,
        new: NewSelection,
        basis: &Basis<'_>,
    ) -> Result<String, Vec<Diagnostic>> {
        let kind = new.kind.ok_or_else(|| {
            vec![diag(
                Code::BadTarget,
                None,
                Some("kind"),
                "A selection needs a kind.".into(),
            )]
        })?;
        let id = new
            .id
            .clone()
            .unwrap_or_else(|| derived_id(kind, &new.target));
        if self.get(&id).is_some() {
            return Err(vec![diag(
                Code::DuplicateId,
                Some(&id),
                Some("id"),
                format!("Selection `{id}` already exists; select it again to refresh it, or unselect it first."),
            )]);
        }
        let spec = kind.spec();
        let mut fields: Vec<String> = spec.required.iter().map(|f| f.to_string()).collect();
        fields.extend(new.optional_fields);
        fields.sort();
        fields.dedup();
        let mut selection = Selection {
            id: id.clone(),
            kind,
            target: new.target,
            revision: "0".repeat(16),
            fields,
            state: SelectionState::Selected,
            withdrawn_reason: None,
            text: new.text,
            by: new.by,
            locator: new.locator,
            provenance: new.provenance,
            requires: new.requires,
            extra: BTreeMap::new(),
        };
        let problems = validate(&selection);
        if !problems.is_empty() {
            return Err(problems);
        }
        match evaluate(&selection, basis) {
            Ok(done) => selection.revision = done.revision,
            Err((_, message)) => {
                return Err(vec![diag(
                    Code::TargetNotPublished,
                    Some(&id),
                    Some("target"),
                    message,
                )])
            }
        }
        if self.selections.len() >= MAX_SELECTIONS {
            return Err(vec![diag(
                Code::TooMany,
                None,
                None,
                format!("A selections file holds at most {MAX_SELECTIONS} selections."),
            )]);
        }
        self.selections.push(selection);
        self.selections.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(id)
    }

    /// Record the revision as it stands now and make the selection live
    /// again: the author's "checked, publish it as it is now".
    pub fn reselect(&mut self, id: &str, basis: &Basis<'_>) -> Result<(), Vec<Diagnostic>> {
        let selection = self
            .selections
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| {
                vec![diag(
                    Code::UnknownSelection,
                    Some(id),
                    None,
                    format!("There is no selection `{id}`."),
                )]
            })?;
        match evaluate(selection, basis) {
            Ok(done) => {
                selection.revision = done.revision;
                selection.state = SelectionState::Selected;
                selection.withdrawn_reason = None;
                Ok(())
            }
            Err((_, message)) => Err(vec![diag(
                Code::TargetNotPublished,
                Some(id),
                Some("target"),
                message,
            )]),
        }
    }

    /// Withdraw a selection, keeping the record. Returns whether it exists.
    pub fn withdraw(&mut self, id: &str, reason: Option<String>) -> bool {
        match self.selections.iter_mut().find(|s| s.id == id) {
            Some(selection) => {
                selection.state = SelectionState::Withdrawn;
                selection.withdrawn_reason = reason.filter(|r| !r.trim().is_empty());
                true
            }
            None => false,
        }
    }

    /// Remove a selection. The research it selected is untouched. Returns
    /// whether it existed.
    pub fn unselect(&mut self, id: &str) -> bool {
        let before = self.selections.len();
        self.selections.retain(|s| s.id != id);
        self.selections.len() != before
    }
}

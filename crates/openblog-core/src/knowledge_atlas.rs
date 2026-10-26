//! Private Knowledge Atlas: contextual entries (people, works, concepts,
//! movements, events) and attributed relationships between them.
//!
//! Everything here is private author research until a later, explicit
//! publication projection copies what is approved. Validation is offline and
//! structural. Nothing in this module claims that a relationship is true,
//! that scholars agree on it, or that a source is authoritative: a
//! relationship is always one named party's assertion, resting on cited
//! source evidence, and it is never inferred from dates or order.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde_json::{Map, Value};

use crate::research_notes::{
    bidi_override, locator_ambiguity, resolved_kind, Locator, LocatorKind, Notebook,
};
use crate::source_library::{
    valid_source_id, valid_timestamp, ResearchSourceKind, SourceLibrary, LOCATION_SCHEMES,
};

/// The only atlas file version this release reads and writes.
pub const ATLAS_VERSION: u64 = 1;
/// Upper bound on a serialized atlas, checked before JSON parsing and again on
/// the canonical written form.
pub const MAX_ATLAS_BYTES: usize = 4 * 1024 * 1024;
/// Upper bound on entries, and separately on relationships, in one atlas.
pub const MAX_ENTRIES: usize = 10_000;
pub const MAX_RELATIONSHIPS: usize = 50_000;
const MAX_SUMMARY_CHARS: usize = 20_000;
const MAX_UNCERTAINTY_CHARS: usize = 2_000;
const MAX_SHORT_CHARS: usize = 200;
const MAX_ALIASES: usize = 20;
const MAX_EVIDENCE: usize = 20;
const MAX_DISSENTS: usize = 20;
const MAX_LOCATORS: usize = 8;
const CREDIT_FIELDS: &[&str] = &["credit", "credits", "contributor", "contributors"];

const ATLAS_FIELDS: &[&str] = &["version", "entries", "relationships"];

/// Whether an entry or relationship may be copied into a public projection.
/// `Private` is the default and is written explicitly; `Approved` is the
/// author's recorded consent that the publication projection may include it.
/// The projection, not this module, does the copying.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Private,
    Approved,
}

/// What an entry is. Kinds keep their own meaning: each relationship kind
/// names which entry kinds it may join, so a person is never a work.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Person,
    Work,
    Concept,
    Movement,
    Event,
}

impl EntryKind {
    pub const ALL: [Self; 5] = [
        Self::Person,
        Self::Work,
        Self::Concept,
        Self::Movement,
        Self::Event,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Work => "work",
            Self::Concept => "concept",
            Self::Movement => "movement",
            Self::Event => "event",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// The closed set of relationship kinds. There is deliberately no "preceded",
/// "contemporary of" or similar: order in time is never a relationship, and
/// dated structure belongs to the chronology contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RelationshipKind {
    Authored,
    Influenced,
    RespondsTo,
    Disputes,
    MemberOf,
    ParticipatedIn,
    Developed,
    Exemplifies,
    Discusses,
    PartOf,
    Specializes,
    RelatedTo,
}

use EntryKind as K;

struct KindSpec {
    name: &'static str,
    /// How the edge reads from its target back to its source.
    inverse: &'static str,
    from: &'static [EntryKind],
    to: &'static [EntryKind],
    /// The edge reads the same both ways.
    symmetric: bool,
    /// Both ends must be the same kind of entry.
    same_kind: bool,
    /// Containment: a cycle is a contradiction, not a finding.
    acyclic: bool,
}

const ANY: &[EntryKind] = &EntryKind::ALL;

impl RelationshipKind {
    pub const ALL: [Self; 12] = [
        Self::Authored,
        Self::Influenced,
        Self::RespondsTo,
        Self::Disputes,
        Self::MemberOf,
        Self::ParticipatedIn,
        Self::Developed,
        Self::Exemplifies,
        Self::Discusses,
        Self::PartOf,
        Self::Specializes,
        Self::RelatedTo,
    ];

    fn spec(self) -> KindSpec {
        let (name, inverse, from, to, symmetric, same_kind, acyclic): (
            _,
            _,
            &'static [EntryKind],
            &'static [EntryKind],
            _,
            _,
            _,
        ) = match self {
            Self::Authored => (
                "authored",
                "authored by",
                &[K::Person],
                &[K::Work],
                false,
                false,
                false,
            ),
            Self::Influenced => (
                "influenced",
                "influenced by",
                ANY,
                ANY,
                false,
                false,
                false,
            ),
            Self::RespondsTo => (
                "responds-to",
                "answered by",
                &[K::Person, K::Work],
                &[K::Person, K::Work, K::Movement, K::Concept, K::Event],
                false,
                false,
                false,
            ),
            Self::Disputes => (
                "disputes",
                "disputed by",
                &[K::Person, K::Work, K::Movement],
                &[K::Person, K::Work, K::Movement, K::Concept],
                false,
                false,
                false,
            ),
            Self::MemberOf => (
                "member-of",
                "has member",
                &[K::Person],
                &[K::Movement],
                false,
                false,
                false,
            ),
            Self::ParticipatedIn => (
                "participated-in",
                "had participant",
                &[K::Person, K::Movement],
                &[K::Event],
                false,
                false,
                false,
            ),
            Self::Developed => (
                "developed",
                "developed by",
                &[K::Person, K::Movement],
                &[K::Concept],
                false,
                false,
                false,
            ),
            Self::Exemplifies => (
                "exemplifies",
                "exemplified by",
                &[K::Work],
                &[K::Concept, K::Movement],
                false,
                false,
                false,
            ),
            Self::Discusses => (
                "discusses",
                "discussed in",
                &[K::Work],
                ANY,
                false,
                false,
                false,
            ),
            Self::PartOf => (
                "part-of",
                "has part",
                &[K::Work, K::Concept, K::Movement, K::Event],
                &[K::Work, K::Concept, K::Movement, K::Event],
                false,
                true,
                true,
            ),
            Self::Specializes => (
                "specializes",
                "generalized by",
                &[K::Concept],
                &[K::Concept],
                false,
                false,
                true,
            ),
            Self::RelatedTo => ("related-to", "related to", ANY, ANY, true, false, false),
        };
        KindSpec {
            name,
            inverse,
            from,
            to,
            symmetric,
            same_kind,
            acyclic,
        }
    }

    pub fn as_str(self) -> &'static str {
        self.spec().name
    }

    /// How the relationship reads from its target back to its source. The
    /// stored edge is never mirrored: a reverse edge exists only when someone
    /// asserts it.
    pub fn inverse_label(self) -> &'static str {
        self.spec().inverse
    }

    /// Whether the edge reads the same in both directions.
    pub fn is_symmetric(self) -> bool {
        self.spec().symmetric
    }

    /// Whether a cycle of this kind is refused.
    pub fn is_acyclic(self) -> bool {
        self.spec().acyclic
    }

    pub fn from_kinds(self) -> &'static [EntryKind] {
        self.spec().from
    }

    pub fn to_kinds(self) -> &'static [EntryKind] {
        self.spec().to
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == value)
    }
}

/// How firmly the asserting party holds the relationship. A label on the
/// assertion, never a measure of how widely it is accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Tentative,
    Plausible,
    Strong,
}

impl Confidence {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "tentative" => Some(Self::Tentative),
            "plausible" => Some(Self::Plausible),
            "strong" => Some(Self::Strong),
            _ => None,
        }
    }
}

/// How an asserting or dissenting party is identified.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AttributionKind {
    /// The site author's own reading.
    Author,
    /// A source-library record that makes the claim.
    Source,
    /// A named person or group that is not in the source library.
    Named,
}

/// Who holds a position. Separate from evidence: an author may assert on the
/// strength of a passage in a source that never says so itself.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Attribution {
    pub kind: AttributionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Attribution {
    pub fn author() -> Self {
        Self {
            kind: AttributionKind::Author,
            source: None,
            name: None,
            extra: BTreeMap::new(),
        }
    }
}

/// Where in the source library, and where inside it, a relationship rests.
/// Source ids and locators are exactly those of the library and notebook.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Evidence {
    pub source: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub locators: Vec<Locator>,
    /// A private notebook passage this evidence was taken from. Never part of
    /// anything approved: an approved relationship may not carry one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passage: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A recorded disagreement with a relationship, attributed like any assertion.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Dissent {
    pub by: Attribution,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<Evidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A coarse range of astronomical-free calendar years (negative is BCE, there
/// is no year 0). Authored context only: nothing here orders or relates
/// entries, and richer, cited and uncertain dates are a separate contract.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Bounds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<i32>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A contextual entry: one person, work, concept, movement, or event.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Entry {
    /// Immutable identity, a lowercase slug unique across entries and
    /// relationships. A concept entry's id is what notebook notes link to.
    pub id: String,
    pub kind: EntryKind,
    pub label: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// The author's own prose about the entry, never a quotation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Only on a work: the source-library work record it stands for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Bounds>,
    pub visibility: Visibility,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// One asserted, directed relationship.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Relationship {
    pub id: String,
    pub kind: RelationshipKind,
    pub from: String,
    pub to: String,
    #[serde(rename = "assertedBy")]
    pub asserted_by: Attribution,
    pub confidence: Confidence,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<Evidence>,
    /// The explicit draft state for a relationship that cites nothing yet. It
    /// is written only when true, and an unsourced relationship can be neither
    /// strong nor approved.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unsourced: bool,
    /// The author's note on what is doubtful or unsettled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncertainty: Option<String>,
    #[serde(rename = "contestedBy", skip_serializing_if = "Vec::is_empty")]
    pub contested_by: Vec<Dissent>,
    pub visibility: Visibility,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// How a relationship stands. There is no value for agreement or consensus:
/// the most a relationship can be is asserted by someone, and it is contested
/// as soon as anyone is recorded as disagreeing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standing {
    Asserted,
    Contested,
}

impl Relationship {
    pub fn standing(&self) -> Standing {
        if self.contested_by.is_empty() {
            Standing::Asserted
        } else {
            Standing::Contested
        }
    }
}

/// The private atlas document.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Atlas {
    pub version: u64,
    pub entries: Vec<Entry>,
    pub relationships: Vec<Relationship>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for Atlas {
    fn default() -> Self {
        Self {
            version: ATLAS_VERSION,
            entries: Vec::new(),
            relationships: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

/// What the atlas resolves identifiers against. The notebook may be empty.
#[derive(Clone, Copy)]
pub struct Links<'a> {
    pub library: &'a SourceLibrary,
    pub notebook: &'a Notebook,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AtlasDiagnosticCode {
    TooLarge,
    InvalidJson,
    UnsupportedVersion,
    MissingField,
    InvalidField,
    InvalidId,
    DuplicateId,
    UnknownEntry,
    UnknownSource,
    UnknownPassage,
    UnknownLocatorKind,
    InvalidLocator,
    AmbiguousLocator,
    UnknownKind,
    EndpointKind,
    WrongSourceKind,
    SelfRelationship,
    DuplicateRelationship,
    Cycle,
    MissingEvidence,
    EvidenceConflict,
    InvalidVisibility,
    PrivateEndpoint,
    PrivateReference,
    ContributorCredit,
    StillLinked,
    ShadowedField,
}

impl fmt::Display for AtlasDiagnosticCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = serde_json::to_value(self)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        formatter.write_str(&text)
    }
}

/// A problem scoped to the atlas, one entry or relationship, or one field.
/// Messages never repeat authored text.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasDiagnostic {
    pub code: AtlasDiagnosticCode,
    /// `entries`, `relationships`, or `notes` (a notebook note that blocks a removal).
    pub collection: Option<&'static str>,
    pub index: Option<usize>,
    pub id: Option<String>,
    /// Field path inside the item, such as `from` or `evidence[1].locators[0].kind`.
    pub field: Option<String>,
    pub message: String,
}

impl fmt::Display for AtlasDiagnostic {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.collection, self.index, &self.id) {
            (Some(c), Some(i), Some(id)) => write!(formatter, "{c}[{i}] `{id}`")?,
            (Some(c), Some(i), None) => write!(formatter, "{c}[{i}]")?,
            (Some(c), None, Some(id)) => write!(formatter, "{c} `{id}`")?,
            _ => formatter.write_str("knowledge atlas")?,
        }
        if let Some(field) = &self.field {
            write!(formatter, " {field}")?;
        }
        write!(formatter, ": {} ({})", self.message, self.code)
    }
}

fn atlas_diagnostic(
    code: AtlasDiagnosticCode,
    field: Option<&str>,
    message: impl Into<String>,
) -> AtlasDiagnostic {
    AtlasDiagnostic {
        code,
        collection: None,
        index: None,
        id: None,
        field: field.map(str::to_string),
        message: message.into(),
    }
}

fn item_diagnostic(
    code: AtlasDiagnosticCode,
    collection: &'static str,
    index: usize,
    id: &str,
    field: &str,
    message: impl Into<String>,
) -> AtlasDiagnostic {
    AtlasDiagnostic {
        code,
        collection: Some(collection),
        index: Some(index),
        id: Some(id.into()),
        field: Some(field.into()),
        message: message.into(),
    }
}

fn too_large() -> AtlasDiagnostic {
    atlas_diagnostic(
        AtlasDiagnosticCode::TooLarge,
        None,
        format!("the atlas is larger than {MAX_ATLAS_BYTES} bytes as read or as written"),
    )
}

/// Field-by-field reader state for one raw item, so each problem names its field.
struct Ctx<'a> {
    collection: &'static str,
    index: usize,
    id: Option<String>,
    diagnostics: &'a mut Vec<AtlasDiagnostic>,
    failed: bool,
}

impl Ctx<'_> {
    fn report(&mut self, code: AtlasDiagnosticCode, field: &str, message: impl Into<String>) {
        self.failed = true;
        self.diagnostics.push(AtlasDiagnostic {
            code,
            collection: Some(self.collection),
            index: Some(self.index),
            id: self.id.clone(),
            field: Some(field.into()),
            message: message.into(),
        });
    }
}

/// One JSON object being read, with the path used to name its fields.
struct Obj {
    path: String,
    map: Map<String, Value>,
}

fn text_problem(text: &str, max: usize, multiline: bool) -> Option<(AtlasDiagnosticCode, String)> {
    if text.trim().is_empty() {
        Some((
            AtlasDiagnosticCode::InvalidField,
            "must not be empty".into(),
        ))
    } else if text.chars().count() > max {
        Some((
            AtlasDiagnosticCode::TooLarge,
            format!("must be at most {max} characters"),
        ))
    } else if text
        .chars()
        .any(|c| (c.is_control() && !(multiline && (c == '\n' || c == '\t'))) || bidi_override(c))
    {
        Some((
            AtlasDiagnosticCode::InvalidField,
            "must not contain control or bidirectional override characters".into(),
        ))
    } else {
        None
    }
}

impl Obj {
    fn field(&self, key: &str) -> String {
        if self.path.is_empty() {
            key.into()
        } else {
            format!("{}.{key}", self.path)
        }
    }

    fn text(
        &mut self,
        ctx: &mut Ctx<'_>,
        key: &str,
        required: bool,
        max: usize,
        multiline: bool,
    ) -> Option<String> {
        let field = self.field(key);
        match self.map.remove(key) {
            Some(Value::String(text)) => {
                if let Some((code, message)) = text_problem(&text, max, multiline) {
                    ctx.report(code, &field, message);
                }
                Some(text)
            }
            Some(_) => {
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    &field,
                    "must be a string",
                );
                None
            }
            None if required => {
                ctx.report(AtlasDiagnosticCode::MissingField, &field, "is required");
                None
            }
            None => None,
        }
    }

    fn id(&mut self, ctx: &mut Ctx<'_>, key: &str, what: &str, required: bool) -> Option<String> {
        let field = self.field(key);
        match self.map.remove(key) {
            Some(Value::String(value)) if valid_source_id(&value) => Some(value),
            Some(Value::String(_)) => {
                ctx.report(
                    AtlasDiagnosticCode::InvalidId,
                    &field,
                    format!("not a {what}; use a lowercase ASCII slug of at most 64 bytes"),
                );
                None
            }
            Some(_) => {
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    &field,
                    "must be a string",
                );
                None
            }
            None if required => {
                ctx.report(AtlasDiagnosticCode::MissingField, &field, "is required");
                None
            }
            None => None,
        }
    }

    fn flag(&mut self, ctx: &mut Ctx<'_>, key: &str) -> bool {
        match self.map.remove(key) {
            None => false,
            Some(Value::Bool(value)) => value,
            Some(_) => {
                let field = self.field(key);
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    &field,
                    "must be true or false",
                );
                false
            }
        }
    }

    fn object(&mut self, ctx: &mut Ctx<'_>, key: &str, required: bool) -> Option<Obj> {
        let field = self.field(key);
        match self.map.remove(key) {
            Some(Value::Object(map)) => Some(Obj { path: field, map }),
            Some(_) => {
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    &field,
                    "must be an object",
                );
                None
            }
            None if required => {
                ctx.report(AtlasDiagnosticCode::MissingField, &field, "is required");
                None
            }
            None => None,
        }
    }

    fn array(&mut self, ctx: &mut Ctx<'_>, key: &str, max: usize) -> Vec<Value> {
        let field = self.field(key);
        match self.map.remove(key) {
            None => Vec::new(),
            Some(Value::Array(items)) if items.len() <= max => items,
            Some(Value::Array(_)) => {
                ctx.report(
                    AtlasDiagnosticCode::TooLarge,
                    &field,
                    format!("may hold at most {max} items"),
                );
                Vec::new()
            }
            Some(_) => {
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    &field,
                    "must be an array",
                );
                Vec::new()
            }
        }
    }

    fn reject_credits(&mut self, ctx: &mut Ctx<'_>) {
        let found: Vec<String> = self
            .map
            .keys()
            .filter(|key| CREDIT_FIELDS.contains(&key.as_str()))
            .cloned()
            .collect();
        for key in found {
            let field = self.field(&key);
            ctx.report(
                AtlasDiagnosticCode::ContributorCredit,
                &field,
                "contributor credits stay in `.credits.json` sidecars; attribution here names who asserts a relationship, not who is credited",
            );
        }
    }

    fn visibility(&mut self, ctx: &mut Ctx<'_>) -> Visibility {
        match self.map.remove("visibility") {
            None => Visibility::Private,
            Some(Value::String(v)) if v == "private" => Visibility::Private,
            Some(Value::String(v)) if v == "approved" => Visibility::Approved,
            Some(_) => {
                ctx.report(
                    AtlasDiagnosticCode::InvalidVisibility,
                    "visibility",
                    "use `private` (the default) or `approved`",
                );
                Visibility::Private
            }
        }
    }

    fn rest(self) -> BTreeMap<String, Value> {
        self.map.into_iter().collect()
    }
}

fn open<'a>(
    collection: &'static str,
    index: usize,
    raw: Value,
    diagnostics: &'a mut Vec<AtlasDiagnostic>,
) -> Option<(Ctx<'a>, Obj)> {
    let Value::Object(map) = raw else {
        diagnostics.push(AtlasDiagnostic {
            code: AtlasDiagnosticCode::InvalidField,
            collection: Some(collection),
            index: Some(index),
            id: None,
            field: None,
            message: "each item must be a JSON object".into(),
        });
        return None;
    };
    let id = match map.get("id") {
        Some(Value::String(id)) if valid_source_id(id) => Some(id.clone()),
        _ => None,
    };
    Some((
        Ctx {
            collection,
            index,
            id,
            diagnostics,
            failed: false,
        },
        Obj {
            path: String::new(),
            map,
        },
    ))
}

fn parse_entry(
    index: usize,
    raw: Value,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) -> (Option<String>, Option<Entry>) {
    let Some((mut ctx, mut obj)) = open("entries", index, raw, diagnostics) else {
        return (None, None);
    };
    let known = ctx.id.clone();
    let id = obj.id(&mut ctx, "id", "entry identifier", true);
    obj.reject_credits(&mut ctx);
    let visibility = obj.visibility(&mut ctx);
    let kind = match obj.map.remove("kind") {
        Some(Value::String(text)) => {
            let kind = EntryKind::parse(&text);
            if kind.is_none() {
                ctx.report(
                    AtlasDiagnosticCode::UnknownKind,
                    "kind",
                    "use person, work, concept, movement, or event",
                );
            }
            kind
        }
        Some(_) => {
            ctx.report(
                AtlasDiagnosticCode::InvalidField,
                "kind",
                "must be a string",
            );
            None
        }
        None => {
            ctx.report(AtlasDiagnosticCode::MissingField, "kind", "is required");
            None
        }
    };
    let label = obj.text(&mut ctx, "label", true, MAX_SHORT_CHARS, false);
    let summary = obj.text(&mut ctx, "summary", false, MAX_SUMMARY_CHARS, true);
    let mut aliases = Vec::new();
    for (position, item) in obj
        .array(&mut ctx, "aliases", MAX_ALIASES)
        .into_iter()
        .enumerate()
    {
        let field = format!("aliases[{position}]");
        match item {
            Value::String(text) => {
                if let Some((code, message)) = text_problem(&text, MAX_SHORT_CHARS, false) {
                    ctx.report(code, &field, message);
                } else if aliases.contains(&text) {
                    ctx.report(
                        AtlasDiagnosticCode::InvalidField,
                        &field,
                        "repeats an earlier alias",
                    );
                }
                aliases.push(text);
            }
            _ => ctx.report(
                AtlasDiagnosticCode::InvalidField,
                &field,
                "must be a string",
            ),
        }
    }
    let source = obj.id(&mut ctx, "source", "source identifier", false);
    if source.is_some() && kind.is_some_and(|k| k != EntryKind::Work) {
        ctx.report(
            AtlasDiagnosticCode::InvalidField,
            "source",
            "only a work entry may stand for a source-library work",
        );
    }
    let bounds = obj.object(&mut ctx, "bounds", false).map(|mut b| {
        let mut year = |ctx: &mut Ctx<'_>, key: &str| -> Option<i32> {
            let field = b.field(key);
            match b.map.remove(key) {
                None => None,
                Some(Value::Number(n)) => match n.as_i64().and_then(|y| i32::try_from(y).ok()) {
                    Some(y) if y != 0 && (-100_000..=100_000).contains(&y) => Some(y),
                    _ => {
                        ctx.report(
                            AtlasDiagnosticCode::InvalidField,
                            &field,
                            "must be a whole year between -100000 and 100000; negative is BCE and there is no year 0",
                        );
                        None
                    }
                },
                Some(_) => {
                    ctx.report(AtlasDiagnosticCode::InvalidField, &field, "must be a whole year");
                    None
                }
            }
        };
        let from = year(&mut ctx, "from");
        let until = year(&mut ctx, "until");
        if let (Some(f), Some(u)) = (from, until) {
            if f > u {
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    "bounds",
                    "`from` must not be later than `until`",
                );
            }
        }
        Bounds {
            from,
            until,
            extra: b.rest(),
        }
    });
    let failed = ctx.failed;
    let extra = obj.rest();
    match (id, kind, label, failed) {
        (Some(id), Some(kind), Some(label), false) => (
            Some(id.clone()),
            Some(Entry {
                id,
                kind,
                label,
                aliases,
                summary,
                source,
                bounds,
                visibility,
                extra,
            }),
        ),
        (id, ..) => (id.or(known), None),
    }
}

fn parse_attribution(ctx: &mut Ctx<'_>, mut obj: Obj) -> Option<Attribution> {
    let kind_field = obj.field("kind");
    let kind = match obj.map.remove("kind") {
        Some(Value::String(t)) => match t.as_str() {
            "author" => Some(AttributionKind::Author),
            "source" => Some(AttributionKind::Source),
            "named" => Some(AttributionKind::Named),
            _ => {
                ctx.report(
                    AtlasDiagnosticCode::UnknownKind,
                    &kind_field,
                    "use author, source, or named",
                );
                None
            }
        },
        Some(_) => {
            ctx.report(
                AtlasDiagnosticCode::InvalidField,
                &kind_field,
                "must be a string",
            );
            None
        }
        None => {
            ctx.report(
                AtlasDiagnosticCode::MissingField,
                &kind_field,
                "is required",
            );
            None
        }
    }?;
    let source = obj.id(
        ctx,
        "source",
        "source identifier",
        kind == AttributionKind::Source,
    );
    let name = obj.text(
        ctx,
        "name",
        kind == AttributionKind::Named,
        MAX_SHORT_CHARS,
        false,
    );
    for (key, present, wanted) in [
        ("source", source.is_some(), AttributionKind::Source),
        ("name", name.is_some(), AttributionKind::Named),
    ] {
        if present && kind != wanted {
            let field = obj.field(key);
            ctx.report(
                AtlasDiagnosticCode::InvalidField,
                &field,
                "does not belong with this attribution kind",
            );
        }
    }
    Some(Attribution {
        kind,
        source,
        name,
        extra: obj.rest(),
    })
}

fn parse_locator(ctx: &mut Ctx<'_>, path: &str, item: Value) -> Option<Locator> {
    let Value::Object(map) = item else {
        ctx.report(AtlasDiagnosticCode::InvalidField, path, "must be an object");
        return None;
    };
    let mut obj = Obj {
        path: path.into(),
        map,
    };
    let kind_text = obj.text(ctx, "kind", true, 64, false);
    let value = obj.text(ctx, "value", true, MAX_SHORT_CHARS, false);
    let to = obj.text(ctx, "to", false, MAX_SHORT_CHARS, false);
    let kind = kind_text.as_deref().and_then(|text| {
        let kind = LocatorKind::parse(text);
        if kind.is_none() {
            ctx.report(
                AtlasDiagnosticCode::UnknownLocatorKind,
                &format!("{path}.kind"),
                format!(
                    "use one of: {}, or an extension kind such as `x-stephanus`",
                    LOCATION_SCHEMES.join(", ")
                ),
            );
        }
        kind
    })?;
    let value = value?;
    if kind == LocatorKind::Timestamp {
        for (key, text) in [("value", Some(&value)), ("to", to.as_ref())] {
            if text.is_some_and(|t| !valid_timestamp(t)) {
                ctx.report(
                    AtlasDiagnosticCode::InvalidLocator,
                    &format!("{path}.{key}"),
                    "use seconds or `h:mm:ss`, optionally with a decimal fraction",
                );
            }
        }
    }
    Some(Locator {
        kind,
        value,
        to,
        extra: obj.rest(),
    })
}

fn parse_evidence(ctx: &mut Ctx<'_>, path: &str, item: Value) -> Option<Evidence> {
    let Value::Object(map) = item else {
        ctx.report(AtlasDiagnosticCode::InvalidField, path, "must be an object");
        return None;
    };
    let mut obj = Obj {
        path: path.into(),
        map,
    };
    let source = obj.id(ctx, "source", "source identifier", true);
    let passage = obj.id(ctx, "passage", "passage identifier", false);
    let mut locators = Vec::new();
    for (position, raw) in obj
        .array(ctx, "locators", MAX_LOCATORS)
        .into_iter()
        .enumerate()
    {
        locators.extend(parse_locator(
            ctx,
            &format!("{path}.locators[{position}]"),
            raw,
        ));
    }
    Some(Evidence {
        source: source?,
        locators,
        passage,
        extra: obj.rest(),
    })
}

fn parse_evidence_list(ctx: &mut Ctx<'_>, obj: &mut Obj, key: &str) -> Vec<Evidence> {
    let base = obj.field(key);
    obj.array(ctx, key, MAX_EVIDENCE)
        .into_iter()
        .enumerate()
        .filter_map(|(position, raw)| parse_evidence(ctx, &format!("{base}[{position}]"), raw))
        .collect()
}

fn parse_relationship(
    index: usize,
    raw: Value,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) -> (Option<String>, Option<Relationship>) {
    let Some((mut ctx, mut obj)) = open("relationships", index, raw, diagnostics) else {
        return (None, None);
    };
    let known = ctx.id.clone();
    let id = obj.id(&mut ctx, "id", "relationship identifier", true);
    obj.reject_credits(&mut ctx);
    let visibility = obj.visibility(&mut ctx);
    let kind = match obj.map.remove("kind") {
        Some(Value::String(text)) => {
            let kind = RelationshipKind::parse(&text);
            if kind.is_none() {
                let names: Vec<&str> = RelationshipKind::ALL.iter().map(|k| k.as_str()).collect();
                ctx.report(
                    AtlasDiagnosticCode::UnknownKind,
                    "kind",
                    format!("use one of: {}", names.join(", ")),
                );
            }
            kind
        }
        Some(_) => {
            ctx.report(
                AtlasDiagnosticCode::InvalidField,
                "kind",
                "must be a string",
            );
            None
        }
        None => {
            ctx.report(AtlasDiagnosticCode::MissingField, "kind", "is required");
            None
        }
    };
    let from = obj.id(&mut ctx, "from", "entry identifier", true);
    let to = obj.id(&mut ctx, "to", "entry identifier", true);
    let asserted_by = obj
        .object(&mut ctx, "assertedBy", true)
        .and_then(|o| parse_attribution(&mut ctx, o));
    let confidence = match obj.map.remove("confidence") {
        None => Some(Confidence::Tentative),
        Some(Value::String(text)) => {
            let confidence = Confidence::parse(&text);
            if confidence.is_none() {
                ctx.report(
                    AtlasDiagnosticCode::InvalidField,
                    "confidence",
                    "use tentative, plausible, or strong",
                );
            }
            confidence
        }
        Some(_) => {
            ctx.report(
                AtlasDiagnosticCode::InvalidField,
                "confidence",
                "must be a string",
            );
            None
        }
    };
    let declared = obj
        .map
        .get("evidence")
        .is_some_and(|v| !v.as_array().is_some_and(Vec::is_empty));
    let evidence = parse_evidence_list(&mut ctx, &mut obj, "evidence");
    let unsourced = obj.flag(&mut ctx, "unsourced");
    if declared && evidence.is_empty() {
        // The evidence field already reported why it could not be read.
    } else if evidence.is_empty() && !unsourced {
        ctx.report(
            AtlasDiagnosticCode::MissingEvidence,
            "evidence",
            "cite at least one source, or mark the relationship `\"unsourced\": true` as a draft",
        );
    } else if !evidence.is_empty() && unsourced {
        ctx.report(
            AtlasDiagnosticCode::EvidenceConflict,
            "unsourced",
            "a relationship that cites evidence is not unsourced; remove the flag",
        );
    }
    let uncertainty = obj.text(&mut ctx, "uncertainty", false, MAX_UNCERTAINTY_CHARS, true);
    let mut contested_by = Vec::new();
    for (position, raw) in obj
        .array(&mut ctx, "contestedBy", MAX_DISSENTS)
        .into_iter()
        .enumerate()
    {
        let path = format!("contestedBy[{position}]");
        let Value::Object(map) = raw else {
            ctx.report(
                AtlasDiagnosticCode::InvalidField,
                &path,
                "must be an object",
            );
            continue;
        };
        let mut dissent = Obj {
            path: path.clone(),
            map,
        };
        let by = dissent
            .object(&mut ctx, "by", true)
            .and_then(|o| parse_attribution(&mut ctx, o));
        let evidence = parse_evidence_list(&mut ctx, &mut dissent, "evidence");
        let note = dissent.text(&mut ctx, "note", false, MAX_UNCERTAINTY_CHARS, true);
        if evidence.is_empty() && note.is_none() {
            ctx.report(
                AtlasDiagnosticCode::MissingEvidence,
                &path,
                "a recorded disagreement needs evidence or a note saying why",
            );
        }
        if let Some(by) = by {
            contested_by.push(Dissent {
                by,
                evidence,
                note,
                extra: dissent.rest(),
            });
        }
    }
    let failed = ctx.failed;
    let extra = obj.rest();
    match (id, kind, from, to, asserted_by, confidence, failed) {
        (
            Some(id),
            Some(kind),
            Some(from),
            Some(to),
            Some(asserted_by),
            Some(confidence),
            false,
        ) => (
            Some(id.clone()),
            Some(Relationship {
                id,
                kind,
                from,
                to,
                asserted_by,
                confidence,
                evidence,
                unsourced,
                uncertainty,
                contested_by,
                visibility,
                extra,
            }),
        ),
        (id, ..) => (id.or(known), None),
    }
}

fn entry_result<T>(
    item: Option<T>,
    mut diagnostics: Vec<AtlasDiagnostic>,
) -> Result<T, Vec<AtlasDiagnostic>> {
    for diagnostic in &mut diagnostics {
        diagnostic.index = None;
    }
    match item {
        Some(item) if diagnostics.is_empty() => Ok(item),
        _ => Err(diagnostics),
    }
}

impl Entry {
    /// Read one entry from a request body with the stored rules. Whether its
    /// source resolves is decided when the atlas changes.
    pub fn from_json(raw: Value) -> Result<Self, Vec<AtlasDiagnostic>> {
        let mut diagnostics = Vec::new();
        let (_, entry) = parse_entry(0, raw, &mut diagnostics);
        entry_result(entry, diagnostics)
    }
}

impl Relationship {
    /// Read one relationship from a request body with the stored rules.
    pub fn from_json(raw: Value) -> Result<Self, Vec<AtlasDiagnostic>> {
        let mut diagnostics = Vec::new();
        let (_, relationship) = parse_relationship(0, raw, &mut diagnostics);
        entry_result(relationship, diagnostics)
    }
}

/// Which way a relationship runs from one entry's point of view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Outgoing,
    Incoming,
}

/// A relationship seen from one of its entries, with its reading from there.
#[derive(Clone, Copy, Debug)]
pub struct Incident<'a> {
    pub relationship: &'a Relationship,
    pub direction: Direction,
    /// The entry at the other end.
    pub other: &'a str,
    /// `authored` going out, `authored by` coming in; one label for a
    /// symmetric kind.
    pub label: &'static str,
}

/// How a notebook note's concept link stands against the atlas.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConceptLinkStatus {
    /// A concept entry has this id.
    Resolved,
    /// No entry has this id: an older notebook, or a concept not yet written.
    /// Not an error; the notebook stays valid without an atlas.
    Unresolved,
    /// An entry has this id but is not a concept, so the link cannot mean it.
    WrongKind(EntryKind),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConceptLink {
    pub note: String,
    pub concept: String,
    pub status: ConceptLinkStatus,
}

impl Atlas {
    /// Parse and validate a serialized atlas against the library and notebook
    /// it points into. Every problem is returned at once, scoped as narrowly
    /// as possible; nothing is partially accepted.
    pub fn parse(text: &str, links: Links<'_>) -> Result<Self, Vec<AtlasDiagnostic>> {
        if text.len() > MAX_ATLAS_BYTES {
            return Err(vec![too_large()]);
        }
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        match serde_json::from_str(text) {
            Ok(value) => Self::from_value(value, links),
            Err(error) => Err(vec![atlas_diagnostic(
                AtlasDiagnosticCode::InvalidJson,
                None,
                format!("invalid JSON: {error}"),
            )]),
        }
    }

    fn from_value(value: Value, links: Links<'_>) -> Result<Self, Vec<AtlasDiagnostic>> {
        let fail = |code, field: &str, message: String| {
            Err(vec![atlas_diagnostic(code, Some(field), message)])
        };
        let Value::Object(mut root) = value else {
            return fail(
                AtlasDiagnosticCode::InvalidField,
                "",
                "the atlas must be a JSON object".into(),
            );
        };
        match root.remove("version") {
            Some(Value::Number(n)) if n.as_u64() == Some(ATLAS_VERSION) => {}
            Some(Value::Number(n)) if n.as_u64().is_some_and(|v| v > ATLAS_VERSION) => {
                return fail(
                    AtlasDiagnosticCode::UnsupportedVersion,
                    "version",
                    format!("atlas version {n} was written by a newer open.blog; upgrade before editing so newer data is not lost"),
                );
            }
            Some(_) => {
                return fail(
                    AtlasDiagnosticCode::UnsupportedVersion,
                    "version",
                    format!("version must be {ATLAS_VERSION}"),
                )
            }
            None => {
                return fail(
                    AtlasDiagnosticCode::MissingField,
                    "version",
                    format!("add `\"version\": {ATLAS_VERSION}`"),
                )
            }
        }
        let mut take_array = |key: &str, max: usize| match root.remove(key) {
            Some(Value::Array(items)) if items.len() > max => Err(vec![atlas_diagnostic(
                AtlasDiagnosticCode::TooLarge,
                Some(key),
                format!("an atlas may hold at most {max} {key}"),
            )]),
            Some(Value::Array(items)) => Ok(items),
            Some(_) => Err(vec![atlas_diagnostic(
                AtlasDiagnosticCode::InvalidField,
                Some(key),
                "must be a JSON array",
            )]),
            None => Ok(Vec::new()),
        };
        let raw_entries = take_array("entries", MAX_ENTRIES)?;
        let raw_relationships = take_array("relationships", MAX_RELATIONSHIPS)?;

        let mut diagnostics = Vec::new();
        for key in root.keys().filter(|k| CREDIT_FIELDS.contains(&k.as_str())) {
            diagnostics.push(atlas_diagnostic(
                AtlasDiagnosticCode::ContributorCredit,
                Some(key),
                "contributor credits stay in `.credits.json` sidecars",
            ));
        }
        let mut entries = Vec::new();
        let mut relationships = Vec::new();
        let mut identities: Vec<(&'static str, usize, String)> = Vec::new();
        for (index, raw) in raw_entries.into_iter().enumerate() {
            let (id, entry) = parse_entry(index, raw, &mut diagnostics);
            identities.extend(id.map(|id| ("entries", index, id)));
            entries.extend(entry.map(|e| (index, e)));
        }
        for (index, raw) in raw_relationships.into_iter().enumerate() {
            let (id, relationship) = parse_relationship(index, raw, &mut diagnostics);
            identities.extend(id.map(|id| ("relationships", index, id)));
            relationships.extend(relationship.map(|r| (index, r)));
        }
        check_graph(
            &identities,
            &entries,
            &relationships,
            links,
            &mut diagnostics,
        );
        if !diagnostics.is_empty() {
            return Err(diagnostics);
        }
        let atlas = Self {
            version: ATLAS_VERSION,
            entries: entries.into_iter().map(|(_, e)| e).collect(),
            relationships: relationships.into_iter().map(|(_, r)| r).collect(),
            extra: root.into_iter().collect(),
        };
        if atlas.written_len() > MAX_ATLAS_BYTES {
            return Err(vec![too_large()]);
        }
        Ok(atlas)
    }

    pub fn entry(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    pub fn relationship(&self, id: &str) -> Option<&Relationship> {
        self.relationships.iter().find(|r| r.id == id)
    }

    /// The concept entry with this id, which is what a notebook note's
    /// `concepts` link means once an atlas exists.
    pub fn concept(&self, id: &str) -> Option<&Entry> {
        self.entry(id)
            .filter(|entry| entry.kind == EntryKind::Concept)
    }

    /// Every relationship that touches an entry, in file order, each read from
    /// that entry's side. Only asserted edges appear; none are mirrored or
    /// derived, and a reverse edge shows up only if someone asserted it.
    pub fn relationships_of<'a>(&'a self, id: &str) -> Vec<Incident<'a>> {
        let mut found = Vec::new();
        for relationship in &self.relationships {
            let spec = relationship.kind.spec();
            if relationship.from == id {
                found.push(Incident {
                    relationship,
                    direction: Direction::Outgoing,
                    other: &relationship.to,
                    label: spec.name,
                });
            }
            if relationship.to == id && relationship.from != id {
                found.push(Incident {
                    relationship,
                    direction: Direction::Incoming,
                    other: &relationship.from,
                    label: if spec.symmetric {
                        spec.name
                    } else {
                        spec.inverse
                    },
                });
            }
        }
        found
    }

    /// How each concept link in the notebook stands, in notebook order. An
    /// atlas never makes a notebook invalid: links that resolve to nothing are
    /// reported so an author can write the missing concept entry.
    pub fn concept_links(&self, notebook: &Notebook) -> Vec<ConceptLink> {
        let mut links = Vec::new();
        for note in &notebook.notes {
            for concept in &note.concepts {
                let status = match self.entry(concept) {
                    None => ConceptLinkStatus::Unresolved,
                    Some(e) if e.kind == EntryKind::Concept => ConceptLinkStatus::Resolved,
                    Some(e) => ConceptLinkStatus::WrongKind(e.kind),
                };
                links.push(ConceptLink {
                    note: note.id.clone(),
                    concept: concept.clone(),
                    status,
                });
            }
        }
        links
    }

    /// Concept ids the notebook links to that have no entry yet, sorted and unique.
    pub fn missing_concepts(&self, notebook: &Notebook) -> Vec<String> {
        self.concept_links(notebook)
            .into_iter()
            .filter(|link| link.status == ConceptLinkStatus::Unresolved)
            .map(|link| link.concept)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// Entries and relationships that cite or stand for this source-library
    /// record, so a caller can refuse to remove a source the atlas uses.
    pub fn uses_of_source(&self, source: &str) -> Vec<String> {
        let mut ids: Vec<String> = self
            .entries
            .iter()
            .filter(|e| e.source.as_deref() == Some(source))
            .map(|e| e.id.clone())
            .collect();
        ids.extend(
            self.relationships
                .iter()
                .filter(|r| relationship_sources(r).any(|s| s == source))
                .map(|r| r.id.clone()),
        );
        ids
    }

    /// Relationships whose evidence points into this notebook passage.
    pub fn uses_of_passage(&self, passage: &str) -> Vec<String> {
        self.relationships
            .iter()
            .filter(|r| relationship_evidence(r).any(|e| e.passage.as_deref() == Some(passage)))
            .map(|r| r.id.clone())
            .collect()
    }

    /// Deterministic, pretty-printed JSON with a trailing newline.
    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).unwrap_or_default();
        text.push('\n');
        text
    }

    fn written_len(&self) -> usize {
        let mut counter = ByteCounter(1);
        match serde_json::to_writer_pretty(&mut counter, self) {
            Ok(()) => counter.0,
            Err(_) => usize::MAX,
        }
    }

    /// Validate an edited copy exactly as a file is read, and refuse an edit
    /// whose unknown fields would shadow defined ones.
    fn validated(candidate: &Self, links: Links<'_>) -> Result<Self, Vec<AtlasDiagnostic>> {
        let value = serde_json::to_value(candidate).map_err(|error| {
            vec![atlas_diagnostic(
                AtlasDiagnosticCode::InvalidJson,
                None,
                format!("the atlas could not be serialized: {error}"),
            )]
        })?;
        let reread = Self::from_value(value, links)?;
        let mut shadowed = Vec::new();
        let message = "an unknown field cannot shadow a defined field";
        for key in candidate
            .extra
            .keys()
            .filter(|k| ATLAS_FIELDS.contains(&k.as_str()))
        {
            shadowed.push(atlas_diagnostic(
                AtlasDiagnosticCode::ShadowedField,
                Some(key),
                message,
            ));
        }
        for (index, (a, b)) in candidate.entries.iter().zip(&reread.entries).enumerate() {
            if a != b {
                shadowed.push(item_diagnostic(
                    AtlasDiagnosticCode::ShadowedField,
                    "entries",
                    index,
                    &a.id,
                    "",
                    message,
                ));
            }
        }
        for (index, (a, b)) in candidate
            .relationships
            .iter()
            .zip(&reread.relationships)
            .enumerate()
        {
            if a != b {
                shadowed.push(item_diagnostic(
                    AtlasDiagnosticCode::ShadowedField,
                    "relationships",
                    index,
                    &a.id,
                    "",
                    message,
                ));
            }
        }
        if shadowed.is_empty() {
            Ok(reread)
        } else {
            Err(shadowed)
        }
    }

    /// Add an entry, or replace the entry with the same id in place. An entry
    /// keeps its kind for life: relationships were checked against it, and a
    /// different kind of thing is a new entry. Changes the atlas only when the
    /// whole result is valid.
    pub fn upsert_entry(
        &mut self,
        entry: Entry,
        links: Links<'_>,
    ) -> Result<(), Vec<AtlasDiagnostic>> {
        let mut candidate = self.clone();
        match candidate.entries.iter().position(|e| e.id == entry.id) {
            Some(index) => {
                if candidate.entries[index].kind != entry.kind {
                    return Err(vec![item_diagnostic(
                        AtlasDiagnosticCode::EndpointKind,
                        "entries",
                        index,
                        &entry.id,
                        "kind",
                        "an entry keeps its kind; record a different kind of thing as a new entry",
                    )]);
                }
                candidate.entries[index] = entry;
            }
            None => candidate.entries.push(entry),
        }
        *self = Self::validated(&candidate, links)?;
        Ok(())
    }

    /// Add a relationship, or replace the one with the same id in place.
    pub fn upsert_relationship(
        &mut self,
        relationship: Relationship,
        links: Links<'_>,
    ) -> Result<(), Vec<AtlasDiagnostic>> {
        let mut candidate = self.clone();
        match candidate
            .relationships
            .iter()
            .position(|r| r.id == relationship.id)
        {
            Some(index) => candidate.relationships[index] = relationship,
            None => candidate.relationships.push(relationship),
        }
        *self = Self::validated(&candidate, links)?;
        Ok(())
    }

    /// Remove an entry. Refused, leaving the atlas unchanged, while a
    /// relationship names it or, for a concept, a notebook note still links to it.
    pub fn remove_entry(
        &mut self,
        id: &str,
        links: Links<'_>,
    ) -> Result<Entry, Vec<AtlasDiagnostic>> {
        let Some(index) = self.entries.iter().position(|e| e.id == id) else {
            return Err(vec![unknown_item("entries", id)]);
        };
        let mut blockers: Vec<AtlasDiagnostic> = self
            .relationships
            .iter()
            .enumerate()
            .filter(|(_, r)| r.from == id || r.to == id)
            .map(|(position, r)| {
                item_diagnostic(
                    AtlasDiagnosticCode::StillLinked,
                    "relationships",
                    position,
                    &r.id,
                    if r.from == id { "from" } else { "to" },
                    format!("this relationship still joins the entry `{id}`"),
                )
            })
            .collect();
        if self.entries[index].kind == EntryKind::Concept {
            for (position, note) in links.notebook.notes.iter().enumerate() {
                if note.concepts.iter().any(|c| c == id) {
                    blockers.push(item_diagnostic(
                        AtlasDiagnosticCode::StillLinked,
                        "notes",
                        position,
                        &note.id,
                        "concepts",
                        format!("this note still links to the concept `{id}`"),
                    ));
                }
            }
        }
        if !blockers.is_empty() {
            return Err(blockers);
        }
        let mut candidate = self.clone();
        let removed = candidate.entries.remove(index);
        *self = Self::validated(&candidate, links).map_err(|d| shift_back("entries", index, d))?;
        Ok(removed)
    }

    /// Remove a relationship.
    pub fn remove_relationship(
        &mut self,
        id: &str,
        links: Links<'_>,
    ) -> Result<Relationship, Vec<AtlasDiagnostic>> {
        let Some(index) = self.relationships.iter().position(|r| r.id == id) else {
            return Err(vec![unknown_item("relationships", id)]);
        };
        let mut candidate = self.clone();
        let removed = candidate.relationships.remove(index);
        *self = Self::validated(&candidate, links)
            .map_err(|d| shift_back("relationships", index, d))?;
        Ok(removed)
    }
}

fn relationship_evidence(r: &Relationship) -> impl Iterator<Item = &Evidence> {
    r.evidence
        .iter()
        .chain(r.contested_by.iter().flat_map(|d| d.evidence.iter()))
}

fn relationship_sources(r: &Relationship) -> impl Iterator<Item = &str> {
    let attributions = std::iter::once(&r.asserted_by)
        .chain(r.contested_by.iter().map(|d| &d.by))
        .filter_map(|a| a.source.as_deref());
    relationship_evidence(r)
        .map(|e| e.source.as_str())
        .chain(attributions)
}

/// Report positions in the atlas the caller holds, which still contains the
/// item that was to be removed.
fn shift_back(
    collection: &'static str,
    removed: usize,
    mut diagnostics: Vec<AtlasDiagnostic>,
) -> Vec<AtlasDiagnostic> {
    for diagnostic in diagnostics
        .iter_mut()
        .filter(|d| d.collection == Some(collection))
    {
        if let Some(position) = diagnostic.index.as_mut() {
            if *position >= removed {
                *position += 1;
            }
        }
    }
    diagnostics
}

fn unknown_item(collection: &'static str, id: &str) -> AtlasDiagnostic {
    AtlasDiagnostic {
        code: AtlasDiagnosticCode::UnknownEntry,
        collection: Some(collection),
        index: None,
        id: Some(id.into()),
        field: None,
        message: format!("nothing has the id `{id}`"),
    }
}

fn check_graph(
    identities: &[(&'static str, usize, String)],
    entries: &[(usize, Entry)],
    relationships: &[(usize, Relationship)],
    links: Links<'_>,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) {
    let mut first: BTreeMap<&str, (&'static str, usize)> = BTreeMap::new();
    for (collection, index, id) in identities {
        if let Some((other, position)) = first.get(id.as_str()) {
            diagnostics.push(item_diagnostic(
                AtlasDiagnosticCode::DuplicateId,
                collection,
                *index,
                id,
                "id",
                format!("`{id}` is already used by {other}[{position}]; entries and relationships share one identifier space"),
            ));
        } else {
            first.insert(id, (collection, *index));
        }
    }
    let kinds: BTreeMap<&str, (EntryKind, Visibility)> = entries
        .iter()
        .filter(|(i, e)| first.get(e.id.as_str()) == Some(&("entries", *i)))
        .map(|(_, e)| (e.id.as_str(), (e.kind, e.visibility)))
        .collect();

    for (index, entry) in entries {
        if first.get(entry.id.as_str()) != Some(&("entries", *index)) {
            continue;
        }
        let Some(source) = &entry.source else {
            continue;
        };
        let report = |code, message: String| {
            item_diagnostic(code, "entries", *index, &entry.id, "source", message)
        };
        match links.library.get(source) {
            None => diagnostics.push(report(
                AtlasDiagnosticCode::UnknownSource,
                format!("no source in the library has the id `{source}`"),
            )),
            Some(record) if record.kind != ResearchSourceKind::Work => {
                diagnostics.push(report(
                    AtlasDiagnosticCode::WrongSourceKind,
                    format!(
                        "`{source}` is a {}; a work entry stands for the work itself, and editions, translations and witnesses are cited as evidence",
                        record.kind.as_str()
                    ),
                ))
            }
            Some(_) => {}
        }
    }

    let mut seen: BTreeSet<(RelationshipKind, String, String, String)> = BTreeSet::new();
    let mut edges: BTreeMap<RelationshipKind, Vec<(usize, &str, &str)>> = BTreeMap::new();
    for (index, r) in relationships {
        if first.get(r.id.as_str()) != Some(&("relationships", *index)) {
            continue;
        }
        let report = |code, field: &str, message: String| {
            item_diagnostic(code, "relationships", *index, &r.id, field, message)
        };
        let spec = r.kind.spec();
        let mut ends = Vec::new();
        for (field, id, allowed) in [("from", &r.from, spec.from), ("to", &r.to, spec.to)] {
            match kinds.get(id.as_str()) {
                // An entry that failed to read has already said why.
                None if first.get(id.as_str()).is_some_and(|(c, _)| *c == "entries") => {}
                None => diagnostics.push(report(
                    AtlasDiagnosticCode::UnknownEntry,
                    field,
                    format!("no entry has the id `{id}`"),
                )),
                Some((kind, _)) => {
                    if !allowed.contains(kind) {
                        let names: Vec<&str> = allowed.iter().map(|k| k.as_str()).collect();
                        diagnostics.push(report(
                            AtlasDiagnosticCode::EndpointKind,
                            field,
                            format!(
                                "`{}` cannot join a {} here; `{}` relates {} to {}",
                                id,
                                kind.as_str(),
                                spec.name,
                                names.join("/"),
                                if field == "from" {
                                    "its targets"
                                } else {
                                    "its sources"
                                },
                            ),
                        ));
                    }
                    ends.push(*kind);
                }
            }
        }
        if r.from == r.to {
            diagnostics.push(report(
                AtlasDiagnosticCode::SelfRelationship,
                "to",
                "an entry cannot be related to itself".into(),
            ));
        } else if spec.same_kind && ends.len() == 2 && ends[0] != ends[1] {
            diagnostics.push(report(
                AtlasDiagnosticCode::EndpointKind,
                "to",
                format!("`{}` joins two entries of the same kind", spec.name),
            ));
        }

        // One assertion per party per edge: a second party may assert the same
        // edge, a second copy from the same party is noise.
        let party = serde_json::to_string(&r.asserted_by).unwrap_or_default();
        let (a, b) = if spec.symmetric && r.from > r.to {
            (r.to.clone(), r.from.clone())
        } else {
            (r.from.clone(), r.to.clone())
        };
        if !seen.insert((r.kind, a, b, party)) {
            diagnostics.push(report(
                AtlasDiagnosticCode::DuplicateRelationship,
                "assertedBy",
                "this party already asserts this relationship; record another party's view as its own relationship or as a recorded disagreement".into(),
            ));
        }
        if spec.acyclic && r.from != r.to {
            edges
                .entry(r.kind)
                .or_default()
                .push((*index, r.from.as_str(), r.to.as_str()));
        }

        check_attribution(&r.asserted_by, "assertedBy", links, &report, diagnostics);
        for (position, e) in r.evidence.iter().enumerate() {
            check_evidence(
                e,
                &format!("evidence[{position}]"),
                links,
                &report,
                diagnostics,
            );
        }
        for (position, d) in r.contested_by.iter().enumerate() {
            check_attribution(
                &d.by,
                &format!("contestedBy[{position}].by"),
                links,
                &report,
                diagnostics,
            );
            for (inner, e) in d.evidence.iter().enumerate() {
                check_evidence(
                    e,
                    &format!("contestedBy[{position}].evidence[{inner}]"),
                    links,
                    &report,
                    diagnostics,
                );
            }
        }

        if r.confidence == Confidence::Strong && r.unsourced {
            diagnostics.push(report(
                AtlasDiagnosticCode::EvidenceConflict,
                "confidence",
                "an unsourced draft cannot be strong; cite evidence first".into(),
            ));
        }
        if r.visibility == Visibility::Approved {
            if r.unsourced {
                diagnostics.push(report(
                    AtlasDiagnosticCode::MissingEvidence,
                    "visibility",
                    "an unsourced draft cannot be approved; cite evidence first".into(),
                ));
            }
            for (field, id) in [("from", &r.from), ("to", &r.to)] {
                if kinds
                    .get(id.as_str())
                    .is_some_and(|(_, v)| *v != Visibility::Approved)
                {
                    diagnostics.push(report(
                        AtlasDiagnosticCode::PrivateEndpoint,
                        field,
                        format!("an approved relationship cannot point at the private entry `{id}`; approve the entry first or keep the relationship private"),
                    ));
                }
            }
            if relationship_evidence(r).any(|e| e.passage.is_some()) {
                diagnostics.push(report(
                    AtlasDiagnosticCode::PrivateReference,
                    "visibility",
                    "an approved relationship cannot carry a pointer into the private notebook; cite the source and locators instead".into(),
                ));
            }
        }
    }

    for (kind, list) in edges {
        for index in cyclic_edges(&list) {
            if let Some((_, r)) = relationships.iter().find(|(i, _)| *i == index) {
                diagnostics.push(item_diagnostic(
                    AtlasDiagnosticCode::Cycle,
                    "relationships",
                    index,
                    &r.id,
                    "to",
                    format!(
                        "`{}` relationships cannot form a cycle, and this one is on one",
                        kind.as_str()
                    ),
                ));
            }
        }
    }
}

fn check_attribution(
    attribution: &Attribution,
    path: &str,
    links: Links<'_>,
    report: &dyn Fn(AtlasDiagnosticCode, &str, String) -> AtlasDiagnostic,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) {
    if let Some(source) = &attribution.source {
        if links.library.get(source).is_none() {
            diagnostics.push(report(
                AtlasDiagnosticCode::UnknownSource,
                &format!("{path}.source"),
                format!("no source in the library has the id `{source}`"),
            ));
        }
    }
}

fn check_evidence(
    evidence: &Evidence,
    path: &str,
    links: Links<'_>,
    report: &dyn Fn(AtlasDiagnosticCode, &str, String) -> AtlasDiagnostic,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) {
    if links.library.get(&evidence.source).is_none() {
        diagnostics.push(report(
            AtlasDiagnosticCode::UnknownSource,
            &format!("{path}.source"),
            format!("no source in the library has the id `{}`", evidence.source),
        ));
    } else {
        let target = resolved_kind(links.library, &evidence.source);
        for (position, locator) in evidence.locators.iter().enumerate() {
            if let Some(message) = locator_ambiguity(target, &evidence.source, locator) {
                diagnostics.push(report(
                    AtlasDiagnosticCode::AmbiguousLocator,
                    &format!("{path}.locators[{position}].kind"),
                    message,
                ));
            }
        }
    }
    if let Some(id) = &evidence.passage {
        match links.notebook.passage(id) {
            None => diagnostics.push(report(
                AtlasDiagnosticCode::UnknownPassage,
                &format!("{path}.passage"),
                format!("no notebook passage has the id `{id}`"),
            )),
            Some(passage) if passage.source != evidence.source => diagnostics.push(report(
                AtlasDiagnosticCode::UnknownPassage,
                &format!("{path}.passage"),
                format!("the passage `{id}` was quoted from a different source than this evidence cites"),
            )),
            Some(_) => {}
        }
    }
}

/// Indexes of the edges that lie on a cycle: those whose two ends share a
/// strongly connected component (iterative Tarjan, so depth is not bounded by
/// the stack).
fn cyclic_edges(edges: &[(usize, &str, &str)]) -> Vec<usize> {
    let mut ids: BTreeMap<&str, usize> = BTreeMap::new();
    for (_, a, b) in edges {
        let next = ids.len();
        ids.entry(a).or_insert(next);
        let next = ids.len();
        ids.entry(b).or_insert(next);
    }
    let n = ids.len();
    let mut adjacent = vec![Vec::new(); n];
    for (_, a, b) in edges {
        adjacent[ids[a]].push(ids[b]);
    }
    let (mut order, mut low) = (vec![usize::MAX; n], vec![0; n]);
    let (mut on_stack, mut component) = (vec![false; n], vec![usize::MAX; n]);
    let (mut stack, mut counter, mut components) = (Vec::new(), 0, 0);
    for root in 0..n {
        if order[root] != usize::MAX {
            continue;
        }
        let mut work = vec![(root, 0usize)];
        order[root] = counter;
        low[root] = counter;
        counter += 1;
        stack.push(root);
        on_stack[root] = true;
        while let Some(&mut (node, ref mut next)) = work.last_mut() {
            if let Some(&target) = adjacent[node].get(*next) {
                *next += 1;
                if order[target] == usize::MAX {
                    order[target] = counter;
                    low[target] = counter;
                    counter += 1;
                    stack.push(target);
                    on_stack[target] = true;
                    work.push((target, 0));
                } else if on_stack[target] {
                    low[node] = low[node].min(order[target]);
                }
            } else {
                work.pop();
                if let Some(&(parent, _)) = work.last() {
                    low[parent] = low[parent].min(low[node]);
                }
                if low[node] == order[node] {
                    while let Some(top) = stack.pop() {
                        on_stack[top] = false;
                        component[top] = components;
                        if top == node {
                            break;
                        }
                    }
                    components += 1;
                }
            }
        }
    }
    edges
        .iter()
        .filter(|(_, a, b)| component[ids[a]] == component[ids[b]])
        .map(|(index, ..)| *index)
        .collect()
}

struct ByteCounter(usize);

impl std::io::Write for ByteCounter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 = self.0.saturating_add(buf.len());
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn library() -> SourceLibrary {
        let text = json!({"version": 1, "sources": [
            {"id": "plato-republic", "kind": "work", "title": "Politeia"},
            {"id": "republic-slings", "kind": "edition", "of": "plato-republic", "title": "Platonis Rempublicam"},
            {"id": "paris-gr-1807", "kind": "witness", "of": "plato-republic", "title": "Paris gr. 1807"},
            {"id": "scholar-book", "kind": "work", "title": "A study"}
        ]})
        .to_string();
        SourceLibrary::parse(&text, &BTreeMap::new()).expect("library")
    }

    fn notebook() -> Notebook {
        let text = json!({"version": 1,
            "passages": [{"id": "p-cave", "source": "republic-slings",
                "excerpt": {"text": "the cave"}}],
            "notes": [{"id": "n-1", "kind": "question", "text": "Why a cave?",
                "concepts": ["allegory", "plato"]}]})
        .to_string();
        Notebook::parse(&text, &library()).expect("notebook")
    }

    fn parse_with(value: Value, notebook: &Notebook) -> Result<Atlas, Vec<AtlasDiagnostic>> {
        let library = library();
        Atlas::parse(
            &value.to_string(),
            Links {
                library: &library,
                notebook,
            },
        )
    }

    fn parse(value: Value) -> Result<Atlas, Vec<AtlasDiagnostic>> {
        parse_with(value, &Notebook::default())
    }

    /// Cites no notebook passage, so it is valid with an empty notebook.
    fn sample() -> Value {
        json!({"version": 1,
            "entries": [
                {"id": "plato", "kind": "person", "label": "Plato", "aliases": ["Πλάτων"],
                 "bounds": {"from": -428, "until": -348}},
                {"id": "republic", "kind": "work", "label": "Republic", "source": "plato-republic",
                 "summary": "A dialogue."},
                {"id": "allegory", "kind": "concept", "label": "Allegory"},
                {"id": "platonism", "kind": "movement", "label": "Platonism"},
                {"id": "trial", "kind": "event", "label": "Trial of Socrates"}],
            "relationships": [
                {"id": "r-authored", "kind": "authored", "from": "plato", "to": "republic",
                 "assertedBy": {"kind": "source", "source": "scholar-book"},
                 "evidence": [{"source": "republic-slings",
                    "locators": [{"kind": "page", "value": "514"}]}]},
                {"id": "r-infl", "kind": "influenced", "from": "plato", "to": "platonism",
                 "assertedBy": {"kind": "author"}, "confidence": "plausible",
                 "evidence": [{"source": "republic-slings"}],
                 "uncertainty": "Direction is argued, not settled."}]})
    }

    fn valid() -> Atlas {
        parse(sample()).expect("valid")
    }

    fn codes(result: Result<Atlas, Vec<AtlasDiagnostic>>) -> Vec<AtlasDiagnosticCode> {
        codes_of(result)
    }

    fn codes_of<T>(result: Result<T, Vec<AtlasDiagnostic>>) -> Vec<AtlasDiagnosticCode> {
        match result {
            Ok(_) => panic!("expected failure"),
            Err(found) => found.iter().map(|d| d.code).collect(),
        }
    }

    fn with_relationship(extra: Value) -> Value {
        let mut value = sample();
        value["relationships"].as_array_mut().unwrap().push(extra);
        value
    }

    fn edge(id: &str, kind: &str, from: &str, to: &str) -> Value {
        json!({"id": id, "kind": kind, "from": from, "to": to,
            "assertedBy": {"kind": "author"}, "unsourced": true})
    }

    #[test]
    fn passage_evidence_must_exist_and_match_its_source() {
        let mut value = sample();
        value["relationships"][1]["evidence"] =
            json!([{"source": "republic-slings", "passage": "p-cave"}]);
        assert!(parse_with(value.clone(), &notebook()).is_ok());
        assert_eq!(
            codes(parse(value.clone())),
            vec![AtlasDiagnosticCode::UnknownPassage],
            "an unknown passage is refused when the notebook lacks it"
        );
        value["relationships"][1]["evidence"][0]["source"] = json!("paris-gr-1807");
        assert_eq!(
            codes(parse_with(value, &notebook())),
            vec![AtlasDiagnosticCode::UnknownPassage],
            "the passage was quoted from another source"
        );
    }

    #[test]
    fn every_entry_and_relationship_kind_round_trips_with_defaults_written() {
        let atlas = valid();
        assert_eq!(atlas.entries.len(), 5);
        for kind in EntryKind::ALL {
            assert!(atlas.entries.iter().any(|e| e.kind == kind));
        }
        assert_eq!(atlas.entries[0].visibility, Visibility::Private);
        assert_eq!(atlas.relationships[0].confidence, Confidence::Tentative);
        let text = atlas.to_json();
        assert!(text.ends_with('\n'));
        assert!(text.contains("\"visibility\": \"private\""));
        assert!(text.contains("\"confidence\": \"tentative\""));
        let library = library();
        let again = Atlas::parse(
            &text,
            Links {
                library: &library,
                notebook: &Notebook::default(),
            },
        )
        .expect("re-read");
        assert_eq!(again, atlas);
        assert_eq!(again.to_json(), text);
        for kind in RelationshipKind::ALL {
            assert_eq!(RelationshipKind::parse(kind.as_str()), Some(kind));
            assert!(!kind.from_kinds().is_empty() && !kind.to_kinds().is_empty());
        }
    }

    #[test]
    fn kinds_keep_their_meaning() {
        let cases = [
            ("authored", "republic", "plato"),
            ("member-of", "plato", "republic"),
            ("developed", "plato", "republic"),
            ("participated-in", "plato", "republic"),
            ("specializes", "allegory", "platonism"),
            ("part-of", "republic", "allegory"),
            ("responds-to", "trial", "plato"),
            ("disputes", "allegory", "plato"),
        ];
        for (kind, from, to) in cases {
            assert!(
                codes(parse(with_relationship(edge("bad", kind, from, to))))
                    .contains(&AtlasDiagnosticCode::EndpointKind),
                "{kind} {from}->{to}"
            );
        }
        for (kind, from, to) in [
            ("influenced", "trial", "plato"),
            ("influenced", "plato", "trial"),
            ("responds-to", "republic", "trial"),
        ] {
            assert!(
                parse(with_relationship(edge("ok", kind, from, to))).is_ok(),
                "{kind} {from}->{to}: an event can be answered and can influence or be influenced"
            );
        }
        let mut person_source = sample();
        person_source["entries"][0]["source"] = json!("plato-republic");
        assert_eq!(
            codes(parse(person_source)),
            vec![AtlasDiagnosticCode::InvalidField]
        );
        let mut edition_source = sample();
        edition_source["entries"][1]["source"] = json!("republic-slings");
        assert_eq!(
            codes(parse(edition_source)),
            vec![AtlasDiagnosticCode::WrongSourceKind]
        );
        let mut unknown_source = sample();
        unknown_source["entries"][1]["source"] = json!("nope");
        assert_eq!(
            codes(parse(unknown_source)),
            vec![AtlasDiagnosticCode::UnknownSource]
        );
        let mut generic = sample();
        generic["entries"][0]["kind"] = json!("record");
        assert_eq!(
            codes(parse(generic)),
            vec![AtlasDiagnosticCode::UnknownKind]
        );
    }

    #[test]
    fn relationships_need_evidence_or_an_explicit_unsourced_draft() {
        let mut none = edge("r-x", "related-to", "plato", "allegory");
        none.as_object_mut().unwrap().remove("unsourced");
        assert_eq!(
            codes(parse(with_relationship(none))),
            vec![AtlasDiagnosticCode::MissingEvidence]
        );
        assert!(parse(with_relationship(edge(
            "r-x",
            "influenced",
            "plato",
            "allegory"
        )))
        .is_ok());
        let mut both = edge("r-x", "related-to", "plato", "allegory");
        both["evidence"] = json!([{"source": "scholar-book"}]);
        assert_eq!(
            codes(parse(with_relationship(both))),
            vec![AtlasDiagnosticCode::EvidenceConflict]
        );
        let mut strong = edge("r-x", "related-to", "plato", "allegory");
        strong["confidence"] = json!("strong");
        assert_eq!(
            codes(parse(with_relationship(strong))),
            vec![AtlasDiagnosticCode::EvidenceConflict]
        );
        let mut missing_party = edge("r-x", "related-to", "plato", "allegory");
        missing_party.as_object_mut().unwrap().remove("assertedBy");
        assert_eq!(
            codes(parse(with_relationship(missing_party))),
            vec![AtlasDiagnosticCode::MissingField]
        );
    }

    #[test]
    fn evidence_reuses_source_ids_and_locator_rules() {
        let mut ambiguous = sample();
        ambiguous["relationships"][0]["evidence"] = json!([
            {"source": "plato-republic", "locators": [{"kind": "page", "value": "1"}]},
            {"source": "republic-slings", "locators": [{"kind": "folio", "value": "1r"}]},
            {"source": "missing"}]);
        let found = codes(parse(ambiguous));
        assert_eq!(
            found
                .iter()
                .filter(|c| **c == AtlasDiagnosticCode::AmbiguousLocator)
                .count(),
            2
        );
        assert!(found.contains(&AtlasDiagnosticCode::UnknownSource));
        let mut malformed = sample();
        malformed["relationships"][0]["evidence"] = json!([
            {"source": "republic-slings", "locators": [{"kind": "pagee", "value": "1"}]},
            {"source": "republic-slings", "locators": [{"kind": "timestamp", "value": "x"}]}]);
        let found = codes(parse(malformed));
        assert!(found.contains(&AtlasDiagnosticCode::UnknownLocatorKind));
        assert!(found.contains(&AtlasDiagnosticCode::InvalidLocator));
        let mut witness = sample();
        witness["relationships"][0]["evidence"] = json!([
            {"source": "paris-gr-1807", "locators": [
                {"kind": "folio", "value": "12r"}, {"kind": "x-stephanus", "value": "514a"}]}]);
        assert!(parse(witness).is_ok());
    }

    #[test]
    fn attribution_is_required_typed_and_never_a_credit() {
        let library = library();
        let links = Links {
            library: &library,
            notebook: &Notebook::default(),
        };
        let mut named = valid().relationships[0].clone();
        named.asserted_by = Attribution {
            kind: AttributionKind::Named,
            source: None,
            name: Some("The Tübingen school".into()),
            extra: BTreeMap::new(),
        };
        let mut atlas = valid();
        atlas
            .upsert_relationship(named, links)
            .expect("named party");

        for (by, code) in [
            (
                json!({"kind": "source", "source": "ghost"}),
                AtlasDiagnosticCode::UnknownSource,
            ),
            (json!({"kind": "source"}), AtlasDiagnosticCode::MissingField),
            (json!({"kind": "named"}), AtlasDiagnosticCode::MissingField),
            (
                json!({"kind": "author", "name": "Me"}),
                AtlasDiagnosticCode::InvalidField,
            ),
            (json!({"kind": "crowd"}), AtlasDiagnosticCode::UnknownKind),
        ] {
            let mut value = sample();
            value["relationships"][0]["assertedBy"] = by;
            assert_eq!(codes(parse(value)), vec![code]);
        }
        let mut credit = sample();
        credit["relationships"][0]["contributors"] = json!(["x"]);
        credit["entries"][0]["credit"] = json!("x");
        credit["credits"] = json!([]);
        assert_eq!(
            codes(parse(credit)),
            vec![AtlasDiagnosticCode::ContributorCredit; 3]
        );
    }

    #[test]
    fn contested_relationships_are_never_consensus() {
        let mut value = sample();
        value["relationships"][1]["contestedBy"] = json!([
            {"by": {"kind": "source", "source": "scholar-book"},
             "evidence": [{"source": "plato-republic"}], "note": "Argues the reverse."}]);
        let atlas = parse(value.clone()).expect("contested is representable");
        assert_eq!(atlas.relationships[1].standing(), Standing::Contested);
        assert_eq!(valid().relationships[1].standing(), Standing::Asserted);
        // Standing is derived from recorded dissent; it cannot be written, and
        // there is no way to say "agreed".
        value["relationships"][1]["standing"] = json!("consensus");
        let kept = parse(value).expect("unknown fields survive but never decide standing");
        assert_eq!(kept.relationships[1].standing(), Standing::Contested);
        let mut plain = sample();
        plain["relationships"][1]["standing"] = json!("consensus");
        assert_eq!(
            parse(plain).unwrap().relationships[1].standing(),
            Standing::Asserted
        );

        let mut bare = sample();
        bare["relationships"][1]["contestedBy"] = json!([{"by": {"kind": "author"}}]);
        assert_eq!(
            codes(parse(bare)),
            vec![AtlasDiagnosticCode::MissingEvidence]
        );

        // A second party's view is its own attributed assertion, not a merge.
        let library = library();
        let links = Links {
            library: &library,
            notebook: &Notebook::default(),
        };
        let mut rival = valid().relationships[1].clone();
        rival.id = "r-infl-2".into();
        rival.asserted_by = Attribution {
            kind: AttributionKind::Named,
            source: None,
            name: Some("A rival reading".into()),
            extra: BTreeMap::new(),
        };
        let mut atlas = valid();
        atlas
            .upsert_relationship(rival.clone(), links)
            .expect("second party");
        rival.id = "r-infl-3".into();
        assert_eq!(
            codes_of(atlas.upsert_relationship(rival, links)),
            vec![AtlasDiagnosticCode::DuplicateRelationship]
        );
    }

    #[test]
    fn influence_is_never_inferred_from_dates() {
        let mut value = sample();
        value["entries"].as_array_mut().unwrap().push(
            json!({"id": "aristotle", "kind": "person", "label": "Aristotle",
                   "bounds": {"from": -384, "until": -322}}),
        );
        let atlas = parse(value).expect("valid");
        // Aristotle comes after Plato, and nothing says he was influenced.
        assert!(atlas.relationships_of("aristotle").is_empty());
        assert_eq!(atlas.relationships.len(), 2);
        assert!(RelationshipKind::ALL
            .iter()
            .all(|k| !k.as_str().contains("preced") && !k.as_str().contains("contemporary")));
        // Dates are not compared when relationships are checked either.
        let mut backwards = valid();
        let mut r = backwards.relationships[1].clone();
        r.id = "r-back".into();
        r.from = "platonism".into();
        r.to = "plato".into();
        let library = library();
        let links = Links {
            library: &library,
            notebook: &Notebook::default(),
        };
        assert!(backwards.upsert_relationship(r, links).is_ok());
        // An influence with no evidence is only ever an explicit, private draft.
        let mut none = edge("r-x", "influenced", "plato", "allegory");
        none.as_object_mut().unwrap().remove("unsourced");
        assert_eq!(
            codes(parse(with_relationship(none))),
            vec![AtlasDiagnosticCode::MissingEvidence]
        );
    }

    #[test]
    fn direction_reciprocity_and_incident_views() {
        let library = library();
        let links = Links {
            library: &library,
            notebook: &Notebook::default(),
        };
        let atlas = valid();
        let plato = atlas.relationships_of("plato");
        assert_eq!(plato.len(), 2);
        assert!(plato.iter().all(|i| i.direction == Direction::Outgoing));
        assert_eq!(plato[0].label, "authored");
        let republic = atlas.relationships_of("republic");
        assert_eq!(republic[0].direction, Direction::Incoming);
        assert_eq!(republic[0].label, "authored by");
        assert_eq!(republic[0].other, "plato");
        // Nothing is mirrored: the reverse reading exists only as a label.
        assert_eq!(atlas.relationships_of("platonism").len(), 1);

        let mut both = valid();
        let mut reverse = both.relationships[1].clone();
        reverse.id = "r-infl-back".into();
        reverse.from = "platonism".into();
        reverse.to = "plato".into();
        both.upsert_relationship(reverse, links)
            .expect("non-reciprocal edges coexist");
        assert_eq!(both.relationships_of("plato").len(), 3);

        // A symmetric kind reads the same both ways and cannot be doubled by swapping.
        let mut sym = valid();
        sym.upsert_relationship(
            Relationship::from_json(edge("r-sym", "related-to", "plato", "allegory")).unwrap(),
            links,
        )
        .expect("symmetric");
        assert_eq!(sym.relationships_of("allegory")[0].label, "related-to");
        assert_eq!(
            codes_of(sym.upsert_relationship(
                Relationship::from_json(edge("r-sym2", "related-to", "allegory", "plato")).unwrap(),
                links,
            )),
            vec![AtlasDiagnosticCode::DuplicateRelationship]
        );
        assert_eq!(
            codes_of(sym.upsert_relationship(
                Relationship::from_json(edge("r-self", "related-to", "plato", "plato")).unwrap(),
                links,
            )),
            vec![AtlasDiagnosticCode::SelfRelationship]
        );
    }

    #[test]
    fn containment_cycles_are_refused_and_mutual_influence_is_not() {
        let mut value = sample();
        value["entries"].as_array_mut().unwrap().extend([
            json!({"id": "c1", "kind": "concept", "label": "One"}),
            json!({"id": "c2", "kind": "concept", "label": "Two"}),
            json!({"id": "c3", "kind": "concept", "label": "Three"}),
            json!({"id": "c4", "kind": "concept", "label": "Four"}),
        ]);
        let rels = value["relationships"].as_array_mut().unwrap();
        rels.push(edge("s1", "specializes", "c1", "c2"));
        rels.push(edge("s2", "specializes", "c2", "c3"));
        rels.push(edge("s4", "specializes", "c3", "c4"));
        assert!(parse(value.clone()).is_ok(), "a chain is fine");
        value["relationships"]
            .as_array_mut()
            .unwrap()
            .push(edge("s3", "specializes", "c3", "c1"));
        let found = parse(value).expect_err("cycle");
        let cyclic: Vec<&str> = found.iter().map(|d| d.id.as_deref().unwrap()).collect();
        assert_eq!(
            cyclic,
            vec!["s1", "s2", "s3"],
            "the tail edge is not on the cycle"
        );
        assert!(
            found
                .iter()
                .all(|d| d.code == AtlasDiagnosticCode::Cycle
                    && d.collection == Some("relationships"))
        );
        let mut parts = sample();
        parts["entries"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id": "e2", "kind": "event", "label": "Two"}));
        let rels = parts["relationships"].as_array_mut().unwrap();
        rels.push(edge("p1", "part-of", "trial", "e2"));
        rels.push(edge("p2", "part-of", "e2", "trial"));
        assert_eq!(codes(parse(parts)), vec![AtlasDiagnosticCode::Cycle; 2]);
        let mut mutual = sample();
        let rels = mutual["relationships"].as_array_mut().unwrap();
        rels.push(edge("i1", "influenced", "platonism", "plato"));
        assert!(parse(mutual).is_ok());
    }

    #[test]
    fn private_by_default_and_approval_cannot_expose_private_things() {
        let mut value = sample();
        value["relationships"][0]["visibility"] = json!("approved");
        assert_eq!(
            codes(parse(value.clone())),
            vec![AtlasDiagnosticCode::PrivateEndpoint; 2]
        );
        value["entries"][0]["visibility"] = json!("approved");
        value["entries"][1]["visibility"] = json!("approved");
        assert!(parse(value.clone()).is_ok());
        let mut unsourced = value.clone();
        unsourced["relationships"][0]
            .as_object_mut()
            .unwrap()
            .remove("evidence");
        unsourced["relationships"][0]["unsourced"] = json!(true);
        assert_eq!(
            codes(parse(unsourced)),
            vec![AtlasDiagnosticCode::MissingEvidence]
        );
        let mut pointer = value.clone();
        pointer["relationships"][0]["evidence"] =
            json!([{"source": "republic-slings", "passage": "p-cave"}]);
        assert_eq!(
            codes(parse_with(pointer, &notebook())),
            vec![AtlasDiagnosticCode::PrivateReference]
        );
        let mut odd = value;
        odd["entries"][2]["visibility"] = json!("public");
        assert_eq!(
            codes(parse(odd)),
            vec![AtlasDiagnosticCode::InvalidVisibility]
        );
    }

    #[test]
    fn notebook_concept_links_resolve_to_entries_without_breaking_old_notebooks() {
        let notebook = notebook();
        // No atlas: every link is simply unresolved, and nothing is invalid.
        let empty = Atlas::default();
        assert!(empty
            .concept_links(&notebook)
            .iter()
            .all(|l| l.status == ConceptLinkStatus::Unresolved));
        assert_eq!(empty.missing_concepts(&notebook), vec!["allegory", "plato"]);
        // The notebook is unchanged and still valid on its own.
        assert_eq!(notebook.notes[0].concepts, vec!["allegory", "plato"]);

        let atlas = valid();
        let links = atlas.concept_links(&notebook);
        assert_eq!(links[0].status, ConceptLinkStatus::Resolved);
        assert_eq!(
            links[1].status,
            ConceptLinkStatus::WrongKind(EntryKind::Person)
        );
        assert_eq!(atlas.concept("allegory").unwrap().label, "Allegory");
        assert!(atlas.concept("plato").is_none());
        assert!(atlas.missing_concepts(&notebook).is_empty());
    }

    #[test]
    fn removal_is_refused_while_anything_depends_on_the_entry() {
        let notebook = notebook();
        let library = library();
        let links = Links {
            library: &library,
            notebook: &notebook,
        };
        let mut atlas = valid();
        let before = atlas.clone();
        let blocked = atlas
            .remove_entry("plato", links)
            .expect_err("relationships remain");
        assert_eq!(blocked.len(), 2);
        assert!(blocked
            .iter()
            .all(|d| d.code == AtlasDiagnosticCode::StillLinked));
        let concept = atlas
            .remove_entry("allegory", links)
            .expect_err("note links to it");
        assert_eq!(concept[0].collection, Some("notes"));
        assert_eq!(concept[0].id.as_deref(), Some("n-1"));
        assert_eq!(atlas, before);
        assert!(atlas.remove_entry("trial", links).is_ok());
        assert!(atlas.remove_relationship("r-infl", links).is_ok());
        assert_eq!(atlas.relationships.len(), 1);
        assert_eq!(
            codes_of(atlas.remove_entry("ghost", links)),
            vec![AtlasDiagnosticCode::UnknownEntry]
        );
    }

    #[test]
    fn edits_are_all_or_nothing_and_kinds_are_immutable() {
        let library = library();
        let links = Links {
            library: &library,
            notebook: &Notebook::default(),
        };
        let mut atlas = valid();
        let before = atlas.clone();
        let mut retyped = atlas.entries[0].clone();
        retyped.kind = EntryKind::Concept;
        assert_eq!(
            codes_of(atlas.upsert_entry(retyped, links)),
            vec![AtlasDiagnosticCode::EndpointKind]
        );
        let mut dangling = atlas.relationships[0].clone();
        dangling.to = "ghost".into();
        assert_eq!(
            codes_of(atlas.upsert_relationship(dangling, links)),
            vec![AtlasDiagnosticCode::UnknownEntry]
        );
        let mut shadow = atlas.entries[0].clone();
        shadow.extra.insert("label".into(), json!("Other"));
        assert_eq!(
            codes_of(atlas.upsert_entry(shadow, links)),
            vec![AtlasDiagnosticCode::ShadowedField]
        );
        let mut top = atlas.clone();
        top.extra.insert("entries".into(), json!([]));
        assert!(Atlas::validated(&top, links).is_err());
        assert_eq!(atlas, before);
        let mut renamed = atlas.entries[0].clone();
        renamed.label = "Plato of Athens".into();
        atlas
            .upsert_entry(renamed, links)
            .expect("relabel keeps identity");
        assert_eq!(atlas.entries[0].label, "Plato of Athens");
        assert_eq!(atlas.entries.len(), 5);
    }

    #[test]
    fn unknown_fields_survive_every_level_deterministically() {
        let mut value = sample();
        value["relationships"][1]["evidence"] = json!([{"source": "republic-slings",
            "locators": [{"kind": "page", "value": "1", "zz": 1}], "future": {"b": 1, "a": 2}}]);
        value["zeta"] = json!([1]);
        value["entries"][0]["extra"] = json!("kept");
        value["entries"][0]["bounds"]["calendar"] = json!("julian");
        value["relationships"][0]["assertedBy"]["orcid"] = json!("x");
        value["relationships"][1]["contestedBy"] =
            json!([{"by": {"kind": "author", "x": 1}, "note": "n", "y": 2}]);
        let atlas = parse(value).expect("valid");
        let text = atlas.to_json();
        for needle in [
            "\"zz\"",
            "\"future\"",
            "\"zeta\"",
            "\"extra\": \"kept\"",
            "\"calendar\"",
            "\"orcid\"",
            "\"y\": 2",
            "\"x\": 1",
        ] {
            assert!(text.contains(needle), "{needle}");
        }
        let library = library();
        let again = Atlas::parse(
            &text,
            Links {
                library: &library,
                notebook: &Notebook::default(),
            },
        )
        .unwrap();
        assert_eq!(again.to_json(), text);
    }

    #[test]
    fn hostile_and_oversized_input_is_refused_with_scoped_diagnostics() {
        let mut hostile = sample();
        hostile["entries"][0]["label"] = json!("a\u{202e}b");
        hostile["entries"][1]["summary"] = json!("x\u{0}y");
        hostile["entries"][2]["aliases"] = json!(["ok", "ok", 5]);
        hostile["entries"][3]["bounds"] = json!({"from": 0, "until": -5});
        hostile["entries"][4]["id"] = json!("../etc");
        let found = parse(hostile).expect_err("hostile");
        assert!(found.len() >= 6);
        assert!(found.iter().all(|d| d.collection.is_some()));
        assert!(found.iter().all(|d| !d.message.contains('\u{202e}')));
        assert_eq!(found[0].index, Some(0));
        assert_eq!(found[0].field.as_deref(), Some("label"));

        assert_eq!(
            codes(parse(json!({"version": 2}))),
            vec![AtlasDiagnosticCode::UnsupportedVersion]
        );
        assert_eq!(
            codes(parse(json!({"entries": []}))),
            vec![AtlasDiagnosticCode::MissingField]
        );
        assert_eq!(
            codes(parse(json!([]))),
            vec![AtlasDiagnosticCode::InvalidField]
        );
        let library = library();
        let links = Links {
            library: &library,
            notebook: &Notebook::default(),
        };
        assert_eq!(
            Atlas::parse("{nope", links).unwrap_err()[0].code,
            AtlasDiagnosticCode::InvalidJson
        );
        let huge = " ".repeat(MAX_ATLAS_BYTES + 1);
        assert_eq!(
            Atlas::parse(&huge, links).unwrap_err()[0].code,
            AtlasDiagnosticCode::TooLarge
        );
        let mut many = sample();
        many["relationships"][0]["evidence"] =
            json!(vec![json!({"source": "scholar-book"}); MAX_EVIDENCE + 1]);
        assert_eq!(codes(parse(many)), vec![AtlasDiagnosticCode::TooLarge]);
        let mut long = sample();
        long["entries"][0]["summary"] = json!("é".repeat(MAX_SUMMARY_CHARS + 1));
        assert_eq!(codes(parse(long)), vec![AtlasDiagnosticCode::TooLarge]);
        let mut dup = sample();
        dup["relationships"][0]["id"] = json!("plato");
        assert_eq!(codes(parse(dup)), vec![AtlasDiagnosticCode::DuplicateId]);
        let bom = format!("\u{feff}{}", sample());
        assert_eq!(Atlas::parse(&bom, links).unwrap(), valid());
    }

    #[test]
    fn source_usage_guards_for_the_storage_slice() {
        let atlas = valid();
        assert_eq!(atlas.uses_of_source("plato-republic"), vec!["republic"]);
        assert_eq!(atlas.uses_of_source("scholar-book"), vec!["r-authored"]);
        assert_eq!(
            atlas.uses_of_source("republic-slings"),
            vec!["r-authored", "r-infl"]
        );
        assert!(atlas.uses_of_source("paris-gr-1807").is_empty());
        let mut value = sample();
        value["relationships"][1]["evidence"][0]["passage"] = json!("p-cave");
        let with_notebook = parse_with(value, &notebook()).expect("valid");
        assert_eq!(with_notebook.uses_of_passage("p-cave"), vec!["r-infl"]);
    }
}

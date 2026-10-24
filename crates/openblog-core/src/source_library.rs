//! Private research source library: works, editions, translations, witnesses,
//! and references with stable identities and a versioned, lossless file format.
//!
//! The library is author research data. Nothing here renders, publishes, or
//! contacts a metadata service; validation is offline and structural, and it
//! never rates a source's accuracy or authority.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::contributor::{valid_registry_key, Contributor};
use crate::research::{absolute_http_url, normalize_doi_url};

/// The only library file version this release reads and writes.
pub const LIBRARY_VERSION: u64 = 1;
/// Upper bound on a serialized library, checked before JSON parsing.
pub const MAX_LIBRARY_BYTES: usize = 4 * 1024 * 1024;
/// Upper bound on the number of records in one library.
pub const MAX_SOURCES: usize = 10_000;
const MAX_ID_BYTES: usize = 64;
const MAX_TEXT_CHARS: usize = 1_000;

const CREATOR_ROLES: &[&str] = &[
    "author",
    "editor",
    "translator",
    "compiler",
    "scribe",
    "other",
];
const LOCATION_SCHEMES: &[&str] = &[
    "page",
    "folio",
    "line",
    "section",
    "chapter",
    "canonical",
    "timestamp",
];
/// Field names that belong to contributor credit sidecars. A source record
/// describes a researched work; it never carries or points at work credits.
const CREDIT_FIELDS: &[&str] = &["credit", "credits", "contributor", "contributors"];
const RECORD_FIELDS: &[&str] = &[
    "id",
    "kind",
    "title",
    "creators",
    "language",
    "issued",
    "of",
    "basedOn",
    "location",
    "identifiers",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Work,
    Edition,
    Translation,
    Witness,
    Reference,
}

impl SourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Work => "work",
            Self::Edition => "edition",
            Self::Translation => "translation",
            Self::Witness => "witness",
            Self::Reference => "reference",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "work" => Self::Work,
            "edition" => Self::Edition,
            "translation" => Self::Translation,
            "witness" => Self::Witness,
            "reference" => Self::Reference,
            _ => return None,
        })
    }

    /// Kinds an `of` relationship from this kind may point at.
    fn of_targets(self) -> &'static [SourceKind] {
        match self {
            Self::Work => &[],
            Self::Edition => &[Self::Work, Self::Translation],
            Self::Translation => &[Self::Work],
            Self::Witness => &[Self::Work, Self::Edition, Self::Translation],
            Self::Reference => &[Self::Work, Self::Edition, Self::Translation, Self::Witness],
        }
    }
}

impl SourceKind {
    fn with_article(self) -> &'static str {
        match self {
            Self::Work => "a work",
            Self::Edition => "an edition",
            Self::Translation => "a translation",
            Self::Witness => "a witness",
            Self::Reference => "a reference",
        }
    }
}

impl fmt::Display for SourceKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A descriptive name recorded on a source, such as a manuscript's scribe.
/// Creators are bibliographic description, not contributor credits.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCreator {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A scheme-qualified bibliographic identifier such as a DOI or ISBN. It
/// describes the record and never replaces its stable source identifier.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SourceIdentifier {
    pub scheme: String,
    pub value: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// A position inside the source a reference points at.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SourceLocation {
    pub scheme: String,
    pub value: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecord {
    /// Stable, author-assigned identity. It never changes with the title.
    pub id: String,
    pub kind: SourceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub creators: Vec<SourceCreator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Authored date text, kept verbatim (`2003`, `c. 375 BCE`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued: Option<String>,
    /// The source this record realizes, translates, attests, or describes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub of: Option<String>,
    /// For a translation, the edition, witness, or translation it was made from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub based_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<SourceLocation>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub identifiers: Vec<SourceIdentifier>,
    /// Fields this release does not understand, preserved verbatim.
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SourceLibrary {
    pub version: u64,
    pub sources: Vec<SourceRecord>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for SourceLibrary {
    fn default() -> Self {
        Self {
            version: LIBRARY_VERSION,
            sources: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceDiagnosticCode {
    TooLarge,
    InvalidJson,
    UnsupportedVersion,
    MissingField,
    InvalidField,
    InvalidId,
    DuplicateId,
    UnknownKind,
    KindChanged,
    UnknownSource,
    UnresolvedRelationship,
    InvalidRelationship,
    AmbiguousRelationship,
    RelationshipCycle,
    AmbiguousLocation,
    InvalidIdentifier,
    ContributorCredit,
}

impl fmt::Display for SourceDiagnosticCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TooLarge => "too-large",
            Self::InvalidJson => "invalid-json",
            Self::UnsupportedVersion => "unsupported-version",
            Self::MissingField => "missing-field",
            Self::InvalidField => "invalid-field",
            Self::InvalidId => "invalid-id",
            Self::DuplicateId => "duplicate-id",
            Self::UnknownKind => "unknown-kind",
            Self::KindChanged => "kind-changed",
            Self::UnknownSource => "unknown-source",
            Self::UnresolvedRelationship => "unresolved-relationship",
            Self::InvalidRelationship => "invalid-relationship",
            Self::AmbiguousRelationship => "ambiguous-relationship",
            Self::RelationshipCycle => "relationship-cycle",
            Self::AmbiguousLocation => "ambiguous-location",
            Self::InvalidIdentifier => "invalid-identifier",
            Self::ContributorCredit => "contributor-credit",
        })
    }
}

/// A problem scoped to the library, one record, or one field of a record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDiagnostic {
    pub code: SourceDiagnosticCode,
    /// Zero-based position in `sources`, when the problem belongs to a record.
    pub index: Option<usize>,
    pub source_id: Option<String>,
    /// Field path inside the record, such as `of` or `identifiers[0].value`.
    pub field: Option<String>,
    pub message: String,
}

impl fmt::Display for SourceDiagnostic {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.index, &self.source_id) {
            (Some(index), Some(id)) => write!(formatter, "sources[{index}] `{id}`")?,
            (Some(index), None) => write!(formatter, "sources[{index}]")?,
            (None, _) => formatter.write_str("source library")?,
        }
        if let Some(field) = &self.field {
            write!(formatter, " {field}")?;
        }
        write!(formatter, ": {} ({})", self.message, self.code)
    }
}

impl SourceLibrary {
    /// Parse and validate a serialized library. Every problem found is
    /// returned at once, each scoped as narrowly as possible; nothing is
    /// partially accepted.
    pub fn parse(
        text: &str,
        contributors: &BTreeMap<String, Contributor>,
    ) -> Result<Self, Vec<SourceDiagnostic>> {
        let mut diagnostics = Vec::new();
        if text.len() > MAX_LIBRARY_BYTES {
            diagnostics.push(library_diagnostic(
                SourceDiagnosticCode::TooLarge,
                None,
                format!("the library is larger than {MAX_LIBRARY_BYTES} bytes"),
            ));
            return Err(diagnostics);
        }
        let value: Value = match serde_json::from_str(text) {
            Ok(value) => value,
            Err(error) => {
                diagnostics.push(library_diagnostic(
                    SourceDiagnosticCode::InvalidJson,
                    None,
                    format!("invalid JSON: {error}"),
                ));
                return Err(diagnostics);
            }
        };
        let Value::Object(mut root) = value else {
            diagnostics.push(library_diagnostic(
                SourceDiagnosticCode::InvalidField,
                None,
                "the library must be a JSON object".into(),
            ));
            return Err(diagnostics);
        };
        if root.contains_key("credits") && !root.contains_key("sources") {
            diagnostics.push(library_diagnostic(
                SourceDiagnosticCode::ContributorCredit,
                Some("credits"),
                "this is a contributor credit sidecar; work credits record who made a post and are never bibliographic sources".into(),
            ));
            return Err(diagnostics);
        }

        let version = match root.remove("version") {
            Some(Value::Number(number)) if number.as_u64() == Some(LIBRARY_VERSION) => {
                LIBRARY_VERSION
            }
            Some(Value::Number(number)) if number.as_u64().is_some_and(|v| v > LIBRARY_VERSION) => {
                diagnostics.push(library_diagnostic(
                    SourceDiagnosticCode::UnsupportedVersion,
                    Some("version"),
                    format!(
                        "library version {number} was written by a newer open.blog; upgrade before editing so newer data is not lost"
                    ),
                ));
                return Err(diagnostics);
            }
            Some(_) => {
                diagnostics.push(library_diagnostic(
                    SourceDiagnosticCode::UnsupportedVersion,
                    Some("version"),
                    format!("version must be {LIBRARY_VERSION}"),
                ));
                return Err(diagnostics);
            }
            None => {
                diagnostics.push(library_diagnostic(
                    SourceDiagnosticCode::MissingField,
                    Some("version"),
                    format!("add `\"version\": {LIBRARY_VERSION}`"),
                ));
                return Err(diagnostics);
            }
        };

        let raw_sources = match root.remove("sources") {
            Some(Value::Array(sources)) => sources,
            Some(_) => {
                diagnostics.push(library_diagnostic(
                    SourceDiagnosticCode::InvalidField,
                    Some("sources"),
                    "sources must be a JSON array".into(),
                ));
                return Err(diagnostics);
            }
            None => {
                diagnostics.push(library_diagnostic(
                    SourceDiagnosticCode::MissingField,
                    Some("sources"),
                    "add a `sources` array".into(),
                ));
                return Err(diagnostics);
            }
        };
        if raw_sources.len() > MAX_SOURCES {
            diagnostics.push(library_diagnostic(
                SourceDiagnosticCode::TooLarge,
                Some("sources"),
                format!("a library may hold at most {MAX_SOURCES} sources"),
            ));
            return Err(diagnostics);
        }

        let mut identities = Vec::new();
        let mut parsed = Vec::with_capacity(raw_sources.len());
        for (index, raw) in raw_sources.into_iter().enumerate() {
            let (id, record) = parse_record(index, raw, &mut diagnostics);
            if let Some(id) = id {
                identities.push((index, id, record.as_ref().map(|record| record.kind)));
            }
            if let Some(record) = record {
                parsed.push((index, record));
            }
        }
        validate_relationships(&identities, &parsed, contributors, &mut diagnostics);
        if !diagnostics.is_empty() {
            diagnostics.sort_by_key(|diagnostic| diagnostic.index);
            return Err(diagnostics);
        }
        Ok(Self {
            version,
            sources: parsed.into_iter().map(|(_, record)| record).collect(),
            extra: root.into_iter().collect(),
        })
    }

    /// Deterministic, pretty-printed JSON with a trailing newline.
    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).unwrap_or_default();
        text.push('\n');
        text
    }

    /// Add a record, or replace the record with the same identifier in place.
    /// The library changes only when the whole result is valid, and an
    /// identifier never changes kind.
    pub fn upsert(
        &mut self,
        record: SourceRecord,
        contributors: &BTreeMap<String, Contributor>,
    ) -> Result<(), Vec<SourceDiagnostic>> {
        let mut candidate = self.clone();
        let position = candidate
            .sources
            .iter()
            .position(|existing| existing.id == record.id);
        let index = position.unwrap_or(candidate.sources.len());
        if let Some(shadowed) = record
            .extra
            .keys()
            .find(|key| RECORD_FIELDS.contains(&key.as_str()))
        {
            return Err(vec![record_diagnostic(
                SourceDiagnosticCode::InvalidField,
                index,
                &record.id,
                shadowed,
                "an unknown field cannot shadow a defined field".into(),
            )]);
        }
        match position {
            Some(index) => {
                let existing = candidate.sources[index].kind;
                if existing != record.kind {
                    return Err(vec![record_diagnostic(
                        SourceDiagnosticCode::KindChanged,
                        index,
                        &record.id,
                        "kind",
                        format!(
                            "`{}` is a {existing}; record the {} as a new source with its own id",
                            record.id, record.kind
                        ),
                    )]);
                }
                candidate.sources[index] = record;
            }
            None => candidate.sources.push(record),
        }
        *self = Self::parse(&candidate.to_json(), contributors)?;
        Ok(())
    }

    /// Remove a record. Removal fails, leaving the library unchanged, while
    /// any other record still depends on it.
    pub fn remove(
        &mut self,
        id: &str,
        contributors: &BTreeMap<String, Contributor>,
    ) -> Result<SourceRecord, Vec<SourceDiagnostic>> {
        let Some(index) = self.sources.iter().position(|record| record.id == id) else {
            return Err(vec![SourceDiagnostic {
                code: SourceDiagnosticCode::UnknownSource,
                index: None,
                source_id: Some(id.into()),
                field: None,
                message: format!("no source has the id `{id}`"),
            }]);
        };
        let mut candidate = self.clone();
        let removed = candidate.sources.remove(index);
        *self = Self::parse(&candidate.to_json(), contributors)?;
        Ok(removed)
    }
}

fn record_diagnostic(
    code: SourceDiagnosticCode,
    index: usize,
    id: &str,
    field: &str,
    message: String,
) -> SourceDiagnostic {
    SourceDiagnostic {
        code,
        index: Some(index),
        source_id: Some(id.into()),
        field: Some(field.into()),
        message,
    }
}

fn validate_relationships(
    identities: &[(usize, String, Option<SourceKind>)],
    records: &[(usize, SourceRecord)],
    contributors: &BTreeMap<String, Contributor>,
    diagnostics: &mut Vec<SourceDiagnostic>,
) {
    // Records that failed to parse still own their identifier, so references
    // to them are not reported a second time.
    let mut known: BTreeMap<&str, (usize, Option<SourceKind>)> = BTreeMap::new();
    for (index, id, kind) in identities {
        if let Some((first, _)) = known.get(id.as_str()) {
            diagnostics.push(record_diagnostic(
                SourceDiagnosticCode::DuplicateId,
                *index,
                id,
                "id",
                format!(
                    "`{id}` is already used by sources[{first}]; every source needs its own id"
                ),
            ));
        } else {
            known.insert(id, (*index, *kind));
        }
    }

    // Only edges that passed every check take part in the graph checks below.
    let mut of_edges: BTreeMap<&str, (&str, SourceKind)> = BTreeMap::new();
    let mut based_on_edges: BTreeMap<&str, &str> = BTreeMap::new();
    for (index, record) in records {
        // A duplicate is reported once; its relationships are ambiguous.
        if known.get(record.id.as_str()).map(|(first, _)| first) != Some(index) {
            continue;
        }
        let edges = [
            ("of", record.of.as_deref(), record.kind.of_targets()),
            (
                "basedOn",
                record.based_on.as_deref(),
                &[
                    SourceKind::Edition,
                    SourceKind::Witness,
                    SourceKind::Translation,
                ][..],
            ),
        ];
        for (field, target, permitted) in edges {
            let Some(target) = target else {
                continue;
            };
            let report =
                |code, message| record_diagnostic(code, *index, &record.id, field, message);
            if target == record.id {
                diagnostics.push(report(
                    SourceDiagnosticCode::InvalidRelationship,
                    format!("a source cannot be `{field}` itself"),
                ));
                continue;
            }
            let Some((_, target_kind)) = known.get(target) else {
                diagnostics.push(if contributors.contains_key(target) {
                    report(
                        SourceDiagnosticCode::ContributorCredit,
                        format!(
                            "`{target}` is a contributor; work credits are attribution and cannot be cited as a source"
                        ),
                    )
                } else {
                    report(
                        SourceDiagnosticCode::UnresolvedRelationship,
                        format!("no source has the id `{target}`"),
                    )
                });
                continue;
            };
            let Some(target_kind) = target_kind else {
                continue;
            };
            if !permitted.contains(target_kind) {
                diagnostics.push(report(
                    SourceDiagnosticCode::InvalidRelationship,
                    format!(
                        "{} cannot be `{field}` the {target_kind} `{target}`; point it at {}",
                        record.kind.with_article(),
                        kind_list(permitted)
                    ),
                ));
                continue;
            }
            if field == "of" {
                of_edges.insert(&record.id, (target, *target_kind));
            } else {
                based_on_edges.insert(&record.id, target);
            }
        }
    }

    for (index, record) in records {
        if let (Some(source_text), Some(work)) = (
            based_on_edges.get(record.id.as_str()),
            of_edges.get(record.id.as_str()).map(|(work, _)| *work),
        ) {
            if depends_on(source_text, &record.id, &of_edges, &based_on_edges) {
                diagnostics.push(record_diagnostic(
                    SourceDiagnosticCode::RelationshipCycle,
                    *index,
                    &record.id,
                    "basedOn",
                    format!(
                        "`{}` is based on `{source_text}`, which itself depends on `{}`",
                        record.id, record.id
                    ),
                ));
            } else if let Some(other) =
                root_work(source_text, &of_edges, &known).filter(|root| *root != work)
            {
                diagnostics.push(record_diagnostic(
                    SourceDiagnosticCode::AmbiguousRelationship,
                    *index,
                    &record.id,
                    "basedOn",
                    format!(
                        "this translation is `of` `{work}` but is based on `{source_text}`, which belongs to `{other}`; record one translation per original work"
                    ),
                ));
            }
        }

        if let (Some(location), Some((target, target_kind))) =
            (&record.location, of_edges.get(record.id.as_str()))
        {
            let message = match location.scheme.as_str() {
                "page" if *target_kind == SourceKind::Work => Some(format!(
                    "pages differ between editions of the work `{target}`; point this reference at the edition, translation, or witness whose pages are cited"
                )),
                "folio" if *target_kind != SourceKind::Witness => Some(format!(
                    "folios belong to one manuscript or copy, but `{target}` is a {target_kind}; point this reference at a witness"
                )),
                _ => None,
            };
            if let Some(message) = message {
                diagnostics.push(record_diagnostic(
                    SourceDiagnosticCode::AmbiguousLocation,
                    *index,
                    &record.id,
                    "location.scheme",
                    message,
                ));
            }
        }
    }
}

/// Whether following valid edges from `start` reaches `goal`.
fn depends_on(
    start: &str,
    goal: &str,
    of_edges: &BTreeMap<&str, (&str, SourceKind)>,
    based_on_edges: &BTreeMap<&str, &str>,
) -> bool {
    let mut pending = vec![start];
    let mut seen = BTreeSet::new();
    while let Some(current) = pending.pop() {
        if current == goal {
            return true;
        }
        if !seen.insert(current) {
            continue;
        }
        pending.extend(of_edges.get(current).map(|(target, _)| *target));
        pending.extend(based_on_edges.get(current).copied());
    }
    false
}

/// The work a record ultimately realizes, following only `of` edges.
fn root_work<'a>(
    start: &'a str,
    of_edges: &BTreeMap<&'a str, (&'a str, SourceKind)>,
    known: &BTreeMap<&str, (usize, Option<SourceKind>)>,
) -> Option<&'a str> {
    let mut current = start;
    for _ in 0..=SourceKind::Reference as usize {
        if known.get(current).and_then(|(_, kind)| *kind) == Some(SourceKind::Work) {
            return Some(current);
        }
        current = of_edges.get(current)?.0;
    }
    None
}

fn kind_list(kinds: &[SourceKind]) -> String {
    let names: Vec<&str> = kinds.iter().map(|kind| kind.with_article()).collect();
    match names.as_slice() {
        [] => "nothing".into(),
        [only] => (*only).to_string(),
        [rest @ .., last] => format!("{} or {last}", rest.join(", ")),
    }
}

fn library_diagnostic(
    code: SourceDiagnosticCode,
    field: Option<&str>,
    message: String,
) -> SourceDiagnostic {
    SourceDiagnostic {
        code,
        index: None,
        source_id: None,
        field: field.map(str::to_string),
        message,
    }
}

/// Field-by-field reader for one raw record, so each problem names its field.
struct RecordReader<'a> {
    index: usize,
    id: Option<String>,
    fields: Map<String, Value>,
    diagnostics: &'a mut Vec<SourceDiagnostic>,
    failed: bool,
}

impl RecordReader<'_> {
    fn report(&mut self, code: SourceDiagnosticCode, field: Option<String>, message: String) {
        self.failed = true;
        self.diagnostics.push(SourceDiagnostic {
            code,
            index: Some(self.index),
            source_id: self.id.clone(),
            field,
            message,
        });
    }

    fn take_text(&mut self, field: &str) -> Option<String> {
        let value = self.fields.remove(field)?;
        let Value::String(text) = value else {
            self.report(
                SourceDiagnosticCode::InvalidField,
                Some(field.into()),
                "must be a string".into(),
            );
            return None;
        };
        self.check_text(field.into(), &text);
        Some(text)
    }

    /// Report a problem with authored text.
    fn check_text(&mut self, field: String, text: &str) {
        if text.trim().is_empty() {
            self.report(
                SourceDiagnosticCode::InvalidField,
                Some(field),
                "must not be empty".into(),
            );
        } else if text.chars().count() > MAX_TEXT_CHARS {
            self.report(
                SourceDiagnosticCode::TooLarge,
                Some(field),
                format!("must be at most {MAX_TEXT_CHARS} characters"),
            );
        } else if text.chars().any(char::is_control) {
            self.report(
                SourceDiagnosticCode::InvalidField,
                Some(field),
                "must not contain control characters".into(),
            );
        }
    }

    fn take_id(&mut self, field: &str) -> Option<String> {
        let before = self.diagnostics.len();
        let id = self.take_text(field)?;
        if self.diagnostics.len() == before && !valid_source_id(&id) {
            self.report(
                SourceDiagnosticCode::InvalidId,
                Some(field.into()),
                format!(
                    "`{id}` is not a source identifier; use a lowercase ASCII slug of at most {MAX_ID_BYTES} bytes such as `plato-republic`"
                ),
            );
        }
        Some(id)
    }

    fn take_array(&mut self, field: &str) -> Vec<(String, Map<String, Value>)> {
        let Some(value) = self.fields.remove(field) else {
            return Vec::new();
        };
        let Value::Array(items) = value else {
            self.report(
                SourceDiagnosticCode::InvalidField,
                Some(field.into()),
                "must be an array of objects".into(),
            );
            return Vec::new();
        };
        let mut objects = Vec::with_capacity(items.len());
        for (position, item) in items.into_iter().enumerate() {
            let path = format!("{field}[{position}]");
            match item {
                Value::Object(object) => objects.push((path, object)),
                _ => self.report(
                    SourceDiagnosticCode::InvalidField,
                    Some(path),
                    "must be an object".into(),
                ),
            }
        }
        objects
    }

    fn nested_text(
        &mut self,
        object: &mut Map<String, Value>,
        path: &str,
        field: &str,
        required: bool,
    ) -> Option<String> {
        let full = format!("{path}.{field}");
        match object.remove(field) {
            Some(Value::String(text)) => {
                self.check_text(full, &text);
                Some(text)
            }
            Some(_) => {
                self.report(
                    SourceDiagnosticCode::InvalidField,
                    Some(full),
                    "must be a string".into(),
                );
                None
            }
            None if required => {
                self.report(
                    SourceDiagnosticCode::MissingField,
                    Some(full),
                    "is required".into(),
                );
                None
            }
            None => None,
        }
    }

    /// Credit sidecar fields never belong in a source record.
    fn reject_credit_fields(&mut self, object: &Map<String, Value>, path: Option<&str>) {
        for field in CREDIT_FIELDS {
            if object.contains_key(*field) {
                let full = match path {
                    Some(path) => format!("{path}.{field}"),
                    None => (*field).to_string(),
                };
                self.report(
                    SourceDiagnosticCode::ContributorCredit,
                    Some(full),
                    "contributor credits stay in `.credits.json` sidecars; describe a source's makers as `creators`".into(),
                );
            }
        }
    }
}

/// Parse one raw record. Returns the identifier whenever it was readable, so
/// a broken record still owns its id, and the record only when it is valid.
fn parse_record(
    index: usize,
    raw: Value,
    diagnostics: &mut Vec<SourceDiagnostic>,
) -> (Option<String>, Option<SourceRecord>) {
    let Value::Object(fields) = raw else {
        diagnostics.push(SourceDiagnostic {
            code: SourceDiagnosticCode::InvalidField,
            index: Some(index),
            source_id: None,
            field: None,
            message: "each source must be a JSON object".into(),
        });
        return (None, None);
    };
    let mut reader = RecordReader {
        index,
        id: None,
        fields,
        diagnostics,
        failed: false,
    };

    let id = match reader.fields.get("id") {
        Some(Value::String(id)) if valid_source_id(id) => Some(id.clone()),
        _ => None,
    };
    reader.id = id.clone();
    if reader.fields.contains_key("id") {
        reader.take_id("id");
    } else {
        reader.report(
            SourceDiagnosticCode::MissingField,
            Some("id".into()),
            "every source needs a stable `id`".into(),
        );
    }

    let kind = match reader.fields.remove("kind") {
        Some(Value::String(kind)) => match SourceKind::parse(&kind) {
            Some(kind) => Some(kind),
            None if CREDIT_FIELDS.contains(&kind.as_str()) => {
                reader.report(
                    SourceDiagnosticCode::ContributorCredit,
                    Some("kind".into()),
                    "contributors are credited in `.credits.json` sidecars and are never sources"
                        .into(),
                );
                None
            }
            None => {
                reader.report(
                    SourceDiagnosticCode::UnknownKind,
                    Some("kind".into()),
                    format!(
                        "`{kind}` is not a source kind; use work, edition, translation, witness, or reference"
                    ),
                );
                None
            }
        },
        Some(_) => {
            reader.report(
                SourceDiagnosticCode::InvalidField,
                Some("kind".into()),
                "must be a string".into(),
            );
            None
        }
        None => {
            reader.report(
                SourceDiagnosticCode::MissingField,
                Some("kind".into()),
                "add a kind: work, edition, translation, witness, or reference".into(),
            );
            None
        }
    };

    let title = reader.take_text("title");
    let language = reader.take_text("language");
    let issued = reader.take_text("issued");
    let of = reader.take_id("of");
    let based_on = reader.take_id("basedOn");

    let mut creators = Vec::new();
    for (path, mut object) in reader.take_array("creators") {
        let name = reader.nested_text(&mut object, &path, "name", true);
        let role = reader.nested_text(&mut object, &path, "role", false);
        if role
            .as_deref()
            .is_some_and(|role| !CREATOR_ROLES.contains(&role))
        {
            reader.report(
                SourceDiagnosticCode::InvalidField,
                Some(format!("{path}.role")),
                format!("use one of: {}", CREATOR_ROLES.join(", ")),
            );
        }
        reader.reject_credit_fields(&object, Some(&path));
        if let Some(name) = name {
            creators.push(SourceCreator {
                name,
                role,
                extra: object.into_iter().collect(),
            });
        }
    }

    let mut identifiers = Vec::new();
    for (path, mut object) in reader.take_array("identifiers") {
        let scheme = reader.nested_text(&mut object, &path, "scheme", true);
        let value = reader.nested_text(&mut object, &path, "value", true);
        let (Some(scheme), Some(value)) = (scheme, value) else {
            continue;
        };
        if let Err(message) = check_identifier(&scheme, &value) {
            reader.report(SourceDiagnosticCode::InvalidIdentifier, Some(path), message);
        }
        identifiers.push(SourceIdentifier {
            scheme,
            value,
            extra: object.into_iter().collect(),
        });
    }

    let location = match reader.fields.remove("location") {
        Some(Value::Object(mut object)) => {
            let scheme = reader.nested_text(&mut object, "location", "scheme", true);
            let value = reader.nested_text(&mut object, "location", "value", true);
            if let Some(scheme) = &scheme {
                if !LOCATION_SCHEMES.contains(&scheme.as_str()) {
                    reader.report(
                        SourceDiagnosticCode::InvalidField,
                        Some("location.scheme".into()),
                        format!("use one of: {}", LOCATION_SCHEMES.join(", ")),
                    );
                } else if scheme == "timestamp"
                    && value
                        .as_deref()
                        .is_some_and(|value| !valid_timestamp(value))
                {
                    reader.report(
                        SourceDiagnosticCode::InvalidField,
                        Some("location.value".into()),
                        "use seconds or `h:mm:ss`, optionally with a decimal fraction".into(),
                    );
                }
            }
            scheme.zip(value).map(|(scheme, value)| SourceLocation {
                scheme,
                value,
                extra: object.into_iter().collect(),
            })
        }
        Some(_) => {
            reader.report(
                SourceDiagnosticCode::InvalidField,
                Some("location".into()),
                "must be an object".into(),
            );
            None
        }
        None => None,
    };
    let fields = std::mem::take(&mut reader.fields);
    reader.reject_credit_fields(&fields, None);

    if let Some(kind) = kind {
        check_kind_fields(
            &mut reader,
            kind,
            KindFields {
                title: title.is_some(),
                language: language.as_deref(),
                of: of.is_some(),
                based_on: based_on.is_some(),
                location: location.is_some(),
            },
        );
    }

    let failed = reader.failed;
    let (Some(record_id), Some(kind), false) = (id.clone(), kind, failed) else {
        return (id, None);
    };
    let record = SourceRecord {
        id: record_id,
        kind,
        title,
        creators,
        language,
        issued,
        of,
        based_on,
        location,
        identifiers,
        extra: fields.into_iter().collect(),
    };
    (id, Some(record))
}

struct KindFields<'a> {
    title: bool,
    language: Option<&'a str>,
    of: bool,
    based_on: bool,
    location: bool,
}

fn check_kind_fields(reader: &mut RecordReader<'_>, kind: SourceKind, fields: KindFields<'_>) {
    if kind == SourceKind::Work && fields.of {
        reader.report(
            SourceDiagnosticCode::InvalidRelationship,
            Some("of".into()),
            "a work stands alone; record each edition, translation, or witness as its own source that points at the work".into(),
        );
    }
    if kind != SourceKind::Work && !fields.of {
        reader.report(
            SourceDiagnosticCode::MissingField,
            Some("of".into()),
            format!(
                "{} must name the source it belongs to: {}",
                kind.with_article(),
                kind_list(kind.of_targets())
            ),
        );
    }
    if kind != SourceKind::Translation && fields.based_on {
        reader.report(
            SourceDiagnosticCode::InvalidRelationship,
            Some("basedOn".into()),
            "only a translation is based on another text".into(),
        );
    }
    if kind != SourceKind::Reference && !fields.title {
        reader.report(
            SourceDiagnosticCode::MissingField,
            Some("title".into()),
            format!("{} needs a title", kind.with_article()),
        );
    }
    if kind != SourceKind::Reference && fields.location {
        reader.report(
            SourceDiagnosticCode::InvalidField,
            Some("location".into()),
            "only a reference has a location; add a reference that points at this source".into(),
        );
    }
    match fields.language {
        Some(language) if !valid_language_tag(language) => reader.report(
            SourceDiagnosticCode::InvalidField,
            Some("language".into()),
            format!("`{language}` is not a language tag such as `en` or `grc`"),
        ),
        None if kind == SourceKind::Translation => reader.report(
            SourceDiagnosticCode::MissingField,
            Some("language".into()),
            "a translation needs the language tag it was translated into".into(),
        ),
        _ => {}
    }
}

fn valid_source_id(value: &str) -> bool {
    value.len() <= MAX_ID_BYTES && valid_registry_key(value)
}

/// BCP 47 shape only: a 2–8 letter primary subtag and 1–8 character subtags.
fn valid_language_tag(value: &str) -> bool {
    let mut subtags = value.split('-');
    let primary = subtags.next().unwrap_or_default();
    (2..=8).contains(&primary.len())
        && primary.bytes().all(|byte| byte.is_ascii_alphabetic())
        && subtags.all(|subtag| {
            (1..=8).contains(&subtag.len())
                && subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

fn valid_timestamp(value: &str) -> bool {
    let (clock, fraction) = value.split_once('.').unwrap_or((value, "0"));
    let parts: Vec<&str> = clock.split(':').collect();
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    digits(fraction)
        && (1..=3).contains(&parts.len())
        && digits(parts[0])
        && parts[1..]
            .iter()
            .all(|part| part.len() == 2 && digits(part) && part.as_bytes()[0] < b'6')
}

/// Offline structural checks for known schemes; other schemes are kept as
/// authored once their name is a lowercase slug.
fn check_identifier(scheme: &str, value: &str) -> Result<(), String> {
    match scheme {
        "doi" if normalize_doi_url(value).is_none() => {
            Err("not a DOI such as `10.1234/example` or its `https://doi.org/` URL".into())
        }
        "url" if !absolute_http_url(value) => {
            Err("must be an absolute HTTP(S) URL without credentials".into())
        }
        "isbn" if !valid_isbn(value) => {
            Err("not an ISBN-10 or ISBN-13 with a valid check digit".into())
        }
        "issn" if !valid_issn(value) => Err("not an ISSN with a valid check digit".into()),
        "doi" | "url" | "isbn" | "issn" => Ok(()),
        _ if !valid_registry_key(scheme) => Err(format!(
            "`{scheme}` is not an identifier scheme; use a lowercase slug such as `oclc`"
        )),
        _ => Ok(()),
    }
}

fn check_digits(value: &str) -> Vec<u32> {
    value
        .chars()
        .filter(|character| *character != '-' && *character != ' ')
        .map(|character| match character {
            'X' | 'x' => 10,
            _ => character.to_digit(10).unwrap_or(u32::MAX),
        })
        .collect()
}

fn valid_isbn(value: &str) -> bool {
    let digits = check_digits(value);
    let body_ok = |body: &[u32]| body.iter().all(|digit| *digit < 10);
    match digits.len() {
        10 => {
            body_ok(&digits[..9])
                && digits[9] <= 10
                && digits
                    .iter()
                    .zip((1..=10).rev())
                    .map(|(digit, weight)| digit * weight)
                    .sum::<u32>()
                    % 11
                    == 0
        }
        13 => {
            body_ok(&digits)
                && digits
                    .iter()
                    .enumerate()
                    .map(|(position, digit)| if position % 2 == 0 { *digit } else { digit * 3 })
                    .sum::<u32>()
                    % 10
                    == 0
        }
        _ => false,
    }
}

fn valid_issn(value: &str) -> bool {
    let digits = check_digits(value);
    digits.len() == 8
        && digits[..7].iter().all(|digit| *digit < 10)
        && digits[7] <= 10
        && digits
            .iter()
            .zip((1..=8).rev())
            .map(|(digit, weight)| digit * weight)
            .sum::<u32>()
            % 11
            == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_digits_follow_isbn_and_issn_rules() {
        assert!(valid_isbn("0-8044-2957-X"));
        assert!(valid_isbn("978 0 19 924849 0"));
        assert!(!valid_isbn("X-8044-2957-0"));
        assert!(!valid_isbn("978019924849X"));
        assert!(valid_issn("2049-3630"));
        assert!(!valid_issn("2049-363"));
    }

    #[test]
    fn timestamps_and_language_tags_are_structural() {
        for accepted in ["0", "75.5", "1:05", "1:02:03.25"] {
            assert!(valid_timestamp(accepted), "{accepted}");
        }
        for rejected in ["", ":05", "1:5", "1:60", "1:02:03:04", "1.", "soon"] {
            assert!(!valid_timestamp(rejected), "{rejected}");
        }
        for accepted in ["en", "grc", "zh-Hant-TW", "en-GB-oed"] {
            assert!(valid_language_tag(accepted), "{accepted}");
        }
        for rejected in ["e", "english language", "en_GB", "en--GB", "1en"] {
            assert!(!valid_language_tag(rejected), "{rejected}");
        }
    }
}

//! Citations: how in-text pointers name a reference, how precisely they
//! locate a position in it, and how both meet CSL JSON.
//!
//! A [`Citation`] is the in-text pointer. Its key is a source-library
//! identifier (never a second identity), its [`Locator`]s are the notebook's
//! locators, and the **Reference** it points at stays a source-library record
//! (ADR 0048). Nothing here reads the private notebook: only the citation key,
//! its locators and the formatted reference are public (ADR 0050).
//!
//! Citations are an opt-in Markdown syntax, `[@key]` or
//! `[@key, page 514; canonical 514a to 520a]`. Plain CommonMark leaves that
//! text alone, so links, footnotes and every post that never calls
//! [`scan_citations`] behave exactly as before.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::research_notes::{
    bidi_override, locator_ambiguity, resolved_kind, Locator, LocatorKind,
};
use crate::source_interchange::{IDENTIFIER_FIELDS, NAME_ROLES, NOTE_FIELDS, PRESERVED_FIELDS};
use crate::source_library::{valid_source_id, valid_timestamp, SourceLibrary, SourceRecord};

/// Upper bound on Markdown scanned at once.
pub const MAX_CITED_MARKDOWN_BYTES: usize = 1024 * 1024;
/// Upper bound on citations in one document.
pub const MAX_CITATIONS: usize = 2_000;
/// Upper bound on locators in one citation, matching a notebook passage.
pub const MAX_CITATION_LOCATORS: usize = 8;
const MAX_LOCATOR_CHARS: usize = 200;
const KEY_MESSAGE: &str =
    "a citation key is a source identifier: a lowercase ASCII slug of at most 64 bytes";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CitationDiagnosticCode {
    TooLarge,
    TooManyCitations,
    MalformedCitation,
    InvalidKey,
    UnknownKey,
    UnknownLocatorKind,
    InvalidLocator,
    AmbiguousLocator,
    TooManyLocators,
}

/// A failure scoped to one citation. Messages name the key, a locator kind or
/// a line, and never repeat prose, excerpts or notes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CitationDiagnostic {
    pub code: CitationDiagnosticCode,
    /// One-based line of the citation, when it came from Markdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub message: String,
}

/// One in-text pointer: a source-library identifier plus ordered locators.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Citation {
    pub key: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub locators: Vec<Locator>,
}

/// A citation found in Markdown, with where it sits.
#[derive(Clone, Debug, PartialEq)]
pub struct CitationMention {
    pub citation: Citation,
    /// Byte range of the whole `[@...]` text.
    pub span: std::ops::Range<usize>,
    pub line: usize,
}

#[derive(Debug, Default, PartialEq)]
pub struct CitationScan {
    pub mentions: Vec<CitationMention>,
    pub diagnostics: Vec<CitationDiagnostic>,
}

fn diag(
    code: CitationDiagnosticCode,
    key: Option<&str>,
    message: impl Into<String>,
) -> CitationDiagnostic {
    CitationDiagnostic {
        code,
        line: None,
        key: key.map(str::to_string),
        message: message.into(),
    }
}

fn locator_diag(key: &str, message: impl Into<String>) -> CitationDiagnostic {
    diag(CitationDiagnosticCode::InvalidLocator, Some(key), message)
}

/// Parse the text between `[@` and `]`, or return why it is not a citation.
pub fn parse_citation(inner: &str) -> Result<Citation, CitationDiagnostic> {
    let (key, rest) = match inner.split_once(',') {
        Some((key, rest)) => (key.trim(), Some(rest)),
        None => (inner.trim(), None),
    };
    if !valid_source_id(key) {
        return Err(diag(CitationDiagnosticCode::InvalidKey, None, KEY_MESSAGE));
    }
    let mut locators = Vec::new();
    if let Some(rest) = rest {
        for part in rest.split(';') {
            if locators.len() == MAX_CITATION_LOCATORS {
                return Err(too_many_locators(key));
            }
            locators.push(parse_locator_text(key, part)?);
        }
    }
    Ok(Citation {
        key: key.into(),
        locators,
    })
}

fn too_many_locators(key: &str) -> CitationDiagnostic {
    diag(
        CitationDiagnosticCode::TooManyLocators,
        Some(key),
        format!("a citation may carry at most {MAX_CITATION_LOCATORS} locators"),
    )
}

fn parse_locator_text(key: &str, part: &str) -> Result<Locator, CitationDiagnostic> {
    let (kind_text, rest) = part
        .trim()
        .split_once(char::is_whitespace)
        .ok_or_else(|| locator_diag(key, "write a locator as `kind value`, such as `page 514`"))?;
    let kind = LocatorKind::parse(kind_text).ok_or_else(|| {
        diag(
            CitationDiagnosticCode::UnknownLocatorKind,
            Some(key),
            "use page, folio, line, section, chapter, canonical, timestamp, or an `x-` extension kind",
        )
    })?;
    let rest = rest.trim();
    let (value, to) = match rest.split_once(" to ") {
        Some((value, to)) => (value.trim(), Some(to.trim())),
        None => (rest, None),
    };
    let locator = Locator {
        kind,
        value: value.into(),
        to: to.map(str::to_string),
        extra: BTreeMap::new(),
    };
    check_locator(&locator).map_err(|message| locator_diag(key, message))?;
    Ok(locator)
}

/// Shape rules for a locator in a citation: the notebook's limits plus the
/// characters the Markdown syntax reserves, so every accepted citation
/// formats back to text that scans to the same citation.
fn check_locator(locator: &Locator) -> Result<(), String> {
    let texts = std::iter::once(("value", locator.value.as_str()))
        .chain(locator.to.as_deref().map(|to| ("end", to)));
    for (name, text) in texts {
        if text.is_empty() || text.trim() != text {
            return Err(format!(
                "the locator {name} must be text without surrounding spaces"
            ));
        }
        if text.chars().count() > MAX_LOCATOR_CHARS {
            return Err(format!(
                "the locator {name} may be at most {MAX_LOCATOR_CHARS} characters"
            ));
        }
        if text
            .chars()
            .any(|c| c.is_control() || bidi_override(c) || matches!(c, ';' | '[' | ']'))
            || text.contains(" to ")
        {
            return Err(format!(
                "the locator {name} may not contain control or bidirectional override characters, `;`, brackets or ` to `"
            ));
        }
        if locator.kind == LocatorKind::Timestamp && !valid_timestamp(text) {
            return Err("use seconds or `h:mm:ss` for a timestamp".into());
        }
    }
    Ok(())
}

/// The canonical Markdown for a citation, which [`parse_citation`] reads back
/// to the same citation. Refuses a citation the syntax cannot carry.
pub fn format_citation(citation: &Citation) -> Result<String, CitationDiagnostic> {
    if !valid_source_id(&citation.key) {
        return Err(diag(CitationDiagnosticCode::InvalidKey, None, KEY_MESSAGE));
    }
    if citation.locators.len() > MAX_CITATION_LOCATORS {
        return Err(too_many_locators(&citation.key));
    }
    let mut text = format!("[@{}", citation.key);
    for (position, locator) in citation.locators.iter().enumerate() {
        check_locator(locator).map_err(|message| locator_diag(&citation.key, message))?;
        text.push_str(if position == 0 { ", " } else { "; " });
        text.push_str(locator.kind.as_str());
        text.push(' ');
        text.push_str(&locator.value);
        if let Some(to) = &locator.to {
            text.push_str(" to ");
            text.push_str(to);
        }
    }
    text.push(']');
    Ok(text)
}

/// Find citations in Markdown. Code blocks, code spans, escaped brackets,
/// links (`[@key](url)`, `[@key][ref]`) and reference definitions are not
/// citations, so existing Markdown keeps its meaning. A bracket that starts
/// like a citation but is malformed is reported and left as text.
pub fn scan_citations(markdown: &str) -> CitationScan {
    let mut scan = CitationScan::default();
    if markdown.len() > MAX_CITED_MARKDOWN_BYTES {
        scan.diagnostics.push(diag(
            CitationDiagnosticCode::TooLarge,
            None,
            format!("Markdown with citations may be at most {MAX_CITED_MARKDOWN_BYTES} bytes"),
        ));
        return scan;
    }
    let mut fence: Option<(u8, usize)> = None;
    let mut offset = 0;
    let mut previous_blank = true;
    let mut in_indented = false;
    for (index, line) in markdown.split_inclusive('\n').enumerate() {
        let line_start = offset;
        offset += line.len();
        let content = line.trim_end_matches(['\n', '\r']);
        let trimmed = content.trim_start_matches(' ');
        let indent = content.len() - trimmed.len();
        if let Some((mark, length)) = fence {
            let run = trimmed.bytes().take_while(|b| *b == mark).count();
            if indent < 4 && run >= length && trimmed[run..].trim().is_empty() {
                fence = None;
            }
            continue;
        }
        if indent < 4 {
            if let Some(mark @ (b'`' | b'~')) = trimmed.bytes().next() {
                let run = trimmed.bytes().take_while(|b| *b == mark).count();
                if run >= 3 && !(mark == b'`' && trimmed[run..].contains('`')) {
                    fence = Some((mark, run));
                    continue;
                }
            }
        }
        let blank = content.trim().is_empty();
        if indent >= 4 && (previous_blank || in_indented) && !blank {
            in_indented = true;
            previous_blank = false;
            continue;
        }
        if !blank {
            in_indented = false;
        }
        previous_blank = blank;
        scan_line(content, line_start, index + 1, &mut scan);
        if scan.mentions.len() > MAX_CITATIONS {
            scan.mentions.truncate(MAX_CITATIONS);
            let mut limit = diag(
                CitationDiagnosticCode::TooManyCitations,
                None,
                format!("a document may hold at most {MAX_CITATIONS} citations"),
            );
            limit.line = Some(index + 1);
            scan.diagnostics.push(limit);
            break;
        }
    }
    scan
}

fn scan_line(content: &str, line_start: usize, line: usize, scan: &mut CitationScan) {
    let bytes = content.as_bytes();
    let malformed = |message: &str| {
        let mut found = diag(CitationDiagnosticCode::MalformedCitation, None, message);
        found.line = Some(line);
        found
    };
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'`' => {
                let run = bytes[i..].iter().take_while(|b| **b == b'`').count();
                i = find_run(bytes, i + run, run).map_or(i + run, |at| at + run);
            }
            b'[' if bytes.get(i + 1) == Some(&b'@') => {
                let Some(close) = content[i + 2..].find([']', '[']).map(|at| at + i + 2) else {
                    scan.diagnostics
                        .push(malformed("a citation must end with `]` on the same line"));
                    return;
                };
                if bytes[close] == b'[' {
                    scan.diagnostics
                        .push(malformed("a citation cannot contain `[`"));
                    i += 2;
                    continue;
                }
                let end = close + 1;
                if matches!(bytes.get(end), Some(b'(' | b'[' | b':')) {
                    i = end;
                    continue;
                }
                match parse_citation(&content[i + 2..close]) {
                    Ok(citation) => scan.mentions.push(CitationMention {
                        citation,
                        span: line_start + i..line_start + end,
                        line,
                    }),
                    Err(mut diagnostic) => {
                        diagnostic.line = Some(line);
                        scan.diagnostics.push(diagnostic);
                    }
                }
                i = end;
            }
            _ => i += 1,
        }
    }
}

fn find_run(bytes: &[u8], from: usize, length: usize) -> Option<usize> {
    let mut i = from;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let run = bytes[i..].iter().take_while(|b| **b == b'`').count();
            if run == length {
                return Some(i);
            }
            i += run;
        } else {
            i += 1;
        }
    }
    None
}

/// The public face of a reference: bibliographic description only. It is
/// built from an explicit allowlist, so unknown source fields, the archived
/// flag, relationships and anything notebook-side cannot appear in it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PublicReference {
    pub key: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub creators: Vec<PublicCreator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// `(scheme, value)` pairs such as `("doi", "10.1000/x")`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub identifiers: Vec<(String, String)>,
    /// Allowlisted CSL variables such as `publisher` or `container-title`.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub csl: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PublicCreator {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

pub fn public_reference(record: &SourceRecord) -> PublicReference {
    let mut csl = BTreeMap::new();
    if let Some(Value::Object(bag)) = record.extra.get("csl") {
        for (name, value) in bag {
            if name != "type" && !PRESERVED_FIELDS.contains(&name.as_str()) {
                continue;
            }
            match value {
                Value::String(text) => {
                    csl.insert(name.clone(), text.clone());
                }
                Value::Number(number) => {
                    csl.insert(name.clone(), number.to_string());
                }
                _ => {}
            }
        }
    }
    PublicReference {
        key: record.id.clone(),
        kind: record.kind.as_str(),
        title: record.title.clone(),
        creators: record
            .creators
            .iter()
            .map(|creator| PublicCreator {
                name: creator.name.clone(),
                role: creator.role.clone(),
            })
            .collect(),
        issued: record.issued.clone(),
        language: record.language.clone(),
        identifiers: record
            .identifiers
            .iter()
            .map(|identifier| (identifier.scheme.clone(), identifier.value.clone()))
            .collect(),
        csl,
    }
}

/// A plain-text reference, deterministic and style-free. It is the fallback
/// when no CSL processor runs; rendering CSL styles is out of scope.
pub fn format_reference(reference: &PublicReference) -> String {
    let mut parts: Vec<String> = Vec::new();
    let names: Vec<&str> = reference
        .creators
        .iter()
        .filter(|c| matches!(c.role.as_deref(), None | Some("author")))
        .map(|c| c.name.as_str())
        .collect();
    if !names.is_empty() {
        parts.push(names.join("; "));
    }
    parts.extend(reference.title.clone());
    parts.extend(reference.csl.get("container-title").cloned());
    parts.extend(reference.csl.get("publisher").cloned());
    parts.extend(reference.issued.clone());
    if let Some((scheme, value)) = reference.identifiers.first() {
        parts.push(format!("{scheme}:{value}"));
    }
    if parts.is_empty() {
        reference.key.clone()
    } else {
        parts.join(". ")
    }
}

/// A citation in its public form.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PublicCitation {
    pub key: String,
    /// One-based number of the reference in order of first citation.
    pub number: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub locators: Vec<Locator>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct ResolvedCitations {
    pub citations: Vec<PublicCitation>,
    /// Each cited reference once, in order of first citation.
    pub references: Vec<PublicReference>,
    pub diagnostics: Vec<CitationDiagnostic>,
}

/// Resolve citations against the source library only. A citation with an
/// unknown key or an ambiguous locator is reported and left out; the rest
/// still resolve. The private notebook is not an input.
pub fn resolve_citations(
    mentions: &[CitationMention],
    library: &SourceLibrary,
) -> ResolvedCitations {
    let mut out = ResolvedCitations::default();
    let mut numbers: BTreeMap<&str, usize> = BTreeMap::new();
    for mention in mentions {
        let citation = &mention.citation;
        let Some(record) = library.get(&citation.key) else {
            let mut found = diag(
                CitationDiagnosticCode::UnknownKey,
                Some(&citation.key),
                format!("no source in the library has the id `{}`", citation.key),
            );
            found.line = Some(mention.line);
            out.diagnostics.push(found);
            continue;
        };
        let target = resolved_kind(library, &citation.key);
        let ambiguous = citation
            .locators
            .iter()
            .find_map(|locator| locator_ambiguity(target, &citation.key, locator));
        if let Some(message) = ambiguous {
            let mut found = diag(
                CitationDiagnosticCode::AmbiguousLocator,
                Some(&citation.key),
                message.replace("the passage", "the citation"),
            );
            found.line = Some(mention.line);
            out.diagnostics.push(found);
            continue;
        }
        let next = numbers.len() + 1;
        let number = *numbers.entry(record.id.as_str()).or_insert_with(|| {
            out.references.push(public_reference(record));
            next
        });
        out.citations.push(PublicCitation {
            key: citation.key.clone(),
            number,
            locators: citation.locators.clone(),
        });
    }
    out
}

/// What CSL interchange does with a CSL variable (ADR 0052).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CslFate {
    /// Mapped to a source-library field and rebuilt on export.
    Stored,
    /// Kept as text or a number under the record's `csl` field, verbatim.
    Preserved,
    /// Never stored, so it cannot reach a public artifact.
    PrivateDropped,
    /// Not stored; an import plan reports it as unsupported.
    Unsupported,
}

pub fn csl_field_fate(name: &str) -> CslFate {
    let stored = matches!(name, "id" | "title" | "language" | "issued" | "custom")
        || NAME_ROLES.contains(&name)
        || IDENTIFIER_FIELDS.iter().any(|(_, csl)| *csl == name);
    if stored {
        CslFate::Stored
    } else if name == "type" || PRESERVED_FIELDS.contains(&name) {
        CslFate::Preserved
    } else if NOTE_FIELDS.contains(&name) {
        CslFate::PrivateDropped
    } else {
        CslFate::Unsupported
    }
}

/// CSL locator labels that name the same thing as a locator kind.
const CSL_LABELS: [&str; 6] = ["page", "folio", "line", "section", "chapter", "timestamp"];
const OPENBLOG_LOCATORS: &str = "openblog-locators";
/// Prefix of the extension kind that keeps a CSL label with no kind of its own.
const CSL_EXTENSION_PREFIX: &str = "x-csl-";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CitationLoss {
    pub field: String,
    pub reason: String,
}

fn flat_range(locator: &Locator) -> String {
    match &locator.to {
        Some(to) => format!("{}\u{2013}{}", locator.value, to),
        None => locator.value.clone(),
    }
}

/// A CSL JSON citation item for a citation. The first locator is expressed in
/// CSL's `label` and `locator`; whatever CSL cannot carry (further locators,
/// kinds with no CSL label, the range structure) is reported as a loss and
/// kept in `openblog-locators`, which CSL processors ignore and
/// [`citation_from_csl_item`] restores.
pub fn citation_to_csl_item(citation: &Citation) -> (Value, Vec<CitationLoss>) {
    let mut item = Map::new();
    item.insert("id".into(), Value::String(citation.key.clone()));
    let mut losses = Vec::new();
    if let Some(first) = citation.locators.first() {
        if CSL_LABELS.contains(&first.kind.as_str()) {
            item.insert("label".into(), first.kind.as_str().into());
            item.insert("locator".into(), Value::String(flat_range(first)));
            if first.to.is_some() {
                losses.push(CitationLoss {
                    field: "locator".into(),
                    reason: "a range is written as one text; its start and end are kept in openblog-locators".into(),
                });
            }
        } else {
            losses.push(CitationLoss {
                field: "label".into(),
                reason: format!("CSL has no locator label for `{}`", first.kind.as_str()),
            });
        }
        if citation.locators.len() > 1 {
            losses.push(CitationLoss {
                field: "locator".into(),
                reason: "CSL carries one locator; the others are kept in openblog-locators".into(),
            });
        }
        item.insert(
            OPENBLOG_LOCATORS.into(),
            serde_json::to_value(&citation.locators).unwrap_or_else(|_| json!([])),
        );
    }
    (Value::Object(item), losses)
}

/// Read a CSL JSON citation item. `openblog-locators` is used when its first
/// locator still agrees with CSL's own `label` and `locator`; otherwise CSL's
/// fields win and the disagreement is reported. Unknown labels are kept as
/// `x-csl-` extension kinds. Fields with no home (prefix, suffix, embedded
/// item data, ...) are reported, never stored.
pub fn citation_from_csl_item(
    item: &Value,
) -> Result<(Citation, Vec<CitationLoss>), CitationDiagnostic> {
    let Value::Object(item) = item else {
        return Err(diag(
            CitationDiagnosticCode::MalformedCitation,
            None,
            "a CSL citation item must be an object",
        ));
    };
    let key = match item.get("id") {
        Some(Value::String(id)) if valid_source_id(id) => id.clone(),
        _ => {
            return Err(diag(
                CitationDiagnosticCode::InvalidKey,
                None,
                "the CSL item id must be a source identifier (a lowercase ASCII slug)",
            ))
        }
    };
    let mut losses: Vec<CitationLoss> = item
        .keys()
        .filter(|name| {
            !matches!(
                name.as_str(),
                "id" | "label" | "locator" | OPENBLOG_LOCATORS
            )
        })
        .map(|name| CitationLoss {
            field: name.clone(),
            reason: "citations store a key and locators only".into(),
        })
        .collect();
    let checked = |locator: Locator| -> Result<Locator, CitationDiagnostic> {
        check_locator(&locator).map_err(|message| locator_diag(&key, message))?;
        Ok(locator)
    };
    let from_csl = match (item.get("locator"), item.get("label")) {
        (None, _) => None,
        (Some(Value::String(text)), label) => {
            let label = match label {
                None => "page",
                Some(Value::String(label)) => label,
                Some(_) => return Err(locator_diag(&key, "label must be text")),
            };
            let kind = if CSL_LABELS.contains(&label) {
                LocatorKind::parse(label)
            } else {
                LocatorKind::parse(&format!("{CSL_EXTENSION_PREFIX}{label}"))
            }
            .ok_or_else(|| {
                diag(
                    CitationDiagnosticCode::UnknownLocatorKind,
                    Some(&key),
                    "this CSL label cannot be kept as an extension kind",
                )
            })?;
            Some(checked(Locator {
                kind,
                value: text.trim().into(),
                to: None,
                extra: BTreeMap::new(),
            })?)
        }
        (Some(_), _) => return Err(locator_diag(&key, "locator must be text")),
    };
    let mut locators = Vec::new();
    if let Some(Value::Array(list)) = item.get(OPENBLOG_LOCATORS) {
        if list.len() > MAX_CITATION_LOCATORS {
            return Err(too_many_locators(&key));
        }
        for entry in list {
            let kind = entry
                .get("kind")
                .and_then(Value::as_str)
                .and_then(LocatorKind::parse);
            let value = entry.get("value").and_then(Value::as_str);
            let (Some(kind), Some(value)) = (kind, value) else {
                return Err(locator_diag(
                    &key,
                    "openblog-locators entries need a known kind and a value",
                ));
            };
            locators.push(checked(Locator {
                kind,
                value: value.into(),
                to: entry.get("to").and_then(Value::as_str).map(str::to_string),
                extra: BTreeMap::new(),
            })?);
        }
    }
    match (from_csl, locators.first()) {
        (Some(csl), Some(first)) => {
            if csl.kind != first.kind || csl.value != flat_range(first) {
                losses.push(CitationLoss {
                    field: OPENBLOG_LOCATORS.into(),
                    reason: "disagrees with the CSL label and locator, which win".into(),
                });
                locators = vec![csl];
            }
        }
        (Some(csl), None) => locators.push(csl),
        _ => {}
    }
    losses.sort_by(|a, b| a.field.cmp(&b.field));
    Ok((Citation { key, locators }, losses))
}

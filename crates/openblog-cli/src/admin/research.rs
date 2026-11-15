//! What Studio's research screens need from the server beyond the old Admin's routes (Studio R11,
//! docs/specs/studio/r11/ux.md "Server gaps"):
//!
//! - **G92** whether this site uses research at all (`meta.siteUses.research`), and the switches
//!   her words depend on (`meta.research`), so a site that never touches research sees none of it.
//! - **G93** a top-level `code` on every refusal of a research route, so Studio chooses her words
//!   from a code and never from a sentence (the sentences stay one release), and a `code` beside
//!   `build.ok` on saves that rebuild.
//! - **G94** where each source is used: the posts that cite it (or a version of it) and how much of
//!   the notebook, the atlas, the claims and the alignments point at it. Read only.
//! - **G95** a checked citation as readers will see it: a short label and the plain-text note in
//!   the post's language.
//!
//! Nothing here writes, and nothing here is looked up online.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use openblog_core::bibliography::{CitationLocale, CitationStyle};
use openblog_core::citations::{self, CheckedCitation};
use openblog_core::frontmatter;
use openblog_core::source_library::SourceLibrary;
use openblog_core::{SiteConfig, Sources};
use serde_json::{json, Map, Value as Json};

use super::Response;

/// The private research stores. Any one of them on disk means the site uses research.
const PRIVATE_STORES: [&str; 6] = [
    crate::source_store::LIBRARY_FILE,
    crate::notebook_store::NOTEBOOK_FILE,
    crate::atlas_store::ATLAS_FILE,
    crate::alignment_store::ALIGNMENTS_FILE,
    crate::claims_store::CLAIMS_FILE,
    openblog_core::curated_selection::SELECTIONS_FILE,
];

/// The built-in citation locales Studio offers for a post's notes.
pub(super) const CITATION_LOCALES: [&str; 4] = ["en", "de", "fr", "es"];

/// Whether one post uses research: a research post, one that opted into citations, or one that
/// holds a citation outside code (read with the build's own scanner).
pub(super) fn post_uses_research(contents: &str) -> bool {
    let Ok(doc) = frontmatter::parse(contents) else {
        return false;
    };
    if doc.front_matter.get("profile") == Some("research") {
        return true;
    }
    if matches!(
        CitationStyle::from_front_matter(doc.front_matter.get("citations")),
        Ok(Some(_))
    ) {
        return true;
    }
    !citations::scan_citations(&doc.body).mentions.is_empty()
}

/// G92: the site uses research when any private store exists, any post uses it, or a research
/// projection is switched on. Studio shows research only then.
pub(super) fn site_uses_research(root: &Path, config: &SiteConfig, sources: &Sources) -> bool {
    PRIVATE_STORES.iter().any(|file| root.join(file).exists())
        || config.knowledge_atlas.publish
        || config.comparisons.publish
        || config.claim_evidence.publish
        || config.curated_context.publish
        || sources
            .posts
            .iter()
            .any(|file| post_uses_research(&file.contents))
}

/// G92: the switches her research words depend on, so they never guess one.
pub(super) fn research_meta(config: &SiteConfig) -> Json {
    json!({
        "atlasPublishes": config.knowledge_atlas.publish,
        "comparisonsPublishes": config.comparisons.publish,
        "claimEvidence": config.claim_evidence.publish,
        "curatedContext": config.curated_context.publish,
        "citationLocales": CITATION_LOCALES,
    })
}

// ---------------------------------------------------------------------------
// G93: codes on research answers
// ---------------------------------------------------------------------------

/// The API routes whose answers G93 codes: the library, the notebook and the rest of research,
/// and the citation picker.
pub(super) fn owns(name: &str) -> bool {
    name == "sources"
        || name.starts_with("sources/")
        || name.starts_with("research/")
        || name.starts_with("citations/")
}

/// Diagnostic codes that mean a store on disk can't be read (not that a change was refused).
const UNREADABLE: [&str; 2] = ["invalid-json", "unsupported-version"];

/// The code for a refusal, from its status and its diagnostics.
fn refusal_code(status: u16, body: &Map<String, Json>, read: bool) -> Option<&'static str> {
    let codes = diagnostic_codes(body);
    match status {
        409 => Some("changed"),
        413 => Some("too-large"),
        400 | 415 => Some("bad-request"),
        422 if read || codes.iter().any(|code| UNREADABLE.contains(&code.as_str())) => {
            Some("unreadable")
        }
        422 => Some("invalid"),
        500..=599 => Some("storage"),
        _ => None,
    }
}

/// The kebab-case codes of an answer's diagnostics, in order, once each.
fn diagnostic_codes(body: &Map<String, Json>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    body.get("diagnostics")
        .and_then(Json::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("code").and_then(Json::as_str))
        .filter(|code| seen.insert(code.to_string()))
        .map(str::to_string)
        .collect()
}

/// G93: put a top-level `code` on a research refusal that has none (an existing code, such as
/// `busy`, is kept), the diagnostic codes beside an `unreadable` one, and a `code` beside
/// `build.ok` on a save that rebuilt. The sentence and every other field stay as they were.
pub(super) fn coded(name: &str, method: &str, mut response: Response) -> Response {
    if !owns(name) {
        return response;
    }
    let Ok(Json::Object(mut body)) = serde_json::from_slice::<Json>(&response.body) else {
        return response;
    };
    let mut changed = false;
    if response.status >= 400 && !body.contains_key("code") {
        if let Some(code) = refusal_code(response.status, &body, method == "GET") {
            if code == "unreadable" {
                body.insert("codes".into(), json!(diagnostic_codes(&body)));
            }
            body.insert("code".into(), json!(code));
            changed = true;
        }
    }
    if response.status < 300 {
        if let Some(Json::Object(build)) = body.get_mut("build") {
            // A deferred build ("pending") hasn't run, so it has no outcome to name.
            let pending = build
                .get("pending")
                .and_then(Json::as_bool)
                .unwrap_or(false);
            if !build.contains_key("code") && !pending {
                let ok = build.get("ok").and_then(Json::as_bool).unwrap_or(false);
                build.insert(
                    "code".into(),
                    json!(if ok { "built" } else { "build-failed" }),
                );
                changed = true;
            }
        }
    }
    if changed {
        response.body = serde_json::to_vec(&Json::Object(body)).unwrap_or(response.body);
    }
    response
}

// ---------------------------------------------------------------------------
// G94: where a source is used
// ---------------------------------------------------------------------------

/// The keys a citation of `key` counts for: the source itself and every source it is a form of,
/// so a post that cites a translation is listed under the work too.
fn cited_family(library: &SourceLibrary, key: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut next = Some(key.to_string());
    while let Some(id) = next.take() {
        if !seen.insert(id.clone()) {
            break;
        }
        let record = library.get(&id);
        out.push(id);
        next = record.and_then(|record| record.of.clone());
    }
    out
}

/// Objects under any key named `evidence` (one object or a list) whose `source` is `id`.
fn count_evidence(value: &Json, id: &str) -> usize {
    match value {
        Json::Object(map) => map
            .iter()
            .map(|(key, child)| {
                let here = if key == "evidence" {
                    match child {
                        Json::Array(items) => items
                            .iter()
                            .filter(|item| item.get("source").and_then(Json::as_str) == Some(id))
                            .count(),
                        Json::Object(_) => {
                            usize::from(child.get("source").and_then(Json::as_str) == Some(id))
                        }
                        _ => 0,
                    }
                } else {
                    0
                };
                here + count_evidence(child, id)
            })
            .sum(),
        Json::Array(items) => items.iter().map(|item| count_evidence(item, id)).sum(),
        _ => 0,
    }
}

/// A private store as plain JSON, or null when it isn't there or can't be read.
fn store_json(root: &Path, file: &str) -> Json {
    std::fs::read(root.join(file))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Json::Null)
}

/// G94: for each source in `library`, the posts that cite it (or a version of it) and how many
/// passages, notes, atlas and claim evidence items and alignments point at it. Keyed by source
/// id, beside the records rather than inside them, so a record sent back to be saved never
/// carries these counts into the library.
pub(super) fn source_uses(root: &Path, library: &SourceLibrary, posts: &Sources) -> Json {
    let mut cited: BTreeMap<String, Vec<Json>> = BTreeMap::new();
    for file in &posts.posts {
        let Ok(doc) = frontmatter::parse(&file.contents) else {
            continue;
        };
        let scan = citations::scan_citations(&doc.body);
        let mut keys = BTreeSet::new();
        for mention in &scan.mentions {
            keys.extend(cited_family(library, &mention.citation.key));
        }
        let title = doc
            .front_matter
            .get("title")
            .unwrap_or_default()
            .to_string();
        for key in keys {
            cited
                .entry(key)
                .or_default()
                .push(json!({ "path": file.path, "title": title }));
        }
    }
    let notebook = store_json(root, crate::notebook_store::NOTEBOOK_FILE);
    let atlas = store_json(root, crate::atlas_store::ATLAS_FILE);
    let claims = store_json(root, crate::claims_store::CLAIMS_FILE);
    let alignments = store_json(root, crate::alignment_store::ALIGNMENTS_FILE);
    let list = |value: &Json, key: &str| value[key].as_array().cloned().unwrap_or_default();
    let passages = list(&notebook, "passages");
    let notes = list(&notebook, "notes");
    let mut out = Map::new();
    for record in &library.sources {
        let id = record.id.as_str();
        let own: BTreeSet<&str> = passages
            .iter()
            .filter(|passage| passage["source"].as_str() == Some(id))
            .filter_map(|passage| passage["id"].as_str())
            .collect();
        let note_count = notes
            .iter()
            .filter(|note| {
                let names = |key: &str| {
                    note[key]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Json::as_str)
                        .collect::<Vec<_>>()
                };
                names("sources").contains(&id)
                    || names("passages")
                        .iter()
                        .any(|passage| own.contains(passage))
            })
            .count();
        let alignment_count = list(&alignments, "alignments")
            .iter()
            .filter(|alignment| {
                alignment["members"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|member| member["source"].as_str() == Some(id))
            })
            .count();
        out.insert(
            record.id.clone(),
            json!({
                "citedBy": cited.remove(id).unwrap_or_default(),
                "usedBy": {
                    "passages": own.len(),
                    "notes": note_count,
                    "atlasEvidence": count_evidence(&atlas, id),
                    "claimEvidence": count_evidence(&claims, id),
                    "alignments": alignment_count,
                },
            }),
        );
    }
    Json::Object(out)
}

// ---------------------------------------------------------------------------
// G95: a citation as readers will see it
// ---------------------------------------------------------------------------

/// The locale a post's notes are written in: its `citationLocale` when that is a built-in one,
/// else the site's language, else English. A post that can't be found or read uses the site's.
pub(super) fn post_locale(
    config: &SiteConfig,
    posts: &Sources,
    path: Option<&str>,
) -> CitationLocale {
    let explicit = path
        .and_then(|path| posts.posts.iter().find(|file| file.path == path))
        .and_then(|file| frontmatter::parse(&file.contents).ok())
        .and_then(|doc| doc.front_matter.get("citationLocale").map(str::to_string));
    CitationLocale::for_post(explicit.as_deref(), &config.language)
        .unwrap_or_else(|_| CitationLocale::parse(&config.language).unwrap_or(CitationLocale::En))
}

/// G95: a short label (the reference's title, then its places, as a reader sees them) and the
/// plain-text note, both in `locale`.
pub(super) fn citation_reads(
    checked: &CheckedCitation,
    locale: CitationLocale,
) -> (String, String) {
    let places = locale.locators_text(&checked.locators);
    let title = checked
        .reference
        .title
        .clone()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| checked.key.clone());
    let join = |head: String| {
        if places.is_empty() {
            head
        } else {
            format!("{head}, {places}")
        }
    };
    (join(title), join(checked.formatted.clone()))
}

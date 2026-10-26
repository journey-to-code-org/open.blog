//! The public Knowledge Atlas query projection (ADR 0200): derived only from
//! the public atlas, no private or draft data, direction and sources kept,
//! cycles that end, unknown ids that answer nothing, unsafe addresses and
//! size bounds refused, and deterministic output.

use std::collections::BTreeMap;

use openblog_core::atlas_publication::PublicAtlas;
use openblog_core::atlas_query::{
    AtlasQuery, Direction, ATLAS_QUERY_JSON_FILE, MAX_EDGES, MAX_ENTRIES, MAX_LISTED_EDGES,
    MAX_TEXT_CHARS, MAX_TRAIL_DEPTH, MAX_TRAIL_STEPS,
};
use openblog_core::knowledge_atlas::{Atlas, Links};
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::SourceLibrary;
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::{json, Value};

const PRIVATE: &str = "PRIVATE-QUERY-MARKER";

fn library() -> SourceLibrary {
    let text = json!({"version": 1, "sources": [
        {"id": "plato-republic", "kind": "work", "title": "Politeia",
         "creators": [{"name": "Plato", "role": "author"}],
         "secretPlan": format!("{PRIVATE} source extra")},
        {"id": "republic-slings", "kind": "edition", "of": "plato-republic",
         "title": "Platonis Rempublicam", "issued": "2003"},
        {"id": "scholar-book", "kind": "work", "title": "A study of the dialogues"},
        {"id": "never-used", "kind": "work", "title": format!("{PRIVATE} unused source")}
    ]})
    .to_string();
    SourceLibrary::parse(&text, &BTreeMap::new()).expect("library")
}

fn notebook(library: &SourceLibrary) -> Notebook {
    let text = json!({"version": 1,
        "passages": [{"id": "p-cave", "source": "republic-slings",
            "excerpt": {"text": format!("{PRIVATE} quoted")}}],
        "notes": []})
    .to_string();
    Notebook::parse(&text, library).expect("notebook")
}

fn entry(id: &str, kind: &str, label: &str) -> Value {
    json!({"id": id, "kind": kind, "label": label, "visibility": "approved"})
}

fn edge(id: &str, kind: &str, from: &str, to: &str) -> Value {
    json!({"id": id, "kind": kind, "from": from, "to": to,
        "assertedBy": {"kind": "author"}, "confidence": "plausible",
        "evidence": [{"source": "plato-republic"}], "visibility": "approved"})
}

fn base() -> Value {
    let mut plato = entry("plato", "person", "Plato");
    plato["aliases"] = json!(["Aristocles"]);
    plato["summary"] = json!("An Athenian philosopher.\n\nHe wrote dialogues.");
    plato["shelf"] = json!(format!("{PRIVATE} entry extra"));
    let mut authored = edge("r-authored", "authored", "plato", "republic");
    authored["assertedBy"] = json!({"kind": "source", "source": "scholar-book",
        "why": format!("{PRIVATE} party extra")});
    authored["evidence"] = json!([{"source": "republic-slings",
        "locators": [{"kind": "page", "value": "514", "to": "520"}]}]);
    authored["uncertainty"] = json!("The dating is unsettled.");
    authored["contestedBy"] = json!([{"by": {"kind": "named", "name": "A later editor"},
        "note": "Dates it later.", "evidence": [{"source": "plato-republic"}]}]);
    let mut private_edge = edge("r-private", "related-to", "plato", "stoics");
    private_edge["visibility"] = json!("private");
    private_edge["uncertainty"] = json!(format!("{PRIVATE} private relationship"));
    let mut to_secret = edge("r-to-secret", "discusses", "republic", "secret");
    to_secret["uncertainty"] = json!(format!("{PRIVATE} private endpoint"));
    let mut passage = edge("r-passage", "influenced", "plato", "stoics");
    passage["visibility"] = json!("private");
    passage["evidence"] = json!([{"source": "republic-slings", "passage": "p-cave"}]);
    json!({"version": 1,
        "entries": [
            plato,
            {"id": "republic", "kind": "work", "label": "Republic", "source": "plato-republic",
             "visibility": "approved"},
            entry("allegory", "concept", "Allegory <script>alert(1)</script> & more"),
            entry("stoics", "movement", "The Stoics"),
            {"id": "secret", "kind": "concept", "label": format!("{PRIVATE} private label"),
             "summary": format!("{PRIVATE} private summary"), "visibility": "private"}
        ],
        "relationships": [authored,
            edge("r-discusses", "discusses", "republic", "allegory"),
            edge("r-member", "member-of", "plato", "stoics"),
            private_edge, to_secret, passage],
        "workspace": format!("{PRIVATE} top-level extra")})
}

fn public(value: &Value) -> PublicAtlas {
    let library = library();
    let notebook = notebook(&library);
    let atlas = Atlas::parse(
        &value.to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .expect("a valid atlas");
    PublicAtlas::project(&atlas, &library).expect("a projection")
}

fn query(value: &Value) -> AtlasQuery {
    AtlasQuery::project(&public(value)).expect("a query projection")
}

fn edge_ids(q: &AtlasQuery) -> Vec<&str> {
    q.edges.iter().map(|e| e.id.as_str()).collect()
}

/// `n` concepts joined in one ring.
fn ring(n: usize) -> Value {
    let entries: Vec<Value> = (0..n)
        .map(|i| entry(&format!("e{i:02}"), "concept", &format!("Concept {i}")))
        .collect();
    let edges: Vec<Value> = (0..n)
        .map(|i| {
            edge(
                &format!("r{i:02}"),
                "influenced",
                &format!("e{i:02}"),
                &format!("e{:02}", (i + 1) % n),
            )
        })
        .collect();
    json!({"version": 1, "entries": entries, "relationships": edges})
}

#[test]
fn private_draft_and_unsourced_atlas_data_is_absent() {
    let q = query(&base());
    let json = q.to_json();
    assert!(!json.contains(PRIVATE), "{json}");
    let ids: Vec<&str> = q.entries.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, ["allegory", "plato", "republic", "stoics"]);
    assert_eq!(edge_ids(&q), ["r-authored", "r-discusses", "r-member"]);
    for gone in [
        "secret",
        "r-private",
        "r-to-secret",
        "r-passage",
        "never-used",
        "p-cave",
    ] {
        assert!(!json.contains(gone), "{gone} leaked");
    }
    for field in [
        "shelf",
        "workspace",
        "visibility",
        "unsourced",
        "passage",
        "secretPlan",
    ] {
        assert!(!json.contains(&format!("\"{field}\"")), "{field} leaked");
    }
}

#[test]
fn an_entry_or_edge_outside_the_projection_answers_nothing() {
    let q = query(&base());
    assert!(q.entry("secret").is_none());
    assert!(q.edge("r-private").is_none());
    assert!(q.trail("secret", 3).steps.is_empty());
    assert_eq!(q.edges_of("secret"), (vec![], vec![]));
    assert!(q.lookup(&format!("{PRIVATE} private label")).is_empty());
    assert!(q.lookup("never-used").is_empty());
    // A walk from a published entry never reaches the private neighbour.
    let trail = q.trail("republic", 3);
    let reached: Vec<&str> = trail.steps.iter().map(|s| s.reached).collect();
    assert!(!reached.contains(&"secret"), "{reached:?}");
}

#[test]
fn direction_confidence_standing_uncertainty_and_sources_survive() {
    let q = query(&base());
    let value: Value = serde_json::from_str(&q.to_json()).unwrap();
    let authored = value["edges"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "r-authored")
        .unwrap();
    assert_eq!(authored["from"], "plato");
    assert_eq!(authored["to"], "republic");
    assert_eq!(authored["kind"], "authored");
    assert_eq!(authored["confidence"], "plausible");
    assert_eq!(authored["standing"], "contested");
    assert_eq!(authored["dissents"], 1);
    assert_eq!(authored["uncertainty"], "The dating is unsettled.");
    assert_eq!(authored["assertedBy"]["kind"], "source");
    assert_eq!(authored["assertedBy"]["source"], "scholar-book");
    assert_eq!(authored["evidence"][0]["source"], "republic-slings");
    assert_eq!(authored["evidence"][0]["locators"][0]["value"], "514");
    assert_eq!(authored["url"], "/atlas/plato/#atlas-r-r-authored");
    let sources: Vec<&str> = q.sources.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        sources,
        ["plato-republic", "republic-slings", "scholar-book"]
    );
    assert!(q
        .source("plato-republic")
        .unwrap()
        .text
        .contains("Politeia"));
    // The reverse reading is a label, never a second assertion.
    let plato = q.entry("plato").unwrap();
    assert_eq!(plato.out, ["r-authored", "r-member"]);
    assert!(plato.incoming.is_empty());
    let republic = q.entry("republic").unwrap();
    assert_eq!(republic.incoming, ["r-authored"]);
    assert_eq!(republic.out, ["r-discusses"]);
    assert_eq!(q.edges_of("republic").1.len(), 1);
    let asserted = q.edge("r-discusses").unwrap();
    assert_eq!(asserted.dissents, 0);
    assert!(value["edges"][1].get("dissents").is_none());
}

#[test]
fn it_is_derived_from_the_public_atlas_alone() {
    let mut atlas = public(&base());
    // A projection that joins an entry it does not publish is refused whole.
    atlas.relationships[0].to = "secret".into();
    let error = AtlasQuery::project(&atlas).unwrap_err();
    assert!(
        error.contains("r-authored") && !error.contains(PRIVATE),
        "{error}"
    );
    // So is one that cites a source the public atlas does not describe.
    let mut atlas = public(&base());
    atlas.sources.retain(|s| s.reference.key != "scholar-book");
    let error = AtlasQuery::project(&atlas).unwrap_err();
    assert!(error.contains("scholar-book"), "{error}");
}

#[test]
fn a_cycle_ends_a_trail_and_each_relationship_is_crossed_once() {
    let q = query(&ring(5));
    let trail = q.trail("e00", 3);
    assert!(!trail.truncated);
    // Both ways round a 5-ring: every relationship once, none twice.
    let ids: Vec<&str> = trail.steps.iter().map(|s| s.edge.id.as_str()).collect();
    assert_eq!(ids, ["r00", "r04", "r01", "r03", "r02"]);
    assert_eq!(trail.steps[0].direction, Direction::Forward);
    assert_eq!(trail.steps[0].reached, "e01");
    assert_eq!(trail.steps[1].direction, Direction::Backward);
    assert_eq!(trail.steps[1].reached, "e04");
    assert_eq!(trail.steps[1].depth, 1);
    // A 2-cycle and a very deep request both terminate.
    let q = query(&ring(2));
    assert_eq!(q.trail("e00", 99).steps.len(), 2);
    // Depth is capped and zero depth is an empty walk.
    let q = query(&ring(40));
    assert_eq!(q.trail("e00", 99).steps.len(), 2 * MAX_TRAIL_DEPTH);
    assert!(q.trail("e00", 0).steps.is_empty());
    assert!(q.trail("e00", 1).steps.iter().all(|s| s.depth == 1));
}

#[test]
fn a_trail_is_bounded_in_steps_and_an_entry_lists_a_bounded_number_of_edges() {
    // One hub with more spokes than a trail may return.
    let n = MAX_TRAIL_STEPS + 20;
    let mut entries = vec![entry("hub", "concept", "Hub")];
    let mut edges = Vec::new();
    for i in 0..n {
        entries.push(entry(&format!("s{i:03}"), "concept", &format!("Spoke {i}")));
        edges.push(edge(
            &format!("r{i:03}"),
            "influenced",
            "hub",
            &format!("s{i:03}"),
        ));
    }
    let q = query(&json!({"version": 1, "entries": entries, "relationships": edges}));
    let trail = q.trail("hub", 2);
    assert_eq!(trail.steps.len(), MAX_TRAIL_STEPS);
    assert!(trail.truncated);
    let hub = q.entry("hub").unwrap();
    assert_eq!(hub.out.len(), MAX_LISTED_EDGES);
    assert_eq!(hub.more_out, n - MAX_LISTED_EDGES);
    assert_eq!(
        q.edges_of("hub").0.len(),
        n,
        "the full list stays available"
    );
    let value: Value = serde_json::from_str(&q.to_json()).unwrap();
    let hub = value["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == "hub")
        .unwrap();
    assert_eq!(hub["moreOut"], n - MAX_LISTED_EDGES);
}

#[test]
fn text_is_clipped_on_a_character_boundary_and_says_so() {
    let long = "\u{e9}".repeat(MAX_TEXT_CHARS + 50);
    let mut value = base();
    value["entries"][0]["summary"] = json!(format!("{long}\n\nSecond paragraph."));
    value["relationships"][0]["uncertainty"] = json!(long.clone());
    let q = query(&value);
    let plato = q.entry("plato").unwrap();
    let preview = plato.preview.as_deref().unwrap();
    assert_eq!(preview.chars().count(), MAX_TEXT_CHARS);
    assert!(preview.ends_with('\u{2026}'));
    assert!(plato.preview_clipped);
    let authored = q.edge("r-authored").unwrap();
    assert!(authored.uncertainty_clipped);
    assert_eq!(
        authored.uncertainty.as_deref().unwrap().chars().count(),
        MAX_TEXT_CHARS
    );
    // A short, single-paragraph summary is whole; a second paragraph is flagged.
    let mut value = base();
    value["entries"][0]["summary"] = json!("Short.");
    assert!(!query(&value).entry("plato").unwrap().preview_clipped);
    let q = query(&base());
    let plato = q.entry("plato").unwrap();
    assert_eq!(plato.preview.as_deref(), Some("An Athenian philosopher."));
    assert!(plato.preview_clipped, "the second paragraph is on the page");
    assert!(q.entry("stoics").unwrap().preview.is_none());
}

#[test]
fn counts_and_addresses_are_bounded_and_refused_whole() {
    let atlas = public(&base());
    let mut many = atlas.clone();
    let template = many.entries[0].clone();
    many.entries = (0..=MAX_ENTRIES)
        .map(|i| {
            let mut e = template.clone();
            e.id = format!("e{i}");
            e.url = format!("/atlas/e{i}/");
            e
        })
        .collect();
    many.relationships.clear();
    let error = AtlasQuery::project(&many).unwrap_err();
    assert!(
        error.contains("entries") && error.contains("limit"),
        "{error}"
    );

    let mut many = atlas.clone();
    let template = many.relationships[0].clone();
    many.relationships = (0..=MAX_EDGES)
        .map(|i| {
            let mut r = template.clone();
            r.id = format!("r{i}");
            r
        })
        .collect();
    let error = AtlasQuery::project(&many).unwrap_err();
    assert!(
        error.contains("relationships") && error.contains("limit"),
        "{error}"
    );

    for url in [
        "//evil.example/atlas/plato/",
        "javascript:alert(1)",
        "https://evil.example/atlas/plato/",
        "/atlas/../private/",
        "/atlas/plato/?x=1",
        "/other/plato/",
    ] {
        let mut bad = atlas.clone();
        bad.entries[0].url = url.into();
        let error = AtlasQuery::project(&bad).unwrap_err();
        assert!(error.contains("address"), "{url}: {error}");
        assert!(!error.contains(url), "the refusal never echoes the address");
    }
    let mut bad = atlas.clone();
    bad.entries[0].id = "../plato".into();
    assert!(AtlasQuery::project(&bad).is_err());
    let mut bad = atlas.clone();
    bad.relationships[0].id = "r?x#y".into();
    assert!(AtlasQuery::project(&bad).is_err());
    let mut bad = atlas.clone();
    let duplicate = bad.entries[0].clone();
    bad.entries.push(duplicate);
    assert!(AtlasQuery::project(&bad).unwrap_err().contains("twice"));
}

#[test]
fn a_hostile_label_is_escaped_in_the_data() {
    let q = query(&base());
    let json = q.to_json();
    assert!(
        !json.contains('<') && !json.contains('>') && !json.contains('&'),
        "{json}"
    );
    assert!(json.contains("\\u003cscript\\u003e"));
    let value: Value = serde_json::from_str(&json).unwrap();
    assert_eq!(
        value["entries"][0]["label"], "Allegory <script>alert(1)</script> & more",
        "the escapes decode to the exact label"
    );
}

#[test]
fn lookup_normalizes_and_never_resolves_an_ambiguous_term() {
    let mut value = base();
    value["entries"][3]["label"] = json!("Plato");
    let q = query(&value);
    let found: Vec<&str> = q.lookup("  plato ").iter().map(|e| e.id.as_str()).collect();
    assert_eq!(found, ["plato", "stoics"], "both entries, in id order");
    let found: Vec<&str> = q
        .lookup("ARISTOCLES")
        .iter()
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(found, ["plato"]);
    assert!(q.lookup("aristocle").is_empty(), "no fuzzy matching");
    assert!(q.lookup("").is_empty());
}

#[test]
fn output_is_deterministic_whatever_the_stored_order() {
    let value = base();
    let mut reversed = value.clone();
    reversed["entries"].as_array_mut().unwrap().reverse();
    reversed["relationships"].as_array_mut().unwrap().reverse();
    let (a, b) = (query(&value).to_json(), query(&reversed).to_json());
    assert_eq!(a, b);
    assert_eq!(a, query(&value).to_json());
    let parsed: Value = serde_json::from_str(&a).unwrap();
    assert_eq!(parsed["format"], "openblog-atlas-query");
    assert_eq!(parsed["formatVersion"], 1);
    assert!(
        parsed.get("version").is_none(),
        "never mistaken for private research"
    );
    assert_eq!(parsed["limits"]["maxTrailDepth"], MAX_TRAIL_DEPTH);
    let terms: Vec<&str> = parsed["terms"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["term"].as_str().unwrap())
        .collect();
    let mut sorted = terms.clone();
    sorted.sort();
    assert_eq!(terms, sorted);
}

fn site(atlas: Option<PublicAtlas>, base_url: &str) -> Site {
    let mut config = SiteConfig::from_json(&format!(
        r#"{{"title": "Atlas", "url": "{base_url}", "author": {{"name": "Site Author"}}}}"#
    ))
    .unwrap();
    config.knowledge_atlas.publish = atlas.is_some();
    let mut site = Site::load(
        config,
        Sources {
            posts: vec![SourceFile {
                path: "posts/hello.md".into(),
                contents: "---\ntitle: Hello\ndate: 2026-10-20\n---\nHello.".into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .expect("site");
    site.atlas = atlas;
    site
}

fn built(site: &Site) -> BTreeMap<String, String> {
    generate(site, &ThemeSet::new())
        .expect("a build")
        .into_iter()
        .map(|f| (f.path, f.contents))
        .collect()
}

#[test]
fn the_build_writes_the_query_file_only_when_the_atlas_is_published() {
    let off = built(&site(None, "https://example.com"));
    assert!(!off.keys().any(|p| p.contains("atlas")), "{:?}", off.keys());
    let on = built(&site(Some(public(&base())), "https://example.com"));
    assert_eq!(on[ATLAS_QUERY_JSON_FILE], query(&base()).to_json());
    assert!(on.contains_key("atlas.json"));
    // Everything the site published before is unchanged by the new file.
    for (path, contents) in &off {
        if path != "sitemap.xml" {
            assert_eq!(on.get(path), Some(contents), "{path}");
        }
    }
    assert!(
        !on["sitemap.xml"].contains("atlas-query"),
        "a data file is not a page"
    );
    // Root-relative addresses are prefixed with a site's base path.
    let prefixed = built(&site(Some(public(&base())), "https://example.com/blog"));
    assert!(prefixed[ATLAS_QUERY_JSON_FILE].contains("\"url\":\"/blog/atlas/plato/\""));
}

#[test]
fn an_atlas_over_a_bound_still_builds_without_the_query_file() {
    let mut atlas = public(&base());
    let template = atlas.entries[0].clone();
    atlas.entries = (0..=MAX_ENTRIES)
        .map(|i| {
            let mut e = template.clone();
            e.id = format!("e{i}");
            e.url = format!("/atlas/e{i}/");
            e
        })
        .collect();
    atlas.relationships.clear();
    atlas.datings.clear();
    atlas.sources.clear();
    let out = built(&site(Some(atlas), "https://example.com"));
    assert!(out.contains_key("atlas.json") && out.contains_key("atlas/index.html"));
    assert!(!out.contains_key(ATLAS_QUERY_JSON_FILE));
}

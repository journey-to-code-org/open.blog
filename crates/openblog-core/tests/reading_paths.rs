//! Reading-path contracts (ADR 0240 to 0245, #76): ordering, the branches
//! policy, cycles, deleted content, unknown fields, series coexistence,
//! round trips and privacy.

use std::collections::BTreeMap;

use openblog_core::atlas_publication::PublicAtlas;
use openblog_core::knowledge_atlas::{Atlas, Links};
use openblog_core::reading_path::{
    load_paths, DiagnosticKind, PublicPaths, PublishedTargets, ReadingPath, Relationship, Status,
    MAX_FILE_BYTES, MAX_PATHS, MAX_STEPS,
};
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::SourceLibrary;
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::{json, Value};

const GOLDEN: &str = include_str!("fixtures/reading-path.json");
const PRIVATE: &str = "PRIVATE-PATH-MARKER";

fn public_atlas() -> PublicAtlas {
    let library = SourceLibrary::parse(
        &json!({"version": 1, "sources": [{"id": "book", "kind": "work", "title": "A book"}]})
            .to_string(),
        &BTreeMap::new(),
    )
    .unwrap();
    let notebook = Notebook::parse(
        &json!({"version": 1, "passages": [], "notes": []}).to_string(),
        &library,
    )
    .unwrap();
    let edge = |id: &str, kind: &str, from: &str, to: &str| {
        json!({"id": id, "kind": kind, "from": from, "to": to,
            "assertedBy": {"kind": "author"}, "confidence": "plausible",
            "evidence": [{"source": "book"}], "visibility": "approved"})
    };
    let atlas = Atlas::parse(
        &json!({"version": 1,
            "entries": [
                {"id": "plato", "kind": "person", "label": "Plato", "visibility": "approved"},
                {"id": "stoics", "kind": "movement", "label": "The Stoics", "visibility": "approved"},
                {"id": "secret", "kind": "concept", "label": format!("{PRIVATE} label"),
                 "visibility": "private"}],
            "relationships": [
                edge("r-influence", "influenced", "plato", "stoics"),
                edge("r-related", "related-to", "plato", "stoics")]})
        .to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .unwrap();
    PublicAtlas::project(&atlas, &library).unwrap()
}

fn targets() -> PublishedTargets {
    let mut t = PublishedTargets::default();
    t.add_post("the-cave", "The cave", "/posts/the-cave/");
    t.add_post("other", "Other", "/posts/other/");
    t.add_atlas(&public_atlas());
    t
}

fn path_file(name: &str, value: Value) -> SourceFile {
    SourceFile {
        path: format!("paths/{name}.json"),
        contents: value.to_string(),
    }
}

fn parse(value: Value) -> Result<ReadingPath, Vec<String>> {
    ReadingPath::parse("paths/p.json", &value.to_string())
        .map_err(|e| e.iter().map(|p| p.to_string()).collect())
}

fn doc(steps: Value) -> Value {
    json!({"format": "openblog-reading-path", "version": 1, "title": "P",
        "status": "published", "steps": steps})
}

fn draft(steps: Value) -> Value {
    let mut d = doc(steps);
    d["status"] = json!("draft");
    d
}

fn post_step(id: &str, slug: &str) -> Value {
    json!({"id": id, "target": {"kind": "post", "slug": slug}})
}

fn with_next(mut step: Value) -> Value {
    step["transition"] = json!({"relationship": "next", "why": "It continues the thread."});
    step
}

fn errors(value: Value) -> String {
    parse(value).unwrap_err().join("\n")
}

#[test]
fn the_golden_file_round_trips_byte_for_byte() {
    let path = ReadingPath::parse("paths/golden.json", GOLDEN).expect("golden parses");
    assert_eq!(path.to_canonical_json(), GOLDEN);
    assert!(!GOLDEN.contains('\r'));
    let again = ReadingPath::parse("paths/golden.json", &path.to_canonical_json()).unwrap();
    assert_eq!(again, path);
}

#[test]
fn a_reordered_or_reformatted_file_is_written_canonically() {
    let messy = r#"{"steps":[{"id":"a","target":{"kind":"post","slug":"the-cave"}},{"transition":{"why":"w","relationship":"next"},"target":{"slug":"other","kind":"post"},"id":"b"}],"status":"draft","title":"T","version":1,"format":"openblog-reading-path"}"#;
    let path = ReadingPath::parse("paths/p.json", messy).unwrap();
    let text = path.to_canonical_json();
    assert!(text.starts_with("{\n  \"format\""));
    assert_eq!(
        ReadingPath::parse("paths/p.json", &text)
            .unwrap()
            .to_canonical_json(),
        text
    );
}

#[test]
fn steps_keep_the_authors_order_and_resolve_in_it() {
    let a = parse(doc(json!([
        post_step("one", "other"),
        with_next(post_step("two", "the-cave")),
    ])))
    .unwrap();
    let out = PublicPaths::resolve(&[a], &targets());
    let steps = &out.paths.paths[0].steps;
    assert_eq!(
        steps
            .iter()
            .map(|s| (s.id.as_str(), s.position))
            .collect::<Vec<_>>(),
        [("one", 1), ("two", 2)]
    );
    assert_eq!(
        steps[1].transition.as_ref().unwrap().relationship,
        Relationship::Next
    );
    assert!(out.diagnostics.is_empty());
}

#[test]
fn paths_are_sorted_by_slug_and_output_is_deterministic() {
    let mk = |slug: &str| {
        let text = doc(json!([
            post_step("a", "other"),
            with_next(post_step("b", "the-cave"))
        ]));
        ReadingPath::parse(&format!("paths/{slug}.json"), &text.to_string()).unwrap()
    };
    let one = PublicPaths::resolve(&[mk("zeta"), mk("alpha")], &targets());
    let two = PublicPaths::resolve(&[mk("alpha"), mk("zeta")], &targets());
    assert_eq!(one.paths.to_json(), two.paths.to_json());
    assert_eq!(one.paths.paths[0].slug, "alpha");
    assert_eq!(one.paths.paths[0].url, "/paths/alpha/");
}

#[test]
fn there_are_no_branches_and_a_path_never_returns_to_a_step() {
    let e = errors(doc(json!([
        post_step("a", "other"),
        with_next(post_step("b", "the-cave")),
        with_next(post_step("c", "other")),
    ])));
    assert!(
        e.contains("step `c`") && e.contains("same post as step `a`"),
        "{e}"
    );
    // A step cannot name a path, so one path cannot lead into another.
    let e = errors(doc(json!([
        post_step("a", "other"),
        {"id": "b", "target": {"kind": "path", "slug": "x"},
         "transition": {"relationship": "next", "why": "w"}},
    ])));
    assert!(
        e.contains("step `b`") && e.contains("unknown variant"),
        "{e}"
    );
    // A step cannot name several next steps.
    let e = errors(doc(json!([
        post_step("a", "other"),
        {"id": "b", "target": {"kind": "post", "slug": "the-cave"},
         "next": ["c"], "transition": {"relationship": "next", "why": "w"}},
    ])));
    assert!(e.contains("unknown field `next`"), "{e}");
}

#[test]
fn a_repeated_step_id_is_refused_and_ids_scope_every_message() {
    let e = errors(doc(json!([
        post_step("a", "other"),
        with_next(post_step("a", "the-cave")),
    ])));
    assert!(
        e.contains("paths/p.json: step `a`: `id` is used by an earlier step"),
        "{e}"
    );
}

#[test]
fn every_transition_explains_why_and_has_no_default_relationship() {
    let e = errors(doc(json!([
        post_step("a", "other"),
        post_step("b", "the-cave")
    ])));
    assert!(
        e.contains("step `b`") && e.contains("add a transition"),
        "{e}"
    );
    let mut blank = post_step("b", "the-cave");
    blank["transition"] = json!({"relationship": "next", "why": "   "});
    assert!(errors(doc(json!([post_step("a", "other"), blank])))
        .contains("`transition.why` is required"));
    let mut none = post_step("b", "the-cave");
    none["transition"] = json!({"why": "because"});
    let e = errors(doc(json!([post_step("a", "other"), none])));
    assert!(e.contains("missing field `relationship`"), "{e}");
    let first = with_next(post_step("a", "other"));
    assert!(errors(doc(json!([first, post_step("b", "the-cave")]))).contains("no transition"));
}

#[test]
fn a_draft_may_be_incomplete_but_never_malformed() {
    let d = draft(json!([post_step("a", "other"), post_step("b", "the-cave")]));
    let p = parse(d.clone()).expect("an unfinished draft is kept");
    assert_eq!(p.status, Status::Draft);
    let mut bad = d;
    bad["steps"][1]["id"] = json!("Bad Id");
    assert!(parse(bad).is_err());
    let golden_draft = GOLDEN.replace("\"published\"", "\"draft\"");
    let p = ReadingPath::parse("paths/d.json", &golden_draft).unwrap();
    assert!(PublicPaths::resolve(&[p], &targets())
        .paths
        .paths
        .is_empty());
}

#[test]
fn influence_needs_a_published_relationship_and_chronology_is_never_enough() {
    let mut s = post_step("b", "the-cave");
    s["transition"] = json!({"relationship": "influenced", "why": "It came earlier."});
    let e = errors(doc(json!([post_step("a", "other"), s])));
    assert!(e.contains("`influenced` needs `basis`"), "{e}");
}

#[test]
fn influence_is_kept_only_with_a_published_influence_in_the_stated_direction() {
    let path = ReadingPath::parse("paths/golden.json", GOLDEN).unwrap();
    let out = PublicPaths::resolve(std::slice::from_ref(&path), &targets());
    let stoics = &out.paths.paths[0].steps[2];
    let t = stoics.transition.as_ref().unwrap();
    assert_eq!(
        (t.relationship, t.basis.as_deref()),
        (Relationship::Influenced, Some("r-influence"))
    );
    assert!(out.diagnostics.is_empty(), "{:?}", out.diagnostics);

    // Reversed: the previous step would be the later one.
    let mut reversed = path.clone();
    reversed.steps.swap(1, 2);
    reversed.steps[1].transition = path.steps[1].transition.clone();
    reversed.steps[2].transition = path.steps[2].transition.clone();
    let out = PublicPaths::resolve(&[reversed], &targets());
    assert!(out.paths.paths[0].steps[2].transition.is_none());
    assert!(out
        .diagnostics
        .iter()
        .any(|d| d.kind == DiagnosticKind::TransitionDropped));

    // A basis that is not an influence, or does not exist: dropped, never "influenced".
    for basis in ["r-related", "nope"] {
        let mut p = path.clone();
        p.steps[2].transition.as_mut().unwrap().basis = Some(basis.into());
        let out = PublicPaths::resolve(&[p], &targets());
        assert!(out.paths.paths[0].steps[2].transition.is_none(), "{basis}");
    }

    // A softer label keeps its words and loses the unpublished basis.
    let mut p = path;
    {
        let t = p.steps[2].transition.as_mut().unwrap();
        t.relationship = Relationship::BuildsOn;
        t.basis = Some("nope".into());
    }
    let out = PublicPaths::resolve(&[p], &targets());
    let t = out.paths.paths[0].steps[2].transition.as_ref().unwrap();
    assert_eq!(
        (t.relationship, t.basis.as_deref()),
        (Relationship::BuildsOn, None)
    );
    assert_eq!(out.diagnostics[0].kind, DiagnosticKind::BasisUnavailable);
}

#[test]
fn a_missing_step_is_left_out_with_a_diagnostic_and_its_neighbours_claim_nothing() {
    let path = parse(doc(json!([
        post_step("a", "other"),
        with_next(post_step("gone", "deleted-post")),
        with_next(post_step("c", "the-cave")),
        with_next(post_step("d", "other-2")),
        with_next(json!({"id": "e", "target": {"kind": "atlas", "id": "plato"}})),
    ])))
    .unwrap();
    let mut t = targets();
    t.add_post("other-2", "Other 2", "/posts/other-2/");
    let out = PublicPaths::resolve(&[path], &t);
    let steps = &out.paths.paths[0].steps;
    assert_eq!(
        steps.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        ["a", "c", "d", "e"]
    );
    assert_eq!(
        steps.iter().map(|s| s.position).collect::<Vec<_>>(),
        [1, 2, 3, 4]
    );
    // `c` followed a step the reader does not see, so it claims no transition.
    assert!(steps[1].transition.is_none());
    assert!(steps[2].transition.is_some() && steps[3].transition.is_some());
    let kinds: Vec<_> = out
        .diagnostics
        .iter()
        .map(|d| (d.step.as_deref(), d.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            (Some("gone"), DiagnosticKind::StepUnavailable),
            (Some("c"), DiagnosticKind::TransitionDropped)
        ]
    );
    assert_eq!(
        out.diagnostics[0].to_string(),
        "reading path `p`, step `gone`: post `deleted-post` is not published, so the step is left out"
    );
}

#[test]
fn a_path_with_fewer_than_two_published_steps_is_withheld() {
    let path = parse(doc(json!([
        post_step("a", "other"),
        with_next(post_step("b", "unpublished")),
    ])))
    .unwrap();
    let out = PublicPaths::resolve(&[path], &targets());
    assert!(out.paths.paths.is_empty());
    assert!(out
        .diagnostics
        .iter()
        .any(|d| d.kind == DiagnosticKind::PathWithheld));
}

#[test]
fn unpublished_targets_never_leak_and_are_not_told_apart_from_missing_ones() {
    // `secret` is a private atlas entry; `draft-post` is not a published post.
    let path = parse(doc(json!([
        post_step("a", "other"),
        with_next(json!({"id": "s", "target": {"kind": "atlas", "id": "secret"}})),
        with_next(post_step("d", "draft-post")),
        with_next(post_step("e", "the-cave")),
    ])))
    .unwrap();
    let out = PublicPaths::resolve(&[path], &targets());
    let json = out.paths.to_json();
    assert!(!json.contains(PRIVATE) && !json.contains("secret") && !json.contains("draft-post"));
    let messages: String = out.diagnostics.iter().map(|d| d.to_string()).collect();
    assert!(!messages.contains(PRIVATE));
    // The same message for a private entry and for an id that never existed.
    let unknown = parse(doc(json!([
        post_step("a", "other"),
        with_next(json!({"id": "s", "target": {"kind": "atlas", "id": "nothing"}})),
        with_next(post_step("e", "the-cave")),
    ])))
    .unwrap();
    let again = PublicPaths::resolve(&[unknown], &targets());
    assert_eq!(
        out.diagnostics[0].message.replace("secret", "X"),
        again.diagnostics[0].message.replace("nothing", "X")
    );
}

#[test]
fn unknown_fields_and_versions_are_refused_not_dropped() {
    let mut d = draft(json!([post_step("a", "other")]));
    d["notes"] = json!("private thought");
    assert!(errors(d).contains("unknown field `notes`"));
    let d = draft(json!([{"id": "a", "target": {"kind": "post", "slug": "x"}, "mood": 1}]));
    let e = errors(d);
    assert!(
        e.contains("step `a`") && e.contains("unknown field `mood`"),
        "{e}"
    );
    let mut d = doc(json!([]));
    d["version"] = json!(2);
    assert!(errors(d).contains("version 2"));
    let mut d = doc(json!([]));
    d["format"] = json!("openblog-atlas");
    assert!(errors(d).contains("`format` must be"));
    let mut d = doc(json!([post_step("a", "other")]));
    d["status"] = json!("public");
    assert!(errors(d).contains("unknown variant"));
}

#[test]
fn hostile_and_oversized_input_is_refused_with_scoped_messages() {
    let long = "x".repeat(601);
    let mut s = post_step("b", "the-cave");
    s["transition"] = json!({"relationship": "next", "why": long});
    let e = errors(doc(json!([post_step("a", "other"), s])));
    assert!(e.contains("`transition.why` is over 600 characters"), "{e}");
    assert!(!e.contains("xxxx"));
    for (field, bad) in [
        ("rationale", "line\nbreak"),
        ("rationale", "evil\u{202e}text"),
        ("prerequisites", "see [x](atlas:plato)"),
    ] {
        let mut s = post_step("a", "other");
        s[field] = json!(bad);
        assert!(
            errors(draft(json!([s]))).contains(&format!("`{field}`")),
            "{field}"
        );
    }
    let e = errors(draft(json!([post_step("a", "../etc/passwd")])));
    assert!(e.contains("not a post slug"), "{e}");
    let e = errors(draft(json!([
        {"id": "a", "target": {"kind": "atlas", "id": "Not An Id"}}
    ])));
    assert!(e.contains("not an atlas entry id"), "{e}");
    assert!(ReadingPath::parse("paths/p.json", "{not json").is_err());
    let big = " ".repeat(MAX_FILE_BYTES + 1);
    assert!(ReadingPath::parse("paths/p.json", &big).unwrap_err()[0]
        .message
        .contains("bytes"));
    let many: Vec<Value> = (0..=MAX_STEPS)
        .map(|i| post_step(&format!("s{i}"), "other"))
        .collect();
    assert!(errors(draft(json!(many))).contains("at most"));
    for bad in [
        "paths/../x.json",
        "paths/Up.json",
        "posts/p.json",
        "paths/a b.json",
        "paths/.json",
    ] {
        assert!(ReadingPath::parse(bad, GOLDEN).is_err(), "{bad}");
    }
}

#[test]
fn script_in_text_is_data_and_is_escaped_in_the_json_embed() {
    let mut s = with_next(post_step("b", "the-cave"));
    s["transition"]["why"] = json!("</script><img src=x onerror=alert(1)> & more");
    let p = parse(doc(json!([post_step("a", "other"), s]))).unwrap();
    let out = PublicPaths::resolve(&[p], &targets());
    let json = out.paths.to_json();
    assert!(!json.contains('<') && !json.contains('>') && !json.contains('&'));
    assert!(json.contains("\\u003c/script\\u003e"));
}

#[test]
fn one_bad_file_leaves_the_others_and_nothing_is_written() {
    let good = |name: &str| {
        path_file(
            name,
            doc(json!([
                post_step("a", "other"),
                with_next(post_step("b", "the-cave"))
            ])),
        )
    };
    let mut bad = good("broken");
    bad.contents = bad.contents.replace("\"version\":1", "\"version\":9");
    let files = [
        good("zeta"),
        bad,
        good("alpha"),
        SourceFile {
            path: "paths/.gitkeep".into(),
            contents: String::new(),
        },
        SourceFile {
            path: "posts/x.md".into(),
            contents: "ignored".into(),
        },
    ];
    let loaded = load_paths(&files);
    assert_eq!(
        loaded
            .paths
            .iter()
            .map(|p| p.slug.as_str())
            .collect::<Vec<_>>(),
        ["alpha", "zeta"]
    );
    assert_eq!(loaded.problems.len(), 1);
    assert!(loaded.problems[0]
        .to_string()
        .starts_with("paths/broken.json: is version 9"));
    assert!(load_paths(&[]).paths.is_empty());
}

#[test]
fn too_many_path_files_are_cut_with_a_message() {
    let files: Vec<SourceFile> = (0..=MAX_PATHS)
        .map(|i| path_file(&format!("p{i:03}"), draft(json!([]))))
        .collect();
    let loaded = load_paths(&files);
    assert_eq!(loaded.paths.len(), MAX_PATHS);
    assert!(loaded.problems[0].message.contains("at most"));
}

fn series_site() -> Site {
    let config = SiteConfig::from_json(
        r#"{"title": "S", "url": "https://example.com", "author": {"name": "A"}}"#,
    )
    .unwrap();
    let post = |name: &str, extra: &str| SourceFile {
        path: format!("posts/{name}.md"),
        contents: format!("---\ntitle: {name}\ndate: 2026-10-20\nseries: guide\n{extra}---\nBody."),
    };
    Site::load(
        config,
        Sources {
            posts: vec![
                post("alpha", "seriesOrder: 2\n"),
                post("bravo", "seriesOrder: 1\n"),
                post("draft-one", "draft: true\n"),
            ],
            series: vec![SourceFile {
                path: "series/guide.md".into(),
                contents: "---\nname: Guide\n---\nA guide.".into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .expect("site")
}

fn built(site: &Site) -> BTreeMap<String, String> {
    generate(site, &ThemeSet::new())
        .unwrap()
        .into_iter()
        .map(|f| (f.path, f.contents))
        .collect()
}

#[test]
fn a_path_coexists_with_a_series_and_leaves_it_and_the_build_unchanged() {
    let site = series_site();
    let before = built(&site);
    let series_order = site.series_by_slug("guide").unwrap().posts.clone();

    // The path reads the series' posts in the opposite order, and names a draft.
    let path = parse(doc(json!([
        post_step("one", "alpha"),
        with_next(post_step("two", "bravo")),
        with_next(post_step("three", "draft-one")),
    ])))
    .unwrap();
    let out = PublicPaths::resolve(&[path], &PublishedTargets::from_site(&site));
    let order: Vec<_> = out.paths.paths[0]
        .steps
        .iter()
        .map(|s| s.target.as_str())
        .collect();
    assert_eq!(order, ["alpha", "bravo"]);
    assert_eq!(out.diagnostics.len(), 1);
    assert_eq!(out.diagnostics[0].step.as_deref(), Some("three"));

    assert_eq!(site.series_by_slug("guide").unwrap().posts, series_order);
    assert_eq!(before, built(&site));
    assert!(before.keys().all(|p| !p.contains("paths")));
}

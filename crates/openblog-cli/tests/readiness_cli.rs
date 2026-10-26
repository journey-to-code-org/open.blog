//! The research readiness report through the real command line (#194,
//! ADR 0148): `openblog check`, `openblog check --json` and `openblog build`
//! show one report with one set of codes in one order; the machine-readable
//! output is deterministic; a failure of a private file the build reads stops
//! the build before any public file changes; and a site without research
//! prints exactly what it always printed.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::{json, Value};

const LIBRARY_FILE: &str = ".openblog/private/research/sources.json";
const ATLAS_FILE: &str = ".openblog/private/research/atlas.json";
const LEAK: &str = "ZqxLeak readiness sentinel words kept private";
const LEAK_WORD: &str = "ZqxLeakReadinessSegmentSentinelAbcdef";

fn copy(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn project(tag: &str, research: bool) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-readiness-cli-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    copy(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/portable-publishing"),
        &root,
    );
    if !research {
        // The example's own post uses the Research profile; a site without
        // research has an ordinary article.
        fs::write(
            root.join("content/posts/portable-lesson.md"),
            "---
title: A plain post
date: 2026-10-24
---

Just an article.
",
        )
        .unwrap();
    }
    if research {
        let write = |file: &str, value: Value| {
            let path = root.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, value.to_string()).unwrap();
        };
        write(
            LIBRARY_FILE,
            json!({"version": 1, "sources": [
                {"id": "plato", "kind": "work", "title": "Politeia"},
                {"id": "slings", "kind": "edition", "of": "plato", "title": "Slings edition",
                    "rights": {"status": "publicDomain", "note": LEAK},
                    "identifiers": [{"scheme": "url", "value": format!("http://files.internal/{LEAK_WORD}")}]}
            ]}),
        );
        write(
            ATLAS_FILE,
            json!({"version": 2, "entries": [
                {"id": "plato-person", "kind": "person", "label": "Plato", "visibility": "approved"},
                {"id": "the-good", "kind": "concept", "label": LEAK}
            ], "relationships": []}),
        );
        fs::write(
            root.join("content/posts/cave.md"),
            "---\ntitle: Cave\ndate: 2026-10-01\nprofile: research\ncitations: notes\n---\n\nThe cave educates [@slings, page 514].\n\nSee [the Good](/atlas/the-good/).\n",
        )
        .unwrap();
        let config_path = root.join("openblog.json");
        let mut config: Value =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["knowledgeAtlas"] = json!({"publish": true});
        fs::write(config_path, config.to_string()).unwrap();
    }
    root
}

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_openblog"))
        .args(args)
        .arg("--root")
        .arg(root)
        .output()
        .expect("run openblog")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

/// Every file under the project with its bytes, so a command can be shown to
/// have changed nothing.
fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, into: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if entry.file_type().unwrap().is_dir() {
                walk(base, &path, into);
            } else {
                into.insert(
                    path.strip_prefix(base)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                    fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut files = BTreeMap::new();
    walk(root, root, &mut files);
    files
}

fn listed_codes(view: &Value) -> Vec<String> {
    let findings = view["findings"].as_array().unwrap();
    view["groups"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|group| group["findings"].as_array().unwrap())
        .map(|position| {
            let finding = &findings[position.as_u64().unwrap() as usize];
            format!(
                "{}: {}",
                finding["validator"].as_str().unwrap(),
                finding["code"].as_str().unwrap()
            )
        })
        .collect()
}

fn printed_codes(report: &str) -> Vec<String> {
    report
        .lines()
        .filter(|line| line.starts_with("research ") && line.ends_with(']'))
        .filter_map(|line| {
            let start = line.rfind('[')?;
            Some(line[start + 1..line.len() - 1].to_string())
        })
        .collect()
}

#[test]
fn check_json_is_deterministic_and_lists_the_codes_the_terminal_lists_in_the_same_order() {
    let root = project("parity", true);
    let before = snapshot(&root);
    let first = run(&root, &["check", "--json"]);
    assert!(first.status.success(), "{}", text(&first.stderr));
    let second = run(&root, &["check", "--json"]);
    assert_eq!(first.stdout, second.stdout, "the report is deterministic");
    let view: Value =
        serde_json::from_slice(&first.stdout).expect("JSON and nothing else on stdout");
    assert_eq!(view["applies"], true);
    let codes = listed_codes(&view);
    for expected in [
        "publication-context: context-link-unpublished",
        "citation-review: citation-identifier-unpublished",
    ] {
        assert!(
            codes.iter().any(|code| code == expected),
            "{expected} in {codes:?}"
        );
    }

    let terminal = run(&root, &["check"]);
    assert!(terminal.status.success(), "{}", text(&terminal.stderr));
    assert_eq!(printed_codes(&text(&terminal.stderr)), codes);

    // Reading changes nothing, and nothing private is printed.
    assert_eq!(snapshot(&root), before);
    for output in [&first, &terminal] {
        assert!(!text(&output.stdout).contains("ZqxLeak"));
        assert!(!text(&output.stderr).contains("ZqxLeak"));
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_failure_of_a_file_the_build_reads_is_reported_by_check_and_stops_build_before_it_writes() {
    let root = project("blocking", true);
    let built = run(&root, &["build"]);
    assert!(built.status.success(), "{}", text(&built.stderr));
    assert!(
        printed_codes(&text(&built.stderr))
            .iter()
            .any(|code| code == "publication-context: context-link-unpublished"),
        "build prints the same report: {}",
        text(&built.stderr)
    );
    fs::write(root.join(ATLAS_FILE), "{ not json").unwrap();
    let before = snapshot(&root);

    let json = run(&root, &["check", "--json"]);
    assert!(
        !json.status.success(),
        "a blocking finding exits with an error"
    );
    let view: Value = serde_json::from_slice(&json.stdout).expect("the report is still printed");
    let blocking = view["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["name"] == "blocking")
        .expect("the damaged atlas blocks");
    let entry = &view["findings"][blocking["findings"][0].as_u64().unwrap() as usize];
    assert_eq!(entry["scope"]["object"], "atlas");
    assert_eq!(entry["gate"], "refuses");
    let terminal = run(&root, &["check"]);
    assert!(!terminal.status.success());
    assert!(
        text(&terminal.stderr).contains("research blocking"),
        "{}",
        text(&terminal.stderr)
    );

    let refused = run(&root, &["build"]);
    assert!(!refused.status.success());
    assert_eq!(
        snapshot(&root),
        before,
        "neither check nor a refused build changed a file"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_site_without_research_prints_exactly_what_it_always_printed() {
    let root = project("legacy", false);
    let checked = run(&root, &["check"]);
    assert!(checked.status.success(), "{}", text(&checked.stderr));
    assert!(
        text(&checked.stdout).starts_with("OK: "),
        "{}",
        text(&checked.stdout)
    );
    assert!(
        !text(&checked.stderr)
            .lines()
            .any(|line| line.starts_with("research ")),
        "{}",
        text(&checked.stderr)
    );
    let built = run(&root, &["build"]);
    assert!(built.status.success(), "{}", text(&built.stderr));
    assert!(
        !text(&built.stderr).contains("research "),
        "{}",
        text(&built.stderr)
    );
    let again = run(&root, &["build"]);
    assert_eq!(text(&built.stdout), text(&again.stdout));
    let json = run(&root, &["check", "--json"]);
    let view: Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(view["applies"], false);
    assert_eq!(view["findings"], json!([]));
    fs::remove_dir_all(root).unwrap();
}

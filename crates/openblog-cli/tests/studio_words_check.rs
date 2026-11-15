//! `openblog check` reports Studio's word problems (docs/studio-words.md, W5): a problem in the
//! site's `studio.words` fails the check, one in the host's file
//! (`OPENBLOG_STUDIO_WORDS_PATH`) is a warning, and good words pass quietly.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn project(tag: &str, studio: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-studio-words-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::write(
        root.join("openblog.json"),
        format!(r#"{{"title":"Grammi's House","url":"https://example.org","author":{{"name":"Grammi"}}{studio}}}"#),
    )
    .unwrap();
    fs::write(
        root.join("content/posts/2026-11-01-pie.md"),
        "---\ntitle: Pie\ndate: 2026-11-01\n---\n\nFlaky.\n",
    )
    .unwrap();
    root
}

fn check(root: &Path, host: Option<&Path>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_openblog"));
    command.arg("check").arg("--root").arg(root);
    command.env_remove("OPENBLOG_WORKSPACE");
    match host {
        Some(path) => command.env("OPENBLOG_STUDIO_WORDS_PATH", path),
        None => command.env_remove("OPENBLOG_STUDIO_WORDS_PATH"),
    };
    command.output().unwrap()
}

#[test]
fn good_words_pass_quietly() {
    let root = project(
        "good",
        r#","studio":{"words":{"vars":{"helper":"Mikey","owner":"Grammi"},"text":{"cards.signOff":"Love, {owner}"}}}"#,
    );
    let out = check(&root, None);
    let errors = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "{errors}");
    assert!(!errors.contains("studio words"), "{errors}");
    fs::remove_dir_all(&root).ok();
}

#[test]
fn a_problem_in_the_sites_words_fails_the_check() {
    let root = project(
        "site",
        r#","studio":{"words":{"vars":{"helper":"Mikey"},"text":{"card.signoff":"Love"}}}"#,
    );
    let out = check(&root, None);
    let errors = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success());
    assert!(
        errors.contains(
            "error: studio words: card.signoff isn't a word id. Did you mean cards.signOff?"
        ),
        "{errors}"
    );
    assert!(
        errors.contains("studio.words in openblog.json has 1 problem"),
        "{errors}"
    );
    fs::remove_dir_all(&root).ok();
}

#[test]
fn a_problem_in_the_hosts_file_is_a_warning() {
    let root = project("host", "");
    let host = root.join("host-words.json");
    fs::write(&host, r#"{"vars":{"helper":"the sync team"}}"#).unwrap();
    let out = check(&root, Some(&host));
    let errors = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "{errors}");
    assert!(
        errors.contains("warning: studio words (server file): helper uses “sync”"),
        "{errors}"
    );
    fs::remove_dir_all(&root).ok();
}

#[test]
fn an_unknown_key_under_studio_is_refused_like_any_other() {
    let root = project("unknown", r#","studio":{"wrods":{}}"#);
    let out = check(&root, None);
    assert!(!out.status.success());
    fs::remove_dir_all(&root).ok();
}

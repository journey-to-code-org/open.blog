use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};

struct Repo(PathBuf);

impl Repo {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "openblog-diagram-git-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        let repo = Self(path);
        repo.git(&["init", "-q", "-b", "main"]);
        repo.git(&["config", "user.name", "Example Author"]);
        repo.git(&["config", "user.email", "author@example.test"]);
        repo.git(&["commit", "-q", "--allow-empty", "-m", "starting point"]);
        repo
    }

    fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn draft(&self, from: &str, to: &str) -> Output {
        Command::new(env!("CARGO_BIN_EXE_openblog"))
            .args(["diagram", "git", "--repo"])
            .arg(&self.0)
            .args(["--from", from, "--to", to])
            .output()
            .unwrap()
    }
}

impl Drop for Repo {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn drafts_merge_and_tag_without_mutating_the_repository() {
    let repo = Repo::new();
    repo.git(&["tag", "base"]);
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.git(&[
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "feature work me@example.test 0123456789012345678901234567890123456789",
    ]);
    repo.git(&["tag", "release-1"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.git(&["commit", "-q", "--allow-empty", "-m", "main work"]);
    repo.git(&["merge", "-q", "--no-ff", "feature", "-m", "merge work"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    let refs = repo.git(&["show-ref"]);
    let before = repo.git(&["status", "--porcelain"]);

    let result = repo.draft("base", "HEAD");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let draft = String::from_utf8(result.stdout).unwrap();
    assert!(draft.contains("```mermaid\ngitGraph\n"));
    assert!(draft.contains("feature work"));
    assert!(draft.contains("main work"));
    assert!(draft.contains("merge change"));
    assert!(draft.contains("tag: \"release-1\""));
    assert!(draft.contains("feature"));
    assert!(!draft.contains("author@example.test"));
    assert!(!draft.contains("me@example.test"));
    assert!(!draft.contains("0123456789012345678901234567890123456789"));
    assert!(!draft.contains(&head));
    #[cfg(feature = "diagram-rendering")]
    assert_renderable(&draft);
    assert_eq!(repo.git(&["show-ref"]), refs);
    assert_eq!(repo.git(&["status", "--porcelain"]), before);
}

#[test]
fn empty_range_and_unknown_options_fail_without_a_draft() {
    let repo = Repo::new();
    let result = repo.draft("HEAD", "HEAD");
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&result.stderr).contains("no commits"));

    let result = Command::new(env!("CARGO_BIN_EXE_openblog"))
        .current_dir(&repo.0)
        .args([
            "diagram",
            "git",
            "--from",
            "HEAD",
            "--to",
            "HEAD",
            "--unknown",
            "value",
        ])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&result.stderr).contains("usage:"));
}

#[test]
fn caps_large_ranges_and_reports_omitted_history() {
    let repo = Repo::new();
    repo.git(&["tag", "base"]);
    for i in 0..35 {
        repo.git(&["commit", "-q", "--allow-empty", "-m", &format!("step {i}")]);
    }
    let result = repo.draft("base", "HEAD");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let draft = String::from_utf8(result.stdout).unwrap();
    assert!(draft.contains("only the newest 30 are shown"));
    assert_eq!(draft.matches("  branch change").count(), 30);
    assert!(!draft.contains("step 0"));
    assert!(draft.contains("step 34"));
    #[cfg(feature = "diagram-rendering")]
    assert_renderable(&draft);
}

#[cfg(feature = "diagram-rendering")]
fn assert_renderable(draft: &str) {
    let findings = openblog_core::diagram::discover(draft);
    assert_eq!(findings.len(), 1);
    let diagram = findings.into_iter().next().unwrap().unwrap();
    openblog_core::diagram_svg::render(&diagram, 1)
        .unwrap_or_else(|error| panic!("generated Git diagram failed to render: {error}\n{draft}"));
}

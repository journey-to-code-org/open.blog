//! Publishing: commit content with git and push it, so a Pages (or any CI)
//! workflow deploys it. Used by `openblog publish` and the admin's Publish button.

use std::path::Path;

use openblog_core::frontmatter;
use openblog_core::SiteConfig;
use serde_json::json;

use crate::git::Git;
use crate::site;

fn is_private_assistant_path(path: &str) -> bool {
    let path = path.trim_start_matches("./").replace('\\', "/");
    path == ".openblog/private" || path.starts_with(".openblog/private/")
}

fn staged_private_assistant_paths(git: &Git) -> Result<Vec<String>, String> {
    Ok(git
        .run(&["diff", "--cached", "--name-only", "--", ".openblog/private"])?
        .lines()
        .filter(|path| is_private_assistant_path(path))
        .map(str::to_string)
        .collect())
}

#[derive(Debug, Default, Clone)]
pub struct Outcome {
    pub committed: Vec<String>,
    pub skipped_drafts: Vec<String>,
    pub commit: Option<String>,
    pub pushed: bool,
    pub message: String,
}

/// Paths under `content/` that hold drafts, so they can be kept out of a commit.
fn draft_files(root: &Path, config: &SiteConfig) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(sources) = site::read_sources(root, config) {
        for file in &sources.posts {
            if let Ok(doc) = frontmatter::parse(&file.contents) {
                let draft = doc.front_matter.get_bool("draft").unwrap_or(false)
                    || doc
                        .front_matter
                        .get("status")
                        .is_some_and(|s| s.eq_ignore_ascii_case("draft"));
                if draft {
                    out.push(format!(
                        "{}/{}",
                        config.paths.content.trim_end_matches('/'),
                        file.path
                    ));
                }
            }
        }
    }
    out
}

/// What `publish` would do, without doing it.
pub fn status(root: &Path, config: &SiteConfig) -> Result<serde_json::Value, String> {
    let git = Git::new(root);
    if !git.is_repo() {
        return Ok(json!({ "repo": false }));
    }
    let st = git.status(
        &config.publish.remote,
        &config.publish.branch,
        &config.publish.paths,
    )?;
    let drafts = draft_files(root, config);
    let visible_changes: Vec<&String> = st
        .changed
        .iter()
        .filter(|path| !is_private_assistant_path(path))
        .collect();
    let (publishable, held): (Vec<&String>, Vec<&String>) = visible_changes
        .into_iter()
        .partition(|p| config.publish.include_drafts || !drafts.contains(p));
    Ok(json!({
        "repo": true,
        "branch": st.branch,
        "remote": git.remote_url(&config.publish.remote),
        "changed": publishable,
        "drafts": held,
        "ahead": st.ahead,
        "behind": st.behind,
        "lastCommit": git.last_commit_time().map(|t| openblog_core::DateTime::from_unix(t).rfc3339()),
        "auto": config.publish.auto,
    }))
}

/// Commit changed content and push. `summary` becomes the commit message
/// (the caller passes the post title when it knows it).
pub fn publish(root: &Path, config: &SiteConfig, summary: Option<&str>) -> Result<Outcome, String> {
    let git = Git::new(root);
    if !git.is_repo() {
        return Err("this blog is not a git repository yet; run `git init` and add a remote, or `openblog publish setup`".into());
    }
    if !staged_private_assistant_paths(&git)?.is_empty() {
        return Err("private assistant files are staged in Git; unstage .openblog/private/ before publishing".into());
    }
    let p = &config.publish;
    let drafts = draft_files(root, config);
    let changed: Vec<String> = git
        .changed_paths(&p.paths)?
        .into_iter()
        .filter(|path| !is_private_assistant_path(path))
        .collect();
    let (to_commit, skipped): (Vec<String>, Vec<String>) = changed
        .into_iter()
        .partition(|path| p.include_drafts || !drafts.contains(path));

    let mut outcome = Outcome {
        skipped_drafts: skipped,
        ..Default::default()
    };
    if !to_commit.is_empty() {
        git.add(&to_commit)?;
        let message = match summary {
            Some(s) if !s.trim().is_empty() => format!("Publish: {}", s.trim()),
            _ => format!(
                "Publish {} change{}",
                to_commit.len(),
                if to_commit.len() == 1 { "" } else { "s" }
            ),
        };
        outcome.commit = Some(
            git.commit(&message)
                .map_err(|e| format!("git commit failed: {e}"))?,
        );
        outcome.committed = to_commit;
    }

    if git.has_remote(&p.remote) {
        // Before the first push the remote has no branch to pull from.
        if p.pull_first && git.remote_branch_exists(&p.remote, &p.branch) {
            if let Err(e) = git.pull_rebase(&p.remote, &p.branch) {
                return Err(format!(
                    "could not pull changes made elsewhere ({e}). Resolve this in git, then publish again."
                ));
            }
        }
        git.push(&p.remote, &p.branch)
            .map_err(|e| format!("git push failed: {e}"))?;
        outcome.pushed = true;
    } else if outcome.commit.is_some() {
        outcome.message = format!(
            "committed locally; no remote named `{}` to push to",
            p.remote
        );
    }
    if outcome.message.is_empty() {
        outcome.message = match (&outcome.commit, outcome.pushed) {
            (Some(id), true) => {
                format!("committed {id} and pushed; the deploy workflow will build it")
            }
            (None, true) => "nothing new to commit; pushed pending commits".into(),
            (Some(id), false) => format!("committed {id}"),
            (None, false) => "nothing to publish".into(),
        };
    }
    Ok(outcome)
}

/// Prepare a blog for publishing: a git repository, the Pages workflow, and
/// a report of what is still manual.
pub fn setup(root: &Path, config: &SiteConfig) -> Result<Vec<String>, String> {
    let mut notes = Vec::new();
    let git = Git::new(root);
    if !git.is_repo() {
        git.init()?;
        let _ = git.run(&["checkout", "-q", "-b", &config.publish.branch]);
        notes.push(format!(
            "created a git repository on branch `{}`",
            config.publish.branch
        ));
    }
    let workflow = root.join(".github/workflows/pages.yml");
    if !workflow.exists() {
        let text = site::PAGES_WORKFLOW.replace("OPENBLOG_VERSION", env!("CARGO_PKG_VERSION"));
        crate::fsutil::write_file(&workflow, text.as_bytes())?;
        notes.push("wrote .github/workflows/pages.yml".into());
    }
    match git.remote_url(&config.publish.remote) {
        Some(url) => notes.push(format!("remote `{}` is {url}", config.publish.remote)),
        None => notes.push(format!(
            "no remote named `{}` yet: create an empty repository on GitHub, then run\n  git remote add {} git@github.com:<you>/<repo>.git",
            config.publish.remote, config.publish.remote
        )),
    }
    notes.push("in the repository settings on GitHub, under Pages, set Source to \"GitHub Actions\" (one time)".into());
    if config.url.contains("example.com") {
        notes.push("set \"url\" in openblog.json to the address the site will have".into());
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn commits_content_but_keeps_drafts_out() {
        let dir = std::env::temp_dir().join(format!("ob-publish-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        crate::scaffold::init(&dir, Some("P"), false).unwrap();
        let git = Git::new(&dir);
        git.init().unwrap();
        git.run(&["config", "user.email", "t@example.com"]).unwrap();
        git.run(&["config", "user.name", "T"]).unwrap();
        fs::write(
            dir.join("content/posts/secret.md"),
            "---\ntitle: Secret\ndraft: true\n---\nshh",
        )
        .unwrap();
        let config = site::load_config(&dir).unwrap();

        let st = status(&dir, &config).unwrap();
        assert_eq!(st["repo"], true);
        assert!(st["drafts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "content/posts/secret.md"));
        assert!(!st["changed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "content/posts/secret.md"));

        let out = publish(&dir, &config, Some("Hello, world")).unwrap();
        assert!(out.commit.is_some());
        assert!(!out.pushed, "no remote configured");
        assert!(out
            .committed
            .iter()
            .any(|p| p == "content/posts/hello-world.md"));
        assert_eq!(out.skipped_drafts, vec!["content/posts/secret.md"]);
        let log = git.run(&["log", "--oneline"]).unwrap();
        assert!(log.contains("Publish: Hello, world"));
        let tracked = git.run(&["ls-files"]).unwrap();
        assert!(!tracked.contains("secret.md"), "drafts stay out of history");
        assert!(
            tracked.contains("openblog.json")
                && !tracked.contains("web/wasm/openblog_wasm_bg.wasm"),
            "only the configured paths are committed"
        );

        let again = publish(&dir, &config, None).unwrap();
        assert!(again.commit.is_none());
        assert_eq!(again.message, "nothing to publish");

        let notes = setup(&dir, &config).unwrap();
        assert!(dir.join(".github/workflows/pages.yml").exists());
        assert!(notes.iter().any(|n| n.contains("no remote")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn publishing_never_stages_or_commits_private_assistant_context() {
        let dir = std::env::temp_dir().join(format!(
            "ob-publish-private-assistant-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        crate::scaffold::init(&dir, Some("P"), false).unwrap();
        let git = Git::new(&dir);
        git.init().unwrap();
        git.run(&["config", "user.email", "t@example.com"]).unwrap();
        git.run(&["config", "user.name", "T"]).unwrap();
        git.run(&["config", "commit.gpgsign", "false"]).unwrap();
        fs::write(dir.join(".gitignore"), "/dist\n").unwrap();
        fs::create_dir_all(dir.join("assistant/context")).unwrap();
        fs::write(dir.join("assistant/context/author.md"), "Portable voice").unwrap();
        fs::create_dir_all(dir.join(".openblog/private/context")).unwrap();
        fs::write(
            dir.join(".openblog/private/context/author.md"),
            "Private voice",
        )
        .unwrap();
        let mut config = site::load_config(&dir).unwrap();
        config.publish.paths = vec!["assistant".into(), ".openblog".into()];

        let out = publish(&dir, &config, Some("Context")).unwrap();
        assert!(out
            .committed
            .iter()
            .any(|path| path == "assistant/context/author.md"));
        assert!(!out
            .committed
            .iter()
            .any(|path| path.starts_with(".openblog/private/")));
        assert!(!git
            .run(&["ls-files", "--", ".openblog/private"])
            .unwrap()
            .contains("private"));

        git.run(&["add", "-f", ".openblog/private/context/author.md"])
            .unwrap();
        let error = publish(&dir, &config, Some("Must refuse staged private context")).unwrap_err();
        assert!(error.contains("private assistant"));
        let _ = fs::remove_dir_all(&dir);
    }
}

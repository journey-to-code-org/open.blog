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
    let staged = git.run(&["diff", "--cached", "--name-only", "-z"])?;
    if staged
        .split('\0')
        .filter(|path| !path.is_empty())
        .any(|path| !to_commit.iter().any(|allowed| allowed == path))
    {
        return Err(
            "Git has staged files outside the publishable changes (possibly drafts); unstage them before publishing"
                .into(),
        );
    }

    // A research export or a copy of the notebook saved into a publishable
    // folder would be committed and pushed with the site: refuse by path.
    let private_research: Vec<&String> = to_commit
        .iter()
        .filter(|path| crate::private_guard::is_private_research_file(&root.join(path)))
        .collect();
    if !private_research.is_empty() {
        return Err(format!(
            "refusing to publish: {} look{} like private research (a research export or a copy of the notebook). Move {} outside the publishable folders; nothing was committed.",
            private_research
                .iter()
                .map(|path| format!("`{path}`"))
                .collect::<Vec<_>>()
                .join(", "),
            if private_research.len() == 1 { "s" } else { "" },
            if private_research.len() == 1 { "it" } else { "them" },
        ));
    }

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
        git.mark_first_unsent();
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
        git.clear_first_unsent();
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

/// What Admin says when a site that does not keep its files has no remote (ADR 0353).
/// The server that resets its files is the one visitors see, so what she saved already shows: the
/// trouble is that it is not kept, not that it is not out.
pub const NOWHERE_TO_PUBLISH: &str = "This site has nowhere to send your changes to be kept yet. Ask whoever set up this site to connect it to the place your site is kept. Until then, what you saved already shows on your site, apart from drafts and posts scheduled for later, but it stays only on this server and can vanish when it restarts, so keep your own copy of anything you would hate to lose.";

/// A failed push as Admin tells it to the owner (ADR 0353). `detail` is the
/// technical text, for whoever helps her.
#[derive(Debug, PartialEq, Eq)]
pub struct OwnerFailure {
    pub reason: &'static str,
    pub message: String,
    pub detail: String,
}

/// What git says, in lower case, when the push had no credential or a refused one.
const NO_PERMISSION: [&str; 14] = [
    "could not read username",
    "could not read password",
    "terminal prompts disabled",
    "authentication failed",
    "invalid username or",
    "password authentication",
    "no anonymous write access",
    "permission denied",
    "denied to",
    "write access to repository not granted",
    "repository not found",
    "could not read from remote repository",
    "host key verification failed",
    "returned error: 40",
];

/// Plain words for a failed push; `None` for a failure that is not a push, which
/// keeps its own words. `publish` itself keeps git's text, for the command line.
pub fn failure_for_owner(error: &str, files_may_vanish: bool) -> Option<OwnerFailure> {
    if !error.starts_with("git push failed") {
        return None;
    }
    let lower = error.to_lowercase();
    let no_permission = NO_PERMISSION.iter().any(|sign| lower.contains(sign));
    let what = if no_permission {
        "This site does not have permission yet to send your changes to the place your site is kept. This is a setup step, not something you did wrong: ask whoever set up this site to give it permission."
    } else {
        "Your changes could not be sent to the place your site is kept. Try again in a little while, and if it keeps happening, tell whoever set up this site."
    };
    let work = if files_may_vanish {
        "What you saved already shows on your site, apart from drafts and posts scheduled for later, but it is not kept: until this works, it stays only on this server and can vanish when it restarts, so keep your own copy of anything you would hate to lose."
    } else {
        "Your saved work is still here, so you can publish again once this is sorted out."
    };
    Some(OwnerFailure {
        reason: if no_permission {
            "no-permission"
        } else {
            "not-sent"
        },
        message: format!("{what} {work}"),
        detail: without_url_passwords(error),
    })
}

/// The detail gets copied into messages to whoever helps, so a credential written
/// into a remote address does not go with it.
fn without_url_passwords(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let (before, after) = rest.split_at(at + 3);
        out.push_str(before);
        let host_end = after
            .find(|c: char| c == '/' || c == '\'' || c == '"' || c.is_whitespace())
            .unwrap_or(after.len());
        rest = match after[..host_end].rfind('@') {
            Some(credential_end) => &after[credential_end + 1..],
            None => after,
        };
    }
    out.push_str(rest);
    out
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

    struct RemoteFixture {
        dir: std::path::PathBuf,
        root: std::path::PathBuf,
        remote: std::path::PathBuf,
        config: SiteConfig,
    }

    impl RemoteFixture {
        fn remote(&self, args: &[&str]) -> Result<String, String> {
            let mut command = vec!["--git-dir", self.remote.to_str().unwrap()];
            command.extend_from_slice(args);
            Git::new(&self.dir).run(&command)
        }

        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "ob-publish-{label}-{}-{}",
                std::process::id(),
                crate::auth::random_token().unwrap()
            ));
            fs::create_dir_all(&dir).unwrap();
            let remote = dir.join("remote.git");
            fs::create_dir(&remote).unwrap();
            Git::new(&remote).run(&["init", "--bare", "-q"]).unwrap();
            let root = dir.join("blog");
            crate::scaffold::init(&root, Some("Publish test"), false).unwrap();
            let git = Git::new(&root);
            git.init().unwrap();
            git.run(&["checkout", "-q", "-b", "main"]).unwrap();
            git.run(&["config", "user.name", "Publish test"]).unwrap();
            git.run(&["config", "user.email", "test@example.com"])
                .unwrap();
            git.run(&["config", "commit.gpgsign", "false"]).unwrap();
            git.run(&["remote", "add", "origin", remote.to_str().unwrap()])
                .unwrap();
            let config = site::load_config(&root).unwrap();
            Self {
                dir,
                root,
                remote,
                config,
            }
        }
    }

    impl Drop for RemoteFixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.dir).unwrap();
        }
    }

    #[test]
    fn publishes_to_remote_and_keeps_drafts_out_of_history() {
        let fixture = RemoteFixture::new("roundtrip");
        let draft = fixture.root.join("content/posts/private-draft.md");
        fs::write(
            &draft,
            "---\ntitle: Private draft\ndraft: true\n---\nPrivate text",
        )
        .unwrap();
        let result = publish(&fixture.root, &fixture.config, Some("Hosted round trip")).unwrap();
        assert!(result.pushed && result.commit.is_some());
        let files = fixture
            .remote(&["ls-tree", "-r", "--name-only", "main"])
            .unwrap();
        assert!(files.contains("content/posts/hello-world.md"));
        assert!(!files.contains("private-draft.md"));
        assert!(draft.exists());
        let message = fixture
            .remote(&["log", "-1", "--format=%B", "main"])
            .unwrap();
        assert!(message.contains("Publish: Hosted round trip"));
        assert!(!message.to_lowercase().contains("co-authored-by:"));
        let again = publish(&fixture.root, &fixture.config, None).unwrap();
        assert!(again.pushed && again.commit.is_none());
    }

    #[test]
    fn refuses_pre_staged_drafts_and_unrelated_files() {
        let fixture = RemoteFixture::new("staged");
        let git = Git::new(&fixture.root);
        let draft = fixture.root.join("content/posts/private-draft.md");
        fs::write(
            &draft,
            "---\ntitle: Private draft\ndraft: true\n---\nPrivate text",
        )
        .unwrap();
        git.run(&["add", "content/posts/private-draft.md"]).unwrap();
        let error = publish(&fixture.root, &fixture.config, None).unwrap_err();
        assert!(error.contains("unstage"));
        assert!(git.run(&["rev-parse", "--verify", "HEAD"]).is_err());
        git.run(&["rm", "--cached", "content/posts/private-draft.md"])
            .unwrap();
        fs::write(fixture.root.join("unrelated.txt"), "Not publishing input").unwrap();
        git.run(&["add", "unrelated.txt"]).unwrap();
        assert!(publish(&fixture.root, &fixture.config, None).is_err());
    }

    #[test]
    fn a_push_with_no_credential_reads_in_plain_words() {
        // Git's own words for each way a push can lack a credential.
        for said in [
            "fatal: could not read Username for 'https://github.com': No such device or address",
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/me/blog.git/'",
            "remote: Permission to me/blog.git denied to someone.\nfatal: unable to access 'https://github.com/me/blog.git/': The requested URL returned error: 403",
            "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
        ] {
            let failure = failure_for_owner(&format!("git push failed: {said}"), false).unwrap();
            assert_eq!(failure.reason, "no-permission", "{said}");
            assert!(failure.message.contains("does not have permission"));
            assert!(failure.message.contains("whoever set up this site"));
            assert!(failure.message.contains("still here"));
            assert!(!failure.message.to_lowercase().contains("git"));
            assert!(!failure.message.contains("push"));
            assert!(failure.detail.contains(said));
        }
    }

    #[test]
    fn what_a_failed_push_means_for_her_work_depends_on_whether_the_files_last() {
        let said = "git push failed: fatal: could not read Username for 'https://github.com': No such device or address";
        let failure = failure_for_owner(said, true).unwrap();
        assert!(failure.message.contains("can vanish when it restarts"));
        assert!(!failure.message.contains("still here"));
    }

    #[test]
    fn a_refused_push_never_says_her_saved_work_is_not_out() {
        // Where the files do not last, the server is the one visitors see: what she saved already
        // shows there. What failed is keeping it, and that is what she is told.
        for said in [
            "git push failed: fatal: Authentication failed for 'https://github.com/me/blog.git/'",
            "git push failed: To origin\n ! [rejected] HEAD -> main (non-fast-forward)",
        ] {
            for files_may_vanish in [true, false] {
                let message = failure_for_owner(said, files_may_vanish).unwrap().message;
                assert!(!message.contains("not published"), "{message}");
                assert!(!message.contains("not live"), "{message}");
                assert_eq!(
                    message.contains("already shows on your site"),
                    files_may_vanish,
                    "{message}"
                );
            }
        }
        assert!(!NOWHERE_TO_PUBLISH.contains("not published"));
        assert!(NOWHERE_TO_PUBLISH.contains("already shows on your site"));
        assert!(NOWHERE_TO_PUBLISH.contains("can vanish when it restarts"));
    }

    #[test]
    fn saying_her_work_already_shows_leaves_out_posts_scheduled_for_later() {
        // A post dated in the future is saved but does not show until its date, so "already
        // shows" must name it alongside drafts.
        let refused = failure_for_owner(
            "git push failed: fatal: Authentication failed for 'https://github.com/me/blog.git/'",
            true,
        )
        .unwrap()
        .message;
        for message in [refused.as_str(), NOWHERE_TO_PUBLISH] {
            assert!(
                message.contains("apart from drafts and posts scheduled for later"),
                "{message}"
            );
        }
    }

    #[test]
    fn any_other_failed_push_is_plain_too_and_other_refusals_keep_their_words() {
        let failure = failure_for_owner(
            "git push failed: To origin\n ! [rejected] HEAD -> main (non-fast-forward)",
            false,
        )
        .unwrap();
        assert_eq!(failure.reason, "not-sent");
        assert!(failure.message.contains("could not be sent"));
        assert!(failure.detail.contains("non-fast-forward"));
        assert_eq!(
            failure_for_owner("refusing to publish: x looks like private research", false),
            None
        );
    }

    #[test]
    fn the_detail_leaves_out_a_password_in_a_remote_address() {
        let failure = failure_for_owner(
            "git push failed: unable to access 'https://me:s3cret@github.com/me/blog.git/': 500\nssh://git@host/x and https://github.com/me/blog.git",
            false,
        )
        .unwrap();
        assert!(!failure.detail.contains("s3cret"), "{}", failure.detail);
        assert!(failure
            .detail
            .contains("'https://github.com/me/blog.git/': 500"));
        assert!(failure.detail.contains("https://github.com/me/blog.git"));
    }

    #[test]
    fn reports_push_rejection_without_losing_the_local_commit() {
        let fixture = RemoteFixture::new("rejected");
        fixture
            .remote(&["config", "receive.denyCurrentBranch", "refuse"])
            .unwrap();
        fixture.remote(&["config", "core.bare", "false"]).unwrap();
        fixture
            .remote(&["symbolic-ref", "HEAD", "refs/heads/main"])
            .unwrap();
        let error = publish(&fixture.root, &fixture.config, Some("Rejected test")).unwrap_err();
        assert!(error.contains("git push failed"));
        assert!(Git::new(&fixture.root)
            .run(&["log", "-1", "--format=%B"])
            .unwrap()
            .contains("Publish: Rejected test"));
    }

    /// A remote with no branch yet, whose hook refuses every push until it is taken away.
    fn refuse_pushes(fixture: &RemoteFixture) -> std::path::PathBuf {
        let hook = fixture.remote.join("hooks/pre-receive");
        fs::create_dir_all(hook.parent().unwrap()).unwrap();
        fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        hook
    }

    fn ahead(fixture: &RemoteFixture) -> u64 {
        status(&fixture.root, &fixture.config).unwrap()["ahead"]
            .as_u64()
            .unwrap()
    }

    #[test]
    fn a_refused_push_with_no_tracking_ref_still_counts_as_waiting_until_it_goes_out() {
        let fixture = RemoteFixture::new("unsent");
        let hook = refuse_pushes(&fixture);
        assert!(publish(&fixture.root, &fixture.config, Some("First"))
            .unwrap_err()
            .contains("git push failed"));
        assert_eq!(ahead(&fixture), 1);

        // A second commit that is refused too counts from the first.
        fs::write(
            fixture.root.join("content/posts/more.md"),
            "---\ntitle: More\ndate: 2026-10-01\n---\nWords.\n",
        )
        .unwrap();
        assert!(publish(&fixture.root, &fixture.config, Some("Second")).is_err());
        assert_eq!(ahead(&fixture), 2);

        // Retrying with nothing new to commit, once the remote takes it, clears the mark.
        fs::remove_file(hook).unwrap();
        publish(&fixture.root, &fixture.config, None).unwrap();
        assert_eq!(ahead(&fixture), 0);
        assert!(Git::new(&fixture.root)
            .run(&["rev-parse", "--verify", "-q", "refs/openblog/first-unsent"])
            .is_err());
    }

    #[test]
    fn a_shipped_checkout_with_no_tracking_ref_and_nothing_refused_is_not_waiting() {
        // As a container comes up: history fetched by commit, no remote-tracking ref, no publish yet.
        let fixture = RemoteFixture::new("shipped");
        let git = Git::new(&fixture.root);
        git.run(&["add", "-A"]).unwrap();
        git.run(&["commit", "-q", "-m", "Shipped"]).unwrap();
        assert_eq!(ahead(&fixture), 0);
    }

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

    #[test]
    fn publishing_never_commits_the_private_notebook_or_an_export_saved_into_a_publishable_folder()
    {
        let dir = std::env::temp_dir().join(format!(
            "ob-publish-private-research-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        crate::scaffold::init(&dir, Some("P"), false).unwrap();
        let git = Git::new(&dir);
        git.init().unwrap();
        git.run(&["config", "user.email", "t@example.com"]).unwrap();
        git.run(&["config", "user.name", "T"]).unwrap();
        git.run(&["config", "commit.gpgsign", "false"]).unwrap();
        fs::write(
            dir.join(".gitignore"),
            "/dist
",
        )
        .unwrap();
        let notebook = r#"{"version":1,"notes":[{"id":"n","kind":"observation","text":"ob-sentinel-publish-1"}]}"#;
        fs::create_dir_all(dir.join(".openblog/private/research")).unwrap();
        fs::write(dir.join(crate::notebook_store::NOTEBOOK_FILE), notebook).unwrap();
        let mut config = site::load_config(&dir).unwrap();
        config.publish.paths = vec!["content".into(), "static".into(), ".openblog".into()];

        // The private notebook is not published even when its folder is listed.
        let out = publish(&dir, &config, Some("Private notebook")).unwrap();
        assert!(!out
            .committed
            .iter()
            .any(|path| path.contains("notebook.json")));
        assert!(git
            .run(&["ls-files"])
            .unwrap()
            .lines()
            .all(|path| !path.contains("notebook.json")));

        // An export (or any copy of the notebook) in a publishable folder stops the publish.
        fs::create_dir_all(dir.join("static")).unwrap();
        fs::write(dir.join("static/backup.json"), notebook).unwrap();
        let before = git.run(&["rev-parse", "HEAD"]).unwrap();
        let error = publish(&dir, &config, Some("Leak")).unwrap_err();
        assert!(
            error.contains("static/backup.json") && error.contains("private research"),
            "{error}"
        );
        assert!(!error.contains("ob-sentinel-publish-1"), "{error}");
        assert_eq!(
            git.run(&["rev-parse", "HEAD"]).unwrap(),
            before,
            "nothing was committed"
        );
        assert!(git
            .run(&["diff", "--cached", "--name-only"])
            .unwrap()
            .trim()
            .is_empty());

        // Removing it lets the publish go ahead.
        fs::remove_file(dir.join("static/backup.json")).unwrap();
        assert!(publish(&dir, &config, Some("Clean")).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }
}

//! `openblog submit`: guided community submissions (epic #384, story #395, ADRs 0800 to 0803).
//!
//! Prepares, for one production-visible post, what the author needs to submit it by hand to a
//! community, and records the submissions the author says they made. Nothing here sends a
//! request, reads a credential or fetches a provider page.

use std::path::Path;

use openblog_core::community_submission::{self, Destination, KitRequest, SubmissionError};
use openblog_core::config::SiteConfig;

use crate::fsutil;
use crate::syndication::{new_artifact_folder, public_post};

pub const USAGE: &str =
    "usage: openblog submit <slug> --to hacker-news [--title <text>] [--kit <new folder>]";

#[derive(Clone, Debug, Default)]
pub struct Options {
    /// Comma-separated destinations, such as `hacker-news`.
    pub to: Option<String>,
    /// The author's own title for this run.
    pub title: Option<String>,
    /// Write the kit (`index.html` and `kit.json`) into this new folder.
    pub kit: Option<String>,
}

fn refused(error: SubmissionError) -> String {
    format!("[{}] {error} Nothing was prepared.", error.code())
}

/// The destinations named with `--to`, each one the author has turned on.
fn destinations(config: &SiteConfig, to: Option<&str>) -> Result<Vec<Destination>, String> {
    let list = Destination::parse_list(to.unwrap_or_default()).map_err(refused)?;
    for destination in &list {
        if !config.community.enabled(destination.provider()) {
            return Err(refused(SubmissionError::Disabled(destination.provider())));
        }
    }
    Ok(list)
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    // The disabled state is answered before any post is read, so a site that never opted in
    // learns how to, and nothing else happens.
    let config = crate::site::load_config(root)?;
    let chosen = destinations(&config, options.to.as_deref())?;
    let (config, post) = public_post(root, slug)?;
    let request = KitRequest {
        slug,
        post_title: &post.title,
        title: options.title.as_deref(),
        canonical_url: &post.canonical_url,
        site_title: &config.title,
    };
    let kit = community_submission::prepare(&request, &chosen);
    match options.kit.as_deref() {
        None => print!("{}", community_submission::kit_text(&kit)),
        Some(directory) => {
            let folder = new_artifact_folder(root, directory, "submission kit")?;
            let write = |name: &str, bytes: &[u8]| {
                fsutil::create_new_file(&folder.join(name), bytes).map_err(|cause| {
                    format!("cannot write {name} in {}: {cause}", folder.display())
                })
            };
            write("kit.json", community_submission::kit_json(&kit).as_bytes())?;
            write(
                "index.html",
                community_submission::kit_page(&kit).as_bytes(),
            )?;
            println!(
                "Submission kit for `{}` written to {}. Nothing was submitted; open index.html, check each destination's rules, and submit by hand.",
                post.title,
                folder.display()
            );
            for d in &kit.destinations {
                let codes: Vec<&str> = d.notices.iter().map(|n| n.code).collect();
                println!(
                    "- {}: {}{}",
                    d.label,
                    if d.ready() {
                        "ready to submit by hand"
                    } else {
                        "blocked"
                    },
                    if codes.is_empty() {
                        String::new()
                    } else {
                        format!(" [{}]", codes.join(", "))
                    }
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Site(std::path::PathBuf);

    impl Site {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Site {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn site(community: &str) -> Site {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = Site(std::env::temp_dir().join(format!(
            "openblog-submit-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        )));
        let _ = fs::remove_dir_all(dir.path());
        let root = dir.path();
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::write(
            root.join("openblog.json"),
            format!(
                r#"{{"title":"Field Notes","url":"https://notes.example.org","community":{community}}}"#
            ),
        )
        .unwrap();
        fs::write(
            root.join("content/posts/2026-01-01-hello.md"),
            "---\ntitle: Hello community\ndate: 2026-01-01\nslug: hello\n---\nBody.\n",
        )
        .unwrap();
        fs::write(
            root.join("content/posts/2026-01-02-draft.md"),
            "---\ntitle: Not yet\ndate: 2026-01-02\nslug: unseen\ndraft: true\n---\nSecret draft body.\n",
        )
        .unwrap();
        dir
    }

    fn options(to: &str) -> Options {
        Options {
            to: Some(to.into()),
            ..Options::default()
        }
    }

    #[test]
    fn a_site_that_never_opted_in_is_told_how_and_nothing_is_prepared() {
        let dir = site("{}");
        let error = run(dir.path(), "hello", options("hacker-news")).unwrap_err();
        assert!(error.contains("[destination-disabled]"), "{error}");
        assert!(error.contains("community.hackerNews.enabled"), "{error}");
        let error = run(dir.path(), "hello", Options::default()).unwrap_err();
        assert!(error.contains("[no-destination]"), "{error}");
    }

    #[test]
    fn a_draft_is_never_prepared() {
        let dir = site(r#"{"hackerNews":{"enabled":true}}"#);
        let error = run(dir.path(), "unseen", options("hacker-news")).unwrap_err();
        assert!(error.contains("not production-visible"), "{error}");
    }

    #[test]
    fn the_kit_is_written_into_a_new_folder_only() {
        let dir = site(r#"{"hackerNews":{"enabled":true}}"#);
        let mut with_kit = options("hacker-news");
        with_kit.kit = Some("kit".into());
        run(dir.path(), "hello", with_kit.clone()).unwrap();
        let page = fs::read_to_string(dir.path().join("kit/index.html")).unwrap();
        assert!(page.contains("Hello community"));
        assert!(page.contains("submitlink?u=https%3A%2F%2Fnotes.example.org%2Fposts%2Fhello%2F"));
        let json = fs::read_to_string(dir.path().join("kit/kit.json")).unwrap();
        assert!(json.contains("\"canonicalUrl\": \"https://notes.example.org/posts/hello/\""));
        let error = run(dir.path(), "hello", with_kit).unwrap_err();
        assert!(
            error.contains("refusing to write a submission kit into existing"),
            "{error}"
        );
    }
}

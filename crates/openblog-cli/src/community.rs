//! `openblog submit`: guided community submissions (epic #384, story #395, ADRs 0800 to 0803).
//!
//! Prepares, for one production-visible post, what the author needs to submit it by hand to a
//! community, and records the submissions the author says they made. Nothing here sends a
//! request, reads a credential or fetches a provider page.

use std::fs;
use std::path::{Component, Path, PathBuf};

use openblog_core::community_submission::{
    self, Confirmation, Destination, KitRequest, SubmissionError, SubmissionRecords,
};
use openblog_core::config::SiteConfig;

use crate::fsutil;
use crate::syndication::{new_artifact_folder, public_post};

pub const USAGE: &str = "usage: openblog submit <slug> --to hacker-news,reddit:<community> [--title <text>] [--kit <new folder>] [--again]
       openblog submit <slug> --confirm <destination> [--permalink <address>] [--title <text>] [--again]
       openblog submit <slug> --list";

#[derive(Clone, Debug, Default)]
pub struct Options {
    /// Comma-separated destinations, such as `hacker-news,reddit:rust`.
    pub to: Option<String>,
    /// The author's own title for this run.
    pub title: Option<String>,
    /// Write the kit (`index.html` and `kit.json`) into this new folder.
    pub kit: Option<String>,
    /// Record that the author submitted the post to this destination by hand.
    pub confirm: Option<String>,
    /// The address of the author's submission, with `confirm`.
    pub permalink: Option<String>,
    /// Print what the author confirmed for the post.
    pub list: bool,
    /// Prepare an HN repost after a quiet year, or record a second confirmation.
    pub again: bool,
}

fn refused(error: SubmissionError) -> String {
    format!(
        "[{}] {error} Nothing was prepared or recorded.",
        error.code()
    )
}

/// The destinations named, each one the author has turned on.
fn destinations(config: &SiteConfig, to: &str) -> Result<Vec<Destination>, String> {
    config.community.validate()?;
    let list = Destination::parse_list(to).map_err(refused)?;
    for destination in &list {
        if !config.community.enabled(destination.provider()) {
            return Err(refused(SubmissionError::Disabled(destination.provider())));
        }
    }
    Ok(list)
}

fn records_path(root: &Path, config: &SiteConfig) -> Result<PathBuf, String> {
    let relative = Path::new(&config.community.state_file);
    if config.community.state_file.trim().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("community.stateFile must be a project-relative path without `..`".into());
    }
    Ok(root.join(relative))
}

fn load_records(path: &Path) -> Result<SubmissionRecords, String> {
    match fs::read_to_string(path) {
        Ok(text) => SubmissionRecords::from_json(&text)
            .map_err(|error| format!("[{}] {error} ({})", error.code(), path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(SubmissionRecords::default())
        }
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    let modes = [
        options.to.is_some(),
        options.confirm.is_some(),
        options.list,
    ]
    .iter()
    .filter(|on| **on)
    .count();
    if modes > 1
        || (options.kit.is_some() && options.to.is_none())
        || (options.permalink.is_some() && options.confirm.is_none())
    {
        return Err(format!(
            "--to, --confirm and --list each run alone; --kit goes with --to and --permalink with --confirm\n{USAGE}"
        ));
    }
    // The disabled state is answered before any post is read, so a site that never opted in
    // learns how to, and nothing else happens. Listing needs only a valid configuration.
    let config = crate::site::load_config(root)?;
    let chosen = if options.list {
        config.community.validate()?;
        Vec::new()
    } else {
        destinations(
            &config,
            options
                .confirm
                .as_deref()
                .or(options.to.as_deref())
                .unwrap_or_default(),
        )?
    };
    if options.confirm.is_some() && chosen.len() != 1 {
        return Err("--confirm records one destination at a time".into());
    }
    let (config, post) = public_post(root, slug)?;
    let path = records_path(root, &config)?;
    let mut records = load_records(&path)?;
    if options.list {
        print!("{}", list_text(&records, &post.source_id, slug));
        return Ok(());
    }
    if let Some(destination) = options.confirm.as_ref().and(chosen.first()) {
        let title = options.title.as_deref().unwrap_or(&post.title);
        let entry = community_submission::confirm(
            &mut records,
            &Confirmation {
                source_id: &post.source_id,
                canonical_url: &post.canonical_url,
                title,
                destination,
                permalink: options.permalink.as_deref(),
                now: crate::clock::now(),
                again: options.again,
            },
        )
        .map_err(refused)?;
        fsutil::write_file(&path, records.to_json().as_bytes())?;
        println!(
            "Recorded that you submitted `{}` to {} by hand{}. open.blog did not check this with the provider; it only keeps the post from being prepared there again.",
            post.title,
            destination.label(),
            entry
                .permalink
                .map(|p| format!(" ({p})"))
                .unwrap_or_default()
        );
        return Ok(());
    }
    let request = KitRequest {
        slug,
        source_id: &post.source_id,
        post_title: &post.title,
        title: options.title.as_deref(),
        canonical_url: &post.canonical_url,
        site_title: &config.title,
        config: &config.community,
        destinations: &chosen,
        now_unix: crate::clock::now().unix(),
        records: &records,
        again: options.again,
    };
    let kit = community_submission::prepare(&request);
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

fn list_text(records: &SubmissionRecords, source_id: &str, slug: &str) -> String {
    let Some(destinations) = records.for_source(source_id).filter(|d| !d.is_empty()) else {
        return format!("You have not confirmed submitting `{slug}` anywhere.\n");
    };
    let mut out = format!(
        "Submissions of `{slug}` you confirmed (your word; open.blog did not check them):\n"
    );
    for (key, list) in destinations {
        for entry in list {
            out.push_str(&format!(
                "- {key}: author-confirmed on {}{}\n",
                entry.confirmed_at,
                entry
                    .permalink
                    .as_deref()
                    .map(|p| format!(" {p}"))
                    .unwrap_or_default()
            ));
        }
    }
    out
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
    fn a_reddit_kit_needs_the_opt_in_and_the_communitys_rules() {
        let dir =
            site(r#"{"reddit":{"enabled":false,"communities":{"rust":{"rules":["On topic"]}}}}"#);
        let error = run(dir.path(), "hello", options("reddit:rust")).unwrap_err();
        assert!(error.contains("community.reddit.enabled"), "{error}");

        let dir = site(r#"{"reddit":{"enabled":true,"communities":{"rust":{"rules":[]}}}}"#);
        let error = run(dir.path(), "hello", options("reddit:rust")).unwrap_err();
        assert!(
            error.contains("community.reddit.communities.rust"),
            "{error}"
        );

        let dir = site(
            r#"{"reddit":{"enabled":true,"communities":{"rust":{"rules":["On topic","No memes"],"reviewed":"2026-10-01"}}}}"#,
        );
        let mut with_kit = options("reddit:rust,reddit:golang");
        with_kit.kit = Some("kit".into());
        run(dir.path(), "hello", with_kit).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("kit/kit.json")).unwrap())
                .unwrap();
        let rust = &json["destinations"][0];
        assert_eq!(rust["destination"], "reddit:rust");
        assert!(rust["submitUrl"]
            .as_str()
            .unwrap()
            .starts_with("https://www.reddit.com/r/rust/submit?url="));
        let golang = &json["destinations"][1];
        assert!(golang["submitUrl"].is_null());
        assert_eq!(golang["notices"][0]["code"], "community-rules-missing");
    }

    #[test]
    fn a_confirmed_submission_is_recorded_privately_and_not_prepared_again() {
        let dir = site(r#"{"hackerNews":{"enabled":true}}"#);
        let confirm = |permalink: Option<&str>, again: bool| {
            run(
                dir.path(),
                "hello",
                Options {
                    confirm: Some("hacker-news".into()),
                    permalink: permalink.map(str::to_string),
                    again,
                    ..Options::default()
                },
            )
        };
        let error = confirm(Some("https://example.org/item?id=1"), false).unwrap_err();
        assert!(error.contains("[invalid-permalink]"), "{error}");
        assert!(!dir
            .path()
            .join(".openblog/community-submissions.json")
            .exists());
        confirm(Some("https://news.ycombinator.com/item?id=77"), false).unwrap();
        let text =
            fs::read_to_string(dir.path().join(".openblog/community-submissions.json")).unwrap();
        assert!(text.contains("\"status\": \"author-confirmed\""), "{text}");
        assert!(text.contains("https://news.ycombinator.com/item?id=77"));
        let error = confirm(None, false).unwrap_err();
        assert!(error.contains("[already-confirmed]"), "{error}");

        let mut kit = options("hacker-news");
        kit.kit = Some("kit".into());
        run(dir.path(), "hello", kit).unwrap();
        let json = fs::read_to_string(dir.path().join("kit/kit.json")).unwrap();
        assert!(json.contains("\"code\": \"already-submitted\""), "{json}");
        assert!(json.contains("\"submitUrl\": null"));

        let listing = Options {
            list: true,
            ..Options::default()
        };
        run(dir.path(), "hello", listing).unwrap();
        let error = run(
            dir.path(),
            "hello",
            Options {
                list: true,
                to: Some("hacker-news".into()),
                ..Options::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("each run alone"), "{error}");
        let records =
            load_records(&dir.path().join(".openblog/community-submissions.json")).unwrap();
        let source = records.records.keys().next().unwrap().clone();
        assert!(
            source.starts_with("source:") && source.ends_with("2026-01-01-hello.md"),
            "{source}"
        );
        let text = list_text(&records, &source, "hello");
        assert!(text.contains("hacker-news: author-confirmed on "), "{text}");
        assert!(text.contains("open.blog did not check"));
    }

    #[test]
    fn a_records_file_outside_the_project_is_refused() {
        let dir = site(r#"{"hackerNews":{"enabled":true},"stateFile":"../escape.json"}"#);
        let error = run(
            dir.path(),
            "hello",
            Options {
                confirm: Some("hacker-news".into()),
                ..Options::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("community.stateFile"), "{error}");
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

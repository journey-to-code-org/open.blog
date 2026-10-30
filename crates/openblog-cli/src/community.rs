//! `openblog submit`: guided community submissions and Product Hunt launch kits (epic #384,
//! stories #395 and #396, ADRs 0800 to 0807).
//!
//! Prepares, for one production-visible post, what the author needs to submit it by hand to a
//! community, and records the submissions the author says they made. Nothing here sends a
//! request, reads a credential or fetches a provider page.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use openblog_core::community_submission::{
    self, Confirmation, Destination, KitRequest, SubmissionError, SubmissionRecords,
};
use openblog_core::config::SiteConfig;
use openblog_core::launch_kit::{self, ImageProbe, LaunchPlan, LaunchRequest};

use crate::fsutil;
use crate::syndication::{new_artifact_folder, public_post};

pub const USAGE: &str = "usage: openblog submit <slug> --to hacker-news,reddit:<community> [--title <text>] [--kit <new folder>] [--again]
       openblog submit <slug> --to product-hunt [--kit <new folder>] [--again]
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
    let launching = options.to.is_some() && chosen.contains(&Destination::ProductHunt);
    if launching && (chosen.len() != 1 || options.title.is_some()) {
        return Err(
            "product-hunt is prepared on its own, from its launch plan: run --to product-hunt without other destinations or --title".into(),
        );
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
    if launching {
        return launch(root, slug, &config, &post, &records, &options);
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

/// Prepares a Product Hunt launch kit from the maker's launch plan (ADRs 0805, 0806). It reads the
/// plan and the images it names inside the project, and writes only into a new folder.
fn launch(
    root: &Path,
    slug: &str,
    config: &SiteConfig,
    post: &crate::syndication::SyndicationPost,
    records: &SubmissionRecords,
    options: &Options,
) -> Result<(), String> {
    let relative = format!(
        "{}/{slug}.json",
        config
            .community
            .product_hunt
            .launch_dir
            .trim_end_matches(['/', '\\'])
    );
    let plan_path = root.join(&relative);
    let text = match fs::read_to_string(&plan_path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!(
                "[launch-plan-missing] There is no launch plan at {relative}. Write the product's name, tagline, description, thumbnail and gallery there (see docs/community-submissions.md). Nothing was prepared."
            ))
        }
        Err(error) => return Err(format!("cannot read {relative}: {error}")),
    };
    let plan = LaunchPlan::from_json(&text).map_err(|error| {
        format!("[launch-plan-invalid] {relative}: {error}. Nothing was prepared.")
    })?;
    let (images, found) = probe_images(root, &plan)?;
    let kit = launch_kit::prepare(&LaunchRequest {
        slug,
        source_id: &post.source_id,
        post_title: &post.title,
        canonical_url: &post.canonical_url,
        plan: &plan,
        images: &images,
        now_unix: crate::clock::now().unix(),
        records,
        again: options.again,
    });
    let Some(directory) = options.kit.as_deref() else {
        print!("{}", launch_kit::kit_text(&kit));
        return Ok(());
    };
    let folder = new_artifact_folder(root, directory, "launch kit")?;
    let write = |name: &str, bytes: &[u8]| {
        fsutil::create_new_file(&folder.join(name), bytes)
            .map_err(|cause| format!("cannot write {name} in {}: {cause}", folder.display()))
    };
    let copies: Vec<(&str, &PathBuf)> = kit
        .thumbnail
        .iter()
        .chain(&kit.gallery)
        .filter_map(|image| Some((image.file.as_deref()?, found.get(&image.source)?)))
        .collect();
    if !copies.is_empty() {
        fs::create_dir(folder.join("images"))
            .map_err(|error| format!("cannot create images in {}: {error}", folder.display()))?;
    }
    for (name, source) in copies {
        let bytes = fs::read(source)
            .map_err(|error| format!("cannot read {}: {error}", source.display()))?;
        write(name, &bytes)?;
    }
    write("kit.json", launch_kit::kit_json(&kit).as_bytes())?;
    write("index.html", launch_kit::kit_page(&kit).as_bytes())?;
    let codes: Vec<&str> = kit.notices.iter().map(|n| n.code).collect();
    println!(
        "Launch kit for `{}` written to {}. Nothing was launched, scheduled or uploaded; open index.html, copy each field into Product Hunt's form and launch it there yourself.
- Product Hunt: {}{}",
        post.title,
        folder.display(),
        if kit.ready() {
            "ready to enter by hand"
        } else {
            "blocked"
        },
        if codes.is_empty() {
            String::new()
        } else {
            format!(" [{}]", codes.join(", "))
        }
    );
    Ok(())
}

/// What the CLI found at each image path a launch plan names, and the real file of each image
/// found inside the project.
type Probed = (BTreeMap<String, ImageProbe>, BTreeMap<String, PathBuf>);

/// Probes each image the plan names. A path whose real location (after links) is outside the
/// project is never read.
fn probe_images(root: &Path, plan: &LaunchPlan) -> Result<Probed, String> {
    let mut probes = BTreeMap::new();
    let mut found = BTreeMap::new();
    let project = fs::canonicalize(root)
        .map_err(|error| format!("cannot resolve {}: {error}", root.display()))?;
    for file in plan.image_files() {
        if !launch_kit::project_relative(file) {
            continue;
        }
        let probe = match fs::canonicalize(root.join(file)) {
            Err(_) => ImageProbe::Missing,
            Ok(real) if !real.starts_with(&project) => ImageProbe::Outside,
            Ok(real) => match fs::metadata(&real) {
                Ok(meta) if meta.is_file() => {
                    let mut head = Vec::new();
                    use std::io::Read;
                    fs::File::open(&real)
                        .and_then(|f| f.take(256 * 1024).read_to_end(&mut head))
                        .map_err(|error| format!("cannot read {file}: {error}"))?;
                    let (format, size) = launch_kit::sniff_image(&head);
                    found.insert(file.to_string(), real);
                    ImageProbe::Found {
                        bytes: meta.len(),
                        format,
                        size,
                    }
                }
                _ => ImageProbe::Missing,
            },
        };
        probes.insert(file.to_string(), probe);
    }
    Ok((probes, found))
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

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(w.to_be_bytes());
        bytes.extend(h.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0]);
        bytes
    }

    fn launch_site(plan: &str) -> Site {
        let dir = site(r#"{"productHunt":{"enabled":true}}"#);
        let root = dir.path();
        fs::create_dir_all(root.join("launches/shots")).unwrap();
        fs::write(root.join("launches/shots/thumb.png"), png(240, 240)).unwrap();
        fs::write(root.join("launches/shots/one.png"), png(1270, 760)).unwrap();
        fs::write(root.join("launches/shots/two.png"), png(1270, 760)).unwrap();
        fs::write(root.join("launches/hello.json"), plan).unwrap();
        dir
    }

    const PLAN: &str = r#"{
        "name": "Field Notes",
        "tagline": "A notebook that publishes itself",
        "description": "Write in Markdown, publish a fast static site.",
        "thumbnail": {"file": "launches/shots/thumb.png", "alt": "Logo"},
        "gallery": [
            {"file": "launches/shots/one.png", "alt": "The editor"},
            {"file": "launches/shots/two.png", "alt": "A post"}
        ],
        "tags": ["Writing"],
        "firstComment": "Why I made it: https://notes.example.org/posts/hello/"
    }"#;

    #[test]
    fn the_copy_script_is_the_one_the_page_policy_allows() {
        use base64::Engine;
        use sha2::Digest;
        let digest = sha2::Sha256::digest(launch_kit::COPY_SCRIPT.as_bytes());
        assert_eq!(
            base64::engine::general_purpose::STANDARD.encode(digest),
            launch_kit::COPY_SCRIPT_SHA256
        );
    }

    #[test]
    fn a_launch_kit_needs_the_opt_in_a_plan_and_to_be_prepared_alone() {
        let dir = site("{}");
        let error = run(dir.path(), "hello", options("product-hunt")).unwrap_err();
        assert!(error.contains("community.productHunt.enabled"), "{error}");

        let dir = site(r#"{"productHunt":{"enabled":true},"hackerNews":{"enabled":true}}"#);
        let error = run(dir.path(), "hello", options("product-hunt")).unwrap_err();
        assert!(error.contains("[launch-plan-missing]"), "{error}");
        assert!(error.contains("launches/hello.json"), "{error}");
        let error = run(dir.path(), "hello", options("product-hunt,hacker-news")).unwrap_err();
        assert!(error.contains("on its own"), "{error}");

        let dir = launch_site(r#"{"name":"x","pitch":"unknown"}"#);
        let error = run(dir.path(), "hello", options("product-hunt")).unwrap_err();
        assert!(error.contains("[launch-plan-invalid]"), "{error}");
        let dir = site(r#"{"productHunt":{"enabled":true,"launchDir":"../elsewhere"}}"#);
        let error = run(dir.path(), "hello", options("product-hunt")).unwrap_err();
        assert!(error.contains("launchDir"), "{error}");
    }

    #[test]
    fn a_launch_kit_copies_only_the_named_images_beside_its_page() {
        let dir = launch_site(PLAN);
        fs::write(dir.path().join("launches/shots/unrelated.png"), png(1, 1)).unwrap();
        let mut with_kit = options("product-hunt");
        with_kit.kit = Some("kit".into());
        run(dir.path(), "hello", with_kit.clone()).unwrap();
        let kit = dir.path().join("kit");
        assert_eq!(
            fs::read(kit.join("images/thumbnail.png")).unwrap(),
            png(240, 240)
        );
        assert!(kit.join("images/gallery-01.png").is_file());
        assert!(kit.join("images/gallery-02.png").is_file());
        assert_eq!(fs::read_dir(kit.join("images")).unwrap().count(), 3);
        let page = fs::read_to_string(kit.join("index.html")).unwrap();
        assert!(page.contains("Prepared, not launched."));
        assert!(page.contains("https://www.producthunt.com/posts/new"));
        assert!(!page.contains("Secret draft body"));
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(kit.join("kit.json")).unwrap()).unwrap();
        assert_eq!(
            json["canonicalUrl"],
            "https://notes.example.org/posts/hello/"
        );
        assert_eq!(json["notices"].as_array().unwrap().len(), 1, "{json}");
        assert_eq!(json["notices"][0]["code"], "no-launch-day");
        let error = run(dir.path(), "hello", with_kit).unwrap_err();
        assert!(
            error.contains("refusing to write a launch kit into existing"),
            "{error}"
        );
    }

    #[test]
    fn a_missing_or_escaping_image_blocks_and_is_not_copied() {
        let plan = PLAN
            .replace("launches/shots/two.png", "launches/shots/gone.png")
            .replace("launches/shots/thumb.png", "../thumb.png");
        let dir = launch_site(&plan);
        let mut with_kit = options("product-hunt");
        with_kit.kit = Some("kit".into());
        run(dir.path(), "hello", with_kit).unwrap();
        let kit = dir.path().join("kit");
        let json = fs::read_to_string(kit.join("kit.json")).unwrap();
        assert!(json.contains("\"image-missing\""), "{json}");
        assert!(json.contains("\"image-outside-project\""), "{json}");
        assert!(json.contains("\"submitUrl\": null"), "{json}");
        assert_eq!(fs::read_dir(kit.join("images")).unwrap().count(), 1);
    }

    #[test]
    fn a_confirmed_launch_is_not_prepared_again_without_again() {
        let dir = launch_site(PLAN);
        let confirm = |permalink: &str| {
            run(
                dir.path(),
                "hello",
                Options {
                    confirm: Some("product-hunt".into()),
                    permalink: Some(permalink.into()),
                    ..Options::default()
                },
            )
        };
        let error = confirm("https://www.producthunt.com/@ada").unwrap_err();
        assert!(error.contains("[invalid-permalink]"), "{error}");
        confirm("https://www.producthunt.com/posts/field-notes").unwrap();
        let mut again = options("product-hunt");
        again.kit = Some("kit".into());
        run(dir.path(), "hello", again.clone()).unwrap();
        let json = fs::read_to_string(dir.path().join("kit/kit.json")).unwrap();
        assert!(json.contains("\"already-launched\""), "{json}");
        again.kit = Some("kit-2".into());
        again.again = true;
        run(dir.path(), "hello", again).unwrap();
        let json = fs::read_to_string(dir.path().join("kit-2/kit.json")).unwrap();
        assert!(json.contains("\"relaunch\""), "{json}");
        assert!(
            json.contains("https://www.producthunt.com/posts/new"),
            "{json}"
        );
    }
}

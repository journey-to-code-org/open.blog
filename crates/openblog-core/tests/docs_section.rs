//! The documentation section (ADR 0405).
//!
//! The invariants: a site that does not turn `docs.enabled` on builds exactly as before even with a
//! `content/docs/` folder; with it on, every file under `docs/` is a page at an address that follows
//! its path, with a sidebar and previous and next links in reading order, and its links to other
//! files under `docs/` work on the site.

use std::collections::BTreeMap;

use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::json;

fn config(enabled: bool) -> SiteConfig {
    let mut value = json!({"title": "Docs", "url": "https://example.com"});
    if enabled {
        value["docs"] = json!({"enabled": true, "title": "Handbook"});
    }
    SiteConfig::from_json(&value.to_string()).unwrap()
}

fn file(path: &str, contents: &str) -> SourceFile {
    SourceFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn sources(docs: Vec<SourceFile>) -> Sources {
    Sources {
        posts: vec![file(
            "posts/one.md",
            "---\ntitle: One\ndate: 2026-10-01\n---\nBody. See [the deploy guide](../docs/guides/deploy.md#netlify) and [two](two.md).\n",
        )],
        pages: vec![file(
            "pages/about.md",
            "---\ntitle: About\n---\nAbout. [Install](../docs/install.md), [nowhere](../docs/nope.md).\n",
        )],
        docs,
        ..Default::default()
    }
}

fn handbook() -> Vec<SourceFile> {
    vec![
        file("docs/index.md", "---\ntitle: Welcome\n---\nStart with [installing](install.md).\n"),
        file(
            "docs/install.md",
            "---\ntitle: Installing\norder: 1\n---\nThen read the [deploy guide](guides/deploy.md#netlify) or [the guides](guides/).\n",
        ),
        file(
            "docs/guides/index.md",
            "---\ntitle: Guides\norder: 2\n---\nBack to [the start](../index.md).\n",
        ),
        file(
            "docs/guides/deploy.md",
            "---\ntitle: Deploying your site\nnavTitle: Deploying\norder: 2\n---\n## Netlify\n\nText.\n",
        ),
        file("docs/guides/backups.md", "---\ntitle: Backups\norder: 1\n---\nSee [nothing](gone.md).\n"),
        file("docs/reference/config.md", "---\ntitle: Config\n---\nKeys.\n"),
        file("docs/notes.md", "---\ntitle: Notes\ndraft: true\n---\nNot yet.\n"),
        file("docs/reference/README.md", "# Reference\n\nEvery key.\n"),
    ]
}

fn build(config: SiteConfig, docs: Vec<SourceFile>) -> (Site, BTreeMap<String, String>) {
    let site = Site::load(config, sources(docs), LoadOptions::default()).expect("site");
    let files = generate(&site, &ThemeSet::new())
        .expect("generated")
        .into_iter()
        .map(|file| (file.path, file.contents))
        .collect();
    (site, files)
}

#[test]
fn a_site_without_docs_enabled_builds_exactly_as_before_and_says_why() {
    let (_, plain) = build(config(false), Vec::new());
    let (site, with_folder) = build(config(false), handbook());
    assert_eq!(plain, with_folder);
    assert!(!with_folder.keys().any(|path| path.starts_with("docs/")));
    assert!(
        site.warnings
            .iter()
            .any(|w| w.contains("content/docs/") && w.contains("docs")),
        "{:?}",
        site.warnings
    );
}

#[test]
fn every_file_is_a_page_at_the_address_its_path_gives() {
    let (_, files) = build(config(true), handbook());
    for path in [
        "docs/index.html",
        "docs/install/index.html",
        "docs/guides/index.html",
        "docs/guides/deploy/index.html",
        "docs/guides/backups/index.html",
        "docs/reference/config/index.html",
    ] {
        assert!(files.contains_key(path), "missing {path}");
    }
    assert!(
        !files.contains_key("docs/notes/index.html"),
        "a draft is not published"
    );
    assert!(files.contains_key("about/index.html"));
}

#[test]
fn links_between_markdown_files_point_at_the_pages_and_a_broken_one_is_reported() {
    let (site, files) = build(config(true), handbook());
    let install = &files["docs/install/index.html"];
    assert!(
        install.contains("href=\"/docs/guides/deploy/#netlify\""),
        "{install}"
    );
    assert!(install.contains("href=\"/docs/guides/\""));
    assert!(files["docs/guides/index.html"].contains("href=\"/docs/\">the start"));
    assert!(files["docs/index.html"].contains("href=\"/docs/install/\">installing"));
    assert!(site
        .warnings
        .iter()
        .any(|w| w.contains("docs/guides/backups.md") && w.contains("gone.md")));
}

#[test]
fn the_sidebar_lists_the_tree_and_opens_only_the_folder_the_reader_is_in() {
    let (_, files) = build(config(true), handbook());
    let deploy = &files["docs/guides/deploy/index.html"];
    assert!(deploy.contains("<nav aria-label=\"Handbook\">"), "{deploy}");
    assert!(deploy.contains("<a href=\"/docs/guides/deploy/\" aria-current=\"page\">Deploying</a>"));
    // Order: Installing (1) before Guides (2); in Guides, Backups (1) before Deploying (2).
    let installing = deploy.find(">Installing<").unwrap();
    let guides = deploy.find(">Guides<").unwrap();
    let backups = deploy.find(">Backups<").unwrap();
    let deploying = deploy.find(">Deploying<").unwrap();
    assert!(installing < guides && guides < backups && backups < deploying);
    // A folder's README is its page, as on GitHub.
    assert!(
        deploy.contains("<a href=\"/docs/reference/\">Reference</a>"),
        "{deploy}"
    );
    // Folders the reader is not in are not expanded.
    // (The backups page, whose pager does not lead into reference/.)
    assert!(!files["docs/guides/backups/index.html"].contains("/docs/reference/config/"));
    let install = &files["docs/install/index.html"];
    assert!(!install.contains("/docs/guides/backups/"));
}

#[test]
fn previous_and_next_follow_reading_order() {
    let (_, files) = build(config(true), handbook());
    let order = [
        "docs/index.html",
        "docs/install/index.html",
        "docs/guides/index.html",
        "docs/guides/backups/index.html",
        "docs/guides/deploy/index.html",
        "docs/reference/index.html",
        "docs/reference/config/index.html",
    ];
    for pair in order.windows(2) {
        let next_url = format!("/{}", pair[1].trim_end_matches("index.html"));
        let previous_url = format!("/{}", pair[0].trim_end_matches("index.html"));
        assert!(
            files[pair[0]].contains(&format!("href=\"{next_url}\" rel=\"next\"")),
            "{} should lead to {next_url}",
            pair[0]
        );
        assert!(
            files[pair[1]].contains(&format!("href=\"{previous_url}\" rel=\"prev\"")),
            "{} should lead back to {previous_url}",
            pair[1]
        );
    }
    assert!(!files["docs/index.html"].contains("rel=\"prev\""));
    assert!(!files["docs/reference/config/index.html"].contains("rel=\"next\""));
}

#[test]
fn a_page_or_post_cannot_take_the_docs_address() {
    let mut sources = sources(handbook());
    sources
        .pages
        .push(file("pages/docs.md", "---\ntitle: Docs\n---\nx\n"));
    let Err(errors) = Site::load(config(true), sources, LoadOptions::default()) else {
        panic!("collision");
    };
    assert!(
        errors.iter().any(|e| e.contains("pages/docs.md")),
        "{errors:?}"
    );

    let mut sources = self::sources(handbook());
    sources.posts.push(file(
        "posts/two.md",
        "---\ntitle: Two\ndate: 2026-10-02\nslug: docs\n---\nx\n",
    ));
    let root_posts = SiteConfig::from_json(
        &json!({"title": "Docs", "url": "https://example.com", "postPath": "/{slug}/", "docs": {"enabled": true}})
            .to_string(),
    )
    .unwrap();
    let site = Site::load(root_posts, sources, LoadOptions::default()).expect("site");
    let Err(error) = generate(&site, &ThemeSet::new()) else {
        panic!("reserved");
    };
    assert!(error.contains("docs"), "{error}");
}

#[test]
fn posts_and_pages_link_into_the_documentation_by_file() {
    let (site, files) = build(config(true), handbook());
    let post = &files["posts/one/index.html"];
    assert!(
        post.contains("href=\"/docs/guides/deploy/#netlify\""),
        "{post}"
    );
    assert!(
        post.contains("href=\"two.md\""),
        "a link to another post is left alone"
    );
    let about = &files["about/index.html"];
    assert!(about.contains("href=\"/docs/install/\""));
    assert!(site
        .warnings
        .iter()
        .any(|w| w.contains("pages/about.md") && w.contains("nope.md")));
    assert!(!site.warnings.iter().any(|w| w.contains("two.md")));
}

#[test]
fn a_page_titled_by_its_first_heading_has_one_h1() {
    let (_, files) = build(config(true), handbook());
    let reference = &files["docs/reference/index.html"];
    assert_eq!(reference.matches("<h1").count(), 1, "{reference}");
    assert!(reference.contains("Every key."));
}

#[test]
fn two_files_for_one_address_is_an_error() {
    let mut docs = handbook();
    docs.push(file("docs/Install.md", "---\ntitle: Again\n---\nx\n"));
    let Err(errors) = Site::load(config(true), sources(docs), LoadOptions::default()) else {
        panic!("duplicate");
    };
    assert!(
        errors.iter().any(|e| e.contains("/docs/install/")),
        "{errors:?}"
    );
}

#[test]
fn with_docs_home_the_documentation_is_the_home_page_and_search_finds_it() {
    let home = SiteConfig::from_json(
        &json!({"title": "Docs", "url": "https://example.com", "docs": {"enabled": true, "home": true}})
            .to_string(),
    )
    .unwrap();
    let (site, files) = build(home, handbook());
    let index = &files["index.html"];
    assert!(
        index.contains("Start with"),
        "the docs index is the home page"
    );
    assert!(
        index.contains("<a href=\"/\" aria-current=\"page\">Welcome</a>"),
        "{index}"
    );
    assert!(!files.contains_key("page/2/index.html"));
    // /docs/ sends readers to the home page, and links to the index follow it.
    assert!(files["docs/index.html"].contains("url=/"));
    assert!(files["docs/guides/index.html"].contains("href=\"/\">the start"));
    // Posts keep their addresses.
    assert!(files.contains_key("posts/one/index.html"));
    assert!(
        site.warnings.iter().all(|w| !w.contains("home")),
        "{:?}",
        site.warnings
    );

    let search = &files["search.json"];
    assert!(
        search.contains("\"url\":\"/docs/guides/deploy/\""),
        "{search}"
    );
    assert!(search.contains("\"series\":\"Documentation\""));
    assert!(
        !search.contains("/about/"),
        "other pages are not indexed, as before"
    );

    let mut missing = handbook();
    missing.retain(|file| file.path != "docs/index.md");
    let home = SiteConfig::from_json(
        &json!({"title": "Docs", "url": "https://example.com", "docs": {"enabled": true, "home": true}})
            .to_string(),
    )
    .unwrap();
    let Err(errors) = Site::load(home, sources(missing), LoadOptions::default()) else {
        panic!("docs.home without an index");
    };
    assert!(errors.iter().any(|e| e.contains("docs.home")), "{errors:?}");
}

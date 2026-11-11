//! The services, recent jobs and reviews landing sections (ADR 0398).
//!
//! The invariants: each section renders nothing until the site has what it lists, so a fresh trade
//! starter builds a clean home page; once there is content it lists only published items, newest
//! first, at most `count`; and the home page never states `Review` data, which stays on `/reviews/`
//! and the job pages.

use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::json;

const CONFIG: &str = r#"{"title":"Crew","url":"https://crew.example","postPath":"/{slug}/"}"#;

fn file(path: &str, contents: &str) -> SourceFile {
    SourceFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn landing(count: Option<u32>) -> SourceFile {
    let mut jobs = json!({"id": "jobs", "type": "recent-jobs", "heading": "Recent jobs"});
    let mut said = json!({"id": "said", "type": "reviews", "heading": "What customers say"});
    if let Some(count) = count {
        jobs["count"] = json!(count);
        said["count"] = json!(count);
    }
    file(
        "content/landing.json",
        &json!({"format": "openblog-landing", "version": 3, "sections": [
            {"id": "hello", "type": "welcome", "heading": "Fences built to last"},
            {"id": "what", "type": "services", "heading": "What we do"},
            jobs,
            said
        ]})
        .to_string(),
    )
}

fn service(id: &str, draft: bool) -> SourceFile {
    let draft = if draft { "draft: true\n" } else { "" };
    file(
        &format!("services/{id}.md"),
        &format!("---\nversion: 1\nid: {id}\nname: Service {id}\nsummary: We do {id}.\npriceBand: ask\n{draft}---\n"),
    )
}

fn review(id: &str, date: &str) -> SourceFile {
    file(
        &format!("proof/{id}.md"),
        &format!(
            "---\nversion: 1\nid: {id}\nauthor: Dana R.\ndate: {date}\nplatform: google\nsourceUrl: https://g.page/r/crew/review/{id}\nrating: 5\n---\nWords of {id}.\n"
        ),
    )
}

fn job(name: &str, date: &str) -> SourceFile {
    file(
        &format!("posts/{name}.md"),
        &format!(
            "---\ntitle: Job {name}\ndate: {date}\nprofile: job\njob:\n  trade: landscaping\n  service: gates\n  place:\n    town: Bend\n    region: OR\n  started: {date}\n  finished: {date}\n---\nDone.\n"
        ),
    )
}

fn home(sources: Sources) -> String {
    let site = Site::load(
        SiteConfig::from_json(CONFIG).unwrap(),
        sources,
        LoadOptions::default(),
    )
    .expect("site");
    generate(&site, &ThemeSet::new())
        .expect("generated")
        .into_iter()
        .find(|f| f.path == "index.html")
        .expect("home page")
        .contents
}

#[test]
fn an_empty_trade_site_renders_none_of_the_three_sections() {
    let page = home(Sources {
        landing: Some(landing(None)),
        services: vec![service("draft-one", true)],
        ..Default::default()
    });
    assert!(page.contains("Fences built to last"));
    for absent in [
        "ob-home-services",
        "ob-home-recent-jobs",
        "ob-home-reviews",
        "All jobs",
        "All reviews",
        "All services",
    ] {
        assert!(!page.contains(absent), "{absent}");
    }
}

#[test]
fn the_sections_list_published_items_newest_first_up_to_their_count() {
    let page = home(Sources {
        landing: Some(landing(Some(2))),
        services: vec![service("gates", false), service("secret", true)],
        proof: vec![
            review("old", "2026-01-01"),
            review("mid", "2026-02-01"),
            review("new", "2026-03-01"),
        ],
        posts: vec![
            job("a", "2026-01-05"),
            job("b", "2026-02-05"),
            job("c", "2026-03-05"),
        ],
        ..Default::default()
    });
    // Services: published only, with a link to the whole list. The card titles sit under the
    // section's own <h2>, since the welcome banner holds the page's <h1>.
    assert!(page.contains(
        "<h3 class=\"ob-row-title\"><a href=\"/services/gates/\">Service gates</a></h3>"
    ));
    assert!(!page.contains("Service secret"));
    assert!(page.contains("href=\"/services/\">All services</a>"));
    // Jobs: the two newest, then a link to the archive.
    let c = page.find("Job c").expect("newest job");
    let b = page.find("Job b").expect("second job");
    assert!(c < b);
    assert!(!page.contains("Job a"));
    assert!(page.contains("href=\"/jobs/\">All jobs</a>"));
    // Reviews: the two newest, each with its source, and no structured data on the home page.
    assert!(page.find("Words of new.").unwrap() < page.find("Words of mid.").unwrap());
    assert!(!page.contains("Words of old."));
    assert!(page.contains("https://g.page/r/crew/review/new"));
    assert!(page.contains("href=\"/reviews/\">All reviews</a>"));
    assert!(!page.contains("\"@type\":\"Review\""));
    assert!(!page.contains("AggregateRating"));
    assert_eq!(page.matches("<h1").count(), 1);
}

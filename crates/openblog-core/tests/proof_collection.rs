//! Saved reviews (ADR 0389): the `proof/` collection, its checks, the job page and jobs archive that
//! show a linked review, the reviews page, and `Review` / `AggregateRating` data that is only stated
//! when the files say so.

use openblog_core::portability::PortableProjection;
use openblog_core::proof::{self, Platform, Provenance};
use openblog_core::{
    frontmatter, generate, LoadOptions, OutputFile, Site, SiteConfig, SourceFile, Sources, ThemeSet,
};
use serde_json::Value;

const CONFIG: &str = r#"{"title":"Crew","url":"https://crew.example","postPath":"/{slug}/"}"#;

fn file(path: &str, contents: &str) -> SourceFile {
    SourceFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn review(id: &str, date: &str, rating: Option<u8>) -> SourceFile {
    let stars = rating.map(|r| format!("rating: {r}\n")).unwrap_or_default();
    file(
        &format!("proof/{id}.md"),
        &format!(
            "---\nversion: 1\nid: {id}\nauthor: Dana R.\ndate: {date}\nplatform: google\nsourceUrl: https://g.page/r/crew/review/{id}\n{stars}provenance: snapshot\nretrievedAt: 2026-11-08T15:04:05Z\n---\nOn time and careful. <b>Great</b> floor.\n\nWould hire again.\n"
        ),
    )
}

fn job(name: &str, date: &str, review: Option<&str>) -> SourceFile {
    let link = review
        .map(|id| format!("  review: {id}\n"))
        .unwrap_or_default();
    file(
        &format!("posts/{name}.md"),
        &format!(
            "---\ntitle: {name}\ndate: {date}\nprofile: job\njob:\n  trade: flooring\n  service: hardwood-install\n  place:\n    town: Bend\n    region: OR\n  started: {date}\n  finished: {date}\n{link}---\nDone.\n"
        ),
    )
}

fn load_with(
    config: &str,
    proof: Vec<SourceFile>,
    posts: Vec<SourceFile>,
) -> Result<Site, Vec<String>> {
    Site::load(
        SiteConfig::from_json(config).unwrap(),
        Sources {
            proof,
            posts,
            ..Default::default()
        },
        LoadOptions::default(),
    )
}

fn load(proof: Vec<SourceFile>, posts: Vec<SourceFile>) -> Site {
    load_with(CONFIG, proof, posts).unwrap()
}

fn find<'a>(files: &'a [OutputFile], path: &str) -> Option<&'a str> {
    files
        .iter()
        .find(|file| file.path == path)
        .map(|file| file.contents.as_str())
}

fn ld(page: &str) -> Value {
    let marker = "application/ld+json\">";
    let start = page.find(marker).expect("structured data") + marker.len();
    let end = start + page[start..].find("</script>").unwrap();
    serde_json::from_str(&page[start..end]).expect("valid JSON")
}

fn problems(contents: &str) -> String {
    let doc = frontmatter::parse(contents).unwrap();
    proof::from_front_matter(&doc.front_matter)
        .expect_err("review should be refused")
        .join("; ")
}

const ENTERED: &str = "---\nid: r1\nauthor: Sam\ndate: 2026-10-01\nplatform: facebook\nsourceUrl: https://www.facebook.com/crew/reviews/1\n---\n";

#[test]
fn a_rating_outside_one_to_five_is_rejected() {
    for bad in ["0", "6", "4.5", "-1", "five", "10"] {
        let text = ENTERED.replace("platform:", &format!("rating: {bad}\nplatform:"));
        let error = problems(&text);
        assert!(error.contains("rating:"), "{bad}: {error}");
        assert!(error.contains("1 to 5"), "{bad}: {error}");
    }
    for good in 1..=5 {
        let text = ENTERED.replace("platform:", &format!("rating: {good}\nplatform:"));
        let doc = frontmatter::parse(&text).unwrap();
        assert_eq!(
            proof::from_front_matter(&doc.front_matter).unwrap().rating,
            Some(good)
        );
    }
}

#[test]
fn a_review_carries_its_source_and_how_it_came_in() {
    let doc = frontmatter::parse(ENTERED).unwrap();
    let entered = proof::from_front_matter(&doc.front_matter).unwrap();
    assert_eq!(entered.platform, Platform::Facebook);
    assert_eq!(entered.provenance, Provenance::Entered);
    assert_eq!(entered.rating, None);

    let site = load(vec![review("dana", "2026-10-20", Some(5))], Vec::new());
    let saved = &site.proof[0];
    assert_eq!(saved.author, "Dana R.");
    assert_eq!(saved.date, "2026-10-20");
    assert_eq!(saved.source_url, "https://g.page/r/crew/review/dana");
    assert_eq!(
        saved.provenance,
        Provenance::Snapshot {
            retrieved_at: "2026-11-08T15:04:05Z".into()
        }
    );
    assert_eq!(
        saved.text,
        "On time and careful. <b>Great</b> floor.\n\nWould hire again."
    );
}

#[test]
fn every_inconsistent_field_is_named() {
    let snapshot_without_time = ENTERED
        .replace("---\n---", "")
        .replace("platform:", "provenance: snapshot\nplatform:");
    assert!(problems(&snapshot_without_time).contains("retrievedAt:"));
    let time_without_snapshot =
        ENTERED.replace("platform:", "retrievedAt: 2026-11-01T00:00:00Z\nplatform:");
    assert!(problems(&time_without_snapshot).contains("retrievedAt:"));
    let wrong_host = ENTERED.replace("www.facebook.com", "google.example.com");
    assert!(problems(&wrong_host).contains("is not a Facebook address"));
    assert!(problems(&ENTERED.replace("facebook\n", "myspace\n")).contains("platform:"));
    assert!(problems(&ENTERED.replace(
        "https://www.facebook.com/crew/reviews/1",
        "javascript:alert(1)"
    ))
    .contains("sourceUrl:"));
    assert!(problems(&ENTERED.replace("https://", "https://user:pw@")).contains("sourceUrl:"));
    let after_copy = ENTERED.replace(
        "platform:",
        "provenance: snapshot\nretrievedAt: 2026-09-01T00:00:00Z\nplatform:",
    );
    assert!(problems(&after_copy).contains("after the day it was copied"));
    let all = problems("---\nid: bad id!\n---\n");
    for field in ["id:", "author:", "date:", "platform:", "sourceUrl:"] {
        assert!(all.contains(field), "{field} in {all}");
    }
    assert!(problems(&ENTERED.replace("id: r1", "id: r1\nversion: 2")).contains("version:"));
    // The words below the front matter are required.
    let error = load_with(CONFIG, vec![file("proof/r1.md", ENTERED)], Vec::new()).unwrap_err();
    assert!(
        error.join(" ").contains("text: add the review's words"),
        "{error:?}"
    );
}

#[test]
fn a_site_without_reviews_builds_as_before() {
    let posts = vec![job("oak-floor", "2026-10-16", None)];
    let site = load(Vec::new(), posts.clone());
    let files = generate(&site, &ThemeSet::new()).unwrap();
    assert!(find(&files, "reviews/index.html").is_none());
    let page = find(&files, "oak-floor/index.html").unwrap();
    assert!(
        !page.contains("ob-proof") && !page.contains("\"Review\"") && !page.contains("/reviews/")
    );
    // A Markdown file under proof/ that declares neither version nor id is not a review.
    let legacy = load(
        vec![file("proof/notes.md", "---\ntitle: Notes\n---\nHi")],
        posts,
    );
    assert!(legacy.proof.is_empty());
}

#[test]
fn a_job_shows_its_review_and_states_it_as_review_data() {
    let site = load(
        vec![
            review("dana", "2026-10-20", Some(4)),
            review("lee", "2026-10-01", None),
        ],
        vec![
            job("oak-floor", "2026-10-16", Some("dana")),
            job("deck", "2026-10-02", Some("lee")),
        ],
    );
    assert_eq!(site.proof[0].job.as_ref().unwrap().url, "/oak-floor/");
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let page = find(&files, "oak-floor/index.html").unwrap();
    assert!(page.contains("What the customer said"), "{page}");
    assert!(page.contains("aria-label=\"Rated 4 out of 5\""));
    assert!(
        page.contains("&lt;b&gt;Great&lt;/b&gt;"),
        "review words are text, never HTML"
    );
    assert!(page.contains(
        "href=\"https://g.page/r/crew/review/dana\" rel=\"nofollow noopener\">read it on Google"
    ));
    assert!(page.contains("Copied from the review's link on November 8, 2026."));
    let data = ld(page);
    let graph = data["@graph"].as_array().unwrap();
    assert_eq!(graph[0]["@type"], "BlogPosting");
    let node = &graph[1];
    assert_eq!(node["@type"], "Review");
    assert_eq!(node["author"]["name"], "Dana R.");
    assert_eq!(node["datePublished"], "2026-10-20");
    assert_eq!(node["reviewRating"]["ratingValue"], 4);
    assert_eq!(node["reviewRating"]["bestRating"], 5);
    assert_eq!(node["publisher"]["name"], "Google");
    assert_eq!(node["itemReviewed"]["name"], "Crew");
    // A review without stars is never given any.
    let deck = ld(find(&files, "deck/index.html").unwrap());
    let unrated = &deck["@graph"][1];
    assert_eq!(unrated["@type"], "Review");
    assert!(unrated.get("reviewRating").is_none(), "{unrated}");

    let archive = find(&files, "jobs/index.html").unwrap();
    assert!(archive.contains("ob-proof-line"), "{archive}");
    assert!(archive.contains("Review by Dana R. on Google"));
}

#[test]
fn the_reviews_page_lists_every_review_and_states_an_average_only_from_enough_stars() {
    let reviews = vec![
        review("a", "2026-10-03", Some(5)),
        review("b", "2026-10-02", Some(4)),
        review("c", "2026-10-01", None),
    ];
    let posts = vec![job("oak-floor", "2026-10-16", Some("a"))];
    let site = load(reviews.clone(), posts.clone());
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let page = find(&files, "reviews/index.html").unwrap();
    assert_eq!(page.matches("<figure class=\"ob-proof\"").count(), 3);
    assert!(page.find("id=\"review-a\"").unwrap() < page.find("id=\"review-c\"").unwrap());
    assert!(page.contains("About the job: <a href=\"/oak-floor/\">oak-floor</a>"));
    assert!(find(&files, "sitemap.xml")
        .unwrap()
        .contains("https://crew.example/reviews/"));
    assert!(find(&files, "index.html")
        .unwrap()
        .contains("href=\"/reviews/\""));
    let data = ld(page);
    assert_eq!(data["review"].as_array().unwrap().len(), 3);
    // Two rated reviews are below the default minimum of three: no average.
    assert!(data.get("aggregateRating").is_none(), "{data}");

    // With a lower minimum the two rated reviews are averaged; the unrated one is not counted.
    let site = load_with(
        r#"{"title":"Crew","url":"https://crew.example","postPath":"/{slug}/","reviews":{"aggregateMinimum":2}}"#,
        reviews,
        posts,
    )
    .unwrap();
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let data = ld(find(&files, "reviews/index.html").unwrap());
    let aggregate = &data["aggregateRating"];
    assert_eq!(aggregate["@type"], "AggregateRating");
    assert_eq!(aggregate["ratingValue"], 4.5);
    assert_eq!(aggregate["reviewCount"], 2);
    assert_eq!(aggregate["bestRating"], 5);
    assert_eq!(aggregate["worstRating"], 1);
}

#[test]
fn the_aggregate_minimum_is_checked_with_the_config() {
    assert!(SiteConfig::from_json(r#"{"reviews":{"aggregateMinimum":0}}"#).is_err());
    assert!(SiteConfig::from_json(r#"{"reviews":{"aggregateMinimun":2}}"#).is_err());
    let plain = SiteConfig::default();
    assert_eq!(
        plain.reviews.aggregate_minimum,
        proof::DEFAULT_AGGREGATE_MINIMUM
    );
    assert!(!plain.to_json().contains("reviews"));
}

#[test]
fn a_job_link_must_name_a_review_the_site_has_and_a_review_describes_one_job() {
    let unknown = load_with(
        CONFIG,
        vec![review("dana", "2026-10-20", Some(5))],
        vec![job("oak-floor", "2026-10-16", Some("nobody"))],
    )
    .unwrap_err()
    .join(" ");
    assert!(unknown.contains("job.review: `nobody` is not one of this site's saved reviews; known review ids are dana"), "{unknown}");

    let twice = load_with(
        CONFIG,
        vec![review("dana", "2026-10-20", Some(5))],
        vec![
            job("oak-floor", "2026-10-16", Some("dana")),
            job("deck", "2026-10-02", Some("dana")),
        ],
    )
    .unwrap_err()
    .join(" ");
    assert!(twice.contains("a review describes one job"), "{twice}");

    let duplicate = load_with(
        CONFIG,
        vec![
            review("dana", "2026-10-20", Some(5)),
            file(
                "proof/copy.md",
                &review("dana", "2026-10-20", None).contents,
            ),
        ],
        Vec::new(),
    )
    .unwrap_err()
    .join(" ");
    assert!(
        duplicate.contains("duplicate review id `dana`"),
        "{duplicate}"
    );

    // A site that has saved no reviews yet only hears about it: `job.review` used to link nothing.
    let none = load(
        Vec::new(),
        vec![job("oak-floor", "2026-10-16", Some("rev_01"))],
    );
    assert!(
        none.warnings
            .iter()
            .any(|w| w.contains("this site has none yet")),
        "{:?}",
        none.warnings
    );
}

#[test]
fn a_draft_review_is_not_published() {
    let draft = file(
        "proof/draft.md",
        "---\nid: draft\ndraft: true\nauthor: Sam\ndate: 2026-10-01\nplatform: other\nsourceUrl: https://example.org/r\nrating: 9\n---\nGood.\n",
    );
    let site = load(vec![draft], Vec::new());
    assert!(site.proof.is_empty());
    assert!(
        site.warnings
            .iter()
            .any(|w| w.contains("review not ready to publish")),
        "{:?}",
        site.warnings
    );
}

#[test]
fn a_jobs_export_carries_its_review() {
    let site = load(
        vec![review("dana", "2026-10-20", Some(5))],
        vec![job("oak-floor", "2026-10-16", Some("dana"))],
    );
    let post = &site.posts[0];
    let projection = PortableProjection::for_site(&site, post).unwrap();
    let markdown = projection.portable_markdown().unwrap();
    assert!(markdown.contains("## What the customer said"), "{markdown}");
    assert!(markdown.contains("> Would hire again."), "{markdown}");
    assert!(markdown.contains("Rated 5 out of 5. Dana R., October 20, 2026, [read it on Google](https://g.page/r/crew/review/dana)."), "{markdown}");
    let html = projection.portable_html().unwrap().html;
    assert!(html.contains("class=\"ob-proof\""), "{html}");
    let files = generate(&site, &ThemeSet::new()).unwrap();
    for feed in ["rss.xml", "feed.json"] {
        let text = find(&files, feed).unwrap_or_else(|| panic!("{feed} missing"));
        assert!(text.contains("What the customer said"), "{feed}");
    }
    // A projection built without the site has no review to carry.
    let bare = PortableProjection::from_post(post, &site.config).unwrap();
    assert!(!bare
        .portable_markdown()
        .unwrap()
        .contains("What the customer said"));
}

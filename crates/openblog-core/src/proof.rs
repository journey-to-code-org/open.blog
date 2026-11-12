//! The `proof/` collection: real reviews a customer left somewhere else,
//! saved with where they came from and shown beside the job they describe
//! (ADR 0389). Pure validation, markup and structured data; nothing here
//! reads a file, a clock or the network.
//!
//! A review is `proof/<id>.md`: flat front matter, then the review's own words
//! as plain text. A job links it by naming the id in `job.review`; the review
//! file names no job, so the two can never disagree. Keys this version does
//! not know stay in the file untouched.

use serde_json::{json, Map, Value as Json};
use url::Url;

use crate::escape::{attr, text};
use crate::frontmatter::FrontMatter;
use crate::model::Site;
use crate::DateTime;

/// The content folder reviews live in.
pub const PROOF_DIR: &str = "proof";
/// The address of the page that lists every review.
pub const REVIEWS_URL: &str = "/reviews/";
/// The first segment of that address, reserved once the site has reviews.
pub const REVIEWS_SEGMENT: &str = "reviews";
/// The only front matter version this release reads or writes.
pub const PROOF_VERSION: u64 = 1;

pub const MAX_ID: usize = 64;
pub const MAX_AUTHOR: usize = 80;
pub const MAX_TEXT: usize = 5000;
pub const MAX_URL: usize = 500;
/// The default for `reviews.aggregateMinimum`: fewer rated reviews than this
/// and no average is stated anywhere.
pub const DEFAULT_AGGREGATE_MINIMUM: u32 = 3;
pub const MAX_AGGREGATE_MINIMUM: u32 = 1000;

/// Where a review was left. A closed list: a named platform's link must be on
/// that platform's own site, and anything else is `other`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Google,
    Facebook,
    Nextdoor,
    Yelp,
    Houzz,
    Angi,
    Other,
}

impl Platform {
    pub const ALL: [Platform; 7] = [
        Self::Google,
        Self::Facebook,
        Self::Nextdoor,
        Self::Yelp,
        Self::Houzz,
        Self::Angi,
        Self::Other,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Facebook => "facebook",
            Self::Nextdoor => "nextdoor",
            Self::Yelp => "yelp",
            Self::Houzz => "houzz",
            Self::Angi => "angi",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim().to_ascii_lowercase();
        Self::ALL
            .into_iter()
            .find(|platform| platform.as_str() == value)
    }

    /// The name a page shows.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Google => "Google",
            Self::Facebook => "Facebook",
            Self::Nextdoor => "Nextdoor",
            Self::Yelp => "Yelp",
            Self::Houzz => "Houzz",
            Self::Angi => "Angi",
            Self::Other => "the original site",
        }
    }

    /// The brand names a named platform's own addresses carry (`google` in
    /// `www.google.com` or `google.co.uk`), and its short-link hosts.
    const fn hosts(self) -> (&'static [&'static str], &'static [&'static str]) {
        match self {
            Self::Google => (&["google"], &["g.page", "goo.gl"]),
            Self::Facebook => (&["facebook"], &["fb.com", "fb.me"]),
            Self::Nextdoor => (&["nextdoor"], &[]),
            Self::Yelp => (&["yelp"], &[]),
            Self::Houzz => (&["houzz"], &[]),
            Self::Angi => (&["angi", "angieslist"], &[]),
            Self::Other => (&[], &[]),
        }
    }

    /// Whether `host` is this platform's own site. `other` accepts any host.
    pub fn owns_host(self, host: &str) -> bool {
        if self == Self::Other {
            return true;
        }
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        let (brands, short) = self.hosts();
        if short
            .iter()
            .any(|known| host == *known || host.ends_with(&format!(".{known}")))
        {
            return true;
        }
        // `brand.tld`, `brand.co.uk`, `www.brand.com`: the brand followed only
        // by short top-level labels, so `google.example.com` is not Google.
        let labels: Vec<&str> = host.split('.').collect();
        labels.iter().enumerate().any(|(at, label)| {
            brands.contains(label)
                && at + 1 < labels.len()
                && labels[at + 1..]
                    .iter()
                    .all(|tld| (2..=3).contains(&tld.len()))
        })
    }
}

/// How a review came in: typed in by the owner, or copied from its link once,
/// at a stated time, through the Admin snapshot flow.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Provenance {
    Entered,
    Snapshot { retrieved_at: String },
}

impl Provenance {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Entered => "entered",
            Self::Snapshot { .. } => "snapshot",
        }
    }
}

/// What a review file's front matter says, checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofMetadata {
    pub id: String,
    pub author: String,
    /// `YYYY-MM-DD`
    pub date: String,
    pub platform: Platform,
    pub source_url: String,
    pub rating: Option<u8>,
    pub provenance: Provenance,
}

/// The job a review is linked to: the job names the review in `job.review`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkedJob {
    pub url: String,
    pub title: String,
}

/// One saved review, loaded.
#[derive(Clone, Debug)]
pub struct Proof {
    pub id: String,
    pub author: String,
    pub date: String,
    pub platform: Platform,
    pub source_url: String,
    pub rating: Option<u8>,
    pub provenance: Provenance,
    /// The review's words, as plain text with blank lines between paragraphs.
    pub text: String,
    /// Not published: only a load that includes drafts holds it.
    pub draft: bool,
    pub source: String,
    /// Set after the posts are loaded, from the one job that names it.
    pub job: Option<LinkedJob>,
}

/// Whether a file under `proof/` is a review at all: its front matter
/// declares `version` or `id`. Any other Markdown file there is left out of
/// the build, as it always was, so no existing site changes.
pub fn declares_proof(contents: &str) -> bool {
    crate::frontmatter::parse(contents).is_ok_and(|document| {
        let declared = |key: &str| {
            document
                .front_matter
                .get(key)
                .is_some_and(|value| !value.trim().is_empty())
        };
        declared("version") || declared("id")
    })
}

/// A review id: the same rule `job.review` has always used.
pub fn check_id(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= MAX_ID
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if valid {
        Ok(())
    } else {
        Err(format!(
            "id: `{value}` is not a review id; use letters, digits, `-` and `_`, up to {MAX_ID} characters"
        ))
    }
}

/// Read and validate a review's front matter. Every problem is a sentence
/// naming the field; all of them are returned, not only the first.
pub fn from_front_matter(fm: &FrontMatter) -> Result<ProofMetadata, Vec<String>> {
    let mut problems = Vec::new();
    let scalar = |key: &str| fm.get(key).map(str::trim).filter(|value| !value.is_empty());

    match scalar("version") {
        None => {}
        Some(value) if value.parse::<u64>() == Ok(PROOF_VERSION) => {}
        Some(value) => problems.push(format!(
            "version: `{value}` is not a version this release reads; use {PROOF_VERSION}, or update open.blog if the file came from a newer one"
        )),
    }

    let id = match scalar("id") {
        None => {
            problems.push(
                "id: add a short id for the review, such as `dana-oak-floor`; a job names it in `job.review`"
                    .into(),
            );
            String::new()
        }
        Some(value) => {
            if let Err(problem) = check_id(value) {
                problems.push(problem);
            }
            value.to_string()
        }
    };

    let author = match scalar("author") {
        None => {
            problems.push("author: add the name the reviewer shows, such as `Dana R.`".into());
            String::new()
        }
        Some(value) if !plain(value) || value.chars().count() > MAX_AUTHOR => {
            problems.push(format!(
                "author: use 1 to {MAX_AUTHOR} characters of plain text on one line"
            ));
            value.to_string()
        }
        Some(value) => value.to_string(),
    };

    let date = day(scalar("date"), "date", &mut problems);

    let platform = match scalar("platform") {
        None => {
            problems.push(format!(
                "platform: say where the review was left; use one of {}",
                platform_list()
            ));
            None
        }
        Some(value) => match Platform::parse(value) {
            Some(platform) => Some(platform),
            None => {
                problems.push(format!(
                    "platform: `{value}` is not a platform this release knows; use one of {}",
                    platform_list()
                ));
                None
            }
        },
    };

    let source_url = match scalar("sourceUrl") {
        None => {
            problems.push(
                "sourceUrl: add the link to the review where it was left, starting https://".into(),
            );
            String::new()
        }
        Some(value) => {
            match public_link(value) {
                Err(problem) => problems.push(problem),
                Ok(url) => {
                    if let Some(platform) = platform {
                        let host = url.host_str().unwrap_or("");
                        if !platform.owns_host(host) {
                            problems.push(format!(
                                "sourceUrl: `{host}` is not a {} address; use the review's link on {}, or set the platform to `other`",
                                platform.label(),
                                platform.label()
                            ));
                        }
                    }
                }
            }
            value.to_string()
        }
    };

    let rating = scalar("rating").and_then(|value| match value.parse::<u8>() {
        Ok(stars) if (1..=5).contains(&stars) => Some(stars),
        _ => {
            problems.push(format!(
                "rating: `{value}` is not a star rating; use a whole number from 1 to 5, or leave it out when the review has no stars"
            ));
            None
        }
    });

    let retrieved = scalar("retrievedAt");
    let provenance = match scalar("provenance").map(str::to_ascii_lowercase).as_deref() {
        None | Some("entered") => {
            if retrieved.is_some() {
                problems.push(
                    "retrievedAt: only a review copied from its link has a retrieval time; set `provenance: snapshot` or remove it"
                        .into(),
                );
            }
            Provenance::Entered
        }
        Some("snapshot") => match retrieved {
            None => {
                problems.push(
                    "retrievedAt: a review copied from its link needs the time it was copied, such as 2026-11-08T15:04:05Z"
                        .into(),
                );
                Provenance::Entered
            }
            Some(value) => match DateTime::parse(value).filter(|_| value.len() <= 64) {
                None => {
                    problems.push(format!(
                        "retrievedAt: `{value}` is not a time; write it as 2026-11-08T15:04:05Z"
                    ));
                    Provenance::Entered
                }
                Some(at) => {
                    if let Some((written, _)) = &date {
                        if written.ymd() > at.ymd() {
                            problems.push(
                                "date: a review cannot be written after the day it was copied"
                                    .into(),
                            );
                        }
                    }
                    Provenance::Snapshot {
                        retrieved_at: at.rfc3339(),
                    }
                }
            },
        },
        Some(other) => {
            problems.push(format!(
                "provenance: `{other}` is not how a review comes in; use `entered` (typed in) or `snapshot` (copied from its link)"
            ));
            Provenance::Entered
        }
    };

    if !problems.is_empty() {
        return Err(problems);
    }
    Ok(ProofMetadata {
        id,
        author,
        date: date.map(|(_, day)| day).unwrap_or_default(),
        platform: platform.unwrap_or(Platform::Other),
        source_url,
        rating,
        provenance,
    })
}

/// The review's own words: the file's body as plain text, with line endings
/// normalized and paragraphs kept. Never rendered as Markdown or HTML.
pub fn review_text(body: &str) -> Result<String, String> {
    let normalized = body.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err("text: add the review's words below the front matter".into());
    }
    if trimmed.chars().count() > MAX_TEXT {
        return Err(format!(
            "text: a review can be at most {MAX_TEXT} characters"
        ));
    }
    if trimmed
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err("text: use plain text only".into());
    }
    Ok(trimmed.to_string())
}

fn platform_list() -> String {
    Platform::ALL.map(Platform::as_str).join(", ")
}

fn plain(value: &str) -> bool {
    !value.trim().is_empty() && !value.chars().any(char::is_control)
}

fn day(value: Option<&str>, field: &str, problems: &mut Vec<String>) -> Option<(DateTime, String)> {
    let Some(value) = value else {
        problems.push(format!(
            "{field}: add the day the review was written, such as 2026-10-21"
        ));
        return None;
    };
    match (value.len() == 10)
        .then(|| DateTime::parse(value))
        .flatten()
    {
        Some(date) => Some((date, date.ymd())),
        None => {
            problems.push(format!(
                "{field}: `{value}` is not a date; write it as YYYY-MM-DD"
            ));
            None
        }
    }
}

/// A link a reader can follow: absolute http(s), a host, no credentials.
fn public_link(value: &str) -> Result<Url, String> {
    let refused = || {
        format!("sourceUrl: `{value}` is not a web address; use the review's full link, starting https://")
    };
    if value.len() > MAX_URL
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(refused());
    }
    let url = Url::parse(value).map_err(|_| refused())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none_or(str::is_empty)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(refused());
    }
    Ok(url)
}

/// The sentence a job gets when its `job.review` names no saved review, with
/// the known ids listed. `None` when the id is known.
pub fn unknown_review_problem(known: &[&str], review: &str) -> Option<String> {
    if known.contains(&review) {
        return None;
    }
    if known.is_empty() {
        return Some(format!(
            "job.review: `{review}` names a saved review, but this site has none yet; add one in Admin under Reviews, or remove the line"
        ));
    }
    Some(format!(
        "job.review: `{review}` is not one of this site's saved reviews; known review ids are {}",
        known.join(", ")
    ))
}

// ----- markup

fn long_day(day: &str) -> String {
    DateTime::parse(day)
        .map(DateTime::long)
        .unwrap_or_else(|| day.to_string())
}

/// Stars for a rating, read out as words.
pub(crate) fn rating_html(rating: u8) -> String {
    let filled = usize::from(rating.min(5));
    format!(
        "<span class=\"ob-proof-rating\" role=\"img\" aria-label=\"Rated {rating} out of 5\">{}{}</span>",
        "★".repeat(filled),
        "☆".repeat(5 - filled)
    )
}

fn paragraphs(words: &str) -> String {
    words
        .split("\n\n")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            let lines: Vec<String> = part.lines().map(|line| text(line.trim())).collect();
            format!("<p>{}</p>", lines.join("<br>"))
        })
        .collect::<Vec<_>>()
        .join("")
}

/// One review as a figure: the words, who wrote them and when, a link to
/// where they were left, and how they came in. `show_job` adds a link to the
/// job it describes (the reviews page); a job page already is that job.
pub(crate) fn figure_html(proof: &Proof, show_job: bool) -> String {
    let mut h = format!(
        "<figure class=\"ob-proof\" id=\"review-{}\">\n<blockquote class=\"ob-proof-text\" cite=\"{}\">{}</blockquote>\n<figcaption>\n<p class=\"ob-proof-source\">",
        attr(&proof.id),
        attr(&proof.source_url),
        paragraphs(&proof.text)
    );
    if let Some(rating) = proof.rating {
        h.push_str(&rating_html(rating));
        h.push(' ');
    }
    h.push_str(&format!(
        "<span class=\"ob-proof-author\">{}</span>, <time datetime=\"{}\">{}</time>, <a class=\"ob-proof-link\" href=\"{}\" rel=\"nofollow noopener\">read it on {}</a></p>\n",
        text(&proof.author),
        attr(&proof.date),
        text(&long_day(&proof.date)),
        attr(&proof.source_url),
        text(proof.platform.label())
    ));
    let how = match &proof.provenance {
        Provenance::Entered => "Typed in from the original review.".to_string(),
        Provenance::Snapshot { retrieved_at } => format!(
            "Copied from the review's link on {}.",
            text(
                &DateTime::parse(retrieved_at)
                    .map(DateTime::long)
                    .unwrap_or_default()
            )
        ),
    };
    h.push_str(&format!("<p class=\"ob-proof-provenance\">{how}</p>\n"));
    if show_job {
        if let Some(job) = &proof.job {
            h.push_str(&format!(
                "<p class=\"ob-proof-job\">About the job: <a href=\"{}\">{}</a></p>\n",
                attr(&job.url),
                text(&job.title)
            ));
        }
    }
    h.push_str("</figcaption>\n</figure>\n");
    h
}

/// The review beside its job on the job's own page.
pub(crate) fn job_section_html(proof: &Proof) -> String {
    format!(
        "<section class=\"ob-proof-section\" aria-labelledby=\"ob-proof-title\">\n<h2 id=\"ob-proof-title\">What the customer said</h2>\n{}</section>\n",
        figure_html(proof, false)
    )
}

/// The review as a portable Markdown section: the same facts the page shows.
pub(crate) fn markdown_section(proof: &Proof) -> String {
    use crate::portability::{markdown_destination, markdown_text};
    let mut out = String::from("## What the customer said\n\n");
    for paragraph in proof
        .text
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        let lines: Vec<String> = paragraph
            .lines()
            .map(|line| markdown_text(line.trim()))
            .collect();
        out.push_str(&format!("> {}\n>\n", lines.join("  \n> ")));
    }
    if out.ends_with(">\n") {
        out.truncate(out.len() - 2);
    }
    let stars = proof
        .rating
        .map(|rating| format!("Rated {rating} out of 5. "))
        .unwrap_or_default();
    out.push_str(&format!(
        "\n{stars}{}, {}, [read it on {}]({}).\n",
        markdown_text(&proof.author),
        long_day(&proof.date),
        markdown_text(proof.platform.label()),
        markdown_destination(&proof.source_url)
    ));
    out.push_str(&match &proof.provenance {
        Provenance::Entered => "Typed in from the original review.\n\n".to_string(),
        Provenance::Snapshot { retrieved_at } => format!(
            "Copied from the review's link on {}.\n\n",
            DateTime::parse(retrieved_at)
                .map(DateTime::long)
                .unwrap_or_default()
        ),
    });
    out
}

/// The short line a jobs archive adds to a job that has a review. It sits
/// inside the job's link, so it is phrasing content only.
pub(crate) fn line_html(proof: &Proof) -> String {
    let stars = proof
        .rating
        .map(|rating| format!("{} ", rating_html(rating)))
        .unwrap_or_default();
    format!(
        "<span class=\"ob-proof-line\">{stars}Review by {} on {}</span>",
        text(&proof.author),
        text(proof.platform.label())
    )
}

// ----- structured data

/// The business a review is about: the site's `LocalBusiness` node by its id
/// when the business facts say anything (ADR 0306), else the site by name.
pub(crate) fn business_reference(site: &Site) -> Json {
    let c = &site.config;
    if c.business.has_public_facts() {
        let name = if c.business.name().is_empty() {
            c.title.as_str()
        } else {
            c.business.name()
        };
        json!({ "@type": c.business.schema_type(), "@id": c.absolute("/#business"), "name": name })
    } else {
        json!({ "@type": "Organization", "name": c.title })
    }
}

/// A `Review` node for one saved review, built only from what the file says.
/// A review without stars has no `reviewRating`; nothing is ever filled in.
/// `item_reviewed` is false inside a business node's own `review` list.
pub fn review_node(site: &Site, proof: &Proof, item_reviewed: bool) -> Json {
    let c = &site.config;
    let mut node = Map::new();
    node.insert("@type".into(), "Review".into());
    node.insert(
        "@id".into(),
        format!("{}#review-{}", c.absolute(REVIEWS_URL), proof.id).into(),
    );
    node.insert(
        "author".into(),
        json!({ "@type": "Person", "name": proof.author }),
    );
    node.insert("datePublished".into(), proof.date.clone().into());
    node.insert("reviewBody".into(), proof.text.clone().into());
    node.insert("url".into(), proof.source_url.clone().into());
    if proof.platform != Platform::Other {
        node.insert(
            "publisher".into(),
            json!({ "@type": "Organization", "name": proof.platform.label() }),
        );
    }
    if let Some(rating) = proof.rating {
        node.insert(
            "reviewRating".into(),
            json!({ "@type": "Rating", "ratingValue": rating, "bestRating": 5, "worstRating": 1 }),
        );
    }
    if item_reviewed {
        node.insert("itemReviewed".into(), business_reference(site));
    }
    Json::Object(node)
}

/// The average of the reviews that have stars, only when at least
/// `reviews.aggregateMinimum` of them do. Reviews without stars are not
/// counted and never given any.
pub fn aggregate_rating(site: &Site) -> Option<Json> {
    let stars: Vec<u32> = site
        .proof
        .iter()
        .filter_map(|proof| proof.rating.map(u32::from))
        .collect();
    let minimum = site.config.reviews.aggregate_minimum.max(1) as usize;
    if stars.is_empty() || stars.len() < minimum {
        return None;
    }
    let mean = f64::from(stars.iter().sum::<u32>()) / stars.len() as f64;
    let value = (mean * 10.0).round() / 10.0;
    Some(json!({
        "@type": "AggregateRating",
        "ratingValue": value,
        "reviewCount": stars.len(),
        "bestRating": 5,
        "worstRating": 1,
    }))
}

/// The reviews page's structured data: the business, every review of it,
/// and its average when there are enough rated reviews. The caller escapes
/// it for a `<script>`.
pub fn reviews_json_ld(site: &Site) -> String {
    let mut business = business_reference(site);
    if let Some(object) = business.as_object_mut() {
        if let Some(aggregate) = aggregate_rating(site) {
            object.insert("aggregateRating".into(), aggregate);
        }
        object.insert(
            "review".into(),
            Json::Array(
                site.proof
                    .iter()
                    .map(|proof| review_node(site, proof, false))
                    .collect(),
            ),
        );
    }
    let mut graph = business;
    if let Some(object) = graph.as_object_mut() {
        object.insert("@context".into(), "https://schema.org".into());
    }
    graph.to_string()
}

/// The configurable part of reviews: `reviews` in `openblog.json`.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ReviewsConfig {
    /// The fewest rated reviews that state an average (`AggregateRating`).
    pub aggregate_minimum: u32,
}

impl Default for ReviewsConfig {
    fn default() -> Self {
        Self {
            aggregate_minimum: DEFAULT_AGGREGATE_MINIMUM,
        }
    }
}

impl ReviewsConfig {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    pub fn check(&self) -> Result<(), String> {
        if (1..=MAX_AGGREGATE_MINIMUM).contains(&self.aggregate_minimum) {
            Ok(())
        } else {
            Err(format!(
                "reviews.aggregateMinimum must be a whole number from 1 to {MAX_AGGREGATE_MINIMUM}"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_hosts_are_the_platforms_own() {
        assert!(Platform::Google.owns_host("www.google.com"));
        assert!(Platform::Google.owns_host("google.co.uk"));
        assert!(Platform::Google.owns_host("maps.app.goo.gl"));
        assert!(Platform::Google.owns_host("g.page"));
        assert!(!Platform::Google.owns_host("google.example.com"));
        assert!(!Platform::Google.owns_host("notgoogle.com"));
        assert!(Platform::Facebook.owns_host("m.facebook.com"));
        assert!(!Platform::Yelp.owns_host("facebook.com"));
        assert!(Platform::Other.owns_host("example.org"));
    }

    #[test]
    fn review_text_keeps_paragraphs_and_refuses_control_characters() {
        assert_eq!(
            review_text("\r\nGreat.\r\n\r\nOn time.\r\n").unwrap(),
            "Great.\n\nOn time."
        );
        assert!(review_text("  \n").is_err());
        assert!(review_text("bad\u{7}").is_err());
        assert!(review_text(&"x".repeat(MAX_TEXT + 1)).is_err());
    }

    #[test]
    fn paragraphs_are_escaped_text() {
        assert_eq!(
            paragraphs("<b>hi</b>\nthere\n\nnext"),
            "<p>&lt;b&gt;hi&lt;/b&gt;<br>there</p><p>next</p>"
        );
    }
}

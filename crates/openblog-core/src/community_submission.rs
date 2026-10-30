//! Guided community submissions (epic #384, story #395, ADRs 0800 to 0803).
//!
//! A **submission kit** prepares, for one published post, what the author needs to submit it by
//! hand to a community: the title and the exact canonical link, the community's rules as a
//! checklist, every reason the submission should not go ahead, and a link to the community's own
//! submit form. open.blog never submits: the community destinations' manifests say "by hand"
//! (ADR 0800), and nothing here touches the network, reads a credential or writes a file.
//!
//! Errors and notices are fixed text, apart from the limits and names they state; they never
//! repeat the author's title.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use crate::escape;
use crate::provider_manifest::{
    builtin_manifest, Capability, DistributionRequest, Ineligibility, ProviderId,
};

/// The kit format this release writes.
pub const KIT_VERSION: u32 = 1;
/// The longest Hacker News title, in characters. HN's submit form refuses a longer one; the limit
/// is not in HN's written guidelines (ADR 0801).
pub const HN_TITLE_MAX_CHARS: usize = 80;
/// The most destinations one kit prepares.
pub const MAX_DESTINATIONS: usize = 6;

const HN_GUIDELINES: &str = "https://news.ycombinator.com/newsguidelines.html";
const HN_FAQ: &str = "https://news.ycombinator.com/newsfaq.html";

/// Guided community submissions in `openblog.json`. Every destination is off by default, and the
/// object is omitted from the written file while it has its defaults, so a site that never sets
/// it is unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct CommunityConfig {
    pub hacker_news: HackerNewsConfig,
    /// Private record of the submissions the author confirmed, relative to the project root.
    pub state_file: String,
}

impl Default for CommunityConfig {
    fn default() -> Self {
        Self {
            hacker_news: HackerNewsConfig::default(),
            state_file: ".openblog/community-submissions.json".into(),
        }
    }
}

impl CommunityConfig {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// Whether the author opted in to preparing submissions for this provider.
    pub fn enabled(&self, provider: ProviderId) -> bool {
        match provider {
            ProviderId::HackerNews => self.hacker_news.enabled,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct HackerNewsConfig {
    pub enabled: bool,
}

/// Why a submission could not be prepared at all. Every message is fixed text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubmissionError {
    NoDestination,
    UnknownDestination,
    TooManyDestinations,
    Disabled(ProviderId),
}

impl SubmissionError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NoDestination => "no-destination",
            Self::UnknownDestination => "unknown-destination",
            Self::TooManyDestinations => "too-many-destinations",
            Self::Disabled(_) => "destination-disabled",
        }
    }
}

impl std::fmt::Display for SubmissionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoDestination => f.write_str(
                "Name where to submit with --to, such as --to hacker-news.",
            ),
            Self::UnknownDestination => f.write_str(
                "A destination is not one open.blog prepares submissions for; use hacker-news.",
            ),
            Self::TooManyDestinations => write!(
                f,
                "One kit prepares at most {MAX_DESTINATIONS} destinations."
            ),
            Self::Disabled(ProviderId::HackerNews) => f.write_str(
                "Hacker News submissions are off. Set community.hackerNews.enabled to true in openblog.json to prepare them.",
            ),
            Self::Disabled(_) => f.write_str("Submissions to this destination are off."),
        }
    }
}

impl std::error::Error for SubmissionError {}

/// Where the author may submit by hand.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Destination {
    HackerNews,
}

impl Destination {
    /// Reads one destination name, such as `hacker-news`.
    pub fn parse(value: &str) -> Result<Self, SubmissionError> {
        match value.trim() {
            "hacker-news" => Ok(Self::HackerNews),
            _ => Err(SubmissionError::UnknownDestination),
        }
    }

    /// Reads a comma-separated list, once each, in the order given.
    pub fn parse_list(value: &str) -> Result<Vec<Self>, SubmissionError> {
        let mut list: Vec<Self> = Vec::new();
        for name in value.split(',').map(str::trim).filter(|n| !n.is_empty()) {
            let destination = Self::parse(name)?;
            if !list.contains(&destination) {
                list.push(destination);
            }
        }
        if list.is_empty() {
            return Err(SubmissionError::NoDestination);
        }
        if list.len() > MAX_DESTINATIONS {
            return Err(SubmissionError::TooManyDestinations);
        }
        Ok(list)
    }

    /// The stable key a confirmed submission is recorded under.
    pub fn key(&self) -> String {
        match self {
            Self::HackerNews => "hacker-news".into(),
        }
    }

    pub fn provider(&self) -> ProviderId {
        match self {
            Self::HackerNews => ProviderId::HackerNews,
        }
    }

    /// How the destination is named to the author.
    pub fn label(&self) -> String {
        match self {
            Self::HackerNews => "Hacker News".into(),
        }
    }
}

/// Something the author should know before submitting. A blocking notice means the kit offers no
/// submit link for that destination.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Notice {
    pub code: &'static str,
    pub message: String,
    pub blocking: bool,
}

impl Notice {
    fn blocking(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            blocking: true,
        }
    }

    fn advice(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            blocking: false,
        }
    }
}

/// One item of a destination's checklist.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub text: String,
    /// The provider's page the rule comes from, or none for a rule the author wrote down.
    pub source: Option<String>,
}

fn provider_rule(text: &str, source: &str) -> Rule {
    Rule {
        text: text.to_string(),
        source: Some(source.to_string()),
    }
}

/// What the author needs to submit to one destination by hand.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationKit {
    pub destination: String,
    pub provider: ProviderId,
    pub label: String,
    pub title: String,
    /// Exactly the canonical address, never shortened or tagged.
    pub link: String,
    /// The provider's own submit form, filled in where it accepts that. None while blocked.
    pub submit_url: Option<String>,
    pub rules: Vec<Rule>,
    pub notices: Vec<Notice>,
    pub policy_version: String,
}

impl DestinationKit {
    pub fn ready(&self) -> bool {
        !self.notices.iter().any(|notice| notice.blocking)
    }
}

/// The post a kit is for, and the author's choices for this run.
#[derive(Clone, Debug)]
pub struct KitRequest<'a> {
    pub slug: &'a str,
    pub post_title: &'a str,
    /// The author's own title for this run, in place of the post's.
    pub title: Option<&'a str>,
    pub canonical_url: &'a str,
    pub site_title: &'a str,
}

/// Every destination's kit for one post.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionKit {
    pub kit_version: u32,
    pub slug: String,
    pub post_title: String,
    pub canonical_url: String,
    pub destinations: Vec<DestinationKit>,
}

impl SubmissionKit {
    pub fn to_json_value(&self) -> Json {
        serde_json::to_value(self).unwrap_or(Json::Null)
    }
}

/// Collapses runs of whitespace and trims, so a title reads as one line.
pub fn normalize_title(title: &str) -> String {
    title.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Prepares every destination's kit. Pure: the caller has checked that each destination is
/// enabled.
pub fn prepare(request: &KitRequest<'_>, destinations: &[Destination]) -> SubmissionKit {
    let kits = destinations
        .iter()
        .map(|destination| prepare_one(request, destination))
        .collect();
    SubmissionKit {
        kit_version: KIT_VERSION,
        slug: request.slug.to_string(),
        post_title: request.post_title.to_string(),
        canonical_url: request.canonical_url.to_string(),
        destinations: kits,
    }
}

fn prepare_one(request: &KitRequest<'_>, destination: &Destination) -> DestinationKit {
    let provider = destination.provider();
    let manifest = builtin_manifest(provider);
    let raw_title = request.title.unwrap_or(request.post_title);
    let title = normalize_title(raw_title);
    let mut notices = Vec::new();
    // The manifest must say exactly "the author submits the link by hand"; anything else fails
    // closed (ADRs 0326, 0800).
    let guided = manifest.check(&DistributionRequest::new([Capability::Link]))
        == [Ineligibility::ManualOnly(Capability::Link)];
    if !guided {
        notices.push(Notice::blocking(
            "manifest-not-guided",
            format!(
                "The {} manifest no longer says the author submits by hand, so nothing is prepared.",
                manifest.label
            ),
        ));
    }
    if title
        .chars()
        .any(|c| c.is_control() || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}'))
    {
        notices.push(Notice::blocking(
            "title-invalid",
            "The title has invisible or control characters; write it again in plain text.",
        ));
    }
    let (rules, submit_url) = match destination {
        Destination::HackerNews => {
            notices.extend(hn_title_notices(
                &title,
                &normalize_title(request.post_title),
                request.site_title,
            ));
            (
                hn_rules(),
                format!(
                    "https://news.ycombinator.com/submitlink?u={}&t={}",
                    escape::url_component(request.canonical_url),
                    escape::url_component(&title)
                ),
            )
        }
    };
    let mut kit = DestinationKit {
        destination: destination.key(),
        provider,
        label: destination.label(),
        title,
        link: request.canonical_url.to_string(),
        submit_url: None,
        rules,
        notices,
        policy_version: manifest.policy_version,
    };
    if kit.ready() {
        kit.submit_url = Some(submit_url);
    }
    kit
}

/// What HN's guidelines say about a title, as notices. Only an empty or over-long title blocks;
/// the rest is advice the author weighs.
pub fn hn_title_notices(title: &str, post_title: &str, site_title: &str) -> Vec<Notice> {
    let mut notices = Vec::new();
    let chars = title.chars().count();
    if chars == 0 {
        notices.push(Notice::blocking("title-empty", "The title is empty."));
        return notices;
    }
    if chars > HN_TITLE_MAX_CHARS {
        notices.push(Notice::blocking(
            "title-too-long",
            format!(
                "Hacker News takes a title of at most {HN_TITLE_MAX_CHARS} characters; this one has {chars}. Shorten it with --title."
            ),
        ));
    }
    if title != post_title {
        notices.push(Notice::advice(
            "title-edited",
            "This is not the post's own title. Hacker News asks for the original title unless it is misleading or linkbait.",
        ));
    }
    if title.contains('!') || shouts(title) {
        notices.push(Notice::advice(
            "title-emphasis",
            "Hacker News asks that titles not stand out with capitals or exclamation points.",
        ));
    }
    if gratuitous_number(title) {
        notices.push(Notice::advice(
            "title-number",
            "Hacker News asks to drop a gratuitous number, such as \"10 ways to\", unless it is meaningful.",
        ));
    }
    let site = site_title.trim().to_lowercase();
    if site.chars().count() >= 3 && title.to_lowercase().contains(&site) {
        notices.push(Notice::advice(
            "title-site-name",
            "The title includes the site's name; Hacker News asks to take it out.",
        ));
    }
    notices
}

// Two or more fully capitalised words of four or more letters.
fn shouts(title: &str) -> bool {
    title
        .split(|c: char| !c.is_alphabetic())
        .filter(|word| word.chars().count() >= 4 && word.chars().all(char::is_uppercase))
        .count()
        >= 2
}

// A leading count followed by a word, such as "10 Ways" or "7 things".
fn gratuitous_number(title: &str) -> bool {
    let mut words = title.split_whitespace();
    match (words.next(), words.next()) {
        (Some(first), Some(second)) => {
            first.chars().all(|c| c.is_ascii_digit())
                && first.len() <= 3
                && second.chars().next().is_some_and(char::is_alphabetic)
        }
        _ => false,
    }
}

fn hn_rules() -> Vec<Rule> {
    vec![
        provider_rule(
            "Use the original title, unless it is misleading or linkbait, and don't editorialize.",
            HN_GUIDELINES,
        ),
        provider_rule(
            "Leave out capitals for emphasis, exclamation points, gratuitous numbers and the site's name.",
            HN_GUIDELINES,
        ),
        provider_rule(
            "Don't ask anyone to upvote, comment on or submit it.",
            HN_FAQ,
        ),
        provider_rule(
            "Post your own work only part of the time; Hacker News is not mainly for promotion.",
            HN_GUIDELINES,
        ),
        provider_rule(
            "Don't delete and repost. Repost only if it had no significant attention in the last year or so.",
            HN_FAQ,
        ),
    ]
}

/// The kit as plain text for the terminal.
pub fn kit_text(kit: &SubmissionKit) -> String {
    let mut out = format!(
        "Submission kit for `{}` ({}). Nothing was submitted; open.blog never submits for you.\n",
        kit.slug, kit.canonical_url
    );
    for d in &kit.destinations {
        out.push_str(&format!(
            "\n{} [{}]\n  title: {}\n  link:  {}\n",
            d.label,
            if d.ready() {
                "ready to submit by hand"
            } else {
                "blocked"
            },
            d.title,
            d.link
        ));
        for notice in &d.notices {
            out.push_str(&format!(
                "  {} [{}] {}\n",
                if notice.blocking {
                    "blocked:"
                } else {
                    "advice: "
                },
                notice.code,
                notice.message
            ));
        }
        out.push_str("  before you submit:\n");
        for rule in &d.rules {
            out.push_str(&format!("  - [ ] {}\n", rule.text));
        }
        match &d.submit_url {
            Some(url) => out.push_str(&format!(
                "  open the form, check it, and submit it yourself: {url}\n"
            )),
            None => out.push_str("  no submit link while it is blocked\n"),
        }
    }
    out
}

/// The kit page: a static, script-free HTML document, like the distribution preview (ADR 0330).
pub fn kit_page(kit: &SubmissionKit) -> String {
    let t = escape::text;
    let a = escape::attr;
    let mut out = String::new();
    out.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"referrer\" content=\"no-referrer\">\n");
    out.push_str(&format!(
        "<title>Submission kit: {}</title>\n",
        t(&kit.post_title)
    ));
    out.push_str(crate::distribution::PAGE_STYLE);
    out.push_str(KIT_STYLE);
    out.push_str("</head>\n<body>\n<main>\n");
    out.push_str(&format!(
        "<h1>Submission kit: {}</h1>\n",
        t(&kit.post_title)
    ));
    out.push_str("<p class=\"notice\"><strong>Prepared, not submitted.</strong> open.blog submits nothing and never will. You open each community's own form, check it, and submit it yourself, or not at all.</p>\n");
    out.push_str(&format!(
        "<dl>\n<dt>Canonical address</dt><dd><a href=\"{}\">{}</a></dd>\n</dl>\n",
        a(&kit.canonical_url),
        t(&kit.canonical_url)
    ));
    for (index, d) in kit.destinations.iter().enumerate() {
        let id = format!("destination-{}", index + 1);
        out.push_str(&format!(
            "<section aria-labelledby=\"{id}\">\n<h2 id=\"{id}\">{}</h2>\n",
            t(&d.label)
        ));
        out.push_str(&format!(
            "<p><strong>Status:</strong> {}</p>\n",
            if d.ready() {
                "Ready for you to submit by hand."
            } else {
                "Blocked: there is no submit link until this is fixed."
            }
        ));
        let (blocking, advice): (Vec<&Notice>, Vec<&Notice>) =
            d.notices.iter().partition(|notice| notice.blocking);
        for (list, heading, suffix) in [
            (&blocking, "Why it is blocked", "blocked"),
            (&advice, "Worth a second look", "advice"),
        ] {
            if list.is_empty() {
                continue;
            }
            out.push_str(&format!(
                "<h3 id=\"{id}-{suffix}\">{heading}</h3>\n<ul aria-labelledby=\"{id}-{suffix}\">\n"
            ));
            for notice in list {
                out.push_str(&format!(
                    "<li>{} <span class=\"code\">({})</span></li>\n",
                    t(&notice.message),
                    t(notice.code)
                ));
            }
            out.push_str("</ul>\n");
        }
        out.push_str(&format!(
            "<h3>Title</h3>\n<pre tabindex=\"0\" aria-label=\"Title for {}\">{}</pre>\n",
            a(&d.label),
            t(&d.title)
        ));
        out.push_str(&format!(
            "<h3>Link</h3>\n<pre tabindex=\"0\" aria-label=\"Link for {}\">{}</pre>\n",
            a(&d.label),
            t(&d.link)
        ));
        out.push_str(&format!(
            "<fieldset>\n<legend>Before you submit to {}</legend>\n<ul class=\"checklist\">\n",
            t(&d.label)
        ));
        for (rule_index, rule) in d.rules.iter().enumerate() {
            let rule_id = format!("{id}-rule-{}", rule_index + 1);
            let source = match &rule.source {
                Some(source) => format!(
                    " <a href=\"{}\" rel=\"noopener noreferrer\">(source)</a>",
                    a(source)
                ),
                None => " <span class=\"code\">(your note)</span>".to_string(),
            };
            out.push_str(&format!(
                "<li><input type=\"checkbox\" id=\"{rule_id}\"> <label for=\"{rule_id}\">{}</label>{source}</li>\n",
                t(&rule.text)
            ));
        }
        out.push_str("</ul>\n<p class=\"code\">The boxes are for you; they are not saved or sent.</p>\n</fieldset>\n");
        match &d.submit_url {
            Some(url) => out.push_str(&format!(
                "<p><a class=\"submit\" href=\"{}\" rel=\"noopener noreferrer\">Open the {} submit form</a> (you check it and submit it there yourself)</p>\n",
                a(url),
                t(&d.label)
            )),
            None => out.push_str("<p>No submit link while this destination is blocked.</p>\n"),
        }
        out.push_str(&format!(
            "<p class=\"code\">Checked under the {} provider policy of {}.</p>\n</section>\n",
            t(&d.label),
            t(&d.policy_version)
        ));
    }
    out.push_str("</main>\n</body>\n</html>\n");
    out
}

const KIT_STYLE: &str = "<style>
fieldset{border:1px solid var(--line);margin:1rem 0;padding:.5rem .75rem}
legend{font-weight:600;padding:0 .25rem}
.checklist{list-style:none;padding:0;margin:0}
.checklist li{margin:.4rem 0;overflow-wrap:anywhere}
input[type=checkbox]{width:1.25rem;height:1.25rem;vertical-align:middle}
input:focus-visible{outline:3px solid var(--link);outline-offset:2px}
.submit{font-weight:600;overflow-wrap:anywhere}
</style>
";

/// The kit's data file, as written next to the page.
pub fn kit_json(kit: &SubmissionKit) -> String {
    let mut value = kit.to_json_value();
    value["about"] = json!(
        "Prepared by `openblog submit`; nothing was submitted. Each destination is submitted by hand by the author."
    );
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request<'a>(title: Option<&'a str>) -> KitRequest<'a> {
        KitRequest {
            slug: "a-post",
            post_title: "Why  borrow\tchecking helps",
            title,
            canonical_url: "https://blog.example.org/a-post/?x=1&y=<2>",
            site_title: "Field Notes",
        }
    }

    #[test]
    fn a_hacker_news_kit_carries_the_original_title_and_the_exact_link_and_never_submits() {
        let kit = prepare(&request(None), &[Destination::HackerNews]);
        let hn = &kit.destinations[0];
        assert_eq!(hn.title, "Why borrow checking helps");
        assert_eq!(hn.link, "https://blog.example.org/a-post/?x=1&y=<2>");
        assert!(hn.ready(), "{:?}", hn.notices);
        assert_eq!(
            hn.submit_url.as_deref(),
            Some("https://news.ycombinator.com/submitlink?u=https%3A%2F%2Fblog.example.org%2Fa-post%2F%3Fx%3D1%26y%3D%3C2%3E&t=Why%20borrow%20checking%20helps")
        );
        assert_eq!(hn.policy_version, "2026-10-29");
        assert!(hn.rules.len() >= 5);
        assert!(hn.rules.iter().all(|rule| rule.source.is_some()));
    }

    #[test]
    fn a_title_over_eighty_characters_blocks_and_withholds_the_submit_link() {
        let long = "x".repeat(81);
        let kit = prepare(&request(Some(&long)), &[Destination::HackerNews]);
        let hn = &kit.destinations[0];
        assert!(!hn.ready());
        assert!(hn.submit_url.is_none());
        let codes: Vec<_> = hn.notices.iter().map(|n| n.code).collect();
        assert_eq!(codes, ["title-too-long", "title-edited"]);
        let exact = "x".repeat(80);
        assert!(
            prepare(&request(Some(&exact)), &[Destination::HackerNews]).destinations[0].ready()
        );
    }

    #[test]
    fn the_guidelines_become_advice_that_does_not_block() {
        let codes = |title: &str| -> Vec<&'static str> {
            hn_title_notices(title, title, "Field Notes")
                .iter()
                .map(|n| n.code)
                .collect()
        };
        assert!(codes("A calm title about Rust").is_empty());
        assert_eq!(codes("This is AMAZING NEWS"), ["title-emphasis"]);
        assert_eq!(codes("Wow!"), ["title-emphasis"]);
        assert_eq!(codes("10 Ways to test"), ["title-number"]);
        assert!(codes("2026 in review").is_empty());
        assert_eq!(codes("Notes from Field Notes"), ["title-site-name"]);
        assert_eq!(codes(""), ["title-empty"]);
        assert!(hn_title_notices("Mine", "Theirs", "")
            .iter()
            .all(|n| !n.blocking));
    }

    #[test]
    fn invisible_characters_in_a_title_block() {
        let kit = prepare(
            &request(Some("Hidden\u{202E}text")),
            &[Destination::HackerNews],
        );
        assert!(kit.destinations[0]
            .notices
            .iter()
            .any(|n| n.code == "title-invalid" && n.blocking));
    }

    #[test]
    fn destinations_are_a_closed_list_read_once_each() {
        assert_eq!(
            Destination::parse_list("hacker-news, hacker-news").unwrap(),
            [Destination::HackerNews]
        );
        assert_eq!(
            Destination::parse_list(" , "),
            Err(SubmissionError::NoDestination)
        );
        assert_eq!(
            Destination::parse_list("hacker-news,lobsters"),
            Err(SubmissionError::UnknownDestination)
        );
        let config = CommunityConfig::default();
        assert!(config.is_default());
        assert!(!config.enabled(ProviderId::HackerNews));
        assert!(!config.enabled(ProviderId::Dev));
    }

    #[test]
    fn a_site_that_never_opts_in_writes_its_configuration_as_before() {
        let value = serde_json::to_value(crate::config::SiteConfig::default()).unwrap();
        assert!(value.get("community").is_none());
        let opted: crate::config::SiteConfig =
            serde_json::from_str(r#"{"community":{"hackerNews":{"enabled":true}}}"#).unwrap();
        assert!(opted.community.enabled(ProviderId::HackerNews));
        assert!(serde_json::from_str::<crate::config::SiteConfig>(
            r#"{"community":{"hackerNews":{"enabled":true,"autoSubmit":true}}}"#
        )
        .is_err());
    }

    #[test]
    fn the_page_is_static_escaped_and_labelled() {
        let mut request = request(Some("<script>alert(1)</script> & more"));
        request.post_title = "<b>Post</b>";
        let kit = prepare(&request, &[Destination::HackerNews]);
        let page = kit_page(&kit);
        assert!(!page.contains("<script>"));
        assert!(!page.contains("<b>Post</b>"));
        assert!(page.contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more"));
        assert!(page.contains("Prepared, not submitted."));
        assert!(page.contains("aria-label=\"Title for Hacker News\""));
        assert!(page.contains("<legend>Before you submit to Hacker News</legend>"));
        assert!(page.contains("Open the Hacker News submit form"));
        assert!(page.contains("rel=\"noopener noreferrer\""));
        let json: Json = serde_json::from_str(&kit_json(&kit)).unwrap();
        assert_eq!(json["kitVersion"], 1);
        assert_eq!(json["destinations"][0]["provider"], "hacker-news");
        assert!(kit_text(&kit).contains("open.blog never submits for you"));
    }
}

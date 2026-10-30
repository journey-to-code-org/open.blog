//! Guided community submissions (epic #384, stories #395 and #396, ADRs 0800 to 0807).
//!
//! A **submission kit** prepares, for one published post, what the author needs to submit it by
//! hand to a community: the title and the exact canonical link, the community's rules as a
//! checklist, every reason the submission should not go ahead, and a link to the community's own
//! submit form. open.blog never submits: the community destinations' manifests say "by hand"
//! (ADR 0800), and nothing here touches the network, reads a credential or writes a file.
//!
//! Errors and notices are fixed text, apart from the limits and names they state; they never
//! repeat the author's title.

use std::collections::BTreeMap;

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
/// The longest Reddit post title, in characters (Reddit's submit form).
pub const REDDIT_TITLE_MAX_CHARS: usize = 300;
/// The most destinations one kit prepares.
pub const MAX_DESTINATIONS: usize = 6;
/// The most rules the author can write down for one community, and the longest rule.
pub const MAX_COMMUNITY_RULES: usize = 30;
pub const MAX_RULE_CHARS: usize = 300;
/// How long a community's rules, as the author wrote them down, are taken as current.
pub const RULES_REVIEW_DAYS: i64 = 180;
/// HN accepts a repost only of a story without significant attention "in the last year or so".
pub const HN_REPOST_QUIET_DAYS: i64 = 365;
/// The record format this release reads and writes, and the largest record file read.
pub const RECORDS_VERSION: u32 = 1;
pub const MAX_RECORDS_BYTES: usize = 1024 * 1024;

const HN_GUIDELINES: &str = "https://news.ycombinator.com/newsguidelines.html";
const HN_FAQ: &str = "https://news.ycombinator.com/newsfaq.html";
const REDDIT_RULES: &str = "https://redditinc.com/policies/reddit-rules";
const REDDIT_SPAM: &str = "https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam";

/// Guided community submissions in `openblog.json`. Every destination is off by default, and the
/// object is omitted from the written file while it has its defaults, so a site that never sets
/// it is unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct CommunityConfig {
    pub hacker_news: HackerNewsConfig,
    pub reddit: RedditConfig,
    /// Product Hunt launch kits (ADR 0805).
    pub product_hunt: crate::launch_kit::ProductHuntConfig,
    /// Private record of the submissions the author confirmed, relative to the project root.
    pub state_file: String,
}

impl Default for CommunityConfig {
    fn default() -> Self {
        Self {
            hacker_news: HackerNewsConfig::default(),
            reddit: RedditConfig::default(),
            product_hunt: crate::launch_kit::ProductHuntConfig::default(),
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
            ProviderId::Reddit => self.reddit.enabled,
            ProviderId::ProductHunt => self.product_hunt.enabled,
            _ => false,
        }
    }

    /// The community the author wrote down, matched without regard to case as Reddit does.
    pub fn reddit_community(&self, name: &str) -> Option<(&str, &RedditCommunity)> {
        self.reddit
            .communities
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(key, community)| (key.as_str(), community))
    }

    /// Checks what the author wrote down. Only `openblog submit` calls it, so a mistake here never
    /// stops a build.
    pub fn validate(&self) -> Result<(), String> {
        self.product_hunt.validate()?;
        let mut seen: Vec<String> = Vec::new();
        for (name, community) in &self.reddit.communities {
            if !valid_community_name(name) {
                return Err(
                    "community.reddit.communities: a community name is 3 to 21 letters, digits or underscores, without r/"
                        .to_string(),
                );
            }
            let at = |problem: &str| format!("community.reddit.communities.{name}: {problem}");
            let lower = name.to_ascii_lowercase();
            if seen.contains(&lower) {
                return Err(at("this community is listed twice, in different case"));
            }
            seen.push(lower);
            if community.rules.is_empty() || community.rules.len() > MAX_COMMUNITY_RULES {
                return Err(at(&format!(
                    "write down 1 to {MAX_COMMUNITY_RULES} of the community's rules under `rules`, from its sidebar or rules page"
                )));
            }
            for rule in &community.rules {
                let chars = rule.trim().chars().count();
                if chars == 0 || chars > MAX_RULE_CHARS || rule.chars().any(char::is_control) {
                    return Err(at(&format!(
                        "each rule is one line of 1 to {MAX_RULE_CHARS} characters"
                    )));
                }
            }
            if !community.reviewed.is_empty() && review_date(&community.reviewed).is_none() {
                return Err(at(
                    "`reviewed` is the day you last read the rules, such as 2026-10-29",
                ));
            }
            if community.flair.chars().count() > 64 || community.flair.chars().any(char::is_control)
            {
                return Err(at("`flair` is one line of at most 64 characters"));
            }
        }
        Ok(())
    }
}

/// Reddit submissions: off by default, and only to communities whose rules the author wrote down.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct RedditConfig {
    pub enabled: bool,
    /// Keyed by the community's name, without `r/`.
    pub communities: BTreeMap<String, RedditCommunity>,
}

/// One community as the author wrote it down. open.blog never reads a community's rules from
/// Reddit; the author copies them, and the kit makes them a checklist (ADR 0802).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct RedditCommunity {
    pub rules: Vec<String>,
    /// The day the author last read the community's rules, `YYYY-MM-DD`.
    pub reviewed: String,
    /// The flair the community expects for a post like this, as a reminder.
    pub flair: String,
}

/// A community name as Reddit allows it: 3 to 21 letters, digits or underscores.
pub fn valid_community_name(name: &str) -> bool {
    (3..=21).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

// A plain `YYYY-MM-DD` day, as Unix seconds at its start.
fn review_date(value: &str) -> Option<i64> {
    if value.len() != 10 {
        return None;
    }
    crate::date::DateTime::parse(value).map(|date| date.unix())
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
    InvalidCommunity,
    Disabled(ProviderId),
    InvalidPermalink(ProviderId),
    AlreadyConfirmed,
    RecordsMalformed,
}

impl SubmissionError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NoDestination => "no-destination",
            Self::UnknownDestination => "unknown-destination",
            Self::TooManyDestinations => "too-many-destinations",
            Self::InvalidCommunity => "invalid-community",
            Self::Disabled(_) => "destination-disabled",
            Self::InvalidPermalink(_) => "invalid-permalink",
            Self::AlreadyConfirmed => "already-confirmed",
            Self::RecordsMalformed => "records-malformed",
        }
    }
}

impl std::fmt::Display for SubmissionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoDestination => f.write_str(
                "Name where to submit with --to, such as --to hacker-news or --to reddit:rust.",
            ),
            Self::UnknownDestination => f.write_str(
                "A destination is not one open.blog prepares submissions for; use hacker-news, reddit:<community> or product-hunt.",
            ),
            Self::TooManyDestinations => write!(
                f,
                "One kit prepares at most {MAX_DESTINATIONS} destinations."
            ),
            Self::InvalidCommunity => f.write_str(
                "A Reddit community name is 3 to 21 letters, digits or underscores, such as reddit:rust.",
            ),
            Self::Disabled(ProviderId::Reddit) => f.write_str(
                "Reddit submissions are off. Set community.reddit.enabled to true in openblog.json and write down each community's rules under community.reddit.communities to prepare them.",
            ),
            Self::Disabled(ProviderId::HackerNews) => f.write_str(
                "Hacker News submissions are off. Set community.hackerNews.enabled to true in openblog.json to prepare them.",
            ),
            Self::Disabled(ProviderId::ProductHunt) => f.write_str(
                "Product Hunt launch kits are off. Set community.productHunt.enabled to true in openblog.json and write the launch in launches/<slug>.json to prepare one.",
            ),
            Self::Disabled(_) => f.write_str("Submissions to this destination are off."),
            Self::InvalidPermalink(ProviderId::Reddit) => f.write_str(
                "The address must be your post in that community, such as https://www.reddit.com/r/rust/comments/abc123/; open.blog does not open it.",
            ),
            Self::InvalidPermalink(ProviderId::ProductHunt) => f.write_str(
                "The address must be your launch on Product Hunt, such as https://www.producthunt.com/posts/field-notes; open.blog does not open it.",
            ),
            Self::InvalidPermalink(_) => f.write_str(
                "The address must be your submission on Hacker News, such as https://news.ycombinator.com/item?id=123; open.blog does not open it.",
            ),
            Self::AlreadyConfirmed => f.write_str(
                "You already confirmed submitting this post there. Add --again only if you really submitted it a second time.",
            ),
            Self::RecordsMalformed => f.write_str(
                "The community submission record is not one this release reads; repair or move it.",
            ),
        }
    }
}

impl std::error::Error for SubmissionError {}

/// Where the author may submit by hand.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Destination {
    HackerNews,
    /// A Reddit community, by its name in lower case.
    Reddit(String),
    /// A Product Hunt launch, prepared on its own as a launch kit (ADR 0805).
    ProductHunt,
}

impl Destination {
    /// Reads one destination name: `hacker-news`, or `reddit:<community>` (`r/` is allowed).
    pub fn parse(value: &str) -> Result<Self, SubmissionError> {
        let value = value.trim();
        if value == "hacker-news" {
            return Ok(Self::HackerNews);
        }
        if value == "product-hunt" {
            return Ok(Self::ProductHunt);
        }
        let Some(community) = value.strip_prefix("reddit:") else {
            return Err(SubmissionError::UnknownDestination);
        };
        let community = community.strip_prefix("r/").unwrap_or(community);
        if !valid_community_name(community) {
            return Err(SubmissionError::InvalidCommunity);
        }
        Ok(Self::Reddit(community.to_ascii_lowercase()))
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
            Self::Reddit(community) => format!("reddit:{community}"),
            Self::ProductHunt => "product-hunt".into(),
        }
    }

    pub fn provider(&self) -> ProviderId {
        match self {
            Self::HackerNews => ProviderId::HackerNews,
            Self::Reddit(_) => ProviderId::Reddit,
            Self::ProductHunt => ProviderId::ProductHunt,
        }
    }

    /// How the destination is named to the author.
    pub fn label(&self) -> String {
        match self {
            Self::HackerNews => "Hacker News".into(),
            Self::Reddit(community) => format!("r/{community} on Reddit"),
            Self::ProductHunt => "Product Hunt".into(),
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
    pub(crate) fn blocking(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            blocking: true,
        }
    }

    pub(crate) fn advice(code: &'static str, message: impl Into<String>) -> Self {
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

pub(crate) fn provider_rule(text: &str, source: &str) -> Rule {
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
    /// Where the community's current rules are, to read before submitting.
    pub rules_url: Option<String>,
    pub rules: Vec<Rule>,
    pub notices: Vec<Notice>,
    pub policy_version: String,
    /// What the author confirmed submitting here before, newest last.
    pub confirmed: Vec<ConfirmedSubmission>,
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
    pub source_id: &'a str,
    pub post_title: &'a str,
    /// The author's own title for this run, in place of the post's.
    pub title: Option<&'a str>,
    pub canonical_url: &'a str,
    pub site_title: &'a str,
    pub config: &'a CommunityConfig,
    /// Every destination of this kit, so one can see the others.
    pub destinations: &'a [Destination],
    /// Now, as Unix seconds, to tell how long ago the author last read a community's rules.
    pub now_unix: i64,
    /// What the author confirmed submitting before, to keep a repeat submission from being prepared.
    pub records: &'a SubmissionRecords,
    /// The author says a repost to Hacker News is justified (only after a quiet year).
    pub again: bool,
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
pub fn prepare(request: &KitRequest<'_>) -> SubmissionKit {
    let kits = request
        .destinations
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
    let confirmed =
        request
            .records
            .confirmed_for(request.source_id, request.canonical_url, &destination.key());
    notices.extend(repeat_notices(destination, &confirmed, request));
    let mut rules_url = None;
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
        Destination::Reddit(community) => {
            let configured = request.config.reddit_community(community);
            let name = configured.map_or(community.as_str(), |(name, _)| name);
            rules_url = Some(format!("https://www.reddit.com/r/{name}/about/rules"));
            notices.extend(reddit_notices(
                &title,
                configured.map(|(_, c)| c),
                name,
                request.now_unix,
            ));
            let reddit_destinations = request
                .destinations
                .iter()
                .filter(|d| matches!(d, Destination::Reddit(_)))
                .count();
            if reddit_destinations > 1 {
                notices.push(Notice::advice(
                    "several-communities",
                    format!(
                        "This kit prepares the same link for {reddit_destinations} Reddit communities. Posting one link to many communities at once can count as spam; choose where you take part."
                    ),
                ));
            }
            (
                reddit_rules(name, configured.map(|(_, c)| c)),
                format!(
                    "https://www.reddit.com/r/{name}/submit?url={}&title={}",
                    escape::url_component(request.canonical_url),
                    escape::url_component(&title)
                ),
            )
        }
        // A launch is not a link and a title: it has its own kit (ADR 0805), so a submission
        // kit never offers Product Hunt's form.
        Destination::ProductHunt => {
            notices.push(Notice::blocking(
                "launch-kit-only",
                "Product Hunt is prepared on its own, as a launch kit: run openblog submit <slug> --to product-hunt alone.",
            ));
            (Vec::new(), String::new())
        }
    };
    let mut kit = DestinationKit {
        destination: destination.key(),
        provider,
        label: destination.label(),
        title,
        link: request.canonical_url.to_string(),
        submit_url: None,
        rules_url,
        rules,
        notices,
        policy_version: manifest.policy_version,
        confirmed,
    };
    if kit.ready() {
        kit.submit_url = Some(submit_url);
    }
    kit
}

// A repeat submission is never prepared silently: Reddit's never, HN's only after a quiet year and
// with --again (ADR 0803).
fn repeat_notices(
    destination: &Destination,
    confirmed: &[ConfirmedSubmission],
    request: &KitRequest<'_>,
) -> Vec<Notice> {
    let Some(last) = confirmed.last() else {
        return Vec::new();
    };
    let day = last.confirmed_at.get(..10).unwrap_or("an earlier day");
    let label = destination.label();
    match destination {
        Destination::HackerNews => {
            if request.now_unix - last.confirmed_at_unix < HN_REPOST_QUIET_DAYS * 86_400 {
                vec![Notice::blocking(
                    "already-submitted",
                    format!(
                        "You confirmed submitting this post to {label} on {day}. Hacker News buries a repost of a story from the last year, so do not submit it again."
                    ),
                )]
            } else if !request.again {
                vec![Notice::blocking(
                    "submitted-before",
                    format!(
                        "You confirmed submitting this post to {label} on {day}. Hacker News allows a few reposts of a story that had no significant attention; if that is so, prepare it again with --again."
                    ),
                )]
            } else {
                vec![Notice::advice(
                    "repost",
                    format!(
                        "This is a repost: you confirmed submitting this post to {label} on {day}. Do not repost it again if it gets attention."
                    ),
                )]
            }
        }
        Destination::ProductHunt => Vec::new(),
        Destination::Reddit(_) => vec![Notice::blocking(
            "already-submitted",
            format!(
                "You confirmed submitting this post to {label} on {day}. Posting it there again would be a repeat submission."
            ),
        )],
    }
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

/// Whether a Reddit submission can go ahead: the author must have written down the community's
/// rules, and the title must fit Reddit's form. A stale or undated copy of the rules is advice.
pub fn reddit_notices(
    title: &str,
    community: Option<&RedditCommunity>,
    name: &str,
    now_unix: i64,
) -> Vec<Notice> {
    let mut notices = Vec::new();
    let chars = title.chars().count();
    if chars == 0 {
        notices.push(Notice::blocking("title-empty", "The title is empty."));
    } else if chars > REDDIT_TITLE_MAX_CHARS {
        notices.push(Notice::blocking(
            "title-too-long",
            format!(
                "Reddit takes a title of at most {REDDIT_TITLE_MAX_CHARS} characters; this one has {chars}. Shorten it with --title."
            ),
        ));
    }
    let Some(community) = community else {
        notices.push(Notice::blocking(
            "community-rules-missing",
            format!(
                "Write down r/{name}'s rules under community.reddit.communities.{name}.rules in openblog.json first; open.blog does not read them from Reddit."
            ),
        ));
        return notices;
    };
    match review_date(&community.reviewed) {
        None => notices.push(Notice::advice(
            "rules-undated",
            format!(
                "You have not said when you last read r/{name}'s rules; read them again on Reddit and set `reviewed`."
            ),
        )),
        Some(reviewed) if now_unix - reviewed > RULES_REVIEW_DAYS * 86_400 => {
            notices.push(Notice::advice(
                "rules-stale",
                format!(
                    "You last read r/{name}'s rules more than {RULES_REVIEW_DAYS} days ago; moderators change them, so read them again."
                ),
            ))
        }
        Some(_) => {}
    }
    notices
}

fn reddit_rules(name: &str, community: Option<&RedditCommunity>) -> Vec<Rule> {
    let mut rules = vec![
        provider_rule(
            &format!("Follow r/{name}'s own rules, which its moderators set, including any limit on self-promotion."),
            REDDIT_RULES,
        ),
        provider_rule(
            "Post where you take part, not only to promote your own work.",
            REDDIT_RULES,
        ),
        provider_rule(
            "Don't ask for votes, and don't post the same link to many communities.",
            REDDIT_SPAM,
        ),
    ];
    if let Some(community) = community {
        for rule in &community.rules {
            rules.push(Rule {
                text: rule.trim().to_string(),
                source: None,
            });
        }
        let flair = community.flair.trim();
        if !flair.is_empty() {
            rules.push(Rule {
                text: format!("Choose the flair \"{flair}\"."),
                source: None,
            });
        }
    }
    rules
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

/// What a confirmed submission rests on. Only the author's word exists in this release: open.blog
/// never reads the provider to check it (ADR 0803).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Evidence {
    Author,
}

/// The state of a submission open.blog knows of. Only the author can confirm one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubmissionStatus {
    AuthorConfirmed,
}

/// One submission the author says they made, by hand.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmedSubmission {
    pub status: SubmissionStatus,
    pub evidence: Evidence,
    pub canonical_url: String,
    pub title: String,
    /// The author's submission at the provider, as they gave it; never opened by open.blog.
    pub permalink: Option<String>,
    pub confirmed_at: String,
    pub confirmed_at_unix: i64,
    /// The provider manifest's policy version when the author confirmed it.
    pub policy_version: String,
}

/// The private record of confirmed submissions: by source identity, then destination key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmissionRecords {
    pub records_version: u32,
    pub records: BTreeMap<String, BTreeMap<String, Vec<ConfirmedSubmission>>>,
}

impl Default for SubmissionRecords {
    fn default() -> Self {
        Self {
            records_version: RECORDS_VERSION,
            records: BTreeMap::new(),
        }
    }
}

impl SubmissionRecords {
    /// Reads the record, refusing it whole on anything unknown.
    pub fn from_json(text: &str) -> Result<Self, SubmissionError> {
        if text.len() > MAX_RECORDS_BYTES {
            return Err(SubmissionError::RecordsMalformed);
        }
        let records: Self =
            serde_json::from_str(text).map_err(|_| SubmissionError::RecordsMalformed)?;
        let keys_read = records
            .records
            .values()
            .flat_map(BTreeMap::keys)
            .all(|key| Destination::parse(key).is_ok_and(|d| d.key() == *key));
        if records.records_version != RECORDS_VERSION || !keys_read {
            return Err(SubmissionError::RecordsMalformed);
        }
        Ok(records)
    }

    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).unwrap_or_default();
        text.push('\n');
        text
    }

    /// Every confirmation for this destination of this post: under its source identity, or under
    /// another identity with the same canonical address. Oldest first.
    pub fn confirmed_for(
        &self,
        source_id: &str,
        canonical_url: &str,
        key: &str,
    ) -> Vec<ConfirmedSubmission> {
        let mut found: Vec<ConfirmedSubmission> = self
            .records
            .iter()
            .filter_map(|(source, destinations)| destinations.get(key).map(|list| (source, list)))
            .flat_map(|(source, list)| {
                list.iter()
                    .filter(move |c| source == source_id || c.canonical_url == canonical_url)
            })
            .cloned()
            .collect();
        found.sort_by_key(|c| c.confirmed_at_unix);
        found
    }

    /// Everything confirmed for one post, by destination key.
    pub fn for_source(
        &self,
        source_id: &str,
    ) -> Option<&BTreeMap<String, Vec<ConfirmedSubmission>>> {
        self.records.get(source_id)
    }
}

/// What the author says they submitted.
#[derive(Clone, Debug)]
pub struct Confirmation<'a> {
    pub source_id: &'a str,
    pub canonical_url: &'a str,
    pub title: &'a str,
    pub destination: &'a Destination,
    pub permalink: Option<&'a str>,
    pub now: crate::date::DateTime,
    /// The author says they submitted it a second time.
    pub again: bool,
}

/// Records the author's confirmation. It says only that the author confirmed it: nothing is
/// fetched, and a permalink is checked for shape alone.
pub fn confirm(
    records: &mut SubmissionRecords,
    confirmation: &Confirmation<'_>,
) -> Result<ConfirmedSubmission, SubmissionError> {
    let destination = confirmation.destination;
    let key = destination.key();
    let permalink = confirmation
        .permalink
        .map(|value| normalize_permalink(destination, value))
        .transpose()?;
    if !confirmation.again
        && !records
            .confirmed_for(confirmation.source_id, confirmation.canonical_url, &key)
            .is_empty()
    {
        return Err(SubmissionError::AlreadyConfirmed);
    }
    let entry = ConfirmedSubmission {
        status: SubmissionStatus::AuthorConfirmed,
        evidence: Evidence::Author,
        canonical_url: confirmation.canonical_url.to_string(),
        title: normalize_title(confirmation.title),
        permalink,
        confirmed_at: confirmation.now.rfc3339(),
        confirmed_at_unix: confirmation.now.unix(),
        policy_version: builtin_manifest(destination.provider()).policy_version,
    };
    records
        .records
        .entry(confirmation.source_id.to_string())
        .or_default()
        .entry(key)
        .or_default()
        .push(entry.clone());
    Ok(entry)
}

/// The author's submission address in one canonical spelling, or a refusal. Only the shape is
/// checked; the address is never opened.
pub fn normalize_permalink(
    destination: &Destination,
    value: &str,
) -> Result<String, SubmissionError> {
    let refused = SubmissionError::InvalidPermalink(destination.provider());
    let url = url::Url::parse(value.trim()).map_err(|_| refused)?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(refused);
    }
    let host = url.host_str().unwrap_or_default();
    match destination {
        Destination::HackerNews => {
            let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
            match (host, url.path(), pairs.as_slice()) {
                ("news.ycombinator.com", "/item", [(name, id)])
                    if name == "id"
                        && (1..=12).contains(&id.len())
                        && id.bytes().all(|b| b.is_ascii_digit()) =>
                {
                    Ok(format!("https://news.ycombinator.com/item?id={id}"))
                }
                _ => Err(refused),
            }
        }
        Destination::Reddit(community) => {
            if !matches!(
                host,
                "www.reddit.com" | "reddit.com" | "old.reddit.com" | "new.reddit.com"
            ) {
                return Err(refused);
            }
            let segments: Vec<&str> = url
                .path_segments()
                .map(Iterator::collect)
                .unwrap_or_default();
            match segments.as_slice() {
                ["r", name, "comments", id, ..]
                    if name.eq_ignore_ascii_case(community)
                        && (1..=12).contains(&id.len())
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) =>
                {
                    Ok(format!("https://www.reddit.com/r/{name}/comments/{id}/"))
                }
                _ => Err(refused),
            }
        }
        Destination::ProductHunt => {
            if !matches!(host, "www.producthunt.com" | "producthunt.com") {
                return Err(refused);
            }
            let segments: Vec<&str> = url
                .path_segments()
                .map(Iterator::collect)
                .unwrap_or_default();
            let slug_ok = |slug: &str| {
                (1..=80).contains(&slug.len())
                    && slug
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            };
            match segments.as_slice() {
                [kind @ ("posts" | "products"), slug]
                | [kind @ ("posts" | "products"), slug, ""]
                    if slug_ok(slug) =>
                {
                    Ok(format!("https://www.producthunt.com/{kind}/{slug}"))
                }
                ["products", slug, "launches", launch] if slug_ok(slug) && slug_ok(launch) => Ok(
                    format!("https://www.producthunt.com/products/{slug}/launches/{launch}"),
                ),
                _ => Err(refused),
            }
        }
    }
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
        if let Some(rules_url) = &d.rules_url {
            out.push_str(&format!("  read the current rules: {rules_url}\n"));
        }
        out.push_str("  before you submit:\n");
        for rule in &d.rules {
            out.push_str(&format!("  - [ ] {}\n", rule.text));
        }
        match &d.submit_url {
            Some(url) => out.push_str(&format!(
                "  open the form, check it, and submit it yourself: {url}\n  then record it: {}\n",
                confirm_command(&kit.slug, &d.destination)
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
        if let Some(rules_url) = &d.rules_url {
            out.push_str(&format!(
                "<p><a href=\"{}\" rel=\"noopener noreferrer\">Read the community's current rules on Reddit</a> before you tick them off below.</p>\n",
                a(rules_url)
            ));
        }
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
                "<p><a class=\"submit\" href=\"{}\" rel=\"noopener noreferrer\">Open the submit form for {}</a> (you check it and submit it there yourself)</p>\n",
                a(url),
                t(&d.label)
            )),
            None => out.push_str("<p>No submit link while this destination is blocked.</p>\n"),
        }
        if !d.confirmed.is_empty() {
            out.push_str("<h3>You confirmed submitting it here before</h3>\n<ul>\n");
            for c in &d.confirmed {
                out.push_str(&format!(
                    "<li>On {} (your word; open.blog did not check){}</li>\n",
                    t(c.confirmed_at.get(..10).unwrap_or("")),
                    c.permalink
                        .as_deref()
                        .map(|p| format!(
                            ": <a href=\"{}\" rel=\"noopener noreferrer\">{}</a>",
                            a(p),
                            t(p)
                        ))
                        .unwrap_or_default()
                ));
            }
            out.push_str("</ul>\n");
        }
        if d.ready() {
            out.push_str(&format!(
                "<h3>After you submit</h3>\n<p>open.blog cannot see whether you submitted. If you did, record it, with the address of your submission if you have it, so it is not prepared again:</p>\n<pre tabindex=\"0\" aria-label=\"Command that records your submission to {}\"><code>{}</code></pre>\n",
                a(&d.label),
                t(&confirm_command(&kit.slug, &d.destination))
            ));
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

/// The command that records the author's own confirmation of a submission.
pub fn confirm_command(slug: &str, destination: &str) -> String {
    format!(
        "openblog submit {slug} --confirm {destination} --permalink <address of your submission>"
    )
}

pub(crate) const KIT_STYLE: &str = "<style>
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

    const HN: &[Destination] = &[Destination::HackerNews];
    // 2026-10-29T00:00:00Z
    const NOW: i64 = 1_793_232_000;
    static NO_RECORDS: SubmissionRecords = SubmissionRecords {
        records_version: RECORDS_VERSION,
        records: BTreeMap::new(),
    };

    fn request<'a>(
        title: Option<&'a str>,
        destinations: &'a [Destination],
        config: &'a CommunityConfig,
    ) -> KitRequest<'a> {
        KitRequest {
            slug: "a-post",
            source_id: "source:content/posts/a-post.md",
            post_title: "Why  borrow\tchecking helps",
            title,
            canonical_url: "https://blog.example.org/a-post/?x=1&y=<2>",
            site_title: "Field Notes",
            config,
            destinations,
            now_unix: NOW,
            records: &NO_RECORDS,
            again: false,
        }
    }

    fn kit(
        title: Option<&str>,
        destinations: &[Destination],
        config: &CommunityConfig,
    ) -> SubmissionKit {
        prepare(&request(title, destinations, config))
    }

    #[test]
    fn a_hacker_news_kit_carries_the_original_title_and_the_exact_link_and_never_submits() {
        let kit = kit(None, HN, &CommunityConfig::default());
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
        let long_kit = kit(Some(&long), HN, &CommunityConfig::default());
        let hn = &long_kit.destinations[0];
        assert!(!hn.ready());
        assert!(hn.submit_url.is_none());
        let codes: Vec<_> = hn.notices.iter().map(|n| n.code).collect();
        assert_eq!(codes, ["title-too-long", "title-edited"]);
        let exact = "x".repeat(80);
        assert!(kit(Some(&exact), HN, &CommunityConfig::default()).destinations[0].ready());
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
        let kit = kit(Some("Hidden\u{202E}text"), HN, &CommunityConfig::default());
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

    fn reddit_config(reviewed: &str) -> CommunityConfig {
        serde_json::from_value(json!({
            "reddit": {
                "enabled": true,
                "communities": {
                    "Rust": {
                        "rules": ["Posts must be about the Rust language", "  No more than one self-promotion a week  "],
                        "reviewed": reviewed,
                        "flair": "blog post"
                    }
                }
            }
        }))
        .unwrap()
    }

    #[test]
    fn a_reddit_kit_turns_the_communitys_written_rules_into_a_checklist() {
        let config = reddit_config("2026-10-01");
        config.validate().unwrap();
        let destinations = [Destination::parse("reddit:r/rust").unwrap()];
        let kit = kit(None, &destinations, &config);
        let d = &kit.destinations[0];
        assert_eq!(d.destination, "reddit:rust");
        assert_eq!(d.label, "r/rust on Reddit");
        assert!(d.ready(), "{:?}", d.notices);
        assert!(d.notices.is_empty());
        // The author's spelling of the community is used in addresses.
        assert_eq!(
            d.rules_url.as_deref(),
            Some("https://www.reddit.com/r/Rust/about/rules")
        );
        assert_eq!(
            d.submit_url.as_deref(),
            Some("https://www.reddit.com/r/Rust/submit?url=https%3A%2F%2Fblog.example.org%2Fa-post%2F%3Fx%3D1%26y%3D%3C2%3E&title=Why%20borrow%20checking%20helps")
        );
        let texts: Vec<_> = d.rules.iter().map(|r| r.text.as_str()).collect();
        assert!(texts.contains(&"Posts must be about the Rust language"));
        assert!(texts.contains(&"No more than one self-promotion a week"));
        assert!(texts.contains(&"Choose the flair \"blog post\"."));
        assert_eq!(d.rules.iter().filter(|r| r.source.is_none()).count(), 3);
        assert_eq!(d.rules.iter().filter(|r| r.source.is_some()).count(), 3);
        let page = kit_page(&kit);
        assert!(page.contains("Read the community's current rules on Reddit"));
        assert!(page.contains("(your note)"));
    }

    #[test]
    fn a_community_without_written_rules_is_blocked_with_no_submit_link() {
        let config = reddit_config("2026-10-01");
        let destinations = [Destination::parse("reddit:programming").unwrap()];
        let d = &kit(None, &destinations, &config).destinations[0];
        assert!(!d.ready());
        assert!(d.submit_url.is_none());
        assert_eq!(d.notices[0].code, "community-rules-missing");
        // The three Reddit-wide rules are still shown, so the author knows what applies.
        assert_eq!(d.rules.len(), 3);
    }

    #[test]
    fn stale_or_undated_rules_and_several_communities_are_advice() {
        let codes = |config: &CommunityConfig, destinations: &[Destination]| -> Vec<&'static str> {
            kit(None, destinations, config).destinations[0]
                .notices
                .iter()
                .map(|n| n.code)
                .collect()
        };
        let rust = [Destination::Reddit("rust".into())];
        assert_eq!(codes(&reddit_config(""), &rust), ["rules-undated"]);
        assert_eq!(codes(&reddit_config("2026-01-01"), &rust), ["rules-stale"]);
        let two = [
            Destination::Reddit("rust".into()),
            Destination::Reddit("programming".into()),
        ];
        assert_eq!(
            codes(&reddit_config("2026-10-01"), &two),
            ["several-communities"]
        );
        let long = "y".repeat(301);
        let d = &kit(Some(&long), &rust, &reddit_config("2026-10-01")).destinations[0];
        assert_eq!(d.notices[0].code, "title-too-long");
        assert!(!d.ready());
        assert!(
            kit(Some(&"y".repeat(300)), &rust, &reddit_config("2026-10-01")).destinations[0]
                .ready()
        );
    }

    #[test]
    fn reddit_destinations_and_communities_are_checked() {
        assert_eq!(
            Destination::parse("reddit:Rust_Lang").unwrap(),
            Destination::Reddit("rust_lang".into())
        );
        for bad in [
            "reddit:",
            "reddit:ab",
            "reddit:a-b-c",
            "reddit:r/",
            "reddit:x/../y",
            "reddit:abcdefghijklmnopqrstuv",
        ] {
            assert_eq!(
                Destination::parse(bad),
                Err(SubmissionError::InvalidCommunity),
                "{bad}"
            );
        }
        assert_eq!(
            Destination::parse("reddit"),
            Err(SubmissionError::UnknownDestination)
        );
        let bad = |value: serde_json::Value| {
            serde_json::from_value::<CommunityConfig>(
                json!({"reddit": {"enabled": true, "communities": value}}),
            )
            .unwrap()
            .validate()
            .unwrap_err()
        };
        assert!(bad(json!({"r/rust": {"rules": ["x"]}})).contains("3 to 21"));
        assert!(bad(json!({"rust": {"rules": []}})).contains("1 to 30"));
        assert!(bad(json!({"rust": {"rules": ["a\nb"]}})).contains("one line"));
        assert!(
            bad(json!({"rust": {"rules": ["x"], "reviewed": "last week"}})).contains("reviewed")
        );
        assert!(bad(json!({"rust": {"rules": ["x"]}, "RUST": {"rules": ["y"]}})).contains("twice"));
        assert!(serde_json::from_value::<CommunityConfig>(
            json!({"reddit": {"enabled": true, "token": "x"}})
        )
        .is_err());
    }

    fn confirmation<'a>(
        destination: &'a Destination,
        permalink: Option<&'a str>,
        day: &str,
        again: bool,
    ) -> Confirmation<'a> {
        Confirmation {
            source_id: "source:content/posts/a-post.md",
            canonical_url: "https://blog.example.org/a-post/?x=1&y=<2>",
            title: "Why borrow checking helps",
            destination,
            permalink,
            now: crate::date::DateTime::parse(day).unwrap(),
            again,
        }
    }

    #[test]
    fn a_confirmation_is_the_authors_word_recorded_with_a_checked_permalink() {
        let mut records = SubmissionRecords::default();
        let hn = Destination::HackerNews;
        let entry = confirm(
            &mut records,
            &confirmation(
                &hn,
                Some(" https://news.ycombinator.com/item?id=4242 "),
                "2026-10-29",
                false,
            ),
        )
        .unwrap();
        assert_eq!(entry.status, SubmissionStatus::AuthorConfirmed);
        assert_eq!(entry.evidence, Evidence::Author);
        assert_eq!(
            entry.permalink.as_deref(),
            Some("https://news.ycombinator.com/item?id=4242")
        );
        assert_eq!(entry.confirmed_at, "2026-10-29T00:00:00Z");
        let text = records.to_json();
        assert!(text.contains("\"status\": \"author-confirmed\""));
        assert!(text.contains("\"evidence\": \"author\""));
        assert_eq!(SubmissionRecords::from_json(&text).unwrap(), records);
        // A second confirmation needs --again.
        assert_eq!(
            confirm(&mut records, &confirmation(&hn, None, "2026-10-30", false)),
            Err(SubmissionError::AlreadyConfirmed)
        );
        confirm(&mut records, &confirmation(&hn, None, "2026-10-30", true)).unwrap();
        assert_eq!(
            records
                .confirmed_for("source:content/posts/a-post.md", "-", "hacker-news")
                .len(),
            2
        );
        // The same canonical address under another source identity still counts.
        assert_eq!(
            records
                .confirmed_for(
                    "other",
                    "https://blog.example.org/a-post/?x=1&y=<2>",
                    "hacker-news"
                )
                .len(),
            2
        );
        assert!(records
            .confirmed_for("other", "https://elsewhere.example/", "hacker-news")
            .is_empty());
    }

    #[test]
    fn a_permalink_is_checked_for_shape_only_and_spelled_one_way() {
        let hn = Destination::HackerNews;
        let rust = Destination::Reddit("rust".into());
        assert_eq!(
            normalize_permalink(
                &rust,
                "https://old.reddit.com/r/Rust/comments/1abc2d/why_borrow/?utm=x#c"
            )
            .unwrap(),
            "https://www.reddit.com/r/Rust/comments/1abc2d/"
        );
        for bad in [
            "http://news.ycombinator.com/item?id=1",
            "https://news.ycombinator.com/item?id=1&x=2",
            "https://news.ycombinator.com/item?id=abc",
            "https://evil.example/item?id=1",
            "https://user:pw@news.ycombinator.com/item?id=1",
            "not a url",
        ] {
            assert_eq!(
                normalize_permalink(&hn, bad),
                Err(SubmissionError::InvalidPermalink(ProviderId::HackerNews)),
                "{bad}"
            );
        }
        for bad in [
            "https://www.reddit.com/r/golang/comments/1abc2d/",
            "https://www.reddit.com/r/rust/",
            "https://reddit.evil.example/r/rust/comments/1abc2d/",
            "https://www.reddit.com/r/rust/comments/ABC/",
        ] {
            assert!(normalize_permalink(&rust, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_confirmed_submission_is_not_prepared_again() {
        let mut records = SubmissionRecords::default();
        let hn = Destination::HackerNews;
        let rust = Destination::Reddit("rust".into());
        confirm(&mut records, &confirmation(&hn, None, "2026-06-01", false)).unwrap();
        confirm(
            &mut records,
            &confirmation(&rust, None, "2024-01-01", false),
        )
        .unwrap();
        let config = reddit_config("2026-10-01");
        let both = [hn.clone(), rust.clone()];
        let mut request = request(None, &both, &config);
        request.records = &records;
        let kit = prepare(&request);
        let codes = |d: &DestinationKit| d.notices.iter().map(|n| n.code).collect::<Vec<_>>();
        assert_eq!(codes(&kit.destinations[0]), ["already-submitted"]);
        assert!(kit.destinations[0].submit_url.is_none());
        assert_eq!(kit.destinations[0].confirmed.len(), 1);
        // Reddit: never again in the same community, however long ago.
        assert_eq!(codes(&kit.destinations[1]), ["already-submitted"]);
        assert!(kit_page(&kit).contains("You confirmed submitting it here before"));

        // HN after a quiet year: blocked until the author says --again, then advice.
        let mut old = SubmissionRecords::default();
        confirm(&mut old, &confirmation(&hn, None, "2025-06-01", false)).unwrap();
        request.records = &old;
        request.destinations = HN;
        assert_eq!(
            codes(&prepare(&request).destinations[0]),
            ["submitted-before"]
        );
        request.again = true;
        let again = prepare(&request);
        assert_eq!(codes(&again.destinations[0]), ["repost"]);
        assert!(again.destinations[0].ready());
    }

    #[test]
    fn a_record_of_another_shape_is_refused_whole() {
        for text in [
            "{}",
            r#"{"recordsVersion":2,"records":{}}"#,
            r#"{"recordsVersion":1,"records":{},"extra":1}"#,
            r#"{"recordsVersion":1,"records":{"s":{"lobsters":[]}}}"#,
            r#"{"recordsVersion":1,"records":{"s":{"reddit:Rust":[]}}}"#,
            r#"{"recordsVersion":1,"records":{"s":{"hacker-news":[{"status":"posted","evidence":"author","canonicalUrl":"u","title":"t","permalink":null,"confirmedAt":"x","confirmedAtUnix":1,"policyVersion":"p"}]}}}"#,
            r#"{"recordsVersion":1,"records":{"s":{"hacker-news":[{"status":"author-confirmed","evidence":"api","canonicalUrl":"u","title":"t","permalink":null,"confirmedAt":"x","confirmedAtUnix":1,"policyVersion":"p"}]}}}"#,
        ] {
            assert_eq!(
                SubmissionRecords::from_json(text),
                Err(SubmissionError::RecordsMalformed),
                "{text}"
            );
        }
    }

    #[test]
    fn the_page_is_static_escaped_and_labelled() {
        let config = CommunityConfig::default();
        let mut request = request(Some("<script>alert(1)</script> & more"), HN, &config);
        request.post_title = "<b>Post</b>";
        let kit = prepare(&request);
        let page = kit_page(&kit);
        assert!(!page.contains("<script>"));
        assert!(!page.contains("<b>Post</b>"));
        assert!(page.contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more"));
        assert!(page.contains("Prepared, not submitted."));
        assert!(page.contains("aria-label=\"Title for Hacker News\""));
        assert!(page.contains("<legend>Before you submit to Hacker News</legend>"));
        assert!(page.contains("Open the submit form for Hacker News"));
        assert!(page.contains("aria-label=\"Command that records your submission to Hacker News\""));
        assert!(page.contains("openblog submit a-post --confirm hacker-news --permalink"));
        assert!(page.contains("rel=\"noopener noreferrer\""));
        let json: Json = serde_json::from_str(&kit_json(&kit)).unwrap();
        assert_eq!(json["kitVersion"], 1);
        assert_eq!(json["destinations"][0]["provider"], "hacker-news");
        assert!(kit_text(&kit).contains("open.blog never submits for you"));
    }
}

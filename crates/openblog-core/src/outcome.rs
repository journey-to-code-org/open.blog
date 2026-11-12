//! Distribution outcomes and attribution (epic DIST8, #388; ADRs 0402 to 0404).
//!
//! Every adapter keeps its own private record of what it sent (cross-posting, Pinterest, community
//! submissions, job shares, YouTube, the hosted social queue). This module reads none of them: it
//! defines the one shape they are all normalized into, the rules that reconcile several records for
//! the same post and destination into one row, and the redaction every row passes through before it
//! is shown. Nothing here is stored: a report is worked out from the records each time.
//!
//! It also owns the bounded attribution vocabulary: which referring sites stand for which
//! destination, and which `utm_source` values a counter may count. Nothing outside that list is
//! ever counted as a destination, so a visitor's free text never becomes a stored key.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// What happened at a destination, in words the author would use.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// The provider answered that it is there (a post id, a Pin id, a published article).
    Delivered,
    /// The author says they posted it by hand; open.blog never checked.
    ByHand,
    /// A remote draft or a private upload exists; it is not public yet.
    Draft,
    /// Waiting: scheduled, queued, uploading, or a kit made for the author to post.
    Pending,
    /// A request was made and may have created it: a person settles it. Never counted as delivered.
    Unknown,
    /// Certainly not there: refused, failed before creating anything, or canceled.
    NotDelivered,
}

impl Status {
    /// A settled outcome, which a later unknown does not overrule.
    pub fn settled(self) -> bool {
        matches!(self, Self::Delivered | Self::ByHand | Self::NotDelivered)
    }
}

/// What a status rests on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Evidence {
    /// The provider's own answer to open.blog.
    Provider,
    /// The author's word, recorded in open.blog.
    Author,
    /// Nothing settles it yet.
    None,
}

/// One post at one destination, as an adapter's record says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// The post's source path, as the records name it (`posts/a.md`, `content/posts/a.md` or
    /// `source:content/posts/a.md`); see [`source_key`].
    pub source: String,
    /// A provider id from the manifests (`dev`, `pinterest`, `google-business-profile`, ...).
    pub destination: String,
    /// The destination as the author set it up, when one provider has several (a target name, a
    /// Reddit community, a Pinterest board). Shown, never used as a key across providers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    pub status: Status,
    pub evidence: Evidence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permalink: Option<String>,
    /// How many records or attempts stand behind this row.
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_attempt_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_update_at: Option<String>,
    /// A fixed short code for what went wrong, never provider text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

impl Outcome {
    /// A row with only the required parts; the rest is added by the adapter's reader.
    pub fn new(source: &str, destination: &str, status: Status, evidence: Evidence) -> Self {
        Self {
            source: source.to_string(),
            destination: destination.to_string(),
            place: None,
            status,
            evidence,
            remote_id: None,
            permalink: None,
            attempts: 1,
            first_attempt_at: None,
            last_update_at: None,
            problem: None,
        }
    }
}

/// The destinations a report knows, from the provider manifests (ADR 0325). A record naming any
/// other destination is left out of the report rather than guessed at.
pub const DESTINATIONS: [&str; 16] = [
    "dev",
    "hashnode",
    "ghost",
    "wordpress",
    "medium",
    "linkedin",
    "facebook",
    "bluesky",
    "mastodon",
    "pinterest",
    "youtube",
    "hacker-news",
    "reddit",
    "product-hunt",
    "google-business-profile",
    "nextdoor",
];

/// A source path reduced to the part every record agrees on: no `source:` prefix, forward slashes,
/// and no leading content folder, so `source:content/posts/a.md`, `content/posts/a.md` and
/// `posts/a.md` are the same post.
pub fn source_key(source: &str, content_dir: &str) -> String {
    let mut key = source.trim().replace('\\', "/");
    if let Some(rest) = key.strip_prefix("source:") {
        key = rest.to_string();
    }
    let key = key.trim_start_matches("./").trim_start_matches('/');
    let content = content_dir
        .trim()
        .trim_start_matches("./")
        .trim_matches('/');
    match key.strip_prefix(&format!("{content}/")) {
        Some(rest) if !content.is_empty() => rest.to_string(),
        _ => key.to_string(),
    }
}

fn clean_code(value: &str) -> Option<String> {
    let value = value.trim().trim_matches(|c| c == '[' || c == ']');
    let ok = !value.is_empty()
        && value.len() <= 40
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    Some(if ok {
        value.to_string()
    } else {
        "other".to_string()
    })
}

fn clean_id(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:/@".contains(&b)))
    .then(|| value.to_string())
}

/// An `http(s)` address without credentials, query or fragment: a permalink is shown and linked, so
/// nothing that could carry a token or a tracking value survives.
pub fn clean_permalink(value: &str) -> Option<String> {
    let value = value.trim();
    let rest = value
        .strip_prefix("https://")
        .map(|rest| ("https://", rest))
        .or_else(|| value.strip_prefix("http://").map(|rest| ("http://", rest)))?;
    let (scheme, rest) = rest;
    let end = rest.find(['?', '#']).unwrap_or(rest.len());
    let rest = &rest[..end];
    let host = rest.split('/').next().unwrap_or("");
    if host.is_empty()
        || host.contains('@')
        || rest.len() > 500
        || rest
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '<' || c == '>')
    {
        return None;
    }
    Some(format!("{scheme}{rest}"))
}

fn clean_time(value: &str) -> Option<String> {
    let value = value.trim();
    crate::DateTime::parse(value).map(|_| value.to_string())
}

/// The row as it may be shown: a known destination, short codes, clean ids and links, and real
/// timestamps. `None` when the destination is not one a report knows.
pub fn redact(mut outcome: Outcome) -> Option<Outcome> {
    if !DESTINATIONS.contains(&outcome.destination.as_str()) {
        return None;
    }
    outcome.place = outcome
        .place
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty() && p.chars().count() <= 80 && !p.chars().any(char::is_control))
        .map(str::to_string);
    outcome.remote_id = outcome.remote_id.as_deref().and_then(clean_id);
    outcome.permalink = outcome.permalink.as_deref().and_then(clean_permalink);
    outcome.problem = outcome.problem.as_deref().and_then(clean_code);
    outcome.first_attempt_at = outcome.first_attempt_at.as_deref().and_then(clean_time);
    outcome.last_update_at = outcome.last_update_at.as_deref().and_then(clean_time);
    outcome.attempts = outcome.attempts.clamp(1, 1000);
    Some(outcome)
}

fn later(a: &Option<String>, b: &Option<String>) -> bool {
    let at = |v: &Option<String>| v.as_deref().and_then(crate::DateTime::parse);
    match (at(a), at(b)) {
        (Some(a), Some(b)) => a > b,
        (Some(_), None) => true,
        _ => false,
    }
}

/// One row per post, destination and place. Of several records for the same one, the newest
/// settled outcome wins, and an unknown never overrules a settled outcome that is as new or newer;
/// otherwise the newest record wins. Attempts are added up and the first attempt is the earliest,
/// so a post sent twice is counted once with two attempts (ADR 0403).
pub fn reconcile(outcomes: Vec<Outcome>, content_dir: &str) -> Vec<Outcome> {
    let mut rows: BTreeMap<(String, String, String), Outcome> = BTreeMap::new();
    for outcome in outcomes.into_iter().filter_map(redact) {
        let key = (
            source_key(&outcome.source, content_dir),
            outcome.destination.clone(),
            outcome.place.clone().unwrap_or_default(),
        );
        match rows.get_mut(&key) {
            None => {
                let mut outcome = outcome;
                outcome.source = key.0.clone();
                rows.insert(key, outcome);
            }
            Some(kept) => {
                let attempts = kept.attempts.saturating_add(outcome.attempts).min(1000);
                let first = if later(&kept.first_attempt_at, &outcome.first_attempt_at)
                    || kept.first_attempt_at.is_none()
                {
                    outcome
                        .first_attempt_at
                        .clone()
                        .or(kept.first_attempt_at.clone())
                } else {
                    kept.first_attempt_at.clone()
                };
                let newer = later(&outcome.last_update_at, &kept.last_update_at);
                let replace = match (kept.status.settled(), outcome.status.settled()) {
                    // An unknown never overrules a settled outcome.
                    (true, false) if outcome.status == Status::Unknown => false,
                    // A settled outcome replaces an unsettled one unless that one is newer.
                    (false, true) => newer || kept.status == Status::Unknown,
                    _ => newer,
                };
                if replace {
                    let mut outcome = outcome;
                    outcome.source = key.0.clone();
                    *kept = outcome;
                }
                kept.attempts = attempts;
                kept.first_attempt_at = first;
            }
        }
    }
    rows.into_values().collect()
}

/// How many post and destination pairs are in each state. Each row counts once, and only
/// [`Status::Delivered`] and [`Status::ByHand`] count as reached; an unknown is its own count.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub delivered: u32,
    pub by_hand: u32,
    pub draft: u32,
    pub pending: u32,
    pub unknown: u32,
    pub not_delivered: u32,
}

impl Counts {
    pub fn of(rows: &[Outcome]) -> Self {
        let mut counts = Self::default();
        for row in rows {
            let slot = match row.status {
                Status::Delivered => &mut counts.delivered,
                Status::ByHand => &mut counts.by_hand,
                Status::Draft => &mut counts.draft,
                Status::Pending => &mut counts.pending,
                Status::Unknown => &mut counts.unknown,
                Status::NotDelivered => &mut counts.not_delivered,
            };
            *slot += 1;
        }
        counts
    }

    pub fn reached(&self) -> u32 {
        self.delivered + self.by_hand
    }
}

// ---------------------------------------------------------------------------------------------
// Attribution (ADR 0404)

/// Referring hosts that stand for a destination. A host matches itself and its subdomains. Only
/// these become a destination; every other host stays an ordinary referrer.
const REFERRERS: [(&str, &str); 21] = [
    ("dev.to", "dev"),
    ("hashnode.com", "hashnode"),
    ("hashnode.dev", "hashnode"),
    ("medium.com", "medium"),
    ("linkedin.com", "linkedin"),
    ("lnkd.in", "linkedin"),
    ("facebook.com", "facebook"),
    ("fb.com", "facebook"),
    ("fb.me", "facebook"),
    ("bsky.app", "bluesky"),
    ("pinterest.com", "pinterest"),
    ("pin.it", "pinterest"),
    ("youtube.com", "youtube"),
    ("youtu.be", "youtube"),
    ("news.ycombinator.com", "hacker-news"),
    ("reddit.com", "reddit"),
    ("redd.it", "reddit"),
    ("producthunt.com", "product-hunt"),
    ("g.page", "google-business-profile"),
    ("business.google.com", "google-business-profile"),
    ("nextdoor.com", "nextdoor"),
];

/// The destination a referring host stands for, or `None`. `extra_hosts` are the author's own
/// destinations a fixed list cannot know, such as their Mastodon instance or a Ghost or WordPress
/// site they cross-post to, each with its destination. A Google search result is not a Google
/// Business Profile visit, so `google.com` itself is not attributed.
pub fn destination_for_host(host: &str, extra_hosts: &[(String, String)]) -> Option<String> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if host.is_empty() {
        return None;
    }
    let matches = |known: &str| host == known || host.ends_with(&format!(".{known}"));
    for (known, destination) in extra_hosts {
        let known = known.trim().to_ascii_lowercase();
        if !known.is_empty() && matches(known.as_str()) {
            return DESTINATIONS
                .contains(&destination.as_str())
                .then(|| destination.clone());
        }
    }
    // Longer hosts first, so business.google.com is checked before google.com.
    let mut known: Vec<&(&str, &str)> = REFERRERS.iter().collect();
    known.sort_by_key(|(host, _)| std::cmp::Reverse(host.len()));
    known
        .into_iter()
        .find(|(known, _)| matches(known))
        .map(|(_, destination)| destination.to_string())
        .filter(|destination| DESTINATIONS.contains(&destination.as_str()))
}

/// A `utm_source` value a counter may count: exactly one of [`DESTINATIONS`], after lower-casing.
/// Anything else is dropped, so a visitor cannot write a key of their own into the record.
pub fn destination_for_utm(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_lowercase();
    DESTINATIONS.contains(&value.as_str()).then_some(value)
}

/// The destination a counted view came from (ADRs 0404 and 0407): the page address's `utm_source`
/// when campaign tags are on and it names a known destination, otherwise the referring host when
/// it stands for one, from the fixed table or the author's own hosts. Nothing else is attributed.
pub fn arrival(
    campaigns: bool,
    utm_source: Option<&str>,
    referrer_host: Option<&str>,
    own_hosts: &[(String, String)],
) -> Option<String> {
    if campaigns {
        if let Some(found) = utm_source.and_then(destination_for_utm) {
            return Some(found);
        }
    }
    destination_for_host(referrer_host?, own_hosts)
}

/// A link with `utm_source=<destination>` and `utm_medium=open.blog` added, for a link open.blog
/// itself sends, and only when the author turned campaign tags on. The canonical page is unchanged:
/// the tag only reaches the counter. A link that already has a query or a fragment, or a
/// destination outside [`DESTINATIONS`], is returned as it was.
pub fn tag_link(link: &str, destination: &str) -> String {
    if !DESTINATIONS.contains(&destination)
        || link.contains('?')
        || link.contains('#')
        || !(link.starts_with("https://") || link.starts_with("http://"))
    {
        return link.to_string();
    }
    format!("{link}?utm_source={destination}&utm_medium=open.blog")
}

/// The most fediverse instance hosts an author may list in `analytics.fediverseHosts` (ADR 0407).
pub const MAX_FEDIVERSE_HOSTS: usize = 20;

/// The most of the author's own hosts a generated counter reads from its settings (ADR 0407).
pub const MAX_OWN_HOSTS: usize = 32;

/// A bare host name, lower-cased, from a host or an `https://` origin the author wrote: letters,
/// digits, dots and hyphens, at least one dot, no `www.`, up to 253 characters. `None` for
/// anything else, including a path, a port or credentials.
pub fn clean_host(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_lowercase();
    let value = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .unwrap_or(&value);
    let value = value.strip_suffix('/').unwrap_or(value);
    let value = value.strip_prefix("www.").unwrap_or(value);
    let ok = !value.is_empty()
        && value.len() <= 253
        && value.contains('.')
        && !value.starts_with(['.', '-'])
        && !value.ends_with(['.', '-'])
        && !value.contains("..")
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'));
    ok.then(|| value.to_string())
}

/// The author's own hosts, each with the destination it stands for: every cross-posting target's
/// address (ADR 0404), every instance listed in `analytics.fediverseHosts` and the social Mastodon
/// instance when one is configured (`OPENBLOG_SOCIAL_MASTODON_INSTANCE`), both as `mastodon`
/// (ADR 0407). The first spelling of a host wins and the list is bounded by [`MAX_OWN_HOSTS`].
pub fn author_hosts(
    config: &crate::SiteConfig,
    mastodon_instance: Option<&str>,
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut add = |host: Option<String>, destination: &str| {
        if let Some(host) = host {
            if DESTINATIONS.contains(&destination)
                && out.len() < MAX_OWN_HOSTS
                && !out.iter().any(|(known, _)| *known == host)
            {
                out.push((host, destination.to_string()));
            }
        }
    };
    for target in config.syndication.targets.values() {
        let host = target
            .endpoint
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split(['/', ':'])
            .next()
            .and_then(clean_host);
        if let Some(provider) = serde_json::to_value(target.provider)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
        {
            add(host, &provider);
        }
    }
    for host in &config.analytics.fediverse_hosts {
        add(clean_host(host), "mastodon");
    }
    add(mastodon_instance.and_then(clean_host), "mastodon");
    out
}

/// The author's own hosts as a generated counter reads them from its settings:
/// `host=destination` pairs separated by commas.
pub fn own_hosts_setting(hosts: &[(String, String)]) -> String {
    hosts
        .iter()
        .map(|(host, destination)| format!("{host}={destination}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// The markers around the generated attribution block in the Cloudflare Worker template and in
/// `netlify/lib/attribution.mjs`.
pub const ATTRIBUTION_BEGIN: &str =
    "// BEGIN openblog attribution: generated from openblog_core::outcome::attribution_js. Do not edit by hand.";
pub const ATTRIBUTION_END: &str = "// END openblog attribution";

/// The attribution rules as plain JavaScript for the counters open.blog writes but does not run:
/// the Cloudflare Worker and the hosted engagement function (ADR 0407). The vocabulary and the host
/// table are written out from [`DESTINATIONS`] and the referrer table here, and the functions do
/// what [`destination_for_utm`], [`destination_for_host`] and the built-in counter's choice between
/// them do, so every counter attributes the same way. Tests fail if either copy drifts.
pub fn attribution_js() -> String {
    let mut referrers: Vec<&(&str, &str)> = REFERRERS.iter().collect();
    referrers.sort_by_key(|(host, _)| std::cmp::Reverse(host.len()));
    let quote = |value: &str| serde_json::to_string(value).unwrap_or_default();
    let destinations = DESTINATIONS
        .iter()
        .map(|d| quote(d))
        .collect::<Vec<_>>()
        .join(", ");
    let referrers = referrers
        .iter()
        .map(|(host, destination)| format!("  [{}, {}],", quote(host), quote(destination)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"{ATTRIBUTION_BEGIN}
// The destinations a visit may be attributed to (ADRs 0404 and 0407). Nothing else is ever stored.
const ATTRIBUTION_DESTINATIONS = Object.freeze([{destinations}]);
// Referring hosts that stand for a destination, longest first. A host matches itself and its subdomains.
const ATTRIBUTION_REFERRERS = Object.freeze([
{referrers}
]);
const ATTRIBUTION_MAX_OWN_HOSTS = {MAX_OWN_HOSTS};
const attributionLower = (value) => String(value ?? "").trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
const attributionMatches = (host, known) => host === known || host.endsWith(`.${{known}}`);
// The destination a `utm_source` value names, or null.
function attributionForUtm(value) {{
  const name = attributionLower(value);
  return ATTRIBUTION_DESTINATIONS.includes(name) ? name : null;
}}
// The destination a referring host stands for, or null: the author's own hosts first, then the fixed table.
function attributionForHost(value, ownHosts = []) {{
  let host = attributionLower(value).replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host) return null;
  for (const [ownHost, destination] of ownHosts) {{
    const known = attributionLower(ownHost);
    if (known && attributionMatches(host, known)) return ATTRIBUTION_DESTINATIONS.includes(destination) ? destination : null;
  }}
  const found = ATTRIBUTION_REFERRERS.find(([known]) => attributionMatches(host, known));
  return found ? found[1] : null;
}}
// A bare host name, by the same rules as the engine's clean_host, or null.
function attributionCleanHost(value) {{
  let host = attributionLower(value);
  if (host.startsWith("www.")) host = host.slice(4);
  const ok = host.length > 0 && host.length <= 253 && host.includes(".") && /^[a-z0-9.-]+$/.test(host) && !/^[.-]|[.-]$/.test(host) && !host.includes("..");
  return ok ? host : null;
}}
// The author's own hosts from a setting of `host=destination` pairs separated by commas; anything else is dropped.
function attributionOwnHosts(setting) {{
  const out = [];
  for (const pair of String(setting ?? "").split(",")) {{
    const [raw, destination, extra] = pair.split("=");
    const host = attributionCleanHost(raw);
    const name = attributionLower(destination);
    if (extra === undefined && host && ATTRIBUTION_DESTINATIONS.includes(name) && !out.some(([known]) => known === host) && out.length < ATTRIBUTION_MAX_OWN_HOSTS) out.push([host, name]);
  }}
  return out;
}}
// The destination a counted view came from: the page address's utm_source when campaign tags are on and it
// names a destination, otherwise the referring host when it stands for one. Nothing else is attributed.
function attributionArrival({{ campaigns = false, source = null, referrerHost = null, ownHosts = [] }} = {{}}) {{
  if (campaigns === true && typeof source === "string") {{
    const found = attributionForUtm(source);
    if (found) return found;
  }}
  return typeof referrerHost === "string" && referrerHost ? attributionForHost(referrerHost, ownHosts) : null;
}}
{ATTRIBUTION_END}"#
    )
}

/// The generated attribution block found between the markers in `text`, markers included.
pub fn attribution_block(text: &str) -> Option<&str> {
    let start = text.find(ATTRIBUTION_BEGIN)?;
    let end = text[start..].find(ATTRIBUTION_END)? + start + ATTRIBUTION_END.len();
    Some(&text[start..end])
}

/// Markers around the SQL destination allow-list generated from [`DESTINATIONS`].
pub const ATTRIBUTION_SQL_BEGIN: &str =
    "-- BEGIN openblog destinations: generated from openblog_core::outcome::DESTINATIONS. Do not edit by hand.";
pub const ATTRIBUTION_SQL_END: &str = "-- END openblog destinations";

/// The destination allow-list as a SQL `IN` expression.
pub fn attribution_sql() -> String {
    let destinations = DESTINATIONS
        .iter()
        .map(|destination| format!("'{destination}'"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{ATTRIBUTION_SQL_BEGIN}\ndestination in ({destinations})\n{ATTRIBUTION_SQL_END}")
}

/// The generated SQL allow-list found between its markers, markers included.
pub fn attribution_sql_block(text: &str) -> Option<&str> {
    let start = text.find(ATTRIBUTION_SQL_BEGIN)?;
    let end = text[start..].find(ATTRIBUTION_SQL_END)? + start + ATTRIBUTION_SQL_END.len();
    Some(&text[start..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(source: &str, status: Status, when: &str) -> Outcome {
        let mut o = Outcome::new(source, "pinterest", status, Evidence::Provider);
        o.first_attempt_at = Some(when.into());
        o.last_update_at = Some(when.into());
        o
    }

    #[test]
    fn every_record_names_the_same_post_the_same_way() {
        for source in [
            "source:content/posts/a.md",
            "content/posts/a.md",
            "posts/a.md",
            "./content\\posts\\a.md",
        ] {
            assert_eq!(source_key(source, "content"), "posts/a.md", "{source}");
        }
        assert_eq!(source_key("site/posts/a.md", "site/"), "posts/a.md");
    }

    #[test]
    fn a_post_sent_twice_is_one_row_with_both_attempts() {
        let rows = reconcile(
            vec![
                at("posts/a.md", Status::NotDelivered, "2026-11-01T10:00:00Z"),
                at(
                    "source:content/posts/a.md",
                    Status::Delivered,
                    "2026-11-02T10:00:00Z",
                ),
            ],
            "content",
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, Status::Delivered);
        assert_eq!(rows[0].attempts, 2);
        assert_eq!(
            rows[0].first_attempt_at.as_deref(),
            Some("2026-11-01T10:00:00Z")
        );
        assert_eq!(Counts::of(&rows).delivered, 1);
    }

    #[test]
    fn an_unknown_never_overrules_a_settled_outcome_and_is_never_counted_as_reached() {
        let rows = reconcile(
            vec![
                at("posts/a.md", Status::Delivered, "2026-11-01T10:00:00Z"),
                at("posts/a.md", Status::Unknown, "2026-11-03T10:00:00Z"),
            ],
            "content",
        );
        assert_eq!(rows[0].status, Status::Delivered);
        // A settled outcome later than an unknown settles it.
        let rows = reconcile(
            vec![
                at("posts/b.md", Status::Unknown, "2026-11-01T10:00:00Z"),
                at("posts/b.md", Status::ByHand, "2026-11-02T10:00:00Z"),
            ],
            "content",
        );
        assert_eq!(rows[0].status, Status::ByHand);
        let only_unknown = reconcile(
            vec![at("posts/c.md", Status::Unknown, "2026-11-01T10:00:00Z")],
            "content",
        );
        let counts = Counts::of(&only_unknown);
        assert_eq!((counts.reached(), counts.unknown), (0, 1));
    }

    #[test]
    fn places_of_one_provider_stay_apart_and_unknown_destinations_are_left_out() {
        let mut one = Outcome::new("posts/a.md", "reddit", Status::ByHand, Evidence::Author);
        one.place = Some("r/rust".into());
        let mut two = one.clone();
        two.place = Some("r/programming".into());
        let other = Outcome::new(
            "posts/a.md",
            "myspace",
            Status::Delivered,
            Evidence::Provider,
        );
        let rows = reconcile(vec![one, two, other], "content");
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn redaction_keeps_only_codes_clean_ids_and_plain_links() {
        let mut o = Outcome::new(
            "posts/a.md",
            "dev",
            Status::NotDelivered,
            Evidence::Provider,
        );
        o.problem = Some("Bearer abc123 token rejected: {\"error\":\"x\"}".into());
        o.permalink = Some("https://user:pass@dev.to/a?token=secret#x".into());
        o.remote_id = Some("id with spaces\nand newline".into());
        o.last_update_at = Some("yesterday".into());
        let shown = redact(o).unwrap();
        assert_eq!(shown.problem.as_deref(), Some("other"));
        assert_eq!(
            shown.permalink, None,
            "credentials in the host refuse the link"
        );
        assert_eq!(shown.remote_id, None);
        assert_eq!(shown.last_update_at, None);
        let text = serde_json::to_string(&shown).unwrap();
        for secret in ["Bearer", "abc123", "secret", "pass", "newline"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
        let mut ok = Outcome::new("posts/a.md", "dev", Status::Delivered, Evidence::Provider);
        ok.permalink = Some("https://dev.to/me/a-1?utm_source=x#comments".into());
        ok.problem = Some("[rate-limited]".into());
        ok.remote_id = Some("12345".into());
        let shown = redact(ok).unwrap();
        assert_eq!(shown.permalink.as_deref(), Some("https://dev.to/me/a-1"));
        assert_eq!(shown.problem.as_deref(), Some("rate-limited"));
        assert_eq!(shown.remote_id.as_deref(), Some("12345"));
    }

    #[test]
    fn referring_hosts_map_to_destinations_only_from_the_fixed_list_or_the_authors_own() {
        let none: Vec<(String, String)> = vec![];
        assert_eq!(
            destination_for_host("l.facebook.com", &none).as_deref(),
            Some("facebook")
        );
        assert_eq!(
            destination_for_host("www.reddit.com", &none).as_deref(),
            Some("reddit")
        );
        assert_eq!(
            destination_for_host("old.reddit.com", &none).as_deref(),
            Some("reddit")
        );
        assert_eq!(
            destination_for_host("bsky.app", &none).as_deref(),
            Some("bluesky")
        );
        assert_eq!(
            destination_for_host("business.google.com", &none).as_deref(),
            Some("google-business-profile")
        );
        assert_eq!(
            destination_for_host("google.com", &none),
            None,
            "search is not a profile visit"
        );
        assert_eq!(destination_for_host("notreddit.com", &none), None);
        assert_eq!(destination_for_host("example.org", &none), None);
        let mine = vec![("hachyderm.io".to_string(), "mastodon".to_string())];
        assert_eq!(
            destination_for_host("hachyderm.io", &mine).as_deref(),
            Some("mastodon")
        );
        let bad = vec![("evil.example".to_string(), "tracker".to_string())];
        assert_eq!(destination_for_host("evil.example", &bad), None);
    }

    #[test]
    fn only_known_destinations_are_counted_from_utm_source() {
        assert_eq!(
            destination_for_utm("Pinterest").as_deref(),
            Some("pinterest")
        );
        assert_eq!(destination_for_utm("newsletter"), None);
        assert_eq!(destination_for_utm("pinterest<script>"), None);
        assert_eq!(destination_for_utm(""), None);
    }

    #[test]
    fn a_tag_is_added_only_to_a_plain_link_for_a_known_destination() {
        assert_eq!(
            tag_link("https://a.example/post/", "pinterest"),
            "https://a.example/post/?utm_source=pinterest&utm_medium=open.blog"
        );
        assert_eq!(
            tag_link("https://a.example/post/?x=1", "pinterest"),
            "https://a.example/post/?x=1"
        );
        assert_eq!(
            tag_link("https://a.example/post/", "tracker"),
            "https://a.example/post/"
        );
        assert_eq!(tag_link("javascript:x", "pinterest"), "javascript:x");
    }

    fn pairs(value: &serde_json::Value) -> Vec<(String, String)> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| {
                (
                    pair[0].as_str().unwrap().to_string(),
                    pair[1].as_str().unwrap().to_string(),
                )
            })
            .collect()
    }

    #[test]
    fn the_shared_cases_attribute_as_every_counter_must() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/attribution-cases.json"
        ))
        .unwrap();
        for case in cases["hosts"].as_array().unwrap() {
            let found = destination_for_host(case["host"].as_str().unwrap(), &pairs(&case["own"]));
            assert_eq!(found.as_deref(), case["expect"].as_str(), "{case}");
        }
        for case in cases["utm"].as_array().unwrap() {
            let found = destination_for_utm(case["value"].as_str().unwrap());
            assert_eq!(found.as_deref(), case["expect"].as_str(), "{case}");
        }
        for case in cases["arrivals"].as_array().unwrap() {
            let found = arrival(
                case["campaigns"].as_bool().unwrap(),
                case["source"].as_str(),
                case["referrerHost"].as_str(),
                &pairs(&case["own"]),
            );
            assert_eq!(found.as_deref(), case["expect"].as_str(), "{case}");
        }
    }

    const GENERATED_COPIES: [(&str, &str); 2] = [
        (
            "crates/openblog-cli/templates/counter-worker.js",
            include_str!("../../openblog-cli/templates/counter-worker.js"),
        ),
        (
            "netlify/lib/attribution.mjs",
            include_str!("../../../netlify/lib/attribution.mjs"),
        ),
    ];

    #[test]
    fn every_generated_counter_carries_the_same_attribution_block() {
        let expected = attribution_js();
        for (path, text) in GENERATED_COPIES {
            let block = attribution_block(text)
                .unwrap_or_else(|| panic!("{path} has no generated attribution block"));
            assert!(
                block.replace("\r\n", "\n") == expected,
                "{path} differs from openblog_core::outcome::attribution_js(); regenerate it with \
                 `cargo test -p openblog-core write_generated_attribution -- --ignored`"
            );
            assert_eq!(text.matches(ATTRIBUTION_BEGIN).count(), 1, "{path}");
        }
        let sql = include_str!("../../../supabase/arrivals.sql");
        let sql_block = attribution_sql_block(sql).expect("arrivals.sql has no destination list");
        assert_eq!(
            sql_block, attribution_sql(),
            "supabase/arrivals.sql differs from openblog_core::outcome::DESTINATIONS; regenerate it with \
             `cargo test -p openblog-core write_generated_attribution -- --ignored`"
        );
        for destination in DESTINATIONS {
            assert!(expected.contains(&format!("\"{destination}\"")));
        }
        for (host, _) in REFERRERS {
            assert!(expected.contains(&format!("[\"{host}\"")));
        }
    }

    /// Rewrites the generated block in every copy. Run after changing the vocabulary or the table.
    #[test]
    #[ignore]
    fn write_generated_attribution() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for (path, _) in GENERATED_COPIES {
            let file = root.join(path);
            let text = std::fs::read_to_string(&file)
                .unwrap()
                .replace("\r\n", "\n");
            let block = attribution_block(&text).unwrap().to_string();
            std::fs::write(&file, text.replacen(&block, &attribution_js(), 1)).unwrap();
        }
        let file = root.join("supabase/arrivals.sql");
        let text = std::fs::read_to_string(&file)
            .unwrap()
            .replace("\r\n", "\n");
        let block = attribution_sql_block(&text).unwrap().to_string();
        std::fs::write(&file, text.replacen(&block, &attribution_sql(), 1)).unwrap();
    }

    #[test]
    fn the_authors_own_hosts_come_from_targets_listed_instances_and_the_social_instance() {
        let config = crate::SiteConfig::from_json(
            r#"{"syndication":{"targets":{"blog":{"provider":"ghost","endpoint":"https://Me.Ghost.io/ghost/"}}},
                "analytics":{"fediverseHosts":["https://hachyderm.io/","fosstodon.org","hachyderm.io"]}}"#,
        )
        .unwrap();
        assert_eq!(
            config.analytics.fediverse_hosts,
            vec!["hachyderm.io".to_string(), "fosstodon.org".to_string()]
        );
        let hosts = author_hosts(&config, Some("https://mastodon.social"));
        assert_eq!(
            own_hosts_setting(&hosts),
            "me.ghost.io=ghost,hachyderm.io=mastodon,fosstodon.org=mastodon,mastodon.social=mastodon"
        );
        assert_eq!(
            author_hosts(&config, Some("https://hachyderm.io")).len(),
            3,
            "a host already listed is not added twice"
        );
        assert_eq!(author_hosts(&config, Some("not a host")).len(), 3);
        assert!(crate::SiteConfig::default()
            .to_json()
            .find("fediverseHosts")
            .is_none());
    }

    #[test]
    fn a_listed_fediverse_host_must_be_a_host_and_the_list_is_bounded() {
        for bad in [
            "https://x.example/@me",
            "localhost",
            "a..b",
            "-a.b",
            "x y.z",
            "me@x.y",
        ] {
            let json = format!(r#"{{"analytics":{{"fediverseHosts":["{bad}"]}}}}"#);
            assert!(crate::SiteConfig::from_json(&json).is_err(), "{bad}");
        }
        let many: Vec<String> = (0..=MAX_FEDIVERSE_HOSTS)
            .map(|n| format!("\"i{n}.example\""))
            .collect();
        let json = format!(
            r#"{{"analytics":{{"fediverseHosts":[{}]}}}}"#,
            many.join(",")
        );
        assert!(crate::SiteConfig::from_json(&json).is_err());
        assert_eq!(
            clean_host("WWW.Example.org/").as_deref(),
            Some("example.org")
        );
    }
}

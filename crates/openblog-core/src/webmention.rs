//! Outbound Webmention (epic #387, story #401, ADRs 0361 to 0363).
//!
//! A canonical post that links another site can tell that site so, with a W3C Webmention: a form
//! POST of `source` (the canonical post) and `target` (the linked page) to the endpoint the target
//! advertises. This module is the pure half: the opt-in configuration, endpoint discovery from a
//! fetched target's `Link` headers and HTML `rel` values, the queue that decides which links are due
//! a ping, and how a receiver's answer is recorded. The network half, which only ever reaches
//! public addresses, lives in the command-line tool (`openblog webmention`).
//!
//! Pure: no environment, no network, no clock. Recorded errors are fixed codes and never repeat a
//! response body.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use url::Url;

/// The private queue format this release reads and writes. Another number is refused.
pub const STATE_VERSION: u32 = 1;

/// The most links of one post that are queued; the rest are reported and never pinged.
pub const MAX_TARGETS_PER_POST: usize = 100;

/// Attempts at one ping for one revision of the post before it is given up as failed.
pub const MAX_ATTEMPTS: u32 = 5;

/// The wait before each retry, in seconds, by the number of attempts already made.
pub const RETRY_DELAYS_SECONDS: [u64; 4] = [10 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60];

/// Whether and how the author's site sends Webmentions. Off by default, and omitted from the
/// written `openblog.json` while it has its defaults, so a site that never sets it is unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct WebmentionConfig {
    /// Send Webmentions with `openblog webmention --write`. A dry run works either way.
    pub enabled: bool,
    /// The private queue, relative to the project root.
    pub state_file: String,
    /// Hosts that never receive a Webmention from this site (a host also covers its subdomains).
    pub exclude_hosts: Vec<String>,
    /// Receiving Webmentions from other sites (story #402, ADRs 0364 to 0367). Off by default and
    /// omitted from the written `openblog.json` while it has its defaults.
    #[serde(skip_serializing_if = "ReceiveConfig::is_default")]
    pub receive: ReceiveConfig,
}

/// The days a closed or unanswered received mention is kept in the private inbox by default.
pub const DEFAULT_RETENTION_DAYS: u32 = 90;

/// Whether and where the site accepts Webmentions. Off by default: no page advertises an
/// endpoint, no manifest is written and `openblog mentions pull` refuses to contact anything.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ReceiveConfig {
    /// Advertise the endpoint on posts and pull what it received.
    pub enabled: bool,
    /// The hosted receiver's public address (`https://site.example/api/webmention`), advertised
    /// in a `<link rel="webmention">` on each post that accepts mentions.
    pub endpoint: String,
    /// The private moderation inbox, relative to the project root.
    pub inbox_file: String,
    /// Days a rejected, removed, blocked, invalid or still pending mention is kept before
    /// `openblog mentions prune --write` deletes it.
    pub retention_days: u32,
}

impl Default for ReceiveConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: String::new(),
            inbox_file: ".openblog/webmention-inbox.json".into(),
            retention_days: DEFAULT_RETENTION_DAYS,
        }
    }
}

impl ReceiveConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    /// The endpoint as a URL, once receiving is on and it is an absolute `https` address with
    /// a host and no credentials, query or fragment.
    pub fn endpoint_url(&self) -> Option<Url> {
        if !self.enabled {
            return None;
        }
        let url = Url::parse(self.endpoint.trim()).ok()?;
        (url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none())
        .then_some(url)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.enabled && self.endpoint_url().is_none() {
            return Err("webmention.receive.endpoint must be an HTTPS URL without credentials, query, or fragment while webmention.receive.enabled is true".into());
        }
        if !(1..=3650).contains(&self.retention_days) {
            return Err("webmention.receive.retentionDays must be between 1 and 3650".into());
        }
        Ok(())
    }
}

impl Default for WebmentionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            state_file: ".openblog/webmentions.json".into(),
            exclude_hosts: Vec::new(),
            receive: ReceiveConfig::default(),
        }
    }
}

impl WebmentionConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    /// Whether this host was excluded by the author, by exact name or as a subdomain.
    pub fn excludes(&self, host: &str) -> bool {
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        self.exclude_hosts.iter().any(|excluded| {
            let excluded = excluded.trim().trim_end_matches('.').to_ascii_lowercase();
            !excluded.is_empty() && (host == excluded || host.ends_with(&format!(".{excluded}")))
        })
    }
}

/// Why a link of the post is not a Webmention target. Fixed codes, shown with the link.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LinkSkip {
    /// Not an absolute `http` or `https` address.
    NotWeb,
    /// The address carries a user name or password.
    Credentials,
    /// The canonical site itself.
    SameSite,
    /// The author excluded the host.
    Excluded,
    /// More links than one post may queue.
    OverLimit,
}

impl LinkSkip {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotWeb => "not-web",
            Self::Credentials => "credentials",
            Self::SameSite => "same-site",
            Self::Excluded => "excluded",
            Self::OverLimit => "over-limit",
        }
    }
}

/// The link targets of one post: the absolute, fragment-free, de-duplicated `http(s)` addresses
/// on other sites, in document order, and what was left out and why. Whether an address resolves
/// to a public network is the network half's question, asked again on every request.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Targets {
    pub targets: Vec<String>,
    pub skipped: Vec<(String, LinkSkip)>,
}

pub fn targets<'a>(
    canonical: &Url,
    hrefs: impl IntoIterator<Item = &'a str>,
    config: &WebmentionConfig,
) -> Targets {
    let mut result = Targets::default();
    let mut seen = BTreeSet::new();
    for href in hrefs {
        let Ok(mut url) = canonical.join(href.trim()) else {
            result.skipped.push((href.to_string(), LinkSkip::NotWeb));
            continue;
        };
        url.set_fragment(None);
        let text = url.to_string();
        if !seen.insert(text.clone()) {
            continue;
        }
        let skip = if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            Some(LinkSkip::NotWeb)
        } else if !url.username().is_empty() || url.password().is_some() {
            Some(LinkSkip::Credentials)
        } else if same_site(canonical, &url) {
            Some(LinkSkip::SameSite)
        } else if url.host_str().is_some_and(|host| config.excludes(host)) {
            Some(LinkSkip::Excluded)
        } else if result.targets.len() >= MAX_TARGETS_PER_POST {
            Some(LinkSkip::OverLimit)
        } else {
            None
        };
        match skip {
            Some(skip) => result.skipped.push((text, skip)),
            None => result.targets.push(text),
        }
    }
    result
}

fn same_site(canonical: &Url, url: &Url) -> bool {
    let host = |url: &Url| {
        url.host_str()
            .map(|host| host.trim_end_matches('.').to_ascii_lowercase())
    };
    host(canonical) == host(url)
}

/// The `Link` header values of a response that name a Webmention endpoint, in order. A header
/// can hold several comma-separated links, each with any number of parameters; the `rel`
/// parameter, quoted or not, holds space-separated relation types matched without case.
pub fn link_header_endpoints<'a>(values: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut endpoints = Vec::new();
    for value in values {
        for link in split_links(value) {
            let link = link.trim();
            let Some(rest) = link.strip_prefix('<') else {
                continue;
            };
            let Some((reference, parameters)) = rest.split_once('>') else {
                continue;
            };
            let is_webmention = parameters.split(';').any(|parameter| {
                let Some((name, value)) = parameter.split_once('=') else {
                    return false;
                };
                name.trim().eq_ignore_ascii_case("rel")
                    && value
                        .trim()
                        .trim_matches('"')
                        .split_ascii_whitespace()
                        .any(|token| token.eq_ignore_ascii_case("webmention"))
            });
            if is_webmention {
                endpoints.push(reference.trim().to_string());
            }
        }
    }
    endpoints
}

/// Splits a `Link` header at the commas between links, never at a comma inside `<...>` or quotes.
fn split_links(value: &str) -> Vec<&str> {
    let mut links = Vec::new();
    let (mut start, mut in_reference, mut in_quotes) = (0, false, false);
    for (index, character) in value.char_indices() {
        match character {
            '<' if !in_quotes => in_reference = true,
            '>' if !in_quotes => in_reference = false,
            '"' if !in_reference => in_quotes = !in_quotes,
            ',' if !in_reference && !in_quotes => {
                links.push(&value[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    links.push(&value[start..]);
    links
}

/// Whether an HTML `rel` attribute value names a Webmention endpoint.
pub fn rel_is_webmention(rel: &str) -> bool {
    rel.split_ascii_whitespace()
        .any(|token| token.eq_ignore_ascii_case("webmention"))
}

/// The endpoint a target advertises, by the precedence of W3C Webmention 3.1.2: the first `Link`
/// header, else the first `<link>` or `<a>` with `rel="webmention"` in document order. The
/// reference resolves against the target's address after redirects; an empty one is that page
/// itself, and a query string is kept. `None` when the target advertises nothing usable.
pub fn choose_endpoint(
    target_after_redirects: &Url,
    header_endpoints: &[String],
    html_endpoints: &[String],
) -> Option<Url> {
    let reference = header_endpoints.first().or(html_endpoints.first())?;
    let mut endpoint = target_after_redirects.join(reference.trim()).ok()?;
    endpoint.set_fragment(None);
    matches!(endpoint.scheme(), "http" | "https").then_some(endpoint)
}

/// Where a ping stands for one target of one post.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PingStatus {
    /// The receiver answered 2xx: it took the Webmention (201 or 202 means it is still checking it).
    Sent,
    /// The target advertises no Webmention endpoint.
    NoEndpoint,
    /// The receiver or the target refused it in a way a retry would not change.
    Rejected,
    /// An address on the way did not resolve to a public network, so nothing was sent there.
    Blocked,
    /// It did not get through and is due again at `nextAttemptAt`.
    Retrying,
    /// It did not get through in `MAX_ATTEMPTS` attempts.
    Failed,
}

impl PingStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sent => "sent",
            Self::NoEndpoint => "no-endpoint",
            Self::Rejected => "rejected",
            Self::Blocked => "blocked",
            Self::Retrying => "retrying",
            Self::Failed => "failed",
        }
    }
}

/// The recorded outcome of the latest ping of one target.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetRecord {
    pub status: PingStatus,
    /// The post revision this record is about.
    pub revision: String,
    /// Whether that revision of the post links the target.
    pub linked: bool,
    /// Attempts made for this revision.
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    /// A 201's `Location`, where the receiver reports its progress.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_url: Option<String>,
    /// A fixed code for why it did not go through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub attempted_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRecord {
    pub source_path: String,
    pub targets: BTreeMap<String, TargetRecord>,
}

/// The private queue: per canonical post address, per target, the latest outcome.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebmentionState {
    pub schema_version: u32,
    pub sources: BTreeMap<String, SourceRecord>,
}

impl Default for WebmentionState {
    fn default() -> Self {
        Self {
            schema_version: STATE_VERSION,
            sources: BTreeMap::new(),
        }
    }
}

impl WebmentionState {
    pub fn from_json(text: &str) -> Result<Self, String> {
        let state: Self = serde_json::from_str(text).map_err(|_| {
            "the Webmention queue file is not a queue this release reads".to_string()
        })?;
        if state.schema_version != STATE_VERSION {
            return Err("the Webmention queue file has an unsupported schemaVersion".into());
        }
        Ok(state)
    }
}

/// What the queue does with one target on this run.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Action {
    Send,
    Wait,
    Skip,
}

/// Why, as a fixed code.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    /// A link no ping has gone to yet.
    NewLink,
    /// The post changed since the target was last told (W3C Webmention 3.1.4).
    PostChanged,
    /// The post changed and no longer links the target, which is told once so it can update.
    LinkRemoved,
    /// A retry that is due.
    RetryDue,
    /// A retry that is not due yet.
    RetryLater,
    /// This revision already went through.
    AlreadySent,
    /// This revision already ended without a ping; it is tried again when the post changes.
    Settled,
    /// No longer linked and never told; nothing to say.
    NotLinked,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Self::NewLink => "new-link",
            Self::PostChanged => "post-changed",
            Self::LinkRemoved => "link-removed",
            Self::RetryDue => "retry-due",
            Self::RetryLater => "retry-later",
            Self::AlreadySent => "already-sent",
            Self::Settled => "settled",
            Self::NotLinked => "not-linked",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub target: String,
    pub action: Action,
    pub reason: Reason,
    /// Whether the post's current revision links the target.
    pub linked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<PingStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<u64>,
}

/// The queue's decision for every target the post links now or was recorded with before: the
/// current links in order, then removed ones in address order.
pub fn plan(
    previous: Option<&SourceRecord>,
    revision: &str,
    current: &[String],
    now: u64,
) -> Vec<Planned> {
    let empty = BTreeMap::new();
    let records = previous.map(|source| &source.targets).unwrap_or(&empty);
    let mut planned = Vec::new();
    for target in current {
        let record = records.get(target);
        let (action, reason) = match record {
            None => (Action::Send, Reason::NewLink),
            Some(record) if record.revision != revision => (Action::Send, Reason::PostChanged),
            Some(record) => same_revision(record, now),
        };
        planned.push(Planned {
            target: target.clone(),
            action,
            reason,
            linked: true,
            previous: record.map(|record| record.status),
            next_attempt_at: record.and_then(|record| record.next_attempt_at),
        });
    }
    for (target, record) in records {
        if current.contains(target) {
            continue;
        }
        let told = record.linked && record.status == PingStatus::Sent;
        let (action, reason) = if record.revision != revision && told {
            (Action::Send, Reason::LinkRemoved)
        } else if record.revision == revision && !record.linked {
            same_revision(record, now)
        } else {
            (Action::Skip, Reason::NotLinked)
        };
        planned.push(Planned {
            target: target.clone(),
            action,
            reason,
            linked: false,
            previous: Some(record.status),
            next_attempt_at: record.next_attempt_at,
        });
    }
    planned
}

fn same_revision(record: &TargetRecord, now: u64) -> (Action, Reason) {
    match record.status {
        PingStatus::Sent => (Action::Skip, Reason::AlreadySent),
        PingStatus::Retrying if record.next_attempt_at.is_none_or(|at| at <= now) => {
            (Action::Send, Reason::RetryDue)
        }
        PingStatus::Retrying => (Action::Wait, Reason::RetryLater),
        PingStatus::NoEndpoint
        | PingStatus::Rejected
        | PingStatus::Blocked
        | PingStatus::Failed => (Action::Skip, Reason::Settled),
    }
}

/// What one attempt came to, as the network half observed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Attempt {
    /// The endpoint answered with this status (and a 201's `Location`, if any).
    Answered {
        endpoint: String,
        status: u16,
        location: Option<String>,
    },
    /// The target was fetched and advertises no endpoint.
    NoEndpoint,
    /// The target itself answered with an error status, so no endpoint was looked for.
    TargetStatus(u16),
    /// An address on the way was not public, or a redirect led to one; nothing was sent there.
    Blocked,
    /// No answer: a timeout, a refused connection or an unreadable reply. A Webmention may be
    /// repeated safely (a receiver treats a repeat as an update), so this is retried.
    NoAnswer,
    /// The target or endpoint redirected too often, or to something that is not a web address.
    BadRedirect,
}

/// The record one attempt leaves, given the record it replaces for the same revision.
pub fn record_attempt(
    previous: Option<&TargetRecord>,
    revision: &str,
    linked: bool,
    attempt: Attempt,
    now: u64,
) -> TargetRecord {
    let attempts = previous
        .filter(|record| record.revision == revision && record.linked == linked)
        .map_or(0, |record| record.attempts)
        + 1;
    let mut record = TargetRecord {
        status: PingStatus::Failed,
        revision: revision.to_string(),
        linked,
        attempts,
        endpoint: None,
        http_status: None,
        status_url: None,
        error: None,
        attempted_at: now,
        next_attempt_at: None,
    };
    let retry = |record: &mut TargetRecord, code: &str| {
        record.error = Some(code.to_string());
        if attempts >= MAX_ATTEMPTS {
            record.status = PingStatus::Failed;
        } else {
            record.status = PingStatus::Retrying;
            let delay = RETRY_DELAYS_SECONDS[(attempts as usize - 1).min(3)];
            record.next_attempt_at = Some(now.saturating_add(delay));
        }
    };
    match attempt {
        Attempt::Answered {
            endpoint,
            status,
            location,
        } => {
            record.endpoint = Some(endpoint);
            record.http_status = Some(status);
            match status {
                200..=299 => {
                    record.status = PingStatus::Sent;
                    record.status_url = (status == 201).then_some(location).flatten();
                }
                408 | 425 | 429 | 500..=599 => retry(&mut record, "endpoint-unavailable"),
                300..=399 => {
                    record.status = PingStatus::Rejected;
                    record.error = Some("endpoint-redirected".into());
                }
                _ => {
                    record.status = PingStatus::Rejected;
                    record.error = Some("endpoint-refused".into());
                }
            }
        }
        Attempt::NoEndpoint => record.status = PingStatus::NoEndpoint,
        Attempt::TargetStatus(status) => {
            record.http_status = Some(status);
            if matches!(status, 408 | 425 | 429 | 500..=599) {
                retry(&mut record, "target-unavailable");
            } else {
                record.status = PingStatus::Rejected;
                record.error = Some("target-unavailable".into());
            }
        }
        Attempt::Blocked => {
            record.status = PingStatus::Blocked;
            record.error = Some("non-public-address".into());
        }
        Attempt::NoAnswer => retry(&mut record, "no-answer"),
        Attempt::BadRedirect => {
            record.status = PingStatus::Rejected;
            record.error = Some("bad-redirect".into());
        }
    }
    record
}

/// The form body of a Webmention: `source` and `target`, `application/x-www-form-urlencoded`.
/// The endpoint's own query string stays on the endpoint address, never in the body.
pub fn form_body(source: &str, target: &str) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("source", source)
        .append_pair("target", target)
        .finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn targets_are_other_sites_absolute_unique_and_in_order() {
        let config = WebmentionConfig {
            exclude_hosts: vec!["tracker.example".into()],
            ..WebmentionConfig::default()
        };
        let canonical = url("https://blog.example.org/posts/hello/");
        let result = targets(
            &canonical,
            [
                "https://other.example/a#section",
                "https://other.example/a",
                "/about/",
                "https://BLOG.example.org/x",
                "mailto:me@example.org",
                "https://user:pw@other.example/b",
                "https://cdn.tracker.example/c",
                "http://plain.example/d",
                "javascript:alert(1)",
            ],
            &config,
        );
        assert_eq!(
            result.targets,
            ["https://other.example/a", "http://plain.example/d"]
        );
        let codes: Vec<_> = result.skipped.iter().map(|(_, skip)| skip.code()).collect();
        assert_eq!(
            codes,
            [
                "same-site",
                "same-site",
                "not-web",
                "credentials",
                "excluded",
                "not-web"
            ]
        );
    }

    #[test]
    fn targets_stop_at_the_per_post_limit() {
        let canonical = url("https://blog.example.org/p/");
        let hrefs: Vec<String> = (0..MAX_TARGETS_PER_POST + 3)
            .map(|index| format!("https://site{index}.example/"))
            .collect();
        let result = targets(
            &canonical,
            hrefs.iter().map(String::as_str),
            &WebmentionConfig::default(),
        );
        assert_eq!(result.targets.len(), MAX_TARGETS_PER_POST);
        assert_eq!(result.skipped.len(), 3);
        assert!(result
            .skipped
            .iter()
            .all(|(_, skip)| *skip == LinkSkip::OverLimit));
    }

    #[test]
    fn link_headers_are_split_and_matched_by_rel_token() {
        let found = link_header_endpoints([
            r#"<https://a.example/x,y>; rel="other", </wm?x=1>; rel="webmention""#,
            "<https://b.example/wm>; rel=webmention",
            r#"<https://c.example/wm>; rel="WebMention something""#,
            r#"<https://d.example/no>; rel="not-webmention""#,
            r#"<https://e.example/no>; title="rel=webmention""#,
        ]);
        assert_eq!(
            found,
            ["/wm?x=1", "https://b.example/wm", "https://c.example/wm"]
        );
    }

    #[test]
    fn the_header_wins_then_html_and_references_resolve_against_the_final_address() {
        let target = url("https://target.example/after/redirect");
        let header = vec!["/from-header".to_string()];
        let html = vec!["from-html?keep=1".to_string()];
        assert_eq!(
            choose_endpoint(&target, &header, &html).unwrap().as_str(),
            "https://target.example/from-header"
        );
        assert_eq!(
            choose_endpoint(&target, &[], &html).unwrap().as_str(),
            "https://target.example/after/from-html?keep=1"
        );
        assert_eq!(
            choose_endpoint(&target, &[], &["".to_string()])
                .unwrap()
                .as_str(),
            "https://target.example/after/redirect"
        );
        assert!(choose_endpoint(&target, &[], &[]).is_none());
        assert!(choose_endpoint(&target, &["javascript:x".to_string()], &[]).is_none());
        assert!(rel_is_webmention("nofollow webmention"));
        assert!(!rel_is_webmention("webmentions"));
    }

    fn record(status: PingStatus, revision: &str, linked: bool) -> TargetRecord {
        TargetRecord {
            status,
            revision: revision.into(),
            linked,
            attempts: 1,
            endpoint: None,
            http_status: None,
            status_url: None,
            error: None,
            attempted_at: 100,
            next_attempt_at: (status == PingStatus::Retrying).then_some(700),
        }
    }

    fn decisions(plan: &[Planned]) -> Vec<(&str, Action, &'static str)> {
        plan.iter()
            .map(|item| (item.target.as_str(), item.action, item.reason.code()))
            .collect()
    }

    #[test]
    fn the_queue_sends_new_links_and_never_repeats_a_sent_revision() {
        let current = vec!["https://a.example/".to_string()];
        assert_eq!(
            decisions(&plan(None, "r1", &current, 0)),
            [("https://a.example/", Action::Send, "new-link")]
        );
        let source = SourceRecord {
            source_path: "posts/p.md".into(),
            targets: BTreeMap::from([(
                "https://a.example/".to_string(),
                record(PingStatus::Sent, "r1", true),
            )]),
        };
        assert_eq!(
            decisions(&plan(Some(&source), "r1", &current, 0)),
            [("https://a.example/", Action::Skip, "already-sent")]
        );
        assert_eq!(
            decisions(&plan(Some(&source), "r2", &current, 0)),
            [("https://a.example/", Action::Send, "post-changed")]
        );
    }

    #[test]
    fn a_removed_link_that_was_told_is_told_once_more() {
        let source = SourceRecord {
            source_path: "posts/p.md".into(),
            targets: BTreeMap::from([
                (
                    "https://told.example/".to_string(),
                    record(PingStatus::Sent, "r1", true),
                ),
                (
                    "https://never.example/".to_string(),
                    record(PingStatus::NoEndpoint, "r1", true),
                ),
            ]),
        };
        assert_eq!(
            decisions(&plan(Some(&source), "r2", &[], 0)),
            [
                ("https://never.example/", Action::Skip, "not-linked"),
                ("https://told.example/", Action::Send, "link-removed"),
            ]
        );
        let mut after = source.clone();
        after.targets.insert(
            "https://told.example/".into(),
            record(PingStatus::Sent, "r2", false),
        );
        assert_eq!(
            decisions(&plan(Some(&after), "r2", &[], 0))[1],
            ("https://told.example/", Action::Skip, "already-sent")
        );
        assert_eq!(
            decisions(&plan(Some(&after), "r3", &[], 0))[1],
            ("https://told.example/", Action::Skip, "not-linked")
        );
    }

    #[test]
    fn retries_wait_for_their_time_and_settled_outcomes_wait_for_a_change() {
        let current = vec!["https://a.example/".to_string()];
        let source = |status| SourceRecord {
            source_path: "posts/p.md".into(),
            targets: BTreeMap::from([(
                "https://a.example/".to_string(),
                record(status, "r1", true),
            )]),
        };
        let retrying = source(PingStatus::Retrying);
        assert_eq!(
            decisions(&plan(Some(&retrying), "r1", &current, 699))[0].2,
            "retry-later"
        );
        assert_eq!(
            decisions(&plan(Some(&retrying), "r1", &current, 700))[0].2,
            "retry-due"
        );
        for status in [
            PingStatus::NoEndpoint,
            PingStatus::Rejected,
            PingStatus::Blocked,
            PingStatus::Failed,
        ] {
            assert_eq!(
                decisions(&plan(Some(&source(status)), "r1", &current, 10_000))[0].2,
                "settled"
            );
            assert_eq!(
                decisions(&plan(Some(&source(status)), "r2", &current, 0))[0].2,
                "post-changed"
            );
        }
    }

    #[test]
    fn answers_are_recorded_by_class_and_retries_back_off_then_fail() {
        let answered = |status, location: Option<&str>| Attempt::Answered {
            endpoint: "https://a.example/wm".into(),
            status,
            location: location.map(str::to_string),
        };
        let created = record_attempt(
            None,
            "r1",
            true,
            answered(201, Some("https://a.example/s/1")),
            5,
        );
        assert_eq!(created.status, PingStatus::Sent);
        assert_eq!(created.status_url.as_deref(), Some("https://a.example/s/1"));
        let accepted = record_attempt(None, "r1", true, answered(202, Some("https://x/")), 5);
        assert_eq!(
            (accepted.status, accepted.status_url),
            (PingStatus::Sent, None)
        );
        assert_eq!(
            record_attempt(None, "r1", true, answered(400, None), 5).status,
            PingStatus::Rejected
        );
        assert_eq!(
            record_attempt(None, "r1", true, answered(302, None), 5)
                .error
                .as_deref(),
            Some("endpoint-redirected")
        );
        assert_eq!(
            record_attempt(None, "r1", true, Attempt::Blocked, 5).status,
            PingStatus::Blocked
        );
        assert_eq!(
            record_attempt(None, "r1", true, Attempt::TargetStatus(404), 5).status,
            PingStatus::Rejected
        );
        let mut previous: Option<TargetRecord> = None;
        let mut now = 0;
        for (attempt, delay) in RETRY_DELAYS_SECONDS.iter().enumerate() {
            let record = record_attempt(previous.as_ref(), "r1", true, answered(503, None), now);
            assert_eq!(record.attempts, attempt as u32 + 1);
            assert_eq!(record.status, PingStatus::Retrying);
            assert_eq!(record.next_attempt_at, Some(now + delay));
            now += delay;
            previous = Some(record);
        }
        let last = record_attempt(previous.as_ref(), "r1", true, Attempt::NoAnswer, now);
        assert_eq!(
            (last.status, last.attempts),
            (PingStatus::Failed, MAX_ATTEMPTS)
        );
        assert_eq!(last.next_attempt_at, None);
        let fresh = record_attempt(Some(&last), "r2", true, Attempt::NoAnswer, now);
        assert_eq!((fresh.status, fresh.attempts), (PingStatus::Retrying, 1));
    }

    #[test]
    fn the_queue_file_is_versioned_and_closed() {
        let state = WebmentionState::default();
        let text = serde_json::to_string(&state).unwrap();
        assert_eq!(WebmentionState::from_json(&text).unwrap(), state);
        assert!(WebmentionState::from_json(r#"{"schemaVersion":2,"sources":{}}"#).is_err());
        assert!(WebmentionState::from_json(r#"{"schemaVersion":1,"sources":{},"x":1}"#).is_err());
    }

    #[test]
    fn the_form_body_encodes_both_addresses() {
        assert_eq!(
            form_body("https://b.example/p?a=1&b=2", "https://t.example/x y"),
            "source=https%3A%2F%2Fb.example%2Fp%3Fa%3D1%26b%3D2&target=https%3A%2F%2Ft.example%2Fx+y"
        );
    }

    #[test]
    fn the_default_configuration_is_off_and_omitted() {
        let config = WebmentionConfig::default();
        assert!(!config.enabled && config.is_default());
        assert!(serde_json::from_str::<WebmentionConfig>(r#"{"enable":true}"#).is_err());
        let config = WebmentionConfig {
            exclude_hosts: vec!["Example.COM.".into()],
            ..WebmentionConfig::default()
        };
        assert!(config.excludes("www.example.com"));
        assert!(config.excludes("example.com"));
        assert!(!config.excludes("notexample.com"));
    }
}

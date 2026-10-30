//! `openblog webmention`: tell the sites a canonical post links that it links them (story #401,
//! ADRs 0860 to 0862).
//!
//! A dry run reads the built post and the private queue and contacts nothing, so it works on any
//! machine and with sending switched off. `--write` needs `webmention.enabled`, checks that the
//! canonical post is live, then for each due link discovers the target's endpoint and posts the
//! Webmention. Every request goes through the public-only resolver, every address (each redirect
//! hop, the endpoint, a status URL) is checked again before use, and the outcome of each ping is
//! recorded in the private queue so failures are retried with back-off and nothing is repeated.

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use openblog_core::frontmatter;
use openblog_core::webmention::{
    self, Action, Attempt, LinkSkip, PingStatus, Planned, SourceRecord, WebmentionState,
};
use serde::Serialize;
use ureq::config::Config;
use url::Url;

use crate::syndication::{self, SyndicationPost};
use crate::{fsutil, safe_http, site, url_context};

/// Redirects followed while fetching a target, each hop checked again.
const MAX_REDIRECTS: usize = 5;
/// The most of a target page read while looking for its endpoint.
const MAX_DISCOVERY_BYTES: u64 = 1024 * 1024;
/// One request's whole time, connection to last byte.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Default)]
pub struct Options {
    /// One post, or every production-visible post when absent.
    pub slug: Option<String>,
    pub write: bool,
    pub json: bool,
}

/// One HTTP reply, reduced to what discovery and the ping read.
#[derive(Clone, Debug, Default)]
pub(crate) struct Reply {
    pub status: u16,
    pub location: Option<String>,
    pub links: Vec<String>,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NetError {
    /// The address is not public, or did not resolve to a public network.
    Blocked,
    /// No reply: timed out, refused, or unreadable.
    NoAnswer,
}

/// The two requests a Webmention needs. Neither follows a redirect; the caller does, checking
/// each hop.
pub(crate) trait Network {
    fn get(&self, url: &Url) -> Result<Reply, NetError>;
    fn post_form(&self, url: &Url, body: &str) -> Result<Reply, NetError>;
}

#[derive(Default)]
pub(crate) struct PublicNetwork {
    resolver: safe_http::PublicResolver,
    timeout: Option<Duration>,
}

impl PublicNetwork {
    fn agent(&self) -> ureq::Agent {
        let config = Config::builder()
            .timeout_global(Some(self.timeout.unwrap_or(REQUEST_TIMEOUT)))
            .http_status_as_error(false)
            .max_redirects(0)
            .proxy(None)
            .user_agent(concat!("open.blog-webmention/", env!("CARGO_PKG_VERSION")))
            .build();
        safe_http::public_agent(config, self.resolver.clone())
    }
}

fn public_or_blocked(url: &Url) -> Result<(), NetError> {
    url_context::validate_public_url(url.as_str())
        .map(|_| ())
        .map_err(|_| NetError::Blocked)
}

fn reply_from(
    result: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    read_html: bool,
) -> Result<Reply, NetError> {
    let mut response = match result {
        Ok(response) => response,
        Err(ureq::Error::HostNotFound) => return Err(NetError::Blocked),
        Err(_) => return Err(NetError::NoAnswer),
    };
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let location = header("location");
    let content_type = header("content-type").map(|value| {
        value
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
    });
    let links = response
        .headers()
        .get_all("link")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .map(str::to_string)
        .collect();
    let mut body = Vec::new();
    let is_html = matches!(
        content_type.as_deref(),
        Some("text/html" | "application/xhtml+xml")
    );
    if read_html && is_html {
        // Only the start of a large page is read; an endpoint is declared near the top.
        let _ = response
            .body_mut()
            .as_reader()
            .take(MAX_DISCOVERY_BYTES)
            .read_to_end(&mut body);
    }
    Ok(Reply {
        status: response.status().as_u16(),
        location,
        links,
        content_type,
        body,
    })
}

impl Network for PublicNetwork {
    fn get(&self, url: &Url) -> Result<Reply, NetError> {
        public_or_blocked(url)?;
        let result = self
            .agent()
            .get(url.as_str())
            .header(
                "Accept",
                "text/html, application/xhtml+xml;q=0.9, */*;q=0.1",
            )
            .header("Accept-Encoding", "identity")
            .call();
        reply_from(result, true)
    }

    fn post_form(&self, url: &Url, body: &str) -> Result<Reply, NetError> {
        public_or_blocked(url)?;
        let result = self
            .agent()
            .post(url.as_str())
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept-Encoding", "identity")
            .send(body);
        reply_from(result, false)
    }
}

/// Every `<link>` and `<a>` with a `webmention` relation and an `href`, in document order.
fn html_endpoints(html: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(html);
    let dom = html5ever::parse_document(RcDom::default(), Default::default()).one(text.as_ref());
    let mut found = Vec::new();
    collect_elements(&dom.document, &mut |name, attribute| {
        if matches!(name, "link" | "a")
            && attribute("rel").is_some_and(|rel| webmention::rel_is_webmention(&rel))
        {
            if let Some(href) = attribute("href") {
                found.push(href);
            }
        }
    });
    found
}

/// Every `<a href>` of a post's public HTML, in document order.
fn post_links(html: &str) -> Vec<String> {
    let dom = html5ever::parse_document(RcDom::default(), Default::default()).one(html);
    let mut found = Vec::new();
    collect_elements(&dom.document, &mut |name, attribute| {
        if name == "a" {
            if let Some(href) = attribute("href") {
                found.push(href);
            }
        }
    });
    found
}

/// Called with each element's lower-case name and a lookup of its attributes.
type Visit<'a> = dyn FnMut(&str, &dyn Fn(&str) -> Option<String>) + 'a;

fn collect_elements(node: &Handle, visit: &mut Visit<'_>) {
    if let NodeData::Element { name, attrs, .. } = &node.data {
        let attrs = attrs.borrow();
        let attribute = |wanted: &str| {
            attrs
                .iter()
                .find(|attr| attr.name.local.as_ref().eq_ignore_ascii_case(wanted))
                .map(|attr| attr.value.to_string())
        };
        visit(&name.local.as_ref().to_ascii_lowercase(), &attribute);
    }
    for child in node.children.borrow().iter() {
        collect_elements(child, visit);
    }
}

/// Finds the endpoint `target` advertises (W3C Webmention 3.1.2), following at most
/// `MAX_REDIRECTS` redirects, each re-checked, and refusing an endpoint that is not public.
fn discover(network: &dyn Network, target: &str) -> Result<Url, Attempt> {
    let mut current = Url::parse(target).map_err(|_| Attempt::BadRedirect)?;
    for hop in 0..=MAX_REDIRECTS {
        let reply = network.get(&current).map_err(attempt_from)?;
        if (300..400).contains(&reply.status) {
            let Some(next) = reply
                .location
                .as_deref()
                .and_then(|location| current.join(location).ok())
                .filter(|next| matches!(next.scheme(), "http" | "https"))
            else {
                return Err(Attempt::BadRedirect);
            };
            if hop == MAX_REDIRECTS {
                return Err(Attempt::BadRedirect);
            }
            current = next;
            continue;
        }
        if !(200..300).contains(&reply.status) {
            return Err(Attempt::TargetStatus(reply.status));
        }
        let headers = webmention::link_header_endpoints(reply.links.iter().map(String::as_str));
        // Only an HTML page is parsed; any other body is never read for an endpoint.
        let is_html = matches!(
            reply.content_type.as_deref(),
            Some("text/html" | "application/xhtml+xml")
        );
        let in_html = if headers.is_empty() && is_html {
            html_endpoints(&reply.body)
        } else {
            Vec::new()
        };
        let endpoint =
            webmention::choose_endpoint(&current, &headers, &in_html).ok_or(Attempt::NoEndpoint)?;
        public_or_blocked(&endpoint).map_err(attempt_from)?;
        return Ok(endpoint);
    }
    Err(Attempt::BadRedirect)
}

fn attempt_from(error: NetError) -> Attempt {
    match error {
        NetError::Blocked => Attempt::Blocked,
        NetError::NoAnswer => Attempt::NoAnswer,
    }
}

/// One Webmention from `source` to `target`: discovery, then the form POST (3.1.3).
pub(crate) fn ping(network: &dyn Network, source: &str, target: &str) -> Attempt {
    let endpoint = match discover(network, target) {
        Ok(endpoint) => endpoint,
        Err(attempt) => return attempt,
    };
    match network.post_form(&endpoint, &webmention::form_body(source, target)) {
        Ok(reply) => Attempt::Answered {
            location: reply
                .location
                .as_deref()
                .and_then(|location| endpoint.join(location).ok())
                .filter(|url| url_context::validate_public_url(url.as_str()).is_ok())
                .map(String::from),
            endpoint: endpoint.into(),
            status: reply.status,
        },
        Err(error) => attempt_from(error),
    }
}

/// Before any ping for a post: the canonical address answers 2xx itself and declares itself
/// canonical, so a receiver that checks the source finds the post.
fn canonical_is_live(network: &dyn Network, canonical: &str) -> Result<(), String> {
    let url = Url::parse(canonical).map_err(|_| "the canonical address is invalid".to_string())?;
    let reply = network.get(&url).map_err(|error| match error {
        NetError::Blocked => format!("{canonical} did not resolve to a public address"),
        NetError::NoAnswer => format!("{canonical} did not answer"),
    })?;
    if !(200..300).contains(&reply.status) {
        return Err(format!("{canonical} returned HTTP {}", reply.status));
    }
    if !syndication::declares_canonical(&String::from_utf8_lossy(&reply.body), canonical)? {
        return Err(format!(
            "{canonical} is reachable but does not declare itself in a <link rel=\"canonical\">"
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkippedLink {
    href: String,
    reason: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome {
    target: String,
    status: PingStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_attempt_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PostReport {
    slug: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    canonical_url: Option<String>,
    /// Set when the post was left alone, as a fixed code.
    #[serde(skip_serializing_if = "Option::is_none")]
    not_sent: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    problem: Option<String>,
    planned: Vec<Planned>,
    skipped_links: Vec<SkippedLink>,
    outcomes: Vec<Outcome>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    report_version: u32,
    enabled: bool,
    write: bool,
    posts: Vec<PostReport>,
}

pub fn run(root: &Path, options: Options) -> Result<(), String> {
    let now = u64::try_from(crate::clock::now().unix()).unwrap_or(0);
    let report = run_with(root, &options, &PublicNetwork::default(), now)?;
    if options.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("could not serialize the Webmention plan: {error}"))?
        );
    } else {
        print_report(&report);
    }
    let not_live = report
        .posts
        .iter()
        .filter(|post| post.not_sent == Some("canonical-not-live"))
        .count();
    if not_live > 0 {
        return Err(format!(
            "{not_live} post(s) were not live at their canonical address, so no Webmention was sent for them; deploy and run again"
        ));
    }
    Ok(())
}

fn state_path(root: &Path, configured: &str) -> Result<PathBuf, String> {
    let relative = Path::new(configured);
    if configured.trim().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("webmention.stateFile must be a project-relative path without `..`".into());
    }
    Ok(root.join(relative))
}

fn load_state(path: &Path) -> Result<WebmentionState, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => WebmentionState::from_json(&text)
            .map_err(|error| format!("{error}: {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(WebmentionState::default())
        }
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

fn save_state(path: &Path, state: &WebmentionState) -> Result<(), String> {
    let mut bytes = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    fsutil::write_file(path, &bytes)
}

fn opted_out(source: &str) -> bool {
    frontmatter::parse(source).is_ok_and(|document| {
        document
            .front_matter
            .get("webmentions")
            .is_some_and(|value| value.trim() == "false")
    })
}

fn run_with(
    root: &Path,
    options: &Options,
    network: &dyn Network,
    now: u64,
) -> Result<Report, String> {
    if options.json && options.write {
        return Err("--json is available for dry runs only; nothing was contacted".into());
    }
    let config = site::load_config(root)?;
    if options.write && !config.webmention.enabled {
        return Err("Webmention sending is off. Set `\"webmention\": { \"enabled\": true }` in openblog.json to send; a dry run (without --write) shows what would be sent. Nothing was contacted.".into());
    }
    let path = state_path(root, &config.webmention.state_file)?;
    let mut state = load_state(&path)?;
    let sources = site::read_sources(root, &config)?;
    let (mut loaded, _) = site::load_site(root, false, Some(crate::clock::now()))?;
    crate::boundary::attach_public_curation(root, &mut loaded)?;
    let posts: Vec<_> = match &options.slug {
        Some(slug) => match loaded.posts.iter().find(|post| &post.slug == slug) {
            Some(post) => vec![post],
            None => return Err(syndication::unavailable_post_error(root, slug)?),
        },
        None => loaded.posts.iter().collect(),
    };
    let mut report = Report {
        report_version: 1,
        enabled: config.webmention.enabled,
        write: options.write,
        posts: Vec::new(),
    };
    for post in posts {
        let source = sources
            .posts
            .iter()
            .find(|source| source.path == post.source)
            .ok_or_else(|| format!("cannot find source `{}`", post.source))?;
        let mut entry = PostReport {
            slug: post.slug.clone(),
            source: post.source.clone(),
            canonical_url: None,
            not_sent: None,
            problem: None,
            planned: Vec::new(),
            skipped_links: Vec::new(),
            outcomes: Vec::new(),
        };
        if opted_out(&source.contents) {
            entry.not_sent = Some("opted-out");
            report.posts.push(entry);
            continue;
        }
        let public: SyndicationPost = syndication::syndication_post(
            post,
            &source.contents,
            &config,
            loaded.series_context(post),
            loaded.curated_context_for(post),
        )?;
        let canonical = Url::parse(&public.canonical_url)
            .map_err(|_| "the canonical address is invalid".to_string())?;
        entry.canonical_url = Some(public.canonical_url.clone());
        let hrefs = post_links(&public.html);
        let found = webmention::targets(
            &canonical,
            hrefs.iter().map(String::as_str),
            &config.webmention,
        );
        entry.skipped_links = found
            .skipped
            .iter()
            .filter(|(_, reason)| *reason != LinkSkip::SameSite)
            .map(|(href, reason)| SkippedLink {
                href: href.clone(),
                reason: reason.code(),
            })
            .collect();
        let previous = state.sources.get(&public.canonical_url);
        entry.planned = webmention::plan(previous, &public.revision, &found.targets, now);
        let due: Vec<Planned> = entry
            .planned
            .iter()
            .filter(|planned| planned.action == Action::Send)
            .cloned()
            .collect();
        if !options.write || due.is_empty() {
            report.posts.push(entry);
            continue;
        }
        if let Err(problem) = canonical_is_live(network, &public.canonical_url) {
            entry.not_sent = Some("canonical-not-live");
            entry.problem = Some(problem);
            report.posts.push(entry);
            continue;
        }
        for planned in due {
            let attempt = ping(network, &public.canonical_url, &planned.target);
            let record = state
                .sources
                .entry(public.canonical_url.clone())
                .or_insert_with(|| SourceRecord {
                    source_path: public.source_path.clone(),
                    ..SourceRecord::default()
                });
            record.source_path = public.source_path.clone();
            let outcome = webmention::record_attempt(
                record.targets.get(&planned.target),
                &public.revision,
                planned.linked,
                attempt,
                now,
            );
            entry.outcomes.push(Outcome {
                target: planned.target.clone(),
                status: outcome.status,
                http_status: outcome.http_status,
                error: outcome.error.clone(),
                next_attempt_at: outcome.next_attempt_at,
            });
            record.targets.insert(planned.target.clone(), outcome);
            // Saved after every ping, so an interrupted run never repeats one that went through.
            save_state(&path, &state)?;
        }
        report.posts.push(entry);
    }
    Ok(report)
}

fn print_report(report: &Report) {
    println!(
        "Webmention {}{}",
        if report.write { "send" } else { "dry run" },
        if report.enabled {
            ""
        } else {
            " (sending is off: set webmention.enabled to send)"
        }
    );
    for post in &report.posts {
        println!(
            "- {} ({})",
            post.slug,
            post.canonical_url.as_deref().unwrap_or(&post.source)
        );
        if post.not_sent == Some("opted-out") {
            println!("  skipped: the post sets `webmentions: false`");
            continue;
        }
        if let Some(problem) = &post.problem {
            println!("  not sent: {problem}");
        }
        if post.planned.is_empty() {
            println!("  no links to other sites");
        }
        for planned in &post.planned {
            let action = match planned.action {
                Action::Send if report.write => "sending",
                Action::Send => "would send",
                Action::Wait => "waiting",
                Action::Skip => "skip",
            };
            println!("  {action}: {} [{}]", planned.target, planned.reason.code());
        }
        for skipped in &post.skipped_links {
            println!("  not a target: {} [{}]", skipped.href, skipped.reason);
        }
        for outcome in &post.outcomes {
            let detail = match (&outcome.http_status, &outcome.error) {
                (Some(status), Some(error)) => format!(" (HTTP {status}, {error})"),
                (Some(status), None) => format!(" (HTTP {status})"),
                (None, Some(error)) => format!(" ({error})"),
                (None, None) => String::new(),
            };
            println!("  {}: {}{detail}", outcome.status.as_str(), outcome.target);
        }
    }
    if !report.write {
        println!(
            "Nothing was contacted and the queue was not changed. Re-run with --write to send."
        );
    }
}

#[cfg(test)]
mod tests;

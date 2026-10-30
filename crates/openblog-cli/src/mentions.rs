//! `openblog mentions`: receive and moderate Webmentions from other sites (story #402, ADRs 0863
//! to 0866).
//!
//! The hosted receiver (`netlify/functions/webmention.mjs`) only checks a request's two addresses
//! and stores the pair; it never fetches a page a stranger named. `pull --write` takes the stored
//! pairs, fetches each source through the public-only fetcher of `openblog webmention` (every
//! redirect hop checked again, 1 MiB and 15 seconds at most), checks that it links the post
//! without running any of its HTML, and files what it found in the private inbox for a moderator.
//! Approving, rejecting, removing and blocking change the inbox and rewrite the published file
//! (`content/webmentions.json`), which the next build lists on each post's canonical page.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use openblog_core::mention_publication::{MentionsFile, WEBMENTIONS_FILE};
use openblog_core::webmention_inbox::{
    self, check_request, Claimed, Decision, Inbox, MentionStatus, ModerationReason, Received,
    SourceCheck,
};
use serde::{Deserialize, Serialize};
use ureq::config::Config;
use url::Url;

use crate::webmention::{NetError, Network, PublicNetwork, MAX_REDIRECTS};
use crate::{fsutil, safe_http, site};

/// The secret the hosted receiver's inbox routes ask for, read from the environment only.
pub const ADMIN_KEY_VARIABLE: &str = "OPENBLOG_WEBMENTION_ADMIN_KEY";
/// The most requests one pull takes.
const MAX_PULL: usize = 100;
const HOSTED_TIMEOUT: Duration = Duration::from_secs(20);
/// The most of a hosted inbox reply read.
const MAX_HOSTED_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Default)]
pub struct Options {
    pub action: Option<String>,
    pub argument: Option<String>,
    pub write: bool,
    pub json: bool,
    pub status: Option<String>,
    pub reason: Option<String>,
    pub revision: Option<String>,
}

/// One request the hosted receiver stored.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Request {
    pub id: String,
    pub version: i64,
    pub source: String,
    pub target: String,
    /// Unix seconds.
    pub received_at: u64,
}

/// The hosted receiver's two Admin routes: take what is waiting, and settle what was handled.
pub(crate) trait Hosted {
    fn take(&self, limit: usize) -> Result<Vec<Request>, String>;
    /// Deletes each named request, but only at the version it was taken, so one repeated since
    /// is kept for the next pull.
    fn settle(&self, done: &[(String, i64)]) -> Result<(), String>;
}

struct HostedReceiver {
    inbox: Url,
    settle: Url,
    key: String,
}

#[derive(Deserialize)]
struct Taken {
    requests: Vec<Request>,
}

impl HostedReceiver {
    fn new(endpoint: &Url, key: String) -> Result<Self, String> {
        let base = format!("{}/", endpoint.as_str().trim_end_matches('/'));
        let base = Url::parse(&base).map_err(|_| "webmention.receive.endpoint is invalid")?;
        Ok(Self {
            inbox: base.join("inbox").map_err(|_| "bad endpoint")?,
            settle: base.join("inbox/settle").map_err(|_| "bad endpoint")?,
            key,
        })
    }

    fn agent() -> ureq::Agent {
        let config = Config::builder()
            .timeout_global(Some(HOSTED_TIMEOUT))
            .http_status_as_error(false)
            .max_redirects(0)
            .proxy(None)
            .user_agent(concat!("open.blog-mentions/", env!("CARGO_PKG_VERSION")))
            .build();
        safe_http::public_agent(config, safe_http::PublicResolver::default())
    }

    fn answer(
        result: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<Vec<u8>, String> {
        // The key is never part of a message: only the status is reported.
        let mut response =
            result.map_err(|_| "the hosted Webmention receiver did not answer".to_string())?;
        let status = response.status().as_u16();
        match status {
            200..=299 => {}
            401 | 403 => {
                return Err(format!(
                    "the hosted Webmention receiver refused the key; check {ADMIN_KEY_VARIABLE} on both sides"
                ))
            }
            404 => {
                return Err(
                    "the hosted Webmention receiver is not enabled (OPENBLOG_WEBMENTION_ENABLED)"
                        .into(),
                )
            }
            _ => {
                return Err(format!(
                    "the hosted Webmention receiver answered HTTP {status}"
                ))
            }
        }
        let mut body = Vec::new();
        std::io::Read::read_to_end(
            &mut std::io::Read::take(response.body_mut().as_reader(), MAX_HOSTED_BYTES),
            &mut body,
        )
        .map_err(|_| "the hosted Webmention receiver's answer could not be read".to_string())?;
        Ok(body)
    }
}

impl Hosted for HostedReceiver {
    fn take(&self, limit: usize) -> Result<Vec<Request>, String> {
        let mut url = self.inbox.clone();
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string());
        let body = Self::answer(
            Self::agent()
                .get(url.as_str())
                .header("Authorization", &format!("Bearer {}", self.key))
                .header("Accept", "application/json")
                .call(),
        )?;
        let taken: Taken = serde_json::from_slice(&body).map_err(|_| {
            "the hosted Webmention receiver's inbox is not a list this release reads"
        })?;
        Ok(taken.requests.into_iter().take(limit).collect())
    }

    fn settle(&self, done: &[(String, i64)]) -> Result<(), String> {
        if done.is_empty() {
            return Ok(());
        }
        let items: Vec<_> = done
            .iter()
            .map(|(id, version)| serde_json::json!({ "id": id, "version": version }))
            .collect();
        Self::answer(
            Self::agent()
                .post(self.settle.as_str())
                .header("Authorization", &format!("Bearer {}", self.key))
                .header("Content-Type", "application/json")
                .send(serde_json::json!({ "items": items }).to_string()),
        )
        .map(|_| ())
    }
}

// ---- Source verification (W3C Webmention 3.2.2) ----

/// Fetches `source` and says whether it links `target`, following at most `MAX_REDIRECTS`
/// redirects with each hop checked again. Only HTML and plain text are read; HTML is parsed into
/// a tree and its scripts are never run, its styles, images and frames never loaded.
pub(crate) fn check_source(network: &dyn Network, source: &str, target: &Url) -> SourceCheck {
    let Ok(mut current) = Url::parse(source) else {
        return SourceCheck::NoLink;
    };
    for hop in 0..=MAX_REDIRECTS {
        let reply = match network.get(&current) {
            Ok(reply) => reply,
            Err(NetError::Blocked) => return SourceCheck::NotPublic,
            Err(NetError::NoAnswer) => return SourceCheck::Unreachable,
        };
        match reply.status {
            300..=399 => {
                let Some(next) = reply
                    .location
                    .as_deref()
                    .and_then(|location| current.join(location).ok())
                    .filter(|next| matches!(next.scheme(), "http" | "https"))
                else {
                    return SourceCheck::Unreachable;
                };
                if hop == MAX_REDIRECTS {
                    return SourceCheck::Unreachable;
                }
                current = next;
            }
            404 | 410 => return SourceCheck::Gone,
            200..=299 => {
                return match reply.content_type.as_deref() {
                    Some("text/html" | "application/xhtml+xml") => {
                        read_html(&String::from_utf8_lossy(&reply.body), &current, target)
                    }
                    Some("text/plain") => {
                        if String::from_utf8_lossy(&reply.body).contains(target.as_str()) {
                            SourceCheck::Links(Claimed::default())
                        } else {
                            SourceCheck::NoLink
                        }
                    }
                    _ => SourceCheck::Unsupported,
                };
            }
            _ => return SourceCheck::Unreachable,
        }
    }
    SourceCheck::Unreachable
}

/// The attributes of an HTML document that can hold a link to the target.
const LINK_ATTRIBUTES: &[(&str, &str)] = &[
    ("a", "href"),
    ("area", "href"),
    ("link", "href"),
    ("img", "src"),
    ("video", "src"),
    ("audio", "src"),
    ("source", "src"),
    ("blockquote", "cite"),
    ("q", "cite"),
    ("ins", "cite"),
    ("del", "cite"),
];

/// Elements whose text is never read as a claim.
const SILENT: &[&str] = &["script", "style", "template", "noscript", "svg", "math"];

struct Element<'a> {
    name: String,
    node: &'a Handle,
}

fn element(node: &Handle) -> Option<Element<'_>> {
    match &node.data {
        NodeData::Element { name, .. } => Some(Element {
            name: name.local.as_ref().to_ascii_lowercase(),
            node,
        }),
        _ => None,
    }
}

fn attribute(node: &Handle, wanted: &str) -> Option<String> {
    let NodeData::Element { attrs, .. } = &node.data else {
        return None;
    };
    attrs
        .borrow()
        .iter()
        .find(|attr| attr.name.local.as_ref().eq_ignore_ascii_case(wanted))
        .map(|attr| attr.value.to_string())
}

fn has_class(node: &Handle, class: &str) -> bool {
    attribute(node, "class").is_some_and(|value| value.split_ascii_whitespace().any(|c| c == class))
}

fn text_of(node: &Handle, out: &mut String) {
    match &node.data {
        NodeData::Text { contents } => out.push_str(&contents.borrow()),
        NodeData::Element { name, .. } if SILENT.contains(&name.local.as_ref()) => return,
        _ => {}
    }
    for child in node.children.borrow().iter() {
        text_of(child, out);
    }
}

fn first(node: &Handle, test: &dyn Fn(&Handle) -> bool) -> Option<Handle> {
    if test(node) {
        return Some(node.clone());
    }
    if element(node).is_some_and(|e| SILENT.contains(&e.name.as_str())) {
        return None;
    }
    node.children
        .borrow()
        .iter()
        .find_map(|child| first(child, test))
}

fn links(node: &Handle, base: &Url, target: &Url) -> bool {
    if let Some(element) = element(node) {
        let found = LINK_ATTRIBUTES
            .iter()
            .filter(|(name, _)| *name == element.name)
            .filter_map(|(_, attr)| attribute(element.node, attr))
            .any(|value| {
                base.join(value.trim()).is_ok_and(|mut url| {
                    if &url == target {
                        return true;
                    }
                    url.set_fragment(None);
                    &url == target
                })
            });
        if found {
            return true;
        }
    }
    node.children
        .borrow()
        .iter()
        .any(|child| links(child, base, target))
}

/// Reads an HTML source: whether it links the target exactly, and what it claims (its h-entry
/// name, author and date, else its `<title>`). Text only; never markup, never a resource.
fn read_html(html: &str, base: &Url, target: &Url) -> SourceCheck {
    let dom = html5ever::parse_document(RcDom::default(), Default::default()).one(html);
    let root = &dom.document;
    if !links(root, base, target) {
        return SourceCheck::NoLink;
    }
    let text = |node: &Handle| {
        let mut out = String::new();
        text_of(node, &mut out);
        out
    };
    let entry = first(root, &|node| has_class(node, "h-entry"));
    let scope = entry.as_ref().unwrap_or(root);
    let title = entry
        .as_ref()
        .and_then(|entry| first(entry, &|node| has_class(node, "p-name")))
        .map(|node| text(&node))
        .or_else(|| {
            first(root, &|node| {
                element(node).is_some_and(|element| element.name == "title")
            })
            .map(|node| text(&node))
        });
    let author = entry
        .as_ref()
        .and_then(|_| first(scope, &|node| has_class(node, "p-author")))
        .map(|author| {
            first(&author, &|node| has_class(node, "p-name"))
                .map(|name| text(&name))
                .unwrap_or_else(|| text(&author))
        });
    let published = entry
        .as_ref()
        .and_then(|_| first(scope, &|node| has_class(node, "dt-published")))
        .map(|node| attribute(&node, "datetime").unwrap_or_else(|| text(&node)));
    SourceCheck::Links(Claimed::new(
        title.as_deref(),
        author.as_deref(),
        published.as_deref(),
    ))
}

// ---- The inbox and the published file ----

fn inbox_path(root: &Path, configured: &str) -> Result<PathBuf, String> {
    let relative = Path::new(configured);
    if configured.trim().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(
            "webmention.receive.inboxFile must be a project-relative path without `..`".into(),
        );
    }
    Ok(root.join(relative))
}

fn load_inbox(path: &Path) -> Result<Inbox, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Inbox::from_json(&text).map_err(|error| format!("{error}: {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Inbox::default()),
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

/// Writes the published file when what it publishes changed. A site with no approved mention
/// and no file gets none, so its build is unchanged.
fn publish(root: &Path, content: &str, inbox: &Inbox) -> Result<bool, String> {
    let path = root.join(content).join(WEBMENTIONS_FILE);
    let published = inbox.published();
    let current = match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
    };
    if current.is_none() && published.mentions.is_empty() {
        return Ok(false);
    }
    let text = published.to_json();
    if current.as_deref() == Some(text.as_str()) {
        return Ok(false);
    }
    // The file the build reads must stay readable: check what is written.
    MentionsFile::from_json(&text)?;
    fsutil::write_file(&path, text.as_bytes())?;
    Ok(true)
}

// ---- Reports ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullOutcome {
    source: String,
    target: String,
    outcome: Received,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullReport {
    report_version: u32,
    enabled: bool,
    write: bool,
    outcomes: Vec<PullOutcome>,
    published_changed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Listed<'a> {
    id: &'a str,
    status: MentionStatus,
    revision: u32,
    post: &'a str,
    source: &'a str,
    host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
    claimed: &'a Claimed,
}

fn now_seconds() -> u64 {
    u64::try_from(crate::clock::now().unix()).unwrap_or(0)
}

pub fn run(root: &Path, options: Options) -> Result<(), String> {
    let now = now_seconds();
    let config = site::load_config(root)?;
    let hosted = || -> Result<HostedReceiver, String> {
        let endpoint = config.webmention.receive.endpoint_url().ok_or(
            "receiving Webmentions is off. Set webmention.receive.enabled and webmention.receive.endpoint in openblog.json; nothing was contacted",
        )?;
        let key = std::env::var(ADMIN_KEY_VARIABLE)
            .ok()
            .filter(|key| key.trim().len() >= 32)
            .ok_or_else(|| {
                format!("set {ADMIN_KEY_VARIABLE} (at least 32 characters, the same value as the hosted function's) to pull; nothing was contacted")
            })?;
        HostedReceiver::new(&endpoint, key.trim().to_string())
    };
    let output = run_with(
        root,
        &options,
        &|| hosted().map(|h| Box::new(h) as Box<dyn Hosted>),
        &PublicNetwork::default(),
        now,
    )?;
    print!("{output}");
    Ok(())
}

type HostedFactory<'a> = dyn Fn() -> Result<Box<dyn Hosted + 'a>, String> + 'a;

pub(crate) fn run_with(
    root: &Path,
    options: &Options,
    hosted: &HostedFactory<'_>,
    network: &dyn Network,
    now: u64,
) -> Result<String, String> {
    let config = site::load_config(root)?;
    let receive = &config.webmention.receive;
    let path = inbox_path(root, &receive.inbox_file)?;
    let mut inbox = load_inbox(&path)?;
    let action = options.action.as_deref().unwrap_or("list");
    let argument = || {
        options
            .argument
            .clone()
            .ok_or_else(|| format!("`openblog mentions {action}` needs an argument"))
    };
    let reason = || -> Result<ModerationReason, String> {
        match options.reason.as_deref() {
            None => Ok(ModerationReason::Other),
            Some(value) => ModerationReason::parse(value).ok_or_else(|| {
                format!("--reason must be spam, abusive, off-topic, duplicate, personal-data or other, not `{value}`")
            }),
        }
    };
    let save = |inbox: &Inbox| -> Result<bool, String> {
        fsutil::write_file(&path, inbox.to_json().as_bytes())?;
        publish(root, &config.paths.content, inbox)
    };
    let changed_note = |changed: bool| {
        if changed {
            format!(
                "{}/{WEBMENTIONS_FILE} was updated; build and deploy to show it.\n",
                config.paths.content.trim_end_matches(['/', '\\'])
            )
        } else {
            String::new()
        }
    };
    match action {
        "list" => list(&inbox, options),
        "pull" => pull(root, options, &config, &mut inbox, hosted, network, now, &save),
        "approve" => {
            let id = argument()?;
            let revision = options
                .revision
                .as_deref()
                .ok_or("approving needs --revision <n>, the revision you read in `openblog mentions list`")?
                .parse::<u32>()
                .map_err(|_| "--revision must be a number")?;
            inbox.decide(&id, Decision::Approve { revision }, now)?;
            let changed = save(&inbox)?;
            Ok(format!("{id} approved.\n{}", changed_note(changed)))
        }
        "reject" => {
            let id = argument()?;
            inbox.decide(&id, Decision::Reject(reason()?), now)?;
            save(&inbox)?;
            Ok(format!("{id} rejected.\n"))
        }
        "remove" => {
            let id = argument()?;
            inbox.decide(&id, Decision::Remove(reason()?), now)?;
            let changed = save(&inbox)?;
            Ok(format!("{id} removed.\n{}", changed_note(changed)))
        }
        "block" => {
            let host = argument()?;
            let count = inbox.block(&host, now)?;
            let changed = save(&inbox)?;
            Ok(format!(
                "{host} is blocked: {count} mention(s) hidden and their text deleted; its requests are dropped unread.\n{}",
                changed_note(changed)
            ))
        }
        "unblock" => {
            let host = argument()?;
            let lifted = inbox.unblock(&host)?;
            save(&inbox)?;
            Ok(if lifted {
                format!("{host} is no longer blocked; its mentions return only when it sends them again.\n")
            } else {
                format!("{host} was not blocked.\n")
            })
        }
        "prune" => {
            let due = inbox.due_for_deletion(now, receive.retention_days);
            let mut out = format!(
                "{} mention(s) older than {} days are due for deletion (approved mentions are kept).\n",
                due.len(),
                receive.retention_days
            );
            for id in &due {
                out.push_str(&format!("  {id} {}\n", inbox.mentions[id].status.as_str()));
            }
            if options.write {
                for id in &due {
                    inbox.mentions.remove(id);
                }
                save(&inbox)?;
                out.push_str("Deleted.\n");
            } else {
                out.push_str("Dry run: add --write to delete them.\n");
            }
            Ok(out)
        }
        other => Err(format!(
            "`openblog mentions {other}` is not a command; use list, pull, approve, reject, remove, block, unblock or prune"
        )),
    }
}

fn list(inbox: &Inbox, options: &Options) -> Result<String, String> {
    let wanted = match options.status.as_deref() {
        None => None,
        Some(value) => Some(MentionStatus::parse(value).ok_or_else(|| {
            format!(
                "--status must be pending, approved, rejected, removed or blocked, not `{value}`"
            )
        })?),
    };
    let listed: Vec<Listed<'_>> = inbox
        .mentions
        .iter()
        .filter(|(_, mention)| wanted.is_none_or(|status| mention.status == status))
        .map(|(id, mention)| Listed {
            id,
            status: mention.status,
            revision: mention.revision,
            post: &mention.post,
            source: &mention.source,
            host: mention.source_host(),
            reason: mention.reason.as_deref(),
            claimed: &mention.claimed,
        })
        .collect();
    if options.json {
        let mut text = serde_json::to_string_pretty(&serde_json::json!({
            "reportVersion": 1,
            "mentions": listed,
            "blockedHosts": inbox.blocked_hosts,
        }))
        .map_err(|error| error.to_string())?;
        text.push('\n');
        return Ok(text);
    }
    if listed.is_empty() {
        return Ok("No received mentions.\n".into());
    }
    let mut out = String::new();
    for item in &listed {
        out.push_str(&format!(
            "{} {} rev {} {} -> {}\n",
            item.id,
            item.status.as_str(),
            item.revision,
            item.source,
            item.post
        ));
        // Claims are the other site's words: printed as escaped debug text, so a control
        // sequence in a title cannot reach the terminal.
        if let Some(title) = &item.claimed.title {
            out.push_str(&format!("    claims title {title:?}\n"));
        }
        if let Some(author) = &item.claimed.author {
            out.push_str(&format!("    claims author {author:?}\n"));
        }
        if let Some(reason) = item.reason {
            out.push_str(&format!("    reason {reason}\n"));
        }
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn pull(
    root: &Path,
    options: &Options,
    config: &openblog_core::SiteConfig,
    inbox: &mut Inbox,
    hosted: &HostedFactory<'_>,
    network: &dyn Network,
    now: u64,
    save: &dyn Fn(&Inbox) -> Result<bool, String>,
) -> Result<String, String> {
    let receive = &config.webmention.receive;
    if !options.write {
        let state = if receive.endpoint_url().is_some() {
            format!("Receiving is on at {}.", receive.endpoint.trim())
        } else {
            "Receiving is off (webmention.receive.enabled).".to_string()
        };
        return Ok(format!(
            "{state} A dry run contacts nothing: add --write to take the received requests, check each source and queue what links a post for moderation.\n"
        ));
    }
    let hosted = hosted()?;
    let site_url =
        Url::parse(&config.url).map_err(|_| "the site's `url` in openblog.json is invalid")?;
    // Which addresses are posts that accept mentions, as the site is published now.
    let (loaded, _) = site::load_site(root, false, Some(crate::clock::now()))?;
    let posts: std::collections::BTreeMap<String, String> = loaded
        .posts
        .iter()
        .filter(|post| !post.webmentions_off)
        .filter_map(|post| {
            Url::parse(&config.absolute(&post.url))
                .ok()
                .map(|url| (url.to_string(), post.source.replace('\\', "/")))
        })
        .collect();
    let requests = hosted.take(MAX_PULL)?;
    let mut outcomes = Vec::new();
    let mut settled = Vec::new();
    for request in requests {
        let checked = check_request(&request.source, &request.target, &site_url);
        let (outcome, reason) = match checked {
            Err(problem) => (Received::Dropped, Some(problem.code())),
            Ok((_, target)) => match posts.get(target.as_str()) {
                None => (Received::Dropped, Some("not-a-post")),
                Some(post) => {
                    let host = Url::parse(&request.source)
                        .ok()
                        .and_then(|url| url.host_str().map(str::to_string))
                        .unwrap_or_default();
                    if inbox.is_blocked(&host) {
                        // Never fetched: a blocked host learns nothing from us.
                        (Received::Dropped, Some("host-blocked"))
                    } else {
                        let check = check_source(network, &request.source, &target);
                        let code = webmention_inbox::drop_code(&check);
                        let outcome = inbox.receive(
                            &request.source,
                            target.as_str(),
                            post,
                            check,
                            request.received_at,
                            now,
                        );
                        (outcome, (outcome == Received::Dropped).then_some(code))
                    }
                }
            },
        };
        if outcome.settles() {
            settled.push((request.id.clone(), request.version));
        }
        outcomes.push(PullOutcome {
            source: request.source,
            target: request.target,
            outcome,
            reason,
        });
    }
    // The inbox is saved before the hosted copies are deleted, so a pull that stops halfway
    // repeats work on the next run and never loses a request.
    let published_changed = save(inbox)?;
    hosted.settle(&settled)?;
    let report = PullReport {
        report_version: 1,
        enabled: true,
        write: true,
        outcomes,
        published_changed,
    };
    if options.json {
        let mut text = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
        text.push('\n');
        return Ok(text);
    }
    let mut out = format!("Pulled {} request(s).\n", report.outcomes.len());
    for outcome in &report.outcomes {
        out.push_str(&format!(
            "  {:?} {} -> {}{}\n",
            outcome.outcome,
            outcome.source,
            outcome.target,
            outcome
                .reason
                .map(|reason| format!(" ({reason})"))
                .unwrap_or_default()
        ));
    }
    let pending = inbox
        .mentions
        .values()
        .filter(|mention| mention.status == MentionStatus::Pending)
        .count();
    out.push_str(&format!(
        "{pending} mention(s) wait for moderation: `openblog mentions list --status pending`.\n"
    ));
    Ok(out)
}

#[cfg(test)]
mod tests;

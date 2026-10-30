//! Received Webmentions: the private moderation inbox (epic #387, story #402, ADRs 0863 to 0866).
//!
//! Another site tells this one that a page of theirs (`source`) links a post here (`target`). The
//! hosted receiver only checks the two addresses and stores the pair; it never fetches anything.
//! `openblog mentions pull` takes the stored pairs, fetches each source through the public-only
//! fetcher, and hands this module what it found. This module is the pure half: what a request must
//! look like, how a source check changes the inbox, the moderation decisions, blocking, retention
//! and the public projection of approved mentions.
//!
//! What a source page says about itself (its title, the author's name, a date) is a claim, never an
//! identity: only the host that served the page and linked the post is checked. Claimed text is
//! plain text with control characters removed and a length limit, never HTML, and nothing is shown
//! publicly until a moderator approves it at its current revision.
//!
//! Pure: no environment, no network, no clock. Every outcome is a fixed code.

use std::collections::BTreeMap;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::mention_publication::{MentionsFile, PublicMention, MENTIONS_VERSION};

/// The private inbox format this release reads and writes. Another number is refused.
pub const INBOX_VERSION: u32 = 1;
/// The longest `source` or `target` address taken, in bytes.
pub const MAX_URL_BYTES: usize = 2048;
/// The longest claimed title kept, in characters.
pub const MAX_TITLE_CHARS: usize = 200;
/// The longest claimed author name kept, in characters.
pub const MAX_AUTHOR_CHARS: usize = 100;
/// The most pending mentions one source host may have waiting; more are dropped unread.
pub const MAX_PENDING_PER_HOST: usize = 20;
/// The most mentions the inbox holds; a new one beyond it is dropped unread.
pub const MAX_MENTIONS: usize = 5_000;
/// How long a request whose source did not answer is kept in the hosted store for another pull.
pub const UNREACHABLE_GRACE_SECONDS: u64 = 72 * 60 * 60;

/// Why a request is not a Webmention this site takes (W3C Webmention 3.2.1). Fixed codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestProblem {
    /// `source` or `target` is not an absolute `http` or `https` address with a host.
    NotWeb,
    /// An address is longer than [`MAX_URL_BYTES`].
    TooLong,
    /// An address carries a user name or password.
    Credentials,
    /// `source` and `target` are the same address.
    SameAddress,
    /// `target` is not on this site.
    OtherSite,
    /// `source` is on this site.
    OwnSite,
}

impl RequestProblem {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotWeb => "not-web",
            Self::TooLong => "too-long",
            Self::Credentials => "credentials",
            Self::SameAddress => "same-address",
            Self::OtherSite => "other-site",
            Self::OwnSite => "own-site",
        }
    }
}

fn web_url(text: &str) -> Result<Url, RequestProblem> {
    if text.len() > MAX_URL_BYTES {
        return Err(RequestProblem::TooLong);
    }
    let url = Url::parse(text.trim()).map_err(|_| RequestProblem::NotWeb)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(RequestProblem::NotWeb);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(RequestProblem::Credentials);
    }
    Ok(url)
}

fn host_of(url: &Url) -> String {
    url.host_str()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

/// The request checks the hosted receiver makes before storing a pair, made again before a source
/// is fetched: both addresses are web addresses, they differ, the target is on `site` (its origin)
/// and the source is not. The target loses its fragment; the source is kept exactly.
pub fn check_request(source: &str, target: &str, site: &Url) -> Result<(Url, Url), RequestProblem> {
    let source = web_url(source)?;
    let mut target = web_url(target)?;
    target.set_fragment(None);
    let mut bare_source = source.clone();
    bare_source.set_fragment(None);
    if bare_source == target {
        return Err(RequestProblem::SameAddress);
    }
    if target.origin() != site.origin() {
        return Err(RequestProblem::OtherSite);
    }
    if host_of(&source) == host_of(site) {
        return Err(RequestProblem::OwnSite);
    }
    Ok((source, target))
}

/// Whether `host` is `blocked` itself or one of its subdomains.
pub fn host_matches(host: &str, blocked: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let blocked = blocked.trim().trim_end_matches('.').to_ascii_lowercase();
    !blocked.is_empty() && (host == blocked || host.ends_with(&format!(".{blocked}")))
}

/// A host name as a moderator types it to block, or `None` when it is not one.
pub fn normalize_host(input: &str) -> Option<String> {
    let host = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let valid = !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        });
    valid.then_some(host)
}

/// Claimed text as the inbox keeps it: the characters a page's text nodes hold, with control
/// and formatting characters removed, whitespace collapsed and at most `limit` characters.
/// Never markup: the caller gives text, and `<` is just a character that is escaped when shown.
pub fn plain_text(value: &str, limit: usize) -> Option<String> {
    let mut out = String::new();
    let mut space = false;
    for c in value.chars() {
        if c.is_whitespace() {
            space = !out.is_empty();
            continue;
        }
        // Control characters and the bidirectional and zero-width formatting characters, which
        // could make claimed text read differently from what it holds.
        if c.is_control()
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}')
        {
            continue;
        }
        if space {
            out.push(' ');
            space = false;
        }
        out.push(c);
    }
    if out.is_empty() {
        return None;
    }
    if out.chars().count() > limit {
        let mut cut: String = out.chars().take(limit.saturating_sub(1)).collect();
        cut = cut.trim_end().to_string();
        cut.push('…');
        out = cut;
    }
    Some(out)
}

/// What a source page claims about itself. Unverified: shown only as the source's own words.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Claimed {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// A calendar day, `YYYY-MM-DD`, when the page gave one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
}

impl Claimed {
    /// The claims cleaned to what the inbox keeps.
    pub fn new(title: Option<&str>, author: Option<&str>, published: Option<&str>) -> Self {
        Self {
            title: title.and_then(|value| plain_text(value, MAX_TITLE_CHARS)),
            author: author.and_then(|value| plain_text(value, MAX_AUTHOR_CHARS)),
            published: published
                .map(|value| value.trim().chars().take(10).collect::<String>())
                .filter(|day| crate::feedback_publication::is_day(day)),
        }
    }

    fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

/// What fetching one source found (W3C Webmention 3.2.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceCheck {
    /// The source answered 2xx and holds an exact link to the target.
    Links(Claimed),
    /// The source answered 2xx without a link to the target.
    NoLink,
    /// The source answered 2xx with a body that is neither HTML nor plain text, so it was not read.
    Unsupported,
    /// The source answered 410 Gone or 404 Not Found.
    Gone,
    /// No usable answer: timed out, refused, a server error, too many redirects. Tried again.
    Unreachable,
    /// The source, or a redirect, is not a public address. Never connected to.
    NotPublic,
}

/// Where a received mention is. Only `approved` is ever public.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MentionStatus {
    /// Verified and waiting for a moderator.
    Pending,
    /// Approved at its current revision; published.
    Approved,
    /// A moderator declined it, with a reason.
    Rejected,
    /// Taken out of view: by a moderator, or because the source no longer links the post.
    Removed,
    /// Its host is blocked; its claimed text is gone.
    Blocked,
}

impl MentionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::Removed => "removed",
            Self::Blocked => "blocked",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::Pending,
            Self::Approved,
            Self::Rejected,
            Self::Removed,
            Self::Blocked,
        ]
        .into_iter()
        .find(|status| status.as_str() == value)
    }
}

/// A moderator's reason for rejecting or removing a mention. Never a verdict on the other site.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModerationReason {
    Spam,
    Abusive,
    OffTopic,
    Duplicate,
    PersonalData,
    Other,
}

impl ModerationReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Spam => "spam",
            Self::Abusive => "abusive",
            Self::OffTopic => "off-topic",
            Self::Duplicate => "duplicate",
            Self::PersonalData => "personal-data",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::Spam,
            Self::Abusive,
            Self::OffTopic,
            Self::Duplicate,
            Self::PersonalData,
            Self::Other,
        ]
        .into_iter()
        .find(|reason| reason.as_str() == value)
    }
}

/// One received mention in the private inbox.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mention {
    pub source: String,
    pub target: String,
    /// The post's source path in the content folder, such as `posts/hello.md`.
    pub post: String,
    pub status: MentionStatus,
    /// Why it is rejected, removed or blocked: a moderator reason, `link-gone`, `source-gone` or
    /// `host-blocked`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Claimed::is_empty")]
    pub claimed: Claimed,
    /// Raised each time the verified claims change; an approval names the revision it saw.
    pub revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_revision: Option<u32>,
    /// Unix seconds.
    pub received_at: u64,
    pub verified_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<u64>,
}

impl Mention {
    pub fn source_host(&self) -> String {
        Url::parse(&self.source)
            .map(|url| host_of(&url))
            .unwrap_or_default()
    }

    /// Public only when approved at the revision it holds now.
    pub fn is_public(&self) -> bool {
        self.status == MentionStatus::Approved && self.approved_revision == Some(self.revision)
    }
}

/// The stable id of the mention of `target` by `source`: `m-` and 16 hex digits.
pub fn mention_id(source: &str, target: &str) -> String {
    let mut hasher = Blake2s256::new();
    hasher.update(b"openblog-webmention-v1\0");
    hasher.update(source.as_bytes());
    hasher.update([0]);
    hasher.update(target.as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!("m-{hex}")
}

/// The private moderation inbox (`webmention.receive.inboxFile`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inbox {
    pub schema_version: u32,
    pub mentions: BTreeMap<String, Mention>,
    /// Hosts whose requests are dropped unread (a host also covers its subdomains). Private: a
    /// block list is moderation data and is never published.
    #[serde(default)]
    pub blocked_hosts: Vec<String>,
}

impl Default for Inbox {
    fn default() -> Self {
        Self {
            schema_version: INBOX_VERSION,
            mentions: BTreeMap::new(),
            blocked_hosts: Vec::new(),
        }
    }
}

/// What one pulled request did, as a fixed code, and whether the hosted copy may be deleted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Received {
    /// A new mention waits for a moderator.
    Queued,
    /// A known mention was verified again and nothing it shows changed.
    Unchanged,
    /// A known mention's claims changed, so it waits for a moderator again.
    Requeued,
    /// The source no longer links the post (or is gone), so the mention is removed.
    Withdrawn,
    /// Not taken, with nothing kept: invalid, not a post, not linked, blocked, over a limit.
    Dropped,
    /// The source did not answer; the request stays in the hosted store for the next pull.
    Retry,
}

impl Received {
    /// Whether the hosted copy of the request is finished with.
    pub fn settles(self) -> bool {
        self != Self::Retry
    }
}

/// Why a request was dropped, beside [`Received::Dropped`]. Fixed codes.
pub fn drop_code(check: &SourceCheck) -> &'static str {
    match check {
        SourceCheck::Links(_) => "limit",
        SourceCheck::NoLink => "no-link",
        SourceCheck::Unsupported => "unsupported-type",
        SourceCheck::Gone => "source-gone",
        SourceCheck::Unreachable => "unreachable",
        SourceCheck::NotPublic => "not-public",
    }
}

impl Inbox {
    pub fn from_json(text: &str) -> Result<Self, String> {
        let inbox: Self = serde_json::from_str(text).map_err(|_| {
            "the Webmention inbox file is not an inbox this release reads".to_string()
        })?;
        if inbox.schema_version != INBOX_VERSION {
            return Err("the Webmention inbox file has an unsupported schemaVersion".into());
        }
        Ok(inbox)
    }

    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).expect("the inbox is serializable");
        text.push('\n');
        text
    }

    pub fn is_blocked(&self, host: &str) -> bool {
        self.blocked_hosts
            .iter()
            .any(|blocked| host_matches(host, blocked))
    }

    fn pending_from(&self, host: &str) -> usize {
        self.mentions
            .values()
            .filter(|mention| {
                mention.status == MentionStatus::Pending && mention.source_host() == host
            })
            .count()
    }

    /// Records what fetching `source` found for a request on `post`, at `now` (unix seconds).
    /// `received_at` is when the hosted receiver took it. Idempotent: the same pair always lands
    /// on the same mention, so a repeated request is verified again, never added twice.
    pub fn receive(
        &mut self,
        source: &str,
        target: &str,
        post: &str,
        check: SourceCheck,
        received_at: u64,
        now: u64,
    ) -> Received {
        let id = mention_id(source, target);
        let host = Url::parse(source)
            .map(|url| host_of(&url))
            .unwrap_or_default();
        if self.is_blocked(&host) {
            return Received::Dropped;
        }
        match check {
            SourceCheck::Unreachable => {
                if now.saturating_sub(received_at) < UNREACHABLE_GRACE_SECONDS {
                    Received::Retry
                } else {
                    Received::Dropped
                }
            }
            SourceCheck::NotPublic => Received::Dropped,
            SourceCheck::NoLink | SourceCheck::Unsupported | SourceCheck::Gone => {
                let reason = if check == SourceCheck::Gone {
                    "source-gone"
                } else {
                    "link-gone"
                };
                match self.mentions.get_mut(&id) {
                    // The source took the link back (3.2.2): the mention leaves the page at once
                    // and its claimed text with it.
                    Some(mention)
                        if matches!(
                            mention.status,
                            MentionStatus::Pending | MentionStatus::Approved
                        ) =>
                    {
                        mention.status = MentionStatus::Removed;
                        mention.reason = Some(reason.into());
                        mention.claimed = Claimed::default();
                        mention.verified_at = now;
                        mention.decided_at = Some(now);
                        Received::Withdrawn
                    }
                    _ => Received::Dropped,
                }
            }
            SourceCheck::Links(claimed) => match self.mentions.get_mut(&id) {
                Some(mention) => {
                    mention.verified_at = now;
                    mention.received_at = received_at;
                    match mention.status {
                        // A rejection stands however often the source asks again; only a
                        // moderator reopens it.
                        MentionStatus::Rejected => Received::Unchanged,
                        MentionStatus::Approved | MentionStatus::Pending
                            if mention.claimed == claimed =>
                        {
                            Received::Unchanged
                        }
                        // Changed claims, a source that links again after taking it back, or a
                        // host since unblocked: back to a moderator, never shown unreviewed.
                        _ => {
                            mention.claimed = claimed;
                            mention.revision += 1;
                            mention.status = MentionStatus::Pending;
                            mention.reason = None;
                            mention.decided_at = None;
                            Received::Requeued
                        }
                    }
                }
                None => {
                    if self.pending_from(&host) >= MAX_PENDING_PER_HOST
                        || self.mentions.len() >= MAX_MENTIONS
                    {
                        return Received::Dropped;
                    }
                    self.mentions.insert(
                        id,
                        Mention {
                            source: source.into(),
                            target: target.into(),
                            post: post.into(),
                            status: MentionStatus::Pending,
                            reason: None,
                            claimed,
                            revision: 1,
                            approved_revision: None,
                            received_at,
                            verified_at: now,
                            decided_at: None,
                        },
                    );
                    Received::Queued
                }
            },
        }
    }
}

/// A moderator's decision about one mention.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Publish it at the revision the moderator saw.
    Approve {
        revision: u32,
    },
    Reject(ModerationReason),
    Remove(ModerationReason),
}

impl Inbox {
    /// Applies `decision` to mention `id`. Approval names the revision the moderator read, so a
    /// mention whose claims changed since is never approved unseen.
    pub fn decide(&mut self, id: &str, decision: Decision, now: u64) -> Result<(), String> {
        let mention = self
            .mentions
            .get_mut(id)
            .ok_or_else(|| format!("no received mention has the id {id}"))?;
        match decision {
            Decision::Approve { revision } => {
                if !matches!(
                    mention.status,
                    MentionStatus::Pending | MentionStatus::Rejected
                ) {
                    return Err(format!(
                        "{id} is {}; only a pending or rejected mention can be approved",
                        mention.status.as_str()
                    ));
                }
                if revision != mention.revision {
                    return Err(format!(
                        "{id} changed since you read it (revision {} now); read it again before approving",
                        mention.revision
                    ));
                }
                mention.status = MentionStatus::Approved;
                mention.approved_revision = Some(revision);
                mention.reason = None;
            }
            Decision::Reject(reason) => {
                if mention.status != MentionStatus::Pending {
                    return Err(format!(
                        "{id} is {}; only a pending mention can be rejected",
                        mention.status.as_str()
                    ));
                }
                mention.status = MentionStatus::Rejected;
                mention.reason = Some(reason.as_str().into());
            }
            Decision::Remove(reason) => {
                if mention.status != MentionStatus::Approved {
                    return Err(format!(
                        "{id} is {}; only an approved mention can be removed",
                        mention.status.as_str()
                    ));
                }
                mention.status = MentionStatus::Removed;
                mention.reason = Some(reason.as_str().into());
            }
        }
        mention.decided_at = Some(now);
        Ok(())
    }

    /// Blocks `host` and its subdomains: their mentions are blocked at once, published ones
    /// included, and their claimed text is deleted. Returns how many mentions it blocked.
    pub fn block(&mut self, host: &str, now: u64) -> Result<usize, String> {
        let host = normalize_host(host).ok_or_else(|| format!("`{host}` is not a host name"))?;
        if !self.blocked_hosts.contains(&host) {
            self.blocked_hosts.push(host.clone());
            self.blocked_hosts.sort();
        }
        let mut count = 0;
        for mention in self.mentions.values_mut() {
            if host_matches(&mention.source_host(), &host)
                && mention.status != MentionStatus::Blocked
            {
                mention.status = MentionStatus::Blocked;
                mention.reason = Some("host-blocked".into());
                mention.claimed = Claimed::default();
                mention.decided_at = Some(now);
                count += 1;
            }
        }
        Ok(count)
    }

    /// Lifts a block. Blocked mentions stay blocked until their source sends them again.
    pub fn unblock(&mut self, host: &str) -> Result<bool, String> {
        let host = normalize_host(host).ok_or_else(|| format!("`{host}` is not a host name"))?;
        let before = self.blocked_hosts.len();
        self.blocked_hosts.retain(|blocked| blocked != &host);
        Ok(self.blocked_hosts.len() != before)
    }

    /// The mentions retention deletes at `now`: rejected, removed and blocked ones decided more
    /// than `days` ago, and pending ones received more than `days` ago. Approved ones stay.
    pub fn due_for_deletion(&self, now: u64, days: u32) -> Vec<String> {
        let horizon = now.saturating_sub(u64::from(days) * 86_400);
        self.mentions
            .iter()
            .filter(|(_, mention)| match mention.status {
                MentionStatus::Approved => false,
                MentionStatus::Pending => mention.received_at < horizon,
                _ => mention.decided_at.unwrap_or(mention.verified_at) < horizon,
            })
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// The published file: every mention approved at its current revision, by post, then the
    /// day it was approved, then id. Only public facts are copied.
    pub fn published(&self) -> MentionsFile {
        let mut mentions: Vec<(&String, &Mention)> = self
            .mentions
            .iter()
            .filter(|(_, mention)| mention.is_public())
            .collect();
        mentions.sort_by(|(a_id, a), (b_id, b)| {
            (&a.post, a.decided_at, a_id).cmp(&(&b.post, b.decided_at, b_id))
        });
        MentionsFile {
            version: MENTIONS_VERSION,
            mentions: mentions
                .into_iter()
                .map(|(id, mention)| PublicMention {
                    id: id.clone(),
                    post: mention.post.clone(),
                    source: mention.source.clone(),
                    title: mention.claimed.title.clone(),
                    author: mention.claimed.author.clone(),
                    published: mention.claimed.published.clone(),
                    approved: crate::date::DateTime::from_unix(
                        mention.decided_at.unwrap_or(mention.verified_at) as i64,
                    )
                    .ymd(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "https://other.example/notes/1";
    const TARGET: &str = "https://blog.example.org/posts/hello/";
    const POST: &str = "posts/hello.md";
    const HOUR: u64 = 3600;

    fn site() -> Url {
        Url::parse("https://blog.example.org/").unwrap()
    }

    fn links(title: &str) -> SourceCheck {
        SourceCheck::Links(Claimed::new(
            Some(title),
            Some("Ana"),
            Some("2026-10-01T09:00:00Z"),
        ))
    }

    fn queued(inbox: &mut Inbox) -> String {
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, links("A reply"), 100, 200),
            Received::Queued
        );
        mention_id(SOURCE, TARGET)
    }

    #[test]
    fn requests_are_checked_as_the_recommendation_requires() {
        let ok = check_request(SOURCE, "https://blog.example.org/posts/hello/#x", &site()).unwrap();
        assert_eq!(ok.1.as_str(), TARGET);
        let problem =
            |source: &str, target: &str| check_request(source, target, &site()).unwrap_err().code();
        assert_eq!(problem("ftp://other.example/x", TARGET), "not-web");
        assert_eq!(problem("not a url", TARGET), "not-web");
        assert_eq!(problem("https://u:p@other.example/", TARGET), "credentials");
        assert_eq!(problem(TARGET, TARGET), "same-address");
        assert_eq!(
            problem(SOURCE, "https://elsewhere.example/posts/hello/"),
            "other-site"
        );
        assert_eq!(
            problem(SOURCE, "http://blog.example.org/posts/hello/"),
            "other-site"
        );
        assert_eq!(
            problem("https://blog.example.org/other/", TARGET),
            "own-site"
        );
        let long = format!("https://other.example/{}", "a".repeat(MAX_URL_BYTES));
        assert_eq!(problem(&long, TARGET), "too-long");
    }

    #[test]
    fn claimed_text_is_plain_bounded_and_without_formatting_characters() {
        let claimed = Claimed::new(
            Some("  <b>Hi</b>\u{202E}\u{0007}\n\n there  "),
            Some(&"n".repeat(300)),
            Some("not a date"),
        );
        assert_eq!(claimed.title.as_deref(), Some("<b>Hi</b> there"));
        assert_eq!(
            claimed.author.as_ref().unwrap().chars().count(),
            MAX_AUTHOR_CHARS
        );
        assert!(claimed.author.unwrap().ends_with('…'));
        assert_eq!(claimed.published, None);
        assert_eq!(
            Claimed::new(Some(" \u{200B} "), None, Some("2026-10-01")).title,
            None
        );
        assert_eq!(
            Claimed::new(None, None, Some("2026-10-01T09:00:00Z"))
                .published
                .as_deref(),
            Some("2026-10-01")
        );
    }

    #[test]
    fn a_verified_mention_waits_and_a_repeat_lands_on_the_same_one() {
        let mut inbox = Inbox::default();
        let id = queued(&mut inbox);
        assert_eq!(inbox.mentions[&id].status, MentionStatus::Pending);
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, links("A reply"), 300, 400),
            Received::Unchanged
        );
        assert_eq!(inbox.mentions.len(), 1);
        assert_eq!(inbox.mentions[&id].revision, 1);
        assert!(
            inbox.published().mentions.is_empty(),
            "pending is never public"
        );
    }

    #[test]
    fn approval_names_the_revision_and_changed_claims_go_back_to_a_moderator() {
        let mut inbox = Inbox::default();
        let id = queued(&mut inbox);
        inbox
            .decide(&id, Decision::Approve { revision: 1 }, 500)
            .unwrap();
        assert_eq!(inbox.published().mentions.len(), 1);
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, links("Now selling pills"), 600, 700),
            Received::Requeued
        );
        assert_eq!(inbox.mentions[&id].status, MentionStatus::Pending);
        assert!(inbox.published().mentions.is_empty());
        let stale = inbox
            .decide(&id, Decision::Approve { revision: 1 }, 800)
            .unwrap_err();
        assert!(stale.contains("changed since you read it"), "{stale}");
        inbox
            .decide(&id, Decision::Approve { revision: 2 }, 800)
            .unwrap();
        assert_eq!(
            inbox.published().mentions[0].title.as_deref(),
            Some("Now selling pills")
        );
    }

    #[test]
    fn a_source_that_drops_the_link_or_is_gone_withdraws_the_mention_and_its_text() {
        for check in [
            SourceCheck::NoLink,
            SourceCheck::Gone,
            SourceCheck::Unsupported,
        ] {
            let mut inbox = Inbox::default();
            let id = queued(&mut inbox);
            inbox
                .decide(&id, Decision::Approve { revision: 1 }, 300)
                .unwrap();
            assert_eq!(
                inbox.receive(SOURCE, TARGET, POST, check.clone(), 400, 500),
                Received::Withdrawn
            );
            let mention = &inbox.mentions[&id];
            assert_eq!(mention.status, MentionStatus::Removed);
            assert_eq!(mention.claimed, Claimed::default());
            assert!(inbox.published().mentions.is_empty());
            // Linking again starts over with a moderator.
            assert_eq!(
                inbox.receive(SOURCE, TARGET, POST, links("Back"), 600, 700),
                Received::Requeued
            );
            assert_eq!(inbox.mentions[&id].status, MentionStatus::Pending);
        }
        let mut empty = Inbox::default();
        assert_eq!(
            empty.receive(SOURCE, TARGET, POST, SourceCheck::NoLink, 1, 2),
            Received::Dropped
        );
        assert!(
            empty.mentions.is_empty(),
            "an unlinked request keeps nothing"
        );
    }

    #[test]
    fn an_unreachable_source_is_retried_for_three_days_and_a_private_one_never() {
        let mut inbox = Inbox::default();
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, SourceCheck::Unreachable, 0, HOUR),
            Received::Retry
        );
        assert!(!Received::Retry.settles());
        assert_eq!(
            inbox.receive(
                SOURCE,
                TARGET,
                POST,
                SourceCheck::Unreachable,
                0,
                UNREACHABLE_GRACE_SECONDS
            ),
            Received::Dropped
        );
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, SourceCheck::NotPublic, 0, 1),
            Received::Dropped
        );
        assert!(inbox.mentions.is_empty());
    }

    #[test]
    fn a_rejection_stands_against_repeats_and_one_host_cannot_flood_the_queue() {
        let mut inbox = Inbox::default();
        let id = queued(&mut inbox);
        inbox
            .decide(&id, Decision::Reject(ModerationReason::Spam), 300)
            .unwrap();
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, links("Again"), 400, 500),
            Received::Unchanged
        );
        assert_eq!(inbox.mentions[&id].status, MentionStatus::Rejected);
        let mut flood = Inbox::default();
        for n in 0..MAX_PENDING_PER_HOST + 3 {
            flood.receive(
                &format!("https://spam.example/{n}"),
                TARGET,
                POST,
                links("x"),
                1,
                2,
            );
        }
        assert_eq!(flood.mentions.len(), MAX_PENDING_PER_HOST);
        assert_eq!(
            flood.receive("https://fine.example/1", TARGET, POST, links("x"), 1, 2),
            Received::Queued
        );
    }

    #[test]
    fn decisions_follow_the_states() {
        let mut inbox = Inbox::default();
        let id = queued(&mut inbox);
        assert!(inbox
            .decide(&id, Decision::Remove(ModerationReason::Other), 1)
            .is_err());
        inbox
            .decide(&id, Decision::Approve { revision: 1 }, 2)
            .unwrap();
        assert!(inbox
            .decide(&id, Decision::Reject(ModerationReason::Spam), 3)
            .is_err());
        inbox
            .decide(&id, Decision::Remove(ModerationReason::Abusive), 4)
            .unwrap();
        assert_eq!(inbox.mentions[&id].reason.as_deref(), Some("abusive"));
        assert!(inbox
            .decide(&id, Decision::Approve { revision: 1 }, 5)
            .is_err());
        assert!(inbox
            .decide("m-0000", Decision::Approve { revision: 1 }, 5)
            .is_err());
    }

    #[test]
    fn blocking_a_host_hides_its_mentions_at_once_and_drops_its_requests_unread() {
        let mut inbox = Inbox::default();
        let id = queued(&mut inbox);
        inbox
            .decide(&id, Decision::Approve { revision: 1 }, 2)
            .unwrap();
        assert_eq!(inbox.block("Other.Example.", 3).unwrap(), 1);
        assert_eq!(inbox.mentions[&id].status, MentionStatus::Blocked);
        assert_eq!(inbox.mentions[&id].claimed, Claimed::default());
        assert!(inbox.published().mentions.is_empty());
        assert_eq!(
            inbox.receive(
                "https://sub.other.example/x",
                TARGET,
                POST,
                links("x"),
                4,
                5
            ),
            Received::Dropped
        );
        assert!(inbox.block("not a host!", 6).is_err());
        assert!(inbox.unblock("other.example").unwrap());
        assert_eq!(
            inbox.receive(SOURCE, TARGET, POST, links("x"), 7, 8),
            Received::Requeued
        );
    }

    #[test]
    fn retention_deletes_what_is_closed_or_stale_and_never_an_approved_mention() {
        let day = 86_400;
        let mut inbox = Inbox::default();
        let id = queued(&mut inbox);
        inbox.receive("https://b.example/1", TARGET, POST, links("b"), 0, 0);
        inbox.receive("https://c.example/1", TARGET, POST, links("c"), 0, 0);
        let b = mention_id("https://b.example/1", TARGET);
        inbox
            .decide(&id, Decision::Approve { revision: 1 }, 0)
            .unwrap();
        inbox
            .decide(&b, Decision::Reject(ModerationReason::Spam), 0)
            .unwrap();
        assert!(inbox.due_for_deletion(10 * day, 90).is_empty());
        let due = inbox.due_for_deletion(100 * day, 90);
        assert_eq!(due.len(), 2);
        assert!(!due.contains(&id));
    }

    #[test]
    fn the_inbox_file_round_trips_and_refuses_another_version() {
        let mut inbox = Inbox::default();
        queued(&mut inbox);
        inbox.block("spam.example", 1).unwrap();
        assert_eq!(Inbox::from_json(&inbox.to_json()).unwrap(), inbox);
        assert!(Inbox::from_json(r#"{"schemaVersion":2,"mentions":{}}"#).is_err());
        assert!(Inbox::from_json(r#"{"schemaVersion":1,"mentions":{},"extra":1}"#).is_err());
    }
}

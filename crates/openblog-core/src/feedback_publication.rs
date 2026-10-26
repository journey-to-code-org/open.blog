//! Approved reader feedback as the site publishes it (ADR 0083).
//!
//! When a moderator approves a piece of passage feedback, Admin copies its
//! public part into `reader-feedback.json` in the content folder, beside the
//! posts. The file is versioned with the site, so a static build, a CI build
//! and a portable export never need the hosted service, and the author's
//! response to each note lives in the same file.
//!
//! The file holds only what may be public, because a site's repository can
//! be: the kind, the text and details the reader sent, the passage target and
//! the revision they saw, the day it was received and the day it was
//! approved, the reader's name only when they agreed to show it, and the
//! author's response. Never the reader's clock, a time of day, the channel, a
//! private name, a moderation reason or anything about a rejected or pending
//! submission.
//!
//! A post publishes its approved feedback through [`project`], which reads
//! every note's provenance through the one public projection
//! ([`crate::feedback_provenance::FeedbackProvenance::public`]): the quoted
//! words appear only while the post still publishes them. Only the canonical
//! page shows the notes; portable copies and feeds carry a labelled link to
//! it instead (P6.2).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::date::DateTime;
use crate::escape::{attr, text};
use crate::feedback_provenance::{
    FeedbackChannel, FeedbackProvenance, PublicProvenance, ReaderAttribution, MAX_READER_NAME_CHARS,
};
use crate::model::Post;
use crate::passage_target::{
    normalize_passage_text, PassageDocument, PassageSelector, PassageTarget,
};
use crate::scholarly_feedback::{
    is_uuid, reader_text, FeedbackDetails, FeedbackKind, FeedbackSubmission, ScholarlyFeedback,
};

/// The file's name, in the content folder.
pub const READER_FEEDBACK_FILE: &str = "reader-feedback.json";
/// The version of the file format; a reader refuses a higher one.
pub const READER_FEEDBACK_VERSION: u64 = 1;
/// The id of the section of a post's canonical page that lists its notes.
pub const READER_FEEDBACK_ANCHOR: &str = "ob-reader-feedback";
/// The most notes the file holds.
pub const MAX_PUBLISHED_FEEDBACK: usize = 2_000;
/// The largest file accepted, before it is parsed.
pub const MAX_READER_FEEDBACK_BYTES: usize = 8 * 1024 * 1024;
/// The longest author response.
pub const MAX_RESPONSE_CHARS: usize = 4_000;

/// The author's public response to one note.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorResponse {
    pub text: String,
    /// `YYYY-MM-DD`, by the author's clock.
    pub date: String,
}

/// One approved note as the file stores it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishedFeedback {
    /// The hosted item's id, so the same note is never published twice.
    pub id: String,
    /// The post's source path in the content folder, such as
    /// `posts/tides.md`; it survives a change of slug.
    pub post: String,
    /// The address the reader saw.
    pub work: String,
    pub kind: FeedbackKind,
    pub body: String,
    pub details: FeedbackDetails,
    /// The passage revision the reader saw.
    pub revision: String,
    pub target: PassageTarget,
    /// The day the site received it, `YYYY-MM-DD`.
    pub received: String,
    /// The day it was approved, `YYYY-MM-DD`.
    pub approved: String,
    /// The reader's name, present only when they agreed to show it.
    pub name: Option<String>,
    pub response: Option<AuthorResponse>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireItem {
    id: String,
    post: String,
    work: String,
    kind: String,
    body: String,
    #[serde(default, skip_serializing_if = "is_empty_details")]
    details: FeedbackDetails,
    revision: String,
    target: Value,
    received: String,
    approved: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    response: Option<AuthorResponse>,
}

fn is_empty_details(details: &FeedbackDetails) -> bool {
    *details == FeedbackDetails::default()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireFile {
    #[allow(dead_code)]
    version: u64,
    items: Vec<Value>,
}

/// A calendar day written `YYYY-MM-DD`.
pub fn is_day(value: &str) -> bool {
    value.len() == 10
        && value
            .bytes()
            .enumerate()
            .all(|(at, byte)| matches!(at, 4 | 7) == (byte == b'-'))
        && value.bytes().filter(u8::is_ascii_digit).count() == 8
        && !value.starts_with("0000")
        && DateTime::parse(value).is_some_and(|day| day.ymd() == value)
}

/// A post's source path in the content folder: a Markdown post, written
/// with `/`, with no empty, dot or parent segment.
pub fn is_post_source(value: &str) -> bool {
    (3..=500).contains(&value.len())
        && crate::classify_source(value) == Some(crate::SourceKind::Post)
        && !value.starts_with('/')
        && !value
            .chars()
            .any(|c| c == '\\' || c.is_control() || c == ':')
        && value
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// The author's response text: plain text of 1 to [`MAX_RESPONSE_CHARS`]
/// characters, trimmed, with the reader-text rules (ADR 0079).
pub fn response_text(value: &str) -> Option<String> {
    reader_text(value, MAX_RESPONSE_CHARS)
}

impl PublishedFeedback {
    /// The public part of an approved record, for the post at `post`. The
    /// reader's name is kept only with their agreement; their clock, the
    /// time of day and the channel are dropped.
    pub fn from_record(
        id: &str,
        post: &str,
        record: &ScholarlyFeedback,
        approved: DateTime,
    ) -> Result<Self, String> {
        let provenance = &record.provenance;
        let item = Self {
            id: id.to_ascii_lowercase(),
            post: post.to_string(),
            work: provenance.work.clone(),
            kind: record.kind,
            body: record.body.clone(),
            details: record.details.clone(),
            revision: provenance.revision.clone(),
            target: provenance.target.clone(),
            received: provenance.received_at.ymd(),
            approved: approved.ymd().max(provenance.received_at.ymd()),
            name: provenance.attribution.public_name().map(str::to_string),
            response: None,
        };
        item.validate()?;
        Ok(item)
    }

    fn validate(&self) -> Result<(), String> {
        if !is_uuid(&self.id) || self.id != self.id.to_ascii_lowercase() {
            return Err("`id` must be a lowercase UUID".into());
        }
        if !is_post_source(&self.post) {
            return Err(
                "`post` must be a post's source path in the content folder, such as posts/tides.md"
                    .into(),
            );
        }
        let submission = json!({
            "version": 1,
            "kind": self.kind.id(),
            "work": self.work,
            "revision": self.revision,
            "target": self.target.to_value(),
            "body": self.body,
            "details": serde_json::to_value(&self.details).expect("details serialize"),
        });
        let checked =
            FeedbackSubmission::from_value(&submission).map_err(|error| error.message.clone())?;
        if checked.body != self.body || checked.details != self.details {
            return Err("holds text or a link that is not in its stored form".into());
        }
        if !is_day(&self.received) || !is_day(&self.approved) {
            return Err("`received` and `approved` must be days written YYYY-MM-DD".into());
        }
        if self.approved < self.received {
            return Err("`approved` is earlier than `received`".into());
        }
        if let Some(name) = &self.name {
            let count = name.chars().count();
            if count == 0
                || count > MAX_READER_NAME_CHARS
                || normalize_passage_text(name) != *name
                || name
                    .chars()
                    .any(|c| c.is_control() || crate::research_notes::bidi_override(c))
            {
                return Err(format!(
                    "`name` must be 1 to {MAX_READER_NAME_CHARS} characters of plain text"
                ));
            }
        }
        if let Some(response) = &self.response {
            if response_text(&response.text).as_deref() != Some(response.text.as_str()) {
                return Err(format!(
                    "`response.text` must be 1 to {MAX_RESPONSE_CHARS} characters of plain text"
                ));
            }
            if !is_day(&response.date) {
                return Err("`response.date` must be a day written YYYY-MM-DD".into());
            }
        }
        Ok(())
    }

    fn from_value(value: &Value) -> Result<Self, String> {
        let wire: WireItem = serde_json::from_value(value.clone()).map_err(|_| {
            "has a field this version does not define, or a field of the wrong type".to_string()
        })?;
        let kind = FeedbackKind::from_id(&wire.kind)
            .ok_or_else(|| "`kind` is not a kind of feedback this version knows".to_string())?;
        let target = PassageTarget::from_value(&wire.target)
            .map_err(|error| format!("`target`: {}", error.message))?;
        let item = Self {
            id: wire.id,
            post: wire.post,
            work: wire.work,
            kind,
            body: wire.body,
            details: wire.details,
            revision: wire.revision,
            target,
            received: wire.received,
            approved: wire.approved,
            name: wire.name,
            response: wire.response,
        };
        item.validate()?;
        Ok(item)
    }

    fn to_wire(&self) -> WireItem {
        WireItem {
            id: self.id.clone(),
            post: self.post.clone(),
            work: self.work.clone(),
            kind: self.kind.id().to_string(),
            body: self.body.clone(),
            details: self.details.clone(),
            revision: self.revision.clone(),
            target: self.target.to_value(),
            received: self.received.clone(),
            approved: self.approved.clone(),
            name: self.name.clone(),
            response: self.response.clone(),
        }
    }

    /// The provenance this note publishes, for the public projection. Only
    /// the received day and a consented name were kept, so those are all it
    /// can show.
    fn provenance(&self) -> FeedbackProvenance {
        FeedbackProvenance {
            work: self.work.clone(),
            revision: self.revision.clone(),
            target: self.target.clone(),
            seen_at: None,
            received_at: DateTime::parse(&self.received).expect("validated day"),
            channel: FeedbackChannel::Hosted,
            attribution: ReaderAttribution {
                name: self.name.clone(),
                publish_name: self.name.is_some(),
            },
        }
    }
}

/// Every approved note the site publishes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReaderFeedbackFile {
    pub items: Vec<PublishedFeedback>,
}

impl ReaderFeedbackFile {
    /// Read the file, refusing a newer version, an unknown field or any
    /// broken rule, naming the item. Nothing is repaired or dropped.
    pub fn from_json(text: &str) -> Result<Self, String> {
        if text.len() > MAX_READER_FEEDBACK_BYTES {
            return Err(format!("is larger than {MAX_READER_FEEDBACK_BYTES} bytes"));
        }
        let value: Value =
            serde_json::from_str(text).map_err(|_| "is not valid JSON".to_string())?;
        match value.get("version").and_then(Value::as_u64) {
            Some(READER_FEEDBACK_VERSION) => {}
            Some(version) if version > READER_FEEDBACK_VERSION => {
                return Err(format!(
                    "is version {version}, newer than the version {READER_FEEDBACK_VERSION} this open.blog reads"
                ))
            }
            _ => return Err("needs `version` 1".into()),
        }
        let wire: WireFile = serde_json::from_value(value)
            .map_err(|_| "needs only `version` and an `items` list".to_string())?;
        if wire.items.len() > MAX_PUBLISHED_FEEDBACK {
            return Err(format!(
                "has {} items; keep at most {MAX_PUBLISHED_FEEDBACK}",
                wire.items.len()
            ));
        }
        let mut items = Vec::with_capacity(wire.items.len());
        let mut ids = std::collections::BTreeSet::new();
        for (index, value) in wire.items.iter().enumerate() {
            let item = PublishedFeedback::from_value(value)
                .map_err(|error| format!("item {}: {error}", index + 1))?;
            if !ids.insert(item.id.clone()) {
                return Err(format!(
                    "item {}: repeats the id of an earlier item",
                    index + 1
                ));
            }
            items.push(item);
        }
        Ok(Self { items })
    }

    /// Canonical text: items sorted by post, day received and id, two-space
    /// indentation and a final line break, so a change shows as a small diff.
    pub fn to_json(&self) -> String {
        let mut items: Vec<&PublishedFeedback> = self.items.iter().collect();
        items.sort_by(|a, b| {
            (a.post.as_str(), a.received.as_str(), a.id.as_str()).cmp(&(
                b.post.as_str(),
                b.received.as_str(),
                b.id.as_str(),
            ))
        });
        let value = json!({
            "version": READER_FEEDBACK_VERSION,
            "items": items.iter().map(|item| item.to_wire()).collect::<Vec<_>>(),
        });
        let mut out = serde_json::to_string_pretty(&value).expect("reader feedback serializes");
        out.push('\n');
        out
    }

    pub fn get(&self, id: &str) -> Option<&PublishedFeedback> {
        self.items.iter().find(|item| item.id == id)
    }

    /// Add a note, or replace the public part of one already published while
    /// keeping the author's response.
    pub fn publish(&mut self, mut item: PublishedFeedback) -> Result<(), String> {
        if let Some(existing) = self
            .items
            .iter_mut()
            .find(|existing| existing.id == item.id)
        {
            item.response = existing.response.take();
            *existing = item;
            return Ok(());
        }
        if self.items.len() >= MAX_PUBLISHED_FEEDBACK {
            return Err(format!(
                "the site already publishes {MAX_PUBLISHED_FEEDBACK} notes"
            ));
        }
        self.items.push(item);
        Ok(())
    }

    /// Take a note off the site; whether it was there.
    pub fn unpublish(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|item| item.id != id);
        self.items.len() != before
    }

    /// Set or clear the author's response to a published note.
    pub fn respond(
        &mut self,
        id: &str,
        response: Option<&str>,
        today: DateTime,
    ) -> Result<(), String> {
        let item = self
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| "That note is not published on the site.".to_string())?;
        item.response = match response.map(str::trim).filter(|text| !text.is_empty()) {
            None => None,
            Some(text) => Some(AuthorResponse {
                text: response_text(text).ok_or_else(|| {
                    format!("Write a response of at most {MAX_RESPONSE_CHARS} characters, without control characters.")
                })?,
                date: today.ymd(),
            }),
        };
        Ok(())
    }

    /// The notes about one post, in the order the post lists them.
    pub fn for_post(&self, source: &str) -> Vec<&PublishedFeedback> {
        let mut items: Vec<&PublishedFeedback> = self
            .items
            .iter()
            .filter(|item| item.post == source)
            .collect();
        items.sort_by(|a, b| (&a.received, &a.id).cmp(&(&b.received, &b.id)));
        items
    }
}

/// One note as a post's canonical page shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicFeedback {
    pub id: String,
    pub kind: FeedbackKind,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_text: Option<String>,
    /// Whether the note is about the whole post.
    pub whole_post: bool,
    pub provenance: PublicProvenance,
    /// The heading title of the section the passage is in, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<AuthorResponse>,
}

/// The public form of a post's approved notes, read against the post as it
/// is published now.
pub fn project(
    items: &[&PublishedFeedback],
    post: &Post,
    document: &PassageDocument,
) -> Vec<PublicFeedback> {
    let titles = crate::feedback_moderation::section_titles(post, document);
    items
        .iter()
        .map(|item| {
            let provenance = item.provenance();
            let public = provenance.public(document);
            let resolution = provenance.resolve(document);
            let section_title = match resolution.location() {
                Some(location) => location
                    .index
                    .and_then(|index| titles.get(index).cloned().flatten()),
                None => public.section.as_deref().and_then(|anchor| {
                    document
                        .sections
                        .iter()
                        .position(|section| section.anchor.as_deref() == Some(anchor))
                        .and_then(|index| titles.get(index).cloned().flatten())
                }),
            };
            PublicFeedback {
                id: item.id.clone(),
                kind: item.kind,
                body: item.body.clone(),
                source_url: item.details.source_url.clone(),
                suggested_text: item.details.suggested_text.clone(),
                whole_post: matches!(item.target.selector, PassageSelector::Work),
                provenance: public,
                section_title,
                response: item.response.clone(),
            }
        })
        .collect()
}

fn paragraphs(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .map(|paragraph| {
            format!(
                "<p>{}</p>",
                paragraph
                    .split('\n')
                    .map(text)
                    .collect::<Vec<_>>()
                    .join("<br>\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The section of a post's canonical page that lists its approved notes:
/// static, semantic HTML that needs no script. Every value is escaped; a
/// suggested source is a plain link marked as reader-supplied.
pub fn render_section(items: &[PublicFeedback]) -> String {
    if items.is_empty() {
        return String::new();
    }
    let mut html = format!(
        "<section id=\"{READER_FEEDBACK_ANCHOR}\" class=\"ob-reader-feedback\" aria-labelledby=\"{READER_FEEDBACK_ANCHOR}-title\">\n<h2 id=\"{READER_FEEDBACK_ANCHOR}-title\">Reader questions and responses</h2>\n<p>Notes readers sent about this post that the author chose to publish, with the author’s responses. Publishing a note does not mean the author agrees with it.</p>\n<ol class=\"ob-reader-feedback-list\">\n"
    );
    for item in items {
        let id = format!("ob-reader-note-{}", attr(&item.id));
        let place = if item.whole_post {
            "about the whole post".to_string()
        } else {
            match (&item.provenance.section, &item.section_title) {
                (Some(anchor), title) => format!(
                    "about <a href=\"#{}\">{}</a>{}",
                    attr(anchor),
                    text(title.as_deref().unwrap_or(anchor)),
                    if item.provenance.stale {
                        ", since revised"
                    } else {
                        ""
                    }
                ),
                (None, _) if item.provenance.stale => "about a passage since revised".to_string(),
                (None, _) => "about the opening".to_string(),
            }
        };
        html.push_str(&format!(
            "<li><article class=\"ob-reader-note\" id=\"{id}\" aria-labelledby=\"{id}-title\">\n<h3 id=\"{id}-title\">{} {place}</h3>\n",
            text(item.kind.label())
        ));
        if let Some(quote) = &item.provenance.quote {
            html.push_str(&format!(
                "<blockquote class=\"ob-reader-note-quote\"><p>{}</p></blockquote>\n",
                text(quote)
            ));
        } else if item.provenance.stale {
            html.push_str("<p class=\"ob-reader-note-stale\">The post has changed since this note was sent, so the words it was about are not quoted here.</p>\n");
        }
        html.push_str(&paragraphs(&item.body));
        html.push('\n');
        if let Some(url) = &item.source_url {
            html.push_str(&format!(
                "<p class=\"ob-reader-note-source\">Source the reader suggested: <a href=\"{}\" rel=\"nofollow ugc noopener noreferrer\">{}</a></p>\n",
                attr(url),
                text(url)
            ));
        }
        if let Some(suggested) = &item.suggested_text {
            html.push_str(&format!(
                "<div class=\"ob-reader-note-suggestion\">\n<p>Wording the reader suggested:</p>\n<blockquote>{}</blockquote>\n</div>\n",
                paragraphs(suggested)
            ));
        }
        let from = match &item.provenance.name {
            Some(name) => format!("From {}", text(name)),
            None => "From a reader".to_string(),
        };
        html.push_str(&format!(
            "<p class=\"ob-reader-note-meta\">{from} · received <time datetime=\"{0}\">{0}</time> · about passage revision <code>{1}</code></p>\n",
            attr(&item.provenance.received),
            text(&item.provenance.revision)
        ));
        if let Some(response) = &item.response {
            html.push_str(&format!(
                "<div class=\"ob-reader-note-response\">\n<h4>The author’s response <time datetime=\"{0}\">{0}</time></h4>\n{1}\n</div>\n",
                attr(&response.date),
                paragraphs(&response.text)
            ));
        }
        html.push_str("</article></li>\n");
    }
    html.push_str("</ol>\n</section>\n");
    html
}

//! The public research-context projection for Reader Discovery (#197,
//! ADR 0250 to ADR 0254).
//!
//! [`CuratedContext`] is a bounded, deterministic reading of the one public
//! curated value ([`PublicCuration`], ADR 0215) shaped to be fetched and
//! reused: every published selection with its attribution, uncertainty,
//! evidence and the revision that was selected, the context each one needs,
//! and, for each published post, the items it is offered in the author's
//! order with the canonical anchor of each on that post's page. It is derived
//! from that value and from nothing else, so it can never reach a private
//! object: it takes no selections file, notebook, library or atlas. Adding a
//! field to a selection publishes nothing here until the selection projection
//! publishes it.
//!
//! The same value renders the static section of each post's page
//! ([`CuratedContext::post_section_html`]), so the page is complete without
//! JavaScript and the data file and the page can never disagree. Nothing in
//! either says a relationship is true, agreed or authoritative: attribution,
//! doubt, dissent and evidence travel with every item, and a detail the
//! source lacks is listed as not recorded, never invented.
//!
//! The file is bounded ([`MAX_BYTES`], [`MAX_LISTED_POSTS`]) and a projection
//! over a bound, or one that does not agree with itself, is refused as a
//! whole, naming the limit and ids and never an item's text. The posts'
//! pages are unaffected: the page section is bounded by the selections file
//! itself and stays the complete fallback.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use serde_json::Value;

use crate::atlas_publication::escaped_json;
pub use crate::atlas_query::RefusalKind;
use crate::curated_selection::{
    ContextItem, ContextKind, CuratedItem, PublicCuration, SelectionKind, CURATED_FORMAT_VERSION,
};
use crate::escape::{attr, text};

/// The `format` of the artifact. It is not the public curated value's own
/// format ([`crate::curated_selection::CURATED_FORMAT`]): the file is a projection of that value (the
/// selected items plus the posts' anchors), not the value itself, so a reader
/// told one is never handed the other (ADR 0250).
pub const FILE_FORMAT: &str = "openblog-curated-context-file";
/// The artifact, relative to the site root.
pub const CURATED_CONTEXT_JSON_FILE: &str = "curated-context.json";
/// The prefix of the anchor each curated item has on a post's page, followed
/// by the selection id. A selection id is a lowercase slug, so the anchor is
/// a valid, stable fragment. It is in the reserved `ob-` family: no heading id
/// of the post can have it (ADR 0250).
pub const ANCHOR_PREFIX: &str = "ob-curated-";
/// The id of the section on a post's page that holds the curated context.
pub const SECTION_ID: &str = "ob-research-context";
/// Largest serialized artifact, in bytes, after the base path.
pub const MAX_BYTES: usize = 1024 * 1024;
/// Most posts the artifact lists.
pub const MAX_LISTED_POSTS: usize = 2_000;
/// Most items one post's page section shows. A post offered more has the rest
/// in the data file, and its page says so (ADR 0251): the page stays bounded
/// however large the selections file is.
pub const MAX_PAGE_ITEMS: usize = 1_000;
/// Deepest nesting of a field value shown on a page.
const MAX_DEPTH: usize = 4;

/// A refused projection: which kind, and a message naming limits and ids
/// only, never an item's text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextRefusal {
    pub kind: RefusalKind,
    pub message: String,
}

impl std::fmt::Display for ContextRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// A published post, by what the artifact needs of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PostRef<'a> {
    pub slug: &'a str,
    /// Its canonical root-relative address.
    pub url: &'a str,
}

/// One item as one post offers it: the selection and where it sits on the page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    pub id: String,
    /// The canonical anchor: the post's address and the item's fragment.
    pub url: String,
}

/// A piece of context one post's items need.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRef {
    pub kind: ContextKind,
    pub id: String,
}

/// What one published post offers its readers, in the author's order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostContext {
    pub post: String,
    pub url: String,
    pub items: Vec<ItemRef>,
    pub context: Vec<ContextRef>,
}

/// The public research-context projection.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratedContext {
    pub format: &'static str,
    pub format_version: u64,
    /// The root-relative address of the section on a post's page and the
    /// prefix of each item's fragment, so a consumer never guesses either.
    pub section: &'static str,
    pub anchor_prefix: &'static str,
    /// Every published selection, whole-site first, then by first post and
    /// the author's order there.
    pub items: Vec<CuratedItem>,
    /// Sorted by kind then id; never holds a selected item twice.
    pub context: Vec<ContextItem>,
    /// Sorted by post slug; only posts that offer at least one item.
    pub posts: Vec<PostContext>,
    /// Lookups by id and by (kind, id or target), so rendering a post never
    /// scans the whole file for each reference.
    #[serde(skip)]
    index: Index,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Index {
    items: BTreeMap<String, usize>,
    context: BTreeMap<(ContextKind, String), usize>,
    /// The first selected item of each (kind, target).
    targets: BTreeMap<(SelectionKind, String), usize>,
}

impl Index {
    fn of(items: &[CuratedItem], context: &[ContextItem]) -> Self {
        let mut index = Self::default();
        for (at, item) in items.iter().enumerate() {
            index.items.entry(item.id.clone()).or_insert(at);
            index
                .targets
                .entry((item.kind, item.target.clone()))
                .or_insert(at);
        }
        for (at, item) in context.iter().enumerate() {
            index
                .context
                .entry((item.kind, item.id.clone()))
                .or_insert(at);
        }
        index
    }
}

fn refuse(kind: RefusalKind, message: String) -> ContextRefusal {
    ContextRefusal { kind, message }
}

impl CuratedContext {
    /// Project the one public curated value over the posts this build
    /// publishes. `base_path` is put in front of every root-relative address
    /// when the file is written, so it counts toward the size bound.
    pub fn project(
        curation: &PublicCuration,
        posts: &[PostRef<'_>],
        base_path: &str,
    ) -> Result<Self, ContextRefusal> {
        let published: BTreeMap<&str, &str> =
            posts.iter().map(|post| (post.slug, post.url)).collect();
        let mut seen = BTreeSet::new();
        for item in &curation.items {
            if !seen.insert(item.id.as_str()) {
                return Err(refuse(
                    RefusalKind::Inconsistent,
                    format!(
                        "the curated item `{}` is published twice, so the curated context file is not written",
                        item.id
                    ),
                ));
            }
        }
        for item in &curation.items {
            if let Some(missing) = item.requires.iter().find(|id| !seen.contains(id.as_str())) {
                return Err(refuse(
                    RefusalKind::Inconsistent,
                    format!(
                        "the curated item `{}` requires `{missing}`, which is not published",
                        item.id
                    ),
                ));
            }
            if let Some(post) = item
                .posts
                .iter()
                .find(|p| !published.contains_key(p.as_str()))
            {
                return Err(refuse(
                    RefusalKind::Inconsistent,
                    format!(
                        "the curated item `{}` names the post `{post}`, which this build does not publish",
                        item.id
                    ),
                ));
            }
        }
        for context in &curation.context {
            if let Some(via) = context.via.iter().find(|id| !seen.contains(id.as_str())) {
                return Err(refuse(
                    RefusalKind::Inconsistent,
                    format!(
                        "the {} `{}` is context for `{via}`, which is not published",
                        context_noun(context.kind),
                        context.id
                    ),
                ));
            }
        }
        let mut listed = Vec::new();
        for post in posts {
            let view = curation.view_for(Some(post.slug));
            if view.items.is_empty() {
                continue;
            }
            listed.push(PostContext {
                post: post.slug.to_string(),
                url: post.url.to_string(),
                items: view
                    .items
                    .iter()
                    .map(|item| ItemRef {
                        id: item.id.clone(),
                        url: format!("{}#{ANCHOR_PREFIX}{}", post.url, item.id),
                    })
                    .collect(),
                context: view
                    .context
                    .iter()
                    .map(|context| ContextRef {
                        kind: context.kind,
                        id: context.id.clone(),
                    })
                    .collect(),
            });
        }
        listed.sort_by(|a, b| a.post.cmp(&b.post));
        listed.dedup_by(|a, b| a.post == b.post);
        if listed.len() > MAX_LISTED_POSTS {
            return Err(refuse(
                RefusalKind::OverLimit,
                format!(
                    "{} posts offer curated context, over the limit of {MAX_LISTED_POSTS}",
                    listed.len()
                ),
            ));
        }
        let file = Self {
            format: FILE_FORMAT,
            format_version: CURATED_FORMAT_VERSION,
            section: SECTION_ID,
            anchor_prefix: ANCHOR_PREFIX,
            index: Index::of(&curation.items, &curation.context),
            items: curation.items.clone(),
            context: curation.context.clone(),
            posts: listed,
        };
        let json = file.to_json();
        let size = json.len() + json.matches("\"url\":\"/").count() * base_path.len();
        if size > MAX_BYTES {
            return Err(refuse(
                RefusalKind::OverLimit,
                format!(
                    "the curated context projection is {size} bytes as published, over the limit of {MAX_BYTES}"
                ),
            ));
        }
        Ok(file)
    }

    /// The file as the build writes it: compact, deterministic, and safe to
    /// embed (`<`, `>` and `&` are escaped).
    pub fn to_json(&self) -> String {
        escaped_json(self)
    }

    pub fn item(&self, id: &str) -> Option<&CuratedItem> {
        self.index.items.get(id).map(|at| &self.items[*at])
    }

    /// What one post offers, when it offers anything.
    pub fn for_post(&self, slug: &str) -> Option<&PostContext> {
        self.posts
            .binary_search_by(|post| post.post.as_str().cmp(slug))
            .ok()
            .map(|at| &self.posts[at])
    }

    fn context_item(&self, kind: ContextKind, id: &str) -> Option<&ContextItem> {
        self.index
            .context
            .get(&(kind, id.to_string()))
            .map(|at| &self.context[*at])
    }

    /// The first selected item of a kind about a target.
    fn selected(&self, kind: SelectionKind, target: &str) -> Option<&CuratedItem> {
        self.index
            .targets
            .get(&(kind, target.to_string()))
            .map(|at| &self.items[*at])
    }

    /// The projection for one post alone, when the whole file is not written
    /// (a bound, or an inconsistency): the page still carries what its post
    /// is offered, from the same public value.
    pub fn for_one_post(curation: &PublicCuration, post: PostRef<'_>) -> Option<Self> {
        let view = curation.view_for(Some(post.slug));
        if view.items.is_empty() {
            return None;
        }
        Some(Self {
            format: FILE_FORMAT,
            format_version: CURATED_FORMAT_VERSION,
            section: SECTION_ID,
            anchor_prefix: ANCHOR_PREFIX,
            index: Index::of(&curation.items, &curation.context),
            items: curation.items.clone(),
            context: curation.context.clone(),
            posts: vec![PostContext {
                post: post.slug.to_string(),
                url: post.url.to_string(),
                items: view
                    .items
                    .iter()
                    .map(|item| ItemRef {
                        id: item.id.clone(),
                        url: format!("{}#{ANCHOR_PREFIX}{}", post.url, item.id),
                    })
                    .collect(),
                context: view
                    .context
                    .iter()
                    .map(|context| ContextRef {
                        kind: context.kind,
                        id: context.id.clone(),
                    })
                    .collect(),
            }],
        })
    }
}

fn context_noun(kind: ContextKind) -> &'static str {
    match kind {
        ContextKind::Entry => "entry",
        ContextKind::Relationship => "relationship",
        ContextKind::Source => "source",
    }
}

// ---------------------------------------------------------------- the page

/// The words for what a selection is, as the page names it.
fn kind_noun(kind: SelectionKind) -> &'static str {
    match kind {
        SelectionKind::Reference => "Source reference",
        SelectionKind::ContextualEntry => "Atlas entry",
        SelectionKind::Relationship => "Relationship",
        SelectionKind::Timeline => "Dating",
        SelectionKind::Comparison => "Comparison",
        SelectionKind::SourceAnnotation => "The author's comment on a source",
        SelectionKind::Explanation => "The author's explanation of an entry",
    }
}

/// The names of the fields a page shows, in the order it shows them. A field
/// not listed follows, by name; the heading carries the ones left out.
const FIELD_ORDER: &[(&str, &str)] = &[
    ("summary", "Summary"),
    ("aliases", "Other names"),
    ("kind", "Kind"),
    ("creators", "Creators"),
    ("issued", "Date issued"),
    ("language", "Language"),
    ("identifiers", "Public identifiers"),
    ("source", "The work it stands for"),
    ("from", "From"),
    ("to", "To"),
    ("inverseLabel", "Read the other way"),
    ("subject", "About"),
    ("owner", "Dates"),
    ("aspect", "Aspect"),
    ("text", "The words"),
    ("by", "Who wrote it"),
    ("locator", "Where in the source it applies"),
    ("assertedBy", "Who asserts it"),
    ("confidence", "How firmly"),
    ("standing", "Whether it is contested"),
    ("uncertainty", "What is doubtful"),
    ("contestedBy", "Who disputes it"),
    ("evidence", "The evidence"),
    ("date", "The date as its party states it"),
    ("placement", "How it is placed in time"),
    ("startYear", "First year"),
    ("endYear", "Last year"),
    ("note", "The party's note"),
    ("correspondenceLabel", "How the passages correspond"),
    ("correspondence", "The correspondence"),
    ("rationale", "The reasoning"),
    ("recordedBy", "Who recorded it"),
    ("versions", "The versions compared"),
    ("wording", "The compared wording"),
    ("csl", "Full citation data"),
];

/// Fields shown by the heading, the link or the context list, never as a row.
const HIDDEN_FIELDS: &[&str] = &["id", "key", "label", "title", "url", "ownerType"];

fn label_of(name: &str) -> String {
    FIELD_ORDER
        .iter()
        .find(|(field, _)| *field == name)
        .map_or_else(|| name.to_string(), |(_, label)| (*label).to_string())
}

fn str_of<'a>(item: &'a CuratedItem, field: &str) -> Option<&'a str> {
    item.content.get(field).and_then(Value::as_str)
}

/// A root-relative address of a page of this site, or an absolute `https`
/// address: nothing else is ever made a link.
fn safe_href(url: &str) -> bool {
    // No whitespace, control character or backslash: a browser reads `/\evil`
    // as `//evil`, and a control character can be stripped to something else.
    let plain = !url.contains(|c: char| c.is_whitespace() || c.is_control() || c == '\\');
    plain && ((url.starts_with('/') && !url.starts_with("//")) || url.starts_with("https://"))
}

/// What a reference on the page points at: its public name, and the anchor on
/// this page it can link to when the page holds it.
struct Named {
    label: String,
    anchor: Option<String>,
}

struct Page<'a> {
    context: &'a CuratedContext,
    /// The ids of the items this post offers, and the context it lists.
    offered: BTreeSet<&'a str>,
    listed: BTreeSet<(ContextKind, &'a str)>,
}

impl Page<'_> {
    /// A source, entry or relationship by the name the public value gives it:
    /// the context item that brings it, or, when it was selected on its own
    /// and so is not repeated as context, the selected item itself.
    fn named(&self, kind: ContextKind, id: &str) -> Option<Named> {
        if let Some(item) = self.context.context_item(kind, id) {
            let listed = self.listed.contains(&(kind, id));
            return Some(Named {
                label: item.label.clone().unwrap_or_else(|| id.to_string()),
                anchor: listed.then(|| anchor(context_noun(kind), id)),
            });
        }
        let (selection, field) = match kind {
            ContextKind::Source => (SelectionKind::Reference, "title"),
            ContextKind::Entry => (SelectionKind::ContextualEntry, "label"),
            ContextKind::Relationship => return None,
        };
        let item = self.context.selected(selection, id)?;
        let label = str_of(item, field)?.to_string();
        let offered = self.offered.contains(item.id.as_str());
        Some(Named {
            label,
            anchor: offered.then(|| format!("{ANCHOR_PREFIX}{}", item.id)),
        })
    }

    fn entry_name(&self, id: &str) -> Option<String> {
        self.named(ContextKind::Entry, id).map(|named| named.label)
    }

    /// A reference to a source: its public name, as a link to where this
    /// page holds it, or the id as plain text when it is not held.
    fn source_ref(&self, id: &str) -> String {
        match self.named(ContextKind::Source, id) {
            Some(Named {
                label,
                anchor: Some(anchor),
            }) => format!(
                "<a class=\"ob-curated-source\" href=\"#{}\"><cite>{}</cite></a>",
                attr(&anchor),
                text(&label)
            ),
            Some(named) => format!("<cite>{}</cite>", text(&named.label)),
            None => format!("<cite>{}</cite>", text(id)),
        }
    }

    fn entry_ref(&self, id: &str) -> String {
        match self.named(ContextKind::Entry, id) {
            Some(Named {
                label,
                anchor: Some(anchor),
            }) => format!("<a href=\"#{}\">{}</a>", attr(&anchor), text(&label)),
            Some(named) => text(&named.label),
            None => text(id),
        }
    }

    fn party(&self, value: &Value) -> Option<String> {
        let object = value.as_object()?;
        match object.get("kind").and_then(Value::as_str)? {
            "author" => Some("the site author".to_string()),
            "named" => object.get("name").and_then(Value::as_str).map(text),
            "source" => object
                .get("source")
                .and_then(Value::as_str)
                .map(|id| format!("the source {}", self.source_ref(id))),
            _ => None,
        }
    }

    fn locators(value: &Value) -> String {
        value
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|locator| {
                        let kind = locator.get("kind")?.as_str()?;
                        let at = locator.get("value")?.as_str()?;
                        Some(match locator.get("to").and_then(Value::as_str) {
                            Some(to) => format!("{} {} to {}", text(kind), text(at), text(to)),
                            None => format!("{} {}", text(kind), text(at)),
                        })
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default()
    }

    /// One field value as inline HTML. Every string is escaped; the only
    /// links are to this site's pages and to a source's own `https` address.
    fn value(&self, name: &str, value: &Value, depth: usize) -> String {
        match value {
            Value::Null => String::new(),
            Value::Bool(flag) => flag.to_string(),
            Value::Number(number) => number.to_string(),
            Value::String(string) => match name {
                "from" | "to" | "owner" | "source" | "subject"
                    if self.entry_name(string).is_some() =>
                {
                    self.entry_ref(string)
                }
                "source" | "subject" if self.named(ContextKind::Source, string).is_some() => {
                    self.source_ref(string)
                }
                "url" if safe_href(string) => {
                    format!("<a href=\"{}\">{}</a>", attr(string), text(string))
                }
                _ => text(string),
            },
            Value::Array(list) => {
                let parts: Vec<String> = list
                    .iter()
                    .map(|item| match item.as_array().map(Vec::as_slice) {
                        // An identifier is a scheme and a value: "doi: 10.1000/x".
                        Some([Value::String(scheme), Value::String(value)])
                            if name == "identifiers" =>
                        {
                            format!("{}: {}", text(scheme), text(value))
                        }
                        _ => self.value(name, item, depth + 1),
                    })
                    .filter(|html| !html.is_empty())
                    .collect();
                match parts.len() {
                    0 => String::new(),
                    1 => parts.into_iter().next().unwrap_or_default(),
                    _ => format!(
                        "<ul class=\"ob-curated-list\">{}</ul>",
                        parts
                            .iter()
                            .map(|part| format!("<li>{part}</li>"))
                            .collect::<String>()
                    ),
                }
            }
            Value::Object(object) => {
                if let Some(party) = self.party(value) {
                    return party;
                }
                if let Some(source) = object.get("source").and_then(Value::as_str) {
                    let at = object
                        .get("locators")
                        .map(Self::locators)
                        .unwrap_or_default();
                    let mut html = self.source_ref(source);
                    if !at.is_empty() {
                        html.push_str(&format!(", {at}"));
                    }
                    if let Some(note) = object.get("note").and_then(Value::as_str) {
                        html.push_str(&format!(" ({})", text(note)));
                    }
                    return html;
                }
                if let (Some(by), Some(note)) = (object.get("by"), object.get("note")) {
                    // A dissent: who disputes it, on what evidence, and what they say.
                    let mut html = format!(
                        "{}: {}",
                        self.value("by", by, depth + 1),
                        self.value("note", note, depth + 1)
                    );
                    if let Some(evidence) = object.get("evidence") {
                        html.push_str(&format!(
                            " (evidence: {})",
                            self.value("evidence", evidence, depth + 1)
                        ));
                    }
                    return html;
                }
                if let (Some(name), Some(role)) = (
                    object.get("name").and_then(Value::as_str),
                    object.get("role").and_then(Value::as_str),
                ) {
                    return format!("{} ({})", text(name), text(role));
                }
                if depth >= MAX_DEPTH {
                    return text(&Value::Object(object.clone()).to_string());
                }
                // Anything else is read as labelled parts, in name order.
                object
                    .iter()
                    .filter(|(_, inner)| !inner.is_null())
                    .map(|(key, inner)| {
                        format!(
                            "{}: {}",
                            text(&label_of(key)),
                            self.value(key, inner, depth + 1)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("; ")
            }
        }
    }

    /// The heading of one item: what it is and what it is about.
    fn heading(&self, item: &CuratedItem) -> String {
        let noun = kind_noun(item.kind);
        let subject = match item.kind {
            SelectionKind::Reference => str_of(item, "title").map(text),
            SelectionKind::ContextualEntry => str_of(item, "label").map(text),
            SelectionKind::Comparison => str_of(item, "label").map(text),
            SelectionKind::Relationship => {
                let end = |field: &str| {
                    str_of(item, field).map(|id| {
                        self.entry_name(id)
                            .map_or_else(|| text(id), |name| text(&name))
                    })
                };
                match (end("from"), str_of(item, "label"), end("to")) {
                    (Some(from), Some(label), Some(to)) => {
                        Some(format!("{from} {} {to}", text(label)))
                    }
                    _ => None,
                }
            }
            SelectionKind::Timeline => match (str_of(item, "aspect"), str_of(item, "text")) {
                (Some(aspect), Some(when)) => Some(format!("{}: {}", text(aspect), text(when))),
                (None, Some(when)) => Some(text(when)),
                _ => None,
            },
            SelectionKind::SourceAnnotation => self
                .named(ContextKind::Source, &item.target)
                .map(|named| text(&named.label)),
            SelectionKind::Explanation => self.entry_name(&item.target).map(|name| text(&name)),
        };
        match subject {
            Some(subject) => format!("{}: {subject}", text(noun)),
            None => text(noun),
        }
    }

    fn origin(item: &CuratedItem) -> String {
        match &item.provenance {
            crate::curated_selection::Provenance::Authored => {
                "Where this metadata came from: written by the author.".to_string()
            }
            crate::curated_selection::Provenance::Imported { from } => format!(
                "Where this metadata came from: imported from {}.",
                text(from)
            ),
            crate::curated_selection::Provenance::Unrecorded => {
                "Where this metadata came from: not recorded.".to_string()
            }
        }
    }

    fn item_html(&self, item: &CuratedItem) -> String {
        let mut html = format!(
            "<li class=\"ob-curated-item\" id=\"{}\" data-curated-kind=\"{}\" data-curated-id=\"{}\">\n",
            attr(&format!("{ANCHOR_PREFIX}{}", item.id)),
            attr(item.kind.as_str()),
            attr(&item.id)
        );
        let link = str_of(item, "url").filter(|url| safe_href(url));
        let heading = self.heading(item);
        html.push_str(&match link {
            Some(url) => format!(
                "<h3 class=\"ob-curated-heading\"><a href=\"{}\">{heading}</a></h3>\n",
                attr(url)
            ),
            None => format!("<h3 class=\"ob-curated-heading\">{heading}</h3>\n"),
        });
        let mut names: Vec<&str> = FIELD_ORDER
            .iter()
            .map(|(name, _)| *name)
            .filter(|name| item.content.contains_key(*name))
            .collect();
        let mut rest: Vec<&str> = item
            .content
            .keys()
            .map(String::as_str)
            .filter(|name| !names.contains(name) && !HIDDEN_FIELDS.contains(name))
            .collect();
        rest.sort_unstable();
        names.extend(rest);
        let dated = item.kind == SelectionKind::Timeline;
        // An address that cannot be a link (an `http` one, say) is still the
        // source's public address: it is shown as plain text, never dropped.
        let unlinked = str_of(item, "url")
            .filter(|url| !url.is_empty() && !safe_href(url))
            .map(|url| format!("<dt>Address (not a link)</dt>\n<dd>{}</dd>\n", text(url)))
            .unwrap_or_default();
        let rows: String = names
            .into_iter()
            .filter(|name| !HIDDEN_FIELDS.contains(name))
            // A dating reads as its stated words; the date's own fields are in the data file.
            .filter(|name| !(dated && *name == "date" && item.content.contains_key("text")))
            .filter_map(|name| {
                let raw = item.content.get(name)?;
                let value = match (name, raw.as_str()) {
                    // The entry a dating dates has a page of its own.
                    ("owner", Some(id)) if str_of(item, "ownerType") == Some("entry") => {
                        format!(
                            "<a href=\"{}\">{}</a>",
                            attr(&crate::atlas_publication::entry_url(id)),
                            self.entry_name(id)
                                .map_or_else(|| text(id), |name| text(&name))
                        )
                    }
                    _ => self.value(name, raw, 0),
                };
                let label = if dated && name == "text" {
                    "Stated as".to_string()
                } else {
                    label_of(name)
                };
                (!value.is_empty())
                    .then(|| format!("<dt>{}</dt>\n<dd>{value}</dd>\n", text(&label)))
            })
            .chain(std::iter::once(unlinked))
            .collect();
        if !rows.is_empty() {
            html.push_str(&format!("<dl class=\"ob-curated-fields\">\n{rows}</dl>\n"));
        }
        if !item.missing.is_empty() {
            html.push_str(&format!(
                "<p class=\"ob-curated-missing\">Not recorded, so left out and never invented: {}.</p>\n",
                item.missing
                    .iter()
                    .map(|name| text(&label_of(name)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        if item.kind == SelectionKind::Reference {
            html.push_str(&format!(
                "<p class=\"ob-curated-origin\">{}</p>\n",
                Self::origin(item)
            ));
        }
        if !item.notices.is_empty() {
            html.push_str("<ul class=\"ob-curated-notices\" aria-label=\"Notices\">\n");
            for notice in &item.notices {
                html.push_str(&format!(
                    "<li data-curated-notice=\"{}\">{}</li>\n",
                    attr(
                        serde_json::to_value(notice.code)
                            .ok()
                            .as_ref()
                            .and_then(Value::as_str)
                            .unwrap_or("notice")
                    ),
                    text(&notice_text(notice))
                ));
            }
            html.push_str("</ul>\n");
        }
        html.push_str("</li>\n");
        html
    }

    fn context_html(&self, listed: &[&ContextItem]) -> String {
        let mut html = format!(
            "<h3 class=\"ob-curated-heading\" id=\"{REFS_HEADING_ID}\">What these refer to</h3>\n<ul class=\"ob-curated-context\" role=\"list\">\n",
        );
        for item in listed {
            let name = item.label.as_deref().unwrap_or(&item.id);
            let id = anchor(context_noun(item.kind), &item.id);
            let named = match (item.url.as_deref().filter(|url| safe_href(url)), item.kind) {
                (Some(url), _) => format!("<a href=\"{}\">{}</a>", attr(url), text(name)),
                (None, ContextKind::Source) => format!("<cite>{}</cite>", text(name)),
                (None, _) => text(name),
            };
            let unlinked = item
                .url
                .as_deref()
                .filter(|url| !url.is_empty() && !safe_href(url))
                .map(|url| {
                    format!(
                        " <span class=\"ob-curated-address\">(address, not a link: {})</span>",
                        text(url)
                    )
                })
                .unwrap_or_default();
            let detail = match (&item.source, item.kind) {
                (Some(source), ContextKind::Source) if source.text != name => {
                    format!(" — {}", text(&source.text))
                }
                _ => String::new(),
            };
            html.push_str(&format!(
                "<li id=\"{}\" data-curated-context-kind=\"{}\">{}{}{} <span class=\"ob-curated-via\">({})</span></li>\n",
                attr(&id),
                attr(context_noun(item.kind)),
                named,
                detail,
                unlinked,
                text(context_noun(item.kind))
            ));
        }
        html.push_str("</ul>\n");
        html
    }

    /// The whole section, or `None` when the post offers nothing.
    fn section(&self, post: &PostContext, data_url: Option<&str>) -> Option<String> {
        let mut items: Vec<&CuratedItem> = post
            .items
            .iter()
            .filter_map(|reference| self.context.item(&reference.id))
            .collect();
        if items.is_empty() {
            return None;
        }
        let held_back = items.len().saturating_sub(MAX_PAGE_ITEMS);
        items.truncate(MAX_PAGE_ITEMS);
        let listed: Vec<&ContextItem> = post
            .context
            .iter()
            .filter_map(|reference| self.context.context_item(reference.kind, &reference.id))
            .collect();
        let mut html = format!(
            "<section class=\"ob-curated\" id=\"{SECTION_ID}\" aria-labelledby=\"{SECTION_ID}-title\" data-curated-context=\"{}\">\n",
            items.len()
        );
        html.push_str(&format!(
            "<h2 class=\"ob-curated-title\" id=\"{SECTION_ID}-title\">Research context</h2>\n"
        ));
        html.push_str(
            "<p class=\"ob-curated-note\">Chosen by the author from their research, in the order they gave. Each item says who holds a view, how firmly and on what evidence; none of it is a verdict, and what a source does not say is listed as not recorded.",
        );
        if let Some(url) = data_url {
            html.push_str(&format!(
                " <a class=\"ob-curated-data\" href=\"{}\">The same context as data</a>.",
                attr(url)
            ));
        }
        html.push_str("</p>\n<ol class=\"ob-curated-items\" role=\"list\">\n");
        for item in items {
            html.push_str(&self.item_html(item));
        }
        html.push_str("</ol>\n");
        if held_back > 0 {
            html.push_str(&format!(
                "<p class=\"ob-curated-more\">This page shows the first {MAX_PAGE_ITEMS} items. {held_back} more {} in the data file for this post.</p>\n",
                if held_back == 1 { "is" } else { "are" }
            ));
        }
        if !listed.is_empty() {
            html.push_str(&self.context_html(&listed));
        }
        html.push_str("</section>\n");
        Some(html)
    }
}

/// The id of the "what these refer to" heading.
const REFS_HEADING_ID: &str = "ob-curated-ref_list";

/// What a notice says to a reader, from its `code` and `field` alone: the
/// author's own message names selection ids and fields in the words of the
/// Admin, which a reader of the page should not see.
fn notice_text(notice: &crate::curated_selection::ItemNotice) -> String {
    use crate::curated_selection::NoticeCode;
    let field = notice
        .field
        .as_deref()
        .map(|field| label_of(field.split(['.', '[']).next().unwrap_or(field)).to_lowercase());
    match (notice.code, field) {
        (NoticeCode::CompetingUnselected, _) => {
            "Other datings of the same aspect exist on this site and were not chosen here."
                .to_string()
        }
        (NoticeCode::MissingDetail, Some(field)) => {
            format!("The source does not record the {field}; it is left out, not invented.")
        }
        (NoticeCode::MissingDetail, None) => {
            "A detail the source does not record is left out, not invented.".to_string()
        }
        (NoticeCode::ProvenanceUnrecorded, _) => {
            "Where this metadata came from is not recorded.".to_string()
        }
        (NoticeCode::RightsRestricted, _) => {
            "Some wording is identified and located but not shown, because of its rights statement or length."
                .to_string()
        }
        (NoticeCode::UnsafeUrl, _) | (NoticeCode::PrivateIdentifier, _) => {
            "An address or identifier is not published.".to_string()
        }
    }
}

/// The anchor of one thing in the "what these refer to" list. It uses an
/// underscore, which a selection id (a lowercase slug) never holds, so it can
/// never be the anchor of a selection.
fn anchor(kind: &str, id: &str) -> String {
    format!("{ANCHOR_PREFIX}ref_{kind}_{id}")
}

impl CuratedContext {
    /// The static section of one post's page: semantic headings, lists and
    /// definitions that read in order without CSS or JavaScript, an anchor on
    /// each item, and the attribution, uncertainty, evidence and origin of
    /// every item as text. `None` when the post offers nothing, so its page
    /// is exactly what it was. `data_url` is the address of the data file,
    /// when the build writes it.
    pub fn post_section_html(&self, slug: &str, data_url: Option<&str>) -> Option<String> {
        let post = self.for_post(slug)?;
        Page {
            context: self,
            offered: post.items.iter().map(|item| item.id.as_str()).collect(),
            listed: post
                .context
                .iter()
                .map(|context| (context.kind, context.id.as_str()))
                .collect(),
        }
        .section(post, data_url)
    }
}

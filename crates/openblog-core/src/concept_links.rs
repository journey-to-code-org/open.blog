//! Concept links in an article (ADR 0204): an author's explicit
//! `[the Republic](atlas:republic)` ties a word in the prose to one published
//! Knowledge Atlas entry, with no automatic recognition of anything.
//!
//! The syntax is an ordinary Markdown link whose destination is `atlas:` and
//! an entry id. In any editor, preview or copy that does not know it, it reads
//! as the author's own words (the label), and the destination is a short
//! readable id. Nothing else is a concept link: a label that is not linked
//! stays text however often it repeats, and prose is never scanned.
//!
//! A link is resolved at build time, against the public atlas
//! ([`PublicAtlas`]) and nothing else. A published entry becomes an ordinary
//! `<a>` to its page, so it works without JavaScript. An id that is not
//! well-formed, that names no entry (unknown, not approved or withdrawn: the
//! public atlas cannot tell which, and neither does the page), or any link
//! while the site does not publish its atlas, becomes the label as plain text
//! and a diagnostic for the author naming the file and the id. The page never
//! carries a link that leads nowhere, and never anything that says an
//! unpublished entry exists.
//!
//! The Markdown renderer marks each concept link with an inert
//! `<ob-concept data-id="...">` element, and [`link_html`] later replaces
//! every mark, once the atlas is known. A page that is never resolved shows
//! plain text, since the mark is an element no browser styles.

use std::collections::BTreeMap;

use pulldown_cmark::{CowStr, Event, Parser, Tag, TagEnd};

use crate::atlas_publication::PublicAtlas;
use crate::escape;
use crate::knowledge_atlas::valid_id;

/// The start of a concept link's destination.
pub const SCHEME: &str = "atlas:";
/// What the rendered HTML of a post holds before its concept links are
/// resolved: the start of the mark.
pub const MARK_PREFIX: &str = "<ob-concept data-id=\"";
const MARK_CLOSE: &str = "</ob-concept>";
/// The class of a resolved concept link, for themes and for the context
/// previews that enhance it.
pub const LINK_CLASS: &str = "ob-concept";
/// Every diagnostic this module writes contains this text, so a later
/// resolution replaces the earlier ones instead of repeating them.
pub const WARNING_MARK: &str = ": concept link `";
/// The start of the diagnostic for an `atlas:` link outside a post. It is
/// written once when the site loads and is not one of the post resolution's
/// diagnostics, so [`WARNING_MARK`] does not replace it.
pub const OUTSIDE_WARNING_MARK: &str = ": atlas link `";
/// The words a screen reader adds after a concept link's label, as visually
/// hidden text, so the link says what it leads to without script.
pub const LINK_HINT: &str = " (atlas entry)";
/// The class of the hint's element (the theme's visually hidden class).
const HINT_CLASS: &str = "ob-visually-hidden";

/// The id a concept link's destination names, when the destination is a
/// well-formed one: `atlas:` and a lowercase slug of at most 64 bytes.
pub fn entry_id(destination: &str) -> Option<&str> {
    let id = destination.strip_prefix(SCHEME)?;
    valid_id(id).then_some(id)
}

/// The mark the renderer writes where a concept link starts.
pub(crate) fn mark_open(id: &str) -> String {
    format!("{MARK_PREFIX}{}\">", escape::attr(id))
}

/// What [`mark_events`] found.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Marked {
    /// Whether any concept link became a mark.
    pub any: bool,
    /// The ids (as written) of concept links inside an image's description,
    /// in source order. They are not marked: an alt text is plain text and a
    /// mark there would be escaped onto the page, private id and all.
    pub in_images: Vec<String>,
}

/// Turn every concept link of a parsed post into its mark. Links cannot nest,
/// so one flag pairs each end with its start. A link inside an image's alt
/// text keeps only its label (the events of the link are emptied) and is
/// reported in [`Marked::in_images`] instead.
pub(crate) fn mark_events(events: &mut [Event<'_>]) -> Marked {
    let mut found = Marked::default();
    let mut open = false;
    let mut dropped = false;
    let mut images = 0usize;
    for event in events.iter_mut() {
        let replacement = match &*event {
            Event::Start(Tag::Image { .. }) => {
                images += 1;
                None
            }
            Event::End(TagEnd::Image) => {
                images = images.saturating_sub(1);
                None
            }
            Event::Start(Tag::Link { dest_url, .. }) if dest_url.starts_with(SCHEME) => {
                if images > 0 {
                    dropped = true;
                    found.in_images.push(dest_url[SCHEME.len()..].to_string());
                    Some(Event::Text(CowStr::from("")))
                } else {
                    open = true;
                    found.any = true;
                    Some(Event::InlineHtml(CowStr::from(mark_open(
                        &dest_url[SCHEME.len()..],
                    ))))
                }
            }
            Event::End(TagEnd::Link) if dropped => {
                dropped = false;
                Some(Event::Text(CowStr::from("")))
            }
            Event::End(TagEnd::Link) if open => {
                open = false;
                Some(Event::InlineHtml(CowStr::from(MARK_CLOSE)))
            }
            _ => None,
        };
        if let Some(replacement) = replacement {
            *event = replacement;
        }
    }
    found
}

/// Why a concept link is shown as plain text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Unlinked {
    /// The destination is not `atlas:` and a lowercase slug.
    NotAnId,
    /// The site does not publish a Knowledge Atlas, or its atlas could not be read.
    SiteOff,
    /// The public atlas has no entry with this id.
    NotPublished,
    /// The link is inside an image's description, which is plain text.
    InImage,
    /// The link is in a page, a series description or the home introduction,
    /// which do not resolve concept links.
    OutsidePost,
}

/// What became of the concept links that name one id in one post.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConceptUse {
    /// The id as written, not escaped for HTML.
    pub id: String,
    /// How many links name it.
    pub count: usize,
    /// `None` when they became links.
    pub unlinked: Option<Unlinked>,
}

impl ConceptUse {
    /// The author's diagnostic for a link shown as plain text, scoped to the
    /// file and the id. It never repeats an entry's label or any private
    /// text, and names the id only because the author wrote it.
    pub fn warning(&self, source: &str) -> Option<String> {
        let reason = match self.unlinked? {
            Unlinked::NotAnId => "the destination is not `atlas:` and an entry id (lowercase letters, digits and hyphens)".to_string(),
            Unlinked::SiteOff => "the site does not publish its Knowledge Atlas (`knowledgeAtlas.publish` is off or the atlas could not be read)".to_string(),
            Unlinked::NotPublished => "the published atlas has no entry with that id (it may be unknown, not approved or withdrawn)".to_string(),
            Unlinked::InImage => "a link cannot be inside an image's description (its alt text), which is plain text".to_string(),
            Unlinked::OutsidePost => "concept links are resolved in posts only, not in pages, series descriptions or the home introduction".to_string(),
        };
        // The id as the author wrote it, cut by characters (never through an
        // escape) with anything a log or a terminal could misread replaced.
        let lead = if self.unlinked == Some(Unlinked::OutsidePost) {
            // Not a post's resolution, so a later resolution keeps it.
            OUTSIDE_WARNING_MARK
        } else {
            WARNING_MARK
        };
        let shown: String = self
            .id
            .chars()
            .take(40)
            .map(|c| if c.is_control() { '\u{FFFD}' } else { c })
            .collect();
        Some(format!(
            "{source}{lead}{SCHEME}{shown}`{} is shown as plain text: {reason}. Fix the id, approve the entry, or remove the link.",
            if self.count > 1 {
                format!(" ({} times)", self.count)
            } else {
                String::new()
            }
        ))
    }
}

/// A post's HTML with its concept links resolved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Linked {
    pub html: String,
    /// One per id, in id order.
    pub uses: Vec<ConceptUse>,
}

/// Replace every concept mark in `html` with a link to the entry's page, when
/// `atlas` publishes the entry, and with the marked text otherwise. `None` is
/// a site that does not publish its atlas. Anything left of a mark (a partial
/// or forged one) is removed, so no mark ever reaches a reader.
pub fn link_html(html: &str, atlas: Option<&PublicAtlas>) -> Linked {
    let mut out = String::with_capacity(html.len());
    let mut uses: BTreeMap<String, (usize, Option<Unlinked>)> = BTreeMap::new();
    let mut rest = html;
    while let Some(at) = rest.find(MARK_PREFIX) {
        out.push_str(&rest[..at]);
        let after = &rest[at + MARK_PREFIX.len()..];
        let Some(end) = after.find("\">") else {
            // A mark with no end of its tag: drop the fragment, keep the text.
            rest = after;
            continue;
        };
        let id = &after[..end];
        let body = &after[end + 2..];
        // A mark is inline: it closes inside its own block. One that is not
        // closed there (an unclosed raw `<ob-concept ...>`) is dropped, so it
        // can never turn the rest of the post into a link.
        let closed = body
            .find(MARK_CLOSE)
            .filter(|close| !crosses_a_block(&body[..*close]));
        let Some(close) = closed else {
            rest = body;
            continue;
        };
        let (inner, tail) = (&body[..close], &body[close + MARK_CLOSE.len()..]);
        let entry = atlas
            .and_then(|atlas| atlas.entry(id))
            .filter(|_| valid_id(id));
        let unlinked = match (&entry, atlas) {
            (Some(_), _) => None,
            _ if !valid_id(id) => Some(Unlinked::NotAnId),
            (None, None) => Some(Unlinked::SiteOff),
            (None, Some(_)) => Some(Unlinked::NotPublished),
        };
        let slot = uses.entry(id.to_string()).or_insert((0, unlinked));
        slot.0 += 1;
        match entry {
            Some(entry) => {
                out.push_str(&format!(
                    "<a class=\"{LINK_CLASS}\" href=\"{}\" data-atlas-entry=\"{}\" data-atlas-kind=\"{}\">",
                    escape::attr(&entry.url),
                    escape::attr(&entry.id),
                    entry.kind.as_str()
                ));
                out.push_str(&strip_marks(inner));
                out.push_str(&format!(
                    "<span class=\"{HINT_CLASS}\">{LINK_HINT}</span></a>"
                ));
            }
            None => out.push_str(&strip_marks(inner)),
        }
        rest = tail;
    }
    out.push_str(rest);
    Linked {
        html: strip_marks(&out),
        uses: uses
            .into_iter()
            .map(|(id, (count, unlinked))| ConceptUse {
                id: unescape(&id),
                count,
                unlinked,
            })
            .collect(),
    }
}

/// The uses of concept links inside image descriptions, one per id in id
/// order, as the warnings name them.
pub(crate) fn image_uses(ids: &[String]) -> Vec<ConceptUse> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for id in ids {
        *counts.entry(id).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(id, count)| ConceptUse {
            id: id.to_string(),
            count,
            unlinked: Some(Unlinked::InImage),
        })
        .collect()
}

/// A page's, series' or home introduction's HTML with its concept marks
/// replaced by their labels, and one warning per id for the author: these
/// documents do not resolve concept links, and a raw `atlas:` address must
/// never reach a page. `source` names the document.
pub fn plain_outside_post(html: &str, source: &str) -> (String, Vec<String>) {
    let linked = link_html(html, None);
    let warnings = linked
        .uses
        .into_iter()
        .filter_map(|mut used| {
            used.unlinked = Some(Unlinked::OutsidePost);
            used.warning(source)
        })
        .collect();
    (linked.html, warnings)
}

/// Whether `html` holds a block boundary, which no inline mark can span.
fn crosses_a_block(html: &str) -> bool {
    const BLOCKS: [&str; 16] = [
        "</p>",
        "</li>",
        "</h",
        "</td>",
        "</th>",
        "</tr>",
        "</blockquote>",
        "</div>",
        "</pre>",
        "</ul>",
        "</ol>",
        "</table>",
        "<p>",
        "<p ",
        "<ul",
        "<ol",
    ];
    BLOCKS.iter().any(|tag| html.contains(tag))
}

/// The text an attribute value was escaped from ([`escape::attr`]).
fn unescape(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// `text` without any mark tag.
fn strip_marks(text: &str) -> String {
    if !text.contains("<ob-concept") && !text.contains(MARK_CLOSE) {
        return text.to_string();
    }
    let mut out = text.replace(MARK_CLOSE, "");
    while let Some(at) = out.find(MARK_PREFIX) {
        let end = out[at..].find("\">").map_or(out.len(), |end| at + end + 2);
        out.replace_range(at..end, "");
    }
    out
}

/// The Markdown of a post with each concept link written as its label, for
/// copies that leave the site (feeds, portable exports): a copy cannot
/// resolve an entry, so it keeps the author's words and no link. `None` when
/// the Markdown has no concept link, so every other post is copied as it was.
pub fn plain_markdown(markdown: &str) -> Option<String> {
    if !markdown.contains(SCHEME) {
        return None;
    }
    let parser = Parser::new_ext(markdown, crate::markdown::parser_options(false));
    let mut edits: Vec<(std::ops::Range<usize>, String)> = Vec::new();
    for (_, definition) in parser.reference_definitions().iter() {
        if definition.dest.starts_with(SCHEME) {
            edits.push((definition.span.clone(), String::new()));
        }
    }
    let events: Vec<_> = Parser::new_ext(markdown, crate::markdown::parser_options(false))
        .into_offset_iter()
        .collect();
    let mut index = 0;
    while index < events.len() {
        let (event, range) = &events[index];
        if let Event::Start(Tag::Link { dest_url, .. }) = event {
            if dest_url.starts_with(SCHEME) {
                // The label is the source of the events between the link's
                // start and its end.
                let mut label: Option<std::ops::Range<usize>> = None;
                let mut next = index + 1;
                while next < events.len() && !matches!(events[next].0, Event::End(TagEnd::Link)) {
                    let inner = &events[next].1;
                    label = Some(match label {
                        Some(so_far) => so_far.start.min(inner.start)..so_far.end.max(inner.end),
                        None => inner.clone(),
                    });
                    next += 1;
                }
                let text = label.map_or("", |span| &markdown[span]);
                edits.push((range.clone(), text.to_string()));
                index = next;
            }
        }
        index += 1;
    }
    if edits.is_empty() {
        return None;
    }
    edits.sort_by_key(|(range, _)| range.start);
    let mut out = String::with_capacity(markdown.len());
    let mut cursor = 0;
    for (range, replacement) in edits {
        if range.start < cursor {
            continue;
        }
        out.push_str(&markdown[cursor..range.start]);
        out.push_str(&replacement);
        cursor = range.end;
    }
    out.push_str(&markdown[cursor..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_atlas_and_a_slug_is_an_entry_id() {
        assert_eq!(entry_id("atlas:plato"), Some("plato"));
        assert_eq!(entry_id("atlas:the-republic-2"), Some("the-republic-2"));
        for bad in [
            "atlas:",
            "atlas:Plato",
            "atlas:a/b",
            "atlas:a b",
            "atlas:-a",
            "atlas:a?x",
            "ATLAS:plato",
            "/atlas/plato/",
            "https://x.test/",
        ] {
            assert_eq!(entry_id(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_mark_without_an_atlas_is_its_text_and_nothing_else_survives() {
        let html = format!(
            "<p>See {}Plato{} and {}x{}.</p>",
            mark_open("plato"),
            MARK_CLOSE,
            mark_open("BAD id"),
            MARK_CLOSE
        );
        let linked = link_html(&html, None);
        assert_eq!(linked.html, "<p>See Plato and x.</p>");
        assert_eq!(linked.uses.len(), 2);
        assert_eq!(linked.uses[0].id, "BAD id");
        assert_eq!(linked.uses[0].unlinked, Some(Unlinked::NotAnId));
        assert_eq!(linked.uses[1].unlinked, Some(Unlinked::SiteOff));
        // Broken or nested marks leave no mark behind.
        let broken = format!("a {}b {}c", MARK_PREFIX, mark_open("x"));
        assert!(!link_html(&broken, None).html.contains("ob-concept"));
        let stray = format!("a{MARK_CLOSE}b");
        assert_eq!(link_html(&stray, None).html, "ab");
    }

    #[test]
    fn labels_come_back_as_the_authors_words() {
        let markdown = "A [**bold** idea](atlas:idea) and [plain][r] and <atlas:auto> but `[x](atlas:code)`.\n\n[r]: atlas:ref\n";
        let plain = plain_markdown(markdown).unwrap();
        assert_eq!(
            plain,
            "A **bold** idea and plain and atlas:auto but `[x](atlas:code)`.\n\n\n"
        );
        assert_eq!(
            plain_markdown("A [site](https://example.com/atlas:x)."),
            None
        );
        assert_eq!(plain_markdown("No links at all."), None);
    }
}

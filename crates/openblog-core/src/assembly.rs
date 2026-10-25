//! The pure half of the publish gate: turn approved private drafts into the Post a publication
//! writes, and the small private outcome file that records what happened (ADR 0022).
//!
//! [`assemble`] reads nothing but its arguments and writes nothing. It refuses unless
//! [`ApprovalSet::evaluate`] says every required author approved the content as it is now, then
//! builds the canonical Post from exactly the latest revisions those approvals were bound to. The
//! caller writes the result transactionally; a refusal carries only the display names of authors
//! whose approval is missing or out of date, never prose, revision numbers, digests or tokens.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::approval::{public_metadata, ApprovalSet, ApprovalSubject, Readiness, Section};
use crate::collaboration::{valid_admin_username, SharedPublication};
use crate::draft::DraftSet;
use crate::frontmatter::{self, Value};
use crate::shared_source::{
    SharedAttribution, QUESTION_KEY, SOURCE_KIND_KEY, SOURCE_TITLE_KEY, SOURCE_URL_KEY,
};
use crate::slug;
use crate::synthesis::{SynthesisKind, SynthesisSet};

pub const OUTCOME_VERSION: u8 = 1;
pub const MAX_OUTCOME_BYTES: usize = 2 * 1024;
/// Between sections. The blank line before `---` matters: without it the rule would turn the
/// last line of the previous section into a heading.
const SECTION_BREAK: &str = "\n\n---\n\n";

/// Why a publication could not be assembled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssemblyError {
    /// Required approvals are missing or no longer match the content. Holds display names, for a
    /// requester who already holds the publish grant.
    Blocked { missing: Vec<String> },
    /// The record cannot make a Post: no title, no section, or an author without a profile.
    Invalid,
    /// A section contains raw HTML or a link or image with an active address (`javascript:`,
    /// `data:`). Native pages pass these through, which is right for the site owner's own posts
    /// but not for a co-author's prose, and the approved text must not be altered, so the piece
    /// is refused until the author removes it.
    UnsafeMarkup,
}

/// The canonical files one publication writes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assembly {
    /// `posts/<publication id>.md`, so the path is opaque and the same on every retry.
    pub path: String,
    pub source: String,
    /// The credit sidecar, one author credit per section in section order.
    pub credits_path: String,
    pub credits: String,
}

/// The path of the Post a publication writes. It carries no title and no date.
pub fn post_path(record: &SharedPublication) -> String {
    format!("posts/{}.md", record.publication_id)
}

/// Run `ask` against the approval subject for the active authors as the content is now. This is
/// the one place the subject is built from the record, drafts and synthesis, so the approval
/// binding a preview hands out, the one the gate checks and the one a route stores cannot drift
/// apart. The synthesis contributes its prose-free binding frame (items, order, attribution) and
/// its attributed authors, each of whom must approve the piece (ADR 0036, 0037).
pub fn with_subject<R>(
    record: &SharedPublication,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    active: &[&str],
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    let authors: Vec<&str> = record
        .collaboration
        .participants
        .iter()
        .filter(|participant| active.contains(&participant.id.as_str()))
        .map(|participant| participant.id.as_str())
        .collect();
    let stamps: Vec<_> = authors
        .iter()
        .map(|author| drafts.current_stamp(author))
        .collect();
    let sections: Vec<Section<'_>> = authors
        .iter()
        .zip(&stamps)
        .filter_map(|(author, stamp)| {
            let stamp = stamp.as_ref()?;
            Some(Section {
                contribution_id: &stamp.contribution_id,
                owner: author,
                revision: stamp.number,
                digest: &stamp.digest,
            })
        })
        .collect();
    let mut metadata = public_metadata(record);
    metadata.extend(synthesis.binding_frame());
    let metadata: Vec<&str> = metadata.iter().map(String::as_str).collect();
    let attributed = synthesis.attributed_authors();
    ask(&ApprovalSubject {
        authors: &authors,
        sections: &sections,
        metadata: &metadata,
        attributed: &attributed,
    })
}

/// Display names for participant ids, in the order given; unknown ids are skipped.
pub fn display_names<'a>(
    record: &SharedPublication,
    ids: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    ids.into_iter()
        .filter_map(|id| {
            record
                .collaboration
                .participants
                .iter()
                .find(|participant| participant.id == id)
        })
        .map(|participant| participant.display_name.clone())
        .collect()
}

/// Authors who still owe approval of at least one item they are named on, in first-appearance
/// order. Empty when every item is fully approved (or there are none).
pub fn unapproved_item_authors(synthesis: &SynthesisSet) -> Vec<String> {
    let mut awaited: Vec<String> = Vec::new();
    for status in synthesis.all_item_statuses() {
        for author in status.awaiting {
            if !awaited.contains(&author) {
                awaited.push(author);
            }
        }
    }
    awaited
}

/// The section heading above everything a synthesis publishes. Its id is the stable permalink.
const CONVERSATION_HEADING: &str = "## Continuing the conversation {#continuing-the-conversation}";

/// Category order and heading, fixed so a reader finds the same shape in every piece. A kind
/// nobody wrote has no heading at all.
const CATEGORIES: [(SynthesisKind, &str, &str); 5] = [
    (SynthesisKind::Agreement, "agreement", "Shared takeaways"),
    (SynthesisKind::Difference, "difference", "Where we differ"),
    (
        SynthesisKind::Question,
        "question",
        "Questions we are left with",
    ),
    (
        SynthesisKind::Application,
        "application",
        "Ways to apply this",
    ),
    (
        SynthesisKind::Uncertainty,
        "uncertainty",
        "What we are still unsure about",
    ),
];

/// Backslash-escape every ASCII punctuation character, which CommonMark always reads as a literal.
/// A display name is a participant's text and must not become Markdown or HTML.
fn escape_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(if c.is_control() { ' ' } else { c });
    }
    out
}

/// The Markdown that publishes a synthesis, as chunks: headings, attribution headings and item
/// prose, the flag marking the prose (untrusted, checked by [`assemble`]). Only items every
/// attributed author approved at their current digest are included, so an unapproved, withdrawn
/// or edited item has no path in. There is no consensus signal: each item names only the
/// authors it speaks for. Empty when nothing qualifies, so there is no empty heading.
pub fn conversation_parts(
    record: &SharedPublication,
    synthesis: &SynthesisSet,
) -> Vec<(String, bool)> {
    let mut parts: Vec<(String, bool)> = Vec::new();
    for (kind, slug, heading) in CATEGORIES {
        let mut ordinal = 0;
        for item in synthesis.items().iter().filter(|item| item.kind() == kind) {
            let names = display_names(record, item.contributors().iter().map(String::as_str));
            if !item.is_approved() || names.is_empty() {
                continue;
            }
            if ordinal == 0 {
                if parts.is_empty() {
                    parts.push((CONVERSATION_HEADING.to_string(), false));
                }
                parts.push((format!("### {heading} {{#conversation-{slug}}}"), false));
            }
            ordinal += 1;
            let names: Vec<String> = names.iter().map(|name| escape_markdown(name)).collect();
            parts.push((
                format!(
                    "#### Speaking for {} {{#conversation-{slug}-{ordinal}}}",
                    names.join(", ")
                ),
                false,
            ));
            parts.push((item.markdown().trim().to_string(), true));
        }
    }
    parts
}

/// [`conversation_parts`] as one Markdown block. The Post body and the combined preview both
/// render exactly this through the production renderer.
pub fn conversation_markdown(record: &SharedPublication, synthesis: &SynthesisSet) -> String {
    conversation_parts(record, synthesis)
        .into_iter()
        .map(|(text, _)| text)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Build the Post for `record` dated `date` (RFC 3339), or say why not. Pure.
pub fn assemble(
    record: &SharedPublication,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    approvals: &ApprovalSet,
    active: &[&str],
    date: &str,
) -> Result<Assembly, AssemblyError> {
    match with_subject(record, drafts, synthesis, active, |subject| {
        approvals.evaluate(subject)
    }) {
        Ok(Readiness::Ready) => {}
        Ok(Readiness::Blocked { missing }) => {
            return Err(AssemblyError::Blocked {
                missing: display_names(record, missing.iter().map(String::as_str)),
            })
        }
        Err(_) => return Err(AssemblyError::Invalid),
    }
    // Shared prose publishes only with every named author's approval of that exact item.
    let awaited = unapproved_item_authors(synthesis);
    if !awaited.is_empty() {
        return Err(AssemblyError::Blocked {
            missing: display_names(record, awaited.iter().map(String::as_str)),
        });
    }
    let title = record
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .ok_or(AssemblyError::Invalid)?;

    let mut prose = Vec::new();
    let mut credits = Vec::new();
    for participant in &record.collaboration.participants {
        if !active.contains(&participant.id.as_str()) {
            continue;
        }
        // The same latest revision the approval's binding covers, because the gate above just
        // evaluated it against these drafts.
        let Some(view) = drafts.latest_view(&participant.id) else {
            continue;
        };
        let binding = record
            .authorization
            .bindings
            .iter()
            .find(|binding| binding.participant_id == participant.id)
            .ok_or(AssemblyError::Invalid)?;
        prose.push(view.markdown.trim().to_string());
        credits.push(serde_json::json!({
            "contributor": binding.contributor_id,
            "roles": [{ "vocabulary": "crossref", "role": "author" }],
        }));
    }
    if prose.is_empty() || prose.iter().any(String::is_empty) {
        return Err(AssemblyError::Invalid);
    }

    let conversation = conversation_parts(record, synthesis);
    if has_unsafe_markup(&prose, &conversation) {
        return Err(AssemblyError::UnsafeMarkup);
    }
    let mut body = prose.join(SECTION_BREAK);
    if !conversation.is_empty() {
        body.push_str(SECTION_BREAK);
        body.push_str(&conversation_markdown(record, synthesis));
    }

    let mut fields: BTreeMap<String, Value> = BTreeMap::new();
    let scalar = |value: &str| Value::Scalar(value.to_string());
    let slug = slug::limit(&slug::slugify(title), 80);
    fields.insert("title".into(), scalar(title));
    fields.insert(
        "slug".into(),
        scalar(if slug.is_empty() {
            &record.publication_id
        } else {
            &slug
        }),
    );
    fields.insert("date".into(), scalar(date));
    if let Some(attribution) = SharedAttribution::from_record(record) {
        if let Some(question) = &attribution.question {
            fields.insert(QUESTION_KEY.into(), scalar(question));
        }
        if let Some(source) = &attribution.source {
            fields.insert(SOURCE_TITLE_KEY.into(), scalar(&source.title));
            if let Some(url) = &source.url {
                fields.insert(SOURCE_URL_KEY.into(), scalar(url));
            }
            fields.insert(SOURCE_KIND_KEY.into(), scalar(source.kind.label()));
        }
    }
    let path = post_path(record);
    let credits_path = crate::contributor::sidecar_path(&path).ok_or(AssemblyError::Invalid)?;
    let credits = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "credits": credits,
    }))
    .map_err(|_| AssemblyError::Invalid)?;
    Ok(Assembly {
        path,
        source: frontmatter::compose(&fields, &body),
        credits_path,
        credits: format!("{credits}\n"),
    })
}

/// Whether the joined body would publish anything but each author's own approved prose: raw
/// HTML, an active link or image address, heading attributes beyond an id and classes, or
/// Markdown in one section that changes how another renders (an open fence, a reference
/// definition, a footnote). Checked on the exact parse the site renders with, both with and
/// without smart punctuation because the site setting is not known here.
///
/// `conversation` is the generated synthesis block. Its own headings are trusted. Each prose
/// chunk is held to the same rules as a section, may not carry a heading of level one to four
/// (it would break the page outline under the generated headings), and must parse the same
/// inside the block as alone.
fn has_unsafe_markup(sections: &[String], conversation: &[(String, bool)]) -> bool {
    use pulldown_cmark::{Event, HeadingLevel, Parser, Tag};
    let unsafe_address = |address: &str| {
        let compact: String = address
            .chars()
            .filter(|c| !c.is_control() && !c.is_whitespace())
            .collect::<String>()
            .to_ascii_lowercase();
        match compact.find([':', '/', '?', '#']) {
            Some(at) if compact.as_bytes()[at] == b':' => {
                !matches!(&compact[..at], "http" | "https" | "mailto" | "tel")
            }
            _ => false,
        }
    };
    let scan = |events: &[Event<'_>], outline: bool| {
        events.iter().any(|event| match event {
            Event::Html(_) | Event::InlineHtml(_) => true,
            Event::Start(Tag::Heading { attrs, level, .. }) => {
                !attrs.is_empty()
                    || (outline
                        && matches!(
                            level,
                            HeadingLevel::H1
                                | HeadingLevel::H2
                                | HeadingLevel::H3
                                | HeadingLevel::H4
                        ))
            }
            Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) => {
                unsafe_address(dest_url)
            }
            _ => false,
        })
    };
    // Parsing `parts` joined by `joiner` must equal parsing each alone (with a rule between
    // them when `rule`), so no part can reach into its neighbour.
    let isolated = |parts: &[&str], joiner: &str, rule: bool, options| {
        let joined = parts.join(joiner);
        let mut separate: Vec<Event<'_>> = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            if index > 0 && rule {
                separate.push(Event::Rule);
            }
            separate.extend(Parser::new_ext(part, options));
        }
        Parser::new_ext(&joined, options).collect::<Vec<_>>() == separate
    };
    let block = conversation
        .iter()
        .map(|(text, _)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    [false, true].into_iter().any(|smart| {
        let options = crate::markdown::parser_options(smart);
        let mut blocks: Vec<&str> = sections.iter().map(String::as_str).collect();
        if !conversation.is_empty() {
            blocks.push(&block);
        }
        if !isolated(&blocks, SECTION_BREAK, true, options) {
            return true;
        }
        let chunks: Vec<&str> = conversation.iter().map(|(text, _)| text.as_str()).collect();
        if !isolated(&chunks, "\n\n", false, options) {
            return true;
        }
        sections
            .iter()
            .any(|text| scan(&Parser::new_ext(text, options).collect::<Vec<_>>(), false))
            || conversation
                .iter()
                .filter(|(_, prose)| *prose)
                .any(|(text, _)| scan(&Parser::new_ext(text, options).collect::<Vec<_>>(), true))
    })
}

/// What happened to a publication after approval. Absent means neither scheduled nor published.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Outcome {
    /// Held privately until `publish_at`, then published only if the approvals still hold.
    /// `requested_by` is the Admin account whose grant is checked again when it fires.
    Scheduled {
        version: u8,
        publish_at: i64,
        requested_by: String,
    },
    /// The Post and its credits were written. A retry changes nothing.
    Published { version: u8, published_at: i64 },
}

impl Outcome {
    pub fn scheduled(publish_at: i64, requested_by: &str) -> Self {
        Self::Scheduled {
            version: OUTCOME_VERSION,
            publish_at,
            requested_by: requested_by.to_string(),
        }
    }

    pub fn published(published_at: i64) -> Self {
        Self::Published {
            version: OUTCOME_VERSION,
            published_at,
        }
    }

    pub fn from_json(source: &str) -> Option<Self> {
        if source.len() > MAX_OUTCOME_BYTES {
            return None;
        }
        let outcome: Self = serde_json::from_str(source).ok()?;
        let valid = match &outcome {
            Self::Scheduled {
                version,
                publish_at,
                requested_by,
            } => {
                *version == OUTCOME_VERSION
                    && *publish_at >= 0
                    && valid_admin_username(requested_by)
            }
            Self::Published {
                version,
                published_at,
            } => *version == OUTCOME_VERSION && *published_at >= 0,
        };
        valid.then_some(outcome)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("an outcome always serializes")
    }
}

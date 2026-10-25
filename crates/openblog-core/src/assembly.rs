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
use crate::reflection::{compose, strip_part_markers, ComposedTurn, ReflectionStructure};
use crate::shared_source::{
    SharedAttribution, QUESTION_KEY, SOURCE_KIND_KEY, SOURCE_TITLE_KEY, SOURCE_URL_KEY,
};
use crate::slug;

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

/// The metadata the approval subject binds for `record`: the public record fields and, when the
/// publication has a [`ReflectionStructure`], its prose-free binding frame (ADR 0031), so a
/// change of layout, turn order or round prompt makes standing approvals stale exactly as a
/// change of prose does. With no structure nothing is appended and approvals given before one
/// existed stay valid. Every path that builds an [`ApprovalSubject`] (the gate, the preview and
/// the Admin routes) goes through here.
pub fn subject_metadata(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
) -> Vec<String> {
    let mut metadata = public_metadata(record);
    if let Some(structure) = structure {
        metadata.push(format!("reflection-frame:{}", structure.binding_frame()));
    }
    metadata
}

/// Run `ask` against the approval subject for the active authors as the content is now, with no
/// reflection structure. See [`with_subject_for`].
pub fn with_subject<R>(
    record: &SharedPublication,
    drafts: &DraftSet,
    active: &[&str],
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    with_subject_for(record, None, drafts, active, ask)
}

/// Run `ask` against the approval subject for the active authors as the content is now. This is
/// the one place the subject is built from the record and drafts, so the approval binding a
/// preview hands out and the one the gate checks cannot drift apart.
pub fn with_subject_for<R>(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
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
    let metadata = subject_metadata(record, structure);
    let metadata: Vec<&str> = metadata.iter().map(String::as_str).collect();
    ask(&ApprovalSubject {
        authors: &authors,
        sections: &sections,
        metadata: &metadata,
    })
}

/// Build the Post for `record` dated `date` (RFC 3339), or say why not. Pure. For a publication
/// with no stored arrangement; see [`assemble_for`].
pub fn assemble(
    record: &SharedPublication,
    drafts: &DraftSet,
    approvals: &ApprovalSet,
    active: &[&str],
    date: &str,
) -> Result<Assembly, AssemblyError> {
    assemble_for(record, None, drafts, approvals, active, date)
}

/// Build the Post for `record` dated `date` (RFC 3339), or say why not. Pure. With a `structure`
/// the sections follow its reading order and are wrapped in the arranged markup of
/// [`compose`] (ADR 0032), and credits are one per participant at their first appearance
/// (ADR 0031); without one the sections are the participants' drafts in participant order. Part
/// marker lines never reach the Post either way.
pub fn assemble_for(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    approvals: &ApprovalSet,
    active: &[&str],
    date: &str,
) -> Result<Assembly, AssemblyError> {
    match with_subject_for(record, structure, drafts, active, |subject| {
        approvals.evaluate(subject)
    }) {
        Ok(Readiness::Ready) => {}
        Ok(Readiness::Blocked { missing }) => {
            return Err(AssemblyError::Blocked {
                missing: missing
                    .iter()
                    .filter_map(|id| {
                        record
                            .collaboration
                            .participants
                            .iter()
                            .find(|participant| &participant.id == id)
                    })
                    .map(|participant| participant.display_name.clone())
                    .collect(),
            })
        }
        Err(_) => return Err(AssemblyError::Invalid),
    }
    let title = record
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .ok_or(AssemblyError::Invalid)?;

    let credit_for = |participant_id: &str| -> Result<serde_json::Value, AssemblyError> {
        let binding = record
            .authorization
            .bindings
            .iter()
            .find(|binding| binding.participant_id == participant_id)
            .ok_or(AssemblyError::Invalid)?;
        Ok(serde_json::json!({
            "contributor": binding.contributor_id,
            "roles": [{ "vocabulary": "crossref", "role": "author" }],
        }))
    };
    let mut prose = Vec::new();
    let mut credits = Vec::new();
    let mut arranged = None;
    if let Some(structure) = structure {
        if !structure.layout.is_presentable() {
            return Err(AssemblyError::Invalid);
        }
        // The same latest revisions the approval's binding covers, in the one reading order.
        let order = structure
            .reading_order(&record.collaboration, drafts)
            .map_err(|_| AssemblyError::Invalid)?;
        let order: Vec<_> = order
            .into_iter()
            .filter(|entry| active.contains(&entry.participant_id) && entry.markdown.is_some())
            .collect();
        let placements = ReflectionStructure::placements(structure.layout, &order);
        let mut turns = Vec::new();
        let mut credited: Vec<&str> = Vec::new();
        for (entry, placement) in order.iter().zip(placements) {
            let text = entry.markdown.as_deref().unwrap_or_default().trim();
            if text.is_empty() {
                return Err(AssemblyError::Invalid);
            }
            if !credited.contains(&entry.participant_id) {
                credited.push(entry.participant_id);
                credits.push(credit_for(entry.participant_id)?);
            }
            prose.push(text.to_string());
            turns.push(ComposedTurn {
                round: entry.round,
                round_prompt: structure.rounds[entry.round].round_prompt.as_deref(),
                display_name: entry.display_name,
                placement,
                body: text.to_string(),
            });
        }
        arranged = Some(compose(structure.layout, &turns));
    } else {
        for participant in &record.collaboration.participants {
            if !active.contains(&participant.id.as_str()) {
                continue;
            }
            // The same latest revision the approval's binding covers, because the gate above
            // just evaluated it against these drafts.
            let Some(view) = drafts.latest_view(&participant.id) else {
                continue;
            };
            credits.push(credit_for(&participant.id)?);
            prose.push(strip_part_markers(&view.markdown).trim().to_string());
        }
    }
    if prose.is_empty() || prose.iter().any(String::is_empty) {
        return Err(AssemblyError::Invalid);
    }

    if has_unsafe_markup(&prose) {
        return Err(AssemblyError::UnsafeMarkup);
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
        source: frontmatter::compose(
            &fields,
            &arranged.unwrap_or_else(|| prose.join(SECTION_BREAK)),
        ),
        credits_path,
        credits: format!("{credits}\n"),
    })
}

/// Whether the joined body would publish anything but each author's own approved prose: raw
/// HTML, an active link or image address, heading attributes beyond an id and classes, or
/// Markdown in one section that changes how another renders (an open fence, a reference
/// definition, a footnote). Checked on the exact parse the site renders with, both with and
/// without smart punctuation because the site setting is not known here.
const TAIL_SENTINEL: &str = "tail";

fn has_unsafe_markup(sections: &[String]) -> bool {
    use pulldown_cmark::{Event, Parser, Tag};
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
    [false, true].into_iter().any(|smart| {
        let options = crate::markdown::parser_options(smart);
        // A sentinel section after the last one stands for the markup that follows the prose in
        // the published Post (the arrangement's closing tags): an open fence in the last section
        // would swallow it, so it must stay a separate section like every other boundary.
        let mut all: Vec<&str> = sections.iter().map(String::as_str).collect();
        all.push(TAIL_SENTINEL);
        let joined = all.join(SECTION_BREAK);
        let mut separate: Vec<Event<'_>> = Vec::new();
        for (index, section) in all.iter().enumerate() {
            if index > 0 {
                separate.push(Event::Rule);
            }
            separate.extend(Parser::new_ext(section, options));
        }
        let together: Vec<Event<'_>> = Parser::new_ext(&joined, options).collect();
        together != separate
            || together.iter().any(|event| match event {
                Event::Html(_) | Event::InlineHtml(_) => true,
                Event::Start(Tag::Heading { attrs, .. }) => !attrs.is_empty(),
                Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) => {
                    unsafe_address(dest_url)
                }
                _ => false,
            })
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

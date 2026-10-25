//! The approval-aware combined review preview of a shared publication.
//!
//! One side-effect-free function assembles what a signed-in author may review: every author's
//! section in participant order at its exact current revision, each author's approval state, and
//! a self-contained HTML document that cannot be mistaken for published output. It reads drafts
//! and approvals and writes nothing, so a failure leaves canonical content untouched.
//!
//! A section is rendered only when the requester is entitled to the author's *latest* revision,
//! decided by [`DraftSet::view`] alone: their own, or one revealed to them. An older revealed
//! revision is not shown, so the preview never presents a piece that differs from what an approval
//! would cover. Everything else is one uniform placeholder: an unshared draft, an unrevealed
//! newer revision, a withdrawn draft and an author who has written nothing look the same, and
//! nothing about their prose, revision numbers or digests is returned.
//!
//! The document is built to run without JavaScript: its policy forbids scripts, frames, forms,
//! images and every network fetch, and the caller shows it in a sandboxed frame. Prose goes
//! through the production Markdown renderer with the site's own options, so the preview matches
//! what posts publish; the policy, not the options, stops images, embeds and runners from loading.

use serde::Serialize;

use crate::approval::{ApprovalSet, ApprovalState, Readiness, Section};
use crate::assembly::display_names;
use crate::collaboration::SharedPublication;
use crate::draft::DraftSet;
use crate::escape;
use crate::markdown::{self, RenderOptions};
use crate::shared_source::SharedAttribution;
use crate::synthesis::{SynthesisKind, SynthesisSet};

/// The policy the preview document carries. Nothing loads, nothing runs.
pub const PREVIEW_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; \
form-action 'none'; frame-ancestors 'self'";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewError {
    /// The requester is not a current author of this publication.
    Denied,
}

impl std::fmt::Display for PreviewError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("preview access denied")
    }
}

impl std::error::Error for PreviewError {}

/// One author's place in the combined piece.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSection {
    pub participant_id: String,
    pub display_name: String,
    /// Whether this author's section is rendered in the document for the requester.
    pub shown: bool,
    /// The exact revision rendered; absent whenever the section is not shown.
    pub revision: Option<u64>,
    pub approval: ApprovalState,
    /// Whether the approval policy needs this author's approval.
    pub required: bool,
    /// Content problems the renderer found in a shown section.
    pub errors: Vec<String>,
}

/// One synthesis item's approval standing, for an author of the piece.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
    pub id: String,
    pub kind: SynthesisKind,
    pub revision: u64,
    /// Display names of the authors the item speaks for, in attribution order.
    pub authors: Vec<String>,
    pub approved: Vec<String>,
    pub awaiting: Vec<String>,
    /// Whether the requester is named on the item.
    pub mine: bool,
}

fn preview_items(
    record: &SharedPublication,
    synthesis: &SynthesisSet,
    requester: &str,
) -> Vec<PreviewItem> {
    let names = |ids: Vec<&str>| display_names(record, ids);
    synthesis
        .items()
        .iter()
        .map(|item| PreviewItem {
            id: item.id().to_string(),
            kind: item.kind(),
            revision: item.revision(),
            authors: names(item.contributors().iter().map(String::as_str).collect()),
            approved: names(item.approved_by()),
            awaiting: names(item.awaiting()),
            mine: item.contributors().iter().any(|c| c == requester),
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CombinedPreview {
    pub sections: Vec<PreviewSection>,
    /// Every section that exists is shown to the requester. An author who wrote nothing has no
    /// section and does not block it.
    pub complete: bool,
    /// Complete, and the approval gate would pass for the piece as it is now.
    pub ready: bool,
    /// The token the requester's own approval would bind to; only issued for a complete piece.
    pub seen: Option<String>,
    /// The shared synthesis items with who has approved each. Prose is in `document` only.
    pub items: Vec<PreviewItem>,
    /// A self-contained, script-free HTML document marked as a preview.
    pub document: String,
}

/// Render one section's prose with the site's production Markdown options (see
/// [`crate::config::SiteConfig::render_options`]), the same ones `Site::load` uses for posts.
pub fn render_section(markdown_source: &str, options: RenderOptions<'_>) -> markdown::Rendered {
    markdown::render(markdown_source, options)
}

fn approval_label(state: ApprovalState) -> &'static str {
    match state {
        ApprovalState::Approved => "Approved",
        ApprovalState::Stale => "Approval out of date: the piece changed after it was given",
        ApprovalState::Awaiting => "Awaiting approval",
    }
}

/// Build the preview `requester` may see, from the active authors in participant order.
///
/// `active` are the participants who currently hold the draft grant; the requester must be one.
/// `show_synthesis` is true only when the requester holds `EditSynthesis`; otherwise the items and
/// the conversation section are left out (readiness still counts them).
/// `options` are the site's production Markdown options. Pure: it never writes drafts or
/// approvals.
pub fn build(
    record: &SharedPublication,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    approvals: &ApprovalSet,
    requester: &str,
    active: &[&str],
    show_synthesis: bool,
    options: RenderOptions<'_>,
) -> Result<CombinedPreview, PreviewError> {
    if !active.contains(&requester) {
        return Err(PreviewError::Denied);
    }
    let authors: Vec<&crate::collaboration::Participant> = record
        .collaboration
        .participants
        .iter()
        .filter(|participant| active.contains(&participant.id.as_str()))
        .collect();

    // The piece as publication would assemble it now: each active author's latest revision.
    let stamps: Vec<_> = authors
        .iter()
        .map(|author| drafts.current_stamp(&author.id))
        .collect();
    let subject_sections: Vec<Section<'_>> = authors
        .iter()
        .zip(&stamps)
        .filter_map(|(author, stamp)| {
            let stamp = stamp.as_ref()?;
            Some(Section {
                contribution_id: &stamp.contribution_id,
                owner: &author.id,
                revision: stamp.number,
                digest: &stamp.digest,
            })
        })
        .collect();
    crate::assembly::with_subject(record, drafts, synthesis, active, |subject| {
        let mut sections = Vec::new();
        let mut rendered = Vec::new();
        for (author, stamp) in authors.iter().zip(&stamps) {
            let entitled = stamp.as_ref().and_then(|stamp| {
                let view = drafts.view(requester, &author.id, active).ok()?;
                (view.stamp.number == stamp.number && view.stamp.digest == stamp.digest)
                    .then_some(view)
            });
            let prose = entitled
                .as_ref()
                .map(|view| render_section(&view.markdown, options));
            sections.push(PreviewSection {
                participant_id: author.id.clone(),
                display_name: author.display_name.clone(),
                shown: prose.is_some(),
                revision: entitled.as_ref().map(|view| view.stamp.number),
                approval: approvals.state(subject, &author.id),
                required: approvals.is_required(subject, &author.id),
                errors: prose.as_ref().map(|r| r.errors.clone()).unwrap_or_default(),
            });
            rendered.push(prose.map(|r| r.html));
        }

        // Complete means every section that exists is shown. An author who owns no section adds no
        // content to be missed, so they can still approve the whole piece (ADR 0020).
        let complete = !subject_sections.is_empty()
            && sections
                .iter()
                .zip(&stamps)
                .all(|(section, stamp)| stamp.is_none() || section.shown);
        let items = preview_items(record, synthesis, requester);
        let ready = complete
            && approvals.evaluate(subject) == Ok(Readiness::Ready)
            && items.iter().all(|item| item.awaiting.is_empty());
        // Synthesis is for its authors only (EditSynthesis). Readiness above still counts every
        // item, but anyone who may not edit the synthesis sees neither its prose nor its names.
        let items = if show_synthesis { items } else { Vec::new() };
        let seen = if complete {
            approvals.binding_for(subject, requester).ok()
        } else {
            None
        };
        let document = document(
            record,
            &sections,
            &rendered,
            &conversation_html(&items, synthesis, options),
            complete,
            ready,
        );
        Ok(CombinedPreview {
            sections,
            complete,
            ready,
            seen,
            items,
            document,
        })
    })
}

fn conversation_html(
    items: &[PreviewItem],
    synthesis: &SynthesisSet,
    options: RenderOptions<'_>,
) -> String {
    let mut html = String::new();
    if !items.is_empty() {
        html.push_str(
            "<section class=\"ob-preview-section\" aria-label=\"Continuing conversation\">\n",
        );
        html.push_str("<h2>Continuing conversation</h2>\n");
        for (entry, item) in items.iter().zip(synthesis.items()) {
            html.push_str(&format!(
                "<article class=\"ob-preview-item\">\n<p class=\"ob-preview-status\">{}, speaking for {}. Approved by: {}. Awaiting: {}.</p>\n",
                escape::text(kind_label(entry.kind)),
                escape::text(&entry.authors.join(", ")),
                escape::text(&list_or_none(&entry.approved)),
                escape::text(&list_or_none(&entry.awaiting)),
            ));
            html.push_str("<div class=\"ob-preview-prose\">\n");
            html.push_str(&render_section(item.markdown(), options).html);
            html.push_str("</div>\n</article>\n");
        }
        html.push_str("</section>\n");
    }
    html
}

fn document(
    record: &SharedPublication,
    sections: &[PreviewSection],
    rendered: &[Option<String>],
    conversation: &str,
    complete: bool,
    ready: bool,
) -> String {
    let title = record
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or("Untitled shared reflection");
    let mut html = String::new();
    html.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
    html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    html.push_str("<meta name=\"robots\" content=\"noindex, nofollow\">\n");
    html.push_str("<meta name=\"referrer\" content=\"no-referrer\">\n");
    html.push_str(&format!(
        "<meta http-equiv=\"Content-Security-Policy\" content=\"{}\">\n",
        escape::attr(PREVIEW_CSP)
    ));
    html.push_str(&format!(
        "<title>Preview, not published: {}</title>\n",
        escape::text(title)
    ));
    html.push_str(STYLE);
    html.push_str("</head>\n<body>\n");
    html.push_str(
        "<p class=\"ob-preview-banner\" role=\"note\"><strong>Preview, not published.</strong> ",
    );
    html.push_str(
        "Only authors of this piece can see it. Nothing here is public until it is published. ",
    );
    html.push_str("Images and embeds are not loaded in this preview.</p>\n");
    html.push_str(&format!(
        "<p class=\"ob-preview-state\" role=\"status\">{}</p>\n",
        if ready {
            "Every required author has approved this exact piece."
        } else if complete {
            "Not ready to publish: approvals are missing or out of date."
        } else {
            "Incomplete: some sections are not shared with you at their current revision."
        }
    ));
    html.push_str(&format!("<h1>{}</h1>\n", escape::text(title)));
    if let Some(attribution) = SharedAttribution::from_record(record) {
        html.push_str(&attribution.html());
    }
    html.push_str("<ol class=\"ob-preview-authors\" aria-label=\"Authors and approval\">\n");
    for section in sections {
        html.push_str(&format!(
            "<li>{}: {}</li>\n",
            escape::text(&section.display_name),
            escape::text(approval_label(section.approval))
        ));
    }
    html.push_str("</ol>\n");
    for (section, prose) in sections.iter().zip(rendered) {
        html.push_str("<section class=\"ob-preview-section\">\n");
        match (prose, section.revision) {
            (Some(prose), Some(revision)) => {
                html.push_str(&format!(
                    "<p class=\"ob-preview-status\">{}, revision {}. {}</p>\n",
                    escape::text(&section.display_name),
                    revision,
                    escape::text(approval_label(section.approval))
                ));
                html.push_str("<div class=\"ob-preview-prose\">\n");
                html.push_str(prose);
                html.push_str("</div>\n");
            }
            _ => html.push_str(&format!(
                "<p class=\"ob-preview-status ob-preview-hidden\">{}: not shared with you at its current revision.</p>\n",
                escape::text(&section.display_name)
            )),
        }
        html.push_str("</section>\n");
    }
    html.push_str(conversation);
    html.push_str("</body>\n</html>\n");
    html
}

fn list_or_none(names: &[String]) -> String {
    if names.is_empty() {
        "no one".to_string()
    } else {
        names.join(", ")
    }
}

fn kind_label(kind: SynthesisKind) -> &'static str {
    match kind {
        SynthesisKind::Agreement => "Agreement",
        SynthesisKind::Difference => "Difference",
        SynthesisKind::Question => "Question",
        SynthesisKind::Application => "Application",
        SynthesisKind::Uncertainty => "Uncertainty",
    }
}

const STYLE: &str = "<style>\n\
:root { color-scheme: light dark; --ink: #1b1b1f; --paper: #fff; --line: #b8b8c0; --warn: #7a4a00; --warn-bg: #fff4d6; }\n\
@media (prefers-color-scheme: dark) { :root { --ink: #ececf0; --paper: #17171a; --line: #4a4a52; --warn: #ffd88a; --warn-bg: #3a2c0a; } }\n\
body { margin: 0 auto; max-width: 42rem; padding: 1rem; font: 1rem/1.6 system-ui, sans-serif; color: var(--ink); background: var(--paper); }\n\
.ob-preview-banner { border: 2px dashed var(--warn); background: var(--warn-bg); color: var(--warn); padding: .5rem .75rem; }\n\
.ob-preview-state { font-weight: 600; }\n\
.ob-preview-authors { padding-left: 1.25rem; }\n\
.ob-preview-section { border-top: 1px solid var(--line); margin-top: 1.5rem; padding-top: .5rem; }\n\
.ob-preview-status { font-size: .875rem; font-weight: 600; }\n\
.ob-preview-hidden { font-style: italic; }\n\
img { max-width: 100%; }\n\
</style>\n";

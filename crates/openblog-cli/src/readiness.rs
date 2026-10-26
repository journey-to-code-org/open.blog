//! The research readiness report (#194, ADR 0148): one report of what every
//! research check says about the site as the next build would publish it,
//! shown the same way by Admin, `openblog check`, `openblog build` and the
//! preview that serves a build.
//!
//! Nothing here checks anything. [`gather`] reads the findings each owning
//! validator already reports, through the same loaders the build and the
//! review before publication use ([`crate::research_review`]), and hands
//! them to the one contract, [`openblog_core::research_completeness`]. The
//! report is the contract's own: the codes, the order, the groups, the counts
//! and the acknowledgements are the contract's, so a finding reads the same in
//! Admin, in the terminal and in machine-readable output.
//!
//! It is a report of prompts, never a verdict. It has no score, no total and
//! no pass or fail: outcomes are counted apart, only a failure of a private
//! file the build reads blocks the next build, and acknowledging a finding
//! keeps it listed and counted. It reads only: no file is written, repaired or
//! replaced, and a sentence the validators state names ids, fields and stated
//! values, never a statement, note, excerpt or label.

use std::path::Path;

use openblog_core::context_links;
use openblog_core::frontmatter;
use openblog_core::publication_review::{PublicationReview, ReviewFinding, ReviewScope};
use openblog_core::research_completeness::CompletenessReport;
use openblog_core::Site;
use serde_json::Value;

use crate::research_review::{self, Gathered, NotReviewed};
use crate::{alignment_store, atlas_store, claims_store, notebook_store, source_store};

/// The acknowledgements file as a report read it: its revision for the next
/// change to name, or why it could not be read. Never repaired.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Acknowledgements {
    pub revision: Option<String>,
    pub error: Option<String>,
}

/// The report of one site.
#[derive(Debug)]
pub struct Readiness {
    pub applies: bool,
    pub review: PublicationReview,
    pub not_reviewed: Vec<NotReviewed>,
    pub acknowledgements: Acknowledgements,
}

impl Readiness {
    /// How many findings block the next build: a failure of a private file it
    /// reads, which it refuses. Nothing else blocks.
    pub fn blocking(&self) -> usize {
        self.review.blocking()
    }

    /// The report as machine-readable JSON, exactly as Admin receives it:
    /// the contract's findings in the contract's order, their groups and
    /// counts, and what could not be reviewed.
    pub fn view(&self) -> Value {
        research_review::view(
            &self.review,
            self.applies,
            &self.not_reviewed,
            &self.acknowledgements,
        )
    }

    /// Deterministic, pretty-printed JSON with a trailing newline.
    pub fn json(&self) -> String {
        let mut json = serde_json::to_string_pretty(&self.view()).unwrap_or_default();
        json.push('\n');
        json
    }

    /// The findings, one line each in Admin's order, then the counts, then
    /// what was not reviewed. Empty when the report has nothing to say, so a
    /// site without research output reads exactly as before.
    pub fn text(&self) -> String {
        let mut text = self.review.text();
        for item in &self.not_reviewed {
            text.push_str(&format!("research not reviewed: {}\n", item.message));
        }
        if let Some(error) = &self.acknowledgements.error {
            if !text.is_empty() {
                text.push_str(&format!(
                    "research acknowledgements unavailable, so none are shown or saved: {error}\n"
                ));
            }
        }
        text
    }
}

/// Whether the site has any research for the report to be about: a post on
/// the Research profile or that publishes citations, a stored private
/// research file, or a finding. A site without any is not reported on, so its
/// `check` and `build` output stays byte for byte what it was.
pub fn applies(root: &Path, site: &Site) -> bool {
    !site.evidence.is_empty()
        || !site.source_review.is_empty()
        || site
            .posts
            .iter()
            .any(|post| post.research.is_some() || post.citations().is_some())
        || [
            source_store::LIBRARY_FILE,
            notebook_store::NOTEBOOK_FILE,
            atlas_store::ATLAS_FILE,
            claims_store::CLAIMS_FILE,
            alignment_store::ALIGNMENTS_FILE,
        ]
        .iter()
        .any(|file| std::fs::symlink_metadata(root.join(file)).is_ok())
}

/// Read the report of the site as loaded. Reads only; nothing is written.
pub fn report(root: &Path, site: &Site) -> Readiness {
    let applies = applies(root, site);
    let gathered = if applies {
        gather(root, site)
    } else {
        Gathered::default()
    };
    let (acknowledgements, info) = research_review::acknowledgements(root);
    let review = PublicationReview::scoped(
        CompletenessReport::new(gathered.findings, &acknowledgements),
        ReviewScope::Site,
    );
    let mut not_reviewed = gathered.not_reviewed;
    not_reviewed.sort_by(|a, b| (a.part, &a.message).cmp(&(b.part, &b.message)));
    not_reviewed.dedup();
    Readiness {
        applies,
        review,
        not_reviewed,
        acknowledgements: info,
    }
}

/// Everything the research checks say about the site: each owning validator's
/// findings, in the contract's shape. The order is the contract's, whatever
/// order they are gathered in.
pub fn gather(root: &Path, site: &Site) -> Gathered {
    let config = &site.config;
    let contributors = &config.contributors;
    let mut gathered = Gathered::default();
    gathered
        .findings
        .extend(site.evidence.iter().map(ReviewFinding::from_evidence));
    gathered.findings.extend(
        site.source_review
            .iter()
            .map(ReviewFinding::from_source_review),
    );

    // What the build reads, once and on its own: the finding of a file it
    // cannot read is scoped to that file and blocks the build.
    let published = research_review::read_published(root, config, &mut gathered);
    let reads_atlas = config.knowledge_atlas.publish;
    let reads_comparisons = config.comparisons.publish;
    let reads_claims = config.claim_evidence.publish;

    // The library and notebook the stored research is reviewed against.
    let library = source_store::load(root, contributors);
    let notebook = notebook_store::load(root, contributors);
    match (&library, &notebook) {
        (Ok(library), Ok(notebook)) => {
            if library.stored {
                gathered.findings.extend(
                    openblog_core::source_review::review_library(
                        &library.library,
                        &notebook.notebook,
                    )
                    .iter()
                    .map(ReviewFinding::from_source_review),
                );
            }
        }
        // When the build reads research, the finding of why is already in the
        // report, scoped to the file; otherwise nothing is blamed.
        _ if reads_atlas || reads_comparisons || (reads_claims && published.claims_stored) => {}
        _ => gathered.not_reviewed.push(NotReviewed {
            part: "source-review",
            message: format!(
                "The library and notebook were not reviewed because one of them cannot be read. Repair {} or {} by hand.",
                source_store::LIBRARY_FILE,
                notebook_store::NOTEBOOK_FILE
            ),
        }),
    }

    // The atlas: its projection notices and its chronology prompts.
    match atlas_store::load(root, contributors) {
        Ok(snapshot) if snapshot.stored => {
            gathered.findings.extend(
                snapshot
                    .atlas
                    .notices()
                    .iter()
                    .map(ReviewFinding::from_atlas_diagnostic),
            );
            gathered.findings.extend(
                openblog_core::chronology_index::ChronologyIndex::of(&snapshot.atlas)
                    .prompts
                    .iter()
                    .map(ReviewFinding::from_chronology_prompt),
            );
        }
        Ok(_) => {}
        Err(error) => unread(
            &mut gathered,
            reads_atlas,
            "atlas",
            atlas_store::ATLAS_FILE,
            &error.to_string(),
        ),
    }

    // The claims file: its evidence review of the saved drafts, and its
    // projection notices.
    match claims_store::load(root, contributors) {
        Ok(snapshot) if snapshot.stored => {
            gathered.findings.extend(
                claims_store::review(&snapshot, root, &config.paths.content)
                    .iter()
                    .map(ReviewFinding::from_evidence),
            );
            gathered.findings.extend(
                snapshot
                    .claims
                    .notices()
                    .iter()
                    .map(ReviewFinding::from_atlas_diagnostic),
            );
        }
        Ok(_) => {}
        Err(error) => unread(
            &mut gathered,
            reads_claims,
            "claims",
            claims_store::CLAIMS_FILE,
            &error.to_string(),
        ),
    }

    // The alignments file: its place notices, and the wording a published
    // comparison leaves out.
    match alignment_store::load(root, contributors) {
        Ok(snapshot) if snapshot.stored => {
            gathered.findings.extend(
                snapshot
                    .alignments
                    .notices(openblog_core::knowledge_atlas::Links {
                        library: &snapshot.library,
                        notebook: &snapshot.notebook,
                    })
                    .iter()
                    .map(ReviewFinding::from_atlas_diagnostic),
            );
        }
        Ok(_) => {}
        Err(error) => unread(
            &mut gathered,
            reads_comparisons,
            "alignments",
            alignment_store::ALIGNMENTS_FILE,
            &error.to_string(),
        ),
    }
    if let Some(projection) = &published.comparisons {
        for comparison in &projection.comparisons {
            gathered
                .findings
                .extend(ReviewFinding::from_comparison(comparison));
        }
    }

    // The context links of every post the site holds.
    let held: std::collections::BTreeSet<&str> =
        site.posts.iter().map(|post| post.source.as_str()).collect();
    for (path, source) in claims_store::saved_post_sources(root, &config.paths.content) {
        if !held.contains(path.as_str()) {
            continue;
        }
        let Ok(document) = frontmatter::parse(&source) else {
            continue;
        };
        let links = context_links::find_context_links(&document.body, document.body_line);
        gathered.findings.extend(research_review::link_findings(
            &path, &links, config, &published,
        ));
    }
    gathered
}

/// A stored file that cannot be read. When the build reads it, the finding of
/// why is already in the report; otherwise the report says it was not
/// reviewed, and nothing is repaired.
fn unread(gathered: &mut Gathered, reads: bool, part: &'static str, file: &str, error: &str) {
    if reads {
        return;
    }
    gathered.not_reviewed.push(NotReviewed {
        part,
        message: format!(
            "{file} was not reviewed because it cannot be read ({}). Repair it by hand.",
            research_review::first_line(error)
        ),
    });
}

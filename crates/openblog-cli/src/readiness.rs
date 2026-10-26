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
    #[cfg(test)]
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
        if text.is_empty() && self.applies && self.not_reviewed.is_empty() {
            // A research site that raised nothing says so, rather than nothing.
            text.push_str(
                "Research checks: nothing to review
",
            );
        }
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

/// The report of the site, from one fixed set of posts: every saved post,
/// whatever the load that is building, serving or checking holds back. A
/// draft or a post waiting for its date is warn-only in a site report
/// (`ReviewScope::Site`), so reading it changes no outcome of the build, and
/// Admin, `check`, `check --json`, `build` and `serve` all list the same
/// codes in the same order whether or not they include drafts.
///
/// When `site` was loaded without every saved post, they are read once more,
/// and that load is kept for as long as the saved files stay as they are, so
/// a rebuild of unchanged content or a second reader pays nothing again.
/// Reads only; nothing is written.
pub fn report(root: &Path, site: &Site) -> Readiness {
    match canonical(root) {
        Some(all) => report_of_all(root, &all),
        None => report_of_all(root, site),
    }
}

/// [`report`] for a site that already holds every saved post: one loaded
/// with drafts and no clock, as `openblog check` does.
pub fn report_of_all(root: &Path, site: &Site) -> Readiness {
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

/// A build error with the research report beside it, for a site that has
/// research, so the findings behind a refusal are listed with the same codes
/// and order `check` and Admin show (ADR 0148). The error is unchanged, and
/// a site without research gets exactly the error it always got.
pub fn alongside(root: &Path, site: &Site, error: String) -> String {
    let report = report(root, site);
    let text = report.text();
    if !report.applies || (report.review.findings.is_empty() && report.not_reviewed.is_empty()) {
        return error;
    }
    format!(
        "{error}
{}",
        text.trim_end()
    )
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
    let published = research_review::read_published(root, config, &mut gathered, true);
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
        _ if !exists(root, source_store::LIBRARY_FILE) && !exists(root, notebook_store::NOTEBOOK_FILE) => {}
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
            root,
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
            root,
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
            root,
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
fn unread(
    root: &Path,
    gathered: &mut Gathered,
    reads: bool,
    part: &'static str,
    file: &str,
    error: &str,
) {
    // A file that is not there is not unreadable: there is nothing to review.
    if reads || std::fs::symlink_metadata(root.join(file)).is_err() {
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

/// The site with every saved post, kept per project while its saved files are
/// unchanged. `None` when it cannot be loaded, so the caller's own site is
/// reported instead of nothing.
fn canonical(root: &Path) -> Option<std::sync::Arc<Site>> {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    type Kept = HashMap<std::path::PathBuf, (u64, Arc<Site>)>;
    static KEPT: OnceLock<Mutex<Kept>> = OnceLock::new();
    let kept = KEPT.get_or_init(|| Mutex::new(HashMap::new()));
    let revision = content_revision(root)?;
    if let Some((held, site)) = kept.lock().ok()?.get(root) {
        if *held == revision {
            return Some(Arc::clone(site));
        }
    }
    let (site, _) = crate::site::load_site(root, true, None).ok()?;
    let site = Arc::new(site);
    let mut kept = kept.lock().ok()?;
    if kept.len() >= 8 {
        kept.clear();
    }
    kept.insert(root.to_path_buf(), (revision, Arc::clone(&site)));
    Some(site)
}

/// A fingerprint of every saved file a site load reads for the research
/// report: the configuration, the content folder and the private research
/// files. Their bytes, not their times, so two edits in one clock tick are
/// told apart.
fn content_revision(root: &Path) -> Option<u64> {
    use std::hash::{Hash, Hasher};
    let config = crate::site::load_config(root).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut files = vec![root.join("openblog.json")];
    files.extend(crate::fsutil::walk(&root.join(&config.paths.content)));
    files.extend(crate::fsutil::walk(&root.join(".openblog").join("private")));
    for file in files {
        file.strip_prefix(root).unwrap_or(&file).hash(&mut hasher);
        std::fs::read(&file).ok().hash(&mut hasher);
    }
    Some(hasher.finish())
}

fn exists(root: &Path, file: &str) -> bool {
    std::fs::symlink_metadata(root.join(file)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_is_reported_unread_only_when_it_exists() {
        let root = std::env::temp_dir().join(format!("ob-readiness-unread-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".openblog/private/research")).unwrap();
        let mut gathered = Gathered::default();
        unread(
            &root,
            &mut gathered,
            false,
            "atlas",
            atlas_store::ATLAS_FILE,
            "x",
        );
        assert!(gathered.not_reviewed.is_empty(), "nothing to review");
        std::fs::write(root.join(atlas_store::ATLAS_FILE), "{").unwrap();
        unread(
            &root,
            &mut gathered,
            false,
            "atlas",
            atlas_store::ATLAS_FILE,
            "x",
        );
        assert_eq!(gathered.not_reviewed.len(), 1);
        unread(
            &root,
            &mut gathered,
            true,
            "atlas",
            atlas_store::ATLAS_FILE,
            "x",
        );
        assert_eq!(
            gathered.not_reviewed.len(),
            1,
            "the build's own finding stands"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}

//! The research review before publication (#62, ADR 0123, ADR 0124),
//! presented over the one research-completeness contract (ADR 0144,
//! ADR 0145, ADR 0147).
//!
//! Before a post is published or scheduled, Admin gathers what the existing
//! research checks already say about it. Nothing here checks anything
//! itself, and nothing here models a finding: the finding shape, the matrix
//! of validators, checks, categories, outcomes and gates, the
//! acknowledgement record, its stored file, key and fingerprint, the order
//! and the counts are all [`crate::research_completeness`]'s. This module
//! only groups a [`CompletenessReport`] for the moment before publishing:
//! what the build refuses first, then advisory findings by outcome.
//!
//! The names the review used before the contract was unified are kept as
//! aliases, so the same JSON, the same stored acknowledgements and the same
//! fingerprints serve every report.
//!
//! The review is a prompt, never a verdict. There is no score, total, pass,
//! ready or resolved field.

use serde::Serialize;

pub use crate::research_completeness::{
    acknowledgeable, looks_like_acknowledgements, Acknowledgement, AcknowledgementSet,
    AcknowledgementState, Category, Check, CompletenessFinding as ReviewFinding, FindingScope,
    Gate, ObjectKind, ObjectRef, OutcomeCount, OutcomeCounts, ReportEntry as ReviewEntry,
    Validator, ACKNOWLEDGEMENTS_FORMAT_VERSION, CONTEXT_LINK_UNPUBLISHED, FILE_UNREADABLE,
    MAX_ACKNOWLEDGEMENTS, MAX_ACKNOWLEDGEMENT_PART,
};
use crate::research_completeness::{CompletenessReport, ReportEntry};

/// The version of the serialized [`PublicationReview`].
pub const REVIEW_FORMAT_VERSION: u32 = 1;

/// The groups the review lists findings in, in this order: what the build
/// refuses first, then advisory findings by outcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewGroupName {
    /// Integrity or privacy failures the build that publishes the post refuses.
    Blocking,
    Detected,
    Potential,
    NeedsReview,
}

/// One group: its name and the positions of its findings in `findings`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReviewGroup {
    pub name: ReviewGroupName,
    pub findings: Vec<usize>,
}

/// The review of one post before it is published or scheduled.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationReview {
    pub version: u32,
    pub findings: Vec<ReportEntry>,
    /// The non-empty groups, in [`ReviewGroupName`] order.
    pub groups: Vec<ReviewGroup>,
    pub counts: OutcomeCounts,
    /// Acknowledgements that name no advisory finding in this review.
    pub unmatched_acknowledgements: usize,
}

/// What a review is of: one post about to be published, or the whole site as
/// the next build would publish it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewScope {
    /// A post being published or scheduled: a citation the build refuses once
    /// published blocks it.
    Post,
    /// The site as it stands: a citation finding of a post that is not
    /// published yet only warns, so only a failure of a file the build reads
    /// blocks the next build.
    Site,
}

impl PublicationReview {
    /// Gather findings in any order. The result depends only on the set of
    /// findings and acknowledgements, never on the order they arrive in.
    pub fn new(
        findings: impl IntoIterator<Item = ReviewFinding>,
        acknowledgements: &[Acknowledgement],
    ) -> Self {
        Self::of(CompletenessReport::new(findings, acknowledgements))
    }

    /// Group a report for the review.
    pub fn of(report: CompletenessReport) -> Self {
        Self::scoped(report, ReviewScope::Post)
    }

    /// Group a report for a review of `scope`. The order, codes, counts and
    /// acknowledgements are the report's whatever the scope; only which
    /// findings count as blocking differs.
    pub fn scoped(report: CompletenessReport, scope: ReviewScope) -> Self {
        let blocks = |finding: &ReviewFinding| match scope {
            ReviewScope::Post => finding.blocks_publication(),
            ReviewScope::Site => finding.gate == Gate::Refuses,
        };
        let mut groups: Vec<ReviewGroup> = [
            ReviewGroupName::Blocking,
            ReviewGroupName::Detected,
            ReviewGroupName::Potential,
            ReviewGroupName::NeedsReview,
        ]
        .into_iter()
        .map(|name| ReviewGroup {
            name,
            findings: Vec::new(),
        })
        .collect();
        for (position, entry) in report.findings.iter().enumerate() {
            let group = if blocks(&entry.finding) {
                0
            } else {
                match entry.finding.outcome {
                    crate::research::EvidenceOutcome::Detected => 1,
                    crate::research::EvidenceOutcome::Potential => 2,
                    crate::research::EvidenceOutcome::NeedsReview => 3,
                }
            };
            groups[group].findings.push(position);
        }
        groups.retain(|group| !group.findings.is_empty());
        Self {
            version: REVIEW_FORMAT_VERSION,
            findings: report.findings,
            groups,
            counts: report.counts,
            unmatched_acknowledgements: report.unmatched_acknowledgements,
        }
    }
}

impl PublicationReview {
    /// How many findings block, in either scope.
    pub fn blocking(&self) -> usize {
        self.groups
            .iter()
            .find(|group| group.name == ReviewGroupName::Blocking)
            .map_or(0, |group| group.findings.len())
    }

    /// Each outcome counted apart, with how many are acknowledged; the one
    /// sentence Admin and the command line both show. Never a total or a score.
    pub fn counts_text(&self) -> String {
        let part = |label: &str, count: OutcomeCount| {
            if count.acknowledged > 0 {
                format!(
                    "{label}: {} ({} acknowledged)",
                    count.found, count.acknowledged
                )
            } else {
                format!("{label}: {}", count.found)
            }
        };
        let blocking = self.blocking();
        format!(
            "{}{}.",
            if blocking > 0 {
                format!("{blocking} must be fixed before publishing. ")
            } else {
                String::new()
            },
            [
                part("Detected", self.counts.detected),
                part("Potential", self.counts.potential),
                part("Needs review", self.counts.needs_review),
            ]
            .join(". ")
        )
    }

    /// The findings in the order Admin lists them (blocking first, then by
    /// outcome, each group in the contract's order), one line each, then the
    /// counts sentence. Deterministic: the same report prints the same bytes.
    /// An empty report prints nothing.
    pub fn text(&self) -> String {
        if self.findings.is_empty() {
            return String::new();
        }
        let mut lines = Vec::new();
        for group in &self.groups {
            let label = match group.name {
                ReviewGroupName::Blocking => "blocking",
                ReviewGroupName::Detected => "detected",
                ReviewGroupName::Potential => "potential",
                ReviewGroupName::NeedsReview => "needs-review",
            };
            for &position in &group.findings {
                lines.push(finding_line(label, &self.findings[position]));
            }
        }
        lines.push(format!("Research checks: {}", self.counts_text()));
        let mut text = lines.join("\n");
        text.push('\n');
        text
    }
}

/// Where a finding is, in words an author can find: the post and line, field
/// or the research object it names.
pub fn finding_place(finding: &ReviewFinding) -> String {
    let scope = &finding.scope;
    let id = scope
        .id
        .as_deref()
        .map(|id| format!(" {id}"))
        .unwrap_or_default();
    match scope.object {
        ObjectKind::Post => {
            let path = scope.path.as_deref().unwrap_or("the post");
            match (scope.line, scope.column, scope.field.as_deref()) {
                (Some(line), Some(column), _) => format!("{path}:{line}:{column}"),
                (Some(line), None, _) => format!("{path}:{line}"),
                (None, _, Some(field)) => format!("{path} ({field})"),
                _ => path.to_string(),
            }
        }
        ObjectKind::Claim => format!("claim{id}"),
        ObjectKind::EvidenceLink => format!("evidence link{id}"),
        ObjectKind::Source => format!("source{id}"),
        ObjectKind::Interpretation => format!("interpretation{id}"),
        ObjectKind::Passage => format!("notebook passage{id}"),
        ObjectKind::Note => format!("notebook note{id}"),
        ObjectKind::Entry => format!("atlas entry{id}"),
        ObjectKind::Relationship => format!("atlas relationship{id}"),
        ObjectKind::Dating => format!("dating{id}"),
        ObjectKind::Alignment => format!(
            "comparison{id}{}",
            scope
                .field
                .as_deref()
                .map(|field| format!(", {field}"))
                .unwrap_or_default()
        ),
        ObjectKind::SourceLibrary => "the source library".into(),
        ObjectKind::Notebook => "the research notebook".into(),
        ObjectKind::Atlas => "the Knowledge Atlas".into(),
        ObjectKind::ClaimsFile => "the claims file".into(),
        ObjectKind::AlignmentsFile => "the alignments file".into(),
    }
}

/// One finding as the command line prints it: its group, whether the author
/// acknowledged it, where it is, the validator's own message and repair, and
/// its code. An acknowledgement is shown, never a resolution.
fn finding_line(group: &str, entry: &ReviewEntry) -> String {
    let acknowledgement = match entry.acknowledgement {
        Some(AcknowledgementState::Current) => " (acknowledged)",
        Some(AcknowledgementState::Stale) => " (acknowledgement stale)",
        None => "",
    };
    let finding = &entry.finding;
    format!(
        "research {group}{acknowledgement}: {}: {} Repair: {} [{}: {}]",
        finding_place(finding),
        finding.message,
        finding.repair,
        finding.validator,
        finding.code
    )
}

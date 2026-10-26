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
            let group = if entry.finding.blocks_publication() {
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

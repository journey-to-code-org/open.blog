//! The research review before publication (#62, ADR 0135, ADR 0136).
//!
//! Before a post is published or scheduled, Admin gathers what the existing
//! research checks already say about it: the research-profile audit, the
//! citation and claim reviews, the projection notices of the atlas, the
//! claims and the alignments files, chronology prompts, the comparison
//! projection's withheld wording, context links, and integrity failures of
//! the private files the publication reads. Nothing here checks anything
//! itself, except the context-link check of [`crate::context_links`].
//!
//! This module is a thin adapter onto the research-completeness contract
//! (RW9, ADR 0144 and ADR 0145): the finding shape, the matrix of
//! validators, checks, categories, outcomes and gates, the acknowledgement
//! key and fingerprint, the order and the counts are that contract's, under
//! the same names and JSON fields, so the readiness report of #194 replaces
//! the converters here without changing what Admin receives. What the
//! adapter adds is recorded in ADR 0135. Every validator states the same
//! position-free facts as RW9's, so fingerprints agree with the contract's.
//!
//! The review is a prompt, never a verdict. There is no score, total, pass,
//! ready or resolved field. Only a finding whose validator refuses the
//! publication (a citation the build cannot publish, or a private file the
//! build reads that it cannot read) blocks it; everything else is advisory.
//! Only an advisory finding can be acknowledged, and an acknowledged finding
//! is still listed and counted under its outcome.

use std::cmp::Ordering;
use std::fmt;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::chronology_index::{ChronologyPrompt, ChronologyPromptCode};
use crate::comparison_publication::{withheld_text, PublicComparison, VersionKind, Withheld};
use crate::context_links::ContextLinkFinding;
use crate::knowledge_atlas::{AtlasDiagnostic, AtlasDiagnosticCode, DiagnosticSubject};
use crate::research::{EvidenceCode, EvidenceFinding, EvidenceObject, EvidenceOutcome};
use crate::research_notes::{NoteDiagnostic, NoteDiagnosticCode};
use crate::source_library::{SourceDiagnostic, SourceDiagnosticCode};

/// The version of the serialized [`PublicationReview`].
pub const REVIEW_FORMAT_VERSION: u32 = 1;
/// The version of the stored acknowledgements file.
pub const ACKNOWLEDGEMENTS_FORMAT_VERSION: u32 = 1;
/// The most acknowledgements one file may hold.
pub const MAX_ACKNOWLEDGEMENTS: usize = 5000;
/// The longest path, id or field an acknowledgement may name.
pub const MAX_ACKNOWLEDGEMENT_PART: usize = 512;
/// The adapter's code for a private file the publication reads that cannot
/// be read at all (an I/O, symlink or projection refusal with no record to
/// point at). Every other code is its validator's own.
pub const FILE_UNREADABLE: &str = "file-unreadable";

fn kebab<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

macro_rules! kebab_display {
    ($($ty:ty),*) => {$(
        impl fmt::Display for $ty {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&kebab(self))
            }
        }
    )*};
}

/// The core function that owns a check (ADR 0144). The review is never a
/// validator: it gathers findings and owns no check of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Validator {
    ResearchProfile,
    CitationReview,
    ClaimReview,
    SourceLibrary,
    Notebook,
    Atlas,
    ChronologyIndex,
    Claims,
    Alignments,
    ComparisonProjection,
    /// `context_links::review_context_links`, proposed to the contract in ADR 0135.
    PublicationContext,
}

/// What kind of gap or prompt a finding is. Categories group; they never rank.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Integrity,
    PublicBoundary,
    Structure,
    Reference,
    Identifier,
    Version,
    Locator,
    Citation,
    ClaimAnchor,
    Evidence,
    Provenance,
    Chronology,
    Rights,
}

/// One property of the research record, owned by exactly one validator.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Check {
    WorkStructure,
    ReferenceSection,
    WorkIdentifier,
    CitationSyntax,
    CitationResolution,
    ReferenceCompleteness,
    LocationReview,
    ClaimAnchoring,
    EvidenceRelation,
    EvidenceProvenance,
    EvidenceLocation,
    LibraryIntegrity,
    NotebookIntegrity,
    AtlasIntegrity,
    ClaimsIntegrity,
    AlignmentsIntegrity,
    AtlasProjection,
    ClaimProjection,
    AlignmentPlaces,
    ChronologyConsistency,
    ComparisonRights,
    /// Whether each context link names a page the next build publishes.
    ContextLink,
}

impl Check {
    /// The one validator that owns the check.
    pub fn owner(self) -> Validator {
        match self {
            Self::WorkStructure | Self::ReferenceSection | Self::WorkIdentifier => {
                Validator::ResearchProfile
            }
            Self::CitationSyntax
            | Self::CitationResolution
            | Self::ReferenceCompleteness
            | Self::LocationReview => Validator::CitationReview,
            Self::ClaimAnchoring
            | Self::EvidenceRelation
            | Self::EvidenceProvenance
            | Self::EvidenceLocation => Validator::ClaimReview,
            Self::LibraryIntegrity => Validator::SourceLibrary,
            Self::NotebookIntegrity => Validator::Notebook,
            Self::AtlasIntegrity | Self::AtlasProjection => Validator::Atlas,
            Self::ClaimsIntegrity | Self::ClaimProjection => Validator::Claims,
            Self::AlignmentsIntegrity | Self::AlignmentPlaces => Validator::Alignments,
            Self::ChronologyConsistency => Validator::ChronologyIndex,
            Self::ComparisonRights => Validator::ComparisonProjection,
            Self::ContextLink => Validator::PublicationContext,
        }
    }

    /// The next action, used when the owning validator gives no repair of its own.
    pub fn action(self) -> &'static str {
        match self {
            Self::WorkStructure | Self::ReferenceSection | Self::WorkIdentifier => {
                "Edit the post as the finding describes."
            }
            Self::CitationSyntax | Self::CitationResolution => {
                "Fix the citation or add its source to the library."
            }
            Self::ReferenceCompleteness => {
                "Add the detail to the source if it has one; open.blog never fills it in."
            }
            Self::LocationReview | Self::EvidenceLocation => {
                "Compare the location with the source itself and record it."
            }
            Self::ClaimAnchoring => "Re-anchor the claim in the saved draft, or remove it.",
            Self::EvidenceRelation => {
                "Record what the claim's evidence lacks, or leave it if nothing needs to change."
            }
            Self::EvidenceProvenance => {
                "Check whether the archived source or passage still belongs here."
            }
            Self::LibraryIntegrity
            | Self::NotebookIntegrity
            | Self::AtlasIntegrity
            | Self::ClaimsIntegrity
            | Self::AlignmentsIntegrity => {
                "Fix the named record or field; the file is left unchanged until you do."
            }
            Self::AtlasProjection | Self::ClaimProjection => {
                "Approve what it depends on to publish it, or leave it private."
            }
            Self::AlignmentPlaces => "Check the place and update the member or its passage.",
            Self::ChronologyConsistency => {
                "Check the datings against their cited evidence; a recorded disagreement can stay side by side."
            }
            Self::ComparisonRights => {
                "Record the version's rights or shorten the place to publish its wording, or leave it out."
            }
            Self::ContextLink => "Publish the page, or correct or remove the link.",
        }
    }
}

/// What the owning validator does about the condition (ADR 0144).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Gate {
    /// Nothing is refused; the author decides.
    Advisory,
    /// A post that publishes the citation is refused; a draft only warns.
    RefusesWhenPublished,
    /// The save, change or build that would write it is refused.
    Refuses,
    /// The build publishes everything else and leaves this one item out until
    /// the author fixes it (a stale approval). It does not stop a post and
    /// cannot be acknowledged: acknowledging would not publish the item.
    Withholds,
}

/// The kind of object a finding is scoped to or relates to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObjectKind {
    /// A post, named by its path relative to the content folder.
    Post,
    Claim,
    EvidenceLink,
    Source,
    Interpretation,
    Passage,
    Note,
    Entry,
    Relationship,
    Dating,
    Alignment,
    SourceLibrary,
    Notebook,
    Atlas,
    ClaimsFile,
    AlignmentsFile,
}

kebab_display!(Validator, Category, Check, Gate, ObjectKind);

/// Another object a finding is about.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ObjectRef {
    pub kind: ObjectKind,
    pub id: String,
}

impl ObjectRef {
    pub fn new(kind: ObjectKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }
}

/// The one object a finding is about, and where in it. A detail the
/// validator did not report stays absent.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingScope {
    pub object: ObjectKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

impl FindingScope {
    pub fn of(object: ObjectKind) -> Self {
        Self {
            object,
            id: None,
            index: None,
            path: None,
            line: None,
            column: None,
            field: None,
        }
    }
}

/// Any finding, notice, prompt or diagnostic in the contract's shape.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    pub validator: Validator,
    pub check: Check,
    pub code: String,
    pub category: Category,
    pub outcome: EvidenceOutcome,
    pub gate: Gate,
    pub scope: FindingScope,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub related: Vec<ObjectRef>,
    pub message: String,
    pub repair: String,
    /// Position-free facts the fingerprint is built from. Never serialized.
    #[serde(skip)]
    pub facts: Vec<String>,
}

#[derive(Clone, Copy)]
struct Spec {
    check: Check,
    category: Category,
    outcome: EvidenceOutcome,
    gate: Gate,
}

const fn spec(check: Check, category: Category, outcome: EvidenceOutcome, gate: Gate) -> Spec {
    Spec {
        check,
        category,
        outcome,
        gate,
    }
}

use Category as C;
use Check as K;
use EvidenceOutcome as O;
use Gate as G;

/// ADR 0144's matrix for research-profile, citation and claim findings.
fn evidence_spec(code: EvidenceCode) -> Spec {
    use EvidenceCode as E;
    match code {
        E::DoiInvalid | E::LicenseUrlInvalid => {
            spec(K::WorkIdentifier, C::Identifier, O::Detected, G::Advisory)
        }
        E::AbstractMissing => spec(K::WorkStructure, C::Structure, O::Detected, G::Advisory),
        E::ReferencesMissing => spec(K::WorkStructure, C::Reference, O::Detected, G::Advisory),
        E::FootnoteUnresolved => spec(K::ReferenceSection, C::Reference, O::Detected, G::Advisory),
        E::ReferenceLinkReview => spec(
            K::ReferenceSection,
            C::Reference,
            O::NeedsReview,
            G::Advisory,
        ),
        E::DoiLinkNonPreferred => spec(
            K::ReferenceSection,
            C::Identifier,
            O::Potential,
            G::Advisory,
        ),
        E::CitationSyntax => spec(
            K::CitationSyntax,
            C::Citation,
            O::Detected,
            G::RefusesWhenPublished,
        ),
        E::CitationUnresolved => spec(
            K::CitationResolution,
            C::Reference,
            O::Detected,
            G::RefusesWhenPublished,
        ),
        E::CitationIdentifierUnpublished => spec(
            K::CitationResolution,
            C::Identifier,
            O::Potential,
            G::Advisory,
        ),
        E::CitationReferenceIncomplete => spec(
            K::ReferenceCompleteness,
            C::Reference,
            O::Potential,
            G::Advisory,
        ),
        E::CitationLocationReview => {
            spec(K::LocationReview, C::Locator, O::NeedsReview, G::Advisory)
        }
        E::ClaimPostMissing
        | E::ClaimAnchorMoved
        | E::ClaimAnchorStale
        | E::ClaimAnchorAmbiguous => {
            spec(K::ClaimAnchoring, C::ClaimAnchor, O::Detected, G::Advisory)
        }
        E::ClaimSuggestionUnreviewed => spec(
            K::EvidenceRelation,
            C::Provenance,
            O::NeedsReview,
            G::Advisory,
        ),
        E::ClaimEvidenceMissing | E::ClaimRationaleMissing => {
            spec(K::EvidenceRelation, C::Evidence, O::Potential, G::Advisory)
        }
        E::ClaimSupportOnly | E::ClaimContradictionUndiscussed => spec(
            K::EvidenceRelation,
            C::Evidence,
            O::NeedsReview,
            G::Advisory,
        ),
        E::ClaimSourceArchived | E::ClaimPassageArchived => spec(
            K::EvidenceProvenance,
            C::Provenance,
            O::NeedsReview,
            G::Advisory,
        ),
        E::ClaimLocatorMissing => spec(K::EvidenceLocation, C::Locator, O::Potential, G::Advisory),
        E::ClaimLocationUnreviewed => {
            spec(K::EvidenceLocation, C::Locator, O::NeedsReview, G::Advisory)
        }
    }
}

/// Whether an atlas-family code is a notice about a valid file, and its category.
fn atlas_class(code: AtlasDiagnosticCode) -> (bool, Category, EvidenceOutcome) {
    use AtlasDiagnosticCode as A;
    let error = |category| (false, category, O::Detected);
    match code {
        A::PrivateEndpoint | A::UndisclosedContradiction | A::UnpublishedDatings => {
            (true, C::PublicBoundary, O::Detected)
        }
        A::StaleLocator | A::StaleApproval => (true, C::Locator, O::NeedsReview),
        A::ArchivedMember => (true, C::Provenance, O::NeedsReview),
        A::UnknownLocatorKind | A::InvalidLocator | A::AmbiguousLocator | A::MissingLocator => {
            error(C::Locator)
        }
        A::WrongSourceKind => error(C::Version),
        A::MissingEvidence | A::EvidenceConflict => error(C::Evidence),
        A::InvalidVisibility | A::PrivateReference | A::ContributorCredit => {
            error(C::PublicBoundary)
        }
        A::AnchorMismatch | A::StaleAnchor | A::AmbiguousAnchor => error(C::ClaimAnchor),
        A::InvalidDate | A::AspectKind | A::DuplicateDating => error(C::Chronology),
        A::TooLarge
        | A::InvalidJson
        | A::UnsupportedVersion
        | A::MissingField
        | A::InvalidField
        | A::InvalidId
        | A::DuplicateId
        | A::UnknownEntry
        | A::UnknownSource
        | A::UnknownPassage
        | A::UnknownKind
        | A::EndpointKind
        | A::SelfRelationship
        | A::DuplicateRelationship
        | A::Cycle
        | A::StillLinked
        | A::ShadowedField
        | A::UnknownClaim
        | A::DuplicateLink
        | A::UnknownLink
        | A::UnknownPost
        | A::UnknownInterpretation
        | A::DuplicateMember
        | A::ConflictingMember
        | A::MissingCounterpart
        | A::MissingOriginal
        | A::UnknownAlignment => error(C::Integrity),
    }
}

fn atlas_spec(subject: DiagnosticSubject, code: AtlasDiagnosticCode) -> Spec {
    use AtlasDiagnosticCode as A;
    let (notice, category, outcome) = atlas_class(code);
    let check = match (subject, notice) {
        (DiagnosticSubject::Atlas, false) => K::AtlasIntegrity,
        (DiagnosticSubject::Atlas, true) => K::AtlasProjection,
        (DiagnosticSubject::Claims, false) => K::ClaimsIntegrity,
        (DiagnosticSubject::Claims, true) => K::ClaimProjection,
        (DiagnosticSubject::Alignments, false) => K::AlignmentsIntegrity,
        (DiagnosticSubject::Alignments, true) => K::AlignmentPlaces,
    };
    let gate = match (code, notice) {
        (A::StaleApproval, _) => G::Withholds,
        (_, true) => G::Advisory,
        (_, false) => G::Refuses,
    };
    spec(check, category, outcome, gate)
}

fn note_category(code: NoteDiagnosticCode) -> Category {
    use NoteDiagnosticCode as N;
    match code {
        N::UnknownLocatorKind | N::InvalidLocator | N::AmbiguousLocator => C::Locator,
        N::NotPrivate | N::ContributorCredit | N::ReaderFeedback => C::PublicBoundary,
        N::SourceChanged => C::Provenance,
        N::TooLarge
        | N::InvalidJson
        | N::UnsupportedVersion
        | N::MissingField
        | N::InvalidField
        | N::InvalidId
        | N::DuplicateId
        | N::UnknownSource
        | N::UnknownPassage
        | N::StillLinked
        | N::UnknownEntry => C::Integrity,
    }
}

fn source_category(code: SourceDiagnosticCode) -> Category {
    use SourceDiagnosticCode as S;
    match code {
        S::KindChanged
        | S::UnresolvedRelationship
        | S::InvalidRelationship
        | S::AmbiguousRelationship
        | S::RelationshipCycle => C::Version,
        S::AmbiguousLocation => C::Locator,
        S::InvalidIdentifier => C::Identifier,
        S::ContributorCredit => C::PublicBoundary,
        S::ConflictingAttribution => C::Provenance,
        S::TooLarge
        | S::InvalidJson
        | S::UnsupportedVersion
        | S::MissingField
        | S::InvalidField
        | S::InvalidId
        | S::DuplicateId
        | S::UnknownKind
        | S::UnknownSource
        | S::StillUsed => C::Integrity,
    }
}

const CHRONOLOGY: Spec = spec(
    K::ChronologyConsistency,
    C::Chronology,
    O::NeedsReview,
    G::Advisory,
);

fn withheld_code(withheld: Withheld) -> &'static str {
    match withheld {
        Withheld::Rights => "withheld-rights",
        Withheld::Length => "withheld-length",
    }
}

/// Every code a stored acknowledgement may name: the advisory codes of the
/// matrix, for their owning validator. Integrity and privacy failures are
/// never acknowledgeable.
pub fn acknowledgeable(validator: Validator, code: &str) -> bool {
    use AtlasDiagnosticCode as A;
    use EvidenceCode as E;
    let evidence = [
        E::DoiInvalid,
        E::LicenseUrlInvalid,
        E::AbstractMissing,
        E::ReferencesMissing,
        E::FootnoteUnresolved,
        E::ReferenceLinkReview,
        E::DoiLinkNonPreferred,
        E::CitationSyntax,
        E::CitationUnresolved,
        E::CitationIdentifierUnpublished,
        E::CitationReferenceIncomplete,
        E::CitationLocationReview,
        E::ClaimPostMissing,
        E::ClaimAnchorMoved,
        E::ClaimAnchorStale,
        E::ClaimAnchorAmbiguous,
        E::ClaimSuggestionUnreviewed,
        E::ClaimEvidenceMissing,
        E::ClaimSupportOnly,
        E::ClaimContradictionUndiscussed,
        E::ClaimSourceArchived,
        E::ClaimPassageArchived,
        E::ClaimLocatorMissing,
        E::ClaimLocationUnreviewed,
        E::ClaimRationaleMissing,
    ];
    let advisory_evidence = evidence.iter().any(|&known| {
        let spec = evidence_spec(known);
        spec.gate == G::Advisory && spec.check.owner() == validator && known.to_string() == code
    });
    let notices: [(Validator, AtlasDiagnosticCode); 6] = [
        (Validator::Atlas, A::PrivateEndpoint),
        (Validator::Atlas, A::UnpublishedDatings),
        (Validator::Claims, A::PrivateEndpoint),
        (Validator::Claims, A::UndisclosedContradiction),
        (Validator::Alignments, A::StaleLocator),
        (Validator::Alignments, A::ArchivedMember),
    ];
    let advisory_notice = notices
        .iter()
        .any(|&(owner, known)| owner == validator && known.to_string() == code);
    let chronology = validator == Validator::ChronologyIndex
        && [
            ChronologyPromptCode::DeathBeforeBirth,
            ChronologyPromptCode::CompositionAfterDeath,
            ChronologyPromptCode::CompositionBeforeBirth,
            ChronologyPromptCode::PublicationBeforeComposition,
            ChronologyPromptCode::OutsideLifetime,
            ChronologyPromptCode::OpposedRelative,
            ChronologyPromptCode::RelativeCycle,
            ChronologyPromptCode::RelativeAgainstDates,
        ]
        .iter()
        .any(|known| known.to_string() == code);
    let withheld = validator == Validator::ComparisonProjection
        && [Withheld::Rights, Withheld::Length]
            .iter()
            .any(|&known| withheld_code(known) == code);
    let context = validator == Validator::PublicationContext && code == CONTEXT_LINK_UNPUBLISHED;
    advisory_evidence || advisory_notice || chronology || withheld || context
}

/// The code of the context-link check.
pub const CONTEXT_LINK_UNPUBLISHED: &str = "context-link-unpublished";

fn collection_kind(collection: &str) -> Option<ObjectKind> {
    Some(match collection {
        "entries" => ObjectKind::Entry,
        "relationships" => ObjectKind::Relationship,
        "claims" => ObjectKind::Claim,
        "links" => ObjectKind::EvidenceLink,
        "alignments" => ObjectKind::Alignment,
        _ => return None,
    })
}

fn outcome_rank(outcome: EvidenceOutcome) -> u8 {
    match outcome {
        EvidenceOutcome::Detected => 0,
        EvidenceOutcome::Potential => 1,
        EvidenceOutcome::NeedsReview => 2,
    }
}

impl ReviewFinding {
    #[allow(clippy::too_many_arguments)]
    fn mapped(
        code: String,
        spec: Spec,
        outcome: EvidenceOutcome,
        scope: FindingScope,
        related: Vec<ObjectRef>,
        message: String,
        repair: Option<String>,
        facts: Vec<String>,
    ) -> Self {
        Self {
            validator: spec.check.owner(),
            check: spec.check,
            code,
            category: spec.category,
            outcome,
            gate: spec.gate,
            scope,
            related,
            message,
            repair: repair
                .filter(|repair| !repair.is_empty())
                .unwrap_or_else(|| spec.check.action().to_string()),
            facts,
        }
    }

    /// A research-profile, citation or claim-review finding. A claim finding
    /// is scoped to its claim, a link finding to its link with the claim
    /// related; anything else to the post. Its facts are the validator's.
    pub fn from_evidence(finding: &EvidenceFinding) -> Self {
        let (object, id, related) = match &finding.object {
            Some(EvidenceObject {
                claim,
                link: Some(link),
            }) => (
                ObjectKind::EvidenceLink,
                Some(link.clone()),
                vec![ObjectRef::new(ObjectKind::Claim, claim.clone())],
            ),
            Some(EvidenceObject { claim, link: None }) => {
                (ObjectKind::Claim, Some(claim.clone()), Vec::new())
            }
            None => (ObjectKind::Post, None, Vec::new()),
        };
        Self::mapped(
            finding.code.to_string(),
            evidence_spec(finding.code),
            finding.outcome,
            FindingScope {
                id,
                path: Some(finding.source.path.clone()),
                line: finding.source.line,
                column: finding.source.column,
                field: finding.source.field.clone(),
                ..FindingScope::of(object)
            },
            related,
            finding.message.clone(),
            Some(finding.repair.clone()),
            finding.facts.clone(),
        )
    }

    /// A diagnostic or notice of the atlas, claims or alignments file, with
    /// the position-free facts its validator states.
    pub fn from_atlas_diagnostic(diagnostic: &AtlasDiagnostic) -> Self {
        let spec = atlas_spec(diagnostic.subject, diagnostic.code);
        let file = match diagnostic.subject {
            DiagnosticSubject::Atlas => ObjectKind::Atlas,
            DiagnosticSubject::Claims => ObjectKind::ClaimsFile,
            DiagnosticSubject::Alignments => ObjectKind::AlignmentsFile,
        };
        let object = diagnostic.collection.map_or(file, |collection| {
            collection_kind(collection).unwrap_or(file)
        });
        let in_collection = object != file;
        Self::mapped(
            diagnostic.code.to_string(),
            spec,
            spec.outcome,
            FindingScope {
                id: diagnostic.id.clone().filter(|_| in_collection),
                index: diagnostic.index.filter(|_| in_collection),
                field: diagnostic.field.clone(),
                ..FindingScope::of(object)
            },
            Vec::new(),
            diagnostic.message.clone(),
            None,
            diagnostic.facts.clone(),
        )
    }

    /// A chronology prompt, scoped to the entry or relationship that owns the
    /// dating it starts from, with every dating it names related in order.
    pub fn from_chronology_prompt(prompt: &ChronologyPrompt) -> Self {
        Self::mapped(
            prompt.code.to_string(),
            CHRONOLOGY,
            CHRONOLOGY.outcome,
            FindingScope {
                id: Some(prompt.id.clone()),
                index: Some(prompt.index),
                field: Some(prompt.field.clone()),
                ..FindingScope::of(collection_kind(prompt.collection).unwrap_or(ObjectKind::Atlas))
            },
            prompt
                .datings
                .iter()
                .map(|id| ObjectRef::new(ObjectKind::Dating, id.clone()))
                .collect(),
            prompt.message.clone(),
            None,
            prompt.facts.clone(),
        )
    }

    /// A notebook diagnostic: every one refuses the change it is about.
    pub fn from_note_diagnostic(diagnostic: &NoteDiagnostic) -> Self {
        let object = match diagnostic.collection {
            Some("passages") => ObjectKind::Passage,
            Some("notes") => ObjectKind::Note,
            _ => ObjectKind::Notebook,
        };
        let in_collection = object != ObjectKind::Notebook;
        Self::mapped(
            diagnostic.code.to_string(),
            spec(
                K::NotebookIntegrity,
                note_category(diagnostic.code),
                O::Detected,
                G::Refuses,
            ),
            O::Detected,
            FindingScope {
                id: diagnostic.id.clone().filter(|_| in_collection),
                index: diagnostic.index.filter(|_| in_collection),
                field: diagnostic.field.clone(),
                ..FindingScope::of(object)
            },
            Vec::new(),
            diagnostic.message.clone(),
            None,
            Vec::new(),
        )
    }

    /// A source-library diagnostic: every one refuses the change it is about.
    pub fn from_source_diagnostic(diagnostic: &SourceDiagnostic) -> Self {
        let record = diagnostic.index.is_some() || diagnostic.source_id.is_some();
        Self::mapped(
            diagnostic.code.to_string(),
            spec(
                K::LibraryIntegrity,
                source_category(diagnostic.code),
                O::Detected,
                G::Refuses,
            ),
            O::Detected,
            FindingScope {
                id: diagnostic.source_id.clone(),
                index: diagnostic.index,
                field: diagnostic.field.clone(),
                ..FindingScope::of(if record {
                    ObjectKind::Source
                } else {
                    ObjectKind::SourceLibrary
                })
            },
            Vec::new(),
            diagnostic.message.clone(),
            None,
            Vec::new(),
        )
    }

    /// Each place a published comparison leaves the wording of, scoped to
    /// its alignment member, with the version related. The message is the
    /// public "Wording not shown" sentence; the facts are the version's
    /// rights and the place's locators, as ADR 0145 states them.
    pub fn from_comparison(comparison: &PublicComparison) -> Vec<Self> {
        let mut findings = Vec::new();
        for version in &comparison.versions {
            let mut related = Vec::new();
            if let (VersionKind::Interpretation, Some(interpretation)) =
                (version.kind, &version.interpretation)
            {
                related.push(ObjectRef::new(
                    ObjectKind::Interpretation,
                    interpretation.id.clone(),
                ));
            }
            related.push(ObjectRef::new(ObjectKind::Source, version.source.clone()));
            for place in &version.places {
                let Some(withheld) = place.withheld else {
                    continue;
                };
                let rights = spec(K::ComparisonRights, C::Rights, O::Detected, G::Advisory);
                findings.push(Self::mapped(
                    withheld_code(withheld).to_string(),
                    rights,
                    rights.outcome,
                    FindingScope {
                        id: Some(comparison.id.clone()),
                        field: Some(format!("members[{}]", place.member)),
                        ..FindingScope::of(ObjectKind::Alignment)
                    },
                    related.clone(),
                    withheld_text(withheld, &version.rights),
                    None,
                    std::iter::once(kebab(&version.rights.status))
                        .chain(version.rights.license.clone())
                        .chain(place.locators.iter().map(|locator| match &locator.to {
                            Some(to) => format!("{} {} to {to}", locator.kind, locator.value),
                            None => format!("{} {}", locator.kind, locator.value),
                        }))
                        .collect(),
                ));
            }
        }
        findings
    }

    /// A context link whose page the next build does not publish, scoped to
    /// the post at the link's line, with the page's object related. Its fact
    /// is the address, so an acknowledgement goes stale if the link changes.
    pub fn from_context_link(post: &str, finding: &ContextLinkFinding) -> Self {
        let kind = match finding.link.kind {
            crate::context_links::ContextKind::AtlasEntry => ObjectKind::Entry,
            crate::context_links::ContextKind::Comparison => ObjectKind::Alignment,
        };
        Self::mapped(
            CONTEXT_LINK_UNPUBLISHED.to_string(),
            spec(K::ContextLink, C::PublicBoundary, O::Detected, G::Advisory),
            O::Detected,
            FindingScope {
                path: Some(post.to_string()),
                line: Some(finding.link.line),
                ..FindingScope::of(ObjectKind::Post)
            },
            vec![ObjectRef::new(kind, finding.link.id.clone())],
            finding.message.clone(),
            Some(finding.repair.clone()),
            vec![finding.link.href.clone()],
        )
    }

    /// A private file the publication reads that cannot be read or projected
    /// at all, scoped to the whole file. Its owner refuses the build.
    pub fn unreadable(file: ObjectKind, message: impl Into<String>) -> Self {
        let check = match file {
            ObjectKind::SourceLibrary => K::LibraryIntegrity,
            ObjectKind::Notebook => K::NotebookIntegrity,
            ObjectKind::Atlas => K::AtlasIntegrity,
            ObjectKind::ClaimsFile => K::ClaimsIntegrity,
            _ => K::AlignmentsIntegrity,
        };
        let file = match check {
            K::AlignmentsIntegrity => ObjectKind::AlignmentsFile,
            _ => file,
        };
        Self::mapped(
            FILE_UNREADABLE.to_string(),
            spec(check, C::Integrity, O::Detected, G::Refuses),
            O::Detected,
            FindingScope::of(file),
            Vec::new(),
            message.into(),
            None,
            Vec::new(),
        )
    }

    /// Whether the finding stops this publication: its validator refuses the
    /// build that would publish it. A potential or needs-review finding never does.
    pub fn blocks_publication(&self) -> bool {
        matches!(self.gate, Gate::RefusesWhenPublished | Gate::Refuses)
    }

    fn key(&self) -> AcknowledgementKey<'_> {
        AcknowledgementKey {
            validator: self.validator,
            code: &self.code,
            object: self.scope.object,
            path: self.scope.path.as_deref(),
            id: self.scope.id.as_deref(),
            field: self.scope.field.as_deref(),
        }
    }

    /// ADR 0145's fingerprint: BLAKE2s over the key, the related objects and
    /// the facts, never the message or a position, as 32 hexadecimal characters.
    pub fn fingerprint(&self) -> String {
        let key = self.key();
        let parts = serde_json::json!([
            key.validator,
            key.code,
            key.object,
            key.path,
            key.id,
            key.field,
            self.related,
            self.facts,
        ]);
        let mut hasher = Blake2s256::new();
        hasher.update(parts.to_string().as_bytes());
        hasher.finalize()[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The contract's total order: file, object and place, then category,
    /// outcome, validator, check and code, then the rest.
    fn order(&self, other: &Self) -> Ordering {
        let a = &self.scope;
        let b = &other.scope;
        (
            &a.path, a.object, &a.id, a.index, a.line, a.column, &a.field,
        )
            .cmp(&(
                &b.path, b.object, &b.id, b.index, b.line, b.column, &b.field,
            ))
            .then(self.category.cmp(&other.category))
            .then(outcome_rank(self.outcome).cmp(&outcome_rank(other.outcome)))
            .then(self.validator.cmp(&other.validator))
            .then(self.check.cmp(&other.check))
            .then(self.code.cmp(&other.code))
            .then(self.message.cmp(&other.message))
            .then(self.related.cmp(&other.related))
            .then(self.repair.cmp(&other.repair))
            .then(self.gate.cmp(&other.gate))
            .then(self.facts.cmp(&other.facts))
    }
}

#[derive(PartialEq, Eq)]
struct AcknowledgementKey<'a> {
    validator: Validator,
    code: &'a str,
    object: ObjectKind,
    path: Option<&'a str>,
    id: Option<&'a str>,
    field: Option<&'a str>,
}

/// The author's record that they have seen an advisory finding (ADR 0145).
/// It never resolves the finding and holds no note, person or time.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acknowledgement {
    pub validator: Validator,
    pub code: String,
    pub object: ObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub fingerprint: String,
}

impl Acknowledgement {
    /// Acknowledge a finding as it stands; `None` when it blocks publication.
    pub fn of(finding: &ReviewFinding) -> Option<Self> {
        (finding.gate == Gate::Advisory).then(|| Self {
            validator: finding.validator,
            code: finding.code.clone(),
            object: finding.scope.object,
            path: finding.scope.path.clone(),
            id: finding.scope.id.clone(),
            field: finding.scope.field.clone(),
            fingerprint: finding.fingerprint(),
        })
    }

    /// Why an acknowledgement received from a request or read from the file
    /// cannot be stored or applied, or `None` when it can: only an advisory
    /// code of its owning validator, short parts without control characters,
    /// and a 32-character lowercase hexadecimal fingerprint.
    pub fn problem(&self) -> Option<String> {
        if !acknowledgeable(self.validator, &self.code) {
            return Some(format!(
                "`{}` from {} cannot be acknowledged: only an advisory finding can be, and an integrity or privacy failure is fixed instead",
                self.code, self.validator
            ));
        }
        if self.fingerprint.len() != 32
            || !self
                .fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Some("the fingerprint must be 32 lowercase hexadecimal characters".into());
        }
        for (name, part) in [
            ("path", &self.path),
            ("id", &self.id),
            ("field", &self.field),
        ] {
            if let Some(part) = part {
                if part.is_empty()
                    || part.len() > MAX_ACKNOWLEDGEMENT_PART
                    || part.chars().any(char::is_control)
                {
                    return Some(format!(
                        "the {name} must be 1 to {MAX_ACKNOWLEDGEMENT_PART} bytes without control characters"
                    ));
                }
            }
        }
        None
    }

    fn key(&self) -> AcknowledgementKey<'_> {
        AcknowledgementKey {
            validator: self.validator,
            code: &self.code,
            object: self.object,
            path: self.path.as_deref(),
            id: self.id.as_deref(),
            field: self.field.as_deref(),
        }
    }
}

/// The stored acknowledgements (ADR 0136): a versioned, sorted, duplicate-free list.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcknowledgementSet {
    pub version: u32,
    pub acknowledgements: Vec<Acknowledgement>,
}

impl AcknowledgementSet {
    pub fn empty() -> Self {
        Self {
            version: ACKNOWLEDGEMENTS_FORMAT_VERSION,
            acknowledgements: Vec::new(),
        }
    }

    /// Parse and validate a stored file. Every problem refuses it whole: an
    /// acknowledgement file is never partly applied.
    pub fn parse(text: &str) -> Result<Self, String> {
        let set: Self = serde_json::from_str(text)
            .map_err(|error| format!("not a valid acknowledgements file: {error}"))?;
        if set.version != ACKNOWLEDGEMENTS_FORMAT_VERSION {
            return Err(format!(
                "unsupported version {}; this release reads version {ACKNOWLEDGEMENTS_FORMAT_VERSION}",
                set.version
            ));
        }
        if set.acknowledgements.len() > MAX_ACKNOWLEDGEMENTS {
            return Err(format!(
                "holds more than {MAX_ACKNOWLEDGEMENTS} acknowledgements"
            ));
        }
        for (index, acknowledgement) in set.acknowledgements.iter().enumerate() {
            if let Some(problem) = acknowledgement.problem() {
                return Err(format!("acknowledgements[{index}]: {problem}"));
            }
        }
        Ok(set.normalized())
    }

    fn normalized(mut self) -> Self {
        self.acknowledgements.sort();
        self.acknowledgements.dedup();
        self
    }

    /// Add one acknowledgement, replacing any other with the same key and
    /// fingerprint. A finding is acknowledged at most once.
    pub fn add(&mut self, acknowledgement: Acknowledgement) -> Result<(), String> {
        if let Some(problem) = acknowledgement.problem() {
            return Err(problem);
        }
        self.acknowledgements.push(acknowledgement);
        let set = std::mem::take(self).normalized();
        if set.acknowledgements.len() > MAX_ACKNOWLEDGEMENTS {
            return Err(format!(
                "no more than {MAX_ACKNOWLEDGEMENTS} acknowledgements can be stored"
            ));
        }
        *self = Self {
            version: ACKNOWLEDGEMENTS_FORMAT_VERSION,
            ..set
        };
        Ok(())
    }

    /// Withdraw exactly this acknowledgement (its key and fingerprint), so
    /// the finding it was made for reads unacknowledged again; another
    /// finding under the same key keeps its own. Returns whether it was stored.
    pub fn withdraw(&mut self, acknowledgement: &Acknowledgement) -> bool {
        let before = self.acknowledgements.len();
        self.acknowledgements
            .retain(|stored| stored != acknowledgement);
        before != self.acknowledgements.len()
    }

    /// Deterministic, pretty-printed JSON with a trailing newline.
    pub fn to_json(&self) -> String {
        let mut json = serde_json::to_string_pretty(self).unwrap_or_default();
        json.push('\n');
        json
    }
}

/// Whether a JSON object is shaped like the acknowledgements file (ADR 0136):
/// exactly `version` and `acknowledgements`, every record naming a validator,
/// code and fingerprint. The private-research guards refuse a copy of it in
/// public input wherever it was saved, as they do the other research files.
pub fn looks_like_acknowledgements(root: &serde_json::Map<String, serde_json::Value>) -> bool {
    use serde_json::Value;
    if root.len() != 2 || root.get("version").and_then(Value::as_u64).is_none() {
        return false;
    }
    let Some(records) = root.get("acknowledgements").and_then(Value::as_array) else {
        return false;
    };
    let text = |record: &Value, key: &str| record.get(key).is_some_and(Value::is_string);
    records.iter().all(|record| {
        text(record, "validator") && text(record, "code") && text(record, "fingerprint")
    })
}

/// How an acknowledgement stands against the finding it names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AcknowledgementState {
    /// Acknowledged as it reads now.
    Current,
    /// Acknowledged in an earlier form; it says something new since.
    Stale,
}

/// One finding of the review, with its fingerprint and acknowledgement.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEntry {
    #[serde(flatten)]
    pub finding: ReviewFinding,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledgement: Option<AcknowledgementState>,
}

/// How many findings one outcome has, and how many of those are acknowledged.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeCount {
    pub found: usize,
    pub acknowledged: usize,
}

/// Each outcome counted apart; there is deliberately no total or score.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeCounts {
    pub detected: OutcomeCount,
    pub potential: OutcomeCount,
    pub needs_review: OutcomeCount,
}

impl OutcomeCounts {
    fn of(&mut self, outcome: EvidenceOutcome) -> &mut OutcomeCount {
        match outcome {
            EvidenceOutcome::Detected => &mut self.detected,
            EvidenceOutcome::Potential => &mut self.potential,
            EvidenceOutcome::NeedsReview => &mut self.needs_review,
        }
    }
}

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
    pub findings: Vec<ReviewEntry>,
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
        let mut findings: Vec<ReviewFinding> = findings.into_iter().collect();
        findings.sort_by(ReviewFinding::order);
        findings.dedup();
        let fingerprints: Vec<String> = findings.iter().map(ReviewFinding::fingerprint).collect();
        // Only stored acknowledgements the contract allows are applied.
        let usable: Vec<&Acknowledgement> = acknowledgements
            .iter()
            .filter(|ack| ack.problem().is_none())
            .collect();
        let advisory: Vec<(AcknowledgementKey<'_>, &str)> = findings
            .iter()
            .zip(&fingerprints)
            .filter(|(finding, _)| finding.gate == Gate::Advisory)
            .map(|(finding, fingerprint)| (finding.key(), fingerprint.as_str()))
            .collect();
        let state_of = |key: &AcknowledgementKey<'_>, fingerprint: &str| {
            let mut stale = false;
            for ack in usable.iter().filter(|ack| ack.key() == *key) {
                if ack.fingerprint == fingerprint {
                    return Some(AcknowledgementState::Current);
                }
                // An acknowledgement of another finding under the same key is
                // that finding's, not a stale one of this.
                stale |= !advisory
                    .iter()
                    .any(|(other, print)| other == key && *print == ack.fingerprint);
            }
            stale.then_some(AcknowledgementState::Stale)
        };
        let unmatched = usable
            .iter()
            .filter(|ack| !advisory.iter().any(|(key, _)| *key == ack.key()))
            .count();
        let mut counts = OutcomeCounts::default();
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
        let mut entries = Vec::with_capacity(findings.len());
        for (position, (finding, fingerprint)) in findings.iter().zip(&fingerprints).enumerate() {
            let acknowledgement = (finding.gate == Gate::Advisory)
                .then(|| state_of(&finding.key(), fingerprint))
                .flatten();
            let count = counts.of(finding.outcome);
            count.found += 1;
            if acknowledgement == Some(AcknowledgementState::Current) {
                count.acknowledged += 1;
            }
            let group = if finding.blocks_publication() {
                0
            } else {
                1 + outcome_rank(finding.outcome) as usize
            };
            groups[group].findings.push(position);
            entries.push(ReviewEntry {
                finding: finding.clone(),
                fingerprint: fingerprint.clone(),
                acknowledgement,
            });
        }
        groups.retain(|group| !group.findings.is_empty());
        Self {
            version: REVIEW_FORMAT_VERSION,
            findings: entries,
            groups,
            counts,
            unmatched_acknowledgements: unmatched,
        }
    }
}

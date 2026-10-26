//! The research-completeness contract (ADR 0144, ADR 0145): one finding
//! shape, one matrix and one deterministic order that every research check
//! maps into, so a single report can gather them without any check changing
//! what it reports or where.
//!
//! Each existing check keeps its own code, message and surface. This module
//! only describes them: which validator owns each check, which category and
//! outcome each code has, whether the owning validator refuses something on
//! it, which object it is scoped to, and how an author's acknowledgement of
//! an advisory finding is matched without ever relabelling it resolved.
//!
//! The contract is author-only. A finding names ids, fields, counts and
//! stated values the way its validator already does and never carries
//! statements, notes, excerpts or labels; nothing here is projected into a
//! public page, feed or export. There is no score: outcomes are counted
//! apart and never combined, and no field says that a work is true,
//! credible, agreed or fit to publish.

use std::cmp::Ordering;
use std::fmt;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::chronology_index::{ChronologyPrompt, ChronologyPromptCode};
use crate::comparison_publication::{withheld_text, PublicComparisons, VersionKind, Withheld};
use crate::knowledge_atlas::{AtlasDiagnostic, AtlasDiagnosticCode, DiagnosticSubject};
use crate::research::{EvidenceCode, EvidenceFinding, EvidenceObject, EvidenceOutcome};
use crate::research_notes::{NoteDiagnostic, NoteDiagnosticCode};
use crate::source_library::{SourceDiagnostic, SourceDiagnosticCode};
use crate::source_review::{ReviewObject, SourceReviewCode, SourceReviewFinding};

/// The version of the serialized [`CompletenessReport`].
pub const COMPLETENESS_FORMAT_VERSION: u32 = 1;

fn kebab<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
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

/// The core function that owns a set of checks. A presentation (Admin, the
/// CLI, a build log, the readiness report of #194) is never a validator: it
/// gathers findings and owns no check.
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
    /// Source-scoped identifier, version, quotation-location and
    /// citation-consistency diagnostics (ADR 0146).
    SourceReview,
}

impl Validator {
    pub const ALL: [Validator; 11] = [
        Self::ResearchProfile,
        Self::CitationReview,
        Self::ClaimReview,
        Self::SourceLibrary,
        Self::Notebook,
        Self::Atlas,
        Self::ChronologyIndex,
        Self::Claims,
        Self::Alignments,
        Self::ComparisonProjection,
        Self::SourceReview,
    ];

    /// The core entry point whose output this validator's findings are.
    pub fn entry_point(self) -> &'static str {
        match self {
            Self::ResearchProfile => "research::audit_document",
            Self::CitationReview => "citation_review::review_citations",
            Self::ClaimReview => "claim_review::review_claims",
            Self::SourceLibrary => "source_library::SourceLibrary::parse",
            Self::Notebook => "research_notes::Notebook::parse",
            Self::Atlas => "knowledge_atlas::Atlas::parse and Atlas::notices",
            Self::ChronologyIndex => "chronology_index::ChronologyIndex::of",
            Self::Claims => "claims::ClaimSet::parse and ClaimSet::notices",
            Self::Alignments => "alignment::AlignmentSet::parse and AlignmentSet::notices",
            Self::ComparisonProjection => "comparison_publication::PublicComparisons::project",
            Self::SourceReview => "source_review::review_post and source_review::review_library",
        }
    }

    /// The issue that will add this validator, when it does not exist yet.
    /// Every validator exists now; a later one names its issue here.
    pub fn planned_in(self) -> Option<u32> {
        None
    }
}

/// What kind of gap or prompt a finding is. Categories group findings for an
/// author; they never rank them.
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

impl Category {
    pub const ALL: [Category; 13] = [
        Self::Integrity,
        Self::PublicBoundary,
        Self::Structure,
        Self::Reference,
        Self::Identifier,
        Self::Version,
        Self::Locator,
        Self::Citation,
        Self::ClaimAnchor,
        Self::Evidence,
        Self::Provenance,
        Self::Chronology,
        Self::Rights,
    ];

    /// What the category is about, in the contract's own words.
    pub fn meaning(self) -> &'static str {
        match self {
            Self::Integrity => "a private research file or record cannot be read as written, or names something it does not hold",
            Self::PublicBoundary => "what stays private, what a publication leaves out, and private details in a field bound for public output",
            Self::Structure => "the visible sections a research post is expected to have",
            Self::Reference => "whether a reference is present, resolves to a library source and has the details its kind usually has",
            Self::Identifier => "the form of a work, source or cited identifier",
            Self::Version => "which original work, edition, translation or witness a record is, and how they relate",
            Self::Locator => "where in a source a citation, link, passage or member points",
            Self::Citation => "the form of an in-text citation and how its repetitions agree",
            Self::ClaimAnchor => "whether a claim is still attached to its words in the saved draft",
            Self::Evidence => "what a claim's recorded evidence links lack or leave for the author to discuss",
            Self::Provenance => "where a record came from: a suggestion, an import, an attribution, or an archived source or passage",
            Self::Chronology => "datings that cannot all hold as recorded",
            Self::Rights => "wording a publication leaves out under the author's rights statement or the excerpt limit",
        }
    }
}

/// One check: a property of the research record that exactly one validator
/// owns. The RW9 hand-off checks (missing reference, identifier, locator,
/// version or translation, citation consistency, evidence relation, rights,
/// unresolved claim) are all here.
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
    IdentifierCompatibility,
    VersionIdentity,
    QuotationLocation,
    CitationConsistency,
}

impl Check {
    pub const ALL: [Check; 25] = [
        Self::WorkStructure,
        Self::ReferenceSection,
        Self::WorkIdentifier,
        Self::CitationSyntax,
        Self::CitationResolution,
        Self::ReferenceCompleteness,
        Self::LocationReview,
        Self::ClaimAnchoring,
        Self::EvidenceRelation,
        Self::EvidenceProvenance,
        Self::EvidenceLocation,
        Self::LibraryIntegrity,
        Self::NotebookIntegrity,
        Self::AtlasIntegrity,
        Self::ClaimsIntegrity,
        Self::AlignmentsIntegrity,
        Self::AtlasProjection,
        Self::ClaimProjection,
        Self::AlignmentPlaces,
        Self::ChronologyConsistency,
        Self::ComparisonRights,
        Self::IdentifierCompatibility,
        Self::VersionIdentity,
        Self::QuotationLocation,
        Self::CitationConsistency,
    ];

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
            Self::IdentifierCompatibility
            | Self::VersionIdentity
            | Self::QuotationLocation
            | Self::CitationConsistency => Validator::SourceReview,
        }
    }

    /// The property the check compares, never a judgement of the work.
    pub fn property(self) -> &'static str {
        match self {
            Self::WorkStructure => "whether a research post has a visible Abstract and a References or Bibliography section",
            Self::ReferenceSection => "whether each footnote has a definition and each listed reference has a link in its preferred form",
            Self::WorkIdentifier => "the form of a research post's own DOI and license address",
            Self::CitationSyntax => "whether the scanner can read each in-text citation",
            Self::CitationResolution => "whether each citation key names a library source, each locator fits it, and each cited identifier is in a form readers can follow",
            Self::ReferenceCompleteness => "whether a cited reference has each detail its kind usually has",
            Self::LocationReview => "which citations give a location only a person can compare with the source",
            Self::ClaimAnchoring => "whether a claim's post exists and its words are still at the recorded place in the saved draft",
            Self::EvidenceRelation => "whether a claim has evidence links, rationales, discussed contradictions and reviewed suggestions",
            Self::EvidenceProvenance => "whether an evidence link rests on an archived source or passage",
            Self::EvidenceLocation => "whether an evidence link gives a location and whether someone recorded checking it",
            Self::LibraryIntegrity => "whether the source library can be read and its records, identifiers, locations and version relationships are well formed",
            Self::NotebookIntegrity => "whether the notebook can be read, stays private, and its passages keep their sources and well-formed locators",
            Self::AtlasIntegrity => "whether the atlas can be read and its entries, relationships, evidence and datings are well formed",
            Self::ClaimsIntegrity => "whether the claims file can be read and its claims, anchors and links are well formed",
            Self::AlignmentsIntegrity => "whether the alignments file can be read and its members are well formed",
            Self::AtlasProjection => "which approved atlas relationships and datings the projection leaves out because something they depend on is private",
            Self::ClaimProjection => "which approved evidence links the projection leaves out because their claim or a contradicting link is private",
            Self::AlignmentPlaces => "whether an aligned member's locators still match its passage and whether it rests on an archived source or passage",
            Self::ChronologyConsistency => "whether recorded datings can all hold at their stated precision",
            Self::ComparisonRights => "which compared wording the projection leaves out under the rights statement or the excerpt limit",
            Self::IdentifierCompatibility => "whether a source's identifiers conflict with each other or with another record's, or belong on another version",
            Self::VersionIdentity => "whether an edition, translation or witness, and each citation, quotation or passage of it, records the version details its kind needs: a translator, a repository and shelfmark, the volume of a page",
            Self::QuotationLocation => "whether a quotation or notebook passage gives a location in its source, and how narrow it is, not whether the words are there",
            Self::CitationConsistency => "whether the records a post cites name each source once and one version of each work",
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
            Self::LocationReview | Self::EvidenceLocation | Self::QuotationLocation => {
                "Compare the location with the source itself and record it."
            }
            Self::ClaimAnchoring => "Re-anchor the claim in the saved draft, or remove it.",
            Self::EvidenceRelation => "Record what the claim's evidence lacks, or leave it if nothing needs to change.",
            Self::EvidenceProvenance => "Check whether the archived source or passage still belongs here.",
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
            Self::ChronologyConsistency => "Check the datings against their cited evidence; a recorded disagreement can stay side by side.",
            Self::ComparisonRights => "Record the version's rights or shorten the place to publish its wording, or leave it out.",
            Self::IdentifierCompatibility => "Fix the identifier in the source library.",
            Self::VersionIdentity => "Record the version's details in the source library if it has them.",
            Self::CitationConsistency => "Make the repeated citations agree, or keep both and say why.",
        }
    }
}

/// What the owning validator does about the condition. Only deterministic
/// integrity and privacy failures refuse anything; potential and
/// needs-review findings are always advisory.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Gate {
    /// Nothing is refused; the author decides.
    Advisory,
    /// A post that publishes the citation is refused; a draft only warns.
    RefusesWhenPublished,
    /// The save, change or build that would write it is refused.
    Refuses,
}

kebab_display!(Validator, Category, Check, Gate, ObjectKind);

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
    /// The whole private source library.
    SourceLibrary,
    /// The whole private notebook.
    Notebook,
    /// The whole private Knowledge Atlas.
    Atlas,
    /// The whole private claims file.
    ClaimsFile,
    /// The whole private alignments file.
    AlignmentsFile,
}

/// Another object a finding is about: the claim of a link finding, the
/// datings of a chronology prompt, the version of a withheld place.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ObjectRef {
    pub kind: ObjectKind,
    pub id: String,
}

impl ObjectRef {
    fn new(kind: ObjectKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }
}

/// The one object a finding is about, and where in it. A detail the
/// validator did not report stays absent; nothing is filled in.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingScope {
    pub object: ObjectKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Zero-based position in the object's collection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    /// The file the finding points into: a post relative to the content
    /// folder, or the claims file a validator names.
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
    fn of(object: ObjectKind) -> Self {
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

/// One row of the finding matrix: how one code of one validator maps in.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixRow {
    pub validator: Validator,
    pub check: Check,
    /// The code exactly as its validator already reports it.
    pub code: String,
    pub category: Category,
    pub outcome: EvidenceOutcome,
    pub gate: Gate,
}

/// Any finding, notice, prompt or diagnostic of a research check, in the
/// one contract. `code`, `outcome`, `message` and `repair` are the
/// validator's own; the rest comes from the matrix.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletenessFinding {
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
    /// The validator's repair, or the check's next action when it gives none.
    pub repair: String,
    /// The position-free facts the validator stated: the keys, locators,
    /// identifiers, ids and stated values the finding is about, never a
    /// line, byte offset or sentence. The fingerprint is built from them.
    /// Never serialized, so nothing here can reach any output.
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

/// A table over a foreign code enum: the list and the exhaustive lookup are
/// generated from the same arms, so a new variant cannot compile until it
/// is mapped, and once mapped it is in the matrix.
macro_rules! code_table {
    ($all:ident, $lookup:ident, $ty:ident -> $out:ty { $($variant:ident => $row:expr,)* }) => {
        #[cfg_attr(not(test), allow(dead_code))]
        const $all: &[$ty] = &[$($ty::$variant),*];
        fn $lookup(code: $ty) -> $out {
            match code {
                $($ty::$variant => $row,)*
            }
        }
    };
}

use Category as C;
use Check as K;
use EvidenceOutcome as O;
use Gate as G;

code_table!(EVIDENCE_CODES, evidence_spec, EvidenceCode -> Spec {
    DoiInvalid => spec(K::WorkIdentifier, C::Identifier, O::Detected, G::Advisory),
    LicenseUrlInvalid => spec(K::WorkIdentifier, C::Identifier, O::Detected, G::Advisory),
    AbstractMissing => spec(K::WorkStructure, C::Structure, O::Detected, G::Advisory),
    ReferencesMissing => spec(K::WorkStructure, C::Reference, O::Detected, G::Advisory),
    FootnoteUnresolved => spec(K::ReferenceSection, C::Reference, O::Detected, G::Advisory),
    ReferenceLinkReview => spec(K::ReferenceSection, C::Reference, O::NeedsReview, G::Advisory),
    DoiLinkNonPreferred => spec(K::ReferenceSection, C::Identifier, O::Potential, G::Advisory),
    CitationSyntax => spec(K::CitationSyntax, C::Citation, O::Detected, G::RefusesWhenPublished),
    CitationUnresolved => spec(K::CitationResolution, C::Reference, O::Detected, G::RefusesWhenPublished),
    CitationIdentifierUnpublished => spec(K::CitationResolution, C::Identifier, O::Potential, G::Advisory),
    CitationReferenceIncomplete => spec(K::ReferenceCompleteness, C::Reference, O::Potential, G::Advisory),
    CitationLocationReview => spec(K::LocationReview, C::Locator, O::NeedsReview, G::Advisory),
    ClaimPostMissing => spec(K::ClaimAnchoring, C::ClaimAnchor, O::Detected, G::Advisory),
    ClaimAnchorMoved => spec(K::ClaimAnchoring, C::ClaimAnchor, O::Detected, G::Advisory),
    ClaimAnchorStale => spec(K::ClaimAnchoring, C::ClaimAnchor, O::Detected, G::Advisory),
    ClaimAnchorAmbiguous => spec(K::ClaimAnchoring, C::ClaimAnchor, O::Detected, G::Advisory),
    ClaimSuggestionUnreviewed => spec(K::EvidenceRelation, C::Provenance, O::NeedsReview, G::Advisory),
    ClaimEvidenceMissing => spec(K::EvidenceRelation, C::Evidence, O::Potential, G::Advisory),
    ClaimSupportOnly => spec(K::EvidenceRelation, C::Evidence, O::NeedsReview, G::Advisory),
    ClaimContradictionUndiscussed => spec(K::EvidenceRelation, C::Evidence, O::NeedsReview, G::Advisory),
    ClaimSourceArchived => spec(K::EvidenceProvenance, C::Provenance, O::NeedsReview, G::Advisory),
    ClaimPassageArchived => spec(K::EvidenceProvenance, C::Provenance, O::NeedsReview, G::Advisory),
    ClaimLocatorMissing => spec(K::EvidenceLocation, C::Locator, O::Potential, G::Advisory),
    ClaimLocationUnreviewed => spec(K::EvidenceLocation, C::Locator, O::NeedsReview, G::Advisory),
    ClaimRationaleMissing => spec(K::EvidenceRelation, C::Evidence, O::Potential, G::Advisory),
});

code_table!(CHRONOLOGY_CODES, chronology_spec, ChronologyPromptCode -> Spec {
    DeathBeforeBirth => CHRONOLOGY,
    CompositionAfterDeath => CHRONOLOGY,
    CompositionBeforeBirth => CHRONOLOGY,
    PublicationBeforeComposition => CHRONOLOGY,
    OutsideLifetime => CHRONOLOGY,
    OpposedRelative => CHRONOLOGY,
    RelativeCycle => CHRONOLOGY,
    RelativeAgainstDates => CHRONOLOGY,
});

const CHRONOLOGY: Spec = spec(
    K::ChronologyConsistency,
    C::Chronology,
    O::NeedsReview,
    G::Advisory,
);

/// Whether an atlas-family code is a notice about a valid file or an error
/// that refuses it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Class {
    Notice,
    Error,
}

const fn error(category: Category) -> (Class, Category, EvidenceOutcome) {
    (Class::Error, category, O::Detected)
}

code_table!(ATLAS_CODES, atlas_spec, AtlasDiagnosticCode -> (Class, Category, EvidenceOutcome) {
    TooLarge => error(C::Integrity),
    InvalidJson => error(C::Integrity),
    UnsupportedVersion => error(C::Integrity),
    MissingField => error(C::Integrity),
    InvalidField => error(C::Integrity),
    InvalidId => error(C::Integrity),
    DuplicateId => error(C::Integrity),
    UnknownEntry => error(C::Integrity),
    UnknownSource => error(C::Integrity),
    UnknownPassage => error(C::Integrity),
    UnknownLocatorKind => error(C::Locator),
    InvalidLocator => error(C::Locator),
    AmbiguousLocator => error(C::Locator),
    UnknownKind => error(C::Integrity),
    EndpointKind => error(C::Integrity),
    WrongSourceKind => error(C::Version),
    SelfRelationship => error(C::Integrity),
    DuplicateRelationship => error(C::Integrity),
    Cycle => error(C::Integrity),
    MissingEvidence => error(C::Evidence),
    EvidenceConflict => error(C::Evidence),
    InvalidVisibility => error(C::PublicBoundary),
    PrivateEndpoint => (Class::Notice, C::PublicBoundary, O::Detected),
    PrivateReference => error(C::PublicBoundary),
    ContributorCredit => error(C::PublicBoundary),
    StillLinked => error(C::Integrity),
    ShadowedField => error(C::Integrity),
    UnknownClaim => error(C::Integrity),
    DuplicateLink => error(C::Integrity),
    AnchorMismatch => error(C::ClaimAnchor),
    UndisclosedContradiction => (Class::Notice, C::PublicBoundary, O::Detected),
    UnknownLink => error(C::Integrity),
    StaleAnchor => error(C::ClaimAnchor),
    AmbiguousAnchor => error(C::ClaimAnchor),
    UnknownPost => error(C::Integrity),
    InvalidDate => error(C::Chronology),
    AspectKind => error(C::Chronology),
    DuplicateDating => error(C::Chronology),
    UnpublishedDatings => (Class::Notice, C::PublicBoundary, O::Detected),
    UnknownInterpretation => error(C::Integrity),
    DuplicateMember => error(C::Integrity),
    ConflictingMember => error(C::Integrity),
    MissingCounterpart => error(C::Integrity),
    MissingLocator => error(C::Locator),
    MissingOriginal => error(C::Integrity),
    StaleLocator => (Class::Notice, C::Locator, O::NeedsReview),
    ArchivedMember => (Class::Notice, C::Provenance, O::NeedsReview),
    UnknownAlignment => error(C::Integrity),
});

use AtlasDiagnosticCode as A;

/// The codes each file's validator reports, errors and notices, for the
/// matrix. A code only another file's validator reports (`cycle` is the
/// atlas's, `anchor-mismatch` the claims file's, `missing-original` the
/// alignments file's) has no row under this one.
const SUBJECT_CODES: [(DiagnosticSubject, &[AtlasDiagnosticCode]); 3] = [
    (
        DiagnosticSubject::Atlas,
        &[
            A::TooLarge,
            A::InvalidJson,
            A::UnsupportedVersion,
            A::MissingField,
            A::InvalidField,
            A::InvalidId,
            A::DuplicateId,
            A::UnknownEntry,
            A::UnknownSource,
            A::UnknownPassage,
            A::UnknownLocatorKind,
            A::InvalidLocator,
            A::AmbiguousLocator,
            A::UnknownKind,
            A::EndpointKind,
            A::WrongSourceKind,
            A::SelfRelationship,
            A::DuplicateRelationship,
            A::Cycle,
            A::MissingEvidence,
            A::EvidenceConflict,
            A::InvalidVisibility,
            A::PrivateReference,
            A::ContributorCredit,
            A::StillLinked,
            A::ShadowedField,
            A::InvalidDate,
            A::AspectKind,
            A::DuplicateDating,
            A::PrivateEndpoint,
            A::UnpublishedDatings,
        ],
    ),
    (
        DiagnosticSubject::Claims,
        &[
            A::TooLarge,
            A::InvalidJson,
            A::UnsupportedVersion,
            A::MissingField,
            A::InvalidField,
            A::InvalidId,
            A::DuplicateId,
            A::UnknownSource,
            A::UnknownPassage,
            A::UnknownLocatorKind,
            A::InvalidLocator,
            A::AmbiguousLocator,
            A::UnknownKind,
            A::MissingEvidence,
            A::InvalidVisibility,
            A::PrivateReference,
            A::ContributorCredit,
            A::StillLinked,
            A::ShadowedField,
            A::UnknownClaim,
            A::DuplicateLink,
            A::AnchorMismatch,
            A::UnknownLink,
            A::StaleAnchor,
            A::AmbiguousAnchor,
            A::UnknownPost,
            A::PrivateEndpoint,
            A::UndisclosedContradiction,
        ],
    ),
    (
        DiagnosticSubject::Alignments,
        &[
            A::TooLarge,
            A::InvalidJson,
            A::UnsupportedVersion,
            A::MissingField,
            A::InvalidField,
            A::InvalidId,
            A::DuplicateId,
            A::UnknownSource,
            A::UnknownPassage,
            A::UnknownLocatorKind,
            A::InvalidLocator,
            A::AmbiguousLocator,
            A::UnknownKind,
            A::WrongSourceKind,
            A::InvalidVisibility,
            A::ContributorCredit,
            A::StillLinked,
            A::ShadowedField,
            A::UnknownInterpretation,
            A::DuplicateMember,
            A::ConflictingMember,
            A::MissingCounterpart,
            A::MissingLocator,
            A::MissingOriginal,
            A::UnknownAlignment,
            A::StaleLocator,
            A::ArchivedMember,
        ],
    ),
];

fn atlas_family(subject: DiagnosticSubject, code: AtlasDiagnosticCode) -> Spec {
    let (class, category, outcome) = atlas_spec(code);
    let check = match (subject, class) {
        (DiagnosticSubject::Atlas, Class::Error) => K::AtlasIntegrity,
        (DiagnosticSubject::Atlas, Class::Notice) => K::AtlasProjection,
        (DiagnosticSubject::Claims, Class::Error) => K::ClaimsIntegrity,
        (DiagnosticSubject::Claims, Class::Notice) => K::ClaimProjection,
        (DiagnosticSubject::Alignments, Class::Error) => K::AlignmentsIntegrity,
        (DiagnosticSubject::Alignments, Class::Notice) => K::AlignmentPlaces,
    };
    let gate = match class {
        Class::Error => G::Refuses,
        Class::Notice => G::Advisory,
    };
    spec(check, category, outcome, gate)
}

const fn notebook_error(category: Category) -> Spec {
    spec(K::NotebookIntegrity, category, O::Detected, G::Refuses)
}

code_table!(NOTE_CODES, note_spec, NoteDiagnosticCode -> Spec {
    TooLarge => notebook_error(C::Integrity),
    InvalidJson => notebook_error(C::Integrity),
    UnsupportedVersion => notebook_error(C::Integrity),
    MissingField => notebook_error(C::Integrity),
    InvalidField => notebook_error(C::Integrity),
    InvalidId => notebook_error(C::Integrity),
    DuplicateId => notebook_error(C::Integrity),
    UnknownSource => notebook_error(C::Integrity),
    UnknownPassage => notebook_error(C::Integrity),
    UnknownLocatorKind => notebook_error(C::Locator),
    InvalidLocator => notebook_error(C::Locator),
    AmbiguousLocator => notebook_error(C::Locator),
    NotPrivate => notebook_error(C::PublicBoundary),
    ContributorCredit => notebook_error(C::PublicBoundary),
    ReaderFeedback => notebook_error(C::PublicBoundary),
    SourceChanged => notebook_error(C::Provenance),
    StillLinked => notebook_error(C::Integrity),
    UnknownEntry => notebook_error(C::Integrity),
});

const fn library_error(category: Category) -> Spec {
    spec(K::LibraryIntegrity, category, O::Detected, G::Refuses)
}

code_table!(SOURCE_CODES, source_spec, SourceDiagnosticCode -> Spec {
    TooLarge => library_error(C::Integrity),
    InvalidJson => library_error(C::Integrity),
    UnsupportedVersion => library_error(C::Integrity),
    MissingField => library_error(C::Integrity),
    InvalidField => library_error(C::Integrity),
    InvalidId => library_error(C::Integrity),
    DuplicateId => library_error(C::Integrity),
    UnknownKind => library_error(C::Integrity),
    KindChanged => library_error(C::Version),
    UnknownSource => library_error(C::Integrity),
    UnresolvedRelationship => library_error(C::Version),
    InvalidRelationship => library_error(C::Version),
    AmbiguousRelationship => library_error(C::Version),
    RelationshipCycle => library_error(C::Version),
    AmbiguousLocation => library_error(C::Locator),
    InvalidIdentifier => library_error(C::Identifier),
    ContributorCredit => library_error(C::PublicBoundary),
    StillUsed => library_error(C::Integrity),
    ConflictingAttribution => library_error(C::Provenance),
});

code_table!(WITHHELD, withheld_spec, Withheld -> (&'static str, Spec) {
    Rights => ("withheld-rights", spec(K::ComparisonRights, C::Rights, O::Detected, G::Advisory)),
    Length => ("withheld-length", spec(K::ComparisonRights, C::Rights, O::Detected, G::Advisory)),
});

code_table!(SOURCE_REVIEW_CODES, source_review_spec, SourceReviewCode -> Spec {
    IdentifierConflict => spec(K::IdentifierCompatibility, C::Identifier, O::Potential, G::Advisory),
    IdentifierShared => spec(K::IdentifierCompatibility, C::Identifier, O::NeedsReview, G::Advisory),
    IdentifierOnWork => spec(K::IdentifierCompatibility, C::Identifier, O::NeedsReview, G::Advisory),
    VolumeMissing => spec(K::VersionIdentity, C::Locator, O::Detected, G::Advisory),
    VolumeUnknown => spec(K::VersionIdentity, C::Locator, O::Detected, G::Advisory),
    TranslatorMissing => spec(K::VersionIdentity, C::Version, O::Potential, G::Advisory),
    WitnessUnidentified => spec(K::VersionIdentity, C::Version, O::Potential, G::Advisory),
    VersionUnspecified => spec(K::VersionIdentity, C::Version, O::NeedsReview, G::Advisory),
    QuotationLocatorMissing => spec(K::QuotationLocation, C::Locator, O::Potential, G::Advisory),
    QuotationLocationBroad => spec(K::QuotationLocation, C::Locator, O::NeedsReview, G::Advisory),
    PassageLocatorMissing => spec(K::QuotationLocation, C::Locator, O::Potential, G::Advisory),
    CitationSameIdentifier => spec(K::CitationConsistency, C::Citation, O::Potential, G::Advisory),
    CitationVersionsMixed => spec(K::CitationConsistency, C::Citation, O::NeedsReview, G::Advisory),
});

fn row(code: String, spec: Spec) -> MatrixRow {
    MatrixRow {
        validator: spec.check.owner(),
        check: spec.check,
        code,
        category: spec.category,
        outcome: spec.outcome,
        gate: spec.gate,
    }
}

/// Every code every existing research check reports, mapped in. The
/// validator of a row is always its check's owner. An atlas-family code has
/// a row only under the file validators that report it (`SUBJECT_CODES`),
/// never under all three.
pub fn matrix() -> Vec<MatrixRow> {
    let mut rows = Vec::new();
    rows.extend(
        EVIDENCE_CODES
            .iter()
            .map(|&code| row(code.to_string(), evidence_spec(code))),
    );
    rows.extend(
        SOURCE_CODES
            .iter()
            .map(|&code| row(code.to_string(), source_spec(code))),
    );
    rows.extend(
        NOTE_CODES
            .iter()
            .map(|&code| row(code.to_string(), note_spec(code))),
    );
    for (subject, codes) in SUBJECT_CODES {
        rows.extend(
            codes
                .iter()
                .map(|&code| row(code.to_string(), atlas_family(subject, code))),
        );
    }
    rows.extend(
        CHRONOLOGY_CODES
            .iter()
            .map(|&code| row(code.to_string(), chronology_spec(code))),
    );
    rows.extend(WITHHELD.iter().map(|&withheld| {
        let (code, spec) = withheld_spec(withheld);
        row(code.to_string(), spec)
    }));
    rows.extend(
        SOURCE_REVIEW_CODES
            .iter()
            .map(|&code| row(code.to_string(), source_review_spec(code))),
    );
    rows
}

impl CompletenessFinding {
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

    /// A research-profile, citation or claim-review finding (ADR 0002,
    /// ADR 0050, ADR 0074). A claim finding is scoped to its claim, a link
    /// finding to its link with the claim related; anything else to the post.
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

    /// A diagnostic or notice of the atlas, claims or alignments file,
    /// owned by that file's validator.
    pub fn from_atlas_diagnostic(diagnostic: &AtlasDiagnostic) -> Self {
        let spec = atlas_family(diagnostic.subject, diagnostic.code);
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

    /// A chronology prompt (ADR 0097), scoped to the entry or relationship
    /// that owns the dating it starts from, with every dating it is about
    /// related in the prompt's order.
    pub fn from_chronology_prompt(prompt: &ChronologyPrompt) -> Self {
        let spec = chronology_spec(prompt.code);
        Self::mapped(
            prompt.code.to_string(),
            spec,
            spec.outcome,
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
        let spec = note_spec(diagnostic.code);
        let object = match diagnostic.collection {
            Some("passages") => ObjectKind::Passage,
            Some("notes") => ObjectKind::Note,
            _ => ObjectKind::Notebook,
        };
        let in_collection = object != ObjectKind::Notebook;
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
            Vec::new(),
        )
    }

    /// A source-library diagnostic: every one refuses the change it is about.
    pub fn from_source_diagnostic(diagnostic: &SourceDiagnostic) -> Self {
        let spec = source_spec(diagnostic.code);
        let record = diagnostic.index.is_some() || diagnostic.source_id.is_some();
        Self::mapped(
            diagnostic.code.to_string(),
            spec,
            spec.outcome,
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

    /// Each place a published comparison leaves the wording of (ADR 0092),
    /// scoped to its alignment member, with the version related. The
    /// message is the public "Wording not shown" sentence, which holds no
    /// author text.
    pub fn from_comparisons(published: &PublicComparisons) -> Vec<Self> {
        let mut findings = Vec::new();
        for comparison in &published.comparisons {
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
                    let (code, spec) = withheld_spec(withheld);
                    findings.push(Self::mapped(
                        code.to_string(),
                        spec,
                        spec.outcome,
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
        }
        findings
    }

    /// A source-review finding (ADR 0146): scoped to the post, record or
    /// passage it names, with every other source it is about related.
    pub fn from_source_review(finding: &SourceReviewFinding) -> Self {
        let object = match finding.object {
            ReviewObject::Post => ObjectKind::Post,
            ReviewObject::Source => ObjectKind::Source,
            ReviewObject::Passage => ObjectKind::Passage,
        };
        Self::mapped(
            finding.code.to_string(),
            source_review_spec(finding.code),
            finding.outcome,
            FindingScope {
                id: finding.id.clone(),
                index: finding.index,
                path: finding.path.clone(),
                line: finding.line,
                field: finding.field.clone(),
                ..FindingScope::of(object)
            },
            finding
                .related
                .iter()
                .map(|id| ObjectRef::new(ObjectKind::Source, id.clone()))
                .collect(),
            finding.message.clone(),
            Some(finding.repair.clone()),
            finding.facts.clone(),
        )
    }

    /// What an acknowledgement is matched by: the validator, code, object,
    /// file and field. The file keeps findings about different posts apart
    /// when they name no id (`abstract-missing` on two posts). Lines and
    /// positions are left out because they move with unrelated edits.
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

    /// A fingerprint of what the finding says about its object: the key, the
    /// related objects and the validator's position-free facts. When any of
    /// them changes (a source revision moves a passage's locators, a
    /// dating's stated value changes, another located citation appears, a
    /// cited locator changes) an acknowledgement of the old finding no
    /// longer matches it. The message is never an input, so a line number
    /// or byte offset it names, or a change to its wording, never makes an
    /// acknowledgement stale.
    pub fn fingerprint(&self) -> String {
        let mut hasher = Blake2s256::new();
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
        hasher.update(parts.to_string().as_bytes());
        hasher.finalize()[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The total order of the contract: by file, object and place, then
    /// category, outcome, validator, check and code, then message, related
    /// objects, repair, gate and facts, so equal findings, and only those,
    /// compare equal.
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

/// The acknowledgement state of each advisory finding, in order.
fn advisory_states(
    advisory: &[(AcknowledgementKey<'_>, &str)],
    acknowledgements: &[Acknowledgement],
) -> Vec<Option<AcknowledgementState>> {
    advisory
        .iter()
        .map(|(key, fingerprint)| {
            let mut acks = acknowledgements.iter().filter(|ack| ack.key() == *key);
            let mut stale = false;
            for ack in acks.by_ref() {
                if ack.fingerprint == *fingerprint {
                    return Some(AcknowledgementState::Current);
                }
                let fits_another = advisory
                    .iter()
                    .any(|(other, print)| other == key && *print == ack.fingerprint);
                stale |= !fits_another;
            }
            stale.then_some(AcknowledgementState::Stale)
        })
        .collect()
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

/// The author's record that they have seen an advisory finding and decided
/// what, if anything, to do. It never makes the finding resolved: the
/// finding is still listed and counted under its outcome, and it disappears
/// only when the record holds what was missing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acknowledgement {
    pub validator: Validator,
    pub code: String,
    pub object: ObjectKind,
    /// The file the finding points into, as its scope names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    /// [`CompletenessFinding::fingerprint`] when it was acknowledged.
    pub fingerprint: String,
}

impl Acknowledgement {
    /// Acknowledge a finding as it stands. `None` when its validator refuses
    /// something on it: an integrity or privacy failure is corrected, never
    /// acknowledged.
    pub fn of(finding: &CompletenessFinding) -> Option<Self> {
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

/// How an acknowledgement stands against the finding it names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AcknowledgementState {
    /// The author acknowledged this finding as it reads now.
    Current,
    /// The author acknowledged an earlier form of it; what it says has
    /// changed since, so it needs their attention again.
    Stale,
}

/// One finding in a report, with its fingerprint and acknowledgement.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportEntry {
    #[serde(flatten)]
    pub finding: CompletenessFinding,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledgement: Option<AcknowledgementState>,
}

/// How many findings one outcome has, and how many of those the author has
/// acknowledged as they read now. Acknowledged findings are still found.
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

/// Findings from any number of validators, in the contract's one order with
/// exact duplicates removed, and the author's acknowledgements matched.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletenessReport {
    pub version: u32,
    pub findings: Vec<ReportEntry>,
    pub counts: OutcomeCounts,
    /// Acknowledgements that name no advisory finding in this report,
    /// usually because the record now holds what was missing.
    pub unmatched_acknowledgements: usize,
}

impl CompletenessReport {
    /// Gather findings in any order. The result depends only on the set of
    /// findings and acknowledgements, never on the order they arrive in.
    pub fn new(
        findings: impl IntoIterator<Item = CompletenessFinding>,
        acknowledgements: &[Acknowledgement],
    ) -> Self {
        let mut findings: Vec<CompletenessFinding> = findings.into_iter().collect();
        findings.sort_by(CompletenessFinding::order);
        findings.dedup();
        let fingerprints: Vec<String> = findings.iter().map(|f| f.fingerprint()).collect();
        let advisory: Vec<(AcknowledgementKey<'_>, &str)> = findings
            .iter()
            .zip(&fingerprints)
            .filter(|(finding, _)| finding.gate == Gate::Advisory)
            .map(|(finding, fingerprint)| (finding.key(), fingerprint.as_str()))
            .collect();
        // An acknowledgement belongs to the finding it was made for while
        // that finding still reads the same; only one that fits no current
        // finding under its key marks the others with that key stale.
        let mut states = advisory_states(&advisory, acknowledgements).into_iter();
        let unmatched = acknowledgements
            .iter()
            .filter(|ack| !advisory.iter().any(|(key, _)| *key == ack.key()))
            .count();
        let mut counts = OutcomeCounts::default();
        let entries = findings
            .iter()
            .zip(fingerprints.iter())
            .map(|(finding, fingerprint)| {
                let acknowledgement = if finding.gate == Gate::Advisory {
                    states.next().flatten()
                } else {
                    None
                };
                let (finding, fingerprint) = (finding.clone(), fingerprint.clone());
                let count = counts.of(finding.outcome);
                count.found += 1;
                if acknowledgement == Some(AcknowledgementState::Current) {
                    count.acknowledged += 1;
                }
                ReportEntry {
                    finding,
                    fingerprint,
                    acknowledgement,
                }
            })
            .collect();
        Self {
            version: COMPLETENESS_FORMAT_VERSION,
            findings: entries,
            counts,
            unmatched_acknowledgements: unmatched,
        }
    }

    /// Deterministic, pretty-printed JSON with a trailing newline.
    pub fn to_json(&self) -> String {
        let mut json = serde_json::to_string_pretty(self).unwrap_or_default();
        json.push('\n');
        json
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_atlas_family_code_is_listed_under_a_file_that_reports_it() {
        for code in ATLAS_CODES {
            assert!(
                SUBJECT_CODES.iter().any(|(_, codes)| codes.contains(code)),
                "{code} is reported by no file"
            );
        }
        for (subject, codes) in SUBJECT_CODES {
            let mut seen = Vec::new();
            for code in codes {
                assert!(!seen.contains(code), "{code} twice under {subject:?}");
                seen.push(*code);
            }
        }
    }
}

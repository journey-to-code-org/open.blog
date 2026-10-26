//! The private-to-public research boundary (#63, ADR 0137).
//!
//! Research is private until a projection publishes it: citations publish
//! the public description of the sources a published post cites (ADR 0048),
//! the Knowledge Atlas its approved entries and relationships (ADR 0058) and
//! their approved datings (ADR 0099), claim evidence the approved claims and
//! links of published posts (ADR 0075), and comparisons the approved
//! alignments (ADR 0092). Each has its own opt-in switch and its own rules.
//!
//! [`BoundaryManifest`] says, for the whole site or for one post, exactly
//! which research items each projection publishes, with the fields it
//! copies, and why every other item is withheld. It is built from the very
//! projection values a build renders (the [`PublicAtlas`] and
//! [`PublicComparisons`] the build writes, and the citations and claim
//! evidence each published post carries), never from a second reading of
//! the rules, so the Admin preview and the build cannot disagree. The
//! private files are read only to name what is withheld and why.
//!
//! [`PrivateText`] is the build's last, systematic guard: it holds the text
//! of every private research file and finds any of it in generated output
//! that no approved projection and no public input accounts for, whatever
//! path the text took. It never reports the text itself, only where it came
//! from.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;
use serde_json::Value;

use crate::alignment::AlignmentSet;
use crate::atlas_publication::{aspect_noun, PublicAtlas};
use crate::citations::{public_identifier, public_url_problem, PublicReference};
use crate::claims::{ClaimSet, Relation};
use crate::comparison_publication::{PublicComparisons, Withheld};
use crate::context_links::{find_context_links, ContextKind};
use crate::knowledge_atlas::{Atlas, Visibility};
use crate::model::Post;
use crate::research_notes::Notebook;
use crate::shingles::{each_shingle, Form};
use crate::source_library::SourceLibrary;

/// The version of the serialized [`BoundaryManifest`].
pub const BOUNDARY_FORMAT_VERSION: u32 = 1;

/// One way research reaches the public site.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Projection {
    /// The public description of each source a published post cites.
    Citations,
    /// Approved claims and evidence links, in the post they are about.
    ClaimEvidence,
    /// Approved Knowledge Atlas entries and relationships.
    Atlas,
    /// Approved datings of published atlas items.
    Datings,
    /// Approved passage comparisons.
    Comparisons,
    /// Links a post makes to atlas and comparison pages.
    ContextLinks,
}

impl Projection {
    /// The switch that turns the projection on: a front matter key for
    /// citations, an `openblog.json` key for the others.
    pub fn switch(self) -> &'static str {
        match self {
            Self::Citations => "citations",
            Self::ClaimEvidence => "claimEvidence.publish",
            Self::Atlas | Self::Datings => "knowledgeAtlas.publish",
            Self::Comparisons => "comparisons.publish",
            Self::ContextLinks => "knowledgeAtlas.publish, comparisons.publish",
        }
    }
}

/// What kind of research item an entry of the manifest names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ItemKind {
    Source,
    Claim,
    EvidenceLink,
    Entry,
    Relationship,
    Dating,
    Comparison,
    /// A link in a post to an atlas entry's page.
    AtlasPage,
    /// A link in a post to a comparison's page.
    ComparisonPage,
}

/// Why an item, or one field of a published item, is withheld. Each is a
/// rule of the projection that withholds it; none is a judgement of the
/// research.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Reason {
    /// The site does not publish this projection.
    ProjectionOff,
    /// The author has not approved it: it is private research.
    NotApproved,
    /// An unsourced draft, which is never published.
    Unsourced,
    /// It rests on a notebook passage, which is never published.
    NotebookPassage,
    /// Something it depends on is not published.
    PrivateDependency,
    /// Support stays private while contradicting evidence on the claim is private.
    ContradictionWithheld,
    /// The post it belongs to is not published by this build.
    PostNotPublished,
    /// Approved before what it rests on changed, so the approval no longer holds.
    StaleApproval,
    /// A web address the boundary withholds.
    UnsafeUrl,
    /// An identifier in a scheme or form that is never published.
    PrivateIdentifier,
    /// Wording the version's rights statement does not let the site show.
    Rights,
    /// Wording longer than a brief excerpt.
    Length,
    /// The words a claim was anchored to are no longer exactly there.
    StaleAnchor,
    /// The page a link names is not published.
    PageNotPublished,
}

/// One field of a published item that is left out, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WithheldField {
    pub field: String,
    pub reason: Reason,
    pub message: String,
}

/// One research item a projection publishes, with the fields it copies.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedItem {
    pub kind: ItemKind,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// The posts it is published with or cited by, by slug.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub posts: Vec<String>,
    /// Its public address, root-relative, when it has a page of its own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// The fields the projection copies, in the projection's own names.
    pub fields: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub withheld_fields: Vec<WithheldField>,
}

/// One research item a projection could publish but withholds, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WithheldItem {
    pub kind: ItemKind,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub posts: Vec<String>,
    pub reason: Reason,
    /// One sentence naming ids and fields only.
    pub message: String,
}

/// What one projection publishes and withholds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionReport {
    pub projection: Projection,
    pub switch: &'static str,
    pub enabled: bool,
    /// Why nothing can be said about it: a private file it reads cannot be
    /// read, so the build refuses until it is repaired.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
    pub published: Vec<PublishedItem>,
    pub withheld: Vec<WithheldItem>,
}

/// A private research file, by what it holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Store {
    SourceLibrary,
    Notebook,
    Atlas,
    Claims,
    Alignments,
    Acknowledgements,
}

impl Store {
    /// The file, relative to the project root.
    pub fn file(self) -> &'static str {
        match self {
            Self::SourceLibrary => ".openblog/private/research/sources.json",
            Self::Notebook => ".openblog/private/research/notebook.json",
            Self::Atlas => ".openblog/private/research/atlas.json",
            Self::Claims => ".openblog/private/research/claims.json",
            Self::Alignments => ".openblog/private/research/alignments.json",
            Self::Acknowledgements => ".openblog/private/research/acknowledgements.json",
        }
    }

    /// How the file is named in a sentence.
    pub fn name(self) -> &'static str {
        match self {
            Self::SourceLibrary => "the source library",
            Self::Notebook => "the research notebook",
            Self::Atlas => "the Knowledge Atlas",
            Self::Claims => "the claims file",
            Self::Alignments => "the alignments file",
            Self::Acknowledgements => "the review acknowledgements",
        }
    }

    pub const ALL: [Store; 6] = [
        Self::SourceLibrary,
        Self::Notebook,
        Self::Atlas,
        Self::Claims,
        Self::Alignments,
        Self::Acknowledgements,
    ];
}

/// Research no projection ever publishes, by file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NeverPublished {
    pub store: Store,
    pub file: &'static str,
    /// How many records of the file it covers.
    pub count: usize,
    pub what: String,
}

/// A private file the manifest could not read; what depends on it says so.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Unavailable {
    pub store: Store,
    pub file: &'static str,
    pub message: String,
}

/// Whether the manifest covers the whole site or one post.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Scope {
    Site,
    Post { path: String, slug: String },
}

/// Exactly what the research projections publish, and why the rest is withheld.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundaryManifest {
    pub version: u32,
    pub scope: Scope,
    pub projections: Vec<ProjectionReport>,
    pub never: Vec<NeverPublished>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unavailable: Vec<Unavailable>,
}

/// The switches of the projections, as the site configuration sets them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Switches {
    pub atlas: bool,
    pub comparisons: bool,
    pub claim_evidence: bool,
}

impl Switches {
    pub fn of(config: &crate::config::SiteConfig) -> Self {
        Self {
            atlas: config.knowledge_atlas.publish,
            comparisons: config.comparisons.publish,
            claim_evidence: config.claim_evidence.publish,
        }
    }
}

/// What the manifest is built from: the projections exactly as the build
/// holds them, and the private files, read only to explain what is withheld.
#[derive(Clone, Copy)]
pub struct BoundaryInputs<'a> {
    pub switches: Switches,
    /// The posts this build publishes, each with the citations and claim
    /// evidence the load gave it.
    pub posts: &'a [Post],
    /// The atlas projection the build renders, while it publishes the atlas.
    pub public_atlas: Option<&'a PublicAtlas>,
    /// Why the atlas projection could not be built, when it could not.
    pub atlas_blocked: Option<&'a str>,
    /// The comparison projection the build renders.
    pub public_comparisons: Option<&'a PublicComparisons>,
    pub comparisons_blocked: Option<&'a str>,
    /// Why claim evidence could not be read for the build, when it could not.
    pub claims_blocked: Option<&'a str>,
    pub library: Option<&'a SourceLibrary>,
    pub notebook: Option<&'a Notebook>,
    pub atlas: Option<&'a Atlas>,
    pub claims: Option<&'a ClaimSet>,
    pub alignments: Option<&'a AlignmentSet>,
    /// Stale approvals of approved alignments, by id (`stale_approvals`).
    pub stale_comparisons: Option<&'a BTreeMap<String, String>>,
    pub acknowledgements: Option<usize>,
    pub unavailable: &'a [Unavailable],
}

fn present(fields: &mut Vec<String>, name: &str, present: bool) {
    if present {
        fields.push(name.to_string());
    }
}

/// The fields a public reference copies, and the identifiers of its record
/// the boundary withholds.
fn source_item(
    reference: &PublicReference,
    library: Option<&SourceLibrary>,
    posts: Vec<String>,
) -> PublishedItem {
    let mut fields = vec!["kind".to_string()];
    present(&mut fields, "title", reference.title.is_some());
    present(&mut fields, "creators", !reference.creators.is_empty());
    present(&mut fields, "issued", reference.issued.is_some());
    present(&mut fields, "language", reference.language.is_some());
    for (scheme, _) in &reference.identifiers {
        fields.push(format!("identifiers.{scheme}"));
    }
    for name in reference.csl.keys() {
        fields.push(format!("csl.{name}"));
    }
    let mut withheld_fields = Vec::new();
    if let Some(record) = library.and_then(|library| library.get(&reference.key)) {
        for identifier in &record.identifiers {
            let field = format!("identifiers.{}", identifier.scheme);
            if !public_identifier(&identifier.scheme, &identifier.value) {
                withheld_fields.push(WithheldField {
                    field,
                    reason: Reason::PrivateIdentifier,
                    message: format!(
                        "Source `{}`: its `{}` identifier is not in a public scheme or standard form, so it stays private.",
                        reference.key, identifier.scheme
                    ),
                });
            } else if identifier.scheme == "url" {
                if let Some(problem) = public_url_problem(&identifier.value) {
                    withheld_fields.push(WithheldField {
                        field,
                        reason: Reason::UnsafeUrl,
                        message: format!(
                            "Source `{}`: its web address is withheld because {problem}.",
                            reference.key
                        ),
                    });
                }
            }
        }
    }
    PublishedItem {
        kind: ItemKind::Source,
        id: reference.key.clone(),
        label: reference.title.clone(),
        posts,
        url: None,
        fields,
        withheld_fields,
    }
}

fn sources_of<'r>(
    references: impl Iterator<Item = (&'r PublicReference, Option<&'r str>)>,
    library: Option<&SourceLibrary>,
) -> Vec<PublishedItem> {
    let mut by_id: BTreeMap<&str, (&PublicReference, BTreeSet<String>)> = BTreeMap::new();
    for (reference, post) in references {
        let entry = by_id
            .entry(reference.key.as_str())
            .or_insert_with(|| (reference, BTreeSet::new()));
        if let Some(post) = post {
            entry.1.insert(post.to_string());
        }
    }
    by_id
        .into_values()
        .map(|(reference, posts)| source_item(reference, library, posts.into_iter().collect()))
        .collect()
}

fn report(projection: Projection, enabled: bool) -> ProjectionReport {
    ProjectionReport {
        projection,
        switch: projection.switch(),
        enabled,
        blocked: None,
        published: Vec::new(),
        withheld: Vec::new(),
    }
}

fn withheld(kind: ItemKind, id: &str, reason: Reason, message: String) -> WithheldItem {
    WithheldItem {
        kind,
        id: id.to_string(),
        label: None,
        posts: Vec::new(),
        reason,
        message,
    }
}

fn off_message(projection: Projection) -> String {
    format!(
        "The site does not publish this; `{}` is off, so nothing here reaches the public site.",
        projection.switch()
    )
}

impl BoundaryManifest {
    /// The manifest of the whole site.
    pub fn site(inputs: &BoundaryInputs<'_>) -> Self {
        let slugs: BTreeSet<&str> = inputs.posts.iter().map(|p| p.slug.as_str()).collect();
        let projections = vec![
            citations(inputs, inputs.posts.iter().collect()),
            claim_evidence(inputs, inputs.posts.iter().collect(), &slugs, None),
            atlas(inputs),
            datings(inputs),
            comparisons(inputs),
        ];
        Self {
            version: BOUNDARY_FORMAT_VERSION,
            scope: Scope::Site,
            projections,
            never: never(inputs),
            unavailable: inputs.unavailable.to_vec(),
        }
    }

    /// The manifest of one post: its citations, its claim evidence and the
    /// atlas and comparison pages it links to. `post` must be one of
    /// `inputs.posts`, or the post previewed beside them.
    pub fn post(inputs: &BoundaryInputs<'_>, post: &Post) -> Self {
        let mut slugs: BTreeSet<&str> = inputs.posts.iter().map(|p| p.slug.as_str()).collect();
        slugs.insert(post.slug.as_str());
        let projections = vec![
            citations(inputs, vec![post]),
            claim_evidence(inputs, vec![post], &slugs, Some(post.slug.as_str())),
            context_links(inputs, post),
        ];
        Self {
            version: BOUNDARY_FORMAT_VERSION,
            scope: Scope::Post {
                path: post.source.clone(),
                slug: post.slug.clone(),
            },
            projections,
            never: never(inputs),
            unavailable: inputs.unavailable.to_vec(),
        }
    }

    /// The precise diagnostics the build prints for what the boundary newly
    /// withholds: a stale approval or an unsafe web address. Each names its
    /// projection, its object and its field; none repeats private text.
    pub fn build_warnings(&self) -> Vec<String> {
        let mut warnings = Vec::new();
        for report in &self.projections {
            for item in &report.withheld {
                if item.reason == Reason::StaleApproval {
                    warnings.push(format!("boundary: {}", item.message));
                }
            }
            for item in &report.published {
                for field in &item.withheld_fields {
                    if field.reason == Reason::UnsafeUrl {
                        warnings.push(format!("boundary: {}", field.message));
                    }
                }
            }
        }
        warnings.sort();
        warnings.dedup();
        warnings
    }

    /// One line for `openblog build`: how many research items each
    /// projection published and how many were withheld, or `None` when no
    /// projection published or withheld anything (a site without research
    /// prints exactly what it printed before).
    pub fn summary(&self) -> Option<String> {
        let mut parts = Vec::new();
        let mut withheld = 0;
        for report in &self.projections {
            withheld += report.withheld.len();
            let count = report
                .published
                .iter()
                .filter(|item| {
                    item.kind != ItemKind::Source || report.projection == Projection::Citations
                })
                .count();
            if count > 0 {
                let name = match report.projection {
                    Projection::Citations => "cited sources",
                    Projection::ClaimEvidence => "claims and evidence links",
                    Projection::Atlas => "atlas entries and relationships",
                    Projection::Datings => "datings",
                    Projection::Comparisons => "comparisons",
                    Projection::ContextLinks => "linked research pages",
                };
                parts.push(format!("{count} {name}"));
            }
        }
        if parts.is_empty() && withheld == 0 {
            return None;
        }
        Some(format!(
            "Research published: {}; {withheld} item{} withheld. Admin's What will be public says which and why.",
            if parts.is_empty() {
                "nothing".to_string()
            } else {
                parts.join(", ")
            },
            if withheld == 1 { "" } else { "s" }
        ))
    }

    /// The ids one projection publishes, of one kind.
    pub fn published_ids(&self, projection: Projection, kind: ItemKind) -> BTreeSet<&str> {
        self.projections
            .iter()
            .filter(|report| report.projection == projection)
            .flat_map(|report| &report.published)
            .filter(|item| item.kind == kind)
            .map(|item| item.id.as_str())
            .collect()
    }
}

fn citations(inputs: &BoundaryInputs<'_>, posts: Vec<&Post>) -> ProjectionReport {
    let mut report = report(Projection::Citations, true);
    report.published = sources_of(
        posts.iter().flat_map(|post| {
            post.citations()
                .into_iter()
                .flat_map(|summary| summary.references.iter())
                .map(|reference| (reference, Some(post.slug.as_str())))
        }),
        inputs.library,
    );
    report
}

fn claim_evidence(
    inputs: &BoundaryInputs<'_>,
    posts: Vec<&Post>,
    published_posts: &BTreeSet<&str>,
    only: Option<&str>,
) -> ProjectionReport {
    let mut report = report(Projection::ClaimEvidence, inputs.switches.claim_evidence);
    if let Some(blocked) = inputs.claims_blocked.filter(|_| report.enabled) {
        report.blocked = Some(blocked.to_string());
        return report;
    }
    let mut claim_ids = BTreeSet::new();
    let mut link_ids = BTreeSet::new();
    let mut sources: Vec<(&PublicReference, Option<&str>)> = Vec::new();
    for post in &posts {
        let Some(evidence) = post.claim_evidence() else {
            continue;
        };
        for claim in &evidence.claims {
            claim_ids.insert(claim.id.clone());
            let mut fields = vec!["statement".to_string(), "standing".to_string()];
            present(&mut fields, "quote", claim.quote.is_some());
            present(&mut fields, "uncertainty", claim.uncertainty.is_some());
            let mut withheld_fields = Vec::new();
            let anchored = inputs
                .claims
                .and_then(|set| set.claim(&claim.id))
                .is_some_and(|stored| stored.anchor.is_some());
            if anchored && claim.quote.is_none() {
                withheld_fields.push(WithheldField {
                    field: "quote".into(),
                    reason: Reason::StaleAnchor,
                    message: format!(
                        "Claim `{}`: the words it was anchored to are no longer exactly where they were, so the claim is published without them.",
                        claim.id
                    ),
                });
            }
            report.published.push(PublishedItem {
                kind: ItemKind::Claim,
                id: claim.id.clone(),
                label: Some(format!("Claim {}", claim.number)),
                posts: vec![post.slug.clone()],
                url: Some(claim.url.clone()),
                fields,
                withheld_fields,
            });
            for (relation, links) in [
                ("supports", &claim.supports),
                ("contradicts", &claim.contradicts),
                ("contextualizes", &claim.contextualizes),
            ] {
                for link in links {
                    link_ids.insert(link.id.clone());
                    let mut fields = vec![
                        format!("relation ({relation})"),
                        "source".to_string(),
                        "confidence".to_string(),
                    ];
                    present(&mut fields, "locators", !link.locators.is_empty());
                    present(&mut fields, "rationale", link.rationale.is_some());
                    present(&mut fields, "uncertainty", link.uncertainty.is_some());
                    report.published.push(PublishedItem {
                        kind: ItemKind::EvidenceLink,
                        id: link.id.clone(),
                        label: Some(format!("On claim `{}`", claim.id)),
                        posts: vec![post.slug.clone()],
                        url: None,
                        fields,
                        withheld_fields: Vec::new(),
                    });
                }
            }
        }
        sources.extend(
            evidence
                .sources
                .iter()
                .map(|source| (&source.reference, Some(post.slug.as_str()))),
        );
    }
    report
        .published
        .extend(sources_of(sources.into_iter(), inputs.library));

    let Some(set) = inputs.claims else {
        return report;
    };
    let mine = |post: &str| only.is_none_or(|only| only == post);
    for claim in set.claims.iter().filter(|claim| mine(&claim.post)) {
        if claim_ids.contains(&claim.id) {
            continue;
        }
        let (reason, message) = if !report.enabled {
            (
                Reason::ProjectionOff,
                off_message(Projection::ClaimEvidence),
            )
        } else if claim.visibility != Visibility::Approved {
            (
                Reason::NotApproved,
                format!("Claim `{}` is not approved, so it stays private.", claim.id),
            )
        } else if !published_posts.contains(claim.post.as_str()) {
            (
                Reason::PostNotPublished,
                format!(
                    "Claim `{}` is about `{}`, which this build does not publish; it is published with that post.",
                    claim.id, claim.post
                ),
            )
        } else {
            (
                Reason::PrivateDependency,
                format!(
                    "Claim `{}` is not part of its post's published evidence.",
                    claim.id
                ),
            )
        };
        let mut item = withheld(ItemKind::Claim, &claim.id, reason, message);
        item.posts = vec![claim.post.clone()];
        report.withheld.push(item);
    }
    for link in &set.links {
        let Some(claim) = set.claim(&link.claim) else {
            continue;
        };
        if !mine(&claim.post) || link_ids.contains(&link.id) {
            continue;
        }
        let contradiction_private = set.links_of(&claim.id).any(|other| {
            other.relation == Relation::Contradicts && other.visibility != Visibility::Approved
        });
        let (reason, message) = if !report.enabled {
            (
                Reason::ProjectionOff,
                off_message(Projection::ClaimEvidence),
            )
        } else if link.visibility != Visibility::Approved {
            (
                Reason::NotApproved,
                format!(
                    "Evidence link `{}` is not approved, so it stays private.",
                    link.id
                ),
            )
        } else if link.evidence.passage.is_some() {
            (
                Reason::NotebookPassage,
                format!(
                    "Evidence link `{}` rests on a notebook passage, which is never published.",
                    link.id
                ),
            )
        } else if !claim_ids.contains(&claim.id) {
            (
                Reason::PrivateDependency,
                format!(
                    "Evidence link `{}` is on claim `{}`, which is not published.",
                    link.id, claim.id
                ),
            )
        } else if link.relation == Relation::Supports && contradiction_private {
            (
                Reason::ContradictionWithheld,
                format!(
                    "Evidence link `{}` supports claim `{}`, whose contradicting evidence is still private, so the support stays private too.",
                    link.id, claim.id
                ),
            )
        } else {
            (
                Reason::PrivateDependency,
                format!(
                    "Evidence link `{}` is not part of its post's published evidence.",
                    link.id
                ),
            )
        };
        let mut item = withheld(ItemKind::EvidenceLink, &link.id, reason, message);
        item.posts = vec![claim.post.clone()];
        report.withheld.push(item);
    }
    report
}

fn atlas(inputs: &BoundaryInputs<'_>) -> ProjectionReport {
    let mut report = report(Projection::Atlas, inputs.switches.atlas);
    if let Some(blocked) = inputs.atlas_blocked.filter(|_| report.enabled) {
        report.blocked = Some(blocked.to_string());
        return report;
    }
    let mut entries = BTreeSet::new();
    let mut relationships = BTreeSet::new();
    if let Some(public) = inputs.public_atlas.filter(|_| report.enabled) {
        for entry in &public.entries {
            entries.insert(entry.id.as_str());
            let mut fields = vec!["kind".to_string(), "label".to_string()];
            present(&mut fields, "aliases", !entry.aliases.is_empty());
            present(&mut fields, "summary", entry.summary.is_some());
            present(&mut fields, "source", entry.source.is_some());
            report.published.push(PublishedItem {
                kind: ItemKind::Entry,
                id: entry.id.clone(),
                label: Some(entry.label.clone()),
                posts: Vec::new(),
                url: Some(entry.url.clone()),
                fields,
                withheld_fields: Vec::new(),
            });
        }
        for relationship in &public.relationships {
            relationships.insert(relationship.id.as_str());
            let mut fields: Vec<String> =
                ["kind", "from", "to", "assertedBy", "confidence", "evidence"]
                    .iter()
                    .map(|field| field.to_string())
                    .collect();
            present(
                &mut fields,
                "uncertainty",
                relationship.uncertainty.is_some(),
            );
            present(
                &mut fields,
                "contestedBy",
                !relationship.contested_by.is_empty(),
            );
            report.published.push(PublishedItem {
                kind: ItemKind::Relationship,
                id: relationship.id.clone(),
                label: Some(format!(
                    "{} {} {}",
                    relationship.from, relationship.label, relationship.to
                )),
                posts: Vec::new(),
                url: None,
                fields,
                withheld_fields: Vec::new(),
            });
        }
        report.published.extend(sources_of(
            public
                .sources
                .iter()
                .map(|source| (&source.reference, None)),
            inputs.library,
        ));
    }
    let Some(atlas) = inputs.atlas else {
        return report;
    };
    let approved = |id: &str| {
        atlas
            .entry(id)
            .is_some_and(|entry| entry.visibility == Visibility::Approved)
    };
    for entry in &atlas.entries {
        if entries.contains(entry.id.as_str()) {
            continue;
        }
        let (reason, message) = if !report.enabled {
            (Reason::ProjectionOff, off_message(Projection::Atlas))
        } else if entry.visibility != Visibility::Approved {
            (
                Reason::NotApproved,
                format!("Entry `{}` is not approved, so it stays private.", entry.id),
            )
        } else {
            (
                Reason::PrivateDependency,
                format!(
                    "Entry `{}` is not in the atlas the build publishes.",
                    entry.id
                ),
            )
        };
        let mut item = withheld(ItemKind::Entry, &entry.id, reason, message);
        item.label = Some(entry.label.clone());
        report.withheld.push(item);
    }
    for relationship in &atlas.relationships {
        if relationships.contains(relationship.id.as_str()) {
            continue;
        }
        let passage = relationship
            .evidence
            .iter()
            .chain(
                relationship
                    .contested_by
                    .iter()
                    .flat_map(|d| d.evidence.iter()),
            )
            .any(|evidence| evidence.passage.is_some());
        let private_end = [&relationship.from, &relationship.to]
            .into_iter()
            .find(|id| !approved(id));
        let id = &relationship.id;
        let (reason, message) = if !report.enabled {
            (Reason::ProjectionOff, off_message(Projection::Atlas))
        } else if relationship.visibility != Visibility::Approved {
            (
                Reason::NotApproved,
                format!("Relationship `{id}` is not approved, so it stays private."),
            )
        } else if relationship.unsourced {
            (
                Reason::Unsourced,
                format!("Relationship `{id}` is an unsourced draft, which is never published."),
            )
        } else if passage {
            (
                Reason::NotebookPassage,
                format!(
                    "Relationship `{id}` rests on a notebook passage, which is never published."
                ),
            )
        } else if let Some(end) = private_end {
            (
                Reason::PrivateDependency,
                format!("Relationship `{id}` joins entry `{end}`, which is not published, so it stays private until that entry is approved."),
            )
        } else {
            (
                Reason::PrivateDependency,
                format!("Relationship `{id}` is not in the atlas the build publishes."),
            )
        };
        report
            .withheld
            .push(withheld(ItemKind::Relationship, id, reason, message));
    }
    report
}

fn datings(inputs: &BoundaryInputs<'_>) -> ProjectionReport {
    let mut report = report(Projection::Datings, inputs.switches.atlas);
    if let Some(blocked) = inputs.atlas_blocked.filter(|_| report.enabled) {
        report.blocked = Some(blocked.to_string());
        return report;
    }
    let mut published = BTreeSet::new();
    if let Some(public) = inputs.public_atlas.filter(|_| report.enabled) {
        for dating in &public.datings {
            published.insert(dating.id.as_str());
            let mut fields: Vec<String> =
                ["aspect", "date", "assertedBy", "confidence", "evidence"]
                    .iter()
                    .map(|field| field.to_string())
                    .collect();
            present(&mut fields, "note", dating.note.is_some());
            report.published.push(PublishedItem {
                kind: ItemKind::Dating,
                id: dating.id.clone(),
                label: Some(format!(
                    "{} of {}: {}",
                    aspect_noun(dating.aspect),
                    dating.owner,
                    dating.text
                )),
                posts: Vec::new(),
                url: Some(public.owner_url(&dating.owner, dating.owner_type)),
                fields,
                withheld_fields: Vec::new(),
            });
        }
    }
    let Some(atlas) = inputs.atlas else {
        return report;
    };
    let approved = |id: &str| {
        atlas
            .entry(id)
            .is_some_and(|entry| entry.visibility == Visibility::Approved)
    };
    for (owner, dating) in atlas.all_datings() {
        if published.contains(dating.id.as_str()) {
            continue;
        }
        let id = &dating.id;
        let owner_published = approved(owner)
            || atlas
                .relationship(owner)
                .is_some_and(|relationship| atlas.is_projected(relationship));
        let (reason, message) = if !report.enabled {
            (Reason::ProjectionOff, off_message(Projection::Datings))
        } else if dating.visibility != Visibility::Approved {
            (
                Reason::NotApproved,
                format!("Dating `{id}` of `{owner}` is not approved, so it stays private."),
            )
        } else if dating.unsourced {
            (
                Reason::Unsourced,
                format!(
                    "Dating `{id}` of `{owner}` is an unsourced draft, which is never published."
                ),
            )
        } else if dating
            .evidence
            .iter()
            .any(|evidence| evidence.passage.is_some())
        {
            (
                Reason::NotebookPassage,
                format!("Dating `{id}` of `{owner}` rests on a notebook passage, which is never published."),
            )
        } else if !owner_published {
            (
                Reason::PrivateDependency,
                format!("Dating `{id}` dates `{owner}`, which is not published."),
            )
        } else if let Some(target) = dating.relative_target().filter(|t| !approved(&t.entry)) {
            (
                Reason::PrivateDependency,
                format!(
                    "Dating `{id}` is relative to entry `{}`, which is not published.",
                    target.entry
                ),
            )
        } else {
            (
                Reason::PrivateDependency,
                format!("Dating `{id}` is not in the atlas the build publishes."),
            )
        };
        report
            .withheld
            .push(withheld(ItemKind::Dating, id, reason, message));
    }
    report
}

fn comparisons(inputs: &BoundaryInputs<'_>) -> ProjectionReport {
    let mut report = report(Projection::Comparisons, inputs.switches.comparisons);
    if let Some(blocked) = inputs.comparisons_blocked.filter(|_| report.enabled) {
        report.blocked = Some(blocked.to_string());
        return report;
    }
    let mut published = BTreeSet::new();
    if let Some(public) = inputs.public_comparisons.filter(|_| report.enabled) {
        for comparison in &public.comparisons {
            published.insert(comparison.id.as_str());
            let mut fields: Vec<String> = [
                "correspondence",
                "recordedBy",
                "confidence",
                "versions",
                "places (locators)",
            ]
            .iter()
            .map(|field| field.to_string())
            .collect();
            present(&mut fields, "label", comparison.label.is_some());
            present(&mut fields, "evidence", !comparison.evidence.is_empty());
            present(&mut fields, "rationale", comparison.rationale.is_some());
            present(&mut fields, "uncertainty", comparison.uncertainty.is_some());
            let mut withheld_fields = Vec::new();
            let mut shown = 0;
            for place in comparison.places_in_member_order() {
                if place.text.is_some() {
                    shown += 1;
                }
                if let Some(why) = place.withheld {
                    let (reason, because) = match why {
                        Withheld::Rights => (
                            Reason::Rights,
                            "the version's rights statement does not let the site show it",
                        ),
                        Withheld::Length => (Reason::Length, "it is longer than a brief excerpt"),
                    };
                    withheld_fields.push(WithheldField {
                        field: format!("members[{}].text", place.member),
                        reason,
                        message: format!(
                            "Comparison `{}`: the wording of members[{}] is identified and located but not shown, because {because}.",
                            comparison.id, place.member
                        ),
                    });
                }
            }
            if shown > 0 {
                fields.push(format!(
                    "wording of {shown} place{}",
                    if shown == 1 { "" } else { "s" }
                ));
            }
            report.published.push(PublishedItem {
                kind: ItemKind::Comparison,
                id: comparison.id.clone(),
                label: comparison.label.clone(),
                posts: Vec::new(),
                url: Some(comparison.url.clone()),
                fields,
                withheld_fields,
            });
        }
        report.published.extend(sources_of(
            public
                .sources
                .iter()
                .map(|source| (&source.reference, None)),
            inputs.library,
        ));
    }
    let Some(set) = inputs.alignments else {
        return report;
    };
    for alignment in &set.alignments {
        if published.contains(alignment.id.as_str()) {
            continue;
        }
        let id = &alignment.id;
        let stale = inputs.stale_comparisons.and_then(|stale| stale.get(id));
        let (reason, message) = if !report.enabled {
            (Reason::ProjectionOff, off_message(Projection::Comparisons))
        } else if !alignment.is_approved() {
            (
                Reason::NotApproved,
                format!("Comparison `{id}` is not approved, so it stays private."),
            )
        } else if let Some(stale) = stale {
            (
                Reason::StaleApproval,
                format!("Comparison `{id}` is approved but withheld from /comparisons/ because its approval is stale ({stale}). Check the place and update the member or its passage to publish it again."),
            )
        } else {
            (
                Reason::PrivateDependency,
                format!("Comparison `{id}` is not in the comparisons the build publishes."),
            )
        };
        let mut item = withheld(ItemKind::Comparison, id, reason, message);
        item.label = alignment.label.clone();
        report.withheld.push(item);
    }
    report
}

fn context_links(inputs: &BoundaryInputs<'_>, post: &Post) -> ProjectionReport {
    let mut report = report(
        Projection::ContextLinks,
        inputs.switches.atlas || inputs.switches.comparisons,
    );
    let links = find_context_links(post.authored_markdown(), 1);
    let mut seen = BTreeSet::new();
    for link in links {
        if !seen.insert((link.kind, link.id.clone())) {
            continue;
        }
        let (kind, page) = match link.kind {
            ContextKind::AtlasEntry => (
                ItemKind::AtlasPage,
                inputs
                    .public_atlas
                    .filter(|_| inputs.switches.atlas)
                    .and_then(|atlas| atlas.entry(&link.id))
                    .map(|entry| (entry.label.clone(), entry.url.clone())),
            ),
            ContextKind::Comparison => (
                ItemKind::ComparisonPage,
                inputs
                    .public_comparisons
                    .filter(|_| inputs.switches.comparisons)
                    .and_then(|set| set.comparisons.iter().find(|c| c.id == link.id))
                    .map(|c| {
                        (
                            c.label.clone().unwrap_or_else(|| c.id.clone()),
                            c.url.clone(),
                        )
                    }),
            ),
        };
        match page {
            Some((label, url)) => report.published.push(PublishedItem {
                kind,
                id: link.id.clone(),
                label: Some(label),
                posts: vec![post.slug.clone()],
                url: Some(url),
                fields: vec!["link".into()],
                withheld_fields: Vec::new(),
            }),
            None => {
                let what = match link.kind {
                    ContextKind::AtlasEntry => "atlas entry",
                    ContextKind::Comparison => "comparison",
                };
                let mut item = withheld(
                    kind,
                    &link.id,
                    Reason::PageNotPublished,
                    format!(
                        "The link to {} leads to the {what} `{}`, whose page the next build does not publish; the link is published as written and leads nowhere.",
                        link.href, link.id
                    ),
                );
                item.posts = vec![post.slug.clone()];
                report.withheld.push(item);
            }
        }
    }
    report
}

fn never(inputs: &BoundaryInputs<'_>) -> Vec<NeverPublished> {
    let mut never = Vec::new();
    let mut push = |store: Store, count: usize, what: String| {
        never.push(NeverPublished {
            store,
            file: store.file(),
            count,
            what,
        });
    };
    if let Some(library) = inputs.library {
        push(
            Store::SourceLibrary,
            library.sources.len() + library.interpretations.len(),
            "Notes, rights notes, archived flags, version relationships, identifiers in private schemes, unknown fields and every interpretation's own notes. A source's public description is published only where a published post cites it or a published projection uses it, and an interpretation's wording only where an approved comparison shows it.".into(),
        );
    }
    if let Some(notebook) = inputs.notebook {
        push(
            Store::Notebook,
            notebook.notes.len(),
            "Every note and question.".into(),
        );
        push(
            Store::Notebook,
            notebook.passages.len(),
            "Every passage, its notes and its locators, except the wording of a place an approved comparison shows under its version's rights.".into(),
        );
    }
    if let Some(atlas) = inputs.atlas {
        push(
            Store::Atlas,
            atlas.entries.len() + atlas.relationships.len(),
            "Visibility, unsourced flags, notebook passages and unknown fields of every entry, relationship and dating.".into(),
        );
    }
    if let Some(claims) = inputs.claims {
        push(
            Store::Claims,
            claims.claims.len() + claims.links.len(),
            "Visibility, review state, origin, who recorded it, anchor offsets, notebook passages and unknown fields of every claim and evidence link.".into(),
        );
    }
    if let Some(alignments) = inputs.alignments {
        push(
            Store::Alignments,
            alignments.alignments.len(),
            "Visibility, place notes, notebook passage ids, normalizations not chosen for publication and unknown fields of every alignment.".into(),
        );
    }
    if let Some(count) = inputs.acknowledgements {
        push(
            Store::Acknowledgements,
            count,
            "Every acknowledgement of a review finding.".into(),
        );
    }
    never
}

// ---------------------------------------------------------------- the private text guard

/// Where a piece of private text came from: the file, the record's id when
/// it has one, and the field, as a JSON path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PrivateOrigin {
    pub store: Store,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub field: String,
}

/// Private text found in an output, by output path and origin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Leak {
    pub output: String,
    pub origin: PrivateOrigin,
}

impl std::fmt::Display for Leak {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "`{}` carries text from {} (`{}`",
            self.output,
            self.origin.store.name(),
            self.origin.store.file()
        )?;
        if let Some(id) = &self.origin.id {
            write!(formatter, ", `{id}`")?;
        }
        write!(formatter, ", field `{}`)", self.origin.field)
    }
}

/// The text of every private research file, as word shingles the build can
/// look for in its output (see [`crate::shingles`]). A shingle that a public
/// input or an approved projection also holds is allowed and dropped, so only
/// text that could have come from nowhere but private research is guarded.
/// Text of fewer than [`SHINGLE_WORDS`] words is not guarded by text.
#[derive(Debug, Default)]
pub struct PrivateText {
    origins: Vec<PrivateOrigin>,
    /// Shingle hash to the origin it first occurs in.
    shingles: HashMap<u64, u32>,
}

impl PrivateText {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add every string value of a private file. A file that is not JSON is
    /// added whole, so a damaged file is still guarded.
    pub fn add_file(&mut self, store: Store, bytes: &[u8]) {
        match serde_json::from_slice::<Value>(bytes) {
            Ok(value) => self.add_value(store, &value, None, String::new()),
            Err(_) => self.add_text(
                PrivateOrigin {
                    store,
                    id: None,
                    field: "(the whole file)".into(),
                },
                &String::from_utf8_lossy(bytes),
            ),
        }
    }

    fn add_value(&mut self, store: Store, value: &Value, id: Option<&str>, path: String) {
        match value {
            Value::String(text) => self.add_text(
                PrivateOrigin {
                    store,
                    id: id.map(str::to_string),
                    field: if path.is_empty() {
                        "(root)".into()
                    } else {
                        path
                    },
                },
                text,
            ),
            Value::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    self.add_value(store, item, id, format!("{path}[{index}]"));
                }
            }
            Value::Object(map) => {
                let own = map.get("id").and_then(Value::as_str);
                let (id, base) = match own {
                    Some(own) => (Some(own), String::new()),
                    None => (id, path),
                };
                for (key, item) in map {
                    let field = if base.is_empty() {
                        key.clone()
                    } else {
                        format!("{base}.{key}")
                    };
                    self.add_value(store, item, id, field);
                }
            }
            _ => {}
        }
    }

    fn add_text(&mut self, origin: PrivateOrigin, text: &str) {
        let index = self.origins.len() as u32;
        let before = self.shingles.len();
        each_shingle(text, Form::Plain, |hash| {
            self.shingles.entry(hash).or_insert(index);
        });
        if self.shingles.len() > before {
            self.origins.push(origin);
        }
    }

    /// Allow every shingle of `text` as written: a public input field such
    /// as a post's text or title.
    pub fn allow_text(&mut self, text: &str) {
        self.allow(text, Form::Plain);
    }

    /// Allow every shingle of a public file or an approved projection's
    /// output (HTML, JSON, Markdown, plain text).
    pub fn allow_output(&mut self, text: &str) {
        self.allow(text, Form::Output);
    }

    fn allow(&mut self, text: &str, form: Form) {
        if self.shingles.is_empty() {
            return;
        }
        each_shingle(text, form, |hash| {
            self.shingles.remove(&hash);
        });
    }

    /// Whether nothing is guarded.
    pub fn is_empty(&self) -> bool {
        self.shingles.is_empty()
    }

    /// How many shingles are still guarded.
    pub fn guarded(&self) -> usize {
        self.shingles.len()
    }

    /// The first private text `output` carries, if any.
    pub fn find(&self, path: &str, output: &[u8]) -> Option<Leak> {
        if self.shingles.is_empty() {
            return None;
        }
        let mut leak = None;
        each_shingle(&String::from_utf8_lossy(output), Form::Output, |hash| {
            if leak.is_none() {
                if let Some(&origin) = self.shingles.get(&hash) {
                    leak = Some(Leak {
                        output: path.to_string(),
                        origin: self.origins[origin as usize].clone(),
                    });
                }
            }
        });
        leak
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHORT_NOTES: [&str; 2] = [
        "Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.",
        "I'm not sure Plato's cave is meant literally - ask Dana before publishing.",
    ];

    fn guarded(texts: &[&str]) -> PrivateText {
        let mut guard = PrivateText::new();
        for (index, text) in texts.iter().enumerate() {
            guard.add_file(
                Store::Notebook,
                serde_json::json!({"notes": [{"id": format!("n{index}"), "text": text}]})
                    .to_string()
                    .as_bytes(),
            );
        }
        guard
    }

    #[test]
    fn the_guard_finds_private_text_through_wrapping_markup_escaping_and_case() {
        let mut guard = PrivateText::new();
        guard.add_file(
            Store::Notebook,
            br#"{"version":1,"notes":[{"id":"n1","kind":"observation","text":"Private musing about the shadows on the wall of the cave"}],"passages":[{"id":"p1","source":"s","excerpt":{"text":"The wording an approved comparison shows to every reader"}}]}"#,
        );
        guard.allow_output(
            "{\"text\":\"The wording an approved comparison shows to every reader\"}",
        );
        assert!(guard
            .find(
                "comparisons.json",
                b"<p>The wording an approved comparison shows to every reader</p>"
            )
            .is_none());
        for output in [
            "<p>&quot;PRIVATE MUSING about the shadows on the wall&quot;</p>",
            "<p>Private musing about
the <em>shadows</em> on the
wall of the cave</p>",
            "<p>Private musing about the <a href=\"/x\">shadows</a> on the wall</p>",
        ] {
            let leak = guard.find("index.html", output.as_bytes()).expect(output);
            assert_eq!(leak.output, "index.html");
            assert_eq!(leak.origin.store, Store::Notebook);
            assert_eq!(leak.origin.id.as_deref(), Some("n1"));
            assert_eq!(leak.origin.field, "text");
            let said = leak.to_string();
            assert!(!said.contains("musing"), "{said}");
        }
        assert!(guard
            .find("other.html", b"<p>A wall, a cave, and shadows.</p>")
            .is_none());
    }

    #[test]
    fn short_and_punctuated_private_notes_are_guarded() {
        let guard = guarded(&SHORT_NOTES);
        for (output, id) in [
            (
                "<p>Check again: <strong>Smith</strong> (2003) disagrees, see p. 41; the 1987 letter is key.</p>",
                "n0",
            ),
            (
                "<meta name=\"description\" content=\"I&#39;m not sure Plato&#39;s cave is meant literally - ask Dana before publishing.\">",
                "n1",
            ),
            (
                r#"{"body":"i\u0027m not sure plato\u2019s cave is meant\nliterally ask dana"}"#,
                "n1",
            ),
        ] {
            let leak = guard.find("page.html", output.as_bytes()).expect(output);
            assert_eq!(leak.origin.id.as_deref(), Some(id), "{output}");
        }
    }

    #[test]
    fn allowed_text_is_dropped_shingle_by_shingle() {
        let mut guard = guarded(&SHORT_NOTES);
        guard.allow_text("A post quotes it: Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.");
        assert!(guard
            .find("p.html", b"Check again: Smith (2003) disagrees, see p. 41")
            .is_none());
        assert!(guard
            .find("p.html", b"not sure Plato's cave is meant literally")
            .is_some());
    }

    #[test]
    fn text_shorter_than_a_shingle_and_ids_are_not_guarded_by_text() {
        let mut guard = PrivateText::new();
        guard.add_file(
            Store::Atlas,
            br#"{"version":2,"entries":[{"id":"plato","label":"Plato","note":"ask Dana before publishing"}]}"#,
        );
        assert!(guard.is_empty());
        let mut damaged = PrivateText::new();
        damaged.add_file(
            Store::Claims,
            b"{ not json, but a long private sentence about evidence",
        );
        let leak = damaged
            .find("x.html", b"a long private sentence about evidence")
            .unwrap();
        assert_eq!(leak.origin.field, "(the whole file)");
    }

    #[test]
    fn unsafe_web_addresses_are_named() {
        for (url, safe) in [
            ("https://example.org/a?page=2", true),
            ("http://archive.org/details/x", true),
            ("http://localhost:8080/notes", false),
            ("http://intranet/notes", false),
            ("https://files.corp.internal/x.pdf", false),
            ("http://192.168.1.4/x", false),
            ("http://10.0.0.1/x", false),
            ("http://[::1]/x", false),
            ("https://bucket.example.com/x?X-Amz-Signature=abc", false),
            ("https://example.com/x?token=abc", false),
            ("ftp://example.com/x", false),
            ("https://user:pw@example.com/", false),
        ] {
            assert_eq!(public_url_problem(url).is_none(), safe, "{url}");
        }
    }
}

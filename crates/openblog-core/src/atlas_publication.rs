//! The public Knowledge Atlas: the one projection of approved atlas items that
//! every public representation reads (ADR 0058).
//!
//! [`PublicAtlas`] is built from an explicit allowlist. It copies only entries
//! the author approved and only relationships [`Atlas::is_projected`] lets
//! through (approved, sourced, no notebook passage, both entries approved),
//! and from them only the fields named here. Unknown fields, visibility, the
//! unsourced flag, notebook passage pointers, private notes and every
//! unapproved item have no place in these types, so they cannot reach a page
//! or the JSON artifact. Static pages and `atlas.json` are both rendered from
//! this value; nothing public reads the private atlas directly.
//!
//! Nothing here claims a relationship is true or agreed. Each one keeps who
//! asserts it, on what evidence, with what confidence and doubt, and its
//! derived standing: `asserted`, or `contested` with every dissenting party.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::bibliography::CitationLocale;
use crate::citations::{format_reference, public_reference, PublicLocator, PublicReference};
use crate::knowledge_atlas::{
    Atlas, Attribution, AttributionKind, Confidence, Dissent, Entry, EntryKind, Evidence,
    Relationship, RelationshipKind, Standing,
};
use crate::source_library::SourceLibrary;

/// Names the public artifact. Deliberately not the private atlas's shape: it
/// has no `version` key, so it is never mistaken for private research.
pub const PUBLIC_ATLAS_FORMAT: &str = "openblog-atlas-projection";
/// The only public atlas format version this release writes.
pub const PUBLIC_ATLAS_FORMAT_VERSION: u64 = 1;
/// Where the atlas pages live on the site.
pub const ATLAS_URL: &str = "/atlas/";
/// The JSON artifact, relative to the site root.
pub const ATLAS_JSON_FILE: &str = "atlas.json";

/// The published atlas: approved entries, projected relationships, and the
/// public description of every source they cite or attribute to.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicAtlas {
    pub format: &'static str,
    pub format_version: u64,
    /// Sorted by id.
    pub entries: Vec<PublicEntry>,
    /// Sorted by id.
    pub relationships: Vec<PublicRelationship>,
    /// Sorted by id; each one is cited, attributed or stood for by an item above.
    pub sources: Vec<PublicSource>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PublicEntry {
    pub id: String,
    pub kind: EntryKind,
    pub label: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Only on a work: the source-library work it stands for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<PublicBounds>,
    /// The entry's canonical page, root-relative.
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PublicBounds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRelationship {
    pub id: String,
    /// The stored direction: `from` `kind` `to`. The reverse reading is only
    /// `inverseLabel`, never a second assertion.
    pub kind: RelationshipKind,
    pub from: String,
    pub to: String,
    /// How the relationship reads in words ("member of"); `kind` stays the
    /// machine value ("member-of").
    pub label: &'static str,
    pub inverse_label: &'static str,
    pub asserted_by: PublicParty,
    pub confidence: Confidence,
    /// Never empty: an unsourced draft is never projected.
    pub evidence: Vec<PublicEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncertainty: Option<String>,
    /// Derived, never stored: `asserted`, or `contested` when anyone dissents.
    pub standing: Standing,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub contested_by: Vec<PublicDissent>,
}

/// Who holds a position: the site author, a source, or a named party.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PublicParty {
    pub kind: AttributionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A cited source and where in it. Never a notebook passage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PublicEvidence {
    pub source: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub locators: Vec<PublicLocator>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PublicDissent {
    pub by: PublicParty,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<PublicEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A source's public description (the citation allowlist of ADR 0044) and its
/// deterministic plain-text rendering.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PublicSource {
    #[serde(flatten)]
    pub reference: PublicReference,
    pub text: String,
}

/// The canonical page of an entry. Entry ids are lowercase slugs, so they are
/// safe path segments as they are.
pub fn entry_url(id: &str) -> String {
    format!("{ATLAS_URL}{id}/")
}

impl PublicAtlas {
    /// Project the approved part of a validated atlas. The library supplies
    /// the public description of the sources the projected items use; the
    /// notebook is not an input. Fails, naming ids only, if a projected item
    /// uses a source the library does not hold.
    pub fn project(atlas: &Atlas, library: &SourceLibrary) -> Result<Self, String> {
        let (entries, relationships) = atlas.projected();
        let mut entries: Vec<PublicEntry> = entries.into_iter().map(public_entry).collect();
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        let mut relationships: Vec<PublicRelationship> =
            relationships.into_iter().map(public_relationship).collect();
        relationships.sort_by(|a, b| a.id.cmp(&b.id));

        // Re-check what the projection rests on rather than trusting it: a
        // relationship may only join entries this projection publishes.
        let published: BTreeSet<&str> = entries.iter().map(|e| e.id.as_str()).collect();
        if let Some(r) = relationships
            .iter()
            .find(|r| !published.contains(r.from.as_str()) || !published.contains(r.to.as_str()))
        {
            return Err(format!(
                "the Knowledge Atlas relationship `{}` joins an entry that is not published",
                r.id
            ));
        }

        let mut used: BTreeMap<String, String> = BTreeMap::new();
        for entry in &entries {
            if let Some(source) = &entry.source {
                used.entry(source.clone())
                    .or_insert_with(|| entry.id.clone());
            }
        }
        for r in &relationships {
            for source in relationship_sources(r) {
                used.entry(source.to_string())
                    .or_insert_with(|| r.id.clone());
            }
        }
        let mut sources = Vec::with_capacity(used.len());
        for (id, user) in used {
            let Some(record) = library.get(&id) else {
                return Err(format!(
                    "the Knowledge Atlas item `{user}` uses the source `{id}`, which is not in the source library"
                ));
            };
            let reference = public_reference(record);
            let text = format_reference(&reference);
            sources.push(PublicSource { reference, text });
        }

        Ok(Self {
            format: PUBLIC_ATLAS_FORMAT,
            format_version: PUBLIC_ATLAS_FORMAT_VERSION,
            entries,
            relationships,
            sources,
        })
    }

    pub fn entry(&self, id: &str) -> Option<&PublicEntry> {
        self.entries
            .binary_search_by(|entry| entry.id.as_str().cmp(id))
            .ok()
            .map(|index| &self.entries[index])
    }

    pub fn source(&self, id: &str) -> Option<&PublicSource> {
        self.sources
            .binary_search_by(|source| source.reference.key.as_str().cmp(id))
            .ok()
            .map(|index| &self.sources[index])
    }

    /// Relationships starting at an entry, then those ending at it, each in id
    /// order. A relationship from an entry to itself is refused upstream.
    pub fn relationships_of(
        &self,
        id: &str,
    ) -> (Vec<&PublicRelationship>, Vec<&PublicRelationship>) {
        (
            self.relationships.iter().filter(|r| r.from == id).collect(),
            self.relationships.iter().filter(|r| r.to == id).collect(),
        )
    }

    /// The artifact as compact, deterministic JSON with root-relative URLs.
    /// `<`, `>` and `&` are written as escapes, so authored text can never
    /// close a `<script>` element the data is later embedded in.
    pub fn to_json(&self) -> String {
        let json = serde_json::to_string(self).expect("the public atlas is serializable");
        let mut out = String::with_capacity(json.len());
        for c in json.chars() {
            match c {
                '<' | '>' | '&' => out.push_str(&format!("\\u{:04x}", u32::from(c))),
                _ => out.push(c),
            }
        }
        out
    }

    /// How a party reads on a page: the site author's name, a source's title,
    /// or the named party.
    pub fn party_text(&self, party: &PublicParty, author: &str) -> String {
        match party.kind {
            AttributionKind::Author => {
                let author = author.trim();
                if author.is_empty() {
                    "The site author".to_string()
                } else {
                    format!("{author} (the site author)")
                }
            }
            AttributionKind::Source => {
                let id = party.source.as_deref().unwrap_or_default();
                self.source(id)
                    .map(|source| source.text.clone())
                    .unwrap_or_else(|| id.to_string())
            }
            AttributionKind::Named => party.name.clone().unwrap_or_default(),
        }
    }

    /// One piece of evidence as readers see it: the reference, then where.
    pub fn evidence_text(&self, evidence: &PublicEvidence) -> String {
        let reference = self
            .source(&evidence.source)
            .map(|source| source.text.clone())
            .unwrap_or_else(|| evidence.source.clone());
        if evidence.locators.is_empty() {
            reference
        } else {
            format!(
                "{reference}, {}",
                CitationLocale::En.locators_text(&evidence.locators)
            )
        }
    }
}

/// The heading for a kind's group on the atlas index.
pub fn kind_heading(kind: EntryKind) -> &'static str {
    match kind {
        EntryKind::Person => "People",
        EntryKind::Work => "Works",
        EntryKind::Concept => "Concepts",
        EntryKind::Movement => "Movements",
        EntryKind::Event => "Events",
    }
}

/// The kind as a word in running text.
pub fn kind_label(kind: EntryKind) -> &'static str {
    match kind {
        EntryKind::Person => "Person",
        EntryKind::Work => "Work",
        EntryKind::Concept => "Concept",
        EntryKind::Movement => "Movement",
        EntryKind::Event => "Event",
    }
}

/// A coarse year range as text: negative years are BCE.
pub fn bounds_text(bounds: &PublicBounds) -> Option<String> {
    let year = |value: i32| {
        if value < 0 {
            format!("{} BCE", value.unsigned_abs())
        } else {
            value.to_string()
        }
    };
    match (bounds.from, bounds.until) {
        (Some(from), Some(until)) => Some(format!("{} to {}", year(from), year(until))),
        (Some(from), None) => Some(format!("From {}", year(from))),
        (None, Some(until)) => Some(format!("Until {}", year(until))),
        (None, None) => None,
    }
}

/// Confidence as a reader-facing word. It is how firmly the asserting party
/// holds the claim, never how widely it is accepted.
pub fn confidence_text(confidence: Confidence) -> &'static str {
    match confidence {
        Confidence::Tentative => "Tentative",
        Confidence::Plausible => "Plausible",
        Confidence::Strong => "Strong",
    }
}

fn public_entry(entry: &Entry) -> PublicEntry {
    PublicEntry {
        id: entry.id.clone(),
        kind: entry.kind,
        label: entry.label.clone(),
        aliases: entry.aliases.clone(),
        summary: entry.summary.clone(),
        source: entry.source.clone(),
        bounds: entry
            .bounds
            .as_ref()
            .map(|bounds| PublicBounds {
                from: bounds.from,
                until: bounds.until,
            })
            .filter(|bounds| bounds.from.is_some() || bounds.until.is_some()),
        url: entry_url(&entry.id),
    }
}

fn public_relationship(r: &Relationship) -> PublicRelationship {
    PublicRelationship {
        id: r.id.clone(),
        kind: r.kind,
        from: r.from.clone(),
        to: r.to.clone(),
        label: r.kind.label(),
        inverse_label: r.kind.inverse_label(),
        asserted_by: public_party(&r.asserted_by),
        confidence: r.confidence,
        evidence: public_evidence(&r.evidence),
        uncertainty: r.uncertainty.clone(),
        standing: r.standing(),
        contested_by: r.contested_by.iter().map(public_dissent).collect(),
    }
}

pub(crate) fn public_party(party: &Attribution) -> PublicParty {
    PublicParty {
        kind: party.kind,
        source: party.source.clone(),
        name: party.name.clone(),
    }
}

pub(crate) fn public_evidence(evidence: &[Evidence]) -> Vec<PublicEvidence> {
    evidence
        .iter()
        .map(|item| PublicEvidence {
            source: item.source.clone(),
            locators: item.locators.iter().map(PublicLocator::from).collect(),
        })
        .collect()
}

fn public_dissent(dissent: &Dissent) -> PublicDissent {
    PublicDissent {
        by: public_party(&dissent.by),
        evidence: public_evidence(&dissent.evidence),
        note: dissent.note.clone(),
    }
}

fn relationship_sources(r: &PublicRelationship) -> impl Iterator<Item = &str> {
    let parties = std::iter::once(&r.asserted_by)
        .chain(r.contested_by.iter().map(|d| &d.by))
        .filter_map(|party| party.source.as_deref());
    r.evidence
        .iter()
        .chain(r.contested_by.iter().flat_map(|d| d.evidence.iter()))
        .map(|e| e.source.as_str())
        .chain(parties)
}

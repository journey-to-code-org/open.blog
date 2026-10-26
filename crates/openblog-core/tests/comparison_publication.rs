//! The comparison projection (ADR 0128): approved alignments only, every
//! version identified, wording only under a rights statement that permits
//! display and within the excerpt limit, exactly as stored, interpretations
//! attributed and kept apart, and nothing private on the way.

use std::collections::BTreeMap;

use openblog_core::alignment::AlignmentSet;
use openblog_core::comparison_publication::{
    displays_wording, ComparisonInputs, PublicComparison, PublicComparisons, VersionKind, Withheld,
    MAX_PUBLIC_EXCERPT_CHARS, PUBLIC_COMPARISONS_FORMAT,
};
use openblog_core::contributor::Contributor;
use openblog_core::knowledge_atlas::Links;
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::{RightsStatus, SourceLibrary};
use serde_json::{json, Value};

const SECRET: &str = "ob-comparison-secret";
/// Greek with combining marks written decomposed, so any normalization on the
/// way through would show.
const GREEK_NFD: &str =
    "\u{3bc}\u{3b5}\u{3c4}\u{3b1}\u{300} \u{3c4}\u{3b1}\u{3c5}\u{3c4}\u{3b1}\u{301}";
const HEBREW: &str = "אַחַר כָּךְ, הַמְשֵׁל";
const HOSTILE: &str = "<script>alert(1)</script> & </blockquote>";

fn contributors() -> BTreeMap<String, Contributor> {
    let mut registry = BTreeMap::new();
    registry.insert(
        "ada".to_string(),
        Contributor {
            name: "Ada Lovelace".into(),
            ..Contributor::default()
        },
    );
    registry
}

fn library() -> SourceLibrary {
    SourceLibrary::parse(
        &json!({"version": 1, "sources": [
            {"id": "republic", "kind": "work", "title": "Πολιτεία"},
            {"id": "burnet", "kind": "edition", "of": "republic", "title": "Platonis Opera",
             "language": "grc", "creators": [{"name": "John Burnet", "role": "editor"}],
             "rights": {"status": "publicDomain", "note": format!("{SECRET} rights note")}},
            {"id": "grube", "kind": "translation", "of": "republic", "language": "en", "title": "Republic",
             "creators": [{"name": "G. M. A. Grube", "role": "translator"}],
             "rights": {"status": "rightsReserved"}},
            {"id": "hebrew", "kind": "translation", "of": "republic", "language": "he", "title": "המדינה",
             "rights": {"status": "openLicense", "license": "CC-BY-4.0"}},
            {"id": "paris", "kind": "witness", "of": "republic", "title": "Paris gr. 1807"},
            {"id": "long", "kind": "edition", "of": "republic", "title": "Long", "rights": {"status": "ownWork"}},
            {"id": "unused", "kind": "edition", "of": "republic", "title": format!("{SECRET} unused")}
        ], "interpretations": [
            {"id": "mine", "kind": "rendering", "source": "burnet", "language": "en",
             "locators": [{"kind": "canonical", "value": "514a"}],
             "text": "Compare our nature to this.", "interpreters": [{"contributor": "ada", "attribution": "stated"}],
             "rights": {"status": "ownWork"}, "uncertainty": format!("{SECRET} interpretation doubt")},
            {"id": "theirs", "kind": "reading", "source": "burnet",
             "text": format!("{SECRET} unpermitted reading"), "interpreters": [{"name": "A. Scholar"}]}
        ]})
        .to_string(),
        &contributors(),
    )
    .unwrap()
}

fn notebook(library: &SourceLibrary) -> Notebook {
    Notebook::parse(
        &json!({"version": 1, "passages": [
            {"id": "p-burnet", "source": "burnet", "excerpt": {"text": GREEK_NFD, "language": "grc"},
             "locators": [{"kind": "canonical", "value": "514a"}]},
            {"id": "p-grube", "source": "grube", "excerpt": {"text": format!("{SECRET} reserved wording"), "language": "en"},
             "locators": [{"kind": "page", "value": "186"}]},
            {"id": "p-hebrew", "source": "hebrew", "excerpt": {"text": format!("{HEBREW}\n{HOSTILE}"), "language": "he"}},
            {"id": "p-paris", "source": "paris", "excerpt": {"text": format!("{SECRET} unknown wording")},
             "locators": [{"kind": "folio", "value": "12r"}]},
            {"id": "p-long", "source": "long", "excerpt": {"text": "λ".repeat(MAX_PUBLIC_EXCERPT_CHARS + 1)}}
        ], "notes": [{"id": "n", "kind": "question", "text": format!("{SECRET} note"), "passages": ["p-burnet"]}]})
        .to_string(),
        library,
    )
    .unwrap()
}

fn fixture() -> Value {
    json!({"version": 1, "alignments": [
        {"id": "cave", "label": "The cave", "correspondence": "partial", "visibility": "approved",
         "members": [
            {"source": "burnet", "passage": "p-burnet",
             "normalized": {"text": "μετὰ ταῦτα", "note": "Accents composed"}, "note": format!("{SECRET} member note")},
            {"source": "grube", "passage": "p-grube"},
            {"source": "hebrew", "passage": "p-hebrew"},
            {"source": "paris", "passage": "p-paris"},
            {"source": "long", "passage": "p-long"},
            {"source": "grube", "locators": [{"kind": "page", "value": "187"}]},
            {"interpretation": "mine", "normalized": {"text": "compare our nature"}},
            {"interpretation": "theirs"}
         ],
         "rationale": "Both render 514a.", "confidence": "plausible",
         "recordedBy": {"kind": "named", "name": "A concordance"},
         "evidence": [{"source": "burnet", "locators": [{"kind": "page", "value": "1"}], "passage": "p-burnet"}],
         "shelf": format!("{SECRET} unknown field")},
        {"id": "hidden", "label": format!("{SECRET} private label"), "members": [
            {"source": "unused", "locators": [{"kind": "page", "value": "1"}]},
            {"source": "paris", "absent": true}
        ]}
    ]})
}

fn project(value: &Value) -> PublicComparisons {
    let library = library();
    let notebook = notebook(&library);
    let set = AlignmentSet::parse(
        &value.to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .unwrap();
    PublicComparisons::project(
        &set,
        ComparisonInputs {
            library: &library,
            notebook: &notebook,
            contributors: &contributors(),
        },
    )
    .unwrap()
}

#[test]
fn only_approved_alignments_publish_and_withdrawal_removes_them() {
    let published = project(&fixture());
    assert_eq!(published.format, PUBLIC_COMPARISONS_FORMAT);
    let ids: Vec<&str> = published
        .comparisons
        .iter()
        .map(|c| c.id.as_str())
        .collect();
    assert_eq!(ids, ["cave"]);
    assert!(
        published.source("unused").is_none(),
        "a private alignment's sources stay out"
    );
    let mut withdrawn = fixture();
    withdrawn["alignments"][0]["visibility"] = json!("private");
    let after = project(&withdrawn);
    assert!(after.comparisons.is_empty() && after.sources.is_empty());
}

#[test]
fn wording_follows_the_authors_rights_statement_and_the_excerpt_limit() {
    let published = project(&fixture());
    let cave = &published.comparisons[0];
    let version = |kind: VersionKind, source: &str| {
        cave.versions
            .iter()
            .find(|v| v.kind == kind && v.source == source)
            .unwrap()
    };
    let burnet = version(VersionKind::Source, "burnet");
    let text = burnet.places[0]
        .text
        .as_ref()
        .expect("public domain is quoted");
    assert_eq!(text.text, GREEK_NFD, "exactly as stored, never normalized");
    assert_eq!((text.language.as_deref(), text.dir), (Some("grc"), "ltr"));
    assert_eq!(burnet.rights.status, RightsStatus::PublicDomain);
    let grube = version(VersionKind::Source, "grube");
    assert_eq!(
        grube.places.len(),
        2,
        "a split keeps both places in one version"
    );
    assert_eq!(grube.places[0].text, None);
    assert_eq!(grube.places[0].withheld, Some(Withheld::Rights));
    assert_eq!(
        grube.places[0].locators[0].value, "186",
        "the place is still identified"
    );
    assert_eq!(
        (grube.places[1].text.as_ref(), grube.places[1].withheld),
        (None, None)
    );
    let hebrew = version(VersionKind::Source, "hebrew");
    let quoted = hebrew.places[0].text.as_ref().unwrap();
    assert_eq!(quoted.dir, "rtl");
    assert!(quoted.text.starts_with(HEBREW));
    assert_eq!(hebrew.rights.license.as_deref(), Some("CC-BY-4.0"));
    let paris = version(VersionKind::Source, "paris");
    assert_eq!(paris.rights.status, RightsStatus::Unknown);
    assert_eq!(
        paris.places[0].withheld,
        Some(Withheld::Rights),
        "unknown is never quoted"
    );
    let long = version(VersionKind::Source, "long");
    assert_eq!(long.places[0].withheld, Some(Withheld::Length));
    assert!(displays_wording(RightsStatus::OwnWork));
}

#[test]
fn interpretations_stay_attributed_and_apart_from_the_text_they_interpret() {
    let published = project(&fixture());
    let cave = &published.comparisons[0];
    let interpretations: Vec<_> = cave
        .versions
        .iter()
        .filter(|v| v.kind == VersionKind::Interpretation)
        .collect();
    assert_eq!(interpretations.len(), 2);
    let mine = interpretations[0].interpretation.as_ref().unwrap();
    assert_eq!(mine.id, "mine");
    assert_eq!(
        mine.interpreters[0].name, "Ada Lovelace",
        "a contributor reads by public name"
    );
    assert_eq!(interpretations[0].source, "burnet");
    assert_eq!(
        interpretations[0].places[0].text.as_ref().unwrap().text,
        "Compare our nature to this."
    );
    assert_eq!(
        interpretations[1].places[0].withheld,
        Some(Withheld::Rights)
    );
    assert_eq!(
        interpretations[1]
            .interpretation
            .as_ref()
            .unwrap()
            .interpreters[0]
            .name,
        "A. Scholar"
    );
}

#[test]
fn normalizations_publish_only_when_chosen_and_beside_published_wording() {
    let published = project(&fixture());
    let json = published.to_json();
    assert!(!json.contains("μετὰ ταῦτα") && !json.contains("compare our nature"));
    let mut chosen = fixture();
    chosen["alignments"][0]["publishNormalized"] = json!(true);
    let published = project(&chosen);
    let cave = &published.comparisons[0];
    let burnet = &cave.versions[0].places[0];
    let normalized = burnet.normalized.as_ref().unwrap();
    assert_eq!(normalized.text.text, "μετὰ ταῦτα");
    assert_eq!(normalized.note.as_deref(), Some("Accents composed"));
    assert!(published.to_json().contains("compare our nature"));
}

#[test]
fn nothing_private_reaches_the_artifact_and_it_is_not_research_shaped() {
    let mut value = fixture();
    value["alignments"][0]["publishNormalized"] = json!(true);
    let published = project(&value);
    let json = published.to_json();
    assert!(!json.contains(SECRET), "{json}");
    assert!(
        !json.contains("p-burnet"),
        "notebook passage ids stay private"
    );
    assert!(!json.contains("\"version\""));
    assert!(!json.contains('<') && !json.contains('>') && !json.contains('&'));
    let parsed: Value = serde_json::from_str(&json).unwrap();
    assert!(
        parsed["comparisons"][0]["versions"][2]["places"][0]["text"]["text"]
            .as_str()
            .unwrap()
            .ends_with(HOSTILE)
    );
    assert!(!openblog_core::research_bundle::looks_like_private_research(json.as_bytes()));
    assert_eq!(project(&value).to_json(), json, "deterministic");
}

#[test]
fn a_preview_shows_what_an_unapproved_alignment_would_publish() {
    let library = library();
    let notebook = notebook(&library);
    let mut value = fixture();
    value["alignments"][0]["visibility"] = json!("private");
    let set = AlignmentSet::parse(
        &value.to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .unwrap();
    let preview = PublicComparison::project(
        &set.alignments[0],
        ComparisonInputs {
            library: &library,
            notebook: &notebook,
            contributors: &contributors(),
        },
    )
    .unwrap();
    let order: Vec<usize> = preview
        .places_in_member_order()
        .iter()
        .map(|p| p.member)
        .collect();
    assert_eq!(order, (0..8).collect::<Vec<_>>());
}

//! Curated public-research selection (#192, ADR 0215-0220): nothing is public
//! because it exists, selection is revision-aware and item-scoped, a
//! relationship brings its approved endpoint context and provenance, and
//! private research never reaches the curated projection.

use std::collections::BTreeMap;

use openblog_core::alignment::AlignmentSet;
use openblog_core::atlas_publication::PublicAtlas;
use openblog_core::comparison_publication::{ComparisonInputs, PublicComparisons};
use openblog_core::curated_selection::{
    resolve, Basis, Code, ContextKind, Existing, NewSelection, NoticeCode, Provenance, Selection,
    SelectionKind, SelectionSet, Why,
};
use openblog_core::knowledge_atlas::{Atlas, Links};
use openblog_core::publication_boundary::{
    BoundaryInputs, BoundaryManifest, CurationInput, ItemKind, Projection, Reason, Switches,
};
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::SourceLibrary;
use serde_json::{json, Value};

const PRIVATE: &str = "PRIVATE-CURATION-MARKER";

fn library_value() -> Value {
    json!({"version": 1, "sources": [
        {"id": "republic", "kind": "work", "title": "Politeia",
         "creators": [{"name": "Plato", "role": "author"}],
         "identifiers": [{"scheme": "url", "value": "http://localhost:8080/scan"},
                         {"scheme": "doi", "value": "10.1000/republic"},
                         {"scheme": "my-drive", "value": format!("C:/{PRIVATE}/scan.pdf")}],
         "note": format!("{PRIVATE} source note")},
        {"id": "burnet", "kind": "edition", "of": "republic", "title": "Platonis Opera",
         "rights": {"status": "publicDomain"}},
        {"id": "grube", "kind": "translation", "of": "republic", "title": "Republic", "language": "en",
         "rights": {"status": "rightsReserved", "note": format!("{PRIVATE} rights note")}},
        {"id": "scholar", "kind": "work", "title": "A study of the dialogues"},
        {"id": "undated", "kind": "work", "title": "Undated"}
    ]})
}

fn library_with(value: &Value) -> SourceLibrary {
    SourceLibrary::parse(&value.to_string(), &BTreeMap::new()).expect("library")
}

fn notebook(library: &SourceLibrary) -> Notebook {
    Notebook::parse(
        &json!({"version": 1, "passages": [
            {"id": "p-burnet", "source": "burnet", "excerpt": {"text": "Compare our nature to this."},
             "locators": [{"kind": "canonical", "value": "514a"}]},
            {"id": "p-grube", "source": "grube", "excerpt": {"text": format!("{PRIVATE} reserved wording")},
             "locators": [{"kind": "page", "value": "186"}]}
        ], "notes": [{"id": "n-1", "kind": "question", "text": format!("{PRIVATE} a private note"),
            "passages": ["p-burnet"]}]})
        .to_string(),
        library,
    )
    .expect("notebook")
}

fn dating(id: &str, aspect: &str, year: i32, source: &str) -> Value {
    json!({"id": id, "aspect": aspect, "date": {"at": {"year": year}},
        "assertedBy": {"kind": "source", "source": source}, "confidence": "plausible",
        "evidence": [{"source": source, "locators": [{"kind": "chapter", "value": "3"}]}],
        "visibility": "approved"})
}

fn atlas_value() -> Value {
    json!({"version": 2,
    "entries": [
        {"id": "plato", "kind": "person", "label": "Plato",
         "summary": "An Athenian philosopher.", "visibility": "approved",
         "dates": [dating("plato-birth-a", "birth", -428, "scholar"),
                   dating("plato-birth-b", "birth", -424, "burnet")]},
        {"id": "republic", "kind": "work", "label": "Republic", "source": "republic",
         "visibility": "approved"},
        {"id": "academy", "kind": "movement", "label": "The Academy <b>x</b>",
         "visibility": "approved"},
        {"id": "secret", "kind": "concept", "label": format!("{PRIVATE} private label"),
         "summary": format!("{PRIVATE} private summary"), "visibility": "private"}
    ],
    "relationships": [
        {"id": "r-authored", "kind": "authored", "from": "plato", "to": "republic",
         "assertedBy": {"kind": "source", "source": "scholar"}, "confidence": "plausible",
         "evidence": [{"source": "burnet", "locators": [{"kind": "page", "value": "514"}]}],
         "uncertainty": "The dating is unsettled.",
         "contestedBy": [{"by": {"kind": "named", "name": "A later editor"},
             "note": "Dates it later.", "evidence": [{"source": "republic"}]}],
         "visibility": "approved"},
        {"id": "r-member", "kind": "member-of", "from": "plato", "to": "academy",
         "assertedBy": {"kind": "author"}, "evidence": [{"source": "scholar"}],
         "visibility": "approved"},
        {"id": "r-private", "kind": "related-to", "from": "plato", "to": "academy",
         "assertedBy": {"kind": "author"}, "evidence": [{"source": "scholar"}],
         "uncertainty": format!("{PRIVATE} private relationship"), "visibility": "private"}
    ]})
}

struct World {
    library: SourceLibrary,
    atlas: Atlas,
    public_atlas: PublicAtlas,
    comparisons: PublicComparisons,
    existing: Existing,
}

fn alignments_value() -> Value {
    json!({"version": 1, "alignments": [
        {"id": "cave", "label": "The cave", "correspondence": "partial", "visibility": "approved",
         "members": [{"source": "burnet", "passage": "p-burnet"},
                     {"source": "grube", "passage": "p-grube"}],
         "rationale": "Both render 514a.", "confidence": "plausible",
         "recordedBy": {"kind": "named", "name": "A concordance"},
         "evidence": [{"source": "burnet"}]},
        {"id": "hidden", "label": format!("{PRIVATE} hidden"), "members": [
            {"source": "burnet", "passage": "p-burnet"},
            {"source": "grube", "locators": [{"kind": "page", "value": "1"}]}]}
    ]})
}

fn world_with(library_value: &Value, atlas_value: &Value) -> World {
    let library = library_with(library_value);
    let notebook = notebook(&library);
    let atlas = Atlas::parse(
        &atlas_value.to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .expect("atlas");
    let set = AlignmentSet::parse(
        &alignments_value().to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .expect("alignments");
    let public_atlas = PublicAtlas::project(&atlas, &library).expect("projection");
    let comparisons = PublicComparisons::project(
        &set,
        ComparisonInputs {
            library: &library,
            notebook: &notebook,
            contributors: &BTreeMap::new(),
        },
    )
    .expect("comparisons");
    let existing = Existing::of(Some(&atlas), Some(&set));
    World {
        library,
        atlas,
        public_atlas,
        comparisons,
        existing,
    }
}

fn world() -> World {
    world_with(&library_value(), &atlas_value())
}

impl World {
    fn basis(&self) -> Basis<'_> {
        Basis {
            atlas: Some(&self.public_atlas),
            comparisons: Some(&self.comparisons),
            library: Some(&self.library),
            existing: Some(&self.existing),
        }
    }
}

fn pick(kind: SelectionKind, target: &str) -> NewSelection {
    NewSelection {
        kind: Some(kind),
        target: target.into(),
        ..NewSelection::default()
    }
}

fn select(set: &mut SelectionSet, world: &World, new: NewSelection) -> String {
    set.select(new, &world.basis()).expect("selected")
}

#[test]
fn nothing_is_public_merely_because_it_exists() {
    let w = world();
    let resolution = resolve(&SelectionSet::default(), &w.basis());
    assert!(resolution.curation.items.is_empty() && resolution.curation.context.is_empty());
    assert!(resolution.withheld.is_empty());

    // Selecting never approves: private and unapproved research is refused.
    let mut set = SelectionSet::default();
    for (kind, target) in [
        (SelectionKind::ContextualEntry, "secret"),
        (SelectionKind::Relationship, "r-private"),
        (SelectionKind::Comparison, "hidden"),
        (SelectionKind::Reference, "missing-source"),
    ] {
        let problems = set.select(pick(kind, target), &w.basis()).unwrap_err();
        assert_eq!(problems[0].code, Code::TargetNotPublished, "{target}");
        assert!(!problems[0].message.contains(PRIVATE));
    }
    assert!(set.selections.is_empty());
}

#[test]
fn only_the_listed_fields_of_a_selected_item_publish() {
    let w = world();
    let mut set = SelectionSet::default();
    let bare = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let resolution = resolve(&set, &w.basis());
    let item = &resolution.curation.items[0];
    assert_eq!(item.id, bare);
    assert!(item.content.contains_key("label") && item.content.contains_key("url"));
    assert!(!item.content.contains_key("summary"), "{:?}", item.content);

    let mut set = SelectionSet::default();
    select(
        &mut set,
        &w,
        NewSelection {
            optional_fields: vec!["summary".into()],
            ..pick(SelectionKind::ContextualEntry, "plato")
        },
    );
    let resolution = resolve(&set, &w.basis());
    assert_eq!(
        resolution.curation.items[0].content["summary"],
        json!("An Athenian philosopher.")
    );
}

#[test]
fn a_relationship_brings_its_endpoints_provenance_and_disputes() {
    let w = world();
    let mut set = SelectionSet::default();
    select(
        &mut set,
        &w,
        pick(SelectionKind::Relationship, "r-authored"),
    );
    let resolution = resolve(&set, &w.basis());
    let item = &resolution.curation.items[0];
    for field in [
        "assertedBy",
        "confidence",
        "evidence",
        "standing",
        "uncertainty",
        "contestedBy",
    ] {
        assert!(item.content.contains_key(field), "{field}");
    }
    assert_eq!(item.content["standing"], json!("contested"));
    let context: Vec<(ContextKind, &str)> = resolution
        .curation
        .context
        .iter()
        .map(|c| (c.kind, c.id.as_str()))
        .collect();
    assert_eq!(
        context,
        vec![
            (ContextKind::Entry, "plato"),
            (ContextKind::Entry, "republic"),
            (ContextKind::Source, "burnet"),
            (ContextKind::Source, "republic"),
            (ContextKind::Source, "scholar"),
        ]
    );
    assert!(resolution
        .curation
        .context
        .iter()
        .all(|c| c.via == vec![item.id.clone()]));
    // Nothing from the unrelated entries.
    assert!(!resolution
        .curation
        .context
        .iter()
        .any(|c| c.id == "academy" || c.id == "grube"));

    // A disputed relationship cannot be curated into an undisputed one.
    let mut stored = set.selections[0].clone();
    stored.fields.retain(|f| f != "contestedBy");
    let problems = openblog_core::curated_selection::validate(&stored);
    assert_eq!(problems[0].code, Code::RequiredFieldMissing);
}

#[test]
fn a_changed_source_makes_a_selection_stale_until_it_is_selected_again() {
    let w = world();
    let mut set = SelectionSet::default();
    let relationship = select(
        &mut set,
        &w,
        pick(SelectionKind::Relationship, "r-authored"),
    );
    let reference = select(&mut set, &w, pick(SelectionKind::Reference, "scholar"));
    let other = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );

    let mut changed = library_value();
    changed["sources"][3]["title"] = json!("A revised study");
    let w2 = world_with(&changed, &atlas_value());
    let resolution = resolve(&set, &w2.basis());
    let stale: Vec<&str> = resolution
        .withheld
        .iter()
        .filter(|w| w.why == Why::Stale)
        .map(|w| w.id.as_str())
        .collect();
    // The relationship depends on the source; the other entry does not.
    let mut expected = vec![reference.as_str(), relationship.as_str()];
    expected.sort_unstable();
    assert_eq!(stale, expected);
    assert_eq!(resolution.curation.items.len(), 1);
    assert_eq!(resolution.curation.items[0].id, other);

    // The author checks and selects again: published as it now stands.
    set.reselect(&reference, &w2.basis()).unwrap();
    set.reselect(&relationship, &w2.basis()).unwrap();
    let resolution = resolve(&set, &w2.basis());
    assert!(resolution.withheld.is_empty());
    assert_eq!(resolution.curation.items.len(), 3);
}

#[test]
fn deleted_and_unapproved_targets_are_told_apart() {
    let w = world();
    let mut set = SelectionSet::default();
    let entry = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );
    let member = select(&mut set, &w, pick(SelectionKind::Relationship, "r-member"));

    // Deleted: the entry and its relationship are gone from the atlas.
    let mut atlas = atlas_value();
    atlas["entries"]
        .as_array_mut()
        .unwrap()
        .retain(|e| e["id"] != "academy");
    atlas["relationships"]
        .as_array_mut()
        .unwrap()
        .retain(|r| r["to"] != "academy");
    let gone = world_with(&library_value(), &atlas);
    let resolution = resolve(&set, &gone.basis());
    assert!(resolution
        .withheld
        .iter()
        .all(|w| w.why == Why::TargetMissing));
    assert_eq!(resolution.withheld.len(), 2);

    // Withdrawn from the atlas (made private): exists, not approved.
    let mut atlas = atlas_value();
    atlas["relationships"][1]["visibility"] = json!("private");
    let hidden = world_with(&library_value(), &atlas);
    let resolution = resolve(&set, &hidden.basis());
    let why = |id: &str| resolution.withheld.iter().find(|w| w.id == id).unwrap().why;
    assert_eq!(why(&member), Why::NotApproved);
    assert_eq!(resolution.curation.items[0].id, entry);
}

#[test]
fn cycles_and_withheld_requirements_are_scoped_to_their_selections() {
    let w = world();
    let mut set = SelectionSet::default();
    let a = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let b = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "republic"),
    );
    let c = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );
    let d = select(&mut set, &w, pick(SelectionKind::Reference, "scholar"));
    for (id, requires) in [(&a, &b), (&b, &a), (&c, &a)] {
        set.selections
            .iter_mut()
            .find(|s| &s.id == id)
            .unwrap()
            .requires = vec![requires.clone()];
    }
    let resolution = resolve(&set, &w.basis());
    let why = |id: &str| resolution.withheld.iter().find(|w| w.id == id).unwrap().why;
    assert_eq!(why(&a), Why::Cycle);
    assert_eq!(why(&b), Why::Cycle);
    assert_eq!(why(&c), Why::DependencyWithheld);
    assert_eq!(resolution.curation.items.len(), 1);
    assert_eq!(resolution.curation.items[0].id, d);

    // A requirement that is not a selection is a missing dependency.
    set.selections
        .iter_mut()
        .find(|s| s.id == d)
        .unwrap()
        .requires = vec!["nope".into()];
    let resolution = resolve(&set, &w.basis());
    assert!(resolution
        .withheld
        .iter()
        .any(|w| w.id == d && w.why == Why::DependencyMissing));
}

#[test]
fn restricted_wording_is_never_shown_and_a_selection_can_opt_out_of_wording() {
    let w = world();
    let mut with = SelectionSet::default();
    select(
        &mut with,
        &w,
        NewSelection {
            optional_fields: vec!["wording".into()],
            ..pick(SelectionKind::Comparison, "cave")
        },
    );
    let resolution = resolve(&with, &w.basis());
    let text = serde_json::to_string(&resolution.curation).unwrap();
    assert!(
        text.contains("Compare our nature to this."),
        "the permitted version shows"
    );
    assert!(!text.contains(PRIVATE), "the reserved version never shows");
    assert!(resolution
        .notices
        .iter()
        .any(|n| n.code == NoticeCode::RightsRestricted
            && n.field.as_deref().is_some_and(|f| f.contains("places"))));

    let mut without = SelectionSet::default();
    select(&mut without, &w, pick(SelectionKind::Comparison, "cave"));
    let text = serde_json::to_string(&resolve(&without, &w.basis()).curation).unwrap();
    assert!(
        !text.contains("Compare our nature"),
        "no wording unless selected"
    );
    assert!(text.contains("correspondence") && text.contains("recordedBy"));
}

#[test]
fn provenance_is_recorded_when_stated_and_never_invented() {
    let w = world();
    let mut set = SelectionSet::default();
    select(&mut set, &w, pick(SelectionKind::Reference, "scholar"));
    select(
        &mut set,
        &w,
        NewSelection {
            provenance: Provenance::Imported {
                from: "CSL JSON import".into(),
            },
            ..pick(SelectionKind::Reference, "burnet")
        },
    );
    // A source with no title: the selected field is listed missing, not filled.
    select(
        &mut set,
        &w,
        NewSelection {
            optional_fields: vec!["issued".into()],
            ..pick(SelectionKind::Reference, "undated")
        },
    );
    let resolution = resolve(&set, &w.basis());
    let item = |target: &str| {
        resolution
            .curation
            .items
            .iter()
            .find(|i| i.target == target)
            .unwrap()
    };
    assert_eq!(item("scholar").provenance, Provenance::Unrecorded);
    assert_eq!(
        item("burnet").provenance,
        Provenance::Imported {
            from: "CSL JSON import".into()
        }
    );
    let bare = item("undated");
    assert!(!bare.content.contains_key("creators") && !bare.content.contains_key("issued"));
    assert_eq!(bare.missing, vec!["creators", "issued"]);
    assert!(resolution
        .notices
        .iter()
        .any(|n| n.id == item("scholar").id && n.code == NoticeCode::ProvenanceUnrecorded));
    assert!(!resolution
        .notices
        .iter()
        .any(|n| n.id == item("burnet").id && n.code == NoticeCode::ProvenanceUnrecorded));
}

#[test]
fn unsafe_addresses_and_private_identifiers_stay_out_of_a_reference() {
    let w = world();
    let mut set = SelectionSet::default();
    select(
        &mut set,
        &w,
        NewSelection {
            optional_fields: vec!["identifiers".into()],
            ..pick(SelectionKind::Reference, "republic")
        },
    );
    let resolution = resolve(&set, &w.basis());
    let text = serde_json::to_string(&resolution.curation).unwrap();
    assert!(text.contains("10.1000/republic"));
    assert!(!text.contains("localhost") && !text.contains(PRIVATE));
    let codes: Vec<NoticeCode> = resolution.notices.iter().map(|n| n.code).collect();
    assert!(
        codes.contains(&NoticeCode::UnsafeUrl) && codes.contains(&NoticeCode::PrivateIdentifier)
    );
    assert!(resolution
        .notices
        .iter()
        .all(|n| !n.message.contains(PRIVATE)));
}

#[test]
fn annotations_and_explanations_are_attributed_approved_text_only() {
    let w = world();
    let mut set = SelectionSet::default();
    let hostile = "<script>alert(1)</script> & </blockquote>";
    let annotation = select(
        &mut set,
        &w,
        NewSelection {
            text: Some(hostile.into()),
            by: Some("Site Author".into()),
            locator: Some("514a".into()),
            ..pick(SelectionKind::SourceAnnotation, "burnet")
        },
    );
    select(
        &mut set,
        &w,
        NewSelection {
            text: Some("Plato founded the Academy.".into()),
            by: Some("Site Author".into()),
            ..pick(SelectionKind::Explanation, "plato")
        },
    );
    let resolution = resolve(&set, &w.basis());
    let item = resolution
        .curation
        .items
        .iter()
        .find(|i| i.id == annotation)
        .unwrap();
    // The text is data, kept verbatim for the renderers to escape; nothing
    // of the private notebook came with it.
    assert_eq!(item.content["text"], json!(hostile));
    assert_eq!(item.content["by"], json!("Site Author"));
    let text = serde_json::to_string(&resolution.curation).unwrap();
    assert!(!text.contains(PRIVATE) && !text.contains("p-burnet"));
    // The annotated source and entry travel as context.
    assert!(resolution.curation.context.iter().any(|c| c.id == "burnet"));
    assert!(resolution.curation.context.iter().any(|c| c.id == "plato"));

    // Unattributed, empty, overlong and direction-override text is refused.
    for (text, by, code) in [
        (Some("ok"), None, Code::AttributionRequired),
        (None, Some("me"), Code::TextRequired),
        (Some("x\u{202e}y"), Some("me"), Code::UnsafeText),
        (Some("a\u{0007}b"), Some("me"), Code::UnsafeText),
    ] {
        let problems = set
            .select(
                NewSelection {
                    id: Some("bad".into()),
                    text: text.map(Into::into),
                    by: by.map(Into::into),
                    ..pick(SelectionKind::SourceAnnotation, "scholar")
                },
                &w.basis(),
            )
            .unwrap_err();
        assert!(
            problems.iter().any(|p| p.code == code),
            "{code:?}: {problems:?}"
        );
    }
    let long = "w".repeat(openblog_core::curated_selection::MAX_TEXT_CHARS + 1);
    let problems = set
        .select(
            NewSelection {
                id: Some("long".into()),
                text: Some(long),
                by: Some("me".into()),
                ..pick(SelectionKind::Explanation, "plato")
            },
            &w.basis(),
        )
        .unwrap_err();
    assert!(problems
        .iter()
        .any(|p| p.code == Code::TextTooLong || p.code == Code::UnsafeText));
}

#[test]
fn a_selected_dating_names_competing_datings_it_leaves_out() {
    let w = world();
    let mut set = SelectionSet::default();
    let a = select(&mut set, &w, pick(SelectionKind::Timeline, "plato-birth-a"));
    let resolution = resolve(&set, &w.basis());
    let notice = resolution
        .notices
        .iter()
        .find(|n| n.code == NoticeCode::CompetingUnselected)
        .expect("a competing dating is named");
    assert_eq!(
        (notice.id.as_str(), notice.message.contains("plato-birth-b")),
        (a.as_str(), true)
    );
    let item = &resolution.curation.items[0];
    assert!(item.content.contains_key("assertedBy") && item.content.contains_key("evidence"));
    select(&mut set, &w, pick(SelectionKind::Timeline, "plato-birth-b"));
    let resolution = resolve(&set, &w.basis());
    assert!(!resolution
        .notices
        .iter()
        .any(|n| n.code == NoticeCode::CompetingUnselected));
}

#[test]
fn withdrawing_keeps_the_record_and_unselecting_changes_no_research() {
    let w = world();
    let mut set = SelectionSet::default();
    let id = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    assert!(set.withdraw(&id, Some("rethinking".into())));
    let resolution = resolve(&set, &w.basis());
    assert!(resolution.curation.items.is_empty());
    assert_eq!(resolution.withheld[0].why, Why::Withdrawn);
    set.reselect(&id, &w.basis()).unwrap();
    assert_eq!(resolve(&set, &w.basis()).curation.items.len(), 1);
    assert!(set.unselect(&id) && !set.unselect(&id));
    // The private canonical objects are untouched.
    assert!(w.atlas.entry("plato").is_some());
    assert!(set
        .select(pick(SelectionKind::ContextualEntry, "plato"), &w.basis())
        .is_ok());
    let again = set.select(pick(SelectionKind::ContextualEntry, "plato"), &w.basis());
    assert_eq!(again.unwrap_err()[0].code, Code::DuplicateId);
}

#[test]
fn the_file_round_trips_deterministically_and_rejects_hostile_records() {
    let w = world();
    let mut set = SelectionSet::default();
    select(&mut set, &w, pick(SelectionKind::Relationship, "r-member"));
    select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let text = set.to_json();
    assert!(!text.contains('\r') && text.ends_with('\n'));
    let parsed = SelectionSet::parse(&text).unwrap();
    assert_eq!(parsed, set);
    assert_eq!(parsed.to_json(), text);
    let one = serde_json::to_string(&resolve(&parsed, &w.basis()).curation).unwrap();
    let two = serde_json::to_string(&resolve(&set, &w.basis()).curation).unwrap();
    assert_eq!(one, two);

    // Unknown fields are kept in the file and never published.
    let mut value: Value = serde_json::from_str(&text).unwrap();
    value["selections"][0]["workspace"] = json!(format!("{PRIVATE} extra"));
    value["futureKey"] = json!(1);
    let kept = SelectionSet::parse(&value.to_string()).unwrap();
    assert!(kept.to_json().contains("futureKey"));
    assert!(!serde_json::to_string(&resolve(&kept, &w.basis()).curation)
        .unwrap()
        .contains(PRIVATE));

    // Migration: a later version is refused, naming the version only.
    let mut later = value.clone();
    later["version"] = json!(2);
    assert_eq!(
        SelectionSet::parse(&later.to_string()).unwrap_err()[0].code,
        Code::UnsupportedVersion
    );
    assert_eq!(
        SelectionSet::parse("{ not json").unwrap_err()[0].code,
        Code::InvalidJson
    );

    // Hostile records.
    let mut bad: Value = serde_json::from_str(&text).unwrap();
    bad["selections"][0]["id"] = json!("../etc/passwd");
    bad["selections"][1]["target"] = json!("a b<script>");
    bad["selections"][1]["revision"] = json!("nope");
    bad["selections"][1]["fields"] = json!(["label", "visibility"]);
    let problems = SelectionSet::parse(&bad.to_string()).unwrap_err();
    let codes: Vec<Code> = problems.iter().map(|p| p.code).collect();
    for code in [
        Code::BadId,
        Code::BadTarget,
        Code::BadRevision,
        Code::FieldNotAllowed,
    ] {
        assert!(codes.contains(&code), "{code:?}");
    }
    let mut duplicate: Value = serde_json::from_str(&text).unwrap();
    let first = duplicate["selections"][0].clone();
    duplicate["selections"].as_array_mut().unwrap().push(first);
    assert!(SelectionSet::parse(&duplicate.to_string())
        .unwrap_err()
        .iter()
        .any(|p| p.code == Code::DuplicateId));
}

#[test]
fn the_boundary_manifest_gains_one_projection_only_when_curating() {
    let w = world();
    let mut set = SelectionSet::default();
    let live = select(
        &mut set,
        &w,
        pick(SelectionKind::Relationship, "r-authored"),
    );
    let stale = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );
    let withdrawn = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    set.withdraw(&withdrawn, None);
    set.selections
        .iter_mut()
        .find(|s| s.id == stale)
        .unwrap()
        .revision = "0".repeat(16);
    let resolution = resolve(&set, &w.basis());
    let curation = CurationInput {
        set: &set,
        resolution: &resolution,
    };
    let inputs = |on: bool| BoundaryInputs {
        switches: Switches {
            curated: on,
            ..Switches::default()
        },
        posts: &[],
        public_atlas: Some(&w.public_atlas),
        atlas_blocked: None,
        public_comparisons: Some(&w.comparisons),
        comparisons_blocked: None,
        claims_blocked: None,
        library: Some(&w.library),
        notebook: None,
        atlas: Some(&w.atlas),
        claims: None,
        alignments: None,
        stale_comparisons: None,
        acknowledgements: None,
        curation: None,
        unavailable: &[],
    };
    // Off, nothing selected: the manifest is what it always was.
    let legacy = BoundaryManifest::site(&inputs(false));
    assert!(legacy
        .projections
        .iter()
        .all(|p| p.projection != Projection::Curated));
    assert!(legacy
        .never
        .iter()
        .all(|n| n.file != openblog_core::curated_selection::SELECTIONS_FILE));

    let mut on = inputs(true);
    on.curation = Some(&curation);
    let manifest = BoundaryManifest::site(&on);
    let report = manifest
        .projections
        .iter()
        .find(|p| p.projection == Projection::Curated)
        .expect("the curated projection");
    assert!(report.enabled);
    let published: Vec<&str> = report
        .published
        .iter()
        .filter(|i| i.kind == ItemKind::Selection)
        .map(|i| i.id.as_str())
        .collect();
    assert_eq!(published, vec![live.as_str()]);
    let reasons: BTreeMap<&str, Reason> = report
        .withheld
        .iter()
        .map(|i| (i.id.as_str(), i.reason))
        .collect();
    assert_eq!(reasons[stale.as_str()], Reason::StaleSelection);
    assert_eq!(reasons[withdrawn.as_str()], Reason::Withdrawn);
    assert!(manifest.build_warnings().iter().any(|w| w.contains(&stale)));
    // The curated report names ids; never private labels or text.
    assert!(!serde_json::to_string(report).unwrap().contains(PRIVATE));

    // The switch off: the file's selections are listed, all withheld.
    let mut off = inputs(false);
    off.curation = Some(&curation);
    let manifest = BoundaryManifest::site(&off);
    let report = manifest
        .projections
        .iter()
        .find(|p| p.projection == Projection::Curated)
        .unwrap();
    assert!(!report.enabled && report.published.is_empty());
    assert!(report
        .withheld
        .iter()
        .all(|i| i.reason == Reason::ProjectionOff));
}

#[test]
fn selection_ids_in_diagnostics_never_carry_private_text() {
    let w = world();
    let mut set = SelectionSet::default();
    let sel: Selection = {
        select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
        set.selections[0].clone()
    };
    let mut atlas = atlas_value();
    atlas["entries"][0]["summary"] = json!(format!("{PRIVATE} edited"));
    let changed = world_with(&library_value(), &atlas);
    let resolution = resolve(&set, &changed.basis());
    assert_eq!(resolution.withheld[0].why, Why::Stale);
    assert!(!resolution.withheld[0].message.contains(PRIVATE));
    assert!(resolution.withheld[0].message.contains(&sel.id));
}

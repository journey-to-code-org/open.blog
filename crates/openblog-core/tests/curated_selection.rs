//! Curated public-research selection (#192, ADR 0215-0220): nothing is public
//! because it exists, selection is revision-aware and item-scoped, a
//! relationship brings its approved endpoint context and provenance, and
//! private research never reaches the curated projection.

use std::collections::{BTreeMap, BTreeSet};

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
        {"id": "undated", "kind": "work", "title": "Undated"},
        {"id": "diary", "kind": "work", "title": format!("{PRIVATE} diary")}
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
    /// Cited by a published post, atlas-published or comparison-published.
    public_sources: BTreeSet<String>,
    posts: BTreeSet<String>,
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
    // `undated` is public only because a published post cites it.
    let public_sources = public_atlas
        .sources
        .iter()
        .chain(&comparisons.sources)
        .map(|source| source.reference.key.clone())
        .chain(["undated".to_string()])
        .collect();
    World {
        library,
        atlas,
        public_atlas,
        comparisons,
        existing,
        public_sources,
        posts: ["cave".to_string(), "other".to_string()].into(),
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
            public_sources: Some(&self.public_sources),
            posts: Some(&self.posts),
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
        // Requirements are part of what was selected: check, then select again.
        set.reselect(id, &w.basis()).unwrap();
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
    set.reselect(&d, &w.basis()).unwrap();
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
        author: "",
        base_path: "",
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

    // The switch off: whatever the file holds, the manifest does not mention it.
    let mut off = inputs(false);
    off.curation = Some(&curation);
    let manifest = BoundaryManifest::site(&off);
    assert!(manifest
        .projections
        .iter()
        .all(|p| p.projection != Projection::Curated));
    assert!(manifest
        .never
        .iter()
        .all(|n| n.file != openblog_core::curated_selection::SELECTIONS_FILE));
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

// ---------------------------------------------------------------- review fixes (#192)

fn mutate<'a>(set: &'a mut SelectionSet, id: &str) -> &'a mut Selection {
    set.selections.iter_mut().find(|s| s.id == id).unwrap()
}

fn why_of(resolution: &openblog_core::curated_selection::Resolution, id: &str) -> Why {
    resolution
        .withheld
        .iter()
        .find(|w| w.id == id)
        .unwrap_or_else(|| panic!("{id} is not withheld"))
        .why
}

#[test]
fn a_reference_or_annotation_may_select_only_a_source_that_is_already_public() {
    let w = world();
    assert!(!w.public_sources.contains("diary"));
    let mut set = SelectionSet::default();
    for (kind, text) in [
        (SelectionKind::Reference, None),
        (SelectionKind::SourceAnnotation, Some("A comment.")),
    ] {
        let problems = set
            .select(
                NewSelection {
                    text: text.map(Into::into),
                    by: text.map(|_| "The author".into()),
                    ..pick(kind, "diary")
                },
                &w.basis(),
            )
            .unwrap_err();
        assert_eq!(problems[0].code, Code::TargetNotPublished, "{kind:?}");
        assert!(problems[0].message.contains("stays private"));
        assert!(!problems[0].message.contains(PRIVATE));
    }
    assert!(set.selections.is_empty());
    // Public through any of the three routes it is selectable.
    for target in ["scholar", "grube", "undated"] {
        assert!(w.public_sources.contains(target), "{target}");
        set.select(pick(SelectionKind::Reference, target), &w.basis())
            .unwrap();
    }

    // A source that stops being public withholds the selection, naming the
    // rule, and nothing is published of it.
    let mut stored = set.clone();
    let mut later = w.public_sources.clone();
    later.remove("undated");
    let basis = openblog_core::curated_selection::Basis {
        public_sources: Some(&later),
        ..w.basis()
    };
    let resolution = resolve(&stored, &basis);
    let id = stored
        .selections
        .iter()
        .find(|s| s.target == "undated")
        .unwrap()
        .id
        .clone();
    assert_eq!(why_of(&resolution, &id), Why::SourcePrivate);
    assert!(resolution
        .curation
        .items
        .iter()
        .all(|i| i.target != "undated"));
    // With no known public sources nothing of a library is selectable.
    let nothing = openblog_core::curated_selection::Basis {
        public_sources: None,
        ..w.basis()
    };
    assert!(stored
        .select(pick(SelectionKind::Reference, "burnet"), &nothing)
        .is_err());
}

#[test]
fn caveats_that_are_not_withheld_fields_travel_with_the_published_item() {
    let w = world();
    let mut set = SelectionSet::default();
    let dating = select(&mut set, &w, pick(SelectionKind::Timeline, "plato-birth-a"));
    let reference = select(
        &mut set,
        &w,
        NewSelection {
            optional_fields: vec!["issued".into()],
            ..pick(SelectionKind::Reference, "undated")
        },
    );
    let resolution = resolve(&set, &w.basis());
    let item = |id: &str| {
        resolution
            .curation
            .items
            .iter()
            .find(|i| i.id == id)
            .unwrap()
    };
    let codes = |id: &str| -> Vec<NoticeCode> { item(id).notices.iter().map(|n| n.code).collect() };
    assert_eq!(codes(&dating), vec![NoticeCode::CompetingUnselected]);
    assert!(item(&dating).notices[0].message.contains("plato-birth-b"));
    assert!(codes(&reference).contains(&NoticeCode::MissingDetail));
    assert!(codes(&reference).contains(&NoticeCode::ProvenanceUnrecorded));
    // The withheld-field notices are not repeated on the item.
    let mut with_identifiers = SelectionSet::default();
    select(
        &mut with_identifiers,
        &w,
        NewSelection {
            optional_fields: vec!["identifiers".into()],
            ..pick(SelectionKind::Reference, "republic")
        },
    );
    let resolution = resolve(&with_identifiers, &w.basis());
    assert!(resolution.curation.items[0]
        .notices
        .iter()
        .all(|n| n.code.travels_with_item()));
    assert!(!serde_json::to_string(&resolution.curation.items)
        .unwrap()
        .contains("localhost"));
}

#[test]
fn the_manifest_lists_the_caveats_and_a_competing_dating_is_a_boundary_warning() {
    let w = world();
    let mut set = SelectionSet::default();
    select(&mut set, &w, pick(SelectionKind::Timeline, "plato-birth-a"));
    let resolution = resolve(&set, &w.basis());
    let curation = CurationInput {
        set: &set,
        resolution: &resolution,
    };
    let inputs = BoundaryInputs {
        switches: Switches {
            curated: true,
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
        curation: Some(&curation),
        unavailable: &[],
        author: "",
        base_path: "",
    };
    let manifest = BoundaryManifest::site(&inputs);
    let report = manifest
        .projections
        .iter()
        .find(|p| p.projection == Projection::Curated)
        .unwrap();
    let item = report
        .published
        .iter()
        .find(|i| i.kind == ItemKind::Selection)
        .unwrap();
    assert_eq!(item.notices.len(), 1);
    let json = serde_json::to_value(item).unwrap();
    assert_eq!(json["notices"][0]["code"], json!("competing-unselected"));
    assert!(manifest
        .build_warnings()
        .iter()
        .any(|w| w.starts_with("boundary: ") && w.contains("plato-birth-b")));
    // The switch off: no curated projection and no mention of the file.
    let off = BoundaryManifest::site(&BoundaryInputs {
        switches: Switches::default(),
        ..inputs
    });
    assert!(off
        .projections
        .iter()
        .all(|p| p.projection != Projection::Curated));
    assert!(off
        .never
        .iter()
        .all(|n| n.file != openblog_core::curated_selection::SELECTIONS_FILE));
}

#[test]
fn a_selection_is_for_the_site_or_for_named_published_posts_in_the_author_s_order() {
    let at = |pairs: &[(&str, u32)]| -> BTreeMap<String, u32> {
        pairs.iter().map(|(p, n)| (p.to_string(), *n)).collect()
    };
    let w = world();
    let mut set = SelectionSet::default();
    let site_wide = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );
    let third = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            positions: at(&[("cave", 3)]),
            ..pick(SelectionKind::ContextualEntry, "plato")
        },
    );
    let first = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["cave".into(), "other".into()]),
            positions: at(&[("cave", 1), ("other", 2)]),
            ..pick(SelectionKind::Reference, "scholar")
        },
    );
    let unplaced = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            ..pick(SelectionKind::ContextualEntry, "republic")
        },
    );
    let elsewhere = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["other".into()]),
            positions: at(&[("other", 1)]),
            ..pick(SelectionKind::Reference, "undated")
        },
    );
    let resolution = resolve(&set, &w.basis());
    // Whole-site items first, then by (first post, position, id).
    let order: Vec<&str> = resolution
        .curation
        .items
        .iter()
        .map(|i| i.id.as_str())
        .collect();
    assert_eq!(
        order,
        vec![
            site_wide.as_str(),
            first.as_str(),
            third.as_str(),
            unplaced.as_str(),
            elsewhere.as_str()
        ]
    );
    let ids = |post: &str| -> Vec<&str> {
        resolution
            .curation
            .for_post(post)
            .iter()
            .map(|i| i.id.as_str())
            .collect()
    };
    // A post gets the whole-site items and its own, by position then id; an
    // unpositioned item is last.
    assert_eq!(
        ids("cave"),
        vec![
            first.as_str(),
            third.as_str(),
            site_wide.as_str(),
            unplaced.as_str()
        ]
    );
    // A shared item has a place per post: it is second for "other".
    assert_eq!(
        ids("other"),
        vec![elsewhere.as_str(), first.as_str(), site_wide.as_str()]
    );
    assert_eq!(ids("none").len(), 1, "only the whole-site item");
    // Deterministic whatever the order of the file.
    let mut shuffled = set.clone();
    shuffled.selections.reverse();
    assert_eq!(
        serde_json::to_string(&resolve(&shuffled, &w.basis()).curation).unwrap(),
        serde_json::to_string(&resolution.curation).unwrap()
    );
}

#[test]
fn a_record_without_posts_or_positions_is_site_wide_and_written_unchanged() {
    let w = world();
    let mut set = SelectionSet::default();
    select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let text = set.to_json();
    assert!(
        !text.contains("posts") && !text.contains("position"),
        "{text}"
    );
    let parsed = SelectionSet::parse(&text).unwrap();
    assert_eq!(parsed.selections[0].posts, None);
    assert_eq!(parsed.to_json(), text, "byte for byte");
    let resolution = resolve(&parsed, &w.basis());
    let item = &resolution.curation.items[0];
    assert!(item.posts.is_empty() && item.positions.is_empty());
    let json = serde_json::to_value(item).unwrap();
    assert!(json.get("posts").is_none() && json.get("positions").is_none());
    assert_eq!(resolution.curation.for_post("any-post").len(), 1);
}

#[test]
fn a_selection_never_names_a_post_the_build_does_not_publish() {
    let w = world();
    let mut set = SelectionSet::default();
    let id = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["cave".into(), "secret-draft".into()]),
            ..pick(SelectionKind::ContextualEntry, "plato")
        },
    );
    let resolution = resolve(&set, &w.basis());
    assert_eq!(resolution.curation.items[0].posts, vec!["cave"]);
    assert!(!serde_json::to_string(&resolution.curation)
        .unwrap()
        .contains("secret-draft"));
    // When none of its posts is published it publishes nothing at all.
    let mut drafts = BTreeSet::new();
    drafts.insert("another".to_string());
    let basis = openblog_core::curated_selection::Basis {
        posts: Some(&drafts),
        ..w.basis()
    };
    let resolution = resolve(&set, &basis);
    assert!(resolution.curation.items.is_empty());
    assert_eq!(why_of(&resolution, &id), Why::PostNotPublished);
    assert!(!resolution.withheld[0].message.contains("secret-draft"));
    // And with no known published post, a scoped selection waits.
    let none = openblog_core::curated_selection::Basis {
        posts: None,
        ..w.basis()
    };
    assert!(resolve(&set, &none).curation.items.is_empty());

    for bad in [
        vec![],
        vec!["a".to_string(), "a".to_string()],
        vec!["../x".to_string()],
    ] {
        let problems = SelectionSet::default()
            .select(
                NewSelection {
                    posts: Some(bad),
                    ..pick(SelectionKind::ContextualEntry, "plato")
                },
                &w.basis(),
            )
            .unwrap_err();
        assert_eq!(problems[0].code, Code::BadPosts);
    }
}

#[test]
fn the_revision_covers_every_choice_the_author_made() {
    let w = world();
    let mut set = SelectionSet::default();
    let id = select(
        &mut set,
        &w,
        NewSelection {
            optional_fields: vec!["summary".into()],
            ..pick(SelectionKind::ContextualEntry, "plato")
        },
    );
    let other = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );
    assert!(resolve(&set, &w.basis()).withheld.is_empty());
    type Edit = Box<dyn Fn(&mut Selection)>;
    let edits: Vec<(&str, Edit)> = vec![
        ("fields", Box::new(|s| s.fields.retain(|f| f != "summary"))),
        (
            "provenance",
            Box::new(|s| s.provenance = Provenance::Authored),
        ),
        ("requires", Box::new(|s| s.requires = vec!["other".into()])),
        ("posts", Box::new(|s| s.posts = Some(vec!["cave".into()]))),
    ];
    for (name, edit) in edits {
        let mut changed = set.clone();
        edit(mutate(&mut changed, &id));
        let resolution = resolve(&changed, &w.basis());
        assert_eq!(why_of(&resolution, &id), Why::Stale, "{name}");
    }
    // The pairs are explicit and length-prefixed: moving a character between
    // two chosen values changes the revision.
    let mut a = set.clone();
    mutate(&mut a, &other).requires = vec![id.clone()];
    a.reselect(&other, &w.basis()).unwrap();
    let mut b = set.clone();
    mutate(&mut b, &other).posts = Some(vec![id.clone()]);
    b.reselect(&other, &w.basis()).unwrap();
    assert_ne!(
        a.get(&other).unwrap().revision,
        b.get(&other).unwrap().revision
    );
}

#[test]
fn an_unlisted_locator_is_dropped_and_a_listed_one_is_published_and_revision_checked() {
    let w = world();
    let mut set = SelectionSet::default();
    let plain = select(
        &mut set,
        &w,
        NewSelection {
            text: Some("A comment.".into()),
            by: Some("The author".into()),
            locator: Some("514a".into()),
            ..pick(SelectionKind::SourceAnnotation, "burnet")
        },
    );
    let with = select(
        &mut set,
        &w,
        NewSelection {
            id: Some("annotation-located".into()),
            optional_fields: vec!["locator".into()],
            text: Some("A comment.".into()),
            by: Some("The author".into()),
            locator: Some("514a".into()),
            ..pick(SelectionKind::SourceAnnotation, "burnet")
        },
    );
    let resolution = resolve(&set, &w.basis());
    let content = |id: &str| {
        &resolution
            .curation
            .items
            .iter()
            .find(|i| i.id == id)
            .unwrap()
            .content
    };
    assert!(!content(&plain).contains_key("locator"));
    assert_eq!(content(&with)["locator"], json!("514a"));
    // An unlisted locator is not part of the revision; a listed one is.
    mutate(&mut set, &plain).locator = Some("515b".into());
    mutate(&mut set, &with).locator = Some("515b".into());
    let resolution = resolve(&set, &w.basis());
    assert!(resolution.withheld.iter().all(|h| h.id != plain));
    assert_eq!(why_of(&resolution, &with), Why::Stale);
}

#[test]
fn a_relationship_owned_dating_names_a_relationship_not_an_entry() {
    let mut atlas = atlas_value();
    atlas["relationships"][1]["dates"] = json!([dating("member-span", "span", -387, "scholar")]);
    let w = world_with(&library_value(), &atlas);
    let mut set = SelectionSet::default();
    let id = select(&mut set, &w, pick(SelectionKind::Timeline, "member-span"));
    let resolution = resolve(&set, &w.basis());
    let kinds: Vec<(ContextKind, &str)> = resolution
        .curation
        .context
        .iter()
        .map(|c| (c.kind, c.id.as_str()))
        .collect();
    assert!(
        kinds.contains(&(ContextKind::Relationship, "r-member")),
        "{kinds:?}"
    );
    assert!(kinds.contains(&(ContextKind::Entry, "plato")));
    // Taking the relationship away says "relationship", not "entry".
    let mut hidden = atlas.clone();
    hidden["relationships"][1]["visibility"] = json!("private");
    let h = world_with(&library_value(), &hidden);
    let resolution = resolve(&set, &h.basis());
    assert!(resolution.curation.items.is_empty());
    let message = &resolution
        .withheld
        .iter()
        .find(|w| w.id == id)
        .unwrap()
        .message;
    assert!(!message.contains("entry `r-member`"), "{message}");
}

#[test]
fn a_store_that_was_not_read_is_not_published_never_missing() {
    let w = world();
    let mut set = SelectionSet::default();
    for (kind, target) in [
        (SelectionKind::ContextualEntry, "plato"),
        (SelectionKind::Relationship, "r-authored"),
        (SelectionKind::Timeline, "plato-birth-a"),
        (SelectionKind::Comparison, "cave"),
        (SelectionKind::Reference, "scholar"),
    ] {
        select(&mut set, &w, pick(kind, target));
    }
    // Nothing was read: not the atlas, not the alignments, not the library.
    let none = Existing::of(None, None);
    let basis = openblog_core::curated_selection::Basis {
        existing: Some(&none),
        ..Basis::default()
    };
    let resolution = resolve(&set, &basis);
    assert_eq!(resolution.withheld.len(), 5);
    assert!(
        resolution
            .withheld
            .iter()
            .all(|h| h.why == Why::NotPublished),
        "{:?}",
        resolution.withheld
    );
    // One store read and another not: each is told on its own.
    let atlas_only = Existing::of(Some(&w.atlas), None);
    let basis = openblog_core::curated_selection::Basis {
        existing: Some(&atlas_only),
        library: Some(&w.library),
        ..Basis::default()
    };
    let resolution = resolve(&set, &basis);
    let why = |target: &str| {
        resolution
            .withheld
            .iter()
            .find(|h| h.target == target)
            .unwrap()
            .why
    };
    assert_eq!(why("plato"), Why::NotApproved, "read, and exists");
    assert_eq!(why("cave"), Why::NotPublished, "alignments not read");
    // Deleted from a store that was read is missing.
    let mut gone = atlas_value();
    gone["entries"].as_array_mut().unwrap().remove(0);
    gone["relationships"] = json!([]);
    let g = world_with(&library_value(), &gone);
    let existing = Existing::of(Some(&g.atlas), None);
    let basis = openblog_core::curated_selection::Basis {
        existing: Some(&existing),
        ..Basis::default()
    };
    let resolution = resolve(&set, &basis);
    assert_eq!(
        resolution
            .withheld
            .iter()
            .find(|h| h.target == "plato")
            .unwrap()
            .why,
        Why::TargetMissing
    );
}

#[test]
fn derived_ids_never_collide_and_stay_slugs() {
    // Two long source ids that differ only at the end: the readable form is
    // cut at the id limit, so only the appended hash tells them apart.
    let (long_a, long_b) = (
        format!("{}a", "q".repeat(63)),
        format!("{}b", "q".repeat(63)),
    );
    let mut library = library_value();
    library["sources"].as_array_mut().unwrap().extend([
        json!({"id": long_a, "kind": "work", "title": "One"}),
        json!({"id": long_b, "kind": "work", "title": "Two"}),
    ]);
    let w = world_with(&library, &atlas_value());
    let mut public = w.public_sources.clone();
    public.extend([long_a.clone(), long_b.clone()]);
    let basis = openblog_core::curated_selection::Basis {
        public_sources: Some(&public),
        ..w.basis()
    };
    let mut set = SelectionSet::default();
    let one = set
        .select(pick(SelectionKind::Reference, &long_a), &basis)
        .unwrap();
    let two = set
        .select(pick(SelectionKind::Reference, &long_b), &basis)
        .unwrap();
    assert_ne!(one, two, "the same readable form, different ids");
    // Deterministic, and the same kind of id for a short target.
    let again = SelectionSet::default()
        .select(pick(SelectionKind::Reference, &long_a), &basis)
        .unwrap();
    assert_eq!(one, again);
    let short = set
        .select(pick(SelectionKind::Reference, "scholar"), &basis)
        .unwrap();
    assert!(short.starts_with("reference-scholar-"), "{short}");
    for id in [&one, &two, &short] {
        assert!(
            id.len() <= 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && !id.starts_with('-')
                && !id.contains("--"),
            "{id}"
        );
    }
    SelectionSet::parse(&set.to_json()).unwrap();
}

#[test]
fn contributor_credits_stay_in_sidecars_in_every_store_including_this_one() {
    let w = world();
    let mut set = SelectionSet::default();
    select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    for key in ["credit", "credits", "contributor", "contributors"] {
        let mut record: Value = serde_json::from_str(&set.to_json()).unwrap();
        record["selections"][0][key] = json!([{"name": format!("{PRIVATE} person")}]);
        let problems = SelectionSet::parse(&record.to_string()).unwrap_err();
        assert!(
            problems
                .iter()
                .any(|p| p.code == Code::ContributorCredit && p.field.as_deref() == Some(key)),
            "{key}: {problems:?}"
        );
        assert!(problems.iter().all(|p| !p.message.contains(PRIVATE)));
        let mut root: Value = serde_json::from_str(&set.to_json()).unwrap();
        root[key] = json!("someone");
        assert!(SelectionSet::parse(&root.to_string())
            .unwrap_err()
            .iter()
            .any(|p| p.code == Code::ContributorCredit));
    }
}

#[test]
fn requires_is_capped_and_a_hostile_file_resolves_in_linear_time() {
    use openblog_core::curated_selection::MAX_REQUIRES;
    let w = world();
    let mut record = SelectionSet::default();
    let id = select(
        &mut record,
        &w,
        pick(SelectionKind::ContextualEntry, "plato"),
    );
    mutate(&mut record, &id).requires = (0..=MAX_REQUIRES).map(|n| format!("r{n}")).collect();
    let problems = SelectionSet::parse(&record.to_json()).unwrap_err();
    assert!(problems.iter().any(|p| p.code == Code::BadRequires));

    // 5,000 current selections, each requiring the next 32 (the most the cap
    // allows).
    let count = openblog_core::curated_selection::MAX_SELECTIONS;
    let chain = |closed: bool| {
        let mut set = SelectionSet::default();
        let mut template = {
            let mut one = SelectionSet::default();
            select(&mut one, &w, pick(SelectionKind::ContextualEntry, "plato"));
            one.selections.remove(0)
        };
        for i in 0..count {
            template.id = format!("s{i}");
            template.requires = (1..=MAX_REQUIRES)
                .filter_map(|d| {
                    let next = i + d;
                    if next < count {
                        Some(next)
                    } else {
                        closed.then_some(next % count)
                    }
                })
                .filter(|next| *next != i)
                .map(|n| format!("s{n}"))
                .collect();
            // Requirements are part of what was selected: record the revision.
            let mut probe = SelectionSet::default();
            probe.selections.push(template.clone());
            probe.reselect(&template.id, &w.basis()).unwrap();
            template.revision = probe.selections[0].revision.clone();
            set.selections.push(template.clone());
        }
        set.selections.sort_by(|a, b| a.id.cmp(&b.id));
        SelectionSet::parse(&set.to_json()).unwrap()
    };
    let within = std::time::Duration::from_secs(5);

    // An open chain whose last selection is withdrawn: each of the others is
    // withheld in turn, however far back the chain goes.
    let mut open = chain(false);
    mutate(&mut open, &format!("s{}", count - 1)).state =
        openblog_core::curated_selection::SelectionState::Withdrawn;
    let started = std::time::Instant::now();
    let resolution = resolve(&open, &w.basis());
    assert!(started.elapsed() < within, "{:?}", started.elapsed());
    assert_eq!(resolution.withheld.len(), count);
    assert!(resolution.curation.items.is_empty());
    assert_eq!(
        resolution
            .withheld
            .iter()
            .filter(|h| h.why == Why::DependencyWithheld)
            .count(),
        count - 1
    );

    // The same chain closed into one component of 5,000 selections.
    let closed = chain(true);
    let started = std::time::Instant::now();
    let resolution = resolve(&closed, &w.basis());
    assert!(started.elapsed() < within, "{:?}", started.elapsed());
    assert_eq!(resolution.withheld.len(), count);
    assert!(resolution.withheld.iter().all(|h| h.why == Why::Cycle));
}

#[test]
fn cycles_are_exactly_the_components_of_more_than_one_selection_and_self_loops() {
    // Real revisions, so that nothing is withheld as stale first.
    let w = world();
    let mut set = SelectionSet::default();
    let ids: Vec<String> = ["plato", "republic", "academy"]
        .iter()
        .map(|t| select(&mut set, &w, pick(SelectionKind::ContextualEntry, t)))
        .collect();
    let (a, b, c) = (&ids[0], &ids[1], &ids[2]);
    // a -> b -> a is a cycle; c -> a only depends on it; a self-loop is
    // refused in the file but still a cycle if one were ever present.
    mutate(&mut set, a).requires = vec![b.clone()];
    mutate(&mut set, b).requires = vec![a.clone()];
    mutate(&mut set, c).requires = vec![a.clone()];
    for id in &ids {
        set.reselect(id, &w.basis()).unwrap();
    }
    let resolution = resolve(&set, &w.basis());
    assert_eq!(why_of(&resolution, a), Why::Cycle);
    assert_eq!(why_of(&resolution, b), Why::Cycle);
    assert_eq!(why_of(&resolution, c), Why::DependencyWithheld);

    let mut looped = SelectionSet::default();
    let s = select(
        &mut looped,
        &w,
        pick(SelectionKind::ContextualEntry, "plato"),
    );
    mutate(&mut looped, &s).requires = vec![s.clone()];
    looped.reselect(&s, &w.basis()).unwrap();
    assert_eq!(why_of(&resolve(&looped, &w.basis()), &s), Why::Cycle);
}

#[test]
fn reordering_never_refreshes_a_stale_selection() {
    let w = world();
    let mut set = SelectionSet::default();
    let id = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    set.rescope(&id, Some(vec!["cave".into()]), &w.basis())
        .unwrap();
    set.order_for_post("cave", std::slice::from_ref(&id), &w.basis())
        .unwrap();
    let kept = set.get(&id).unwrap().clone();
    assert_eq!(
        (kept.posts.clone(), kept.positions.get("cave").copied()),
        (Some(vec!["cave".into()]), Some(1))
    );
    assert!(
        resolve(&set, &w.basis()).withheld.is_empty(),
        "revision followed the scope"
    );
    // The research changes: the selection is stale, and moving it is refused.
    let mut atlas = atlas_value();
    atlas["entries"][0]["summary"] = json!("A different summary.");
    let changed = world_with(&library_value(), &atlas);
    let before = set.clone();
    let problems = set
        .order_for_post("cave", std::slice::from_ref(&id), &changed.basis())
        .unwrap_err();
    assert_eq!(problems[0].code, Code::StaleSelection);
    assert_eq!(set, before, "nothing changed");
    assert_eq!(
        why_of(&resolve(&set, &changed.basis()), &id),
        Why::Stale,
        "still withheld"
    );
    // Selecting it again is the author's act of checking.
    set.reselect(&id, &changed.basis()).unwrap();
    set.rescope(&id, None, &changed.basis()).unwrap();
    assert_eq!(
        set.get(&id).unwrap().positions.get("cave").copied(),
        Some(1),
        "a whole-site selection keeps the place it had in a post"
    );
    assert!(
        set.rescope("nope", None, &changed.basis()).unwrap_err()[0].code == Code::UnknownSelection
    );
}

#[test]
fn a_selections_copy_is_recognised_as_private_research_by_structure() {
    let w = world();
    let mut set = SelectionSet::default();
    select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let root = |text: &str| -> serde_json::Map<String, Value> {
        serde_json::from_str::<Value>(text)
            .unwrap()
            .as_object()
            .unwrap()
            .clone()
    };
    assert!(openblog_core::curated_selection::looks_like_selections(
        &root(&set.to_json())
    ));
    assert!(openblog_core::research_bundle::looks_like_private_research(
        set.to_json().as_bytes()
    ));
    for harmless in [
        r#"{"version":1,"selections":[]}"#,
        r#"{"version":1,"selections":[{"id":"x","title":"a layout"}]}"#,
        r#"{"selections":[{"id":"a","kind":"b","target":"c","revision":"d"}]}"#,
        r#"{"version":1,"selections":"none"}"#,
    ] {
        assert!(
            !openblog_core::research_bundle::looks_like_private_research(harmless.as_bytes()),
            "{harmless}"
        );
    }
}

// ---------------------------------------------------------------- the author's view, shared with the Admin tests

fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/curated-selections")
        .join(name)
}

fn check_fixture(name: &str, actual: &str) {
    let path = fixture_path(name);
    if std::env::var_os("OPENBLOG_UPDATE_FIXTURES").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual).unwrap();
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    assert_eq!(
        expected, actual,
        "{name} is out of date; rerun with OPENBLOG_UPDATE_FIXTURES=1"
    );
}

/// One set that shows every state the author's view has to tell apart: a
/// published relationship with its context, an entry with a chosen field, a
/// dating whose rival is not selected, a reference with a missing detail and
/// no recorded origin, an annotation for another post, a stale selection, a
/// withdrawn one, and an unpositioned whole-site entry.
fn view_set(w: &World) -> SelectionSet {
    let mut set = SelectionSet::default();
    let place = |set: &mut SelectionSet, new: NewSelection, id: &str| {
        let id = id.to_string();
        set.select(
            NewSelection {
                id: Some(id.clone()),
                ..new
            },
            &w.basis(),
        )
        .unwrap();
        id
    };
    place(
        &mut set,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            positions: BTreeMap::from([("cave".to_string(), 1)]),
            ..pick(SelectionKind::Relationship, "r-authored")
        },
        "relationship-authored",
    );
    place(
        &mut set,
        NewSelection {
            optional_fields: vec!["summary".into()],
            posts: Some(vec!["cave".into()]),
            positions: BTreeMap::from([("cave".to_string(), 2)]),
            ..pick(SelectionKind::ContextualEntry, "plato")
        },
        "entry-plato",
    );
    place(
        &mut set,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            positions: BTreeMap::from([("cave".to_string(), 3)]),
            ..pick(SelectionKind::Timeline, "plato-birth-a")
        },
        "dating-birth-a",
    );
    place(
        &mut set,
        NewSelection {
            optional_fields: vec!["issued".into()],
            posts: Some(vec!["cave".into()]),
            ..pick(SelectionKind::Reference, "undated")
        },
        "reference-undated",
    );
    place(
        &mut set,
        NewSelection {
            text: Some("A comment for another post.".into()),
            by: Some("The author".into()),
            posts: Some(vec!["other".into()]),
            ..pick(SelectionKind::SourceAnnotation, "burnet")
        },
        "annotation-other",
    );
    place(
        &mut set,
        pick(SelectionKind::ContextualEntry, "academy"),
        "entry-academy",
    );
    let stale = place(
        &mut set,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            ..pick(SelectionKind::ContextualEntry, "republic")
        },
        "entry-republic",
    );
    mutate(&mut set, &stale).revision = "0123456789abcdef".into();
    let withdrawn = place(
        &mut set,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            ..pick(SelectionKind::Comparison, "cave")
        },
        "comparison-cave",
    );
    set.withdraw(&withdrawn, Some("rethinking the wording".into()));
    set
}

#[test]
fn the_authors_view_matches_the_shared_fixture_and_shows_only_public_items() {
    let w = world();
    let set = view_set(&w);
    let resolution = resolve(&set, &w.basis());
    let revision = "f".repeat(64);
    let view = openblog_core::curated_selection::curation_view(
        &set,
        &resolution,
        &w.basis(),
        Some("cave"),
        &revision,
        true,
        false,
    );
    let mut text = serde_json::to_string_pretty(&view).unwrap();
    text.push('\n');
    check_fixture("view.json", &text);
    assert!(!text.contains(PRIVATE), "nothing private reaches the view");
    // Readers of the post get the whole-site entry last (unpositioned) after
    // this post's positioned items, in the author's order.
    let order: Vec<&str> = view.preview.items.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(
        order,
        [
            "relationship-authored",
            "entry-plato",
            "dating-birth-a",
            "entry-academy",
            "reference-undated"
        ]
    );
    // The annotation for another post is listed, not previewed.
    let other = view
        .selections
        .iter()
        .find(|s| s.id == "annotation-other")
        .unwrap();
    assert!(!other.applies_to_post);
    assert!(!serde_json::to_string(&view.preview)
        .unwrap()
        .contains("another post"));
    // The preview is the public value, not a second rendering of it.
    let public = serde_json::to_value(resolution.curation.view_for(Some("cave"))).unwrap();
    assert_eq!(serde_json::to_value(&view.preview).unwrap(), public);
}

#[test]
fn ordering_one_post_never_reorders_another_even_for_a_shared_whole_site_item() {
    let w = world();
    let mut set = SelectionSet::default();
    let shared = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let a = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["cave".into()]),
            ..pick(SelectionKind::ContextualEntry, "republic")
        },
    );
    let b = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["other".into()]),
            ..pick(SelectionKind::ContextualEntry, "academy")
        },
    );
    let ids = |set: &SelectionSet, post: &str| -> Vec<String> {
        resolve(set, &w.basis())
            .curation
            .for_post(post)
            .iter()
            .map(|i| i.id.clone())
            .collect()
    };
    // The author puts the shared item first for "cave".
    set.order_for_post("cave", &[shared.clone(), a.clone()], &w.basis())
        .unwrap();
    assert_eq!(ids(&set, "cave"), [shared.clone(), a.clone()]);
    // Then puts it last for "other".
    set.order_for_post("other", &[b.clone(), shared.clone()], &w.basis())
        .unwrap();
    assert_eq!(ids(&set, "other"), [b.clone(), shared.clone()]);
    assert_eq!(
        ids(&set, "cave"),
        [shared.clone(), a.clone()],
        "ordering `other` left `cave` as the author set it"
    );
    // Reversing `cave` does not move anything in `other`.
    set.order_for_post("cave", &[a.clone(), shared.clone()], &w.basis())
        .unwrap();
    assert_eq!(ids(&set, "cave"), [a.clone(), shared.clone()]);
    assert_eq!(ids(&set, "other"), [b.clone(), shared.clone()]);
    let item = set.get(&shared).unwrap();
    assert_eq!(item.positions.get("cave"), Some(&2));
    assert_eq!(item.positions.get("other"), Some(&2));
    // Order is not content: no selection became stale.
    assert!(resolve(&set, &w.basis()).withheld.is_empty());
}

#[test]
fn ordering_keeps_places_of_items_left_out_unique_and_refuses_what_is_not_offered() {
    let w = world();
    let mut set = SelectionSet::default();
    let one = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    let two = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "republic"),
    );
    let three = select(
        &mut set,
        &w,
        pick(SelectionKind::ContextualEntry, "academy"),
    );
    let elsewhere = select(
        &mut set,
        &w,
        NewSelection {
            posts: Some(vec!["other".into()]),
            ..pick(SelectionKind::Reference, "scholar")
        },
    );
    set.order_for_post(
        "cave",
        &[one.clone(), two.clone(), three.clone()],
        &w.basis(),
    )
    .unwrap();
    // `two` is withheld, so a later ordering lists the other two only.
    set.withdraw(&two, None);
    set.order_for_post("cave", &[three.clone(), one.clone()], &w.basis())
        .unwrap();
    let places: Vec<(&str, u32)> = [&three, &one, &two]
        .iter()
        .map(|id| (id.as_str(), set.get(id).unwrap().positions["cave"]))
        .collect();
    assert_eq!(
        places.iter().map(|(_, n)| *n).collect::<Vec<_>>(),
        [1, 2, 3],
        "the withheld item keeps a unique place after the listed ones: {places:?}"
    );
    // A selection for another post has no place among this post's items.
    let before = set.clone();
    let problems = set
        .order_for_post("cave", std::slice::from_ref(&elsewhere), &w.basis())
        .unwrap_err();
    assert_eq!(problems[0].code, Code::BadPosts);
    assert_eq!(set, before, "all or nothing");
    assert!(set
        .order_for_post("cave", &["nope".to_string()], &w.basis())
        .is_err());
    // Narrowing a selection's scope drops the places it no longer needs.
    set.rescope(&one, Some(vec!["other".into()]), &w.basis())
        .unwrap();
    assert!(set.get(&one).unwrap().positions.is_empty());
    // A record that places a scoped selection in a post it is not for, or
    // names a path, is refused when read.
    for bad in [r#"{"cave":1,"other":2}"#, r#"{"../x":1}"#] {
        let text = set.to_json().replace(
            &format!("\"id\": \"{one}\""),
            &format!("\"id\": \"{one}\", \"positions\": {bad}"),
        );
        let parsed = SelectionSet::parse(&text);
        assert!(parsed.is_err(), "{bad}");
    }
}

#[test]
fn a_public_item_names_only_published_posts_in_its_positions() {
    let w = world();
    let mut set = SelectionSet::default();
    let shared = select(&mut set, &w, pick(SelectionKind::ContextualEntry, "plato"));
    mutate(&mut set, &shared)
        .positions
        .extend([("cave".to_string(), 1), ("secret-draft".to_string(), 2)]);
    let resolution = resolve(&set, &w.basis());
    let item = &resolution.curation.items[0];
    assert_eq!(item.positions.keys().collect::<Vec<_>>(), ["cave"]);
    let text = serde_json::to_string(&resolution.curation).unwrap();
    assert!(
        !text.contains("secret-draft"),
        "a draft slug is not disclosed"
    );
}

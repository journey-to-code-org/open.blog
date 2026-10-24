use std::collections::BTreeMap;

use openblog_core::source_library::{
    SourceDiagnostic, SourceDiagnosticCode, SourceKind, SourceLibrary, MAX_LIBRARY_BYTES,
    MAX_SOURCES,
};
use openblog_core::{classify_source, contributor, SiteConfig};

const LIBRARY: &str = r#"{
  "version": 1,
  "exportedBy": {"tool": "future-open.blog", "build": 7},
  "sources": [
    {
      "id": "plato-republic",
      "kind": "work",
      "title": "Πολιτεία",
      "creators": [{"name": "Plato", "role": "author", "sortName": "Plato"}],
      "language": "grc",
      "issued": "c. 375 BCE",
      "subjects": ["justice", "the city"]
    },
    {
      "id": "republic-slings-2003",
      "kind": "edition",
      "of": "plato-republic",
      "title": "Platonis Rempublicam",
      "creators": [{"name": "S. R. Slings", "role": "editor"}],
      "issued": "2003",
      "identifiers": [{"scheme": "isbn", "value": "978-0-19-924849-0", "note": "OCT"}],
      "publisher": {"name": "Oxford University Press"}
    },
    {
      "id": "republic-bloom",
      "kind": "translation",
      "of": "plato-republic",
      "basedOn": "republic-slings-2003",
      "title": "The Republic of Plato",
      "language": "en",
      "creators": [{"name": "Allan Bloom", "role": "translator"}]
    },
    {
      "id": "paris-gr-1807",
      "kind": "witness",
      "of": "plato-republic",
      "title": "Paris, Bibliothèque nationale de France, gr. 1807",
      "identifiers": [{"scheme": "url", "value": "https://gallica.bnf.fr/ark:/12148/btv1b10721251j"}],
      "medium": "parchment"
    },
    {
      "id": "cave-allegory",
      "kind": "reference",
      "of": "republic-slings-2003",
      "location": {"scheme": "canonical", "value": "514a–520a", "system": "Stephanus"},
      "readerFacing": false
    }
  ]
}"#;

fn no_contributors() -> BTreeMap<String, openblog_core::contributor::Contributor> {
    BTreeMap::new()
}

#[test]
fn round_trip_preserves_entity_identity_kind_order_and_unknown_fields() {
    let library = SourceLibrary::parse(LIBRARY, &no_contributors()).unwrap();
    let ids: Vec<(&str, SourceKind)> = library
        .sources
        .iter()
        .map(|source| (source.id.as_str(), source.kind))
        .collect();
    assert_eq!(
        ids,
        [
            ("plato-republic", SourceKind::Work),
            ("republic-slings-2003", SourceKind::Edition),
            ("republic-bloom", SourceKind::Translation),
            ("paris-gr-1807", SourceKind::Witness),
            ("cave-allegory", SourceKind::Reference),
        ]
    );

    let written = library.to_json();
    let reparsed = SourceLibrary::parse(&written, &no_contributors()).unwrap();
    assert_eq!(reparsed, library);
    assert_eq!(
        reparsed.to_json(),
        written,
        "serialization is deterministic"
    );

    let original: serde_json::Value = serde_json::from_str(LIBRARY).unwrap();
    let round_tripped: serde_json::Value = serde_json::from_str(&written).unwrap();
    assert_eq!(
        round_tripped, original,
        "no authored field is lost or added"
    );
    assert!(written.contains("Πολιτεία") && written.ends_with("}\n"));
}

fn library(sources: &str) -> String {
    format!(r#"{{"version":1,"sources":[{sources}]}}"#)
}

fn diagnostics(text: &str) -> Vec<SourceDiagnostic> {
    SourceLibrary::parse(text, &no_contributors()).unwrap_err()
}

fn only(text: &str) -> SourceDiagnostic {
    let mut found = diagnostics(text);
    assert_eq!(found.len(), 1, "expected one diagnostic, got {found:#?}");
    found.remove(0)
}

fn json_string(value: &str) -> String {
    serde_json::Value::String(value.into()).to_string()
}

const WORK: &str = r#"{"id":"w","kind":"work","title":"Work","language":"la"}"#;

#[test]
fn source_identifiers_are_bounded_lowercase_ascii_slugs() {
    let longest = "a".repeat(64);
    let accepted = library(&format!(
        r#"{{"id":"{longest}","kind":"work","title":"Longest"}},{{"id":"a1-b2","kind":"work","title":"Digits"}}"#
    ));
    assert!(SourceLibrary::parse(&accepted, &no_contributors()).is_ok());

    let too_long = "a".repeat(65);
    for rejected in [
        "Plato",
        "ré",
        "../escape",
        "a/b",
        "-leading",
        "trailing-",
        "double--hyphen",
        "with space",
        "",
        too_long.as_str(),
    ] {
        let found = only(&library(&format!(
            r#"{{"id":{},"kind":"work","title":"T"}}"#,
            json_string(rejected)
        )));
        assert_eq!(found.index, Some(0), "{rejected}");
        assert_eq!(found.field.as_deref(), Some("id"), "{rejected}");
        assert!(
            matches!(
                found.code,
                SourceDiagnosticCode::InvalidId | SourceDiagnosticCode::InvalidField
            ),
            "{rejected}: {found:?}"
        );
    }
}

#[test]
fn identifiers_are_unique_across_every_kind() {
    let found = only(&library(&format!(
        r#"{WORK},{{"id":"w","kind":"edition","of":"w","title":"Collides"}}"#
    )));
    assert_eq!(found.code, SourceDiagnosticCode::DuplicateId);
    assert_eq!(found.index, Some(1));
    assert_eq!(found.source_id.as_deref(), Some("w"));
    assert!(found.message.contains("sources[0]"), "{}", found.message);
}

#[test]
fn every_kind_is_explicit_and_distinct() {
    let missing = only(&library(r#"{"id":"w","title":"No kind"}"#));
    assert_eq!(missing.code, SourceDiagnosticCode::MissingField);
    assert_eq!(missing.field.as_deref(), Some("kind"));

    let unknown = only(&library(r#"{"id":"w","kind":"book","title":"Book"}"#));
    assert_eq!(unknown.code, SourceDiagnosticCode::UnknownKind);
    assert!(unknown.message.contains("`book`"));
}

#[test]
fn kind_specific_fields_produce_precise_diagnostics() {
    let cases = [
        (
            r#"{"id":"x","kind":"work","title":"W","of":"w"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "of",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E"}"#,
            SourceDiagnosticCode::MissingField,
            "of",
        ),
        (
            r#"{"id":"e","kind":"edition","of":"w"}"#,
            SourceDiagnosticCode::MissingField,
            "title",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"w","basedOn":"w"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "basedOn",
        ),
        (
            r#"{"id":"t","kind":"translation","title":"T","of":"w"}"#,
            SourceDiagnosticCode::MissingField,
            "language",
        ),
        (
            r#"{"id":"t","kind":"translation","title":"T","of":"w","language":"english language"}"#,
            SourceDiagnosticCode::InvalidField,
            "language",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"w","location":{"scheme":"page","value":"1"}}"#,
            SourceDiagnosticCode::InvalidField,
            "location",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"w","creators":[{"name":"N","role":"ghost"}]}"#,
            SourceDiagnosticCode::InvalidField,
            "creators[0].role",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"w","creators":[{"role":"editor"}]}"#,
            SourceDiagnosticCode::MissingField,
            "creators[0].name",
        ),
    ];
    for (record, code, field) in cases {
        let found = only(&library(&format!("{WORK},{record}")));
        assert_eq!(found.code, code, "{record}: {found:?}");
        assert_eq!(found.index, Some(1), "{record}");
        assert_eq!(found.field.as_deref(), Some(field), "{record}");
    }
}

#[test]
fn relationships_must_resolve_to_a_permitted_kind() {
    let reference = r#"{"id":"r","kind":"reference","of":"w"}"#;
    let cases = [
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"r"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "of",
        ),
        (
            r#"{"id":"e","kind":"reference","of":"r"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "of",
        ),
        (
            r#"{"id":"t","kind":"translation","title":"T","language":"en","of":"r"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "of",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"missing"}"#,
            SourceDiagnosticCode::UnresolvedRelationship,
            "of",
        ),
        (
            r#"{"id":"e","kind":"edition","title":"E","of":"e"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "of",
        ),
        (
            r#"{"id":"t","kind":"translation","title":"T","language":"en","of":"w","basedOn":"r"}"#,
            SourceDiagnosticCode::InvalidRelationship,
            "basedOn",
        ),
    ];
    for (record, code, field) in cases {
        let found = only(&library(&format!("{WORK},{reference},{record}")));
        assert_eq!(found.code, code, "{record}: {found:?}");
        assert_eq!(found.index, Some(2), "{record}");
        assert_eq!(found.field.as_deref(), Some(field), "{record}");
    }
}

#[test]
fn ambiguous_translation_sources_and_cycles_are_reported() {
    let other = r#"{"id":"other","kind":"work","title":"Other"}"#;
    let other_edition = r#"{"id":"oe","kind":"edition","title":"OE","of":"other"}"#;
    let mismatch = only(&library(&format!(
        r#"{WORK},{other},{other_edition},{{"id":"t","kind":"translation","title":"T","language":"en","of":"w","basedOn":"oe"}}"#
    )));
    assert_eq!(mismatch.code, SourceDiagnosticCode::AmbiguousRelationship);
    assert_eq!(mismatch.field.as_deref(), Some("basedOn"));
    assert!(
        mismatch.message.contains("`w`") && mismatch.message.contains("`other`"),
        "{}",
        mismatch.message
    );

    let found = diagnostics(&library(&format!(
        r#"{WORK},{{"id":"t","kind":"translation","title":"T","language":"en","of":"w","basedOn":"te"}},{{"id":"te","kind":"edition","title":"TE","of":"t"}}"#
    )));
    assert!(
        found.iter().any(
            |diagnostic| diagnostic.code == SourceDiagnosticCode::RelationshipCycle
                && diagnostic.source_id.as_deref() == Some("t")
        ),
        "{found:#?}"
    );
}

#[test]
fn source_locations_must_belong_to_an_unambiguous_target() {
    let edition = r#"{"id":"e","kind":"edition","title":"E","of":"w"}"#;
    let witness = r#"{"id":"ms","kind":"witness","title":"MS","of":"w"}"#;
    let ok = library(&format!(
        r#"{WORK},{edition},{witness},
        {{"id":"r1","kind":"reference","of":"e","location":{{"scheme":"page","value":"12–30"}}}},
        {{"id":"r2","kind":"reference","of":"ms","location":{{"scheme":"folio","value":"23r"}}}},
        {{"id":"r3","kind":"reference","of":"w","location":{{"scheme":"canonical","value":"514a"}}}},
        {{"id":"r4","kind":"reference","of":"w","location":{{"scheme":"timestamp","value":"1:02:03.5"}}}}"#
    ));
    let parsed = SourceLibrary::parse(&ok, &no_contributors());
    assert!(parsed.is_ok(), "{parsed:#?}");

    let cases = [
        (
            r#"{"id":"r","kind":"reference","of":"w","location":{"scheme":"page","value":"12"}}"#,
            SourceDiagnosticCode::AmbiguousLocation,
            "location.scheme",
        ),
        (
            r#"{"id":"r","kind":"reference","of":"e","location":{"scheme":"folio","value":"23r"}}"#,
            SourceDiagnosticCode::AmbiguousLocation,
            "location.scheme",
        ),
        (
            r#"{"id":"r","kind":"reference","of":"e","location":{"scheme":"verse-ish","value":"1"}}"#,
            SourceDiagnosticCode::InvalidField,
            "location.scheme",
        ),
        (
            r#"{"id":"r","kind":"reference","of":"w","location":{"scheme":"timestamp","value":"soon"}}"#,
            SourceDiagnosticCode::InvalidField,
            "location.value",
        ),
        (
            r#"{"id":"r","kind":"reference","of":"e","location":{"scheme":"page","value":"  "}}"#,
            SourceDiagnosticCode::InvalidField,
            "location.value",
        ),
    ];
    for (record, code, field) in cases {
        let found = only(&library(&format!("{WORK},{edition},{witness},{record}")));
        assert_eq!(found.code, code, "{record}: {found:?}");
        assert_eq!(found.field.as_deref(), Some(field), "{record}");
    }
}

#[test]
fn bibliographic_identifiers_are_checked_offline_and_unsafe_urls_rejected() {
    let ok = library(
        r#"{"id":"w","kind":"work","title":"W","identifiers":[
          {"scheme":"doi","value":"10.1234/ÄBC-1"},
          {"scheme":"doi","value":"https://doi.org/10.1000/xyz"},
          {"scheme":"isbn","value":"0-8044-2957-X"},
          {"scheme":"isbn","value":"9780199248490"},
          {"scheme":"issn","value":"0317-8471"},
          {"scheme":"url","value":"https://example.org/source"},
          {"scheme":"oclc","value":"ocm12345"}
        ]}"#,
    );
    let parsed = SourceLibrary::parse(&ok, &no_contributors());
    assert!(parsed.is_ok(), "{parsed:#?}");

    for (scheme, value) in [
        ("url", "javascript:alert(1)"),
        ("url", "data:text/html,boom"),
        ("url", "//evil.example/x"),
        ("url", "https://user@example.com/x"),
        ("doi", "11.1234/x"),
        ("isbn", "9780199248491"),
        ("isbn", "12345"),
        ("issn", "0317-8472"),
        ("Bad Scheme", "x"),
    ] {
        let found = only(&library(&format!(
            r#"{{"id":"w","kind":"work","title":"W","identifiers":[{{"scheme":{},"value":{}}}]}}"#,
            json_string(scheme),
            json_string(value)
        )));
        assert_eq!(
            found.code,
            SourceDiagnosticCode::InvalidIdentifier,
            "{scheme} {value}"
        );
        assert_eq!(found.field.as_deref(), Some("identifiers[0]"), "{value}");
    }
}

#[test]
fn contributor_credits_cannot_be_used_as_bibliographic_references() {
    let config = SiteConfig::from_json(r#"{"contributors":{"ada":{"name":"Ada"}}}"#).unwrap();
    let parse = |text: &str| SourceLibrary::parse(text, &config.contributors).unwrap_err();

    let sidecar = parse(r#"{"version":1,"credits":[{"contributor":"ada","roles":[]}]}"#);
    assert_eq!(sidecar.len(), 1, "{sidecar:#?}");
    assert_eq!(sidecar[0].code, SourceDiagnosticCode::ContributorCredit);

    let pointing = parse(&library(r#"{"id":"r","kind":"reference","of":"ada"}"#));
    assert_eq!(pointing.len(), 1, "{pointing:#?}");
    assert_eq!(pointing[0].code, SourceDiagnosticCode::ContributorCredit);
    assert_eq!(pointing[0].field.as_deref(), Some("of"));
    assert!(pointing[0].message.contains("contributor"));

    for record in [
        r#"{"id":"w","kind":"work","title":"W","contributor":"ada"}"#,
        r#"{"id":"w","kind":"work","title":"W","credits":[]}"#,
        r#"{"id":"w","kind":"contributor","title":"Ada"}"#,
        r#"{"id":"w","kind":"work","title":"W","creators":[{"name":"Ada","contributor":"ada"}]}"#,
    ] {
        let found = parse(&library(record));
        assert_eq!(found.len(), 1, "{record}: {found:#?}");
        assert_eq!(
            found[0].code,
            SourceDiagnosticCode::ContributorCredit,
            "{record}"
        );
    }

    // The boundary holds in the other direction: credit sidecars stay closed.
    let error = contributor::resolve(
        &config.author,
        &config.contributors,
        Some(r#"{"version":1,"credits":[],"references":["w"]}"#),
    )
    .unwrap_err();
    assert!(error.contains("unknown field `references`"), "{error}");
    let error = contributor::resolve(
        &config.author,
        &config.contributors,
        Some(
            r#"{"version":1,"credits":[{"contributor":"w","roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
        ),
    )
    .unwrap_err();
    assert!(error.contains("unknown contributor `w`"), "{error}");
}

#[test]
fn library_versions_are_explicit_and_newer_files_are_never_reinterpreted() {
    for (text, code) in [
        (r#"{"sources":[]}"#, SourceDiagnosticCode::MissingField),
        (
            r#"{"version":"1","sources":[]}"#,
            SourceDiagnosticCode::UnsupportedVersion,
        ),
        (
            r#"{"version":0,"sources":[]}"#,
            SourceDiagnosticCode::UnsupportedVersion,
        ),
        (
            r#"{"version":2,"sources":[{"id":"w","kind":"dataset"}]}"#,
            SourceDiagnosticCode::UnsupportedVersion,
        ),
        (r#"{"version":1}"#, SourceDiagnosticCode::MissingField),
        (r#"[]"#, SourceDiagnosticCode::InvalidField),
        (
            r#"{"version":1,"sources":["#,
            SourceDiagnosticCode::InvalidJson,
        ),
    ] {
        let found = only(text);
        assert_eq!(found.code, code, "{text}");
        assert_eq!(found.index, None, "{text}");
    }
    assert!(only(r#"{"version":2,"sources":[]}"#)
        .message
        .contains("newer open.blog"));
    assert_eq!(
        SourceLibrary::parse(&SourceLibrary::default().to_json(), &no_contributors()).unwrap(),
        SourceLibrary::default()
    );
}

#[test]
fn hostile_and_oversized_input_is_rejected_before_it_is_trusted() {
    let huge = format!(
        r#"{{"version":1,"sources":[],"padding":"{}"}}"#,
        "x".repeat(MAX_LIBRARY_BYTES)
    );
    assert_eq!(only(&huge).code, SourceDiagnosticCode::TooLarge);

    let records: Vec<String> = (0..=MAX_SOURCES)
        .map(|n| format!(r#"{{"id":"w{n}","kind":"work","title":"W"}}"#))
        .collect();
    assert_eq!(
        only(&library(&records.join(","))).code,
        SourceDiagnosticCode::TooLarge
    );

    let long_title = only(&library(&format!(
        r#"{{"id":"w","kind":"work","title":"{}"}}"#,
        "é".repeat(1_001)
    )));
    assert_eq!(long_title.code, SourceDiagnosticCode::TooLarge);
    assert_eq!(long_title.field.as_deref(), Some("title"));

    let control = only(&library(
        r#"{"id":"w","kind":"work","title":"Bad\u0000title"}"#,
    ));
    assert_eq!(control.code, SourceDiagnosticCode::InvalidField);

    // Markup and prototype-like keys are inert data: kept verbatim for a
    // renderer to escape, never interpreted here.
    let text = library(
        r#"{"id":"w","kind":"work","title":"<script>alert(1)</script>","__proto__":{"polluted":true}}"#,
    );
    let parsed = SourceLibrary::parse(&text, &no_contributors()).unwrap();
    assert_eq!(
        parsed.sources[0].title.as_deref(),
        Some("<script>alert(1)</script>")
    );
    assert!(parsed.sources[0].extra.contains_key("__proto__"));
}

#[test]
fn unicode_text_is_preserved_byte_for_byte() {
    let decomposed = "Cafe\u{0301} — \u{05E9}\u{05DC}\u{05D5}\u{05DD} 📚";
    let text = library(&format!(
        r#"{{"id":"w","kind":"work","title":{}}}"#,
        json_string(decomposed)
    ));
    let parsed = SourceLibrary::parse(&text, &no_contributors()).unwrap();
    assert_eq!(parsed.sources[0].title.as_deref(), Some(decomposed));
    let reparsed = SourceLibrary::parse(&parsed.to_json(), &no_contributors()).unwrap();
    assert_eq!(reparsed.sources[0].title.as_deref(), Some(decomposed));
}

#[test]
fn diagnostics_are_scoped_to_each_source_and_reported_together() {
    let found = diagnostics(&library(&format!(
        r#"{WORK},
        {{"id":"bad-kind","kind":"book","title":"B"}},
        {{"id":"r","kind":"reference","of":"bad-kind"}},
        {{"id":"e","kind":"edition","title":"E","of":"nowhere"}}"#
    )));
    let scoped: Vec<(Option<usize>, Option<&str>, SourceDiagnosticCode)> = found
        .iter()
        .map(|diagnostic| {
            (
                diagnostic.index,
                diagnostic.source_id.as_deref(),
                diagnostic.code,
            )
        })
        .collect();
    assert_eq!(
        scoped,
        [
            (Some(1), Some("bad-kind"), SourceDiagnosticCode::UnknownKind),
            (
                Some(3),
                Some("e"),
                SourceDiagnosticCode::UnresolvedRelationship
            ),
        ],
        "a reference to an already-reported record adds no noise"
    );
    assert_eq!(
        found[1].to_string(),
        "sources[3] `e` of: no source has the id `nowhere` (unresolved-relationship)"
    );
    let json = serde_json::to_value(&found[1]).unwrap();
    assert_eq!(json["code"], "unresolved-relationship");
    assert_eq!(json["sourceId"], "e");
}

#[test]
fn failed_changes_leave_the_library_unchanged() {
    let mut library = SourceLibrary::parse(LIBRARY, &no_contributors()).unwrap();
    let before = library.to_json();
    let contributors = no_contributors();

    let mut collapsed = library.sources[1].clone();
    collapsed.kind = SourceKind::Work;
    collapsed.of = None;
    let error = library.upsert(collapsed, &contributors).unwrap_err();
    assert_eq!(error[0].code, SourceDiagnosticCode::KindChanged);
    assert_eq!(library.to_json(), before);

    let mut dangling = library.sources[4].clone();
    dangling.of = Some("missing".into());
    let error = library.upsert(dangling, &contributors).unwrap_err();
    assert_eq!(error[0].code, SourceDiagnosticCode::UnresolvedRelationship);
    assert_eq!(library.to_json(), before);

    let mut invalid = library.sources[0].clone();
    invalid.id = "../escape".into();
    let error = library.upsert(invalid, &contributors).unwrap_err();
    assert_eq!(error[0].code, SourceDiagnosticCode::InvalidId);
    assert_eq!(library.to_json(), before);

    let mut shadowing = library.sources[0].clone();
    shadowing.extra.insert("kind".into(), "edition".into());
    let error = library.upsert(shadowing, &contributors).unwrap_err();
    assert_eq!(error[0].field.as_deref(), Some("kind"));
    assert_eq!(library.to_json(), before);

    let error = library.remove("plato-republic", &contributors).unwrap_err();
    assert!(!error.is_empty());
    assert!(error
        .iter()
        .all(|d| d.code == SourceDiagnosticCode::UnresolvedRelationship));
    assert_eq!(library.to_json(), before);

    let error = library.remove("never-existed", &contributors).unwrap_err();
    assert_eq!(error[0].code, SourceDiagnosticCode::UnknownSource);
    assert_eq!(library.to_json(), before);

    let mut retitled = library.sources[1].clone();
    retitled.title = Some("Platonis Rempublicam (corrected)".into());
    library.upsert(retitled, &contributors).unwrap();
    assert_eq!(library.sources[1].id, "republic-slings-2003");
    assert_eq!(
        library.sources[1].extra["publisher"]["name"],
        "Oxford University Press"
    );

    let removed = library.remove("cave-allegory", &contributors).unwrap();
    assert_eq!(removed.kind, SourceKind::Reference);
    assert_eq!(library.sources.len(), 4);
}

#[test]
fn documented_example_is_a_valid_library() {
    let spec = include_str!("../../../docs/specs/research-source-library.md");
    let example = spec
        .split("```json")
        .nth(1)
        .and_then(|rest| rest.split("```").next())
        .expect("spec has a JSON example");
    let parsed = SourceLibrary::parse(example, &no_contributors());
    assert!(parsed.is_ok(), "{parsed:#?}");
    assert_eq!(parsed.unwrap().sources.len(), 5);
}

#[test]
fn source_libraries_are_never_content_sources() {
    for path in [
        "sources.json",
        "posts/sources.json",
        "posts/a.sources.json",
        "research/sources.json",
    ] {
        assert_eq!(classify_source(path), None, "{path}");
    }
    assert_eq!(
        classify_source("posts/a.credits.json"),
        Some(openblog_core::SourceKind::PostCredits)
    );
}

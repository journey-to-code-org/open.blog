use std::collections::BTreeMap;

use openblog_core::citations::{
    citation_from_csl_item, citation_to_csl_item, csl_field_fate, format_citation,
    format_reference, parse_citation, resolve_citations, scan_citations, Citation,
    CitationDiagnosticCode, CitationMention, CslFate, MAX_CITATIONS, MAX_CITATION_LOCATORS,
};
use openblog_core::markdown::{render, RenderOptions};
use openblog_core::research_notes::{LocatorKind, Notebook};
use openblog_core::source_interchange::{plan_csl_import, MAX_IMPORT_BYTES};
use openblog_core::source_library::SourceLibrary;
use serde_json::json;

const LIBRARY: &str = r#"{
  "version": 1,
  "sources": [
    {"id": "plato-republic", "kind": "work", "title": "Πολιτεία",
     "creators": [{"name": "Plato", "role": "author"}]},
    {"id": "republic-slings-2003", "kind": "edition", "of": "plato-republic",
     "title": "Platonis Rempublicam", "issued": "2003", "secretPlan": "unannounced",
     "creators": [{"name": "S. R. Slings", "role": "editor"}],
     "csl": {"publisher": "OUP", "note": "private", "legacy": {"nested": true}}},
    {"id": "paris-gr-1807", "kind": "witness", "of": "plato-republic", "archived": true,
     "title": "Paris gr. 1807"}
  ]
}"#;

fn library() -> SourceLibrary {
    SourceLibrary::parse(LIBRARY, &BTreeMap::new()).expect("valid library")
}

fn resolve(markdown: &str) -> openblog_core::citations::ResolvedCitations {
    let scan = scan_citations(markdown);
    assert!(scan.diagnostics.is_empty(), "{:?}", scan.diagnostics);
    resolve_citations(&scan.mentions, &library())
}

#[test]
fn repeated_citations_share_one_reference_in_first_cited_order() {
    let resolved = resolve(
        "A [@republic-slings-2003, page 514] then [@plato-republic, canonical 514a] and again \
         [@republic-slings-2003, page 520].",
    );
    let numbers: Vec<usize> = resolved.citations.iter().map(|c| c.number).collect();
    assert_eq!(numbers, vec![1, 2, 1]);
    let keys: Vec<&str> = resolved.references.iter().map(|r| r.key.as_str()).collect();
    assert_eq!(keys, vec!["republic-slings-2003", "plato-republic"]);
    assert!(resolved.diagnostics.is_empty());
}

#[test]
fn compound_locators_keep_kind_order_and_ranges() {
    let citation =
        parse_citation("republic-slings-2003, page 514 to 520; line 4; x-stephanus 514a").unwrap();
    let kinds: Vec<&str> = citation.locators.iter().map(|l| l.kind.as_str()).collect();
    assert_eq!(kinds, ["page", "line", "x-stephanus"]);
    assert_eq!(citation.locators[0].to.as_deref(), Some("520"));
    assert_eq!(
        format_citation(&citation).unwrap(),
        "[@republic-slings-2003, page 514 to 520; line 4; x-stephanus 514a]"
    );
}

#[test]
fn format_and_parse_round_trip_with_unicode_locators() {
    let text = "plato-republic, canonical 514a–520a; section Βιβλίον ζ; timestamp 1:02:03.5";
    let citation = parse_citation(text).unwrap();
    assert_eq!(citation.locators[0].value, "514a–520a");
    let written = format_citation(&citation).unwrap();
    let again = parse_citation(&written[2..written.len() - 1]).unwrap();
    assert_eq!(citation, again);
}

#[test]
fn missing_and_malformed_keys_are_scoped_and_reported() {
    let scan = scan_citations("one [@nope] two\n[@Bad Key] three [@café] [@plato-republic");
    let codes: Vec<_> = scan.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(
        codes,
        vec![
            CitationDiagnosticCode::InvalidKey,
            CitationDiagnosticCode::InvalidKey,
            CitationDiagnosticCode::MalformedCitation
        ]
    );
    assert_eq!(scan.diagnostics[0].line, Some(2));
    let resolved = resolve_citations(&scan.mentions, &library());
    assert_eq!(resolved.diagnostics.len(), 1);
    assert_eq!(
        resolved.diagnostics[0].code,
        CitationDiagnosticCode::UnknownKey
    );
    assert_eq!(resolved.diagnostics[0].key.as_deref(), Some("nope"));
    assert!(resolved.citations.is_empty() && resolved.references.is_empty());
}

#[test]
fn one_bad_citation_does_not_block_the_rest() {
    let resolved = resolve("[@missing] and [@plato-republic]");
    assert_eq!(resolved.citations.len(), 1);
    assert_eq!(resolved.diagnostics.len(), 1);
}

#[test]
fn page_on_a_work_and_folio_off_a_witness_are_ambiguous() {
    let resolved = resolve(
        "[@plato-republic, page 5] [@republic-slings-2003, folio 3r] [@paris-gr-1807, folio 3r]",
    );
    let codes: Vec<_> = resolved.diagnostics.iter().map(|d| d.code).collect();
    assert_eq!(codes, vec![CitationDiagnosticCode::AmbiguousLocator; 2]);
    assert_eq!(resolved.citations.len(), 1);
    assert_eq!(resolved.citations[0].key, "paris-gr-1807");
    assert!(resolved.diagnostics[0].message.contains("the citation"));
}

#[test]
fn hostile_locators_are_refused() {
    for text in [
        "plato-republic, page ",
        "plato-republic, bogus 5",
        "plato-republic, page 5;; line 2",
        "plato-republic, page 5\u{202e}x",
        "plato-republic, timestamp soon",
        "plato-republic, page 5 to 6 to 7",
        &format!("plato-republic, page {}", "9".repeat(201)),
        "plato-republic, x-Bad 5",
    ] {
        assert!(parse_citation(text).is_err(), "accepted {text:?}");
    }
    let many = format!(
        "plato-republic, {}",
        ["line 1"; MAX_CITATION_LOCATORS + 1].join("; ")
    );
    assert_eq!(
        parse_citation(&many).unwrap_err().code,
        CitationDiagnosticCode::TooManyLocators
    );
}

#[test]
fn markdown_links_footnotes_code_and_escapes_are_not_citations() {
    let markdown = "\
Link [@plato-republic](https://example.com) and ref [@plato-republic][r] and note[^1].\n\
\n\
`[@plato-republic]` and \\[@plato-republic] and ``[@plato-republic]``.\n\
\n\
```\n[@plato-republic]\n```\n\
\n\
\x20   [@plato-republic]\n\
\n\
Shortcut [@defined-key] and collapsed [@defined-key][] are links.\n\
\n\
> ```\n\
> [@plato-republic]\n\
> ```\n\
\n\
<!-- [@plato-republic] -->\n\
\n\
Inline <!-- [@plato-republic] --> comment and a `code span\n\
[@plato-republic]` over two lines and ![@plato-republic](i.png).\n\
\n\
[@defined-key]: https://example.com/def\n\
[r]: https://example.com\n\
[^1]: A footnote.\n";
    let scan = scan_citations(markdown);
    assert!(scan.mentions.is_empty(), "{:?}", scan.mentions);
    assert!(scan.diagnostics.is_empty(), "{:?}", scan.diagnostics);
}

#[test]
fn list_continuation_paragraphs_are_scanned() {
    let markdown = "- item\n\n    continued [@plato-republic, page 5] here\n\n\
                    1. first\n\n   more [@republic-slings-2003]\n";
    let scan = scan_citations(markdown);
    assert!(scan.diagnostics.is_empty(), "{:?}", scan.diagnostics);
    let keys: Vec<&str> = scan
        .mentions
        .iter()
        .map(|m| m.citation.key.as_str())
        .collect();
    assert_eq!(keys, ["plato-republic", "republic-slings-2003"]);
    assert_eq!(scan.mentions[0].line, 3);
}

#[test]
fn escapes_inside_a_citation_are_unescaped_and_an_escaped_bracket_does_not_close_it() {
    let scan = scan_citations(r"[@plato-republic, section 5\-6] and [@plato-republic, page 5\]a]");
    assert_eq!(scan.mentions.len(), 1);
    assert_eq!(scan.mentions[0].citation.locators[0].value, "5-6");
    assert_eq!(scan.diagnostics.len(), 1);
    assert_eq!(
        scan.diagnostics[0].code,
        CitationDiagnosticCode::InvalidLocator
    );
}

#[test]
fn citations_inside_formatting_and_tables_follow_the_renderer() {
    let markdown = "*see [@plato-republic]* and\n\n| a |\n| - |\n| [@republic-slings-2003] |\n\n\
                    # Head [@paris-gr-1807]\n";
    let keys: Vec<String> = scan_citations(markdown)
        .mentions
        .into_iter()
        .map(|m| m.citation.key)
        .collect();
    assert_eq!(
        keys,
        ["plato-republic", "republic-slings-2003", "paris-gr-1807"]
    );
    let split = scan_citations("[@plato-republic, page *5*]");
    assert!(split.mentions.is_empty());
    assert_eq!(
        split.diagnostics[0].code,
        CitationDiagnosticCode::MalformedCitation
    );
}

#[test]
fn citation_syntax_is_inert_in_the_existing_renderer() {
    let with = render(
        "Claim [@plato-republic, page 5] and [a link](https://example.com)[^1].\n\n[^1]: Note.\n",
        RenderOptions::default(),
    )
    .html;
    assert!(with.contains("[@plato-republic, page 5]"));
    assert!(with.contains("href=\"https://example.com\""));
    assert!(with.contains("footnote"));
}

#[test]
fn legacy_research_posts_have_no_citations() {
    let post =
        include_str!("../../../content/posts/2026-02-16-research-and-contributor-credits.md");
    let scan = scan_citations(post);
    assert!(scan.mentions.is_empty());
    assert!(scan.diagnostics.is_empty(), "{:?}", scan.diagnostics);
}

#[test]
fn spans_and_lines_point_at_the_citation_text() {
    let markdown = "first line\nsecond [@plato-republic, canonical 1a] end";
    let scan = scan_citations(markdown);
    let mention = &scan.mentions[0];
    assert_eq!(mention.line, 2);
    assert_eq!(
        &markdown[mention.span.clone()],
        "[@plato-republic, canonical 1a]"
    );
}

#[test]
fn input_limits_hold() {
    let many = "[@plato-republic] ".repeat(MAX_CITATIONS + 5);
    let scan = scan_citations(&many);
    assert_eq!(scan.mentions.len(), MAX_CITATIONS);
    assert_eq!(
        scan.diagnostics[0].code,
        CitationDiagnosticCode::TooManyCitations
    );
    let huge = "x".repeat(2 * 1024 * 1024);
    assert_eq!(
        scan_citations(&huge).diagnostics[0].code,
        CitationDiagnosticCode::TooLarge
    );
}

#[test]
fn only_key_locators_and_reference_description_are_public() {
    let resolved = resolve("[@republic-slings-2003, page 514]");
    let json = serde_json::to_string(&resolved).unwrap();
    for leaked in [
        "secretPlan",
        "unannounced",
        "private",
        "nested",
        "archived",
        "\"of\"",
    ] {
        assert!(!json.contains(leaked), "{leaked} leaked: {json}");
    }
    assert!(json.contains("Platonis Rempublicam") && json.contains("OUP"));
    assert_eq!(
        format_reference(&resolved.references[0]),
        "Platonis Rempublicam. OUP. 2003"
    );
}

#[test]
fn archived_references_still_resolve() {
    let resolved = resolve("[@paris-gr-1807, folio 1r]");
    assert_eq!(resolved.references[0].key, "paris-gr-1807");
}

#[test]
fn csl_item_round_trips_compound_locators_and_reports_losses() {
    let citation =
        parse_citation("republic-slings-2003, page 514 to 520; canonical 514a; line 4").unwrap();
    let (item, losses) = citation_to_csl_item(&citation);
    assert_eq!(item["label"], "page");
    assert_eq!(item["locator"], "514\u{2013}520");
    assert_eq!(losses.len(), 2);
    let (back, back_losses) = citation_from_csl_item(&item).unwrap();
    assert_eq!(back, citation);
    assert!(back_losses.is_empty());

    let (item, losses) =
        citation_to_csl_item(&parse_citation("plato-republic, canonical 514a").unwrap());
    assert!(item.get("label").is_none());
    assert_eq!(losses[0].field, "label");
    assert_eq!(
        citation_from_csl_item(&item).unwrap().0.locators[0].kind,
        LocatorKind::Canonical
    );
}

#[test]
fn csl_import_prefers_csl_fields_when_they_disagree_and_reports_unsupported() {
    let item = json!({
        "id": "plato-republic", "label": "figure", "locator": "3",
        "prefix": "see", "suppress-author": true,
        "openblog-locators": [{"kind": "page", "value": "9"}]
    });
    let (citation, losses) = citation_from_csl_item(&item).unwrap();
    assert_eq!(citation.locators.len(), 1);
    assert_eq!(citation.locators[0].kind.as_str(), "x-csl-figure");
    let fields: Vec<&str> = losses.iter().map(|l| l.field.as_str()).collect();
    assert_eq!(fields, ["openblog-locators", "prefix", "suppress-author"]);
    let (plain, _) =
        citation_from_csl_item(&json!({"id": "plato-republic", "locator": "12"})).unwrap();
    assert_eq!(plain.locators[0].kind, LocatorKind::Page);
}

#[test]
fn csl_import_refuses_hostile_items() {
    for item in [
        json!("text"),
        json!({"id": ""}),
        json!({"id": "a\u{7}b"}),
        json!({"id": ["list"]}),
        json!({"id": "plato-republic", "locator": 5}),
        json!({"id": "plato-republic", "locator": "1;2"}),
        json!({"id": "plato-republic", "label": "A/B", "locator": "1"}),
        json!({"id": "plato-republic", "openblog-locators": [{"kind": "zzz", "value": "1"}]}),
    ] {
        assert!(citation_from_csl_item(&item).is_err(), "{item}");
    }
}

#[test]
fn csl_field_fates_agree_with_the_import_plan() {
    assert_eq!(csl_field_fate("title"), CslFate::Stored);
    assert_eq!(csl_field_fate("author"), CslFate::Stored);
    assert_eq!(csl_field_fate("DOI"), CslFate::Stored);
    assert_eq!(csl_field_fate("publisher"), CslFate::Preserved);
    assert_eq!(csl_field_fate("note"), CslFate::PrivateDropped);
    assert_eq!(csl_field_fate("shortTitle-x"), CslFate::Unsupported);

    let text = json!([{
        "id": "x", "type": "book", "title": "T", "publisher": "P", "page": "5",
        "note": "private", "abstract": "private", "mystery": "m"
    }])
    .to_string();
    assert!(text.len() < MAX_IMPORT_BYTES);
    let plan = plan_csl_import(&SourceLibrary::default(), &text, &BTreeMap::new()).unwrap();
    let unsupported: Vec<&str> = plan.entries[0]
        .unsupported
        .iter()
        .map(|l| l.field.as_str())
        .collect();
    for field in [
        "id",
        "type",
        "title",
        "publisher",
        "page",
        "note",
        "abstract",
        "mystery",
    ] {
        let expected_lost = matches!(
            csl_field_fate(field),
            CslFate::PrivateDropped | CslFate::Unsupported
        );
        assert_eq!(unsupported.contains(&field), expected_lost, "{field}");
    }
}

#[test]
fn notebook_locator_extra_fields_never_reach_public_output_or_csl() {
    let notebook = json!({"version": 1,
        "passages": [{"id": "p-1", "source": "republic-slings-2003", "visibility": "private",
            "excerpt": {"text": "quoted"},
            "locators": [{"kind": "page", "value": "514", "to": "520",
                "privateNote": "do not publish"}]}],
        "notes": []});
    let notebook = Notebook::parse(&notebook.to_string(), &library()).expect("notebook");
    let locators = notebook.passages[0].locators.clone();
    assert!(locators[0].extra.contains_key("privateNote"));
    let citation = Citation {
        key: "republic-slings-2003".into(),
        locators,
    };
    let mention = CitationMention {
        citation: citation.clone(),
        span: 0..1,
        line: 1,
    };
    let resolved = resolve_citations(&[mention], &library());
    let public = serde_json::to_string(&resolved).unwrap();
    let (item, _) = citation_to_csl_item(&citation);
    for text in [public, item.to_string()] {
        assert!(!text.contains("privateNote"), "{text}");
        assert!(!text.contains("do not publish"), "{text}");
        assert!(text.contains("\"to\":\"520\""), "{text}");
    }
}

#[test]
fn only_publicly_resolvable_identifier_schemes_are_published() {
    let text = json!({"version": 1, "sources": [{
    "id": "scan", "kind": "work", "title": "Scan",
    "identifiers": [
        {"scheme": "my-drive", "value": "C:/Users/me/Private/scan.pdf"},
        {"scheme": "pmid", "value": "see my notes"},
        {"scheme": "oclc", "value": "12345"},
        {"scheme": "doi", "value": "10.1000/xyz"},
        {"scheme": "pmcid", "value": "PMC123"}
    ]}]})
    .to_string();
    let library = SourceLibrary::parse(&text, &BTreeMap::new()).expect("library");
    let scan = scan_citations("[@scan]");
    let resolved = resolve_citations(&scan.mentions, &library);
    let json = serde_json::to_string(&resolved).unwrap();
    for leaked in ["my-drive", "Private", "see my notes", "oclc"] {
        assert!(!json.contains(leaked), "{leaked} leaked: {json}");
    }
    let schemes: Vec<&str> = resolved.references[0]
        .identifiers
        .iter()
        .map(|(scheme, _)| scheme.as_str())
        .collect();
    assert_eq!(schemes, ["doi", "pmcid"]);
    assert_eq!(
        format_reference(&resolved.references[0]),
        "Scan. doi:10.1000/xyz"
    );
}

#[test]
fn csl_extension_labels_are_written_back_and_spaced_labels_round_trip() {
    let item = json!({"id": "plato-republic", "label": "figure", "locator": "3"});
    let (citation, _) = citation_from_csl_item(&item).unwrap();
    let (exported, losses) = citation_to_csl_item(&citation);
    assert_eq!(exported["label"], "figure");
    assert_eq!(exported["locator"], "3");
    assert!(losses.is_empty(), "{losses:?}");

    let item = json!({"id": "plato-republic", "label": "sub verbo", "locator": "polis"});
    let (citation, losses) = citation_from_csl_item(&item).unwrap();
    assert_eq!(citation.locators[0].kind.as_str(), "x-csl-sub-verbo");
    assert!(losses.is_empty(), "{losses:?}");
    let (exported, _) = citation_to_csl_item(&citation);
    assert_eq!(exported["label"], "sub verbo");
    assert_eq!(citation_from_csl_item(&exported).unwrap().0, citation);

    let item = json!({"id": "plato-republic", "label": "folio verso", "locator": "2"});
    let (citation, losses) = citation_from_csl_item(&item).unwrap();
    assert_eq!(citation.locators[0].kind.as_str(), "x-csl-folio-verso");
    assert_eq!(losses[0].field, "label");
    assert_eq!(citation_to_csl_item(&citation).0["label"], "folio-verso");
}

#[test]
fn csl_item_ids_are_normalised_like_reference_import_and_the_change_is_reported() {
    let text = json!([{"id": "Smith2003", "type": "book", "title": "T"}]).to_string();
    let plan = plan_csl_import(&SourceLibrary::default(), &text, &BTreeMap::new()).unwrap();
    let imported = plan.entries[0].source_id.clone();
    let (citation, losses) =
        citation_from_csl_item(&json!({"id": "Smith2003", "locator": "4"})).unwrap();
    assert_eq!(citation.key, "smith2003");
    assert_eq!(Some(citation.key.as_str()), imported.as_deref());
    assert_eq!(losses.len(), 1);
    assert_eq!(losses[0].field, "id");
    let (_, unchanged) = citation_from_csl_item(&json!({"id": "smith2003"})).unwrap();
    assert!(unchanged.is_empty());
}

//! The research-completeness contract (ADR 0144, ADR 0145): every existing
//! research check maps into one finding shape and one matrix; each check has
//! exactly one owning validator; detected, potential and needs-review stay
//! apart and nothing is scored; findings are object-scoped, ordered the same
//! whatever order they arrive in, deduplicated, and safe to print; and an
//! acknowledgement never makes a finding resolved and goes stale when what
//! the finding says changes.

use std::collections::{BTreeMap, BTreeSet};

use openblog_core::alignment::AlignmentSet;
use openblog_core::chronology_index::ChronologyIndex;
use openblog_core::citation_review::review_citations;
use openblog_core::claim_review::{review_claims, ReviewContext};
use openblog_core::claims::ClaimSet;
use openblog_core::comparison_publication::{ComparisonInputs, PublicComparisons};
use openblog_core::frontmatter;
use openblog_core::knowledge_atlas::{Atlas, Links};
use openblog_core::research::{
    audit_document, EvidenceCode, EvidenceFinding, EvidenceOutcome, EvidenceSource,
};
use openblog_core::research_completeness::{
    matrix, Acknowledgement, AcknowledgementState, Category, Check, CompletenessFinding,
    CompletenessReport, Gate, MatrixRow, ObjectKind, ObjectRef, Validator,
    COMPLETENESS_FORMAT_VERSION,
};
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::SourceLibrary;
use serde_json::{json, Value};

/// Authored text no finding may carry.
const SECRET: &str = "ob-completeness-secret";

fn library() -> SourceLibrary {
    SourceLibrary::parse(
        &json!({"version": 1, "sources": [
            {"id": "republic", "kind": "work", "title": "Politeia",
             "creators": [{"name": "Plato", "role": "author"}]},
            {"id": "burnet", "kind": "edition", "of": "republic", "title": "Platonis Opera",
             "rights": {"status": "publicDomain", "note": format!("{SECRET} rights note")}},
            {"id": "grube", "kind": "translation", "of": "republic", "title": "Republic", "language": "en",
             "rights": {"status": "rightsReserved"}},
            {"id": "bare", "kind": "work", "title": "Bare", "csl": {"type": "article-journal"}},
            {"id": "old", "kind": "work", "title": format!("{SECRET} old title"), "archived": true}
        ]})
        .to_string(),
        &BTreeMap::new(),
    )
    .expect("library")
}

fn notebook(library: &SourceLibrary) -> Notebook {
    Notebook::parse(
        &json!({"version": 1, "passages": [
            {"id": "p-burnet", "source": "burnet", "excerpt": {"text": format!("{SECRET} greek")},
             "locators": [{"kind": "canonical", "value": "514a"}]},
            {"id": "p-grube", "source": "grube", "excerpt": {"text": format!("{SECRET} reserved")},
             "locators": [{"kind": "page", "value": "186"}]}
        ], "notes": [{"id": "n", "kind": "question", "text": format!("{SECRET} note"),
                      "passages": ["p-burnet"]}]})
        .to_string(),
        library,
    )
    .expect("notebook")
}

fn research_findings() -> Vec<EvidenceFinding> {
    let source = "---\ntitle: T\nprofile: research\ndoi: nope\n---\nBody[^1] text.\n";
    let doc = frontmatter::parse(source).expect("front matter");
    audit_document("posts/r.md", &doc.front_matter, &doc.body, doc.body_line)
}

fn citation_findings(body: &str) -> Vec<EvidenceFinding> {
    let library = library();
    review_citations("posts/c.md", body, 1, || Ok(Some(&library)))
}

const CITED: &str = "\
A [@burnet, canonical 514a] place.
Bad [@Not A Key] syntax.
Unknown [@nobody] and [@nobody-else] keys.
A bare article [@bare].
";

const DRAFT: &str = "The cave and the line.";

fn claims_value() -> Value {
    json!({"version": 1,
    "claims": [
        {"id": "c1", "post": "cave", "statement": format!("{SECRET} statement"),
         "anchor": {"start": 4, "end": 8, "text": "cave"}},
        {"id": "c2", "post": "cave", "statement": "S",
         "anchor": {"start": 0, "end": 4, "text": "gone"}}
    ],
    "links": [
        {"id": "l1", "claim": "c1", "relation": "supports", "evidence": {"source": "old"},
         "visibility": "approved", "rationale": format!("{SECRET} rationale")}
    ]})
}

fn claims(library: &SourceLibrary, notebook: &Notebook) -> ClaimSet {
    ClaimSet::parse(&claims_value().to_string(), Links { library, notebook }).expect("claims")
}

fn claim_findings() -> Vec<EvidenceFinding> {
    let library = library();
    let notebook = notebook(&library);
    let set = claims(&library, &notebook);
    let drafts = BTreeMap::from([("cave".to_string(), DRAFT.to_string())]);
    let paths = BTreeMap::from([("cave".to_string(), "posts/cave.md".to_string())]);
    review_claims(
        &set,
        &ReviewContext {
            drafts: &drafts,
            paths: &paths,
            claims_file: ".openblog/private/research/claims.json",
            library: &library,
            notebook: &notebook,
        },
    )
}

fn atlas(value: Value) -> Atlas {
    let library = library();
    Atlas::parse(
        &value.to_string(),
        Links {
            library: &library,
            notebook: &Notebook::default(),
        },
    )
    .unwrap_or_else(|d| panic!("valid atlas: {d:?}"))
}

fn notice_atlas() -> Atlas {
    atlas(json!({"version": 2, "entries": [
        {"id": "plato", "kind": "person", "label": format!("{SECRET} label")},
        {"id": "politeia", "kind": "work", "label": "Politeia", "source": "republic",
         "visibility": "approved"}
    ], "relationships": [
        {"id": "wrote", "kind": "authored", "from": "plato", "to": "politeia",
         "assertedBy": {"kind": "author"}, "evidence": [{"source": "republic"}],
         "visibility": "approved"}
    ]}))
}

fn dating(id: &str, aspect: &str, date: Value) -> Value {
    json!({"id": id, "aspect": aspect, "date": date,
        "assertedBy": {"kind": "source", "source": "republic"},
        "evidence": [{"source": "republic"}], "note": format!("{SECRET} dating note")})
}

fn chronology_atlas(death_year: i32) -> Atlas {
    atlas(json!({"version": 2, "entries": [
        {"id": "plato", "kind": "person", "label": format!("{SECRET} label"), "dates": [
            dating("born", "birth", json!({"notBefore": {"year": -400}})),
            dating("died", "death", json!({"notAfter": {"year": death_year}}))
        ]}
    ], "relationships": []}))
}

fn alignments_value() -> Value {
    json!({"version": 1, "alignments": [
        {"id": "cave", "label": "The cave", "correspondence": "partial", "visibility": "approved",
         "members": [
            {"source": "burnet", "passage": "p-burnet",
             "locators": [{"kind": "canonical", "value": "514b"}],
             "note": format!("{SECRET} member note")},
            {"source": "grube", "passage": "p-grube"}
         ],
         "rationale": "Both render 514a.", "confidence": "plausible",
         "recordedBy": {"kind": "named", "name": "A concordance"}}
    ]})
}

struct Alignments {
    notices: Vec<CompletenessFinding>,
    withheld: Vec<CompletenessFinding>,
}

fn alignments() -> Alignments {
    let library = library();
    let notebook = notebook(&library);
    let links = Links {
        library: &library,
        notebook: &notebook,
    };
    let set = AlignmentSet::parse(&alignments_value().to_string(), links).expect("alignments");
    let published = PublicComparisons::project(
        &set,
        ComparisonInputs {
            library: &library,
            notebook: &notebook,
            contributors: &BTreeMap::new(),
        },
    )
    .expect("projection");
    Alignments {
        notices: set
            .notices(links)
            .iter()
            .map(CompletenessFinding::from_atlas_diagnostic)
            .collect(),
        withheld: CompletenessFinding::from_comparisons(&published),
    }
}

fn private_file_errors() -> Vec<CompletenessFinding> {
    let library = library();
    let mut findings = Vec::new();
    let notebook_errors = Notebook::parse(
        &json!({"version": 1, "passages": [
            {"id": "p", "source": "nowhere", "excerpt": {"text": format!("{SECRET} excerpt")}}
        ], "notes": []})
        .to_string(),
        &library,
    )
    .expect_err("unknown source");
    findings.extend(
        notebook_errors
            .iter()
            .map(CompletenessFinding::from_note_diagnostic),
    );
    let library_errors = SourceLibrary::parse(
        &json!({"version": 1, "sources": [
            {"id": "lost", "kind": "edition", "of": "missing", "title": format!("{SECRET} title")}
        ]})
        .to_string(),
        &BTreeMap::new(),
    )
    .expect_err("unresolved relationship");
    findings.extend(
        library_errors
            .iter()
            .map(CompletenessFinding::from_source_diagnostic),
    );
    let unreadable = SourceLibrary::parse("{", &BTreeMap::new()).expect_err("invalid json");
    findings.extend(
        unreadable
            .iter()
            .map(CompletenessFinding::from_source_diagnostic),
    );
    let atlas_errors = Atlas::parse(
        "[",
        Links {
            library: &library,
            notebook: &Notebook::default(),
        },
    )
    .expect_err("invalid json");
    findings.extend(
        atlas_errors
            .iter()
            .map(CompletenessFinding::from_atlas_diagnostic),
    );
    findings
}

/// Every finding every fixture produces, through the contract.
fn everything() -> Vec<CompletenessFinding> {
    let mut findings: Vec<CompletenessFinding> = research_findings()
        .iter()
        .chain(&citation_findings(CITED))
        .chain(&claim_findings())
        .map(CompletenessFinding::from_evidence)
        .collect();
    findings.extend(
        notice_atlas()
            .notices()
            .iter()
            .map(CompletenessFinding::from_atlas_diagnostic),
    );
    let library = library();
    let notebook = notebook(&library);
    findings.extend(
        claims(&library, &notebook)
            .notices()
            .iter()
            .map(CompletenessFinding::from_atlas_diagnostic),
    );
    findings.extend(
        ChronologyIndex::of(&chronology_atlas(-410))
            .prompts
            .iter()
            .map(CompletenessFinding::from_chronology_prompt),
    );
    let alignments = alignments();
    findings.extend(alignments.notices);
    findings.extend(alignments.withheld);
    findings.extend(private_file_errors());
    findings
}

fn row_of<'a>(rows: &'a [MatrixRow], finding: &CompletenessFinding) -> &'a MatrixRow {
    rows.iter()
        .find(|row| row.validator == finding.validator && row.code == finding.code)
        .unwrap_or_else(|| panic!("no matrix row for {} {}", finding.validator, finding.code))
}

#[test]
fn every_check_has_exactly_one_owner_and_every_row_belongs_to_it() {
    let rows = matrix();
    let mut seen = BTreeSet::new();
    for row in &rows {
        assert_eq!(row.validator, row.check.owner(), "{row:?}");
        assert!(
            seen.insert((row.validator, row.code.clone())),
            "{} {} is mapped twice",
            row.validator,
            row.code
        );
    }
    assert_eq!(
        Check::ALL.iter().collect::<BTreeSet<_>>().len(),
        Check::ALL.len()
    );
    for check in Check::ALL {
        let codes = rows.iter().filter(|row| row.check == check).count();
        match check.owner().planned_in() {
            Some(issue) => assert_eq!(codes, 0, "{check} is planned in #{issue}"),
            None => assert!(codes > 0, "{check} owns no code"),
        }
    }
    for validator in Validator::ALL {
        assert!(
            Check::ALL.iter().any(|check| check.owner() == validator),
            "{validator} owns no check"
        );
        assert!(!validator.entry_point().is_empty());
    }
    // A code is one check's, whichever row reports it: the same code under
    // two validators (`private-endpoint`) is two checks, never one shared.
    let mut owners: BTreeMap<(Validator, &str), BTreeSet<Check>> = BTreeMap::new();
    for row in &rows {
        owners
            .entry((row.validator, row.code.as_str()))
            .or_default()
            .insert(row.check);
    }
    assert!(owners.values().all(|checks| checks.len() == 1));
}

#[test]
fn the_rw9_hand_off_checks_each_name_one_check_and_one_owner() {
    let hand_off = [
        ("missing reference", Check::CitationResolution),
        ("reference completeness", Check::ReferenceCompleteness),
        ("identifier", Check::IdentifierCompatibility),
        ("locator", Check::LocationReview),
        ("imprecise quotation", Check::QuotationLocation),
        ("version or translation", Check::VersionIdentity),
        ("citation consistency", Check::CitationConsistency),
        ("evidence relation", Check::EvidenceRelation),
        ("rights", Check::ComparisonRights),
        ("unresolved claim", Check::ClaimAnchoring),
    ];
    let checks: BTreeSet<Check> = hand_off.iter().map(|(_, check)| *check).collect();
    assert_eq!(
        checks.len(),
        hand_off.len(),
        "each hand-off is its own check"
    );
    for (name, check) in hand_off {
        assert!(Check::ALL.contains(&check), "{name}");
        let owners: BTreeSet<Validator> = matrix()
            .iter()
            .filter(|row| row.check == check)
            .map(|row| row.validator)
            .chain([check.owner()])
            .collect();
        assert_eq!(owners.len(), 1, "{name} has one owner");
    }
    // #193 adds its checks to one new validator, never to a presentation.
    assert_eq!(Check::VersionIdentity.owner(), Validator::SourceReview);
    assert_eq!(Validator::SourceReview.planned_in(), Some(193));
}

#[test]
fn outcomes_stay_distinct_and_only_detected_integrity_or_privacy_failures_refuse() {
    for row in matrix() {
        if row.gate != Gate::Advisory {
            assert_eq!(row.outcome, EvidenceOutcome::Detected, "{row:?}");
        }
        if row.outcome != EvidenceOutcome::Detected {
            assert_eq!(row.gate, Gate::Advisory, "{row:?}");
        }
        if row.gate == Gate::RefusesWhenPublished {
            assert_eq!(row.validator, Validator::CitationReview, "{row:?}");
        }
        if row.gate == Gate::Refuses {
            assert!(
                matches!(
                    row.check,
                    Check::LibraryIntegrity
                        | Check::NotebookIntegrity
                        | Check::AtlasIntegrity
                        | Check::ClaimsIntegrity
                        | Check::AlignmentsIntegrity
                ),
                "{row:?}"
            );
        }
    }
    let outcomes: BTreeSet<String> = matrix().iter().map(|r| r.outcome.to_string()).collect();
    assert_eq!(
        outcomes,
        BTreeSet::from(["detected".into(), "needs-review".into(), "potential".into()])
    );
    let report = CompletenessReport::new(everything(), &[]);
    let counted = report.counts.detected.found
        + report.counts.potential.found
        + report.counts.needs_review.found;
    assert_eq!(counted, report.findings.len());
    for (outcome, count) in [
        (EvidenceOutcome::Detected, report.counts.detected.found),
        (EvidenceOutcome::Potential, report.counts.potential.found),
        (
            EvidenceOutcome::NeedsReview,
            report.counts.needs_review.found,
        ),
    ] {
        assert!(count > 0, "{outcome}");
        let listed = report
            .findings
            .iter()
            .filter(|e| e.finding.outcome == outcome)
            .count();
        assert_eq!(listed, count, "{outcome}");
    }
}

#[test]
fn every_existing_finding_maps_into_its_matrix_row_with_its_own_words() {
    let rows = matrix();
    let findings = everything();
    for finding in &findings {
        let row = row_of(&rows, finding);
        assert_eq!(
            (row.check, row.category, row.outcome, row.gate),
            (
                finding.check,
                finding.category,
                finding.outcome,
                finding.gate
            ),
            "{finding:#?}"
        );
        assert!(!finding.message.is_empty() && !finding.repair.is_empty());
    }
    let seen: BTreeSet<(Validator, &str)> = findings
        .iter()
        .map(|f| (f.validator, f.code.as_str()))
        .collect();
    for expected in [
        (Validator::ResearchProfile, "doi-invalid"),
        (Validator::ResearchProfile, "abstract-missing"),
        (Validator::ResearchProfile, "footnote-unresolved"),
        (Validator::CitationReview, "citation-syntax"),
        (Validator::CitationReview, "citation-unresolved"),
        (Validator::CitationReview, "citation-reference-incomplete"),
        (Validator::CitationReview, "citation-location-review"),
        (Validator::ClaimReview, "claim-anchor-stale"),
        (Validator::ClaimReview, "claim-source-archived"),
        (Validator::ClaimReview, "claim-evidence-missing"),
        (Validator::Atlas, "private-endpoint"),
        (Validator::Claims, "private-endpoint"),
        (Validator::ChronologyIndex, "death-before-birth"),
        (Validator::Alignments, "stale-locator"),
        (Validator::ComparisonProjection, "withheld-rights"),
        (Validator::Notebook, "unknown-source"),
        (Validator::SourceLibrary, "unresolved-relationship"),
        (Validator::SourceLibrary, "invalid-json"),
        (Validator::Atlas, "invalid-json"),
    ] {
        assert!(seen.contains(&expected), "{expected:?} in {seen:#?}");
    }

    // Codes, outcomes, messages and repairs are the validator's own.
    let original = &claim_findings()[0];
    let mapped = CompletenessFinding::from_evidence(original);
    assert_eq!(mapped.code, original.code.to_string());
    assert_eq!(mapped.outcome, original.outcome);
    assert_eq!(mapped.message, original.message);
    assert_eq!(mapped.repair, original.repair);
}

#[test]
fn findings_are_scoped_to_one_object_and_name_related_ones() {
    let findings = everything();
    let find = |validator: Validator, code: &str| {
        findings
            .iter()
            .find(|f| f.validator == validator && f.code == code)
            .unwrap_or_else(|| panic!("{validator} {code}"))
    };

    let doi = find(Validator::ResearchProfile, "doi-invalid");
    assert_eq!(doi.scope.object, ObjectKind::Post);
    assert_eq!(doi.scope.path.as_deref(), Some("posts/r.md"));
    assert_eq!(doi.scope.field.as_deref(), Some("doi"));

    let archived = find(Validator::ClaimReview, "claim-source-archived");
    assert_eq!(archived.scope.object, ObjectKind::EvidenceLink);
    assert_eq!(archived.scope.id.as_deref(), Some("l1"));
    assert_eq!(archived.scope.path.as_deref(), Some("posts/cave.md"));
    assert_eq!(
        archived.related,
        [ObjectRef {
            kind: ObjectKind::Claim,
            id: "c1".into()
        }]
    );

    let stale = find(Validator::ClaimReview, "claim-anchor-stale");
    assert_eq!(
        (stale.scope.object, stale.scope.id.as_deref()),
        (ObjectKind::Claim, Some("c2"))
    );

    let endpoint = find(Validator::Atlas, "private-endpoint");
    assert_eq!(
        (
            endpoint.scope.object,
            endpoint.scope.id.as_deref(),
            endpoint.scope.index,
            endpoint.scope.field.as_deref()
        ),
        (
            ObjectKind::Relationship,
            Some("wrote"),
            Some(0),
            Some("from")
        )
    );
    let link = find(Validator::Claims, "private-endpoint");
    assert_eq!(
        (link.scope.object, link.scope.id.as_deref()),
        (ObjectKind::EvidenceLink, Some("l1"))
    );
    assert_eq!(link.category, Category::PublicBoundary);

    let prompt = find(Validator::ChronologyIndex, "death-before-birth");
    assert_eq!(
        (prompt.scope.object, prompt.scope.id.as_deref()),
        (ObjectKind::Entry, Some("plato"))
    );
    let datings: Vec<&str> = prompt.related.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(datings, ["died", "born"]);
    assert!(prompt.related.iter().all(|r| r.kind == ObjectKind::Dating));

    let place = find(Validator::Alignments, "stale-locator");
    assert_eq!(
        (place.scope.object, place.scope.id.as_deref()),
        (ObjectKind::Alignment, Some("cave"))
    );
    assert_eq!(place.scope.field.as_deref(), Some("members[0].locators"));

    let withheld = find(Validator::ComparisonProjection, "withheld-rights");
    assert_eq!(
        (withheld.scope.object, withheld.scope.id.as_deref()),
        (ObjectKind::Alignment, Some("cave"))
    );
    assert_eq!(withheld.scope.field.as_deref(), Some("members[1]"));
    assert_eq!(
        withheld.related,
        [ObjectRef {
            kind: ObjectKind::Source,
            id: "grube".into()
        }]
    );
}

#[test]
fn missing_details_stay_missing_and_the_check_supplies_the_next_action() {
    let findings = private_file_errors();
    let library_file = findings
        .iter()
        .find(|f| f.validator == Validator::SourceLibrary && f.code == "invalid-json")
        .expect("library-level diagnostic");
    assert_eq!(library_file.scope.object, ObjectKind::SourceLibrary);
    assert_eq!(
        (
            &library_file.scope.id,
            library_file.scope.index,
            &library_file.scope.path,
            library_file.scope.line
        ),
        (&None, None, &None, None)
    );
    assert_eq!(library_file.repair, Check::LibraryIntegrity.action());
    assert_eq!(library_file.gate, Gate::Refuses);

    let atlas_file = findings
        .iter()
        .find(|f| f.validator == Validator::Atlas)
        .expect("atlas-level diagnostic");
    assert_eq!(atlas_file.scope.object, ObjectKind::Atlas);
    assert!(atlas_file.scope.id.is_none() && atlas_file.scope.index.is_none());

    let record = findings
        .iter()
        .find(|f| f.code == "unresolved-relationship")
        .expect("record diagnostic");
    assert_eq!(
        (record.scope.object, record.scope.id.as_deref()),
        (ObjectKind::Source, Some("lost"))
    );
    assert_eq!(record.category, Category::Version);

    // A cited reference without a detail is reported by field, and its repair
    // says the detail is never filled in.
    let incomplete = everything()
        .into_iter()
        .find(|f| f.code == "citation-reference-incomplete")
        .expect("incomplete reference");
    assert!(incomplete.scope.field.is_some());
    assert!(incomplete.repair.contains("never fills in"));
}

#[test]
fn no_word_or_field_of_the_contract_claims_truth_credibility_consensus_or_fitness() {
    const VERDICTS: &[&str] = &[
        "true",
        "truth",
        "false",
        "correct",
        "incorrect",
        "verified",
        "verify",
        "credible",
        "credibility",
        "authoritative",
        "consensus",
        "fit",
        "ready",
        "readiness",
        "score",
        "accurate",
        "accuracy",
        "proven",
        "strong",
        "weak",
        "pass",
        "passed",
        "fail",
    ];
    let mut texts: Vec<&str> = Vec::new();
    texts.extend(Check::ALL.iter().map(|c| c.property()));
    texts.extend(Check::ALL.iter().map(|c| c.action()));
    texts.extend(Category::ALL.iter().map(|c| c.meaning()));
    for text in texts {
        for word in text
            .split(|c: char| !c.is_ascii_alphanumeric())
            .map(str::to_ascii_lowercase)
        {
            assert!(!VERDICTS.contains(&word.as_str()), "{word:?} in {text:?}");
        }
    }
    let report: Value = serde_json::from_str(&CompletenessReport::new(everything(), &[]).to_json())
        .expect("report json");
    let mut keys = BTreeSet::new();
    collect_keys(&report, &mut keys);
    for key in &keys {
        let key = key.to_ascii_lowercase();
        for verdict in VERDICTS
            .iter()
            .chain(&["total", "resolved", "rank", "grade"])
        {
            assert!(!key.contains(verdict), "field {key:?}");
        }
    }
    assert_eq!(
        report["counts"]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        ["detected", "needsReview", "potential"]
    );
}

fn collect_keys(value: &Value, keys: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                keys.insert(key.clone());
                collect_keys(value, keys);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| collect_keys(v, keys)),
        _ => {}
    }
}

#[test]
fn findings_carry_no_private_research_text() {
    let report = CompletenessReport::new(everything(), &[]).to_json();
    assert!(!report.contains(SECRET), "{report}");
}

#[test]
fn the_order_is_total_and_independent_of_arrival_and_duplicates_collapse() {
    let findings = everything();
    let forward = CompletenessReport::new(findings.clone(), &[]);
    let mut reversed = findings.clone();
    reversed.reverse();
    let mut rotated = findings.clone();
    rotated.rotate_left(findings.len() / 3);
    for other in [reversed, rotated] {
        assert_eq!(
            CompletenessReport::new(other, &[]).to_json(),
            forward.to_json()
        );
    }

    // The same validator run twice (a check and a rebuild) is one finding.
    let mut twice = findings.clone();
    twice.extend(findings.iter().cloned());
    assert_eq!(CompletenessReport::new(twice, &[]), forward);

    // Overlap is not duplication: two validators reporting the same code on
    // their own objects, or two checks on one post, are all kept.
    let endpoints: BTreeSet<_> = forward
        .findings
        .iter()
        .filter(|e| e.finding.code == "private-endpoint")
        .map(|e| e.finding.validator)
        .collect();
    assert_eq!(
        endpoints,
        BTreeSet::from([Validator::Atlas, Validator::Claims])
    );
    let on_post: BTreeSet<Check> = forward
        .findings
        .iter()
        .filter(|e| e.finding.scope.path.as_deref() == Some("posts/c.md"))
        .map(|e| e.finding.check)
        .collect();
    assert!(on_post.len() >= 3, "{on_post:?}");

    // Findings about one file stay together, in place order.
    let paths: Vec<Option<&str>> = forward
        .findings
        .iter()
        .map(|e| e.finding.scope.path.as_deref())
        .collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted);
    let lines: Vec<usize> = forward
        .findings
        .iter()
        .filter(|e| {
            e.finding.scope.path.as_deref() == Some("posts/c.md")
                && e.finding.scope.object == ObjectKind::Post
        })
        .filter_map(|e| e.finding.scope.line)
        .collect();
    assert!(lines.windows(2).all(|w| w[0] <= w[1]), "{lines:?}");
}

#[test]
fn an_acknowledgement_never_resolves_a_finding_and_counts_apart() {
    let findings = everything();
    let report = CompletenessReport::new(findings.clone(), &[]);
    let review = report
        .findings
        .iter()
        .find(|e| e.finding.code == "citation-location-review")
        .expect("location review")
        .finding
        .clone();
    let ack = Acknowledgement::of(&review).expect("advisory");
    let acknowledged = CompletenessReport::new(findings.clone(), &[ack]);
    let entry = acknowledged
        .findings
        .iter()
        .find(|e| e.finding == review)
        .expect("still listed");
    assert_eq!(entry.acknowledgement, Some(AcknowledgementState::Current));
    assert_eq!(acknowledged.findings.len(), report.findings.len());
    assert_eq!(
        acknowledged.counts.needs_review.found,
        report.counts.needs_review.found
    );
    assert_eq!(acknowledged.counts.needs_review.acknowledged, 1);
    assert_eq!(acknowledged.counts.detected.acknowledged, 0);
    assert_eq!(acknowledged.unmatched_acknowledgements, 0);

    // Integrity and privacy failures are corrected, never acknowledged.
    let refused = findings
        .iter()
        .find(|f| f.gate == Gate::Refuses)
        .expect("refusing finding");
    assert_eq!(Acknowledgement::of(refused), None);
    let forged = Acknowledgement {
        validator: refused.validator,
        code: refused.code.clone(),
        object: refused.scope.object,
        id: refused.scope.id.clone(),
        field: refused.scope.field.clone(),
        fingerprint: refused.fingerprint(),
    };
    let report = CompletenessReport::new(findings.clone(), &[forged]);
    assert!(report.findings.iter().all(|e| e.acknowledgement.is_none()));
    assert_eq!(report.unmatched_acknowledgements, 1);
    let published = findings
        .iter()
        .find(|f| f.gate == Gate::RefusesWhenPublished)
        .expect("citation syntax");
    assert_eq!(Acknowledgement::of(published), None);
}

#[test]
fn acknowledgements_go_stale_when_the_source_changes_and_drop_when_resolved() {
    // A new located citation changes what the location prompt says.
    let one = CompletenessFinding::from_evidence(
        citation_findings("A [@burnet, canonical 514a] place.\n")
            .iter()
            .find(|f| f.code == EvidenceCode::CitationLocationReview)
            .expect("one located citation"),
    );
    let ack = Acknowledgement::of(&one).expect("advisory");
    let two: Vec<CompletenessFinding> =
        citation_findings("A [@burnet, canonical 514a] place.\nAnd [@burnet, canonical 515b].\n")
            .iter()
            .map(CompletenessFinding::from_evidence)
            .collect();
    let report = CompletenessReport::new(two, std::slice::from_ref(&ack));
    let entry = report
        .findings
        .iter()
        .find(|e| e.finding.code == "citation-location-review")
        .expect("location review");
    assert_eq!(entry.acknowledgement, Some(AcknowledgementState::Stale));
    assert_eq!(report.counts.needs_review.acknowledged, 0);

    // A dating's stated value changes: the prompt's acknowledgement is stale.
    let prompt = |year| {
        ChronologyIndex::of(&chronology_atlas(year))
            .prompts
            .iter()
            .map(CompletenessFinding::from_chronology_prompt)
            .collect::<Vec<_>>()
    };
    let before = prompt(-410);
    let ack = Acknowledgement::of(&before[0]).expect("advisory");
    let same = CompletenessReport::new(prompt(-410), std::slice::from_ref(&ack));
    assert_eq!(
        same.findings[0].acknowledgement,
        Some(AcknowledgementState::Current)
    );
    let after = CompletenessReport::new(prompt(-420), std::slice::from_ref(&ack));
    assert_eq!(
        after.findings[0].acknowledgement,
        Some(AcknowledgementState::Stale)
    );

    // The author records what was missing: the finding disappears, and the
    // acknowledgement matches nothing; it is never shown as "resolved".
    let resolved = CompletenessReport::new(prompt(-300), std::slice::from_ref(&ack));
    assert!(resolved.findings.is_empty());
    assert_eq!(resolved.unmatched_acknowledgements, 1);

    // Two advisory findings under one key: an acknowledgement of one leaves
    // the other unacknowledged rather than stale.
    let doc = frontmatter::parse(
        "---
title: T
profile: research
---
A[^1] and B[^2].
",
    )
    .expect("front matter");
    let footnotes: Vec<CompletenessFinding> =
        audit_document("posts/r.md", &doc.front_matter, &doc.body, doc.body_line)
            .iter()
            .map(CompletenessFinding::from_evidence)
            .filter(|f| f.code == "footnote-unresolved")
            .collect();
    assert_eq!(footnotes.len(), 2);
    let first = Acknowledgement::of(&footnotes[0]).expect("advisory");
    let report = CompletenessReport::new(footnotes.clone(), &[first]);
    let states: Vec<Option<AcknowledgementState>> =
        report.findings.iter().map(|e| e.acknowledgement).collect();
    assert_eq!(
        states.iter().filter(|s| s.is_some()).count(),
        1,
        "{states:?}"
    );
    assert!(states.contains(&Some(AcknowledgementState::Current)));
}

#[test]
fn serialization_is_compatible_and_versioned() {
    // Existing finding JSON is unchanged by the contract.
    let finding = EvidenceFinding {
        code: EvidenceCode::ClaimLocationUnreviewed,
        outcome: EvidenceOutcome::NeedsReview,
        source: EvidenceSource {
            path: "posts/cave.md".into(),
            line: None,
            column: None,
            field: Some("links[l1].reviewState".into()),
        },
        message: "m".into(),
        repair: "r".into(),
        object: Some(openblog_core::research::EvidenceObject {
            claim: "c1".into(),
            link: Some("l1".into()),
        }),
    };
    assert_eq!(
        serde_json::to_string(&finding).unwrap(),
        r#"{"code":"claim-location-unreviewed","outcome":"needs-review","source":{"path":"posts/cave.md","line":null,"column":null,"field":"links[l1].reviewState"},"message":"m","repair":"r","object":{"claim":"c1","link":"l1"}}"#
    );

    let mapped = CompletenessFinding::from_evidence(&finding);
    let report = CompletenessReport::new([mapped.clone()], &[]);
    let fingerprint = mapped.fingerprint();
    assert_eq!(fingerprint.len(), 32);
    assert_eq!(
        report.to_json(),
        format!(
            r#"{{
  "version": {COMPLETENESS_FORMAT_VERSION},
  "findings": [
    {{
      "validator": "claim-review",
      "check": "evidence-location",
      "code": "claim-location-unreviewed",
      "category": "locator",
      "outcome": "needs-review",
      "gate": "advisory",
      "scope": {{
        "object": "evidence-link",
        "id": "l1",
        "path": "posts/cave.md",
        "field": "links[l1].reviewState"
      }},
      "related": [
        {{
          "kind": "claim",
          "id": "c1"
        }}
      ],
      "message": "m",
      "repair": "r",
      "fingerprint": "{fingerprint}"
    }}
  ],
  "counts": {{
    "detected": {{
      "found": 0,
      "acknowledged": 0
    }},
    "potential": {{
      "found": 0,
      "acknowledged": 0
    }},
    "needsReview": {{
      "found": 1,
      "acknowledged": 0
    }}
  }},
  "unmatchedAcknowledgements": 0
}}
"#
        )
    );

    // The fingerprint is stable across runs and builds.
    assert_eq!(
        CompletenessFinding::from_evidence(&finding).fingerprint(),
        fingerprint
    );

    // Acknowledgements round-trip and refuse unknown fields.
    let ack = Acknowledgement::of(&mapped).expect("advisory");
    let text = serde_json::to_string(&ack).unwrap();
    assert_eq!(
        text,
        format!(
            r#"{{"validator":"claim-review","code":"claim-location-unreviewed","object":"evidence-link","id":"l1","field":"links[l1].reviewState","fingerprint":"{fingerprint}"}}"#
        )
    );
    assert_eq!(serde_json::from_str::<Acknowledgement>(&text).unwrap(), ack);
    let mut extra: Value = serde_json::from_str(&text).unwrap();
    extra["resolved"] = json!(true);
    assert!(serde_json::from_str::<Acknowledgement>(&extra.to_string()).is_err());
}

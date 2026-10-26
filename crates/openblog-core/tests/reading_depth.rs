//! Author-approved supplements and reading modes (ADRs 0170 and 0171): the
//! marker grammar, nesting, unknown kinds, hand-written Markdown, the
//! standard-mode byte-for-byte guarantee, mode invariants, escaping, and the
//! portable and no-JavaScript representations.

use std::collections::BTreeMap;

use openblog_core::markdown::{render, RenderOptions};
use openblog_core::portability::PortableProjection;
use openblog_core::reading_depth::{scan, Depth, Kind, ReadingMode, MAX_NESTING, MAX_SUPPLEMENTS};
use openblog_core::source_library::SourceLibrary;
use openblog_core::{model, SiteConfig, SourceFile};

const ARTICLE: &str = "# Title\n\nThe argument begins here.[^n]\n\n\
> [!supplement kind=definition level=guided] Aporia\n> A state of puzzlement.\n\n\
The argument goes on.\n\n\
> [!supplement kind=evidence level=deep-dive] The manuscripts\n> Three witnesses agree.\n>\n\
> > [!supplement kind=further-reading]\n> > Read the edition.\n\n\
> An ordinary quote stays a quote.\n\n\
[^n]: A footnote.\n";

fn on() -> RenderOptions<'static> {
    RenderOptions {
        supplements: true,
        ..RenderOptions::default()
    }
}

fn config() -> SiteConfig {
    SiteConfig::from_json(
        r#"{"title": "T", "url": "https://example.test", "author": {"name": "A"}}"#,
    )
    .unwrap()
}

fn post_source(front: &str, body: &str) -> SourceFile {
    SourceFile {
        path: "posts/p.md".into(),
        contents: format!("---\ntitle: P\ndate: 2026-10-20\n{front}---\n{body}"),
    }
}

#[test]
fn modes_show_supplements_cumulatively_and_standard_shows_none() {
    assert!(!ReadingMode::Standard.shows(Depth::Guided));
    assert!(!ReadingMode::Standard.shows(Depth::DeepDive));
    assert!(ReadingMode::Guided.shows(Depth::Guided));
    assert!(!ReadingMode::Guided.shows(Depth::DeepDive));
    assert!(ReadingMode::DeepDive.shows(Depth::Guided));
    assert!(ReadingMode::DeepDive.shows(Depth::DeepDive));
    assert_eq!(ReadingMode::parse("deep-dive"), Some(ReadingMode::DeepDive));
    assert_eq!(ReadingMode::parse("deep"), None);
    assert_eq!(ReadingMode::parse("Guided"), None);
}

#[test]
fn nested_supplements_are_read_in_order_with_parents_and_effective_depth() {
    let depth = scan(ARTICLE);
    assert!(depth.findings.is_empty(), "{:?}", depth.findings);
    let ids: Vec<_> = depth.supplements.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        ["ob-supplement-1", "ob-supplement-2", "ob-supplement-3"]
    );
    let [definition, evidence, reading] = &depth.supplements[..] else {
        panic!()
    };
    assert_eq!(definition.kind, Kind::Definition);
    assert_eq!(definition.title.as_deref(), Some("Aporia"));
    assert_eq!(evidence.depth, Depth::DeepDive);
    assert_eq!(reading.parent.as_deref(), Some("ob-supplement-2"));
    assert!(reading.depth_defaulted);
    assert_eq!(reading.effective_depth, Depth::DeepDive);
    assert_eq!(reading.nesting, 2);
    let shown = |mode| {
        depth
            .visible(mode)
            .iter()
            .map(|s| s.id.clone())
            .collect::<Vec<_>>()
    };
    assert!(shown(ReadingMode::Standard).is_empty());
    assert_eq!(shown(ReadingMode::Guided), ["ob-supplement-1"]);
    assert_eq!(shown(ReadingMode::DeepDive).len(), 3);
}

#[test]
fn a_child_is_never_shown_without_its_parent() {
    let depth = scan(
        "> [!supplement kind=evidence level=deep-dive]\n> Deep.\n>\n> > [!supplement kind=definition level=guided]\n> > Short.\n",
    );
    let child = &depth.supplements[1];
    assert_eq!(child.depth, Depth::Guided);
    assert_eq!(child.effective_depth, Depth::DeepDive);
    assert_eq!(depth.findings.len(), 1);
    assert!(depth.visible(ReadingMode::Guided).is_empty());
}

#[test]
fn kinds_default_their_level_and_unknown_kinds_are_kept() {
    let depth = scan(
        "> [!supplement kind=context]\n> a\n\n> [!supplement kind=comparison]\n> b\n\n> [!supplement kind=marginalia-2]\n> c\n\n> [!supplement]\n> d\n",
    );
    let levels: Vec<_> = depth.supplements.iter().map(|s| s.depth).collect();
    assert_eq!(
        levels,
        [
            Depth::Guided,
            Depth::DeepDive,
            Depth::DeepDive,
            Depth::DeepDive
        ]
    );
    assert_eq!(depth.supplements[2].kind, Kind::Other);
    assert_eq!(depth.supplements[2].kind_token, "marginalia-2");
    assert_eq!(depth.supplements[3].kind_token, "supplement");
}

#[test]
fn hand_written_variants_read_tolerantly() {
    let depth = scan(
        "> [!SUPPLEMENT  Kind=Definition   LEVEL=GUIDED   future=x]   Spaced title  \n> body\n\n> [!supplement kind=context]Title no space\n> body\n\n> [!supplement kind=context]\n",
    );
    assert!(depth.findings.is_empty(), "{:?}", depth.findings);
    assert_eq!(depth.supplements.len(), 3);
    assert_eq!(depth.supplements[0].title.as_deref(), Some("Spaced title"));
    assert_eq!(
        depth.supplements[1].title.as_deref(),
        Some("Title no space")
    );
    assert_eq!(depth.supplements[2].title, None);
}

#[test]
fn a_marker_that_cannot_be_read_stays_a_quote_and_is_reported_alone() {
    for bad in [
        "> [!supplement kind=Bad_Kind]\n> body\n",
        "> [!supplement level=expert]\n> body\n",
        "> [!supplement kind=a kind=b]\n> body\n",
        "> [!supplement kind]\n> body\n",
        "> [!supplement kind=definition\n> body\n",
        "> [!supplement kind=definition] with *emphasis*\n> body\n",
    ] {
        let depth = scan(bad);
        assert!(depth.supplements.is_empty(), "{bad}");
        assert_eq!(depth.findings.len(), 1, "{bad}");
        let html = render(bad, on()).html;
        assert!(html.starts_with("<blockquote>"), "{bad}: {html}");
        assert!(html.contains("body"), "{bad}");
    }
    // A scoped failure: the readable marker next to the broken one still works.
    let depth = scan("> [!supplement kind=Bad_Kind]\n> x\n\n> [!supplement kind=context]\n> y\n");
    assert_eq!(depth.supplements.len(), 1);
    assert_eq!(depth.findings.len(), 1);
    // Not a marker at all: no finding.
    let depth = scan("> [!supplementary] words\n\n> [!NOTE]\n> n\n\n> plain\n");
    assert!(depth.supplements.is_empty() && depth.findings.is_empty());
}

#[test]
fn markers_in_code_are_not_supplements() {
    let depth = scan(
        "```\n> [!supplement kind=context]\n> x\n```\n\n    > [!supplement kind=context]\n\n`> [!supplement]`\n",
    );
    assert!(depth.supplements.is_empty() && depth.findings.is_empty());
}

#[test]
fn limits_leave_the_excess_as_quotes() {
    let mut deep = String::new();
    for level in 1..=MAX_NESTING + 1 {
        deep.push_str(&format!(
            "{}[!supplement kind=context]\n{}\n",
            "> ".repeat(level),
            "> ".repeat(level).trim_end()
        ));
    }
    let depth = scan(&deep);
    assert_eq!(depth.supplements.len(), MAX_NESTING);
    assert_eq!(depth.findings.len(), 1);

    let many = "> [!supplement kind=context]\n> x\n\n".repeat(MAX_SUPPLEMENTS + 5);
    let depth = scan(&many);
    assert_eq!(depth.supplements.len(), MAX_SUPPLEMENTS);
    assert_eq!(depth.findings.len(), 5);

    let huge = "x".repeat(2 * 1024 * 1024);
    assert!(scan(&huge).supplements.is_empty());
    assert_eq!(scan(&huge).findings.len(), 1);
}

#[test]
fn without_supplements_the_output_is_byte_for_byte_the_legacy_output() {
    let plain = "# Title\n\nWords [a link](https://example.test) here.\n\n> A quote.\n>\n> > Inner.\n\n> [!NOTE]\n> A note.\n\n- one\n- two\n\n## Next\n\nMore.\n";
    let legacy = render(plain, RenderOptions::default());
    let opted = render(plain, on());
    assert_eq!(legacy.html, opted.html);
    assert_eq!(legacy.text, opted.text);
    assert_eq!(legacy.prose, opted.prose);
    assert_eq!(legacy.word_count, opted.word_count);
    assert_eq!(legacy.capabilities, opted.capabilities);
    assert!(opted.reading_depth.unwrap().is_empty());
    assert!(legacy.reading_depth.is_none());
}

#[test]
fn a_post_that_has_not_opted_in_renders_its_markers_as_ordinary_quotes() {
    let rendered = render(ARTICLE, RenderOptions::default());
    assert!(!rendered.html.contains("ob-supplement"));
    assert!(rendered
        .html
        .contains("[!supplement kind=definition level=guided] Aporia"));
    assert!(rendered.capabilities.is_empty());
}

#[test]
fn supplements_are_labelled_groups_in_document_order_with_no_javascript() {
    let html = render(ARTICLE, on()).html;
    let first = html.find("id=\"ob-supplement-1\"").unwrap();
    let second = html.find("id=\"ob-supplement-2\"").unwrap();
    let third = html.find("id=\"ob-supplement-3\"").unwrap();
    assert!(first < second && second < third);
    // Complete without JavaScript: every supplement is visible static
    // content, with no `hidden` attribute written by the build.
    assert!(!html.contains("hidden"));
    assert!(html.contains("A state of puzzlement."));
    assert!(html.contains("Three witnesses agree."));
    assert!(html.contains("Read the edition."));
    assert!(html.contains("role=\"group\" aria-labelledby=\"ob-supplement-1-label\""));
    assert!(html.contains("<strong class=\"ob-supplement-kind\">Definition</strong> <span class=\"ob-supplement-level\">guided supplement</span> <span class=\"ob-supplement-title\">Aporia</span>"));
    assert!(html.contains("data-ob-kind=\"further-reading\" data-ob-level=\"deep-dive\""));
    // The marker text is replaced by the label, never shown twice.
    assert!(!html.contains("[!supplement"));
    // The ordinary quote is untouched.
    assert!(html.contains("<blockquote>\n<p>An ordinary quote stays a quote.</p>\n</blockquote>"));
    assert_eq!(html.matches("<div").count(), html.matches("</div>").count());
}

#[test]
fn the_canonical_argument_is_the_same_whatever_the_supplements() {
    let with = render(ARTICLE, on());
    let without = "# Title\n\nThe argument begins here.[^n]\n\nThe argument goes on.\n\n\
> An ordinary quote stays a quote.\n\n[^n]: A footnote.\n";
    let bare = render(without, on());
    // Supplements are not the post's own words.
    assert_eq!(with.prose, bare.prose);
    assert_eq!(with.word_count, bare.word_count);
    // Search still sees them.
    assert!(with.text.contains("A state of puzzlement."));
    assert_eq!(with.headings, bare.headings);
}

#[test]
fn headings_inside_supplements_do_not_join_the_outline() {
    let rendered = render(
        "## Real\n\n> [!supplement kind=context]\n> ## Inside\n> text\n",
        on(),
    );
    assert_eq!(rendered.headings.len(), 1);
    assert_eq!(rendered.headings[0].text, "Real");
    assert!(rendered
        .html
        .contains("<p class=\"ob-supplement-heading\"><strong>Inside</strong></p>"));
}

#[test]
fn hostile_titles_and_bodies_are_escaped() {
    let rendered = render(
        "> [!supplement kind=context] \\<img src=x onerror=alert(1)\\> \"q\" & \\<script\\>\n> body\n",
        on(),
    );
    assert!(!rendered.html.contains("<img"));
    assert!(!rendered.html.contains("<script"));
    assert!(rendered.html.contains("&lt;img src=x onerror=alert(1)&gt;"));
    assert!(rendered.html.contains("&amp;"));
}

#[test]
fn output_is_deterministic() {
    let a = render(ARTICLE, on());
    let b = render(ARTICLE, on());
    assert_eq!(a.html, b.html);
    assert_eq!(a.reading_depth, b.reading_depth);
    assert_eq!(scan(ARTICLE), scan(ARTICLE));
}

#[test]
fn a_post_opts_in_with_a_front_matter_key_and_reports_the_capability() {
    let config = config();
    let plain =
        model::load_post(&post_source("", ARTICLE), &config, config.render_options()).unwrap();
    assert!(plain.reading_depth().is_none());
    assert!(plain.capabilities.is_empty());
    assert!(!plain.html.contains("ob-supplement"));

    for key in ["readingModes: true\n", "reading_modes: yes\n"] {
        let post =
            model::load_post(&post_source(key, ARTICLE), &config, config.render_options()).unwrap();
        assert_eq!(post.reading_depth().unwrap().supplements.len(), 3);
        assert!(post
            .capabilities
            .iter()
            .any(|c| c.id == "guided-reading-supplements" && c.has_portable_fallback()));
        assert!(post.html.contains("id=\"ob-supplement-1\""));
    }
    // Opted in with no markers: the same HTML as a post that never opted in.
    let body = "Just words.\n\n> A quote.\n";
    let off = model::load_post(&post_source("", body), &config, config.render_options()).unwrap();
    let empty = model::load_post(
        &post_source("readingModes: true\n", body),
        &config,
        config.render_options(),
    )
    .unwrap();
    assert_eq!(off.html, empty.html);
    assert!(empty.capabilities.is_empty());
}

#[test]
fn portable_copies_keep_every_supplement_labelled_and_in_place() {
    let config = config();
    let post = model::load_post(
        &post_source("readingModes: true\n", ARTICLE),
        &config,
        config.render_options(),
    )
    .unwrap();
    let projection = PortableProjection::from_post(&post, &config).unwrap();
    let html = projection.portable_html().unwrap().html;
    for words in [
        "A state of puzzlement.",
        "Three witnesses agree.",
        "Read the edition.",
    ] {
        assert!(html.contains(words), "{words}: {html}");
    }
    assert!(html.contains("Definition"), "{html}");
    assert!(!html.contains("hidden"));
    assert!(!html.contains("Guided explanations"), "{html}");
    let markdown = projection.portable_markdown().unwrap();
    // The marker line is a readable quote in any Markdown reader.
    assert!(
        markdown.contains("[!supplement kind=definition level=guided]"),
        "{markdown}"
    );
    assert!(markdown.contains("A state of puzzlement."));
    let text = projection.portable_text().unwrap();
    assert!(text.contains("A state of puzzlement."));
}

#[test]
fn citations_inside_supplements_keep_the_posts_one_reference_list() {
    let library = SourceLibrary::parse(
        r#"{"version": 1, "sources": [
            {"id": "plato", "kind": "work", "title": "Politeia", "creators": [{"name": "Plato", "role": "author"}]},
            {"id": "slings", "kind": "work", "title": "Slings"}]}"#,
        &BTreeMap::new(),
    )
    .unwrap();
    let config = config();
    let with = post_source(
        "readingModes: true\ncitations: notes\n",
        "Argument [@plato].\n\n> [!supplement kind=evidence]\n> More in [@slings].\n",
    );
    let post =
        model::load_post_cited(&with, &config, config.render_options(), Some(&library)).unwrap();
    // Both references are published whatever the mode, in citation order.
    let summary = post.citations().unwrap();
    assert_eq!(summary.references.len(), 2);
    assert!(post.html.contains("Politeia") && post.html.contains("Slings"));
}

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
fn headings_inside_supplements_are_real_headings_outside_the_outline() {
    let rendered = render(
        "## Plato\n\n> [!supplement kind=context]\n> ## Plato\n> text\n\n## Plato\n",
        on(),
    );
    // Not in the outline, and the post's own slugs are what they would be
    // without the supplement: the second "Plato" is `plato-2`, not `plato-3`.
    let ids: Vec<_> = rendered.headings.iter().map(|h| h.id.as_str()).collect();
    assert_eq!(ids, ["plato", "plato-2"]);
    // Inside it stays a real heading with an anchor of its own.
    assert!(
        rendered
            .html
            .contains("<h2 id=\"ob-supplement-1-h1\">Plato</h2>"),
        "{}",
        rendered.html
    );
    assert!(!rendered.html.contains("ob-supplement-heading"));
    // A heading the author gave an id keeps it.
    let written = render("> [!supplement kind=context]\n> ### Deep {#mine}\n", on());
    assert!(written.html.contains("<h3 id=\"mine\">Deep</h3>"));
    assert!(written.headings.is_empty());
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

#[test]
fn a_heading_slug_never_takes_the_supplements_reserved_names() {
    let rendered = render(
        "## Ob supplement 1\n\n> [!supplement kind=context]\n> x\n",
        on(),
    );
    assert_eq!(rendered.headings[0].id, "section-ob-supplement-1");
    assert_eq!(rendered.html.matches("id=\"ob-supplement-1\"").count(), 1);
}

const PLATO_LIBRARY: &str = r#"{"version": 1, "sources": [
    {"id": "plato", "kind": "work", "title": "Politeia", "creators": [{"name": "Plato", "role": "author"}]},
    {"id": "slings", "kind": "work", "title": "Slings"}]}"#;

fn cited(body: &str) -> openblog_core::Post {
    let library = SourceLibrary::parse(PLATO_LIBRARY, &BTreeMap::new()).unwrap();
    let config = config();
    model::load_post_cited(
        &post_source("readingModes: true\ncitations: notes\n", body),
        &config,
        config.render_options(),
        Some(&library),
    )
    .unwrap()
}

#[test]
fn a_citation_marker_trimmed_inside_a_supplement_does_not_break_the_posts_own_text() {
    // The panic: the marker's gap is trimmed from the text, so byte ranges
    // recorded before the trim no longer fell on character boundaries.
    for quoted in [
        "> As he wrote, \u{201c}justice [@plato]\u{201d} matters.",
        "> As he wrote, \"justice [@plato]\" matters.",
        "> As he wrote, justice [@plato], matters.",
        "> As he wrote, caf\u{e9} \u{2014} justice [@plato]. Matters.",
    ] {
        let post = cited(&format!(
            "Before.\n\n> [!supplement kind=evidence]\n{quoted}\n\nAfter [@slings].\n"
        ));
        let bare = cited("Before.\n\nAfter [@slings].\n");
        // The supplement is not the post's own words, whatever it holds.
        assert_eq!(post.word_count, bare.word_count, "{quoted}");
        assert_eq!(post.description, bare.description, "{quoted}");
        assert!(post.description.starts_with("Before. After"), "{quoted}");
        assert!(!post.description.contains("justice"), "{quoted}");
        // Search still sees them, with the marker gap trimmed as everywhere.
        assert!(post.text.contains("As he wrote"), "{quoted}");
        assert!(
            !post.text.contains(" ,") && !post.text.contains(" \u{201d}"),
            "{quoted}: {}",
            post.text
        );
    }
}

#[test]
fn supplement_words_stay_aligned_when_a_citation_precedes_and_follows_one() {
    let post = cited(
        "Claim [@plato]. More.\n\n> [!supplement kind=context]\n> Inside [@slings], and \u{201c}more\u{201d} [@plato].\n\nEnd [@plato].\n",
    );
    assert_eq!(post.description, "Claim. More. End.");
    assert_eq!(post.word_count, 3);
}

#[test]
fn lists_inside_a_supplement_are_not_the_recipes_ingredients_or_steps() {
    let markdown = "## Ingredients\n\n- 1 cup flour\n- 2 eggs\n\n\
> [!supplement kind=context] Notes\n> - a list in a supplement\n> - another\n>\n> 1. numbered in a supplement\n\n\
## Steps\n\n1. Mix.\n2. Bake.\n\n\
> [!supplement kind=evidence]\n> 1. A history of baking.\n";
    let rendered = render(
        markdown,
        RenderOptions {
            recipe: true,
            supplements: true,
            ..RenderOptions::default()
        },
    );
    assert_eq!(rendered.recipe_ingredients, ["1 cup flour", "2 eggs"]);
    assert_eq!(rendered.recipe_steps, ["Mix.", "Bake."]);
    // The supplements are still there, whole, and balanced with the sections.
    assert!(rendered.html.contains("a list in a supplement"));
    assert!(rendered.html.contains("A history of baking."));
    assert_eq!(
        rendered.html.matches("<section").count(),
        rendered.html.matches("</section>").count()
    );
}

#[test]
fn a_supplement_has_a_visible_boundary_in_every_representation() {
    let html = render(ARTICLE, on()).html;
    // A quote inside the labelled group, then an end marker that needs no CSS.
    assert!(
        html.contains("</p>\n<blockquote>\n<p>A state of puzzlement.</p>\n</blockquote>\n<p class=\"ob-supplement-end\"><strong>End of definition supplement.</strong></p>\n</div>"),
        "{html}"
    );
    assert!(html.contains("End of further reading supplement."));
    assert!(html.contains("End of evidence supplement."));
    let config = config();
    let post = model::load_post(
        &post_source("readingModes: true\n", ARTICLE),
        &config,
        config.render_options(),
    )
    .unwrap();
    // The text view (search, plain text, JSON Feed `content_text`).
    let start = post
        .text
        .find("Definition supplement (guided): Aporia.")
        .unwrap();
    let words = post.text.find("A state of puzzlement.").unwrap();
    let end = post.text.find("End of definition supplement.").unwrap();
    assert!(start < words && words < end, "{}", post.text);
    let projection = PortableProjection::from_post(&post, &config).unwrap();
    let text = projection.portable_text().unwrap();
    assert!(text.contains("End of definition supplement."), "{text}");
    let portable = projection.portable_html().unwrap().html;
    assert!(portable.contains("<strong>End of definition supplement.</strong>"));
    assert!(portable.contains("<blockquote>"));
    // Titles are searchable but are not the post's prose.
    assert!(post.text.contains("Aporia"));
    assert!(!post.description.contains("Aporia"));
}

#[test]
fn findings_are_surfaced_with_the_post_path_in_the_sites_warnings() {
    let load = |body: &str| {
        model::Site::load(
            config(),
            openblog_core::Sources {
                posts: vec![post_source("readingModes: true\n", body)],
                ..Default::default()
            },
            openblog_core::LoadOptions::default(),
        )
        .unwrap()
    };
    let site = load("> [!supplement kind=Bad_Kind]\n> x\n\n> [!supplement kind=context]\n> fine\n");
    let warning = site
        .warnings
        .iter()
        .find(|warning| warning.contains("reading modes"))
        .unwrap_or_else(|| panic!("{:?}", site.warnings));
    assert!(warning.starts_with("posts/p.md: "), "{warning}");
    assert!(warning.contains("[!supplement kind=Bad_Kind]"), "{warning}");
    assert!(warning.contains("shown as a block quote"), "{warning}");
    // Nothing of the quote's body is in the warning.
    assert!(!warning.contains("fine"));
    // A site with nothing to report has no such warning.
    let quiet = load("> [!supplement kind=context]\n> fine\n");
    assert!(!quiet.warnings.iter().any(|w| w.contains("reading modes")));
}

#[test]
fn an_over_long_title_or_kind_is_reported_with_its_own_message_and_stays_a_quote() {
    let title = format!("> [!supplement kind=context] {}\n> body\n", "t".repeat(121));
    let depth = scan(&title);
    assert!(depth.supplements.is_empty());
    assert_eq!(depth.findings.len(), 1);
    assert!(depth.findings[0]
        .message
        .contains("title is longer than 120"));
    assert!(render(&title, on()).html.starts_with("<blockquote>"));
    // The full title is allowed at the limit.
    let at_limit = scan(&format!(
        "> [!supplement kind=context] {}\n> body\n",
        "t".repeat(120)
    ));
    assert_eq!(at_limit.supplements[0].title.as_deref().unwrap().len(), 120);
    let kind = scan(&format!(
        "> [!supplement kind={}]\n> body\n",
        "k".repeat(33)
    ));
    assert!(kind.findings[0].message.contains("kind is longer than 32"));
    let bad = scan("> [!supplement kind=Bad_Kind]\n> body\n");
    assert!(bad.findings[0].message.contains("lowercase word"));
}

#[test]
fn only_a_written_level_that_a_parent_overrides_is_reported() {
    let written = scan(
        "> [!supplement kind=evidence level=deep-dive]\n> a\n>\n> > [!supplement kind=definition level=guided]\n> > b\n",
    );
    assert_eq!(written.findings.len(), 1);
    let defaulted = scan(
        "> [!supplement kind=evidence level=deep-dive]\n> a\n>\n> > [!supplement kind=definition]\n> > b\n",
    );
    assert!(defaulted.findings.is_empty(), "{:?}", defaulted.findings);
    assert_eq!(defaulted.supplements[1].effective_depth, Depth::DeepDive);
}

#[test]
fn an_escaped_marker_is_an_ordinary_quote() {
    let slash = char::from(92u8);
    for escaped in [
        format!("> {slash}[!supplement kind=context] Title\n> body\n"),
        format!("> {slash}[!SUPPLEMENT]\n> body\n"),
    ] {
        let depth = scan(&escaped);
        assert!(
            depth.supplements.is_empty() && depth.findings.is_empty(),
            "{escaped}"
        );
        let html = render(&escaped, on()).html;
        assert!(html.starts_with("<blockquote>"), "{html}");
        assert!(
            html.contains("[!"),
            "the author's literal text stays: {html}"
        );
        assert!(!html.contains("ob-supplement"));
    }
    // Unescaped still reads.
    assert_eq!(
        scan("> [!supplement kind=context]\n> body\n")
            .supplements
            .len(),
        1
    );
}

#[test]
fn a_warning_inside_a_supplement_keeps_it_shown_in_every_mode_and_is_reported() {
    let markdown = "> [!supplement kind=evidence level=deep-dive] Handling\n> Notes.\n>\n> > [!WARNING]\n> > Do not heat the mixture.\n\n\
> [!supplement kind=context]\n> Fine.\n>\n> > [!CAUTION]\n> > Sharp.\n\n\
> [!supplement kind=definition level=deep-dive]\n> > [!NOTE]\n> > An ordinary note.\n";
    let depth = scan(markdown);
    let [warned, cautioned, noted] = &depth.supplements[..] else {
        panic!("{:?}", depth.supplements)
    };
    assert!(warned.always && cautioned.always && !noted.always);
    assert_eq!(depth.findings.len(), 2, "{:?}", depth.findings);
    assert!(depth.findings[0].message.contains("every reading mode"));
    // Standard mode shows them anyway; it hides only the note-only one.
    let shown = |mode| {
        depth
            .visible(mode)
            .iter()
            .map(|s| s.id.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        shown(ReadingMode::Standard),
        ["ob-supplement-1", "ob-supplement-2"]
    );
    let html = render(markdown, on()).html;
    assert_eq!(html.matches("data-ob-always").count(), 2);
    assert!(html.contains("role=\"note\""));
    assert!(html.contains("Do not heat the mixture."));
    // A warning in a nested supplement keeps its parent shown too.
    let nested = scan(
        "> [!supplement kind=evidence]\n> a\n>\n> > [!supplement kind=context]\n> > b\n> >\n> > > [!WARNING]\n> > > careful\n",
    );
    assert!(nested.supplements.iter().all(|s| s.always));
    // A warning outside any supplement is not this rule's business.
    assert!(
        scan("> [!WARNING]\n> hot\n\n> [!supplement kind=context]\n> x\n")
            .supplements
            .iter()
            .all(|s| !s.always)
    );
}

#[test]
fn the_front_matter_key_is_read_tolerantly_and_a_map_never_switches_the_post_off() {
    use openblog_core::reading_depth::setting;
    assert!(!setting(None).enabled);
    for yes in ["true", "True", "yes", "on", " true "] {
        let read = setting(Some(yes));
        assert!(
            read.enabled && read.default_mode == ReadingMode::Standard && read.warning.is_none()
        );
    }
    for no in ["false", "no", "off"] {
        let read = setting(Some(no));
        assert!(!read.enabled && read.warning.is_none(), "{no}");
    }
    for (value, mode) in [
        ("{default: guided}", ReadingMode::Guided),
        ("{ default: deep-dive }", ReadingMode::DeepDive),
        ("{\"default\": \"standard\"}", ReadingMode::Standard),
        ("{default: guided, other: 1}", ReadingMode::Guided),
        ("{other: 1}", ReadingMode::Standard),
        ("{}", ReadingMode::Standard),
        ("guided", ReadingMode::Guided),
    ] {
        let read = setting(Some(value));
        assert!(read.enabled, "{value}");
        assert_eq!(read.default_mode, mode, "{value}");
        assert!(read.warning.is_none(), "{value}");
    }
    let bad_default = setting(Some("{default: expert}"));
    assert!(bad_default.enabled && bad_default.default_mode == ReadingMode::Standard);
    assert!(bad_default.warning.unwrap().contains("expert"));
    let typo = setting(Some("maybe"));
    assert!(!typo.enabled && typo.warning.unwrap().contains("maybe"));
    // End to end.
    let config = config();
    let post = model::load_post(
        &post_source("readingModes: {default: guided}\n", ARTICLE),
        &config,
        config.render_options(),
    )
    .unwrap();
    let depth = post.reading_depth().unwrap();
    assert_eq!(depth.supplements.len(), 3);
    assert_eq!(depth.default_mode, ReadingMode::Guided);
}

#[test]
fn a_note_cited_only_inside_a_supplement_names_the_supplement() {
    let post = cited(
        "Argument [@plato].\n\n> [!supplement kind=evidence]\n> More in [@slings].\n\n> [!supplement kind=context]\n> Again [@slings] and [@plato].\n",
    );
    let html = &post.html;
    // `slings` is cited only in supplements; `plato` is cited by the article.
    assert!(
        html.contains("data-ob-supplement=\"ob-supplement-1 ob-supplement-2\""),
        "{html}"
    );
    assert_eq!(
        html.matches("data-ob-supplement=\"ob-supplement-").count(),
        1,
        "{html}"
    );
}

#[test]
fn legacy_pages_without_supplements_do_not_change_when_a_post_opts_in() {
    let body = "# T\n\n## One\n\ntext[^a]\n\n> quote\n\n[^a]: note\n";
    let plain = render(body, RenderOptions::default());
    let opted = render(body, on());
    assert_eq!(plain.html, opted.html);
    assert_eq!(plain.text, opted.text);
    assert_eq!(plain.prose, opted.prose);
    assert_eq!(plain.headings, opted.headings);
}

fn shared_contract() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/reading-modes.json")).unwrap()
}

#[test]
fn the_modes_agree_with_the_contract_file_the_browser_component_reads() {
    let contract = shared_contract();
    let names: Vec<_> = ReadingMode::ALL.iter().map(|mode| mode.as_str()).collect();
    assert_eq!(
        names,
        contract["modes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|name| name.as_str().unwrap())
            .collect::<Vec<_>>()
    );
    let levels = [Depth::Guided, Depth::DeepDive];
    for mode in ReadingMode::ALL {
        for level in levels {
            assert_eq!(
                mode.shows(level),
                contract["shows"][mode.as_str()][level.as_str()]
                    .as_bool()
                    .unwrap(),
                "{} {}",
                mode.as_str(),
                level.as_str()
            );
        }
    }
    // The author's default is read exactly as the component reads it: a mode
    // name is a default, anything else is not.
    for row in contract["resolve"].as_array().unwrap() {
        if let Some(default) = row["default"].as_str() {
            let setting =
                openblog_core::reading_depth::setting(Some(&format!("{{default: {default}}}")));
            let expected = ReadingMode::parse(default).unwrap_or(ReadingMode::Standard);
            assert_eq!(setting.default_mode, expected, "{default}");
            assert_eq!(
                setting.warning.is_some(),
                ReadingMode::parse(default).is_none()
            );
        }
    }
}

#[test]
fn the_post_page_carries_the_hooks_the_component_reads_and_only_when_there_are_supplements() {
    use openblog_core::{generate, LoadOptions, Site, Sources, ThemeSet};
    let contract = shared_contract();
    let build = |front: &str, body: &str| {
        let site = Site::load(
            config(),
            Sources {
                posts: vec![post_source(front, body)],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        generate(&site, &ThemeSet::new())
            .unwrap()
            .into_iter()
            .find(|file| file.path == "posts/p/index.html" || file.path.ends_with("p/index.html"))
            .unwrap()
            .contents
    };
    let page = build("readingModes: {default: guided}\n", ARTICLE);
    assert!(
        page.contains("<ob-reading-modes default=\"guided\"><ob-code"),
        "{page}"
    );
    assert!(page.contains("</ob-code>\n</ob-reading-modes>"));
    // Every supplement is written out visible: nothing for the page to hide.
    for (at, _) in page.match_indices("<div class=\"ob-supplement\"") {
        let tag = &page[at..at + page[at..].find('>').unwrap()];
        assert!(!tag.contains("hidden"), "{tag}");
    }
    for level in page.match_indices("data-ob-level=\"").map(|(at, found)| {
        let rest = &page[at + found.len()..];
        &rest[..rest.find('"').unwrap()]
    }) {
        assert!(contract["levels"]
            .as_array()
            .unwrap()
            .iter()
            .any(|known| known == level));
    }
    let standard = build("readingModes: true\n", ARTICLE);
    assert!(standard.contains("<ob-reading-modes default=\"standard\">"));
    // Opted in with no supplement, or not opted in: no element at all.
    assert!(!build("readingModes: true\n", "Just words.\n").contains("ob-reading-modes"));
    assert!(!build("", ARTICLE).contains("ob-reading-modes"));
}

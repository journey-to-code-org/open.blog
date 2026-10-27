//! The atlas-link leak guard (ADR 0205). Every Markdown form of a link or an
//! image whose destination is `atlas:` and names an entry that is not
//! published is written into a post, a page, a series description and the
//! home introduction, and EVERY file the build writes, plus the portable
//! copies of the post, is scanned: no `atlas:` address in a link or image
//! attribute, no private id, no private title and no raw `<ob-concept` mark
//! may appear, with the atlas on and with it off.
//!
//! A new Markdown form that leaks an id fails here by adding one line to
//! [`CORPUS`], instead of being found by a review.

use std::collections::BTreeMap;

use openblog_core::atlas_publication::PublicAtlas;
use openblog_core::knowledge_atlas::{Atlas, Links};
use openblog_core::portability::PortableProjection;
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::SourceLibrary;
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::json;

/// Every private id starts with this, and every private title with the other,
/// so one scan finds either anywhere.
const SECRET_ID: &str = "zsecret";
const SECRET_TITLE: &str = "ztitle";

/// One block of Markdown per form. Labels and alt texts hold neither token.
const CORPUS: &[(&str, &str)] = &[
    ("inline", "An [inline label](atlas:zsecretinline) here."),
    ("inline with a title", "An [titled label](atlas:zsecrettitled \"ztitle one\") here."),
    ("inline with a single-quoted title", "An [quoted label](atlas:zsecretquoted 'ztitle two') here."),
    ("inline with a parenthesised title", "An [paren label](atlas:zsecretparen (ztitle three)) here."),
    ("reference full", "A [full label][zfull] here.\n\n[zfull]: atlas:zsecretfull \"ztitle four\""),
    ("reference collapsed", "A [zcollapsed][] here.\n\n[zcollapsed]: atlas:zsecretcollapsed \"ztitle five\""),
    ("reference shortcut", "A [zshortcut] here.\n\n[zshortcut]: atlas:zsecretshortcut \"ztitle six\""),
    ("autolink", "An autolink <atlas:zsecretauto> here."),
    ("autolink in capitals", "An autolink <ATLAS:zsecretautoupper> here."),
    ("image inline", "An ![inline alt](atlas:zsecretimage \"ztitle seven\") here."),
    ("image inline without a title", "An ![bare alt](atlas:zsecretimagebare) here."),
    ("image reference full", "An ![ref alt][zimgfull] here.\n\n[zimgfull]: atlas:zsecretimgfull \"ztitle eight\""),
    ("image reference collapsed", "An ![zimgcollapsed][] here.\n\n[zimgcollapsed]: atlas:zsecretimgcollapsed"),
    ("image reference shortcut", "An ![zimgshortcut] here.\n\n[zimgshortcut]: atlas:zsecretimgshortcut"),
    ("link inside an image's alt text", "An ![alt with [inner](atlas:zsecretinalt) words](/pic.png \"a title\") here."),
    ("link inside an atlas image's alt text", "An ![alt with [inner](atlas:zsecretinatlasalt) words](atlas:zsecretatlasimage) here."),
    ("image inside an atlas link", "An [![pic alt](/pic.png)](atlas:zsecretimagelink) here."),
    ("atlas image inside an ordinary link", "An [![linked alt](atlas:zsecretimageinlink)](https://example.com/) here."),
    ("emphasis in the label", "An **[strong label](atlas:zsecretstrong)** and *[em label](atlas:zsecretem)* here."),
    ("link inside a link", "An [outer [nested label](atlas:zsecretnested)](https://example.com/) here."),
    ("heading with a link", "## Heading [heading label](atlas:zsecretheading)"),
    ("heading with an autolink", "## <atlas:zsecretheadingauto>"),
    ("heading with an image", "## Heading ![heading alt](atlas:zsecretheadingimage)"),
    ("footnote", "A note[^zn] here.\n\n[^zn]: Footnote [note label](atlas:zsecretfootnote) and <atlas:zsecretfootnoteauto> and ![note alt](atlas:zsecretfootnoteimage)."),
    ("table", "| a | b | c |\n|---|---|---|\n| [cell label](atlas:zsecretcell) | ![cell alt](atlas:zsecretcellimage) | <atlas:zsecretcellauto> |"),
    ("list item", "- A [list label](atlas:zsecretlist)\n- An ![list alt][zlistimg]\n\n[zlistimg]: atlas:zsecretlistimg"),
    ("block quote", "> A [quote label](atlas:zsecretquote) and <atlas:zsecretquoteauto>."),
    ("the scheme in capitals", "A [capital label](ATLAS:zsecretcapital) here."),
    ("the scheme in mixed case with padding", "A [mixed label](<  AtLaS:zsecretmixed >) here."),
    ("an entity in the scheme", "A [entity label](atlas&#58;zsecretentity) here."),
    ("a malformed id", "A [bad label](atlas:ZSECRETBAD) and [spacey label](<atlas:zsecret space>)."),
    ("raw mark", "A <ob-concept data-id=\"zsecretraw\">raw label</ob-concept> here."),
    ("raw mark in capitals with other quotes", "A <OB-CONCEPT data-id='zsecretrawupper' class=\"a>b\">upper label</OB-CONCEPT> here."),
    ("raw mark unclosed", "A <ob-concept data-id=\"zsecretrawopen\">dangling label here."),
    ("raw mark closing tag only", "A stray </ob-concept> here."),
    ("raw mark in a raw block", "<div>\n<ob-concept data-id=\"zsecretrawblock\">block label</ob-concept>\n</div>"),
];

fn public_atlas() -> PublicAtlas {
    let library = SourceLibrary::parse(
        &json!({"version": 1, "sources": [
            {"id": "plato-republic", "kind": "work", "title": "Politeia"}]})
        .to_string(),
        &BTreeMap::new(),
    )
    .unwrap();
    let notebook = Notebook::parse(
        &json!({"version": 1, "passages": [], "notes": []}).to_string(),
        &library,
    )
    .unwrap();
    let entry = |id: &str, label: &str, visibility: &str| json!({"id": id, "kind": "concept", "label": label, "visibility": visibility});
    let atlas = Atlas::parse(
        &json!({"version": 1, "entries": [
            entry("plato", "Plato", "approved"),
            // Private entries the corpus names: never published.
            entry("zsecretinline", "ztitle private label", "private"),
            entry("zsecretheading", "ztitle private heading", "private")],
            "relationships": []})
        .to_string(),
        Links {
            library: &library,
            notebook: &notebook,
        },
    )
    .expect("a valid atlas");
    PublicAtlas::project(&atlas, &library).expect("a projection")
}

fn corpus_markdown() -> String {
    let mut out = String::from("A published [Plato](atlas:plato) stays a link in a post.\n\n");
    for (_, block) in CORPUS {
        out.push_str(block);
        out.push_str("\n\n");
    }
    out
}

fn site(atlas_on: bool) -> Site {
    let mut config = SiteConfig::from_json(
        r#"{"title": "Corpus", "url": "https://example.com", "author": {"name": "Site Author"}}"#,
    )
    .unwrap();
    config.knowledge_atlas.publish = atlas_on;
    // The home introduction is one document too.
    config.home.intro = corpus_markdown();
    let body = corpus_markdown();
    let mut site = Site::load(
        config,
        Sources {
            posts: vec![SourceFile {
                path: "posts/cave.md".into(),
                contents: format!(
                    "---\ntitle: The cave\ndate: 2026-10-20\nseries: greeks\n---\n{body}"
                ),
            }],
            pages: vec![SourceFile {
                path: "pages/about.md".into(),
                contents: format!("---\ntitle: About\n---\n{body}"),
            }],
            series: vec![SourceFile {
                path: "series/greeks.md".into(),
                contents: format!("---\nname: Greeks\n---\n{body}"),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .expect("site");
    site.atlas = atlas_on.then(public_atlas);
    site.link_concepts();
    site
}

/// Whether `lower` holds the `ob-concept` element's tag. The reader's own
/// `<ob-concept-previews>` component is a different element.
fn has_raw_mark(lower: &str) -> bool {
    ["<ob-concept", "</ob-concept"].iter().any(|open| {
        lower.match_indices(open).any(|(at, _)| {
            lower[at + open.len()..]
                .chars()
                .next()
                .is_none_or(|c| c.is_whitespace() || c == '>' || c == '/')
        })
    })
}

/// What a file must never hold, named so a failure says which guard.
fn leaks(path: &str, contents: &str) -> Vec<String> {
    let lower = contents.to_ascii_lowercase();
    let mut found = Vec::new();
    if lower.contains(SECRET_ID) {
        found.push(format!("{path}: a private id"));
    }
    if lower.contains(SECRET_TITLE) {
        found.push(format!("{path}: a private title"));
    }
    if has_raw_mark(&lower) {
        found.push(format!("{path}: a raw <ob-concept mark"));
    }
    // An `atlas:` scheme in any link or image attribute value, quoted either
    // way, with or without spaces around the equals sign.
    for attribute in ["href", "src", "srcset", "poster", "data", "action", "cite"] {
        for quote in ["\"", "'"] {
            for gap in ["", " "] {
                let needle = format!("{attribute}{gap}={gap}{quote}{gap}atlas:");
                if lower.contains(&needle) {
                    found.push(format!("{path}: `{needle}`"));
                }
            }
        }
    }
    // The scheme as a Markdown destination in a portable copy.
    if lower.contains("](atlas:") || lower.contains("]: atlas:") || lower.contains("<atlas:") {
        found.push(format!("{path}: an atlas Markdown destination"));
    }
    found
}

#[test]
fn no_markdown_form_of_an_atlas_link_or_image_leaks_anywhere_in_the_build() {
    for atlas_on in [true, false] {
        let site = site(atlas_on);
        let mut found = Vec::new();
        let dist = generate(&site, &ThemeSet::new()).expect("a build");
        let paths: Vec<&String> = dist.iter().map(|file| &file.path).collect();
        for expected in [
            "feed.json",
            "search.json",
            "llms-full.txt",
            "posts/cave/index.html",
            "about/index.html",
            "series/greeks/index.html",
            "index.html",
        ] {
            assert!(
                paths.iter().any(|path| path.as_str() == expected),
                "{expected} is not in {paths:?}"
            );
        }
        for file in &dist {
            found.extend(leaks(&file.path, &file.contents));
        }
        // The portable copies of the post: Markdown, HTML and text.
        let projection =
            PortableProjection::from_post(&site.posts[0], &site.config).expect("a projection");
        found.extend(leaks(
            "portable markdown",
            &projection.portable_markdown().expect("markdown"),
        ));
        found.extend(leaks(
            "portable text",
            &projection.portable_text().expect("text"),
        ));
        found.extend(leaks(
            "portable html",
            &projection.portable_html().expect("html").html,
        ));
        // The documents themselves, before any template wraps them.
        found.extend(leaks("post html", &site.posts[0].html));
        found.extend(leaks("post text", &site.posts[0].text));
        found.extend(leaks("page html", &site.pages[0].html));
        found.extend(leaks("series html", &site.series[0].description_html));
        assert!(
            found.is_empty(),
            "atlas {}: {} leaks\n{}",
            if atlas_on { "on" } else { "off" },
            found.len(),
            found.join("\n")
        );
    }
}

#[test]
fn every_form_keeps_the_authors_label_and_the_author_hears_about_it() {
    let site = site(true);
    let html = &site.posts[0].html;
    // Labels survive as words, whatever the form.
    for label in [
        "inline label",
        "titled label",
        "full label",
        "zcollapsed",
        "zshortcut",
        "inline alt",
        "ref alt",
        "alt with inner words",
        "strong label",
        "cell label",
        "note label",
        "raw label",
    ] {
        assert!(html.contains(label), "{label} is missing from {html}");
    }
    // The published entry is still a real link, and only that one.
    assert!(html.contains("href=\"/atlas/plato/\""));
    assert_eq!(html.matches("class=\"ob-concept\"").count(), 1, "{html}");
    // An autolink has no label, and the author is told what to write.
    let warnings = site.warnings.join("\n");
    assert!(warnings.contains("write `[label](atlas:id)`"), "{warnings}");
    for source in [
        "posts/cave.md",
        "pages/about.md",
        "series/greeks.md",
        "openblog.json (home.intro)",
    ] {
        assert!(
            site.warnings.iter().any(|w| w.starts_with(source)),
            "{source}: no warning in {warnings}"
        );
    }
    // An image is always refused.
    assert!(
        warnings.contains("an image cannot have an `atlas:` address"),
        "{warnings}"
    );
    // The page and the post agree: a page makes no concept link.
    let page = &site.pages[0].html;
    assert!(!page.contains("class=\"ob-concept\""), "{page}");
}

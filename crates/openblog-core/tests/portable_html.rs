//! Golden and static-structure regressions for the portable HTML fallbacks of
//! every current interactive capability. Set `OPENBLOG_UPDATE_GOLDEN=1` to
//! rewrite the expected `.html` files after reviewing a deliberate change.

use std::collections::HashSet;

use openblog_core::{
    portability::PortableProjection, LoadOptions, Site, SiteConfig, SourceFile, Sources,
};

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/portable-html"
);
const CANONICAL_BASE: &str = "https://example.test/blog/";
const VOID: &[&str] = &["br", "hr", "img", "wbr"];

fn config() -> SiteConfig {
    SiteConfig::from_json(
        r#"{
            "title": "Portable fixture",
            "url": "https://example.test/blog",
            "postPath": "/{slug}/",
            "author": { "name": "Site Author" },
            "engagement": { "enabled": true, "endpoint": "https://engage.example/api" },
            "codeRunner": { "endpoint": "https://runner.example/execute", "languages": ["python"] }
        }"#,
    )
    .unwrap()
}

fn load(name: &str) -> (SiteConfig, Site) {
    let config = config();
    let contents = std::fs::read_to_string(format!("{FIXTURES}/{name}.md"))
        .unwrap()
        .replace("\r\n", "\n");
    let site = Site::load(
        config.clone(),
        Sources {
            posts: vec![SourceFile {
                path: format!("posts/{name}.md"),
                contents,
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap_or_else(|errors| panic!("{name}: {errors:?}"));
    (config, site)
}

fn portable(name: &str) -> (String, Site) {
    let (config, site) = load(name);
    let html = PortableProjection::from_post(&site.posts[0], &config)
        .unwrap()
        .portable_html()
        .unwrap_or_else(|error| panic!("{name}: {error}"))
        .html;
    (html, site)
}

/// Start and end tags in source order: `(name, attributes, closing)`. Text is
/// escaped by the renderer, so every `<` here opens markup.
fn tags(html: &str) -> Vec<(String, String, bool)> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        rest = &rest[start + 1..];
        let end = rest.find('>').expect("unterminated tag");
        let tag = &rest[..end];
        rest = &rest[end + 1..];
        let (closing, tag) = match tag.strip_prefix('/') {
            Some(tag) => (true, tag),
            None => (false, tag),
        };
        let name_end = tag
            .find(|c: char| c.is_whitespace() || c == '/')
            .unwrap_or(tag.len());
        out.push((
            tag[..name_end].to_ascii_lowercase(),
            tag[name_end..].to_string(),
            closing,
        ));
    }
    out
}

fn attribute<'a>(attributes: &'a str, name: &str) -> Option<&'a str> {
    let at = attributes.find(&format!(" {name}=\""))?;
    let value = &attributes[at + name.len() + 3..];
    value.split('"').next()
}

fn text_without_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Static checks a no-JavaScript, no-stylesheet, or printed reader depends on.
fn assert_static_and_accessible(name: &str, html: &str) {
    let tags = tags(html);
    let mut stack: Vec<&str> = Vec::new();
    let mut ids = HashSet::new();
    let mut fragments = Vec::new();
    for (index, (tag, attributes, closing)) in tags.iter().enumerate() {
        assert!(
            !tag.starts_with("ob-")
                && ![
                    "script", "iframe", "input", "button", "form", "textarea", "select", "dialog",
                    "template", "style", "link", "object", "embed",
                ]
                .contains(&tag.as_str()),
            "{name}: runtime-only element <{tag}>"
        );
        for runtime in [
            " hidden",
            " style=",
            "aria-hidden",
            "data-correct",
            "data-key",
            "data-endpoint",
            "data-runnable",
        ] {
            assert!(
                !attributes.contains(runtime),
                "{name}: <{tag}{attributes}> depends on {runtime}"
            );
        }
        assert!(
            !attributes
                .split_whitespace()
                .any(|attribute| attribute.starts_with("on")),
            "{name}: event handler on <{tag}{attributes}>"
        );
        if *closing {
            assert_eq!(
                stack.pop(),
                Some(tag.as_str()),
                "{name}: unbalanced </{tag}>"
            );
            continue;
        }
        if !VOID.contains(&tag.as_str()) {
            stack.push(tag);
        }
        if let Some(id) = attribute(attributes, "id") {
            assert!(ids.insert(id.to_string()), "{name}: duplicate id {id}");
        }
        for url in ["href", "src"]
            .iter()
            .filter_map(|name| attribute(attributes, name))
        {
            assert!(
                url.starts_with("https://"),
                "{name}: relative or unsafe URL {url}"
            );
            if let Some(fragment) = url
                .strip_prefix(CANONICAL_BASE)
                .and_then(|path| path.split_once('#'))
                .map(|(_, fragment)| fragment)
            {
                fragments.push(fragment.to_string());
            }
        }
        match tag.as_str() {
            "img" => assert!(
                attribute(attributes, "alt").is_some_and(|alt| !alt.trim().is_empty()),
                "{name}: image without alternative text"
            ),
            "a" if attribute(attributes, "aria-label").is_none() => {
                let start = html
                    .match_indices("<a ")
                    .nth(
                        tags[..index]
                            .iter()
                            .filter(|(t, _, c)| t == "a" && !c)
                            .count(),
                    )
                    .unwrap()
                    .0;
                let end = start + html[start..].find("</a>").unwrap();
                assert!(
                    !text_without_tags(&html[start..end]).trim().is_empty(),
                    "{name}: link without an accessible name"
                );
            }
            "details" => assert_eq!(
                tags.get(index + 1).map(|(tag, _, _)| tag.as_str()),
                Some("summary"),
                "{name}: disclosure without a summary"
            ),
            _ => {}
        }
    }
    assert!(stack.is_empty(), "{name}: unclosed {stack:?}");
    for fragment in fragments {
        assert!(
            ids.contains(&fragment),
            "{name}: anchor #{fragment} has no target"
        );
    }
    for private in ["engage.example", "runner.example"] {
        assert!(!html.contains(private), "{name}: leaked {private}");
    }
}

fn assert_golden(name: &str, html: &str) {
    let path = format!("{FIXTURES}/{name}.html");
    if std::env::var_os("OPENBLOG_UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, html).unwrap();
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("{name}: missing golden file {path}"))
        .replace("\r\n", "\n");
    assert_eq!(html, expected, "{name}: portable HTML differs from {path}");
}

#[test]
fn video_lesson_fallbacks_match_the_golden_output() {
    let (html, site) = portable("video-lesson");
    assert_golden("video-lesson", &html);
    assert_static_and_accessible("video-lesson", &html);

    let visible = text_without_tags(&html);
    for essential in [
        "Gate of Embers — a lesson on YouTube",
        "A warning &amp; a &lt;script&gt; in the dark",
        "Into the ruin — Ünter",
        "Which tag opens a disclosure without &lt;script&gt;?",
        "&lt;dialog onclick=\"alert(1)\"&gt;",
        "Answer: B. &lt;details&gt;",
        "Native disclosure works without JavaScript — even in Zürich.",
        "Answer: A. No",
        "&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
        "&lt;button onclick=&quot;alert(1)&quot;&gt;Hi&lt;/button&gt;",
        "print(&quot;runs on the canonical page&quot;)",
        "A pen about gates &lt;3 (See the Pen on CodePen)",
        "Join the discussion on the original article",
    ] {
        assert!(
            visible.contains(essential),
            "missing {essential:?}:\n{html}"
        );
    }

    // The same post's native page keeps its interactive markup.
    let native = &site.posts[0].html;
    for interactive in ["<ob-quiz", "<ob-code-runner", "<ob-web-sandbox>", "<iframe"] {
        assert!(native.contains(interactive), "native lost {interactive}");
    }
}

#[test]
fn recipe_fallbacks_match_the_golden_output() {
    let (html, site) = portable("recipe");
    assert_golden("recipe", &html);
    assert_static_and_accessible("recipe", &html);
    let visible = text_without_tags(&html);
    for essential in [
        "2 cups tomatoes",
        "Toss with the sauce.",
        "When do you add the basil?",
        "Answer: B. At the end",
        "Comments are closed.",
    ] {
        assert!(
            visible.contains(essential),
            "missing {essential:?}:\n{html}"
        );
    }
    assert_eq!(site.posts[0].recipe.as_ref().unwrap().steps.len(), 2);
}

#[test]
fn portable_fallbacks_are_deterministic_and_leave_the_source_untouched() {
    for name in ["video-lesson", "recipe"] {
        let (config, site) = load(name);
        let post = &site.posts[0];
        let native = post.html.clone();
        let projection = PortableProjection::from_post(post, &config).unwrap();
        let first = projection.portable_html().unwrap();
        assert_eq!(projection.portable_html().unwrap(), first, "{name}");
        assert_eq!(post.html, native, "{name}");
        assert!(projection
            .representation(openblog_core::portability::RepresentationFormat::Markdown)
            .contains("```quiz"));
    }
}

#[test]
fn static_checks_reject_the_native_interactive_markup() {
    let (_, site) = load("video-lesson");
    let native = site.posts[0].html.clone();
    let rejected = std::panic::catch_unwind(|| assert_static_and_accessible("native", &native));
    assert!(
        rejected.is_err(),
        "the no-JavaScript checks must detect runtime markup"
    );
}

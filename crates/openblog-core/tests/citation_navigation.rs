//! Citation navigation on the native page (#65). Every page of a post that
//! does not publish citations is byte-for-byte what it was before. Set
//! `OPENBLOG_UPDATE_GOLDEN=1` to rewrite the legacy golden pages.

use std::collections::BTreeMap;

use openblog_core::model::LibrarySource;
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};

const LIBRARY: &str = r#"{
  "version": 1,
  "sources": [
    {"id": "plato-republic", "kind": "work", "title": "Πολιτεία",
     "creators": [{"name": "Plato", "role": "author"}],
     "secretPlan": "PRIVATE-MARKER unknown field"},
    {"id": "republic-slings-2003", "kind": "edition", "of": "plato-republic",
     "title": "Platonis Rempublicam", "issued": "2003",
     "creators": [{"name": "S. R. Slings", "role": "editor"}],
     "identifiers": [
       {"scheme": "doi", "value": "doi:10.1000/xyz"},
       {"scheme": "my-drive", "value": "C:/PRIVATE-MARKER/scan.pdf"}
     ],
     "csl": {"publisher": "Oxford University Press", "note": "PRIVATE-MARKER csl note"}},
    {"id": "hostile", "kind": "work",
     "title": "</script><script>alert(1)</script> & \u2028 more",
     "identifiers": [{"scheme": "url", "value": "https://example.org/a_(b)?q=1"}]}
  ]
}"#;

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/citation_navigation"
);

/// Posts that do not publish citations, in every profile that has its own
/// page furniture, plus one that opts in but cites nothing.
const LEGACY: &[(&str, &str)] = &[
    ("posts/article.md", "---\ntitle: Article\ndate: 2026-09-01\ntags: [a]\n---\nA claim[^1] and a handle [@someone] and `[@code]`.\n\n## Section\n\nText.\n\n[^1]: A note [@inside].\n"),
    ("posts/research.md", "---\ntitle: Study\ndate: 2026-09-02\nprofile: research\ndoi: 10.1234/study\n---\n## Abstract\n\nSummary [@plato-republic].\n\n## References\n\n1. [Prior work](https://doi.org/10.1000/prior)\n"),
    ("posts/recipe.md", "---\ntitle: Soup\ndate: 2026-09-03\nprofile: recipe\n---\n## Ingredients\n\n- Water [@plato-republic]\n\n## Steps\n\n1. Boil.\n"),
    ("posts/opted-but-uncited.md", "---\ntitle: Quiet\ndate: 2026-09-04\ncitations: notes\n---\nNo citations here, only a footnote[^a].\n\n[^a]: Plain.\n"),
];

fn config() -> SiteConfig {
    SiteConfig::from_json(
        r#"{"title": "T", "url": "https://example.test", "author": {"name": "A"}}"#,
    )
    .unwrap()
}

fn load(posts: &[(&str, &str)], library: Option<&str>) -> Result<Site, Vec<String>> {
    let sources = Sources {
        posts: posts
            .iter()
            .map(|(path, contents)| SourceFile {
                path: (*path).into(),
                contents: (*contents).into(),
            })
            .collect(),
        source_library: library.map(|text| {
            LibrarySource::Text(SourceFile {
                path: ".openblog/private/research/sources.json".into(),
                contents: text.into(),
            })
        }),
        ..Default::default()
    };
    Site::load(config(), sources, LoadOptions::default())
}

fn build(site: &Site) -> BTreeMap<String, String> {
    generate(site, &ThemeSet::new())
        .unwrap()
        .into_iter()
        .map(|file| (file.path, file.contents))
        .collect()
}

/// The generated file of a post.
fn page_path(post: &openblog_core::model::Post) -> String {
    format!("{}index.html", post.url.trim_start_matches('/'))
}

#[test]
fn pages_without_published_citations_are_byte_for_byte_unchanged() {
    for library in [None, Some(LIBRARY)] {
        let site = load(LEGACY, library).unwrap();
        let files = build(&site);
        assert_eq!(site.posts.len(), LEGACY.len());
        for post in &site.posts {
            let slug = &post.slug;
            let page = &files[&page_path(post)];
            let golden = format!("{FIXTURES}/{slug}.html");
            if std::env::var_os("OPENBLOG_UPDATE_GOLDEN").is_some() {
                std::fs::write(&golden, page).unwrap();
            }
            let expected = std::fs::read_to_string(&golden)
                .unwrap_or_else(|_| panic!("missing golden {golden}"))
                .replace("\r\n", "\n");
            assert_eq!(page, &expected, "{slug} changed");
            assert!(!page.contains("ob-references"), "{slug}");
            assert!(!page.contains("doc-endnotes"), "{slug}");
        }
    }
}

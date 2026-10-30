//! Recipe directory packages (epic #385, story #398, ADRs 0822 and 0823): each directory's checks,
//! the files a package holds, the attribution it carries, and the static guide page.

use openblog_core::recipe_check;
use openblog_core::recipe_directory::*;
use openblog_core::{LoadOptions, Site, SiteConfig, SourceFile, Sources};

fn site(config: &str, post: &str) -> Site {
    Site::load(
        SiteConfig::from_json(config).unwrap(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/r.md".into(),
                contents: post.into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap()
}

const CONFIG: &str = r#"{"title":"Kitchen","url":"https://kitchen.example","postPath":"/{slug}/","author":{"name":"The Cook"}}"#;

fn recipe(extra: &str) -> String {
    format!("---\ntitle: Soup\nslug: soup\ndate: 2026-02-02\ndescription: Warm.\nprofile: recipe\nservings: 2\n{extra}---\n## Ingredients\n\n- 1 leek\n- 2 potatoes\n\n## Steps\n\n1. Chop.\n2. Simmer for 20 minutes.\n")
}

fn codes(findings: &[Finding]) -> Vec<&'static str> {
    findings.iter().map(|f| f.code.as_str()).collect()
}

fn input<'a>(cover: &'a Cover, problems: &'a [recipe_check::Problem]) -> CheckInput<'a> {
    CheckInput {
        recipe_problems: problems,
        cover,
        description: "Warm.",
        canonical_elsewhere: false,
    }
}

#[test]
fn each_directory_checks_what_it_needs_and_nothing_else() {
    let square = Cover::Local {
        file: "image.jpg".into(),
        size: Some((1200, 1200)),
    };
    let small = Cover::Local {
        file: "image.jpg".into(),
        size: Some((200, 200)),
    };
    let wide = Cover::Local {
        file: "image.jpg".into(),
        size: Some((1600, 900)),
    };
    let unknown = Cover::Local {
        file: "image.avif".into(),
        size: None,
    };
    let linked = Cover::Linked {
        url: "https://cdn.example/a.jpg".into(),
    };
    use Directory::*;
    let cases: &[(Directory, &Cover, &[&str])] = &[
        (GoogleSearch, &square, &[]),
        (GoogleSearch, &small, &["image-below-recommended-size"]),
        (GoogleSearch, &wide, &[]),
        (GoogleSearch, &unknown, &["image-size-unknown"]),
        // Google reads the image from the page; nothing to download.
        (GoogleSearch, &linked, &[]),
        (GoogleSearch, &Cover::None, &["no-image"]),
        (Pinterest, &small, &[]),
        (Pinterest, &linked, &["image-linked-not-included"]),
        (Pinterest, &Cover::None, &["no-image"]),
        (Foodgawker, &square, &["conditions-unverified"]),
        (
            Foodgawker,
            &wide,
            &["image-not-square", "conditions-unverified"],
        ),
        (
            Foodgawker,
            &linked,
            &["image-linked-not-included", "conditions-unverified"],
        ),
    ];
    for (directory, cover, expected) in cases {
        let findings = check(*directory, &input(cover, &[]));
        assert_eq!(codes(&findings), *expected, "{directory:?} {cover:?}");
    }
    // A description is needed only where the author fills a form.
    let mut no_description = input(&square, &[]);
    no_description.description = "  ";
    assert!(codes(&check(Foodgawker, &no_description)).contains(&"no-description"));
    assert!(!codes(&check(Pinterest, &no_description)).contains(&"no-description"));
    // Another canonical page blocks every directory.
    let mut elsewhere = input(&square, &[]);
    elsewhere.canonical_elsewhere = true;
    for directory in Directory::ALL {
        let p = plan(directory, &elsewhere, "https://kitchen.example/soup/");
        assert_eq!(p.status, Status::Blocked);
        assert_eq!(p.findings[0].code, FindingCode::CanonicalElsewhere);
    }
}

#[test]
fn a_recipe_check_error_blocks_every_directory_and_a_warning_does_not() {
    let s = site(CONFIG, &recipe("cover: /soup.jpg\n"));
    let post = &s.posts[0];
    let mut problems = recipe_check::check(&s.config, post, post.recipe.as_ref().unwrap());
    let cover = Cover::Local {
        file: "image.jpg".into(),
        size: Some((800, 800)),
    };
    for directory in Directory::ALL {
        assert_eq!(
            plan(directory, &input(&cover, &problems), "u").status,
            Status::Ready
        );
    }
    let broken = site(
        CONFIG,
        &recipe("cover: /soup.jpg\n").replace("1 leek", "0 leeks"),
    );
    let bp = &broken.posts[0];
    problems = recipe_check::check(&broken.config, bp, bp.recipe.as_ref().unwrap());
    for directory in Directory::ALL {
        let p = plan(directory, &input(&cover, &problems), "u");
        assert_eq!(p.status, Status::Blocked);
        assert_eq!(p.findings[0].code, FindingCode::RecipeHasErrors);
    }
}

#[test]
fn every_condition_says_where_it_was_read_and_only_foodgawker_is_unverified() {
    for directory in Directory::ALL {
        let unverified = directory
            .conditions()
            .iter()
            .any(|c| c.verification == Verification::Unverified);
        assert_eq!(unverified, directory == Directory::Foodgawker);
        for c in directory.conditions() {
            assert!(directory.sources().contains(&c.source) || c.source.starts_with("https://"));
        }
        let steps = directory.steps("https://kitchen.example/soup/");
        assert!(!steps.is_empty());
        if directory.intake() == Intake::ReadsThePage {
            assert!(steps
                .iter()
                .any(|s| s.contains("https://kitchen.example/soup/")));
        }
    }
    for unavailable in UNAVAILABLE {
        assert_eq!(
            Directory::parse(unavailable.name),
            Lookup::Unavailable(*unavailable)
        );
        assert!(unavailable.source.starts_with("https://"));
    }
}

#[test]
fn the_text_files_are_the_authors_lines_and_the_credit_names_who_and_where() {
    let s = site(CONFIG, &recipe("adaptedFrom: Grandma's notebook\n"));
    let post = &s.posts[0];
    let r = post.recipe.as_ref().unwrap();
    let files = text_files(&s.config, post, r);
    let text = |name: &str| {
        String::from_utf8(
            files
                .iter()
                .find(|f| f.name == name)
                .unwrap()
                .contents
                .clone(),
        )
        .unwrap()
    };
    assert_eq!(text("ingredients.txt"), "1 leek\n2 potatoes\n");
    assert_eq!(text("steps.txt"), "1. Chop.\n2. Simmer for 20 minutes.\n");
    assert_eq!(text("link.txt"), "https://kitchen.example/soup/\n");
    // An `adaptedFrom` that is not an address is left out of the credit as it is of the data.
    assert_eq!(
        text("credit.txt"),
        "\"Soup\" by The Cook, first published at https://kitchen.example/soup/\n"
    );
    let anonymous = site(
        r#"{"url":"https://kitchen.example","postPath":"/{slug}/"}"#,
        &recipe("adaptedFrom: https://example.org/soup\n"),
    );
    let ap = &anonymous.posts[0];
    assert_eq!(
        credit(&anonymous.config, ap, ap.recipe.as_ref().unwrap()),
        "\"Soup\", first published at https://kitchen.example/soup/\nAdapted from https://example.org/soup\n"
    );
}

#[test]
fn the_guide_is_a_static_labelled_page_that_escapes_the_post() {
    let s = site(
        CONFIG,
        &recipe("").replace("title: Soup", "title: \"Soup </pre><script>x()</script>\""),
    );
    let post = &s.posts[0];
    let r = post.recipe.as_ref().unwrap();
    let cover = Cover::None;
    let problems = recipe_check::check(&s.config, post, r);
    let url = s.config.absolute(&post.url);
    let package = Package {
        title: post.title.clone(),
        source_path: post.source.clone(),
        canonical_url: url.clone(),
        directories: Directory::ALL
            .iter()
            .map(|d| plan(*d, &input(&cover, &problems), &url))
            .collect(),
        recipe_problems: problems,
        files: text_files(&s.config, post, r),
        linked_image: None,
    };
    assert!(!package.ready());
    let page = guide_page(&package);
    assert!(page.starts_with("<!doctype html>\n<html lang=\"en\">"));
    assert_eq!(page.matches("<h1>").count(), 1);
    assert!(!page.contains("<script>"));
    assert!(page.contains("&lt;script&gt;"));
    assert!(!page.contains("<form"));
    assert!(!page.contains("src="));
    // Every list of findings, conditions and steps is labelled by its heading.
    for directory in 1..=3 {
        for part in ["findings", "conditions", "steps"] {
            let id = format!("directory-{directory}-{part}");
            assert!(page.contains(&format!("id=\"{id}\"")), "{id}");
            assert!(page.contains(&format!("aria-labelledby=\"{id}\"")), "{id}");
        }
    }
    assert!(page.contains("blocked until the errors below are fixed"));
    assert!(page.contains("Prepared, not sent."));
    let manifest = package_manifest(&package);
    assert_eq!(manifest["ready"], false);
    assert_eq!(manifest["sent"], false);
    assert_eq!(
        manifest["directories"][0]["findings"][0]["code"],
        "no-image"
    );
}

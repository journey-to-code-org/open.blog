//! Recipe interoperability (epic #385, story #397, ADRs 0820 and 0821): the page and the export
//! carry one schema.org `Recipe`, importers that read the page find it the way they look for it,
//! the visible lists say what the data says, and the export check names problems without
//! repeating the author's words.

use openblog_core::recipe::Recipe;
use openblog_core::recipe_check::{self, Code, Severity};
use openblog_core::recipe_schema;
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::{json, Value};

const CONFIG: &str = r#"{"title":"Kitchen","url":"https://kitchen.example","postPath":"/{slug}/","author":{"name":"The Cook"}}"#;

const PASTA: &str = "---\ntitle: Lemon pasta\ndate: 2026-02-02\ndescription: Quick and bright.\nprofile: recipe\nservings: 4\nprep: 10 min\ncook: 15 min\ncuisine: Italian\ncourse: Dinner\ncalories: 520 kcal\ncover: /images/pasta.jpg\nadaptedFrom: https://example.org/original-pasta\ntags: [dinner, quick]\n---\n\nA story.\n\n## Ingredients\n\n- 400 g spaghetti\n- 1 1/2 lemons, zested & juiced\n- Salt, to taste\n\n## Steps\n\n1. Boil the pasta for 9 minutes.\n2. Toss with the lemon\n   and serve.\n";

fn site(config: &str, posts: &[(&str, &str)]) -> Site {
    Site::load(
        SiteConfig::from_json(config).unwrap(),
        Sources {
            posts: posts
                .iter()
                .map(|(path, contents)| SourceFile {
                    path: (*path).into(),
                    contents: (*contents).into(),
                })
                .collect(),
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap()
}

fn page(site: &Site, path: &str) -> String {
    generate(site, &ThemeSet::new())
        .unwrap()
        .into_iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("{path} was not generated"))
        .contents
}

/// What a recipe importer does with a page: read every JSON-LD script and find the node whose
/// type is `Recipe`, at the top level or inside a `@graph`.
fn importer_recipe(html: &str) -> Option<Value> {
    let marker = "<script type=\"application/ld+json\">";
    let mut rest = html;
    while let Some(start) = rest.find(marker) {
        let after = &rest[start + marker.len()..];
        let end = after.find("</script>")?;
        let doc: Value = serde_json::from_str(&after[..end]).ok()?;
        let nodes = match doc.get("@graph") {
            Some(Value::Array(nodes)) => nodes.clone(),
            _ => vec![doc],
        };
        if let Some(recipe) = nodes.into_iter().find(|n| n["@type"] == "Recipe") {
            return Some(recipe);
        }
        rest = &after[end..];
    }
    None
}

/// The text of each `<li>` in the first list that opens with `open`, tags removed, entities
/// decoded and white space collapsed: what a reader, or an importer reading the markup, sees.
fn list_items(html: &str, open: &str, close: &str) -> Vec<String> {
    let start = html.find(open).unwrap() + open.len();
    let end = start + html[start..].find(close).unwrap();
    html[start..end]
        .split("<li")
        .skip(1)
        .map(|item| {
            let item = &item[item.find('>').unwrap() + 1..];
            let item = &item[..item.find("</li>").unwrap_or(item.len())];
            let mut text = String::new();
            let mut in_tag = false;
            for c in item.chars() {
                match c {
                    '<' => in_tag = true,
                    '>' => in_tag = false,
                    c if !in_tag => text.push(c),
                    _ => {}
                }
            }
            text.replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&amp;", "&")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

fn export_of(site: &Site, slug: &str) -> (Value, Vec<recipe_check::Problem>) {
    let post = site.posts.iter().find(|p| p.slug == slug).unwrap();
    let recipe = post.recipe.as_ref().unwrap();
    (
        recipe_schema::recipe_document(&site.config, post, recipe),
        recipe_check::check(&site.config, post, recipe),
    )
}

#[test]
fn an_importer_reading_the_page_finds_exactly_the_exported_recipe() {
    let site = site(CONFIG, &[("posts/pasta.md", PASTA)]);
    let html = page(&site, "pasta/index.html");
    let from_page = importer_recipe(&html).expect("the page carries a Recipe node");
    let (mut exported, problems) = export_of(&site, "pasta");
    assert!(problems.is_empty(), "{problems:?}");
    assert_eq!(
        exported.as_object_mut().unwrap().remove("@context"),
        Some(json!("https://schema.org"))
    );
    assert_eq!(from_page, exported);
}

#[test]
fn the_mapping_carries_every_recipe_field_and_nothing_invented() {
    let site = site(CONFIG, &[("posts/pasta.md", PASTA)]);
    let (exported, _) = export_of(&site, "pasta");
    assert_eq!(
        exported,
        json!({
            "@context": "https://schema.org",
            "@type": "Recipe",
            "name": "Lemon pasta",
            "description": "Quick and bright.",
            "datePublished": "2026-02-02T00:00:00Z",
            "url": "https://kitchen.example/pasta/",
            "mainEntityOfPage": "https://kitchen.example/pasta/",
            "author": {
                "@type": "Person",
                "@id": "https://kitchen.example/#author",
                "name": "The Cook",
                "url": "https://kitchen.example/",
            },
            "image": ["https://kitchen.example/images/pasta.jpg"],
            "keywords": "dinner, quick",
            "recipeIngredient": [
                "400 g spaghetti",
                "1 1/2 lemons, zested & juiced",
                "Salt, to taste",
            ],
            "recipeInstructions": [
                {"@type": "HowToStep", "position": 1, "text": "Boil the pasta for 9 minutes."},
                {"@type": "HowToStep", "position": 2, "text": "Toss with the lemon and serve."},
            ],
            "prepTime": "PT10M",
            "cookTime": "PT15M",
            "totalTime": "PT25M",
            "recipeYield": ["4 servings"],
            "recipeCuisine": "Italian",
            "recipeCategory": "Dinner",
            "nutrition": {"@type": "NutritionInformation", "calories": "520 kcal"},
            "isBasedOn": "https://example.org/original-pasta",
        })
    );
}

#[test]
fn the_visible_lists_say_what_the_data_says() {
    let site = site(CONFIG, &[("posts/pasta.md", PASTA)]);
    let html = page(&site, "pasta/index.html");
    let recipe = importer_recipe(&html).unwrap();
    let ingredients: Vec<String> = recipe["recipeIngredient"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let steps: Vec<String> = recipe["recipeInstructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["text"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        list_items(
            &html,
            "<ul class=\"ob-recipe-list ob-ingredients\">",
            "</ul>"
        ),
        ingredients
    );
    assert_eq!(
        list_items(&html, "<ol class=\"ob-recipe-list ob-steps\">", "</ol>"),
        steps
    );
    // The times on the card are the machine-readable ones in the data.
    for iso in ["PT10M", "PT15M", "PT25M"] {
        assert!(
            html.contains(&format!("<time datetime=\"{iso}\">")),
            "{iso}"
        );
    }
}

#[test]
fn an_adapted_from_that_is_not_a_web_address_is_left_out_and_reported() {
    for written in [
        "my grandmother",
        "javascript:alert(1)",
        "/relative/path",
        "ftp://x.example/r",
    ] {
        let post = PASTA.replace("https://example.org/original-pasta", written);
        let site = site(CONFIG, &[("posts/pasta.md", &post)]);
        let html = page(&site, "pasta/index.html");
        assert!(
            importer_recipe(&html).unwrap().get("isBasedOn").is_none(),
            "{written}"
        );
        let (exported, problems) = export_of(&site, "pasta");
        assert!(exported.get("isBasedOn").is_none(), "{written}");
        assert_eq!(
            problems.iter().map(|p| p.code).collect::<Vec<_>>(),
            vec![Code::UnreadableAdaptedFrom],
            "{written}"
        );
        assert!(!recipe_check::has_errors(&problems));
    }
}

#[test]
fn a_recipe_without_the_new_field_keeps_its_page_data_unchanged() {
    let post = PASTA.replace("adaptedFrom: https://example.org/original-pasta\n", "");
    let site = site(CONFIG, &[("posts/pasta.md", &post)]);
    let recipe = importer_recipe(&page(&site, "pasta/index.html")).unwrap();
    assert!(recipe.get("isBasedOn").is_none());
    // An article carries no recipe data at all.
    let site = self::site(
        CONFIG,
        &[(
            "posts/notes.md",
            "---\ntitle: Notes\ndate: 2026-02-02\n---\nBody.\n",
        )],
    );
    assert!(importer_recipe(&page(&site, "notes/index.html")).is_none());
    assert!(site.posts[0].recipe.is_none());
}

#[test]
fn the_check_names_each_problem_by_position_and_never_repeats_the_authors_words() {
    let post = "---\ntitle: Secret stew\ndate: 2026-02-02\nprofile: recipe\nservings: a crowd\nprep: 30 min\ncook: 1 hr\ntotal: 45 min\n---\n\n## Ingredients\n\n- 0 secretcarrots\n- 3-2 cloves secretgarlic\n- 1/0 cup secretbroth\n- 2 secretonions\n- 2 SECRETONIONS\n\n## Steps\n\n1. Step 1: secretchop everything.\n2. Simmer.\n";
    let site = site(
        r#"{"title":"Kitchen","url":"","postPath":"/{slug}/"}"#,
        &[("posts/stew.md", post)],
    );
    let (_, problems) = export_of(&site, "stew");
    type Found<'a> = (Code, Option<usize>, Option<usize>, Option<&'a str>);
    let found: Vec<Found> = problems
        .iter()
        .map(|p| (p.code, p.ingredient, p.step, p.field))
        .collect();
    assert_eq!(
        found,
        vec![
            (Code::ZeroQuantity, Some(1), None, None),
            (Code::DescendingRange, Some(2), None, None),
            (Code::UnreadableQuantity, Some(3), None, None),
            (Code::DuplicateIngredient, Some(5), None, None),
            (Code::NumberedStep, None, Some(1), None),
            (Code::TotalShorterThanParts, None, None, Some("total")),
            (Code::ServingsNotNumeric, None, None, Some("servings")),
            (Code::NoCanonicalAddress, None, None, None),
            (Code::NoAuthor, None, None, None),
            (Code::NoImage, None, None, None),
        ]
    );
    assert!(recipe_check::has_errors(&problems));
    let reported = serde_json::to_string(&problems).unwrap()
        + &problems.iter().map(|p| p.line()).collect::<String>();
    assert!(!reported.to_lowercase().contains("secret"), "{reported}");
    assert_eq!(problems[0].severity, Severity::Error);
    assert_eq!(
        problems[0].line(),
        "error [zero-quantity] ingredient 1: an ingredient amount is zero; give the amount or leave the number out"
    );
}

#[test]
fn times_written_as_text_are_reported_and_left_out_of_both_page_and_export() {
    let post = PASTA
        .replace("prep: 10 min", "prep: overnight")
        .replace("cook: 15 min", "cook: 0 min");
    let site = site(CONFIG, &[("posts/pasta.md", &post)]);
    let (exported, problems) = export_of(&site, "pasta");
    assert!(exported.get("prepTime").is_none());
    assert!(exported.get("totalTime").is_none());
    assert_eq!(
        problems
            .iter()
            .map(|p| (p.code, p.field))
            .collect::<Vec<_>>(),
        vec![
            (Code::TimeNotExported, Some("prep")),
            (Code::ZeroTime, Some("cook")),
        ]
    );
}

#[test]
fn empty_lines_and_missing_lists_stop_the_export() {
    let site = site(CONFIG, &[("posts/pasta.md", PASTA)]);
    let post = &site.posts[0];
    let mut recipe: Recipe = post.recipe.clone().unwrap();
    recipe.ingredients.push("  ".into());
    recipe.steps.insert(0, String::new());
    let codes: Vec<Code> = recipe_check::check(&site.config, post, &recipe)
        .into_iter()
        .map(|p| p.code)
        .collect();
    assert_eq!(codes, vec![Code::EmptyIngredient, Code::EmptyStep]);

    let bare = Recipe::default();
    let problems = recipe_check::check(&site.config, post, &bare);
    assert_eq!(
        problems.iter().map(|p| p.code).take(2).collect::<Vec<_>>(),
        vec![Code::NoIngredients, Code::NoSteps]
    );
    assert!(recipe_check::has_errors(&problems));
}

#[test]
fn calories_need_something_to_be_per_and_one_time_alone_is_incomplete() {
    let post = PASTA
        .replace("servings: 4\n", "")
        .replace("cook: 15 min\n", "");
    let site = site(CONFIG, &[("posts/pasta.md", &post)]);
    let (_, problems) = export_of(&site, "pasta");
    assert_eq!(
        problems.iter().map(|p| p.code).collect::<Vec<_>>(),
        vec![Code::IncompleteTimes, Code::CaloriesWithoutYield]
    );
    assert!(!recipe_check::has_errors(&problems));
}

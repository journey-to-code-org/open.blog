//! Recipe interoperability (epic #385, story #397, ADRs 0333 and 0334): the page and the export
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

/// The recipe with a credit sidecar naming Bob as its only author.
fn credited_site() -> Site {
    let config = r#"{"title":"Kitchen","url":"https://kitchen.example","postPath":"/{slug}/","author":{"name":"Ann"},"contributors":{"bob":{"name":"Bob Guest","url":"https://bob.example"}}}"#;
    Site::load(
        SiteConfig::from_json(config).unwrap(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/soup.md".into(),
                contents: "---\ntitle: Guest soup\nslug: soup\ndate: 2026-02-02\ndescription: Warm.\nprofile: recipe\nservings: 2\ncover: /soup.jpg\n---\n## Ingredients\n\n- 1 leek\n\n## Steps\n\n1. Simmer.\n".into(),
            }],
            credits: vec![SourceFile {
                path: "posts/soup.credits.json".into(),
                contents: r#"{"version":1,"credits":[{"contributor":"bob","roles":[{"vocabulary":"crossref","role":"author"}]}]}"#.into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap()
}

#[test]
fn a_recipe_credits_the_people_its_post_credits_not_the_site_author() {
    let site = credited_site();
    let html = page(&site, "soup/index.html");
    let from_page = importer_recipe(&html).unwrap();
    let posting = html
        .split("<script type=\"application/ld+json\">")
        .skip(1)
        .filter_map(|chunk| serde_json::from_str::<Value>(&chunk[..chunk.find("</script>")?]).ok())
        .flat_map(|doc| match doc.get("@graph") {
            Some(Value::Array(nodes)) => nodes.clone(),
            _ => vec![doc],
        })
        .find(|doc| doc["@type"] == "BlogPosting")
        .expect("the page carries a BlogPosting");
    assert_eq!(from_page["author"][0]["name"], "Bob Guest");
    assert_eq!(from_page["author"], posting["author"]);
    assert!(!serde_json::to_string(&from_page["author"])
        .unwrap()
        .contains("Ann"));
    let (exported, problems) = export_of(&site, "soup");
    assert_eq!(exported["author"], from_page["author"]);
    assert!(
        problems.iter().all(|p| p.code != Code::NoAuthor),
        "{problems:?}"
    );
    let post = &site.posts[0];
    let credit =
        openblog_core::recipe_directory::credit(&site.config, post, post.recipe.as_ref().unwrap());
    assert_eq!(
        credit,
        "\"Guest soup\" by Bob Guest, first published at https://kitchen.example/soup/\n"
    );
}

#[test]
fn a_recipe_whose_canonical_names_another_page_is_not_exported() {
    let post = PASTA.replace(
        "tags: [dinner, quick]\n",
        "tags: [dinner, quick]\ncanonical: https://other.example/original\n",
    );
    let site = site(CONFIG, &[("posts/pasta.md", &post)]);
    let (_, problems) = export_of(&site, "pasta");
    let elsewhere = problems
        .iter()
        .find(|p| p.code == Code::CanonicalElsewhere)
        .expect("canonical-elsewhere is reported");
    assert_eq!(elsewhere.severity, Severity::Error);
    assert_eq!(elsewhere.field, Some("canonical"));
    // A canonical that names the post's own address is not elsewhere.
    let own = PASTA.replace(
        "tags: [dinner, quick]\n",
        "tags: [dinner, quick]\ncanonical: https://kitchen.example/pasta/\n",
    );
    let site = site_from(&own);
    let (_, problems) = export_of(&site, "pasta");
    assert!(problems.is_empty(), "{problems:?}");
}

fn site_from(post: &str) -> Site {
    site(CONFIG, &[("posts/pasta.md", post)])
}

#[test]
fn mixed_unit_systems_are_a_warning_and_nothing_is_rewritten() {
    let mixed = PASTA.replace(
        "- 1 1/2 lemons, zested & juiced\n",
        "- 1 1/2 lemons, zested & juiced\n- 1 cup cream\n- 2 tbsp butter\n- 4 oz parmesan\n",
    );
    let site = site_from(&mixed);
    let (exported, problems) = export_of(&site, "pasta");
    let found: Vec<_> = problems
        .iter()
        .filter(|p| p.code == Code::MixedUnitSystems)
        .collect();
    assert_eq!(found.len(), 1, "{problems:?}");
    assert_eq!(found[0].severity, Severity::Warning);
    // The first line in the second system: "400 g spaghetti" is first, "1 cup cream" third.
    assert_eq!(found[0].ingredient, Some(3));
    assert!(!recipe_check::has_errors(&problems));
    assert_eq!(exported["recipeIngredient"][2], "1 cup cream");
    assert_eq!(exported["recipeIngredient"][4], "4 oz parmesan");
    // One system throughout, spoons anywhere, or both measures on a line: no warning.
    for ingredients in [
        "- 400 g spaghetti\n- 250 ml cream\n- 2 tbsp butter\n",
        "- 1 lb spaghetti\n- 1 cup cream\n- 1 tsp salt\n",
        "- 400 g spaghetti\n- 1 cup (240 ml) cream\n",
        "- 400 g spaghetti\n- 2 eggs\n",
    ] {
        let one = PASTA.replace(
            "- 400 g spaghetti\n- 1 1/2 lemons, zested & juiced\n- Salt, to taste\n",
            ingredients,
        );
        let site = site_from(&one);
        let (_, problems) = export_of(&site, "pasta");
        assert!(
            problems.iter().all(|p| p.code != Code::MixedUnitSystems),
            "{ingredients}: {problems:?}"
        );
    }
}

#[test]
fn text_in_a_recipe_section_outside_its_list_is_reported() {
    let loose = PASTA.replace(
        "## Ingredients\n\n",
        "## Ingredients\n\nYou can use any long pasta.\n\n",
    );
    let site = site_from(&loose);
    let html = page(&site, "pasta/index.html");
    assert!(html.contains("You can use any long pasta."));
    let (exported, problems) = export_of(&site, "pasta");
    assert!(!serde_json::to_string(&exported)
        .unwrap()
        .contains("any long pasta"));
    let unlisted = problems
        .iter()
        .find(|p| p.code == Code::UnlistedText)
        .expect("unlisted-text is reported");
    assert_eq!(unlisted.severity, Severity::Warning);
    assert!(!unlisted.message.contains("pasta"));
    // The story before the recipe, and the headings themselves, are not recipe text.
    let site = site_from(PASTA);
    let (_, problems) = export_of(&site, "pasta");
    assert!(problems.iter().all(|p| p.code != Code::UnlistedText));
}

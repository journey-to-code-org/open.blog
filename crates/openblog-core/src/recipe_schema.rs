//! A recipe as schema.org `Recipe` data (epic #385, story #397, ADR 0333).
//!
//! One mapping serves both the `Recipe` node in a recipe page's JSON-LD graph and the standalone
//! recipe export (`openblog export <slug> --format recipe-json-ld`), so an importer that reads the
//! page and one that reads the file get the same facts. The mapping carries only what the post
//! says: a time written as text, a servings line that is not a number, or an "adapted from" that is
//! not a web address is left out rather than guessed.
//!
//! `crate::recipe_check` holds the checks an export must pass (ADR 0334).
//!
//! Pure: no environment, no network.

use serde_json::{json, Value as Json};

use crate::config::SiteConfig;
use crate::model::Post;
use crate::recipe::{iso_duration, Recipe};

/// The `Recipe` node of a recipe page's JSON-LD graph (no `@context`: the graph carries it).
pub fn recipe_node(config: &SiteConfig, post: &Post, recipe: &Recipe) -> Json {
    let mut r = json!({
        "@type": "Recipe",
        "name": post.title,
        "description": post.description,
        "datePublished": post.date.rfc3339(),
        "url": config.absolute(&post.url),
        "mainEntityOfPage": config.absolute(&post.url),
        "recipeIngredient": recipe.ingredients,
        "recipeInstructions": recipe.steps.iter().enumerate().map(|(i, s)| json!({
            "@type": "HowToStep",
            "position": i + 1,
            "text": s,
        })).collect::<Vec<_>>(),
        "keywords": post.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>().join(", "),
    });
    let obj = r.as_object_mut().expect("json object");
    if let Some(author) = crate::render::author_json_ld(config) {
        obj.insert("author".into(), author);
    }
    if let Some(image) = &post.cover {
        obj.insert("image".into(), json!([config.absolute(image)]));
    }
    for (key, minutes) in [
        ("prepTime", recipe.prep),
        ("cookTime", recipe.cook),
        ("totalTime", recipe.total),
    ] {
        if let Some(m) = minutes {
            obj.insert(key.into(), json!(iso_duration(m)));
        }
    }
    let yields: Vec<String> = recipe
        .servings_text
        .iter()
        .map(|s| {
            if recipe.servings.is_some_and(|n| s.parse::<u32>() == Ok(n)) {
                format!("{s} servings")
            } else {
                s.clone()
            }
        })
        .chain(recipe.yield_text.clone())
        .collect();
    if !yields.is_empty() {
        obj.insert("recipeYield".into(), json!(yields));
    }
    if let Some(v) = &recipe.cuisine {
        obj.insert("recipeCuisine".into(), json!(v));
    }
    if let Some(v) = &recipe.category {
        obj.insert("recipeCategory".into(), json!(v));
    }
    if let Some(v) = &recipe.calories {
        obj.insert(
            "nutrition".into(),
            json!({ "@type": "NutritionInformation", "calories": v }),
        );
    }
    if let Some(source) = recipe.adapted_from.as_deref().and_then(web_address) {
        obj.insert("isBasedOn".into(), json!(source));
    }
    r
}

/// The standalone export: the page's `Recipe` node with the schema.org context, so the file means
/// the same on its own as the node does inside the page's graph.
pub fn recipe_document(config: &SiteConfig, post: &Post, recipe: &Recipe) -> Json {
    let mut node = recipe_node(config, post, recipe);
    if let Some(obj) = node.as_object_mut() {
        obj.insert("@context".into(), json!("https://schema.org"));
    }
    node
}

/// An absolute `http` or `https` address with a host, as written; anything else is `None`.
pub(crate) fn web_address(value: &str) -> Option<&str> {
    let value = value.trim();
    let parsed = url::Url::parse(value).ok()?;
    (matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some_and(|h| !h.is_empty()))
    .then_some(value)
}

//! Tests of recipe directory packages (story #398, ADRs 0822 and 0823).

use super::*;
use crate::clock;
use crate::portable_export::{run_with_directories, Format};
use serde_json::Value;

const ALL: &str = "google-search,pinterest,foodgawker";

const CONFIG: &str =
    r#"{"url":"https://kitchen.example","postPath":"/{slug}/","author":{"name":"The Cook"}}"#;

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(b"\x08\x02\0\0\0rest-of-the-file");
    bytes
}

/// A site with a recipe (square local cover, adapted from another recipe), a recipe with an
/// error, a recipe without a cover, a recipe with a remote cover, and an article.
fn site_root(config: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-recipe-package-{}",
        crate::auth::random_token().unwrap()
    ));
    let posts = root.join("content/posts");
    fs::create_dir_all(&posts).unwrap();
    fs::create_dir_all(root.join("static/images")).unwrap();
    fs::write(root.join("openblog.json"), config).unwrap();
    fs::write(root.join("static/images/pasta.png"), png(1200, 1200)).unwrap();
    let recipe = |slug: &str, extra: &str, ingredient: &str| {
        let text = format!(
            "---\ntitle: \"{slug} <b>&</b>\"\nslug: {slug}\ndate: 2020-01-01\ndescription: Bright & quick.\nprofile: recipe\nservings: 2\n{extra}---\n## Ingredients\n\n- {ingredient}\n- Salt, to taste\n\n## Steps\n\n1. Boil the pasta.\n2. Toss with lemon.\n"
        );
        fs::write(posts.join(format!("{slug}.md")), text).unwrap();
    };
    recipe(
        "pasta",
        "cover: /images/pasta.png\nadaptedFrom: https://example.org/original\n",
        "200 g pasta",
    );
    recipe("stew", "cover: /images/pasta.png\n", "0 carrots");
    recipe("plain", "", "1 cup rice");
    recipe("remote", "cover: https://cdn.example/r.jpg\n", "1 cup rice");
    fs::write(
        posts.join("notes.md"),
        "---\ntitle: Notes\nslug: notes\ndate: 2020-01-03\n---\nJust words.\n",
    )
    .unwrap();
    root
}

fn export(
    root: &Path,
    slug: &str,
    out: Option<&Path>,
    directories: Option<&str>,
    write: bool,
) -> Result<(), String> {
    run_with_directories(
        root,
        slug,
        Format::RecipePackage,
        out.map(|p| p.to_str().unwrap()),
        directories,
        write,
        false,
    )
}

fn names(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn a_package_carries_the_pages_recipe_the_cover_and_the_credit_unchanged() {
    let root = site_root(CONFIG);
    let folder = root.join("packages/pasta");
    // A dry run writes nothing.
    export(&root, "pasta", Some(&folder), Some(ALL), false).unwrap();
    assert!(!folder.exists());
    export(&root, "pasta", Some(&folder), Some(ALL), true).unwrap();
    assert_eq!(
        names(&folder),
        [
            "credit.txt",
            "description.txt",
            "image.png",
            "index.html",
            "ingredients.txt",
            "link.txt",
            "package.json",
            "recipe.json",
            "steps.txt",
            "title.txt",
        ]
    );
    let read = |name: &str| fs::read_to_string(folder.join(name)).unwrap();
    let (site, _) = site::load_site(&root, false, Some(clock::now())).unwrap();
    let post = site.posts.iter().find(|p| p.slug == "pasta").unwrap();
    let recipe = post.recipe.as_ref().unwrap();
    // Round trip: the file is the page's own Recipe node with its context, and the text
    // files say exactly what it says.
    let mut node = openblog_core::recipe_schema::recipe_node(&site.config, post, recipe);
    node["@context"] = serde_json::json!("https://schema.org");
    let written: Value = serde_json::from_str(&read("recipe.json")).unwrap();
    assert_eq!(written, node);
    let ingredients: Vec<&str> = written["recipeIngredient"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(
        read("ingredients.txt").lines().collect::<Vec<_>>(),
        ingredients
    );
    let steps: Vec<String> = written["recipeInstructions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| format!("{}. {}", s["position"], s["text"].as_str().unwrap()))
        .collect();
    assert_eq!(read("steps.txt").lines().collect::<Vec<_>>(), steps);
    assert_eq!(read("link.txt"), "https://kitchen.example/pasta/\n");
    assert_eq!(written["url"], "https://kitchen.example/pasta/");
    assert_eq!(read("title.txt"), "pasta <b>&</b>\n");
    assert_eq!(read("description.txt"), "Bright & quick.\n");
    // Attribution: the author, the canonical post and the original travel together.
    assert_eq!(
        read("credit.txt"),
        "\"pasta <b>&</b>\" by The Cook, first published at https://kitchen.example/pasta/\nAdapted from https://example.org/original\n"
    );
    assert_eq!(written["isBasedOn"], "https://example.org/original");
    assert_eq!(
        fs::read(folder.join("image.png")).unwrap(),
        fs::read(root.join("static/images/pasta.png")).unwrap()
    );
    let plan: Value = serde_json::from_str(&read("package.json")).unwrap();
    assert_eq!(plan["version"], 1);
    assert_eq!(plan["sent"], false);
    assert_eq!(plan["ready"], true);
    assert_eq!(plan["linkedImage"], Value::Null);
    let directories = plan["directories"].as_array().unwrap();
    assert_eq!(directories.len(), 3);
    for d in directories {
        assert_eq!(d["status"], "ready", "{d}");
        assert_eq!(d["policyVersion"], "2026-10-29");
        assert!(d["capabilities"]
            .as_object()
            .unwrap()
            .values()
            .all(|s| s != "adapter"));
    }
    let codes = |d: &Value| -> Vec<String> {
        d["findings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["code"].as_str().unwrap().to_string())
            .collect()
    };
    assert!(codes(&directories[0]).is_empty());
    assert_eq!(codes(&directories[2]), ["conditions-unverified"]);
    // The guide is static and escapes the post's text.
    let page = read("index.html");
    assert!(!page.contains("<script") && !page.contains("<form"));
    assert!(page.contains("pasta &lt;b&gt;&amp;&lt;/b&gt;"));
    assert!(!page.contains("<b>&</b>"));
    assert!(page.contains("Prepared, not sent."));
    assert!(page.contains("(not verified: check it there)"));
    // An existing folder is never written into.
    assert!(export(&root, "pasta", Some(&folder), Some(ALL), true)
        .unwrap_err()
        .contains("refusing to write a package into existing"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unknown_closed_and_unverified_directories_and_blocked_recipes_write_nothing() {
    let root = site_root(CONFIG);
    let folder = root.join("packages/out");
    let refused = |slug: &str, directories: Option<&str>| {
        let error = export(&root, slug, Some(&folder), directories, true).unwrap_err();
        assert!(!folder.exists(), "{slug} {directories:?}: {error}");
        error
    };
    let closed = refused("pasta", Some("pinterest,yummly"));
    assert!(
        closed.contains("[directory-closed]") && closed.contains("December 2024"),
        "{closed}"
    );
    assert!(refused("pasta", Some("allrecipes")).contains("[terms-not-verified]"));
    let unknown = refused("pasta", Some("pinterest,cookbook-site"));
    assert!(unknown.contains("expected one or more of google-search, pinterest, foodgawker"));
    assert!(
        !unknown.contains("cookbook-site"),
        "the refused name is not repeated"
    );
    assert!(refused("stew", Some("pinterest")).contains("cannot be prepared"));
    assert!(refused("stew", None).contains("cannot be prepared"));
    // A directory that shows the dish's photo needs a cover.
    assert!(refused("plain", Some("google-search")).contains("cannot be prepared"));
    assert!(refused("notes", Some("pinterest")).contains("is not a recipe"));
    let other = run_with_directories(
        &root,
        "pasta",
        Format::RecipeJsonLd,
        None,
        Some("pinterest"),
        false,
        false,
    )
    .unwrap_err();
    assert!(other.contains("--directory applies to --format recipe-package only"));
    let (site, _) = site::load_site(&root, false, Some(clock::now())).unwrap();
    let plain = site.posts.iter().find(|p| p.slug == "plain").unwrap();
    let package = package(&root, &site, plain, &Directory::ALL).unwrap();
    for d in &package.directories {
        assert_eq!(d.status, recipe_directory::Status::Blocked);
        assert_eq!(d.findings[0].code, recipe_directory::FindingCode::NoImage);
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn with_no_directory_the_package_holds_the_recipe_files_and_says_so() {
    let root = site_root(CONFIG);
    let folder = root.join("packages/plain");
    export(&root, "plain", Some(&folder), None, true).unwrap();
    assert!(!folder.join("image.png").exists());
    let plan: Value =
        serde_json::from_str(&fs::read_to_string(folder.join("package.json")).unwrap()).unwrap();
    assert_eq!(plan["noDirectory"], true);
    assert_eq!(plan["ready"], true);
    let page = fs::read_to_string(folder.join("index.html")).unwrap();
    assert!(page.contains("No directory chosen"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_cover_outside_the_static_folder_or_in_private_state_is_linked_never_copied() {
    let root = site_root(CONFIG);
    let (site, _) = site::load_site(&root, false, Some(clock::now())).unwrap();
    let remote = site.posts.iter().find(|p| p.slug == "remote").unwrap();
    let linked = package(&root, &site, remote, &[Directory::Pinterest]).unwrap();
    assert_eq!(
        linked.linked_image.as_deref(),
        Some("https://cdn.example/r.jpg")
    );
    assert!(linked.files.iter().all(|f| !f.name.starts_with("image.")));
    assert_eq!(
        linked.directories[0].findings[0].code,
        recipe_directory::FindingCode::ImageLinkedNotIncluded
    );
    assert!(linked.ready());
    fs::remove_dir_all(root).unwrap();

    // A static folder that is the project root never hands out private project state.
    let root = site_root(
        r#"{"url":"https://kitchen.example","postPath":"/{slug}/","paths":{"static":"."}}"#,
    );
    fs::create_dir_all(root.join(".openblog")).unwrap();
    fs::write(root.join(".openblog/secret.png"), png(10, 10)).unwrap();
    let mut site = site::load_site(&root, false, Some(clock::now())).unwrap().0;
    let index = site.posts.iter().position(|p| p.slug == "pasta").unwrap();
    for cover in [
        "/.openblog/secret.png",
        "/../openblog.json",
        "//evil.example/x.png",
        "/static/images/missing.png",
    ] {
        site.posts[index].cover = Some(cover.into());
        let p = package(&root, &site, &site.posts[index], &[Directory::Foodgawker]).unwrap();
        assert!(
            p.files.iter().all(|f| !f.name.starts_with("image.")),
            "{cover} was copied"
        );
        assert!(p.linked_image.is_some(), "{cover}");
    }
    // The same kind of image inside the static folder is copied, with its size read.
    site.posts[index].cover = Some("/static/images/pasta.png".into());
    let p = package(&root, &site, &site.posts[index], &[Directory::Foodgawker]).unwrap();
    assert!(p.files.iter().any(|f| f.name == "image.png"));
    assert!(p.directories[0]
        .findings
        .iter()
        .all(|f| f.code != recipe_directory::FindingCode::ImageSizeUnknown));
    fs::remove_dir_all(root).unwrap();
}

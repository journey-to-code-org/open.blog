//! `openblog init` and `openblog new`.

use std::fs;
use std::path::Path;

use openblog_core::frontmatter::{self, Value};
use openblog_core::slug::slugify;
use openblog_core::{DateTime, SiteConfig};

use crate::fsutil;
use crate::site::{self, CONFIG_FILE, EMBEDDED_BASE_THEME, EMBEDDED_WEB};

pub fn today() -> DateTime {
    crate::clock::now()
}

const WELCOME: &str = "Welcome to your new blog. This post is a plain Markdown file in `content/posts/`.

## Write

Drop any `.md` file into `content/posts/`. The front matter at the top sets the title, date, tags, and optional series.

## Publish

Run `openblog build`, then upload the `dist/` folder to any static host. Your RSS feed is at `/rss.xml`.

```rust
fn main() {
    println!(\"Hello, open.blog!\");
}
```
";

const ABOUT: &str = "This page is `content/pages/about.md`. Pages with `nav: true` in their front matter appear in the header.
";

/// Create a new project in `dir`. Existing files are never overwritten.
pub fn init(dir: &Path, title: Option<&str>, github_pages: bool) -> Result<Vec<String>, String> {
    let mut created = Vec::new();
    let mut write = |rel: &str, contents: &str| -> Result<(), String> {
        let path = dir.join(rel);
        if path.exists() {
            return Ok(());
        }
        fsutil::write_file(&path, contents.as_bytes())?;
        created.push(rel.to_string());
        Ok(())
    };

    let mut config = SiteConfig::default();
    if let Some(t) = title {
        config.title = t.to_string();
    }
    write(CONFIG_FILE, &format!("{}\n", config.to_json()))?;

    let date = today().ymd();
    let post = frontmatter::serialize(&[
        ("title", Value::Scalar("Hello, world".into())),
        ("date", Value::Scalar(date)),
        ("tags", Value::List(vec!["meta".into()])),
        (
            "description",
            Value::Scalar("The first post on a new open.blog.".into()),
        ),
    ]);
    write(
        "content/posts/hello-world.md",
        &format!("{post}\n{WELCOME}"),
    )?;
    let page = frontmatter::serialize(&[
        ("title", Value::Scalar("About".into())),
        ("nav", Value::Scalar("true".into())),
    ]);
    write("content/pages/about.md", &format!("{page}\n{ABOUT}"))?;
    write("content/series/.gitkeep", "")?;
    write("static/.gitkeep", "")?;

    write("themes/base/theme.json", EMBEDDED_BASE_THEME)?;
    for (rel, contents) in site::EMBEDDED_THEMES {
        write(&format!("themes/{rel}"), contents)?;
    }
    for (rel, contents) in EMBEDDED_WEB {
        write(&format!("web/{rel}"), contents)?;
    }
    write(".gitignore", "/dist\n/.openblog\n")?;
    if github_pages {
        let workflow = site::PAGES_WORKFLOW.replace("OPENBLOG_VERSION", env!("CARGO_PKG_VERSION"));
        write(".github/workflows/pages.yml", &workflow)?;
    }
    // Binary files (the WebAssembly search engine) go last, after the text closure is done.
    for (rel, bytes) in site::EMBEDDED_WEB_BINARY {
        let path = dir.join("web").join(rel);
        if !path.exists() {
            fsutil::write_file(&path, bytes)?;
            created.push(format!("web/{rel}"));
        }
    }
    Ok(created)
}

/// The body of `openblog new --recipe`: the sections the engine turns into
/// a recipe card, scaling, checklists and timers, ready to fill in.
const RECIPE_BODY: &str = "
A few words about this dish: where it comes from and why you make it.

> [!TIP]
> A swap, a shortcut, or something to watch out for.

## Ingredients

- 2 cups flour
- 1 tsp salt
- 1 1/2 cups milk

## Steps

1. Heat the oven to 200 °C (400 °F).
2. Mix everything into a smooth batter.
3. Bake for 25 minutes, until golden.
";

/// Create `content/posts/<date>-<slug>.md` and return its path. With `recipe`,
/// the post starts from a recipe template (servings, times, ingredients, steps).
pub fn new_post(
    root: &Path,
    title: &str,
    series: Option<&str>,
    tags: &[String],
    draft: bool,
    recipe: bool,
) -> Result<String, String> {
    let config = site::load_config(root)?;
    let slug = slugify(title);
    if slug.is_empty() {
        return Err("the title needs at least one letter or digit".into());
    }
    let date = today().ymd();
    let rel = format!("{}/posts/{date}-{slug}.md", config.paths.content);
    let path = root.join(&rel);
    if path.exists() {
        return Err(format!("{rel} already exists"));
    }
    let mut fields: Vec<(&str, Value)> = vec![
        ("title", Value::Scalar(title.to_string())),
        ("date", Value::Scalar(date)),
    ];
    if let Some(s) = series {
        fields.push(("series", Value::Scalar(slugify(s))));
    }
    if !tags.is_empty() {
        fields.push(("tags", Value::List(tags.to_vec())));
    }
    fields.push(("description", Value::Scalar(String::new())));
    if recipe {
        for (key, value) in [
            ("recipe", "true"),
            ("servings", "4"),
            ("prep", "15 min"),
            ("cook", "25 min"),
        ] {
            fields.push((key, Value::Scalar(value.into())));
        }
    }
    if draft {
        fields.push(("draft", Value::Scalar("true".into())));
    }
    let mut text = frontmatter::serialize(&fields);
    text.push_str(if recipe {
        RECIPE_BODY
    } else {
        "\nWrite your post here.\n"
    });
    fs::create_dir_all(path.parent().unwrap_or(root)).map_err(|e| e.to_string())?;
    fsutil::write_file(&path, text.as_bytes())?;
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_a_buildable_project_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("ob-init-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let created = init(&dir, Some("My Blog"), true).unwrap();
        assert!(created.iter().any(|c| c == "openblog.json"));
        fs::write(
            dir.join("content/posts/hello-world.md"),
            "---\ntitle: Mine\ndate: 2026-01-01\n---\nkeep",
        )
        .unwrap();
        assert!(init(&dir, Some("Other"), false).unwrap().is_empty());
        assert!(
            dir.join("web/wasm/openblog_wasm_bg.wasm").exists(),
            "search works without a workspace"
        );
        assert!(
            dir.join("themes/demo/reveal.js").exists()
                && dir.join("themes/paper/theme.json").exists()
        );
        let workflow = fs::read_to_string(dir.join(".github/workflows/pages.yml")).unwrap();
        assert!(workflow.contains("openblog build") && !workflow.contains("OPENBLOG_VERSION"));
        assert!(fs::read_to_string(dir.join("content/posts/hello-world.md"))
            .unwrap()
            .contains("keep"));

        let report = site::build(
            &dir,
            &site::BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .unwrap();
        assert_eq!(report.posts, 1);
        assert!(dir.join("dist/index.html").exists());
        assert!(dir.join("dist/rss.xml").exists());
        assert!(dir.join("dist/assets/base.css").exists());
        assert!(dir.join("dist/assets/components/ob-quiz.js").exists());
        assert!(dir.join("dist/themes/base/tokens.css").exists());
        assert!(dir.join("dist/assets/wasm/openblog_wasm_bg.wasm").exists());
        fs::write(dir.join("content/posts/_notes.md"), "not a post").unwrap();
        fs::create_dir_all(dir.join("content/posts/_ideas")).unwrap();
        fs::write(dir.join("content/posts/_ideas/x.md"), "not a post either").unwrap();

        let rel = new_post(
            &dir,
            "A New Post!",
            Some("My Series"),
            &["rust".into()],
            true,
            false,
        )
        .unwrap();
        assert!(rel.ends_with("-a-new-post.md"));
        assert!(new_post(&dir, "A New Post!", None, &[], false, false).is_err());
        let recipe = new_post(&dir, "Lemon Pasta", None, &[], true, true).unwrap();
        let text = fs::read_to_string(dir.join(&recipe)).unwrap();
        let doc = openblog_core::frontmatter::parse(&text).unwrap();
        assert!(openblog_core::recipe::is_recipe(&doc.front_matter));
        assert!(text.contains("## Ingredients") && text.contains("## Steps"));
        let drafts = site::build(
            &dir,
            &site::BuildOptions {
                include_drafts: true,
                out_override: None,
                now: None,
            },
        )
        .unwrap();
        assert_eq!(drafts.posts, 3, "hello world, the new post and the recipe");
        let _ = fs::remove_dir_all(&dir);
    }
}

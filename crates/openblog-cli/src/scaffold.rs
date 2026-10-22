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
pub fn init(dir: &Path, title: Option<&str>) -> Result<Vec<String>, String> {
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
        ("description", Value::Scalar("The first post on a new open.blog.".into())),
    ]);
    write("content/posts/hello-world.md", &format!("{post}\n{WELCOME}"))?;
    let page = frontmatter::serialize(&[("title", Value::Scalar("About".into())), ("nav", Value::Scalar("true".into()))]);
    write("content/pages/about.md", &format!("{page}\n{ABOUT}"))?;
    write("content/series/.gitkeep", "")?;
    write("static/.gitkeep", "")?;

    write("themes/base/theme.json", EMBEDDED_BASE_THEME)?;
    for (rel, contents) in EMBEDDED_WEB {
        write(&format!("web/{rel}"), contents)?;
    }
    write(".gitignore", "/dist\n/target\n/.openblog\n")?;
    Ok(created)
}

/// Create `content/posts/<date>-<slug>.md` and return its path.
pub fn new_post(root: &Path, title: &str, series: Option<&str>, tags: &[String], draft: bool) -> Result<String, String> {
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
    let mut fields: Vec<(&str, Value)> = vec![("title", Value::Scalar(title.to_string())), ("date", Value::Scalar(date))];
    if let Some(s) = series {
        fields.push(("series", Value::Scalar(slugify(s))));
    }
    if !tags.is_empty() {
        fields.push(("tags", Value::List(tags.to_vec())));
    }
    fields.push(("description", Value::Scalar(String::new())));
    if draft {
        fields.push(("draft", Value::Scalar("true".into())));
    }
    let mut text = frontmatter::serialize(&fields);
    text.push_str("\nWrite your post here.\n");
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
        let created = init(&dir, Some("My Blog")).unwrap();
        assert!(created.iter().any(|c| c == "openblog.json"));
        fs::write(dir.join("content/posts/hello-world.md"), "---\ntitle: Mine\ndate: 2026-01-01\n---\nkeep").unwrap();
        assert!(init(&dir, Some("Other")).unwrap().is_empty());
        assert!(fs::read_to_string(dir.join("content/posts/hello-world.md")).unwrap().contains("keep"));

        let report = site::build(&dir, &site::BuildOptions { include_drafts: false, out_override: None, now: None }).unwrap();
        assert_eq!(report.posts, 1);
        assert!(dir.join("dist/index.html").exists());
        assert!(dir.join("dist/rss.xml").exists());
        assert!(dir.join("dist/assets/base.css").exists());
        assert!(dir.join("dist/themes/base/tokens.css").exists());

        let rel = new_post(&dir, "A New Post!", Some("My Series"), &["rust".into()], true).unwrap();
        assert!(rel.ends_with("-a-new-post.md"));
        assert!(new_post(&dir, "A New Post!", None, &[], false).is_err());
        let drafts = site::build(&dir, &site::BuildOptions { include_drafts: true, out_override: None, now: None }).unwrap();
        assert_eq!(drafts.posts, 2);
        let _ = fs::remove_dir_all(&dir);
    }
}

use std::path::{Path, PathBuf};

use openblog_core::portability::PortableProjection;
use openblog_core::Site;

use crate::{clock, fsutil, site};

pub fn run(root: &Path, slug: &str, output: Option<&str>, write: bool) -> Result<(), String> {
    if output.is_some_and(str::is_empty) {
        return Err("--out must name a file; no files were changed".into());
    }
    if !write && output.is_some() {
        println!("Dry run: no files will be written. Re-run with --write to create the export.");
    }

    let (site, _) = site::load_site(root, false, Some(clock::now()))?;
    let post = site
        .posts
        .iter()
        .find(|post| post.slug == slug)
        .ok_or_else(|| format!("published post `{slug}` was not found"))?;
    let projection = PortableProjection::from_post(post, &site.config)?;
    let markdown = projection.portable_markdown()?;
    for diagnostic in projection.portable_html()?.diagnostics {
        println!(
            "warning: {} [{}] {} Action: {}",
            diagnostic.source_path,
            diagnostic.code,
            diagnostic.message,
            diagnostic.recommended_action
        );
    }

    if write {
        let output = output.ok_or("--write requires --out <path>; no files were changed")?;
        let destination = output_path(root, output);
        match std::fs::symlink_metadata(&destination) {
            Ok(_) => {
                return Err(format!(
                    "refusing to overwrite existing export {}; choose a new path",
                    destination.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "cannot inspect export destination {}: {error}",
                    destination.display()
                ));
            }
        }
        fsutil::write_file(&destination, markdown.as_bytes())?;
        println!("Portable Markdown written to {}", destination.display());
    } else {
        if let Some(output) = output {
            println!(
                "Would write portable Markdown to {}",
                output_path(root, output).display()
            );
        } else {
            println!(
                "Portable Markdown preview for `{}` ({})",
                post.title,
                projection.canonical_url()
            );
        }
        print!("{markdown}");
    }
    Ok(())
}

pub fn diagnostics(site: &Site) -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();
    for post in site.posts.iter().filter(|post| !post.draft) {
        let projection = PortableProjection::from_post(post, &site.config)?;
        for diagnostic in projection.portable_html()?.diagnostics {
            warnings.push(format!(
                "{} [{}] {} Action: {}",
                diagnostic.source_path,
                diagnostic.code,
                diagnostic.message,
                diagnostic.recommended_action
            ));
        }
    }
    Ok(warnings)
}

fn output_path(root: &Path, output: &str) -> PathBuf {
    let path = PathBuf::from(output);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn universal_publishing_export_requires_write_and_preserves_source_and_existing_files() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("examples")
            .join("portable-publishing");
        let source_path = root.join("content/posts/portable-lesson.md");
        let before = std::fs::read(&source_path).unwrap();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let destination = std::env::temp_dir().join(format!("openblog-portable-{unique}.md"));
        let output = destination.to_str().unwrap();
        run(&root, "portable-lesson", Some(output), false).unwrap();
        assert!(!destination.exists());
        run(&root, "portable-lesson", Some(output), true).unwrap();
        let exported = std::fs::read_to_string(&destination).unwrap();
        for essential in [
            "Alex Example",
            "**Answer:** 2. 42",
            "Open in Rust Playground",
            "Supporting study",
            "Join the discussion",
        ] {
            assert!(exported.contains(essential), "{essential}: {exported}");
        }
        for private in ["PRIVATE_", "runner.example.org", "discussion.example.org"] {
            assert!(!exported.contains(private), "{private}: {exported}");
        }
        let error = run(&root, "portable-lesson", Some(output), true).unwrap_err();
        assert!(error.contains("refusing to overwrite"));
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), exported);
        assert_eq!(std::fs::read(&source_path).unwrap(), before);
        std::fs::remove_file(destination).unwrap();
    }
}

use std::path::{Path, PathBuf};

use openblog_core::portability::PortableProjection;
use openblog_core::Site;

use crate::{clock, fsutil, site};

pub fn run(
    root: &Path,
    slug: &str,
    output: Option<&str>,
    write: bool,
    json: bool,
) -> Result<(), String> {
    if json && write {
        return Err("--json is available for dry runs only; no files were changed".into());
    }
    if output.is_some_and(str::is_empty) {
        return Err("--out must name a file; no files were changed".into());
    }
    let destination = output.map(|output| output_path(root, output)).transpose()?;
    if !write && !json && output.is_some() {
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
    let portable = projection.portable_html()?;
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&export_plan(
                &projection,
                &markdown,
                &portable,
                destination.as_deref(),
            )?)
            .map_err(|error| format!("cannot serialize export plan: {error}"))?
        );
        return Ok(());
    }
    for capability in &portable.capabilities {
        println!(
            "capability: {} [{}] {:?}",
            post.source, capability.id, capability.portability
        );
    }
    for diagnostic in portable.diagnostics {
        println!(
            "warning: {} [{}] {} Action: {}",
            diagnostic.source_path,
            diagnostic.code,
            diagnostic.message,
            diagnostic.recommended_action
        );
    }

    if write {
        let destination =
            destination.ok_or("--write requires --out <path>; no files were changed")?;
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
        fsutil::write_new_atomic(&destination, markdown.as_bytes())?;
        println!("Portable Markdown written to {}", destination.display());
    } else {
        if let Some(destination) = destination {
            println!("Would write portable Markdown to {}", destination.display());
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

fn export_plan(
    projection: &PortableProjection<'_>,
    markdown: &str,
    portable: &openblog_core::portability::PortableHtmlOutput,
    destination: Option<&Path>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "version": 1,
        "sourcePath": projection.source_path(),
        "sourceRevision": projection.source_revision()?,
        "canonicalUrl": projection.canonical_url(),
        "representation": "portable-markdown",
        "outputFile": destination,
        "bytes": markdown.len(),
        "writeRequested": false,
        "capabilities": portable.capabilities,
        "diagnostics": portable.diagnostics.iter().map(|diagnostic| diagnostic.scoped("portable-markdown", "portable-export")).collect::<Vec<_>>(),
        "content": markdown,
    }))
}

pub fn diagnostics(site: &Site) -> Result<Vec<String>, String> {
    collect_diagnostics(site, false)
}

pub fn build_diagnostics(site: &Site) -> Result<Vec<String>, String> {
    collect_diagnostics(site, true)
}

fn collect_diagnostics(site: &Site, optional: bool) -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();
    for post in site.posts.iter().filter(|post| !post.draft) {
        let portable = PortableProjection::from_post(post, &site.config)
            .and_then(|projection| projection.portable_html());
        let portable = match portable {
            Ok(portable) => portable,
            Err(error) if optional => {
                warnings.push(format!("portable HTML unavailable: {error}. Native output is unaffected; repair this source before using portable destinations."));
                continue;
            }
            Err(error) => return Err(error),
        };
        for diagnostic in portable.diagnostics {
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

fn output_path(root: &Path, output: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(output);
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
        || path.file_name().is_none()
    {
        return Err("export path must name a file without `..`; no files were changed".into());
    }
    let destination = if path.is_absolute() {
        path
    } else {
        root.join(path)
    };
    for ancestor in destination.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "export path contains a symlink: {}",
                    ancestor.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "cannot inspect export path {}: {error}",
                    ancestor.display()
                ))
            }
        }
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_manifest_is_deterministic_and_reports_exact_artifact_and_capability_levels() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("examples")
            .join("portable-publishing");
        let (site, _) = site::load_site(&root, false, Some(clock::now())).unwrap();
        let post = site
            .posts
            .iter()
            .find(|post| post.slug == "portable-lesson")
            .unwrap();
        let projection = PortableProjection::from_post(post, &site.config).unwrap();
        let markdown = projection.portable_markdown().unwrap();
        let portable = projection.portable_html().unwrap();
        let destination = root.join("exports").join("lesson.md");
        let plan = export_plan(&projection, &markdown, &portable, Some(&destination)).unwrap();
        assert_eq!(
            plan,
            export_plan(&projection, &markdown, &portable, Some(&destination)).unwrap()
        );
        assert_eq!(plan["version"], 1);
        assert_eq!(plan["sourcePath"], "posts/portable-lesson.md");
        assert_eq!(plan["bytes"], markdown.len());
        assert_eq!(plan["content"], markdown);
        assert_eq!(plan["writeRequested"], false);
        assert!(plan["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|capability| {
                capability["id"] == "knowledge-check"
                    && capability["portability"] == "gracefully-transformed"
            }));
        assert!(!plan["diagnostics"].as_array().unwrap().is_empty());
        assert!(!destination.exists());
        assert!(run(
            &root,
            "portable-lesson",
            Some(destination.to_str().unwrap()),
            true,
            true
        )
        .unwrap_err()
        .contains("dry runs only"));
        assert!(!destination.exists());
        for path in ["../escape.md", "exports/../../escape.md", "exports/.."] {
            assert!(output_path(&root, path)
                .unwrap_err()
                .contains("without `..`"));
        }
    }

    #[test]
    fn atomic_export_never_replaces_a_concurrent_destination_and_cleans_staging_files() {
        let directory = std::env::temp_dir().join(format!(
            "openblog-export-atomic-{}-{}",
            std::process::id(),
            crate::auth::random_token().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        let destination = directory.join("lesson.md");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let writers = [b"first".to_vec(), b"second".to_vec()].map(|contents| {
            let barrier = barrier.clone();
            let destination = destination.clone();
            std::thread::spawn(move || {
                barrier.wait();
                fsutil::write_new_atomic(&destination, &contents)
            })
        });
        let outcomes = writers.map(|writer| writer.join().unwrap());
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        let written = std::fs::read(&destination).unwrap();
        assert!(written == b"first" || written == b"second");
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        let error =
            fsutil::write_new_atomic(&directory, b"cannot replace a directory").unwrap_err();
        assert!(error.contains("cannot publish export"));
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_file(destination).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn export_rejects_symlinked_destinations_without_touching_the_target() {
        let directory = std::env::temp_dir().join(format!(
            "openblog-export-symlink-{}",
            crate::auth::random_token().unwrap()
        ));
        std::fs::create_dir(&directory).unwrap();
        std::os::unix::fs::symlink(std::env::temp_dir(), directory.join("redirect")).unwrap();
        let error = output_path(&directory, "redirect/lesson.md").unwrap_err();
        assert!(error.contains("symlink"));
        std::fs::remove_file(directory.join("redirect")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn export_rejects_drafts_scheduled_posts_and_invalid_projections_without_writes() {
        let directory = std::env::temp_dir().join(format!(
            "openblog-export-private-{}",
            crate::auth::random_token().unwrap()
        ));
        let posts = directory.join("documents/posts");
        std::fs::create_dir_all(&posts).unwrap();
        std::fs::write(
            directory.join("openblog.json"),
            r#"{"url":"https://portable.example.org","paths":{"content":"documents"}}"#,
        )
        .unwrap();
        let destination = directory.join("exports/lesson.md");
        for (metadata, body) in [
            ("draft: true\ndate: 2020-01-01", "PRIVATE"),
            ("date: 2099-01-01", "SCHEDULED"),
            ("date: 2020-01-01", "[unsafe](javascript:alert(1))"),
        ] {
            let source = format!("---\ntitle: Lesson\nslug: lesson\n{metadata}\n---\n{body}\n");
            std::fs::write(posts.join("lesson.md"), &source).unwrap();
            assert!(run(
                &directory,
                "lesson",
                Some(destination.to_str().unwrap()),
                true,
                false
            )
            .is_err());
            assert!(!destination.exists());
            assert!(!destination.parent().unwrap().exists());
            assert_eq!(
                std::fs::read_to_string(posts.join("lesson.md")).unwrap(),
                source
            );
        }
        std::fs::remove_file(posts.join("lesson.md")).unwrap();
        std::fs::remove_dir(&posts).unwrap();
        std::fs::remove_dir(directory.join("documents")).unwrap();
        std::fs::remove_file(directory.join("openblog.json")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

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
        run(&root, "portable-lesson", Some(output), false, false).unwrap();
        assert!(!destination.exists());
        run(&root, "portable-lesson", Some(output), true, false).unwrap();
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
        let error = run(&root, "portable-lesson", Some(output), true, false).unwrap_err();
        assert!(error.contains("refusing to overwrite"));
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), exported);
        assert_eq!(std::fs::read(&source_path).unwrap(), before);
        std::fs::remove_file(destination).unwrap();
    }
}

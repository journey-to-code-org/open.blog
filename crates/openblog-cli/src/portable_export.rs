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

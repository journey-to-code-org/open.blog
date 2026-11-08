//! `openblog export <slug> --format recipe-package [--directory a,b] --out <new folder> --write`
//! (epic #385, story #398, ADRs 0335 and 0336): a folder with everything a recipe directory's own
//! submission needs, and a static guide to the author's steps. Nothing is sent and no credential
//! is read; every submission is the author's act, by hand.

use std::fs;
use std::path::{Path, PathBuf};

use openblog_core::model::Post;
use openblog_core::recipe_directory::{
    self, CheckInput, Cover, Directory, Lookup, Package, PackageFile,
};
use openblog_core::{recipe_check, Site};

use crate::{fsutil, site};

/// The largest cover copied into a package.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// The image types a package carries as a file, by lowercase extension.
const IMAGE_EXTENSIONS: [&str; 6] = ["jpg", "jpeg", "png", "gif", "webp", "avif"];

/// Reads `--directory`: a comma-separated list of directory names. None chosen is a state of its
/// own (the package holds the portable files only). An unknown or unavailable name is refused
/// with its reason, before anything is read or written.
pub fn parse_directories(value: Option<&str>) -> Result<Vec<Directory>, String> {
    let mut chosen = Vec::new();
    let Some(value) = value else {
        return Ok(chosen);
    };
    for name in value.split(',').map(str::trim) {
        match Directory::parse(name) {
            Lookup::Supported(directory) => {
                if !chosen.contains(&directory) {
                    chosen.push(directory);
                }
            }
            Lookup::Unavailable(unavailable) => {
                return Err(format!(
                    "{} [{}]: {} No files were changed.",
                    unavailable.label, unavailable.code, unavailable.reason
                ))
            }
            Lookup::Unknown => {
                let known: Vec<&str> = Directory::ALL.iter().map(|d| d.as_str()).collect();
                return Err(format!(
                    "unknown recipe directory; expected one or more of {} (comma-separated). No files were changed.",
                    known.join(", ")
                ));
            }
        }
    }
    Ok(chosen)
}

/// The cover as a file of the site's static folder, or as a linked address. A path that leaves
/// the static folder, a symlink, private project state or an unknown image type is only linked.
fn cover(root: &Path, site: &Site, post: &Post) -> (Cover, Option<Vec<u8>>) {
    let Some(raw) = post
        .cover
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    else {
        return (Cover::None, None);
    };
    let linked = || {
        (
            Cover::Linked {
                url: site.config.absolute(raw),
            },
            None,
        )
    };
    let Some(relative) = raw.strip_prefix('/').filter(|r| !r.starts_with('/')) else {
        return linked();
    };
    let relative = relative.split(['?', '#']).next().unwrap_or_default();
    let path = Path::new(relative);
    if relative.is_empty()
        || path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return linked();
    }
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|e| IMAGE_EXTENSIONS.contains(&e.as_str()));
    let Some(extension) = extension else {
        return linked();
    };
    let static_dir = root.join(&site.config.paths.static_dir);
    let file = static_dir.join(path);
    let private =
        fsutil::PrivateState::of(root).withhold(&site::comparison_files(root, &site.config));
    let inside = match (fs::canonicalize(&static_dir), fs::canonicalize(&file)) {
        (Ok(dir), Ok(file)) => file.starts_with(dir),
        _ => false,
    };
    let regular = fs::symlink_metadata(&file)
        .is_ok_and(|m| m.file_type().is_file() && m.len() <= MAX_IMAGE_BYTES);
    if !inside || !regular || private.contains(&file) {
        return linked();
    }
    match fs::read(&file) {
        Ok(bytes) => (
            Cover::Local {
                file: format!("image.{extension}"),
                size: recipe_directory::image_size(&bytes),
            },
            Some(bytes),
        ),
        Err(_) => linked(),
    }
}

/// The whole package for `post`, checked for each chosen directory. `Err` when the post is not
/// a recipe.
pub fn package(
    root: &Path,
    site: &Site,
    post: &Post,
    directories: &[Directory],
) -> Result<Package, String> {
    let recipe = post.recipe.as_ref().ok_or_else(|| {
        format!(
            "`{}` is not a recipe, so there is no recipe package to prepare; add `profile: recipe` to its front matter. No files were changed.",
            post.source
        )
    })?;
    let canonical_url = site.config.absolute(&post.url);
    let recipe_problems = recipe_check::check(&site.config, post, recipe);
    let (cover, image) = cover(root, site, post);
    let canonical_elsewhere = post
        .canonical
        .as_deref()
        .map(str::trim)
        .is_some_and(|c| !c.is_empty() && c != canonical_url);
    let input = CheckInput {
        recipe_problems: &recipe_problems,
        cover: &cover,
        description: &post.description,
        canonical_elsewhere,
    };
    let plans = directories
        .iter()
        .map(|d| recipe_directory::plan(*d, &input, &canonical_url))
        .collect();
    let mut files = recipe_directory::text_files(&site.config, post, recipe);
    let mut linked_image = None;
    match (&cover, image) {
        (Cover::Local { file, .. }, Some(bytes)) => files.push(PackageFile {
            name: file.clone(),
            purpose: "The post's cover image, byte for byte",
            contents: bytes,
        }),
        (Cover::Linked { url }, _) => linked_image = Some(url.clone()),
        _ => {}
    }
    Ok(Package {
        title: post.title.clone(),
        source_path: post.source.clone(),
        canonical_url,
        recipe_problems,
        directories: plans,
        files,
        linked_image,
    })
}

pub fn run(
    root: &Path,
    site: &Site,
    post: &Post,
    destination: Option<&Path>,
    directories: &[Directory],
    write: bool,
    json: bool,
) -> Result<(), String> {
    let package = package(root, site, post, directories)?;
    // The publication boundary (ADR 0125) over every text file the package holds.
    let text: String = package
        .files
        .iter()
        .filter(|f| !f.name.starts_with("image."))
        .map(|f| String::from_utf8_lossy(&f.contents).into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    for warning in crate::boundary::check_export(
        root,
        site,
        &format!("the recipe package of `{}`", post.slug),
        &text,
        false,
    )? {
        eprintln!("warning: {warning}");
    }
    let manifest = recipe_directory::package_manifest(&package);
    if json {
        let mut plan = manifest;
        plan["outputFolder"] = serde_json::json!(destination);
        plan["writeRequested"] = serde_json::json!(false);
        println!(
            "{}",
            serde_json::to_string_pretty(&plan)
                .map_err(|error| format!("cannot serialize the package plan: {error}"))?
        );
        return Ok(());
    }
    for problem in &package.recipe_problems {
        println!("{}: {}", post.source, problem.line());
    }
    for plan in &package.directories {
        for finding in &plan.findings {
            println!("{}: {}", post.source, finding.line(plan.label));
        }
    }
    if !package.ready() {
        return Err(format!(
            "the recipe package for `{}` cannot be prepared until the errors above are fixed; no files were changed",
            post.source
        ));
    }
    if package.directories.is_empty() {
        println!("No directory chosen: the package holds the recipe files only. Choose with --directory {}.",
            Directory::ALL.iter().map(|d| d.as_str()).collect::<Vec<_>>().join(","));
    }
    if !write {
        match destination {
            Some(folder) => println!("Would write a recipe package to {}:", folder.display()),
            None => println!(
                "Recipe package preview for `{}` ({}):",
                post.title, package.canonical_url
            ),
        }
        for file in &package.files {
            println!(
                "  {} ({} bytes): {}",
                file.name,
                file.contents.len(),
                file.purpose
            );
        }
        println!("  package.json, index.html: the plan and the guide to your steps");
        println!("Nothing was sent. Re-run with --out <new folder> --write to write it.");
        return Ok(());
    }
    let folder = destination.ok_or("--write requires --out <new folder>; no files were changed")?;
    write_package(folder, &package, &manifest)?;
    println!(
        "Recipe package written to {}. Open index.html for your steps; nothing was sent.",
        folder.display()
    );
    Ok(())
}

/// Writes the package into a new folder. An existing path is refused.
fn write_package(
    folder: &Path,
    package: &Package,
    manifest: &serde_json::Value,
) -> Result<PathBuf, String> {
    match fs::symlink_metadata(folder) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => {
            return Err(format!(
                "refusing to write a package into existing {}; choose a new folder",
                folder.display()
            ))
        }
        Err(error) => return Err(format!("cannot inspect {}: {error}", folder.display())),
    }
    fs::create_dir_all(folder)
        .map_err(|error| format!("cannot create {}: {error}", folder.display()))?;
    let put = |name: &str, bytes: &[u8]| {
        fsutil::create_new_file(&folder.join(name), bytes)
            .map_err(|cause| format!("cannot write {name} in {}: {cause}", folder.display()))
    };
    for file in &package.files {
        put(&file.name, &file.contents)?;
    }
    let mut manifest_text = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("cannot serialize the package plan: {error}"))?;
    manifest_text.push('\n');
    put("package.json", manifest_text.as_bytes())?;
    put(
        "index.html",
        recipe_directory::guide_page(package).as_bytes(),
    )?;
    Ok(folder.to_path_buf())
}

#[cfg(test)]
#[path = "recipe_package_tests.rs"]
mod tests;

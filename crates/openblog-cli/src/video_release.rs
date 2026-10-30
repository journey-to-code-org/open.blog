//! `openblog video <slug>`: the YouTube-ready preview of a video post (epic #386, ADR 0842).
//!
//! Reads the post, its release fields and the files they name, and prints or writes what the
//! author would enter in YouTube Studio. It sends nothing, reads no credential and writes only into
//! a new preview folder the author names.

use std::fs;
use std::path::{Path, PathBuf};

use openblog_core::distribution::Status;
use openblog_core::portability::PortableProjection;
use openblog_core::video_release::{self, PreviewSource, VideoPreview, VideoRelease};

use crate::{fsutil, site, url_context};

pub struct Options {
    pub json: bool,
    /// A new folder to write the preview into: `preview.json`, the text files and `index.html`.
    pub preview: Option<String>,
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    if options.json && options.preview.is_some() {
        return Err("--json and --preview each run alone; nothing was written".into());
    }
    // A release is prepared before the article goes live, so drafts and scheduled posts count.
    let (loaded, _) = site::load_site(root, true, None)?;
    let post = loaded
        .posts
        .iter()
        .find(|post| post.slug == slug)
        .ok_or_else(|| format!("no post has slug `{slug}`"))?;
    let release = VideoRelease::from_post(post).ok_or_else(|| {
        format!("post `{slug}` does not use the video profile; a video release is prepared only from a post with `profile: video`")
    })?;
    let canonical_url = PortableProjection::for_site(&loaded, post)?
        .canonical_url()
        .to_string();
    let article_public = public_address(&canonical_url) && live(root, slug)?;
    let preview = video_release::youtube_preview(
        &release,
        PreviewSource {
            slug,
            source_path: &post.source,
            canonical_url: &canonical_url,
            article_public,
        },
    );
    if options.json {
        let text = serde_json::to_string_pretty(&preview.to_json_value())
            .map_err(|error| format!("could not serialize the preview: {error}"))?;
        println!("{text}");
        return Ok(());
    }
    if let Some(directory) = &options.preview {
        let thumbnail = thumbnail_source(root, &loaded.config.paths.static_dir, &release);
        let written = write_preview(root, directory, &preview, thumbnail.as_deref())?;
        println!(
            "YouTube preview of `{slug}` written to {} ({}). Nothing was uploaded.",
            written.display(),
            preview.status.as_str()
        );
        return Ok(());
    }
    print_summary(&preview);
    Ok(())
}

/// Whether the canonical address is one a viewer can reach: public and `https`, and not the
/// example host a new site starts with.
fn public_address(canonical_url: &str) -> bool {
    url_context::validate_public_url(canonical_url).is_ok_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| host != "example.com" && !host.ends_with(".example.com"))
    })
}

/// Whether the post is production-visible now: published and not scheduled for later.
fn live(root: &Path, slug: &str) -> Result<bool, String> {
    let (published, _) = site::load_site(root, false, Some(crate::clock::now()))?;
    Ok(published.posts.iter().any(|post| post.slug == slug))
}

/// The file a site-relative thumbnail is served from (`/images/a.png` is `static/images/a.png`).
/// An absolute address or a path outside the static folder has none.
fn thumbnail_source(root: &Path, static_dir: &str, release: &VideoRelease) -> Option<PathBuf> {
    let path = release.thumbnail.as_deref()?.strip_prefix('/')?;
    let relative = Path::new(path);
    if path.starts_with('/')
        || relative
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return None;
    }
    let file = root.join(static_dir).join(relative);
    fs::symlink_metadata(&file)
        .ok()
        .filter(|meta| meta.is_file())
        .map(|_| file)
}

fn print_summary(preview: &VideoPreview) {
    println!(
        "YouTube preview of `{}` (nothing is uploaded)",
        preview.slug
    );
    println!("  status: {}", preview.status.as_str());
    println!("  canonical article: {}", preview.canonical_url);
    println!("  title: {}", preview.title);
    println!(
        "  description: {} of {} bytes",
        preview.description.len(),
        video_release::YOUTUBE_DESCRIPTION_MAX_BYTES
    );
    println!("  chapters: {}", preview.chapters.len());
    println!("  captions: {}", preview.captions.len());
    println!(
        "  transcript: {}",
        if preview.transcript.is_some() {
            "yes"
        } else {
            "no"
        }
    );
    for (heading, items) in [
        ("blocked", &preview.problems),
        ("by hand", &preview.manual),
        ("note", &preview.notes),
    ] {
        for item in items {
            println!("  {heading}: {} ({})", item.message, item.code);
        }
    }
    if preview.status != Status::Blocked {
        println!(
            "Write the preview with `openblog video {} --preview <new folder>`.",
            preview.slug
        );
    }
}

/// Writes the preview into a new folder: `preview.json`, `title.txt`, `description.txt`,
/// `tags.txt`, `transcript.txt` when there is one, a copy of the thumbnail, and `index.html`.
fn write_preview(
    root: &Path,
    directory: &str,
    preview: &VideoPreview,
    thumbnail: Option<&Path>,
) -> Result<PathBuf, String> {
    let directory = crate::portable_export::output_path(root, directory).map_err(|_| {
        "the preview folder must be a path without `..` or symlinks; nothing was written"
            .to_string()
    })?;
    match fs::symlink_metadata(&directory) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => {
            return Err(format!(
                "refusing to write a preview into existing {}; choose a new folder",
                directory.display()
            ))
        }
        Err(error) => return Err(format!("cannot inspect {}: {error}", directory.display())),
    }
    fs::create_dir_all(&directory)
        .map_err(|error| format!("cannot create {}: {error}", directory.display()))?;
    let write = |name: &str, bytes: &[u8]| {
        fsutil::create_new_file(&directory.join(name), bytes)
            .map_err(|cause| format!("cannot write {name} in {}: {cause}", directory.display()))
    };
    write("title.txt", format!("{}\n", preview.title).as_bytes())?;
    write(
        "description.txt",
        format!("{}\n", preview.description).as_bytes(),
    )?;
    write(
        "tags.txt",
        format!("{}\n", preview.tags.join(", ")).as_bytes(),
    )?;
    if let Some(transcript) = &preview.transcript {
        write("transcript.txt", format!("{transcript}\n").as_bytes())?;
    }
    // The copy is named by its own extension only, never by the author's file name.
    let copied = match thumbnail {
        Some(source) => {
            let extension = source
                .extension()
                .and_then(|e| e.to_str())
                .map(str::to_ascii_lowercase)
                .filter(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png"));
            match extension {
                Some(extension) => {
                    let name = format!("thumbnail.{extension}");
                    let bytes = fs::read(source)
                        .map_err(|error| format!("cannot read the thumbnail: {error}"))?;
                    write(&name, &bytes)?;
                    Some(name)
                }
                None => None,
            }
        }
        None => None,
    };
    let mut json = preview.to_json_value();
    if let Some(name) = &copied {
        json["thumbnailFile"] = serde_json::Value::String(name.clone());
    }
    let json = serde_json::to_string_pretty(&json)
        .map_err(|error| format!("could not serialize the preview: {error}"))?;
    write("preview.json", json.as_bytes())?;
    write(
        "index.html",
        video_release::preview_page(preview, copied.as_deref()).as_bytes(),
    )?;
    Ok(directory)
}

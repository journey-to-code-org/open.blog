//! `openblog video <slug>`: the YouTube-ready preview of a video post (epic #386, ADRs 0376, 0377),
//! and its approval and upload (story #400, ADRs 0378 to 0380, in [`crate::youtube`]).
//!
//! Reads the post, its release fields and the files they name, and prints or writes what the
//! author would enter in YouTube Studio. The preview sends nothing, reads no credential and writes
//! only into a new preview folder the author names. A file is read only at a clean path inside the
//! project with no symlink on the way. Caption files are read in full to bind their bytes to the
//! preview; approval and upload also read the master file in full.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use blake2::{Blake2b512, Digest};
use openblog_core::distribution::Status;
use openblog_core::video_release::{
    self, AssetFacts, AssetRef, PreviewSource, PublicFolders, VideoPreview, VideoRelease,
};

use crate::{fsutil, site, url_context};

pub struct Options {
    pub json: bool,
    /// A new folder to write the preview into: `preview.json`, the text files and `index.html`.
    pub preview: Option<String>,
    /// Approve exactly the preview with this digest for upload (sends nothing).
    pub approve: Option<String>,
    /// With `--approve`: when YouTube makes the private upload public.
    pub publish_at: Option<String>,
    /// Upload the approved release, or resume its upload.
    pub upload: bool,
    /// Look in the channel's uploads after an upload whose outcome is unknown.
    pub lookup: bool,
    /// Settle an unknown upload by hand: `uploaded:<video id>` or `not-uploaded`.
    pub settle: Option<String>,
    /// Print the release's private upload record.
    pub status: bool,
}

/// Everything an approval or an upload needs about one release, read once.
pub(crate) struct Prepared {
    pub slug: String,
    pub preview: VideoPreview,
    pub post_date: openblog_core::DateTime,
    pub draft: bool,
    /// Whether the canonical address is a public `https` one a viewer can reach.
    pub public_canonical: bool,
    /// The master file, when the release names one that exists at a clean path.
    pub video: Option<PathBuf>,
    /// The thumbnail in the static folder, when it is a local JPEG or PNG.
    pub thumbnail: Option<PathBuf>,
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    let actions = [
        options.json,
        options.preview.is_some(),
        options.approve.is_some(),
        options.upload,
        options.lookup,
        options.settle.is_some(),
        options.status,
    ]
    .iter()
    .filter(|on| **on)
    .count();
    let json_status = options.json && options.status;
    if actions > 1 && !json_status {
        return Err("--json, --preview, --approve, --upload, --lookup, --settle and --status each run alone (--status may add --json); nothing was written or sent".into());
    }
    if options.publish_at.is_some() && options.approve.is_none() {
        return Err("--publish-at is given with --approve, which records it with the approval; nothing was written or sent".into());
    }
    if options.status {
        return crate::youtube::print_status(root, slug, options.json);
    }
    if let Some(settlement) = &options.settle {
        return crate::youtube::settle(root, slug, settlement);
    }
    let prepared = prepare(root, slug)?;
    if let Some(digest) = &options.approve {
        return crate::youtube::approve(root, &prepared, digest, options.publish_at.as_deref());
    }
    if options.upload {
        return crate::youtube::upload(root, &prepared);
    }
    if options.lookup {
        return crate::youtube::lookup(root, &prepared);
    }
    let preview = &prepared.preview;
    if options.json {
        let text = serde_json::to_string_pretty(&preview.to_json_value())
            .map_err(|error| format!("could not serialize the preview: {error}"))?;
        println!("{text}");
        return Ok(());
    }
    if let Some(directory) = &options.preview {
        let written = write_preview(root, directory, preview, prepared.thumbnail.as_deref())?;
        println!(
            "YouTube preview of `{slug}` written to {} ({}). Nothing was uploaded.",
            written.display(),
            preview.status.as_str()
        );
        return Ok(());
    }
    print_summary(preview);
    Ok(())
}

/// Reads the post, its release and the files it names, and builds the preview.
pub(crate) fn prepare(root: &Path, slug: &str) -> Result<Prepared, String> {
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
    // The post's own page, as its portable projection names it; a draft has no projection yet,
    // but its page will be at the same address.
    let canonical_url = loaded.config.absolute(&post.url);
    let article_public = public_address(&canonical_url) && live(root, slug)?;
    let paths = &loaded.config.paths;
    let probe = |asset: &AssetRef<'_>| probe(root, &paths.static_dir, asset);
    let mut preview = video_release::youtube_preview(
        &release,
        PreviewSource {
            slug,
            source_path: &post.source,
            canonical_url: &canonical_url,
            article_public,
            folders: PublicFolders {
                static_dir: &paths.static_dir,
                output_dir: &paths.output,
            },
        },
        &probe,
    );
    if preview.status != Status::Blocked {
        bind_caption_files(root, &paths.static_dir, &mut preview)?;
    }
    let thumbnail = release
        .thumbnail
        .as_deref()
        .and_then(|url| url.strip_prefix('/'))
        .and_then(video_release::project_path)
        .and_then(|path| resolve(root, &paths.static_dir, &AssetRef::Static(path)));
    let video = release
        .reference
        .file
        .as_deref()
        .and_then(video_release::project_path)
        .and_then(|path| resolve(root, &paths.static_dir, &AssetRef::Project(path)));
    Ok(Prepared {
        slug: slug.to_string(),
        public_canonical: public_address(&canonical_url),
        preview,
        post_date: post.date,
        draft: post.draft,
        video,
        thumbnail,
    })
}

/// Bind the preview to the actual caption bytes, not just their paths.
fn bind_caption_files(
    root: &Path,
    static_dir: &str,
    preview: &mut VideoPreview,
) -> Result<(), String> {
    if preview.captions.is_empty() {
        return Ok(());
    }
    let mut combined = Blake2b512::new();
    combined.update(b"openblog-video-caption-preview-v1\0");
    combined.update(preview.digest.as_bytes());
    for caption in &mut preview.captions {
        let path = video_release::project_path(&caption.path)
            .and_then(|path| resolve(root, static_dir, &AssetRef::Project(path)))
            .ok_or_else(|| {
                format!(
                    "[caption-unreadable] Cannot read caption file `{}`; preview again. Nothing was sent.",
                    caption.path
                )
            })?;
        let unreadable = || {
            format!(
                "[caption-unreadable] Cannot read caption file `{}`; preview again. Nothing was sent.",
                caption.path
            )
        };
        let mut file = fs::File::open(path).map_err(|_| unreadable())?;
        let mut hash = Blake2b512::new();
        let mut bytes = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer).map_err(|_| unreadable())?;
            if count == 0 {
                break;
            }
            bytes += count as u64;
            if bytes > video_release::YOUTUBE_CAPTION_MAX_BYTES {
                return Err(format!(
                    "[caption-too-large] Caption file `{}` exceeds YouTube's limit. Nothing was sent.",
                    caption.path
                ));
            }
            hash.update(&buffer[..count]);
        }
        let digest = hash.finalize();
        combined.update(bytes.to_be_bytes());
        combined.update(digest);
        caption.content_digest = Some(digest.iter().map(|byte| format!("{byte:02x}")).collect());
        caption.content_bytes = Some(bytes);
    }
    preview.digest = combined
        .finalize()
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect();
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

/// The regular file an asset names, or `None` when anything on the way from the project root is
/// a symlink, or the end is not a regular file. Core has already refused any path with `..`.
fn resolve(root: &Path, static_dir: &str, asset: &AssetRef<'_>) -> Option<PathBuf> {
    let (base, path) = match asset {
        AssetRef::Project(path) => (String::new(), *path),
        AssetRef::Static(path) => (format!("{}/", static_dir.trim_matches('/')), *path),
    };
    let relative = format!("{base}{path}");
    let mut current = root.to_path_buf();
    for part in relative.split('/') {
        if matches!(part, "" | "." | "..") {
            return None;
        }
        current.push(part);
        let meta = fs::symlink_metadata(&current).ok()?;
        if meta.file_type().is_symlink() {
            return None;
        }
    }
    fs::symlink_metadata(&current)
        .ok()
        .filter(|meta| meta.is_file())
        .map(|_| current)
}

/// The size and first bytes of an asset, for core to check.
fn probe(root: &Path, static_dir: &str, asset: &AssetRef<'_>) -> AssetFacts {
    let Some(path) = resolve(root, static_dir, asset) else {
        return AssetFacts::Missing;
    };
    let read = || -> std::io::Result<AssetFacts> {
        let file = fs::File::open(&path)?;
        let bytes = file.metadata()?.len();
        let mut head = Vec::new();
        file.take(video_release::HEAD_BYTES as u64)
            .read_to_end(&mut head)?;
        Ok(AssetFacts::File { bytes, head })
    };
    read().unwrap_or(AssetFacts::Missing)
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
        if preview.reference.file.is_some() {
            println!(
                "To upload it privately with open.blog, approve exactly this preview: `openblog video {} --approve {}`.",
                preview.slug, preview.digest
            );
        }
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
    // The copy is named by the image kind it is, never by the author's file name.
    let copied = match thumbnail {
        // A thumbnail YouTube would refuse for its size is not copied either.
        Some(source)
            if fs::metadata(source)
                .is_ok_and(|meta| meta.len() <= video_release::YOUTUBE_THUMBNAIL_MAX_BYTES) =>
        {
            let bytes =
                fs::read(source).map_err(|error| format!("cannot read the thumbnail: {error}"))?;
            match video_release::image_size(&bytes) {
                Some((kind, _, _)) => {
                    let name = format!("thumbnail.{}", if kind == "png" { "png" } else { "jpg" });
                    write(&name, &bytes)?;
                    Some(name)
                }
                None => None,
            }
        }
        _ => None,
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

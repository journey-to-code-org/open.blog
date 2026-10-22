//! Reading a project from disk and writing the built site back out.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use openblog_core::theme::{ThemeFile, ThemeSet};
use openblog_core::{generate, DateTime, LoadOptions, Site, SiteConfig, SourceFile, Sources};

use crate::fsutil;

pub const CONFIG_FILE: &str = "openblog.json";

/// Front-end files compiled into the binary so `openblog init` works in an
/// empty folder. A copy on disk under `web/` always wins, so they stay editable.
pub const EMBEDDED_WEB: &[(&str, &str)] = &[
    ("base.css", include_str!("../../../web/base.css")),
    ("openblog.js", include_str!("../../../web/openblog.js")),
    (
        "components/ob-theme-toggle.js",
        include_str!("../../../web/components/ob-theme-toggle.js"),
    ),
    (
        "components/ob-code.js",
        include_str!("../../../web/components/ob-code.js"),
    ),
    (
        "components/ob-back-to-top.js",
        include_str!("../../../web/components/ob-back-to-top.js"),
    ),
    (
        "components/ob-search.js",
        include_str!("../../../web/components/ob-search.js"),
    ),
    (
        "components/ob-share.js",
        include_str!("../../../web/components/ob-share.js"),
    ),
    (
        "components/ob-views.js",
        include_str!("../../../web/components/ob-views.js"),
    ),
];

/// The admin editor. Served only by `serve --admin`, never copied into the
/// public site. A copy under `web/admin/` overrides the embedded one.
pub const EMBEDDED_ADMIN: &[(&str, &str)] = &[
    ("index.html", include_str!("../../../web/admin/index.html")),
    ("admin.js", include_str!("../../../web/admin/admin.js")),
    ("admin.css", include_str!("../../../web/admin/admin.css")),
];

pub const EMBEDDED_BASE_THEME: &str = include_str!("../../../themes/base/theme.json");

/// The search engine compiled to WebAssembly, so a blog created with
/// `openblog init` gets search without a Rust workspace or wasm-pack.
/// Rebuild with `openblog build-wasm` in the engine repository after changing
/// openblog-core, and commit the result.
pub const EMBEDDED_WEB_BINARY: &[(&str, &[u8])] = &[
    (
        "wasm/openblog_wasm.js",
        include_bytes!("../../../web/wasm/openblog_wasm.js"),
    ),
    (
        "wasm/openblog_wasm_bg.wasm",
        include_bytes!("../../../web/wasm/openblog_wasm_bg.wasm"),
    ),
];

/// Example themes written by `openblog init`, so the docs' examples exist in
/// every new blog.
pub const EMBEDDED_THEMES: &[(&str, &str)] = &[
    (
        "demo/theme.json",
        include_str!("../../../themes/demo/theme.json"),
    ),
    (
        "demo/reveal.js",
        include_str!("../../../themes/demo/reveal.js"),
    ),
    (
        "demo/theme.css",
        include_str!("../../../themes/demo/theme.css"),
    ),
    (
        "paper/theme.json",
        include_str!("../../../themes/paper/theme.json"),
    ),
];

/// A GitHub Pages workflow for a blog in its own repository.
pub const PAGES_WORKFLOW: &str = include_str!("../templates/pages.yml");

pub struct BuildOptions {
    /// Include drafts and scheduled posts (a preview build).
    pub include_drafts: bool,
    pub out_override: Option<PathBuf>,
    /// The current time; posts dated later are held back as scheduled.
    pub now: Option<DateTime>,
}

pub struct BuildReport {
    pub posts: usize,
    pub series: usize,
    pub tags: usize,
    pub pages: usize,
    pub files: usize,
    pub scheduled: usize,
    /// When the next scheduled post goes live.
    pub next_due: Option<DateTime>,
    pub out_dir: PathBuf,
    pub warnings: Vec<String>,
}

pub fn load_config(root: &Path) -> Result<SiteConfig, String> {
    let path = root.join(CONFIG_FILE);
    let json = fs::read_to_string(&path).map_err(|e| {
        format!(
            "cannot read {} ({e}). Run `openblog init` to create a project, or `--root <dir>` to point at one.",
            path.display()
        )
    })?;
    SiteConfig::from_json(&json)
}

pub fn read_sources(root: &Path, config: &SiteConfig) -> Result<Sources, String> {
    let content_dir = root.join(&config.paths.content);
    let mut sources = Sources::default();
    for path in fsutil::walk(&content_dir) {
        let rel = fsutil::relative(&content_dir, &path);
        let lower = rel.to_ascii_lowercase();
        // A README anywhere, and any file or folder whose name starts with `_`, is not content.
        if lower == "readme.md"
            || lower.ends_with("/readme.md")
            || rel.split('/').any(|part| part.starts_with('_'))
        {
            continue;
        }
        if openblog_core::classify_source(&rel).is_none() {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        let contents = String::from_utf8(bytes).map_err(|_| format!("{rel} is not valid UTF-8"))?;
        sources.add(SourceFile {
            path: rel,
            contents,
        });
    }
    Ok(sources)
}

pub fn load_themes(root: &Path, config: &SiteConfig) -> Result<ThemeSet, String> {
    let themes_dir = root.join(&config.paths.themes);
    let mut set = ThemeSet::new();
    let Ok(entries) = fs::read_dir(&themes_dir) else {
        return Ok(set);
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    for dir in dirs {
        let name = dir
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let file = dir.join("theme.json");
        if !file.exists() {
            continue;
        }
        let json = fs::read_to_string(&file)
            .map_err(|e| format!("cannot read {}: {e}", file.display()))?;
        let theme = ThemeFile::from_json(&json).map_err(|e| format!("{}: {e}", file.display()))?;
        set.insert(&name, theme);
    }
    Ok(set)
}

/// When a CDN is configured without an explicit version, derive one from the
/// asset files so a changed stylesheet, script, font, or image gets a new URL
/// and old cached copies are never served.
pub fn with_asset_version(root: &Path, mut config: SiteConfig) -> SiteConfig {
    if !config.cdn.enabled() || !config.cdn.version.trim().is_empty() {
        return config;
    }
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |bytes: &[u8]| {
        for b in bytes {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    };
    for dir in [
        &config.paths.web,
        &config.paths.themes,
        &config.paths.static_dir,
    ] {
        let base = root.join(dir);
        for file in fsutil::walk(&base) {
            mix(fsutil::relative(&base, &file).as_bytes());
            // Text assets by content; everything else (images, fonts) by size, which is
            // cheap and changes whenever the file is replaced.
            let is_text = file
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| matches!(e, "css" | "js" | "mjs" | "json"));
            if is_text {
                if let Ok(bytes) = fs::read(&file) {
                    mix(&bytes);
                }
            } else if let Ok(meta) = fs::metadata(&file) {
                mix(&meta.len().to_le_bytes());
            }
        }
    }
    for (_, embedded) in EMBEDDED_WEB {
        mix(embedded.as_bytes());
    }
    config.cdn.version = format!("{:08x}", (h >> 32) as u32 ^ h as u32);
    config
}

pub fn load_site(
    root: &Path,
    include_drafts: bool,
    now: Option<DateTime>,
) -> Result<(Site, ThemeSet), String> {
    let config = with_asset_version(root, load_config(root)?);
    let sources = read_sources(root, &config)?;
    let themes = load_themes(root, &config)?;
    let site = Site::load(
        config,
        sources,
        LoadOptions {
            include_drafts,
            now,
        },
    )
    .map_err(|errors| {
        format!(
            "{} problem(s) in your content:\n  - {}",
            errors.len(),
            errors.join("\n  - ")
        )
    })?;
    Ok((site, themes))
}

/// An admin UI file: from `web/admin/` if present, else the embedded copy.
pub fn admin_file(root: &Path, config: &SiteConfig, rel: &str) -> Option<Vec<u8>> {
    if let Ok(bytes) = fs::read(root.join(&config.paths.web).join("admin").join(rel)) {
        return Some(bytes);
    }
    EMBEDDED_ADMIN
        .iter()
        .find(|(p, _)| *p == rel)
        .map(|(_, c)| c.as_bytes().to_vec())
}

fn web_file(root: &Path, config: &SiteConfig, rel: &str) -> Option<Vec<u8>> {
    let on_disk = root.join(&config.paths.web).join(rel);
    if let Ok(bytes) = fs::read(&on_disk) {
        return Some(bytes);
    }
    if let Some((_, c)) = EMBEDDED_WEB.iter().find(|(p, _)| *p == rel) {
        return Some(c.as_bytes().to_vec());
    }
    EMBEDDED_WEB_BINARY
        .iter()
        .find(|(p, _)| *p == rel)
        .map(|(_, c)| c.to_vec())
}

pub fn build(root: &Path, options: &BuildOptions) -> Result<BuildReport, String> {
    let (site, themes) = load_site(root, options.include_drafts, options.now)?;
    let config = &site.config;
    let out_dir = options
        .out_override
        .clone()
        .unwrap_or_else(|| root.join(&config.paths.output));
    fsutil::guard_output_dir(root, &out_dir)?;
    // Claim the directory first, so a build that fails midway never leaves an
    // unmarked folder that every later build would refuse to touch.
    fsutil::write_file(
        &out_dir.join(fsutil::MARKER),
        b"Generated by open.blog. Safe to delete.\n",
    )?;

    let mut written: HashSet<String> = HashSet::new();
    let mut put = |rel: String, bytes: &[u8]| -> Result<(), String> {
        fsutil::write_file(&out_dir.join(&rel), bytes)?;
        written.insert(rel);
        Ok(())
    };

    // 1. Static files (images, favicon, CNAME, ...) at the site root.
    let static_dir = root.join(&config.paths.static_dir);
    for file in fsutil::walk(&static_dir) {
        let rel = fsutil::relative(&static_dir, &file);
        let bytes = fs::read(&file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
        put(rel, &bytes)?;
    }

    // 2. Front-end assets: base.css, the web components, and the WebAssembly build.
    let mut asset_names: Vec<String> = EMBEDDED_WEB
        .iter()
        .map(|(p, _)| p.to_string())
        .chain(EMBEDDED_WEB_BINARY.iter().map(|(p, _)| p.to_string()))
        .collect();
    let web_dir = root.join(&config.paths.web);
    for file in fsutil::walk(&web_dir) {
        let rel = fsutil::relative(&web_dir, &file);
        if rel.starts_with("admin/") {
            continue;
        }
        let is_asset = rel.ends_with(".css") || rel.ends_with(".js") || rel.ends_with(".mjs");
        let is_wasm = rel.starts_with("wasm/") && (rel.ends_with(".js") || rel.ends_with(".wasm"));
        if (is_asset || is_wasm) && !asset_names.contains(&rel) {
            asset_names.push(rel);
        }
    }
    for rel in asset_names {
        if let Some(bytes) = web_file(root, config, &rel) {
            put(format!("assets/{rel}"), &bytes)?;
        }
    }

    // 3. Theme directories (fonts, images, theme.css). Generated tokens come next and win.
    let themes_dir = root.join(&config.paths.themes);
    for file in fsutil::walk(&themes_dir) {
        let rel = fsutil::relative(&themes_dir, &file);
        let bytes = fs::read(&file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
        put(format!("themes/{rel}"), &bytes)?;
    }

    // 4. Generated pages, feeds, and tokens.
    let files = generate(&site, &themes)?;
    let count = files.len();
    for f in files {
        put(f.path, f.contents.as_bytes())?;
    }

    fsutil::remove_stale(&out_dir, &written);

    Ok(BuildReport {
        posts: site.posts.len(),
        series: site.series.len(),
        tags: site.tags.len(),
        pages: site.pages.len(),
        files: count,
        scheduled: site.scheduled.len(),
        next_due: site.next_scheduled(),
        out_dir,
        warnings: site.warnings.clone(),
    })
}

/// Paths whose changes should trigger a rebuild while serving.
pub fn watched_paths(root: &Path, config: &SiteConfig) -> Vec<PathBuf> {
    vec![
        root.join(CONFIG_FILE),
        root.join(&config.paths.content),
        root.join(&config.paths.static_dir),
        root.join(&config.paths.themes),
        root.join(&config.paths.web),
    ]
}

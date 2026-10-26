//! Reading a project from disk and writing the built site back out.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use openblog_core::accessibility::AccessibilityFinding;
use openblog_core::research::EvidenceFinding;
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
        "components/ob-rust-playground.js",
        include_str!("../../../web/components/ob-rust-playground.js"),
    ),
    (
        "components/ob-rust-runner.js",
        include_str!("../../../web/components/ob-rust-runner.js"),
    ),
    (
        "components/ob-code-editor.js",
        include_str!("../../../web/components/ob-code-editor.js"),
    ),
    (
        "components/ob-code-runner.js",
        include_str!("../../../web/components/ob-code-runner.js"),
    ),
    (
        "components/ob-code-runner-client.js",
        include_str!("../../../web/components/ob-code-runner-client.js"),
    ),
    (
        "components/ob-code-runner-language.js",
        include_str!("../../../web/components/ob-code-runner-language.js"),
    ),
    (
        "components/ob-web-sandbox.js",
        include_str!("../../../web/components/ob-web-sandbox.js"),
    ),
    (
        "components/ob-highlight.js",
        include_str!("../../../web/components/ob-highlight.js"),
    ),
    (
        "components/ob-recipe.js",
        include_str!("../../../web/components/ob-recipe.js"),
    ),
    (
        "components/ob-quiz.js",
        include_str!("../../../web/components/ob-quiz.js"),
    ),
    (
        "components/ob-quantity.js",
        include_str!("../../../web/components/ob-quantity.js"),
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
    (
        "components/ob-comments.js",
        include_str!("../../../web/components/ob-comments.js"),
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
    // Official, unmodified ORCID unauthenticated icon colorways. The public
    // component crops the green first panel at display time.
    // Source: https://info.orcid.org/wp-content/uploads/2024/11/orcid-unauthenticated-id-icon.png
    (
        "orcid-unauthenticated-id-icons.png",
        include_bytes!("../../../web/orcid-unauthenticated-id-icons.png"),
    ),
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

/// A view counter for Cloudflare Workers, written by `openblog analytics worker`.
pub const COUNTER_WORKER: &str = include_str!("../templates/counter-worker.js");
pub const COUNTER_WRANGLER: &str = include_str!("../templates/wrangler.toml");

/// A view counter as a Node + MongoDB web service (Render blueprint included),
/// written by `openblog analytics service`.
pub const COUNTER_SERVICE: &[(&str, &str)] = &[
    (
        "server.js",
        include_str!("../templates/counter-service/server.js"),
    ),
    (
        "package.json",
        include_str!("../templates/counter-service/package.json"),
    ),
    (
        "render.yaml",
        include_str!("../templates/counter-service/render.yaml"),
    ),
    // keep-awake.yml goes into the blog's own .github/workflows/, see KEEP_AWAKE_WORKFLOW.
    (
        "README.md",
        include_str!("../templates/counter-service/README.md"),
    ),
];

/// A workflow that pings the counter so a free Render service never sleeps.
pub const KEEP_AWAKE_WORKFLOW: &str = include_str!("../templates/counter-service/keep-awake.yml");

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
    pub accessibility: Vec<AccessibilityFinding>,
    pub evidence: Vec<EvidenceFinding>,
}

pub fn load_config(root: &Path) -> Result<SiteConfig, String> {
    let path = root.join(CONFIG_FILE);
    let json = fs::read_to_string(&path).map_err(|e| {
        format!(
            "cannot read {} ({e}). Run `openblog init` to create a project, or `--root <dir>` to point at one.",
            path.display()
        )
    })?;
    let mut config = SiteConfig::from_json(&json)?;
    // Containers and PaaS hosts always sit behind an HTTPS proxy whose address
    // is not known in advance; one variable sets both proxy-related options.
    if std::env::var("OPENBLOG_BEHIND_PROXY")
        .map(|v| matches!(v.trim(), "1" | "true" | "yes"))
        .unwrap_or(false)
    {
        config.admin.secure_cookies = true;
        config.admin.trusted_proxies = vec!["*".to_string()];
    }
    Ok(config)
}

pub fn read_sources(root: &Path, config: &SiteConfig) -> Result<Sources, String> {
    read_sources_excluding(root, config, None)
}

/// Read content while optionally replacing one source in memory. Admin uses
/// this to validate a repair for a malformed credit sidecar without first
/// having to parse the broken file from disk.
pub fn read_sources_excluding(
    root: &Path,
    config: &SiteConfig,
    excluded: Option<&str>,
) -> Result<Sources, String> {
    let content_dir = root.join(&config.paths.content);
    let mut sources = Sources::default();
    for path in content_files(&content_dir)? {
        let rel = fsutil::relative(&content_dir, &path);
        if excluded.is_some_and(|excluded| excluded == rel) {
            continue;
        }
        let lower = rel.to_ascii_lowercase();
        // A README anywhere, and any file or folder whose name starts with `_`, is not content.
        if lower == "readme.md"
            || lower.ends_with("/readme.md")
            || rel.split('/').any(|part| part.starts_with('_'))
        {
            continue;
        }
        let Some(source_kind) = openblog_core::classify_source(&rel) else {
            continue;
        };
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
        let contents = match String::from_utf8(bytes) {
            Ok(contents) => contents,
            Err(_) if source_kind == openblog_core::SourceKind::PostCredits => {
                // Preserve the sidecar in the source index so callers can
                // report a document-scoped credit error instead of losing the
                // entire listing. The Admin GET path reads the original bytes
                // separately and reports the precise UTF-8 failure.
                "<invalid UTF-8 credit sidecar>".into()
            }
            Err(_) => return Err(format!("{rel} is not valid UTF-8")),
        };
        sources.add(SourceFile {
            path: rel,
            contents,
        });
    }
    // A deferred read: the load reads the library only when an opted-in post
    // cites something; see `Site::load`.
    sources.source_library = Some(crate::source_store::read_for_build(root));
    Ok(sources)
}

/// Walk content deterministically without descending through an unchecked
/// directory symlink. Canonical directories are remembered so symlink cycles
/// fail instead of recursing forever.
fn content_files(content_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let canonical_content = match fs::canonicalize(content_dir) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!("cannot resolve {}: {error}", content_dir.display()));
        }
    };
    let mut files = Vec::new();
    let mut visited = HashSet::new();
    visit_content_dir(content_dir, &canonical_content, &mut visited, &mut files)?;
    files.sort();
    Ok(files)
}

fn visit_content_dir(
    directory: &Path,
    canonical_content: &Path,
    visited: &mut HashSet<PathBuf>,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let canonical_directory = fs::canonicalize(directory)
        .map_err(|error| format!("cannot resolve {}: {error}", directory.display()))?;
    if !canonical_directory.starts_with(canonical_content) {
        return Err(format!(
            "{} resolves outside the content directory",
            directory.display()
        ));
    }
    if !visited.insert(canonical_directory) {
        return Err(format!(
            "{} creates a directory symlink cycle",
            directory.display()
        ));
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("cannot read {}: {error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("cannot read {}: {error}", directory.display()))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let canonical = fs::canonicalize(&path)
            .map_err(|error| format!("cannot resolve {}: {error}", path.display()))?;
        if !canonical.starts_with(canonical_content) {
            return Err(format!(
                "{} resolves outside the content directory",
                path.display()
            ));
        }
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
        if metadata.is_dir() {
            visit_content_dir(&path, canonical_content, visited, files)?;
        } else if metadata.is_file() {
            files.push(path);
        }
    }
    Ok(())
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
    // Always version asset URLs, CDN or not: a changed file gets a new URL, so
    // browsers and caches may keep assets without ever serving a stale one.
    if !config.cdn.version.trim().is_empty() {
        return config;
    }
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |bytes: &[u8]| {
        for b in bytes {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    };
    // Private project state never feeds the public version, or a private edit
    // would change every public asset URL.
    let private = fsutil::PrivateState::of(root);
    for dir in [
        &config.paths.web,
        &config.paths.themes,
        &config.paths.static_dir,
    ] {
        let base = root.join(dir);
        for file in fsutil::walk(&base) {
            if private.contains(&file) {
                continue;
            }
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

/// View totals known at build time: the local analytics store if present,
/// otherwise the copy on the analytics branch (what a CI build sees).
pub fn view_counts(root: &Path, config: &SiteConfig) -> std::collections::BTreeMap<String, u64> {
    if !config.analytics.bake_counts {
        return Default::default();
    }
    let local = root.join(".openblog").join("analytics.json");
    if local.exists() {
        return crate::analytics::Store::load(&local, config.analytics.retention_days).all_totals();
    }
    let branch = config.analytics.branch.trim();
    if branch.is_empty() {
        return Default::default();
    }
    let git = crate::git::Git::new(root);
    let from_branch = git
        .read_file(branch, "analytics.json")
        .or_else(|| git.read_file(&format!("origin/{branch}"), "analytics.json"));
    match from_branch {
        Some(json) => {
            let mut store = crate::analytics::Store::load(
                Path::new("/nonexistent"),
                config.analytics.retention_days,
            );
            if store.restore_from_json(&json).is_ok() {
                return store.all_totals();
            }
            Default::default()
        }
        None => Default::default(),
    }
}

pub fn load_site(
    root: &Path,
    include_drafts: bool,
    now: Option<DateTime>,
) -> Result<(Site, ThemeSet), String> {
    let config = load_config(root)?;
    let sources = read_sources(root, &config)?;
    load_site_from_sources(
        root,
        config,
        sources,
        LoadOptions {
            include_drafts,
            now,
            preview_source: None,
        },
    )
}

/// Load a production-faithful site after a caller has substituted in-memory
/// sources, as the admin preview does for an unsaved document.
pub fn load_site_from_sources(
    root: &Path,
    config: SiteConfig,
    sources: Sources,
    options: LoadOptions,
) -> Result<(Site, ThemeSet), String> {
    load_site_from_sources_listing(root, config, sources, options)
        .map_err(|errors| content_problems(&errors))
}

/// The problems of a failed site load as one message.
pub fn content_problems(errors: &[String]) -> String {
    format!(
        "{} problem(s) in your content:\n  - {}",
        errors.len(),
        errors.join("\n  - ")
    )
}

/// [`load_site_from_sources`], keeping each content problem apart so a caller
/// such as the Admin preview can report only those of one document.
pub fn load_site_from_sources_listing(
    root: &Path,
    config: SiteConfig,
    sources: Sources,
    options: LoadOptions,
) -> Result<(Site, ThemeSet), Vec<String>> {
    let config = with_asset_version(root, config);
    let counts = view_counts(root, &config);
    let themes = load_themes(root, &config).map_err(|error| vec![error])?;
    let mut site = Site::load(config, sources, options)?;
    site.view_counts = counts;
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

pub fn web_file(root: &Path, config: &SiteConfig, rel: &str) -> Option<Vec<u8>> {
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
    // Private research must never ride into a public folder (an export saved
    // into static/, a copied notebook): refuse before anything is generated.
    crate::private_guard::refuse_private_research_in_public_inputs(root, config)?;
    // Required destinations (including full-content feeds) must succeed before
    // generated output or stale files are changed.
    let files = generate(&site, &themes)?;
    let mut warnings = site.warnings.clone();
    warnings.extend(
        crate::portable_export::build_diagnostics(&site)?
            .into_iter()
            .map(|warning| format!("portability: {warning}")),
    );
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

    // Private project state (logins, analytics, research) is never copied,
    // even when a static or theme directory is configured to contain it.
    let private = fsutil::PrivateState::of(root);

    // 1. Static files (images, favicon, CNAME, ...) at the site root.
    let static_dir = root.join(&config.paths.static_dir);
    for file in fsutil::walk(&static_dir) {
        if private.contains(&file) {
            continue;
        }
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
        if private.contains(&file) {
            continue;
        }
        let rel = fsutil::relative(&themes_dir, &file);
        let bytes = fs::read(&file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
        put(format!("themes/{rel}"), &bytes)?;
    }

    // 4. Generated pages, feeds, and tokens.
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
        warnings,
        accessibility: site.accessibility.clone(),
        evidence: site.evidence.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "openblog-site-{tag}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn review_regression_summary_build_reports_portable_failure_without_failing_native_output() {
        let root = temp_root("portable-failure");
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::write(
            root.join("openblog.json"),
            r#"{"url":"https://example.test","feeds":{"fullContent":false}}"#,
        )
        .unwrap();
        fs::write(
            root.join("content/posts/work.md"),
            "---\ntitle: Work\ndate: 2020-01-01\n---\n[Legacy](javascript:alert(1))\n",
        )
        .unwrap();
        let report = build(
            &root,
            &BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .unwrap();
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("posts/work.md") && warning.contains("portable")));
        assert!(report.files > 0);
        let marker = fs::read(report.out_dir.join(fsutil::MARKER)).unwrap();
        let index = fs::read(report.out_dir.join("index.html")).unwrap();
        fs::write(
            report.out_dir.join("stale.txt"),
            "keep on preflight failure",
        )
        .unwrap();
        fs::write(
            root.join("openblog.json"),
            r#"{"url":"https://example.test","feeds":{"fullContent":true}}"#,
        )
        .unwrap();
        let error = build(
            &root,
            &BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .err()
        .unwrap();
        assert!(error.contains("link must use"), "{error}");
        assert_eq!(
            fs::read(report.out_dir.join(fsutil::MARKER)).unwrap(),
            marker
        );
        assert_eq!(fs::read(report.out_dir.join("index.html")).unwrap(), index);
        assert_eq!(
            fs::read_to_string(report.out_dir.join("stale.txt")).unwrap(),
            "keep on preflight failure"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn every_relative_script_import_is_embedded() {
        // A built site without a local `web/` copy uses only these files; one
        // missing module makes the browser reject the whole openblog.js graph.
        let embedded: HashSet<&str> = EMBEDDED_WEB.iter().map(|(path, _)| *path).collect();
        let mut missing = Vec::new();
        for (path, contents) in EMBEDDED_WEB
            .iter()
            .filter(|(path, _)| path.ends_with(".js"))
        {
            let dir = Path::new(path).parent().unwrap_or(Path::new(""));
            for line in contents.lines() {
                let line = line.trim_start();
                if !line.starts_with("import ") {
                    continue;
                }
                let Some(spec) = line.split(['"', '\'']).nth(1) else {
                    continue;
                };
                let Some(relative) = spec.strip_prefix("./") else {
                    continue;
                };
                let target = dir.join(relative).to_string_lossy().replace('\\', "/");
                if !embedded.contains(target.as_str()) {
                    missing.push(format!("{path} imports {spec}"));
                }
            }
        }
        assert!(missing.is_empty(), "not embedded: {missing:?}");
    }

    #[test]
    fn missing_content_directory_is_an_empty_source_set() {
        let root = temp_root("missing-content");
        fs::create_dir_all(&root).unwrap();
        let sources = read_sources(&root, &SiteConfig::default()).unwrap();
        assert!(sources.posts.is_empty());
        assert!(sources.credits.is_empty());
        assert!(sources.series.is_empty());
        assert!(sources.pages.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn content_walk_rejects_external_directory_symlinks_before_descent() {
        use std::os::unix::fs::symlink;

        let root = temp_root("external-link");
        let content = root.join("content");
        let outside = root.join("outside");
        fs::create_dir_all(content.join("posts")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("external.md"), "external").unwrap();
        symlink(&outside, content.join("posts/external")).unwrap();

        let error = read_sources(&root, &SiteConfig::default()).unwrap_err();
        assert!(error.contains("outside the content directory"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn content_walk_rejects_directory_symlink_cycles() {
        use std::os::unix::fs::symlink;

        let root = temp_root("link-cycle");
        let content = root.join("content");
        fs::create_dir_all(content.join("posts")).unwrap();
        symlink(&content, content.join("posts/cycle")).unwrap();

        let error = read_sources(&root, &SiteConfig::default()).unwrap_err();
        assert!(error.contains("symlink cycle"));
        fs::remove_dir_all(root).unwrap();
    }

    const PRIVATE_MARKER: &str = "ob-private-source-7f3a";
    const NOTEBOOK_MARKER: &str = "ob-private-notebook-9d21";
    const ATLAS_MARKER: &str = "ob-private-atlas-3c58";

    /// A project with one public post and a private source library whose
    /// every field carries a marker that must never be published.
    fn project_with_private_library(tag: &str, config: &str) -> PathBuf {
        let root = temp_root(tag);
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::write(root.join(CONFIG_FILE), config).unwrap();
        fs::write(
            root.join("content/posts/2026-01-05-hello.md"),
            "---\ntitle: Hello\ndate: 2026-01-05\nprofile: research\n---\n\nA public post.\n",
        )
        .unwrap();
        let library = format!(
            r#"{{"version":1,"sources":[{{"id":"{PRIVATE_MARKER}","kind":"work","title":"{PRIVATE_MARKER} title","notes":"{PRIVATE_MARKER} note"}}]}}"#
        );
        let path = root.join(crate::source_store::LIBRARY_FILE);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, library).unwrap();
        let notebook = format!(
            r#"{{"version":1,"passages":[{{"id":"p-leak","source":"{PRIVATE_MARKER}","excerpt":{{"text":"{NOTEBOOK_MARKER} quoted"}},"locators":[{{"kind":"page","value":"{NOTEBOOK_MARKER}"}}]}}],"notes":[{{"id":"n-leak","kind":"question","text":"{NOTEBOOK_MARKER} noted","passages":["p-leak"],"concepts":["{NOTEBOOK_MARKER}"]}}]}}"#
        );
        fs::write(root.join(crate::notebook_store::NOTEBOOK_FILE), notebook).unwrap();
        let atlas = format!(
            r#"{{"version":1,"entries":[{{"id":"{ATLAS_MARKER}","kind":"concept","label":"{ATLAS_MARKER} label","summary":"{ATLAS_MARKER} summary","visibility":"approved"}},{{"id":"w","kind":"work","label":"W","source":"{PRIVATE_MARKER}","visibility":"approved"}}],"relationships":[{{"id":"r","kind":"discusses","from":"w","to":"{ATLAS_MARKER}","assertedBy":{{"kind":"author"}},"evidence":[{{"source":"{PRIVATE_MARKER}","locators":[{{"kind":"section","value":"{ATLAS_MARKER}"}}]}}],"uncertainty":"{ATLAS_MARKER} doubt"}}]}}"#
        );
        // Positive control: the seeded file really is an atlas.
        assert!(openblog_core::research_bundle::looks_like_private_research(
            atlas.as_bytes()
        ));
        fs::write(root.join(crate::atlas_store::ATLAS_FILE), atlas).unwrap();
        root
    }

    fn assert_no_private_output(root: &Path) {
        let output = root.join("dist");
        let files = fsutil::walk(&output);
        assert!(!files.is_empty(), "the build wrote nothing");
        for file in files {
            let rel = fsutil::relative(&output, &file);
            let bytes = fs::read(&file).unwrap();
            assert!(
                !String::from_utf8_lossy(&bytes).contains(PRIVATE_MARKER)
                    && !String::from_utf8_lossy(&bytes).contains(NOTEBOOK_MARKER)
                    && !String::from_utf8_lossy(&bytes).contains(ATLAS_MARKER)
                    && !rel.contains("sources.json")
                    && !rel.contains("notebook.json")
                    && !rel.contains("atlas.json")
                    && !rel.contains(".openblog/private"),
                "{rel} exposes private source-library data"
            );
        }
    }

    fn production_build(root: &Path) -> BuildReport {
        build(
            root,
            &BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn a_normal_build_emits_no_private_source_library_data() {
        let root = project_with_private_library("private-library", "{}");
        let report = production_build(&root);
        assert_eq!(report.posts, 1);
        assert_no_private_output(&root);
        let search = fs::read_to_string(root.join("dist/search.json")).unwrap();
        assert!(!search.contains(NOTEBOOK_MARKER) && !search.contains(ATLAS_MARKER));
        assert!(
            search.contains("Hello"),
            "the public search index is still built"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn static_files_never_copy_private_project_state() {
        // A misconfigured project whose static directory is the project root.
        let root = project_with_private_library("private-static", r#"{"paths":{"static":"."}}"#);
        fs::write(root.join("public-note.txt"), "copied").unwrap();
        production_build(&root);
        assert_no_private_output(&root);
        assert!(
            root.join("dist/public-note.txt").exists(),
            "other static files still copy"
        );
        fs::remove_dir_all(root).unwrap();

        // Nor do private bytes feed the public asset version: editing the
        // library must not change a single `?v=` asset URL.
        let root =
            project_with_private_library("private-static-version", r#"{"paths":{"static":"."}}"#);
        let version = |root: &Path| {
            let config = load_config(root).unwrap();
            with_asset_version(root, config).cdn.version
        };
        let before = version(&root);
        fs::write(
            root.join(crate::source_store::LIBRARY_FILE),
            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"B"}]}"#,
        )
        .unwrap();
        assert_eq!(
            version(&root),
            before,
            "private edits changed the asset version"
        );
        fs::write(
            root.join(crate::notebook_store::NOTEBOOK_FILE),
            r#"{"version":1,"notes":[{"id":"n","kind":"question","text":"changed"}]}"#,
        )
        .unwrap();
        assert_eq!(
            version(&root),
            before,
            "private notebook edits changed the asset version"
        );
        fs::write(
            root.join(crate::atlas_store::ATLAS_FILE),
            r#"{"version":1,"entries":[{"id":"c","kind":"concept","label":"changed"}]}"#,
        )
        .unwrap();
        assert_eq!(
            version(&root),
            before,
            "private atlas edits changed the asset version"
        );
        fs::remove_dir_all(root).unwrap();

        // A static file that is a symlink into private storage.
        let root = project_with_private_library("private-static-link", "{}");
        fs::create_dir_all(root.join("static")).unwrap();
        let library = root.join(crate::source_store::LIBRARY_FILE);
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&library, root.join("static/leak.json")).is_ok();
        #[cfg(windows)]
        let linked =
            std::os::windows::fs::symlink_file(&library, root.join("static/leak.json")).is_ok();
        if linked {
            production_build(&root);
            assert_no_private_output(&root);
            assert!(!root.join("dist/leak.json").exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_build_publishes_only_the_public_description_of_cited_references() {
        let root = project_with_private_library("cited-build", "{}");
        let library = format!(
            r#"{{"version":1,"sources":[{{"id":"{PRIVATE_MARKER}","kind":"work","title":"{PRIVATE_MARKER} title"}},{{"id":"public-work","kind":"work","title":"A Public Title","issued":"2001","notes":"{PRIVATE_MARKER} note","identifiers":[{{"scheme":"my-drive","value":"{PRIVATE_MARKER}.pdf"}}]}}]}}"#
        );
        fs::write(root.join(crate::source_store::LIBRARY_FILE), library).unwrap();
        fs::write(
            root.join("content/posts/2026-01-06-cited.md"),
            "---\ntitle: Cited\ndate: 2026-01-06\ncitations: notes\n---\n\nA claim [@public-work, canonical 4].\n",
        )
        .unwrap();
        let report = production_build(&root);
        assert_eq!(report.posts, 2);
        assert_no_private_output(&root);
        let page = fs::read_to_string(root.join("dist/posts/cited/index.html"))
            .or_else(|_| fs::read_to_string(root.join("dist/cited/index.html")))
            .unwrap();
        assert!(page.contains("A Public Title. 2001, 4."), "{page}");
        assert!(page.contains("role=\"doc-noteref\""), "{page}");

        // An unknown key refuses the build before any output changes.
        let before = fs::read_to_string(root.join("dist/search.json")).unwrap();
        fs::write(
            root.join("content/posts/2026-01-06-cited.md"),
            "---\ntitle: Cited\ndate: 2026-01-06\ncitations: notes\n---\n\nA claim [@missing-work].\n",
        )
        .unwrap();
        let Err(error) = build(
            &root,
            &BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        ) else {
            panic!("a build with an unknown citation key succeeded");
        };
        assert!(
            error.contains("posts/2026-01-06-cited.md: line 7: citation `missing-work`")
                && !error.contains(PRIVATE_MARKER),
            "{error}"
        );
        assert_eq!(
            fs::read_to_string(root.join("dist/search.json")).unwrap(),
            before
        );
        fs::remove_dir_all(root).unwrap();
    }
}

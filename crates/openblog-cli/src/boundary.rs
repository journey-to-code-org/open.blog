//! The private-to-public research boundary at build time and in the Admin
//! preview (#63, ADR 0137).
//!
//! [`project`] attaches the research projections to a loaded site exactly as
//! a build does; [`manifest`] then says what they publish and why everything
//! else is withheld, from those same values, so the preview Admin shows and
//! the output a build writes come from one projection. [`check_output`] is the
//! build's last guard: no page exists for an item the manifest does not
//! publish, the JSON artifacts name only published items, and no text of a
//! private research file appears in any generated file unless a public input
//! or an approved projection holds it too. A refusal names the output, the
//! private file, the record and the field, never the text.

use std::cell::OnceCell;
use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::Path;

use openblog_core::comparison_publication::{stale_approvals, ComparisonInputs};
use openblog_core::contributor::Contributor;
use openblog_core::model::Post;
use openblog_core::publication_boundary::{
    BoundaryInputs, BoundaryManifest, ItemKind, PrivateText, Projection, Store, Switches,
    Unavailable,
};
use openblog_core::research_notes::Notebook;
use openblog_core::source_library::SourceLibrary;
use openblog_core::{OutputFile, Site};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::{
    alignment_store, atlas_store, claims_store, fsutil, notebook_store, research_review,
    source_store,
};

/// The largest private file the text guard reads.
const MAX_GUARDED_FILE: u64 = 16 * 1024 * 1024;
/// The largest public input file the guard reads to allow its text.
const MAX_ALLOWED_FILE: u64 = 8 * 1024 * 1024;
/// How many leaks a refusal names before it counts the rest.
const NAMED_LEAKS: usize = 5;

/// Why a projection could not be attached, as the build would refuse it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Blocked {
    pub atlas: Option<String>,
    pub comparisons: Option<String>,
    pub claims: Option<String>,
}

/// Attach the atlas and comparison projections to the site exactly as a
/// build does, over the research read once into `shared`. A projection that
/// cannot be built is reported, not attached.
pub fn project_with(root: &Path, site: &mut Site, shared: &Shared) -> Blocked {
    let mut blocked = Blocked::default();
    let config = site.config.clone();
    let projected = match shared.atlas(root) {
        Some(loaded) => {
            crate::site::published_atlas_from(&config, loaded.as_ref(), &mut site.warnings)
        }
        None => crate::site::published_atlas(root, &config, &mut site.warnings),
    };
    match projected {
        Ok(atlas) => site.atlas = atlas,
        Err(error) => blocked.atlas = Some(error),
    }
    let projected = match shared.alignments(root) {
        Some(loaded) => {
            crate::site::published_comparisons_from(&config, loaded.as_ref(), &mut site.warnings)
        }
        None => crate::site::published_comparisons(root, &config, &mut site.warnings),
    };
    match projected {
        Ok(comparisons) => site.comparisons = comparisons,
        Err(error) => blocked.comparisons = Some(error),
    }
    blocked.claims = site.claim_evidence_error.clone();
    blocked
}

/// The source library and notebook, and the atlas and alignments read
/// against them, read once and shared by the projections, the manifest and
/// the preview of one build or one Admin request, instead of once by each.
/// Nothing is read until something asks, and nothing is written.
pub struct Shared {
    contributors: BTreeMap<String, Contributor>,
    library: Option<SourceLibrary>,
    library_error: Option<String>,
    notebook: Option<Notebook>,
    notebook_error: Option<String>,
    atlas: OnceCell<Result<atlas_store::Snapshot, String>>,
    alignments: OnceCell<Result<alignment_store::Snapshot, String>>,
}

impl Shared {
    /// Read the library and the notebook, as a build reads them, when any
    /// private research file is stored.
    pub fn read(root: &Path, config: &openblog_core::SiteConfig) -> Self {
        let mut shared = Self {
            contributors: config.contributors.clone(),
            library: None,
            library_error: None,
            notebook: None,
            notebook_error: None,
            atlas: OnceCell::new(),
            alignments: OnceCell::new(),
        };
        let any_research = Store::ALL
            .iter()
            .any(|&store| store != Store::Acknowledgements && stored(root, store));
        if !any_research {
            return shared;
        }
        match source_store::load_for_build(root, &shared.contributors) {
            Ok(snapshot) => shared.library = Some(snapshot.library),
            Err(error) => {
                shared.library_error = Some(error.to_string());
                return shared;
            }
        }
        if let Some(library) = shared.library.clone() {
            match notebook_store::read(root, library) {
                Ok(snapshot) => shared.notebook = Some(snapshot.notebook),
                Err(error) => shared.notebook_error = Some(error.to_string()),
            }
        }
        shared
    }

    fn both(&self) -> Option<(&SourceLibrary, &Notebook)> {
        Some((self.library.as_ref()?, self.notebook.as_ref()?))
    }

    /// The atlas, read once, or `None` when the library or notebook it is
    /// read against could not be, so the caller reads and reports it itself.
    fn atlas(&self, root: &Path) -> Option<&Result<atlas_store::Snapshot, String>> {
        let (library, notebook) = self.both()?;
        Some(self.atlas.get_or_init(|| {
            atlas_store::from_parts(root, library.clone(), notebook.clone())
                .map_err(|error| error.to_string())
        }))
    }

    /// The alignments, read once as a build reads them.
    fn alignments(&self, root: &Path) -> Option<&Result<alignment_store::Snapshot, String>> {
        let (library, notebook) = self.both()?;
        Some(self.alignments.get_or_init(|| {
            alignment_store::load_for_build_with(
                root,
                &self.contributors,
                library.clone(),
                notebook.clone(),
            )
        }))
    }
}

/// The private research files, read on their own so one that cannot be read
/// is named and the others still explain what they withhold.
pub struct Stores<'a> {
    library: Option<&'a SourceLibrary>,
    notebook: Option<&'a Notebook>,
    atlas: Option<&'a openblog_core::knowledge_atlas::Atlas>,
    claims: Option<openblog_core::claims::ClaimSet>,
    alignments: Option<&'a alignment_store::Snapshot>,
    acknowledgements: Option<usize>,
    unavailable: Vec<Unavailable>,
}

fn stored(root: &Path, store: Store) -> bool {
    fs::symlink_metadata(root.join(store.file())).is_ok()
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().to_string()
}

impl<'a> Stores<'a> {
    /// Every private research file that is stored, over the research read
    /// once into `shared`. Nothing is written.
    pub fn read(root: &Path, shared: &'a Shared) -> Self {
        let mut unavailable = Vec::new();
        let mut fail = |store: Store, message: String| {
            unavailable.push(Unavailable {
                store,
                file: store.file(),
                message: first_line(&message),
            });
        };
        if let Some(error) = &shared.library_error {
            fail(Store::SourceLibrary, error.clone());
        }
        let library = shared.library.as_ref();
        let mut notebook = None;
        if library.is_some() && stored(root, Store::Notebook) {
            match (&shared.notebook, &shared.notebook_error) {
                (Some(read), _) => notebook = Some(read),
                (None, Some(error)) => fail(Store::Notebook, error.clone()),
                (None, None) => {}
            }
        }
        let ready = library.is_some() && (notebook.is_some() || !stored(root, Store::Notebook));
        let mut atlas = None;
        if ready && stored(root, Store::Atlas) {
            match shared.atlas(root) {
                Some(Ok(snapshot)) => atlas = Some(&snapshot.atlas),
                Some(Err(error)) => fail(Store::Atlas, error.clone()),
                None => {}
            }
        }
        let mut claims = None;
        if ready && stored(root, Store::Claims) {
            if let Some((library, notebook)) = shared.both() {
                match claims_store::from_parts(root, library.clone(), notebook.clone()) {
                    Ok(snapshot) => claims = Some(snapshot.claims),
                    Err(error) => fail(Store::Claims, error.to_string()),
                }
            }
        }
        let mut alignments = None;
        if ready && stored(root, Store::Alignments) {
            match shared.alignments(root) {
                Some(Ok(snapshot)) => alignments = Some(snapshot),
                Some(Err(error)) => fail(Store::Alignments, error.clone()),
                None => {}
            }
        }
        let mut acknowledgements = None;
        if stored(root, Store::Acknowledgements) {
            match research_review::load(root) {
                Ok(snapshot) => acknowledgements = Some(snapshot.set.acknowledgements.len()),
                Err(error) => fail(Store::Acknowledgements, error.to_string()),
            }
        }
        Self {
            library,
            notebook,
            atlas,
            claims,
            alignments,
            acknowledgements,
            unavailable,
        }
    }
}

/// What the research projections attached to `site` publish, and why
/// everything else is withheld: for the whole site, or for one post.
pub fn manifest(
    site: &Site,
    stores: &Stores<'_>,
    blocked: &Blocked,
    post: Option<&Post>,
) -> BoundaryManifest {
    let contributors = &site.config.contributors;
    let stale = stores.alignments.map(|snapshot| {
        stale_approvals(
            &snapshot.alignments,
            ComparisonInputs {
                library: &snapshot.library,
                notebook: &snapshot.notebook,
                contributors,
            },
        )
    });
    let inputs = BoundaryInputs {
        switches: Switches::of(&site.config),
        posts: &site.posts,
        public_atlas: site.atlas.as_ref(),
        atlas_blocked: blocked.atlas.as_deref(),
        public_comparisons: site.comparisons.as_ref(),
        comparisons_blocked: blocked.comparisons.as_deref(),
        claims_blocked: blocked.claims.as_deref(),
        library: stores.library,
        notebook: stores.notebook,
        atlas: stores.atlas,
        claims: stores.claims.as_ref(),
        alignments: stores.alignments.map(|snapshot| &snapshot.alignments),
        stale_comparisons: stale.as_ref(),
        acknowledgements: stores.acknowledgements,
        unavailable: &stores.unavailable,
    };
    match post {
        Some(post) => BoundaryManifest::post(&inputs, post),
        None => BoundaryManifest::site(&inputs),
    }
}

/// The site-wide manifest a build of the saved files would publish, for the
/// Admin preview: the same load, projections and manifest as `generate_site`,
/// with a projection that cannot be built reported instead of refusing.
pub fn site_preview(root: &Path, site: &mut Site, shared: &Shared) -> BoundaryManifest {
    let blocked = project_with(root, site, shared);
    let stores = Stores::read(root, shared);
    manifest(site, &stores, &blocked, None)
}

fn read_capped(path: &Path, cap: u64) -> Option<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > cap {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(cap)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

const TEXT_EXTENSIONS: &[&str] = &[
    "md",
    "markdown",
    "txt",
    "html",
    "htm",
    "json",
    "xml",
    "svg",
    "csv",
    "css",
    "js",
    "mjs",
    "yml",
    "yaml",
    "toml",
    "rss",
    "atom",
    "webmanifest",
];

/// Whether a copied static or theme file is text the guard scans: a known
/// text extension, or none at all (`CNAME`, `_redirects`, `robots`).
fn scanned_extension(file: &Path) -> bool {
    match file.extension().and_then(|extension| extension.to_str()) {
        Some(extension) => TEXT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()),
        None => true,
    }
}

fn allow_file(guard: &mut PrivateText, path: &Path) {
    if let Some(bytes) = read_capped(path, MAX_ALLOWED_FILE) {
        guard.allow_output(&String::from_utf8_lossy(&bytes));
    }
}

/// The guard for this site: every private research file's text, less what
/// THIS build publishes (ADR 0137): the text of the published posts and
/// pages, the published reader feedback file, the site's own configuration,
/// the approved projections and the descriptions of the sources they publish.
/// Drafts, held-back posts, other content files and the static and theme
/// files are not public input: the static and theme files are copied out, so
/// they are scanned like any other output.
fn guard(root: &Path, site: &Site) -> PrivateText {
    let mut guard = PrivateText::new();
    for store in Store::ALL {
        if let Some(bytes) = read_capped(&root.join(store.file()), MAX_GUARDED_FILE) {
            guard.add_file(store, &bytes);
        }
    }
    if guard.is_empty() {
        return guard;
    }
    let config = &site.config;
    // The author's own configuration: the site's title, navigation, authors.
    allow_file(&mut guard, &root.join("openblog.json"));
    let content = root.join(&config.paths.content);
    allow_file(
        &mut guard,
        &content.join(openblog_core::feedback_publication::READER_FEEDBACK_FILE),
    );
    // The published posts, as written and as rendered.
    for post in &site.posts {
        for text in [
            post.title.as_str(),
            post.description.as_str(),
            post.cover_alt.as_str(),
            post.text.as_str(),
            post.publication_markdown(),
        ] {
            guard.allow_text(text);
        }
        if let Some(subtitle) = &post.subtitle {
            guard.allow_text(subtitle);
        }
        guard.allow_output(&post.html);
        for tag in &post.tags {
            guard.allow_text(&tag.name);
        }
        if let Some(attribution) = &post.shared_attribution {
            if let Some(question) = &attribution.question {
                guard.allow_text(question);
            }
            if let Some(source) = &attribution.source {
                guard.allow_text(&source.title);
            }
        }
        allow_file(&mut guard, &content.join(&post.source));
        // A source's public description is the citation allowlist (ADR 0044),
        // published with the post that cites it.
        if let Some(citations) = post.citations() {
            for reference in &citations.references {
                allow_reference(&mut guard, reference);
            }
        }
    }
    // The site's own addresses, which every page, feed and sitemap repeats:
    // a note that merely pastes a link to a public page is not a leak.
    let base = config.url.trim_end_matches('/');
    for url in site
        .posts
        .iter()
        .map(|post| &post.url)
        .chain(site.pages.iter().map(|page| &page.url))
        .chain(site.tags.iter().map(|tag| &tag.url))
        .chain(site.series.iter().map(|series| &series.url))
    {
        guard.allow_text(&format!("{base}{url}"));
    }
    for page in &site.pages {
        guard.allow_text(&page.title);
        guard.allow_text(&page.description);
        guard.allow_text(&page.text);
        guard.allow_output(&page.html);
        allow_file(&mut guard, &content.join(&page.source));
    }
    for series in &site.series {
        guard.allow_text(&series.name);
        guard.allow_text(&series.description_text);
        guard.allow_output(&series.description_html);
        if let Some(source) = &series.source {
            allow_file(&mut guard, &content.join(source));
        }
    }
    for tag in &site.tags {
        guard.allow_text(&tag.name);
    }
    // Approved projections, as the build renders them.
    if let Some(atlas) = &site.atlas {
        guard.allow_output(&atlas.to_json());
    }
    if let Some(comparisons) = &site.comparisons {
        guard.allow_output(&comparisons.to_json());
    }
    guard.allow_output(
        &openblog_core::claim_publication::PublicClaimEvidence::of(&site.posts).to_json(),
    );
    guard
}

fn allow_reference(guard: &mut PrivateText, reference: &openblog_core::citations::PublicReference) {
    if let Ok(json) = serde_json::to_string(reference) {
        guard.allow_output(&json);
    }
    guard.allow_text(&openblog_core::citations::format_reference(reference));
}

/// The static and theme files a build copies out, as `(output path, bytes)`:
/// the files the guard scans because nothing allows their text.
fn copied_files(root: &Path, config: &openblog_core::SiteConfig) -> Vec<(String, Vec<u8>)> {
    let private = fsutil::PrivateState::of(root);
    let mut copied = Vec::new();
    for (dir, prefix) in [
        (&config.paths.static_dir, ""),
        (&config.paths.themes, "themes/"),
    ] {
        let base = root.join(dir);
        for file in fsutil::walk(&base) {
            if !scanned_extension(&file) || private.contains(&file) {
                continue;
            }
            if let Some(bytes) = read_capped(&file, MAX_ALLOWED_FILE) {
                copied.push((format!("{prefix}{}", fsutil::relative(&base, &file)), bytes));
            }
        }
    }
    copied
}

fn ids_at(value: &Value, list: &str) -> Vec<String> {
    value[list]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["id"].as_str().map(str::to_string))
        .collect()
}

/// Items a public artifact or page names that the manifest does not publish.
fn unlisted(manifest: &BoundaryManifest, site: &Site, files: &[OutputFile]) -> Vec<String> {
    let mut problems = Vec::new();
    let atlas_entries = manifest.published_ids(Projection::Atlas, ItemKind::Entry);
    let relationships = manifest.published_ids(Projection::Atlas, ItemKind::Relationship);
    let datings = manifest.published_ids(Projection::Datings, ItemKind::Dating);
    let comparisons = manifest.published_ids(Projection::Comparisons, ItemKind::Comparison);
    let claims = manifest.published_ids(Projection::ClaimEvidence, ItemKind::Claim);
    let mut check = |file: &str, kind: &str, id: &str, known: &BTreeSet<&str>| {
        if !known.contains(id) {
            problems.push(format!(
                "`{file}` names the {kind} `{id}`, which no approved projection publishes"
            ));
        }
    };
    for file in files {
        let segments: Vec<&str> = file.path.split('/').collect();
        if let [segment, id, "index.html"] = segments.as_slice() {
            if *segment == "atlas" && site.atlas.is_some() {
                check(&file.path, "atlas entry", id, &atlas_entries);
            }
            if *segment == openblog_core::comparison_publication::COMPARISONS_SEGMENT
                && site.comparisons.is_some()
            {
                check(&file.path, "comparison", id, &comparisons);
            }
        }
        let json = || serde_json::from_str::<Value>(&file.contents).unwrap_or(Value::Null);
        if file.path == openblog_core::atlas_publication::ATLAS_JSON_FILE {
            let value = json();
            for id in ids_at(&value, "entries") {
                check(&file.path, "atlas entry", &id, &atlas_entries);
            }
            for id in ids_at(&value, "relationships") {
                check(&file.path, "relationship", &id, &relationships);
            }
            for id in ids_at(&value, "datings") {
                check(&file.path, "dating", &id, &datings);
            }
        } else if file.path == openblog_core::comparison_publication::COMPARISONS_JSON_FILE {
            for id in ids_at(&json(), "comparisons") {
                check(&file.path, "comparison", &id, &comparisons);
            }
        } else if file.path == openblog_core::claim_publication::CLAIM_EVIDENCE_JSON_FILE {
            let value = json();
            for post in value["posts"].as_array().into_iter().flatten() {
                for id in ids_at(post, "claims") {
                    check(&file.path, "claim", &id, &claims);
                }
            }
        }
    }
    problems
}

/// The build's last boundary check, before anything is written: refuse when
/// generated output names an item no approved projection publishes, or
/// carries text from a private research file that nothing public holds.
pub fn check_output(
    root: &Path,
    site: &Site,
    manifest: &BoundaryManifest,
    files: &[OutputFile],
) -> Result<(), String> {
    let problems = unlisted(manifest, site, files);
    if !problems.is_empty() {
        return Err(format!(
            "refusing to build: {}. Nothing was written.",
            problems.join("; ")
        ));
    }
    let guard = guard(root, site);
    if guard.is_empty() {
        return Ok(());
    }
    let copied = copied_files(root, &site.config);
    let leaks = guard_files(
        &guard,
        files
            .iter()
            .map(|file| (file.path.as_str(), file.contents.as_bytes()))
            .chain(
                copied
                    .iter()
                    .map(|(path, bytes)| (path.as_str(), bytes.as_slice())),
            ),
    );
    if leaks.is_empty() {
        return Ok(());
    }
    Err(leak_refusal(&leaks))
}

fn guard_files<'a>(
    guard: &PrivateText,
    files: impl Iterator<Item = (&'a str, &'a [u8])>,
) -> Vec<openblog_core::publication_boundary::Leak> {
    if guard.is_empty() {
        return Vec::new();
    }
    files
        .filter_map(|(path, bytes)| guard.find(path, bytes))
        .collect()
}

fn leak_refusal(leaks: &[openblog_core::publication_boundary::Leak]) -> String {
    let named: Vec<String> = leaks
        .iter()
        .take(NAMED_LEAKS)
        .map(ToString::to_string)
        .collect();
    let more = leaks.len().saturating_sub(NAMED_LEAKS);
    format!(
        "refusing to build: private research would be published: {}{}. That text appears in a public output but not in any post or page this build publishes, and no approved projection holds it, so nothing was written. Remove it from where that output gets it (a static or theme file, a template or the configuration), or publish it deliberately: write it in a post, or approve the item through its projection. A note or passage is never published by itself.",
        named.join("; "),
        if more > 0 {
            format!(" and {more} more")
        } else {
            String::new()
        }
    )
}

/// The same text guard for a portable export of one post: refuse to hand
/// out text from a private research file that nothing public holds.
pub fn check_export(root: &Path, site: &Site, path: &str, text: &str) -> Result<(), String> {
    let guard = guard(root, site);
    match guard.find(path, text.as_bytes()) {
        None => Ok(()),
        Some(leak) => Err(leak_refusal(&[leak])
            .replace("refusing to build", "refusing to export")
            .replace("nothing was written", "no file was written")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const NOTE: &str = "A private reading of the allegory that only the author has seen";

    fn project_with_note(tag: &str, config: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("openblog-boundary-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        crate::scaffold::init(&root, Some("Guard"), false).unwrap();
        if !config.is_empty() {
            let path = root.join("openblog.json");
            let mut value: Value =
                serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            for (key, item) in
                serde_json::from_str::<serde_json::Map<String, Value>>(config).unwrap()
            {
                value[key] = item;
            }
            fs::write(&path, value.to_string()).unwrap();
        }
        let research = root.join(".openblog/private/research");
        fs::create_dir_all(&research).unwrap();
        fs::write(
            research.join("sources.json"),
            r#"{"version":1,"sources":[{"id":"plato","kind":"work","title":"Politeia"}]}"#,
        )
        .unwrap();
        fs::write(
            research.join("notebook.json"),
            format!(r#"{{"version":1,"passages":[],"notes":[{{"id":"n1","kind":"observation","text":"{NOTE}"}}]}}"#),
        )
        .unwrap();
        fs::write(
            research.join("atlas.json"),
            r#"{"version":2,"entries":[{"id":"plato-person","kind":"person","label":"Plato","visibility":"approved"},{"id":"secret","kind":"concept","label":"Secret"}],"relationships":[]}"#,
        )
        .unwrap();
        root
    }

    fn checked(root: &Path, files: &[OutputFile]) -> Result<(), String> {
        let (mut site, _) = crate::site::load_site(root, false, None).unwrap();
        let shared = Shared::read(root, &site.config);
        let blocked = project_with(root, &mut site, &shared);
        let stores = Stores::read(root, &shared);
        let manifest = manifest(&site, &stores, &blocked, None);
        check_output(root, &site, &manifest, files)
    }

    fn page(path: &str, contents: &str) -> OutputFile {
        OutputFile {
            path: path.into(),
            contents: contents.into(),
        }
    }

    #[test]
    fn private_text_in_generated_output_refuses_the_build_naming_where_it_came_from() {
        let root = project_with_note("leak", "");
        let leaked = page(
            "about/index.html",
            "<p>&ldquo;A PRIVATE reading of the allegory that only the author&rdquo;</p>",
        );
        let error =
            checked(&root, &[page("index.html", "<p>Hello</p>"), leaked.clone()]).unwrap_err();
        for expected in [
            "refusing to build",
            "`about/index.html`",
            "the research notebook",
            ".openblog/private/research/notebook.json",
            "`n1`",
            "field `text`",
            "nothing was written",
        ] {
            assert!(error.contains(expected), "{expected}: {error}");
        }
        assert!(!error.to_lowercase().contains("allegory"), "{error}");

        // The same words in a post are the author's own public text.
        fs::write(
            root.join("content/posts/2026-01-07-reading.md"),
            format!("---\ntitle: Reading\ndate: 2026-01-07\n---\n\n{NOTE}.\n"),
        )
        .unwrap();
        assert_eq!(checked(&root, &[leaked]), Ok(()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_page_or_artifact_for_an_unpublished_item_refuses_the_build() {
        let root = project_with_note("unlisted", r#"{"knowledgeAtlas":{"publish":true}}"#);
        assert_eq!(
            checked(
                &root,
                &[page("atlas/plato-person/index.html", "<p>Plato</p>")]
            ),
            Ok(())
        );
        let error =
            checked(&root, &[page("atlas/secret/index.html", "<p>Secret</p>")]).unwrap_err();
        assert!(
            error.contains("`atlas/secret/index.html` names the atlas entry `secret`"),
            "{error}"
        );
        let error = checked(
            &root,
            &[page(
                "atlas.json",
                r#"{"entries":[{"id":"plato-person"},{"id":"secret"}]}"#,
            )],
        )
        .unwrap_err();
        assert!(
            error.contains("`atlas.json` names the atlas entry `secret`"),
            "{error}"
        );
        let _ = fs::remove_dir_all(root);
    }

    const PASSAGE: &str =
        "Plato's prisoners are not a metaphor for anything at all, really, said the reader.";
    const SHORT_NOTES: [&str; 2] = [
        "Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.",
        "I'm not sure Plato's cave is meant literally - ask Dana before publishing.",
    ];

    /// A fresh site with a notebook of one passage and two short, punctuated
    /// notes, and no projection switched on.
    fn research_site(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("openblog-guard-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        crate::scaffold::init(&root, Some("Guard"), false).unwrap();
        let research = root.join(".openblog/private/research");
        fs::create_dir_all(&research).unwrap();
        fs::write(
            research.join("sources.json"),
            r#"{"version":1,"sources":[{"id":"plato","kind":"work","title":"Politeia"}]}"#,
        )
        .unwrap();
        let notebook = serde_json::json!({
            "version": 1,
            "passages": [{"id": "p1", "source": "plato", "excerpt": {"text": PASSAGE}}],
            "notes": [
                {"id": "n1", "kind": "observation", "text": SHORT_NOTES[0]},
                {"id": "n2", "kind": "question", "text": SHORT_NOTES[1]},
            ],
        });
        fs::write(research.join("notebook.json"), notebook.to_string()).unwrap();
        root
    }

    fn build_into(root: &Path, out: &Path) -> Result<crate::site::BuildReport, String> {
        crate::site::build(
            root,
            &crate::site::BuildOptions {
                include_drafts: false,
                out_override: Some(out.to_path_buf()),
                now: None,
            },
        )
    }

    fn write_post(root: &Path, name: &str, front: &str, body: &str) {
        fs::write(
            root.join(format!("content/posts/{name}.md")),
            format!("---\ntitle: {name}\ndate: 2026-01-07\n{front}---\n\n{body}\n"),
        )
        .unwrap();
    }

    fn tree(dir: &Path) -> Vec<(String, Vec<u8>)> {
        fsutil::walk(dir)
            .into_iter()
            .map(|file| (fsutil::relative(dir, &file), fs::read(&file).unwrap()))
            .collect()
    }

    #[test]
    fn a_post_quoting_a_passage_builds_however_it_wraps_emphasises_or_links_it() {
        let root = research_site("quotes");
        write_post(
            &root,
            "wrapped",
            "",
            "> Plato's prisoners are not a metaphor\n> for anything at all, really,\n> said the reader.",
        );
        write_post(
            &root,
            "emphasis",
            "",
            "Plato's prisoners are **not** a metaphor for *anything* at all, really, said the reader.",
        );
        write_post(
            &root,
            "linked",
            "",
            "Plato's prisoners are not a [metaphor](https://example.org/metaphor) for anything at all, really, said the reader.",
        );
        write_post(
            &root,
            "described",
            &format!("description: {PASSAGE}\n"),
            "A post.",
        );
        let out = root.join("out");
        let report = build_into(&root, &out);
        assert!(report.is_ok(), "{:?}", report.err());
        // The quote reached the search index, llms.txt and the feeds, which
        // join its wrapped lines and strip its markup.
        let files = tree(&out);
        for path in ["search.json", "llms-full.txt", "rss.xml", "feed.json"] {
            let (_, bytes) = files.iter().find(|(file, _)| file == path).expect(path);
            let text = String::from_utf8_lossy(bytes).to_lowercase();
            assert!(text.contains("prisoners are not a metaphor"), "{path}");
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn short_punctuated_notes_leaked_through_static_or_theme_files_refuse_the_build() {
        for (tag, path, shown, contents, id) in [
            (
                "static-note",
                "static/notes.txt",
                "notes.txt",
                format!("Reminder.\n\n{}\n", SHORT_NOTES[0]),
                "n1",
            ),
            (
                "static-page",
                "static/extra.html",
                "extra.html",
                format!(
                    "<meta name=\"description\" content=\"{}\">",
                    SHORT_NOTES[1].replace('\'', "&#39;")
                ),
                "n2",
            ),
            (
                "theme-file",
                "themes/mine/readme.txt",
                "themes/mine/readme.txt",
                SHORT_NOTES[1].replace(" - ", "\n- "),
                "n2",
            ),
        ] {
            let root = research_site(tag);
            let file = root.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, contents).unwrap();
            let out = root.join("out");
            let error = build_into(&root, &out).err().expect(tag);
            for expected in [
                "refusing to build",
                &format!("`{shown}`"),
                "the research notebook",
                &format!("`{id}`"),
                "nothing was written",
                "write it in a post",
            ] {
                assert!(error.contains(expected), "{tag}: {expected}: {error}");
            }
            assert!(
                !error.contains("Smith") && !error.contains("Dana"),
                "{error}"
            );
            assert!(!out.join("index.html").exists(), "{tag}");
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn a_note_that_only_pastes_a_link_to_a_public_page_is_not_a_leak() {
        let root = research_site("links");
        write_post(&root, "linked-post", "", "A post.");
        let (site, _) = crate::site::load_site(&root, false, None).unwrap();
        let link = format!(
            "{}{}",
            site.config.url.trim_end_matches('/'),
            site.posts[0].url
        );
        let path = root.join(".openblog/private/research/notebook.json");
        let mut notebook: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        notebook["notes"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"id": "n3", "kind": "observation", "text": link}));
        fs::write(&path, notebook.to_string()).unwrap();
        let built = build_into(&root, &root.join("out"));
        assert!(built.is_ok(), "{link}: {:?}", built.err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_draft_or_unrelated_content_file_does_not_make_private_text_public() {
        let root = research_site("draft");
        // A draft quotes the note; the build does not publish the draft, so
        // its text is not an input that allows anything.
        write_post(&root, "draft-quote", "draft: true\n", SHORT_NOTES[0]);
        fs::write(root.join("static/notes.txt"), SHORT_NOTES[0]).unwrap();
        let out = root.join("out");
        let error = build_into(&root, &out).err().expect("refused");
        assert!(
            error.contains("`notes.txt`") && error.contains("`n1`"),
            "{error}"
        );
        // Published, the same quote is the author's own text.
        write_post(&root, "draft-quote", "", SHORT_NOTES[0]);
        let built = build_into(&root, &out);
        assert!(built.is_ok(), "{:?}", built.err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_refused_build_leaves_the_output_folder_as_it_was() {
        let root = research_site("rollback");
        let out = root.join("out");
        build_into(&root, &out).unwrap();
        let before = tree(&out);
        assert!(!before.is_empty());
        fs::write(root.join("static/notes.txt"), SHORT_NOTES[1]).unwrap();
        write_post(
            &root,
            "later",
            "",
            "A new post that would have been written.",
        );
        assert!(build_into(&root, &out).is_err());
        assert_eq!(tree(&out), before, "nothing was written, nothing removed");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_portable_export_carrying_private_text_is_refused_and_a_quote_is_not() {
        let root = research_site("export");
        write_post(&root, "quote", "", &format!("> {PASSAGE}"));
        let (site, _) = crate::site::load_site(&root, false, None).unwrap();
        assert_eq!(
            check_export(&root, &site, "quote.md", &format!("> {PASSAGE}")),
            Ok(())
        );
        let error = check_export(
            &root,
            &site,
            "quote.md",
            &format!("An export that also says: {}", SHORT_NOTES[0]),
        )
        .unwrap_err();
        for expected in [
            "refusing to export",
            "`quote.md`",
            "`n1`",
            "no file was written",
        ] {
            assert!(error.contains(expected), "{expected}: {error}");
        }
        assert!(!error.contains("Smith"), "{error}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn without_research_files_nothing_is_guarded_or_read() {
        let root =
            std::env::temp_dir().join(format!("openblog-boundary-none-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        crate::scaffold::init(&root, Some("Guard"), false).unwrap();
        let (site, _) = crate::site::load_site(&root, false, None).unwrap();
        let shared = Shared::read(&root, &site.config);
        let stores = Stores::read(&root, &shared);
        assert!(stores.library.is_none() && stores.unavailable.is_empty());
        let manifest = manifest(&site, &stores, &Blocked::default(), None);
        assert!(manifest.never.is_empty());
        assert_eq!(
            manifest.summary(),
            None,
            "the build prints what it printed before"
        );
        assert!(guard(&root, &site).is_empty());
        let _ = fs::remove_dir_all(root);
    }
}

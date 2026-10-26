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

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::Path;

use openblog_core::comparison_publication::{stale_approvals, ComparisonInputs};
use openblog_core::model::Post;
use openblog_core::publication_boundary::{
    BoundaryInputs, BoundaryManifest, ItemKind, PrivateText, Projection, Store, Switches,
    Unavailable,
};
use openblog_core::{OutputFile, Site};
use serde_json::Value;

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
/// build does. A projection that cannot be built is reported, not attached.
pub fn project(root: &Path, site: &mut Site) -> Blocked {
    let mut blocked = Blocked::default();
    let config = site.config.clone();
    match crate::site::published_atlas(root, &config, &mut site.warnings) {
        Ok(atlas) => site.atlas = atlas,
        Err(error) => blocked.atlas = Some(error),
    }
    match crate::site::published_comparisons(root, &config, &mut site.warnings) {
        Ok(comparisons) => site.comparisons = comparisons,
        Err(error) => blocked.comparisons = Some(error),
    }
    blocked.claims = site.claim_evidence_error.clone();
    blocked
}

/// The private research files, read on their own so one that cannot be read
/// is named and the others still explain what they withhold.
pub struct Stores {
    library: Option<openblog_core::source_library::SourceLibrary>,
    notebook: Option<openblog_core::research_notes::Notebook>,
    atlas: Option<openblog_core::knowledge_atlas::Atlas>,
    claims: Option<openblog_core::claims::ClaimSet>,
    alignments: Option<alignment_store::Snapshot>,
    acknowledgements: Option<usize>,
    unavailable: Vec<Unavailable>,
}

fn stored(root: &Path, store: Store) -> bool {
    fs::symlink_metadata(root.join(store.file())).is_ok()
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().to_string()
}

impl Stores {
    /// Read every private research file that is stored. Nothing is written.
    pub fn read(root: &Path, config: &openblog_core::SiteConfig) -> Self {
        let contributors = &config.contributors;
        let mut unavailable = Vec::new();
        let mut fail = |store: Store, message: String| {
            unavailable.push(Unavailable {
                store,
                file: store.file(),
                message: first_line(&message),
            });
        };
        let any_research = Store::ALL
            .iter()
            .any(|&store| store != Store::Acknowledgements && stored(root, store));
        let mut library = None;
        if any_research {
            match source_store::load_for_build(root, contributors) {
                Ok(snapshot) => library = Some(snapshot.library),
                Err(error) => fail(Store::SourceLibrary, error.to_string()),
            }
        }
        let mut notebook = None;
        if let Some(library) = library.clone().filter(|_| stored(root, Store::Notebook)) {
            match notebook_store::read(root, library) {
                Ok(snapshot) => notebook = Some(snapshot.notebook),
                Err(error) => fail(Store::Notebook, error.to_string()),
            }
        }
        let ready = library.is_some() && (notebook.is_some() || !stored(root, Store::Notebook));
        let mut atlas = None;
        if ready && stored(root, Store::Atlas) {
            match atlas_store::load_for_build(root, contributors) {
                Ok(snapshot) => atlas = Some(snapshot.atlas),
                Err(error) => fail(Store::Atlas, error.to_string()),
            }
        }
        let mut claims = None;
        if ready && stored(root, Store::Claims) {
            match claims_store::load(root, contributors) {
                Ok(snapshot) => claims = Some(snapshot.claims),
                Err(error) => fail(Store::Claims, error.to_string()),
            }
        }
        let mut alignments = None;
        if ready && stored(root, Store::Alignments) {
            match alignment_store::load_for_build(root, contributors) {
                Ok(snapshot) => alignments = Some(snapshot),
                Err(error) => fail(Store::Alignments, error),
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
    stores: &Stores,
    blocked: &Blocked,
    post: Option<&Post>,
) -> BoundaryManifest {
    let contributors = &site.config.contributors;
    let stale = stores.alignments.as_ref().map(|snapshot| {
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
        library: stores.library.as_ref(),
        notebook: stores.notebook.as_ref(),
        atlas: stores.atlas.as_ref(),
        claims: stores.claims.as_ref(),
        alignments: stores
            .alignments
            .as_ref()
            .map(|snapshot| &snapshot.alignments),
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
pub fn site_preview(root: &Path, site: &mut Site) -> BoundaryManifest {
    let blocked = project(root, site);
    let stores = Stores::read(root, &site.config);
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
    "md", "markdown", "txt", "html", "htm", "json", "xml", "svg", "csv", "css", "js", "mjs", "yml",
    "yaml", "toml",
];

/// The guard for this site: every private research file's text, less what a
/// public input or an approved projection also holds.
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
    // Public inputs: the author's own text is public wherever it came from.
    let config = &site.config;
    if let Some(bytes) = read_capped(&root.join("openblog.json"), MAX_ALLOWED_FILE) {
        guard.allow(&bytes);
    }
    let private = fsutil::PrivateState::of(root);
    for dir in [
        &config.paths.content,
        &config.paths.static_dir,
        &config.paths.themes,
    ] {
        for file in fsutil::walk(&root.join(dir)) {
            let text = file
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    TEXT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
                });
            if !text || private.contains(&file) {
                continue;
            }
            if let Some(bytes) = read_capped(&file, MAX_ALLOWED_FILE) {
                guard.allow(&bytes);
            }
        }
    }
    if let Ok(json) = serde_json::to_string(&config.contributors) {
        guard.allow(json.as_bytes());
    }
    // Approved projections, as the build renders them.
    for post in &site.posts {
        guard.allow(post.publication_markdown().as_bytes());
    }
    if let Some(atlas) = &site.atlas {
        guard.allow(atlas.to_json().as_bytes());
    }
    if let Some(comparisons) = &site.comparisons {
        guard.allow(comparisons.to_json().as_bytes());
    }
    guard.allow(
        openblog_core::claim_publication::PublicClaimEvidence::of(&site.posts)
            .to_json()
            .as_bytes(),
    );
    // A source's public description is the citation allowlist (ADR 0044): it
    // is published wherever a citation or a projection uses the source.
    if let Ok(snapshot) = source_store::load_for_build(root, &config.contributors) {
        for record in &snapshot.library.sources {
            let reference = openblog_core::citations::public_reference(record);
            if let Ok(json) = serde_json::to_string(&reference) {
                guard.allow(json.as_bytes());
            }
            guard.allow(openblog_core::citations::format_reference(&reference).as_bytes());
        }
    }
    guard
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
    let leaks = guard_files(
        &guard,
        files
            .iter()
            .map(|file| (file.path.as_str(), file.contents.as_bytes())),
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
        "refusing to build: private research would be published: {}{}. No approved projection or public file holds that text, so nothing was written. Approve the item through its projection, or remove the text from what publishes it.",
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
        let blocked = project(root, &mut site);
        let stores = Stores::read(root, &site.config);
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

    #[test]
    fn without_research_files_nothing_is_guarded_or_read() {
        let root =
            std::env::temp_dir().join(format!("openblog-boundary-none-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        crate::scaffold::init(&root, Some("Guard"), false).unwrap();
        let (site, _) = crate::site::load_site(&root, false, None).unwrap();
        let stores = Stores::read(&root, &site.config);
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

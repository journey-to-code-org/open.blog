//! Private, file-backed storage for the research source library.
//!
//! The library lives at [`LIBRARY_FILE`], inside the Git-ignored private
//! directory and outside content, static files, themes, and build output, so
//! no build reads or copies it. Every change names the revision it was based
//! on, is validated by `openblog_core::source_library`, and replaces the file
//! by atomic rename while holding a lock: a refused, failed, or interrupted
//! change leaves the stored library exactly as it was.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use openblog_core::contributor::Contributor;
use openblog_core::source_library::{
    SourceDiagnostic, SourceDiagnosticCode, SourceLibrary, SourceRecord, MAX_LIBRARY_BYTES,
};
use sha2::{Digest, Sha256};

use crate::transaction::FileLock;

/// Where the library lives, relative to the project root.
pub const LIBRARY_FILE: &str = ".openblog/private/research/sources.json";
/// How long a change waits for another writer before giving up.
const LOCK_WAIT: Duration = Duration::from_secs(2);

/// One read of the library and the revision a later change must name.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub library: SourceLibrary,
    /// SHA-256 of the stored bytes, or of the empty library while none is stored.
    pub revision: String,
    /// False until the first change creates the file.
    pub stored: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    /// The library changed after the caller read the revision it named.
    Conflict,
    /// The stored library or the requested change is invalid. Nothing was written.
    Invalid(Vec<SourceDiagnostic>),
    /// The library could not be located, read, or written safely. Nothing was written.
    Storage(String),
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict => formatter.write_str(
                "the source library changed since it was read; reload it and apply the change again",
            ),
            Self::Invalid(diagnostics) => {
                for (position, diagnostic) in diagnostics.iter().enumerate() {
                    if position > 0 {
                        formatter.write_str("\n")?;
                    }
                    write!(formatter, "{LIBRARY_FILE}: {diagnostic}")?;
                }
                Ok(())
            }
            Self::Storage(message) => formatter.write_str(message),
        }
    }
}

/// Read and validate the library. An absent library is empty, and reading
/// never creates a file or directory.
pub fn load(
    root: &Path,
    contributors: &BTreeMap<String, Contributor>,
) -> Result<Snapshot, StoreError> {
    read(&library_path(root)?, contributors)
}

// Admin source management (#34) and import (#35) are the first callers of the
// changes below; until they land only tests use them.

/// Add a record whose identifier is not yet in the library.
#[cfg_attr(not(test), allow(dead_code))]
pub fn create(
    root: &Path,
    expected_revision: &str,
    record: SourceRecord,
    contributors: &BTreeMap<String, Contributor>,
) -> Result<Snapshot, StoreError> {
    change(root, expected_revision, contributors, |library| {
        if let Some(index) = library.index().position(&record.id) {
            // Scoped to the existing record, so a caller can point at it.
            return Err(vec![SourceDiagnostic {
                code: SourceDiagnosticCode::DuplicateId,
                index: Some(index),
                source_id: Some(record.id.clone()),
                field: Some("id".into()),
                message: format!(
                    "`{}` is already used by this source; edit it or choose another id",
                    record.id
                ),
            }]);
        }
        library.upsert(record.clone(), contributors)
    })
    .map(|(snapshot, ())| snapshot)
}

/// Replace the record with the same identifier. Its kind cannot change.
#[cfg_attr(not(test), allow(dead_code))]
pub fn update(
    root: &Path,
    expected_revision: &str,
    record: SourceRecord,
    contributors: &BTreeMap<String, Contributor>,
) -> Result<Snapshot, StoreError> {
    change(root, expected_revision, contributors, |library| {
        if library.get(&record.id).is_none() {
            return Err(vec![SourceDiagnostic {
                code: SourceDiagnosticCode::UnknownSource,
                index: None,
                source_id: Some(record.id.clone()),
                field: None,
                message: format!("no source has the id `{}`", record.id),
            }]);
        }
        library.upsert(record.clone(), contributors)
    })
    .map(|(snapshot, ())| snapshot)
}

/// Remove a record that no other record depends on.
#[cfg_attr(not(test), allow(dead_code))]
pub fn remove(
    root: &Path,
    expected_revision: &str,
    id: &str,
    contributors: &BTreeMap<String, Contributor>,
) -> Result<(Snapshot, SourceRecord), StoreError> {
    change(root, expected_revision, contributors, |library| {
        library.remove(id, contributors)
    })
}

/// Apply one edit while holding the library lock. The edit sees the library
/// as stored, and nothing is written unless the stored revision matches, the
/// stored library is valid, and the edited library is valid. While nothing is
/// stored the edit is first tried without the lock, so a refused change never
/// creates private directories either.
#[cfg_attr(not(test), allow(dead_code))]
fn change<T>(
    root: &Path,
    expected_revision: &str,
    contributors: &BTreeMap<String, Contributor>,
    edit: impl Fn(&mut SourceLibrary) -> Result<T, Vec<SourceDiagnostic>>,
) -> Result<(Snapshot, T), StoreError> {
    change_using(root, expected_revision, contributors, edit, |from, to| {
        fs::rename(from, to)
    })
}

#[cfg_attr(not(test), allow(dead_code))]
fn change_using<T>(
    root: &Path,
    expected_revision: &str,
    contributors: &BTreeMap<String, Contributor>,
    edit: impl Fn(&mut SourceLibrary) -> Result<T, Vec<SourceDiagnostic>>,
    rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(Snapshot, T), StoreError> {
    let path = library_path(root)?;
    let directory = path
        .parent()
        .ok_or_else(|| StoreError::Storage("the source library has no directory".into()))?;
    if !directory.is_dir() {
        let mut library = checked(read(&path, contributors)?, expected_revision)?;
        edit(&mut library).map_err(StoreError::Invalid)?;
        create_private_directory(directory)?;
    }
    // Check again now that every directory exists.
    let path = library_path(root)?;
    let _lock = FileLock::acquire(lock_path(&path), "source library write", LOCK_WAIT)
        .map_err(StoreError::Storage)?;

    let mut library = checked(read(&path, contributors)?, expected_revision)?;
    let outcome = edit(&mut library).map_err(StoreError::Invalid)?;
    let text = library.to_json();
    commit(&path, text.as_bytes(), rename)?;
    remove_interrupted_writes(&path);
    Ok((
        Snapshot {
            library,
            revision: revision(text.as_bytes()),
            stored: true,
        },
        outcome,
    ))
}

/// The library a change may edit: the one read, if it is the revision named.
#[cfg_attr(not(test), allow(dead_code))]
fn checked(current: Snapshot, expected_revision: &str) -> Result<SourceLibrary, StoreError> {
    if current.revision != expected_revision {
        return Err(StoreError::Conflict);
    }
    Ok(current.library)
}

fn read(path: &Path, contributors: &BTreeMap<String, Contributor>) -> Result<Snapshot, StoreError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let library = SourceLibrary::default();
            return Ok(Snapshot {
                revision: revision(library.to_json().as_bytes()),
                library,
                stored: false,
            });
        }
        Err(error) => {
            return Err(StoreError::Storage(format!(
                "cannot inspect {LIBRARY_FILE}: {error}"
            )))
        }
    };
    if metadata.file_type().is_symlink() {
        return Err(StoreError::Storage(format!(
            "{LIBRARY_FILE} is a symlink; replace it with a regular file"
        )));
    }
    if !metadata.is_file() {
        return Err(StoreError::Storage(format!(
            "{LIBRARY_FILE} is not a regular file"
        )));
    }
    if metadata.len() > MAX_LIBRARY_BYTES as u64 {
        return Err(StoreError::Invalid(vec![too_large()]));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| {
            file.take(MAX_LIBRARY_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
        })
        .map_err(|error| StoreError::Storage(format!("cannot read {LIBRARY_FILE}: {error}")))?;
    if bytes.len() > MAX_LIBRARY_BYTES {
        return Err(StoreError::Invalid(vec![too_large()]));
    }
    let revision = revision(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| {
        StoreError::Invalid(vec![library_diagnostic(
            SourceDiagnosticCode::InvalidJson,
            "the library is not valid UTF-8".into(),
        )])
    })?;
    let library = SourceLibrary::parse(&text, contributors).map_err(StoreError::Invalid)?;
    Ok(Snapshot {
        library,
        revision,
        stored: true,
    })
}

fn library_diagnostic(code: SourceDiagnosticCode, message: String) -> SourceDiagnostic {
    SourceDiagnostic {
        code,
        index: None,
        source_id: None,
        field: None,
        message,
    }
}

fn too_large() -> SourceDiagnostic {
    library_diagnostic(
        SourceDiagnosticCode::TooLarge,
        format!("the library is larger than {MAX_LIBRARY_BYTES} bytes"),
    )
}

fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn library_path(root: &Path) -> Result<PathBuf, StoreError> {
    contained(root, Path::new(LIBRARY_FILE))
}

/// Resolve a private path below `root` without trusting the filesystem: the
/// path must be relative and plain, and no existing component may be a
/// symlink or junction, so the library can never be read from or written to
/// another place such as `static/` or a directory outside the project.
fn contained(root: &Path, relative: &Path) -> Result<PathBuf, StoreError> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(StoreError::Storage(format!(
            "{} must be a plain path inside the project",
            relative.display()
        )));
    }
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(StoreError::Storage(format!(
                    "{} is a symlink; private research storage only uses real directories inside the project",
                    current.strip_prefix(root).unwrap_or(&current).display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(StoreError::Storage(format!(
                    "cannot inspect {}: {error}",
                    current.display()
                )))
            }
        }
    }
    Ok(root.join(relative))
}

#[cfg_attr(not(test), allow(dead_code))]
fn create_private_directory(directory: &Path) -> Result<(), StoreError> {
    fs::create_dir_all(directory).map_err(|error| {
        StoreError::Storage(format!(
            "cannot create the private research directory: {error}"
        ))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).map_err(|error| {
            StoreError::Storage(format!(
                "cannot protect the private research directory: {error}"
            ))
        })?;
    }
    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
fn lock_path(path: &Path) -> PathBuf {
    path.with_extension("json.lock")
}

/// Write `bytes` to a new temporary file beside `path`, flush it, and rename
/// it over `path`. On any failure the temporary file is removed and `path`
/// keeps its previous contents.
#[cfg_attr(not(test), allow(dead_code))]
fn commit(
    path: &Path,
    bytes: &[u8],
    rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), StoreError> {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let temporary = path.with_extension(format!("json.{}-{unique}.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        rename(&temporary, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(StoreError::Storage(format!(
            "could not save the source library ({error}); the stored library is unchanged"
        )));
    }
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        // Best effort: the rename has already replaced the library.
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
    Ok(())
}

/// Remove temporary files left by a write interrupted before its rename. They
/// are never read, and the caller holds the lock, so none belongs to a write
/// still in progress.
#[cfg_attr(not(test), allow(dead_code))]
fn remove_interrupted_writes(path: &Path) {
    let (Some(directory), Some(name)) = (path.parent(), path.file_name()) else {
        return;
    };
    let prefix = format!("{}.", name.to_string_lossy());
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name.starts_with(&prefix)
            && file_name.ends_with(".tmp")
            && entry.file_type().is_ok_and(|kind| kind.is_file())
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openblog_core::source_library::{ResearchSourceKind, SourceRecord};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;

    fn temp_root(tag: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "openblog-sources-{tag}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn none() -> BTreeMap<String, openblog_core::contributor::Contributor> {
        BTreeMap::new()
    }

    fn record(id: &str, kind: ResearchSourceKind, of: Option<&str>) -> SourceRecord {
        SourceRecord {
            id: id.into(),
            kind,
            title: (kind != ResearchSourceKind::Reference).then(|| format!("Title of {id}")),
            creators: Vec::new(),
            language: None,
            issued: None,
            of: of.map(Into::into),
            based_on: None,
            location: None,
            identifiers: Vec::new(),
            extra: BTreeMap::new(),
        }
    }

    fn work(id: &str) -> SourceRecord {
        record(id, ResearchSourceKind::Work, None)
    }

    fn library_file(root: &Path) -> PathBuf {
        root.join(LIBRARY_FILE)
    }

    #[test]
    fn an_absent_library_loads_empty_without_creating_private_directories() {
        let root = temp_root("absent");
        let snapshot = load(&root, &none()).unwrap();
        assert!(snapshot.library.sources.is_empty());
        assert!(!snapshot.stored);
        assert!(!snapshot.revision.is_empty());
        assert!(!root.join(".openblog").exists(), "reading never writes");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn create_writes_canonical_bytes_and_returns_the_next_revision() {
        let root = temp_root("create");
        let empty = load(&root, &none()).unwrap();
        let created = create(&root, &empty.revision, work("plato-republic"), &none()).unwrap();
        assert!(created.stored);
        assert_ne!(created.revision, empty.revision);

        let bytes = fs::read_to_string(library_file(&root)).unwrap();
        assert_eq!(bytes, created.library.to_json(), "stored form is canonical");
        let reloaded = load(&root, &none()).unwrap();
        assert_eq!(reloaded.library, created.library);
        assert_eq!(reloaded.revision, created.revision);
        assert!(reloaded.library.get("plato-republic").is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn identical_changes_produce_identical_files_and_revisions() {
        let first = temp_root("deterministic-a");
        let second = temp_root("deterministic-b");
        for root in [&first, &second] {
            let empty = load(root, &none()).unwrap();
            let next = create(root, &empty.revision, work("w"), &none()).unwrap();
            create(
                root,
                &next.revision,
                record("e", ResearchSourceKind::Edition, Some("w")),
                &none(),
            )
            .unwrap();
        }
        assert_eq!(
            fs::read(library_file(&first)).unwrap(),
            fs::read(library_file(&second)).unwrap()
        );
        assert_eq!(
            load(&first, &none()).unwrap().revision,
            load(&second, &none()).unwrap().revision
        );
        fs::remove_dir_all(first).unwrap();
        fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn a_write_based_on_a_stale_revision_is_refused_and_changes_nothing() {
        let root = temp_root("stale");
        let empty = load(&root, &none()).unwrap();
        create(&root, &empty.revision, work("first"), &none()).unwrap();
        let before = fs::read(library_file(&root)).unwrap();

        let stale = create(&root, &empty.revision, work("second"), &none()).unwrap_err();
        assert_eq!(stale, StoreError::Conflict);
        let stale = remove(&root, "not-a-revision", "first", &none()).unwrap_err();
        assert_eq!(stale, StoreError::Conflict);
        assert_eq!(fs::read(library_file(&root)).unwrap(), before);

        // An edit made outside open.blog also changes the revision.
        let current = load(&root, &none()).unwrap();
        fs::write(
            library_file(&root),
            current
                .library
                .to_json()
                .replace("Title of first", "Edited by hand"),
        )
        .unwrap();
        let outside = update(&root, &current.revision, work("first"), &none()).unwrap_err();
        assert_eq!(outside, StoreError::Conflict);
        assert!(fs::read_to_string(library_file(&root))
            .unwrap()
            .contains("Edited by hand"));
        fs::remove_dir_all(root).unwrap();
    }

    fn store(root: &Path, contents: &[u8]) {
        let path = library_file(root);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn codes(error: &StoreError) -> Vec<SourceDiagnosticCode> {
        match error {
            StoreError::Invalid(diagnostics) => diagnostics.iter().map(|d| d.code).collect(),
            other => panic!("expected diagnostics, got {other:?}"),
        }
    }

    /// Every change is refused and the stored bytes stay exactly as they were.
    fn assert_every_change_refused(root: &Path, revision: &str, expected: &StoreError) {
        let before = fs::read(library_file(root)).unwrap();
        let attempts = [
            create(root, revision, work("new"), &none()).unwrap_err(),
            update(root, revision, work("w"), &none()).unwrap_err(),
            remove(root, revision, "w", &none()).unwrap_err(),
        ];
        for error in attempts {
            assert_eq!(&error, expected);
        }
        assert_eq!(fs::read(library_file(root)).unwrap(), before);
    }

    #[test]
    fn corrupt_stored_libraries_are_reported_and_never_overwritten() {
        let cases: [(&str, &[u8], SourceDiagnosticCode); 5] = [
            (
                "truncated",
                br#"{"version":1,"sources":[{"id":"w","kind":"wo"#,
                SourceDiagnosticCode::InvalidJson,
            ),
            ("not-utf8", b"{\"version\":1,\xff}", SourceDiagnosticCode::InvalidJson),
            ("not-object", b"[]", SourceDiagnosticCode::InvalidField),
            (
                "duplicate",
                br#"{"version":1,"sources":[{"id":"w","kind":"work","title":"A"},{"id":"w","kind":"work","title":"B"}]}"#,
                SourceDiagnosticCode::DuplicateId,
            ),
            (
                "credit-sidecar",
                br#"{"credits":[{"contributor":"ada","roles":["author"]}]}"#,
                SourceDiagnosticCode::ContributorCredit,
            ),
        ];
        for (tag, contents, code) in cases {
            let root = temp_root(tag);
            store(&root, contents);
            let error = load(&root, &none()).unwrap_err();
            assert!(codes(&error).contains(&code), "{tag}: {error:?}");
            assert!(
                error.to_string().starts_with(LIBRARY_FILE),
                "{tag}: {error}"
            );
            // A corrupt library has no revision a caller could name, so even
            // the revision of an empty library cannot replace it.
            let empty = revision(SourceLibrary::default().to_json().as_bytes());
            let current = revision(contents);
            for attempt in [empty, current] {
                assert_every_change_refused(&root, &attempt, &error);
            }
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn a_refused_first_change_creates_no_private_directories() {
        let root = temp_root("refused-first");
        let empty = load(&root, &none()).unwrap();
        let stale = remove(&root, "x", "bogus", &none()).unwrap_err();
        assert_eq!(stale, StoreError::Conflict);
        let invalid = record("e", ResearchSourceKind::Edition, Some("missing"));
        assert!(matches!(
            create(&root, &empty.revision, invalid, &none()),
            Err(StoreError::Invalid(_))
        ));
        assert!(matches!(
            update(&root, &empty.revision, work("absent"), &none()),
            Err(StoreError::Invalid(_))
        ));
        assert!(!root.join(".openblog").exists());
        // An accepted first change still creates them.
        create(&root, &empty.revision, work("w"), &none()).unwrap();
        assert!(library_file(&root).is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_byte_order_mark_from_a_windows_editor_is_accepted() {
        let root = temp_root("bom");
        let contents = b"\xEF\xBB\xBF{\"version\":1,\"sources\":[{\"id\":\"w\",\"kind\":\"work\",\"title\":\"A\"}]}";
        store(&root, contents);
        let current = load(&root, &none()).unwrap();
        assert!(current.library.get("w").is_some());
        assert_eq!(
            current.revision,
            revision(contents),
            "revision covers the raw bytes"
        );
        let next = create(&root, &current.revision, work("x"), &none()).unwrap();
        assert_eq!(next.library.sources.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn oversized_libraries_are_rejected_before_they_are_read() {
        let root = temp_root("oversized");
        let mut contents = br#"{"version":1,"sources":[],"padding":""#.to_vec();
        contents.resize(MAX_LIBRARY_BYTES + 16, b'x');
        contents.extend_from_slice(b"\"}");
        store(&root, &contents);
        let error = load(&root, &none()).unwrap_err();
        assert_eq!(codes(&error), [SourceDiagnosticCode::TooLarge]);
        assert_every_change_refused(&root, &revision(&contents), &error);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn newer_library_versions_are_refused_rather_than_migrated_or_replaced() {
        let root = temp_root("newer");
        let newer = br#"{"version":2,"sources":[],"shelves":["future data"]}"#;
        store(&root, newer);
        let error = load(&root, &none()).unwrap_err();
        assert_eq!(codes(&error), [SourceDiagnosticCode::UnsupportedVersion]);
        assert_every_change_refused(&root, &revision(newer), &error);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hand_written_libraries_keep_unknown_fields_and_unicode_through_changes() {
        let root = temp_root("lossless");
        let authored = r#"{
  "version": 1,
  "exportedBy": {"tool": "future-open.blog"},
  "sources": [
    {"id": "w", "kind": "work", "title": "Πολιτεία — 理想国 — الجمهورية 🏛️", "language": "grc",
     "subjects": ["justice"], "creators": [{"name": "Πλάτων", "sortName": "Plato"}]},
    {"id": "e", "kind": "edition", "of": "w", "title": "Edition", "publisher": {"name": "OUP"}}
  ]
}"#;
        store(&root, authored.as_bytes());
        let current = load(&root, &none()).unwrap();
        let mut edition = current.library.get("e").unwrap().clone();
        edition.issued = Some("2003".into());
        let next = update(&root, &current.revision, edition, &none()).unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(library_file(&root)).unwrap()).unwrap();
        let mut expected: serde_json::Value = serde_json::from_str(authored).unwrap();
        expected["sources"][1]["issued"] = "2003".into();
        assert_eq!(written, expected, "only the edited field changed");
        assert_eq!(
            next.library.get("w").unwrap().title.as_deref(),
            Some("Πολιτεία — 理想国 — الجمهورية 🏛️")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn crud_rejects_duplicates_missing_records_kind_changes_and_needed_records() {
        let root = temp_root("crud");
        let empty = load(&root, &none()).unwrap();
        let first = create(&root, &empty.revision, work("w"), &none()).unwrap();
        let second = create(
            &root,
            &first.revision,
            record("e", ResearchSourceKind::Edition, Some("w")),
            &none(),
        )
        .unwrap();
        let before = fs::read(library_file(&root)).unwrap();

        let duplicate = create(&root, &second.revision, work("w"), &none()).unwrap_err();
        assert_eq!(codes(&duplicate), [SourceDiagnosticCode::DuplicateId]);
        let StoreError::Invalid(diagnostics) = &duplicate else {
            unreachable!()
        };
        assert_eq!(
            diagnostics[0].index,
            Some(0),
            "points at the existing source"
        );
        assert!(
            duplicate.to_string().contains("sources[0] `w` id:"),
            "{duplicate}"
        );
        let missing = update(&root, &second.revision, work("absent"), &none()).unwrap_err();
        assert_eq!(codes(&missing), [SourceDiagnosticCode::UnknownSource]);
        assert!(
            missing.to_string().contains("source `absent`:"),
            "{missing}"
        );
        let kind = update(
            &root,
            &second.revision,
            record("w", ResearchSourceKind::Witness, Some("e")),
            &none(),
        )
        .unwrap_err();
        assert_eq!(codes(&kind), [SourceDiagnosticCode::KindChanged]);
        let needed = remove(&root, &second.revision, "w", &none()).unwrap_err();
        assert_eq!(
            codes(&needed),
            [SourceDiagnosticCode::UnresolvedRelationship]
        );
        assert_eq!(fs::read(library_file(&root)).unwrap(), before);

        let (after, removed) = remove(&root, &second.revision, "e", &none()).unwrap();
        assert_eq!(removed.id, "e");
        assert_eq!(after.library.sources.len(), 1);
        assert_eq!(load(&root, &none()).unwrap(), after);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_changes_are_scoped_to_the_source_and_field() {
        let root = temp_root("scoped");
        let empty = load(&root, &none()).unwrap();
        let current = create(&root, &empty.revision, work("w"), &none()).unwrap();
        let before = fs::read(library_file(&root)).unwrap();

        let unresolved = record("e", ResearchSourceKind::Edition, Some("missing-work"));
        let mut unsafe_url = record("e", ResearchSourceKind::Edition, Some("w"));
        unsafe_url
            .identifiers
            .push(openblog_core::source_library::SourceIdentifier {
                scheme: "url".into(),
                value: "javascript:alert(1)".into(),
                extra: BTreeMap::new(),
            });
        for (bad, field) in [(unresolved, "of"), (unsafe_url, "identifiers[0]")] {
            let StoreError::Invalid(diagnostics) =
                create(&root, &current.revision, bad, &none()).unwrap_err()
            else {
                panic!("expected diagnostics");
            };
            assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
            assert_eq!(diagnostics[0].index, Some(1));
            assert_eq!(diagnostics[0].source_id.as_deref(), Some("e"));
            assert_eq!(diagnostics[0].field.as_deref(), Some(field));
            assert_eq!(fs::read(library_file(&root)).unwrap(), before);
        }
        assert_eq!(load(&root, &none()).unwrap().revision, current.revision);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn traversal_is_rejected_in_paths_and_identifiers() {
        let root = temp_root("traversal");
        for relative in [
            "../outside/sources.json",
            "./sources.json",
            "",
            "/sources.json",
        ] {
            assert!(
                matches!(
                    contained(&root, Path::new(relative)),
                    Err(StoreError::Storage(_))
                ),
                "{relative}"
            );
        }
        #[cfg(windows)]
        assert!(contained(&root, Path::new(r"C:\sources.json")).is_err());

        let empty = load(&root, &none()).unwrap();
        for id in ["../escape", "..", "a/../../b", r"..\..\b"] {
            let error = create(&root, &empty.revision, work(id), &none()).unwrap_err();
            assert_eq!(codes(&error), [SourceDiagnosticCode::InvalidId], "{id}");
            let error = remove(&root, &empty.revision, id, &none()).unwrap_err();
            assert_eq!(codes(&error), [SourceDiagnosticCode::UnknownSource], "{id}");
        }
        assert!(!library_file(&root).exists());
        assert!(!root.join("escape").exists() && !root.parent().unwrap().join("b").exists());
        assert!(
            !root.join(".openblog").exists(),
            "a refused change creates no private directories"
        );
        fs::remove_dir_all(root).unwrap();
    }

    /// Create a symlink, or report that this platform or account cannot.
    fn try_symlink(target: &Path, link: &Path, directory: bool) -> bool {
        #[cfg(unix)]
        {
            let _ = directory;
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            if directory {
                std::os::windows::fs::symlink_dir(target, link).is_ok()
            } else {
                std::os::windows::fs::symlink_file(target, link).is_ok()
            }
        }
    }

    #[test]
    fn symlinks_cannot_redirect_the_library_outside_private_storage() {
        let base = temp_root("symlink");
        let outside = base.join("outside");
        fs::create_dir_all(&outside).unwrap();
        let planted = br#"{"version":1,"sources":[{"id":"w","kind":"work","title":"Outside"}]}"#;
        fs::write(outside.join("sources.json"), planted).unwrap();

        // A symlinked directory, such as research -> static/research.
        let root = base.join("linked-directory");
        fs::create_dir_all(root.join(".openblog/private")).unwrap();
        if !try_symlink(&outside, &root.join(".openblog/private/research"), true) {
            eprintln!("skipping: this account cannot create symlinks");
            fs::remove_dir_all(base).unwrap();
            return;
        }
        assert!(matches!(load(&root, &none()), Err(StoreError::Storage(_))));
        let revision = revision(planted);
        assert!(matches!(
            create(&root, &revision, work("x"), &none()),
            Err(StoreError::Storage(_))
        ));

        // A symlinked library file.
        let root = base.join("linked-file");
        fs::create_dir_all(root.join(".openblog/private/research")).unwrap();
        assert!(try_symlink(
            &outside.join("sources.json"),
            &library_file(&root),
            false
        ));
        let error = load(&root, &none()).unwrap_err();
        assert!(error.to_string().contains("symlink"), "{error}");
        assert!(matches!(
            update(&root, &revision, work("w"), &none()),
            Err(StoreError::Storage(_))
        ));

        assert_eq!(fs::read(outside.join("sources.json")).unwrap(), planted);
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
        fs::remove_dir_all(base).unwrap();
    }

    /// Junctions need no special privilege on Windows, so this always runs there.
    #[cfg(windows)]
    #[test]
    fn junctions_cannot_redirect_the_library_outside_private_storage() {
        let base = temp_root("junction");
        let outside = base.join("outside");
        fs::create_dir_all(&outside).unwrap();
        let planted = br#"{"version":1,"sources":[{"id":"w","kind":"work","title":"Outside"}]}"#;
        fs::write(outside.join("sources.json"), planted).unwrap();
        let root = base.join("project");
        fs::create_dir_all(root.join(".openblog/private")).unwrap();
        // cmd reads a forward slash as a switch, so the path uses backslashes.
        let link = root.join(".openblog").join("private").join("research");
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J failed: {status:?}");

        assert!(matches!(load(&root, &none()), Err(StoreError::Storage(_))));
        assert!(matches!(
            create(&root, &revision(planted), work("x"), &none()),
            Err(StoreError::Storage(_))
        ));
        assert_eq!(fs::read(outside.join("sources.json")).unwrap(), planted);
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
        fs::remove_dir(&link).unwrap();
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn an_interrupted_write_leaves_the_library_unchanged_and_is_cleaned_up() {
        let root = temp_root("interrupted");
        let empty = load(&root, &none()).unwrap();
        let current = create(&root, &empty.revision, work("w"), &none()).unwrap();
        let before = fs::read(library_file(&root)).unwrap();

        let failed = change_using(
            &root,
            &current.revision,
            &none(),
            |library| library.upsert(work("x"), &none()),
            |_, _| Err(std::io::Error::other("power lost")),
        )
        .unwrap_err();
        assert!(
            matches!(&failed, StoreError::Storage(message) if message.contains("unchanged")),
            "{failed:?}"
        );
        assert_eq!(fs::read(library_file(&root)).unwrap(), before);
        let directory = library_file(&root).parent().unwrap().to_path_buf();
        let names = || -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&directory)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        };
        assert_eq!(
            names(),
            ["sources.json"],
            "no temporary file or lock is left"
        );

        // A crash after the temporary file was written but before the rename.
        fs::write(
            directory.join("sources.json.999-1.tmp"),
            b"{\"version\":1,\"sour",
        )
        .unwrap();
        assert_eq!(load(&root, &none()).unwrap().revision, current.revision);
        let next = create(&root, &current.revision, work("x"), &none()).unwrap();
        assert_eq!(next.library.sources.len(), 2);
        assert_eq!(names(), ["sources.json"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_lock_left_by_a_crashed_writer_blocks_changes_with_a_recovery_hint() {
        let root = temp_root("stale-lock");
        let empty = load(&root, &none()).unwrap();
        let current = create(&root, &empty.revision, work("w"), &none()).unwrap();
        let before = fs::read(library_file(&root)).unwrap();
        let lock = lock_path(&library_file(&root));
        fs::write(&lock, "pid=1 action=source-library-write\n").unwrap();

        let error = create(&root, &current.revision, work("x"), &none()).unwrap_err();
        assert!(
            matches!(&error, StoreError::Storage(message) if message.contains("remove") && message.contains("sources.json.lock")),
            "{error:?}"
        );
        assert_eq!(fs::read(library_file(&root)).unwrap(), before);
        assert_eq!(
            load(&root, &none()).unwrap().revision,
            current.revision,
            "reads never wait"
        );
        fs::remove_file(lock).unwrap();
        create(&root, &current.revision, work("x"), &none()).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_writers_never_lose_an_update() {
        let root = temp_root("concurrent");
        let empty = load(&root, &none()).unwrap();

        // Two writers that read the same revision: exactly one wins.
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let racers: Vec<_> = ["left", "right"]
            .into_iter()
            .map(|id| {
                let (root, revision, barrier) =
                    (root.clone(), empty.revision.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    create(&root, &revision, work(id), &none())
                })
            })
            .collect();
        let outcomes: Vec<_> = racers.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
        assert!(outcomes.contains(&Err(StoreError::Conflict)));

        // Writers that reload after a conflict all land.
        let writers: Vec<_> = (0..6)
            .map(|n| {
                let root = root.clone();
                std::thread::spawn(move || loop {
                    let current = load(&root, &none()).unwrap();
                    match create(&root, &current.revision, work(&format!("w{n}")), &none()) {
                        Err(StoreError::Conflict) => continue,
                        other => return other.map(|_| ()),
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap().unwrap();
        }
        let library = load(&root, &none()).unwrap().library;
        assert_eq!(library.sources.len(), 7);
        for n in 0..6 {
            assert!(library.get(&format!("w{n}")).is_some());
        }
        fs::remove_dir_all(root).unwrap();
    }
}

//! Small filesystem helpers (no dependencies).

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// All files under `dir`, recursively, sorted for deterministic builds.
/// A missing directory yields an empty list.
pub fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    walk_into(dir, &mut files);
    files.sort();
    files
}

fn walk_into(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_into(&path, out);
        } else {
            out.push(path);
        }
    }
}

/// `path` relative to `base`, with forward slashes.
pub fn relative(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn write_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    // Skip identical writes so a dev server's file watcher stays quiet.
    if let Ok(existing) = fs::read(path) {
        if existing == contents {
            return Ok(());
        }
    }
    fs::write(path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

/// Publish a complete new file without replacing an existing destination.
pub fn write_new_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("export destination has no parent directory")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("cannot resolve {}: {error}", parent.display()))?;
    let target = parent.join(
        path.file_name()
            .ok_or("export destination needs a filename")?,
    );
    let token = crate::auth::random_token()?;
    let temporary = parent.join(format!(".openblog-export-{token}.tmp"));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("cannot stage export {}: {error}", temporary.display()))?;
    let result = (|| {
        file.write_all(contents)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("cannot stage export {}: {error}", path.display()))?;
        drop(file);
        // A same-directory hard link is an atomic, no-replace publication on
        // supported filesystems. Rename would overwrite on Unix.
        fs::hard_link(&temporary, &target).map_err(|error| {
            format!(
                "cannot publish export {} without overwriting: {error}",
                path.display()
            )
        })
    })();
    let cleanup = fs::remove_file(&temporary).map_err(|error| {
        format!(
            "cannot remove export staging file {}: {error}",
            temporary.display()
        )
    });
    match (result, cleanup) {
        (Err(error), Err(cleanup)) => Err(format!("{error}; {cleanup}")),
        (Err(error), _) => Err(error),
        (Ok(()), Err(cleanup)) => Err(format!("export was published, but {cleanup}")),
        (Ok(()), Ok(())) => Ok(()),
    }
}

/// Newest modification time and file count under the given paths; changes
/// whenever a file is added, removed, or edited.
pub fn fingerprint(paths: &[PathBuf]) -> (usize, Option<SystemTime>) {
    let mut count = 0;
    let mut newest: Option<SystemTime> = None;
    for root in paths {
        let files = if root.is_dir() {
            walk(root)
        } else {
            vec![root.clone()]
        };
        for file in files {
            if let Ok(meta) = fs::metadata(&file) {
                count += 1;
                if let Ok(modified) = meta.modified() {
                    newest = Some(newest.map_or(modified, |n| n.max(modified)));
                }
            }
        }
    }
    (count, newest)
}

/// Remove files under `dir` that are not in `keep` (relative, forward-slash
/// paths), then prune empty directories. Used to clean stale build output
/// without deleting the directory, so a running dev server never sees a gap.
pub fn remove_stale(dir: &Path, keep: &HashSet<String>) {
    for file in walk(dir) {
        let rel = relative(dir, &file);
        if rel != MARKER && !keep.contains(&rel) {
            let _ = fs::remove_file(&file);
        }
    }
    prune_empty(dir, true);
}

fn prune_empty(dir: &Path, is_root: bool) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            prune_empty(&path, false);
        }
    }
    if !is_root
        && fs::read_dir(dir)
            .map(|mut e| e.next().is_none())
            .unwrap_or(false)
    {
        let _ = fs::remove_dir(dir);
    }
}

/// The project's `.openblog` directory: logins, analytics, trash, and private
/// research. Files inside it, or symlinks that resolve into it, are never
/// public build input.
pub struct PrivateState(Option<PathBuf>);

impl PrivateState {
    pub fn of(root: &Path) -> Self {
        Self(fs::canonicalize(root.join(".openblog")).ok())
    }

    pub fn contains(&self, path: &Path) -> bool {
        let Some(private) = &self.0 else {
            return false;
        };
        // A path that cannot be resolved keeps failing where it is read.
        fs::canonicalize(path).is_ok_and(|path| path.starts_with(private))
    }
}

/// Marker file proving the output directory belongs to open.blog, so a
/// misconfigured `paths.output` can never wipe an unrelated folder.
pub const MARKER: &str = ".openblog-output";

pub fn guard_output_dir(root: &Path, out: &Path) -> Result<(), String> {
    let canonical_root =
        fs::canonicalize(root).map_err(|e| format!("cannot resolve project root: {e}"))?;
    if out.exists() {
        let canonical_out =
            fs::canonicalize(out).map_err(|e| format!("cannot resolve output dir: {e}"))?;
        if canonical_out == canonical_root || canonical_root.starts_with(&canonical_out) {
            return Err(format!(
                "refusing to use {} as the output directory because it contains the project",
                out.display()
            ));
        }
        let empty = fs::read_dir(out)
            .map(|mut e| e.next().is_none())
            .unwrap_or(false);
        if !empty && !out.join(MARKER).exists() {
            return Err(format!(
                "{} already exists and was not created by open.blog (no {MARKER} file); choose another `paths.output` or empty it",
                out.display()
            ));
        }
    }
    Ok(())
}

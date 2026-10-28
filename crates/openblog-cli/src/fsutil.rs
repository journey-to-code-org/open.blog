//! Small filesystem helpers (no dependencies).

use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

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

/// How long a file operation keeps waiting out another process that briefly holds the file.
pub const TRANSIENT_HOLD_LIMIT: Duration = Duration::from_secs(5);

/// Whether `error` is Windows refusing a file that another process briefly holds open, or that
/// is still being deleted: "access denied" (5), a sharing violation (32) or a lock violation
/// (33). Antivirus and indexing scanners and backup or sync clients open freshly written files
/// for a moment, so these clear on their own. Never true elsewhere, where they are real errors.
pub fn is_transient_hold(error: &io::Error) -> bool {
    cfg!(windows) && matches!(error.raw_os_error(), Some(5 | 32 | 33))
}

/// Run `operation` again, with backoff, while it fails with a transient hold, for at most
/// [`TRANSIENT_HOLD_LIMIT`]. Any other result, or the last error after the limit, is returned.
pub fn retry_transient<T>(mut operation: impl FnMut() -> io::Result<T>) -> io::Result<T> {
    let started = Instant::now();
    let mut pause = Duration::from_millis(1);
    loop {
        match operation() {
            Err(error) if is_transient_hold(&error) && started.elapsed() < TRANSIENT_HOLD_LIMIT => {
                std::thread::sleep(pause);
                pause = (pause * 2).min(Duration::from_millis(50));
            }
            result => return result,
        }
    }
}

/// Read a whole file that writers replace atomically. On Windows, opening it while a
/// replacement lands, or while another process briefly holds it, can fail with "access denied"
/// for a moment; that is waited out instead of being reported as unreadable.
pub fn read_to_string(path: &Path) -> io::Result<String> {
    retry_transient(|| fs::read_to_string(path))
}

/// Atomically replace `target` with the complete file at `temporary` beside it. On Windows a
/// rename fails with "access denied" while another process briefly holds either file, so that
/// is waited out instead of failing the write.
pub fn replace_file(temporary: &Path, target: &Path) -> io::Result<()> {
    retry_transient(|| fs::rename(temporary, target))
}

/// [`replace_file`] for a compare-and-swap writer. Before every retry `unchanged` must confirm
/// that `target` still holds what the caller compared, so waiting out a hold never replaces a
/// file somebody changed meanwhile. Returns `Ok(false)`, leaving `target` alone, once it does
/// not.
pub fn replace_file_if_unchanged(
    temporary: &Path,
    target: &Path,
    mut unchanged: impl FnMut() -> bool,
) -> io::Result<bool> {
    let mut first = true;
    let mut changed = false;
    retry_transient(|| {
        if !std::mem::take(&mut first) && !unchanged() {
            changed = true;
            return Ok(());
        }
        fs::rename(temporary, target)
    })?;
    Ok(!changed)
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
        retry_transient(|| fs::hard_link(&temporary, &target)).map_err(|error| {
            format!(
                "cannot publish export {} without overwriting: {error}",
                path.display()
            )
        })
    })();
    let cleanup = retry_transient(|| fs::remove_file(&temporary)).map_err(|error| {
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
///
/// [`PrivateState::withhold`] adds author-written folders that hold material a
/// page may only reach through its projection, such as the interpretation
/// comparison files, which keep drafts and unapproved AI text beside what is
/// approved.
pub struct PrivateState(Vec<PathBuf>);

impl PrivateState {
    pub fn of(root: &Path) -> Self {
        Self(
            fs::canonicalize(root.join(".openblog"))
                .ok()
                .into_iter()
                .collect(),
        )
    }

    /// Also treats everything under `dir` (a folder that may not exist yet) as
    /// never public build input.
    pub fn withhold(mut self, dir: &Path) -> Self {
        if let Ok(dir) = fs::canonicalize(dir) {
            self.0.push(dir);
        }
        self
    }

    pub fn contains(&self, path: &Path) -> bool {
        if self.0.is_empty() {
            return false;
        }
        // A path that cannot be resolved keeps failing where it is read.
        fs::canonicalize(path).is_ok_and(|path| self.0.iter().any(|dir| path.starts_with(dir)))
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

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ob-fsutil-{name}-{}-{}",
                std::process::id(),
                crate::auth::random_token().unwrap()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn record(writer: usize, revision: usize) -> String {
        format!("{writer}:{revision}:{}", "x".repeat(8 * 1024))
    }

    fn stage(directory: &Path, contents: &str) -> PathBuf {
        let temporary = directory.join(format!(
            ".record.{}.tmp",
            crate::auth::random_token().unwrap()
        ));
        fs::write(&temporary, contents).unwrap();
        temporary
    }

    #[test]
    fn concurrent_readers_never_fail_a_replace_or_see_a_partial_file() {
        let scratch = Scratch::new("readers");
        let target = scratch.0.join("record.json");
        fs::write(&target, record(0, 0)).unwrap();
        let writing = std::sync::atomic::AtomicBool::new(true);
        std::thread::scope(|scope| {
            let readers: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        let mut reads = 0;
                        while writing.load(std::sync::atomic::Ordering::Relaxed) {
                            let text = read_to_string(&target).unwrap();
                            let mut parts = text.splitn(3, ':');
                            let (writer, revision) = (parts.next(), parts.next());
                            assert_eq!(
                                Some(text.as_str()),
                                writer
                                    .zip(revision)
                                    .and_then(|(w, r)| Some((w.parse().ok()?, r.parse().ok()?)))
                                    .map(|(w, r)| record(w, r))
                                    .as_deref(),
                                "a reader saw a partial record"
                            );
                            reads += 1;
                        }
                        reads
                    })
                })
                .collect();
            let writers: Vec<_> = (1..=2)
                .map(|writer| {
                    let (directory, target) = (&scratch.0, &target);
                    scope.spawn(move || {
                        for revision in 1..=150 {
                            let temporary = stage(directory, &record(writer, revision));
                            replace_file(&temporary, target).unwrap();
                        }
                    })
                })
                .collect();
            for writer in writers {
                writer.join().unwrap();
            }
            writing.store(false, std::sync::atomic::Ordering::Relaxed);
            for reader in readers {
                assert!(reader.join().unwrap() > 0);
            }
        });
        let last = fs::read_to_string(&target).unwrap();
        assert!(last == record(1, 150) || last == record(2, 150));
    }

    /// Opens `path` the way a scanner or sync client can: without letting anyone delete or
    /// replace it until the handle closes.
    #[cfg(windows)]
    fn hold(path: &Path) -> fs::File {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 1;
        const FILE_SHARE_WRITE: u32 = 2;
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(path)
            .unwrap()
    }

    #[cfg(windows)]
    #[test]
    fn a_briefly_held_target_is_waited_out_instead_of_failing_the_write() {
        let scratch = Scratch::new("held");
        let target = scratch.0.join("record.json");
        fs::write(&target, "before").unwrap();
        let temporary = stage(&scratch.0, "after");
        let held = hold(&target);
        // The failure this guards against: a plain rename is refused while the hold lasts.
        let refused = fs::rename(&temporary, &target).unwrap_err();
        assert!(is_transient_hold(&refused), "{refused:?}");
        std::thread::scope(|scope| {
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                drop(held);
            });
            replace_file(&temporary, &target).unwrap();
        });
        assert_eq!(fs::read_to_string(&target).unwrap(), "after");
        assert!(!temporary.exists());
    }

    #[cfg(windows)]
    #[test]
    fn waiting_out_a_hold_never_replaces_a_file_changed_meanwhile() {
        let scratch = Scratch::new("held-changed");
        let target = scratch.0.join("record.json");
        fs::write(&target, "compared").unwrap();
        let temporary = stage(&scratch.0, "stale decision");
        let mut held = hold(&target);
        std::thread::scope(|scope| {
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(50));
                held.set_len(0).unwrap();
                held.write_all(b"newer").unwrap();
                std::thread::sleep(Duration::from_millis(150));
                drop(held);
            });
            let replaced = replace_file_if_unchanged(&temporary, &target, || {
                fs::read_to_string(&target).is_ok_and(|text| text == "compared")
            })
            .unwrap();
            assert!(!replaced);
        });
        assert_eq!(fs::read_to_string(&target).unwrap(), "newer");
        assert_eq!(fs::read_to_string(&temporary).unwrap(), "stale decision");
    }

    #[test]
    fn a_real_failure_is_reported_without_waiting() {
        let scratch = Scratch::new("missing");
        let started = Instant::now();
        let error = replace_file(
            &scratch.0.join("absent.tmp"),
            &scratch.0.join("record.json"),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert!(started.elapsed() < TRANSIENT_HOLD_LIMIT);
    }
}

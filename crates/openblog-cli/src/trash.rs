//! Putting back what a write replaced (Studio R13, G97). Every write of a reading path or comparison
//! first copies the file it replaces into `.openblog/trash`, and a restore puts exactly those bytes back,
//! so an approval kept in a comparison comes back with it. Nothing here parses or builds a file: the bytes
//! are the server's own, and the name a client sends is checked to be one this server made for that item.

use std::fs;
use std::path::{Path, PathBuf};

/// Why a copy could not be kept or read back.
#[derive(Debug, PartialEq, Eq)]
pub enum TrashError {
    /// The name is not one this server made for this item (a separator, another item, an odd shape).
    BadName,
    /// No such copy.
    Gone,
    /// The folder or file could not be read or written.
    Storage(String),
}

fn folder(root: &Path) -> PathBuf {
    root.join(".openblog").join("trash")
}

/// Whether `name` is `<stamp>-<prefix>_<slug>[-<n>].json` with a stamp of plain characters: what
/// [`keep`] writes, and nothing a client could use to reach another folder or another item.
pub fn valid_name(prefix: &str, slug: &str, name: &str) -> bool {
    if name.is_empty()
        || name.len() > 200
        || name.contains(['/', '\\', '\0'])
        || name.contains("..")
    {
        return false;
    }
    let marker = format!("-{prefix}_{slug}");
    let Some(at) = name.find(&marker) else {
        return false;
    };
    let (stamp, rest) = (&name[..at], &name[at + marker.len()..]);
    if stamp.is_empty()
        || !stamp
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'T' | b'Z' | b'.' | b'+' | b'-'))
    {
        return false;
    }
    match rest.strip_suffix(".json") {
        Some("") => true,
        Some(more) => more
            .strip_prefix('-')
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())),
        None => false,
    }
}

/// Copy `source` into the trash as a replaced copy of `<prefix>/<slug>` and answer its name. The original
/// is left where it is, for the caller's own write to replace.
pub fn keep(
    root: &Path,
    source: &Path,
    prefix: &str,
    slug: &str,
    stamp: &str,
) -> Result<String, TrashError> {
    let trash = folder(root);
    fs::create_dir_all(&trash)
        .map_err(|error| TrashError::Storage(format!("cannot create the trash folder: {error}")))?;
    let mut name = format!("{stamp}-{prefix}_{slug}.json");
    let mut n = 1;
    while trash.join(&name).exists() {
        n += 1;
        name = format!("{stamp}-{prefix}_{slug}-{n}.json");
    }
    fs::copy(source, trash.join(&name))
        .map_err(|error| TrashError::Storage(format!("cannot keep the replaced copy: {error}")))?;
    Ok(name)
}

/// The bytes of a kept copy, if `name` is one made for this item.
pub fn read(root: &Path, prefix: &str, slug: &str, name: &str) -> Result<Vec<u8>, TrashError> {
    if !valid_name(prefix, slug, name) {
        return Err(TrashError::BadName);
    }
    match fs::read(folder(root).join(name)) {
        Ok(bytes) => Ok(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(TrashError::Gone),
        Err(error) => Err(TrashError::Storage(format!(
            "cannot read the kept copy: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_names_made_for_this_item_are_accepted() {
        let ok = "2026-11-14T120000Z-paths_start-here.json";
        assert!(valid_name("paths", "start-here", ok));
        assert!(valid_name(
            "paths",
            "start-here",
            "2026-11-14T120000Z-paths_start-here-3.json"
        ));
        for bad in [
            "../2026-11-14T120000Z-paths_start-here.json",
            "a/2026-11-14T120000Z-paths_start-here.json",
            "a\\2026-11-14T120000Z-paths_start-here.json",
            "2026-11-14T120000Z-paths_other.json",
            "2026-11-14T120000Z-comparisons_start-here.json",
            "2026-11-14T120000Z-paths_start-here.json.bak",
            "2026-11-14T120000Z-paths_start-here-x.json",
            "-paths_start-here.json",
            "evil-paths_start-here.json",
            "",
        ] {
            assert!(!valid_name("paths", "start-here", bad), "{bad}");
        }
        assert!(
            !valid_name("paths", "start", ok),
            "a longer slug is another item"
        );
    }

    #[test]
    fn a_kept_copy_reads_back_byte_for_byte_and_never_overwrites_another() {
        let dir = std::env::temp_dir().join(format!(
            "openblog-trash-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("x.json");
        fs::write(&source, b"first\xff").unwrap();
        let one = keep(&dir, &source, "paths", "x", "2026-11-14T120000Z").unwrap();
        fs::write(&source, b"second").unwrap();
        let two = keep(&dir, &source, "paths", "x", "2026-11-14T120000Z").unwrap();
        assert_ne!(one, two);
        assert_eq!(read(&dir, "paths", "x", &one).unwrap(), b"first\xff");
        assert_eq!(read(&dir, "paths", "x", &two).unwrap(), b"second");
        assert_eq!(
            read(&dir, "paths", "x", "2026-11-14T120000Z-paths_x-9.json"),
            Err(TrashError::Gone)
        );
        assert_eq!(read(&dir, "paths", "y", &one), Err(TrashError::BadName));
        let _ = fs::remove_dir_all(&dir);
    }
}

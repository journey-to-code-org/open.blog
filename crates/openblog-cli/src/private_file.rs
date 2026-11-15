//! Small private records kept beside the site, one per signed-in account: a file named by the
//! SHA-256 of the account's name (so a name never becomes a path), mode 0600 in a 0700 folder,
//! replaced atomically. Used by the voice invitation's dismissal and by Getting started.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The file name for `user` (`<sha256>.json`), or an error for a name that can't be an account.
pub fn user_file_name(user: &str) -> Result<String, String> {
    if user.is_empty() || user.len() > 128 || user.chars().any(char::is_control) {
        return Err("invalid admin identity".into());
    }
    Ok(format!("{:x}.json", Sha256::digest(user.as_bytes())))
}

/// `root/<folder>/<sha256(user)>.json`.
pub fn user_path(root: &Path, folder: &str, user: &str) -> Result<PathBuf, String> {
    Ok(root.join(folder).join(user_file_name(user)?))
}

/// The file's bytes, `None` when it isn't there. A link, a folder or a file over `max` is an
/// error: a private record is only ever a small regular file.
pub fn read(path: &Path, max: usize) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not inspect a private record: {error}")),
    };
    if !metadata.is_file() || metadata.len() > max as u64 {
        return Err("a private record is not a small regular file".into());
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| format!("could not read a private record: {error}"))
}

/// Write `bytes` to `path` in one step: a 0600 temporary file beside it, synced, then renamed
/// over it. The folder is created 0700.
pub fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid private record path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create a private folder: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("could not protect a private folder: {error}"))?;
    }
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        crate::fsutil::replace_file(&temporary, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("could not save a private record: {error}"));
    }
    Ok(())
}

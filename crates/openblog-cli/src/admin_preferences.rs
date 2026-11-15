//! What is left of the old Admin's per-account preferences (Personalize, retired in R15): one read.
//!
//! The files stay where the old Admin wrote them (`.openblog/private/admin-preferences/`, kept in
//! workspace backups) and nothing writes them any more. Studio reads one answer from them: whether
//! this account said "No thanks" to the voice invitation before the server kept that answer on its
//! own (R9 G64). Nothing on the server is deleted from the owner's data.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// The largest preferences file the old Admin wrote; anything bigger isn't one of its files.
const MAX_FILE_BYTES: u64 = 64 * 1024;

/// Where the old Admin kept this account's preferences.
pub fn preference_path(root: &Path, user: &str) -> Result<PathBuf, String> {
    if user.is_empty() || user.len() > 128 || user.chars().any(char::is_control) {
        return Err("invalid admin identity".into());
    }
    let identity = format!("{:x}", Sha256::digest(user.as_bytes()));
    Ok(root
        .join(".openblog")
        .join("private")
        .join("admin-preferences")
        .join(format!("{identity}.json")))
}

/// Whether this account dismissed the voice invitation in the old Admin (`voiceInvitationDismissed`).
/// Anything missing, unreadable or odd is "not dismissed": the invitation is harmless.
pub fn voice_invitation_dismissed(root: &Path, user: &str) -> bool {
    let Ok(path) = preference_path(root, user) else {
        return false;
    };
    let small =
        fs::metadata(&path).is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_FILE_BYTES);
    small
        && fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .is_some_and(|stored| stored["voiceInvitationDismissed"] == Value::Bool(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("openblog-admin-preferences-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(root: &Path, user: &str, bytes: &[u8]) {
        let path = preference_path(root, user).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn voice_invitation_carry_over_still_read() {
        let root = fixture("carry-over");
        // A file exactly as the old Admin's Personalize wrote it, with the invitation dismissed.
        write(
            &root,
            "author",
            br#"{"schemaVersion":1,"preset":"simple","density":"comfortable","editorMode":"visual","moduleOrder":["voice"],"hiddenModules":[],"voiceInvitationDismissed":true}"#,
        );
        assert!(voice_invitation_dismissed(&root, "author"));
        assert!(
            !voice_invitation_dismissed(&root, "someone-else"),
            "one account's answer is its own"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn anything_missing_or_odd_is_not_dismissed() {
        let root = fixture("odd");
        assert!(!voice_invitation_dismissed(&root, "author"), "no file");
        write(&root, "author", br#"{"schemaVersion":1,"preset":"simple"}"#);
        assert!(
            !voice_invitation_dismissed(&root, "author"),
            "never dismissed"
        );
        write(&root, "author", br#"{"voiceInvitationDismissed":"yes"}"#);
        assert!(!voice_invitation_dismissed(&root, "author"), "not a yes");
        write(&root, "author", b"not json");
        assert!(!voice_invitation_dismissed(&root, "author"), "not JSON");
        let mut big = br#"{"voiceInvitationDismissed":true,"x":""#.to_vec();
        big.extend(std::iter::repeat_n(b'x', MAX_FILE_BYTES as usize));
        big.extend(br#""}"#);
        write(&root, "author", &big);
        assert!(!voice_invitation_dismissed(&root, "author"), "too big");
        assert!(!voice_invitation_dismissed(&root, ""), "no account");
        fs::remove_dir_all(root).unwrap();
    }
}

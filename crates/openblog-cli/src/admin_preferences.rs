use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_FILE_BYTES: usize = 64 * 1024;
pub const OPTIONAL_MODULES: [&str; 10] = [
    "social",
    "release",
    "field",
    "optimize",
    "accessibility",
    "evidence",
    "assistant",
    "analytics",
    "contributors",
    "public-site",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspacePreset {
    Simple,
    Guided,
    Advanced,
    Custom,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceDensity {
    Comfortable,
    Compact,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorMode {
    Visual,
    Markdown,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Preferences {
    pub schema_version: u32,
    pub preset: WorkspacePreset,
    pub density: WorkspaceDensity,
    pub editor_mode: EditorMode,
    pub module_order: Vec<String>,
    pub hidden_modules: Vec<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            schema_version: 1,
            preset: WorkspacePreset::Simple,
            density: WorkspaceDensity::Comfortable,
            editor_mode: EditorMode::Visual,
            module_order: OPTIONAL_MODULES
                .iter()
                .map(|module| (*module).into())
                .collect(),
            hidden_modules: Vec::new(),
        }
    }
}

impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("unsupported admin preferences schema version".into());
        }
        if self.module_order.len() != OPTIONAL_MODULES.len() {
            return Err("module order must contain every optional module exactly once".into());
        }
        for module in OPTIONAL_MODULES {
            if self
                .module_order
                .iter()
                .filter(|item| item.as_str() == module)
                .count()
                != 1
            {
                return Err(format!("module order must contain {module} exactly once"));
            }
        }
        for module in &self.hidden_modules {
            if !OPTIONAL_MODULES.contains(&module.as_str()) {
                return Err(format!("unknown optional module: {module}"));
            }
        }
        let mut hidden = self.hidden_modules.clone();
        hidden.sort();
        hidden.dedup();
        if hidden.len() != self.hidden_modules.len() {
            return Err("hidden modules must not contain duplicates".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub preferences: Preferences,
    pub etag: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SaveError {
    Conflict,
    Storage(String),
}

impl fmt::Display for SaveError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict => write!(formatter, "admin preferences changed in another session"),
            Self::Storage(message) => formatter.write_str(message),
        }
    }
}

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

pub fn load(root: &Path, user: &str) -> Result<Snapshot, String> {
    let path = preference_path(root, user)?;
    if !path.exists() {
        return snapshot(Preferences::default());
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("could not inspect admin preferences: {error}"))?;
    if metadata.len() > MAX_FILE_BYTES as u64 {
        return Err("admin preferences file is too large".into());
    }
    let bytes =
        fs::read(&path).map_err(|error| format!("could not read admin preferences: {error}"))?;
    let preferences: Preferences = serde_json::from_slice(&bytes)
        .map_err(|error| format!("admin preferences are not valid: {error}"))?;
    preferences.validate()?;
    snapshot(preferences)
}

pub fn save(
    root: &Path,
    user: &str,
    expected_etag: &str,
    preferences: Preferences,
) -> Result<Snapshot, SaveError> {
    preferences.validate().map_err(SaveError::Storage)?;
    let current = load(root, user).map_err(SaveError::Storage)?;
    if current.etag != expected_etag {
        return Err(SaveError::Conflict);
    }

    let path = preference_path(root, user).map_err(SaveError::Storage)?;
    let parent = path
        .parent()
        .ok_or_else(|| SaveError::Storage("invalid admin preferences path".into()))?;
    fs::create_dir_all(parent).map_err(|error| {
        SaveError::Storage(format!(
            "could not create private preferences directory: {error}"
        ))
    })?;
    let bytes = serde_json::to_vec_pretty(&preferences).map_err(|error| {
        SaveError::Storage(format!("could not encode admin preferences: {error}"))
    })?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(SaveError::Storage(
            "admin preferences file is too large".into(),
        ));
    }

    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), std::io::Error> {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
        }
        fs::rename(&temporary, &path)?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(SaveError::Storage(format!(
            "could not save admin preferences: {error}"
        )));
    }
    snapshot(preferences).map_err(SaveError::Storage)
}

fn snapshot(preferences: Preferences) -> Result<Snapshot, String> {
    let canonical = serde_json::to_vec(&preferences)
        .map_err(|error| format!("could not encode admin preferences: {error}"))?;
    Ok(Snapshot {
        preferences,
        etag: format!("{:x}", Sha256::digest(canonical)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("openblog-admin-preferences-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn defaults_are_simple_but_keep_every_optional_module_reachable() {
        let preferences = Preferences::default();
        assert_eq!(preferences.schema_version, 1);
        assert_eq!(preferences.preset, WorkspacePreset::Simple);
        assert_eq!(preferences.density, WorkspaceDensity::Comfortable);
        assert_eq!(preferences.editor_mode, EditorMode::Visual);
        assert_eq!(preferences.module_order, OPTIONAL_MODULES);
        assert!(preferences.hidden_modules.is_empty());
        preferences.validate().unwrap();
    }

    #[test]
    fn validation_rejects_unknown_duplicate_and_missing_modules() {
        let mut unknown = Preferences::default();
        unknown.module_order[0] = "secrets".into();
        assert!(unknown.validate().is_err());

        let mut duplicate = Preferences::default();
        duplicate.module_order[1] = duplicate.module_order[0].clone();
        assert!(duplicate.validate().is_err());

        let mut missing = Preferences::default();
        missing.module_order.pop();
        assert!(missing.validate().is_err());

        let mut hidden_unknown = Preferences::default();
        hidden_unknown.hidden_modules.push("publish".into());
        assert!(hidden_unknown.validate().is_err());
    }

    #[test]
    fn preferences_are_private_per_user_atomic_and_conflict_safe() {
        let root = fixture("isolation");
        let initial = load(&root, "alice").unwrap();
        assert_eq!(initial.preferences.preset, WorkspacePreset::Simple);

        let mut changed = initial.preferences.clone();
        changed.preset = WorkspacePreset::Custom;
        changed.density = WorkspaceDensity::Compact;
        changed.editor_mode = EditorMode::Markdown;
        changed.hidden_modules = vec!["assistant".into(), "analytics".into()];
        changed.module_order.reverse();

        let saved = save(&root, "alice", &initial.etag, changed.clone()).unwrap();
        assert_eq!(saved.preferences, changed);
        assert_ne!(saved.etag, initial.etag);

        let mut changed_again = saved.preferences.clone();
        changed_again.density = WorkspaceDensity::Comfortable;
        let saved_again = save(&root, "alice", &saved.etag, changed_again.clone()).unwrap();
        assert_eq!(saved_again.preferences, changed_again);
        assert!(matches!(
            save(&root, "alice", &initial.etag, Preferences::default()),
            Err(SaveError::Conflict)
        ));
        assert_eq!(load(&root, "alice").unwrap(), saved_again);
        assert_eq!(
            load(&root, "bob").unwrap().preferences,
            Preferences::default()
        );

        let path = preference_path(&root, "alice").unwrap();
        assert!(!path.to_string_lossy().contains("alice"));
        assert!(path.starts_with(root.join(".openblog/private/admin-preferences")));
        assert!(!root.join("openblog.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_or_oversized_private_state_fails_without_falling_back() {
        let root = fixture("malformed");
        let path = preference_path(&root, "alice").unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{not json").unwrap();
        assert!(load(&root, "alice").unwrap_err().contains("not valid"));
        fs::write(&path, vec![b'x'; MAX_FILE_BYTES + 1]).unwrap();
        assert!(load(&root, "alice").unwrap_err().contains("too large"));
        fs::remove_dir_all(root).unwrap();
    }
}

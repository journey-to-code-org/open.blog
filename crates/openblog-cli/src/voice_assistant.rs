//! Voice samples and the voice guide as Assistant context (ADR 0350 to 0353).
//!
//! The context catalog lists samples beside the other context files, and an Assistant request names
//! them by id (`voice:<portable|private>:<file>`). The browser can only name a sample: its text is
//! always read again here, through the voice store, for every request.

use std::path::Path;

use openblog_core::voice::VoiceStage;
use serde_json::{json, Value as Json};

use crate::voice_store::{self, Listed, Visibility};

/// The most samples one Assistant request may carry.
pub const MAX_SAMPLES_PER_REQUEST: usize = 8;
/// The most sample characters one Assistant request may carry, over all its samples.
pub const MAX_CHARACTERS_PER_REQUEST: usize = 120_000;

/// The context id of a sample.
pub fn sample_id(visibility: Visibility, file: &str) -> String {
    format!("voice:{}:{file}", visibility.as_str())
}

fn stage_name(stage: Option<VoiceStage>) -> Option<&'static str> {
    stage.map(VoiceStage::as_str)
}

fn descriptor(root: &Path, listed: &Listed) -> Json {
    let characters = if listed.valid {
        voice_store::read(root, listed.visibility, &listed.file)
            .ok()
            .and_then(|loaded| loaded.sample)
            .map(|sample| sample.body.chars().count())
            .unwrap_or(0)
    } else {
        0
    };
    let directory = listed.visibility.directory();
    json!({
        "id": sample_id(listed.visibility, &listed.file),
        "kind": "voiceSample",
        "name": listed.file,
        "path": format!("{directory}/{}", listed.file),
        "visibility": listed.visibility.as_str(),
        "exists": true,
        "valid": listed.valid,
        "stage": stage_name(listed.stage),
        "pack": listed.pack,
        "prompt": listed.prompt,
        "title": listed.title,
        "words": listed.words,
        "characters": characters,
        "revision": listed.revision,
        "guidance": listed.guidance,
    })
}

/// The samples for the context catalog, in the store's order. Read only: a project without
/// samples lists nothing and gets no folder.
pub fn catalog_entries(root: &Path) -> Vec<Json> {
    voice_store::list(root)
        .iter()
        .map(|listed| descriptor(root, listed))
        .collect()
}

/// The request budget, as the browser needs it to refuse an over-budget selection before it sends
/// anything.
pub fn budget() -> Json {
    json!({
        "samples": MAX_SAMPLES_PER_REQUEST,
        "characters": MAX_CHARACTERS_PER_REQUEST,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice_store::tests_support::Project;

    #[test]
    fn a_project_without_samples_lists_nothing_and_gets_no_folder() {
        let project = Project::new();
        assert!(catalog_entries(&project.0).is_empty());
        assert!(!project.0.join("assistant/context/voice").exists());
        assert!(!project.0.join(".openblog").exists());
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! Writing samples into a throwaway project through the real store.
    use std::collections::BTreeMap;
    use std::path::Path;

    use openblog_core::voice::{self, VoiceMeta, VoiceSample, VoiceStage};

    use crate::voice_store::{self, Visibility};

    pub fn rough_sample(prompt: &str, pack: &str, day: &str, body: &str) -> VoiceSample {
        VoiceSample {
            title: prompt.replace('-', " "),
            subtitle: None,
            slug: prompt.to_string(),
            date: format!("{day}T09:30:00Z"),
            description: None,
            tags: Vec::new(),
            voice: VoiceMeta {
                catalog: 1,
                pack: pack.to_string(),
                prompt: prompt.to_string(),
                stage: VoiceStage::Rough,
                time_limit_seconds: 180,
                words: voice::count_words(body),
                rough_of: None,
            },
            body: body.to_string(),
            extra: BTreeMap::new(),
        }
    }

    /// Lock a rough draft through the store (it opens and closes the session record itself) and
    /// return its file name.
    pub fn write_rough(
        root: &Path,
        visibility: Visibility,
        prompt: &str,
        pack: &str,
        day: &str,
        body: &str,
    ) -> String {
        let path = root.join(voice_store::SESSION_PATH);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            format!(
                r#"{{"format":"{}","version":1,"promptId":"{prompt}"}}"#,
                voice_store::SESSION_FORMAT
            ),
        )
        .unwrap();
        let written =
            voice_store::write_rough(root, visibility, &rough_sample(prompt, pack, day, body))
                .unwrap();
        std::fs::remove_file(path).unwrap();
        written.file
    }
}

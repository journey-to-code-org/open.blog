use openblog_core::audio::{FileEvidence, FileReader};
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};

fn load(draft: bool) -> Result<Site, Vec<String>> {
    let post = format!(
        "---\ntitle: Episode\ndate: 2026-01-01\ndraft: {draft}\naudio:\n  version: 1\n  durationSeconds: 120\n  sources:\n    - url: /episode.mp3\n      type: audio/mpeg\n      sizeBytes: 20\n---\n## Transcript\n\nWords.\n"
    );
    Site::load(
        SiteConfig::default(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/episode.md".into(),
                contents: post,
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
}

#[test]
fn audio_without_file_evidence_cannot_be_published() {
    let errors = load(false).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("verification is unavailable")),
        "{errors:?}"
    );
    let site = load(true).unwrap();
    assert!(
        site.warnings
            .iter()
            .any(|warning| warning.contains("audio is not published while the post is a draft")),
        "{:?}",
        site.warnings
    );
}

#[test]
fn verified_episode_renders_player_chapters_and_script() {
    let post = "---\ntitle: Episode & more\ndate: 2026-01-01\naudio:\n  version: 1\n  durationSeconds: 30\n  sources:\n    - url: /a.mp3\n      type: audio/mpeg\n      sizeBytes: 123\n  chapters:\n    - timeSeconds: 3\n      title: Intro & more\n---\n## Transcript\n\nWords.\n";
    let reader = FileReader::new(|path, limit| {
        assert_eq!(path, "/a.mp3");
        assert_eq!(limit, 64);
        Ok(FileEvidence {
            size_bytes: 123,
            bytes: b"ID3".to_vec(),
        })
    });
    let site = Site::load(
        SiteConfig::default(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/episode.md".into(),
                contents: post.into(),
            }],
            audio_files: Some(reader),
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let page = files
        .iter()
        .find(|f| f.path == "posts/episode/index.html")
        .unwrap();
    assert!(
        page.contents.contains("<audio controls preload=\"none\""),
        "{}",
        page.contents
    );
    assert!(!page.contents.contains("autoplay"));
    assert!(page
        .contents
        .contains("data-audio-time=\"3\">Intro &amp; more</button>"));
    assert!(page.contents.contains("/assets/components/ob-episode.js"));
    assert!(files
        .iter()
        .any(|f| f.path == "assets/components/ob-episode.js"));
}

#[test]
fn missing_transcript_names_the_fix_before_audio_can_be_published() {
    let post = "---\ntitle: Episode\ndate: 2026-01-01\naudio:\n  version: 1\n  durationSeconds: 30\n  sources:\n    - url: /a.mp3\n      type: audio/mpeg\n      sizeBytes: 123\n---\nWords, but no transcript section.\n";
    let result = Site::load(
        SiteConfig::default(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/episode.md".into(),
                contents: post.into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    );
    let errors = result.unwrap_err().join("\n");
    assert!(
        errors.contains("needs a nonempty Transcript section"),
        "{errors}"
    );
}

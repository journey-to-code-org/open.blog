use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

struct Project(PathBuf);

impl Project {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "openblog-audio-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("content/posts")).unwrap();
        fs::create_dir_all(path.join("static/audio")).unwrap();
        fs::write(
            path.join("openblog.json"),
            r#"{"title":"Audio","url":"https://example.test"}"#,
        )
        .unwrap();
        Self(path)
    }

    fn post(&self, draft: bool, transcript: &str) {
        fs::write(self.0.join("content/posts/episode.md"), format!(
            "---\ntitle: Episode\ndate: 2026-01-01\ndraft: {draft}\naudio:\n  version: 1\n  durationSeconds: 30\n  sources:\n    - url: /audio/one.mp3\n      type: audio/mpeg\n      sizeBytes: 12\n  chapters:\n    - timeSeconds: 5\n      title: Part one\n---\n{transcript}\n"
        )).unwrap();
    }

    fn run(&self, command: &str) -> Output {
        Command::new(env!("CARGO_BIN_EXE_openblog"))
            .args([command, "--root"])
            .arg(&self.0)
            .env_remove("OPENBLOG_WORKSPACE")
            .output()
            .unwrap()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn audio(root: &Path, bytes: &[u8]) {
    fs::write(root.join("static/audio/one.mp3"), bytes).unwrap();
}

#[test]
fn check_and_build_require_real_audio_and_transcript() {
    let project = Project::new();
    project.post(false, "## Transcript\n\nHello.");
    let missing = project.run("check");
    assert!(!missing.status.success());
    assert!(
        stderr(&missing).contains("cannot read"),
        "{}",
        stderr(&missing)
    );
    audio(&project.0, b"not an audio");
    let wrong = project.run("build");
    assert!(!wrong.status.success());
    assert!(
        stderr(&wrong).contains("does not match declared type"),
        "{}",
        stderr(&wrong)
    );
    audio(&project.0, b"ID3abcdefghi");
    project.post(false, "No transcript.");
    let no_transcript = project.run("check");
    assert!(!no_transcript.status.success());
    assert!(
        stderr(&no_transcript).contains("Transcript section"),
        "{}",
        stderr(&no_transcript)
    );
    project.post(false, "## Transcript\n\nHello.");
    let check = project.run("check");
    assert!(check.status.success(), "{}", stderr(&check));
    let build = project.run("build");
    assert!(build.status.success(), "{}", stderr(&build));
    let page = fs::read_to_string(project.0.join("dist/posts/episode/index.html")).unwrap();
    assert!(page.contains("<audio controls preload=\"none\""));
    assert!(page.contains("data-audio-time=\"5\""));
    assert!(project
        .0
        .join("dist/assets/components/ob-episode.js")
        .is_file());
}

#[test]
fn drafts_warn_instead_of_failing() {
    let project = Project::new();
    project.post(true, "No transcript.");
    let check = project.run("check");
    assert!(check.status.success(), "{}", stderr(&check));
    assert!(
        stderr(&check).contains("while the post is a draft"),
        "{}",
        stderr(&check)
    );
}

#[test]
fn external_transcript_file_must_exist_and_have_readable_cues() {
    let project = Project::new();
    audio(&project.0, b"ID3abcdefghi");
    project.post(false, "No inline transcript.");
    let path = project.0.join("content/posts/episode.md");
    let post = fs::read_to_string(&path).unwrap().replace(
        "  durationSeconds: 30",
        "  durationSeconds: 30\n  transcript: /audio/one.vtt",
    );
    fs::write(&path, post).unwrap();
    let missing = project.run("check");
    assert!(!missing.status.success());
    assert!(stderr(&missing).contains("transcript file could not be read"));
    fs::write(
        project.0.join("static/audio/one.vtt"),
        "WEBVTT\n\nNOTE\nNo spoken text\n",
    )
    .unwrap();
    let empty = project.run("check");
    assert!(!empty.status.success());
    assert!(stderr(&empty).contains("timed cue with text"));
    fs::write(
        project.0.join("static/audio/one.vtt"),
        "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n",
    )
    .unwrap();
    let build = project.run("build");
    assert!(build.status.success(), "{}", stderr(&build));
    let page = fs::read_to_string(project.0.join("dist/posts/episode/index.html")).unwrap();
    assert!(page.contains("href=\"/audio/one.vtt\">Read the transcript"));
}

#[test]
fn configured_podcast_writes_feed_and_chapters_without_affecting_unconfigured_sites() {
    let project = Project::new();
    audio(&project.0, b"ID3abcdefghi");
    project.post(false, "## Transcript\n\nHello.");
    let post_path = project.0.join("content/posts/episode.md");
    let post = fs::read_to_string(&post_path).unwrap().replace(
        "  durationSeconds: 30",
        "  durationSeconds: 30\n  episodeNumber: 2\n  seasonNumber: 1",
    );
    fs::write(&post_path, post).unwrap();
    assert!(project.run("build").status.success());
    assert!(!project.0.join("dist/podcast.xml").exists());
    fs::write(project.0.join("openblog.json"), r#"{"title":"Audio","url":"https://example.test/blog","podcast":{"version":1,"title":"Show & Tell","description":"Our show","author":"Host","email":"show@example.test","category":"Technology","explicit":false,"image":"/audio/cover.jpg"}}"#).unwrap();
    let build = project.run("build");
    assert!(build.status.success(), "{}", stderr(&build));
    let feed = fs::read_to_string(project.0.join("dist/podcast.xml")).unwrap();
    assert!(feed.contains("<title>Show &amp; Tell</title>"));
    assert!(feed.contains("<itunes:email>show@example.test</itunes:email>"));
    assert!(feed.contains("<enclosure url=\"https://example.test/blog/audio/one.mp3\" length=\"12\" type=\"audio/mpeg\"/>"));
    assert!(feed.contains("<itunes:duration>30</itunes:duration>"));
    assert!(feed.contains("<itunes:episode>2</itunes:episode>"));
    assert!(feed.contains("<itunes:season>1</itunes:season>"));
    assert!(feed.contains(
        "url=\"https://example.test/blog/posts/episode/#transcript\" type=\"text/html\""
    ));
    let chapters: serde_json::Value = serde_json::from_slice(
        &fs::read(project.0.join("dist/podcast-chapters/episode.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(chapters["version"], "1.2.0");
    assert_eq!(chapters["chapters"][0]["startTime"], 5);
}

#[test]
fn custom_episode_component_is_preserved_with_and_without_audio() {
    let project = Project::new();
    fs::create_dir_all(project.0.join("web/components")).unwrap();
    fs::write(
        project.0.join("web/components/ob-episode.js"),
        "// author override\n",
    )
    .unwrap();
    let first = project.run("build");
    assert!(first.status.success(), "{}", stderr(&first));
    let output = project.0.join("dist/assets/components/ob-episode.js");
    assert_eq!(fs::read_to_string(&output).unwrap(), "// author override\n");
    audio(&project.0, b"ID3abcdefghi");
    project.post(false, "## Transcript\n\nHello.");
    let second = project.run("build");
    assert!(second.status.success(), "{}", stderr(&second));
    assert_eq!(fs::read_to_string(output).unwrap(), "// author override\n");
}

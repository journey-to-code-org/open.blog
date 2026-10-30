//! `openblog video <slug>` through the real command line (ADRs 0840 to 0843): the preview folder,
//! the checks on the files a release names, and a build that is byte for byte unchanged by them.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use serde_json::Value;

fn project(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-video-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::create_dir_all(root.join("static/images")).unwrap();
    fs::create_dir_all(root.join("media")).unwrap();
    fs::write(
        root.join("openblog.json"),
        "{\"title\":\"Studio\",\"url\":\"https://studio.example.org\"}",
    )
    .unwrap();
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    png.extend(1280u32.to_be_bytes());
    png.extend(720u32.to_be_bytes());
    png.extend([8, 6, 0, 0, 0]);
    fs::write(root.join("static/images/episode.png"), &png).unwrap();
    fs::write(
        root.join("media/episode.mp4"),
        b"\0\0\0\x20ftypisom\0\0\0\0",
    )
    .unwrap();
    fs::write(
        root.join("media/episode.en.vtt"),
        "WEBVTT\n\n00:00.000 --> 00:02.000\nThe gate opens.\n",
    )
    .unwrap();
    root
}

const RELEASE: &str = "videoFile: media/episode.mp4\nvideoTitle: Episode one <cut>\ncaptions: media/episode.en.vtt\nvideoRights: owned\nvideoPeople: none\nmadeForKids: no\nsyntheticMedia: no\n";

fn post(root: &Path, extra: &str, draft: bool) {
    fs::write(
        root.join("content/posts/2026-10-01-episode.md"),
        format!(
            "---\ntitle: Episode one\ndate: 2026-10-01\ndescription: A walk to the gate.\nprofile: video\ndraft: {draft}\ntags:\n  - animation\nduration: 3 min\nthumbnail: /images/episode.png\n{extra}---\nIntro.\n\n## Chapters\n\n00:00 Road\n00:42 Ash\n01:36 Gate\n\n## Transcript\n\n**Narrator:** The <b>gate</b> opens.\n"
        ),
    )
    .unwrap();
}

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_openblog"))
        .args(args)
        .arg("--root")
        .arg(root)
        .env_remove("OPENBLOG_WORKSPACE")
        .output()
        .unwrap()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn json(root: &Path) -> Value {
    let out = run(root, &["video", "episode", "--json"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

fn codes(value: &Value, list: &str) -> Vec<String> {
    value[list]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["code"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn a_complete_release_writes_the_youtube_preview_folder_and_uploads_nothing() {
    let root = project("complete");
    post(&root, &RELEASE.replace(" <cut>", ""), false);
    let preview = json(&root);
    assert_eq!(preview["status"], "ready", "{preview:#}");
    assert!(codes(&preview, "problems").is_empty());
    assert_eq!(
        codes(&preview, "notes"),
        ["captions-by-hand"],
        "{preview:#}"
    );
    assert_eq!(preview["privacy"], "private");
    assert_eq!(
        preview["canonicalUrl"],
        "https://studio.example.org/posts/episode/"
    );

    let out = run(&root, &["video", "episode", "--preview", "release"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(text(&out.stdout).contains("Nothing was uploaded"));
    let folder = root.join("release");
    let description = fs::read_to_string(folder.join("description.txt")).unwrap();
    assert_eq!(
        description,
        "A walk to the gate.\n\nRead the article: https://studio.example.org/posts/episode/\n\nChapters\n00:00 Road\n00:42 Ash\n01:36 Gate\n"
    );
    assert_eq!(
        fs::read_to_string(folder.join("title.txt")).unwrap(),
        "Episode one\n"
    );
    assert_eq!(
        fs::read_to_string(folder.join("tags.txt")).unwrap(),
        "animation\n"
    );
    assert!(fs::read_to_string(folder.join("transcript.txt"))
        .unwrap()
        .contains("The <b>gate</b> opens."));
    assert_eq!(
        fs::read(folder.join("thumbnail.png")).unwrap(),
        fs::read(root.join("static/images/episode.png")).unwrap()
    );
    let written: Value =
        serde_json::from_str(&fs::read_to_string(folder.join("preview.json")).unwrap()).unwrap();
    assert_eq!(written["thumbnailFile"], "thumbnail.png");
    assert_eq!(written["digest"], preview["digest"]);
    let page = fs::read_to_string(folder.join("index.html")).unwrap();
    assert!(!page.contains("<script") && !page.contains("<b>gate</b>"));
    assert!(page.contains("<img src=\"thumbnail.png\""));
    assert!(page.contains("By hand in YouTube Studio"));

    let again = run(&root, &["video", "episode", "--preview", "release"]);
    assert!(!again.status.success());
    assert!(text(&again.stderr).contains("refusing to write a preview into existing"));
    let escape = run(&root, &["video", "episode", "--preview", "../outside"]);
    assert!(!escape.status.success());
    assert!(!root.parent().unwrap().join("outside").exists());
    let both = run(&root, &["video", "episode", "--json", "--preview", "other"]);
    assert!(!both.status.success());
    assert!(!root.join("other").exists());
}

#[test]
fn a_draft_is_previewed_with_a_note_and_youtubes_refusals_block_it() {
    let root = project("draft");
    post(&root, RELEASE, true);
    let preview = json(&root);
    assert_eq!(preview["status"], "blocked");
    assert_eq!(codes(&preview, "problems"), ["title-angle-brackets"]);
    assert_eq!(
        codes(&preview, "notes"),
        ["article-not-public", "captions-by-hand"]
    );
    let out = run(&root, &["video", "episode"]);
    assert!(out.status.success());
    let summary = text(&out.stdout);
    assert!(summary.contains("status: blocked"));
    assert!(summary.contains("(title-angle-brackets)"));
}

#[test]
fn the_files_a_release_names_are_checked_where_they_are() {
    let root = project("files");
    let release = RELEASE
        .replace(" <cut>", "")
        .replace("media/episode.mp4", "static/master.mp4")
        .replace("media/episode.en.vtt", "media/missing.en.vtt")
        .replace("madeForKids: no\n", "madeForKids: perhaps\n")
        .replace("videoRights: owned\n", "");
    fs::write(root.join("static/master.mp4"), b"\0\0\0\x20ftypisom").unwrap();
    post(&root, &release, false);
    let preview = json(&root);
    assert_eq!(
        codes(&preview, "problems"),
        [
            "source-public",
            "consent-rights-missing",
            "consent-audience-invalid",
            "caption-not-found"
        ]
    );
    fs::write(root.join("static/images/episode.png"), b"not an image").unwrap();
    let preview = json(&root);
    assert!(codes(&preview, "problems").contains(&"thumbnail-unreadable".to_string()));
}

#[test]
fn a_post_of_another_profile_or_slug_is_refused() {
    let root = project("article");
    fs::write(
        root.join("content/posts/2026-10-01-essay.md"),
        "---\ntitle: Essay\ndate: 2026-10-01\n---\nWords.\n",
    )
    .unwrap();
    let out = run(&root, &["video", "essay"]);
    assert!(!out.status.success());
    assert!(text(&out.stderr).contains("does not use the video profile"));
    let out = run(&root, &["video", "nothing"]);
    assert!(text(&out.stderr).contains("no post has slug `nothing`"));
}

fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in fs::read_dir(&next).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let name = path
                    .strip_prefix(dir)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                files.insert(name, fs::read(&path).unwrap());
            }
        }
    }
    files
}

#[test]
fn release_fields_leave_the_built_site_byte_for_byte_unchanged() {
    let root = project("build");
    post(&root, "", false);
    let before = run(
        &root,
        &["build", "--out", root.join("before").to_str().unwrap()],
    );
    assert!(before.status.success(), "{}", text(&before.stderr));
    post(&root, RELEASE, false);
    let after = run(
        &root,
        &["build", "--out", root.join("after").to_str().unwrap()],
    );
    assert!(after.status.success(), "{}", text(&after.stderr));
    let (before, after) = (tree(&root.join("before")), tree(&root.join("after")));
    assert_eq!(
        before.keys().collect::<Vec<_>>(),
        after.keys().collect::<Vec<_>>()
    );
    for (name, bytes) in &before {
        assert!(after[name] == *bytes, "{name} changed");
    }
}

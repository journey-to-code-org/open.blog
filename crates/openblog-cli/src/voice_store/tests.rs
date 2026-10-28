use std::collections::BTreeMap;

use openblog_core::voice::{VoiceMeta, VoiceSample, VoiceStage};

use super::*;

use super::tests_support::Project;

pub(super) const ROUGH: &str = "2026-10-28-a-mistake-i-made-rough.md";
pub(super) const POLISHED: &str = "2026-10-28-a-mistake-i-made-polished.md";

pub(super) fn rough(body: &str) -> VoiceSample {
    VoiceSample {
        title: "A mistake I made".into(),
        subtitle: None,
        slug: "a-mistake-i-made".into(),
        date: "2026-10-28T09:30:00Z".into(),
        description: None,
        tags: Vec::new(),
        voice: VoiceMeta {
            catalog: 1,
            pack: "stories".into(),
            prompt: "a-mistake-i-made".into(),
            stage: VoiceStage::Rough,
            time_limit_seconds: 180,
            words: voice::count_words(body),
            rough_of: None,
        },
        body: body.into(),
        extra: BTreeMap::new(),
    }
}

pub(super) fn polished(body: &str) -> VoiceSample {
    let mut sample = rough(body);
    sample.voice.stage = VoiceStage::Polished;
    sample.voice.time_limit_seconds = 0;
    sample.voice.rough_of = Some(ROUGH.into());
    sample
}

const MESSY: &str = "so i delted the wrong foldr and\r\nthen  i panicked   lol";

fn lock_rough(project: &Project, vis: Visibility) -> Written {
    write_rough(
        &project.0,
        vis,
        &rough(MESSY.replace("\r\n", "\n").as_str()),
    )
    .unwrap()
}

#[test]
fn a_project_without_samples_is_untouched_by_every_read() {
    let project = Project::new();
    let before = fsutil::walk(&project.0).len();
    assert!(list(&project.0).is_empty());
    assert!(library(&project.0).is_empty());
    assert!(read(&project.0, Visibility::Private, ROUGH).is_err());
    let catalog = load_catalog(&project.0);
    assert!(catalog.warnings.is_empty() && catalog.prompts().count() >= 40);
    assert_eq!(open_session_prompt(&project.0), None);
    assert_eq!(fsutil::walk(&project.0).len(), before);
    assert!(!project.0.join("assistant").exists());
    assert!(!project.0.join(".openblog").exists());
}

#[test]
fn a_rough_draft_needs_an_open_session_for_that_prompt() {
    let project = Project::new();
    let error = write_rough(&project.0, Visibility::Private, &rough("words")).unwrap_err();
    assert!(error.to_string().contains("no session is open"), "{error}");
    assert!(!project.0.join(".openblog/private/context").exists());
    project.open_session("another-prompt");
    let error = write_rough(&project.0, Visibility::Private, &rough("words")).unwrap_err();
    assert!(error.to_string().contains("different prompt"), "{error}");
    project.open_session("a-mistake-i-made");
    let written = write_rough(&project.0, Visibility::Private, &rough("words")).unwrap();
    assert_eq!((written.file.as_str(), written.created), (ROUGH, true));
    assert!(project
        .0
        .join(".openblog/private/context/voice")
        .join(ROUGH)
        .is_file());
}

#[test]
fn a_locked_rough_draft_refuses_every_later_write_with_a_plain_sentence() {
    let project = Project::with_session("a-mistake-i-made");
    let first = lock_rough(&project, Visibility::Portable);
    let path = project.0.join("assistant/context/voice").join(ROUGH);
    let original = fs::read(&path).unwrap();

    // Another rough write with different text: refused, file untouched.
    let error =
        write_rough(&project.0, Visibility::Portable, &rough("corrected text")).unwrap_err();
    assert_eq!(
        error,
        StoreError::Refused("This rough draft is locked. A rough draft is never changed after its session ends; polish a copy instead.".into())
    );
    // Even with the session still open, and with the old revision in hand.
    assert_eq!(fs::read(&path).unwrap(), original);
    // The polished writer refuses rough samples and cannot reach a rough file.
    let error = write_polished(
        &project.0,
        Visibility::Portable,
        &rough("x"),
        Some(&first.revision),
    )
    .unwrap_err();
    assert!(error.to_string().contains("never rewritten"), "{error}");
    // Writing the very same bytes again (a repeated lock) is a harmless no-op.
    let again = write_rough(
        &project.0,
        Visibility::Portable,
        &rough(&MESSY.replace("\r\n", "\n")),
    )
    .unwrap();
    assert!(!again.created);
    assert_eq!(again.revision, first.revision);
    assert_eq!(fs::read(&path).unwrap(), original);
    // And after the session closes, nothing can write it at all.
    project.close_session();
    assert!(write_rough(&project.0, Visibility::Portable, &rough("later")).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn the_rough_text_is_kept_exactly_including_typos_and_spacing() {
    let project = Project::with_session("a-mistake-i-made");
    let body = "  so i delted  the wrong foldr\n\n\tthen i panicked   lol  \n\n";
    write_rough(&project.0, Visibility::Private, &rough(body)).unwrap();
    let loaded = read(&project.0, Visibility::Private, ROUGH).unwrap();
    assert_eq!(loaded.sample.unwrap().body, body);
}

#[test]
fn a_rough_draft_is_not_split_across_folders() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    let error = write_rough(&project.0, Visibility::Portable, &rough("other words")).unwrap_err();
    assert!(error.to_string().contains("other folder"), "{error}");
}

#[test]
fn a_polished_draft_needs_an_existing_rough_draft() {
    let project = Project::new();
    let error =
        write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap_err();
    assert!(error.to_string().contains("does not exist"), "{error}");
    assert!(!project.0.join(".openblog/private/context/voice").exists());
    // A rough draft in the other folder does not count.
    project.open_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Portable);
    assert!(write_polished(&project.0, Visibility::Private, &polished("Clean."), None).is_err());
}

#[test]
fn a_polished_draft_is_created_then_updated_with_a_revision() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    let first = write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    assert_eq!((first.file.as_str(), first.created), (POLISHED, true));

    // Creating again without a revision is stale, and says what the revision is.
    match write_polished(&project.0, Visibility::Private, &polished("Other."), None) {
        Err(StoreError::Stale { current, .. }) => assert_eq!(current, Some(first.revision.clone())),
        other => panic!("{other:?}"),
    }
    // A wrong revision is stale and writes nothing.
    match write_polished(
        &project.0,
        Visibility::Private,
        &polished("Other."),
        Some("0".repeat(64).as_str()),
    ) {
        Err(StoreError::Stale { current, message }) => {
            assert_eq!(current, Some(first.revision.clone()));
            assert!(message.contains("changed"));
        }
        other => panic!("{other:?}"),
    }
    let second = write_polished(
        &project.0,
        Visibility::Private,
        &polished("Cleaner."),
        Some(&first.revision),
    )
    .unwrap();
    assert!(!second.created && second.revision != first.revision);
    let loaded = read(&project.0, Visibility::Private, POLISHED).unwrap();
    assert_eq!(loaded.sample.unwrap().body, "Cleaner.");
    assert_eq!(loaded.listed.revision, second.revision);
    // The rough draft is still exactly as it was.
    let rough_back = read(&project.0, Visibility::Private, ROUGH).unwrap();
    assert_eq!(rough_back.sample.unwrap().body, MESSY.replace("\r\n", "\n"));
    // Nothing is left behind but the two files and the lock folder.
    let names: Vec<String> = fs::read_dir(project.0.join(".openblog/private/context/voice"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");
}

#[test]
fn a_polished_write_never_replaces_a_file_that_holds_a_rough_draft() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    // A hand-made file named as the polished draft but declaring the rough stage.
    let rough_text = fs::read_to_string(
        project
            .0
            .join(".openblog/private/context/voice")
            .join(ROUGH),
    )
    .unwrap();
    let impostor = project
        .0
        .join(".openblog/private/context/voice")
        .join(POLISHED);
    fs::write(&impostor, &rough_text).unwrap();
    let current = revision(rough_text.as_bytes());
    let error = write_polished(
        &project.0,
        Visibility::Private,
        &polished("Clean."),
        Some(&current),
    )
    .unwrap_err();
    assert!(error.to_string().contains("rough draft"), "{error}");
    assert_eq!(fs::read_to_string(&impostor).unwrap(), rough_text);
}

#[test]
fn oversize_and_invalid_samples_are_refused_before_anything_is_written() {
    let project = Project::with_session("a-mistake-i-made");
    let big = "word ".repeat(MAX_BYTES / 4);
    let error = write_rough(&project.0, Visibility::Private, &rough(&big)).unwrap_err();
    assert!(error.to_string().contains("64 KiB"), "{error}");
    let mut bad = rough("fine");
    bad.slug = "Not Valid".into();
    assert!(write_rough(&project.0, Visibility::Private, &bad).is_err());
    assert!(list(&project.0).is_empty());
    assert!(!project.0.join(".openblog/private/context").exists());
}

#[test]
fn file_names_cannot_escape_or_name_other_files() {
    let project = Project::new();
    for bad in [
        "../x-rough.md",
        "..\\x-rough.md",
        "sub/2026-10-28-x-rough.md",
        "/etc/passwd",
        "author.md",
        "2026-10-28-x-rough.md.bak",
    ] {
        assert!(read(&project.0, Visibility::Private, bad).is_err(), "{bad}");
        assert!(
            erase(&project.0, Visibility::Private, bad, true).is_err(),
            "{bad}"
        );
        assert!(
            move_visibility(&project.0, Visibility::Private, bad, Visibility::Portable).is_err()
        );
    }
}

#[cfg(unix)]
#[test]
fn a_symlinked_folder_cannot_redirect_a_write_outside_the_project() {
    use std::os::unix::fs::symlink;
    let project = Project::with_session("a-mistake-i-made");
    let outside = std::env::temp_dir().join(format!("ob-voice-outside-{}", std::process::id()));
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(project.0.join("assistant")).unwrap();
    symlink(&outside, project.0.join("assistant/context")).unwrap();
    let error = write_rough(&project.0, Visibility::Portable, &rough("words")).unwrap_err();
    assert!(error.to_string().contains("outside the project"), "{error}");
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    assert!(list(&project.0).is_empty());
    let _ = fs::remove_dir_all(outside);
}

#[cfg(unix)]
#[test]
fn a_symlinked_sample_file_is_listed_as_invalid_and_never_read() {
    use std::os::unix::fs::symlink;
    let project = Project::new();
    let secret = project.0.join("secret.md");
    fs::write(&secret, "secret").unwrap();
    let dir = project.0.join("assistant/context/voice");
    fs::create_dir_all(&dir).unwrap();
    symlink(&secret, dir.join(ROUGH)).unwrap();
    let listed = list(&project.0);
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].valid);
    assert!(read(&project.0, Visibility::Portable, ROUGH).is_err());
}

#[test]
fn listing_shows_stage_pack_prompt_visibility_words_date_and_keeps_invalid_files_visible() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    write_polished(
        &project.0,
        Visibility::Private,
        &polished("Clean one."),
        None,
    )
    .unwrap();
    let portable = project.0.join("assistant/context/voice");
    fs::create_dir_all(&portable).unwrap();
    fs::write(portable.join("2026-10-27-oops-rough.md"), "not a sample").unwrap();
    fs::write(portable.join("notes.md"), "stray").unwrap();
    fs::write(portable.join("ignored.txt"), "stray").unwrap();
    fs::write(portable.join(".hidden.md"), "stray").unwrap();
    let mut mismatch = rough("hello there");
    mismatch.voice.prompt = "other-prompt".into();
    fs::write(
        portable.join("2026-10-26-wrong-name-rough.md"),
        mismatch.serialize().unwrap(),
    )
    .unwrap();

    let items = list(&project.0);
    let names: Vec<&str> = items.iter().map(|i| i.file.as_str()).collect();
    assert_eq!(
        names,
        [
            "2026-10-26-wrong-name-rough.md",
            "2026-10-27-oops-rough.md",
            POLISHED,
            ROUGH,
            "notes.md"
        ]
    );
    let rough_item = items.iter().find(|i| i.file == ROUGH).unwrap();
    assert!(rough_item.valid && rough_item.guidance.is_none());
    assert_eq!(rough_item.visibility, Visibility::Private);
    assert_eq!(rough_item.stage, Some(VoiceStage::Rough));
    assert_eq!(rough_item.pack.as_deref(), Some("stories"));
    assert_eq!(rough_item.prompt.as_deref(), Some("a-mistake-i-made"));
    assert_eq!(
        rough_item.words,
        Some(openblog_core::voice::count_words(MESSY))
    );
    assert_eq!(rough_item.date.as_deref(), Some("2026-10-28T09:30:00Z"));
    let polished_item = items.iter().find(|i| i.file == POLISHED).unwrap();
    assert_eq!(polished_item.rough_of.as_deref(), Some(ROUGH));
    for invalid in [
        "2026-10-26-wrong-name-rough.md",
        "2026-10-27-oops-rough.md",
        "notes.md",
    ] {
        let item = items.iter().find(|i| i.file == invalid).unwrap();
        assert!(!item.valid, "{invalid}");
        assert!(
            item.guidance
                .as_deref()
                .is_some_and(|g| g.contains("Repair") || g.contains("Rename") || g.contains("Fix")),
            "{:?}",
            item.guidance
        );
    }
    // Only valid samples count toward coverage.
    let coverage = library(&project.0);
    assert_eq!(coverage.len(), 2);
}

#[test]
fn a_polished_draft_without_its_rough_draft_is_flagged() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    fs::remove_file(
        project
            .0
            .join(".openblog/private/context/voice")
            .join(ROUGH),
    )
    .unwrap();
    let item = &list(&project.0)[0];
    assert!(!item.valid);
    assert!(item.guidance.as_deref().unwrap().contains(ROUGH));
}

#[test]
fn a_non_utf8_or_oversize_file_is_listed_with_repair_guidance() {
    let project = Project::new();
    let dir = project.0.join("assistant/context/voice");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(ROUGH), [0xff, 0xfe, 0x00]).unwrap();
    fs::write(
        dir.join("2026-10-29-x-rough.md"),
        vec![b'a'; MAX_BYTES + 10],
    )
    .unwrap();
    let items = list(&project.0);
    assert_eq!(items.len(), 2);
    assert!(items.iter().all(|i| !i.valid));
    assert!(items[0].guidance.as_deref().unwrap().contains("UTF-8"));
    assert!(items[1].guidance.as_deref().unwrap().contains("64 KiB"));
}

#[test]
fn moving_copies_the_bytes_unchanged_and_moves_the_pair_together() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    let before_rough = fs::read(
        project
            .0
            .join(".openblog/private/context/voice")
            .join(ROUGH),
    )
    .unwrap();

    let moved = move_visibility(
        &project.0,
        Visibility::Private,
        POLISHED,
        Visibility::Portable,
    )
    .unwrap();
    assert_eq!(moved, [ROUGH, POLISHED]);
    let portable = project.0.join("assistant/context/voice");
    assert_eq!(fs::read(portable.join(ROUGH)).unwrap(), before_rough);
    assert!(portable.join(POLISHED).is_file());
    assert!(!project
        .0
        .join(".openblog/private/context/voice")
        .join(ROUGH)
        .exists());
    assert!(!project
        .0
        .join(".openblog/private/context/voice")
        .join(POLISHED)
        .exists());
    assert!(list(&project.0)
        .iter()
        .all(|i| i.visibility == Visibility::Portable && i.valid));

    // The moved rough draft is still locked.
    assert!(write_rough(&project.0, Visibility::Portable, &rough("edited")).is_err());
    // Moving back works; moving onto an existing file does not.
    move_visibility(&project.0, Visibility::Portable, ROUGH, Visibility::Private).unwrap();
    fs::create_dir_all(&portable).unwrap();
    fs::write(portable.join(ROUGH), "squatter").unwrap();
    let error =
        move_visibility(&project.0, Visibility::Private, ROUGH, Visibility::Portable).unwrap_err();
    assert!(error.to_string().contains("already exists"), "{error}");
    assert_eq!(
        fs::read_to_string(portable.join(ROUGH)).unwrap(),
        "squatter"
    );
    assert!(project
        .0
        .join(".openblog/private/context/voice")
        .join(ROUGH)
        .is_file());
}

#[test]
fn erasing_a_rough_draft_with_a_polished_one_needs_both() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    let error = erase(&project.0, Visibility::Private, ROUGH, false).unwrap_err();
    assert!(error.to_string().contains("polished draft"), "{error}");
    assert_eq!(
        erase(&project.0, Visibility::Private, POLISHED, false).unwrap(),
        [POLISHED]
    );
    assert_eq!(list(&project.0).len(), 1);
    write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    assert_eq!(
        erase(&project.0, Visibility::Private, ROUGH, true).unwrap(),
        [ROUGH, POLISHED]
    );
    assert!(list(&project.0).is_empty());
    assert!(erase(&project.0, Visibility::Private, ROUGH, true).is_err());
}

#[test]
fn private_writes_keep_the_private_folder_out_of_git() {
    let project = Project::with_session("a-mistake-i-made");
    fs::create_dir_all(project.0.join(".git")).unwrap();
    fs::write(project.0.join(".gitignore"), "/dist\n").unwrap();
    lock_rough(&project, Visibility::Portable);
    move_visibility(&project.0, Visibility::Portable, ROUGH, Visibility::Private).unwrap();
    assert!(fs::read_to_string(project.0.join(".gitignore"))
        .unwrap()
        .lines()
        .any(|l| l == "/.openblog/private/"));
}

#[test]
fn the_site_catalog_extends_the_bundle_and_a_broken_one_never_removes_the_feature() {
    let project = Project::new();
    let path = project.0.join(SITE_CATALOG_PATH);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "---\ndisabled: [humor]\n---\n## my-pack: My pack\n### my-prompt: Mine\nwords: 10-50\nWrite about mine.\n").unwrap();
    let catalog = load_catalog(&project.0);
    assert!(catalog.pack("humor").is_none());
    assert!(catalog.prompt("my-prompt").unwrap().site);
    assert!(catalog.warnings.is_empty());
    fs::write(
        &path,
        "## my-pack: Pack\n### a-mistake-i-made: Clash\nwords: 1-5\nx\n",
    )
    .unwrap();
    let fallback = load_catalog(&project.0);
    assert!(fallback.pack("humor").is_some());
    assert!(
        fallback.warnings[0].contains("not used"),
        "{:?}",
        fallback.warnings
    );
}

#[test]
fn revisions_are_a_stable_sha256_of_the_bytes() {
    assert_eq!(
        revision(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

// ---- Samples stay out of everything public (ADR 0266) ----

use crate::site::{self, BuildOptions};

fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fsutil::walk(dir)
        .into_iter()
        .map(|path| (fsutil::relative(dir, &path), fs::read(&path).unwrap()))
        .collect()
}

fn build_into(root: &Path, out: &Path) -> BTreeMap<String, Vec<u8>> {
    site::build(
        root,
        &BuildOptions {
            include_drafts: false,
            out_override: Some(out.to_path_buf()),
            now: None,
        },
    )
    .unwrap();
    snapshot(out)
}

#[test]
fn init_creates_no_voice_files_and_a_build_is_identical_with_and_without_samples() {
    let project = Project::new();
    let created = crate::scaffold::init(&project.0, Some("Voice test"), false).unwrap();
    assert!(
        created.iter().all(|path| !path.contains("voice")),
        "{created:?}"
    );
    assert!(snapshot(&project.0)
        .keys()
        .all(|path| !path.contains("voice")));

    let out = project.0.join("target-out");
    let without = build_into(&project.0, &out.join("a"));
    assert!(!without.is_empty());

    // Now the author writes samples, portable and private, with a marker in every file.
    project.open_session("a-mistake-i-made");
    let marker = "ZEBRAMARKER";
    write_rough(
        &project.0,
        Visibility::Portable,
        &rough(&format!("portable {marker} rough")),
    )
    .unwrap();
    write_polished(
        &project.0,
        Visibility::Portable,
        &polished(&format!("portable {marker} polished")),
        None,
    )
    .unwrap();
    let mut private = rough(&format!("private {marker} rough"));
    private.date = "2026-10-29T09:30:00Z".into();
    write_rough(&project.0, Visibility::Private, &private).unwrap();
    fs::create_dir_all(project.0.join(".openblog/private/voice")).unwrap();
    fs::write(
        project.0.join(".openblog/private/voice/note.json"),
        format!("{{\"draft\":\"{marker}\"}}"),
    )
    .unwrap();

    let with = build_into(&project.0, &out.join("b"));
    assert_eq!(
        without.keys().collect::<Vec<_>>(),
        with.keys().collect::<Vec<_>>()
    );
    for (path, bytes) in &with {
        assert_eq!(
            &without[path], bytes,
            "{path} changed because samples exist"
        );
        assert!(
            !String::from_utf8_lossy(bytes).contains(marker),
            "{path} leaks a sample"
        );
    }
    // Also a preview build that includes drafts.
    let drafts = project.0.join("target-out/c");
    site::build(
        &project.0,
        &BuildOptions {
            include_drafts: true,
            out_override: Some(drafts.clone()),
            now: None,
        },
    )
    .unwrap();
    assert!(snapshot(&drafts)
        .values()
        .all(|bytes| !String::from_utf8_lossy(bytes).contains(marker)));
}

#[test]
fn publishing_never_stages_a_private_voice_sample() {
    use crate::git::Git;
    let project = Project::new();
    let dir = &project.0;
    crate::scaffold::init(dir, Some("P"), false).unwrap();
    let git = Git::new(dir);
    git.init().unwrap();
    git.run(&["config", "user.email", "t@example.com"]).unwrap();
    git.run(&["config", "user.name", "T"]).unwrap();
    git.run(&["config", "commit.gpgsign", "false"]).unwrap();
    fs::write(dir.join(".gitignore"), "/dist\n").unwrap();
    project.open_session("a-mistake-i-made");
    write_rough(dir, Visibility::Private, &rough("private words")).unwrap();
    let mut portable = rough("portable words");
    portable.date = "2026-10-29T09:30:00Z".into();
    write_rough(dir, Visibility::Portable, &portable).unwrap();
    let mut config = site::load_config(dir).unwrap();
    config.publish.paths = vec!["assistant".into(), ".openblog".into()];

    let out = crate::publish::publish(dir, &config, Some("Voice")).unwrap();
    assert!(out
        .committed
        .iter()
        .any(|path| path == "assistant/context/voice/2026-10-29-a-mistake-i-made-rough.md"));
    assert!(
        !out.committed
            .iter()
            .any(|path| path.starts_with(".openblog/")),
        "{:?}",
        out.committed
    );
    assert!(!git
        .run(&["ls-files", "--", ".openblog/private"])
        .unwrap()
        .contains("voice"));

    // If a private sample is force-added, publishing refuses.
    git.run(&[
        "add",
        "-f",
        &format!(".openblog/private/context/voice/{ROUGH}"),
    ])
    .unwrap();
    let error = crate::publish::publish(dir, &config, Some("No")).unwrap_err();
    assert!(error.contains("private assistant"), "{error}");
}

#[test]
fn a_move_is_reversible_and_a_sample_is_only_staged_while_it_is_portable() {
    use crate::git::Git;
    let project = Project::new();
    let dir = &project.0;
    crate::scaffold::init(dir, Some("P"), false).unwrap();
    let git = Git::new(dir);
    git.init().unwrap();
    git.run(&["config", "user.email", "t@example.com"]).unwrap();
    git.run(&["config", "user.name", "T"]).unwrap();
    git.run(&["config", "commit.gpgsign", "false"]).unwrap();
    fs::write(dir.join(".gitignore"), "/dist\n").unwrap();
    project.open_session("a-mistake-i-made");
    write_rough(dir, Visibility::Private, &rough("round trip words")).unwrap();
    write_polished(dir, Visibility::Private, &polished("Clean."), None).unwrap();
    let mut config = site::load_config(dir).unwrap();
    config.publish.paths = vec!["assistant".into(), ".openblog".into()];
    let voice_files = |tree: &BTreeMap<String, Vec<u8>>| -> BTreeMap<String, Vec<u8>> {
        tree.iter()
            .filter(|(path, _)| path.contains("context/voice/"))
            .map(|(path, bytes)| (path.clone(), bytes.clone()))
            .collect()
    };
    let before = voice_files(&snapshot(dir));
    assert_eq!(before.len(), 2);

    // Private: a publish commits no voice file, and the built site carries none.
    let first = crate::publish::publish(dir, &config, Some("Private")).unwrap();
    assert!(first.committed.iter().all(|path| !path.contains("voice")));
    let built = build_into(dir, &dir.join("target-out/a"));
    assert!(built
        .values()
        .all(|bytes| !String::from_utf8_lossy(bytes).contains("round trip words")));

    // Made portable on purpose: now both files are staged.
    move_visibility(dir, Visibility::Private, ROUGH, Visibility::Portable).unwrap();
    let second = crate::publish::publish(dir, &config, Some("Portable")).unwrap();
    for name in [ROUGH, POLISHED] {
        assert!(
            second
                .committed
                .contains(&format!("assistant/context/voice/{name}")),
            "{:?}",
            second.committed
        );
    }

    // Moved back: the same bytes are in the same place, and nothing private is staged.
    move_visibility(dir, Visibility::Portable, ROUGH, Visibility::Private).unwrap();
    assert_eq!(voice_files(&snapshot(dir)), before);
    assert!(!dir.join("assistant/context/voice").join(ROUGH).exists());
    if let Ok(out) = crate::publish::publish(dir, &config, Some("Private again")) {
        assert!(out
            .committed
            .iter()
            .all(|path| !path.starts_with(".openblog/")));
    }
    let rebuilt = build_into(dir, &dir.join("target-out/b"));
    assert!(rebuilt
        .values()
        .all(|bytes| !String::from_utf8_lossy(bytes).contains("round trip words")));
}

const PRIVATE_DIR: &str = ".openblog/private/context/voice";

#[test]
fn a_failed_original_removal_never_costs_the_rough_draft_and_the_move_can_be_finished() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    let private = project.0.join(PRIVATE_DIR);
    let portable = project.0.join("assistant/context/voice");
    let rough_bytes = fs::read(private.join(ROUGH)).unwrap();

    FAIL_REMOVE.with(|f| *f.borrow_mut() = Some(POLISHED.to_string()));
    let error =
        move_visibility(&project.0, Visibility::Private, ROUGH, Visibility::Portable).unwrap_err();
    FAIL_REMOVE.with(|f| *f.borrow_mut() = None);
    // The polished original is removed first, so nothing was lost yet: the copies are undone
    // and every original, the rough draft included, is untouched.
    assert!(error.to_string().contains("Cannot remove"), "{error}");
    assert_eq!(fs::read(private.join(ROUGH)).unwrap(), rough_bytes);
    assert!(private.join(POLISHED).is_file());
    assert!(!portable.join(ROUGH).exists());

    // A failure after the polished original is gone keeps the copies too.
    FAIL_REMOVE.with(|f| *f.borrow_mut() = Some(ROUGH.to_string()));
    let error =
        move_visibility(&project.0, Visibility::Private, ROUGH, Visibility::Portable).unwrap_err();
    FAIL_REMOVE.with(|f| *f.borrow_mut() = None);
    assert!(error.to_string().contains("partly done"), "{error}");
    assert!(!private.join(POLISHED).exists());
    assert!(portable.join(POLISHED).is_file());
    assert_eq!(fs::read(private.join(ROUGH)).unwrap(), rough_bytes);
    assert_eq!(fs::read(portable.join(ROUGH)).unwrap(), rough_bytes);

    // Repeating the move finishes it: identical copies already there count as moved.
    let moved =
        move_visibility(&project.0, Visibility::Private, ROUGH, Visibility::Portable).unwrap();
    assert_eq!(moved, [ROUGH]);
    assert!(!private.join(ROUGH).exists());
    assert_eq!(fs::read(portable.join(ROUGH)).unwrap(), rough_bytes);
    assert!(portable.join(POLISHED).is_file());
}

#[test]
fn a_polished_draft_this_release_cannot_read_is_never_overwritten() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    let path = project.0.join(PRIVATE_DIR).join(POLISHED);
    let first = polished("Clean.");
    write_polished(&project.0, Visibility::Private, &first, None).unwrap();
    let text = fs::read_to_string(&path)
        .unwrap()
        .replace("voice.format: 1", "voice.format: 2");
    assert!(text.contains("voice.format: 2"));
    fs::write(&path, &text).unwrap();
    let error = write_polished(
        &project.0,
        Visibility::Private,
        &polished("Cleaner."),
        Some(&revision(text.as_bytes())),
    )
    .unwrap_err();
    assert!(matches!(error, StoreError::Refused(_)), "{error}");
    assert!(error.to_string().contains("newer"), "{error}");
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn saving_a_polished_draft_keeps_keys_a_newer_release_added() {
    let project = Project::with_session("a-mistake-i-made");
    lock_rough(&project, Visibility::Private);
    let mut first = polished("Clean.");
    first.extra.insert(
        "futureKey".into(),
        openblog_core::frontmatter::Value::Scalar("kept".into()),
    );
    let written = write_polished(&project.0, Visibility::Private, &first, None).unwrap();
    write_polished(
        &project.0,
        Visibility::Private,
        &polished("Cleaner."),
        Some(&written.revision),
    )
    .unwrap();
    let saved = fs::read_to_string(project.0.join(PRIVATE_DIR).join(POLISHED)).unwrap();
    assert!(saved.contains("futureKey: kept"), "{saved}");
    assert!(saved.contains("Cleaner."));
}

#[test]
fn writing_a_private_sample_keeps_the_private_folder_out_of_git_whatever_the_session_said() {
    let project = Project::with_session("a-mistake-i-made");
    fs::create_dir_all(project.0.join(".git")).unwrap();
    let ignored = |project: &Project| {
        fs::read_to_string(project.0.join(".gitignore"))
            .map(|t| t.lines().any(|l| l == "/.openblog/private/"))
            .unwrap_or(false)
    };
    // A portable write does not touch .gitignore.
    lock_rough(&project, Visibility::Portable);
    assert!(!ignored(&project));
    // A private polished write does.
    fs::remove_file(project.0.join("assistant/context/voice").join(ROUGH)).unwrap();
    lock_rough(&project, Visibility::Private);
    fs::remove_file(project.0.join(".gitignore")).ok();
    write_polished(&project.0, Visibility::Private, &polished("Clean."), None).unwrap();
    assert!(ignored(&project));
}

#[test]
fn locking_with_a_private_override_on_a_portable_session_keeps_the_folder_out_of_git() {
    use crate::voice_session;
    use openblog_core::DateTime;
    let project = Project::new();
    fs::create_dir_all(project.0.join(".git")).unwrap();
    let catalog = Catalog::parse_bundled(crate::voice_prompts::BUNDLED).unwrap();
    let t = |s: i64| DateTime::from_unix(1_792_000_000 + s);
    voice_session::start(
        &project.0,
        &catalog,
        "a-mistake-i-made",
        "cli",
        Visibility::Portable,
        180,
        t(0),
    )
    .unwrap();
    voice_session::save_draft(&project.0, None, "words", t(5)).unwrap();
    let ignore_path = project.0.join(".gitignore");
    fs::write(&ignore_path, "/dist\n").unwrap();
    voice_session::lock(
        &project.0,
        None,
        &catalog,
        None,
        Some(Visibility::Private),
        t(10),
    )
    .unwrap();
    assert!(fs::read_to_string(&ignore_path)
        .unwrap()
        .lines()
        .any(|l| l == "/.openblog/private/"));
}

#[test]
fn a_portable_export_never_carries_a_voice_sample() {
    let project = Project::new();
    crate::scaffold::init(&project.0, Some("Voice test"), false).unwrap();
    project.open_session("a-mistake-i-made");
    let marker = "ZEBRAEXPORT";
    write_rough(
        &project.0,
        Visibility::Portable,
        &rough(&format!("portable {marker} rough")),
    )
    .unwrap();
    let mut private = rough(&format!("private {marker} rough"));
    private.date = "2026-10-29T09:30:00Z".into();
    write_rough(&project.0, Visibility::Private, &private).unwrap();
    let out = project.0.join("exports").join("a.md");
    crate::portable_export::run(
        &project.0,
        "hello-world",
        crate::portable_export::Format::Markdown,
        Some(out.to_str().unwrap()),
        true,
        false,
    )
    .unwrap();
    let text = fs::read_to_string(&out).unwrap();
    assert!(!text.contains(marker), "the export leaks a sample");
}

// ---- promotion to a post draft -----------------------------------------------------------

fn site_project() -> Project {
    let project = Project::with_session("a-mistake-i-made");
    crate::scaffold::init(&project.0, Some("T"), false).unwrap();
    project
}

fn with_polished(project: &Project, vis: Visibility) {
    write_rough(&project.0, vis, &rough("so i delted the foldr")).unwrap();
    write_polished(&project.0, vis, &polished("So I deleted the folder."), None).unwrap();
}

fn tree_bytes(project: &Project, dir: &str) -> Vec<(String, Vec<u8>)> {
    let mut out: Vec<(String, Vec<u8>)> = fsutil::walk(&project.0.join(dir))
        .into_iter()
        .map(|p| (p.display().to_string(), fs::read(&p).unwrap()))
        .collect();
    out.sort();
    out
}

#[test]
fn promoting_a_polished_draft_creates_a_valid_post_draft_and_leaves_the_samples_alone() {
    for vis in [Visibility::Private, Visibility::Portable] {
        let project = site_project();
        with_polished(&project, vis);
        let before = tree_bytes(&project, vis.directory());
        let created = promote_to_post_draft(&project.0, vis, POLISHED, None).unwrap();
        assert_eq!(
            created.to_str().unwrap(),
            "content/posts/2026-10-28-a-mistake-i-made.md"
        );
        let text = fs::read_to_string(project.0.join(&created)).unwrap();
        assert!(
            text.contains("draft: \"true\"") && text.contains("So I deleted the folder."),
            "{text}"
        );
        assert!(!text.contains("voice"), "{text}");
        assert_eq!(tree_bytes(&project, vis.directory()), before);
        // The ordinary loader accepts it; as a draft it is held back from a normal build.
        let (site, _) = crate::site::load_site(&project.0, true, None).unwrap();
        assert!(site
            .posts
            .iter()
            .any(|p| p.slug == "a-mistake-i-made" && p.draft));
    }
}

#[test]
fn promotion_refuses_a_rough_draft_and_writes_nothing() {
    let project = site_project();
    with_polished(&project, Visibility::Private);
    let error = promote_to_post_draft(&project.0, Visibility::Private, ROUGH, None).unwrap_err();
    assert!(
        error.to_string().contains("Polish this rough draft first"),
        "{error}"
    );
    assert!(!project
        .0
        .join("content/posts/2026-10-28-a-mistake-i-made.md")
        .exists());
}

#[test]
fn promotion_refuses_a_taken_slug_even_a_draft_with_a_different_file_name() {
    let project = site_project();
    with_polished(&project, Visibility::Private);
    fs::write(
        project.0.join("content/posts/2020-01-01-old.md"),
        "---\ntitle: Old\nslug: a-mistake-i-made\ndate: 2020-01-01\ndraft: true\n---\n\nBody.\n",
    )
    .unwrap();
    let error = promote_to_post_draft(&project.0, Visibility::Private, POLISHED, None).unwrap_err();
    assert!(error.to_string().contains("a-mistake-i-made"), "{error}");
    assert!(!project
        .0
        .join("content/posts/2026-10-28-a-mistake-i-made.md")
        .exists());
}

#[test]
fn promotion_never_replaces_a_file_and_keeps_to_the_posts_folder() {
    let project = site_project();
    with_polished(&project, Visibility::Private);
    promote_to_post_draft(
        &project.0,
        Visibility::Private,
        POLISHED,
        Some("posts/2026"),
    )
    .unwrap();
    let again = promote_to_post_draft(&project.0, Visibility::Private, POLISHED, None).unwrap_err();
    assert!(again.to_string().contains("already exists"), "{again}");
    for bad in [
        "../outside",
        "pages",
        "posts/../pages",
        "/abs",
        "posts\\x",
        "posts/_hidden",
        "",
    ] {
        let error = promote_to_post_draft(&project.0, Visibility::Private, POLISHED, Some(bad))
            .unwrap_err();
        assert!(error.to_string().contains("posts"), "{bad}: {error}");
    }
}

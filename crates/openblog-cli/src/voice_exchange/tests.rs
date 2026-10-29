use std::collections::BTreeMap;

use openblog_core::voice::VoiceMeta;

use super::*;

const ROUGH: &str = "2026-10-28-a-mistake-i-made-rough.md";
const POLISHED: &str = "2026-10-28-a-mistake-i-made-polished.md";

fn sample(stage: VoiceStage, body: &str) -> String {
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
            stage,
            time_limit_seconds: if stage == VoiceStage::Rough { 180 } else { 0 },
            words: 3,
            rough_of: (stage == VoiceStage::Polished).then(|| ROUGH.to_string()),
        },
        body: body.into(),
        extra: BTreeMap::new(),
    }
    .serialize()
    .unwrap()
}

fn project(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-voice-exchange-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("openblog.json"), "{}").unwrap();
    root
}

fn put(root: &Path, visibility: Visibility, file: &str, text: &str) {
    let path = root.join(visibility.directory()).join(file);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn put_guide(root: &Path, visibility: Visibility, text: &str) {
    let path = root.join(guide_relative(visibility));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn options(file: &str, write: bool) -> Options<'_> {
    Options {
        file: Some(file),
        write,
        include_private: false,
        overwrite: false,
        as_private: false,
    }
}

/// An export file made from `source`, written next to the project's files.
fn exported(source: &Path, include_private: bool) -> String {
    let (text, _, _) = gather(source, include_private).unwrap();
    let file = source.join("library.json");
    fs::write(&file, &text).unwrap();
    file.to_string_lossy().into_owned()
}

fn tree(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut files: Vec<_> = fsutil::walk(root)
        .into_iter()
        .map(|path| {
            let bytes = fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    files.sort();
    files
}

#[test]
fn a_round_trip_is_byte_identical_and_a_second_import_changes_nothing() {
    let a = project("a");
    let b = project("b");
    let rough = sample(VoiceStage::Rough, "so i delted the foldr\n\nand  panicked");
    let polished = sample(VoiceStage::Polished, "I deleted the folder.");
    put(&a, Visibility::Portable, ROUGH, &rough);
    put(&a, Visibility::Portable, POLISHED, &polished);
    put_guide(&a, Visibility::Portable, "# Voice guide\n\nShort lines.\n");
    let file = exported(&a, false);
    import(&b, &options(&file, true)).unwrap();
    let read = |name: &str| fs::read(b.join("assistant/context/voice").join(name)).unwrap();
    assert_eq!(read(ROUGH), rough.as_bytes());
    assert_eq!(read(POLISHED), polished.as_bytes());
    assert_eq!(
        fs::read(b.join(PORTABLE_GUIDE)).unwrap(),
        b"# Voice guide\n\nShort lines.\n"
    );
    // The same files give the same export bytes.
    assert_eq!(gather(&a, false).unwrap().0, gather(&b, false).unwrap().0);
    let before = tree(&b);
    import(&b, &options(&file, true)).unwrap();
    assert_eq!(tree(&b), before);
}

#[test]
fn an_export_leaves_private_material_out_unless_asked_and_keeps_it_out_of_the_project() {
    let a = project("private");
    put(
        &a,
        Visibility::Private,
        ROUGH,
        &sample(VoiceStage::Rough, "secret words"),
    );
    put_guide(&a, Visibility::Private, "# Guide\nprivate guide\n");
    let (text, samples, guide) = gather(&a, false).unwrap();
    assert!(!text.contains("secret words") && !text.contains("private guide"));
    assert_eq!((samples, guide), (0, false));
    let (text, samples, guide) = gather(&a, true).unwrap();
    assert!(text.contains("secret words") && text.contains("\"private\""));
    assert_eq!((samples, guide), (1, true));
    // Inside the project but outside .openblog/private/ is refused; nothing is written.
    let mut opts = options("library.json", true);
    opts.include_private = true;
    let error = export(&a, &opts).unwrap_err();
    assert!(error.contains("private"), "{error}");
    assert!(!a.join("library.json").exists());
    opts.file = Some(".openblog/private/library.json");
    export(&a, &opts).unwrap();
    assert!(a.join(".openblog/private/library.json").is_file());
    // A portable-only export may be written anywhere.
    export(&a, &options("portable.json", true)).unwrap();
    assert!(a.join("portable.json").is_file());
}

#[test]
fn an_import_keeps_each_items_folder_and_as_private_only_ever_tightens() {
    let a = project("folders");
    let b = project("folders-b");
    put(
        &a,
        Visibility::Portable,
        ROUGH,
        &sample(VoiceStage::Rough, "shared words"),
    );
    let file = exported(&a, false);
    let mut opts = options(&file, true);
    opts.as_private = true;
    import(&b, &opts).unwrap();
    assert!(!b.join("assistant").exists());
    assert!(b
        .join(".openblog/private/context/voice")
        .join(ROUGH)
        .is_file());
    // Private text in an export lands private; it is never made portable.
    let c = project("folders-c");
    put(
        &c,
        Visibility::Private,
        ROUGH,
        &sample(VoiceStage::Rough, "secret"),
    );
    let file = exported(&c, true);
    let d = project("folders-d");
    import(&d, &options(&file, true)).unwrap();
    assert!(!d.join("assistant").exists());
    assert!(d
        .join(".openblog/private/context/voice")
        .join(ROUGH)
        .is_file());
}

#[test]
fn a_dry_run_and_an_invalid_import_write_nothing() {
    let a = project("dry");
    let b = project("dry-b");
    put(
        &a,
        Visibility::Portable,
        ROUGH,
        &sample(VoiceStage::Rough, "words"),
    );
    put(
        &a,
        Visibility::Portable,
        POLISHED,
        &sample(VoiceStage::Polished, "Words."),
    );
    let file = exported(&a, false);
    let before = tree(&b);
    import(&b, &options(&file, false)).unwrap();
    assert_eq!(tree(&b), before);
    // One bad item stops the whole import.
    let text = fs::read_to_string(&file).unwrap();
    let broken = text.replacen("voice.stage: polished", "voice.stage: sideways", 1);
    assert_ne!(text, broken);
    fs::write(&file, broken).unwrap();
    let error = import(&b, &options(&file, true)).unwrap_err();
    assert!(error.contains("nothing was written"), "{error}");
    assert_eq!(tree(&b), before);
}

#[test]
fn a_newer_export_or_sample_format_and_foreign_files_are_refused() {
    let b = project("newer");
    let write = |text: &str| {
        let file = b.join("in.json");
        fs::write(&file, text).unwrap();
        file.to_string_lossy().into_owned()
    };
    let newer_export = r#"{"format":"openblog-voice-export","version":2,"samples":[]}"#;
    let file = write(newer_export);
    let error = import(&b, &options(&file, true)).unwrap_err();
    assert!(error.contains("nothing was written"), "{error}");
    let (_, problems) = plan(&b, newer_export, false, false).unwrap();
    assert!(problems[0].contains("newer release"), "{problems:?}");
    let file = write(r#"{"format":"something-else","version":1}"#);
    assert!(import(&b, &options(&file, true)).is_err());
    // A sample written in a newer sample format.
    let newer = sample(VoiceStage::Rough, "words").replace("voice.format: 1", "voice.format: 2");
    let bundle = exchange::export(
        &[Item {
            visibility: "portable".into(),
            file: ROUGH.into(),
            content: newer,
        }],
        None,
    );
    let (_, problems) = plan(&b, &bundle, false, false).unwrap();
    assert!(problems[0].contains("newer"), "{problems:?}");
    assert!(!b.join("assistant").exists());
}

#[test]
fn a_rough_draft_is_never_replaced_and_a_polished_one_only_with_overwrite() {
    let b = project("conflict");
    put(
        &b,
        Visibility::Portable,
        ROUGH,
        &sample(VoiceStage::Rough, "my words"),
    );
    put(
        &b,
        Visibility::Portable,
        POLISHED,
        &sample(VoiceStage::Polished, "My words."),
    );
    let a = project("conflict-a");
    put(
        &a,
        Visibility::Portable,
        ROUGH,
        &sample(VoiceStage::Rough, "other words"),
    );
    put(
        &a,
        Visibility::Portable,
        POLISHED,
        &sample(VoiceStage::Polished, "Other words."),
    );
    let file = exported(&a, false);
    let before = tree(&b);
    let mut opts = options(&file, true);
    assert!(import(&b, &opts).is_err());
    opts.overwrite = true;
    let error = import(&b, &opts).unwrap_err();
    assert!(error.contains("nothing was written"), "{error}");
    assert_eq!(tree(&b), before);
    // With the same rough draft, a differing polished draft is replaced on request only.
    let c = project("conflict-c");
    put(
        &c,
        Visibility::Portable,
        ROUGH,
        &sample(VoiceStage::Rough, "other words"),
    );
    put(
        &c,
        Visibility::Portable,
        POLISHED,
        &sample(VoiceStage::Polished, "Mine."),
    );
    let mut opts = options(&file, true);
    assert!(import(&c, &opts).is_err());
    opts.overwrite = true;
    import(&c, &opts).unwrap();
    assert_eq!(
        fs::read_to_string(c.join("assistant/context/voice").join(POLISHED)).unwrap(),
        sample(VoiceStage::Polished, "Other words.")
    );
}

#[test]
fn a_guide_that_quotes_private_samples_never_lands_in_the_portable_folder() {
    let b = project("provenance");
    let guide = "# Guide\n<!-- openblog:voice-provenance sources=portable,private -->\nquote\n";
    let bundle = exchange::export(
        &[],
        Some(&Item {
            visibility: "portable".into(),
            file: String::new(),
            content: guide.into(),
        }),
    );
    let (_, problems) = plan(&b, &bundle, false, false).unwrap();
    assert!(problems[0].contains("private"), "{problems:?}");
    // The same guide is fine private.
    let private = bundle.replace("\"portable\"", "\"private\"");
    assert!(plan(&b, &private, false, false).unwrap().1.is_empty());
    // Export never lets such a guide out of the portable folder either.
    put_guide(&b, Visibility::Portable, guide);
    let (text, _, has_guide) = gather(&b, false).unwrap();
    assert!(!has_guide && !text.contains("provenance"));
}

#[test]
fn a_polished_draft_needs_its_rough_draft_and_a_name_in_both_folders_is_refused() {
    let b = project("pairs");
    let polished = Item {
        visibility: "portable".into(),
        file: POLISHED.into(),
        content: sample(VoiceStage::Polished, "Words."),
    };
    let bundle = exchange::export(std::slice::from_ref(&polished), None);
    let (_, problems) = plan(&b, &bundle, false, false).unwrap();
    assert!(problems[0].contains("rough draft"), "{problems:?}");
    // The rough draft already sits in the other folder.
    put(
        &b,
        Visibility::Private,
        ROUGH,
        &sample(VoiceStage::Rough, "words"),
    );
    let rough = Item {
        visibility: "portable".into(),
        file: ROUGH.into(),
        content: sample(VoiceStage::Rough, "words"),
    };
    let bundle = exchange::export(&[rough, polished], None);
    let (_, problems) = plan(&b, &bundle, false, false).unwrap();
    assert!(
        problems.iter().any(|p| p.contains("never moves")),
        "{problems:?}"
    );
}

#[test]
fn oversized_and_malformed_imports_are_refused_without_echoing_text() {
    let b = project("limits");
    let (_, problems) = plan(&b, "{ secret words", false, false).unwrap();
    assert!(!problems[0].contains("secret"), "{problems:?}");
    let huge = " ".repeat(MAX_EXPORT_BYTES + 1);
    let (_, problems) = plan(&b, &huge, false, false).unwrap();
    assert!(problems[0].contains("over"), "{problems:?}");
}

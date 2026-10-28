use super::*;
use crate::voice_store::tests_support::Project;

const T0: i64 = 1_792_000_000; // 2026-10-14T18:13:20Z

fn at(seconds: i64) -> DateTime {
    DateTime::from_unix(T0 + seconds)
}

fn catalog() -> Catalog {
    Catalog::parse_bundled(crate::voice_prompts::BUNDLED).unwrap()
}

fn begin(project: &Project, prompt: &str, visibility: Visibility) -> Session {
    start(
        &project.0,
        &catalog(),
        prompt,
        "cli",
        visibility,
        180,
        at(0),
    )
    .unwrap()
}

fn record(project: &Project) -> PathBuf {
    project.0.join(SESSION_PATH)
}

#[test]
fn starting_records_the_prompt_the_catalog_version_and_the_deadline() {
    let project = Project::new();
    let session = begin(&project, "a-mistake-i-made", Visibility::Private);
    assert_eq!(session.pack, "stories");
    assert_eq!(session.catalog_version, 1);
    assert_eq!(session.time_limit_seconds, 180);
    assert_eq!(session.started_at, at(0).rfc3339());
    assert_eq!(session.deadline, at(180).rfc3339());
    assert_eq!(session.surface, "cli");
    assert!(session.draft.is_empty());
    match status(&project.0, at(60)).unwrap() {
        Status::Active {
            session: read,
            remaining_seconds,
        } => {
            assert_eq!(read, session);
            assert_eq!(remaining_seconds, 120);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn only_one_session_is_open_and_starting_another_asks_to_lock_or_scrap() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    let before = fs::read(record(&project)).unwrap();
    let error = start(
        &project.0,
        &catalog(),
        "a-turning-point",
        "admin",
        Visibility::Private,
        180,
        at(10),
    )
    .unwrap_err();
    assert_eq!(
        error,
        StartError::AlreadyOpen {
            prompt_id: "a-mistake-i-made".into(),
            expired: false
        }
    );
    assert!(error.to_string().contains("Lock it or scrap it"));
    assert_eq!(fs::read(record(&project)).unwrap(), before);
    // Even one that has run out of time is still open until it is locked or scrapped.
    let error = start(
        &project.0,
        &catalog(),
        "a-turning-point",
        "admin",
        Visibility::Private,
        180,
        at(500),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        StartError::AlreadyOpen { expired: true, .. }
    ));
    assert!(error.to_string().contains("run out of time"));
    assert_eq!(fs::read(record(&project)).unwrap(), before);
}

#[test]
fn starting_checks_the_prompt_the_window_and_the_surface() {
    let project = Project::new();
    let go = |prompt: &str, surface: &str, seconds: u32| {
        start(
            &project.0,
            &catalog(),
            prompt,
            surface,
            Visibility::Private,
            seconds,
            at(0),
        )
    };
    assert!(go("no-such-prompt", "cli", 180).is_err());
    assert!(go("a-mistake-i-made", "cli", 5).is_err());
    assert!(go("a-mistake-i-made", "cli", 99_999).is_err());
    assert!(go("a-mistake-i-made", "Bad Surface", 180).is_err());
    assert!(!record(&project).exists());
}

#[test]
fn resuming_before_the_deadline_returns_the_remaining_time_and_the_draft() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(&project.0, "so i delted", at(50)).unwrap();
    match resume(&project.0, &catalog(), at(100)).unwrap() {
        Resume::Active {
            session,
            remaining_seconds,
        } => {
            assert_eq!(remaining_seconds, 80);
            assert_eq!(session.draft, "so i delted");
            assert_eq!(session.deadline, at(180).rfc3339());
        }
        other => panic!("{other:?}"),
    }
    // Resuming changes nothing, so another surface sees the same deadline.
    assert!(matches!(
        resume(&project.0, &catalog(), at(179)).unwrap(),
        Resume::Active {
            remaining_seconds: 1,
            ..
        }
    ));
    assert!(record(&project).exists());
}

#[test]
fn resuming_after_the_deadline_locks_the_rough_draft_from_the_saved_text() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(
        &project.0,
        "so i delted the wrong foldr\r\nand  panicked",
        at(170),
    )
    .unwrap();
    // The text on screen never arrived; the saved text is what gets locked, byte for byte.
    let resumed = resume(&project.0, &catalog(), at(180)).unwrap();
    let Resume::Locked(locked) = resumed else {
        panic!("{resumed:?}")
    };
    assert!(locked.expired);
    assert_eq!(locked.words, 8);
    assert!(!record(&project).exists());
    let file = voice_store::read(&project.0, Visibility::Private, &locked.written.file).unwrap();
    let sample = file.sample.unwrap();
    assert_eq!(sample.body, "so i delted the wrong foldr\nand  panicked");
    assert_eq!(sample.voice.stage, VoiceStage::Rough);
    assert_eq!(sample.voice.time_limit_seconds, 180);
    assert_eq!(sample.title, "A mistake I made");
    // And it is locked for good.
    assert!(voice_store::write_rough(&project.0, Visibility::Private, &sample).is_err());
    let mut changed = sample.clone();
    changed.body = "fixed".into();
    changed.voice.words = 1;
    assert!(voice_store::write_rough(&project.0, Visibility::Private, &changed).is_err());
}

#[test]
fn an_expired_session_with_nothing_written_is_discarded() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(&project.0, "   \n ", at(10)).unwrap();
    assert_eq!(
        resume(&project.0, &catalog(), at(999)).unwrap(),
        Resume::Discarded {
            prompt_id: "a-mistake-i-made".into()
        }
    );
    assert!(!record(&project).exists());
    assert!(voice_store::list(&project.0).is_empty());
    assert_eq!(
        resume(&project.0, &catalog(), at(999)).unwrap(),
        Resume::NoSession
    );
}

#[test]
fn saving_stops_when_time_is_up_but_allows_the_final_request_a_short_grace() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(&project.0, "one", at(100)).unwrap();
    assert!(save_draft(&project.0, "two", at(180 + LOCK_GRACE_SECONDS)).is_ok());
    let error = save_draft(&project.0, "three", at(180 + LOCK_GRACE_SECONDS + 1)).unwrap_err();
    assert!(error.to_string().contains("Time is up"), "{error}");
    assert!(save_draft(&project.0, &"x".repeat(MAX_DRAFT_BYTES + 1), at(1)).is_err());
    assert!(save_draft(&project.0, "a\0b", at(1)).is_err());
    match status(&project.0, at(1)).unwrap() {
        Status::Active { session, .. } => assert_eq!(session.draft, "two"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn locking_uses_the_final_text_in_time_and_the_saved_text_when_late() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Portable);
    save_draft(&project.0, "saved text", at(100)).unwrap();
    let locked = lock(
        &project.0,
        &catalog(),
        Some("final text on screen"),
        None,
        at(181),
    )
    .unwrap();
    assert!(locked.expired);
    let sample = voice_store::read(&project.0, Visibility::Portable, &locked.written.file)
        .unwrap()
        .sample
        .unwrap();
    assert_eq!(sample.body, "final text on screen");
    assert!(!record(&project).exists());

    let project = Project::new();
    begin(&project, "a-turning-point", Visibility::Private);
    save_draft(&project.0, "saved text", at(100)).unwrap();
    let locked = lock(
        &project.0,
        &catalog(),
        Some("late text"),
        Some(Visibility::Portable),
        at(400),
    )
    .unwrap();
    let sample = voice_store::read(&project.0, Visibility::Portable, &locked.written.file)
        .unwrap()
        .sample
        .unwrap();
    assert_eq!(sample.body, "saved text");
}

#[test]
fn the_record_is_removed_on_lock_and_on_scrap_and_nothing_is_written_by_a_scrap() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(&project.0, "words", at(5)).unwrap();
    scrap(&project.0).unwrap();
    assert!(!record(&project).exists());
    assert!(voice_store::list(&project.0).is_empty());
    assert_eq!(status(&project.0, at(6)).unwrap(), Status::None);
    scrap(&project.0).unwrap();

    begin(&project, "a-mistake-i-made", Visibility::Private);
    lock(&project.0, &catalog(), Some("words"), None, at(20)).unwrap();
    assert!(!record(&project).exists());
    // Locking nothing is refused and keeps the session so the author can write or scrap it.
    begin(&project, "a-turning-point", Visibility::Private);
    let error = lock(&project.0, &catalog(), Some("  "), None, at(30)).unwrap_err();
    assert!(error.to_string().contains("Nothing was written"), "{error}");
    assert!(record(&project).exists());
}

#[test]
fn a_prompt_cannot_be_started_twice_on_the_same_day() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    lock(&project.0, &catalog(), Some("words"), None, at(20)).unwrap();
    let error = start(
        &project.0,
        &catalog(),
        "a-mistake-i-made",
        "cli",
        Visibility::Private,
        180,
        at(40),
    )
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("already wrote this prompt today"),
        "{error}"
    );
    // Tomorrow is fine.
    assert!(start(
        &project.0,
        &catalog(),
        "a-mistake-i-made",
        "cli",
        Visibility::Private,
        180,
        at(86_400 + 40),
    )
    .is_ok());
}

#[test]
fn a_repeated_lock_after_a_crash_is_harmless() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(&project.0, "my words", at(10)).unwrap();
    let saved = fs::read(record(&project)).unwrap();
    lock(&project.0, &catalog(), None, None, at(20)).unwrap();
    // The process died after writing the rough draft but before removing the record.
    fs::write(record(&project), &saved).unwrap();
    let again = lock(&project.0, &catalog(), None, None, at(25)).unwrap();
    assert!(!again.written.created);
    assert!(!record(&project).exists());
    assert_eq!(voice_store::list(&project.0).len(), 1);
}

#[test]
fn writes_go_through_a_temporary_file_and_a_crash_leaves_the_old_record_readable() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    save_draft(&project.0, "first", at(5)).unwrap();
    let directory = project.0.join(".openblog/private/voice");
    // A crash during a write leaves, at worst, a temporary file; the record is untouched.
    fs::write(
        directory.join(".session-deadbeef.tmp"),
        "{\"format\": \"trunc",
    )
    .unwrap();
    match status(&project.0, at(6)).unwrap() {
        Status::Active { session, .. } => assert_eq!(session.draft, "first"),
        other => panic!("{other:?}"),
    }
    save_draft(&project.0, "second", at(7)).unwrap();
    // A normal write leaves no temporary file of its own behind.
    let leftovers: Vec<String> = fs::read_dir(&directory)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert_eq!(leftovers, [".session-deadbeef.tmp"]);
    let text = fs::read_to_string(record(&project)).unwrap();
    assert!(text.contains("\"draft\": \"second\"") && text.ends_with('\n'));
}

#[test]
fn a_damaged_record_is_reported_and_can_be_scrapped_but_a_newer_one_is_never_removed() {
    let project = Project::new();
    begin(&project, "a-mistake-i-made", Visibility::Private);
    fs::write(record(&project), "{ not json").unwrap();
    let error = status(&project.0, at(1)).unwrap_err();
    assert!(error.to_string().contains("damaged"), "{error}");
    assert!(save_draft(&project.0, "x", at(1)).is_err());
    scrap(&project.0).unwrap();
    assert!(!record(&project).exists());

    let newer = format!(
        "{{\"format\":\"{SESSION_FORMAT}\",\"version\":2,\"promptId\":\"a-mistake-i-made\"}}"
    );
    fs::create_dir_all(record(&project).parent().unwrap()).unwrap();
    fs::write(record(&project), &newer).unwrap();
    let error = status(&project.0, at(1)).unwrap_err();
    assert!(error.to_string().contains("newer release"), "{error}");
    assert!(scrap(&project.0).is_err());
    assert_eq!(fs::read_to_string(record(&project)).unwrap(), newer);
}

#[test]
fn a_session_never_starts_or_touches_anything_before_it_is_asked_to() {
    let project = Project::new();
    assert_eq!(status(&project.0, at(0)).unwrap(), Status::None);
    assert_eq!(
        resume(&project.0, &catalog(), at(0)).unwrap(),
        Resume::NoSession
    );
    assert!(fs::read_dir(&project.0).unwrap().next().is_none());
}

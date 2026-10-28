use std::io::Cursor;
use std::sync::mpsc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::*;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

fn reader(text: &str) -> Receiver<Option<String>> {
    let bytes = text.as_bytes().to_vec();
    spawn_line_reader(move || Cursor::new(bytes))
}

#[test]
fn text_below_the_marker_is_taken_and_the_header_is_not() {
    let header = "# Prompt\n";
    let file = format!("{header}{MARKER}\nso i delted the foldr\r\n\r\nlol  \n");
    assert_eq!(
        text_below_marker(&file, header),
        "so i delted the foldr\n\nlol  "
    );
}

#[test]
fn a_deleted_marker_still_never_saves_the_header() {
    let header = "# Prompt\n# Rule\n";
    assert_eq!(
        text_below_marker(&format!("{header}words\n"), header),
        "words"
    );
    assert_eq!(text_below_marker("just words\n", header), "just words");
    assert_eq!(
        text_below_marker(&format!("{header}{MARKER}\n"), header),
        ""
    );
}

#[test]
fn lines_end_at_a_dot_and_keep_typos_and_blank_lines() {
    let lines = reader("teh first\n\n  indented  \n.\nafter the dot\n");
    let mut out = Vec::new();
    let mut saved = Vec::new();
    let captured = capture_lines(&lines, "", now() + 60, &now, &mut out, &mut |t| {
        saved.push(t.to_string())
    });
    assert_eq!(captured.ended, Ended::Finished);
    assert_eq!(captured.text, "teh first\n\n  indented  ");
    assert_eq!(saved.last().unwrap(), &captured.text);
}

#[test]
fn end_of_input_finishes_and_a_resumed_draft_comes_first() {
    let lines = reader("more\n");
    let captured = capture_lines(
        &lines,
        "so far",
        now() + 60,
        &now,
        &mut Vec::new(),
        &mut |_| {},
    );
    assert_eq!(
        (captured.text.as_str(), captured.ended),
        ("so far\nmore", Ended::Finished)
    );
}

#[test]
fn a_silent_reader_does_not_hold_the_session_past_the_deadline() {
    // The sender stays open and sends one line, then nothing: like a person who stopped typing.
    let (sender, lines) = mpsc::channel();
    sender.send(Some("first".to_string())).unwrap();
    let started = Instant::now();
    let deadline = now() + 1;
    let captured = capture_lines(&lines, "", deadline, &now, &mut Vec::new(), &mut |_| {});
    assert_eq!(captured.ended, Ended::Deadline);
    assert_eq!(captured.text, "first");
    assert!(started.elapsed() < Duration::from_secs(4));
    // A line sent afterwards is never part of it.
    sender.send(Some("late".to_string())).unwrap();
}

#[test]
fn a_line_that_arrives_after_the_deadline_is_discarded() {
    let (sender, lines) = mpsc::channel();
    sender.send(Some("on time".to_string())).unwrap();
    let clock_calls = std::cell::Cell::new(0);
    // The first reads of the clock are before the deadline, the later ones after it.
    let clock = || {
        clock_calls.set(clock_calls.get() + 1);
        if clock_calls.get() <= 1 {
            100
        } else {
            200
        }
    };
    let captured = capture_lines(&lines, "", 150, &clock, &mut Vec::new(), &mut |_| {});
    assert_eq!(captured.ended, Ended::Deadline);
    assert_eq!(captured.text, "");
}

#[test]
fn a_countdown_line_is_printed() {
    let lines = reader("");
    let mut out = Vec::new();
    capture_lines(&lines, "", now() + 30, &now, &mut out, &mut |_| {});
    let printed = String::from_utf8(out).unwrap();
    assert!(printed.contains("left]"), "{printed}");
}

fn script(dir: &Path, name: &str, unix: &str, windows: &str) -> String {
    #[cfg(windows)]
    {
        let _ = unix;
        let path = dir.join(format!("{name}.cmd"));
        std::fs::write(&path, format!("@echo off\r\n{windows}\r\n")).unwrap();
        format!("\"{}\"", path.display())
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = windows;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{unix}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        format!("\"{}\"", path.display())
    }
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ob-voice-capture-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

use std::path::PathBuf;

#[test]
fn an_editor_that_closes_hands_back_the_text_below_the_marker() {
    let dir = scratch("editor");
    let editor = script(
        &dir,
        "append",
        "printf 'teh text\n' >> \"$1\"",
        "echo teh text>> \"%~1\"",
    );
    let header = "# header\n";
    let file = dir.join("draft.md");
    let captured = capture_in_editor(
        &editor,
        &file,
        header,
        &format!("{header}{MARKER}\n"),
        now() + 60,
        &now,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(captured.ended, Ended::Finished);
    assert_eq!(captured.text, "teh text");
    assert!(!file.exists(), "the temporary file is removed");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_editor_still_open_at_the_deadline_is_read_as_it_stands() {
    let dir = scratch("slow");
    let editor = script(
        &dir,
        "slow",
        "printf 'written in time\n' >> \"$1\"\nexec sleep 3",
        "echo written in time>> \"%~1\"\r\nping -n 4 127.0.0.1 >nul",
    );
    let header = "# header\n";
    let file = dir.join("draft.md");
    let started = Instant::now();
    let captured = capture_in_editor(
        &editor,
        &file,
        header,
        &format!("{header}{MARKER}\n"),
        now() + 1,
        &now,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(captured.ended, Ended::Deadline);
    assert_eq!(captured.text, "written in time");
    assert!(started.elapsed() < Duration::from_secs(3));
    std::thread::sleep(Duration::from_millis(3500));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_missing_editor_is_a_plain_error() {
    let dir = scratch("missing");
    let file = dir.join("draft.md");
    let result = capture_in_editor(
        "definitely-not-an-editor-xyz",
        &file,
        "",
        MARKER,
        now() + 60,
        &now,
        &mut |_| {},
    );
    assert!(result.unwrap_err().contains("did not finish normally"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn each_session_gets_its_own_editor_file_and_stale_ones_are_removed() {
    let first = session_file_name("editing");
    let second = session_file_name("editing");
    assert_ne!(first, second);
    assert!(first.starts_with("editing-") && first.ends_with(".md"));
    let dir = scratch("stale");
    for name in ["editing.md", "editing-old.md", "polishing-1.md", "keep.md"] {
        std::fs::write(dir.join(name), "x").unwrap();
    }
    remove_stale(&dir, "editing");
    assert!(!dir.join("editing.md").exists());
    assert!(!dir.join("editing-old.md").exists());
    assert!(dir.join("polishing-1.md").exists());
    assert!(dir.join("keep.md").exists());
    remove_stale(&dir, "polishing");
    assert!(!dir.join("polishing-1.md").exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_deadline_stops_the_whole_editor_so_a_later_save_never_lands() {
    let dir = scratch("tree");
    let editor = script(
        &dir,
        "tree",
        "printf 'in time\n' >> \"$1\"\nsleep 2\nsleep 3\nprintf x > \"$1.after\"",
        "echo in time>> \"%~1\"\r\nping -n 3 127.0.0.1 >nul\r\nping -n 4 127.0.0.1 >nul\r\necho x> \"%~1.after\"",
    );
    let header = "# header\n";
    let file = dir.join("draft.md");
    let started = Instant::now();
    let captured = capture_in_editor(
        &editor,
        &file,
        header,
        &format!("{header}{MARKER}\n"),
        now() + 1,
        &now,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(captured.ended, Ended::Deadline);
    assert_eq!(captured.text, "in time");
    assert!(started.elapsed() < Duration::from_secs(3));
    std::thread::sleep(Duration::from_millis(5500));
    assert!(
        !dir.join("draft.md.after").exists(),
        "the editor process survived the deadline"
    );
    let _ = std::fs::remove_dir_all(dir);
}

//! Timed capture for a voice session at the terminal (ADR 0350): an editor, or plain lines on
//! standard input.
//!
//! The clock is honest. In both modes the deadline comes from the session record, text that
//! arrives after it is thrown away, and a reader that is stuck waiting for a person never holds the
//! session open: standard input is read by a helper thread, and an editor is polled rather than
//! waited for. Nothing here corrects, trims or reflows what the author wrote. The only things not
//! kept are the header and marker line this module put in the editor file itself, and the one
//! final newline that an editor adds (the sample format adds it back).

use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Child, Command};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, SystemTime};

/// The line that separates the header from the author's text in the editor file.
pub const MARKER: &str =
    "-----8<----- write below this line; everything above it is ignored -----8<-----";

/// How a capture ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ended {
    /// The author closed the editor, or sent `.` or end of input.
    Finished,
    /// The deadline passed first.
    Deadline,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Captured {
    pub text: String,
    pub ended: Ended,
}

/// The editor command from `$VISUAL`, then `$EDITOR`, if either is set and not blank.
pub fn editor_command() -> Option<String> {
    ["VISUAL", "EDITOR"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

/// The text below the marker. If the author deleted the marker, the known header is removed when
/// the file still starts with it; otherwise the whole file is the text. Line endings become LF
/// and the one final newline an editor adds is dropped.
pub fn text_below_marker(content: &str, header: &str) -> String {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut offset = 0;
    let mut after_marker = None;
    for line in content.split_inclusive('\n') {
        offset += line.len();
        if line.trim_end_matches(['\r', '\n']) == MARKER {
            after_marker = Some(offset);
            break;
        }
    }
    let text = match after_marker {
        Some(at) => &content[at..],
        None => content.strip_prefix(header).unwrap_or(content),
    };
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    text.strip_suffix('\n').unwrap_or(&text).to_string()
}

fn spawn_editor(editor: &str, path: &Path) -> std::io::Result<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        // cmd and many tools mistake a forward slash for a switch, so use the native separator.
        let native = path.display().to_string().replace('/', "\\");
        command.raw_arg(format!("/S /C \"{editor} \"{native}\"\""));
        command.spawn()
    }
    #[cfg(not(windows))]
    {
        Command::new("sh")
            .arg("-c")
            .arg(format!("{editor} \"$1\""))
            .arg("sh")
            .arg(path)
            .spawn()
    }
}

/// Open `path` in `editor` and wait for it to close. For editing a copy with no clock.
pub fn edit_file(editor: &str, path: &Path) -> Result<(), String> {
    let status = spawn_editor(editor, path)
        .and_then(|mut child| child.wait())
        .map_err(|error| format!("Cannot start the editor `{editor}`: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "The editor `{editor}` did not finish normally, so nothing was saved."
        ))
    }
}

fn read_lossy(path: &Path) -> Option<String> {
    std::fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Write `file_content` (header, marker, any text so far) to `path`, open it in the editor, and
/// wait until the editor closes or `now_unix() >= deadline_unix`. At the deadline the file is read
/// as it stands and the editor is stopped; whatever it writes later is never read. Each change
/// seen while waiting is passed to `progress` so an interrupted session keeps it.
pub fn capture_in_editor(
    editor: &str,
    path: &Path,
    header: &str,
    file_content: &str,
    deadline_unix: i64,
    now_unix: &dyn Fn() -> i64,
    progress: &mut dyn FnMut(&str),
) -> Result<Captured, String> {
    std::fs::write(path, file_content)
        .map_err(|error| format!("Cannot create the editor file: {error}"))?;
    let mut child = match spawn_editor(editor, path) {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_file(path);
            return Err(format!("Cannot start the editor `{editor}`: {error}"));
        }
    };
    let mut seen = modified(path);
    let result = loop {
        if now_unix() >= deadline_unix {
            let text = read_lossy(path).map(|c| text_below_marker(&c, header));
            let _ = child.kill();
            let _ = child.wait();
            break Ok(Captured {
                text: text.unwrap_or_default(),
                ended: Ended::Deadline,
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let text = read_lossy(path)
                    .map(|c| text_below_marker(&c, header))
                    .unwrap_or_default();
                if !status.success() && now_unix() < deadline_unix {
                    progress(&text);
                    break Err(format!(
                        "The editor `{editor}` did not finish normally. What it had saved is kept; run `openblog voice --resume` to carry on while time is left."
                    ));
                }
                // A window that closed after the deadline does not extend it.
                let ended = if now_unix() >= deadline_unix {
                    Ended::Deadline
                } else {
                    Ended::Finished
                };
                break Ok(Captured { text, ended });
            }
            Ok(None) => {}
            Err(error) => break Err(format!("Lost track of the editor: {error}")),
        }
        let stamp = modified(path);
        if stamp != seen {
            seen = stamp;
            if let Some(content) = read_lossy(path) {
                progress(&text_below_marker(&content, header));
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let _ = std::fs::remove_file(path);
    result
}

/// Read lines from the reader `open` makes, on a helper thread (a standard input lock cannot move
/// between threads, so the thread opens it itself). `None` marks the end of the input.
pub fn spawn_line_reader<R, F>(open: F) -> Receiver<Option<String>>
where
    R: BufRead,
    F: FnOnce() -> R + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = open();
        loop {
            let mut raw = Vec::new();
            match reader.read_until(b'\n', &mut raw) {
                Ok(0) | Err(_) => {
                    let _ = sender.send(None);
                    break;
                }
                Ok(_) => {
                    let line = String::from_utf8_lossy(&raw);
                    let line = line.trim_end_matches(['\n', '\r']).to_string();
                    if sender.send(Some(line)).is_err() {
                        break;
                    }
                }
            }
        }
    });
    receiver
}

/// Collect lines until `.` on a line of its own, the end of input, or the deadline. `initial` is
/// the text already saved (a resumed session); new lines follow it. Lines that arrive after the
/// deadline are discarded. A countdown line is printed to `out` every 30 seconds, and at 10.
pub fn capture_lines(
    lines: &Receiver<Option<String>>,
    initial: &str,
    deadline_unix: i64,
    now_unix: &dyn Fn() -> i64,
    out: &mut dyn Write,
    progress: &mut dyn FnMut(&str),
) -> Captured {
    let mut text = initial.to_string();
    let mut last_notice = None;
    let mut any = !initial.is_empty();
    loop {
        let remaining = deadline_unix - now_unix();
        if remaining <= 0 {
            return Captured {
                text,
                ended: Ended::Deadline,
            };
        }
        if (remaining % 30 == 0 || remaining == 10) && last_notice != Some(remaining) {
            last_notice = Some(remaining);
            let _ = writeln!(out, "[{}:{:02} left]", remaining / 60, remaining % 60);
            let _ = out.flush();
        }
        let wait = Duration::from_millis(250).min(Duration::from_secs(remaining as u64));
        match lines.recv_timeout(wait) {
            Ok(Some(line)) => {
                if now_unix() >= deadline_unix {
                    return Captured {
                        text,
                        ended: Ended::Deadline,
                    };
                }
                if line.trim_end() == "." {
                    return Captured {
                        text,
                        ended: Ended::Finished,
                    };
                }
                if any {
                    text.push('\n');
                }
                any = true;
                text.push_str(&line);
                progress(&text);
            }
            Ok(None) | Err(RecvTimeoutError::Disconnected) => {
                return Captured {
                    text,
                    ended: Ended::Finished,
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

#[cfg(test)]
mod tests;

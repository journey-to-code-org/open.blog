//! `openblog voice`: timed voice sessions from the terminal (ADR 0269).
//!
//! This is a thin layer. The rules live in `voice_session` (the clock and the lock), `voice_store`
//! (what may be written, including the rule that a rough draft is never changed) and
//! `openblog_core::voice`. Nothing here offers a way to edit a rough draft: `polish` always writes
//! a separate polished draft and checks that the rough file's bytes did not change.
//!
//! Output is plain text with no colour, so `NO_COLOR` needs no special handling.

use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};

use openblog_core::voice::catalog::{Catalog, Prompt};
use openblog_core::voice::draw::{draw_three, redraw_three};
use openblog_core::voice::{self, VoiceMeta, VoiceStage};
use openblog_core::DateTime;

use crate::assistant_storage::contained_target;
use crate::voice_capture::{self, Captured, Ended};
use crate::voice_session::{self, Resume, Session, Status, DEFAULT_SECONDS};
use crate::voice_store::{self, Listed, Visibility};
use crate::{clock, site, transaction};

/// Whether `init` should offer a session: only for a person at a terminal, only when something
/// was created, and never after `--no-voice`.
pub fn should_invite(stdin_tty: bool, stdout_tty: bool, no_voice: bool, created: bool) -> bool {
    stdin_tty && stdout_tty && !no_voice && created
}

/// The invitation `init` offers when [`should_invite`] says so. Anything but `y` or `yes`
/// continues silently, and nothing about the answer is recorded.
pub fn invite_after_init(dir: &Path, no_voice: bool, created: bool) {
    let stdin = io::stdin();
    let stdout = io::stdout();
    if !should_invite(stdin.is_terminal(), stdout.is_terminal(), no_voice, created) {
        return;
    }
    println!(
        "\nWant to try a three-minute writing session? You answer one prompt in your own words, typos\nand all. Nothing is published, and it stays on this computer. (Run `openblog voice` any time.)"
    );
    print!("Start one now? [y/N] ");
    let _ = io::stdout().flush();
    let answer = read_line().unwrap_or_default();
    if matches!(answer.trim().to_lowercase().as_str(), "y" | "yes") {
        if let Err(message) = start(dir, None, &Options::default()) {
            eprintln!("voice: {message}");
        }
    }
}

#[derive(Clone, Debug)]
struct Options {
    stdin: bool,
    portable: bool,
    seconds: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            stdin: false,
            portable: false,
            seconds: DEFAULT_SECONDS,
        }
    }
}

/// Run `openblog voice` with the parsed command line.
pub fn run(
    root: &Path,
    positional: &[String],
    options: &HashMap<String, String>,
    switches: &HashSet<String>,
) -> Result<(), String> {
    site::load_config(root).map_err(|error| {
        format!(
            "{error}\n(voice sessions belong to an open.blog project; run `openblog init` first)"
        )
    })?;
    let seconds = match options.get("seconds") {
        None => DEFAULT_SECONDS,
        Some(value) => value
            .parse::<u32>()
            .map_err(|_| format!("--seconds needs a whole number, not `{value}`"))?,
    };
    let opts = Options {
        stdin: switches.contains("stdin"),
        portable: switches.contains("portable"),
        seconds,
    };
    let first = positional.first().map(String::as_str);
    match first {
        Some("polish") => polish(root, one_sample(positional, "polish")?, options),
        Some("diff") => diff(root, one_sample(positional, "diff")?),
        Some("promote") => promote(
            root,
            one_sample(positional, "promote")?,
            options.get("dir").map(String::as_str),
        ),
        _ => {
            if positional.len() > 1 {
                return Err(
                    "usage: openblog voice [prompt-id] [options]; see `openblog help`".into(),
                );
            }
            if switches.contains("list") {
                list(root)
            } else if switches.contains("scrap") {
                scrap(root, switches.contains("yes"))
            } else if switches.contains("resume") {
                resume(root, &opts)
            } else {
                start(root, first, &opts)
            }
        }
    }
}

fn one_sample<'a>(positional: &'a [String], command: &str) -> Result<&'a str, String> {
    match positional {
        [_, sample] => Ok(sample),
        _ => Err(format!(
            "usage: openblog voice {command} <sample>   (a sample file name from `openblog voice --list`, or its prompt id)"
        )),
    }
}

// ---- small helpers -------------------------------------------------------------------------

fn read_line() -> Option<String> {
    let mut line = String::new();
    match io::stdin().lock().read_line(&mut line) {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(line),
    }
}

fn clock_time(rfc3339: &str) -> String {
    format!("{} UTC", rfc3339.get(11..19).unwrap_or(rfc3339))
}

fn length_phrase(seconds: u32) -> String {
    if seconds.is_multiple_of(60) {
        let minutes = seconds / 60;
        format!("{minutes} minute{}", if minutes == 1 { "" } else { "s" })
    } else {
        format!("{seconds} seconds")
    }
}

fn remaining_phrase(seconds: i64) -> String {
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

fn seed() -> u64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    nanos ^ (u64::from(std::process::id()) << 32)
}

fn print_catalog_warnings(catalog: &Catalog) {
    for warning in &catalog.warnings {
        eprintln!("note: {warning}");
    }
}

fn card(index: usize, prompt: &Prompt, catalog: &Catalog) {
    let pack = catalog
        .pack(&prompt.pack)
        .map_or(prompt.pack.as_str(), |p| p.title.as_str());
    println!("  {index}. {} ({pack})", prompt.title);
    for line in prompt.invitation.lines() {
        println!("     {line}");
    }
    println!(
        "     About {} to {} words.",
        prompt.words_min, prompt.words_max
    );
    println!();
}

fn stored_path(visibility: Visibility, file: &str) -> String {
    format!("{}/{file}", visibility.directory())
}

fn describe_words(words: u32, prompt: Option<&Prompt>) -> String {
    match prompt {
        Some(p) => format!(
            "{words} words (suggested {} to {}; that is only a guide).",
            p.words_min, p.words_max
        ),
        None => format!("{words} words."),
    }
}

fn store_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

// ---- start, resume, scrap ------------------------------------------------------------------

fn start(root: &Path, prompt_id: Option<&str>, opts: &Options) -> Result<(), String> {
    let catalog = voice_store::load_catalog(root);
    print_catalog_warnings(&catalog);
    match voice_session::status(root, clock::now()).map_err(store_error)? {
        Status::None => {}
        Status::Active { session, .. } | Status::Expired { session } => {
            return Err(format!(
                "A writing session for \"{}\" is already open. Carry on with `openblog voice --resume`, or give it up with `openblog voice --scrap --yes`.",
                session.prompt_id
            ))
        }
    }
    let prompt_id = match prompt_id {
        Some(id) => {
            if catalog.prompt(id).is_none() {
                return Err(unknown_prompt(&catalog, id));
            }
            id.to_string()
        }
        None => match choose(root, &catalog) {
            Some(id) => id,
            None => {
                println!("Nothing started.");
                return Ok(());
            }
        },
    };
    let visibility = if opts.portable {
        Visibility::Portable
    } else {
        Visibility::Private
    };
    let session = voice_session::start(
        root,
        &catalog,
        &prompt_id,
        "cli",
        visibility,
        opts.seconds,
        clock::now(),
    )
    .map_err(|error| error.to_string())?;
    drive(root, &catalog, &session, opts)
}

fn choose(root: &Path, catalog: &Catalog) -> Option<String> {
    let library = voice_store::library(root);
    let mut shown: Vec<String> = Vec::new();
    loop {
        let drawn = if shown.is_empty() {
            draw_three(catalog, &library, seed())
        } else {
            let previous: Vec<&str> = shown.iter().map(String::as_str).collect();
            redraw_three(catalog, &library, seed(), &previous)
        };
        if drawn.is_empty() {
            println!("There are no prompts to draw from.");
            return None;
        }
        println!("Three prompts. {}\n", catalog.rule);
        for (index, prompt) in drawn.iter().enumerate() {
            card(index + 1, prompt, catalog);
        }
        shown = drawn.iter().map(|p| p.id.clone()).collect();
        loop {
            print!("Pick 1-{}, r to draw again, q to quit: ", drawn.len());
            let _ = io::stdout().flush();
            let Some(line) = read_line() else {
                println!();
                return None;
            };
            let answer = line.trim().to_lowercase();
            match answer.as_str() {
                "q" | "quit" => return None,
                "r" => break,
                other => {
                    if let Some(prompt) = other
                        .parse::<usize>()
                        .ok()
                        .filter(|n| (1..=drawn.len()).contains(n))
                        .map(|n| drawn[n - 1])
                    {
                        return Some(prompt.id.clone());
                    }
                    println!("Please type a number from 1 to {}, r or q.", drawn.len());
                }
            }
        }
    }
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut current = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != *cb);
            current.push(
                (previous[j] + cost)
                    .min(previous[j + 1] + 1)
                    .min(current[j] + 1),
            );
        }
        previous = current;
    }
    previous[b.len()]
}

fn unknown_prompt(catalog: &Catalog, id: &str) -> String {
    let mut ids: Vec<(usize, &str)> = catalog
        .prompts()
        .map(|p| {
            let near = p.id.contains(id) || id.contains(p.id.as_str());
            let distance = edit_distance(&p.id, id);
            (if near { distance / 4 } else { distance }, p.id.as_str())
        })
        .collect();
    ids.sort();
    let nearby: Vec<&str> = ids.iter().take(3).map(|(_, id)| *id).collect();
    format!(
        "There is no prompt called \"{id}\". Nearby prompt ids: {}. Run `openblog voice --list` to see them all.",
        nearby.join(", ")
    )
}

fn resume(root: &Path, opts: &Options) -> Result<(), String> {
    let catalog = voice_store::load_catalog(root);
    print_catalog_warnings(&catalog);
    match voice_session::resume(root, &catalog, clock::now()).map_err(store_error)? {
        Resume::NoSession => {
            println!("There is no writing session to resume. Start one with `openblog voice`.");
            Ok(())
        }
        Resume::Discarded { prompt_id } => {
            println!(
                "The session for \"{prompt_id}\" ran out of time with nothing written, so it was discarded."
            );
            Ok(())
        }
        Resume::Locked(locked) => {
            let prompt = catalog.prompt(&locked.written.file_prompt());
            println!("The time for this session had run out, so what you had saved was locked.");
            print_saved(
                &locked.written.visibility,
                &locked.written.file,
                locked.words,
                prompt,
            );
            Ok(())
        }
        Resume::Active { session, .. } => {
            println!(
                "Resuming \"{}\". The clock was not restarted.",
                session.prompt_id
            );
            drive(root, &catalog, &session, opts)
        }
    }
}

trait WrittenPrompt {
    fn file_prompt(&self) -> String;
}

impl WrittenPrompt for voice_store::Written {
    /// The prompt id out of the rough file name.
    fn file_prompt(&self) -> String {
        voice::parse_file_name(&self.file)
            .map(|(_, prompt, _)| prompt.to_string())
            .unwrap_or_default()
    }
}

fn print_saved(visibility: &Visibility, file: &str, words: u32, prompt: Option<&Prompt>) {
    println!("Saved your rough draft: {}", stored_path(*visibility, file));
    println!("{}", describe_words(words, prompt));
    println!(
        "It is locked: a rough draft is never edited. To refine a copy, run `openblog voice polish {file}`."
    );
}

fn scrap(root: &Path, yes: bool) -> Result<(), String> {
    match voice_session::status(root, clock::now()).map_err(store_error)? {
        Status::None => {
            println!("There is no writing session to give up.");
            Ok(())
        }
        Status::Active { session, .. } | Status::Expired { session } => {
            if !yes {
                return Err(format!(
                    "This throws away your unsaved session for \"{}\" and writes nothing. Run it again with --yes to confirm.",
                    session.prompt_id
                ));
            }
            voice_session::scrap(root).map_err(store_error)?;
            println!(
                "Gave up the session for \"{}\". Nothing was saved.",
                session.prompt_id
            );
            Ok(())
        }
    }
}

// ---- the timed capture ---------------------------------------------------------------------

fn header_for(prompt: Option<&Prompt>, catalog: &Catalog, session: &Session) -> String {
    let mut header = String::new();
    let comment = |header: &mut String, text: &str| {
        for line in text.lines() {
            header.push_str(&format!("# {line}\n"));
        }
    };
    match prompt {
        Some(p) => {
            comment(&mut header, &p.title);
            comment(&mut header, &p.invitation);
            comment(
                &mut header,
                &format!(
                    "Suggested length: {} to {} words.",
                    p.words_min, p.words_max
                ),
            );
        }
        None => comment(&mut header, &session.prompt_id),
    }
    comment(&mut header, &catalog.rule);
    comment(
        &mut header,
        &format!(
            "Your time ends at {}. Save and close the editor when you are done.",
            clock_time(&session.deadline)
        ),
    );
    comment(
        &mut header,
        "Everything above the marker line below is ignored, and so is the marker. Do not remove it.",
    );
    header
}

fn drive(root: &Path, catalog: &Catalog, session: &Session, opts: &Options) -> Result<(), String> {
    let prompt = catalog.prompt(&session.prompt_id);
    let deadline = DateTime::parse(&session.deadline)
        .ok_or("The session deadline cannot be read.")?
        .unix();
    let now_unix = || clock::now().unix();
    let editor = if opts.stdin {
        None
    } else {
        voice_capture::editor_command()
    };
    let save = |text: &str| {
        let _ = voice_session::save_draft(root, None, text, clock::now());
    };

    println!();
    if let Some(p) = prompt {
        println!("{}", p.title);
        for line in p.invitation.lines() {
            println!("{line}");
        }
        println!("About {} to {} words.", p.words_min, p.words_max);
    }
    println!("{}", catalog.rule);
    println!(
        "Time ends at {} ({} left of {}). Text written after that is not saved.\n",
        clock_time(&session.deadline),
        remaining_phrase(session.remaining_seconds(clock::now())),
        length_phrase(session.time_limit_seconds)
    );

    let captured: Captured = if let Some(editor) = editor {
        let header = header_for(prompt, catalog, session);
        let dir = contained_target(root, Path::new(".openblog/private/voice"))?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Cannot create the voice folder: {e}"))?;
        voice_capture::remove_stale(&dir, "editing");
        let path = dir.join(voice_capture::session_file_name("editing"));
        let mut content = format!("{header}{}\n", voice_capture::MARKER);
        if !session.draft.is_empty() {
            content.push_str(&session.draft);
            content.push('\n');
        }
        println!("Opening your editor (`{editor}`). Write below the marker line, then save and close it.");
        let captured = voice_capture::capture_in_editor(
            &editor,
            &path,
            &header,
            &content,
            deadline,
            &now_unix,
            &mut |text| save(text),
        );
        voice_capture::remove_stale(&dir, "editing");
        captured?
    } else {
        println!(
            "Type your answer. Finish with a line holding only a dot (.), or press Ctrl-D (Ctrl-Z on Windows)."
        );
        if !session.draft.is_empty() {
            println!("Your text so far:\n{}\n", session.draft);
        }
        let lines = voice_capture::spawn_line_reader(|| io::stdin().lock());
        voice_capture::capture_lines(
            &lines,
            &session.draft,
            deadline,
            &now_unix,
            &mut io::stdout(),
            &mut |text| save(text),
        )
    };
    finish(root, catalog, session, prompt, &captured)
}

fn finish(
    root: &Path,
    catalog: &Catalog,
    session: &Session,
    prompt: Option<&Prompt>,
    captured: &Captured,
) -> Result<(), String> {
    if captured.ended == Ended::Deadline {
        println!(
            "\nTime ran out at {}. Anything written after that was not saved.",
            clock_time(&session.deadline)
        );
    }
    if captured.text.trim().is_empty() {
        voice_session::scrap(root).map_err(store_error)?;
        println!("Nothing was written, so nothing was saved.");
        return Ok(());
    }
    // Keep what was written even if the lock below is refused.
    let _ = voice_session::save_draft(root, None, &captured.text, clock::now());
    let locked = voice_session::lock(
        root,
        None,
        catalog,
        Some(&captured.text),
        None,
        clock::now(),
    )
    .map_err(store_error)?;
    println!();
    print_saved(
        &locked.written.visibility,
        &locked.written.file,
        locked.words,
        prompt,
    );
    Ok(())
}

// ---- list ----------------------------------------------------------------------------------

fn list(root: &Path) -> Result<(), String> {
    let catalog = voice_store::load_catalog(root);
    print_catalog_warnings(&catalog);
    let listed = voice_store::list(root);
    let stage_of = |prompt: &str| -> &'static str {
        let mut stage = "-";
        for item in listed
            .iter()
            .filter(|l| l.valid && l.prompt.as_deref() == Some(prompt))
        {
            match item.stage {
                Some(VoiceStage::Polished) => return "polished",
                Some(VoiceStage::Rough) => stage = "rough",
                None => {}
            }
        }
        stage
    };
    println!("Voice prompts (catalog version {})", catalog.version);
    let mut total = 0;
    let mut answered_total = 0;
    let mut empty_packs: Vec<&str> = Vec::new();
    for pack in &catalog.packs {
        let answered = pack
            .prompts
            .iter()
            .filter(|p| stage_of(&p.id) != "-")
            .count();
        total += pack.prompts.len();
        answered_total += answered;
        if answered == 0 {
            empty_packs.push(&pack.id);
        }
        println!(
            "\n{} ({}): {answered} of {} answered",
            pack.title,
            pack.id,
            pack.prompts.len()
        );
        for prompt in &pack.prompts {
            println!(
                "  {:<34} {:<9} {}",
                prompt.id,
                stage_of(&prompt.id),
                prompt.title
            );
        }
    }
    let known: HashSet<&str> = catalog.prompts().map(|p| p.id.as_str()).collect();
    let others: Vec<&Listed> = listed
        .iter()
        .filter(|l| l.valid && l.prompt.as_deref().is_some_and(|p| !known.contains(p)))
        .collect();
    if !others.is_empty() {
        println!("\nSamples whose prompt is not in the catalog now:");
        for item in others {
            println!("  {} ({})", item.file, item.visibility.as_str());
        }
    }
    let invalid: Vec<&Listed> = listed.iter().filter(|l| !l.valid).collect();
    if !invalid.is_empty() {
        println!("\nFiles that need attention:");
        for item in invalid {
            println!(
                "  {} ({}): {}",
                item.file,
                item.visibility.as_str(),
                item.guidance
                    .as_deref()
                    .unwrap_or("This file cannot be used.")
            );
        }
    }
    println!("\n{answered_total} of {total} prompts answered.");
    if !empty_packs.is_empty() && answered_total > 0 {
        println!("Packs with no sample yet: {}.", empty_packs.join(", "));
    }
    if let Some(prompt) = voice_store::open_session_prompt(root) {
        println!("A writing session for \"{prompt}\" is open: `openblog voice --resume`.");
    }
    Ok(())
}

// ---- polish, diff, promote -----------------------------------------------------------------

/// The rough draft that `arg` names, and its polished draft if there is one. `arg` is a sample
/// file name (either stage) or a prompt id.
fn find_pair(root: &Path, arg: &str) -> Result<(Listed, Option<Listed>), String> {
    let name = arg.rsplit(['/', '\\']).next().unwrap_or(arg);
    let all = voice_store::list(root);
    let matches: Vec<&Listed> = all
        .iter()
        .filter(|l| {
            l.file == name
                || l.file.strip_suffix(".md") == Some(name)
                || (l.valid && l.prompt.as_deref() == Some(name))
        })
        .collect();
    if let Some(bad) = matches.iter().find(|l| !l.valid) {
        return Err(format!(
            "{} cannot be used: {}",
            bad.file,
            bad.guidance
                .as_deref()
                .unwrap_or("it is not a valid sample.")
        ));
    }
    let mut roughs: Vec<&Listed> = Vec::new();
    for item in matches {
        let rough = match item.stage {
            Some(VoiceStage::Rough) => Some(item),
            Some(VoiceStage::Polished) => all.iter().find(|l| {
                l.visibility == item.visibility
                    && l.valid
                    && Some(&l.file) == item.rough_of.as_ref()
            }),
            None => None,
        };
        if let Some(rough) = rough {
            if !roughs
                .iter()
                .any(|r| (r.visibility, &r.file) == (rough.visibility, &rough.file))
            {
                roughs.push(rough);
            }
        }
    }
    match roughs.as_slice() {
        [] => Err(format!(
            "No voice sample matches \"{arg}\". Run `openblog voice --list` for prompt ids, or give a sample file name."
        )),
        [rough] => {
            let polished_name = voice::polished_file_name(&rough.file);
            let polished = all.iter().find(|l| {
                l.visibility == rough.visibility
                    && l.valid
                    && l.stage == Some(VoiceStage::Polished)
                    && Some(&l.file) == polished_name.as_ref()
            });
            Ok(((*rough).clone(), polished.cloned()))
        }
        many => Err(format!(
            "More than one sample matches \"{arg}\". Give one file name: {}.",
            many.iter().map(|r| r.file.as_str()).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn polish(root: &Path, arg: &str, options: &HashMap<String, String>) -> Result<(), String> {
    let editor = voice_capture::editor_command().ok_or(
        "`openblog voice polish` opens your editor. Set $VISUAL or $EDITOR first, for example `export EDITOR=nano`.",
    )?;
    let (rough, existing) = find_pair(root, arg)?;
    let visibility = rough.visibility;
    let rough_loaded = voice_store::read(root, visibility, &rough.file).map_err(store_error)?;
    let rough_sample = rough_loaded
        .sample
        .ok_or_else(|| format!("{} cannot be used.", rough.file))?;
    let rough_revision = rough_loaded.listed.revision;
    let current = match &existing {
        Some(item) => {
            let loaded =
                voice_store::read(root, item.visibility, &item.file).map_err(store_error)?;
            let sample = loaded
                .sample
                .ok_or_else(|| format!("{} cannot be used.", item.file))?;
            Some((sample, loaded.listed.revision))
        }
        None => None,
    };
    let seed_text = current
        .as_ref()
        .map_or(rough_sample.body.as_str(), |(sample, _)| {
            sample.body.as_str()
        })
        .to_string();

    let dir = contained_target(root, Path::new(".openblog/private/voice"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the voice folder: {e}"))?;
    voice_capture::remove_stale(&dir, "polishing");
    let path = dir.join(voice_capture::session_file_name("polishing"));
    // The working copy holds the author's text, so it lives under the private folder.
    crate::landing_history::keep_out_of_git(root);
    std::fs::write(&path, format!("{seed_text}\n"))
        .map_err(|e| format!("Cannot create the working copy: {e}"))?;
    println!(
        "Opening {} in your editor. Your rough draft stays as it is.",
        if current.is_some() {
            "your polished draft"
        } else {
            "a copy of your rough draft"
        }
    );
    let edited = voice_capture::edit_file(&editor, &path);
    let bytes = std::fs::read(&path);
    let _ = std::fs::remove_file(&path);
    voice_capture::remove_stale(&dir, "polishing");
    edited?;
    let text = String::from_utf8(bytes.map_err(|e| format!("Cannot read the edited copy: {e}"))?)
        .map_err(|_| {
        "The edited copy is not valid UTF-8 text, so nothing was saved.".to_string()
    })?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text = text.strip_suffix('\n').unwrap_or(&text).to_string();

    if text.trim().is_empty() {
        println!("The polished draft would be empty, so nothing was saved.");
        return Ok(());
    }
    let metadata_given = ["title", "slug", "description", "tags"]
        .iter()
        .any(|k| options.contains_key(*k));
    if text == seed_text && !metadata_given {
        println!("No changes, so nothing was saved.");
        return Ok(());
    }
    // The rough file is frozen. If its bytes moved while the editor was open, stop.
    let after = voice_store::read(root, visibility, &rough.file).map_err(store_error)?;
    if after.listed.revision != rough_revision {
        return Err(format!(
            "{} changed while you were editing, which should never happen. Nothing was saved.",
            rough.file
        ));
    }

    let (mut sample, expected) = match current {
        Some((sample, revision)) => (sample, Some(revision)),
        None => {
            let mut sample = rough_sample.clone();
            sample.voice = VoiceMeta {
                stage: VoiceStage::Polished,
                time_limit_seconds: 0,
                rough_of: Some(rough.file.clone()),
                ..rough_sample.voice.clone()
            };
            (sample, None)
        }
    };
    sample.body = text;
    sample.voice.words = voice::count_words(&sample.body);
    if let Some(title) = options.get("title") {
        sample.title = title.trim().to_string();
    }
    if let Some(slug) = options.get("slug") {
        sample.slug = openblog_core::slug::slugify(slug);
    }
    if let Some(description) = options.get("description") {
        let description = description.trim();
        sample.description = (!description.is_empty()).then(|| description.to_string());
    }
    if let Some(tags) = options.get("tags") {
        sample.tags = tags
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
    }
    let written = voice_store::write_polished(root, visibility, &sample, expected.as_deref())
        .map_err(store_error)?;
    println!(
        "Saved your polished draft: {}",
        stored_path(written.visibility, &written.file)
    );
    println!(
        "{} The rough draft was not touched.",
        describe_words(sample.voice.words, None)
    );
    println!("See what changed: `openblog voice diff {}`.", written.file);
    println!(
        "Make a post draft from it: `openblog voice promote {}`.",
        written.file
    );
    Ok(())
}

fn diff(root: &Path, arg: &str) -> Result<(), String> {
    let (rough, polished) = find_pair(root, arg)?;
    let polished = polished.ok_or_else(|| {
        format!(
            "{} has no polished draft yet. Make one with `openblog voice polish {}`.",
            rough.file, rough.file
        )
    })?;
    let read = |item: &Listed| -> Result<String, String> {
        voice_store::read(root, item.visibility, &item.file)
            .map_err(store_error)?
            .sample
            .map(|s| s.body)
            .ok_or_else(|| format!("{} cannot be used.", item.file))
    };
    let text = crate::voice_diff::unified(
        &format!("rough/{}", rough.file),
        &format!("polished/{}", polished.file),
        &read(&rough)?,
        &read(&polished)?,
    );
    if text.is_empty() {
        println!("The polished draft has the same text as the rough draft.");
    } else {
        print!("{text}");
    }
    Ok(())
}

fn promote(root: &Path, arg: &str, dir: Option<&str>) -> Result<(), String> {
    let (rough, polished) = find_pair(root, arg)?;
    let polished = polished.ok_or_else(|| {
        format!(
            "{} has no polished draft. Only a polished draft can become a post, and a rough draft is never edited: run `openblog voice polish {}` first.",
            rough.file, rough.file
        )
    })?;
    let _transaction = transaction::ContentTransactionLock::acquire(root)?;
    let created =
        voice_store::promote_to_post_draft(root, polished.visibility, &polished.file, dir)
            .map_err(store_error)?;
    let created: PathBuf = created;
    println!("Created {} as a draft.", created.display());
    println!("It is not published while it says `draft: true`. Edit it, then remove that line when it is ready.");
    println!("Your voice samples were not changed.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_invitation_needs_a_person_at_a_terminal_a_new_project_and_no_opt_out() {
        assert!(should_invite(true, true, false, true));
        assert!(!should_invite(false, true, false, true), "piped stdin");
        assert!(!should_invite(true, false, false, true), "piped stdout");
        assert!(!should_invite(true, true, true, true), "--no-voice");
        assert!(!should_invite(true, true, false, false), "nothing created");
    }

    #[test]
    fn nearby_ids_are_offered_for_a_mistyped_prompt() {
        let catalog = voice_store::load_catalog(Path::new("."));
        let first = catalog.prompts().next().unwrap().id.clone();
        let typo = format!("{first}x");
        let message = unknown_prompt(&catalog, &typo);
        assert!(
            message.contains(&format!("\"{typo}\"")) && message.contains(&first),
            "{message}"
        );
    }

    #[test]
    fn times_and_lengths_read_plainly() {
        assert_eq!(clock_time("2026-10-28T14:03:22Z"), "14:03:22 UTC");
        assert_eq!(length_phrase(180), "3 minutes");
        assert_eq!(length_phrase(60), "1 minute");
        assert_eq!(length_phrase(45), "45 seconds");
        assert_eq!(remaining_phrase(125), "2:05");
    }
}

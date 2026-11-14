//! Studio's words (docs/studio-words.md, docs/specs/studio/words/spec.md W1–W5): a site's
//! `studio.words` and the host's file named by `OPENBLOG_STUDIO_WORDS_PATH`, each entry checked
//! against Studio's own catalog (`web/studio/words.json`, generated from `parts/*-words.js` and
//! embedded with Studio's files), then merged per key: built-in < host's file < site.
//!
//! A bad entry is dropped with a problem in words; the rest apply, and Studio never stops for one.
//! Problems are for the developer: Home's details in Studio and `openblog check`.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use openblog_core::config::StudioWords;
use serde_json::{json, Value as Json};

/// The environment variable naming the host's file (read once, when the server starts).
pub(crate) const PATH_VAR: &str = "OPENBLOG_STUDIO_WORDS_PATH";
const FILE_MAX_BYTES: u64 = 64 * 1024;
const FILE_MAX_ENTRIES: usize = 500;
const VAR_MAX: usize = 60;
const VARS: [&str; 3] = ["helper", "product", "owner"];

/// One id in Studio's catalog: who reads it, how long a change may be, the variables it uses.
struct Entry {
    her: bool,
    max: usize,
    vars: Vec<String>,
    /// Its words with no name for her: `Some("")` allows an empty change.
    bare: Option<String>,
}

struct Catalog {
    defaults: BTreeMap<String, String>,
    banned: Vec<String>,
    words: BTreeMap<String, Entry>,
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let bytes = crate::studio_files::STUDIO_FILES
            .iter()
            .find(|(name, _)| *name == "words.json")
            .map(|(_, bytes)| *bytes)
            .unwrap_or(b"{}");
        parse_catalog(bytes)
    })
}

fn parse_catalog(bytes: &[u8]) -> Catalog {
    let value: Json = serde_json::from_slice(bytes).unwrap_or(Json::Null);
    let text = |v: &Json| v.as_str().unwrap_or_default().to_string();
    let defaults = value["vars"]
        .as_object()
        .map(|vars| vars.iter().map(|(k, v)| (k.clone(), text(v))).collect())
        .unwrap_or_default();
    let banned = value["banned"]
        .as_array()
        .map(|list| list.iter().map(text).collect())
        .unwrap_or_default();
    let words = value["words"]
        .as_object()
        .map(|words| {
            words
                .iter()
                .map(|(id, e)| {
                    let entry = Entry {
                        her: e["layer"] == "her",
                        max: e["max"].as_u64().unwrap_or(240) as usize,
                        vars: e["vars"]
                            .as_array()
                            .map(|v| v.iter().map(text).collect())
                            .unwrap_or_default(),
                        bare: e.get("bare").and_then(Json::as_str).map(str::to_string),
                    };
                    (id.clone(), entry)
                })
                .collect()
        })
        .unwrap_or_default();
    Catalog {
        defaults,
        banned,
        words,
    }
}

/// A problem with one entry, in words, for the developer.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Problem {
    /// `"site"` (openblog.json) or `"server"` (the host's file).
    pub place: &'static str,
    pub key: String,
    pub words: String,
}

impl Problem {
    fn json(&self) -> Json {
        json!({ "where": self.place, "key": self.key, "words": self.words })
    }
}

/// The host's file, as read for one `meta`: its entries, or why it was set aside.
pub(crate) fn read_host_file(path: Option<&Path>) -> (StudioWords, Vec<Problem>) {
    let Some(path) = path else {
        return (StudioWords::default(), Vec::new());
    };
    let whole = |words: String| {
        vec![Problem {
            place: "server",
            key: String::new(),
            words,
        }]
    };
    let shown = path.display();
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > FILE_MAX_BYTES => {
            return (
                StudioWords::default(),
                whole(format!(
                    "The server's words file {shown} is larger than 64 KiB, so none of it is used."
                )),
            )
        }
        Ok(_) => {}
        Err(error) => {
            return (
                StudioWords::default(),
                whole(format!(
                "The server's words file {shown} can't be read ({error}), so none of it is used."
            )),
            )
        }
    }
    let parsed = std::fs::read(path)
        .map_err(|error| error.to_string())
        .and_then(|bytes| serde_json::from_slice::<Json>(&bytes).map_err(|e| e.to_string()));
    let value = match parsed {
        Ok(value) => value,
        Err(error) => {
            return (
                StudioWords::default(),
                whole(format!(
                    "The server's words file {shown} isn't JSON ({error}), so none of it is used."
                )),
            )
        }
    };
    let Some(object) = value.as_object() else {
        return (
            StudioWords::default(),
            whole(format!(
                "The server's words file {shown} must be an object with \"vars\" and \"text\", so none of it is used."
            )),
        );
    };
    let mut problems = Vec::new();
    let mut words = StudioWords::default();
    for (key, part) in object {
        let target = match key.as_str() {
            "vars" => &mut words.vars,
            "text" => &mut words.text,
            other => {
                problems.push(Problem {
                    place: "server",
                    key: other.to_string(),
                    words: format!("{other} isn't used: the file has only \"vars\" and \"text\"."),
                });
                continue;
            }
        };
        match part.as_object() {
            Some(entries) => target.extend(entries.iter().map(|(k, v)| (k.clone(), v.clone()))),
            None => problems.push(Problem {
                place: "server",
                key: key.clone(),
                words: format!("\"{key}\" must be an object."),
            }),
        }
    }
    if words.vars.len() + words.text.len() > FILE_MAX_ENTRIES {
        return (
            StudioWords::default(),
            whole(format!(
                "The server's words file {shown} has more than {FILE_MAX_ENTRIES} entries, so none of it is used."
            )),
        );
    }
    (words, problems)
}

/// Why a value can't be shown as plain words, or `None`.
fn plain_problem(value: &str) -> Option<&'static str> {
    if value.chars().any(|c| c.is_control()) {
        return Some("has a control character");
    }
    if value
        .chars()
        .any(|c| matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'))
    {
        return Some("has a text-direction character");
    }
    // A stand-in for NFC without a Unicode table: letters must be written whole ("é", not "e"
    // and a separate accent), so the same words always compare and count the same.
    if value.chars().any(|c| {
        matches!(c, '\u{0300}'..='\u{036F}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}' | '\u{20D0}'..='\u{20FF}' | '\u{FE20}'..='\u{FE2F}')
    }) {
        return Some("has an accent typed as a separate mark (write the letter whole)");
    }
    if value.contains('<') || value.contains('>') {
        return Some("has < or >, and words are shown as text only");
    }
    let lower = value.to_ascii_lowercase();
    if lower.contains("://") || lower.contains("www.") {
        return Some("has a link, and words are shown as text only");
    }
    if value.trim() != value {
        return Some("starts or ends with a space");
    }
    None
}

/// The first banned word in `value`, as a whole word in any case.
fn banned_in<'a>(value: &str, banned: &'a [String]) -> Option<&'a str> {
    let words: String = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    banned.iter().map(String::as_str).find(|ban| {
        words.match_indices(ban).any(|(at, _)| {
            let before = words[..at].chars().next_back();
            let after = words[at + ban.len()..].chars().next();
            !before.is_some_and(is_word) && !after.is_some_and(is_word)
        })
    })
}

/// The `{name}`s a text uses, or `Err` when a brace isn't part of one.
fn variables(value: &str) -> Result<Vec<String>, ()> {
    let mut out = Vec::new();
    let mut rest = value;
    while let Some(open) = rest.find(['{', '}']) {
        if rest[open..].starts_with('}') {
            return Err(());
        }
        let tail = &rest[open + 1..];
        let close = tail.find('}').ok_or(())?;
        let name = &tail[..close];
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphabetic()) {
            return Err(());
        }
        out.push(name.to_string());
        rest = &tail[close + 1..];
    }
    Ok(out)
}

/// Case-insensitive edit distance, for "Did you mean".
fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.to_lowercase().chars().collect();
    let b: Vec<char> = b.to_lowercase().chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let here = row[j + 1];
            row[j + 1] = if ca == cb {
                prev
            } else {
                1 + prev.min(row[j]).min(row[j + 1])
            };
            prev = here;
        }
    }
    row[b.len()]
}

fn nearest_id(id: &str, catalog: &Catalog) -> Option<String> {
    catalog
        .words
        .keys()
        .map(|known| (distance(id, known), known))
        .filter(|(d, _)| *d <= 4.max(id.len() / 3))
        .min()
        .map(|(_, known)| known.clone())
}

fn check_var(name: &str, value: &Json, catalog: &Catalog) -> Result<String, String> {
    if !VARS.contains(&name) {
        return Err(format!(
            "{name} isn't a variable. The variables are helper, product and owner."
        ));
    }
    let Some(value) = value.as_str() else {
        return Err(format!("{name} must be text."));
    };
    if value.is_empty() && name == "owner" {
        return Ok(String::new());
    }
    if value.trim().is_empty() {
        return Err(format!("{name} is empty."));
    }
    if let Some(why) = plain_problem(value) {
        return Err(format!("{name} {why}."));
    }
    if value.chars().count() > VAR_MAX {
        return Err(format!("{name} is longer than {VAR_MAX} characters."));
    }
    if value.contains('{') || value.contains('}') {
        return Err(format!("{name} has {{ or }}, which a variable can't."));
    }
    if let Some(word) = banned_in(value, &catalog.banned) {
        return Err(format!(
            "{name} uses “{word}”, a word she never sees on her screens."
        ));
    }
    Ok(value.to_string())
}

fn check_text(id: &str, value: &Json, catalog: &Catalog) -> Result<String, String> {
    let Some(entry) = catalog.words.get(id) else {
        let hint = nearest_id(id, catalog)
            .map(|near| format!(" Did you mean {near}?"))
            .unwrap_or_default();
        return Err(format!("{id} isn't a word id.{hint}"));
    };
    let Some(value) = value.as_str() else {
        return Err(format!("{id} must be text."));
    };
    if value.is_empty() && entry.bare.as_deref() == Some("") {
        return Ok(String::new());
    }
    if value.trim().is_empty() {
        return Err(format!("{id} is empty."));
    }
    if let Some(why) = plain_problem(value) {
        return Err(format!("{id} {why}."));
    }
    if value.chars().count() > entry.max {
        return Err(format!("{id} is longer than {} characters.", entry.max));
    }
    let allowed: Vec<&str> = VARS
        .iter()
        .copied()
        .chain(entry.vars.iter().map(String::as_str))
        .collect();
    let used = variables(value)
        .map_err(|()| format!("{id} has a {{ or }} that isn't a variable like {{helper}}."))?;
    if let Some(unknown) = used.iter().find(|name| !allowed.contains(&name.as_str())) {
        let mut names: Vec<String> = allowed.iter().map(|n| format!("{{{n}}}")).collect();
        names.dedup();
        return Err(format!(
            "{id} uses {{{unknown}}}, which it can't. It may use {}.",
            names.join(", ")
        ));
    }
    if entry.her {
        if let Some(word) = banned_in(value, &catalog.banned) {
            return Err(format!(
                "{id} uses “{word}”, a word she never sees on her screens."
            ));
        }
    }
    Ok(value.to_string())
}

/// The words in effect: `{ vars, text, from, problems }` for `meta.studioWords`.
pub(crate) fn resolve(
    site: &StudioWords,
    host: &StudioWords,
    host_problems: Vec<Problem>,
    author_name: &str,
) -> (Json, Vec<Problem>) {
    let catalog = catalog();
    let mut vars: BTreeMap<String, String> = catalog.defaults.clone();
    vars.insert(
        "owner".into(),
        author_name
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string(),
    );
    let mut text: BTreeMap<String, String> = BTreeMap::new();
    let mut from: BTreeMap<String, &'static str> = BTreeMap::new();
    let mut problems = host_problems;
    // The host's file first, then the site over it, per key.
    for (place, words) in [("server", host), ("site", site)] {
        for (name, value) in &words.vars {
            match check_var(name, value, catalog) {
                Ok(value) => {
                    vars.insert(name.clone(), value);
                    from.insert(name.clone(), place);
                }
                Err(words) => problems.push(Problem {
                    place,
                    key: name.clone(),
                    words,
                }),
            }
        }
        for (id, value) in &words.text {
            match check_text(id, value, catalog) {
                Ok(value) => {
                    text.insert(id.clone(), value);
                    from.insert(id.clone(), place);
                }
                Err(words) => problems.push(Problem {
                    place,
                    key: id.clone(),
                    words,
                }),
            }
        }
    }
    let reply = json!({
        "vars": vars,
        "text": text,
        "from": from,
        "problems": problems.iter().map(Problem::json).collect::<Vec<_>>(),
    });
    (reply, problems)
}

/// `meta.studioWords` for a site, reading the host's file now.
pub(crate) fn for_meta(
    config: &openblog_core::config::SiteConfig,
    host_path: Option<&Path>,
) -> Json {
    let (host, host_problems) = read_host_file(host_path);
    resolve(
        &config.studio.words,
        &host,
        host_problems,
        &config.author.name,
    )
    .0
}

/// The host's file named by the environment, if any (read when the server starts).
pub(crate) fn host_path_from_env() -> Option<std::path::PathBuf> {
    std::env::var_os(PATH_VAR)
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(value: Json) -> StudioWords {
        serde_json::from_value(value).unwrap()
    }

    fn site(value: Json) -> (Json, Vec<Problem>) {
        resolve(&words(value), &StudioWords::default(), Vec::new(), "")
    }

    fn only_problem(value: Json) -> String {
        let (reply, problems) = site(value);
        assert_eq!(problems.len(), 1, "{reply}");
        problems[0].words.clone()
    }

    #[test]
    fn with_nothing_set_only_the_built_in_variables() {
        let (reply, problems) = resolve(
            &StudioWords::default(),
            &StudioWords::default(),
            Vec::new(),
            "",
        );
        assert!(problems.is_empty());
        assert_eq!(
            reply,
            json!({
                "vars": { "helper": "the person who set up your site", "product": "your blog", "owner": "" },
                "text": {}, "from": {}, "problems": []
            })
        );
        // Her name is the first word of the author's.
        let (reply, _) = resolve(
            &StudioWords::default(),
            &StudioWords::default(),
            Vec::new(),
            "Grammi Nichols",
        );
        assert_eq!(reply["vars"]["owner"], "Grammi");
    }

    #[test]
    fn grammis_house_words_apply() {
        let (reply, problems) = site(json!({
            "vars": { "helper": "Mikey", "owner": "Grammi" },
            "text": {
                "cards.signOff": "Love, {owner}",
                "recipe.notesHeading": "{owner}'s notes",
                "decorations.everyday": "Your house is wearing its everyday look: {theme}.",
                "decorations.decorated": "Your house is decorated for {theme}."
            }
        }));
        assert_eq!(problems, Vec::new());
        assert_eq!(reply["vars"]["helper"], "Mikey");
        assert_eq!(reply["text"]["cards.signOff"], "Love, {owner}");
        assert_eq!(reply["from"]["helper"], "site");
        assert_eq!(reply["from"]["decorations.decorated"], "site");
    }

    #[test]
    fn each_rule_drops_its_entry_and_says_why() {
        // Length: a variable, and a sentence past its own limit.
        assert!(
            only_problem(json!({ "vars": { "helper": "x".repeat(61) } }))
                .contains("longer than 60")
        );
        assert!(
            only_problem(json!({ "text": { "cards.signOff": "x".repeat(81) } }))
                .contains("longer than 80")
        );
        // Letters written whole (NFC): "é" as e + a combining accent is refused, whole "é" is fine.
        assert!(
            only_problem(json!({ "vars": { "helper": "Rene\u{0301}e" } }))
                .contains("separate mark")
        );
        assert!(site(json!({ "vars": { "helper": "Renée" } })).1.is_empty());
        // Control and text-direction characters.
        assert!(only_problem(json!({ "vars": { "helper": "Mi\u{0007}key" } })).contains("control"));
        assert!(
            only_problem(json!({ "text": { "common.tell": "Tell \u{202E}{helper}." } }))
                .contains("direction")
        );
        // Markup and links.
        assert!(
            only_problem(json!({ "text": { "common.tell": "Tell <b>{helper}</b>." } }))
                .contains("< or >")
        );
        assert!(
            only_problem(json!({ "text": { "common.tell": "See https://example.com." } }))
                .contains("link")
        );
        assert!(only_problem(json!({ "vars": { "helper": "www.example.com" } })).contains("link"));
        // An unknown id, with the nearest one.
        assert_eq!(
            only_problem(json!({ "text": { "card.signoff": "Love" } })),
            "card.signoff isn't a word id. Did you mean cards.signOff?"
        );
        // An unknown variable, and a stray brace.
        assert!(
            only_problem(json!({ "text": { "common.tell": "Tell {nobody}." } }))
                .starts_with("common.tell uses {nobody}, which it can't.")
        );
        assert!(
            only_problem(json!({ "text": { "common.tell": "Tell {helper." } }))
                .contains("isn't a variable")
        );
        assert!(only_problem(json!({ "vars": { "helper": "Mikey {x}" } })).contains("{ or }"));
        assert!(only_problem(json!({ "vars": { "site": "x" } })).contains("isn't a variable"));
        // Not text.
        assert_eq!(
            only_problem(json!({ "vars": { "owner": 3 } })),
            "owner must be text."
        );
        assert_eq!(
            only_problem(json!({ "text": { "common.tell": ["Tell"] } })),
            "common.tell must be text."
        );
        // Empty: only a sign-off may be (its bare words are empty), and her name.
        assert!(only_problem(json!({ "text": { "common.tell": "" } })).contains("empty"));
        assert!(
            site(json!({ "text": { "cards.signOff": "" }, "vars": { "owner": "" } }))
                .1
                .is_empty()
        );
        // Spaces at the ends.
        assert!(only_problem(json!({ "vars": { "helper": " Mikey" } })).contains("space"));
    }

    #[test]
    fn a_banned_word_is_refused_on_her_words_and_every_variable() {
        assert_eq!(
            only_problem(json!({ "text": { "common.tell": "Tell {helper} to deploy it." } })),
            "common.tell uses “deploy”, a word she never sees on her screens."
        );
        assert!(only_problem(json!({ "vars": { "helper": "the Sync team" } })).contains("“sync”"));
        // Whole words only: "pushy" isn't "push".
        assert!(site(json!({ "vars": { "helper": "Pushy Pete" } }))
            .1
            .is_empty());
    }

    #[test]
    fn a_details_id_may_use_system_words() {
        let catalog = parse_catalog(
            br#"{"vars":{"helper":"h","product":"p"},"banned":["git"],"words":{"x.y":{"text":"a","layer":"details","max":40,"vars":[]},"x.z":{"text":"a","layer":"her","max":40,"vars":[]}}}"#,
        );
        assert!(check_text("x.y", &json!("From Git."), &catalog).is_ok());
        assert!(check_text("x.z", &json!("From Git."), &catalog).is_err());
    }

    #[test]
    fn precedence_is_built_in_then_host_then_site_per_key() {
        let host = words(json!({
            "vars": { "helper": "Hillside Web Care", "product": "your website" },
            "text": { "common.tell": "Call {helper}.", "common.ask": "Ask {helper} today." }
        }));
        let site = words(json!({
            "vars": { "helper": "Mikey" },
            "text": { "common.tell": "Tell {helper} now." }
        }));
        let (reply, problems) = resolve(&site, &host, Vec::new(), "Dana Ridge");
        assert!(problems.is_empty());
        assert_eq!(reply["vars"]["helper"], "Mikey");
        assert_eq!(reply["vars"]["product"], "your website");
        assert_eq!(reply["vars"]["owner"], "Dana");
        assert_eq!(reply["text"]["common.tell"], "Tell {helper} now.");
        assert_eq!(reply["text"]["common.ask"], "Ask {helper} today.");
        assert_eq!(
            reply["from"],
            json!({ "helper": "site", "product": "server", "common.tell": "site", "common.ask": "server" })
        );
    }

    #[test]
    fn problems_never_drop_the_valid_entries() {
        let (reply, problems) = site(json!({
            "vars": { "helper": "Mikey", "product": "<b>" },
            "text": { "common.tell": "Tell {helper}, please.", "card.signoff": "x" }
        }));
        assert_eq!(problems.len(), 2);
        assert_eq!(reply["vars"]["helper"], "Mikey");
        assert_eq!(reply["vars"]["product"], "your blog");
        assert_eq!(reply["text"]["common.tell"], "Tell {helper}, please.");
        assert_eq!(reply["problems"][0]["where"], "site");
        assert!(reply["problems"][0]["key"].is_string());
    }

    #[test]
    fn the_hosts_file_is_read_whole_or_set_aside() {
        let dir = std::env::temp_dir().join(format!("studio-words-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // Unreadable.
        let missing = dir.join("missing.json");
        let (words, problems) = read_host_file(Some(&missing));
        assert_eq!(words, StudioWords::default());
        assert!(problems[0].words.contains("can't be read"), "{problems:?}");
        assert_eq!(problems[0].place, "server");
        // Not JSON.
        let bad = dir.join("bad.json");
        std::fs::write(&bad, "{ vars: ").unwrap();
        assert!(read_host_file(Some(&bad)).1[0].words.contains("isn't JSON"));
        // Too large.
        let big = dir.join("big.json");
        std::fs::write(
            &big,
            format!("{{\"vars\":{{\"helper\":\"{}\"}}}}", "x".repeat(70_000)),
        )
        .unwrap();
        assert!(read_host_file(Some(&big)).1[0].words.contains("64 KiB"));
        // Too many entries.
        let many = dir.join("many.json");
        let text: serde_json::Map<String, Json> =
            (0..501).map(|i| (format!("x.y{i}"), json!("a"))).collect();
        std::fs::write(&many, json!({ "text": text }).to_string()).unwrap();
        assert!(read_host_file(Some(&many)).1[0]
            .words
            .contains("500 entries"));
        // A good one, with an extra key reported.
        let good = dir.join("good.json");
        std::fs::write(
            &good,
            r#"{"vars":{"helper":"Hillside Web Care"},"colour":"red"}"#,
        )
        .unwrap();
        let (words, problems) = read_host_file(Some(&good));
        assert_eq!(words.vars["helper"], "Hillside Web Care");
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].key, "colour");
        // No file named: nothing at all.
        assert_eq!(read_host_file(None), (StudioWords::default(), Vec::new()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_catalog_is_studios_own() {
        let catalog = catalog();
        assert!(catalog.words.contains_key("common.tell"));
        assert!(catalog.words["common.tell"].her);
        assert_eq!(catalog.words["cards.signOff"].max, 80);
        assert_eq!(catalog.words["cards.signOff"].bare.as_deref(), Some(""));
        assert_eq!(
            catalog.defaults["helper"],
            "the person who set up your site"
        );
        assert!(catalog.banned.iter().any(|w| w == "deploy"));
    }
}

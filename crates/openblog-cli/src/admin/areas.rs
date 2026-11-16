//! Feature areas (Studio ONB1, ADRs 0416 to 0418): which parts of Studio a site already uses, each
//! login's first-run answers and hidden areas, and the site changes the answers suggest.
//!
//! - `GET areas`: this login's preferences (version 2), their revision, the areas the site uses
//!   and the kind `openblog init` recorded.
//! - `PUT areas`: change any of them, from the revision the screen started with.
//! - `POST areas/suggestions`: what the answers suggest for the site, each change shown exactly.
//! - `POST areas/suggestions/apply`: make one suggested change, only from the file it was shown on.
//!
//! The preferences are presentation, private to one login, never built or published. The areas in
//! use are computed from the site's files every time and stored nowhere. A suggestion edits one
//! member of `openblog.json` as text, so everything else stays byte for byte.

use super::*;
use crate::admin_preferences as prefs;
use crate::config_text;

/// The preferences are far smaller than this.
pub(super) const MAX_REQUEST_BYTES: usize = 16 * 1024;

/// Where `openblog init` writes the kind it was given or asked (ADR 0418).
pub(crate) const HINT_FILE: &str = ".openblog/onboarding.json";

/// The kind `openblog init` recorded, when it is one Studio knows.
pub(crate) fn hint(root: &Path) -> Option<&'static str> {
    let bytes = crate::private_file::read(&root.join(HINT_FILE), 4096).ok()??;
    let value: Json = serde_json::from_slice(&bytes).ok()?;
    let kind = value.get("kind")?.as_str()?;
    prefs::KIND_IDS.iter().copied().find(|k| *k == kind)
}

/// Whether a post's body has a diagram or a question for readers: `(diagram, question)`. A
/// fence's first word names it (```` ```mermaid ````, ```` ```quiz ````). Plain code examples don't
/// count: every new site's first post has one, and a code example already in a post shows as
/// itself in Write whatever is hidden (only the add menu's code items follow the area).
fn fences(body: &str) -> (bool, bool) {
    let mut code = false;
    let mut question = false;
    let mut open: Option<&str> = None;
    for line in body.lines() {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            "```"
        } else if trimmed.starts_with("~~~") {
            "~~~"
        } else {
            continue;
        };
        match open {
            Some(fence) if fence == marker => open = None,
            Some(_) => {}
            None => {
                open = Some(marker);
                let info = trimmed.trim_start_matches(['`', '~']).trim();
                match info.split_whitespace().next() {
                    Some("quiz") => question = true,
                    Some("mermaid") => code = true,
                    _ => {}
                }
            }
        }
        if code && question {
            break;
        }
    }
    (code, question)
}

/// The areas the site already uses, from its settings and the sources `meta` loaded (each post's
/// front matter is parsed once). Ids from [`prefs::AREA_IDS`], in that order. `together` is the
/// login's own (`meta.together`), so Studio adds it.
pub(super) fn in_use(
    state: &AppState,
    config: &SiteConfig,
    sources: &openblog_core::Sources,
) -> Vec<&'static str> {
    let mut recipe = false;
    let mut job = false;
    let mut code = false;
    let mut question = false;
    for file in &sources.posts {
        if let Ok(doc) = frontmatter::parse(&file.contents) {
            match doc.front_matter.get("profile") {
                Some("recipe") => recipe = true,
                Some("job") => job = true,
                _ => {}
            }
            if !(code && question) {
                let (c, q) = fences(&doc.body);
                code |= c;
                question |= q;
            }
        }
    }
    let trade = config.business != openblog_core::business::BusinessConfig::default()
        || !sources.services.is_empty()
        || !sources.proof.is_empty()
        || !config.business.trade.is_empty()
        || config.seasonal_prompts.enabled
        || job;
    let seasonal = config.seasons.enabled
        || !config.decorations.is_empty()
        || greetings::is_configured()
        || gifts::is_configured();
    let sharing = social::is_configured()
        || crate::outcomes::any_shared(&state.root, config)
        || config
            .syndication
            .pinterest
            .as_ref()
            .is_some_and(|pins| pins.enabled)
        || !config.syndication.targets.is_empty();
    // Comments are on. Visitor numbers alone don't count: every served site has the counter, and
    // hiding Readers loses nothing she made.
    let readers = config.engagement.enabled;
    let research = research::site_uses_research(&state.root, config, sources)
        || config.interpretations.publish
        || has_json_files(&state.root.join(&config.paths.content).join("comparisons"));
    let teaching = config.reading_paths.publish
        || has_json_files(&state.root.join(&config.paths.content).join("paths"))
        || question;
    let uses = [
        ("pages", !sources.pages.is_empty()),
        ("collections", !sources.series.is_empty()),
        ("recipes", recipe),
        ("trade", trade),
        ("seasonal", seasonal),
        ("sharing", sharing),
        ("readers", readers),
        ("research", research),
        ("teaching", teaching),
        ("code", code),
    ];
    uses.iter()
        .filter(|(_, used)| *used)
        .map(|(id, _)| *id)
        .collect()
}

fn body_object(req: &Request) -> Result<Map<String, Json>, Response> {
    require_json(req)?;
    if req.body.len() > MAX_REQUEST_BYTES {
        return Err(Response::error(413, "That request is too large"));
    }
    match serde_json::from_slice::<Json>(&req.body) {
        Ok(Json::Object(body)) => Ok(body),
        _ => Err(Response::error(400, "Invalid JSON")),
    }
}

/// What `meta.areas` and `GET areas` share: the view, its revision and the init hint.
fn described(stored: &prefs::Stored, root: &Path) -> Json {
    let mut view = prefs::view(stored);
    view["etag"] = json!(stored.etag);
    view["hint"] = hint(root).map_or(Json::Null, |kind| json!(kind));
    view
}

/// `meta.areas` for the signed-in login: its preferences and the areas in use (`inUse`, given by
/// `meta`). An unreadable file is shown as nothing hidden, and says so.
pub(super) fn meta_json(state: &AppState, user: &str, in_use: &Json) -> Json {
    let mut out = match prefs::read(&state.root, user) {
        Ok(stored) => described(&stored, &state.root),
        Err(_) => {
            let mut view = prefs::view(&prefs::Stored {
                object: Map::new(),
                etag: String::new(),
                exists: false,
            });
            view["unreadable"] = json!(true);
            view["etag"] = json!("");
            view
        }
    };
    out["inUse"] = in_use.clone();
    out
}

fn site_in_use(state: &AppState) -> Json {
    let _content = lock(&state.build);
    let Ok(config) = site::load_config(&state.root) else {
        return json!([]);
    };
    let sources = site::read_sources(&state.root, &config).unwrap_or_default();
    json!(in_use(state, &config, &sources))
}

/// `GET areas`: `{ preferences, etag, inUse, hint }`.
pub(super) fn get(state: &AppState, user: &str) -> Response {
    let in_use = site_in_use(state);
    match prefs::read(&state.root, user) {
        Ok(stored) => Response::json(
            200,
            &json!({
                "preferences": prefs::view(&stored),
                "etag": stored.etag,
                "inUse": in_use,
                "hint": hint(&state.root),
            }),
        ),
        Err(error) => Response::json(
            500,
            &json!({ "error": format!("These preferences can't be read: {error}"), "code": "unreadable" }),
        ),
    }
}

/// `PUT areas`: `{ etag, ...changes }`. A revision that moved answers 409 with the newer one.
pub(super) fn put(state: &AppState, req: &Request, user: &str) -> Response {
    let mut body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(Json::String(etag)) = body.remove("etag") else {
        return Response::error(400, "`etag` is required (\"\" for a login with none yet)");
    };
    let _guard = lock(&state.build);
    let stored = match prefs::read(&state.root, user) {
        Ok(stored) => stored,
        Err(error) => {
            return Response::json(
                500,
                &json!({ "error": format!("These preferences can't be read: {error}"), "code": "unreadable" }),
            )
        }
    };
    if stored.etag != etag {
        return Response::json(
            409,
            &json!({
                "error": "These preferences were changed somewhere else",
                "code": "stale",
                "preferences": prefs::view(&stored),
                "etag": stored.etag,
            }),
        );
    }
    let next = match prefs::apply(&prefs::view(&stored), &body, &clock::now().rfc3339()) {
        Ok(next) => next,
        Err(error) => return Response::error(400, &error),
    };
    match prefs::write(&state.root, user, &stored, &next) {
        Ok(saved) => Response::json(
            200,
            &json!({ "preferences": prefs::view(&saved), "etag": saved.etag }),
        ),
        Err(error) => Response::error(500, &error),
    }
}

// ---------------------------------------------------------------------------------------------
// Suggestions (ADR 0419)
// ---------------------------------------------------------------------------------------------

/// The suggestions that change a setting: id, the member, and the change to it.
const CHANGES: &[(&str, &str, &str)] = &[
    ("docs-section", "docs", "enabled"),
    ("recipe-list", "recipes", "listing"),
];

/// The member as written now (an object, `{}` when absent) with `key: true`.
fn turned_on(config: &Json, member: &str, key: &str) -> Json {
    let mut value = match config.get(member) {
        Some(Json::Object(object)) => Json::Object(object.clone()),
        _ => json!({}),
    };
    value[key] = json!(true);
    value
}

/// The lines that differ between two texts: `[{ op: "-" | "+", text }]`, after the common start
/// and end. What Studio shows one layer deeper, and what an applied change answers with.
fn changed_lines(before: &str, after: &str) -> Vec<Json> {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let start = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let end = a[start..]
        .iter()
        .rev()
        .zip(b[start..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let removed = a[start..a.len() - end]
        .iter()
        .map(|t| json!({ "op": "-", "text": t }));
    let added = b[start..b.len() - end]
        .iter()
        .map(|t| json!({ "op": "+", "text": t }));
    removed.chain(added).collect()
}

/// The file's text and its revision.
fn config_text_of(state: &AppState) -> Result<(String, String), Response> {
    let path = state.root.join(site::CONFIG_FILE);
    let bytes = fs::read(&path)
        .map_err(|error| Response::error(500, &format!("cannot read openblog.json: {error}")))?;
    let etag = etag_bytes(&bytes);
    let text = String::from_utf8(bytes)
        .map_err(|_| Response::error(500, "openblog.json must be UTF-8 text"))?;
    Ok((text, etag))
}

/// The new text for a change suggestion, or `None` when it would change nothing.
fn change_text(text: &str, id: &str) -> Result<Option<(String, &'static str)>, String> {
    let Some((_, member, key)) = CHANGES.iter().find(|(known, _, _)| *known == id) else {
        return Err("unknown".into());
    };
    let parsed: Json = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let config = SiteConfig::from_json(text)?;
    let on = match *member {
        "docs" => config.docs.enabled,
        _ => config.recipes.listing,
    };
    if on {
        return Ok(None);
    }
    let value = turned_on(&parsed, member, key);
    let candidate = config_text::set_member(text, member, Some(&value))?;
    // The changed file must still load, and must turn the setting on.
    let after = SiteConfig::from_json(&candidate)?;
    let now_on = match *member {
        "docs" => after.docs.enabled,
        _ => after.recipes.listing,
    };
    if !now_on {
        return Err("the change didn't take".into());
    }
    Ok(Some((candidate, member)))
}

/// `POST areas/suggestions`: `{ kind?, answers? }` → what they suggest for this site.
pub(super) fn suggestions(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let kind = body.get("kind").and_then(Json::as_str).unwrap_or("");
    let answers = body.get("answers").and_then(Json::as_object);
    let said = |question: &str, choice: &str| {
        answers.and_then(|a| a.get(question)).and_then(Json::as_str) == Some(choice)
    };
    let (text, etag) = match config_text_of(state) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let config = match SiteConfig::from_json(&text) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let mut out = Vec::new();
    let mut change = |id: &str| -> Result<(), String> {
        if let Some((candidate, member)) = change_text(&text, id)? {
            out.push(json!({
                "id": id,
                "type": "change",
                "member": member,
                "lines": changed_lines(&text, &candidate),
            }));
        }
        Ok(())
    };
    let wanted: Vec<&str> = [
        (kind == "docs", "docs-section"),
        (kind == "recipes", "recipe-list"),
    ]
    .iter()
    .filter(|(yes, _)| *yes)
    .map(|(_, id)| *id)
    .collect();
    for id in wanted {
        if let Err(error) = change(id) {
            return Response::error(500, &error);
        }
    }
    let open = |id: &str, href: &str| json!({ "id": id, "type": "open", "href": href });
    if kind == "trade" && config.business == openblog_core::business::BusinessConfig::default() {
        out.push(open("business", "#/business"));
    }
    if said("seasons", "yes") && !config.seasons.enabled && config.decorations.is_empty() {
        out.push(open("seasons", "#/decorations"));
    }
    if said("readers", "yes") && !config.engagement.enabled {
        out.push(open("readers", "#/readers"));
    }
    if said("sharing", "yes") && !social::is_configured() {
        out.push(open("sharing", "#/sharing/accounts"));
    }
    Response::json(200, &json!({ "etag": etag, "suggestions": out }))
}

/// `POST areas/suggestions/apply`: `{ id, etag }`. Only from the file the change was shown on;
/// only the one member changes; the site is rebuilt.
pub(super) fn apply(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let (Some(id), Some(etag)) = (
        body.get("id").and_then(Json::as_str),
        body.get("etag").and_then(Json::as_str),
    ) else {
        return Response::error(400, "`id` and `etag` are required");
    };
    let mut build = lock(&state.build);
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let (text, current) = match config_text_of(state) {
        Ok(found) => found,
        Err(response) => return response,
    };
    if current != etag {
        return Response::json(
            409,
            &json!({ "error": "openblog.json changed since this was shown", "code": "stale", "etag": current }),
        );
    }
    let (candidate, member) = match change_text(&text, id) {
        Ok(Some(found)) => found,
        Ok(None) => {
            return Response::json(
                409,
                &json!({ "error": "That is already on", "code": "already", "etag": current }),
            )
        }
        Err(error) if error == "unknown" => {
            return Response::json(
                404,
                &json!({ "error": "There is no such suggestion", "code": "unknown" }),
            )
        }
        Err(error) => return Response::error(500, &error),
    };
    if let Err(error) = write_atomic(&state.root.join(site::CONFIG_FILE), &candidate) {
        return Response::error(500, &error);
    }
    let build_error = match state.rebuild_locked(&mut build) {
        Ok(_) => Json::Null,
        Err(error) => Json::String(error),
    };
    eprintln!("areas: applied {id} ({member})");
    Response::json(
        200,
        &json!({
            "applied": id,
            "member": member,
            "etag": etag_bytes(candidate.as_bytes()),
            "lines": changed_lines(&text, &candidate),
            "buildError": build_error,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::{changed_lines, fences};
    use serde_json::json;

    #[test]
    fn a_fence_names_code_or_a_question() {
        assert_eq!(
            fences("Hello\n\n```rust runnable\nfn main() {}\n```\n"),
            (false, false),
            "code examples don't count"
        );
        assert_eq!(fences("```mermaid\ngraph TD; A-->B\n```\n"), (true, false));
        assert_eq!(fences("```quiz\nQ\n```\n"), (false, true));
        assert_eq!(fences("~~~mermaid\nx\n~~~\n```quiz\nq\n```"), (true, true));
        assert_eq!(fences("No fences, just `inline` code."), (false, false));
        // A quiz fence inside a longer fence is the longer fence's text.
        assert_eq!(fences("~~~md\n```quiz\n~~~\n"), (false, false));
    }

    #[test]
    fn changed_lines_are_the_middle() {
        let before = "{\n  \"title\": \"x\"\n}\n";
        let after = "{\n  \"title\": \"x\",\n  \"docs\": {\n    \"enabled\": true\n  }\n}\n";
        assert_eq!(
            changed_lines(before, after),
            vec![
                json!({ "op": "-", "text": "  \"title\": \"x\"" }),
                json!({ "op": "+", "text": "  \"title\": \"x\"," }),
                json!({ "op": "+", "text": "  \"docs\": {" }),
                json!({ "op": "+", "text": "    \"enabled\": true" }),
                json!({ "op": "+", "text": "  }" }),
            ]
        );
        assert!(changed_lines(before, before).is_empty());
    }
}

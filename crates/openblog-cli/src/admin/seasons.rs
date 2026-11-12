//! Admin routes for seasons (ADR 0407): `GET` and `PUT /admin/api/seasons`.
//!
//! The Seasons screen is where an owner chooses the theme the site wears and, if she likes, lets the
//! calendar change it: Thanksgiving from October 15, Christmas from December 1, the plain house in
//! between. It is the only Admin screen that sets the site `theme`.
//!
//! Both routes sit behind the session and, for the write, the CSRF and same-origin checks in `api`.
//! A save is validated by the core, every theme it names must exist, it is compared with the
//! revision the screen started from, and it changes only the `theme` and `seasons` members of
//! `openblog.json`, edited as text (`config_text::set_member`) so every other key keeps its place
//! and spelling. The revision is a digest of those two members alone.

use openblog_core::seasons::{self, SeasonsConfig, MAX_WINDOWS, SEASONS_VERSION};
use openblog_core::SiteConfig;

use super::*;
use crate::config_text;

/// The largest request body. Twenty-four windows are well under 4 KiB.
pub(super) const MAX_REQUEST_BYTES: usize = 8 * 1024;

/// The two members this screen owns, as stored.
fn stored(config: &Json) -> Json {
    json!({
        "theme": config.get("theme").cloned().unwrap_or(Json::Null),
        "seasons": config.get("seasons").cloned().unwrap_or(Json::Null),
    })
}

fn revision(stored: &Json) -> String {
    etag_bytes(stored.to_string().as_bytes())
}

/// Everything the screen needs: the stored theme and seasons, the themes there are to choose from,
/// what the site is wearing today and when that next changes.
fn describe(root: &Path, bytes: &[u8]) -> Result<Json, String> {
    let source = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
    let config = SiteConfig::from_json(source)?;
    let raw: Json = serde_json::from_str(source).map_err(|error| error.to_string())?;
    let themes = site::load_themes(root, &config)?;
    let choices: Vec<Json> = themes
        .names()
        .into_iter()
        .filter_map(|name| {
            let theme = themes.resolve(&name).ok()?;
            Some(json!({ "name": name, "label": theme.label }))
        })
        .collect();
    let now = clock::now();
    let today = seasons::month_day(now);
    let wearing = config
        .seasons
        .theme_on(today)
        .unwrap_or(&config.theme)
        .to_string();
    let next = config.seasons.next_change(now).map(|at| {
        let after = {
            let mut later = config.clone();
            site::wear_the_season(&mut later, at);
            later.theme
        };
        json!({ "day": at.ymd(), "theme": after })
    });
    Ok(json!({
        "version": SEASONS_VERSION,
        "etag": revision(&stored(&raw)),
        "theme": config.theme,
        "seasons": {
            "enabled": config.seasons.enabled,
            "windows": config.seasons.to_value()["windows"],
        },
        "themes": choices,
        "today": today.text(),
        "wearing": wearing,
        "next": next,
        "maxWindows": MAX_WINDOWS,
    }))
}

pub(super) fn get_seasons(state: &AppState) -> Response {
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    match fs::read(state.root.join(site::CONFIG_FILE))
        .map_err(|error| format!("cannot read openblog.json: {error}"))
        .and_then(|bytes| describe(&state.root, &bytes))
    {
        Ok(described) => Response::json(200, &described),
        Err(error) => Response::error(500, &error),
    }
}

pub(super) fn save_seasons(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::error(413, "The seasons are too large");
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(Json::Object(body)) => Json::Object(body),
        _ => return Response::error(400, "Invalid JSON"),
    };
    let Some(etag) = body.get("etag").and_then(Json::as_str) else {
        return Response::error(422, "etag is required");
    };
    let Some(theme) = body.get("theme").and_then(Json::as_str).map(str::trim) else {
        return Response::error(422, "Choose the theme your site wears");
    };
    let submitted = match SeasonsConfig::from_value(body.get("seasons").unwrap_or(&Json::Null)) {
        Ok(submitted) => submitted,
        Err(errors) => return Response::error(422, &errors.join("; ")),
    };

    let mut build = lock(&state.build);
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let path = state.root.join(site::CONFIG_FILE);
    let Ok(current_text) = fs::read_to_string(&path) else {
        return Response::error(500, "cannot read openblog.json as text");
    };
    let config: Json = match serde_json::from_str(&current_text) {
        Ok(Json::Object(object)) => Json::Object(object),
        _ => return Response::error(500, "openblog.json must contain a valid JSON object"),
    };
    if revision(&stored(&config)) != etag {
        let mut conflict =
            describe(&state.root, current_text.as_bytes()).unwrap_or_else(|_| json!({}));
        conflict["error"] =
            json!("The seasons changed since you opened them; reload before saving");
        return Response::json(409, &conflict);
    }

    // Every theme named here must exist before anything is written.
    let site_config = match SiteConfig::from_json(&current_text) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let themes = match site::load_themes(&state.root, &site_config) {
        Ok(themes) => themes,
        Err(error) => return Response::error(500, &error),
    };
    let mut missing: Vec<String> = std::iter::once(theme)
        .chain(submitted.themes())
        .filter(|name| !themes.contains(name))
        .map(|name| format!("There is no theme called `{name}` in your themes folder"))
        .collect();
    missing.dedup();
    if !missing.is_empty() {
        return Response::error(422, &missing.join("; "));
    }

    let seasons_value = submitted.to_value();
    let mut candidate = match config_text::set_member(&current_text, "theme", Some(&json!(theme))) {
        Ok(text) => text,
        Err(error) => return Response::error(500, &error),
    };
    candidate = match config_text::set_member(
        &candidate,
        "seasons",
        (!submitted.is_default()).then_some(&seasons_value),
    ) {
        Ok(text) => text,
        Err(error) => return Response::error(500, &error),
    };
    // The whole file must still load.
    let mut described = match describe(&state.root, candidate.as_bytes()) {
        Ok(described) => described,
        Err(error) => return Response::error(422, &error),
    };
    if let Err(error) = write_atomic(&path, &candidate) {
        return Response::error(500, &error);
    }
    described["buildError"] = match state.rebuild_locked(&mut build) {
        Ok(_) => Json::Null,
        Err(error) => Json::String(error),
    };
    Response::json(200, &described)
}

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
        .theme_at(now)
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
        "seasons": config.seasons.to_value(),
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

    // Only what changed is written: an unchanged member keeps its bytes, and a changed `seasons`
    // is written in its documented key order, so the owner's file reads as they wrote it.
    let mut candidate = current_text.clone();
    // The theme the site already uses (written, or the default when the key is absent) isn't
    // written again, so a file without a `theme` key doesn't gain one.
    if site_config.theme != theme {
        candidate = match config_text::set_member(&candidate, "theme", Some(&json!(theme))) {
            Ok(text) => text,
            Err(error) => return Response::error(500, &error),
        };
    }
    let stored_seasons =
        SeasonsConfig::from_value(config.get("seasons").unwrap_or(&Json::Null)).ok();
    if stored_seasons.as_ref() != Some(&submitted) {
        let pretty = submitted.to_pretty();
        candidate = match config_text::set_member_pretty(
            &candidate,
            "seasons",
            (!submitted.is_default()).then_some(pretty.as_str()),
        ) {
            Ok(text) => text,
            Err(error) => return Response::error(500, &error),
        };
    }
    let unchanged = candidate == current_text;
    // The whole file must still load.
    let mut described = match describe(&state.root, candidate.as_bytes()) {
        Ok(described) => described,
        Err(error) => return Response::error(422, &error),
    };
    described["changed"] = json!(!unchanged);
    if unchanged {
        described["buildError"] = Json::Null;
        return Response::json(200, &described);
    }
    if let Err(error) = write_atomic(&path, &candidate) {
        return Response::error(500, &error);
    }
    described["buildError"] = match state.rebuild_locked(&mut build) {
        Ok(_) => Json::Null,
        Err(error) => Json::String(error),
    };
    // Like a saved post, changed decorations go out when the site sends itself out.
    state_arc(state).auto_publish("Change the decorations".to_string());
    Response::json(200, &described)
}

/// `POST seasons/preview { look }`: the home page dressed in one look, built in memory from what's
/// on disk, so the owner can see Christmas before it goes up (Studio slice 3). The calendar is set
/// aside for the preview; owner scripts and analytics stay off; nothing is written or published.
pub(super) fn preview_look(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::error(413, "That request is too large");
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(Json::Object(body)) => Json::Object(body),
        _ => return Response::error(400, "Invalid JSON"),
    };
    let Some(look) = body.get("look").and_then(Json::as_str).map(str::trim) else {
        return Response::error(422, "Choose the look to see");
    };
    let mut config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    match site::load_themes(&state.root, &config) {
        Ok(themes) if themes.contains(look) => {}
        Ok(_) => {
            return Response::error(
                422,
                &format!("There is no theme called `{look}` in your themes folder"),
            )
        }
        Err(error) => return Response::error(500, &error),
    }
    config.theme = look.to_string();
    config.seasons = SeasonsConfig::default();
    config.snippets = Default::default();
    config.analytics.builtin = false;
    config.analytics.show_views = false;
    config.analytics.endpoint.clear();
    config.engagement.enabled = false;
    let guard = lock(&state.build);
    let sources = match site::read_sources(&state.root, &config) {
        Ok(sources) => sources,
        Err(error) => return Response::error(500, &error),
    };
    let (preview_site, themes) = match site::load_site_from_sources_listing(
        &state.root,
        config,
        sources,
        LoadOptions {
            include_drafts: false,
            now: Some(clock::now()),
            preview_source: None,
        },
    ) {
        Ok(loaded) => loaded,
        Err(errors) => return Response::error(422, &site::content_problems(&errors)),
    };
    drop(guard);
    let document = match openblog_core::generate_home(&preview_site, &themes) {
        Ok(document) => document,
        Err(error) => return Response::error(422, &error),
    };
    let c = &preview_site.config;
    let theme = match themes.resolve(&c.theme) {
        Ok(theme) => theme,
        Err(error) => return Response::error(422, &error),
    };
    // The look's own stylesheet goes in the page, so it shows even when that theme isn't built yet.
    let tokens = c.apply_base_path(&c.cdn.apply(&theme.tokens_css()));
    let html = super::look::inline_tokens(&document.contents, &c.theme, &tokens);
    let html = html.replacen("<head>", "<head>\n<base target=\"_blank\">", 1);
    let token = match auth::random_token() {
        Ok(token) => token,
        Err(error) => return Response::error(500, &error),
    };
    let csp = preview_csp(c);
    store_preview(state, &token, html, csp);
    Response::json(
        200,
        &json!({ "previewUrl": format!("/admin/api/preview/{token}"), "look": look }),
    )
}

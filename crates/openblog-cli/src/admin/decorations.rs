//! Admin routes for decoration pieces (Studio slice 3b): `GET`/`PUT /admin/api/decorations` and
//! `POST decorations/preview`.
//!
//! A theme may declare its decorations as pieces (`theme.json` `decorations`). Here the owner takes
//! one down or puts up another version of it. The choices are stored in `openblog.json`
//! `decorations`, which names pieces and versions only, never CSS. The revision is a digest of that
//! one member, so a save here never conflicts with the Seasons screen. The write keeps the rest of
//! the file as written (`config_text::set_member_pretty`).

use std::collections::BTreeMap;

use openblog_core::decorations::{self, DecorChoice, DecorChoices, DecorPiece};
use openblog_core::SiteConfig;

use super::*;
use crate::config_text;

/// The largest request body. A few themes of a dozen pieces are well under 4 KiB.
pub(super) const MAX_REQUEST_BYTES: usize = 16 * 1024;

fn revision(config: &Json) -> String {
    let stored = config.get("decorations").cloned().unwrap_or(Json::Null);
    etag_bytes(stored.to_string().as_bytes())
}

fn piece_json(id: &str, piece: &DecorPiece, choice: Option<&DecorChoice>) -> Json {
    let variants: Vec<Json> = piece
        .variants
        .iter()
        .map(|(id, v)| json!({ "id": id, "label": v.label }))
        .collect();
    json!({
        "id": id,
        "label": if piece.label.is_empty() { id.to_string() } else { piece.label.clone() },
        "variants": variants,
        "canTakeDown": !piece.off.is_empty(),
        "choice": choice,
    })
}

/// Every theme with pieces, each piece with its versions and the saved choice for it.
fn describe(root: &Path, text: &str) -> Result<Json, String> {
    let config = SiteConfig::from_json(text)?;
    let raw: Json = serde_json::from_str(text).map_err(|error| error.to_string())?;
    let themes = site::load_themes(root, &config)?;
    let looks: Vec<Json> = themes
        .names()
        .into_iter()
        .filter_map(|name| {
            let theme = themes.resolve(&name).ok()?;
            if theme.decorations.is_empty() {
                return None;
            }
            let saved = config.decorations.get(&name);
            let pieces: Vec<Json> = theme
                .decorations
                .iter()
                .map(|(id, piece)| piece_json(id, piece, saved.and_then(|s| s.get(id))))
                .collect();
            Some(json!({ "name": name, "label": theme.label, "pieces": pieces }))
        })
        .collect();
    let wearing = config
        .seasons
        .theme_at(clock::now())
        .unwrap_or(&config.theme)
        .to_string();
    Ok(json!({
        "etag": revision(&raw),
        "looks": looks,
        "wearing": wearing,
        "decorations": config.decorations,
    }))
}

pub(super) fn get_decorations(state: &AppState) -> Response {
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    match fs::read_to_string(state.root.join(site::CONFIG_FILE))
        .map_err(|error| format!("cannot read openblog.json: {error}"))
        .and_then(|text| describe(&state.root, &text))
    {
        Ok(described) => Response::json(200, &described),
        Err(error) => Response::error(500, &error),
    }
}

fn parse_choices(value: Option<&Json>) -> Result<DecorChoices, String> {
    let value = value.cloned().unwrap_or_else(|| json!({}));
    let mut choices: DecorChoices = serde_json::from_value(value)
        .map_err(|error| format!("Those decorations can't be read: {error}"))?;
    // A look with nothing changed isn't written.
    choices.retain(|_, picks| !picks.is_empty());
    Ok(choices)
}

fn pieces_problems(
    root: &Path,
    config: &SiteConfig,
    choices: &DecorChoices,
) -> Result<Vec<String>, String> {
    let themes = site::load_themes(root, config)?;
    Ok(decorations::problems(choices, |name| {
        themes.resolve(name).ok().map(|theme| theme.decorations)
    }))
}

pub(super) fn save_decorations(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::error(413, "The decorations are too large");
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(Json::Object(body)) => Json::Object(body),
        _ => return Response::error(400, "Invalid JSON"),
    };
    let Some(etag) = body.get("etag").and_then(Json::as_str) else {
        return Response::error(422, "etag is required");
    };
    let submitted = match parse_choices(body.get("decorations")) {
        Ok(choices) => choices,
        Err(error) => return Response::error(422, &error),
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
    let raw: Json = match serde_json::from_str(&current_text) {
        Ok(Json::Object(object)) => Json::Object(object),
        _ => return Response::error(500, "openblog.json must contain a valid JSON object"),
    };
    if revision(&raw) != etag {
        let mut conflict = describe(&state.root, &current_text).unwrap_or_else(|_| json!({}));
        conflict["error"] =
            json!("The decorations changed since you opened them; reload before saving");
        return Response::json(409, &conflict);
    }
    let site_config = match SiteConfig::from_json(&current_text) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    // Only what this save changes is checked: a choice saved long ago for a look or piece that has
    // since gone is skipped at build time, and must not block every other change.
    let changed: DecorChoices = submitted
        .iter()
        .filter_map(|(theme, picks)| {
            let saved = site_config.decorations.get(theme);
            let new: BTreeMap<String, DecorChoice> = picks
                .iter()
                .filter(|(id, choice)| saved.and_then(|s| s.get(*id)) != Some(*choice))
                .map(|(id, choice)| (id.clone(), choice.clone()))
                .collect();
            (!new.is_empty()).then(|| (theme.clone(), new))
        })
        .collect();
    match pieces_problems(&state.root, &site_config, &changed) {
        Ok(problems) if problems.is_empty() => {}
        Ok(problems) => return Response::error(422, &problems.join("; ")),
        Err(error) => return Response::error(500, &error),
    }

    let candidate = if site_config.decorations == submitted {
        current_text.clone()
    } else {
        let pretty = match serde_json::to_string_pretty(&submitted) {
            Ok(pretty) => pretty,
            Err(error) => return Response::error(500, &error.to_string()),
        };
        match config_text::set_member_pretty(
            &current_text,
            "decorations",
            (!submitted.is_empty()).then_some(pretty.as_str()),
        ) {
            Ok(text) => text,
            Err(error) => return Response::error(500, &error),
        }
    };
    let unchanged = candidate == current_text;
    let mut described = match describe(&state.root, &candidate) {
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
    state_arc(state).auto_publish("Change the decorations".to_string());
    Response::json(200, &described)
}

/// `POST decorations/preview { look, pieces }`: the home page in that look with these choices, before
/// they're saved. Nothing is written.
pub(super) fn preview_decorations(state: &AppState, req: &Request) -> Response {
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
    let pieces: BTreeMap<String, DecorChoice> =
        match serde_json::from_value(body.get("pieces").cloned().unwrap_or_else(|| json!({}))) {
            Ok(pieces) => pieces,
            Err(error) => {
                return Response::error(422, &format!("Those decorations can't be read: {error}"))
            }
        };
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let check = BTreeMap::from([(look.to_string(), pieces.clone())]);
    match pieces_problems(&state.root, &config, &check) {
        Ok(problems) if problems.is_empty() => {}
        Ok(problems) => return Response::error(422, &problems.join("; ")),
        Err(error) => return Response::error(500, &error),
    }
    super::seasons::preview_home(state, look, Some(pieces))
}

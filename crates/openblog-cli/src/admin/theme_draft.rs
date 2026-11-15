//! Admin routes for a theme drafted from words (ADR 0410).
//!
//! - `POST theme-draft`: the owner's description (and the current draft, when she asks for a change)
//!   goes to the configured Assistant provider as untrusted data. The proposal is checked by the core,
//!   made readable, and returned with what was adjusted. Nothing is written.
//! - `POST theme-draft/preview`: the home page as it would look in the draft, built in memory by the
//!   production code, behind a one-time preview address. Nothing is written.
//! - `POST theme-draft/save`: the checked draft becomes `themes/<new folder>/theme.json`, extending the
//!   site's own theme. Only a new folder is ever written; no existing theme or setting changes, and the
//!   new theme is worn only when the owner chooses it (Seasons).
//!
//! Every route sits behind the session and, for these writes, the CSRF and same-origin checks in `api`.

use openblog_core::theme::ThemeFile;
use openblog_core::theme_draft::{theme_slug, ThemeDraft, MAX_DESCRIPTION_CHARS};
use openblog_core::SiteConfig;

use super::*;
use crate::assistant::theme_draft::ThemeDraftInput;

/// The largest request body: a description and a draft are well under this.
pub(super) const MAX_REQUEST_BYTES: usize = 16 * 1024;

/// The name the preview gives the draft, which no folder can have.
const PREVIEW_THEME: &str = "theme-draft-preview";

fn body_json(req: &Request) -> Result<Json, Response> {
    require_json(req)?;
    if req.body.len() > MAX_REQUEST_BYTES {
        return Err(Response::error(413, "The request is too large"));
    }
    match serde_json::from_slice(&req.body) {
        Ok(body @ Json::Object(_)) => Ok(body),
        _ => Err(Response::error(400, "Invalid JSON")),
    }
}

/// The theme a draft starts from: `base` when the request names an existing theme, else the site's
/// own. The draft keeps that theme's structure and decorations and changes how they look.
fn base_of(
    body: &Json,
    config: &SiteConfig,
    themes: &openblog_core::theme::ThemeSet,
) -> Result<String, Response> {
    match &body["base"] {
        Json::Null => Ok(config.theme.clone()),
        Json::String(name) if themes.contains(name) && name != PREVIEW_THEME => Ok(name.clone()),
        _ => Err(coded_error(
            422,
            "base-gone",
            "Choose a theme of yours to start from",
        )),
    }
}

/// The base a request names, checked against the site's themes.
fn requested_base(state: &AppState, body: &Json, config: &SiteConfig) -> Result<String, Response> {
    let themes =
        site::load_themes(&state.root, config).map_err(|error| Response::error(500, &error))?;
    base_of(body, config, &themes)
}

/// The checked draft in a request, made into a theme extending `base`.
fn drafted(
    body: &Json,
    base: &str,
) -> Result<(ThemeDraft, openblog_core::theme_draft::DraftedTheme), Response> {
    let draft = ThemeDraft::from_json(&body["draft"]).map_err(|reason| {
        // The field the reason names (`light.text`), so Studio can point at it.
        let field = reason
            .split('`')
            .nth(1)
            .filter(|name| name.len() <= 40)
            .unwrap_or("");
        Response::json(
            422,
            &json!({
                "error": format!("This theme cannot be used: {reason}"),
                "code": "bad-draft",
                "field": field,
            }),
        )
    })?;
    let made = draft.to_theme(base);
    Ok((draft, made))
}

/// `GET theme-draft`: the themes a draft may start from, and the site's own.
pub(super) fn options(state: &AppState) -> Response {
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let themes = match site::load_themes(&state.root, &config) {
        Ok(themes) => themes,
        Err(error) => return Response::error(500, &error),
    };
    let list: Vec<Json> = themes
        .names()
        .into_iter()
        .filter_map(|name| {
            themes
                .resolve(&name)
                .ok()
                .map(|theme| json!({ "name": name, "label": theme.label }))
        })
        .collect();
    Response::json(200, &json!({ "themes": list, "current": config.theme }))
}

/// `POST theme-draft`: ask the Assistant for a theme from the owner's words.
pub(super) fn draft(state: &AppState, req: &Request) -> Response {
    let body = match body_json(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let description = match body["description"].as_str() {
        Some(text) if text.chars().count() <= MAX_DESCRIPTION_CHARS && !text.contains('\0') => {
            text.trim().to_string()
        }
        Some(text) if !text.contains('\0') => {
            return Response::json(
                400,
                &json!({
                    "error": format!("Describe the look in at most {MAX_DESCRIPTION_CHARS} characters"),
                    "code": "too-long",
                    "field": "description",
                    "max": MAX_DESCRIPTION_CHARS,
                    "unit": "characters",
                }),
            )
        }
        _ => {
            return coded_error(
                400,
                "no-description",
                "Describe the look you want in a few words",
            )
        }
    };
    if description.is_empty() {
        return coded_error(
            400,
            "no-description",
            "Describe the look you want in a few words",
        );
    }
    let previous = match &body["previous"] {
        Json::Null => None,
        value => match ThemeDraft::from_json(value) {
            Ok(draft) => Some(draft.to_json()),
            Err(_) => {
                return coded_error(400, "bad-draft", "The draft to change is not a theme draft")
            }
        },
    };
    let site_config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let base = match requested_base(state, &body, &site_config) {
        Ok(base) => base,
        Err(response) => return response,
    };
    let base_label = site::load_themes(&state.root, &site_config)
        .and_then(|themes| themes.resolve(&base))
        .map(|theme| theme.label)
        .unwrap_or_else(|_| base.clone());
    let (config, credential) = match assistant_provider_snapshot(state) {
        Ok(snapshot) => snapshot,
        Err(response) => return response,
    };
    let provider = match configured_assistant_provider(
        &config,
        credential,
        assistant_provider_timeout(config.knowledge_checks.provider, cfg!(test)),
    ) {
        Ok(provider) => provider,
        Err(error) => return review_error(error),
    };
    let request = AssistantRequest::theme_draft(
        config.knowledge_checks.model,
        ThemeDraftInput {
            description,
            site_title: site_config.title.clone(),
            base_label,
            previous,
        },
    );
    let _permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::json(
                429,
                &json!({ "error": "Two Assistant operations are already running; try again shortly", "code": "concurrency-limit" }),
            )
        }
    };
    match provider.generate(&request) {
        Ok(AssistantResult::ThemeDraft(value)) => {
            let Ok(draft) = ThemeDraft::from_json(&value) else {
                return coded_error(
                    502,
                    "invalid-result",
                    "Assistant provider returned an invalid theme",
                );
            };
            let made = draft.to_theme(&base);
            Response::json(
                200,
                &json!({
                    "draft": draft.to_json(),
                    "theme": made.theme,
                    "notes": made.notes,
                    "changes": made.changes,
                    "extends": base,
                    "proposal": true,
                }),
            )
        }
        Ok(_) => coded_error(
            502,
            "invalid-result",
            "Assistant provider returned the wrong result type",
        ),
        Err(error) => review_error(error),
    }
}

/// `POST theme-draft/preview`: the home page in the draft, light or dark. Nothing is written.
pub(super) fn preview(state: &AppState, req: &Request) -> Response {
    let body = match body_json(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let mode = match body["mode"].as_str() {
        None | Some("system") => None,
        Some(mode @ ("light" | "dark")) => Some(mode),
        Some(_) => return Response::error(422, "mode must be light, dark or system"),
    };
    let mut config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let base = match requested_base(state, &body, &config) {
        Ok(base) => base,
        Err(response) => return response,
    };
    let (_, made) = match drafted(&body, &base) {
        Ok(drafted) => drafted,
        Err(response) => return response,
    };
    let file = match ThemeFile::from_json(&made.theme.to_string()) {
        Ok(file) => file,
        Err(error) => return Response::error(422, &error),
    };
    // The preview wears the draft whatever the season, with the owner's scripts and counters off.
    config.seasons.enabled = false;
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
    let (mut preview_site, mut themes) = match site::load_site_from_sources_listing(
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
    themes.insert(PREVIEW_THEME, file);
    // The site's Look choices sit on top of whatever look is up, a new one included: the preview
    // wears them exactly as a build does (G66), and says which ones it applied.
    let appearance = preview_site.config.appearance.clone();
    let theme = match themes.resolve(PREVIEW_THEME) {
        Ok(theme) if appearance.is_neutral() => theme,
        Ok(theme) => theme.with_look(&appearance),
        Err(error) => return Response::error(422, &error),
    };
    let look_applied: Vec<&str> = match appearance.to_value() {
        Json::Object(stored) => openblog_core::look::CONTROLS
            .iter()
            .copied()
            .filter(|control| stored.contains_key(*control) && theme.honors(control))
            .collect(),
        _ => Vec::new(),
    };
    preview_site.config.theme = PREVIEW_THEME.to_string();
    let document = match openblog_core::generate_home(&preview_site, &themes) {
        Ok(document) => document,
        Err(error) => return Response::error(422, &error),
    };
    let c = &preview_site.config;
    let tokens = c.apply_base_path(&c.cdn.apply(&theme.tokens_css()));
    let mut html = look::inline_tokens(&document.contents, PREVIEW_THEME, &tokens);
    if let Some(mode) = mode {
        html = html.replacen("<html", &format!("<html data-theme=\"{mode}\""), 1);
    }
    let html = html.replacen("<head>", "<head>\n<base target=\"_blank\">", 1);
    let token = match auth::random_token() {
        Ok(token) => token,
        Err(error) => return Response::error(500, &error),
    };
    let csp = preview_csp(c);
    store_preview(state, &token, html, csp);
    Response::json(
        200,
        &json!({
            "previewUrl": format!("/admin/api/preview/{token}"),
            "notes": made.notes,
            "changes": made.changes,
            // The colours as they will be, after the server made them readable: what a swatch shows.
            "colors": made.theme["colors"],
            "lookApplied": look_applied,
        }),
    )
}

/// `POST theme-draft/save`: write the draft as a new theme folder. Nothing else changes.
pub(super) fn save(state: &AppState, req: &Request, session_csrf: &str) -> Response {
    let body = match body_json(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let mut build = lock(&state.build);
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let base = match requested_base(state, &body, &config) {
        Ok(base) => base,
        Err(response) => return response,
    };
    let (draft, made) = match drafted(&body, &base) {
        Ok(drafted) => drafted,
        Err(response) => return response,
    };
    let mut themes = match site::load_themes(&state.root, &config) {
        Ok(themes) => themes,
        Err(error) => return Response::error(500, &error),
    };
    let themes_dir = state.root.join(&config.paths.themes);
    let mut taken = themes.names();
    if let Ok(entries) = fs::read_dir(&themes_dir) {
        taken.extend(
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned()),
        );
    }
    taken.push(PREVIEW_THEME.to_string());
    // A name she already has in her list would be two looks she can't tell apart (G69).
    let wanted = draft.label.trim().to_lowercase();
    let same_label = themes.names().into_iter().any(|name| {
        themes
            .resolve(&name)
            .is_ok_and(|theme| theme.label.trim().to_lowercase() == wanted)
    });
    if same_label {
        return coded_error(409, "name-taken", "You already have a look with that name");
    }
    let name = theme_slug(&draft.label, &taken);
    // The new theme must resolve, with the site's own theme as its parent, before it is written.
    let text = match serde_json::to_string_pretty(&made.theme) {
        Ok(text) => format!("{text}\n"),
        Err(error) => return Response::error(500, &error.to_string()),
    };
    match ThemeFile::from_json(&text) {
        Ok(file) => themes.insert(&name, file),
        Err(error) => return Response::error(422, &error),
    }
    if let Err(error) = themes.resolve(&name) {
        return Response::error(422, &error);
    }
    let folder = themes_dir.join(&name);
    if folder.exists() {
        return coded_error(
            409,
            "exists",
            "A theme with that name already exists; try again",
        );
    }
    if let Err(error) = fs::create_dir_all(&folder) {
        return Response::error(500, &format!("cannot create themes/{name}: {error}"));
    }
    if let Err(error) = write_atomic(&folder.join("theme.json"), &text) {
        return Response::error(500, &error);
    }
    let build_error = match state.rebuild_locked(&mut build) {
        Ok(_) => Json::Null,
        Err(error) => Json::String(error),
    };
    // Undo for ten minutes, from this session, while the look isn't in use (G68).
    let undo_token = auth::random_token().ok();
    if let Some(token) = &undo_token {
        let mut kept = lock(&state.theme_undos);
        let now = std::time::Instant::now();
        kept.retain(|undo| undo.expires > now);
        if kept.len() >= MAX_UNDOS {
            kept.remove(0);
        }
        kept.push(ThemeUndo {
            token: token.clone(),
            session: session_csrf.to_string(),
            name: name.clone(),
            revision: etag_bytes(text.as_bytes()),
            expires: now + UNDO_FOR,
        });
    }
    Response::json(
        201,
        &json!({
            "name": name,
            "label": draft.label,
            "path": format!("themes/{name}/theme.json"),
            "buildError": build_error,
            "undoToken": undo_token,
            "undoSeconds": UNDO_FOR.as_secs(),
        }),
    )
}

/// How long a saved look can be undone.
const UNDO_FOR: Duration = Duration::from_secs(600);
/// The most undo tokens kept at once; the oldest goes first.
const MAX_UNDOS: usize = 32;

/// One saved look that can still be undone: by whom, for how long, and what was written.
pub(crate) struct ThemeUndo {
    token: String,
    session: String,
    name: String,
    revision: String,
    expires: std::time::Instant,
}

/// The folder name in `theme-draft/<name>`: only what `theme_slug` can make.
pub(super) fn undo_route(name: &str) -> Option<&str> {
    let rest = name.strip_prefix("theme-draft/")?;
    let valid = !rest.is_empty()
        && rest.len() <= 48
        && rest
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !matches!(rest, "preview" | "save");
    valid.then_some(rest)
}

/// `DELETE theme-draft/<name>?undo=<token>`: take back a look saved a moment ago. Only the folder
/// that save wrote, only from the session that saved it, only within ten minutes, and only while
/// it is not the site's look, not on the calendar, not up now and unchanged since. Then rebuild.
pub(super) fn undo(state: &AppState, req: &Request, name: &str, session_csrf: &str) -> Response {
    let token = req.query.get("undo").map(String::as_str).unwrap_or("");
    let expired = || coded_error(409, "expired", "That look can't be undone any more");
    let in_use = || coded_error(409, "in-use", "That look is in use, so it wasn't removed");
    let mut build = lock(&state.build);
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let revision = {
        let mut kept = lock(&state.theme_undos);
        let now = std::time::Instant::now();
        kept.retain(|undo| undo.expires > now);
        match kept.iter().find(|undo| {
            undo.name == name
                && undo.session == session_csrf
                && !token.is_empty()
                && auth::constant_time_eq(&undo.token, token)
        }) {
            Some(undo) => undo.revision.clone(),
            None => return expired(),
        }
    };
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let on_calendar = config.seasons.windows.iter().any(|w| w.theme == name);
    let up_now = config
        .seasons
        .up_now
        .as_ref()
        .is_some_and(|up| up.theme == name);
    if config.theme == name || on_calendar || up_now {
        return in_use();
    }
    let folder = state.root.join(&config.paths.themes).join(name);
    // Exactly what the save wrote: one file, the same bytes. Anything else is somebody's work.
    let only_file = fs::read_dir(&folder).is_ok_and(|entries| {
        let names: Vec<_> = entries.flatten().map(|e| e.file_name()).collect();
        names.len() == 1 && names[0] == "theme.json"
    });
    let unchanged = only_file
        && fs::symlink_metadata(&folder).is_ok_and(|m| m.is_dir())
        && fs::read(folder.join("theme.json")).is_ok_and(|bytes| etag_bytes(&bytes) == revision);
    if !unchanged {
        return in_use();
    }
    if let Err(error) =
        fs::remove_file(folder.join("theme.json")).and_then(|()| fs::remove_dir(&folder))
    {
        return Response::error(500, &format!("cannot remove themes/{name}: {error}"));
    }
    lock(&state.theme_undos).retain(|undo| undo.name != name);
    eprintln!("admin: a saved look was undone (themes/{name})");
    let build_error = match state.rebuild_locked(&mut build) {
        Ok(_) => Json::Null,
        Err(error) => Json::String(error),
    };
    Response::json(200, &json!({ "removed": name, "buildError": build_error }))
}

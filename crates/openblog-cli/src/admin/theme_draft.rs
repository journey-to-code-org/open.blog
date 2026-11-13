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
        _ => Err(Response::error(
            422,
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
    let draft = ThemeDraft::from_json(&body["draft"])
        .map_err(|reason| Response::error(422, &format!("This theme cannot be used: {reason}")))?;
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
        _ => {
            return Response::error(
                400,
                &format!("Describe the look in at most {MAX_DESCRIPTION_CHARS} characters"),
            )
        }
    };
    if description.is_empty() {
        return Response::error(400, "Describe the look you want in a few words");
    }
    let previous = match &body["previous"] {
        Json::Null => None,
        value => match ThemeDraft::from_json(value) {
            Ok(draft) => Some(draft.to_json()),
            Err(_) => return Response::error(400, "The draft to change is not a theme draft"),
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
                return Response::error(502, "Assistant provider returned an invalid theme");
            };
            let made = draft.to_theme(&base);
            Response::json(
                200,
                &json!({
                    "draft": draft.to_json(),
                    "theme": made.theme,
                    "notes": made.notes,
                    "extends": base,
                    "proposal": true,
                }),
            )
        }
        Ok(_) => Response::error(502, "Assistant provider returned the wrong result type"),
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
    let theme = match themes.resolve(PREVIEW_THEME) {
        Ok(theme) => theme,
        Err(error) => return Response::error(422, &error),
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
        &json!({ "previewUrl": format!("/admin/api/preview/{token}"), "notes": made.notes }),
    )
}

/// `POST theme-draft/save`: write the draft as a new theme folder. Nothing else changes.
pub(super) fn save(state: &AppState, req: &Request) -> Response {
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
        return Response::error(409, "A theme with that name already exists; try again");
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
    Response::json(
        201,
        &json!({ "name": name, "label": draft.label, "path": format!("themes/{name}/theme.json"), "buildError": build_error }),
    )
}

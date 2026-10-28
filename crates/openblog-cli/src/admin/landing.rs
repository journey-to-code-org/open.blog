//! Admin routes for the landing page (ADR 0246, #323).
//!
//! `GET landing` reads the stored page and `PUT landing` replaces it. Both sit
//! behind the session, and the write behind the CSRF check (`api`); an unknown
//! name or verb is a 404 (deny by default). A write takes the build lock and
//! the content transaction lock, names the revision it is based on, is
//! checked by the core before a byte is written and is applied by atomic
//! rename, so a stale, refused or failed save leaves the stored file as it
//! was. Only `landing.json` is written: no other file, and nothing in
//! `openblog.json`, changes.

use openblog_core::landing::{
    LandingPage, LandingProblem, LANDING_FORMAT, LANDING_VERSION, MAX_FILE_BYTES, MAX_SECTIONS,
};

use super::*;
use crate::landing_store::{self as store, StoreError as LandingError};

/// Largest request body: a page plus room for the wrapper.
pub(super) const MAX_REQUEST_BYTES: usize = MAX_FILE_BYTES * 2;

fn problems_json(problems: &[LandingProblem]) -> Json {
    Json::Array(
        problems
            .iter()
            .map(|p| json!({ "section": p.section, "message": p.message, "text": p.to_string() }))
            .collect(),
    )
}

fn page_json(page: &LandingPage) -> Json {
    serde_json::from_str(&page.to_canonical_json()).unwrap_or(Json::Null)
}

fn limits() -> Json {
    json!({ "sections": MAX_SECTIONS, "bytes": MAX_FILE_BYTES, "version": LANDING_VERSION })
}

/// The page as the editor needs it. A site with no file has none to show;
/// the default layout its home settings stand for is given beside it so an
/// editor can start from what visitors see now.
fn view(stored: Option<&store::Stored>, home: &openblog_core::config::HomeConfig) -> Json {
    let legacy = page_json(&LandingPage::from_legacy(home));
    match stored {
        None => json!({
            "exists": false,
            "revision": Json::Null,
            "valid": true,
            "page": Json::Null,
            "source": Json::Null,
            "problems": [],
            "legacy": legacy,
            "limits": limits(),
        }),
        Some(stored) => match &stored.parsed {
            Ok(page) => json!({
                "exists": true,
                "revision": stored.revision,
                "valid": true,
                "page": page_json(page),
                "source": stored.text,
                "problems": [],
                "legacy": legacy,
                "limits": limits(),
            }),
            Err(problems) => json!({
                "exists": true,
                "revision": stored.revision,
                "valid": false,
                "page": Json::Null,
                "source": stored.text,
                "problems": problems_json(problems),
                "legacy": legacy,
                "limits": limits(),
            }),
        },
    }
}

fn store_error(state: &AppState, error: LandingError, config: &SiteConfig) -> Response {
    match error {
        LandingError::Conflict => {
            let latest = store::read(&state.root, &config.paths.content)
                .ok()
                .flatten();
            Response::json(
                409,
                &json!({
                    "error": error.to_string(),
                    "conflict": true,
                    "revision": latest.as_ref().map(|s| s.revision.as_str()),
                    "current": view(latest.as_ref(), &config.home),
                }),
            )
        }
        LandingError::Newer(_) => Response::json(
            409,
            &json!({ "error": error.to_string(), "newerVersion": true }),
        ),
        LandingError::Invalid(problems) => Response::json(
            422,
            &json!({
                "error": problems.first().map_or_else(
                    || "The landing page is not valid".to_string(),
                    ToString::to_string,
                ),
                "problems": problems_json(&problems),
            }),
        ),
        LandingError::Storage(message) => Response::error(500, &message),
    }
}

/// `GET landing`: the stored page, its revision and the default layout.
pub(super) fn get(state: &AppState) -> Response {
    let _content = lock(&state.build);
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    match store::read(&state.root, &config.paths.content) {
        Ok(stored) => Response::json(200, &view(stored.as_ref(), &config.home)),
        Err(error) => store_error(state, error, &config),
    }
}

/// `PUT landing`: replace the page. The body is `{ revision, page }`, with
/// `revision` omitted (or null) only to create the file. What is written is
/// always the canonical form, and the response carries it.
pub(super) fn save(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::error(413, "A landing page is limited to 256 KiB");
    }
    let request = match serde_json::from_slice::<Json>(&req.body) {
        Ok(body) if body.is_object() => body,
        _ => return Response::error(400, "Invalid JSON"),
    };
    let revision = match &request["revision"] {
        Json::Null => None,
        Json::String(revision) => Some(revision.clone()),
        _ => return Response::error(400, "The revision must be text"),
    };
    let Json::Object(mut page) = request["page"].clone() else {
        return Response::error(400, "Send the landing page as `page` (an object)");
    };
    page.insert("format".into(), json!(LANDING_FORMAT));
    page.insert("version".into(), json!(LANDING_VERSION));
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let page = match LandingPage::parse(&Json::Object(page).to_string()) {
        Ok(page) => page,
        Err(problems) => return store_error(state, LandingError::Invalid(problems), &config),
    };
    let mut build = lock(&state.build);
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    match store::save(
        &state.root,
        &config.paths.content,
        revision.as_deref(),
        &page,
    ) {
        Ok(saved) => {
            let stored = store::Stored {
                revision: saved.revision,
                text: saved.text,
                parsed: Ok(saved.page),
            };
            let mut saved_view = view(Some(&stored), &config.home);
            // The served site follows the saved page, as it does after a post is saved. A build
            // that fails does not undo the save; the answer says so.
            saved_view["build"] = match state.rebuild_locked(&mut build) {
                Ok(report) => json!({ "ok": true, "files": report.files }),
                Err(error) => json!({ "ok": false, "error": error }),
            };
            Response::json(if revision.is_some() { 200 } else { 201 }, &saved_view)
        }
        Err(error) => store_error(state, error, &config),
    }
}

/// `POST landing/preview`: the home page as it would be built from the sections in the request,
/// which are not saved (ADR 0250). The page is checked as a save would check it, built in memory
/// with the same code as the production build, and kept as a short-lived preview document; no file
/// is written and nothing is published.
pub(super) fn preview(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::error(413, "A landing page is limited to 256 KiB");
    }
    let request = match serde_json::from_slice::<Json>(&req.body) {
        Ok(body) if body.is_object() => body,
        _ => return Response::error(400, "Invalid JSON"),
    };
    let Json::Object(mut page) = request["page"].clone() else {
        return Response::error(400, "Send the landing page as `page` (an object)");
    };
    page.insert("format".into(), json!(LANDING_FORMAT));
    page.insert("version".into(), json!(LANDING_VERSION));
    let mut config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let page = match LandingPage::parse(&Json::Object(page).to_string()) {
        Ok(page) => page,
        Err(problems) => return store_error(state, LandingError::Invalid(problems), &config),
    };
    // Owner-supplied scripts and analytics stay off in a preview, as in the document preview.
    config.snippets = Default::default();
    config.analytics.builtin = false;
    config.analytics.show_views = false;
    config.analytics.endpoint.clear();
    config.engagement.enabled = false;
    let guard = lock(&state.build);
    let mut sources = match site::read_sources(&state.root, &config) {
        Ok(sources) => sources,
        Err(error) => return Response::error(500, &error),
    };
    sources.landing = Some(SourceFile {
        path: format!(
            "{}/{}",
            config.paths.content.trim_end_matches(['/', '\\']),
            openblog_core::landing::LANDING_FILE
        ),
        contents: page.to_canonical_json(),
    });
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
    let token = match auth::random_token() {
        Ok(token) => token,
        Err(error) => return Response::error(500, &error),
    };
    // Links in a preview lead nowhere: they would only load the live site inside the frame.
    let html = document
        .contents
        .replacen("<head>", "<head>\n<base target=\"_blank\">", 1);
    let csp = preview_csp(&preview_site.config);
    store_preview(state, &token, html, csp);
    Response::json(
        200,
        &json!({
            "previewUrl": format!("/admin/api/preview/{token}"),
            "visible": page.sections.iter().filter(|s| !s.hidden).count(),
        }),
    )
}

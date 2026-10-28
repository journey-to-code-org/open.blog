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
const MAX_REQUEST_BYTES: usize = MAX_FILE_BYTES * 2;

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
    let _build = lock(&state.build);
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
            Response::json(
                if revision.is_some() { 200 } else { 201 },
                &view(Some(&stored), &config.home),
            )
        }
        Err(error) => store_error(state, error, &config),
    }
}

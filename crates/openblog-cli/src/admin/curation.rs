//! Admin routes for curating the research context readers are given (#196,
//! ADR 0228, ADR 0229).
//!
//! `GET research/curation` reads the author's view of the selections: each one
//! with its status and the reason it publishes nothing, what readers of one
//! post get (the same `PublicCuration` value the public renderers read, so
//! the preview is not a second rendering), and the public items that can be
//! selected. The changing routes select, select again, withdraw, rescope,
//! order and unselect. Every one sits behind the session, the CSRF token and
//! the deny-by-default router, names the revision of the selections file it
//! was based on (a stale one is a `409` that changes nothing), takes the
//! content lock first and then the store locks in their one order, resolves
//! against the saved site exactly as a build does, and replaces the file by
//! atomic rename or not at all. None of them writes the research a selection
//! points at, and none approves anything: selecting a private item is refused.

use std::collections::BTreeSet;

use openblog_core::curated_selection::{
    curation_view, validate, Basis, Code, Diagnostic, NewSelection, Provenance, SelectionKind,
    SelectionSet, SELECTIONS_FILE,
};
use serde::Deserialize;
use serde_json::{json, Value as Json};

use super::{clock, content_transaction, lock, require_json, AppState, Request, Response};
use crate::boundary::{CurationBasis, Shared, Stores};
use crate::selection_store::{self, Locks, StoreError};
use crate::site;

/// A change is a small JSON object.
const MAX_BODY: usize = 64 * 1024;
/// The most selections one ordering may name.
const MAX_ORDER: usize = 500;

/// How a selection arrives. Unknown fields are refused, so a client cannot
/// smuggle a private or unpublished field into the stored record.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectRequest {
    #[serde(default)]
    id: Option<String>,
    kind: SelectionKind,
    target: String,
    #[serde(default)]
    optional_fields: Vec<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    by: Option<String>,
    #[serde(default)]
    locator: Option<String>,
    #[serde(default)]
    provenance: Provenance,
    #[serde(default)]
    requires: Vec<String>,
    #[serde(default)]
    posts: Option<Vec<String>>,
    #[serde(default)]
    position: Option<u32>,
}

impl From<SelectRequest> for NewSelection {
    fn from(request: SelectRequest) -> Self {
        Self {
            id: request.id,
            kind: Some(request.kind),
            target: request.target,
            optional_fields: request.optional_fields,
            text: request.text,
            by: request.by,
            locator: request.locator,
            provenance: request.provenance,
            requires: request.requires,
            posts: request.posts,
            position: request.position,
        }
    }
}

/// What a change does to the set. It sees the set as stored and what the
/// build publishes, and returns the id the author's next view should focus.
type Change<'a> =
    dyn Fn(&mut SelectionSet, &Basis<'_>) -> Result<Option<String>, Vec<Diagnostic>> + 'a;

/// A change as a boxed closure, with the types the router gives it.
fn boxed<F>(apply: F) -> Box<Change<'static>>
where
    F: Fn(&mut SelectionSet, &Basis<'_>) -> Result<Option<String>, Vec<Diagnostic>> + 'static,
{
    Box::new(apply)
}

enum Failure {
    Store(StoreError),
    Refused(Vec<Diagnostic>),
}

impl From<StoreError> for Failure {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// A post slug as `slugify` writes one; anything else is not a post.
fn post_slug(text: &str) -> Option<&str> {
    let valid = !text.is_empty()
        && text.chars().count() <= 200
        && text.chars().all(|c| c.is_alphanumeric() || c == '-')
        && !text.starts_with('-');
    valid.then_some(text)
}

fn failure_response(state: &AppState, failure: Failure) -> Response {
    match failure {
        Failure::Store(StoreError::Conflict) => Response::json(
            409,
            &json!({
                "error": StoreError::Conflict.to_string(),
                "conflict": true,
                "revision": selection_store::load(&state.root).ok().map(|snapshot| snapshot.revision),
            }),
        ),
        Failure::Store(StoreError::Invalid(diagnostics)) => Response::json(
            422,
            &json!({
                "error": diagnostics.first().map_or_else(
                    || "The curated selections cannot be read.".to_string(),
                    |first| format!("{} Nothing was changed.", first.message),
                ),
                "file": SELECTIONS_FILE,
                "diagnostics": diagnostics,
            }),
        ),
        Failure::Store(StoreError::Storage(message)) => {
            Response::json(500, &json!({ "error": message, "file": SELECTIONS_FILE }))
        }
        Failure::Refused(diagnostics) => {
            let unknown = diagnostics
                .first()
                .is_some_and(|first| first.code == Code::UnknownSelection);
            Response::json(
                if unknown { 404 } else { 422 },
                &json!({
                    "error": diagnostics.first().map_or_else(
                        || "The change is not allowed.".to_string(),
                        |first| format!("{} Nothing was changed.", first.message),
                    ),
                    "file": SELECTIONS_FILE,
                    "diagnostics": diagnostics,
                }),
            )
        }
    }
}

/// Load the saved site as the server builds it. The build lock covers the
/// content snapshot only, as for the other previews.
fn load_saved_site(
    state: &AppState,
) -> Result<(openblog_core::Site, openblog_core::theme::ThemeSet), Response> {
    site::load_site(&state.root, state.include_drafts, Some(clock::now())).map_err(|error| {
        Response::json(
            422,
            &json!({
                "error": format!(
                    "The site could not be loaded, so nothing can be curated: {} Nothing was changed.",
                    error.lines().next().unwrap_or_default()
                ),
            }),
        )
    })
}

/// Read the stores a selection resolves against, attach the projections the
/// build attaches, and hand the basis to `with`. The curated switch is forced
/// on for the read so that the library is read for a site that has not yet
/// turned curation on: the author prepares it before publishing it.
fn with_basis<R>(
    state: &AppState,
    site: &mut openblog_core::Site,
    with: impl FnOnce(&openblog_core::Site, &Basis<'_>) -> R,
) -> R {
    let mut config = site.config.clone();
    config.curated_context.publish = true;
    let shared = Shared::read(&state.root, &config);
    crate::boundary::project_with(&state.root, site, &shared);
    let stores = Stores::read(&state.root, &shared);
    let owned = CurationBasis::of(site, &stores);
    with(site, &owned.basis(site, &stores))
}

fn view_json(
    state: &AppState,
    site: &mut openblog_core::Site,
    set: &SelectionSet,
    revision: &str,
    post: Option<&str>,
) -> Json {
    let publish = site.config.curated_context.publish;
    with_basis(state, site, |_, basis| {
        let resolution = openblog_core::curated_selection::resolve(set, basis);
        serde_json::to_value(curation_view(
            set,
            &resolution,
            basis,
            post,
            revision,
            publish,
        ))
        .unwrap_or_else(|_| json!({}))
    })
}

/// `GET research/curation[?post=<slug>]`: the author's view. Read-only.
pub(super) fn view(state: &AppState, req: &Request) -> Response {
    let post = match req.query.get("post").map(String::as_str) {
        None | Some("") => None,
        Some(text) => match post_slug(text) {
            Some(slug) => Some(slug.to_string()),
            None => return Response::error(400, "That is not a post slug"),
        },
    };
    let guard = lock(&state.build);
    let loaded = load_saved_site(state);
    drop(guard);
    let (mut site, _) = match loaded {
        Ok(loaded) => loaded,
        Err(response) => return response,
    };
    let snapshot = match selection_store::load(&state.root) {
        Ok(snapshot) => snapshot,
        Err(error) => return failure_response(state, error.into()),
    };
    Response::json(
        200,
        &view_json(
            state,
            &mut site,
            &snapshot.selections,
            &snapshot.revision,
            post.as_deref(),
        ),
    )
}

/// One attempt at a change: read the set, check the revision, apply the
/// change against what the build publishes, and either write it (under the
/// locks) or only check it (without them).
fn attempt(
    state: &AppState,
    site: &mut openblog_core::Site,
    expected: &str,
    post: Option<&str>,
    change: &Change<'_>,
    locks: Option<&Locks>,
) -> Result<(Json, Option<String>), Failure> {
    let snapshot = selection_store::load(&state.root)?;
    if snapshot.revision != expected {
        return Err(Failure::Store(StoreError::Conflict));
    }
    let mut set = snapshot.selections.clone();
    let focus =
        with_basis(state, site, |_, basis| change(&mut set, basis)).map_err(Failure::Refused)?;
    let revision = match locks {
        Some(locks) => selection_store::commit(&state.root, locks, &set, expected)?.revision,
        None => expected.to_string(),
    };
    Ok((view_json(state, site, &set, &revision, post), focus))
}

/// Apply one change under the content lock first and then the store locks.
fn change(
    state: &AppState,
    req: &Request,
    status: u16,
    prepare: impl FnOnce(&Json) -> Result<(Option<String>, Box<Change<'static>>), Response>,
) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_BODY {
        return Response::error(413, "A curation change is limited to 64 KiB");
    }
    let body: Json = match serde_json::from_slice::<Json>(&req.body) {
        Ok(body) if body.is_object() => body,
        _ => return Response::error(400, "Invalid JSON"),
    };
    let Some(revision) = body["revision"].as_str().map(str::to_string) else {
        return Response::error(400, "Missing curated selections revision");
    };
    let (post, apply) = match prepare(&body) {
        Ok(prepared) => prepared,
        Err(response) => return response,
    };
    // The content lock first: the posts a selection is resolved against
    // cannot change while it is written. Then the stores, in their order.
    let _content = lock(&state.build);
    let _filesystem = match content_transaction(state) {
        Ok(guard) => guard,
        Err(response) => return response,
    };
    let (mut site, _) = match load_saved_site(state) {
        Ok(loaded) => loaded,
        Err(response) => return response,
    };
    // While nothing is stored the change is first tried without the locks, so
    // a refused change never creates the private directory.
    if !selection_store::directory_exists(&state.root) {
        if let Err(failure) = attempt(state, &mut site, &revision, post.as_deref(), &*apply, None) {
            return failure_response(state, failure);
        }
    }
    let locks = match selection_store::lock(&state.root) {
        Ok(locks) => locks,
        Err(error) => return failure_response(state, error.into()),
    };
    match attempt(
        state,
        &mut site,
        &revision,
        post.as_deref(),
        &*apply,
        Some(&locks),
    ) {
        Ok((mut view, focus)) => {
            if let Some(id) = focus {
                view["changed"] = json!(id);
            }
            Response::json(status, &view)
        }
        Err(failure) => failure_response(state, failure),
    }
}

fn post_of(body: &Json) -> Result<Option<String>, Response> {
    match body["post"].as_str() {
        None | Some("") => Ok(None),
        Some(text) => post_slug(text)
            .map(|slug| Some(slug.to_string()))
            .ok_or_else(|| Response::error(400, "That is not a post slug")),
    }
}

fn id_of(body: &Json) -> Result<String, Response> {
    body["id"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        .map(str::to_string)
        // Checked before it is named in any message, so a hostile id is never echoed.
        .ok_or_else(|| Response::error(400, "Name the id of the selection"))
}

fn unknown(id: &str) -> Vec<Diagnostic> {
    vec![Diagnostic {
        code: Code::UnknownSelection,
        id: Some(id.to_string()),
        field: None,
        message: format!("There is no selection `{id}`."),
    }]
}

/// `POST research/curation/selections`: select something the build publishes.
pub(super) fn select(state: &AppState, req: &Request) -> Response {
    change(state, req, 201, |body| {
        let post = post_of(body)?;
        let request: SelectRequest = serde_json::from_value(body["selection"].clone())
            .map_err(|error| Response::error(422, &format!("Invalid selection: {error}")))?;
        let new = NewSelection::from(request);
        Ok((
            post,
            boxed(move |set, basis| set.select(new.clone(), basis).map(Some)),
        ))
    })
}

/// `PUT research/curation/selections`: `{ action: "reselect" | "withdraw" |
/// "scope", id, ... }`.
pub(super) fn update(state: &AppState, req: &Request) -> Response {
    change(state, req, 200, |body| {
        let post = post_of(body)?;
        let id = id_of(body)?;
        let action = body["action"].as_str().unwrap_or("").to_string();
        match action.as_str() {
            "reselect" => Ok((
                post,
                boxed(move |set, basis| {
                    set.reselect(&id, basis)?;
                    Ok(Some(id.clone()))
                }),
            )),
            "withdraw" => {
                let reason = body["reason"].as_str().map(str::to_string);
                Ok((
                    post,
                    boxed(move |set, _| {
                        if !set.withdraw(&id, reason.clone()) {
                            return Err(unknown(&id));
                        }
                        let problems = set.get(&id).map(validate).unwrap_or_default();
                        if problems.is_empty() {
                            Ok(Some(id.clone()))
                        } else {
                            Err(problems)
                        }
                    }),
                ))
            }
            "scope" => {
                let posts = match &body["posts"] {
                    Json::Null => None,
                    value => Some(
                        serde_json::from_value::<Vec<String>>(value.clone()).map_err(|_| {
                            Response::error(
                                422,
                                "`posts` is a list of post slugs, or null for the whole site",
                            )
                        })?,
                    ),
                };
                Ok((
                    post,
                    boxed(move |set, basis| {
                        let position = set.get(&id).ok_or_else(|| unknown(&id))?.position;
                        set.rescope(&id, posts.clone(), position, basis)?;
                        Ok(Some(id.clone()))
                    }),
                ))
            }
            _ => Err(Response::error(
                422,
                "`action` is reselect, withdraw or scope",
            )),
        }
    })
}

/// `PUT research/curation/order`: `{ post, order: [ids] }`. The listed
/// selections take positions 1..n in that order. All or nothing: a stale or
/// unknown selection refuses the whole ordering.
pub(super) fn order(state: &AppState, req: &Request) -> Response {
    change(state, req, 200, |body| {
        let post = post_of(body)?.ok_or_else(|| Response::error(400, "Name the post to order"))?;
        let ids: Vec<String> = serde_json::from_value(body["order"].clone())
            .map_err(|_| Response::error(422, "`order` is a list of selection ids"))?;
        let distinct: BTreeSet<&String> = ids.iter().collect();
        if ids.is_empty() || ids.len() > MAX_ORDER || distinct.len() != ids.len() {
            return Err(Response::error(
                422,
                "`order` names 1 to 500 different selections",
            ));
        }
        let scope = post.clone();
        Ok((
            Some(post),
            boxed(move |set, basis| {
                for (index, id) in ids.iter().enumerate() {
                    let selection = set.get(id).ok_or_else(|| unknown(id))?;
                    // A selection that is not offered to this post cannot be
                    // ordered among its items.
                    let applies = selection
                        .posts
                        .as_ref()
                        .is_none_or(|posts| posts.contains(&scope));
                    if !applies {
                        return Err(vec![Diagnostic {
                            code: Code::BadPosts,
                            id: Some(id.clone()),
                            field: Some("posts".into()),
                            message: format!("Selection `{id}` is not offered to this post, so it has no place among its items."),
                        }]);
                    }
                    let posts = selection.posts.clone();
                    let position = u32::try_from(index + 1).unwrap_or(u32::MAX);
                    set.rescope(id, posts, Some(position), basis)?;
                }
                Ok(ids.first().cloned())
            }),
        ))
    })
}

/// `DELETE research/curation/selections`: remove the record. The research it
/// selected is untouched.
pub(super) fn unselect(state: &AppState, req: &Request) -> Response {
    change(state, req, 200, |body| {
        let post = post_of(body)?;
        let id = id_of(body)?;
        Ok((
            post,
            boxed(move |set, _| {
                if set.unselect(&id) {
                    Ok(None)
                } else {
                    Err(unknown(&id))
                }
            }),
        ))
    })
}

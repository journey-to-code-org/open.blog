//! Writing together, the server side of Studio R14a (`docs/specs/studio/r14/ux.md`, G110–G119).
//!
//! - **Co-writer sign-ins (G110).** An account whose `kind` is `co-writer` reaches only the routes
//!   in [`CO_WRITER_ROUTES`]; every other Admin API route answers 403 before any handler runs, in
//!   `preflight` (so no body is read) and again in `api`. The list is an allowlist: a route nobody
//!   classified is an owner's. The route-table test (`tests/together_routes.rs`) reads the router
//!   and fails when a route is in neither [`CO_WRITER_ROUTES`] nor [`OWNER_ROUTES`].
//! - **`meta` by account (G111)**, **invite someone new and join by link (G112)**, **start with a
//!   sharing choice (G113)**, **the list with state (G115)**, **put away (G116)**, **codes on every
//!   collaboration answer (G117)**.
//!
//! Invitation tokens arrive only in a request body or the `X-Openblog-Invitation` header, are
//! never stored (only their hash, in the record) and never written to the log.

use super::*;
use openblog_core::approval::ApprovalState;
use openblog_core::invitation::InvitationState;

/// The one address that works with no session besides `login`: the join page's.
pub(crate) const JOIN: &str = "collaboration/invitations/join";
/// The header that carries an invitation token on `GET join`. Never a query, so no address,
/// history entry or access log ever holds it.
pub(crate) const TOKEN_HEADER: &str = "x-openblog-invitation";

/// What a co-writer sign-in may call: its session, its reduced `meta`, and the collaboration
/// routes, each of which still authorizes by the reflection's own record. Starting a reflection,
/// publishing, scheduling, making a collection, putting away, looking up a link on another site,
/// and every route outside Writing together stay with owner accounts.
pub(crate) const CO_WRITER_ROUTES: &[(&str, &str)] = &[
    ("POST", "logout"),
    ("GET", "session"),
    ("GET", "meta"),
    ("GET", "collaboration/publications"),
    ("GET", "collaboration/invitations"),
    ("POST", "collaboration/invitations"),
    ("POST", "collaboration/invitations/revoke"),
    ("POST", "collaboration/invitations/reissue"),
    ("POST", "collaboration/invitations/accept"),
    ("POST", "collaboration/invitations/decline"),
    ("GET", "collaboration/members"),
    ("POST", "collaboration/members/roles"),
    ("POST", "collaboration/members/remove"),
    ("GET", "collaboration/draft"),
    ("PUT", "collaboration/draft"),
    ("GET", "collaboration/reveal"),
    ("PUT", "collaboration/reveal/policy"),
    ("PUT", "collaboration/reveal/ready"),
    ("GET", "collaboration/approval-policy"),
    ("PUT", "collaboration/approval-policy"),
    ("GET", "collaboration/reflection"),
    ("PUT", "collaboration/reflection"),
    ("GET", "collaboration/preview"),
    ("GET", "collaboration/series"),
    ("PUT", "collaboration/series"),
    ("GET", "collaboration/synthesis"),
    ("POST", "collaboration/synthesis"),
    ("GET", "collaboration/moments"),
    ("POST", "collaboration/moments"),
    ("POST", "collaboration/approve"),
    ("POST", "collaboration/approve/withdraw"),
    // The combined preview's document, only the one made for this sign-in (`preview_document`).
    ("GET", "preview/*"),
];

/// Every other route the router has, decided: owner accounts only. Prefix routes are written
/// `name/*` with `*` for any method. Kept beside the allowlist so a reviewer sees both halves.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const OWNER_ROUTES: &[(&str, &str)] = include!("together_owner_routes.in");

/// Routes answered before any session exists. `join` checks its own token and throttles.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const NO_SESSION_ROUTES: &[(&str, &str)] =
    &[("POST", "login"), ("GET", JOIN), ("POST", JOIN)];

/// Every code a collaboration answer can carry (G117), so Studio's `togetherProblem` can be tested
/// against the whole list: a code added here and not there fails its test.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const CODES: &[&str] = &[
    "not-found",
    "changed",
    "busy",
    "published",
    "unapproved",
    "rule-unmet",
    "occupied",
    "too-large",
    "revision-limit",
    "unsafe-markup",
    "reserved-heading",
    "layout-mismatch",
    "moment-unresolved",
    "moment-unsafe",
    "invalid",
    "affirmed",
    "account-taken",
    "name-taken",
    "already-invited",
    "owner-only",
    "invalid-invitation",
    "password",
    "too-many-tries",
    "storage",
    "build",
];

/// May a co-writer session call this route?
pub(crate) fn co_writer_may(method: &str, name: &str) -> bool {
    if method == "GET" && name.starts_with("preview/") {
        return true;
    }
    CO_WRITER_ROUTES
        .iter()
        .any(|(m, n)| *m == method && *n == name)
}

/// The answer to a co-writer reaching past Writing together. The same for every such route, and
/// nothing is read or written before it.
pub(crate) fn refused() -> Response {
    Response::json(
        403,
        &json!({ "error": "This sign-in opens only Writing together.", "code": "owner-only" }),
    )
}

/// A refusal with a code (G117) and, where a field caused it, the field.
pub(crate) fn problem(status: u16, code: &str, message: &str, field: Option<&str>) -> Response {
    let mut body = json!({ "error": message, "code": code });
    if let Some(field) = field {
        body["field"] = json!(field);
    }
    Response::json(status, &body)
}

/// Whether `name` is an owner account (every account made before co-writers is one).
pub(crate) fn is_owner_account(state: &AppState, name: &str) -> bool {
    let config = site::load_config(&state.root).unwrap_or_default();
    Users::load(&state.root.join(&config.admin.users_file))
        .ok()
        .and_then(|users| users.find(name).map(|record| !record.is_co_writer()))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// G117: a code on every collaboration answer
// ---------------------------------------------------------------------------

/// Add a `code` to a collaboration answer that has none, from its status and its structured
/// fields (never its sentence). The sentence stays for one release (G117).
pub(crate) fn coded(mut response: Response) -> Response {
    if response.status < 400 || response.status == 401 {
        return response;
    }
    let Ok(mut body) = serde_json::from_slice::<Json>(&response.body) else {
        return response;
    };
    let Some(object) = body.as_object_mut() else {
        return response;
    };
    if object.contains_key("code") {
        return response;
    }
    let code = match response.status {
        404 => "not-found",
        403 => "owner-only",
        409 if object.contains_key("missing") => "unapproved",
        409 if object.contains_key("unmetNamed") || object.contains_key("unmetRoles") => {
            "rule-unmet"
        }
        409 => "changed",
        413 => "too-large",
        429 => "too-many-tries",
        400 => "invalid-invitation",
        422 if object.get("field").and_then(Json::as_str) == Some("affirmed") => "affirmed",
        422 => "invalid",
        _ => "storage",
    };
    object.insert("code".into(), json!(code));
    response.body = body.to_string().into_bytes();
    response
}

// ---------------------------------------------------------------------------
// G111: meta by account
// ---------------------------------------------------------------------------

/// `meta` for this sign-in: an owner's in full, with `account` and `together`; a co-writer's
/// holds only what Writing together needs, so nothing about the site's settings leaves the server
/// for them, and nothing of it is kept on their device.
pub(crate) fn meta(
    state: &AppState,
    session: &auth::Session,
    full: impl FnOnce() -> Response,
) -> Response {
    let together = together_counts(state, session);
    if session.co_writer {
        let config = match site::load_config(&state.root) {
            Ok(config) => config,
            Err(error) => return Response::error(500, &error),
        };
        return Response::json(
            200,
            &json!({
                "account": "co-writer",
                "siteTitle": config.title,
                "siteUrl": config.url,
                "now": clock::now().rfc3339(),
                "studioWords": studio_words::for_meta(&config, state.studio_words_path.as_deref()),
                "together": together,
            }),
        );
    }
    let mut response = full();
    if response.status == 200 {
        if let Ok(mut body) = serde_json::from_slice::<Json>(&response.body) {
            body["account"] = json!("owner");
            body["together"] = together;
            response.body = body.to_string().into_bytes();
        }
    }
    response
}

fn together_counts(state: &AppState, session: &auth::Session) -> Json {
    let summaries = summaries(state, session, false).unwrap_or_default();
    let waiting = summaries
        .iter()
        .filter(|summary| summary["you"]["waitingOnYou"] == true)
        .count();
    json!({
        "takingPart": summaries.len(),
        "waitingOnYou": waiting,
        "canStart": !session.co_writer,
    })
}

// ---------------------------------------------------------------------------
// G115, G116: the list, with where each reflection stands; put away
// ---------------------------------------------------------------------------

/// `GET collaboration/publications`: every reflection this sign-in may see, with its state, who is
/// in it and where each person is, and what is waiting on the requester (G115). Put-away ones only
/// with `?archived=1` (G116). Never anyone's words, and for other people only what the reveal and
/// the preview already tell them: ready, agreed, or not yet.
pub(crate) fn list(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let archived = req.query.get("archived").map(String::as_str) == Some("1");
    match summaries(state, session, archived) {
        Ok(publications) => Response::json(200, &json!({ "publications": publications })),
        Err(response) => response,
    }
}

fn put_away_directory(root: &Path) -> Result<PathBuf, String> {
    crate::assistant_storage::contained_target(
        root,
        Path::new(".openblog/private/collaboration/put-away"),
    )
    .map_err(|_| "storage resolves outside the project".to_string())
}

fn is_put_away(root: &Path, publication_id: &str) -> bool {
    put_away_directory(root)
        .map(|directory| directory.join(publication_id).is_file())
        .unwrap_or(false)
}

fn summaries(
    state: &AppState,
    session: &auth::Session,
    archived: bool,
) -> Result<Vec<Json>, Response> {
    let ids = {
        let _content_transaction = lock(&state.build);
        crate::shared_publications::load_all(&state.root)
            .map_err(|error| Response::error(500, &error))?
            .into_iter()
            .map(|(_, record)| record.publication_id)
            .collect::<Vec<_>>()
    };
    let mut out = Vec::new();
    for id in ids {
        if is_put_away(&state.root, &id) != archived {
            continue;
        }
        let transaction = invitation_transaction(state, &id)?;
        let Some(record) = &transaction.record else {
            continue;
        };
        if let Some(summary) = summary(state, &transaction, record, session) {
            out.push(summary);
        }
    }
    Ok(out)
}

/// One reflection as the requester may see it, or none when they may not see it at all.
fn summary(
    state: &AppState,
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
) -> Option<Json> {
    use openblog_core::assembly::Outcome;
    let may = |action: AuthorizationAction| {
        transaction
            .with_identities(|identities| {
                record.authorize(
                    &session.user,
                    identities,
                    action,
                    AuthorizationTarget::Publication,
                )
            })
            .ok()
            .map(|binding| binding.roles.clone())
    };
    let roles = may(AuthorizationAction::ViewPublication)?;
    let id = &record.publication_id;
    let own = draft_owner(transaction, record, session);
    let active = active_drafters(transaction, record);
    let active_refs = active.iter().map(String::as_str).collect::<Vec<_>>();
    let set = crate::shared_publications::load_drafts(&state.root, id)
        .ok()
        .and_then(|stored| draft_set_for(stored.set.as_ref(), record).ok());
    let outcome = crate::shared_publications::load_outcome(&state.root, id)
        .ok()
        .and_then(|stored| stored.outcome);
    let can_invite = may(AuthorizationAction::Invite).is_some();
    let can_run = may(AuthorizationAction::SetRevealPolicy).is_some();
    let can_publish = !session.co_writer && may(AuthorizationAction::Publish).is_some();
    let in_charge = roles.contains(&AuthorizationRole::SiteOwner);
    // The preview says, for a drafter, where each author's agreement stands and whether the rule
    // can be met; it is built as the gate would build it, and its document is dropped here.
    let preview = match (&own, &set) {
        (Some(own), Some(set)) => {
            let config = site::load_config(&state.root).unwrap_or_default();
            let structure = crate::shared_publications::load_structure(&state.root, id).ok()?;
            let synthesis = crate::shared_publications::load_synthesis(&state.root, id).ok()?;
            let moments = crate::shared_publications::load_moments(&state.root, id).ok()?;
            let approvals = crate::shared_publications::load_approvals(&state.root, id).ok()?;
            openblog_core::preview::build(
                record,
                structure.structure.as_ref(),
                set,
                &synthesis.set,
                &moments.set,
                &approvals,
                own,
                &active_refs,
                false,
                config.render_options(),
            )
            .ok()
        }
        _ => None,
    };
    let policy = set
        .as_ref()
        .map(DraftSet::policy)
        .unwrap_or(RevealPolicy::Independent);
    let approval_of = |participant: &str| {
        preview.as_ref().and_then(|preview| {
            preview
                .sections
                .iter()
                .find(|section| section.participant_id == participant)
                .map(|section| section.approval)
        })
    };
    let people = record
        .collaboration
        .participants
        .iter()
        .map(|participant| {
            let you = own.as_deref() == Some(participant.id.as_str());
            let binding = record
                .authorization
                .bindings
                .iter()
                .find(|binding| binding.participant_id == participant.id);
            let drafter = active.contains(&participant.id);
            let ready = set.as_ref().is_some_and(|set| {
                set.is_ready(&participant.id) || set.shared_revision(&participant.id).is_some()
            });
            let wrote = set
                .as_ref()
                .is_some_and(|set| set.current_stamp(&participant.id).is_some());
            let where_ = if binding.is_none() {
                "left"
            } else if !drafter {
                "reads"
            } else {
                match approval_of(&participant.id) {
                    Some(ApprovalState::Approved) => "agreed",
                    Some(ApprovalState::Stale) => "agreedEarlier",
                    _ if ready => "ready",
                    // Whether anyone else has started is theirs to tell: the reveal never says.
                    _ if you && wrote => "writing",
                    _ if you => "notStarted",
                    _ => "notReady",
                }
            };
            json!({ "displayName": participant.display_name, "where": where_, "you": you })
        })
        .collect::<Vec<_>>();
    let now = clock::now().unix();
    let pending = record
        .invitations
        .iter()
        .filter(|invitation| invitation.status(now) == InvitationState::Pending)
        .collect::<Vec<_>>();
    let invited = if can_invite {
        pending
            .iter()
            .map(|invitation| {
                json!({
                    "forName": transaction.contributors.get(&invitation.contributor_id).cloned().unwrap_or_default(),
                    "expiresAt": invitation.expires_at,
                })
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let (wrote, shared, changed_since) = match (&own, &set) {
        (Some(own), Some(set)) => {
            let latest = set.current_stamp(own).map(|stamp| stamp.number);
            let shared = set.shared_revision(own);
            (
                latest.is_some(),
                shared.is_some(),
                matches!((latest, shared), (Some(latest), Some(shared)) if latest > shared),
            )
        }
        _ => (false, false, false),
    };
    let own_approval = own.as_deref().and_then(approval_of);
    // When everyone's ready, a change someone shared after the last exchange reaches the others
    // only once everyone has offered again: their offer is waiting on the requester's.
    let offered = matches!((&own, &set), (Some(own), Some(set)) if set.is_ready(own));
    let needs_reshare = policy == RevealPolicy::AllReady
        && shared
        && !offered
        && !changed_since
        && match (&own, &set) {
            (Some(own), Some(set)) => active.iter().any(|id| id != own && set.is_ready(id)),
            _ => false,
        };
    let unmet = preview
        .as_ref()
        .map(|preview| {
            (
                preview.rule.unmet_named.clone(),
                preview.rule.unmet_roles.clone(),
            )
        })
        .unwrap_or_default();
    // Everyone's part can be read only once every author has let the others read one: the
    // preview alone counts an author who hasn't written yet as nothing missing.
    let everyone_shared = !active.is_empty()
        && set.as_ref().is_some_and(|set| {
            active
                .iter()
                .all(|id| set.is_ready(id) || set.shared_revision(id).is_some())
        });
    let complete = everyone_shared && preview.as_ref().is_some_and(|preview| preview.complete);
    let ready = preview.as_ref().is_some_and(|preview| preview.ready);
    let missing = preview
        .as_ref()
        .map(|preview| {
            preview
                .sections
                .iter()
                .filter(|section| section.required && section.approval != ApprovalState::Approved)
                .map(|section| section.display_name.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let (state_word, publish_at) = match &outcome {
        Some(Outcome::Published { .. }) => ("published", None),
        Some(Outcome::Scheduled { publish_at, .. }) => (
            "scheduled",
            Some(DateTime::from_unix(*publish_at).rfc3339()),
        ),
        None if active.len() > 1 && policy == RevealPolicy::Independent => ("privateParts", None),
        None if !unmet.0.is_empty() || !unmet.1.is_empty() => ("stuck", None),
        None if ready => ("ready", None),
        None if complete => ("agreeing", None),
        None if people.iter().any(|person| person["where"] == "ready") => ("sharing", None),
        None if wrote => ("writing", None),
        None => ("started", None),
    };
    let drafter = own.is_some();
    let waiting_on_you = match state_word {
        "published" | "scheduled" | "stuck" | "privateParts" => false,
        "ready" => can_publish,
        _ => {
            drafter
                && (!wrote
                    || !shared
                    || changed_since
                    || needs_reshare
                    || (complete && own_approval != Some(ApprovalState::Approved)))
        }
    };
    // Whose sign-off publishes it when this sign-in can't: the first owner account in charge.
    let publisher = record
        .authorization
        .bindings
        .iter()
        .filter(|binding| binding.roles.contains(&AuthorizationRole::SiteOwner))
        .find(|binding| is_owner_account(state, &binding.admin_user))
        .and_then(|binding| {
            record
                .collaboration
                .participants
                .iter()
                .find(|participant| participant.id == binding.participant_id)
                .map(|participant| participant.display_name.clone())
        });
    Some(json!({
        "publicationId": record.publication_id,
        "title": record.title,
        "guidingQuestion": record.guiding_question,
        "sources": record.sources,
        "roles": roles,
        "state": state_word,
        "policy": policy,
        "people": people,
        "invitationsWaiting": pending.len(),
        "invited": invited,
        "you": {
            "drafter": drafter,
            "wrote": wrote,
            "shared": shared,
            "changedSinceShared": changed_since,
            "offered": offered,
            "needsReshare": needs_reshare,
            "agreed": own_approval == Some(ApprovalState::Approved),
            "agreedStale": own_approval == Some(ApprovalState::Stale),
            "canPublish": can_publish,
            "canInvite": can_invite,
            "runsIt": can_run,
            "inCharge": in_charge,
            "waitingOnYou": waiting_on_you,
        },
        "complete": complete,
        "missing": missing,
        "unmetNamed": unmet.0,
        "unmetRoles": unmet.1,
        "publishAt": publish_at,
        "path": (state_word == "published").then(|| openblog_core::assembly::post_path(record)),
        "archived": is_put_away(&state.root, &record.publication_id),
        "publisherName": publisher,
    }))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PutAwayRequest {
    publication_id: String,
    archived: bool,
}

/// `POST collaboration/publications/archive` (G116): an owner account in charge of a reflection
/// that isn't published takes it off the list, or brings it back. Nothing is deleted: the record,
/// everyone's parts and their agreements stay exactly as they were.
pub(crate) fn put_away(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    use openblog_core::assembly::Outcome;
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<PutAwayRequest>(&req.body) else {
        return problem(422, "invalid", "This request is not valid.", Some(""));
    };
    if session.co_writer {
        return refused();
    }
    let transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return publish_not_found();
    };
    let in_charge = transaction
        .with_identities(|identities| {
            record.authorize(
                &session.user,
                identities,
                AuthorizationAction::ViewPublication,
                AuthorizationTarget::Publication,
            )
        })
        .is_ok_and(|binding| binding.roles.contains(&AuthorizationRole::SiteOwner));
    if !in_charge {
        return publish_not_found();
    }
    let published = crate::shared_publications::load_outcome(&state.root, &record.publication_id)
        .map(|stored| matches!(stored.outcome, Some(Outcome::Published { .. })))
        .unwrap_or(true);
    if published {
        return problem(
            409,
            "published",
            "This reflection is already published. Nothing was changed.",
            None,
        );
    }
    let directory = match put_away_directory(&state.root) {
        Ok(directory) => directory,
        Err(error) => return Response::error(500, &error),
    };
    let marker = directory.join(&record.publication_id);
    let result = if body.archived {
        fs::create_dir_all(&directory).and_then(|()| fs::write(&marker, b""))
    } else {
        match fs::remove_file(&marker) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        }
    };
    if let Err(error) = result {
        eprintln!("admin: put-away mark not stored: {error}");
        return problem(500, "storage", "Nothing was changed; try again.", None);
    }
    Response::json(200, &json!({ "archived": body.archived }))
}

// ---------------------------------------------------------------------------
// G113: start with a sharing choice
// ---------------------------------------------------------------------------

/// `POST collaboration/publications` with an optional `revealPolicy` (G113). The record is made by
/// the existing route; the sharing choice is then stored in its new, empty draft set. Absent, the
/// policy stays `independent`, as for every other caller.
pub(crate) fn create(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if session.co_writer {
        return refused();
    }
    let Ok(mut body) = serde_json::from_slice::<Json>(&req.body) else {
        return create_shared_publication(state, req, session);
    };
    let policy = match body
        .as_object_mut()
        .and_then(|object| object.remove("revealPolicy"))
    {
        None => None,
        Some(value) => match serde_json::from_value::<RevealPolicy>(value) {
            Ok(policy) => Some(policy),
            Err(_) => {
                return problem(
                    422,
                    "invalid",
                    "Choose when you read each other's parts.",
                    Some("revealPolicy"),
                )
            }
        },
    };
    let mut inner = req.clone();
    inner.body = body.to_string().into_bytes();
    let mut response = create_shared_publication(state, &inner, session);
    let Some(policy) = policy.filter(|policy| *policy != RevealPolicy::Independent) else {
        return response;
    };
    if response.status != 201 {
        return response;
    }
    let mut created = body_of(&response);
    let id = created["publication"]["publicationId"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let stored = {
        let transaction = match invitation_transaction(state, &id) {
            Ok(transaction) => transaction,
            Err(response) => return response,
        };
        let Some(record) = &transaction.record else {
            return publish_not_found();
        };
        let Ok(stored) = load_reveal_drafts(state, &id) else {
            return response;
        };
        let Ok(mut set) = draft_set_for(stored.set.as_ref(), record) else {
            return response;
        };
        set.set_policy(policy);
        crate::shared_publications::replace_drafts(&state.root, &id, &stored, &set)
    };
    if let Err(error) = stored {
        // The reflection exists and says it shares nothing: Studio shows "Each part stays
        // private" with Change, so the choice is one press away and nothing is lost.
        eprintln!("admin: sharing choice not stored for {id}: {error:?}");
        return response;
    }
    created["publication"]["policy"] = json!(policy);
    response.body = created.to_string().into_bytes();
    response
}

fn body_of(response: &Response) -> Json {
    serde_json::from_slice(&response.body).unwrap_or(Json::Null)
}

// ---------------------------------------------------------------------------
// G112: invite someone new; join by link
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct NewAccount {
    sign_in_name: String,
}

/// `POST collaboration/invitations`. With `newAccount: { signInName }` (owner accounts only), a
/// co-writer account is reserved under that name, with no password, and invited in the same
/// transaction; if the invitation is refused the reservation goes with it. Without it, the route
/// is the existing one, except that a co-writer may invite only another co-writer account.
pub(crate) fn invite(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(mut body) = serde_json::from_slice::<Json>(&req.body) else {
        return bad_invitation_request();
    };
    let new_account = body
        .as_object_mut()
        .and_then(|object| object.remove("newAccount"));
    let config = site::load_config(&state.root).unwrap_or_default();
    let users_path = state.root.join(&config.admin.users_file);
    let Some(new_account) = new_account else {
        if session.co_writer {
            // Never an owner account, never a new one: only someone who already writes together.
            let target = body["adminUser"].as_str().unwrap_or_default();
            let co_writer = Users::load(&users_path)
                .ok()
                .and_then(|users| users.find(target).map(auth::UserRecord::is_co_writer))
                .unwrap_or(false);
            if !co_writer {
                return problem(
                    403,
                    "owner-only",
                    "You can invite only people who already write together on this blog.",
                    Some("adminUser"),
                );
            }
        }
        return create_invitation(state, req, session);
    };
    if session.co_writer {
        return refused();
    }
    let Ok(new_account) = serde_json::from_value::<NewAccount>(new_account) else {
        return bad_invitation_request();
    };
    let name = new_account.sign_in_name.trim().to_string();
    if !auth::valid_username(&name) {
        return problem(
            422,
            "invalid",
            "Use lowercase letters, digits, dots, hyphens or underscores, up to 32.",
            Some("signInName"),
        );
    }
    body["adminUser"] = json!(name);
    let Ok(request) = serde_json::from_value::<InviteRequestBody>(body) else {
        return bad_invitation_request();
    };
    let mut transaction = match invitation_transaction(state, &request.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = transaction.record.clone() else {
        return invitation_not_found();
    };
    let mut users = match Users::load(&users_path) {
        Ok(users) => users,
        Err(error) => return Response::error(500, &error),
    };
    if users.find(&name).is_some() {
        return problem(
            422,
            "name-taken",
            "Someone already signs in with that name.",
            Some("signInName"),
        );
    }
    let (id, secret) = match new_invitation_ids() {
        Ok(ids) => ids,
        Err(error) => return Response::error(500, &error),
    };
    let new = NewInvitation {
        id,
        secret,
        admin_user: name.clone(),
        contributor_id: request.contributor_id,
        roles: request.roles,
        lifetime_days: request.lifetime_days,
    };
    let now = clock::now().unix();
    // The reserved name counts as an account for this one invitation, before it is written.
    transaction.admin_users.push(name.clone());
    let invited = transaction
        .with_identities(|identities| record.invite(&session.user, identities, &new, now));
    if let Err(InvitationError::Invalid(InvitationField::ContributorId)) = invited {
        return problem(
            422,
            "already-invited",
            "That person is already in this, or already invited.",
            Some("contributorId"),
        );
    }
    if invited.is_err() {
        return finish_invitation(state, &transaction, invited, &new.id, now);
    }
    if let Err(error) = users
        .add_co_writer(&name, None)
        .and_then(|()| users.save(&users_path))
    {
        eprintln!("admin: co-writer account not reserved: {error}");
        return problem(
            500,
            "storage",
            "The invitation could not be saved. Nothing changed; try again.",
            None,
        );
    }
    let response = finish_invitation(state, &transaction, invited, &new.id, now);
    if response.status != 201 {
        // Nothing was invited, so nothing stays reserved.
        if let Ok(mut users) = Users::load(&users_path) {
            if users.find(&name).is_some_and(auth::UserRecord::is_reserved) {
                users.remove(&name);
                let _ = users.save(&users_path);
            }
        }
    } else {
        eprintln!("admin: reserved a co-writer account for an invitation");
    }
    response
}

/// The existing invite request's fields, read again after `newAccount` named the account.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InviteRequestBody {
    publication_id: String,
    #[allow(dead_code)]
    admin_user: String,
    contributor_id: String,
    roles: Vec<AuthorizationRole>,
    #[serde(default)]
    lifetime_days: u32,
}

/// Release co-writer accounts reserved for invitations that ended (withdrawn, declined or
/// expired) and never joined: no pending invitation names them and no reflection binds them.
/// Run after any change that can end an invitation, under the build lock so it never races an
/// invitation being made.
pub(crate) fn release_reservations(state: &AppState) {
    let _build = lock(&state.build);
    let config = site::load_config(&state.root).unwrap_or_default();
    let path = state.root.join(&config.admin.users_file);
    let Ok(mut users) = Users::load(&path) else {
        return;
    };
    let reserved = users
        .users
        .iter()
        .filter(|user| user.is_reserved())
        .map(|user| user.name.clone())
        .collect::<Vec<_>>();
    if reserved.is_empty() {
        return;
    }
    let Ok(records) = crate::shared_publications::load_all(&state.root) else {
        return;
    };
    let now = clock::now().unix();
    let mut released = 0;
    for name in reserved {
        let in_use = records.iter().any(|(_, record)| {
            record.invitations.iter().any(|invitation| {
                invitation.admin_user == name && invitation.status(now) == InvitationState::Pending
            }) || record
                .authorization
                .bindings
                .iter()
                .any(|binding| binding.admin_user == name)
        });
        if !in_use && users.remove(&name) {
            released += 1;
        }
    }
    if released > 0 && users.save(&path).is_ok() {
        eprintln!("admin: released {released} unused co-writer reservation(s)");
    }
}

/// After revoking or declining: release what the ended invitation reserved.
pub(crate) fn then_release(state: &AppState, response: Response) -> Response {
    if response.status < 300 {
        release_reservations(state);
    }
    response
}

fn invalid_invitation() -> Response {
    problem(
        404,
        "invalid-invitation",
        "This link doesn't work any more. Ask the person who sent it for a new one.",
        None,
    )
}

/// Five tries per address and per reflection in a window, as signing in has (ADR 0013); a good
/// token refunds both.
fn join_throttle(
    state: &AppState,
    req: &Request,
    publication_id: &str,
) -> Result<[String; 2], Response> {
    let config = site::load_config(&state.root).unwrap_or_default();
    let keys = [
        format!("join:ip:{}", client_ip(&config, req)),
        format!("join:publication:{publication_id}"),
    ];
    let mut throttle = lock(&state.throttle);
    for key in &keys {
        if let Err(wait) = throttle.reserve(key) {
            return Err(problem(
                429,
                "too-many-tries",
                "Too many tries. Wait a few minutes, then open the link again.",
                None,
            )
            .with_header("Retry-After", &wait.to_string()));
        }
    }
    Ok(keys)
}

fn refund(state: &AppState, keys: &[String; 2]) {
    let mut throttle = lock(&state.throttle);
    for key in keys {
        throttle.clear(key);
    }
}

/// `GET` and `POST collaboration/invitations/join`, with no session (G112).
pub(crate) fn join(state: &AppState, req: &Request) -> Response {
    let response = match req.method.as_str() {
        "GET" => join_view(state, req),
        "POST" => durable(state, || join_answer(state, req)),
        _ => Response::error(405, "Method not allowed"),
    };
    response.with_header("Cache-Control", "no-store")
}

/// What the join page shows: whose invitation, for which reflection, under which name, and
/// whether a password must be chosen. The token comes only from the header.
fn join_view(state: &AppState, req: &Request) -> Response {
    let token = req
        .header(TOKEN_HEADER)
        .unwrap_or_default()
        .trim()
        .to_string();
    let publication_id = openblog_core::invitation::token_publication_id(&token)
        .unwrap_or("unknown")
        .to_string();
    let keys = match join_throttle(state, req, &publication_id) {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    release_reservations(state);
    let config = site::load_config(&state.root).unwrap_or_default();
    let Ok(Some(record)) = crate::shared_publications::load(&state.root, &publication_id) else {
        return invalid_invitation();
    };
    let now = clock::now().unix();
    let Some(invitation) = record.pending_for_token(&token, now) else {
        return invalid_invitation();
    };
    let users = Users::load(&state.root.join(&config.admin.users_file)).unwrap_or_default();
    let Some(account) = users.find(&invitation.admin_user) else {
        return invalid_invitation();
    };
    refund(state, &keys);
    let invited_by = record
        .collaboration
        .participants
        .iter()
        .find(|participant| participant.id == invitation.invited_by)
        .map(|participant| participant.display_name.clone())
        .unwrap_or_default();
    Response::json(
        200,
        &json!({
            "publicationId": record.publication_id,
            "title": record.title,
            "question": record.guiding_question,
            "invitedBy": invited_by,
            "forName": config.contributors.get(&invitation.contributor_id).map(|c| c.name.clone()).unwrap_or_default(),
            "contributorId": invitation.contributor_id,
            "roles": invitation.roles,
            "newAccount": account.is_reserved(),
            "signInName": invitation.admin_user,
            "expiresAt": invitation.expires_at,
        }),
    )
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct JoinRequest {
    token: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    decline: bool,
}

/// A new person says yes (choosing their password) or no thanks. Yes sets the password, accepts
/// the invitation and signs them in, in one step: if the reflection can't be stored, the
/// password is taken back, so a failed join leaves an account that still cannot sign in.
fn join_answer(state: &AppState, req: &Request) -> Response {
    if let Err(response) = check_origin(req) {
        return response;
    }
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<JoinRequest>(&req.body) else {
        return invalid_invitation();
    };
    let publication_id = openblog_core::invitation::token_publication_id(&body.token)
        .unwrap_or("unknown")
        .to_string();
    let keys = match join_throttle(state, req, &publication_id) {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    let config = site::load_config(&state.root).unwrap_or_default();
    let users_path = state.root.join(&config.admin.users_file);
    let outcome = {
        let transaction = match invitation_transaction(state, &publication_id) {
            Ok(transaction) => transaction,
            Err(response) => return response,
        };
        let Some(record) = transaction.record.clone() else {
            return invalid_invitation();
        };
        let now = clock::now().unix();
        let Some(invitation) = record.pending_for_token(&body.token, now).cloned() else {
            return invalid_invitation();
        };
        let mut users = match Users::load(&users_path) {
            Ok(users) => users,
            Err(error) => return Response::error(500, &error),
        };
        // Only an account reserved for this invitation joins here; one that can sign in says yes
        // from Studio, signed in, so a link can never set an existing account's password.
        if !users
            .find(&invitation.admin_user)
            .is_some_and(auth::UserRecord::is_reserved)
        {
            return invalid_invitation();
        }
        let name = invitation.admin_user.clone();
        if body.decline {
            let next = match record.decline_invitation(&name, &body.token, now) {
                Ok(next) => next,
                Err(_) => return invalid_invitation(),
            };
            if let Err(response) = transaction.store(&state.root, &next) {
                return response;
            }
            None
        } else {
            if let Err(message) = auth::check_password_policy(&body.password) {
                let _ = message;
                // A wrong password shape is not a wrong token: give the try back.
                refund(state, &keys);
                return problem(422, "password", "At least 12 characters.", Some("password"));
            }
            let Some(display_name) = transaction
                .contributors
                .get(&invitation.contributor_id)
                .cloned()
            else {
                return invalid_invitation();
            };
            let next = match transaction.with_identities(|identities| {
                record.accept_invitation(
                    &name,
                    identities,
                    &body.token,
                    &invitation.contributor_id,
                    &display_name,
                    now,
                )
            }) {
                Ok(next) => next,
                Err(_) => return invalid_invitation(),
            };
            if let Err(error) = users
                .set(&name, &body.password)
                .and_then(|()| users.save(&users_path))
            {
                eprintln!("admin: co-writer password not stored: {error}");
                return problem(500, "storage", "Nothing changed; try again.", None);
            }
            if let Err(response) = transaction.store(&state.root, &next) {
                // Take the password back: the account stays one that cannot sign in.
                if let Ok(mut users) = Users::load(&users_path) {
                    if let Some(user) = users.users.iter_mut().find(|user| user.name == name) {
                        user.hash.clear();
                        let _ = users.save(&users_path);
                    }
                }
                return response;
            }
            reconcile_approvals(state, &transaction, &next);
            let hash = Users::load(&users_path)
                .ok()
                .and_then(|users| users.find(&name).map(|user| user.hash.clone()))
                .unwrap_or_default();
            Some((name, hash, next.publication_id.clone()))
        }
    };
    refund(state, &keys);
    let Some((name, hash, publication_id)) = outcome else {
        release_reservations(state);
        eprintln!("admin: an invitation was declined from its link");
        return Response::json(200, &json!({ "declined": true }));
    };
    let ttl = Duration::from_secs(u64::from(config.admin.session_hours.clamp(1, 24 * 30)) * 3600);
    let (token, session) = match lock(&state.sessions).create(&name, &hash, ttl) {
        Ok(created) => created,
        Err(error) => return Response::error(500, &error),
    };
    eprintln!("admin: '{name}' joined a shared publication and signed in");
    Response::json(
        200,
        &json!({ "user": name, "csrf": session.csrf, "now": clock::now().rfc3339(), "publicationId": publication_id }),
    )
    .with_header(
        "Set-Cookie",
        &session_cookie(&token, ttl.as_secs(), config.admin.secure_cookies),
    )
}

/// Run a write that has no session, as `api` runs signed-in writes: inside the durable workspace
/// transaction when the site keeps one, acknowledged only once it is saved.
fn durable(state: &AppState, run: impl FnOnce() -> Response) -> Response {
    if !state.workspace_enabled {
        return run();
    }
    let mut workspace = lock(&state.workspace);
    let _filesystem = if workspace.is_some() {
        match crate::transaction::ContentTransactionLock::acquire_with_wait(
            &state.root,
            CONTENT_LOCK_WAIT,
        ) {
            Ok(transaction) => Some(transaction),
            Err(error) => return Response::json(409, &json!({ "error": error, "code": "busy" })),
        }
    } else {
        None
    };
    let _durable = _filesystem.as_ref().map(|_| {
        DURABLE_TRANSACTION.with(|active| active.set(true));
        DurableTransaction
    });
    if let Some(store) = workspace.as_mut() {
        if let Err(error) = store.begin() {
            return Response::error(503, &format!("Workspace save NOT acknowledged: {error}"));
        }
    }
    let response = run();
    if let Some(store) = workspace.as_mut() {
        if let Err(error) = store.save(&state.root) {
            return Response::error(
                503,
                &format!("Workspace save NOT acknowledged; local changes may exist. {error}"),
            );
        }
    }
    response
}

// ---------------------------------------------------------------------------
// G120 (R14b): the sign-ins of people writing with you
// ---------------------------------------------------------------------------

/// `GET collaboration/co-writers` (owner accounts only): every co-writer sign-in, the reflections
/// it is in, and whether it is still waiting for its invited person to choose a password. Names and
/// titles only; never a hash.
pub(crate) fn co_writers(state: &AppState, session: &auth::Session) -> Response {
    if session.co_writer {
        return refused();
    }
    let config = site::load_config(&state.root).unwrap_or_default();
    let users = match Users::load(&state.root.join(&config.admin.users_file)) {
        Ok(users) => users,
        Err(error) => return Response::error(500, &error),
    };
    let records = {
        let _content_transaction = lock(&state.build);
        match crate::shared_publications::load_all(&state.root) {
            Ok(records) => records,
            Err(error) => return Response::error(500, &error),
        }
    };
    let list = users
        .users
        .iter()
        .filter(|user| user.is_co_writer())
        .map(|user| {
            let reflections = records
                .iter()
                .filter(|(_, record)| {
                    record
                        .authorization
                        .bindings
                        .iter()
                        .any(|binding| binding.admin_user == user.name)
                })
                .map(|(_, record)| {
                    json!({
                        "publicationId": record.publication_id,
                        "title": record.title.clone().or_else(|| record.guiding_question.clone()),
                    })
                })
                .collect::<Vec<_>>();
            json!({ "name": user.name, "waiting": user.is_reserved(), "reflections": reflections })
        })
        .collect::<Vec<_>>();
    Response::json(200, &json!({ "coWriters": list }))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CoWriterRemoveRequest {
    name: String,
}

/// `POST collaboration/co-writers/remove` (owner accounts only): the sign-in goes, and so does every
/// binding and pending invitation under its name (ADR 0006), so a name made again later inherits
/// nothing. Credit for what they wrote stays with the reflection's participant.
pub(crate) fn remove_co_writer(
    state: &AppState,
    req: &Request,
    session: &auth::Session,
) -> Response {
    if session.co_writer {
        return refused();
    }
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<CoWriterRemoveRequest>(&req.body) else {
        return problem(422, "invalid", "This request is not valid.", Some("name"));
    };
    let _build = lock(&state.build);
    let config = site::load_config(&state.root).unwrap_or_default();
    let path = state.root.join(&config.admin.users_file);
    let mut users = match Users::load(&path) {
        Ok(users) => users,
        Err(error) => return Response::error(500, &error),
    };
    // Only a co-writer sign-in is removed here; an owner account is the developer's to remove.
    if !users
        .find(&body.name)
        .is_some_and(auth::UserRecord::is_co_writer)
    {
        return problem(404, "not-found", "There is no such sign-in.", Some("name"));
    }
    users.remove(&body.name);
    if let Err(error) = users.save(&path) {
        eprintln!("admin: co-writer sign-in not removed: {error}");
        return problem(500, "storage", "Nothing was changed; try again.", None);
    }
    match crate::shared_publications::revoke_admin_user(&state.root, &body.name) {
        Ok(changed) => {
            eprintln!(
                "admin: removed a co-writer sign-in and its bindings in {changed} reflection(s)"
            );
            Response::json(200, &json!({ "removed": true, "reflections": changed }))
        }
        Err(error) => {
            eprintln!("admin: co-writer bindings not revoked: {error}");
            problem(
                500,
                "storage",
                "The sign-in is removed; its reflections could not all be updated. Try again.",
                None,
            )
        }
    }
}

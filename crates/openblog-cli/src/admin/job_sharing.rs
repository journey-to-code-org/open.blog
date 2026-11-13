//! Admin routes for sharing a finished job (story #488, ADRs 0393 to 0396):
//! `GET /admin/api/job-share?path=posts/<file>.md` and `POST /admin/api/job-share/by-hand`.
//!
//! The first shows, for Google Business Profile, a Facebook Page and Nextdoor, exactly what would
//! go (the projection of `openblog_core::job_destination`) and what has happened there (the private
//! record in `.openblog/job-shares.json`). The second lets the owner say she posted one by hand,
//! and take that back (`undo: true`, Studio R1 G17), which removes only her own by-hand mark.
//! Nothing here sends anything: Google is sent from the command (ADR 0393), and a Facebook Page is
//! reached through the announcement routes, which the screen calls itself (ADR 0396).

use openblog_core::job_destination::JobDestination;

use super::*;
use crate::job_share::{self, Record, State, Status, Which};

fn state_path(state: &AppState) -> PathBuf {
    state.root.join(job_share::STATE_FILE)
}

fn unshareable(error: String) -> Response {
    Response::json(422, &json!({ "error": error, "code": "not-shareable" }))
}

/// Everything the Share this job screen shows for one job.
pub(super) fn get(state: &AppState, req: &Request) -> Response {
    let path = req.query.get("path").map(String::as_str).unwrap_or("");
    if path.is_empty() || path.len() > 512 {
        return Response::error(400, "Name the job to share");
    }
    let job = match job_share::load_job(&state.root, Which::Source(path), &JobDestination::ALL) {
        Ok(job) => job,
        Err(error) => return unshareable(error),
    };
    let records = match State::load(&state_path(state)) {
        Ok(records) => records,
        Err(error) => return Response::error(500, &error),
    };
    let google_sending = site::load_config(&state.root)
        .ok()
        .and_then(|config| config.syndication.google_business_profile)
        .is_some_and(|google| google.enabled);
    let destinations: Vec<Json> = job
        .projections
        .iter()
        .map(|projection| {
            let record = records.record(&job.source_path, projection.destination);
            let mut value = serde_json::to_value(projection).unwrap_or(Json::Null);
            value["record"] = serde_json::to_value(record).unwrap_or(Json::Null);
            value["changedSince"] = Json::Bool(record.is_some_and(|record| {
                matches!(record.status, Status::Posted | Status::PostedByHand)
                    && record.digest != projection.digest
            }));
            value
        })
        .collect();
    Response::json(
        200,
        &json!({
            "title": job.title,
            "path": job.source_path,
            "work": job.work,
            "googleSending": google_sending,
            "announcements": social::is_configured(),
            "destinations": destinations,
        }),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ByHandBody {
    path: String,
    destination: String,
    #[serde(default)]
    digest: Option<String>,
    #[serde(default)]
    undo: bool,
}

/// The owner says she posted the job by hand at one destination, exactly as shown (its digest).
pub(super) fn by_hand(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > 2048 {
        return Response::error(413, "The request is too large");
    }
    let Ok(body) = serde_json::from_slice::<ByHandBody>(&req.body) else {
        return Response::error(400, "The request is not valid for this route");
    };
    let Some(destination) = JobDestination::parse(&body.destination) else {
        return Response::error(400, "That is not a place a job can go");
    };
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let job = match job_share::load_job(&state.root, Which::Source(&body.path), &[destination]) {
        Ok(job) => job,
        Err(error) => return unshareable(error),
    };
    if body.undo {
        return undo_by_hand(state, &job.source_path, destination);
    }
    let Some(digest) = body.digest.as_deref() else {
        return Response::error(400, "Say which words were posted");
    };
    let Some(projection) = job.projections.first() else {
        return Response::error(500, "No projection was built");
    };
    if !projection.ready {
        return Response::json(
            409,
            &json!({ "error": "Fix the problems shown for this place first.", "code": "not-ready" }),
        );
    }
    if projection.digest != digest.trim() {
        return Response::json(
            409,
            &json!({ "error": "The job changed since this screen was opened. Look at it again, then say you posted it.", "code": "changed" }),
        );
    }
    let path = state_path(state);
    let mut records = match State::load(&path) {
        Ok(records) => records,
        Err(error) => return Response::error(500, &error),
    };
    // A post open.blog made or may have made is never overwritten by a by-hand mark.
    if records
        .record(&job.source_path, destination)
        .is_some_and(|record| matches!(record.status, Status::Posted | Status::Unknown))
    {
        return Response::json(
            409,
            &json!({ "error": "open.blog already sent this, or may have. Check the place first.", "code": "sent" }),
        );
    }
    let record = Record {
        status: Status::PostedByHand,
        at: clock::now().rfc3339(),
        digest: projection.digest.clone(),
        post_name: None,
        post_url: None,
        failure: None,
    };
    records.set(&job.source_path, destination, record.clone());
    if let Err(error) = records.save(&path) {
        return Response::error(500, &error);
    }
    Response::json(
        200,
        &json!({ "destination": destination, "record": record }),
    )
}

/// Takes back her own "I posted it" (G17). Only a by-hand mark goes: a post open.blog made, or may
/// have made, is never forgotten from here.
fn undo_by_hand(state: &AppState, source: &str, destination: JobDestination) -> Response {
    let path = state_path(state);
    let mut records = match State::load(&path) {
        Ok(records) => records,
        Err(error) => return Response::error(500, &error),
    };
    match records
        .record(source, destination)
        .map(|record| record.status)
    {
        Some(Status::PostedByHand) => {}
        None => {
            return Response::json(
                200,
                &json!({ "destination": destination, "record": Json::Null }),
            )
        }
        Some(_) => {
            return Response::json(
                409,
                &json!({ "error": "Only your own \"I posted it\" can be taken back here.", "code": "not-by-hand" }),
            )
        }
    }
    records.remove(source, destination);
    if let Err(error) = records.save(&path) {
        return Response::error(500, &error);
    }
    Response::json(
        200,
        &json!({ "destination": destination, "record": Json::Null }),
    )
}

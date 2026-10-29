//! Admin routes for scheduled social announcements (ADR 0471, story #356).
//!
//! Every route sits behind the session, and every write behind the CSRF check (`api`); a name no
//! route owns is a 404 (deny by default). The browser never talks to Supabase or to the hosted
//! function: these routes check the announcement against the site (a public post, its own
//! address, a valid caption and time), then call the hosted function with the server-held admin
//! key and name the signed-in Admin user in `X-OpenBlog-Actor`. The key lives in the Admin
//! process's environment only: it is never read from `openblog.json`, never returned, never put
//! in an error, and never sent anywhere but the configured endpoint.
//!
//! The feature is off unless `OPENBLOG_SOCIAL_ENABLED=true` and an endpoint and key are set; until
//! then every route but `social/status` answers 404 and reads no social state.

use openblog_core::social_schedule::{
    announceable, check_canonical_url, check_caption, check_caption_for_all, check_idempotency_key,
    check_time_zone, parse_schedule, utc_instant, Provider, ScheduleError,
};
use openblog_core::LoadOptions;

use super::*;

/// The largest body any social route accepts (a caption is at most 3,000 characters).
pub(super) const MAX_REQUEST_BYTES: usize = 32 * 1024;
/// The most posts the composer's picker lists.
const MAX_POSTS: usize = 100;
/// The largest answer read from the hosted function.
const MAX_ANSWER_BYTES: usize = 1024 * 1024;
const ENDPOINT_ENVIRONMENT_NAME: &str = "OPENBLOG_SOCIAL_ENDPOINT";
const KEY_ENVIRONMENT_NAME: &str = "OPENBLOG_SOCIAL_ADMIN_KEY";
const ENABLED_ENVIRONMENT_NAME: &str = "OPENBLOG_SOCIAL_ENABLED";

/// Where the hosted function is and the key that proves this Admin may call it.
pub(super) struct Hosted {
    endpoint: String,
    key: String,
}

impl Hosted {
    /// `None` unless social publishing is switched on and fully set: exactly `true`, an `https`
    /// endpoint (or plain `http` to this machine, for local development) and a key of at least 32
    /// characters. Nothing about a half-set feature is reported beyond "not configured".
    pub(super) fn from_environment() -> Option<Self> {
        let enabled = std::env::var(ENABLED_ENVIRONMENT_NAME).ok()?;
        if enabled.trim() != "true" {
            return None;
        }
        let endpoint = std::env::var(ENDPOINT_ENVIRONMENT_NAME).ok()?;
        let key = std::env::var(KEY_ENVIRONMENT_NAME).ok()?;
        Self::new(endpoint.trim(), key.trim())
    }

    pub(super) fn new(endpoint: &str, key: &str) -> Option<Self> {
        if key.len() < 32 || key.chars().any(char::is_whitespace) {
            return None;
        }
        let url = url::Url::parse(endpoint).ok()?;
        let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
        let scheme_ok = url.scheme() == "https" || (url.scheme() == "http" && local);
        (scheme_ok
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none())
        .then(|| Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            key: key.to_string(),
        })
    }
}

/// One request to the hosted function.
pub(super) struct Call {
    pub method: &'static str,
    pub route: String,
    pub query: Vec<(String, String)>,
    pub actor: String,
    pub body: Option<Json>,
}

/// The seam to the hosted function. `Err` is a fixed message for a function that cannot be
/// reached; it never carries the endpoint, a key or anything the function said.
pub(super) trait Transport {
    fn send(&self, call: &Call) -> Result<(u16, Json), &'static str>;
}

impl<F: Fn(&Call) -> Result<(u16, Json), &'static str>> Transport for F {
    fn send(&self, call: &Call) -> Result<(u16, Json), &'static str> {
        self(call)
    }
}

struct Http<'a>(&'a Hosted);

impl Transport for Http<'_> {
    fn send(&self, call: &Call) -> Result<(u16, Json), &'static str> {
        let mut url = format!("{}/{}", self.0.endpoint, call.route);
        if !call.query.is_empty() {
            url.push('?');
            url.push_str(
                &url::form_urlencoded::Serializer::new(String::new())
                    .extend_pairs(&call.query)
                    .finish(),
            );
        }
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(20)))
            .max_redirects(0)
            .http_status_as_error(false)
            .user_agent(concat!("open.blog-admin/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let authorization = format!("Bearer {}", self.0.key);
        let sent = match (&call.body, call.method) {
            (Some(body), "PATCH") => agent
                .patch(&url)
                .header("Authorization", &authorization)
                .header("X-OpenBlog-Actor", &call.actor)
                .header("Content-Type", "application/json")
                .send(body.to_string().as_bytes()),
            (Some(body), _) => agent
                .post(&url)
                .header("Authorization", &authorization)
                .header("X-OpenBlog-Actor", &call.actor)
                .header("Content-Type", "application/json")
                .send(body.to_string().as_bytes()),
            (None, _) => agent
                .get(&url)
                .header("Authorization", &authorization)
                .header("X-OpenBlog-Actor", &call.actor)
                .call(),
        };
        let mut response = match sent {
            Ok(response) => response,
            Err(ureq::Error::Timeout(_)) => return Err("The hosted social function timed out."),
            Err(_) => return Err("The hosted social function could not be reached."),
        };
        let status = response.status().as_u16();
        let bytes = response
            .body_mut()
            .with_config()
            .limit(MAX_ANSWER_BYTES as u64)
            .read_to_vec()
            .map_err(|_| "The hosted social function sent an answer that could not be read.")?;
        Ok((status, serde_json::from_slice(&bytes).unwrap_or(Json::Null)))
    }
}

/// The entry point from the route table. `name` is what follows `social/`.
pub(super) fn handle(
    state: &AppState,
    req: &Request,
    session: &auth::Session,
    name: &str,
) -> Response {
    match Hosted::from_environment() {
        Some(hosted) => route_with_hosted(state, req, &session.user, name, &hosted),
        None => route(state, req, &session.user, name, None, &|_: &Call| {
            Err("Social publishing is not configured.")
        }),
    }
}

/// The routes, calling the hosted function over HTTP.
pub(super) fn route_with_hosted(
    state: &AppState,
    req: &Request,
    user: &str,
    name: &str,
    hosted: &Hosted,
) -> Response {
    route(state, req, user, name, Some(hosted), &Http(hosted))
}

pub(super) fn route(
    state: &AppState,
    req: &Request,
    user: &str,
    name: &str,
    hosted: Option<&Hosted>,
    transport: &dyn Transport,
) -> Response {
    if (req.method.as_str(), name) == ("GET", "status") {
        return Response::json(200, &json!({ "enabled": hosted.is_some() }));
    }
    // Off: the feature does not exist. A route that is not part of it is a 404 either way.
    if hosted.is_none() {
        return Response::error(404, "Social publishing is not configured");
    }
    match (req.method.as_str(), name) {
        ("GET", "posts") => posts(state),
        ("POST", "preview") => preview(state, req),
        ("GET", "destinations") => relay(transport, user, "GET", "destinations", Vec::new(), None),
        ("GET", "announcements") => list(transport, user, req),
        ("POST", "announcements") => create(state, transport, user, req),
        ("PATCH", "announcements") => edit(transport, user, req),
        ("POST", "announcements/reschedule") => reschedule(transport, user, req),
        ("POST", "announcements/cancel") => cancel(transport, user, req),
        _ => Response::error(404, "Unknown API route"),
    }
}

fn body_of<T: serde::de::DeserializeOwned>(req: &Request) -> Result<T, Response> {
    require_json(req)?;
    if req.body.len() > MAX_REQUEST_BYTES {
        return Err(Response::error(413, "The request is too large"));
    }
    // A fixed message: serde's own would name the field it did not like.
    serde_json::from_slice(&req.body)
        .map_err(|_| Response::error(400, "The request is not valid for this route"))
}

fn problem(error: ScheduleError) -> Response {
    Response::json(
        422,
        &json!({ "error": error.to_string(), "code": error.code() }),
    )
}

fn announcement_id(req: &Request) -> Result<String, Response> {
    let id = req.query.get("id").map(String::as_str).unwrap_or("");
    let shaped = id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase(),
        });
    if shaped {
        Ok(id.to_string())
    } else {
        Err(Response::json(
            400,
            &json!({ "error": "That is not an announcement id.", "code": "invalid-id" }),
        ))
    }
}

/// The site as the author sees it now, drafts and scheduled posts included, so each can be
/// explained rather than silently missing.
fn load(state: &AppState) -> Result<(openblog_core::Site, SiteConfig), String> {
    let config = site::load_config(&state.root)?;
    let sources = site::read_sources(&state.root, &config)?;
    let (site, _themes) = site::load_site_from_sources(
        &state.root,
        config.clone(),
        sources,
        LoadOptions {
            include_drafts: true,
            now: Some(clock::now()),
            preview_source: None,
        },
    )?;
    Ok((site, config))
}

fn posts(state: &AppState) -> Response {
    let (site, config) = match load(state) {
        Ok(loaded) => loaded,
        Err(error) => return Response::error(500, &error),
    };
    let now = clock::now();
    let list: Vec<Json> = site
        .posts
        .iter()
        .take(MAX_POSTS)
        .map(|post| match announceable(&site, &config, post, now) {
            Ok(found) => json!({
                "work": found.work, "title": post.title, "date": post.date.rfc3339(),
                "canonicalUrl": found.canonical_url, "eligible": true, "reason": Json::Null,
            }),
            Err(error) => json!({
                "work": post.url, "title": post.title, "date": post.date.rfc3339(),
                "canonicalUrl": Json::Null, "eligible": false,
                "reason": { "code": error.code(), "message": error.to_string() },
            }),
        })
        .collect();
    Response::json(200, &json!({ "posts": list, "now": now.rfc3339() }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewBody {
    provider: String,
    caption: String,
    work: Option<String>,
    scheduled_for: Option<String>,
    time_zone: Option<String>,
}

/// Everything wrong with a draft at once, so the composer can say it beside the field. Nothing is
/// stored and the hosted function is not called.
fn preview(state: &AppState, req: &Request) -> Response {
    let body: PreviewBody = match body_of(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let mut problems = Vec::new();
    let mut add = |field: &str, error: ScheduleError| {
        problems
            .push(json!({ "field": field, "code": error.code(), "message": error.to_string() }));
    };
    let provider = Provider::parse(&body.provider);
    let (caption, limit) = match provider {
        Ok(provider) => match check_caption(provider, &body.caption) {
            Ok(text) => (Some(text), provider.caption_limit()),
            Err(error) => {
                add("caption", error);
                (None, provider.caption_limit())
            }
        },
        Err(error) => {
            add("destination", error);
            (None, 0)
        }
    };
    let now = clock::now();
    let scheduled =
        body.scheduled_for
            .as_deref()
            .and_then(|value| match parse_schedule(value, now) {
                Ok(at) => Some(utc_instant(at)),
                Err(error) => {
                    add("scheduledFor", error);
                    None
                }
            });
    if let Some(zone) = body.time_zone.as_deref() {
        if let Err(error) = check_time_zone(zone) {
            add("timeZone", error);
        }
    }
    let link = body
        .work
        .as_deref()
        .and_then(|work| match canonical_for(state, work, now) {
            Ok(url) => Some(url),
            Err(error) => {
                add("work", error);
                None
            }
        });
    Response::json(
        200,
        &json!({
            "ok": problems.is_empty() && caption.is_some() && scheduled.is_some() && link.is_some(),
            "caption": caption,
            "characters": body.caption.replace("\r\n", "\n").trim().chars().count(),
            "limit": limit,
            "scheduledFor": scheduled,
            "link": link,
            "problems": problems,
        }),
    )
}

/// The post's own public address, from the site and never from the request.
fn canonical_for(state: &AppState, work: &str, now: DateTime) -> Result<String, ScheduleError> {
    let (site, config) = load(state).map_err(|_| ScheduleError::PostNotPublished)?;
    let post = site
        .posts
        .iter()
        .find(|post| post.url == work)
        .ok_or(ScheduleError::PostNotPublished)?;
    announceable(&site, &config, post, now).map(|found| found.canonical_url)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateBody {
    account_id: String,
    work: String,
    caption: String,
    scheduled_for: String,
    time_zone: Option<String>,
    idempotency_key: String,
}

fn create(state: &AppState, transport: &dyn Transport, user: &str, req: &Request) -> Response {
    let body: CreateBody = match body_of(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let now = clock::now();
    let checked = (|| {
        check_idempotency_key(&body.idempotency_key)?;
        if let Some(zone) = body.time_zone.as_deref() {
            check_time_zone(zone)?;
        }
        let caption = check_caption_for_all(&body.caption)?;
        let at = parse_schedule(&body.scheduled_for, now)?;
        let url = canonical_for(state, &body.work, now)?;
        check_canonical_url(&url, &body.work)?;
        Ok::<_, ScheduleError>((caption, utc_instant(at), url))
    })();
    let (caption, scheduled_for, url) = match checked {
        Ok(values) => values,
        Err(error) => return problem(error),
    };
    let mut payload = json!({
        "accountId": body.account_id,
        "work": body.work,
        "canonicalUrl": url,
        "caption": caption,
        "scheduledFor": scheduled_for,
        "idempotencyKey": body.idempotency_key,
    });
    if let Some(zone) = body.time_zone {
        payload["timeZone"] = Json::String(zone);
    }
    relay(
        transport,
        user,
        "POST",
        "announcements",
        Vec::new(),
        Some(payload),
    )
}

fn list(transport: &dyn Transport, user: &str, req: &Request) -> Response {
    let mut query = Vec::new();
    for name in ["status", "work", "limit"] {
        if let Some(value) = req.query.get(name) {
            query.push((name.to_string(), value.clone()));
        }
    }
    relay(transport, user, "GET", "announcements", query, None)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditBody {
    version: u64,
    caption: Option<String>,
    scheduled_for: Option<String>,
    time_zone: Option<String>,
}

fn edit(transport: &dyn Transport, user: &str, req: &Request) -> Response {
    let id = match announcement_id(req) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let body: EditBody = match body_of(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let mut payload = json!({ "version": body.version });
    if let Err(response) = checked_change(
        &mut payload,
        &body.caption,
        &body.scheduled_for,
        &body.time_zone,
    ) {
        return response;
    }
    relay(
        transport,
        user,
        "PATCH",
        "announcements",
        vec![("id".into(), id)],
        Some(payload),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RescheduleBody {
    version: u64,
    scheduled_for: String,
    time_zone: Option<String>,
}

fn reschedule(transport: &dyn Transport, user: &str, req: &Request) -> Response {
    let id = match announcement_id(req) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let body: RescheduleBody = match body_of(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let mut payload = json!({ "version": body.version });
    if let Err(response) = checked_change(
        &mut payload,
        &None,
        &Some(body.scheduled_for),
        &body.time_zone,
    ) {
        return response;
    }
    relay(
        transport,
        user,
        "POST",
        "announcements/reschedule",
        vec![("id".into(), id)],
        Some(payload),
    )
}

/// Applies the caption and time rules to a change and writes the normalized values into `payload`.
fn checked_change(
    payload: &mut Json,
    caption: &Option<String>,
    scheduled_for: &Option<String>,
    time_zone: &Option<String>,
) -> Result<(), Response> {
    if caption.is_none() && scheduled_for.is_none() {
        return Err(Response::json(
            400,
            &json!({ "error": "Send a new caption or time.", "code": "nothing-to-change" }),
        ));
    }
    if let Some(zone) = time_zone {
        check_time_zone(zone).map_err(problem)?;
        payload["timeZone"] = Json::String(zone.clone());
    }
    if let Some(caption) = caption {
        payload["caption"] = Json::String(check_caption_for_all(caption).map_err(problem)?);
    }
    if let Some(value) = scheduled_for {
        let at = parse_schedule(value, clock::now()).map_err(problem)?;
        payload["scheduledFor"] = Json::String(utc_instant(at));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelBody {
    version: u64,
}

fn cancel(transport: &dyn Transport, user: &str, req: &Request) -> Response {
    let id = match announcement_id(req) {
        Ok(id) => id,
        Err(response) => return response,
    };
    let body: CancelBody = match body_of(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    relay(
        transport,
        user,
        "POST",
        "announcements/cancel",
        vec![("id".into(), id)],
        Some(json!({ "version": body.version })),
    )
}

/// Calls the hosted function and returns only what the composer needs. An answer is passed on
/// only through an allow-list of fields; anything else the function says is dropped, a function
/// that rejects the Admin's own key is reported as a setup problem (never as a session problem),
/// and an unreachable one is a fixed 502.
fn relay(
    transport: &dyn Transport,
    user: &str,
    method: &'static str,
    route: &str,
    query: Vec<(String, String)>,
    body: Option<Json>,
) -> Response {
    let call = Call {
        method,
        route: route.to_string(),
        query,
        actor: user.to_string(),
        body,
    };
    let (status, value) = match transport.send(&call) {
        Ok(answer) => answer,
        Err(message) => return Response::error(502, message),
    };
    if (200..300).contains(&status) {
        let mut kept = Map::new();
        for name in ["announcement", "announcements", "destinations", "replayed"] {
            if let Some(found) = value.get(name) {
                kept.insert(name.to_string(), found.clone());
            }
        }
        if kept.is_empty() {
            return Response::error(502, "The hosted social function sent an unexpected answer.");
        }
        return Response::json(status, &Json::Object(kept));
    }
    let code = value["code"].as_str().filter(|code| plain_code(code));
    match (status, code) {
        (401 | 403, _) => Response::json(
            502,
            &json!({
                "error": "The hosted social function did not accept this Admin's key. Check OPENBLOG_SOCIAL_ADMIN_KEY on both sides.",
                "code": "hosted-key-rejected",
            }),
        ),
        (404, None) => Response::json(
            502,
            &json!({
                "error": "The hosted social function is not enabled or the endpoint is wrong.",
                "code": "hosted-unavailable",
            }),
        ),
        (400 | 404 | 405 | 409 | 413 | 422, Some(code)) => {
            let mut kept = Map::new();
            kept.insert("code".into(), Json::String(code.to_string()));
            let message = value["error"].as_str().filter(|text| plain_message(text));
            kept.insert(
                "error".into(),
                Json::String(message.unwrap_or("The request was refused.").to_string()),
            );
            for name in ["version", "status"] {
                if value[name].is_u64() || value[name].is_string() {
                    kept.insert(name.to_string(), value[name].clone());
                }
            }
            Response::json(status, &Json::Object(kept))
        }
        _ => Response::json(
            502,
            &json!({
                "error": "The hosted social function could not complete the request.",
                "code": "hosted-failed",
            }),
        ),
    }
}

fn plain_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 40
        && code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// A message from the function is shown only when short and free of anything that looks like a
/// credential or markup; the function writes fixed text, so this is a second lock.
fn plain_message(text: &str) -> bool {
    text.len() <= 300
        && !text
            .chars()
            .any(|c| c.is_control() || matches!(c, '<' | '>'))
}

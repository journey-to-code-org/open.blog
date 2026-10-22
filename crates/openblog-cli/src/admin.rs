//! The login-protected editor: sessions, a JSON API for posts, series, pages
//! and images, and the scheduler that publishes posts when their time comes.
//!
//! Security model, in short:
//! - Every API route except login needs a valid session cookie
//!   (`HttpOnly`, `SameSite=Strict`) checked *before* any request body is read.
//! - Every state-changing request also needs the session's CSRF token in the
//!   `X-CSRF-Token` header and, when a browser sends one, a same-origin `Origin`.
//! - File paths from clients are validated against a strict allow-list and
//!   resolved inside the content directory, so they cannot escape it.
//! - Every save is validated against the whole site (and rendered once)
//!   before anything is written, so the editor cannot break the build.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use openblog_core::frontmatter::{self, Value};
use openblog_core::markdown::{self, RenderOptions};
use openblog_core::slug::slugify;
use openblog_core::{generate, DateTime, LoadOptions, Site, SiteConfig, SourceFile};
use serde_json::{json, Map, Value as Json};

use crate::auth::{self, Sessions, Throttle, Users};
use crate::clock;
use crate::fsutil;
use crate::http::{Request, Response};
use crate::site::{self, BuildOptions, BuildReport};

pub const SESSION_COOKIE: &str = "ob_session";
const MAX_JSON_BODY: usize = 2 * 1024 * 1024 + 64 * 1024;
const MAX_LOGIN_BODY: usize = 4 * 1024;
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct BuildStatus {
    pub next_due: Option<DateTime>,
    pub last_built: Option<DateTime>,
    pub last_error: Option<String>,
    /// (title, slug, date) of posts waiting for their publish time.
    pub scheduled: Vec<(String, String, String)>,
}

pub struct AppState {
    pub root: PathBuf,
    pub out_override: Option<PathBuf>,
    /// Build drafts and scheduled posts into the public site (`serve --drafts`).
    pub include_drafts: bool,
    pub admin: bool,
    pub build: Mutex<BuildStatus>,
    pub sessions: Mutex<Sessions>,
    pub throttle: Mutex<Throttle>,
    pub analytics: Mutex<crate::analytics::Store>,
    pub analytics_path: PathBuf,
    pub analytics_enabled: bool,
    pub cdn: openblog_core::config::CdnConfig,
    /// `/repo` when the site is built for `https://user.github.io/repo/`, else empty.
    pub base_path: String,
    /// Reverse proxies whose connections are exempt from the per-address cap.
    pub trusted_proxies: Vec<String>,
    /// Serialises publishes so two saves never run git at the same time.
    pub publish_lock: Mutex<()>,
    /// Last analytics backup to the branch, as a unix time.
    pub last_backup: Mutex<i64>,
}

/// The server registers its `Arc<AppState>` here so request handlers, which
/// only hold `&AppState`, can hand a clone to background work.
static SHARED: std::sync::OnceLock<Mutex<Vec<Arc<AppState>>>> = std::sync::OnceLock::new();

pub fn register(state: &Arc<AppState>) {
    lock(SHARED.get_or_init(|| Mutex::new(Vec::new()))).push(Arc::clone(state));
}

fn state_arc(state: &AppState) -> Arc<AppState> {
    let list = lock(SHARED.get_or_init(|| Mutex::new(Vec::new())));
    list.iter()
        .find(|s| std::ptr::eq(s.as_ref(), state))
        .cloned()
        .unwrap_or_else(|| {
            Arc::new(AppState::new(
                state.root.clone(),
                state.out_override.clone(),
                state.include_drafts,
                state.admin,
            ))
        })
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(
        root: PathBuf,
        out_override: Option<PathBuf>,
        include_drafts: bool,
        admin: bool,
    ) -> Self {
        let loaded = site::load_config(&root).unwrap_or_default();
        let analytics_config = loaded.analytics.clone();
        let cdn = loaded.cdn.clone();
        let base_path = loaded.base_path();
        let trusted_proxies = loaded.admin.trusted_proxies.clone();
        let analytics_path = root.join(".openblog").join("analytics.json");
        Self {
            root,
            out_override,
            include_drafts,
            admin,
            build: Mutex::new(BuildStatus::default()),
            sessions: Mutex::new(Sessions::default()),
            throttle: Mutex::new(Throttle::default()),
            analytics: Mutex::new(crate::analytics::Store::load(
                &analytics_path,
                analytics_config.retention_days,
            )),
            analytics_path,
            analytics_enabled: analytics_config.builtin,
            cdn,
            base_path,
            trusted_proxies,
            publish_lock: Mutex::new(()),
            last_backup: Mutex::new(0),
        }
    }

    /// Commit the analytics store to the backup branch and push it, at most
    /// every 15 minutes. Errors are returned for logging, never fatal.
    pub fn backup_analytics(&self, force: bool) -> Result<Option<String>, String> {
        let config = site::load_config(&self.root).unwrap_or_default();
        let branch = config.analytics.branch.trim().to_string();
        if !self.analytics_enabled || branch.is_empty() {
            return Ok(None);
        }
        let now = clock::now().unix();
        {
            let mut last = lock(&self.last_backup);
            if !force && now - *last < 15 * 60 {
                return Ok(None);
            }
            *last = now;
        }
        let git = crate::git::Git::new(&self.root);
        if !git.is_repo() {
            return Ok(None);
        }
        let json = lock(&self.analytics).export_json();
        let message = format!("Analytics backup {}", clock::now().rfc3339());
        let committed = git.commit_file_to_branch(&branch, "analytics.json", &json, &message)?;
        if committed.is_some() && git.has_remote(&config.publish.remote) {
            git.push_branch(&config.publish.remote, &branch)
                .map_err(|e| format!("analytics backup push failed: {e}"))?;
        }
        Ok(committed)
    }

    /// Publish in the background after a save, when `publish.auto` is on.
    pub fn auto_publish(self: &Arc<Self>, summary: String) {
        let config = site::load_config(&self.root).unwrap_or_default();
        if !config.publish.auto {
            return;
        }
        let state = Arc::clone(self);
        std::thread::spawn(move || {
            let _guard = lock(&state.publish_lock);
            match crate::publish::publish(&state.root, &config, Some(&summary)) {
                Ok(outcome) => eprintln!("publish: {}", outcome.message),
                Err(e) => eprintln!("publish failed: {e}"),
            }
        });
    }

    /// Write analytics to disk if anything changed. Called every few seconds.
    pub fn flush_analytics(&self) -> Result<(), String> {
        if !self.analytics_enabled {
            return Ok(());
        }
        // Serialise under the lock, write to disk without it.
        let snapshot = lock(&self.analytics).snapshot()?;
        match snapshot {
            Some(text) => crate::analytics::Store::write_snapshot(&self.analytics_path, &text),
            None => Ok(()),
        }
    }

    /// Build the public site. The caller holds the build lock, which also
    /// serialises content writes so two saves never interleave.
    pub fn rebuild_locked(&self, status: &mut BuildStatus) -> Result<BuildReport, String> {
        let now = clock::now();
        let result = site::build(
            &self.root,
            &BuildOptions {
                include_drafts: self.include_drafts,
                out_override: self.out_override.clone(),
                now: Some(now),
            },
        );
        match &result {
            Ok(report) => {
                status.next_due = report.next_due;
                status.last_built = Some(now);
                status.last_error = None;
                status.scheduled = scheduled_list(&self.root, now);
            }
            Err(e) => status.last_error = Some(e.clone()),
        }
        result
    }

    pub fn rebuild(&self) -> Result<BuildReport, String> {
        let mut status = lock(&self.build);
        self.rebuild_locked(&mut status)
    }

    /// Publish scheduled posts whose time has come. Called every few seconds.
    /// Returns the report when it rebuilt.
    pub fn tick_scheduler(&self) -> Option<Result<BuildReport, String>> {
        let mut status = lock(&self.build);
        let due = status.next_due.is_some_and(|d| d <= clock::now());
        if due {
            Some(self.rebuild_locked(&mut status))
        } else {
            None
        }
    }

    fn out_dir(&self, config: &SiteConfig) -> PathBuf {
        self.out_override
            .clone()
            .unwrap_or_else(|| self.root.join(&config.paths.output))
    }
}

fn scheduled_list(root: &Path, now: DateTime) -> Vec<(String, String, String)> {
    let Ok(config) = site::load_config(root) else {
        return Vec::new();
    };
    let Ok(sources) = site::read_sources(root, &config) else {
        return Vec::new();
    };
    match Site::load(
        config,
        sources,
        LoadOptions {
            include_drafts: false,
            now: Some(now),
        },
    ) {
        Ok(site) => site
            .scheduled
            .iter()
            .map(|s| (s.title.clone(), s.slug.clone(), s.date.rfc3339()))
            .collect(),
        Err(_) => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/// Decide, from the request headers alone, how large a body this route may
/// send. Unauthenticated callers get a rejection (or a tiny limit for login)
/// before any body is buffered.
pub fn preflight(state: &AppState, req: &Request) -> Result<usize, Response> {
    if req.path == "/api/hit" {
        return Ok(if state.analytics_enabled && req.method == "POST" {
            2048
        } else {
            0
        });
    }
    if !req.path.starts_with("/admin") {
        return Ok(0);
    }
    if !state.admin {
        return Err(secured(Response::error(404, "Not found")));
    }
    if let Some(name) = req.path.strip_prefix("/admin/api/") {
        if name == "login" {
            return Ok(MAX_LOGIN_BODY);
        }
        authenticate(state, req).map_err(secured)?;
        if name == "upload" {
            let config = site::load_config(&state.root).unwrap_or_default();
            return Ok(config.admin.max_upload_mb as usize * 1024 * 1024);
        }
        return Ok(MAX_JSON_BODY);
    }
    Ok(0)
}

pub fn handle(state: &AppState, req: &Request) -> Response {
    secured(route(state, req))
}

fn route(state: &AppState, req: &Request) -> Response {
    if !state.admin {
        return Response::error(404, "Not found");
    }
    let path = req.path.as_str();
    if let Some(name) = path.strip_prefix("/admin/api/") {
        return api(state, req, name);
    }
    if !req.is_read_only() {
        return Response::error(405, "Method not allowed");
    }
    let file = match path {
        "/admin" | "/admin/" => "index.html",
        "/admin/admin.js" => "admin.js",
        "/admin/admin.css" => "admin.css",
        _ => return Response::error(404, "Not found"),
    };
    let config = site::load_config(&state.root).unwrap_or_default();
    match site::admin_file(&state.root, &config, file) {
        Some(bytes) => {
            let ctype = match file {
                "admin.js" => "text/javascript; charset=utf-8",
                "admin.css" => "text/css; charset=utf-8",
                _ => "text/html; charset=utf-8",
            };
            Response::new(200, ctype, bytes)
        }
        None => Response::error(404, "Not found"),
    }
}

/// Headers every admin response carries.
fn secured(response: Response) -> Response {
    response
        .with_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: https:; \
             object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        )
        .with_header("X-Frame-Options", "DENY")
        .with_header("Referrer-Policy", "same-origin")
        .with_header("Cache-Control", "no-store")
}

fn api(state: &AppState, req: &Request, name: &str) -> Response {
    if name == "login" {
        return login(state, req);
    }
    let session = match authenticate(state, req) {
        Ok(s) => s,
        Err(r) => return r,
    };
    if !req.is_read_only() {
        if let Err(r) = check_csrf(req, &session) {
            return r;
        }
    }
    match (req.method.as_str(), name) {
        ("POST", "logout") => logout(state, req),
        ("GET", "session") => Response::json(
            200,
            &json!({ "user": session.user, "csrf": session.csrf, "now": clock::now().rfc3339() }),
        ),
        ("GET", "meta") => meta(state),
        ("GET", "status") => status(state),
        ("GET", "analytics") => {
            if !state.analytics_enabled {
                return Response::error(404, "The built-in counter is off (analytics.builtin)");
            }
            let days = req
                .query
                .get("days")
                .and_then(|d| d.parse().ok())
                .unwrap_or(30);
            let summary = lock(&state.analytics).summary(clock::now(), days);
            Response::json(200, &summary)
        }
        ("GET", "documents") => list_documents(state, req),
        ("GET", "document") => get_document(state, req),
        ("POST", "document") => save_document(state, req, None),
        ("PUT", "document") => {
            let path = req.query.get("path").cloned();
            match path {
                Some(p) => save_document(state, req, Some(p)),
                None => Response::error(400, "Missing ?path="),
            }
        }
        ("DELETE", "document") => delete_document(state, req),
        ("POST", "upload") => upload(state, req),
        ("POST", "preview") => preview(req),
        ("POST", "rebuild") => rebuild(state),
        ("GET", "publish") => {
            let config = site::load_config(&state.root).unwrap_or_default();
            match crate::publish::status(&state.root, &config) {
                Ok(v) => Response::json(200, &v),
                Err(e) => Response::error(500, &e),
            }
        }
        ("POST", "publish") => {
            if let Err(r) = require_json(req) {
                return r;
            }
            let body: Json = serde_json::from_slice(&req.body).unwrap_or(Json::Null);
            let summary = body["summary"]
                .as_str()
                .map(|s| s.chars().take(120).collect::<String>());
            let config = site::load_config(&state.root).unwrap_or_default();
            let _guard = lock(&state.publish_lock);
            match crate::publish::publish(&state.root, &config, summary.as_deref()) {
                Ok(o) => Response::json(
                    200,
                    &json!({ "ok": true, "message": o.message, "commit": o.commit, "pushed": o.pushed, "committed": o.committed, "drafts": o.skipped_drafts }),
                ),
                Err(e) => Response::json(500, &json!({ "ok": false, "error": e })),
            }
        }
        _ => Response::error(404, "Unknown API route"),
    }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

fn authenticate(state: &AppState, req: &Request) -> Result<auth::Session, Response> {
    let token = req
        .cookie(SESSION_COOKIE)
        .ok_or_else(|| Response::error(401, "Not signed in"))?;
    let session = lock(&state.sessions)
        .get(token)
        .ok_or_else(|| Response::error(401, "Session expired; sign in again"))?;
    // A removed user, or one whose password changed, is signed out immediately.
    let config = site::load_config(&state.root).unwrap_or_default();
    let still_valid = Users::load(&state.root.join(&config.admin.users_file))
        .ok()
        .and_then(|u| u.find(&session.user).map(|r| r.hash == session.credential))
        .unwrap_or(false);
    if still_valid {
        Ok(session)
    } else {
        lock(&state.sessions).remove(token);
        Err(Response::error(401, "Session ended; sign in again"))
    }
}

/// State-changing requests must come from our own pages: the CSRF token proves
/// it, and a browser-supplied Origin must match the Host it connected to.
fn check_csrf(req: &Request, session: &auth::Session) -> Result<(), Response> {
    check_origin(req)?;
    match req.header("x-csrf-token") {
        Some(t) if auth::constant_time_eq(t, &session.csrf) => Ok(()),
        _ => Err(Response::error(403, "Missing or invalid CSRF token")),
    }
}

pub(crate) fn check_origin(req: &Request) -> Result<(), Response> {
    if let Some(origin) = req.header("origin") {
        let host = req.header("host").unwrap_or("");
        let origin_host = origin
            .strip_prefix("https://")
            .or_else(|| origin.strip_prefix("http://"))
            .unwrap_or("");
        if host.is_empty() || origin_host != host {
            return Err(Response::error(403, "Cross-origin request refused"));
        }
    }
    if let Some(site) = req.header("sec-fetch-site") {
        if !matches!(site, "same-origin" | "none") {
            return Err(Response::error(403, "Cross-site request refused"));
        }
    }
    Ok(())
}

fn require_json(req: &Request) -> Result<(), Response> {
    match req.header("content-type") {
        Some(t)
            if t.trim()
                .to_ascii_lowercase()
                .starts_with("application/json") =>
        {
            Ok(())
        }
        _ => Err(Response::error(
            415,
            "Content-Type must be application/json",
        )),
    }
}

fn session_cookie(token: &str, max_age: u64, secure: bool) -> String {
    format!(
        "{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age={max_age}{}",
        if secure { "; Secure" } else { "" }
    )
}

fn login(state: &AppState, req: &Request) -> Response {
    if req.method != "POST" {
        return Response::error(405, "Use POST");
    }
    if let Err(r) = check_origin(req) {
        return r;
    }
    if let Err(r) = require_json(req) {
        return r;
    }
    let config = site::load_config(&state.root).unwrap_or_default();
    let users = match Users::load(&state.root.join(&config.admin.users_file)) {
        Ok(u) => u,
        Err(e) => return Response::error(500, &e),
    };
    if users.users.is_empty() {
        return Response::error(
            503,
            "No users exist yet. Run `openblog user add <name>` on the server.",
        );
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(b) => b,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let username = body["username"].as_str().unwrap_or("").trim().to_string();
    let password = body["password"].as_str().unwrap_or("");
    if password.len() > auth::MAX_PASSWORD_LEN * 4 {
        return Response::error(400, "Password too long");
    }

    // Two limits with different jobs. The client address locks after repeated
    // failures (brute force from one place). The username only slows down
    // (brute force from many places), because a lock on a username would let
    // anyone who knows it shut its owner out.
    let client = client_ip(&config, req);
    let ip_key = format!("ip:{client}");
    let user_key = format!("user:{username}");
    let delay = {
        let mut throttle = lock(&state.throttle);
        if let Err(wait) = throttle.reserve(&ip_key) {
            return Response::error(
                429,
                &format!("Too many failed attempts. Try again in {wait} seconds."),
            )
            .with_header("Retry-After", &wait.to_string());
        }
        throttle.delay(&user_key)
    };
    std::thread::sleep(delay);

    // Always verify against *some* hash so timing does not reveal valid usernames.
    let record = users.find(&username);
    let ok = auth::verify_password(
        record
            .map(|r| r.hash.as_str())
            .unwrap_or_else(|| auth::dummy_hash()),
        password,
    ) && record.is_some();
    if !ok {
        eprintln!(
            "admin: failed login for '{}' from {client}",
            username.chars().take(32).collect::<String>()
        );
        std::thread::sleep(Duration::from_millis(300));
        return Response::error(401, "Invalid username or password");
    }

    {
        let mut throttle = lock(&state.throttle);
        throttle.clear(&ip_key);
        throttle.clear(&user_key);
    }
    let ttl = Duration::from_secs(u64::from(config.admin.session_hours.clamp(1, 24 * 30)) * 3600);
    let credential = record.map(|r| r.hash.clone()).unwrap_or_default();
    let (token, session) = match lock(&state.sessions).create(&username, &credential, ttl) {
        Ok(v) => v,
        Err(e) => return Response::error(500, &e),
    };
    eprintln!("admin: '{username}' signed in from {client}");
    Response::json(
        200,
        &json!({ "user": username, "csrf": session.csrf, "now": clock::now().rfc3339() }),
    )
    .with_header(
        "Set-Cookie",
        &session_cookie(&token, ttl.as_secs(), config.admin.secure_cookies),
    )
}

/// The address login limits apply to. The socket peer, unless that peer is a
/// configured trusted proxy, in which case the last `X-Forwarded-For` entry
/// (the one the trusted proxy itself appended; earlier entries are client-controlled).
pub(crate) fn client_ip(config: &SiteConfig, req: &Request) -> String {
    let trusted = config
        .admin
        .trusted_proxies
        .iter()
        .any(|p| p.trim() == req.peer);
    if trusted {
        if let Some(forwarded) = req.header("x-forwarded-for") {
            if let Some(last) = forwarded
                .rsplit(',')
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let clean: String = last
                    .chars()
                    .filter(|c| c.is_ascii_hexdigit() || matches!(c, '.' | ':'))
                    .take(45)
                    .collect();
                if !clean.is_empty() {
                    return clean;
                }
            }
        }
    }
    req.peer.clone()
}

fn logout(state: &AppState, req: &Request) -> Response {
    if let Some(token) = req.cookie(SESSION_COOKIE) {
        lock(&state.sessions).remove(token);
    }
    let config = site::load_config(&state.root).unwrap_or_default();
    Response::json(200, &json!({ "ok": true })).with_header(
        "Set-Cookie",
        &session_cookie("", 0, config.admin.secure_cookies),
    )
}

// ---------------------------------------------------------------------------
// Content paths
// ---------------------------------------------------------------------------

/// Validate a client-supplied content path like `posts/2026-10-21-hello.md`.
/// Returns the content kind (`posts`, `series`, or `pages`).
fn check_rel_path(rel: &str) -> Result<&'static str, String> {
    if rel.is_empty() || rel.len() > 200 {
        return Err("path is empty or too long".into());
    }
    if !rel.ends_with(".md") {
        return Err("only Markdown (.md) files can be edited".into());
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return Err("path must look like posts/<name>.md".into());
    }
    for part in &parts {
        let ok = !part.is_empty()
            && !part.starts_with('.')
            && part
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.'))
            && !part.contains("..");
        if !ok {
            return Err("path contains characters that are not allowed".into());
        }
    }
    match parts[0] {
        "posts" => Ok("posts"),
        "series" => Ok("series"),
        "pages" => Ok("pages"),
        _ => Err("path must start with posts/, series/, or pages/".into()),
    }
}

/// Resolve a validated relative path inside the content directory, refusing
/// anything that (via symlinks) lands outside it.
fn resolve_content_path(root: &Path, config: &SiteConfig, rel: &str) -> Result<PathBuf, String> {
    check_rel_path(rel)?;
    let content_dir = root.join(&config.paths.content);
    let canonical_content = fs::canonicalize(&content_dir)
        .map_err(|_| "the content directory does not exist".to_string())?;
    let full = content_dir.join(rel);
    let mut probe = full.as_path();
    loop {
        if probe.exists() {
            let canonical = fs::canonicalize(probe).map_err(|e| e.to_string())?;
            if !canonical.starts_with(&canonical_content) {
                return Err("path resolves outside the content directory".into());
            }
            break;
        }
        probe = probe.parent().ok_or("invalid path")?;
    }
    Ok(full)
}

fn etag(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn fields_to_json(fields: &BTreeMap<String, Value>) -> Json {
    let mut map = Map::new();
    for (k, v) in fields {
        map.insert(
            k.clone(),
            match v {
                Value::Scalar(s) => Json::String(s.clone()),
                Value::List(items) => {
                    Json::Array(items.iter().cloned().map(Json::String).collect())
                }
            },
        );
    }
    Json::Object(map)
}

fn fields_from_json(value: &Json) -> Result<BTreeMap<String, Value>, String> {
    let object = value.as_object().ok_or("fields must be an object")?;
    if object.len() > 60 {
        return Err("too many fields".into());
    }
    let mut out = BTreeMap::new();
    for (key, v) in object {
        let valid_key = !key.is_empty()
            && key.len() <= 40
            && key.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !valid_key {
            return Err(format!("field name `{key}` is not allowed"));
        }
        let scalar = |s: &str| -> Result<String, String> {
            if s.len() > 20_000 || s.contains('\0') {
                Err(format!(
                    "field `{key}` is too long or contains invalid characters"
                ))
            } else {
                Ok(s.to_string())
            }
        };
        match v {
            Json::Null => {}
            Json::String(s) => {
                out.insert(key.clone(), Value::Scalar(scalar(s)?));
            }
            Json::Bool(b) => {
                out.insert(key.clone(), Value::Scalar(b.to_string()));
            }
            Json::Number(n) => {
                out.insert(key.clone(), Value::Scalar(n.to_string()));
            }
            Json::Array(items) => {
                if items.len() > 100 {
                    return Err(format!("field `{key}` has too many items"));
                }
                let mut list = Vec::new();
                for item in items {
                    let s = item
                        .as_str()
                        .ok_or_else(|| format!("field `{key}` must be a list of text"))?;
                    if s.chars().count() > 200 {
                        return Err(format!("an item in `{key}` is too long"));
                    }
                    list.push(scalar(s)?);
                }
                out.insert(key.clone(), Value::List(list));
            }
            Json::Object(_) => return Err(format!("field `{key}` cannot be an object")),
        }
    }
    Ok(out)
}

fn meta(state: &AppState) -> Response {
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };
    let themes = site::load_themes(&state.root, &config).unwrap_or_default();
    let theme_list: Vec<Json> = themes
        .names()
        .into_iter()
        .filter_map(|n| {
            themes
                .resolve(&n)
                .ok()
                .map(|t| json!({ "name": n, "label": t.label }))
        })
        .collect();
    let sources = site::read_sources(&state.root, &config).unwrap_or_default();
    let mut series: Vec<Json> = Vec::new();
    for file in &sources.series {
        if let Ok(doc) = frontmatter::parse(&file.contents) {
            let stem = file
                .path
                .rsplit('/')
                .next()
                .unwrap_or("")
                .trim_end_matches(".md");
            let slug = doc
                .front_matter
                .get("slug")
                .map(slugify)
                .unwrap_or_else(|| slugify(stem));
            let name = doc
                .front_matter
                .get("name")
                .or_else(|| doc.front_matter.get("title"))
                .unwrap_or(&slug)
                .to_string();
            series.push(json!({ "slug": slug, "name": name }));
        }
    }
    let mut tags: Vec<String> = Vec::new();
    for file in &sources.posts {
        if let Ok(doc) = frontmatter::parse(&file.contents) {
            for t in doc.front_matter.get_list("tags") {
                if !tags.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
                    tags.push(t);
                }
            }
        }
    }
    tags.sort_by_key(|t| t.to_lowercase());
    Response::json(
        200,
        &json!({
            "siteTitle": config.title,
            "siteUrl": config.url,
            "postPath": config.post_path,
            "defaultTheme": config.theme,
            "themes": theme_list,
            "series": series,
            "tags": tags,
            "maxUploadMb": config.admin.max_upload_mb,
            "now": clock::now().rfc3339(),
        }),
    )
}

fn status(state: &AppState) -> Response {
    let s = lock(&state.build);
    Response::json(
        200,
        &json!({
            "now": clock::now().rfc3339(),
            "lastBuilt": s.last_built.map(|d| d.rfc3339()),
            "lastError": s.last_error,
            "nextDue": s.next_due.map(|d| d.rfc3339()),
            "scheduled": s.scheduled.iter().map(|(t, slug, d)| json!({ "title": t, "slug": slug, "date": d })).collect::<Vec<_>>(),
        }),
    )
}

fn list_documents(state: &AppState, req: &Request) -> Response {
    let kind = req.query.get("kind").map(String::as_str).unwrap_or("posts");
    if !matches!(kind, "posts" | "series" | "pages") {
        return Response::error(400, "kind must be posts, series, or pages");
    }
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };
    let sources = match site::read_sources(&state.root, &config) {
        Ok(s) => s,
        Err(e) => return Response::error(500, &e),
    };
    let files = match kind {
        "posts" => &sources.posts,
        "series" => &sources.series,
        _ => &sources.pages,
    };
    let now = clock::now();
    let mut items: Vec<(i64, Json)> = Vec::new();
    for file in files {
        let item = match kind {
            "posts" => {
                match openblog_core::model::load_post(file, &config, RenderOptions::default()) {
                    Ok(p) => {
                        let status = if p.draft {
                            "draft"
                        } else if p.date > now {
                            "scheduled"
                        } else {
                            "published"
                        };
                        (
                            p.date.unix(),
                            json!({
                                "path": file.path, "title": p.title, "slug": p.slug, "date": p.date.rfc3339(),
                                "status": status, "series": p.series, "tags": p.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
                                "url": p.url, "words": p.word_count,
                            }),
                        )
                    }
                    Err(e) => (
                        i64::MIN,
                        json!({ "path": file.path, "title": file.path, "status": "error", "error": e }),
                    ),
                }
            }
            _ => match frontmatter::parse(&file.contents) {
                Ok(doc) => {
                    let stem = file
                        .path
                        .rsplit('/')
                        .next()
                        .unwrap_or("")
                        .trim_end_matches(".md");
                    let title = doc
                        .front_matter
                        .get("name")
                        .or_else(|| doc.front_matter.get("title"))
                        .unwrap_or(stem)
                        .to_string();
                    (
                        0,
                        json!({ "path": file.path, "title": title, "slug": slugify(stem), "status": "published" }),
                    )
                }
                Err(e) => (
                    i64::MIN,
                    json!({ "path": file.path, "title": file.path, "status": "error", "error": e }),
                ),
            },
        };
        items.push(item);
    }
    items.sort_by_key(|item| std::cmp::Reverse(item.0));
    Response::json(
        200,
        &json!({ "kind": kind, "items": items.into_iter().map(|(_, j)| j).collect::<Vec<_>>() }),
    )
}

fn get_document(state: &AppState, req: &Request) -> Response {
    let Some(rel) = req.query.get("path") else {
        return Response::error(400, "Missing ?path=");
    };
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };
    let path = match resolve_content_path(&state.root, &config, rel) {
        Ok(p) => p,
        Err(e) => return Response::error(400, &e),
    };
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return Response::error(404, "No such document"),
    };
    let kind = check_rel_path(rel).unwrap_or("posts");
    match frontmatter::parse(&text) {
        Ok(doc) => Response::json(
            200,
            &json!({ "path": rel, "kind": kind, "etag": etag(&text), "fields": fields_to_json(&doc.front_matter.fields), "body": doc.body }),
        ),
        Err(e) => Response::json(
            200,
            &json!({ "path": rel, "kind": kind, "etag": etag(&text), "raw": text, "error": e }),
        ),
    }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Check that the site still loads and renders with `rel` set to `source`.
/// Only problems that involve the edited file are reported; unrelated broken
/// files are surfaced by the rebuild instead of blocking every save.
fn validate_candidate(
    root: &Path,
    config: &SiteConfig,
    rel: &str,
    source: &str,
) -> Result<(), Vec<String>> {
    let mut sources = site::read_sources(root, config).map_err(|e| vec![e])?;
    for bucket in [&mut sources.posts, &mut sources.series, &mut sources.pages] {
        bucket.retain(|f| f.path != rel);
    }
    sources.add(SourceFile {
        path: rel.to_string(),
        contents: source.to_string(),
    });
    let themes = site::load_themes(root, config).map_err(|e| vec![e])?;
    match Site::load(
        config.clone(),
        sources,
        LoadOptions {
            include_drafts: true,
            now: None,
        },
    ) {
        Ok(site) => generate(&site, &themes).map(|_| ()).map_err(|e| vec![e]),
        Err(errors) => {
            let mine: Vec<String> = errors.into_iter().filter(|e| e.contains(rel)).collect();
            if mine.is_empty() {
                Ok(())
            } else {
                Err(mine)
            }
        }
    }
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("cannot replace {}: {e}", path.display())
    })
}

/// New file path for a created document, derived from its fields.
fn derive_new_path(kind: &str, fields: &BTreeMap<String, Value>) -> Result<String, String> {
    let get = |k: &str| match fields.get(k) {
        Some(Value::Scalar(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    };
    let slug = get("slug")
        .map(|s| slugify(&s))
        .or_else(|| get("title").or_else(|| get("name")).map(|t| slugify(&t)))
        .unwrap_or_default();
    let slug = openblog_core::slug::limit(&slug, 80);
    if slug.is_empty() {
        return Err("a title (or slug) is needed to name the file".into());
    }
    match kind {
        "posts" => {
            let date = get("date")
                .and_then(|d| DateTime::parse(&d))
                .unwrap_or_else(clock::now);
            Ok(format!("posts/{}-{slug}.md", date.ymd()))
        }
        "series" => Ok(format!("series/{slug}.md")),
        "pages" => Ok(format!("pages/{slug}.md")),
        _ => Err("kind must be posts, series, or pages".into()),
    }
}

fn save_document(state: &AppState, req: &Request, existing_path: Option<String>) -> Response {
    if let Err(r) = require_json(req) {
        return r;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(b) => b,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let fields = match fields_from_json(&body["fields"]) {
        Ok(f) => f,
        Err(e) => return Response::error(422, &e),
    };
    let text_body = body["body"].as_str().unwrap_or("");
    if text_body.len() > MAX_DOCUMENT_BYTES || text_body.contains('\0') {
        return Response::error(413, "The post body is too large");
    }
    let source = frontmatter::compose(&fields, text_body);

    let mut status = lock(&state.build);
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };

    let (rel, created) = match existing_path {
        Some(rel) => (rel, false),
        None => {
            let kind = body["kind"].as_str().unwrap_or("posts");
            match derive_new_path(kind, &fields) {
                Ok(rel) => (rel, true),
                Err(e) => return Response::error(422, &e),
            }
        }
    };
    let path = match resolve_content_path(&state.root, &config, &rel) {
        Ok(p) => p,
        Err(e) => return Response::error(400, &e),
    };

    if created {
        if path.exists() {
            return Response::error(
                409,
                "A file with that name already exists. Change the title, slug, or date.",
            );
        }
    } else {
        let current = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => return Response::error(404, "No such document"),
        };
        match body["etag"].as_str() {
            Some(sent) if sent == etag(&current) => {}
            _ => {
                return Response::error(
                    409,
                    "This file changed on disk since you opened it. Reload it before saving.",
                )
            }
        }
    }

    if let Err(problems) = validate_candidate(&state.root, &config, &rel, &source) {
        return Response::json(
            422,
            &json!({ "error": "This can't be saved yet.", "problems": problems }),
        );
    }
    if let Err(e) = write_atomic(&path, &source) {
        return Response::error(500, &e);
    }

    let now = clock::now();
    let build = state.rebuild_locked(&mut status);
    let build_json = match &build {
        Ok(r) => {
            json!({ "ok": true, "posts": r.posts, "scheduled": r.scheduled, "nextDue": r.next_due.map(|d| d.rfc3339()) })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    };
    let (post_status, url) = describe(&rel, &source, &config, now);
    eprintln!("admin: {} {rel}", if created { "created" } else { "saved" });
    let title = fields
        .get("title")
        .or_else(|| fields.get("name"))
        .and_then(|v| match v {
            Value::Scalar(s) => Some(s.clone()),
            _ => None,
        })
        .unwrap_or_else(|| rel.clone());
    state_arc(state).auto_publish(title);
    Response::json(
        if created { 201 } else { 200 },
        &json!({ "path": rel, "etag": etag(&source), "status": post_status, "url": url, "build": build_json }),
    )
}

/// Publication status and public URL of a just-saved document.
fn describe(
    rel: &str,
    source: &str,
    config: &SiteConfig,
    now: DateTime,
) -> (&'static str, Option<String>) {
    if !rel.starts_with("posts/") {
        return ("published", None);
    }
    let file = SourceFile {
        path: rel.to_string(),
        contents: source.to_string(),
    };
    match openblog_core::model::load_post(&file, config, RenderOptions::default()) {
        Ok(p) if p.draft => ("draft", None),
        Ok(p) if p.date > now => ("scheduled", Some(p.url)),
        Ok(p) => ("published", Some(p.url)),
        Err(_) => ("error", None),
    }
}

fn delete_document(state: &AppState, req: &Request) -> Response {
    let Some(rel) = req.query.get("path") else {
        return Response::error(400, "Missing ?path=");
    };
    let mut status = lock(&state.build);
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };
    let path = match resolve_content_path(&state.root, &config, rel) {
        Ok(p) => p,
        Err(e) => return Response::error(400, &e),
    };
    if !path.is_file() {
        return Response::error(404, "No such document");
    }
    // Never destroy content: move it to a trash folder that can be restored from.
    let trash = state.root.join(".openblog").join("trash");
    if let Err(e) = fs::create_dir_all(&trash) {
        return Response::error(500, &format!("cannot create the trash folder: {e}"));
    }
    let stamp = clock::now().rfc3339().replace(':', "");
    let name = rel.replace('/', "_");
    let mut target = trash.join(format!("{stamp}-{name}"));
    let mut n = 1;
    while target.exists() {
        target = trash.join(format!("{stamp}-{n}-{name}"));
        n += 1;
    }
    if let Err(e) = fs::rename(&path, &target) {
        return Response::error(500, &format!("cannot move the file to the trash: {e}"));
    }
    eprintln!("admin: deleted {rel} (kept in .openblog/trash)");
    let build = state.rebuild_locked(&mut status);
    let build_json = match &build {
        Ok(r) => json!({ "ok": true, "posts": r.posts }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    Response::json(
        200,
        &json!({ "ok": true, "trashedTo": target.file_name().map(|n| n.to_string_lossy().into_owned()), "build": build_json }),
    )
}

fn rebuild(state: &AppState) -> Response {
    match state.rebuild() {
        Ok(r) => Response::json(
            200,
            &json!({ "ok": true, "posts": r.posts, "scheduled": r.scheduled, "files": r.files }),
        ),
        Err(e) => Response::json(500, &json!({ "ok": false, "error": e })),
    }
}

fn preview(req: &Request) -> Response {
    if let Err(r) = require_json(req) {
        return r;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(b) => b,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let text = body["body"].as_str().unwrap_or("");
    if text.len() > MAX_DOCUMENT_BYTES {
        return Response::error(413, "The post body is too large");
    }
    let rendered = markdown::render(text, RenderOptions::default());
    Response::json(
        200,
        &json!({ "html": rendered.html, "words": rendered.word_count, "minutes": markdown::reading_minutes(rendered.word_count) }),
    )
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/// The image type, judged by the file's own bytes (never the client's claim).
fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() > 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
    {
        Some("avif")
    } else {
        None
    }
}

fn sanitize_upload_stem(name: &str) -> String {
    let stem = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = stem.rsplit_once('.').map(|(s, _)| s).unwrap_or(stem);
    let cleaned: String = stem
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let cleaned = cleaned
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let cleaned = openblog_core::slug::limit(&cleaned, 60);
    if cleaned.is_empty() {
        "image".to_string()
    } else {
        cleaned
    }
}

fn upload(state: &AppState, req: &Request) -> Response {
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };
    let max = config.admin.max_upload_mb as usize * 1024 * 1024;
    if req.body.is_empty() {
        return Response::error(400, "No image data");
    }
    if req.body.len() > max {
        return Response::error(
            413,
            &format!("Images can be at most {} MB", config.admin.max_upload_mb),
        );
    }
    let Some(ext) = sniff_image(&req.body) else {
        return Response::error(
            415,
            "Only PNG, JPEG, GIF, WebP, and AVIF images can be uploaded",
        );
    };
    let name = req.query.get("name").map(String::as_str).unwrap_or("image");
    let stem = sanitize_upload_stem(name);
    let year = clock::now().civil().year;
    let dir_rel = format!("images/uploads/{year}");
    let static_dir = state.root.join(&config.paths.static_dir);

    let _guard = lock(&state.build);
    let mut file_name = format!("{stem}.{ext}");
    let mut n = 2;
    while static_dir.join(&dir_rel).join(&file_name).exists() {
        file_name = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    let rel = format!("{dir_rel}/{file_name}");
    if let Err(e) = fsutil::write_file(&static_dir.join(&rel), &req.body) {
        return Response::error(500, &e);
    }
    // Make it available immediately without a full rebuild.
    let out = state.out_dir(&config);
    if out.join(fsutil::MARKER).exists() {
        let _ = fsutil::write_file(&out.join(&rel), &req.body);
    }
    let url = format!("/{rel}");
    eprintln!("admin: uploaded {url} ({} bytes)", req.body.len());
    Response::json(
        201,
        &json!({ "url": url, "markdown": format!("![]({url})") }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scaffold;
    use std::collections::HashMap;

    struct Fixture {
        state: AppState,
        dir: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn fixture(tag: &str) -> Fixture {
        let dir = std::env::temp_dir().join(format!("ob-admin-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        scaffold::init(&dir, Some("Test Blog"), false).unwrap();
        let mut users = Users::default();
        users.set("mikey", "correct horse battery").unwrap();
        users.save(&dir.join(".openblog/users.json")).unwrap();
        let state = AppState::new(dir.clone(), None, false, true);
        state.rebuild().unwrap();
        Fixture { state, dir }
    }

    fn req(method: &str, path: &str) -> Request {
        let (p, q) = path.split_once('?').unwrap_or((path, ""));
        let query: HashMap<String, String> = q
            .split('&')
            .filter(|x| !x.is_empty())
            .map(|kv| {
                let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
                (k.to_string(), crate::http::percent_decode(v))
            })
            .collect();
        let mut r = Request {
            method: method.into(),
            path: p.into(),
            query,
            peer: "10.0.0.1".into(),
            ..Default::default()
        };
        r.headers.insert("host".into(), "localhost:8080".into());
        r
    }

    fn json_req(method: &str, path: &str, body: Json) -> Request {
        let mut r = req(method, path);
        r.headers
            .insert("content-type".into(), "application/json".into());
        r.body = body.to_string().into_bytes();
        r
    }

    fn body_json(resp: &Response) -> Json {
        serde_json::from_slice(&resp.body).unwrap_or(Json::Null)
    }

    /// Sign in and return (cookie header value, csrf token).
    fn login_ok(f: &Fixture) -> (String, String) {
        let resp = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "mikey", "password": "correct horse battery" }),
            ),
        );
        assert_eq!(resp.status, 200, "{}", String::from_utf8_lossy(&resp.body));
        let cookie = resp
            .headers
            .iter()
            .find(|(k, _)| k == "Set-Cookie")
            .unwrap()
            .1
            .clone();
        assert!(
            cookie.contains("HttpOnly")
                && cookie.contains("SameSite=Strict")
                && cookie.contains("Path=/admin")
        );
        let token = cookie.split(';').next().unwrap().to_string();
        (
            token,
            body_json(&resp)["csrf"].as_str().unwrap().to_string(),
        )
    }

    fn authed(mut r: Request, session: &(String, String), with_csrf: bool) -> Request {
        r.headers.insert("cookie".into(), session.0.clone());
        if with_csrf {
            r.headers.insert("x-csrf-token".into(), session.1.clone());
        }
        r
    }

    #[test]
    fn requires_login_and_rejects_bad_credentials() {
        let f = fixture("login");
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/documents")).status,
            401
        );
        assert_eq!(
            preflight(&f.state, &req("POST", "/admin/api/document"))
                .unwrap_err()
                .status,
            401
        );
        let bad = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "mikey", "password": "wrong wrong wrong" }),
            ),
        );
        assert_eq!(bad.status, 401);
        let ghost = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "nobody", "password": "correct horse battery" }),
            ),
        );
        assert_eq!(ghost.status, 401);
        assert_eq!(
            body_json(&bad)["error"],
            body_json(&ghost)["error"],
            "must not reveal which usernames exist"
        );
        // JSON content type is required, and a foreign Origin is refused.
        let mut no_json = req("POST", "/admin/api/login");
        no_json.body = b"{}".to_vec();
        assert_eq!(handle(&f.state, &no_json).status, 415);
        let mut foreign = json_req(
            "POST",
            "/admin/api/login",
            json!({ "username": "mikey", "password": "correct horse battery" }),
        );
        foreign
            .headers
            .insert("origin".into(), "https://evil.example".into());
        assert_eq!(handle(&f.state, &foreign).status, 403);
        let session = login_ok(&f);
        assert_eq!(
            handle(
                &f.state,
                &authed(req("GET", "/admin/api/session"), &session, false)
            )
            .status,
            200
        );
    }

    #[test]
    fn locks_out_an_address_after_repeated_failures_but_never_the_user() {
        let f = fixture("throttle");
        for _ in 0..auth::MAX_FAILURES {
            let r = json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "mikey", "password": "wrong wrong wrong" }),
            );
            assert_eq!(handle(&f.state, &r).status, 401);
        }
        let r = json_req(
            "POST",
            "/admin/api/login",
            json!({ "username": "mikey", "password": "correct horse battery" }),
        );
        let resp = handle(&f.state, &r);
        assert_eq!(
            resp.status, 429,
            "the attacking address is locked, even with the right password"
        );
        assert!(resp.headers.iter().any(|(k, _)| k == "Retry-After"));
        // The real author, from a different address, still gets in (slower, but in).
        let mut other = json_req(
            "POST",
            "/admin/api/login",
            json!({ "username": "mikey", "password": "correct horse battery" }),
        );
        other.peer = "10.0.0.2".into();
        assert_eq!(
            handle(&f.state, &other).status,
            200,
            "a username is never locked out by someone else's failures"
        );
    }

    #[test]
    fn behind_a_trusted_proxy_limits_apply_to_the_forwarded_client() {
        let f = fixture("proxy");
        let cfg_path = f.dir.join("openblog.json");
        let mut cfg: Json = serde_json::from_str(&fs::read_to_string(&cfg_path).unwrap()).unwrap();
        cfg["admin"]["trustedProxies"] = json!(["10.0.0.1"]);
        fs::write(&cfg_path, cfg.to_string()).unwrap();
        let attempt = |xff: &str, password: &str| {
            let mut r = json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "mikey", "password": password }),
            );
            r.headers.insert("x-forwarded-for".into(), xff.into());
            handle(&f.state, &r).status
        };
        for _ in 0..auth::MAX_FAILURES {
            assert_eq!(attempt("203.0.113.9", "wrong wrong wrong"), 401);
        }
        assert_eq!(
            attempt("203.0.113.9", "correct horse battery"),
            429,
            "the forwarded attacker is locked"
        );
        assert_eq!(
            attempt("198.51.100.7", "correct horse battery"),
            200,
            "another client behind the same proxy is not"
        );
        // Spoofed earlier entries do not matter: only the last one, added by the proxy, counts.
        for _ in 0..auth::MAX_FAILURES {
            assert_eq!(attempt("1.1.1.1, 203.0.113.10", "wrong wrong wrong"), 401);
        }
        assert_eq!(
            attempt("2.2.2.2, 203.0.113.10", "correct horse battery"),
            429
        );
        // An untrusted peer's X-Forwarded-For is ignored entirely.
        let mut r = json_req(
            "POST",
            "/admin/api/login",
            json!({ "username": "mikey", "password": "correct horse battery" }),
        );
        r.peer = "10.0.0.99".into();
        r.headers
            .insert("x-forwarded-for".into(), "203.0.113.9".into());
        assert_eq!(handle(&f.state, &r).status, 200);
    }

    #[test]
    fn state_changes_need_csrf_and_same_origin() {
        let f = fixture("csrf");
        let session = login_ok(&f);
        let body = json!({ "kind": "posts", "fields": { "title": "Hi", "date": "2020-01-01" }, "body": "x" });
        assert_eq!(
            handle(
                &f.state,
                &authed(
                    json_req("POST", "/admin/api/document", body.clone()),
                    &session,
                    false
                )
            )
            .status,
            403
        );
        let mut wrong = authed(
            json_req("POST", "/admin/api/document", body.clone()),
            &session,
            true,
        );
        wrong.headers.insert("x-csrf-token".into(), "0".repeat(64));
        assert_eq!(handle(&f.state, &wrong).status, 403);
        let mut cross = authed(
            json_req("POST", "/admin/api/document", body.clone()),
            &session,
            true,
        );
        cross
            .headers
            .insert("origin".into(), "http://evil.example".into());
        assert_eq!(handle(&f.state, &cross).status, 403);
        let mut site = authed(
            json_req("POST", "/admin/api/document", body.clone()),
            &session,
            true,
        );
        site.headers
            .insert("sec-fetch-site".into(), "cross-site".into());
        assert_eq!(handle(&f.state, &site).status, 403);
        let mut same = authed(
            json_req("POST", "/admin/api/document", body),
            &session,
            true,
        );
        same.headers
            .insert("origin".into(), "http://localhost:8080".into());
        assert_eq!(handle(&f.state, &same).status, 201);
    }

    #[test]
    fn create_edit_schedule_publish_and_delete() {
        let f = fixture("flow");
        let session = login_ok(&f);
        let dist = f.dir.join("dist");

        // Publish immediately.
        let create = json!({ "kind": "posts", "fields": { "title": "Live Now", "date": "2020-01-01T00:00:00Z", "tags": ["rust"] }, "body": "# Hi\n\nHello **world**" });
        let resp = handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/document", create),
                &session,
                true,
            ),
        );
        assert_eq!(resp.status, 201, "{}", String::from_utf8_lossy(&resp.body));
        let created = body_json(&resp);
        assert_eq!(created["status"], "published");
        assert_eq!(created["path"], "posts/2020-01-01-live-now.md");
        assert!(dist.join("posts/live-now/index.html").exists());
        assert!(fs::read_to_string(dist.join("rss.xml"))
            .unwrap()
            .contains("Live Now"));

        // Schedule one a couple of seconds ahead: not public, listed as scheduled.
        let when = DateTime::from_unix(clock::now().unix() + 2).rfc3339();
        let sched = json!({ "kind": "posts", "fields": { "title": "Coming Soon", "date": when }, "body": "later" });
        let resp = handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/document", sched),
                &session,
                true,
            ),
        );
        assert_eq!(resp.status, 201, "{}", String::from_utf8_lossy(&resp.body));
        assert_eq!(body_json(&resp)["status"], "scheduled");
        assert!(!dist.join("posts/coming-soon/index.html").exists());
        assert!(!fs::read_to_string(dist.join("sitemap.xml"))
            .unwrap()
            .contains("coming-soon"));
        let status = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/status"), &session, false),
        ));
        assert_eq!(status["scheduled"][0]["slug"], "coming-soon");
        let list = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/documents"), &session, false),
        ));
        let statuses: Vec<String> = list["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["status"].as_str().unwrap().to_string())
            .collect();
        assert!(
            statuses.contains(&"scheduled".to_string())
                && statuses.contains(&"published".to_string())
        );

        // Not yet due.
        assert!(f.state.tick_scheduler().is_none());
        std::thread::sleep(Duration::from_millis(3200));
        let report = f
            .state
            .tick_scheduler()
            .expect("the scheduler rebuilds when a post is due")
            .unwrap();
        assert_eq!(report.scheduled, 0);
        assert!(dist.join("posts/coming-soon/index.html").exists());
        assert!(
            f.state.tick_scheduler().is_none(),
            "nothing left to publish"
        );

        // Edit with the right etag, then a stale one.
        let doc = body_json(&handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    "/admin/api/document?path=posts/2020-01-01-live-now.md",
                ),
                &session,
                false,
            ),
        ));
        assert_eq!(doc["fields"]["title"], "Live Now");
        let mut fields = doc["fields"].clone();
        fields["title"] = json!("Live Now, Edited");
        let put = |etag: &str| {
            handle(
                &f.state,
                &authed(
                    json_req(
                        "PUT",
                        "/admin/api/document?path=posts/2020-01-01-live-now.md",
                        json!({ "fields": fields, "body": "edited body", "etag": etag }),
                    ),
                    &session,
                    true,
                ),
            )
        };
        assert_eq!(put("deadbeefdeadbeef").status, 409);
        let ok = put(doc["etag"].as_str().unwrap());
        assert_eq!(ok.status, 200, "{}", String::from_utf8_lossy(&ok.body));
        assert!(fs::read_to_string(dist.join("posts/live-now/index.html"))
            .unwrap()
            .contains("Live Now, Edited"));

        // Draft via the draft flag.
        let draft = json!({ "kind": "posts", "fields": { "title": "Secret", "draft": "true" }, "body": "wip" });
        let resp = handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/document", draft),
                &session,
                true,
            ),
        );
        assert_eq!(resp.status, 201, "{}", String::from_utf8_lossy(&resp.body));
        assert_eq!(body_json(&resp)["status"], "draft");
        assert!(!dist.join("posts/secret/index.html").exists());

        // Deleting moves to trash and removes the page.
        let del = handle(
            &f.state,
            &authed(
                req(
                    "DELETE",
                    "/admin/api/document?path=posts/2020-01-01-live-now.md",
                ),
                &session,
                true,
            ),
        );
        assert_eq!(del.status, 200);
        assert!(!f.dir.join("content/posts/2020-01-01-live-now.md").exists());
        assert!(!dist.join("posts/live-now/index.html").exists());
        assert_eq!(
            fs::read_dir(f.dir.join(".openblog/trash")).unwrap().count(),
            1
        );
    }

    #[test]
    fn invalid_saves_are_rejected_without_touching_disk() {
        let f = fixture("invalid");
        let session = login_ok(&f);
        let post = |fields: Json| {
            handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/document",
                        json!({ "kind": "posts", "fields": fields, "body": "x" }),
                    ),
                    &session,
                    true,
                ),
            )
        };
        // Duplicate slug with the scaffolded post.
        let dup = post(json!({ "title": "Another", "slug": "hello-world", "date": "2020-02-02" }));
        assert_eq!(dup.status, 422, "{}", String::from_utf8_lossy(&dup.body));
        assert!(body_json(&dup)["problems"][0]
            .as_str()
            .unwrap()
            .contains("duplicate"));
        // Unknown theme.
        assert_eq!(
            post(json!({ "title": "Themed", "date": "2020-02-02", "theme": "nope" })).status,
            422
        );
        // Bad date, missing title.
        assert_eq!(
            post(json!({ "title": "Dated", "date": "someday" })).status,
            422
        );
        assert_eq!(post(json!({ "date": "2020-02-02" })).status, 422);
        // Illegal field names and types.
        assert_eq!(post(json!({ "title": "X", "bad key": "v" })).status, 422);
        assert_eq!(
            post(json!({ "title": "X", "nested": { "a": 1 } })).status,
            422
        );
        assert_eq!(
            fs::read_dir(f.dir.join("content/posts")).unwrap().count(),
            1,
            "nothing was written"
        );
    }

    #[test]
    fn paths_cannot_escape_the_content_directory() {
        let f = fixture("paths");
        let session = login_ok(&f);
        for bad in [
            "../openblog.json",
            "posts/../../openblog.json",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "posts/..\\..\\openblog.json",
            "posts/.hidden.md",
            "posts/a.txt",
            "posts/sub/deeper/x/y.md",
            "other/a.md",
            "posts/",
            "posts/%2e%2e/x.md",
        ] {
            let url = format!("/admin/api/document?path={}", bad.replace('\\', "%5C"));
            let get = handle(&f.state, &authed(req("GET", &url), &session, false));
            assert_eq!(get.status, 400, "GET {bad:?} should be refused");
            let del = handle(&f.state, &authed(req("DELETE", &url), &session, true));
            assert_eq!(del.status, 400, "DELETE {bad:?} should be refused");
        }
        assert!(f.dir.join("openblog.json").exists());
        // The built-in static server must not serve the admin when it is off.
        let off = AppState::new(f.dir.clone(), None, false, false);
        assert_eq!(handle(&off, &req("GET", "/admin")).status, 404);
        assert_eq!(
            preflight(&off, &req("GET", "/admin/api/session"))
                .unwrap_err()
                .status,
            404
        );
    }

    #[test]
    fn newlines_in_fields_cannot_inject_front_matter() {
        let f = fixture("inject");
        let session = login_ok(&f);
        let body = json!({ "kind": "posts", "fields": { "title": "Safe", "date": "2020-01-01", "description": "a\ndraft: true\nslug: hijack" }, "body": "x" });
        let resp = handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/document", body),
                &session,
                true,
            ),
        );
        assert_eq!(resp.status, 201, "{}", String::from_utf8_lossy(&resp.body));
        assert_eq!(body_json(&resp)["status"], "published");
        assert!(f.dir.join("dist/posts/safe/index.html").exists());
        assert!(!f.dir.join("dist/posts/hijack/index.html").exists());
    }

    #[test]
    fn uploads_check_the_bytes_not_the_name() {
        let f = fixture("upload");
        let session = login_ok(&f);
        let send = |name: &str, bytes: &[u8]| {
            let mut r = authed(
                req("POST", &format!("/admin/api/upload?name={name}")),
                &session,
                true,
            );
            r.body = bytes.to_vec();
            handle(&f.state, &r)
        };
        let png: Vec<u8> = [
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A][..],
            &[0u8; 32],
        ]
        .concat();
        assert_eq!(
            send("evil.png", b"<script>alert(1)</script>").status,
            415,
            "html disguised as png"
        );
        assert_eq!(
            send("a.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>").status,
            415,
            "svg can carry scripts"
        );
        assert_eq!(send("x.png", b"").status, 400);
        let ok = send("../../My Photo!!.PNG", &png);
        assert_eq!(ok.status, 201, "{}", String::from_utf8_lossy(&ok.body));
        let url = body_json(&ok)["url"].as_str().unwrap().to_string();
        assert!(
            url.starts_with("/images/uploads/") && url.ends_with("/my-photo.png"),
            "{url}"
        );
        assert!(f
            .dir
            .join("static")
            .join(url.trim_start_matches('/'))
            .exists());
        assert!(f
            .dir
            .join("dist")
            .join(url.trim_start_matches('/'))
            .exists());
        let again = send("My Photo.png", &png);
        assert!(
            body_json(&again)["url"]
                .as_str()
                .unwrap()
                .ends_with("/my-photo-2.png"),
            "existing files are never overwritten"
        );
        let mut big = authed(req("POST", "/admin/api/upload?name=x.png"), &session, true);
        big.body = vec![0u8; 11 * 1024 * 1024];
        assert_eq!(handle(&f.state, &big).status, 413);
    }

    #[test]
    fn logout_ends_the_session_and_preview_renders() {
        let f = fixture("logout");
        let session = login_ok(&f);
        let prev = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({ "body": "## Hi\n\ntext" }),
                ),
                &session,
                true,
            ),
        );
        assert!(body_json(&prev)["html"].as_str().unwrap().contains("<h2"));
        assert_eq!(
            handle(
                &f.state,
                &authed(
                    json_req("POST", "/admin/api/logout", json!({})),
                    &session,
                    true
                )
            )
            .status,
            200
        );
        assert_eq!(
            handle(
                &f.state,
                &authed(req("GET", "/admin/api/session"), &session, false)
            )
            .status,
            401
        );
    }

    #[test]
    fn changing_a_password_or_removing_a_user_ends_their_sessions() {
        let f = fixture("revoke");
        let users_path = f.dir.join(".openblog/users.json");
        let session = login_ok(&f);
        assert_eq!(
            handle(
                &f.state,
                &authed(req("GET", "/admin/api/session"), &session, false)
            )
            .status,
            200
        );
        let mut users = Users::load(&users_path).unwrap();
        users.set("mikey", "a brand new passphrase").unwrap();
        users.save(&users_path).unwrap();
        assert_eq!(
            handle(
                &f.state,
                &authed(req("GET", "/admin/api/session"), &session, false)
            )
            .status,
            401,
            "old session dies on password change"
        );

        let again = (String::new(), String::new());
        let resp = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "mikey", "password": "a brand new passphrase" }),
            ),
        );
        assert_eq!(resp.status, 200);
        let cookie = resp
            .headers
            .iter()
            .find(|(k, _)| k == "Set-Cookie")
            .unwrap()
            .1
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let fresh = (
            cookie,
            body_json(&resp)["csrf"].as_str().unwrap().to_string(),
        );
        let _ = again;
        assert_eq!(
            handle(
                &f.state,
                &authed(req("GET", "/admin/api/session"), &fresh, false)
            )
            .status,
            200
        );
        users.remove("mikey");
        users.save(&users_path).unwrap();
        assert_eq!(
            handle(
                &f.state,
                &authed(req("GET", "/admin/api/session"), &fresh, false)
            )
            .status,
            401,
            "removed user is signed out"
        );
    }

    #[test]
    fn view_counter_endpoints_and_dashboard() {
        let f = fixture("analytics");
        let dist = f.dir.join("dist");
        let hit = |path: &str, headers: &[(&str, &str)]| {
            let mut r = json_req(
                "POST",
                "/api/hit",
                json!({ "path": path, "referrer": "https://news.ycombinator.com/item?id=1" }),
            );
            for (k, v) in headers {
                r.headers.insert(k.to_string(), v.to_string());
            }
            crate::serve::route(&f.state, &r, &dist)
        };
        assert_eq!(
            preflight(&f.state, &req("POST", "/api/hit")).unwrap(),
            2048,
            "hits may carry a small body without a session"
        );
        assert_eq!(preflight(&f.state, &req("GET", "/api/hit")).unwrap(), 0);
        let first = hit("/posts/hello-world/", &[("user-agent", "Mozilla")]);
        assert_eq!(
            first.status,
            200,
            "{}",
            String::from_utf8_lossy(&first.body)
        );
        assert_eq!(body_json(&first)["views"], 1);
        assert_eq!(
            body_json(&hit("/posts/hello-world", &[("user-agent", "Mozilla")]))["views"],
            2,
            "path is normalised"
        );
        assert_eq!(hit("/nope/", &[]).status, 404);
        assert_eq!(hit("/rss.xml", &[]).status, 404);
        for alias in [
            "/posts//hello-world/",
            "/./posts/hello-world/",
            "/Posts/Hello-World/",
            "/posts/hello-world/index.html",
            "/posts/hello-world/./",
        ] {
            assert_eq!(
                hit(alias, &[]).status,
                404,
                "{alias} must not become a second key for the same page"
            );
        }
        let dnt = hit("/posts/hello-world/", &[("dnt", "1")]);
        assert_eq!(dnt.status, 200, "Do Not Track still gets the count");
        assert_eq!(body_json(&dnt)["counted"], false);
        assert_eq!(hit("/posts/hello-world/", &[("sec-gpc", "1")]).status, 200);
        // Cross-site requests cannot forge hits.
        let mut cross = json_req("POST", "/api/hit", json!({ "path": "/posts/hello-world/" }));
        cross
            .headers
            .insert("origin".into(), "https://evil.example".into());
        assert_eq!(crate::serve::route(&f.state, &cross, &dist).status, 403);
        let mut plain = req("POST", "/api/hit");
        plain
            .headers
            .insert("content-type".into(), "text/plain".into());
        plain.body = json!({ "path": "/posts/hello-world/" })
            .to_string()
            .into_bytes();
        assert_eq!(
            crate::serve::route(&f.state, &plain, &dist).status,
            415,
            "a simple cross-origin POST is refused"
        );
        let views = crate::serve::route(
            &f.state,
            &req("GET", "/api/views?path=/posts/hello-world/"),
            &dist,
        );
        assert_eq!(
            body_json(&views)["views"],
            2,
            "opted-out and refused requests were not counted"
        );

        assert_eq!(
            crate::serve::route(&f.state, &req("GET", "/api/views?path=/secret/"), &dist).status,
            404
        );
        assert_eq!(
            crate::serve::route(
                &f.state,
                &req("POST", "/api/views?path=/posts/hello-world/"),
                &dist
            )
            .status,
            405
        );

        // Dashboard needs a session; shows what was recorded.
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/analytics")).status,
            401
        );
        let session = login_ok(&f);
        let dash = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/analytics?days=7"), &session, false),
        ));
        assert_eq!(dash["views"], 2);
        assert_eq!(dash["uniques"], 1, "one browser, one visitor");
        assert_eq!(dash["topPosts"][0]["path"], "/posts/hello-world/");
        assert_eq!(dash["referrers"][0]["host"], "news.ycombinator.com");
        assert_eq!(dash["series"].as_array().unwrap().len(), 7);

        // Flushing writes a file that holds counts but no visitor data.
        f.state.flush_analytics().unwrap();
        let text = fs::read_to_string(f.dir.join(".openblog/analytics.json")).unwrap();
        assert!(
            text.contains("/posts/hello-world/")
                && !text.contains("Mozilla")
                && !text.contains("10.0.0.1")
        );

        // Behind a trusted proxy the forwarded client is what gets limited and fingerprinted.
        let cfg_path = f.dir.join("openblog.json");
        let mut cfg: Json = serde_json::from_str(&fs::read_to_string(&cfg_path).unwrap()).unwrap();
        cfg["admin"]["trustedProxies"] = json!(["10.0.0.1"]);
        fs::write(&cfg_path, cfg.to_string()).unwrap();
        let forwarded = |client: &str| {
            hit(
                "/posts/hello-world/",
                &[("user-agent", "Mozilla"), ("x-forwarded-for", client)],
            )
        };
        for _ in 0..30 {
            assert_eq!(forwarded("203.0.113.5").status, 200);
        }
        assert_eq!(
            forwarded("203.0.113.5").status,
            429,
            "one forwarded client is limited"
        );
        assert_eq!(
            forwarded("198.51.100.9").status,
            200,
            "another client behind the same proxy is not"
        );
    }

    #[test]
    fn serves_the_admin_page_with_a_strict_policy() {
        let f = fixture("page");
        let resp = handle(&f.state, &req("GET", "/admin"));
        assert_eq!(resp.status, 200);
        let csp = resp
            .headers
            .iter()
            .find(|(k, _)| k == "Content-Security-Policy")
            .unwrap()
            .1
            .clone();
        assert!(
            csp.contains("default-src 'self'")
                && csp.contains("frame-ancestors 'none'")
                && !csp.contains("unsafe-inline")
        );
        assert!(resp
            .headers
            .iter()
            .any(|(k, v)| k == "X-Frame-Options" && v == "DENY"));
        assert_eq!(handle(&f.state, &req("GET", "/admin/admin.js")).status, 200);
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/secrets.txt")).status,
            404
        );
    }
}

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

use openblog_core::accessibility::AuditScope;
use openblog_core::frontmatter::{self, Value};
use openblog_core::markdown::RenderOptions;
use openblog_core::slug::slugify;
use openblog_core::{
    generate, generate_document, social_metadata, DateTime, LoadOptions, Site, SiteConfig,
    SourceFile,
};
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

struct PreviewDocument {
    token: String,
    html: String,
    csp: String,
}

pub struct AppState {
    pub root: PathBuf,
    pub out_override: Option<PathBuf>,
    /// Build drafts and scheduled posts into the public site (`serve --drafts`).
    pub include_drafts: bool,
    pub admin: bool,
    /// Build state and the content transaction lock. Every content reader and
    /// writer holds this while taking its filesystem snapshot.
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
    /// Small, bounded cache of generated documents served into sandboxed previews.
    previews: Mutex<Vec<PreviewDocument>>,
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
            previews: Mutex::new(Vec::new()),
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
            let _publish = lock(&state.publish_lock);
            let _content_transaction = lock(&state.build);
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
            preview_source: None,
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
fn header_default(mut response: Response, name: &str, value: &str) -> Response {
    if !response
        .headers
        .iter()
        .any(|(existing, _)| existing.eq_ignore_ascii_case(name))
    {
        response.headers.push((name.to_string(), value.to_string()));
    }
    response
}

fn secured(response: Response) -> Response {
    let response = header_default(
        response,
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: https:; \
         frame-src 'self' https://codepen.io; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    let response = header_default(response, "X-Frame-Options", "DENY");
    let response = header_default(response, "Referrer-Policy", "same-origin");
    header_default(response, "Cache-Control", "no-store")
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
    if req.method == "GET" {
        if let Some(token) = name.strip_prefix("preview/") {
            return preview_document(state, token);
        }
    }
    match (req.method.as_str(), name) {
        ("POST", "logout") => logout(state, req),
        ("GET", "session") => Response::json(
            200,
            &json!({ "user": session.user, "csrf": session.csrf, "now": clock::now().rfc3339() }),
        ),
        ("GET", "meta") => meta(state),
        ("GET", "contributors") => get_contributors(state),
        ("PUT", "contributors") => save_contributors(state, req),
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
        ("POST", "preview") => preview(state, req),
        ("POST", "quiz/generate") => generate_quiz(state, req),
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
            let _publish = lock(&state.publish_lock);
            let _content_transaction = lock(&state.build);
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
        .any(|p| p.trim() == "*" || p.trim() == req.peer);
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

/// Resolve the sidecar derived from an already validated post path with the
/// same containment guarantee as the Markdown file. Direct sidecar symlinks
/// are rejected even when they point back inside content: Admin mutations must
/// always address the regular file beside the post.
fn resolve_credit_path(root: &Path, config: &SiteConfig, rel: &str) -> Result<PathBuf, String> {
    check_rel_path(rel)?;
    let sidecar_rel = openblog_core::contributor::sidecar_path(rel)
        .ok_or_else(|| "cannot derive the post credit sidecar path".to_string())?;
    let content_dir = root.join(&config.paths.content);
    let canonical_content = fs::canonicalize(&content_dir)
        .map_err(|_| "the content directory does not exist".to_string())?;
    let full = content_dir.join(&sidecar_rel);
    if fs::symlink_metadata(&full).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("credit sidecar symlinks are not allowed".into());
    }
    let mut probe = full.as_path();
    loop {
        if probe.exists() {
            let canonical = fs::canonicalize(probe).map_err(|error| error.to_string())?;
            if !canonical.starts_with(&canonical_content) {
                return Err("credit sidecar resolves outside the content directory".into());
            }
            break;
        }
        probe = probe.parent().ok_or("invalid credit sidecar path")?;
    }
    Ok(full)
}

fn etag(text: &str) -> String {
    etag_bytes(text.as_bytes())
}

fn etag_bytes(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        h ^= u64::from(*byte);
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
    let _content_transaction = lock(&state.build);
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
    let profiles: Vec<Json> = openblog_core::profile::catalog()
        .iter()
        .map(|profile| {
            json!({
                "id": profile.id,
                "label": profile.label,
                "description": profile.description,
                "fields": profile.fields.iter().map(|field| json!({
                    "key": field.key,
                    "label": field.label,
                    "kind": field.kind.as_str(),
                    "help": field.help,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let credit_roles = openblog_core::contributor::role_catalog()
        .into_iter()
        .map(|role| {
            json!({
                "vocabulary": role.vocabulary.as_str(),
                "role": role.role,
                "label": role.label(),
            })
        })
        .collect::<Vec<_>>();
    Response::json(
        200,
        &json!({
            "siteTitle": config.title,
            "siteUrl": config.url,
            "authorReady": !config.author.name.trim().is_empty()
                && !config.author.url.trim().is_empty(),
            "postPath": config.post_path,
            "defaultTheme": config.theme,
            "themes": theme_list,
            "profiles": profiles,
            "contributors": config.contributors,
            "creditRoles": credit_roles,
            "series": series,
            "tags": tags,
            "maxUploadMb": config.admin.max_upload_mb,
            "quizGeneration": !config.knowledge_checks.generation_endpoint.trim().is_empty()
                && std::env::var("OPENBLOG_LESSONS_API_KEY").is_ok_and(|key| !key.trim().is_empty()),
            "now": clock::now().rfc3339(),
        }),
    )
}

fn validated_questions(value: &Json) -> Result<Json, String> {
    let questions = value["questions"]
        .as_array()
        .ok_or("generation response needs a `questions` array")?;
    if !(1..=3).contains(&questions.len()) {
        return Err("generation response needs between one and three questions".into());
    }
    let mut clean = Vec::with_capacity(questions.len());
    for (number, question) in questions.iter().enumerate() {
        let prompt = question["prompt"].as_str().unwrap_or("").trim();
        let choices = question["choices"]
            .as_array()
            .ok_or_else(|| format!("question {} needs a choices array", number + 1))?;
        let correct = question["correctIndex"]
            .as_u64()
            .ok_or_else(|| format!("question {} needs a correctIndex", number + 1))?
            as usize;
        let explanation = question["explanation"].as_str().unwrap_or("").trim();
        if prompt.is_empty() || prompt.chars().count() > 500 {
            return Err(format!("question {} has an invalid prompt", number + 1));
        }
        if !(2..=4).contains(&choices.len()) || correct >= choices.len() {
            return Err(format!(
                "question {} needs two to four choices and a valid correctIndex",
                number + 1
            ));
        }
        let mut clean_choices = Vec::with_capacity(choices.len());
        for choice in choices {
            let text = choice.as_str().unwrap_or("").trim();
            if text.is_empty() || text.chars().count() > 300 {
                return Err(format!("question {} has an invalid choice", number + 1));
            }
            clean_choices.push(text);
        }
        if explanation.chars().count() > 1000 {
            return Err(format!(
                "question {} has an explanation that is too long",
                number + 1
            ));
        }
        clean.push(json!({
            "prompt": prompt,
            "choices": clean_choices,
            "correctIndex": correct,
            "explanation": explanation,
        }));
    }
    Ok(json!({ "questions": clean }))
}

fn generate_quiz(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let context = body["context"].as_str().unwrap_or("").trim();
    let count = body["count"].as_u64().unwrap_or(0);
    if context.is_empty() || context.chars().count() > 50_000 {
        return Response::error(
            400,
            "Select between 1 and 50,000 characters of article text",
        );
    }
    if !(1..=3).contains(&count) {
        return Response::error(400, "Question count must be between one and three");
    }

    let config = site::load_config(&state.root).unwrap_or_default();
    let endpoint = config.knowledge_checks.generation_endpoint.trim();
    if endpoint.is_empty() {
        return Response::error(404, "Quiz generation is not configured");
    }
    let test_loopback = cfg!(test) && endpoint.starts_with("http://127.0.0.1:");
    if !endpoint.starts_with("https://") && !test_loopback {
        return Response::error(400, "Quiz generation endpoint must use HTTPS");
    }
    let key = match std::env::var("OPENBLOG_LESSONS_API_KEY") {
        Ok(key) if !key.trim().is_empty() => key,
        _ => return Response::error(503, "OPENBLOG_LESSONS_API_KEY is not set"),
    };
    let payload = json!({
        "model": config.knowledge_checks.model,
        "context": context,
        "count": count,
        "task": "Draft short multiple-choice knowledge checks grounded only in the supplied article context. Return JSON only.",
        "responseSchema": {
            "questions": [{
                "prompt": "string",
                "choices": ["string", "string"],
                "correctIndex": 0,
                "explanation": "string"
            }]
        }
    });
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(if cfg!(test) {
            Duration::from_millis(300)
        } else {
            Duration::from_secs(30)
        }))
        .user_agent(concat!(
            "open.blog-admin/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/journey-to-code-org/open.blog)"
        ))
        .build()
        .into();
    let mut response = match agent
        .post(endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", &format!("Bearer {}", key.trim()))
        .send(payload.to_string())
    {
        Ok(response) => response,
        Err(error) => return Response::error(502, &format!("Quiz generation failed: {error}")),
    };
    let bytes = match response
        .body_mut()
        .with_config()
        .limit(128 * 1024)
        .read_to_vec()
    {
        Ok(bytes) => bytes,
        Err(error) => {
            return Response::error(502, &format!("Cannot read generation response: {error}"))
        }
    };
    let value: Json = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return Response::error(502, "Generation endpoint returned invalid JSON"),
    };
    match validated_questions(&value) {
        Ok(clean) => Response::json(200, &clean),
        Err(error) => Response::error(502, &error),
    }
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
    let _content_transaction = lock(&state.build);
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
    let credit_sidecars = openblog_core::model::associate_credit_sidecars(&sources);
    let now = clock::now();
    let mut items: Vec<(i64, Json)> = Vec::new();
    for file in files {
        let normalized_path = file.path.replace('\\', "/");
        let explicit_credits = openblog_core::contributor::sidecar_path(&normalized_path)
            .is_some_and(|sidecar_path| {
                sources
                    .credits
                    .iter()
                    .any(|sidecar| sidecar.path.replace('\\', "/") == sidecar_path)
            });
        let credit_mode = if explicit_credits {
            "explicit"
        } else {
            "inherited"
        };
        let item = match kind {
            "posts" => {
                if let Some(error) = credit_sidecars.post_errors.get(&normalized_path) {
                    (
                        i64::MIN,
                        json!({ "path": file.path, "title": file.path, "status": "error", "error": error, "creditMode": credit_mode }),
                    )
                } else {
                    let sidecar = credit_sidecars.by_post.get(&normalized_path).copied();
                    match openblog_core::model::load_post_with_credits(
                        file,
                        &config,
                        RenderOptions::default(),
                        sidecar,
                    ) {
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
                                    "creditMode": credit_mode,
                                }),
                            )
                        }
                        Err(e) => (
                            i64::MIN,
                            json!({ "path": file.path, "title": file.path, "status": "error", "error": e, "creditMode": credit_mode }),
                        ),
                    }
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
    let _content_transaction = lock(&state.build);
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
    let (credits, credit_etag, credit_error) = if kind == "posts" {
        let sidecar = match resolve_credit_path(&state.root, &config, rel) {
            Ok(path) => path,
            Err(error) => return Response::error(400, &error),
        };
        document_credits(&sidecar, &config)
    } else {
        (Json::Null, Json::Null, Json::Null)
    };
    match frontmatter::parse(&text) {
        Ok(doc) => {
            let resolved_profile = if kind == "posts" {
                json!(openblog_core::profile::resolve(&doc.front_matter).id)
            } else {
                Json::Null
            };
            Response::json(
                200,
                &json!({ "path": rel, "kind": kind, "etag": etag(&text), "fields": fields_to_json(&doc.front_matter.fields), "body": doc.body, "resolvedProfile": resolved_profile, "credits": credits, "creditEtag": credit_etag, "creditError": credit_error }),
            )
        }
        Err(e) => Response::json(
            200,
            &json!({ "path": rel, "kind": kind, "etag": etag(&text), "raw": text, "error": e, "credits": credits, "creditEtag": credit_etag, "creditError": credit_error }),
        ),
    }
}

fn document_credits(sidecar: &Path, config: &SiteConfig) -> (Json, Json, Json) {
    let bytes = match fs::read(sidecar) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (Json::Null, Json::Null, Json::Null);
        }
        Err(error) => {
            return (
                Json::Null,
                Json::Null,
                Json::String(format!("cannot read {}: {error}", sidecar.display())),
            );
        }
    };
    let credit_etag = Json::String(etag_bytes(&bytes));
    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text,
        Err(error) => {
            return (
                Json::Null,
                credit_etag,
                Json::String(format!("{} is not UTF-8: {error}", sidecar.display())),
            );
        }
    };
    let value: Json = match serde_json::from_str(text) {
        Ok(value) => value,
        Err(error) => {
            return (
                Json::Null,
                credit_etag,
                Json::String(format!("cannot parse {}: {error}", sidecar.display())),
            );
        }
    };
    if value.get("version").and_then(Json::as_u64) != Some(1) {
        return (
            Json::Null,
            credit_etag,
            Json::String(format!(
                "{} must use credit file version 1",
                sidecar.display()
            )),
        );
    }
    let Some(credits) = value.get("credits").and_then(Json::as_array) else {
        return (
            Json::Null,
            credit_etag,
            Json::String(format!("{} has no credits array", sidecar.display())),
        );
    };
    let credit_error =
        openblog_core::contributor::resolve(&config.author, &config.contributors, Some(text))
            .err()
            .map(Json::String)
            .unwrap_or(Json::Null);
    (Json::Array(credits.clone()), credit_etag, credit_error)
}

fn contributor_registry_response(config_bytes: &[u8], config: &SiteConfig) -> Response {
    Response::json(
        200,
        &json!({
            "etag": etag_bytes(config_bytes),
            "contributors": config.contributors,
            "author": config.author,
        }),
    )
}

fn get_contributors(state: &AppState) -> Response {
    let _content_transaction = lock(&state.build);
    let path = state.root.join(site::CONFIG_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Response::error(500, &format!("cannot read {}: {error}", path.display()))
        }
    };
    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text,
        Err(error) => {
            return Response::error(500, &format!("{} is not UTF-8: {error}", path.display()))
        }
    };
    match SiteConfig::from_json(text) {
        Ok(config) => contributor_registry_response(&bytes, &config),
        Err(error) => Response::error(500, &error),
    }
}

fn referenced_removed_contributors(
    root: &Path,
    config: &SiteConfig,
    removed: &[String],
) -> Result<Vec<String>, String> {
    if removed.is_empty() {
        return Ok(Vec::new());
    }
    let sources = site::read_sources(root, config)?;
    let mut references = Vec::new();
    for sidecar in sources.credits {
        let Ok(value) = serde_json::from_str::<Json>(&sidecar.contents) else {
            continue;
        };
        let Some(credits) = value.get("credits").and_then(Json::as_array) else {
            continue;
        };
        if credits.iter().any(|credit| {
            credit
                .get("contributor")
                .and_then(Json::as_str)
                .is_some_and(|id| removed.iter().any(|removed| removed == id))
        }) {
            references.push(sidecar.path);
        }
    }
    references.sort();
    references.dedup();
    Ok(references)
}

fn save_contributors(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let Some(contributors) = body.get("contributors").and_then(Json::as_object) else {
        return Response::error(422, "contributors must be an object");
    };
    if contributors.len() > 500 {
        return Response::error(422, "contributors has too many entries");
    }

    let mut status = lock(&state.build);
    let path = state.root.join(site::CONFIG_FILE);
    let current_bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Response::error(500, &format!("cannot read {}: {error}", path.display()))
        }
    };
    if body.get("etag").and_then(Json::as_str) != Some(etag_bytes(&current_bytes).as_str()) {
        return Response::error(
            409,
            "Site settings changed on disk since you opened Contributors. Reload before saving.",
        );
    }
    let current_text = match std::str::from_utf8(&current_bytes) {
        Ok(text) => text,
        Err(error) => {
            return Response::error(500, &format!("{} is not UTF-8: {error}", path.display()))
        }
    };
    let current_config = match SiteConfig::from_json(current_text) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let mut candidate_json: Json = match serde_json::from_str(current_text) {
        Ok(Json::Object(object)) => Json::Object(object),
        Ok(_) => return Response::error(500, "openblog.json must contain a JSON object"),
        Err(error) => return Response::error(500, &format!("invalid openblog.json: {error}")),
    };
    candidate_json["contributors"] = Json::Object(contributors.clone());
    let candidate_text = match serde_json::to_string(&candidate_json) {
        Ok(text) => text,
        Err(error) => {
            return Response::error(422, &format!("cannot serialize contributors: {error}"))
        }
    };
    let candidate_config = match SiteConfig::from_json(&candidate_text) {
        Ok(config) => config,
        Err(error) => return Response::error(422, &error),
    };
    let removed = current_config
        .contributors
        .keys()
        .filter(|id| !candidate_config.contributors.contains_key(*id))
        .cloned()
        .collect::<Vec<_>>();
    let references = match referenced_removed_contributors(&state.root, &current_config, &removed) {
        Ok(references) => references,
        Err(error) => return Response::error(422, &error),
    };
    if !references.is_empty() {
        return Response::json(
            422,
            &json!({
                "error": "Referenced contributors cannot be removed. Update these post credits first.",
                "paths": references,
            }),
        );
    }

    candidate_json["contributors"] = json!(candidate_config.contributors);
    let written = match serde_json::to_string_pretty(&candidate_json) {
        Ok(text) => format!("{text}\n"),
        Err(error) => {
            return Response::error(500, &format!("cannot serialize openblog.json: {error}"))
        }
    };
    if let Err(error) = write_atomic(&path, &written) {
        return Response::error(500, &error);
    }
    let build = state.rebuild_locked(&mut status);
    let build_json = match build {
        Ok(report) => json!({ "ok": true, "posts": report.posts, "files": report.files }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    eprintln!("admin: updated contributor registry");
    state_arc(state).auto_publish("Update contributor registry".into());
    Response::json(
        200,
        &json!({
            "etag": etag(&written),
            "contributors": candidate_config.contributors,
            "author": candidate_config.author,
            "build": build_json,
        }),
    )
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

enum CreditEdit {
    Unchanged,
    Remove,
    Set(String),
}

fn credit_sidecar_contents(value: &Json) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let credits = value.as_array().ok_or("credits must be an array or null")?;
    if credits.len() > 100 {
        return Err("credits has too many contributors".into());
    }
    serde_json::to_string_pretty(&json!({ "version": 1, "credits": credits }))
        .map(Some)
        .map_err(|error| format!("cannot serialize credits: {error}"))
}

fn requested_credit_edit(body: &Json, kind: &str) -> Result<CreditEdit, String> {
    let Some(object) = body.as_object() else {
        return Err("request body must be an object".into());
    };
    let Some(credits) = object.get("credits") else {
        return Ok(CreditEdit::Unchanged);
    };
    if kind != "posts" {
        return Err("credits are only available for posts".into());
    }
    match credit_sidecar_contents(credits)? {
        Some(contents) => Ok(CreditEdit::Set(contents)),
        None => Ok(CreditEdit::Remove),
    }
}

fn apply_credit_edit_to_sources(
    sources: &mut openblog_core::Sources,
    rel: &str,
    edit: &CreditEdit,
) {
    let Some(sidecar_path) = openblog_core::contributor::sidecar_path(rel) else {
        return;
    };
    if matches!(edit, CreditEdit::Unchanged) {
        return;
    }
    sources.credits.retain(|file| file.path != sidecar_path);
    if let CreditEdit::Set(contents) = edit {
        sources.credits.push(SourceFile {
            path: sidecar_path,
            contents: contents.clone(),
        });
    }
}

/// Check that the site still loads and renders with `rel` set to `source`.
/// Only problems that involve the edited file are reported; unrelated broken
/// files are surfaced by the rebuild instead of blocking every save.
fn validate_candidate(
    root: &Path,
    config: &SiteConfig,
    rel: &str,
    source: &str,
    credit_edit: &CreditEdit,
) -> Result<(), Vec<String>> {
    let excluded_sidecar = (!matches!(credit_edit, CreditEdit::Unchanged))
        .then(|| openblog_core::contributor::sidecar_path(rel))
        .flatten();
    let mut sources = site::read_sources_excluding(root, config, excluded_sidecar.as_deref())
        .map_err(|e| vec![e])?;
    for bucket in [&mut sources.posts, &mut sources.series, &mut sources.pages] {
        bucket.retain(|f| f.path != rel);
    }
    sources.add(SourceFile {
        path: rel.to_string(),
        contents: source.to_string(),
    });
    apply_credit_edit_to_sources(&mut sources, rel, credit_edit);
    let themes = site::load_themes(root, config).map_err(|e| vec![e])?;
    match Site::load(
        config.clone(),
        sources,
        LoadOptions {
            include_drafts: true,
            now: None,
            preview_source: None,
        },
    ) {
        Ok(site) => generate(&site, &themes).map(|_| ()).map_err(|e| vec![e]),
        Err(errors) => {
            let sidecar = openblog_core::contributor::sidecar_path(rel);
            let mine: Vec<String> = errors
                .into_iter()
                .filter(|error| {
                    error.contains(rel)
                        || sidecar.as_deref().is_some_and(|path| error.contains(path))
                })
                .collect();
            if mine.is_empty() {
                Ok(())
            } else {
                Err(mine)
            }
        }
    }
}

fn write_atomic_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
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

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    write_atomic_bytes(path, contents.as_bytes())
}

fn restore_file(path: &Path, previous: Option<&[u8]>) -> Result<(), String> {
    match previous {
        Some(contents) => write_atomic_bytes(path, contents),
        None if path.exists() => fs::remove_file(path)
            .map_err(|error| format!("cannot remove {} during rollback: {error}", path.display())),
        None => Ok(()),
    }
}

fn read_optional_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read {}: {error}", path.display())),
    }
}

fn write_document_with_credits(
    path: &Path,
    sidecar: &Path,
    source: &str,
    credit_edit: &CreditEdit,
) -> Result<(), String> {
    write_document_with_credits_using(path, sidecar, source, credit_edit, mutate_credit_sidecar)
}

fn mutate_credit_sidecar(sidecar: &Path, credit_edit: &CreditEdit) -> Result<(), String> {
    match credit_edit {
        CreditEdit::Set(contents) => write_atomic(sidecar, contents),
        CreditEdit::Remove if sidecar.exists() => fs::remove_file(sidecar)
            .map_err(|error| format!("cannot remove {}: {error}", sidecar.display())),
        CreditEdit::Remove | CreditEdit::Unchanged => Ok(()),
    }
}

fn write_document_with_credits_using(
    path: &Path,
    sidecar: &Path,
    source: &str,
    credit_edit: &CreditEdit,
    mutate_sidecar: impl FnOnce(&Path, &CreditEdit) -> Result<(), String>,
) -> Result<(), String> {
    if matches!(credit_edit, CreditEdit::Unchanged) {
        return write_atomic(path, source);
    }
    let previous_document = read_optional_bytes(path)?;
    let previous_sidecar = read_optional_bytes(sidecar)?;
    write_atomic(path, source)?;
    let credit_result = mutate_sidecar(sidecar, credit_edit);
    if let Err(error) = credit_result {
        let document_rollback = restore_file(path, previous_document.as_deref());
        let credit_rollback = restore_file(sidecar, previous_sidecar.as_deref());
        return Err(match (document_rollback, credit_rollback) {
            (Ok(()), Ok(())) => error,
            (document, credits) => format!(
                "{error}; rollback failed (document: {}; credits: {})",
                document.err().unwrap_or_else(|| "ok".into()),
                credits.err().unwrap_or_else(|| "ok".into())
            ),
        });
    }
    Ok(())
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
    let kind = check_rel_path(&rel).unwrap_or("posts");
    let credit_path = if kind == "posts" {
        match resolve_credit_path(&state.root, &config, &rel) {
            Ok(path) => Some(path),
            Err(error) => return Response::error(400, &error),
        }
    } else {
        None
    };
    let credit_edit = match requested_credit_edit(&body, kind) {
        Ok(edit) => edit,
        Err(error) => return Response::error(422, &error),
    };

    if created {
        if path.exists() {
            return Response::error(
                409,
                "A file with that name already exists. Change the title, slug, or date.",
            );
        }
        if matches!(credit_edit, CreditEdit::Unchanged)
            && credit_path.as_ref().is_some_and(|path| path.exists())
        {
            return Response::error(
                409,
                "A credit sidecar with that name already exists. Reload with a credits-aware Admin client or move the orphaned sidecar.",
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

    if !matches!(credit_edit, CreditEdit::Unchanged) {
        let sidecar = credit_path.as_ref().expect("post credit path");
        let current = match read_optional_bytes(sidecar) {
            Ok(current) => current,
            Err(error) => return Response::error(500, &error),
        };
        let expected = body.get("creditEtag").and_then(Json::as_str);
        let matches = match current.as_deref() {
            Some(contents) => {
                let current_etag = etag_bytes(contents);
                expected == Some(current_etag.as_str())
            }
            None => body.get("creditEtag").is_none_or(Json::is_null),
        };
        if !matches {
            return Response::error(
                409,
                "The post credits changed on disk since you opened them. Reload before saving.",
            );
        }
    }

    if let Err(problems) = validate_candidate(&state.root, &config, &rel, &source, &credit_edit) {
        return Response::json(
            422,
            &json!({ "error": "This can't be saved yet.", "problems": problems }),
        );
    }
    let sidecar = credit_path.as_deref().unwrap_or(&path);
    if let Err(e) = write_document_with_credits(&path, sidecar, &source, &credit_edit) {
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
    let credit_etag = match credit_path.as_deref() {
        Some(sidecar) => match read_optional_bytes(sidecar) {
            Ok(contents) => contents.map(|contents| etag_bytes(&contents)),
            Err(error) => return Response::error(500, &error),
        },
        None => None,
    };
    Response::json(
        if created { 201 } else { 200 },
        &json!({ "path": rel, "etag": etag(&source), "creditEtag": credit_etag, "status": post_status, "url": url, "build": build_json }),
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

fn unique_trash_target(trash: &Path, stamp: &str, name: &str) -> PathBuf {
    let mut target = trash.join(format!("{stamp}-{name}"));
    let mut number = 1;
    while target.exists() {
        target = trash.join(format!("{stamp}-{number}-{name}"));
        number += 1;
    }
    target
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
    let target = unique_trash_target(&trash, &stamp, &name);
    let sidecar = if check_rel_path(rel).ok() == Some("posts") {
        match resolve_credit_path(&state.root, &config, rel) {
            Ok(path) => Some(path),
            Err(error) => return Response::error(400, &error),
        }
    } else {
        None
    };
    let sidecar_target = sidecar.as_ref().filter(|path| path.is_file()).map(|_| {
        let sidecar_name = openblog_core::contributor::sidecar_path(rel)
            .unwrap_or_else(|| format!("{rel}.credits.json"))
            .replace('/', "_");
        unique_trash_target(&trash, &stamp, &sidecar_name)
    });
    if let Err(e) = fs::rename(&path, &target) {
        return Response::error(500, &format!("cannot move the file to the trash: {e}"));
    }
    if let Some(sidecar_target) = &sidecar_target {
        if let Err(error) = fs::rename(sidecar.as_ref().expect("existing sidecar"), sidecar_target)
        {
            let rollback = fs::rename(&target, &path);
            return Response::error(
                500,
                &format!(
                    "cannot move the credit sidecar to the trash: {error}; document rollback: {}",
                    rollback
                        .err()
                        .map(|error| error.to_string())
                        .unwrap_or_else(|| "ok".into())
                ),
            );
        }
    }
    eprintln!("admin: deleted {rel} (kept in .openblog/trash)");
    let build = state.rebuild_locked(&mut status);
    let build_json = match &build {
        Ok(r) => json!({ "ok": true, "posts": r.posts }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    Response::json(
        200,
        &json!({
            "ok": true,
            "trashedTo": target.file_name().map(|n| n.to_string_lossy().into_owned()),
            "trashedCreditsTo": sidecar_target.and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned())),
            "build": build_json
        }),
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

fn preview(state: &AppState, req: &Request) -> Response {
    if let Err(r) = require_json(req) {
        return r;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(b) => b,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let text_body = body["body"].as_str().unwrap_or("");
    if text_body.len() > MAX_DOCUMENT_BYTES || text_body.contains('\0') {
        return Response::error(413, "The post body is too large");
    }
    let fields = match fields_from_json(&body["fields"]) {
        Ok(fields) => fields,
        Err(e) => return Response::error(422, &e),
    };
    let kind = body["kind"].as_str().unwrap_or("posts");
    if !matches!(kind, "posts" | "pages" | "series") {
        return Response::error(422, "kind must be posts, series, or pages");
    }
    let rel = match body["path"].as_str().filter(|path| !path.is_empty()) {
        Some(path) => match check_rel_path(path) {
            Ok(path_kind) if path_kind == kind => path.to_string(),
            Ok(_) => return Response::error(422, "path does not match the document kind"),
            Err(e) => return Response::error(422, &e),
        },
        None => match derive_new_path(kind, &fields) {
            Ok(path) => path,
            Err(e) => return Response::error(422, &e),
        },
    };
    let source = frontmatter::compose(&fields, text_body);
    let credit_edit = match requested_credit_edit(&body, kind) {
        Ok(edit) => edit,
        Err(error) => return Response::error(422, &error),
    };
    let _content_transaction = lock(&state.build);
    let mut config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(e) => return Response::error(500, &e),
    };
    if kind == "posts" {
        if let Err(error) = resolve_credit_path(&state.root, &config, &rel) {
            return Response::error(400, &error);
        }
    }
    let excluded_sidecar = (!matches!(credit_edit, CreditEdit::Unchanged))
        .then(|| openblog_core::contributor::sidecar_path(&rel))
        .flatten();
    let mut sources =
        match site::read_sources_excluding(&state.root, &config, excluded_sidecar.as_deref()) {
            Ok(sources) => sources,
            Err(e) => return Response::error(500, &e),
        };
    for bucket in [&mut sources.posts, &mut sources.series, &mut sources.pages] {
        bucket.retain(|file| file.path != rel);
    }
    sources.add(SourceFile {
        path: rel.clone(),
        contents: source,
    });
    apply_credit_edit_to_sources(&mut sources, &rel, &credit_edit);
    // Owner-supplied analytics/comments snippets are intentionally disabled in
    // an unpublished preview. Theme assets and built-in components still run.
    config.snippets = Default::default();
    config.analytics.builtin = false;
    config.analytics.show_views = false;
    config.analytics.endpoint.clear();
    let (preview_site, themes) = match site::load_site_from_sources(
        &state.root,
        config,
        sources,
        LoadOptions {
            include_drafts: false,
            now: Some(clock::now()),
            preview_source: Some(rel.clone()),
        },
    ) {
        Ok(loaded) => loaded,
        Err(error) => return Response::error(422, &error),
    };
    let target = match kind {
        "posts" => preview_site
            .posts
            .iter()
            .find(|post| post.source == rel)
            .map(|post| {
                (
                    post.url.clone(),
                    preview_site.theme_for_post(post).to_string(),
                )
            }),
        "pages" => preview_site
            .pages
            .iter()
            .find(|page| page.source == rel)
            .map(|page| {
                (
                    page.url.clone(),
                    preview_site.theme_for_page(page).to_string(),
                )
            }),
        "series" => preview_site
            .series
            .iter()
            .find(|series| series.source.as_deref() == Some(rel.as_str()))
            .map(|series| {
                (
                    series.url.clone(),
                    preview_site.theme_for_series(series).to_string(),
                )
            }),
        _ => None,
    };
    let Some((url, theme)) = target else {
        return Response::error(422, "Preview document was not found in the site model");
    };
    let research = preview_site
        .posts
        .iter()
        .find(|post| post.source == rel)
        .and_then(|post| post.research.as_ref())
        .map(|research| {
            json!({
                "doi": research.doi,
                "doiUrl": research.doi_url,
                "licenseUrl": research.license_url,
                "referenceCount": research.references.len(),
            })
        });
    let social = match social_metadata(&preview_site, &rel) {
        Ok(meta) => json!({
            "siteName": meta.site_name,
            "title": meta.title,
            "description": meta.description,
            "url": meta.url,
            "image": meta.image,
            "imageAlt": meta.image_alt.unwrap_or_default(),
            "type": meta.kind,
            "card": meta.card,
        }),
        Err(e) => return Response::error(422, &e),
    };
    let document = match generate_document(&preview_site, &themes, &rel) {
        Ok(document) => document,
        Err(e) => return Response::error(422, &e),
    };
    let token = match auth::random_token() {
        Ok(token) => token,
        Err(e) => return Response::error(500, &e),
    };
    let asset_origin = http_origin(&preview_site.config.cdn.url);
    let script_sources = asset_origin
        .as_deref()
        .map(|origin| format!("'self' {origin}"))
        .unwrap_or_else(|| "'self'".to_string());
    let csp = format!(
        "default-src 'none'; script-src 'unsafe-inline' {script_sources}; style-src 'unsafe-inline' 'self' https:; \
         img-src 'self' https: data:; font-src 'self' https: data:; connect-src 'self' https://play.rust-lang.org; \
         frame-src https://codepen.io; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'"
    );
    let mut previews = lock(&state.previews);
    previews.push(PreviewDocument {
        token: token.clone(),
        html: document.contents,
        csp,
    });
    if previews.len() > 16 {
        previews.remove(0);
    }
    let accessibility: Vec<_> = preview_site
        .accessibility
        .iter()
        .filter(|finding| finding.source.path == rel || finding.scope == AuditScope::Site)
        .cloned()
        .collect();
    let evidence: Vec<_> = preview_site
        .evidence
        .iter()
        .filter(|finding| finding.source.path == rel)
        .cloned()
        .collect();
    Response::json(
        200,
        &json!({
            "previewUrl": format!("/admin/api/preview/{token}"),
            "url": url,
            "theme": theme,
            "social": social,
            "research": research,
            "warnings": preview_site.warnings,
            "accessibility": accessibility,
            "evidence": evidence
        }),
    )
}

fn preview_document(state: &AppState, token: &str) -> Response {
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Response::error(404, "Preview not found");
    }
    let document = lock(&state.previews)
        .iter()
        .find(|document| document.token == token)
        .map(|document| (document.html.clone(), document.csp.clone()));
    let Some((html, csp)) = document else {
        return Response::error(404, "Preview not found");
    };
    Response::new(200, "text/html; charset=utf-8", html.into_bytes())
        .with_header("Content-Security-Policy", &csp)
        .with_header("X-Frame-Options", "SAMEORIGIN")
        .with_header("Referrer-Policy", "no-referrer")
}

fn http_origin(value: &str) -> Option<String> {
    let value = value.trim();
    let (scheme, rest) = value.split_once("://")?;
    if !matches!(scheme, "http" | "https") {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty()
        || !authority.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b':' | b'[' | b']')
        })
    {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
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
    use std::io::{Read, Write};
    use std::net::TcpListener;

    static QUIZ_ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct EnvRestore {
        name: &'static str,
        value: Option<std::ffi::OsString>,
    }

    impl EnvRestore {
        fn capture(name: &'static str) -> Self {
            Self {
                name,
                value: std::env::var_os(name),
            }
        }
    }

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            if let Some(value) = &self.value {
                std::env::set_var(self.name, value);
            } else {
                std::env::remove_var(self.name);
            }
        }
    }

    struct Fixture {
        state: Arc<AppState>,
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
        let state = Arc::new(AppState::new(dir.clone(), None, false, true));
        state.rebuild().unwrap();
        Fixture { state, dir }
    }

    fn quiz_provider(
        status: u16,
        body: String,
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(1))).ok();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap_or(0);
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            std::thread::sleep(delay);
            let reason = if status == 200 { "OK" } else { "Error" };
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        });
        (format!("http://{address}/generate"), handle)
    }

    fn set_quiz_endpoint(fixture: &Fixture, endpoint: &str) {
        let path = fixture.dir.join("openblog.json");
        let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        config["knowledgeChecks"] = json!({ "generationEndpoint": endpoint, "model": "test" });
        fs::write(path, config.to_string()).unwrap();
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
        // "*" trusts every peer's X-Forwarded-For (containers behind a PaaS proxy).
        cfg["admin"]["trustedProxies"] = json!(["*"]);
        fs::write(&cfg_path, cfg.to_string()).unwrap();
        let mut any = json_req(
            "POST",
            "/admin/api/login",
            json!({ "username": "mikey", "password": "correct horse battery" }),
        );
        any.peer = "172.16.0.77".into();
        any.headers
            .insert("x-forwarded-for".into(), "203.0.113.9".into());
        assert_eq!(
            handle(&f.state, &any).status,
            429,
            "the forwarded client is still locked out through any proxy"
        );
        cfg["admin"]["trustedProxies"] = json!(["10.0.0.1"]);
        fs::write(&cfg_path, cfg.to_string()).unwrap();
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
    fn quiz_generation_responses_are_strictly_validated() {
        let good = validated_questions(&json!({
            "questions": [{
                "prompt": "What stays local?",
                "choices": ["Reader attempts", "Published posts"],
                "correctIndex": 0,
                "explanation": "Attempts are stored in the reader's browser."
            }]
        }))
        .unwrap();
        assert_eq!(good["questions"][0]["correctIndex"], 0);
        for bad in [
            json!({ "questions": [] }),
            json!({ "questions": [{ "prompt": "Q", "choices": ["A"], "correctIndex": 0 }] }),
            json!({ "questions": [{ "prompt": "Q", "choices": ["A", "B"], "correctIndex": 2 }] }),
            json!({ "questions": [{ "prompt": "", "choices": ["A", "B"], "correctIndex": 0 }] }),
        ] {
            assert!(validated_questions(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn admin_meta_describes_available_content_profiles() {
        let f = fixture("profile-meta");
        let response = meta(&f.state);
        assert_eq!(response.status, 200);
        let profiles = body_json(&response)["profiles"].as_array().unwrap().clone();

        assert_eq!(profiles[0]["id"], "article");
        assert_eq!(profiles[0]["label"], "Article");
        assert_eq!(profiles[1]["id"], "recipe");
        assert_eq!(profiles[1]["fields"][0]["key"], "servings");
        assert_eq!(profiles[1]["fields"][2]["kind"], "duration");
        assert_eq!(profiles[2]["id"], "research");
        assert_eq!(profiles[2]["fields"][0]["key"], "doi");
        assert_eq!(profiles[2]["fields"][1]["key"], "license");
    }

    #[test]
    fn unknown_content_profiles_round_trip_and_warn_in_preview() {
        let f = fixture("profile-roundtrip");
        let session = login_ok(&f);
        let fields = json!({
            "title": "Field log",
            "date": "2026-10-23",
            "profile": "field-notes"
        });
        let create = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document",
                    json!({ "kind": "posts", "fields": fields, "body": "## Entry\nObserved." }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            create.status,
            201,
            "{}",
            String::from_utf8_lossy(&create.body)
        );
        let path = body_json(&create)["path"].as_str().unwrap().to_string();

        let document = handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/document?path={path}")),
                &session,
                false,
            ),
        );
        let document = body_json(&document);
        assert_eq!(document["fields"]["profile"], "field-notes");
        assert_eq!(document["resolvedProfile"], "field-notes");

        let preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({ "kind": "posts", "path": path, "fields": fields, "body": "## Entry\nObserved." }),
                ),
                &session,
                true,
            ),
        );
        let warnings = body_json(&preview)["warnings"].as_array().unwrap().clone();
        assert!(warnings.iter().any(|warning| warning
            .as_str()
            .is_some_and(|text| text.contains("unknown content profile `field-notes`"))));
    }

    #[test]
    fn preview_accessibility_is_scoped_to_the_document_and_site() {
        let f = fixture("preview-accessibility");
        let config_path = f.dir.join("openblog.json");
        let mut config: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["language"] = json!("");
        fs::write(&config_path, config.to_string()).unwrap();
        fs::write(
            f.dir.join("content/posts/unrelated.md"),
            "---\ntitle: Unrelated\ndate: 2026-10-22\n---\n[](/unrelated)\n",
        )
        .unwrap();
        let session = login_ok(&f);

        let preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": "posts/current.md",
                        "fields": { "title": "Current", "date": "2026-10-23" },
                        "body": "[](/current)"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            preview.status,
            200,
            "{}",
            String::from_utf8_lossy(&preview.body)
        );
        let findings = body_json(&preview)["accessibility"]
            .as_array()
            .unwrap()
            .clone();

        assert_eq!(findings.len(), 2);
        assert!(findings.iter().any(|finding| {
            finding["code"] == "document-language-missing"
                && finding["scope"] == "site"
                && finding["source"]["path"] == "openblog.json"
        }));
        assert!(findings.iter().any(|finding| {
            finding["code"] == "link-name-empty" && finding["source"]["path"] == "posts/current.md"
        }));
        assert!(!findings
            .iter()
            .any(|finding| finding["source"]["path"] == "posts/unrelated.md"));
    }

    #[test]
    fn preview_evidence_is_scoped_to_the_current_research_document() {
        let f = fixture("preview-evidence");
        fs::write(
            f.dir.join("content/posts/unrelated.md"),
            "---\ntitle: Unrelated\ndate: 2026-10-22\nprofile: research\n---\nBody.\n",
        )
        .unwrap();
        let session = login_ok(&f);

        let preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": "posts/current.md",
                        "fields": {
                            "title": "Current",
                            "date": "2026-10-23",
                            "profile": "research",
                            "doi": "invalid"
                        },
                        "body": "<!--\n## Abstract\n## References\n-->\n\nA claim.[^missing]"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            preview.status,
            200,
            "{}",
            String::from_utf8_lossy(&preview.body)
        );
        let findings = body_json(&preview)["evidence"].as_array().unwrap().clone();

        assert!(findings.iter().any(|finding| {
            finding["code"] == "doi-invalid" && finding["source"]["path"] == "posts/current.md"
        }));
        assert!(findings
            .iter()
            .any(|finding| finding["code"] == "footnote-unresolved"));
        assert!(findings
            .iter()
            .any(|finding| finding["code"] == "abstract-missing"));
        assert!(findings
            .iter()
            .any(|finding| finding["code"] == "references-missing"));
        assert_eq!(body_json(&preview)["research"]["doi"], "invalid");
        assert_eq!(body_json(&preview)["research"]["referenceCount"], 0);
        assert!(!findings
            .iter()
            .any(|finding| finding["source"]["path"] == "posts/unrelated.md"));
    }

    #[test]
    fn quiz_generation_is_authenticated_optional_and_csrf_protected() {
        let f = fixture("quiz-generate");
        let request = || {
            json_req(
                "POST",
                "/admin/api/quiz/generate",
                json!({ "context": "A short article section.", "count": 1 }),
            )
        };
        assert_eq!(handle(&f.state, &request()).status, 401);
        let session = login_ok(&f);
        assert_eq!(
            handle(&f.state, &authed(request(), &session, false)).status,
            403
        );
        let response = handle(&f.state, &authed(request(), &session, true));
        assert_eq!(response.status, 404);
        assert!(String::from_utf8_lossy(&response.body).contains("not configured"));
    }

    #[test]
    fn quiz_generation_handles_provider_boundary_failures() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("quiz-provider");
        let session = login_ok(&f);
        let request = || {
            authed(
                json_req(
                    "POST",
                    "/admin/api/quiz/generate",
                    json!({ "context": "A short article section.", "count": 1 }),
                ),
                &session,
                true,
            )
        };

        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        set_quiz_endpoint(&f, "https://example.com/generate");
        assert_eq!(handle(&f.state, &request()).status, 503, "missing secret");
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "test-secret");

        let cases = [
            (500, "{}".to_string(), Duration::ZERO, "provider status"),
            (200, "not json".to_string(), Duration::ZERO, "invalid JSON"),
            (
                200,
                json!({ "questions": [{ "prompt": "Q", "choices": ["A"], "correctIndex": 0 }] })
                    .to_string(),
                Duration::ZERO,
                "invalid schema",
            ),
            (
                200,
                "x".repeat(129 * 1024),
                Duration::ZERO,
                "oversized response",
            ),
            (200, "{}".to_string(), Duration::from_millis(600), "timeout"),
        ];
        for (status, body, delay, label) in cases {
            let (endpoint, server) = quiz_provider(status, body, delay);
            set_quiz_endpoint(&f, &endpoint);
            assert_eq!(handle(&f.state, &request()).status, 502, "{label}");
            server.join().unwrap();
        }

        let body = json!({
            "questions": [{
                "prompt": "What stays local?",
                "choices": ["Attempts", "Posts"],
                "correctIndex": 0,
                "explanation": "Reader attempts stay local."
            }]
        })
        .to_string();
        let (endpoint, server) = quiz_provider(200, body, Duration::ZERO);
        set_quiz_endpoint(&f, &endpoint);
        let response = handle(&f.state, &request());
        server.join().unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(body_json(&response)["questions"][0]["correctIndex"], 0);
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
        let when = DateTime::from_unix(clock::now().unix() + 5).rfc3339();
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
        std::thread::sleep(Duration::from_millis(6500));
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
    fn contributor_registry_edits_are_validated_conflict_safe_and_reference_aware() {
        let f = fixture("contributor-registry");
        let config_path = f.dir.join("openblog.json");
        let mut config: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["futureSetting"] = json!({ "keep": true });
        config["author"] = json!({
            "name": "Legacy Author",
            "url": "/about/",
            "sameAs": ["https://example.com/legacy"]
        });
        config["contributors"] = json!({ "ada": { "name": "Ada" } });
        fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
        fs::write(
            f.dir.join("content/posts/hello-world.credits.json"),
            r#"{"version":1,"credits":[{"contributor":"ada","roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
        )
        .unwrap();
        let session = login_ok(&f);

        let registry = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/contributors"), &session, false),
        ));
        assert_eq!(registry["contributors"]["ada"]["name"], "Ada");
        assert_eq!(registry["author"]["name"], "Legacy Author");
        let original_etag = registry["etag"].as_str().unwrap();

        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({ "etag": "stale", "contributors": registry["contributors"] }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);

        let invalid = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({ "etag": original_etag, "contributors": {
                        "Bad ID": { "name": "Bad" }
                    } }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(invalid.status, 422);

        let referenced = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({ "etag": original_etag, "contributors": {} }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(referenced.status, 422);
        assert!(
            String::from_utf8_lossy(&referenced.body).contains("posts/hello-world.credits.json")
        );

        let saved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({ "etag": original_etag, "contributors": {
                        "ada": { "name": "Ada Lovelace", "url": "/people/ada/" },
                        "grace": { "name": "Grace Hopper", "orcid": "0000-0002-1825-0097" }
                    } }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            saved.status,
            200,
            "{}",
            String::from_utf8_lossy(&saved.body)
        );
        let saved = body_json(&saved);
        assert_eq!(saved["contributors"]["ada"]["name"], "Ada Lovelace");
        assert_eq!(
            saved["contributors"]["grace"]["orcid"],
            "https://orcid.org/0000-0002-1825-0097"
        );
        assert_eq!(
            saved["build"]["ok"],
            true,
            "{}",
            saved["build"]["error"].as_str().unwrap_or("")
        );
        assert_ne!(saved["etag"], original_etag);

        let written: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(written["futureSetting"]["keep"], true);
        assert_eq!(written["title"], config["title"]);
    }

    #[test]
    fn credit_sidecars_round_trip_preview_and_follow_post_lifecycle() {
        let f = fixture("credit-lifecycle");
        let config_path = f.dir.join("openblog.json");
        let mut config: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["contributors"] = json!({
            "ada": { "name": "Ada", "url": "/people/ada/", "orcid": "0000-0002-1825-0097" },
            "grace": { "name": "Grace" }
        });
        fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
        let session = login_ok(&f);

        let orphan = f
            .dir
            .join("content/posts/2026-01-01-orphan-collision.credits.json");
        fs::write(&orphan, r#"{"version":1,"credits":[]}"#).unwrap();
        let orphan_collision = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document",
                    json!({
                        "kind":"posts",
                        "fields":{"title":"Orphan Collision","date":"2026-01-01"},
                        "body":"Body"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(orphan_collision.status, 409);
        assert!(orphan.is_file());
        assert!(!f
            .dir
            .join("content/posts/2026-01-01-orphan-collision.md")
            .exists());
        fs::remove_file(orphan).unwrap();

        let meta = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/meta"), &session, false),
        ));
        assert_eq!(meta["contributors"]["ada"]["name"], "Ada");
        assert!(meta["creditRoles"].as_array().unwrap().iter().any(|role| {
            role["vocabulary"] == "crossref"
                && role["role"] == "author"
                && role["label"] == "Author"
        }));

        let credits = json!([
            {"contributor":"ada","roles":[
                {"vocabulary":"crossref","role":"author"},
                {"vocabulary":"credit","role":"software"}
            ]},
            {"contributor":"grace","roles":[
                {"vocabulary":"crossref","role":"editor"}
            ]}
        ]);
        let created = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document",
                    json!({
                        "kind":"posts",
                        "fields":{"title":"Credited","date":"2026-01-01"},
                        "body":"Body",
                        "credits": credits
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            created.status,
            201,
            "{}",
            String::from_utf8_lossy(&created.body)
        );
        let created = body_json(&created);
        let rel = created["path"].as_str().unwrap();
        let sidecar = f.dir.join("content/posts/2026-01-01-credited.credits.json");
        assert!(sidecar.is_file());
        assert!(created["creditEtag"].as_str().is_some());
        assert!(
            fs::read_to_string(f.dir.join("dist/posts/credited/index.html"))
                .unwrap()
                .contains("ob-contributions")
        );
        let listed = body_json(&handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/documents?kind=posts"),
                &session,
                false,
            ),
        ));
        let listed_post = listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["path"] == rel)
            .unwrap();
        assert_eq!(listed_post["creditMode"], "explicit");

        let fetched = body_json(&handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/document?path={rel}")),
                &session,
                false,
            ),
        ));
        assert_eq!(fetched["credits"], credits);
        let markdown_etag = fetched["etag"].as_str().unwrap();
        let credit_etag = fetched["creditEtag"].as_str().unwrap();

        // Omitting `credits` preserves the sidecar for older Admin clients.
        let preserved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/document?path={rel}"),
                    json!({"fields":fetched["fields"],"body":"Edited","etag":markdown_etag}),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(preserved.status, 200);
        assert!(sidecar.is_file());

        let refreshed = body_json(&handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/document?path={rel}")),
                &session,
                false,
            ),
        ));
        let before_markdown = fs::read_to_string(f.dir.join("content").join(rel)).unwrap();
        let before_sidecar = fs::read_to_string(&sidecar).unwrap();
        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/document?path={rel}"),
                    json!({
                        "fields":refreshed["fields"],"body":"Should not save",
                        "etag":refreshed["etag"],"credits":null,"creditEtag":"stale"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);
        assert_eq!(
            fs::read_to_string(f.dir.join("content").join(rel)).unwrap(),
            before_markdown
        );
        assert_eq!(fs::read_to_string(&sidecar).unwrap(), before_sidecar);

        let invalid = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/document?path={rel}"),
                    json!({
                        "fields":refreshed["fields"],"body":"Should not save",
                        "etag":refreshed["etag"],
                        "credits":[{"contributor":"missing","roles":[{"vocabulary":"crossref","role":"author"}]}],
                        "creditEtag":credit_etag
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(invalid.status, 422);
        assert_eq!(
            fs::read_to_string(f.dir.join("content").join(rel)).unwrap(),
            before_markdown
        );
        assert_eq!(fs::read_to_string(&sidecar).unwrap(), before_sidecar);

        let preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind":"posts","path":rel,"fields":refreshed["fields"],
                        "body":"Preview","credits":[{"contributor":"grace","roles":[{"vocabulary":"crossref","role":"author"}]}]
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            preview.status,
            200,
            "{}",
            String::from_utf8_lossy(&preview.body)
        );
        let preview_url = body_json(&preview)["previewUrl"]
            .as_str()
            .unwrap()
            .to_string();
        let preview_doc = handle(&f.state, &authed(req("GET", &preview_url), &session, false));
        assert!(String::from_utf8_lossy(&preview_doc.body)
            .contains("By <span class=\"p-author h-card\">Grace</span>"));

        let removed = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/document?path={rel}"),
                    json!({
                        "fields":refreshed["fields"],"body":"Inherited",
                        "etag":refreshed["etag"],"credits":null,"creditEtag":credit_etag
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            removed.status,
            200,
            "{}",
            String::from_utf8_lossy(&removed.body)
        );
        assert!(!sidecar.exists());

        let after_remove = body_json(&handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/document?path={rel}")),
                &session,
                false,
            ),
        ));
        assert!(after_remove["credits"].is_null());
        let explicit_empty = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/document?path={rel}"),
                    json!({
                        "fields":after_remove["fields"],"body":"Anonymous",
                        "etag":after_remove["etag"],"credits":[],"creditEtag":null
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(explicit_empty.status, 200);
        assert!(sidecar.is_file());

        let deleted = handle(
            &f.state,
            &authed(
                req("DELETE", &format!("/admin/api/document?path={rel}")),
                &session,
                true,
            ),
        );
        assert_eq!(deleted.status, 200);
        assert!(!sidecar.exists());
        assert!(body_json(&deleted)["trashedCreditsTo"].as_str().is_some());
        assert_eq!(
            fs::read_dir(f.dir.join(".openblog/trash")).unwrap().count(),
            2
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
    fn admin_validation_and_listing_surface_matching_sidecar_errors() {
        let f = fixture("credit-sidecar-errors");
        let posts_dir = f.dir.join("content/posts");
        let markdown = fs::read_dir(&posts_dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|extension| extension == "md"))
            .unwrap();
        let file_name = markdown.file_name().unwrap().to_string_lossy();
        let rel = format!("posts/{file_name}");
        let sidecar = markdown.with_extension("credits.json");
        fs::write(
            &sidecar,
            r#"{"version":1,"credits":[{"contributor":"missing","roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
        )
        .unwrap();

        let config = site::load_config(&f.dir).unwrap();
        let source = fs::read_to_string(&markdown).unwrap();
        let problems =
            validate_candidate(&f.dir, &config, &rel, &source, &CreditEdit::Unchanged).unwrap_err();
        assert!(problems.iter().any(|problem| {
            problem.contains(".credits.json") && problem.contains("unknown contributor `missing`")
        }));

        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/documents?kind=posts"),
                &session,
                false,
            ),
        );
        assert_eq!(response.status, 200);
        let list = body_json(&response);
        let item = list["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["path"] == rel)
            .unwrap();
        assert_eq!(item["status"], "error");
        assert_eq!(item["creditMode"], "explicit");
        assert!(item["error"]
            .as_str()
            .unwrap()
            .contains("unknown contributor `missing`"));

        fs::write(
            posts_dir.join("inherited-error.md"),
            "---\ndate: 2026-01-01\n---\nBody",
        )
        .unwrap();
        let response = handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/documents?kind=posts"),
                &session,
                false,
            ),
        );
        let list = body_json(&response);
        let inherited = list["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["path"] == "posts/inherited-error.md")
            .unwrap();
        assert_eq!(inherited["status"], "error");
        assert_eq!(inherited["creditMode"], "inherited");
    }

    #[test]
    fn admin_listing_rejects_ambiguous_credit_sidecar_ownership() {
        let f = fixture("credit-sidecar-collision");
        let posts = f.dir.join("content/posts");
        fs::write(
            posts.join("study.md"),
            "---\ntitle: MD study\nslug: md-study\ndate: 2026-01-01\n---\nBody",
        )
        .unwrap();
        fs::write(
            posts.join("study.markdown"),
            "---\ntitle: Markdown study\nslug: markdown-study\ndate: 2026-01-01\n---\nBody",
        )
        .unwrap();
        fs::write(
            posts.join("study.credits.json"),
            r#"{"version":1,"credits":[]}"#,
        )
        .unwrap();

        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/documents?kind=posts"),
                &session,
                false,
            ),
        );
        assert_eq!(response.status, 200);
        let list = body_json(&response);
        for path in ["posts/study.md", "posts/study.markdown"] {
            let item = list["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["path"] == path)
                .unwrap();
            assert_eq!(item["status"], "error");
            assert_eq!(item["creditMode"], "explicit");
            assert!(item["error"]
                .as_str()
                .unwrap()
                .contains("ambiguous credit sidecar target"));
        }
    }

    #[test]
    fn malformed_credit_sidecars_can_be_opened_and_removed_safely() {
        let f = fixture("malformed-credit-repair");
        let posts_dir = f.dir.join("content/posts");
        let markdown = fs::read_dir(&posts_dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|extension| extension == "md"))
            .unwrap();
        let rel = format!("posts/{}", markdown.file_name().unwrap().to_string_lossy());
        let sidecar = markdown.with_extension("credits.json");
        let session = login_ok(&f);
        let mut last = Json::Null;
        for (malformed, keeps_editable_credits) in [
            (b"{".to_vec(), false),
            (br#"{"version":2,"credits":[]}"#.to_vec(), false),
            (br#"{"version":1,"credits":{}}"#.to_vec(), false),
            (
                br#"{"version":1,"credits":[{"contributor":"missing","roles":[{"vocabulary":"crossref","role":"author"}]}]}"#.to_vec(),
                true,
            ),
            (vec![0xff, 0xfe], false),
        ] {
            fs::write(&sidecar, malformed).unwrap();
            let response = handle(
                &f.state,
                &authed(
                    req("GET", &format!("/admin/api/document?path={rel}")),
                    &session,
                    false,
                ),
            );
            assert_eq!(response.status, 200);
            last = body_json(&response);
            assert_eq!(last["credits"].is_array(), keeps_editable_credits);
            assert!(last["creditEtag"].as_str().is_some());
            assert!(last["creditError"].as_str().is_some());
        }

        let listing = handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/documents?kind=posts"),
                &session,
                false,
            ),
        );
        assert_eq!(listing.status, 200);
        let listing = body_json(&listing);
        let item = listing["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["path"] == rel)
            .unwrap();
        assert_eq!(item["status"], "error");
        assert_eq!(item["creditMode"], "explicit");

        let repaired = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/document?path={rel}"),
                    json!({
                        "fields":last["fields"], "body":last["body"], "etag":last["etag"],
                        "credits":null, "creditEtag":last["creditEtag"]
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            repaired.status,
            200,
            "{}",
            String::from_utf8_lossy(&repaired.body)
        );
        assert!(!sidecar.exists());
    }

    #[cfg(unix)]
    #[test]
    fn document_get_rejects_credit_sidecar_symlinks() {
        use std::os::unix::fs::symlink;

        let f = fixture("credit-sidecar-symlink");
        let markdown = fs::read_dir(f.dir.join("content/posts"))
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|extension| extension == "md"))
            .unwrap();
        let rel = format!("posts/{}", markdown.file_name().unwrap().to_string_lossy());
        let outside = f.dir.join("outside-credits.json");
        fs::write(&outside, r#"{"version":1,"credits":[]}"#).unwrap();
        symlink(&outside, markdown.with_extension("credits.json")).unwrap();
        let session = login_ok(&f);

        let response = handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/document?path={rel}")),
                &session,
                false,
            ),
        );
        assert_eq!(response.status, 400);
        assert!(String::from_utf8_lossy(&response.body).contains("symlinks are not allowed"));
    }

    #[test]
    fn paired_credit_write_rolls_back_when_the_second_mutation_fails() {
        let f = fixture("credit-write-rollback");
        let markdown = f.dir.join("content/posts/rollback.md");
        let sidecar = f.dir.join("content/posts/rollback.credits.json");
        fs::write(&markdown, "original document").unwrap();
        fs::write(&sidecar, [0xff, 0xfe]).unwrap();
        let edit = CreditEdit::Set(r#"{"version":1,"credits":[]}"#.into());

        let error = write_document_with_credits_using(
            &markdown,
            &sidecar,
            "replacement document",
            &edit,
            |_, _| Err("injected sidecar failure".into()),
        )
        .unwrap_err();

        assert!(error.contains("injected sidecar failure"));
        assert_eq!(fs::read(&markdown).unwrap(), b"original document");
        assert_eq!(fs::read(&sidecar).unwrap(), [0xff, 0xfe]);
    }

    #[test]
    fn document_reads_wait_for_the_content_transaction() {
        let f = fixture("credit-read-transaction");
        let session = login_ok(&f);
        let rel = fs::read_dir(f.dir.join("content/posts"))
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .find(|name| name.ends_with(".md"))
            .map(|name| format!("posts/{name}"))
            .unwrap();
        let request = authed(
            req("GET", &format!("/admin/api/document?path={rel}")),
            &session,
            false,
        );
        let transaction = lock(&f.state.build);
        let state = Arc::clone(&f.state);
        let (sender, receiver) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            sender.send(handle(&state, &request).status).unwrap();
        });
        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        drop(transaction);
        assert_eq!(receiver.recv_timeout(Duration::from_secs(2)).unwrap(), 200);
        reader.join().unwrap();

        let transaction = lock(&f.state.build);
        let state = Arc::clone(&f.state);
        let request = authed(req("GET", "/admin/api/meta"), &session, false);
        let (sender, receiver) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            sender.send(handle(&state, &request).status).unwrap();
        });
        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        drop(transaction);
        assert_eq!(receiver.recv_timeout(Duration::from_secs(2)).unwrap(), 200);
        reader.join().unwrap();
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
    fn logout_ends_the_session_and_preview_uses_the_publishing_engine() {
        let f = fixture("logout");
        let session = login_ok(&f);
        fs::write(
            f.dir.join("content/series/guides.md"),
            "---\nname: Guides\nslug: guides\ntheme: paper\n---\nA guided path.",
        )
        .unwrap();
        fs::write(
            f.dir.join("content/posts/hidden-draft.md"),
            "---\ntitle: Hidden sibling\ndate: 2026-01-01\ndraft: true\nseries: guides\n---\nPrivate.",
        )
        .unwrap();
        fs::write(
            f.dir.join("content/posts/future-sibling.md"),
            "---\ntitle: Future sibling\ndate: 2099-01-01\nseries: guides\n---\nNot yet.",
        )
        .unwrap();
        let prev = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": "posts/preview.md",
                        "fields": {
                            "title": "Preview title",
                            "date": "2026-01-01",
                            "description": "A complete preview description for search and social cards.",
                            "draft": "true",
                            "series": "guides",
                            "tags": ["preview"]
                        },
                        "body": "## Hi\n\ntext"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(prev.status, 200, "{}", String::from_utf8_lossy(&prev.body));
        let preview = body_json(&prev);
        assert_eq!(preview["theme"], "paper");
        assert_eq!(preview["url"], "/posts/preview/");
        assert_eq!(preview["social"]["title"], "Preview title");
        assert_eq!(
            preview["social"]["description"],
            "A complete preview description for search and social cards."
        );
        assert_eq!(preview["social"]["type"], "article");
        assert_eq!(preview["social"]["card"], "summary");
        assert!(preview["social"]["url"]
            .as_str()
            .unwrap()
            .ends_with("/posts/preview/"));
        let blank = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": "posts/blank.md",
                        "fields": { "title": "Blank", "date": "2026-01-01" },
                        "body": ""
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(blank.status, 200);
        assert_eq!(body_json(&blank)["social"]["description"], "");
        let preview_url = preview["previewUrl"].as_str().unwrap();
        let document = handle(&f.state, &authed(req("GET", preview_url), &session, false));
        assert_eq!(document.status, 200);
        let html = String::from_utf8_lossy(&document.body);
        assert!(html.contains("<article") && html.contains("Preview title"));
        assert!(html.contains("/themes/paper/tokens.css"));
        assert!(html.contains("property=\"og:title\"") && html.contains("<h2"));
        assert!(!html.contains("Hidden sibling") && !html.contains("Future sibling"));
        assert!(
            !html.contains("series: guides"),
            "front matter is never rendered"
        );
        assert!(document.headers.iter().any(|(name, value)| {
            name == "Content-Security-Policy" && value.contains("script-src 'unsafe-inline'")
        }));
        assert!(document
            .headers
            .iter()
            .any(|(name, value)| name == "X-Frame-Options" && value == "SAMEORIGIN"));
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

        let mut crawler = req("GET", "/posts/hello-world");
        crawler.headers.insert(
            "user-agent".into(),
            "Mozilla/5.0; compatible; OAI-SearchBot/1.4".into(),
        );
        assert_eq!(crate::serve::route(&f.state, &crawler, &dist).status, 200);
        let mut user_agent = req("GET", "/llms.txt");
        user_agent
            .headers
            .insert("user-agent".into(), "ChatGPT-User/1.0".into());
        assert_eq!(
            crate::serve::route(&f.state, &user_agent, &dist).status,
            200
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
        assert_eq!(dash["agentRequests"], 2);
        assert_eq!(dash["agents"][0]["requests"], 1);
        assert!(dash["agentPages"].as_array().unwrap().iter().any(|page| {
            page["path"] == "/posts/hello-world/"
                && page["requests"] == 1
                && page["agents"][0] == "OAI-SearchBot"
        }));

        // Flushing writes a file that holds counts but no visitor data.
        f.state.flush_analytics().unwrap();
        let text = fs::read_to_string(f.dir.join(".openblog/analytics.json")).unwrap();
        assert!(
            text.contains("/posts/hello-world/")
                && !text.contains("Mozilla")
                && !text.contains("OAI-SearchBot/1.4")
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
    fn only_versioned_assets_are_cached_long() {
        let f = fixture("cache");
        let dist = f.dir.join("dist");
        let header = |path: &str| {
            let resp = crate::serve::route(&f.state, &req("GET", path), &dist);
            assert_eq!(resp.status, 200, "{path}");
            resp.headers
                .iter()
                .find(|(k, _)| k == "Cache-Control")
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };
        assert!(header("/assets/base.css?v=abc").starts_with("public, max-age="));
        assert_eq!(
            header("/assets/base.css"),
            "no-cache",
            "unversioned assets revalidate"
        );
        assert_eq!(
            header("/assets/components/ob-code.js"),
            "no-cache",
            "modules imported by other scripts revalidate"
        );
        assert_eq!(header("/"), "no-cache");
        // The built pages reference versioned assets.
        let home = fs::read_to_string(dist.join("index.html")).unwrap();
        assert!(
            home.contains("href=\"/assets/base.css?v="),
            "{}",
            &home[..home.len().min(1500)]
        );
    }

    #[test]
    fn health_route_answers_without_a_session() {
        let f = fixture("health");
        let resp = crate::serve::route(&f.state, &req("GET", "/health"), &f.dir.join("dist"));
        assert_eq!(resp.status, 200);
        assert_eq!(body_json(&resp)["ok"], true);
        assert_eq!(
            crate::serve::route(&f.state, &req("POST", "/health"), &f.dir.join("dist")).status,
            405
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
        assert!(String::from_utf8_lossy(&resp.body)
            .contains("<meta name=\"color-scheme\" content=\"light dark\">"));
        let script = handle(&f.state, &req("GET", "/admin/admin.js"));
        assert_eq!(script.status, 200);
        let script = String::from_utf8_lossy(&script.body);
        assert!(script.contains("ob-admin-scheme"));
        assert!(script.contains("Dark mode"));
        let styles = handle(&f.state, &req("GET", "/admin/admin.css"));
        assert_eq!(styles.status, 200);
        assert!(String::from_utf8_lossy(&styles.body).contains(".oba-theme-toggle"));
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/secrets.txt")).status,
            404
        );
    }

    #[test]
    fn admin_page_serves_public_styles_when_the_site_has_a_base_path() {
        let f = fixture("page-base-path");
        let config_path = f.dir.join("openblog.json");
        let mut config: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["url"] = json!("https://example.com/blog/");
        fs::write(&config_path, serde_json::to_vec_pretty(&config).unwrap()).unwrap();

        let state = AppState::new(f.dir.clone(), None, false, true);
        let response = handle(&state, &req("GET", "/admin"));
        assert_eq!(response.status, 200);
        let body = String::from_utf8(response.body).unwrap();
        assert!(body.contains("href=\"/assets/base.css\""), "{body}");
        assert!(body.contains("href=\"/themes/base/tokens.css\""), "{body}");

        for path in ["/assets/base.css", "/themes/base/tokens.css"] {
            let stylesheet = crate::serve::route(&state, &req("GET", path), &f.dir.join("dist"));
            assert_eq!(stylesheet.status, 200, "{path}");
            assert!(stylesheet
                .headers
                .iter()
                .any(|(name, value)| name == "Content-Type" && value.starts_with("text/css")));
        }
    }
}

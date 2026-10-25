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

use blake2::{Blake2s256, Digest};
use openblog_core::accessibility::AuditScope;
use openblog_core::config::{AssistantProviderKind, SyndicationProvider};
use openblog_core::frontmatter::{self, Value};
use openblog_core::markdown::RenderOptions;
use openblog_core::portability::{destination_policy, DestinationRepresentation};
use openblog_core::slug::slugify;
use openblog_core::source_interchange::{self, plan_csl_import};
use openblog_core::source_library::{SourceDiagnostic, SourceRecord};
use openblog_core::{
    generate, generate_document, social_metadata, DateTime, LoadOptions, Site, SiteConfig,
    SourceFile,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

use crate::admin_preferences::{self, Preferences, SaveError};
use crate::assistant::{
    parse_skill, AnthropicProvider, AssistantCompletionSource, AssistantConcurrency,
    AssistantDocument, AssistantErrorKind, AssistantProvider, AssistantProviderStatus,
    AssistantRequest, AssistantResult, CodeInteractionKind, CodeInteractionLanguage,
    GenericHttpsProvider, KnowledgeCheckCount, NativeProvider, NativeProviderKind, ReviewContext,
    ReviewSkill, SkillDefinition, SkillOutputKind, SkillScope, ASSISTANT_SCHEMA_VERSION,
    BUILTIN_SKILL_SOURCES,
};
use crate::auth::{self, Sessions, Throttle, Users};
use crate::clock;
use crate::fsutil;
use crate::http::{Request, Response};
use crate::site::{self, BuildOptions, BuildReport};
use crate::source_store::{self, StoreError};

pub const SESSION_COOKIE: &str = "ob_session";
pub(crate) const CODE_RUNNER_LANGUAGE_PATH: &str = "/components/ob-code-runner-language.js";
const CODE_RUNNER_LANGUAGE_ASSET: &str = "components/ob-code-runner-language.js";
const MAX_JSON_BODY: usize = 2 * 1024 * 1024 + 64 * 1024;
const MAX_LOGIN_BODY: usize = 4 * 1024;
const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_SKILL_BYTES: usize = 256 * 1024;
const MAX_ASSISTANT_CONTEXT_BYTES: usize = 64 * 1024;
/// Largest accepted source create, update, or archive request.
const MAX_SOURCE_REQUEST_BYTES: usize = 256 * 1024;
const MAX_SOURCE_IMPORT_BYTES: usize = 3 * 1024 * 1024;
const MAX_PORTABILITY_ACKNOWLEDGEMENTS: usize = 500;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortabilityAcknowledgement {
    source_revision: String,
    capability_id: String,
    representation: String,
    destination: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PortabilityAcknowledgementSidecar {
    version: u32,
    acknowledgements: Vec<PortabilityAcknowledgement>,
}

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
    /// Serializes durable acknowledgements, including background publishing.
    pub workspace: Mutex<Option<crate::workspace::Workspace>>,
    pub workspace_enabled: bool,
    /// Bounds simultaneous paid provider calls across quiz and review APIs.
    assistant_operations: AssistantConcurrency,
    /// Last analytics backup to the branch, as a unix time.
    pub last_backup: Mutex<i64>,
    /// Small, bounded cache of generated documents served into sandboxed previews.
    previews: Mutex<Vec<PreviewDocument>>,
    portability_acknowledgements: Mutex<()>,
}

/// The server registers its `Arc<AppState>` here so request handlers, which
/// only hold `&AppState`, can hand a clone to background work.
static SHARED: std::sync::OnceLock<Mutex<Vec<Arc<AppState>>>> = std::sync::OnceLock::new();

thread_local! {
    static DURABLE_TRANSACTION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

struct DurableTransaction;

impl Drop for DurableTransaction {
    fn drop(&mut self) {
        DURABLE_TRANSACTION.with(|active| active.set(false));
    }
}

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
            workspace: Mutex::new(None),
            workspace_enabled: false,
            assistant_operations: AssistantConcurrency::new(2),
            last_backup: Mutex::new(0),
            previews: Mutex::new(Vec::new()),
            portability_acknowledgements: Mutex::new(()),
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
        if !site::load_config(&self.root)
            .unwrap_or_default()
            .publish
            .auto
        {
            return;
        }
        let state = Arc::clone(self);
        std::thread::spawn(move || {
            let mut workspace = lock(&state.workspace);
            if let Some(store) = workspace.as_mut() {
                if let Err(error) = store.begin() {
                    eprintln!("auto-publish blocked by workspace persistence: {error}");
                    return;
                }
            }
            let _publish = lock(&state.publish_lock);
            let _content_transaction = lock(&state.build);
            let _filesystem_transaction =
                match crate::transaction::ContentTransactionLock::acquire_with_wait(
                    &state.root,
                    Duration::from_secs(30),
                ) {
                    Ok(lock) => lock,
                    Err(error) => {
                        eprintln!("auto-publish skipped after waiting for another writer: {error}");
                        return;
                    }
                };
            let config = site::load_config(&state.root).unwrap_or_default();
            if !config.publish.auto {
                return;
            }
            if workspace.is_some()
                && !crate::git::Git::new(&state.root).has_remote(&config.publish.remote)
            {
                eprintln!(
                    "auto-publish blocked: durable workspace publishing requires a Git remote"
                );
                return;
            }
            match crate::publish::publish(&state.root, &config, Some(&summary)) {
                Ok(outcome) => {
                    if let Some(store) = workspace.as_mut() {
                        if outcome.pushed {
                            if let Err(error) = store.published(&state.root) {
                                eprintln!("publish succeeded but workspace acknowledgement failed: {error}");
                                return;
                            }
                        }
                        if let Err(error) = store.save(&state.root) {
                            eprintln!("publish workspace persistence failed: {error}");
                            return;
                        }
                    }
                    eprintln!("publish: {}", outcome.message);
                }
                Err(e) => {
                    if let Some(store) = workspace.as_mut() {
                        if let Err(error) = store.save(&state.root) {
                            eprintln!(
                                "publish failed ({e}); workspace persistence also failed: {error}"
                            );
                            return;
                        }
                    }
                    eprintln!("publish failed: {e}");
                }
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
    if path == CODE_RUNNER_LANGUAGE_PATH {
        let config = site::load_config(&state.root).unwrap_or_default();
        return match site::web_file(&state.root, &config, CODE_RUNNER_LANGUAGE_ASSET) {
            Some(bytes) => Response::new(200, "text/javascript; charset=utf-8", bytes),
            None => Response::error(404, "Not found"),
        };
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
    if !state.workspace_enabled {
        return authenticated_api(state, req, name, &session);
    }
    let mut workspace = lock(&state.workspace);
    let _filesystem_transaction = if workspace.is_some() && !req.is_read_only() && name != "logout"
    {
        match crate::transaction::ContentTransactionLock::acquire(&state.root) {
            Ok(transaction) => Some(transaction),
            Err(error) => return Response::error(409, &error),
        }
    } else {
        None
    };
    let _durable_transaction = _filesystem_transaction.as_ref().map(|_| {
        DURABLE_TRANSACTION.with(|active| active.set(true));
        DurableTransaction
    });
    if !req.is_read_only() && name != "logout" {
        if let Some(store) = workspace.as_mut() {
            if let Err(error) = store.begin() {
                return Response::error(503, &format!("Workspace save NOT acknowledged: {error}"));
            }
        }
    }
    let response = authenticated_api(state, req, name, &session);
    if !req.is_read_only() && name != "logout" {
        if let Some(store) = workspace.as_mut() {
            // Even an unsuccessful handler may have completed part of a local
            // operation. Never acknowledge any result until the bundle is durable.
            let published = name == "publish"
                && response.status < 300
                && serde_json::from_slice::<Json>(&response.body)
                    .is_ok_and(|body| body["pushed"] == true);
            let result = if published {
                store.published(&state.root)
            } else {
                Ok(())
            }
            .and_then(|_| store.save(&state.root));
            if let Err(error) = result {
                return Response::error(503, &format!(
                    "Workspace save NOT acknowledged; local changes may exist. Writes are blocked; reconcile/restart before retrying. {error}"
                ));
            }
        }
    }
    response
}

fn authenticated_api(
    state: &AppState,
    req: &Request,
    name: &str,
    session: &auth::Session,
) -> Response {
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
        ("GET", "preferences") => admin_preferences(state, &session.user),
        ("PUT", "preferences") => save_admin_preferences(state, req, &session.user),
        ("GET", "sources") => list_sources(state),
        ("POST", "sources") => save_source(state, req, true),
        ("PUT", "sources") => save_source(state, req, false),
        ("POST", "sources/archive") => archive_source(state, req),
        ("POST", "sources/import") => import_sources(state, req),
        ("GET", "sources/export") => export_sources(state, req),
        ("GET", "assistant/status") => assistant_status(state),
        ("GET", "assistant/settings") => assistant_settings(state),
        ("PUT", "assistant/settings") => save_assistant_settings(state, req),
        ("GET", "engagement/settings") => engagement_settings(state),
        ("PUT", "engagement/settings") => save_engagement_settings(state, req),
        ("GET", "engagement/analytics") => hosted_engagement_request(state, req, "admin/analytics"),
        ("GET", "engagement/comments") => hosted_engagement_request(state, req, "admin/comments"),
        ("PATCH", "engagement/comments") => hosted_engagement_request(state, req, "admin/comments"),
        ("POST", "assistant/review") => generate_document_review(state, req),
        ("POST", "assistant/complete") => generate_inline_completion(state, req),
        ("POST", "assistant/code-interaction") => generate_code_interaction(state, req),
        ("GET", "assistant/skills") => assistant_skills(state),
        ("POST", "assistant/skill") => create_assistant_skill(state, req),
        ("PUT", "assistant/skill") => update_assistant_skill(state, req),
        ("GET", "assistant/context") => assistant_context_catalog(state, req),
        ("PUT", "assistant/context") => save_assistant_context(state, req),
        ("DELETE", "assistant/context") => delete_assistant_context(state, req),
        ("POST", "assistant/reference") => create_assistant_reference(state, req),
        ("DELETE", "assistant/reference") => delete_assistant_reference(state, req),
        ("POST", "assistant/context/url/retrieve") => retrieve_url_context(req),
        ("POST", "assistant/context/url/save") => save_url_context(state, req),
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
        ("POST", "document/rename") => rename_document(state, req),
        ("DELETE", "document") => delete_document(state, req),
        ("POST", "upload") => upload(state, req),
        ("POST", "track-upload") => upload_track(state, req),
        ("DELETE", "track-upload") => discard_track(state, req),
        ("POST", "preview") => preview(state, req),
        ("POST", "portability/acknowledge") => acknowledge_portability(state, req),
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
            let _publish = lock(&state.publish_lock);
            let _content_transaction = lock(&state.build);
            let _filesystem_transaction = match content_transaction(state) {
                Ok(lock) => lock,
                Err(response) => return response,
            };
            let config = site::load_config(&state.root).unwrap_or_default();
            if state.workspace_enabled
                && !crate::git::Git::new(&state.root).has_remote(&config.publish.remote)
            {
                return Response::error(409, "Durable workspace publishing requires a Git remote; a local-only commit is not a durable publication");
            }
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

fn admin_preferences(state: &AppState, user: &str) -> Response {
    match admin_preferences::load(&state.root, user) {
        Ok(snapshot) => Response::json(200, &serde_json::to_value(snapshot).unwrap_or(Json::Null)),
        Err(error) => Response::error(500, &error),
    }
}

fn save_admin_preferences(state: &AppState, req: &Request, user: &str) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > admin_preferences::MAX_REQUEST_BYTES {
        return Response::error(413, "Workspace preferences are limited to 16 KiB");
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let Some(expected_etag) = body["etag"].as_str() else {
        return Response::error(400, "Missing preferences ETag");
    };
    let preferences: Preferences = match serde_json::from_value(body["preferences"].clone()) {
        Ok(preferences) => preferences,
        Err(error) => return Response::error(400, &format!("Invalid preferences: {error}")),
    };

    let _content_transaction = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    match admin_preferences::save(&state.root, user, expected_etag, preferences) {
        Ok(snapshot) => Response::json(200, &serde_json::to_value(snapshot).unwrap_or(Json::Null)),
        Err(SaveError::Conflict) => Response::error(
            409,
            "Workspace preferences changed in another session. Reload and try again.",
        ),
        Err(SaveError::Invalid(error)) => Response::error(400, &error),
        Err(SaveError::Storage(error)) => Response::error(500, &error),
    }
}

// ---------------------------------------------------------------------------
// Research source library
// ---------------------------------------------------------------------------

/// The private library holds author research; every response names the file
/// it came from so a damaged library can be repaired by hand.
fn source_contributors(
    state: &AppState,
) -> BTreeMap<String, openblog_core::contributor::Contributor> {
    site::load_config(&state.root)
        .unwrap_or_default()
        .contributors
}

fn list_sources(state: &AppState) -> Response {
    match source_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => Response::json(
            200,
            &json!({
                "file": source_store::LIBRARY_FILE,
                "revision": snapshot.revision,
                "stored": snapshot.stored,
                "sources": snapshot.library.sources,
            }),
        ),
        Err(error) => source_store_error(state, error, None),
    }
}

/// Read a change request: JSON, bounded, and naming the revision it was based on.
fn source_request(req: &Request) -> Result<(Json, String), Response> {
    require_json(req)?;
    if req.body.len() > MAX_SOURCE_REQUEST_BYTES {
        return Err(Response::error(
            413,
            "A source change is limited to 256 KiB",
        ));
    }
    let body: Json =
        serde_json::from_slice(&req.body).map_err(|_| Response::error(400, "Invalid JSON"))?;
    let Some(revision) = body["revision"].as_str().map(str::to_string) else {
        return Err(Response::error(400, "Missing library revision"));
    };
    Ok((body, revision))
}

/// Create (`POST`) or update (`PUT`) one source from its full JSON record.
fn save_source(state: &AppState, req: &Request, create: bool) -> Response {
    let (body, revision) = match source_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let record = match SourceRecord::from_json(body["source"].clone()) {
        Ok(record) => record,
        Err(diagnostics) => return source_diagnostics(diagnostics),
    };
    let id = record.id.clone();
    let contributors = source_contributors(state);
    let saved = if create {
        source_store::create(&state.root, &revision, record, &contributors)
    } else {
        source_store::update(&state.root, &revision, record, &contributors)
    };
    match saved {
        Ok(snapshot) => source_saved(if create { 201 } else { 200 }, &snapshot, &id),
        Err(error) => source_store_error(state, error, Some(&id)),
    }
}

fn archive_source(state: &AppState, req: &Request) -> Response {
    let (body, revision) = match source_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let (Some(id), Some(archived)) = (body["id"].as_str(), body["archived"].as_bool()) else {
        return Response::error(400, "Name the source id and whether it is archived");
    };
    match source_store::set_archived(
        &state.root,
        &revision,
        id,
        archived,
        &source_contributors(state),
    ) {
        Ok(snapshot) => source_saved(200, &snapshot, id),
        Err(error) => source_store_error(state, error, Some(id)),
    }
}

/// Preview (`apply: false`) or apply a CSL JSON import. The preview never
/// writes. An apply is refused whole if any item conflicts, and otherwise
/// goes through the same revision-checked, atomic store as every other change.
fn import_sources(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_SOURCE_IMPORT_BYTES {
        return Response::error(413, "A source import is limited to 3 MiB");
    }
    let Ok(body) = serde_json::from_slice::<Json>(&req.body) else {
        return Response::error(400, "Invalid JSON");
    };
    let (Some(revision), Some(content)) = (body["revision"].as_str(), body["content"].as_str())
    else {
        return Response::error(400, "Name the library revision and the CSL JSON content");
    };
    let apply = body["apply"].as_bool().unwrap_or(false);
    let contributors = source_contributors(state);
    let snapshot = match source_store::load(&state.root, &contributors) {
        Ok(snapshot) => snapshot,
        Err(error) => return source_store_error(state, error, None),
    };
    if snapshot.revision != revision {
        return source_store_error(state, StoreError::Conflict, None);
    }
    let plan = match plan_csl_import(&snapshot.library, content, &contributors) {
        Ok(plan) => plan,
        Err(diagnostics) => return source_diagnostics(diagnostics),
    };
    if !apply || (!plan.has_changes() && plan.is_applicable()) {
        return Response::json(
            200,
            &json!({
                "file": source_store::LIBRARY_FILE,
                "revision": snapshot.revision,
                "applied": false,
                "applicable": plan.is_applicable(),
                "plan": plan,
            }),
        );
    }
    if !plan.is_applicable() {
        let blockers = plan.blockers();
        let error = blockers.first().map_or_else(
            || "The import has conflicts".to_string(),
            ToString::to_string,
        );
        return Response::json(
            422,
            &json!({ "error": error, "file": source_store::LIBRARY_FILE, "diagnostics": blockers, "plan": plan }),
        );
    }
    match source_store::import_csl(&state.root, revision, content, &contributors) {
        Ok((saved, plan)) => Response::json(
            200,
            &json!({
                "file": source_store::LIBRARY_FILE,
                "revision": saved.revision,
                "stored": saved.stored,
                "applied": true,
                "applicable": true,
                "plan": plan,
                "sources": saved.library.sources,
            }),
        ),
        Err(error) => source_store_error(state, error, None),
    }
}

/// Export the whole library, including archived sources, as CSL JSON or
/// BibTeX. The content is deterministic for a given library revision, and
/// `losses` names everything the format could not carry.
fn export_sources(state: &AppState, req: &Request) -> Response {
    let format = req.query.get("format").map_or("csl-json", String::as_str);
    if !["csl-json", "bibtex"].contains(&format) {
        return Response::error(400, "Export format must be csl-json or bibtex");
    }
    let snapshot = match source_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => snapshot,
        Err(error) => return source_store_error(state, error, None),
    };
    let (export, filename, media_type) = if format == "bibtex" {
        (
            source_interchange::export_bibtex(&snapshot.library),
            "open-blog-sources.bib",
            "application/x-bibtex",
        )
    } else {
        (
            source_interchange::export_csl_json(&snapshot.library),
            "open-blog-sources.json",
            "application/vnd.citationstyles.csl+json",
        )
    };
    Response::json(
        200,
        &json!({
            "file": source_store::LIBRARY_FILE,
            "revision": snapshot.revision,
            "format": format,
            "filename": filename,
            "mediaType": media_type,
            "count": export.count,
            "content": export.content,
            "losses": export.losses,
        }),
    )
}

fn source_saved(status: u16, snapshot: &source_store::Snapshot, id: &str) -> Response {
    Response::json(
        status,
        &json!({
            "revision": snapshot.revision,
            "stored": snapshot.stored,
            "source": snapshot.library.get(id),
        }),
    )
}

fn source_diagnostics(diagnostics: Vec<SourceDiagnostic>) -> Response {
    let error = diagnostics.first().map_or_else(
        || "The source is invalid".to_string(),
        |first| first.to_string(),
    );
    Response::json(
        422,
        &json!({
            "error": error,
            "file": source_store::LIBRARY_FILE,
            "diagnostics": diagnostics,
        }),
    )
}

/// A conflict carries the latest revision and the newer copy of the source
/// being changed, so the editor can keep the draft and compare it. Nothing is
/// written either way.
fn source_store_error(state: &AppState, error: StoreError, id: Option<&str>) -> Response {
    match error {
        StoreError::Conflict => {
            let latest = source_store::load(&state.root, &source_contributors(state)).ok();
            let current = latest
                .as_ref()
                .zip(id)
                .and_then(|(snapshot, id)| snapshot.library.get(id));
            Response::json(
                409,
                &json!({
                    "error": error.to_string(),
                    "conflict": true,
                    "revision": latest.as_ref().map(|snapshot| snapshot.revision.as_str()),
                    "current": current,
                }),
            )
        }
        StoreError::Invalid(diagnostics) => source_diagnostics(diagnostics),
        StoreError::Storage(message) => Response::error(500, &message),
    }
}

fn content_transaction(
    state: &AppState,
) -> Result<Option<crate::transaction::ContentTransactionLock>, Response> {
    if DURABLE_TRANSACTION.with(std::cell::Cell::get) {
        return Ok(None);
    }
    crate::transaction::ContentTransactionLock::acquire(&state.root)
        .map(Some)
        .map_err(|error| Response::error(409, &error))
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

fn resolve_portability_acknowledgement_path(
    root: &Path,
    config: &SiteConfig,
    rel: &str,
) -> Result<PathBuf, String> {
    check_rel_path(rel)?;
    if openblog_core::classify_source(rel) != Some(openblog_core::SourceKind::Post) {
        return Err("portability acknowledgements are only available for posts".into());
    }
    let sidecar_rel = openblog_core::contributor::portability_sidecar_path(rel)
        .ok_or_else(|| "cannot derive the post portability sidecar path".to_string())?;
    let content_dir = root.join(&config.paths.content);
    let canonical_content = fs::canonicalize(&content_dir)
        .map_err(|_| "the content directory does not exist".to_string())?;
    let full = content_dir.join(sidecar_rel);
    if fs::symlink_metadata(&full).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("portability sidecar symlinks are not allowed".into());
    }
    let mut probe = full.as_path();
    loop {
        if probe.exists() {
            let canonical = fs::canonicalize(probe).map_err(|error| error.to_string())?;
            if !canonical.starts_with(&canonical_content) {
                return Err("portability sidecar resolves outside the content directory".into());
            }
            break;
        }
        probe = probe.parent().ok_or("invalid portability sidecar path")?;
    }
    Ok(full)
}

fn load_portability_acknowledgements(
    path: &Path,
) -> Result<(PortabilityAcknowledgementSidecar, String), String> {
    let bytes = read_optional_bytes(path)?;
    let etag = etag_bytes(bytes.as_deref().unwrap_or_default());
    let Some(bytes) = bytes else {
        return Ok((
            PortabilityAcknowledgementSidecar {
                version: 1,
                acknowledgements: Vec::new(),
            },
            etag,
        ));
    };
    if bytes.len() > 128 * 1024 {
        return Err("portability acknowledgement sidecar exceeds 128 KiB".into());
    }
    let sidecar: PortabilityAcknowledgementSidecar = serde_json::from_slice(&bytes)
        .map_err(|error| format!("cannot parse {}: {error}", path.display()))?;
    if sidecar.version != 1 || sidecar.acknowledgements.len() > MAX_PORTABILITY_ACKNOWLEDGEMENTS {
        return Err(
            "portability acknowledgement sidecar has an unsupported version or size".into(),
        );
    }
    for acknowledgement in &sidecar.acknowledgements {
        validate_portability_acknowledgement(acknowledgement)?;
    }
    Ok((sidecar, etag))
}

fn validate_portability_acknowledgement(
    acknowledgement: &PortabilityAcknowledgement,
) -> Result<(), String> {
    if acknowledgement.source_revision.len() != 40
        || !acknowledgement
            .source_revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || acknowledgement.capability_id.is_empty()
        || acknowledgement.capability_id.len() > 64
        || !acknowledgement
            .capability_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || !acknowledgement_scope_supported(
            &acknowledgement.destination,
            &acknowledgement.representation,
        )
    {
        return Err("invalid portability acknowledgement scope".into());
    }
    Ok(())
}

fn acknowledgement_scope_supported(destination: &str, representation: &str) -> bool {
    match destination {
        "portable-export" => matches!(
            representation,
            "portable-html" | "portable-markdown" | "portable-text"
        ),
        "dev" | "hashnode" | "ghost" | "wordpress" | "medium" => {
            let provider = match destination {
                "dev" => SyndicationProvider::Dev,
                "hashnode" => SyndicationProvider::Hashnode,
                "ghost" => SyndicationProvider::Ghost,
                "wordpress" => SyndicationProvider::Wordpress,
                "medium" => SyndicationProvider::Medium,
                _ => return false,
            };
            let policy = destination_policy(provider);
            match policy.representation {
                DestinationRepresentation::PortableMarkdown => {
                    representation == "portable-markdown"
                }
                DestinationRepresentation::PortableHtml => representation == "portable-html",
                DestinationRepresentation::ManualMarkdown => representation == "manual-markdown",
            }
        }
        _ => false,
    }
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
    let assistant_ready = assistant_configuration_ready(
        &config,
        assistant_credential(&state.root, &config)
            .ok()
            .flatten()
            .is_some(),
    );
    let mut code_runner_languages = vec!["rust".to_string(), "web".to_string()];
    if !config.code_runner.endpoint.is_empty() {
        code_runner_languages.extend(config.code_runner.languages.iter().cloned());
    }
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
            "quizGeneration": assistant_ready,
            "codeInteractionGeneration": assistant_ready,
            "codeRunnerLanguages": code_runner_languages,
            "now": clock::now().rfc3339(),
        }),
    )
}

fn assistant_status(state: &AppState) -> Response {
    let (config, credential) = match assistant_provider_snapshot(state) {
        Ok(snapshot) => snapshot,
        Err(response) => return response,
    };
    let credential_configured = credential.is_some();
    let status = match config.knowledge_checks.provider {
        AssistantProviderKind::CustomHttps => AssistantProviderStatus::legacy_quiz(
            &config.knowledge_checks.generation_endpoint,
            &config.knowledge_checks.model,
            credential_configured,
        ),
        AssistantProviderKind::Anthropic => AssistantProviderStatus::anthropic(
            &config.knowledge_checks.model,
            credential_configured,
        ),
        provider => AssistantProviderStatus::native(
            provider.as_str(),
            &config.knowledge_checks.model,
            assistant_provider_destination(provider),
            credential_configured,
        ),
    };
    Response::json(200, &json!(status))
}

fn assistant_provider_kind(config: &SiteConfig) -> &str {
    config.knowledge_checks.provider.as_str()
}

fn assistant_credential_target(config: &SiteConfig) -> String {
    match config.knowledge_checks.provider {
        AssistantProviderKind::CustomHttps => format!(
            "custom-https:{}",
            config.knowledge_checks.generation_endpoint.trim()
        ),
        provider => provider.as_str().into(),
    }
}

#[derive(Clone, Copy)]
struct AssistantProviderDescriptor {
    environment_name: &'static str,
    destination: &'static str,
    native_kind: Option<NativeProviderKind>,
}

fn assistant_provider_descriptor(provider: AssistantProviderKind) -> AssistantProviderDescriptor {
    let descriptor = |environment_name, kind: NativeProviderKind| AssistantProviderDescriptor {
        environment_name,
        destination: kind.destination(),
        native_kind: Some(kind),
    };
    match provider {
        AssistantProviderKind::CustomHttps => AssistantProviderDescriptor {
            environment_name: "OPENBLOG_LESSONS_API_KEY",
            destination: "",
            native_kind: None,
        },
        AssistantProviderKind::Anthropic => AssistantProviderDescriptor {
            environment_name: "ANTHROPIC_API_KEY",
            destination: "https://api.anthropic.com",
            native_kind: None,
        },
        AssistantProviderKind::OpenAi => descriptor("OPENAI_API_KEY", NativeProviderKind::OpenAi),
        AssistantProviderKind::Gemini => descriptor("GEMINI_API_KEY", NativeProviderKind::Gemini),
        AssistantProviderKind::Xai => descriptor("XAI_API_KEY", NativeProviderKind::Xai),
        AssistantProviderKind::DeepSeek => {
            descriptor("DEEPSEEK_API_KEY", NativeProviderKind::DeepSeek)
        }
        AssistantProviderKind::Mistral => {
            descriptor("MISTRAL_API_KEY", NativeProviderKind::Mistral)
        }
        AssistantProviderKind::OpenRouter => {
            descriptor("OPENROUTER_API_KEY", NativeProviderKind::OpenRouter)
        }
    }
}

fn assistant_environment_name(provider: AssistantProviderKind) -> &'static str {
    assistant_provider_descriptor(provider).environment_name
}

fn assistant_provider_destination(provider: AssistantProviderKind) -> &'static str {
    assistant_provider_descriptor(provider).destination
}

fn assistant_configuration_ready(config: &SiteConfig, credential_configured: bool) -> bool {
    credential_configured
        && match config.knowledge_checks.provider {
            AssistantProviderKind::CustomHttps => !config
                .knowledge_checks
                .generation_endpoint
                .trim()
                .is_empty(),
            _ => !config.knowledge_checks.model.trim().is_empty(),
        }
}

fn assistant_provider_timeout(provider: AssistantProviderKind, test_mode: bool) -> Duration {
    if test_mode {
        return Duration::from_millis(300);
    }
    match provider {
        // Structured-output grammars can take additional time to compile on first use.
        AssistantProviderKind::Anthropic => Duration::from_secs(240),
        AssistantProviderKind::OpenAi
        | AssistantProviderKind::Gemini
        | AssistantProviderKind::Xai
        | AssistantProviderKind::DeepSeek
        | AssistantProviderKind::Mistral
        | AssistantProviderKind::OpenRouter => Duration::from_secs(120),
        AssistantProviderKind::CustomHttps => Duration::from_secs(30),
    }
}

fn configured_assistant_provider(
    config: &SiteConfig,
    credential: Option<String>,
    timeout: Duration,
) -> Result<Box<dyn AssistantProvider>, crate::assistant::AssistantError> {
    match config.knowledge_checks.provider {
        AssistantProviderKind::CustomHttps => GenericHttpsProvider::new(
            &config.knowledge_checks.generation_endpoint,
            credential,
            timeout,
            cfg!(test),
        )
        .map(|provider| Box::new(provider) as Box<dyn AssistantProvider>),
        AssistantProviderKind::Anthropic => AnthropicProvider::new(credential, timeout)
            .map(|provider| Box::new(provider) as Box<dyn AssistantProvider>),
        provider => NativeProvider::new(
            assistant_provider_descriptor(provider)
                .native_kind
                .expect("native providers have an adapter kind"),
            credential,
            timeout,
        )
        .map(|provider| Box::new(provider) as Box<dyn AssistantProvider>),
    }
}

const ASSISTANT_CREDENTIAL_FILE: &str = ".openblog/private/assistant/api-key";

fn assistant_credential_path(root: &Path) -> Result<PathBuf, String> {
    crate::assistant_storage::contained_target(root, Path::new(ASSISTANT_CREDENTIAL_FILE))
}

fn private_assistant_credential(
    root: &Path,
    config: &SiteConfig,
) -> Result<Option<String>, String> {
    let target = assistant_credential_target(config);
    Ok(
        private_assistant_credential_envelope(root)?.and_then(|(credential, _, stored_target)| {
            (stored_target.as_deref() == Some(target.as_str())).then_some(credential)
        }),
    )
}

fn private_assistant_credential_envelope(
    root: &Path,
) -> Result<Option<(String, String, Option<String>)>, String> {
    let path = assistant_credential_path(root)?;
    match fs::read(&path) {
        Ok(bytes) if bytes.len() > 32 * 1024 => {
            Err("private Assistant credential is too large".into())
        }
        Ok(bytes) => {
            let bytes = unprotect_private_credential(&bytes)?;
            if bytes.len() > 32 * 1024 {
                return Err("private Assistant credential is too large".into());
            }
            let envelope: Json = serde_json::from_slice(&bytes)
                .map_err(|_| "private Assistant credential is not valid".to_string())?;
            let credential = envelope["credential"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "private Assistant credential is not valid".to_string())?;
            let revision = envelope["revision"]
                .as_str()
                .filter(|value| {
                    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
                .ok_or_else(|| "private Assistant credential is not valid".to_string())?;
            if credential.len() > 16 * 1024 {
                return Err("private Assistant credential is too large".into());
            }
            let target = envelope["target"]
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            Ok(Some((credential.to_string(), revision.to_string(), target)))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read private Assistant credential: {error}")),
    }
}

fn assistant_credential(root: &Path, config: &SiteConfig) -> Result<Option<String>, String> {
    let environment_name = assistant_environment_name(config.knowledge_checks.provider);
    if let Ok(value) = std::env::var(environment_name) {
        let value = value.trim();
        if !value.is_empty() {
            return Ok(Some(value.to_string()));
        }
    }
    private_assistant_credential(root, config)
}

fn assistant_provider_snapshot(state: &AppState) -> Result<(SiteConfig, Option<String>), Response> {
    let _transaction = content_transaction(state)?;
    let config = site::load_config(&state.root).map_err(|error| {
        Response::error(
            500,
            &format!("Cannot read assistant configuration: {error}"),
        )
    })?;
    let credential =
        assistant_credential(&state.root, &config).map_err(|error| Response::error(500, &error))?;
    Ok((config, credential))
}

fn write_private_assistant_credential(
    path: &Path,
    credential: &str,
    target: &str,
) -> Result<(), String> {
    let revision = auth::random_token()?;
    let envelope = serde_json::to_vec(&json!({
        "credential": credential,
        "revision": revision,
        "target": target,
    }))
    .map_err(|error| format!("cannot encode private Assistant credential: {error}"))?;
    let protected = protect_private_credential(&envelope)?;
    write_private_bytes_atomic(path, &protected)
}

#[cfg(windows)]
fn protect_private_credential(value: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            null(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Windows could not protect the private Assistant credential".into());
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(protected)
}

#[cfg(windows)]
fn unprotect_private_credential(value: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(
            "Windows could not decrypt the private Assistant credential for this account".into(),
        );
    }
    let clear =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(clear)
}

#[cfg(not(windows))]
fn protect_private_credential(value: &[u8]) -> Result<Vec<u8>, String> {
    Ok(value.to_vec())
}

#[cfg(not(windows))]
fn unprotect_private_credential(value: &[u8]) -> Result<Vec<u8>, String> {
    Ok(value.to_vec())
}

fn write_private_bytes_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create private Assistant directory: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|error| format!("cannot protect private Assistant directory: {error}"))?;
        }
    }
    let temporary = path.with_extension("key.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|error| format!("cannot create private Assistant credential: {error}"))?;
        file.write_all(contents)
            .map_err(|error| format!("cannot write private Assistant credential: {error}"))?;
    }
    #[cfg(not(unix))]
    fs::write(&temporary, contents)
        .map_err(|error| format!("cannot write private Assistant credential: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("cannot replace private Assistant credential: {error}")
    })
}

fn restore_private_assistant_credential(
    path: &Path,
    previous: Option<&[u8]>,
) -> Result<(), String> {
    match previous {
        Some(contents) => write_private_bytes_atomic(path, contents),
        None if path.exists() => fs::remove_file(path)
            .map_err(|error| format!("cannot remove private Assistant credential: {error}")),
        None => Ok(()),
    }
}

fn mutation_with_rollback_error(mutation: &str, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => mutation.to_string(),
        Err(rollback) => format!("{mutation}; rollback also failed: {rollback}"),
    }
}

fn assistant_credential_summary(root: &Path, config: &SiteConfig) -> Result<Json, String> {
    let environment_name = assistant_environment_name(config.knowledge_checks.provider);
    let environment = std::env::var(environment_name).is_ok_and(|value| !value.trim().is_empty());
    let private_configured = private_assistant_credential_envelope(root)?.is_some();
    let private = private_assistant_credential(root, config)?.is_some();
    let source = if environment {
        "environment"
    } else if private {
        "private"
    } else {
        "none"
    };
    Ok(json!({
        "configured": environment || private,
        "source": source,
        "privateConfigured": private_configured,
        "environmentOverride": environment,
        "environmentName": environment_name,
        "targetMismatch": private_configured && !private,
    }))
}

fn assistant_settings_etag(root: &Path, config: &[u8]) -> Result<String, String> {
    let credential_revision = private_assistant_credential_envelope(root)?
        .map(|(_, revision, _)| revision)
        .unwrap_or_default();
    let mut digest = Blake2s256::new();
    digest.update(config);
    digest.update([0]);
    digest.update(credential_revision);
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn assistant_settings(state: &AppState) -> Response {
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let path = state.root.join(site::CONFIG_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => return Response::error(500, &format!("cannot read openblog.json: {error}")),
    };
    let config = match std::str::from_utf8(&bytes)
        .map_err(|error| error.to_string())
        .and_then(SiteConfig::from_json)
    {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let credential = match assistant_credential_summary(&state.root, &config) {
        Ok(summary) => summary,
        Err(error) => return Response::error(500, &error),
    };
    Response::json(
        200,
        &json!({
            "provider": assistant_provider_kind(&config),
            "generationEndpoint": config.knowledge_checks.generation_endpoint,
            "model": config.knowledge_checks.model,
        "etag": match assistant_settings_etag(&state.root, &bytes) {
            Ok(etag) => etag,
            Err(error) => return Response::error(500, &error),
        },
            "credential": credential,
        }),
    )
}

fn save_assistant_settings(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let provider = body["provider"].as_str().unwrap_or("custom-https").trim();
    let endpoint = body["generationEndpoint"].as_str().unwrap_or("").trim();
    let model = body["model"].as_str().unwrap_or("").trim();
    if endpoint.len() > 2048 || model.len() > 200 {
        return Response::error(422, "Assistant endpoint or model is too long");
    }
    if !matches!(
        provider,
        "custom-https"
            | "anthropic"
            | "open-ai"
            | "gemini"
            | "xai"
            | "deep-seek"
            | "mistral"
            | "open-router"
    ) {
        return Response::error(422, "Assistant provider is not supported");
    }
    if provider == "custom-https" && !endpoint.is_empty() {
        let valid = url::Url::parse(endpoint).is_ok_and(|url| {
            url.scheme() == "https"
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none()
        });
        if !valid {
            return Response::error(
                422,
                "Assistant endpoint must be an HTTPS URL without embedded credentials",
            );
        }
    }
    let action = body["credentialAction"].as_str().unwrap_or("keep");
    let replacement = body["credential"].as_str().unwrap_or("").trim();
    if !matches!(action, "keep" | "replace" | "clear") {
        return Response::error(422, "credentialAction must be keep, replace, or clear");
    }
    if action == "replace" && (replacement.is_empty() || replacement.len() > 16 * 1024) {
        return Response::error(422, "Enter a credential no larger than 16 KiB");
    }

    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let config_path = state.root.join(site::CONFIG_FILE);
    let current = match fs::read(&config_path) {
        Ok(bytes) => bytes,
        Err(error) => return Response::error(500, &format!("cannot read openblog.json: {error}")),
    };
    let current_etag = match assistant_settings_etag(&state.root, &current) {
        Ok(etag) => etag,
        Err(error) => return Response::error(500, &error),
    };
    if body["etag"].as_str() != Some(current_etag.as_str()) {
        return Response::error(
            409,
            "Assistant settings changed on disk; reload before saving",
        );
    }
    let mut value: Json = match serde_json::from_slice(&current) {
        Ok(Json::Object(object)) => Json::Object(object),
        Ok(_) => return Response::error(500, "openblog.json must contain a JSON object"),
        Err(error) => return Response::error(500, &format!("invalid openblog.json: {error}")),
    };
    let stored_endpoint = if provider == "custom-https" {
        endpoint
    } else {
        ""
    };
    value["knowledgeChecks"] = json!({
        "provider": provider,
        "generationEndpoint": stored_endpoint,
        "model": model,
    });
    let candidate = match serde_json::to_string_pretty(&value) {
        Ok(value) => format!("{value}\n"),
        Err(error) => {
            return Response::error(500, &format!("cannot serialize openblog.json: {error}"))
        }
    };
    let candidate_config = match SiteConfig::from_json(&candidate) {
        Ok(config) => config,
        Err(error) => return Response::error(422, &error),
    };
    let credential_path = match assistant_credential_path(&state.root) {
        Ok(path) => path,
        Err(error) => return Response::error(500, &error),
    };
    let previous_credential = match read_optional_bytes(&credential_path) {
        Ok(value) => value,
        Err(error) => return Response::error(500, &error),
    };
    let credential_result = match action {
        "replace" => write_private_assistant_credential(
            &credential_path,
            replacement,
            &assistant_credential_target(&candidate_config),
        ),
        "clear" if credential_path.exists() => fs::remove_file(&credential_path)
            .map_err(|error| format!("cannot clear private Assistant credential: {error}")),
        "clear" | "keep" => Ok(()),
        _ => unreachable!(),
    };
    if let Err(error) = credential_result {
        let rollback =
            restore_private_assistant_credential(&credential_path, previous_credential.as_deref());
        return Response::error(500, &mutation_with_rollback_error(&error, rollback));
    }
    if let Err(error) = write_atomic(&config_path, &candidate) {
        let rollback =
            restore_private_assistant_credential(&credential_path, previous_credential.as_deref());
        return Response::error(500, &mutation_with_rollback_error(&error, rollback));
    }
    let credential = match assistant_credential_summary(&state.root, &candidate_config) {
        Ok(summary) => summary,
        Err(error) => return Response::error(500, &error),
    };
    Response::json(
        200,
        &json!({
            "provider": provider,
            "generationEndpoint": stored_endpoint,
            "model": model,
        "etag": match assistant_settings_etag(&state.root, candidate.as_bytes()) {
            Ok(etag) => etag,
            Err(error) => return Response::error(500, &error),
        },
            "credential": credential,
        }),
    )
}

const ENGAGEMENT_CREDENTIAL_FILE: &str = ".openblog/private/engagement/api-key";
const ENGAGEMENT_ENVIRONMENT_NAME: &str = "OPENBLOG_ENGAGEMENT_API_KEY";
const ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME: &str = "OPENBLOG_ENGAGEMENT_API_ORIGIN";

fn engagement_credential_path(root: &Path) -> Result<PathBuf, String> {
    crate::assistant_storage::contained_target(root, Path::new(ENGAGEMENT_CREDENTIAL_FILE))
}

fn engagement_endpoint_origin(endpoint: &str) -> Option<String> {
    let url = url::Url::parse(endpoint).ok()?;
    (url.scheme() == "https" && url.host_str().is_some())
        .then(|| url.origin().ascii_serialization())
}

fn private_engagement_credential(root: &Path) -> Result<Option<(String, String)>, String> {
    let path = engagement_credential_path(root)?;
    match fs::read(path) {
        Ok(bytes) if bytes.len() > 32 * 1024 => {
            Err("private engagement credential is too large".into())
        }
        Ok(bytes) => {
            let bytes = unprotect_private_credential(&bytes)?;
            let envelope: Json = serde_json::from_slice(&bytes)
                .map_err(|_| "private engagement credential envelope is invalid".to_string())?;
            let credential = envelope["credential"].as_str().unwrap_or("").trim();
            let target_origin = envelope["targetOrigin"].as_str().unwrap_or("").trim();
            if credential.is_empty()
                || engagement_endpoint_origin(target_origin).as_deref() != Some(target_origin)
            {
                return Err("private engagement credential envelope is invalid".into());
            }
            Ok(Some((credential.to_string(), target_origin.to_string())))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "cannot read private engagement credential: {error}"
        )),
    }
}

fn engagement_credential(root: &Path, endpoint: &str) -> Result<Option<String>, String> {
    let target_origin = engagement_endpoint_origin(endpoint)
        .ok_or_else(|| "hosted engagement endpoint is invalid".to_string())?;
    if let Ok(value) = std::env::var(ENGAGEMENT_ENVIRONMENT_NAME) {
        if !value.trim().is_empty() {
            let bound_origin = std::env::var(ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME)
                .unwrap_or_default()
                .trim_end_matches('/')
                .to_string();
            if bound_origin != target_origin {
                return Err(format!(
                    "{ENGAGEMENT_ENVIRONMENT_NAME} is not bound to this endpoint; set {ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME} to {target_origin}"
                ));
            }
            return Ok(Some(value.trim().to_string()));
        }
    }
    match private_engagement_credential(root)? {
        Some((credential, bound_origin)) if bound_origin == target_origin => Ok(Some(credential)),
        Some(_) => Err("The saved hosted engagement token belongs to a different origin. Replace it explicitly before connecting to this endpoint.".into()),
        None => Ok(None),
    }
}

fn engagement_credential_summary(root: &Path, endpoint: &str) -> Result<Json, String> {
    let environment =
        std::env::var(ENGAGEMENT_ENVIRONMENT_NAME).is_ok_and(|value| !value.trim().is_empty());
    let private_credential = private_engagement_credential(root)?;
    let private = private_credential.is_some();
    let target_origin = engagement_endpoint_origin(endpoint).unwrap_or_default();
    let environment_bound = environment
        && std::env::var(ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME)
            .is_ok_and(|value| value.trim_end_matches('/') == target_origin);
    let private_bound = private_credential
        .as_ref()
        .is_some_and(|(_, origin)| origin == &target_origin);
    Ok(json!({
        "configured": environment_bound || (!environment && private_bound),
        "source": if environment { "environment" } else if private { "private" } else { "none" },
        "privateConfigured": private,
        "environmentOverride": environment,
        "environmentName": ENGAGEMENT_ENVIRONMENT_NAME,
        "originEnvironmentName": ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME,
        "boundToEndpoint": environment_bound || (!environment && private_bound),
    }))
}

fn engagement_settings_etag(root: &Path, config: &[u8]) -> Result<String, String> {
    let credential = read_optional_bytes(&engagement_credential_path(root)?)?.unwrap_or_default();
    let mut digest = Blake2s256::new();
    digest.update(config);
    digest.update([0]);
    digest.update(credential);
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn engagement_settings(state: &AppState) -> Response {
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let bytes = match fs::read(state.root.join(site::CONFIG_FILE)) {
        Ok(bytes) => bytes,
        Err(error) => return Response::error(500, &format!("cannot read openblog.json: {error}")),
    };
    let config = match std::str::from_utf8(&bytes)
        .map_err(|error| error.to_string())
        .and_then(SiteConfig::from_json)
    {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let credential = match engagement_credential_summary(&state.root, &config.engagement.endpoint) {
        Ok(summary) => summary,
        Err(error) => return Response::error(500, &error),
    };
    let etag = match engagement_settings_etag(&state.root, &bytes) {
        Ok(etag) => etag,
        Err(error) => return Response::error(500, &error),
    };
    Response::json(
        200,
        &json!({
            "enabled": config.engagement.enabled,
            "comments": config.engagement.comments,
            "analytics": config.engagement.analytics,
            "endpoint": config.engagement.endpoint,
            "etag": etag,
            "credential": credential,
        }),
    )
}

fn valid_engagement_endpoint(endpoint: &str) -> bool {
    url::Url::parse(endpoint).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

fn save_engagement_settings(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let enabled = body["enabled"].as_bool().unwrap_or(false);
    let comments = body["comments"].as_bool().unwrap_or(true);
    let analytics = body["analytics"].as_bool().unwrap_or(true);
    let endpoint = body["endpoint"]
        .as_str()
        .unwrap_or("")
        .trim()
        .trim_end_matches('/');
    if endpoint.len() > 2048 || (enabled && !valid_engagement_endpoint(endpoint)) {
        return Response::error(
            422,
            "Hosted endpoint must be an HTTPS URL without credentials, query, or fragment",
        );
    }
    let action = body["credentialAction"].as_str().unwrap_or("keep");
    let replacement = body["credential"].as_str().unwrap_or("").trim();
    if !matches!(action, "keep" | "replace" | "clear")
        || (action == "replace" && (replacement.is_empty() || replacement.len() > 16 * 1024))
    {
        return Response::error(
            422,
            "Choose keep, replace, or clear and provide a bounded credential when replacing",
        );
    }
    let target_origin = engagement_endpoint_origin(endpoint);
    if action == "replace" && target_origin.is_none() {
        return Response::error(422, "Enter a valid HTTPS endpoint before saving a token");
    }
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let config_path = state.root.join(site::CONFIG_FILE);
    let current = match fs::read(&config_path) {
        Ok(bytes) => bytes,
        Err(error) => return Response::error(500, &format!("cannot read openblog.json: {error}")),
    };
    let current_etag = match engagement_settings_etag(&state.root, &current) {
        Ok(etag) => etag,
        Err(error) => return Response::error(500, &error),
    };
    if body["etag"].as_str() != Some(current_etag.as_str()) {
        return Response::error(
            409,
            "Hosted engagement settings changed on disk; reload before saving",
        );
    }
    let mut value: Json = match serde_json::from_slice(&current) {
        Ok(Json::Object(object)) => Json::Object(object),
        Ok(_) => return Response::error(500, "openblog.json must contain a JSON object"),
        Err(error) => return Response::error(500, &format!("invalid openblog.json: {error}")),
    };
    value["engagement"] = json!({ "enabled": enabled, "comments": comments, "analytics": analytics, "endpoint": endpoint });
    let candidate = match serde_json::to_string_pretty(&value) {
        Ok(value) => format!("{value}\n"),
        Err(error) => {
            return Response::error(500, &format!("cannot serialize openblog.json: {error}"))
        }
    };
    if let Err(error) = SiteConfig::from_json(&candidate) {
        return Response::error(422, &error);
    }
    let credential_path = match engagement_credential_path(&state.root) {
        Ok(path) => path,
        Err(error) => return Response::error(500, &error),
    };
    let previous_credential = match read_optional_bytes(&credential_path) {
        Ok(value) => value,
        Err(error) => return Response::error(500, &error),
    };
    let credential_result = match action {
        "replace" => serde_json::to_vec(&json!({
            "credential": replacement,
            "targetOrigin": target_origin.expect("validated above"),
        }))
        .map_err(|error| format!("cannot serialize private engagement credential: {error}"))
        .and_then(|envelope| protect_private_credential(&envelope))
        .and_then(|bytes| write_private_bytes_atomic(&credential_path, &bytes)),
        "clear" if credential_path.exists() => fs::remove_file(&credential_path)
            .map_err(|error| format!("cannot clear private engagement credential: {error}")),
        "clear" | "keep" => Ok(()),
        _ => unreachable!(),
    };
    if let Err(error) = credential_result {
        let rollback =
            restore_private_assistant_credential(&credential_path, previous_credential.as_deref());
        return Response::error(500, &mutation_with_rollback_error(&error, rollback));
    }
    if let Err(error) = write_atomic(&config_path, &candidate) {
        let rollback =
            restore_private_assistant_credential(&credential_path, previous_credential.as_deref());
        return Response::error(500, &mutation_with_rollback_error(&error, rollback));
    }
    let credential = match engagement_credential_summary(&state.root, endpoint) {
        Ok(summary) => summary,
        Err(error) => return Response::error(500, &error),
    };
    let etag = match engagement_settings_etag(&state.root, candidate.as_bytes()) {
        Ok(etag) => etag,
        Err(error) => return Response::error(500, &error),
    };
    Response::json(
        200,
        &json!({
            "enabled": enabled, "comments": comments, "analytics": analytics,
            "endpoint": endpoint, "etag": etag, "credential": credential,
        }),
    )
}

fn hosted_text<'a>(object: &'a Json, key: &str, max: usize) -> Result<&'a str, String> {
    object[key]
        .as_str()
        .filter(|value| value.len() <= max && !value.chars().any(char::is_control))
        .ok_or_else(|| format!("hosted engagement returned an invalid {key}"))
}

fn hosted_count(object: &Json, key: &str) -> Result<u64, String> {
    object[key]
        .as_u64()
        .ok_or_else(|| format!("hosted engagement returned an invalid {key}"))
}

fn hosted_site_path(value: &str) -> bool {
    (2..=500).contains(&value.len())
        && value.starts_with('/')
        && !value.starts_with("//")
        && value.ends_with('/')
        && !value.contains(['\\', '?', '#'])
        && !value.chars().any(char::is_control)
        && !value.split('/').any(|part| matches!(part, "." | ".."))
}

fn validate_hosted_comments(value: &Json) -> Result<Json, String> {
    let rows = value["comments"]
        .as_array()
        .filter(|rows| rows.len() <= 200)
        .ok_or_else(|| "hosted engagement returned invalid comments".to_string())?;
    let mut comments = Vec::with_capacity(rows.len());
    for row in rows {
        let id = hosted_text(row, "id", 64)?;
        let path = hosted_text(row, "path", 500)?;
        let author = hosted_text(row, "authorName", 80)?;
        let body = hosted_text(row, "body", 4_000)?;
        let status = hosted_text(row, "status", 16)?;
        let created = hosted_text(row, "createdAt", 64)?;
        if !hosted_site_path(path) || !matches!(status, "pending" | "approved" | "rejected") {
            return Err("hosted engagement returned an invalid comment".into());
        }
        comments.push(json!({
            "id": id, "path": path, "authorName": author, "body": body,
            "status": status, "createdAt": created,
        }));
    }
    Ok(json!({ "comments": comments }))
}

fn validate_hosted_analytics(value: &Json) -> Result<Json, String> {
    let days = hosted_count(value, "days")?;
    if !matches!(days, 7 | 30 | 90 | 365) {
        return Err("hosted engagement returned an invalid days value".into());
    }
    let series = value["series"]
        .as_array()
        .filter(|rows| rows.len() <= 365)
        .ok_or_else(|| "hosted engagement returned an invalid series".to_string())?;
    let mut safe_series = Vec::with_capacity(series.len());
    for row in series {
        safe_series.push(json!({
            "day": hosted_text(row, "day", 16)?,
            "views": hosted_count(row, "views")?,
            "uniques": hosted_count(row, "uniques")?,
        }));
    }
    let posts = value["topPosts"]
        .as_array()
        .filter(|rows| rows.len() <= 50)
        .ok_or_else(|| "hosted engagement returned invalid topPosts".to_string())?;
    let mut safe_posts = Vec::with_capacity(posts.len());
    for row in posts {
        let path = hosted_text(row, "path", 500)?;
        if !hosted_site_path(path) {
            return Err("hosted engagement returned an invalid post path".into());
        }
        safe_posts.push(json!({
            "path": path, "views": hosted_count(row, "views")?,
            "uniques": hosted_count(row, "uniques")?, "allTime": hosted_count(row, "allTime")?,
        }));
    }
    let referrers = value["referrers"]
        .as_array()
        .filter(|rows| rows.len() <= 50)
        .ok_or_else(|| "hosted engagement returned invalid referrers".to_string())?;
    let mut safe_referrers = Vec::with_capacity(referrers.len());
    for row in referrers {
        safe_referrers.push(json!({
            "host": hosted_text(row, "host", 253)?, "views": hosted_count(row, "views")?,
        }));
    }
    Ok(json!({
        "days": days,
        "from": hosted_text(value, "from", 16)?,
        "to": hosted_text(value, "to", 16)?,
        "views": hosted_count(value, "views")?,
        "uniques": hosted_count(value, "uniques")?,
        "allTimeViews": hosted_count(value, "allTimeViews")?,
        "firstDay": value["firstDay"].as_str().filter(|text| text.len() <= 16).unwrap_or(""),
        "series": safe_series,
        "topPosts": safe_posts,
        "referrers": safe_referrers,
        "agentRequests": 0,
        "agents": [],
        "agentPages": [],
    }))
}

fn validate_hosted_engagement_response(
    method: &str,
    operation: &str,
    value: &Json,
) -> Result<Json, String> {
    match (method, operation) {
        ("GET", "admin/comments") => validate_hosted_comments(value),
        ("PATCH", "admin/comments") => {
            let status = hosted_text(value, "status", 16)?;
            if value["ok"].as_bool() == Some(true) && matches!(status, "approved" | "rejected") {
                Ok(json!({ "ok": true, "status": status }))
            } else {
                Err("hosted engagement returned an invalid moderation response".into())
            }
        }
        ("GET", "admin/analytics") => validate_hosted_analytics(value),
        _ => Err("unsupported hosted engagement operation".into()),
    }
}

fn hosted_engagement_request(state: &AppState, req: &Request, operation: &str) -> Response {
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    if !config.engagement.enabled || !valid_engagement_endpoint(&config.engagement.endpoint) {
        return Response::error(404, "Hosted engagement is not configured");
    }
    let credential = match engagement_credential(&state.root, &config.engagement.endpoint) {
        Ok(Some(credential)) => credential,
        Ok(None) => {
            return Response::error(503, "Hosted engagement admin credential is not configured")
        }
        Err(error) => return Response::error(500, &error),
    };
    let mut url = format!(
        "{}/{}",
        config.engagement.endpoint.trim_end_matches('/'),
        operation
    );
    if !req.query.is_empty() {
        let query = req
            .query
            .iter()
            .map(|(key, value)| {
                format!(
                    "{}={}",
                    url::form_urlencoded::byte_serialize(key.as_bytes()).collect::<String>(),
                    url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>()
                )
            })
            .collect::<Vec<_>>()
            .join("&");
        url.push('?');
        url.push_str(&query);
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .max_redirects(0)
        .user_agent(concat!("open.blog-admin/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let authorization = format!("Bearer {credential}");
    let response = if req.method == "PATCH" {
        agent
            .patch(&url)
            .header("Authorization", &authorization)
            .header("Content-Type", "application/json")
            .send(&req.body)
    } else {
        agent
            .get(&url)
            .header("Authorization", &authorization)
            .call()
    };
    let mut response = match response {
        Ok(response) => response,
        Err(ureq::Error::StatusCode(status)) => {
            return Response::error(502, &format!("Hosted engagement returned HTTP {status}"))
        }
        Err(ureq::Error::Timeout(_)) => return Response::error(504, "Hosted engagement timed out"),
        Err(_) => return Response::error(502, "Hosted engagement request failed"),
    };
    let bytes = match response
        .body_mut()
        .with_config()
        .limit(2 * 1024 * 1024)
        .read_to_vec()
    {
        Ok(bytes) => bytes,
        Err(_) => return Response::error(502, "Cannot read hosted engagement response"),
    };
    match serde_json::from_slice::<Json>(&bytes)
        .map_err(|_| "Hosted engagement returned invalid JSON".to_string())
        .and_then(|value| validate_hosted_engagement_response(&req.method, operation, &value))
    {
        Ok(value) => Response::json(200, &value),
        Err(error) => Response::error(502, &error),
    }
}

struct ProjectSkillFile {
    filename: String,
    source: String,
    etag: String,
    parsed: Result<SkillDefinition, Vec<String>>,
}

fn assistant_skills_dir(root: &Path, create: bool) -> Result<PathBuf, String> {
    let skills = crate::assistant_storage::contained_target(root, Path::new("assistant/skills"))?;
    if create {
        fs::create_dir_all(&skills)
            .map_err(|error| format!("cannot create {}: {error}", skills.display()))?;
    }
    Ok(skills)
}

fn read_project_skills(root: &Path) -> Result<Vec<ProjectSkillFile>, String> {
    let directory = assistant_skills_dir(root, false)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(&directory)
        .map_err(|error| format!("cannot read {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("md"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut files = Vec::new();
    for path in paths {
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("invalid.md")
            .to_string();
        if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            files.push(ProjectSkillFile {
                filename,
                source: String::new(),
                etag: String::new(),
                parsed: Err(vec![
                    "Replace this symlink with a regular Markdown skill file.".into(),
                ]),
            });
            continue;
        }
        let bytes =
            fs::read(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
        if bytes.len() > MAX_SKILL_BYTES {
            files.push(ProjectSkillFile {
                filename,
                source: String::new(),
                etag: etag_bytes(&bytes),
                parsed: Err(vec![format!(
                    "Reduce this skill below {MAX_SKILL_BYTES} bytes."
                )]),
            });
            continue;
        }
        let source = match String::from_utf8(bytes.clone()) {
            Ok(source) => source,
            Err(_) => {
                files.push(ProjectSkillFile {
                    filename,
                    source: String::new(),
                    etag: etag_bytes(&bytes),
                    parsed: Err(vec!["Save this skill as UTF-8 Markdown.".into()]),
                });
                continue;
            }
        };
        files.push(ProjectSkillFile {
            filename,
            etag: etag(&source),
            parsed: parse_skill(&source),
            source,
        });
    }
    Ok(files)
}

struct SkillSummaryState<'a> {
    source: &'a str,
    selectable: bool,
    override_state: &'a str,
    errors: Vec<String>,
    raw: Option<&'a str>,
    etag: Option<&'a str>,
    file_id: Option<&'a str>,
}

fn skill_summary(definition: &SkillDefinition, state: SkillSummaryState<'_>) -> Json {
    json!({
        "id": definition.id,
        "name": definition.name,
        "description": definition.description,
        "version": definition.version,
        "scopes": definition.scopes,
        "output": definition.output,
        "source": state.source,
        "valid": state.errors.is_empty(),
        "selectable": state.selectable && state.errors.is_empty(),
        "overrideState": state.override_state,
        "errors": state.errors,
        "raw": state.raw,
        "etag": state.etag,
        "fileId": state.file_id,
    })
}

fn builtin_skills() -> Vec<SkillDefinition> {
    BUILTIN_SKILL_SOURCES
        .iter()
        .map(|(id, source)| {
            let definition = parse_skill(source).expect("built-in assistant skills are valid");
            debug_assert_eq!(*id, definition.id);
            definition
        })
        .collect()
}

fn project_skill_id_counts(projects: &[ProjectSkillFile]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for project in projects {
        if let Ok(skill) = &project.parsed {
            *counts.entry(skill.id.clone()).or_default() += 1;
        }
    }
    counts
}

fn active_project_skill<'a>(
    projects: &'a [ProjectSkillFile],
    id_counts: &BTreeMap<String, usize>,
    id: &str,
    overrides_builtin: bool,
) -> Result<Option<&'a SkillDefinition>, &'static str> {
    if id_counts.get(id).copied().unwrap_or_default() > 1 {
        return Err("A selected project skill ID is duplicated");
    }
    let Some((project, skill)) = projects.iter().find_map(|project| {
        let skill = project.parsed.as_ref().ok()?;
        (skill.id == id).then_some((project, skill))
    }) else {
        return Ok(None);
    };
    if project.filename.trim_end_matches(".md") != skill.id {
        return Ok(None);
    }
    if overrides_builtin && skill.override_builtin.as_deref() != Some(id) {
        return Err("A selected project skill does not explicitly override its built-in");
    }
    Ok(Some(skill))
}

fn assistant_skills(state: &AppState) -> Response {
    let builtins = builtin_skills();
    let projects = match read_project_skills(&state.root) {
        Ok(projects) => projects,
        Err(error) => return Response::error(500, &error),
    };
    let id_counts = project_skill_id_counts(&projects);
    let builtin_ids = builtins
        .iter()
        .map(|skill| skill.id.as_str())
        .collect::<Vec<_>>();
    let active_overrides = builtin_ids
        .iter()
        .filter_map(|id| {
            active_project_skill(&projects, &id_counts, id, true)
                .ok()
                .flatten()
        })
        .map(|skill| skill.id.as_str())
        .collect::<Vec<_>>();
    let mut items = builtins
        .iter()
        .map(|skill| {
            let overridden = active_overrides.contains(&skill.id.as_str());
            skill_summary(
                skill,
                SkillSummaryState {
                    source: "built-in",
                    selectable: !overridden,
                    override_state: if overridden { "overridden" } else { "none" },
                    errors: Vec::new(),
                    raw: None,
                    etag: None,
                    file_id: None,
                },
            )
        })
        .collect::<Vec<_>>();
    for project in projects {
        match project.parsed {
            Ok(skill) => {
                let mut errors = Vec::new();
                let file_id = project.filename.trim_end_matches(".md");
                if file_id != skill.id {
                    errors.push(format!(
                        "Change `id` to `{file_id}` so it matches the project skill filename."
                    ));
                }
                if id_counts.get(&skill.id).copied().unwrap_or_default() > 1 {
                    errors.push(format!(
                        "Project skill ID `{}` is declared more than once.",
                        skill.id
                    ));
                }
                let overrides_builtin = builtin_ids.contains(&skill.id.as_str());
                if overrides_builtin && skill.override_builtin.as_deref() != Some(skill.id.as_str())
                {
                    errors.push(format!(
                        "Add `override: {}` to explicitly replace the built-in skill.",
                        skill.id
                    ));
                }
                let active = overrides_builtin && errors.is_empty();
                items.push(skill_summary(
                    &skill,
                    SkillSummaryState {
                        source: "project",
                        selectable: true,
                        override_state: if active { "active" } else { "none" },
                        errors,
                        raw: Some(&project.source),
                        etag: Some(&project.etag),
                        file_id: Some(file_id),
                    },
                ));
            }
            Err(errors) => {
                let id = frontmatter::parse(&project.source)
                    .ok()
                    .and_then(|document| document.front_matter.get("id").map(str::to_string))
                    .unwrap_or_else(|| project.filename.trim_end_matches(".md").to_string());
                items.push(json!({
                    "id": id,
                    "name": project.filename,
                    "description": "Invalid project skill",
                    "version": "",
                    "scopes": [],
                    "output": null,
                    "source": "project",
                    "valid": false,
                    "selectable": false,
                    "overrideState": "none",
                    "errors": errors,
                    "raw": project.source,
                    "etag": project.etag,
                    "fileId": project.filename.trim_end_matches(".md"),
                }));
            }
        }
    }
    Response::json(200, &json!({ "skills": items }))
}

fn valid_skill_path_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.as_bytes()[0].is_ascii_lowercase()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn validate_skill_write(
    source: &str,
    expected_id: Option<&str>,
) -> Result<SkillDefinition, Response> {
    if source.len() > MAX_SKILL_BYTES || source.contains('\0') {
        return Err(Response::error(
            413,
            "Skill Markdown is too large or contains invalid data",
        ));
    }
    let skill = parse_skill(source).map_err(|errors| {
        Response::json(422, &json!({ "error": "Invalid skill", "errors": errors }))
    })?;
    if expected_id.is_some_and(|id| id != skill.id) {
        return Err(Response::error(
            400,
            "A skill ID cannot change during an edit",
        ));
    }
    let builtin = BUILTIN_SKILL_SOURCES.iter().any(|(id, _)| *id == skill.id);
    if builtin && skill.override_builtin.as_deref() != Some(skill.id.as_str()) {
        return Err(Response::error(
            409,
            "A project skill can replace a built-in only with a matching `override` declaration",
        ));
    }
    Ok(skill)
}

fn skill_request_body(req: &Request) -> Result<(Json, String), Response> {
    require_json(req)?;
    let body: Json =
        serde_json::from_slice(&req.body).map_err(|_| Response::error(400, "Invalid JSON"))?;
    let source = body["source"]
        .as_str()
        .ok_or_else(|| Response::error(400, "Missing skill Markdown in `source`"))?
        .to_string();
    Ok((body, source))
}

fn create_assistant_skill(state: &AppState, req: &Request) -> Response {
    let (_, source) = match skill_request_body(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let skill = match validate_skill_write(&source, None) {
        Ok(skill) => skill,
        Err(response) => return response,
    };
    let _transaction = lock(&state.build);
    let directory = match assistant_skills_dir(&state.root, true) {
        Ok(directory) => directory,
        Err(error) => return Response::error(500, &error),
    };
    let path = directory.join(format!("{}.md", skill.id));
    if path.exists() {
        return Response::error(409, "A project skill with this ID already exists");
    }
    if let Err(error) = write_atomic(&path, &source) {
        return Response::error(500, &error);
    }
    Response::json(201, &json!({ "id": skill.id, "etag": etag(&source) }))
}

fn update_assistant_skill(state: &AppState, req: &Request) -> Response {
    let id = req.query.get("id").map(String::as_str).unwrap_or("");
    if !valid_skill_path_id(id) {
        return Response::error(400, "Invalid skill ID");
    }
    let (body, source) = match skill_request_body(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let skill = match validate_skill_write(&source, Some(id)) {
        Ok(skill) => skill,
        Err(response) => return response,
    };
    let _transaction = lock(&state.build);
    let directory = match assistant_skills_dir(&state.root, false) {
        Ok(directory) => directory,
        Err(error) => return Response::error(500, &error),
    };
    let path = directory.join(format!("{id}.md"));
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Response::error(400, "Project skill symlinks cannot be edited");
    }
    let current = match fs::read_to_string(&path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Response::error(404, "Project skill not found")
        }
        Err(error) => return Response::error(500, &format!("Cannot read project skill: {error}")),
    };
    if body["etag"].as_str() != Some(etag(&current).as_str()) {
        return Response::error(
            409,
            "Skill changed since it was opened; reload before saving",
        );
    }
    if let Err(error) = write_atomic(&path, &source) {
        return Response::error(500, &error);
    }
    Response::json(200, &json!({ "id": skill.id, "etag": etag(&source) }))
}

fn assistant_context_target(
    root: &Path,
    context_type: &str,
    visibility: &str,
    document_path: Option<&str>,
) -> Result<(PathBuf, &'static str, &'static str), Response> {
    let (context_type, relative) = match context_type {
        "author" => ("author", PathBuf::from("author.md")),
        "site" => ("site", PathBuf::from("site.md")),
        "post" => {
            let document_path = document_path
                .ok_or_else(|| Response::error(400, "Post context requires documentPath"))?;
            if check_rel_path(document_path).ok() != Some("posts") {
                return Err(Response::error(
                    400,
                    "Post context requires a valid post path",
                ));
            }
            let file_name = Path::new(document_path)
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| name.ends_with(".md"))
                .ok_or_else(|| Response::error(400, "Post context requires a Markdown post"))?;
            ("post", PathBuf::from("posts").join(file_name))
        }
        _ => {
            return Err(Response::error(
                400,
                "Context type must be author, site, or post",
            ))
        }
    };
    let (visibility, base) = match visibility {
        "portable" => ("portable", PathBuf::from("assistant/context")),
        "private" => ("private", PathBuf::from(".openblog/private/context")),
        _ => {
            return Err(Response::error(
                400,
                "Context visibility must be portable or private",
            ))
        }
    };
    let target = crate::assistant_storage::contained_target(root, &base.join(relative))
        .map_err(|error| Response::error(400, &error))?;
    Ok((target, context_type, visibility))
}

fn assistant_context_document(
    root: &Path,
    context_type: &str,
    visibility: &str,
    document_path: Option<&str>,
) -> Result<Json, Response> {
    let (path, context_type, visibility) =
        assistant_context_target(root, context_type, visibility, document_path)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("context.md");
    let id = if context_type == "post" {
        format!("{visibility}:post:{name}")
    } else {
        format!("{visibility}:{context_type}")
    };
    match fs::read(&path) {
        Ok(bytes) if bytes.len() > MAX_ASSISTANT_CONTEXT_BYTES => Ok(json!({
            "id": id,
            "name": name,
            "contextType": context_type,
            "visibility": visibility,
            "exists": true,
            "valid": false,
            "content": "",
            "characters": 0,
            "etag": etag_bytes(&bytes),
            "guidance": format!("This context file exceeds the {} KiB limit. Shorten it before selecting it.", MAX_ASSISTANT_CONTEXT_BYTES / 1024),
        })),
        Ok(bytes) => match String::from_utf8(bytes.clone()) {
            Ok(content) => Ok(json!({
                "id": id,
                "name": name,
                "contextType": context_type,
                "visibility": visibility,
                "exists": true,
                "valid": true,
                "content": content,
                "characters": content.chars().count(),
                "etag": etag_bytes(&bytes),
            })),
            Err(_) => Ok(json!({
                "id": id,
                "name": name,
                "contextType": context_type,
                "visibility": visibility,
                "exists": true,
                "valid": false,
                "content": "",
                "characters": 0,
                "etag": etag_bytes(&bytes),
                "guidance": "This context file is not valid UTF-8. Replace it here or remove it, then save UTF-8 Markdown.",
            })),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({
            "id": id,
            "name": name,
            "contextType": context_type,
            "visibility": visibility,
            "exists": false,
            "valid": true,
            "content": "",
            "characters": 0,
            "etag": null,
        })),
        Err(error) => Err(Response::error(
            500,
            &format!("Cannot read assistant context: {error}"),
        )),
    }
}

fn assistant_reference_target(
    root: &Path,
    visibility: &str,
    name: &str,
) -> Result<(PathBuf, &'static str), Response> {
    let valid_name = !name.is_empty()
        && name.len() <= 160
        && Path::new(name).file_name().and_then(|value| value.to_str()) == Some(name)
        && !name.chars().any(char::is_control)
        && matches!(
            Path::new(name).extension().and_then(|value| value.to_str()),
            Some("md" | "txt")
        );
    if !valid_name {
        return Err(Response::error(
            422,
            "References require a safe .md or .txt filename",
        ));
    }
    let (visibility, base) = match visibility {
        "portable" => ("portable", PathBuf::from("assistant/context/references")),
        "private" => (
            "private",
            PathBuf::from(".openblog/private/context/references"),
        ),
        _ => {
            return Err(Response::error(
                400,
                "Reference visibility must be portable or private",
            ))
        }
    };
    let target = crate::assistant_storage::contained_target(root, &base.join(name))
        .map_err(|error| Response::error(400, &error))?;
    Ok((target, visibility))
}

fn assistant_text_descriptor(id: String, name: &str, visibility: &str, bytes: Vec<u8>) -> Json {
    if bytes.len() > MAX_ASSISTANT_CONTEXT_BYTES {
        return json!({
            "id": id, "name": name, "visibility": visibility,
            "exists": true, "valid": false, "content": "", "characters": 0,
            "etag": etag_bytes(&bytes),
            "guidance": "This source exceeds the 64 KiB Assistant context limit."
        });
    }
    match String::from_utf8(bytes.clone()) {
        Ok(content) => json!({
            "id": id, "name": name, "visibility": visibility,
            "exists": true, "valid": true, "content": content,
            "characters": content.chars().count(), "etag": etag_bytes(&bytes)
        }),
        Err(_) => json!({
            "id": id, "name": name, "visibility": visibility,
            "exists": true, "valid": false, "content": "", "characters": 0,
            "etag": etag_bytes(&bytes),
            "guidance": "This source is not valid UTF-8 text and cannot be selected."
        }),
    }
}

fn assistant_references(root: &Path) -> Result<Vec<Json>, Response> {
    let mut references = Vec::new();
    for (visibility, directory) in [
        ("portable", root.join("assistant/context/references")),
        ("private", root.join(".openblog/private/context/references")),
    ] {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(Response::error(
                    500,
                    &format!("Cannot read Assistant references: {error}"),
                ))
            }
        };
        for entry in entries {
            let entry = entry.map_err(|error| {
                Response::error(500, &format!("Cannot inspect Assistant reference: {error}"))
            })?;
            let metadata = entry.file_type().map_err(|error| {
                Response::error(500, &format!("Cannot inspect Assistant reference: {error}"))
            })?;
            if !metadata.is_file() || metadata.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if assistant_reference_target(root, visibility, &name).is_err() {
                continue;
            }
            let bytes = fs::read(entry.path()).map_err(|error| {
                Response::error(500, &format!("Cannot read Assistant reference: {error}"))
            })?;
            if String::from_utf8(bytes.clone())
                .is_ok_and(|source| crate::url_context::is_snapshot_markdown(&source))
            {
                continue;
            }
            references.push(assistant_text_descriptor(
                format!("{visibility}:reference:{name}"),
                &name,
                visibility,
                bytes,
            ));
        }
    }
    references.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    Ok(references)
}

fn assistant_post_snapshots(root: &Path) -> Result<Vec<Json>, Response> {
    let config = site::load_config(root).map_err(|error| Response::error(500, &error))?;
    let content_root = root.join(&config.paths.content);
    let posts_root = content_root.join("posts");
    let mut snapshots = Vec::new();
    if !posts_root.is_dir() {
        return Ok(snapshots);
    }
    fn collect_markdown(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), Response> {
        let entries = fs::read_dir(directory).map_err(|error| {
            Response::error(500, &format!("Cannot inspect post snapshots: {error}"))
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                Response::error(500, &format!("Cannot inspect post snapshot: {error}"))
            })?;
            let file_type = entry.file_type().map_err(|error| {
                Response::error(500, &format!("Cannot inspect post snapshot: {error}"))
            })?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                collect_markdown(&entry.path(), paths)?;
            } else if file_type.is_file()
                && entry.path().extension().and_then(|value| value.to_str()) == Some("md")
            {
                paths.push(entry.path());
            }
        }
        Ok(())
    }
    let mut paths = Vec::new();
    collect_markdown(&posts_root, &mut paths)?;
    paths.sort();
    for path in paths {
        let relative = path
            .strip_prefix(&content_root)
            .map_err(|_| Response::error(500, "Post snapshot escaped the content directory"))?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = fs::read(&path).map_err(|error| {
            Response::error(500, &format!("Cannot read post snapshot: {error}"))
        })?;
        let mut descriptor = assistant_text_descriptor(
            format!("post:{relative}"),
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("post.md"),
            "source",
            bytes,
        );
        descriptor["path"] = json!(relative);
        descriptor["kind"] = json!("postSnapshot");
        snapshots.push(descriptor);
    }
    snapshots.sort_by(|left, right| left["path"].as_str().cmp(&right["path"].as_str()));
    Ok(snapshots)
}

fn assistant_context_catalog(state: &AppState, req: &Request) -> Response {
    let mut documents = Vec::new();
    for (visibility, context_type) in [
        ("portable", "author"),
        ("portable", "site"),
        ("private", "author"),
        ("private", "site"),
    ] {
        match assistant_context_document(&state.root, context_type, visibility, None) {
            Ok(document) => documents.push(document),
            Err(response) => return response,
        }
    }
    if let Some(document_path) = req.query.get("path") {
        for visibility in ["portable", "private"] {
            match assistant_context_document(&state.root, "post", visibility, Some(document_path)) {
                Ok(document) => documents.push(document),
                Err(response) => return response,
            }
        }
    }
    for visibility in ["portable", "private"] {
        match assistant_url_context_documents(&state.root, visibility) {
            Ok(mut references) => documents.append(&mut references),
            Err(response) => return response,
        }
    }
    let git = crate::git::Git::new(&state.root);
    let private_safety = if git.is_repo() {
        let ignored = [
            ".openblog/private/context/author.md",
            ".openblog/private/context/site.md",
            ".openblog/private/context/posts/.openblog-ignore-probe.md",
            ".openblog/private/context/references/.openblog-ignore-probe.txt",
        ]
        .iter()
        .all(|path| git.run(&["check-ignore", "-q", "--no-index", path]).is_ok());
        let tracked = git
            .run(&["ls-files", "--", ".openblog/private"])
            .is_ok_and(|paths| !paths.trim().is_empty());
        let warning = if tracked {
            Some("Private assistant content is already tracked by Git. Remove it from the index and rotate any exposed secrets before using it.")
        } else if !ignored {
            Some("Private assistant content is not ignored by Git. Add /.openblog/private/ to .gitignore before saving sensitive context.")
        } else {
            None
        };
        json!({ "gitRepository": true, "ignored": ignored, "tracked": tracked, "warning": warning })
    } else {
        json!({ "gitRepository": false, "ignored": null, "tracked": false, "warning": null })
    };
    Response::json(
        200,
        &json!({
            "documents": documents,
            "references": match assistant_references(&state.root) {
                Ok(references) => references,
                Err(response) => return response,
            },
            "postSnapshots": match assistant_post_snapshots(&state.root) {
                Ok(posts) => posts,
                Err(response) => return response,
            },
            "privateSafety": private_safety
        }),
    )
}

fn assistant_context_mutation(
    req: &Request,
) -> Result<(Json, String, String, Option<String>), Response> {
    require_json(req)?;
    let body: Json = serde_json::from_slice(&req.body)
        .map_err(|_| Response::error(400, "Invalid context request"))?;
    let context_type = body["contextType"]
        .as_str()
        .ok_or_else(|| Response::error(400, "Missing contextType"))?
        .to_string();
    let visibility = body["visibility"]
        .as_str()
        .ok_or_else(|| Response::error(400, "Missing visibility"))?
        .to_string();
    let document_path = body["documentPath"].as_str().map(str::to_string);
    Ok((body, context_type, visibility, document_path))
}

fn post_context_source(fields: &Json) -> Result<String, Response> {
    let fields = fields
        .as_object()
        .ok_or_else(|| Response::error(400, "Post context requires fields"))?;
    let mut source = String::new();
    for (key, heading) in [
        ("goal", "Goal"),
        ("audience", "Audience"),
        ("learningOutcomes", "Learning outcomes"),
        ("sources", "Sources"),
        ("constraints", "Constraints"),
    ] {
        let value = fields.get(key).and_then(Json::as_str).unwrap_or("").trim();
        if value.contains('\0') {
            return Err(Response::error(422, "Post context must be UTF-8 text"));
        }
        source.push_str(&format!("<!-- openblog:{key}:start -->\n"));
        source.push_str("## ");
        source.push_str(heading);
        source.push_str("\n\n");
        source.push_str(value);
        source.push_str(&format!("\n<!-- openblog:{key}:end -->\n\n"));
    }
    Ok(source)
}

fn save_assistant_context(state: &AppState, req: &Request) -> Response {
    let (body, context_type, visibility, document_path) = match assistant_context_mutation(req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (path, _, _) = match assistant_context_target(
        &state.root,
        &context_type,
        &visibility,
        document_path.as_deref(),
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let content = if context_type == "post" {
        match post_context_source(&body["fields"]) {
            Ok(content) => content,
            Err(response) => return response,
        }
    } else {
        match body["content"].as_str() {
            Some(content) if !content.contains('\0') => content.to_string(),
            _ => return Response::error(400, "Context content must be UTF-8 text"),
        }
    };
    if content.len() > MAX_ASSISTANT_CONTEXT_BYTES {
        return Response::error(413, "Context files are limited to 64 KiB of UTF-8 text");
    }
    let _content_lock = lock(&state.build);
    let _filesystem_lock = match content_transaction(state) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if context_type == "post" {
        let config = match site::load_config(&state.root) {
            Ok(config) => config,
            Err(error) => return Response::error(500, &error),
        };
        let document_path = document_path
            .as_deref()
            .expect("validated post context path");
        let document = match resolve_content_path(&state.root, &config, document_path) {
            Ok(document) => document,
            Err(error) => return Response::error(400, &error),
        };
        if !document.is_file() {
            return Response::error(404, "The associated post does not exist");
        }
    }
    let current = match fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Response::error(500, &format!("Cannot read context: {error}")),
    };
    let expected = body["etag"].as_str();
    let matches = match &current {
        Some(bytes) => expected == Some(etag_bytes(bytes).as_str()),
        None => body["etag"].is_null(),
    };
    if !matches {
        return Response::error(409, "Context changed since it was opened; reload and retry");
    }
    if let Err(error) = write_atomic(&path, &content) {
        return Response::error(500, &error);
    }
    match assistant_context_document(
        &state.root,
        &context_type,
        &visibility,
        document_path.as_deref(),
    ) {
        Ok(document) => Response::json(200, &json!({ "document": document })),
        Err(response) => response,
    }
}

fn delete_assistant_context(state: &AppState, req: &Request) -> Response {
    let (body, context_type, visibility, document_path) = match assistant_context_mutation(req) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let (path, _, _) = match assistant_context_target(
        &state.root,
        &context_type,
        &visibility,
        document_path.as_deref(),
    ) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let _content_lock = lock(&state.build);
    let _filesystem_lock = match content_transaction(state) {
        Ok(value) => value,
        Err(response) => return response,
    };
    let current = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Response::error(404, "Context file does not exist")
        }
        Err(error) => return Response::error(500, &format!("Cannot read context: {error}")),
    };
    if body["etag"].as_str() != Some(etag_bytes(&current).as_str()) {
        return Response::error(409, "Context changed since it was opened; reload and retry");
    }
    match fs::remove_file(&path) {
        Ok(()) => Response::json(200, &json!({ "deleted": true })),
        Err(error) => Response::error(500, &format!("Cannot remove context: {error}")),
    }
}

fn assistant_reference_request(req: &Request) -> Result<(Json, String, String), Response> {
    require_json(req)?;
    let body: Json = serde_json::from_slice(&req.body)
        .map_err(|_| Response::error(400, "Invalid reference request"))?;
    let name = body["name"]
        .as_str()
        .ok_or_else(|| Response::error(400, "Missing reference name"))?
        .to_string();
    let visibility = body["visibility"]
        .as_str()
        .ok_or_else(|| Response::error(400, "Missing reference visibility"))?
        .to_string();
    Ok((body, name, visibility))
}

fn create_assistant_reference(state: &AppState, req: &Request) -> Response {
    let (body, name, visibility) = match assistant_reference_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let (path, visibility) = match assistant_reference_target(&state.root, &visibility, &name) {
        Ok(target) => target,
        Err(response) => return response,
    };
    let content = match body["content"].as_str() {
        Some(content) if !content.contains('\0') => content,
        _ => return Response::error(422, "References must be UTF-8 text"),
    };
    if content.len() > MAX_ASSISTANT_CONTEXT_BYTES {
        return Response::error(413, "References are limited to 64 KiB of UTF-8 text");
    }
    let _content_lock = lock(&state.build);
    let _filesystem_lock = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    if path.exists() {
        return Response::error(409, "A reference with that name already exists");
    }
    if let Err(error) = write_atomic(&path, content) {
        return Response::error(500, &error);
    }
    let bytes = content.as_bytes().to_vec();
    Response::json(
        201,
        &json!({
            "reference": assistant_text_descriptor(
                format!("{visibility}:reference:{name}"),
                &name,
                visibility,
                bytes,
            )
        }),
    )
}

fn resolve_review_skills(root: &Path, ids: &[String]) -> Result<Vec<ReviewSkill>, Response> {
    let projects = read_project_skills(root).map_err(|error| Response::error(500, &error))?;
    let id_counts = project_skill_id_counts(&projects);
    let builtins = builtin_skills();
    ids.iter()
        .map(|id| resolve_review_skill(id, &builtins, &projects, &id_counts))
        .collect()
}

fn resolve_review_skill(
    id: &str,
    builtins: &[SkillDefinition],
    projects: &[ProjectSkillFile],
    id_counts: &BTreeMap<String, usize>,
) -> Result<ReviewSkill, Response> {
    if !valid_skill_path_id(id) {
        return Err(Response::error(400, "Invalid selected skill ID"));
    }
    let builtin = builtins.iter().find(|skill| skill.id == id);
    let project = active_project_skill(projects, id_counts, id, builtin.is_some())
        .map_err(|message| Response::error(409, message))?;
    let skill = match (builtin, project) {
        (Some(_), Some(project)) => project.clone(),
        (Some(builtin), None) => builtin.clone(),
        (None, Some(project)) => project.clone(),
        (None, None) => return Err(Response::error(400, "Selected skill is unavailable")),
    };
    if skill.output != SkillOutputKind::Review || !skill.scopes.contains(&SkillScope::Document) {
        return Err(Response::error(
            400,
            "Selected skill does not support complete-document review",
        ));
    }
    Ok(ReviewSkill {
        id: skill.id,
        version: skill.version,
        instructions: skill.body,
    })
}

fn resolve_review_context(root: &Path, id: &str) -> Result<ReviewContext, Response> {
    let parts = id.split(':').collect::<Vec<_>>();
    let document = match parts.as_slice() {
        [visibility @ ("portable" | "private"), context_type @ ("author" | "site")] => {
            assistant_context_document(root, context_type, visibility, None)?
        }
        [visibility @ ("portable" | "private"), "post", name] => {
            let document_path = format!("posts/{name}");
            assistant_context_document(root, "post", visibility, Some(&document_path))?
        }
        [visibility @ ("portable" | "private"), "reference", _] => {
            let manual = assistant_references(root)?
                .into_iter()
                .find(|document| document["id"] == id);
            match manual {
                Some(document) => document,
                None => assistant_url_context_documents(root, visibility)?
                    .into_iter()
                    .find(|document| document["id"] == id)
                    .ok_or_else(|| Response::error(400, "Selected reference is unavailable"))?,
            }
        }
        ["post", _] => assistant_post_snapshots(root)?
            .into_iter()
            .find(|document| document["id"] == id)
            .ok_or_else(|| Response::error(400, "Selected post snapshot is unavailable"))?,
        _ => return Err(Response::error(400, "Invalid selected context ID")),
    };
    if document["exists"] != true || document["valid"] != true {
        return Err(Response::error(
            400,
            "Selected context is unavailable or invalid",
        ));
    }
    ReviewContext::new(
        id,
        document["name"].as_str().unwrap_or(""),
        document["content"].as_str().unwrap_or(""),
    )
    .map_err(|error| Response::error(400, error))
}

fn selected_ids(body: &Json, field: &str, maximum: usize) -> Result<Vec<String>, Response> {
    let values = body[field]
        .as_array()
        .ok_or_else(|| Response::error(400, &format!("`{field}` must be an array")))?;
    if values.is_empty() && field == "skillIds" {
        return Err(Response::error(400, "Select at least one review skill"));
    }
    if values.len() > maximum {
        return Err(Response::error(400, &format!("Too many selected {field}")));
    }
    let mut ids = Vec::with_capacity(values.len());
    for value in values {
        let id = value
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| Response::error(400, &format!("`{field}` contains an invalid ID")))?;
        if ids.iter().any(|existing| existing == id) {
            return Err(Response::error(
                400,
                &format!("`{field}` contains a duplicate ID"),
            ));
        }
        ids.push(id.to_string());
    }
    Ok(ids)
}

fn review_source_hash(title: &str, metadata: &Json, markdown: &str) -> String {
    let snapshot = serde_json::to_vec(&json!({
        "title": title,
        "metadata": metadata,
        "markdown": markdown,
    }))
    .expect("JSON source snapshot is serializable");
    let digest = Blake2s256::digest(snapshot);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn review_error(error: crate::assistant::AssistantError) -> Response {
    let (status, code) = match error.kind {
        AssistantErrorKind::NotConfigured => (404, "not-configured"),
        AssistantErrorKind::InvalidConfiguration => (400, "invalid-configuration"),
        AssistantErrorKind::MissingCredential => (503, "missing-credential"),
        AssistantErrorKind::Timeout => (504, "timeout"),
        AssistantErrorKind::InvalidJson | AssistantErrorKind::InvalidResult => {
            (502, "invalid-result")
        }
        AssistantErrorKind::Transport
        | AssistantErrorKind::ProviderStatus
        | AssistantErrorKind::ResponseRead => (502, "provider-error"),
    };
    Response::json(
        status,
        &json!({ "error": error.public_message(), "code": code }),
    )
}

fn generate_document_review(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid review request"),
    };
    let source = &body["source"];
    let title = match source["title"].as_str() {
        Some(title) if title.chars().count() <= 500 && !title.contains('\0') => title,
        _ => return Response::error(400, "Review source needs a bounded UTF-8 title"),
    };
    let metadata = match source["metadata"].as_object() {
        Some(_) => source["metadata"].clone(),
        None => return Response::error(400, "Review source metadata must be an object"),
    };
    if let Err(error) = fields_from_json(&metadata) {
        return Response::error(400, &format!("Invalid review source metadata: {error}"));
    }
    let markdown = match source["markdown"].as_str() {
        Some(markdown) if markdown.len() <= MAX_DOCUMENT_BYTES && !markdown.contains('\0') => {
            markdown
        }
        _ => return Response::error(400, "Review Markdown is too large or invalid"),
    };
    let skill_ids = match selected_ids(&body, "skillIds", 12) {
        Ok(ids) => ids,
        Err(response) => return response,
    };
    let context_ids = match selected_ids(&body, "contextIds", 16) {
        Ok(ids) => ids,
        Err(response) => return response,
    };
    let (skills, context) = {
        let _assistant_lock = lock(&state.build);
        let skills = match resolve_review_skills(&state.root, &skill_ids) {
            Ok(skills) => skills,
            Err(response) => return response,
        };
        let context = match context_ids
            .iter()
            .map(|id| resolve_review_context(&state.root, id))
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(context) => context,
            Err(response) => return response,
        };
        (skills, context)
    };
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
    let hash = review_source_hash(title, &metadata, markdown);
    let request = AssistantRequest::document_review(
        config.knowledge_checks.model.clone(),
        AssistantDocument {
            title: title.to_string(),
            metadata,
            markdown: markdown.to_string(),
            hash: hash.clone(),
        },
        skills.clone(),
        context.clone(),
    );
    let _provider_permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::json(
                429,
                &json!({ "error": "Two Assistant operations are already running; try again shortly", "code": "concurrency-limit" }),
            )
        }
    };
    let findings = match provider.generate(&request) {
        Ok(AssistantResult::Review(findings)) => findings,
        Ok(AssistantResult::KnowledgeChecks(_) | AssistantResult::CodeInteraction(_)) => {
            return Response::error(502, "Assistant provider returned the wrong result type")
        }
        Ok(AssistantResult::Completion(_)) => {
            return Response::error(502, "Assistant provider returned the wrong result type")
        }
        Err(error) => return review_error(error),
    };
    let review_id = match auth::random_token() {
        Ok(token) => token,
        Err(error) => return Response::error(500, &error),
    };
    Response::json(
        200,
        &json!({
            "reviewId": review_id,
            "schemaVersion": ASSISTANT_SCHEMA_VERSION,
            "sourceHash": hash,
            "scope": { "kind": "document", "start": 0, "end": markdown.chars().count(), "unit": "unicode-code-points" },
            "skills": skills.iter().map(|skill| json!({ "id": skill.id, "version": skill.version })).collect::<Vec<_>>(),
            "context": context.iter().map(|document| json!({ "id": document.identity(), "name": document.name(), "visibility": document.visibility().as_str() })).collect::<Vec<_>>(),
            "provider": { "type": "generic-https", "model": config.knowledge_checks.model },
            "research": { "enabled": false },
            "createdAt": clock::now().rfc3339(),
            "findings": findings.findings,
        }),
    )
}

fn generate_inline_completion(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid completion request"),
    };
    let source = &body["source"];
    let title = match source["title"].as_str() {
        Some(title) if title.chars().count() <= 500 && !title.contains('\0') => title,
        _ => return Response::error(400, "Completion source needs a bounded UTF-8 title"),
    };
    let metadata = match source["metadata"].as_object() {
        Some(_) => source["metadata"].clone(),
        None => return Response::error(400, "Completion source metadata must be an object"),
    };
    if let Err(error) = fields_from_json(&metadata) {
        return Response::error(400, &format!("Invalid completion source metadata: {error}"));
    }
    let bounded_text = |field: &str, maximum: usize| {
        source[field]
            .as_str()
            .filter(|value| value.chars().count() <= maximum && !value.contains('\0'))
    };
    let markdown = match bounded_text("markdown", 100_000) {
        Some(value) => value,
        None => return Response::error(400, "Completion Markdown is too large or invalid"),
    };
    let prefix = match bounded_text("prefix", 8_000) {
        Some(value) => value,
        None => return Response::error(400, "Completion prefix is too large or invalid"),
    };
    let suffix = match bounded_text("suffix", 8_000) {
        Some(value) => value,
        None => return Response::error(400, "Completion suffix is too large or invalid"),
    };
    let editor_mode = match source["editorMode"].as_str() {
        Some(mode @ ("visual" | "markdown")) => mode,
        _ => return Response::error(400, "Completion editorMode must be visual or markdown"),
    };
    let context_ids = match selected_ids(&body, "contextIds", 16) {
        Ok(ids) => ids,
        Err(response) => return response,
    };
    let context = {
        let _assistant_lock = lock(&state.build);
        match context_ids
            .iter()
            .map(|id| resolve_review_context(&state.root, id))
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(context) => context,
            Err(response) => return response,
        }
    };
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
    let request = AssistantRequest::inline_completion(
        config.knowledge_checks.model,
        AssistantCompletionSource {
            title: title.to_string(),
            metadata,
            markdown: markdown.to_string(),
            prefix: prefix.to_string(),
            suffix: suffix.to_string(),
            editor_mode: editor_mode.to_string(),
        },
        context,
    );
    let _provider_permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::json(
                429,
                &json!({ "error": "Two Assistant operations are already running; try again shortly", "code": "concurrency-limit" }),
            )
        }
    };
    match provider.generate(&request) {
        Ok(AssistantResult::Completion(completion)) => Response::json(200, &json!(completion)),
        Ok(
            AssistantResult::KnowledgeChecks(_)
            | AssistantResult::CodeInteraction(_)
            | AssistantResult::Review(_),
        ) => Response::error(502, "Assistant provider returned the wrong result type"),
        Err(error) => review_error(error),
    }
}

fn delete_assistant_reference(state: &AppState, req: &Request) -> Response {
    let (body, name, visibility) = match assistant_reference_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let (path, _) = match assistant_reference_target(&state.root, &visibility, &name) {
        Ok(target) => target,
        Err(response) => return response,
    };
    let _content_lock = lock(&state.build);
    let _filesystem_lock = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Response::error(404, "Reference does not exist")
        }
        Err(error) => return Response::error(500, &format!("Cannot read reference: {error}")),
    };
    if body["etag"].as_str() != Some(etag_bytes(&bytes).as_str()) {
        return Response::error(
            409,
            "Reference changed since it was opened; reload and retry",
        );
    }
    match fs::remove_file(&path) {
        Ok(()) => Response::json(200, &json!({ "deleted": true })),
        Err(error) => Response::error(500, &format!("Cannot remove reference: {error}")),
    }
}

// URL snapshots are retrieved only on explicit author action and saved separately
// after inspection; review selection reads the saved snapshot without refetching.
fn retrieve_url_context(req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid URL context request"),
    };
    if body["confirmed"] != true {
        return Response::error(400, "Confirm retrieval before contacting this URL");
    }
    let source = match body["url"].as_str() {
        Some(source) => source,
        None => return Response::error(400, "Missing URL"),
    };
    match crate::url_context::validate_public_url(source) {
        Ok(_) => match crate::url_context::fetch_url_snapshot(source, &clock::now().rfc3339()) {
            Ok(snapshot) => Response::json(200, &json!({ "snapshot": snapshot })),
            Err(error) => Response::error(502, &error),
        },
        Err(error) => Response::error(400, &error),
    }
}

fn url_context_directory(root: &Path, visibility: &str) -> Result<PathBuf, Response> {
    let relative = match visibility {
        "portable" => Path::new("assistant/context/references"),
        "private" => Path::new(".openblog/private/context/references"),
        _ => {
            return Err(Response::error(
                400,
                "Snapshot visibility must be portable or private",
            ))
        }
    };
    crate::assistant_storage::contained_target(root, relative)
        .map_err(|error| Response::error(400, &error))
}

fn assistant_url_context_documents(root: &Path, visibility: &str) -> Result<Vec<Json>, Response> {
    let directory = url_context_directory(root, visibility)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(&directory)
        .map_err(|error| Response::error(500, &format!("Cannot read URL snapshots: {error}")))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("md"))
        .collect::<Vec<_>>();
    paths.sort();
    let mut documents = Vec::new();
    for path in paths {
        let file_id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("invalid");
        if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            documents.push(json!({
                "id": format!("{visibility}:reference:{file_id}"), "name": format!("{file_id}.md"),
                "contextType": "reference", "visibility": visibility, "exists": true,
                "valid": false, "selectable": false, "untrusted": true, "content": "",
                "characters": 0, "guidance": "Replace this symlink with a regular URL snapshot file."
            }));
            continue;
        }
        let bytes = fs::read(&path)
            .map_err(|error| Response::error(500, &format!("Cannot read URL snapshot: {error}")))?;
        let source = match String::from_utf8(bytes.clone()) {
            Ok(source) => source,
            Err(_) => continue,
        };
        if !crate::url_context::is_snapshot_markdown(&source) {
            continue;
        }
        let parsed = crate::url_context::parse_snapshot_markdown(&source);
        match parsed {
            Ok(snapshot) => documents.push(json!({
                "id": format!("{visibility}:reference:{file_id}"), "name": format!("{file_id}.md"),
                "contextType": "reference", "visibility": visibility, "exists": true,
                "valid": true, "selectable": true, "untrusted": true,
                "content": snapshot.text, "characters": snapshot.text.chars().count(),
                "sourceUrl": snapshot.source_url, "canonicalUrl": snapshot.canonical_url,
                "retrievedAt": snapshot.retrieved_at, "contentType": snapshot.content_type,
                "etag": etag_bytes(&bytes)
            })),
            Err(error) => documents.push(json!({
                "id": format!("{visibility}:reference:{file_id}"), "name": format!("{file_id}.md"),
                "contextType": "reference", "visibility": visibility, "exists": true,
                "valid": false, "selectable": false, "untrusted": true, "content": "",
                "characters": 0, "etag": etag_bytes(&bytes), "guidance": error
            })),
        }
    }
    Ok(documents)
}

fn save_url_context(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid URL snapshot request"),
    };
    if body["confirmed"] != true {
        return Response::error(400, "Confirm saving this inspected URL snapshot");
    }
    let visibility = body["visibility"].as_str().unwrap_or("");
    let file_id = body["fileId"].as_str().unwrap_or("");
    if !valid_skill_path_id(file_id) {
        return Response::error(
            400,
            "Snapshot file ID must use lowercase letters, digits, and hyphens",
        );
    }
    let snapshot: crate::url_context::UrlContextSnapshot =
        match serde_json::from_value(body["snapshot"].clone()) {
            Ok(snapshot) => snapshot,
            Err(_) => return Response::error(400, "URL snapshot metadata is incomplete"),
        };
    let source = match crate::url_context::snapshot_markdown(&snapshot) {
        Ok(source) => source,
        Err(error) => return Response::error(400, &error),
    };
    let directory = match url_context_directory(&state.root, visibility) {
        Ok(directory) => directory,
        Err(response) => return response,
    };
    let _content_lock = lock(&state.build);
    let _filesystem_lock = match content_transaction(state) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Err(error) = fs::create_dir_all(&directory) {
        return Response::error(
            500,
            &format!("Cannot create URL snapshot directory: {error}"),
        );
    }
    let path = directory.join(format!("{file_id}.md"));
    if path.exists() {
        return Response::error(409, "A URL snapshot with this file ID already exists");
    }
    if let Err(error) = write_atomic(&path, &source) {
        return Response::error(500, &error);
    }
    Response::json(
        201,
        &json!({ "id": format!("{visibility}:reference:{file_id}"), "etag": etag(&source) }),
    )
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
        Err(error) => {
            let status = match error.kind {
                AssistantErrorKind::NotConfigured => 404,
                AssistantErrorKind::InvalidConfiguration => 400,
                AssistantErrorKind::MissingCredential => 503,
                _ => 500,
            };
            return Response::error(status, error.public_message());
        }
    };
    let request = AssistantRequest::knowledge_checks(
        config.knowledge_checks.model,
        context.to_string(),
        KnowledgeCheckCount::new(count as u8).expect("the request count was validated above"),
    );
    let _provider_permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::error(
                429,
                "Two Assistant operations are already running; try again shortly",
            )
        }
    };
    match provider.generate(&request) {
        Ok(AssistantResult::KnowledgeChecks(result)) => Response::json(200, &json!(result)),
        Ok(AssistantResult::Review(_) | AssistantResult::CodeInteraction(_)) => {
            Response::error(502, "Assistant provider returned the wrong result type")
        }
        Ok(AssistantResult::Completion(_)) => {
            Response::error(502, "Assistant provider returned the wrong result type")
        }
        Err(error) => Response::error(502, error.public_message()),
    }
}

fn generate_code_interaction(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let context = body["context"].as_str().unwrap_or("").trim();
    if context.is_empty() || context.chars().count() > 50_000 {
        return Response::error(
            400,
            "Select between 1 and 50,000 characters of article text",
        );
    }
    let kind = match body["kind"].as_str().and_then(CodeInteractionKind::parse) {
        Some(kind) => kind,
        None => return Response::error(400, "Code interaction kind must be example or challenge"),
    };
    let language = match CodeInteractionLanguage::parse(body["language"].as_str().unwrap_or("rust"))
    {
        Some(language) => language,
        None => return Response::error(400, "Code interaction language is invalid"),
    };
    let (config, credential) = match assistant_provider_snapshot(state) {
        Ok(snapshot) => snapshot,
        Err(response) => return response,
    };
    let language_allowed = matches!(language.as_str(), "rust" | "web")
        || (!config.code_runner.endpoint.is_empty()
            && config
                .code_runner
                .languages
                .iter()
                .any(|allowed| allowed == language.as_str()));
    if !language_allowed {
        return Response::error(
            400,
            "Code interaction language is not enabled for this site",
        );
    }
    let provider = match configured_assistant_provider(
        &config,
        credential,
        assistant_provider_timeout(config.knowledge_checks.provider, cfg!(test)),
    ) {
        Ok(provider) => provider,
        Err(error) => return review_error(error),
    };
    let request = AssistantRequest::code_interaction(
        config.knowledge_checks.model,
        context.to_string(),
        kind,
        language,
    );
    let _provider_permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::json(
                429,
                &json!({ "error": "Two Assistant operations are already running; try again shortly", "code": "concurrency-limit" }),
            )
        }
    };
    code_interaction_response(provider.generate(&request))
}

fn code_interaction_response(
    result: Result<AssistantResult, crate::assistant::AssistantError>,
) -> Response {
    match result {
        Ok(AssistantResult::CodeInteraction(interaction)) => {
            Response::json(200, &json!(interaction))
        }
        Ok(
            AssistantResult::KnowledgeChecks(_)
            | AssistantResult::Review(_)
            | AssistantResult::Completion(_),
        ) => Response::error(502, "Assistant provider returned the wrong result type"),
        Err(error) => review_error(error),
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
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
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

#[derive(Debug)]
struct StagedTrack {
    pending: PathBuf,
    target: PathBuf,
    url: String,
    contents: Vec<u8>,
}

fn field_scalar<'a>(fields: &'a BTreeMap<String, Value>, key: &str) -> Option<&'a str> {
    match fields.get(key) {
        Some(Value::Scalar(value)) => Some(value.trim()),
        _ => None,
    }
}

fn staged_track(
    root: &Path,
    config: &SiteConfig,
    body: &Json,
    fields: &mut BTreeMap<String, Value>,
) -> Result<Option<StagedTrack>, String> {
    let Some(token) = body.get("trackToken").and_then(Json::as_str) else {
        return Ok(None);
    };
    if field_scalar(fields, "profile") != Some("field-journal")
        || field_scalar(fields, "locationPrivacy") != Some("exact")
    {
        return Err("staged tracks require the Field journal profile in Exact mode".into());
    }
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid staged track token".into());
    }
    let pending = root
        .join(".openblog/pending-tracks")
        .join(format!("{token}.gpx"));
    let contents =
        fs::read(&pending).map_err(|_| "staged track expired; import the GPX again".to_string())?;
    let source =
        std::str::from_utf8(&contents).map_err(|_| "staged GPX is not UTF-8".to_string())?;
    validate_gpx(source)?;
    let name = body
        .get("trackName")
        .and_then(Json::as_str)
        .unwrap_or("track.gpx");
    let stem = sanitize_upload_stem(name);
    let year = clock::now().civil().year;
    let dir_rel = format!("tracks/uploads/{year}");
    let static_dir = root.join(&config.paths.static_dir);
    let mut file_name = format!("{stem}.gpx");
    let mut number = 2;
    while static_dir.join(&dir_rel).join(&file_name).exists() {
        file_name = format!("{stem}-{number}.gpx");
        number += 1;
    }
    let relative = format!("{dir_rel}/{file_name}");
    let url = format!("/{relative}");
    fields.insert("route".into(), Value::Scalar(url.clone()));
    Ok(Some(StagedTrack {
        pending,
        target: static_dir.join(relative),
        url,
        contents,
    }))
}

fn static_track_path(root: &Path, config: &SiteConfig, route: &str) -> Option<PathBuf> {
    let relative = route.strip_prefix("/tracks/uploads/")?;
    if relative.is_empty()
        || !relative.ends_with(".gpx")
        || relative.contains("..")
        || !relative
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.'))
    {
        return None;
    }
    Some(
        root.join(&config.paths.static_dir)
            .join("tracks/uploads")
            .join(relative),
    )
}

fn track_is_referenced_elsewhere(
    root: &Path,
    config: &SiteConfig,
    route: &str,
    excluded_document: &Path,
) -> bool {
    fn visit(dir: &Path, route: &str, excluded_document: &Path) -> bool {
        let Ok(entries) = fs::read_dir(dir) else {
            // If ownership cannot be proven exclusive, preserve the asset.
            return true;
        };
        for entry in entries {
            let Ok(entry) = entry else {
                return true;
            };
            let Ok(file_type) = entry.file_type() else {
                return true;
            };
            let path = entry.path();
            if file_type.is_dir() {
                if visit(&path, route, excluded_document) {
                    return true;
                }
            } else if file_type.is_file()
                && path != excluded_document
                && path.extension().and_then(|value| value.to_str()) == Some("md")
            {
                let Ok(source) = fs::read_to_string(&path) else {
                    return true;
                };
                let Ok(document) = frontmatter::parse(&source) else {
                    return true;
                };
                if document.front_matter.get("route") == Some(route) {
                    return true;
                }
            }
        }
        false
    }

    visit(&root.join(&config.paths.content), route, excluded_document)
}

fn write_document_bundle(
    path: &Path,
    sidecar: &Path,
    source: &str,
    credit_edit: &CreditEdit,
    upload: Option<&StagedTrack>,
    retire: Option<&(PathBuf, PathBuf)>,
) -> Result<(), String> {
    let previous_document = read_optional_bytes(path)?;
    let previous_sidecar = read_optional_bytes(sidecar)?;
    let previous_upload = match upload {
        Some(track) => read_optional_bytes(&track.target)?,
        None => None,
    };
    write_document_with_credits(path, sidecar, source, credit_edit)?;
    let result = (|| {
        if let Some(track) = upload {
            write_atomic_bytes(&track.target, &track.contents)?;
        }
        if let Some((from, to)) = retire {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
            }
            fs::rename(from, to).map_err(|error| {
                format!("cannot retire private track {}: {error}", from.display())
            })?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = restore_file(path, previous_document.as_deref());
        let _ = restore_file(sidecar, previous_sidecar.as_deref());
        if let Some(track) = upload {
            let _ = restore_file(&track.target, previous_upload.as_deref());
        }
        return Err(error);
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
    let mut fields = match fields_from_json(&body["fields"]) {
        Ok(f) => f,
        Err(e) => return Response::error(422, &e),
    };
    let text_body = body["body"].as_str().unwrap_or("");
    if text_body.len() > MAX_DOCUMENT_BYTES || text_body.contains('\0') {
        return Response::error(413, "The post body is too large");
    }
    let mut status = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let config = match site::load_config(&state.root) {
        Ok(c) => c,
        Err(e) => return Response::error(500, &e),
    };
    let field_journal = field_scalar(&fields, "profile") == Some("field-journal");
    let exact_location = field_journal && field_scalar(&fields, "locationPrivacy") == Some("exact");
    if field_journal && !exact_location {
        fields.remove("route");
    }
    let track_upload = match staged_track(&state.root, &config, &body, &mut fields) {
        Ok(track) => track,
        Err(error) => return Response::error(422, &error),
    };
    let mut source = frontmatter::compose(&fields, text_body);

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

    let mut retired_track = None;
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
        let replacement = track_upload.as_ref().map(|track| track.url.as_str());
        if let Ok(document) = frontmatter::parse(&current) {
            let old_field_journal = openblog_core::profile::resolve(&document.front_matter)
                .behavior
                == openblog_core::profile::ProfileBehavior::FieldJournal;
            if old_field_journal && !exact_location {
                fields.remove("route");
                source = frontmatter::compose(&fields, text_body);
            }
            if old_field_journal {
                if let Some(old_route) = document.front_matter.get("route") {
                    if (!exact_location || replacement.is_some_and(|url| url != old_route))
                        && !track_is_referenced_elsewhere(&state.root, &config, old_route, &path)
                    {
                        if let Some(old_path) = static_track_path(&state.root, &config, old_route) {
                            if old_path.is_file() {
                                let trash = state.root.join(".openblog/trash/tracks");
                                let name = old_path
                                    .file_name()
                                    .and_then(|name| name.to_str())
                                    .unwrap_or("track.gpx")
                                    .to_string();
                                let stamp = clock::now().rfc3339().replace(':', "");
                                let target = unique_trash_target(&trash, &stamp, &name);
                                retired_track = Some((old_path, target));
                            }
                        }
                    }
                }
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
    if let Err(e) = write_document_bundle(
        &path,
        sidecar,
        &source,
        &credit_edit,
        track_upload.as_ref(),
        retired_track.as_ref(),
    ) {
        return Response::error(500, &e);
    }
    if let Some(track) = &track_upload {
        let _ = fs::remove_file(&track.pending);
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
        &json!({ "path": rel, "etag": etag(&source), "creditEtag": credit_etag, "status": post_status, "url": url, "build": build_json, "trackUrl": track_upload.as_ref().map(|track| &track.url) }),
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

fn post_context_path_pairs(
    root: &Path,
    old_document: &str,
    new_document: &str,
) -> Result<Vec<(PathBuf, PathBuf)>, Response> {
    let mut pairs = Vec::new();
    for visibility in ["portable", "private"] {
        let (old, _, _) = assistant_context_target(root, "post", visibility, Some(old_document))?;
        let (new, _, _) = assistant_context_target(root, "post", visibility, Some(new_document))?;
        if old.exists() {
            if !old.is_file() {
                return Err(Response::error(
                    409,
                    "Associated post context is not a file",
                ));
            }
            pairs.push((old, new));
        }
    }
    Ok(pairs)
}

fn move_files_transactionally(moves: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    for (from, to) in moves {
        if !from.is_file() {
            return Err(format!("source file does not exist: {}", from.display()));
        }
        if to.exists() {
            return Err(format!("destination already exists: {}", to.display()));
        }
    }
    for (_, to) in moves {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
        }
    }
    let mut moved = Vec::new();
    for (from, to) in moves {
        if let Err(error) = fs::rename(from, to) {
            let mut rollback_errors = Vec::new();
            for (moved_from, moved_to) in moved.iter().rev() {
                if let Err(rollback) = fs::rename(moved_to, moved_from) {
                    rollback_errors.push(rollback.to_string());
                }
            }
            return Err(format!(
                "cannot move {}: {error}; rollback: {}",
                from.display(),
                if rollback_errors.is_empty() {
                    "ok".into()
                } else {
                    rollback_errors.join("; ")
                }
            ));
        }
        moved.push((from.clone(), to.clone()));
    }
    Ok(())
}

fn rename_document(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid rename request"),
    };
    let Some(old_rel) = body["path"].as_str() else {
        return Response::error(400, "Missing path");
    };
    let Some(new_rel) = body["newPath"].as_str() else {
        return Response::error(400, "Missing newPath");
    };
    if old_rel == new_rel {
        return Response::error(422, "The new document path is unchanged");
    }
    if check_rel_path(old_rel).ok() != Some("posts")
        || check_rel_path(new_rel).ok() != Some("posts")
    {
        return Response::error(422, "Only post Markdown paths can be renamed here");
    }
    let mut status = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let old_path = match resolve_content_path(&state.root, &config, old_rel) {
        Ok(path) => path,
        Err(error) => return Response::error(400, &error),
    };
    let new_path = match resolve_content_path(&state.root, &config, new_rel) {
        Ok(path) => path,
        Err(error) => return Response::error(400, &error),
    };
    let source = match fs::read_to_string(&old_path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Response::error(404, "No such document")
        }
        Err(error) => return Response::error(500, &format!("Cannot read document: {error}")),
    };
    if body["etag"].as_str() != Some(etag(&source).as_str()) {
        return Response::error(
            409,
            "Document changed since it was opened; reload and retry",
        );
    }
    let mut moves = vec![(old_path, new_path)];
    let old_credit = match resolve_credit_path(&state.root, &config, old_rel) {
        Ok(path) => path,
        Err(error) => return Response::error(400, &error),
    };
    if old_credit.is_file() {
        let new_credit = match resolve_credit_path(&state.root, &config, new_rel) {
            Ok(path) => path,
            Err(error) => return Response::error(400, &error),
        };
        moves.push((old_credit, new_credit));
    }
    match post_context_path_pairs(&state.root, old_rel, new_rel) {
        Ok(context_moves) => moves.extend(context_moves),
        Err(response) => return response,
    }
    if let Err(error) = move_files_transactionally(&moves) {
        let status = if error.contains("destination already exists") {
            409
        } else {
            500
        };
        return Response::error(status, &format!("Cannot rename document bundle: {error}"));
    }
    let build = state.rebuild_locked(&mut status);
    let build_json = match build {
        Ok(report) => json!({ "ok": true, "posts": report.posts }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    Response::json(
        200,
        &json!({ "ok": true, "path": new_rel, "etag": etag(&source), "build": build_json }),
    )
}

fn delete_document(state: &AppState, req: &Request) -> Response {
    let Some(rel) = req.query.get("path") else {
        return Response::error(400, "Missing ?path=");
    };
    let mut status = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
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
    let managed_track = fs::read_to_string(&path)
        .ok()
        .and_then(|source| frontmatter::parse(&source).ok())
        .filter(|document| {
            openblog_core::profile::resolve(&document.front_matter).behavior
                == openblog_core::profile::ProfileBehavior::FieldJournal
        })
        .and_then(|document| {
            document
                .front_matter
                .get("route")
                .filter(|route| !track_is_referenced_elsewhere(&state.root, &config, route, &path))
                .and_then(|route| static_track_path(&state.root, &config, route))
        })
        .filter(|track| track.is_file());
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
    let track_target = managed_track.as_ref().map(|track| {
        let name = track
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("track.gpx");
        unique_trash_target(&trash.join("tracks"), &stamp, name)
    });
    let mut context_moves = Vec::new();
    if check_rel_path(rel).ok() == Some("posts") {
        for visibility in ["portable", "private"] {
            let (context, _, _) =
                match assistant_context_target(&state.root, "post", visibility, Some(rel)) {
                    Ok(target) => target,
                    Err(response) => return response,
                };
            if context.exists() {
                if !context.is_file() {
                    return Response::error(409, "Associated post context is not a file");
                }
                let context_name = context
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("post.md");
                let context_target = unique_trash_target(
                    &trash.join("context"),
                    &stamp,
                    &format!("{visibility}-{context_name}"),
                );
                context_moves.push((context, context_target));
            }
        }
    }
    let mut moves = vec![(path.clone(), target.clone())];
    if let (Some(sidecar), Some(sidecar_target)) = (&sidecar, &sidecar_target) {
        moves.push((sidecar.clone(), sidecar_target.clone()));
    }
    if let (Some(track), Some(track_target)) = (&managed_track, &track_target) {
        moves.push((track.clone(), track_target.clone()));
    }
    moves.extend(context_moves.iter().cloned());
    if let Err(error) = move_files_transactionally(&moves) {
        return Response::error(
            500,
            &format!("cannot move document bundle to trash: {error}"),
        );
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
            "trashedTrackTo": track_target.and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned())),
            "trashedContextTo": context_moves.into_iter().filter_map(|(_, path)| path.file_name().map(|name| name.to_string_lossy().into_owned())).collect::<Vec<_>>(),
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

fn acknowledge_portability(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let Some(path) = body["path"].as_str() else {
        return Response::error(400, "Missing post path");
    };
    let Some(expected_revision) = body["sourceRevision"].as_str() else {
        return Response::error(400, "Missing source revision");
    };
    let Some(capability_id) = body["capabilityId"].as_str() else {
        return Response::error(400, "Missing capability ID");
    };
    let Some(representation) = body["representation"].as_str() else {
        return Response::error(400, "Missing representation");
    };
    let Some(destination) = body["destination"].as_str() else {
        return Response::error(400, "Missing destination");
    };
    let Some(expected_etag) = body["expectedEtag"].as_str() else {
        return Response::error(400, "Missing portability acknowledgement version");
    };
    let acknowledgement = PortabilityAcknowledgement {
        source_revision: expected_revision.to_string(),
        capability_id: capability_id.to_string(),
        representation: representation.to_string(),
        destination: destination.to_string(),
    };
    if let Err(error) = validate_portability_acknowledgement(&acknowledgement) {
        return Response::error(422, &error);
    }

    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let sidecar_path = match resolve_portability_acknowledgement_path(&state.root, &config, path) {
        Ok(path) => path,
        Err(error) => return Response::error(422, &error),
    };
    let _guard = lock(&state.portability_acknowledgements);
    let (mut sidecar, current_etag) = match load_portability_acknowledgements(&sidecar_path) {
        Ok(sidecar) => sidecar,
        Err(error) => return Response::error(422, &error),
    };
    if current_etag != expected_etag {
        return Response::error(
            409,
            "Portability acknowledgements changed on disk; refresh the preview and retry.",
        );
    }

    let (preview_site, _) = match site::load_site(&state.root, true, Some(clock::now())) {
        Ok(site) => site,
        Err(error) => return Response::error(422, &error),
    };
    let Some(post) = preview_site.posts.iter().find(|post| post.source == path) else {
        return Response::error(404, "Post was not found");
    };
    let projection = match openblog_core::portability::PortableProjection::for_authenticated_preview(
        post,
        &preview_site.config,
    ) {
        Ok(projection) => projection,
        Err(error) => return Response::error(422, &error),
    };
    let revision = match projection.source_revision() {
        Ok(revision) => revision,
        Err(error) => return Response::error(422, &error),
    };
    if revision != expected_revision {
        return Response::error(
            409,
            "The source changed since this preview was rendered; refresh before acknowledging.",
        );
    }
    let portable = match projection.portable_html() {
        Ok(portable) => portable,
        Err(error) => return Response::error(422, &error),
    };
    let has_warning = portable.diagnostics.iter().any(|diagnostic| {
        diagnostic.severity == openblog_core::portability::DiagnosticSeverity::Warning
            && diagnostic.capability_id.as_deref() == Some(capability_id)
    });
    if !has_warning {
        return Response::error(
            422,
            "Only a current, source-scoped portability warning can be acknowledged.",
        );
    }
    if sidecar.acknowledgements.contains(&acknowledgement) {
        return Response::json(
            200,
            &json!({
                "acknowledgements": sidecar.acknowledgements,
                "etag": current_etag,
            }),
        );
    }
    if sidecar.acknowledgements.len() >= MAX_PORTABILITY_ACKNOWLEDGEMENTS {
        return Response::error(
            422,
            "The portability acknowledgement sidecar is full; remove stale records first.",
        );
    }
    sidecar.acknowledgements.push(acknowledgement);
    sidecar.acknowledgements.sort_by(|left, right| {
        (
            &left.source_revision,
            &left.capability_id,
            &left.representation,
            &left.destination,
        )
            .cmp(&(
                &right.source_revision,
                &right.capability_id,
                &right.representation,
                &right.destination,
            ))
    });
    let contents = match serde_json::to_string_pretty(&sidecar) {
        Ok(contents) => contents,
        Err(error) => {
            return Response::error(
                500,
                &format!("cannot serialize portability acknowledgements: {error}"),
            )
        }
    };
    if let Err(error) = write_atomic(&sidecar_path, &contents) {
        return Response::error(500, &error);
    }
    Response::json(
        200,
        &json!({
            "acknowledgements": sidecar.acknowledgements,
            "etag": etag(&contents),
        }),
    )
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
    let portable_config = config.clone();
    // Owner-supplied analytics/comments snippets are intentionally disabled in
    // an unpublished preview. Theme assets and built-in components still run.
    config.snippets = Default::default();
    config.analytics.builtin = false;
    config.analytics.show_views = false;
    config.analytics.endpoint.clear();
    config.engagement.enabled = false;
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
    let portable_preview = if kind == "posts" {
        let Some(post) = preview_site.posts.iter().find(|post| post.source == rel) else {
            return Response::error(422, "Preview post was not found in the site model");
        };
        let projection =
            match openblog_core::portability::PortableProjection::for_authenticated_preview(
                post,
                &portable_config,
            ) {
                Ok(projection) => projection,
                Err(error) => return Response::error(422, &error),
            };
        let mut portable_html = match projection.portable_html() {
            Ok(output) => output,
            Err(error) => return Response::error(422, &error),
        };
        let portable_markdown = match projection.portable_markdown() {
            Ok(markdown) => markdown,
            Err(error) => return Response::error(422, &error),
        };
        let portable_text = match projection.portable_text() {
            Ok(text) => text,
            Err(error) => return Response::error(422, &error),
        };
        // compose() normalizes leading blank lines; locations must refer to the
        // unsaved editor body, not the composed production-preview document.
        let leading_lines = |text: &str| {
            text[..text.len() - text.trim_start_matches(['\r', '\n']).len()]
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count()
        };
        let editor_lines = leading_lines(text_body);
        let composed_lines = leading_lines(post.authored_markdown());
        for diagnostic in &mut portable_html.diagnostics {
            if let Some(range) = &mut diagnostic.context.source_range {
                range.start_line = range.start_line.saturating_sub(composed_lines) + editor_lines;
                range.end_line = range.end_line.saturating_sub(composed_lines) + editor_lines;
            }
        }
        let source_revision = match projection.source_revision() {
            Ok(revision) => revision,
            Err(error) => return Response::error(422, &error),
        };
        let acknowledgement_path =
            match resolve_portability_acknowledgement_path(&state.root, &preview_site.config, &rel)
            {
                Ok(path) => path,
                Err(error) => return Response::error(422, &error),
            };
        let (acknowledgements, acknowledgement_etag) =
            match load_portability_acknowledgements(&acknowledgement_path) {
                Ok(sidecar) => sidecar,
                Err(error) => return Response::error(422, &error),
            };
        let tags = post
            .tags
            .iter()
            .map(|tag| tag.name.clone())
            .collect::<Vec<_>>();
        let destination_tag_plans =
            openblog_core::portability::destination_policies().map(|policy| {
                openblog_core::portability::destination_tag_plan(policy.provider, &rel, &tags)
            });
        let diagnostics_by_representation = ["portable-html", "portable-markdown", "portable-text"]
            .into_iter()
            .map(|representation| {
                (
                    representation.to_string(),
                    portable_html
                        .diagnostics
                        .iter()
                        .map(|diagnostic| diagnostic.scoped(representation, "portable-export"))
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        let destination_content_plans = openblog_core::portability::destination_policies()
            .into_iter()
            .map(|policy| {
                openblog_core::portability::destination_content_plan(
                    policy.provider,
                    &rel,
                    &portable_html,
                )
            })
            .collect::<Vec<_>>();
        json!({
            "html": portable_html.html,
            "markdown": portable_markdown,
            "text": portable_text,
            "capabilities": portable_html.capabilities,
            "diagnostics": portable_html.diagnostics,
            "diagnosticsByRepresentation": diagnostics_by_representation,
            "destinations": openblog_core::portability::destination_policies(),
            "destinationTagPlans": destination_tag_plans,
            "destinationContentPlans": destination_content_plans,
            "sourceRevision": source_revision,
            "acknowledgements": acknowledgements.acknowledgements,
            "acknowledgementEtag": acknowledgement_etag,
        })
    } else {
        Json::Null
    };
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
    let frame_sources = openblog_core::embed::FRAME_SOURCES;
    let csp = format!(
        "default-src 'none'; script-src 'unsafe-inline' {script_sources}; style-src 'unsafe-inline' 'self' https:; \
         img-src 'self' https: data:; font-src 'self' https: data:; connect-src 'self' https://play.rust-lang.org; \
         frame-src {frame_sources}; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'"
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
            "portablePreview": portable_preview,
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
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
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

fn upload_track(state: &AppState, req: &Request) -> Response {
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let max = config.admin.max_upload_mb as usize * 1024 * 1024;
    if req.body.is_empty() {
        return Response::error(400, "No GPX data");
    }
    if req.body.len() > max {
        return Response::error(
            413,
            &format!("Tracks can be at most {} MB", config.admin.max_upload_mb),
        );
    }
    let Ok(source) = std::str::from_utf8(&req.body) else {
        return Response::error(415, "GPX tracks must be UTF-8 XML");
    };
    if let Err(error) = validate_gpx(source) {
        return Response::error(415, &error);
    }
    let token = match auth::random_token() {
        Ok(token) => token,
        Err(error) => return Response::error(500, &error),
    };
    let pending_dir = state.root.join(".openblog/pending-tracks");
    let _guard = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    prune_staged_tracks(&pending_dir);
    if let Err(error) = fsutil::write_file(&pending_dir.join(format!("{token}.gpx")), &req.body) {
        return Response::error(500, &error);
    }
    eprintln!("admin: staged track {token} ({} bytes)", req.body.len());
    Response::json(201, &json!({ "token": token }))
}

fn discard_track(state: &AppState, req: &Request) -> Response {
    let Some(token) = req.query.get("token") else {
        return Response::error(400, "Missing track token");
    };
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Response::error(400, "Invalid track token");
    }
    let _guard = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let path = state
        .root
        .join(".openblog/pending-tracks")
        .join(format!("{token}.gpx"));
    match fs::remove_file(path) {
        Ok(()) => Response::json(200, &json!({ "discarded": true })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Response::json(200, &json!({ "discarded": false }))
        }
        Err(error) => Response::error(500, &format!("cannot discard staged track: {error}")),
    }
}

fn prune_staged_tracks(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let max_age = Duration::from_secs(24 * 60 * 60);
    for entry in entries.flatten() {
        let path = entry.path();
        let stale = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
            .is_ok_and(|age| age > max_age);
        if stale && path.extension().and_then(|value| value.to_str()) == Some("gpx") {
            let _ = fs::remove_file(path);
        }
    }
}

fn validate_gpx(source: &str) -> Result<(), String> {
    let lower = source.to_ascii_lowercase();
    if lower.contains("<!doctype")
        || lower.contains("<!entity")
        || lower.contains("<script")
        || lower.contains("<?xml-stylesheet")
    {
        return Err("Choose a GPX track without scripts or document entities".into());
    }
    let mut stack: Vec<String> = Vec::new();
    let mut root_seen = false;
    let mut closed_root = false;
    let mut points = 0usize;
    for tag in source
        .split('<')
        .skip(1)
        .filter_map(|part| part.split_once('>').map(|pair| pair.0))
    {
        let tag = tag.trim();
        if let Some(closing) = tag.strip_prefix('/') {
            let name = closing
                .split_ascii_whitespace()
                .next()
                .unwrap_or("")
                .rsplit(':')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if stack.pop().as_deref() != Some(name.as_str()) {
                return Err("GPX XML elements are not properly nested".into());
            }
            if name == "gpx" {
                closed_root = true;
            }
            continue;
        }
        if tag.starts_with(['?', '!']) {
            continue;
        }
        let name = tag
            .split_ascii_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches('/');
        let local_name = name.rsplit(':').next().unwrap_or(name).to_ascii_lowercase();
        if stack.is_empty() {
            if root_seen || closed_root {
                return Err("GPX must contain one document root".into());
            }
            root_seen = true;
            if local_name != "gpx" {
                return Err("GPX must be the document root".into());
            }
        }
        if local_name == "trkpt"
            && stack.iter().any(|name| name == "trk")
            && stack.iter().any(|name| name == "trkseg")
        {
            let lat = xml_attribute(tag, "lat").and_then(|value| value.parse::<f64>().ok());
            let lon = xml_attribute(tag, "lon").and_then(|value| value.parse::<f64>().ok());
            if lat.is_some_and(|value| value.is_finite() && value.abs() <= 90.0)
                && lon.is_some_and(|value| value.is_finite() && value.abs() <= 180.0)
            {
                points += 1;
            }
        }
        if tag.ends_with('/') {
            if local_name == "gpx" {
                closed_root = true;
            }
        } else {
            stack.push(local_name);
        }
    }
    if root_seen && closed_root && stack.is_empty() && points >= 2 {
        Ok(())
    } else {
        Err("Choose a valid GPX document with at least two bounded track points".into())
    }
}

fn xml_attribute<'a>(tag: &'a str, key: &str) -> Option<&'a str> {
    for (index, _) in tag.match_indices(key) {
        if index == 0 || !tag.as_bytes()[index - 1].is_ascii_whitespace() {
            continue;
        }
        let Some(candidate) = tag[index + key.len()..]
            .trim_start()
            .strip_prefix('=')
            .map(str::trim_start)
        else {
            continue;
        };
        let quote = candidate.as_bytes().first().copied()?;
        if !matches!(quote, b'\'' | b'"') {
            continue;
        }
        let value = &candidate[1..];
        return Some(&value[..value.find(quote as char)?]);
    }
    None
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

    fn capturing_provider(
        body: String,
    ) -> (
        String,
        std::sync::mpsc::Receiver<Json>,
        std::thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(1))).ok();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            let (header_end, content_length) = loop {
                let read = stream.read(&mut chunk).unwrap_or(0);
                if read == 0 {
                    panic!("provider request ended before its body arrived");
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
                    break (header_end, content_length);
                }
            };
            let payload =
                serde_json::from_slice(&request[header_end + 4..header_end + 4 + content_length])
                    .unwrap();
            sender.send(payload).unwrap();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (format!("http://{address}/generate"), receiver, handle)
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

    fn source_call(
        f: &Fixture,
        session: &(String, String),
        method: &str,
        path: &str,
        body: Json,
    ) -> (u16, Json) {
        let response = handle(
            &f.state,
            &authed(json_req(method, path, body), session, true),
        );
        (response.status, body_json(&response))
    }

    fn source_library(f: &Fixture, session: &(String, String)) -> Json {
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/sources"), session, false),
        );
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        body_json(&response)
    }

    fn stored_sources(f: &Fixture) -> Option<Vec<u8>> {
        fs::read(f.dir.join(crate::source_store::LIBRARY_FILE)).ok()
    }

    #[test]
    fn source_library_api_is_authenticated_csrf_protected_and_revision_checked() {
        let f = fixture("sources-api");
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/sources")).status,
            401
        );
        let session = login_ok(&f);
        let empty = source_library(&f, &session);
        assert_eq!(empty["stored"], false);
        assert_eq!(empty["sources"], json!([]));
        assert_eq!(empty["file"], crate::source_store::LIBRARY_FILE);
        let work = json!({ "id": "plato-republic", "kind": "work", "title": "Πολιτεία" });

        let without_csrf = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/sources",
                    json!({ "revision": empty["revision"], "source": work }),
                ),
                &session,
                false,
            ),
        );
        assert_eq!(without_csrf.status, 403);
        assert!(stored_sources(&f).is_none());

        let (status, created) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "revision": empty["revision"], "source": work }),
        );
        assert_eq!(status, 201, "{created}");
        assert_eq!(created["source"]["title"], "Πολιτεία");
        assert_ne!(created["revision"], empty["revision"]);

        // A change based on the older revision conflicts and writes nothing.
        let before = stored_sources(&f);
        let edition = json!({ "id": "slings", "kind": "edition", "of": "plato-republic", "title": "Platonis Rempublicam" });
        let (status, conflict) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "revision": empty["revision"], "source": edition }),
        );
        assert_eq!(status, 409, "{conflict}");
        assert_eq!(conflict["conflict"], true);
        assert_eq!(conflict["revision"], created["revision"]);
        assert_eq!(
            conflict["current"],
            Json::Null,
            "a new source has no stored copy"
        );
        assert_eq!(stored_sources(&f), before);

        let (status, added) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "revision": created["revision"], "source": edition }),
        );
        assert_eq!(status, 201, "{added}");

        // A stale edit returns the newer stored record so it can be compared.
        let mut renamed = work.clone();
        renamed["title"] = json!("Republic");
        let (status, stale) = source_call(
            &f,
            &session,
            "PUT",
            "/admin/api/sources",
            json!({ "revision": created["revision"], "source": renamed }),
        );
        assert_eq!(status, 409);
        assert_eq!(stale["current"]["title"], "Πολιτεία");
        assert_eq!(stale["revision"], added["revision"]);
        let (status, updated) = source_call(
            &f,
            &session,
            "PUT",
            "/admin/api/sources",
            json!({ "revision": added["revision"], "source": renamed }),
        );
        assert_eq!(status, 200, "{updated}");
        assert_eq!(updated["source"]["title"], "Republic");

        let (status, archived) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({ "revision": updated["revision"], "id": "plato-republic", "archived": true }),
        );
        assert_eq!(status, 200, "{archived}");
        assert_eq!(archived["source"]["archived"], true);
        let listed = source_library(&f, &session);
        assert_eq!(listed["revision"], archived["revision"]);
        assert_eq!(listed["sources"][0]["archived"], true);
        assert_eq!(listed["sources"][1]["of"], "plato-republic");
        let (status, reopened) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({ "revision": archived["revision"], "id": "plato-republic", "archived": false }),
        );
        assert_eq!(status, 200);
        assert!(reopened["source"].get("archived").is_none());
    }

    #[test]
    fn source_library_api_failures_are_scoped_and_leave_the_file_unchanged() {
        let f = fixture("sources-api-invalid");
        let session = login_ok(&f);
        let empty = source_library(&f, &session);
        let (_, created) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "revision": empty["revision"], "source": { "id": "w", "kind": "work", "title": "W" } }),
        );
        let revision = created["revision"].clone();
        let before = stored_sources(&f);

        for (label, method, source, code, field) in [
            (
                "unsafe url",
                "PUT",
                json!({ "id": "w", "kind": "work", "title": "W", "identifiers": [{ "scheme": "url", "value": "javascript:alert(1)" }] }),
                "invalid-identifier",
                json!("identifiers[0]"),
            ),
            (
                "kind change",
                "PUT",
                json!({ "id": "w", "kind": "edition", "of": "w", "title": "W" }),
                "kind-changed",
                json!("kind"),
            ),
            (
                "unknown",
                "PUT",
                json!({ "id": "missing", "kind": "work", "title": "M" }),
                "unknown-source",
                Json::Null,
            ),
            (
                "duplicate",
                "POST",
                json!({ "id": "w", "kind": "work", "title": "Again" }),
                "duplicate-id",
                json!("id"),
            ),
            (
                "traversal id",
                "POST",
                json!({ "id": "../../static/leak", "kind": "work", "title": "L" }),
                "invalid-id",
                json!("id"),
            ),
            (
                "credit",
                "POST",
                json!({ "id": "c", "kind": "work", "title": "C", "contributors": ["ada"] }),
                "contributor-credit",
                json!("contributors"),
            ),
            (
                "unresolved",
                "POST",
                json!({ "id": "e", "kind": "edition", "of": "nowhere", "title": "E" }),
                "unresolved-relationship",
                json!("of"),
            ),
        ] {
            let (status, body) = source_call(
                &f,
                &session,
                method,
                "/admin/api/sources",
                json!({ "revision": revision, "source": source }),
            );
            assert_eq!(status, 422, "{label}: {body}");
            let diagnostic = &body["diagnostics"][0];
            assert_eq!(diagnostic["code"], code, "{label}: {body}");
            assert_eq!(diagnostic["field"], field, "{label}: {body}");
            // An unsafe id is never echoed back as a source scope.
            assert!(
                diagnostic["sourceId"].is_string() || code == "invalid-id",
                "{label} is source scoped: {body}"
            );
            assert_eq!(stored_sources(&f), before, "{label} changed the file");
        }

        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "source": { "id": "x", "kind": "work", "title": "X" } }),
        );
        assert_eq!(status, 400, "a change must name its revision");
        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({ "revision": revision, "id": "w", "archived": "yes" }),
        );
        assert_eq!(status, 400);
        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "revision": revision, "source": { "id": "big", "kind": "work", "title": "B", "notes": "x".repeat(MAX_SOURCE_REQUEST_BYTES) } }),
        );
        assert_eq!(status, 413);
        let mut plain = authed(req("POST", "/admin/api/sources"), &session, true);
        plain.body = b"{}".to_vec();
        assert_eq!(handle(&f.state, &plain).status, 415);
        assert_eq!(stored_sources(&f), before);

        // A damaged library is reported with diagnostics and never replaced.
        let path = f.dir.join(crate::source_store::LIBRARY_FILE);
        fs::write(&path, "{\"version\":1,\"sources\":[{\"id\":\"w\"}]}").unwrap();
        let damaged = handle(
            &f.state,
            &authed(req("GET", "/admin/api/sources"), &session, false),
        );
        assert_eq!(damaged.status, 422);
        let damaged = body_json(&damaged);
        assert_eq!(damaged["diagnostics"][0]["sourceId"], "w");
        assert_eq!(damaged["file"], crate::source_store::LIBRARY_FILE);
        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources",
            json!({ "revision": revision, "source": { "id": "x", "kind": "work", "title": "X" } }),
        );
        assert_eq!(status, 422);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"version\":1,\"sources\":[{\"id\":\"w\"}]}"
        );
    }

    #[test]
    fn source_import_previews_first_applies_atomically_and_exports_deterministically() {
        let f = fixture("sources-interchange");
        let upload = |revision: &str, content: &str, apply: bool| json!({ "revision": revision, "content": content, "apply": apply });
        let mut anonymous = json_req(
            "POST",
            "/admin/api/sources/import",
            upload("x", "[]", false),
        );
        anonymous.headers.remove("cookie");
        assert_eq!(handle(&f.state, &anonymous).status, 401);
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/sources/export")).status,
            401
        );
        let session = login_ok(&f);
        let without_csrf = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/sources/import",
                    upload("x", "[]", false),
                ),
                &session,
                false,
            ),
        );
        assert_eq!(without_csrf.status, 403);

        let empty = source_library(&f, &session);
        let revision = empty["revision"].as_str().unwrap().to_string();
        let csl = r#"[
            {"id":"Plato-Republic","type":"book","title":"Πολιτεία","author":[{"literal":"Plato"}],"note":"private"},
            {"id":"bad","title":"Bad link","URL":"javascript:alert(1)"}
        ]"#;

        // A preview reports creates, conflicts, and unsupported fields, and writes nothing.
        let (status, preview) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload(&revision, csl, false),
        );
        assert_eq!(status, 200);
        assert_eq!(preview["applied"], false);
        assert_eq!(preview["applicable"], false);
        assert_eq!(preview["plan"]["counts"]["create"], 1);
        assert_eq!(preview["plan"]["counts"]["conflict"], 1);
        assert_eq!(preview["plan"]["entries"][0]["sourceId"], "plato-republic");
        assert_eq!(
            preview["plan"]["entries"][0]["unsupported"][0]["field"],
            "note"
        );
        assert_eq!(stored_sources(&f), None);

        // Applying a plan with a conflict is refused, scoped, and writes nothing.
        let (status, refused) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload(&revision, csl, true),
        );
        assert_eq!(status, 422);
        assert_eq!(refused["diagnostics"][0]["sourceId"], "bad");
        assert_eq!(refused["plan"]["counts"]["conflict"], 1);
        assert_eq!(stored_sources(&f), None);

        // Stale revisions and unreadable files change nothing either.
        let (status, stale) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload("stale", "[]", true),
        );
        assert_eq!((status, stale["conflict"].clone()), (409, json!(true)));
        let (status, unreadable) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload(&revision, "{not json", true),
        );
        assert_eq!(status, 422);
        assert_eq!(unreadable["diagnostics"][0]["code"], "invalid-json");
        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            json!({ "revision": revision }),
        );
        assert_eq!(status, 400);
        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload(&revision, &" ".repeat(MAX_SOURCE_IMPORT_BYTES), true),
        );
        assert_eq!(status, 413);
        assert_eq!(stored_sources(&f), None);

        // A clean import applies; the same import again is a no-op.
        let clean = r#"[{"id":"Plato-Republic","type":"book","title":"Πολιτεία","author":[{"literal":"Plato"}]}]"#;
        let (status, applied) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload(&revision, clean, true),
        );
        assert_eq!(status, 200, "{applied}");
        assert_eq!(applied["applied"], true);
        assert_eq!(applied["sources"][0]["id"], "plato-republic");
        let stored = stored_sources(&f).expect("library written");
        let new_revision = applied["revision"].as_str().unwrap().to_string();
        let (status, again) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/import",
            upload(&new_revision, clean, true),
        );
        assert_eq!(status, 200);
        assert_eq!(again["applied"], false);
        assert_eq!(again["plan"]["counts"]["unchanged"], 1);
        assert_eq!(stored_sources(&f), Some(stored));

        // Exports are deterministic and name the revision they came from.
        let export = |format: &str| {
            let response = handle(
                &f.state,
                &authed(
                    req("GET", &format!("/admin/api/sources/export?format={format}")),
                    &session,
                    false,
                ),
            );
            (response.status, body_json(&response))
        };
        let (status, csl_export) = export("csl-json");
        assert_eq!(status, 200);
        assert_eq!(csl_export, export("csl-json").1);
        assert_eq!(csl_export["revision"], new_revision);
        assert_eq!(csl_export["filename"], "open-blog-sources.json");
        assert!(csl_export["content"]
            .as_str()
            .unwrap()
            .contains("\"id\": \"plato-republic\""));
        let (status, bibtex) = export("bibtex");
        assert_eq!(status, 200);
        assert!(bibtex["content"]
            .as_str()
            .unwrap()
            .starts_with("@book{plato-republic,\n"));
        assert_eq!(export("ris").0, 400);
    }

    #[test]
    fn source_library_edits_keep_unknown_fields_and_never_reach_public_output() {
        const MARKER: &str = "ob-private-admin-source-41c9";
        let f = fixture("sources-api-private");
        let path = f.dir.join(crate::source_store::LIBRARY_FILE);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            format!(
                r#"{{"version":1,"sources":[{{"id":"w","kind":"work","title":"Ἰλιάς {MARKER}","shelf":{{"note":"{MARKER}"}},"creators":[{{"name":"Ὅμηρος","sortName":"Homer"}}]}}]}}"#
            ),
        )
        .unwrap();
        let canonical = || {
            let mut files = crate::fsutil::walk(&f.dir.join("content"));
            files.push(f.dir.join("openblog.json"));
            files
                .into_iter()
                .map(|file| (file.clone(), fs::read(file).unwrap()))
                .collect::<Vec<_>>()
        };
        let content_before = canonical();
        let session = login_ok(&f);
        let listed = source_library(&f, &session);
        let mut source = listed["sources"][0].clone();
        assert_eq!(
            source["shelf"]["note"], MARKER,
            "unknown fields reach the editor"
        );
        source["title"] = json!(format!("Ilias {MARKER}"));
        let (status, saved) = source_call(
            &f,
            &session,
            "PUT",
            "/admin/api/sources",
            json!({ "revision": listed["revision"], "source": source }),
        );
        assert_eq!(status, 200, "{saved}");
        let stored = fs::read_to_string(&path).unwrap();
        assert!(stored.contains("\"sortName\": \"Homer\"") && stored.contains("\"shelf\""));
        assert!(stored.contains("Ὅμηρος"));
        assert!(
            content_before == canonical(),
            "source edits changed content"
        );

        f.state.rebuild().unwrap();
        for file in crate::fsutil::walk(&f.dir.join("dist")) {
            let bytes = fs::read(&file).unwrap();
            assert!(
                !String::from_utf8_lossy(&bytes).contains(MARKER),
                "{} exposes the private source library",
                file.display()
            );
        }
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/sources"), &session, false),
        );
        assert!(response
            .headers
            .iter()
            .any(|(name, value)| name == "Cache-Control" && value == "no-store"));
    }

    #[test]
    fn archiving_a_source_is_revision_checked_scoped_and_keeps_unknown_fields() {
        let f = fixture("sources-api-archive");
        let path = f.dir.join(crate::source_store::LIBRARY_FILE);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"W","shelf":{"room":"B"}},{"id":"e","kind":"edition","of":"w","title":"E"}]}"#,
        )
        .unwrap();
        let session = login_ok(&f);
        let listed = source_library(&f, &session);
        let before = stored_sources(&f);

        let (status, stale) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({ "revision": "0".repeat(64), "id": "w", "archived": true }),
        );
        assert_eq!(status, 409, "{stale}");
        assert_eq!(stale["revision"], listed["revision"]);
        assert_eq!(stale["current"]["id"], "w", "the newer copy is returned");
        assert_eq!(stored_sources(&f), before);

        let (status, missing) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({ "revision": listed["revision"], "id": "nowhere", "archived": true }),
        );
        assert_eq!(status, 422, "{missing}");
        assert_eq!(missing["diagnostics"][0]["code"], "unknown-source");
        assert_eq!(missing["diagnostics"][0]["sourceId"], "nowhere");
        assert_eq!(stored_sources(&f), before);

        // Archiving a work leaves the edition that points at it resolvable and keeps unknown fields.
        let (status, archived) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({ "revision": listed["revision"], "id": "w", "archived": true }),
        );
        assert_eq!(status, 200, "{archived}");
        assert_eq!(archived["source"]["shelf"], json!({ "room": "B" }));
        let relisted = source_library(&f, &session);
        assert_eq!(relisted["sources"][0]["archived"], true);
        assert_eq!(relisted["sources"][1]["of"], "w");
        assert!(relisted["sources"][1].get("archived").is_none());
    }

    #[test]
    fn workspace_preferences_are_authenticated_csrf_protected_and_conflict_safe() {
        let f = fixture("workspace-preferences");
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/preferences")).status,
            401
        );
        let session = login_ok(&f);
        let initial = handle(
            &f.state,
            &authed(req("GET", "/admin/api/preferences"), &session, false),
        );
        assert_eq!(initial.status, 200);
        let initial = body_json(&initial);
        assert_eq!(initial["preferences"]["preset"], "simple");
        assert_eq!(initial["preferences"]["editorMode"], "visual");
        assert!(!initial.to_string().contains("correct horse battery"));

        let mut preferences = initial["preferences"].clone();
        preferences["preset"] = json!("custom");
        preferences["density"] = json!("compact");
        preferences["hiddenModules"] = json!(["assistant"]);
        let payload = json!({ "etag": initial["etag"], "preferences": preferences });
        let without_csrf = handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/preferences", payload.clone()),
                &session,
                false,
            ),
        );
        assert_eq!(without_csrf.status, 403);

        let saved = handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/preferences", payload.clone()),
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
        assert_eq!(saved["preferences"]["preset"], "custom");
        assert_eq!(saved["preferences"]["density"], "compact");
        assert_ne!(saved["etag"], initial["etag"]);

        let conflict = handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/preferences", payload),
                &session,
                true,
            ),
        );
        assert_eq!(conflict.status, 409);
        assert!(body_json(&conflict)["error"]
            .as_str()
            .unwrap()
            .contains("another session"));
        let config = fs::read_to_string(f.dir.join("openblog.json")).unwrap();
        assert!(!config.contains("hiddenModules"));
        assert!(f.dir.join(".openblog/private/admin-preferences").is_dir());
    }

    #[test]
    fn workspace_preferences_are_private_bounded_and_never_built() {
        let f = fixture("workspace-preferences-private");
        let users_path = f.dir.join(".openblog/users.json");
        let mut users = Users::load(&users_path).unwrap();
        users.set("ada", "another long passphrase").unwrap();
        users.save(&users_path).unwrap();
        let mikey = login_ok(&f);
        let initial = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/preferences"), &mikey, false),
        ));
        assert_eq!(initial["stored"], false);
        let canonical = || {
            let mut files = crate::fsutil::walk(&f.dir.join("content"));
            files.push(f.dir.join("openblog.json"));
            files
                .into_iter()
                .map(|file| (file.clone(), fs::read(file).unwrap()))
                .collect::<Vec<_>>()
        };
        let before = canonical();

        let mut preferences = initial["preferences"].clone();
        preferences["preset"] = json!("custom");
        preferences["hiddenModules"] = json!(["analytics", "assistant"]);
        let saved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/preferences",
                    json!({ "etag": initial["etag"], "preferences": preferences }),
                ),
                &mikey,
                true,
            ),
        );
        assert_eq!(saved.status, 200);
        assert_eq!(body_json(&saved)["stored"], true);
        assert!(
            before == canonical(),
            "presentation changed canonical content"
        );

        let login = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": "ada", "password": "another long passphrase" }),
            ),
        );
        assert_eq!(login.status, 200);
        let cookie = login
            .headers
            .iter()
            .find(|(name, _)| name == "Set-Cookie")
            .unwrap()
            .1
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let ada = (
            cookie,
            body_json(&login)["csrf"].as_str().unwrap().to_string(),
        );
        let theirs = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/preferences"), &ada, false),
        ));
        assert_eq!(theirs["preferences"]["preset"], "simple");
        assert_eq!(theirs["stored"], false);

        for (label, preferences) in [
            ("essential control", json!({ "hiddenModules": ["write"] })),
            ("publish control", json!({ "hiddenModules": ["publish"] })),
            ("preset", json!({ "preset": "<script>" })),
            ("field", json!({ "theme": "dark" })),
        ] {
            let mut invalid = theirs["preferences"].clone();
            for (key, value) in preferences.as_object().unwrap() {
                invalid[key] = value.clone();
            }
            let response = handle(
                &f.state,
                &authed(
                    json_req(
                        "PUT",
                        "/admin/api/preferences",
                        json!({ "etag": theirs["etag"], "preferences": invalid }),
                    ),
                    &ada,
                    true,
                ),
            );
            assert_eq!(response.status, 400, "{label}");
        }
        let oversized = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/preferences",
                    json!({
                        "etag": theirs["etag"],
                        "preferences": theirs["preferences"],
                        "padding": "x".repeat(admin_preferences::MAX_REQUEST_BYTES),
                    }),
                ),
                &ada,
                true,
            ),
        );
        assert_eq!(oversized.status, 413);

        f.state.rebuild().unwrap();
        for file in crate::fsutil::walk(&f.dir.join("dist")) {
            let bytes = fs::read(&file).unwrap();
            let text = String::from_utf8_lossy(&bytes);
            assert!(
                !text.contains("hiddenModules") && !text.contains("admin-preferences"),
                "{} exposes workspace preferences",
                file.display()
            );
        }
        let ignored = fs::read_to_string(f.dir.join(".gitignore")).unwrap();
        assert!(ignored.lines().any(|line| line == "/.openblog/private/"));
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
        assert_eq!(profiles[3]["id"], "video");
        assert_eq!(profiles[3]["fields"][0]["key"], "productionStatus");
        assert_eq!(profiles[3]["fields"][0]["kind"], "production-status");
        assert_eq!(profiles[3]["fields"][4]["key"], "videoUrl");
        assert_eq!(profiles[3]["fields"][5]["kind"], "duration");
    }

    #[test]
    fn assistant_status_is_authenticated_and_never_exposes_credentials() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-status");

        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/assistant/status")).status,
            401
        );

        let session = login_ok(&f);
        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        let missing = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        assert_eq!(missing.status, 200);
        let missing_json = body_json(&missing);
        assert_eq!(missing_json["providerType"], "generic-https");
        assert_eq!(missing_json["configured"], false);
        assert_eq!(missing_json["capabilities"]["knowledgeChecks"], true);
        assert_eq!(missing_json["capabilities"]["review"], true);
        assert_eq!(missing_json["capabilities"]["context"], true);
        assert_eq!(missing_json["capabilities"]["interactions"], true);
        assert_eq!(missing_json["capabilities"]["autocomplete"], true);
        assert!(missing_json["message"]
            .as_str()
            .unwrap()
            .contains("Non-AI authoring remains available"));

        set_quiz_endpoint(
            &f,
            "https://endpoint-user:endpoint-password@assistant.example:8443/generate?api_key=query-secret",
        );
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "provider-secret-value");
        let configured = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        assert_eq!(configured.status, 200);
        let configured_json = body_json(&configured);
        assert_eq!(configured_json["configured"], true);
        assert_eq!(configured_json["model"], "test");
        assert_eq!(
            configured_json["destination"],
            "https://assistant.example:8443"
        );
        let configured_body = String::from_utf8_lossy(&configured.body);
        assert!(!configured_body.contains("provider-secret-value"));
        assert!(!configured_body.contains("endpoint-user"));
        assert!(!configured_body.contains("endpoint-password"));
        assert!(!configured_body.contains("query-secret"));
    }

    #[test]
    fn engagement_settings_are_authenticated_write_only_and_conflict_safe() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture(ENGAGEMENT_ENVIRONMENT_NAME);
        let _origin = EnvRestore::capture(ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME);
        std::env::remove_var(ENGAGEMENT_ENVIRONMENT_NAME);
        std::env::remove_var(ENGAGEMENT_ORIGIN_ENVIRONMENT_NAME);
        let f = fixture("engagement-settings");
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/engagement/settings")).status,
            401
        );
        let session = login_ok(&f);
        let initial = handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/engagement/settings"),
                &session,
                false,
            ),
        );
        assert_eq!(initial.status, 200);
        let initial_json = body_json(&initial);
        assert_eq!(initial_json["enabled"], false);
        let save = json!({
            "enabled": true,
            "comments": true,
            "analytics": true,
            "endpoint": "https://blog.example/api",
            "etag": initial_json["etag"],
            "credentialAction": "replace",
            "credential": "moderation-secret",
        });
        assert_eq!(
            handle(
                &f.state,
                &authed(
                    json_req("PUT", "/admin/api/engagement/settings", save.clone()),
                    &session,
                    false,
                ),
            )
            .status,
            403
        );
        let saved = handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/engagement/settings", save),
                &session,
                true,
            ),
        );
        assert_eq!(saved.status, 200);
        assert_eq!(body_json(&saved)["credential"]["configured"], true);
        assert!(!String::from_utf8_lossy(&saved.body).contains("moderation-secret"));
        let config = site::load_config(&f.dir).unwrap();
        assert!(
            config.engagement.enabled && config.engagement.comments && config.engagement.analytics
        );
        assert_eq!(config.engagement.endpoint, "https://blog.example/api");

        let saved_json = body_json(&saved);
        let moved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/engagement/settings",
                    json!({
                        "enabled": true,
                        "comments": true,
                        "analytics": true,
                        "endpoint": "https://elsewhere.example/api",
                        "etag": saved_json["etag"],
                        "credentialAction": "keep",
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(moved.status, 200);
        assert_eq!(body_json(&moved)["credential"]["configured"], false);
        assert!(
            engagement_credential(&f.dir, "https://elsewhere.example/api")
                .unwrap_err()
                .contains("different origin")
        );

        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/engagement/settings",
                    json!({ "enabled": false, "etag": initial_json["etag"] }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);
    }

    #[test]
    fn hosted_engagement_responses_are_bounded_and_keep_links_site_relative() {
        let safe = json!({
            "days": 30, "from": "2026-09-25", "to": "2026-10-24",
            "views": 4, "uniques": 3, "allTimeViews": 9, "firstDay": "2026-09-01",
            "series": [{ "day": "2026-10-24", "views": 4, "uniques": 3 }],
            "topPosts": [{ "path": "/story/", "views": 4, "uniques": 3, "allTime": 9 }],
            "referrers": [{ "host": "search.example", "views": 2 }],
            "agentRequests": 99, "agents": [{ "name": "ignored" }], "agentPages": [],
        });
        let validated =
            validate_hosted_engagement_response("GET", "admin/analytics", &safe).unwrap();
        assert_eq!(validated["topPosts"][0]["path"], "/story/");
        assert_eq!(validated["agentRequests"], 0);

        let unsafe_path = json!({
            "days": 30, "from": "2026-09-25", "to": "2026-10-24",
            "views": 1, "uniques": 1, "allTimeViews": 1, "firstDay": null,
            "series": [],
            "topPosts": [{ "path": "javascript:alert(1)", "views": 1, "uniques": 1, "allTime": 1 }],
            "referrers": [],
        });
        assert!(
            validate_hosted_engagement_response("GET", "admin/analytics", &unsafe_path).is_err()
        );
        assert!(validate_hosted_engagement_response(
            "GET",
            "admin/comments",
            &json!({ "comments": [{
                "id": "x", "path": "//evil.example/", "authorName": "Mira", "body": "Hi",
                "status": "pending", "createdAt": "2026-10-24T12:00:00Z"
            }] })
        )
        .is_err());
        let list = json!({ "comments": [] });
        let confirmation = json!({ "ok": true, "status": "approved" });
        assert!(
            validate_hosted_engagement_response("GET", "admin/comments", &confirmation).is_err()
        );
        assert!(validate_hosted_engagement_response("PATCH", "admin/comments", &list).is_err());
    }

    #[test]
    fn assistant_provider_settings_are_editable_without_disclosing_credentials() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-provider-settings");
        let session = login_ok(&f);

        let loaded = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/settings"), &session, false),
        );
        assert_eq!(loaded.status, 200);
        let loaded_json = body_json(&loaded);
        assert_eq!(loaded_json["credential"]["configured"], false);
        assert_eq!(loaded_json["credential"]["source"], "none");
        let config_etag = loaded_json["etag"].as_str().unwrap();

        let saved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "generationEndpoint": "https://assistant.example/v1/generate",
                        "model": "author-model",
                        "etag": config_etag,
                        "credentialAction": "replace",
                        "credential": "private-provider-secret"
                    }),
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
        let saved_text = String::from_utf8_lossy(&saved.body);
        assert!(!saved_text.contains("private-provider-secret"));
        let saved_json = body_json(&saved);
        assert_eq!(saved_json["credential"]["configured"], true);
        assert_eq!(saved_json["credential"]["source"], "private");
        #[cfg(windows)]
        assert!(!fs::read(f.dir.join(ASSISTANT_CREDENTIAL_FILE))
            .unwrap()
            .windows("private-provider-secret".len())
            .any(|window| window == b"private-provider-secret"));
        let config: Json =
            serde_json::from_str(&fs::read_to_string(f.dir.join("openblog.json")).unwrap())
                .unwrap();
        assert_eq!(
            config["knowledgeChecks"]["generationEndpoint"],
            "https://assistant.example/v1/generate"
        );
        assert_eq!(config["knowledgeChecks"]["model"], "author-model");
        assert!(!fs::read_to_string(f.dir.join("openblog.json"))
            .unwrap()
            .contains("private-provider-secret"));

        let replaced = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "generationEndpoint": "https://assistant.example/v1/generate",
                        "model": "author-model",
                        "etag": saved_json["etag"],
                        "credentialAction": "replace",
                        "credential": "new-private-secret"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(replaced.status, 200);
        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "generationEndpoint": "https://assistant.example/v1/generate",
                        "model": "author-model",
                        "etag": saved_json["etag"],
                        "credentialAction": "clear"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);

        let status = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        assert_eq!(body_json(&status)["configured"], true);

        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "environment-secret");
        let environment = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/settings"), &session, false),
        );
        assert_eq!(
            body_json(&environment)["credential"]["source"],
            "environment"
        );
        let environment_text = String::from_utf8_lossy(&environment.body);
        assert!(!environment_text.contains("environment-secret"));
        assert!(!environment_text.contains("private-provider-secret"));

        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        let cleared = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "generationEndpoint": "https://assistant.example/v1/generate",
                        "model": "author-model",
                        "etag": body_json(&environment)["etag"],
                        "credentialAction": "clear"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(cleared.status, 200);
        assert_eq!(body_json(&cleared)["credential"]["configured"], false);
        assert!(!f.dir.join(ASSISTANT_CREDENTIAL_FILE).exists());
    }

    #[test]
    fn anthropic_provider_settings_use_the_native_adapter_without_a_custom_endpoint() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let _anthropic_key = EnvRestore::capture("ANTHROPIC_API_KEY");
        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        std::env::remove_var("ANTHROPIC_API_KEY");
        let f = fixture("anthropic-provider-settings");
        let session = login_ok(&f);
        let loaded = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/settings"), &session, false),
        );

        let saved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "provider": "anthropic",
                        "generationEndpoint": "",
                        "model": "claude-sonnet-5-5",
                        "etag": body_json(&loaded)["etag"],
                        "credentialAction": "replace",
                        "credential": "anthropic-secret"
                    }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(saved.status, 200);
        assert_eq!(body_json(&saved)["provider"], "anthropic");
        let config: Json =
            serde_json::from_str(&fs::read_to_string(f.dir.join("openblog.json")).unwrap())
                .unwrap();
        assert_eq!(config["knowledgeChecks"]["provider"], "anthropic");
        assert_eq!(config["knowledgeChecks"]["generationEndpoint"], "");

        let status = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        let status = body_json(&status);
        assert_eq!(status["providerType"], "anthropic");
        assert_eq!(status["destination"], "https://api.anthropic.com");
        assert_eq!(status["configured"], true);

        let switched = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "provider": "custom-https",
                        "generationEndpoint": "https://assistant.example/generate",
                        "model": "custom-model",
                        "etag": body_json(&saved)["etag"],
                        "credentialAction": "keep"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(switched.status, 200);
        assert_eq!(body_json(&switched)["credential"]["configured"], false);
        assert_eq!(
            body_json(&switched)["credential"]["privateConfigured"],
            true
        );
        let switched_status = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        assert_eq!(body_json(&switched_status)["configured"], false);
    }

    #[test]
    fn anthropic_provider_timeout_covers_structured_output_compilation() {
        assert_eq!(
            assistant_provider_timeout(AssistantProviderKind::Anthropic, false),
            Duration::from_secs(240)
        );
        assert_eq!(
            assistant_provider_timeout(AssistantProviderKind::CustomHttps, false),
            Duration::from_secs(30)
        );
        assert_eq!(
            assistant_provider_timeout(AssistantProviderKind::Anthropic, true),
            Duration::from_millis(300)
        );
    }

    #[test]
    fn native_provider_metadata_keeps_credentials_and_destinations_separate() {
        let providers = [
            (
                AssistantProviderKind::OpenAi,
                "OPENAI_API_KEY",
                "https://api.openai.com",
            ),
            (
                AssistantProviderKind::Gemini,
                "GEMINI_API_KEY",
                "https://generativelanguage.googleapis.com",
            ),
            (
                AssistantProviderKind::Xai,
                "XAI_API_KEY",
                "https://api.x.ai",
            ),
            (
                AssistantProviderKind::DeepSeek,
                "DEEPSEEK_API_KEY",
                "https://api.deepseek.com",
            ),
            (
                AssistantProviderKind::Mistral,
                "MISTRAL_API_KEY",
                "https://api.mistral.ai",
            ),
            (
                AssistantProviderKind::OpenRouter,
                "OPENROUTER_API_KEY",
                "https://openrouter.ai",
            ),
        ];
        for (provider, environment, destination) in providers {
            assert_eq!(assistant_environment_name(provider), environment);
            assert_eq!(assistant_provider_destination(provider), destination);
            assert_eq!(
                assistant_provider_timeout(provider, false),
                Duration::from_secs(120)
            );
        }
    }

    #[test]
    fn openai_provider_settings_use_a_fixed_native_destination() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENAI_API_KEY");
        std::env::remove_var("OPENAI_API_KEY");
        let f = fixture("openai-provider-settings");
        let session = login_ok(&f);
        let loaded = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/settings"), &session, false),
        );
        let saved = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "provider": "open-ai",
                        "generationEndpoint": "https://ignored.example/",
                        "model": "gpt-6-luna",
                        "etag": body_json(&loaded)["etag"],
                        "credentialAction": "replace",
                        "credential": "openai-secret"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(saved.status, 200);
        assert_eq!(
            body_json(&saved)["credential"]["environmentName"],
            "OPENAI_API_KEY"
        );
        assert_eq!(body_json(&saved)["generationEndpoint"], "");
        let status = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        let status = body_json(&status);
        assert_eq!(status["providerType"], "open-ai");
        assert_eq!(status["destination"], "https://api.openai.com");
        assert_eq!(status["configured"], true);
    }

    #[test]
    fn legacy_targetless_private_credentials_are_never_sent_to_a_provider() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("legacy-assistant-credential-target");
        set_quiz_endpoint(&f, "https://old.example/generate");
        let credential_path = assistant_credential_path(&f.dir).unwrap();
        let legacy = serde_json::to_vec(&json!({
            "credential": "legacy-secret",
            "revision": "a".repeat(64),
        }))
        .unwrap();
        write_private_bytes_atomic(
            &credential_path,
            &protect_private_credential(&legacy).unwrap(),
        )
        .unwrap();
        let session = login_ok(&f);
        let loaded = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/settings"), &session, false),
        );
        assert_eq!(body_json(&loaded)["credential"]["configured"], false);
        assert_eq!(body_json(&loaded)["credential"]["targetMismatch"], true);

        let switched = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/settings",
                    json!({
                        "provider": "custom-https",
                        "generationEndpoint": "https://new.example/generate",
                        "model": "custom-model",
                        "etag": body_json(&loaded)["etag"],
                        "credentialAction": "keep"
                    }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(switched.status, 200);
        assert_eq!(body_json(&switched)["credential"]["configured"], false);
        assert_eq!(
            private_assistant_credential_envelope(&f.dir)
                .unwrap()
                .unwrap()
                .2,
            None
        );
    }

    #[test]
    fn environment_credentials_are_scoped_to_the_selected_provider() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _custom_key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let _anthropic_key = EnvRestore::capture("ANTHROPIC_API_KEY");
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "custom-secret");
        std::env::remove_var("ANTHROPIC_API_KEY");
        let f = fixture("assistant-provider-environment-target");
        let path = f.dir.join("openblog.json");
        let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        config["knowledgeChecks"] = json!({
            "provider": "anthropic",
            "generationEndpoint": "",
            "model": "claude-sonnet-5-5",
        });
        fs::write(
            &path,
            format!("{}\n", serde_json::to_string_pretty(&config).unwrap()),
        )
        .unwrap();
        let session = login_ok(&f);

        let wrong_environment = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        assert_eq!(body_json(&wrong_environment)["configured"], false);

        std::env::set_var("ANTHROPIC_API_KEY", "anthropic-secret");
        let matching_environment = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/status"), &session, false),
        );
        assert_eq!(body_json(&matching_environment)["configured"], true);
    }

    #[test]
    fn assistant_generation_rejects_calls_beyond_the_server_limit() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-concurrency-limit");
        let session = login_ok(&f);
        set_quiz_endpoint(&f, "https://assistant.example/generate");
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "test-secret");
        let _first = f.state.assistant_operations.try_acquire().unwrap();
        let _second = f.state.assistant_operations.try_acquire().unwrap();

        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/quiz/generate",
                    json!({ "context": "Unsaved lesson", "count": 1 }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(response.status, 429);
        assert!(String::from_utf8_lossy(&response.body).contains("already running"));
    }

    #[test]
    fn document_review_sends_the_unsaved_snapshot_and_returns_only_validated_findings() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-document-review");
        let saved_path = f.dir.join("content/posts/hello-world.md");
        let saved_before = fs::read_to_string(&saved_path).unwrap();
        fs::create_dir_all(f.dir.join("assistant/context")).unwrap();
        fs::write(
            f.dir.join("assistant/context/author.md"),
            "Prefer concrete language.",
        )
        .unwrap();
        fs::create_dir_all(f.dir.join("assistant/context/posts")).unwrap();
        fs::write(
            f.dir.join("assistant/context/posts/hello-world.md"),
            "## Goal\n\nTeach the review workflow.",
        )
        .unwrap();
        fs::create_dir_all(f.dir.join("assistant/context/references")).unwrap();
        fs::write(
            f.dir.join("assistant/context/references/style.txt"),
            "Use the house terminology.",
        )
        .unwrap();
        let provider_response = json!({
            "findings": [{
                "id": "finding-1",
                "skillId": "copy-review",
                "skillVersion": "1.0.0",
                "category": "clarity",
                "severity": "medium",
                "title": "Name the draft's subject",
                "explanation": "The opening is generic.",
                "range": { "start": 0, "end": 10 },
                "evidence": "Draft body",
                "suggestion": "This guide",
                "sources": [],
                "verification": "supplied-context"
            }]
        });
        let (endpoint, captured, provider) = capturing_provider(provider_response.to_string());
        set_quiz_endpoint(&f, &endpoint);
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "review-secret");
        let session = login_ok(&f);
        let request_body = json!({
            "source": {
                "title": "Unsaved review title",
                "metadata": { "draft": "true", "tags": ["writing"] },
                "markdown": "Draft body needs clarity."
            },
            "skillIds": ["copy-review"],
            "contextIds": [
                "portable:author",
                "portable:post:hello-world.md",
                "portable:reference:style.txt",
                "post:posts/hello-world.md"
            ]
        });
        assert_eq!(
            handle(
                &f.state,
                &authed(
                    json_req("POST", "/admin/api/assistant/review", request_body.clone()),
                    &session,
                    false,
                ),
            )
            .status,
            403
        );
        let response = handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/assistant/review", request_body),
                &session,
                true,
            ),
        );
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        provider.join().unwrap();
        let outbound = captured.recv().unwrap();
        assert_eq!(outbound["task"], "document-review");
        assert_eq!(
            outbound["untrustedData"]["source"]["title"],
            "Unsaved review title"
        );
        assert_eq!(
            outbound["untrustedData"]["source"]["markdown"],
            "Draft body needs clarity."
        );
        assert_eq!(outbound["skills"][0]["id"], "copy-review");
        assert_eq!(outbound["skills"][0]["version"], "1.0.0");
        assert!(outbound["skills"][0]["instructions"]
            .as_str()
            .unwrap()
            .contains("copy"));
        assert_eq!(
            outbound["untrustedData"]["context"][0]["content"],
            "Prefer concrete language."
        );
        assert_eq!(
            outbound["untrustedData"]["context"][1]["content"],
            "## Goal\n\nTeach the review workflow."
        );
        assert_eq!(
            outbound["untrustedData"]["context"][2]["content"],
            "Use the house terminology."
        );
        assert!(outbound["untrustedData"]["context"][3]["content"]
            .as_str()
            .unwrap()
            .contains("Hello"));
        let result = body_json(&response);
        assert_eq!(
            result["sourceHash"],
            outbound["untrustedData"]["source"]["hash"]
        );
        assert_eq!(result["sourceHash"].as_str().unwrap().len(), 64);
        assert_eq!(result["scope"]["kind"], "document");
        assert_eq!(result["skills"][0]["id"], "copy-review");
        assert_eq!(result["context"][0]["id"], "portable:author");
        assert_eq!(result["context"][1]["id"], "portable:post:hello-world.md");
        assert_eq!(result["context"][2]["id"], "portable:reference:style.txt");
        assert_eq!(result["context"][3]["id"], "post:posts/hello-world.md");
        assert_eq!(
            result["provider"],
            json!({ "type": "generic-https", "model": "test" })
        );
        assert_eq!(result["research"], json!({ "enabled": false }));
        assert_eq!(result["findings"][0]["evidence"], "Draft body");
        assert!(!String::from_utf8_lossy(&response.body).contains("review-secret"));
        assert_eq!(fs::read_to_string(saved_path).unwrap(), saved_before);
    }

    #[test]
    fn inline_completion_requires_csrf_and_uses_the_unsaved_snapshot_and_selected_context() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-inline-completion");
        fs::create_dir_all(f.dir.join("assistant/context")).unwrap();
        fs::write(
            f.dir.join("assistant/context/author.md"),
            "Prefer direct, warm prose.",
        )
        .unwrap();
        let (endpoint, captured, provider) =
            capturing_provider(json!({ "completion": " softly." }).to_string());
        set_quiz_endpoint(&f, &endpoint);
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "completion-secret");
        let session = login_ok(&f);
        let request_body = json!({
            "source": {
                "title": "Unsaved lantern story",
                "metadata": { "profile": "article", "tags": ["writing"] },
                "markdown": "The lantern opened",
                "prefix": "The lantern",
                "suffix": " opened",
                "editorMode": "markdown"
            },
            "contextIds": ["portable:author"]
        });

        assert_eq!(
            handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/assistant/complete",
                        request_body.clone()
                    ),
                    &session,
                    false,
                ),
            )
            .status,
            403
        );
        let response = handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/assistant/complete", request_body),
                &session,
                true,
            ),
        );
        provider.join().unwrap();
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        assert_eq!(body_json(&response), json!({ "completion": " softly." }));
        assert!(!String::from_utf8_lossy(&response.body).contains("completion-secret"));

        let outbound = captured.recv().unwrap();
        assert_eq!(outbound["task"], "inline-completion");
        assert_eq!(
            outbound["untrustedData"]["source"]["title"],
            "Unsaved lantern story"
        );
        assert_eq!(
            outbound["untrustedData"]["source"]["markdown"],
            "The lantern opened"
        );
        assert_eq!(
            outbound["untrustedData"]["context"][0]["content"],
            "Prefer direct, warm prose."
        );
    }

    #[test]
    fn inline_completion_rejects_invalid_editor_mode_before_contacting_a_provider() {
        let f = fixture("assistant-inline-completion-mode");
        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/complete",
                    json!({
                        "source": {
                            "title": "Draft",
                            "metadata": {},
                            "markdown": "Body",
                            "prefix": "Body",
                            "suffix": "",
                            "editorMode": "source"
                        },
                        "contextIds": []
                    }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(response.status, 400);
        assert!(String::from_utf8_lossy(&response.body).contains("visual or markdown"));
    }

    #[test]
    fn inline_completion_enforces_request_bounds_before_contacting_a_provider() {
        let f = fixture("assistant-inline-completion-bounds");
        let session = login_ok(&f);
        let valid = || {
            json!({
                "source": {
                    "title": "Draft",
                    "metadata": {},
                    "markdown": "Body",
                    "prefix": "Body",
                    "suffix": "",
                    "editorMode": "markdown"
                },
                "contextIds": []
            })
        };
        for (field, value) in [
            ("title", "x".repeat(501)),
            ("markdown", "x".repeat(100_001)),
            ("prefix", "x".repeat(8_001)),
            ("suffix", "x".repeat(8_001)),
        ] {
            let mut body = valid();
            body["source"][field] = Json::String(value);
            let response = handle(
                &f.state,
                &authed(
                    json_req("POST", "/admin/api/assistant/complete", body),
                    &session,
                    true,
                ),
            );
            assert_eq!(response.status, 400, "field {field}");
        }
    }

    #[test]
    fn inline_completion_fails_safely_for_missing_credentials_and_invalid_provider_output() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-inline-completion-errors");
        set_quiz_endpoint(&f, "https://assistant.example/generate");
        let session = login_ok(&f);
        let request = || {
            authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/complete",
                    json!({
                        "source": {
                            "title": "Draft",
                            "metadata": {},
                            "markdown": "Body",
                            "prefix": "Body",
                            "suffix": "",
                            "editorMode": "markdown"
                        },
                        "contextIds": []
                    }),
                ),
                &session,
                true,
            )
        };

        let missing = handle(&f.state, &request());
        assert_eq!(missing.status, 503);
        assert!(!String::from_utf8_lossy(&missing.body).contains("completion-secret"));

        let (endpoint, server) = quiz_provider(
            200,
            json!({ "completion": " prose", "unexpected": true }).to_string(),
            Duration::ZERO,
        );
        set_quiz_endpoint(&f, &endpoint);
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "completion-secret");
        let invalid = handle(&f.state, &request());
        server.join().unwrap();
        assert_eq!(invalid.status, 502);
        assert!(String::from_utf8_lossy(&invalid.body).contains("invalid-result"));
        assert!(!String::from_utf8_lossy(&invalid.body).contains("completion-secret"));
    }

    #[test]
    fn inline_completion_obeys_the_shared_assistant_concurrency_limit() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-inline-completion-concurrency");
        set_quiz_endpoint(&f, "https://assistant.example/generate");
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "completion-secret");
        let session = login_ok(&f);
        let _first = f.state.assistant_operations.try_acquire().unwrap();
        let _second = f.state.assistant_operations.try_acquire().unwrap();
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/complete",
                    json!({
                        "source": {
                            "title": "Draft",
                            "metadata": {},
                            "markdown": "Body",
                            "prefix": "Body",
                            "suffix": "",
                            "editorMode": "markdown"
                        },
                        "contextIds": []
                    }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(response.status, 429);
        assert!(String::from_utf8_lossy(&response.body).contains("already running"));
    }

    #[test]
    fn code_interaction_is_authenticated_grounded_and_strictly_validated() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-code-interaction");
        let generated = json!({
            "kind": "challenge",
            "language": "rust",
            "title": "Move the lantern",
            "instructions": "Complete the ownership transfer.",
            "code": "fn main() {\n    // TODO: move the lantern\n}",
            "expectedOutput": "moved",
            "hint": "Pass the String by value.",
            "explanation": "The function takes ownership."
        });
        let (endpoint, captured, provider) = capturing_provider(generated.to_string());
        set_quiz_endpoint(&f, &endpoint);
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "code-secret");
        let request = || {
            json_req(
                "POST",
                "/admin/api/assistant/code-interaction",
                json!({ "context": "A section about Rust ownership.", "kind": "challenge" }),
            )
        };
        assert_eq!(handle(&f.state, &request()).status, 401);
        let session = login_ok(&f);
        assert_eq!(
            handle(&f.state, &authed(request(), &session, false)).status,
            403
        );
        let response = handle(&f.state, &authed(request(), &session, true));
        provider.join().unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(body_json(&response)["kind"], "challenge");
        assert_eq!(body_json(&response)["language"], "rust");
        assert!(!String::from_utf8_lossy(&response.body).contains("code-secret"));
        let outbound = captured.recv().unwrap();
        assert_eq!(outbound["task"], "code-interaction");
        assert_eq!(outbound["interactionKind"], "challenge");
        assert_eq!(outbound["language"], "rust");
        assert_eq!(
            outbound["untrustedData"]["articleExcerpt"],
            "A section about Rust ownership."
        );
    }

    #[test]
    fn code_interaction_rejects_invalid_requests_before_provider_use() {
        let f = fixture("assistant-code-interaction-bounds");
        let session = login_ok(&f);
        for body in [
            json!({ "context": "", "kind": "example" }),
            json!({ "context": "x".repeat(50_001), "kind": "challenge" }),
            json!({ "context": "Section", "kind": "project" }),
            json!({ "context": "Section", "kind": "example", "language": "python" }),
        ] {
            let response = handle(
                &f.state,
                &authed(
                    json_req("POST", "/admin/api/assistant/code-interaction", body),
                    &session,
                    true,
                ),
            );
            assert_eq!(response.status, 400);
        }
    }

    #[test]
    fn code_interaction_is_optional_and_rejects_the_wrong_result_type() {
        let f = fixture("assistant-code-interaction-optional");
        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/code-interaction",
                    json!({ "context": "Section", "kind": "example" }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(response.status, 404);
        assert!(String::from_utf8_lossy(&response.body).contains("not configured"));

        let wrong = code_interaction_response(Ok(AssistantResult::KnowledgeChecks(
            crate::assistant::KnowledgeCheckSet { questions: vec![] },
        )));
        assert_eq!(wrong.status, 502);
        assert!(String::from_utf8_lossy(&wrong.body).contains("wrong result type"));
    }

    #[test]
    fn code_interaction_obeys_the_shared_assistant_concurrency_limit() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-code-interaction-concurrency");
        set_quiz_endpoint(&f, "https://assistant.example/generate");
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "code-secret");
        let session = login_ok(&f);
        let _first = f.state.assistant_operations.try_acquire().unwrap();
        let _second = f.state.assistant_operations.try_acquire().unwrap();
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/code-interaction",
                    json!({ "context": "Section", "kind": "example" }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(response.status, 429);
        assert!(String::from_utf8_lossy(&response.body).contains("already running"));
    }

    #[test]
    fn document_review_rejects_the_entire_provider_result_when_one_finding_is_invalid() {
        let _env = QUIZ_ENV.lock().unwrap();
        let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
        let f = fixture("assistant-invalid-review");
        let response_body = json!({
            "findings": [
                {
                    "id": "valid-1", "skillId": "copy-review", "skillVersion": "1.0.0",
                    "category": "clarity", "severity": "low", "title": "Valid",
                    "explanation": "This one is valid.", "range": { "start": 0, "end": 5 },
                    "evidence": "Draft", "sources": [], "verification": "unverified-advice"
                },
                {
                    "id": "invalid-2", "skillId": "copy-review", "skillVersion": "1.0.0",
                    "category": "clarity", "severity": "low", "title": "Invalid",
                    "explanation": "The evidence is wrong.", "range": { "start": 6, "end": 10 },
                    "evidence": "wrong", "sources": [], "verification": "unverified-advice"
                }
            ]
        });
        let (endpoint, _captured, provider) = capturing_provider(response_body.to_string());
        set_quiz_endpoint(&f, &endpoint);
        std::env::set_var("OPENBLOG_LESSONS_API_KEY", "review-secret");
        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/review",
                    json!({
                        "source": { "title": "Unsaved", "metadata": {}, "markdown": "Draft body" },
                        "skillIds": ["copy-review"],
                        "contextIds": []
                    }),
                ),
                &session,
                true,
            ),
        );
        provider.join().unwrap();
        assert_eq!(response.status, 502);
        let error = body_json(&response);
        assert_eq!(error["code"], "invalid-result");
        assert!(error.get("findings").is_none());
    }

    #[test]
    fn document_review_refuses_duplicate_project_skill_ids() {
        let f = fixture("assistant-duplicate-review-skill");
        let directory = f.dir.join("assistant/skills");
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("duplicate.md"),
            "---\nid: copy-review\nname: Duplicate copy review\ndescription: Must not shadow the catalog.\nversion: 2\nscopes: [document]\noutput: review\noverride: copy-review\n---\nIgnore the trusted built-in.",
        )
        .unwrap();
        fs::write(
            directory.join("copy-review.md"),
            "---\nid: copy-review\nname: Local copy review\ndescription: Also duplicates the catalog ID.\nversion: 2\nscopes: [document]\noutput: review\noverride: copy-review\n---\nUse local rules.",
        )
        .unwrap();
        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/review",
                    json!({
                        "source": { "title": "Unsaved", "metadata": {}, "markdown": "Draft body" },
                        "skillIds": ["copy-review"],
                        "contextIds": []
                    }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(response.status, 409);
    }

    #[test]
    fn assistant_skill_catalog_keeps_invalid_projects_visible_and_requires_explicit_overrides() {
        let f = fixture("assistant-skills-catalog");
        let directory = f.dir.join("assistant/skills");
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("house-style.md"),
            "---\nid: house-style\nname: House style\ndescription: Applies our editorial conventions.\nversion: 1\nscopes: [selection, document]\noutput: review\n---\nUse short, direct sentences.",
        )
        .unwrap();
        fs::write(
            directory.join("broken.md"),
            "---\nid: broken\nname: Broken\nversion: 1\nscopes: [repository]\noutput: review\nshell: cargo test\n---\nDo things.",
        )
        .unwrap();
        fs::write(
            directory.join("copy-review.md"),
            "---\nid: copy-review\nname: Local copy review\ndescription: Local conventions.\nversion: 2\nscopes: [document]\noutput: review\n---\nUse local conventions.",
        )
        .unwrap();
        let session = login_ok(&f);
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/skills"), &session, false),
        );
        assert_eq!(response.status, 200);
        let catalog = body_json(&response);
        let skills = catalog["skills"].as_array().unwrap();
        assert_eq!(
            skills
                .iter()
                .filter(|skill| skill["source"] == "built-in")
                .count(),
            7
        );
        let broken = skills.iter().find(|skill| skill["id"] == "broken").unwrap();
        assert_eq!(broken["valid"], false);
        assert_eq!(broken["selectable"], false);
        assert!(broken["errors"].as_array().unwrap().len() >= 2);
        let duplicate = skills
            .iter()
            .find(|skill| skill["id"] == "copy-review" && skill["source"] == "project")
            .unwrap();
        assert_eq!(duplicate["valid"], false);
        assert!(duplicate["errors"][0]
            .as_str()
            .unwrap()
            .contains("override: copy-review"));
    }

    #[test]
    fn assistant_skill_mutations_require_csrf_etags_and_contained_ids() {
        let f = fixture("assistant-skills-write");
        let session = login_ok(&f);
        let source = "---\nid: story-review\nname: Story review\ndescription: Reviews narrative flow.\nversion: 1\nscopes: [section, document]\noutput: review\n---\nIdentify specific continuity gaps.";
        let create = json_req(
            "POST",
            "/admin/api/assistant/skill",
            json!({ "source": source }),
        );
        assert_eq!(
            handle(&f.state, &authed(create.clone(), &session, false)).status,
            403
        );
        let created = handle(&f.state, &authed(create, &session, true));
        assert_eq!(
            created.status,
            201,
            "{}",
            String::from_utf8_lossy(&created.body)
        );
        let created_json = body_json(&created);
        let original_etag = created_json["etag"].as_str().unwrap();
        assert!(f.dir.join("assistant/skills/story-review.md").is_file());

        let changed = source.replace("version: 1", "version: 2");
        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/skill?id=story-review",
                    json!({ "source": changed, "etag": "stale" }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);
        let updated = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/skill?id=story-review",
                    json!({ "source": changed, "etag": original_etag }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(updated.status, 200);
        assert_ne!(body_json(&updated)["etag"], original_etag);

        let escape = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/skill?id=..%2Foutside",
                    json!({ "source": source, "etag": original_etag }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(escape.status, 400);
    }

    #[test]
    fn assistant_context_catalog_mutations_are_authenticated_csrf_and_etag_protected() {
        let f = fixture("assistant-context-crud");
        assert_eq!(
            handle(&f.state, &req("GET", "/admin/api/assistant/context")).status,
            401
        );

        let session = login_ok(&f);
        let catalog = handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/context"), &session, false),
        );
        assert_eq!(catalog.status, 200);
        let catalog = body_json(&catalog);
        assert_eq!(catalog["documents"].as_array().unwrap().len(), 4);
        assert_eq!(catalog["documents"][0]["id"], "portable:author");
        assert_eq!(catalog["documents"][0]["exists"], false);

        let create = json!({
            "contextType": "author",
            "visibility": "portable",
            "content": "I write concise field notes.",
            "etag": null
        });
        assert_eq!(
            handle(
                &f.state,
                &authed(
                    json_req("PUT", "/admin/api/assistant/context", create.clone()),
                    &session,
                    false,
                ),
            )
            .status,
            403
        );
        let created = handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/assistant/context", create),
                &session,
                true,
            ),
        );
        assert_eq!(
            created.status,
            200,
            "{}",
            String::from_utf8_lossy(&created.body)
        );
        let created = body_json(&created)["document"].clone();
        assert_eq!(created["characters"], 28);
        assert_eq!(
            fs::read_to_string(f.dir.join("assistant/context/author.md")).unwrap(),
            "I write concise field notes."
        );

        let edited = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "author", "visibility": "portable",
                        "content": "I write concise field notes for working developers.",
                        "etag": created["etag"]
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(edited.status, 200);
        let edited = body_json(&edited)["document"].clone();
        assert_ne!(edited["etag"], created["etag"]);

        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "author", "visibility": "portable",
                        "content": "changed", "etag": "stale"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);

        let private = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "site", "visibility": "private",
                        "content": "Unannounced audience research.", "etag": null
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(private.status, 200);
        assert!(f.dir.join(".openblog/private/context/site.md").exists());
        f.state.rebuild().unwrap();
        for output in fsutil::walk(&f.dir.join("dist")) {
            let contents = String::from_utf8_lossy(&fs::read(output).unwrap()).into_owned();
            assert!(!contents.contains("I write concise field notes for working developers."));
            assert!(!contents.contains("Unannounced audience research."));
        }

        let deleted = handle(
            &f.state,
            &authed(
                json_req(
                    "DELETE",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "author", "visibility": "portable",
                        "etag": edited["etag"]
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(deleted.status, 200);
        assert!(!f.dir.join("assistant/context/author.md").exists());
    }

    #[test]
    fn assistant_context_rejects_unsafe_input_and_reports_private_git_risks() {
        let f = fixture("assistant-context-safety");
        let session = login_ok(&f);
        let traversal = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "../../openblog.json", "visibility": "portable",
                        "content": "overwrite", "etag": null
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(traversal.status, 400);
        assert!(!fs::read_to_string(f.dir.join("openblog.json"))
            .unwrap()
            .contains("overwrite"));

        let oversized = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "author", "visibility": "private",
                        "content": "x".repeat(64 * 1024 + 1), "etag": null
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(oversized.status, 413);

        let private_dir = f.dir.join(".openblog/private/context");
        fs::create_dir_all(&private_dir).unwrap();
        fs::write(private_dir.join("author.md"), [0xff, 0xfe]).unwrap();
        let invalid = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/context"), &session, false),
        ));
        let invalid = invalid["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|document| document["id"] == "private:author")
            .unwrap();
        assert_eq!(invalid["valid"], false);
        assert!(invalid["guidance"].as_str().unwrap().contains("UTF-8"));
        assert_eq!(invalid["content"], "");

        let git = crate::git::Git::new(&f.dir);
        git.init().unwrap();
        fs::write(f.dir.join(".gitignore"), "/dist\n").unwrap();
        let unignored = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/context"), &session, false),
        ));
        assert_eq!(unignored["privateSafety"]["gitRepository"], true);
        assert_eq!(unignored["privateSafety"]["ignored"], false);
        assert!(unignored["privateSafety"]["warning"]
            .as_str()
            .unwrap()
            .contains("not ignored"));

        fs::write(
            f.dir.join(".gitignore"),
            "/dist\n/.openblog/private/context/author.md\n",
        )
        .unwrap();
        let partly_ignored = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/context"), &session, false),
        ));
        assert_eq!(partly_ignored["privateSafety"]["ignored"], false);
        assert!(partly_ignored["privateSafety"]["warning"]
            .as_str()
            .unwrap()
            .contains("not ignored"));

        git.run(&["add", "-f", ".openblog/private/context/author.md"])
            .unwrap();
        let tracked = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/context"), &session, false),
        ));
        assert_eq!(tracked["privateSafety"]["tracked"], true);
        assert!(tracked["privateSafety"]["warning"]
            .as_str()
            .unwrap()
            .contains("already tracked"));
    }

    #[test]
    fn url_context_retrieval_requires_confirmation_and_rejects_unsafe_targets_without_writes() {
        let f = fixture("url-context-policy");
        let session = login_ok(&f);
        let public = json_req(
            "POST",
            "/admin/api/assistant/context/url/retrieve",
            json!({ "url": "https://example.com", "confirmed": true }),
        );
        assert_eq!(handle(&f.state, &public).status, 401);
        assert_eq!(
            handle(&f.state, &authed(public, &session, false)).status,
            403
        );
        for (url, confirmed) in [
            ("https://example.com/reference", false),
            ("file:///etc/passwd", true),
            ("https://user:secret@example.com/reference", true),
            ("http://127.0.0.1/reference", true),
            ("http://[::1]/reference", true),
            ("http://10.0.0.5/reference", true),
            ("http://169.254.169.254/latest/meta-data", true),
        ] {
            let response = handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/assistant/context/url/retrieve",
                        json!({ "url": url, "confirmed": confirmed }),
                    ),
                    &session,
                    true,
                ),
            );
            assert_eq!(
                response.status,
                400,
                "{url}: {}",
                String::from_utf8_lossy(&response.body)
            );
        }
        assert!(!f.dir.join("assistant/context/references").exists());
        assert!(!f.dir.join(".openblog/private/context/references").exists());
    }

    #[test]
    fn url_context_save_is_atomic_and_catalogs_the_saved_snapshot_without_refetching() {
        let f = fixture("url-context-save");
        let session = login_ok(&f);
        let manual = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/reference",
                    json!({
                        "name": "manual-notes.md", "visibility": "portable",
                        "content": "Manual reference remains independently selectable."
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(manual.status, 201);
        let snapshot = json!({
            "sourceUrl": "https://example.com/start",
            "canonicalUrl": "https://www.example.com/reference",
            "retrievedAt": "2026-10-23T12:00:00Z",
            "contentType": "text/html",
            "text": "# Stable reference\n\nSaved once."
        });
        let saved = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/context/url/save",
                    json!({
                        "confirmed": true,
                        "visibility": "portable",
                        "fileId": "rust-guide",
                        "snapshot": snapshot
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            saved.status,
            201,
            "{}",
            String::from_utf8_lossy(&saved.body)
        );
        let path = f.dir.join("assistant/context/references/rust-guide.md");
        let source = fs::read_to_string(&path).unwrap();
        assert!(source.contains("canonicalUrl: https://www.example.com/reference"));
        assert!(source.ends_with("# Stable reference\n\nSaved once.\n"));

        let catalog = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/assistant/context"), &session, false),
        ));
        let reference = catalog["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|document| document["id"] == "portable:reference:rust-guide")
            .unwrap();
        assert_eq!(reference["sourceUrl"], "https://example.com/start");
        assert_eq!(
            reference["canonicalUrl"],
            "https://www.example.com/reference"
        );
        assert_eq!(reference["content"], "# Stable reference\n\nSaved once.");
        assert_eq!(reference["untrusted"], true);
        assert_eq!(reference["selectable"], true);
        assert!(catalog["references"]
            .as_array()
            .unwrap()
            .iter()
            .any(|document| document["id"] == "portable:reference:manual-notes.md"));
        assert!(!catalog["references"]
            .as_array()
            .unwrap()
            .iter()
            .any(|document| document["name"] == "rust-guide.md"));
        let selected = resolve_review_context(&f.dir, "portable:reference:rust-guide").unwrap();
        assert_eq!(selected.content(), "# Stable reference\n\nSaved once.");

        let duplicate = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/context/url/save",
                    json!({
                        "confirmed": true, "visibility": "portable", "fileId": "rust-guide",
                        "snapshot": {
                            "sourceUrl": "https://example.com/changed",
                            "canonicalUrl": "https://example.com/changed",
                            "retrievedAt": "2026-10-23T13:00:00Z",
                            "contentType": "text/plain", "text": "replacement"
                        }
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(duplicate.status, 409);
        assert_eq!(fs::read_to_string(path).unwrap(), source);
    }

    #[test]
    fn assistant_post_context_references_and_post_snapshots_are_bounded_and_conflict_safe() {
        let f = fixture("assistant-post-reference-context");
        let session = login_ok(&f);
        let post_path = "posts/2026-01-01-context-source.md";
        fs::write(
            f.dir.join("content").join(post_path),
            "---\ntitle: Context source\ndate: 2026-01-01\n---\n\nImmutable source body.\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let outside = f.dir.join("outside-posts");
            fs::create_dir_all(&outside).unwrap();
            fs::write(outside.join("secret.md"), "must not become context").unwrap();
            symlink(&outside, f.dir.join("content/posts/linked-outside")).unwrap();
        }

        let created = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "post", "visibility": "portable",
                        "documentPath": post_path,
                        "fields": {
                            "goal": "Explain context selection",
                            "audience": "Blog authors",
                            "learningOutcomes": "Choose only relevant material",
                            "sources": "The project specification",
                            "constraints": "Keep provider data bounded"
                        },
                        "etag": null
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            created.status,
            200,
            "{}",
            String::from_utf8_lossy(&created.body)
        );
        let created = body_json(&created)["document"].clone();
        assert_eq!(created["contextType"], "post");
        assert!(created["content"].as_str().unwrap().contains("## Goal"));
        assert!(f
            .dir
            .join("assistant/context/posts/2026-01-01-context-source.md")
            .is_file());

        let stale = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({
                        "contextType": "post", "visibility": "portable",
                        "documentPath": post_path,
                        "fields": { "goal": "Stale overwrite" },
                        "etag": "stale"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale.status, 409);

        let reference = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/assistant/reference",
                    json!({
                        "name": "style-notes.txt", "visibility": "private",
                        "content": "Prefer concrete examples."
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            reference.status,
            201,
            "{}",
            String::from_utf8_lossy(&reference.body)
        );
        let reference = body_json(&reference)["reference"].clone();
        assert_eq!(reference["name"], "style-notes.txt");
        assert_eq!(reference["visibility"], "private");
        assert_eq!(reference["content"], "Prefer concrete examples.");

        let catalog = handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    "/admin/api/assistant/context?path=posts%2F2026-01-01-context-source.md",
                ),
                &session,
                false,
            ),
        );
        assert_eq!(catalog.status, 200);
        let catalog = body_json(&catalog);
        assert_eq!(catalog["documents"].as_array().unwrap().len(), 6);
        assert!(catalog["references"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "private:reference:style-notes.txt"));
        let snapshot = catalog["postSnapshots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["path"] == post_path)
            .unwrap();
        assert!(snapshot["content"]
            .as_str()
            .unwrap()
            .contains("Immutable source body."));
        assert!(!catalog["postSnapshots"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["content"] == "must not become context"));
        #[cfg(unix)]
        fs::remove_file(f.dir.join("content/posts/linked-outside")).unwrap();
        f.state.rebuild().unwrap();
        for output in fsutil::walk(&f.dir.join("dist")) {
            let output = String::from_utf8_lossy(&fs::read(output).unwrap()).into_owned();
            assert!(!output.contains("Explain context selection"));
            assert!(!output.contains("Prefer concrete examples."));
        }

        for (name, content, expected) in [
            ("payload.pdf", "text", 422),
            (
                "too-large.md",
                &"x".repeat(MAX_ASSISTANT_CONTEXT_BYTES + 1),
                413,
            ),
        ] {
            let response = handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/assistant/reference",
                        json!({ "name": name, "visibility": "portable", "content": content }),
                    ),
                    &session,
                    true,
                ),
            );
            assert_eq!(response.status, expected);
            assert!(!f
                .dir
                .join("assistant/context/references")
                .join(name)
                .exists());
        }

        let deleted = handle(
            &f.state,
            &authed(
                json_req(
                    "DELETE",
                    "/admin/api/assistant/reference",
                    json!({
                        "name": "style-notes.txt", "visibility": "private",
                        "etag": reference["etag"]
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(deleted.status, 200);
        assert!(!f
            .dir
            .join(".openblog/private/context/references/style-notes.txt")
            .exists());
    }

    #[test]
    fn document_rename_moves_post_context_and_conflicts_without_partial_changes() {
        let f = fixture("post-context-rename");
        let session = login_ok(&f);
        let old_rel = "posts/2026-01-01-old-name.md";
        let new_rel = "posts/2026-01-01-new-name.md";
        let source = "---\ntitle: Old name\ndate: 2026-01-01\n---\n\nBody.\n";
        fs::write(f.dir.join("content").join(old_rel), source).unwrap();
        for root in ["assistant/context", ".openblog/private/context"] {
            let directory = f.dir.join(root).join("posts");
            fs::create_dir_all(&directory).unwrap();
            fs::write(
                directory.join("2026-01-01-old-name.md"),
                "## Goal\n\nKeep me.\n",
            )
            .unwrap();
        }

        let renamed = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document/rename",
                    json!({ "path": old_rel, "newPath": new_rel, "etag": etag(source) }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            renamed.status,
            200,
            "{}",
            String::from_utf8_lossy(&renamed.body)
        );
        assert!(!f.dir.join("content").join(old_rel).exists());
        assert!(f.dir.join("content").join(new_rel).is_file());
        for root in ["assistant/context", ".openblog/private/context"] {
            assert!(!f
                .dir
                .join(root)
                .join("posts/2026-01-01-old-name.md")
                .exists());
            assert_eq!(
                fs::read_to_string(f.dir.join(root).join("posts/2026-01-01-new-name.md")).unwrap(),
                "## Goal\n\nKeep me.\n"
            );
        }

        let conflict_rel = "posts/2026-01-01-conflict.md";
        fs::write(f.dir.join("content").join(conflict_rel), "occupied").unwrap();
        let conflict = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document/rename",
                    json!({ "path": new_rel, "newPath": conflict_rel, "etag": etag(source) }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(conflict.status, 409);
        assert!(f.dir.join("content").join(new_rel).is_file());
        assert!(f
            .dir
            .join("assistant/context/posts/2026-01-01-new-name.md")
            .is_file());
    }

    #[test]
    fn document_bundle_move_rolls_back_completed_moves_after_a_later_failure() {
        let f = fixture("document-bundle-move-rollback");
        let source = f.dir.join("source.md");
        let first_target = f.dir.join("first.md");
        let second_target = f.dir.join("second.md");
        fs::write(&source, "restore me").unwrap();

        let error = move_files_transactionally(&[
            (source.clone(), first_target.clone()),
            (source.clone(), second_target.clone()),
        ])
        .unwrap_err();

        assert!(error.contains("rollback: ok"));
        assert_eq!(fs::read_to_string(&source).unwrap(), "restore me");
        assert!(!first_target.exists());
        assert!(!second_target.exists());
    }

    #[test]
    fn document_delete_restores_post_when_context_cannot_be_retired() {
        let f = fixture("post-context-delete-recovery");
        let session = login_ok(&f);
        let rel = "posts/2026-01-01-delete-recovery.md";
        let post = f.dir.join("content").join(rel);
        fs::write(
            &post,
            "---\ntitle: Recovery\ndate: 2026-01-01\n---\n\nBody.\n",
        )
        .unwrap();
        let context = f
            .dir
            .join("assistant/context/posts/2026-01-01-delete-recovery.md");
        fs::create_dir_all(context.parent().unwrap()).unwrap();
        fs::write(&context, "## Goal\n\nRecover together.\n").unwrap();
        let trash_context = f.dir.join(".openblog/trash/context");
        fs::create_dir_all(trash_context.parent().unwrap()).unwrap();
        fs::write(&trash_context, "blocks directory creation").unwrap();

        let deleted = handle(
            &f.state,
            &authed(
                req(
                    "DELETE",
                    "/admin/api/document?path=posts%2F2026-01-01-delete-recovery.md",
                ),
                &session,
                true,
            ),
        );
        assert_eq!(deleted.status, 500);
        assert!(
            post.is_file(),
            "post must be restored after context failure"
        );
        assert!(context.is_file(), "context must remain with restored post");

        fs::remove_file(&trash_context).unwrap();
        let deleted = handle(
            &f.state,
            &authed(
                req(
                    "DELETE",
                    "/admin/api/document?path=posts%2F2026-01-01-delete-recovery.md",
                ),
                &session,
                true,
            ),
        );
        assert_eq!(deleted.status, 200);
        assert!(!post.exists());
        assert!(!context.exists());
        assert_eq!(
            body_json(&deleted)["trashedContextTo"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
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
            (
                500,
                "{}".to_string(),
                Duration::ZERO,
                "provider status",
                "HTTP 500",
            ),
            (
                200,
                "not json".to_string(),
                Duration::ZERO,
                "invalid JSON",
                "invalid JSON",
            ),
            (
                200,
                json!({ "questions": [{ "prompt": "Q", "choices": ["A"], "correctIndex": 0 }] })
                    .to_string(),
                Duration::ZERO,
                "invalid schema",
                "two to four choices",
            ),
            (
                200,
                "x".repeat(129 * 1024),
                Duration::ZERO,
                "oversized response",
                "Cannot read",
            ),
            (
                200,
                "{}".to_string(),
                Duration::from_millis(600),
                "timeout",
                "timed out",
            ),
        ];
        for (status, body, delay, label, expected) in cases {
            let (endpoint, server) = quiz_provider(status, body, delay);
            set_quiz_endpoint(&f, &endpoint);
            let response = handle(&f.state, &request());
            assert_eq!(response.status, 502, "{label}");
            let response_body = String::from_utf8_lossy(&response.body);
            assert!(response_body.contains(expected), "{label}: {response_body}");
            assert!(!response_body.contains("test-secret"), "{label}");
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
    fn contributor_registry_honors_the_shared_content_transaction_lock() {
        let f = fixture("contributor-registry-lock");
        let session = login_ok(&f);
        let registry = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/contributors"), &session, false),
        ));
        let lock = crate::transaction::ContentTransactionLock::acquire(&f.dir).unwrap();

        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({
                        "etag": registry["etag"],
                        "contributors": registry["contributors"]
                    }),
                ),
                &session,
                true,
            ),
        );

        assert_eq!(response.status, 409);
        assert!(String::from_utf8_lossy(&response.body).contains("no writer is running"));

        let publish = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/publish",
                    json!({ "summary": "Locked publish" }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(publish.status, 409);
        drop(lock);
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
    fn exact_tracks_are_staged_until_save_and_retired_on_privacy_downgrade() {
        let f = fixture("track-upload");
        let session = login_ok(&f);
        let send = |name: &str, bytes: &[u8]| {
            let mut request = authed(
                req("POST", &format!("/admin/api/track-upload?name={name}")),
                &session,
                true,
            );
            request.body = bytes.to_vec();
            handle(&f.state, &request)
        };
        let gpx = br#"<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="42" lon="-72"></trkpt><trkpt lat="42.1" lon="-72.1"></trkpt></trkseg></trk></gpx>"#;
        let abandoned = send("Abandoned.gpx", gpx);
        let abandoned_token = body_json(&abandoned)["token"].as_str().unwrap().to_string();
        let discarded = handle(
            &f.state,
            &authed(
                req(
                    "DELETE",
                    &format!("/admin/api/track-upload?token={abandoned_token}"),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(discarded.status, 200);
        assert!(!f
            .dir
            .join(format!(".openblog/pending-tracks/{abandoned_token}.gpx"))
            .exists());
        let first = send("Morning Ridge.gpx", gpx);
        assert_eq!(first.status, 201);
        let token = body_json(&first)["token"].as_str().unwrap().to_string();
        assert!(f
            .dir
            .join(format!(".openblog/pending-tracks/{token}.gpx"))
            .is_file());
        assert!(!f.dir.join("static/tracks").exists());
        assert!(!f.dir.join("dist/tracks").exists());
        assert_eq!(send("track.gpx", b"<html>no track</html>").status, 415);
        assert_eq!(
            send(
                "track.gpx",
                b"<gpx><trkpt lat='no' lon='0'></trkpt><trkpt lat='91' lon='0'></trkpt></gpx>"
            )
            .status,
            415
        );
        assert_eq!(
            send(
                "track.gpx",
                b"<gpx></gpx><trk><trkseg><trkpt lat='0' lon='0'></trkpt><trkpt lat='1' lon='1'></trkpt></trkseg></trk>"
            )
            .status,
            415
        );
        assert_eq!(
            send(
                "track.gpx",
                b"<!DOCTYPE gpx [<!ENTITY x SYSTEM 'file:///secret'>]><gpx><trkpt lat='0' lon='0'></trkpt></gpx>"
            )
            .status,
            415
        );

        let created = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document",
                    json!({
                        "kind":"posts",
                        "fields":{"title":"Morning Ridge","date":"2026-01-01","profile":"field-journal","locationPrivacy":"exact"},
                        "body":"Trail notes.","trackToken":token,"trackName":"Morning Ridge.gpx"
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
        let created_json = body_json(&created);
        let track_url = created_json["trackUrl"].as_str().unwrap();
        assert!(track_url.ends_with("/morning-ridge.gpx"));
        assert!(f
            .dir
            .join("static")
            .join(track_url.trim_start_matches('/'))
            .is_file());
        assert!(f
            .dir
            .join("dist")
            .join(track_url.trim_start_matches('/'))
            .is_file());
        assert!(!f
            .dir
            .join(format!(".openblog/pending-tracks/{token}.gpx"))
            .exists());

        fs::write(
            f.dir.join("content/posts/2026-01-01-shared-ridge.md"),
            format!(
                "---\ntitle: Shared Ridge\ndate: 2026-01-01\nprofile: field-journal\nlocationPrivacy: exact\nroute: {track_url}\n---\nShared trail notes."
            ),
        )
        .unwrap();

        let hidden = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/document?path=posts/2026-01-01-morning-ridge.md",
                    json!({
                        "fields":{"title":"Morning Ridge","date":"2026-01-01","profile":"field-journal","locationPrivacy":"hidden","route":track_url},
                        "body":"Trail notes.","etag":created_json["etag"]
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            hidden.status,
            200,
            "{}",
            String::from_utf8_lossy(&hidden.body)
        );
        assert!(f
            .dir
            .join("static")
            .join(track_url.trim_start_matches('/'))
            .exists());
        assert!(f
            .dir
            .join("dist")
            .join(track_url.trim_start_matches('/'))
            .exists());
        let shared_deleted = handle(
            &f.state,
            &authed(
                req(
                    "DELETE",
                    "/admin/api/document?path=posts/2026-01-01-shared-ridge.md",
                ),
                &session,
                true,
            ),
        );
        assert_eq!(shared_deleted.status, 200);
        assert!(!f
            .dir
            .join("static")
            .join(track_url.trim_start_matches('/'))
            .exists());
        assert!(!f
            .dir
            .join("dist")
            .join(track_url.trim_start_matches('/'))
            .exists());
        assert!(fsutil::walk(&f.dir.join(".openblog/trash/tracks"))
            .iter()
            .any(|path| path.extension().and_then(|value| value.to_str()) == Some("gpx")));

        let delete_stage = send("Delete Me.gpx", gpx);
        let delete_token = body_json(&delete_stage)["token"]
            .as_str()
            .unwrap()
            .to_string();
        let delete_created = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/document",
                    json!({
                        "kind":"posts",
                        "fields":{"title":"Delete Me","date":"2026-01-02","profile":"field-journal","locationPrivacy":"exact"},
                        "body":"Trail notes.","trackToken":delete_token,"trackName":"Delete Me.gpx"
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(delete_created.status, 201);
        let delete_json = body_json(&delete_created);
        let delete_url = delete_json["trackUrl"].as_str().unwrap();
        let deleted = handle(
            &f.state,
            &authed(
                req(
                    "DELETE",
                    "/admin/api/document?path=posts/2026-01-02-delete-me.md",
                ),
                &session,
                true,
            ),
        );
        assert_eq!(deleted.status, 200);
        assert!(!f
            .dir
            .join("static")
            .join(delete_url.trim_start_matches('/'))
            .exists());
        assert!(!f
            .dir
            .join("dist")
            .join(delete_url.trim_start_matches('/'))
            .exists());
    }

    #[test]
    fn portable_diagnostic_locations_match_unsaved_body_blank_lines_and_line_endings() {
        let f = fixture("portable-source-locations");
        let session = login_ok(&f);
        let quiz = "```quiz\nQuestion?\n- [x] Yes\n- [ ] No\n```\n";
        for newline in ["\n", "\r\n"] {
            for blanks in 0..=3 {
                let body =
                    format!("{}😀 Heading\n\n{quiz}", "\n".repeat(blanks)).replace('\n', newline);
                let response = handle(
                    &f.state,
                    &authed(
                        json_req(
                            "POST",
                            "/admin/api/preview",
                            json!({
                                "kind": "posts",
                                "path": "posts/locations.md",
                                "fields": { "title": "Locations", "date": "2026-01-01" },
                                "body": body,
                            }),
                        ),
                        &session,
                        true,
                    ),
                );
                assert_eq!(
                    response.status,
                    200,
                    "{}",
                    String::from_utf8_lossy(&response.body)
                );
                let preview = body_json(&response);
                for representation in ["portable-html", "portable-markdown", "portable-text"] {
                    let diagnostic = preview["portablePreview"]["diagnosticsByRepresentation"]
                        [representation]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|diagnostic| diagnostic["capabilityId"] == "knowledge-check")
                        .unwrap();
                    assert_eq!(diagnostic["representation"], representation);
                    assert_eq!(diagnostic["destination"], "portable-export");
                    assert_eq!(diagnostic["sourceRange"]["startLine"], blanks + 3);
                    assert_eq!(diagnostic["sourceRange"]["startColumn"], 1);
                }
                assert!(!f.dir.join("content/posts/locations.md").exists());
            }
        }
    }

    #[test]
    fn universal_publishing_preview_matches_public_artifacts_without_enabling_live_services() {
        let f = fixture("universal-publishing-preview");
        let session = login_ok(&f);
        let source =
            include_str!("../../../examples/portable-publishing/content/posts/portable-lesson.md");
        fs::write(
            f.dir.join("openblog.json"),
            include_str!("../../../examples/portable-publishing/openblog.json"),
        )
        .unwrap();
        let post_path = f.dir.join("content/posts/portable-lesson.md");
        fs::write(&post_path, source).unwrap();
        fs::write(
            f.dir.join("content/posts/portable-lesson.credits.json"),
            include_str!(
                "../../../examples/portable-publishing/content/posts/portable-lesson.credits.json"
            ),
        )
        .unwrap();
        let document = frontmatter::parse(source).unwrap();
        let response = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": "posts/portable-lesson.md",
                        "fields": fields_to_json(&document.front_matter.fields),
                        "body": document.body,
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        let preview = body_json(&response);
        let (public_site, _) = site::load_site(&f.dir, false, Some(clock::now())).unwrap();
        let post = public_site
            .posts
            .iter()
            .find(|post| post.slug == "portable-lesson")
            .unwrap();
        let projection =
            openblog_core::portability::PortableProjection::from_post(post, &public_site.config)
                .unwrap();
        let output = projection.portable_html().unwrap();
        let content_plans = openblog_core::portability::destination_policies()
            .into_iter()
            .map(|policy| {
                openblog_core::portability::destination_content_plan(
                    policy.provider,
                    "posts/portable-lesson.md",
                    &output,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            preview["portablePreview"]["destinationContentPlans"],
            json!(content_plans)
        );
        assert_eq!(
            preview["portablePreview"]["html"],
            projection.portable_html().unwrap().html
        );
        assert_eq!(
            preview["portablePreview"]["markdown"],
            projection.portable_markdown().unwrap()
        );
        assert_eq!(
            preview["portablePreview"]["text"],
            projection.portable_text().unwrap()
        );
        assert!(preview["portablePreview"]["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|capability| {
                capability["id"] == "knowledge-check"
                    && capability["portability"] == "gracefully-transformed"
            }));
        for representation in ["html", "markdown", "text"] {
            let output = preview["portablePreview"][representation].as_str().unwrap();
            assert!(output.contains("Join the discussion"));
            assert!(output.contains("Open in Rust Playground"));
            assert!(output.contains("Alex Example"));
            for private in [
                "PRIVATE_",
                "runner.example.org",
                "discussion.example.org",
                "<ob-",
            ] {
                assert!(!output.contains(private), "{representation}: {private}");
            }
        }
        let native = handle(
            &f.state,
            &authed(
                req("GET", preview["previewUrl"].as_str().unwrap()),
                &session,
                false,
            ),
        );
        assert_eq!(native.status, 200);
        let native = String::from_utf8(native.body).unwrap();
        assert!(!native.contains("<ob-comments"));
        assert_eq!(fs::read_to_string(&post_path).unwrap(), source);
        assert!(!f.dir.join(".openblog/syndication.json").exists());
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
        assert!(preview["portablePreview"]["html"]
            .as_str()
            .is_some_and(|html| html.contains("<h2") && !html.contains("<ob-")));
        assert!(preview["portablePreview"]["markdown"]
            .as_str()
            .is_some_and(|markdown| {
                markdown.contains("# Preview title")
                    && markdown.contains("Canonical: <https://")
                    && markdown.contains("## Hi")
            }));
        assert!(preview["portablePreview"]["diagnostics"]
            .as_array()
            .is_some_and(Vec::is_empty));
        assert_eq!(
            preview["portablePreview"]["destinations"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
        let dev_tags = &preview["portablePreview"]["destinationTagPlans"][0];
        assert_eq!(dev_tags["policy"]["provider"], "dev");
        assert_eq!(dev_tags["policy"]["maxTags"], 4);
        assert_eq!(dev_tags["tags"], json!(["preview"]));
        assert_eq!(dev_tags["omittedTags"], json!([]));
        assert_eq!(dev_tags["diagnostics"], json!([]));
        assert_eq!(
            preview["portablePreview"]["destinations"][3]["canonicalBehavior"],
            "WordPress core cannot set an external canonical URL."
        );
        assert_eq!(
            preview["portablePreview"]["destinations"][4]["representation"],
            "manual-markdown"
        );
        assert!(preview["portablePreview"]["sourceRevision"]
            .as_str()
            .is_some_and(|revision| revision.len() == 40));
        assert_eq!(preview["portablePreview"]["acknowledgements"], json!([]));
        assert!(preview["portablePreview"]["acknowledgementEtag"]
            .as_str()
            .is_some_and(|etag| !etag.is_empty()));
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
        assert!(document.headers.iter().any(|(name, value)| {
            name == "Content-Security-Policy"
                && value.contains("frame-src https://codepen.io https://www.youtube-nocookie.com")
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
    fn portability_acknowledgement_files_reject_malformed_versions_scopes_and_bounds() {
        let f = fixture("portability-sidecar-contract");
        let path = f.dir.join("invalid.portability.json");
        let valid = json!({
            "sourceRevision": "a".repeat(40),
            "capabilityId": "knowledge-check",
            "representation": "portable-markdown",
            "destination": "dev",
        });
        let mut renamed = valid.clone();
        renamed["destination"] = json!("renamed-target");
        for invalid in [
            json!({"version": 2, "acknowledgements": []}),
            json!({"version": 1, "acknowledgements": [], "ignoreErrors": true}),
            json!({"version": 1, "acknowledgements": [{}]}),
            json!({"version": 1, "acknowledgements": vec![json!({}); MAX_PORTABILITY_ACKNOWLEDGEMENTS + 1]}),
            json!({"version": 1, "acknowledgements": [renamed]}),
        ] {
            let bytes = serde_json::to_vec(&invalid).unwrap();
            fs::write(&path, &bytes).unwrap();
            assert!(load_portability_acknowledgements(&path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        for bytes in [b"{invalid JSON".to_vec(), vec![b' '; 128 * 1024 + 1]] {
            fs::write(&path, &bytes).unwrap();
            assert!(load_portability_acknowledgements(&path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let sidecar = json!({"version": 1, "acknowledgements": [valid]});
        fs::write(&path, serde_json::to_vec(&sidecar).unwrap()).unwrap();
        let (loaded, etag) = load_portability_acknowledgements(&path).unwrap();
        assert_eq!(loaded.acknowledgements.len(), 1);
        assert_eq!(load_portability_acknowledgements(&path).unwrap().1, etag);
    }

    #[test]
    fn portability_acknowledgements_are_tracked_scoped_and_stale_on_source_changes() {
        for representation in ["portable-html", "portable-markdown", "portable-text"] {
            assert_portability_acknowledgement(representation);
        }
    }

    fn assert_portability_acknowledgement(representation: &str) {
        let f = fixture("portability-ack");
        let post_path = "posts/lesson.md";
        let post_body =
            "```quiz\nWhat is portable?\n- [ ] A second source\n- [x] A derived view\n```\n";
        fs::write(
            f.dir.join("content").join(post_path),
            format!("---\ntitle: Lesson\ndate: 2020-01-01\n---\n\n{post_body}"),
        )
        .unwrap();
        f.state.rebuild().unwrap();
        let session = login_ok(&f);
        let (loaded, _) = site::load_site(&f.dir, false, Some(clock::now())).unwrap();
        let post = loaded
            .posts
            .iter()
            .find(|post| post.source == post_path)
            .unwrap();
        let projection =
            openblog_core::portability::PortableProjection::from_post(post, &loaded.config)
                .unwrap();
        let source_revision = projection.source_revision().unwrap();
        let acknowledge = |revision: &str, etag: &str, destination: &str| {
            handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/portability/acknowledge",
                        json!({
                            "path": post_path,
                            "sourceRevision": revision,
                            "capabilityId": "knowledge-check",
                            "representation": representation,
                            "destination": destination,
                            "expectedEtag": etag,
                        }),
                    ),
                    &session,
                    true,
                ),
            )
        };
        let response = acknowledge(&source_revision, &etag_bytes(&[]), "portable-export");
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        let acknowledgement = body_json(&response);
        assert_eq!(
            acknowledgement["acknowledgements"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let sidecar = f.dir.join("content/posts/lesson.portability.json");
        assert!(sidecar.exists());
        let stored: Json = serde_json::from_slice(&fs::read(&sidecar).unwrap()).unwrap();
        assert_eq!(
            stored["acknowledgements"][0]["sourceRevision"],
            source_revision
        );
        assert_eq!(
            stored["acknowledgements"][0]["destination"],
            "portable-export"
        );
        assert_eq!(
            stored["acknowledgements"][0]["representation"],
            representation
        );
        let repeated = acknowledge(
            &source_revision,
            acknowledgement["etag"].as_str().unwrap(),
            "portable-export",
        );
        assert_eq!(repeated.status, 200);
        assert_eq!(body_json(&repeated), acknowledgement);
        assert_eq!(
            serde_json::from_slice::<Json>(&fs::read(&sidecar).unwrap()).unwrap(),
            stored
        );

        let preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": post_path,
                        "fields": { "title": "Lesson", "date": "2020-01-01" },
                        "body": post_body,
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
        assert_eq!(
            body_json(&preview)["portablePreview"]["acknowledgements"][0]["sourceRevision"],
            source_revision
        );

        let invalid_scope = acknowledge(
            &source_revision,
            acknowledgement["etag"].as_str().unwrap(),
            "unknown",
        );
        assert_eq!(invalid_scope.status, 422);
        fs::write(
            f.dir.join("content").join(post_path),
            format!("---\ntitle: Lesson\ndate: 2020-01-01\n---\n\n{post_body}\nChanged."),
        )
        .unwrap();
        let changed = acknowledge(
            &source_revision,
            acknowledgement["etag"].as_str().unwrap(),
            "portable-export",
        );
        assert_eq!(changed.status, 409);
        let stale_preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": post_path,
                        "fields": { "title": "Lesson", "date": "2020-01-01" },
                        "body": format!("{post_body}\nChanged."),
                    }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(stale_preview.status, 200);
        let stale_preview = body_json(&stale_preview);
        assert_ne!(
            stale_preview["portablePreview"]["sourceRevision"],
            source_revision
        );
        assert_eq!(
            stale_preview["portablePreview"]["acknowledgements"][0]["sourceRevision"],
            source_revision
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
        let language_contract = crate::serve::route(
            &f.state,
            &req("GET", CODE_RUNNER_LANGUAGE_PATH),
            &f.dir.join("dist"),
        );
        assert_eq!(language_contract.status, 200);
        assert!(String::from_utf8_lossy(&language_contract.body)
            .contains("normalizeCodeRunnerLanguage"));
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

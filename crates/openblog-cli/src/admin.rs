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
use openblog_core::citations::{self, PublicLocator};
use openblog_core::collaboration::{
    AuthorizationAction, AuthorizationRole, AuthorizationTarget, NewParticipant,
    NewSharedPublication, NewSourceReference, PublishError, SharedPublication,
    SharedPublicationError, SourceField, SourceKind,
};
use openblog_core::config::{AssistantProviderKind, SyndicationProvider};
use openblog_core::draft::{
    ComparisonSlot, DraftError, DraftSet, DraftView, ReadyOutcome, RevealPolicy,
};
use openblog_core::frontmatter::{self, Value};
use openblog_core::invitation::{
    Identities, Invitation, InvitationError, InvitationField, NewInvitation,
};
use openblog_core::markdown::RenderOptions;
use openblog_core::members::MemberError;
use openblog_core::portability::{destination_policy, DestinationRepresentation};
use openblog_core::research_bundle;
use openblog_core::research_notes::{
    NoteDiagnostic, NoteDiagnosticCode, Passage, QuestionState, ResearchNote,
};
use openblog_core::research_search::{self, BacklinkTarget, SearchQuery};
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
use crate::notebook_store;
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
const MAX_RESEARCH_READ_BYTES: usize = 16 * 1024;
const MAX_NOTEBOOK_REQUEST_BYTES: usize = 256 * 1024;
/// A research bundle carries a whole notebook (4 MiB) plus its envelope.
const MAX_RESEARCH_IMPORT_BYTES: usize = research_bundle::MAX_BUNDLE_BYTES + 64 * 1024;
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
        // Scheduled shared reflections are held privately and checked again as they fall due.
        fire_due_shared_publications(self);
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
        if name == "research/import" {
            return Ok(MAX_RESEARCH_IMPORT_BYTES);
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
        ("GET", "research/notebook") => list_notebook(state),
        ("GET", "citations/library") => citation_library(state),
        ("POST", "citations/check") => check_citation_request(state, req),
        ("POST", "research/search") => search_notebook(state, req),
        ("POST", "research/backlinks") => notebook_backlinks(state, req),
        ("POST", "research/archive") => archive_entry(state, req),
        ("POST", "research/export") => export_notebook(state, req),
        ("POST", "research/import") => import_notebook(state, req),
        ("POST", "research/passages") => save_passage(state, req, true),
        ("PUT", "research/passages") => save_passage(state, req, false),
        ("DELETE", "research/passages") => remove_entry(state, req, true),
        ("POST", "research/notes") => save_note(state, req, true),
        ("PUT", "research/notes") => save_note(state, req, false),
        ("DELETE", "research/notes") => remove_entry(state, req, false),
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
        ("GET", "collaboration/publications") => list_shared_publications(state, session),
        ("POST", "collaboration/publications") => create_shared_publication(state, req, session),
        ("POST", "collaboration/publications/source-metadata") => shared_source_metadata(req),
        ("GET", "collaboration/invitations") => list_invitations(state, req, session),
        ("POST", "collaboration/invitations") => create_invitation(state, req, session),
        ("POST", "collaboration/invitations/revoke") => revoke_invitation(state, req, session),
        ("POST", "collaboration/invitations/reissue") => reissue_invitation(state, req, session),
        ("GET", "collaboration/members") => list_members(state, req, session),
        ("POST", "collaboration/members/roles") => change_member_roles(state, req, session),
        ("POST", "collaboration/members/remove") => remove_member(state, req, session),
        ("GET", "collaboration/draft") => read_own_draft(state, req, session),
        ("PUT", "collaboration/draft") => save_own_draft(state, req, session),
        ("GET", "collaboration/reveal") => read_reveal_state(state, req, session),
        ("PUT", "collaboration/reveal/policy") => set_reveal_policy(state, req, session),
        ("GET", "collaboration/reflection") => read_arrangement(state, req, session),
        ("PUT", "collaboration/reflection") => save_arrangement(state, req, session),
        ("PUT", "collaboration/reveal/ready") => set_reveal_ready(state, req, session),
        ("GET", "collaboration/preview") => read_combined_preview(state, req, session),
        ("GET", "collaboration/series") => read_series(state, req, session),
        ("PUT", "collaboration/series") => set_series(state, req, session),
        ("POST", "collaboration/series/create") => create_series(state, req, session),
        ("GET", "collaboration/synthesis") => read_synthesis(state, req, session),
        ("POST", "collaboration/synthesis") => change_synthesis(state, req, session),
        ("POST", "collaboration/approve") => approve_piece(state, req, session),
        ("POST", "collaboration/approve/withdraw") => withdraw_approval(state, req, session),
        ("POST", "collaboration/schedule") => schedule_shared(state, req, session),
        ("POST", "collaboration/publish") => publish_shared(state, req, session),
        ("POST", "collaboration/invitations/accept") => {
            answer_invitation(state, req, session, true)
        }
        ("POST", "collaboration/invitations/decline") => {
            answer_invitation(state, req, session, false)
        }
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

// ---------------------------------------------------------------------------
// Citations: the editor's citation picker
// ---------------------------------------------------------------------------

const PASSAGE_PREVIEW_CHARS: usize = 160;

/// What the citation picker offers: the source library with the revision a
/// check must name, and the notebook's live passages so a citation can start
/// from one. A passage contributes only its id, source, a short excerpt
/// preview and its locators' kind, value and end. An unreadable notebook
/// leaves the picker working from the library alone.
fn citation_library(state: &AppState) -> Response {
    let contributors = source_contributors(state);
    let snapshot = match source_store::load(&state.root, &contributors) {
        Ok(snapshot) => snapshot,
        Err(error) => return source_store_error(state, error, None),
    };
    let notebook = notebook_store::load(&state.root, &contributors).ok();
    let passages: Vec<Json> = notebook
        .as_ref()
        .map(|notebook| {
            notebook
                .notebook
                .passages
                .iter()
                .filter(|passage| !passage.archived)
                .map(|passage| {
                    let locators: Vec<PublicLocator> =
                        passage.locators.iter().map(PublicLocator::from).collect();
                    json!({
                        "id": passage.id,
                        "source": passage.source,
                        "preview": passage.excerpt.text.chars().take(PASSAGE_PREVIEW_CHARS).collect::<String>(),
                        "locators": locators,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Response::json(
        200,
        &json!({
            "file": source_store::LIBRARY_FILE,
            "revision": snapshot.revision,
            "sources": snapshot.library.sources,
            "passages": passages,
            "notebookAvailable": notebook.is_some(),
        }),
    )
}

/// Check one citation for insertion. Read-only: it names the library revision
/// the picker showed, and a newer library is a `409` carrying the latest one
/// so the picker can refresh without losing the author's choices. The
/// citation goes through the core parser and resolver, so the Markdown it
/// returns is exactly what a build will read; a problem is a `422` scoped to
/// this citation. Nothing is written.
fn check_citation_request(state: &AppState, req: &Request) -> Response {
    let body = match research_read_body(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(revision) = body["revision"].as_str() else {
        return Response::error(400, "Missing source library revision");
    };
    let snapshot = match source_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => snapshot,
        Err(error) => return source_store_error(state, error, None),
    };
    if snapshot.revision != revision {
        return Response::json(
            409,
            &json!({
                "error": "The source library changed after the citation picker opened. Nothing was inserted; review the refreshed sources and insert again.",
                "conflict": true,
                "revision": snapshot.revision,
                "sources": snapshot.library.sources,
            }),
        );
    }
    let checked = citations::citation_from_parts(&body["citation"])
        .map_err(|found| vec![found])
        .and_then(|citation| citations::check_citation(&citation, &snapshot.library));
    match checked {
        Ok(checked) => {
            let mut view = json!(checked);
            view["revision"] = json!(snapshot.revision);
            Response::json(200, &view)
        }
        Err(diagnostics) => Response::json(
            422,
            &json!({
                "error": diagnostics.first().map_or("The citation is invalid", |found| found.message.as_str()),
                "diagnostics": diagnostics,
            }),
        ),
    }
}

// ---------------------------------------------------------------------------
// Research notebook: private passages and notes
// ---------------------------------------------------------------------------

/// The notebook is private author research. Responses are `no-store` like the
/// rest of Admin, name the file for repair, and carry both the notebook
/// revision a change must name and the source library the entries point into.
fn list_notebook(state: &AppState) -> Response {
    match notebook_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => Response::json(200, &notebook_view(&snapshot)),
        Err(error) => notebook_store_error(state, error, None),
    }
}

/// Read a search or backlinks request: a small JSON object. Research text
/// travels in the body, never the URL, so a proxy or access log cannot record it.
fn research_read_body(req: &Request) -> Result<Json, Response> {
    require_json(req)?;
    if req.body.len() > MAX_RESEARCH_READ_BYTES {
        return Err(Response::error(
            413,
            "A notebook search is limited to 16 KiB",
        ));
    }
    match serde_json::from_slice::<Json>(&req.body) {
        Ok(body) if body.is_object() => Ok(body),
        _ => Err(Response::error(400, "Invalid JSON")),
    }
}

/// Search the private notebook. Read-only (a POST only so the text stays out
/// of the URL) and recomputed from the stored files on every call, so it
/// cannot disagree with them. A bad filter is a field-scoped `422`; no match
/// is an ordinary empty result. Nothing is written, and the response is
/// `no-store` like the rest of Admin.
fn search_notebook(state: &AppState, req: &Request) -> Response {
    let body = match research_read_body(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let param = |name: &str| {
        body[name]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let mut problems = Vec::new();
    let question = match param("state").as_deref() {
        None => None,
        Some(text) => {
            let parsed = QuestionState::parse(text);
            if parsed.is_none() {
                problems.push(NoteDiagnostic {
                    code: NoteDiagnosticCode::InvalidField,
                    collection: None,
                    index: None,
                    id: None,
                    field: Some("state".into()),
                    message: "use open or resolved".into(),
                });
            }
            parsed
        }
    };
    if !problems.is_empty() {
        return notebook_diagnostics(problems);
    }
    let query = SearchQuery {
        // Only the query text keeps its inner spacing; the core folds it.
        text: body["q"].as_str().unwrap_or_default().to_string(),
        source: param("source"),
        locator_kind: param("locator"),
        concept: param("concept"),
        state: question,
        include_archived: body["includeArchived"].as_bool().unwrap_or(false),
    };
    let snapshot = match notebook_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => snapshot,
        Err(error) => return notebook_store_error(state, error, None),
    };
    match research_search::search(&snapshot.notebook, &snapshot.library, &query) {
        Ok(results) => {
            let mut view = json!(results);
            view["revision"] = json!(snapshot.revision);
            view["file"] = json!(notebook_store::NOTEBOOK_FILE);
            Response::json(200, &view)
        }
        Err(diagnostics) => notebook_diagnostics(diagnostics),
    }
}

/// What points at a source, a passage, or a concept: `{"type": "source|passage|concept", "id": ...}`
/// in the body, since an id can itself be private research vocabulary.
fn notebook_backlinks(state: &AppState, req: &Request) -> Response {
    let body = match research_read_body(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let id = body["id"].as_str().unwrap_or_default().to_string();
    let target = match body["type"].as_str() {
        Some("source") => BacklinkTarget::Source(id),
        Some("passage") => BacklinkTarget::Passage(id),
        Some("concept") => BacklinkTarget::Concept(id),
        _ => return Response::error(400, "Name a type: source, passage, or concept"),
    };
    let snapshot = match notebook_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => snapshot,
        Err(error) => return notebook_store_error(state, error, None),
    };
    match research_search::backlinks(&snapshot.notebook, &snapshot.library, &target) {
        Ok(found) => {
            let mut view = json!(found);
            view["revision"] = json!(snapshot.revision);
            Response::json(200, &view)
        }
        Err(diagnostics) => notebook_diagnostics(diagnostics),
    }
}

fn notebook_view(snapshot: &notebook_store::Snapshot) -> Json {
    json!({
        "file": notebook_store::NOTEBOOK_FILE,
        "revision": snapshot.revision,
        "stored": snapshot.stored,
        "passages": snapshot.notebook.passages,
        "notes": snapshot.notebook.notes,
        "sources": snapshot.library.sources,
    })
}

/// Read a change request: JSON, bounded, and naming the revision it was based on.
fn notebook_request(req: &Request) -> Result<(Json, String), Response> {
    require_json(req)?;
    if req.body.len() > MAX_NOTEBOOK_REQUEST_BYTES {
        return Err(Response::error(
            413,
            "A research change is limited to 256 KiB",
        ));
    }
    let body: Json =
        serde_json::from_slice(&req.body).map_err(|_| Response::error(400, "Invalid JSON"))?;
    let Some(revision) = body["revision"].as_str().map(str::to_string) else {
        return Err(Response::error(400, "Missing notebook revision"));
    };
    Ok((body, revision))
}

/// Create (`POST`) or update (`PUT`) one passage from its full JSON form.
fn save_passage(state: &AppState, req: &Request, create: bool) -> Response {
    let (body, revision) = match notebook_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let passage = match Passage::from_json(body["passage"].clone()) {
        Ok(passage) => passage,
        Err(diagnostics) => return notebook_diagnostics(diagnostics),
    };
    let id = passage.id.clone();
    let contributors = source_contributors(state);
    let saved = if create {
        notebook_store::create_passage(&state.root, &revision, passage, &contributors)
    } else {
        notebook_store::update_passage(&state.root, &revision, passage, &contributors)
    };
    match saved {
        Ok(snapshot) => {
            let mut view = notebook_view(&snapshot);
            view["passage"] = json!(snapshot.notebook.passage(&id));
            Response::json(if create { 201 } else { 200 }, &view)
        }
        Err(error) => notebook_store_error(state, error, Some((true, &id))),
    }
}

/// Create (`POST`) or update (`PUT`) one note from its full JSON form.
fn save_note(state: &AppState, req: &Request, create: bool) -> Response {
    let (body, revision) = match notebook_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let note = match ResearchNote::from_json(body["note"].clone()) {
        Ok(note) => note,
        Err(diagnostics) => return notebook_diagnostics(diagnostics),
    };
    let id = note.id.clone();
    let contributors = source_contributors(state);
    let saved = if create {
        notebook_store::create_note(&state.root, &revision, note, &contributors)
    } else {
        notebook_store::update_note(&state.root, &revision, note, &contributors)
    };
    match saved {
        Ok(snapshot) => {
            let mut view = notebook_view(&snapshot);
            view["note"] = json!(snapshot.notebook.note(&id));
            Response::json(if create { 201 } else { 200 }, &view)
        }
        Err(error) => notebook_store_error(state, error, Some((false, &id))),
    }
}

/// Remove one passage (refused while a note links to it) or one note.
fn remove_entry(state: &AppState, req: &Request, passage: bool) -> Response {
    let (body, revision) = match notebook_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let Some(id) = body["id"].as_str() else {
        return Response::error(400, "Name the id of the entry to remove");
    };
    let contributors = source_contributors(state);
    let removed = if passage {
        notebook_store::remove_passage(&state.root, &revision, id, &contributors)
    } else {
        notebook_store::remove_note(&state.root, &revision, id, &contributors)
    };
    match removed {
        Ok(snapshot) => Response::json(200, &notebook_view(&snapshot)),
        Err(error) => notebook_store_error(state, error, Some((passage, id))),
    }
}

/// Archive or restore one passage or note. It only sets the entry aside; the
/// text stays in the file and in exports, and removal rules are unchanged.
fn archive_entry(state: &AppState, req: &Request) -> Response {
    let (body, revision) = match notebook_request(req) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let (Some(id), Some(archived)) = (body["id"].as_str(), body["archived"].as_bool()) else {
        return Response::error(400, "Name the entry id and whether it is archived");
    };
    let collection = match body["type"].as_str() {
        Some("passage") => notebook_store::Collection::Passages,
        Some("note") => notebook_store::Collection::Notes,
        _ => return Response::error(400, "Name a type: passage or note"),
    };
    match notebook_store::set_archived(
        &state.root,
        &revision,
        collection,
        id,
        archived,
        &source_contributors(state),
    ) {
        Ok(snapshot) => Response::json(200, &notebook_view(&snapshot)),
        Err(error) => notebook_store_error(
            state,
            error,
            Some((collection == notebook_store::Collection::Passages, id)),
        ),
    }
}

/// Export the whole private notebook as a versioned bundle. Private research
/// text leaves the project only through this route, and only when the request
/// says so explicitly (`includePrivate: true`); nothing else reads the notebook
/// into an export. Read-only, deterministic for a revision, and `no-store`.
fn export_notebook(state: &AppState, req: &Request) -> Response {
    let body = match research_read_body(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    if body["includePrivate"] != json!(true) {
        return Response::error(
            400,
            "The export contains your private passages and notes; confirm that with includePrivate: true",
        );
    }
    let snapshot = match notebook_store::load(&state.root, &source_contributors(state)) {
        Ok(snapshot) => snapshot,
        Err(error) => return notebook_store_error(state, error, None),
    };
    let export = research_bundle::export(&snapshot.notebook, &snapshot.library);
    Response::json(
        200,
        &json!({
            "file": notebook_store::NOTEBOOK_FILE,
            "revision": snapshot.revision,
            "private": true,
            "filename": research_bundle::BUNDLE_FILENAME,
            "mediaType": "application/json",
            "passages": export.passages,
            "notes": export.notes,
            "archived": export.archived,
            "content": export.content,
        }),
    )
}

/// Preview (`apply: false`) or apply a research bundle, sent as the raw file
/// text in `content` (parsed here, so unknown fields restore byte for byte). The preview never writes. An apply is refused whole when any entry
/// conflicts, and otherwise goes through the same revision-checked, atomic
/// store as every other notebook change.
fn import_notebook(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_RESEARCH_IMPORT_BYTES {
        return Response::error(413, "A research bundle is limited to 4.25 MiB");
    }
    let Ok(body) = serde_json::from_slice::<Json>(&req.body) else {
        return Response::error(400, "Invalid JSON");
    };
    let (Some(revision), true) = (body["revision"].as_str(), body["content"].is_string()) else {
        return Response::error(400, "Name the notebook revision and send the bundle");
    };
    let apply = body["apply"].as_bool().unwrap_or(false);
    let content = body["content"].as_str().unwrap_or_default().to_string();
    let contributors = source_contributors(state);
    let snapshot = match notebook_store::load(&state.root, &contributors) {
        Ok(snapshot) => snapshot,
        Err(error) => return notebook_store_error(state, error, None),
    };
    if snapshot.revision != revision {
        return notebook_store_error(state, notebook_store::StoreError::Conflict, None);
    }
    let plan = match research_bundle::plan_import(&snapshot.notebook, &snapshot.library, &content) {
        Ok(plan) => plan,
        Err(diagnostics) => return notebook_diagnostics(diagnostics),
    };
    if !apply || (!plan.has_changes() && plan.is_applicable()) {
        return Response::json(
            200,
            &json!({
                "file": notebook_store::NOTEBOOK_FILE,
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
            &json!({ "error": error, "file": notebook_store::NOTEBOOK_FILE, "diagnostics": blockers, "plan": plan }),
        );
    }
    match notebook_store::import_bundle(&state.root, revision, &content, &contributors) {
        Ok((saved, plan)) => {
            let mut view = notebook_view(&saved);
            view["applied"] = json!(true);
            view["applicable"] = json!(true);
            view["plan"] = json!(plan);
            Response::json(200, &view)
        }
        Err(error) => notebook_store_error(state, error, None),
    }
}

fn notebook_diagnostics(diagnostics: Vec<NoteDiagnostic>) -> Response {
    let error = diagnostics.first().map_or_else(
        || "The research entry is invalid".to_string(),
        |first| first.to_string(),
    );
    Response::json(
        422,
        &json!({
            "error": error,
            "file": notebook_store::NOTEBOOK_FILE,
            "diagnostics": diagnostics,
        }),
    )
}

/// A conflict carries the latest revision and the newer copy of the entry
/// being changed, so the editor can keep the draft and compare it. Nothing is
/// written either way.
fn notebook_store_error(
    state: &AppState,
    error: notebook_store::StoreError,
    entry: Option<(bool, &str)>,
) -> Response {
    match error {
        notebook_store::StoreError::Conflict => {
            let latest = notebook_store::load(&state.root, &source_contributors(state)).ok();
            let current = latest
                .as_ref()
                .zip(entry)
                .and_then(|(snapshot, (passage, id))| {
                    if passage {
                        snapshot.notebook.passage(id).map(|p| json!(p))
                    } else {
                        snapshot.notebook.note(id).map(|n| json!(n))
                    }
                });
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
        notebook_store::StoreError::Invalid(diagnostics) => notebook_diagnostics(diagnostics),
        notebook_store::StoreError::Storage(message) => Response::error(500, &message),
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

/// The portable projection of `post` that the Admin previews and that an acknowledgement checks,
/// with the post's series context taken from `site` (ADR 0041). The portability preview and the
/// acknowledgement both build it here, so the source revision a preview hands out is the one the
/// acknowledgement recomputes: `Site::series_context` counts only published parts whether `site`
/// holds drafts or scheduled posts or not, so a draft or scheduled part has no context in either.
fn admin_portable_projection<'a>(
    site: &Site,
    post: &'a openblog_core::Post,
    config: &SiteConfig,
) -> Result<openblog_core::portability::PortableProjection<'a>, String> {
    Ok(
        openblog_core::portability::PortableProjection::for_authenticated_preview(post, config)?
            .with_series(site.series_context(post)),
    )
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

thread_local! {
    /// The provider timeout in tests. It leaves a loaded machine plenty of time to answer; a test
    /// that exercises the timeout itself shortens it.
    static TEST_PROVIDER_TIMEOUT: std::cell::Cell<Duration> =
        const { std::cell::Cell::new(Duration::from_secs(10)) };
}

fn assistant_provider_timeout(provider: AssistantProviderKind, test_mode: bool) -> Duration {
    if test_mode {
        return TEST_PROVIDER_TIMEOUT.with(std::cell::Cell::get);
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
    crate::fsutil::replace_file(&temporary, path).map_err(|error| {
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
    // A binding follows its registry key by name, so a bound key must never be freed for reuse.
    let bound = match crate::shared_publications::bound_contributor_ids(&state.root) {
        Ok(bound) => bound,
        Err(error) => return Response::error(500, &error),
    };
    let bound_removed = removed
        .iter()
        .filter(|id| bound.contains(*id))
        .collect::<Vec<_>>();
    if !bound_removed.is_empty() {
        return Response::json(
            422,
            &json!({
                "error": "Contributors who take part in a shared reflection cannot be removed.",
                "contributors": bound_removed,
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
// Shared publications
// ---------------------------------------------------------------------------

/// The create request. Unknown fields are refused, so a body cannot name an Admin user,
/// participant, role, or binding: identity comes from the session and the registry.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SharedPublicationRequest {
    #[serde(default)]
    title: String,
    #[serde(default)]
    guiding_question: String,
    #[serde(default)]
    contributor_id: String,
    sources: Vec<SharedSourceRequest>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SharedSourceRequest {
    kind: SourceKind,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    creator: String,
    #[serde(default)]
    publisher: String,
    #[serde(default)]
    published: String,
    #[serde(default)]
    isbn: String,
}

fn shared_problem(field: &str, message: &str) -> Response {
    Response::json(422, &json!({ "error": message, "field": field }))
}

/// A field-specific message for the requester's own submission. It never repeats a value.
fn shared_publication_problem(error: SharedPublicationError) -> Response {
    let source_message = |index: usize, field: SourceField| {
        let number = index + 1;
        let (key, message) = match field {
            SourceField::Title => ("title", format!("Source {number}: add a title with visible text, up to 300 bytes, on one line.")),
            SourceField::Url => ("url", format!("Source {number}: paste a full web address that starts with https:// or http://, without a username or password.")),
            SourceField::Creator => ("creator", format!("Source {number}: shorten who made it to 200 bytes on one line.")),
            SourceField::Publisher => ("publisher", format!("Source {number}: shorten the publisher to 200 bytes on one line.")),
            SourceField::Published => ("published", format!("Source {number}: write the date briefly, such as 2019 or March 2021.")),
            SourceField::Isbn => ("isbn", format!("Source {number}: an ISBN has 10 or 13 digits and is only used for books.")),
        };
        shared_problem(&format!("sources.{index}.{key}"), &message)
    };
    match error {
        SharedPublicationError::TitleOrQuestionRequired => {
            shared_problem("title", "Add a working title or a guiding question.")
        }
        SharedPublicationError::Title => shared_problem(
            "title",
            "Use a title with visible text, up to 300 bytes, on one line.",
        ),
        SharedPublicationError::GuidingQuestion => shared_problem(
            "guidingQuestion",
            "Use a guiding question with visible text, up to 1,000 bytes, on one line.",
        ),
        SharedPublicationError::NoSources => {
            shared_problem("sources", "Add the source you are reflecting on.")
        }
        SharedPublicationError::TooManySources => {
            shared_problem("sources", "A shared reflection can list at most 20 sources.")
        }
        SharedPublicationError::Source { index, field } => source_message(index, field),
        SharedPublicationError::Creator => shared_problem(
            "contributorId",
            "This contributor profile cannot join a shared reflection. Check its public name in Contributors.",
        ),
        SharedPublicationError::InvalidRecord => {
            Response::error(500, "The shared reflection could not be prepared.")
        }
    }
}

/// What a bound participant may read about a publication: never bindings, other participants,
/// Admin usernames, or contribution drafts.
fn shared_publication_summary(record: &SharedPublication, roles: &[AuthorizationRole]) -> Json {
    json!({
        "publicationId": record.publication_id,
        "title": record.title,
        "guidingQuestion": record.guiding_question,
        "sources": record.sources,
        "roles": roles,
    })
}

/// Server-side identity facts for authorization: current account names and registry keys.
fn collaboration_identities(
    root: &Path,
    config: &SiteConfig,
) -> Result<(Vec<String>, Vec<String>), Response> {
    let users = Users::load(&root.join(&config.admin.users_file))
        .map_err(|error| Response::error(500, &error))?;
    Ok((
        users.users.iter().map(|user| user.name.clone()).collect(),
        config.contributors.keys().cloned().collect(),
    ))
}

fn list_shared_publications(state: &AppState, session: &auth::Session) -> Response {
    let _content_transaction = lock(&state.build);
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let (admin_users, contributor_ids) = match collaboration_identities(&state.root, &config) {
        Ok(identities) => identities,
        Err(response) => return response,
    };
    let admin_users = admin_users.iter().map(String::as_str).collect::<Vec<_>>();
    let contributor_ids = contributor_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let records = match crate::shared_publications::load_all(&state.root) {
        Ok(records) => records,
        Err(error) => return Response::error(500, &error),
    };
    let publications = records
        .iter()
        .filter_map(|(_, record)| {
            let identities = openblog_core::invitation::Identities {
                active_admin_users: &admin_users,
                contributor_ids: &contributor_ids,
            };
            record
                .authorize(
                    &session.user,
                    &identities,
                    AuthorizationAction::ViewPublication,
                    AuthorizationTarget::Publication,
                )
                .ok()
                .map(|binding| shared_publication_summary(record, &binding.roles))
        })
        .collect::<Vec<_>>();
    Response::json(200, &json!({ "publications": publications }))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceMetadataRequest {
    url: String,
}

/// Optional help for one source link: the embed the renderer would use (found offline) and, for
/// a supported provider, bounded suggestions labelled with their provider. Nothing is stored and
/// no outcome is an error, so authoring never depends on a provider answering.
fn shared_source_metadata(req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<SourceMetadataRequest>(&req.body) else {
        return Response::error(400, "Send the link to look up.");
    };
    if body.url.len() > 2048 {
        return Response::json(200, &json!({ "status": "unsupported" }));
    }
    use crate::source_metadata::Lookup;
    let embed_json = |found: &openblog_core::embed::Embed| json!({ "provider": found.provider, "link": found.link, "linkLabel": found.link_label });
    let payload = match crate::source_metadata::lookup(&body.url) {
        Lookup::Unsupported => json!({ "status": "unsupported" }),
        Lookup::Unavailable(message, found) => {
            json!({ "status": "unavailable", "message": message, "embed": embed_json(&found) })
        }
        Lookup::Found(suggestion, found) => {
            json!({ "status": "found", "suggestion": suggestion, "embed": embed_json(&found) })
        }
    };
    Response::json(200, &payload)
}

fn create_shared_publication(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<SharedPublicationRequest>(&req.body) else {
        return shared_problem(
            "",
            "This shared reflection request is not valid. Reload Admin Studio and try again.",
        );
    };
    if !openblog_core::collaboration::valid_admin_username(&session.user) {
        return shared_problem(
            "",
            "Your sign-in name cannot join a shared reflection. Ask the site owner for an account named with lowercase letters, digits, dots, hyphens, or underscores.",
        );
    }
    let _status = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => return Response::error(500, &error),
    };
    let Some(contributor) = config.contributors.get(&body.contributor_id) else {
        return shared_problem(
            "contributorId",
            "Choose the contributor profile you will appear as.",
        );
    };
    let new = NewSharedPublication {
        publication_id: String::new(),
        title: body.title,
        guiding_question: body.guiding_question,
        sources: body
            .sources
            .into_iter()
            .map(|source| NewSourceReference {
                kind: source.kind,
                title: source.title,
                url: source.url,
                creator: source.creator,
                publisher: source.publisher,
                published: source.published,
                isbn: source.isbn,
            })
            .collect(),
        creator: NewParticipant {
            admin_user: session.user.clone(),
            contributor_id: body.contributor_id.clone(),
            display_name: contributor.name.clone(),
        },
    };
    match crate::shared_publications::create(&state.root, new) {
        Ok(record) => {
            eprintln!(
                "admin: created shared publication {}",
                record.publication_id
            );
            let roles = record.authorization.bindings[0].roles.clone();
            Response::json(
                201,
                &json!({ "publication": shared_publication_summary(&record, &roles) }),
            )
        }
        Err(crate::shared_publications::CreateError::Invalid(error)) => {
            shared_publication_problem(error)
        }
        Err(crate::shared_publications::CreateError::Storage(error)) => {
            eprintln!("admin: shared publication not stored: {error}");
            Response::error(
                500,
                "The shared reflection could not be saved. Nothing was created; try again.",
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Shared publication invitations
// ---------------------------------------------------------------------------

/// Invitation requests name the publication and the invited account; the inviter always comes
/// from the session. Unknown fields are refused.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InviteRequest {
    publication_id: String,
    admin_user: String,
    contributor_id: String,
    roles: Vec<AuthorizationRole>,
    #[serde(default)]
    lifetime_days: u32,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InvitationActionRequest {
    publication_id: String,
    invitation_id: String,
    #[serde(default)]
    lifetime_days: u32,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InvitationTokenRequest {
    token: String,
    #[serde(default)]
    contributor_id: String,
}

const INVITATION_UNAVAILABLE: &str = "This invitation cannot be used. It may have expired, been withdrawn, already been answered, or be meant for a different account.";

fn invitation_not_found() -> Response {
    Response::error(
        404,
        "That shared reflection was not found, or you cannot invite people to it.",
    )
}

fn invitation_problem(error: InvitationError) -> Response {
    match error {
        InvitationError::Denied => invitation_not_found(),
        InvitationError::Unavailable => Response::error(400, INVITATION_UNAVAILABLE),
        InvitationError::Invalid(field) => {
            let (name, message) = match field {
                InvitationField::AdminUser => (
                    "adminUser",
                    "Choose an Admin account that is not already taking part or invited.",
                ),
                InvitationField::ContributorId => (
                    "contributorId",
                    "Choose a contributor profile that is not already taking part or invited.",
                ),
                InvitationField::Roles => {
                    ("roles", "Choose at least one role, without repeating any.")
                }
                InvitationField::Lifetime => {
                    ("lifetimeDays", "An invitation can last from 1 to 30 days.")
                }
                InvitationField::Capacity => (
                    "",
                    "This shared reflection has too many invitations or participants. Revoke some and try again.",
                ),
            };
            shared_problem(name, message)
        }
    }
}

fn invitation_summary(invitation: &Invitation, now: i64) -> Json {
    json!({
        "id": invitation.id,
        "adminUser": invitation.admin_user,
        "contributorId": invitation.contributor_id,
        "roles": invitation.roles,
        "state": invitation.status(now),
        "createdAt": invitation.created_at,
        "expiresAt": invitation.expires_at,
    })
}

fn new_invitation_ids() -> Result<(String, String), String> {
    let bytes: [u8; 6] = auth::random_bytes()?;
    let id = format!(
        "invitation-{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    Ok((id, auth::random_token()?))
}

/// Everything a request to change invitations needs, loaded in one transaction: the record, the
/// current identities, and the lock guards. The guards drop with this value.
struct InvitationTransaction<'a> {
    // Fields drop in declaration order. The lock file must go before the build mutex is
    // released: otherwise the next request waiting on the mutex finds the lock file still there
    // and is refused as if another write were active.
    _filesystem: Option<crate::transaction::ContentTransactionLock>,
    _build: MutexGuard<'a, BuildStatus>,
    record: Option<SharedPublication>,
    admin_users: Vec<String>,
    contributor_ids: Vec<String>,
    contributors: std::collections::BTreeMap<String, String>,
}

fn invitation_transaction<'a>(
    state: &'a AppState,
    publication_id: &str,
) -> Result<InvitationTransaction<'a>, Response> {
    let build = lock(&state.build);
    let filesystem = content_transaction(state)?;
    let config = site::load_config(&state.root).map_err(|error| Response::error(500, &error))?;
    let (admin_users, contributor_ids) = collaboration_identities(&state.root, &config)?;
    let record = crate::shared_publications::load(&state.root, publication_id)
        .map_err(|error| Response::error(500, &error))?;
    Ok(InvitationTransaction {
        _build: build,
        _filesystem: filesystem,
        record,
        admin_users,
        contributor_ids,
        contributors: config
            .contributors
            .iter()
            .map(|(key, contributor)| (key.clone(), contributor.name.clone()))
            .collect(),
    })
}

impl InvitationTransaction<'_> {
    fn with_identities<T>(&self, run: impl FnOnce(&Identities<'_>) -> T) -> T {
        let admin_users = self
            .admin_users
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        let contributor_ids = self
            .contributor_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        run(&Identities {
            active_admin_users: &admin_users,
            contributor_ids: &contributor_ids,
        })
    }

    fn store(&self, root: &Path, next: &SharedPublication) -> Result<(), Response> {
        let previous = self.record.as_ref().ok_or_else(invitation_not_found)?;
        match crate::shared_publications::replace(root, previous, next) {
            Ok(()) => Ok(()),
            Err(crate::shared_publications::ReplaceError::Conflict) => Err(Response::error(
                409,
                "This shared reflection changed while you were working. Reload and try again.",
            )),
            Err(crate::shared_publications::ReplaceError::TooLarge) => Err(Response::error(
                500,
                "The invitation could not be saved. Nothing changed; try again.",
            )),
            Err(crate::shared_publications::ReplaceError::Storage(error)) => {
                eprintln!("admin: invitation not stored: {error}");
                Err(Response::error(
                    500,
                    "The invitation could not be saved. Nothing changed; try again.",
                ))
            }
        }
    }
}

fn invitation_link(token: &str) -> String {
    format!("/admin/#/shared/accept/{token}")
}

fn list_invitations(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return invitation_not_found();
    };
    let transaction = match invitation_transaction(state, publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return invitation_not_found();
    };
    let now = clock::now().unix();
    transaction.with_identities(|identities| {
        match record.invitations_for(&session.user, identities) {
            Ok(invitations) => Response::json(
                200,
                &json!({
                    "invitations": invitations
                        .iter()
                        .map(|invitation| invitation_summary(invitation, now))
                        .collect::<Vec<_>>(),
                }),
            ),
            Err(error) => invitation_problem(error),
        }
    })
}

fn bad_invitation_request() -> Response {
    shared_problem(
        "",
        "This invitation request is not valid. Reload Admin Studio and try again.",
    )
}

fn create_invitation(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<InviteRequest>(&req.body) else {
        return bad_invitation_request();
    };
    let transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return invitation_not_found();
    };
    let (id, secret) = match new_invitation_ids() {
        Ok(ids) => ids,
        Err(error) => return Response::error(500, &error),
    };
    let new = NewInvitation {
        id,
        secret,
        admin_user: body.admin_user,
        contributor_id: body.contributor_id,
        roles: body.roles,
        lifetime_days: body.lifetime_days,
    };
    let now = clock::now().unix();
    let invited = transaction
        .with_identities(|identities| record.invite(&session.user, identities, &new, now));
    finish_invitation(state, &transaction, invited, &new.id, now)
}

fn finish_invitation(
    state: &AppState,
    transaction: &InvitationTransaction<'_>,
    result: Result<(SharedPublication, String), InvitationError>,
    invitation_id: &str,
    now: i64,
) -> Response {
    let (next, token) = match result {
        Ok(result) => result,
        Err(error) => return invitation_problem(error),
    };
    if let Err(response) = transaction.store(&state.root, &next) {
        return response;
    }
    eprintln!("admin: issued shared publication invitation {invitation_id}");
    let Some(invitation) = next
        .invitations
        .iter()
        .find(|invitation| invitation.id == invitation_id)
    else {
        return Response::error(500, "The invitation could not be prepared.");
    };
    Response::json(
        201,
        &json!({
            "invitation": invitation_summary(invitation, now),
            "token": token,
            "link": invitation_link(&token),
        }),
    )
    .with_header("Cache-Control", "no-store")
}

fn revoke_invitation(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<InvitationActionRequest>(&req.body) else {
        return bad_invitation_request();
    };
    let transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return invitation_not_found();
    };
    let now = clock::now().unix();
    let result = transaction.with_identities(|identities| {
        record.revoke_invitation(&session.user, identities, &body.invitation_id, now)
    });
    let next = match result {
        Ok(next) => next,
        Err(error) => return invitation_problem(error),
    };
    if let Err(response) = transaction.store(&state.root, &next) {
        return response;
    }
    eprintln!(
        "admin: revoked shared publication invitation {}",
        body.invitation_id
    );
    let summary = next
        .invitations
        .iter()
        .find(|invitation| invitation.id == body.invitation_id)
        .map(|invitation| invitation_summary(invitation, now));
    Response::json(200, &json!({ "invitation": summary }))
}

fn reissue_invitation(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<InvitationActionRequest>(&req.body) else {
        return bad_invitation_request();
    };
    let transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return invitation_not_found();
    };
    let (id, secret) = match new_invitation_ids() {
        Ok(ids) => ids,
        Err(error) => return Response::error(500, &error),
    };
    let replacement = NewInvitation {
        id,
        secret,
        lifetime_days: body.lifetime_days,
        ..NewInvitation::default()
    };
    let now = clock::now().unix();
    let result = transaction.with_identities(|identities| {
        record.reissue_invitation(
            &session.user,
            identities,
            &body.invitation_id,
            &replacement,
            now,
        )
    });
    finish_invitation(state, &transaction, result, &replacement.id, now)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MemberRequest {
    publication_id: String,
    participant_id: String,
    expected_revision: u64,
    #[serde(default)]
    roles: Vec<AuthorizationRole>,
}

fn member_problem(error: MemberError) -> Response {
    match error {
        MemberError::Denied => Response::error(
            404,
            "That shared reflection or member was not found, or you cannot manage it.",
        ),
        MemberError::Stale => Response::error(
            409,
            "The members changed while you were working. Reload to see the current list, then try again.",
        ),
        MemberError::Roles => {
            shared_problem("roles", "Choose at least one role, without repeating any.")
        }
        MemberError::Invalid => Response::error(
            400,
            "That change would leave the shared reflection in an invalid state.",
        ),
    }
}

fn list_members(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return invitation_not_found();
    };
    let transaction = match invitation_transaction(state, publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return invitation_not_found();
    };
    transaction.with_identities(
        |identities| match record.members_for(&session.user, identities) {
            Ok(members) => Response::json(
                200,
                &json!({ "revision": record.authorization.revision, "members": members }),
            ),
            Err(error) => member_problem(error),
        },
    )
}

/// Changes who can sign in to one reflection. Only the policy changes; the participant, their
/// drafts, approvals, and credit stay as they were.
fn change_member(
    state: &AppState,
    req: &Request,
    session: &auth::Session,
    remove: bool,
) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<MemberRequest>(&req.body) else {
        return bad_invitation_request();
    };
    let transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return invitation_not_found();
    };
    let result = transaction.with_identities(|identities| {
        if remove {
            record.remove_member(
                &session.user,
                identities,
                &body.participant_id,
                body.expected_revision,
            )
        } else {
            record.change_member_roles(
                &session.user,
                identities,
                &body.participant_id,
                &body.roles,
                body.expected_revision,
            )
        }
    });
    let next = match result {
        Ok(next) => next,
        Err(error) => return member_problem(error),
    };
    if let Err(response) = transaction.store(&state.root, &next) {
        return response;
    }
    reconcile_approvals(state, &transaction, &next);
    eprintln!(
        "admin: {} a member of shared publication {}",
        if remove {
            "removed"
        } else {
            "changed roles of"
        },
        body.publication_id
    );
    Response::json(200, &json!({ "revision": next.authorization.revision }))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DraftSaveRequest {
    publication_id: String,
    expected_revision: u64,
    markdown: String,
}

/// Every refusal to touch a draft reads the same, so it cannot confirm that a reflection, a
/// participant, or another person's draft exists.
fn draft_not_found() -> Response {
    Response::error(
        404,
        "That shared reflection was not found, or you cannot write a draft in it.",
    )
}

fn draft_json(view: &DraftView) -> Json {
    json!({ "stamp": view.stamp, "markdown": view.markdown })
}

/// The requester's own participant id once `SharedPublication::authorize` allows them to edit
/// their draft; the single entry point decides, so a Reader, a stale binding, or a removed
/// account gets nothing.
fn draft_owner(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
) -> Option<String> {
    let own = record
        .authorization
        .bindings
        .iter()
        .find(|binding| binding.admin_user == session.user)?
        .participant_id
        .clone();
    transaction
        .with_identities(|identities| {
            record
                .authorize(
                    &session.user,
                    identities,
                    AuthorizationAction::EditDraft,
                    AuthorizationTarget::Participant(&own),
                )
                .map(|binding| binding.participant_id.clone())
        })
        .ok()
}

/// The set with every current participant admitted, so a participant who joined later can save.
fn draft_set_for(
    stored: Option<&DraftSet>,
    record: &SharedPublication,
) -> Result<DraftSet, DraftError> {
    let ids = record
        .collaboration
        .participants
        .iter()
        .map(|participant| participant.id.as_str())
        .collect::<Vec<_>>();
    let mut set = match stored {
        Some(set) => set.clone(),
        None => DraftSet::new(&ids)?,
    };
    for id in ids {
        set.admit(id)?;
    }
    Ok(set)
}

fn draft_request_target<'a>(
    state: &'a AppState,
    publication_id: &str,
    session: &auth::Session,
) -> Result<(InvitationTransaction<'a>, String), Response> {
    let transaction = invitation_transaction(state, publication_id)?;
    let own = match &transaction.record {
        Some(record) => draft_owner(&transaction, record, session),
        None => None,
    };
    match own {
        Some(own) => Ok((transaction, own)),
        None => Err(draft_not_found()),
    }
}

/// Reads only the signed-in participant's own latest draft. Nobody else's draft has a route.
fn read_own_draft(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return draft_not_found();
    };
    let (transaction, own) = match draft_request_target(state, publication_id, session) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let stored = match crate::shared_publications::load_drafts(&state.root, publication_id) {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!("admin: drafts not readable for {publication_id}: {error}");
            return Response::error(500, "Your draft could not be read. Nothing was changed.");
        }
    };
    drop(transaction);
    let draft = stored
        .set
        .as_ref()
        .and_then(|set| set.view(&own, &own, &[own.as_str()]).ok())
        .map(|view| draft_json(&view));
    Response::json(200, &json!({ "draft": draft }))
}

/// Saves the signed-in participant's own draft as a new revision. A save built on an older
/// revision is refused with the newer copy; the caller keeps what it typed and nothing is
/// overwritten.
fn save_own_draft(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<DraftSaveRequest>(&req.body) else {
        return shared_problem(
            "",
            "This draft request is not valid. Reload Admin Studio and try again.",
        );
    };
    let (transaction, own) = match draft_request_target(state, &body.publication_id, session) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let record = transaction.record.as_ref().expect("authorized record");
    let stored = match crate::shared_publications::load_drafts(&state.root, &body.publication_id) {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!(
                "admin: drafts not readable for {}: {error}",
                body.publication_id
            );
            return Response::error(500, "Your draft could not be saved. Nothing was changed.");
        }
    };
    let Ok(mut set) = draft_set_for(stored.set.as_ref(), record) else {
        return Response::error(500, "Your draft could not be saved. Nothing was changed.");
    };
    let now = clock::now().unix();
    match set.save(&own, &own, body.expected_revision, &body.markdown, now) {
        Ok(stamp) => {
            match crate::shared_publications::replace_drafts(
                &state.root,
                &body.publication_id,
                &stored,
                &set,
            ) {
                Ok(()) => {
                    reconcile_approvals(state, &transaction, record);
                    eprintln!(
                        "admin: saved draft revision {} of shared publication {}",
                        stamp.number, body.publication_id
                    );
                    Response::json(200, &json!({ "stamp": stamp }))
                }
                Err(crate::shared_publications::ReplaceError::Conflict) => Response::error(
                    409,
                    "Your draft changed while you were saving. Reload to see the newer copy.",
                ),
                Err(crate::shared_publications::ReplaceError::TooLarge) => draft_limit_problem(),
                Err(crate::shared_publications::ReplaceError::Storage(error)) => {
                    eprintln!("admin: draft not stored: {error}");
                    Response::error(500, "Your draft could not be saved. Nothing was changed.")
                }
            }
        }
        Err(DraftError::Stale) => {
            let current = set
                .view(&own, &own, &[own.as_str()])
                .ok()
                .map(|view| draft_json(&view));
            Response::json(
                409,
                &json!({
                    "error": "Your draft changed since you last read it. Your text was not saved and nothing was overwritten; compare it with the newer copy.",
                    "current": current,
                }),
            )
        }
        Err(DraftError::Invalid) => shared_problem(
            "markdown",
            "That draft is too large or contains characters that cannot be saved.",
        ),
        Err(DraftError::LimitReached) => draft_limit_problem(),
        Err(DraftError::Denied) => draft_not_found(),
    }
}

// ---------------------------------------------------------------------------
// Approval, scheduling and publication of a shared reflection (ADR 0022)
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ApproveRequest {
    publication_id: String,
    /// The token the approver read with the combined preview.
    seen: String,
    affirmed: bool,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PublicationRequest {
    publication_id: String,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ScheduleRequest {
    publication_id: String,
    /// RFC 3339 time to publish, or null to cancel a pending schedule.
    #[serde(default)]
    publish_at: Option<String>,
}

/// Every refusal to approve, schedule or publish for someone who may not reads the same.
fn publish_not_found() -> Response {
    Response::error(
        404,
        "That shared reflection was not found, or you cannot do that with it.",
    )
}

fn published_already() -> Response {
    Response::error(
        409,
        "This shared reflection is already published. Nothing was changed.",
    )
}

fn publish_request_problem() -> Response {
    shared_problem(
        "",
        "This request is not valid. Reload Admin Studio and try again.",
    )
}

fn publish_failed(error: &str) -> Response {
    // The detail is logged without prose: it names a path or an I/O error, never a draft.
    eprintln!("admin: shared publication not published: {error}");
    Response::error(
        500,
        "The reflection could not be published. Nothing was changed.",
    )
}

fn publish_store_problem(error: crate::shared_publications::ReplaceError) -> Response {
    use crate::shared_publications::ReplaceError;
    match error {
        ReplaceError::Conflict => Response::error(
            409,
            "This shared reflection changed while you were working. Reload and try again; nothing was changed.",
        ),
        ReplaceError::TooLarge => publish_failed("state too large"),
        ReplaceError::Storage(error) => publish_failed(&error),
    }
}

/// Everything the gate reads, loaded in the request's transaction.
struct GateInputs {
    drafts: DraftSet,
    structure: crate::shared_publications::StoredStructure,
    synthesis: openblog_core::synthesis::SynthesisSet,
    approvals: crate::shared_publications::StoredApprovals,
    outcome: crate::shared_publications::StoredOutcome,
    active: Vec<String>,
}

fn gate_inputs(
    state: &AppState,
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
) -> Result<GateInputs, Response> {
    let id = &record.publication_id;
    let stored = load_reveal_drafts(state, id)?;
    let drafts = draft_set_for(stored.set.as_ref(), record)
        .map_err(|_| publish_failed("drafts are not usable"))?;
    let synthesis = crate::shared_publications::load_synthesis(&state.root, id)
        .map_err(|error| publish_failed(&error))?
        .set;
    let approvals = crate::shared_publications::load_approvals_for_update(&state.root, id)
        .map_err(|error| publish_failed(&error))?;
    let structure = crate::shared_publications::load_structure(&state.root, id)
        .map_err(|error| publish_failed(&error))?;
    let outcome = crate::shared_publications::load_outcome(&state.root, id)
        .map_err(|error| publish_failed(&error))?;
    Ok(GateInputs {
        drafts,
        structure,
        synthesis,
        approvals,
        outcome,
        active: active_drafters(transaction, record),
    })
}

/// The grant check, always through the single entry point. A requester without the grant, or
/// whose account, key or participant is gone, learns nothing; only one who holds it can be told
/// that approvals are missing.
fn authorize_publisher(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    admin_user: &str,
    schedule: bool,
) -> Result<(), Response> {
    transaction
        .with_identities(|identities| {
            if schedule {
                record
                    .authorize(
                        admin_user,
                        identities,
                        AuthorizationAction::Schedule,
                        AuthorizationTarget::Publication,
                    )
                    .map_err(|_| PublishError::Denied)?;
            }
            record.authorize_publish(admin_user, identities)
        })
        .map_err(|error| match error {
            PublishError::Denied => publish_not_found(),
            PublishError::Unapproved => Response::json(
                409,
                &json!({ "error": "Every author must approve the current piece before it can be published. Nothing was changed.", "missing": [] }),
            ),
        })
}

/// A post ready to write, checked against the site before anything is written.
struct Prepared {
    assembly: openblog_core::assembly::Assembly,
    path: PathBuf,
    sidecar: PathBuf,
    previous_document: Option<Vec<u8>>,
    previous_sidecar: Option<Vec<u8>>,
}

/// Assemble the approved piece and prove the site accepts it, without writing anything. Refusals
/// never repeat prose: they name authors whose approval is missing, or say the piece could not
/// be made.
fn prepare_post(
    state: &AppState,
    record: &SharedPublication,
    inputs: &GateInputs,
    date: DateTime,
) -> Result<Prepared, Response> {
    use openblog_core::assembly::{assemble, AssemblyError};
    let active = inputs.active.iter().map(String::as_str).collect::<Vec<_>>();
    let build = |date: &str| {
        assemble(
            record,
            inputs.structure.structure.as_ref(),
            &inputs.drafts,
            &inputs.synthesis,
            &inputs.approvals.set,
            &active,
            date,
        )
    };
    let mut assembly = match build(&date.rfc3339()) {
        Ok(assembly) => assembly,
        Err(AssemblyError::Blocked { missing }) => {
            return Err(Response::json(
                409,
                &json!({
                    "error": "Every required author must approve the current piece first. Nothing was changed.",
                    "missing": missing,
                }),
            ))
        }
        Err(AssemblyError::UnsafeMarkup) => {
            return Err(shared_problem(
                "",
                "A section contains raw HTML or an unsafe link, which shared reflections do not publish. Ask its author to remove it and approve again. Nothing was changed.",
            ))
        }
        Err(AssemblyError::ReservedSectionAnchor) => {
            return Err(shared_problem(
                "",
                "A section heading uses an anchor reserved for the generated continuing conversation (`continuing-the-conversation` or `conversation-<category>[-<n>]`). Ask its author to rename the heading and approve again. Nothing was changed.",
            ))
        }
        Err(AssemblyError::UnsafeConversationItem(rule, item)) => {
            return Err(shared_problem(
                "",
                &format!(
                    "The continuing conversation cannot be published: {} contains {}. Ask its author to edit the item and approve it again. Nothing was changed.",
                    item.describe(),
                    rule.describe()
                ),
            ))
        }
        Err(AssemblyError::Invalid) => {
            return Err(shared_problem(
                "",
                "This reflection cannot be published yet: it needs a title and at least one written section. Nothing was changed.",
            ))
        }
    };
    let config = site::load_config(&state.root).map_err(|error| publish_failed(&error))?;
    let path = resolve_content_path(&state.root, &config, &assembly.path)
        .map_err(|error| publish_failed(&error))?;
    let sidecar = resolve_credit_path(&state.root, &config, &assembly.path)
        .map_err(|error| publish_failed(&error))?;
    let previous_document = read_optional_bytes(&path).map_err(|error| publish_failed(&error))?;
    let previous_sidecar = read_optional_bytes(&sidecar).map_err(|error| publish_failed(&error))?;
    if let Some(existing) = &previous_document {
        let same = |candidate: &openblog_core::assembly::Assembly| {
            existing == candidate.source.as_bytes()
                && previous_sidecar.as_deref() == Some(candidate.credits.as_bytes())
        };
        if !same(&assembly) {
            // An earlier attempt may have been interrupted after writing: it keeps its date.
            let original = std::str::from_utf8(existing)
                .ok()
                .and_then(|text| frontmatter::parse(text).ok())
                .and_then(|document| document.front_matter.get("date").map(str::to_string))
                .and_then(|date| build(&date).ok());
            match original {
                Some(candidate) if same(&candidate) => assembly = candidate,
                _ => {
                    return Err(Response::error(
                        409,
                        "A different file already occupies this reflection's place. Nothing was changed.",
                    ))
                }
            }
        }
    }
    if validate_candidate(
        &state.root,
        &config,
        &assembly.path,
        &assembly.source,
        &CreditEdit::Set(assembly.credits.clone()),
    )
    .is_err()
    {
        // The problems quote the authors' prose, which the requester may not be entitled to read.
        return Err(shared_problem(
            "",
            "The combined piece could not be built into the site. Ask the authors to review the combined preview. Nothing was changed.",
        ));
    }
    Ok(Prepared {
        assembly,
        path,
        sidecar,
        previous_document,
        previous_sidecar,
    })
}

/// Write the Post and its credits, record the outcome, and rebuild, as one unit: if any step
/// fails, every earlier one is undone and public output is rebuilt from the restored content.
/// Publishing an already-published reflection changes nothing and succeeds again.
fn commit_publication(
    state: &AppState,
    transaction: &mut InvitationTransaction<'_>,
    record: &SharedPublication,
    date: DateTime,
) -> Result<Json, Response> {
    use crate::shared_publications::replace_outcome;
    use openblog_core::assembly::Outcome;
    let inputs = gate_inputs(state, transaction, record)?;
    if matches!(inputs.outcome.outcome, Some(Outcome::Published { .. })) {
        return Ok(json!({ "state": "published", "alreadyPublished": true }));
    }
    let prepared = prepare_post(state, record, &inputs, date)?;
    let id = &record.publication_id;
    let rollback_files = |prepared: &Prepared| {
        let _ = restore_file(&prepared.path, prepared.previous_document.as_deref());
        let _ = restore_file(&prepared.sidecar, prepared.previous_sidecar.as_deref());
    };
    if let Some(parent) = prepared.path.parent() {
        fs::create_dir_all(parent).map_err(|error| publish_failed(&error.to_string()))?;
    }
    write_document_with_credits(
        &prepared.path,
        &prepared.sidecar,
        &prepared.assembly.source,
        &CreditEdit::Set(prepared.assembly.credits.clone()),
    )
    .map_err(|error| publish_failed(&error))?;
    let published = Outcome::published(clock::now().unix());
    let stored = match replace_outcome(&state.root, id, &inputs.outcome, Some(&published)) {
        Ok(stored) => stored,
        Err(error) => {
            rollback_files(&prepared);
            return Err(publish_store_problem(error));
        }
    };
    if let Err(error) = state.rebuild_locked(&mut transaction._build) {
        let _ = replace_outcome(&state.root, id, &stored, inputs.outcome.outcome.as_ref());
        rollback_files(&prepared);
        let _ = state.rebuild_locked(&mut transaction._build);
        return Err(publish_failed(&error));
    }
    eprintln!("admin: published shared publication {id}");
    if let Some(title) = &record.title {
        state_arc(state).auto_publish(title.clone());
    }
    Ok(json!({ "state": "published", "alreadyPublished": false }))
}

/// Publish the approved piece now. The publish grant is necessary but never enough: every
/// required author's approval must match the content as it is at this moment.
fn publish_shared(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<PublicationRequest>(&req.body) else {
        return publish_request_problem();
    };
    let mut transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = transaction.record.clone() else {
        return publish_not_found();
    };
    if let Err(response) = authorize_publisher(&transaction, &record, &session.user, false) {
        return response;
    }
    match commit_publication(state, &mut transaction, &record, clock::now()) {
        Ok(result) => Response::json(200, &result),
        Err(response) => response,
    }
}

/// Hold the approved piece privately until a time, or cancel that. Nothing enters content until
/// the time comes, and then only if the approvals still match (checked again by the scheduler).
fn schedule_shared(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    use crate::shared_publications::replace_outcome;
    use openblog_core::assembly::Outcome;
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<ScheduleRequest>(&req.body) else {
        return publish_request_problem();
    };
    let transaction = match invitation_transaction(state, &body.publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = transaction.record.clone() else {
        return publish_not_found();
    };
    if let Err(response) = authorize_publisher(&transaction, &record, &session.user, true) {
        return response;
    }
    let inputs = match gate_inputs(state, &transaction, &record) {
        Ok(inputs) => inputs,
        Err(response) => return response,
    };
    if matches!(inputs.outcome.outcome, Some(Outcome::Published { .. })) {
        return published_already();
    }
    let id = &record.publication_id;
    let Some(text) = &body.publish_at else {
        if inputs.outcome.outcome.is_some() {
            if let Err(error) = replace_outcome(&state.root, id, &inputs.outcome, None) {
                return publish_store_problem(error);
            }
        }
        return Response::json(200, &json!({ "state": "unscheduled" }));
    };
    let Some(at) = DateTime::parse(text).filter(|at| at.unix() > clock::now().unix()) else {
        return shared_problem(
            "publishAt",
            "Choose a time in the future, as a date and time such as 2030-01-31T09:00:00Z. To publish now, use Publish.",
        );
    };
    // Refuse now what would be refused later: unapproved or unbuildable pieces are never held.
    if let Err(response) = prepare_post(state, &record, &inputs, at) {
        return response;
    }
    let next = Outcome::scheduled(at.unix(), &session.user);
    if inputs.outcome.outcome.as_ref() != Some(&next) {
        if let Err(error) = replace_outcome(&state.root, id, &inputs.outcome, Some(&next)) {
            return publish_store_problem(error);
        }
    }
    Response::json(
        200,
        &json!({ "state": "scheduled", "publishAt": at.rfc3339() }),
    )
}

/// Publish every scheduled reflection whose time has come. Each one is checked again against
/// the content and the scheduling account's grant as they are now, so an edit, a removal or a
/// withdrawn approval after scheduling holds it back, privately, until it is approved again.
fn fire_due_shared_publications(state: &AppState) {
    use openblog_core::assembly::Outcome;
    let now = clock::now().unix();
    for id in crate::shared_publications::outcome_ids(&state.root) {
        let due = match crate::shared_publications::load_outcome(&state.root, &id) {
            Ok(stored) => matches!(
                stored.outcome,
                Some(Outcome::Scheduled { publish_at, .. }) if publish_at <= now
            ),
            Err(_) => false,
        };
        if !due {
            continue;
        }
        let Ok(mut transaction) = invitation_transaction(state, &id) else {
            continue;
        };
        let Some(record) = transaction.record.clone() else {
            continue;
        };
        let Ok(stored) = crate::shared_publications::load_outcome(&state.root, &id) else {
            continue;
        };
        let Some(Outcome::Scheduled {
            publish_at,
            requested_by,
            ..
        }) = stored.outcome
        else {
            continue;
        };
        if publish_at > now
            || authorize_publisher(&transaction, &record, &requested_by, true).is_err()
        {
            continue;
        }
        let _ = commit_publication(
            state,
            &mut transaction,
            &record,
            DateTime::from_unix(publish_at),
        );
    }
}

/// An author approves the exact piece they read. The approval is theirs alone: it needs their
/// own draft grant and their own approve grant, an affirmation, and the token from the preview;
/// a token the piece has moved past is refused and nothing is recorded.
fn approve_piece(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    match serde_json::from_slice::<ApproveRequest>(&req.body) {
        Ok(body) => change_approval(
            state,
            session,
            &body.publication_id,
            Some((&body.seen, body.affirmed)),
        ),
        Err(_) => publish_request_problem(),
    }
}

fn withdraw_approval(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    match serde_json::from_slice::<PublicationRequest>(&req.body) {
        Ok(body) => change_approval(state, session, &body.publication_id, None),
        Err(_) => publish_request_problem(),
    }
}

fn change_approval(
    state: &AppState,
    session: &auth::Session,
    publication_id: &str,
    approving: Option<(&str, bool)>,
) -> Response {
    use openblog_core::approval::ApprovalError;
    let (transaction, own) = match draft_request_target(state, publication_id, session) {
        Ok(found) => found,
        Err(_) => return publish_not_found(),
    };
    let record = transaction.record.clone().expect("authorized record");
    let allowed = transaction
        .with_identities(|identities| {
            record.authorize(
                &session.user,
                identities,
                AuthorizationAction::ApproveContribution,
                AuthorizationTarget::Participant(&own),
            )
        })
        .is_ok();
    if !allowed {
        return publish_not_found();
    }
    let inputs = match gate_inputs(state, &transaction, &record) {
        Ok(inputs) => inputs,
        Err(response) => return response,
    };
    if matches!(
        inputs.outcome.outcome,
        Some(openblog_core::assembly::Outcome::Published { .. })
    ) {
        return published_already();
    }
    let active = inputs.active.iter().map(String::as_str).collect::<Vec<_>>();
    let mut next = inputs.approvals.set.clone();
    let result = match approving {
        Some((seen, affirmed)) => openblog_core::assembly::with_subject(
            &record,
            inputs.structure.structure.as_ref(),
            &inputs.drafts,
            &inputs.synthesis,
            &active,
            |subject| {
                next.approve(&own, &own, subject, seen, affirmed, clock::now().unix())
                    .map(|()| true)
            },
        ),
        None => next.withdraw(&own, &own),
    };
    match result {
        Ok(true) => {}
        Ok(false) => return Response::json(200, &json!({ "withdrawn": false })),
        Err(ApprovalError::Stale) => {
            return Response::error(
                409,
                "The piece changed after you read it. Reload the combined preview and read it again; nothing was recorded.",
            )
        }
        Err(ApprovalError::Invalid) => {
            return shared_problem(
                "affirmed",
                "Confirm that you approve publishing exactly the piece you read, and reload the preview if the piece has no sections yet.",
            )
        }
        Err(ApprovalError::Denied) => return publish_not_found(),
    }
    if let Err(error) = crate::shared_publications::replace_approvals(
        &state.root,
        publication_id,
        &inputs.approvals,
        &next,
    ) {
        return publish_store_problem(error);
    }
    eprintln!(
        "admin: {} for shared publication {publication_id}",
        if approving.is_some() {
            "approval recorded"
        } else {
            "approval withdrawn"
        }
    );
    Response::json(
        200,
        &if approving.is_some() {
            json!({ "approved": true })
        } else {
            json!({ "withdrawn": true })
        },
    )
}

// ---------------------------------------------------------------------------
// Shared synthesis: the continuing conversation (ADR 0025)
// ---------------------------------------------------------------------------

/// Every refusal reads the same, so a request cannot confirm that a reflection, an item or an
/// author exists.
fn synthesis_not_found() -> Response {
    Response::error(
        404,
        "That shared reflection was not found, or you cannot work on its continuing conversation.",
    )
}

/// The requester's own participant id once `SharedPublication::authorize` allows `EditSynthesis`.
fn synthesis_owner(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
) -> Option<String> {
    let own = record
        .authorization
        .bindings
        .iter()
        .find(|binding| binding.admin_user == session.user)?
        .participant_id
        .clone();
    transaction
        .with_identities(|identities| {
            record
                .authorize(
                    &session.user,
                    identities,
                    AuthorizationAction::EditSynthesis,
                    AuthorizationTarget::Participant(&own),
                )
                .map(|binding| binding.participant_id.clone())
        })
        .ok()
}

/// Participants who may author or be named on synthesis items now, decided per binding by the
/// single entry point.
fn synthesis_authors(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
) -> Vec<String> {
    record
        .authorization
        .bindings
        .iter()
        .filter(|binding| {
            transaction
                .with_identities(|identities| {
                    record.authorize(
                        &binding.admin_user,
                        identities,
                        AuthorizationAction::EditSynthesis,
                        AuthorizationTarget::Participant(&binding.participant_id),
                    )
                })
                .is_ok()
        })
        .map(|binding| binding.participant_id.clone())
        .collect()
}

fn participant_name(record: &SharedPublication, id: &str) -> String {
    record
        .collaboration
        .participants
        .iter()
        .find(|participant| participant.id == id)
        .map(|participant| participant.display_name.clone())
        .unwrap_or_default()
}

/// The synthesis as one author sees it. Items carry prose, so this is built only after the
/// requester was authorized and `SynthesisSet::view` accepted them as an author.
fn synthesis_json(
    set: &openblog_core::synthesis::SynthesisSet,
    record: &SharedPublication,
    own: &str,
    authors: &[&str],
) -> Option<Json> {
    let items = set.view(own, authors).ok()?;
    let who = |id: &str| json!({ "id": id, "displayName": participant_name(record, id) });
    let items: Vec<Json> = items
        .iter()
        .map(|item| {
            json!({
                "id": item.id(),
                "kind": item.kind(),
                "markdown": item.markdown(),
                "revision": item.revision(),
                "contributors": item.contributors().iter().map(|id| who(id)).collect::<Vec<_>>(),
                "approved": item.approved_by().into_iter().map(who).collect::<Vec<_>>(),
                "awaiting": item.awaiting().into_iter().map(who).collect::<Vec<_>>(),
                "mine": item.contributors().iter().any(|id| id == own),
                "approvedByYou": item.approved_by().contains(&own),
            })
        })
        .collect();
    Some(json!({
        "revision": set.revision(),
        "items": items,
        "authors": authors.iter().map(|id| who(id)).collect::<Vec<_>>(),
        "you": own,
    }))
}

fn read_synthesis(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return synthesis_not_found();
    };
    let Ok(transaction) = invitation_transaction(state, publication_id) else {
        return synthesis_not_found();
    };
    let Some(record) = &transaction.record else {
        return synthesis_not_found();
    };
    let Some(own) = synthesis_owner(&transaction, record, session) else {
        return synthesis_not_found();
    };
    let stored = match crate::shared_publications::load_synthesis(&state.root, publication_id) {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!("admin: synthesis not readable for {publication_id}: {error}");
            return Response::error(500, "The continuing conversation could not be read.");
        }
    };
    let authors = synthesis_authors(&transaction, record);
    let authors = authors.iter().map(String::as_str).collect::<Vec<_>>();
    match synthesis_json(&stored.set, record, &own, &authors) {
        Some(json) => Response::json(200, &json),
        None => synthesis_not_found(),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SynthesisRequest {
    publication_id: String,
    /// The set revision the caller read; any other revision is refused as a conflict.
    expected_revision: u64,
    change: SynthesisChange,
}

#[derive(serde::Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum SynthesisChange {
    Add {
        kind: openblog_core::synthesis::SynthesisKind,
        markdown: String,
        #[serde(default)]
        others: Vec<String>,
    },
    Edit {
        id: String,
        #[serde(default)]
        kind: Option<openblog_core::synthesis::SynthesisKind>,
        #[serde(default)]
        markdown: Option<String>,
        #[serde(default, rename = "addContributors")]
        add_contributors: Vec<String>,
    },
    Withdraw {
        id: String,
    },
    Approve {
        id: String,
    },
    Reorder {
        order: Vec<String>,
    },
}

/// One change to the synthesis, by an authorized author, against the revision they read. A
/// refused or failed change stores nothing, and a stored one also reconciles the piece's
/// approvals in the same transaction.
fn change_synthesis(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    use openblog_core::synthesis::{NewSynthesisItem, SynthesisEdit, SynthesisError};
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<SynthesisRequest>(&req.body) else {
        return shared_problem(
            "",
            "This request is not valid. Reload Admin Studio and try again.",
        );
    };
    let Ok(transaction) = invitation_transaction(state, &body.publication_id) else {
        return synthesis_not_found();
    };
    let Some(record) = &transaction.record else {
        return synthesis_not_found();
    };
    let Some(own) = synthesis_owner(&transaction, record, session) else {
        return synthesis_not_found();
    };
    let stored = match crate::shared_publications::load_synthesis(&state.root, &body.publication_id)
    {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!(
                "admin: synthesis not readable for {}: {error}",
                body.publication_id
            );
            return Response::error(500, "The continuing conversation could not be changed.");
        }
    };
    match crate::shared_publications::load_outcome(&state.root, &body.publication_id) {
        Ok(stored_outcome)
            if matches!(
                stored_outcome.outcome,
                Some(openblog_core::assembly::Outcome::Published { .. })
            ) =>
        {
            return published_already()
        }
        Ok(_) => {}
        Err(error) => return publish_failed(&error),
    }
    let authors = synthesis_authors(&transaction, record);
    let authors = authors.iter().map(String::as_str).collect::<Vec<_>>();
    let expected = body.expected_revision;
    let mut next = stored.set.clone();
    let result = match &body.change {
        SynthesisChange::Add {
            kind,
            markdown,
            others,
        } => {
            let others = others.iter().map(String::as_str).collect::<Vec<_>>();
            next.add(
                &own,
                &authors,
                expected,
                NewSynthesisItem {
                    kind: *kind,
                    markdown,
                    others: &others,
                },
            )
            .map(|_| ())
        }
        SynthesisChange::Edit {
            id,
            kind,
            markdown,
            add_contributors,
        } => {
            let added = add_contributors
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            next.edit(
                &own,
                &authors,
                expected,
                id,
                SynthesisEdit {
                    kind: *kind,
                    markdown: markdown.as_deref(),
                    add_contributors: &added,
                },
            )
        }
        SynthesisChange::Withdraw { id } => next.withdraw(&own, &authors, expected, id),
        SynthesisChange::Approve { id } => next.approve_item(&own, &authors, expected, id),
        SynthesisChange::Reorder { order } => {
            let order = order.iter().map(String::as_str).collect::<Vec<_>>();
            next.reorder(&own, &authors, expected, &order)
        }
    };
    match result {
        Ok(()) => {}
        Err(SynthesisError::Denied) => return synthesis_not_found(),
        Err(SynthesisError::Stale) => {
            return Response::error(
                409,
                "The continuing conversation changed since you read it. Reload to see the current items; nothing was changed.",
            )
        }
        Err(SynthesisError::Rule(rule)) => {
            return shared_problem(
                "markdown",
                &format!("That item contains {}. Nothing was changed.", rule.describe()),
            )
        }
        Err(SynthesisError::Invalid) => {
            return shared_problem(
                "markdown",
                "That item is empty, too large, contains characters that cannot be saved, or names someone who is not an author.",
            )
        }
    }
    if next != stored.set {
        match crate::shared_publications::replace_synthesis(
            &state.root,
            &body.publication_id,
            &stored,
            &next,
        ) {
            Ok(()) => {}
            Err(crate::shared_publications::ReplaceError::Conflict) => {
                return Response::error(
                    409,
                    "The continuing conversation changed while you were saving. Reload to see the current items; nothing was changed.",
                )
            }
            Err(crate::shared_publications::ReplaceError::TooLarge) => {
                return shared_problem(
                    "markdown",
                    "The continuing conversation has reached its size limit, so this change was not saved.",
                )
            }
            Err(crate::shared_publications::ReplaceError::Storage(error)) => {
                eprintln!("admin: synthesis not stored: {error}");
                return Response::error(
                    500,
                    "The continuing conversation could not be changed. Nothing was changed.",
                );
            }
        }
        reconcile_approvals(state, &transaction, record);
        eprintln!(
            "admin: continuing conversation changed in shared publication {}",
            body.publication_id
        );
    }
    match synthesis_json(&next, record, &own, &authors) {
        Some(json) => Response::json(200, &json),
        None => synthesis_not_found(),
    }
}

/// Drop approvals that no longer match after a change to the author set or the prose, in the
/// same transaction as that change, so removing and restoring an author or reverting an edit
/// cannot bring back consent given earlier. Validity is also recomputed on every read, so a
/// failure here still fails closed; it is logged without any content.
fn reconcile_approvals(
    state: &AppState,
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
) {
    let id = &record.publication_id;
    let result = (|| -> Result<(), String> {
        let stored = crate::shared_publications::load_approvals_for_update(&state.root, id)?;
        let drafts = load_reveal_drafts(state, id).map_err(|_| "drafts are not usable")?;
        let drafts =
            draft_set_for(drafts.set.as_ref(), record).map_err(|_| "drafts are not usable")?;
        // The synthesis follows the author set in the same write (ADR 0025): attribution to
        // someone who can no longer author it goes, and so does an item nobody speaks for.
        let mut synthesis = crate::shared_publications::load_synthesis(&state.root, id)?;
        let authors = synthesis_authors(transaction, record);
        let authors = authors.iter().map(String::as_str).collect::<Vec<_>>();
        let mut reconciled = synthesis.set.clone();
        if reconciled.reconcile(&authors) {
            crate::shared_publications::replace_synthesis(&state.root, id, &synthesis, &reconciled)
                .map_err(|_| "synthesis not stored".to_string())?;
            synthesis.set = reconciled;
        }
        let active = active_drafters(transaction, record);
        let active = active.iter().map(String::as_str).collect::<Vec<_>>();
        let structure = crate::shared_publications::load_structure(&state.root, id)?;
        let mut next = stored.set.clone();
        let dropped = openblog_core::assembly::with_subject(
            record,
            structure.structure.as_ref(),
            &drafts,
            &synthesis.set,
            &active,
            |subject| next.reconcile(subject),
        );
        if matches!(dropped, Ok(count) if count > 0) {
            crate::shared_publications::replace_approvals(&state.root, id, &stored, &next)
                .map_err(|_| "approvals not stored".to_string())?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("admin: approvals not reconciled for {id}: {error}");
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RevealPolicyRequest {
    publication_id: String,
    policy: RevealPolicy,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RevealReadyRequest {
    publication_id: String,
    /// The exact revision of the caller's own draft to offer, or null to take the offer back.
    revision: Option<u64>,
}

/// Participants who currently hold the draft grant, decided by the single entry point for each
/// binding. A removed or downgraded member is absent, so they neither block nor join a reveal.
fn active_drafters(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
) -> Vec<String> {
    record
        .authorization
        .bindings
        .iter()
        .filter(|binding| {
            transaction
                .with_identities(|identities| {
                    record.authorize(
                        &binding.admin_user,
                        identities,
                        AuthorizationAction::EditDraft,
                        AuthorizationTarget::Participant(&binding.participant_id),
                    )
                })
                .is_ok()
        })
        .map(|binding| binding.participant_id.clone())
        .collect()
}

fn store_drafts(
    state: &AppState,
    publication_id: &str,
    stored: &crate::shared_publications::StoredDrafts,
    set: &DraftSet,
    success: Json,
) -> Response {
    match crate::shared_publications::replace_drafts(&state.root, publication_id, stored, set) {
        Ok(()) => Response::json(200, &success),
        Err(crate::shared_publications::ReplaceError::Conflict) => Response::error(
            409,
            "Sharing changed while you were saving. Reload to see the current state; nothing was changed.",
        ),
        Err(crate::shared_publications::ReplaceError::TooLarge) => draft_limit_problem(),
        Err(crate::shared_publications::ReplaceError::Storage(error)) => {
            eprintln!("admin: reveal state not stored: {error}");
            Response::error(500, "Sharing could not be changed. Nothing was changed.")
        }
    }
}

fn load_reveal_drafts(
    state: &AppState,
    publication_id: &str,
) -> Result<crate::shared_publications::StoredDrafts, Response> {
    crate::shared_publications::load_drafts(&state.root, publication_id).map_err(|error| {
        eprintln!("admin: drafts not readable for {publication_id}: {error}");
        Response::error(500, "Sharing could not be read. Nothing was changed.")
    })
}

/// Whether the signed-in user may choose the reveal policy, decided by the single entry point.
fn may_set_policy(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
) -> bool {
    transaction
        .with_identities(|identities| {
            record.authorize(
                &session.user,
                identities,
                AuthorizationAction::SetRevealPolicy,
                AuthorizationTarget::Publication,
            )
        })
        .is_ok()
}

/// The comparison for the signed-in participant: one slot per contract participant, in contract
/// order, each their own latest revision, a revision revealed to them, or a placeholder. A
/// coordinator who is not a drafter gets the policy only.
fn read_reveal_state(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return draft_not_found();
    };
    let Ok(transaction) = invitation_transaction(state, publication_id) else {
        return draft_not_found();
    };
    let Some(record) = &transaction.record else {
        return draft_not_found();
    };
    let own = draft_owner(&transaction, record, session);
    let coordinator = may_set_policy(&transaction, record, session);
    if own.is_none() && !coordinator {
        return draft_not_found();
    }
    let stored = match load_reveal_drafts(state, publication_id) {
        Ok(stored) => stored,
        Err(response) => return response,
    };
    let Ok(set) = draft_set_for(stored.set.as_ref(), record) else {
        return Response::error(500, "Sharing could not be read. Nothing was changed.");
    };
    let mut slots = Vec::new();
    let mut ready = false;
    if let Some(own) = &own {
        ready = set.is_ready(own);
        let participants = &record.collaboration.participants;
        let order = participants
            .iter()
            .map(|p| p.id.as_str())
            .collect::<Vec<_>>();
        let active = active_drafters(&transaction, record);
        let active = active.iter().map(String::as_str).collect::<Vec<_>>();
        let Ok(compared) = set.compare(own, &order, &active) else {
            return draft_not_found();
        };
        for (participant, slot) in participants.iter().zip(compared) {
            let (kind, view, offered) = match &slot {
                ComparisonSlot::Own(view) => ("own", Some(view), false),
                ComparisonSlot::Revealed(view) => ("revealed", Some(view), false),
                ComparisonSlot::Private { ready } => ("private", None, *ready),
            };
            slots.push(json!({
                "participantId": participant.id,
                "displayName": participant.display_name,
                "kind": kind,
                "ready": offered,
                "stamp": view.map(|v| &v.stamp),
                "markdown": view.map(|v| &v.markdown),
            }));
        }
    }
    Response::json(
        200,
        &json!({ "policy": set.policy(), "ready": ready, "slots": slots, "canSetPolicy": coordinator }),
    )
}

/// The combined review preview for an active author: every author's section at its exact current
/// revision where the signed-in author is entitled to it, with each author's approval state.
/// Read-only: it writes no draft, approval or content, and every refusal is the same not-found as
/// a missing publication, so it never says whether a publication or a draft exists.
fn read_combined_preview(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return draft_not_found();
    };
    let (transaction, own) = match draft_request_target(state, publication_id, session) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let record = transaction.record.as_ref().expect("authorized record");
    let stored = match load_reveal_drafts(state, publication_id) {
        Ok(stored) => stored,
        Err(response) => return response,
    };
    let Ok(set) = draft_set_for(stored.set.as_ref(), record) else {
        return Response::error(500, "The preview could not be built. Nothing was changed.");
    };
    let approvals = match crate::shared_publications::load_approvals(&state.root, publication_id) {
        Ok(approvals) => approvals,
        Err(error) => {
            eprintln!("admin: approvals not readable for {publication_id}: {error}");
            return Response::error(500, "The preview could not be built. Nothing was changed.");
        }
    };
    let synthesis = match crate::shared_publications::load_synthesis(&state.root, publication_id) {
        Ok(stored) => stored.set,
        Err(error) => {
            eprintln!("admin: synthesis not readable for {publication_id}: {error}");
            return Response::error(500, "The preview could not be built. Nothing was changed.");
        }
    };
    let active = active_drafters(&transaction, record);
    let active = active.iter().map(String::as_str).collect::<Vec<_>>();
    let show_synthesis = synthesis_owner(&transaction, record, session).is_some();
    let config = site::load_config(&state.root).unwrap_or_default();
    let structure = match crate::shared_publications::load_structure(&state.root, publication_id) {
        Ok(structure) => structure,
        Err(error) => {
            eprintln!("admin: arrangement not readable for {publication_id}: {error}");
            return Response::error(500, "The preview could not be built. Nothing was changed.");
        }
    };
    let Ok(preview) = openblog_core::preview::build(
        record,
        structure.structure.as_ref(),
        &set,
        &synthesis,
        &approvals,
        &own,
        &active,
        show_synthesis,
        config.render_options(),
    ) else {
        return draft_not_found();
    };
    drop(transaction);
    // The document is served from its own address with its own policy, so a sandboxed frame can
    // show it without the Admin page's policy and without scripts, forms, images or fetches.
    let token = match auth::random_token() {
        Ok(token) => token,
        Err(error) => {
            eprintln!("admin: preview token unavailable: {error}");
            return Response::error(500, "The preview could not be built. Nothing was changed.");
        }
    };
    let mut summary = serde_json::to_value(&preview).unwrap_or(Json::Null);
    if let Some(object) = summary.as_object_mut() {
        object.remove("document");
        object.insert(
            "previewUrl".into(),
            json!(format!("/admin/api/preview/{token}")),
        );
    }
    let mut previews = lock(&state.previews);
    previews.push(PreviewDocument {
        token,
        html: preview.document,
        csp: openblog_core::preview::PREVIEW_CSP.to_string(),
    });
    if previews.len() > 16 {
        previews.remove(0);
    }
    Response::json(200, &json!({ "preview": summary }))
}

/// A coordinator chooses how drafts may be revealed. Changing it clears every standing offer and
/// reveals nothing.
fn set_reveal_policy(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<RevealPolicyRequest>(&req.body) else {
        return shared_problem(
            "",
            "This sharing request is not valid. Reload Admin Studio and try again.",
        );
    };
    let Ok(transaction) = invitation_transaction(state, &body.publication_id) else {
        return draft_not_found();
    };
    let Some(record) = &transaction.record else {
        return draft_not_found();
    };
    if !may_set_policy(&transaction, record, session) {
        return draft_not_found();
    }
    let stored = match load_reveal_drafts(state, &body.publication_id) {
        Ok(stored) => stored,
        Err(response) => return response,
    };
    let Ok(mut set) = draft_set_for(stored.set.as_ref(), record) else {
        return Response::error(500, "Sharing could not be changed. Nothing was changed.");
    };
    set.set_policy(body.policy);
    eprintln!(
        "admin: changed the reveal policy of shared publication {}",
        body.publication_id
    );
    store_drafts(
        state,
        &body.publication_id,
        &stored,
        &set,
        json!({ "policy": set.policy() }),
    )
}

// ---------------------------------------------------------------------------
// Layout and arrangement of a shared reflection (ADR 0031)
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ArrangementRequest {
    publication_id: String,
    /// The revision of the arrangement the caller read: 0 when none was stored.
    expected_revision: u64,
    structure: Json,
}

/// The layouts the Admin offers, with plain labels.
fn arrangement_layouts() -> Json {
    json!([
        { "value": "sequential", "label": "Sequential", "help": "One section after another, in reading order." },
        { "value": "sideBySide", "label": "Side by side", "help": "Sections sit in columns on wide screens and read one after another on narrow ones." },
        { "value": "pointCounterpoint", "label": "Point and counterpoint", "help": "Two columns on wide screens when exactly two people take part; with three or more it reads as one column. Optional labels are yours; nothing is implied about who agrees." },
        { "value": "alternatingDialogue", "label": "Alternating dialogue", "help": "Turns alternate like a conversation on wide screens, switching side when the speaker changes, each under its author's name." },
        { "value": "roundtable", "label": "Roundtable", "help": "Turns sit in a grid that fits any number of participants and reads in the same order." },
    ])
}

/// Whether the signed-in user may arrange the reflection, decided by the single entry point.
fn may_arrange(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
) -> bool {
    transaction
        .with_identities(|identities| {
            record.authorize(
                &session.user,
                identities,
                AuthorizationAction::ArrangeReflection,
                AuthorizationTarget::Publication,
            )
        })
        .is_ok()
}

/// The stored arrangement, who is in the piece, and whether the caller may change it. It holds no
/// prose, no part counts and no draft state, so any member may read it; everyone else gets the
/// same not-found as a missing publication.
fn read_arrangement(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return draft_not_found();
    };
    let Ok(transaction) = invitation_transaction(state, publication_id) else {
        return draft_not_found();
    };
    let Some(record) = &transaction.record else {
        return draft_not_found();
    };
    let member = transaction
        .with_identities(|identities| {
            record.authorize(
                &session.user,
                identities,
                AuthorizationAction::ViewPublication,
                AuthorizationTarget::Publication,
            )
        })
        .is_ok();
    if !member {
        return draft_not_found();
    }
    let stored = match crate::shared_publications::load_structure(&state.root, publication_id) {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!("admin: arrangement not readable for {publication_id}: {error}");
            return Response::error(
                500,
                "The arrangement could not be read. Nothing was changed.",
            );
        }
    };
    let participants: Vec<Json> = record
        .collaboration
        .participants
        .iter()
        .map(|p| json!({ "id": p.id, "displayName": p.display_name }))
        .collect();
    Response::json(
        200,
        &json!({
            "structure": stored.structure,
            "participants": participants,
            "layouts": arrangement_layouts(),
            "canArrange": may_arrange(&transaction, record, session),
        }),
    )
}

/// A coordinator stores the layout and arrangement. The write names the revision it was built on
/// and is refused if another write got there first. It does not read a draft, so it cannot tell
/// the coordinator whether a part exists; a stale reference is caught by the combined preview and
/// the publish gate. Standing approvals that no longer match are dropped in the same request.
fn save_arrangement(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    use openblog_core::reflection::{ReflectionError, ReflectionStructure};
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<ArrangementRequest>(&req.body) else {
        return shared_problem(
            "",
            "This arrangement request is not valid. Reload Admin Studio and try again.",
        );
    };
    let Ok(transaction) = invitation_transaction(state, &body.publication_id) else {
        return draft_not_found();
    };
    let Some(record) = transaction.record.clone() else {
        return draft_not_found();
    };
    if !may_arrange(&transaction, &record, session) {
        return draft_not_found();
    }
    if matches!(
        crate::shared_publications::load_outcome(&state.root, &body.publication_id)
            .map(|stored| stored.outcome),
        Ok(Some(openblog_core::assembly::Outcome::Published { .. }))
    ) {
        return published_already();
    }
    let stored = match crate::shared_publications::load_structure(&state.root, &body.publication_id)
    {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!(
                "admin: arrangement not readable for {}: {error}",
                body.publication_id
            );
            return Response::error(
                500,
                "The arrangement could not be saved. Nothing was changed.",
            );
        }
    };
    let current = stored.structure.as_ref().map_or(0, |s| s.revision);
    if current != body.expected_revision {
        return Response::error(
            409,
            "The arrangement changed while you were editing it. Reload to see the current one; nothing was changed.",
        );
    }
    let invalid = || {
        shared_problem(
            "structure",
            "That arrangement is not valid. Use one or more rounds, each with turns that name a participant and a part, and keep round prompts short and on one line.",
        )
    };
    let Ok(source) = serde_json::to_string(&body.structure) else {
        return invalid();
    };
    let next = match &stored.structure {
        Some(existing) => existing.replace_from_json(&source, body.expected_revision),
        None => ReflectionStructure::from_json(&source).and_then(|next| {
            if next.revision == 1 {
                Ok(next)
            } else {
                Err(ReflectionError::Invalid)
            }
        }),
    };
    let Ok(next) = next else {
        return invalid();
    };
    let known = |id: &str| {
        record
            .collaboration
            .participants
            .iter()
            .any(|p| p.id.eq_ignore_ascii_case(id))
    };
    if !next
        .rounds
        .iter()
        .flat_map(|r| &r.turns)
        .all(|t| known(&t.draft))
    {
        return invalid();
    }
    match crate::shared_publications::replace_structure(
        &state.root,
        &body.publication_id,
        &stored,
        &next,
    ) {
        Ok(()) => {}
        Err(crate::shared_publications::ReplaceError::Conflict) => {
            return Response::error(
                409,
                "The arrangement changed while you were saving. Reload to see the current one; nothing was changed.",
            )
        }
        Err(crate::shared_publications::ReplaceError::TooLarge) => return invalid(),
        Err(crate::shared_publications::ReplaceError::Storage(error)) => {
            eprintln!("admin: arrangement not stored: {error}");
            return Response::error(500, "The arrangement could not be saved. Nothing was changed.");
        }
    }
    reconcile_approvals(state, &transaction, &record);
    eprintln!(
        "admin: arranged shared publication {} at revision {}",
        body.publication_id, next.revision
    );
    Response::json(200, &json!({ "structure": next }))
}

/// A drafter offers one exact revision of their own draft, or takes the offer back. When the
/// policy condition is met the same write commits the reveal for everyone involved.
fn set_reveal_ready(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<RevealReadyRequest>(&req.body) else {
        return shared_problem(
            "",
            "This sharing request is not valid. Reload Admin Studio and try again.",
        );
    };
    let (transaction, own) = match draft_request_target(state, &body.publication_id, session) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let record = transaction.record.as_ref().expect("authorized record");
    let stored = match load_reveal_drafts(state, &body.publication_id) {
        Ok(stored) => stored,
        Err(response) => return response,
    };
    let Ok(mut set) = draft_set_for(stored.set.as_ref(), record) else {
        return Response::error(500, "Sharing could not be changed. Nothing was changed.");
    };
    let active = active_drafters(&transaction, record);
    let active = active.iter().map(String::as_str).collect::<Vec<_>>();
    let outcome = match body.revision {
        Some(revision) => set.mark_ready(&own, revision, &active),
        None => set
            .unready(&own)
            .map(|()| ReadyOutcome::Waiting { waiting_for: 0 }),
    };
    let success = match outcome {
        Ok(ReadyOutcome::Revealed) => json!({ "ready": false, "revealed": true }),
        Ok(ReadyOutcome::Waiting { waiting_for }) => json!({
            "ready": body.revision.is_some(),
            "revealed": false,
            "waitingFor": if body.revision.is_some() { json!(waiting_for) } else { Json::Null },
        }),
        Err(DraftError::Invalid) => {
            return shared_problem(
                "revision",
                "Sharing is off for this reflection. Ask a coordinator to turn it on first.",
            )
        }
        Err(DraftError::LimitReached) => return draft_limit_problem(),
        Err(_) => return draft_not_found(),
    };
    eprintln!(
        "admin: reveal readiness changed in shared publication {}",
        body.publication_id
    );
    store_drafts(state, &body.publication_id, &stored, &set, success)
}

// ---------------------------------------------------------------------------
// Series placement (ADR 0038, ADR 0039)
// ---------------------------------------------------------------------------

/// Every refusal to read or arrange a publication's series, whatever the reason.
fn series_not_found() -> Response {
    Response::error(
        404,
        "That shared reflection was not found, or you cannot see or arrange its series.",
    )
}

fn series_problem(field: &str, error: openblog_core::shared_series::SeriesError) -> Response {
    use openblog_core::shared_series::SeriesError;
    match error {
        SeriesError::Reference => shared_problem(
            field,
            "Use a series title with visible text, up to 120 bytes, on one line.",
        ),
        SeriesError::NoAddress => {
            shared_problem(field, "A series title needs at least one letter or digit.")
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PlacementBody {
    series: String,
    #[serde(default)]
    order: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PlacementRequest {
    publication_id: String,
    expected_revision: u64,
    placement: Option<PlacementBody>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SeriesCreateRequest {
    publication_id: String,
    title: String,
    #[serde(default)]
    premise: String,
}

fn may(
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
    action: AuthorizationAction,
) -> bool {
    transaction
        .with_identities(|identities| {
            record.authorize(
                &session.user,
                identities,
                action,
                AuthorizationTarget::Publication,
            )
        })
        .is_ok()
}

fn is_published(state: &AppState, publication_id: &str) -> Result<bool, Response> {
    crate::shared_publications::load_outcome(&state.root, publication_id)
        .map(|stored| {
            matches!(
                stored.outcome,
                Some(openblog_core::assembly::Outcome::Published { .. })
            )
        })
        .map_err(|error| publish_failed(&error))
}

/// What a participant sees about the placement: the stored choice, the public series to choose
/// from, and the reading order a placement would produce. Everything except the placement is
/// read from the public site (no drafts, nothing scheduled), so no other publication's unsaved
/// collaboration state can appear in it.
fn series_view(
    state: &AppState,
    transaction: &InvitationTransaction<'_>,
    record: &SharedPublication,
    session: &auth::Session,
    preview_of: Option<&openblog_core::shared_series::SeriesPlacement>,
) -> Response {
    let published = match is_published(state, &record.publication_id) {
        Ok(published) => published,
        Err(response) => return response,
    };
    let site = match site::load_site(&state.root, false, Some(clock::now())) {
        Ok((site, _)) => site,
        Err(error) => {
            eprintln!("admin: series list unavailable: {error}");
            return Response::error(
                500,
                "The site's series could not be read. Nothing was changed.",
            );
        }
    };
    let preview = preview_of
        .or(record.series.as_ref())
        .map(|placement| openblog_core::shared_series::order_preview(&site, placement, !published));
    Response::json(
        200,
        &json!({
            "revision": record.series_revision,
            "placement": record.series,
            "canPlace": !published && may(transaction, record, session, AuthorizationAction::PlaceInSeries),
            "canCreate": may(transaction, record, session, AuthorizationAction::CreateSeries),
            "published": published,
            "series": openblog_core::shared_series::series_choices(&site),
            "preview": preview,
        }),
    )
}

/// Any participant reads the placement. `series` and `order` in the query preview another
/// choice without storing it.
fn read_series(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    let Some(publication_id) = req.query.get("publicationId") else {
        return series_not_found();
    };
    let Ok(transaction) = invitation_transaction(state, publication_id) else {
        return series_not_found();
    };
    let Some(record) = &transaction.record else {
        return series_not_found();
    };
    if !may(
        &transaction,
        record,
        session,
        AuthorizationAction::ViewPublication,
    ) {
        return series_not_found();
    }
    let candidate = match req.query.get("series") {
        None => None,
        Some(series) => {
            let order =
                match req.query.get("order").map(String::as_str) {
                    None | Some("") => None,
                    Some(order) => match order.parse::<u32>() {
                        Ok(order) => Some(order),
                        Err(_) => return shared_problem(
                            "order",
                            "Use a whole number of 0 or more for the position, or leave it empty.",
                        ),
                    },
                };
            match openblog_core::shared_series::SeriesPlacement::new(series, order) {
                Ok(placement) => Some(placement),
                Err(error) => return series_problem("series", error),
            }
        }
    };
    series_view(state, &transaction, record, session, candidate.as_ref())
}

/// A site owner or coordinator sets, changes or removes the placement against the revision they
/// read. The placement is public output bound into every approval, so approvals are reconciled
/// in the same write (ADR 0038). A refused change stores nothing.
fn set_series(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    use openblog_core::shared_series::{PlacementError, SeriesPlacement};
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<PlacementRequest>(&req.body) else {
        return shared_problem(
            "",
            "This series request is not valid. Use a whole number of 0 or more for the position, then try again.",
        );
    };
    let Ok(transaction) = invitation_transaction(state, &body.publication_id) else {
        return series_not_found();
    };
    let Some(record) = &transaction.record else {
        return series_not_found();
    };
    if !may(
        &transaction,
        record,
        session,
        AuthorizationAction::PlaceInSeries,
    ) {
        return series_not_found();
    }
    match is_published(state, &body.publication_id) {
        Ok(true) => return published_already(),
        Ok(false) => {}
        Err(response) => return response,
    }
    let placement = match body.placement {
        None => None,
        Some(placement) => match SeriesPlacement::new(&placement.series, placement.order) {
            Ok(placement) => Some(placement),
            Err(error) => return series_problem("series", error),
        },
    };
    let result = transaction.with_identities(|identities| {
        record.place_in_series(&session.user, identities, placement, body.expected_revision)
    });
    let next = match result {
        Ok(next) => next,
        Err(PlacementError::Denied) => return series_not_found(),
        Err(PlacementError::Stale) => {
            return Response::error(
                409,
                "The series placement changed while you were working. Reload to see the current choice; nothing was changed.",
            )
        }
        Err(PlacementError::Invalid(error)) => return series_problem("series", error),
    };
    if next != *record {
        if let Err(response) = transaction.store(&state.root, &next) {
            return response;
        }
        reconcile_approvals(state, &transaction, &next);
        eprintln!(
            "admin: series placement changed in shared publication {}",
            body.publication_id
        );
    }
    series_view(state, &transaction, &next, session, None)
}

/// A site owner adds a new series definition: its name and recurring premise. It is ordinary
/// site content, validated and built like a save from the Series editor, and it places nothing.
fn create_series(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    use openblog_core::shared_series::{series_definition, DefinitionError};
    if let Err(response) = require_json(req) {
        return response;
    }
    let Ok(body) = serde_json::from_slice::<SeriesCreateRequest>(&req.body) else {
        return shared_problem(
            "",
            "This series request is not valid. Reload Admin Studio and try again.",
        );
    };
    let mut status = lock(&state.build);
    let _filesystem_transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let Ok(config) = site::load_config(&state.root) else {
        return series_not_found();
    };
    let Ok((admin_users, contributor_ids)) = collaboration_identities(&state.root, &config) else {
        return series_not_found();
    };
    let Ok(Some(record)) = crate::shared_publications::load(&state.root, &body.publication_id)
    else {
        return series_not_found();
    };
    let admin_users = admin_users.iter().map(String::as_str).collect::<Vec<_>>();
    let contributor_ids = contributor_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let identities = Identities {
        active_admin_users: &admin_users,
        contributor_ids: &contributor_ids,
    };
    if record
        .authorize(
            &session.user,
            &identities,
            AuthorizationAction::CreateSeries,
            AuthorizationTarget::Publication,
        )
        .is_err()
    {
        return series_not_found();
    }
    let definition = match series_definition(&body.title, &body.premise) {
        Ok(definition) => definition,
        Err(DefinitionError::Title(error)) => return series_problem("title", error),
        Err(DefinitionError::Premise) => {
            return shared_problem(
                "premise",
                "Keep the premise to one line of up to 500 bytes, without control characters.",
            )
        }
    };
    let exists = || {
        Response::error(
            409,
            "A series with that address already exists. Choose it from the list instead; its name and premise are edited under Series.",
        )
    };
    let path = match resolve_content_path(&state.root, &config, &definition.path) {
        Ok(path) => path,
        Err(_) => {
            return shared_problem(
                "title",
                "That title cannot name a series file. Shorten it or use plainer characters.",
            )
        }
    };
    if path.exists() {
        return exists();
    }
    match site::load_site(&state.root, true, None) {
        Ok((site, _)) => {
            if site
                .series_by_slug(&definition.slug)
                .is_some_and(|series| series.source.is_some())
            {
                return exists();
            }
        }
        Err(error) => return Response::error(500, &error),
    }
    if let Err(problems) = validate_candidate(
        &state.root,
        &config,
        &definition.path,
        &definition.source,
        &CreditEdit::Unchanged,
    ) {
        return Response::json(
            422,
            &json!({ "error": "This series can't be created yet.", "problems": problems }),
        );
    }
    if let Err(error) = write_atomic(&path, &definition.source) {
        eprintln!("admin: series definition not written: {error}");
        return Response::error(500, "The series could not be created. Nothing was changed.");
    }
    let build = state.rebuild_locked(&mut status);
    eprintln!("admin: created {}", definition.path);
    let name = openblog_core::shared_series::SeriesPlacement::new(&body.title, None)
        .map(|placement| placement.series)
        .unwrap_or_default();
    state_arc(state).auto_publish(name.clone());
    Response::json(
        201,
        &json!({
            "slug": definition.slug,
            "name": name,
            "path": definition.path,
            "build": { "ok": build.is_ok() },
        }),
    )
}

/// No room for another revision. Saved revisions are intact; only this change was refused.
fn draft_limit_problem() -> Response {
    shared_problem(
        "markdown",
        "This draft has reached its limit of saved revisions or storage, so this change was not saved. Your earlier revisions are intact; keep a copy of your latest text.",
    )
}

fn change_member_roles(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    change_member(state, req, session, false)
}

fn remove_member(state: &AppState, req: &Request, session: &auth::Session) -> Response {
    change_member(state, req, session, true)
}

/// Accepting and declining only need the token. Every attempt counts against a per-account
/// limit and a success refunds it, so guessing tokens is bounded without locking a real invitee
/// out for long.
fn answer_invitation(
    state: &AppState,
    req: &Request,
    session: &auth::Session,
    accept: bool,
) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let key = format!("invitation:{}", session.user);
    if let Err(wait) = lock(&state.throttle).reserve(&key) {
        return Response::error(
            429,
            &format!("Too many invitation attempts. Try again in {wait} seconds."),
        )
        .with_header("Retry-After", &wait.to_string());
    }
    let Ok(body) = serde_json::from_slice::<InvitationTokenRequest>(&req.body) else {
        return Response::error(400, INVITATION_UNAVAILABLE);
    };
    let Some(publication_id) = openblog_core::invitation::token_publication_id(&body.token) else {
        return Response::error(400, INVITATION_UNAVAILABLE);
    };
    let transaction = match invitation_transaction(state, publication_id) {
        Ok(transaction) => transaction,
        Err(response) => return response,
    };
    let Some(record) = &transaction.record else {
        return Response::error(400, INVITATION_UNAVAILABLE);
    };
    let now = clock::now().unix();
    let result = if accept {
        match transaction.contributors.get(&body.contributor_id) {
            Some(display_name) => transaction.with_identities(|identities| {
                record.accept_invitation(
                    &session.user,
                    identities,
                    &body.token,
                    &body.contributor_id,
                    display_name,
                    now,
                )
            }),
            None => Err(InvitationError::Unavailable),
        }
    } else {
        record.decline_invitation(&session.user, &body.token, now)
    };
    let next = match result {
        Ok(next) => next,
        Err(error) => return invitation_problem(error),
    };
    if let Err(response) = transaction.store(&state.root, &next) {
        return response;
    }
    lock(&state.throttle).clear(&key);
    if accept {
        reconcile_approvals(state, &transaction, &next);
    }
    eprintln!(
        "admin: {} a shared publication invitation for {publication_id}",
        if accept { "accepted" } else { "declined" }
    );
    if !accept {
        return Response::json(200, &json!({ "declined": true }));
    }
    let roles = next
        .authorization
        .bindings
        .iter()
        .find(|binding| binding.admin_user == session.user)
        .map(|binding| binding.roles.clone())
        .unwrap_or_default();
    Response::json(
        200,
        &json!({ "publication": shared_publication_summary(&next, &roles) }),
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
    crate::fsutil::replace_file(&tmp, path).map_err(|e| {
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
        None if path.exists() => crate::fsutil::retry_transient(|| fs::remove_file(path))
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
            crate::fsutil::retry_transient(|| fs::rename(from, to)).map_err(|error| {
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
        if let Err(error) = crate::fsutil::retry_transient(|| fs::rename(from, to)) {
            let mut rollback_errors = Vec::new();
            for (moved_from, moved_to) in moved.iter().rev() {
                if let Err(rollback) =
                    crate::fsutil::retry_transient(|| fs::rename(moved_to, moved_from))
                {
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
    let projection = match admin_portable_projection(&preview_site, post, &preview_site.config) {
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
    let (preview_site, themes) = match site::load_site_from_sources_listing(
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
        Err(errors) => {
            // Name the previewed document's own problems, as saving does;
            // other documents are listed only when nothing else explains it.
            let sidecar = openblog_core::contributor::sidecar_path(&rel);
            let mine: Vec<String> = errors
                .iter()
                .filter(|error| {
                    error.contains(&rel)
                        || sidecar.as_deref().is_some_and(|path| error.contains(path))
                })
                .cloned()
                .collect();
            let shown = if mine.is_empty() { errors } else { mine };
            return Response::error(422, &site::content_problems(&shown));
        }
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
    // A post that opts in keeps its citation checks visible even when its
    // citations could not be published (a draft with a broken citation).
    let citations_opted_in = kind == "posts"
        && body["fields"]["citations"]
            .as_str()
            .is_some_and(|style| !style.trim().is_empty());
    let citations = preview_site
        .posts
        .iter()
        .find(|post| post.source == rel)
        .and_then(|post| post.citations().map(|summary| (post, summary)))
        .map(|(post, summary)| citation_preview(&post.slug, summary));
    let portable_preview = if kind == "posts" {
        let Some(post) = preview_site.posts.iter().find(|post| post.source == rel) else {
            return Response::error(422, "Preview post was not found in the site model");
        };
        // A published part of a collaborative series previews the series context its external
        // copies carry, exactly as an acknowledgement recomputes it (ADR 0041).
        let projection = match admin_portable_projection(&preview_site, post, &portable_config) {
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
            "citations": citations,
            "citationsOptedIn": citations_opted_in,
            "portablePreview": portable_preview,
            "warnings": preview_site.warnings,
            "accessibility": accessibility,
            "evidence": evidence
        }),
    )
}

/// What the previewed post's citations made public, with its portable
/// bibliography exports (ADR 0050). Both exports are built from the
/// references the preview published, so they match the notes exactly and
/// hold only their public description; each lists what its format omits.
fn citation_preview(slug: &str, summary: &openblog_core::bibliography::CitationSummary) -> Json {
    let export = |export: source_interchange::Export, extension: &str, media_type: &str| {
        json!({
            "filename": format!("{slug}-references.{extension}"),
            "mediaType": media_type,
            "count": export.count,
            "content": export.content,
            "losses": export.losses,
        })
    };
    json!({
        "style": summary.style.key(),
        "locale": summary.locale.key(),
        "citations": summary.citations,
        "notes": summary.notes,
        "references": summary.references.len(),
        "offline": true,
        "exports": {
            "csl-json": export(
                source_interchange::export_cited_csl_json(&summary.references),
                "json",
                "application/vnd.citationstyles.csl+json",
            ),
            "bibtex": export(
                source_interchange::export_cited_bibtex(&summary.references),
                "bib",
                "application/x-bibtex",
            ),
        },
    })
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

    /// Serializes tests that change the Assistant environment. One test failing while holding it
    /// must not fail every later one too.
    fn quiz_env() -> std::sync::MutexGuard<'static, ()> {
        QUIZ_ENV
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

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

    /// The one call a fake provider expects. A request that fails before reaching the provider
    /// panics this thread after a bound instead of leaving the test joined on it forever.
    fn accept_provider_call(listener: &TcpListener) -> std::net::TcpStream {
        listener.set_nonblocking(true).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    return stream;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "the fake provider was never called"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("the fake provider could not accept: {error}"),
            }
        }
    }

    fn quiz_provider(
        status: u16,
        body: String,
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let mut stream = accept_provider_call(&listener);
            stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
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
            let mut stream = accept_provider_call(&listener);
            stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
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

    fn notebook_call(
        f: &Fixture,
        session: &(String, String),
        method: &str,
        path: &str,
        body: Json,
    ) -> (u16, Json) {
        source_call(f, session, method, path, body)
    }

    fn notebook(f: &Fixture, session: &(String, String)) -> Json {
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/research/notebook"), session, false),
        );
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        body_json(&response)
    }

    fn stored_notebook(f: &Fixture) -> Option<Vec<u8>> {
        fs::read(f.dir.join(crate::notebook_store::NOTEBOOK_FILE)).ok()
    }

    fn fixture_with_sources(tag: &str) -> Fixture {
        let f = fixture(tag);
        let path = f.dir.join(crate::source_store::LIBRARY_FILE);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"version":1,"sources":[{"id":"plato","kind":"work","title":"Politeia"},{"id":"slings","kind":"edition","of":"plato","title":"Slings"}]}"#,
        )
        .unwrap();
        f
    }

    /// Takes the old query-string spelling and sends it as a POST body, the
    /// only form the server accepts.
    fn search(f: &Fixture, session: &(String, String), query: &str) -> (u16, Json) {
        let (route, params) = query.split_once('?').unwrap_or((query, ""));
        let mut body = serde_json::Map::new();
        for pair in params.split('&').filter(|pair| !pair.is_empty()) {
            let (key, value) = pair.split_once('=').unwrap();
            body.insert(key.to_string(), json!(crate::http::percent_decode(value)));
        }
        let mut request = req("POST", &format!("/admin/api/research/{route}"));
        request
            .headers
            .insert("content-type".into(), "application/json".into());
        request.body = serde_json::to_vec(&Json::Object(body)).unwrap();
        let response = handle(&f.state, &authed(request, session, true));
        (response.status, body_json(&response))
    }

    fn seeded_notebook(f: &Fixture, session: &(String, String)) -> Json {
        let empty = notebook(f, session);
        let (status, with_passage) = notebook_call(
            f,
            session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": {"id": "p1", "source": "slings",
                "excerpt": {"text": "<img src=x onerror=alert(1)> the cave"},
                "locators": [{"kind": "page", "value": "514"}]}}),
        );
        assert_eq!(status, 201, "{with_passage}");
        let (status, with_note) = notebook_call(
            f,
            session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": with_passage["revision"], "note": {"id": "n1", "kind": "question",
                "text": "Why a cave?", "passages": ["p1"], "concepts": ["allegory"]}}),
        );
        assert_eq!(status, 201, "{with_note}");
        let (status, done) = notebook_call(
            f,
            session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": with_note["revision"], "note": {"id": "n2", "kind": "question",
                "status": "resolved", "text": "Who tends the fire?", "sources": ["plato"]}}),
        );
        assert_eq!(status, 201, "{done}");
        done
    }

    #[test]
    fn citation_picker_reads_the_library_and_checks_through_the_core_resolver() {
        let f = fixture_with_sources("citation-picker");
        for (method, path) in [("GET", "citations/library"), ("POST", "citations/check")] {
            let response = handle(&f.state, &req(method, &format!("/admin/api/{path}")));
            assert_eq!(response.status, 401, "{path}");
        }
        let session = login_ok(&f);
        let empty = notebook(&f, &session);
        let (status, saved) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": {"id": "p1", "source": "slings",
                "excerpt": {"text": "the cave"},
                "locators": [{"kind": "page", "value": "514", "to": "520", "privateNote": "ob-hidden-4417"}]}}),
        );
        assert_eq!(status, 201, "{saved}");
        let library_bytes = fs::read(f.dir.join(crate::source_store::LIBRARY_FILE)).unwrap();
        let notebook_bytes = stored_notebook(&f).unwrap();

        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/citations/library"), &session, false),
        );
        assert_eq!(response.status, 200);
        let listed = body_json(&response);
        assert!(!String::from_utf8_lossy(&response.body).contains("ob-hidden-4417"));
        assert_eq!(listed["notebookAvailable"], true);
        assert_eq!(listed["sources"][1]["id"], "slings");
        assert_eq!(
            listed["passages"][0]["locators"],
            json!([{"kind": "page", "value": "514", "to": "520"}])
        );
        let revision = listed["revision"].as_str().unwrap().to_string();

        let check = |body: Json, with_csrf: bool| {
            let mut r = authed(
                req("POST", "/admin/api/citations/check"),
                &session,
                with_csrf,
            );
            r.headers
                .insert("content-type".into(), "application/json".into());
            r.body = body.to_string().into_bytes();
            let response = handle(&f.state, &r);
            (response.status, body_json(&response))
        };
        let citation = json!({"key": "slings", "locators": listed["passages"][0]["locators"]});
        let (status, _) = check(json!({"revision": revision, "citation": citation}), false);
        assert_eq!(status, 403);
        let (status, ok) = check(json!({"revision": revision, "citation": citation}), true);
        assert_eq!(status, 200, "{ok}");
        assert_eq!(ok["markdown"], "[@slings, page 514 to 520]");
        assert_eq!(ok["formatted"], "Slings");
        assert_eq!(ok["revision"], revision.as_str());

        let (status, stale) = check(json!({"revision": "old", "citation": citation}), true);
        assert_eq!(status, 409, "{stale}");
        assert_eq!(stale["revision"], revision.as_str());
        assert_eq!(stale["sources"][0]["id"], "plato");

        for (bad, code) in [
            (json!({"key": "missing"}), "unknown-key"),
            (
                json!({"key": "plato", "locators": [{"kind": "page", "value": "5"}]}),
                "ambiguous-locator",
            ),
            (
                json!({"key": "slings", "locators": [{"kind": "page", "value": "5]"}]}),
                "invalid-locator",
            ),
            (json!({"key": "Not A Key"}), "invalid-key"),
        ] {
            let (status, refused) = check(json!({"revision": revision, "citation": bad}), true);
            assert_eq!(status, 422, "{refused}");
            assert_eq!(refused["diagnostics"][0]["code"], code, "{refused}");
        }
        let (status, _) = check(json!({"citation": citation}), true);
        assert_eq!(status, 400);
        // Checking writes nothing.
        assert_eq!(
            fs::read(f.dir.join(crate::source_store::LIBRARY_FILE)).unwrap(),
            library_bytes
        );
        assert_eq!(stored_notebook(&f).unwrap(), notebook_bytes);

        // A damaged notebook leaves the picker working from the library alone.
        fs::write(
            f.dir.join(crate::notebook_store::NOTEBOOK_FILE),
            "{not json",
        )
        .unwrap();
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/citations/library"), &session, false),
        );
        assert_eq!(response.status, 200);
        let listed = body_json(&response);
        assert_eq!(listed["notebookAvailable"], false);
        assert_eq!(listed["passages"], json!([]));
    }

    #[test]
    fn notebook_search_and_backlinks_are_private_read_only_and_scoped() {
        let f = fixture_with_sources("notebook-search");
        for path in ["research/search", "research/backlinks"] {
            let response = handle(&f.state, &req("POST", &format!("/admin/api/{path}")));
            assert_eq!(response.status, 401, "{path}");
        }
        let session = login_ok(&f);
        // Searching an empty notebook is an empty result, and writes nothing.
        let (status, empty) = search(&f, &session, "search?q=anything");
        assert_eq!(status, 200);
        assert_eq!(empty["total"], 0);
        assert!(stored_notebook(&f).is_none());

        let stored = seeded_notebook(&f, &session);
        let bytes = stored_notebook(&f).unwrap();
        let (status, all) = search(&f, &session, "search");
        assert_eq!(status, 200);
        assert_eq!(all["revision"], stored["revision"]);
        assert_eq!(all["counts"]["openQuestions"], 1);
        assert_eq!(all["counts"]["resolvedQuestions"], 1);
        let ids: Vec<_> = all["hits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["p1", "n1", "n2"]);

        let (_, cave) = search(&f, &session, "search?q=CAVE");
        let hit = &cave["hits"][0];
        assert_eq!(hit["id"], "p1");
        assert_eq!(
            hit["snippet"], "<img src=x onerror=alert(1)> the cave",
            "context is text for the page to escape"
        );
        assert_eq!(hit["notes"][0]["id"], "n1");
        assert_eq!(hit["sources"][0]["label"], "Slings");

        let (_, open) = search(&f, &session, "search?state=open");
        assert_eq!(open["hits"].as_array().unwrap().len(), 1);
        let (_, family) = search(&f, &session, "search?source=plato&locator=page");
        let found: Vec<_> = family["hits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| h["id"].as_str().unwrap())
            .collect();
        assert_eq!(found, ["p1", "n1"]);
        let (_, concept) = search(&f, &session, "search?concept=allegory");
        assert_eq!(concept["total"], 1);

        // Bad filters are scoped to the field and say nothing about stored text.
        for (query, field) in [
            ("search?state=maybe", "state"),
            ("search?source=ghost", "source"),
            ("search?locator=pagee", "locator"),
            ("search?concept=Not%20A%20Slug", "concept"),
        ] {
            let (status, refused) = search(&f, &session, query);
            assert_eq!(status, 422, "{query}");
            assert_eq!(refused["diagnostics"][0]["field"], field);
        }
        let (status, long) = search(&f, &session, &format!("search?q={}", "x".repeat(300)));
        assert_eq!(status, 422);
        assert_eq!(long["diagnostics"][0]["field"], "q");

        let (status, backlinks) = search(&f, &session, "backlinks?type=passage&id=p1");
        assert_eq!(status, 200);
        assert_eq!(backlinks["entries"][0]["id"], "n1");
        assert_eq!(backlinks["entries"][0]["relation"], "notes");
        let (_, source) = search(&f, &session, "backlinks?type=source&id=plato");
        let linked: Vec<_> = source["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| (e["id"].as_str().unwrap(), e["relation"].as_str().unwrap()))
            .collect();
        assert_eq!(
            linked,
            [("p1", "quotes"), ("n1", "via-passage"), ("n2", "notes")]
        );
        assert_eq!(
            search(&f, &session, "backlinks?type=source&id=ghost").0,
            422
        );
        assert_eq!(search(&f, &session, "backlinks?id=p1").0, 400);

        // Research text never travels in a URL: the old GET spellings are gone,
        // and a POST needs the CSRF token.
        for path in ["search?q=cave", "backlinks?type=source&id=plato"] {
            let response = handle(
                &f.state,
                &authed(
                    req("GET", &format!("/admin/api/research/{path}")),
                    &session,
                    false,
                ),
            );
            assert_eq!(response.status, 404, "{path}");
            let mut post = req("POST", &format!("/admin/api/research/{path}"));
            post.headers
                .insert("content-type".into(), "application/json".into());
            post.body = b"{}".to_vec();
            let response = handle(&f.state, &authed(post, &session, false));
            assert_eq!(response.status, 403, "{path}");
        }
        let mut wrong = req("POST", "/admin/api/research/search");
        wrong.body = b"{}".to_vec();
        assert_eq!(handle(&f.state, &authed(wrong, &session, true)).status, 415);
        let mut big = req("POST", "/admin/api/research/search");
        big.headers
            .insert("content-type".into(), "application/json".into());
        big.body = vec![b' '; 17 * 1024];
        assert_eq!(handle(&f.state, &authed(big, &session, true)).status, 413);

        // Reading never changes the stored notebook.
        assert_eq!(stored_notebook(&f).unwrap(), bytes);

        // Search results and backlinks have no public form: the built site holds none of them.
        f.state.rebuild().unwrap();
        for file in crate::fsutil::walk(&f.dir.join("dist")) {
            let text = String::from_utf8_lossy(&fs::read(&file).unwrap()).to_string();
            for secret in [
                "onerror=alert(1)",
                "Why a cave?",
                "Who tends the fire?",
                "allegory",
            ] {
                assert!(
                    !text.contains(secret),
                    "{} exposes private research",
                    file.display()
                );
            }
        }
    }

    #[test]
    fn notebook_lifecycle_routes_are_authenticated_csrf_protected_and_scoped() {
        let f = fixture_with_sources("notebook-lifecycle-auth");
        let session = login_ok(&f);
        for path in ["research/archive", "research/export", "research/import"] {
            let mut anonymous = req("POST", &format!("/admin/api/{path}"));
            anonymous
                .headers
                .insert("content-type".into(), "application/json".into());
            anonymous.body = b"{}".to_vec();
            assert_eq!(handle(&f.state, &anonymous).status, 401, "{path}");
            let no_token = authed(anonymous.clone(), &session, false);
            assert_eq!(handle(&f.state, &no_token).status, 403, "{path}");
            let response = handle(&f.state, &authed(anonymous, &session, true));
            assert!(
                response
                    .headers
                    .iter()
                    .any(|(n, v)| n == "Cache-Control" && v == "no-store"),
                "{path} responses are no-store"
            );
        }
        // Only research/import may exceed the ordinary JSON body size.
        let limit = |name: &str| {
            let r = authed(req("POST", &format!("/admin/api/{name}")), &session, true);
            preflight(&f.state, &r).unwrap()
        };
        assert!(limit("research/import") > limit("research/search"));
    }

    #[test]
    fn archiving_is_revision_checked_reversible_and_keeps_entries_out_of_default_search() {
        let f = fixture_with_sources("notebook-archive");
        let session = login_ok(&f);
        let stored = seeded_notebook(&f, &session);
        let revision = stored["revision"].clone();
        let archive =
            |body: Json| notebook_call(&f, &session, "POST", "/admin/api/research/archive", body);
        let (status, stale) = archive(
            json!({"revision": "0".repeat(64), "type": "note", "id": "n2", "archived": true}),
        );
        assert_eq!(status, 409, "{stale}");
        assert_eq!(stale["current"]["id"], "n2");
        for body in [
            json!({"revision": revision, "type": "thing", "id": "n2", "archived": true}),
            json!({"revision": revision, "type": "note", "archived": true}),
            json!({"revision": revision, "type": "note", "id": "n2"}),
        ] {
            assert_eq!(archive(body).0, 400);
        }
        let (status, missing) =
            archive(json!({"revision": revision, "type": "note", "id": "ghost", "archived": true}));
        assert_eq!(status, 422, "{missing}");
        assert_eq!(missing["diagnostics"][0]["code"], "unknown-entry");
        let before = stored_notebook(&f).unwrap();

        let (status, archived) =
            archive(json!({"revision": revision, "type": "note", "id": "n2", "archived": true}));
        assert_eq!(status, 200, "{archived}");
        assert!(archived["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == "n2" && n["archived"] == true));
        let (_, hidden) = search(&f, &session, "search");
        assert!(!hidden["hits"]
            .as_array()
            .unwrap()
            .iter()
            .any(|h| h["id"] == "n2"));
        assert_eq!(hidden["counts"]["archived"], 1);
        assert_eq!(hidden["counts"]["resolvedQuestions"], 0);
        let mut shown = req("POST", "/admin/api/research/search");
        shown
            .headers
            .insert("content-type".into(), "application/json".into());
        shown.body = br#"{"includeArchived":true}"#.to_vec();
        let shown = body_json(&handle(&f.state, &authed(shown, &session, true)));
        let hit = shown["hits"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["id"] == "n2")
            .unwrap();
        assert_eq!(hit["archived"], true);

        let (status, restored) = archive(
            json!({"revision": archived["revision"], "type": "note", "id": "n2", "archived": false}),
        );
        assert_eq!(status, 200, "{restored}");
        assert_eq!(
            stored_notebook(&f).unwrap(),
            before,
            "restoring is byte-identical"
        );
    }

    #[test]
    fn exporting_the_notebook_needs_an_explicit_request_and_importing_is_dry_run_first() {
        let f = fixture_with_sources("notebook-bundle");
        let session = login_ok(&f);
        let stored = seeded_notebook(&f, &session);
        let bytes = stored_notebook(&f).unwrap();
        let export =
            |body: Json| notebook_call(&f, &session, "POST", "/admin/api/research/export", body);

        // Nothing leaves without the explicit confirmation.
        for body in [
            json!({}),
            json!({"includePrivate": "yes"}),
            json!({"includePrivate": false}),
        ] {
            let (status, refused) = export(body);
            assert_eq!(status, 400);
            assert!(!refused.to_string().contains("Why a cave"), "{refused}");
        }
        let (status, exported) = export(json!({"includePrivate": true}));
        assert_eq!(status, 200, "{exported}");
        assert_eq!(exported["private"], true);
        assert_eq!(exported["passages"], 1);
        assert_eq!(exported["notes"], 2);
        let content = exported["content"].as_str().unwrap().to_string();
        assert!(content.contains("Why a cave?"));
        assert_eq!(exported["revision"], stored["revision"]);
        assert_eq!(
            export(json!({"includePrivate": true})).1["content"],
            content,
            "deterministic"
        );
        assert_eq!(
            stored_notebook(&f).unwrap(),
            bytes,
            "exporting writes nothing"
        );

        // Into another project: preview first, nothing written.
        let g = fixture_with_sources("notebook-bundle-target");
        let other = login_ok(&g);
        let empty = notebook(&g, &other);
        let bundle: Json = serde_json::from_str(&content).unwrap();
        let import =
            |body: Json| notebook_call(&g, &other, "POST", "/admin/api/research/import", body);
        let (status, preview) = import(json!({"revision": empty["revision"], "content": content}));
        assert_eq!(status, 200, "{preview}");
        assert_eq!(preview["applied"], false);
        assert_eq!(preview["applicable"], true);
        assert_eq!(preview["plan"]["counts"]["create"], 3);
        assert!(
            !preview.to_string().contains("Why a cave"),
            "a plan never repeats text"
        );
        assert!(stored_notebook(&g).is_none(), "a preview writes nothing");

        let (status, stale) =
            import(json!({"revision": "0".repeat(64), "apply": true, "content": content}));
        assert_eq!(status, 409, "{stale}");
        assert!(stored_notebook(&g).is_none());

        let (status, applied) =
            import(json!({"revision": empty["revision"], "apply": true, "content": content}));
        assert_eq!(status, 200, "{applied}");
        assert_eq!(applied["applied"], true);
        assert_eq!(
            stored_notebook(&g).unwrap(),
            bytes,
            "the restored file is byte-identical"
        );

        // Importing again is a no-op, even when asked to apply.
        let (status, again) =
            import(json!({"revision": applied["revision"], "apply": true, "content": content}));
        assert_eq!(status, 200, "{again}");
        assert_eq!(again["applied"], false);
        assert_eq!(again["plan"]["counts"]["unchanged"], 3);
        assert_eq!(stored_notebook(&g).unwrap(), bytes);

        // A conflict refuses the whole import with text-free, entry-scoped diagnostics.
        let mut changed = bundle.clone();
        changed["notebook"]["notes"][0]["text"] = json!("A rival thought");
        let (status, blocked) = import(
            json!({"revision": applied["revision"], "apply": true, "content": changed.to_string()}),
        );
        assert_eq!(status, 422, "{blocked}");
        assert!(blocked["diagnostics"][0]["id"] == "n1" || blocked["diagnostics"][0]["id"] == "n2");
        assert!(
            !blocked.to_string().contains("rival thought")
                && !blocked.to_string().contains("Why a cave")
        );
        assert_eq!(stored_notebook(&g).unwrap(), bytes);

        // Hostile bundles are refused before anything is read into the notebook.
        for hostile in [
            json!({"format": "open.blog/research-notebook", "version": 9, "private": true, "notebook": {}}),
            json!({"format": "other"}),
            json!({"format": "open.blog/research-notebook", "version": 1, "private": true,
                "notebook": {"version": 1, "notes": [{"id": "../x", "kind": "observation", "text": "t"}]}}),
            json!({"format": "open.blog/research-notebook", "version": 1, "private": true,
                "notebook": {"version": 1, "passages": [{"id": "p", "source": "ghost", "excerpt": {"text": "t"}}]}}),
        ] {
            let (status, refused) = import(
                json!({"revision": applied["revision"], "apply": true, "content": hostile.to_string()}),
            );
            assert_eq!(status, 422, "{refused}");
            assert!(refused["diagnostics"].is_array());
        }
        let (status, _) = import(json!({"revision": applied["revision"], "content": 5}));
        assert_eq!(status, 400);
        assert_eq!(stored_notebook(&g).unwrap(), bytes);
    }

    #[test]
    fn importing_keeps_large_integers_in_unknown_fields_exactly() {
        let g = fixture_with_sources("notebook-bundle-bigint");
        let session = login_ok(&g);
        let empty = notebook(&g, &session);
        // Sent as the raw file text: 2^53 + 1 survives where a JSON number would be rounded.
        let raw = r#"{"format":"open.blog/research-notebook","version":1,"private":true,"notebook":{"version":1,"notes":[{"id":"big","kind":"observation","text":"t","counter":9007199254740993}]}}"#;
        let (status, applied) = notebook_call(
            &g,
            &session,
            "POST",
            "/admin/api/research/import",
            json!({"revision": empty["revision"], "apply": true, "content": raw}),
        );
        assert_eq!(status, 200, "{applied}");
        let stored = String::from_utf8(stored_notebook(&g).unwrap()).unwrap();
        assert!(stored.contains("9007199254740993"), "{stored}");
    }

    // ---- publication-leak regression corpus (A2.4, ADR 0037) --------------------
    //
    // Every field a notebook entry can carry holds its own distinctive sentinel.
    // The corpus then proves, surface by surface, that none of them crosses a
    // boundary the author did not explicitly open. Adding a surface means adding
    // one line to `surfaces`; adding a field means adding one sentinel.

    const SENTINELS: [(&str, &str); 9] = [
        ("passage id", "ob-leak-passage-id-4471"),
        ("excerpt", "ob-leak-excerpt-text-4471"),
        ("locator", "ob-leak-locator-4471"),
        ("unknown passage field", "ob-leak-extra-field-4471"),
        ("note id", "ob-leak-note-id-4471"),
        ("note text", "ob-leak-note-text-4471"),
        ("concept", "ob-leak-concept-4471"),
        ("archived note id", "ob-leak-archived-id-4471"),
        ("archived note text", "ob-leak-archived-text-4471"),
    ];

    fn leaked(bytes: &[u8]) -> Vec<&'static str> {
        let text = String::from_utf8_lossy(bytes);
        SENTINELS
            .iter()
            .filter(|(_, sentinel)| text.contains(sentinel))
            .map(|(name, _)| *name)
            .collect()
    }

    fn assert_clean(surface: &str, bytes: &[u8]) {
        let found = leaked(bytes);
        assert!(
            found.is_empty(),
            "{surface} exposes private research ({})",
            found.join(", ")
        );
        assert!(
            !openblog_core::research_bundle::looks_like_private_research(bytes),
            "{surface} carries a research export or notebook copy"
        );
    }

    /// Signed-in diagnostics are scoped by entry id so the author can find the
    /// entry they name (ADR 0035); everything else about an entry stays out.
    fn assert_text_free(surface: &str, bytes: &[u8]) {
        let text = String::from_utf8_lossy(bytes);
        for (name, sentinel) in SENTINELS {
            if name.ends_with(" id") {
                continue;
            }
            assert!(
                !text.contains(sentinel),
                "{surface} repeats private research ({name})"
            );
        }
    }

    fn seeded_leak_corpus(f: &Fixture, session: &(String, String)) {
        let empty = notebook(f, session);
        let (status, saved) = notebook_call(
            f,
            session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": {
                "id": SENTINELS[0].1, "source": "slings",
                "excerpt": {"text": format!("{} quoted", SENTINELS[1].1)},
                "locators": [{"kind": "page", "value": SENTINELS[2].1}],
                "shelf": {"memo": SENTINELS[3].1}}}),
        );
        assert_eq!(status, 201, "{saved}");
        let (status, saved) = notebook_call(
            f,
            session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": saved["revision"], "note": {
                "id": SENTINELS[4].1, "kind": "observation",
                "text": format!("{} noted", SENTINELS[5].1),
                "passages": [SENTINELS[0].1], "concepts": [SENTINELS[6].1]}}),
        );
        assert_eq!(status, 201, "{saved}");
        let (status, saved) = notebook_call(
            f,
            session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": saved["revision"], "note": {
                "id": SENTINELS[7].1, "kind": "question", "archived": true,
                "text": format!("{} set aside", SENTINELS[8].1)}}),
        );
        assert_eq!(status, 201, "{saved}");
    }

    #[test]
    fn private_research_sentinels_never_cross_a_publication_boundary() {
        let f = fixture_with_sources("notebook-leak-corpus");
        let session = login_ok(&f);
        seeded_leak_corpus(&f, &session);
        let stored = stored_notebook(&f).unwrap();
        // Positive controls: the seeds are really in the private file and its
        // authorised views, so a clean result below means something.
        assert_eq!(
            leaked(&stored).len(),
            SENTINELS.len(),
            "every sentinel is stored"
        );
        let (status, exported) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/export",
            json!({"includePrivate": true}),
        );
        assert_eq!(status, 200);
        assert_eq!(
            leaked(exported["content"].as_str().unwrap().as_bytes()).len(),
            SENTINELS.len(),
            "the explicit export carries everything, archived entries included"
        );

        // The built site: pages, feeds, search index, llms files, assets.
        f.state.rebuild().unwrap();
        let dist = f.dir.join("dist");
        let files = crate::fsutil::walk(&dist);
        let names: Vec<String> = files
            .iter()
            .map(|file| crate::fsutil::relative(&dist, file))
            .collect();
        for expected in ["index.html", "search.json", "llms.txt", "llms-full.txt"] {
            assert!(
                names.iter().any(|name| name == expected),
                "{expected} was built: {names:?}"
            );
        }
        assert!(
            names.iter().any(|name| name.ends_with(".xml")),
            "a feed was built: {names:?}"
        );
        for file in &files {
            let name = crate::fsutil::relative(&dist, file);
            assert!(
                !name.contains("notebook")
                    && (name == crate::fsutil::MARKER || !name.contains(".openblog")),
                "{name}"
            );
            assert_clean(&format!("dist/{name}"), &fs::read(file).unwrap());
        }

        // Portable exports of every published article.
        let (site, _) = crate::site::load_site(&f.dir, false, None).unwrap();
        assert!(!site.posts.is_empty());
        for post in &site.posts {
            let projection =
                openblog_core::portability::PortableProjection::from_post(post, &site.config)
                    .unwrap();
            assert_clean(
                &format!("portable markdown of {}", post.slug),
                projection.portable_markdown().unwrap().as_bytes(),
            );
            let html = projection.portable_html().unwrap();
            assert_clean(
                &format!("portable html of {}", post.slug),
                format!("{html:?}").as_bytes(),
            );
        }

        // Source exports (CSL JSON and BibTeX) and the library file itself.
        for format in ["csl-json", "bibtex"] {
            let response = handle(
                &f.state,
                &authed(
                    req("GET", &format!("/admin/api/sources/export?format={format}")),
                    &session,
                    false,
                ),
            );
            assert_eq!(response.status, 200);
            assert_clean(&format!("{format} export"), &response.body);
        }
        assert_clean(
            "the source library file",
            &fs::read(f.dir.join(crate::source_store::LIBRARY_FILE)).unwrap(),
        );
        // The content tree and the configuration, which source mode edits.
        let mut tree = crate::fsutil::walk(&f.dir.join("content"));
        tree.push(f.dir.join("openblog.json"));
        for file in tree {
            assert_clean(&format!("{}", file.display()), &fs::read(&file).unwrap());
        }

        // Other Admin views are not a back door to the notebook.
        for path in ["meta", "sources", "preferences", "contributors", "session"] {
            let response = handle(
                &f.state,
                &authed(req("GET", &format!("/admin/api/{path}")), &session, false),
            );
            assert_clean(&format!("admin {path}"), &response.body);
        }

        // The public server does not serve private storage under any spelling.
        for path in [
            "/.openblog/private/research/notebook.json",
            "/.openblog/private/research/notebook.json/",
            "/%2eopenblog/private/research/notebook.json",
            "/../.openblog/private/research/notebook.json",
            "/search.json?q=ob-leak-note-text-4471",
        ] {
            let response = crate::serve::route(&f.state, &req("GET", path), &dist);
            assert_clean(&format!("public route {path}"), &response.body);
        }

        // Error bodies, anonymous or malformed, never repeat stored or submitted text.
        let anonymous = |method: &str, path: &str, body: &str| {
            let mut r = req(method, path);
            r.headers
                .insert("content-type".into(), "application/json".into());
            r.body = body.as_bytes().to_vec();
            handle(&f.state, &r)
        };
        let submitted = format!("{{\"q\":\"{}\"}}", SENTINELS[5].1);
        for (method, path) in [
            ("POST", "/admin/api/research/search"),
            ("POST", "/admin/api/research/backlinks"),
            ("POST", "/admin/api/research/export"),
            ("POST", "/admin/api/research/import"),
            ("POST", "/admin/api/research/archive"),
            ("GET", "/admin/api/research/notebook"),
            ("PUT", "/admin/api/research/notes"),
            ("DELETE", "/admin/api/research/passages"),
        ] {
            let denied = anonymous(method, path, &submitted);
            assert!(
                denied.status == 401 || denied.status == 405,
                "{method} {path}"
            );
            assert_clean(&format!("anonymous {method} {path}"), &denied.body);
            if method == "GET" {
                continue; // a signed-in read needs no token, and is the authorised view
            }
            let no_csrf = handle(
                &f.state,
                &authed(
                    {
                        let mut r = req(method, path);
                        r.headers
                            .insert("content-type".into(), "application/json".into());
                        r.body = submitted.as_bytes().to_vec();
                        r
                    },
                    &session,
                    false,
                ),
            );
            assert_clean(&format!("no-CSRF {method} {path}"), &no_csrf.body);
        }
        let revision = notebook(&f, &session)["revision"].clone();
        let revision = revision.as_str().unwrap().to_string();
        let bad = format!("{}\u{202e}", SENTINELS[5].1);
        let refusals = [
            // An invalid entry: scoped diagnostics, never its text.
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/notes",
                json!({
                "revision": revision, "note": {"id": SENTINELS[5].1.to_uppercase(), "kind": "observation", "text": bad}}),
            ),
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/notes",
                json!({
                "revision": revision, "note": {"id": "fresh", "kind": "observation", "text": bad, "passages": [SENTINELS[1].1]}}),
            ),
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/passages",
                json!({
                "revision": revision, "passage": {"id": "fresh", "source": SENTINELS[3].1, "excerpt": {"text": bad}}}),
            ),
            // An import that conflicts, or is hostile, repeats nothing.
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/import",
                json!({
                "revision": revision, "apply": true, "content": json!({"format": "open.blog/research-notebook",
                "version": 1, "private": true, "notebook": {"version": 1, "notes": [
                    {"id": SENTINELS[4].1, "kind": "observation", "text": "a different thought"}]}}).to_string()}),
            ),
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/import",
                json!({
                "revision": revision, "content": json!({"format": SENTINELS[5].1}).to_string()}),
            ),
            // A removal that is refused, and a search that is.
            notebook_call(
                &f,
                &session,
                "DELETE",
                "/admin/api/research/passages",
                json!({
                "revision": revision, "id": SENTINELS[0].1}),
            ),
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/search",
                json!({
                "q": "x".repeat(300), "concept": SENTINELS[6].1.to_uppercase()}),
            ),
            notebook_call(
                &f,
                &session,
                "POST",
                "/admin/api/research/export",
                json!({}),
            ),
        ];
        for (status, body) in refusals {
            assert!((400..500).contains(&status), "{status} {body}");
            assert_text_free(&format!("error body {status}"), body.to_string().as_bytes());
        }

        // A damaged notebook is reported with its path, never its text.
        let path = f.dir.join(crate::notebook_store::NOTEBOOK_FILE);
        let damaged = format!("{{\"version\":1,\"notes\":[{{\"id\":\"n\",\"kind\":\"observation\",\"text\":\"{}\",\"visibility\":\"public\"}}]}}", SENTINELS[5].1);
        fs::write(&path, damaged).unwrap();
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/research/notebook"), &session, false),
        );
        assert_eq!(response.status, 422);
        assert_text_free("damaged notebook report", &response.body);
        let (status, searched) = search(&f, &session, "search?q=anything");
        assert_eq!(status, 422);
        assert_text_free("damaged notebook search", searched.to_string().as_bytes());
        fs::write(&path, &stored).unwrap();
    }

    #[test]
    fn the_hosted_publish_path_never_carries_private_research() {
        let f = fixture_with_sources("notebook-leak-publish");
        let session = login_ok(&f);
        seeded_leak_corpus(&f, &session);
        let git = crate::git::Git::new(&f.dir);
        git.init().unwrap();
        git.run(&["config", "user.email", "t@example.com"]).unwrap();
        git.run(&["config", "user.name", "T"]).unwrap();
        git.run(&["config", "commit.gpgsign", "false"]).unwrap();
        let mut config = site::load_config(&f.dir).unwrap();
        // Even when the private directory is listed as publishable.
        config.publish.paths = vec!["content".into(), "static".into(), ".openblog".into()];
        let outcome = crate::publish::publish(&f.dir, &config, Some("Corpus")).unwrap();
        assert!(!outcome.committed.is_empty());
        assert!(outcome
            .committed
            .iter()
            .all(|path| !path.contains(".openblog/private")));
        for (name, sentinel) in SENTINELS {
            let history = git
                .run(&["log", "--all", "-p", "--format=%H", "-S", sentinel])
                .unwrap();
            assert!(
                history.trim().is_empty(),
                "{name} reached the commit history"
            );
        }
        let tree = git.run(&["ls-files"]).unwrap();
        assert!(
            !tree.contains("notebook.json") && !tree.contains("research/"),
            "{tree}"
        );

        // The workspace's durable store is private storage, not a publish path:
        // publication still refuses a notebook copy that lands in a published folder.
        let (status, exported) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/export",
            json!({"includePrivate": true}),
        );
        assert_eq!(status, 200);
        fs::create_dir_all(f.dir.join("static")).unwrap();
        fs::write(
            f.dir.join("static/research.json"),
            exported["content"].as_str().unwrap(),
        )
        .unwrap();
        let error = crate::publish::publish(&f.dir, &config, Some("Leak")).unwrap_err();
        assert!(error.contains("static/research.json"), "{error}");
        assert!(leaked(error.as_bytes()).is_empty());
        // And the build refuses to generate a site around it.
        let error = crate::site::build(
            &f.dir,
            &crate::site::BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .err()
        .unwrap();
        assert!(error.contains("static/research.json"), "{error}");
        assert!(leaked(error.as_bytes()).is_empty());
        let Err(error) = f.state.rebuild() else {
            panic!("Admin's own rebuild refuses it too")
        };
        assert!(error.contains("static/research.json"), "{error}");
        assert!(leaked(error.as_bytes()).is_empty());
        for (name, sentinel) in SENTINELS {
            assert!(
                !git.run(&["log", "--all", "-S", sentinel, "--format=%H"])
                    .unwrap()
                    .contains(char::is_alphanumeric),
                "{name}"
            );
        }
    }

    // ---- Knowledge Atlas leak regressions (A5.2, ADR 0060) ----------------------
    //
    // Every atlas field holds its own sentinel, including approved items: there is
    // no publication projection yet, so approval must not open any surface either.

    const ATLAS_SENTINELS: [(&str, &str); 14] = [
        ("entry id", "ob-atlas-entry-id-5309"),
        ("label", "ob-atlas-label-5309"),
        ("alias", "ob-atlas-alias-5309"),
        ("summary", "ob-atlas-summary-5309"),
        ("relationship id", "ob-atlas-relationship-id-5309"),
        ("named party", "ob-atlas-party-5309"),
        ("uncertainty", "ob-atlas-uncertainty-5309"),
        ("locator", "ob-atlas-locator-5309"),
        ("unknown field", "ob-atlas-extra-5309"),
        ("dissent note", "ob-atlas-dissent-note-5309"),
        ("dissenting party", "ob-atlas-dissenter-5309"),
        (
            "relationship unknown field",
            "ob-atlas-relationship-extra-5309",
        ),
        ("evidence unknown field", "ob-atlas-evidence-extra-5309"),
        ("top-level unknown field", "ob-atlas-top-extra-5309"),
    ];

    fn atlas_leaked(bytes: &[u8]) -> Vec<&'static str> {
        let text = String::from_utf8_lossy(bytes);
        ATLAS_SENTINELS
            .iter()
            .filter(|(_, sentinel)| text.contains(sentinel))
            .map(|(name, _)| *name)
            .collect()
    }

    fn assert_atlas_clean(surface: &str, bytes: &[u8]) {
        let found = atlas_leaked(bytes);
        assert!(
            found.is_empty(),
            "{surface} exposes the Knowledge Atlas ({})",
            found.join(", ")
        );
        assert!(
            !openblog_core::research_bundle::looks_like_private_research(bytes),
            "{surface} carries a copy of private research"
        );
    }

    fn seeded_atlas(f: &Fixture) -> Vec<u8> {
        use openblog_core::knowledge_atlas::{Entry, Relationship};
        let none = BTreeMap::new();
        let empty = crate::atlas_store::load(&f.dir, &none).unwrap();
        let person = Entry::from_json(json!({
            "id": ATLAS_SENTINELS[0].1, "kind": "person", "label": ATLAS_SENTINELS[1].1,
            "aliases": [ATLAS_SENTINELS[2].1], "summary": ATLAS_SENTINELS[3].1,
            "visibility": "approved", "shelf": ATLAS_SENTINELS[8].1}))
        .unwrap();
        let work = Entry::from_json(json!({"id": "politeia", "kind": "work",
            "label": "Politeia", "source": "plato", "visibility": "approved"}))
        .unwrap();
        let one = crate::atlas_store::create_entry(&f.dir, &empty.revision, person, &none).unwrap();
        let two = crate::atlas_store::create_entry(&f.dir, &one.revision, work, &none).unwrap();
        let relationship = Relationship::from_json(json!({
            "id": ATLAS_SENTINELS[4].1, "kind": "authored",
            "from": ATLAS_SENTINELS[0].1, "to": "politeia",
            "assertedBy": {"kind": "named", "name": ATLAS_SENTINELS[5].1},
            "uncertainty": ATLAS_SENTINELS[6].1, "visibility": "approved",
            "contestedBy": [{"by": {"kind": "named", "name": ATLAS_SENTINELS[10].1},
                "note": ATLAS_SENTINELS[9].1}],
            "shelf": ATLAS_SENTINELS[11].1,
            "evidence": [{"source": "slings", "margin": ATLAS_SENTINELS[12].1,
                "locators": [{"kind": "page", "value": ATLAS_SENTINELS[7].1}]}]}))
        .unwrap();
        crate::atlas_store::create_relationship(&f.dir, &two.revision, relationship, &none)
            .unwrap();
        // The store edits entries and relationships only; a top-level unknown
        // field arrives by hand edit, and the stored atlas stays valid with it.
        let path = f.dir.join(crate::atlas_store::ATLAS_FILE);
        let mut document: Json = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        document["workspace"] = json!(ATLAS_SENTINELS[13].1);
        fs::write(&path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();
        crate::atlas_store::load(&f.dir, &none).expect("the hand-edited atlas is valid");
        let stored = fs::read(&path).unwrap();
        assert_eq!(
            atlas_leaked(&stored).len(),
            ATLAS_SENTINELS.len(),
            "every sentinel is stored, so a clean result below means something"
        );
        stored
    }

    #[test]
    fn knowledge_atlas_sentinels_never_cross_a_publication_boundary() {
        let f = fixture_with_sources("atlas-leak-corpus");
        let session = login_ok(&f);
        let stored = seeded_atlas(&f);

        // The built site: pages, feeds, search index, llms files, assets.
        f.state.rebuild().unwrap();
        let dist = f.dir.join("dist");
        let files = crate::fsutil::walk(&dist);
        let names: Vec<String> = files
            .iter()
            .map(|file| crate::fsutil::relative(&dist, file))
            .collect();
        for expected in ["index.html", "search.json", "llms.txt", "llms-full.txt"] {
            assert!(names.iter().any(|name| name == expected), "{expected}");
        }
        assert!(names.iter().any(|name| name.ends_with(".xml")), "a feed");
        for file in &files {
            let name = crate::fsutil::relative(&dist, file);
            assert!(
                !name.contains("atlas")
                    && (name == crate::fsutil::MARKER || !name.contains(".openblog")),
                "{name}"
            );
            assert_atlas_clean(&format!("dist/{name}"), &fs::read(file).unwrap());
        }

        // Portable exports of every published article.
        let (site, _) = crate::site::load_site(&f.dir, false, None).unwrap();
        assert!(!site.posts.is_empty());
        for post in &site.posts {
            let projection =
                openblog_core::portability::PortableProjection::from_post(post, &site.config)
                    .unwrap();
            assert_atlas_clean(
                &format!("portable markdown of {}", post.slug),
                projection.portable_markdown().unwrap().as_bytes(),
            );
            let html = projection.portable_html().unwrap();
            assert_atlas_clean(
                &format!("portable html of {}", post.slug),
                format!("{html:?}").as_bytes(),
            );
        }

        // Source exports, the research export, and other Admin views.
        for format in ["csl-json", "bibtex"] {
            let response = handle(
                &f.state,
                &authed(
                    req("GET", &format!("/admin/api/sources/export?format={format}")),
                    &session,
                    false,
                ),
            );
            assert_eq!(response.status, 200);
            assert_atlas_clean(&format!("{format} export"), &response.body);
        }
        let (status, exported) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/export",
            json!({"includePrivate": true}),
        );
        assert_eq!(status, 200);
        assert!(atlas_leaked(exported.to_string().as_bytes()).is_empty());
        for path in [
            "meta",
            "sources",
            "preferences",
            "contributors",
            "session",
            "research/notebook",
        ] {
            let response = handle(
                &f.state,
                &authed(req("GET", &format!("/admin/api/{path}")), &session, false),
            );
            assert!(atlas_leaked(&response.body).is_empty(), "admin {path}");
        }
        assert_atlas_clean(
            "the source library file",
            &fs::read(f.dir.join(crate::source_store::LIBRARY_FILE)).unwrap(),
        );

        // The public server does not serve the atlas under any spelling.
        for path in [
            "/.openblog/private/research/atlas.json",
            "/.openblog/private/research/atlas.json/",
            "/%2eopenblog/private/research/atlas.json",
            "/../.openblog/private/research/atlas.json",
            "/search.json?q=ob-atlas-label-5309",
        ] {
            let response = crate::serve::route(&f.state, &req("GET", path), &dist);
            assert_atlas_clean(&format!("public route {path}"), &response.body);
        }

        // Publishing never commits it, even with the private folder listed.
        let git = crate::git::Git::new(&f.dir);
        git.init().unwrap();
        git.run(&["config", "user.email", "t@example.com"]).unwrap();
        git.run(&["config", "user.name", "T"]).unwrap();
        git.run(&["config", "commit.gpgsign", "false"]).unwrap();
        let mut config = site::load_config(&f.dir).unwrap();
        config.publish.paths = vec!["content".into(), "static".into(), ".openblog".into()];
        let outcome = crate::publish::publish(&f.dir, &config, Some("Atlas")).unwrap();
        assert!(outcome
            .committed
            .iter()
            .all(|path| !path.contains(".openblog/private") && !path.contains("atlas")));
        for (name, sentinel) in ATLAS_SENTINELS {
            let history = git
                .run(&["log", "--all", "-p", "--format=%H", "-S", sentinel])
                .unwrap();
            assert!(
                history.trim().is_empty(),
                "{name} reached the commit history"
            );
        }

        // A copy of the atlas in a public folder stops the build, Admin's
        // rebuild and publishing, naming only its path.
        fs::create_dir_all(f.dir.join("static")).unwrap();
        fs::write(f.dir.join("static/graph.json"), &stored).unwrap();
        let error = crate::publish::publish(&f.dir, &config, Some("Leak")).unwrap_err();
        assert!(error.contains("static/graph.json"), "{error}");
        assert!(atlas_leaked(error.as_bytes()).is_empty());
        let Err(error) = f.state.rebuild() else {
            panic!("Admin's rebuild refuses an atlas copy in static/")
        };
        assert!(error.contains("static/graph.json") && atlas_leaked(error.as_bytes()).is_empty());
        let error = crate::site::build(
            &f.dir,
            &crate::site::BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .err()
        .unwrap();
        assert!(error.contains("static/graph.json") && atlas_leaked(error.as_bytes()).is_empty());
    }

    #[test]
    fn notebook_code_has_no_logging_path_for_private_text() {
        // Nothing that handles research text prints, logs or debug-dumps it, so
        // no log line can carry it. Sources are checked as text.
        let admin = include_str!("admin.rs");
        let start = admin
            .find("/// Read a search or backlinks request")
            .expect("the research routes start here");
        let end = admin[start..]
            .find("fn content_transaction")
            .expect("and end here")
            + start;
        let routes = &admin[start..end];
        let files = [
            ("the research routes", routes),
            ("notebook_store.rs", include_str!("notebook_store.rs")),
            (
                "research_bundle.rs",
                include_str!("../../openblog-core/src/research_bundle.rs"),
            ),
            (
                "research_search.rs",
                include_str!("../../openblog-core/src/research_search.rs"),
            ),
            (
                "research_notes.rs",
                include_str!("../../openblog-core/src/research_notes.rs"),
            ),
            ("private_guard.rs", include_str!("private_guard.rs")),
            ("atlas_store.rs", include_str!("atlas_store.rs")),
            (
                "knowledge_atlas.rs",
                include_str!("../../openblog-core/src/knowledge_atlas.rs"),
            ),
        ];
        let banned = [
            "println!",
            "eprintln!",
            "print!",
            "eprint!",
            "dbg!",
            "log::",
            "tracing::",
        ];
        for (name, text) in files {
            for line in text.lines() {
                let code = line.trim_start();
                if code.starts_with("//") {
                    continue;
                }
                for word in banned {
                    assert!(!code.contains(word), "{name} logs: {code}");
                }
            }
        }
    }

    #[test]
    fn notebook_search_follows_edits_archives_and_reports_a_damaged_notebook() {
        let f = fixture_with_sources("notebook-search-edits");
        let session = login_ok(&f);
        let stored = seeded_notebook(&f, &session);

        // Archiving the edition keeps the backlinks and marks the source.
        let sources = source_library(&f, &session);
        let (status, _) = source_call(
            &f,
            &session,
            "POST",
            "/admin/api/sources/archive",
            json!({"revision": sources["revision"], "id": "slings", "archived": true}),
        );
        assert_eq!(status, 200);
        let (_, backlinks) = search(&f, &session, "backlinks?type=source&id=plato");
        assert_eq!(backlinks["entries"].as_array().unwrap().len(), 3);
        let (_, cave) = search(&f, &session, "search?q=cave");
        assert_eq!(cave["hits"][0]["sources"][0]["archived"], true);

        // Resolving a question moves it between the states.
        let mut note = json!({"id": "n1", "kind": "question", "text": "Why a cave?",
            "passages": ["p1"], "concepts": ["allegory"], "status": "resolved"});
        let (status, updated) = notebook_call(
            &f,
            &session,
            "PUT",
            "/admin/api/research/notes",
            json!({"revision": stored["revision"], "note": note.clone()}),
        );
        assert_eq!(status, 200, "{updated}");
        assert_eq!(search(&f, &session, "search?state=open").1["total"], 0);
        assert_eq!(search(&f, &session, "search?state=resolved").1["total"], 2);
        note["kind"] = json!("observation");
        let (status, refused) = notebook_call(
            &f,
            &session,
            "PUT",
            "/admin/api/research/notes",
            json!({"revision": updated["revision"], "note": note}),
        );
        assert_eq!(
            status, 422,
            "an observation has no question state: {refused}"
        );
        assert_eq!(refused["diagnostics"][0]["field"], "status");

        // Removing a note removes its backlink.
        let (status, _) = notebook_call(
            &f,
            &session,
            "DELETE",
            "/admin/api/research/notes",
            json!({"revision": updated["revision"], "id": "n1"}),
        );
        assert_eq!(status, 200);
        let (_, after) = search(&f, &session, "backlinks?type=passage&id=p1");
        assert!(after["entries"].as_array().unwrap().is_empty());

        // A damaged notebook is reported with its path and is never searched around.
        let path = f.dir.join(crate::notebook_store::NOTEBOOK_FILE);
        fs::write(&path, b"{").unwrap();
        let (status, damaged) = search(&f, &session, "search?q=cave");
        assert_eq!(status, 422);
        assert_eq!(damaged["file"], crate::notebook_store::NOTEBOOK_FILE);
        assert_eq!(fs::read(&path).unwrap(), b"{");
    }

    #[test]
    fn research_notebook_api_is_authenticated_csrf_protected_and_revision_checked() {
        let f = fixture_with_sources("notebook-api");
        for (method, path) in [
            ("GET", "/admin/api/research/notebook"),
            ("POST", "/admin/api/research/passages"),
            ("PUT", "/admin/api/research/passages"),
            ("DELETE", "/admin/api/research/passages"),
            ("POST", "/admin/api/research/notes"),
            ("PUT", "/admin/api/research/notes"),
            ("DELETE", "/admin/api/research/notes"),
        ] {
            assert_eq!(handle(&f.state, &req(method, path)).status, 401, "{path}");
        }
        let session = login_ok(&f);
        let empty = notebook(&f, &session);
        assert_eq!(empty["file"], crate::notebook_store::NOTEBOOK_FILE);
        assert_eq!(empty["stored"], false);
        assert_eq!(empty["sources"].as_array().unwrap().len(), 2);
        assert!(stored_notebook(&f).is_none());

        let passage = json!({"id": "p1", "source": "slings",
            "excerpt": {"text": "<img src=x onerror=alert(1)> ὁ δὲ Σωκράτης 🙂", "language": "grc"},
            "locators": [{"kind": "page", "value": "514"}]});
        // No CSRF token: refused, nothing written.
        let without = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/research/passages",
                    json!({"revision": empty["revision"], "passage": passage}),
                ),
                &session,
                false,
            ),
        );
        assert_eq!(without.status, 403);
        assert!(stored_notebook(&f).is_none());
        // No revision: refused.
        let (status, _) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/passages",
            json!({"passage": passage}),
        );
        assert_eq!(status, 400);

        let (status, created) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": passage}),
        );
        assert_eq!(status, 201, "{created}");
        assert_eq!(created["stored"], true);
        assert_eq!(
            created["passage"]["excerpt"]["text"],
            "<img src=x onerror=alert(1)> ὁ δὲ Σωκράτης 🙂"
        );
        assert_eq!(created["passage"]["visibility"], "private");
        let after_passage = stored_notebook(&f).unwrap();

        // Reusing the old revision conflicts and returns the stored copy.
        let (status, stale) = notebook_call(
            &f,
            &session,
            "PUT",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": passage}),
        );
        assert_eq!(status, 409);
        assert_eq!(stale["conflict"], true);
        assert_eq!(stale["revision"], created["revision"]);
        assert_eq!(stale["current"]["id"], "p1");
        assert_eq!(stored_notebook(&f).unwrap(), after_passage);

        let note = json!({"id": "n1", "kind": "question", "text": "Why a cave?",
            "passages": ["p1"], "sources": ["plato"], "concepts": ["allegory"]});
        let (status, with_note) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": created["revision"], "note": note}),
        );
        assert_eq!(status, 201, "{with_note}");
        // Update and the same id again.
        let mut edited = note.clone();
        edited["text"] = json!("Why a cave, and who owns the fire?");
        let (status, updated) = notebook_call(
            &f,
            &session,
            "PUT",
            "/admin/api/research/notes",
            json!({"revision": with_note["revision"], "note": edited}),
        );
        assert_eq!(status, 200, "{updated}");
        let (status, duplicate) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": updated["revision"], "note": note}),
        );
        assert_eq!(status, 422);
        assert_eq!(duplicate["diagnostics"][0]["code"], "duplicate-id");

        // A linked passage cannot be removed; the note can, then the passage.
        let (status, linked) = notebook_call(
            &f,
            &session,
            "DELETE",
            "/admin/api/research/passages",
            json!({"revision": updated["revision"], "id": "p1"}),
        );
        assert_eq!(status, 422);
        assert_eq!(linked["diagnostics"][0]["code"], "still-linked");
        let (status, gone) = notebook_call(
            &f,
            &session,
            "DELETE",
            "/admin/api/research/notes",
            json!({"revision": updated["revision"], "id": "n1"}),
        );
        assert_eq!(status, 200, "{gone}");
        let (status, _) = notebook_call(
            &f,
            &session,
            "DELETE",
            "/admin/api/research/passages",
            json!({"revision": gone["revision"], "id": "p1"}),
        );
        assert_eq!(status, 200);
        assert_eq!(notebook(&f, &session)["passages"], json!([]));
    }

    #[test]
    fn research_notebook_failures_are_scoped_and_leave_the_file_unchanged() {
        let f = fixture_with_sources("notebook-api-failures");
        let session = login_ok(&f);
        let empty = notebook(&f, &session);
        let revision = empty["revision"].clone();
        let long = "ὁ".repeat(20_001);
        let cases = [
            (
                "/admin/api/research/passages",
                json!({"revision": revision, "passage": {"id": "p1", "source": "absent", "excerpt": {"text": "x"}}}),
                "unknown-source",
            ),
            (
                "/admin/api/research/passages",
                json!({"revision": revision, "passage": {"id": "p1", "excerpt": {"text": "x"}}}),
                "missing-field",
            ),
            (
                "/admin/api/research/passages",
                json!({"revision": revision, "passage": {"id": "p1", "source": "plato", "excerpt": {"text": "x"}, "locators": [{"kind": "page", "value": "1"}]}}),
                "ambiguous-locator",
            ),
            (
                "/admin/api/research/passages",
                json!({"revision": revision, "passage": {"id": "p1", "source": "slings", "excerpt": {"text": long}}}),
                "too-large",
            ),
            (
                "/admin/api/research/notes",
                json!({"revision": revision, "note": {"id": "n1", "kind": "question", "text": "x", "visibility": "public"}}),
                "not-private",
            ),
            (
                "/admin/api/research/notes",
                json!({"revision": revision, "note": {"id": "n1", "kind": "question", "text": "x", "sources": ["absent"]}}),
                "unknown-source",
            ),
        ];
        for (path, body, code) in cases {
            let (status, response) = notebook_call(&f, &session, "POST", path, body);
            assert_eq!(status, 422, "{code}: {response}");
            assert_eq!(response["diagnostics"][0]["code"], code, "{response}");
            assert_eq!(response["file"], crate::notebook_store::NOTEBOOK_FILE);
            assert!(stored_notebook(&f).is_none(), "{code} wrote a notebook");
            assert!(
                !f.dir
                    .join(".openblog/private/research/notebook.json.lock")
                    .exists(),
                "{code} left a lock"
            );
        }
        let (status, unknown) = notebook_call(
            &f,
            &session,
            "PUT",
            "/admin/api/research/notes",
            json!({"revision": revision, "note": {"id": "ghost", "kind": "question", "text": "x"}}),
        );
        assert_eq!(status, 422);
        assert_eq!(unknown["diagnostics"][0]["code"], "unknown-entry");
        let (status, _) = notebook_call(
            &f,
            &session,
            "DELETE",
            "/admin/api/research/notes",
            json!({"revision": revision, "id": "ghost"}),
        );
        assert_eq!(status, 422);

        // The diagnostic never repeats the quoted text.
        let secret = "ob-excerpt-secret-5521";
        let (_, scoped) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": revision, "passage": {"id": "p1", "source": "absent", "excerpt": {"text": secret}}}),
        );
        assert!(!scoped.to_string().contains(secret));

        // Oversize and malformed requests.
        let (status, _) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": revision, "note": {"id": "n1", "kind": "question", "text": "x".repeat(MAX_NOTEBOOK_REQUEST_BYTES)}}),
        );
        assert_eq!(status, 413);
        let mut plain = authed(req("POST", "/admin/api/research/notes"), &session, true);
        plain.body = b"{}".to_vec();
        assert_eq!(handle(&f.state, &plain).status, 415);
        assert!(stored_notebook(&f).is_none());

        // A damaged notebook is reported with its path and never replaced.
        let path = f.dir.join(crate::notebook_store::NOTEBOOK_FILE);
        fs::write(&path, "{\"version\":1,\"notes\":[").unwrap();
        let damaged = handle(
            &f.state,
            &authed(req("GET", "/admin/api/research/notebook"), &session, false),
        );
        assert_eq!(damaged.status, 422);
        assert_eq!(
            body_json(&damaged)["file"],
            crate::notebook_store::NOTEBOOK_FILE
        );
        let (status, _) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": revision, "note": {"id": "n1", "kind": "question", "text": "x"}}),
        );
        assert_ne!(status, 201);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"version\":1,\"notes\":["
        );
    }

    #[test]
    fn a_stale_source_fails_the_save_and_leaves_the_notebook_unchanged() {
        let f = fixture_with_sources("notebook-api-stale-source");
        let session = login_ok(&f);
        let empty = notebook(&f, &session);
        let (status, saved) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": {"id": "p1", "source": "slings", "excerpt": {"text": "x"}}}),
        );
        assert_eq!(status, 201, "{saved}");
        let before = stored_notebook(&f).unwrap();
        // The library loses a source by a hand edit after the page loaded.
        let library = f.dir.join(crate::source_store::LIBRARY_FILE);
        fs::write(
            &library,
            r#"{"version":1,"sources":[{"id":"plato","kind":"work","title":"Politeia"}]}"#,
        )
        .unwrap();
        let (status, stale) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": saved["revision"], "note": {"id": "n1", "kind": "question", "text": "x", "sources": ["plato"]}}),
        );
        assert_eq!(status, 422, "{stale}");
        assert_eq!(stale["diagnostics"][0]["code"], "unknown-source");
        assert_eq!(stale["diagnostics"][0]["id"], "p1");
        assert_eq!(stored_notebook(&f).unwrap(), before);
    }

    #[test]
    fn research_notebook_never_reaches_public_output_or_exports() {
        const MARKER: &str = "ob-private-notebook-api-77e3";
        let f = fixture_with_sources("notebook-api-private");
        let snapshot = |f: &Fixture| {
            let mut files = crate::fsutil::walk(&f.dir.join("content"));
            files.push(f.dir.join("openblog.json"));
            files
                .into_iter()
                .map(|file| (file.clone(), fs::read(file).unwrap()))
                .collect::<Vec<_>>()
        };
        let content_before = snapshot(&f);
        let session = login_ok(&f);
        let empty = notebook(&f, &session);
        let (status, saved) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/passages",
            json!({"revision": empty["revision"], "passage": {"id": "p1", "source": "slings",
                "excerpt": {"text": format!("{MARKER} quoted")},
                "locators": [{"kind": "page", "value": MARKER}]}}),
        );
        assert_eq!(status, 201, "{saved}");
        let (status, saved) = notebook_call(
            &f,
            &session,
            "POST",
            "/admin/api/research/notes",
            json!({"revision": saved["revision"], "note": {"id": "n1", "kind": "observation",
                "text": format!("{MARKER} noted"), "passages": ["p1"], "concepts": ["marker-concept"]}}),
        );
        assert_eq!(status, 201, "{saved}");

        // The source library and its exports know nothing of the notebook.
        let library = fs::read_to_string(f.dir.join(crate::source_store::LIBRARY_FILE)).unwrap();
        assert!(!library.contains(MARKER));
        for format in ["csl-json", "bibtex"] {
            let response = handle(
                &f.state,
                &authed(
                    req("GET", &format!("/admin/api/sources/export?format={format}")),
                    &session,
                    false,
                ),
            );
            assert_eq!(response.status, 200);
            assert!(!String::from_utf8_lossy(&response.body).contains(MARKER));
        }
        // Source mode and the content tree are untouched.
        assert!(content_before == snapshot(&f), "notebook changed content");

        f.state.rebuild().unwrap();
        for file in crate::fsutil::walk(&f.dir.join("dist")) {
            let bytes = fs::read(&file).unwrap();
            assert!(
                !String::from_utf8_lossy(&bytes).contains(MARKER),
                "{} exposes the private research notebook",
                file.display()
            );
        }
        let response = handle(
            &f.state,
            &authed(req("GET", "/admin/api/research/notebook"), &session, false),
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
            Duration::from_secs(10)
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        provider.join().unwrap();
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
        let _env = quiz_env();
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
        assert_eq!(
            invalid.status,
            502,
            "{}",
            String::from_utf8_lossy(&invalid.body)
        );
        server.join().unwrap();
        assert!(String::from_utf8_lossy(&invalid.body).contains("invalid-result"));
        assert!(!String::from_utf8_lossy(&invalid.body).contains("completion-secret"));
    }

    #[test]
    fn inline_completion_obeys_the_shared_assistant_concurrency_limit() {
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        provider.join().unwrap();
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
        let _env = quiz_env();
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
        let _env = quiz_env();
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
        assert_eq!(
            response.status,
            502,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        provider.join().unwrap();
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
    fn a_citation_problem_elsewhere_or_in_a_draft_never_blocks_a_preview_or_a_draft_save() {
        let f = fixture("citation-scope");
        fs::write(
            f.dir.join("content/posts/broken.md"),
            "---\ntitle: Broken\ndate: 2026-10-01\ncitations: notes\n---\nA claim [@nobody].\n",
        )
        .unwrap();
        let session = login_ok(&f);
        let send = |method: &str, route: &str, body: Json| {
            handle(
                &f.state,
                &authed(json_req(method, route, body), &session, true),
            )
        };
        let draft = json!({
            "kind": "posts",
            "path": "posts/not-yet.md",
            "fields": { "title": "Not yet", "date": "2026-10-23", "draft": "true", "citations": "notes" },
            "body": "Soon [@not-yet]."
        });
        let preview = send("POST", "/admin/api/preview", draft.clone());
        assert_eq!(
            preview.status,
            200,
            "{}",
            String::from_utf8_lossy(&preview.body)
        );
        // The draft's citations are not published, yet the preview says the
        // post opted in, so Evidence Studio stays active for its findings.
        let body: Json = serde_json::from_slice(&preview.body).unwrap();
        assert_eq!(body["citations"], Json::Null);
        assert_eq!(body["citationsOptedIn"], true);
        let saved = send("POST", "/admin/api/document", draft);
        assert_eq!(
            saved.status,
            201,
            "{}",
            String::from_utf8_lossy(&saved.body)
        );

        // The broken post's own preview names its problem and nothing else.
        let own = send(
            "POST",
            "/admin/api/preview",
            json!({
                "kind": "posts",
                "path": "posts/broken.md",
                "fields": { "title": "Broken", "date": "2026-10-01", "citations": "notes" },
                "body": "A claim [@nobody]."
            }),
        );
        assert_eq!(own.status, 422);
        let message = String::from_utf8_lossy(&own.body);
        assert!(
            message.contains("posts/broken.md: line 7: this post cites sources")
                && !message.contains("not-yet"),
            "{message}"
        );
    }

    #[test]
    fn preview_reports_citation_checks_and_offers_public_bibliography_exports() {
        let f = fixture("citation-preview");
        let library = f.dir.join(source_store::LIBRARY_FILE);
        fs::create_dir_all(library.parent().unwrap()).unwrap();
        fs::write(
            &library,
            r#"{"version":1,"sources":[
              {"id":"bare","kind":"work","title":"Bare","csl":{"type":"article-journal"},"secret":"PRIVATE-PREVIEW"},
              {"id":"other","kind":"work","title":"PRIVATE-PREVIEW uncited"}]}"#,
        )
        .unwrap();
        let before = fs::read(&library).unwrap();
        let session = login_ok(&f);
        let preview = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/preview",
                    json!({
                        "kind": "posts",
                        "path": "posts/cited.md",
                        "fields": { "title": "Cited", "date": "2026-10-23", "citations": "notes" },
                        "body": "A claim [@bare, canonical 4]."
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
        let body = body_json(&preview);
        let citations = &body["citations"];
        assert_eq!(citations["style"], "notes");
        assert_eq!(citations["citations"], 1);
        assert_eq!(citations["references"], 1);
        assert_eq!(citations["offline"], true);
        let csl = &citations["exports"]["csl-json"];
        assert_eq!(csl["filename"], "cited-references.json");
        assert!(csl["content"]
            .as_str()
            .unwrap()
            .contains("\"id\": \"bare\""));
        let bibtex = &citations["exports"]["bibtex"];
        assert_eq!(bibtex["filename"], "cited-references.bib");
        assert!(bibtex["content"]
            .as_str()
            .unwrap()
            .starts_with("@article{bare,"));
        assert!(!body.to_string().contains("PRIVATE-PREVIEW"));
        let codes: Vec<&str> = body["evidence"]
            .as_array()
            .unwrap()
            .iter()
            .map(|finding| finding["code"].as_str().unwrap())
            .collect();
        assert!(
            codes.contains(&"citation-reference-incomplete"),
            "{codes:?}"
        );
        assert!(codes.contains(&"citation-location-review"), "{codes:?}");
        // A preview writes nothing.
        assert_eq!(fs::read(&library).unwrap(), before);
        assert!(!f.dir.join("content/posts/cited.md").exists());
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
        let _env = quiz_env();
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
            // Only the timeout case gives up before its slow provider answers.
            let timeout = if delay.is_zero() {
                Duration::from_secs(10)
            } else {
                Duration::from_millis(300)
            };
            TEST_PROVIDER_TIMEOUT.with(|limit| limit.set(timeout));
            let (endpoint, server) = quiz_provider(status, body, delay);
            set_quiz_endpoint(&f, &endpoint);
            let response = handle(&f.state, &request());
            TEST_PROVIDER_TIMEOUT.with(|limit| limit.set(Duration::from_secs(10)));
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
        assert_eq!(
            response.status,
            200,
            "{}",
            String::from_utf8_lossy(&response.body)
        );
        server.join().unwrap();
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

    #[test]
    fn a_previewed_part_of_a_collaborative_series_can_be_acknowledged() {
        let f = fixture("portability-series-ack");
        let config_path = f.dir.join("openblog.json");
        let mut config: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["contributors"] = json!({ "ann": { "name": "Ann" }, "bo": { "name": "Bo" } });
        fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
        let content = f.dir.join("content");
        fs::create_dir_all(content.join("series")).unwrap();
        fs::write(
            content.join("series/letters.md"),
            "---
name: Letters
---
A recurring premise.
",
        )
        .unwrap();
        let quiz = "```quiz
What is portable?
- [ ] A second source
- [x] A derived view
```
";
        let parts = [
            ("posts/letters-one.md", "One", "2020-01-01"),
            ("posts/letters-two.md", "Two", "2020-02-01"),
            // Scheduled: previewing it holds it as a post, but it is not a part yet.
            ("posts/letters-later.md", "Later", "2999-01-01"),
        ];
        for (path, title, date) in parts {
            fs::write(
                content.join(path),
                format!(
                    "---
title: {title}
date: {date}
series: letters
---

{quiz}"
                ),
            )
            .unwrap();
        }
        fs::write(
            content.join("posts/letters-one.credits.json"),
            r#"{"version":1,"credits":[{"contributor":"ann","roles":[{"vocabulary":"crossref","role":"author"}]},{"contributor":"bo","roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
        )
        .unwrap();
        f.state.rebuild().unwrap();
        let session = login_ok(&f);

        for (path, title, date) in parts {
            let preview = handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/preview",
                        json!({
                            "kind": "posts",
                            "path": path,
                            "fields": { "title": title, "date": date, "series": "letters" },
                            "body": quiz,
                        }),
                    ),
                    &session,
                    true,
                ),
            );
            assert_eq!(
                preview.status,
                200,
                "{path}: {}",
                String::from_utf8_lossy(&preview.body)
            );
            let portable = body_json(&preview)["portablePreview"].clone();
            let markdown = portable["markdown"].as_str().unwrap();
            if path == "posts/letters-later.md" {
                assert!(!markdown.contains("## Series"), "{path}: {markdown}");
            } else {
                assert!(
                    markdown.contains("in the series [Letters]("),
                    "{path}: {markdown}"
                );
            }
            let acknowledged = handle(
                &f.state,
                &authed(
                    json_req(
                        "POST",
                        "/admin/api/portability/acknowledge",
                        json!({
                            "path": path,
                            "sourceRevision": portable["sourceRevision"],
                            "capabilityId": "knowledge-check",
                            "representation": "portable-markdown",
                            "destination": "portable-export",
                            "expectedEtag": portable["acknowledgementEtag"],
                        }),
                    ),
                    &session,
                    true,
                ),
            );
            assert_eq!(
                acknowledged.status,
                200,
                "{path}: {}",
                String::from_utf8_lossy(&acknowledged.body)
            );
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

    // ---- shared publications

    fn register_contributors(f: &Fixture, contributors: Json) {
        let path = f.dir.join("openblog.json");
        let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        config["contributors"] = contributors;
        fs::write(path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
    }

    fn login_as(f: &Fixture, username: &str, password: &str) -> (String, String) {
        let resp = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/login",
                json!({ "username": username, "password": password }),
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
        (
            cookie.split(';').next().unwrap().to_string(),
            body_json(&resp)["csrf"].as_str().unwrap().to_string(),
        )
    }

    fn add_admin_user(f: &Fixture, username: &str, password: &str) {
        let path = f.dir.join(".openblog/users.json");
        let mut users = Users::load(&path).unwrap();
        users.set(username, password).unwrap();
        users.save(&path).unwrap();
    }

    /// Every file under `dir` with its bytes, so a test can prove nothing changed.
    fn tree_snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(dir: &Path, base: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    visit(&path, base, out);
                } else {
                    out.insert(
                        path.strip_prefix(base).unwrap().to_path_buf(),
                        fs::read(&path).unwrap(),
                    );
                }
            }
        }
        let mut out = BTreeMap::new();
        visit(dir, dir, &mut out);
        out
    }

    fn tree_contains(dir: &Path, needle: &str) -> Vec<PathBuf> {
        tree_snapshot(dir)
            .into_iter()
            .filter(|(_, bytes)| String::from_utf8_lossy(bytes).contains(needle))
            .map(|(path, _)| path)
            .collect()
    }

    fn create_shared(f: &Fixture, session: &(String, String), body: Json) -> Response {
        handle(
            &f.state,
            &authed(
                json_req("POST", "/admin/api/collaboration/publications", body),
                session,
                true,
            ),
        )
    }

    #[test]
    fn source_metadata_lookup_needs_a_session_and_never_fetches_unsupported_links() {
        let f = fixture("shared-metadata");
        let session = login_ok(&f);
        let path = "/admin/api/collaboration/publications/source-metadata";
        let anonymous = handle(
            &f.state,
            &json_req("POST", path, json!({ "url": "https://example.com" })),
        );
        assert_eq!(anonymous.status, 401);
        let no_csrf = handle(
            &f.state,
            &authed(
                json_req("POST", path, json!({ "url": "https://example.com" })),
                &session,
                false,
            ),
        );
        assert_eq!(no_csrf.status, 403);
        for url in [
            "https://example.com/a",
            "http://127.0.0.1/admin",
            "javascript:alert(1)",
            "",
        ] {
            let resp = handle(
                &f.state,
                &authed(
                    json_req("POST", path, json!({ "url": url })),
                    &session,
                    true,
                ),
            );
            assert_eq!(resp.status, 200, "{url}");
            assert_eq!(
                body_json(&resp),
                json!({ "status": "unsupported" }),
                "{url}"
            );
        }
        let too_long = handle(
            &f.state,
            &authed(
                json_req("POST", path, json!({ "url": "h".repeat(5000) })),
                &session,
                true,
            ),
        );
        assert_eq!(body_json(&too_long), json!({ "status": "unsupported" }));
        for bad in [json!({}), json!({ "url": "x", "extra": 1 })] {
            let resp = handle(
                &f.state,
                &authed(json_req("POST", path, bad), &session, true),
            );
            assert_eq!(resp.status, 400);
        }
        assert!(shared_records(&f).is_empty());
    }

    fn list_shared(f: &Fixture, session: &(String, String)) -> Json {
        let resp = handle(
            &f.state,
            &authed(
                req("GET", "/admin/api/collaboration/publications"),
                session,
                false,
            ),
        );
        assert_eq!(resp.status, 200, "{}", String::from_utf8_lossy(&resp.body));
        body_json(&resp)
    }

    fn shared_records(f: &Fixture) -> Vec<String> {
        let mut names = fs::read_dir(f.dir.join(crate::shared_publications::DIRECTORY))
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn reflection_request() -> Json {
        json!({
            "title": "Marker title 7f3c: on attention",
            "guidingQuestion": "Marker question 7f3c: what changed?",
            "contributorId": "mikey-writer",
            "sources": [
                {
                    "kind": "video",
                    "title": "Marker video 7f3c",
                    "url": "https://www.youtube.com/watch?v=marker7f3c",
                    "creator": "A channel"
                },
                {
                    "kind": "book",
                    "title": "Über das Zuhören — 聴く",
                    "creator": "Ada Lovelace",
                    "publisher": "Marker press 7f3c",
                    "published": "1843",
                    "isbn": "978-0-14-143954-9"
                },
                { "kind": "other", "title": "A conversation without a link" }
            ]
        })
    }

    #[test]
    fn shared_reflection_creation_is_private_and_leaves_canonical_content_unchanged() {
        let f = fixture("shared-create");
        register_contributors(
            &f,
            json!({ "mikey-writer": { "name": "Mikey 🌊" }, "grace": { "name": "Grace" } }),
        );
        let session = login_ok(&f);
        let content_before = tree_snapshot(&f.dir.join("content"));

        let no_csrf = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/collaboration/publications",
                    reflection_request(),
                ),
                &session,
                false,
            ),
        );
        assert_eq!(no_csrf.status, 403);
        assert!(shared_records(&f).is_empty());

        let resp = create_shared(&f, &session, reflection_request());
        assert_eq!(resp.status, 201, "{}", String::from_utf8_lossy(&resp.body));
        let created = body_json(&resp)["publication"].clone();
        let id = created["publicationId"].as_str().unwrap().to_string();
        assert!(id.starts_with("shared-"));
        assert_eq!(created["title"], "Marker title 7f3c: on attention");
        assert_eq!(
            created["guidingQuestion"],
            "Marker question 7f3c: what changed?"
        );
        assert_eq!(created["roles"], json!(["siteOwner", "contributor"]));
        let sources = created["sources"].as_array().unwrap();
        assert_eq!(
            sources
                .iter()
                .map(|source| source["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["source-1", "source-2", "source-3"]
        );
        assert_eq!(sources[1]["title"], "Über das Zuhören — 聴く");
        assert_eq!(sources[1]["isbn"], "978-0-14-143954-9");
        assert!(sources[2].get("url").is_none());
        // Bindings, participants, and Admin usernames stay on the server.
        let text = created.to_string();
        for private in [
            "mikey",
            "adminUser",
            "bindings",
            "participant-1",
            "authorization",
        ] {
            assert!(!text.contains(private), "{private} leaked into {text}");
        }

        assert_eq!(shared_records(&f), [format!("{id}.json")]);
        let stored = openblog_core::collaboration::SharedPublication::from_json(
            &fs::read_to_string(
                f.dir
                    .join(crate::shared_publications::DIRECTORY)
                    .join(format!("{id}.json")),
            )
            .unwrap(),
        )
        .unwrap();
        let binding = &stored.authorization.bindings[0];
        assert_eq!(binding.admin_user, "mikey");
        assert_eq!(binding.contributor_id, "mikey-writer");
        assert_eq!(
            stored.collaboration.participants[0].display_name,
            "Mikey 🌊"
        );

        // Nothing canonical changed, and a full build publishes none of it.
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
        f.state.rebuild().unwrap();
        let dist = f.dir.join("dist");
        for marker in [
            "7f3c",
            id.as_str(),
            "Zuhören",
            "mikey-writer",
            "participant-1",
        ] {
            assert!(
                tree_contains(&dist, marker).is_empty(),
                "{marker} reached generated output"
            );
        }

        let listed = list_shared(&f, &session);
        assert_eq!(listed["publications"], json!([created]));
    }

    #[test]
    fn shared_reflection_requests_fail_safely_without_writing_or_echoing_input() {
        let f = fixture("shared-reject");
        register_contributors(&f, json!({ "mikey-writer": { "name": "Mikey" } }));
        let session = login_ok(&f);
        let content_before = tree_snapshot(&f.dir.join("content"));

        let with = |change: &dyn Fn(&mut Json)| {
            let mut body = reflection_request();
            change(&mut body);
            create_shared(&f, &session, body)
        };
        let cases: Vec<(&str, Response, &str)> = vec![
            (
                "javascript link",
                with(&|body| body["sources"][0]["url"] = json!("javascript:alert('7f3c')")),
                "sources.0.url",
            ),
            (
                "credential link",
                with(&|body| body["sources"][1]["url"] = json!("https://user:7f3c@example.org/")),
                "sources.1.url",
            ),
            (
                "data link",
                with(&|body| body["sources"][2]["url"] = json!("data:text/html,7f3c")),
                "sources.2.url",
            ),
            (
                "no title or question",
                with(&|body| {
                    body["title"] = json!(" ");
                    body["guidingQuestion"] = json!("");
                }),
                "title",
            ),
            (
                "no sources",
                with(&|body| body["sources"] = json!([])),
                "sources",
            ),
            (
                "blank source title",
                with(&|body| body["sources"][0]["title"] = json!("\u{200B}")),
                "sources.0.title",
            ),
            (
                "isbn on a video",
                with(&|body| body["sources"][0]["isbn"] = json!("0-86547-454-X")),
                "sources.0.isbn",
            ),
            (
                "unregistered contributor",
                with(&|body| body["contributorId"] = json!("grace-7f3c")),
                "contributorId",
            ),
            (
                "spoofed admin user",
                with(&|body| body["adminUser"] = json!("grace-7f3c")),
                "",
            ),
            (
                "spoofed participant",
                with(&|body| body["participants"] = json!([{ "id": "p-7f3c" }])),
                "",
            ),
            (
                "unknown source kind",
                with(&|body| body["sources"][0]["kind"] = json!("tweet-7f3c")),
                "",
            ),
        ];
        for (name, resp, field) in cases {
            assert_eq!(
                resp.status,
                422,
                "{name}: {}",
                String::from_utf8_lossy(&resp.body)
            );
            let body = String::from_utf8_lossy(&resp.body).into_owned();
            assert!(!body.contains("7f3c"), "{name} echoed input: {body}");
            if !field.is_empty() {
                assert_eq!(body_json(&resp)["field"], field, "{name}");
            }
        }

        let mut plain = authed(
            req("POST", "/admin/api/collaboration/publications"),
            &session,
            true,
        );
        plain.body = reflection_request().to_string().into_bytes();
        assert_eq!(handle(&f.state, &plain).status, 415);

        assert!(shared_records(&f).is_empty());
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
    }

    #[test]
    fn shared_reflections_are_listed_only_to_their_bound_participants() {
        let f = fixture("shared-list");
        register_contributors(
            &f,
            json!({ "mikey-writer": { "name": "Mikey" }, "grace": { "name": "Grace" } }),
        );
        add_admin_user(&f, "grace", "another correct horse");
        let mikey = login_ok(&f);
        let grace = login_as(&f, "grace", "another correct horse");

        let resp = create_shared(&f, &mikey, reflection_request());
        assert_eq!(resp.status, 201);
        assert_eq!(list_shared(&f, &grace)["publications"], json!([]));

        let mut theirs = reflection_request();
        theirs["title"] = json!("Grace's reflection");
        theirs["contributorId"] = json!("grace");
        assert_eq!(create_shared(&f, &grace, theirs).status, 201);
        let mine = list_shared(&f, &mikey)["publications"].clone();
        assert_eq!(mine.as_array().unwrap().len(), 1);
        assert_eq!(mine[0]["title"], "Marker title 7f3c: on attention");
        let hers = list_shared(&f, &grace)["publications"].clone();
        assert_eq!(hers.as_array().unwrap().len(), 1);
        assert_eq!(hers[0]["title"], "Grace's reflection");

        // A removed registry key stops the binding at once, even before anyone cleans it up.
        register_contributors(&f, json!({ "grace": { "name": "Grace" } }));
        assert_eq!(list_shared(&f, &mikey)["publications"], json!([]));

        assert_eq!(
            handle(
                &f.state,
                &req("GET", "/admin/api/collaboration/publications")
            )
            .status,
            401
        );
    }

    #[test]
    fn contributors_bound_to_a_shared_reflection_cannot_be_removed() {
        let f = fixture("shared-registry");
        register_contributors(
            &f,
            json!({ "mikey-writer": { "name": "Mikey" }, "grace": { "name": "Grace" } }),
        );
        let session = login_ok(&f);
        assert_eq!(
            create_shared(&f, &session, reflection_request()).status,
            201
        );
        let registry = body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/contributors"), &session, false),
        ));
        let etag = registry["etag"].as_str().unwrap();

        let refused = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({ "etag": etag, "contributors": { "grace": { "name": "Grace" } } }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(refused.status, 422);
        assert!(body_json(&refused)["error"]
            .as_str()
            .unwrap()
            .contains("shared"));
        assert_eq!(body_json(&refused)["contributors"], json!(["mikey-writer"]));

        let unbound_removed = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/contributors",
                    json!({ "etag": etag, "contributors": { "mikey-writer": { "name": "Mikey" } } }),
                ),
                &session,
                true,
            ),
        );
        assert_eq!(
            unbound_removed.status,
            200,
            "{}",
            String::from_utf8_lossy(&unbound_removed.body)
        );
    }
    // ---- shared publication invitations

    fn post_api(f: &Fixture, session: &(String, String), path: &str, body: Json) -> Response {
        handle(
            &f.state,
            &authed(
                json_req("POST", &format!("/admin/api/collaboration/{path}"), body),
                session,
                true,
            ),
        )
    }

    /// An owner (mikey), two invitable accounts (grace, linus), and one shared reflection.
    fn invitation_fixture(tag: &str) -> (Fixture, (String, String), String) {
        let f = fixture(tag);
        register_contributors(
            &f,
            json!({
                "mikey-writer": { "name": "Mikey" },
                "grace": { "name": "Grace" },
                "linus": { "name": "Linus" },
                "ada": { "name": "Ada" }
            }),
        );
        add_admin_user(&f, "grace", "another correct horse");
        add_admin_user(&f, "linus", "yet another horse");
        add_admin_user(&f, "ada", "a fourth correct horse");
        let mikey = login_ok(&f);
        let created = create_shared(&f, &mikey, reflection_request());
        let id = body_json(&created)["publication"]["publicationId"]
            .as_str()
            .unwrap()
            .to_string();
        (f, mikey, id)
    }

    fn invite_body(id: &str, user: &str, key: &str, roles: Json) -> Json {
        json!({ "publicationId": id, "adminUser": user, "contributorId": key, "roles": roles })
    }

    fn stored_record(f: &Fixture, id: &str) -> SharedPublication {
        let path = f
            .dir
            .join(crate::shared_publications::DIRECTORY)
            .join(format!("{id}.json"));
        SharedPublication::from_json(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn an_invitation_is_issued_once_stored_hashed_and_accepted_by_the_named_account_only() {
        let (f, mikey, id) = invitation_fixture("invite-lifecycle");
        let grace = login_as(&f, "grace", "another correct horse");
        let linus = login_as(&f, "linus", "yet another horse");
        let content_before = tree_snapshot(&f.dir.join("content"));

        let issued = post_api(
            &f,
            &mikey,
            "invitations",
            invite_body(&id, "grace", "grace", json!(["contributor"])),
        );
        assert_eq!(
            issued.status,
            201,
            "{}",
            String::from_utf8_lossy(&issued.body)
        );
        assert!(issued
            .headers
            .iter()
            .any(|(k, v)| k == "Cache-Control" && v == "no-store"));
        let issued = body_json(&issued);
        let token = issued["token"].as_str().unwrap().to_string();
        let secret = token.split_once('.').unwrap().1.to_string();
        assert!(token.starts_with(&id));
        assert_eq!(issued["link"], format!("/admin/#/shared/accept/{token}"));
        assert_eq!(issued["invitation"]["state"], "pending");
        // Neither the token nor its secret is on disk, and no content or email-like effect.
        assert!(tree_contains(&f.dir, &secret).is_empty());
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);

        let listed = handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/invitations?publicationId={id}"),
                ),
                &mikey,
                false,
            ),
        );
        let listed = body_json(&listed);
        assert_eq!(listed["invitations"].as_array().unwrap().len(), 1);
        assert!(!listed.to_string().contains(&secret));
        assert!(!listed.to_string().contains("tokenHash"));

        let accept = |session: &(String, String), key: &str| {
            post_api(
                &f,
                session,
                "invitations/accept",
                json!({ "token": token, "contributorId": key }),
            )
        };
        // The wrong account and the wrong key are refused and consume nothing.
        assert_eq!(accept(&linus, "grace").status, 400);
        assert_eq!(accept(&grace, "linus").status, 400);
        assert_eq!(accept(&mikey, "grace").status, 400);
        assert_eq!(list_shared(&f, &grace)["publications"], json!([]));
        assert_eq!(stored_record(&f, &id).authorization.bindings.len(), 1);

        let accepted = accept(&grace, "grace");
        assert_eq!(
            accepted.status,
            200,
            "{}",
            String::from_utf8_lossy(&accepted.body)
        );
        assert_eq!(
            body_json(&accepted)["publication"]["roles"],
            json!(["contributor"])
        );
        let record = stored_record(&f, &id);
        let binding = record.authorization.bindings.last().unwrap();
        assert_eq!(binding.admin_user, "grace");
        assert_eq!(binding.contributor_id, "grace");
        assert_eq!(
            record
                .collaboration
                .participants
                .last()
                .unwrap()
                .display_name,
            "Grace"
        );
        assert_eq!(
            list_shared(&f, &grace)["publications"][0]["publicationId"],
            json!(id)
        );
        // Replay fails, a contributor cannot invite, and the content never changed.
        assert_eq!(accept(&grace, "grace").status, 400);
        assert_eq!(
            post_api(
                &f,
                &grace,
                "invitations",
                invite_body(&id, "linus", "linus", json!(["reader"])),
            )
            .status,
            404
        );
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
    }

    #[test]
    fn invitation_requests_need_a_session_and_csrf_and_fail_without_changing_anything() {
        let (f, mikey, id) = invitation_fixture("invite-reject");
        let before = tree_snapshot(&f.dir.join(".openblog/private"));
        let path = "/admin/api/collaboration/invitations";
        let body = invite_body(&id, "grace", "grace", json!(["reader"]));
        assert_eq!(
            handle(&f.state, &json_req("POST", path, body.clone())).status,
            401
        );
        let no_csrf = handle(
            &f.state,
            &authed(json_req("POST", path, body.clone()), &mikey, false),
        );
        assert_eq!(no_csrf.status, 403);

        let not_found = post_api(
            &f,
            &mikey,
            "invitations",
            invite_body("shared-ffffffffffff", "grace", "grace", json!(["reader"])),
        );
        assert_eq!(not_found.status, 404);
        for (bad, status) in [
            (invite_body(&id, "ghost", "grace", json!(["reader"])), 422),
            (invite_body(&id, "grace", "ghost", json!(["reader"])), 422),
            (invite_body(&id, "mikey", "linus", json!(["reader"])), 422),
            (invite_body(&id, "grace", "grace", json!([])), 422),
            (
                invite_body(&id, "grace", "grace", json!(["reader", "reader"])),
                422,
            ),
            (invite_body(&id, "grace", "grace", json!(["admin"])), 422),
            (
                json!({ "publicationId": id, "adminUser": "grace", "contributorId": "grace",
                        "roles": ["reader"], "token": "x" }),
                422,
            ),
            (
                json!({ "publicationId": id, "adminUser": "grace", "contributorId": "grace",
                        "roles": ["reader"], "lifetimeDays": 31 }),
                422,
            ),
        ] {
            let resp = post_api(&f, &mikey, "invitations", bad.clone());
            assert_eq!(
                resp.status,
                status,
                "{bad}: {}",
                String::from_utf8_lossy(&resp.body)
            );
        }
        let wrong_type = handle(
            &f.state,
            &authed(
                {
                    let mut r = json_req("POST", path, body);
                    r.headers.insert("content-type".into(), "text/plain".into());
                    r
                },
                &mikey,
                true,
            ),
        );
        assert_eq!(wrong_type.status, 415);
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), before);
        assert!(stored_record(&f, &id).invitations.is_empty());
    }

    #[test]
    fn revoked_expired_declined_and_reissued_invitations_stop_working() {
        let (f, mikey, id) = invitation_fixture("invite-states");
        let grace = login_as(&f, "grace", "another correct horse");
        let issue = |session: &(String, String)| {
            let resp = post_api(
                &f,
                session,
                "invitations",
                invite_body(&id, "grace", "grace", json!(["editor"])),
            );
            assert_eq!(resp.status, 201);
            body_json(&resp)
        };
        let accept = |token: &str| {
            post_api(
                &f,
                &grace,
                "invitations/accept",
                json!({ "token": token, "contributorId": "grace" }),
            )
            .status
        };

        let first = issue(&mikey);
        let first_id = first["invitation"]["id"].as_str().unwrap().to_string();
        let first_token = first["token"].as_str().unwrap().to_string();
        let revoked = post_api(
            &f,
            &mikey,
            "invitations/revoke",
            json!({ "publicationId": id, "invitationId": first_id }),
        );
        assert_eq!(revoked.status, 200);
        assert_eq!(body_json(&revoked)["invitation"]["state"], "revoked");
        assert_eq!(accept(&first_token), 400);

        let second = issue(&mikey);
        let reissued = post_api(
            &f,
            &mikey,
            "invitations/reissue",
            json!({ "publicationId": id,
                    "invitationId": second["invitation"]["id"], "lifetimeDays": 2 }),
        );
        assert_eq!(reissued.status, 201);
        let reissued = body_json(&reissued);
        assert_eq!(accept(second["token"].as_str().unwrap()), 400);
        let expires = reissued["invitation"]["expiresAt"].as_i64().unwrap();
        let created = reissued["invitation"]["createdAt"].as_i64().unwrap();
        assert_eq!(expires - created, 2 * 86_400);

        // Age the stored invitation past its expiry: the token is refused and can be reissued.
        let path = f
            .dir
            .join(crate::shared_publications::DIRECTORY)
            .join(format!("{id}.json"));
        let mut stored: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for invitation in stored["invitations"].as_array_mut().unwrap() {
            if invitation["state"] == "pending" {
                invitation["createdAt"] = json!(1_000);
                invitation["expiresAt"] = json!(2_000);
            }
        }
        fs::write(&path, serde_json::to_string_pretty(&stored).unwrap()).unwrap();
        assert_eq!(accept(reissued["token"].as_str().unwrap()), 400);
        let third = post_api(
            &f,
            &mikey,
            "invitations/reissue",
            json!({ "publicationId": id, "invitationId": reissued["invitation"]["id"] }),
        );
        assert_eq!(third.status, 201);
        let third = body_json(&third);
        let declined = post_api(
            &f,
            &grace,
            "invitations/decline",
            json!({ "token": third["token"] }),
        );
        assert_eq!(declined.status, 200);
        assert_eq!(accept(third["token"].as_str().unwrap()), 400);
        assert_eq!(stored_record(&f, &id).authorization.bindings.len(), 1);
    }

    #[test]
    fn guessing_tokens_is_bounded_per_account_and_a_coordinator_cannot_grant_ownership() {
        let (f, mikey, id) = invitation_fixture("invite-bounds");
        let grace = login_as(&f, "grace", "another correct horse");
        let linus = login_as(&f, "linus", "yet another horse");
        let issued = post_api(
            &f,
            &mikey,
            "invitations",
            invite_body(&id, "grace", "grace", json!(["coordinator"])),
        );
        let token = body_json(&issued)["token"].as_str().unwrap().to_string();
        let guess = format!("{id}.{}", "0".repeat(64));
        for _ in 0..auth::MAX_FAILURES {
            let resp = post_api(
                &f,
                &grace,
                "invitations/accept",
                json!({ "token": guess, "contributorId": "grace" }),
            );
            assert_eq!(resp.status, 400);
        }
        let locked = post_api(
            &f,
            &grace,
            "invitations/accept",
            json!({ "token": token, "contributorId": "grace" }),
        );
        assert_eq!(locked.status, 429);
        assert!(locked.headers.iter().any(|(k, _)| k == "Retry-After"));
        assert!(!locked.body.is_empty() && !String::from_utf8_lossy(&locked.body).contains(&token));
        // Other accounts and malformed tokens are not affected by, or distinguishable from, misses.
        for bad in ["", "nonsense", "shared-ffffffffffff.00"] {
            let resp = post_api(
                &f,
                &linus,
                "invitations/accept",
                json!({ "token": bad, "contributorId": "linus" }),
            );
            assert_eq!(resp.status, 400);
            assert_eq!(body_json(&resp)["error"], INVITATION_UNAVAILABLE);
        }
        assert_eq!(stored_record(&f, &id).authorization.bindings.len(), 1);
    }

    #[test]
    fn a_coordinator_invites_below_themselves_and_removed_accounts_lose_their_invitations() {
        let (f, mikey, id) = invitation_fixture("invite-coordinator");
        let grace = login_as(&f, "grace", "another correct horse");
        let token = |resp: Response| body_json(&resp)["token"].as_str().unwrap().to_string();
        let coordinator = token(post_api(
            &f,
            &mikey,
            "invitations",
            invite_body(&id, "grace", "grace", json!(["coordinator"])),
        ));
        assert_eq!(
            post_api(
                &f,
                &grace,
                "invitations/accept",
                json!({ "token": coordinator, "contributorId": "grace" }),
            )
            .status,
            200
        );
        let owner = post_api(
            &f,
            &grace,
            "invitations",
            invite_body(&id, "linus", "linus", json!(["siteOwner"])),
        );
        assert_eq!(owner.status, 404);
        let reader = post_api(
            &f,
            &grace,
            "invitations",
            invite_body(&id, "linus", "linus", json!(["reader"])),
        );
        assert_eq!(reader.status, 201);
        let reader_token = token(reader);

        // Pending invitations keep their registry key from being freed, and removing the account
        // withdraws the invitation so a re-created account cannot redeem it.
        assert!(crate::shared_publications::bound_contributor_ids(&f.dir)
            .unwrap()
            .contains("linus"));
        assert_eq!(
            crate::shared_publications::revoke_admin_user(&f.dir, "linus").unwrap(),
            1
        );
        let linus = login_as(&f, "linus", "yet another horse");
        let resp = post_api(
            &f,
            &linus,
            "invitations/accept",
            json!({ "token": reader_token, "contributorId": "linus" }),
        );
        assert_eq!(resp.status, 400);
    }
    #[test]
    fn collaboration_routes_deny_by_default_and_by_role() {
        let (f, mikey, id) = invitation_fixture("invite-roles");
        let grace = login_as(&f, "grace", "another correct horse");
        let linus = login_as(&f, "linus", "yet another horse");
        for (user, key, role) in [("grace", "grace", "reader"), ("linus", "linus", "editor")] {
            let token = body_json(&post_api(
                &f,
                &mikey,
                "invitations",
                invite_body(&id, user, key, json!([role])),
            ))["token"]
                .as_str()
                .unwrap()
                .to_string();
            let session = if user == "grace" { &grace } else { &linus };
            let accepted = post_api(
                &f,
                session,
                "invitations/accept",
                json!({ "token": token, "contributorId": key }),
            );
            assert_eq!(accepted.status, 200);
        }
        let pending = post_api(
            &f,
            &mikey,
            "invitations",
            invite_body(&id, "ada", "ada", json!(["contributor"])),
        );
        assert_eq!(
            pending.status,
            201,
            "{}",
            String::from_utf8_lossy(&pending.body)
        );
        let pending_id = body_json(&pending)["invitation"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let before = tree_snapshot(&f.dir.join(".openblog/private"));
        // Readers and editors see the reflection but cannot invite, list, revoke, or reissue.
        for session in [&grace, &linus] {
            assert_eq!(
                list_shared(&f, session)["publications"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            let listed = handle(
                &f.state,
                &authed(
                    json_req(
                        "GET",
                        &format!("/admin/api/collaboration/invitations?publicationId={id}"),
                        Json::Null,
                    ),
                    session,
                    true,
                ),
            );
            assert_eq!(listed.status, 404);
            for path in ["invitations", "invitations/revoke", "invitations/reissue"] {
                // A well-formed body, so the request reaches the authorization check.
                let body = if path == "invitations" {
                    invite_body(&id, "someone", "key", json!(["reader"]))
                } else {
                    json!({ "publicationId": id, "invitationId": pending_id })
                };
                let resp = post_api(&f, session, path, body);
                assert_eq!(resp.status, 404, "{path}");
                assert!(!String::from_utf8_lossy(&resp.body).contains("token"));
            }
        }
        // Operations with no route yet are denied for everyone, owner included.
        for (method, path) in [
            ("GET", "contribution"),
            ("PUT", "contribution"),
            ("POST", "contribution/reveal"),
            ("DELETE", "members"),
            ("PUT", "roles"),
            ("GET", "export"),
        ] {
            for session in [&mikey, &grace, &linus] {
                let resp = handle(
                    &f.state,
                    &authed(
                        json_req(
                            method,
                            &format!("/admin/api/collaboration/{path}"),
                            json!({ "publicationId": id }),
                        ),
                        session,
                        true,
                    ),
                );
                assert_eq!(resp.status, 404, "{method} {path}");
            }
        }
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), before);
    }

    fn join_via_api(
        f: &Fixture,
        owner: &(String, String),
        id: &str,
        user: &str,
        pass: &str,
        roles: Json,
    ) -> (String, String) {
        let issued = post_api(f, owner, "invitations", invite_body(id, user, user, roles));
        assert_eq!(issued.status, 201);
        let token = body_json(&issued)["token"].as_str().unwrap().to_string();
        let session = login_as(f, user, pass);
        let accepted = post_api(
            f,
            &session,
            "invitations/accept",
            json!({ "token": token, "contributorId": user }),
        );
        assert_eq!(
            accepted.status,
            200,
            "{}",
            String::from_utf8_lossy(&accepted.body)
        );
        session
    }

    fn draft_call(
        f: &Fixture,
        session: &(String, String),
        id: &str,
        expected: u64,
        markdown: &str,
    ) -> Response {
        handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/collaboration/draft",
                    json!({ "publicationId": id, "expectedRevision": expected, "markdown": markdown }),
                ),
                session,
                true,
            ),
        )
    }

    fn draft_read(f: &Fixture, session: &(String, String), id: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/draft?publicationId={id}"),
                ),
                session,
                false,
            ),
        )
    }

    fn drafts_file(f: &Fixture, id: &str) -> PathBuf {
        f.dir
            .join(crate::shared_publications::DRAFTS_DIRECTORY)
            .join(format!("{id}.json"))
    }

    #[test]
    fn drafts_are_isolated_per_participant_and_private_to_disk() {
        let (f, mikey, id) = invitation_fixture("draft-isolation");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        let editor = join_via_api(
            &f,
            &mikey,
            &id,
            "linus",
            "yet another horse",
            json!(["editor"]),
        );
        let content_before = tree_snapshot(&f.dir.join("content"));
        let output_before = tree_snapshot(&f.dir.join("public"));

        assert_eq!(body_json(&draft_read(&f, &mikey, &id))["draft"], Json::Null);
        let saved = draft_call(&f, &mikey, &id, 0, "MIKEY-SECRET-1 first");
        assert_eq!(saved.status, 200);
        assert_eq!(body_json(&saved)["stamp"]["number"], 1);
        assert!(!String::from_utf8_lossy(&saved.body).contains("MIKEY-SECRET"));
        assert_eq!(draft_call(&f, &grace, &id, 0, "GRACE-SECRET-1").status, 200);
        assert_eq!(
            draft_call(&f, &editor, &id, 0, "EDITOR-SECRET-1").status,
            200
        );
        // One save cannot mutate another contribution.
        assert_eq!(
            draft_call(&f, &mikey, &id, 1, "MIKEY-SECRET-2 second").status,
            200
        );
        let mine = body_json(&draft_read(&f, &mikey, &id));
        assert_eq!(mine["draft"]["stamp"]["number"], 2);
        assert_eq!(mine["draft"]["markdown"], "MIKEY-SECRET-2 second");
        let hers = draft_read(&f, &grace, &id);
        let hers_text = String::from_utf8_lossy(&hers.body).to_string();
        assert!(hers_text.contains("GRACE-SECRET-1"));
        assert!(!hers_text.contains("MIKEY-SECRET") && !hers_text.contains("EDITOR-SECRET"));
        assert_eq!(body_json(&hers)["draft"]["stamp"]["number"], 1);

        // Drafts live only in the private store; content and generated output are untouched.
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
        assert_eq!(tree_snapshot(&f.dir.join("public")), output_before);
        assert_eq!(
            tree_contains(&f.dir, "MIKEY-SECRET-2"),
            [PathBuf::from(format!(
                ".openblog/private/collaboration/drafts/{id}.json"
            ))]
        );
        let names: Vec<_> = fs::read_dir(drafts_file(&f, &id).parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, [format!("{id}.json")]);
    }

    #[test]
    fn a_stale_save_returns_the_newer_copy_and_overwrites_nothing() {
        let (f, mikey, id) = invitation_fixture("draft-stale");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "one").status, 200);
        assert_eq!(draft_call(&f, &mikey, &id, 1, "two").status, 200);
        let before = fs::read(drafts_file(&f, &id)).unwrap();

        let stale = draft_call(&f, &mikey, &id, 1, "my offline edit");
        assert_eq!(stale.status, 409);
        let body = body_json(&stale);
        assert_eq!(body["current"]["markdown"], "two");
        assert_eq!(body["current"]["stamp"]["number"], 2);
        assert!(!body.to_string().contains("my offline edit"));
        assert_eq!(fs::read(drafts_file(&f, &id)).unwrap(), before);
        assert_eq!(draft_call(&f, &mikey, &id, 0, "x").status, 409);
        assert_eq!(draft_call(&f, &mikey, &id, 9, "x").status, 409);
        assert_eq!(fs::read(drafts_file(&f, &id)).unwrap(), before);
        // Recovery: save again on top of the newer copy.
        assert_eq!(
            draft_call(&f, &mikey, &id, 2, "my offline edit").status,
            200
        );
        assert_eq!(
            body_json(&draft_read(&f, &mikey, &id))["draft"]["markdown"],
            "my offline edit"
        );
    }

    #[test]
    fn draft_routes_deny_by_default_without_leaking_or_writing() {
        let (f, mikey, id) = invitation_fixture("draft-deny");
        let reader = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["reader"]),
        );
        let stranger = login_as(&f, "linus", "yet another horse");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "OWNER-SECRET").status, 200);
        let before = tree_snapshot(&f.dir.join(".openblog/private"));

        let denied = [
            draft_call(&f, &reader, &id, 0, "x"),
            draft_read(&f, &reader, &id),
            draft_call(&f, &stranger, &id, 0, "x"),
            draft_read(&f, &stranger, &id),
            draft_call(&f, &mikey, "shared-000000000000", 0, "x"),
            draft_read(&f, &mikey, "shared-000000000000"),
        ];
        let first = String::from_utf8_lossy(&denied[0].body).to_string();
        for response in &denied {
            assert_eq!(response.status, 404);
            assert_eq!(String::from_utf8_lossy(&response.body), first);
        }
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), before);

        let anon = handle(
            &f.state,
            &req(
                "GET",
                &format!("/admin/api/collaboration/draft?publicationId={id}"),
            ),
        );
        assert_eq!(anon.status, 401);
        let no_csrf = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/collaboration/draft",
                    json!({ "publicationId": id, "expectedRevision": 1, "markdown": "x" }),
                ),
                &mikey,
                false,
            ),
        );
        assert!(no_csrf.status == 401 || no_csrf.status == 403);
        let mut wrong_type = req("PUT", "/admin/api/collaboration/draft");
        wrong_type.body = b"{}".to_vec();
        assert_eq!(
            handle(&f.state, &authed(wrong_type, &mikey, true)).status,
            415
        );
        let extra = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/collaboration/draft",
                    json!({ "publicationId": id, "expectedRevision": 1, "markdown": "x", "participantId": "grace" }),
                ),
                &mikey,
                true,
            ),
        );
        assert_eq!(extra.status, 422);
        assert_eq!(
            draft_call(&f, &mikey, &id, 1, &"a".repeat(64 * 1024 + 1)).status,
            422
        );
        assert_eq!(draft_call(&f, &mikey, &id, 1, "nul\u{0}byte").status, 422);
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), before);
        assert_eq!(
            draft_call(&f, &mikey, &id, 1, &"a".repeat(64 * 1024)).status,
            200
        );
    }

    #[test]
    fn unusable_draft_files_are_never_replaced() {
        let (f, mikey, id) = invitation_fixture("draft-malformed");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "kept").status, 200);
        let path = drafts_file(&f, &id);
        let good = fs::read(&path).unwrap();
        for bad in [&b"{not json"[..], b"{\"version\":1}", b""] {
            fs::write(&path, bad).unwrap();
            let saved = draft_call(&f, &mikey, &id, 1, "new");
            assert_eq!(saved.status, 500);
            assert_eq!(draft_read(&f, &mikey, &id).status, 500);
            assert_eq!(fs::read(&path).unwrap(), bad);
            assert!(!String::from_utf8_lossy(&saved.body).contains("kept"));
        }
        fs::write(&path, &good).unwrap();
        assert_eq!(draft_call(&f, &mikey, &id, 1, "new").status, 200);
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(draft_call(&f, &mikey, &id, 0, "x").status, 500);
        assert!(path.is_dir());
    }

    #[test]
    fn a_save_that_would_outgrow_the_draft_file_is_refused_and_the_file_stays_readable() {
        let (f, mikey, id) = invitation_fixture("draft-size");
        let heavy = "\u{1}".repeat(openblog_core::collaboration::MAX_MARKDOWN_BYTES);
        let mut revision = 0;
        let refused = loop {
            let saved = draft_call(&f, &mikey, &id, revision, &heavy);
            if saved.status != 200 {
                break saved;
            }
            revision += 1;
        };
        assert_eq!(refused.status, 422);
        assert!(revision > 1);
        let path = drafts_file(&f, &id);
        let before = fs::read(&path).unwrap();
        assert!(before.len() <= openblog_core::draft::MAX_DRAFT_SET_BYTES);
        assert_eq!(draft_call(&f, &mikey, &id, revision, &heavy).status, 422);
        assert_eq!(fs::read(&path).unwrap(), before);
        let read = draft_read(&f, &mikey, &id);
        assert_eq!(read.status, 200);
        assert_eq!(body_json(&read)["draft"]["stamp"]["number"], revision);
    }

    #[test]
    fn the_revision_limit_is_reported_truthfully_and_keeps_every_revision() {
        let (f, mikey, id) = invitation_fixture("draft-revisions");
        for number in 0..openblog_core::draft::MAX_REVISIONS_PER_DRAFT as u64 {
            assert_eq!(draft_call(&f, &mikey, &id, number, "a").status, 200);
        }
        let path = drafts_file(&f, &id);
        let before = fs::read(&path).unwrap();
        let refused = draft_call(
            &f,
            &mikey,
            &id,
            openblog_core::draft::MAX_REVISIONS_PER_DRAFT as u64,
            "b",
        );
        assert_eq!(refused.status, 422);
        let body = String::from_utf8_lossy(&refused.body).to_string();
        assert!(body.contains("limit") && !body.contains("characters that cannot"));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(draft_read(&f, &mikey, &id).status, 200);
    }

    #[test]
    fn an_interrupted_save_leaves_the_drafts_loadable_and_savable() {
        let (f, mikey, id) = invitation_fixture("draft-crash");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "kept").status, 200);
        let path = drafts_file(&f, &id);
        let orphan = path
            .parent()
            .unwrap()
            .join(format!(".{id}.0123456789abcdef.tmp"));
        fs::write(&orphan, b"{half a draft").unwrap();
        let before = fs::read(&path).unwrap();
        let read = draft_read(&f, &mikey, &id);
        assert_eq!(read.status, 200);
        assert!(String::from_utf8_lossy(&read.body).contains("kept"));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(
            draft_call(&f, &mikey, &id, 1, "after the crash").status,
            200
        );
        let read = draft_read(&f, &mikey, &id);
        assert!(String::from_utf8_lossy(&read.body).contains("after the crash"));
        // A restored copy of the earlier file is picked up like any stored draft.
        fs::write(&path, &before).unwrap();
        let read = draft_read(&f, &mikey, &id);
        assert!(String::from_utf8_lossy(&read.body).contains("kept"));
    }

    #[test]
    fn odd_publication_ids_never_reach_the_filesystem() {
        let (f, mikey, id) = invitation_fixture("draft-traversal");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "kept").status, 200);
        let before = tree_snapshot(&f.dir);
        for odd in [
            "../publications/x",
            "..%2Fpublications%2Fx",
            r"..\publications\x",
            "/etc/passwd",
            "a/b",
            "",
            "%2e%2e",
            "shared-000000000000/../x",
        ] {
            let read = draft_read(&f, &mikey, odd);
            assert_eq!(read.status, 404, "{odd}");
            let saved = draft_call(&f, &mikey, odd, 0, "ESCAPED");
            assert_eq!(saved.status, 404, "{odd}");
        }
        assert_eq!(tree_snapshot(&f.dir), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_draft_file_is_not_followed() {
        let (f, mikey, id) = invitation_fixture("draft-symlink");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "kept").status, 200);
        let path = drafts_file(&f, &id);
        let outside = f.dir.join("outside.json");
        fs::copy(&path, &outside).unwrap();
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();
        let before = fs::read(&outside).unwrap();
        assert_eq!(draft_call(&f, &mikey, &id, 1, "x").status, 500);
        assert_eq!(draft_read(&f, &mikey, &id).status, 500);
        assert_eq!(fs::read(&outside).unwrap(), before);
    }

    #[test]
    fn a_finished_collaboration_request_frees_the_content_lock_before_the_next_one_runs() {
        let (f, _mikey, id) = invitation_fixture("transaction-handoff");
        let Ok(transaction) = invitation_transaction(&f.state, &id) else {
            panic!("the transaction could not start");
        };
        // On Windows, hold the lock file the way a scanner can, so removing it takes a moment.
        #[cfg(windows)]
        let held = {
            use std::os::windows::fs::OpenOptionsExt;
            const FILE_SHARE_READ: u32 = 1;
            const FILE_SHARE_WRITE: u32 = 2;
            fs::OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                .open(f.dir.join(".openblog/content-transaction.lock"))
                .unwrap()
        };
        // Widen the release window on every platform: the lock file outlives the drop call by
        // this long, so a wrong field order lets the next request see it.
        crate::transaction::RELEASE_DELAY_MS.store(150, std::sync::atomic::Ordering::SeqCst);
        let next_found_the_lock_free = std::thread::scope(|scope| {
            #[cfg(windows)]
            scope.spawn(move || {
                std::thread::sleep(Duration::from_millis(150));
                drop(held);
            });
            let next = scope.spawn(|| {
                // The next request runs as soon as it holds the build mutex.
                let _build = lock(&f.state.build);
                crate::transaction::ContentTransactionLock::acquire(&f.state.root).is_ok()
            });
            std::thread::sleep(Duration::from_millis(20));
            drop(transaction);
            next.join().unwrap()
        });
        crate::transaction::RELEASE_DELAY_MS.store(0, std::sync::atomic::Ordering::SeqCst);
        assert!(
            next_found_the_lock_free,
            "the next request was refused as a concurrent write"
        );
    }

    #[test]
    fn simultaneous_saves_lose_neither_draft_and_a_racing_revision_has_one_winner() {
        let (f, mikey, id) = invitation_fixture("draft-concurrent");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        std::thread::scope(|scope| {
            for (session, label) in [(&mikey, "mikey"), (&grace, "grace")] {
                let (f, id) = (&f, &id);
                scope.spawn(move || {
                    for n in 0..8u64 {
                        let r = draft_call(f, session, id, n, &format!("{label} rev {}", n + 1));
                        assert_eq!(r.status, 200, "{label} {n}");
                    }
                });
            }
        });
        for (session, label) in [(&mikey, "mikey"), (&grace, "grace")] {
            let got = body_json(&draft_read(&f, session, &id));
            assert_eq!(got["draft"]["stamp"]["number"], 8);
            assert_eq!(got["draft"]["markdown"], format!("{label} rev 8"));
        }
        let results: Vec<u16> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..2)
                .map(|n| {
                    let (f, id, mikey) = (&f, &id, &mikey);
                    scope.spawn(move || draft_call(f, mikey, id, 8, &format!("race {n}")).status)
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_eq!(results.iter().filter(|s| **s == 200).count(), 1);
        assert_eq!(results.iter().filter(|s| **s == 409).count(), 1);
    }

    fn members_of(f: &Fixture, session: &(String, String), id: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/members?publicationId={id}"),
                ),
                session,
                false,
            ),
        )
    }

    #[test]
    fn members_are_listed_changed_and_removed_safely() {
        let (f, mikey, id) = invitation_fixture("member-management");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        let linus = join_via_api(
            &f,
            &mikey,
            &id,
            "linus",
            "yet another horse",
            json!(["coordinator"]),
        );
        let content_before = tree_snapshot(&f.dir.join("content"));

        // Plain contributors cannot list or change anything, and learn nothing.
        assert_eq!(members_of(&f, &grace, &id).status, 404);
        let listed = body_json(&members_of(&f, &mikey, &id));
        let revision = listed["revision"].as_u64().unwrap();
        let members = listed["members"].as_array().unwrap();
        assert_eq!(members.len(), 3);
        let text = listed.to_string();
        assert!(!text.contains("tokenHash") && !text.contains("token\""));
        let participant = |user: &str| {
            members.iter().find(|m| m["adminUser"] == user).unwrap()["participantId"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let (grace_id, mikey_id) = (participant("grace"), participant("mikey"));
        let change = |session: &(String, String), who: &str, roles: Json, rev: u64| {
            post_api(
                &f,
                session,
                "members/roles",
                json!({ "publicationId": id, "participantId": who, "roles": roles, "expectedRevision": rev }),
            )
        };
        let remove = |session: &(String, String), who: &str, rev: u64| {
            post_api(
                &f,
                session,
                "members/remove",
                json!({ "publicationId": id, "participantId": who, "expectedRevision": rev }),
            )
        };
        let before = tree_snapshot(&f.dir.join(".openblog/private"));
        // Unauthorized, last owner, unknown, empty roles, and unknown fields change nothing.
        assert_eq!(
            change(&grace, &grace_id, json!(["siteOwner"]), revision).status,
            404
        );
        assert_eq!(remove(&grace, &grace_id, revision).status, 404);
        assert_eq!(
            change(&linus, &grace_id, json!(["siteOwner"]), revision).status,
            404
        );
        assert_eq!(remove(&linus, &mikey_id, revision).status, 404);
        assert_eq!(remove(&mikey, &mikey_id, revision).status, 404);
        assert_eq!(
            change(&mikey, &mikey_id, json!(["reader"]), revision).status,
            404
        );
        assert_eq!(remove(&mikey, "participant-99", revision).status, 404);
        assert_eq!(change(&mikey, &grace_id, json!([]), revision).status, 422);
        assert_eq!(
            post_api(&f, &mikey, "members/remove", json!({ "publicationId": id, "participantId": grace_id, "expectedRevision": revision, "adminUser": "x" })).status,
            422
        );
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), before);

        // A role change succeeds once; replaying the same revision is a conflict.
        assert_eq!(
            change(&mikey, &grace_id, json!(["reader"]), revision).status,
            200
        );
        let stale = change(&mikey, &grace_id, json!(["editor"]), revision);
        assert_eq!(stale.status, 409);
        assert!(String::from_utf8_lossy(&stale.body).contains("changed while you were working"));
        assert_eq!(remove(&mikey, &grace_id, revision).status, 409);
        let revision = revision + 1;
        assert_eq!(
            body_json(&members_of(&f, &mikey, &id))["revision"],
            revision
        );

        // Removal ends access, keeps the participant, and leaves content untouched.
        assert_eq!(remove(&linus, &grace_id, revision).status, 200);
        let stored = stored_record(&f, &id);
        assert!(stored
            .authorization
            .bindings
            .iter()
            .all(|b| b.admin_user != "grace"));
        assert!(stored
            .collaboration
            .participants
            .iter()
            .any(|p| p.id == grace_id));
        assert!(list_shared(&f, &grace)["publications"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
    }

    fn reveal_call(f: &Fixture, session: &(String, String), path: &str, body: Json) -> Response {
        handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    &format!("/admin/api/collaboration/reveal/{path}"),
                    body,
                ),
                session,
                true,
            ),
        )
    }

    fn reveal_state(f: &Fixture, session: &(String, String), id: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/reveal?publicationId={id}"),
                ),
                session,
                false,
            ),
        )
    }

    fn slot<'a>(state: &'a Json, name: &str) -> &'a Json {
        state["slots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["displayName"] == name || s["participantId"] == name)
            .unwrap()
    }

    fn ready_body(id: &str, revision: Json) -> Json {
        json!({ "publicationId": id, "revision": revision })
    }

    fn policy_body(id: &str, policy: &str) -> Json {
        json!({ "publicationId": id, "policy": policy })
    }

    #[test]
    fn mutual_reveal_obeys_the_policy_and_never_exposes_an_unrevealed_draft() {
        let (f, mikey, id) = invitation_fixture("reveal-policy");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        let linus = join_via_api(
            &f,
            &mikey,
            &id,
            "linus",
            "yet another horse",
            json!(["editor"]),
        );
        let ada = join_via_api(
            &f,
            &mikey,
            &id,
            "ada",
            "a fourth correct horse",
            json!(["coordinator"]),
        );
        for (who, text) in [
            (&mikey, "MIKEY-SECRET"),
            (&grace, "GRACE-SECRET"),
            (&linus, "LINUS-SECRET"),
        ] {
            assert_eq!(draft_call(&f, who, &id, 0, text).status, 200);
        }
        let content_before = tree_snapshot(&f.dir.join("content"));
        let output_before = tree_snapshot(&f.dir.join("public"));
        let contract_before = stored_record(&f, &id).collaboration;
        let participants = contract_before.participants.clone();

        // Sharing starts off: nothing can be offered and every other slot is a placeholder.
        let off = reveal_call(&f, &grace, "ready", ready_body(&id, json!(1)));
        assert_eq!(off.status, 422);
        let state = body_json(&reveal_state(&f, &grace, &id));
        assert_eq!(state["policy"], "independent");
        assert_eq!(state["canSetPolicy"], false);
        let names: Vec<_> = state["slots"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["displayName"].as_str().unwrap().to_string())
            .collect();
        let contract_names: Vec<_> = participants
            .iter()
            .map(|p| p.display_name.clone())
            .collect();
        assert_eq!(names, contract_names);
        let text = state.to_string();
        assert!(text.contains("GRACE-SECRET"));
        assert!(!text.contains("MIKEY-SECRET") && !text.contains("LINUS-SECRET"));

        // Only a coordinator or owner picks the policy; bad values and fields are refused.
        for who in [&grace, &linus] {
            let denied = reveal_call(&f, who, "policy", policy_body(&id, "voluntary"));
            assert_eq!(denied.status, 404);
        }
        let bad = reveal_call(&f, &ada, "policy", policy_body(&id, "everyone"));
        assert_eq!(bad.status, 422);
        let mut extra = policy_body(&id, "voluntary");
        extra["x"] = json!(1);
        assert_eq!(reveal_call(&f, &ada, "policy", extra).status, 422);
        let unknown = reveal_call(&f, &ada, "policy", policy_body("nope", "voluntary"));
        assert_eq!(unknown.status, 404);
        assert_eq!(
            body_json(&reveal_state(&f, &ada, &id))["policy"],
            "independent"
        );
        let set = reveal_call(&f, &ada, "policy", policy_body(&id, "allReady"));
        assert_eq!(set.status, 200);

        // A coordinator without a draft sees the policy only and cannot offer or read prose.
        let coordinator_view = body_json(&reveal_state(&f, &ada, &id));
        assert_eq!(coordinator_view["policy"], "allReady");
        assert_eq!(coordinator_view["slots"].as_array().unwrap().len(), 0);
        let coordinator_ready = reveal_call(&f, &ada, "ready", ready_body(&id, json!(1)));
        assert_eq!(coordinator_ready.status, 404);
        assert_eq!(reveal_state(&f, &linus, "missing-id").status, 404);

        // Offers are private and reversible; a wrong revision is refused.
        let wrong = reveal_call(&f, &grace, "ready", ready_body(&id, json!(9)));
        assert_eq!(wrong.status, 404);
        let waiting = body_json(&reveal_call(&f, &grace, "ready", ready_body(&id, json!(1))));
        assert_eq!(waiting["ready"], true);
        assert_eq!(waiting["revealed"], false);
        let seen = body_json(&reveal_state(&f, &mikey, &id));
        assert_eq!(slot(&seen, "Grace")["ready"], true);
        assert!(!seen.to_string().contains("GRACE-SECRET"));
        let back = body_json(&reveal_call(
            &f,
            &grace,
            "ready",
            ready_body(&id, Json::Null),
        ));
        assert_eq!(back["ready"], false);
        let after = body_json(&reveal_state(&f, &mikey, &id));
        assert_eq!(slot(&after, "Grace")["ready"], false);

        // Changing the policy drops standing offers and reveals nothing.
        for who in [&grace, &mikey] {
            reveal_call(&f, who, "ready", ready_body(&id, json!(1)));
        }
        let changed = reveal_call(&f, &ada, "policy", policy_body(&id, "voluntary"));
        assert_eq!(changed.status, 200);
        let hidden = body_json(&reveal_state(&f, &mikey, &id)).to_string();
        assert!(!hidden.contains("GRACE-SECRET"));
        let back_again = reveal_call(&f, &ada, "policy", policy_body(&id, "allReady"));
        assert_eq!(back_again.status, 200);

        // Removing a participant mid-way: they no longer block the reveal or receive it.
        let listed = body_json(&members_of(&f, &mikey, &id));
        let linus_id = listed["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["adminUser"] == "linus")
            .unwrap()["participantId"]
            .as_str()
            .unwrap()
            .to_string();
        let removed = post_api(
            &f,
            &mikey,
            "members/remove",
            json!({ "publicationId": id, "participantId": linus_id, "expectedRevision": listed["revision"] }),
        );
        assert_eq!(
            removed.status,
            200,
            "{}",
            String::from_utf8_lossy(&removed.body)
        );
        let first = reveal_call(&f, &grace, "ready", ready_body(&id, json!(1)));
        assert_eq!(first.status, 200);
        let done = body_json(&reveal_call(&f, &mikey, "ready", ready_body(&id, json!(1))));
        assert_eq!(done["revealed"], true);

        let mikey_name = participants[0].display_name.clone();
        let mine = body_json(&reveal_state(&f, &mikey, &id));
        assert_eq!(slot(&mine, "Grace")["kind"], "revealed");
        assert_eq!(slot(&mine, "Grace")["markdown"], "GRACE-SECRET");
        assert_eq!(slot(&mine, "Grace")["stamp"]["number"], 1);
        assert_eq!(slot(&mine, &linus_id)["kind"], "private");
        assert!(!mine.to_string().contains("LINUS-SECRET"));
        let hers = body_json(&reveal_state(&f, &grace, &id));
        assert_eq!(slot(&hers, &mikey_name)["markdown"], "MIKEY-SECRET");

        // A later edit stays private even after the reveal.
        assert_eq!(
            draft_call(&f, &mikey, &id, 1, "MIKEY-SECRET v2").status,
            200
        );
        let later = body_json(&reveal_state(&f, &grace, &id));
        assert_eq!(slot(&later, &mikey_name)["markdown"], "MIKEY-SECRET");

        // The removed participant and a malformed request learn nothing.
        assert_eq!(reveal_state(&f, &linus, &id).status, 404);
        let removed_ready = reveal_call(&f, &linus, "ready", ready_body(&id, json!(1)));
        assert_eq!(removed_ready.status, 404);
        let malformed = reveal_call(&f, &grace, "ready", Json::Null);
        assert_eq!(malformed.status, 422);

        // Content, public output, and the contract never changed; prose lives only in the store.
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
        assert_eq!(tree_snapshot(&f.dir.join("public")), output_before);
        assert_eq!(stored_record(&f, &id).collaboration, contract_before);
        assert_eq!(
            tree_contains(&f.dir, "GRACE-SECRET"),
            [PathBuf::from(format!(
                ".openblog/private/collaboration/drafts/{id}.json"
            ))]
        );
    }

    #[test]
    fn reveal_changes_that_lose_a_race_are_refused_and_commit_nothing() {
        let (f, mikey, id) = invitation_fixture("reveal-race");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        for (who, text) in [(&mikey, "MIKEY-SECRET"), (&grace, "GRACE-SECRET")] {
            assert_eq!(draft_call(&f, who, &id, 0, text).status, 200);
        }
        // Mikey turns on allReady and offers; Grace's offer would complete the reveal.
        assert_eq!(
            reveal_call(&f, &mikey, "policy", policy_body(&id, "allReady")).status,
            200
        );
        assert_eq!(
            reveal_call(&f, &mikey, "ready", ready_body(&id, json!(1))).status,
            200
        );
        let drafts_file = f
            .dir
            .join(format!(".openblog/private/collaboration/drafts/{id}.json"));

        // Load a snapshot, then let another writer change the file before this request stores.
        let stale = crate::shared_publications::load_drafts(&f.state.root, &id).unwrap();
        let record = stored_record(&f, &id);
        let ids: Vec<String> = record
            .collaboration
            .participants
            .iter()
            .map(|p| p.id.clone())
            .collect();
        let active: Vec<&str> = ids.iter().map(String::as_str).collect();
        let grace_id = record
            .collaboration
            .participants
            .iter()
            .find(|p| p.display_name == "Grace")
            .unwrap()
            .id
            .clone();
        assert_eq!(
            draft_call(&f, &grace, &id, 1, "GRACE-SECRET v2").status,
            200
        );
        let after_other_writer = fs::read(&drafts_file).unwrap();
        let view_before = body_json(&reveal_state(&f, &mikey, &id)).to_string();

        // A ready mark that would commit the reveal loses the race and changes nothing.
        let mut set = draft_set_for(stale.set.as_ref(), &record).unwrap();
        let outcome = set.mark_ready(&grace_id, 1, &active).unwrap();
        assert!(matches!(outcome, ReadyOutcome::Revealed));
        let lost = store_drafts(&f.state, &id, &stale, &set, json!({ "revealed": true }));
        assert_eq!(lost.status, 409);
        assert_eq!(fs::read(&drafts_file).unwrap(), after_other_writer);

        // The same holds for a policy change made from the stale snapshot.
        let mut set = draft_set_for(stale.set.as_ref(), &record).unwrap();
        set.set_policy(RevealPolicy::Voluntary);
        let lost = store_drafts(&f.state, &id, &stale, &set, json!({}));
        assert_eq!(lost.status, 409);
        assert_eq!(fs::read(&drafts_file).unwrap(), after_other_writer);

        let view_after = body_json(&reveal_state(&f, &mikey, &id));
        assert_eq!(view_after.to_string(), view_before);
        assert_eq!(view_after["policy"], "allReady");
        assert_eq!(slot(&view_after, "Grace")["kind"], "private");
        assert!(!view_after.to_string().contains("GRACE-SECRET"));
    }

    fn preview_call(f: &Fixture, session: &(String, String), id: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/preview?publicationId={id}"),
                ),
                session,
                false,
            ),
        )
    }

    /// The served preview document, fetched the way the Admin frame fetches it.
    fn preview_document_text(f: &Fixture, session: &(String, String), body: &Json) -> String {
        let url = body["preview"]["previewUrl"].as_str().unwrap();
        let served = handle(&f.state, &authed(req("GET", url), session, false));
        assert_eq!(served.status, 200);
        assert!(served.headers.iter().any(|(name, value)| {
            name == "Content-Security-Policy"
                && value.starts_with("default-src 'none'")
                && !value.contains("script-src")
        }));
        assert!(served
            .headers
            .iter()
            .any(|(name, value)| name == "X-Frame-Options" && value == "SAMEORIGIN"));
        String::from_utf8(served.body).unwrap()
    }

    #[test]
    fn the_combined_preview_shows_only_what_the_author_may_read_and_writes_nothing() {
        let (f, mikey, id) = invitation_fixture("combined-preview");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        let reader = join_via_api(
            &f,
            &mikey,
            &id,
            "linus",
            "yet another horse",
            json!(["reader"]),
        );
        let ada = join_via_api(
            &f,
            &mikey,
            &id,
            "ada",
            "a fourth correct horse",
            json!(["coordinator"]),
        );
        for (who, text) in [(&mikey, "MIKEY-SECRET"), (&grace, "GRACE-SECRET")] {
            assert_eq!(draft_call(&f, who, &id, 0, text).status, 200);
        }
        let content_before = tree_snapshot(&f.dir.join("content"));
        let output_before = tree_snapshot(&f.dir.join("public"));

        // Nothing is shared yet: each author sees only their own section.
        let mine = preview_call(&f, &mikey, &id);
        assert_eq!(mine.status, 200);
        let body = body_json(&mine);
        let text = body.to_string();
        // The summary carries statuses only; prose travels solely in the served document.
        assert!(!text.contains("SECRET"));
        assert_eq!(body["preview"]["complete"], false);
        assert_eq!(body["preview"]["ready"], false);
        assert!(body["preview"]["seen"].is_null());
        assert!(body["preview"].get("document").is_none());
        let document = preview_document_text(&f, &mikey, &body);
        assert!(document.contains("Preview, not published."));
        assert!(document.contains("MIKEY-SECRET") && !document.contains("GRACE-SECRET"));
        assert!(!text.contains("grace-admin") && !text.contains("invitation"));

        // A reader or a coordinator who is not a drafter, a stranger and an anonymous caller get
        // the same not-found as an unknown publication, and learn nothing.
        let unknown = preview_call(&f, &mikey, "shared-ffffffffffff");
        assert_eq!(unknown.status, 404);
        for who in [&reader, &ada] {
            let denied = preview_call(&f, who, &id);
            assert_eq!(denied.status, 404);
            assert_eq!(denied.body, unknown.body);
        }
        let anonymous = handle(
            &f.state,
            &req(
                "GET",
                &format!("/admin/api/collaboration/preview?publicationId={id}"),
            ),
        );
        assert_eq!(anonymous.status, 401);
        assert_eq!(preview_call(&f, &mikey, "").status, 404);

        // Both mark revision 1 ready under the voluntary rule: both see the whole piece.
        assert_eq!(
            reveal_call(&f, &ada, "policy", policy_body(&id, "voluntary")).status,
            200
        );
        for who in [&mikey, &grace] {
            assert_eq!(
                reveal_call(&f, who, "ready", ready_body(&id, json!(1))).status,
                200
            );
        }
        let shared = body_json(&preview_call(&f, &grace, &id));
        let text = preview_document_text(&f, &grace, &shared);
        assert!(text.contains("MIKEY-SECRET") && text.contains("GRACE-SECRET"));
        assert_eq!(shared["preview"]["complete"], true);
        assert_eq!(shared["preview"]["ready"], false);
        assert!(shared["preview"]["seen"].is_string());
        let sections = shared["preview"]["sections"].as_array().unwrap();
        assert_eq!(sections.len(), 2);
        assert!(sections
            .iter()
            .all(|s| s["shown"] == true && s["revision"] == 1 && s["approval"] == "awaiting"));

        // A newer revision that was not offered is hidden from the other author at once.
        assert_eq!(draft_call(&f, &mikey, &id, 1, "MIKEY-NEWER").status, 200);
        let private_before = tree_snapshot(&f.dir.join(".openblog/private"));
        let after = body_json(&preview_call(&f, &grace, &id));
        let text = format!("{after}{}", preview_document_text(&f, &grace, &after));
        assert!(!text.contains("MIKEY-NEWER") && !text.contains("MIKEY-SECRET"));
        assert_eq!(after["preview"]["complete"], false);
        let own = body_json(&preview_call(&f, &mikey, &id));
        assert!(preview_document_text(&f, &mikey, &own).contains("MIKEY-NEWER"));

        // Reading changed no draft, approval, content or public output.
        assert_eq!(
            tree_snapshot(&f.dir.join(".openblog/private")),
            private_before
        );
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
        assert_eq!(tree_snapshot(&f.dir.join("public")), output_before);
    }

    #[test]
    fn a_stored_approval_that_no_longer_matches_is_flagged_and_a_bad_file_fails_safely() {
        let (f, mikey, id) = invitation_fixture("combined-preview-stale");
        assert_eq!(draft_call(&f, &mikey, &id, 0, "MIKEY-SECRET").status, 200);
        let owner = stored_record(&f, &id).collaboration.participants[0]
            .id
            .clone();
        let directory = f.dir.join(".openblog/private/collaboration/approvals");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join(format!("{id}.json"));
        let stale = json!({
            "version": 1,
            "policy": {},
            "policyRevision": 0,
            "approvals": [{
                "participantId": owner,
                "approvedAt": 1,
                "consentVersion": 1,
                "binding": "0".repeat(64),
            }],
        });
        std::fs::write(&file, stale.to_string()).unwrap();
        let body = body_json(&preview_call(&f, &mikey, &id));
        assert_eq!(body["preview"]["sections"][0]["approval"], "stale");
        assert_eq!(body["preview"]["ready"], false);
        assert!(preview_document_text(&f, &mikey, &body).contains("out of date"));

        // A malformed file is an error that says nothing, never an empty or approved set.
        std::fs::write(&file, "{ not json MIKEY-SECRET").unwrap();
        let broken = preview_call(&f, &mikey, &id);
        assert_eq!(broken.status, 500);
        let text = String::from_utf8_lossy(&broken.body).to_string();
        assert!(!text.contains("MIKEY-SECRET") && !text.contains("not json"));
    }

    #[test]
    fn reveal_routes_without_the_admin_session_or_csrf_do_nothing() {
        let (f, mikey, id) = invitation_fixture("reveal-auth");
        let before = tree_snapshot(&f.dir.join(".openblog/private"));
        let body = policy_body(&id, "voluntary");
        let path = "/admin/api/collaboration/reveal/policy";
        let no_csrf = handle(
            &f.state,
            &authed(json_req("PUT", path, body.clone()), &mikey, false),
        );
        assert!(
            no_csrf.status == 403 || no_csrf.status == 401,
            "{}",
            no_csrf.status
        );
        let anonymous = handle(&f.state, &json_req("PUT", path, body));
        assert_eq!(anonymous.status, 401);
        let read = format!("/admin/api/collaboration/reveal?publicationId={id}");
        assert_eq!(handle(&f.state, &req("GET", &read)).status, 401);
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), before);
    }

    // ---- Approval, scheduling and publication (ADR 0022) ----

    /// Mikey (owner and author), Grace (author), Ada (coordinator, not an author), both authors
    /// have written and offered revision 1, so each can read the whole piece.
    type Session = (String, String);

    fn approval_fixture(tag: &str) -> (Fixture, Session, Session, Session, String) {
        let (f, mikey, id) = invitation_fixture(tag);
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        let ada = join_via_api(
            &f,
            &mikey,
            &id,
            "ada",
            "a fourth correct horse",
            json!(["coordinator"]),
        );
        for (who, text) in [(&mikey, "MIKEY-SECRET"), (&grace, "GRACE-SECRET")] {
            assert_eq!(draft_call(&f, who, &id, 0, text).status, 200);
        }
        assert_eq!(
            reveal_call(&f, &ada, "policy", policy_body(&id, "voluntary")).status,
            200
        );
        for who in [&mikey, &grace] {
            assert_eq!(
                reveal_call(&f, who, "ready", ready_body(&id, json!(1))).status,
                200
            );
        }
        (f, mikey, grace, ada, id)
    }

    fn approval_body(f: &Fixture, who: &(String, String), id: &str) -> Json {
        let seen = body_json(&preview_call(f, who, id))["preview"]["seen"].clone();
        json!({ "publicationId": id, "seen": seen, "affirmed": true })
    }

    fn approve_as(f: &Fixture, who: &(String, String), id: &str) -> Response {
        let body = approval_body(f, who, id);
        assert!(
            body["seen"].is_string(),
            "the author can read the whole piece"
        );
        post_api(f, who, "approve", body)
    }

    fn publish_as(f: &Fixture, who: &(String, String), id: &str) -> Response {
        post_api(f, who, "publish", json!({ "publicationId": id }))
    }

    fn schedule_as(f: &Fixture, who: &(String, String), id: &str, at: Json) -> Response {
        post_api(
            f,
            who,
            "schedule",
            json!({ "publicationId": id, "publishAt": at }),
        )
    }

    fn state_trees(f: &Fixture) -> [BTreeMap<PathBuf, Vec<u8>>; 3] {
        [
            tree_snapshot(&f.dir.join("content")),
            tree_snapshot(&f.dir.join("dist")),
            tree_snapshot(&f.dir.join(".openblog/private")),
        ]
    }

    fn published_post(f: &Fixture, id: &str) -> Option<String> {
        fs::read_to_string(f.dir.join(format!("content/posts/{id}.md"))).ok()
    }

    fn outcome_file(f: &Fixture, id: &str) -> PathBuf {
        f.dir.join(format!(
            "{}/{id}.json",
            crate::shared_publications::OUTCOMES_DIRECTORY
        ))
    }

    fn assert_no_prose(response: &Response) {
        let text = String::from_utf8_lossy(&response.body).to_string();
        assert!(
            !text.contains("SECRET") && !text.contains("NEWER"),
            "{text}"
        );
    }

    #[test]
    fn approving_needs_the_authors_own_affirmation_and_the_exact_piece_they_read() {
        let (f, mikey, grace, ada, id) = approval_fixture("approve-gate");
        let before = state_trees(&f);

        // Not affirmed, wrong token, another author's token: refused, nothing recorded.
        let mut unaffirmed = approval_body(&f, &mikey, &id);
        unaffirmed["affirmed"] = json!(false);
        assert_eq!(post_api(&f, &mikey, "approve", unaffirmed).status, 422);
        let mut wrong = approval_body(&f, &mikey, &id);
        wrong["seen"] = json!("0".repeat(64));
        assert_eq!(post_api(&f, &mikey, "approve", wrong).status, 409);
        let mut borrowed = approval_body(&f, &grace, &id);
        borrowed["seen"] = approval_body(&f, &mikey, &id)["seen"].clone();
        assert_eq!(post_api(&f, &grace, "approve", borrowed).status, 409);
        let mut extra = approval_body(&f, &mikey, &id);
        extra["participantId"] = json!("someone-else");
        assert_eq!(post_api(&f, &mikey, "approve", extra).status, 422);

        // A coordinator who is not an author, an unknown publication, and no session all fail
        // the same way, and cannot approve for anyone.
        let unknown = post_api(
            &f,
            &ada,
            "approve",
            json!({ "publicationId": "shared-ffffffffffff", "seen": "0".repeat(64), "affirmed": true }),
        );
        assert_eq!(unknown.status, 404);
        let denied = post_api(&f, &ada, "approve", approval_body(&f, &mikey, &id));
        assert_eq!(denied.status, 404);
        assert_eq!(denied.body, unknown.body);
        let no_csrf = handle(
            &f.state,
            &authed(
                json_req(
                    "POST",
                    "/admin/api/collaboration/approve",
                    approval_body(&f, &mikey, &id),
                ),
                &mikey,
                false,
            ),
        );
        assert!(no_csrf.status == 401 || no_csrf.status == 403);
        assert_eq!(state_trees(&f), before);

        // Approving, withdrawing and approving again each change only the approval file.
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        let mine = body_json(&preview_call(&f, &mikey, &id));
        let states: Vec<_> = mine["preview"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["approval"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(states, ["approved", "awaiting"]);
        let withdraw = |who| post_api(&f, who, "approve/withdraw", json!({ "publicationId": id }));
        assert_eq!(body_json(&withdraw(&mikey))["withdrawn"], true);
        let settled = state_trees(&f);
        assert_eq!(body_json(&withdraw(&mikey))["withdrawn"], false);
        assert_eq!(withdraw(&ada).status, 404);
        assert_eq!(state_trees(&f), settled);
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        let stored = fs::read_to_string(f.dir.join(format!(
            ".openblog/private/collaboration/approvals/{id}.json"
        )))
        .unwrap();
        assert!(!stored.contains("SECRET"));
        assert_eq!(state_trees(&f)[0], before[0]);
        assert_eq!(state_trees(&f)[1], before[1]);
    }

    #[test]
    fn publishing_needs_the_grant_and_every_exact_approval_and_a_retry_changes_nothing() {
        let (f, mikey, grace, ada, id) = approval_fixture("publish-gate");
        let before = state_trees(&f);

        // Nobody approved: the coordinator is told whose approval is missing, never any prose.
        let blocked = publish_as(&f, &ada, &id);
        assert_eq!(blocked.status, 409);
        assert_no_prose(&blocked);
        let missing = body_json(&blocked)["missing"].clone();
        assert_eq!(missing.as_array().unwrap().len(), 2);
        // Authors hold no publish grant; strangers and unknown publications are not told anything.
        let unknown = publish_as(&f, &ada, "shared-ffffffffffff");
        assert_eq!(unknown.status, 404);
        let denied = publish_as(&f, &grace, &id);
        assert_eq!(denied.status, 404);
        assert_eq!(denied.body, unknown.body);
        let anonymous = handle(
            &f.state,
            &json_req(
                "POST",
                "/admin/api/collaboration/publish",
                json!({ "publicationId": id }),
            ),
        );
        assert_eq!(anonymous.status, 401);
        assert_eq!(state_trees(&f), before);

        // The site owner's grant does not replace the other author's approval.
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        let partial = state_trees(&f);
        for who in [&mikey, &ada] {
            let refused = publish_as(&f, who, &id);
            assert_eq!(refused.status, 409);
            assert_no_prose(&refused);
            assert_eq!(body_json(&refused)["missing"].as_array().unwrap().len(), 1);
        }
        assert_eq!(state_trees(&f), partial);
        assert!(published_post(&f, &id).is_none() && !outcome_file(&f, &id).exists());

        // Every author approved: the coordinator publishes the exact approved prose.
        assert_eq!(approve_as(&f, &grace, &id).status, 200);
        let first = publish_as(&f, &ada, &id);
        assert_eq!(
            first.status,
            200,
            "{}",
            String::from_utf8_lossy(&first.body)
        );
        assert_eq!(body_json(&first)["alreadyPublished"], false);
        let post = published_post(&f, &id).expect("the Post was written");
        assert!(post.contains("MIKEY-SECRET") && post.contains("GRACE-SECRET"));
        assert!(post.find("MIKEY-SECRET") < post.find("GRACE-SECRET"));
        let credits =
            fs::read_to_string(f.dir.join(format!("content/posts/{id}.credits.json"))).unwrap();
        assert!(credits.contains("mikey-writer") && credits.contains("grace"));
        // No collaboration metadata rides along in content or in any public file.
        for text in [&post, &credits] {
            assert!(!text.contains(&id) && !text.contains("token") && !text.contains("invitation"));
            assert!(!text.contains("grace-admin") && !text.contains("approvedAt"));
        }
        let public = state_trees(&f)[1].clone();
        assert!(public
            .values()
            .any(|bytes| String::from_utf8_lossy(bytes).contains("GRACE-SECRET")));
        for (path, bytes) in &public {
            let text = String::from_utf8_lossy(bytes);
            assert!(
                !text.contains(&id) && !text.contains("invitation") && !text.contains("approvedAt"),
                "{}",
                path.display()
            );
        }
        // The rebuilt feeds and page carry both sections in order, one creator per author in the
        // same order in RSS and JSON Feed, and no collaboration metadata.
        let built = |name: &str| {
            let (_, bytes) = public
                .iter()
                .find(|(path, _)| path.ends_with(name))
                .unwrap_or_else(|| panic!("{name} was not built"));
            String::from_utf8_lossy(bytes).to_string()
        };
        let rss = built("rss.xml");
        let feed: Json = serde_json::from_str(&built("feed.json")).unwrap();
        let item = feed["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| {
                item["content_text"]
                    .as_str()
                    .unwrap_or("")
                    .contains("GRACE-SECRET")
            })
            .expect("the reflection is in the JSON Feed");
        let names: Vec<&str> = item["authors"]
            .as_array()
            .expect("JSON Feed authors")
            .iter()
            .map(|author| author["name"].as_str().unwrap())
            .collect();
        assert_eq!(names.len(), 2);
        let creators: Vec<String> = rss
            .split("<dc:creator>")
            .skip(1)
            .filter_map(|part| part.split("</dc:creator>").next())
            .map(str::to_string)
            .collect();
        assert!(
            names.iter().zip(&creators).all(|(a, b)| *a == b),
            "{names:?} {creators:?}"
        );
        assert!(rss.find("MIKEY-SECRET") < rss.find("GRACE-SECRET"));
        let page = built(&format!(
            "{}/index.html",
            item["url"]
                .as_str()
                .unwrap()
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap()
        ));
        assert!(page.find("MIKEY-SECRET") < page.find("GRACE-SECRET"));
        for text in [&rss, &page] {
            assert!(!text.contains("approvedAt") && !text.contains("grace-admin"));
        }

        let after = state_trees(&f);
        assert_ne!(after[0], before[0]);

        // A retry, by anyone who may publish, is idempotent and writes nothing.
        for who in [&ada, &mikey, &ada] {
            let again = publish_as(&f, who, &id);
            assert_eq!(again.status, 200);
            assert_eq!(body_json(&again)["alreadyPublished"], true);
            assert_eq!(state_trees(&f), after);
        }
        // Once published, approvals can no longer be changed.
        assert_eq!(approve_as(&f, &mikey, &id).status, 409);
        assert_eq!(
            post_api(
                &f,
                &mikey,
                "approve/withdraw",
                json!({ "publicationId": id })
            )
            .status,
            409
        );
        assert_eq!(
            schedule_as(&f, &ada, &id, json!("2099-01-01T00:00:00Z")).status,
            409
        );
        assert_eq!(state_trees(&f), after);
    }

    #[test]
    fn a_stale_approval_blocks_publishing_and_the_reapproved_piece_is_what_publishes() {
        let (f, mikey, grace, ada, id) = approval_fixture("stale-approval");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        // Mikey edits after both approved: his approval no longer matches and is dropped.
        assert_eq!(draft_call(&f, &mikey, &id, 1, "MIKEY-NEWER").status, 200);
        let approvals = f.dir.join(format!(
            ".openblog/private/collaboration/approvals/{id}.json"
        ));
        let stored: Json = serde_json::from_str(&fs::read_to_string(&approvals).unwrap()).unwrap();
        assert_eq!(stored["approvals"].as_array().unwrap().len(), 1);
        let before = state_trees(&f);
        for who in [&ada, &mikey] {
            let refused = publish_as(&f, who, &id);
            assert_eq!(refused.status, 409);
            assert_no_prose(&refused);
            assert_eq!(body_json(&refused)["missing"], json!(["Mikey"]));
        }
        assert_eq!(state_trees(&f), before);
        assert!(published_post(&f, &id).is_none());

        // Stale consent cannot be revived by reverting the text: a revert is a new revision.
        assert_eq!(draft_call(&f, &mikey, &id, 2, "MIKEY-SECRET").status, 200);
        assert_eq!(publish_as(&f, &ada, &id).status, 409);

        // He reads the piece again and approves exactly what is there now.
        assert_eq!(draft_call(&f, &mikey, &id, 3, "MIKEY-NEWER").status, 200);
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        let post = published_post(&f, &id).unwrap();
        assert!(post.contains("MIKEY-NEWER") && post.contains("GRACE-SECRET"));
        assert!(!post.contains("MIKEY-SECRET"));
    }

    // ---- Layout and arrangement (ADR 0031) ----

    fn arrangement_read(f: &Fixture, who: &(String, String), id: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/reflection?publicationId={id}"),
                ),
                who,
                false,
            ),
        )
    }

    fn arrangement_write(
        f: &Fixture,
        who: &(String, String),
        csrf: bool,
        id: &str,
        expected: u64,
        structure: Json,
    ) -> Response {
        handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/collaboration/reflection",
                    json!({ "publicationId": id, "expectedRevision": expected, "structure": structure }),
                ),
                who,
                csrf,
            ),
        )
    }

    fn arrangement(layout: &str, revision: u64, order: &[&str]) -> Json {
        json!({
            "version": 1,
            "revision": revision,
            "layout": layout,
            "rounds": [{
                "id": "round-1",
                "roundPrompt": "What stood out?",
                "turns": order.iter().map(|p| json!({ "draft": p, "part": 0 })).collect::<Vec<_>>(),
            }],
        })
    }

    fn participant_ids(f: &Fixture, who: &(String, String), id: &str) -> Vec<String> {
        body_json(&arrangement_read(f, who, id))["participants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn arranging_is_deny_by_default_csrf_checked_and_revision_checked() {
        let (f, mikey, grace, ada, id) = approval_fixture("arrange-gate");
        let ids = participant_ids(&f, &mikey, &id);
        let order: Vec<&str> = ids.iter().map(String::as_str).collect();
        let first = arrangement("sideBySide", 1, &order);

        // Members read it; only the grant holders can change it.
        let read = body_json(&arrangement_read(&f, &grace, &id));
        assert_eq!(read["canArrange"], json!(false));
        assert_eq!(read["structure"], Json::Null);
        assert_eq!(
            body_json(&arrangement_read(&f, &ada, &id))["canArrange"],
            json!(true)
        );
        let before = state_trees(&f);
        assert_eq!(
            arrangement_write(&f, &grace, true, &id, 0, first.clone()).status,
            404
        );
        // No session token, no CSRF header: refused before anything is read.
        assert_eq!(
            arrangement_write(&f, &ada, false, &id, 0, first.clone()).status,
            403
        );
        assert_eq!(
            handle(
                &f.state,
                &json_req(
                    "PUT",
                    "/admin/api/collaboration/reflection",
                    json!({ "publicationId": id, "expectedRevision": 0, "structure": first }),
                )
            )
            .status,
            401
        );
        // An unknown publication reads like a denied one.
        assert_eq!(
            arrangement_write(&f, &ada, true, "shared-000000000000", 0, first.clone()).status,
            404
        );
        assert_eq!(state_trees(&f), before);

        // A bad layout, an identity-bearing field, a stranger and a wrong revision change nothing.
        for (expected, bad, status) in [
            (0, arrangement("leftRight", 1, &order), 422),
            (0, arrangement("sideBySide", 1, &["nobody"]), 422),
            (0, arrangement("sideBySide", 2, &order), 422),
            (1, arrangement("sideBySide", 1, &order), 409),
        ] {
            assert_eq!(
                arrangement_write(&f, &ada, true, &id, expected, bad).status,
                status
            );
        }
        let mut gendered = first.clone();
        gendered["rounds"][0]["turns"][0]["side"] = json!("left");
        assert_eq!(
            arrangement_write(&f, &ada, true, &id, 0, gendered).status,
            422
        );
        assert_eq!(state_trees(&f), before);

        // The coordinator stores it; a second write must name the revision it read.
        let saved = arrangement_write(&f, &ada, true, &id, 0, first.clone());
        assert_eq!(
            saved.status,
            200,
            "{}",
            String::from_utf8_lossy(&saved.body)
        );
        let again = arrangement_write(&f, &ada, true, &id, 0, first.clone());
        assert_eq!(again.status, 409);
        let next = arrangement("sequential", 2, &order);
        assert_eq!(
            arrangement_write(&f, &mikey, true, &id, 1, next).status,
            200
        );
        let read = body_json(&arrangement_read(&f, &grace, &id));
        assert_eq!(read["structure"]["layout"], json!("sequential"));
        assert_eq!(read["structure"]["revision"], json!(2));
        // Nothing in it is prose or identity.
        let text = serde_json::to_string(&read).unwrap();
        assert!(!text.contains("SECRET") && !text.contains("admin"));

        // The three remaining layouts are accepted, with optional labels, and hostile labels are
        // refused without changing anything.
        for (revision, layout) in ["pointCounterpoint", "alternatingDialogue", "roundtable"]
            .into_iter()
            .enumerate()
        {
            let mut labelled = arrangement(layout, 3 + revision as u64, &order);
            labelled["rounds"][0]["turns"][0]["label"] = json!("Point <b>one</b>");
            assert_eq!(
                arrangement_write(&f, &ada, true, &id, 2 + revision as u64, labelled).status,
                200,
                "{layout}"
            );
        }
        let before = state_trees(&f);
        for bad in ["two\nlines", "", &"x".repeat(81), "\u{202e}flip"] {
            let mut hostile = arrangement("roundtable", 6, &order);
            hostile["rounds"][0]["turns"][0]["label"] = json!(bad);
            assert_eq!(
                arrangement_write(&f, &ada, true, &id, 5, hostile).status,
                422,
                "{bad:?}"
            );
        }
        assert_eq!(state_trees(&f), before);
    }

    #[test]
    fn an_arrangement_change_makes_standing_approvals_stale_at_the_real_gate_and_publishes_in_order(
    ) {
        let (f, mikey, grace, ada, id) = approval_fixture("arrange-stale");
        let ids = participant_ids(&f, &mikey, &id);
        // Reading order: the other author first.
        let order: Vec<&str> = ids.iter().rev().map(String::as_str).collect();
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let approvals_path = f.dir.join(format!(
            ".openblog/private/collaboration/approvals/{id}.json"
        ));
        let standing = fs::read(&approvals_path).unwrap();

        assert_eq!(
            arrangement_write(&f, &ada, true, &id, 0, arrangement("sequential", 1, &order)).status,
            200
        );
        // The write dropped the approvals it invalidated, and publication is refused.
        let stored: Json = serde_json::from_slice(&fs::read(&approvals_path).unwrap()).unwrap();
        assert_eq!(stored["approvals"].as_array().unwrap().len(), 0);
        // Even with the old approvals put back byte for byte, the gate itself sees them stale.
        fs::write(&approvals_path, &standing).unwrap();
        let before = state_trees(&f);
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 409);
        assert_no_prose(&refused);
        assert_eq!(body_json(&refused)["missing"], json!(["Mikey", "Grace"]));
        assert_eq!(state_trees(&f), before);
        assert!(published_post(&f, &id).is_none());

        // The authors read the arranged piece and approve it.
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        let post = published_post(&f, &id).unwrap();
        assert!(
            post.find("GRACE-SECRET") < post.find("MIKEY-SECRET"),
            "{post}"
        );
        assert!(post.contains("ob-reflection-sequential"));
        assert!(!post.contains("openblog:part"));
        // Once published, the arrangement is closed.
        assert_eq!(
            arrangement_write(&f, &ada, true, &id, 1, arrangement("sideBySide", 2, &order)).status,
            409
        );
    }

    #[test]
    fn a_layout_change_alone_blocks_the_gate_and_the_preview_follows_the_arrangement() {
        let (f, mikey, grace, ada, id) = approval_fixture("arrange-layout");
        let ids = participant_ids(&f, &mikey, &id);
        let order: Vec<&str> = ids.iter().map(String::as_str).collect();
        assert_eq!(
            arrangement_write(&f, &ada, true, &id, 0, arrangement("sequential", 1, &order)).status,
            200
        );
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let approvals_path = f.dir.join(format!(
            ".openblog/private/collaboration/approvals/{id}.json"
        ));
        let standing = fs::read(&approvals_path).unwrap();
        assert_eq!(
            arrangement_write(&f, &ada, true, &id, 1, arrangement("sideBySide", 2, &order)).status,
            200
        );
        fs::write(&approvals_path, &standing).unwrap();
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 409);
        assert_eq!(body_json(&refused)["missing"], json!(["Mikey", "Grace"]));
        // The preview is arranged and carries the binding of this arrangement.
        let shown = preview_call(&f, &mikey, &id);
        let body = body_json(&shown);
        let document = preview_document_text(&f, &mikey, &body);
        assert!(document.contains("ob-reflection-side-by-side"));
        assert!(!document.contains("openblog:part"));
        assert_eq!(body["preview"]["complete"], json!(true));
    }

    #[test]
    fn a_removed_author_takes_every_approval_with_them_and_blocks_publishing() {
        let (f, mikey, grace, ada, id) = approval_fixture("removed-author");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let record = stored_record(&f, &id);
        let grace_id = record
            .authorization
            .bindings
            .iter()
            .find(|b| b.admin_user == "grace")
            .unwrap()
            .participant_id
            .clone();
        let removed = post_api(
            &f,
            &mikey,
            "members/remove",
            json!({ "publicationId": id, "participantId": grace_id, "expectedRevision": record.authorization.revision }),
        );
        assert_eq!(removed.status, 200);
        // The author set changed, so no approval covers the new piece; they were dropped durably.
        let stored: Json = serde_json::from_str(
            &fs::read_to_string(f.dir.join(format!(
                ".openblog/private/collaboration/approvals/{id}.json"
            )))
            .unwrap(),
        )
        .unwrap();
        assert!(stored["approvals"].as_array().unwrap().is_empty());
        let before = state_trees(&f);
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 409);
        assert_eq!(body_json(&refused)["missing"], json!(["Mikey"]));
        // The removed author can no longer approve, read the preview or publish.
        assert_eq!(
            post_api(
                &f,
                &grace,
                "approve",
                json!({ "publicationId": id, "seen": "x", "affirmed": true })
            )
            .status,
            404
        );
        assert_eq!(publish_as(&f, &grace, &id).status, 404);
        assert_eq!(state_trees(&f), before);
    }

    #[test]
    fn scheduling_holds_the_piece_privately_and_checks_again_when_it_falls_due() {
        let (f, mikey, grace, ada, id) = approval_fixture("schedule-gate");
        let at = DateTime::from_unix(clock::now().unix() + 3600).rfc3339();
        let before = state_trees(&f);

        // Unapproved, past, malformed, unauthorised: nothing is held.
        assert_eq!(schedule_as(&f, &ada, &id, json!(at)).status, 409);
        for bad in [json!("2001-01-01T00:00:00Z"), json!("soon")] {
            assert_eq!(schedule_as(&f, &ada, &id, bad).status, 422);
        }
        assert_eq!(schedule_as(&f, &grace, &id, json!(at)).status, 404);
        assert_eq!(state_trees(&f), before);
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let approved = state_trees(&f);
        assert_eq!(
            schedule_as(&f, &ada, &id, json!("2001-01-01T00:00:00Z")).status,
            422
        );
        assert_eq!(state_trees(&f), approved);

        // Scheduled: only a small private file changes; content and public output do not.
        let held = schedule_as(&f, &ada, &id, json!(at));
        assert_eq!(held.status, 200, "{}", String::from_utf8_lossy(&held.body));
        assert_eq!(body_json(&held)["state"], "scheduled");
        let outcome = fs::read_to_string(outcome_file(&f, &id)).unwrap();
        assert!(!outcome.contains("SECRET") && outcome.contains("scheduled"));
        let scheduled = state_trees(&f);
        assert_eq!(scheduled[0], before[0]);
        assert_eq!(scheduled[1], before[1]);
        assert_eq!(schedule_as(&f, &ada, &id, json!(at)).status, 200);
        assert_eq!(state_trees(&f), scheduled);
        assert!(f.state.tick_scheduler().is_none());
        assert!(published_post(&f, &id).is_none());

        // Time passes, but Mikey edited first: the schedule holds and publishes nothing.
        let due = openblog_core::assembly::Outcome::scheduled(clock::now().unix() - 60, "ada");
        fs::write(outcome_file(&f, &id), format!("{}\n", due.to_json())).unwrap();
        assert_eq!(draft_call(&f, &mikey, &id, 1, "MIKEY-NEWER").status, 200);
        let content = tree_snapshot(&f.dir.join("content"));
        let public = tree_snapshot(&f.dir.join("dist"));
        f.state.tick_scheduler();
        assert!(published_post(&f, &id).is_none());
        assert_eq!(tree_snapshot(&f.dir.join("content")), content);
        assert_eq!(tree_snapshot(&f.dir.join("dist")), public);
        assert!(fs::read_to_string(outcome_file(&f, &id))
            .unwrap()
            .contains("scheduled"));

        // Approved again, the next tick publishes it, dated at its scheduled time.
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        f.state.tick_scheduler();
        let post = published_post(&f, &id).expect("published when due and approved");
        assert!(post.contains("MIKEY-NEWER") && post.contains("GRACE-SECRET"));
        assert!(fs::read_to_string(outcome_file(&f, &id))
            .unwrap()
            .contains("published"));
        let done = state_trees(&f);
        f.state.tick_scheduler();
        assert_eq!(state_trees(&f), done);
    }

    #[test]
    fn a_schedule_can_be_cancelled_and_dies_with_the_schedulers_grant() {
        let (f, mikey, grace, ada, id) = approval_fixture("schedule-cancel");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let at = DateTime::from_unix(clock::now().unix() + 3600).rfc3339();
        assert_eq!(schedule_as(&f, &ada, &id, json!(at)).status, 200);
        assert!(outcome_file(&f, &id).exists());
        assert_eq!(schedule_as(&f, &ada, &id, Json::Null).status, 200);
        assert!(!outcome_file(&f, &id).exists());
        assert_eq!(schedule_as(&f, &grace, &id, Json::Null).status, 404);

        // Ada schedules, then loses her role: when due, the schedule no longer authorises.
        assert_eq!(schedule_as(&f, &ada, &id, json!(at)).status, 200);
        let record = stored_record(&f, &id);
        let ada_id = record
            .authorization
            .bindings
            .iter()
            .find(|b| b.admin_user == "ada")
            .unwrap()
            .participant_id
            .clone();
        let changed = post_api(
            &f,
            &mikey,
            "members/roles",
            json!({ "publicationId": id, "participantId": ada_id, "roles": ["reader"], "expectedRevision": record.authorization.revision }),
        );
        assert_eq!(changed.status, 200);
        let due = openblog_core::assembly::Outcome::scheduled(clock::now().unix() - 60, "ada");
        fs::write(outcome_file(&f, &id), format!("{}\n", due.to_json())).unwrap();
        f.state.tick_scheduler();
        assert!(published_post(&f, &id).is_none());
    }

    #[test]
    fn a_failure_after_the_files_are_written_restores_content_state_and_output() {
        let (f, mikey, grace, ada, id) = approval_fixture("publish-rollback");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let content = tree_snapshot(&f.dir.join("content"));
        let private = tree_snapshot(&f.dir.join(".openblog/private"));
        // The rebuild that follows the write cannot run: the output folder is a file.
        fs::remove_dir_all(f.dir.join("dist")).unwrap();
        fs::write(f.dir.join("dist"), "not a folder").unwrap();
        let failed = publish_as(&f, &ada, &id);
        assert_eq!(failed.status, 500);
        assert_no_prose(&failed);
        assert_eq!(tree_snapshot(&f.dir.join("content")), content);
        assert_eq!(tree_snapshot(&f.dir.join(".openblog/private")), private);
        assert!(published_post(&f, &id).is_none() && !outcome_file(&f, &id).exists());
        assert_eq!(fs::read(f.dir.join("dist")).unwrap(), b"not a folder");

        // With the output folder back, the very same request succeeds exactly once.
        fs::remove_file(f.dir.join("dist")).unwrap();
        f.state.rebuild().unwrap();
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        assert!(published_post(&f, &id).is_some());
    }

    #[test]
    fn an_interrupted_publish_is_finished_by_a_retry_without_a_second_post() {
        let (f, mikey, grace, ada, id) = approval_fixture("publish-adopt");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        let post = published_post(&f, &id).unwrap();
        let credits = fs::read(f.dir.join(format!("content/posts/{id}.credits.json"))).unwrap();
        // Simulate a crash after the files but before the outcome: the outcome is lost.
        fs::remove_file(outcome_file(&f, &id)).unwrap();
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        assert_eq!(published_post(&f, &id).unwrap(), post);
        assert_eq!(
            fs::read(f.dir.join(format!("content/posts/{id}.credits.json"))).unwrap(),
            credits
        );
        let shared = |f: &Fixture| {
            fs::read_dir(f.dir.join("content/posts"))
                .unwrap()
                .filter(|e| {
                    e.as_ref()
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with("shared-")
                })
                .count()
        };
        assert_eq!(shared(&f), 2, "one Post and its credits, never a second");

        // A different file in the Post's place is never overwritten.
        fs::remove_file(outcome_file(&f, &id)).unwrap();
        fs::write(
            f.dir.join(format!("content/posts/{id}.md")),
            "---\ntitle: Mine\ndate: 2020-01-01\n---\nMy own post\n",
        )
        .unwrap();
        let before = state_trees(&f);
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 409);
        assert_eq!(state_trees(&f), before);
    }

    #[test]
    fn concurrent_publishers_and_an_editor_never_publish_an_unapproved_revision() {
        let (f, mikey, grace, ada, id) = approval_fixture("publish-race");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let results = std::thread::scope(|scope| {
            let publishers: Vec<_> = (0..4)
                .map(|_| scope.spawn(|| publish_as(&f, &ada, &id).status))
                .collect();
            let editor = scope.spawn(|| draft_call(&f, &mikey, &id, 1, "MIKEY-NEWER").status);
            let published: Vec<u16> = publishers.into_iter().map(|t| t.join().unwrap()).collect();
            (published, editor.join().unwrap())
        });
        let (published, _edit) = results;
        match published_post(&f, &id) {
            // The edit came last: the piece published is the approved one, once.
            Some(post) => {
                assert!(!post.contains("MIKEY-NEWER") && post.contains("MIKEY-SECRET"));
                // A caller can also lose its wait for the content lock under load; what matters
                // is that exactly one publication happened.
                assert!(published.contains(&200), "{published:?}");
                assert!(outcome_file(&f, &id).exists());
            }
            // The edit came first: every attempt was refused and nothing was written.
            None => {
                assert!(
                    published.iter().all(|status| *status != 200),
                    "{published:?}"
                );
                assert!(!outcome_file(&f, &id).exists());
            }
        }
        let shared_posts = fs::read_dir(f.dir.join("content/posts"))
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with("shared-")
            })
            .count();
        assert!(
            shared_posts == 0 || shared_posts == 2,
            "post and credits only"
        );
    }

    #[test]
    fn raw_html_and_active_links_in_a_section_refuse_publication_without_echoing_it() {
        let (f, mikey, grace, ada, id) = approval_fixture("publish-hostile");
        assert_eq!(
            draft_call(
                &f,
                &grace,
                &id,
                1,
                "GRACE-SECRET <script>alert(1)</script> [x](javascript:alert(1))"
            )
            .status,
            200
        );
        for (who, revision) in [(&mikey, 1), (&grace, 2)] {
            assert_eq!(
                reveal_call(&f, who, "ready", ready_body(&id, json!(revision))).status,
                200
            );
        }
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let before = state_trees(&f);
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 422);
        assert_no_prose(&refused);
        assert!(!String::from_utf8_lossy(&refused.body).contains("script"));
        assert_eq!(
            schedule_as(
                &f,
                &ada,
                &id,
                json!(DateTime::from_unix(clock::now().unix() + 3600).rfc3339())
            )
            .status,
            422
        );
        assert_eq!(state_trees(&f), before);
    }

    // ---- shared synthesis (ADR 0025)

    fn participant_of(f: &Fixture, id: &str, admin_user: &str) -> String {
        stored_record(f, id)
            .authorization
            .bindings
            .iter()
            .find(|b| b.admin_user == admin_user)
            .unwrap()
            .participant_id
            .clone()
    }

    fn synthesis_read(f: &Fixture, who: &Session, id: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req(
                    "GET",
                    &format!("/admin/api/collaboration/synthesis?publicationId={id}"),
                ),
                who,
                false,
            ),
        )
    }

    fn synthesis_change(
        f: &Fixture,
        who: &Session,
        id: &str,
        expected: u64,
        change: Json,
    ) -> Response {
        post_api(
            f,
            who,
            "synthesis",
            json!({ "publicationId": id, "expectedRevision": expected, "change": change }),
        )
    }

    fn synthesis_revision(f: &Fixture, who: &Session, id: &str) -> u64 {
        body_json(&synthesis_read(f, who, id))["revision"]
            .as_u64()
            .unwrap()
    }

    fn add_item(f: &Fixture, who: &Session, id: &str, text: &str, others: &[&str]) -> Response {
        let revision = synthesis_revision(f, who, id);
        synthesis_change(
            f,
            who,
            id,
            revision,
            json!({ "action": "add", "kind": "agreement", "markdown": text, "others": others }),
        )
    }

    fn item_id(response: &Response, index: usize) -> String {
        body_json(response)["items"][index]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn synthesis_is_private_revision_checked_and_denied_by_default() {
        let (f, mikey, grace, ada, id) = approval_fixture("synthesis-private");
        let grace_id = participant_of(&f, &id, "grace");
        let content_before = tree_snapshot(&f.dir.join("content"));
        let dist_before = tree_snapshot(&f.dir.join("dist"));

        // A single character is a valid item; nothing has a minimum length.
        let added = add_item(&f, &mikey, &id, "x", &[&grace_id]);
        assert_eq!(
            added.status,
            200,
            "{}",
            String::from_utf8_lossy(&added.body)
        );
        let item = item_id(&added, 0);
        let seen = body_json(&synthesis_read(&f, &grace, &id));
        assert_eq!(seen["items"][0]["markdown"], "x");
        assert_eq!(
            seen["items"][0]["contributors"].as_array().unwrap().len(),
            2
        );

        // A coordinator who is not an author, an unknown publication and no session all get the
        // same refusal, for reads and writes.
        let unknown = synthesis_read(&f, &mikey, "shared-ffffffffffff");
        assert_eq!(unknown.status, 404);
        let denied = synthesis_read(&f, &ada, &id);
        assert_eq!(denied.status, 404);
        assert_eq!(denied.body, unknown.body);
        let write = synthesis_change(
            &f,
            &ada,
            &id,
            0,
            json!({ "action": "add", "kind": "question", "markdown": "ADA-LEAK", "others": [] }),
        );
        assert_eq!(write.status, 404);
        assert_eq!(write.body, unknown.body);
        let anonymous = handle(
            &f.state,
            &req(
                "GET",
                &format!("/admin/api/collaboration/synthesis?publicationId={id}"),
            ),
        );
        assert_eq!(anonymous.status, 401);

        // Concurrent state: a stale revision is a conflict and stores nothing.
        let stale = synthesis_change(
            &f,
            &grace,
            &id,
            0,
            json!({ "action": "approve", "id": item }),
        );
        assert_eq!(stale.status, 409);
        // Untrusted input fails safely: empty prose, an unknown author, unknown fields, an
        // item that does not exist.
        let revision = synthesis_revision(&f, &mikey, &id);
        for (bad, status) in [
            (
                json!({ "action": "add", "kind": "agreement", "markdown": "  ", "others": [] }),
                422,
            ),
            (
                json!({ "action": "add", "kind": "agreement", "markdown": "ok", "others": ["nobody"] }),
                422,
            ),
            (
                json!({ "action": "add", "kind": "agreement", "markdown": "ok", "extra": 1 }),
                422,
            ),
            (json!({ "action": "approve", "id": "syn-99" }), 404),
        ] {
            assert_eq!(
                synthesis_change(&f, &mikey, &id, revision, bad).status,
                status
            );
        }
        // Sent with a smuggled participant, the request is refused as malformed.
        let smuggled = post_api(
            &f,
            &mikey,
            "synthesis",
            json!({ "publicationId": id, "expectedRevision": revision, "participantId": grace_id,
                    "change": { "action": "approve", "id": item } }),
        );
        assert_eq!(smuggled.status, 422);

        // Prose stays private: it is not in the combined preview summary and the file sits under
        // the private directory only.
        let preview = body_json(&preview_call(&f, &mikey, &id));
        assert!(!preview.to_string().contains("ADA-LEAK"));
        assert_eq!(
            preview["preview"]["items"][0]["awaiting"],
            json!(["Mikey", "Grace"])
        );
        assert_eq!(tree_snapshot(&f.dir.join("content")), content_before);
        assert_eq!(tree_snapshot(&f.dir.join("dist")), dist_before);
        assert!(f
            .dir
            .join(crate::shared_publications::SYNTHESIS_DIRECTORY)
            .join(format!("{id}.json"))
            .is_file());
    }

    #[test]
    fn unapproved_synthesis_blocks_publishing_and_never_reaches_public_output() {
        let (f, mikey, grace, ada, id) = approval_fixture("synthesis-gate");
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let grace_id = participant_of(&f, &id, "grace");
        let added = add_item(&f, &mikey, &id, "SYNTH-PROSE we differ.", &[&grace_id]);
        let item = item_id(&added, 0);
        // The standing approvals no longer cover the piece with its new item.
        let before = state_trees(&f);
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 409);
        assert!(!String::from_utf8_lossy(&refused.body).contains("SYNTH-PROSE"));
        assert_eq!(state_trees(&f), before);
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        // Whole-piece approval is not item approval: the item itself still awaits both authors.
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 409);
        assert_eq!(body_json(&refused)["missing"], json!(["Mikey", "Grace"]));
        for who in [&mikey, &grace] {
            let revision = synthesis_revision(&f, who, &id);
            let approved = synthesis_change(
                &f,
                who,
                &id,
                revision,
                json!({ "action": "approve", "id": item }),
            );
            assert_eq!(approved.status, 200);
        }
        let shown = body_json(&synthesis_read(&f, &grace, &id));
        assert_eq!(shown["items"][0]["awaiting"], json!([]));
        // An edit puts both back to awaiting and stales the piece approvals; nothing publishes.
        let revision = synthesis_revision(&f, &mikey, &id);
        assert_eq!(
            synthesis_change(
                &f,
                &mikey,
                &id,
                revision,
                json!({ "action": "edit", "id": item, "markdown": "SYNTH-PROSE changed." }),
            )
            .status,
            200
        );
        assert_eq!(publish_as(&f, &ada, &id).status, 409);
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
            let revision = synthesis_revision(&f, who, &id);
            assert_eq!(
                synthesis_change(
                    &f,
                    who,
                    &id,
                    revision,
                    json!({ "action": "approve", "id": item }),
                )
                .status,
                200
            );
        }
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        // Only the fully approved current text publishes, attributed and under its own heading,
        // with no approver list or internal id.
        let post = published_post(&f, &id).unwrap();
        assert!(post.contains("SYNTH-PROSE changed.") && !post.contains("we differ."));
        assert!(
            post.contains("### Shared takeaways")
                && post.contains("#### Speaking for Mikey, Grace")
        );
        assert!(!post.contains("syn-") && !post.contains("Approved by"));
    }

    #[test]
    fn an_item_that_breaks_the_markup_rule_refuses_publication_and_names_the_item() {
        let (f, mikey, grace, ada, id) = approval_fixture("synthesis-unsafe-item");
        let grace_id = participant_of(&f, &id, "grace");
        assert_eq!(add_item(&f, &mikey, &id, "Fine.", &[&grace_id]).status, 200);
        let added = add_item(&f, &mikey, &id, "ITEM-SECRET <b>x</b>", &[&grace_id]);
        assert_eq!(added.status, 200);
        for index in 0..2 {
            let item = item_id(&added, index);
            for who in [&mikey, &grace] {
                let revision = synthesis_revision(&f, who, &id);
                assert_eq!(
                    synthesis_change(
                        &f,
                        who,
                        &id,
                        revision,
                        json!({ "action": "approve", "id": item }),
                    )
                    .status,
                    200
                );
            }
        }
        for who in [&mikey, &grace] {
            assert_eq!(approve_as(&f, who, &id).status, 200);
        }
        let before = state_trees(&f);
        let refused = publish_as(&f, &ada, &id);
        assert_eq!(refused.status, 422);
        let text = String::from_utf8_lossy(&refused.body).to_string();
        assert!(text.contains("the second shared takeaway"), "{text}");
        assert!(text.contains("continuing conversation"), "{text}");
        assert!(
            !text.contains("ITEM-SECRET") && !text.contains("<b>"),
            "{text}"
        );
        assert!(!text.contains("A section contains"), "{text}");
        assert_eq!(state_trees(&f), before);
    }

    #[test]
    fn an_item_that_claims_a_generated_anchor_is_refused_on_save_with_the_rule_named() {
        let (f, mikey, _grace, _ada, id) = approval_fixture("synthesis-reserved-item");
        let before = synthesis_revision(&f, &mikey, &id);
        let refused = add_item(&f, &mikey, &id, "##### Conversation agreement 1", &[]);
        assert_eq!(refused.status, 422);
        let text = String::from_utf8_lossy(&refused.body).to_string();
        assert!(
            text.contains("reserved for the generated conversation"),
            "{text}"
        );
        assert!(!text.contains("##### Conversation"), "{text}");
        assert_eq!(synthesis_revision(&f, &mikey, &id), before);
        // A heading that only looks similar is fine.
        assert_eq!(
            add_item(&f, &mikey, &id, "##### Conversation starters", &[]).status,
            200
        );
    }

    #[test]
    fn an_editor_s_combined_preview_carries_no_synthesis_prose_or_names() {
        let (f, mikey, id) = invitation_fixture("preview-synthesis-editor");
        let grace = join_via_api(
            &f,
            &mikey,
            &id,
            "grace",
            "another correct horse",
            json!(["contributor"]),
        );
        let linus = join_via_api(
            &f,
            &mikey,
            &id,
            "linus",
            "yet another horse",
            json!(["editor"]),
        );
        for who in [&mikey, &grace, &linus] {
            assert_eq!(draft_call(&f, who, &id, 0, "A section.").status, 200);
        }
        let grace_id = participant_of(&f, &id, "grace");
        let added = add_item(&f, &mikey, &id, "SYNTHESIS-LEAK-PROSE", &[&grace_id]);
        assert_eq!(added.status, 200);

        let author = body_json(&preview_call(&f, &mikey, &id));
        assert_eq!(author["preview"]["items"].as_array().unwrap().len(), 1);
        let document = preview_document_text(&f, &mikey, &author);
        assert!(document.contains("SYNTHESIS-LEAK-PROSE"));

        let editor = preview_call(&f, &linus, &id);
        assert_eq!(editor.status, 200);
        let body = body_json(&editor);
        assert!(body["preview"]["items"].as_array().unwrap().is_empty());
        let document = preview_document_text(&f, &linus, &body);
        let everything = format!("{body}{document}");
        assert!(!everything.contains("SYNTHESIS-LEAK-PROSE"));
        assert!(!everything.contains("Continuing conversation"));
        assert!(!everything.contains("Continuing the conversation"));
        assert!(!everything.contains("speaking for"));
    }

    #[test]
    fn synthesis_follows_the_author_set_and_withdrawal_drops_an_orphaned_item() {
        let (f, mikey, grace, _ada, id) = approval_fixture("synthesis-reconcile");
        let grace_id = participant_of(&f, &id, "grace");
        let both = add_item(&f, &mikey, &id, "Both of us.", &[&grace_id]);
        assert_eq!(both.status, 200);
        let solo = add_item(&f, &grace, &id, "Only Grace.", &[]);
        assert_eq!(solo.status, 200);
        let solo_id = item_id(&solo, 1);
        // Mikey cannot withdraw an item he is not named on, and learns nothing.
        let revision = synthesis_revision(&f, &mikey, &id);
        let foreign = synthesis_change(
            &f,
            &mikey,
            &id,
            revision,
            json!({ "action": "withdraw", "id": solo_id }),
        );
        assert_eq!(foreign.status, 404);

        let record = stored_record(&f, &id);
        let removed = post_api(
            &f,
            &mikey,
            "members/remove",
            json!({ "publicationId": id, "participantId": grace_id, "expectedRevision": record.authorization.revision }),
        );
        assert_eq!(removed.status, 200);
        let after = body_json(&synthesis_read(&f, &mikey, &id));
        let items = after["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["contributors"].as_array().unwrap().len(), 1);
        assert_eq!(items[0]["contributors"][0]["displayName"], "Mikey");
        // The removed author reads and changes nothing.
        assert_eq!(synthesis_read(&f, &grace, &id).status, 404);

        // Mikey takes his name off his last item; it goes with it.
        let revision = synthesis_revision(&f, &mikey, &id);
        let item = items[0]["id"].as_str().unwrap().to_string();
        let gone = synthesis_change(
            &f,
            &mikey,
            &id,
            revision,
            json!({ "action": "withdraw", "id": item }),
        );
        assert_eq!(gone.status, 200);
        assert!(body_json(&gone)["items"].as_array().unwrap().is_empty());
    }

    // ---- Series placement (ADR 0038, ADR 0039) ----

    fn series_read(f: &Fixture, who: &(String, String), query: &str) -> Response {
        handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/collaboration/series?{query}")),
                who,
                false,
            ),
        )
    }

    fn series_put(f: &Fixture, who: &(String, String), body: Json) -> Response {
        handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/collaboration/series", body),
                who,
                true,
            ),
        )
    }

    fn placement_body(id: &str, revision: u64, series: &str, order: Json) -> Json {
        json!({
            "publicationId": id,
            "expectedRevision": revision,
            "placement": { "series": series, "order": order },
        })
    }

    fn approval_states(f: &Fixture, who: &(String, String), id: &str) -> Vec<String> {
        body_json(&preview_call(f, who, id))["preview"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["approval"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn owners_and_coordinators_arrange_the_series_and_every_participant_sees_it() {
        let (f, mikey, grace, ada, id) = approval_fixture("series-arrange");
        let query = format!("publicationId={id}");
        let before = state_trees(&f);

        // Every participant reads the placement; only arrangers may change it.
        let seen = body_json(&series_read(&f, &grace, &query));
        assert_eq!(seen["placement"], Json::Null);
        assert_eq!(seen["revision"], 0);
        assert_eq!(seen["canPlace"], false);
        assert_eq!(seen["canCreate"], false);
        let coordinator = body_json(&series_read(&f, &ada, &query));
        assert_eq!(
            (
                coordinator["canPlace"].clone(),
                coordinator["canCreate"].clone()
            ),
            (json!(true), json!(false))
        );
        let owner = body_json(&series_read(&f, &mikey, &query));
        assert_eq!(
            (owner["canPlace"].clone(), owner["canCreate"].clone()),
            (json!(true), json!(true))
        );

        // A participant, a stranger to the publication and an unknown publication all get the
        // same refusal, and nothing changes.
        let unknown = series_put(
            &f,
            &ada,
            placement_body("shared-ffffffffffff", 0, "Letters", json!(1)),
        );
        assert_eq!(unknown.status, 404);
        let denied = series_put(&f, &grace, placement_body(&id, 0, "Letters", json!(1)));
        assert_eq!(denied.status, 404);
        assert_eq!(denied.body, unknown.body);
        let unknown_read = series_read(&f, &grace, "publicationId=shared-ffffffffffff");
        assert_eq!(unknown_read.status, 404);
        assert_eq!(unknown_read.body, unknown.body);
        let linus = login_as(&f, "linus", "yet another horse");
        let stranger = series_read(&f, &linus, &query);
        assert_eq!((stranger.status, &stranger.body), (404, &unknown.body));
        let no_csrf = handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/collaboration/series",
                    placement_body(&id, 0, "Letters", json!(1)),
                ),
                &ada,
                false,
            ),
        );
        assert!(no_csrf.status == 401 || no_csrf.status == 403);
        let anonymous = handle(
            &f.state,
            &json_req(
                "PUT",
                "/admin/api/collaboration/series",
                placement_body(&id, 0, "Letters", json!(1)),
            ),
        );
        assert_eq!(anonymous.status, 401);
        let anonymous_read = req("GET", &format!("/admin/api/collaboration/series?{query}"));
        assert_eq!(handle(&f.state, &anonymous_read).status, 401);
        // Bad input is refused by rule and never echoed.
        for body in [
            placement_body(&id, 0, "Line\nbreak MARKER", json!(1)),
            placement_body(&id, 0, "!!!", json!(1)),
        ] {
            let refused = series_put(&f, &ada, body);
            assert_eq!(refused.status, 422);
            assert_eq!(body_json(&refused)["field"], "series");
            assert!(!String::from_utf8_lossy(&refused.body).contains("MARKER"));
        }
        for body in [
            placement_body(&id, 0, "Letters", json!(-1)),
            placement_body(&id, 0, "Letters", json!("2")),
            json!({ "publicationId": id, "expectedRevision": 0, "placement": null, "theme": "x" }),
        ] {
            assert_eq!(series_put(&f, &ada, body).status, 422);
        }
        assert_eq!(state_trees(&f), before);

        // The coordinator assigns it; everyone sees the choice.
        let assigned = series_put(
            &f,
            &ada,
            placement_body(&id, 0, "Letters across time", json!(2)),
        );
        assert_eq!(
            assigned.status,
            200,
            "{}",
            String::from_utf8_lossy(&assigned.body)
        );
        let assigned = body_json(&assigned);
        assert_eq!(assigned["revision"], 1);
        assert_eq!(
            assigned["placement"],
            json!({ "series": "Letters across time", "order": 2 })
        );
        assert_eq!(assigned["preview"]["slug"], "letters-across-time");
        assert_eq!(
            body_json(&series_read(&f, &grace, &query))["placement"]["series"],
            "Letters across time"
        );
        assert_eq!(stored_record(&f, &id).series_revision, 1);

        // A change made against the older read is refused and changes nothing, even by the owner.
        let settled = state_trees(&f);
        let stale = series_put(&f, &mikey, placement_body(&id, 0, "Another", Json::Null));
        assert_eq!(stale.status, 409);
        assert_eq!(state_trees(&f), settled);

        // Reordering and removing each move the revision on.
        let moved = body_json(&series_put(
            &f,
            &mikey,
            placement_body(&id, 1, "Letters across time", json!(3)),
        ));
        assert_eq!(
            (
                moved["revision"].clone(),
                moved["placement"]["order"].clone()
            ),
            (json!(2), json!(3))
        );
        let removed = body_json(&series_put(
            &f,
            &ada,
            json!({ "publicationId": id, "expectedRevision": 2, "placement": null }),
        ));
        assert_eq!(
            (removed["revision"].clone(), removed["placement"].clone()),
            (json!(3), Json::Null)
        );
        // Arranging the series never touched canonical content or public output.
        assert_eq!(state_trees(&f)[0], before[0]);
        assert_eq!(state_trees(&f)[1], before[1]);
    }

    #[test]
    fn a_placement_change_drops_approvals_in_the_same_write_and_is_shown_in_the_preview() {
        let (f, mikey, grace, ada, id) = approval_fixture("series-consent");
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        assert_eq!(approve_as(&f, &grace, &id).status, 200);
        assert_eq!(approval_states(&f, &mikey, &id), ["approved", "approved"]);

        let placed = series_put(
            &f,
            &ada,
            placement_body(&id, 0, "Letters <across> time", json!(2)),
        );
        assert_eq!(placed.status, 200);
        // The stored approvals were dropped in that write, not merely flagged on the next read.
        let stored = fs::read_to_string(f.dir.join(format!(
            ".openblog/private/collaboration/approvals/{id}.json"
        )))
        .unwrap();
        assert!(!stored.contains("binding"), "{stored}");
        assert_eq!(approval_states(&f, &mikey, &id), ["awaiting", "awaiting"]);
        let preview = body_json(&preview_call(&f, &grace, &id));
        let text = preview_document_text(&f, &grace, &preview);
        assert!(text.contains("<strong>Series:</strong> Letters &lt;across&gt; time, part 2"));

        // Approving the piece with its placement and publishing writes the ordinary keys; after
        // that the placement is fixed here.
        assert_eq!(approve_as(&f, &mikey, &id).status, 200);
        assert_eq!(approve_as(&f, &grace, &id).status, 200);
        assert_eq!(publish_as(&f, &ada, &id).status, 200);
        let post = published_post(&f, &id).unwrap();
        assert!(post.contains("Letters <across> time"), "{post}");
        assert!(post.contains("seriesOrder: 2"), "{post}");
        let after = state_trees(&f);
        let refused = series_put(&f, &ada, placement_body(&id, 1, "Elsewhere", Json::Null));
        assert_eq!(refused.status, 409);
        assert_eq!(state_trees(&f), after);
        let view = body_json(&series_read(&f, &grace, &format!("publicationId={id}")));
        assert_eq!(view["published"], true);
        assert_eq!(view["canPlace"], false);
        // The published post is now one of the series' parts, listed once.
        let parts = view["preview"]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 1, "{parts:?}");
        assert_eq!(parts[0]["thisPublication"], false);
    }

    #[test]
    fn the_order_preview_reads_only_public_posts() {
        let (f, mikey, _grace, _ada, id) = approval_fixture("series-preview");
        let posts = f.dir.join("content/posts");
        for (name, extra) in [
            ("2026-01-01-first-part", "seriesOrder: 1\n"),
            (
                "2026-01-02-hidden-draft-marker",
                "seriesOrder: 2\ndraft: true\n",
            ),
            ("2099-01-01-future-marker", "seriesOrder: 2\n"),
            ("2026-01-03-loose-part", ""),
        ] {
            let date = &name[..10];
            fs::write(
                posts.join(format!("{name}.md")),
                format!("---\ntitle: {name}\ndate: {date}\nseries: Guides\n{extra}---\nBody.\n"),
            )
            .unwrap();
        }
        let view = series_read(
            &f,
            &mikey,
            &format!("publicationId={id}&series=Guides&order=2"),
        );
        assert_eq!(view.status, 200, "{}", String::from_utf8_lossy(&view.body));
        let text = String::from_utf8_lossy(&view.body).to_string();
        assert!(!text.contains("marker"), "{text}");
        let view = body_json(&view);
        let order: Vec<String> = view["preview"]["parts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|part| part["title"].as_str().unwrap_or("THIS").to_string())
            .collect();
        assert_eq!(
            order,
            ["2026-01-01-first-part", "THIS", "2026-01-03-loose-part"]
        );
        assert_eq!(view["series"][0]["slug"], "guides");
        assert_eq!(view["series"][0]["parts"], 2);
        // Previewing stores nothing.
        assert_eq!(stored_record(&f, &id).series, None);
        let bad = series_read(
            &f,
            &mikey,
            &format!("publicationId={id}&series=Guides&order=-1"),
        );
        assert_eq!(
            (bad.status, body_json(&bad)["field"].clone()),
            (422, json!("order"))
        );
    }

    #[test]
    fn only_a_site_owner_creates_a_series_definition_and_never_over_an_existing_one() {
        let (f, mikey, grace, ada, id) = approval_fixture("series-create");
        let create = |who: &(String, String), body: Json| post_api(&f, who, "series/create", body);
        let body = |title: &str, premise: &str| json!({ "publicationId": id, "title": title, "premise": premise });
        let before = state_trees(&f);
        let unknown = create(
            &mikey,
            json!({ "publicationId": "shared-ffffffffffff", "title": "Letters", "premise": "" }),
        );
        assert_eq!(unknown.status, 404);
        for who in [&ada, &grace] {
            let denied = create(who, body("Letters", "A premise."));
            assert_eq!((denied.status, &denied.body), (404, &unknown.body));
        }
        let invalid = create(&mikey, body("Line\nbreak", ""));
        assert_eq!(
            (invalid.status, body_json(&invalid)["field"].clone()),
            (422, json!("title"))
        );
        let invalid = create(&mikey, body("Letters", "two\nlines"));
        assert_eq!(
            (invalid.status, body_json(&invalid)["field"].clone()),
            (422, json!("premise"))
        );
        assert_eq!(state_trees(&f), before);

        let made = create(
            &mikey,
            body(
                "Letters across time",
                "Each <b>season</b> two writers answer one letter.",
            ),
        );
        assert_eq!(made.status, 201, "{}", String::from_utf8_lossy(&made.body));
        assert_eq!(body_json(&made)["slug"], "letters-across-time");
        let file = fs::read_to_string(f.dir.join("content/series/letters-across-time.md")).unwrap();
        assert!(file.contains("name: Letters across time"));
        // An empty series has no public page, so public output is unchanged until a part is
        // published; the premise is stored escaped, so it can only ever read as text.
        assert_eq!(state_trees(&f)[1], before[1]);
        assert!(
            file.contains(r"Each \<b\>season\<\/b\> two writers"),
            "{file}"
        );
        // It places nothing, and the new series is offered to everyone choosing.
        assert_eq!(stored_record(&f, &id).series, None);
        let view = body_json(&series_read(&f, &grace, &format!("publicationId={id}")));
        assert!(view["series"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["slug"] == "letters-across-time" && s["defined"] == true));

        // A second definition at the same address is refused and the first is untouched.
        let again = create(&mikey, body("Letters  Across  Time!", "Other premise."));
        assert_eq!(again.status, 409);
        assert_eq!(
            fs::read_to_string(f.dir.join("content/series/letters-across-time.md")).unwrap(),
            file
        );
    }
}

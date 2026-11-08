//! Publishing an approved video release to YouTube (epic #386, story #400, ADRs 0378 to 0380).
//!
//! Off until the author opts in, twice: `openblog youtube connect` grants open.blog a Google
//! refresh token (with the deployer's own OAuth client from the environment), and
//! `openblog video <slug> --approve <digest>` approves one previewed release for one file. Only
//! then does `--upload` send anything: a private video through a resumable session, then its
//! thumbnail. Every step that may or may not have reached Google is recorded before it is sent, so
//! a lost reply is resumed, looked up or settled by a person, and never silently uploaded twice.
//!
//! The refresh token is stored in `.openblog/private/youtube/credential`, protected with the
//! operating system's per-user encryption on Windows and owner-only permissions elsewhere, and the
//! private upload record (which holds the resumable session address) the same way. The access
//! token lives only in memory. Nothing here is read by a build, a feed or an export.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use blake2::{Blake2b512, Digest};
use openblog_core::social_schedule::parse_schedule_with;
use openblog_core::video_upload::{
    self, ApprovalError, Failure, FileFingerprint, LookupOutcome, Settlement, ThumbnailState,
    Upload, UploadRecord, UploadState, VideoApproval,
};
use openblog_core::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use ureq::config::Config;

use crate::video_release::Prepared;
use crate::{auth, fsutil, safe_http};

const CLIENT_ID_VARIABLE: &str = "OPENBLOG_YOUTUBE_CLIENT_ID";
const CLIENT_SECRET_VARIABLE: &str = "OPENBLOG_YOUTUBE_CLIENT_SECRET";
const CREDENTIAL_FILE: &str = ".openblog/private/youtube/credential";
const RECORDS_FILE: &str = ".openblog/private/youtube/releases";
const APPROVALS_FILE: &str = ".openblog/private/youtube/approvals.json";
const LOCK_FILE: &str = ".openblog/private/youtube/upload.lock";

const AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const UPLOAD_URL: &str =
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const THUMBNAIL_URL: &str = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
const CHANNELS_URL: &str =
    "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true";
const PLAYLIST_ITEMS_URL: &str = "https://www.googleapis.com/youtube/v3/playlistItems";
/// A resumable session address is only ever followed on this origin, so the access token is
/// never sent anywhere a reply pointed.
const SESSION_PREFIX: &str = "https://www.googleapis.com/upload/youtube/v3/videos?";

const MAX_REPLY_BYTES: u64 = 1024 * 1024;
const MAX_PRIVATE_FILE_BYTES: usize = 1024 * 1024;
/// Attempts of one request within one run before the run stops and leaves the release to resume.
const MAX_ATTEMPTS: u32 = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const API_TIMEOUT: Duration = Duration::from_secs(30);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(10 * 60);

const NOTHING_SENT: &str = "Nothing was sent.";

// ---------------------------------------------------------------------------------------------
// Transport

/// One HTTPS request. The body is the exact bytes sent.
#[derive(Clone, Debug)]
pub(crate) struct Request {
    pub method: &'static str,
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
    pub timeout: Duration,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

/// No reply arrived: the request may or may not have reached Google.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NoReply;

pub(crate) trait Transport {
    fn send(&self, request: &Request) -> Result<Reply, NoReply>;
}

#[derive(Default)]
struct NetworkTransport {
    resolver: safe_http::PublicResolver,
}

impl Transport for NetworkTransport {
    fn send(&self, request: &Request) -> Result<Reply, NoReply> {
        let config = Config::builder()
            .timeout_global(Some(request.timeout))
            .http_status_as_error(false)
            .max_redirects(0)
            .proxy(None)
            .user_agent(concat!("open.blog-youtube/", env!("CARGO_PKG_VERSION")))
            .build();
        let agent = safe_http::public_agent(config, self.resolver.clone());
        let result = match request.method {
            "GET" => {
                let mut builder = agent.get(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(*name, value);
                }
                builder.call()
            }
            "POST" | "PUT" => {
                let mut builder = if request.method == "POST" {
                    agent.post(&request.url)
                } else {
                    agent.put(&request.url)
                };
                for (name, value) in &request.headers {
                    builder = builder.header(*name, value);
                }
                builder.send(&request.body[..])
            }
            _ => return Err(NoReply),
        };
        let mut response = result.map_err(|_| NoReply)?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_string(), value.to_string()))
            })
            .collect();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_REPLY_BYTES)
            .read_to_vec()
            .map_err(|_| NoReply)?;
        Ok(Reply {
            status,
            headers,
            body,
        })
    }
}

/// What an upload run depends on besides the files: the network, the clock and waiting.
pub(crate) struct Env<'a> {
    pub transport: &'a dyn Transport,
    pub now: &'a dyn Fn() -> DateTime,
    pub sleep: &'a dyn Fn(Duration),
    pub client: Option<Client>,
}

fn network_env<T>(run: impl FnOnce(&Env<'_>) -> T) -> T {
    let transport = NetworkTransport::default();
    let env = Env {
        transport: &transport,
        now: &crate::clock::now,
        sleep: &std::thread::sleep,
        client: Client::from_environment(),
    };
    run(&env)
}

// ---------------------------------------------------------------------------------------------
// The OAuth client and the stored grant

/// The deployer's own Google OAuth client of the "Desktop app" type. Never in the project.
#[derive(Clone, Debug)]
pub(crate) struct Client {
    pub id: String,
    pub secret: Option<String>,
}

impl Client {
    fn from_environment() -> Option<Self> {
        let read = |name: &str| {
            std::env::var(name)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        read(CLIENT_ID_VARIABLE).map(|id| Self {
            id,
            secret: read(CLIENT_SECRET_VARIABLE),
        })
    }

    /// A fingerprint of the client id, so a grant made for another client is never used.
    fn fingerprint(&self) -> String {
        let digest = Blake2b512::digest(self.id.as_bytes());
        hex(&digest[..16])
    }

    fn form(&self, fields: &[(&str, &str)]) -> Vec<u8> {
        let mut pairs: Vec<(&str, &str)> = vec![("client_id", self.id.as_str())];
        if let Some(secret) = &self.secret {
            pairs.push(("client_secret", secret.as_str()));
        }
        pairs.extend_from_slice(fields);
        url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(pairs)
            .finish()
            .into_bytes()
    }
}

fn not_configured() -> String {
    format!("[youtube-not-configured] Uploading to YouTube is off: set {CLIENT_ID_VARIABLE} (and {CLIENT_SECRET_VARIABLE} if your Google client has one) to your own Google OAuth client of the Desktop app type, then run `openblog youtube connect`. {NOTHING_SENT} The guided workflow (`openblog video <slug> --preview <new folder>`) works without it.")
}

fn not_connected() -> String {
    format!("[youtube-not-connected] No YouTube channel is connected; run `openblog youtube connect` first. {NOTHING_SENT}")
}

fn reconnect(code: &str) -> String {
    format!("[{code}] The YouTube connection no longer works or lacks a permission; run `openblog youtube connect` again.")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    version: u32,
    refresh_token: String,
    scopes: Vec<String>,
    client: String,
    connected_at: String,
}

fn private_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    crate::assistant_storage::contained_target(root, Path::new(relative))
}

fn read_protected(path: &Path, what: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) if bytes.len() > MAX_PRIVATE_FILE_BYTES * 2 => {
            Err(format!("the private YouTube {what} is too large"))
        }
        Ok(bytes) => crate::admin::unprotect_private_credential(&bytes)
            .map(Some)
            .map_err(|_| format!("the private YouTube {what} cannot be read by this account")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(format!("cannot read the private YouTube {what}")),
    }
}

fn write_protected(path: &Path, bytes: &[u8], what: &str) -> Result<(), String> {
    let protected = crate::admin::protect_private_credential(bytes)
        .map_err(|_| format!("cannot protect the private YouTube {what}"))?;
    crate::admin::write_private_bytes_atomic(path, &protected)
        .map_err(|_| format!("cannot write the private YouTube {what}"))
}

fn load_grant(root: &Path) -> Result<Option<Grant>, String> {
    let path = private_path(root, CREDENTIAL_FILE)?;
    let Some(bytes) = read_protected(&path, "credential")? else {
        return Ok(None);
    };
    serde_json::from_slice::<Grant>(&bytes)
        .ok()
        .filter(|grant| grant.version == 1 && !grant.refresh_token.is_empty())
        .map(Some)
        .ok_or_else(|| reconnect("credential-unreadable"))
}

/// An access token for this run, refreshed from the stored grant. Never stored.
fn access_token(root: &Path, env: &Env<'_>) -> Result<String, String> {
    let client = env.client.as_ref().ok_or_else(not_configured)?;
    let grant = load_grant(root)?.ok_or_else(not_connected)?;
    if grant.client != client.fingerprint() {
        return Err(reconnect("client-changed"));
    }
    let request = Request {
        method: "POST",
        url: TOKEN_URL.into(),
        headers: vec![("Content-Type", "application/x-www-form-urlencoded".into())],
        body: client.form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", grant.refresh_token.as_str()),
        ]),
        timeout: API_TIMEOUT,
    };
    let reply = send_with_retries(env, &request).ok_or_else(|| {
        "[provider-unavailable] Google did not answer the token request; try again later. Nothing was uploaded.".to_string()
    })?;
    match reply.status {
        200 => reply.json()["access_token"]
            .as_str()
            .filter(|token| !token.is_empty())
            .map(str::to_string)
            .ok_or_else(|| reconnect("token-unreadable")),
        400 | 401 if reply.json()["error"] == "invalid_grant" => Err(reconnect("grant-revoked")),
        400 | 401 => Err(reconnect("client-refused")),
        _ => Err("[provider-unavailable] Google did not issue an access token; try again later. Nothing was uploaded.".into()),
    }
}

/// Sends a request that is safe to repeat, retrying a missing reply or a 5xx with back-off.
/// `None` when no usable reply came after every attempt.
fn send_with_retries(env: &Env<'_>, request: &Request) -> Option<Reply> {
    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            (env.sleep)(Duration::from_secs(1 << (attempt - 1)));
        }
        match env.transport.send(request) {
            Ok(reply) if matches!(reply.status, 500 | 502 | 503 | 504) => {}
            Ok(reply) => return Some(reply),
            Err(NoReply) => {}
        }
    }
    None
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------------------------
// `openblog youtube connect|disconnect|status`

pub fn command(root: &Path, action: &str) -> Result<(), String> {
    match action {
        "connect" => network_env(|env| {
            let listener = TcpListener::bind("127.0.0.1:0")
                .map_err(|_| "cannot listen on 127.0.0.1 for Google's reply".to_string())?;
            connect(root, env, listener, CONNECT_TIMEOUT, &mut |url| {
                println!("Open this address in a browser signed in to the Google account of your YouTube channel, and allow open.blog to upload videos:\n\n{url}\n\nWaiting for Google's reply on this computer (5 minutes)...");
            })
        }),
        "disconnect" => network_env(|env| disconnect(root, env)),
        "status" => connection_status(root, Client::from_environment().as_ref()),
        _ => Err("usage: openblog youtube connect|disconnect|status".into()),
    }
}

/// The authorization address for one connection attempt (PKCE S256, a random `state`).
fn authorization_url(client: &Client, redirect: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(AUTHORIZE_URL).expect("a fixed address");
    url.query_pairs_mut()
        .append_pair("client_id", &client.id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", &video_upload::SCOPES.join(" "))
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    url.into()
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// What arrived at the loopback address.
#[derive(Debug, PartialEq, Eq)]
enum Callback {
    /// Not Google's reply (such as `/favicon.ico`): ignored.
    Other,
    Code(String),
    /// The author declined, or Google refused.
    Denied,
    /// A reply whose `state` is not this attempt's: refused.
    Forged,
}

fn parse_callback(request_line: &str, state: &str) -> Callback {
    let mut parts = request_line.split(' ');
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Other;
    };
    let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else {
        return Callback::Other;
    };
    if url.path() != "/" {
        return Callback::Other;
    }
    let get = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    let Some(given) = get("state") else {
        return Callback::Other;
    };
    if given != state {
        return Callback::Forged;
    }
    match (get("code"), get("error")) {
        (Some(code), None) if !code.is_empty() => Callback::Code(code),
        _ => Callback::Denied,
    }
}

fn answer(stream: &mut TcpStream, status: &str, message: &str) {
    let page = format!("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>open.blog</title><p>{message}</p></html>");
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
}

fn wait_for_callback(
    listener: &TcpListener,
    state: &str,
    timeout: Duration,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "cannot wait for Google's reply".to_string())?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }
            Err(_) => continue,
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buffer = vec![0u8; 8192];
        let read = stream.read(&mut buffer).unwrap_or(0);
        let text = String::from_utf8_lossy(&buffer[..read]);
        let line = text.lines().next().unwrap_or("");
        match parse_callback(line, state) {
            Callback::Other => answer(&mut stream, "404 Not Found", "Not found."),
            Callback::Forged => {
                answer(
                    &mut stream,
                    "400 Bad Request",
                    "This reply does not belong to the connection open.blog started. Nothing was stored.",
                );
                return Err("[state-mismatch] A reply arrived that does not belong to this connection attempt; nothing was stored. Run `openblog youtube connect` again.".into());
            }
            Callback::Denied => {
                answer(
                    &mut stream,
                    "200 OK",
                    "open.blog was not allowed to upload. Nothing was stored; you can close this tab.",
                );
                return Err(
                    "[access-denied] Google did not grant the connection; nothing was stored."
                        .into(),
                );
            }
            Callback::Code(code) => {
                answer(
                    &mut stream,
                    "200 OK",
                    "open.blog received Google's reply. You can close this tab and return to the terminal.",
                );
                return Ok(code);
            }
        }
    }
    Err(
        "[connect-timed-out] No reply from Google within the time allowed; nothing was stored."
            .into(),
    )
}

/// Connects a YouTube channel: an installed-app authorization with PKCE and a loopback redirect
/// (<https://developers.google.com/identity/protocols/oauth2/native-app>), storing the refresh
/// token only when every scope was granted.
pub(crate) fn connect(
    root: &Path,
    env: &Env<'_>,
    listener: TcpListener,
    timeout: Duration,
    show: &mut dyn FnMut(&str),
) -> Result<(), String> {
    let client = env.client.as_ref().ok_or_else(not_configured)?;
    let port = listener
        .local_addr()
        .map_err(|_| "cannot listen on 127.0.0.1 for Google's reply".to_string())?
        .port();
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = auth::random_token()?;
    let state = auth::random_token()?;
    show(&authorization_url(
        client,
        &redirect,
        &pkce_challenge(&verifier),
        &state,
    ));
    let code = wait_for_callback(&listener, &state, timeout)?;
    let request = Request {
        method: "POST",
        url: TOKEN_URL.into(),
        headers: vec![("Content-Type", "application/x-www-form-urlencoded".into())],
        body: client.form(&[
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect.as_str()),
        ]),
        timeout: API_TIMEOUT,
    };
    // A code is used once; a lost reply is not retried.
    let reply = env.transport.send(&request).map_err(|_| {
        "[provider-unavailable] Google did not answer; nothing was stored. Run `openblog youtube connect` again.".to_string()
    })?;
    if reply.status != 200 {
        return Err("[token-refused] Google refused the authorization code; nothing was stored. Check the OAuth client and run `openblog youtube connect` again.".into());
    }
    let body = reply.json();
    let refresh = body["refresh_token"].as_str().unwrap_or_default();
    let granted: Vec<&str> = body["scope"]
        .as_str()
        .unwrap_or_default()
        .split(' ')
        .filter(|s| !s.is_empty())
        .collect();
    let missing: Vec<&str> = video_upload::SCOPES
        .into_iter()
        .filter(|scope| !granted.contains(scope))
        .collect();
    if refresh.is_empty() || !missing.is_empty() {
        if !refresh.is_empty() {
            revoke(env, refresh);
        }
        return Err(format!(
            "[scope-missing] Google did not grant every permission open.blog asks for ({}); nothing was stored. Run `openblog youtube connect` again and allow them all.",
            if missing.is_empty() {
                "offline access".to_string()
            } else {
                missing.join(", ")
            }
        ));
    }
    let grant = Grant {
        version: 1,
        refresh_token: refresh.to_string(),
        scopes: video_upload::SCOPES
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
        client: client.fingerprint(),
        connected_at: (env.now)().rfc3339(),
    };
    let bytes = serde_json::to_vec(&grant).map_err(|_| "cannot encode the grant".to_string())?;
    write_protected(&private_path(root, CREDENTIAL_FILE)?, &bytes, "credential")?;
    println!(
        "YouTube is connected. open.blog uploads only a release you approve, always private first."
    );
    Ok(())
}

fn revoke(env: &Env<'_>, token: &str) -> bool {
    let request = Request {
        method: "POST",
        url: REVOKE_URL.into(),
        headers: vec![("Content-Type", "application/x-www-form-urlencoded".into())],
        body: url::form_urlencoded::Serializer::new(String::new())
            .append_pair("token", token)
            .finish()
            .into_bytes(),
        timeout: API_TIMEOUT,
    };
    matches!(env.transport.send(&request), Ok(reply) if reply.status == 200)
}

/// Revokes the grant at Google and removes it here. It is removed here even when Google cannot be
/// reached, and the author is told where to revoke it by hand.
pub(crate) fn disconnect(root: &Path, env: &Env<'_>) -> Result<(), String> {
    let path = private_path(root, CREDENTIAL_FILE)?;
    let grant = match load_grant(root) {
        Ok(Some(grant)) => Some(grant),
        Ok(None) => {
            println!("No YouTube channel is connected. Nothing was changed.");
            return Ok(());
        }
        Err(_) => None,
    };
    let revoked = grant
        .as_ref()
        .is_some_and(|grant| revoke(env, &grant.refresh_token));
    fs::remove_file(&path)
        .map_err(|_| "cannot remove the private YouTube credential".to_string())?;
    if revoked {
        println!(
            "YouTube is disconnected: Google revoked the grant and the credential was removed."
        );
    } else {
        println!("The YouTube credential was removed from this computer, but Google did not confirm the revocation. Remove open.blog's access at https://myaccount.google.com/permissions.");
    }
    Ok(())
}

fn connection_status(root: &Path, client: Option<&Client>) -> Result<(), String> {
    match client {
        Some(_) => println!("OAuth client: set ({CLIENT_ID_VARIABLE})"),
        None => {
            println!("OAuth client: not set; uploading is off until {CLIENT_ID_VARIABLE} is set")
        }
    }
    match load_grant(root) {
        Ok(Some(grant)) => {
            let other = client.is_some_and(|c| c.fingerprint() != grant.client);
            println!(
                "Connected: since {}{}",
                grant.connected_at,
                if other {
                    " (for another OAuth client; connect again)"
                } else {
                    ""
                }
            );
            println!("Permissions: {}", grant.scopes.join(", "));
        }
        Ok(None) => println!("Connected: no"),
        Err(error) => println!("Connected: unreadable ({error})"),
    }
    println!("No request was sent.");
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Approvals

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Approvals {
    schema_version: u32,
    approvals: std::collections::BTreeMap<String, VideoApproval>,
}

fn load_approvals(root: &Path) -> Result<Approvals, String> {
    let path = private_path(root, APPROVALS_FILE)?;
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Approvals>(&text)
            .ok()
            .filter(|a| a.schema_version == 1)
            .ok_or_else(|| {
                format!(
                    "[approvals-unreadable] Repair or remove {}. {NOTHING_SENT}",
                    path.display()
                )
            }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Approvals {
            schema_version: 1,
            ..Approvals::default()
        }),
        Err(_) => Err(format!("cannot read {}", path.display())),
    }
}

/// The size and BLAKE2b digest of the whole master file.
fn fingerprint(path: &Path) -> Result<FileFingerprint, String> {
    let unreadable = || format!("[source-not-found] The video file cannot be read. {NOTHING_SENT}");
    let mut file = fs::File::open(path).map_err(|_| unreadable())?;
    let mut hasher = Blake2b512::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut bytes = 0u64;
    loop {
        let read = file.read(&mut buffer).map_err(|_| unreadable())?;
        if read == 0 {
            break;
        }
        bytes += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok(FileFingerprint {
        bytes,
        digest: hex(&hasher.finalize()[..32]),
    })
}

fn refused(error: ApprovalError) -> String {
    format!("[{}] {error} {NOTHING_SENT}", error.code())
}

/// `--approve <digest> [--publish-at <time>]`: records the approval of exactly the previewed
/// release for the file as it is now. Sends nothing.
pub fn approve(
    root: &Path,
    prepared: &Prepared,
    digest: &str,
    publish_at: Option<&str>,
) -> Result<(), String> {
    approve_at(root, prepared, digest, publish_at, crate::clock::now())
}

pub(crate) fn approve_at(
    root: &Path,
    prepared: &Prepared,
    digest: &str,
    publish_at: Option<&str>,
    now: DateTime,
) -> Result<(), String> {
    let preview = &prepared.preview;
    if preview.status == openblog_core::distribution::Status::Blocked {
        return Err(refused(ApprovalError::Blocked));
    }
    if preview.reference.file.is_none() {
        return Err(refused(ApprovalError::NothingToUpload));
    }
    if digest.trim() != preview.digest {
        return Err(refused(ApprovalError::PreviewMismatch));
    }
    if !prepared.public_canonical {
        return Err(format!("[canonical-not-public] The description would link {}, which is not a public https address; set `url` in openblog.json first. {NOTHING_SENT}", preview.canonical_url));
    }
    let publish_at = publish_at
        .map(|at| video_upload::publication_time(at, now, prepared.post_date))
        .transpose()
        .map_err(refused)?;
    let video = prepared.video.as_deref().ok_or_else(|| {
        format!("[source-not-found] The video file cannot be read. {NOTHING_SENT}")
    })?;
    let file = fingerprint(video)?;
    let approval = video_upload::approve(preview, digest, file, publish_at.clone(), &now.rfc3339())
        .map_err(refused)?;
    let mut approvals = load_approvals(root)?;
    approvals.schema_version = 1;
    approvals.approvals.insert(prepared.slug.clone(), approval);
    let text = serde_json::to_string_pretty(&approvals).map_err(|e| e.to_string())?;
    fsutil::write_file(&private_path(root, APPROVALS_FILE)?, text.as_bytes())?;
    println!(
        "Approved `{}` for upload as a private YouTube video{} (preview {}). Nothing was sent.",
        prepared.slug,
        publish_at
            .map(|at| format!(", made public by YouTube at {at}"))
            .unwrap_or_default(),
        preview.digest
    );
    println!("Upload it with: openblog video {} --upload", prepared.slug);
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// The private upload record

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Records {
    schema_version: u32,
    releases: std::collections::BTreeMap<String, UploadRecord>,
}

fn load_records(root: &Path) -> Result<Records, String> {
    let path = private_path(root, RECORDS_FILE)?;
    match read_protected(&path, "upload record")? {
        None => Ok(Records {
            schema_version: video_upload::RECORD_VERSION,
            ..Records::default()
        }),
        Some(bytes) if bytes.len() > MAX_PRIVATE_FILE_BYTES => {
            Err("the private YouTube upload record is too large".into())
        }
        Some(bytes) => serde_json::from_slice::<Records>(&bytes)
            .ok()
            .filter(|r| r.schema_version == video_upload::RECORD_VERSION)
            .ok_or_else(|| "[record-unreadable] The private YouTube upload record cannot be read; nothing was sent. Do not upload again before checking YouTube Studio.".to_string()),
    }
}

fn load_record(root: &Path, slug: &str) -> Result<UploadRecord, String> {
    Ok(load_records(root)?
        .releases
        .remove(slug)
        .unwrap_or_default())
}

/// Saves one release's record. Called before every request whose outcome could change it.
fn save_record(root: &Path, slug: &str, record: &UploadRecord) -> Result<(), String> {
    let mut records = load_records(root)?;
    records.schema_version = video_upload::RECORD_VERSION;
    records.releases.insert(slug.to_string(), record.clone());
    let bytes = serde_json::to_vec(&records).map_err(|e| e.to_string())?;
    write_protected(&private_path(root, RECORDS_FILE)?, &bytes, "upload record")
}

/// One upload at a time per project. A crash leaves the file behind, and the message says so.
struct Lock(PathBuf);

impl Lock {
    fn take(root: &Path) -> Result<Self, String> {
        let path = private_path(root, LOCK_FILE)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| "cannot create the private YouTube folder".to_string())?;
        }
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| format!("[upload-running] Another YouTube upload of this project is running. If none is, remove {} and run again. {NOTHING_SENT}", path.display()))?;
        Ok(Self(path))
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

// ---------------------------------------------------------------------------------------------
// `--upload`

pub fn upload(root: &Path, prepared: &Prepared) -> Result<(), String> {
    network_env(|env| upload_with(root, prepared, env))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

/// The outcome of one exchange with a resumable session.
enum Step {
    /// YouTube created the video.
    Created(String),
    /// This many bytes have arrived.
    Received(u64),
    /// Ask the session how far it got before sending more.
    Ask,
    /// No reply after every attempt.
    NoAnswer,
    Failed(Failure, &'static str),
}

/// Uploads, resumes or finishes the approved release.
pub(crate) fn upload_with(root: &Path, prepared: &Prepared, env: &Env<'_>) -> Result<(), String> {
    let slug = prepared.slug.as_str();
    let mut record = load_record(root, slug)?;
    match record.state {
        UploadState::Uploaded => {
            if matches!(
                record.thumbnail,
                ThumbnailState::Pending | ThumbnailState::Failed
            ) && prepared.thumbnail.is_some()
            {
                let _lock = Lock::take(root)?;
                let token = access_token(root, env)?;
                set_thumbnail(root, prepared, env, &token, &mut record)?;
            }
            report_uploaded(&record);
            return Ok(());
        }
        UploadState::Unknown => {
            return Err(format!("[upload-unknown] The last upload of `{slug}` may have reached YouTube. Run `openblog video {slug} --lookup`, or check YouTube Studio and run `openblog video {slug} --settle uploaded:<video id>` or `--settle not-uploaded`. {NOTHING_SENT}"));
        }
        _ => {}
    }
    if prepared.draft {
        return Err(format!("[article-draft] `{slug}` is a draft; publish the article (it may be scheduled) before uploading its video. {NOTHING_SENT}"));
    }
    let video = prepared.video.as_deref().ok_or_else(|| {
        format!("[source-not-found] The video file cannot be read. {NOTHING_SENT}")
    })?;
    let file = fingerprint(video)?;
    let approvals = load_approvals(root)?;
    let approval = approvals.approvals.get(slug);
    video_upload::covers(
        approval,
        &prepared.preview,
        &file,
        (env.now)(),
        prepared.post_date,
    )
    .map_err(refused)?;
    let Some(approval) = approval else {
        return Err(refused(ApprovalError::NotApproved));
    };
    let _lock = Lock::take(root)?;
    let resumable = record.state == UploadState::Uploading
        && record.session.is_some()
        && record.file.as_ref() == Some(&file)
        && record.preview_digest == prepared.preview.digest
        && record.publish_at == approval.publish_at;
    if !resumable && record.state == UploadState::Uploading && record.final_sent {
        // The last chunk of the earlier attempt may have created the video, and the release
        // changed since: starting over could upload it twice, so it is settled first.
        return unknown(root, slug, env, &mut record, "release-changed");
    }
    let mut token = access_token(root, env)?;
    if !resumable {
        record = UploadRecord {
            preview_digest: prepared.preview.digest.clone(),
            file: Some(file.clone()),
            publish_at: approval.publish_at.clone(),
            thumbnail: if prepared.thumbnail.is_some() {
                ThumbnailState::Pending
            } else {
                ThumbnailState::None
            },
            history: std::mem::take(&mut record.history),
            ..UploadRecord::default()
        };
    }
    let mut refreshed = false;
    let mut restarted = false;
    let mut ask_first = resumable;
    let mut asks = 0;
    loop {
        if record.session.is_none() {
            open_session(
                root,
                prepared,
                env,
                &mut token,
                video,
                &file,
                &mut record,
                &mut refreshed,
            )?;
            ask_first = false;
        }
        // A reply to a status query, not to a chunk: a refusal then says nothing about whether
        // the last chunk, sent earlier, created the video.
        let asked = ask_first;
        let step = if ask_first {
            ask_first = false;
            asks += 1;
            query_session(env, &token, &record, file.bytes)
        } else {
            send_next_chunk(root, slug, env, &token, video, file.bytes, &mut record)?
        };
        match step {
            Step::Created(id) => {
                record.uploaded((env.now)(), &id, "uploaded");
                save_record(root, slug, &record)?;
                break;
            }
            Step::Received(received) if received < file.bytes => {
                // Part of the file has arrived and no video exists yet: send the rest.
                asks = 0;
                record.received = received;
                record.final_sent = false;
                record.failure = None;
                save_record(root, slug, &record)?;
            }
            // Every byte arrived but no reply named the video yet, or the last exchange went
            // unanswered: ask the session again, a bounded number of times.
            Step::Received(received) if asks < MAX_ATTEMPTS => {
                if received == file.bytes && record.received != received {
                    record.received = received;
                    save_record(root, slug, &record)?;
                }
                ask_first = true;
            }
            Step::Ask if asks < MAX_ATTEMPTS => ask_first = true,
            Step::Received(_) | Step::Ask | Step::NoAnswer => {
                record.failure = Some("provider-unavailable".into());
                record.log((env.now)(), "stopped", Some("provider-unavailable"));
                save_record(root, slug, &record)?;
                return Err(format!("[provider-unavailable] YouTube did not answer; the upload of `{slug}` is kept and resumes where it stopped when you run `openblog video {slug} --upload` again."));
            }
            Step::Failed(Failure::Unauthorized, code) if !refreshed => {
                refreshed = true;
                record.log((env.now)(), "token-refreshed", Some(code));
                token = access_token(root, env)?;
                ask_first = true;
            }
            Step::Failed(Failure::SessionGone, code) => {
                if record.final_sent {
                    return unknown(root, slug, env, &mut record, code);
                }
                if restarted {
                    return stop(
                        root,
                        slug,
                        env,
                        &mut record,
                        Failure::SessionGone,
                        code,
                        false,
                    );
                }
                // A session that ended before its last byte holds no video: start a new one once.
                restarted = true;
                record.session = None;
                record.received = 0;
                record.log((env.now)(), "session-expired", Some(code));
                save_record(root, slug, &record)?;
            }
            Step::Failed(failure, code) => {
                let may_exist = asked && record.final_sent;
                return stop(root, slug, env, &mut record, failure, code, may_exist);
            }
        }
    }
    if prepared.thumbnail.is_some() {
        set_thumbnail(root, prepared, env, &token, &mut record)?;
    }
    report_uploaded(&record);
    Ok(())
}

/// Marks the release unknown: the last chunk may have created the video, so nothing more is sent
/// until `--lookup` or `--settle` says whether it exists.
fn unknown(
    root: &Path,
    slug: &str,
    env: &Env<'_>,
    record: &mut UploadRecord,
    code: &str,
) -> Result<(), String> {
    record.state = UploadState::Unknown;
    record.session = None;
    record.failure = Some(code.into());
    record.log((env.now)(), "unknown", Some(code));
    save_record(root, slug, record)?;
    Err(format!("[upload-unknown] The whole file of `{slug}` was sent but YouTube's reply was lost, so the video may exist. Run `openblog video {slug} --lookup`, or check YouTube Studio and run `openblog video {slug} --settle uploaded:<video id>` or `--settle not-uploaded`. Nothing more was sent."))
}

/// Stops the run on a failure YouTube gave: the record says what happened and whether running
/// again may succeed. A reply refusing a chunk means that chunk did not complete the video, but a
/// refusal of a status query after the last chunk's reply was lost (`may_exist`) does not: then
/// the release is unknown, and any other failure keeps `final_sent` for the next run to ask.
fn stop(
    root: &Path,
    slug: &str,
    env: &Env<'_>,
    record: &mut UploadRecord,
    failure: Failure,
    code: &'static str,
    may_exist: bool,
) -> Result<(), String> {
    let refused = matches!(failure, Failure::SessionGone | Failure::Rejected);
    if refused && may_exist {
        return unknown(root, slug, env, record, code);
    }
    if !may_exist {
        // The refusal answered the chunk itself, so that chunk did not complete the video.
        record.final_sent = false;
    }
    record.failure = Some(code.into());
    let kept = record.session.is_some();
    if refused {
        record.state = UploadState::Failed;
        record.session = None;
        record.received = 0;
    }
    record.log((env.now)(), "stopped", Some(code));
    save_record(root, slug, record)?;
    Err(stop_message(slug, failure, code, kept))
}

fn stop_message(slug: &str, failure: Failure, code: &str, kept: bool) -> String {
    let resume = if kept {
        format!("The upload is kept and resumes where it stopped with `openblog video {slug} --upload`.")
    } else {
        format!("No video was created; run `openblog video {slug} --upload` again.")
    };
    match failure {
        Failure::Quota => format!("[{code}] The Google project's YouTube quota is spent for today; it resets at midnight Pacific Time. {resume}"),
        Failure::UploadLimit => format!("[{code}] The channel reached YouTube's daily upload limit; try again tomorrow. {resume}"),
        Failure::RateLimited => format!("[{code}] YouTube asked open.blog to slow down; try again later. {resume}"),
        Failure::Transient => format!("[{code}] YouTube is unavailable; try again later. {resume}"),
        Failure::Reconnect | Failure::Unauthorized => format!("{} {resume}", reconnect(code)),
        Failure::SessionGone | Failure::Rejected => format!("[{code}] YouTube refused the upload of `{slug}`; no video was created. Check the release and the channel, then preview, approve and upload it again."),
    }
}

fn bearer(token: &str) -> (&'static str, String) {
    ("Authorization", format!("Bearer {token}"))
}

#[allow(clippy::too_many_arguments)]
fn open_session(
    root: &Path,
    prepared: &Prepared,
    env: &Env<'_>,
    token: &mut String,
    video: &Path,
    file: &FileFingerprint,
    record: &mut UploadRecord,
    refreshed: &mut bool,
) -> Result<(), String> {
    let slug = prepared.slug.as_str();
    let resource = video_upload::insert_resource(&prepared.preview, record.publish_at.as_deref());
    loop {
        let request = Request {
            method: "POST",
            url: UPLOAD_URL.into(),
            headers: vec![
                bearer(token),
                ("Content-Type", "application/json; charset=UTF-8".into()),
                ("X-Upload-Content-Length", file.bytes.to_string()),
                ("X-Upload-Content-Type", content_type(video).into()),
            ],
            body: resource.to_string().into_bytes(),
            timeout: API_TIMEOUT,
        };
        // Opening a session creates no video, so a lost reply is safely asked again.
        let Some(reply) = send_with_retries(env, &request) else {
            record.failure = Some("provider-unavailable".into());
            record.log((env.now)(), "stopped", Some("provider-unavailable"));
            save_record(root, slug, record)?;
            return Err(format!("[provider-unavailable] YouTube did not answer; no video was created. Run `openblog video {slug} --upload` again later."));
        };
        if reply.status == 200 {
            let session = reply
                .header("location")
                .filter(|l| l.starts_with(SESSION_PREFIX) && l.contains("upload_id="))
                .ok_or_else(|| format!("[session-unreadable] YouTube did not return a usable upload session; no video was created. {NOTHING_SENT}"))?;
            let now = (env.now)();
            record.state = UploadState::Uploading;
            record.session = Some(session.to_string());
            record.received = 0;
            record.final_sent = false;
            record.started_at = now.unix();
            record.failure = None;
            record.log(now, "session-opened", None);
            return save_record(root, slug, record);
        }
        let (failure, code) = video_upload::classify(reply.status, &reply.body);
        if failure == Failure::Unauthorized && !*refreshed {
            *refreshed = true;
            *token = access_token(root, env)?;
            continue;
        }
        return stop(root, slug, env, record, failure, code, false);
    }
}

/// Asks the session how far the upload got (`Content-Range: bytes */total`).
fn query_session(env: &Env<'_>, token: &str, record: &UploadRecord, total: u64) -> Step {
    let Some(session) = &record.session else {
        return Step::Failed(Failure::SessionGone, "session-expired");
    };
    let request = Request {
        method: "PUT",
        url: session.clone(),
        headers: vec![bearer(token), ("Content-Range", format!("bytes */{total}"))],
        body: Vec::new(),
        timeout: API_TIMEOUT,
    };
    match send_with_retries(env, &request) {
        Some(reply) => interpret(&reply),
        None => Step::NoAnswer,
    }
}

fn interpret(reply: &Reply) -> Step {
    match reply.status {
        200 | 201 => match video_upload::inserted_video(&reply.body) {
            Some(id) => Step::Created(id),
            None => Step::Failed(Failure::SessionGone, "reply-unreadable"),
        },
        308 => match video_upload::received_bytes(reply.header("range")) {
            Some(received) => Step::Received(received),
            None => Step::Ask,
        },
        status => {
            let (failure, code) = video_upload::classify(status, &reply.body);
            Step::Failed(failure, code)
        }
    }
}

/// Sends the next chunk. The record says before the last chunk leaves that the video may exist.
fn send_next_chunk(
    root: &Path,
    slug: &str,
    env: &Env<'_>,
    token: &str,
    video: &Path,
    total: u64,
    record: &mut UploadRecord,
) -> Result<Step, String> {
    let Some((first, last)) = video_upload::next_chunk(record.received, total) else {
        return Ok(Step::Ask);
    };
    let unreadable = || {
        format!("[source-not-found] The video file cannot be read; the upload is kept and resumes with `openblog video {slug} --upload`.")
    };
    let mut file = fs::File::open(video).map_err(|_| unreadable())?;
    let mut chunk = vec![0u8; (last - first + 1) as usize];
    file.seek(SeekFrom::Start(first))
        .and_then(|_| file.read_exact(&mut chunk))
        .map_err(|_| unreadable())?;
    let now = (env.now)();
    record.last_sent_at = now.unix();
    if last + 1 == total && !record.final_sent {
        record.final_sent = true;
        record.log(now, "final-chunk-sent", None);
    }
    save_record(root, slug, record)?;
    let request = Request {
        method: "PUT",
        url: record.session.clone().unwrap_or_default(),
        headers: vec![
            bearer(token),
            ("Content-Range", format!("bytes {first}-{last}/{total}")),
        ],
        body: chunk,
        timeout: CHUNK_TIMEOUT,
    };
    // A chunk is never resent blindly: after a lost reply or a 5xx the session is asked first.
    match env.transport.send(&request) {
        Ok(reply) if matches!(reply.status, 500 | 502 | 503 | 504) => {
            (env.sleep)(Duration::from_secs(1));
            Ok(Step::Ask)
        }
        Ok(reply) => Ok(interpret(&reply)),
        Err(NoReply) => {
            (env.sleep)(Duration::from_secs(1));
            Ok(Step::Ask)
        }
    }
}

fn set_thumbnail(
    root: &Path,
    prepared: &Prepared,
    env: &Env<'_>,
    token: &str,
    record: &mut UploadRecord,
) -> Result<(), String> {
    let (Some(path), Some(id)) = (prepared.thumbnail.as_deref(), record.video_id.clone()) else {
        return Ok(());
    };
    let bytes = fs::read(path).unwrap_or_default();
    let kind = openblog_core::video_release::image_size(&bytes).map(|(kind, _, _)| kind);
    let small = bytes.len() as u64 <= openblog_core::video_release::YOUTUBE_THUMBNAIL_MAX_BYTES;
    let (state, code) = match kind {
        Some(kind) if small => {
            let mut url = url::Url::parse(THUMBNAIL_URL).expect("a fixed address");
            url.query_pairs_mut()
                .append_pair("videoId", &id)
                .append_pair("uploadType", "media");
            let mime = if kind == "png" {
                "image/png"
            } else {
                "image/jpeg"
            };
            let request = Request {
                method: "POST",
                url: url.into(),
                headers: vec![bearer(token), ("Content-Type", mime.into())],
                body: bytes,
                timeout: CHUNK_TIMEOUT,
            };
            // Setting a thumbnail again replaces it, so retrying is safe.
            match send_with_retries(env, &request) {
                Some(reply) if reply.status == 200 => (ThumbnailState::Set, None),
                Some(reply) => (
                    ThumbnailState::Failed,
                    Some(video_upload::classify(reply.status, &reply.body).1),
                ),
                None => (ThumbnailState::Failed, Some("provider-unavailable")),
            }
        }
        _ => (ThumbnailState::Failed, Some("thumbnail-unreadable")),
    };
    record.thumbnail = state;
    let event = if state == ThumbnailState::Set {
        "thumbnail-set"
    } else {
        "thumbnail-failed"
    };
    record.log((env.now)(), event, code);
    save_record(root, &prepared.slug, record)?;
    if let Some(code) = code {
        eprintln!(
            "warning: [{code}] The video is uploaded but YouTube did not take the thumbnail{}. Run `openblog video {} --upload` again to retry it, or set it in YouTube Studio.",
            if code == "forbidden" {
                " (custom thumbnails need a verified channel)"
            } else {
                ""
            },
            prepared.slug
        );
    }
    Ok(())
}

fn report_uploaded(record: &UploadRecord) {
    let id = record.video_id.as_deref().unwrap_or_default();
    let url = video_upload::watch_url(id);
    println!("Uploaded to YouTube as private video {id}: {url}");
    match &record.publish_at {
        Some(at) => println!("YouTube makes it public at {at}."),
        None => println!("It stays private until you publish it in YouTube Studio."),
    }
    println!("Add captions in YouTube Studio, then set `videoUrl: {url}` on the post to embed it.");
}

// ---------------------------------------------------------------------------------------------
// `--lookup`, `--settle`, `--status`

pub fn lookup(root: &Path, prepared: &Prepared) -> Result<(), String> {
    network_env(|env| lookup_with(root, prepared, env))
}

fn get_json(env: &Env<'_>, token: &str, url: String) -> Result<Value, String> {
    let request = Request {
        method: "GET",
        url,
        headers: vec![bearer(token)],
        body: Vec::new(),
        timeout: API_TIMEOUT,
    };
    match send_with_retries(env, &request) {
        Some(reply) if reply.status == 200 => Ok(reply.json()),
        Some(reply) => {
            let (failure, code) = video_upload::classify(reply.status, &reply.body);
            Err(match failure {
                Failure::Reconnect | Failure::Unauthorized => reconnect(code),
                _ => format!("[{code}] YouTube did not list the channel's uploads; the release stays unknown. Try again later."),
            })
        }
        None => Err("[provider-unavailable] YouTube did not answer; the release stays unknown. Try again later.".into()),
    }
}

pub(crate) fn lookup_with(root: &Path, prepared: &Prepared, env: &Env<'_>) -> Result<(), String> {
    let slug = prepared.slug.as_str();
    let mut record = load_record(root, slug)?;
    if record.state != UploadState::Unknown {
        println!(
            "The upload of `{slug}` is {}; there is nothing to look up. No request was sent.",
            record.state.as_str()
        );
        return Ok(());
    }
    let _lock = Lock::take(root)?;
    let token = access_token(root, env)?;
    let channels = get_json(env, &token, CHANNELS_URL.into())?;
    let playlist = channels["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .ok_or_else(|| "[no-channel] The connected Google account has no YouTube channel to look in; the release stays unknown.".to_string())?
        .to_string();
    let mut url = url::Url::parse(PLAYLIST_ITEMS_URL).expect("a fixed address");
    url.query_pairs_mut()
        .append_pair("part", "snippet")
        .append_pair("maxResults", "50")
        .append_pair("playlistId", &playlist);
    let items = get_json(env, &token, url.into())?;
    let now = (env.now)();
    let listed = items["items"].as_array().cloned().unwrap_or_default();
    let uploads: Vec<Upload> = listed
        .iter()
        .filter_map(|item| {
            let snippet = &item["snippet"];
            let id = snippet["resourceId"]["videoId"].as_str()?;
            let at = parse_schedule_with(snippet["publishedAt"].as_str()?, now, false).ok()?;
            Some(Upload {
                video_id: id.to_string(),
                title: snippet["title"].as_str().unwrap_or_default().to_string(),
                description: snippet["description"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                published_at: at.unix(),
            })
        })
        .collect();
    let window_start = record.started_at - video_upload::LOOKUP_SKEW_SECONDS;
    // Every listed item must be read, and the list must reach back before the attempt.
    let complete = uploads.len() == listed.len()
        && (items["nextPageToken"].as_str().is_none()
            || uploads.iter().any(|u| u.published_at < window_start));
    let outcome = video_upload::lookup(
        &uploads,
        complete,
        &prepared.preview.title,
        &prepared.preview.description,
        record.started_at,
        record.last_sent_at,
        now.unix(),
    );
    match outcome {
        LookupOutcome::Found(id) => {
            record.uploaded(now, &id, "lookup-found");
            if prepared.thumbnail.is_some() && record.thumbnail != ThumbnailState::Set {
                record.thumbnail = ThumbnailState::Pending;
            }
            save_record(root, slug, &record)?;
            println!("YouTube has the upload: video {id} ({}). Run `openblog video {slug} --upload` to set its thumbnail, if it has one.", video_upload::watch_url(&id));
            Ok(())
        }
        LookupOutcome::Absent => {
            record.state = UploadState::NotUploaded;
            record.session = None;
            record.received = 0;
            record.final_sent = false;
            record.failure = None;
            record.log(now, "lookup-absent", None);
            save_record(root, slug, &record)?;
            println!("The channel has no upload since the attempt began, so no video was created. Upload it again with `openblog video {slug} --upload`.");
            Ok(())
        }
        LookupOutcome::TooEarly => {
            record.log(now, "lookup-too-early", None);
            save_record(root, slug, &record)?;
            Err("[lookup-too-early] Nothing is listed yet, but the upload ended less than 15 minutes ago and may still appear. Look again later; the release stays unknown.".into())
        }
        LookupOutcome::NeedsPerson(ids) => {
            record.log(now, "lookup-needs-person", None);
            save_record(root, slug, &record)?;
            Err(format!(
                "[needs-person] The channel has uploads since the attempt began that may be this release{}. Check YouTube Studio, then run `openblog video {slug} --settle uploaded:<video id>` or `--settle not-uploaded`.",
                if ids.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", ids.join(", "))
                }
            ))
        }
    }
}

pub fn settle(root: &Path, slug: &str, input: &str) -> Result<(), String> {
    settle_at(root, slug, input, crate::clock::now())
}

pub(crate) fn settle_at(root: &Path, slug: &str, input: &str, now: DateTime) -> Result<(), String> {
    let settlement = video_upload::settlement(input).ok_or_else(|| {
        "--settle takes `uploaded:<11-character video id>` or `not-uploaded`; nothing was changed"
            .to_string()
    })?;
    let mut record = load_record(root, slug)?;
    if record.state != UploadState::Unknown {
        return Err(format!("[not-unknown] The upload of `{slug}` is {}, not unknown; only an unknown upload is settled by hand. Nothing was changed.", record.state.as_str()));
    }
    match settlement {
        Settlement::Uploaded(id) => {
            record.uploaded(now, &id, "settled-uploaded");
            if record.thumbnail == ThumbnailState::Failed {
                record.thumbnail = ThumbnailState::Pending;
            }
            println!("Recorded `{slug}` as YouTube video {id}. No request was sent.");
        }
        Settlement::NotUploaded => {
            record.state = UploadState::NotUploaded;
            record.session = None;
            record.received = 0;
            record.final_sent = false;
            record.failure = None;
            record.log(now, "settled-not-uploaded", None);
            println!("Recorded that `{slug}` was not uploaded; `--upload` may send it again. No request was sent.");
        }
    }
    save_record(root, slug, &record)
}

pub fn print_status(root: &Path, slug: &str, as_json: bool) -> Result<(), String> {
    let record = load_records(root)?.releases.remove(slug);
    let approved = load_approvals(root)?.approvals.contains_key(slug);
    if as_json {
        let value = json!({
            "slug": slug,
            "approved": approved,
            "record": record.as_ref().map(UploadRecord::public_view),
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    let record = record.unwrap_or_default();
    println!("YouTube release of `{slug}`: {}", record.state.as_str());
    println!("  approved: {}", if approved { "yes" } else { "no" });
    if let Some(url) = &record.url {
        println!("  video: {url}");
    }
    if record.state == UploadState::Uploading {
        if let Some(file) = &record.file {
            println!("  received: {} of {} bytes", record.received, file.bytes);
        }
    }
    if let Some(at) = &record.publish_at {
        println!("  public at: {at}");
    }
    if let Some(code) = &record.failure {
        println!("  last failure: {code}");
    }
    for entry in &record.history {
        let code = entry
            .code
            .as_deref()
            .map(|c| format!(" ({c})"))
            .unwrap_or_default();
        println!("  {} {}{code}", entry.at, entry.event);
    }
    Ok(())
}

#[cfg(test)]
mod tests;

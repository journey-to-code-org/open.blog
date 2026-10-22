//! The development and self-hosting server: serves the built site, rebuilds
//! when files change, publishes scheduled posts on time, and (with `--admin`)
//! serves the login-protected editor. Plain `std::net`, no async runtime.

use std::collections::HashMap;
use std::fs;
use std::net::{IpAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::admin::{self, AppState};
use crate::fsutil;
use crate::http::{self, Conn, Request, Response};
use crate::site;

/// Concurrent connections served at once; extras are dropped, so a flood of
/// slow clients cannot exhaust threads.
const MAX_CONNECTIONS: usize = 64;
/// Concurrent connections from one address, so a single client cannot take
/// every slot. Browsers open at most six or so per host.
const MAX_PER_IP: usize = 16;

/// Holds one connection slot and releases it on drop, even if the handler panics.
struct SlotGuard {
    active: Arc<AtomicUsize>,
    per_ip: Arc<Mutex<HashMap<IpAddr, usize>>>,
    ip: IpAddr,
}

impl SlotGuard {
    fn acquire(
        active: &Arc<AtomicUsize>,
        per_ip: &Arc<Mutex<HashMap<IpAddr, usize>>>,
        ip: IpAddr,
        exempt_from_per_ip: bool,
    ) -> Option<Self> {
        if active.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
            active.fetch_sub(1, Ordering::SeqCst);
            return None;
        }
        {
            let mut map = per_ip.lock().unwrap_or_else(|e| e.into_inner());
            let count = map.entry(ip).or_insert(0);
            // A reverse proxy funnels every reader through one address; only the global cap applies to it.
            if !exempt_from_per_ip && *count >= MAX_PER_IP {
                active.fetch_sub(1, Ordering::SeqCst);
                return None;
            }
            *count += 1;
        }
        Some(Self {
            active: Arc::clone(active),
            per_ip: Arc::clone(per_ip),
            ip,
        })
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
        let mut map = self.per_ip.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = map.get_mut(&self.ip) {
            *count -= 1;
            if *count == 0 {
                map.remove(&self.ip);
            }
        }
    }
}

pub struct ServeOptions {
    pub include_drafts: bool,
    pub host: String,
    pub port: u16,
    pub admin: bool,
}

pub fn run(root: &Path, options: &ServeOptions) -> Result<(), String> {
    let state = Arc::new(AppState::new(
        root.to_path_buf(),
        None,
        options.include_drafts,
        options.admin,
    ));
    let report = state.rebuild()?;
    print_report(&report);
    let out_dir = report.out_dir.clone();

    let config = site::load_config(root)?;
    if options.admin {
        let users = crate::auth::Users::load(&root.join(&config.admin.users_file))?;
        if users.users.is_empty() {
            println!("\nNo admin users yet. Create one with:  openblog user add <name>");
        }
        let loopback = matches!(options.host.as_str(), "127.0.0.1" | "localhost" | "::1");
        if !loopback && !config.admin.secure_cookies {
            eprintln!(
                "\nwarning: the admin is reachable from the network but `admin.secureCookies` is false.\n\
                 Put it behind HTTPS (a reverse proxy) and set `admin.secureCookies: true`; otherwise\n\
                 passwords and sessions cross the network unencrypted."
            );
        }
    }

    // Rebuild when files change on disk.
    let watched = site::watched_paths(root, &config);
    let watch_state = Arc::clone(&state);
    thread::spawn(move || {
        let mut last = fsutil::fingerprint(&watched);
        loop {
            thread::sleep(Duration::from_millis(500));
            let now = fsutil::fingerprint(&watched);
            if now != last {
                last = now;
                match watch_state.rebuild() {
                    Ok(r) => println!("rebuilt: {} posts, {} files", r.posts, r.files),
                    Err(e) => eprintln!("build failed (still serving the previous build):\n{e}"),
                }
            }
        }
    });

    // Persist view counts shortly after they change.
    let flush_state = Arc::clone(&state);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        if let Err(e) = flush_state.flush_analytics() {
            eprintln!("analytics: {e}");
        }
    });

    // Publish scheduled posts the moment they are due.
    let schedule_state = Arc::clone(&state);
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        if let Some(result) = schedule_state.tick_scheduler() {
            match result {
                Ok(r) => println!(
                    "scheduled posts published; {} live, {} still waiting",
                    r.posts, r.scheduled
                ),
                Err(e) => eprintln!("scheduled build failed:\n{e}"),
            }
        }
    });

    let listener = TcpListener::bind((options.host.as_str(), options.port))
        .map_err(|e| format!("cannot listen on {}:{}: {e}", options.host, options.port))?;
    println!(
        "\nServing {} at http://{}:{}{}/  (Ctrl+C to stop)",
        out_dir.display(),
        display_host(&options.host),
        options.port,
        state.base_path
    );
    if options.admin {
        println!(
            "Admin editor:  http://{}:{}/admin",
            display_host(&options.host),
            options.port
        );
    }

    let active = Arc::new(AtomicUsize::new(0));
    let per_ip: Arc<Mutex<HashMap<IpAddr, usize>>> = Arc::new(Mutex::new(HashMap::new()));
    for stream in listener.incoming().flatten() {
        let Ok(peer) = stream.peer_addr() else {
            continue;
        };
        let proxied = state
            .trusted_proxies
            .iter()
            .any(|p| p.trim() == peer.ip().to_string());
        let Some(guard) = SlotGuard::acquire(&active, &per_ip, peer.ip(), proxied) else {
            continue;
        };
        let state = Arc::clone(&state);
        let out = out_dir.clone();
        thread::spawn(move || {
            let _guard = guard;
            let _ = handle(&stream, &state, &out);
        });
    }
    Ok(())
}

fn display_host(host: &str) -> &str {
    if host == "127.0.0.1" {
        "localhost"
    } else {
        host
    }
}

pub fn print_report(report: &site::BuildReport) {
    println!(
        "Built {} posts, {} series, {} tags, {} pages ({} generated files) -> {}",
        report.posts,
        report.series,
        report.tags,
        report.pages,
        report.files,
        report.out_dir.display()
    );
    if report.scheduled > 0 {
        let next = report
            .next_due
            .map(|d| format!(", next on {}", d.rfc3339()))
            .unwrap_or_default();
        println!("{} scheduled post(s) waiting{next}.", report.scheduled);
    }
    for w in &report.warnings {
        eprintln!("warning: {w}");
    }
}

fn handle(stream: &TcpStream, state: &AppState, out_dir: &Path) -> std::io::Result<()> {
    let mut conn = Conn::new(stream);
    let mut req = match conn.read_head() {
        Ok(r) => r,
        Err(e) => return http::write_response(stream, &Response::text(e.status, e.message), false),
    };
    let head_only = req.method == "HEAD";
    // Authorise from the headers alone, then read the body only up to what this route allows.
    let max_body = match admin::preflight(state, &req) {
        Ok(max) => max,
        Err(response) => return http::write_response(stream, &response, head_only),
    };
    if let Err(e) = conn.read_body(&mut req, max_body) {
        return http::write_response(stream, &Response::text(e.status, e.message), false);
    }
    let response = route(state, &req, out_dir);
    http::write_response(stream, &response, head_only)
}

pub(crate) fn route(state: &AppState, req: &Request, out_dir: &Path) -> Response {
    if req.path == "/admin" || req.path.starts_with("/admin/") {
        return admin::handle(state, req);
    }
    if state.analytics_enabled {
        if req.path == "/api/hit" {
            return crate::analytics::hit(state, req, out_dir);
        }
        if req.path == "/api/views" {
            if req.method != "GET" && req.method != "HEAD" {
                return Response::error(405, "Use GET");
            }
            return crate::analytics::views(state, req, out_dir);
        }
    }
    if req.method != "GET" && req.method != "HEAD" {
        return Response::text(405, "Method Not Allowed");
    }
    // A site built for https://host/base/ is previewed at http://localhost/base/.
    let path = if state.base_path.is_empty() {
        req.path.as_str()
    } else if req.path == state.base_path {
        "/"
    } else if let Some(rest) = req.path.strip_prefix(&format!("{}/", state.base_path)) {
        &req.path[req.path.len() - rest.len() - 1..]
    } else {
        return Response::new(
            404,
            "text/html; charset=utf-8",
            format!(
                "<p>This site is served under <a href=\"{0}/\">{0}/</a>.</p>",
                state.base_path
            )
            .into_bytes(),
        );
    };
    match resolve(out_dir, path) {
        Some(file) => match fs::read(&file) {
            Ok(bytes) => {
                // Assets may be cached by browsers and CDNs; pages always revalidate.
                let cache = if state.cdn.max_age > 0 && state.cdn.is_asset_path(&req.path) {
                    format!("public, max-age={}", state.cdn.max_age)
                } else {
                    "no-cache".to_string()
                };
                let mut response =
                    Response::new(200, mime(&file), bytes).with_header("Cache-Control", &cache);
                // Public data files may be read by scripts on other sites (a "latest posts" list).
                if matches!(
                    path,
                    "/api/blog.json" | "/feed.json" | "/rss.xml" | "/search.json"
                ) {
                    response = response.with_header("Access-Control-Allow-Origin", "*");
                }
                response
            }
            Err(_) => Response::text(500, "Read error"),
        },
        None => {
            let body = fs::read(out_dir.join("404.html")).unwrap_or_else(|_| b"Not found".to_vec());
            Response::new(404, "text/html; charset=utf-8", body)
        }
    }
}

pub(crate) fn resolve(out_dir: &Path, url_path: &str) -> Option<PathBuf> {
    let rel = Path::new(url_path.trim_start_matches('/'));
    let mut clean = PathBuf::new();
    for component in rel.components() {
        match component {
            Component::Normal(c) => clean.push(c),
            Component::CurDir => {}
            // Reject `..`, drive prefixes and absolute components outright.
            _ => return None,
        }
    }
    let candidate = out_dir.join(&clean);
    if candidate.is_dir() {
        let index = candidate.join("index.html");
        return index.is_file().then_some(index);
    }
    if candidate.is_file() {
        // Never serve our own bookkeeping file.
        if candidate.file_name().is_some_and(|n| n == fsutil::MARKER) {
            return None;
        }
        return Some(candidate);
    }
    // `/about` -> `/about/index.html`, like most static hosts.
    let index = candidate.join("index.html");
    index.is_file().then_some(index)
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_are_capped_globally_and_per_address_and_released_on_drop() {
        let active = Arc::new(AtomicUsize::new(0));
        let per_ip = Arc::new(Mutex::new(HashMap::new()));
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        let mut held = Vec::new();
        for _ in 0..MAX_PER_IP {
            held.push(
                SlotGuard::acquire(&active, &per_ip, a, false).expect("under the per-IP cap"),
            );
        }
        assert!(
            SlotGuard::acquire(&active, &per_ip, a, false).is_none(),
            "one address cannot take more"
        );
        assert!(
            SlotGuard::acquire(&active, &per_ip, b, false).is_some(),
            "other addresses still get in"
        );
        assert_eq!(
            active.load(Ordering::SeqCst),
            MAX_PER_IP,
            "a refused acquire leaves no slot behind"
        );
        held.clear();
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert!(per_ip.lock().unwrap().is_empty());
        assert!(SlotGuard::acquire(&active, &per_ip, a, false).is_some());
        for _ in 0..MAX_PER_IP + 4 {
            held.push(
                SlotGuard::acquire(&active, &per_ip, b, true)
                    .expect("a trusted proxy is not capped per address"),
            );
        }
    }

    #[test]
    fn resolves_directories_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("ob-serve-{}", std::process::id()));
        fs::create_dir_all(dir.join("about")).unwrap();
        fs::write(dir.join("about/index.html"), "x").unwrap();
        fs::write(dir.join("a.css"), "x").unwrap();
        fs::write(dir.join(fsutil::MARKER), "x").unwrap();
        assert!(resolve(&dir, "/about/").is_some());
        assert!(resolve(&dir, "/about").is_some());
        assert!(resolve(&dir, "/a.css").is_some());
        assert!(resolve(&dir, "/nope").is_none());
        assert!(resolve(&dir, "/../secret").is_none());
        assert!(resolve(&dir, "/about/../../x").is_none());
        assert!(resolve(&dir, "/.openblog-output").is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}

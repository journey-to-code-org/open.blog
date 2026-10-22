//! A small development server: rebuilds when files change and serves the
//! output directory. Plain `std::net`, no async runtime and no dependencies.

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::Duration;

use crate::fsutil;
use crate::site::{self, BuildOptions};

pub fn run(root: &Path, include_drafts: bool, port: u16) -> Result<(), String> {
    let report = site::build(root, &BuildOptions { include_drafts, out_override: None })?;
    print_report(&report);
    let out_dir = report.out_dir.clone();

    let config = site::load_config(root)?;
    let watched = site::watched_paths(root, &config);
    let root_for_watch = root.to_path_buf();
    thread::spawn(move || {
        let mut last = fsutil::fingerprint(&watched);
        loop {
            thread::sleep(Duration::from_millis(500));
            let now = fsutil::fingerprint(&watched);
            if now != last {
                last = now;
                match site::build(&root_for_watch, &BuildOptions { include_drafts, out_override: None }) {
                    Ok(r) => println!("rebuilt: {} posts, {} files", r.posts, r.files),
                    Err(e) => eprintln!("build failed (still serving the previous build):\n{e}"),
                }
            }
        }
    });

    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("cannot listen on port {port}: {e}"))?;
    println!("\nServing {} at http://localhost:{port}/  (Ctrl+C to stop)", out_dir.display());
    for stream in listener.incoming().flatten() {
        let out = out_dir.clone();
        thread::spawn(move || {
            let _ = handle(stream, &out);
        });
    }
    Ok(())
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
    for w in &report.warnings {
        eprintln!("warning: {w}");
    }
}

fn handle(mut stream: TcpStream, out_dir: &Path) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // Drain headers.
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        return respond(&mut stream, 405, "text/plain", b"Method Not Allowed", false);
    }
    let path_part = target.split(['?', '#']).next().unwrap_or("/");
    let decoded = percent_decode(path_part);
    let head_only = method == "HEAD";

    match resolve(out_dir, &decoded) {
        Some(file) => match fs::read(&file) {
            Ok(bytes) => respond(&mut stream, 200, mime(&file), &bytes, head_only),
            Err(_) => respond(&mut stream, 500, "text/plain", b"Read error", head_only),
        },
        None => {
            let body = fs::read(out_dir.join("404.html")).unwrap_or_else(|_| b"Not found".to_vec());
            respond(&mut stream, 404, "text/html; charset=utf-8", &body, head_only)
        }
    }
}

fn resolve(out_dir: &Path, url_path: &str) -> Option<PathBuf> {
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
        return Some(candidate);
    }
    // `/about` -> `/about/index.html`, like most static hosts.
    let index = candidate.join("index.html");
    index.is_file().then_some(index)
}

fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8], head_only: bool) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    if !head_only {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
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

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_directories_and_rejects_traversal() {
        let dir = std::env::temp_dir().join(format!("ob-serve-{}", std::process::id()));
        fs::create_dir_all(dir.join("about")).unwrap();
        fs::write(dir.join("about/index.html"), "x").unwrap();
        fs::write(dir.join("a.css"), "x").unwrap();
        assert!(resolve(&dir, "/about/").is_some());
        assert!(resolve(&dir, "/about").is_some());
        assert!(resolve(&dir, "/a.css").is_some());
        assert!(resolve(&dir, "/nope").is_none());
        assert!(resolve(&dir, "/../secret").is_none());
        assert!(resolve(&dir, "/about/../../x").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("/a%20b"), "/a b");
        assert_eq!(percent_decode("/100%"), "/100%");
        assert_eq!(percent_decode("/%zz"), "/%zz");
    }
}

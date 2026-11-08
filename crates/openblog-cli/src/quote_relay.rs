//! The quote form on a site run by `openblog serve` itself, as on Render (ADR 0387).
//!
//! The hosted quote function (ADR 0381) is plain Node code. On Netlify, Netlify runs it. On a host
//! that runs this server instead, the container also starts that same code as a small service that
//! listens only on this machine (`scripts/quote-service.mjs`), and this server passes the site's
//! `/api/quote/...` addresses to it. So the form posts to its own site, as it does on Netlify, and
//! every check the function makes (same origin, the signed token, the limits, the honeypot, the
//! sizes) is the same code.
//!
//! Off unless `OPENBLOG_QUOTE_ENABLED` is exactly `true`, the same switch the function reads. Then
//! `/api/quote/...` is a plain missing address, as before. The service is only ever reached on
//! `127.0.0.1`, at `OPENBLOG_QUOTE_SERVICE_PORT` (default 8788); nothing here can be pointed
//! elsewhere. Only the headers the function reads are passed on. The visitor's address is the one
//! this server worked out (behind a trusted proxy, the address that proxy saw), never a header the
//! visitor wrote, and only the headers a reply needs come back. Nothing is logged.

use std::time::Duration;

use crate::http::{Request, Response};

/// The function refuses a body over 4 MiB + 64 KiB with its own page; a little more is let through
/// so that the visitor sees that page and not a bare error.
pub(crate) const MAX_BODY_BYTES: usize = 4 * 1024 * 1024 + 80 * 1024;
const DEFAULT_PORT: u16 = 8788;
const MAX_REPLY_BYTES: u64 = 8 * 1024 * 1024;
/// The function bounds its own work (storage calls, the owner's email); this is a last stop.
const TIMEOUT: Duration = Duration::from_secs(25);
const PASSED_ON: [&str; 4] = ["content-type", "accept", "origin", "authorization"];
const PASSED_BACK: [&str; 7] = [
    "cache-control",
    "x-content-type-options",
    "referrer-policy",
    "x-frame-options",
    "content-security-policy",
    "content-disposition",
    "retry-after",
];

/// The local port of the quote service, when quote requests are on here.
pub(crate) fn port(env: &dyn Fn(&str) -> Option<String>) -> Option<u16> {
    if env("OPENBLOG_QUOTE_ENABLED").as_deref() != Some("true") {
        return None;
    }
    match env("OPENBLOG_QUOTE_SERVICE_PORT") {
        None => Some(DEFAULT_PORT),
        Some(value) if value.trim().is_empty() => Some(DEFAULT_PORT),
        // A wrong value is off, never a guess.
        Some(value) => value.trim().parse::<u16>().ok().filter(|p| *p >= 1024),
    }
}

pub(crate) fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub(crate) fn is_quote_path(path: &str) -> bool {
    path.starts_with("/api/quote/")
}

/// How large a body this address may send, decided from the headers alone.
pub(crate) fn body_limit(env: &dyn Fn(&str) -> Option<String>, req: &Request) -> usize {
    if port(env).is_some() && req.method == "POST" {
        MAX_BODY_BYTES
    } else {
        0
    }
}

fn wants_json(req: &Request) -> bool {
    req.header("accept")
        .is_some_and(|accept| accept.to_ascii_lowercase().contains("application/json"))
}

/// A plain answer when the service cannot be asked. Without JavaScript a visitor sees a page.
fn unavailable(req: &Request, status: u16, heading: &str, message: &str) -> Response {
    let response = if wants_json(req) {
        Response::json(
            status,
            &serde_json::json!({ "error": if status == 504 { "timeout" } else { "failed" } }),
        )
    } else {
        Response::new(
            status,
            "text/html; charset=utf-8",
            format!(
                "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>{heading}</title></head><body><main><h1>{heading}</h1><p>{message}</p></main></body></html>"
            )
            .into_bytes(),
        )
    };
    response
        .with_header("Cache-Control", "no-store")
        .with_header("X-Content-Type-Options", "nosniff")
}

/// Passes one `/api/quote/...` request to the local quote service and its answer back. `client`
/// is the visitor's address as this server worked it out.
pub(crate) fn route(
    env: &dyn Fn(&str) -> Option<String>,
    req: &Request,
    client: &str,
) -> Option<Response> {
    let port = port(env)?;
    // Quote addresses are fixed words and request ids; anything else is not one.
    if !req
        .path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.'))
        || req.path.contains("..")
    {
        return Some(Response::error(404, "Not found"));
    }
    if !matches!(req.method.as_str(), "GET" | "HEAD" | "POST") {
        return Some(Response::error(405, "Use GET or POST"));
    }
    let mut url = format!("http://127.0.0.1:{port}{}", req.path);
    if !req.query.is_empty() {
        let mut pairs: Vec<(&String, &String)> = req.query.iter().collect();
        pairs.sort();
        url.push('?');
        url.push_str(
            &url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(pairs)
                .finish(),
        );
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into();
    let client: String = client
        .chars()
        .filter(|c| c.is_ascii_hexdigit() || matches!(c, '.' | ':'))
        .take(45)
        .collect();
    let result = if req.method == "POST" {
        let mut call = agent.post(&url).header("X-Forwarded-For", &client);
        for name in PASSED_ON {
            if let Some(value) = req.header(name) {
                call = call.header(name, value);
            }
        }
        call.send(&req.body[..])
    } else {
        let mut call = agent.get(&url).header("X-Forwarded-For", &client);
        for name in PASSED_ON {
            if let Some(value) = req.header(name) {
                call = call.header(name, value);
            }
        }
        call.call()
    };
    let mut reply = match result {
        Ok(reply) => reply,
        Err(ureq::Error::Timeout(_)) => {
            return Some(unavailable(
                req,
                504,
                "We could not confirm your request",
                "It may not have been saved. Please call us, or try again in a little while.",
            ))
        }
        Err(_) => {
            return Some(unavailable(
                req,
                502,
                "We could not save your request",
                "Nothing was sent. Please try again in a little while, or call us.",
            ))
        }
    };
    let status = reply.status().as_u16();
    let content_type = reply
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/plain; charset=utf-8")
        .to_string();
    let kept: Vec<(String, String)> = PASSED_BACK
        .iter()
        .filter_map(|name| {
            reply
                .headers()
                .get(*name)
                .and_then(|v| v.to_str().ok())
                .map(|v| ((*name).to_string(), v.to_string()))
        })
        .collect();
    let Ok(body) = reply
        .body_mut()
        .with_config()
        .limit(MAX_REPLY_BYTES)
        .read_to_vec()
    else {
        return Some(unavailable(
            req,
            502,
            "We could not confirm your request",
            "It may not have been saved. Please call us, or try again in a little while.",
        ));
    };
    let mut response = Response::new(status, &content_type, body);
    for (name, value) in kept {
        response = response.with_header(&name, &value);
    }
    Some(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn env_with(port: Option<u16>) -> impl Fn(&str) -> Option<String> {
        move |name| match name {
            "OPENBLOG_QUOTE_ENABLED" => Some("true".into()),
            "OPENBLOG_QUOTE_SERVICE_PORT" => port.map(|p| p.to_string()),
            _ => None,
        }
    }

    fn request(method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Request {
        Request {
            method: method.into(),
            path: path.into(),
            query: HashMap::new(),
            headers: headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: body.to_vec(),
            peer: "10.0.0.1".into(),
        }
    }

    /// A stand-in for the quote service: answers once with `reply` and hands back what it was sent.
    fn service(reply: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut seen = Vec::new();
            let mut chunk = [0u8; 8192];
            loop {
                let n = stream.read(&mut chunk).unwrap_or(0);
                if n == 0 {
                    break;
                }
                seen.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&seen).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if seen.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&seen).to_string()
        });
        (port, handle)
    }

    #[test]
    fn off_unless_quote_requests_are_on_and_a_wrong_port_is_off() {
        let off = |_: &str| None;
        assert_eq!(port(&off), None);
        assert!(route(
            &off,
            &request("GET", "/api/quote/token", &[], b""),
            "1.2.3.4"
        )
        .is_none());
        assert_eq!(
            body_limit(&off, &request("POST", "/api/quote/submit", &[], b"")),
            0
        );
        let yes = |name: &str| (name == "OPENBLOG_QUOTE_ENABLED").then(|| "yes".to_string());
        assert_eq!(port(&yes), None, "only exactly true turns it on");
        assert_eq!(port(&env_with(None)), Some(DEFAULT_PORT));
        assert_eq!(port(&env_with(Some(80))), None);
        let words = |name: &str| match name {
            "OPENBLOG_QUOTE_ENABLED" => Some("true".to_string()),
            _ => Some("eighty".to_string()),
        };
        assert_eq!(port(&words), None);
        assert_eq!(
            body_limit(
                &env_with(None),
                &request("POST", "/api/quote/submit", &[], b"")
            ),
            MAX_BODY_BYTES
        );
        assert_eq!(
            body_limit(
                &env_with(None),
                &request("GET", "/api/quote/token", &[], b"")
            ),
            0
        );
    }

    #[test]
    fn a_post_reaches_the_local_service_with_only_the_headers_it_reads_and_the_real_address() {
        let (port, seen) = service("HTTP/1.1 201 Created\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nSet-Cookie: x=1\r\nContent-Length: 23\r\nConnection: close\r\n\r\n{\"status\":\"received\"}\n\n");
        let req = request(
            "POST",
            "/api/quote/submit",
            &[
                ("content-type", "application/x-www-form-urlencoded"),
                ("accept", "application/json"),
                ("origin", "https://acme.example"),
                ("cookie", "session=secret"),
                ("x-forwarded-for", "6.6.6.6"),
                ("x-nf-client-connection-ip", "6.6.6.6"),
            ],
            b"name=Ann&token=t",
        );
        let response = route(&env_with(Some(port)), &req, "203.0.113.9").unwrap();
        assert_eq!(response.status, 201);
        assert!(String::from_utf8_lossy(&response.body).contains("received"));
        let names: Vec<String> = response
            .headers
            .iter()
            .map(|(k, _)| k.to_ascii_lowercase())
            .collect();
        assert!(names.contains(&"cache-control".to_string()));
        assert!(
            !names.contains(&"set-cookie".to_string()),
            "only the reply headers a page needs come back"
        );
        let seen = seen.join().unwrap().to_ascii_lowercase();
        assert!(seen.starts_with("post /api/quote/submit "));
        assert!(seen.contains("x-forwarded-for: 203.0.113.9"));
        assert!(
            !seen.contains("6.6.6.6"),
            "a visitor cannot choose the address the limits count"
        );
        assert!(!seen.contains("cookie") && !seen.contains("secret"));
        assert!(seen.contains("origin: https://acme.example"));
        assert!(seen.ends_with("name=ann&token=t"));
    }

    #[test]
    fn a_service_that_is_not_running_gets_a_plain_answer_and_odd_addresses_go_nowhere() {
        // Bind and drop, so nothing listens on the port.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let page = route(
            &env_with(Some(port)),
            &request("POST", "/api/quote/submit", &[], b""),
            "1.2.3.4",
        )
        .unwrap();
        assert_eq!(page.status, 502);
        assert!(String::from_utf8_lossy(&page.body).contains("Nothing was sent"));
        let json = route(
            &env_with(Some(port)),
            &request(
                "POST",
                "/api/quote/submit",
                &[("accept", "application/json")],
                b"",
            ),
            "1.2.3.4",
        )
        .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&json.body),
            "{\"error\":\"failed\"}"
        );
        for path in ["/api/quote/../admin", "/api/quote/a b", "/api/quote/%2e"] {
            assert_eq!(
                route(
                    &env_with(Some(port)),
                    &request("GET", path, &[], b""),
                    "1.2.3.4"
                )
                .unwrap()
                .status,
                404,
                "{path}"
            );
        }
        assert_eq!(
            route(
                &env_with(Some(port)),
                &request("DELETE", "/api/quote/erase", &[], b""),
                "1.2.3.4"
            )
            .unwrap()
            .status,
            405
        );
    }
}

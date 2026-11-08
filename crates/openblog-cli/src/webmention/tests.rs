use super::*;
use std::cell::RefCell;
use std::fs;
use std::io::Write;
use std::net::{SocketAddr, TcpListener};
use std::thread;

use crate::safe_http::PublicResolver;

// ---- A scripted network: no socket, every call recorded. ----

type Handler = dyn Fn(&str, &Url, &str) -> Result<Reply, NetError>;

struct Scripted {
    handler: Box<Handler>,
    calls: RefCell<Vec<String>>,
}

impl Scripted {
    fn new(handler: impl Fn(&str, &Url, &str) -> Result<Reply, NetError> + 'static) -> Self {
        Self {
            handler: Box::new(handler),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls.borrow().clone()
    }
}

impl Network for Scripted {
    fn get(&self, url: &Url) -> Result<Reply, NetError> {
        self.calls.borrow_mut().push(format!("GET {url}"));
        (self.handler)("GET", url, "")
    }

    fn post_form(&self, url: &Url, body: &str) -> Result<Reply, NetError> {
        self.calls.borrow_mut().push(format!("POST {url} {body}"));
        (self.handler)("POST", url, body)
    }
}

struct NoNetwork;

impl Network for NoNetwork {
    fn get(&self, url: &Url) -> Result<Reply, NetError> {
        panic!("a dry run or a refused run must not contact {url}");
    }

    fn post_form(&self, url: &Url, _: &str) -> Result<Reply, NetError> {
        panic!("a dry run or a refused run must not contact {url}");
    }
}

fn html(status: u16, body: &str) -> Reply {
    Reply {
        status,
        content_type: Some("text/html".into()),
        body: body.as_bytes().to_vec(),
        ..Reply::default()
    }
}

fn redirect(location: &str) -> Reply {
    Reply {
        status: 302,
        location: Some(location.into()),
        ..Reply::default()
    }
}

fn status(status: u16) -> Reply {
    Reply {
        status,
        ..Reply::default()
    }
}

// ---- Discovery and the ping over the scripted network. ----

#[test]
fn the_first_link_header_wins_over_html_and_the_form_carries_both_addresses() {
    let network = Scripted::new(|method, url, _| match (method, url.path()) {
        ("GET", "/article") => Ok(Reply {
            links: vec![r#"</from-header?id=7>; rel="webmention""#.into()],
            ..html(200, r#"<link rel="webmention" href="/from-html">"#)
        }),
        ("POST", "/from-header") => Ok(status(202)),
        other => panic!("unexpected {other:?}"),
    });
    let attempt = ping(
        &network,
        "https://blog.example.org/p/",
        "https://other.example/article",
    );
    assert_eq!(
        attempt,
        Attempt::Answered {
            endpoint: "https://other.example/from-header?id=7".into(),
            status: 202,
            location: None,
        }
    );
    assert_eq!(
        network.calls()[1],
        "POST https://other.example/from-header?id=7 source=https%3A%2F%2Fblog.example.org%2Fp%2F&target=https%3A%2F%2Fother.example%2Farticle"
    );
}

#[test]
fn html_endpoints_are_read_in_document_order_from_link_and_a() {
    assert_eq!(
        html_endpoints(
            br#"<html><head><link rel="stylesheet" href="/s.css"></head><body>
            <!-- <link rel="webmention" href="/commented"> -->
            <a rel="nofollow webmention" href="/first">x</a>
            <link rel="webmention" href="/second"></body></html>"#
        ),
        ["/first", "/second"]
    );
    assert_eq!(
        post_links(
            r#"<p><a href="https://a.example/">a</a> <a>no href</a> <a href="/x">x</a></p>"#
        ),
        ["https://a.example/", "/x"]
    );
}

#[test]
fn a_201_location_is_kept_only_when_it_is_a_public_address() {
    let created = |location: &'static str| {
        Scripted::new(move |method, _, _| match method {
            "GET" => Ok(html(
                200,
                r#"<a rel="webmention" href="https://other.example/wm">"#,
            )),
            _ => Ok(Reply {
                location: Some(location.into()),
                ..status(201)
            }),
        })
    };
    let attempt = ping(
        &created("/status/1"),
        "https://b.example/p",
        "https://other.example/a",
    );
    assert!(matches!(
        attempt,
        Attempt::Answered { location: Some(ref url), .. } if url == "https://other.example/status/1"
    ));
    let attempt = ping(
        &created("http://192.168.1.1/status"),
        "https://b.example/p",
        "https://other.example/a",
    );
    assert!(matches!(
        attempt,
        Attempt::Answered {
            location: None,
            status: 201,
            ..
        }
    ));
}

#[test]
fn an_endpoint_on_a_private_or_local_address_is_never_posted_to() {
    for endpoint in [
        "http://127.0.0.1/wm",
        "http://10.0.0.8/wm",
        "http://[::1]/wm",
        "http://localhost/wm",
        "http://admin.localhost/wm",
        "http://user:secret@other.example/wm",
    ] {
        let network = Scripted::new(move |method, _, _| {
            assert_eq!(method, "GET", "nothing is posted to {endpoint}");
            Ok(html(
                200,
                &format!(r#"<link rel="webmention" href="{endpoint}">"#),
            ))
        });
        assert_eq!(
            ping(&network, "https://b.example/p", "https://other.example/a"),
            Attempt::Blocked,
            "{endpoint}"
        );
        assert_eq!(network.calls().len(), 1);
    }
}

#[test]
fn redirects_are_followed_a_bounded_number_of_times_and_only_to_web_addresses() {
    let looping = Scripted::new(|_, url, _| Ok(redirect(&format!("{}x", url.path()))));
    assert_eq!(
        ping(&looping, "https://b.example/p", "https://other.example/a"),
        Attempt::BadRedirect
    );
    assert_eq!(looping.calls().len(), MAX_REDIRECTS + 1);
    let to_file = Scripted::new(|_, _, _| Ok(redirect("file:///etc/passwd")));
    assert_eq!(
        ping(&to_file, "https://b.example/p", "https://other.example/a"),
        Attempt::BadRedirect
    );
    let no_location = Scripted::new(|_, _, _| Ok(status(301)));
    assert_eq!(
        ping(
            &no_location,
            "https://b.example/p",
            "https://other.example/a"
        ),
        Attempt::BadRedirect
    );
    // The endpoint resolves against the address after the redirect.
    let moved = Scripted::new(|method, url, _| match (method, url.as_str()) {
        ("GET", "https://other.example/a") => Ok(redirect("https://moved.example/new/a")),
        ("GET", _) => Ok(html(200, r#"<link rel="webmention" href="wm">"#)),
        ("POST", "https://moved.example/new/wm") => Ok(status(200)),
        other => panic!("unexpected {other:?}"),
    });
    assert!(matches!(
        ping(&moved, "https://b.example/p", "https://other.example/a"),
        Attempt::Answered { status: 200, .. }
    ));
}

#[test]
fn target_answers_and_silences_become_the_right_attempts() {
    let answering = |reply: Reply| {
        let reply = RefCell::new(Some(reply));
        Scripted::new(move |_, _, _| Ok(reply.borrow_mut().take().unwrap_or_else(|| status(500))))
    };
    assert_eq!(
        ping(
            &answering(status(410)),
            "https://b.example/p",
            "https://o.example/a"
        ),
        Attempt::TargetStatus(410)
    );
    assert_eq!(
        ping(
            &answering(html(200, "<p>no endpoint</p>")),
            "https://b.example/p",
            "https://o.example/a"
        ),
        Attempt::NoEndpoint
    );
    let image = Reply {
        content_type: Some("image/png".into()),
        ..status(200)
    };
    assert_eq!(
        ping(
            &answering(image),
            "https://b.example/p",
            "https://o.example/a"
        ),
        Attempt::NoEndpoint
    );
    let silent = Scripted::new(|_, _, _| Err(NetError::NoAnswer));
    assert_eq!(
        ping(&silent, "https://b.example/p", "https://o.example/a"),
        Attempt::NoAnswer
    );
    let endpoint_silent = Scripted::new(|method, _, _| match method {
        "GET" => Ok(html(200, r#"<a rel="webmention" href="/wm">"#)),
        _ => Err(NetError::NoAnswer),
    });
    assert_eq!(
        ping(
            &endpoint_silent,
            "https://b.example/p",
            "https://o.example/a"
        ),
        Attempt::NoAnswer
    );
}

// ---- The real public-only network against a local server. ----

/// Serves the scripted raw responses, one connection each, and returns each request as received.
fn serve(responses: Vec<String>) -> (SocketAddr, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let (mut stream, _) = listener.accept().unwrap();
            requests.push(read_request(&mut stream));
            stream.write_all(response.as_bytes()).unwrap();
        }
        requests
    });
    (address, handle)
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut received = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let read = stream.read(&mut buffer).unwrap();
        if read == 0 {
            break;
        }
        received.extend_from_slice(&buffer[..read]);
        let text = String::from_utf8_lossy(&received).to_string();
        if let Some(end) = text.find("\r\n\r\n") {
            let length = text[..end]
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if received.len() >= end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8_lossy(&received).to_string()
}

fn local(address: SocketAddr) -> PublicNetwork {
    PublicNetwork {
        resolver: PublicResolver::mapped_for_local_test("wm.test", address),
        timeout: Some(Duration::from_secs(5)),
    }
}

#[test]
fn a_real_ping_follows_a_redirect_reads_the_link_header_and_posts_the_form() {
    let (address, server) = serve(vec![
        "HTTP/1.1 301 Moved\r\nLocation: /final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        "HTTP/1.1 200 OK\r\nLink: <https://elsewhere.example/>; rel=\"me\"\r\nLink: </wm?token=1>; rel=\"webmention\"\r\nContent-Type: text/html\r\nContent-Length: 4\r\nConnection: close\r\n\r\n<p/>".into(),
        "HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
    ]);
    let target = format!("http://wm.test:{}/start", address.port());
    let attempt = ping(&local(address), "https://blog.example.org/p/", &target);
    let requests = server.join().unwrap();
    assert_eq!(
        attempt,
        Attempt::Answered {
            endpoint: format!("http://wm.test:{}/wm?token=1", address.port()),
            status: 202,
            location: None,
        }
    );
    assert!(requests[0].starts_with("GET /start "), "{}", requests[0]);
    assert!(requests[1].starts_with("GET /final "), "{}", requests[1]);
    let post = &requests[2];
    assert!(post.starts_with("POST /wm?token=1 "), "{post}");
    assert!(post
        .to_ascii_lowercase()
        .contains("content-type: application/x-www-form-urlencoded"));
    assert!(post.ends_with(&webmention::form_body(
        "https://blog.example.org/p/",
        &target
    )));
    assert!(!post.to_ascii_lowercase().contains("authorization"));
}

#[test]
fn a_redirect_to_a_private_address_is_refused_before_it_is_requested() {
    let (address, server) = serve(vec![format!(
        "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{}/admin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        9
    )]);
    let target = format!("http://wm.test:{}/start", address.port());
    assert_eq!(
        ping(&local(address), "https://blog.example.org/p/", &target),
        Attempt::Blocked
    );
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn a_name_that_resolves_to_a_private_address_is_never_connected_to() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let network = PublicNetwork {
        resolver: PublicResolver::mapped_for_policy_test("wm.test", address),
        timeout: Some(Duration::from_secs(5)),
    };
    let target = format!("http://wm.test:{}/start", address.port());
    assert_eq!(
        ping(&network, "https://blog.example.org/p/", &target),
        Attempt::Blocked
    );
    assert!(
        listener.accept().is_err(),
        "the private address must never be connected to"
    );
}

#[test]
fn a_silent_endpoint_times_out_as_no_answer() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_request(&mut stream);
        thread::sleep(Duration::from_millis(400));
    });
    let network = PublicNetwork {
        resolver: PublicResolver::mapped_for_local_test("wm.test", address),
        timeout: Some(Duration::from_millis(100)),
    };
    let target = format!("http://wm.test:{}/slow", address.port());
    assert_eq!(
        ping(&network, "https://blog.example.org/p/", &target),
        Attempt::NoAnswer
    );
    server.join().unwrap();
}

// ---- The command over a project on disk. ----

fn project(config: &str, post: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-webmention-{}",
        crate::auth::random_token().unwrap()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::write(root.join("openblog.json"), config).unwrap();
    fs::write(root.join("content/posts/post.md"), post).unwrap();
    root
}

const POST: &str = "---\ntitle: Post\nslug: post\ndate: 2020-01-01\n---\n\nSee [their article](https://other.example/article#part) and [my about page](/about/).\n";
const ENABLED: &str = r#"{"url":"https://blog.openblog.dev","webmention":{"enabled":true}}"#;

/// A live canonical page, a target with a header endpoint, and the endpoint's scripted answers.
fn live(answers: Vec<u16>) -> Scripted {
    let answers = RefCell::new(answers);
    Scripted::new(move |method, url, _| match (method, url.host_str()) {
        ("GET", Some("blog.openblog.dev")) => Ok(html(
            200,
            &format!(r#"<html><head><link rel="canonical" href="{url}"></head></html>"#),
        )),
        ("GET", Some("other.example")) => Ok(Reply {
            links: vec!["</wm>; rel=webmention".into()],
            ..status(200)
        }),
        ("POST", Some("other.example")) => Ok(status(answers.borrow_mut().remove(0))),
        other => panic!("unexpected {other:?}"),
    })
}

fn options(write: bool) -> Options {
    Options {
        slug: Some("post".into()),
        write,
        json: false,
    }
}

fn queue(root: &Path) -> WebmentionState {
    WebmentionState::from_json(
        &fs::read_to_string(root.join(".openblog/webmentions.json")).unwrap(),
    )
    .unwrap()
}

#[test]
fn a_dry_run_works_with_sending_off_and_contacts_nothing() {
    let root = project(r#"{"url":"https://blog.openblog.dev"}"#, POST);
    let report = run_with(&root, &options(false), &NoNetwork, 1_000).unwrap();
    assert!(!report.enabled);
    let post = &report.posts[0];
    assert_eq!(post.planned.len(), 1);
    assert_eq!(post.planned[0].target, "https://other.example/article");
    assert_eq!(post.planned[0].action, Action::Send);
    assert!(post.outcomes.is_empty());
    assert!(
        !root.join(".openblog").exists(),
        "a dry run writes no queue"
    );
    let error = run_with(&root, &options(true), &NoNetwork, 1_000).unwrap_err();
    assert!(error.contains("Webmention sending is off"), "{error}");
    assert!(!root.join(".openblog").exists());
    let json = Options {
        json: true,
        ..options(true)
    };
    assert!(run_with(&root, &json, &NoNetwork, 1_000).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_failed_ping_is_retried_after_its_back_off_and_a_sent_one_is_never_repeated() {
    let root = project(ENABLED, POST);
    let network = live(vec![503, 202]);
    let first = run_with(&root, &options(true), &network, 1_000).unwrap();
    assert_eq!(first.posts[0].outcomes[0].status, PingStatus::Retrying);
    let canonical = first.posts[0].canonical_url.clone().unwrap();
    let record = &queue(&root).sources[&canonical].targets["https://other.example/article"];
    assert_eq!((record.attempts, record.next_attempt_at), (1, Some(1_600)));
    assert_eq!(record.error.as_deref(), Some("endpoint-unavailable"));

    let calls = network.calls().len();
    let waiting = run_with(&root, &options(true), &network, 1_599).unwrap();
    assert_eq!(waiting.posts[0].planned[0].action, Action::Wait);
    assert_eq!(
        network.calls().len(),
        calls,
        "nothing is contacted before the retry is due"
    );

    let retried = run_with(&root, &options(true), &network, 1_600).unwrap();
    assert_eq!(retried.posts[0].planned[0].reason.code(), "retry-due");
    assert_eq!(retried.posts[0].outcomes[0].status, PingStatus::Sent);

    let calls = network.calls().len();
    let again = run_with(&root, &options(true), &network, 99_999).unwrap();
    assert_eq!(again.posts[0].planned[0].reason.code(), "already-sent");
    assert_eq!(network.calls().len(), calls);

    // Editing the post re-sends, and removing the link tells the target once.
    fs::write(
        root.join("content/posts/post.md"),
        POST.replace(
            "See [their article](https://other.example/article#part) and ",
            "Now only ",
        ),
    )
    .unwrap();
    let removed = run_with(&root, &options(true), &live(vec![200]), 100_000).unwrap();
    assert_eq!(removed.posts[0].planned[0].reason.code(), "link-removed");
    assert_eq!(removed.posts[0].outcomes[0].status, PingStatus::Sent);
    let after = run_with(&root, &options(true), &NoNetwork, 100_001).unwrap();
    assert_eq!(after.posts[0].planned[0].action, Action::Skip);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn nothing_is_sent_for_a_post_that_is_not_live_or_opted_out() {
    let root = project(ENABLED, POST);
    let not_live = Scripted::new(|_, _, _| Ok(html(404, "missing")));
    let report = run_with(&root, &options(true), &not_live, 1_000).unwrap();
    assert_eq!(report.posts[0].not_sent, Some("canonical-not-live"));
    assert_eq!(not_live.calls().len(), 1, "only the canonical check");
    assert!(!root.join(".openblog").exists());
    let not_canonical = Scripted::new(|_, _, _| Ok(html(200, "<p>a different page</p>")));
    let report = run_with(&root, &options(true), &not_canonical, 1_000).unwrap();
    assert!(report.posts[0]
        .problem
        .as_deref()
        .unwrap()
        .contains("canonical"));

    fs::write(
        root.join("content/posts/post.md"),
        POST.replace(
            "date: 2020-01-01\n",
            "date: 2020-01-01\nwebmentions: false\n",
        ),
    )
    .unwrap();
    let report = run_with(&root, &options(true), &NoNetwork, 1_000).unwrap();
    assert_eq!(report.posts[0].not_sent, Some("opted-out"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn drafts_excluded_hosts_and_unsafe_queue_paths_are_refused() {
    let draft = POST.replace("date: 2020-01-01\n", "date: 2020-01-01\ndraft: true\n");
    let root = project(ENABLED, &draft);
    let error = run_with(&root, &options(true), &NoNetwork, 1_000).unwrap_err();
    assert!(error.contains("not production-visible"), "{error}");
    fs::remove_dir_all(root).unwrap();

    let root = project(
        r#"{"url":"https://blog.openblog.dev","webmention":{"enabled":true,"excludeHosts":["other.example"]}}"#,
        POST,
    );
    let report = run_with(&root, &options(true), &NoNetwork, 1_000).unwrap();
    assert!(report.posts[0].planned.is_empty());
    assert_eq!(report.posts[0].skipped_links[0].reason, "excluded");
    fs::remove_dir_all(root).unwrap();

    let root = project(
        r#"{"url":"https://blog.openblog.dev","webmention":{"enabled":true,"stateFile":"../outside.json"}}"#,
        POST,
    );
    let error = run_with(&root, &options(true), &NoNetwork, 1_000).unwrap_err();
    assert!(error.contains("project-relative"), "{error}");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_site_that_never_sets_webmention_writes_the_same_configuration() {
    let config = openblog_core::SiteConfig::default();
    let json = serde_json::to_string(&config).unwrap();
    assert!(!json.contains("webmention"), "{json}");
    let parsed: openblog_core::SiteConfig =
        serde_json::from_str(r#"{"webmention":{"enabled":false}}"#).unwrap();
    assert_eq!(parsed, config);
}

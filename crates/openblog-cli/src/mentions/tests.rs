use super::*;
use std::cell::RefCell;
use std::fs;

use crate::webmention::Reply;

// ---- Fakes: a scripted network and a hosted receiver in memory. Nothing leaves the process. ----

type Handler = dyn Fn(&Url) -> Result<Reply, NetError>;

struct Scripted {
    handler: Box<Handler>,
    calls: RefCell<Vec<String>>,
}

impl Scripted {
    fn new(handler: impl Fn(&Url) -> Result<Reply, NetError> + 'static) -> Self {
        Self {
            handler: Box::new(handler),
            calls: RefCell::new(Vec::new()),
        }
    }
}

impl Network for Scripted {
    fn get(&self, url: &Url) -> Result<Reply, NetError> {
        self.calls.borrow_mut().push(format!("GET {url}"));
        (self.handler)(url)
    }

    fn post_form(&self, url: &Url, _: &str) -> Result<Reply, NetError> {
        panic!("receiving never posts, but posted to {url}");
    }
}

struct NoNetwork;

impl Network for NoNetwork {
    fn get(&self, url: &Url) -> Result<Reply, NetError> {
        panic!("this run must not fetch {url}");
    }

    fn post_form(&self, url: &Url, _: &str) -> Result<Reply, NetError> {
        panic!("this run must not post to {url}");
    }
}

#[derive(Default)]
struct FakeHosted {
    waiting: RefCell<Vec<Request>>,
    settled: RefCell<Vec<(String, i64)>>,
}

impl Hosted for &FakeHosted {
    fn take(&self, limit: usize) -> Result<Vec<Request>, String> {
        Ok(self.waiting.borrow().iter().take(limit).cloned().collect())
    }

    fn settle(&self, done: &[(String, i64)]) -> Result<(), String> {
        self.waiting
            .borrow_mut()
            .retain(|request| !done.contains(&(request.id.clone(), request.version)));
        self.settled.borrow_mut().extend_from_slice(done);
        Ok(())
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

const TARGET: &str = "https://blog.openblog.dev/posts/post/";
const ENABLED: &str = r#"{"url":"https://blog.openblog.dev","webmention":{"receive":{"enabled":true,"endpoint":"https://blog.openblog.dev/api/webmention"}}}"#;
const POST: &str = "---\ntitle: Post\nslug: post\ndate: 2020-01-01\n---\n\nHello.\n";
const NOW: u64 = 2_000_000_000;

fn project(config: &str, post: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-mentions-{}",
        crate::auth::random_token().unwrap()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::write(root.join("openblog.json"), config).unwrap();
    fs::write(root.join("content/posts/post.md"), post).unwrap();
    root
}

fn request(n: i64, source: &str, target: &str) -> Request {
    Request {
        id: format!("r{n}"),
        version: 1,
        source: source.into(),
        target: target.into(),
        received_at: NOW - 60,
    }
}

fn options(action: &str, argument: Option<&str>) -> Options {
    Options {
        action: Some(action.into()),
        argument: argument.map(str::to_string),
        write: true,
        ..Options::default()
    }
}

fn run(
    root: &Path,
    options: &Options,
    hosted: &FakeHosted,
    network: &dyn Network,
) -> Result<String, String> {
    run_with(
        root,
        options,
        &|| Ok(Box::new(hosted) as Box<dyn Hosted + '_>),
        network,
        NOW,
    )
}

fn inbox(root: &Path) -> Inbox {
    Inbox::from_json(&fs::read_to_string(root.join(".openblog/webmention-inbox.json")).unwrap())
        .unwrap()
}

fn built(root: &Path) -> Vec<openblog_core::OutputFile> {
    let (mut site, themes) = crate::site::load_site(root, false, None).unwrap();
    crate::site::generate_site(root, &mut site, &themes).unwrap()
}

fn published(root: &Path) -> Option<MentionsFile> {
    fs::read_to_string(root.join("content/webmentions.json"))
        .ok()
        .map(|text| MentionsFile::from_json(&text).unwrap())
}

const REPLY: &str = r#"<html><head><title>Fallback title</title><script>document.write('<a href="https://blog.openblog.dev/posts/post/">x</a>')</script></head>
<body><article class="h-entry"><h1 class="p-name">A <em>reply</em></h1>
<a class="p-author h-card" href="/me"><img src="/me.png" alt=""><span class="p-name">Ana</span></a>
<time class="dt-published" datetime="2026-10-01T09:00:00Z">1 Oct</time>
<p>See <a href="https://blog.openblog.dev/posts/post/#intro">this post</a>.</p></article></body></html>"#;

// ---- Source verification ----

#[test]
fn the_source_must_link_the_target_exactly_and_its_scripts_are_never_run() {
    let target = Url::parse(TARGET).unwrap();
    let source = "https://other.example/reply";
    let found = |body: &str| {
        check_source(
            &Scripted::new({
                let body = body.to_string();
                move |_| Ok(html(200, &body))
            }),
            source,
            &target,
        )
    };
    match found(REPLY) {
        SourceCheck::Links(claimed) => {
            assert_eq!(claimed.title.as_deref(), Some("A reply"));
            assert_eq!(claimed.author.as_deref(), Some("Ana"));
            assert_eq!(claimed.published.as_deref(), Some("2026-10-01"));
        }
        other => panic!("{other:?}"),
    }
    // A link written only by a script is no link: the page is parsed, never run.
    assert_eq!(
        found(
            r#"<script>document.write('<a href="https://blog.openblog.dev/posts/post/">')</script>"#
        ),
        SourceCheck::NoLink
    );
    // A similar address is not the target.
    assert_eq!(
        found(r#"<a href="https://blog.openblog.dev/posts/post/extra">x</a>"#),
        SourceCheck::NoLink
    );
    assert_eq!(
        found(r#"<a href="https://blog.openblog.dev.evil.example/post/">x</a>"#),
        SourceCheck::NoLink
    );
    // A relative link resolves against the source.
    let relative = check_source(
        &Scripted::new(|_| Ok(html(200, r#"<a href="/posts/post/">x</a>"#))),
        "https://blog.openblog.dev/elsewhere",
        &target,
    );
    assert!(matches!(relative, SourceCheck::Links(_)));
    // Without an h-entry the page's title is the claim.
    match found(r#"<title> Plain </title><a href="https://blog.openblog.dev/posts/post/">x</a>"#) {
        SourceCheck::Links(claimed) => {
            assert_eq!(claimed.title.as_deref(), Some("Plain"));
            assert_eq!(claimed.author, None);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn source_answers_become_the_right_checks() {
    let target = Url::parse(TARGET).unwrap();
    let check = |reply: Result<Reply, NetError>| {
        check_source(
            &Scripted::new(move |_| reply.clone()),
            "https://other.example/x",
            &target,
        )
    };
    assert_eq!(check(Ok(html(410, ""))), SourceCheck::Gone);
    assert_eq!(check(Ok(html(404, ""))), SourceCheck::Gone);
    assert_eq!(check(Ok(html(503, ""))), SourceCheck::Unreachable);
    assert_eq!(check(Err(NetError::NoAnswer)), SourceCheck::Unreachable);
    assert_eq!(check(Err(NetError::Blocked)), SourceCheck::NotPublic);
    assert_eq!(
        check(Ok(Reply {
            content_type: Some("application/pdf".into()),
            ..html(200, TARGET)
        })),
        SourceCheck::Unsupported
    );
    assert!(matches!(
        check(Ok(Reply {
            content_type: Some("text/plain".into()),
            ..html(200, &format!("see {TARGET}"))
        })),
        SourceCheck::Links(_)
    ));
    // Redirects are followed a bounded number of times.
    let looping = Scripted::new(|url| {
        Ok(Reply {
            status: 302,
            location: Some(format!("{url}x")),
            ..Reply::default()
        })
    });
    assert_eq!(
        check_source(&looping, "https://other.example/x", &target),
        SourceCheck::Unreachable
    );
    assert_eq!(looping.calls.borrow().len(), MAX_REDIRECTS + 1);
}

// ---- Pull ----

#[test]
fn a_dry_run_and_a_site_with_receiving_off_contact_nothing() {
    let root = project(r#"{"url":"https://blog.openblog.dev"}"#, POST);
    let hosted = FakeHosted::default();
    let dry = Options {
        write: false,
        ..options("pull", None)
    };
    let out = run(&root, &dry, &hosted, &NoNetwork).unwrap();
    assert!(out.contains("Receiving is off"), "{out}");
    let refused = run_with(
        &root,
        &options("pull", None),
        &|| Err("receiving Webmentions is off".into()),
        &NoNetwork,
        NOW,
    );
    assert!(refused.unwrap_err().contains("off"));
    assert!(!root.join("content/webmentions.json").exists());
}

#[test]
fn a_pull_verifies_queues_and_settles_and_only_approval_publishes() {
    let root = project(ENABLED, POST);
    let hosted = FakeHosted::default();
    hosted.waiting.borrow_mut().extend([
        request(
            1,
            "https://other.example/reply",
            "https://blog.openblog.dev/posts/post/#comments",
        ),
        request(2, "https://other.example/unlinked", TARGET),
        request(
            3,
            "https://other.example/x",
            "https://blog.openblog.dev/not-a-post/",
        ),
        request(
            4,
            "https://other.example/x",
            "https://elsewhere.example/post/",
        ),
        request(5, "https://slow.example/x", TARGET),
    ]);
    let network = Scripted::new(|url| match url.path() {
        "/reply" => Ok(html(200, REPLY)),
        "/unlinked" => Ok(html(200, "<p>nothing</p>")),
        _ if url.host_str() == Some("slow.example") => Err(NetError::NoAnswer),
        other => panic!("fetched {other}"),
    });
    let out = run(&root, &options("pull", None), &hosted, &network).unwrap();
    assert!(out.contains("Pulled 5 request(s)"), "{out}");
    // Requests 3 and 4 were refused without a fetch.
    assert_eq!(network.calls.borrow().len(), 3);
    // Everything but the slow source is settled; it stays for the next pull.
    let settled: Vec<_> = hosted
        .settled
        .borrow()
        .iter()
        .map(|(id, _)| id.clone())
        .collect();
    assert_eq!(settled, ["r1", "r2", "r3", "r4"]);
    assert_eq!(hosted.waiting.borrow().len(), 1);
    let inbox = inbox(&root);
    assert_eq!(inbox.mentions.len(), 1);
    let (id, mention) = inbox.mentions.iter().next().unwrap();
    assert_eq!(mention.status, MentionStatus::Pending);
    assert_eq!(mention.post, "posts/post.md");
    assert_eq!(mention.target, TARGET);
    assert!(
        published(&root).is_none(),
        "nothing pending is ever published"
    );

    let approve = Options {
        revision: Some("1".into()),
        ..options("approve", Some(id))
    };
    run(&root, &approve, &hosted, &NoNetwork).unwrap();
    let file = published(&root).unwrap();
    assert_eq!(file.mentions.len(), 1);
    assert_eq!(file.mentions[0].title.as_deref(), Some("A reply"));

    // The build lists it on the post's page, and the head advertises the endpoint.
    let files = built(&root);
    let page = files
        .iter()
        .find(|file| file.path == "posts/post/index.html")
        .expect("post page");
    let html = &page.contents;
    assert!(html
        .contains("<link rel=\"webmention\" href=\"https://blog.openblog.dev/api/webmention\">"));
    assert!(html.contains("class=\"ob-mentions\""));
    assert!(html.contains("rel=\"nofollow ugc noopener noreferrer\""));
}

#[test]
fn a_blocked_host_is_never_fetched_and_its_published_mentions_go_at_once() {
    let root = project(ENABLED, POST);
    let hosted = FakeHosted::default();
    hosted
        .waiting
        .borrow_mut()
        .push(request(1, "https://other.example/reply", TARGET));
    let network = Scripted::new(|_| Ok(html(200, REPLY)));
    run(&root, &options("pull", None), &hosted, &network).unwrap();
    let id = inbox(&root).mentions.keys().next().unwrap().clone();
    run(
        &root,
        &Options {
            revision: Some("1".into()),
            ..options("approve", Some(&id))
        },
        &hosted,
        &NoNetwork,
    )
    .unwrap();
    assert_eq!(published(&root).unwrap().mentions.len(), 1);

    run(
        &root,
        &options("block", Some("other.example")),
        &hosted,
        &NoNetwork,
    )
    .unwrap();
    assert!(published(&root).unwrap().mentions.is_empty());
    let blocked = inbox(&root);
    assert_eq!(blocked.mentions[&id].status, MentionStatus::Blocked);
    assert_eq!(blocked.mentions[&id].claimed, Claimed::default());

    hosted
        .waiting
        .borrow_mut()
        .push(request(2, "https://www.other.example/again", TARGET));
    run(&root, &options("pull", None), &hosted, &NoNetwork).unwrap();
    assert!(
        hosted.waiting.borrow().is_empty(),
        "the blocked request is settled unread"
    );
}

#[test]
fn decisions_need_the_revision_read_and_bad_input_is_refused() {
    let root = project(ENABLED, POST);
    let hosted = FakeHosted::default();
    hosted
        .waiting
        .borrow_mut()
        .push(request(1, "https://other.example/reply", TARGET));
    run(
        &root,
        &options("pull", None),
        &hosted,
        &Scripted::new(|_| Ok(html(200, REPLY))),
    )
    .unwrap();
    let id = inbox(&root).mentions.keys().next().unwrap().clone();
    let missing = run(&root, &options("approve", Some(&id)), &hosted, &NoNetwork).unwrap_err();
    assert!(missing.contains("--revision"), "{missing}");
    let stale = run(
        &root,
        &Options {
            revision: Some("2".into()),
            ..options("approve", Some(&id))
        },
        &hosted,
        &NoNetwork,
    )
    .unwrap_err();
    assert!(stale.contains("changed since you read it"), "{stale}");
    let bad_reason = run(
        &root,
        &Options {
            reason: Some("wrong".into()),
            ..options("reject", Some(&id))
        },
        &hosted,
        &NoNetwork,
    )
    .unwrap_err();
    assert!(bad_reason.contains("--reason"));
    run(
        &root,
        &Options {
            reason: Some("spam".into()),
            ..options("reject", Some(&id))
        },
        &hosted,
        &NoNetwork,
    )
    .unwrap();
    assert_eq!(inbox(&root).mentions[&id].reason.as_deref(), Some("spam"));
    assert!(run(
        &root,
        &options("block", Some("not a host")),
        &hosted,
        &NoNetwork
    )
    .is_err());
    assert!(run(&root, &options("frobnicate", None), &hosted, &NoNetwork).is_err());
    let listed = run(
        &root,
        &Options {
            json: true,
            write: false,
            ..options("list", None)
        },
        &hosted,
        &NoNetwork,
    )
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&listed).unwrap();
    assert_eq!(value["mentions"][0]["status"], "rejected");
}

#[test]
fn prune_is_a_dry_run_until_written_and_keeps_approved_mentions() {
    let root = project(ENABLED, POST);
    let hosted = FakeHosted::default();
    hosted
        .waiting
        .borrow_mut()
        .push(request(1, "https://other.example/reply", TARGET));
    run(
        &root,
        &options("pull", None),
        &hosted,
        &Scripted::new(|_| Ok(html(200, REPLY))),
    )
    .unwrap();
    let id = inbox(&root).mentions.keys().next().unwrap().clone();
    run(&root, &options("reject", Some(&id)), &hosted, &NoNetwork).unwrap();
    let later = |root: &Path, write: bool| {
        run_with(
            root,
            &Options {
                write,
                ..options("prune", None)
            },
            &|| unreachable!(),
            &NoNetwork,
            NOW + 91 * 86_400,
        )
    };
    assert!(later(&root, false).unwrap().contains("Dry run"));
    assert_eq!(inbox(&root).mentions.len(), 1);
    later(&root, true).unwrap();
    assert!(inbox(&root).mentions.is_empty());
}

#[test]
fn a_post_that_opts_out_takes_no_mention_and_advertises_no_endpoint() {
    let root = project(
        ENABLED,
        "---\ntitle: Post\nslug: post\ndate: 2020-01-01\nwebmentions: false\n---\n\nHello.\n",
    );
    let hosted = FakeHosted::default();
    hosted
        .waiting
        .borrow_mut()
        .push(request(1, "https://other.example/reply", TARGET));
    run(&root, &options("pull", None), &hosted, &NoNetwork).unwrap();
    assert!(inbox(&root).mentions.is_empty());
    let files = built(&root);
    let page = files
        .iter()
        .find(|file| file.path == "posts/post/index.html")
        .unwrap();
    assert!(!page.contents.contains("rel=\"webmention\""));
    let manifest = files
        .iter()
        .find(|file| file.path == "openblog-webmention.json")
        .unwrap();
    assert_eq!(manifest.contents, r#"{"targets":[],"version":1}"#);
}

#[test]
fn a_site_with_receiving_off_builds_exactly_as_before() {
    let root = project(r#"{"url":"https://blog.openblog.dev"}"#, POST);
    let files = built(&root);
    assert!(files
        .iter()
        .all(|file| file.path != "openblog-webmention.json"));
    for file in &files {
        let text = &file.contents;
        assert!(
            !text.contains("rel=\"webmention\"") && !text.contains("ob-mentions"),
            "{}",
            file.path
        );
    }
    let config = site::load_config(&root).unwrap();
    assert!(!serde_json::to_string(&config).unwrap().contains("receive"));
}

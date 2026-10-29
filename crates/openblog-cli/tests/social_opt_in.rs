//! Optional social publishing is off by default and invisible to the publishing pipeline
//! (ADRs 0293 and 0740): a site build with its feeds, a portable export, a cross-posting plan and
//! offline authoring (`openblog new`, `openblog check`) are byte for byte the same whether or not
//! the deployment holds social publishing settings and secrets, on the hosted side and on the
//! Admin side, and no such secret ever reaches their output. This is a release gate.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const SECRETS: [(&str, &str); 23] = [
    ("OPENBLOG_SOCIAL_ENABLED", "true"),
    ("SUPABASE_URL", "https://project.supabase.co"),
    (
        "SUPABASE_SECRET_KEY",
        "sb_secret_socialoptin0000000000000000000000",
    ),
    ("OPENBLOG_SITE_ID", "lantern-studios"),
    (
        "OPENBLOG_SOCIAL_ADMIN_KEY",
        "adm_socialoptin111111111111111111111111111",
    ),
    (
        "OPENBLOG_SOCIAL_WORKER_KEY",
        "wrk_socialoptin222222222222222222222222222",
    ),
    (
        "OPENBLOG_SOCIAL_TOKEN_KEYS",
        "k1:c29jaWFsb3B0aW4zMzMzMzMzMzMzMzMzMzMzMzMzMzM=",
    ),
    // The Admin side: an endpoint nothing listens on, so a stray call would fail loudly.
    ("OPENBLOG_SOCIAL_ENDPOINT", "http://127.0.0.1:9/api/social"),
    (
        "OPENBLOG_SOCIAL_CALLBACK_BASE",
        "https://blog.example.org/api/social",
    ),
    (
        "OPENBLOG_SOCIAL_LINKEDIN_CLIENT_ID",
        "lnk-client-socialoptin",
    ),
    (
        "OPENBLOG_SOCIAL_LINKEDIN_CLIENT_SECRET",
        "lnk_secret_socialoptin44444444444444444",
    ),
    ("OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID", "1234567890"),
    (
        "OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET",
        "fb_secret_socialoptin555555555555555555",
    ),
    ("OPENBLOG_SOCIAL_LINKEDIN_API_VERSION", "202610"),
    ("OPENBLOG_SOCIAL_FACEBOOK_API_VERSION", "v23.0"),
    ("OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS", "true"),
    ("OPENBLOG_SOCIAL_OPS", "true"),
    ("OPENBLOG_SOCIAL_RETENTION_DAYS", "365"),
    ("OPENBLOG_SOCIAL_BATCH_SIZE", "5"),
    ("OPENBLOG_SOCIAL_MAX_ATTEMPTS", "5"),
    ("OPENBLOG_SOCIAL_LEASE_SECONDS", "300"),
    ("OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS", "4"),
    ("OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS", "8"),
];

fn project() -> PathBuf {
    project_named("site")
}

fn project_named(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-social-opt-in-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::write(
        root.join("openblog.json"),
        r#"{"title":"Lantern","url":"https://blog.example.org","syndication":{"targets":{"dev":{"provider":"dev","enabled":true,"allowPublish":false}}}}"#,
    )
    .unwrap();
    fs::write(
        root.join("content/posts/2026-01-02-hello.md"),
        "---\ntitle: Hello\ndate: 2026-01-02\nsyndicationId: hello-2026\ntags: [notes]\n---\n\nA first post with a [link](https://example.org).\n",
    )
    .unwrap();
    root
}

fn run(root: &Path, args: &[&str], social: bool) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_openblog"));
    command.args(args).arg("--root").arg(root);
    command.env_remove("OPENBLOG_WORKSPACE");
    for (name, value) in SECRETS {
        if social {
            command.env(name, value);
        } else {
            command.env_remove(name);
        }
    }
    command.output().unwrap()
}

fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn visit(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(base, &path, out);
            } else {
                let name = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(name, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    visit(dir, dir, &mut out);
    out
}

fn assert_no_secret(label: &str, bytes: &[u8]) {
    let text = String::from_utf8_lossy(bytes);
    for (name, value) in SECRETS.iter().skip(1) {
        if value.len() > 20 {
            assert!(!text.contains(value), "{label} contains {name}");
        }
    }
}

#[test]
fn builds_exports_and_cross_posting_plans_ignore_social_publishing_settings() {
    let root = project();
    let plain = root.join("out-plain");
    let social = root.join("out-social");
    let built = run(&root, &["build", "--out", plain.to_str().unwrap()], false);
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let built_social = run(&root, &["build", "--out", social.to_str().unwrap()], true);
    assert!(built_social.status.success());
    let (plain_tree, social_tree) = (tree(&plain), tree(&social));
    assert!(!plain_tree.is_empty());
    for feed in ["rss.xml", "feed.json"] {
        assert!(plain_tree.contains_key(feed), "the build writes {feed}");
    }
    assert_eq!(
        plain_tree.keys().collect::<Vec<_>>(),
        social_tree.keys().collect::<Vec<_>>()
    );
    for (name, bytes) in &plain_tree {
        assert!(social_tree[name] == *bytes, "{name} differs");
        assert_no_secret(name, &social_tree[name]);
    }

    for args in [
        &["export", "hello", "--json"][..],
        &["export", "hello", "--format", "markdown"][..],
        &["syndicate", "hello", "--json"][..],
    ] {
        let without = run(&root, args, false);
        let with = run(&root, args, true);
        assert_eq!(without.status.code(), with.status.code(), "{args:?}");
        assert!(without.stdout == with.stdout, "{args:?} stdout differs");
        assert!(without.stderr == with.stderr, "{args:?} stderr differs");
        assert_no_secret(&format!("{args:?}"), &with.stdout);
        assert_no_secret(&format!("{args:?}"), &with.stderr);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn offline_authoring_ignores_social_publishing_settings() {
    // Two identical sites: one authored without any social setting, one with all of them. Writing a
    // new post and checking the site must produce the same files and the same report.
    let plain = project_named("author-plain");
    let social = project_named("author-social");
    for args in [
        &["new", "Second thoughts", "--tags", "notes"][..],
        &["check", "--json"][..],
        &["check"][..],
    ] {
        let without = run(&plain, args, false);
        let with = run(&social, args, true);
        assert_eq!(without.status.code(), with.status.code(), "{args:?}");
        let normalise = |bytes: &[u8], root: &Path| {
            String::from_utf8_lossy(bytes)
                .replace(&root.to_string_lossy().to_string(), "<root>")
                .replace('\\', "/")
        };
        assert_eq!(
            normalise(&without.stdout, &plain),
            normalise(&with.stdout, &social),
            "{args:?} stdout differs"
        );
        assert_eq!(
            normalise(&without.stderr, &plain),
            normalise(&with.stderr, &social),
            "{args:?} stderr differs"
        );
        assert_no_secret(&format!("{args:?}"), &with.stdout);
        assert_no_secret(&format!("{args:?}"), &with.stderr);
    }
    let (plain_posts, social_posts) = (tree(&plain.join("content")), tree(&social.join("content")));
    assert_eq!(plain_posts.len(), 2, "the new post was written");
    assert_eq!(plain_posts, social_posts);
    for (name, bytes) in &social_posts {
        assert_no_secret(name, bytes);
    }
    assert_eq!(
        fs::read(plain.join("openblog.json")).unwrap(),
        fs::read(social.join("openblog.json")).unwrap()
    );
    let _ = fs::remove_dir_all(&plain);
    let _ = fs::remove_dir_all(&social);
}

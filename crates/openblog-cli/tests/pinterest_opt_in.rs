//! Pinterest Pins are opt-in and invisible to the publishing pipeline (ADRs 0371 to 0373): a
//! build with its feeds, a portable export, a cross-posting plan and a card plan are byte for
//! byte the same whether or not `openblog.json` turns Pinterest on and the environment holds a
//! token, the token never reaches any output, and `openblog pinterest` refuses before any request
//! while it is off. No test here reaches Pinterest: the dry run makes no request, and every
//! refusal happens before one.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const TOKEN: &str = "pina_optin_token_that_must_never_be_printed_0000";
const PLAIN: &str = r#"{"title":"Kitchen","url":"https://cook.example.org"}"#;
const PINTEREST: &str = r#"{"title":"Kitchen","url":"https://cook.example.org","syndication":{"pinterest":{"enabled":true,"environment":"production","board":"111"}}}"#;

fn project() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-pinterest-opt-in-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::create_dir_all(root.join("static/img")).unwrap();
    fs::write(root.join("openblog.json"), PLAIN).unwrap();
    fs::write(
        root.join("content/posts/tart.md"),
        "---\ntitle: Lemon tart\nslug: tart\ndate: 2026-01-01\nprofile: recipe\ndescription: Sharp and short.\n---\nIntro.\n\n![A slice of tart on a plate](/img/pin.png)\n\n## Ingredients\n\n- lemons\n\n## Method\n\n1. Bake.\n",
    )
    .unwrap();
    fs::write(
        root.join("static/img/pin.png"),
        openblog_core::image_facts::samples::png(1000, 1500, false),
    )
    .unwrap();
    root
}

fn run(root: &Path, args: &[&str], token: bool) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_openblog"));
    command.args(args).arg("--root").arg(root);
    command.env_remove("OPENBLOG_WORKSPACE");
    if token {
        command.env("PINTEREST_ACCESS_TOKEN", TOKEN);
    } else {
        command.env_remove("PINTEREST_ACCESS_TOKEN");
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

fn no_token(label: &str, bytes: &[u8]) {
    assert!(
        !String::from_utf8_lossy(bytes).contains(TOKEN),
        "{label} contains the Pinterest token"
    );
}

#[test]
fn builds_feeds_exports_and_plans_ignore_pinterest_settings_and_its_token() {
    let root = project();
    let plain = root.join("out-plain");
    let pinned = root.join("out-pinterest");
    let built = run(&root, &["build", "--out", plain.to_str().unwrap()], false);
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let commands: [&[&str]; 4] = [
        &["export", "tart", "--json"],
        &["syndicate", "tart", "--json"],
        &["card", "tart", "--json"],
        &["check"],
    ];
    let before: Vec<Output> = commands.iter().map(|a| run(&root, a, false)).collect();

    fs::write(root.join("openblog.json"), PINTEREST).unwrap();
    let built = run(&root, &["build", "--out", pinned.to_str().unwrap()], true);
    assert!(built.status.success());
    let (plain_tree, pinned_tree) = (tree(&plain), tree(&pinned));
    for feed in ["rss.xml", "feed.json"] {
        assert!(plain_tree.contains_key(feed), "the build writes {feed}");
    }
    assert_eq!(
        plain_tree.keys().collect::<Vec<_>>(),
        pinned_tree.keys().collect::<Vec<_>>()
    );
    for (name, bytes) in &plain_tree {
        assert!(pinned_tree[name] == *bytes, "{name} differs");
        no_token(name, bytes);
    }
    for (args, without) in commands.iter().zip(before) {
        let with = run(&root, args, true);
        assert_eq!(without.status.code(), with.status.code(), "{args:?}");
        assert!(without.stdout == with.stdout, "{args:?} stdout differs");
        no_token(&format!("{args:?}"), &with.stdout);
        no_token(&format!("{args:?}"), &with.stderr);
    }
    assert!(!root.join(".openblog/pinterest.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn pinterest_refuses_before_any_request_while_off_and_previews_without_one_when_on() {
    let root = project();
    for args in [
        &["pinterest", "boards"][..],
        &["pinterest", "pin", "tart"][..],
        &["pinterest", "pin", "tart", "--write", "--confirm", "00"][..],
    ] {
        let output = run(&root, args, true);
        assert!(!output.status.success(), "{args:?}");
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains("Pinterest is off"), "{args:?}: {error}");
        assert!(error.contains("No request was sent"), "{args:?}");
        no_token(&format!("{args:?}"), &output.stderr);
    }

    fs::write(root.join("openblog.json"), PINTEREST).unwrap();
    let preview = run(&root, &["pinterest", "pin", "tart"], true);
    assert!(
        preview.status.success(),
        "{}",
        String::from_utf8_lossy(&preview.stderr)
    );
    let text = String::from_utf8_lossy(&preview.stdout);
    assert!(text.contains("Nothing was sent"));
    assert!(text.contains("link: https://cook.example.org/posts/tart/"));
    assert!(text.contains("--write --confirm "));
    no_token("preview", &preview.stdout);

    let json = run(&root, &["pinterest", "pin", "tart", "--json"], true);
    let plan: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(plan["remoteRequestSent"], false);
    assert_eq!(plan["ready"], true);
    assert_eq!(plan["apiBase"], "https://api.pinterest.com/v5");

    // No token: the boards list and a confirmed send stop before any request.
    for args in [
        &["pinterest", "boards"][..],
        &[
            "pinterest",
            "pin",
            "tart",
            "--write",
            "--confirm",
            plan["digest"].as_str().unwrap(),
        ][..],
    ] {
        let output = run(&root, args, false);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("PINTEREST_ACCESS_TOKEN"));
    }
    // A stale digest is refused before the token is even read.
    let stale = run(
        &root,
        &["pinterest", "pin", "tart", "--write", "--confirm", "00"],
        true,
    );
    assert!(String::from_utf8_lossy(&stale.stderr).contains("changed since you previewed it"));
    assert!(!root.join(".openblog/pinterest.json").exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn with_campaign_tags_on_the_previewed_pin_links_with_utm_source_and_a_new_digest() {
    let root = project();
    fs::write(root.join("openblog.json"), PINTEREST).unwrap();
    let plain: serde_json::Value =
        serde_json::from_slice(&run(&root, &["pinterest", "pin", "tart", "--json"], true).stdout)
            .unwrap();
    assert_eq!(plain["link"], "https://cook.example.org/posts/tart/");
    let tagged_config = PINTEREST.replacen(
        r#""syndication""#,
        r#""analytics":{"campaigns":true},"syndication""#,
        1,
    );
    fs::write(root.join("openblog.json"), tagged_config).unwrap();
    let tagged: serde_json::Value =
        serde_json::from_slice(&run(&root, &["pinterest", "pin", "tart", "--json"], true).stdout)
            .unwrap();
    assert_eq!(
        tagged["link"],
        "https://cook.example.org/posts/tart/?utm_source=pinterest&utm_medium=open.blog"
    );
    assert_eq!(tagged["ready"], true);
    assert_ne!(plain["digest"], tagged["digest"]);
    let _ = fs::remove_dir_all(&root);
}

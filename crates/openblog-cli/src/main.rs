//! The `openblog` command line.

mod admin;
mod admin_preferences;
mod analytics;
mod assistant;
mod assistant_storage;
mod atlas_store;
mod auth;
mod clock;
mod contributor_migration;
mod fsutil;
mod git;
mod hashnode;
mod http;
mod notebook_store;
mod portable_export;
mod private_guard;
mod publish;
mod safe_http;
mod scaffold;
mod serve;
mod shared_publications;
mod site;
mod source_metadata;
mod source_store;
mod syndication;
mod transaction;
mod url_context;
mod workspace;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Command, ExitCode};

const HELP: &str = "openblog: a Markdown blog engine in Rust and WebAssembly

USAGE
    openblog <command> [options]

COMMANDS
    init [dir]                 Create a new blog in dir (default: current directory)
    init [dir] --github-pages  Also write a GitHub Pages deployment workflow
    new \"Title\"                Create content/posts/<date>-<slug>.md
    build                      Build the site into dist/
    serve                      Build, serve at http://localhost:8080, rebuild on change,
                               and publish scheduled posts on time
    serve --admin              Also serve the login-protected editor at /admin
    user add|passwd|remove|list <name>
                               Manage who can sign in to the admin editor
    check                      Validate content and themes without writing anything
    export <slug>              Preview or write a portable Markdown article, or the
                               post's cited references as CSL JSON or BibTeX
    publish [summary]          Commit changed content with git and push (deploys via CI)
    publish setup              Create the repository and Pages workflow, report what is left
    syndicate <slug>           Plan cross-posting (add --write to create/update remote drafts)
    analytics backup           Save view counts to the analytics branch (and push)
    analytics pull <url>       Merge counts from a hosted counter (--secret <s>)
    analytics worker [dir]     Write a Cloudflare Worker counter to deploy (default: counter/)
    analytics service [dir]    Write a Node + MongoDB counter for Render (default: counter-service/)
    themes                     List themes and the inheritance chain of each
    import hashnode <host>     Import a Hashnode blog (e.g. yourname.hashnode.dev)
    contributors migrate --id <stable-id> [--write]
                               Plan or write explicit legacy-author credit sidecars
    build-wasm                 Rebuild the WebAssembly module (engine repository only)
    help                       Show this help

COMMON OPTIONS
    --root <dir>               Project directory (default: .)
    --drafts                   Include drafts and scheduled posts (for previews)
    --out <dir>                Output directory for build (default: paths.output)
    --port <n>                 Port for serve (default: 8080)
    --host <addr>              Address for serve (default: 127.0.0.1; use 0.0.0.0 behind HTTPS)
    --password-stdin           For `user`: read the password from standard input

syndicate OPTIONS
    --target a,b               Limit the run to named configured targets
    --write                    Send remote create/update requests and save private state
    --publish                  Request publication (also requires target allowPublish: true)
    --json                     Print a deterministic dry-run plan with before/after artifacts

export OPTIONS
    --format markdown|csl-json|bibtex
                               Portable format (default: markdown); csl-json and bibtex
                               export the public description of the references the post
                               cites, and list what the format leaves out
    --out <path>               Output file for an explicit --write
    --write                    Write the export (otherwise print a dry-run preview)
    --json                     Print a versioned dry-run manifest with exact content

new OPTIONS
    --series <slug>            Put the post in a series
    --tags a,b,c               Comma-separated tags
    --draft                    Mark the post as a draft
    --recipe                   Start from a recipe template (servings, times, ingredients, steps)

import hashnode OPTIONS
    --source public|graphql    public (default) reads your live site and needs no account;
                               graphql uses Hashnode's API (needs Pro plus --token or HASHNODE_TOKEN)
    --no-images                Keep remote image URLs instead of downloading them
    --token <pat>              Personal access token for --source graphql (or HASHNODE_TOKEN)
    --overwrite                Replace imported posts you have edited since the last run
    --limit <n>                Import only the first n posts (useful for a trial run)
    --delay <ms>               Pause between requests (default: 250)
";

struct Args {
    positional: Vec<String>,
    options: HashMap<String, String>,
    switches: HashSet<String>,
}

const SWITCHES: &[&str] = &[
    "drafts",
    "draft",
    "no-images",
    "help",
    "admin",
    "password-stdin",
    "github-pages",
    "overwrite",
    "recipe",
    "write",
    "publish",
    "json",
];

fn parse_args(raw: &[String]) -> Result<Args, String> {
    let mut args = Args {
        positional: Vec::new(),
        options: HashMap::new(),
        switches: HashSet::new(),
    };
    let mut i = 0;
    while i < raw.len() {
        let token = &raw[i];
        if let Some(name) = token.strip_prefix("--") {
            if let Some((key, value)) = name.split_once('=') {
                args.options.insert(key.to_string(), value.to_string());
            } else if SWITCHES.contains(&name) {
                args.switches.insert(name.to_string());
            } else {
                i += 1;
                let value = raw
                    .get(i)
                    .ok_or_else(|| format!("--{name} needs a value"))?;
                args.options.insert(name.to_string(), value.clone());
            }
        } else {
            args.positional.push(token.clone());
        }
        i += 1;
    }
    Ok(args)
}

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    match run(&raw) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("error: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(raw: &[String]) -> Result<(), String> {
    let Some(command) = raw.first() else {
        print!("{HELP}");
        return Ok(());
    };
    let args = parse_args(&raw[1..])?;
    if args.switches.contains("help") {
        print!("{HELP}");
        return Ok(());
    }
    let root = PathBuf::from(args.options.get("root").map(String::as_str).unwrap_or("."));
    let drafts = args.switches.contains("drafts");
    if workspace::configured()
        && matches!(
            command.as_str(),
            "init" | "new" | "import" | "publish" | "contributors"
        )
    {
        return Err("durable workspace mode requires content mutations and publishing through the admin API; CLI mutations are disabled to avoid unacknowledged writes".into());
    }

    match command.as_str() {
        "help" | "-h" | "--help" => {
            print!("{HELP}");
            Ok(())
        }
        "init" => {
            let dir = args.positional.first().map(PathBuf::from).unwrap_or(root);
            let title = args.options.get("title").map(String::as_str);
            let created = scaffold::init(&dir, title, args.switches.contains("github-pages"))?;
            if created.is_empty() {
                println!(
                    "Nothing to do: {} already looks like an open.blog project.",
                    dir.display()
                );
            } else {
                for file in &created {
                    println!("created {file}");
                }
                println!(
                    "\nNext: cd into the folder, run `openblog serve`, and edit openblog.json."
                );
            }
            Ok(())
        }
        "new" => {
            let title = args
                .positional
                .first()
                .ok_or("usage: openblog new \"Post title\"")?;
            let tags: Vec<String> = args
                .options
                .get("tags")
                .map(|t| {
                    t.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            let _transaction = transaction::ContentTransactionLock::acquire(&root)?;
            let created = scaffold::new_post(
                &root,
                title,
                args.options.get("series").map(String::as_str),
                &tags,
                args.switches.contains("draft"),
                args.switches.contains("recipe"),
            )?;
            println!("created {created}");
            Ok(())
        }
        "contributors" => {
            if args.positional.first().map(String::as_str) != Some("migrate") {
                return Err(
                    "usage: openblog contributors migrate --id <stable-id> [--write]".into(),
                );
            }
            let id = args
                .options
                .get("id")
                .ok_or("usage: openblog contributors migrate --id <stable-id> [--write]")?;
            let write = args.switches.contains("write");
            let preview = contributor_migration::plan(&root, id)?;
            let plan = if write {
                contributor_migration::apply(&preview)?
            } else {
                preview
            };
            let identity_action = if plan.config_changed {
                format!("register `{}`", plan.contributor_id)
            } else {
                format!("reuse `{}`", plan.contributor_id)
            };
            println!(
                "Contributor migration {}: {}, {} credit sidecar(s), {} existing sidecar(s) skipped.",
                if write { "write" } else { "dry run" },
                identity_action,
                plan.sidecars.len(),
                plan.skipped
            );
            if write {
                println!("Migration written. Markdown was not changed; manually entered identity data remains unauthenticated.");
            } else {
                println!("No files changed. Re-run with --write to apply this plan.");
            }
            Ok(())
        }
        "syndicate" => {
            let slug = args.positional.first().ok_or(
                "usage: openblog syndicate <slug> [--target a,b] [--json] [--write] [--publish]",
            )?;
            let target_names = args
                .options
                .get("target")
                .map(|targets| {
                    targets
                        .split(',')
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            syndication::run(
                &root,
                slug,
                syndication::Options {
                    target_names,
                    write: args.switches.contains("write"),
                    publish: args.switches.contains("publish"),
                    json: args.switches.contains("json"),
                },
            )
        }
        "export" => {
            let slug = args.positional.first().ok_or(
                "usage: openblog export <slug> [--format markdown|csl-json|bibtex] [--out <path>] [--json] [--write]",
            )?;
            let format = args
                .options
                .get("format")
                .map(String::as_str)
                .unwrap_or("markdown");
            let format = portable_export::Format::parse(format).ok_or_else(|| {
                format!(
                    "unsupported portable export format `{format}`; expected `markdown`, `csl-json` or `bibtex`"
                )
            })?;
            portable_export::run(
                &root,
                slug,
                format,
                args.options.get("out").map(String::as_str),
                args.switches.contains("write"),
                args.switches.contains("json"),
            )
        }
        "build" => {
            let out = args.options.get("out").map(PathBuf::from);
            let report = site::build(
                &root,
                &site::BuildOptions {
                    include_drafts: drafts,
                    out_override: out,
                    now: Some(clock::now()),
                },
            )?;
            serve::print_report(&report);
            Ok(())
        }
        "serve" => {
            let port: u16 = args
                .options
                .get("port")
                .map(|p| p.parse().map_err(|_| format!("`{p}` is not a valid port")))
                .transpose()?
                .unwrap_or(8080);
            let host = args
                .options
                .get("host")
                .cloned()
                .unwrap_or_else(|| "127.0.0.1".to_string());
            serve::run(
                &root,
                &serve::ServeOptions {
                    include_drafts: drafts,
                    host,
                    port,
                    admin: args.switches.contains("admin"),
                },
            )
        }
        "user" => user_command(&root, &args),
        "publish" => {
            let _transaction = transaction::ContentTransactionLock::acquire(&root)?;
            let config = site::load_config(&root)?;
            if args.positional.first().map(String::as_str) == Some("setup") {
                for note in publish::setup(&root, &config)? {
                    println!("- {note}");
                }
                return Ok(());
            }
            let outcome =
                publish::publish(&root, &config, args.positional.first().map(String::as_str))?;
            for p in &outcome.committed {
                println!("  + {p}");
            }
            for p in &outcome.skipped_drafts {
                println!("  (draft, not committed) {p}");
            }
            println!("{}", outcome.message);
            Ok(())
        }
        "analytics" => analytics_command(&root, &args),
        "check" => {
            let (site, themes) = site::load_site(&root, true, None)?;
            private_guard::refuse_private_research_in_public_inputs(&root, &site.config)?;
            let files = openblog_core::generate(&site, &themes)?;
            println!(
                "OK: {} posts, {} series, {} tags, {} pages; would write {} generated files.",
                site.posts.len(),
                site.series.len(),
                site.tags.len(),
                site.pages.len(),
                files.len()
            );
            for w in &site.warnings {
                eprintln!("warning: {w}");
            }
            for warning in portable_export::diagnostics(&site)? {
                eprintln!("warning: portability: {warning}");
            }
            serve::print_accessibility_findings(&site.accessibility);
            serve::print_evidence_findings(&site.evidence);
            if let Some(summary) = citation_summary(&site) {
                println!("{summary}");
            }
            if let Some(summary) = check_source_library(&root, &site.config.contributors)? {
                println!("{summary}");
            }
            if let Some(summary) = check_research_notebook(&root, &site.config.contributors)? {
                println!("{summary}");
            }
            if let Some((summary, notices)) =
                check_knowledge_atlas(&root, &site.config.contributors)?
            {
                for notice in notices {
                    eprintln!("notice: {notice}");
                }
                println!("{summary}");
            }
            Ok(())
        }
        "themes" => {
            let config = site::load_config(&root)?;
            let themes = site::load_themes(&root, &config)?;
            for name in themes.names() {
                match themes.resolve(&name) {
                    Ok(t) => {
                        let default = if name == config.theme {
                            "  (site default)"
                        } else {
                            ""
                        };
                        println!("{name:<16} {}  [{}]{default}", t.label, t.chain.join(" > "));
                    }
                    Err(e) => println!("{name:<16} ERROR: {e}"),
                }
            }
            Ok(())
        }
        "import" => {
            let platform = args.positional.first().map(String::as_str).unwrap_or("");
            if platform != "hashnode" {
                return Err("usage: openblog import hashnode <host>   (only `hashnode` is supported so far)".into());
            }
            let host = args
                .positional
                .get(1)
                .ok_or("usage: openblog import hashnode <host>, e.g. yourname.hashnode.dev")?;
            let source = match args
                .options
                .get("source")
                .map(String::as_str)
                .unwrap_or("public")
            {
                "public" => hashnode::Source::Public,
                "graphql" => hashnode::Source::GraphQl,
                other => return Err(format!("unknown --source `{other}`; use public or graphql")),
            };
            let config = site::load_config(&root)?;
            let options = hashnode::ImportOptions {
                host: host.clone(),
                source,
                token: args.options.get("token").cloned(),
                content_dir: root.join(&config.paths.content),
                static_dir: root.join(&config.paths.static_dir),
                download_images: !args.switches.contains("no-images"),
                overwrite: args.switches.contains("overwrite"),
                limit: args
                    .options
                    .get("limit")
                    .map(|l| l.parse().map_err(|_| format!("`{l}` is not a number")))
                    .transpose()?,
                post_path: config.post_path.clone(),
                delay_ms: args
                    .options
                    .get("delay")
                    .map(|d| d.parse().map_err(|_| format!("`{d}` is not a number")))
                    .transpose()?
                    .unwrap_or(250),
            };
            let _transaction = transaction::ContentTransactionLock::acquire(&root)?;
            let report = hashnode::run(&options)?;
            println!(
                "\nImported: {} posts written, {} unchanged, {} series, {} images downloaded.",
                report.posts_written,
                report.posts_unchanged,
                report.series_written,
                report.images_downloaded
            );
            for note in &report.skipped {
                println!("note: {note}");
            }
            if !report.image_failures.is_empty() {
                eprintln!(
                    "\n{} image(s) could not be downloaded and still point at Hashnode:",
                    report.image_failures.len()
                );
                for failure in &report.image_failures {
                    eprintln!("  - {failure}");
                }
            }
            println!("Review with `openblog check`, then `openblog serve`.");
            Ok(())
        }
        "build-wasm" => {
            let status = Command::new("wasm-pack")
                .current_dir(&root)
                .args([
                    "build",
                    "crates/openblog-wasm",
                    "--target",
                    "web",
                    "--release",
                    "--out-dir",
                    "../../web/wasm",
                    "--out-name",
                    "openblog_wasm",
                ])
                .status()
                .map_err(|e| {
                    format!(
                        "could not run wasm-pack ({e}). Install it with `cargo install wasm-pack`."
                    )
                })?;
            if status.success() {
                // wasm-pack writes a `.gitignore` containing `*`; the artifacts are meant to be committed.
                let _ = std::fs::remove_file(root.join("web/wasm/.gitignore"));
                Ok(())
            } else {
                Err("wasm-pack failed".into())
            }
        }
        other => Err(format!("unknown command `{other}`. Run `openblog help`.")),
    }
}

fn analytics_command(root: &std::path::Path, args: &Args) -> Result<(), String> {
    let config = site::load_config(root)?;
    let store_path = root.join(".openblog").join("analytics.json");
    match args.positional.first().map(String::as_str).unwrap_or("") {
        "backup" => {
            let branch = config.analytics.branch.trim().to_string();
            if branch.is_empty() {
                return Err("analytics.branch is empty in openblog.json".into());
            }
            let store = analytics::Store::load(&store_path, config.analytics.retention_days);
            let git = git::Git::new(root);
            if !git.is_repo() {
                return Err(
                    "this blog is not a git repository; run `openblog publish setup` first".into(),
                );
            }
            let message = format!("Analytics backup {}", clock::now().rfc3339());
            match git.commit_file_to_branch(
                &branch,
                "analytics.json",
                &store.export_json(),
                &message,
            )? {
                Some(id) => println!("saved analytics.json to branch `{branch}` ({id})"),
                None => println!("branch `{branch}` already has the latest analytics"),
            }
            if git.has_remote(&config.publish.remote) {
                git.push_branch(&config.publish.remote, &branch)
                    .map_err(|e| format!("push failed: {e}"))?;
                println!("pushed `{branch}` to {}", config.publish.remote);
            }
            Ok(())
        }
        "pull" => {
            let url = args
                .positional
                .get(1)
                .ok_or("usage: openblog analytics pull <counter url> --secret <secret>")?;
            let secret = args
                .options
                .get("secret")
                .cloned()
                .or_else(|| std::env::var("OPENBLOG_COUNTER_SECRET").ok())
                .ok_or("pass --secret <secret> (the worker's EXPORT_SECRET) or set OPENBLOG_COUNTER_SECRET")?;
            let name = args
                .options
                .get("name")
                .cloned()
                .unwrap_or_else(|| "worker".to_string());
            let export_url = format!("{}/export", url.trim_end_matches('/'));
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .timeout_global(Some(std::time::Duration::from_secs(60)))
                .build()
                .into();
            let body = agent
                .get(&export_url)
                .header("Authorization", &format!("Bearer {secret}"))
                .call()
                .map_err(|e| format!("GET {export_url}: {e}"))?
                .body_mut()
                .read_to_string()
                .map_err(|e| e.to_string())?;
            let data: analytics::SourceData = serde_json::from_str(&body)
                .map_err(|e| format!("the counter returned something unexpected: {e}"))?;
            let pages = data.totals.len();
            let mut store = analytics::Store::load(&store_path, config.analytics.retention_days);
            store.import_source(&name, data);
            store.save(&store_path)?;
            println!(
                "merged counts for {pages} page(s) from `{name}` into .openblog/analytics.json"
            );
            println!("run `openblog analytics backup` to save them to the branch, then rebuild to bake them in");
            Ok(())
        }
        "worker" => {
            let dir = root.join(
                args.positional
                    .get(1)
                    .map(String::as_str)
                    .unwrap_or("counter"),
            );
            let worker = dir.join("worker.js");
            let toml = dir.join("wrangler.toml");
            if worker.exists() || toml.exists() {
                return Err(format!(
                    "{} already has worker files; delete them to regenerate",
                    dir.display()
                ));
            }
            fsutil::write_file(&worker, site::COUNTER_WORKER.as_bytes())?;
            fsutil::write_file(
                &toml,
                site::COUNTER_WRANGLER
                    .replace("SITE_URL", &config.url)
                    .as_bytes(),
            )?;
            println!("wrote {} and {}", worker.display(), toml.display());
            println!("Next: follow the steps at the top of worker.js (wrangler kv namespace create, secret put, deploy),");
            println!("then set \"analytics\": {{ \"endpoint\": \"https://<name>.<you>.workers.dev\" }} in openblog.json.");
            Ok(())
        }
        "service" => {
            let dir = root.join(
                args.positional
                    .get(1)
                    .map(String::as_str)
                    .unwrap_or("counter-service"),
            );
            if dir.join("server.js").exists() {
                return Err(format!(
                    "{} already has a server.js; delete it to regenerate",
                    dir.display()
                ));
            }
            for (name, contents) in site::COUNTER_SERVICE {
                fsutil::write_file(
                    &dir.join(name),
                    contents.replace("SITE_URL", &config.url).as_bytes(),
                )?;
                println!("wrote {}", dir.join(name).display());
            }
            let workflow = root.join(".github/workflows/keep-counter-awake.yml");
            if !workflow.exists() {
                fsutil::write_file(&workflow, site::KEEP_AWAKE_WORKFLOW.as_bytes())?;
                println!("wrote {} (pings the service every 14 minutes so it never sleeps)", workflow.display());
            }
            println!(
                "Next: read {} for the Render and MongoDB steps,",
                dir.join("README.md").display()
            );
            println!("then set \"analytics\": {{ \"endpoint\": \"https://<service>.onrender.com\" }} in openblog.json.");
            Ok(())
        }
        _ => Err(
            "usage: openblog analytics backup | pull <url> --secret <s> | worker [dir] | service [dir]"
                .into(),
        ),
    }
}

fn read_password(args: &Args, confirm: bool) -> Result<String, String> {
    use std::io::{BufRead, Write};
    if let Ok(p) = std::env::var("OPENBLOG_PASSWORD") {
        if !p.is_empty() {
            return Ok(p);
        }
    }
    let stdin = std::io::stdin();
    let mut line = String::new();
    if !args.switches.contains("password-stdin") {
        eprintln!("Note: the password is shown as you type. Use --password-stdin or OPENBLOG_PASSWORD to avoid that.");
        eprint!(
            "Password (at least {} characters): ",
            auth::MIN_PASSWORD_LEN
        );
        std::io::stderr().flush().ok();
    }
    stdin
        .lock()
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let password = line.trim_end_matches(['\r', '\n']).to_string();
    if confirm && !args.switches.contains("password-stdin") {
        eprint!("Repeat password: ");
        std::io::stderr().flush().ok();
        let mut again = String::new();
        stdin
            .lock()
            .read_line(&mut again)
            .map_err(|e| e.to_string())?;
        if again.trim_end_matches(['\r', '\n']) != password {
            return Err("the passwords do not match".into());
        }
    }
    Ok(password)
}

fn user_command(root: &std::path::Path, args: &Args) -> Result<(), String> {
    user_command_with(root, args, || read_password(args, true))
}

/// `user_command` with the password source supplied, so tests need no terminal or environment.
fn user_command_with(
    root: &std::path::Path,
    args: &Args,
    password: impl FnOnce() -> Result<String, String>,
) -> Result<(), String> {
    let config = site::load_config(root)?;
    let path = root.join(&config.admin.users_file);
    let action = args.positional.first().map(String::as_str).unwrap_or("");
    let name = args.positional.get(1).map(String::as_str).unwrap_or("");
    let mut users = auth::Users::load(&path)?;
    match action {
        "list" => {
            if users.users.is_empty() {
                println!("No users. Add one with `openblog user add <name>`.");
            }
            for u in &users.users {
                println!("{}", u.name);
            }
            Ok(())
        }
        "add" | "passwd" => {
            if !auth::valid_username(name) {
                return Err(
                    "usernames are 1 to 32 characters: lowercase letters, digits, and . _ -".into(),
                );
            }
            let exists = users.find(name).is_some();
            if action == "add" && exists {
                return Err(format!("`{name}` already exists; use `openblog user passwd {name}` to change the password"));
            }
            if action == "passwd" && !exists {
                return Err(format!("no user named `{name}`"));
            }
            let password = password()?;
            if action == "add" {
                // A new account under a reused name must not inherit an old binding.
                revoke_shared_publication_bindings(root, name)?;
            }
            users.set(name, &password)?;
            users.save(&path)?;
            println!(
                "{} `{name}`. The admin users file is {}; keep it out of version control.",
                if exists { "Updated" } else { "Added" },
                path.display()
            );
            if action == "passwd" {
                println!("Any sessions that user had open are ended.");
            }
            Ok(())
        }
        "remove" => {
            if !users.remove(name) {
                return Err(format!("no user named `{name}`"));
            }
            users.save(&path)?;
            println!("Removed `{name}`. Their open sessions end immediately.");
            revoke_shared_publication_bindings(root, name)
        }
        _ => Err("usage: openblog user add|passwd|remove|list <name>".into()),
    }
}

/// How many posts publish citations, and a plain statement that their checks
/// ran offline (ADR 0050); `None` when no post publishes any.
fn citation_summary(site: &openblog_core::Site) -> Option<String> {
    let published: Vec<_> = site
        .posts
        .iter()
        .filter_map(|post| post.citations())
        .collect();
    if published.is_empty() {
        return None;
    }
    let citations: usize = published.iter().map(|summary| summary.citations).sum();
    let references: std::collections::BTreeSet<&str> = published
        .iter()
        .flat_map(|summary| {
            summary
                .references
                .iter()
                .map(|reference| reference.key.as_str())
        })
        .collect();
    Some(format!(
        "OK: {} post(s) publish {citations} citation(s) of {} reference(s). Citation checks ran offline from the source library; no identifier or link was looked up online.",
        published.len(),
        references.len()
    ))
}

/// Validate the private source library when one is stored. It is never
/// built, so a missing library is not mentioned.
fn check_source_library(
    root: &std::path::Path,
    contributors: &std::collections::BTreeMap<String, openblog_core::contributor::Contributor>,
) -> Result<Option<String>, String> {
    let snapshot = source_store::load(root, contributors).map_err(|error| error.to_string())?;
    Ok(snapshot.stored.then(|| {
        let count = snapshot.library.sources.len();
        format!(
            "OK: private source library {} has {count} source{}; builds publish only the public description of references that opted-in posts cite.",
            source_store::LIBRARY_FILE,
            if count == 1 { "" } else { "s" }
        )
    }))
}

/// Validate the private research notebook when one is stored. Like the
/// source library it is never built, so a missing notebook is not mentioned.
fn check_research_notebook(
    root: &std::path::Path,
    contributors: &std::collections::BTreeMap<String, openblog_core::contributor::Contributor>,
) -> Result<Option<String>, String> {
    let snapshot = notebook_store::load(root, contributors).map_err(|error| error.to_string())?;
    Ok(snapshot.stored.then(|| {
        format!(
            "OK: private research notebook {} has {} passage(s) and {} note(s); builds never read or publish it.",
            notebook_store::NOTEBOOK_FILE,
            snapshot.notebook.passages.len(),
            snapshot.notebook.notes.len()
        )
    }))
}

/// Validate the private Knowledge Atlas when one is stored, against the stored
/// library and notebook. Like them it is never built, so a missing atlas is
/// not mentioned. Approved relationships the publication projection would
/// leave out are non-blocking notices that name ids, never authored text.
fn check_knowledge_atlas(
    root: &std::path::Path,
    contributors: &std::collections::BTreeMap<String, openblog_core::contributor::Contributor>,
) -> Result<Option<(String, Vec<String>)>, String> {
    let snapshot = atlas_store::load(root, contributors).map_err(|error| error.to_string())?;
    if !snapshot.stored {
        return Ok(None);
    }
    let notices = snapshot
        .atlas
        .notices()
        .iter()
        .map(|notice| format!("{}: {notice}", atlas_store::ATLAS_FILE))
        .collect();
    Ok(Some((
        format!(
            "OK: private Knowledge Atlas {} has {} entr{} and {} relationship(s); builds never read or publish it.",
            atlas_store::ATLAS_FILE,
            snapshot.atlas.entries.len(),
            if snapshot.atlas.entries.len() == 1 { "y" } else { "ies" },
            snapshot.atlas.relationships.len()
        ),
        notices,
    )))
}

/// Remove an Admin username from every shared publication binding, under the content
/// transaction lock so a running Admin server cannot interleave a write.
fn revoke_shared_publication_bindings(root: &std::path::Path, name: &str) -> Result<(), String> {
    let _transaction = transaction::ContentTransactionLock::acquire_with_wait(
        root,
        std::time::Duration::from_secs(30),
    )?;
    let changed = shared_publications::revoke_admin_user(root, name)
        .map_err(|error| format!("cannot revoke `{name}` from shared reflections: {error}"))?;
    if changed > 0 {
        println!("Removed `{name}` from {changed} shared reflection(s).");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_reports_the_private_notebook_only_when_it_is_stored() {
        let root = std::env::temp_dir().join(format!(
            "openblog-check-notebook-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let contributors = std::collections::BTreeMap::new();
        assert_eq!(check_research_notebook(&root, &contributors), Ok(None));
        assert!(!root.join(".openblog").exists());

        let library = root.join(source_store::LIBRARY_FILE);
        std::fs::create_dir_all(library.parent().unwrap()).unwrap();
        std::fs::write(
            &library,
            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"W"}]}"#,
        )
        .unwrap();
        let path = root.join(notebook_store::NOTEBOOK_FILE);
        std::fs::write(
            &path,
            r#"{"version":1,"notes":[{"id":"n","kind":"question","text":"Why?","sources":["w"]}]}"#,
        )
        .unwrap();
        let summary = check_research_notebook(&root, &contributors)
            .unwrap()
            .unwrap();
        assert!(summary.contains("0 passage(s) and 1 note(s)"), "{summary}");

        std::fs::write(
            &path,
            r#"{"version":1,"notes":[{"id":"n","kind":"question","text":"Why?","sources":["gone"]}]}"#,
        )
        .unwrap();
        let error = check_research_notebook(&root, &contributors).unwrap_err();
        assert!(
            error.contains(".openblog/private/research/notebook.json: notes[0] `n`")
                && error.contains("(unknown-source)"),
            "{error}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn check_reports_the_private_atlas_only_when_it_is_stored() {
        let root = std::env::temp_dir().join(format!(
            "openblog-check-atlas-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let contributors = std::collections::BTreeMap::new();
        assert_eq!(check_knowledge_atlas(&root, &contributors), Ok(None));
        assert!(!root.join(".openblog").exists());

        let library = root.join(source_store::LIBRARY_FILE);
        std::fs::create_dir_all(library.parent().unwrap()).unwrap();
        std::fs::write(
            &library,
            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"W"}]}"#,
        )
        .unwrap();
        let path = root.join(atlas_store::ATLAS_FILE);
        std::fs::write(
            &path,
            r#"{"version":1,"entries":[{"id":"a","kind":"person","label":"ob-secret-label"},{"id":"b","kind":"work","label":"B","source":"w","visibility":"approved"}],"relationships":[{"id":"r","kind":"authored","from":"a","to":"b","assertedBy":{"kind":"author"},"evidence":[{"source":"w"}],"visibility":"approved"}]}"#,
        )
        .unwrap();
        let (summary, notices) = check_knowledge_atlas(&root, &contributors)
            .unwrap()
            .unwrap();
        assert!(
            summary.contains("2 entries and 1 relationship(s)"),
            "{summary}"
        );
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(
            notices[0].contains("relationships[0] `r` from")
                && notices[0].contains("(private-endpoint)")
                && !notices[0].contains("ob-secret-label"),
            "{notices:?}"
        );

        std::fs::write(
            &path,
            r#"{"version":1,"entries":[{"id":"b","kind":"work","label":"B","source":"gone"}]}"#,
        )
        .unwrap();
        let error = check_knowledge_atlas(&root, &contributors).unwrap_err();
        assert!(
            error.contains(".openblog/private/research/atlas.json: entries[0] `b` source")
                && error.contains("(unknown-source)"),
            "{error}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn check_states_that_citation_checks_ran_offline_only_when_posts_cite() {
        use openblog_core::model::LibrarySource;
        let load = |body: &str| {
            openblog_core::Site::load(
                openblog_core::SiteConfig::default(),
                openblog_core::Sources {
                    posts: vec![openblog_core::SourceFile {
                        path: "posts/p.md".into(),
                        contents: format!("---\ntitle: P\ndate: 2026-01-01\n{body}"),
                    }],
                    source_library: Some(LibrarySource::Text(openblog_core::SourceFile {
                        path: "sources.json".into(),
                        contents:
                            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"W"}]}"#
                                .into(),
                    })),
                    ..Default::default()
                },
                openblog_core::LoadOptions::default(),
            )
            .unwrap()
        };
        assert_eq!(citation_summary(&load("---\nPlain [@w].\n")), None);
        let summary = citation_summary(&load(
            "citations: notes\n---\nSee [@w] and [@w, canonical 2].\n",
        ))
        .unwrap();
        assert!(
            summary.starts_with("OK: 1 post(s) publish 2 citation(s) of 1 reference(s).")
                && summary.contains("offline")
                && summary.contains("no identifier or link was looked up online"),
            "{summary}"
        );
    }

    #[test]
    fn check_reports_the_private_source_library_only_when_it_is_stored() {
        let root = std::env::temp_dir().join(format!(
            "openblog-check-sources-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let contributors = std::collections::BTreeMap::new();
        assert_eq!(check_source_library(&root, &contributors), Ok(None));
        assert!(!root.join(".openblog").exists());

        let path = root.join(source_store::LIBRARY_FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"W"}]}"#,
        )
        .unwrap();
        let summary = check_source_library(&root, &contributors).unwrap().unwrap();
        assert!(summary.contains("has 1 source;"), "{summary}");

        std::fs::write(
            &path,
            r#"{"version":1,"sources":[{"id":"w","kind":"work","title":"W"},{"id":"e","kind":"edition","of":"missing","title":"E"}]}"#,
        )
        .unwrap();
        let error = check_source_library(&root, &contributors).unwrap_err();
        assert!(
            error.contains(".openblog/private/research/sources.json: sources[1] `e` of")
                && error.contains("(unresolved-relationship)"),
            "{error}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_values_and_positionals() {
        let a = parse_args(&strings(&[
            "Title",
            "--series",
            "guide",
            "--drafts",
            "--tags=a,b",
            "--port",
            "9000",
        ]))
        .unwrap();
        assert_eq!(a.positional, vec!["Title"]);
        assert_eq!(a.options["series"], "guide");
        assert_eq!(a.options["tags"], "a,b");
        assert!(a.switches.contains("drafts"));
        assert!(parse_args(&strings(&["--series"])).is_err());
    }

    #[test]
    fn removing_an_admin_user_revokes_their_shared_publication_bindings() {
        use openblog_core::collaboration::{
            NewParticipant, NewSharedPublication, NewSourceReference,
        };

        let root = std::env::temp_dir().join(format!("ob-user-revoke-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        scaffold::init(&root, Some("Revoke"), false).unwrap();
        let users_path = root.join(".openblog/users.json");
        let mut users = auth::Users::default();
        users.set("ada", "correct horse battery").unwrap();
        users.save(&users_path).unwrap();
        let record = shared_publications::create(
            &root,
            NewSharedPublication {
                title: "Shared".into(),
                sources: vec![NewSourceReference {
                    title: "Talk".into(),
                    ..NewSourceReference::default()
                }],
                creator: NewParticipant {
                    admin_user: "ada".into(),
                    contributor_id: "ada".into(),
                    display_name: "Ada".into(),
                },
                ..NewSharedPublication::default()
            },
        )
        .unwrap();

        user_command(&root, &parse_args(&strings(&["remove", "ada"])).unwrap()).unwrap();

        let loaded = shared_publications::load_all(&root).unwrap();
        assert_eq!(loaded[0].1.publication_id, record.publication_id);
        assert!(loaded[0].1.authorization.bindings.is_empty());
        assert!(auth::Users::load(&users_path)
            .unwrap()
            .find("ada")
            .is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn adding_a_reused_admin_username_revokes_bindings_left_by_the_old_account() {
        use openblog_core::collaboration::{
            NewParticipant, NewSharedPublication, NewSourceReference,
        };

        let root = std::env::temp_dir().join(format!("ob-user-reuse-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        scaffold::init(&root, Some("Reuse"), false).unwrap();
        let users_path = root.join(".openblog/users.json");
        // `ada` was dropped from users.json by hand, so her binding outlived the account.
        auth::Users::default().save(&users_path).unwrap();
        let record = shared_publications::create(
            &root,
            NewSharedPublication {
                title: "Shared".into(),
                sources: vec![NewSourceReference {
                    title: "Talk".into(),
                    ..NewSourceReference::default()
                }],
                creator: NewParticipant {
                    admin_user: "ada".into(),
                    contributor_id: "ada".into(),
                    display_name: "Ada".into(),
                },
                ..NewSharedPublication::default()
            },
        )
        .unwrap();
        assert_eq!(record.authorization.bindings.len(), 1);

        user_command_with(
            &root,
            &parse_args(&strings(&["add", "ada"])).unwrap(),
            || Ok("correct horse battery".into()),
        )
        .unwrap();

        let loaded = shared_publications::load_all(&root).unwrap();
        assert_eq!(loaded[0].1.publication_id, record.publication_id);
        assert!(loaded[0].1.authorization.bindings.is_empty());
        assert!(loaded[0].1.authorization.revision > record.authorization.revision);
        assert!(auth::Users::load(&users_path)
            .unwrap()
            .find("ada")
            .is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn json_dry_runs_work_through_command_dispatch_for_export_and_syndication() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("examples")
            .join("portable-publishing");
        for command in ["export", "syndicate"] {
            let mut args = strings(&[
                command,
                "portable-lesson",
                "--root",
                root.to_str().unwrap(),
                "--json",
            ]);
            run(&args).unwrap();
            args.push("--write".into());
            assert!(run(&args).unwrap_err().contains("dry run"));
        }
    }
}

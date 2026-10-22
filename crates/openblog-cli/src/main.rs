//! The `openblog` command line.

mod admin;
mod auth;
mod clock;
mod fsutil;
mod hashnode;
mod http;
mod scaffold;
mod serve;
mod site;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Command, ExitCode};

const HELP: &str = "openblog: a Markdown blog engine in Rust and WebAssembly

USAGE
    openblog <command> [options]

COMMANDS
    init [dir]                 Create a new blog in dir (default: current directory)
    new \"Title\"                Create content/posts/<date>-<slug>.md
    build                      Build the site into dist/
    serve                      Build, serve at http://localhost:8080, rebuild on change,
                               and publish scheduled posts on time
    serve --admin              Also serve the login-protected editor at /admin
    user add|passwd|remove|list <name>
                               Manage who can sign in to the admin editor
    check                      Validate content and themes without writing anything
    themes                     List themes and the inheritance chain of each
    import hashnode <host>     Import a Hashnode blog (e.g. journeytocode.io)
    build-wasm                 Compile the WebAssembly module with wasm-pack
    help                       Show this help

COMMON OPTIONS
    --root <dir>               Project directory (default: .)
    --drafts                   Include posts marked draft
    --out <dir>                Output directory for build (default: paths.output)
    --port <n>                 Port for serve (default: 8080)
    --host <addr>              Address for serve (default: 127.0.0.1; use 0.0.0.0 behind HTTPS)
    --password-stdin           For `user`: read the password from standard input

new OPTIONS
    --series <slug>            Put the post in a series
    --tags a,b,c               Comma-separated tags
    --draft                    Mark the post as a draft

import hashnode OPTIONS
    --source public|graphql    public (default) reads your live site and needs no account;
                               graphql uses Hashnode's API (needs Pro plus --token or HASHNODE_TOKEN)
    --no-images                Keep remote image URLs instead of downloading them
    --limit <n>                Import only the first n posts (useful for a trial run)
    --delay <ms>               Pause between requests (default: 250)
";

struct Args {
    positional: Vec<String>,
    options: HashMap<String, String>,
    switches: HashSet<String>,
}

const SWITCHES: &[&str] = &["drafts", "draft", "no-images", "help", "admin", "password-stdin"];

fn parse_args(raw: &[String]) -> Result<Args, String> {
    let mut args = Args { positional: Vec::new(), options: HashMap::new(), switches: HashSet::new() };
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
                let value = raw.get(i).ok_or_else(|| format!("--{name} needs a value"))?;
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

    match command.as_str() {
        "help" | "-h" | "--help" => {
            print!("{HELP}");
            Ok(())
        }
        "init" => {
            let dir = args.positional.first().map(PathBuf::from).unwrap_or(root);
            let title = args.options.get("title").map(String::as_str);
            let created = scaffold::init(&dir, title)?;
            if created.is_empty() {
                println!("Nothing to do: {} already looks like an open.blog project.", dir.display());
            } else {
                for file in &created {
                    println!("created {file}");
                }
                println!("\nNext: cd into the folder, run `openblog serve`, and edit openblog.json.");
            }
            Ok(())
        }
        "new" => {
            let title = args.positional.first().ok_or("usage: openblog new \"Post title\"")?;
            let tags: Vec<String> = args
                .options
                .get("tags")
                .map(|t| t.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default();
            let created = scaffold::new_post(&root, title, args.options.get("series").map(String::as_str), &tags, args.switches.contains("draft"))?;
            println!("created {created}");
            Ok(())
        }
        "build" => {
            let out = args.options.get("out").map(PathBuf::from);
            let report = site::build(&root, &site::BuildOptions { include_drafts: drafts, out_override: out, now: Some(clock::now()) })?;
            serve::print_report(&report);
            Ok(())
        }
        "serve" => {
            let port: u16 = args.options.get("port").map(|p| p.parse().map_err(|_| format!("`{p}` is not a valid port"))).transpose()?.unwrap_or(8080);
            let host = args.options.get("host").cloned().unwrap_or_else(|| "127.0.0.1".to_string());
            serve::run(&root, &serve::ServeOptions { include_drafts: drafts, host, port, admin: args.switches.contains("admin") })
        }
        "user" => user_command(&root, &args),
        "check" => {
            let (site, themes) = site::load_site(&root, true, None)?;
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
            Ok(())
        }
        "themes" => {
            let config = site::load_config(&root)?;
            let themes = site::load_themes(&root, &config)?;
            for name in themes.names() {
                match themes.resolve(&name) {
                    Ok(t) => {
                        let default = if name == config.theme { "  (site default)" } else { "" };
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
            let host = args.positional.get(1).ok_or("usage: openblog import hashnode <host>, e.g. journeytocode.io")?;
            let source = match args.options.get("source").map(String::as_str).unwrap_or("public") {
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
                limit: args.options.get("limit").map(|l| l.parse().map_err(|_| format!("`{l}` is not a number"))).transpose()?,
                delay_ms: args.options.get("delay").map(|d| d.parse().map_err(|_| format!("`{d}` is not a number"))).transpose()?.unwrap_or(250),
            };
            let report = hashnode::run(&options)?;
            println!(
                "\nImported: {} posts written, {} unchanged, {} series, {} images downloaded.",
                report.posts_written, report.posts_unchanged, report.series_written, report.images_downloaded
            );
            for note in &report.skipped {
                println!("note: {note}");
            }
            if !report.image_failures.is_empty() {
                eprintln!("\n{} image(s) could not be downloaded and still point at Hashnode:", report.image_failures.len());
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
                .args(["build", "crates/openblog-wasm", "--target", "web", "--release", "--out-dir", "../../web/wasm", "--out-name", "openblog_wasm"])
                .status()
                .map_err(|e| format!("could not run wasm-pack ({e}). Install it with `cargo install wasm-pack`."))?;
            if status.success() {
                Ok(())
            } else {
                Err("wasm-pack failed".into())
            }
        }
        other => Err(format!("unknown command `{other}`. Run `openblog help`.")),
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
        eprint!("Password (at least {} characters): ", auth::MIN_PASSWORD_LEN);
        std::io::stderr().flush().ok();
    }
    stdin.lock().read_line(&mut line).map_err(|e| e.to_string())?;
    let password = line.trim_end_matches(['\r', '\n']).to_string();
    if confirm && !args.switches.contains("password-stdin") {
        eprint!("Repeat password: ");
        std::io::stderr().flush().ok();
        let mut again = String::new();
        stdin.lock().read_line(&mut again).map_err(|e| e.to_string())?;
        if again.trim_end_matches(['\r', '\n']) != password {
            return Err("the passwords do not match".into());
        }
    }
    Ok(password)
}

fn user_command(root: &std::path::Path, args: &Args) -> Result<(), String> {
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
                return Err("usernames are 1 to 32 characters: lowercase letters, digits, and . _ -".into());
            }
            let exists = users.find(name).is_some();
            if action == "add" && exists {
                return Err(format!("`{name}` already exists; use `openblog user passwd {name}` to change the password"));
            }
            if action == "passwd" && !exists {
                return Err(format!("no user named `{name}`"));
            }
            let password = read_password(args, true)?;
            users.set(name, &password)?;
            users.save(&path)?;
            println!("{} `{name}`. The admin users file is {}; keep it out of version control.", if exists { "Updated" } else { "Added" }, path.display());
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
            Ok(())
        }
        _ => Err("usage: openblog user add|passwd|remove|list <name>".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_values_and_positionals() {
        let a = parse_args(&strings(&["Title", "--series", "guide", "--drafts", "--tags=a,b", "--port", "9000"])).unwrap();
        assert_eq!(a.positional, vec!["Title"]);
        assert_eq!(a.options["series"], "guide");
        assert_eq!(a.options["tags"], "a,b");
        assert!(a.switches.contains("drafts"));
        assert!(parse_args(&strings(&["--series"])).is_err());
    }
}

//! `openblog init` and `openblog new`.

use std::fs;
use std::path::Path;

use openblog_core::frontmatter::{self, Value};
use openblog_core::slug::slugify;
use openblog_core::{DateTime, SiteConfig};

use crate::fsutil;
use crate::site::{self, CONFIG_FILE, EMBEDDED_BASE_THEME, EMBEDDED_WEB};

pub fn today() -> DateTime {
    crate::clock::now()
}

const WELCOME: &str = "Welcome to your new blog. This post is a plain Markdown file in `content/posts/`.

## Write

Drop any `.md` file into `content/posts/`. The front matter at the top sets the title, date, tags, and optional series.

## Publish

Run `openblog build`, then upload the `dist/` folder to any static host. Your RSS feed is at `/rss.xml`.

```rust runnable
fn main() {
    println!(\"Hello, open.blog!\");
}
```
";

const ABOUT: &str = "This page is `content/pages/about.md`. Pages with `nav: true` in their front matter appear in the header.
";

/// A ready-made kind of site `openblog init --starter` writes on top of the plain project.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Starter {
    /// A trade business (ADR 0399): business facts, example services as drafts, empty jobs and
    /// reviews, a quote form, and a phone-first landing page.
    Trade { trade: String },
    /// A documentation section (ADR 0405) beside the blog: `docs.enabled`, a "Docs" link in the
    /// header and a short example tree under `content/docs/` that shows ordering and links.
    Docs,
}

/// The starters `--starter` accepts, as the help and errors list them.
pub const STARTERS: &[&str] = &["trade", "docs"];

impl Starter {
    /// The starter named on the command line, with its options checked before anything is written.
    pub fn parse(name: &str, trade: Option<&str>) -> Result<Self, String> {
        match name {
            "trade" => {
                let trade = trade.unwrap_or(TRADE_DEFAULT).trim().to_string();
                if !openblog_core::job::TRADES.contains(&trade.as_str()) {
                    return Err(format!(
                        "--trade `{trade}` is not a bundled trade; choose one of {} (you can add your own trades later under extraTrades in openblog.json)",
                        openblog_core::job::TRADES.join(", ")
                    ));
                }
                Ok(Self::Trade { trade })
            }
            "docs" if trade.is_some() => Err("--trade goes with --starter trade".into()),
            "docs" => Ok(Self::Docs),
            other => Err(format!(
                "--starter `{other}` is not a starter this version has; choose {}",
                STARTERS.join(", ")
            )),
        }
    }
}

/// The trade a trade starter states when `--trade` is not given.
pub const TRADE_DEFAULT: &str = "general-contractor";

/// Create a new project in `dir`. Existing content is never overwritten. In a
/// Git project, an existing `.gitignore` keeps its rules and gains the private
/// assistant-storage rule when that boundary is missing.
#[cfg(test)]
pub fn init(dir: &Path, title: Option<&str>, github_pages: bool) -> Result<Vec<String>, String> {
    init_with(dir, title, github_pages, None)
}

/// [`init`] with an optional [`Starter`]. Without one the project is exactly what `init` wrote
/// before starters existed.
pub fn init_with(
    dir: &Path,
    title: Option<&str>,
    github_pages: bool,
    starter: Option<&Starter>,
) -> Result<Vec<String>, String> {
    let mut created = Vec::new();
    let mut write = |rel: &str, contents: &str| -> Result<(), String> {
        let path = dir.join(rel);
        if path.exists() {
            return Ok(());
        }
        fsutil::write_file(&path, contents.as_bytes())?;
        created.push(rel.to_string());
        Ok(())
    };

    let mut config = SiteConfig::default();
    if let Some(t) = title {
        config.title = t.to_string();
    }
    match starter {
        None => write(CONFIG_FILE, &format!("{}\n", config.to_json()))?,
        Some(Starter::Trade { trade }) => {
            let config = trade_config(&config, trade)?;
            write(CONFIG_FILE, &format!("{}\n", config.to_json()))?;
            for (rel, contents) in trade_files(&config) {
                write(&rel, &contents)?;
            }
        }
        Some(Starter::Docs) => {
            let config = docs_config(&config)?;
            write(CONFIG_FILE, &format!("{}\n", config.to_json()))?;
            for (rel, contents) in docs_files(&config) {
                write(&rel, &contents)?;
            }
        }
    }
    let trade = matches!(starter, Some(Starter::Trade { .. }));

    let date = today().ymd();
    if !trade {
        let post = frontmatter::serialize(&[
            ("title", Value::Scalar("Hello, world".into())),
            ("date", Value::Scalar(date)),
            ("tags", Value::List(vec!["meta".into()])),
            (
                "description",
                Value::Scalar("The first post on a new open.blog.".into()),
            ),
        ]);
        write(
            "content/posts/hello-world.md",
            &format!("{post}\n{WELCOME}"),
        )?;
    }
    let page = frontmatter::serialize(&[
        ("title", Value::Scalar("About".into())),
        ("nav", Value::Scalar("true".into())),
    ]);
    let about = if trade { TRADE_ABOUT } else { ABOUT };
    write("content/pages/about.md", &format!("{page}\n{about}"))?;
    write("content/series/.gitkeep", "")?;
    write("static/.gitkeep", "")?;

    write("themes/base/theme.json", EMBEDDED_BASE_THEME)?;
    for (rel, contents) in site::EMBEDDED_THEMES {
        write(&format!("themes/{rel}"), contents)?;
    }
    for (rel, contents) in EMBEDDED_WEB {
        write(&format!("web/{rel}"), contents)?;
    }
    write(".gitignore", "/dist\n/.openblog\n/.openblog/private/\n")?;
    if github_pages {
        let workflow = site::PAGES_WORKFLOW.replace("OPENBLOG_VERSION", env!("CARGO_PKG_VERSION"));
        write(".github/workflows/pages.yml", &workflow)?;
    }
    if dir.join(".git").exists() {
        let ignore_path = dir.join(".gitignore");
        let mut ignored = fs::read_to_string(&ignore_path)
            .map_err(|error| format!("cannot read {}: {error}", ignore_path.display()))?;
        if !ignored
            .lines()
            .any(|line| line.trim() == "/.openblog/private/")
        {
            if !ignored.is_empty() && !ignored.ends_with('\n') {
                ignored.push('\n');
            }
            ignored.push_str("/.openblog/private/\n");
            fsutil::write_file(&ignore_path, ignored.as_bytes())?;
            if !created.iter().any(|path| path == ".gitignore") {
                created.push(".gitignore".into());
            }
        }
    }
    // Binary files (the WebAssembly search engine) go last, after the text closure is done.
    for (rel, bytes) in site::EMBEDDED_WEB_BINARY {
        let path = dir.join("web").join(rel);
        if !path.exists() {
            fsutil::write_file(&path, bytes)?;
            created.push(format!("web/{rel}"));
        }
    }
    Ok(created)
}

// ----- the docs starter (ADR 0405) ----------------------------------------

/// The plain defaults with the documentation section on and a "Docs" link in the header after
/// Home. Read back through [`SiteConfig::from_json`] like the trade starter's.
fn docs_config(base: &SiteConfig) -> Result<SiteConfig, String> {
    let mut value: serde_json::Value = serde_json::from_str(&base.to_json())
        .map_err(|error| format!("cannot read the default settings: {error}"))?;
    value["docs"] = serde_json::json!({ "enabled": true });
    if let Some(nav) = value["nav"].as_array_mut() {
        let at = usize::from(!nav.is_empty());
        nav.insert(at, serde_json::json!({ "label": "Docs", "href": "/docs/" }));
    }
    SiteConfig::from_json(&value.to_string())
}

/// The example documentation: a home, a page with an `order`, and a folder with its own index,
/// linking to each other as `.md` files so the same files read correctly on GitHub.
fn docs_files(config: &SiteConfig) -> Vec<(String, String)> {
    let content = config.paths.content.trim_end_matches('/');
    [
        (
            "docs/index.md",
            "---\ntitle: Introduction\ndescription: Everything you need to use this project.\n---\n\nWelcome. These pages are Markdown files in `content/docs/`; each file is a page at the address its path gives, so `content/docs/getting-started.md` is `/docs/getting-started/`.\n\nStart with [Getting started](getting-started.md), then read [the guides](guides/index.md).\n",
        ),
        (
            "docs/getting-started.md",
            "---\ntitle: Getting started\ndescription: Install it and take the first steps.\norder: 1\n---\n\nReplace this page with how to get started.\n\n## Install\n\nSay how to install it.\n\n## First steps\n\nWhen you are done, carry on with [the guides](guides/index.md).\n",
        ),
        (
            "docs/guides/index.md",
            "---\ntitle: Guides\ndescription: How to do the common tasks.\norder: 2\n---\n\nA folder's `index.md` heads its group in the sidebar. The pages in the folder are listed under it, by their `order` and then by title.\n\n- [Writing pages](writing-pages.md)\n",
        ),
        (
            "docs/guides/writing-pages.md",
            "---\ntitle: Writing documentation pages\nnavTitle: Writing pages\ndescription: Front matter, ordering and links in the documentation.\n---\n\n## Front matter\n\n- `title` is the page's heading.\n- `navTitle` is an optional shorter title for the sidebar.\n- `order` puts pages in a folder in order, lowest first; pages without one follow, by title.\n- `draft: true` keeps a page off the site.\n\n## Links\n\nLink to another page by its file, such as [Getting started](../getting-started.md) or [a heading on it](../getting-started.md#install). The build turns the link into the page's address and warns about a link to a file that does not exist.\n",
        ),
    ]
    .into_iter()
    .map(|(rel, contents)| (format!("{content}/{rel}"), contents.to_string()))
    .collect()
}

// ----- the trade starter (ADR 0399) ---------------------------------------

const TRADE_ABOUT: &str = "Tell visitors who you are: how long you have done this work, the towns you serve, and what a customer can expect from the first call to the finished job.

This page is `content/pages/about.md`. Edit it in Admin under Pages, or in any text editor.
";

/// The site settings a trade starter writes: the plain defaults plus the business facts it can
/// state truthfully (the name and the trade; nothing invented, so no phone or hours), the author
/// as the business with its About page, and a description that says what the site is for. The
/// result is read back through [`SiteConfig::from_json`], so the starter can never write settings
/// the build would refuse.
fn trade_config(base: &SiteConfig, trade: &str) -> Result<SiteConfig, String> {
    let mut value: serde_json::Value = serde_json::from_str(&base.to_json())
        .map_err(|error| format!("cannot read the default settings: {error}"))?;
    let name = base.title.clone();
    value["description"] = serde_json::Value::String(format!(
        "{name}: what we do, recent jobs, reviews from customers, and how to ask for a quote."
    ));
    value["author"]["name"] = serde_json::Value::String(name.clone());
    value["author"]["url"] = serde_json::Value::String("/about/".into());
    // The first look for trades (ADR 0400), so the site reads as a business from the first build.
    if let Some(look) = openblog_core::look_presets::trade_looks().next() {
        if let Some(applied) = openblog_core::look_presets::apply(
            look.id,
            &openblog_core::look::LookSettings::default(),
        ) {
            value["appearance"] = applied.to_value();
        }
    }
    value["business"] = serde_json::json!({
        "version": 1,
        "displayName": name,
        "trade": trade,
    });
    SiteConfig::from_json(&value.to_string())
        .map_err(|error| format!("the trade starter's settings were refused: {error}"))
}

/// The example services a trade starter writes, as drafts (never on the site until the owner
/// edits one and turns `draft` off): id, name, summary, price band, what is included.
const TRADE_SERVICES: [(&str, &str, &str, &str, [&str; 3]); 3] = [
    (
        "repairs",
        "Example: Repairs",
        "Fixing what is broken or worn, done properly the first time.",
        "500-2k",
        [
            "A look at the problem before we start",
            "Parts and materials",
            "Cleaning up when we finish",
        ],
    ),
    (
        "new-installations",
        "Example: New installations",
        "New work built to last, from the first measurement to the final walk-through.",
        "2k-10k",
        [
            "Measuring and planning with you",
            "Materials you choose with us",
            "A walk-through when the job is done",
        ],
    ),
    (
        "inspections",
        "Example: Inspections",
        "A visit to tell you what needs doing now and what can wait.",
        "ask",
        [
            "A visit at a time that suits you",
            "Photos of what we found",
            "A plain answer on what to do next",
        ],
    ),
];

/// The files a trade starter adds besides the settings: three example services as drafts, the
/// empty reviews collection, and a phone-first landing page that lists services, recent jobs and
/// reviews and places the quote form (ADR 0398). The jobs archive needs no file: it appears with
/// the first published job.
fn trade_files(config: &SiteConfig) -> Vec<(String, String)> {
    let content = config.paths.content.trim_end_matches('/');
    let mut files = Vec::new();
    for (id, name, summary, band, includes) in TRADE_SERVICES {
        let fields = frontmatter::serialize(&[
            ("version", Value::Scalar("1".into())),
            ("id", Value::Scalar(id.into())),
            ("name", Value::Scalar(name.into())),
            ("summary", Value::Scalar(summary.into())),
            (
                "includes",
                Value::List(includes.iter().map(|item| item.to_string()).collect()),
            ),
            ("priceBand", Value::Scalar(band.into())),
            ("draft", Value::Scalar("true".into())),
        ]);
        files.push((
            format!("{content}/services/{id}.md"),
            format!(
                "{fields}\nThis is an example service, kept as a draft so it is not on your site. Change the name, the summary and what is included to describe your own work, then turn off **Keep this as a draft** in Admin under Services (or remove the `draft` line).\n"
            ),
        ));
    }
    files.push((format!("{content}/posts/.gitkeep"), String::new()));
    files.push((format!("{content}/proof/.gitkeep"), String::new()));
    let landing = serde_json::json!({
        "format": openblog_core::landing::LANDING_FORMAT,
        "version": openblog_core::landing::LANDING_VERSION_TRADE,
        "sections": [
            {
                "id": "welcome",
                "type": "welcome",
                "heading": config.title,
                "subheading": "Say in one sentence what you do and where. Change this text in Admin under Landing."
            },
            {"id": "contact", "type": "business-facts", "heading": "Call or visit"},
            {"id": "services", "type": "services", "heading": "What we do"},
            {"id": "recent-jobs", "type": "recent-jobs", "heading": "Recent jobs", "count": 3},
            {"id": "reviews", "type": "reviews", "heading": "What customers say", "count": 3},
            {"id": "quote", "type": "quote-form", "heading": "Ask for a quote"}
        ]
    });
    let page = openblog_core::landing::LandingPage::parse(&landing.to_string())
        .expect("the trade starter's landing page is valid");
    files.push((
        format!("{content}/{}", openblog_core::landing::LANDING_FILE),
        page.to_canonical_json(),
    ));
    files
}

/// Create `content/posts/<date>-<slug>.md` and return its path. With `recipe`,
/// the post starts from a recipe template (servings, times, ingredients, steps).
pub fn new_post(
    root: &Path,
    title: &str,
    series: Option<&str>,
    tags: &[String],
    draft: bool,
    recipe: bool,
) -> Result<String, String> {
    let profile = recipe.then_some(openblog_core::profile::RECIPE_ID);
    new_profile_post(root, title, series, tags, draft, profile)
}

pub fn new_decision(
    root: &Path,
    title: &str,
    series: Option<&str>,
    tags: &[String],
) -> Result<String, String> {
    new_profile_post(
        root,
        title,
        series,
        tags,
        true,
        Some(openblog_core::profile::DECISION_ID),
    )
}

fn new_profile_post(
    root: &Path,
    title: &str,
    series: Option<&str>,
    tags: &[String],
    draft: bool,
    profile: Option<&str>,
) -> Result<String, String> {
    let config = site::load_config(root)?;
    let slug = slugify(title);
    if slug.is_empty() {
        return Err("the title needs at least one letter or digit".into());
    }
    let date = today().ymd();
    let rel = format!("{}/posts/{date}-{slug}.md", config.paths.content);
    let path = root.join(&rel);
    if path.exists() {
        return Err(format!("{rel} already exists"));
    }
    let mut fields: Vec<(&str, Value)> = vec![
        ("title", Value::Scalar(title.to_string())),
        ("date", Value::Scalar(date)),
    ];
    if let Some(s) = series {
        fields.push(("series", Value::Scalar(slugify(s))));
    }
    if !tags.is_empty() {
        fields.push(("tags", Value::List(tags.to_vec())));
    }
    fields.push(("description", Value::Scalar(String::new())));
    if profile == Some(openblog_core::profile::RECIPE_ID) {
        for (key, value) in [
            ("profile", "recipe"),
            ("servings", "4"),
            ("prep", "15 min"),
            ("cook", "25 min"),
        ] {
            fields.push((key, Value::Scalar(value.into())));
        }
    } else if profile == Some(openblog_core::profile::DECISION_ID) {
        fields.push(("profile", Value::Scalar("decision".into())));
        fields.push(("decisionStatus", Value::Scalar("proposed".into())));
    }
    if draft {
        fields.push(("draft", Value::Scalar("true".into())));
    }
    let mut text = frontmatter::serialize(&fields);
    match openblog_core::profile::catalog()
        .iter()
        .find(|candidate| Some(candidate.id) == profile)
        .and_then(|profile| profile.starter)
    {
        Some(starter) => {
            text.push('\n');
            text.push_str(starter);
        }
        None => text.push_str("\nWrite your post here.\n"),
    }
    fs::create_dir_all(path.parent().unwrap_or(root)).map_err(|e| e.to_string())?;
    fsutil::write_file(&path, text.as_bytes())?;
    Ok(rel)
}

/// The answers `openblog new --profile job` can take. Every one is optional: a
/// job starts as a draft and the build says what is still missing.
#[derive(Default)]
pub struct JobStart<'a> {
    pub trade: Option<&'a str>,
    pub service: Option<&'a str>,
    pub town: Option<&'a str>,
    pub region: Option<&'a str>,
}

/// Create a draft job post (ADR 0287): the same `job` front matter and the same
/// four headings Admin's Job mode writes, checked by the job profile in core.
pub fn new_job(
    root: &Path,
    title: &str,
    series: Option<&str>,
    tags: &[String],
    start: &JobStart,
) -> Result<String, String> {
    use openblog_core::job;
    let config = site::load_config(root)?;
    fn clean(value: Option<&str>) -> Option<&str> {
        value.map(str::trim).filter(|value| !value.is_empty())
    }
    let trade = match clean(start.trade) {
        Some(trade) => job::normalize_trade(trade, &config.extra_trades)?,
        None => String::new(),
    };
    let service = match clean(start.service) {
        Some(service) => job::normalize_service(service)?,
        None => String::new(),
    };
    let town = match clean(start.town) {
        Some(town) => job::normalize_place(town, "job.place.town")?,
        None => String::new(),
    };
    let region = match clean(start.region) {
        Some(region) => job::normalize_place(region, "job.place.region")?,
        None => String::new(),
    };
    let slug = slugify(title);
    if slug.is_empty() {
        return Err("the title needs at least one letter or digit".into());
    }
    let date = today().ymd();
    let rel = format!("{}/posts/{date}-{slug}.md", config.paths.content);
    let path = root.join(&rel);
    if path.exists() {
        return Err(format!("{rel} already exists"));
    }
    let mut fields: Vec<(&str, Value)> = vec![
        ("title", Value::Scalar(title.to_string())),
        ("date", Value::Scalar(date.clone())),
    ];
    if let Some(s) = series {
        fields.push(("series", Value::Scalar(slugify(s))));
    }
    if !tags.is_empty() {
        fields.push(("tags", Value::List(tags.to_vec())));
    }
    fields.push(("description", Value::Scalar(String::new())));
    fields.push((
        "profile",
        Value::Scalar(openblog_core::profile::JOB_ID.into()),
    ));
    fields.push(("draft", Value::Scalar("true".into())));
    for (key, value) in [
        ("job.trade", trade),
        ("job.service", service),
        ("job.place.town", town),
        ("job.place.region", region),
        ("job.started", date.clone()),
        ("job.finished", date),
    ] {
        fields.push((key, Value::Scalar(value)));
    }
    let mut text = frontmatter::serialize(&fields);
    text.push('\n');
    text.push_str(&job::scaffold_body());
    fs::create_dir_all(path.parent().unwrap_or(root)).map_err(|e| e.to_string())?;
    fsutil::write_file(&path, text.as_bytes())?;
    Ok(rel)
}

/// The answers `openblog new --profile service` can take.
#[derive(Default)]
pub struct ServiceStart<'a> {
    pub id: Option<&'a str>,
    pub price_band: Option<&'a str>,
}

/// Create a draft service, `content/services/<id>.md` (ADR 0313): version 1
/// front matter with the required keys left for the owner to fill in, checked
/// by the same rules the build uses. A draft never stops a build; `openblog
/// check` lists what is still missing.
pub fn new_service(root: &Path, name: &str, start: &ServiceStart) -> Result<String, String> {
    use openblog_core::{job::CostBand, service};
    let config = site::load_config(root)?;
    let name = name.trim();
    if name.is_empty()
        || name.chars().any(char::is_control)
        || name.chars().count() > service::MAX_NAME
    {
        return Err(format!(
            "the name needs 1 to {} characters of plain text",
            service::MAX_NAME
        ));
    }
    let id = match start.id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => id.to_string(),
        None => slugify(name),
    };
    service::check_id(&id)?;
    let band = match start
        .price_band
        .map(str::trim)
        .filter(|band| !band.is_empty())
    {
        Some(band) => Some(CostBand::parse(band).ok_or_else(|| {
            format!(
                "priceBand: `{band}` is not a price band; use one of {}",
                CostBand::ALL.map(CostBand::as_str).join(", ")
            )
        })?),
        None => None,
    };
    let rel = format!("{}/{}/{id}.md", config.paths.content, service::SERVICES_DIR);
    let path = root.join(&rel);
    if path.exists() {
        return Err(format!("{rel} already exists"));
    }
    let mut fields: Vec<(&str, Value)> = vec![
        (
            "version",
            Value::Scalar(service::SERVICE_VERSION.to_string()),
        ),
        ("id", Value::Scalar(id)),
        ("name", Value::Scalar(name.to_string())),
        ("summary", Value::Scalar(String::new())),
    ];
    if let Some(band) = band {
        fields.push(("priceBand", Value::Scalar(band.as_str().into())));
    }
    fields.push(("draft", Value::Scalar("true".into())));
    let mut text = frontmatter::serialize(&fields);
    text.push_str("\nDescribe the service here. This text appears on its page.\n");
    fs::create_dir_all(path.parent().unwrap_or(root)).map_err(|e| e.to_string())?;
    fsutil::write_file(&path, text.as_bytes())?;
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ob-starter-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn trade(trade: &str) -> Starter {
        Starter::parse("trade", Some(trade)).unwrap()
    }

    #[test]
    fn decision_starts_as_a_draft_with_sections_and_diagram_slots() {
        let dir = fresh("decision");
        init(&dir, None, false).unwrap();
        let path = new_decision(&dir, "Choose storage", None, &[]).unwrap();
        let source = fs::read_to_string(dir.join(&path)).unwrap();
        let document = frontmatter::parse(&source).unwrap();
        assert_eq!(document.front_matter.get("profile"), Some("decision"));
        assert_eq!(
            document.front_matter.get("decisionStatus"),
            Some("proposed")
        );
        assert_eq!(document.front_matter.get_bool("draft"), Some(true));
        for heading in [
            "## Context",
            "## Options considered",
            "## Decision",
            "## Consequences",
            "### Before",
            "### After",
        ] {
            assert!(document.body.contains(heading));
        }
        assert!(openblog_core::decision::parse(&document.front_matter, &document.body).is_err());
        assert!(new_decision(&dir, "Choose storage", None, &[]).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_trade_starter_builds_with_no_warnings_and_a_clean_home_page() {
        let dir = fresh("trade");
        init_with(
            &dir,
            Some("Maple Falls Flooring"),
            false,
            Some(&trade("flooring")),
        )
        .unwrap();
        let (mut site, themes) = crate::site::load_site(&dir, false, None).unwrap();
        // No accessibility, SEO or content warnings with no edits.
        assert!(site.warnings.is_empty(), "{:?}", site.warnings);
        assert_eq!(site.config.business.display_name, "Maple Falls Flooring");
        assert_eq!(site.config.business.trade, "flooring");
        assert!(site.config.business.phone.is_empty(), "no invented phone");
        assert!(site.posts.is_empty(), "no hello-world post on a trade site");
        assert_eq!(site.config.appearance.palette.as_deref(), Some("workshop"));
        assert!(site.services.is_empty(), "the example services are drafts");
        assert!(site.proof.is_empty());
        let landing = site.landing.as_ref().expect("a landing page");
        let kinds: Vec<&str> = landing.sections.iter().map(|s| s.kind.name()).collect();
        assert_eq!(
            kinds,
            [
                "welcome",
                "business-facts",
                "services",
                "recent-jobs",
                "reviews",
                "quote-form"
            ]
        );
        let files = crate::site::generate_site(&dir, &mut site, &themes).unwrap();
        let home = &files
            .iter()
            .find(|file| file.path == "index.html")
            .unwrap()
            .contents;
        assert_eq!(home.matches("<h1").count(), 1);
        assert!(home.contains("Maple Falls Flooring"));
        // Nothing invented reaches the site: no example service, no empty headings.
        for file in &files {
            assert!(!file.contents.contains("Example: "), "{}", file.path);
        }
        for absent in [
            "What we do",
            "Recent jobs",
            "What customers say",
            "ob-quote",
        ] {
            assert!(!home.contains(absent), "{absent}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_example_services_are_valid_drafts_that_build_once_published() {
        let dir = fresh("drafts");
        init_with(&dir, Some("Crew"), false, Some(&trade("roofing"))).unwrap();
        let (site, _) = crate::site::load_site(&dir, true, None).unwrap();
        let ids: Vec<&str> = site.services.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids.len(), 3, "{ids:?}");
        for id in ["repairs", "new-installations", "inspections"] {
            assert!(ids.contains(&id), "{id}");
        }
        // Turning one draft off publishes it with no other edit.
        let path = dir.join("content/services/repairs.md");
        let text: String = fs::read_to_string(&path)
            .unwrap()
            .lines()
            .filter(|line| !line.starts_with("draft:"))
            .map(|line| format!("{line}\n"))
            .collect();
        fs::write(&path, text).unwrap();
        let (site, _) = crate::site::load_site(&dir, false, None).unwrap();
        assert_eq!(site.services.len(), 1);
        assert!(site.warnings.is_empty(), "{:?}", site.warnings);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_starter_never_overwrites_and_a_plain_init_is_unchanged() {
        let dir = fresh("keep");
        fs::create_dir_all(dir.join("content")).unwrap();
        fs::write(dir.join("content/landing.json"), "mine").unwrap();
        init_with(&dir, Some("Crew"), false, Some(&trade("plumbing"))).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("content/landing.json")).unwrap(),
            "mine"
        );
        let plain = fresh("plain");
        let created = init(&plain, Some("Crew"), false).unwrap();
        assert!(created.iter().any(|f| f == "content/posts/hello-world.md"));
        assert!(!created
            .iter()
            .any(|f| f.contains("services") || f.contains("landing")));
        let config = fs::read_to_string(plain.join(CONFIG_FILE)).unwrap();
        assert!(!config.contains("\"business\""));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&plain);
    }

    #[test]
    fn a_docs_starter_builds_a_linked_documentation_section_with_no_warnings() {
        let dir = fresh("docs");
        init_with(&dir, Some("Widget"), false, Some(&Starter::Docs)).unwrap();
        let (mut site, themes) = crate::site::load_site(&dir, false, None).unwrap();
        // The plain project's own reminders (author, the welcome post) are left to the author;
        // nothing about the documentation is.
        let about_docs: Vec<&String> = site
            .warnings
            .iter()
            .filter(|warning| warning.contains("docs"))
            .collect();
        assert!(about_docs.is_empty(), "{about_docs:?}");
        assert!(site.config.docs.enabled);
        assert!(site.config.nav.iter().any(|link| link.href == "/docs/"));
        assert_eq!(site.posts.len(), 1, "the blog's hello-world post stays");
        let files = crate::site::generate_site(&dir, &mut site, &themes).unwrap();
        let page = |path: &str| {
            &files
                .iter()
                .find(|file| file.path == path)
                .unwrap_or_else(|| panic!("missing {path}"))
                .contents
        };
        assert!(page("docs/index.html").contains("href=\"/docs/getting-started/\""));
        let writing = page("docs/guides/writing-pages/index.html");
        assert!(writing.contains("href=\"/docs/getting-started/#install\""));
        assert!(writing.contains("aria-current=\"page\">Writing pages</a>"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unknown_starter_or_trade_is_refused_before_anything_is_written() {
        assert!(Starter::parse("bakery", None)
            .unwrap_err()
            .contains("choose trade, docs"));
        assert_eq!(Starter::parse("docs", None).unwrap(), Starter::Docs);
        assert!(Starter::parse("docs", Some("flooring")).is_err());
        let error = Starter::parse("trade", Some("fencing")).unwrap_err();
        assert!(error.contains("not a bundled trade") && error.contains("extraTrades"));
        assert_eq!(
            Starter::parse("trade", None).unwrap(),
            Starter::Trade {
                trade: TRADE_DEFAULT.into()
            }
        );
    }

    #[test]
    fn init_adds_private_assistant_storage_to_an_existing_gitignore() {
        let dir =
            std::env::temp_dir().join(format!("ob-init-private-ignore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join(".gitignore"), "/dist\n/custom-cache\n").unwrap();

        init(&dir, Some("Private Context"), false).unwrap();

        let ignored = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(ignored.contains("/custom-cache"));
        assert!(ignored.lines().any(|line| line == "/.openblog/private/"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn init_ignores_the_private_voice_paths_in_a_git_project() {
        let dir = std::env::temp_dir().join(format!("ob-init-voice-ignore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let git = crate::git::Git::new(&dir);
        git.init().unwrap();

        init(&dir, Some("Voice"), false).unwrap();

        // The private context folder (which holds voice samples) and the session record are both
        // under the ignored `/.openblog/private/`, while portable samples are not ignored.
        for private in [
            ".openblog/private/context/voice/2026-10-28-a-mistake-i-made-rough.md",
            ".openblog/private/voice/session.json",
        ] {
            assert!(
                git.run(&["check-ignore", "-q", "--no-index", private])
                    .is_ok(),
                "{private} should be ignored"
            );
        }
        assert!(git
            .run(&[
                "check-ignore",
                "-q",
                "--no-index",
                "assistant/context/voice/2026-10-28-a-mistake-i-made-rough.md"
            ])
            .is_err());
        // Creating a voice folder is not init's job.
        assert!(!dir.join("assistant").exists());
        assert!(!dir.join(".openblog/private").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn init_leaves_an_existing_gitignore_alone_in_a_project_without_git() {
        let dir =
            std::env::temp_dir().join(format!("ob-init-no-git-ignore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(".gitignore"),
            "/dist
/custom-cache",
        )
        .unwrap();

        let created = init(&dir, Some("No Git"), false).unwrap();

        assert_eq!(
            fs::read_to_string(dir.join(".gitignore")).unwrap(),
            "/dist
/custom-cache"
        );
        assert!(!created.iter().any(|path| path == ".gitignore"));
        let _ = fs::remove_dir_all(&dir);

        // A fresh project without Git gets the standard file, which already lists the private folder.
        let fresh =
            std::env::temp_dir().join(format!("ob-init-fresh-ignore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&fresh);
        init(&fresh, Some("Fresh"), false).unwrap();
        assert_eq!(
            fs::read_to_string(fresh.join(".gitignore")).unwrap(),
            "/dist
/.openblog
/.openblog/private/
"
        );
        let _ = fs::remove_dir_all(&fresh);
    }

    #[test]
    fn init_creates_a_buildable_project_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("ob-init-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let created = init(&dir, Some("My Blog"), true).unwrap();
        assert!(created.iter().any(|c| c == "openblog.json"));
        fs::write(
            dir.join("content/posts/hello-world.md"),
            "---\ntitle: Mine\ndate: 2026-01-01\n---\nkeep",
        )
        .unwrap();
        assert!(init(&dir, Some("Other"), false).unwrap().is_empty());
        assert!(
            dir.join("web/wasm/openblog_wasm_bg.wasm").exists(),
            "search works without a workspace"
        );
        assert!(
            dir.join("themes/demo/reveal.js").exists()
                && dir.join("themes/paper/theme.json").exists()
        );
        let workflow = fs::read_to_string(dir.join(".github/workflows/pages.yml")).unwrap();
        assert!(workflow.contains("openblog build") && !workflow.contains("OPENBLOG_VERSION"));
        assert!(fs::read_to_string(dir.join("content/posts/hello-world.md"))
            .unwrap()
            .contains("keep"));

        let report = site::build(
            &dir,
            &site::BuildOptions {
                include_drafts: false,
                out_override: None,
                now: None,
            },
        )
        .unwrap();
        assert_eq!(report.posts, 1);
        assert!(dir.join("dist/index.html").exists());
        assert!(dir.join("dist/rss.xml").exists());
        assert!(dir.join("dist/assets/base.css").exists());
        assert!(dir
            .join("dist/assets/orcid-unauthenticated-id-icons.png")
            .exists());
        assert!(dir.join("dist/assets/components/ob-quiz.js").exists());
        assert!(
            dir.join("dist/assets/components/ob-rust-playground.js")
                .exists()
                && dir
                    .join("dist/assets/components/ob-rust-runner.js")
                    .exists()
        );
        assert!(dir.join("dist/themes/base/tokens.css").exists());
        assert!(dir.join("dist/assets/wasm/openblog_wasm_bg.wasm").exists());
        fs::write(dir.join("content/posts/_notes.md"), "not a post").unwrap();
        fs::create_dir_all(dir.join("content/posts/_ideas")).unwrap();
        fs::write(dir.join("content/posts/_ideas/x.md"), "not a post either").unwrap();

        let rel = new_post(
            &dir,
            "A New Post!",
            Some("My Series"),
            &["rust".into()],
            true,
            false,
        )
        .unwrap();
        assert!(rel.ends_with("-a-new-post.md"));
        assert!(new_post(&dir, "A New Post!", None, &[], false, false).is_err());
        let recipe = new_post(&dir, "Lemon Pasta", None, &[], true, true).unwrap();
        let text = fs::read_to_string(dir.join(&recipe)).unwrap();
        let doc = openblog_core::frontmatter::parse(&text).unwrap();
        assert_eq!(doc.front_matter.get("profile"), Some("recipe"));
        assert_eq!(doc.front_matter.get("recipe"), None);
        assert!(openblog_core::recipe::is_recipe(&doc.front_matter));
        assert!(text.contains("## Ingredients") && text.contains("## Steps"));
        let drafts = site::build(
            &dir,
            &site::BuildOptions {
                include_drafts: true,
                out_override: None,
                now: None,
            },
        )
        .unwrap();
        assert_eq!(drafts.posts, 3, "hello world, the new post and the recipe");
        let _ = fs::remove_dir_all(&dir);
    }
}

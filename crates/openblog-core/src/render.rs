//! HTML page generation. Pages are semantic HTML (`header`, `nav`, `main`,
//! `article`, `time`, `details`, ...) enhanced by a few autonomous custom
//! elements (`<ob-theme-toggle>`, `<ob-typewriter>`, `<ob-search>`,
//! `<ob-code>`, `<ob-back-to-top>`). Every page works without JavaScript.
//!
//! Appearance comes entirely from CSS custom properties (`--ob-*`) written by
//! the theme, so the same markup can look like any theme.

use std::collections::{HashMap, HashSet};

use crate::escape::{attr, cdata, text};
use crate::feeds;
use crate::markdown::{self, RenderOptions};
use crate::model::{Post, Series, Site};
use crate::theme::{Theme, ThemeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputFile {
    /// Path relative to the output directory, always with forward slashes.
    pub path: String,
    pub contents: String,
}

/// Paths reserved by the generator. Pages and posts may not use them.
const RESERVED: &[&str] = &[
    "series", "tags", "archive", "search", "page", "themes", "assets", "api",
];

struct Meta<'a> {
    title: String,
    description: String,
    path: String,
    canonical: Option<String>,
    kind: &'static str,
    image: Option<String>,
    json_ld: Option<String>,
    theme: &'a Theme,
    published: Option<String>,
    modified: Option<String>,
    tags: Vec<String>,
    noindex: bool,
}

struct Renderer<'a> {
    site: &'a Site,
    themes: &'a HashMap<String, Theme>,
}

struct Output {
    files: Vec<OutputFile>,
    seen: HashSet<String>,
}

impl Output {
    fn add(&mut self, path: String, contents: String) -> Result<(), String> {
        if !self.seen.insert(path.clone()) {
            return Err(format!(
                "two pieces of content would both be written to `{path}`; rename a slug or page"
            ));
        }
        self.files.push(OutputFile { path, contents });
        Ok(())
    }
}

fn url_to_file(url: &str) -> String {
    let trimmed = url.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else if trimmed.ends_with('/') {
        format!("{trimmed}index.html")
    } else if trimmed.ends_with(".html") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/index.html")
    }
}

/// Render the whole site to files. `themes` supplies every registered theme;
/// the ones the site uses must resolve, others are emitted when they do.
pub fn generate(site: &Site, themes: &ThemeSet) -> Result<Vec<OutputFile>, String> {
    let mut resolved: HashMap<String, Theme> = HashMap::new();
    for name in site.used_themes() {
        resolved.insert(name.clone(), themes.resolve(&name)?);
    }
    for name in themes.names() {
        if let std::collections::hash_map::Entry::Vacant(slot) = resolved.entry(name.clone()) {
            if let Ok(theme) = themes.resolve(&name) {
                slot.insert(theme);
            }
        }
    }

    for page in &site.pages {
        if RESERVED.contains(&page.slug.as_str()) {
            return Err(format!(
                "{}: the page slug `{}` is reserved by open.blog; choose another",
                page.source, page.slug
            ));
        }
    }
    for post in &site.posts {
        let first = post
            .url
            .trim_start_matches('/')
            .split('/')
            .next()
            .unwrap_or("");
        if RESERVED.contains(&first) {
            return Err(format!(
                "{}: the post URL `{}` collides with a reserved path; adjust `postPath` or the slug",
                post.source, post.url
            ));
        }
    }

    let r = Renderer {
        site,
        themes: &resolved,
    };
    let c = &site.config;
    let mut out = Output {
        files: Vec::new(),
        seen: HashSet::new(),
    };
    let default_theme = &resolved[&c.theme];

    // Home and pagination.
    let per_page = if c.posts_per_page == 0 {
        site.posts.len().max(1)
    } else {
        c.posts_per_page
    };
    let page_count = site.posts.len().div_ceil(per_page).max(1);
    for page_number in 1..=page_count {
        let path = if page_number == 1 {
            "index.html".to_string()
        } else {
            format!("page/{page_number}/index.html")
        };
        out.add(
            path,
            r.home(default_theme, page_number, page_count, per_page),
        )?;
    }

    for (index, post) in site.posts.iter().enumerate() {
        out.add(url_to_file(&post.url), r.post(index, post))?;
        for alias in &post.aliases {
            out.add(url_to_file(alias), r.alias_page(&post.url, &post.title))?;
        }
    }

    out.add("series/index.html".into(), r.series_index(default_theme))?;
    for series in site.series.iter().filter(|s| !s.posts.is_empty()) {
        out.add(url_to_file(&series.url), r.series_page(series))?;
    }

    out.add("tags/index.html".into(), r.tags_index(default_theme))?;
    for tag in &site.tags {
        out.add(url_to_file(&tag.url), r.tag_page(default_theme, tag))?;
    }

    out.add("archive/index.html".into(), r.archive(default_theme))?;
    out.add("search/index.html".into(), r.search_page(default_theme))?;
    for page in &site.pages {
        out.add(url_to_file(&page.url), r.page(page))?;
        for alias in &page.aliases {
            out.add(url_to_file(alias), r.alias_page(&page.url, &page.title))?;
        }
    }
    // GitHub Pages skips Jekyll processing when this file exists.
    out.add(".nojekyll".into(), String::new())?;
    out.add("404.html".into(), r.not_found(default_theme))?;

    // Per-theme generated assets.
    let mut theme_names: Vec<&String> = resolved.keys().collect();
    theme_names.sort();
    for name in theme_names {
        let theme = &resolved[name];
        out.add(
            format!("themes/{name}/tokens.css"),
            c.apply_base_path(&c.cdn.apply(&theme.tokens_css())),
        )?;
        out.add(
            format!("themes/{name}/resolved.json"),
            theme.manifest_json(),
        )?;
    }

    if c.feeds.rss {
        out.add("rss.xml".into(), feeds::rss(site))?;
    }
    if c.feeds.json {
        out.add("feed.json".into(), feeds::json_feed(site))?;
    }
    if c.feeds.sitemap {
        out.add(
            "sitemap.xml".into(),
            feeds::sitemap(site, &["/search/".to_string(), "/archive/".to_string()]),
        )?;
        out.add("robots.txt".into(), feeds::robots(site))?;
    }
    if c.feeds.portfolio_snapshot {
        out.add("api/blog.json".into(), feeds::portfolio_snapshot(site, 4))?;
    }
    if c.analytics.bake_counts && !site.view_counts.is_empty() {
        // Counts as of this build, for static hosts and for scripts.
        let counts: serde_json::Map<String, serde_json::Value> = site
            .view_counts
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::Value::from(*v)))
            .collect();
        out.add(
            "api/views.json".into(),
            serde_json::Value::Object(counts).to_string(),
        )?;
    }
    out.add(
        "search.json".into(),
        c.apply_base_path(&feeds::search_index(site)),
    )?;

    Ok(out.files)
}

impl<'a> Renderer<'a> {
    fn theme(&self, name: &str) -> &'a Theme {
        &self.themes[name]
    }

    // ----- page shells ---------------------------------------------------

    fn document(&self, meta: &Meta, body: &str) -> String {
        let c = &self.site.config;
        let theme = meta.theme;
        let full_title = if meta.title.is_empty() || meta.title == c.title {
            c.title.clone()
        } else {
            format!("{} · {}", meta.title, c.title)
        };
        let canonical = meta
            .canonical
            .clone()
            .unwrap_or_else(|| c.absolute(&meta.path));
        let image = meta
            .image
            .as_deref()
            .or(if c.og_image.is_empty() {
                None
            } else {
                Some(c.og_image.as_str())
            })
            .map(|i| c.absolute(i));

        let mut h = String::with_capacity(body.len() + 4096);
        h.push_str("<!doctype html>\n");
        h.push_str(&format!(
            "<html lang=\"{}\" data-ob-theme=\"{}\">\n<head>\n<meta charset=\"utf-8\">\n",
            attr(&c.language),
            attr(&theme.name)
        ));
        h.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
        h.push_str(&format!("<title>{}</title>\n", text(&full_title)));
        if !meta.description.is_empty() {
            h.push_str(&format!(
                "<meta name=\"description\" content=\"{}\">\n",
                attr(&meta.description)
            ));
        }
        if meta.noindex {
            h.push_str("<meta name=\"robots\" content=\"noindex\">\n");
        }
        h.push_str(&format!(
            "<link rel=\"canonical\" href=\"{}\">\n",
            attr(&canonical)
        ));
        h.push_str("<meta name=\"generator\" content=\"open.blog\">\n");
        if let Some(page) = theme.colors.get("light").and_then(|m| m.get("page")) {
            h.push_str(&format!("<meta name=\"theme-color\" content=\"{}\" media=\"(prefers-color-scheme: light)\">\n", attr(page)));
        }
        if let Some(page) = theme.colors.get("dark").and_then(|m| m.get("page")) {
            h.push_str(&format!("<meta name=\"theme-color\" content=\"{}\" media=\"(prefers-color-scheme: dark)\">\n", attr(page)));
        }
        // Social cards.
        h.push_str(&format!(
            "<meta property=\"og:site_name\" content=\"{}\">\n",
            attr(&c.title)
        ));
        h.push_str(&format!(
            "<meta property=\"og:type\" content=\"{}\">\n",
            meta.kind
        ));
        h.push_str(&format!(
            "<meta property=\"og:title\" content=\"{}\">\n",
            attr(&meta.title.clone().if_empty(&c.title))
        ));
        if !meta.description.is_empty() {
            h.push_str(&format!(
                "<meta property=\"og:description\" content=\"{}\">\n",
                attr(&meta.description)
            ));
        }
        h.push_str(&format!(
            "<meta property=\"og:url\" content=\"{}\">\n",
            attr(&canonical)
        ));
        if let Some(image) = &image {
            h.push_str(&format!(
                "<meta property=\"og:image\" content=\"{}\">\n",
                attr(image)
            ));
            h.push_str("<meta name=\"twitter:card\" content=\"summary_large_image\">\n");
        } else {
            h.push_str("<meta name=\"twitter:card\" content=\"summary\">\n");
        }
        if let Some(p) = &meta.published {
            h.push_str(&format!(
                "<meta property=\"article:published_time\" content=\"{}\">\n",
                attr(p)
            ));
        }
        if let Some(m) = &meta.modified {
            h.push_str(&format!(
                "<meta property=\"article:modified_time\" content=\"{}\">\n",
                attr(m)
            ));
        }
        for tag in &meta.tags {
            h.push_str(&format!(
                "<meta property=\"article:tag\" content=\"{}\">\n",
                attr(tag)
            ));
        }
        // Feeds.
        if c.feeds.rss {
            h.push_str(&format!("<link rel=\"alternate\" type=\"application/rss+xml\" title=\"{}\" href=\"/rss.xml\">\n", attr(&c.title)));
        }
        if c.feeds.json {
            h.push_str(&format!("<link rel=\"alternate\" type=\"application/feed+json\" title=\"{}\" href=\"/feed.json\">\n", attr(&c.title)));
        }
        if !c.favicon.is_empty() {
            h.push_str(&format!(
                "<link rel=\"icon\" href=\"{}\">\n",
                attr(&c.favicon)
            ));
        }
        // Restore a visitor's saved color scheme before first paint.
        h.push_str("<script>try{var s=localStorage.getItem(\"ob-scheme\");if(s===\"light\"||s===\"dark\")document.documentElement.dataset.theme=s}catch(e){}</script>\n");
        // Order matters: structure, then tokens, then the theme's own rules.
        h.push_str("<link rel=\"stylesheet\" href=\"/assets/base.css\">\n");
        h.push_str(&format!(
            "<link rel=\"stylesheet\" href=\"{}\">\n",
            attr(&theme.tokens_url())
        ));
        for sheet in &theme.stylesheets {
            h.push_str(&format!(
                "<link rel=\"stylesheet\" href=\"{}\">\n",
                attr(sheet)
            ));
        }
        h.push_str("<script type=\"module\" src=\"/assets/openblog.js\"></script>\n");
        for script in &theme.scripts {
            h.push_str(&format!(
                "<script type=\"module\" src=\"{}\"></script>\n",
                attr(script)
            ));
        }
        if let Some(ld) = &meta.json_ld {
            h.push_str(&format!(
                "<script type=\"application/ld+json\">{}</script>\n",
                // JSON allows these escapes, and without `<` no text from a post
                // (`</script>`, `<!--<script>`) can end or confuse the element.
                ld.replace('<', "\\u003c")
                    .replace('>', "\\u003e")
                    .replace('&', "\\u0026")
            ));
        }
        // Owner-supplied raw HTML (third-party analytics, verification tags).
        if !c.snippets.head.trim().is_empty() {
            h.push_str(c.snippets.head.trim());
            h.push('\n');
        }
        h.push_str("</head>\n<body>\n");
        h.push_str("<a class=\"ob-skip\" href=\"#main\">Skip to content</a>\n");
        h.push_str(&self.site_header(theme, &meta.path));
        h.push_str("<main id=\"main\" tabindex=\"-1\">\n");
        h.push_str(body);
        h.push_str("\n</main>\n");
        h.push_str(&self.site_footer());
        h.push_str("<ob-back-to-top></ob-back-to-top>\n");
        if !c.snippets.body_end.trim().is_empty() {
            h.push_str(c.snippets.body_end.trim());
            h.push('\n');
        }
        h.push_str("</body>\n</html>\n");
        // CDN first (it matches site-relative asset paths), then the base path for everything else.
        c.apply_base_path(&c.cdn.apply(&h))
    }

    fn site_header(&self, theme: &Theme, current: &str) -> String {
        let c = &self.site.config;
        let mut links: Vec<(String, String)> = c
            .nav
            .iter()
            .map(|l| (l.label.clone(), l.href.clone()))
            .collect();
        for page in self.site.pages.iter().filter(|p| p.nav) {
            links.push((page.title.clone(), page.url.clone()));
        }
        let mut h = String::new();
        h.push_str("<header class=\"ob-header\">\n<div class=\"ob-header-inner\">\n");
        let brand_inner = if c.logo.is_empty() {
            format!("<span class=\"ob-brand-name\">{}</span>", text(&c.title))
        } else {
            format!(
                "<img class=\"ob-brand-logo\" src=\"{}\" alt=\"\" width=\"54\" height=\"40\"><span class=\"ob-brand-name\">{}</span>",
                attr(&c.logo),
                text(&c.title)
            )
        };
        h.push_str(&format!(
            "<a class=\"ob-brand\" href=\"/\" aria-label=\"{} home\">{}</a>\n",
            attr(&c.title),
            brand_inner
        ));
        h.push_str("<nav class=\"ob-nav\" aria-label=\"Main navigation\">\n<ul>\n");
        for (i, (label, href)) in links.iter().enumerate() {
            let visible = match &theme.nav_label {
                Some(template) => template
                    .replace("{index}", &format!("{:02}", i + 1))
                    .replace("{label}", label),
                None => label.clone(),
            };
            let current_attr = if href == current {
                " aria-current=\"page\""
            } else {
                ""
            };
            h.push_str(&format!(
                "<li><a class=\"ob-nav-link\" href=\"{}\" aria-label=\"{}\"{}>{}</a></li>\n",
                attr(href),
                attr(label),
                current_attr,
                text(&visible)
            ));
        }
        h.push_str("</ul>\n</nav>\n");
        h.push_str("<ob-theme-toggle hidden><button type=\"button\" class=\"ob-icon-button\" aria-label=\"Toggle light and dark mode\"><span aria-hidden=\"true\">◐</span></button></ob-theme-toggle>\n");
        h.push_str("</div>\n</header>\n");
        h
    }

    fn site_footer(&self) -> String {
        let c = &self.site.config;
        let year = self.site.latest_update().map(|d| d.year()).unwrap_or(2026);
        let mut h = String::from("<footer class=\"ob-footer\">\n<div class=\"ob-footer-inner\">\n");
        h.push_str(&format!("<p>{}</p>\n", text(&c.footer_text(year))));
        let mut links: Vec<(String, String)> = c
            .social
            .iter()
            .map(|l| (l.label.clone(), l.href.clone()))
            .collect();
        if c.feeds.rss {
            links.push(("RSS".into(), "/rss.xml".into()));
        }
        if !links.is_empty() {
            h.push_str("<nav aria-label=\"Elsewhere\"><ul class=\"ob-footer-links\">\n");
            for (label, href) in links {
                let external = href.starts_with("http");
                let rel = if external { " rel=\"me noopener\"" } else { "" };
                h.push_str(&format!(
                    "<li><a href=\"{}\"{}>{}</a></li>\n",
                    attr(&href),
                    rel,
                    text(&label)
                ));
            }
            h.push_str("</ul></nav>\n");
        }
        if c.powered_by {
            h.push_str("<p class=\"ob-powered\">Powered by <a href=\"https://github.com/journey-to-code-org/open.blog\" rel=\"noopener\">open.blog</a></p>\n");
        }
        h.push_str("</div>\n</footer>\n");
        h
    }

    // ----- building blocks ----------------------------------------------

    fn heading(&self, theme: &Theme, level: u8, label: &str, extra_class: &str) -> String {
        let tag = format!("h{level}");
        // The wrapper name was validated as a custom element name when the theme resolved.
        let inner = match &theme.heading_wrapper {
            Some(tag) => format!("<{tag}>{}</{tag}>", text(label)),
            None => text(label),
        };
        if theme.heading_code_labels {
            format!(
                "<div class=\"ob-heading {extra_class}\"><span class=\"ob-code-label\" aria-hidden=\"true\">&lt;{tag}&gt;</span><{tag} class=\"ob-title\">{inner}</{tag}><span class=\"ob-code-label\" aria-hidden=\"true\">&lt;/{tag}&gt;</span></div>"
            )
        } else {
            format!("<div class=\"ob-heading {extra_class}\"><{tag} class=\"ob-title\">{inner}</{tag}></div>")
        }
    }

    fn time(&self, post: &Post) -> String {
        format!(
            "<time datetime=\"{}\">{}</time>",
            post.date.rfc3339(),
            text(&post.date.short())
        )
    }

    fn post_list(&self, theme: &Theme, indices: &[usize]) -> String {
        if indices.is_empty() {
            return "<p class=\"ob-empty\">Nothing here yet.</p>".to_string();
        }
        let cards = theme.list_style == "cards";
        let mut h = format!(
            "<ul class=\"ob-list {}\">\n",
            if cards {
                "ob-list-cards"
            } else {
                "ob-list-rows"
            }
        );
        for &i in indices {
            let post = &self.site.posts[i];
            if cards {
                h.push_str("<li class=\"ob-card\"><a class=\"ob-card-link\" href=\"");
                h.push_str(&attr(&post.url));
                h.push_str("\">");
                if let Some(cover) = &post.cover {
                    h.push_str(&format!(
                        "<img class=\"ob-card-cover\" src=\"{}\" alt=\"{}\" loading=\"lazy\" decoding=\"async\">",
                        attr(cover),
                        attr(&post.cover_alt)
                    ));
                }
                h.push_str("<span class=\"ob-card-body\"><span class=\"ob-meta\">");
                h.push_str(&self.time(post));
                h.push_str(&format!(" · {} min read</span>", post.reading_minutes));
                h.push_str(&format!(
                    "<h3 class=\"ob-card-title\">{}</h3>",
                    text(&post.title)
                ));
                h.push_str(&format!(
                    "<span class=\"ob-card-summary\">{}</span>",
                    text(&post.description)
                ));
                h.push_str("</span></a></li>\n");
            } else {
                h.push_str(&format!(
                    "<li class=\"ob-row-item\"><a class=\"ob-row\" href=\"{}\"><span class=\"ob-row-body\"><h3 class=\"ob-row-title\">{}</h3><span class=\"ob-meta\">{}</span></span><span class=\"ob-row-arrow\" aria-hidden=\"true\">→</span></a></li>\n",
                    attr(&post.url),
                    text(&post.title),
                    self.time(post)
                ));
            }
        }
        h.push_str("</ul>");
        h
    }

    fn series_cards(&self, theme: &Theme) -> String {
        let mut h = String::from("<ul class=\"ob-list ob-list-cards ob-series-list\">\n");
        for s in self.site.series.iter().filter(|s| !s.posts.is_empty()) {
            let own = self.theme(self.site.theme_for_series(s));
            let _ = theme;
            h.push_str(&format!(
                "<li class=\"ob-card\" data-ob-theme=\"{}\"><a class=\"ob-card-link\" href=\"{}\">",
                attr(&own.name),
                attr(&s.url)
            ));
            if let Some(cover) = &s.cover {
                h.push_str(&format!("<img class=\"ob-card-cover\" src=\"{}\" alt=\"\" loading=\"lazy\" decoding=\"async\">", attr(cover)));
            }
            h.push_str("<span class=\"ob-card-body\">");
            h.push_str(&format!(
                "<span class=\"ob-meta\">{} {}</span>",
                s.posts.len(),
                if s.posts.len() == 1 { "part" } else { "parts" }
            ));
            h.push_str(&format!(
                "<h3 class=\"ob-card-title\">{}</h3>",
                text(&s.name)
            ));
            h.push_str(&format!(
                "<span class=\"ob-card-summary\">{}</span>",
                text(&s.description_text)
            ));
            h.push_str("</span></a></li>\n");
        }
        h.push_str("</ul>");
        h
    }

    fn pager(&self, page_number: usize, page_count: usize) -> String {
        if page_count <= 1 {
            return String::new();
        }
        let url = |n: usize| {
            if n == 1 {
                "/".to_string()
            } else {
                format!("/page/{n}/")
            }
        };
        let mut h = String::from("<nav class=\"ob-pager\" aria-label=\"Pagination\">");
        if page_number > 1 {
            h.push_str(&format!(
                "<a rel=\"prev\" href=\"{}\">← Newer</a>",
                url(page_number - 1)
            ));
        } else {
            h.push_str("<span></span>");
        }
        h.push_str(&format!(
            "<span class=\"ob-pager-status\">Page {page_number} of {page_count}</span>"
        ));
        if page_number < page_count {
            h.push_str(&format!(
                "<a rel=\"next\" href=\"{}\">Older →</a>",
                url(page_number + 1)
            ));
        } else {
            h.push_str("<span></span>");
        }
        h.push_str("</nav>");
        h
    }

    // ----- pages ---------------------------------------------------------

    fn home(
        &self,
        theme: &Theme,
        page_number: usize,
        page_count: usize,
        per_page: usize,
    ) -> String {
        let c = &self.site.config;
        let start = (page_number - 1) * per_page;
        let indices: Vec<usize> = (start..self.site.posts.len().min(start + per_page)).collect();
        let mut body = String::from("<div class=\"ob-container\">\n");
        if page_number == 1 && !c.home.intro.trim().is_empty() {
            let intro = markdown::render(
                &c.home.intro,
                RenderOptions {
                    heading_anchors: false,
                    ..Default::default()
                },
            );
            body.push_str(&format!(
                "<section class=\"ob-intro ob-prose\">{}</section>\n",
                intro.html
            ));
        }
        body.push_str("<section class=\"ob-section\" aria-labelledby=\"latest\">\n");
        body.push_str(
            &self
                .heading(theme, 2, &c.home.heading, "ob-section-heading")
                .replace(
                    "<h2 class=\"ob-title\"",
                    "<h2 id=\"latest\" class=\"ob-title\"",
                ),
        );
        body.push_str(&self.post_list(theme, &indices));
        body.push_str(&self.pager(page_number, page_count));
        body.push_str("\n</section>\n");
        if page_number == 1
            && c.home.show_series
            && self.site.series.iter().any(|s| !s.posts.is_empty())
        {
            body.push_str("<section class=\"ob-section\" aria-labelledby=\"series\">\n");
            body.push_str(
                &self
                    .heading(theme, 2, "Series", "ob-section-heading")
                    .replace(
                        "<h2 class=\"ob-title\"",
                        "<h2 id=\"series\" class=\"ob-title\"",
                    ),
            );
            body.push_str(&self.series_cards(theme));
            body.push_str("\n</section>\n");
        }
        body.push_str("</div>");
        let path = if page_number == 1 {
            "/".to_string()
        } else {
            format!("/page/{page_number}/")
        };
        let meta = Meta {
            title: if page_number == 1 {
                c.title.clone()
            } else {
                format!("Page {page_number}")
            },
            description: c.description.clone(),
            path,
            canonical: None,
            kind: "website",
            image: None,
            json_ld: Some(
                serde_json::json!({
                    "@context": "https://schema.org",
                    "@type": "Blog",
                    "name": c.title,
                    "description": c.description,
                    "url": c.absolute("/"),
                    "inLanguage": c.language,
                })
                .to_string(),
            ),
            theme,
            published: None,
            modified: None,
            tags: Vec::new(),
            noindex: false,
        };
        self.document(&meta, &body)
    }

    fn post(&self, index: usize, post: &Post) -> String {
        let c = &self.site.config;
        let theme = self.theme(self.site.theme_for_post(post));
        let series = post
            .series
            .as_deref()
            .and_then(|s| self.site.series_by_slug(s));

        let mut body = String::from("<div class=\"ob-container ob-container-reading\">\n");
        body.push_str("<article class=\"ob-post h-entry\">\n<header class=\"ob-post-header\">\n");
        if let Some(s) = series {
            body.push_str(&format!(
                "<p class=\"ob-eyebrow\"><a href=\"{}\">{}</a></p>\n",
                attr(&s.url),
                text(&s.name)
            ));
        }
        body.push_str(
            &self
                .heading(theme, 1, &post.title, "ob-post-title")
                .replace("class=\"ob-title\"", "class=\"ob-title p-name\""),
        );
        body.push_str("\n<p class=\"ob-meta\">");
        body.push_str(&format!(
            "<time class=\"dt-published\" datetime=\"{}\">{}</time>",
            post.date.rfc3339(),
            text(&post.date.long())
        ));
        if let Some(updated) = post.updated {
            if updated.ymd() != post.date.ymd() {
                body.push_str(&format!(
                    " · Updated <time class=\"dt-updated\" datetime=\"{}\">{}</time>",
                    updated.rfc3339(),
                    text(&updated.short())
                ));
            }
        }
        body.push_str(&format!(" · {} min read", post.reading_minutes));
        if c.analytics.show_views && (c.analytics.builtin || !c.analytics.endpoint.is_empty()) {
            // A live counter updates this; a baked count shows until then, or forever on a static host.
            let baked = site_views_text(self.site, &post.url);
            body.push_str(&format!(
                "<ob-views path=\"{}\" endpoint=\"{}\">{}</ob-views>",
                attr(&post.url),
                attr(c.analytics.endpoint.trim().trim_end_matches('/')),
                text(&baked)
            ));
        }
        body.push_str("</p>\n");
        if !post.tags.is_empty() {
            body.push_str("<ul class=\"ob-tags\" aria-label=\"Tags\">");
            for t in &post.tags {
                body.push_str(&format!(
                    "<li><a class=\"p-category\" href=\"/tags/{}/\">{}</a></li>",
                    attr(&t.slug),
                    text(&t.name)
                ));
            }
            body.push_str("</ul>\n");
        }
        body.push_str("</header>\n");
        if theme.post_covers {
            if let Some(cover) = &post.cover {
                body.push_str(&format!(
                    "<figure class=\"ob-cover\"><img class=\"u-photo\" src=\"{}\" alt=\"{}\" decoding=\"async\"></figure>\n",
                    attr(cover),
                    attr(&post.cover_alt)
                ));
            }
        }
        if let Some(recipe) = &post.recipe {
            body.push_str(&self.recipe_open_tag(post, recipe));
            body.push_str(&self.recipe_card(recipe));
        }
        // Table of contents.
        let toc: Vec<_> = post
            .headings
            .iter()
            .filter(|h| h.level >= 2 && h.level <= c.markdown.toc_depth)
            .collect();
        if toc.len() >= c.markdown.toc_min_headings {
            body.push_str("<nav class=\"ob-toc\" aria-label=\"Table of contents\"><details><summary>On this page</summary><ol>");
            for h in toc {
                body.push_str(&format!(
                    "<li class=\"ob-toc-l{}\"><a href=\"#{}\">{}</a></li>",
                    h.level,
                    attr(&h.id),
                    text(&h.text)
                ));
            }
            body.push_str("</ol></details></nav>\n");
        }
        body.push_str(&format!(
            "<ob-code{}><div class=\"ob-prose e-content\">{}</div></ob-code>\n",
            self.code_attr(theme, Some(post)),
            post.html
        ));
        if post.recipe.is_some() {
            body.push_str("</ob-recipe>\n");
        }

        if let Some(source_url) = &post.source_url {
            body.push_str(&format!(
                "<p class=\"ob-source\">Originally published at <a class=\"u-syndication\" href=\"{}\" rel=\"noopener\">{}</a>.</p>\n",
                attr(source_url),
                text(source_url.trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/'))
            ));
        }
        if c.share.enabled {
            body.push_str(&self.share_block(post));
        }
        if let Some(s) = series {
            body.push_str(&self.series_box(index, post, s));
        }
        let related = self.site.related(index, c.related_posts);
        if !related.is_empty() {
            body.push_str("<section class=\"ob-related\" aria-labelledby=\"related\">\n<h2 id=\"related\" class=\"ob-related-title\">Related posts</h2>\n");
            body.push_str(&self.post_list(theme, &related));
            body.push_str("\n</section>\n");
        }
        body.push_str(&self.chronological_nav(index));
        if !c.snippets.post_footer.trim().is_empty() {
            body.push_str("<div class=\"ob-post-extra\">\n");
            body.push_str(c.snippets.post_footer.trim());
            body.push_str("\n</div>\n");
        }
        body.push_str("</article>\n</div>");

        let canonical = post.canonical.clone();
        let meta = Meta {
            title: post.title.clone(),
            description: post.description.clone(),
            path: post.url.clone(),
            canonical,
            kind: "article",
            image: post.cover.clone(),
            json_ld: Some({
                let posting = serde_json::json!({
                    "@context": "https://schema.org",
                    "@type": "BlogPosting",
                    "headline": post.title,
                    "description": post.description,
                    "datePublished": post.date.rfc3339(),
                    "dateModified": post.updated.unwrap_or(post.date).rfc3339(),
                    "mainEntityOfPage": c.absolute(&post.url),
                    "url": c.absolute(&post.url),
                    "image": post.cover.as_ref().map(|i| c.absolute(i)),
                    "keywords": post.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>().join(", "),
                    "wordCount": post.word_count,
                    "author": { "@type": "Person", "name": c.author.name, "url": c.author.url },
                    "isPartOf": series.map(|s| serde_json::json!({ "@type": "CreativeWorkSeries", "name": s.name, "url": c.absolute(&s.url) })),
                });
                match &post.recipe {
                    // A recipe page describes both the article and the recipe.
                    Some(recipe) => {
                        let mut posting = posting;
                        if let Some(o) = posting.as_object_mut() {
                            o.remove("@context");
                        }
                        serde_json::json!({
                            "@context": "https://schema.org",
                            "@graph": [posting, self.recipe_json_ld(post, recipe)],
                        })
                        .to_string()
                    }
                    None => posting.to_string(),
                }
            }),
            theme,
            published: Some(post.date.rfc3339()),
            modified: post.updated.map(|u| u.rfc3339()),
            tags: post.tags.iter().map(|t| t.name.clone()).collect(),
            noindex: false,
        };
        self.document(&meta, &body)
    }

    /// Share links. Plain anchors, so they work without JavaScript; the
    /// `<ob-share>` element adds the native share sheet and a copy button.
    fn share_block(&self, post: &Post) -> String {
        let c = &self.site.config;
        let url = c.absolute(&post.url);
        let u = crate::escape::url_component(&url);
        let t = crate::escape::url_component(&post.title);
        let mut links: Vec<(&str, String, bool)> = Vec::new();
        for network in &c.share.networks {
            let (label, href, external) = match network.trim().to_ascii_lowercase().as_str() {
                "x" | "twitter" => (
                    "X",
                    format!("https://twitter.com/intent/tweet?text={t}&url={u}"),
                    true,
                ),
                "bluesky" => (
                    "Bluesky",
                    format!("https://bsky.app/intent/compose?text={t}%20{u}"),
                    true,
                ),
                "mastodon" => (
                    "Mastodon",
                    format!("https://mastodonshare.com/?text={t}&url={u}"),
                    true,
                ),
                "linkedin" => (
                    "LinkedIn",
                    format!("https://www.linkedin.com/sharing/share-offsite/?url={u}"),
                    true,
                ),
                "facebook" => (
                    "Facebook",
                    format!("https://www.facebook.com/sharer/sharer.php?u={u}"),
                    true,
                ),
                "reddit" => (
                    "Reddit",
                    format!("https://www.reddit.com/submit?url={u}&title={t}"),
                    true,
                ),
                "hackernews" | "hn" => (
                    "Hacker News",
                    format!("https://news.ycombinator.com/submitlink?u={u}&t={t}"),
                    true,
                ),
                "email" => ("Email", format!("mailto:?subject={t}&body={u}"), false),
                _ => continue,
            };
            links.push((label, href, external));
        }
        let mut h = format!(
            "<ob-share url=\"{}\" title=\"{}\">\n<nav class=\"ob-share\" aria-label=\"Share this post\">\n<span class=\"ob-share-label\">Share</span>\n<ul>\n",
            attr(&url),
            attr(&post.title)
        );
        for (label, href, external) in links {
            let extra = if external {
                " target=\"_blank\" rel=\"noopener noreferrer\""
            } else {
                ""
            };
            h.push_str(&format!(
                "<li><a href=\"{}\"{extra}>{}</a></li>\n",
                attr(&href),
                text(label)
            ));
        }
        h.push_str("</ul>\n</nav>\n</ob-share>\n");
        h
    }

    /// A tiny page at an old address that sends readers (and search engines,
    /// via the canonical link) to the post's current address.
    fn alias_page(&self, target: &str, title: &str) -> String {
        let c = &self.site.config;
        let absolute = c.absolute(target);
        let html = format!(
            "<!doctype html>\n<html lang=\"{lang}\">\n<head>\n<meta charset=\"utf-8\">\n<title>{title}</title>\n<meta name=\"robots\" content=\"noindex\">\n<link rel=\"canonical\" href=\"{abs}\">\n<meta http-equiv=\"refresh\" content=\"0; url={target}\">\n</head>\n<body>\n<p>This page has moved to <a href=\"{target}\">{abs}</a>.</p>\n</body>\n</html>\n",
            lang = attr(&c.language),
            title = text(title),
            abs = attr(&absolute),
            target = attr(target),
        );
        c.apply_base_path(&html)
    }

    /// Attributes for `<ob-code>`: what the component does to code blocks.
    /// A post's front matter beats the site's `code` settings, which beat the
    /// theme. (A fence's own options are read by the component itself.)
    fn code_attr(&self, theme: &Theme, post: Option<&Post>) -> String {
        let code = &self.site.config.code;
        let highlight = post
            .and_then(|p| p.code_highlight)
            .or(code.highlight)
            .unwrap_or(theme.code_highlighting);
        let line_numbers = post
            .and_then(|p| p.code_line_numbers)
            .or(code.line_numbers)
            .unwrap_or(theme.code_line_numbers);
        let mut attrs = String::new();
        if highlight {
            attrs.push_str(" highlight");
        }
        if line_numbers {
            attrs.push_str(" line-numbers");
        }
        if !code.copy_button {
            attrs.push_str(" no-copy");
        }
        attrs
    }

    /// The summary card at the top of a recipe: times, servings, and the
    /// "Jump to recipe" link. `<ob-recipe>` adds the interactive controls.
    fn recipe_card(&self, recipe: &crate::recipe::Recipe) -> String {
        use crate::recipe::{format_minutes, iso_duration};
        let rc = &self.site.config.recipes;
        let mut facts = String::new();
        let mut fact = |label: &str, value: String| {
            facts.push_str(&format!("<div><dt>{label}</dt><dd>{value}</dd></div>"));
        };
        for (label, minutes, written) in [
            ("Prep", recipe.prep, &recipe.prep_text),
            ("Cook", recipe.cook, &recipe.cook_text),
            ("Total", recipe.total, &recipe.total_text),
        ] {
            if let Some(m) = minutes {
                fact(
                    label,
                    format!(
                        "<time datetime=\"{}\">{}</time>",
                        iso_duration(m),
                        format_minutes(m)
                    ),
                );
            } else if let Some(w) = written {
                // "overnight", "10-15 min": shown as written.
                fact(label, text(w));
            }
        }
        if let Some(s) = &recipe.servings_text {
            // A plain number can be scaled; the component updates this span.
            let value = if recipe.servings.is_some_and(|n| s.parse::<u32>() == Ok(n)) {
                format!("<span class=\"ob-recipe-servings\">{}</span>", text(s))
            } else {
                text(s)
            };
            fact("Serves", value);
        }
        if let Some(y) = &recipe.yield_text {
            fact("Makes", text(y));
        }
        if let Some(v) = &recipe.cuisine {
            fact("Cuisine", text(v));
        }
        if let Some(v) = &recipe.category {
            fact("Course", text(v));
        }
        if let Some(v) = &recipe.calories {
            fact("Calories", text(v));
        }
        let mut h =
            String::from("<section class=\"ob-recipe-card\" aria-label=\"Recipe summary\">\n");
        if !facts.is_empty() {
            h.push_str(&format!("<dl class=\"ob-recipe-facts\">{facts}</dl>\n"));
        }
        h.push_str("<div class=\"ob-recipe-actions\">");
        if rc.jump_link {
            if let Some(anchor) = &recipe.anchor {
                h.push_str(&format!(
                    "<a class=\"ob-recipe-jump\" href=\"#{}\">Jump to recipe</a>",
                    attr(anchor)
                ));
            }
        }
        h.push_str("</div>\n</section>\n");
        h
    }

    /// `<ob-recipe>` with one attribute per enabled feature.
    fn recipe_open_tag(&self, post: &Post, recipe: &crate::recipe::Recipe) -> String {
        let rc = &self.site.config.recipes;
        let mut tag = format!("<ob-recipe key=\"{}\"", attr(&post.url));
        if rc.scaling {
            if let Some(n) = recipe.servings {
                tag.push_str(&format!(" servings=\"{n}\" scaling"));
            }
        }
        for (on, name) in [
            (rc.checklists, "checklists"),
            (rc.timers, "timers"),
            (rc.cook_mode, "cook-mode"),
            (rc.print, "print"),
        ] {
            if on {
                tag.push(' ');
                tag.push_str(name);
            }
        }
        tag.push_str(">\n");
        tag
    }

    /// schema.org `Recipe` for search engines' recipe results.
    fn recipe_json_ld(&self, post: &Post, recipe: &crate::recipe::Recipe) -> serde_json::Value {
        use crate::recipe::iso_duration;
        let c = &self.site.config;
        let mut r = serde_json::json!({
            "@type": "Recipe",
            "name": post.title,
            "description": post.description,
            "datePublished": post.date.rfc3339(),
            "url": c.absolute(&post.url),
            "mainEntityOfPage": c.absolute(&post.url),
            "author": { "@type": "Person", "name": c.author.name, "url": c.author.url },
            "recipeIngredient": recipe.ingredients,
            "recipeInstructions": recipe.steps.iter().enumerate().map(|(i, s)| serde_json::json!({
                "@type": "HowToStep",
                "position": i + 1,
                "text": s,
            })).collect::<Vec<_>>(),
            "keywords": post.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>().join(", "),
        });
        let obj = r.as_object_mut().expect("json object");
        if let Some(image) = &post.cover {
            obj.insert("image".into(), serde_json::json!([c.absolute(image)]));
        }
        for (key, minutes) in [
            ("prepTime", recipe.prep),
            ("cookTime", recipe.cook),
            ("totalTime", recipe.total),
        ] {
            if let Some(m) = minutes {
                obj.insert(key.into(), serde_json::json!(iso_duration(m)));
            }
        }
        let yields: Vec<String> = recipe
            .servings_text
            .iter()
            .map(|s| {
                if recipe.servings.is_some_and(|n| s.parse::<u32>() == Ok(n)) {
                    format!("{s} servings")
                } else {
                    s.clone()
                }
            })
            .chain(recipe.yield_text.clone())
            .collect();
        if !yields.is_empty() {
            obj.insert("recipeYield".into(), serde_json::json!(yields));
        }
        if let Some(v) = &recipe.cuisine {
            obj.insert("recipeCuisine".into(), serde_json::json!(v));
        }
        if let Some(v) = &recipe.category {
            obj.insert("recipeCategory".into(), serde_json::json!(v));
        }
        if let Some(v) = &recipe.calories {
            obj.insert(
                "nutrition".into(),
                serde_json::json!({ "@type": "NutritionInformation", "calories": v }),
            );
        }
        r
    }

    fn series_box(&self, index: usize, post: &Post, series: &Series) -> String {
        let position = series.posts.iter().position(|&i| i == index).unwrap_or(0);
        let (prev, next) = self.site.series_neighbors(index);
        let mut h =
            String::from("<aside class=\"ob-series-box\" aria-label=\"Series navigation\">\n");
        h.push_str(&format!(
            "<p class=\"ob-eyebrow\">Part {} of {} in <a href=\"{}\">{}</a></p>\n",
            position + 1,
            series.posts.len(),
            attr(&series.url),
            text(&series.name)
        ));
        h.push_str("<div class=\"ob-series-nav\">");
        match prev {
            Some(p) => h.push_str(&format!(
                "<a class=\"ob-series-prev\" rel=\"prev\" href=\"{}\"><span class=\"ob-meta\">Previous part</span><span>{}</span></a>",
                attr(&p.url),
                text(&p.title)
            )),
            None => h.push_str("<span></span>"),
        }
        match next {
            Some(n) => h.push_str(&format!(
                "<a class=\"ob-series-next\" rel=\"next\" href=\"{}\"><span class=\"ob-meta\">Next part</span><span>{}</span></a>",
                attr(&n.url),
                text(&n.title)
            )),
            None => h.push_str("<span></span>"),
        }
        h.push_str("</div>\n<details class=\"ob-series-parts-details\"><summary>All parts</summary><ol class=\"ob-series-parts\">");
        for &i in &series.posts {
            let part = &self.site.posts[i];
            let current = if part.slug == post.slug {
                " aria-current=\"page\""
            } else {
                ""
            };
            h.push_str(&format!(
                "<li><a href=\"{}\"{}>{}</a></li>",
                attr(&part.url),
                current,
                text(&part.title)
            ));
        }
        h.push_str("</ol></details>\n</aside>\n");
        h
    }

    fn chronological_nav(&self, index: usize) -> String {
        // `posts` is newest first, so the "older" post is at index + 1.
        let newer = index.checked_sub(1).map(|i| &self.site.posts[i]);
        let older = self.site.posts.get(index + 1);
        if newer.is_none() && older.is_none() {
            return String::new();
        }
        let mut h =
            String::from("<nav class=\"ob-pager ob-post-pager\" aria-label=\"More posts\">");
        match older {
            Some(p) => h.push_str(&format!(
                "<a rel=\"prev\" href=\"{}\">← {}</a>",
                attr(&p.url),
                text(&p.title)
            )),
            None => h.push_str("<span></span>"),
        }
        match newer {
            Some(p) => h.push_str(&format!(
                "<a rel=\"next\" href=\"{}\">{} →</a>",
                attr(&p.url),
                text(&p.title)
            )),
            None => h.push_str("<span></span>"),
        }
        h.push_str("</nav>\n");
        h
    }

    fn series_index(&self, theme: &Theme) -> String {
        let mut body =
            String::from("<div class=\"ob-container\">\n<section class=\"ob-section\">\n");
        body.push_str(&self.heading(theme, 1, "Series", "ob-section-heading"));
        body.push_str("\n<p class=\"ob-lede\">Multi-part guides, in reading order.</p>\n");
        if self.site.series.iter().any(|s| !s.posts.is_empty()) {
            body.push_str(&self.series_cards(theme));
        } else {
            body.push_str("<p class=\"ob-empty\">No series yet. Add <code>series: my-series</code> to a post's front matter.</p>");
        }
        body.push_str("\n</section>\n</div>");
        self.simple(
            theme,
            "Series",
            "Multi-part guides and tutorials.",
            "/series/",
            &body,
        )
    }

    fn series_page(&self, series: &Series) -> String {
        let theme = self.theme(self.site.theme_for_series(series));
        let mut body = String::from(
            "<div class=\"ob-container ob-container-reading\">\n<section class=\"ob-section\">\n",
        );
        body.push_str("<p class=\"ob-eyebrow\"><a href=\"/series/\">Series</a></p>\n");
        body.push_str(&self.heading(theme, 1, &series.name, "ob-section-heading"));
        if let Some(cover) = &series.cover {
            body.push_str(&format!("<figure class=\"ob-cover\"><img src=\"{}\" alt=\"\" decoding=\"async\"></figure>\n", attr(cover)));
        }
        if !series.description_html.trim().is_empty() {
            body.push_str(&format!(
                "<div class=\"ob-prose\">{}</div>\n",
                series.description_html
            ));
        }
        body.push_str("<ol class=\"ob-series-parts ob-series-parts-full\">\n");
        for (n, &i) in series.posts.iter().enumerate() {
            let post = &self.site.posts[i];
            body.push_str(&format!(
                "<li><a class=\"ob-part\" href=\"{}\"><span class=\"ob-part-number\" aria-hidden=\"true\">{:02}</span><span class=\"ob-part-body\"><span class=\"ob-part-title\">{}</span><span class=\"ob-part-summary\">{}</span><span class=\"ob-meta\">{} · {} min read</span></span></a></li>\n",
                attr(&post.url),
                n + 1,
                text(&post.title),
                text(&post.description),
                self.time(post),
                post.reading_minutes
            ));
        }
        body.push_str("</ol>\n</section>\n</div>");
        self.simple(
            theme,
            &series.name,
            &series.description_text,
            &series.url,
            &body,
        )
    }

    fn tags_index(&self, theme: &Theme) -> String {
        let mut body =
            String::from("<div class=\"ob-container\">\n<section class=\"ob-section\">\n");
        body.push_str(&self.heading(theme, 1, "Tags", "ob-section-heading"));
        body.push_str("\n<ul class=\"ob-tags ob-tag-cloud\">");
        for t in &self.site.tags {
            body.push_str(&format!(
                "<li><a href=\"{}\">{} <span class=\"ob-count\">{}</span></a></li>",
                attr(&t.url),
                text(&t.name),
                t.posts.len()
            ));
        }
        body.push_str("</ul>\n</section>\n</div>");
        self.simple(theme, "Tags", "Browse posts by topic.", "/tags/", &body)
    }

    fn tag_page(&self, theme: &Theme, tag: &crate::model::Tag) -> String {
        let mut body =
            String::from("<div class=\"ob-container\">\n<section class=\"ob-section\">\n");
        body.push_str("<p class=\"ob-eyebrow\"><a href=\"/tags/\">Tag</a></p>\n");
        body.push_str(&self.heading(theme, 1, &tag.name, "ob-section-heading"));
        body.push('\n');
        body.push_str(&self.post_list(theme, &tag.posts));
        body.push_str("\n</section>\n</div>");
        self.simple(
            theme,
            &tag.name,
            &format!("Posts tagged {}.", tag.name),
            &tag.url,
            &body,
        )
    }

    fn archive(&self, theme: &Theme) -> String {
        let mut body =
            String::from("<div class=\"ob-container\">\n<section class=\"ob-section\">\n");
        body.push_str(&self.heading(theme, 1, "Archive", "ob-section-heading"));
        let mut year = i64::MIN;
        for (i, post) in self.site.posts.iter().enumerate() {
            let y = post.date.year();
            if y != year {
                if year != i64::MIN {
                    body.push_str("</ul>\n");
                }
                body.push_str(&format!(
                    "<h2 class=\"ob-archive-year\">{y}</h2>\n<ul class=\"ob-archive\">\n"
                ));
                year = y;
            }
            let _ = i;
            body.push_str(&format!(
                "<li><a href=\"{}\">{}</a> <span class=\"ob-meta\">{}</span></li>\n",
                attr(&post.url),
                text(&post.title),
                self.time(post)
            ));
        }
        if year != i64::MIN {
            body.push_str("</ul>\n");
        } else {
            body.push_str("<p class=\"ob-empty\">Nothing here yet.</p>");
        }
        body.push_str("</section>\n</div>");
        self.simple(
            theme,
            "Archive",
            "Every post, newest first.",
            "/archive/",
            &body,
        )
    }

    fn search_page(&self, theme: &Theme) -> String {
        let mut body =
            String::from("<div class=\"ob-container\">\n<section class=\"ob-section\">\n");
        body.push_str(&self.heading(theme, 1, "Search", "ob-section-heading"));
        body.push_str(
            "\n<ob-search index=\"/search.json\" wasm=\"/assets/wasm/openblog_wasm.js\">\n<form class=\"ob-search-form\" role=\"search\" action=\"/search/\" method=\"get\"><label for=\"q\">Search posts</label><input id=\"q\" name=\"q\" type=\"search\" autocomplete=\"off\" placeholder=\"Rust, web components, …\"></form>\n<p class=\"ob-search-status\" role=\"status\" aria-live=\"polite\"></p>\n<ol class=\"ob-search-results\"></ol>\n</ob-search>\n<noscript><p>Search needs JavaScript. You can also browse the <a href=\"/archive/\">archive</a> or <a href=\"/tags/\">tags</a>.</p></noscript>\n",
        );
        body.push_str("</section>\n</div>");
        let mut meta = self.meta_simple(theme, "Search", "Search every post.", "/search/");
        meta.noindex = true;
        self.document(&meta, &body)
    }

    fn page(&self, page: &crate::model::Page) -> String {
        let theme = self.theme(self.site.theme_for_page(page));
        let mut body = String::from(
            "<div class=\"ob-container ob-container-reading\">\n<article class=\"ob-page\">\n",
        );
        body.push_str(&self.heading(theme, 1, &page.title, "ob-post-title"));
        body.push_str(&format!(
            "\n<ob-code{}><div class=\"ob-prose\">{}</div></ob-code>\n</article>\n</div>",
            self.code_attr(theme, None),
            page.html
        ));
        self.simple(theme, &page.title, &page.description, &page.url, &body)
    }

    fn not_found(&self, theme: &Theme) -> String {
        let body = format!(
            "<div class=\"ob-container ob-container-reading\"><section class=\"ob-section\">{}<p class=\"ob-lede\">That page does not exist. Try the <a href=\"/\">latest posts</a>, the <a href=\"/archive/\">archive</a>, or <a href=\"/search/\">search</a>.</p></section></div>",
            self.heading(theme, 1, "Page not found", "ob-section-heading")
        );
        let mut meta = self.meta_simple(theme, "Page not found", "", "/404.html");
        meta.noindex = true;
        self.document(&meta, &body)
    }

    fn meta_simple<'t>(
        &self,
        theme: &'t Theme,
        title: &str,
        description: &str,
        path: &str,
    ) -> Meta<'t> {
        Meta {
            title: title.to_string(),
            description: if description.is_empty() {
                self.site.config.description.clone()
            } else {
                description.to_string()
            },
            path: path.to_string(),
            canonical: None,
            kind: "website",
            image: None,
            json_ld: None,
            theme,
            published: None,
            modified: None,
            tags: Vec::new(),
            noindex: false,
        }
    }

    fn simple(
        &self,
        theme: &Theme,
        title: &str,
        description: &str,
        path: &str,
        body: &str,
    ) -> String {
        let meta = self.meta_simple(theme, title, description, path);
        self.document(&meta, body)
    }
}

/// ` · N views` for a page with a known count, else empty.
fn site_views_text(site: &Site, path: &str) -> String {
    if !site.config.analytics.bake_counts {
        return String::new();
    }
    match site.view_counts.get(path) {
        Some(&n) if n > 0 => format!(" · {n} {}", if n == 1 { "view" } else { "views" }),
        _ => String::new(),
    }
}

trait IfEmpty {
    fn if_empty(self, fallback: &str) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

// `cdata` is re-exported for callers that build custom feeds on top of the renderer.
#[allow(dead_code)]
fn _keep_cdata(s: &str) -> String {
    cdata(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SiteConfig;
    use crate::model::{LoadOptions, SourceFile, Sources};
    use crate::theme::ThemeFile;

    fn build(config_json: &str, extra_theme: bool) -> Vec<OutputFile> {
        let config = SiteConfig::from_json(config_json).unwrap();
        let src = |p: &str, c: &str| SourceFile {
            path: p.into(),
            contents: c.into(),
        };
        let site = Site::load(
            config,
            Sources {
                posts: vec![
                    src("posts/one.md", "---\ntitle: One\ndate: 2026-01-01\nseries: s\ntags: [a]\n---\n## A\n\n## B\n\n## C\n\ntext\n"),
                    src("posts/two.md", "---\ntitle: Two\ndate: 2026-02-01\nseries: s\n---\nbody <script>x</script>"),
                    src("posts/solo.md", "---\ntitle: Solo\ndate: 2026-03-01\n---\nbody"),
                ],
                series: vec![src("series/s.md", "---\nname: Series S\ntheme: loud\n---\nAbout S")],
                pages: vec![src("pages/about.md", "---\ntitle: About\nnav: true\n---\nHi")],
            },
            LoadOptions::default(),
        )
        .unwrap();
        let mut themes = ThemeSet::new();
        if extra_theme {
            themes.insert(
                "loud",
                ThemeFile::from_json(r##"{"extends":"base","options":{"headingCodeLabels":true,"headingWrapper":"x-type","navLabel":"//{index}. <{label}/>","listStyle":"cards","codeLineNumbers":false},"scripts":["fx.js"],"colors":{"dark":{"accent":"#ff0"}}}"##).unwrap(),
            );
        }
        generate(&site, &themes).unwrap()
    }

    fn file<'a>(files: &'a [OutputFile], path: &str) -> &'a str {
        &files
            .iter()
            .find(|f| f.path == path)
            .unwrap_or_else(|| panic!("missing {path}"))
            .contents
    }

    #[test]
    fn generates_every_page_and_feed() {
        let files = build(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/","postsPerPage":2}"#,
            true,
        );
        for path in [
            "index.html",
            "page/2/index.html",
            "one/index.html",
            "two/index.html",
            "solo/index.html",
            "series/index.html",
            "series/s/index.html",
            "tags/index.html",
            "tags/a/index.html",
            "archive/index.html",
            "search/index.html",
            "about/index.html",
            "404.html",
            "rss.xml",
            "feed.json",
            "sitemap.xml",
            "robots.txt",
            "api/blog.json",
            "search.json",
            "themes/base/tokens.css",
            "themes/loud/tokens.css",
        ] {
            assert!(files.iter().any(|f| f.path == path), "missing {path}");
        }
    }

    #[test]
    fn series_theme_applies_to_its_posts_only() {
        let files = build(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#,
            true,
        );
        let one = file(&files, "one/index.html");
        assert!(one.contains("data-ob-theme=\"loud\""));
        assert!(one.contains("/themes/loud/tokens.css"));
        assert!(one.contains("&lt;h1&gt;"));
        assert!(one.contains("<x-type>One</x-type>"));
        assert!(one.contains("<script type=\"module\" src=\"/themes/loud/fx.js\"></script>"));
        assert!(one.contains("Part 1 of 2 in"));
        assert!(one.contains("//01. &lt;Home/&gt;"));
        assert!(one.contains("On this page"));
        let solo = file(&files, "solo/index.html");
        assert!(solo.contains("data-ob-theme=\"base\""));
        assert!(!solo.contains("x-type"));
        assert!(!solo.contains("fx.js"));
        assert!(file(&files, "series/s/index.html").contains("data-ob-theme=\"loud\""));
    }

    fn build_posts(config_json: &str, posts: &[(&str, &str)]) -> Vec<OutputFile> {
        let config = SiteConfig::from_json(config_json).unwrap();
        let sources = Sources {
            posts: posts
                .iter()
                .map(|(p, c)| SourceFile {
                    path: (*p).into(),
                    contents: (*c).into(),
                })
                .collect(),
            ..Sources::default()
        };
        let site = Site::load(config, sources, LoadOptions::default()).unwrap();
        generate(&site, &ThemeSet::new()).unwrap()
    }

    const RECIPE: &str = "---\ntitle: Lemon Pasta\ndate: 2026-03-02\nrecipe: true\nservings: 4\nprep: 10 min\ncook: 1 hr 5 min\ncuisine: Italian\ncourse: Dinner\ncover: /images/pasta.jpg\ntags: [pasta]\n---\nA story first.\n\n## Ingredients\n\n- 400 g spaghetti\n- 1/2 cup parmesan\n\n## Method\n\n1. Boil for 10 minutes.\n2. Toss with the cheese.\n";

    #[test]
    fn recipe_posts_get_a_card_controls_and_recipe_data() {
        let files = build_posts(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/","author":{"name":"Cook"}}"#,
            &[("posts/pasta.md", RECIPE)],
        );
        let page = file(&files, "pasta/index.html");
        assert!(page.contains("<ob-recipe key=\"/pasta/\" servings=\"4\" scaling checklists timers cook-mode print>"), "{page}");
        assert!(page
            .contains("<div><dt>Prep</dt><dd><time datetime=\"PT10M\">10 min</time></dd></div>"));
        assert!(page.contains(
            "<div><dt>Cook</dt><dd><time datetime=\"PT1H5M\">1 hr 5 min</time></dd></div>"
        ));
        assert!(page.contains(
            "<div><dt>Total</dt><dd><time datetime=\"PT1H15M\">1 hr 15 min</time></dd></div>"
        ));
        assert!(
            page.contains("<dt>Serves</dt><dd><span class=\"ob-recipe-servings\">4</span></dd>")
        );
        assert!(
            page.contains("<a class=\"ob-recipe-jump\" href=\"#ingredients\">Jump to recipe</a>")
        );
        assert!(page.contains("<ul class=\"ob-recipe-list ob-ingredients\">"));
        assert!(page.contains("</ob-code>\n</ob-recipe>"));
        // schema.org: the article and the recipe, with ISO durations and the lists.
        let start = page.find("application/ld+json\">").unwrap() + "application/ld+json\">".len();
        let end = start + page[start..].find("</script>").unwrap();
        let ld: serde_json::Value = serde_json::from_str(&page[start..end]).unwrap();
        let recipe = &ld["@graph"][1];
        assert_eq!(ld["@graph"][0]["@type"], "BlogPosting");
        assert_eq!(recipe["@type"], "Recipe");
        assert_eq!(
            recipe["recipeIngredient"],
            serde_json::json!(["400 g spaghetti", "1/2 cup parmesan"])
        );
        assert_eq!(
            recipe["recipeInstructions"][0]["text"],
            "Boil for 10 minutes."
        );
        assert_eq!(recipe["totalTime"], "PT1H15M");
        assert_eq!(recipe["recipeYield"], serde_json::json!(["4 servings"]));
        assert_eq!(recipe["recipeCuisine"], "Italian");
        assert_eq!(
            recipe["image"],
            serde_json::json!(["https://t.dev/images/pasta.jpg"])
        );

        // Each feature can be switched off in openblog.json.
        let files = build_posts(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/","recipes":{"scaling":false,"timers":false,"jumpLink":false,"cookMode":false}}"#,
            &[("posts/pasta.md", RECIPE)],
        );
        let page = file(&files, "pasta/index.html");
        assert!(
            page.contains("<ob-recipe key=\"/pasta/\" checklists print>"),
            "{page}"
        );
        assert!(!page.contains("Jump to recipe"));
    }

    #[test]
    fn recipe_text_cannot_escape_the_json_ld_script() {
        let post = "---\ntitle: Pie <!--<script> x\ndate: 2026-01-01\nrecipe: true\nservings: 0\ncook: overnight\n---\n## Ingredients\n\n- 1 cup sugar (the `<!--<script>` trick) & </script>\n\n## Steps\n\n1. Melt.\n";
        let files = build_posts(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#,
            &[("posts/pie.md", post)],
        );
        let page = file(&files, "pie/index.html");
        let start = page.find("application/ld+json\">").unwrap() + "application/ld+json\">".len();
        let end = start + page[start..].find("</script>").unwrap();
        let json = &page[start..end];
        assert!(
            !json.contains('<') && !json.contains('>') && !json.contains('&'),
            "{json}"
        );
        let ld: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(
            ld["@graph"][1]["recipeIngredient"][0],
            "1 cup sugar (the <!--<script> trick) &"
        );
        assert!(
            ld["@graph"][1].get("cookTime").is_none(),
            "unreadable times stay out of the data"
        );
        assert!(
            page.contains("<dt>Cook</dt><dd>overnight</dd>"),
            "but show as written"
        );
        assert!(
            page.contains("<dt>Serves</dt><dd>0</dd>"),
            "zero is not scalable"
        );
        assert!(ld["@graph"][1].get("recipeYield") == Some(&serde_json::json!(["0"])));
    }

    #[test]
    fn recipes_without_lists_warn() {
        let config = SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev"}"#).unwrap();
        let sources = Sources {
            posts: vec![SourceFile {
                path: "posts/c.md".into(),
                contents: "---\ntitle: C\ndate: 2026-01-01\nrecipe: true\n---\n**Ingredients**\n\n- flour\n".into(),
            }],
            ..Sources::default()
        };
        let site = Site::load(config, sources, LoadOptions::default()).unwrap();
        assert_eq!(site.warnings.len(), 2, "{:?}", site.warnings);
        assert!(site.warnings[0].contains("## Ingredients"));
    }

    #[test]
    fn code_settings_follow_post_then_site_then_theme() {
        let post =
            |fm: &str| format!("---\ntitle: P\ndate: 2026-01-01\n{fm}---\n```js\na\nb\n```\n");
        let site = r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#;
        let files = build_posts(site, &[("posts/p.md", &post(""))]);
        assert!(file(&files, "p/index.html").contains("<ob-code highlight line-numbers>"));

        let off = r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/","code":{"lineNumbers":false,"copyButton":false}}"#;
        let files = build_posts(off, &[("posts/p.md", &post(""))]);
        assert!(file(&files, "p/index.html").contains("<ob-code highlight no-copy>"));

        let files = build_posts(
            off,
            &[("posts/p.md", &post("lineNumbers: true\nhighlight: false\n"))],
        );
        assert!(
            file(&files, "p/index.html").contains("<ob-code line-numbers no-copy>"),
            "the post wins"
        );
    }

    #[test]
    fn code_blocks_get_highlighting_and_line_numbers_per_theme() {
        let files = build(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#,
            true,
        );
        assert!(file(&files, "solo/index.html").contains("<ob-code highlight line-numbers>"));
        let themed = file(&files, "one/index.html");
        assert!(themed.contains("data-ob-theme=\"loud\""));
        assert!(
            themed.contains("<ob-code highlight>"),
            "the series theme turned numbers off"
        );
    }

    #[test]
    fn escapes_and_keeps_raw_html_out_of_titles() {
        let files = build(
            r#"{"title":"T & Co","url":"https://t.dev","postPath":"/{slug}/"}"#,
            true,
        );
        let solo = file(&files, "solo/index.html");
        assert!(solo.contains("<title>Solo · T &amp; Co</title>"));
        assert!(solo.contains("application/ld+json"));
        assert!(solo
            .contains("Powered by <a href=\"https://github.com/journey-to-code-org/open.blog\""));
        let config =
            SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","poweredBy":false}"#)
                .unwrap();
        let site = Site::load(config, Sources::default(), LoadOptions::default()).unwrap();
        let files = generate(&site, &ThemeSet::new()).unwrap();
        assert!(!file(&files, "index.html").contains("Powered by"));
        assert!(file(&files, "api/blog.json").contains("\"schemaVersion\": 1"));
    }

    #[test]
    fn posts_get_share_links_views_related_and_snippets() {
        let files = build(
            r##"{"title":"T","url":"https://t.dev","postPath":"/{slug}/","snippets":{"head":"<meta name=\"x-verify\" content=\"1\">","postFooter":"<div id=\"comments\"></div>","bodyEnd":"<script src=\"/x.js\"></script>"}}"##,
            true,
        );
        let one = file(&files, "one/index.html");
        assert!(one.contains("<ob-share url=\"https://t.dev/one/\" title=\"One\">"));
        assert!(one.contains(
            "https://twitter.com/intent/tweet?text=One&amp;url=https%3A%2F%2Ft.dev%2Fone%2F"
        ));
        assert!(one.contains("href=\"mailto:?subject=One&amp;body=https%3A%2F%2Ft.dev%2Fone%2F\""));
        assert!(one.contains("<ob-views path=\"/one/\" endpoint=\"\"></ob-views>"));
        assert!(
            one.contains("Related posts") && one.contains("href=\"/two/\""),
            "two shares the series"
        );
        assert!(one.contains("<meta name=\"x-verify\" content=\"1\">\n</head>"));
        assert!(one.contains("<div id=\"comments\"></div>"));
        assert!(one.contains("<script src=\"/x.js\"></script>\n</body>"));
        let solo = file(&files, "solo/index.html");
        assert!(
            !solo.contains("Related posts"),
            "nothing overlaps with solo"
        );

        let files = build(
            r#"{"title":"T","url":"https://t.dev","share":{"enabled":false},"analytics":{"showViews":false},"relatedPosts":0}"#,
            true,
        );
        let one = file(&files, "posts/one/index.html");
        assert!(
            !one.contains("ob-share")
                && !one.contains("ob-views")
                && !one.contains("Related posts")
        );
    }

    #[test]
    fn aliases_redirect_and_stay_out_of_the_sitemap() {
        let config =
            SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#)
                .unwrap();
        let src = |p: &str, c: &str| SourceFile {
            path: p.into(),
            contents: c.into(),
        };
        let site = Site::load(
            config,
            Sources {
                posts: vec![src(
                    "posts/new.md",
                    "---\ntitle: New\ndate: 2026-01-01\naliases: [/old/, /2024/old-name]\n---\nx",
                )],
                pages: vec![src(
                    "pages/about.md",
                    "---\ntitle: About\naliases: [/about-me/]\n---\nx",
                )],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        let files = generate(&site, &ThemeSet::new()).unwrap();
        let old = file(&files, "old/index.html");
        assert!(old.contains("<meta http-equiv=\"refresh\" content=\"0; url=/new/\">"));
        assert!(old.contains("<link rel=\"canonical\" href=\"https://t.dev/new/\">"));
        assert!(old.contains("noindex"));
        assert!(files.iter().any(|f| f.path == "2024/old-name/index.html"));
        assert!(files.iter().any(|f| f.path == "about-me/index.html"));
        assert!(files.iter().any(|f| f.path == ".nojekyll"));
        let sitemap = file(&files, "sitemap.xml");
        assert!(!sitemap.contains("/old/") && !sitemap.contains("about-me"));

        // An alias that collides with a real page is an error, not a silent overwrite.
        let config =
            SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#)
                .unwrap();
        let site = Site::load(
            config,
            Sources {
                posts: vec![
                    src(
                        "posts/a.md",
                        "---\ntitle: A\ndate: 2026-01-01\naliases: [/b/]\n---\nx",
                    ),
                    src("posts/b.md", "---\ntitle: B\ndate: 2026-01-02\n---\ny"),
                ],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        assert!(generate(&site, &ThemeSet::new())
            .unwrap_err()
            .contains("b/index.html"));
    }

    #[test]
    fn base_path_prefixes_every_root_relative_url() {
        let files = build(
            r#"{"title":"T","url":"https://user.github.io/blog","postPath":"/{slug}/"}"#,
            true,
        );
        let one = file(&files, "one/index.html");
        assert!(one.contains("href=\"/blog/assets/base.css\""));
        assert!(
            one.contains("href=\"/blog/two/\""),
            "post links carry the base path"
        );
        assert!(
            one.contains("href=\"/blog/\" aria-label"),
            "the brand link too"
        );
        assert!(one.contains("<link rel=\"canonical\" href=\"https://user.github.io/blog/one/\">"));
        assert!(file(&files, "search/index.html")
            .contains("index=\"/blog/search.json\" wasm=\"/blog/assets/wasm/"));
        assert!(file(&files, "search.json").contains("\"url\":\"/blog/one/\""));
        assert!(file(&files, "rss.xml").contains("<link>https://user.github.io/blog/one/</link>"));
        assert!(file(&files, "sitemap.xml").contains("<loc>https://user.github.io/blog/</loc>"));
    }

    #[test]
    fn baked_view_counts_and_external_endpoint() {
        let config = SiteConfig::from_json(
            r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/","analytics":{"builtin":false,"endpoint":"https://counter.example.workers.dev/"}}"#,
        )
        .unwrap();
        let src = |p: &str, c: &str| SourceFile {
            path: p.into(),
            contents: c.into(),
        };
        let mut site = Site::load(
            config,
            Sources {
                posts: vec![
                    src("posts/a.md", "---\ntitle: A\ndate: 2026-01-01\n---\nx"),
                    src("posts/b.md", "---\ntitle: B\ndate: 2026-01-02\n---\ny"),
                ],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        site.view_counts.insert("/a/".into(), 1234);
        let files = generate(&site, &ThemeSet::new()).unwrap();
        let a = file(&files, "a/index.html");
        assert!(a.contains("<ob-views path=\"/a/\" endpoint=\"https://counter.example.workers.dev\"> · 1234 views</ob-views>"), "{a}");
        assert!(file(&files, "b/index.html").contains(
            "<ob-views path=\"/b/\" endpoint=\"https://counter.example.workers.dev\"></ob-views>"
        ));
        assert_eq!(file(&files, "api/views.json"), "{\"/a/\":1234}");
        // No live counter at all: the element is not emitted.
        site.config.analytics.endpoint.clear();
        let files = generate(&site, &ThemeSet::new()).unwrap();
        assert!(!file(&files, "a/index.html").contains("<ob-views"));
    }

    #[test]
    fn cdn_points_assets_elsewhere_but_not_pages_or_feeds() {
        let files = build(
            r#"{"title":"T","url":"https://t.dev","cdn":{"url":"https://cdn.t.dev","version":"v1"}}"#,
            true,
        );
        let one = file(&files, "posts/one/index.html");
        assert!(one.contains("href=\"https://cdn.t.dev/assets/base.css?v=v1\""));
        assert!(one.contains("src=\"https://cdn.t.dev/assets/openblog.js?v=v1\""));
        assert!(
            one.contains("href=\"https://cdn.t.dev/themes/loud/tokens.css?v=v1\""),
            "the series theme's tokens come from the CDN too"
        );
        assert!(
            one.contains("href=\"/posts/two/\""),
            "page links stay on the site"
        );
        assert!(one.contains("href=\"/rss.xml\""));
        assert!(
            one.contains("wasm=\"/assets/wasm/") || !one.contains("wasm="),
            "the WebAssembly module stays same-origin"
        );
        assert!(
            !file(&files, "rss.xml").contains("cdn.t.dev"),
            "feeds keep canonical site URLs"
        );
        let search = file(&files, "search/index.html");
        assert!(search.contains("wasm=\"/assets/wasm/openblog_wasm.js\""));
    }

    #[test]
    fn unknown_theme_is_an_error_and_reserved_slugs_are_rejected() {
        let config =
            SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","theme":"nope"}"#).unwrap();
        let site = Site::load(config, Sources::default(), LoadOptions::default()).unwrap();
        assert!(generate(&site, &ThemeSet::new())
            .unwrap_err()
            .contains("not found"));

        let config = SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev"}"#).unwrap();
        let site = Site::load(
            config,
            Sources {
                pages: vec![SourceFile {
                    path: "pages/search.md".into(),
                    contents: "x".into(),
                }],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        assert!(generate(&site, &ThemeSet::new())
            .unwrap_err()
            .contains("reserved"));
    }
}

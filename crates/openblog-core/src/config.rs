//! Site configuration, read from `openblog.json`.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SiteConfig {
    /// Blog title, shown in the header and feeds.
    pub title: String,
    /// One or two sentences for `<meta name="description">` and the feeds.
    pub description: String,
    /// Canonical origin without a trailing slash, e.g. `https://journeytocode.io`.
    pub url: String,
    /// BCP 47 language tag.
    pub language: String,
    pub author: Author,
    /// Site logo shown beside the title (a site path or URL). Optional.
    pub logo: String,
    /// Favicon path or URL. Optional.
    pub favicon: String,
    /// Default social-card image used when a post has no cover.
    pub og_image: String,
    /// Default theme name (a directory under `themes/`). Series and posts can override it.
    pub theme: String,
    /// URL pattern for posts. `{slug}` is replaced. `/{slug}/` keeps Hashnode-style URLs.
    pub post_path: String,
    /// Posts per listing page. `0` disables pagination.
    pub posts_per_page: usize,
    /// Header navigation. Pages with `nav: true` in their front matter are appended.
    pub nav: Vec<Link>,
    /// Footer links (GitHub, LinkedIn, portfolio, ...).
    pub social: Vec<Link>,
    /// Footer text. `{year}` and `{author}` are replaced.
    pub footer: String,
    pub home: HomeConfig,
    pub feeds: FeedsConfig,
    pub markdown: MarkdownConfig,
    pub paths: PathsConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Author {
    pub name: String,
    pub url: String,
    pub email: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Link {
    pub label: String,
    pub href: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HomeConfig {
    /// Heading above the post list.
    pub heading: String,
    /// Markdown shown above the post list. Leave empty to hide.
    pub intro: String,
    /// Show the series overview on the home page.
    pub show_series: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FeedsConfig {
    /// Write `/rss.xml`.
    pub rss: bool,
    /// Write `/feed.json` (JSON Feed 1.1).
    pub json: bool,
    /// Write `/sitemap.xml` and `/robots.txt`.
    pub sitemap: bool,
    /// Write `/api/blog.json`, the snapshot shape the mnix.dev portfolio consumes.
    pub portfolio_snapshot: bool,
    /// Maximum items in RSS and JSON feeds.
    pub limit: usize,
    /// Include the full post HTML in feeds (otherwise only the summary).
    pub full_content: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MarkdownConfig {
    pub smart_punctuation: bool,
    pub heading_anchors: bool,
    /// Headings at or below this level appear in the table of contents (2 = h2 only).
    pub toc_depth: u8,
    /// Minimum number of headings before a table of contents is shown.
    pub toc_min_headings: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PathsConfig {
    pub content: String,
    #[serde(rename = "static")]
    pub static_dir: String,
    pub output: String,
    pub themes: String,
    /// Directory holding `base.css`, the web components, and the WebAssembly build.
    pub web: String,
}

impl Default for SiteConfig {
    fn default() -> Self {
        Self {
            title: "open.blog".to_string(),
            description: "A blog built with open.blog".to_string(),
            url: "https://example.com".to_string(),
            language: "en".to_string(),
            author: Author::default(),
            logo: String::new(),
            favicon: String::new(),
            og_image: String::new(),
            theme: "base".to_string(),
            post_path: "/posts/{slug}/".to_string(),
            posts_per_page: 10,
            nav: vec![
                Link { label: "Home".into(), href: "/".into() },
                Link { label: "Series".into(), href: "/series/".into() },
                Link { label: "Archive".into(), href: "/archive/".into() },
                Link { label: "Search".into(), href: "/search/".into() },
            ],
            social: Vec::new(),
            footer: "© {year} {author}".to_string(),
            home: HomeConfig::default(),
            feeds: FeedsConfig::default(),
            markdown: MarkdownConfig::default(),
            paths: PathsConfig::default(),
        }
    }
}

impl Default for HomeConfig {
    fn default() -> Self {
        Self { heading: "Latest posts".into(), intro: String::new(), show_series: true }
    }
}

impl Default for FeedsConfig {
    fn default() -> Self {
        Self { rss: true, json: true, sitemap: true, portfolio_snapshot: true, limit: 20, full_content: true }
    }
}

impl Default for MarkdownConfig {
    fn default() -> Self {
        Self { smart_punctuation: false, heading_anchors: true, toc_depth: 3, toc_min_headings: 3 }
    }
}

impl Default for PathsConfig {
    fn default() -> Self {
        Self {
            content: "content".into(),
            static_dir: "static".into(),
            output: "dist".into(),
            themes: "themes".into(),
            web: "web".into(),
        }
    }
}

impl SiteConfig {
    pub fn from_json(json: &str) -> Result<Self, String> {
        let mut config: Self =
            serde_json::from_str(json).map_err(|e| format!("invalid openblog.json: {e}"))?;
        config.normalize();
        Ok(config)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_default()
    }

    fn normalize(&mut self) {
        while self.url.ends_with('/') {
            self.url.pop();
        }
        if !self.post_path.contains("{slug}") {
            self.post_path = "/posts/{slug}/".to_string();
        }
        if !self.post_path.starts_with('/') {
            self.post_path.insert(0, '/');
        }
        if !self.post_path.ends_with('/') {
            self.post_path.push('/');
        }
        if self.theme.is_empty() {
            self.theme = "base".to_string();
        }
    }

    /// URL path for a post slug, e.g. `/posts/hello/`.
    pub fn post_url(&self, slug: &str) -> String {
        self.post_path.replace("{slug}", slug)
    }

    /// Absolute URL for a site path.
    pub fn absolute(&self, path: &str) -> String {
        if path.starts_with("http://") || path.starts_with("https://") {
            return path.to_string();
        }
        format!("{}{}", self.url, if path.starts_with('/') { path.to_string() } else { format!("/{path}") })
    }

    pub fn footer_text(&self, year: i64) -> String {
        self.footer.replace("{year}", &year.to_string()).replace("{author}", &self.author.name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_normalization() {
        let c = SiteConfig::from_json(r#"{"title":"T","url":"https://x.dev/","postPath":"{slug}"}"#).unwrap();
        assert_eq!(c.url, "https://x.dev");
        assert_eq!(c.post_url("a"), "/a/");
        assert_eq!(c.absolute("/rss.xml"), "https://x.dev/rss.xml");
        assert!(c.feeds.rss);
        assert_eq!(c.theme, "base");
    }
}

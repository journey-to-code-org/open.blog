//! RSS 2.0, JSON Feed 1.1, sitemap, robots.txt, the portfolio snapshot, and
//! the search index. All are plain string builders over the site model.

use crate::escape;
use crate::model::Site;
use crate::search::{Index, IndexEntry, INDEX_VERSION};

/// RSS 2.0 with the `content:encoded`, `dc:creator`, and `atom:link` extensions
/// most readers and cross-posting tools expect.
pub fn rss(site: &Site) -> String {
    let c = &site.config;
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
    out.push_str("<channel>\n");
    out.push_str(&format!("<title>{}</title>\n", escape::xml(&c.title)));
    out.push_str(&format!("<link>{}</link>\n", escape::xml(&c.absolute("/"))));
    out.push_str(&format!(
        "<description>{}</description>\n",
        escape::xml(&c.description)
    ));
    out.push_str(&format!(
        "<language>{}</language>\n",
        escape::xml(&c.language)
    ));
    out.push_str(&format!(
        "<atom:link href=\"{}\" rel=\"self\" type=\"application/rss+xml\"/>\n",
        escape::xml(&c.absolute("/rss.xml"))
    ));
    out.push_str("<generator>open.blog</generator>\n");
    if let Some(latest) = site.latest_update() {
        out.push_str(&format!(
            "<lastBuildDate>{}</lastBuildDate>\n",
            latest.rfc2822()
        ));
    }
    for post in site.posts.iter().take(c.feeds.limit.max(1)) {
        let link = c.absolute(&post.url);
        out.push_str("<item>\n");
        out.push_str(&format!("<title>{}</title>\n", escape::xml(&post.title)));
        out.push_str(&format!("<link>{}</link>\n", escape::xml(&link)));
        out.push_str(&format!(
            "<guid isPermaLink=\"true\">{}</guid>\n",
            escape::xml(&link)
        ));
        out.push_str(&format!("<pubDate>{}</pubDate>\n", post.date.rfc2822()));
        if !c.author.name.is_empty() {
            out.push_str(&format!(
                "<dc:creator>{}</dc:creator>\n",
                escape::xml(&c.author.name)
            ));
        }
        for tag in &post.tags {
            out.push_str(&format!(
                "<category>{}</category>\n",
                escape::xml(&tag.name)
            ));
        }
        out.push_str(&format!(
            "<description>{}</description>\n",
            escape::xml(&post.description)
        ));
        if let Some(cover) = &post.cover {
            out.push_str(&format!(
                "<enclosure url=\"{}\" length=\"0\" type=\"{}\"/>\n",
                escape::xml(&c.absolute(cover)),
                mime_for(cover)
            ));
        }
        if c.feeds.full_content {
            out.push_str(&format!(
                "<content:encoded>{}</content:encoded>\n",
                escape::cdata(&absolutize_html(&post.html, &c.url))
            ));
        }
        out.push_str("</item>\n");
    }
    out.push_str("</channel>\n</rss>\n");
    out
}

/// JSON Feed 1.1: <https://jsonfeed.org/version/1.1>
pub fn json_feed(site: &Site) -> String {
    let c = &site.config;
    let items: Vec<serde_json::Value> = site
        .posts
        .iter()
        .take(c.feeds.limit.max(1))
        .map(|post| {
            let url = c.absolute(&post.url);
            let mut item = serde_json::json!({
                "id": url,
                "url": url,
                "title": post.title,
                "summary": post.description,
                "date_published": post.date.rfc3339(),
                "tags": post.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
            });
            if let Some(updated) = post.updated {
                item["date_modified"] = serde_json::Value::String(updated.rfc3339());
            }
            if let Some(cover) = &post.cover {
                item["image"] = serde_json::Value::String(c.absolute(cover));
            }
            if c.feeds.full_content {
                item["content_html"] =
                    serde_json::Value::String(absolutize_html(&post.html, &c.url));
            }
            if let Some(canonical) = &post.canonical {
                item["external_url"] = serde_json::Value::String(canonical.clone());
            }
            item
        })
        .collect();
    let mut feed = serde_json::json!({
        "version": "https://jsonfeed.org/version/1.1",
        "title": c.title,
        "home_page_url": c.absolute("/"),
        "feed_url": c.absolute("/feed.json"),
        "description": c.description,
        "language": c.language,
        "items": items,
    });
    if !c.author.name.is_empty() {
        let mut author = serde_json::json!({ "name": c.author.name });
        if !c.author.url.is_empty() {
            author["url"] = serde_json::Value::String(c.author.url.clone());
        }
        feed["authors"] = serde_json::Value::Array(vec![author]);
    }
    serde_json::to_string_pretty(&feed).unwrap_or_default()
}

/// The exact shape `mnix.dev` reads from its `/api/blog` function:
/// `{ "schemaVersion": 1, "posts": [{ "title", "date", "link" }] }` with at most four posts.
pub fn portfolio_snapshot(site: &Site, limit: usize) -> String {
    let c = &site.config;
    let posts: Vec<serde_json::Value> = site
        .posts
        .iter()
        .take(limit)
        .map(|p| serde_json::json!({ "title": p.title, "date": p.date.rfc3339(), "link": c.absolute(&p.url) }))
        .collect();
    serde_json::to_string_pretty(&serde_json::json!({ "schemaVersion": 1, "posts": posts }))
        .unwrap_or_default()
}

/// Every public URL, for `/sitemap.xml`.
pub fn sitemap(site: &Site, extra_paths: &[String]) -> String {
    let c = &site.config;
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
    let mut push = |path: &str, lastmod: Option<String>| {
        out.push_str("<url><loc>");
        out.push_str(&escape::xml(&c.absolute(path)));
        out.push_str("</loc>");
        if let Some(l) = lastmod {
            out.push_str(&format!("<lastmod>{l}</lastmod>"));
        }
        out.push_str("</url>\n");
    };
    push("/", site.latest_update().map(|d| d.ymd()));
    for post in &site.posts {
        push(&post.url, Some(post.updated.unwrap_or(post.date).ymd()));
    }
    for series in site.series.iter().filter(|s| !s.posts.is_empty()) {
        let lastmod = series
            .posts
            .iter()
            .map(|&i| site.posts[i].updated.unwrap_or(site.posts[i].date))
            .max();
        push(&series.url, lastmod.map(|d| d.ymd()));
    }
    for tag in &site.tags {
        push(&tag.url, None);
    }
    for page in &site.pages {
        push(&page.url, None);
    }
    for path in extra_paths {
        push(path, None);
    }
    out.push_str("</urlset>\n");
    out
}

pub fn robots(site: &Site) -> String {
    format!(
        "User-agent: *\nAllow: /\n\nSitemap: {}\n",
        site.config.absolute("/sitemap.xml")
    )
}

/// The client-side search index. Body text is lower-cased and truncated to keep
/// the file small; titles, tags, and descriptions carry most of the signal.
pub fn search_index(site: &Site) -> String {
    let entries = site
        .posts
        .iter()
        .map(|post| IndexEntry {
            title: post.title.clone(),
            url: post.url.clone(),
            date: post.date.ymd(),
            tags: post.tags.iter().map(|t| t.name.clone()).collect(),
            series: post
                .series
                .as_deref()
                .and_then(|s| site.series_by_slug(s))
                .map(|s| s.name.clone()),
            description: post.description.clone(),
            text: {
                let lower = post.text.to_lowercase();
                lower.chars().take(4000).collect()
            },
        })
        .collect();
    serde_json::to_string(&Index {
        version: INDEX_VERSION,
        entries,
    })
    .unwrap_or_default()
}

/// Feed readers need absolute URLs. Rewrite root-relative `src`/`href` values.
fn absolutize_html(html: &str, origin: &str) -> String {
    html.replace("src=\"/", &format!("src=\"{origin}/"))
        .replace("href=\"/", &format!("href=\"{origin}/"))
}

fn mime_for(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => "image/*",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SiteConfig;
    use crate::model::{LoadOptions, SourceFile, Sources};

    fn site() -> Site {
        let config = SiteConfig::from_json(
            r#"{"title":"Journey","url":"https://j.io","postPath":"/{slug}/","author":{"name":"Mikey"}}"#,
        )
        .unwrap();
        Site::load(
            config,
            Sources {
                posts: vec![
                    SourceFile { path: "posts/a.md".into(), contents: "---\ntitle: A & B\ndate: 2026-10-21T04:15:10Z\ntags: [rust]\ncover: /img/a.png\n---\nHello ![x](/img/x.png)".into() },
                    SourceFile { path: "posts/b.md".into(), contents: "---\ntitle: B\ndate: 2026-10-01\n---\nOlder".into() },
                ],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap()
    }

    #[test]
    fn rss_matches_what_the_portfolio_parser_needs() {
        let xml = rss(&site());
        assert!(xml.contains("<title>A &amp; B</title>"));
        assert!(xml.contains("<link>https://j.io/a/</link>"));
        assert!(xml.contains("<pubDate>Wed, 21 Oct 2026 04:15:10 GMT</pubDate>"));
        assert!(xml.contains("<category>rust</category>"));
        assert!(xml.contains("<enclosure url=\"https://j.io/img/a.png\""));
        assert!(xml.contains("src=\"https://j.io/img/x.png\""));
        assert!(!xml.contains("<!DOCTYPE"));
    }

    #[test]
    fn snapshot_json_and_sitemap() {
        let snap: serde_json::Value =
            serde_json::from_str(&portfolio_snapshot(&site(), 4)).unwrap();
        assert_eq!(snap["schemaVersion"], 1);
        assert_eq!(snap["posts"][0]["link"], "https://j.io/a/");
        assert_eq!(snap["posts"][0]["date"], "2026-10-21T04:15:10Z");
        let map = sitemap(&site(), &["/search/".into()]);
        assert!(map.contains("<loc>https://j.io/tags/rust/</loc>"));
        assert!(map.contains("<loc>https://j.io/search/</loc>"));
        let feed: serde_json::Value = serde_json::from_str(&json_feed(&site())).unwrap();
        assert_eq!(feed["items"][1]["title"], "B");
        assert!(search_index(&site()).contains("\"version\":1"));
    }
}

//! Published Webmentions (story #402, ADR 0865): the approved mentions a post's canonical page
//! lists, kept in `webmentions.json` in the content folder and written only by
//! `openblog mentions` from the private inbox.
//!
//! The file holds public facts only: the post, the source address, what the source claims as its
//! title, author and date, and the day a moderator approved it. The page lists them as plain
//! text and ordinary links, with no script, image, avatar or embedded content, so it reads the
//! same without JavaScript and loads nothing from the other site. Feeds and portable copies never
//! carry them.

use serde::{Deserialize, Serialize};
use url::Url;

use crate::escape::{attr, text};
use crate::feedback_publication::{is_day, is_post_source};
use crate::webmention_inbox::{plain_text, MAX_AUTHOR_CHARS, MAX_TITLE_CHARS, MAX_URL_BYTES};

/// The file's name in the content folder.
pub const WEBMENTIONS_FILE: &str = "webmentions.json";
/// The format this release reads and writes.
pub const MENTIONS_VERSION: u32 = 1;
/// The anchor of the section on a post's page.
pub const MENTIONS_ANCHOR: &str = "ob-mentions";
/// The most mentions the file may hold.
pub const MAX_PUBLISHED_MENTIONS: usize = 5_000;
/// Said above every list: what the names and titles are, and what they are not.
pub const MENTIONS_NOTICE: &str = "Other sites that link to this post. Each title and name is as that site gives it; only the site's address was checked.";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MentionsFile {
    pub version: u32,
    pub mentions: Vec<PublicMention>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicMention {
    /// The inbox id, `m-` and 16 hex digits.
    pub id: String,
    /// The post's source path in the content folder.
    pub post: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
    /// The day a moderator approved it.
    pub approved: String,
}

impl PublicMention {
    /// The source's host, the one thing about the other site that was checked.
    pub fn host(&self) -> String {
        Url::parse(&self.source)
            .ok()
            .and_then(|url| url.host_str().map(str::to_string))
            .unwrap_or_default()
    }

    fn check(&self) -> Result<(), String> {
        let id_ok = self.id.len() == 18
            && self.id.starts_with("m-")
            && self.id[2..]
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        if !id_ok {
            return Err("id must be m- and 16 lower-case hex digits".into());
        }
        if !is_post_source(&self.post) {
            return Err("post must be a post's source path".into());
        }
        let source = Url::parse(&self.source).map_err(|_| "source must be a web address")?;
        if self.source.len() > MAX_URL_BYTES
            || !matches!(source.scheme(), "http" | "https")
            || source.host_str().is_none()
            || !source.username().is_empty()
            || source.password().is_some()
        {
            return Err("source must be an http(s) address without credentials".into());
        }
        for (name, value, limit) in [
            ("title", &self.title, MAX_TITLE_CHARS),
            ("author", &self.author, MAX_AUTHOR_CHARS),
        ] {
            if let Some(value) = value {
                if plain_text(value, limit).as_deref() != Some(value.as_str()) {
                    return Err(format!(
                        "{name} must be plain text of at most {limit} characters"
                    ));
                }
            }
        }
        if self.published.as_deref().is_some_and(|day| !is_day(day)) {
            return Err("published must be a day, YYYY-MM-DD".into());
        }
        if !is_day(&self.approved) {
            return Err("approved must be a day, YYYY-MM-DD".into());
        }
        Ok(())
    }
}

impl MentionsFile {
    /// Reads and checks the file; any problem names the item and refuses the whole file.
    pub fn from_json(text: &str) -> Result<Self, String> {
        let file: Self =
            serde_json::from_str(text).map_err(|error| format!("not a mentions file: {error}"))?;
        if file.version != MENTIONS_VERSION {
            return Err(format!("unsupported version {}", file.version));
        }
        if file.mentions.len() > MAX_PUBLISHED_MENTIONS {
            return Err(format!("more than {MAX_PUBLISHED_MENTIONS} mentions"));
        }
        let mut ids = std::collections::BTreeSet::new();
        for (index, mention) in file.mentions.iter().enumerate() {
            mention
                .check()
                .map_err(|error| format!("mention {}: {error}", index + 1))?;
            if !ids.insert(mention.id.as_str()) {
                return Err(format!("mention {}: the id is repeated", index + 1));
            }
        }
        Ok(file)
    }

    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).expect("mentions are serializable");
        text.push('\n');
        text
    }

    pub fn for_post(&self, post: &str) -> Vec<PublicMention> {
        self.mentions
            .iter()
            .filter(|mention| mention.post == post)
            .cloned()
            .collect()
    }
}

/// The section a post's canonical page shows, or nothing when it has no approved mention. Every
/// value is escaped; the links carry `rel="nofollow ugc"` so a mention lends the other site no
/// standing, and `noreferrer` so following one tells it nothing.
pub fn render_section(mentions: &[PublicMention]) -> String {
    if mentions.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "<section id=\"{MENTIONS_ANCHOR}\" class=\"ob-mentions\" aria-labelledby=\"{MENTIONS_ANCHOR}-heading\">\n<h2 id=\"{MENTIONS_ANCHOR}-heading\">Mentions</h2>\n<p class=\"ob-mentions-note\">{}</p>\n<ol class=\"ob-mentions-list\">\n",
        text(MENTIONS_NOTICE)
    );
    for mention in mentions {
        let host = mention.host();
        let label = mention.title.as_deref().unwrap_or(&host);
        out.push_str(&format!(
            "<li id=\"{}\"><a href=\"{}\" rel=\"nofollow ugc noopener noreferrer\">{}</a> <span class=\"ob-mention-host\">on {}</span>",
            attr(&mention.id),
            attr(&mention.source),
            text(label),
            text(&host)
        ));
        if let Some(author) = &mention.author {
            out.push_str(&format!(
                ", <span class=\"ob-mention-author\">by {}, as the page says</span>",
                text(author)
            ));
        }
        if let Some(day) = &mention.published {
            out.push_str(&format!(
                ", <time datetime=\"{}\">{}</time>",
                attr(day),
                text(day)
            ));
        }
        out.push_str("</li>\n");
    }
    out.push_str("</ol>\n</section>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mention() -> PublicMention {
        PublicMention {
            id: "m-0123456789abcdef".into(),
            post: "posts/hello.md".into(),
            source: "https://other.example/reply?x=1&y=2".into(),
            title: Some("<script>alert(1)</script> & more".into()),
            author: Some("Ana \"A\"".into()),
            published: Some("2026-10-01".into()),
            approved: "2026-10-29".into(),
        }
    }

    #[test]
    fn the_section_is_escaped_plain_html_with_no_script_image_or_standing() {
        let html = render_section(&[mention()]);
        assert!(
            html.contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more"),
            "{html}"
        );
        assert!(html.contains("href=\"https://other.example/reply?x=1&amp;y=2\""));
        assert!(html.contains("rel=\"nofollow ugc noopener noreferrer\""));
        assert!(html.contains("on other.example"));
        assert!(
            html.contains("by Ana &quot;A&quot;, as the page says")
                || html.contains("by Ana \"A\", as the page says")
        );
        assert!(html.contains("aria-labelledby=\"ob-mentions-heading\""));
        assert!(!html.contains("<script") && !html.contains("<img"));
        assert_eq!(render_section(&[]), "");
    }

    #[test]
    fn a_mention_without_a_title_is_named_by_its_host() {
        let html = render_section(&[PublicMention {
            title: None,
            author: None,
            published: None,
            ..mention()
        }]);
        assert!(html.contains(">other.example</a>"), "{html}");
        assert!(!html.contains("as the page says"));
    }

    #[test]
    fn the_file_is_checked_item_by_item() {
        let good = MentionsFile {
            version: 1,
            mentions: vec![mention()],
        };
        assert_eq!(MentionsFile::from_json(&good.to_json()).unwrap(), good);
        let bad = |change: fn(&mut PublicMention)| {
            let mut file = good.clone();
            change(&mut file.mentions[0]);
            MentionsFile::from_json(&file.to_json()).unwrap_err()
        };
        assert!(bad(|m| m.source = "javascript:alert(1)".into()).contains("mention 1"));
        assert!(bad(|m| m.source = "https://u:p@x.example/".into()).contains("credentials"));
        assert!(bad(|m| m.title = Some("a\u{0007}b".into())).contains("plain text"));
        assert!(bad(|m| m.post = "../x.md".into()).contains("post"));
        assert!(bad(|m| m.approved = "yesterday".into()).contains("approved"));
        assert!(bad(|m| m.id = "1".into()).contains("id"));
        let mut twice = good.clone();
        twice.mentions.push(mention());
        assert!(MentionsFile::from_json(&twice.to_json())
            .unwrap_err()
            .contains("repeated"));
        assert!(MentionsFile::from_json(r#"{"version":2,"mentions":[]}"#).is_err());
    }
}

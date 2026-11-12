//! Opt-in podcast feed generated from verified audio episodes.

use serde::{Deserialize, Serialize};

use crate::{escape, model::Site, render::OutputFile};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PodcastConfig {
    pub version: u32,
    pub title: String,
    pub description: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub category: String,
    pub explicit: bool,
    pub image: String,
}

impl PodcastConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("podcast.version must be 1".into());
        }
        for (name, value) in [
            ("title", &self.title),
            ("description", &self.description),
            ("author", &self.author),
            ("category", &self.category),
        ] {
            if value.trim().is_empty() || value.chars().any(|c| c.is_control()) {
                return Err(format!(
                    "podcast.{name} must be nonempty text without control characters"
                ));
            }
        }
        if let Some(email) = &self.email {
            let Some((local, domain)) = email.split_once('@') else {
                return Err("podcast.email must be a valid public email address".into());
            };
            if local.is_empty()
                || domain.is_empty()
                || !domain.contains('.')
                || email
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control() || "<>\"'&,;".contains(c))
                || domain.contains('@')
            {
                return Err("podcast.email must be a valid public email address".into());
            }
        }
        if !crate::landing::safe_address(&self.image, true)
            || !(self.image.starts_with('/') || self.image.starts_with("https://"))
        {
            return Err("podcast.image must be a site-relative path or HTTPS URL".into());
        }
        if self.image.starts_with("https://") {
            let image = url::Url::parse(&self.image)
                .map_err(|_| "podcast.image must be a valid HTTPS URL")?;
            if image.host_str().is_none()
                || !image.username().is_empty()
                || image.password().is_some()
                || image.fragment().is_some()
            {
                return Err("podcast.image must not contain credentials or a fragment".into());
            }
        }
        Ok(())
    }
}

/// Return the RSS feed and optional Podcasting 2.0 chapter files.
pub fn generate(site: &Site, config: &PodcastConfig) -> Result<(String, Vec<OutputFile>), String> {
    config.validate()?;
    let c = &site.config;
    let base =
        url::Url::parse(&c.url).map_err(|_| "podcast requires an absolute HTTPS site URL")?;
    if base.scheme() != "https"
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err(
            "podcast requires an absolute HTTPS site URL without credentials, query or fragment"
                .into(),
        );
    }
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\" xmlns:itunes=\"http://www.itunes.com/dtds/podcast-1.0.dtd\" xmlns:podcast=\"https://podcastindex.org/namespace/1.0\">\n<channel>\n");
    let x = escape::xml;
    out.push_str(&format!("<title>{}</title>\n<link>{}</link>\n<description>{}</description>\n<language>{}</language>\n", x(&config.title), x(&c.absolute("/")), x(&config.description), x(&c.language)));
    out.push_str(&format!(
        "<atom:link href=\"{}\" rel=\"self\" type=\"application/rss+xml\"/>\n",
        x(&c.absolute("/podcast.xml"))
    ));
    out.push_str(&format!("<itunes:author>{}</itunes:author>\n<itunes:category text=\"{}\"/>\n<itunes:explicit>{}</itunes:explicit>\n<itunes:image href=\"{}\"/>\n", x(&config.author), x(&config.category), if config.explicit { "true" } else { "false" }, x(&c.absolute(&config.image))));
    if let Some(email) = &config.email {
        out.push_str(&format!("<itunes:owner><itunes:name>{}</itunes:name><itunes:email>{}</itunes:email></itunes:owner>\n", x(&config.author), x(email)));
    }
    let mut files = Vec::new();
    for post in site.posts.iter().filter(|post| site.is_published(post)) {
        let Some(audio) = &post.audio else { continue };
        let source = audio
            .sources
            .first()
            .ok_or("podcast episode has no audio source")?;
        let link = c.absolute(&post.url);
        out.push_str(&format!("<item>\n<title>{}</title>\n<link>{}</link>\n<guid isPermaLink=\"true\">{}</guid>\n<pubDate>{}</pubDate>\n<description>{}</description>\n", x(&post.title), x(&link), x(&link), post.date.rfc2822(), x(&post.description)));
        out.push_str(&format!("<enclosure url=\"{}\" length=\"{}\" type=\"{}\"/>\n<itunes:duration>{}</itunes:duration>\n", x(&c.absolute(&source.url)), source.size_bytes, x(&source.media_type), audio.duration_seconds));
        if let Some(number) = audio.episode_number {
            out.push_str(&format!("<itunes:episode>{number}</itunes:episode>\n"));
        }
        if let Some(number) = audio.season_number {
            out.push_str(&format!("<itunes:season>{number}</itunes:season>\n"));
        }
        let (transcript, media_type) = if let Some(path) = &audio.transcript {
            (
                c.absolute(path),
                if path.to_ascii_lowercase().ends_with(".vtt") {
                    "text/vtt"
                } else {
                    "text/plain"
                },
            )
        } else {
            let heading = post
                .headings
                .iter()
                .find(|h| h.text.eq_ignore_ascii_case("transcript"))
                .ok_or_else(|| {
                    format!(
                        "{}: transcript heading cannot be linked in podcast feed",
                        post.source
                    )
                })?;
            (format!("{link}#{}", heading.id), "text/html")
        };
        out.push_str(&format!(
            "<podcast:transcript url=\"{}\" type=\"{}\"/>\n",
            x(&transcript),
            media_type
        ));
        if !audio.chapters.is_empty() {
            let path = format!("podcast-chapters/{}.json", post.slug);
            let post_url = url::Url::parse(&link)
                .map_err(|error| format!("{}: invalid episode URL: {error}", post.source))?;
            let chapters = audio
                .chapters
                .iter()
                .map(|chapter| {
                    let mut value = serde_json::json!({"startTime": chapter.time_seconds, "title": chapter.title});
                    if let Some(link) = &chapter.link {
                        let resolved = if link.starts_with('/') {
                            c.absolute(link)
                        } else {
                            post_url.join(link).map_err(|error| {
                                format!("{}: invalid chapter link: {error}", post.source)
                            })?.to_string()
                        };
                        value["url"] = serde_json::Value::String(resolved);
                    }
                    Ok(value)
                })
                .collect::<Result<Vec<_>, String>>()?;
            let json =
                serde_json::to_string(&serde_json::json!({"version":"1.2.0","chapters":chapters}))
                    .map_err(|error| error.to_string())?;
            files.push(OutputFile {
                path: path.clone(),
                contents: format!("{json}\n"),
            });
            out.push_str(&format!(
                "<podcast:chapters url=\"{}\" type=\"application/json+chapters\"/>\n",
                x(&c.absolute(&path))
            ));
        }
        out.push_str("</item>\n");
    }
    out.push_str("</channel>\n</rss>\n");
    Ok((out, files))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> PodcastConfig {
        PodcastConfig {
            version: 1,
            title: "Show".into(),
            description: "Description".into(),
            author: "Host".into(),
            email: None,
            category: "Technology".into(),
            explicit: false,
            image: "/cover.jpg".into(),
        }
    }

    #[test]
    fn optional_public_email_and_image_urls_are_validated() {
        let mut podcast = config();
        assert!(podcast.validate().is_ok());
        podcast.email = Some("show@example.com".into());
        assert!(podcast.validate().is_ok());
        for invalid in [
            "missing-at",
            "@example.com",
            "show@example",
            "a@b@c.test",
            "a b@example.com",
        ] {
            podcast.email = Some(invalid.into());
            assert!(podcast.validate().is_err(), "{invalid}");
        }
        podcast.email = None;
        for invalid in [
            "http://example.com/image.jpg",
            "https://user:pass@example.com/image.jpg",
            "https://example.com/image.jpg#fragment",
        ] {
            podcast.image = invalid.into();
            assert!(podcast.validate().is_err(), "{invalid}");
        }
    }
}

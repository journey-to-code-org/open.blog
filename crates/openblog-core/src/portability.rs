//! Destination-neutral views over one public, canonical post.

use crate::capability::CapabilityDescriptor;
use crate::config::SiteConfig;
use crate::contributor::{CreditProvenance, ResolvedCredit};
use crate::markdown::RenderOptions;
use crate::model::Post;
use crate::research::ResearchReference;
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepresentationFormat {
    Html,
    Markdown,
    Text,
}

/// A deterministic, offline view of a public post and its portable context.
///
/// The view borrows the canonical post content; selecting a representation never
/// rewrites the source or parses generated HTML.
#[derive(Debug)]
pub struct PortableProjection<'a> {
    canonical_url: String,
    base_url: String,
    source_path: &'a str,
    source_url: Option<&'a str>,
    credit_provenance: CreditProvenance,
    credits: &'a [ResolvedCredit],
    references: &'a [ResearchReference],
    capabilities: &'a [CapabilityDescriptor],
    html: &'a str,
    markdown: &'a str,
    text: &'a str,
    render_options: RenderOptions<'static>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortableHtmlOutput {
    pub html: String,
    pub capabilities: Vec<CapabilityDescriptor>,
}

impl<'a> PortableProjection<'a> {
    pub fn from_post(post: &'a Post, config: &SiteConfig) -> Result<Self, String> {
        if post.draft {
            return Err(format!(
                "{}: drafts cannot be included in a public portable projection",
                post.source
            ));
        }

        let base_url = format!("{}/", config.url.trim_end_matches('/'));
        let base = Url::parse(&base_url)
            .map_err(|_| format!("{}: site base URL is invalid", post.source))?;
        validate_http_url(&base, false)
            .map_err(|_| format!("{}: site base URL must be absolute HTTP(S)", post.source))?;

        let canonical_url = config.absolute(&post.url);
        let canonical = Url::parse(&canonical_url)
            .map_err(|_| format!("{}: canonical URL is invalid", post.source))?;
        validate_http_url(&canonical, false)
            .map_err(|_| format!("{}: canonical URL must be absolute HTTP(S)", post.source))?;

        let references = post
            .research
            .as_ref()
            .map(|research| research.references.as_slice())
            .unwrap_or_default();

        Ok(Self {
            canonical_url,
            base_url: config.url.clone(),
            source_path: &post.source,
            source_url: post.source_url.as_deref(),
            credit_provenance: post.credit_provenance,
            credits: &post.credits,
            references,
            capabilities: &post.capabilities,
            html: &post.html,
            markdown: &post.authored_markdown,
            text: &post.text,
            render_options: RenderOptions {
                smart_punctuation: config.markdown.smart_punctuation,
                lazy_images: true,
                heading_anchors: config.markdown.heading_anchors,
                embeds: false,
                recipe: post.recipe.is_some(),
                code_runner: None,
            },
        })
    }

    pub fn canonical_url(&self) -> &str {
        &self.canonical_url
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn source_path(&self) -> &str {
        self.source_path
    }

    pub fn source_url(&self) -> Option<&str> {
        self.source_url
    }

    pub fn credit_provenance(&self) -> CreditProvenance {
        self.credit_provenance
    }

    pub fn credits(&self) -> &[ResolvedCredit] {
        self.credits
    }

    pub fn authors(&self) -> impl Iterator<Item = &ResolvedCredit> {
        self.credits.iter().filter(|credit| {
            !credit.contributor.name.trim().is_empty()
                && credit.roles.iter().any(|role| role.is_author())
        })
    }

    pub fn references(&self) -> &[ResearchReference] {
        self.references
    }

    pub fn capabilities(&self) -> &[CapabilityDescriptor] {
        self.capabilities
    }

    pub fn representation(&self, format: RepresentationFormat) -> &'a str {
        match format {
            RepresentationFormat::Html => self.html,
            RepresentationFormat::Markdown => self.markdown,
            RepresentationFormat::Text => self.text,
        }
    }

    /// Render HTML from the canonical Markdown body without parsing native HTML.
    pub fn portable_html(&self) -> Result<PortableHtmlOutput, String> {
        let rendered = crate::markdown::render_portable(self.markdown, self.render_options, self)?;
        if !rendered.errors.is_empty() {
            return Err(format!(
                "{}: {}",
                self.source_path,
                rendered.errors.join("; ")
            ));
        }
        Ok(PortableHtmlOutput {
            html: rendered.html,
            capabilities: rendered.capabilities,
        })
    }

    /// Resolve an authored URL against the post or site base while rejecting
    /// executable schemes and credential-bearing HTTP(S) URLs.
    pub fn resolve_link(&self, value: &str) -> Result<String, String> {
        if value.chars().any(char::is_control) {
            return Err(format!(
                "{}: link must be non-empty and contain no control characters",
                self.source_path
            ));
        }
        let value = value.trim();
        if value.is_empty() {
            return Err(format!(
                "{}: link must be non-empty and contain no control characters",
                self.source_path
            ));
        }

        let base = Url::parse(&self.canonical_url).map_err(|_| {
            format!(
                "{}: portable projection has an invalid URL base",
                self.source_path
            )
        })?;

        let (resolved, was_absolute) = match Url::parse(value) {
            Ok(absolute) => Ok((absolute, true)),
            Err(url::ParseError::RelativeUrlWithoutBase) => {
                if value.starts_with('/') && !value.starts_with("//") {
                    Url::parse(&format!("{}{}", self.base_url.trim_end_matches('/'), value))
                        .map(|resolved| (resolved, false))
                } else {
                    base.join(value).map(|resolved| (resolved, false))
                }
            }
            Err(_) => return Err(format!("{}: link is not a valid URL", self.source_path)),
        }
        .map_err(|_| format!("{}: link is not a valid URL", self.source_path))?;

        validate_http_url(&resolved, true)
            .or_else(|_| match resolved.scheme() {
                "mailto" | "tel" if resolved.host_str().is_none() => Ok(()),
                _ => Err("link must use HTTP(S), mailto, or tel".to_string()),
            })
            .map_err(|_| {
                format!(
                    "{}: link must use HTTP(S), mailto, or tel",
                    self.source_path
                )
            })?;
        Ok(if was_absolute {
            value.to_string()
        } else {
            resolved.to_string()
        })
    }
}

fn validate_http_url(url: &Url, allow_query_and_fragment: bool) -> Result<(), String> {
    if matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && (allow_query_and_fragment || (url.query().is_none() && url.fragment().is_none()))
    {
        Ok(())
    } else {
        Err("not an absolute HTTP(S) URL".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SiteConfig;
    use crate::model::{LoadOptions, Site, SourceFile, Sources};

    fn public_post(contents: &str) -> (SiteConfig, Site) {
        let config = SiteConfig::from_json(
            r#"{"title":"T","url":"https://example.test/blog","postPath":"/{slug}/","author":{"name":"Author"}}"#,
        )
        .unwrap();
        let site = Site::load(
            config.clone(),
            Sources {
                posts: vec![SourceFile {
                    path: "posts/work.md".into(),
                    contents: contents.into(),
                }],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        (config, site)
    }

    #[test]
    fn projection_selects_existing_views_and_preserves_identity_and_attribution() {
        let (config, site) = public_post(
            "---\ntitle: Work\ndate: 2026-10-01\nprofile: research\nsourceUrl: https://origin.example/work\n---\nBody with [a reference](https://ref.example/paper).\n\n## References\n\n- [Paper](https://ref.example/paper)\n",
        );
        let post = &site.posts[0];
        let projection = PortableProjection::from_post(post, &config).unwrap();
        assert_eq!(
            projection.canonical_url(),
            "https://example.test/blog/work/"
        );
        assert_eq!(projection.base_url(), "https://example.test/blog");
        assert_eq!(projection.source_path(), "posts/work.md");
        assert_eq!(projection.source_url(), Some("https://origin.example/work"));
        assert_eq!(projection.authors().count(), 1);
        assert_eq!(projection.references().len(), 1);
        assert_eq!(
            projection.representation(RepresentationFormat::Html),
            post.html
        );
        assert_eq!(
            projection.representation(RepresentationFormat::Markdown),
            post.authored_markdown
        );
        assert_eq!(
            projection.representation(RepresentationFormat::Text),
            post.text
        );
    }

    #[test]
    fn projection_url_resolution_is_safe_and_base_path_aware() {
        let (config, site) = public_post("---\ntitle: Work\ndate: 2026-10-01\n---\nBody");
        let projection = PortableProjection::from_post(&site.posts[0], &config).unwrap();
        assert_eq!(
            projection.resolve_link("/images/é.png").unwrap(),
            "https://example.test/blog/images/%C3%A9.png"
        );
        assert_eq!(
            projection.resolve_link("../reference/").unwrap(),
            "https://example.test/blog/reference/"
        );
        assert_eq!(
            projection.resolve_link("#section").unwrap(),
            "https://example.test/blog/work/#section"
        );
        assert_eq!(
            projection.resolve_link("?view=full").unwrap(),
            "https://example.test/blog/work/?view=full"
        );
        assert!(projection.resolve_link("javascript:alert(1)").is_err());
        assert!(projection
            .resolve_link("javascript:alert(1)")
            .unwrap_err()
            .contains("posts/work.md"));
        assert!(projection
            .resolve_link("https://user:secret@example.test/path")
            .is_err());
    }

    #[test]
    fn portable_html_resolves_markdown_urls_without_changing_native_html() {
        let (config, site) = public_post(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n## Repeated heading\n\n[Parent](../reference/), ![image](/images/café.png), [section](#repeated-heading), [external](https://source.example/café?view=full#part).\n\n<details><summary>Raw HTML boundary</summary><p>Preserved.</p></details>\n",
        );
        let post = &site.posts[0];
        let native_html = post.html.clone();
        let projection = PortableProjection::from_post(post, &config).unwrap();
        let output = projection.portable_html().unwrap();

        assert!(output
            .html
            .contains("href=\"https://example.test/blog/reference/\""));
        assert!(output
            .html
            .contains("src=\"https://example.test/blog/images/caf%C3%A9.png\""));
        assert!(output
            .html
            .contains("href=\"https://example.test/blog/work/#repeated-heading\""));
        assert!(output
            .html
            .contains("href=\"https://source.example/caf%C3%A9?view=full#part\""));
        assert!(output.html.contains("<h2 id=\"repeated-heading\">"));
        assert!(output
            .html
            .contains("<details><summary>Raw HTML boundary</summary>"));
        assert!(!output.html.contains("<script type=\"module\""));
        assert_eq!(post.html, native_html);
        assert_eq!(projection.portable_html().unwrap(), output);
    }

    #[test]
    fn portable_html_errors_are_scoped_to_the_source() {
        let (config, site) =
            public_post("---\ntitle: Work\ndate: 2026-10-01\n---\n[unsafe](javascript:alert(1))\n");
        let projection = PortableProjection::from_post(&site.posts[0], &config).unwrap();
        let error = projection.portable_html().unwrap_err();
        assert!(error.contains("posts/work.md"), "{error}");
        assert!(
            error.contains("link must use HTTP(S), mailto, or tel"),
            "{error}"
        );
    }

    #[test]
    fn draft_posts_cannot_enter_public_projections() {
        let config = SiteConfig::default();
        let site = Site::load(
            config.clone(),
            Sources {
                posts: vec![SourceFile {
                    path: "posts/draft.md".into(),
                    contents: "---\ntitle: Draft\ndraft: true\n---\nPrivate".into(),
                }],
                ..Default::default()
            },
            LoadOptions {
                include_drafts: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(PortableProjection::from_post(&site.posts[0], &config)
            .unwrap_err()
            .contains("drafts cannot"));
    }
}

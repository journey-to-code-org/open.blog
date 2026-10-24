//! Destination-neutral views over one public, canonical post.

use crate::capability::CapabilityDescriptor;
use crate::config::SiteConfig;
use crate::contributor::{CreditProvenance, ResolvedCredit};
use crate::escape;
use crate::markdown::{CodeRunnerRenderOptions, PortableContext, RenderOptions};
use crate::model::{CommentsPolicy, Post};
use crate::recipe::Recipe;
use crate::research::ResearchReference;
use crate::video::VideoMetadata;
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
    title: &'a str,
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
    /// Languages the canonical page can run; `None` without a configured runner.
    runner_languages: Option<Vec<String>>,
    video: Option<&'a VideoMetadata>,
    recipe: Option<&'a Recipe>,
    /// Reader discussion the canonical page offers, when it offers any.
    participation: Option<CommentsPolicy>,
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
            title: &post.title,
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
            runner_languages: (!config.code_runner.endpoint.is_empty())
                .then(|| config.code_runner.languages.clone()),
            video: post.video.as_ref(),
            recipe: post.recipe.as_ref(),
            participation: (config.engagement.enabled
                && config.engagement.comments
                && post.comments != CommentsPolicy::Hidden
                && !config.engagement.endpoint.trim().is_empty())
            .then_some(post.comments),
        })
    }

    pub(crate) fn markdown_context(&self) -> PortableContext<'_> {
        PortableContext {
            canonical_url: &self.canonical_url,
            chapters: self.video.is_some(),
            video_id: self.video.and_then(|video| video.youtube_id.as_deref()),
        }
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
        // The canonical page's runner languages decide which fences are interactive
        // there; the portable fallback never carries the runner endpoint.
        let options = RenderOptions {
            code_runner: self.runner_languages.as_deref().map(|languages| {
                CodeRunnerRenderOptions {
                    endpoint: "",
                    languages,
                }
            }),
            ..self.render_options
        };
        let rendered = crate::markdown::render_portable(self.markdown, options, self)?;
        if !rendered.errors.is_empty() {
            return Err(format!(
                "{}: {}",
                self.source_path,
                rendered.errors.join("; ")
            ));
        }
        let mut html = String::new();
        let mut capabilities = rendered.capabilities;
        // The native page shows these beside the body, so they stay visible here.
        if let Some(video) = self.video {
            html.push_str(&video.production_notes_html());
        }
        // The native page adds the post's video beside the body; keep it as a link.
        let video_id = self.video.and_then(|video| video.youtube_id.as_deref());
        if let (Some(mut embed), Some(id)) = (
            self.video
                .and_then(|video| video.url.as_deref())
                .and_then(crate::embed::detect),
            video_id,
        ) {
            let embedded = rendered
                .html
                .split("<p class=\"ob-embed-link ob-embed-youtube\">")
                .skip(1)
                .any(|link| {
                    link.split("</p>")
                        .next()
                        .is_some_and(|link| link.contains(id))
                });
            if !embedded {
                embed.link_label = format!("{} on YouTube", self.title);
                html.push_str(&format!(
                    "<p class=\"ob-embed-link ob-embed-{}\"><a href=\"{}\">{}</a></p>\n",
                    embed.provider,
                    escape::attr(&embed.link),
                    escape::text(&embed.link_label)
                ));
            }
        }
        if let Some(recipe) = self.recipe {
            let facts = recipe.facts_html(false);
            if !facts.is_empty() {
                html.push_str(&format!(
                    "<section class=\"ob-recipe-card\" aria-label=\"Recipe summary\">\n<dl class=\"ob-recipe-facts\">{facts}</dl>\n</section>\n"
                ));
            }
        }
        html.push_str(&rendered.html);
        // Discussion stays on the canonical page: link there rather than to a
        // form that cannot work here, and never name the hosted endpoint.
        if let Some(policy) = self.participation {
            let href = escape::attr(&self.canonical_url);
            html.push_str(&if policy == CommentsPolicy::Locked {
                format!("<p class=\"ob-participation\">Comments are closed. <a href=\"{href}\">Read the discussion on the original article</a>.</p>\n")
            } else {
                format!("<p class=\"ob-participation\"><a href=\"{href}\">Join the discussion on the original article</a>.</p>\n")
            });
            capabilities.push(CapabilityDescriptor::describe(
                "comments",
                Some("ob-comments"),
            ));
        }
        Ok(PortableHtmlOutput { html, capabilities })
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

    fn portable(contents: &str) -> PortableHtmlOutput {
        let (config, site) = public_post(contents);
        PortableProjection::from_post(&site.posts[0], &config)
            .unwrap()
            .portable_html()
            .unwrap()
    }

    #[test]
    fn portable_quiz_keeps_prompt_choices_and_answer_without_controls() {
        let output = portable(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n```quiz\nWhat does `draft: true` do?\n- [ ] Publishes *privately*\n- [x] Excludes the post from public builds\n> Drafts stay in preview.\n```\n",
        );
        assert!(output.html.contains(
            "<section class=\"ob-knowledge-check\" aria-label=\"Knowledge check\">\n<div class=\"ob-quiz\">\n<p class=\"ob-quiz-prompt\"><strong>What does <code>draft: true</code> do?</strong></p>\n<ol class=\"ob-quiz-choices\" type=\"A\">\n<li>Publishes <em>privately</em></li>\n<li>Excludes the post from public builds</li>\n</ol>\n<details class=\"ob-quiz-answer\"><summary>Show answer</summary>\n<p>Answer: B. Excludes the post from public builds</p>\n<p>Drafts stay in preview.</p>\n</details>\n</div>\n</section>\n"
        ), "{}", output.html);
        for runtime in [
            "<ob-quiz",
            "<input",
            "<button",
            "data-correct",
            "data-key",
            " hidden",
        ] {
            assert!(!output.html.contains(runtime), "{runtime}: {}", output.html);
        }
        assert_eq!(output.capabilities[0].id, "knowledge-check");
    }

    #[test]
    fn portable_runnable_code_keeps_source_and_points_to_the_canonical_runner() {
        let output = portable(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n```rust runnable title=\"src/<main>.rs\" {2} showLineNumbers\nfn main() {\n    println!(\"<hi> & bye\");\n}\n```\n\n```python runnable\nprint('static')\n```\n",
        );
        assert!(output.html.contains(
            "<figure class=\"ob-code-block ob-runnable-code\"><figcaption class=\"ob-code-title\">src/&lt;main&gt;.rs</figcaption><pre><code class=\"language-rust\" data-line-numbers=\"true\" data-highlight-lines=\"2\">fn main() {\n    println!(&quot;&lt;hi&gt; &amp; bye&quot;);\n}\n</code></pre><p class=\"ob-portable-note\">Run and edit this example on <a href=\"https://example.test/blog/work/\">the original article</a>.</p></figure>\n"
        ), "{}", output.html);
        assert!(
            output
                .html
                .contains("<pre><code class=\"language-python\">print('static')\n</code></pre>"),
            "a fence the canonical page cannot run stays ordinary code: {}",
            output.html
        );
        assert_eq!(output.html.matches("ob-portable-note").count(), 1);
        for runtime in ["<ob-", "data-runnable", "data-endpoint"] {
            assert!(!output.html.contains(runtime), "{runtime}: {}", output.html);
        }
        assert_eq!(
            output
                .capabilities
                .iter()
                .map(|capability| (capability.id.as_str(), capability.native_renderer))
                .collect::<Vec<_>>(),
            [
                ("runnable-code", Some("ob-rust-playground")),
                ("runnable-code", None)
            ]
        );
    }

    #[test]
    fn portable_runnable_code_follows_the_configured_runner_without_its_endpoint() {
        let config = SiteConfig::from_json(
            r#"{"title":"T","url":"https://example.test","codeRunner":{"endpoint":"https://runner.example/execute","languages":["python"]}}"#,
        )
        .unwrap();
        let site = Site::load(
            config.clone(),
            Sources {
                posts: vec![SourceFile {
                    path: "posts/run.md".into(),
                    contents: "---\ntitle: Run\ndate: 2026-10-01\n---\n```python runnable\nprint('hi')\n```\n".into(),
                }],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        let output = PortableProjection::from_post(&site.posts[0], &config)
            .unwrap()
            .portable_html()
            .unwrap();
        assert!(output.html.contains("<figure class=\"ob-code-block ob-runnable-code\"><pre><code class=\"language-python\">print(&#39;hi&#39;)\n</code></pre><p class=\"ob-portable-note\">"), "{}", output.html);
        assert!(!output.html.contains("runner.example"), "{}", output.html);
        assert_eq!(
            output.capabilities[0].native_renderer,
            site.posts[0].capabilities[0].native_renderer
        );
    }

    #[test]
    fn portable_titled_runnable_fence_does_not_wrap_a_later_indented_block() {
        let output = portable(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n```rust runnable title=\"main.rs\"\nfn main(){}\n```\n\nText\n\n    indented code\n",
        );
        assert_eq!(output.html.matches("<figure").count(), 1, "{}", output.html);
        assert_eq!(
            output.html.matches("</figure>").count(),
            1,
            "{}",
            output.html
        );
        assert!(
            output
                .html
                .ends_with("<p>Text</p>\n<pre><code>indented code</code></pre>\n"),
            "{}",
            output.html
        );
    }

    #[test]
    fn empty_quiz_and_web_sandbox_fences_still_build() {
        // Before fences were collected whole, a fence with no text was never
        // validated; existing posts that contain one keep building.
        let (config, site) = public_post(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n```quiz\n```\n\n```web runnable\n```\n\nBody\n",
        );
        let post = &site.posts[0];
        assert!(post.html.contains("<ob-web-sandbox>"), "{}", post.html);
        let output = PortableProjection::from_post(post, &config)
            .unwrap()
            .portable_html()
            .unwrap();
        assert!(output.html.contains("<p>Body</p>"), "{}", output.html);
        assert!(!output.html.contains("<ob-"), "{}", output.html);
        // Whitespace-only text is still written content, and still validated.
        let (config, site) = public_post("---\ntitle: Work\ndate: 2026-10-01\n---\nBody\n");
        let projection = PortableProjection::from_post(&site.posts[0], &config).unwrap();
        let rendered = crate::markdown::render_portable(
            "```web runnable\n\n```\n",
            projection.render_options,
            &projection,
        )
        .unwrap();
        assert_eq!(rendered.errors.len(), 1, "{:?}", rendered.errors);
    }

    #[test]
    fn portable_web_sandbox_labels_each_source_and_omits_the_live_preview() {
        let output = portable(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n```web runnable title=\"Try it\"\nStarter notes\n---html\n<button onclick=\"alert(1)\">Hi</button>\n---css\nbutton { color: red; }\n---js\ndocument.querySelector('button').textContent = '</script>';\n```\n",
        );
        assert!(output.html.contains(
            "<figure class=\"ob-code-block ob-web-sandbox\"><figcaption class=\"ob-code-title\">Try it</figcaption><pre><code>Starter notes\n</code></pre><p class=\"ob-web-sandbox-label\">HTML</p><pre><code class=\"language-html\">&lt;button onclick=&quot;alert(1)&quot;&gt;Hi&lt;/button&gt;\n</code></pre><p class=\"ob-web-sandbox-label\">CSS</p><pre><code class=\"language-css\">button { color: red; }\n</code></pre><p class=\"ob-web-sandbox-label\">JavaScript</p><pre><code class=\"language-js\">document.querySelector(&#39;button&#39;).textContent = &#39;&lt;/script&gt;&#39;;\n</code></pre><p class=\"ob-portable-note\">Open the live preview on <a href=\"https://example.test/blog/work/\">the original article</a>.</p></figure>\n"
        ), "{}", output.html);
        assert!(!output.html.contains("<button"));
        assert!(!output.html.contains("<ob-web-sandbox"));
        assert_eq!(output.capabilities[0].id, "web-sandbox");
    }

    #[test]
    fn invalid_portable_capabilities_fail_for_the_source_and_capability() {
        let (config, site) = public_post("---\ntitle: Work\ndate: 2026-10-01\n---\nBody");
        let post = &site.posts[0];
        let native_html = post.html.clone();
        let projection = PortableProjection::from_post(post, &config).unwrap();
        let rendered = crate::markdown::render_portable(
            "```web runnable\n<p>no markers</p>\n```\n\n```quiz\nQuestion?\n- [x] Yes\n- [ ] No\n```\n",
            projection.render_options,
            &projection,
        )
        .unwrap();
        assert_eq!(rendered.errors.len(), 1, "{:?}", rendered.errors);
        assert!(rendered.errors[0].contains("`web runnable` fence"));
        assert_eq!(
            rendered
                .capabilities
                .iter()
                .map(|capability| (capability.id.as_str(), capability.diagnostics.len()))
                .collect::<Vec<_>>(),
            [("web-sandbox", 1), ("knowledge-check", 0)],
            "only the malformed capability carries a diagnostic"
        );
        assert!(
            rendered.html.contains("<p class=\"ob-quiz-prompt\">"),
            "{}",
            rendered.html
        );
        assert_eq!(post.html, native_html);
        assert_eq!(projection.portable_html().unwrap().html, "<p>Body</p>\n");
    }

    #[test]
    fn portable_callouts_keep_a_visible_title_without_styles() {
        let output =
            portable("---\ntitle: Work\ndate: 2026-10-01\n---\n> [!WARNING]\n> Hot *pan*.\n");
        assert!(output.html.contains(
            "<aside class=\"ob-callout ob-callout-warning\" role=\"note\"><p class=\"ob-callout-title\"><strong>Warning</strong></p>\n<p>Hot <em>pan</em>.</p>\n</aside>"
        ), "{}", output.html);
    }

    #[test]
    fn portable_media_embeds_become_titled_provider_links() {
        let output = portable(
            "---\ntitle: Work\ndate: 2026-10-01\n---\n[Gate of Embers — trailer](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s)\n\n<https://codepen.io/u/pen/abc>\n\n%[https://codepen.io/team/acme/pen/xyz]\n\nSee [this pen](https://codepen.io/u/pen/def) inline.\n",
        );
        assert!(output.html.contains(
            "<p class=\"ob-embed-link ob-embed-youtube\"><a href=\"https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=42s\">Gate of Embers — trailer</a> (Watch on YouTube)</p>\n"
        ), "{}", output.html);
        assert!(output.html.contains(
            "<p class=\"ob-embed-link ob-embed-codepen\"><a href=\"https://codepen.io/u/pen/abc\">See the Pen on CodePen</a></p>\n"
        ), "{}", output.html);
        assert!(
            output.html.contains(
                "<p class=\"ob-embed-link ob-embed-codepen\"><a href=\"https://codepen.io/team/acme/pen/xyz\">See the Pen on CodePen</a></p>\n"
            ),
            "Hashnode embed syntax never reaches the output raw: {}",
            output.html
        );
        assert!(!output.html.contains("%["));
        assert!(output
            .html
            .contains("See <a href=\"https://codepen.io/u/pen/def\">this pen</a> inline."));
        assert!(!output.html.contains("<iframe"));
    }

    #[test]
    fn portable_video_posts_keep_the_video_link_and_linked_chapters() {
        let output = portable(
            "---\ntitle: Gate of Embers\ndate: 2026-10-01\nprofile: video\nvideoUrl: https://youtu.be/dQw4w9WgXcQ\n---\n## Chapters\n\n00:00 The gate opens\n00:14 A warning in the *dark*\n1:02:03 Into the ruin — Ünter\n\nNarration at 00:14 stays prose.\n",
        );
        assert!(output.html.starts_with(
            "<p class=\"ob-embed-link ob-embed-youtube\"><a href=\"https://www.youtube.com/watch?v=dQw4w9WgXcQ\">Gate of Embers on YouTube</a></p>\n"
        ), "{}", output.html);
        assert!(output.html.contains(
            "<ol class=\"ob-chapters\" aria-label=\"Video chapters\">\n<li><a href=\"https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=0s\"><time datetime=\"PT0S\">00:00</time></a> The gate opens</li>\n<li><a href=\"https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=14s\"><time datetime=\"PT14S\">00:14</time></a> A warning in the <em>dark</em></li>\n<li><a href=\"https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=3723s\"><time datetime=\"PT3723S\">1:02:03</time></a> Into the ruin — Ünter</li>\n</ol>\n"
        ), "{}", output.html);
        assert!(output
            .html
            .contains("<p>Narration at 00:14 stays prose.</p>"));
    }

    #[test]
    fn portable_chapters_accept_the_admin_release_kit_grammar() {
        let output = portable(
            "---\ntitle: Episode\ndate: 2026-10-01\nprofile: video\n---\n- 00:00 Intro\n- 1:2:03 Part *two*\n\n* 00:00 Only one bullet\n\n- 00:00 Loose\n\n  More text.\n- 00:30 Item\n",
        );
        assert!(output.html.starts_with(
            "<ol class=\"ob-chapters\" aria-label=\"Video chapters\">\n<li><time datetime=\"PT0S\">00:00</time> Intro</li>\n<li><time datetime=\"PT3723S\">1:2:03</time> Part <em>two</em></li>\n</ol>\n"
        ), "{}", output.html);
        assert!(
            output
                .html
                .contains("<ul>\n<li>00:00 Only one bullet</li>\n</ul>"),
            "{}",
            output.html
        );
        assert_eq!(
            output.html.matches("ob-chapters").count(),
            1,
            "{}",
            output.html
        );
    }

    #[test]
    fn portable_video_posts_keep_their_production_notes() {
        let output = portable(
            "---\ntitle: Episode one\ndate: 2026-10-01\nprofile: video\nseasonNumber: 2\nepisodeNumber: 4\nproductionStatus: released\nproductionCredits: Writing by Mira & <Lantern>\nvideoUrl: https://youtu.be/dQw4w9WgXcQ\n---\nBody\n",
        );
        assert!(output.html.starts_with(
            "<aside class=\"ob-video-production\" aria-label=\"Video production summary\"><h2>Production notes</h2><dl><div><dt>Production</dt><dd>Season 2, episode 4</dd></div><div><dt>Status</dt><dd>released</dd></div><div><dt>Credits</dt><dd>Writing by Mira &amp; &lt;Lantern&gt;</dd></div></dl></aside>\n<p class=\"ob-embed-link ob-embed-youtube\">"
        ), "{}", output.html);
    }

    #[test]
    fn portable_recipes_keep_their_summary_facts() {
        let output = portable(
            "---\ntitle: Basil pasta\ndate: 2026-10-01\nprofile: recipe\nprep: 10\ncook: overnight\nservings: 4\ncuisine: Italian & <more>\n---\n## Ingredients\n\n- 1 cup flour\n",
        );
        assert!(output.html.starts_with(
            "<section class=\"ob-recipe-card\" aria-label=\"Recipe summary\">\n<dl class=\"ob-recipe-facts\"><div><dt>Prep</dt><dd><time datetime=\"PT10M\">10 min</time></dd></div><div><dt>Cook</dt><dd>overnight</dd></div><div><dt>Serves</dt><dd>4</dd></div><div><dt>Cuisine</dt><dd>Italian &amp; &lt;more&gt;</dd></div></dl>\n</section>\n"
        ), "{}", output.html);
        assert!(
            !output.html.contains("ob-recipe-servings"),
            "{}",
            output.html
        );
        let output = portable(
            "---\ntitle: Toast\ndate: 2026-10-01\nprofile: recipe\n---\n## Steps\n\n1. Toast.\n",
        );
        assert!(!output.html.contains("Recipe summary"), "{}", output.html);
    }

    #[test]
    fn portable_chapters_without_a_video_stay_visible_and_other_posts_keep_prose() {
        let output = portable(
            "---\ntitle: Episode\ndate: 2026-10-01\nprofile: video\n---\n00:00 Intro\n00:30 <b>Bold</b> claim\n",
        );
        assert!(
            output
                .html
                .contains("<p>00:00 Intro\n00:30 <b>Bold</b> claim</p>"),
            "inline HTML is not a chapter label: {}",
            output.html
        );
        let output = portable(
            "---\ntitle: Episode\ndate: 2026-10-01\nprofile: video\n---\n00:00 Intro\n00:30 Middle\n",
        );
        assert!(output.html.contains(
            "<ol class=\"ob-chapters\" aria-label=\"Video chapters\">\n<li><time datetime=\"PT0S\">00:00</time> Intro</li>\n<li><time datetime=\"PT30S\">00:30</time> Middle</li>\n</ol>\n"
        ), "{}", output.html);
        let output =
            portable("---\ntitle: Log\ndate: 2026-10-01\n---\n10:30 Arrived\n11:45 Summit\n");
        assert!(output.html.contains("<p>10:30 Arrived\n11:45 Summit</p>"));
    }

    #[test]
    fn portable_recipes_keep_their_sections_and_lists() {
        let output = portable(
            "---\ntitle: Basil pasta\ndate: 2026-10-01\nprofile: recipe\n---\nStory.\n\n## Ingredients\n\n- 1 cup flour\n- 2 eggs\n\n## Steps\n\n1. Mix.\n2. Bake 20 minutes.\n",
        );
        assert!(
            output.html.contains(
                "<section class=\"ob-recipe-part ob-recipe-ingredients\">\n<h2 id=\"ingredients\">"
            ),
            "{}",
            output.html
        );
        assert!(output.html.contains("<ul class=\"ob-recipe-list ob-ingredients\">\n<li>1 cup flour</li>\n<li>2 eggs</li>\n</ul>"));
        assert!(output.html.contains("<ol class=\"ob-recipe-list ob-steps\">\n<li>Mix.</li>\n<li>Bake 20 minutes.</li>\n</ol>"));
        assert!(!output.html.contains("<ob-recipe"));
    }

    fn engaged_post(comments: &str, endpoint: &str) -> PortableHtmlOutput {
        let config = SiteConfig::from_json(&format!(
            r#"{{"title":"T","url":"https://example.test","engagement":{{"enabled":true,"endpoint":"{endpoint}"}}}}"#
        ))
        .unwrap();
        let site = Site::load(
            config.clone(),
            Sources {
                posts: vec![SourceFile {
                    path: "posts/talk.md".into(),
                    contents: format!(
                        "---\ntitle: Talk\ndate: 2026-10-01\ncomments: {comments}\n---\nBody\n"
                    ),
                }],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        PortableProjection::from_post(&site.posts[0], &config)
            .unwrap()
            .portable_html()
            .unwrap()
    }

    #[test]
    fn portable_participation_links_to_the_canonical_discussion() {
        let open = engaged_post("open", "https://engage.example/api");
        assert!(open.html.ends_with(
            "<p class=\"ob-participation\"><a href=\"https://example.test/posts/talk/\">Join the discussion on the original article</a>.</p>\n"
        ), "{}", open.html);
        let locked = engaged_post("locked", "https://engage.example/api");
        assert!(locked.html.ends_with(
            "<p class=\"ob-participation\">Comments are closed. <a href=\"https://example.test/posts/talk/\">Read the discussion on the original article</a>.</p>\n"
        ), "{}", locked.html);
        for output in [&open, &locked] {
            assert!(!output.html.contains("engage.example"), "{}", output.html);
            assert!(!output.html.contains("<form"), "{}", output.html);
            assert!(!output.html.contains("<ob-comments"), "{}", output.html);
            let comments = output.capabilities.last().unwrap();
            assert_eq!(comments.id, "comments");
            assert_eq!(
                comments.portability,
                crate::capability::PortabilityLevel::CanonicalOnlyInteraction
            );
            assert_eq!(comments.fallback_renderer, Some("canonical-link"));
        }
        let hidden = engaged_post("hidden", "https://engage.example/api");
        assert_eq!(hidden.html, "<p>Body</p>\n");
        assert!(hidden.capabilities.is_empty());
        let without_backend = portable("---\ntitle: Work\ndate: 2026-10-01\n---\nBody\n");
        assert_eq!(without_backend.html, "<p>Body</p>\n");
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

//! The content model: posts, series, tags, and pages loaded from Markdown
//! sources. This module does no file I/O so it can run in WebAssembly; the
//! CLI reads the files and hands their contents over as `SourceFile`s.

use std::collections::BTreeMap;

use crate::accessibility::{self, AccessibilityFinding, DocumentAuditInput};
use crate::config::SiteConfig;
use crate::date::DateTime;
use crate::frontmatter::{self, FrontMatter};
use crate::markdown::{self, Heading, RenderOptions};
use crate::profile::{self, ProfileBehavior};
use crate::recipe::Recipe;
use crate::slug::{from_file_stem, slugify};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceFile {
    /// Path relative to the content directory, e.g. `posts/hello.md`.
    pub path: String,
    pub contents: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Sources {
    pub posts: Vec<SourceFile>,
    pub series: Vec<SourceFile>,
    pub pages: Vec<SourceFile>,
}

#[derive(Clone, Debug, Default)]
pub struct LoadOptions {
    /// Include drafts and scheduled posts (for previews and the admin editor).
    pub include_drafts: bool,
    /// Include only this source when it is a draft or scheduled post.
    /// All other posts continue to follow production visibility rules.
    pub preview_source: Option<String>,
    /// The current time. Posts dated after it are held back as scheduled.
    /// `None` disables scheduling, which keeps pure builds deterministic.
    pub now: Option<DateTime>,
}

/// A post that exists but is not public yet because its date is in the future.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scheduled {
    pub title: String,
    pub slug: String,
    pub date: DateTime,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TagRef {
    pub name: String,
    pub slug: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Post {
    pub title: String,
    pub slug: String,
    /// Site-relative URL path, e.g. `/posts/hello/`.
    pub url: String,
    pub date: DateTime,
    pub updated: Option<DateTime>,
    pub tags: Vec<TagRef>,
    /// Slug of the series this post belongs to.
    pub series: Option<String>,
    /// Explicit position within the series; otherwise posts are ordered by date.
    pub series_order: Option<u32>,
    pub cover: Option<String>,
    pub cover_alt: String,
    pub description: String,
    pub draft: bool,
    /// `<link rel="canonical">` override, for cross-posted articles.
    pub canonical: Option<String>,
    /// Where the article was first published (shown in the footer).
    pub source_url: Option<String>,
    /// Theme override for this post.
    pub theme: Option<String>,
    /// Old addresses that redirect here (`/old-slug/`), for moved or renamed posts.
    pub aliases: Vec<String>,
    pub html: String,
    pub text: String,
    pub headings: Vec<Heading>,
    pub word_count: usize,
    pub reading_minutes: u32,
    pub code_languages: Vec<String>,
    /// Resolved content profile. Unknown authored ids are preserved here and
    /// use article behavior until a matching profile is available.
    pub profile: String,
    pub(crate) profile_warnings: Vec<String>,
    pub(crate) accessibility: Vec<AccessibilityFinding>,
    /// Set for posts using the recipe profile: times, servings, ingredients, steps.
    pub recipe: Option<Recipe>,
    /// Per-post code-block overrides from front matter (`highlight`, `lineNumbers`).
    pub code_highlight: Option<bool>,
    pub code_line_numbers: Option<bool>,
    /// The source file this post came from.
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Series {
    pub name: String,
    pub slug: String,
    pub url: String,
    pub description_html: String,
    pub description_text: String,
    pub theme: Option<String>,
    pub cover: Option<String>,
    /// Listing order on the series index; lower first, then by name.
    pub order: u32,
    /// Indices into `Site::posts`, in reading order (first part first).
    pub posts: Vec<usize>,
    pub source: Option<String>,
    pub(crate) accessibility: Vec<AccessibilityFinding>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tag {
    pub name: String,
    pub slug: String,
    pub url: String,
    /// Indices into `Site::posts`, newest first.
    pub posts: Vec<usize>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    pub title: String,
    pub slug: String,
    pub url: String,
    pub description: String,
    pub html: String,
    pub text: String,
    pub headings: Vec<Heading>,
    pub theme: Option<String>,
    /// Add this page to the header navigation.
    pub nav: bool,
    pub aliases: Vec<String>,
    pub source: String,
    pub(crate) accessibility: Vec<AccessibilityFinding>,
}

#[derive(Clone, Debug)]
pub struct Site {
    pub config: SiteConfig,
    /// Published posts, newest first.
    pub posts: Vec<Post>,
    pub series: Vec<Series>,
    pub tags: Vec<Tag>,
    pub pages: Vec<Page>,
    /// Posts waiting for their publish date, soonest first.
    pub scheduled: Vec<Scheduled>,
    pub warnings: Vec<String>,
    /// Structured source findings for Accessibility Studio and CLI reporting.
    pub accessibility: Vec<AccessibilityFinding>,
    /// Known view totals per page path, supplied by the caller (for example from
    /// the analytics backup) so static builds can show counts.
    pub view_counts: BTreeMap<String, u64>,
}

impl Site {
    /// Build the site model. Hard errors (unparseable front matter, missing
    /// titles, duplicate slugs) fail the build; softer problems become warnings.
    pub fn load(
        config: SiteConfig,
        sources: Sources,
        options: LoadOptions,
    ) -> Result<Site, Vec<String>> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        let mut accessibility =
            accessibility::audit_site_language("openblog.json", &config.language);
        let render_options = RenderOptions {
            smart_punctuation: config.markdown.smart_punctuation,
            lazy_images: true,
            heading_anchors: config.markdown.heading_anchors,
            embeds: config.markdown.embeds,
            recipe: false,
        };

        // Series definitions first, so posts can reference them.
        let mut series: Vec<Series> = Vec::new();
        for file in &sources.series {
            match load_series(file, render_options) {
                Ok(s) => {
                    if series.iter().any(|existing| existing.slug == s.slug) {
                        errors.push(format!("{}: duplicate series slug `{}`", file.path, s.slug));
                    } else {
                        accessibility.extend(s.accessibility.iter().cloned());
                        series.push(s);
                    }
                }
                Err(e) => errors.push(format!("{}: {e}", file.path)),
            }
        }

        let mut posts: Vec<Post> = Vec::new();
        let mut scheduled: Vec<Scheduled> = Vec::new();
        // Every slug seen so far, including held-back posts, so a draft or
        // scheduled post cannot silently collide with a published one later.
        let mut slug_sources: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for file in &sources.posts {
            match load_post(file, &config, render_options) {
                Ok(post) => {
                    if let Some(existing) = slug_sources.get(&post.slug) {
                        errors.push(format!(
                            "{}: duplicate post slug `{}` (also in {})",
                            file.path, post.slug, existing
                        ));
                        continue;
                    }
                    slug_sources.insert(post.slug.clone(), file.path.clone());
                    warnings.extend(
                        post.profile_warnings
                            .iter()
                            .map(|warning| format!("{}: {warning}", file.path)),
                    );
                    if let Some(r) = &post.recipe {
                        // The usual mistake: **Ingredients** in bold instead of a
                        // heading, or steps written as paragraphs instead of a list.
                        for (found, what, heading) in [
                            (r.ingredients.is_empty(), "ingredients", "## Ingredients"),
                            (r.steps.is_empty(), "steps", "## Steps"),
                        ] {
                            if found {
                                warnings.push(format!(
                                    "{}: recipe has no {what}; put them in a list under a `{heading}` heading",
                                    file.path
                                ));
                            }
                        }
                    }
                    let is_preview_target =
                        options.preview_source.as_deref() == Some(post.source.as_str());
                    if post.draft && !options.include_drafts && !is_preview_target {
                        continue;
                    }
                    if !options.include_drafts
                        && !is_preview_target
                        && options.now.is_some_and(|now| post.date > now)
                    {
                        scheduled.push(Scheduled {
                            title: post.title.clone(),
                            slug: post.slug.clone(),
                            date: post.date,
                            source: post.source.clone(),
                        });
                        continue;
                    }
                    if !post.draft {
                        warnings.extend(seo_warnings(&post));
                    }
                    accessibility.extend(post.accessibility.iter().cloned());
                    posts.push(post);
                }
                Err(e) => errors.push(format!("{}: {e}", file.path)),
            }
        }
        posts.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.slug.cmp(&b.slug)));

        let mut pages: Vec<Page> = Vec::new();
        for file in &sources.pages {
            match load_page(file, render_options) {
                Ok(page) => {
                    if pages.iter().any(|p| p.slug == page.slug) {
                        errors.push(format!(
                            "{}: duplicate page slug `{}`",
                            file.path, page.slug
                        ));
                    } else {
                        accessibility.extend(page.accessibility.iter().cloned());
                        pages.push(page);
                    }
                }
                Err(e) => errors.push(format!("{}: {e}", file.path)),
            }
        }
        pages.sort_by(|a, b| a.title.cmp(&b.title));

        if !errors.is_empty() {
            return Err(errors);
        }

        // Attach posts to series, creating implicit series for unknown slugs.
        for (index, post) in posts.iter().enumerate() {
            let Some(series_slug) = &post.series else {
                continue;
            };
            let position = match series.iter().position(|s| &s.slug == series_slug) {
                Some(p) => p,
                None => {
                    warnings.push(format!(
                        "{}: series `{}` has no content/series/{}.md; using the slug as its name",
                        post.source, series_slug, series_slug
                    ));
                    series.push(Series {
                        name: humanize(series_slug),
                        slug: series_slug.clone(),
                        url: format!("/series/{series_slug}/"),
                        description_html: String::new(),
                        description_text: String::new(),
                        theme: None,
                        cover: None,
                        order: u32::MAX,
                        posts: Vec::new(),
                        source: None,
                        accessibility: Vec::new(),
                    });
                    series.len() - 1
                }
            };
            series[position].posts.push(index);
        }
        for s in &mut series {
            s.posts.sort_by(|&a, &b| {
                let (pa, pb) = (&posts[a], &posts[b]);
                match (pa.series_order, pb.series_order) {
                    (Some(x), Some(y)) => x.cmp(&y).then_with(|| pa.date.cmp(&pb.date)),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => pa.date.cmp(&pb.date),
                }
            });
            if s.cover.is_none() {
                s.cover = s.posts.iter().find_map(|&i| posts[i].cover.clone());
            }
        }
        series.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));

        // Tags.
        let mut tag_map: BTreeMap<String, Tag> = BTreeMap::new();
        for (index, post) in posts.iter().enumerate() {
            for tag in &post.tags {
                let entry = tag_map.entry(tag.slug.clone()).or_insert_with(|| Tag {
                    name: tag.name.clone(),
                    slug: tag.slug.clone(),
                    url: format!("/tags/{}/", tag.slug),
                    posts: Vec::new(),
                });
                entry.posts.push(index);
            }
        }
        let mut tags: Vec<Tag> = tag_map.into_values().collect();
        tags.sort_by(|a, b| {
            b.posts
                .len()
                .cmp(&a.posts.len())
                .then_with(|| a.name.cmp(&b.name))
        });

        if !posts.is_empty() {
            if config.author.name.trim().is_empty() {
                warnings.push(
                    "openblog.json: author.name is empty; add the public author name used in bylines and structured data"
                        .into(),
                );
            }
            if config.author.url.trim().is_empty() {
                warnings.push(
                    "openblog.json: author.url is empty; link the byline to an author or About page to establish authorship"
                        .into(),
                );
            }
        }

        scheduled.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.slug.cmp(&b.slug)));
        Ok(Site {
            config,
            posts,
            series,
            tags,
            pages,
            scheduled,
            warnings,
            accessibility,
            view_counts: BTreeMap::new(),
        })
    }

    pub fn series_by_slug(&self, slug: &str) -> Option<&Series> {
        self.series.iter().find(|s| s.slug == slug)
    }

    pub fn tag_by_slug(&self, slug: &str) -> Option<&Tag> {
        self.tags.iter().find(|t| t.slug == slug)
    }

    /// The theme a post renders with: its own override, then its series', then the site's.
    pub fn theme_for_post<'a>(&'a self, post: &'a Post) -> &'a str {
        if let Some(theme) = &post.theme {
            return theme;
        }
        if let Some(series) = post.series.as_deref().and_then(|s| self.series_by_slug(s)) {
            if let Some(theme) = &series.theme {
                return theme;
            }
        }
        &self.config.theme
    }

    pub fn theme_for_series<'a>(&'a self, series: &'a Series) -> &'a str {
        series.theme.as_deref().unwrap_or(&self.config.theme)
    }

    pub fn theme_for_page<'a>(&'a self, page: &'a Page) -> &'a str {
        page.theme.as_deref().unwrap_or(&self.config.theme)
    }

    /// Every theme name any page of the site uses.
    pub fn used_themes(&self) -> Vec<String> {
        let mut names = vec![self.config.theme.clone()];
        for post in &self.posts {
            let t = self.theme_for_post(post).to_string();
            if !names.contains(&t) {
                names.push(t);
            }
        }
        for series in &self.series {
            let t = self.theme_for_series(series).to_string();
            if !names.contains(&t) {
                names.push(t);
            }
        }
        for page in &self.pages {
            let t = self.theme_for_page(page).to_string();
            if !names.contains(&t) {
                names.push(t);
            }
        }
        names
    }

    /// Previous (older) and next (newer) post within the same series.
    pub fn series_neighbors(&self, post_index: usize) -> (Option<&Post>, Option<&Post>) {
        let post = &self.posts[post_index];
        let Some(series) = post.series.as_deref().and_then(|s| self.series_by_slug(s)) else {
            return (None, None);
        };
        let Some(pos) = series.posts.iter().position(|&i| i == post_index) else {
            return (None, None);
        };
        let prev = pos.checked_sub(1).map(|p| &self.posts[series.posts[p]]);
        let next = series.posts.get(pos + 1).map(|&i| &self.posts[i]);
        (prev, next)
    }

    /// When the next scheduled post becomes public, if any.
    pub fn next_scheduled(&self) -> Option<DateTime> {
        self.scheduled.first().map(|s| s.date)
    }

    /// Posts most related to `index`: shared tags count double, the same series
    /// counts most, and ties go to newer posts. Only posts with some overlap
    /// are returned, so unrelated posts never pad the list.
    pub fn related(&self, index: usize, limit: usize) -> Vec<usize> {
        if limit == 0 {
            return Vec::new();
        }
        let post = &self.posts[index];
        let mut scored: Vec<(u32, usize)> = self
            .posts
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != index)
            .map(|(i, other)| {
                let shared_tags = other
                    .tags
                    .iter()
                    .filter(|t| post.tags.iter().any(|p| p.slug == t.slug))
                    .count() as u32;
                let same_series = u32::from(post.series.is_some() && post.series == other.series);
                (shared_tags * 2 + same_series * 3, i)
            })
            .filter(|(score, _)| *score > 0)
            .collect();
        // `posts` is newest first, so a smaller index is newer.
        scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        scored.into_iter().take(limit).map(|(_, i)| i).collect()
    }

    pub fn latest_update(&self) -> Option<DateTime> {
        self.posts.iter().map(|p| p.updated.unwrap_or(p.date)).max()
    }
}

fn seo_warnings(post: &Post) -> Vec<String> {
    let mut warnings = Vec::new();
    let title_len = post.title.chars().count();
    let description_len = post.description.chars().count();
    if title_len > 70 {
        warnings.push(format!(
            "{}: title is {title_len} characters; consider a more concise, descriptive search title",
            post.source
        ));
    }
    if description_len < 50 {
        warnings.push(format!(
            "{}: description is only {description_len} characters; summarize the answer and why it is useful",
            post.source
        ));
    } else if description_len > 180 {
        warnings.push(format!(
            "{}: description is {description_len} characters; search and social previews may truncate it",
            post.source
        ));
    }
    if post.cover.is_some() && post.cover_alt.trim().is_empty() {
        warnings.push(format!(
            "{}: cover image has no `coverAlt`; describe the meaningful image content",
            post.source
        ));
    }
    if post.tags.is_empty() {
        warnings.push(format!(
            "{}: post has no tags; add at least one specific topic",
            post.source
        ));
    }
    if !post.text.trim().is_empty()
        && !post
            .headings
            .iter()
            .any(|heading| matches!(heading.level, 2 | 3))
    {
        warnings.push(format!(
            "{}: post has no H2 or H3 sections; use descriptive headings when the article covers multiple ideas",
            post.source
        ));
    }
    warnings
}

fn first<'a>(fm: &'a FrontMatter, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| fm.get(k))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn file_stem(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(name)
}

fn optional_string(value: Option<&str>) -> Option<String> {
    value.map(str::to_string).filter(|v| !v.is_empty())
}

/// Parse one post file.
pub fn load_post(
    file: &SourceFile,
    config: &SiteConfig,
    options: RenderOptions,
) -> Result<Post, String> {
    let doc = frontmatter::parse(&file.contents)?;
    let fm = &doc.front_matter;
    let profile = profile::resolve(fm);
    let is_recipe = profile.behavior == ProfileBehavior::Recipe;
    let rendered = markdown::render(
        &doc.body,
        RenderOptions {
            recipe: is_recipe,
            ..options
        },
    );
    if !rendered.errors.is_empty() {
        return Err(rendered.errors.join("; "));
    }
    let recipe = if is_recipe {
        let mut r = Recipe::from_front_matter(
            fm,
            rendered.recipe_ingredients.clone(),
            rendered.recipe_steps.clone(),
        );
        r.anchor = rendered.recipe_anchor.clone();
        Some(r)
    } else {
        None
    };

    let title = match first(fm, &["title"]) {
        Some(t) => t.to_string(),
        None => rendered
            .headings
            .iter()
            .find(|h| h.level == 1)
            .map(|h| h.text.clone())
            .ok_or("post needs a `title` in its front matter (or a leading # heading)")?,
    };
    let slug = first(fm, &["slug"])
        .map(slugify)
        .unwrap_or_else(|| from_file_stem(file_stem(&file.path)));
    if slug.is_empty() {
        return Err("could not derive a slug; add `slug:` to the front matter".into());
    }
    let draft = fm.get_bool("draft").unwrap_or(false)
        || first(fm, &["status"]).is_some_and(|s| s.eq_ignore_ascii_case("draft"));
    let date = match first(fm, &["date", "published", "publishedAt", "pubDate"]) {
        Some(raw) => DateTime::parse(raw)
            .ok_or_else(|| format!("unrecognised date `{raw}` (use YYYY-MM-DD or RFC 3339)"))?,
        None if draft => DateTime::from_unix(0),
        None => return Err("post needs a `date` (YYYY-MM-DD or RFC 3339)".into()),
    };
    let updated = match first(fm, &["updated", "lastmod", "modified", "updatedAt"]) {
        Some(raw) => {
            Some(DateTime::parse(raw).ok_or_else(|| format!("unrecognised updated date `{raw}`"))?)
        }
        None => None,
    };
    let tags: Vec<TagRef> = {
        let mut seen = Vec::new();
        let mut out = Vec::new();
        for name in fm
            .get_list("tags")
            .into_iter()
            .chain(fm.get_list("categories"))
        {
            let name = name.trim().to_string();
            let tag_slug = crate::slug::limit(&slugify(&name), 64);
            if name.is_empty() || tag_slug.is_empty() || seen.contains(&tag_slug) {
                continue;
            }
            seen.push(tag_slug.clone());
            out.push(TagRef {
                name,
                slug: tag_slug,
            });
        }
        out
    };
    let series = first(fm, &["series"])
        .map(slugify)
        .filter(|s| !s.is_empty());
    let series_order = fm
        .get_u32("seriesOrder")
        .or_else(|| fm.get_u32("series_order"))
        .or_else(|| fm.get_u32("part"));
    let description = first(fm, &["description", "summary", "brief", "excerpt"])
        .map(str::to_string)
        .unwrap_or_else(|| markdown::excerpt(&rendered.text, 180));
    let authored_cover = optional_string(first(fm, &["cover", "image", "coverImage", "hero"]));
    let cover = authored_cover.clone().or(rendered.first_image.clone());
    let cover_alt = first(fm, &["coverAlt", "imageAlt", "cover_alt"])
        .unwrap_or("")
        .to_string();
    let accessibility = accessibility::audit_document(DocumentAuditInput {
        path: &file.path,
        markdown: &doc.body,
        body_line: doc.body_line,
        embeds_enabled: options.embeds,
        cover_alt: authored_cover.as_ref().map(|_| cover_alt.as_str()),
    });

    Ok(Post {
        url: config.post_url(&slug),
        title,
        slug,
        date,
        updated,
        tags,
        series,
        series_order,
        cover,
        cover_alt,
        description,
        draft,
        canonical: optional_string(first(fm, &["canonical", "canonicalUrl", "canonical_url"])),
        source_url: optional_string(first(
            fm,
            &["sourceUrl", "source_url", "hashnodeUrl", "originalUrl"],
        )),
        theme: optional_string(first(fm, &["theme"])),
        aliases: aliases(fm)?,
        html: rendered.html,
        text: rendered.text,
        headings: rendered.headings,
        word_count: rendered.word_count,
        reading_minutes: markdown::reading_minutes(rendered.word_count),
        code_languages: rendered.code_languages,
        profile: profile.id,
        profile_warnings: profile.warnings,
        accessibility,
        recipe,
        code_highlight: fm
            .get_bool("highlight")
            .or_else(|| fm.get_bool("codeHighlighting")),
        code_line_numbers: fm
            .get_bool("lineNumbers")
            .or_else(|| fm.get_bool("showLineNumbers")),
        source: file.path.clone(),
    })
}

fn load_series(file: &SourceFile, options: RenderOptions) -> Result<Series, String> {
    let doc = frontmatter::parse(&file.contents)?;
    let fm = &doc.front_matter;
    let rendered = markdown::render(&doc.body, options);
    if !rendered.errors.is_empty() {
        return Err(rendered.errors.join("; "));
    }
    let stem = file_stem(&file.path);
    let slug = first(fm, &["slug"])
        .map(slugify)
        .unwrap_or_else(|| slugify(stem));
    let name = first(fm, &["name", "title"])
        .map(str::to_string)
        .unwrap_or_else(|| humanize(&slug));
    let accessibility = accessibility::audit_document(DocumentAuditInput {
        path: &file.path,
        markdown: &doc.body,
        body_line: doc.body_line,
        embeds_enabled: options.embeds,
        cover_alt: None,
    });
    Ok(Series {
        url: format!("/series/{slug}/"),
        name,
        slug,
        description_html: rendered.html,
        description_text: first(fm, &["description"])
            .map(str::to_string)
            .unwrap_or_else(|| markdown::excerpt(&rendered.text, 200)),
        theme: optional_string(first(fm, &["theme"])),
        cover: optional_string(first(fm, &["cover", "image"])),
        order: fm.get_u32("order").unwrap_or(1000),
        posts: Vec::new(),
        source: Some(file.path.clone()),
        accessibility,
    })
}

fn load_page(file: &SourceFile, options: RenderOptions) -> Result<Page, String> {
    let doc = frontmatter::parse(&file.contents)?;
    let fm = &doc.front_matter;
    let rendered = markdown::render(&doc.body, options);
    if !rendered.errors.is_empty() {
        return Err(rendered.errors.join("; "));
    }
    let stem = file_stem(&file.path);
    let slug = first(fm, &["slug"])
        .map(slugify)
        .unwrap_or_else(|| slugify(stem));
    let title = match first(fm, &["title"]) {
        Some(t) => t.to_string(),
        None => rendered
            .headings
            .iter()
            .find(|h| h.level == 1)
            .map(|h| h.text.clone())
            .unwrap_or_else(|| humanize(&slug)),
    };
    let accessibility = accessibility::audit_document(DocumentAuditInput {
        path: &file.path,
        markdown: &doc.body,
        body_line: doc.body_line,
        embeds_enabled: options.embeds,
        cover_alt: None,
    });
    Ok(Page {
        url: format!("/{slug}/"),
        title,
        slug,
        description: first(fm, &["description"])
            .map(str::to_string)
            .unwrap_or_else(|| markdown::excerpt(&rendered.text, 180)),
        html: rendered.html,
        text: rendered.text,
        headings: rendered.headings,
        theme: optional_string(first(fm, &["theme"])),
        nav: fm.get_bool("nav").unwrap_or(false),
        aliases: aliases(fm)?,
        source: file.path.clone(),
        accessibility,
    })
}

/// Normalise `aliases:` (or `redirectFrom:`) to `/path/` form and reject
/// anything that is not a site path.
fn aliases(fm: &FrontMatter) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for raw in fm
        .get_list("aliases")
        .into_iter()
        .chain(fm.get_list("redirectFrom"))
        .chain(fm.get_list("redirect_from"))
    {
        let value = raw.trim();
        if value.is_empty() {
            continue;
        }
        if value.contains("://")
            || value.contains("..")
            || value.contains(['?', '#', '\\'])
            || value.len() > 200
        {
            return Err(format!(
                "alias `{value}` must be a site path like /old-slug/"
            ));
        }
        let trimmed = value.trim_matches('/');
        if trimmed.is_empty() {
            return Err("an alias cannot be the site root".into());
        }
        let normalised = format!("/{trimmed}/");
        if !out.contains(&normalised) {
            out.push(normalised);
        }
    }
    Ok(out)
}

/// `rust-game-dev` -> `Rust Game Dev`
pub fn humanize(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(path: &str, body: &str) -> SourceFile {
        SourceFile {
            path: path.into(),
            contents: body.into(),
        }
    }

    fn site(sources: Sources) -> Site {
        let config = SiteConfig::from_json(
            r#"{"title":"T","url":"https://t.dev","theme":"base","postPath":"/{slug}/"}"#,
        )
        .unwrap();
        Site::load(config, sources, LoadOptions::default()).unwrap()
    }

    #[test]
    fn loads_posts_series_and_tags() {
        let s = site(Sources {
            posts: vec![
                post("posts/2026-10-21-second.md", "---\ntitle: Second\ndate: 2026-10-21\ntags: [Rust, WASM]\nseries: guide\n---\nBody two"),
                post("posts/first.md", "---\ntitle: First\ndate: 2026-10-01T10:00:00Z\ntags: [rust]\nseries: guide\ncover: /c.png\n---\nBody one"),
                post("posts/draft.md", "---\ntitle: Draft\ndraft: true\n---\nnot yet"),
            ],
            series: vec![post("series/guide.md", "---\nname: The Guide\ntheme: paper\n---\nAbout the guide")],
            pages: vec![post("pages/about.md", "---\ntitle: About\nnav: true\n---\nHi")],
        });
        assert_eq!(s.posts.len(), 2);
        assert_eq!(s.posts[0].slug, "second");
        assert_eq!(s.posts[0].url, "/second/");
        assert_eq!(s.tags[0].name, "Rust");
        assert_eq!(s.tags[0].posts.len(), 2);
        let guide = s.series_by_slug("guide").unwrap();
        assert_eq!(guide.name, "The Guide");
        assert_eq!(guide.posts, vec![1, 0]);
        assert_eq!(guide.cover.as_deref(), Some("/c.png"));
        assert_eq!(s.theme_for_post(&s.posts[0]), "paper");
        assert_eq!(s.used_themes(), vec!["base", "paper"]);
        let (prev, next) = s.series_neighbors(0);
        assert_eq!(prev.unwrap().slug, "first");
        assert!(next.is_none());
        assert!(s.pages[0].nav);
    }

    #[test]
    fn aliases_are_normalised_and_validated() {
        let s = site(Sources {
            posts: vec![post("posts/a.md", "---\ntitle: A\ndate: 2026-01-01\naliases: [old-a, /2024/03/old-a/, /old-a/]\n---\nx")],
            pages: vec![post("pages/p.md", "---\ntitle: P\nredirectFrom:\n  - /about-me/\n---\nx")],
            ..Default::default()
        });
        assert_eq!(s.posts[0].aliases, vec!["/old-a/", "/2024/03/old-a/"]);
        assert_eq!(s.pages[0].aliases, vec!["/about-me/"]);
        let bad = Site::load(
            SiteConfig::default(),
            Sources { posts: vec![post("posts/b.md", "---\ntitle: B\ndate: 2026-01-01\naliases: [https://elsewhere.example/x]\n---\nx")], ..Default::default() },
            LoadOptions::default(),
        )
        .unwrap_err();
        assert!(bad[0].contains("alias"));
    }

    #[test]
    fn invalid_quizzes_fail_site_validation() {
        let errors = Site::load(
            SiteConfig::default(),
            Sources {
                posts: vec![post(
                    "posts/lesson.md",
                    "---\ntitle: Lesson\ndate: 2026-01-01\n---\n```quiz\nQuestion\n- [ ] A\n- [ ] B\n```\n",
                )],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap_err();
        assert!(
            errors[0].contains("exactly one correct choice"),
            "{errors:?}"
        );
    }

    #[test]
    fn related_posts_rank_by_series_and_shared_tags() {
        let s = site(Sources {
            posts: vec![
                post(
                    "posts/a.md",
                    "---\ntitle: A\ndate: 2026-04-01\ntags: [rust, wasm]\nseries: s\n---\nx",
                ),
                post(
                    "posts/b.md",
                    "---\ntitle: B\ndate: 2026-03-01\ntags: [rust]\nseries: s\n---\nx",
                ),
                post(
                    "posts/c.md",
                    "---\ntitle: C\ndate: 2026-02-01\ntags: [rust, wasm]\n---\nx",
                ),
                post(
                    "posts/d.md",
                    "---\ntitle: D\ndate: 2026-01-01\ntags: [cooking]\n---\nx",
                ),
                post(
                    "posts/e.md",
                    "---\ntitle: E\ndate: 2025-12-01\ntags: [rust]\n---\nx",
                ),
            ],
            ..Default::default()
        });
        let names = |ids: Vec<usize>| {
            ids.iter()
                .map(|&i| s.posts[i].title.as_str())
                .collect::<Vec<_>>()
        };
        // A: B shares series + rust (5), C shares rust + wasm (4), E shares rust (2); D nothing.
        assert_eq!(names(s.related(0, 10)), vec!["B", "C", "E"]);
        assert_eq!(names(s.related(0, 1)), vec!["B"]);
        assert!(
            s.related(3, 10).is_empty(),
            "no overlap means no related posts"
        );
        assert!(s.related(0, 0).is_empty());
    }

    #[test]
    fn future_dated_posts_are_held_back_until_their_time() {
        let config =
            SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","postPath":"/{slug}/"}"#)
                .unwrap();
        let sources = || Sources {
            posts: vec![
                post("posts/now.md", "---\ntitle: Now\ndate: 2026-10-01\n---\nx"),
                post(
                    "posts/later.md",
                    "---\ntitle: Later\ndate: 2026-12-25T09:00:00Z\nseries: s\n---\ny",
                ),
                post(
                    "posts/later2.md",
                    "---\ntitle: Later 2\ndate: 2026-11-30\n---\nz",
                ),
            ],
            series: vec![post("series/s.md", "---\nname: S\n---\nabout")],
            ..Default::default()
        };
        let now = DateTime::parse("2026-10-22T00:00:00Z").unwrap();
        let s = Site::load(
            config.clone(),
            sources(),
            LoadOptions {
                include_drafts: false,
                now: Some(now),
                preview_source: None,
            },
        )
        .unwrap();
        assert_eq!(s.posts.len(), 1);
        assert_eq!(
            s.scheduled
                .iter()
                .map(|x| x.slug.as_str())
                .collect::<Vec<_>>(),
            vec!["later2", "later"]
        );
        assert_eq!(s.next_scheduled().unwrap().ymd(), "2026-11-30");
        assert!(s.series_by_slug("s").unwrap().posts.is_empty());
        // Once the date passes, the same sources publish.
        let later = DateTime::parse("2026-12-26T00:00:00Z").unwrap();
        let s = Site::load(
            config.clone(),
            sources(),
            LoadOptions {
                include_drafts: false,
                now: Some(later),
                preview_source: None,
            },
        )
        .unwrap();
        assert_eq!(s.posts.len(), 3);
        assert!(s.scheduled.is_empty());
        // Previews include everything; no clock means no scheduling.
        let s = Site::load(
            config.clone(),
            sources(),
            LoadOptions {
                include_drafts: true,
                now: Some(now),
                preview_source: None,
            },
        )
        .unwrap();
        assert_eq!(s.posts.len(), 3);
        let s = Site::load(config, sources(), LoadOptions::default()).unwrap();
        assert_eq!(s.posts.len(), 3);
    }

    #[test]
    fn scheduled_posts_still_reserve_their_slug() {
        let config = SiteConfig::default();
        let now = DateTime::parse("2026-10-22").unwrap();
        let err = Site::load(
            config,
            Sources {
                posts: vec![
                    post(
                        "posts/a.md",
                        "---\ntitle: A\nslug: same\ndate: 2030-01-01\n---\nx",
                    ),
                    post(
                        "posts/b.md",
                        "---\ntitle: B\nslug: same\ndate: 2026-01-01\n---\ny",
                    ),
                ],
                ..Default::default()
            },
            LoadOptions {
                include_drafts: false,
                now: Some(now),
                preview_source: None,
            },
        )
        .unwrap_err();
        assert!(err[0].contains("duplicate post slug"));
    }

    #[test]
    fn missing_series_file_is_a_warning_and_errors_are_collected() {
        let s = site(Sources {
            posts: vec![post(
                "posts/a.md",
                "---\ntitle: A\ndate: 2026-01-01\nseries: Mystery Series\n---\nx",
            )],
            ..Default::default()
        });
        assert_eq!(s.series[0].slug, "mystery-series");
        assert_eq!(s.series[0].name, "Mystery Series");
        assert!(s
            .warnings
            .iter()
            .any(|warning| warning.contains("has no content/series")));

        let config = SiteConfig::default();
        let err = Site::load(
            config,
            Sources {
                posts: vec![
                    post("posts/bad.md", "---\ntitle: No date\n---\nx"),
                    post("posts/worse.md", "---\ndate: 2026-01-01\n---\nno title"),
                ],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap_err();
        assert_eq!(err.len(), 2);
    }

    #[test]
    fn published_posts_get_actionable_seo_warnings() {
        let config =
            SiteConfig::from_json(r#"{"author":{"name":"Alex","url":"/about/"}}"#).unwrap();
        let s = Site::load(
            config,
            Sources {
                posts: vec![post(
                    "posts/short.md",
                    "---\ntitle: Short\ndate: 2026-01-01\ncover: /cover.jpg\n---\nTiny.",
                )],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        assert!(s
            .warnings
            .iter()
            .any(|warning| warning.contains("description is only")));
        assert!(s
            .warnings
            .iter()
            .any(|warning| warning.contains("coverAlt")));
    }
}

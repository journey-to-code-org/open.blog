//! # openblog-core
//!
//! Everything that turns a folder of Markdown into a blog, with no file or
//! network access so the same code runs natively (the `openblog` CLI) and in
//! the browser (the `openblog-wasm` package):
//!
//! - [`frontmatter`]: a small YAML-subset parser for post metadata
//! - [`markdown`]: CommonMark + GFM rendering with heading ids, reading time, excerpts
//! - [`model`]: posts, series, tags, and pages
//! - [`theme`]: design tokens in JSON, emitted as CSS custom properties, with inheritance
//! - [`render`]: semantic HTML pages built from native elements and web components
//! - [`feeds`]: RSS 2.0, JSON Feed, sitemap, and the latest-posts snapshot
//! - [`search`]: a small ranked search over a JSON index
//! - [`source_library`]: private research sources with stable, versioned identities
//! - [`research_notes`]: private passages and research notes that point into the source library
//! - [`research_bundle`]: versioned portable export and dry-run import of that notebook, and the structural check build guards use
//! - [`research_search`]: deterministic search, filters and backlinks over that private notebook
//! - [`source_interchange`]: dry-run CSL JSON import and deterministic CSL JSON / BibTeX export
//! - [`citations`]: the opt-in `[@key, locator]` syntax, its resolver and CSL citation items
//! - [`bibliography`]: opt-in publication of citations as numbered notes or a bibliography
//! - [`citation_review`]: offline syntax, resolution, completeness and location checks of citations

pub mod accessibility;
pub mod approval;
pub mod arrangement;
pub mod assembly;
pub mod assistant_guide;
pub mod bibliography;
pub mod capability;
pub mod citation_review;
pub mod citations;
pub mod collaboration;
pub mod config;
pub mod contributor;
pub mod date;
pub mod draft;
pub mod embed;
pub mod escape;
pub mod feeds;
pub mod field_journal;
pub mod frontmatter;
pub mod invitation;
pub mod knowledge_atlas;
pub mod markdown;
pub mod members;
pub mod model;
pub mod portability;
pub mod preview;
pub mod profile;
mod raw_html;
pub mod recipe;
pub mod reflection;
pub mod render;
pub mod research;
pub mod research_bundle;
pub mod research_notes;
pub mod research_search;
pub mod search;
pub mod shared_series;
pub mod shared_source;
pub mod slug;
pub mod source_interchange;
pub mod source_library;
pub mod synthesis;
pub mod theme;
pub mod video;

pub use config::SiteConfig;
pub use date::DateTime;
pub use model::{LoadOptions, Page, Post, Scheduled, Series, Site, SourceFile, Sources, Tag};
pub use render::{generate, generate_document, social_metadata, OutputFile, SocialMetadata};
pub use theme::{Theme, ThemeFile, ThemeSet};

/// Classify a content file path into the source bucket it belongs to.
pub fn classify_source(relative_path: &str) -> Option<SourceKind> {
    let normalized = relative_path.replace('\\', "/");
    if normalized.ends_with(".credits.json") {
        let first = normalized.split('/').next()?;
        return match first {
            "posts" => Some(SourceKind::PostCredits),
            _ if !normalized.contains('/') => Some(SourceKind::PostCredits),
            _ => None,
        };
    }
    if !normalized.ends_with(".md") && !normalized.ends_with(".markdown") {
        return None;
    }
    let first = normalized.split('/').next()?;
    match first {
        "posts" => Some(SourceKind::Post),
        "series" => Some(SourceKind::Series),
        "pages" => Some(SourceKind::Page),
        // Loose Markdown files at the content root are posts, so a folder of
        // exported articles works with no restructuring.
        _ if !normalized.contains('/') => Some(SourceKind::Post),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    Post,
    PostCredits,
    Series,
    Page,
}

impl Sources {
    /// Add a file to the right bucket based on its path. Returns `false` for
    /// files that are not content (images, READMEs, nested folders).
    pub fn add(&mut self, file: SourceFile) -> bool {
        match classify_source(&file.path) {
            Some(SourceKind::Post) => self.posts.push(file),
            Some(SourceKind::PostCredits) => self.credits.push(file),
            Some(SourceKind::Series) => self.series.push(file),
            Some(SourceKind::Page) => self.pages.push(file),
            None => return false,
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_paths() {
        assert_eq!(classify_source("posts/a.md"), Some(SourceKind::Post));
        assert_eq!(classify_source("posts\\deep\\a.md"), Some(SourceKind::Post));
        assert_eq!(classify_source("series/x.md"), Some(SourceKind::Series));
        assert_eq!(
            classify_source("pages/about.markdown"),
            Some(SourceKind::Page)
        );
        assert_eq!(classify_source("loose.md"), Some(SourceKind::Post));
        assert_eq!(
            classify_source("posts/a.credits.json"),
            Some(SourceKind::PostCredits)
        );
        assert_eq!(classify_source("posts/a.portability.json"), None);
        assert_eq!(
            classify_source("loose.credits.json"),
            Some(SourceKind::PostCredits)
        );
        assert_eq!(classify_source("pages/a.credits.json"), None);
        assert_eq!(classify_source("posts/README.txt"), None);
        assert_eq!(classify_source("other/x.md"), None);
    }
}

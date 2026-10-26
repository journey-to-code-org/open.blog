//! Context links in a post (ADR 0122, ADR 0123): links to an atlas entry's
//! page (`/atlas/<id>/`) or a comparison's page (`/comparisons/<id>/`), and
//! whether the next build publishes the page each one names.
//!
//! This is the `context-link` check of the pre-publication review. It reads
//! only the post's Markdown and a lookup of what the next build publishes; it
//! never reads private research itself, and its messages name the address
//! and the id the link carries, never a label, note or excerpt. A link to a
//! page that will not exist is a gap to repair, not a privacy failure: the
//! address is the author's own text in the post, so nothing here refuses.

use pulldown_cmark::{Event, Parser, Tag};

use crate::atlas_publication::ATLAS_URL;
use crate::comparison_publication::COMPARISONS_URL;

/// What kind of page a context link names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ContextKind {
    /// An atlas entry's page, `/atlas/<id>/`.
    AtlasEntry,
    /// A comparison's page, `/comparisons/<id>/`.
    Comparison,
}

/// One link in the post to a context page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextLink {
    pub kind: ContextKind,
    /// The entry or alignment id the address names.
    pub id: String,
    /// The address exactly as written in the post.
    pub href: String,
    /// One-based line of the link in the post's source document.
    pub line: usize,
}

/// Why the next build does not publish the page a context link names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextGap {
    /// The site does not publish its Knowledge Atlas or its comparisons.
    NotPublishing,
    /// No atlas entry or alignment has the id.
    Unknown,
    /// The entry or alignment exists but is not approved.
    NotApproved,
    /// The alignment is approved, but the comparison projection refuses it as it stands.
    NotProjected,
}

/// A context link whose page the next build does not publish.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextLinkFinding {
    pub link: ContextLink,
    pub gap: ContextGap,
    pub message: String,
    pub repair: String,
}

/// The id a root-relative context address names, without any query or
/// fragment, or `None` for any other address. Only one plain path segment of
/// lowercase letters, digits and hyphens is an id.
pub fn parse_context_href(href: &str) -> Option<(ContextKind, String)> {
    let path = href.split(['#', '?']).next().unwrap_or_default();
    let (kind, rest) = if let Some(rest) = path.strip_prefix(ATLAS_URL) {
        (ContextKind::AtlasEntry, rest)
    } else {
        let rest = path.strip_prefix(COMPARISONS_URL)?;
        (ContextKind::Comparison, rest)
    };
    let id = rest.strip_suffix('/').unwrap_or(rest);
    let valid = !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !id.starts_with('-')
        && !id.ends_with('-');
    valid.then(|| (kind, id.to_string()))
}

/// Every context link in `markdown`, in reading order. `first_line` is the
/// one-based line of the source document where `markdown` begins, so lines
/// match the post's file. Links inside code are not links and are skipped.
pub fn find_context_links(markdown: &str, first_line: usize) -> Vec<ContextLink> {
    let parser = Parser::new_ext(markdown, crate::markdown::parser_options(false));
    let mut links = Vec::new();
    for (event, range) in parser.into_offset_iter() {
        let Event::Start(Tag::Link { dest_url, .. }) = event else {
            continue;
        };
        let Some((kind, id)) = parse_context_href(&dest_url) else {
            continue;
        };
        let line = first_line + markdown[..range.start].matches('\n').count();
        links.push(ContextLink {
            kind,
            id,
            href: dest_url.to_string(),
            line,
        });
    }
    links
}

/// Review each context link against `gap`, which says why the next build
/// does not publish the page a link names, or `None` when it does.
pub fn review_context_links(
    links: &[ContextLink],
    gap: impl Fn(ContextKind, &str) -> Option<ContextGap>,
) -> Vec<ContextLinkFinding> {
    links
        .iter()
        .filter_map(|link| {
            let gap = gap(link.kind, &link.id)?;
            let (thing, switch) = match link.kind {
                ContextKind::AtlasEntry => ("atlas entry", "`knowledgeAtlas.publish`"),
                ContextKind::Comparison => ("comparison", "`comparisons.publish`"),
            };
            let reason = match gap {
                ContextGap::NotPublishing => {
                    format!("the site does not publish these pages ({switch} is off)")
                }
                ContextGap::Unknown => format!("no {thing} has the id `{}`", link.id),
                ContextGap::NotApproved => format!("the {thing} `{}` is not approved", link.id),
                ContextGap::NotProjected => format!(
                    "the comparison `{}` is approved, but cannot be published as it stands",
                    link.id
                ),
            };
            let repair = match gap {
                ContextGap::NotPublishing => {
                    format!("Turn on {switch} to publish the page, or remove the link.")
                }
                ContextGap::Unknown => "Correct the address, or remove the link.".to_string(),
                ContextGap::NotApproved => {
                    format!("Approve the {thing} if it is ready to be public, or remove the link.")
                }
                ContextGap::NotProjected => {
                    "Open the comparison to see what stops it, or remove the link.".to_string()
                }
            };
            Some(ContextLinkFinding {
                link: link.clone(),
                gap,
                message: format!(
                    "The link to {} names a page the next build does not publish: {reason}.",
                    link.href
                ),
                repair,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_context_addresses_are_context_links() {
        assert_eq!(
            parse_context_href("/atlas/plato/"),
            Some((ContextKind::AtlasEntry, "plato".into()))
        );
        assert_eq!(
            parse_context_href("/comparisons/cave-places/#members"),
            Some((ContextKind::Comparison, "cave-places".into()))
        );
        for other in [
            "/atlas/",
            "/atlas/a/b/",
            "/atlas/Plato/",
            "/atlas/../x/",
            "https://example.com/atlas/plato/",
            "/posts/atlas/",
            "/atlas/-x/",
        ] {
            assert_eq!(parse_context_href(other), None, "{other}");
        }
    }

    #[test]
    fn links_are_found_with_their_source_lines_and_never_inside_code() {
        let markdown = "Intro [Plato](/atlas/plato/).\n\n`[x](/atlas/hidden/)`\n\n```\n[y](/comparisons/z/)\n```\n\nSee [the places](/comparisons/cave/).\n";
        let links = find_context_links(markdown, 5);
        assert_eq!(
            links
                .iter()
                .map(|link| (link.kind, link.id.as_str(), link.line))
                .collect::<Vec<_>>(),
            vec![
                (ContextKind::AtlasEntry, "plato", 5),
                (ContextKind::Comparison, "cave", 13)
            ]
        );
    }

    #[test]
    fn a_finding_names_the_address_and_id_and_never_judges_the_page() {
        let links = find_context_links("[a](/atlas/a/) [b](/atlas/b/) [c](/comparisons/c/)", 1);
        let findings = review_context_links(&links, |kind, id| match (kind, id) {
            (ContextKind::AtlasEntry, "a") => None,
            (ContextKind::AtlasEntry, _) => Some(ContextGap::NotApproved),
            (ContextKind::Comparison, _) => Some(ContextGap::NotPublishing),
        });
        assert_eq!(findings.len(), 2);
        assert_eq!(
            findings[0].message,
            "The link to /atlas/b/ names a page the next build does not publish: the atlas entry `b` is not approved."
        );
        assert!(findings[1].message.contains("`comparisons.publish` is off"));
        for finding in &findings {
            assert!(!finding.message.to_lowercase().contains("wrong"));
        }
    }
}

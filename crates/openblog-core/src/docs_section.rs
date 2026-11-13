//! The documentation section (ADR 0405): Markdown files under `content/docs/` published as a
//! tree of pages at `/docs/`, with a sidebar, previous and next links, and links between the
//! files written as `.md` paths so the same files read correctly on GitHub.
//!
//! Off unless `docs.enabled` is true in `openblog.json`, so a site that keeps notes in a
//! `content/docs/` folder builds exactly as before.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::escape::{attr, text};
use crate::model::Page;

/// The folder under the content folder that holds the documentation.
pub const DOCS_DIR: &str = "docs";
/// The first path segment of every documentation page's address.
pub const DOCS_SEGMENT: &str = "docs";

/// The `docs` member of `openblog.json`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DocsConfig {
    /// Publish `content/docs/` at `/docs/`.
    pub enabled: bool,
    /// The sidebar's heading and the label of the header link to `/docs/`. Defaults to
    /// "Documentation".
    #[serde(skip_serializing_if = "String::is_empty")]
    pub title: String,
    /// Where the `docs/` folder can be read in a repository viewer, such as
    /// `https://github.com/you/project/blob/main/docs/` (ADR 0406). With it, each page links to
    /// its own source, and a link to a file outside `docs/` (or to one that is not a page)
    /// points there instead of at an address the site does not have.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub source: String,
    /// Make the documentation the site's home page (ADR 0407): `content/docs/index.md` (or
    /// `README.md`) is published at `/` in place of the post list, and `/docs/` sends readers
    /// there. Posts keep their own addresses and are listed in the archive.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub home: bool,
}

impl DocsConfig {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// [`Self::source`] with exactly one trailing `/`, or `None` when it is not set.
    pub fn source_base(&self) -> Option<String> {
        let source = self.source.trim();
        if source.is_empty() {
            None
        } else {
            Some(format!("{}/", source.trim_end_matches('/')))
        }
    }

    /// The address of a page's own source file, for the "View source" link.
    pub fn source_url(&self, page_source: &str) -> Option<String> {
        let base = self.source_base()?;
        let file = page_source
            .replace('\\', "/")
            .strip_prefix(&format!("{DOCS_DIR}/"))?
            .to_string();
        Some(format!("{base}{file}"))
    }

    pub fn title(&self) -> &str {
        if self.title.trim().is_empty() {
            "Documentation"
        } else {
            self.title.trim()
        }
    }
}

/// Where a page sits in the documentation tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocPlace {
    /// The page's path under `/docs/`, without slashes at either end: `""` for the section's
    /// own index, `guides` for `guides/index.md`, `guides/install` for `guides/install.md`.
    pub path: String,
    /// `order:` from front matter; pages with one come first, lowest first.
    pub order: Option<u32>,
    /// `navTitle:` from front matter, a shorter title for the sidebar.
    pub nav_title: Option<String>,
}

impl DocPlace {
    /// The folder the page belongs to in the sidebar: an index page belongs to its parent
    /// folder (it heads its own folder's group).
    pub fn parent(&self) -> Option<&str> {
        if self.path.is_empty() {
            return None;
        }
        Some(
            self.path
                .rsplit_once('/')
                .map(|(parent, _)| parent)
                .unwrap_or(""),
        )
    }

    pub fn depth(&self) -> usize {
        if self.path.is_empty() {
            0
        } else {
            self.path.matches('/').count() + 1
        }
    }
}

/// The documentation path of a source file (`docs/...` relative to the content folder), or
/// `None` for a file outside `docs/`. `index.md` stands for its folder.
pub fn doc_path(source: &str) -> Option<String> {
    let source = source.replace('\\', "/");
    let rest = source.strip_prefix(&format!("{DOCS_DIR}/"))?;
    let stem = rest
        .strip_suffix(".md")
        .or_else(|| rest.strip_suffix(".markdown"))?;
    let segments: Vec<String> = stem.split('/').map(crate::slug::slugify).collect();
    let mut path = segments.join("/");
    // `index.md`, or `README.md` as GitHub shows it (ADR 0406), stands for its folder.
    for name in ["index", "readme"] {
        if path == name {
            path.clear();
        } else if let Some(folder) = path.strip_suffix(&format!("/{name}")) {
            path = folder.to_string();
        }
    }
    Some(path)
}

/// The address of a documentation path.
pub fn url_for(path: &str) -> String {
    if path.is_empty() {
        format!("/{DOCS_SEGMENT}/")
    } else {
        format!("/{DOCS_SEGMENT}/{path}/")
    }
}

/// Resolve `target` (an `href` written in the source file `from`, both relative to the content
/// folder) to a documentation path when it names a Markdown file or folder under `docs/`.
fn resolve(from: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if joined.ends_with(".md") || joined.ends_with(".markdown") {
        return doc_path(&joined);
    }
    // A folder: its index (or README, which gives the same path).
    doc_path(&format!("{joined}/index.md"))
}

/// Rewrite the links in a documentation page's HTML that point at other Markdown files under
/// `docs/` (`install.md`, `../guides/`, `adr/0001-x.md#context`) to the pages' addresses.
/// Links to a `.md` file that is not a documentation page are left as written and reported.
pub fn rewrite_links(
    html: &str,
    source: &str,
    known: &HashMap<String, String>,
    source_base: Option<&str>,
    warnings: &mut Vec<String>,
) -> String {
    let marker = "href=\"";
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find(marker) {
        let (before, after) = rest.split_at(at + marker.len());
        out.push_str(before);
        let end = after.find('"').unwrap_or(after.len());
        let href = &after[..end];
        out.push_str(&rewrite_href(href, source, known, source_base, warnings));
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Rewrite the links in a post's or page's HTML (`source` is its file, relative to the content
/// folder) that point at a Markdown file or folder under `docs/`, such as `../docs/install.md`,
/// to the documentation page's address. Other links are untouched; a link into `docs/` that is
/// not a page is reported.
pub fn rewrite_links_into_docs(
    html: &str,
    source: &str,
    known: &HashMap<String, String>,
    warnings: &mut Vec<String>,
) -> String {
    let marker = "href=\"";
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find(marker) {
        let (before, after) = rest.split_at(at + marker.len());
        out.push_str(before);
        let end = after.find('"').unwrap_or(after.len());
        let href = &after[..end];
        let (path, anchor) = match href.split_once('#') {
            Some((path, anchor)) => (path, format!("#{anchor}")),
            None => (href, String::new()),
        };
        let relative = !path.is_empty()
            && !path.starts_with('/')
            && !path
                .split_once(':')
                .is_some_and(|(scheme, _)| !scheme.contains('/'));
        let into_docs = relative
            && (path.ends_with(".md") || path.ends_with(".markdown") || path.ends_with('/'))
            && joined(source, path)
                .is_some_and(|j| j.starts_with(&format!("{DOCS_DIR}/")) || j == DOCS_DIR);
        if into_docs {
            match resolve(source, path).and_then(|doc| known.get(&doc)) {
                Some(url) => out.push_str(&format!("{url}{anchor}")),
                None => {
                    warnings.push(format!(
                        "{source}: the link to `{path}` does not match a page under docs/"
                    ));
                    out.push_str(href);
                }
            }
        } else {
            out.push_str(href);
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// `target` resolved against the folder of `from` (both relative to the content folder), or
/// `None` when it climbs above the content folder.
fn joined(from: &str, target: &str) -> Option<String> {
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

fn rewrite_href(
    href: &str,
    source: &str,
    known: &HashMap<String, String>,
    source_base: Option<&str>,
    warnings: &mut Vec<String>,
) -> String {
    let is_external = href.starts_with('/')
        || href.starts_with('#')
        || href.is_empty()
        || href
            .split_once(':')
            .is_some_and(|(scheme, _)| !scheme.contains('/'));
    if is_external {
        return href.to_string();
    }
    let (path, anchor) = match href.split_once('#') {
        Some((path, anchor)) => (path, format!("#{anchor}")),
        None => (href, String::new()),
    };
    let markdown = path.ends_with(".md") || path.ends_with(".markdown");
    let folder = path.ends_with('/') || path == "." || path == "..";
    if markdown || folder {
        if let Some(url) = resolve(source, path).and_then(|doc| known.get(&doc)) {
            return format!("{url}{anchor}");
        }
    }
    // Not a page. Where the folder can be read in a repository viewer, a link to a file the
    // site does not publish (outside docs/, or not Markdown) points at it there.
    let from_docs_root = relative_to_docs(source, path);
    if let (Some(base), Some(relative)) = (source_base, &from_docs_root) {
        let inside = !relative.starts_with("../");
        if !(markdown && inside) {
            return format!("{}{anchor}", join_url(base, relative));
        }
    }
    if markdown {
        warnings.push(format!(
            "{source}: the link to `{path}` does not match a page under docs/"
        ));
    }
    href.to_string()
}

/// `target` (written in the file `from`, relative to the content folder) as a path relative to
/// the `docs/` folder, keeping any `../` that leaves it: `docs/specs/a.md` + `../../crates/x.rs`
/// is `../crates/x.rs`.
fn relative_to_docs(from: &str, target: &str) -> Option<String> {
    let from = from.replace('\\', "/");
    let inside = from.strip_prefix(&format!("{DOCS_DIR}/"))?;
    let mut parts: Vec<&str> = inside.split('/').collect();
    parts.pop();
    let mut above = 0usize;
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    above += 1;
                }
            }
            other => parts.push(other),
        }
    }
    let mut out = "../".repeat(above);
    out.push_str(&parts.join("/"));
    if target.ends_with('/') && !out.ends_with('/') {
        out.push('/');
    }
    Some(out)
}

/// `relative` (which may start with `../`) joined onto a base address ending in `/`.
fn join_url(base: &str, relative: &str) -> String {
    let (origin, path) = match base.find("://") {
        Some(at) => {
            let after = &base[at + 3..];
            let slash = after.find('/').map(|i| at + 3 + i).unwrap_or(base.len());
            (&base[..slash], &base[slash..])
        }
        None => ("", base),
    };
    let mut parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    let mut rest = relative;
    while let Some(stripped) = rest.strip_prefix("../") {
        parts.pop();
        rest = stripped;
    }
    let joined = parts.join("/");
    if joined.is_empty() {
        format!("{origin}/{rest}")
    } else {
        format!("{origin}/{joined}/{rest}")
    }
}

/// The documentation pages in reading order: depth first, a folder's index before the pages
/// in it, and within a folder by `order:` and then by title.
pub fn reading_order(pages: &[Page]) -> Vec<usize> {
    let docs: Vec<(usize, &DocPlace)> = pages
        .iter()
        .enumerate()
        .filter_map(|(index, page)| page.doc.as_ref().map(|doc| (index, doc)))
        .collect();
    let mut out = Vec::with_capacity(docs.len());
    if let Some((root, _)) = docs.iter().find(|(_, doc)| doc.path.is_empty()) {
        out.push(*root);
    }
    push_children(pages, &docs, "", &mut out);
    out
}

/// The pages directly in `folder`: its files, and the index of each subfolder (which may be
/// missing, in which case the folder's pages are still listed, under a heading made from the
/// folder's name).
fn children<'a>(pages: &'a [Page], docs: &[(usize, &'a DocPlace)], folder: &str) -> Vec<Child<'a>> {
    let mut list: Vec<Child<'a>> = Vec::new();
    for (index, doc) in docs {
        if doc.parent() == Some(folder) {
            list.push(Child::Page(*index, doc));
        }
    }
    // Subfolders that hold pages but have no index of their own.
    let prefix = if folder.is_empty() {
        String::new()
    } else {
        format!("{folder}/")
    };
    let paths: std::collections::HashSet<&str> =
        docs.iter().map(|(_, doc)| doc.path.as_str()).collect();
    let mut bare: Vec<String> = Vec::new();
    for (_, doc) in docs {
        if let Some(rest) = doc.path.strip_prefix(&prefix) {
            if let Some((sub, _)) = rest.split_once('/') {
                let full = format!("{prefix}{sub}");
                let has_index = paths.contains(full.as_str());
                if !has_index && !bare.contains(&full) {
                    bare.push(full);
                }
            }
        }
    }
    for full in bare {
        list.push(Child::Folder(full));
    }
    list.sort_by(|a, b| {
        let key = |child: &Child<'a>| match child {
            Child::Page(index, doc) => (
                doc.order.unwrap_or(u32::MAX),
                sidebar_title(&pages[*index]).to_lowercase(),
            ),
            Child::Folder(path) => (u32::MAX, folder_title(path).to_lowercase()),
        };
        key(a).cmp(&key(b))
    });
    list
}

enum Child<'a> {
    Page(usize, &'a DocPlace),
    Folder(String),
}

fn push_children(pages: &[Page], docs: &[(usize, &DocPlace)], folder: &str, out: &mut Vec<usize>) {
    for child in children(pages, docs, folder) {
        match child {
            Child::Page(index, doc) => {
                out.push(index);
                if !doc.path.is_empty() && is_folder(docs, &doc.path) {
                    push_children(pages, docs, &doc.path, out);
                }
            }
            Child::Folder(path) => push_children(pages, docs, &path, out),
        }
    }
}

/// Whether any page sits inside `path`, which makes the page at `path` a folder's index.
fn is_folder(docs: &[(usize, &DocPlace)], path: &str) -> bool {
    let prefix = format!("{path}/");
    docs.iter().any(|(_, doc)| doc.path.starts_with(&prefix))
}

fn sidebar_title(page: &Page) -> &str {
    page.doc
        .as_ref()
        .and_then(|doc| doc.nav_title.as_deref())
        .unwrap_or(&page.title)
}

fn folder_title(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    crate::model::humanize(name)
}

/// The sidebar for the page at `current` (an index into `pages`). Every top-level entry is
/// listed; a folder's pages are listed only when the current page is in that folder or below
/// it, so a large folder costs nothing on pages elsewhere. Plain links in a `<nav>`, inside a
/// `<details>` that a narrow screen shows folded.
pub fn sidebar(pages: &[Page], current: usize, heading: &str) -> String {
    let docs: Vec<(usize, &DocPlace)> = pages
        .iter()
        .enumerate()
        .filter_map(|(index, page)| page.doc.as_ref().map(|doc| (index, doc)))
        .collect();
    let current_path = pages[current]
        .doc
        .as_ref()
        .map(|doc| doc.path.clone())
        .unwrap_or_default();
    let mut out = format!(
        "<ob-docs-nav>\n<form class=\"ob-docs-search\" role=\"search\" action=\"/search/\" method=\"get\">\n<label class=\"ob-visually-hidden\" for=\"ob-docs-q\">Search the documentation</label>\n<input id=\"ob-docs-q\" type=\"search\" name=\"q\" placeholder=\"Search the docs\" autocomplete=\"off\">\n</form>\n<details class=\"ob-docs-nav\" open>\n<summary>{}</summary>\n<nav aria-label=\"{}\">\n",
        text(heading),
        attr(heading)
    );
    out.push_str("<ul>\n");
    if let Some((root, _)) = docs.iter().find(|(_, doc)| doc.path.is_empty()) {
        out.push_str(&item(&pages[*root], *root == current, ""));
        out.push_str("</li>\n");
    }
    items(pages, &docs, "", &current_path, current, &mut out);
    out.push_str("</ul>\n</nav>\n</details>\n</ob-docs-nav>\n");
    out
}

fn item(page: &Page, is_current: bool, class: &str) -> String {
    let class_attr = if class.is_empty() {
        String::new()
    } else {
        format!(" class=\"{class}\"")
    };
    let current = if is_current {
        " aria-current=\"page\""
    } else {
        ""
    };
    format!(
        "<li{class_attr}><a href=\"{}\"{current}>{}</a>",
        attr(&page.url),
        text(sidebar_title(page))
    )
}

fn list(
    pages: &[Page],
    docs: &[(usize, &DocPlace)],
    folder: &str,
    current_path: &str,
    current: usize,
    out: &mut String,
) {
    if children(pages, docs, folder).is_empty() {
        return;
    }
    out.push_str("<ul>\n");
    items(pages, docs, folder, current_path, current, out);
    out.push_str("</ul>\n");
}

/// The `<li>` of each entry directly in `folder`, with the folder the reader is in expanded.
fn items(
    pages: &[Page],
    docs: &[(usize, &DocPlace)],
    folder: &str,
    current_path: &str,
    current: usize,
    out: &mut String,
) {
    for child in children(pages, docs, folder) {
        let (path, opened) = match &child {
            Child::Page(index, doc) => {
                let is_folder = is_folder(docs, &doc.path);
                out.push_str(&item(
                    &pages[*index],
                    *index == current,
                    if is_folder { "ob-docs-folder" } else { "" },
                ));
                (doc.path.clone(), is_folder)
            }
            Child::Folder(path) => {
                out.push_str(&format!(
                    "<li class=\"ob-docs-folder\"><span>{}</span>",
                    text(&folder_title(path))
                ));
                (path.clone(), true)
            }
        };
        let inside = current_path == path || current_path.starts_with(&format!("{path}/"));
        if opened && inside {
            out.push('\n');
            list(pages, docs, &path, current_path, current, out);
        }
        out.push_str("</li>\n");
    }
}

/// The previous and next pages in reading order, as a `<nav>`; empty for a section of one page.
pub fn pager(pages: &[Page], order: &[usize], current: usize) -> String {
    let Some(position) = order.iter().position(|index| *index == current) else {
        return String::new();
    };
    let previous = position.checked_sub(1).map(|p| &pages[order[p]]);
    let next = order.get(position + 1).map(|index| &pages[*index]);
    if previous.is_none() && next.is_none() {
        return String::new();
    }
    let mut out = String::from("<nav class=\"ob-docs-pager\" aria-label=\"Previous and next\">\n");
    if let Some(page) = previous {
        out.push_str(&format!(
            "<a class=\"ob-docs-previous\" href=\"{}\" rel=\"prev\"><span class=\"ob-meta\">Previous</span> {}</a>\n",
            attr(&page.url),
            text(&page.title)
        ));
    }
    if let Some(page) = next {
        out.push_str(&format!(
            "<a class=\"ob-docs-next\" href=\"{}\" rel=\"next\"><span class=\"ob-meta\">Next</span> {}</a>\n",
            attr(&page.url),
            text(&page.title)
        ));
    }
    out.push_str("</nav>\n");
    out
}

/// One searchable part of a documentation page: its opening (before the first `<h2>`), or one
/// `<h2>` section with what follows it up to the next.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchPart {
    pub title: String,
    pub url: String,
    /// Lower-cased plain text, at most [`SEARCH_PART_CHARS`] characters.
    pub text: String,
    pub is_page: bool,
}

/// How much of each part's text goes into the search index. Sections are short, so this keeps
/// almost every word of a page searchable while bounding the index (ADR 0408).
pub const SEARCH_PART_CHARS: usize = 1500;

/// The parts of a documentation page for the search index (ADR 0408). The opening keeps the
/// page's title and address; each `<h2 id>` section is "Page › Section" at `page#id`.
pub fn search_parts(page: &Page) -> Vec<SearchPart> {
    let mut parts = Vec::new();
    let mut rest = page.html.as_str();
    let opening_end = rest.find("<h2 id=\"").unwrap_or(rest.len());
    parts.push(SearchPart {
        title: page.title.clone(),
        url: page.url.clone(),
        text: plain(&format!("{} {}", page.title, &rest[..opening_end])),
        is_page: true,
    });
    rest = &rest[opening_end..];
    while let Some(start) = rest.strip_prefix("<h2 id=\"") {
        let Some(id_end) = start.find('"') else { break };
        let id = &start[..id_end];
        let Some(close) = start.find("</h2>") else {
            break;
        };
        let inner = start[id_end..close]
            .find('>')
            .map(|at| id_end + at + 1)
            .unwrap_or(close);
        let heading = plain(&start[inner..close]);
        let body_start = close + "</h2>".len();
        let next = start[body_start..]
            .find("<h2 id=\"")
            .map(|at| body_start + at)
            .unwrap_or(start.len());
        let heading_title = plain_case(&start[inner..close]);
        parts.push(SearchPart {
            title: format!("{} › {}", page.title, heading_title),
            url: format!("{}#{}", page.url, id),
            text: plain(&format!("{heading} {}", &start[body_start..next])),
            is_page: false,
        });
        rest = &start[next..];
    }
    parts
}

/// The label a search result shows under a documentation page's title: the folder it is in,
/// by that folder's own title, such as "Decision records"; nothing for a page at the top.
pub fn search_label(pages: &[Page], page: &Page) -> Option<String> {
    let folder = page.doc.as_ref()?.parent()?;
    if folder.is_empty() {
        return None;
    }
    Some(
        pages
            .iter()
            .find(|p| p.doc.as_ref().is_some_and(|doc| doc.path == folder))
            .map(|p| p.title.clone())
            .unwrap_or_else(|| folder_title(folder)),
    )
}

/// Lower-cased plain text of an HTML fragment, collapsed and cut to [`SEARCH_PART_CHARS`].
fn plain(html: &str) -> String {
    plain_case(html)
        .to_lowercase()
        .chars()
        .take(SEARCH_PART_CHARS)
        .collect()
}

/// Plain text of an HTML fragment with its case kept: tags dropped (a heading's `#` anchor
/// with them), the common entities decoded, whitespace collapsed.
fn plain_case(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut skip_anchor = false;
    for (at, c) in html.char_indices() {
        match c {
            '<' => {
                in_tag = true;
                if html[at..].starts_with("<a class=\"ob-heading-anchor\"") {
                    skip_anchor = true;
                } else if skip_anchor && html[at..].starts_with("</a>") {
                    skip_anchor = false;
                }
                text.push(' ');
            }
            '>' => in_tag = false,
            _ if in_tag || skip_anchor => {}
            _ => text.push(c),
        }
    }
    let decoded = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_come_from_the_file_and_index_stands_for_its_folder() {
        assert_eq!(doc_path("docs/index.md").as_deref(), Some(""));
        assert_eq!(doc_path("docs/install.md").as_deref(), Some("install"));
        assert_eq!(doc_path("docs/guides/index.md").as_deref(), Some("guides"));
        assert_eq!(
            doc_path("docs/Guides/First Steps.md").as_deref(),
            Some("guides/first-steps")
        );
        assert_eq!(doc_path("pages/about.md"), None);
        assert_eq!(url_for(""), "/docs/");
        assert_eq!(url_for("guides/install"), "/docs/guides/install/");
    }

    #[test]
    fn links_to_markdown_files_become_page_addresses() {
        let known: HashMap<String, String> = [
            ("".to_string(), "/docs/".to_string()),
            ("install".to_string(), "/docs/install/".to_string()),
            ("guides".to_string(), "/docs/guides/".to_string()),
            (
                "guides/deploy".to_string(),
                "/docs/guides/deploy/".to_string(),
            ),
        ]
        .into_iter()
        .collect();
        let mut warnings = Vec::new();
        let html = r##"<a href="../install.md#steps">i</a> <a href="deploy.md">d</a> <a href="./">g</a> <a href="https://x.dev/a.md">x</a> <a href="/docs/">r</a> <a href="#top">t</a> <a href="missing.md">m</a> <a href="../../README.md">o</a> <a href="photo.png">p</a>"##;
        let out = rewrite_links(html, "docs/guides/index.md", &known, None, &mut warnings);
        assert!(out.contains(r#"href="/docs/install/#steps""#), "{out}");
        assert!(out.contains(r#"href="/docs/guides/deploy/""#), "{out}");
        assert!(out.contains(r#"<a href="/docs/guides/">g</a>"#), "{out}");
        assert!(out.contains(r#"href="https://x.dev/a.md""#));
        assert!(out.contains(r#"href="/docs/">r"#));
        assert!(out.contains(r##"href="#top""##));
        assert!(out.contains(r#"href="missing.md""#));
        assert!(out.contains(r#"href="photo.png""#));
        assert_eq!(warnings.len(), 2, "{warnings:?}");
        assert!(warnings[0].contains("missing.md"));
        assert!(warnings[1].contains("../../README.md"));
    }

    #[test]
    fn a_page_is_searchable_by_its_opening_and_each_section() {
        let page = Page {
            title: "Configuration".into(),
            url: "/docs/configuration/".into(),
            html: concat!(
                "<p>Every setting &amp; its default.</p>\n",
                "<h2 id=\"site\">Site<a class=\"ob-heading-anchor\" href=\"#site\" aria-label=\"Link to this section\">#</a></h2>\n",
                "<p>The <code>title</code> key.</p>\n",
                "<h2 id=\"feeds\">Feeds &amp; maps<a class=\"ob-heading-anchor\" href=\"#feeds\">#</a></h2>\n<p>RSS.</p>"
            )
            .into(),
            ..Page::default()
        };
        let parts = search_parts(&page);
        assert_eq!(parts.len(), 3, "{parts:?}");
        assert_eq!(parts[0].url, "/docs/configuration/");
        assert_eq!(parts[0].text, "configuration every setting & its default.");
        assert!(parts[0].is_page);
        assert_eq!(parts[1].title, "Configuration › Site");
        assert_eq!(parts[1].url, "/docs/configuration/#site");
        assert_eq!(parts[1].text, "site the title key.");
        assert_eq!(parts[2].title, "Configuration › Feeds & maps");
        assert_eq!(parts[2].text, "feeds & maps rss.");
    }

    #[test]
    fn with_a_source_folder_links_to_unpublished_files_point_at_the_repository() {
        let known: HashMap<String, String> =
            [("specs/a".to_string(), "/docs/specs/a/".to_string())]
                .into_iter()
                .collect();
        let base = "https://github.com/o/r/blob/main/docs/";
        let mut warnings = Vec::new();
        let html = r#"<a href="../../crates/x.rs">x</a> <a href="../../CHANGELOG.md#top">c</a> <a href="contracts.json">j</a> <a href="a.md">a</a> <a href="gone.md">g</a> <a href="../../tests/">t</a>"#;
        let out = rewrite_links(html, "docs/specs/b.md", &known, Some(base), &mut warnings);
        assert!(
            out.contains(r#"href="https://github.com/o/r/blob/main/crates/x.rs""#),
            "{out}"
        );
        assert!(out.contains(r#"href="https://github.com/o/r/blob/main/CHANGELOG.md#top""#));
        assert!(
            out.contains(r#"href="https://github.com/o/r/blob/main/docs/specs/contracts.json""#)
        );
        assert!(out.contains(r#"href="/docs/specs/a/""#));
        assert!(
            out.contains(r#"href="https://github.com/o/r/blob/main/tests/""#),
            "{out}"
        );
        // A missing page inside docs/ is still a mistake to report, not a link to send away.
        assert!(out.contains(r#"href="gone.md""#));
        assert_eq!(warnings.len(), 1, "{warnings:?}");

        let config = DocsConfig {
            enabled: true,
            title: String::new(),
            source: "https://github.com/o/r/blob/main/docs".into(),
            home: false,
        };
        assert_eq!(
            config.source_url("docs/specs/b.md").as_deref(),
            Some("https://github.com/o/r/blob/main/docs/specs/b.md")
        );
        assert_eq!(doc_path("docs/README.md").as_deref(), Some(""));
        assert_eq!(doc_path("docs/adr/README.md").as_deref(), Some("adr"));
    }
}

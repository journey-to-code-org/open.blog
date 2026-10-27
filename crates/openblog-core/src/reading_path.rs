//! Author-curated reading paths (ADR 0240, #76).
//!
//! A reading path is an author's ordered list of published steps, each after
//! the first carrying an author-written transition that says why it follows
//! and how it relates to the step before it. It is its own content type, not
//! a series: a series is one post's single, automatic membership ordered by
//! date, and a path is many-to-many, may point at Knowledge Atlas entries,
//! and carries editorial rationale. A path never changes a post, a series or
//! the atlas, and nothing else reads one.
//!
//! The stored file is `content/paths/<slug>.json` (`openblog-reading-path`,
//! version 1). It is public, author-written plain text. [`ReadingPath::parse`]
//! checks it and [`ReadingPath::to_canonical_json`] writes it back byte for
//! byte the same for the same path, so an Admin save and a hand edit agree.
//! Unknown fields are refused rather than dropped, so a round trip never
//! loses anything.
//!
//! [`PublicPaths::resolve`] reads paths against [`PublishedTargets`] (the
//! posts a build publishes and the public atlas) and nothing else. A step
//! whose target is not published is left out of the public value and named
//! in an author-facing [`Diagnostic`]; the public value never says that
//! anything was left out, and never carries an unpublished item's title or
//! text. A transition never claims more than the author wrote: one that
//! followed a left-out step, or that claims influence without a published
//! relationship behind it, is dropped.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::atlas_publication::{entry_url, escaped_json, kind_label, PublicAtlas};
use crate::knowledge_atlas::{valid_id, RelationshipKind};
use crate::model::{Site, SourceFile};

/// Names the stored file.
pub const READING_PATH_FORMAT: &str = "openblog-reading-path";
/// The only stored version this release reads and writes.
pub const READING_PATH_VERSION: u64 = 1;
/// Names the public projection.
pub const PUBLIC_PATHS_FORMAT: &str = "openblog-reading-paths";
/// The only public projection version this release writes.
pub const PUBLIC_PATHS_FORMAT_VERSION: u64 = 1;
/// Where path files live, relative to the content folder.
pub const PATHS_DIR: &str = "paths";
/// Where a path's page will live on the site (`/paths/<slug>/`).
pub const PATHS_URL: &str = "/paths/";

/// Most steps in one path.
pub const MAX_STEPS: usize = 100;
/// Most path files a site reads.
pub const MAX_PATHS: usize = 200;
/// Largest path file, in bytes.
pub const MAX_FILE_BYTES: usize = 256 * 1024;
/// Longest slug or step id, in bytes.
pub const MAX_ID_BYTES: usize = 64;
/// Longest title, in characters.
pub const MAX_TITLE_CHARS: usize = 120;
/// Longest summary, step rationale or transition, in characters.
pub const MAX_TEXT_CHARS: usize = 600;
/// Longest prerequisite note, in characters.
pub const MAX_PREREQUISITE_CHARS: usize = 400;

/// Whether a path is public. Absent means a draft: nothing is published by
/// leaving a field out.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    #[default]
    Draft,
    Published,
}

/// The author's own judgement of how demanding a step is. Never computed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Difficulty {
    Introductory,
    Intermediate,
    Advanced,
}

/// How a step relates to the one before it, as the author states it. There
/// is no default: a transition without one is refused. `Next` claims only
/// order, and `Influenced` needs a published atlas relationship behind it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Relationship {
    Next,
    Background,
    BuildsOn,
    ContrastsWith,
    RespondsTo,
    Applies,
    Influenced,
}

impl Relationship {
    /// The relationship in words, about this step and the one before it.
    pub fn label(self) -> &'static str {
        match self {
            Self::Next => "Comes next, with no further relationship claimed",
            Self::Background => "The previous step is background for this one",
            Self::BuildsOn => "Builds on the previous step",
            Self::ContrastsWith => "Contrasts with the previous step",
            Self::RespondsTo => "Responds to the previous step",
            Self::Applies => "Applies the previous step",
            Self::Influenced => {
                "Was influenced by the previous step, which a published relationship states"
            }
        }
    }
}

/// What a step points at. Only these two kinds exist: a path cannot contain
/// a path, so paths cannot cycle through one another.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Target {
    /// A published post, by slug.
    Post { slug: String },
    /// A published Knowledge Atlas entry, by id.
    Atlas { id: String },
}

impl Target {
    fn noun(&self) -> &'static str {
        match self {
            Self::Post { .. } => "post",
            Self::Atlas { .. } => "atlas entry",
        }
    }

    fn key(&self) -> String {
        match self {
            Self::Post { slug } => format!("post `{slug}`"),
            Self::Atlas { id } => format!("atlas entry `{id}`"),
        }
    }
}

/// Why a step follows the one before it, written by the author.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transition {
    pub relationship: Relationship,
    /// The author's explanation. Required.
    pub why: String,
    /// The id of a published atlas relationship this transition rests on.
    /// Required for `influenced`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Step {
    /// Stable within the path, so a reorder keeps a step's identity.
    pub id: String,
    pub target: Target,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prerequisites: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<Difficulty>,
    /// A side step a reader may skip. It never changes the order.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
    /// Absent on the first step and required on every other one of a path
    /// that is published.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition: Option<Transition>,
}

/// One path as stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadingPath {
    /// From the file name; never stored in the file.
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub status: Status,
    pub steps: Vec<Step>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawPath {
    #[allow(dead_code)]
    format: String,
    #[allow(dead_code)]
    version: u64,
    title: String,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    status: Status,
    #[serde(default)]
    steps: Vec<Value>,
}

/// One refusal, scoped to a file and, where it has one, a step. It names
/// ids and limits, never a step's text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathProblem {
    pub file: String,
    pub step: Option<String>,
    pub message: String,
}

impl std::fmt::Display for PathProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.step {
            Some(step) => write!(f, "{}: step `{}`: {}", self.file, step, self.message),
            None => write!(f, "{}: {}", self.file, self.message),
        }
    }
}

fn is_ascii_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A post slug as the site makes one: letters and digits (any script) and
/// single hyphens.
fn is_post_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value.chars().all(|c| c == '-' || c.is_alphanumeric())
}

fn text_problem(value: &str, max_chars: usize) -> Option<String> {
    if value.chars().count() > max_chars {
        return Some(format!("is over {max_chars} characters"));
    }
    let bad = |c: char| {
        c.is_control()
            || matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
    };
    if value.chars().any(bad) {
        return Some("holds a control or direction character; it is plain text on one line".into());
    }
    if value.contains("](atlas:") {
        return Some(
            "holds an `atlas:` link, which a reading path does not resolve: write the words".into(),
        );
    }
    None
}

impl ReadingPath {
    /// Reads and checks one file. `file` is its path under the content
    /// folder (`paths/<slug>.json`), which names the path. Every refusal
    /// found is returned, and a refused file is never partly read.
    pub fn parse(file: &str, text: &str) -> Result<Self, Vec<PathProblem>> {
        let mut problems: Vec<PathProblem> = Vec::new();
        let add = |problems: &mut Vec<PathProblem>, step: Option<&str>, message: String| {
            problems.push(PathProblem {
                file: file.to_string(),
                step: step.map(str::to_string),
                message,
            });
        };
        let stem = file
            .strip_prefix("paths/")
            .and_then(|rest| rest.strip_suffix(".json"))
            .filter(|stem| is_ascii_slug(stem));
        let Some(slug) = stem else {
            add(
                &mut problems,
                None,
                format!(
                    "a path file is `{PATHS_DIR}/<slug>.json` with a lowercase slug of at most {MAX_ID_BYTES} characters"
                ),
            );
            return Err(problems);
        };
        if text.len() > MAX_FILE_BYTES {
            add(
                &mut problems,
                None,
                format!("is over {MAX_FILE_BYTES} bytes"),
            );
            return Err(problems);
        }
        let root: Value = match serde_json::from_str(text) {
            Ok(root) => root,
            Err(e) => {
                add(&mut problems, None, format!("is not valid JSON ({e})"));
                return Err(problems);
            }
        };
        if root.get("format").and_then(Value::as_str) != Some(READING_PATH_FORMAT) {
            add(
                &mut problems,
                None,
                format!("`format` must be `{READING_PATH_FORMAT}`"),
            );
            return Err(problems);
        }
        match root.get("version").and_then(Value::as_u64) {
            Some(READING_PATH_VERSION) => {}
            Some(other) => {
                add(
                    &mut problems,
                    None,
                    format!(
                        "is version {other}; this release reads version {READING_PATH_VERSION} only"
                    ),
                );
                return Err(problems);
            }
            None => {
                add(&mut problems, None, "`version` must be a number".into());
                return Err(problems);
            }
        }
        let raw: RawPath = match serde_json::from_value(root) {
            Ok(raw) => raw,
            Err(e) => {
                add(&mut problems, None, e.to_string());
                return Err(problems);
            }
        };
        if raw.title.trim().is_empty() {
            add(&mut problems, None, "`title` is required".into());
        } else if let Some(p) = text_problem(&raw.title, MAX_TITLE_CHARS) {
            add(&mut problems, None, format!("`title` {p}"));
        }
        if let Some(p) = raw
            .summary
            .as_deref()
            .and_then(|s| text_problem(s, MAX_TEXT_CHARS))
        {
            add(&mut problems, None, format!("`summary` {p}"));
        }
        if raw.steps.len() > MAX_STEPS {
            add(
                &mut problems,
                None,
                format!(
                    "has {} steps; a path holds at most {MAX_STEPS}",
                    raw.steps.len()
                ),
            );
            return Err(problems);
        }
        let mut steps = Vec::new();
        for (index, value) in raw.steps.iter().enumerate() {
            let label = value
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| is_ascii_slug(id))
                .map_or_else(|| format!("#{}", index + 1), str::to_string);
            match serde_json::from_value::<Step>(value.clone()) {
                Ok(step) => steps.push(step),
                Err(e) => add(&mut problems, Some(&label), e.to_string()),
            }
        }
        let published = raw.status == Status::Published;
        let mut ids = BTreeSet::new();
        let mut targets: BTreeMap<String, String> = BTreeMap::new();
        for (index, step) in steps.iter().enumerate() {
            let id = step.id.as_str();
            let mut at = |message: String| add(&mut problems, Some(id), message);
            if !is_ascii_slug(id) {
                at(format!(
                    "`id` is a lowercase slug of at most {MAX_ID_BYTES} characters"
                ));
            } else if !ids.insert(id.to_string()) {
                at("`id` is used by an earlier step".into());
            }
            match &step.target {
                Target::Post { slug } if !is_post_slug(slug) => {
                    at("`slug` is not a post slug".into())
                }
                Target::Atlas { id } if !valid_id(id) => {
                    at("`id` is not an atlas entry id".into());
                }
                _ => {}
            }
            if let Some(first) = targets.insert(step.target.key(), id.to_string()) {
                at(format!(
                    "points at the same {} as step `{first}`; a path never returns to a step",
                    step.target.noun()
                ));
            }
            for (name, value, max) in [
                ("rationale", &step.rationale, MAX_TEXT_CHARS),
                ("prerequisites", &step.prerequisites, MAX_PREREQUISITE_CHARS),
            ] {
                if let Some(p) = value.as_deref().and_then(|v| text_problem(v, max)) {
                    at(format!("`{name}` {p}"));
                }
            }
            match (&step.transition, index) {
                (Some(_), 0) => at(
                    "the first step has no earlier step to follow, so it has no transition".into(),
                ),
                (None, i) if i > 0 && published => {
                    at(
                        "a published path explains every step after the first: add a transition"
                            .into(),
                    );
                }
                _ => {}
            }
            if let Some(t) = &step.transition {
                if t.why.trim().is_empty() {
                    at("`transition.why` is required: say why this step follows".into());
                } else if let Some(p) = text_problem(&t.why, MAX_TEXT_CHARS) {
                    at(format!("`transition.why` {p}"));
                }
                if t.basis.as_deref().is_some_and(|basis| !valid_id(basis)) {
                    at("`transition.basis` is not an atlas relationship id".into());
                }
                if t.relationship == Relationship::Influenced && t.basis.is_none() {
                    at("`influenced` needs `basis`, a published atlas relationship that states it; order and chronology never imply influence".into());
                }
            }
        }
        if published && steps.len() < 2 {
            add(
                &mut problems,
                None,
                "a published path has at least two steps".into(),
            );
        }
        if !problems.is_empty() {
            return Err(problems);
        }
        Ok(Self {
            slug: slug.to_string(),
            title: raw.title,
            summary: raw.summary,
            status: raw.status,
            steps,
        })
    }

    /// The file's bytes: two-space JSON, fixed field order, `\n` line ends and
    /// a final newline. `parse` of this text gives the same path, and this of
    /// that path gives the same text.
    pub fn to_canonical_json(&self) -> String {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Out<'a> {
            format: &'a str,
            version: u64,
            title: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            summary: &'a Option<String>,
            status: Status,
            steps: &'a [Step],
        }
        let mut text = serde_json::to_string_pretty(&Out {
            format: READING_PATH_FORMAT,
            version: READING_PATH_VERSION,
            title: &self.title,
            summary: &self.summary,
            status: self.status,
            steps: &self.steps,
        })
        .expect("a path is serializable");
        text.push('\n');
        text
    }
}

/// Every path a site holds, and every file that was refused.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LoadedPaths {
    /// Sorted by slug.
    pub paths: Vec<ReadingPath>,
    /// In file order; one file's refusal never affects another.
    pub problems: Vec<PathProblem>,
}

/// Reads the `paths/*.json` files among `files`. Other files are ignored.
/// A site with none gives an empty value, and nothing else changes.
pub fn load_paths(files: &[SourceFile]) -> LoadedPaths {
    let mut files: Vec<&SourceFile> = files
        .iter()
        .filter(|f| f.path.starts_with("paths/") && f.path.ends_with(".json"))
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut loaded = LoadedPaths::default();
    if files.len() > MAX_PATHS {
        loaded.problems.push(PathProblem {
            file: PATHS_DIR.to_string(),
            step: None,
            message: format!(
                "holds {} path files; a site reads at most {MAX_PATHS}",
                files.len()
            ),
        });
        files.truncate(MAX_PATHS);
    }
    for file in files {
        match ReadingPath::parse(&file.path, &file.contents) {
            Ok(path) => loaded.paths.push(path),
            Err(mut problems) => loaded.problems.append(&mut problems),
        }
    }
    loaded
}

/// What a path may point at: only what this build publishes.
#[derive(Clone, Debug, Default)]
pub struct PublishedTargets {
    posts: BTreeMap<String, (String, String)>,
    entries: BTreeMap<String, (String, String, &'static str)>,
    influences: BTreeMap<String, (String, String)>,
}

impl PublishedTargets {
    /// The published posts of `site` (drafts and scheduled posts are not in
    /// `Site::posts`) and its public atlas, if it publishes one.
    pub fn from_site(site: &Site) -> Self {
        let mut targets = Self::default();
        for post in &site.posts {
            targets.add_post(&post.slug, &post.title, &post.url);
        }
        if let Some(atlas) = &site.atlas {
            targets.add_atlas(atlas);
        }
        targets
    }

    pub fn add_post(&mut self, slug: &str, title: &str, url: &str) {
        self.posts
            .insert(slug.to_string(), (title.to_string(), url.to_string()));
    }

    pub fn add_atlas(&mut self, atlas: &PublicAtlas) {
        for e in &atlas.entries {
            self.entries.insert(
                e.id.clone(),
                (e.label.clone(), entry_url(&e.id), kind_label(e.kind)),
            );
        }
        for r in &atlas.relationships {
            if r.kind == RelationshipKind::Influenced {
                self.influences
                    .insert(r.id.clone(), (r.from.clone(), r.to.clone()));
            }
        }
    }
}

/// Why something was left out or changed, for the author.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticKind {
    /// A step's target is not published (or does not exist: the two are not told apart).
    StepUnavailable,
    /// A transition was dropped so it would not claim more than was written.
    TransitionDropped,
    /// A basis is not a published influence between the two steps; the rest of the transition stands.
    BasisUnavailable,
    /// Fewer than two steps are published, so the path is not published.
    PathWithheld,
}

/// An author-facing finding scoped to a path and, where it has one, a step.
/// It names ids only. It is for the author and is never written to a page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub path: String,
    pub step: Option<String>,
    pub kind: DiagnosticKind,
    pub message: String,
}

impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.step {
            Some(step) => write!(
                f,
                "reading path `{}`, step `{}`: {}",
                self.path, step, self.message
            ),
            None => write!(f, "reading path `{}`: {}", self.path, self.message),
        }
    }
}

/// The published reading paths: an allowlist of what a page, a feed or an
/// export may show.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPaths {
    pub format: &'static str,
    pub format_version: u64,
    /// Sorted by slug.
    pub paths: Vec<PublicPath>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPath {
    pub slug: String,
    pub url: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// In the author's order, at least two.
    pub steps: Vec<PublicStep>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicStep {
    pub id: String,
    /// One-based among the published steps.
    pub position: usize,
    /// `post` or `atlas`.
    pub kind: &'static str,
    /// The kind in words ("Post", "Person").
    pub kind_label: &'static str,
    /// The post slug or atlas entry id.
    pub target: String,
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prerequisites: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub difficulty: Option<Difficulty>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<PublicTransition>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicTransition {
    pub relationship: Relationship,
    pub label: &'static str,
    pub why: String,
    /// A published atlas relationship id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub basis: Option<String>,
}

/// The public projection and the author's diagnostics, both deterministic.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    pub paths: PublicPaths,
    pub diagnostics: Vec<Diagnostic>,
}

impl PublicPaths {
    /// Resolves `paths` against `targets`. Draft paths are not published and
    /// are not reported. Never fails: whatever cannot be published is left out.
    pub fn resolve(paths: &[ReadingPath], targets: &PublishedTargets) -> Resolution {
        let mut sorted: Vec<&ReadingPath> = paths
            .iter()
            .filter(|p| p.status == Status::Published)
            .collect();
        sorted.sort_by(|a, b| a.slug.cmp(&b.slug));
        let mut diagnostics = Vec::new();
        let mut out = Vec::new();
        for path in sorted {
            let steps = resolve_steps(path, targets, &mut diagnostics);
            if steps.len() < 2 {
                diagnostics.push(Diagnostic {
                    path: path.slug.clone(),
                    step: None,
                    kind: DiagnosticKind::PathWithheld,
                    message: format!(
                        "only {} of its steps are published and a path needs two, so it is not published",
                        steps.len()
                    ),
                });
                continue;
            }
            out.push(PublicPath {
                slug: path.slug.clone(),
                url: format!("{PATHS_URL}{}/", path.slug),
                title: path.title.clone(),
                summary: path.summary.clone(),
                steps,
            });
        }
        Resolution {
            paths: PublicPaths {
                format: PUBLIC_PATHS_FORMAT,
                format_version: PUBLIC_PATHS_FORMAT_VERSION,
                paths: out,
            },
            diagnostics,
        }
    }

    /// The projection as JSON safe to embed in HTML (`<`, `>` and `&` escaped).
    pub fn to_json(&self) -> String {
        escaped_json(self)
    }
}

fn resolve_steps(
    path: &ReadingPath,
    targets: &PublishedTargets,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<PublicStep> {
    let diag = |step: &Step, kind, message: String| Diagnostic {
        path: path.slug.clone(),
        step: Some(step.id.clone()),
        kind,
        message,
    };
    let mut steps: Vec<PublicStep> = Vec::new();
    let mut previous: Option<&Step> = None;
    // Whether the step just before this one made it into `steps`.
    let mut previous_published = false;
    for step in &path.steps {
        let found = match &step.target {
            Target::Post { slug } => targets
                .posts
                .get(slug)
                .map(|(title, url)| ("post", "Post", slug.clone(), title.clone(), url.clone())),
            Target::Atlas { id } => targets
                .entries
                .get(id)
                .map(|(label, url, kind)| ("atlas", *kind, id.clone(), label.clone(), url.clone())),
        };
        let Some((kind, kind_label, target, title, url)) = found else {
            diagnostics.push(diag(
                step,
                DiagnosticKind::StepUnavailable,
                format!(
                    "{} is not published, so the step is left out",
                    step.target.key()
                ),
            ));
            previous = Some(step);
            previous_published = false;
            continue;
        };
        let mut transition = None;
        if let Some(t) = &step.transition {
            if !previous_published {
                diagnostics.push(diag(
                    step,
                    DiagnosticKind::TransitionDropped,
                    "the step before it is left out, so its transition would describe a step the reader does not see".into(),
                ));
            } else {
                transition = resolve_transition(t, previous, step, targets, diagnostics, &diag);
            }
        }
        steps.push(PublicStep {
            id: step.id.clone(),
            position: steps.len() + 1,
            kind,
            kind_label,
            target,
            title,
            url,
            rationale: step.rationale.clone(),
            prerequisites: step.prerequisites.clone(),
            difficulty: step.difficulty,
            optional: step.optional,
            transition,
        });
        previous = Some(step);
        previous_published = true;
    }
    steps
}

fn resolve_transition(
    t: &Transition,
    previous: Option<&Step>,
    step: &Step,
    targets: &PublishedTargets,
    diagnostics: &mut Vec<Diagnostic>,
    diag: &dyn Fn(&Step, DiagnosticKind, String) -> Diagnostic,
) -> Option<PublicTransition> {
    let mut basis = t.basis.clone();
    if let Some(id) = &t.basis {
        // Where an end is an atlas entry, the published influence must run
        // from the previous step to this one.
        let joins = targets.influences.get(id).is_some_and(|(from, to)| {
            let end = |target: Option<&Target>| match target {
                Some(Target::Atlas { id }) => Some(id.clone()),
                _ => None,
            };
            end(previous.map(|p| &p.target)).is_none_or(|p| &p == from)
                && end(Some(&step.target)).is_none_or(|s| &s == to)
        });
        if !joins {
            basis = None;
            if t.relationship == Relationship::Influenced {
                diagnostics.push(diag(
                    step,
                    DiagnosticKind::TransitionDropped,
                    format!("`influenced` rests on `{id}`, which is not a published influence from the previous step to this one, so the transition is dropped"),
                ));
                return None;
            }
            diagnostics.push(diag(
                step,
                DiagnosticKind::BasisUnavailable,
                format!("basis `{id}` is not a published influence from the previous step to this one, so it is not shown"),
            ));
        }
    }
    Some(PublicTransition {
        relationship: t.relationship,
        label: t.relationship.label(),
        why: t.why.clone(),
        basis,
    })
}

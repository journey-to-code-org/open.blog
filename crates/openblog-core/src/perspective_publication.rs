//! Approved Third Perspectives as the site publishes them (#222, ADR 0115).
//!
//! When a moderator approves a Third Perspective, Admin copies the parts the
//! one public projection reads ([`crate::third_perspective::ApprovedResponse`],
//! ADR 0111) into `third-perspectives.json` in the content folder, beside the
//! posts and `reader-feedback.json`. The file is versioned with the site, so
//! a static build, a CI build and a site that left its hosted service keep
//! showing what was approved, and nothing needs the service to read a page.
//!
//! The file holds only what may be public, because a site's repository can
//! be: the work and the post it is about, the passage revision and target
//! the reader wrote about, the optional prompt category, the text, the day it
//! was received and the day it was approved, and the reader's name only
//! while both the approved and the current consent showed it and it matched
//! no credited name. Never the receipt or its digest, the consent records,
//! the reader's clock, a time of day, the channel, a private name, a
//! moderator, a reason or anything about a copy that is not approved.
//!
//! A post shows its Third Perspectives through [`project_post`], which
//! re-applies the projection against the post as published now: only where
//! RD12's published mode shows approved items, never with a name the work
//! credits now, and with a section target's standing in the current text.
//! Only the canonical page shows them; portable copies, feeds and `llms`
//! files carry a labelled link to it instead (P6.2).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::SiteConfig;
use crate::date::DateTime;
use crate::escape::{attr, text};
use crate::feedback_publication::{is_day, is_post_source};
use crate::model::Post;
use crate::participation::ParticipationMode;
use crate::passage_target::{is_passage_revision, normalize_passage_text, PassageDocument};
use crate::scholarly_feedback::is_uuid;
use crate::third_perspective::{
    is_work_path, normalize_body, project, About, ApprovedResponse, HostedPerspective,
    ModerationFacts, PerspectiveTarget, PublicParts, PublishedWork, ResponseCategory, TargetStatus,
    MAX_READER_NAME_CHARS,
};

/// The file's name, in the content folder.
pub const THIRD_PERSPECTIVES_FILE: &str = "third-perspectives.json";
/// The version of the file format; a reader refuses a higher one.
pub const THIRD_PERSPECTIVES_VERSION: u64 = 1;
/// The id of the section of a post's canonical page that lists them.
pub const THIRD_PERSPECTIVES_ANCHOR: &str = "ob-third-perspectives";
/// The capability a post with Third Perspectives carries, so portable copies
/// and feeds link to the canonical page (P6.2).
pub const THIRD_PERSPECTIVES_CAPABILITY: &str = "third-perspectives";
/// The most reflections the file holds.
pub const MAX_PUBLISHED_PERSPECTIVES: usize = 2_000;
/// The largest file accepted, before it is parsed.
pub const MAX_THIRD_PERSPECTIVES_BYTES: usize = 8 * 1024 * 1024;

/// One approved Third Perspective as the file stores it: exactly the parts
/// the public projection reads, and the ids that keep it in place.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublishedPerspective {
    /// The hosted row's id, so the same reflection is never published twice.
    pub id: String,
    /// The post's source path in the content folder.
    pub post: String,
    /// The address the reader wrote about.
    pub work: String,
    /// The passage revision the reader saw.
    pub revision: String,
    pub target: PerspectiveTarget,
    pub category: Option<ResponseCategory>,
    pub body: String,
    /// The day the site received it, `YYYY-MM-DD`.
    pub received: String,
    /// The day it was approved, `YYYY-MM-DD`.
    pub approved: String,
    /// The reader's name, present only while the approved and the current
    /// consent showed it and it matched no name the work credited.
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WireItem {
    id: String,
    post: String,
    work: String,
    revision: String,
    target: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    body: String,
    received: String,
    approved: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireFile {
    #[allow(dead_code)]
    version: u64,
    items: Vec<Value>,
}

impl PublishedPerspective {
    /// The public part of a hosted copy approved now, for `post` (its source
    /// path is `source`). Refused unless the one projection shows it now:
    /// approved at its current text revision, under an approved and a current
    /// consent that both allow publication, about this work. The name kept is
    /// the one the projection shows.
    pub fn from_hosted(
        source: &str,
        hosted: &HostedPerspective,
        post: &Post,
        config: &SiteConfig,
        approved: DateTime,
    ) -> Result<Self, String> {
        let copy = &hosted.copy;
        let work = PublishedWork::of_post(post, config);
        let document = PassageDocument::of_post(post, config);
        let target = TargetStatus::from(
            &document.resolve(&copy.provenance.target, Some(&copy.provenance.revision)),
        );
        let facts = ModerationFacts {
            state: hosted.state,
            revision: copy.revision,
            approved_revision: hosted.approved_revision,
            approved_consent: hosted.approved_consent,
            clarification_asked: hosted.clarification_asked,
            content_retained: true,
        };
        let response = copy
            .approved_response(&facts, ParticipationMode::Open, &work, &target)
            .ok_or_else(|| {
                "This reflection may not be shown now: it is not approved at its current text under a consent that allows publication, or it is about another work.".to_string()
            })?;
        let item = Self {
            id: hosted.id.to_ascii_lowercase(),
            post: source.to_string(),
            work: copy.provenance.work.clone(),
            revision: copy.provenance.revision.clone(),
            target: PerspectiveTarget::try_from(copy.provenance.target.clone())
                .map_err(|error| error.message)?,
            category: copy.category,
            body: copy.body.clone(),
            received: response.received.clone(),
            approved: approved.ymd().max(response.received.clone()),
            name: response.name,
        };
        item.validate()?;
        Ok(item)
    }

    fn validate(&self) -> Result<(), String> {
        if !is_uuid(&self.id) || self.id != self.id.to_ascii_lowercase() {
            return Err("`id` must be a lowercase UUID".into());
        }
        if !is_post_source(&self.post) {
            return Err(
                "`post` must be a post's source path in the content folder, such as posts/tides.md"
                    .into(),
            );
        }
        if !is_work_path(&self.work) {
            return Err("`work` must be the site path the reader wrote about".into());
        }
        if !is_passage_revision(&self.revision) {
            return Err("`revision` must be a passage revision".into());
        }
        self.target
            .validate()
            .map_err(|error| format!("`target`: {}", error.message))?;
        if normalize_body(&self.body).as_deref() != Some(self.body.as_str()) {
            return Err("`body` must be 1 to 4000 characters of plain text, trimmed".into());
        }
        if !is_day(&self.received) || !is_day(&self.approved) {
            return Err("`received` and `approved` must be days written YYYY-MM-DD".into());
        }
        if self.approved < self.received {
            return Err("`approved` is earlier than `received`".into());
        }
        if let Some(name) = &self.name {
            let count = name.chars().count();
            if count == 0
                || count > MAX_READER_NAME_CHARS
                || normalize_passage_text(name) != *name
                || name
                    .chars()
                    .any(|c| c.is_control() || crate::research_notes::bidi_override(c))
            {
                return Err(format!(
                    "`name` must be 1 to {MAX_READER_NAME_CHARS} characters of plain text"
                ));
            }
        }
        Ok(())
    }

    fn from_value(value: &Value) -> Result<Self, String> {
        let wire: WireItem = serde_json::from_value(value.clone()).map_err(|_| {
            "has a field this version does not define, or a field of the wrong type".to_string()
        })?;
        let category = wire
            .category
            .map(|id| {
                ResponseCategory::from_id(&id)
                    .ok_or_else(|| "`category` is not a response category".to_string())
            })
            .transpose()?;
        let target = PerspectiveTarget::from_value(&wire.target)
            .map_err(|error| format!("`target`: {}", error.message))?;
        let item = Self {
            id: wire.id,
            post: wire.post,
            work: wire.work,
            revision: wire.revision,
            target,
            category,
            body: wire.body,
            received: wire.received,
            approved: wire.approved,
            name: wire.name,
        };
        item.validate()?;
        Ok(item)
    }

    fn to_wire(&self) -> WireItem {
        WireItem {
            id: self.id.clone(),
            post: self.post.clone(),
            work: self.work.clone(),
            revision: self.revision.clone(),
            target: self.target.to_value(),
            category: self.category.map(|category| category.id().to_string()),
            body: self.body.clone(),
            received: self.received.clone(),
            approved: self.approved.clone(),
            name: self.name.clone(),
        }
    }

    /// Its public form on `work` as published now, through the one
    /// projection, or `None` where it may not be shown.
    pub fn response(
        &self,
        mode: ParticipationMode,
        work: &PublishedWork,
        target: &TargetStatus,
    ) -> Option<ApprovedResponse> {
        project(
            PublicParts {
                work: &self.work,
                revision: &self.revision,
                target: self.target.passage_target(),
                category: self.category,
                body: &self.body,
                name: self.name.as_deref(),
                received: self.received.clone(),
            },
            mode,
            work,
            target,
        )
    }
}

/// Every approved Third Perspective the site publishes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThirdPerspectivesFile {
    pub items: Vec<PublishedPerspective>,
}

impl ThirdPerspectivesFile {
    /// Read the file, refusing a newer version, an unknown field or any
    /// broken rule, naming the item and never what it holds. Nothing is
    /// repaired or dropped.
    pub fn from_json(text: &str) -> Result<Self, String> {
        if text.len() > MAX_THIRD_PERSPECTIVES_BYTES {
            return Err(format!(
                "is larger than {MAX_THIRD_PERSPECTIVES_BYTES} bytes"
            ));
        }
        let value: Value =
            serde_json::from_str(text).map_err(|_| "is not valid JSON".to_string())?;
        match value.get("version").and_then(Value::as_u64) {
            Some(THIRD_PERSPECTIVES_VERSION) => {}
            Some(version) if version > THIRD_PERSPECTIVES_VERSION => {
                return Err(format!(
                    "is version {version}, newer than the version {THIRD_PERSPECTIVES_VERSION} this open.blog reads"
                ))
            }
            _ => return Err("needs `version` 1".into()),
        }
        let wire: WireFile = serde_json::from_value(value)
            .map_err(|_| "needs only `version` and an `items` list".to_string())?;
        if wire.items.len() > MAX_PUBLISHED_PERSPECTIVES {
            return Err(format!(
                "has {} items; keep at most {MAX_PUBLISHED_PERSPECTIVES}",
                wire.items.len()
            ));
        }
        let mut items = Vec::with_capacity(wire.items.len());
        let mut ids = std::collections::BTreeSet::new();
        for (index, value) in wire.items.iter().enumerate() {
            let item = PublishedPerspective::from_value(value)
                .map_err(|error| format!("item {}: {error}", index + 1))?;
            if !ids.insert(item.id.clone()) {
                return Err(format!(
                    "item {}: repeats the id of an earlier item",
                    index + 1
                ));
            }
            items.push(item);
        }
        Ok(Self { items })
    }

    /// Canonical text: items sorted by post, day received and id, two-space
    /// indentation and a final line break, so a change shows as a small diff.
    pub fn to_json(&self) -> String {
        let mut items: Vec<&PublishedPerspective> = self.items.iter().collect();
        items.sort_by(|a, b| {
            (a.post.as_str(), a.received.as_str(), a.id.as_str()).cmp(&(
                b.post.as_str(),
                b.received.as_str(),
                b.id.as_str(),
            ))
        });
        let value = json!({
            "version": THIRD_PERSPECTIVES_VERSION,
            "items": items.iter().map(|item| item.to_wire()).collect::<Vec<_>>(),
        });
        let mut out = serde_json::to_string_pretty(&value).expect("Third Perspectives serialize");
        out.push('\n');
        out
    }

    pub fn get(&self, id: &str) -> Option<&PublishedPerspective> {
        self.items.iter().find(|item| item.id == id)
    }

    /// Add a reflection, or replace one already published.
    pub fn publish(&mut self, item: PublishedPerspective) -> Result<(), String> {
        if let Some(existing) = self
            .items
            .iter_mut()
            .find(|existing| existing.id == item.id)
        {
            *existing = item;
            return Ok(());
        }
        if self.items.len() >= MAX_PUBLISHED_PERSPECTIVES {
            return Err(format!(
                "the site already publishes {MAX_PUBLISHED_PERSPECTIVES} Third Perspectives"
            ));
        }
        self.items.push(item);
        Ok(())
    }

    /// Take a reflection off the site; whether it was there.
    pub fn unpublish(&mut self, id: &str) -> bool {
        let before = self.items.len();
        self.items.retain(|item| item.id != id);
        self.items.len() != before
    }

    /// The reflections about one post, oldest first. Nothing orders them by
    /// popularity: there is nothing to count.
    pub fn for_post(&self, source: &str) -> Vec<&PublishedPerspective> {
        let mut items: Vec<&PublishedPerspective> = self
            .items
            .iter()
            .filter(|item| item.post == source)
            .collect();
        items.sort_by(|a, b| (&a.received, &a.id).cmp(&(&b.received, &b.id)));
        items
    }
}

/// One Third Perspective as a post's canonical page shows it: the one public
/// projection, plus the hosted id an abuse report names (a random UUID, the
/// same public handle published notes and comments carry) and the title of
/// the section it is about now. Neither joins the projection itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPerspective {
    pub id: String,
    pub response: ApprovedResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_title: Option<String>,
}

/// The public form of a post's approved Third Perspectives, read against the
/// post as it is published now under RD12's published `mode` for the kind.
/// A record about another address (the post moved) is not shown.
pub fn project_post(
    items: &[&PublishedPerspective],
    post: &Post,
    config: &SiteConfig,
    mode: ParticipationMode,
) -> Vec<PublicPerspective> {
    let work = PublishedWork::of_post(post, config);
    let document = PassageDocument::of_post(post, config);
    let titles = crate::feedback_moderation::section_titles(post, &document);
    items
        .iter()
        .filter_map(|item| {
            let target = TargetStatus::from(
                &document.resolve(item.target.passage_target(), Some(&item.revision)),
            );
            let response = item.response(mode, &work, &target)?;
            let section_title = response.section.as_deref().and_then(|anchor| {
                document
                    .sections
                    .iter()
                    .position(|section| section.anchor.as_deref() == Some(anchor))
                    .and_then(|index| titles.get(index).cloned().flatten())
            });
            Some(PublicPerspective {
                id: item.id.clone(),
                response,
                section_title,
            })
        })
        .collect()
}

fn paragraphs(value: &str) -> String {
    value
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .map(|paragraph| {
            format!(
                "<p>{}</p>",
                paragraph
                    .split('\n')
                    .map(text)
                    .collect::<Vec<_>>()
                    .join("<br>\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The section of a post's canonical page that lists its approved Third
/// Perspectives: static, semantic HTML that needs no script, apart from the
/// authors' text and after it. Each is headed as a reader's, never an
/// author's or the group's; every value is escaped. With `reports`, the
/// hosted endpoint while abuse reports are open (ADR 0107), each carries a
/// progressive report form whose static text works without it.
pub fn render_section(items: &[PublicPerspective], reports: Option<&str>) -> String {
    if items.is_empty() {
        return String::new();
    }
    let anchor = THIRD_PERSPECTIVES_ANCHOR;
    let mut html = format!(
        "<section id=\"{anchor}\" class=\"ob-third-perspectives\" aria-labelledby=\"{anchor}-title\">\n<h2 id=\"{anchor}-title\">Third Perspectives</h2>\n<p>Reflections readers offered on this work, each shown as a reader’s, never as one of the authors’. Each was approved by a moderator and is shown only as its reader agreed. Publishing one does not mean the authors agree with it, and nothing here is ranked.</p>\n<ol class=\"ob-third-perspectives-list\">\n"
    );
    for item in items {
        let response = &item.response;
        let id = format!("ob-perspective-{}", attr(&item.id));
        let place = match (response.about, &response.section) {
            (About::Work, _) => "About the whole work".to_string(),
            (About::Section, Some(section)) => format!(
                "About <a href=\"#{}\">{}</a>{}",
                attr(section),
                text(item.section_title.as_deref().unwrap_or(section)),
                if response.stale {
                    ", since revised"
                } else {
                    ""
                }
            ),
            (About::Section, None) if response.stale => {
                "About a section since revised or removed".to_string()
            }
            (About::Section, None) => "About the opening".to_string(),
        };
        let mut meta = vec![place];
        if let Some(category) = response.category {
            meta.push(format!("Prompt: {}", text(category.label())));
        }
        meta.push(format!(
            "received <time datetime=\"{0}\">{0}</time>",
            attr(&response.received)
        ));
        html.push_str(&format!(
            "<li><article class=\"ob-perspective\" id=\"{id}\" aria-labelledby=\"{id}-title\">\n<h3 id=\"{id}-title\">{}</h3>\n<p class=\"ob-perspective-meta\">{}</p>\n",
            text(&response.heading()),
            meta.join(" · ")
        ));
        if response.earlier_revision {
            html.push_str("<p class=\"ob-perspective-earlier\">Written about an earlier version of this work.</p>\n");
        }
        html.push_str(&paragraphs(&response.body));
        html.push('\n');
        if let Some(endpoint) = reports {
            html.push_str(&format!(
                "<ob-abuse-report endpoint=\"{}\" source=\"feedback\" item=\"{}\" subject=\"this reflection\"><p class=\"ob-abuse-report-static\">To report this reflection as abusive, write to the author.</p></ob-abuse-report>\n",
                attr(endpoint),
                attr(&item.id)
            ));
        }
        html.push_str("</article></li>\n");
    }
    html.push_str("</ol>\n</section>\n");
    html
}

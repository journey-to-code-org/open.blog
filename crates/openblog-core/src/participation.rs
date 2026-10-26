//! Which kinds of reader participation a site and a post accept (ADR 0100).
//!
//! Every way a reader or an author can add to a published post (a comment, a
//! passage question, a suggested source or correction, another interpretation,
//! a Third Perspective, an author response, an abuse report) is one
//! [`ParticipationKind`] in one closed registry. Each kind has a site setting
//! in `openblog.json` (`participation.kinds`) and may have a per-post mode in
//! front matter (`participation:`), except comments, which keep their existing
//! `engagement.comments` switch and `comments:` front matter unchanged.
//!
//! Everything new is off: a kind the site has not named is `off`, and nothing
//! a post says can turn it on. Moderation of what a kind receives is
//! [`crate::moderation`]; every kind starts pending there.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::config::SiteConfig;
use crate::model::{CommentsPolicy, Post, Site};
use crate::moderation::RetentionPolicy;

/// One way to participate. The set is closed and owned by code: an id this
/// version does not know is refused, never guessed. Adding a kind adds a
/// variant whose site setting defaults to `off`, so no existing site changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ParticipationKind {
    /// A reader's comment on the whole post: the existing hosted comments.
    Comment,
    /// A question about a passage (B5, the `question` of ADR 0079, typed scholarly feedback kinds).
    Question,
    /// A source a reader thinks bears on a passage (`source-suggestion`).
    SourceSuggestion,
    /// Wording a reader thinks is wrong. Never a correction before an author
    /// decides (`correction-suggestion`).
    CorrectionSuggestion,
    /// Another reading of a passage (`alternative-interpretation`).
    AlternativeInterpretation,
    /// A reader's own interpretation of a collaborative work, about the whole
    /// work or one section (RD10).
    ThirdPerspective,
    /// An author's public reply to one approved item (#83, RD11).
    AuthorResponse,
    /// A reader's report that an approved, public item is abusive. Never
    /// public itself.
    AbuseReport,
}

/// Who creates a kind's items.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    /// Any reader, through the public submission path, without an account.
    Reader,
    /// An authenticated author of the post (site Admin, coordinator or
    /// contributing author of the work).
    Author,
}

/// What a kind's item points at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetShape {
    /// The whole published work.
    Work,
    /// A passage target (B5, ADR 0076, passage targets): the work, a section or a quotation.
    Passage,
    /// The whole work or one of its sections.
    WorkOrSection,
    /// Another participation item on the same work.
    Item,
}

/// The fixed rules of one kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KindRules {
    pub origin: Origin,
    pub target: TargetShape,
    /// Whether an approved item may be shown to readers. An abuse report never is.
    pub publishable: bool,
    /// Whether a moderator may ask the submitter to clarify (with the
    /// submitter's consent). Authors and reporters are never asked.
    pub clarification: bool,
    /// Whether a post may set this kind's mode in its `participation:` front
    /// matter. Comments use `comments:`; abuse reports are site-wide.
    pub per_post: bool,
}

impl ParticipationKind {
    pub const ALL: [ParticipationKind; 8] = [
        ParticipationKind::Comment,
        ParticipationKind::Question,
        ParticipationKind::SourceSuggestion,
        ParticipationKind::CorrectionSuggestion,
        ParticipationKind::AlternativeInterpretation,
        ParticipationKind::ThirdPerspective,
        ParticipationKind::AuthorResponse,
        ParticipationKind::AbuseReport,
    ];

    /// The stored id: lowercase letters, digits and hyphens, at most 40
    /// characters, the shape the `kind` column of ADR 0080 (hosted feedback table) accepts.
    pub fn id(self) -> &'static str {
        match self {
            ParticipationKind::Comment => "comment",
            ParticipationKind::Question => "question",
            ParticipationKind::SourceSuggestion => "source-suggestion",
            ParticipationKind::CorrectionSuggestion => "correction-suggestion",
            ParticipationKind::AlternativeInterpretation => "alternative-interpretation",
            ParticipationKind::ThirdPerspective => "third-perspective",
            ParticipationKind::AuthorResponse => "author-response",
            ParticipationKind::AbuseReport => "abuse-report",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.id() == id)
    }

    /// A label for moderators and forms. It names an intent, never a verdict.
    pub fn label(self) -> &'static str {
        match self {
            ParticipationKind::Comment => "Comment",
            ParticipationKind::Question => "Question",
            ParticipationKind::SourceSuggestion => "Suggested source",
            ParticipationKind::CorrectionSuggestion => "Suggested correction",
            ParticipationKind::AlternativeInterpretation => "Another interpretation",
            ParticipationKind::ThirdPerspective => "Third Perspective",
            ParticipationKind::AuthorResponse => "Author response",
            ParticipationKind::AbuseReport => "Abuse report",
        }
    }

    pub fn rules(self) -> KindRules {
        use ParticipationKind::*;
        let reader = |target, clarification| KindRules {
            origin: Origin::Reader,
            target,
            publishable: true,
            clarification,
            per_post: true,
        };
        match self {
            Comment => KindRules {
                per_post: false,
                ..reader(TargetShape::Work, false)
            },
            Question | SourceSuggestion | CorrectionSuggestion | AlternativeInterpretation => {
                reader(TargetShape::Passage, true)
            }
            ThirdPerspective => reader(TargetShape::WorkOrSection, true),
            AuthorResponse => KindRules {
                origin: Origin::Author,
                target: TargetShape::Item,
                publishable: true,
                clarification: false,
                per_post: true,
            },
            AbuseReport => KindRules {
                origin: Origin::Reader,
                target: TargetShape::Item,
                publishable: false,
                clarification: false,
                per_post: false,
            },
        }
    }

    /// Whether the site may give this kind `setting`. Comments are not set
    /// here at all; an abuse report is either off or open for the whole site.
    fn accepts_site_setting(self, setting: SiteSetting) -> Result<(), String> {
        match (self, setting) {
            (ParticipationKind::Comment, _) => Err(
                "participation.kinds cannot set `comment`; comments keep `engagement.comments` \
                 and each post's `comments:`"
                    .into(),
            ),
            (ParticipationKind::AbuseReport, SiteSetting::Off | SiteSetting::Open) => Ok(()),
            (ParticipationKind::AbuseReport, _) => {
                Err("participation.kinds.abuse-report must be `off` or `open`".into())
            }
            _ => Ok(()),
        }
    }
}

impl fmt::Display for ParticipationKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.id())
    }
}

impl Serialize for ParticipationKind {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.id())
    }
}

impl<'de> Deserialize<'de> for ParticipationKind {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let id = String::deserialize(deserializer)?;
        ParticipationKind::from_id(&id).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "unknown participation kind `{}`",
                id.escape_debug()
            ))
        })
    }
}

/// How one kind behaves on one post: the existing three comment modes,
/// applied to every kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ParticipationMode {
    /// Nothing is shown and nothing is accepted.
    Hidden,
    /// Approved items are shown; nothing new is accepted.
    Locked,
    /// Approved items are shown and new items are accepted, pending moderation.
    Open,
}

impl ParticipationMode {
    pub const ALL: [ParticipationMode; 3] = [
        ParticipationMode::Hidden,
        ParticipationMode::Locked,
        ParticipationMode::Open,
    ];

    pub fn id(self) -> &'static str {
        match self {
            ParticipationMode::Hidden => "hidden",
            ParticipationMode::Locked => "locked",
            ParticipationMode::Open => "open",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|mode| mode.id() == id)
    }

    /// Whether approved items of the kind may be shown.
    pub fn shows_approved(self) -> bool {
        self != ParticipationMode::Hidden
    }
}

impl From<CommentsPolicy> for ParticipationMode {
    fn from(policy: CommentsPolicy) -> Self {
        match policy {
            CommentsPolicy::Open => ParticipationMode::Open,
            CommentsPolicy::Locked => ParticipationMode::Locked,
            CommentsPolicy::Hidden => ParticipationMode::Hidden,
        }
    }
}

/// A kind's site-wide setting in `openblog.json`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SiteSetting {
    /// The kind does not exist on this site; front matter cannot enable it.
    #[default]
    Off,
    /// Each post's mode is its `comments:` setting unless the post names the
    /// kind. This is B5's interim rule (ADR 0081, hosted feedback transport), kept as an explicit choice.
    FollowComments,
    /// Enabled; posts that do not name the kind are hidden for it.
    Hidden,
    /// Enabled; posts that do not name the kind are locked for it.
    Locked,
    /// Enabled; posts that do not name the kind are open for it.
    Open,
}

/// The `participation` object of `openblog.json`. Omitted from the written
/// file while it has its defaults, so existing projects keep their
/// configuration byte for byte.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ParticipationConfig {
    /// Site settings by kind id. A kind not named is `off`.
    pub kinds: BTreeMap<ParticipationKind, SiteSetting>,
    /// How long moderation keeps what it does not publish (ADR 0103). Unset,
    /// the default periods apply to every kind except comments, so a site
    /// that never mentions retention keeps its comments as before; set (even
    /// as `{}`), the periods apply to comments too.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention: Option<RetentionPolicy>,
}

impl ParticipationConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    /// The site setting of a kind other than comments; `off` unless named.
    pub fn setting(&self, kind: ParticipationKind) -> SiteSetting {
        self.kinds.get(&kind).copied().unwrap_or_default()
    }

    /// Whether any kind beyond comments is switched on.
    pub fn any_enabled(&self) -> bool {
        self.kinds
            .values()
            .any(|setting| *setting != SiteSetting::Off)
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        for (kind, setting) in &self.kinds {
            kind.accepts_site_setting(*setting)?;
        }
        self.retention
            .as_ref()
            .map_or(Ok(()), RetentionPolicy::validate)
    }
}

/// A post's own modes from its `participation:` front matter, by kind.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PostParticipation {
    modes: BTreeMap<ParticipationKind, ParticipationMode>,
}

impl PostParticipation {
    /// Read `participation:` entries written `kind: mode`, as a block or an
    /// inline list. An unknown kind or mode, a repeated kind, `comment` or
    /// `abuse-report` is an error; a kind the site has switched off is
    /// accepted and has no effect.
    pub fn parse(entries: &[String]) -> Result<Self, String> {
        let mut modes = BTreeMap::new();
        for entry in entries {
            let Some((kind, mode)) = entry.split_once(':') else {
                return Err(format!(
                    "participation entries are `kind: mode`, found `{}`",
                    entry.escape_debug()
                ));
            };
            let (kind, mode) = (kind.trim(), mode.trim().to_ascii_lowercase());
            let kind = ParticipationKind::from_id(kind)
                .ok_or_else(|| format!("unknown participation kind `{}`", kind.escape_debug()))?;
            match kind {
                ParticipationKind::Comment => {
                    return Err("set comments with `comments:`, not `participation:`".into())
                }
                ParticipationKind::AbuseReport => {
                    return Err(
                        "abuse reports are set for the whole site in openblog.json, not per post"
                            .into(),
                    )
                }
                _ => {}
            }
            let mode = ParticipationMode::from_id(&mode).ok_or_else(|| {
                format!(
                    "participation `{}` must be `open`, `locked`, or `hidden`",
                    kind.id()
                )
            })?;
            if modes.insert(kind, mode).is_some() {
                return Err(format!("participation names `{}` twice", kind.id()));
            }
        }
        Ok(Self { modes })
    }

    pub fn get(&self, kind: ParticipationKind) -> Option<ParticipationMode> {
        self.modes.get(&kind).copied()
    }

    pub fn is_empty(&self) -> bool {
        self.modes.is_empty()
    }
}

/// Whether the site has a hosted participation transport at all: hosted
/// engagement on with an endpoint. Without it every kind is hidden, and
/// pages read exactly as static pages.
pub fn transport_available(config: &SiteConfig) -> bool {
    config.engagement.enabled && !config.engagement.endpoint.trim().is_empty()
}

/// The one answer to "how does `kind` behave on this post?" that pages, the
/// published manifests and portable output all use.
///
/// - No hosted transport: hidden.
/// - Comments: hidden when `engagement.comments` is off, otherwise the post's
///   `comments:` setting, exactly as before this policy existed.
/// - Any other kind: hidden when its site setting is `off`; otherwise the
///   post's own mode, or the site default, where `follow-comments` means the
///   post's `comments:` setting.
pub fn effective_mode(
    config: &SiteConfig,
    post: &Post,
    kind: ParticipationKind,
) -> ParticipationMode {
    if !transport_available(config) {
        return ParticipationMode::Hidden;
    }
    if kind == ParticipationKind::Comment {
        return if config.engagement.comments {
            post.comments.into()
        } else {
            ParticipationMode::Hidden
        };
    }
    let site = config.participation.setting(kind);
    let default = match site {
        SiteSetting::Off => return ParticipationMode::Hidden,
        SiteSetting::FollowComments => post.comments.into(),
        SiteSetting::Hidden => ParticipationMode::Hidden,
        SiteSetting::Locked => ParticipationMode::Locked,
        SiteSetting::Open => ParticipationMode::Open,
    };
    if !kind.rules().per_post {
        return default;
    }
    post.participation.get(kind).unwrap_or(default)
}

/// The public `openblog-participation.json` manifest: for each post, the
/// kinds that are not hidden and their modes. Missing means hidden. `None`
/// unless the site has a transport and switched on a kind beyond comments,
/// so every other site's output is unchanged.
pub fn manifest(site: &Site) -> Option<String> {
    let config = &site.config;
    if !transport_available(config) || !config.participation.any_enabled() {
        return None;
    }
    let mut posts: BTreeMap<&str, BTreeMap<&str, &str>> = BTreeMap::new();
    for post in &site.posts {
        let modes: BTreeMap<&str, &str> = ParticipationKind::ALL
            .into_iter()
            .map(|kind| (kind, effective_mode(config, post, kind)))
            .filter(|(_, mode)| *mode != ParticipationMode::Hidden)
            .map(|(kind, mode)| (kind.id(), mode.id()))
            .collect();
        if !modes.is_empty() {
            posts.insert(post.url.as_str(), modes);
        }
    }
    Some(serde_json::to_string(&posts).expect("participation manifest is serializable"))
}

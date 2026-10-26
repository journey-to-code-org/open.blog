//! Author-approved supplements and the reading modes that reveal them
//! (ADR 0170, ADR 0171).
//!
//! A supplement is a block quote the author marks with a first line
//! `[!supplement kind=definition level=guided] Optional title`. It is part of
//! the post file, so it exists only because the author wrote it into the post
//! they publish: nothing here is generated, imported or inferred, and a draft
//! or a post that has not opted in publishes none of it as a supplement.
//!
//! A reading mode only decides which supplements are shown. It never changes
//! the canonical prose, the citations, or the order of either. The one
//! transform here ([`transform`]) wraps each supplement in a labelled `div`,
//! leaves every other event untouched, and reports the events that belong to
//! supplements so the renderer can keep them out of the post's own prose.
//!
//! Markers that cannot be read stay ordinary block quotes, so the author's
//! words still appear, and each is reported as a [`Finding`] that names the
//! marker and nothing else.

use pulldown_cmark::{CowStr, Event, Parser, Tag, TagEnd};
use serde::Serialize;

use crate::escape;

/// The most supplements one post may carry; the rest stay block quotes.
pub const MAX_SUPPLEMENTS: usize = 200;
/// The deepest supplements may nest; a deeper marker stays a block quote.
pub const MAX_NESTING: usize = 3;
/// The longest kind token and supplement title, in characters.
pub const MAX_KIND_LENGTH: usize = 32;
pub const MAX_TITLE_LENGTH: usize = 120;
/// The most findings reported for one post.
pub const MAX_FINDINGS: usize = 50;
/// The largest Markdown [`scan`] reads.
pub const MAX_SCAN_BYTES: usize = 1024 * 1024;
/// The capability identifier a post with supplements reports.
pub const CAPABILITY_ID: &str = "guided-reading-supplements";
/// The prefix of every supplement id and of the one class and data names.
pub const ID_PREFIX: &str = "ob-supplement-";

/// How much supplementary context a reader chose. Local to the reader and
/// presentational only.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadingMode {
    Standard,
    Guided,
    DeepDive,
}

impl ReadingMode {
    pub const ALL: [ReadingMode; 3] = [Self::Standard, Self::Guided, Self::DeepDive];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Guided => "guided",
            Self::DeepDive => "deep-dive",
        }
    }

    /// Reads exactly the three names; anything else is not a mode.
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|mode| mode.as_str() == value)
    }

    /// Whether this mode shows a supplement of `level`: standard shows none,
    /// guided shows guided ones, deep-dive shows both.
    pub fn shows(self, level: Depth) -> bool {
        match self {
            Self::Standard => false,
            Self::Guided => level == Depth::Guided,
            Self::DeepDive => true,
        }
    }
}

/// The least mode that shows a supplement.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Depth {
    Guided,
    DeepDive,
}

impl Depth {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Guided => "guided",
            Self::DeepDive => "deep-dive",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "guided" => Some(Self::Guided),
            "deep-dive" => Some(Self::DeepDive),
            _ => None,
        }
    }

    fn words(self) -> &'static str {
        match self {
            Self::Guided => "guided supplement",
            Self::DeepDive => "deep-dive supplement",
        }
    }
}

/// What a supplement offers. Any other well-formed kind is kept as written.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Definition,
    Context,
    Evidence,
    Relationship,
    Comparison,
    FurtherReading,
    /// A kind this release does not know, or none was written. Still shown,
    /// still labelled, never dropped.
    Other,
}

impl Kind {
    fn known(token: &str) -> Self {
        match token {
            "definition" => Self::Definition,
            "context" => Self::Context,
            "evidence" => Self::Evidence,
            "relationship" => Self::Relationship,
            "comparison" => Self::Comparison,
            "further-reading" => Self::FurtherReading,
            _ => Self::Other,
        }
    }

    /// The depth a supplement takes when its marker names none: short
    /// explanations are guided, anything that goes further is deep-dive, and
    /// an unknown kind shows least often.
    pub fn default_depth(&self) -> Depth {
        match self {
            Self::Definition | Self::Context => Depth::Guided,
            _ => Depth::DeepDive,
        }
    }
}

/// One supplement as authored and as it will be shown.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Supplement {
    /// `ob-supplement-N`, N the order in the document. Positional: it names
    /// a place in this revision of the post and must not be stored elsewhere.
    pub id: String,
    pub kind: Kind,
    /// The kind as written (`further-reading`, or an unknown token), the one
    /// the label shows.
    pub kind_token: String,
    /// The depth the marker wrote, or the kind's default.
    pub depth: Depth,
    /// Whether the marker wrote no level.
    pub depth_defaulted: bool,
    /// The depth that decides visibility: a supplement is never shown while
    /// the supplement holding it is hidden, so it is at least its parent's.
    pub effective_depth: Depth,
    pub title: Option<String>,
    /// The id of the supplement it is written inside, if any.
    pub parent: Option<String>,
    pub nesting: usize,
}

/// A marker that was not read, or a supplement the renderer adjusted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// The start of the marker line, bounded; never anything after it.
    pub marker: String,
    pub message: String,
}

/// Every supplement of one post, in document order, and what was reported.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingDepth {
    pub supplements: Vec<Supplement>,
    pub findings: Vec<Finding>,
}

impl ReadingDepth {
    /// The supplements `mode` shows, in document order.
    pub fn visible(&self, mode: ReadingMode) -> Vec<&Supplement> {
        self.supplements
            .iter()
            .filter(|supplement| mode.shows(supplement.effective_depth))
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.supplements.is_empty()
    }
}

/// Reads the supplements of Markdown without rendering it. Markdown over
/// [`MAX_SCAN_BYTES`] reads as having none, with one finding.
pub fn scan(markdown: &str) -> ReadingDepth {
    if markdown.len() > MAX_SCAN_BYTES {
        return ReadingDepth {
            supplements: Vec::new(),
            findings: vec![Finding {
                marker: String::new(),
                message: "The Markdown is too large to read supplements from.".to_string(),
            }],
        };
    }
    let events = Parser::new_ext(markdown, crate::markdown::parser_options(false)).collect();
    transform(events, true).depth
}

/// The result of [`transform`].
pub(crate) struct Transformed<'a> {
    pub events: Vec<Event<'a>>,
    /// Parallel to `events`: whether the event is part of a supplement.
    pub inside: Vec<bool>,
    pub depth: ReadingDepth,
}

struct Marker {
    kind_token: String,
    depth: Option<Depth>,
    title: Option<String>,
}

/// Wraps every readable supplement in its labelled `div` and leaves every
/// other event as it was. Headings inside a supplement become bold
/// paragraphs, so a mode never adds or removes an entry of the outline.
/// With `wrap` false the marker lines are dropped and nothing is added, for
/// the checks that read the post's own events.
pub(crate) fn transform(events: Vec<Event<'_>>, wrap: bool) -> Transformed<'_> {
    let mut out: Vec<Event> = Vec::with_capacity(events.len());
    let mut inside: Vec<bool> = Vec::with_capacity(events.len());
    let mut depth = ReadingDepth::default();
    // One entry per open block quote: the supplement it is, if it is one.
    let mut quotes: Vec<Option<usize>> = Vec::new();
    let mut index = 0;
    while index < events.len() {
        let nesting = quotes.iter().flatten().count();
        match &events[index] {
            Event::Start(Tag::BlockQuote(None)) => {
                let candidate = candidate(&events, index);
                let read = match candidate {
                    None => None,
                    Some(Err(finding)) => {
                        report(&mut depth, finding);
                        None
                    }
                    Some(Ok((marker, resume, whole))) => {
                        if nesting >= MAX_NESTING {
                            report(
                                &mut depth,
                                finding(&marker, "Supplements nest at most three deep."),
                            );
                            None
                        } else if depth.supplements.len() >= MAX_SUPPLEMENTS {
                            report(
                                &mut depth,
                                finding(&marker, "A post holds at most 200 supplements."),
                            );
                            None
                        } else {
                            Some((marker, resume, whole))
                        }
                    }
                };
                let Some((marker, resume, whole_paragraph)) = read else {
                    quotes.push(None);
                    out.push(events[index].clone());
                    inside.push(nesting > 0);
                    index += 1;
                    continue;
                };
                let ordinal = depth.supplements.len() + 1;
                let parent = quotes.iter().rev().flatten().next().copied();
                let kind = Kind::known(&marker.kind_token);
                let written = marker.depth;
                let own = written.unwrap_or_else(|| kind.default_depth());
                let parent_depth = parent.map(|p| depth.supplements[p].effective_depth);
                let effective = parent_depth.map_or(own, |p| p.max(own));
                let supplement = Supplement {
                    id: format!("{ID_PREFIX}{ordinal}"),
                    kind,
                    kind_token: marker.kind_token.clone(),
                    depth: own,
                    depth_defaulted: written.is_none(),
                    effective_depth: effective,
                    title: marker.title.clone(),
                    parent: parent.map(|p| depth.supplements[p].id.clone()),
                    nesting: nesting + 1,
                };
                if effective != own {
                    report(
                        &mut depth,
                        Finding {
                            marker: marker_text(&marker),
                            message:
                                "Written inside a deeper supplement, so it is shown only with it."
                                    .to_string(),
                        },
                    );
                }
                if wrap {
                    out.push(Event::Html(CowStr::from(open_tag(&supplement))));
                    inside.push(true);
                }
                depth.supplements.push(supplement);
                quotes.push(Some(depth.supplements.len() - 1));
                if whole_paragraph {
                    // The marker was the whole paragraph: drop it entirely.
                    index = resume + 1;
                } else {
                    // The paragraph goes on after the marker line.
                    out.push(events[index + 1].clone());
                    inside.push(true);
                    index = resume;
                }
                continue;
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                if let Some(Some(_)) = quotes.pop() {
                    out.push(Event::Html(CowStr::from("</div>\n")));
                    inside.push(true);
                } else {
                    out.push(events[index].clone());
                    inside.push(nesting > 0);
                }
            }
            Event::Start(Tag::Heading { .. }) if wrap && nesting > 0 => {
                out.push(Event::Html(CowStr::from(
                    "<p class=\"ob-supplement-heading\"><strong>",
                )));
                inside.push(true);
            }
            Event::End(TagEnd::Heading(_)) if wrap && nesting > 0 => {
                out.push(Event::Html(CowStr::from("</strong></p>\n")));
                inside.push(true);
            }
            Event::Start(Tag::BlockQuote(Some(_))) => {
                quotes.push(None);
                out.push(events[index].clone());
                inside.push(nesting > 0);
            }
            other => {
                out.push(other.clone());
                inside.push(nesting > 0);
            }
        }
        index += 1;
    }
    Transformed {
        events: out,
        inside,
        depth,
    }
}

fn report(depth: &mut ReadingDepth, finding: Finding) {
    if depth.findings.len() < MAX_FINDINGS {
        depth.findings.push(finding);
    }
}

fn finding(marker: &Marker, message: &str) -> Finding {
    Finding {
        marker: marker_text(marker),
        message: message.to_string(),
    }
}

fn marker_text(marker: &Marker) -> String {
    format!("[!supplement kind={}]", marker.kind_token)
}

/// Looks at the block quote starting at `at`: `None` when it is not a
/// supplement marker at all, an error when it starts like one but cannot be
/// read, else the marker, the index to resume at, and whether the marker was
/// the whole first paragraph.
#[allow(clippy::type_complexity)]
fn candidate<'a>(
    events: &[Event<'a>],
    at: usize,
) -> Option<Result<(Marker, usize, bool), Finding>> {
    if !matches!(events.get(at + 1), Some(Event::Start(Tag::Paragraph))) {
        return None;
    }
    let mut line = String::new();
    let mut end = at + 2;
    while let Some(Event::Text(text)) = events.get(end) {
        line.push_str(text);
        end += 1;
        if line.len() > 512 {
            break;
        }
    }
    let lowered = line.to_ascii_lowercase();
    let rest = lowered.strip_prefix("[!supplement")?;
    if !(rest.starts_with(']') || rest.starts_with(char::is_whitespace)) {
        return None;
    }
    let shown = line.chars().take(60).collect::<String>();
    let bad = |message: &str| {
        Some(Err(Finding {
            marker: shown.clone(),
            message: message.to_string(),
        }))
    };
    let Some(close) = line.find(']') else {
        return bad("The marker has no closing bracket; it is shown as a block quote.");
    };
    // The line must end here: only the title text may follow the bracket.
    let line_ends = matches!(
        events.get(end),
        Some(Event::SoftBreak | Event::HardBreak | Event::End(TagEnd::Paragraph))
    );
    if !line_ends {
        return bad("Formatting after the marker is not supported; it is shown as a block quote.");
    }
    let attributes = &line["[!supplement".len()..close];
    let mut kind_token = None;
    let mut depth = None;
    for part in attributes.split_whitespace() {
        let Some((key, value)) = part.split_once('=') else {
            return bad("Marker attributes are written key=value; it is shown as a block quote.");
        };
        match key.to_ascii_lowercase().as_str() {
            "kind" => {
                let value = value.to_ascii_lowercase();
                let valid = !value.is_empty()
                    && value.chars().count() <= MAX_KIND_LENGTH
                    && value.starts_with(|c: char| c.is_ascii_lowercase())
                    && value
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                    && !value.ends_with('-');
                if !valid || kind_token.replace(value).is_some() {
                    return bad(
                        "The kind is a lowercase word, written once; it is shown as a block quote.",
                    );
                }
            }
            "level" => match Depth::parse(&value.to_ascii_lowercase()) {
                Some(level) if depth.replace(level).is_none() => {}
                _ => return bad(
                    "The level is guided or deep-dive, written once; it is shown as a block quote.",
                ),
            },
            // Tolerant: a later release may add attributes.
            _ => {}
        }
    }
    let title = line[close + 1..].trim();
    let title =
        (!title.is_empty()).then(|| title.chars().take(MAX_TITLE_LENGTH).collect::<String>());
    let whole = matches!(events.get(end), Some(Event::End(TagEnd::Paragraph)));
    // Resume after the line terminator: the End(Paragraph) of a marker-only
    // paragraph, or the break that separates it from the rest.
    let resume = if whole { end } else { end + 1 };
    Some(Ok((
        Marker {
            kind_token: kind_token.unwrap_or_else(|| "supplement".to_string()),
            depth,
            title,
        },
        resume,
        whole,
    )))
}

fn label(token: &str) -> String {
    let words = token.replace('-', " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

fn open_tag(supplement: &Supplement) -> String {
    let label_id = format!("{}-label", supplement.id);
    let mut html = format!(
        "<div class=\"ob-supplement\" id=\"{id}\" role=\"group\" aria-labelledby=\"{label_id}\" data-ob-supplement data-ob-kind=\"{kind}\" data-ob-level=\"{level}\">\n\
<p class=\"ob-supplement-label\" id=\"{label_id}\"><strong class=\"ob-supplement-kind\">{name}</strong> <span class=\"ob-supplement-level\">{words}</span>",
        id = supplement.id,
        kind = supplement.kind_token,
        level = supplement.effective_depth.as_str(),
        name = escape::text(&label(&supplement.kind_token)),
        words = supplement.effective_depth.words(),
    );
    if let Some(title) = &supplement.title {
        html.push_str(&format!(
            " <span class=\"ob-supplement-title\">{}</span>",
            escape::text(title)
        ));
    }
    html.push_str("</p>\n");
    html
}

//! Media moments: attributed observations and quotations pinned to a place in a shared
//! reflection's source (ADR 0072, 0073).
//!
//! A moment points at one of the shared publication's own source references by id (never a copy
//! of the source, never a second identity) and at a position in it through the notebook's
//! [`Locator`]s: a timestamp or timestamp range for video and audio, and page, chapter, section,
//! line, canonical or `x-` locators for text. It holds, in separate fields that no consumer
//! confuses, the source's words (a [`Quotation`], with the speaker named apart from the source
//! and an explicit rights and provenance status) and the participant's own words (the
//! observation). The participant who made it is recorded from the authenticated requester, never
//! from a request body.
//!
//! The set is private collaboration state. Nothing here renders, publishes or fetches anything,
//! and no transcript is stored: a quotation is short by limit. A moment is private to its owner
//! unless it is marked for the publication, and even then another author sees it only when it is
//! sealed to the owner's draft revision that author may read (ADR 0073). Moments marked for the
//! publication join the approval binding through [`MomentSet::binding_frame`], which carries
//! digests only. Every change names the set revision the caller read, so a concurrent change is
//! [`MomentError::Stale`] and a failed call changes nothing; every refusal about a moment the
//! requester may not touch is the same [`MomentError::Denied`].

use std::collections::HashSet;
use std::fmt;

use blake2::{Blake2s256, Digest};
use pulldown_cmark::{Event, Parser, Tag};
use serde::{Deserialize, Serialize};

use crate::citations::check_locator;
use crate::collaboration::{
    is_bidi_control, normalize_source_url, valid_id, valid_text, SourceKind, SourceReference,
    MAX_PARTICIPANTS,
};
use crate::research_notes::{locator_ambiguity, Locator, LocatorKind};
use crate::source_library::valid_language_tag;

pub const MOMENT_SET_VERSION: u8 = 1;
/// Upper bound on moments in one shared publication, across every participant.
pub const MAX_MOMENTS: usize = 100;
/// Upper bound on ordered locators in one moment, matching a notebook passage and a citation.
pub const MAX_MOMENT_LOCATORS: usize = 8;
/// Upper bound on the characters of one quotation. Moments quote, they never hold a transcript.
pub const MAX_QUOTATION_CHARS: usize = 1_000;
/// Upper bound on one observation's Markdown.
pub const MAX_OBSERVATION_BYTES: usize = 8 * 1024;
/// Upper bound on a speaker's name.
pub const MAX_SPEAKER_BYTES: usize = 200;
/// The largest stored set that loads. It sits above a set at every other bound at once, so a
/// change the set accepts can always be read back; a change that would write more is refused.
pub const MAX_MOMENT_SET_BYTES: usize = 4 * 1024 * 1024;

/// Why a moment change was refused. Nothing here carries submitted text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MomentError {
    /// The requester is not an author, or the moment is not theirs or does not exist.
    Denied,
    /// The caller's view of the set is no longer the current set.
    Stale,
    /// A field of the requester's own submission is malformed or over a limit.
    Invalid(MomentField),
    /// The moment is well formed but breaks a rule about its source or its publication.
    Rule(MomentRule),
}

/// The field an [`MomentError::Invalid`] is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MomentField {
    Source,
    Locators,
    Quotation,
    Speaker,
    Language,
    Observation,
    /// Neither a quotation nor an observation: a moment says something.
    Content,
    /// The set is full, or the change would make it too large to store.
    Limit,
}

/// A rule a well-formed moment breaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MomentRule {
    /// A locator the source cannot have: a timestamp in a book or article, a page in a video or
    /// podcast, a folio anywhere (a shared source is never a manuscript witness), more than one
    /// timestamp, or a timestamp range that does not end after it starts.
    LocatorDoesNotFitSource,
    /// A quotation whose rights have not been considered cannot be marked for the publication.
    RightsUnknown,
    /// The observation uses raw HTML, an image, a heading, a footnote, or a link that is not an
    /// absolute HTTP(S) address.
    Markup,
}

impl MomentRule {
    /// A sentence fragment naming the rule, safe to show (it holds no author text).
    pub fn describe(self) -> &'static str {
        match self {
            Self::LocatorDoesNotFitSource => "a location this kind of source cannot have (timestamps belong to video, audio and other media, pages to text, folios to no shared source; one timestamp per moment, and a range must end after it starts)",
            Self::RightsUnknown => "a quotation whose rights status is still unknown; choose a status before marking it for the publication",
            Self::Markup => "raw HTML, an image, a heading, a footnote, or a link that is not an absolute http(s) address",
        }
    }
}

impl fmt::Display for MomentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Denied => formatter.write_str("moment access denied"),
            Self::Stale => formatter.write_str("the moments changed since they were read"),
            Self::Invalid(field) => write!(formatter, "invalid moment {}", field.name()),
            Self::Rule(rule) => write!(formatter, "the moment has {}", rule.describe()),
        }
    }
}

impl MomentField {
    fn name(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Locators => "location",
            Self::Quotation => "quotation",
            Self::Speaker => "speaker",
            Self::Language => "language",
            Self::Observation => "observation",
            Self::Content => "content (add a quotation or an observation)",
            Self::Limit => "size",
        }
    }
}

impl std::error::Error for MomentError {}

/// Whether the quotation may be republished, as the participant states it. This is the author's
/// statement, never a legal determination; `Unknown` is the honest answer before anyone checked.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotationRights {
    /// Nobody has considered it yet. Allowed in private moments only.
    Unknown,
    /// A brief quotation used for commentary, criticism or review.
    BriefQuotation,
    /// The rights holder gave permission.
    Permission,
    /// The source is under an open licence that allows this use.
    OpenLicense,
    /// The source is in the public domain.
    PublicDomain,
    /// The participant is quoting their own words.
    OwnWords,
}

impl QuotationRights {
    fn tag(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::BriefQuotation => "briefQuotation",
            Self::Permission => "permission",
            Self::OpenLicense => "openLicense",
            Self::PublicDomain => "publicDomain",
            Self::OwnWords => "ownWords",
        }
    }
}

/// Where the quotation's text came from.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotationProvenance {
    /// The participant transcribed it from the media.
    Transcribed,
    /// Copied from published text: the book or article, captions, or a published transcript.
    Copied,
    /// Supplied by the speaker or the rights holder.
    Supplied,
}

impl QuotationProvenance {
    fn tag(self) -> &'static str {
        match self {
            Self::Transcribed => "transcribed",
            Self::Copied => "copied",
            Self::Supplied => "supplied",
        }
    }
}

/// Someone else's words, stored exactly as quoted: no trimming, normalization or markup
/// interpretation. The speaker is who said them in the source, which is not the source itself
/// (the shared source reference) and not the participant who quoted them.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Quotation {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub rights: QuotationRights,
    pub provenance: QuotationProvenance,
}

/// Whether a moment is the owner's working note or proposed for the published piece.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MomentIntent {
    /// Only the owner ever sees it; it never enters a binding, a preview or an output.
    #[default]
    Private,
    /// Proposed for the published piece: it joins the approval binding and can be revealed with
    /// the owner's draft.
    Publication,
}

/// One attributed, located observation or quotation.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Moment {
    id: String,
    participant: String,
    source: String,
    locators: Vec<Locator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quotation: Option<Quotation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    observation: Option<String>,
    intent: MomentIntent,
}

/// What a participant submits to create or replace one of their moments. The participant is the
/// requester, never part of the input.
#[derive(Clone, Debug, PartialEq)]
pub struct MomentInput {
    pub source: String,
    pub locators: Vec<Locator>,
    pub quotation: Option<Quotation>,
    pub observation: Option<String>,
    pub intent: MomentIntent,
}

/// The owner's publication moments as they were revealed with one of the owner's draft
/// revisions. Write-once per revision: a later edit leaves the seal as it was, so the edit stays
/// private until it is sealed to a newer revision.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MomentSeal {
    participant: String,
    revision: u64,
    digest: String,
}

/// A link to the moment in its source: the source's own safe address, with the start time added
/// only where the provider's time parameter is known. Otherwise it is the original link unchanged,
/// so missing or unsupported media still leaves a working link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MomentLink {
    pub href: String,
    /// Whether `href` starts playback at the moment rather than at the beginning.
    pub at_time: bool,
}

/// A timestamp as whole seconds plus the decimal fraction's digits without trailing zeros, so two
/// timestamps compare exactly whatever their precision.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TimestampValue {
    pub seconds: u64,
    fraction: String,
}

/// Read a timestamp written as seconds or `[h:]m:ss`, optionally with a decimal fraction (the
/// notebook's form). `None` for anything else, including a value too large to count.
pub fn timestamp_value(text: &str) -> Option<TimestampValue> {
    if !crate::source_library::valid_timestamp(text) {
        return None;
    }
    let (clock, fraction) = text.split_once('.').unwrap_or((text, ""));
    let mut seconds = 0u64;
    for part in clock.split(':') {
        seconds = seconds
            .checked_mul(60)?
            .checked_add(part.parse::<u64>().ok()?)?;
    }
    Some(TimestampValue {
        seconds,
        fraction: fraction.trim_end_matches('0').to_string(),
    })
}

/// A moment's locators as plain words, in order: "at 1:02", "from 1:02 to 1:10", "page 3",
/// "pages 3 to 5", "chapter 2". The values are the participant's checked locator text (no
/// control, bidirectional or bracket characters), so callers escape it like any other text.
pub fn location_text(locators: &[Locator]) -> String {
    locators
        .iter()
        .map(|locator| {
            let value = &locator.value;
            match (&locator.kind, locator.to.as_deref()) {
                (LocatorKind::Timestamp, None) => format!("at {value}"),
                (LocatorKind::Timestamp, Some(to)) => format!("from {value} to {to}"),
                (LocatorKind::Page, None) => format!("page {value}"),
                (LocatorKind::Page, Some(to)) => format!("pages {value} to {to}"),
                (kind, None) => format!("{} {value}", kind.as_str()),
                (kind, Some(to)) => format!("{} {value} to {to}", kind.as_str()),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

impl Moment {
    pub fn id(&self) -> &str {
        &self.id
    }
    /// The participant who made the moment: its owner, and the author of its observation.
    pub fn participant(&self) -> &str {
        &self.participant
    }
    /// The shared publication source reference id this moment locates.
    pub fn source(&self) -> &str {
        &self.source
    }
    pub fn locators(&self) -> &[Locator] {
        &self.locators
    }
    pub fn quotation(&self) -> Option<&Quotation> {
        self.quotation.as_ref()
    }
    /// Untrusted Markdown in the participant's own words.
    pub fn observation(&self) -> Option<&str> {
        self.observation.as_deref()
    }
    pub fn intent(&self) -> MomentIntent {
        self.intent
    }

    /// The timestamp locator, if the moment has one.
    pub fn timestamp(&self) -> Option<&Locator> {
        self.locators
            .iter()
            .find(|locator| locator.kind == LocatorKind::Timestamp)
    }

    /// Start and optional end of the moment's timestamp.
    pub fn time_range(&self) -> Option<(TimestampValue, Option<TimestampValue>)> {
        let locator = self.timestamp()?;
        Some((
            timestamp_value(&locator.value)?,
            match &locator.to {
                Some(to) => Some(timestamp_value(to)?),
                None => None,
            },
        ))
    }

    /// Whether the moment lies within a known duration in seconds. `None` when the duration is
    /// unknown or the moment has no timestamp: an unknown duration never makes a moment invalid.
    pub fn within_duration(&self, duration_seconds: Option<u64>) -> Option<bool> {
        let duration = duration_seconds?;
        let (start, end) = self.time_range()?;
        let last = end.unwrap_or(start);
        Some(last.seconds < duration || (last.seconds == duration && last.fraction.is_empty()))
    }

    /// The moment's link, derived from the source reference's stored address. `None` when the
    /// source is missing or has no safe address; a moment is never linked through a URL of its own.
    pub fn link(&self, sources: &[SourceReference]) -> Option<MomentLink> {
        let source = sources.iter().find(|source| source.id == self.source)?;
        let href = normalize_source_url(source.url.as_deref()?)?;
        let start = self.time_range().map(|(start, _)| start.seconds);
        if let (Some(start), Some(id)) = (start, crate::embed::youtube_video_id(&href)) {
            return Some(MomentLink {
                href: format!("https://www.youtube.com/watch?v={id}&t={start}s"),
                at_time: true,
            });
        }
        Some(MomentLink {
            href,
            at_time: false,
        })
    }

    /// The approval binding digest: the moment's own content and the public face of the source
    /// it will show (kind, title, link), so a change to either stales standing approvals.
    fn digest(&self, sources: &[SourceReference]) -> String {
        let face = sources
            .iter()
            .find(|source| source.id == self.source)
            .map(|source| {
                [
                    source.kind.label(),
                    source.title.as_str(),
                    source.url.as_deref().unwrap_or(""),
                ]
            });
        self.hash(b"openblog-media-moment-v1\0", Some(face))
    }

    /// The seal digest: the moment's own content only (id, owner, source id, locators, quotation
    /// with all its fields, observation, intent). It leaves the source's title, link and kind
    /// out, because a seal is never rewritten: a site owner correcting a source after a reveal
    /// must not hide every moment revealed on it. Approvals still go stale through [`digest`].
    ///
    /// [`digest`]: Moment::digest
    fn content_digest(&self) -> String {
        self.hash(b"openblog-media-moment-content-v1\0", None)
    }

    /// `face` is `Some(None)` for a binding digest whose source is missing, `None` for a content
    /// digest that never covers the source's face.
    fn hash(&self, domain: &[u8], face: Option<Option<[&str; 3]>>) -> String {
        let mut hasher = Blake2s256::new();
        hasher.update(domain);
        let mut put = |part: &str| {
            hasher.update((part.len() as u64).to_be_bytes());
            hasher.update(part.as_bytes());
        };
        put(&self.id);
        put(&self.participant);
        put(&self.source);
        match face {
            Some(Some(face)) => face.iter().for_each(|part| put(part)),
            Some(None) => put("\0missing"),
            None => {}
        }
        put(&self.locators.len().to_string());
        for locator in &self.locators {
            put(locator.kind.as_str());
            put(&locator.value);
            put(locator.to.as_deref().unwrap_or("\0"));
        }
        match &self.quotation {
            Some(quotation) => {
                put("quotation");
                put(&quotation.text);
                put(quotation.speaker.as_deref().unwrap_or("\0"));
                put(quotation.language.as_deref().unwrap_or("\0"));
                put(quotation.rights.tag());
                put(quotation.provenance.tag());
            }
            None => put("\0"),
        }
        put(self.observation.as_deref().unwrap_or("\0"));
        put(match self.intent {
            MomentIntent::Private => "private",
            MomentIntent::Publication => "publication",
        });
        hex(&hasher.finalize())
    }

    /// Structure that holds without the record: shapes, limits and the content rule.
    fn check_shape(&self) -> Result<(), MomentError> {
        if !valid_id(&self.id) || !valid_id(&self.participant) {
            return Err(MomentError::Invalid(MomentField::Limit));
        }
        check_input_shape(
            &self.source,
            &self.locators,
            self.quotation.as_ref(),
            self.observation.as_deref(),
            self.intent,
        )
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn check_input_shape(
    source: &str,
    locators: &[Locator],
    quotation: Option<&Quotation>,
    observation: Option<&str>,
    intent: MomentIntent,
) -> Result<(), MomentError> {
    if !valid_id(source) {
        return Err(MomentError::Invalid(MomentField::Source));
    }
    check_locators(locators)?;
    if quotation.is_none() && observation.is_none() {
        return Err(MomentError::Invalid(MomentField::Content));
    }
    if let Some(quotation) = quotation {
        check_quotation(quotation)?;
        if intent == MomentIntent::Publication && quotation.rights == QuotationRights::Unknown {
            return Err(MomentError::Rule(MomentRule::RightsUnknown));
        }
    }
    if let Some(observation) = observation {
        check_observation(observation)?;
    }
    Ok(())
}

fn check_locators(locators: &[Locator]) -> Result<(), MomentError> {
    let invalid = MomentError::Invalid(MomentField::Locators);
    if locators.is_empty() || locators.len() > MAX_MOMENT_LOCATORS {
        return Err(invalid);
    }
    let mut seen = HashSet::new();
    for locator in locators {
        // Extra fields are the notebook's private extension; a moment carries none.
        if !locator.extra.is_empty()
            || check_locator(locator).is_err()
            || !seen.insert((locator.kind.as_str(), &locator.value, &locator.to))
        {
            return Err(invalid);
        }
    }
    let timestamps: Vec<&Locator> = locators
        .iter()
        .filter(|locator| locator.kind == LocatorKind::Timestamp)
        .collect();
    match timestamps.as_slice() {
        [] => Ok(()),
        [only] => {
            let start = timestamp_value(&only.value).ok_or(invalid)?;
            match only.to.as_deref() {
                None => Ok(()),
                Some(to) if timestamp_value(to).ok_or(invalid)? > start => Ok(()),
                Some(_) => Err(MomentError::Rule(MomentRule::LocatorDoesNotFitSource)),
            }
        }
        _ => Err(MomentError::Rule(MomentRule::LocatorDoesNotFitSource)),
    }
}

/// Whether a locator can address a shared source of this kind. Timestamps need a timeline, pages
/// need text, and folios need a manuscript witness, which a shared source reference never is
/// (the page and folio rule is the notebook's and the citations', ADR 0045).
fn fits(kind: SourceKind, source_id: &str, locator: &Locator) -> bool {
    if locator_ambiguity(None, source_id, locator).is_some() {
        return false;
    }
    match locator.kind {
        LocatorKind::Timestamp => !matches!(kind, SourceKind::Book | SourceKind::Article),
        LocatorKind::Page => !matches!(kind, SourceKind::Video | SourceKind::Podcast),
        _ => true,
    }
}

fn check_quotation(quotation: &Quotation) -> Result<(), MomentError> {
    let text = &quotation.text;
    if text.trim().is_empty()
        || text.chars().count() > MAX_QUOTATION_CHARS
        || text.chars().any(|c| {
            (c.is_control() && !matches!(c, '\n' | '\t'))
                || is_bidi_control(c)
                || matches!(c, '\u{2028}' | '\u{2029}')
        })
    {
        return Err(MomentError::Invalid(MomentField::Quotation));
    }
    if quotation
        .speaker
        .as_deref()
        .is_some_and(|speaker| speaker.trim() != speaker || !valid_text(speaker, MAX_SPEAKER_BYTES))
    {
        return Err(MomentError::Invalid(MomentField::Speaker));
    }
    if quotation
        .language
        .as_deref()
        .is_some_and(|language| language.len() > 64 || !valid_language_tag(language))
    {
        return Err(MomentError::Invalid(MomentField::Language));
    }
    Ok(())
}

fn check_observation(markdown: &str) -> Result<(), MomentError> {
    if markdown.trim().is_empty()
        || markdown.len() > MAX_OBSERVATION_BYTES
        || markdown.chars().any(|c| {
            (c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
                || is_bidi_control(c)
                || matches!(c, '\u{2028}' | '\u{2029}')
        })
    {
        return Err(MomentError::Invalid(MomentField::Observation));
    }
    for smart in [false, true] {
        for event in Parser::new_ext(markdown, crate::markdown::parser_options(smart)) {
            let unsafe_markup = match event {
                Event::Html(_) | Event::InlineHtml(_) | Event::FootnoteReference(_) => true,
                Event::Start(Tag::Image { .. })
                | Event::Start(Tag::Heading { .. })
                | Event::Start(Tag::FootnoteDefinition(_))
                | Event::Start(Tag::HtmlBlock) => true,
                Event::Start(Tag::Link { dest_url, .. }) => {
                    normalize_source_url(&dest_url).is_none()
                }
                _ => false,
            };
            if unsafe_markup {
                return Err(MomentError::Rule(MomentRule::Markup));
            }
        }
    }
    Ok(())
}

/// A source's moments must locate one of the record's sources, with locators that source can have.
fn check_against_sources(
    source: &str,
    locators: &[Locator],
    sources: &[SourceReference],
) -> Result<(), MomentError> {
    let reference = sources
        .iter()
        .find(|reference| reference.id == source)
        .ok_or(MomentError::Invalid(MomentField::Source))?;
    if locators
        .iter()
        .all(|locator| fits(reference.kind, source, locator))
    {
        Ok(())
    } else {
        Err(MomentError::Rule(MomentRule::LocatorDoesNotFitSource))
    }
}

/// Every moment in one shared publication, in the order they were made, and the seals that tie
/// owners' publication moments to the draft revisions they were revealed with.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MomentSet {
    version: u8,
    #[serde(default)]
    revision: u64,
    #[serde(default)]
    next_id: u64,
    #[serde(default)]
    moments: Vec<Moment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    seals: Vec<MomentSeal>,
}

impl Default for MomentSet {
    fn default() -> Self {
        Self::new()
    }
}

impl MomentSet {
    /// A set with no moments, which binds exactly as a piece without moments.
    pub fn new() -> Self {
        Self {
            version: MOMENT_SET_VERSION,
            revision: 0,
            next_id: 0,
            moments: Vec::new(),
            seals: Vec::new(),
        }
    }

    /// Parse a stored set. Every failure is one non-identifying error.
    pub fn from_json(source: &str) -> Result<Self, MomentError> {
        let invalid = MomentError::Invalid(MomentField::Limit);
        if source.len() > MAX_MOMENT_SET_BYTES {
            return Err(invalid);
        }
        let set: Self = serde_json::from_str(source).map_err(|_| invalid)?;
        if !set.is_valid() {
            return Err(invalid);
        }
        Ok(set)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("a moment set always serializes")
    }

    fn is_valid(&self) -> bool {
        let mut ids = HashSet::new();
        let mut sealed = HashSet::new();
        self.version == MOMENT_SET_VERSION
            && self.moments.len() <= MAX_MOMENTS
            && self.moments.iter().all(|moment| {
                ids.insert(moment.id.to_ascii_lowercase())
                    && moment.check_shape().is_ok()
                    && self.minted_id_in_range(&moment.id)
            })
            && self.seals.len() <= MAX_PARTICIPANTS
            && self.seals.iter().all(|seal| {
                valid_id(&seal.participant)
                    && sealed.insert(seal.participant.to_ascii_lowercase())
                    && seal.revision > 0
                    && seal.digest.len() == 64
                    && seal.digest.bytes().all(|b| b.is_ascii_hexdigit())
            })
    }

    /// An id this set mints (`moment-N`) must not be ahead of the counter, or the next add could
    /// mint a duplicate.
    fn minted_id_in_range(&self, id: &str) -> bool {
        match id.to_ascii_lowercase().strip_prefix("moment-") {
            Some(number) if number.bytes().all(|b| b.is_ascii_digit()) => number
                .parse::<u64>()
                .is_ok_and(|number| number <= self.next_id),
            _ => true,
        }
    }

    /// The revision callers send back as `expected` so a concurrent change is refused.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn is_empty(&self) -> bool {
        self.moments.is_empty()
    }

    fn guard(&self, requester: &str, authors: &[&str], expected: u64) -> Result<(), MomentError> {
        if !authors.contains(&requester) {
            return Err(MomentError::Denied);
        }
        if expected != self.revision {
            return Err(MomentError::Stale);
        }
        Ok(())
    }

    /// Apply a participant's `change` to a copy, raise the revision, and keep it only if the
    /// result is storable, so a refused change leaves the set exactly as it was.
    fn commit(&mut self, change: impl FnOnce(&mut Self)) -> Result<(), MomentError> {
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(MomentError::Invalid(MomentField::Limit))?;
        self.store(|next| {
            change(next);
            next.revision = revision;
        })
    }

    /// Apply `change` to a copy and keep it only if the result is storable. The revision is the
    /// caller's to raise: [`Self::commit`] does for what participants edit, while a seal, which no
    /// client edits or sends back, leaves it as it was.
    fn store(&mut self, change: impl FnOnce(&mut Self)) -> Result<(), MomentError> {
        let mut next = self.clone();
        change(&mut next);
        if next.to_json().len() > MAX_MOMENT_SET_BYTES {
            return Err(MomentError::Invalid(MomentField::Limit));
        }
        *self = next;
        Ok(())
    }

    fn check_input(input: &MomentInput, sources: &[SourceReference]) -> Result<(), MomentError> {
        check_input_shape(
            &input.source,
            &input.locators,
            input.quotation.as_ref(),
            input.observation.as_deref(),
            input.intent,
        )?;
        check_against_sources(&input.source, &input.locators, sources)
    }

    /// Make a moment for the requester. `sources` are the shared publication's source references.
    /// Returns the new id.
    pub fn add(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        sources: &[SourceReference],
        input: MomentInput,
    ) -> Result<String, MomentError> {
        self.guard(requester, authors, expected)?;
        if !valid_id(requester) {
            return Err(MomentError::Denied);
        }
        Self::check_input(&input, sources)?;
        if self.moments.len() >= MAX_MOMENTS {
            return Err(MomentError::Invalid(MomentField::Limit));
        }
        let next_id = self
            .next_id
            .checked_add(1)
            .ok_or(MomentError::Invalid(MomentField::Limit))?;
        let id = format!("moment-{next_id}");
        let moment = Moment {
            id: id.clone(),
            participant: requester.to_owned(),
            source: input.source,
            locators: input.locators,
            quotation: input.quotation,
            observation: input.observation,
            intent: input.intent,
        };
        self.commit(|set| {
            set.next_id = next_id;
            set.moments.push(moment);
        })?;
        Ok(id)
    }

    fn position(&self, id: &str, requester: &str) -> Result<usize, MomentError> {
        self.moments
            .iter()
            .position(|moment| moment.id == id && moment.participant == requester)
            .ok_or(MomentError::Denied)
    }

    /// Replace the content of one of the requester's moments. A moment keeps its source for life:
    /// locating another source is a new moment.
    pub fn edit(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        sources: &[SourceReference],
        id: &str,
        input: MomentInput,
    ) -> Result<(), MomentError> {
        self.guard(requester, authors, expected)?;
        let index = self.position(id, requester)?;
        if input.source != self.moments[index].source {
            return Err(MomentError::Invalid(MomentField::Source));
        }
        Self::check_input(&input, sources)?;
        let mut moment = self.moments[index].clone();
        moment.locators = input.locators;
        moment.quotation = input.quotation;
        moment.observation = input.observation;
        moment.intent = input.intent;
        if moment == self.moments[index] {
            return Ok(());
        }
        self.commit(|set| set.moments[index] = moment)
    }

    /// Delete one of the requester's moments.
    pub fn remove(
        &mut self,
        requester: &str,
        authors: &[&str],
        expected: u64,
        id: &str,
    ) -> Result<(), MomentError> {
        self.guard(requester, authors, expected)?;
        let index = self.position(id, requester)?;
        self.commit(|set| {
            set.moments.remove(index);
        })
    }

    /// The requester's own moments, private and publication alike. Anyone who is not an author
    /// gets `Denied`.
    pub fn own(&self, requester: &str, authors: &[&str]) -> Result<Vec<&Moment>, MomentError> {
        if !authors.contains(&requester) {
            return Err(MomentError::Denied);
        }
        Ok(self.of(requester))
    }

    fn of(&self, owner: &str) -> Vec<&Moment> {
        self.moments
            .iter()
            .filter(|moment| moment.participant == owner)
            .collect()
    }

    fn publication_of(&self, owner: &str) -> Vec<&Moment> {
        self.moments
            .iter()
            .filter(|moment| {
                moment.participant == owner && moment.intent == MomentIntent::Publication
            })
            .collect()
    }

    /// The digest of the owner's publication moments in order, from their own content only.
    /// Private moments never count, so editing one never changes what was revealed, and editing a
    /// source never unseals the moments on it (approvals still go stale, [`Self::binding_frame`]).
    fn owner_digest(&self, owner: &str) -> String {
        let mut hasher = Blake2s256::new();
        hasher.update(b"openblog-media-moment-seal-v1\0");
        for moment in self.publication_of(owner) {
            hasher.update(moment.content_digest().as_bytes());
        }
        hex(&hasher.finalize())
    }

    /// The owner's moments another author may read: the owner's publication moments, exactly as
    /// sealed to `readable_latest`, the owner's latest draft revision when the caller has checked
    /// (`DraftSet::view`) that `requester` may read that revision, or `None`. Otherwise nothing,
    /// whether the owner has no moments, only private ones, or edited them since the reveal, so
    /// the answer is no oracle. The owner reads their own moments through [`MomentSet::own`]; a
    /// requester who is not an author gets `Denied`.
    pub fn revealed(
        &self,
        requester: &str,
        authors: &[&str],
        owner: &str,
        readable_latest: Option<u64>,
    ) -> Result<Vec<&Moment>, MomentError> {
        if !authors.contains(&requester) {
            return Err(MomentError::Denied);
        }
        if requester == owner {
            return Ok(self.publication_of(owner));
        }
        let shown = readable_latest.is_some_and(|revision| {
            self.seals.iter().any(|seal| {
                seal.participant == owner
                    && seal.revision == revision
                    && seal.digest == self.owner_digest(owner)
            })
        });
        Ok(if shown && authors.contains(&owner) {
            self.publication_of(owner)
        } else {
            Vec::new()
        })
    }

    /// Whether every publication moment of `owner` is sealed to `revision` as it is now: what a
    /// preview needs to call the owner's part complete for a reader of that revision. A later edit
    /// to the source a moment shows leaves it sealed: the seal covers the moments' own content.
    pub fn is_sealed(&self, owner: &str, revision: u64) -> bool {
        self.publication_of(owner).is_empty()
            || self.seals.iter().any(|seal| {
                seal.participant == owner
                    && seal.revision == revision
                    && seal.digest == self.owner_digest(owner)
            })
    }

    /// Seal the owner's publication moments to their draft revision `revision`, which the caller
    /// is revealing (an exchange commit or a voluntary offer, ADR 0016, 0018). Called only after
    /// the owner was authorized for that reveal. A seal is write-once per revision and only moves
    /// forward: sealing an older or the same revision again leaves the first seal, so an edit made
    /// after a reveal stays private until a newer revision is revealed. Returns whether the
    /// current moments are now the sealed ones.
    ///
    /// Sealing leaves [`Self::revision`] as it was: seals are not something a participant edits,
    /// so an offer never makes the revision the owner's panel holds stale. The stored file's own
    /// compare-and-swap still refuses a seal written over a concurrent change.
    pub fn seal(
        &mut self,
        owner: &str,
        authors: &[&str],
        revision: u64,
    ) -> Result<bool, MomentError> {
        if !authors.contains(&owner) || !valid_id(owner) || revision == 0 {
            return Err(MomentError::Denied);
        }
        let digest = self.owner_digest(owner);
        if let Some(seal) = self.seals.iter().find(|seal| seal.participant == owner) {
            if seal.revision >= revision {
                return Ok(seal.revision == revision && seal.digest == digest);
            }
        }
        let seal = MomentSeal {
            participant: owner.to_owned(),
            revision,
            digest,
        };
        self.store(|set| {
            set.seals.retain(|existing| existing.participant != owner);
            set.seals.push(seal);
        })?;
        Ok(true)
    }

    /// Moments proposed for the published piece, in order, for callers that have already
    /// authorized their audience (assembly, the publish gate). Never hand this to a request that
    /// has not.
    pub fn publication_moments(&self) -> Vec<&Moment> {
        self.moments
            .iter()
            .filter(|moment| moment.intent == MomentIntent::Publication)
            .collect()
    }

    /// Every participant with a moment proposed for the piece, in first-appearance order. Whatever
    /// the approval policy, each must approve the piece (`ApprovalSubject::attributed`).
    pub fn attributed_participants(&self) -> Vec<&str> {
        let mut seen = HashSet::new();
        self.publication_moments()
            .into_iter()
            .map(Moment::participant)
            .filter(|participant| seen.insert(*participant))
            .collect()
    }

    /// Ids of publication moments that no longer resolve against the record: their source is gone
    /// or their locators no longer fit it. The gate refuses while any remain.
    pub fn unresolved(&self, sources: &[SourceReference]) -> Vec<&str> {
        self.publication_moments()
            .into_iter()
            .filter(|moment| {
                check_against_sources(&moment.source, &moment.locators, sources).is_err()
            })
            .map(Moment::id)
            .collect()
    }

    /// Drop the moments and seals of anyone who is no longer an author. Routes call this in the
    /// same write as an author-set change; restoring the author does not restore them.
    pub fn reconcile(&mut self, authors: &[&str]) -> bool {
        let keep = |participant: &str| authors.contains(&participant);
        if self.moments.iter().all(|m| keep(&m.participant))
            && self.seals.iter().all(|s| keep(&s.participant))
        {
            return false;
        }
        self.moments.retain(|m| keep(&m.participant));
        self.seals.retain(|s| keep(&s.participant));
        self.revision = self.revision.saturating_add(1);
        true
    }

    /// Prose-free values to append to the approval subject's metadata: a count and one digest per
    /// publication moment in order, covering its owner, source (and that source's public title,
    /// link and type), locators, quotation with speaker, rights and provenance, and observation.
    /// Empty when no moment is proposed for the piece, so such a piece binds exactly as before.
    pub fn binding_frame(&self, sources: &[SourceReference]) -> Vec<String> {
        let moments = self.publication_moments();
        if moments.is_empty() {
            return Vec::new();
        }
        let mut frame = vec![format!("moments:{}", moments.len())];
        frame.extend(moments.iter().map(|moment| moment.digest(sources)));
        frame
    }
}

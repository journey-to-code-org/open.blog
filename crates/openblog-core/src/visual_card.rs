//! Destination-ready visual cards (epic #383, story #393; ADRs 0368 to 0370).
//!
//! A visual card is what one image destination shows of a published post: one of the author's
//! own images, a title, a description, the image's alternative text, a link back to the canonical
//! post and, when the author recorded one, the image's source credit. Nothing here generates an
//! image or text: the image is one the post already publishes (its card image, its cover, or for
//! recipes and travel logs the photographs in the body), and the words are the post's own or the
//! author's explicit card fields. This module chooses and checks; it never sends.

use blake2::{Blake2b512, Digest};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use url::Url;

use crate::frontmatter::FrontMatter;
pub use crate::image_facts::{ImageFacts, MediaType};

/// At most this many body images are considered for a recipe or travel card.
pub const MAX_BODY_IMAGES: usize = 8;
/// Longest source credit accepted, in characters.
pub const MAX_CREDIT_CHARS: usize = 200;

/// Where a candidate image came from, in the order candidates are tried.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImageOrigin {
    /// `cardImage` in front matter: the author's explicit choice for cards.
    CardImage,
    /// The authored cover (`cover`, `image`, `coverImage` or `hero`).
    Cover,
    /// A photograph in the body of a recipe or field-journal post.
    BodyImage,
    /// The image the post's page declares for link previews (`og:image`): its cover, its first
    /// body image, or the site's default.
    PageImage,
}

impl ImageOrigin {
    pub fn describe(self) -> &'static str {
        match self {
            Self::CardImage => "card image",
            Self::Cover => "cover image",
            Self::BodyImage => "image in the post",
            Self::PageImage => "link preview image of the page",
        }
    }
}

/// How serious a problem is: a blocking one stops the card, one to check needs a person to
/// confirm a fact open.blog could not verify, and a notice is advice.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Blocking,
    Check,
    Notice,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blocking => "blocking",
            Self::Check => "check",
            Self::Notice => "notice",
        }
    }
}

/// One fixed-code problem. The message is fixed text and limits; it never repeats the author's
/// words, an address or a file name.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardProblem {
    pub code: &'static str,
    pub severity: Severity,
    pub message: String,
}

impl CardProblem {
    pub fn new(code: &'static str, severity: Severity, message: impl Into<String>) -> Self {
        Self {
            code,
            severity,
            message: message.into(),
        }
    }
}

/// The recorded source of an image: who made it and where it came from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

impl Credit {
    pub fn is_empty(&self) -> bool {
        self.text.is_none() && self.url.is_none()
    }

    /// The credit as one line, such as "Photo: Ana Ruiz", or `None` without any.
    pub fn line(&self) -> Option<String> {
        match (&self.text, &self.url) {
            (Some(text), _) => Some(format!("Image: {text}")),
            (None, Some(_)) => Some("Image source linked".to_string()),
            (None, None) => None,
        }
    }
}

/// One image a card could use, with where it resolves and what is known about it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCandidate {
    pub origin: ImageOrigin,
    /// As the author wrote it.
    pub src: String,
    /// The absolute public address, when it resolves to one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// For an image the site itself serves: its path inside the static folder, decoded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Credit::is_empty")]
    pub credit: Credit,
    /// Problems with the image itself, before any destination is considered.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<CardProblem>,
}

impl ImageCandidate {
    pub fn is_remote(&self) -> bool {
        self.url.is_some() && self.site_path.is_none()
    }
}

/// What a card is built from: the published post as its page presents it. The CLI fills it from
/// a production-visible post, so a draft never reaches a card.
#[derive(Clone, Debug)]
pub struct CardSource<'a> {
    pub title: &'a str,
    pub description: &'a str,
    /// The resolved content profile id (`article`, `recipe`, `field-journal`, ...).
    pub profile: &'a str,
    /// The post page's absolute address, for resolving relative body images.
    pub page_url: &'a str,
    /// The canonical address every card links to.
    pub canonical_url: &'a str,
    /// The site's public address (`url` in `openblog.json`).
    pub site_url: &'a str,
    /// The image the page declares for link previews, as written (the post's cover or first
    /// body image, else the site's `ogImage`), and its alternative text when the post gave one.
    pub page_image: Option<&'a str>,
    pub page_image_alt: Option<&'a str>,
    pub front_matter: &'a FrontMatter,
    /// The portable Markdown of the post: what leaves the site, never the private body.
    pub markdown: &'a str,
}

/// Whether a profile's body photographs may be card images: recipes and travel logs, whose
/// photographs are the point of the post. An article uses its card image or cover only.
pub fn uses_body_images(profile: &str) -> bool {
    matches!(
        profile,
        crate::profile::RECIPE_ID | crate::profile::FIELD_JOURNAL_ID
    )
}

/// The images a destination card may use, in the order they are tried: the explicit card image,
/// the authored cover, then (recipes and travel logs only) the body's photographs, each once.
pub fn image_candidates(source: &CardSource<'_>) -> Vec<ImageCandidate> {
    let fm = source.front_matter;
    let mut out: Vec<ImageCandidate> = Vec::new();
    let push = |candidate: ImageCandidate, out: &mut Vec<ImageCandidate>| {
        let duplicate = out.iter().any(|known| {
            known.src == candidate.src || (known.url.is_some() && known.url == candidate.url)
        });
        if !duplicate {
            out.push(candidate);
        }
    };
    if let Some(src) = scalar(fm, &["cardImage"]) {
        let candidate = candidate(
            ImageOrigin::CardImage,
            src,
            scalar(fm, &["cardImageAlt"]),
            fm,
            ["cardImageCredit", "cardImageCreditUrl"],
            source,
            false,
        );
        push(candidate, &mut out);
    }
    if let Some(src) = scalar(fm, &["cover", "image", "coverImage", "hero"]) {
        let candidate = candidate(
            ImageOrigin::Cover,
            src,
            scalar(fm, &["coverAlt", "imageAlt", "cover_alt"]),
            fm,
            ["coverCredit", "coverCreditUrl"],
            source,
            false,
        );
        push(candidate, &mut out);
    }
    if uses_body_images(source.profile) {
        for (src, alt) in body_images(source.markdown)
            .into_iter()
            .take(MAX_BODY_IMAGES)
        {
            let mut candidate = candidate(
                ImageOrigin::BodyImage,
                &src,
                (!alt.is_empty()).then_some(alt.as_str()),
                fm,
                ["", ""],
                source,
                true,
            );
            candidate.credit = Credit::default();
            push(candidate, &mut out);
        }
    }
    out
}

/// The one image a link preview of the page shows (`og:image`), exactly as the build declares
/// it, or `None` when the page declares none.
pub fn page_image_candidate(source: &CardSource<'_>) -> Option<ImageCandidate> {
    let src = source.page_image.map(str::trim).filter(|s| !s.is_empty())?;
    let fm = source.front_matter;
    let mut found = candidate(
        ImageOrigin::PageImage,
        src,
        source.page_image_alt,
        fm,
        ["", ""],
        source,
        false,
    );
    // The cover's credit travels with the cover when the page shows it.
    if scalar(fm, &["cover", "image", "coverImage", "hero"]) == Some(src) {
        found.credit = credit(fm, ["coverCredit", "coverCreditUrl"], &mut found.problems);
    }
    Some(found)
}

fn candidate(
    origin: ImageOrigin,
    src: &str,
    alt: Option<&str>,
    fm: &FrontMatter,
    credit_keys: [&str; 2],
    source: &CardSource<'_>,
    relative_to_page: bool,
) -> ImageCandidate {
    let mut problems = Vec::new();
    let (url, site_path) = match resolve(src, source, relative_to_page) {
        Ok(found) => found,
        Err(problem) => {
            problems.push(problem);
            (None, None)
        }
    };
    let credit = if credit_keys[0].is_empty() {
        Credit::default()
    } else {
        credit(fm, credit_keys, &mut problems)
    };
    ImageCandidate {
        origin,
        src: src.to_string(),
        url,
        site_path,
        alt: alt.map(one_line).filter(|alt| !alt.is_empty()),
        credit,
        problems,
    }
}

fn credit(fm: &FrontMatter, keys: [&str; 2], problems: &mut Vec<CardProblem>) -> Credit {
    let text = scalar(fm, &[keys[0]])
        .map(one_line)
        .filter(|t| !t.is_empty());
    if text
        .as_ref()
        .is_some_and(|t| t.chars().count() > MAX_CREDIT_CHARS)
    {
        problems.push(CardProblem::new(
            "credit-too-long",
            Severity::Blocking,
            format!("The image credit is longer than {MAX_CREDIT_CHARS} characters; shorten it."),
        ));
    }
    let url = scalar(fm, &[keys[1]]).map(str::to_string);
    if let Some(address) = &url {
        let valid = Url::parse(address)
            .ok()
            .is_some_and(|parsed| parsed.scheme() == "https" && parsed.host_str().is_some());
        if !valid {
            problems.push(CardProblem::new(
                "credit-url-invalid",
                Severity::Blocking,
                "The image credit link must be a full https:// address.",
            ));
        }
    }
    Credit { text, url }
}

/// Resolves an image address to its public URL and, when the site serves it, its static path.
/// Front matter images follow the build's rule for `og:image` (a path is relative to the site's
/// address); body images resolve against the page, as a browser would.
fn resolve(
    src: &str,
    source: &CardSource<'_>,
    relative_to_page: bool,
) -> Result<(Option<String>, Option<String>), CardProblem> {
    let src = src.trim();
    let unusable = |message: &str| {
        CardProblem::new(
            "image-address-unusable",
            Severity::Blocking,
            message.to_string(),
        )
    };
    let lower = src.to_ascii_lowercase();
    if lower.starts_with("data:") {
        return Err(unusable(
            "The image is written into the post as data; a destination needs an image file at an address.",
        ));
    }
    let site = Url::parse(source.site_url).map_err(|_| {
        unusable(
            "The site's public address cannot be read, so the image address cannot be resolved.",
        )
    })?;
    let resolved = if lower.starts_with("https://") || lower.starts_with("http://") {
        Url::parse(src)
    } else if src.starts_with("//") {
        return Err(unusable(
            "The image address has no scheme; write it as a site path or a full https:// address.",
        ));
    } else if relative_to_page {
        Url::parse(source.page_url).and_then(|page| page.join(src))
    } else {
        // `SiteConfig::absolute`: the site's address, then the path.
        let base = source.site_url.trim_end_matches('/');
        let path = if src.starts_with('/') {
            src.to_string()
        } else {
            format!("/{src}")
        };
        Url::parse(&format!("{base}{path}"))
    }
    .map_err(|_| unusable("The image address cannot be read."))?;
    if !matches!(resolved.scheme(), "https" | "http") || resolved.host_str().is_none() {
        return Err(unusable(
            "The image address must be a site path or a full https:// address.",
        ));
    }
    let same_origin = resolved.scheme() == site.scheme()
        && resolved.host_str() == site.host_str()
        && resolved.port_or_known_default() == site.port_or_known_default();
    if same_origin {
        let base_path = site.path().trim_end_matches('/');
        let path = resolved.path();
        let inside = if base_path.is_empty() {
            Some(path)
        } else {
            path.strip_prefix(base_path)
                .filter(|rest| rest.starts_with('/'))
        };
        if let Some(rest) = inside {
            let decoded = percent_decode(rest.trim_start_matches('/'))
                .ok_or_else(|| unusable("The image path cannot be decoded."))?;
            let safe = !decoded.is_empty()
                && !decoded.ends_with('/')
                && !decoded.contains('\\')
                && !decoded.contains('\0')
                && decoded
                    .split('/')
                    .all(|part| !part.is_empty() && part != "." && part != "..");
            if !safe {
                return Err(unusable(
                    "The image path must name one file inside the site, without `..`.",
                ));
            }
            return Ok((Some(resolved.to_string()), Some(decoded)));
        }
    }
    if resolved.scheme() != "https" {
        return Err(CardProblem::new(
            "image-not-https",
            Severity::Blocking,
            "An image on another site must use an https:// address.",
        ));
    }
    Ok((Some(resolved.to_string()), None))
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Every image in the Markdown, in order: its address and its alternative text.
pub fn body_images(markdown: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut current: Option<(String, String)> = None;
    for event in Parser::new_ext(markdown, Options::all()) {
        match event {
            Event::Start(Tag::Image { dest_url, .. }) => {
                current = Some((dest_url.to_string(), String::new()));
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, alt)) = current.as_mut() {
                    alt.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some((_, alt)) = current.as_mut() {
                    alt.push(' ');
                }
            }
            Event::End(TagEnd::Image) => {
                if let Some((src, alt)) = current.take() {
                    if !src.trim().is_empty() {
                        out.push((src.trim().to_string(), one_line(&alt)));
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn scalar<'a>(fm: &'a FrontMatter, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| fm.get(key))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Collapses every run of whitespace (newlines included) to one space and trims.
pub fn one_line(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ----------------------------------------------------------------------------------------------
// Cards: the words, the alternative text, the chosen image and a deterministic preview (ADR 0369).

/// The version of the card plan written by `openblog card --json` and `--preview`.
pub const CARD_PLAN_VERSION: u32 = 1;

/// The destinations a card is built for, a closed list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CardFormat {
    /// A Pinterest Pin: an image with its own title, description, alternative text and link.
    PinterestPin,
    /// A Facebook link preview: what Facebook shows of the page's own link metadata.
    FacebookLink,
    /// A LinkedIn link preview: what LinkedIn shows of the page's own link metadata.
    LinkedinLink,
}

impl CardFormat {
    pub const ALL: [CardFormat; 3] = [
        CardFormat::PinterestPin,
        CardFormat::FacebookLink,
        CardFormat::LinkedinLink,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::PinterestPin => "pinterest-pin",
            Self::FacebookLink => "facebook-link",
            Self::LinkedinLink => "linkedin-link",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::PinterestPin => "Pinterest Pin",
            Self::FacebookLink => "Facebook link preview",
            Self::LinkedinLink => "LinkedIn link preview",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|format| format.as_str() == name)
    }

    /// A comma-separated list of formats, in the fixed order, each once; empty means all. One
    /// unknown name refuses the list.
    pub fn parse_list(list: &str) -> Result<Vec<Self>, String> {
        let mut out = Vec::new();
        for name in list.split(',').map(str::trim).filter(|n| !n.is_empty()) {
            let format = Self::parse(name).ok_or_else(|| {
                "unknown card format; use pinterest-pin, facebook-link or linkedin-link".to_string()
            })?;
            if !out.contains(&format) {
                out.push(format);
            }
        }
        out.sort();
        Ok(if out.is_empty() {
            Self::ALL.to_vec()
        } else {
            out
        })
    }

    /// Whether the destination takes the card's own words. A Pin does, so `cardTitle` and
    /// `cardDescription` apply; a link preview shows the page's own title and description, which
    /// a card cannot change without changing the site.
    pub fn takes_card_text(self) -> bool {
        matches!(self, Self::PinterestPin)
    }

    /// Whether the destination needs an image at all.
    pub fn requires_image(self) -> bool {
        matches!(self, Self::PinterestPin)
    }

    /// The size the preview draws the image at: the destination's recommended size (ADR 0370).
    pub fn canvas(self) -> (u32, u32) {
        let spec = self.spec();
        spec.recommended
    }
}

/// Where a card's title or description came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextSource {
    /// `cardTitle` or `cardDescription`, written by the author for cards.
    Card,
    /// The post's own title or description.
    Post,
}

/// What open.blog could learn about one candidate image.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Measurement {
    /// Read from the file the site serves.
    Measured(ImageFacts),
    /// The site does not serve a file at that path.
    NotFound,
    /// The file is there but is not a JPEG, PNG, GIF or WebP image open.blog can read.
    Unreadable,
    /// On another site: open.blog never fetches it, so nothing about it is known.
    Remote,
}

/// A card's overall state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CardStatus {
    /// Every checked fact holds.
    Ready,
    /// Nothing blocks it, but a fact could not be verified and a person must confirm it.
    Check,
    /// It cannot be used as it is.
    Blocked,
}

impl CardStatus {
    pub fn words(self) -> &'static str {
        match self {
            Self::Ready => "Ready: every checked fact holds",
            Self::Check => "Check: a fact could not be verified",
            Self::Blocked => "Blocked: this card cannot be used as it is",
        }
    }
}

/// The image a card uses, and what is known about it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardImage {
    #[serde(flatten)]
    pub candidate: ImageCandidate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub facts: Option<ImageFacts>,
}

/// A candidate passed over, and why: the fallback the card took is visible.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedImage {
    pub origin: ImageOrigin,
    pub src: String,
    pub problems: Vec<CardProblem>,
}

/// One destination's card.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualCard {
    pub format: CardFormat,
    pub label: &'static str,
    pub status: CardStatus,
    pub title: String,
    pub title_source: TextSource,
    pub description: String,
    pub description_source: TextSource,
    /// The chosen image's alternative text, exactly as the author wrote it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    /// The canonical address of the post: every card links back to the original.
    pub link: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<CardImage>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<SkippedImage>,
    pub problems: Vec<CardProblem>,
    /// The day the destination's requirements were checked (ADR 0370).
    pub policy_version: &'static str,
    /// Binds the format, words, alternative text, link, image address and credit (ADR 0369).
    pub digest: String,
}

/// Every chosen destination's card for one published post.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPlan {
    pub version: u32,
    pub title: String,
    pub source_path: String,
    pub canonical_url: String,
    /// Always false: building cards never sends, uploads or fetches anything.
    pub remote_request_sent: bool,
    pub cards: Vec<VisualCard>,
    pub digest: String,
}

/// Builds every chosen destination's card. `measure` reports on one candidate image; it is
/// asked only about images whose address resolved, in the candidate order, and stops at the
/// first one a destination accepts.
pub fn plan(
    source: &CardSource<'_>,
    source_path: &str,
    formats: &[CardFormat],
    measure: &mut dyn FnMut(&ImageCandidate) -> Measurement,
) -> CardPlan {
    let cards: Vec<VisualCard> = formats
        .iter()
        .map(|format| build_card(*format, source, measure))
        .collect();
    let mut hasher = Blake2b512::new();
    for value in ["openblog-card-plan-v1", source_path, source.canonical_url] {
        crate::distribution::field(&mut hasher, value);
    }
    for card in &cards {
        crate::distribution::field(&mut hasher, card.format.as_str());
        crate::distribution::field(&mut hasher, &card.digest);
        crate::distribution::field(&mut hasher, status_code(card.status));
    }
    CardPlan {
        version: CARD_PLAN_VERSION,
        title: one_line(source.title),
        source_path: source_path.to_string(),
        canonical_url: source.canonical_url.to_string(),
        remote_request_sent: false,
        cards,
        digest: crate::distribution::hex(hasher),
    }
}

fn status_code(status: CardStatus) -> &'static str {
    match status {
        CardStatus::Ready => "ready",
        CardStatus::Check => "check",
        CardStatus::Blocked => "blocked",
    }
}

/// One destination's card: its words, then the first candidate image the destination accepts.
pub fn build_card(
    format: CardFormat,
    source: &CardSource<'_>,
    measure: &mut dyn FnMut(&ImageCandidate) -> Measurement,
) -> VisualCard {
    let fm = source.front_matter;
    let text = |key: &str, fallback: &str| -> (String, TextSource) {
        match scalar(fm, &[key]).filter(|_| format.takes_card_text()) {
            Some(written) => (one_line(written), TextSource::Card),
            None => (one_line(fallback), TextSource::Post),
        }
    };
    let (title, title_source) = text("cardTitle", source.title);
    let (description, description_source) = text("cardDescription", source.description);
    let candidates: Vec<ImageCandidate> = if format.takes_card_text() {
        image_candidates(source)
    } else {
        page_image_candidate(source).into_iter().collect()
    };

    let mut problems = Vec::new();
    let mut skipped = Vec::new();
    let mut image = None;
    for candidate in candidates {
        let mut found = candidate.problems.clone();
        let facts = if blocks(&found) || candidate.url.is_none() {
            None
        } else {
            match measure(&candidate) {
                Measurement::Measured(facts) => {
                    found.extend(check_image(format, &facts, source));
                    Some(facts)
                }
                Measurement::NotFound => {
                    found.push(CardProblem::new(
                        "image-not-found",
                        Severity::Blocking,
                        "The site's static folder has no file at this image's path, so the image would not load.",
                    ));
                    None
                }
                Measurement::Unreadable => {
                    found.push(CardProblem::new(
                        "image-unreadable",
                        Severity::Blocking,
                        "The file is not a JPEG, PNG, GIF or WebP image open.blog can read.",
                    ));
                    None
                }
                Measurement::Remote => {
                    found.push(CardProblem::new(
                        "image-unmeasured",
                        Severity::Check,
                        "The image is on another site, which open.blog never fetches: check its size and format yourself.",
                    ));
                    None
                }
            }
        };
        found.extend(check_alt(format, candidate.alt.as_deref()));
        if blocks(&found) {
            skipped.push(SkippedImage {
                origin: candidate.origin,
                src: candidate.src.clone(),
                problems: found,
            });
            continue;
        }
        problems.extend(found);
        image = Some(CardImage { candidate, facts });
        break;
    }
    if image.is_none() {
        problems.push(match (format.requires_image(), skipped.is_empty()) {
            (true, true) => CardProblem::new(
                "image-missing",
                Severity::Blocking,
                "This destination needs an image: set `cardImage` or `cover`, or for a recipe or travel post add a photograph.",
            ),
            (true, false) => CardProblem::new(
                "no-eligible-image",
                Severity::Blocking,
                "None of the post's images can be used here; each one skipped says why.",
            ),
            (false, true) => CardProblem::new(
                "no-preview-image",
                Severity::Notice,
                "The page declares no link preview image, so the preview shows text only. Set `cover`, or `ogImage` for the site.",
            ),
            (false, false) => CardProblem::new(
                "page-image-unusable",
                Severity::Blocking,
                "The page's link preview image would not be shown as it is; see why, then change the cover or the site's `ogImage`.",
            ),
        });
    }
    let credit = image
        .as_ref()
        .and_then(|image| image.candidate.credit.line());
    problems.extend(check_text(
        format,
        &title,
        &description,
        credit.as_deref(),
        source.canonical_url,
    ));
    problems.sort_by_key(|problem| problem.severity);
    let status = if blocks(&problems) {
        CardStatus::Blocked
    } else if problems.iter().any(|p| p.severity == Severity::Check) {
        CardStatus::Check
    } else {
        CardStatus::Ready
    };
    let alt = image.as_ref().and_then(|i| i.candidate.alt.clone());
    let digest = card_digest(
        format,
        &title,
        &description,
        alt.as_deref(),
        source.canonical_url,
        image.as_ref(),
    );
    VisualCard {
        format,
        label: format.label(),
        status,
        title,
        title_source,
        description,
        description_source,
        alt,
        link: source.canonical_url.to_string(),
        image,
        skipped,
        problems,
        policy_version: CARD_POLICY_VERSION,
        digest,
    }
}

fn blocks(problems: &[CardProblem]) -> bool {
    problems.iter().any(|p| p.severity == Severity::Blocking)
}

fn check_alt(format: CardFormat, alt: Option<&str>) -> Vec<CardProblem> {
    let mut out = Vec::new();
    match alt {
        None if format.requires_image() => out.push(CardProblem::new(
            "alt-missing",
            Severity::Blocking,
            "This image has no alternative text: describe it in `cardImageAlt`, `coverAlt`, or the image's Markdown description.",
        )),
        None => out.push(CardProblem::new(
            "alt-missing",
            Severity::Notice,
            "The link preview image has no alternative text: describe it in `coverAlt`.",
        )),
        Some(alt) => {
            if let Some(max) = format.spec().max_alt_chars {
                if alt.chars().count() > max {
                    out.push(CardProblem::new(
                        "alt-too-long",
                        Severity::Blocking,
                        format!("The alternative text is longer than the {max} characters this destination accepts."),
                    ));
                }
            }
        }
    }
    out
}

/// The description a destination receives. A Pin carries the image credit after the card's own
/// description, so the credit counts toward Pinterest's description limit.
pub fn sent_description(format: CardFormat, description: &str, credit: Option<&str>) -> String {
    match credit.filter(|_| format == CardFormat::PinterestPin) {
        Some(credit) if description.trim().is_empty() => credit.to_string(),
        Some(credit) => format!(
            "{description}

{credit}"
        ),
        None => description.to_string(),
    }
}

fn check_text(
    format: CardFormat,
    title: &str,
    description: &str,
    credit: Option<&str>,
    link: &str,
) -> Vec<CardProblem> {
    let mut out = Vec::new();
    let spec = format.spec();
    let sent = sent_description(format, description, credit);
    let credit_counted = sent != description;
    let link_ok = Url::parse(link)
        .ok()
        .is_some_and(|url| url.scheme() == "https" && url.host_str().is_some());
    if !link_ok {
        out.push(CardProblem::new(
            "link-not-public",
            Severity::Blocking,
            "The canonical address must be a public https:// address; set the site's `url`.",
        ));
    }
    if title.is_empty() {
        out.push(CardProblem::new(
            "title-missing",
            Severity::Blocking,
            "The card has no title.",
        ));
    }
    let limits = [
        (
            "title-too-long",
            "title",
            title,
            spec.max_title_chars,
            "`cardTitle`",
        ),
        (
            "description-too-long",
            if credit_counted {
                "description with its image credit"
            } else {
                "description"
            },
            sent.as_str(),
            spec.max_description_chars,
            if credit_counted {
                "`cardDescription` or the image credit"
            } else {
                "`cardDescription`"
            },
        ),
        (
            "link-too-long",
            "link",
            link,
            spec.max_link_chars,
            "the post's address",
        ),
    ];
    for (code, what, value, max, field) in limits {
        if let Some(max) = max {
            if value.chars().count() > max {
                out.push(CardProblem::new(
                    code,
                    Severity::Blocking,
                    format!("The {what} is longer than the {max} characters this destination accepts; shorten {field}."),
                ));
            }
        }
    }
    if let Some(shown) = spec.feed_title_chars {
        if title.chars().count() > shown
            && spec
                .max_title_chars
                .is_none_or(|max| title.chars().count() <= max)
        {
            out.push(CardProblem::new(
                "title-shortened-in-feeds",
                Severity::Notice,
                format!("Feeds may show only about the first {shown} characters of the title; put the words that matter first."),
            ));
        }
    }
    out
}

fn card_digest(
    format: CardFormat,
    title: &str,
    description: &str,
    alt: Option<&str>,
    link: &str,
    image: Option<&CardImage>,
) -> String {
    let mut hasher = Blake2b512::new();
    let candidate = image.map(|i| &i.candidate);
    for value in [
        "openblog-visual-card-v1",
        format.as_str(),
        title,
        description,
        alt.unwrap_or(""),
        link,
        candidate.and_then(|c| c.url.as_deref()).unwrap_or(""),
        candidate
            .and_then(|c| c.credit.text.as_deref())
            .unwrap_or(""),
        candidate
            .and_then(|c| c.credit.url.as_deref())
            .unwrap_or(""),
    ] {
        crate::distribution::field(&mut hasher, value);
    }
    crate::distribution::hex(hasher)
}

/// Greedy word wrap by characters, breaking a word longer than a line. Deterministic.
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    for word in text.split_whitespace() {
        let mut word: Vec<char> = word.chars().collect();
        while word.len() > width {
            if !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            lines.push(word.drain(..width).collect());
        }
        let word: String = word.into_iter().collect();
        if word.is_empty() {
            continue;
        }
        let needed = line.chars().count() + usize::from(!line.is_empty()) + word.chars().count();
        if !line.is_empty() && needed > width {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(&word);
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// At most `max` lines, the last ending in an ellipsis when text was left out.
fn clamp(mut lines: Vec<String>, max: usize, width: usize) -> Vec<String> {
    if lines.len() > max {
        lines.truncate(max);
        if let Some(last) = lines.last_mut() {
            let keep: String = last.chars().take(width.saturating_sub(1)).collect();
            *last = format!("{}…", keep.trim_end());
        }
    }
    lines
}

/// A layout preview of the card as the destination presents it: the image cropped to the
/// destination's shape, and its words beneath. `image_href` is where the preview finds the
/// image file (beside it); without one a labelled placeholder is drawn and nothing is loaded.
/// Every value is escaped; the same card always gives the same bytes.
pub fn card_svg(card: &VisualCard, id: &str, image_href: Option<&str>) -> String {
    let t = crate::escape::text;
    let (width, height) = card.format.canvas();
    let size = 44u32;
    let chars = (width / (size * 11 / 20)) as usize;
    let host = Url::parse(&card.link)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_default();
    let mut words: Vec<(u32, &str, &str, String)> = Vec::new();
    if !card.format.takes_card_text() {
        words.push((28, "400", "#4a4a55", host.to_uppercase()));
    }
    for line in clamp(wrap(&card.title, chars), 2, chars) {
        words.push((size, "700", "#1b1b1f", line));
    }
    let small_chars = (width / (30 * 11 / 20)) as usize;
    if !card.format.takes_card_text() && !card.description.is_empty() {
        for line in clamp(wrap(&card.description, small_chars), 1, small_chars) {
            words.push((30, "400", "#4a4a55", line));
        }
    }
    if card.format.takes_card_text() {
        words.push((28, "400", "#4a4a55", host.clone()));
    }
    if let Some(credit) = card.image.as_ref().and_then(|i| i.candidate.credit.line()) {
        for line in clamp(wrap(&credit, small_chars), 1, small_chars) {
            words.push((26, "400", "#4a4a55", line));
        }
    }
    let panel: u32 = 40 + words.iter().map(|(s, ..)| s * 3 / 2).sum::<u32>() + 24;
    let total = height + panel;
    let alt = card.alt.as_deref().unwrap_or("No image");
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {width} {total}\" width=\"{width}\" height=\"{total}\" role=\"img\" aria-labelledby=\"{id}-title {id}-desc\">\n<title id=\"{id}-title\">{} layout preview</title>\n<desc id=\"{id}-desc\">{}</desc>\n<rect width=\"{width}\" height=\"{total}\" fill=\"#ffffff\"/>\n",
        t(card.label),
        t(alt)
    );
    match image_href {
        Some(href) => out.push_str(&format!(
            "<image href=\"{}\" x=\"0\" y=\"0\" width=\"{width}\" height=\"{height}\" preserveAspectRatio=\"xMidYMid slice\"/>\n",
            t(href)
        )),
        None => {
            let note = match &card.image {
                Some(image) if image.candidate.is_remote() => {
                    "Image on another site: not loaded in this preview"
                }
                Some(_) => "Image not copied into this preview",
                None => "No image",
            };
            out.push_str(&format!(
                "<rect width=\"{width}\" height=\"{height}\" fill=\"#d9d9de\"/>\n<text x=\"{}\" y=\"{}\" font-family=\"system-ui, sans-serif\" font-size=\"36\" fill=\"#1b1b1f\" text-anchor=\"middle\">{note}</text>\n",
                width / 2,
                height / 2
            ));
        }
    }
    let mut y = height + 40;
    for (font, weight, fill, line) in &words {
        y += font;
        out.push_str(&format!(
            "<text x=\"32\" y=\"{y}\" font-family=\"system-ui, sans-serif\" font-size=\"{font}\" font-weight=\"{weight}\" fill=\"{fill}\">{}</text>\n",
            t(line)
        ));
        y += font / 2;
    }
    out.push_str("</svg>\n");
    out
}

/// The files written beside a card's preview.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CardFiles {
    /// The layout preview, `NN-<format>.svg`.
    pub svg: String,
    /// A copy of the chosen image from the site's static folder, when there is one.
    pub image: Option<String>,
}

/// The dry-run page: static, script-free HTML with each card's layout preview, its exact words,
/// its alternative text, its image and credit, and every problem and skipped image in words.
pub fn preview_page(plan: &CardPlan, files: &[CardFiles]) -> String {
    let t = crate::escape::text;
    let mut out = String::new();
    out.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    out.push_str(&format!(
        "<title>Visual cards: {}</title>\n",
        t(&plan.title)
    ));
    out.push_str(crate::distribution::PAGE_STYLE);
    out.push_str("<style>\nfigure{margin:1rem 0}figure svg{display:block;width:100%;max-width:24rem;height:auto;border:1px solid var(--line)}figcaption{color:var(--muted)}\n</style>\n");
    out.push_str("</head>\n<body>\n<main>\n");
    out.push_str(&format!("<h1>Visual cards: {}</h1>\n", t(&plan.title)));
    out.push_str("<p class=\"notice\"><strong>Preview, not sent.</strong> No image was generated, uploaded or sent, nothing was fetched from another site, and no credential was read.</p>\n<dl>\n");
    out.push_str(&format!(
        "<dt>Canonical address</dt><dd><a href=\"{}\">{}</a></dd>\n<dt>Source</dt><dd>{}</dd>\n<dt>Card plan digest</dt><dd><code>{}</code></dd>\n</dl>\n",
        crate::escape::attr(&plan.canonical_url),
        t(&plan.canonical_url),
        t(&plan.source_path),
        t(&plan.digest)
    ));
    out.push_str("<section aria-labelledby=\"summary-title\">\n<h2 id=\"summary-title\">Destinations</h2>\n<table>\n<caption>Each destination's card and whether it can be used</caption>\n<thead><tr><th scope=\"col\">Destination</th><th scope=\"col\">Status</th></tr></thead>\n<tbody>\n");
    for (index, card) in plan.cards.iter().enumerate() {
        out.push_str(&format!(
            "<tr><th scope=\"row\"><a href=\"#card-{}\">{}</a></th><td>{}</td></tr>\n",
            index + 1,
            t(card.label),
            card.status.words()
        ));
    }
    out.push_str("</tbody>\n</table>\n</section>\n");
    for (index, card) in plan.cards.iter().enumerate() {
        let id = format!("card-{}", index + 1);
        let file = files.get(index).cloned().unwrap_or_default();
        out.push_str(&format!(
            "<section aria-labelledby=\"{id}\">\n<h2 id=\"{id}\">{}</h2>\n<p><strong>Status:</strong> {}.</p>\n",
            t(card.label),
            card.status.words()
        ));
        out.push_str(&format!(
            "<figure>\n{}<figcaption>Layout preview at the destination's recommended size; the destination draws its own card.</figcaption>\n</figure>\n",
            card_svg(card, &format!("{id}-svg"), file.image.as_deref())
        ));
        out.push_str(&format!(
            "<table>\n<caption>What the {} card holds</caption>\n<tbody>\n",
            t(card.label)
        ));
        let from = |source: TextSource, key: &str, own: &str| match source {
            TextSource::Card => format!(" <span class=\"code\">(from <code>{key}</code>)</span>"),
            TextSource::Post => format!(" <span class=\"code\">(the post's {own})</span>"),
        };
        let row = |out: &mut String, name: &str, value: String| {
            out.push_str(&format!(
                "<tr><th scope=\"row\">{name}</th><td>{value}</td></tr>\n"
            ));
        };
        row(
            &mut out,
            "Title",
            format!(
                "{}{}",
                t(&card.title),
                from(card.title_source, "cardTitle", "title")
            ),
        );
        row(
            &mut out,
            "Description",
            if card.description.is_empty() {
                "<em>none</em>".to_string()
            } else {
                format!(
                    "{}{}",
                    t(&card.description),
                    from(card.description_source, "cardDescription", "description")
                )
            },
        );
        row(
            &mut out,
            "Alternative text",
            card.alt
                .as_deref()
                .map(t)
                .unwrap_or_else(|| "<em>none</em>".to_string()),
        );
        row(
            &mut out,
            "Link",
            format!(
                "<a href=\"{}\">{}</a>",
                crate::escape::attr(&card.link),
                t(&card.link)
            ),
        );
        match &card.image {
            Some(image) => {
                let facts = image
                    .facts
                    .map(|f| {
                        format!(
                            ", {} {} × {} pixels, {} bytes",
                            f.media_type.label(),
                            f.width,
                            f.height,
                            f.bytes
                        )
                    })
                    .unwrap_or_default();
                row(
                    &mut out,
                    "Image",
                    format!(
                        "{}: <code>{}</code>{facts}",
                        image.candidate.origin.describe(),
                        t(&image.candidate.src)
                    ),
                );
                let credit = match (&image.candidate.credit.text, &image.candidate.credit.url) {
                    (None, None) => "<em>none recorded</em>".to_string(),
                    (text, url) => {
                        let words = t(text.as_deref().unwrap_or("Image source"));
                        match url {
                            Some(url) => {
                                format!("<a href=\"{}\">{words}</a>", crate::escape::attr(url))
                            }
                            None => words,
                        }
                    }
                };
                row(&mut out, "Image credit", credit);
            }
            None => row(&mut out, "Image", "<em>none</em>".to_string()),
        }
        out.push_str("</tbody>\n</table>\n");
        if !card.problems.is_empty() {
            out.push_str(&format!(
                "<h3 id=\"{id}-problems\">What to fix or check</h3>\n<ul aria-labelledby=\"{id}-problems\">\n"
            ));
            for problem in &card.problems {
                out.push_str(&format!(
                    "<li><strong>{}:</strong> {} <span class=\"code\">({})</span></li>\n",
                    severity_words(problem.severity),
                    t(&problem.message),
                    problem.code
                ));
            }
            out.push_str("</ul>\n");
        }
        if !card.skipped.is_empty() {
            out.push_str(&format!(
                "<h3 id=\"{id}-skipped\">Images passed over</h3>\n<ul aria-labelledby=\"{id}-skipped\">\n"
            ));
            for skipped in &card.skipped {
                let reasons: Vec<String> = skipped
                    .problems
                    .iter()
                    .filter(|p| p.severity == Severity::Blocking)
                    .map(|p| format!("{} <span class=\"code\">({})</span>", t(&p.message), p.code))
                    .collect();
                out.push_str(&format!(
                    "<li>{} <code>{}</code>: {}</li>\n",
                    skipped.origin.describe(),
                    t(&skipped.src),
                    reasons.join(" ")
                ));
            }
            out.push_str("</ul>\n");
        }
        out.push_str(&format!(
            "<p>Checked under the requirements of {}. Card digest <code>{}</code>. Saved as <a href=\"{}\">{}</a>.</p>\n</section>\n",
            card.policy_version,
            card.digest,
            crate::escape::attr(&file.svg),
            t(&file.svg)
        ));
    }
    out.push_str("<section aria-labelledby=\"next-title\">\n<h2 id=\"next-title\">Change a card</h2>\n<p>Nothing here is sent. To change a card, edit <code>cardTitle</code>, <code>cardDescription</code>, <code>cardImage</code>, <code>cardImageAlt</code>, <code>coverAlt</code> or the credit fields in the post's front matter, then preview again. A link preview shows the page's own title, description and cover.</p>\n</section>\n</main>\n</body>\n</html>\n");
    out
}

fn severity_words(severity: Severity) -> &'static str {
    match severity {
        Severity::Blocking => "Blocking",
        Severity::Check => "Check",
        Severity::Notice => "Note",
    }
}

// ----------------------------------------------------------------------------------------------
// Destination requirements (ADR 0370).

/// The day every destination's requirements below were checked against its own documentation.
pub const CARD_POLICY_VERSION: &str = "2026-10-29";

/// What a destination requires of a card, as verified on [`CARD_POLICY_VERSION`]. `None` means
/// the destination's documentation states no such limit, so open.blog checks none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FormatSpec {
    /// The size the destination recommends, and the shape (width, height) it displays.
    pub recommended: (u32, u32),
    pub ratio: (u32, u32),
    /// Below this the destination does not show the image as a card.
    pub minimum: Option<(u32, u32)>,
    /// Below this the destination shows the image small.
    pub large_minimum: Option<(u32, u32)>,
    pub max_bytes: Option<u64>,
    pub media_types: Option<&'static [MediaType]>,
    pub max_title_chars: Option<usize>,
    pub max_description_chars: Option<usize>,
    pub max_alt_chars: Option<usize>,
    pub max_link_chars: Option<usize>,
    /// About how much of the title feeds show.
    pub feed_title_chars: Option<usize>,
    pub sources: &'static [&'static str],
}

impl CardFormat {
    pub fn spec(self) -> FormatSpec {
        match self {
            // Pinterest API v5 `POST /v5/pins` (PinCreate: title 100, description 800,
            // alt_text 500, link 2048; image media types image/jpeg and image/png) and the
            // Pinterest product specs (2:3, 1000 x 1500, up to 20 MB, about 40 title
            // characters in feeds).
            Self::PinterestPin => FormatSpec {
                recommended: (1000, 1500),
                ratio: (2, 3),
                minimum: None,
                large_minimum: None,
                max_bytes: Some(20_000_000),
                media_types: Some(&[MediaType::Jpeg, MediaType::Png]),
                max_title_chars: Some(100),
                max_description_chars: Some(800),
                max_alt_chars: Some(500),
                max_link_chars: Some(2048),
                feed_title_chars: Some(40),
                sources: &[
                    "https://developers.pinterest.com/docs/api/v5/pins-create/",
                    "https://github.com/pinterest/api-description/blob/main/v5/openapi.json",
                    "https://help.pinterest.com/en/business/article/pinterest-product-specs",
                ],
            },
            // Meta's sharing guide for webmasters: at least 200 x 200, 600 x 315 for a large
            // image, 1200 x 630 recommended, about 1.91:1, up to 8 MB.
            Self::FacebookLink => FormatSpec {
                recommended: (1200, 630),
                ratio: (191, 100),
                minimum: Some((200, 200)),
                large_minimum: Some((600, 315)),
                max_bytes: Some(8_000_000),
                media_types: None,
                max_title_chars: None,
                max_description_chars: None,
                max_alt_chars: None,
                max_link_chars: None,
                feed_title_chars: None,
                sources: &["https://developers.facebook.com/docs/sharing/webmasters/images/"],
            },
            // LinkedIn Help, "Make your website shareable on LinkedIn": at least 1200 x 627,
            // 1.91:1, up to 5 MB.
            Self::LinkedinLink => FormatSpec {
                recommended: (1200, 627),
                ratio: (191, 100),
                minimum: Some((1200, 627)),
                large_minimum: None,
                max_bytes: Some(5_000_000),
                media_types: None,
                max_title_chars: None,
                max_description_chars: None,
                max_alt_chars: None,
                max_link_chars: None,
                feed_title_chars: None,
                sources: &["https://www.linkedin.com/help/linkedin/answer/a521928"],
            },
        }
    }
}

/// Checks a measured image against a destination's requirements: its format, file size,
/// minimum and recommended sizes, shape, and any location it carries.
fn check_image(
    format: CardFormat,
    facts: &ImageFacts,
    source: &CardSource<'_>,
) -> Vec<CardProblem> {
    let spec = format.spec();
    let mut out = Vec::new();
    if let Some(types) = spec.media_types {
        if !types.contains(&facts.media_type) {
            let names: Vec<&str> = types.iter().map(|t| t.label()).collect();
            out.push(CardProblem::new(
                "image-type-unsupported",
                Severity::Blocking,
                format!(
                    "This destination accepts {} images only.",
                    names.join(" and ")
                ),
            ));
        }
    }
    if let Some(max) = spec.max_bytes {
        if facts.bytes > max {
            out.push(CardProblem::new(
                "image-too-large",
                Severity::Blocking,
                format!(
                    "The image file is larger than the {} MB this destination accepts.",
                    max / 1_000_000
                ),
            ));
        }
    }
    let below = |(w, h): (u32, u32)| facts.width < w || facts.height < h;
    let too_small = spec.minimum.filter(|size| below(*size));
    if let Some((w, h)) = too_small {
        out.push(CardProblem::new(
            "image-too-small",
            Severity::Blocking,
            format!("The image is smaller than the {w} × {h} pixels this destination needs."),
        ));
    } else if let Some((w, h)) = spec.large_minimum.filter(|size| below(*size)) {
        out.push(CardProblem::new(
            "image-shown-small",
            Severity::Notice,
            format!(
                "Below {w} × {h} pixels this destination shows the image small, beside the text."
            ),
        ));
    } else if facts.width < spec.recommended.0 {
        // The shape is reported on its own; this is about resolution.
        let (w, h) = spec.recommended;
        out.push(CardProblem::new(
            "below-recommended-size",
            Severity::Notice,
            format!(
                "The image is smaller than the recommended {w} × {h} pixels and may look soft."
            ),
        ));
    }
    // Shapes are compared exactly in whole numbers, with a 3% tolerance.
    let (rw, rh) = spec.ratio;
    let shown = u64::from(facts.width) * u64::from(rh);
    let wanted = u64::from(facts.height) * u64::from(rw);
    if shown.abs_diff(wanted) * 100 > wanted * 3 {
        let taller = shown < wanted;
        let message = match (format, taller) {
            (CardFormat::PinterestPin, true) => {
                "The image is taller than 2:3, so feeds may cut off its bottom."
            }
            (CardFormat::PinterestPin, false) => {
                "The image is wider than 2:3, so it shows shorter than a recommended Pin."
            }
            (_, _) => "The image is not about 1.91:1, so the destination crops it to that shape.",
        };
        out.push(CardProblem::new("shape-differs", Severity::Notice, message));
    }
    if facts.location_metadata || facts.metadata_unread {
        let travel_hidden = source.profile == crate::profile::FIELD_JOURNAL_ID
            && crate::field_journal::LocationPrivacy::parse(
                source.front_matter.get("locationPrivacy"),
            ) != crate::field_journal::LocationPrivacy::Exact;
        // A file whose metadata could not all be read may record a location: it is held to
        // the same rule as one that does, never taken as having none.
        let (code, what) = if facts.location_metadata {
            (
                "image-location-metadata",
                "The image file records where it was taken (GPS in its Exif or XMP data)",
            )
        } else {
            (
                "image-metadata-unread",
                "Not all of the image file's metadata could be read, so it may record where it was taken",
            )
        };
        out.push(if travel_hidden {
            CardProblem::new(
                code,
                Severity::Blocking,
                format!("{what}, but this travel post keeps its exact location private. Remove the location from the file first."),
            )
        } else {
            CardProblem::new(
                code,
                Severity::Check,
                format!("{what}. Remove it unless you mean to share that place."),
            )
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontmatter;
    use crate::image_facts::{ImageFacts, MediaType};

    fn fm(text: &str) -> FrontMatter {
        frontmatter::parse(&format!("---\n{text}\n---\n"))
            .unwrap()
            .front_matter
    }

    fn source<'a>(fm: &'a FrontMatter, profile: &'a str, markdown: &'a str) -> CardSource<'a> {
        CardSource {
            title: "Lemon tart",
            description: "A sharp, short tart.",
            profile,
            page_url: "https://cook.example.org/blog/posts/lemon-tart/",
            canonical_url: "https://cook.example.org/blog/posts/lemon-tart/",
            site_url: "https://cook.example.org/blog",
            page_image: None,
            page_image_alt: None,
            front_matter: fm,
            markdown,
        }
    }

    #[test]
    fn an_article_offers_its_card_image_then_its_cover_and_never_its_body() {
        let front = fm("cardImage: /img/card.png\ncardImageAlt: A tart on a blue plate\ncover: /img/cover.jpg\ncoverAlt: The kitchen\ncoverCredit: Ana Ruiz\ncoverCreditUrl: https://photos.example.net/ana");
        let found = image_candidates(&source(&front, "article", "![a slice](/img/slice.jpg)"));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].origin, ImageOrigin::CardImage);
        assert_eq!(found[0].site_path.as_deref(), Some("img/card.png"));
        assert_eq!(
            found[0].url.as_deref(),
            Some("https://cook.example.org/blog/img/card.png")
        );
        assert_eq!(found[0].alt.as_deref(), Some("A tart on a blue plate"));
        assert!(found[0].credit.is_empty());
        assert_eq!(found[1].origin, ImageOrigin::Cover);
        assert_eq!(found[1].credit.text.as_deref(), Some("Ana Ruiz"));
        assert_eq!(found[1].credit.line().as_deref(), Some("Image: Ana Ruiz"));
        assert!(found.iter().all(|c| c.problems.is_empty()));
    }

    #[test]
    fn recipes_and_travel_logs_add_their_body_photographs_once_each_in_order() {
        let front = fm("cover: /img/cover.jpg");
        let markdown = "Intro\n\n![The cover again](/img/cover.jpg)\n\n![Crust,\nblind baked](crust.jpg)\n\n![](/img/no-alt.jpg)";
        for profile in ["recipe", "field-journal"] {
            let found = image_candidates(&source(&front, profile, markdown));
            let origins: Vec<_> = found.iter().map(|c| c.origin).collect();
            assert_eq!(
                origins,
                [
                    ImageOrigin::Cover,
                    ImageOrigin::BodyImage,
                    ImageOrigin::BodyImage
                ]
            );
            // A relative body image resolves against the page, as a browser would.
            assert_eq!(
                found[1].site_path.as_deref(),
                Some("posts/lemon-tart/crust.jpg")
            );
            assert_eq!(found[1].alt.as_deref(), Some("Crust, blind baked"));
            assert_eq!(found[2].alt, None);
        }
        let many: String = (0..20).map(|i| format!("![p{i}](/p{i}.jpg)\n\n")).collect();
        assert_eq!(
            image_candidates(&source(&front, "recipe", &many)).len(),
            1 + MAX_BODY_IMAGES
        );
    }

    #[test]
    fn addresses_resolve_inside_the_site_or_are_refused_with_a_fixed_reason() {
        let cases = [
            ("/img/a%20b.png", Some("img/a b.png"), None),
            (
                "https://cook.example.org/blog/img/x.png",
                Some("img/x.png"),
                None,
            ),
            ("https://cdn.example.net/x.png", None, None),
            ("https://cook.example.org/other/x.png", None, None),
            (
                "http://cdn.example.net/x.png",
                None,
                Some("image-not-https"),
            ),
            (
                "data:image/png;base64,AAAA",
                None,
                Some("image-address-unusable"),
            ),
            (
                "//cdn.example.net/x.png",
                None,
                Some("image-address-unusable"),
            ),
            // Dot segments are normalised first: this one leaves the site, so it is never a file.
            ("/img/../../secret.png", None, None),
            (
                "/img/a%2F..%2F..%2Fx.png",
                None,
                Some("image-address-unusable"),
            ),
            ("/img/", None, Some("image-address-unusable")),
        ];
        for (src, path, code) in cases {
            let front = fm(&format!("cardImage: \"{src}\""));
            let found = image_candidates(&source(&front, "article", ""));
            assert_eq!(found[0].site_path.as_deref(), path, "{src}");
            assert_eq!(found[0].problems.first().map(|p| p.code), code, "{src}");
            for problem in &found[0].problems {
                assert!(!problem.message.contains(src), "{src}");
            }
        }
    }

    #[test]
    fn credits_are_one_line_bounded_and_link_only_over_https() {
        let front = fm(&format!(
            "cover: /c.jpg\ncoverCredit: \"{}\"\ncoverCreditUrl: http://photos.example.net",
            "x".repeat(MAX_CREDIT_CHARS + 1)
        ));
        let codes: Vec<_> = image_candidates(&source(&front, "article", ""))[0]
            .problems
            .iter()
            .map(|p| p.code)
            .collect();
        assert_eq!(codes, ["credit-too-long", "credit-url-invalid"]);
        let front = fm("cover: /c.jpg\ncoverCreditUrl: https://photos.example.net/1");
        let found = &image_candidates(&source(&front, "article", ""))[0];
        assert_eq!(found.credit.line().as_deref(), Some("Image source linked"));
        assert!(found.problems.is_empty());
    }

    #[test]
    fn the_page_image_is_what_the_build_declares_with_the_covers_credit() {
        let front = fm("cover: /img/cover.jpg\ncoverCredit: Ana Ruiz");
        let mut card = source(&front, "article", "");
        assert!(page_image_candidate(&card).is_none());
        card.page_image = Some("/img/cover.jpg");
        card.page_image_alt = Some("The kitchen");
        let page = page_image_candidate(&card).unwrap();
        assert_eq!(page.origin, ImageOrigin::PageImage);
        assert_eq!(page.credit.text.as_deref(), Some("Ana Ruiz"));
        card.page_image = Some("/default.png");
        assert!(page_image_candidate(&card).unwrap().credit.is_empty());
    }

    fn measured(width: u32, height: u32) -> impl FnMut(&ImageCandidate) -> Measurement {
        move |candidate: &ImageCandidate| match candidate.site_path {
            Some(_) => Measurement::Measured(ImageFacts {
                media_type: MediaType::Png,
                width,
                height,
                bytes: 1000,
                location_metadata: false,
                metadata_unread: false,
            }),
            None => Measurement::Remote,
        }
    }

    #[test]
    fn a_pin_takes_the_card_words_and_a_link_preview_keeps_the_pages_own() {
        let front = fm("cover: /c.png\ncoverAlt: A tart\ncardTitle: \"  Lemon tart,  sharp \"\ncardDescription: Bake it tonight.");
        let source = source(&front, "article", "");
        let pin = build_card(CardFormat::PinterestPin, &source, &mut measured(1000, 1500));
        assert_eq!(
            (pin.title.as_str(), pin.title_source),
            ("Lemon tart, sharp", TextSource::Card)
        );
        assert_eq!(
            (pin.description.as_str(), pin.description_source),
            ("Bake it tonight.", TextSource::Card)
        );
        assert_eq!(pin.alt.as_deref(), Some("A tart"));
        assert_eq!(pin.status, CardStatus::Ready, "{:?}", pin.problems);
        let link = build_card(CardFormat::FacebookLink, &source, &mut measured(1200, 630));
        assert_eq!(
            (link.title.as_str(), link.title_source),
            ("Lemon tart", TextSource::Post)
        );
        assert_eq!(link.description, "A sharp, short tart.");
    }

    #[test]
    fn a_pin_passes_over_an_image_without_alternative_text_and_says_why() {
        let front = fm("cardImage: /card.png\ncover: /c.png\ncoverAlt: A tart");
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        assert_eq!(
            pin.image.as_ref().unwrap().candidate.origin,
            ImageOrigin::Cover
        );
        assert_eq!(pin.skipped.len(), 1);
        assert_eq!(pin.skipped[0].problems[0].code, "alt-missing");
        let front = fm("cardImage: /card.png");
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        assert_eq!(pin.status, CardStatus::Blocked);
        assert_eq!(pin.problems[0].code, "no-eligible-image");
        let front = fm("title: x");
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        assert_eq!(pin.problems[0].code, "image-missing");
        let link = build_card(
            CardFormat::LinkedinLink,
            &source(&front, "article", ""),
            &mut measured(1200, 627),
        );
        assert_eq!(link.status, CardStatus::Ready);
        assert_eq!(link.problems[0].code, "no-preview-image");
    }

    #[test]
    fn a_remote_image_is_never_fetched_and_asks_a_person_to_check() {
        let front = fm("cover: https://cdn.example.net/tart.jpg\ncoverAlt: A tart");
        let mut asked = 0;
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut |candidate: &ImageCandidate| {
                asked += 1;
                assert!(candidate.is_remote());
                Measurement::Remote
            },
        );
        assert_eq!(asked, 1);
        assert_eq!(pin.status, CardStatus::Check);
        assert_eq!(pin.problems[0].code, "image-unmeasured");
    }

    #[test]
    fn a_pins_image_credit_counts_toward_its_description_limit() {
        // The Pin sends the credit after the description, so a card that fits only without it
        // is not Ready: `openblog card` and `openblog pinterest pin` must agree.
        let text = |credit: &str| {
            fm(&format!(
                "cover: /c.png
coverAlt: A tart
{credit}cardDescription: {}",
                "d".repeat(795)
            ))
        };
        let front = text(
            "coverCredit: Ana Ruiz
",
        );
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        assert_eq!(pin.status, CardStatus::Blocked, "{:?}", pin.problems);
        let problem = pin
            .problems
            .iter()
            .find(|p| p.code == "description-too-long")
            .expect("the credit is counted");
        assert!(
            problem.message.contains("image credit"),
            "{}",
            problem.message
        );
        // Without a credit the same words fit, and a link preview never carries the credit.
        let front = text("");
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        assert_eq!(pin.status, CardStatus::Ready, "{:?}", pin.problems);
        assert_eq!(
            sent_description(CardFormat::FacebookLink, "Words", Some("Image: Ana Ruiz")),
            "Words"
        );
        assert_eq!(
            sent_description(CardFormat::PinterestPin, " ", Some("Image: Ana Ruiz")),
            "Image: Ana Ruiz"
        );
    }

    #[test]
    fn pin_text_limits_are_the_providers_and_messages_never_repeat_the_text() {
        let long = "w".repeat(101);
        let front = fm(&format!(
            "cover: /c.png\ncoverAlt: {}\ncardTitle: {long}\ncardDescription: {}",
            "a".repeat(501),
            "d".repeat(801)
        ));
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        // The only image is passed over for its alternative text, so the card has no image.
        let codes: Vec<_> = pin.problems.iter().map(|p| p.code).collect();
        assert_eq!(
            codes,
            [
                "no-eligible-image",
                "title-too-long",
                "description-too-long"
            ]
        );
        assert_eq!(pin.skipped[0].problems[0].code, "alt-too-long");
        for problem in pin.problems.iter().chain(&pin.skipped[0].problems) {
            assert!(!problem.message.contains("www") && !problem.message.contains("ddd"));
        }
        let front = fm("cover: /c.png\ncoverAlt: A tart\ncardTitle: A title long enough to be cut short in a feed");
        let pin = build_card(
            CardFormat::PinterestPin,
            &source(&front, "article", ""),
            &mut measured(1000, 1500),
        );
        let codes: Vec<_> = pin.problems.iter().map(|p| p.code).collect();
        assert_eq!(codes, ["title-shortened-in-feeds"]);
        assert_eq!(pin.status, CardStatus::Ready);
    }

    #[test]
    fn the_digest_binds_every_word_the_image_and_the_credit() {
        let base = "cover: /c.png\ncoverAlt: A tart\ncoverCredit: Ana";
        let digest = |extra: &str| {
            let front = fm(&format!("{base}{extra}"));
            build_card(
                CardFormat::PinterestPin,
                &source(&front, "article", ""),
                &mut measured(1000, 1500),
            )
            .digest
        };
        let first = digest("");
        assert_eq!(first, digest(""));
        assert_eq!(first.len(), 32);
        for change in [
            "\ncardTitle: Other",
            "\ncardDescription: Other",
            "\ncoverCreditUrl: https://a.example.net",
            "\ncardImage: /d.png\ncardImageAlt: A tart",
        ] {
            assert_ne!(first, digest(change), "{change}");
        }
    }

    #[test]
    fn the_preview_is_deterministic_escaped_and_script_free() {
        let front = fm("cover: /c.png\ncoverAlt: \"<img src=x onerror=alert(1)>\"\ncoverCredit: \"Ana & <b>Co</b>\"\ncardTitle: \"</text><script>alert(1)</script>\"");
        let card_source = source(&front, "article", "");
        let one = plan(
            &card_source,
            "content/posts/tart.md",
            &CardFormat::ALL,
            &mut measured(1000, 1500),
        );
        let two = plan(
            &card_source,
            "content/posts/tart.md",
            &CardFormat::ALL,
            &mut measured(1000, 1500),
        );
        assert_eq!(one, two);
        let files: Vec<CardFiles> = (1..=3)
            .map(|i| CardFiles {
                svg: format!("0{i}.svg"),
                image: Some(format!("0{i}.png")),
            })
            .collect();
        let page = preview_page(&one, &files);
        assert_eq!(page, preview_page(&two, &files));
        assert!(!page.contains("<script"));
        assert!(!page.contains("<img src=x"));
        assert!(!page.contains("<b>Co</b>"));
        assert!(page.contains("&lt;/text&gt;&lt;script&gt;"));
        let svg = card_svg(&one.cards[0], "c1", Some("01.png"));
        assert!(svg.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1000 "));
        assert!(svg.contains("role=\"img\" aria-labelledby=\"c1-title c1-desc\""));
        assert!(svg.contains("<desc id=\"c1-desc\">&lt;img src=x onerror=alert(1)&gt;</desc>"));
        assert!(svg.contains("Image: Ana &amp; &lt;b&gt;Co&lt;/b&gt;"));
        assert!(!card_svg(&one.cards[0], "c1", None).contains("<image"));
        let order: Vec<_> = one.cards.iter().map(|c| c.format.as_str()).collect();
        assert_eq!(order, ["pinterest-pin", "facebook-link", "linkedin-link"]);
    }

    #[test]
    fn formats_are_a_closed_list_and_wrapping_is_greedy_and_bounded() {
        assert_eq!(CardFormat::parse_list("").unwrap(), CardFormat::ALL);
        assert_eq!(
            CardFormat::parse_list(" linkedin-link,pinterest-pin,linkedin-link ").unwrap(),
            [CardFormat::PinterestPin, CardFormat::LinkedinLink]
        );
        assert!(CardFormat::parse_list("pinterest-pin,tiktok")
            .unwrap_err()
            .contains("unknown card format"));
        assert_eq!(wrap("one two three four", 9), ["one two", "three", "four"]);
        assert_eq!(wrap("abcdefghij k", 4), ["abcd", "efgh", "ij k"]);
        assert_eq!(clamp(wrap("aaa bbb ccc ddd", 7), 1, 7), ["aaa bb\u{2026}"]);
    }

    fn facts(media_type: MediaType, width: u32, height: u32, bytes: u64, gps: bool) -> ImageFacts {
        ImageFacts {
            media_type,
            width,
            height,
            bytes,
            location_metadata: gps,
            metadata_unread: false,
        }
    }

    fn codes_for(
        format: CardFormat,
        image: ImageFacts,
        front: &str,
        profile: &str,
    ) -> Vec<&'static str> {
        let front = fm(front);
        check_image(format, &image, &source(&front, profile, ""))
            .iter()
            .map(|p| p.code)
            .collect()
    }

    #[test]
    fn each_destination_holds_an_image_to_its_own_verified_requirements() {
        use CardFormat::*;
        let cases: &[(CardFormat, ImageFacts, &[&str])] = &[
            (
                PinterestPin,
                facts(MediaType::Png, 1000, 1500, 20_000_000, false),
                &[],
            ),
            (
                PinterestPin,
                facts(MediaType::Jpeg, 2000, 3000, 1, false),
                &[],
            ),
            (
                PinterestPin,
                facts(MediaType::Webp, 1000, 1500, 1, false),
                &["image-type-unsupported"],
            ),
            (
                PinterestPin,
                facts(MediaType::Png, 1000, 1500, 20_000_001, false),
                &["image-too-large"],
            ),
            (
                PinterestPin,
                facts(MediaType::Png, 600, 900, 1, false),
                &["below-recommended-size"],
            ),
            (
                PinterestPin,
                facts(MediaType::Png, 1000, 2100, 1, false),
                &["shape-differs"],
            ),
            (
                PinterestPin,
                facts(MediaType::Png, 1200, 1200, 1, false),
                &["shape-differs"],
            ),
            (
                FacebookLink,
                facts(MediaType::Webp, 1200, 630, 8_000_000, false),
                &[],
            ),
            (
                FacebookLink,
                facts(MediaType::Png, 199, 300, 1, false),
                &["image-too-small", "shape-differs"],
            ),
            (
                FacebookLink,
                facts(MediaType::Png, 573, 300, 1, false),
                &["image-shown-small"],
            ),
            (
                FacebookLink,
                facts(MediaType::Png, 1000, 524, 1, false),
                &["below-recommended-size"],
            ),
            (
                FacebookLink,
                facts(MediaType::Png, 1200, 630, 8_000_001, false),
                &["image-too-large"],
            ),
            (
                LinkedinLink,
                facts(MediaType::Gif, 1200, 627, 5_000_000, false),
                &[],
            ),
            (
                LinkedinLink,
                facts(MediaType::Png, 1200, 630, 5_000_001, false),
                &["image-too-large"],
            ),
            (
                LinkedinLink,
                facts(MediaType::Png, 1199, 628, 1, false),
                &["image-too-small"],
            ),
            (
                LinkedinLink,
                facts(MediaType::Png, 1200, 1200, 1, false),
                &["shape-differs"],
            ),
        ];
        for (format, image, expected) in cases {
            assert_eq!(
                &codes_for(*format, *image, "title: x", "article"),
                expected,
                "{format:?} {image:?}"
            );
        }
    }

    #[test]
    fn a_photographs_location_is_held_back_for_a_private_travel_post() {
        let gps = facts(MediaType::Jpeg, 1000, 1500, 1, true);
        let severity = |front: &str, profile: &str| {
            let front = fm(front);
            check_image(CardFormat::PinterestPin, &gps, &source(&front, profile, ""))[0].severity
        };
        assert_eq!(severity("title: x", "field-journal"), Severity::Blocking);
        assert_eq!(
            severity("locationPrivacy: approximate", "field-journal"),
            Severity::Blocking
        );
        assert_eq!(
            severity("locationPrivacy: exact", "field-journal"),
            Severity::Check
        );
        assert_eq!(severity("title: x", "recipe"), Severity::Check);
    }

    #[test]
    fn metadata_that_could_not_all_be_read_is_held_to_the_location_rule() {
        let unread = ImageFacts {
            metadata_unread: true,
            ..facts(MediaType::Webp, 1200, 630, 1, false)
        };
        let check = |front: &str, profile: &str| {
            let front = fm(front);
            check_image(
                CardFormat::FacebookLink,
                &unread,
                &source(&front, profile, ""),
            )
            .into_iter()
            .find(|p| p.code == "image-metadata-unread")
            .map(|p| p.severity)
        };
        assert_eq!(
            check("locationPrivacy: hidden", "field-journal"),
            Some(Severity::Blocking)
        );
        assert_eq!(
            check("locationPrivacy: exact", "field-journal"),
            Some(Severity::Check)
        );
        assert_eq!(check("title: x", "article"), Some(Severity::Check));
    }

    #[test]
    fn a_pin_falls_back_past_an_image_the_destination_refuses_to_the_next_photograph() {
        let front = fm("profile: field-journal\ncover: /cover.webp\ncoverAlt: A ridge");
        let markdown = "![The trailhead](/trail.jpg)\n\n![The summit](/summit.png)";
        let card_source = source(&front, "field-journal", markdown);
        let pin = build_card(
            CardFormat::PinterestPin,
            &card_source,
            &mut |c: &ImageCandidate| {
                Measurement::Measured(match c.src.as_str() {
                    "/cover.webp" => facts(MediaType::Webp, 1000, 1500, 1, false),
                    "/trail.jpg" => facts(MediaType::Jpeg, 1000, 1500, 1, true),
                    _ => facts(MediaType::Png, 1000, 1500, 1, false),
                })
            },
        );
        let skipped: Vec<_> = pin
            .skipped
            .iter()
            .map(|s| (s.src.as_str(), s.problems[0].code))
            .collect();
        assert_eq!(
            skipped,
            [
                ("/cover.webp", "image-type-unsupported"),
                ("/trail.jpg", "image-location-metadata")
            ]
        );
        assert_eq!(pin.image.unwrap().candidate.src, "/summit.png");
        assert_eq!(pin.alt.as_deref(), Some("The summit"));
        assert_eq!(pin.status, CardStatus::Ready);
    }

    #[test]
    fn every_destination_states_its_sources_and_a_dated_policy() {
        assert_eq!(CARD_POLICY_VERSION.len(), 10);
        for format in CardFormat::ALL {
            let spec = format.spec();
            assert!(!spec.sources.is_empty());
            assert!(spec.sources.iter().all(|s| s.starts_with("https://")));
            assert_eq!(format.canvas(), spec.recommended);
        }
    }
}

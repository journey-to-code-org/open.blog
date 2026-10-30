//! Destination-ready visual cards (epic #383, story #393; ADRs 0780 to 0782).
//!
//! A visual card is what one image destination shows of a published post: one of the author's
//! own images, a title, a description, the image's alternative text, a link back to the canonical
//! post and, when the author recorded one, the image's source credit. Nothing here generates an
//! image or text: the image is one the post already publishes (its card image, its cover, or for
//! recipes and travel logs the photographs in the body), and the words are the post's own or the
//! author's explicit card fields. This module chooses and checks; it never sends.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use url::Url;

use crate::frontmatter::FrontMatter;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontmatter;

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
}

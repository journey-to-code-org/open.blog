//! What one finished job looks like at each place tradespeople are found (story #488, ADRs 0393
//! to 0395): Google Business Profile, a Facebook Page and Nextdoor.
//!
//! [`project`] is pure and deterministic: the same job and the same photo facts always give the
//! same words, link, photo and digest. It takes one line of summary, the service and town, the
//! job's own page and the first after-photo, and holds them to the destination's limits as the
//! preview shows them. Whether open.blog may send it, or the owner posts it by hand from a kit,
//! follows from the destination's provider manifest: only a destination whose manifest does
//! every requested capability through an adapter is sent; a capability done only by hand routes
//! the job to the kit; an unsupported one blocks it. Nothing here reads a file, a clock or the
//! network.

use blake2::{Blake2b512, Digest};
use serde::Serialize;

use crate::distribution::{field, hex, PAGE_STYLE};
use crate::escape;
use crate::image_facts::{ImageFacts, MediaType};
use crate::provider_manifest::{
    builtin_manifest, Capability, DistributionRequest, Ineligibility, ProviderId,
};

/// The format of a projection and a kit's `kit.json`.
pub const PROJECTION_VERSION: u32 = 1;
/// Nextdoor's Share Plugin takes a `body` of at most 3,500 characters, counted after URL
/// encoding (developer.nextdoor.com/reference/share-plugin, read 2026-11-08).
pub const NEXTDOOR_BODY_ENCODED_CHARS: usize = 3500;
/// Google Business Profile photos: JPEG or PNG, 10 KB to 5 MB, at least 250 by 250 pixels.
pub const GBP_PHOTO_MIN_BYTES: u64 = 10 * 1024;
pub const GBP_PHOTO_MAX_BYTES: u64 = 5 * 1024 * 1024;
pub const GBP_PHOTO_MIN_SIDE: u32 = 250;
const NEXTDOOR_SHARE: &str = "https://nextdoor.com/sharekit/";

/// The places a job can go.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobDestination {
    GoogleBusinessProfile,
    Facebook,
    Nextdoor,
}

impl JobDestination {
    pub const ALL: [JobDestination; 3] =
        [Self::GoogleBusinessProfile, Self::Facebook, Self::Nextdoor];

    pub fn as_str(self) -> &'static str {
        self.provider().as_str()
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|destination| destination.as_str() == value.trim())
    }

    pub fn provider(self) -> ProviderId {
        match self {
            Self::GoogleBusinessProfile => ProviderId::GoogleBusinessProfile,
            Self::Facebook => ProviderId::Facebook,
            Self::Nextdoor => ProviderId::Nextdoor,
        }
    }

    /// The most text the destination takes, and how it is counted.
    fn fits(self, text: &str) -> bool {
        match self {
            Self::GoogleBusinessProfile => {
                let limit = builtin_manifest(self.provider())
                    .constraints
                    .max_text_chars
                    .unwrap_or(u32::MAX) as usize;
                text.chars().count() <= limit
            }
            Self::Facebook => text.chars().count() <= crate::social_schedule::MAX_CAPTION_CHARS,
            Self::Nextdoor => encode(text).len() <= NEXTDOOR_BODY_ENCODED_CHARS,
        }
    }

    /// Whether the link goes in the words. Google Business Profile carries it as a button.
    fn link_in_text(self) -> bool {
        self != Self::GoogleBusinessProfile
    }
}

/// The first after-photo, as the caller found it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Photo<'a> {
    /// The job lists no after-photo.
    None,
    /// An `http(s)` address on another site: open.blog cannot check or copy it.
    Elsewhere(&'a str),
    /// A site path with no readable image file behind it.
    Missing(&'a str),
    /// A site path whose file is not an image open.blog can read.
    Unreadable(&'a str),
    /// A site file, its public address and what its header says.
    Measured {
        site_path: &'a str,
        url: &'a str,
        facts: ImageFacts,
    },
}

/// One job, as the site has it.
#[derive(Clone, Copy, Debug)]
pub struct JobSource<'a> {
    pub title: &'a str,
    pub description: &'a str,
    /// The service's name, or its id when the site has no services.
    pub service: &'a str,
    pub town: &'a str,
    pub region: &'a str,
    /// The job's own page, absolute.
    pub canonical_url: &'a str,
    pub photo: Photo<'a>,
}

/// How a projection reaches its destination.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Route {
    /// open.blog sends it, once the owner turned the destination on and confirmed the digest.
    Adapter,
    /// The owner posts it from the kit: copy the words, save the photo, open the destination.
    ByHand,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub code: &'static str,
    pub message: String,
    /// A blocking problem keeps the job from being sent or posted until it is fixed.
    pub blocking: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedPhoto {
    pub site_path: String,
    pub url: String,
    /// The name the kit saves it under.
    pub file_name: String,
    pub media_type: MediaType,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

/// One job, ready for one destination.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProjection {
    pub version: u32,
    pub destination: JobDestination,
    pub label: String,
    pub policy_version: String,
    pub route: Route,
    pub summary: String,
    pub service: String,
    pub town: String,
    pub region: String,
    pub link: String,
    /// Exactly the words sent or pasted.
    pub text: String,
    pub shortened: bool,
    pub photo: Option<ProjectedPhoto>,
    /// Where the owner posts it by hand.
    pub open_url: String,
    pub problems: Vec<Problem>,
    pub ready: bool,
    pub digest: String,
}

/// The one line a job is summed up in: the first line of its description, else its title, with
/// runs of white space made single spaces.
pub fn summary_line(title: &str, description: &str) -> String {
    let first = description
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let chosen = if first.is_empty() { title } else { first };
    chosen.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A service id as words when the site has no service of that id: `hardwood-install` is
/// `Hardwood install`.
pub fn service_words(id: &str) -> String {
    let words = id.trim().replace('-', " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// The public address of a site path.
fn public_link(link: &str) -> bool {
    let Ok(url) = url::Url::parse(link) else {
        return false;
    };
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && host.contains('.')
        && !host.ends_with(".localhost")
        && host.parse::<std::net::IpAddr>().is_err()
}

/// Percent-encodes everything but the unreserved characters, as a query value is.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn compose(summary: &str, place: &str, link: Option<&str>) -> String {
    let mut text = format!("{summary}\n\n{place}");
    if let Some(link) = link {
        text.push_str("\n\n");
        text.push_str(link);
    }
    text
}

/// The words for `destination`, with the summary cut at a word (or, failing that, a character)
/// and ended with an ellipsis when the whole would not fit. `None` when not even an empty summary
/// fits.
fn words(
    destination: JobDestination,
    summary: &str,
    place: &str,
    link: &str,
) -> Option<(String, bool)> {
    let link = destination.link_in_text().then_some(link);
    let whole = compose(summary, place, link);
    if destination.fits(&whole) {
        return Some((whole, false));
    }
    let chars: Vec<char> = summary.chars().collect();
    let cut = |count: usize| -> String {
        let prefix: String = chars[..count].iter().collect();
        let at_word = match prefix.rfind(' ') {
            Some(space) if count < chars.len() && space > 0 => prefix[..space].to_string(),
            _ => prefix,
        };
        format!("{}…", at_word.trim_end())
    };
    // The longest prefix that fits, found by halving: shorter prefixes never need more room.
    let (mut low, mut high) = (0usize, chars.len());
    if !destination.fits(&compose(&cut(0), place, link)) {
        return None;
    }
    while low < high {
        let middle = (low + high).div_ceil(2);
        if destination.fits(&compose(&cut(middle), place, link)) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    Some((compose(&cut(low), place, link), true))
}

fn file_name(site_path: &str) -> String {
    let last = site_path.rsplit('/').next().unwrap_or("");
    let safe: String = last
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .collect();
    let safe = safe.trim_start_matches('.').to_string();
    if safe.is_empty() {
        "after-photo".into()
    } else {
        safe
    }
}

fn problem(problems: &mut Vec<Problem>, code: &'static str, message: String, blocking: bool) {
    problems.push(Problem {
        code,
        message,
        blocking,
    });
}

/// What the photo means at `destination`: the photo that goes, and its problems.
fn photo(
    destination: JobDestination,
    label: &str,
    photo: Photo<'_>,
    problems: &mut Vec<Problem>,
) -> Option<ProjectedPhoto> {
    match photo {
        Photo::None => {
            problem(
                problems,
                "no-photo",
                "This job has no after photo, so the post goes without one. Add one to the job to show the finished work.".into(),
                false,
            );
            None
        }
        Photo::Elsewhere(_) => {
            let sent = destination == JobDestination::GoogleBusinessProfile;
            problem(
                problems,
                "photo-elsewhere",
                if sent {
                    format!("The first after photo is on another website, so open.blog cannot check it for {label}. Upload it to this site and use that.")
                } else {
                    "The first after photo is on another website, so it is not in the kit. Save it yourself, or upload it to this site.".into()
                },
                sent,
            );
            None
        }
        Photo::Missing(path) => {
            problem(
                problems,
                "photo-missing",
                format!("The first after photo, {path}, is not in the site's files. Upload it again, or remove it from the job."),
                true,
            );
            None
        }
        Photo::Unreadable(path) => {
            problem(
                problems,
                "photo-unreadable",
                format!("The first after photo, {path}, is not a JPEG, PNG, GIF or WebP open.blog can read."),
                true,
            );
            None
        }
        Photo::Measured {
            site_path,
            url,
            facts,
        } => {
            if facts.location_metadata || facts.metadata_unread {
                problem(
                    problems,
                    "photo-location",
                    "The first after photo may hold the place it was taken, which could be your customer's home. Save a copy without location data and use that.".into(),
                    true,
                );
            }
            if destination == JobDestination::GoogleBusinessProfile {
                if !matches!(facts.media_type, MediaType::Jpeg | MediaType::Png) {
                    problem(
                        problems,
                        "photo-format",
                        format!(
                            "{label} takes a JPEG or PNG photo; the first after photo is {}.",
                            facts.media_type.label()
                        ),
                        true,
                    );
                }
                if facts.bytes < GBP_PHOTO_MIN_BYTES || facts.bytes > GBP_PHOTO_MAX_BYTES {
                    problem(
                        problems,
                        "photo-size",
                        format!("{label} takes a photo of 10 KB to 5 MB; the first after photo is {} bytes.", facts.bytes),
                        true,
                    );
                }
                if facts.width < GBP_PHOTO_MIN_SIDE || facts.height < GBP_PHOTO_MIN_SIDE {
                    problem(
                        problems,
                        "photo-too-small",
                        format!("{label} takes a photo at least {GBP_PHOTO_MIN_SIDE} by {GBP_PHOTO_MIN_SIDE} pixels; the first after photo is {} by {}.", facts.width, facts.height),
                        true,
                    );
                }
            }
            Some(ProjectedPhoto {
                site_path: site_path.to_string(),
                url: url.to_string(),
                file_name: file_name(site_path),
                media_type: facts.media_type,
                width: facts.width,
                height: facts.height,
                bytes: facts.bytes,
            })
        }
    }
}

/// One job for one destination. Pure: identical input gives an identical projection.
pub fn project(source: &JobSource<'_>, destination: JobDestination) -> JobProjection {
    let manifest = builtin_manifest(destination.provider());
    let label = manifest.label.clone();
    let mut problems = Vec::new();
    let summary = summary_line(source.title, source.description);
    let service = source.service.trim().to_string();
    let town = source.town.trim().to_string();
    let region = source.region.trim().to_string();
    let place = match (service.is_empty(), region.is_empty()) {
        (false, false) => format!("{service} in {town}, {region}."),
        (false, true) => format!("{service} in {town}."),
        (true, false) => format!("In {town}, {region}."),
        (true, true) => format!("In {town}."),
    };
    let link = source.canonical_url.to_string();
    if !public_link(&link) {
        problem(
            &mut problems,
            "link-not-public",
            "The job's page is not at a public https address yet, so nobody could follow the link. Set the site's address in Settings and publish first.".into(),
            true,
        );
    }
    let (text, shortened) = match words(destination, &summary, &place, &link) {
        Some(words) => words,
        None => {
            problem(
                &mut problems,
                "text-too-long",
                format!(
                    "Even without its summary, the job's words and link are too long for {label}."
                ),
                true,
            );
            (
                compose(
                    &summary,
                    &place,
                    destination.link_in_text().then_some(&link),
                ),
                false,
            )
        }
    };
    if shortened {
        problem(
            &mut problems,
            "text-shortened",
            format!("The summary was shortened to fit {label}."),
            false,
        );
    }
    let photo = photo(destination, &label, source.photo, &mut problems);
    // The contract decides the route: everything by adapter is sent; anything by hand goes to the
    // kit; anything unsupported blocks (ADR 0326).
    let mut capabilities = vec![Capability::Link, Capability::Text];
    if photo.is_some() {
        capabilities.push(Capability::Image);
    }
    let mut request = DistributionRequest::new(capabilities);
    request.text_chars = Some(text.chars().count());
    // Only Google Business Profile has a job adapter. The Facebook Page adapter belongs to the
    // hosted announcements, which jobs do not feed, so a job goes to Facebook by hand (ADR 0395).
    let mut route = if destination == JobDestination::GoogleBusinessProfile {
        Route::Adapter
    } else {
        Route::ByHand
    };
    for ineligibility in manifest.check(&request) {
        match ineligibility {
            Ineligibility::ManualOnly(_) => route = Route::ByHand,
            // The words were fitted to this very limit above, or reported as too long there.
            Ineligibility::TextTooLong(_) => {}
            other => problem(&mut problems, other.code(), other.message(&label), true),
        }
    }
    let open_url = match destination {
        JobDestination::GoogleBusinessProfile => "https://business.google.com/".to_string(),
        JobDestination::Facebook => "https://www.facebook.com/".to_string(),
        JobDestination::Nextdoor => {
            format!("{NEXTDOOR_SHARE}?source=openblog&body={}", encode(&text))
        }
    };
    let ready = !problems.iter().any(|p| p.blocking);
    let mut hasher = Blake2b512::new();
    for part in [
        "openblog-job-projection/1",
        destination.as_str(),
        &manifest.policy_version,
        &text,
        &link,
    ] {
        field(&mut hasher, part);
    }
    match &photo {
        Some(photo) => {
            for part in [
                photo.url.as_str(),
                photo.media_type.mime(),
                &photo.width.to_string(),
                &photo.height.to_string(),
                &photo.bytes.to_string(),
            ] {
                field(&mut hasher, part);
            }
        }
        None => field(&mut hasher, ""),
    }
    JobProjection {
        version: PROJECTION_VERSION,
        destination,
        label,
        policy_version: manifest.policy_version,
        route,
        summary,
        service,
        town,
        region,
        link,
        text,
        shortened,
        photo,
        open_url,
        problems,
        ready,
        digest: hex(hasher),
    }
}

/// The kit as JSON: the projections exactly as previewed.
pub fn kit_json(title: &str, projections: &[JobProjection]) -> String {
    let value = serde_json::json!({
        "version": PROJECTION_VERSION,
        "job": title,
        "destinations": projections,
    });
    let mut text = serde_json::to_string_pretty(&value).unwrap_or_default();
    text.push('\n');
    text
}

/// The kit page: for each destination, the words to copy, the photo to save and the place to
/// post it. It posts nothing.
pub fn kit_page(title: &str, projections: &[JobProjection]) -> String {
    let t = escape::text;
    let a = escape::attr;
    let mut out = String::new();
    out.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"referrer\" content=\"no-referrer\">\n");
    out.push_str(&format!("<title>Share this job: {}</title>\n", t(title)));
    out.push_str(PAGE_STYLE);
    out.push_str("<style>\nimg{max-width:100%;height:auto;border:1px solid var(--line)}\n.open{font-weight:600}\n</style>\n");
    out.push_str("</head>\n<body>\n<main>\n");
    out.push_str(&format!("<h1>Share this job: {}</h1>\n", t(title)));
    out.push_str("<p class=\"notice\"><strong>Nothing has been posted.</strong> For each place below: copy the words, save the photo, then open the site and post it yourself.</p>\n");
    for (index, p) in projections.iter().enumerate() {
        let id = format!("destination-{}", index + 1);
        out.push_str(&format!(
            "<section aria-labelledby=\"{id}\">\n<h2 id=\"{id}\">{}</h2>\n",
            t(&p.label)
        ));
        let blocking: Vec<&Problem> = p.problems.iter().filter(|p| p.blocking).collect();
        let advice: Vec<&Problem> = p.problems.iter().filter(|p| !p.blocking).collect();
        out.push_str(&format!(
            "<p><strong>Status:</strong> {}</p>\n",
            if blocking.is_empty() {
                "Ready for you to post."
            } else {
                "Fix this first."
            }
        ));
        for (list, heading) in [(&blocking, "Fix this first"), (&advice, "Good to know")] {
            if list.is_empty() {
                continue;
            }
            out.push_str(&format!("<h3>{heading}</h3>\n<ul>\n"));
            for problem in list.iter() {
                out.push_str(&format!("<li>{}</li>\n", t(&problem.message)));
            }
            out.push_str("</ul>\n");
        }
        out.push_str(&format!(
            "<h3>1. Copy the words</h3>\n<pre tabindex=\"0\" aria-label=\"Words for {}\">{}</pre>\n",
            a(&p.label),
            t(&p.text)
        ));
        if !p.destination.link_in_text() {
            out.push_str(&format!(
                "<p>Add a <strong>Learn more</strong> button with this link: <a href=\"{}\">{}</a></p>\n",
                a(&p.link),
                t(&p.link)
            ));
        }
        match &p.photo {
            Some(photo) => out.push_str(&format!(
                "<h3>2. Save the photo</h3>\n<p><a href=\"images/{0}\" download>Save {0}</a></p>\n<img src=\"images/{0}\" alt=\"The finished job\" width=\"{1}\" height=\"{2}\">\n",
                a(&photo.file_name),
                photo.width,
                photo.height
            )),
            None => out.push_str("<h3>2. Photo</h3>\n<p>No photo for this one.</p>\n"),
        }
        if blocking.is_empty() {
            out.push_str(&format!(
                "<h3>3. Post it</h3>\n<p><a class=\"open\" href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">Open {}</a></p>\n",
                a(&p.open_url),
                t(&p.label)
            ));
        }
        out.push_str("</section>\n");
    }
    out.push_str("</main>\n</body>\n</html>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(media_type: MediaType, width: u32, height: u32, bytes: u64) -> ImageFacts {
        ImageFacts {
            media_type,
            width,
            height,
            bytes,
            location_metadata: false,
            metadata_unread: false,
        }
    }

    fn source<'a>(description: &'a str, photo: Photo<'a>) -> JobSource<'a> {
        JobSource {
            title: "New oak floor in Maple Falls",
            description,
            service: "Hardwood install",
            town: "Maple Falls",
            region: "WA",
            canonical_url: "https://example.com/new-oak-floor/",
            photo,
        }
    }

    fn measured(facts: ImageFacts) -> Photo<'static> {
        Photo::Measured {
            site_path: "/images/floor-after.jpg",
            url: "https://example.com/images/floor-after.jpg",
            facts,
        }
    }

    #[test]
    fn identical_input_gives_an_identical_projection() {
        let photo = measured(facts(MediaType::Jpeg, 1200, 900, 200_000));
        for destination in JobDestination::ALL {
            let a = project(&source("Sanded and sealed.", photo), destination);
            let b = project(&source("Sanded and sealed.", photo), destination);
            assert_eq!(a, b);
            assert_eq!(
                kit_page("Floor", std::slice::from_ref(&a)),
                kit_page("Floor", std::slice::from_ref(&b))
            );
            assert_eq!(kit_json("Floor", &[a]), kit_json("Floor", &[b]));
        }
        let one = project(
            &source("Sanded and sealed.", photo),
            JobDestination::Nextdoor,
        );
        let other = project(
            &source("Sanded and oiled.", photo),
            JobDestination::Nextdoor,
        );
        assert_ne!(one.digest, other.digest);
    }

    #[test]
    fn a_job_is_its_summary_service_town_link_and_first_after_photo() {
        let photo = measured(facts(MediaType::Jpeg, 1200, 900, 200_000));
        let gbp = project(
            &source("  Sanded and   sealed.\nMore detail here.", photo),
            JobDestination::GoogleBusinessProfile,
        );
        assert_eq!(gbp.summary, "Sanded and sealed.");
        assert_eq!(
            gbp.text,
            "Sanded and sealed.\n\nHardwood install in Maple Falls, WA."
        );
        assert_eq!(gbp.link, "https://example.com/new-oak-floor/");
        assert_eq!(gbp.route, Route::Adapter);
        assert!(gbp.ready, "{:?}", gbp.problems);
        assert_eq!(gbp.photo.as_ref().unwrap().file_name, "floor-after.jpg");
        let nextdoor = project(&source("", photo), JobDestination::Nextdoor);
        assert_eq!(nextdoor.summary, "New oak floor in Maple Falls");
        assert!(nextdoor
            .text
            .ends_with("\n\nhttps://example.com/new-oak-floor/"));
        assert_eq!(nextdoor.route, Route::ByHand);
        assert!(nextdoor
            .open_url
            .starts_with("https://nextdoor.com/sharekit/?source=openblog&body=New%20oak%20floor"));
        let facebook = project(&source("", photo), JobDestination::Facebook);
        assert_eq!(
            facebook.route,
            Route::ByHand,
            "a job goes to Facebook by hand"
        );
        assert!(facebook.ready);
        let without_photo = project(&source("", Photo::None), JobDestination::Facebook);
        assert_eq!(without_photo.route, Route::ByHand);
    }

    #[test]
    fn words_are_shortened_to_each_destinations_limit() {
        let long = "word ".repeat(2000);
        let photo = Photo::None;
        let gbp = project(&source(&long, photo), JobDestination::GoogleBusinessProfile);
        assert!(gbp.shortened);
        assert!(gbp.text.chars().count() <= 1500);
        assert!(gbp.text.chars().count() > 1400, "as much as fits");
        assert!(gbp.text.contains("word…\n\n"), "cut at a word");
        assert!(gbp.ready, "shortening is advice, not a block");
        let nextdoor = project(&source(&long, photo), JobDestination::Nextdoor);
        assert!(encode(&nextdoor.text).len() <= NEXTDOOR_BODY_ENCODED_CHARS);
        assert!(
            nextdoor
                .text
                .ends_with("https://example.com/new-oak-floor/"),
            "the link is kept"
        );
        let facebook = project(&source(&long, photo), JobDestination::Facebook);
        assert!(facebook.text.chars().count() <= 3000);
        assert!(facebook
            .problems
            .iter()
            .any(|p| p.code == "no-photo" && !p.blocking));
    }

    #[test]
    fn google_holds_the_photo_to_its_rules() {
        let cases = [
            (facts(MediaType::Webp, 1200, 900, 200_000), "photo-format"),
            (facts(MediaType::Jpeg, 1200, 900, 5_000), "photo-size"),
            (
                facts(MediaType::Png, 1200, 900, 6 * 1024 * 1024),
                "photo-size",
            ),
            (facts(MediaType::Jpeg, 200, 900, 200_000), "photo-too-small"),
        ];
        for (facts, code) in cases {
            let gbp = project(
                &source("x", measured(facts)),
                JobDestination::GoogleBusinessProfile,
            );
            assert!(!gbp.ready);
            assert!(
                gbp.problems.iter().any(|p| p.code == code && p.blocking),
                "{code}"
            );
            let nextdoor = project(&source("x", measured(facts)), JobDestination::Nextdoor);
            assert!(nextdoor.ready, "{code} is Google's rule only");
        }
        let mut located = facts(MediaType::Jpeg, 1200, 900, 200_000);
        located.location_metadata = true;
        for destination in JobDestination::ALL {
            let projection = project(&source("x", measured(located)), destination);
            assert!(projection
                .problems
                .iter()
                .any(|p| p.code == "photo-location" && p.blocking));
        }
        let elsewhere = Photo::Elsewhere("https://cdn.example.net/a.jpg");
        assert!(
            !project(
                &source("x", elsewhere),
                JobDestination::GoogleBusinessProfile
            )
            .ready
        );
        assert!(project(&source("x", elsewhere), JobDestination::Nextdoor).ready);
        assert!(
            !project(
                &source("x", Photo::Missing("/a.jpg")),
                JobDestination::Nextdoor
            )
            .ready
        );
    }

    #[test]
    fn a_page_without_a_public_address_is_never_shared() {
        let mut job = source("x", Photo::None);
        for url in [
            "http://example.com/a/",
            "https://localhost/a/",
            "https://127.0.0.1/a/",
            "/a/",
        ] {
            job.canonical_url = url;
            for destination in JobDestination::ALL {
                let projection = project(&job, destination);
                assert!(!projection.ready, "{url}");
                assert_eq!(projection.problems[0].code, "link-not-public");
            }
        }
    }

    #[test]
    fn the_kit_page_escapes_the_job_and_offers_each_step() {
        let mut job = source(
            "<script>x</script>",
            measured(facts(MediaType::Jpeg, 1200, 900, 200_000)),
        );
        job.title = "Floor & <b>";
        let projections: Vec<_> = JobDestination::ALL
            .iter()
            .map(|d| project(&job, *d))
            .collect();
        let page = kit_page(job.title, &projections);
        assert!(!page.contains("<script>"));
        assert!(page.contains("Floor &amp; &lt;b&gt;"));
        assert!(page.contains("href=\"images/floor-after.jpg\" download"));
        assert!(page.contains("Open Nextdoor"));
        assert!(page.contains("Learn more"));
        assert!(page.contains("Nothing has been posted."));
    }

    #[test]
    fn a_service_id_reads_as_words() {
        assert_eq!(service_words("hardwood-install"), "Hardwood install");
        assert_eq!(service_words(""), "");
        assert_eq!(file_name("/images/../.hidden"), "hidden");
        assert_eq!(file_name("/"), "after-photo");
    }
}

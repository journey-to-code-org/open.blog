//! Product Hunt launch kits (epic #384, story #396, ADRs 0804 to 0807).
//!
//! A **launch plan** is what the maker writes down for one post's product launch, in
//! `launches/<slug>.json`: the product's name, tagline, short pitch, screenshots, demo video and
//! launch metadata. A **launch kit** is that plan checked against what Product Hunt says it
//! accepts, with every reason it should not go ahead, ready for the maker to copy into Product
//! Hunt's own form. open.blog never creates, schedules or submits a launch: the Product Hunt
//! manifest says "by hand" (ADR 0804), and nothing here touches the network, reads a credential
//! or a file. The caller reads the images and hands their bytes' facts in.
//!
//! Notices are fixed text, apart from the limits, counts and file names they state.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use crate::community_submission::{
    normalize_title, provider_rule, ConfirmedSubmission, Notice, Rule, SubmissionRecords,
};
use crate::provider_manifest::{
    builtin_manifest, Capability, DistributionRequest, Ineligibility, ProviderId,
};

/// The launch plan format this release reads, and the kit format it writes.
pub const LAUNCH_VERSION: u32 = 1;
pub const LAUNCH_KIT_VERSION: u32 = 1;
/// The largest launch plan read.
pub const MAX_PLAN_BYTES: usize = 64 * 1024;
/// Product Hunt's tagline limit ("Preparing for launch").
pub const TAGLINE_MAX_CHARS: usize = 60;
/// Product Hunt's description limit in its launch guide; its help article says 260, which is
/// advice here (ADR 0805).
pub const DESCRIPTION_MAX_CHARS: usize = 500;
pub const DESCRIPTION_SHORT_CHARS: usize = 260;
/// The product's name: Product Hunt states no limit; this is open.blog's sanity bound.
pub const NAME_MAX_CHARS: usize = 80;
/// Every image must be under 3 MB.
pub const IMAGE_MAX_BYTES: u64 = 3 * 1024 * 1024;
/// The gallery shows once it has two images; open.blog prepares at most twelve.
pub const GALLERY_MIN: usize = 2;
pub const GALLERY_MAX: usize = 12;
/// Product Hunt's recommended sizes.
pub const GALLERY_WIDTH: u32 = 1270;
pub const GALLERY_HEIGHT: u32 = 760;
pub const THUMBNAIL_SIDE: u32 = 240;
/// Up to three launch tags.
pub const TAGS_MAX: usize = 3;
pub const TAG_MAX_CHARS: usize = 40;
/// Co-makers, by Product Hunt username; open.blog's bound.
pub const MAKERS_MAX: usize = 10;
pub const ALT_MAX_CHARS: usize = 300;
pub const FIRST_COMMENT_MAX_CHARS: usize = 5_000;
/// A launch can be scheduled up to a month ahead.
pub const SCHEDULE_HORIZON_DAYS: i64 = 31;
/// Pacific time is at most eight hours behind UTC; a day in the past is judged in it.
const PACIFIC_LAG_SECONDS: i64 = 8 * 3600;

/// Where the signed-in maker starts a new launch. It redirects to sign-in when signed out and
/// takes no prefilled field the kit relies on (ADR 0804).
pub const SUBMIT_URL: &str = "https://www.producthunt.com/posts/new";
const LAUNCH_GUIDE: &str = "https://www.producthunt.com/launch";
const PREPARING: &str = "https://www.producthunt.com/launch/preparing-for-launch";
const HOW_TO_POST: &str = "https://help.producthunt.com/en/articles/479557-how-to-post-a-product";

/// Product Hunt launch kits in `openblog.json`, under `community.productHunt`. Off by default.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ProductHuntConfig {
    pub enabled: bool,
    /// The project-relative folder of launch plans, one `<slug>.json` per post.
    pub launch_dir: String,
}

impl Default for ProductHuntConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            launch_dir: "launches".into(),
        }
    }
}

impl ProductHuntConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !project_relative(&self.launch_dir) {
            return Err(
                "community.productHunt.launchDir must be a project-relative folder without `..`"
                    .into(),
            );
        }
        Ok(())
    }
}

/// A project-relative path with no parent step, root or drive, in `/` or `\` spelling.
pub fn project_relative(path: &str) -> bool {
    let path = path.trim();
    !path.is_empty()
        && !path.starts_with(['/', '\\'])
        && !path.contains(':')
        && path.split(['/', '\\']).all(|part| part != "..")
        && !path.chars().any(char::is_control)
}

/// One image the maker names: a project-relative file and what it shows.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct LaunchImage {
    pub file: String,
    pub alt: String,
}

/// What the maker writes in `launches/<slug>.json`. Every field may be missing; what Product Hunt
/// requires is then a blocking notice, not a parse error, so the kit can say all that is missing.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct LaunchPlan {
    pub launch_version: Option<u32>,
    /// The product's name only, no description.
    pub name: String,
    pub tagline: String,
    /// The short pitch.
    pub description: String,
    /// The product's address, when it is not the post's canonical address.
    pub product_url: Option<String>,
    pub thumbnail: Option<LaunchImage>,
    /// Screenshots, in gallery order.
    pub gallery: Vec<LaunchImage>,
    /// A YouTube video address.
    pub demo: Option<String>,
    /// Launch tags, up to three.
    pub tags: Vec<String>,
    /// Co-makers' Product Hunt usernames.
    pub makers: Vec<String>,
    /// The maker's first comment.
    pub first_comment: String,
    /// The launch day, `YYYY-MM-DD` in Pacific time.
    pub launch_day: Option<String>,
}

/// Why a launch plan could not be read at all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlanError {
    TooLarge,
    Malformed(String),
    Version,
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge => write!(f, "the launch plan is larger than {MAX_PLAN_BYTES} bytes"),
            Self::Malformed(cause) => {
                write!(f, "the launch plan is not one this release reads: {cause}")
            }
            Self::Version => write!(f, "the launch plan's launchVersion is not {LAUNCH_VERSION}"),
        }
    }
}

impl LaunchPlan {
    /// Reads a plan, refusing it whole on an unknown field or a wrong type.
    pub fn from_json(text: &str) -> Result<Self, PlanError> {
        if text.len() > MAX_PLAN_BYTES {
            return Err(PlanError::TooLarge);
        }
        let plan: Self =
            serde_json::from_str(text).map_err(|error| PlanError::Malformed(error.to_string()))?;
        if plan.launch_version.is_some_and(|v| v != LAUNCH_VERSION) {
            return Err(PlanError::Version);
        }
        Ok(plan)
    }

    /// Every image file the plan names, thumbnail first, once each.
    pub fn image_files(&self) -> Vec<&str> {
        let mut files: Vec<&str> = Vec::new();
        for image in self.thumbnail.iter().chain(&self.gallery) {
            let file = image.file.trim();
            if !file.is_empty() && !files.contains(&file) {
                files.push(file);
            }
        }
        files
    }
}

/// The image formats the kit accepts, read from the file's first bytes, never its name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
}

impl ImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
        }
    }
}

/// What the caller found at an image's path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImageProbe {
    Found {
        bytes: u64,
        format: Option<ImageFormat>,
        size: Option<(u32, u32)>,
    },
    /// No such file.
    Missing,
    /// The path leaves the project, through `..` or a link.
    Outside,
}

/// Reads an image's format and pixel size from its first bytes. Only PNG, JPEG and GIF are
/// recognised; anything else is `(None, None)`.
pub fn sniff_image(bytes: &[u8]) -> (Option<ImageFormat>, Option<(u32, u32)>) {
    let be16 = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|b| u32::from(u16::from_be_bytes([b[0], b[1]])))
    };
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let size = bytes.get(16..24).and_then(|b| {
            let w = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
            let h = u32::from_be_bytes([b[4], b[5], b[6], b[7]]);
            (bytes.get(12..16) == Some(b"IHDR")).then_some((w, h))
        });
        return (Some(ImageFormat::Png), size);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        let size = bytes.get(6..10).map(|b| {
            (
                u32::from(u16::from_le_bytes([b[0], b[1]])),
                u32::from(u16::from_le_bytes([b[2], b[3]])),
            )
        });
        return (Some(ImageFormat::Gif), size);
    }
    if bytes.starts_with(&[0xFF, 0xD8]) {
        let mut at = 2;
        let mut size = None;
        while at + 4 <= bytes.len() {
            if bytes[at] != 0xFF {
                break;
            }
            let marker = bytes[at + 1];
            if marker == 0xFF {
                at += 1;
                continue;
            }
            let Some(length) = be16(at + 2) else { break };
            let start_of_frame =
                (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
            if start_of_frame {
                size = be16(at + 7).zip(be16(at + 5));
                break;
            }
            at += 2 + length as usize;
        }
        return (Some(ImageFormat::Jpeg), size);
    }
    (None, None)
}

/// One image as the kit offers it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitImage {
    /// Where the maker's plan names it, relative to the project.
    pub source: String,
    /// Where the kit folder holds its copy, or none when it cannot be offered.
    pub file: Option<String>,
    pub alt: String,
    pub format: Option<ImageFormat>,
    pub bytes: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// One text field of the launch, with its limit, ready to copy.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchField {
    pub id: &'static str,
    pub label: &'static str,
    pub value: String,
    pub chars: usize,
    pub limit: Option<usize>,
}

/// The post a launch kit is for, and the maker's choices for this run.
#[derive(Clone, Debug)]
pub struct LaunchRequest<'a> {
    pub slug: &'a str,
    pub source_id: &'a str,
    pub post_title: &'a str,
    pub canonical_url: &'a str,
    pub plan: &'a LaunchPlan,
    /// What the caller found at each file the plan names, keyed by its spelling in the plan.
    pub images: &'a BTreeMap<String, ImageProbe>,
    pub now_unix: i64,
    pub records: &'a SubmissionRecords,
    /// The maker says this is a relaunch for a significant new iteration.
    pub again: bool,
}

/// Everything the maker needs to enter the launch in Product Hunt's form by hand.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchKit {
    pub kit_version: u32,
    pub destination: String,
    pub provider: ProviderId,
    pub label: String,
    pub slug: String,
    pub post_title: String,
    /// The post stays the original: it is linked from the launch, never replaced by it.
    pub canonical_url: String,
    pub product_url: String,
    pub fields: Vec<LaunchField>,
    pub thumbnail: Option<KitImage>,
    pub gallery: Vec<KitImage>,
    pub demo: Option<String>,
    pub tags: Vec<String>,
    pub makers: Vec<String>,
    pub launch_day: Option<String>,
    /// Product Hunt's own form, offered only when nothing blocks.
    pub submit_url: Option<String>,
    pub rules: Vec<Rule>,
    pub notices: Vec<Notice>,
    pub policy_version: String,
    pub confirmed: Vec<ConfirmedSubmission>,
}

impl LaunchKit {
    pub fn ready(&self) -> bool {
        !self.notices.iter().any(|notice| notice.blocking)
    }

    pub fn field(&self, id: &str) -> Option<&LaunchField> {
        self.fields.iter().find(|field| field.id == id)
    }

    pub fn to_json_value(&self) -> Json {
        serde_json::to_value(self).unwrap_or(Json::Null)
    }
}

fn invisible(text: &str) -> bool {
    text.chars().any(|c| {
        (c.is_control() && c != '\n')
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
    })
}

// Hosts that only shorten or redirect, which Product Hunt does not accept as a product address.
const SHORTENERS: &[&str] = &[
    "bit.ly",
    "t.co",
    "tinyurl.com",
    "goo.gl",
    "ow.ly",
    "buff.ly",
    "is.gd",
    "lnkd.in",
    "rebrand.ly",
    "cutt.ly",
    "shorturl.at",
    "tiny.cc",
    "rb.gy",
];

/// Why an address is not one Product Hunt accepts for the product, if it is not.
fn product_url_problem(value: &str) -> Option<&'static str> {
    let Ok(url) = url::Url::parse(value) else {
        return Some("is not a full address");
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Some("must be a plain https address");
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if SHORTENERS.contains(&host.trim_start_matches("www.")) {
        return Some("is a shortened link, which Product Hunt does not accept");
    }
    let tracking = url.query_pairs().any(|(name, _)| {
        let name = name.to_ascii_lowercase();
        name.starts_with("utm_")
            || matches!(
                name.as_str(),
                "fbclid" | "gclid" | "mc_cid" | "mc_eid" | "ref"
            )
    });
    if tracking {
        return Some("has a tracking parameter, which Product Hunt does not accept");
    }
    None
}

/// The demo as Product Hunt takes it: a full YouTube watch address, normalized, or the problem.
pub fn youtube_demo(value: &str) -> Result<String, &'static str> {
    let url = url::Url::parse(value.trim()).map_err(|_| "is not a full address")?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host == "youtu.be" {
        return Err("is a shortened YouTube link; Product Hunt needs the full youtube.com address");
    }
    if url.scheme() != "https" || !matches!(host.as_str(), "www.youtube.com" | "youtube.com") {
        return Err("is not a YouTube address; Product Hunt takes YouTube videos only");
    }
    let id = url
        .query_pairs()
        .find(|(name, _)| name == "v")
        .map(|(_, id)| id.into_owned());
    match id {
        Some(id)
            if url.path() == "/watch"
                && (6..=20).contains(&id.len())
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') =>
        {
            Ok(format!("https://www.youtube.com/watch?v={id}"))
        }
        _ => Err("is not a YouTube video address such as https://www.youtube.com/watch?v=..."),
    }
}

/// A Product Hunt username as the kit accepts it: letters, digits and underscores, without `@`.
pub fn valid_maker(name: &str) -> bool {
    (1..=40).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn text_field(
    notices: &mut Vec<Notice>,
    id: &'static str,
    label: &'static str,
    raw: &str,
    limit: usize,
    one_line: bool,
) -> LaunchField {
    let value = if one_line {
        normalize_title(raw)
    } else {
        raw.trim().replace("\r\n", "\n")
    };
    let chars = value.chars().count();
    if chars == 0 {
        notices.push(Notice::blocking(
            "launch-field-missing",
            format!("Write the {label} in the launch plan; Product Hunt requires it."),
        ));
    } else if chars > limit {
        notices.push(Notice::blocking(
            "launch-field-too-long",
            format!("The {label} is {chars} characters; Product Hunt takes at most {limit}."),
        ));
    }
    if invisible(&value) {
        notices.push(Notice::blocking(
            "launch-field-invalid",
            format!(
                "The {label} has invisible or control characters; write it again in plain text."
            ),
        ));
    }
    LaunchField {
        id,
        label,
        value,
        chars,
        limit: Some(limit),
    }
}

/// Product Hunt's own points, paraphrased, each linked to the page it comes from.
fn launch_rules() -> Vec<Rule> {
    vec![
        provider_rule(
            "I am a maker of this product and post it from my personal account, not a company account.",
            LAUNCH_GUIDE,
        ),
        provider_rule(
            "I will not ask anyone to upvote it; I ask people to visit, try it and comment.",
            LAUNCH_GUIDE,
        ),
        provider_rule(
            "The name is only the product's name, with no description or emoji that is not part of it.",
            HOW_TO_POST,
        ),
        provider_rule(
            "The product address is the real one, not a shortened or tracking link.",
            PREPARING,
        ),
        provider_rule(
            "The thumbnail is square and every image is under 3 MB; GIFs show their first frame and do not strobe.",
            PREPARING,
        ),
        provider_rule(
            "This is a new product or a significant new iteration, not a repeat of a recent launch.",
            LAUNCH_GUIDE,
        ),
    ]
}

/// Checks a launch plan against Product Hunt's limits and the maker's records. Pure: the caller
/// has checked that Product Hunt is enabled and has probed the images.
pub fn prepare(request: &LaunchRequest<'_>) -> LaunchKit {
    let plan = request.plan;
    let manifest = builtin_manifest(ProviderId::ProductHunt);
    let mut notices = Vec::new();
    // The manifest must say the maker enters the link and the images by hand; anything else
    // fails closed (ADRs 0326, 0804).
    let guided = manifest.check(&DistributionRequest::new([
        Capability::Link,
        Capability::Image,
    ])) == [
        Ineligibility::ManualOnly(Capability::Link),
        Ineligibility::ManualOnly(Capability::Image),
    ];
    if !guided {
        notices.push(Notice::blocking(
            "manifest-not-guided",
            "The Product Hunt manifest no longer says the maker launches by hand, so nothing is prepared.",
        ));
    }

    let mut fields = vec![
        text_field(
            &mut notices,
            "name",
            "product name",
            &plan.name,
            NAME_MAX_CHARS,
            true,
        ),
        text_field(
            &mut notices,
            "tagline",
            "tagline",
            &plan.tagline,
            TAGLINE_MAX_CHARS,
            true,
        ),
        text_field(
            &mut notices,
            "description",
            "description",
            &plan.description,
            DESCRIPTION_MAX_CHARS,
            false,
        ),
    ];
    if fields[2].chars > DESCRIPTION_SHORT_CHARS && fields[2].chars <= DESCRIPTION_MAX_CHARS {
        notices.push(Notice::advice(
            "description-long",
            format!(
                "The description is {} characters. Product Hunt's launch guide takes {DESCRIPTION_MAX_CHARS}, but its help article says {DESCRIPTION_SHORT_CHARS}; the form decides.",
                fields[2].chars
            ),
        ));
    }
    if fields[1].value.ends_with('.') {
        notices.push(Notice::advice(
            "tagline-period",
            "The tagline ends with a full stop; a tagline reads as a phrase, not a sentence.",
        ));
    }
    let post_title = normalize_title(request.post_title);
    let bare = |text: &str| text.trim_end_matches(['.', '!']).to_lowercase();
    if !fields[1].value.is_empty() && bare(&fields[1].value) == bare(&post_title) {
        notices.push(Notice::advice(
            "tagline-is-post-title",
            "The tagline is the post's title. It should say what the product does, in a few words.",
        ));
    }

    // The product's address; the canonical post is always the post's own address.
    let product_url = plan
        .product_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .unwrap_or(request.canonical_url)
        .to_string();
    if let Some(problem) = product_url_problem(&product_url) {
        notices.push(Notice::blocking(
            "product-url-invalid",
            format!("The product address {problem}."),
        ));
    }

    // The first comment is optional, and its points are judgement, so they never block.
    let first_comment = plan.first_comment.trim().replace("\r\n", "\n");
    let comment_chars = first_comment.chars().count();
    if first_comment.is_empty() {
        notices.push(Notice::advice(
            "first-comment-missing",
            "There is no first comment. Product Hunt suggests one: who you are, why you made it, and what feedback you want.",
        ));
    } else {
        if comment_chars > FIRST_COMMENT_MAX_CHARS || invisible(&first_comment) {
            notices.push(Notice::blocking(
                "first-comment-invalid",
                format!(
                    "The first comment must be plain text of at most {FIRST_COMMENT_MAX_CHARS} characters."
                ),
            ));
        }
        let lower = first_comment.to_lowercase();
        if ["upvote", "up-vote", "up vote", "vote for", "votes please"]
            .iter()
            .any(|ask| lower.contains(ask))
        {
            notices.push(Notice::advice(
                "first-comment-votes",
                "The first comment mentions votes. Product Hunt does not allow asking for upvotes; ask for feedback instead.",
            ));
        }
        if !first_comment.contains(request.canonical_url) {
            notices.push(Notice::advice(
                "first-comment-no-post",
                "The first comment does not link the post. Linking it keeps your own site the original that the launch points to.",
            ));
        }
    }
    fields.push(LaunchField {
        id: "first-comment",
        label: "first comment",
        value: first_comment,
        chars: comment_chars,
        limit: None,
    });

    // Images.
    let (thumbnail, gallery) = images(request, &mut notices);

    let demo = match plan
        .demo
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        None => None,
        Some(value) => match youtube_demo(value) {
            Ok(demo) => Some(demo),
            Err(problem) => {
                notices.push(Notice::blocking(
                    "demo-invalid",
                    format!("The demo video {problem}."),
                ));
                None
            }
        },
    };

    let tags: Vec<String> = plan
        .tags
        .iter()
        .map(|t| normalize_title(t))
        .filter(|t| !t.is_empty())
        .collect();
    if tags.len() > TAGS_MAX {
        notices.push(Notice::blocking(
            "too-many-tags",
            format!(
                "The plan has {} launch tags; Product Hunt takes at most {TAGS_MAX}.",
                tags.len()
            ),
        ));
    }
    if tags
        .iter()
        .any(|t| t.chars().count() > TAG_MAX_CHARS || invisible(t))
    {
        notices.push(Notice::blocking(
            "tag-invalid",
            format!("Each launch tag is one line of at most {TAG_MAX_CHARS} characters."),
        ));
    }
    if tags.is_empty() {
        notices.push(Notice::advice(
            "no-tags",
            "There are no launch tags. Choose up to three that fit the product most closely in Product Hunt's form.",
        ));
    }

    let makers: Vec<String> = plan
        .makers
        .iter()
        .map(|m| m.trim().trim_start_matches('@').to_string())
        .filter(|m| !m.is_empty())
        .collect();
    if makers.len() > MAKERS_MAX || !makers.iter().all(|m| valid_maker(m)) {
        notices.push(Notice::blocking(
            "makers-invalid",
            format!(
                "List at most {MAKERS_MAX} co-makers by their Product Hunt username: letters, digits and underscores."
            ),
        ));
    }

    let launch_day = plan
        .launch_day
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty());
    match launch_day {
        None => notices.push(Notice::advice(
            "no-launch-day",
            "There is no launch day. You choose one in Product Hunt's form, up to a month ahead; launches go live at 12:01 a.m. Pacific time.",
        )),
        Some(day) => match day_start(day) {
            None => notices.push(Notice::blocking(
                "launch-day-invalid",
                "The launch day is a plain date, such as 2026-11-12.",
            )),
            Some(start) if start + 86_400 + PACIFIC_LAG_SECONDS <= request.now_unix => {
                notices.push(Notice::blocking(
                    "launch-day-past",
                    "The launch day has passed in Pacific time; choose a new one.",
                ))
            }
            Some(start) if start - request.now_unix > SCHEDULE_HORIZON_DAYS * 86_400 => notices
                .push(Notice::blocking(
                    "launch-day-too-far",
                    format!(
                        "Product Hunt schedules a launch at most a month ahead; choose a day within {SCHEDULE_HORIZON_DAYS} days."
                    ),
                )),
            Some(_) => {}
        },
    }

    let confirmed = request.records.confirmed_for(
        request.source_id,
        request.canonical_url,
        &crate::community_submission::Destination::ProductHunt.key(),
    );
    if let Some(last) = confirmed.last() {
        let day = last.confirmed_at.get(..10).unwrap_or("an earlier day");
        notices.push(if request.again {
            Notice::advice(
                "relaunch",
                format!(
                    "This is a relaunch: you confirmed launching this post's product on Product Hunt on {day}. Product Hunt allows one for each significant new iteration."
                ),
            )
        } else {
            Notice::blocking(
                "already-launched",
                format!(
                    "You confirmed launching this on Product Hunt on {day}. Prepare it again with --again only for a significant new iteration of the product."
                ),
            )
        });
    }

    let mut kit = LaunchKit {
        kit_version: LAUNCH_KIT_VERSION,
        destination: "product-hunt".into(),
        provider: ProviderId::ProductHunt,
        label: manifest.label.clone(),
        slug: request.slug.to_string(),
        post_title: request.post_title.to_string(),
        canonical_url: request.canonical_url.to_string(),
        product_url,
        fields,
        thumbnail,
        gallery,
        demo,
        tags,
        makers,
        launch_day: launch_day.map(str::to_string),
        submit_url: None,
        rules: launch_rules(),
        notices,
        policy_version: manifest.policy_version,
        confirmed,
    };
    if kit.ready() {
        kit.submit_url = Some(SUBMIT_URL.to_string());
    }
    kit
}

fn day_start(value: &str) -> Option<i64> {
    if value.len() != 10 {
        return None;
    }
    crate::date::DateTime::parse(value).map(|d| d.unix())
}

fn images(
    request: &LaunchRequest<'_>,
    notices: &mut Vec<Notice>,
) -> (Option<KitImage>, Vec<KitImage>) {
    let plan = request.plan;
    let thumbnail = match &plan.thumbnail {
        Some(image) if !image.file.trim().is_empty() => {
            Some(kit_image(request, image, "thumbnail", "thumbnail", notices))
        }
        _ => {
            notices.push(Notice::blocking(
                "thumbnail-missing",
                "Name a thumbnail image in the launch plan; Product Hunt requires one.",
            ));
            None
        }
    };
    if let Some(KitImage {
        width: Some(w),
        height: Some(h),
        ..
    }) = &thumbnail
    {
        if w != h {
            notices.push(Notice::advice(
                "thumbnail-not-square",
                format!(
                    "The thumbnail is {w} by {h} pixels; Product Hunt wants a square one, {THUMBNAIL_SIDE} by {THUMBNAIL_SIDE} recommended."
                ),
            ));
        }
    }
    if plan.gallery.len() < GALLERY_MIN {
        notices.push(Notice::blocking(
            "gallery-too-small",
            format!(
                "The gallery has {} image(s); Product Hunt shows it only with at least {GALLERY_MIN}.",
                plan.gallery.len()
            ),
        ));
    }
    if plan.gallery.len() > GALLERY_MAX {
        notices.push(Notice::blocking(
            "gallery-too-large",
            format!("open.blog prepares at most {GALLERY_MAX} gallery images."),
        ));
    }
    let mut gallery = Vec::new();
    let mut off_size = 0;
    for (index, image) in plan.gallery.iter().take(GALLERY_MAX).enumerate() {
        let name = format!("gallery-{:02}", index + 1);
        let kit = kit_image(request, image, &name, "gallery image", notices);
        if let (Some(w), Some(h)) = (kit.width, kit.height) {
            // The recommended 1270 by 760, or the same shape larger or smaller by up to 2%.
            let ratio = f64::from(w) * f64::from(GALLERY_HEIGHT)
                / (f64::from(h) * f64::from(GALLERY_WIDTH));
            if !(0.98..=1.02).contains(&ratio) || w < GALLERY_WIDTH / 2 {
                off_size += 1;
            }
        }
        gallery.push(kit);
    }
    if off_size > 0 {
        notices.push(Notice::advice(
            "gallery-size",
            format!(
                "{off_size} gallery image(s) are not the recommended {GALLERY_WIDTH} by {GALLERY_HEIGHT} pixels or that shape; Product Hunt may crop them."
            ),
        ));
    }
    (thumbnail, gallery)
}

fn kit_image(
    request: &LaunchRequest<'_>,
    image: &LaunchImage,
    name: &str,
    what: &str,
    notices: &mut Vec<Notice>,
) -> KitImage {
    let source = image.file.trim().to_string();
    let alt = normalize_title(&image.alt);
    let mut kit = KitImage {
        source: source.clone(),
        file: None,
        alt: alt.clone(),
        format: None,
        bytes: None,
        width: None,
        height: None,
    };
    if alt.is_empty() || alt.chars().count() > ALT_MAX_CHARS || invisible(&alt) {
        notices.push(Notice::advice(
            "image-alt",
            format!(
                "Describe the {what} `{source}` in one line of at most {ALT_MAX_CHARS} characters under `alt`, so the kit's preview can be read without seeing it."
            ),
        ));
    }
    if !project_relative(&source) {
        notices.push(Notice::blocking(
            "image-outside-project",
            format!("The {what} `{source}` is not a path inside the project."),
        ));
        return kit;
    }
    match request.images.get(&source) {
        None | Some(ImageProbe::Missing) => notices.push(Notice::blocking(
            "image-missing",
            format!("The {what} `{source}` was not found."),
        )),
        Some(ImageProbe::Outside) => notices.push(Notice::blocking(
            "image-outside-project",
            format!("The {what} `{source}` leads outside the project."),
        )),
        Some(ImageProbe::Found {
            bytes,
            format,
            size,
        }) => {
            kit.bytes = Some(*bytes);
            kit.format = *format;
            kit.width = size.map(|s| s.0);
            kit.height = size.map(|s| s.1);
            match format {
                None => notices.push(Notice::blocking(
                    "image-format",
                    format!("The {what} `{source}` is not a PNG, JPEG or GIF image."),
                )),
                Some(format) => {
                    kit.file = Some(format!("images/{name}.{}", format.extension()));
                }
            }
            if *bytes >= IMAGE_MAX_BYTES {
                notices.push(Notice::blocking(
                    "image-too-large",
                    format!("The {what} `{source}` is {bytes} bytes; Product Hunt takes images under 3 MB."),
                ));
            }
        }
    }
    kit
}

/// The kit's data file, as written next to the page.
pub fn kit_json(kit: &LaunchKit) -> String {
    let mut value = kit.to_json_value();
    value["about"] = json!(
        "Prepared by `openblog submit --to product-hunt`; nothing was submitted, scheduled or uploaded. The maker enters the launch in Product Hunt's own form."
    );
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::community_submission::{confirm, Confirmation, Destination};

    const NOW: i64 = 1_793_232_000; // 2026-10-29T00:00:00Z
    const CANONICAL: &str = "https://notes.example.org/posts/hello/";

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(w.to_be_bytes());
        bytes.extend(h.to_be_bytes());
        bytes.extend([8, 6, 0, 0, 0]);
        bytes
    }

    fn found(bytes: &[u8]) -> ImageProbe {
        let (format, size) = sniff_image(bytes);
        ImageProbe::Found {
            bytes: bytes.len() as u64,
            format,
            size,
        }
    }

    fn plan() -> LaunchPlan {
        LaunchPlan::from_json(&format!(
            r#"{{
              "launchVersion": 1,
              "name": "Field Notes",
              "tagline": "A notebook that publishes itself",
              "description": "Write in Markdown, publish a fast static site.",
              "thumbnail": {{"file": "launch/thumb.png", "alt": "The Field Notes logo"}},
              "gallery": [
                {{"file": "launch/one.png", "alt": "The editor"}},
                {{"file": "launch/two.png", "alt": "A published post"}}
              ],
              "demo": "https://youtube.com/watch?v=abcdEFGH123&t=4",
              "tags": ["Writing", "Open Source"],
              "makers": ["@ada_l"],
              "firstComment": "Hi! I wrote about why at {CANONICAL}",
              "launchDay": "2026-11-12"
            }}"#
        ))
        .unwrap()
    }

    fn probes() -> BTreeMap<String, ImageProbe> {
        BTreeMap::from([
            ("launch/thumb.png".to_string(), found(&png(240, 240))),
            ("launch/one.png".to_string(), found(&png(1270, 760))),
            ("launch/two.png".to_string(), found(&png(2540, 1520))),
        ])
    }

    fn kit_for(
        plan: &LaunchPlan,
        images: &BTreeMap<String, ImageProbe>,
        records: &SubmissionRecords,
        again: bool,
    ) -> LaunchKit {
        prepare(&LaunchRequest {
            slug: "hello",
            source_id: "source:content/posts/hello.md",
            post_title: "Hello community",
            canonical_url: CANONICAL,
            plan,
            images,
            now_unix: NOW,
            records,
            again,
        })
    }

    fn codes(kit: &LaunchKit) -> Vec<&'static str> {
        kit.notices.iter().map(|n| n.code).collect()
    }

    #[test]
    fn a_complete_plan_is_ready_with_product_hunts_own_form_and_the_post_linked() {
        let kit = kit_for(&plan(), &probes(), &SubmissionRecords::default(), false);
        assert!(kit.ready(), "{:?}", kit.notices);
        assert!(codes(&kit).is_empty(), "{:?}", codes(&kit));
        assert_eq!(kit.submit_url.as_deref(), Some(SUBMIT_URL));
        assert_eq!(kit.product_url, CANONICAL);
        assert_eq!(kit.canonical_url, CANONICAL);
        assert_eq!(
            kit.demo.as_deref(),
            Some("https://www.youtube.com/watch?v=abcdEFGH123")
        );
        assert_eq!(kit.makers, ["ada_l"]);
        assert_eq!(kit.field("tagline").unwrap().limit, Some(TAGLINE_MAX_CHARS));
        let thumb = kit.thumbnail.as_ref().unwrap();
        assert_eq!(thumb.file.as_deref(), Some("images/thumbnail.png"));
        assert_eq!((thumb.width, thumb.height), (Some(240), Some(240)));
        assert_eq!(
            kit.gallery[1].file.as_deref(),
            Some("images/gallery-02.png")
        );
        assert_eq!(kit.rules.len(), 6);
        assert!(kit.rules.iter().all(|r| r.source.is_some()));
    }

    #[test]
    fn an_empty_plan_says_everything_product_hunt_requires_and_offers_no_form() {
        let kit = kit_for(
            &LaunchPlan::default(),
            &BTreeMap::new(),
            &SubmissionRecords::default(),
            false,
        );
        assert!(!kit.ready());
        assert!(kit.submit_url.is_none());
        let codes = codes(&kit);
        for code in [
            "launch-field-missing",
            "thumbnail-missing",
            "gallery-too-small",
        ] {
            assert!(codes.contains(&code), "{code} in {codes:?}");
        }
        assert_eq!(
            codes
                .iter()
                .filter(|c| **c == "launch-field-missing")
                .count(),
            3
        );
        for code in ["first-comment-missing", "no-tags", "no-launch-day"] {
            assert!(codes.contains(&code), "{code} in {codes:?}");
        }
    }

    #[test]
    fn product_hunts_measurable_limits_block() {
        let mut p = plan();
        p.tagline = "x".repeat(TAGLINE_MAX_CHARS + 1);
        p.description = "y".repeat(DESCRIPTION_MAX_CHARS + 1);
        p.tags = vec!["a".into(), "b".into(), "c".into(), "d".into()];
        p.product_url = Some("https://bit.ly/abc".into());
        p.demo = Some("https://youtu.be/abcdEFGH123".into());
        p.makers = vec!["not a name".into()];
        p.launch_day = Some("2027-01-30".into());
        let mut images = probes();
        images.insert(
            "launch/one.png".into(),
            ImageProbe::Found {
                bytes: IMAGE_MAX_BYTES,
                format: Some(ImageFormat::Png),
                size: Some((1270, 760)),
            },
        );
        images.insert("launch/two.png".into(), found(b"RIFF....WEBPVP8 "));
        let kit = kit_for(&p, &images, &SubmissionRecords::default(), false);
        let codes = codes(&kit);
        for code in [
            "launch-field-too-long",
            "too-many-tags",
            "product-url-invalid",
            "demo-invalid",
            "makers-invalid",
            "launch-day-too-far",
            "image-too-large",
            "image-format",
        ] {
            assert!(codes.contains(&code), "{code} in {codes:?}");
        }
        assert!(kit
            .notices
            .iter()
            .filter(|n| n.code == "launch-field-too-long")
            .all(|n| n.blocking));
        assert!(kit.gallery[1].file.is_none());
        assert!(kit.submit_url.is_none());
    }

    #[test]
    fn judgement_calls_are_advice_only() {
        let mut p = plan();
        p.description = "z".repeat(DESCRIPTION_SHORT_CHARS + 1);
        p.tagline = "Hello community.".into();
        p.first_comment = "Please upvote!".into();
        let mut images = probes();
        images.insert("launch/thumb.png".into(), found(&png(400, 300)));
        images.insert("launch/one.png".into(), found(&png(800, 800)));
        p.thumbnail.as_mut().unwrap().alt = String::new();
        let kit = kit_for(&p, &images, &SubmissionRecords::default(), false);
        assert!(kit.ready(), "{:?}", kit.notices);
        let codes = codes(&kit);
        for code in [
            "description-long",
            "tagline-period",
            "tagline-is-post-title",
            "first-comment-votes",
            "first-comment-no-post",
            "thumbnail-not-square",
            "gallery-size",
            "image-alt",
        ] {
            assert!(codes.contains(&code), "{code} in {codes:?}");
        }
    }

    #[test]
    fn images_must_be_inside_the_project_and_present() {
        let mut p = plan();
        p.thumbnail.as_mut().unwrap().file = "../secret.png".into();
        p.gallery[0].file = "C:/Windows/one.png".into();
        let mut images = probes();
        images.insert("launch/two.png".into(), ImageProbe::Outside);
        images.remove("launch/one.png");
        let kit = kit_for(&p, &images, &SubmissionRecords::default(), false);
        let codes = codes(&kit);
        assert_eq!(
            codes
                .iter()
                .filter(|c| **c == "image-outside-project")
                .count(),
            3,
            "{codes:?}"
        );
        assert!(kit.thumbnail.as_ref().unwrap().file.is_none());
    }

    #[test]
    fn a_past_launch_day_blocks_once_the_pacific_day_is_over() {
        let mut p = plan();
        p.launch_day = Some("2026-10-28".into());
        let kit = kit_for(&p, &probes(), &SubmissionRecords::default(), false);
        assert!(
            !codes(&kit).contains(&"launch-day-past"),
            "still the 28th in Pacific time"
        );
        p.launch_day = Some("2026-10-27".into());
        assert!(codes(&kit_for(
            &p,
            &probes(),
            &SubmissionRecords::default(),
            false
        ))
        .contains(&"launch-day-past"));
        p.launch_day = Some("12 November".into());
        assert!(codes(&kit_for(
            &p,
            &probes(),
            &SubmissionRecords::default(),
            false
        ))
        .contains(&"launch-day-invalid"));
    }

    #[test]
    fn a_confirmed_launch_blocks_until_the_maker_says_it_is_a_relaunch() {
        let mut records = SubmissionRecords::default();
        confirm(
            &mut records,
            &Confirmation {
                source_id: "source:content/posts/hello.md",
                canonical_url: CANONICAL,
                title: "Field Notes",
                destination: &Destination::ProductHunt,
                permalink: Some("https://www.producthunt.com/posts/field-notes/"),
                now: crate::date::DateTime::from_unix(NOW - 86_400),
                again: false,
            },
        )
        .unwrap();
        let entry = &records.records["source:content/posts/hello.md"]["product-hunt"][0];
        assert_eq!(
            entry.permalink.as_deref(),
            Some("https://www.producthunt.com/posts/field-notes")
        );
        let kit = kit_for(&plan(), &probes(), &records, false);
        assert!(codes(&kit).contains(&"already-launched"));
        assert!(kit.submit_url.is_none());
        let kit = kit_for(&plan(), &probes(), &records, true);
        assert!(kit.ready());
        assert!(codes(&kit).contains(&"relaunch"));
        assert_eq!(kit.confirmed.len(), 1);
    }

    #[test]
    fn a_plan_with_an_unknown_field_or_version_is_refused_whole() {
        assert!(matches!(
            LaunchPlan::from_json(r#"{"name":"x","votes":1}"#),
            Err(PlanError::Malformed(_))
        ));
        assert_eq!(
            LaunchPlan::from_json(r#"{"launchVersion":2}"#),
            Err(PlanError::Version)
        );
        assert_eq!(
            LaunchPlan::from_json(&" ".repeat(MAX_PLAN_BYTES + 1)),
            Err(PlanError::TooLarge)
        );
        assert_eq!(
            plan().image_files(),
            ["launch/thumb.png", "launch/one.png", "launch/two.png"]
        );
    }

    #[test]
    fn images_are_recognised_by_their_bytes() {
        assert_eq!(
            sniff_image(&png(3, 2)),
            (Some(ImageFormat::Png), Some((3, 2)))
        );
        assert_eq!(
            sniff_image(b"GIF89a\x10\x00\x20\x00"),
            (Some(ImageFormat::Gif), Some((16, 32)))
        );
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x02,
            0xF8, 0x04, 0xF6, 0x03,
        ];
        assert_eq!(
            sniff_image(&jpeg),
            (Some(ImageFormat::Jpeg), Some((1270, 760)))
        );
        assert_eq!(sniff_image(b"<svg/>"), (None, None));
        assert_eq!(
            sniff_image(&[0xFF, 0xD8, 0xFF]),
            (Some(ImageFormat::Jpeg), None)
        );
    }

    #[test]
    fn addresses_are_checked_for_shape_only() {
        assert_eq!(product_url_problem("https://fieldnotes.example/"), None);
        assert!(product_url_problem("https://fieldnotes.example/?utm_source=ph").is_some());
        assert!(product_url_problem("http://fieldnotes.example/").is_some());
        assert!(youtube_demo("https://www.youtube.com/embed/abc").is_err());
        assert!(youtube_demo("https://vimeo.com/1").is_err());
        assert!(valid_maker("ada_l") && !valid_maker("ada-l"));
        assert!(project_relative("launch/a.png"));
        for bad in [
            "",
            "/a.png",
            "\\a.png",
            "a/../b.png",
            "C:a.png",
            "..\\a.png",
        ] {
            assert!(!project_relative(bad), "{bad}");
        }
    }
}

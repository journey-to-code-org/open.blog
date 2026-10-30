//! Recipe directory submission packages (epic #385, story #398, ADRs 0822 and 0823).
//!
//! No recipe directory offers an API that open.blog may call on the author's behalf, so a
//! "submission" is always the author's own act, by hand, in the directory. This module says, per
//! directory, what that act needs and whether the recipe is ready for it, and builds the files a
//! package holds: the schema.org `Recipe` the page carries, the ingredients, steps, description,
//! canonical link and credit as plain text to paste, and a static guide page.
//!
//! The directories are a closed list with dated facts. Each condition says whether it was read in
//! the directory's own documentation or only reported elsewhere, so a guess never passes for a
//! rule. A directory that has closed, or whose terms could not be verified, is a named
//! unavailable state rather than an unknown name.
//!
//! Capabilities use the provider contract's vocabulary (`provider_manifest::Capability` and
//! `Support`, ADR 0325): for a directory nothing is ever `adapter`.
//!
//! Pure: no environment, no network, no file system. The caller reads the cover image.

use serde::Serialize;
use serde_json::{json, Value as Json};

use crate::config::SiteConfig;
use crate::escape;
use crate::model::Post;
use crate::provider_manifest::{Capability, Support};
use crate::recipe::Recipe;
use crate::recipe_check::{self, Severity};
use crate::recipe_schema::{self, web_address};

/// The day the directory facts below were checked.
pub const POLICY_VERSION: &str = "2026-10-29";

/// The package format (`package.json`'s `version`).
pub const PACKAGE_VERSION: u32 = 1;

/// Google's recommended least image size for a recipe result, in pixels (width times height).
pub const GOOGLE_MIN_IMAGE_PIXELS: u64 = 50_000;

/// A directory open.blog prepares a package for. The list is closed: a new directory is a code
/// change, with its facts and sources.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Directory {
    /// Google Search recipe results: read from the page's structured data, never submitted.
    GoogleSearch,
    /// Pinterest recipe Pins: read from the page's structured data when the author saves a Pin.
    Pinterest,
    /// Foodgawker: a curated photo gallery the author submits to by hand, with an account.
    Foodgawker,
}

/// How a directory receives a recipe. In every case the author acts, by hand.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Intake {
    /// The directory reads the published page; the author only asks it to look.
    ReadsThePage,
    /// The author fills the directory's own form, signed in to their account.
    FormByHand,
}

/// Where a condition was read.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Verification {
    /// In the directory's own documentation, on [`POLICY_VERSION`].
    Official,
    /// Only reported elsewhere, or the directory's page could not be read: check it by hand.
    Unverified,
}

/// One thing a directory asks of a submission. Fixed text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub code: &'static str,
    pub text: &'static str,
    pub verification: Verification,
    pub source: &'static str,
}

const GOOGLE_RECIPE_DOCS: &str =
    "https://developers.google.com/search/docs/appearance/structured-data/recipe";
const PINTEREST_RICH_PINS: &str = "https://help.pinterest.com/en/business/article/rich-pins";
const FOODGAWKER_TERMS: &str = "https://foodgawker.com/terms";
const FOODGAWKER_ABOUT: &str = "https://foodgawker.com/about";
const FOODGAWKER_ACCEPTED: &str = "https://foodgawker.com/blog/how-to-get-your-recipes-accepted";

impl Directory {
    pub const ALL: [Directory; 3] = [Self::GoogleSearch, Self::Pinterest, Self::Foodgawker];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::GoogleSearch => "google-search",
            Self::Pinterest => "pinterest",
            Self::Foodgawker => "foodgawker",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::GoogleSearch => "Google Search recipe results",
            Self::Pinterest => "Pinterest",
            Self::Foodgawker => "Foodgawker",
        }
    }

    pub fn intake(self) -> Intake {
        match self {
            Self::GoogleSearch | Self::Pinterest => Intake::ReadsThePage,
            Self::Foodgawker => Intake::FormByHand,
        }
    }

    /// What the directory can take, in the provider contract's vocabulary. Nothing is `adapter`:
    /// open.blog sends nothing to a directory.
    pub fn capabilities(self) -> [(Capability, Support); 7] {
        use Capability::*;
        use Support::*;
        let (text, image) = match self {
            // Google reads the page's own data; there is nothing to write or upload.
            Self::GoogleSearch => (Unsupported, Unsupported),
            Self::Pinterest | Self::Foodgawker => (Manual, Manual),
        };
        [
            (Link, Manual),
            (Text, text),
            (Article, Unsupported),
            (Image, image),
            (Video, Unsupported),
            (Draft, Unsupported),
            (Schedule, Unsupported),
        ]
    }

    /// The documentation the facts were checked against.
    pub fn sources(self) -> &'static [&'static str] {
        match self {
            Self::GoogleSearch => &[
                GOOGLE_RECIPE_DOCS,
                "https://search.google.com/test/rich-results",
            ],
            Self::Pinterest => &[PINTEREST_RICH_PINS],
            Self::Foodgawker => &[FOODGAWKER_TERMS, FOODGAWKER_ABOUT, FOODGAWKER_ACCEPTED],
        }
    }

    /// What a submission needs, as the directory states it.
    pub fn conditions(self) -> &'static [Condition] {
        use Verification::*;
        match self {
            Self::GoogleSearch => &[
                Condition {
                    code: "name-and-image-required",
                    text: "A recipe result needs the recipe's name and an image of the finished dish.",
                    verification: Official,
                    source: GOOGLE_RECIPE_DOCS,
                },
                Condition {
                    code: "image-size-recommended",
                    text: "Google recommends several high-resolution images of at least 50,000 pixels (width times height), in 16x9, 4x3 and 1x1.",
                    verification: Official,
                    source: GOOGLE_RECIPE_DOCS,
                },
                Condition {
                    code: "page-crawlable",
                    text: "The page must be reachable by Google: not blocked by robots.txt, a noindex tag or a login.",
                    verification: Official,
                    source: GOOGLE_RECIPE_DOCS,
                },
                Condition {
                    code: "no-submission",
                    text: "There is no submission form: Google reads the page. You can test it with the Rich Results Test and ask for a recrawl with URL Inspection in Search Console.",
                    verification: Official,
                    source: GOOGLE_RECIPE_DOCS,
                },
            ],
            Self::Pinterest => &[
                Condition {
                    code: "rich-pin-from-page",
                    text: "A recipe Pin shows the recipe details read from the page's schema.org Recipe data; there is no application or submission step, and syncing can take up to 24 hours.",
                    verification: Official,
                    source: PINTEREST_RICH_PINS,
                },
                Condition {
                    code: "pin-needs-image",
                    text: "You save the Pin yourself, from the page address and an image of the recipe.",
                    verification: Official,
                    source: PINTEREST_RICH_PINS,
                },
                Condition {
                    code: "manual-edits-overwrite",
                    text: "Editing the Pin's details by hand on Pinterest overwrites what it read from your page.",
                    verification: Official,
                    source: PINTEREST_RICH_PINS,
                },
            ],
            Self::Foodgawker => &[
                Condition {
                    code: "own-the-photo",
                    text: "You must own the photo's copyright or have permission to submit it, and accepted photos may be shown on Foodgawker's sites with credit to you.",
                    verification: Unverified,
                    source: FOODGAWKER_TERMS,
                },
                Condition {
                    code: "editors-review",
                    text: "Editors review every submission and choose which photos to show; a submission can be declined.",
                    verification: Unverified,
                    source: FOODGAWKER_ABOUT,
                },
                Condition {
                    code: "no-ai-images",
                    text: "Submissions with AI-generated images are declined, and repeat submissions can lead to a ban.",
                    verification: Unverified,
                    source: FOODGAWKER_ACCEPTED,
                },
                Condition {
                    code: "square-photo-reported",
                    text: "Food bloggers report that the submission form crops the photo to a square; check the form's current crop.",
                    verification: Unverified,
                    source: FOODGAWKER_ACCEPTED,
                },
                Condition {
                    code: "account-required",
                    text: "You submit from your own Foodgawker account, with the photo, a title, a short description and the link to your post.",
                    verification: Unverified,
                    source: FOODGAWKER_ABOUT,
                },
            ],
        }
    }

    /// The steps to take by hand, in order. Only the canonical address is filled in.
    pub fn steps(self, canonical_url: &str) -> Vec<String> {
        match self {
            Self::GoogleSearch => vec![
                format!(
                    "Open the Rich Results Test (https://search.google.com/test/rich-results) and test {canonical_url}."
                ),
                "Fix anything it reports as critical; recommended fields are optional.".into(),
                format!(
                    "In Search Console, use URL Inspection on {canonical_url} and request indexing if the page is not indexed yet."
                ),
            ],
            Self::Pinterest => vec![
                format!("Save a Pin from {canonical_url}, choosing the recipe image."),
                "Use title.txt and description.txt if you write the Pin's text; leave the recipe details to the page.".into(),
                "Check the Pin shows the ingredients after up to a day; do not retype them on Pinterest.".into(),
            ],
            Self::Foodgawker => vec![
                "Sign in to your Foodgawker account and open its submission form.".into(),
                "Upload the photo from this package (only if it is your own, and not AI-generated) and check the crop.".into(),
                format!("Paste title.txt, description.txt and the link {canonical_url}."),
                "Submit, and wait for the editors' decision; nothing is posted until they accept it.".into(),
            ],
        }
    }

    pub fn parse(value: &str) -> Lookup {
        if let Some(directory) = Self::ALL.into_iter().find(|d| d.as_str() == value) {
            return Lookup::Supported(directory);
        }
        UNAVAILABLE
            .iter()
            .find(|u| u.name == value)
            .map_or(Lookup::Unknown, |u| Lookup::Unavailable(*u))
    }
}

/// A directory open.blog knows of and deliberately prepares nothing for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unavailable {
    pub name: &'static str,
    pub label: &'static str,
    pub code: &'static str,
    pub reason: &'static str,
    pub source: &'static str,
}

/// Directories that are a named state, not an unknown name.
pub const UNAVAILABLE: &[Unavailable] = &[
    Unavailable {
        name: "yummly",
        label: "Yummly",
        code: "directory-closed",
        reason: "Yummly closed its website and app in December 2024, so there is nothing to submit to.",
        source: "https://en.wikipedia.org/wiki/Yummly",
    },
    Unavailable {
        name: "allrecipes",
        label: "Allrecipes",
        code: "terms-not-verified",
        reason: "Allrecipes' recipe submission terms could not be read and verified, so open.blog does not prepare a package for it; read its terms before submitting by hand.",
        source: "https://www.allrecipes.com/",
    },
];

/// What a `--directory` name means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lookup {
    Supported(Directory),
    Unavailable(Unavailable),
    Unknown,
}

/// What the caller found for the post's cover image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cover {
    /// The post has no cover.
    None,
    /// A file in the site's static folder, copied into the package as `file`.
    Local {
        file: String,
        /// Width and height, when the format's header could be read.
        size: Option<(u32, u32)>,
    },
    /// Not a file in the static folder (an absolute address, or a path the build makes): the
    /// package links it and the author downloads it.
    Linked { url: String },
}

/// Every finding a directory check reports. The list is closed; each has fixed text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FindingCode {
    /// The recipe check (ADR 0821) found an error.
    RecipeHasErrors,
    /// The post names another page as its canonical copy.
    CanonicalElsewhere,
    /// The directory needs an image and the post has no cover.
    NoImage,
    /// The cover is not a file in the static folder, so the package links it.
    ImageLinkedNotIncluded,
    /// The cover's size could not be read from its file.
    ImageSizeUnknown,
    /// The cover is smaller than Google's recommended 50,000 pixels.
    ImageBelowRecommendedSize,
    /// The cover is not square, and the directory's form is reported to crop to a square.
    ImageNotSquare,
    /// The post has no description to paste.
    NoDescription,
    /// Some of the directory's conditions could not be verified in its own documentation.
    ConditionsUnverified,
}

impl FindingCode {
    pub fn severity(self) -> Severity {
        match self {
            Self::RecipeHasErrors | Self::CanonicalElsewhere | Self::NoImage => Severity::Error,
            _ => Severity::Warning,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::RecipeHasErrors => "recipe-has-errors",
            Self::CanonicalElsewhere => "canonical-elsewhere",
            Self::NoImage => "no-image",
            Self::ImageLinkedNotIncluded => "image-linked-not-included",
            Self::ImageSizeUnknown => "image-size-unknown",
            Self::ImageBelowRecommendedSize => "image-below-recommended-size",
            Self::ImageNotSquare => "image-not-square",
            Self::NoDescription => "no-description",
            Self::ConditionsUnverified => "conditions-unverified",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::RecipeHasErrors => "the recipe check found an error; fix it before preparing a package",
            Self::CanonicalElsewhere => "the post names another page as its canonical copy; submit that page instead",
            Self::NoImage => "this directory needs a photo of the dish, and the post has no `cover`",
            Self::ImageLinkedNotIncluded => "the cover is not a file in the static folder, so the package links it instead of including it; download it yourself",
            Self::ImageSizeUnknown => "the cover's size could not be read from its file; check it by hand",
            Self::ImageBelowRecommendedSize => "the cover is smaller than the 50,000 pixels Google recommends",
            Self::ImageNotSquare => "the cover is not square; check how the submission form crops it",
            Self::NoDescription => "the post has no `description` to paste",
            Self::ConditionsUnverified => "some of this directory's conditions could not be verified in its own documentation; read them there before submitting",
        }
    }
}

/// One finding for one directory.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub code: FindingCode,
    pub severity: Severity,
    pub message: &'static str,
}

impl Finding {
    fn new(code: FindingCode) -> Self {
        Self {
            code,
            severity: code.severity(),
            message: code.message(),
        }
    }

    /// One line for a terminal: `error [no-image] Pinterest: ...`.
    pub fn line(&self, label: &str) -> String {
        let severity = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        format!(
            "{severity} [{}] {label}: {}",
            self.code.as_str(),
            self.message
        )
    }
}

/// Whether a directory's package can be prepared.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// Ready for the author's own steps.
    Ready,
    /// An error must be fixed first; nothing is written.
    Blocked,
}

/// What the directory checks read.
#[derive(Clone, Debug)]
pub struct CheckInput<'a> {
    pub recipe_problems: &'a [recipe_check::Problem],
    pub cover: &'a Cover,
    pub description: &'a str,
    /// The post's own `canonical` override, when it names another page.
    pub canonical_elsewhere: bool,
}

/// Every finding for `directory`, in a fixed order. Empty means ready with nothing to note.
pub fn check(directory: Directory, input: &CheckInput) -> Vec<Finding> {
    let mut findings = Vec::new();
    if recipe_check::has_errors(input.recipe_problems) {
        findings.push(Finding::new(FindingCode::RecipeHasErrors));
    }
    if input.canonical_elsewhere {
        findings.push(Finding::new(FindingCode::CanonicalElsewhere));
    }
    // Every directory here shows the dish's photo.
    match input.cover {
        Cover::None => findings.push(Finding::new(FindingCode::NoImage)),
        Cover::Linked { .. } => {
            if directory
                .capabilities()
                .contains(&(Capability::Image, Support::Manual))
            {
                findings.push(Finding::new(FindingCode::ImageLinkedNotIncluded));
            }
        }
        Cover::Local { size: None, .. } => {
            findings.push(Finding::new(FindingCode::ImageSizeUnknown))
        }
        Cover::Local {
            size: Some((width, height)),
            ..
        } => {
            if directory == Directory::GoogleSearch
                && u64::from(*width) * u64::from(*height) < GOOGLE_MIN_IMAGE_PIXELS
            {
                findings.push(Finding::new(FindingCode::ImageBelowRecommendedSize));
            }
            if directory == Directory::Foodgawker && width != height {
                findings.push(Finding::new(FindingCode::ImageNotSquare));
            }
        }
    }
    if directory.intake() == Intake::FormByHand && input.description.trim().is_empty() {
        findings.push(Finding::new(FindingCode::NoDescription));
    }
    if directory
        .conditions()
        .iter()
        .any(|c| c.verification == Verification::Unverified)
    {
        findings.push(Finding::new(FindingCode::ConditionsUnverified));
    }
    findings
}

/// One chosen directory's part of a package.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPlan {
    pub directory: Directory,
    pub label: &'static str,
    pub intake: Intake,
    pub status: Status,
    pub policy_version: &'static str,
    pub capabilities: std::collections::BTreeMap<Capability, Support>,
    pub findings: Vec<Finding>,
    pub conditions: &'static [Condition],
    pub steps: Vec<String>,
    pub sources: &'static [&'static str],
}

/// The plan for one directory.
pub fn plan(directory: Directory, input: &CheckInput, canonical_url: &str) -> DirectoryPlan {
    let findings = check(directory, input);
    let status = if findings.iter().any(|f| f.severity == Severity::Error) {
        Status::Blocked
    } else {
        Status::Ready
    };
    DirectoryPlan {
        directory,
        label: directory.label(),
        intake: directory.intake(),
        status,
        policy_version: POLICY_VERSION,
        capabilities: directory.capabilities().into_iter().collect(),
        findings,
        conditions: directory.conditions(),
        steps: directory.steps(canonical_url),
        sources: directory.sources(),
    }
}

/// One file of a package: its name and its exact bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackageFile {
    pub name: String,
    pub purpose: &'static str,
    pub contents: Vec<u8>,
}

/// The text files of a package, built from the published post only. The image, `package.json`
/// and `index.html` are added by [`package_manifest`] and [`guide_page`].
pub fn text_files(config: &SiteConfig, post: &Post, recipe: &Recipe) -> Vec<PackageFile> {
    let canonical = config.absolute(&post.url);
    let mut recipe_json =
        serde_json::to_string_pretty(&recipe_schema::recipe_document(config, post, recipe))
            .unwrap_or_default();
    recipe_json.push('\n');
    let lines = |items: &[String]| {
        let mut out = String::new();
        for item in items {
            out.push_str(item.trim());
            out.push('\n');
        }
        out
    };
    let steps: Vec<String> = recipe
        .steps
        .iter()
        .enumerate()
        .map(|(i, step)| format!("{}. {}", i + 1, step.trim()))
        .collect();
    let file = |name: &str, purpose, text: String| PackageFile {
        name: name.to_string(),
        purpose,
        contents: text.into_bytes(),
    };
    vec![
        file(
            "recipe.json",
            "The schema.org Recipe your page carries, for importers that take a file",
            recipe_json,
        ),
        file(
            "title.txt",
            "The recipe's title",
            format!("{}\n", post.title.trim()),
        ),
        file(
            "description.txt",
            "The post's description",
            format!("{}\n", post.description.trim()),
        ),
        file(
            "ingredients.txt",
            "One ingredient per line, as written",
            lines(&recipe.ingredients),
        ),
        file("steps.txt", "The steps in order, numbered", lines(&steps)),
        file(
            "link.txt",
            "The canonical address of your post",
            format!("{canonical}\n"),
        ),
        file(
            "credit.txt",
            "Who made the recipe and where it lives",
            credit(config, post, recipe),
        ),
    ]
}

/// The attribution every package carries: the author, the canonical post, and the recipe it was
/// adapted from when that is a web address.
pub fn credit(config: &SiteConfig, post: &Post, recipe: &Recipe) -> String {
    let canonical = config.absolute(&post.url);
    let mut out = String::new();
    let author = config.author.name.trim();
    if author.is_empty() {
        out.push_str(&format!(
            "\"{}\", first published at {canonical}\n",
            post.title.trim()
        ));
    } else {
        out.push_str(&format!(
            "\"{}\" by {author}, first published at {canonical}\n",
            post.title.trim()
        ));
    }
    if let Some(source) = recipe.adapted_from.as_deref().and_then(web_address) {
        out.push_str(&format!("Adapted from {source}\n"));
    }
    out
}

/// A package: what is in it and what each chosen directory needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Package {
    pub title: String,
    pub source_path: String,
    pub canonical_url: String,
    pub recipe_problems: Vec<recipe_check::Problem>,
    pub directories: Vec<DirectoryPlan>,
    pub files: Vec<PackageFile>,
    /// The cover's address when it is linked rather than included.
    pub linked_image: Option<String>,
}

impl Package {
    /// True when nothing must be fixed first: no recipe error and no blocked directory.
    pub fn ready(&self) -> bool {
        !recipe_check::has_errors(&self.recipe_problems)
            && self.directories.iter().all(|d| d.status == Status::Ready)
    }
}

/// `package.json`: the versioned plan, with every file's name, purpose and size.
pub fn package_manifest(package: &Package) -> Json {
    json!({
        "version": PACKAGE_VERSION,
        "title": package.title,
        "sourcePath": package.source_path,
        "canonicalUrl": package.canonical_url,
        "offline": true,
        "sent": false,
        "ready": package.ready(),
        "recipeProblems": package.recipe_problems,
        "directories": package.directories,
        "noDirectory": package.directories.is_empty(),
        "linkedImage": package.linked_image,
        "files": package.files.iter().map(|f| json!({
            "name": f.name,
            "purpose": f.purpose,
            "bytes": f.contents.len(),
        })).collect::<Vec<_>>(),
    })
}

/// Width and height from a PNG, GIF, JPEG or WebP header; `None` for anything else.
pub fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let be16 = |b: &[u8], i: usize| -> Option<u32> {
        Some(u32::from(u16::from_be_bytes([*b.get(i)?, *b.get(i + 1)?])))
    };
    let le16 = |b: &[u8], i: usize| -> Option<u32> {
        Some(u32::from(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?])))
    };
    let be32 = |b: &[u8], i: usize| -> Option<u32> {
        Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?))
    };
    let le24 = |b: &[u8], i: usize| -> Option<u32> {
        Some(
            u32::from(*b.get(i)?)
                | (u32::from(*b.get(i + 1)?) << 8)
                | (u32::from(*b.get(i + 2)?) << 16),
        )
    };
    let size = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16) == Some(b"IHDR") {
        (be32(bytes, 16)?, be32(bytes, 20)?)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        (le16(bytes, 6)?, le16(bytes, 8)?)
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        match bytes.get(12..16)? {
            b"VP8 " => (le16(bytes, 26)? & 0x3fff, le16(bytes, 28)? & 0x3fff),
            b"VP8L" => {
                let bits = u32::from_le_bytes(bytes.get(21..25)?.try_into().ok()?);
                ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
            }
            b"VP8X" => (le24(bytes, 24)? + 1, le24(bytes, 27)? + 1),
            _ => return None,
        }
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        let mut i = 2;
        loop {
            while *bytes.get(i)? != 0xff {
                i += 1;
            }
            while *bytes.get(i)? == 0xff {
                i += 1;
            }
            let marker = *bytes.get(i)?;
            i += 1;
            if matches!(marker, 0xd8 | 0x01 | 0xd0..=0xd7) {
                continue;
            }
            if marker == 0xd9 || marker == 0xda {
                return None;
            }
            let length = be16(bytes, i)? as usize;
            let frame = matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc);
            if frame {
                break (be16(bytes, i + 5)?, be16(bytes, i + 3)?);
            }
            i += length;
        }
    } else {
        return None;
    };
    (size.0 > 0 && size.1 > 0).then_some(size)
}

/// The static guide page: no script, no external resource, no form (as ADR 0330's preview page).
/// Everything from the post is escaped text.
pub fn guide_page(package: &Package) -> String {
    let t = escape::text;
    let mut out = String::new();
    out.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    out.push_str(&format!(
        "<title>Recipe submission package: {}</title>\n",
        t(&package.title)
    ));
    out.push_str(crate::distribution::PAGE_STYLE);
    out.push_str(
        "<style>li{overflow-wrap:anywhere}</style>
</head>\n<body>\n<main>\n",
    );
    out.push_str(&format!(
        "<h1>Recipe submission package: {}</h1>\n",
        t(&package.title)
    ));
    out.push_str("<p class=\"notice\"><strong>Prepared, not sent.</strong> open.blog sent nothing to any directory and read no credential. Each submission below is yours to make, by hand, if you choose to.</p>\n");
    out.push_str(&format!(
        "<dl>\n<dt>Canonical address</dt><dd><a href=\"{}\">{}</a></dd>\n<dt>Source</dt><dd>{}</dd>\n</dl>\n",
        escape::attr(&package.canonical_url),
        t(&package.canonical_url),
        t(&package.source_path)
    ));
    out.push_str("<section aria-labelledby=\"files-title\">\n<h2 id=\"files-title\">Files in this package</h2>\n<ul>\n");
    for file in &package.files {
        out.push_str(&format!(
            "<li><a href=\"{}\">{}</a>: {}</li>\n",
            escape::attr(&file.name),
            t(&file.name),
            t(file.purpose)
        ));
    }
    if let Some(url) = &package.linked_image {
        out.push_str(&format!(
            "<li>The cover image is not included; it is at <a href=\"{}\">{}</a>.</li>\n",
            escape::attr(url),
            t(url)
        ));
    }
    out.push_str("</ul>\n</section>\n");
    if !package.recipe_problems.is_empty() {
        out.push_str("<section aria-labelledby=\"recipe-title\">\n<h2 id=\"recipe-title\">Recipe check</h2>\n<ul>\n");
        for problem in &package.recipe_problems {
            out.push_str(&format!("<li>{}</li>\n", t(&problem.line())));
        }
        out.push_str("</ul>\n</section>\n");
    }
    if package.directories.is_empty() {
        out.push_str("<section aria-labelledby=\"none-title\">\n<h2 id=\"none-title\">No directory chosen</h2>\n<p>Your recipe stays on your own site. Recipe apps can import it from its address or from <a href=\"recipe.json\">recipe.json</a>. To prepare for a directory, run the export again with <code>--directory</code>.</p>\n</section>\n");
    }
    for (index, d) in package.directories.iter().enumerate() {
        let id = format!("directory-{}", index + 1);
        out.push_str(&format!(
            "<section aria-labelledby=\"{id}\">\n<h2 id=\"{id}\">{}</h2>\n",
            t(d.label)
        ));
        out.push_str(&format!(
            "<p><strong>Status:</strong> {}. <strong>How it receives a recipe:</strong> {}. Facts checked on {}.</p>\n",
            match d.status {
                Status::Ready => "ready for your own steps",
                Status::Blocked => "blocked until the errors below are fixed",
            },
            match d.intake {
                Intake::ReadsThePage => "it reads your published page; there is nothing to upload",
                Intake::FormByHand => "you fill its form yourself, signed in to your account",
            },
            t(d.policy_version)
        ));
        if !d.findings.is_empty() {
            out.push_str(&format!(
                "<h3 id=\"{id}-findings\">Findings</h3>\n<ul aria-labelledby=\"{id}-findings\">\n"
            ));
            for f in &d.findings {
                out.push_str(&format!(
                    "<li>{}: {} <span class=\"code\">({})</span></li>\n",
                    match f.severity {
                        Severity::Error => "Error",
                        Severity::Warning => "Warning",
                    },
                    t(f.message),
                    t(f.code.as_str())
                ));
            }
            out.push_str("</ul>\n");
        }
        out.push_str(&format!(
            "<h3 id=\"{id}-conditions\">What {} asks</h3>\n<ul aria-labelledby=\"{id}-conditions\">\n",
            t(d.label)
        ));
        for c in d.conditions {
            out.push_str(&format!(
                "<li>{} <a href=\"{}\">{}</a></li>\n",
                t(c.text),
                escape::attr(c.source),
                match c.verification {
                    Verification::Official => "(from its documentation)",
                    Verification::Unverified => "(not verified: check it there)",
                }
            ));
        }
        out.push_str("</ul>\n");
        out.push_str(&format!(
            "<h3 id=\"{id}-steps\">Your steps</h3>\n<ol aria-labelledby=\"{id}-steps\">\n"
        ));
        for step in &d.steps {
            out.push_str(&format!("<li>{}</li>\n", t(step)));
        }
        out.push_str("</ol>\n</section>\n");
    }
    for file in package.files.iter().filter(|f| f.name.ends_with(".txt")) {
        let text = String::from_utf8_lossy(&file.contents);
        out.push_str(&format!(
            "<h2 id=\"{0}\">{1}</h2>\n<pre tabindex=\"0\" aria-labelledby=\"{0}\">{2}</pre>\n",
            escape::attr(&file.name.replace('.', "-")),
            t(&file.name),
            t(&text)
        ));
    }
    out.push_str("</main>\n</body>\n</html>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_headers_give_their_size() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&1200u32.to_be_bytes());
        png.extend_from_slice(&800u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((1200, 800)));
        let gif = b"GIF89a\x40\x01\xf0\x00".to_vec();
        assert_eq!(image_size(&gif), Some((320, 240)));
        // A minimal JPEG: SOI, an APP0 segment, then SOF0 with height 300 and width 400.
        let jpeg = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01,
            0x2c, 0x01, 0x90,
        ];
        assert_eq!(image_size(&jpeg), Some((400, 300)));
        let mut webp = b"RIFF\0\0\0\0WEBPVP8X\0\0\0\0\0\0\0\0".to_vec();
        webp.extend_from_slice(&[0x1f, 0x03, 0x00, 0x57, 0x02, 0x00]);
        assert_eq!(image_size(&webp), Some((800, 600)));
        assert_eq!(image_size(b"<svg/>"), None);
        assert_eq!(image_size(&[0xff, 0xd8, 0xff]), None);
        assert_eq!(image_size(b""), None);
    }

    #[test]
    fn names_are_supported_unavailable_or_unknown() {
        for d in Directory::ALL {
            assert_eq!(Directory::parse(d.as_str()), Lookup::Supported(d));
        }
        assert!(matches!(
            Directory::parse("yummly"),
            Lookup::Unavailable(u) if u.code == "directory-closed"
        ));
        assert!(matches!(
            Directory::parse("allrecipes"),
            Lookup::Unavailable(u) if u.code == "terms-not-verified"
        ));
        assert_eq!(Directory::parse("Pinterest"), Lookup::Unknown);
        assert_eq!(Directory::parse(""), Lookup::Unknown);
    }

    #[test]
    fn no_directory_is_ever_reached_through_an_adapter() {
        for d in Directory::ALL {
            assert!(d
                .capabilities()
                .iter()
                .all(|(_, support)| *support != Support::Adapter));
            assert!(!d.conditions().is_empty());
            assert!(d.sources().iter().all(|s| s.starts_with("https://")));
            assert!(d
                .conditions()
                .iter()
                .all(|c| c.source.starts_with("https://")));
        }
    }
}

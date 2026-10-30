//! A video release: the authored metadata and accessibility assets of a video post, prepared for
//! a video destination (epic #386, ADR 0840).
//!
//! A video post (`profile: video`) already carries its YouTube address, duration, thumbnail and
//! AI-assistance note ([`crate::video`]). A release adds what an upload needs and what keeps the
//! video accessible and honest: the master file (or the existing YouTube video), a title and
//! description written for the destination, the chapters and transcript written in the Markdown
//! body, caption files, and the author's own declarations of rights, consent, audience and
//! synthetic content.
//!
//! Everything here is read from the post, never inferred: video is deliberate authored media, and
//! an article is never turned into one. Pure: no file system, no network, no credential. Nothing in
//! a build, feed or export reads a release.

use blake2::{Blake2b512, Digest};
use serde::Serialize;

use crate::distribution::{field, hex, Problem, Status, PAGE_STYLE};
use crate::escape;
use crate::provider_manifest::{builtin_manifest, Capability, DistributionRequest, ProviderId};

use crate::model::Post;

/// The fewest chapters YouTube shows as chapters, the shortest chapter it accepts, and that the
/// first must start at `00:00` (<https://support.google.com/youtube/answer/9884579>).
pub const CHAPTER_MIN_COUNT: usize = 3;
pub const CHAPTER_MIN_SECONDS: u32 = 10;

/// Who holds the rights to everything in the video.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rights {
    /// The author made or owns all of it.
    Owned,
    /// Some of it is used under a licence the author holds.
    Licensed,
}

/// Whether identifiable people appear, and if so that they agreed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum People {
    /// Everyone identifiable in the video agreed to appear in it.
    Consented,
    /// No identifiable person appears.
    None,
}

/// One authored declaration: absent, present but not one of the closed values, or a value. An
/// unknown value is kept as `Invalid` so it is reported, never read as either answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", content = "value", rename_all = "kebab-case")]
pub enum Declared<T> {
    Missing,
    Invalid,
    Value(T),
}

impl<T: Copy> Declared<T> {
    fn read(raw: Option<&str>, parse: impl Fn(&str) -> Option<T>) -> Self {
        match raw.map(str::trim).filter(|value| !value.is_empty()) {
            None => Self::Missing,
            Some(value) => parse(&value.to_ascii_lowercase()).map_or(Self::Invalid, Self::Value),
        }
    }

    pub fn value(self) -> Option<T> {
        match self {
            Self::Value(value) => Some(value),
            _ => None,
        }
    }
}

fn yes_no(value: &str) -> Option<bool> {
    match value {
        "yes" | "true" => Some(true),
        "no" | "false" => Some(false),
        _ => None,
    }
}

/// The author's declarations. YouTube asks every uploader for the audience and for realistic
/// altered or synthetic content; rights and consent are open.blog's own, because only the author
/// knows them and a public video cannot be taken back.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consent {
    pub rights: Declared<Rights>,
    pub people: Declared<People>,
    pub made_for_kids: Declared<bool>,
    pub synthetic_media: Declared<bool>,
}

/// Where the video is: a master file in the project to upload, a video already on YouTube, or
/// both (the file is then the master of the video already there).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoReference {
    /// `videoFile`, project-relative, as authored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// `videoUrl`, as authored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// The YouTube video id, when `videoUrl` is a supported YouTube address.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youtube_id: Option<String>,
}

/// One chapter line of the body: `00:00 Title`, optionally as a list item.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Chapter {
    pub timestamp: String,
    pub seconds: u32,
    pub label: String,
}

/// A caption file's format, from its extension. WebVTT and SubRip are the two YouTube accepts
/// (<https://support.google.com/youtube/answer/2734698>) that a person can also read and edit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionFormat {
    Webvtt,
    Subrip,
}

/// One caption file. The language is the name's last segment before the extension
/// (`episode-1.pt-BR.vtt`), so the file says what it is wherever it is copied.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrack {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CaptionFormat>,
}

impl CaptionTrack {
    fn from_path(path: &str) -> Self {
        let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
        let mut parts = name.rsplitn(3, '.');
        let extension = parts.next().unwrap_or("").to_ascii_lowercase();
        let language = parts
            .next()
            .filter(|_| parts.next().is_some_and(|stem| !stem.is_empty()));
        Self {
            path: path.to_string(),
            language: language.filter(|tag| language_tag(tag)).map(str::to_string),
            format: match extension.as_str() {
                "vtt" => Some(CaptionFormat::Webvtt),
                "srt" => Some(CaptionFormat::Subrip),
                _ => None,
            },
        }
    }
}

/// A BCP 47 shaped language tag: a 2 or 3 letter language and optional 2 to 8 character subtags.
pub fn language_tag(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let language = parts.next().unwrap_or("");
    (2..=3).contains(&language.len())
        && language.chars().all(|c| c.is_ascii_alphabetic())
        && parts.all(|part| {
            (2..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// The transcript: the Markdown under the body's `Transcript` heading, up to the next heading of
/// the same or a higher level.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Transcript {
    pub markdown: String,
}

/// Everything a video destination is prepared from, read from one post.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRelease {
    /// `videoTitle`, or the post title.
    pub title: String,
    /// `videoDescription`, or the post description: the opening of the destination description.
    pub description: String,
    pub reference: VideoReference,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<u32>,
    pub chapters: Vec<Chapter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript: Option<Transcript>,
    pub captions: Vec<CaptionTrack>,
    /// `thumbnail`, or the post's `cover`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    pub consent: Consent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_disclosure: Option<String>,
    pub tags: Vec<String>,
}

impl VideoRelease {
    /// The release of a video post, or `None` for a post of any other profile.
    pub fn from_post(post: &Post) -> Option<Self> {
        let video = post.video.as_ref()?;
        let release = &video.release;
        let body = post.authored_markdown();
        Some(Self {
            title: release.title.clone().unwrap_or_else(|| post.title.clone()),
            description: release
                .description
                .clone()
                .unwrap_or_else(|| post.description.clone()),
            reference: VideoReference {
                file: release.file.clone(),
                url: video.url.clone(),
                youtube_id: video.youtube_id.clone(),
            },
            duration_seconds: video.duration_seconds,
            chapters: chapters(body),
            transcript: transcript(body),
            captions: release
                .captions
                .iter()
                .map(|path| CaptionTrack::from_path(path))
                .collect(),
            thumbnail: video.thumbnail.clone().or_else(|| post.cover.clone()),
            consent: Consent {
                rights: Declared::read(release.rights.as_deref(), |v| match v {
                    "owned" => Some(Rights::Owned),
                    "licensed" => Some(Rights::Licensed),
                    _ => None,
                }),
                people: Declared::read(release.people.as_deref(), |v| match v {
                    "consented" => Some(People::Consented),
                    "none" => Some(People::None),
                    _ => None,
                }),
                made_for_kids: Declared::read(release.made_for_kids.as_deref(), yes_no),
                synthetic_media: Declared::read(release.synthetic_media.as_deref(), yes_no),
            },
            ai_disclosure: video.ai_disclosure.clone(),
            tags: post.tags.iter().map(|tag| tag.name.clone()).collect(),
        })
    }
}

/// Seconds of a chapter timestamp: `M:SS`, `MM:SS`, `MMM:SS` or `H:MM:SS`.
pub fn timestamp_seconds(timestamp: &str) -> Option<u32> {
    let parts: Vec<&str> = timestamp.split(':').collect();
    let number = |part: &str, max_len: usize| {
        (!part.is_empty() && part.len() <= max_len && part.chars().all(|c| c.is_ascii_digit()))
            .then(|| part.parse::<u32>().ok())
            .flatten()
    };
    match parts.as_slice() {
        [minutes, seconds] if seconds.len() == 2 => {
            let (m, s) = (number(minutes, 3)?, number(seconds, 2)?);
            (s < 60).then_some(m * 60 + s)
        }
        [hours, minutes, seconds] if minutes.len() == 2 && seconds.len() == 2 => {
            let (h, m, s) = (number(hours, 2)?, number(minutes, 2)?, number(seconds, 2)?);
            (m < 60 && s < 60).then_some(h * 3600 + m * 60 + s)
        }
        _ => None,
    }
}

/// The chapter lines of a body, outside fenced code, in the order written: the same lines the
/// Admin release kit reads.
pub fn chapters(markdown: &str) -> Vec<Chapter> {
    outside_fences_keeping(markdown)
        .filter(|(_, in_code)| !in_code)
        .filter_map(|(line, _)| {
            let line = line.trim();
            let line = ["- ", "* ", "+ "]
                .iter()
                .find_map(|marker| line.strip_prefix(marker))
                .map_or(line, str::trim_start);
            let (timestamp, label) = line.split_once(char::is_whitespace)?;
            let label = label.trim();
            let seconds = timestamp_seconds(timestamp)?;
            (!label.is_empty()).then(|| Chapter {
                timestamp: timestamp.to_string(),
                seconds,
                label: label.to_string(),
            })
        })
        .collect()
}

/// The ATX heading level and text of a line, if it is one.
fn heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let level = trimmed.chars().take_while(|c| *c == '#').count();
    let rest = &trimmed[level..];
    ((1..=6).contains(&level) && (rest.is_empty() || rest.starts_with([' ', '\t'])))
        .then(|| (level, rest.trim().trim_end_matches('#').trim()))
}

/// The body's transcript section, when it has one with any text in it.
pub fn transcript(markdown: &str) -> Option<Transcript> {
    let mut level = None;
    let mut lines = Vec::new();
    for (line, in_code) in outside_fences_keeping(markdown) {
        if !in_code {
            if let Some((found, text)) = heading(line) {
                match level {
                    Some(open) if found <= open => break,
                    None if text.eq_ignore_ascii_case("transcript") => {
                        level = Some(found);
                        continue;
                    }
                    _ => {}
                }
            }
        }
        if level.is_some() {
            lines.push(line);
        }
    }
    let markdown = lines.join("\n").trim().to_string();
    (!markdown.is_empty()).then_some(Transcript { markdown })
}

/// Every line with whether it is inside fenced code (the fence lines count as code).
fn outside_fences_keeping(markdown: &str) -> impl Iterator<Item = (&str, bool)> {
    let mut fence: Option<(char, usize)> = None;
    markdown.lines().map(move |line| {
        let trimmed = line.trim_start();
        let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~');
        let run = marker.map_or(0, |m| trimmed.chars().take_while(|c| *c == m).count());
        match (fence, marker) {
            (Some((open, len)), Some(m)) if m == open && run >= len => {
                fence = None;
                (line, true)
            }
            (Some(_), _) => (line, true),
            (None, Some(m)) if run >= 3 => {
                fence = Some((m, run));
                (line, true)
            }
            _ => (line, false),
        }
    })
}

// ---------------------------------------------------------------------------------------------
// The YouTube-ready preview (task DIST6.1.2, ADR 0842).

/// The preview format this release writes.
pub const PREVIEW_VERSION: u32 = 1;

/// `snippet.title`: at most 100 characters, and no `<` or `>`
/// (<https://developers.google.com/youtube/v3/docs/videos>).
pub const YOUTUBE_TITLE_MAX_CHARS: usize = 100;
/// `snippet.description`: at most 5,000 bytes, and no `<` or `>` (same source).
pub const YOUTUBE_DESCRIPTION_MAX_BYTES: usize = 5000;
/// `snippet.tags`: at most 500 characters, counting the commas between tags and the quotation
/// marks YouTube adds around a tag with a space (same source).
pub const YOUTUBE_TAGS_MAX_CHARS: usize = 500;

/// Where a preview comes from: the post and the canonical address its description links.
pub struct PreviewSource<'a> {
    pub slug: &'a str,
    pub source_path: &'a str,
    pub canonical_url: &'a str,
    /// Whether the article is live: published, not scheduled for later, and at a public `https`
    /// address. A video should not link a page that does not exist yet.
    pub article_public: bool,
    /// The folders the site publishes, which a master file must stay out of.
    pub folders: PublicFolders<'a>,
}

/// One caption track as YouTube would list it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionPreview {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<CaptionFormat>,
}

/// The YouTube-ready preview of one video release: exactly the metadata the author would enter in
/// YouTube Studio (or a later adapter would send), whether it can go, and the guided steps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPreview {
    pub version: u32,
    pub provider: ProviderId,
    pub label: String,
    pub policy_version: String,
    pub slug: String,
    pub source_path: String,
    pub canonical_url: String,
    pub article_public: bool,
    pub reference: VideoReference,
    pub title: String,
    /// The composed description: the authored opening, the canonical article link, the chapters
    /// and the AI-assistance note.
    pub description: String,
    pub tags: Vec<String>,
    /// The visibility an upload starts at: always `private`, so nothing is public until the author
    /// publishes or schedules it.
    pub privacy: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub made_for_kids: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synthetic_media: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    pub chapters: Vec<Chapter>,
    pub captions: Vec<CaptionPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    pub status: Status,
    /// What keeps the release from going: nothing may be uploaded while any is listed.
    pub problems: Vec<Problem>,
    /// What the manifest says only the author can do, by hand.
    pub manual: Vec<Problem>,
    /// Facts worth knowing that do not block, such as an article that is not live yet.
    pub notes: Vec<Problem>,
    /// The guided workflow, in order.
    pub steps: Vec<String>,
    /// BLAKE2b (128 bits) over every field the destination would receive.
    pub digest: String,
}

impl VideoPreview {
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// The description YouTube receives: the authored opening, the canonical article, the chapters
/// and the AI-assistance note, each as its own paragraph. The same sections, in the same order,
/// as Admin's release kit, with the article link added.
pub fn compose_description(release: &VideoRelease, canonical_url: &str) -> String {
    let mut sections = Vec::new();
    let opening = release.description.trim();
    if !opening.is_empty() {
        sections.push(opening.to_string());
    }
    sections.push(format!("Read the article: {canonical_url}"));
    if !release.chapters.is_empty() {
        let lines: Vec<String> = release
            .chapters
            .iter()
            .map(|c| format!("{} {}", c.timestamp, c.label))
            .collect();
        sections.push(format!("Chapters\n{}", lines.join("\n")));
    }
    if let Some(note) = release.ai_disclosure.as_deref().map(str::trim) {
        if !note.is_empty() {
            sections.push(format!("AI assistance: {note}"));
        }
    }
    sections.join("\n\n")
}

/// The length YouTube counts for a tag list: each tag, two quotation marks around a tag with a
/// space, and a comma between tags.
pub fn youtube_tags_chars(tags: &[String]) -> usize {
    let each: usize = tags
        .iter()
        .map(|tag| tag.chars().count() + if tag.contains(' ') { 2 } else { 0 })
        .sum();
    each + tags.len().saturating_sub(1)
}

fn problem(code: &str, message: impl Into<String>) -> Problem {
    Problem::blocking(code, message)
}

/// The metadata checks: title, description, tags and chapters against YouTube's own rules.
fn metadata_problems(release: &VideoRelease, description: &str) -> Vec<Problem> {
    let mut problems = Vec::new();
    let title = release.title.trim();
    if title.is_empty() {
        problems.push(problem(
            "title-missing",
            "Give the video a title with `videoTitle` or the post title.",
        ));
    } else if title.chars().count() > YOUTUBE_TITLE_MAX_CHARS {
        problems.push(problem(
            "title-too-long",
            format!("YouTube takes a title of at most {YOUTUBE_TITLE_MAX_CHARS} characters; shorten it with `videoTitle`."),
        ));
    }
    if title.contains(['<', '>']) {
        problems.push(problem(
            "title-angle-brackets",
            "YouTube does not accept < or > in a title.",
        ));
    }
    if description.len() > YOUTUBE_DESCRIPTION_MAX_BYTES {
        problems.push(problem(
            "description-too-long",
            format!("YouTube takes a description of at most {YOUTUBE_DESCRIPTION_MAX_BYTES} bytes, including the article link, chapters and AI-assistance note."),
        ));
    }
    if description.contains(['<', '>']) {
        problems.push(problem(
            "description-angle-brackets",
            "YouTube does not accept < or > in a description; reword the description, chapters or AI-assistance note.",
        ));
    }
    if youtube_tags_chars(&release.tags) > YOUTUBE_TAGS_MAX_CHARS {
        problems.push(problem(
            "tags-too-long",
            format!("YouTube takes at most {YOUTUBE_TAGS_MAX_CHARS} characters of tags; use fewer or shorter tags."),
        ));
    }
    problems.extend(chapter_problems(
        &release.chapters,
        release.duration_seconds,
    ));
    problems
}

/// YouTube's chapter rules: the first at `00:00`, at least three, ascending, each at least ten
/// seconds, the last checked against the duration. No chapters at all is fine.
pub fn chapter_problems(chapters: &[Chapter], duration: Option<u32>) -> Vec<Problem> {
    let mut problems = Vec::new();
    let Some(first) = chapters.first() else {
        return problems;
    };
    if first.seconds != 0 {
        problems.push(problem(
            "chapters-first-not-zero",
            "The first chapter must start at 00:00.",
        ));
    }
    if chapters.len() < CHAPTER_MIN_COUNT {
        problems.push(problem(
            "chapters-too-few",
            format!("YouTube shows chapters only when there are at least {CHAPTER_MIN_COUNT}."),
        ));
    }
    let ascending = chapters
        .windows(2)
        .all(|pair| pair[1].seconds > pair[0].seconds);
    if !ascending {
        problems.push(problem(
            "chapters-out-of-order",
            "List chapters in ascending order of time.",
        ));
    }
    match duration {
        None => problems.push(problem(
            "chapters-duration-missing",
            "Add the video's `duration` so the last chapter can be checked.",
        )),
        Some(total) if ascending => {
            let last = chapters.last().map_or(0, |c| c.seconds);
            let short = chapters
                .windows(2)
                .any(|pair| pair[1].seconds - pair[0].seconds < CHAPTER_MIN_SECONDS)
                || total < last.saturating_add(CHAPTER_MIN_SECONDS);
            if short {
                problems.push(problem(
                    "chapters-too-short",
                    format!("Keep every chapter at least {CHAPTER_MIN_SECONDS} seconds long, the last one included."),
                ));
            }
        }
        Some(_) => {}
    }
    problems
}

/// The guided workflow in YouTube Studio for this release, in order.
fn steps(release: &VideoRelease, canonical_url: &str) -> Vec<String> {
    let mut steps = Vec::new();
    match (&release.reference.youtube_id, &release.reference.file) {
        (Some(_), _) => {
            steps.push("Open the video in YouTube Studio and choose Details.".to_string())
        }
        (None, Some(file)) => steps.push(format!(
            "In YouTube Studio, choose Create, then Upload videos, and upload `{file}`."
        )),
        (None, None) => steps.push("Upload the video in YouTube Studio.".to_string()),
    }
    steps.push(
        "Paste the title from `title.txt` and the description from `description.txt`.".to_string(),
    );
    if release.thumbnail.is_some() {
        steps.push("Under Thumbnail, upload the thumbnail shown in this preview.".to_string());
    }
    if !release.tags.is_empty() {
        steps.push("Under Show more, paste the tags from `tags.txt`.".to_string());
    }
    for track in &release.captions {
        steps.push(format!(
            "Under Subtitles, add the {} captions by uploading `{}` with timing.",
            track.language.as_deref().unwrap_or("unlabelled"),
            track.path
        ));
    }
    if release.captions.is_empty() && release.transcript.is_some() {
        steps.push("Under Subtitles, upload `transcript.txt` as a file without timing, and review the synchronised captions.".to_string());
    }
    let answer = |value: Declared<bool>, yes: &str, no: &str| match value {
        Declared::Value(true) => yes.to_string(),
        Declared::Value(false) => no.to_string(),
        _ => "the answer you declare in the post".to_string(),
    };
    steps.push(format!(
        "Under Audience, choose {}.",
        answer(
            release.consent.made_for_kids,
            "\u{201c}Yes, it is made for kids\u{201d}",
            "\u{201c}No, it is not made for kids\u{201d}"
        )
    ));
    steps.push(format!(
        "Under Altered content, answer {}.",
        answer(release.consent.synthetic_media, "Yes", "No")
    ));
    steps.push(format!(
        "Keep the video Private until the article at {canonical_url} is live, then publish it or schedule it."
    ));
    steps
}

/// The YouTube-ready preview of `release`: the exact metadata, checked against YouTube's rules
/// and its manifest, with the files it names looked up through `probe` (ADR 0843). Sends nothing.
pub fn youtube_preview(
    release: &VideoRelease,
    source: PreviewSource<'_>,
    probe: &dyn Fn(&AssetRef<'_>) -> AssetFacts,
) -> VideoPreview {
    let manifest = builtin_manifest(ProviderId::Youtube);
    let description = compose_description(release, source.canonical_url);
    let mut problems = metadata_problems(release, &description);
    let (release_problems, asset_notes) = release_problems(release, &source.folders, probe);
    problems.extend(release_problems);
    let mut capabilities = vec![Capability::Video, Capability::Text, Capability::Link];
    if release.thumbnail.is_some() {
        capabilities.push(Capability::Image);
    }
    let manual: Vec<Problem> = manifest
        .check(&DistributionRequest::new(capabilities))
        .iter()
        .map(|i| Problem::from_ineligibility(i, &manifest.label))
        .collect();
    let mut notes = Vec::new();
    if !source.article_public {
        notes.push(problem(
            "article-not-public",
            "The article is not live at its public address yet; keep the video private until it is.",
        ));
    }
    notes.extend(asset_notes);
    let status = if !problems.is_empty() {
        Status::Blocked
    } else if !manual.is_empty() {
        Status::Manual
    } else {
        Status::Ready
    };
    let captions: Vec<CaptionPreview> = release
        .captions
        .iter()
        .map(|t| CaptionPreview {
            path: t.path.clone(),
            language: t.language.clone(),
            format: t.format,
        })
        .collect();
    let title = release.title.trim().to_string();
    let mut hasher = Blake2b512::new();
    field(&mut hasher, "openblog-video-preview-v1");
    field(&mut hasher, ProviderId::Youtube.as_str());
    field(&mut hasher, source.canonical_url);
    field(&mut hasher, release.reference.file.as_deref().unwrap_or(""));
    field(
        &mut hasher,
        release.reference.youtube_id.as_deref().unwrap_or(""),
    );
    field(&mut hasher, &title);
    field(&mut hasher, &description);
    field(&mut hasher, &release.tags.len().to_string());
    for tag in &release.tags {
        field(&mut hasher, tag);
    }
    field(&mut hasher, "private");
    for value in [
        release.consent.made_for_kids,
        release.consent.synthetic_media,
    ] {
        field(
            &mut hasher,
            match value.value() {
                Some(true) => "yes",
                Some(false) => "no",
                None => "",
            },
        );
    }
    field(&mut hasher, release.thumbnail.as_deref().unwrap_or(""));
    field(&mut hasher, &captions.len().to_string());
    for track in &captions {
        field(&mut hasher, &track.path);
    }
    field(
        &mut hasher,
        release
            .transcript
            .as_ref()
            .map_or("", |t| t.markdown.as_str()),
    );
    VideoPreview {
        version: PREVIEW_VERSION,
        provider: ProviderId::Youtube,
        label: manifest.label.clone(),
        policy_version: manifest.policy_version.clone(),
        slug: source.slug.to_string(),
        source_path: source.source_path.to_string(),
        canonical_url: source.canonical_url.to_string(),
        article_public: source.article_public,
        reference: release.reference.clone(),
        title,
        description,
        tags: release.tags.clone(),
        privacy: "private",
        made_for_kids: release.consent.made_for_kids.value(),
        synthetic_media: release.consent.synthetic_media.value(),
        thumbnail: release.thumbnail.clone(),
        chapters: release.chapters.clone(),
        captions,
        transcript: release.transcript.as_ref().map(|t| t.markdown.clone()),
        status,
        problems,
        manual,
        notes,
        steps: steps(release, source.canonical_url),
        digest: hex(hasher),
    }
}

fn status_words(status: Status) -> &'static str {
    match status {
        Status::Ready => "Ready: open.blog can upload this",
        Status::Manual => {
            "By hand: ready for you to upload in YouTube Studio; open.blog sends nothing"
        }
        Status::Blocked => "Blocked: fix the problems below before uploading",
    }
}

fn list_section(out: &mut String, id: &str, heading: &str, items: &[Problem]) {
    if items.is_empty() {
        return;
    }
    let t = escape::text;
    out.push_str(&format!(
        "<h3 id=\"{id}\">{heading}</h3>\n<ul aria-labelledby=\"{id}\">\n"
    ));
    for item in items {
        out.push_str(&format!(
            "<li>{} <span class=\"code\">({})</span></li>\n",
            t(&item.message),
            t(&item.code)
        ));
    }
    out.push_str("</ul>\n");
}

/// The static preview page: script-free HTML a person can open from disk with a keyboard or a
/// screen reader. `thumbnail_file` is the copy of the thumbnail beside the page, when there is one.
pub fn preview_page(preview: &VideoPreview, thumbnail_file: Option<&str>) -> String {
    let t = escape::text;
    let a = escape::attr;
    let mut out = String::new();
    out.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    out.push_str(&format!(
        "<title>YouTube preview: {}</title>\n",
        t(&preview.title)
    ));
    out.push_str(PAGE_STYLE);
    out.push_str("<style>img{max-width:100%;height:auto;border:1px solid var(--line)}figure{margin:0}ol li{margin-bottom:.35rem}</style>\n");
    out.push_str("</head>\n<body>\n<main>\n");
    out.push_str(&format!(
        "<h1>YouTube preview: {}</h1>\n",
        t(&preview.title)
    ));
    out.push_str("<p class=\"notice\"><strong>Preview, not sent.</strong> Nothing in this folder was uploaded to YouTube, and no credential was read.</p>\n");
    out.push_str("<dl>\n");
    out.push_str(&format!(
        "<dt>Canonical article</dt><dd><a href=\"{}\">{}</a>{}</dd>\n",
        a(&preview.canonical_url),
        t(&preview.canonical_url),
        if preview.article_public {
            ""
        } else {
            " (not live yet)"
        }
    ));
    let video = match (&preview.reference.url, &preview.reference.file) {
        (Some(url), _) => format!("<a href=\"{}\">{}</a>", a(url), t(url)),
        (None, Some(file)) => format!("<code>{}</code>", t(file)),
        (None, None) => "<em>none</em>".to_string(),
    };
    out.push_str(&format!("<dt>Video</dt><dd>{video}</dd>\n"));
    out.push_str(&format!(
        "<dt>Source</dt><dd>{}</dd>\n<dt>Preview digest</dt><dd><code>{}</code></dd>\n<dt>Provider policy</dt><dd>{} of {}</dd>\n",
        t(&preview.source_path),
        t(&preview.digest),
        t(&preview.label),
        t(&preview.policy_version)
    ));
    out.push_str("</dl>\n");

    out.push_str(
        "<section aria-labelledby=\"status-title\">\n<h2 id=\"status-title\">Status</h2>\n",
    );
    out.push_str(&format!(
        "<p><strong>Status:</strong> {}.</p>\n",
        status_words(preview.status)
    ));
    list_section(
        &mut out,
        "problems-title",
        "What keeps it from going",
        &preview.problems,
    );
    list_section(
        &mut out,
        "manual-title",
        "What only you can do, in YouTube Studio",
        &preview.manual,
    );
    list_section(&mut out, "notes-title", "Worth knowing", &preview.notes);
    out.push_str("</section>\n");

    out.push_str("<section aria-labelledby=\"metadata-title\">\n<h2 id=\"metadata-title\">Title and description</h2>\n");
    out.push_str(&format!(
        "<p>Title, {} of {YOUTUBE_TITLE_MAX_CHARS} characters, saved as <a href=\"title.txt\">title.txt</a>:</p>\n<pre tabindex=\"0\" aria-label=\"Video title\">{}</pre>\n",
        preview.title.chars().count(),
        t(&preview.title)
    ));
    out.push_str(&format!(
        "<p>Description, {} of {YOUTUBE_DESCRIPTION_MAX_BYTES} bytes, saved as <a href=\"description.txt\">description.txt</a>:</p>\n<pre tabindex=\"0\" aria-label=\"Video description\">{}</pre>\n",
        preview.description.len(),
        t(&preview.description)
    ));
    if preview.tags.is_empty() {
        out.push_str("<p>Tags: <em>none</em>.</p>\n");
    } else {
        out.push_str(&format!(
            "<p>Tags, {} of {YOUTUBE_TAGS_MAX_CHARS} characters as YouTube counts them, saved as <a href=\"tags.txt\">tags.txt</a>:</p>\n<ul>\n",
            youtube_tags_chars(&preview.tags)
        ));
        for tag in &preview.tags {
            out.push_str(&format!("<li><code>{}</code></li>\n", t(tag)));
        }
        out.push_str("</ul>\n");
    }
    out.push_str("</section>\n");

    out.push_str(
        "<section aria-labelledby=\"thumbnail-title\">\n<h2 id=\"thumbnail-title\">Thumbnail</h2>\n",
    );
    match (&preview.thumbnail, thumbnail_file) {
        (Some(path), Some(file)) => out.push_str(&format!(
            "<figure>\n<img src=\"{}\" alt=\"The thumbnail chosen for {}\">\n<figcaption>From <code>{}</code>.</figcaption>\n</figure>\n",
            a(file),
            a(&preview.title),
            t(path)
        )),
        (Some(path), None) => out.push_str(&format!(
            "<p>The thumbnail <code>{}</code> is not in this folder; check it before uploading.</p>\n",
            t(path)
        )),
        (None, _) => {
            out.push_str("<p>No thumbnail: YouTube will offer frames from the video.</p>\n")
        }
    }
    out.push_str("</section>\n");

    out.push_str(
        "<section aria-labelledby=\"chapters-title\">\n<h2 id=\"chapters-title\">Chapters</h2>\n",
    );
    if preview.chapters.is_empty() {
        out.push_str("<p>No chapters are written in the post.</p>\n");
    } else {
        out.push_str("<table>\n<caption>Chapters as they appear in the description</caption>\n<thead><tr><th scope=\"col\">Starts at</th><th scope=\"col\">Chapter</th></tr></thead>\n<tbody>\n");
        for chapter in &preview.chapters {
            out.push_str(&format!(
                "<tr><th scope=\"row\">{}</th><td>{}</td></tr>\n",
                t(&chapter.timestamp),
                t(&chapter.label)
            ));
        }
        out.push_str("</tbody>\n</table>\n");
    }
    out.push_str("</section>\n");

    out.push_str("<section aria-labelledby=\"access-title\">\n<h2 id=\"access-title\">Captions and transcript</h2>\n");
    if preview.captions.is_empty() {
        out.push_str("<p>No caption files are listed.</p>\n");
    } else {
        out.push_str("<ul>\n");
        for track in &preview.captions {
            out.push_str(&format!(
                "<li><code>{}</code>: {}, {}</li>\n",
                t(&track.path),
                t(track
                    .language
                    .as_deref()
                    .unwrap_or("no language in the file name")),
                match track.format {
                    Some(CaptionFormat::Webvtt) => "WebVTT",
                    Some(CaptionFormat::Subrip) => "SubRip",
                    None => "an unsupported format",
                }
            ));
        }
        out.push_str("</ul>\n");
    }
    match &preview.transcript {
        Some(text) => out.push_str(&format!(
            "<p>The transcript from the post, saved as <a href=\"transcript.txt\">transcript.txt</a>:</p>\n<pre tabindex=\"0\" aria-label=\"Transcript\">{}</pre>\n",
            t(text)
        )),
        None => out.push_str("<p>The post has no Transcript section.</p>\n"),
    }
    out.push_str("</section>\n");

    out.push_str("<section aria-labelledby=\"audience-title\">\n<h2 id=\"audience-title\">Audience and disclosures</h2>\n<dl>\n");
    let answer = |value: Option<bool>| match value {
        Some(true) => "Yes",
        Some(false) => "No",
        None => "Not declared",
    };
    out.push_str(&format!(
        "<dt>Made for kids</dt><dd>{}</dd>\n<dt>Realistic altered or synthetic content</dt><dd>{}</dd>\n<dt>Visibility when uploaded</dt><dd>Private</dd>\n</dl>\n</section>\n",
        answer(preview.made_for_kids),
        answer(preview.synthetic_media)
    ));

    out.push_str("<section aria-labelledby=\"steps-title\">\n<h2 id=\"steps-title\">By hand in YouTube Studio</h2>\n<ol>\n");
    for step in &preview.steps {
        out.push_str(&format!("<li>{}</li>\n", t(step)));
    }
    out.push_str("</ol>\n</section>\n</main>\n</body>\n</html>\n");
    out
}

// ---------------------------------------------------------------------------------------------
// Media source, consent and accessibility validation (task DIST6.1.3, ADR 0843).

/// `videos.insert` takes a file of at most 256 GB
/// (<https://developers.google.com/youtube/v3/docs/videos/insert>).
pub const YOUTUBE_VIDEO_MAX_BYTES: u64 = 256 * 1024 * 1024 * 1024;
/// `thumbnails.set` takes a JPEG or PNG of at most 50 MB
/// (<https://developers.google.com/youtube/v3/docs/thumbnails/set>), counted here in decimal so
/// a file at the edge is never let through.
pub const YOUTUBE_THUMBNAIL_MAX_BYTES: u64 = 50_000_000;
/// A video thumbnail is at least 640 pixels wide, and 16:9 is the shape YouTube shows
/// (<https://support.google.com/youtube/answer/72431>).
pub const YOUTUBE_THUMBNAIL_MIN_WIDTH: u32 = 640;
/// `captions.insert` takes a file of at most 100 MB
/// (<https://developers.google.com/youtube/v3/docs/captions/insert>).
pub const YOUTUBE_CAPTION_MAX_BYTES: u64 = 100_000_000;
/// How many leading bytes of a file the caller hands over: enough for a video's signature, a
/// caption's first cue and a JPEG's frame header after its metadata.
pub const HEAD_BYTES: usize = 1024 * 1024;

/// Video formats YouTube lists as supported (<https://support.google.com/youtube/troubleshooter/2888402>)
/// whose signature open.blog can recognise, by extension.
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "3gp", "webm", "avi", "wmv", "flv", "mpg", "mpeg",
];

/// A file a release names, for the caller to look up. Only a path that already passed
/// [`project_path`] is ever asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssetRef<'a> {
    /// Relative to the project root (`videoFile`, `captions`).
    Project(&'a str),
    /// Relative to the static folder, from a site-relative address (`/images/a.png`).
    Static(&'a str),
}

/// What the caller found. A symlink, a folder or anything that is not a regular file is
/// `Missing`: nothing is followed out of the project.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssetFacts {
    Missing,
    /// A regular file: its size and its first bytes (at most [`HEAD_BYTES`]).
    File {
        bytes: u64,
        head: Vec<u8>,
    },
}

/// The folders whose contents become public with the site: a master file there would be
/// published before its release.
pub struct PublicFolders<'a> {
    pub static_dir: &'a str,
    pub output_dir: &'a str,
}

/// A clean project-relative path: no root, drive, scheme, `..`, `.`, backslash or empty segment.
pub fn project_path(path: &str) -> Option<&str> {
    let ok = !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    ok.then_some(path)
}

fn extension(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Whether `path` lies inside the folder `dir` (both project-relative).
fn inside(path: &str, dir: &str) -> bool {
    let dir = dir.trim_matches('/');
    !dir.is_empty()
        && (path == dir
            || path
                .strip_prefix(dir)
                .is_some_and(|rest| rest.starts_with('/')))
}

/// Whether the first bytes are those of a video in the format its extension names.
fn video_signature(extension: &str, head: &[u8]) -> bool {
    let at = |offset: usize, bytes: &[u8]| head.get(offset..offset + bytes.len()) == Some(bytes);
    match extension {
        "mp4" | "m4v" | "mov" | "3gp" => {
            at(4, b"ftyp")
                || (extension == "mov"
                    && [b"moov", b"mdat", b"wide", b"free"]
                        .iter()
                        .any(|atom| at(4, *atom)))
        }
        "webm" => at(0, &[0x1a, 0x45, 0xdf, 0xa3]),
        "avi" => at(0, b"RIFF") && at(8, b"AVI "),
        "wmv" => at(0, &[0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]),
        "flv" => at(0, b"FLV"),
        "mpg" | "mpeg" => at(0, &[0, 0, 1, 0xba]) || at(0, &[0, 0, 1, 0xb3]),
        _ => false,
    }
}

/// The kind and size of a PNG or JPEG image from its first bytes.
pub fn image_size(head: &[u8]) -> Option<(&'static str, u32, u32)> {
    let be32 = |at: usize| {
        head.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    let be16 = |at: usize| {
        head.get(at..at + 2)
            .map(|b| u32::from(u16::from_be_bytes([b[0], b[1]])))
    };
    if head.starts_with(b"\x89PNG\r\n\x1a\n") && head.get(12..16) == Some(b"IHDR") {
        return Some(("png", be32(16)?, be32(20)?));
    }
    if !head.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut at = 2;
    loop {
        while head.get(at) == Some(&0xff) && head.get(at + 1) == Some(&0xff) {
            at += 1;
        }
        if head.get(at) != Some(&0xff) {
            return None;
        }
        let marker = *head.get(at + 1)?;
        if matches!(marker, 0xd0..=0xd9 | 0x01) {
            at += 2;
            continue;
        }
        let length = be16(at + 2)? as usize;
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let (height, width) = (be16(at + 5)?, be16(at + 7)?);
            return Some(("jpeg", width, height));
        }
        if length < 2 {
            return None;
        }
        at += 2 + length;
    }
}

/// Whether the first bytes start a caption file of `format`: UTF-8 text that opens with `WEBVTT`,
/// or with a SubRip cue number followed by a timing line.
fn caption_signature(format: CaptionFormat, head: &[u8]) -> bool {
    // A cut in the middle of a character at the end of the head is not a fault.
    let text = match std::str::from_utf8(head) {
        Ok(text) => text,
        Err(error) if error.error_len().is_none() => {
            std::str::from_utf8(&head[..error.valid_up_to()]).unwrap_or("")
        }
        Err(_) => return false,
    };
    let text = text.trim_start_matches('\u{feff}');
    match format {
        CaptionFormat::Webvtt => {
            text.starts_with("WEBVTT")
                && text[6..]
                    .chars()
                    .next()
                    .is_none_or(|c| matches!(c, ' ' | '\t' | '\n' | '\r'))
        }
        CaptionFormat::Subrip => {
            let mut lines = text.trim_start().lines();
            lines.next().is_some_and(|l| {
                !l.trim().is_empty() && l.trim().chars().all(|c| c.is_ascii_digit())
            }) && lines.next().is_some_and(|l| l.contains("-->"))
        }
    }
}

/// Everything about the video source, the consent answers, the text alternative, the captions and
/// the thumbnail that keeps a release from going (`problems`) or is worth knowing (`notes`).
pub fn release_problems(
    release: &VideoRelease,
    folders: &PublicFolders<'_>,
    probe: &dyn Fn(&AssetRef<'_>) -> AssetFacts,
) -> (Vec<Problem>, Vec<Problem>) {
    let mut problems = Vec::new();
    let mut notes = Vec::new();
    let reference = &release.reference;

    // The media source.
    if reference.file.is_none() && reference.url.is_none() {
        problems.push(problem(
            "source-missing",
            "Name the video: `videoFile` for a file in your project, or `videoUrl` for a video already on YouTube.",
        ));
    }
    if reference.url.is_some() && reference.youtube_id.is_none() {
        problems.push(problem(
            "source-url-unsupported",
            "`videoUrl` must be a YouTube watch, youtu.be or Shorts address.",
        ));
    }
    if let Some(file) = reference.file.as_deref() {
        let ext = extension(file);
        match project_path(file) {
            None => problems.push(problem(
                "source-path-invalid",
                "`videoFile` must be a path inside your project, such as media/episode-1.mp4, without `..`.",
            )),
            Some(_) if !VIDEO_EXTENSIONS.contains(&ext.as_str()) => problems.push(problem(
                "source-format-unsupported",
                format!("`videoFile` must be one of: {}.", VIDEO_EXTENSIONS.join(", ")),
            )),
            Some(path) if inside(path, folders.static_dir) || inside(path, folders.output_dir) => {
                problems.push(problem(
                    "source-public",
                    "`videoFile` is in a folder your site publishes, so it would be public before its release; move it outside the static and output folders.",
                ))
            }
            Some(path) => match probe(&AssetRef::Project(path)) {
                AssetFacts::Missing => problems.push(problem(
                    "source-not-found",
                    "`videoFile` is not a file in your project.",
                )),
                AssetFacts::File { bytes, .. } if bytes > YOUTUBE_VIDEO_MAX_BYTES => {
                    problems.push(problem("source-too-large", "YouTube takes a video file of at most 256 GB."))
                }
                AssetFacts::File { head, .. } if !video_signature(&ext, &head) => problems.push(problem(
                    "source-not-video",
                    format!("`videoFile` does not start like a .{ext} video; check that it is the exported video."),
                )),
                AssetFacts::File { .. } => {}
            },
        }
    }

    // The author's answers.
    let consent = &release.consent;
    let answers: [(&str, &str, &str, bool, bool); 4] = [
        (
            "rights",
            "videoRights",
            "owned or licensed",
            consent.rights == Declared::Missing,
            consent.rights == Declared::Invalid,
        ),
        (
            "people",
            "videoPeople",
            "consented or none",
            consent.people == Declared::Missing,
            consent.people == Declared::Invalid,
        ),
        (
            "audience",
            "madeForKids",
            "yes or no",
            consent.made_for_kids == Declared::Missing,
            consent.made_for_kids == Declared::Invalid,
        ),
        (
            "synthetic",
            "syntheticMedia",
            "yes or no",
            consent.synthetic_media == Declared::Missing,
            consent.synthetic_media == Declared::Invalid,
        ),
    ];
    for (name, key, values, missing, invalid) in answers {
        if missing {
            problems.push(problem(
                &format!("consent-{name}-missing"),
                format!("Answer `{key}` ({values}) in the post; open.blog never assumes it."),
            ));
        } else if invalid {
            problems.push(problem(
                &format!("consent-{name}-invalid"),
                format!("`{key}` must be {values}."),
            ));
        }
    }

    // A text alternative: captions or a transcript.
    if release.captions.is_empty() && release.transcript.is_none() {
        problems.push(problem(
            "accessibility-no-text-alternative",
            "Add caption files with `captions`, or a Transcript section to the post, so the video can be followed without sound.",
        ));
    }
    let mut languages = std::collections::BTreeSet::new();
    for track in &release.captions {
        let Some(path) = project_path(&track.path) else {
            problems.push(problem(
                "caption-path-invalid",
                "Every caption file must be a path inside your project, without `..`.",
            ));
            continue;
        };
        let Some(format) = track.format else {
            problems.push(problem(
                "caption-format-unsupported",
                "Caption files must be WebVTT (.vtt) or SubRip (.srt).",
            ));
            continue;
        };
        match &track.language {
            None => problems.push(problem(
                "caption-language-missing",
                "Name each caption file for its language, such as episode-1.en.vtt.",
            )),
            Some(language) if !languages.insert(language.to_ascii_lowercase()) => {
                problems.push(problem(
                    "caption-language-duplicate",
                    "List one caption file per language.",
                ))
            }
            Some(_) => {}
        }
        match probe(&AssetRef::Project(path)) {
            AssetFacts::Missing => problems.push(problem(
                "caption-not-found",
                "A caption file is not a file in your project.",
            )),
            AssetFacts::File { bytes, .. } if bytes > YOUTUBE_CAPTION_MAX_BYTES => problems.push(problem(
                "caption-too-large",
                "YouTube takes a caption file of at most 100 MB.",
            )),
            AssetFacts::File { head, .. } if !caption_signature(format, &head) => problems.push(problem(
                "caption-unreadable",
                "A caption file does not start as its format requires (WEBVTT, or a SubRip cue number and timing).",
            )),
            AssetFacts::File { .. } => {}
        }
    }

    // The thumbnail.
    match release.thumbnail.as_deref() {
        None => notes.push(problem(
            "thumbnail-missing",
            "No `thumbnail` or `cover`: YouTube will offer frames from the video.",
        )),
        Some(url) if url.starts_with("https://") || url.starts_with("http://") => notes.push(problem(
            "thumbnail-remote",
            "The thumbnail is a remote address, so open.blog cannot check or copy it; set it by hand.",
        )),
        Some(url) => match url.strip_prefix('/').and_then(project_path) {
            None => problems.push(problem(
                "thumbnail-path-invalid",
                "`thumbnail` must be a site address such as /images/episode.jpg, or an https address.",
            )),
            Some(path) if !matches!(extension(path).as_str(), "jpg" | "jpeg" | "png") => problems.push(problem(
                "thumbnail-format-unsupported",
                "YouTube takes a JPEG or PNG thumbnail.",
            )),
            Some(path) => match probe(&AssetRef::Static(path)) {
                AssetFacts::Missing => problems.push(problem(
                    "thumbnail-not-found",
                    "The thumbnail is not a file in your static folder.",
                )),
                AssetFacts::File { bytes, .. } if bytes > YOUTUBE_THUMBNAIL_MAX_BYTES => problems.push(problem(
                    "thumbnail-too-large",
                    "YouTube takes a thumbnail of at most 50 MB.",
                )),
                AssetFacts::File { head, .. } => match image_size(&head) {
                    None => problems.push(problem(
                        "thumbnail-unreadable",
                        "The thumbnail is not a readable JPEG or PNG image.",
                    )),
                    Some((_, width, _)) if width < YOUTUBE_THUMBNAIL_MIN_WIDTH => problems.push(problem(
                        "thumbnail-too-narrow",
                        format!("YouTube needs a thumbnail at least {YOUTUBE_THUMBNAIL_MIN_WIDTH} pixels wide."),
                    )),
                    Some((_, width, height)) => {
                        // 16:9 within one percent.
                        let (w, h) = (u64::from(width), u64::from(height));
                        if (w * 9).abs_diff(h * 16) * 100 > h * 16 {
                            notes.push(problem(
                                "thumbnail-not-widescreen",
                                "The thumbnail is not 16:9, so YouTube will show it letterboxed or cropped.",
                            ));
                        }
                    }
                },
            },
        },
    }
    (problems, notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chapters_are_timestamp_lines_outside_code() {
        let body = "Intro\n\n## Chapters\n\n00:00 Opening\n- 0:42 A warning\n1:02:03 Late\n12:3 Not one\n00:20\n```\n00:30 In code\n```\n";
        let found = chapters(body);
        assert_eq!(
            found
                .iter()
                .map(|c| (c.timestamp.as_str(), c.seconds, c.label.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("00:00", 0, "Opening"),
                ("0:42", 42, "A warning"),
                ("1:02:03", 3723, "Late")
            ]
        );
    }

    #[test]
    fn timestamps_reject_out_of_range_parts() {
        assert_eq!(timestamp_seconds("10:60"), None);
        assert_eq!(timestamp_seconds("1:60:00"), None);
        assert_eq!(timestamp_seconds("100:00"), Some(6000));
        assert_eq!(timestamp_seconds("a:00"), None);
    }

    #[test]
    fn the_transcript_runs_to_the_next_heading_of_its_level() {
        let body = "## Chapters\n00:00 A\n\n## Transcript\n\n**Narrator:** Hello.\n\n### Scene two\nMore.\n```\n# not a heading\n```\n## Credits\nCrew";
        assert_eq!(
            transcript(body).unwrap().markdown,
            "**Narrator:** Hello.\n\n### Scene two\nMore.\n```\n# not a heading\n```"
        );
        assert_eq!(transcript("## Transcript\n\n## Credits\nCrew"), None);
        assert_eq!(transcript("No transcript here"), None);
    }

    #[test]
    fn a_caption_names_its_language_and_format() {
        let track = CaptionTrack::from_path("media/episode-1.pt-BR.vtt");
        assert_eq!(track.language.as_deref(), Some("pt-BR"));
        assert_eq!(track.format, Some(CaptionFormat::Webvtt));
        let bare = CaptionTrack::from_path("media/episode.srt");
        assert_eq!(
            (bare.language, bare.format),
            (None, Some(CaptionFormat::Subrip))
        );
        let odd = CaptionTrack::from_path("media/en.sbv");
        assert_eq!((odd.language, odd.format), (None, None));
        assert!(language_tag("en") && language_tag("zh-Hant-TW") && !language_tag("english"));
    }

    #[test]
    fn declarations_keep_an_unknown_answer_as_invalid() {
        assert_eq!(Declared::read(Some(" Yes "), yes_no), Declared::Value(true));
        assert_eq!(
            Declared::read(Some("maybe"), yes_no),
            Declared::<bool>::Invalid
        );
        assert_eq!(Declared::read(None, yes_no), Declared::<bool>::Missing);
        assert_eq!(
            Declared::read(Some("  "), yes_no),
            Declared::<bool>::Missing
        );
    }

    fn release() -> VideoRelease {
        VideoRelease {
            title: "Episode <one>".into(),
            description: "A walk to the gate.".into(),
            reference: VideoReference {
                file: Some("media/episode-1.mp4".into()),
                url: None,
                youtube_id: None,
            },
            duration_seconds: Some(200),
            chapters: chapters("00:00 Road\n00:42 Ash\n01:36 Gate"),
            transcript: transcript("## Transcript\nHello <b>there</b>."),
            captions: vec![CaptionTrack::from_path("media/episode-1.en.vtt")],
            thumbnail: Some("/images/episode.png".into()),
            consent: Consent {
                rights: Declared::Value(Rights::Owned),
                people: Declared::Value(People::None),
                made_for_kids: Declared::Value(false),
                synthetic_media: Declared::Value(false),
            },
            ai_disclosure: Some("Concept art was AI-assisted.".into()),
            tags: vec!["animation".into(), "behind the scenes".into()],
        }
    }

    fn source(public: bool) -> PreviewSource<'static> {
        PreviewSource {
            slug: "episode-1",
            source_path: "content/posts/episode-1.md",
            canonical_url: "https://blog.example.org/posts/episode-1/",
            article_public: public,
            folders: PublicFolders {
                static_dir: "static",
                output_dir: "dist",
            },
        }
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes
    }

    /// Every file the release names exists and is what its name says.
    fn good(asset: &AssetRef<'_>) -> AssetFacts {
        let path = match asset {
            AssetRef::Project(path) | AssetRef::Static(path) => *path,
        };
        let head = if path.ends_with(".mp4") {
            b"\0\0\0\x20ftypisom".to_vec()
        } else if path.ends_with(".vtt") {
            b"WEBVTT\n\n00:00.000 --> 00:02.000\nHello".to_vec()
        } else if path.ends_with(".srt") {
            b"1\n00:00:00,000 --> 00:00:02,000\nHello".to_vec()
        } else {
            png(1280, 720)
        };
        AssetFacts::File {
            bytes: head.len() as u64,
            head,
        }
    }

    fn codes(problems: &[Problem]) -> Vec<&str> {
        problems.iter().map(|p| p.code.as_str()).collect()
    }

    #[test]
    fn the_description_carries_the_opening_the_article_the_chapters_and_the_disclosure() {
        let mut ok = release();
        ok.title = "Episode one".into();
        assert_eq!(
            compose_description(&ok, "https://blog.example.org/posts/episode-1/"),
            "A walk to the gate.\n\nRead the article: https://blog.example.org/posts/episode-1/\n\nChapters\n00:00 Road\n00:42 Ash\n01:36 Gate\n\nAI assistance: Concept art was AI-assisted."
        );
        ok.description = " ".into();
        ok.chapters.clear();
        ok.ai_disclosure = None;
        assert_eq!(
            compose_description(&ok, "https://a.example.org/"),
            "Read the article: https://a.example.org/"
        );
    }

    #[test]
    fn tags_are_counted_as_youtube_counts_them() {
        assert_eq!(youtube_tags_chars(&[]), 0);
        // "animation" (9) + quoted "behind the scenes" (17 + 2) + one comma.
        assert_eq!(
            youtube_tags_chars(&["animation".into(), "behind the scenes".into()]),
            29
        );
    }

    #[test]
    fn chapters_follow_youtubes_rules() {
        let check = |body: &str, duration| {
            chapter_problems(&chapters(body), duration)
                .into_iter()
                .map(|p| p.code)
                .collect::<Vec<_>>()
        };
        assert!(check("", None).is_empty());
        assert!(check("00:00 A\n00:10 B\n00:20 C", Some(30)).is_empty());
        assert_eq!(
            check("00:05 A\n00:20 B", Some(60)),
            ["chapters-first-not-zero", "chapters-too-few"]
        );
        assert_eq!(
            check("00:00 A\n00:30 B\n00:20 C", Some(60)),
            ["chapters-out-of-order"]
        );
        assert_eq!(
            check("00:00 A\n00:09 B\n00:30 C", Some(60)),
            ["chapters-too-short"]
        );
        assert_eq!(
            check("00:00 A\n00:10 B\n00:20 C", Some(25)),
            ["chapters-too-short"]
        );
        assert_eq!(
            check("00:00 A\n00:10 B\n00:20 C", None),
            ["chapters-duration-missing"]
        );
    }

    #[test]
    fn a_ready_release_is_a_guided_workflow_under_the_youtube_manifest() {
        let mut ok = release();
        ok.title = "Episode one".into();
        let preview = youtube_preview(&ok, source(true), &good);
        assert_eq!(preview.status, Status::Manual);
        assert!(preview.problems.is_empty(), "{:?}", preview.problems);
        assert_eq!(
            codes(&preview.manual),
            ["capability-manual"; 4],
            "link, text, image and video are by hand"
        );
        assert!(preview.notes.is_empty());
        assert_eq!(preview.privacy, "private");
        assert_eq!(preview.policy_version, "2026-10-29");
        assert!(preview
            .description
            .contains("Read the article: https://blog.example.org/posts/episode-1/"));
        assert!(preview.steps[0].contains("media/episode-1.mp4"));
        assert!(preview
            .steps
            .iter()
            .any(|s| s.contains("media/episode-1.en.vtt")));
        assert!(preview.steps.last().unwrap().contains("Private"));
        let json = preview.to_json_value();
        assert_eq!(json["provider"], "youtube");
        assert_eq!(json["madeForKids"], false);
    }

    #[test]
    fn metadata_youtube_refuses_blocks_the_release_and_a_draft_article_is_a_note() {
        let mut long = release();
        long.title = "x".repeat(101);
        long.description = "y".repeat(5000);
        long.tags = (0..60).map(|i| format!("tag-number-{i}")).collect();
        let preview = youtube_preview(&long, source(false), &good);
        assert_eq!(preview.status, Status::Blocked);
        assert_eq!(
            codes(&preview.problems),
            ["title-too-long", "description-too-long", "tags-too-long"]
        );
        assert_eq!(codes(&preview.notes), ["article-not-public"]);
        let brackets = youtube_preview(&release(), source(true), &good);
        assert_eq!(codes(&brackets.problems), ["title-angle-brackets"]);
    }

    #[test]
    fn the_digest_binds_every_field_youtube_receives() {
        let base = youtube_preview(&release(), source(true), &good).digest;
        assert_eq!(
            base,
            youtube_preview(&release(), source(true), &good).digest
        );
        let changes: [fn(&mut VideoRelease); 9] = [
            |r| r.title.push('!'),
            |r| r.description.push('!'),
            |r| r.tags.push("more".into()),
            |r| r.thumbnail = None,
            |r| r.captions.clear(),
            |r| r.transcript = None,
            |r| r.consent.made_for_kids = Declared::Value(true),
            |r| r.consent.synthetic_media = Declared::Missing,
            |r| r.reference.file = Some("media/other.mp4".into()),
        ];
        for change in changes {
            let mut changed = release();
            change(&mut changed);
            assert_ne!(youtube_preview(&changed, source(true), &good).digest, base);
        }
        let mut moved = source(true);
        moved.canonical_url = "https://blog.example.org/posts/moved/";
        assert_ne!(youtube_preview(&release(), moved, &good).digest, base);
    }

    #[test]
    fn the_preview_page_is_static_escaped_and_labelled() {
        let preview = youtube_preview(&release(), source(false), &good);
        let page = preview_page(&preview, Some("thumbnail.png"));
        assert!(page.starts_with("<!doctype html>\n<html lang=\"en\">"));
        assert!(!page.contains("<script") && !page.contains("<form"));
        assert_eq!(page.matches("<h1>").count(), 1);
        assert!(page.contains("Episode &lt;one&gt;"));
        assert!(!page.contains("<b>there</b>"));
        assert!(page.contains(
            "<img src=\"thumbnail.png\" alt=\"The thumbnail chosen for Episode &lt;one&gt;\">"
        ));
        assert!(page.contains("(not live yet)"));
        assert!(page.contains("title-angle-brackets"));
        assert!(page.contains("<pre tabindex=\"0\" aria-label=\"Video description\">"));
        let without = preview_page(&preview, None);
        assert!(without.contains("is not in this folder"));
    }

    fn checked(
        release: &VideoRelease,
        probe: &dyn Fn(&AssetRef<'_>) -> AssetFacts,
    ) -> (Vec<String>, Vec<String>) {
        let folders = PublicFolders {
            static_dir: "static",
            output_dir: "dist",
        };
        let (problems, notes) = release_problems(release, &folders, probe);
        (
            problems.into_iter().map(|p| p.code).collect(),
            notes.into_iter().map(|p| p.code).collect(),
        )
    }

    #[test]
    fn a_complete_release_has_nothing_to_report() {
        assert_eq!(checked(&release(), &good), (vec![], vec![]));
    }

    #[test]
    fn the_media_source_must_be_a_private_video_file_or_a_youtube_address() {
        let mut r = release();
        r.reference = VideoReference::default();
        assert_eq!(checked(&r, &good).0, ["source-missing"]);
        r.reference.url = Some("https://vimeo.com/1".into());
        assert_eq!(checked(&r, &good).0, ["source-url-unsupported"]);
        r.reference = VideoReference {
            file: None,
            url: Some("https://youtu.be/dQw4w9WgXcQ".into()),
            youtube_id: Some("dQw4w9WgXcQ".into()),
        };
        assert!(
            checked(&r, &good).0.is_empty(),
            "an existing video needs no file"
        );
        for (file, code) in [
            ("../outside.mp4", "source-path-invalid"),
            ("/abs/video.mp4", "source-path-invalid"),
            ("C:/video.mp4", "source-path-invalid"),
            ("media\\video.mp4", "source-path-invalid"),
            ("media/video.mkv", "source-format-unsupported"),
            ("static/media/video.mp4", "source-public"),
            ("dist/video.mp4", "source-public"),
        ] {
            r.reference.file = Some(file.into());
            assert_eq!(checked(&r, &good).0, [code], "{file}");
        }
        r.reference.file = Some("statics/video.mp4".into());
        assert!(
            checked(&r, &good).0.is_empty(),
            "a sibling folder is not the static folder"
        );
        r.reference.file = Some("media/video.mp4".into());
        assert_eq!(
            checked(&r, &|_| AssetFacts::Missing).0[0],
            "source-not-found"
        );
        let text = |_: &AssetRef<'_>| AssetFacts::File {
            bytes: 5,
            head: b"hello".to_vec(),
        };
        assert_eq!(checked(&r, &text).0[0], "source-not-video");
        let huge = |asset: &AssetRef<'_>| match asset {
            AssetRef::Project(p) if p.ends_with(".mp4") => AssetFacts::File {
                bytes: YOUTUBE_VIDEO_MAX_BYTES + 1,
                head: Vec::new(),
            },
            other => good(other),
        };
        assert_eq!(checked(&r, &huge).0, ["source-too-large"]);
    }

    #[test]
    fn every_consent_answer_is_required_and_never_guessed() {
        let mut r = release();
        r.consent = Consent {
            rights: Declared::Missing,
            people: Declared::Invalid,
            made_for_kids: Declared::Missing,
            synthetic_media: Declared::Invalid,
        };
        assert_eq!(
            checked(&r, &good).0,
            [
                "consent-rights-missing",
                "consent-people-invalid",
                "consent-audience-missing",
                "consent-synthetic-invalid"
            ]
        );
        let preview = youtube_preview(&r, source(true), &good);
        assert_eq!(preview.status, Status::Blocked);
        assert_eq!(
            (preview.made_for_kids, preview.synthetic_media),
            (None, None)
        );
        assert!(preview
            .steps
            .iter()
            .any(|s| s.contains("the answer you declare in the post")));
    }

    #[test]
    fn a_video_needs_captions_or_a_transcript_and_each_caption_must_be_usable() {
        let mut r = release();
        r.captions.clear();
        assert!(
            checked(&r, &good).0.is_empty(),
            "a transcript alone is enough"
        );
        r.transcript = None;
        assert_eq!(checked(&r, &good).0, ["accessibility-no-text-alternative"]);
        r.transcript = transcript("## Transcript\nHello");
        r.captions = [
            "../x.en.vtt",
            "media/x.en.sbv",
            "media/x.vtt",
            "media/x.en.srt",
            "media/y.EN.vtt",
        ]
        .iter()
        .map(|p| CaptionTrack::from_path(p))
        .collect();
        assert_eq!(
            checked(&r, &good).0,
            [
                "caption-path-invalid",
                "caption-format-unsupported",
                "caption-language-missing",
                "caption-language-duplicate"
            ]
        );
        r.captions = vec![CaptionTrack::from_path("media/x.en.vtt")];
        let no_caption = |asset: &AssetRef<'_>| match asset {
            AssetRef::Project(p) if p.ends_with(".vtt") => AssetFacts::Missing,
            other => good(other),
        };
        assert_eq!(checked(&r, &no_caption).0, ["caption-not-found"]);
        let wrong = |asset: &AssetRef<'_>| match asset {
            AssetRef::Project(p) if p.ends_with(".vtt") => AssetFacts::File {
                bytes: 9,
                head: b"WEBVTTX\n".to_vec(),
            },
            other => good(other),
        };
        assert_eq!(checked(&r, &wrong).0, ["caption-unreadable"]);
        let latin1 = |asset: &AssetRef<'_>| match asset {
            AssetRef::Project(p) if p.ends_with(".vtt") => AssetFacts::File {
                bytes: 9,
                head: b"WEBVTT\n\xe9t\xe9".to_vec(),
            },
            other => good(other),
        };
        assert_eq!(checked(&r, &latin1).0, ["caption-unreadable"]);
        let bom_and_cut = |asset: &AssetRef<'_>| match asset {
            AssetRef::Project(p) if p.ends_with(".vtt") => AssetFacts::File {
                bytes: 99,
                head: b"\xef\xbb\xbfWEBVTT - Episode\n\n\xc3".to_vec(),
            },
            other => good(other),
        };
        assert!(checked(&r, &bom_and_cut).0.is_empty());
        let big = |asset: &AssetRef<'_>| match asset {
            AssetRef::Project(p) if p.ends_with(".vtt") => AssetFacts::File {
                bytes: YOUTUBE_CAPTION_MAX_BYTES + 1,
                head: Vec::new(),
            },
            other => good(other),
        };
        assert_eq!(checked(&r, &big).0, ["caption-too-large"]);
    }

    #[test]
    fn the_thumbnail_is_a_wide_enough_jpeg_or_png_in_the_static_folder() {
        let mut r = release();
        let with = |head: Vec<u8>| {
            move |asset: &AssetRef<'_>| match asset {
                AssetRef::Static(_) => AssetFacts::File {
                    bytes: head.len() as u64,
                    head: head.clone(),
                },
                other => good(other),
            }
        };
        assert_eq!(
            checked(&r, &with(png(320, 180))).0,
            ["thumbnail-too-narrow"]
        );
        assert_eq!(
            checked(&r, &with(png(1000, 1000))),
            (vec![], vec!["thumbnail-not-widescreen".to_string()])
        );
        assert_eq!(
            checked(&r, &with(b"GIF89a".to_vec())).0,
            ["thumbnail-unreadable"]
        );
        // A JPEG whose frame header follows an APP1 segment.
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00];
        jpeg.extend([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00]);
        assert_eq!(image_size(&jpeg), Some(("jpeg", 1280, 720)));
        assert!(checked(&r, &with(jpeg)).0.is_empty());
        assert_eq!(image_size(&[0xff, 0xd8, 0xff]), None);
        let big = |asset: &AssetRef<'_>| match asset {
            AssetRef::Static(_) => AssetFacts::File {
                bytes: YOUTUBE_THUMBNAIL_MAX_BYTES + 1,
                head: png(1280, 720),
            },
            other => good(other),
        };
        assert_eq!(checked(&r, &big).0, ["thumbnail-too-large"]);
        let missing = |asset: &AssetRef<'_>| match asset {
            AssetRef::Static(_) => AssetFacts::Missing,
            other => good(other),
        };
        assert_eq!(checked(&r, &missing).0, ["thumbnail-not-found"]);
        for (thumbnail, code) in [
            ("/images/a.gif", "thumbnail-format-unsupported"),
            ("images/a.png", "thumbnail-path-invalid"),
            ("/../a.png", "thumbnail-path-invalid"),
        ] {
            r.thumbnail = Some(thumbnail.into());
            assert_eq!(checked(&r, &good).0, [code], "{thumbnail}");
        }
        r.thumbnail = Some("https://cdn.example.org/a.png".into());
        assert_eq!(
            checked(&r, &good),
            (vec![], vec!["thumbnail-remote".to_string()])
        );
        r.thumbnail = None;
        assert_eq!(
            checked(&r, &good),
            (vec![], vec!["thumbnail-missing".to_string()])
        );
    }

    #[test]
    fn only_clean_relative_paths_are_ever_looked_up() {
        let asked = std::cell::RefCell::new(Vec::new());
        let mut r = release();
        r.reference.file = Some("../../etc/passwd.mp4".into());
        r.captions = vec![CaptionTrack::from_path("/etc/x.en.vtt")];
        r.thumbnail = Some("/../secret.png".into());
        let probe = |asset: &AssetRef<'_>| {
            asked.borrow_mut().push(format!("{asset:?}"));
            AssetFacts::Missing
        };
        let _ = checked(&r, &probe);
        assert!(asked.borrow().is_empty(), "{:?}", asked.borrow());
    }
}

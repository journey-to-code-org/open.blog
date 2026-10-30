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

use serde::Serialize;

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
}

//! Audio episode metadata shared by the publishing and presentation layers.
//!
//! This module defines the versioned media contract and validates its metadata. Reading authored
//! front matter, checking actual files and enforcing the transcript gate are separate concerns.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::frontmatter::{FrontMatter, Value};

/// The current audio metadata contract.
pub const AUDIO_VERSION: u32 = 1;
pub const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_TRANSCRIPT_BYTES: u64 = 4 * 1024 * 1024;
pub const AUDIO_HEADER_BYTES: u64 = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileEvidence {
    pub size_bytes: u64,
    pub bytes: Vec<u8>,
}

type ReadFile = dyn Fn(&str, u64) -> Result<FileEvidence, String> + Send + Sync;

#[derive(Clone)]
pub struct FileReader(std::sync::Arc<ReadFile>);

impl FileReader {
    pub fn new(
        read: impl Fn(&str, u64) -> Result<FileEvidence, String> + Send + Sync + 'static,
    ) -> Self {
        Self(std::sync::Arc::new(read))
    }

    fn read(&self, path: &str, limit: u64) -> Result<FileEvidence, String> {
        (self.0)(path, limit)
    }
}

impl std::fmt::Debug for FileReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FileReader(..)")
    }
}

impl PartialEq for FileReader {
    fn eq(&self, other: &Self) -> bool {
        std::sync::Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for FileReader {}

/// One encoding of an episode. `url` names the public audio resource and `size_bytes` is its
/// length in bytes, used for podcast enclosures.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioSource {
    pub url: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub size_bytes: u64,
}

/// A point in the episode. Times are seconds from the start.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioChapter {
    pub time_seconds: u32,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

/// An authored episode with one or more alternative encodings.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioEpisode {
    pub version: u32,
    pub duration_seconds: u32,
    pub sources: Vec<AudioSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub episode_number: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_number: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chapters: Vec<AudioChapter>,
}

/// Read the versioned audio block without discarding malformed or unknown fields.
pub fn from_front_matter(fm: &FrontMatter) -> Result<Option<AudioEpisode>, Vec<String>> {
    let fields = &fm.fields;
    if !fields
        .keys()
        .any(|key| key == "audio" || key.starts_with("audio."))
    {
        return Ok(None);
    }
    let mut errors = Vec::new();
    if fields.contains_key("audio") {
        errors.push("audio must be a mapping with version, durationSeconds and sources".into());
    }
    let number = |name: &str, errors: &mut Vec<String>| match fields.get(name) {
        Some(Value::Scalar(value)) => match value.parse::<u32>() {
            Ok(value) => value,
            Err(_) => {
                errors.push(format!("{name} must be a nonnegative integer"));
                0
            }
        },
        _ => {
            errors.push(format!("{name} is required"));
            0
        }
    };
    let version = number("audio.version", &mut errors);
    let duration_seconds = number("audio.durationSeconds", &mut errors);
    let mut sources: std::collections::BTreeMap<usize, AudioSource> = Default::default();
    let mut chapters: std::collections::BTreeMap<usize, AudioChapter> = Default::default();
    for (key, value) in fields.iter().filter(|(key, _)| key.starts_with("audio.")) {
        if matches!(
            key.as_str(),
            "audio.version"
                | "audio.durationSeconds"
                | "audio.transcript"
                | "audio.episodeNumber"
                | "audio.seasonNumber"
        ) {
            continue;
        }
        if matches!(key.as_str(), "audio.sources" | "audio.chapters") {
            if !matches!(value, Value::List(items) if items.is_empty()) {
                errors.push(format!("{key} must be a list of mappings"));
            }
            continue;
        }
        let Some((kind, rest)) = key["audio.".len()..].split_once('.') else {
            errors.push(format!("unknown audio field `{key}`"));
            continue;
        };
        let Some((index, name)) = rest.split_once('.') else {
            errors.push(format!("unknown audio field `{key}`"));
            continue;
        };
        let Ok(index) = index.parse::<usize>() else {
            errors.push(format!("invalid audio entry `{key}`"));
            continue;
        };
        if !(1..=100).contains(&index) {
            errors.push(format!("invalid audio entry `{key}`"));
            continue;
        }
        let Value::Scalar(value) = value else {
            errors.push(format!("{key} must be a scalar"));
            continue;
        };
        match (kind, name) {
            ("sources", "url" | "type" | "sizeBytes") => {
                let source = sources.entry(index).or_insert_with(|| AudioSource {
                    url: String::new(),
                    media_type: String::new(),
                    size_bytes: 0,
                });
                match name {
                    "url" => source.url.clone_from(value),
                    "type" => source.media_type.clone_from(value),
                    "sizeBytes" => match value.parse() {
                        Ok(size) => source.size_bytes = size,
                        Err(_) => errors.push(format!("{key} must be a nonnegative integer")),
                    },
                    _ => unreachable!(),
                }
            }
            ("chapters", "timeSeconds" | "title" | "link") => {
                let chapter = chapters.entry(index).or_insert_with(|| AudioChapter {
                    time_seconds: 0,
                    title: String::new(),
                    link: None,
                });
                match name {
                    "timeSeconds" => match value.parse() {
                        Ok(time) => chapter.time_seconds = time,
                        Err(_) => errors.push(format!("{key} must be a nonnegative integer")),
                    },
                    "title" => chapter.title.clone_from(value),
                    "link" => chapter.link = Some(value.clone()),
                    _ => unreachable!(),
                }
            }
            _ => errors.push(format!("unknown audio field `{key}`")),
        }
    }
    for index in chapters.keys() {
        if !fields.contains_key(&format!("audio.chapters.{index}.timeSeconds")) {
            errors.push(format!("audio.chapters.{index}.timeSeconds is required"));
        }
    }
    for (name, indices) in [
        ("sources", sources.keys().copied().collect::<Vec<_>>()),
        ("chapters", chapters.keys().copied().collect::<Vec<_>>()),
    ] {
        if indices.iter().copied().ne(1..=indices.len()) {
            errors.push(format!("audio.{name} entries must be consecutive"));
        }
    }
    let episode = AudioEpisode {
        version,
        duration_seconds,
        sources: sources.into_values().collect(),
        transcript: match fields.get("audio.transcript") {
            None => None,
            Some(Value::Scalar(value)) if !value.is_empty() => Some(value.clone()),
            Some(_) => {
                errors.push("audio.transcript must be a nonempty file path".into());
                None
            }
        },
        episode_number: fields
            .get("audio.episodeNumber")
            .map(|_| number("audio.episodeNumber", &mut errors)),
        season_number: fields
            .get("audio.seasonNumber")
            .map(|_| number("audio.seasonNumber", &mut errors)),
        chapters: chapters.into_values().collect(),
    };
    if errors.is_empty() {
        Ok(Some(episode))
    } else {
        Err(errors)
    }
}

/// Validate the authored episode and host-provided file evidence before rendering it.
pub fn prepare(
    fm: &FrontMatter,
    markdown: &str,
    reader: Option<&FileReader>,
) -> Result<Option<AudioEpisode>, Vec<String>> {
    let Some(episode) = from_front_matter(fm)? else {
        return Ok(None);
    };
    let mut errors = episode.validate(MAX_SOURCE_BYTES).err().unwrap_or_default();
    if errors.is_empty() {
        for source in &episode.sources {
            if !source.url.starts_with('/') {
                errors.push(format!(
                    "audio source {}: remote files cannot be verified; use a local static file",
                    source.url
                ));
                continue;
            }
            let evidence = reader
                .ok_or_else(|| "audio file verification is unavailable".to_string())
                .and_then(|reader| reader.read(&source.url, AUDIO_HEADER_BYTES));
            let result = match &evidence {
                Ok(file) => source.validate_file(
                    Ok(SourceFile {
                        size_bytes: file.size_bytes,
                        header: &file.bytes,
                    }),
                    MAX_SOURCE_BYTES,
                ),
                Err(error) => source.validate_file(Err(error), MAX_SOURCE_BYTES),
            };
            if let Err(error) = result {
                errors.push(error);
            }
        }
    }
    let transcript_evidence = episode.transcript.as_deref().map(|path| {
        if !path.starts_with('/') || !valid_source_url(path) {
            return Err("invalid transcript file path".to_string());
        }
        reader
            .ok_or_else(|| "transcript file verification is unavailable".to_string())
            .and_then(|reader| reader.read(path, MAX_TRANSCRIPT_BYTES))
    });
    let transcript = episode
        .transcript
        .as_deref()
        .zip(transcript_evidence.as_ref())
        .map(|(path, result)| {
            let contents = result.as_ref().map_err(String::as_str).and_then(|file| {
                if file.size_bytes > MAX_TRANSCRIPT_BYTES
                    || file.size_bytes != file.bytes.len() as u64
                {
                    return Err(
                        "transcript file exceeds its limit or could not be read completely",
                    );
                }
                std::str::from_utf8(&file.bytes).map_err(|_| "transcript file is not valid UTF-8")
            });
            TranscriptFile { path, contents }
        });
    if let Err(error) = validate_transcript(markdown, transcript) {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(Some(episode))
    } else {
        Err(errors)
    }
}

/// Evidence for one local source, obtained by the host from the file it will publish.
pub struct SourceFile<'a> {
    pub size_bytes: u64,
    pub header: &'a [u8],
}

impl AudioSource {
    /// Check a local source against its declared size and media type. A header is a format
    /// signature, not proof that the entire file can be decoded.
    pub fn validate_file(
        &self,
        file: Result<SourceFile<'_>, &str>,
        max_source_bytes: u64,
    ) -> Result<(), String> {
        let file = file.map_err(|error| format!("audio source {}: {error}", self.url))?;
        if file.size_bytes == 0 || file.size_bytes > max_source_bytes {
            return Err(format!(
                "audio source {}: file size must be between 1 and {max_source_bytes} bytes",
                self.url
            ));
        }
        if file.size_bytes != self.size_bytes {
            return Err(format!(
                "audio source {}: declared size {} does not match file size {}",
                self.url, self.size_bytes, file.size_bytes
            ));
        }
        let header = file.header;
        let matches = match self.media_type.as_str() {
            "audio/mpeg" => {
                header.starts_with(b"ID3")
                    || header
                        .get(..2)
                        .is_some_and(|bytes| bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
            }
            "audio/ogg" => {
                header.starts_with(b"OggS")
                    && [
                        b"OpusHead".as_slice(),
                        b"\x01vorbis".as_slice(),
                        b"\x7fFLAC".as_slice(),
                    ]
                    .iter()
                    .any(|signature| {
                        header
                            .windows(signature.len())
                            .any(|bytes| bytes == *signature)
                    })
            }
            "audio/wav" | "audio/wave" | "audio/x-wav" => {
                header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WAVE")
            }
            "audio/flac" => header.starts_with(b"fLaC"),
            "audio/webm" => {
                header.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
                    && [b"A_OPUS".as_slice(), b"A_VORBIS".as_slice()]
                        .iter()
                        .any(|signature| {
                            header
                                .windows(signature.len())
                                .any(|part| part == *signature)
                        })
            }
            "audio/mp4" => {
                header.get(4..8) == Some(b"ftyp")
                    && matches!(header.get(8..12), Some(b"M4A " | b"M4B " | b"M4P "))
            }
            _ => {
                return Err(format!(
                    "audio source {}: cannot verify unsupported type {}",
                    self.url, self.media_type
                ))
            }
        };
        if !matches {
            return Err(format!(
                "audio source {}: file does not match declared type {}",
                self.url, self.media_type
            ));
        }
        Ok(())
    }
}

/// A transcript file and the result of reading it. The caller must pass the read error rather
/// than treating an unreadable authored file as absent.
pub struct TranscriptFile<'a> {
    pub path: &'a str,
    pub contents: Result<&'a str, &'a str>,
}

/// Check a transcript section or an explicitly supplied transcript file. This does not open files
/// or enforce publication: callers must obtain the file and apply the result at their boundary.
pub fn validate_transcript(markdown: &str, file: Option<TranscriptFile<'_>>) -> Result<(), String> {
    if let Some(file) = file {
        if !file.path.starts_with('/') || !valid_source_url(file.path) {
            return Err("audio transcript file must be a site-relative path".into());
        }
        let is_text = file.path.to_ascii_lowercase().ends_with(".txt");
        let is_vtt = file.path.to_ascii_lowercase().ends_with(".vtt");
        if !is_text && !is_vtt {
            return Err("audio transcript file must end in .txt or .vtt".into());
        }
        let contents = file
            .contents
            .map_err(|error| format!("audio transcript file could not be read: {error}"))?;
        let contents = contents.trim_start_matches('\u{feff}').trim();
        if is_vtt {
            let mut lines = contents.lines();
            let header = lines.next().unwrap_or("");
            if header != "WEBVTT"
                && !header
                    .strip_prefix("WEBVTT")
                    .is_some_and(|suffix| suffix.starts_with([' ', '\t']))
            {
                return Err("audio transcript .vtt file must start with WEBVTT".into());
            }
            if !vtt_has_cue(lines.collect::<Vec<_>>().as_slice()) {
                return Err("audio transcript .vtt file needs a timed cue with text".into());
            }
        } else if contents.is_empty() {
            return Err("audio transcript file must not be empty".into());
        }
        return Ok(());
    }
    let has_words = crate::video_release::transcript(markdown).is_some_and(|transcript| {
        pulldown_cmark::Parser::new(&transcript.markdown).any(|event| match event {
            pulldown_cmark::Event::Text(text) | pulldown_cmark::Event::Code(text) => {
                !text.trim().is_empty()
            }
            _ => false,
        })
    });
    if has_words {
        Ok(())
    } else {
        Err("audio needs a nonempty Transcript section or a .txt or .vtt transcript file".into())
    }
}

fn vtt_has_cue(lines: &[&str]) -> bool {
    for block in lines.split(|line| line.trim().is_empty()) {
        if block.is_empty()
            || block[0].starts_with("NOTE")
            || block[0] == "STYLE"
            || block[0] == "REGION"
        {
            continue;
        }
        let timing = if block[0].contains("-->") { 0 } else { 1 };
        let Some(line) = block.get(timing) else {
            continue;
        };
        let Some((start, end)) = line.split_once("-->") else {
            continue;
        };
        let Some(start) = vtt_timestamp(start.trim()) else {
            continue;
        };
        let Some(end) = end.split_whitespace().next().and_then(vtt_timestamp) else {
            continue;
        };
        if start < end
            && block[timing + 1..]
                .iter()
                .any(|line| line.chars().any(|character| character.is_alphanumeric()))
        {
            return true;
        }
    }
    false
}

fn vtt_timestamp(value: &str) -> Option<u64> {
    let (clock, milliseconds) = value.split_once('.')?;
    if milliseconds.len() != 3 || !milliseconds.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let parts: Vec<_> = clock.split(':').collect();
    let number = |part: &str| {
        (!part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| part.parse::<u64>().ok())
            .flatten()
    };
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] if minutes.len() >= 2 && seconds.len() == 2 => {
            (0, number(minutes)?, number(seconds)?)
        }
        [hours, minutes, seconds]
            if hours.len() >= 2 && minutes.len() == 2 && seconds.len() == 2 =>
        {
            let minutes = number(minutes)?;
            if minutes >= 60 {
                return None;
            }
            (number(hours)?, minutes, number(seconds)?)
        }
        _ => return None,
    };
    if seconds >= 60 {
        return None;
    }
    hours
        .checked_mul(3600)?
        .checked_add(minutes.checked_mul(60)?)?
        .checked_add(seconds)?
        .checked_mul(1000)?
        .checked_add(number(milliseconds)?)
}

impl AudioEpisode {
    /// Validate metadata without fetching or opening any media. The caller supplies its size limit
    /// and must separately check local files and transcript availability before publication.
    pub fn validate(&self, max_source_bytes: u64) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        if self.version != AUDIO_VERSION {
            errors.push(format!(
                "audio.version must be {AUDIO_VERSION}, not {}",
                self.version
            ));
        }
        if self.duration_seconds == 0 {
            errors.push("audio.durationSeconds must be greater than zero".to_string());
        }
        if self.sources.is_empty() {
            errors.push("audio.sources must include at least one audio source".to_string());
        }
        if self.episode_number == Some(0) || self.season_number == Some(0) {
            errors.push("audio episodeNumber and seasonNumber must be greater than zero".into());
        }
        let mut seen = BTreeSet::new();
        for (index, source) in self.sources.iter().enumerate() {
            let field = format!("audio.sources[{}]", index + 1);
            if !valid_source_url(&source.url) {
                errors.push(format!(
                    "{field}.url must be a site-relative path or an HTTPS URL without credentials or a fragment"
                ));
            }
            if !seen.insert(source.url.as_str()) {
                errors.push(format!("{field}.url duplicates another audio source"));
            }
            if !valid_audio_type(&source.media_type) {
                errors.push(format!(
                    "{field}.type must be a valid audio media type, such as audio/mpeg"
                ));
            }
            if source.size_bytes == 0 || source.size_bytes > max_source_bytes {
                errors.push(format!(
                    "{field}.sizeBytes must be between 1 and {max_source_bytes}"
                ));
            }
        }
        let mut previous = None;
        for (index, chapter) in self.chapters.iter().enumerate() {
            let field = format!("audio.chapters[{}]", index + 1);
            if chapter.time_seconds >= self.duration_seconds {
                errors.push(format!(
                    "{field}.timeSeconds must be before the episode ends"
                ));
            }
            if previous.is_some_and(|time| chapter.time_seconds <= time) {
                errors.push(format!(
                    "{field}.timeSeconds must be later than the previous chapter"
                ));
            }
            previous = Some(chapter.time_seconds);
            if chapter.title.trim().is_empty() || chapter.title.chars().any(char::is_control) {
                errors.push(format!("{field}.title must be nonempty text on one line"));
            }
            if chapter
                .link
                .as_deref()
                .is_some_and(|link| !crate::landing::safe_address(link, false))
            {
                errors.push(format!("{field}.link must be a safe link"));
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

fn valid_audio_type(value: &str) -> bool {
    let Some(subtype) = value.strip_prefix("audio/") else {
        return false;
    };
    !subtype.is_empty()
        && subtype.len() <= 127
        && subtype.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                )
        })
}

fn valid_source_url(value: &str) -> bool {
    if value.trim() != value
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
        || value.contains('\\')
    {
        return false;
    }
    if value.starts_with('/') {
        if value.starts_with("//") || value.contains(['?', '#', '%', ':']) {
            return false;
        }
        return value.len() > 1
            && value
                .split('/')
                .skip(1)
                .all(|segment| !segment.is_empty() && segment != "." && segment != "..");
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn episode() -> AudioEpisode {
        AudioEpisode {
            version: AUDIO_VERSION,
            duration_seconds: 90,
            transcript: None,
            episode_number: None,
            season_number: None,
            sources: vec![
                AudioSource {
                    url: "/audio/episode.mp3".into(),
                    media_type: "audio/mpeg".into(),
                    size_bytes: 4096,
                },
                AudioSource {
                    url: "https://media.example/episode.ogg".into(),
                    media_type: "audio/ogg".into(),
                    size_bytes: 2048,
                },
            ],
            chapters: Vec::new(),
        }
    }

    #[test]
    fn authored_audio_maps_are_read_without_discarding_unknown_or_missing_fields() {
        let text = "---\naudio:\n  version: 1\n  durationSeconds: 90\n  sources:\n    - url: /audio/episode.mp3\n      type: audio/mpeg\n      sizeBytes: 4096\n  chapters:\n    - timeSeconds: 0\n      title: Intro\n---\nBody";
        let doc = crate::frontmatter::parse(text).unwrap();
        let episode = from_front_matter(&doc.front_matter).unwrap().unwrap();
        assert_eq!(episode.validate(4096), Ok(()));
        assert_eq!(episode.chapters[0].title, "Intro");
        let invalid = text.replace(
            "    - timeSeconds: 0\n      title: Intro",
            "    - title: Intro\n      extra: ignored",
        );
        let doc = crate::frontmatter::parse(&invalid).unwrap();
        let errors = from_front_matter(&doc.front_matter).unwrap_err().join("\n");
        assert!(errors.contains("timeSeconds is required"), "{errors}");
        assert!(errors.contains("unknown audio field"), "{errors}");
        assert_eq!(from_front_matter(&FrontMatter::default()), Ok(None));
    }

    #[test]
    fn versioned_metadata_round_trips_and_validates() {
        let episode = episode();
        let json = serde_json::to_string(&episode).unwrap();
        assert!(json.contains(r#""type":"audio/mpeg""#));
        assert_eq!(
            serde_json::from_str::<AudioEpisode>(&json).unwrap(),
            episode
        );
        assert_eq!(episode.validate(4096), Ok(()));
    }

    #[test]
    fn invalid_fields_report_actionable_errors_together() {
        let mut episode = episode();
        episode.version = 2;
        episode.duration_seconds = 0;
        episode.sources[0].url = "//example.test/file.mp3".into();
        episode.sources[0].media_type = "text/html".into();
        episode.sources[0].size_bytes = 0;
        episode.sources[1] = episode.sources[0].clone();
        let errors = episode.validate(100).unwrap_err().join("\n");
        for field in [
            "audio.version",
            "audio.durationSeconds",
            "audio.sources[1].url",
            "audio.sources[1].type",
            "audio.sources[1].sizeBytes",
            "audio.sources[2].url duplicates",
        ] {
            assert!(errors.contains(field), "{field}: {errors}");
        }
        episode.sources.clear();
        assert!(episode
            .validate(100)
            .unwrap_err()
            .iter()
            .any(|error| error.contains("at least one")));
    }

    #[test]
    fn media_urls_are_bounded_to_public_paths_or_https() {
        for invalid in [
            "",
            "/",
            "//example.test/file",
            "/audio/../private.mp3",
            "/audio/%2e%2e/private.mp3",
            "/audio//file.mp3",
            "/audio/file.mp3?tracking=1",
            "http://example.test/file",
            "https://user:pass@example.test/file",
            "https://example.test/file#fragment",
            "javascript:alert(1)",
        ] {
            assert!(!valid_source_url(invalid), "{invalid}");
        }
        for valid in [
            "/audio/episode.mp3",
            "https://media.example/episode.mp3",
            "https://media.example/episode.mp3?version=1",
        ] {
            assert!(valid_source_url(valid), "{valid}");
        }
    }

    #[test]
    fn media_types_and_size_limits_are_checked() {
        for invalid in [
            "",
            "video/mp4",
            "audio/",
            "audio/mpeg; charset=utf-8",
            "audio/x y",
        ] {
            assert!(!valid_audio_type(invalid), "{invalid}");
        }
        for valid in [
            "audio/mpeg",
            "audio/mp4",
            "audio/ogg",
            "audio/vnd.example+json",
        ] {
            assert!(valid_audio_type(valid), "{valid}");
        }
        assert!(episode().validate(4095).is_err());
        assert!(episode().validate(0).is_err());
    }

    #[test]
    fn unknown_fields_are_not_silently_discarded() {
        let json = r#"{"version":1,"durationSeconds":1,"sources":[],"unknown":true}"#;
        assert!(serde_json::from_str::<AudioEpisode>(json).is_err());
        let json = r#"{"version":1,"durationSeconds":1,"sources":[{"url":"/x","type":"audio/mpeg","sizeBytes":1,"unknown":true}]}"#;
        assert!(serde_json::from_str::<AudioEpisode>(json).is_err());
    }

    #[test]
    fn chapters_are_ordered_within_the_episode_and_have_safe_labels_and_links() {
        let mut episode = episode();
        episode.chapters = vec![
            AudioChapter {
                time_seconds: 0,
                title: "Introduction".into(),
                link: Some("/notes/".into()),
            },
            AudioChapter {
                time_seconds: 89,
                title: "Conclusion".into(),
                link: None,
            },
        ];
        assert_eq!(episode.validate(4096), Ok(()));
        let json = serde_json::to_string(&episode).unwrap();
        assert_eq!(
            serde_json::from_str::<AudioEpisode>(&json).unwrap(),
            episode
        );

        episode.chapters[0].title = " \n".into();
        episode.chapters[0].link = Some("javascript:alert(1)".into());
        episode.chapters[1].time_seconds = 0;
        let errors = episode.validate(4096).unwrap_err().join("\n");
        assert!(errors.contains("audio.chapters[1].title"), "{errors}");
        assert!(errors.contains("audio.chapters[1].link"), "{errors}");
        assert!(errors.contains("audio.chapters[2].timeSeconds"), "{errors}");
        episode.chapters[1].time_seconds = 90;
        assert!(episode
            .validate(4096)
            .unwrap_err()
            .iter()
            .any(|error| error.contains("before the episode ends")));
    }

    #[test]
    fn transcript_section_or_readable_transcript_file_is_required() {
        assert!(validate_transcript("## Transcript\n\nThe episode words.\n", None).is_ok());
        assert!(validate_transcript("## Transcript\n\n## Credits\n\nSomeone", None).is_err());
        assert!(validate_transcript("```md\n## Transcript\nfake\n```", None).is_err());
        assert!(validate_transcript("## Transcript\n\n<!-- no words -->", None).is_err());

        for (path, contents) in [
            ("/audio/episode.txt", "The episode words."),
            (
                "/audio/episode.vtt",
                "WEBVTT\n\n00:00.000 --> 00:01.000\nHello",
            ),
        ] {
            assert!(validate_transcript(
                "",
                Some(TranscriptFile {
                    path,
                    contents: Ok(contents),
                })
            )
            .is_ok());
        }
    }

    #[test]
    fn authored_transcript_files_must_be_safe_readable_and_nonempty() {
        for (path, contents, expected) in [
            ("https://example.test/a.txt", Ok("hello"), "site-relative"),
            ("/a.pdf", Ok("hello"), ".txt or .vtt"),
            ("/a.txt", Err("not found"), "not found"),
            ("/a.txt", Ok("  "), "must not be empty"),
            ("/a.vtt", Ok("not WebVTT"), "start with WEBVTT"),
            ("/a.vtt", Ok("WEBVTT\n\n"), "needs a timed cue"),
            (
                "/a.vtt",
                Ok("WEBVTT\n\nNOTE\nNo spoken text"),
                "needs a timed cue",
            ),
            (
                "/a.vtt",
                Ok("WEBVTT\n\n00:01.000 --> 00:00.000\nText"),
                "needs a timed cue",
            ),
            (
                "/a.vtt",
                Ok("WEBVTT\n\n00:00.000 --> 00:01.000\n"),
                "needs a timed cue",
            ),
        ] {
            let error = validate_transcript(
                "## Transcript\nText",
                Some(TranscriptFile { path, contents }),
            )
            .unwrap_err();
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn file_evidence_checks_size_type_and_read_errors() {
        let mut source = episode().sources.remove(0);
        let file = |size_bytes, header| Ok(SourceFile { size_bytes, header });
        assert!(source.validate_file(file(4096, b"ID3\x04\0"), 4096).is_ok());
        assert!(source
            .validate_file(file(4095, b"ID3"), 4096)
            .unwrap_err()
            .contains("does not match file size"));
        assert!(source
            .validate_file(file(4096, b"<html>"), 4096)
            .unwrap_err()
            .contains("does not match declared type"));
        assert!(source
            .validate_file(file(4096, b"ID3"), 4095)
            .unwrap_err()
            .contains("file size"));
        assert!(source
            .validate_file(Err("not found"), 4096)
            .unwrap_err()
            .contains("not found"));
        for (media_type, header) in [
            ("audio/mpeg", b"\xff\xfb\0\0\0\0\0\0\0\0\0\0".as_slice()),
            ("audio/ogg", b"OggS\0\0\0\0OpusHead".as_slice()),
            ("audio/wav", b"RIFF\0\0\0\0WAVE".as_slice()),
            ("audio/flac", b"fLaC\0\0\0\0\0\0\0\0".as_slice()),
            ("audio/mp4", b"\0\0\0\x18ftypM4A ".as_slice()),
            ("audio/webm", b"\x1a\x45\xdf\xa3\0\0A_OPUS".as_slice()),
        ] {
            source.media_type = media_type.into();
            assert!(
                source.validate_file(file(4096, header), 4096).is_ok(),
                "{media_type}"
            );
            assert!(
                source.validate_file(file(4096, b""), 4096).is_err(),
                "{media_type}"
            );
        }
        source.media_type = "audio/webm".into();
        assert!(source
            .validate_file(file(4096, b"\x1a\x45\xdf\xa3V_VP9"), 4096)
            .is_err());
        source.media_type = "audio/unknown".into();
        assert!(source
            .validate_file(file(4096, b"anything"), 4096)
            .unwrap_err()
            .contains("unsupported type"));
    }
}

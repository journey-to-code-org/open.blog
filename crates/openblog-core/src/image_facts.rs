//! The few facts a destination checks about an image file, read from its header without
//! decoding a pixel or adding a dependency: the format, the displayed width and height, the
//! size in bytes, and whether it carries an Exif GPS record (story #393, ADR 0782).
//!
//! JPEG, PNG, GIF and WebP are read. Anything else, or a header that does not hold together,
//! is `None`, never a guess.

use serde::Serialize;

/// The image formats open.blog can read the header of.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MediaType {
    Jpeg,
    Png,
    Gif,
    Webp,
}

impl MediaType {
    pub fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Gif => "gif",
            Self::Webp => "webp",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Jpeg => "JPEG",
            Self::Png => "PNG",
            Self::Gif => "GIF",
            Self::Webp => "WebP",
        }
    }
}

/// What a header says about an image.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFacts {
    pub media_type: MediaType,
    /// As displayed: a JPEG whose Exif orientation turns it a quarter has its sides swapped.
    pub width: u32,
    pub height: u32,
    /// The whole file's size.
    pub bytes: u64,
    /// The file carries an Exif GPS record: where the photograph was taken may travel with it.
    pub location_metadata: bool,
}

/// How much of a file is enough to find its header, its Exif record and a JPEG's frame size.
pub const HEADER_BYTES: usize = 1024 * 1024;

/// Reads the facts from the start of a file (`prefix`, at least the first [`HEADER_BYTES`] or
/// the whole file) whose full size is `total_bytes`.
pub fn read(prefix: &[u8], total_bytes: u64) -> Option<ImageFacts> {
    let (media_type, width, height, location_metadata) = if prefix.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        png(prefix)?
    } else if prefix.starts_with(b"\xff\xd8") {
        jpeg(prefix)?
    } else if prefix.starts_with(b"GIF87a") || prefix.starts_with(b"GIF89a") {
        let width = u32::from(u16_le(prefix, 6)?);
        let height = u32::from(u16_le(prefix, 8)?);
        (MediaType::Gif, width, height, false)
    } else if prefix.len() >= 12 && &prefix[0..4] == b"RIFF" && &prefix[8..12] == b"WEBP" {
        webp(prefix)?
    } else {
        return None;
    };
    (width > 0 && height > 0).then_some(ImageFacts {
        media_type,
        width,
        height,
        bytes: total_bytes,
        location_metadata,
    })
}

fn png(data: &[u8]) -> Option<(MediaType, u32, u32, bool)> {
    if data.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32_be(data, 16)?;
    let height = u32_be(data, 20)?;
    // Walk the chunks for an `eXIf` record before the image data.
    let mut gps = false;
    let mut at = 8usize;
    while let Some(length) = u32_be(data, at) {
        let kind = data.get(at + 4..at + 8)?;
        let start = at + 8;
        let end = start.checked_add(length as usize)?;
        if kind == b"eXIf" {
            gps = data.get(start..end).is_some_and(|exif| tiff_facts(exif).0);
        }
        if kind == b"IDAT" || kind == b"IEND" {
            break;
        }
        at = end.checked_add(4)?;
    }
    Some((MediaType::Png, width, height, gps))
}

fn jpeg(data: &[u8]) -> Option<(MediaType, u32, u32, bool)> {
    let mut at = 2usize;
    let mut gps = false;
    let mut quarter_turn = false;
    loop {
        // Markers may be padded with any number of 0xFF bytes.
        while *data.get(at)? == 0xff && *data.get(at + 1)? == 0xff {
            at += 1;
        }
        if *data.get(at)? != 0xff {
            return None;
        }
        let marker = *data.get(at + 1)?;
        at += 2;
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        let length = usize::from(u16_be(data, at)?);
        if length < 2 {
            return None;
        }
        let body = data.get(at + 2..at + length);
        match marker {
            0xe1 => {
                if let Some(exif) = body.and_then(|b| b.strip_prefix(b"Exif\0\0")) {
                    let (has_gps, turned) = tiff_facts(exif);
                    gps |= has_gps;
                    quarter_turn |= turned;
                }
            }
            0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf => {
                let height = u32::from(u16_be(data, at + 3)?);
                let width = u32::from(u16_be(data, at + 5)?);
                let (width, height) = if quarter_turn {
                    (height, width)
                } else {
                    (width, height)
                };
                return Some((MediaType::Jpeg, width, height, gps));
            }
            _ => {}
        }
        at += length;
    }
}

fn webp(data: &[u8]) -> Option<(MediaType, u32, u32, bool)> {
    let mut at = 12usize;
    let mut size = None;
    let mut gps = false;
    while let Some(kind) = data.get(at..at + 4) {
        let length = u32_le(data, at + 4)? as usize;
        let start = at + 8;
        match kind {
            b"VP8 " => {
                // Frame tag (3 bytes) and start code (3 bytes), then 14-bit sizes.
                if data.get(start + 3..start + 6)? != [0x9d, 0x01, 0x2a] {
                    return None;
                }
                let width = u32::from(u16_le(data, start + 6)? & 0x3fff);
                let height = u32::from(u16_le(data, start + 8)? & 0x3fff);
                size.get_or_insert((width, height));
            }
            b"VP8L" => {
                if *data.get(start)? != 0x2f {
                    return None;
                }
                let b = data.get(start + 1..start + 5)?;
                let width = 1 + (u32::from(b[1] & 0x3f) << 8 | u32::from(b[0]));
                let height = 1
                    + (u32::from(b[3] & 0x0f) << 10
                        | u32::from(b[2]) << 2
                        | u32::from(b[1] & 0xc0) >> 6);
                size.get_or_insert((width, height));
            }
            b"VP8X" => {
                let width = 1 + u24_le(data, start + 4)?;
                let height = 1 + u24_le(data, start + 7)?;
                size = Some((width, height));
            }
            b"EXIF" => {
                gps |= data
                    .get(start..start.checked_add(length)?)
                    .is_some_and(|exif| {
                        tiff_facts(exif.strip_prefix(b"Exif\0\0").unwrap_or(exif)).0
                    });
            }
            _ => {}
        }
        // Chunks are padded to an even length.
        at = start.checked_add(length)?.checked_add(length & 1)?;
    }
    let (width, height) = size?;
    Some((MediaType::Webp, width, height, gps))
}

/// From a TIFF-structured Exif record: whether its first directory points to GPS data, and
/// whether its orientation turns the picture a quarter (values 5 to 8).
fn tiff_facts(tiff: &[u8]) -> (bool, bool) {
    let little = match tiff.get(0..4) {
        Some(b"II*\0") => true,
        Some(b"MM\0*") => false,
        _ => return (false, false),
    };
    let read16 = |at: usize| {
        if little {
            u16_le(tiff, at)
        } else {
            u16_be(tiff, at)
        }
    };
    let read32 = |at: usize| {
        if little {
            u32_le(tiff, at)
        } else {
            u32_be(tiff, at)
        }
    };
    let Some(directory) = read32(4).map(|offset| offset as usize) else {
        return (false, false);
    };
    let Some(count) = read16(directory) else {
        return (false, false);
    };
    let mut gps = false;
    let mut turned = false;
    for entry in 0..usize::from(count) {
        let at = directory + 2 + entry * 12;
        let Some(tag) = read16(at) else { break };
        match tag {
            0x8825 => gps = true,
            0x0112 => turned = read16(at + 8).is_some_and(|value| (5..=8).contains(&value)),
            _ => {}
        }
    }
    (gps, turned)
}

fn u16_le(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn u16_be(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(data.get(at..at + 2)?.try_into().ok()?))
}

fn u32_le(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

fn u32_be(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(data.get(at..at + 4)?.try_into().ok()?))
}

fn u24_le(data: &[u8], at: usize) -> Option<u32> {
    let b = data.get(at..at + 3)?;
    Some(u32::from(b[0]) | u32::from(b[1]) << 8 | u32::from(b[2]) << 16)
}

/// Minimal, valid-header images for tests here and in the CLI.
#[doc(hidden)]
pub mod samples {
    /// A PNG header (signature and IHDR) of the given size, optionally with an `eXIf` chunk
    /// holding a GPS pointer.
    pub fn png(width: u32, height: u32, gps: bool) -> Vec<u8> {
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&width.to_be_bytes());
        ihdr.extend_from_slice(&height.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        chunk(&mut out, b"IHDR", &ihdr);
        if gps {
            chunk(&mut out, b"eXIf", &tiff(true, &[(0x8825, 0)]));
        }
        chunk(&mut out, b"IDAT", &[0]);
        chunk(&mut out, b"IEND", &[]);
        out
    }

    /// A JPEG with an Exif record (optional GPS pointer and orientation) and a baseline frame.
    pub fn jpeg(width: u16, height: u16, gps: bool, orientation: u16) -> Vec<u8> {
        let mut out = vec![0xff, 0xd8];
        let mut entries = Vec::new();
        if orientation > 0 {
            entries.push((0x0112, orientation));
        }
        if gps {
            entries.push((0x8825, 0));
        }
        if !entries.is_empty() {
            let mut body = b"Exif\0\0".to_vec();
            body.extend(tiff(false, &entries));
            segment(&mut out, 0xe1, &body);
        }
        let mut frame = vec![8];
        frame.extend_from_slice(&height.to_be_bytes());
        frame.extend_from_slice(&width.to_be_bytes());
        frame.extend_from_slice(&[1, 1, 0x11, 0]);
        segment(&mut out, 0xc0, &frame);
        out.extend_from_slice(&[0xff, 0xda, 0, 2, 0xff, 0xd9]);
        out
    }

    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(body);
        out.extend_from_slice(&[0, 0, 0, 0]);
    }

    fn segment(out: &mut Vec<u8>, marker: u8, body: &[u8]) {
        out.extend_from_slice(&[0xff, marker]);
        out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
        out.extend_from_slice(body);
    }

    fn tiff(little: bool, entries: &[(u16, u16)]) -> Vec<u8> {
        let u16b = |v: u16| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let u32b = |v: u32| {
            if little {
                v.to_le_bytes()
            } else {
                v.to_be_bytes()
            }
        };
        let mut out = if little {
            b"II*\0".to_vec()
        } else {
            b"MM\0*".to_vec()
        };
        out.extend_from_slice(&u32b(8));
        out.extend_from_slice(&u16b(entries.len() as u16));
        for (tag, value) in entries {
            out.extend_from_slice(&u16b(*tag));
            out.extend_from_slice(&u16b(3));
            out.extend_from_slice(&u32b(1));
            out.extend_from_slice(&u16b(*value));
            out.extend_from_slice(&[0, 0]);
        }
        out.extend_from_slice(&u32b(0));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_png_sizes_and_an_exif_gps_record() {
        let plain = samples::png(1000, 1500, false);
        let facts = read(&plain, 4096).unwrap();
        assert_eq!(
            (
                facts.media_type,
                facts.width,
                facts.height,
                facts.bytes,
                facts.location_metadata
            ),
            (MediaType::Png, 1000, 1500, 4096, false)
        );
        assert!(
            read(&samples::png(10, 10, true), 1)
                .unwrap()
                .location_metadata
        );
    }

    #[test]
    fn reads_jpeg_frames_after_exif_and_turns_a_quarter_turned_photograph() {
        let facts = read(&samples::jpeg(1200, 630, false, 0), 9).unwrap();
        assert_eq!(
            (facts.media_type, facts.width, facts.height),
            (MediaType::Jpeg, 1200, 630)
        );
        let turned = read(&samples::jpeg(1500, 1000, true, 6), 9).unwrap();
        assert_eq!(
            (turned.width, turned.height, turned.location_metadata),
            (1000, 1500, true)
        );
        let upright = read(&samples::jpeg(1500, 1000, false, 1), 9).unwrap();
        assert_eq!((upright.width, upright.height), (1500, 1000));
    }

    #[test]
    fn reads_gif_and_the_three_webp_kinds() {
        let mut gif = b"GIF89a".to_vec();
        gif.extend_from_slice(&[0x58, 0x02, 0x3b, 0x01]);
        assert_eq!(read(&gif, 1).map(|f| (f.width, f.height)), Some((600, 315)));

        let riff = |chunk: &[u8]| {
            let mut out = b"RIFF\0\0\0\0WEBP".to_vec();
            out.extend_from_slice(chunk);
            out
        };
        let mut lossy = b"VP8 \x0a\0\0\0\0\0\0\x9d\x01\x2a".to_vec();
        lossy.extend_from_slice(&1000u16.to_le_bytes());
        lossy.extend_from_slice(&1500u16.to_le_bytes());
        assert_eq!(
            read(&riff(&lossy), 1).map(|f| (f.width, f.height)),
            Some((1000, 1500))
        );

        // 1200 x 630 lossless: width-1 = 1199 and height-1 = 629 packed in 14-bit fields.
        let (w, h) = (1199u32, 629u32);
        let bits = w | h << 14;
        let mut lossless = b"VP8L\x05\0\0\0\x2f".to_vec();
        lossless.extend_from_slice(&bits.to_le_bytes());
        lossless.push(0);
        assert_eq!(
            read(&riff(&lossless), 1).map(|f| (f.width, f.height)),
            Some((1200, 630))
        );

        let mut extended = b"VP8X\x0a\0\0\0\0\0\0\0".to_vec();
        extended.extend_from_slice(&[0xe7, 0x03, 0x00, 0xdb, 0x05, 0x00]);
        assert_eq!(
            read(&riff(&extended), 1).map(|f| (f.width, f.height)),
            Some((1000, 1500))
        );
    }

    #[test]
    fn anything_else_or_a_broken_header_is_none() {
        for bytes in [
            &b""[..],
            b"<svg xmlns='http://www.w3.org/2000/svg'/>",
            b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDX",
            b"\xff\xd8\xff\xe0\x00",
            b"\xff\xd8\xff\xda\x00\x02",
            b"GIF89a\0\0\0\0",
            b"RIFF\0\0\0\0WEBPVP8 \x0a\0\0\0\0\0\0\0\0\0",
        ] {
            assert_eq!(read(bytes, 1), None, "{bytes:?}");
        }
        // A truncated JPEG, or an empty Exif directory, never panics.
        let jpeg = samples::jpeg(10, 10, true, 0);
        for end in 0..jpeg.len() {
            let _ = read(&jpeg[..end], 1);
        }
        let png = samples::png(10, 10, true);
        for end in 0..png.len() {
            let _ = read(&png[..end], 1);
        }
    }
}

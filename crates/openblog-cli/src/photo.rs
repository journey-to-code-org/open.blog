//! Photos made fit for a web page when they are uploaded (#558). A phone photo is far larger than any
//! page can show, and it can carry where it was taken, so it is replaced by a smaller copy without that
//! metadata. Everything else stays exactly as it was sent: animations, formats that cannot be decoded here,
//! and pictures that are already light and carry no metadata.

use std::io::Cursor;
use std::sync::Mutex;

use image::codecs::jpeg::{JpegDecoder, JpegEncoder};
use image::codecs::png::{PngDecoder, PngEncoder};
use image::codecs::webp::WebPDecoder;
use image::{DynamicImage, ExtendedColorType, ImageDecoder, ImageEncoder, ImageResult};

/// The largest upload read at all. A photo this size is reduced; `admin.maxUploadMb` still caps what is
/// published as it was sent.
pub const INTAKE_MB: usize = 40;

/// The longest side of a published photo: sharp on a large screen, and light on a phone.
const MAX_EDGE: u32 = 2000;
/// A picture heavier than this is worth compressing even when it already fits on the page.
const LIGHT_BYTES: usize = 1024 * 1024;
const JPEG_QUALITY: u8 = 82;
/// The most memory one photo may take once decoded, which is a 64 megapixel photo with transparency. A
/// small host has 512 MB, so anything larger is left alone rather than risk stopping the whole site.
const MAX_DECODED_BYTES: u64 = 256 * 1024 * 1024;

/// One photo is decoded at a time, so that two large uploads cannot exhaust a small host's memory together.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// A replacement for an uploaded picture.
#[derive(Debug)]
pub struct Fitted {
    pub bytes: Vec<u8>,
    pub extension: &'static str,
}

/// The smaller copy to publish instead of `bytes`, whose type `extension` was judged from its own bytes, or
/// `None` when the picture should be kept exactly as it was sent.
pub fn fit_for_web(bytes: &[u8], extension: &str) -> Option<Fitted> {
    let _turn = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let reader = Cursor::new(bytes);
    let fitted = match extension {
        "jpg" => fit_decoded(JpegDecoder::new(reader).ok()?, bytes.len()),
        "png" => {
            let decoder = PngDecoder::new(reader).ok()?;
            if decoder.is_apng().ok()? {
                return None;
            }
            fit_decoded(decoder, bytes.len())
        }
        "webp" => {
            let decoder = WebPDecoder::new(reader).ok()?;
            if decoder.has_animation() {
                return None;
            }
            fit_decoded(decoder, bytes.len())
        }
        _ => return None,
    };
    fitted.ok().flatten()
}

fn fit_decoded(mut decoder: impl ImageDecoder, sent_bytes: usize) -> ImageResult<Option<Fitted>> {
    if decoder.total_bytes() > MAX_DECODED_BYTES {
        return Ok(None);
    }
    let (width, height) = decoder.dimensions();
    let too_wide = width.max(height) > MAX_EDGE;
    let has_metadata = decoder.exif_metadata()?.is_some();
    if !too_wide && !has_metadata && sent_bytes <= LIGHT_BYTES {
        return Ok(None);
    }
    let orientation = decoder.orientation()?;
    // A phone's wide colour is kept: without its profile, a photo's colours look washed out.
    let color_profile = decoder.icc_profile()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    if too_wide {
        image = image.thumbnail(MAX_EDGE, MAX_EDGE);
    }
    // The metadata is dropped, so the turn it asked for is made in the pixels.
    image.apply_orientation(orientation);
    let fitted = encode(&image, color_profile)?;
    // Compressing can make a picture that was already small larger; that copy is only worth having when
    // the picture was too wide or was carrying metadata.
    if !too_wide && !has_metadata && fitted.bytes.len() >= sent_bytes {
        return Ok(None);
    }
    Ok(Some(fitted))
}

fn encode(image: &DynamicImage, color_profile: Option<Vec<u8>>) -> ImageResult<Fitted> {
    let mut bytes = Vec::new();
    let (width, height) = (image.width(), image.height());
    if is_see_through(image) {
        let mut encoder = PngEncoder::new(&mut bytes);
        if let Some(profile) = color_profile {
            let _ = encoder.set_icc_profile(profile);
        }
        encoder.write_image(&image.to_rgba8(), width, height, ExtendedColorType::Rgba8)?;
        return Ok(Fitted {
            bytes,
            extension: "png",
        });
    }
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY);
    if let Some(profile) = color_profile {
        let _ = encoder.set_icc_profile(profile);
    }
    encoder.write_image(&image.to_rgb8(), width, height, ExtendedColorType::Rgb8)?;
    Ok(Fitted {
        bytes,
        extension: "jpg",
    })
}

fn is_see_through(image: &DynamicImage) -> bool {
    image.color().has_alpha() && image.to_rgba8().pixels().any(|pixel| pixel[3] != u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageReader, Rgb, RgbImage, Rgba, RgbaImage};

    /// A photo-like picture: smooth colour with noise, so that it compresses the way a photo does.
    fn photo(width: u32, height: u32) -> RgbImage {
        let mut seed = 7u32;
        RgbImage::from_fn(width, height, |x, y| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = (seed >> 27) as u8;
            Rgb([
                (x * 200 / width) as u8 + noise,
                (y * 200 / height) as u8 + noise,
                90 + noise,
            ])
        })
    }

    fn jpeg(image: &RgbImage, quality: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, quality)
            .write_image(
                image,
                image.width(),
                image.height(),
                ExtendedColorType::Rgb8,
            )
            .unwrap();
        bytes
    }

    fn png(image: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes)
            .write_image(
                image,
                image.width(),
                image.height(),
                ExtendedColorType::Rgba8,
            )
            .unwrap();
        bytes
    }

    /// `bytes`, a JPEG, with camera metadata: the turn a phone asks for, and a marker standing in for where
    /// the photo was taken.
    fn with_camera_metadata(bytes: &[u8], orientation: u8) -> Vec<u8> {
        let mut tiff: Vec<u8> = b"II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
        tiff.extend([orientation, 0, 0, 0, 0, 0, 0, 0]);
        tiff.extend(b"THE-KITCHEN-TABLE");
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend(tiff);
        let mut out = vec![0xFF, 0xD8, 0xFF, 0xE1];
        out.extend(((segment.len() + 2) as u16).to_be_bytes());
        out.extend(segment);
        out.extend(&bytes[2..]);
        out
    }

    fn opened(bytes: &[u8]) -> DynamicImage {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap()
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|part| part == needle)
    }

    #[test]
    fn a_large_phone_photo_becomes_a_light_one_of_the_same_shape() {
        let sent = jpeg(&photo(4000, 3000), 95);
        assert!(sent.len() > 2 * 1024 * 1024, "{}", sent.len());
        let fitted = fit_for_web(&sent, "jpg").expect("reduced");
        assert_eq!(fitted.extension, "jpg");
        assert!(
            fitted.bytes.len() < sent.len() / 2,
            "{}",
            fitted.bytes.len()
        );
        let image = opened(&fitted.bytes);
        assert_eq!((image.width(), image.height()), (2000, 1500));
    }

    #[test]
    fn a_sideways_photo_stays_upright_and_loses_where_it_was_taken() {
        let sent = with_camera_metadata(&jpeg(&photo(3000, 2000), 90), 6);
        let fitted = fit_for_web(&sent, "jpg").expect("reduced");
        let image = opened(&fitted.bytes);
        assert_eq!((image.width(), image.height()), (1333, 2000));
        assert!(contains(&sent, b"THE-KITCHEN-TABLE"));
        assert!(!contains(&fitted.bytes, b"THE-KITCHEN-TABLE"));
        assert!(!contains(&fitted.bytes, b"Exif"));
    }

    #[test]
    fn a_small_photo_carrying_metadata_is_cleaned_too() {
        let sent = with_camera_metadata(&jpeg(&photo(600, 400), 80), 1);
        let fitted = fit_for_web(&sent, "jpg").expect("cleaned");
        let image = opened(&fitted.bytes);
        assert_eq!((image.width(), image.height()), (600, 400));
        assert!(!contains(&fitted.bytes, b"THE-KITCHEN-TABLE"));
    }

    #[test]
    fn a_light_picture_without_metadata_is_kept_byte_for_byte() {
        assert!(fit_for_web(&jpeg(&photo(600, 400), 80), "jpg").is_none());
        let logo = RgbaImage::from_pixel(64, 64, Rgba([200, 30, 30, 255]));
        assert!(fit_for_web(&png(&logo), "png").is_none());
    }

    #[test]
    fn a_phones_wide_colour_survives_the_reduction() {
        let mut bytes = Vec::new();
        let source = photo(2400, 1600);
        let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 90);
        encoder.set_icc_profile(vec![9; 500]).unwrap();
        encoder
            .write_image(&source, 2400, 1600, ExtendedColorType::Rgb8)
            .unwrap();
        let fitted = fit_for_web(&bytes, "jpg").expect("reduced");
        let mut decoder = JpegDecoder::new(Cursor::new(&fitted.bytes)).unwrap();
        assert_eq!(decoder.icc_profile().unwrap(), Some(vec![9; 500]));
    }

    #[test]
    fn transparency_is_kept_and_a_solid_png_becomes_a_jpeg() {
        let clear = RgbaImage::from_fn(2400, 1200, |x, _| {
            Rgba([10, 120, 200, if x < 1200 { 0 } else { 255 }])
        });
        let fitted = fit_for_web(&png(&clear), "png").expect("reduced");
        assert_eq!(fitted.extension, "png");
        let image = opened(&fitted.bytes);
        assert_eq!((image.width(), image.height()), (2000, 1000));
        assert_eq!(image.to_rgba8().get_pixel(0, 0)[3], 0);

        let solid = DynamicImage::ImageRgb8(photo(2400, 1200)).to_rgba8();
        assert_eq!(fit_for_web(&png(&solid), "png").unwrap().extension, "jpg");
    }

    #[test]
    fn animations_and_broken_files_are_left_alone() {
        assert!(fit_for_web(b"GIF89a-animated", "gif").is_none());
        assert!(fit_for_web(&[0xFF, 0xD8, 0xFF, 0, 0, 0], "jpg").is_none());
        assert!(fit_for_web(b"\x89PNG\r\n\x1a\n-not-really", "png").is_none());

        let mut animated = Vec::new();
        let frame = RgbaImage::from_pixel(2400, 100, Rgba([1, 2, 3, 255]));
        let mut encoded = png(&frame);
        // An animation-control chunk ahead of the image data is what marks a PNG as animated.
        let chunk: &[u8] = b"acTL       ";
        let after_header = 8 + 25;
        animated.extend(encoded.drain(..after_header));
        animated.extend(8u32.to_be_bytes());
        animated.extend(chunk);
        animated.extend(png_chunk_crc(chunk).to_be_bytes());
        animated.extend(encoded);
        assert!(fit_for_web(&animated, "png").is_none());
    }

    #[test]
    fn a_photo_too_large_to_decode_safely_is_left_alone() {
        // A 20000 by 20000 header needs far more memory than a small host has; nothing is decoded.
        let mut image = png(&RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 255])));
        image[16..24].copy_from_slice(&[0, 0, 0x4E, 0x20, 0, 0, 0x4E, 0x20]);
        let crc = png_chunk_crc(&image[12..29]);
        image[29..33].copy_from_slice(&crc.to_be_bytes());
        assert!(PngDecoder::new(Cursor::new(&image)).is_ok());
        assert!(fit_for_web(&image, "png").is_none());
    }

    fn png_chunk_crc(bytes: &[u8]) -> u32 {
        let mut crc = u32::MAX;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
}

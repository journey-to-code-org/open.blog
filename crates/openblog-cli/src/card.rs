//! `openblog card <slug>`: build and check a published post's visual cards (story #393,
//! ADRs 0368 to 0370). It reads the post and the image files the site serves, and nothing
//! else: no network request, no credential, no private state, and no change to the site.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use openblog_core::frontmatter;
use openblog_core::image_facts::{self, INSPECT_BYTES};
use openblog_core::portability::PortableProjection;
use openblog_core::visual_card::{
    self, CardFiles, CardFormat, CardPlan, CardSource, ImageCandidate, Measurement,
};

use crate::{fsutil, site, syndication};

#[derive(Clone, Debug, Default)]
pub struct Options {
    /// A comma-separated list of formats; all of them when absent.
    pub formats: Option<String>,
    pub json: bool,
    /// A new folder to write the dry-run artifacts into.
    pub preview: Option<String>,
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    if options.json && options.preview.is_some() {
        return Err("--json and --preview each run alone; choose one. Nothing was written.".into());
    }
    let formats = CardFormat::parse_list(options.formats.as_deref().unwrap_or(""))?;
    let (plan, files) = build(root, slug, &formats)?;
    if let Some(directory) = &options.preview {
        let written = write_preview(root, &plan, &files, directory)?;
        println!(
            "Wrote the visual card preview for `{slug}` to {} (open index.html). Nothing was sent.",
            written.display()
        );
        return Ok(());
    }
    if options.json {
        let text = serde_json::to_string_pretty(&plan)
            .map_err(|error| format!("could not serialize the card plan: {error}"))?;
        println!("{text}");
        return Ok(());
    }
    print!("{}", text_report(slug, &plan));
    Ok(())
}

/// The images measured for a plan, by site path, so a preview can copy exactly those files.
pub(crate) type Measured = Vec<(String, PathBuf)>;

pub(crate) fn build(
    root: &Path,
    slug: &str,
    formats: &[CardFormat],
) -> Result<(CardPlan, Measured), String> {
    let config = site::load_config(root)?;
    let sources = site::read_sources(root, &config)?;
    // Only a production-visible post: a draft or a scheduled post never gets a card.
    let (loaded, _) = site::load_site(root, false, Some(crate::clock::now()))?;
    let post = match loaded.posts.iter().find(|post| post.slug == slug) {
        Some(post) => post,
        None => return Err(syndication::unavailable_post_error(root, slug)?),
    };
    let source = sources
        .posts
        .iter()
        .find(|source| source.path == post.source)
        .ok_or_else(|| format!("cannot find source `{}`", post.source))?;
    let document = frontmatter::parse(&source.contents)?;
    let canonical_url = PortableProjection::from_post(post, &config)?
        .canonical_url()
        .to_string();
    let page_url = config.absolute(&post.url);
    // Exactly the page's og:image: the post's own (its cover, else a video's thumbnail), else
    // the site's ogImage, chosen by the same rule the renderer uses.
    let page_image = post
        .page_image()
        .or((!config.og_image.is_empty()).then_some(config.og_image.as_str()));
    let page_image_alt = post
        .page_image()
        .and_then(|_| Some(post.cover_alt.as_str()).filter(|alt| !alt.trim().is_empty()));
    let card_source = CardSource {
        title: &post.title,
        description: &post.description,
        profile: &post.profile,
        page_url: &page_url,
        canonical_url: &canonical_url,
        site_url: &config.url,
        page_image,
        page_image_alt,
        front_matter: &document.front_matter,
        markdown: post.portable_markdown(),
    };
    let static_dir = root.join(&config.paths.static_dir);
    let private = fsutil::PrivateState::of(root).withhold(&site::comparison_files(root, &config));
    let mut measured: Measured = Vec::new();
    let mut measure = |candidate: &ImageCandidate| -> Measurement {
        let Some(path) = &candidate.site_path else {
            return Measurement::Remote;
        };
        match static_file(&static_dir, path, &private) {
            None => Measurement::NotFound,
            Some(file) => match facts(&file) {
                Some(facts) => {
                    if !measured.iter().any(|(known, _)| known == path) {
                        measured.push((path.clone(), file));
                    }
                    Measurement::Measured(facts)
                }
                None => Measurement::Unreadable,
            },
        }
    };
    let plan = visual_card::plan(
        &card_source,
        &post.source.replace('\\', "/"),
        formats,
        &mut measure,
    );
    Ok((plan, measured))
}

/// The file the site would serve at `path` from its static folder: a regular file inside the
/// folder, reached without a symbolic link, and not private project state.
fn static_file(static_dir: &Path, path: &str, private: &fsutil::PrivateState) -> Option<PathBuf> {
    let mut file = static_dir.to_path_buf();
    for part in path.split('/') {
        file.push(part);
        let meta = fs::symlink_metadata(&file).ok()?;
        if meta.file_type().is_symlink() {
            return None;
        }
    }
    let meta = fs::symlink_metadata(&file).ok()?;
    (meta.is_file() && !private.contains(&file)).then_some(file)
}

fn facts(file: &Path) -> Option<openblog_core::image_facts::ImageFacts> {
    let total = fs::metadata(file).ok()?.len();
    let mut prefix = Vec::new();
    fs::File::open(file)
        .ok()?
        .take(INSPECT_BYTES as u64)
        .read_to_end(&mut prefix)
        .ok()?;
    image_facts::read(&prefix, total)
}

fn text_report(slug: &str, plan: &CardPlan) -> String {
    let mut out = format!(
        "Visual cards for `{slug}` (links to {}). Nothing is sent, uploaded or fetched.\n",
        plan.canonical_url
    );
    for card in &plan.cards {
        out.push_str(&format!(
            "\n{} ({}): {}\n  title: {}\n",
            card.format.as_str(),
            card.label,
            card.status.words(),
            card.title
        ));
        if !card.description.is_empty() {
            out.push_str(&format!("  description: {}\n", card.description));
        }
        match &card.image {
            Some(image) => {
                let facts = image
                    .facts
                    .map(|f| {
                        format!(
                            " ({} {}x{}, {} bytes)",
                            f.media_type.label(),
                            f.width,
                            f.height,
                            f.bytes
                        )
                    })
                    .unwrap_or_default();
                out.push_str(&format!(
                    "  image: {} {}{facts}\n",
                    image.candidate.origin.describe(),
                    image.candidate.src
                ));
                if let Some(credit) = image.candidate.credit.line() {
                    out.push_str(&format!("  credit: {credit}\n"));
                }
            }
            None => out.push_str("  image: none\n"),
        }
        if let Some(alt) = &card.alt {
            out.push_str(&format!("  alt: {alt}\n"));
        }
        for skipped in &card.skipped {
            let codes: Vec<&str> = skipped.problems.iter().map(|p| p.code).collect();
            out.push_str(&format!(
                "  skipped {} {}: {}\n",
                skipped.origin.describe(),
                skipped.src,
                codes.join(", ")
            ));
        }
        for problem in &card.problems {
            out.push_str(&format!(
                "  - [{}] {}: {}\n",
                problem.severity.as_str(),
                problem.code,
                problem.message
            ));
        }
    }
    out.push_str(&format!(
        "\nCard plan digest: {}\nRun with --preview <new folder> for an accessible page with layout previews.\n",
        plan.digest
    ));
    out
}

/// Writes `cards.json`, each card's `NN-<format>.svg` layout preview, a copy of each chosen
/// site image, and `index.html` into a new folder. An existing path is refused.
fn write_preview(
    root: &Path,
    plan: &CardPlan,
    measured: &Measured,
    directory: &str,
) -> Result<PathBuf, String> {
    let directory = syndication::new_artifact_folder(root, directory, "preview")?;
    let write = |name: &str, bytes: &[u8]| {
        fsutil::create_new_file(&directory.join(name), bytes)
            .map_err(|cause| format!("cannot write {name} in {}: {cause}", directory.display()))
    };
    // File names come from the format, never from the author's paths.
    let mut files = Vec::new();
    for (index, card) in plan.cards.iter().enumerate() {
        let stem = format!("{:02}-{}", index + 1, card.format.as_str());
        let mut card_files = CardFiles {
            svg: format!("{stem}.svg"),
            image: None,
        };
        if let Some(image) = &card.image {
            let copy = image.candidate.site_path.as_ref().and_then(|path| {
                measured
                    .iter()
                    .find(|(known, _)| known == path)
                    .map(|(_, file)| file)
            });
            if let (Some(file), Some(facts)) = (copy, image.facts) {
                let name = format!("{stem}-image.{}", facts.media_type.extension());
                let bytes = fs::read(file)
                    .map_err(|error| format!("cannot read an image for the preview: {error}"))?;
                write(&name, &bytes)?;
                card_files.image = Some(name);
            }
        }
        let svg = visual_card::card_svg(card, &stem, card_files.image.as_deref());
        write(&card_files.svg, svg.as_bytes())?;
        files.push(card_files);
    }
    let mut manifest = serde_json::to_value(plan)
        .map_err(|error| format!("could not serialize the card plan: {error}"))?;
    if let Some(cards) = manifest["cards"].as_array_mut() {
        for (card, file) in cards.iter_mut().zip(&files) {
            card["file"] = serde_json::Value::String(file.svg.clone());
            if let Some(image) = &file.image {
                card["imageFile"] = serde_json::Value::String(image.clone());
            }
        }
    }
    let manifest = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("could not serialize the card plan: {error}"))?;
    write("cards.json", manifest.as_bytes())?;
    write(
        "index.html",
        visual_card::preview_page(plan, &files).as_bytes(),
    )?;
    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openblog_core::image_facts::samples;
    use openblog_core::visual_card::{CardStatus, ImageOrigin};

    fn site(post: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "openblog-card-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::create_dir_all(root.join("static/img")).unwrap();
        fs::write(
            root.join("openblog.json"),
            r#"{"title":"Kitchen","url":"https://cook.example.org","ogImage":"/img/default.png"}"#,
        )
        .unwrap();
        fs::write(root.join("content/posts/tart.md"), post).unwrap();
        fs::write(
            root.join("static/img/pin.png"),
            samples::png(1000, 1500, false),
        )
        .unwrap();
        fs::write(
            root.join("static/img/wide.jpg"),
            samples::jpeg(1200, 630, false, 0),
        )
        .unwrap();
        fs::write(
            root.join("static/img/default.png"),
            samples::png(1200, 630, false),
        )
        .unwrap();
        root
    }

    const RECIPE: &str = "---\ntitle: Lemon tart\nslug: tart\ndate: 2026-01-01\nprofile: recipe\ndescription: Sharp and short.\ncover: /img/missing.jpg\ncoverAlt: A tart\ncardTitle: Lemon tart with a crisp crust\n---\nIntro.\n\n![A slice of tart on a plate](/img/pin.png)\n\n## Ingredients\n\n- lemons\n\n## Method\n\n1. Bake.\n";

    #[test]
    fn a_recipe_card_falls_back_to_its_photograph_and_link_cards_show_the_page_image() {
        let root = site(RECIPE);
        let (plan, measured) = build(&root, "tart", &CardFormat::ALL).unwrap();
        assert!(!plan.remote_request_sent);
        let pin = &plan.cards[0];
        assert_eq!(pin.title, "Lemon tart with a crisp crust");
        let image = pin.image.as_ref().unwrap();
        assert_eq!(image.candidate.origin, ImageOrigin::BodyImage);
        assert_eq!(image.facts.map(|f| (f.width, f.height)), Some((1000, 1500)));
        assert_eq!(pin.alt.as_deref(), Some("A slice of tart on a plate"));
        assert_eq!(pin.skipped.len(), 1);
        assert_eq!(pin.skipped[0].problems[0].code, "image-not-found");
        assert_eq!(pin.link, "https://cook.example.org/posts/tart/");
        // Link previews check exactly what the page declares: here the missing cover.
        let facebook = &plan.cards[1];
        assert_eq!(facebook.title, "Lemon tart");
        assert_eq!(facebook.status, CardStatus::Blocked);
        assert!(facebook
            .problems
            .iter()
            .any(|p| p.code == "page-image-unusable"));
        assert_eq!(measured.len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn the_preview_writes_svg_json_the_image_copy_and_a_static_page_and_refuses_an_existing_folder()
    {
        let root = site(RECIPE);
        run(
            &root,
            "tart",
            Options {
                formats: Some("pinterest-pin".into()),
                json: false,
                preview: Some("cards".into()),
            },
        )
        .unwrap();
        let out = root.join("cards");
        let names: Vec<String> = {
            let mut names: Vec<String> = fs::read_dir(&out)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        };
        assert_eq!(
            names,
            [
                "01-pinterest-pin-image.png",
                "01-pinterest-pin.svg",
                "cards.json",
                "index.html"
            ]
        );
        let page = fs::read_to_string(out.join("index.html")).unwrap();
        assert!(page.contains("Preview, not sent."));
        assert!(!page.contains("<script"));
        assert!(page.contains("href=\"01-pinterest-pin-image.png\""));
        let json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(out.join("cards.json")).unwrap()).unwrap();
        assert_eq!(json["remoteRequestSent"], false);
        assert_eq!(json["cards"][0]["file"], "01-pinterest-pin.svg");
        let again = run(
            &root,
            "tart",
            Options {
                formats: None,
                json: false,
                preview: Some("cards".into()),
            },
        );
        assert!(again.unwrap_err().contains("existing"));
        assert!(run(
            &root,
            "tart",
            Options {
                formats: Some("tiktok".into()),
                ..Options::default()
            }
        )
        .is_err());
        fs::remove_dir_all(root).ok();
    }

    fn codes(card: &openblog_core::visual_card::VisualCard) -> Vec<&'static str> {
        card.problems.iter().map(|p| p.code).collect()
    }

    #[test]
    fn a_large_photographs_location_stored_after_its_image_data_still_keeps_a_travel_post_private()
    {
        let post = "---\ntitle: Ridge walk\nslug: tart\ndate: 2026-01-01\nprofile: field-journal\nlocationPrivacy: approximate\ndescription: Up the ridge.\ncover: /img/ridge.webp\ncoverAlt: The ridge at dawn\n---\nTrail notes.\n\n![The summit cairn](/img/summit.png)\n";
        let root = site(post);
        // Over a megabyte each, with the GPS record after the image data, where WebP and
        // (optionally) PNG keep it.
        let big = 2 * 1024 * 1024;
        fs::write(
            root.join("static/img/ridge.webp"),
            samples::webp(1200, 630, big, true),
        )
        .unwrap();
        fs::write(
            root.join("static/img/summit.png"),
            samples::png_with_trailing_gps(1000, 1500, big),
        )
        .unwrap();
        let (plan, _) = build(&root, "tart", &CardFormat::ALL).unwrap();
        let pin = &plan.cards[0];
        assert_eq!(pin.status, CardStatus::Blocked, "{:?}", codes(pin));
        assert!(pin.image.is_none());
        assert!(pin.skipped.iter().any(|s| s.src == "/img/summit.png"
            && s.problems
                .iter()
                .any(|p| p.code == "image-location-metadata")));
        for link in &plan.cards[1..] {
            assert_eq!(link.status, CardStatus::Blocked, "{:?}", codes(link));
            assert!(link.image.is_none());
            assert!(link.skipped.iter().any(|s| s.src == "/img/ridge.webp"
                && s.problems
                    .iter()
                    .any(|p| p.code == "image-location-metadata")));
        }
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_link_card_checks_a_video_posts_thumbnail_the_page_declares_as_its_image() {
        let post = "---\ntitle: Episode one\nslug: tart\ndate: 2026-01-01\nprofile: video\ndescription: The first episode.\nvideoUrl: https://youtu.be/dQw4w9WgXcQ\nthumbnail: /img/wide.jpg\n---\nTranscript.\n";
        let root = site(post);
        let (plan, measured) = build(&root, "tart", &CardFormat::ALL).unwrap();
        for link in &plan.cards[1..] {
            let image = link.image.as_ref().expect("the thumbnail");
            assert_eq!(image.candidate.src, "/img/wide.jpg");
            assert_eq!(image.facts.map(|f| (f.width, f.height)), Some((1200, 630)));
        }
        assert!(measured
            .iter()
            .any(|(path, _)| path == "img/wide.jpg" || path == "/img/wide.jpg"));
        assert!(!measured.iter().any(|(path, _)| path.contains("default")));
        // The page itself declares the same image.
        let config = site::load_config(&root).unwrap();
        let (loaded, _) = site::load_site(&root, false, Some(crate::clock::now())).unwrap();
        let built = loaded.posts.iter().find(|p| p.slug == "tart").unwrap();
        assert_eq!(built.page_image(), Some("/img/wide.jpg"));
        assert!(!config.og_image.is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_draft_never_gets_a_card() {
        let root = site(&RECIPE.replace("profile: recipe", "profile: recipe\ndraft: true"));
        let error = build(&root, "tart", &CardFormat::ALL).unwrap_err();
        assert!(error.contains("not production-visible"), "{error}");
        fs::remove_dir_all(root).ok();
    }
}

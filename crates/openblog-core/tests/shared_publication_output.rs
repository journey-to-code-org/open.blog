//! A published shared reflection reaches the native page, portable HTML/Markdown/text, RSS and
//! JSON Feed with every author's section in order, every author credited consistently, the shared
//! source attributed, and nothing private (ADR 0023).

use openblog_core::approval::ApprovalSet;
use openblog_core::assembly::{assemble, with_subject, Assembly};
use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind,
};
use openblog_core::config::SiteConfig;
use openblog_core::contributor::Contributor;
use openblog_core::draft::DraftSet;
use openblog_core::feeds;
use openblog_core::model::{LoadOptions, Site, SourceFile, Sources};
use openblog_core::portability::PortableProjection;
use openblog_core::render;
use openblog_core::theme::ThemeSet;

const T: i64 = 1_800_000_000;
const DATE: &str = "2030-01-31T09:00:00Z";
const ALL: [&str; 3] = ["ann", "bo", "cy"];
const NAMES: [&str; 3] = ["Ann Ames", "Bo <Bee> & Co", "Cy \"Quote\" Cole"];
const SECRET_OLD: &str = "OLDSECRETREVISION";

/// Values that must never appear in any public output.
const PRIVATE: &[&str] = &[
    "ann-admin",
    "bo-admin",
    "cy-admin",
    "shared-0a1b2c3d4e5f",
    SECRET_OLD,
    "invitation",
    "approval",
    "approved",
    "revision",
    "reveal",
    "participant",
    "adminUser",
    "contributorId",
    "contributionId",
    "digest",
    ".openblog",
    "C:\\Users",
    "/home/",
];

fn record() -> SharedPublication {
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: "shared-0a1b2c3d4e5f".into(),
        title: "Noticing, together".into(),
        guiding_question: "What did you notice?".into(),
        sources: vec![NewSourceReference {
            kind: SourceKind::Video,
            title: "The Art of Noticing".into(),
            url: "https://www.youtube.com/watch?v=abc123".into(),
            ..NewSourceReference::default()
        }],
        creator: NewParticipant {
            admin_user: "ann-admin".into(),
            contributor_id: "ann".into(),
            display_name: NAMES[0].into(),
        },
    })
    .unwrap();
    record.collaboration.participants[0].id = "ann".into();
    record.authorization.bindings[0].participant_id = "ann".into();
    for (id, name) in [("bo", NAMES[1]), ("cy", NAMES[2])] {
        record.collaboration.participants.push(Participant {
            id: id.into(),
            display_name: name.into(),
            profile_url: None,
        });
        record.authorization.bindings.push(IdentityBinding {
            admin_user: format!("{id}-admin"),
            contributor_id: id.into(),
            participant_id: id.into(),
            roles: vec![AuthorizationRole::Contributor],
        });
    }
    record
}

fn config() -> SiteConfig {
    let mut config = SiteConfig::from_json(
        r#"{"title":"T","url":"https://example.test","postPath":"/{slug}/","author":{"name":"Site Owner"},"feeds":{"fullContent":true}}"#,
    )
    .unwrap();
    for (id, name) in ALL.iter().zip(NAMES) {
        config.contributors.insert(
            (*id).into(),
            Contributor {
                name: name.into(),
                url: format!("https://example.org/{id}"),
                ..Contributor::default()
            },
        );
    }
    config
}

fn approved(texts: &[(&str, &str)]) -> Assembly {
    let record = record();
    let mut set = DraftSet::new(&ALL).unwrap();
    for (who, text) in texts {
        if *who == "bo" {
            // An earlier revision that is then replaced: it must never be published.
            set.save("bo", "bo", 0, SECRET_OLD, T).unwrap();
            set.save("bo", "bo", 1, text, T + 1).unwrap();
        } else {
            set.save(who, who, 0, text, T + 1).unwrap();
        }
    }
    let mut approvals = ApprovalSet::new();
    for who in ALL {
        let seen = with_subject(&record, &set, &ALL, |s| {
            approvals.binding_for(s, who).unwrap()
        });
        with_subject(&record, &set, &ALL, |s| {
            approvals.approve(who, who, s, &seen, true, T)
        })
        .unwrap();
    }
    assemble(&record, &set, &approvals, &ALL, DATE).unwrap()
}

fn site(made: &Assembly) -> Site {
    Site::load(
        config(),
        Sources {
            posts: vec![SourceFile {
                path: made.path.clone(),
                contents: made.source.clone(),
            }],
            credits: vec![SourceFile {
                path: made.credits_path.clone(),
                contents: made.credits.clone(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap_or_else(|errors| panic!("{errors:?}"))
}

fn clean(label: &str, output: &str) {
    let lower = output.to_ascii_lowercase();
    for needle in PRIVATE {
        assert!(
            !lower.contains(&needle.to_ascii_lowercase()),
            "{label} leaked `{needle}`"
        );
    }
}

fn in_order(label: &str, output: &str, needles: &[&str]) {
    let mut from = 0;
    for needle in needles {
        let at = output[from..]
            .find(needle)
            .unwrap_or_else(|| panic!("{label} lost or reordered `{needle}`"));
        from += at + needle.len();
    }
}

const SECTIONS: [&str; 3] = [
    "Ann noticed the light.",
    "Bo noticed the **sound** of rain.",
    "Our shared conclusion: slow down.",
];

#[test]
fn every_section_author_and_the_source_reach_every_representation_in_order() {
    let made = approved(&[
        ("ann", SECTIONS[0]),
        ("bo", SECTIONS[1]),
        ("cy", SECTIONS[2]),
    ]);
    let site = site(&made);
    let post = &site.posts[0];
    let projection = PortableProjection::from_post(post, &site.config).unwrap();
    let canonical = projection.canonical_url().to_string();
    assert!(
        canonical.starts_with("https://example.test/"),
        "{canonical}"
    );

    let files = render::generate(&site, &ThemeSet::new()).unwrap();
    let page = &files
        .iter()
        .find(|file| file.path.ends_with("noticing-together/index.html"))
        .expect("native page")
        .contents;
    in_order(
        "page",
        page,
        &[
            "Ann noticed the light.",
            "<strong>sound</strong>",
            "Our shared conclusion: slow down.",
        ],
    );
    assert!(page.contains("Guiding question:") && page.contains("The Art of Noticing"));
    for file in &files {
        clean(&file.path, &file.contents);
    }

    let html = projection.portable_html().unwrap().html;
    let markdown = projection.portable_markdown().unwrap();
    let text = projection.portable_text().unwrap();
    in_order(
        "html",
        &html,
        &["Ann noticed", "sound", "shared conclusion"],
    );
    in_order(
        "markdown",
        &markdown,
        &["Ann noticed", "**sound**", "shared conclusion"],
    );
    in_order(
        "text",
        &text,
        &["Ann noticed", "sound", "shared conclusion"],
    );
    for (label, output) in [("html", &html), ("markdown", &markdown), ("text", &text)] {
        assert!(output.contains("The Art of Noticing"), "{label}");
        assert!(output.contains("What did you notice?"), "{label}");
        clean(label, output);
    }

    // RSS: one dc:creator per author in section order, full content in order, canonical link.
    let rss = feeds::rss(&site).unwrap();
    in_order(
        "rss creators",
        &rss,
        &[
            "<dc:creator>Ann Ames</dc:creator>",
            "<dc:creator>Bo &lt;Bee&gt; &amp; Co</dc:creator>",
            "Cole</dc:creator>",
        ],
    );
    assert!(!rss.contains("Site Owner</dc:creator>"));
    assert!(rss.contains(&format!("<link>{canonical}</link>")));
    in_order(
        "rss content",
        &rss,
        &["Ann noticed", "sound", "shared conclusion"],
    );
    clean("rss", &rss);

    // JSON Feed: parsed, authors ordered and equal to the RSS creators, canonical id and url.
    let json = feeds::json_feed(&site).unwrap();
    let feed: serde_json::Value = serde_json::from_str(&json).unwrap();
    let item = &feed["items"][0];
    assert_eq!(item["url"], canonical.as_str());
    assert_eq!(item["id"], canonical.as_str());
    let authors: Vec<&str> = item["authors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(authors, NAMES);
    assert_eq!(item["authors"][1]["url"], "https://example.org/bo");
    in_order(
        "json html",
        item["content_html"].as_str().unwrap(),
        &["Ann noticed", "sound", "shared conclusion"],
    );
    in_order(
        "json text",
        item["content_text"].as_str().unwrap(),
        &["Ann noticed", "sound", "shared conclusion"],
    );
    clean("json feed", &json);

    for (label, output) in [
        ("llms-full", feeds::llms_full(&site).unwrap()),
        ("llms", feeds::llms_index(&site).unwrap()),
        ("sitemap", feeds::sitemap(&site, &[])),
        ("search", feeds::search_index(&site)),
    ] {
        clean(label, &output);
    }
}

#[test]
fn an_author_who_wrote_nothing_is_not_credited_in_any_feed() {
    let made = approved(&[("ann", SECTIONS[0]), ("cy", SECTIONS[2])]);
    let site = site(&made);
    let rss = feeds::rss(&site).unwrap();
    assert!(rss.contains("Ann Ames") && rss.contains("Cole</dc:creator>"));
    assert!(!rss.contains("Bee"));
    let json = feeds::json_feed(&site).unwrap();
    assert!(!json.contains("Bee"));
    clean("rss", &rss);
    clean("json feed", &json);
}

#[test]
fn a_replaced_revision_never_publishes_and_markup_shown_as_code_stays_text() {
    let made = approved(&[
        ("ann", "Ann says ]]> and `<b>` and & more."),
        ("bo", "Bo words"),
        ("cy", "Cy: [safe](https://example.org/a?x=1&y=2)"),
    ]);
    let site = site(&made);
    let rss = feeds::rss(&site).unwrap();
    clean("rss", &rss);
    assert!(!rss.contains("<b>"));
    let json: serde_json::Value = serde_json::from_str(&feeds::json_feed(&site).unwrap()).unwrap();
    let html = json["items"][0]["content_html"].as_str().unwrap();
    assert!(html.contains("&lt;b&gt;") && !html.contains("<b>"));
    for file in render::generate(&site, &ThemeSet::new()).unwrap() {
        clean(&file.path, &file.contents);
        if file.path.ends_with(".html") {
            assert!(!file.contents.contains("<b>"), "{}", file.path);
        }
    }
}

//! The participation registry, its site and post settings, and how comments
//! and B5's interim feedback rule map onto it (ADR 0100).

use openblog_core::model::CommentsPolicy;
use openblog_core::participation::{
    effective_mode, manifest, ParticipationKind, ParticipationMode, PostParticipation, SiteSetting,
};
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};

const HOSTED: &str = r#""engagement":{"enabled":true,"endpoint":"https://t.dev/api"}"#;

fn config(extra: &str) -> SiteConfig {
    let separator = if extra.is_empty() { "" } else { "," };
    SiteConfig::from_json(&format!(
        r#"{{"title":"T","url":"https://t.dev","postPath":"/{{slug}}/"{separator}{extra}}}"#
    ))
    .unwrap()
}

fn config_error(extra: &str) -> String {
    SiteConfig::from_json(&format!(r#"{{"title":"T","url":"https://t.dev",{extra}}}"#)).unwrap_err()
}

fn post(front_matter: &str) -> String {
    format!("---\ntitle: P\ndate: 2026-01-01\n{front_matter}---\nText")
}

fn site(config: SiteConfig, posts: &[(&str, String)]) -> Result<Site, String> {
    Site::load(
        config,
        Sources {
            posts: posts
                .iter()
                .map(|(path, contents)| SourceFile {
                    path: (*path).into(),
                    contents: contents.clone(),
                })
                .collect(),
            ..Sources::default()
        },
        LoadOptions::default(),
    )
    .map_err(|errors| {
        errors.join(
            "
",
        )
    })
}

fn entries(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

fn output<'a>(files: &'a [openblog_core::OutputFile], path: &str) -> Option<&'a str> {
    files
        .iter()
        .find(|file| file.path == path)
        .map(|file| file.contents.as_str())
}

#[test]
fn the_registry_is_closed_and_ids_round_trip() {
    let ids: Vec<_> = ParticipationKind::ALL
        .iter()
        .map(|kind| kind.id())
        .collect();
    assert_eq!(
        ids,
        [
            "comment",
            "question",
            "source-suggestion",
            "correction-suggestion",
            "alternative-interpretation",
            "third-perspective",
            "author-response",
            "abuse-report",
        ]
    );
    for kind in ParticipationKind::ALL {
        assert_eq!(ParticipationKind::from_id(kind.id()), Some(kind));
        // ADR 0088's stored kind shape.
        let id = kind.id();
        assert!(id.len() <= 40 && id.starts_with(|c: char| c.is_ascii_lowercase()));
        assert!(id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
    }
    assert_eq!(ParticipationKind::from_id("Comment"), None);
    assert_eq!(ParticipationKind::from_id("vote"), None);
    // Only abuse reports are never public; only authors write responses.
    for kind in ParticipationKind::ALL {
        let rules = kind.rules();
        assert_eq!(rules.publishable, kind != ParticipationKind::AbuseReport);
        assert_eq!(
            rules.origin == openblog_core::participation::Origin::Author,
            kind == ParticipationKind::AuthorResponse
        );
    }
}

#[test]
fn every_kind_beyond_comments_is_off_by_default_and_the_config_file_is_unchanged() {
    let default = SiteConfig::default();
    assert!(default.participation.is_default());
    assert!(!default.to_json().contains("participation"));
    for kind in ParticipationKind::ALL {
        assert_eq!(default.participation.setting(kind), SiteSetting::Off);
    }
    let hosted = config(HOSTED);
    assert!(!hosted.to_json().contains("participation"));
    let site = site(
        hosted.clone(),
        &[(
            "posts/a.md",
            post("participation: [question: open, third-perspective: open]\n"),
        )],
    )
    .unwrap();
    for kind in ParticipationKind::ALL {
        let expected = if kind == ParticipationKind::Comment {
            ParticipationMode::Open
        } else {
            ParticipationMode::Hidden
        };
        assert_eq!(
            effective_mode(&hosted, &site.posts[0], kind),
            expected,
            "{kind}"
        );
    }
    assert_eq!(manifest(&site), None);
}

#[test]
fn site_settings_parse_by_kind_id_and_round_trip() {
    let parsed = config(&format!(
        r#"{HOSTED},"participation":{{"kinds":{{"question":"open","third-perspective":"hidden","source-suggestion":"follow-comments","abuse-report":"open"}},"retention":{{"pendingDays":60}}}}"#
    ));
    let kinds = &parsed.participation;
    assert_eq!(
        kinds.setting(ParticipationKind::Question),
        SiteSetting::Open
    );
    assert_eq!(
        kinds.setting(ParticipationKind::ThirdPerspective),
        SiteSetting::Hidden
    );
    assert_eq!(
        kinds.setting(ParticipationKind::SourceSuggestion),
        SiteSetting::FollowComments
    );
    assert_eq!(
        kinds.setting(ParticipationKind::AbuseReport),
        SiteSetting::Open
    );
    assert_eq!(
        kinds.setting(ParticipationKind::CorrectionSuggestion),
        SiteSetting::Off
    );
    assert_eq!(kinds.retention.pending_days, 60);
    assert_eq!(kinds.retention.audit_days, 365);
    let again = SiteConfig::from_json(&parsed.to_json()).unwrap();
    assert_eq!(again.participation, parsed.participation);
}

#[test]
fn invalid_site_settings_are_refused_with_a_named_field() {
    let cases = [
        (
            r#""participation":{"kinds":{"vote":"open"}}"#,
            "unknown participation kind `vote`",
        ),
        (
            r#""participation":{"kinds":{"comment":"open"}}"#,
            "comments keep `engagement.comments`",
        ),
        (
            r#""participation":{"kinds":{"abuse-report":"locked"}}"#,
            "abuse-report must be `off` or `open`",
        ),
        (
            r#""participation":{"kinds":{"abuse-report":"follow-comments"}}"#,
            "abuse-report must be `off` or `open`",
        ),
        (
            r#""participation":{"kinds":{"question":"maybe"}}"#,
            "unknown variant",
        ),
        (r#""participation":{"moderators":[]}"#, "unknown field"),
        (
            r#""participation":{"retention":{"pendingDays":0}}"#,
            "retention.pendingDays must be between 1 and 3650",
        ),
        (
            r#""participation":{"retention":{"closedDays":3651}}"#,
            "retention.closedDays must be between 1 and 3650",
        ),
        (
            r#""participation":{"retention":{"closedDays":90,"auditDays":30}}"#,
            "auditDays must be at least closedDays",
        ),
        (
            r#""participation":{"retention":{"forever":true}}"#,
            "unknown field",
        ),
    ];
    for (json, expected) in cases {
        let error = config_error(json);
        assert!(error.contains(expected), "{json}: {error}");
        assert!(error.starts_with("invalid openblog.json"), "{error}");
    }
}

#[test]
fn post_front_matter_names_kinds_as_a_block_or_an_inline_list() {
    let site = site(
        config(""),
        &[
            (
                "posts/block.md",
                post("participation:\n  - question: open\n  - third-perspective: LOCKED\n"),
            ),
            (
                "posts/inline.md",
                post("participation: [author-response: hidden, source-suggestion: open]\n"),
            ),
            ("posts/single.md", post("participation: question: locked\n")),
            ("posts/none.md", post("")),
        ],
    )
    .unwrap();
    let find = |slug: &str| site.posts.iter().find(|post| post.slug == slug).unwrap();
    let block = &find("block").participation;
    assert_eq!(
        block.get(ParticipationKind::Question),
        Some(ParticipationMode::Open)
    );
    assert_eq!(
        block.get(ParticipationKind::ThirdPerspective),
        Some(ParticipationMode::Locked)
    );
    let inline = &find("inline").participation;
    assert_eq!(
        inline.get(ParticipationKind::AuthorResponse),
        Some(ParticipationMode::Hidden)
    );
    assert_eq!(
        inline.get(ParticipationKind::SourceSuggestion),
        Some(ParticipationMode::Open)
    );
    assert_eq!(
        find("single")
            .participation
            .get(ParticipationKind::Question),
        Some(ParticipationMode::Locked)
    );
    assert!(find("none").participation.is_empty());
}

#[test]
fn invalid_post_settings_are_refused() {
    let cases = [
        (&["question"][..], "participation entries are `kind: mode`"),
        (&["vote: open"][..], "unknown participation kind `vote`"),
        (&["comment: open"][..], "set comments with `comments:`"),
        (
            &["abuse-report: open"][..],
            "abuse reports are set for the whole site",
        ),
        (
            &["question: sometimes"][..],
            "must be `open`, `locked`, or `hidden`",
        ),
        (
            &["question: open", "question: hidden"][..],
            "participation names `question` twice",
        ),
    ];
    for (values, expected) in cases {
        let error = PostParticipation::parse(&entries(values)).unwrap_err();
        assert!(error.contains(expected), "{values:?}: {error}");
    }
    let error = site(
        config(""),
        &[("posts/bad.md", post("participation: [vote: open]\n"))],
    )
    .unwrap_err();
    assert!(error.contains("unknown participation kind"), "{error}");
}

/// The comment row of the policy reproduces the rule pages used before it:
/// hosted engagement on, `engagement.comments` on, an endpoint, and the
/// post's `comments:` setting.
#[test]
fn existing_comment_settings_keep_their_meaning() {
    for enabled in [false, true] {
        for comments in [false, true] {
            for endpoint in ["", "https://t.dev/api"] {
                let json = format!(
                    r#""engagement":{{"enabled":{enabled},"comments":{comments},"endpoint":"{endpoint}"}}"#
                );
                // An enabled engagement needs an endpoint to load at all.
                let Ok(config) = SiteConfig::from_json(&format!(
                    r#"{{"title":"T","url":"https://t.dev",{json}}}"#
                )) else {
                    assert!(enabled && endpoint.is_empty());
                    continue;
                };
                for (value, policy) in [
                    ("", CommentsPolicy::Open),
                    ("comments: open\n", CommentsPolicy::Open),
                    ("comments: locked\n", CommentsPolicy::Locked),
                    ("comments: hidden\n", CommentsPolicy::Hidden),
                    ("comments: false\n", CommentsPolicy::Hidden),
                ] {
                    let site = site(config.clone(), &[("posts/a.md", post(value))]).unwrap();
                    let post = &site.posts[0];
                    assert_eq!(post.comments, policy);
                    let before = if enabled && comments && !endpoint.is_empty() {
                        policy.into()
                    } else {
                        ParticipationMode::Hidden
                    };
                    assert_eq!(
                        effective_mode(&config, post, ParticipationKind::Comment),
                        before,
                        "{json} {value}"
                    );
                }
            }
        }
    }
}

/// B5's interim rule (ADR 0089): feedback follows each post's `comments:`
/// setting, whatever `engagement.comments` says. `follow-comments` is that
/// rule; a post's own setting for the kind wins over it.
#[test]
fn follow_comments_is_the_b5_interim_rule_and_a_post_can_override_it() {
    let feedback = [
        ParticipationKind::Question,
        ParticipationKind::SourceSuggestion,
        ParticipationKind::CorrectionSuggestion,
        ParticipationKind::AlternativeInterpretation,
    ];
    let kinds = feedback
        .iter()
        .map(|kind| format!(r#""{}":"follow-comments""#, kind.id()))
        .collect::<Vec<_>>()
        .join(",");
    for comments_switch in [true, false] {
        let config = config(&format!(
            r#""engagement":{{"enabled":true,"comments":{comments_switch},"endpoint":"https://t.dev/api"}},"participation":{{"kinds":{{{kinds}}}}}"#
        ));
        let site = site(
            config.clone(),
            &[
                ("posts/open.md", post("")),
                ("posts/locked.md", post("comments: locked\n")),
                ("posts/hidden.md", post("comments: hidden\n")),
                (
                    "posts/override.md",
                    post("comments: hidden\nparticipation: [question: open]\n"),
                ),
            ],
        )
        .unwrap();
        for post in &site.posts {
            for kind in feedback {
                let expected = match (post.slug.as_str(), kind) {
                    ("override", ParticipationKind::Question) => ParticipationMode::Open,
                    _ => post.comments.into(),
                };
                assert_eq!(
                    effective_mode(&config, post, kind),
                    expected,
                    "{}",
                    post.slug
                );
            }
        }
    }
}

#[test]
fn a_site_default_applies_where_a_post_is_silent_and_off_cannot_be_overridden() {
    let config = config(&format!(
        r#"{HOSTED},"participation":{{"kinds":{{"question":"hidden","third-perspective":"open","abuse-report":"open"}}}}"#
    ));
    let site = site(
        config.clone(),
        &[
            ("posts/silent.md", post("comments: hidden\n")),
            (
                "posts/chosen.md",
                post("participation: [question: open, third-perspective: locked, correction-suggestion: open]\n"),
            ),
        ],
    )
    .unwrap();
    let find = |slug: &str| site.posts.iter().find(|post| post.slug == slug).unwrap();
    let mode = |slug: &str, kind| effective_mode(&config, find(slug), kind);
    assert_eq!(
        mode("silent", ParticipationKind::Question),
        ParticipationMode::Hidden
    );
    assert_eq!(
        mode("silent", ParticipationKind::ThirdPerspective),
        ParticipationMode::Open
    );
    assert_eq!(
        mode("chosen", ParticipationKind::Question),
        ParticipationMode::Open
    );
    assert_eq!(
        mode("chosen", ParticipationKind::ThirdPerspective),
        ParticipationMode::Locked
    );
    // The site never switched suggested corrections on.
    assert_eq!(
        mode("chosen", ParticipationKind::CorrectionSuggestion),
        ParticipationMode::Hidden
    );
    // Abuse reports are site-wide, even on a post whose comments are hidden.
    assert_eq!(
        mode("silent", ParticipationKind::AbuseReport),
        ParticipationMode::Open
    );
    assert_eq!(
        mode("chosen", ParticipationKind::AuthorResponse),
        ParticipationMode::Hidden
    );

    // Without the hosted transport everything is hidden.
    let offline = SiteConfig {
        engagement: Default::default(),
        ..config.clone()
    };
    for kind in ParticipationKind::ALL {
        assert_eq!(
            effective_mode(&offline, find("chosen"), kind),
            ParticipationMode::Hidden
        );
    }
}

#[test]
fn the_participation_manifest_is_published_only_once_a_new_kind_is_switched_on() {
    let posts = [
        ("posts/open.md", post("")),
        ("posts/hidden.md", post("comments: hidden\n")),
        (
            "posts/questions.md",
            post("comments: locked\nparticipation: [question: open]\n"),
        ),
    ];
    // Default: no new file, and the comment manifest is what it always was.
    let plain = generate(&site(config(HOSTED), &posts).unwrap(), &ThemeSet::new()).unwrap();
    assert_eq!(output(&plain, "openblog-participation.json"), None);
    assert_eq!(
        output(&plain, "openblog-comments.json"),
        Some(r#"{"/hidden/":"hidden","/open/":"open","/questions/":"locked"}"#)
    );

    let enabled = config(&format!(
        r#"{HOSTED},"participation":{{"kinds":{{"question":"hidden","abuse-report":"open"}}}}"#
    ));
    let files = generate(&site(enabled.clone(), &posts).unwrap(), &ThemeSet::new()).unwrap();
    assert_eq!(
        output(&files, "openblog-participation.json"),
        Some(
            r#"{"/hidden/":{"abuse-report":"open"},"/open/":{"abuse-report":"open","comment":"open"},"/questions/":{"abuse-report":"open","comment":"locked","question":"open"}}"#
        )
    );
    assert_eq!(
        output(&files, "openblog-comments.json"),
        output(&plain, "openblog-comments.json")
    );

    // Switched on but no hosted transport: nothing to publish.
    let offline = SiteConfig {
        engagement: Default::default(),
        ..enabled
    };
    let files = generate(&site(offline, &posts).unwrap(), &ThemeSet::new()).unwrap();
    assert_eq!(output(&files, "openblog-participation.json"), None);
}

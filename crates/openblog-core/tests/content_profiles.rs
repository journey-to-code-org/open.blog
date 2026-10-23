use openblog_core::{
    frontmatter, generate, model, profile, LoadOptions, Site, SiteConfig, SourceFile, Sources,
    ThemeSet,
};

fn fields(source: &str) -> frontmatter::FrontMatter {
    frontmatter::parse(source).unwrap().front_matter
}

#[test]
fn defaults_articles_and_resolves_the_legacy_recipe_marker() {
    let article = profile::resolve(&fields("---\ntitle: Notes\n---\nBody"));
    assert_eq!(article.id, "article");
    assert_eq!(article.behavior, profile::ProfileBehavior::Article);
    assert!(article.warnings.is_empty());

    let recipe = profile::resolve(&fields("---\nrecipe: true\n---\nBody"));
    assert_eq!(recipe.id, "recipe");
    assert_eq!(recipe.behavior, profile::ProfileBehavior::Recipe);
    assert!(recipe.warnings.is_empty());
}

#[test]
fn canonical_profile_wins_when_a_legacy_marker_disagrees() {
    let resolved = profile::resolve(&fields("---\nprofile: article\nrecipe: true\n---\nBody"));

    assert_eq!(resolved.id, "article");
    assert_eq!(resolved.behavior, profile::ProfileBehavior::Article);
    assert_eq!(
        resolved.warnings,
        vec!["profile `article` overrides the legacy recipe marker"]
    );
}

#[test]
fn unknown_profiles_keep_the_authored_id_and_fall_back_to_article_behavior() {
    let resolved = profile::resolve(&fields("---\nprofile: Field-Notes\n---\nBody"));

    assert_eq!(resolved.id, "Field-Notes");
    assert_eq!(resolved.behavior, profile::ProfileBehavior::Article);
    assert_eq!(
        resolved.warnings,
        vec!["unknown content profile `Field-Notes`; rendering as an article"]
    );
}

#[test]
fn catalog_describes_profiles_and_their_authoring_fields() {
    let profiles = profile::catalog();
    assert_eq!(
        profiles.iter().map(|item| item.id).collect::<Vec<_>>(),
        vec!["article", "recipe", "research", "video"]
    );
    assert_eq!(profiles[0].label, "Article");
    assert!(profiles[0].fields.is_empty());
    assert_eq!(
        profiles[1]
            .fields
            .iter()
            .map(|field| field.key)
            .collect::<Vec<_>>(),
        vec![
            "servings",
            "yield",
            "prepTime",
            "cookTime",
            "totalTime",
            "cuisine",
            "category",
            "calories"
        ]
    );
    assert_eq!(profiles[2].label, "Research");
    assert_eq!(
        profiles[2]
            .fields
            .iter()
            .map(|field| field.key)
            .collect::<Vec<_>>(),
        vec!["doi", "license"]
    );
    assert_eq!(profiles[3].label, "Video production");
    assert_eq!(
        profiles[3]
            .fields
            .iter()
            .map(|field| field.key)
            .collect::<Vec<_>>(),
        vec!["videoUrl", "duration", "thumbnail", "aiDisclosure"]
    );
}

#[test]
fn resolves_the_research_profile_without_changing_article_or_recipe_behavior() {
    let resolved = profile::resolve(&fields(
        "---\nprofile: research\ndoi: 10.1234/example\n---\nBody",
    ));

    assert_eq!(resolved.id, "research");
    assert_eq!(resolved.behavior, profile::ProfileBehavior::Research);
    assert!(resolved.warnings.is_empty());
}

#[test]
fn resolves_and_loads_the_video_profile() {
    let resolved = profile::resolve(&fields(
        "---\nprofile: video\nvideoUrl: https://youtu.be/dQw4w9WgXcQ\n---\nBody",
    ));
    assert_eq!(resolved.id, "video");
    assert_eq!(resolved.behavior, profile::ProfileBehavior::Video);

    let post = model::load_post(
        &SourceFile {
            path: "posts/episode.md".into(),
            contents: "---\ntitle: Episode one\ndate: 2026-10-23\nprofile: video\nvideoUrl: https://www.youtube.com/watch?v=dQw4w9WgXcQ\nduration: 12 min 34 sec\nthumbnail: /images/episode.jpg\naiDisclosure: AI-assisted animation\n---\n## Transcript\nOpening narration."
                .into(),
        },
        &SiteConfig::default(),
        Default::default(),
    )
    .unwrap();

    let video = post.video.expect("video metadata");
    assert_eq!(video.youtube_id.as_deref(), Some("dQw4w9WgXcQ"));
    assert_eq!(video.duration_seconds, Some(754));
    assert_eq!(video.thumbnail.as_deref(), Some("/images/episode.jpg"));
    assert_eq!(
        video.ai_disclosure.as_deref(),
        Some("AI-assisted animation")
    );
}

#[test]
fn loaded_posts_expose_the_resolved_profile_and_obey_canonical_precedence() {
    let post = model::load_post(
        &SourceFile {
            path: "posts/supper.md".into(),
            contents: "---\ntitle: Supper\ndate: 2026-10-23\nprofile: article\nrecipe: true\n---\n## Ingredients\n- Beans\n\n## Steps\n1. Cook"
                .into(),
        },
        &SiteConfig::default(),
        Default::default(),
    )
    .unwrap();

    assert_eq!(post.profile, "article");
    assert!(post.recipe.is_none());
}

#[test]
fn site_load_surfaces_profile_fallbacks_as_source_scoped_warnings() {
    let site = Site::load(
        SiteConfig::default(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/notes.md".into(),
                contents:
                    "---\ntitle: Notes\ndate: 2026-10-23\nprofile: field-notes\n---\n## Entry\nBody"
                        .into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();

    assert_eq!(site.posts[0].profile, "field-notes");
    assert!(site.warnings.contains(
        &"posts/notes.md: unknown content profile `field-notes`; rendering as an article"
            .to_string()
    ));
}

#[test]
fn canonical_recipe_profile_keeps_legacy_generated_output_byte_for_byte() {
    let build = |marker: &str| {
        let site = Site::load(
            SiteConfig::from_json(
                r#"{"title":"Kitchen","url":"https://food.example","postPath":"/{slug}/"}"#,
            )
            .unwrap(),
            Sources {
                posts: vec![SourceFile {
                    path: "posts/soup.md".into(),
                    contents: format!(
                        "---\ntitle: Soup\ndate: 2026-10-23\n{marker}\nservings: 4\nprepTime: 10 min\n---\n## Ingredients\n- Water\n\n## Steps\n1. Simmer"
                    ),
                }],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        generate(&site, &ThemeSet::new()).unwrap()
    };

    assert_eq!(build("profile: recipe"), build("recipe: true"));
}

//! The recipe listing: `/recipes/` and a filter page per course and cuisine
//! (ADR 0352). Plain links, so it works without JavaScript; a site with no
//! recipes builds exactly as it did.

use openblog_core::{
    generate, generate_document, recipe_listing, LoadOptions, OutputFile, Site, SiteConfig,
    SourceFile, Sources, ThemeSet,
};

fn file(path: &str, contents: &str) -> SourceFile {
    SourceFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn config(extra: &str) -> SiteConfig {
    SiteConfig::from_json(&format!(
        r#"{{"title":"Kitchen","url":"https://kitchen.example","postPath":"/{{slug}}/","author":{{"name":"Mom","url":"https://kitchen.example/about/"}}{extra}}}"#
    ))
    .unwrap()
}

fn load(extra: &str, sources: Sources) -> Site {
    Site::load(config(extra), sources, LoadOptions::default()).unwrap()
}

fn build(site: &Site) -> Vec<OutputFile> {
    generate(site, &ThemeSet::new()).unwrap()
}

#[test]
fn a_site_with_no_recipes_is_byte_for_byte_what_it_was() {
    // Every generated file, pinned. The golden was written on the build before
    // the listing (fbbc9870); set `OPENBLOG_UPDATE_GOLDEN=1` to rewrite it only
    // for a deliberate change to these pages.
    let sources = Sources {
        posts: vec![
            file(
                "posts/notes.md",
                "---\ntitle: Notes\ndate: 2026-09-02\ntags: [garden]\nseries: seasons\n---\nWords.\n",
            ),
            file(
                "posts/study.md",
                "---\ntitle: Study\ndate: 2026-09-03\nprofile: research\ndoi: 10.1234/study\n---\n## Abstract\n\nSummary.\n",
            ),
        ],
        series: vec![file(
            "series/seasons.md",
            "---\ntitle: Seasons\n---\nThe year.\n",
        )],
        pages: vec![file("about.md", "---\ntitle: About\nnav: true\n---\nAbout me.\n")],
        ..Default::default()
    };
    let files = build(&load("", sources));
    let mut pinned = String::new();
    for output in &files {
        pinned.push_str(&format!("===== {}\n{}\n", output.path, output.contents));
    }
    let golden = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/recipe_listing/no-recipes.txt"
    );
    if std::env::var_os("OPENBLOG_UPDATE_GOLDEN").is_some() {
        std::fs::create_dir_all(std::path::Path::new(golden).parent().unwrap()).unwrap();
        std::fs::write(golden, &pinned).unwrap();
    }
    let expected = std::fs::read_to_string(golden)
        .expect("missing golden")
        .replace("\r\n", "\n");
    assert_eq!(pinned, expected);
}

fn recipe(name: &str, date: &str, fields: &str) -> SourceFile {
    SourceFile {
        path: format!("posts/{name}.md"),
        contents: format!(
            "---\ntitle: {name}\ndate: {date}\nprofile: recipe\n{fields}\n---\n## Ingredients\n\n- Water\n\n## Steps\n\n1. Boil.\n"
        ),
    }
}

fn article(name: &str, date: &str) -> SourceFile {
    SourceFile {
        path: format!("posts/{name}.md"),
        contents: format!("---\ntitle: {name}\ndate: {date}\n---\nWords.\n"),
    }
}

fn site_of(posts: Vec<SourceFile>, pages: Vec<SourceFile>, extra: &str) -> Site {
    load(
        extra,
        Sources {
            posts,
            pages,
            ..Default::default()
        },
    )
}

fn page(path: &str, front: &str) -> SourceFile {
    file(path, &format!("---\n{front}\n---\nMine.\n"))
}

fn find<'a>(files: &'a [OutputFile], path: &str) -> &'a str {
    &files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} missing"))
        .contents
}

fn has(files: &[OutputFile], path: &str) -> bool {
    files.iter().any(|f| f.path == path)
}

/// The filter nav of a page, and nothing else of it.
fn filters(page: &str) -> &str {
    let start = page
        .find("<nav class=\"ob-recipe-filters\"")
        .expect("no filters");
    let end = page[start..].find("</nav>").unwrap();
    &page[start..start + end]
}

fn main_nav(page: &str) -> &str {
    let start = page.find("aria-label=\"Main navigation\"").unwrap();
    let end = page[start..].find("</nav>").unwrap();
    &page[start..start + end]
}

fn kitchen() -> Vec<SourceFile> {
    vec![
        recipe(
            "tiramisu",
            "2026-10-03",
            "course: Dessert\ncuisine: Italian",
        ),
        recipe("greens", "2026-10-02", "course: Dinner\ncuisine: Southern"),
        recipe(
            "panna-cotta",
            "2026-10-01",
            "course: dessert\ncuisine: Italian",
        ),
        article("garden", "2026-10-04"),
    ]
}

#[test]
fn no_recipes_means_no_listing_and_a_page_called_recipes_is_untouched() {
    let site = site_of(
        vec![article("garden", "2026-10-04")],
        vec![page("recipes.md", "title: My recipes\nnav: true")],
        "",
    );
    assert!(recipe_listing::plan(&site).archives.is_empty());
    assert!(site.warnings.iter().all(|w| !w.contains("/recipes/")));
    let files = build(&site);
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    assert!(paths.contains(&"recipes/index.html"));
    assert_eq!(
        paths.iter().filter(|p| p.starts_with("recipes/")).count(),
        1
    );
    assert!(find(&files, "recipes/index.html").contains("Mine."));
    assert_eq!(
        find(&files, "index.html").matches("/recipes/\"").count(),
        1,
        "only the owner's own nav entry"
    );

    let none = site_of(vec![article("garden", "2026-10-04")], vec![], "");
    let files = build(&none);
    assert!(files.iter().all(|f| !f.path.starts_with("recipes/")));
    assert!(!find(&files, "index.html").contains("/recipes/"));
    assert!(!find(&files, "sitemap.xml").contains("/recipes/"));
}

#[test]
fn drafts_and_scheduled_recipes_publish_nothing() {
    let draft = recipe("secret", "2026-10-01", "draft: true\ncourse: Dessert");
    let scheduled = recipe("later", "2099-01-01", "course: Dessert");
    let posts = vec![draft.clone(), article("garden", "2026-10-04")];
    let site = site_of(posts, vec![], "");
    assert_eq!(recipe_listing::plan(&site), Default::default());
    assert!(build(&site).iter().all(|f| !f.path.starts_with("recipes/")));

    let now = openblog_core::DateTime::parse("2026-11-01").unwrap();
    let held = Site::load(
        config(""),
        Sources {
            posts: vec![scheduled.clone(), article("garden", "2026-10-04")],
            ..Default::default()
        },
        LoadOptions {
            now: Some(now),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(recipe_listing::plan(&held), Default::default());

    // A preview or Admin load holds these posts; they still open no listing.
    let preview = Site::load(
        config(""),
        Sources {
            posts: vec![draft, scheduled],
            ..Default::default()
        },
        LoadOptions {
            include_drafts: true,
            now: Some(now),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(preview.posts.len(), 2);
    assert_eq!(recipe_listing::plan(&preview), Default::default());
    let home = openblog_core::generate_home(&preview, &ThemeSet::new()).unwrap();
    assert!(!main_nav(&home.contents).contains("/recipes/"));
}

#[test]
fn each_course_and_cuisine_gets_pages_newest_first_and_the_listing_stays_out_of_the_feeds() {
    let mut posts = kitchen();
    posts.push(recipe("mousse", "2025-10-01", "course: Dessert"));
    let site = site_of(posts.clone(), vec![], r#","postsPerPage":2"#);
    let files = build(&site);

    let all = find(&files, "recipes/index.html");
    assert!(all.contains("<title>Recipes"));
    assert!(!all.contains("garden"), "articles are not recipes");
    assert!(all.find("tiramisu").unwrap() < all.find("greens").unwrap());
    assert!(has(&files, "recipes/page/2/index.html"));

    let dessert = find(&files, "recipes/course/dessert/index.html");
    assert!(dessert.contains("Dessert recipes"));
    assert!(dessert.contains("Dessert recipes, newest first."));
    assert!(dessert.find("tiramisu").unwrap() < dessert.find("panna-cotta").unwrap());
    assert!(!dessert.contains("/greens/"));
    let second = find(&files, "recipes/course/dessert/page/2/index.html");
    assert!(second.contains("Dessert recipes · Page 2"));
    assert!(second.contains("/mousse/"));
    assert!(second.contains("rel=\"prev\" href=\"/recipes/course/dessert/\""));
    assert!(has(&files, "recipes/cuisine/italian/index.html"));
    assert!(has(&files, "recipes/cuisine/southern/index.html"));
    // These only ever exist as filter pages: the chips do the indexing's job.
    assert!(!has(&files, "recipes/course/index.html"));
    assert!(!has(&files, "recipes/cuisine/index.html"));

    let sitemap = find(&files, "sitemap.xml");
    assert!(sitemap.contains("https://kitchen.example/recipes/</loc>"));
    assert!(sitemap.contains("https://kitchen.example/recipes/course/dessert/</loc>"));
    assert!(sitemap.contains("https://kitchen.example/recipes/cuisine/southern/</loc>"));
    assert!(!sitemap.contains("/recipes/page/2/"));
    assert!(!sitemap.contains("/recipes/course/dessert/page/2/"));
    assert!(!find(&files, "rss.xml").contains("/recipes/course/"));
    assert!(!find(&files, "feed.json").contains("/recipes/course/"));

    let again = build(&site_of(posts, vec![], r#","postsPerPage":2"#));
    assert_eq!(files, again, "deterministic");
}

#[test]
fn values_split_on_commas_merge_by_address_and_are_escaped() {
    let site = site_of(
        vec![
            recipe(
                "newest",
                "2026-10-05",
                "course: Lunch, DINNER\ncuisine: \"Andalusian & <Italian>\"",
            ),
            recipe("older", "2026-10-04", "course: dinner\ncuisine: crème"),
            recipe("emoji", "2026-10-03", "course: \"\u{1F370}\""),
            recipe("twice", "2026-10-02", "course: Soup, soup"),
        ],
        vec![],
        "",
    );
    let files = build(&site);
    let dinner = find(&files, "recipes/course/dinner/index.html");
    assert!(dinner.contains("DINNER recipes"), "the newest spelling");
    assert!(dinner.contains("/newest/") && dinner.contains("/older/"));
    assert!(has(&files, "recipes/course/lunch/index.html"));
    assert!(has(&files, "recipes/cuisine/crème/index.html"));
    assert!(
        files.iter().all(|f| !f.path.contains("course//")),
        "a value with no letters gets no page"
    );
    let nav = filters(find(&files, "recipes/index.html"));
    assert!(nav.contains("Andalusian &amp; &lt;Italian&gt;"));
    assert!(!nav.contains("<Italian>"));
    assert!(!nav.contains('\u{1F370}'));
    let soup = recipe_listing::plan(&site)
        .archives
        .into_iter()
        .find(|a| a.url == "/recipes/course/soup/")
        .unwrap();
    assert_eq!(soup.posts.len(), 1, "one recipe, one entry");
}

#[test]
fn the_legacy_marker_and_the_category_spelling_are_both_listed() {
    let legacy = file(
        "posts/old.md",
        "---\ntitle: old\ndate: 2026-10-01\nrecipe: true\ncategory: Bread\n---\nBody.\n",
    );
    let also = recipe("newer", "2026-10-02", "recipeCategory: Bread");
    let files = build(&site_of(vec![legacy, also], vec![], ""));
    let bread = find(&files, "recipes/course/bread/index.html");
    assert!(bread.contains("/old/") && bread.contains("/newer/"));
}

#[test]
fn the_filters_are_plain_links_that_mark_the_current_one_on_every_page() {
    let posts = vec![
        recipe("a", "2026-10-03", "course: Dessert\ncuisine: Italian"),
        recipe("b", "2026-10-02", "course: Dessert"),
        recipe("c", "2026-10-01", "course: Dinner"),
    ];
    let files = build(&site_of(posts, vec![], r#","postsPerPage":1"#));
    for path in [
        "recipes/index.html",
        "recipes/course/dessert/index.html",
        "recipes/course/dessert/page/2/index.html",
    ] {
        let nav = filters(find(&files, path));
        for absent in [
            "<form",
            "<script",
            "ob-list-pagination",
            "<input",
            "<select",
        ] {
            assert!(!nav.contains(absent), "{path}: {absent}");
        }
        assert!(nav.contains("href=\"/recipes/\""), "{path}");
        assert!(
            nav.contains("By course") && nav.contains("By cuisine"),
            "{path}"
        );
        assert!(find(&files, path).contains("href=\"/recipes/cuisine/italian/\""));
        assert!(!find(&files, path).contains("ob-list-pagination"), "{path}");
    }
    // The chip links to the filter's first page, so only that page may call it "this page".
    for (path, current) in [
        ("recipes/course/dessert/index.html", "page"),
        ("recipes/course/dessert/page/2/index.html", "true"),
    ] {
        let nav = filters(find(&files, path));
        assert!(
            nav.contains(&format!(
                "<a href=\"/recipes/course/dessert/\" aria-current=\"{current}\"><strong>Dessert</strong> <span class=\"ob-count\">2<span class=\"ob-visually-hidden\"> recipes</span></span></a>"
            )),
            "{path}: {nav}"
        );
        assert_eq!(nav.matches("aria-current").count(), 1);
    }
    assert!(filters(find(&files, "recipes/index.html"))
        .contains("<a href=\"/recipes/\" aria-current=\"page\"><strong>All recipes</strong></a>"));
    assert!(filters(find(&files, "recipes/page/2/index.html"))
        .contains("<a href=\"/recipes/\" aria-current=\"true\"><strong>All recipes</strong></a>"));
    assert!(find(&files, "recipes/course/dessert/index.html")
        .contains("<p class=\"ob-eyebrow\"><a href=\"/recipes/\">Recipes</a></p>"));
}

#[test]
fn an_empty_group_or_no_values_at_all_leaves_out_what_it_would_say() {
    let only_courses = build(&site_of(
        vec![recipe("a", "2026-10-03", "course: Dessert")],
        vec![],
        "",
    ));
    let nav = filters(find(&only_courses, "recipes/index.html"));
    assert!(nav.contains("By course") && !nav.contains("By cuisine"));

    let bare = build(&site_of(vec![recipe("a", "2026-10-03", "")], vec![], ""));
    assert!(find(&bare, "recipes/index.html").contains("/a/"));
    assert!(!find(&bare, "recipes/index.html").contains("ob-recipe-filters"));
}

#[test]
fn a_page_at_the_address_keeps_it_and_the_list_moves_with_a_plain_warning() {
    let site = site_of(kitchen(), vec![page("recipes.md", "title: My recipes")], "");
    assert!(
        site.warnings.iter().any(|w| w
            == "A page of yours already uses the address /recipes/, so the automatic list of recipes is at /recipes/all/. To move the list back, open your page \"My recipes\", and in Settings change its Slug, the last part of its web address, to another name, such as my-recipes."),
        "{:?}",
        site.warnings
    );
    let files = build(&site);
    assert!(find(&files, "recipes/index.html").contains("Mine."));
    let moved = find(&files, "recipes/all/index.html");
    assert!(moved.contains("/tiramisu/"));
    assert!(filters(moved).contains("href=\"/recipes/all/\""));
    assert!(main_nav(moved).contains("href=\"/recipes/all/\""));
    assert!(find(&files, "sitemap.xml").contains("/recipes/all/</loc>"));
    assert!(find(&files, "recipes/course/dessert/index.html")
        .contains("<a href=\"/recipes/all/\">Recipes</a>"));
}

#[test]
fn with_both_addresses_taken_the_filter_pages_stay_without_an_all_chip() {
    let site = site_of(
        kitchen(),
        vec![page(
            "recipes.md",
            "title: My recipes\naliases: [/recipes/all/]",
        )],
        "",
    );
    let plan = recipe_listing::plan(&site);
    assert_eq!(plan.all_url, None);
    assert_eq!(plan.notes.len(), 1);
    assert!(site.warnings.contains(&plan.notes[0]));
    assert!(
        plan.notes[0].contains("open your page \"My recipes\", and in Settings change its Slug")
    );
    let files = build(&site);
    let dessert = find(&files, "recipes/course/dessert/index.html");
    assert!(!filters(dessert).contains("All recipes"));
    assert!(dessert.contains("<p class=\"ob-eyebrow\">Recipes</p>"));
    assert!(!main_nav(dessert).contains("/recipes/"));
}

#[test]
fn a_post_path_under_recipes_shares_the_address_without_a_clash() {
    let mut config = config("");
    config.post_path = "/recipes/{slug}/".into();
    let site = Site::load(
        config,
        Sources {
            posts: vec![
                recipe("course", "2026-10-03", "course: Dessert"),
                recipe("all", "2026-10-02", "cuisine: Greek"),
                recipe("page", "2026-10-01", "cuisine: Thai"),
            ],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    assert!(recipe_listing::plan(&site).notes.is_empty());
    let files = build(&site);
    assert!(find(&files, "recipes/index.html").contains("All recipes"));
    assert!(has(&files, "recipes/course/index.html"));
    assert!(has(&files, "recipes/course/dessert/index.html"));
    assert!(has(&files, "recipes/all/index.html"));
    assert!(has(&files, "recipes/page/index.html"));
}

#[test]
fn an_alias_on_a_filter_address_drops_only_that_filter() {
    let site = site_of(
        kitchen(),
        vec![page(
            "sweets.md",
            "title: Sweets\naliases: [/recipes/course/dessert/]",
        )],
        "",
    );
    assert!(
        site.warnings
            .iter()
            .any(|w| w.contains("/recipes/course/dessert/")
                && w.contains("Dessert")
                && w.contains("remove the old address /recipes/course/dessert/ from the file of your page \"Sweets\"")
                && w.contains("Admin has no setting for it")
                && !w.contains("aliases")
                && !w.contains("Slug")),
        "{:?}",
        site.warnings
    );
    let files = build(&site);
    let nav = filters(find(&files, "recipes/index.html")).to_string();
    assert!(!nav.contains("Dessert"));
    assert!(nav.contains("Dinner") && nav.contains("Italian"));
    assert!(!find(&files, "recipes/course/dessert/index.html").contains("ob-recipe-filters"));
}

#[test]
fn a_first_recipe_can_still_be_saved_beside_a_page_called_recipes() {
    let source = "pages/recipes.md";
    let site = site_of(
        kitchen(),
        vec![page(source, "title: My recipes\nslug: recipes")],
        "",
    );
    let output = generate_document(&site, &ThemeSet::new(), source).unwrap();
    assert_eq!(output.path, "recipes/index.html");
    assert!(output.contents.contains("Mine."));
}

#[test]
fn the_navigation_gets_one_recipes_link_and_respects_the_owners() {
    let recipes_link = "href=\"/recipes/\"";
    let auto = build(&site_of(kitchen(), vec![], ""));
    assert_eq!(
        main_nav(find(&auto, "index.html"))
            .matches(recipes_link)
            .count(),
        1
    );
    assert!(main_nav(find(&auto, "index.html")).contains("aria-label=\"Recipes\""));
    assert!(main_nav(find(&auto, "recipes/index.html")).contains("aria-current=\"page\""));

    let manual = build(&site_of(
        kitchen(),
        vec![],
        r#","nav":[{"label":"Cook with me","href":"/recipes"}]"#,
    ));
    let nav = main_nav(find(&manual, "index.html"));
    assert!(nav.contains("Cook with me"));
    assert!(!nav.contains(recipes_link), "not a second link");

    let own_page = build(&site_of(
        kitchen(),
        vec![page("recipes.md", "title: Cookbook\nnav: true")],
        "",
    ));
    let nav = main_nav(find(&own_page, "index.html"));
    assert_eq!(nav.matches(recipes_link).count(), 1);
    assert!(nav.contains("Cookbook"));
    assert!(has(&own_page, "recipes/all/index.html"));
}

/// Every internal address a page links to.
fn links_of(page: &str) -> Vec<String> {
    page.split("href=\"")
        .skip(1)
        .filter_map(|rest| rest.split('"').next())
        .filter(|href| href.starts_with('/') && !href.starts_with("//"))
        .map(str::to_string)
        .collect()
}

/// The pages a reader reaches by following links from the home page.
fn reachable(files: &[OutputFile]) -> Vec<String> {
    let mut seen = vec!["/".to_string()];
    let mut next = 0;
    while next < seen.len() {
        let path = format!("{}index.html", seen[next].trim_start_matches('/'));
        next += 1;
        let Some(page) = files.iter().find(|f| f.path == path) else {
            continue;
        };
        for link in links_of(&page.contents) {
            if !seen.contains(&link) {
                seen.push(link);
            }
        }
    }
    seen
}

fn nav_links(page: &str) -> Vec<(String, String)> {
    main_nav(page)
        .split("<a class=\"ob-nav-link\" href=\"")
        .skip(1)
        .map(|rest| {
            let (href, rest) = rest.split_once('"').unwrap();
            let label = rest.split_once("aria-label=\"").unwrap().1;
            (
                label.split('"').next().unwrap().to_string(),
                href.to_string(),
            )
        })
        .collect()
}

#[test]
fn a_reader_can_reach_the_list_and_every_filter_when_her_page_holds_the_address() {
    for (pages, extra) in [
        (vec![page("recipes.md", "title: Recipes\nnav: true")], ""),
        (
            vec![page("recipes.md", "title: Recipes")],
            r#","nav":[{"label":"My recipes","href":"/recipes/"}]"#,
        ),
    ] {
        let files = build(&site_of(kitchen(), pages, extra));
        let reached = reachable(&files);
        for address in [
            "/recipes/",
            "/recipes/all/",
            "/recipes/course/dessert/",
            "/recipes/cuisine/italian/",
        ] {
            assert!(
                reached.iter().any(|r| r == address),
                "{address} unreachable"
            );
        }
        assert!(main_nav(find(&files, "index.html")).contains("href=\"/recipes/all/\""));
    }
    // Her page is called Recipes, so the list's link says which is which.
    let files = build(&site_of(
        kitchen(),
        vec![page("recipes.md", "title: Recipes\nnav: true")],
        "",
    ));
    let links = nav_links(find(&files, "index.html"));
    assert_eq!(
        links[links.len() - 2..],
        [
            ("Recipes".to_string(), "/recipes/".to_string()),
            ("All recipes".to_string(), "/recipes/all/".to_string()),
        ]
    );
}

#[test]
fn with_both_addresses_taken_the_recipe_cards_still_lead_to_the_filters() {
    let files = build(&site_of(
        kitchen(),
        vec![page(
            "recipes.md",
            "title: My recipes\naliases: [/recipes/all/]",
        )],
        "",
    ));
    let reached = reachable(&files);
    assert!(reached.iter().any(|r| r == "/recipes/course/dessert/"));
    assert!(reached.iter().any(|r| r == "/recipes/cuisine/southern/"));
}

#[test]
fn a_recipe_card_links_its_course_and_cuisine_to_their_lists() {
    let posts = vec![
        recipe(
            "soup",
            "2026-10-03",
            "course: Lunch, Dinner\ncuisine: \"\u{1F370}\"",
        ),
        recipe("plain", "2026-10-02", "yield: 4"),
    ];
    let files = build(&site_of(posts, vec![], ""));
    let card = find(&files, "soup/index.html");
    assert!(card.contains(
        "<dd><a href=\"/recipes/course/lunch/\">Lunch</a>, <a href=\"/recipes/course/dinner/\">Dinner</a></dd>"
    ));
    // A value with no filter page stays plain text.
    assert!(card.contains("<dt>Cuisine</dt><dd>\u{1F370}</dd>"));

    // Listing off, and a draft whose course nobody has published: no link to nowhere.
    let off = build(&site_of(
        vec![recipe("soup", "2026-10-03", "course: Lunch")],
        vec![],
        r#","recipes":{"listing":false}"#,
    ));
    assert!(find(&off, "soup/index.html").contains("<dt>Course</dt><dd>Lunch</dd>"));
    let source = "posts/secret.md";
    let held = Site::load(
        config(""),
        Sources {
            posts: vec![
                recipe("secret", "2026-10-01", "draft: true\ncourse: Lunch"),
                recipe("soup", "2026-10-03", "course: Dinner"),
            ],
            ..Default::default()
        },
        LoadOptions {
            include_drafts: true,
            ..Default::default()
        },
    )
    .unwrap();
    let preview = generate_document(&held, &ThemeSet::new(), source).unwrap();
    assert!(preview.contents.contains("<dt>Course</dt><dd>Lunch</dd>"));
}

#[test]
fn a_link_the_owner_already_has_is_not_doubled_and_no_two_links_share_a_label() {
    let absolute = build(&site_of(
        kitchen(),
        vec![],
        r#","nav":[{"label":"Cook","href":"https://kitchen.example/recipes/"}]"#,
    ));
    assert_eq!(
        nav_links(find(&absolute, "index.html")),
        [(
            "Cook".to_string(),
            "https://kitchen.example/recipes/".to_string()
        )]
    );

    // A link elsewhere called Recipes leaves the list a label of its own.
    let tag = build(&site_of(
        kitchen(),
        vec![],
        r#","nav":[{"label":"Recipes","href":"/tags/recipes/"}]"#,
    ));
    assert_eq!(
        nav_links(find(&tag, "index.html")),
        [
            ("Recipes".to_string(), "/tags/recipes/".to_string()),
            ("All recipes".to_string(), "/recipes/".to_string()),
        ]
    );

    // Another site's recipes are not this list.
    let other = build(&site_of(
        kitchen(),
        vec![],
        r#","nav":[{"label":"Friend","href":"https://kitchen.example.org/recipes/"}]"#,
    ));
    assert!(main_nav(find(&other, "index.html")).contains("href=\"/recipes/\""));
}

#[test]
fn a_list_of_values_gets_a_filter_page_for_each() {
    let posts = vec![recipe(
        "dolma",
        "2026-10-03",
        "course: [Lunch, Dinner]\ncuisine:\n  - Greek\n  - Turkish",
    )];
    let files = build(&site_of(posts, vec![], ""));
    for path in [
        "recipes/course/lunch/index.html",
        "recipes/course/dinner/index.html",
        "recipes/cuisine/greek/index.html",
        "recipes/cuisine/turkish/index.html",
    ] {
        assert!(has(&files, path), "{path}");
    }
    let card = find(&files, "dolma/index.html");
    assert!(
        card.contains("\"recipeCategory\":\"Lunch, Dinner\""),
        "{card}"
    );
    assert!(card.contains("\"recipeCuisine\":\"Greek, Turkish\""));
}

#[test]
fn a_value_with_nothing_to_make_an_address_from_is_reported_once_and_not_offered_back() {
    let posts = vec![
        recipe("a", "2026-10-03", "course: \"\u{1F370}\""),
        recipe(
            "b",
            "2026-10-02",
            "course: \u{1F370}, Dinner\ncuisine: \"\u{1F1EE}\u{1F1F9}\"",
        ),
    ];
    let site = site_of(posts.clone(), vec![], "");
    let wordless: Vec<&String> = site
        .warnings
        .iter()
        .filter(|w| w.contains("no letters or numbers"))
        .collect();
    assert_eq!(wordless.len(), 2, "{:?}", site.warnings);
    assert!(wordless[0].contains("The course \"\u{1F370}\"") && wordless[0].contains("Dessert"));
    assert!(wordless[1].contains("The cuisine") && wordless[1].contains("Italian"));
    let (courses, cuisines) = recipe_listing::owner_values(&posts);
    assert_eq!(courses, ["Dinner"]);
    assert!(cuisines.is_empty());
}

#[test]
fn the_filter_groups_have_headings_the_lists_are_named_by_and_counts_that_say_what_they_count() {
    let files = build(&site_of(kitchen(), vec![], ""));
    let page = find(&files, "recipes/index.html");
    let nav = filters(page);
    assert!(nav.contains(
        "<h2 class=\"ob-meta ob-recipe-filter-heading\" id=\"ob-recipes-by-course\">By course</h2>"
    ));
    assert!(nav.contains("<ul class=\"ob-tags\" aria-labelledby=\"ob-recipes-by-course\">"));
    assert!(nav.contains("id=\"ob-recipes-by-cuisine\">By cuisine</h2>"));
    assert!(nav.contains("aria-labelledby=\"ob-recipes-by-cuisine\""));
    assert!(nav.contains("1<span class=\"ob-visually-hidden\"> recipe</span>"));
    assert!(nav.contains("2<span class=\"ob-visually-hidden\"> recipes</span>"));
    // The outline goes title, groups, the list, recipe titles: nothing skipped.
    let hidden = page
        .find("<h2 class=\"ob-visually-hidden\">The recipes</h2>")
        .unwrap();
    assert!(hidden < page.find("<h3").unwrap());
}

#[test]
fn every_group_of_filters_starts_folded_and_says_which_value_the_reader_is_in() {
    let files = build(&site_of(kitchen(), vec![], ""));
    let list = filters(find(&files, "recipes/index.html")).to_string();
    assert_eq!(list.matches("<details><summary><h2").count(), 2, "{list}");
    assert!(!list.contains("<details open"), "{list}");
    assert!(!list.contains("ob-recipe-filter-current"), "{list}");
    assert!(
        list.contains("href=\"/recipes/course/dessert/\""),
        "still plain links"
    );

    let inside = filters(find(&files, "recipes/course/dessert/index.html")).to_string();
    assert!(!inside.contains("<details open"), "{inside}");
    assert!(
        inside.contains(
            "By course</h2> <strong class=\"ob-recipe-filter-current\">Dessert</strong></summary>"
        ),
        "{inside}"
    );
    assert_eq!(inside.matches("ob-recipe-filter-current").count(), 1);
    assert!(inside.contains("aria-current=\"page\""));
}

#[test]
fn a_stray_comma_stays_out_of_the_card_and_the_search_data() {
    let posts = vec![recipe(
        "tiramisu",
        "2026-10-01",
        "course: Dessert,\ncuisine: \"Italian, \"",
    )];
    for extra in ["", r#","recipes":{"listing":false}"#] {
        let files = build(&site_of(posts.clone(), vec![], extra));
        let card = find(&files, "tiramisu/index.html");
        assert!(card.contains("\"recipeCategory\":\"Dessert\""), "{extra}");
        assert!(card.contains("\"recipeCuisine\":\"Italian\""), "{extra}");
        assert!(!card.contains("Dessert,"), "{extra}");
        assert!(!card.contains("Italian,"), "{extra}");
    }
    let files = build(&site_of(posts, vec![], r#","recipes":{"listing":false}"#));
    assert!(find(&files, "tiramisu/index.html").contains("<dd>Dessert</dd>"));
}

#[test]
fn an_alias_written_as_a_file_holds_the_address_it_names() {
    // A migrated page may name the file rather than the address. A published
    // recipe has to give way to it the same, not stop the whole build.
    let site = site_of(
        kitchen(),
        vec![page(
            "old.md",
            "title: Old list\naliases: [/recipes/index.html, /recipes/course/dessert/index.html]",
        )],
        "",
    );
    assert_eq!(
        recipe_listing::plan(&site).all_url.as_deref(),
        Some("/recipes/all/")
    );
    assert!(
        site.warnings.iter().any(|w| w
            .contains("remove the old address /recipes/ from the file of your page \"Old list\"")),
        "{:?}",
        site.warnings
    );
    let files = build(&site);
    assert!(has(&files, "recipes/index.html"));
    assert!(has(&files, "recipes/all/index.html"));
    assert!(!find(&files, "recipes/course/dessert/index.html").contains("ob-recipe-filters"));
    assert!(files.iter().all(|f| !f.path.contains("index.html/")));
}

#[test]
fn turning_the_listing_off_removes_every_trace_but_keeps_the_recipes() {
    let extra = r#","recipes":{"listing":false}"#;
    let site = site_of(kitchen(), vec![], extra);
    assert_eq!(recipe_listing::plan(&site), Default::default());
    let files = build(&site);
    assert!(files.iter().all(|f| !f.path.starts_with("recipes/")));
    assert!(!find(&files, "index.html").contains("/recipes/"));
    assert!(!find(&files, "sitemap.xml").contains("/recipes/"));
    assert!(has(&files, "tiramisu/index.html"));
}

#[test]
fn a_course_called_page_pages_beneath_its_own_address() {
    let files = build(&site_of(
        vec![
            recipe("a", "2026-10-02", "course: Page"),
            recipe("b", "2026-10-01", "course: Page"),
        ],
        vec![],
        r#","postsPerPage":1"#,
    ));
    assert!(has(&files, "recipes/course/page/index.html"));
    assert!(has(&files, "recipes/course/page/page/2/index.html"));
}

#[test]
fn the_owners_values_are_read_from_recipes_only() {
    let mut posts = kitchen();
    posts.push(file(
        "posts/news.md",
        "---\ntitle: News\ndate: 2026-10-01\ncategory: Politics\ncuisine: None\n---\nWords.\n",
    ));
    posts.push(recipe(
        "draft",
        "2026-10-01",
        "draft: true\ncategory: Lunch, Soup\ncuisine: Thai",
    ));
    posts.push(file("posts/broken.md", "---\nnot closed"));
    let (courses, cuisines) = recipe_listing::owner_values(&posts);
    assert_eq!(courses, ["Dessert", "Dinner", "dessert", "Lunch", "Soup"]);
    assert_eq!(cuisines, ["Italian", "Southern", "Italian", "Thai"]);
}

#[test]
fn a_site_under_a_base_path_links_inside_it() {
    let config = SiteConfig::from_json(
        r#"{"title":"Kitchen","url":"https://kitchen.example/blog/","postPath":"/{slug}/"}"#,
    )
    .unwrap();
    let site = Site::load(
        config,
        Sources {
            posts: kitchen(),
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let files = build(&site);
    let page = find(&files, "recipes/index.html");
    assert!(filters(page).contains("href=\"/blog/recipes/course/dessert/\""));
    assert!(filters(page).contains("href=\"/blog/recipes/\""));
    assert!(main_nav(page).contains("href=\"/blog/recipes/\""));
}

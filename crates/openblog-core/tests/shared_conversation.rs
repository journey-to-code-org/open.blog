//! Approved shared synthesis publishes through the ordinary Post pipeline (ADR 0038): grouped,
//! attributed, anchored, rendered by the one production renderer the preview also uses, and
//! nothing unapproved, stale or internal reaches any public output.

use openblog_core::accessibility::{audit_document, DocumentAuditInput, FindingCode};
use openblog_core::approval::ApprovalSet;
use openblog_core::assembly::{
    assemble, conversation_markdown, with_subject, Assembly, AssemblyError,
};
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
use openblog_core::preview::{build as preview, render_section};
use openblog_core::render;
use openblog_core::synthesis::{
    ItemRule, NewSynthesisItem, SynthesisEdit, SynthesisError, SynthesisKind, SynthesisSet,
};
use openblog_core::theme::ThemeSet;

const T: i64 = 1_800_000_000;
const DATE: &str = "2030-01-31T09:00:00Z";
const ALL: [&str; 3] = ["ann", "bo", "cy"];
const NAMES: [&str; 3] = ["Ann Ames", "Bo <Bee> & *Co*", "Cy Cole"];

/// Never in public output: internal ids, approver lists and consensus wording.
const INTERNAL: &[&str] = &[
    "syn-",
    "ann-admin",
    "shared-0a1b2c3d4e5f",
    "Approved by",
    "Awaiting",
    "consensus",
    "nextId",
    "contributors\"",
];

fn record_titled(title: &str) -> SharedPublication {
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: "shared-0a1b2c3d4e5f".into(),
        title: title.into(),
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
    config_with_full_content(true)
}

fn config_with_full_content(full: bool) -> SiteConfig {
    let mut config = SiteConfig::from_json(&format!(
        r#"{{"title":"T","url":"https://example.test","postPath":"/{{slug}}/","author":{{"name":"Site Owner"}},"feeds":{{"fullContent":{full}}}}}"#
    ))
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

struct Fixture {
    record: SharedPublication,
    drafts: DraftSet,
    synthesis: SynthesisSet,
    approvals: ApprovalSet,
}

impl Fixture {
    fn new() -> Self {
        let mut drafts = DraftSet::new(&ALL).unwrap();
        for (who, text) in [
            ("ann", "Ann words."),
            ("bo", "Bo words."),
            ("cy", "Cy words."),
        ] {
            drafts.save(who, who, 0, text, T).unwrap();
        }
        Self {
            record: record_titled("Noticing, together"),
            drafts,
            synthesis: SynthesisSet::new(),
            approvals: ApprovalSet::new(),
        }
    }

    fn add(&mut self, kind: SynthesisKind, who: &str, text: &str, others: &[&str]) -> String {
        let revision = self.synthesis.revision();
        self.synthesis
            .add(
                who,
                &ALL,
                revision,
                NewSynthesisItem {
                    kind,
                    markdown: text,
                    others,
                },
            )
            .unwrap()
    }

    fn approve_item(&mut self, id: &str, who: &str) {
        let revision = self.synthesis.revision();
        self.synthesis
            .approve_item(who, &ALL, revision, id)
            .unwrap();
    }

    fn approve_all_items(&mut self) {
        let ids: Vec<(String, Vec<String>)> = self
            .synthesis
            .items()
            .iter()
            .map(|item| (item.id().to_string(), item.contributors().to_vec()))
            .collect();
        for (id, who) in ids {
            for who in who {
                self.approve_item(&id, &who);
            }
        }
    }

    fn approve_piece(&mut self) {
        for who in ALL {
            let seen = with_subject(&self.record, &self.drafts, &self.synthesis, &ALL, |s| {
                self.approvals.binding_for(s, who).unwrap()
            });
            with_subject(&self.record, &self.drafts, &self.synthesis, &ALL, |s| {
                self.approvals.approve(who, who, s, &seen, true, T)
            })
            .unwrap();
        }
    }

    fn assemble(&self) -> Result<Assembly, AssemblyError> {
        assemble(
            &self.record,
            &self.drafts,
            &self.synthesis,
            &self.approvals,
            &ALL,
            DATE,
        )
    }

    fn published(&mut self) -> Assembly {
        self.approve_all_items();
        self.approve_piece();
        self.assemble().unwrap()
    }
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

fn page_of(site: &Site) -> String {
    render::generate(site, &ThemeSet::new())
        .unwrap()
        .into_iter()
        .find(|file| file.path.ends_with("noticing-together/index.html"))
        .expect("native page")
        .contents
}

fn assert_clean(label: &str, output: &str) {
    for needle in INTERNAL {
        assert!(!output.contains(needle), "{label} leaked `{needle}`");
    }
}

fn mixed() -> Fixture {
    let mut f = Fixture::new();
    f.add(
        SynthesisKind::Uncertainty,
        "cy",
        "We cannot tell whether the **rain** mattered.",
        &[],
    );
    f.add(
        SynthesisKind::Difference,
        "ann",
        "Ann leans toward the light.",
        &[],
    );
    f.add(
        SynthesisKind::Difference,
        "bo",
        "Bo leans toward the sound.",
        &[],
    );
    f.add(
        SynthesisKind::Agreement,
        "ann",
        "We all slowed down.",
        &["bo", "cy"],
    );
    f.add(
        SynthesisKind::Question,
        "bo",
        "Would silence change it?",
        &["ann"],
    );
    f
}

#[test]
fn approved_items_publish_grouped_attributed_anchored_and_without_a_consensus_signal() {
    let mut f = mixed();
    let made = f.published();
    let page = page_of(&site(&made));
    assert_eq!(
        made.source
            .matches("## Continuing the conversation")
            .count(),
        1
    );
    // Fixed category order, publication order within a category, unwritten kinds absent.
    let from = page.find("id=\"continuing-the-conversation\"").unwrap();
    let at = |needle: &str| {
        from + page[from..]
            .find(needle)
            .unwrap_or_else(|| panic!("missing {needle}"))
    };
    let order = [
        "id=\"continuing-the-conversation\"",
        "id=\"conversation-agreement\"",
        "We all slowed down.",
        "id=\"conversation-difference\"",
        "Ann leans toward the light.",
        "Bo leans toward the sound.",
        "id=\"conversation-question\"",
        "Would silence change it?",
        "id=\"conversation-uncertainty\"",
        "We cannot tell whether the <strong>rain</strong> mattered.",
    ];
    for w in order.windows(2) {
        assert!(at(w[0]) < at(w[1]), "{} before {}", w[0], w[1]);
    }
    assert!(!page.contains("conversation-application") && !page.contains("Ways to apply"));
    // Attribution and per-item anchors; headings nest h2, h3, h4.
    assert!(page.contains("id=\"conversation-difference-1\""));
    assert!(page.contains("id=\"conversation-difference-2\""));
    assert!(page.contains("Speaking for Ann Ames, Bo &lt;Bee&gt; &amp; *Co*, Cy Cole"));
    assert!(page.contains("<h2 id=\"continuing-the-conversation\">"));
    assert!(page.contains("<h3 id=\"conversation-difference\">"));
    assert!(page.contains("<h4 id=\"conversation-difference-2\">Speaking for Bo"));
    // The conversation follows the last section of the ordinary Post.
    assert!(made.source.find("Cy words.").unwrap() < made.source.find("## Continuing").unwrap());
    assert_clean("source", &made.source);
    assert_clean("page", &page);
}

#[test]
fn an_empty_synthesis_publishes_nothing_extra() {
    let mut f = Fixture::new();
    let made = f.published();
    assert!(!made.source.contains("conversation") && !made.source.contains("Continuing"));
    let page = page_of(&site(&made));
    assert!(!page.contains("Continuing the conversation") && !page.contains("conversation-"));
    assert_eq!(conversation_markdown(&f.record, &f.synthesis), "");
}

#[test]
fn only_a_category_with_approved_items_gets_a_heading() {
    let mut f = Fixture::new();
    f.add(SynthesisKind::Question, "ann", "Just a question?", &[]);
    let made = f.published();
    assert!(made.source.contains("### Questions we are left with"));
    assert!(!made.source.contains("### Where we differ"));
    assert!(!made.source.contains("### Shared takeaways"));
}

#[test]
fn unapproved_withdrawn_and_stale_items_never_appear() {
    let mut f = Fixture::new();
    let kept = f.add(SynthesisKind::Agreement, "ann", "KEPT-ITEM", &["bo"]);
    let waiting = f.add(SynthesisKind::Difference, "ann", "WAITING-ITEM", &["bo"]);
    let stale = f.add(SynthesisKind::Question, "cy", "STALE-ORIGINAL", &[]);
    let withdrawn = f.add(SynthesisKind::Uncertainty, "ann", "WITHDRAWN-ITEM", &["cy"]);
    for who in ["ann", "bo"] {
        f.approve_item(&kept, who);
    }
    f.approve_item(&waiting, "ann"); // bo has not
    f.approve_item(&stale, "cy");
    let revision = f.synthesis.revision();
    f.synthesis
        .edit(
            "cy",
            &ALL,
            revision,
            &stale,
            SynthesisEdit {
                markdown: Some("STALE-EDITED"),
                ..Default::default()
            },
        )
        .unwrap();
    f.approve_item(&withdrawn, "ann");
    f.approve_item(&withdrawn, "cy");
    let revision = f.synthesis.revision();
    f.synthesis
        .withdraw("cy", &ALL, revision, &withdrawn)
        .unwrap();

    let markdown = conversation_markdown(&f.record, &f.synthesis);
    assert!(markdown.contains("KEPT-ITEM"));
    // Cy withdrew, so the item now speaks for Ann alone, and her approval was cleared by the change.
    for hidden in [
        "WAITING-ITEM",
        "STALE-ORIGINAL",
        "STALE-EDITED",
        "WITHDRAWN-ITEM",
    ] {
        assert!(!markdown.contains(hidden), "{hidden}");
    }
    // The real gate refuses the piece while any named item is unapproved.
    f.approve_piece();
    match f.assemble() {
        Err(AssemblyError::Blocked { missing }) => assert!(!missing.is_empty()),
        other => panic!("{other:?}"),
    }
    // Once everyone approves the current items, exactly the current text publishes.
    f.approve_all_items();
    f.approve_piece();
    let made = f.assemble().unwrap();
    assert!(made.source.contains("WAITING-ITEM") && made.source.contains("STALE-EDITED"));
    assert!(made.source.contains("WITHDRAWN-ITEM"));
    assert!(!made.source.contains("STALE-ORIGINAL"));
    let withdrawn_heading = made
        .source
        .lines()
        .rev()
        .find(|line| line.starts_with("#### Speaking for"))
        .unwrap();
    assert!(
        !withdrawn_heading.contains("Cy"),
        "withdrawn name is gone: {withdrawn_heading}"
    );
}

#[test]
fn item_prose_cannot_publish_html_unsafe_links_or_outline_headings() {
    for hostile in [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "[x](javascript:alert(1))",
        "![x](data:text/html;base64,AAAA)",
        "# A second title",
        "#### Too deep",
        "## Another section",
        "Heading {#id}\n===",
        "```\nunclosed fence",
    ] {
        let mut f = Fixture::new();
        legacy_item(&mut f, hostile);
        // Something follows, so a fence or definition that leaks forward would be caught.
        f.add(SynthesisKind::Uncertainty, "cy", "Trailing.", &[]);
        f.approve_all_items();
        f.approve_piece();
        let outcome = f.assemble();
        assert!(
            matches!(outcome, Err(AssemblyError::UnsafeConversationItem(_))),
            "`{hostile}` published: {outcome:?}"
        );
    }
    // Ordinary Markdown and a safe link are fine, and a fence in one item cannot swallow the next.
    let mut f = Fixture::new();
    f.add(
        SynthesisKind::Agreement,
        "ann",
        "Plain *text*, a [link](https://example.org/a), `code`.\n\n##### Deep heading\n\n- one\n- two",
        &["bo", "cy"],
    );
    f.add(SynthesisKind::Question, "ann", "```\ncode\n```", &[]);
    assert!(f.published().source.contains("##### Deep heading"));
}

#[test]
fn a_reference_definition_in_one_item_cannot_reach_another() {
    let mut f = Fixture::new();
    f.add(
        SynthesisKind::Agreement,
        "ann",
        "[ref]: https://example.org/",
        &["bo", "cy"],
    );
    f.add(SynthesisKind::Question, "ann", "See [ref] for more.", &[]);
    f.approve_all_items();
    f.approve_piece();
    assert!(matches!(
        f.assemble(),
        Err(AssemblyError::UnsafeConversationItem(ItemRule::Markup))
    ));
}

#[test]
fn a_hostile_display_name_stays_text_in_the_attribution() {
    let mut f = Fixture::new();
    f.record.collaboration.participants[0].display_name =
        "<img src=x onerror=alert(1)> [x](javascript:alert(1)) {#evil} \\".into();
    f.add(SynthesisKind::Agreement, "ann", "Together.", &["bo"]);
    let made = f.published();
    let page = page_of(&site(&made));
    assert!(!page.contains("<img src=x") && !page.contains("href=\"javascript:"));
    assert!(!page.contains("id=\"evil\""));
    assert!(page.contains("Speaking for &lt;img src=x"));
}

#[test]
fn the_preview_renders_the_same_markup_the_page_publishes() {
    let mut f = mixed();
    f.approve_all_items();
    f.approve_piece();
    let site_config = config();
    let options = site_config.render_options();
    let shown = preview(
        &f.record,
        &f.drafts,
        &f.synthesis,
        &f.approvals,
        "ann",
        &ALL,
        true,
        options,
    )
    .unwrap();
    let published = render_section(&conversation_markdown(&f.record, &f.synthesis), options).html;
    assert!(shown.document.contains(&published));
    let page = page_of(&site(&f.assemble().unwrap()));
    assert!(
        page.contains(&published),
        "page and preview must share one renderer"
    );
    // An item still awaiting approval shows in the preview, labelled, and not in the published block.
    f.add(SynthesisKind::Application, "ann", "PENDING-ITEM", &[]);
    let shown = preview(
        &f.record,
        &f.drafts,
        &f.synthesis,
        &f.approvals,
        "ann",
        &ALL,
        true,
        options,
    )
    .unwrap();
    assert!(
        shown.document.contains("PENDING-ITEM")
            && shown.document.contains("Awaiting approval, not published")
    );
    assert!(!conversation_markdown(&f.record, &f.synthesis).contains("PENDING-ITEM"));
    // Someone without synthesis access sees none of it.
    let hidden = preview(
        &f.record,
        &f.drafts,
        &f.synthesis,
        &f.approvals,
        "ann",
        &ALL,
        false,
        options,
    )
    .unwrap();
    assert!(
        !hidden.document.contains("Where we differ") && !hidden.document.contains("PENDING-ITEM")
    );
}

#[test]
fn anchors_are_stable_across_rebuilds_and_reordering() {
    let mut f = mixed();
    let first = f.published();
    assert_eq!(first, f.assemble().unwrap());
    let before = page_of(&site(&first));
    // Reordering across kinds changes no anchor, because anchors are kind and ordinal.
    let order: Vec<String> = f
        .synthesis
        .items()
        .iter()
        .rev()
        .map(|item| item.id().to_string())
        .collect();
    let order: Vec<&str> = order.iter().map(String::as_str).collect();
    let revision = f.synthesis.revision();
    f.synthesis.reorder("ann", &ALL, revision, &order).unwrap();
    f.approve_piece();
    let after = page_of(&site(&f.assemble().unwrap()));
    for id in [
        "continuing-the-conversation",
        "conversation-agreement",
        "conversation-agreement-1",
        "conversation-difference-2",
        "conversation-question-1",
        "conversation-uncertainty-1",
    ] {
        let needle = format!("id=\"{id}\"");
        assert!(before.contains(&needle) && after.contains(&needle), "{id}");
    }
}

#[test]
fn other_languages_and_scripts_publish_intact_with_a_valid_outline() {
    let mut f = Fixture::new();
    f.record.collaboration.participants[1].display_name = "بو الأحمد".into();
    f.add(
        SynthesisKind::Agreement,
        "ann",
        "私たちは光に気づきました。",
        &["bo"],
    );
    f.add(SynthesisKind::Difference, "bo", "اختلفنا حول الصوت.", &[]);
    let made = f.published();
    let page = page_of(&site(&made));
    for text in [
        "私たちは光に気づきました。",
        "اختلفنا حول الصوت.",
        "Speaking for Ann Ames, بو الأحمد",
    ] {
        assert!(page.contains(text), "{text}");
    }
    // Headings never skip a level going down inside the page.
    let levels: Vec<usize> = page
        .match_indices("<h")
        .filter_map(|(at, _)| {
            page[at + 2..]
                .chars()
                .next()?
                .to_digit(10)
                .map(|d| d as usize)
        })
        .collect();
    assert!(levels.windows(2).all(|w| w[1] <= w[0] + 1), "{levels:?}");
}

#[test]
fn every_representation_carries_the_conversation_and_no_internal_value() {
    let mut f = mixed();
    let made = f.published();
    let site = site(&made);
    let projection = PortableProjection::from_post(&site.posts[0], &site.config).unwrap();
    let html = projection.portable_html().unwrap().html;
    let markdown = projection.portable_markdown().unwrap();
    let text = projection.portable_text().unwrap();
    for (label, output) in [("html", &html), ("markdown", &markdown), ("text", &text)] {
        assert!(output.contains("Ann leans toward the light."), "{label}");
        assert!(output.contains("Speaking for"), "{label}");
        assert_clean(label, output);
    }
    let rss = feeds::rss(&site).unwrap();
    assert!(rss.contains("Where we differ") && rss.contains("Bo leans toward the sound."));
    assert_clean("rss", &rss);
    let json = feeds::json_feed(&site).unwrap();
    assert!(json.contains("Where we differ"));
    assert_clean("json feed", &json);
    for file in render::generate(&site, &ThemeSet::new()).unwrap() {
        assert_clean(&file.path, &file.contents);
    }
    for (label, output) in [
        ("llms-full", feeds::llms_full(&site).unwrap()),
        ("llms", feeds::llms_index(&site).unwrap()),
        ("sitemap", feeds::sitemap(&site, &[])),
        ("search", feeds::search_index(&site)),
    ] {
        assert_clean(label, &output);
    }
}

/// Items as an older save (before the item rules) could have stored them: a benign item whose
/// Markdown is swapped in the stored JSON, so publishing's own check is exercised.
fn legacy_item(f: &mut Fixture, markdown: &str) {
    f.add(
        SynthesisKind::Agreement,
        "ann",
        "placeholder",
        &["bo", "cy"],
    );
    let json = f
        .synthesis
        .to_json()
        .replace("\"placeholder\"", &serde_json::to_string(markdown).unwrap());
    f.synthesis = SynthesisSet::from_json(&json).unwrap();
}

fn published_error(f: &mut Fixture) -> AssemblyError {
    f.approve_all_items();
    f.approve_piece();
    f.assemble().unwrap_err()
}

#[test]
fn a_section_or_item_cannot_claim_a_generated_anchor() {
    // A section heading by text, by explicit id, and a generated-looking item heading.
    for section in [
        "## Continuing the conversation",
        "## Something {#continuing-the-conversation}",
        "## Anything {#conversation-agreement}",
        "### Conversation agreement 1",
    ] {
        let mut f = Fixture::new();
        f.drafts
            .save(
                "ann",
                "ann",
                1,
                &format!(
                    "{section}

Words."
                ),
                T,
            )
            .unwrap();
        f.add(SynthesisKind::Agreement, "ann", "We agree.", &["bo", "cy"]);
        assert_eq!(
            published_error(&mut f),
            AssemblyError::UnsafeMarkup,
            "{section}"
        );
    }
    for item in [
        "##### Conversation agreement 1",
        "##### Fine {#conversation-agreement-1}",
        "##### Continuing the conversation",
    ] {
        let mut f = Fixture::new();
        let revision = f.synthesis.revision();
        let saved = f.synthesis.add(
            "ann",
            &ALL,
            revision,
            NewSynthesisItem {
                kind: SynthesisKind::Agreement,
                markdown: item,
                others: &[],
            },
        );
        assert_eq!(
            saved,
            Err(SynthesisError::Rule(ItemRule::ReservedAnchor)),
            "{item}"
        );
        legacy_item(&mut f, item);
        assert_eq!(
            published_error(&mut f),
            AssemblyError::UnsafeConversationItem(ItemRule::ReservedAnchor),
            "{item}"
        );
    }
    // The generated anchors appear exactly once on an ordinary publication.
    let page = page_of(&site(&mixed().published()));
    assert_eq!(
        page.matches("id=\"continuing-the-conversation\"").count(),
        1
    );
    assert_eq!(page.matches("id=\"conversation-difference\"").count(), 1);
}

#[test]
fn item_headings_start_at_level_five_and_never_skip() {
    for bad in [
        "## Heading",
        "#### Four",
        "###### Six first",
        "##### Five

###### Six

#### Four",
    ] {
        let mut f = Fixture::new();
        let revision = f.synthesis.revision();
        let saved = f.synthesis.add(
            "ann",
            &ALL,
            revision,
            NewSynthesisItem {
                kind: SynthesisKind::Agreement,
                markdown: bad,
                others: &[],
            },
        );
        assert_eq!(saved, Err(SynthesisError::Rule(ItemRule::Outline)), "{bad}");
        legacy_item(&mut f, bad);
        assert_eq!(
            published_error(&mut f),
            AssemblyError::UnsafeConversationItem(ItemRule::Outline),
            "{bad}"
        );
    }
    // An edit is held to the same rule and changes nothing when refused.
    let mut f = Fixture::new();
    let id = f.add(SynthesisKind::Agreement, "ann", "Fine.", &[]);
    let before = f.synthesis.clone();
    let revision = f.synthesis.revision();
    let edited = f.synthesis.edit(
        "ann",
        &ALL,
        revision,
        &id,
        SynthesisEdit {
            kind: None,
            markdown: Some("# Title"),
            add_contributors: &[],
        },
    );
    assert_eq!(edited, Err(SynthesisError::Rule(ItemRule::Outline)));
    assert_eq!(f.synthesis, before);
    // A well-formed item outline passes audit_document inside the whole published body.
    let mut f = Fixture::new();
    f.add(
        SynthesisKind::Agreement,
        "ann",
        "##### Detail

Text.

###### Finer

More.

##### Next

Done.",
        &["bo", "cy"],
    );
    let made = f.published();
    let body = made
        .source
        .split(
            "---
",
        )
        .last()
        .unwrap();
    let findings = audit_document(DocumentAuditInput {
        path: &made.path,
        markdown: body,
        body_line: 1,
        embeds_enabled: false,
        cover_alt: None,
    });
    assert!(
        !findings
            .iter()
            .any(|finding| finding.code == FindingCode::HeadingLevelSkip),
        "{findings:?}"
    );
}

#[test]
fn an_item_refusal_names_the_item_and_never_blames_a_section() {
    let mut f = Fixture::new();
    legacy_item(&mut f, "<b>x</b>");
    assert_eq!(
        published_error(&mut f),
        AssemblyError::UnsafeConversationItem(ItemRule::Markup)
    );
    let mut f = Fixture::new();
    f.drafts.save("ann", "ann", 1, "<b>x</b>", T).unwrap();
    f.add(SynthesisKind::Agreement, "ann", "Fine.", &["bo", "cy"]);
    assert_eq!(published_error(&mut f), AssemblyError::UnsafeMarkup);
}

#[test]
fn the_conversation_is_plain_semantic_html_in_prose_with_no_script_or_style() {
    let mut f = mixed();
    let made = f.published();
    let page = page_of(&site(&made));
    let start = page.find("<h2 id=\"continuing-the-conversation\"").unwrap();
    let prose_open = page[..start]
        .rfind("class=\"ob-prose")
        .expect("inside .ob-prose");
    // The block sits inside that prose container: no container closes between them.
    assert!(prose_open < start);
    let rest = &page[start..];
    let end = rest.find("</article>").unwrap_or(rest.len());
    let block = &rest[..end];
    for banned in [
        "<script",
        "<style",
        "style=",
        "<link",
        "onclick",
        "javascript:",
        "<iframe",
    ] {
        assert!(!block.contains(banned), "conversation carries `{banned}`");
    }
    for expected in ["<h2 ", "<h3 ", "<h4 ", "<p>"] {
        assert!(block.contains(expected), "missing {expected}");
    }
    // Print: the stylesheet's print rules never hide prose or headings.
    let css = include_str!("../../../web/base.css");
    let print = &css[css.find("@media print").unwrap()..];
    let hidden: Vec<&str> = print
        .split('}')
        .filter(|rule| rule.contains("display: none"))
        // Recipe print mode is opt-in per post and never applies to a reflection.
        .filter(|rule| !rule.contains(".ob-print-recipe"))
        .map(|rule| rule.split('{').next().unwrap())
        .collect();
    for selector in hidden {
        for prose in [
            ".ob-prose",
            " h2",
            " h3",
            " h4",
            "
h2",
            "
h3",
            "
h4",
            "article",
        ] {
            assert!(!selector.contains(prose), "print hides `{selector}`");
        }
    }
}

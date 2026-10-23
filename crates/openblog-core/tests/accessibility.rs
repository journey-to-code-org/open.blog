use openblog_core::accessibility::{
    audit_document, audit_site_language, AuditOutcome, AuditScope, DocumentAuditInput,
};

#[test]
fn empty_text_link_is_a_located_detected_issue() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/example.md",
        markdown: "Intro.\n\nA [](/destination) link.\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    let finding = &findings[0];
    assert_eq!(finding.code, "link-name-empty");
    assert_eq!(finding.outcome, AuditOutcome::Detected);
    assert_eq!(finding.source.path, "posts/example.md");
    assert_eq!(finding.source.line, Some(3));
    assert!(finding.message.contains("accessible name"));
    assert!(!finding.repair.is_empty());
}

#[test]
fn empty_markdown_image_alt_is_a_review_task_not_a_failure() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/chart.md",
        markdown: "Context.\n\n![](/images/chart.png)\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "image-alt-review");
    assert_eq!(findings[0].outcome, AuditOutcome::NeedsReview);
    assert_eq!(findings[0].source.line, Some(3));
    assert!(findings[0].message.contains("decorative"));
}

#[test]
fn filename_like_image_alt_is_only_a_potential_issue() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/chart.md",
        markdown: "![quarterly-results.png](/images/chart.png)\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "image-alt-placeholder");
    assert_eq!(findings[0].outcome, AuditOutcome::Potential);
    assert!(findings[0].repair.contains("purpose"));
}

#[test]
fn common_placeholder_image_alt_is_a_potential_issue() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/photo.md",
        markdown: "![image](/images/sunset.webp)\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "image-alt-placeholder");
    assert_eq!(findings[0].outcome, AuditOutcome::Potential);
}

#[test]
fn empty_cover_alt_is_located_in_front_matter_for_review() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/cover.md",
        markdown: "Body.\n",
        cover_alt: Some(""),
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "image-alt-review");
    assert_eq!(findings[0].outcome, AuditOutcome::NeedsReview);
    assert_eq!(findings[0].source.line, None);
    assert_eq!(findings[0].source.field.as_deref(), Some("coverAlt"));
}

#[test]
fn placeholder_cover_alt_is_a_front_matter_potential_issue() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/cover.md",
        markdown: "Body.\n",
        cover_alt: Some("cover-photo.jpg"),
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "image-alt-placeholder");
    assert_eq!(findings[0].outcome, AuditOutcome::Potential);
    assert_eq!(findings[0].source.field.as_deref(), Some("coverAlt"));
}

#[test]
fn skipped_heading_level_is_a_located_potential_issue() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/outline.md",
        markdown: "## Context\n\n#### Detail\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "heading-level-skip");
    assert_eq!(findings[0].outcome, AuditOutcome::Potential);
    assert_eq!(findings[0].source.line, Some(3));
    assert!(findings[0].message.contains("H2 to H4"));
}

#[test]
fn first_body_heading_is_checked_after_the_generated_page_title() {
    let findings = audit_document(DocumentAuditInput {
        path: "pages/about.md",
        markdown: "### Background\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "heading-level-skip");
    assert!(findings[0].message.contains("H1 to H3"));
}

#[test]
fn generic_link_phrase_is_a_potential_issue_not_a_certain_failure() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/links.md",
        markdown: "For the full report, [read more](/report).\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "link-purpose-review");
    assert_eq!(findings[0].outcome, AuditOutcome::Potential);
    assert!(findings[0].message.contains("read more"));
}

#[test]
fn tables_create_one_structure_review_task_per_document() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/data.md",
        markdown: "| A | B |\n| - | - |\n| 1 | 2 |\n\n| C | D |\n| - | - |\n| 3 | 4 |\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "table-structure-review");
    assert_eq!(findings[0].outcome, AuditOutcome::NeedsReview);
    assert_eq!(findings[0].source.line, Some(1));
    assert!(findings[0].repair.contains("headers"));
}

#[test]
fn raw_html_creates_one_bounded_review_task() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/custom.md",
        markdown: "<aside>Custom</aside>\n\nText with <span>inline HTML</span>.\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "raw-html-review");
    assert_eq!(findings[0].outcome, AuditOutcome::NeedsReview);
    assert_eq!(findings[0].source.line, Some(1));
}

#[test]
fn raw_html_inside_a_link_defers_its_name_to_review() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/custom-link.md",
        markdown: "[<span aria-label=\"Open demo\"></span>](/demo)\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "raw-html-review");
    assert!(!findings
        .iter()
        .any(|finding| finding.code == "link-name-empty"));
}

#[test]
fn earlier_raw_html_does_not_make_a_later_custom_link_name_certain() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/custom-link.md",
        markdown: "<aside>Note</aside>\n\n[<span aria-label=\"Open demo\"></span>](/demo)\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "raw-html-review");
}

#[test]
fn linked_audio_or_video_creates_one_alternatives_review_task() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/talk.md",
        markdown:
            "[Watch the recorded talk](/media/talk.mp4) and [download audio](/media/talk.mp3).\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "media-alternatives-review");
    assert_eq!(findings[0].outcome, AuditOutcome::NeedsReview);
    assert_eq!(findings[0].source.line, Some(1));
    assert!(findings[0].repair.contains("captions"));
}

#[test]
fn rendered_embed_creates_an_embed_review_task() {
    let findings = audit_document(DocumentAuditInput {
        path: "posts/demo.md",
        markdown: "[Open the demo](https://codepen.io/example/pen/abc123)\n",
        cover_alt: None,
    });

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "embed-accessibility-review");
    assert_eq!(findings[0].scope, AuditScope::Embed);
    assert_eq!(findings[0].source.line, Some(1));
}

#[test]
fn missing_site_language_is_one_site_scoped_detected_issue() {
    let findings = audit_site_language("openblog.json", "  ");

    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].code, "document-language-missing");
    assert_eq!(findings[0].outcome, AuditOutcome::Detected);
    assert_eq!(findings[0].scope, AuditScope::Site);
    assert_eq!(findings[0].source.path, "openblog.json");
    assert_eq!(findings[0].source.field.as_deref(), Some("language"));
    assert!(audit_site_language("openblog.json", "en-US").is_empty());
}

use openblog_core::{
    capability::{
        self, CapabilityDiagnosticCode, CapabilityOccurrence, CapabilitySource, PortabilityLevel,
    },
    markdown::{self, RenderOptions},
};

fn occurrence<'a>(id: &'a str, semantics: &'a str, line: u32) -> CapabilityOccurrence<'a> {
    CapabilityOccurrence {
        id,
        authored_semantics: semantics,
        source: CapabilitySource {
            path: "content/posts/lesson.md",
            line,
            column: 1,
        },
    }
}

#[test]
fn known_capabilities_resolve_to_semantic_and_fallback_descriptors() {
    let resolved = capability::resolve(occurrence("quiz", "Which answer is correct?", 12));

    let descriptor = resolved.descriptor.expect("quiz is registered");
    assert_eq!(descriptor.id, "quiz");
    assert!(descriptor.authored_semantics.contains("question"));
    assert_eq!(descriptor.native_renderer.id, "knowledge-check");
    assert_eq!(descriptor.fallback.renderer.id, "static-knowledge-check");
    assert_eq!(
        descriptor.portability,
        PortabilityLevel::GracefullyTransformed
    );
    assert!(descriptor
        .fallback
        .semantic_losses
        .contains(&"answering, retry, and attempt persistence"));
    assert!(resolved.diagnostic.is_none());
    assert_eq!(
        resolved.occurrence.authored_semantics,
        "Which answer is correct?"
    );
}

#[test]
fn unknown_nested_and_repeated_capabilities_preserve_authored_semantics() {
    let fixtures = [
        occurrence("future-perspective", "outer <script> is authored text", 4),
        occurrence("quiz", "nested question", 7),
        occurrence("future-perspective", "repeated café reflection", 15),
    ];

    let resolved = fixtures.map(capability::resolve);

    assert_eq!(
        resolved[0].occurrence.authored_semantics,
        fixtures[0].authored_semantics
    );
    assert_eq!(
        resolved[2].occurrence.authored_semantics,
        fixtures[2].authored_semantics
    );
    assert_eq!(
        resolved[0].diagnostic.as_ref().map(|item| item.code),
        Some(CapabilityDiagnosticCode::UnknownCapability)
    );
    assert_eq!(resolved[1].descriptor.map(|item| item.id), Some("quiz"));
    assert_eq!(
        resolved[2].diagnostic.as_ref().map(|item| item.source.line),
        Some(15)
    );
}

#[test]
fn malformed_identifiers_emit_bounded_source_scoped_diagnostics() {
    let very_long = format!("{}💥", "x".repeat(10_000));
    let resolved = capability::resolve(occurrence(&very_long, "keep me", 23));
    let diagnostic = resolved.diagnostic.expect("malformed id is diagnosed");

    assert_eq!(
        diagnostic.code,
        CapabilityDiagnosticCode::MalformedIdentifier
    );
    assert_eq!(diagnostic.source.path, "content/posts/lesson.md");
    assert_eq!(diagnostic.source.line, 23);
    assert!(diagnostic.capability_id.len() <= capability::MAX_DIAGNOSTIC_ID_BYTES);
    assert!(!diagnostic.capability_id.contains('💥'));
    assert_eq!(resolved.occurrence.authored_semantics, "keep me");
}

#[test]
fn ordinary_markdown_and_unknown_fences_keep_existing_native_rendering() {
    let markdown_source = "Prose only.\n\n```future-perspective\n<café>& reflection\n```\n";
    let rendered = markdown::render(markdown_source, RenderOptions::default());

    assert!(!capability::registered()
        .iter()
        .any(|item| item.id == "article"));
    assert!(rendered
        .html
        .contains("<pre><code class=\"language-future-perspective\">&lt;café&gt;&amp; reflection"));
    assert!(rendered.errors.is_empty());
}

#[test]
fn content_profiles_are_not_capability_descriptors() {
    for profile_id in ["article", "recipe", "research", "video", "field-journal"] {
        let resolved = capability::resolve(occurrence(profile_id, "profile-owned fields", 1));
        assert!(resolved.descriptor.is_none(), "{profile_id}");
        assert_eq!(
            resolved.diagnostic.map(|item| item.code),
            Some(CapabilityDiagnosticCode::UnknownCapability),
            "{profile_id}"
        );
    }
}

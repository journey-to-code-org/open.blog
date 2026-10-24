//! Destination-neutral semantics for reusable publishing capabilities.
//!
//! A content profile selects field-specific publishing behavior for a post.
//! A capability describes reusable meaning within that post. This module keeps
//! those concepts separate and deliberately does not render or mutate content.

/// Maximum identifier text copied into a diagnostic.
pub const MAX_DIAGNOSTIC_ID_BYTES: usize = 80;
const MAX_CAPABILITY_ID_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortabilityLevel {
    FullyPortable,
    GracefullyTransformed,
    CanonicalOnlyInteraction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RendererDescriptor {
    pub id: &'static str,
    pub description: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PortableFallbackDescriptor {
    pub renderer: RendererDescriptor,
    /// Semantics the fallback intentionally retains.
    pub preserves: &'static [&'static str],
    /// Semantics or interaction the fallback intentionally cannot retain.
    pub semantic_losses: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapabilityDescriptor {
    pub id: &'static str,
    pub authored_semantics: &'static str,
    pub native_renderer: RendererDescriptor,
    pub fallback: PortableFallbackDescriptor,
    pub portability: PortabilityLevel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapabilitySource<'a> {
    pub path: &'a str,
    pub line: u32,
    pub column: u32,
}

/// One capability occurrence attached to already parsed document output.
///
/// The semantic payload is borrowed from the canonical representation so
/// resolution cannot create or mutate a second copy of authored content.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CapabilityOccurrence<'a> {
    pub id: &'a str,
    pub authored_semantics: &'a str,
    pub source: CapabilitySource<'a>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityDiagnosticCode {
    UnknownCapability,
    MalformedIdentifier,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityDiagnostic<'a> {
    pub code: CapabilityDiagnosticCode,
    /// A bounded, printable identifier for logs and authoring diagnostics.
    pub capability_id: String,
    pub source: CapabilitySource<'a>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityResolution<'a> {
    pub occurrence: CapabilityOccurrence<'a>,
    pub descriptor: Option<&'static CapabilityDescriptor>,
    pub diagnostic: Option<CapabilityDiagnostic<'a>>,
}

const CALLOUT: CapabilityDescriptor = CapabilityDescriptor {
    id: "callout",
    authored_semantics: "a labelled supplemental note, tip, warning, or caution",
    native_renderer: RendererDescriptor {
        id: "callout",
        description: "an accessible labelled aside",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "labelled-blockquote",
            description: "a blockquote with its authored callout label",
        },
        preserves: &["label", "body", "document order"],
        semantic_losses: &[],
    },
    portability: PortabilityLevel::FullyPortable,
};

const QUIZ: CapabilityDescriptor = CapabilityDescriptor {
    id: "quiz",
    authored_semantics: "a question, answer choices, correct answer, and optional explanation",
    native_renderer: RendererDescriptor {
        id: "knowledge-check",
        description: "an accessible progressively enhanced knowledge check",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "static-knowledge-check",
            description: "a readable question, choices, and explanation",
        },
        preserves: &["question", "choices", "explanation", "document order"],
        semantic_losses: &["answering, retry, and attempt persistence"],
    },
    portability: PortabilityLevel::GracefullyTransformed,
};

const RUNNABLE_CODE: CapabilityDescriptor = CapabilityDescriptor {
    id: "runnable-code",
    authored_semantics: "source code that may be edited and executed by a reader",
    native_renderer: RendererDescriptor {
        id: "code-runner",
        description: "a progressively enhanced editor and bounded runner",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "source-code",
            description: "a labelled static source-code block",
        },
        preserves: &["source", "language", "title", "line annotations"],
        semantic_losses: &["editing, execution, and runtime output"],
    },
    portability: PortabilityLevel::GracefullyTransformed,
};

const EMBED: CapabilityDescriptor = CapabilityDescriptor {
    id: "embed",
    authored_semantics: "a referenced external resource shown in document context",
    native_renderer: RendererDescriptor {
        id: "embedded-resource",
        description: "a provider-specific embed with a source link",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "source-link",
            description: "a safe link to the referenced resource",
        },
        preserves: &["reference URL", "link text", "document order"],
        semantic_losses: &["embedded presentation and provider interaction"],
    },
    portability: PortabilityLevel::GracefullyTransformed,
};

const CITATION: CapabilityDescriptor = CapabilityDescriptor {
    id: "citation",
    authored_semantics: "an in-text pointer connecting a passage to a reference",
    native_renderer: RendererDescriptor {
        id: "citation-reference",
        description: "a linked in-text citation and reference",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "citation-reference",
            description: "a linked in-text citation and reference",
        },
        preserves: &["citation", "reference identity", "source provenance"],
        semantic_losses: &[],
    },
    portability: PortabilityLevel::FullyPortable,
};

const WORK_CREDIT: CapabilityDescriptor = CapabilityDescriptor {
    id: "work-credit",
    authored_semantics: "an ordered contributor relationship with explicitly named roles",
    native_renderer: RendererDescriptor {
        id: "structured-work-credit",
        description: "a byline with contributor identifiers and roles",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "attribution-byline",
            description: "a readable ordered attribution byline",
        },
        preserves: &["contributor identity", "credit order", "role labels"],
        semantic_losses: &["destination-native structured role vocabulary"],
    },
    portability: PortabilityLevel::GracefullyTransformed,
};

const HOSTED_DISCUSSION: CapabilityDescriptor = CapabilityDescriptor {
    id: "hosted-discussion",
    authored_semantics: "a moderated discussion associated with the canonical work",
    native_renderer: RendererDescriptor {
        id: "hosted-comments",
        description: "the canonical work's moderated discussion",
    },
    fallback: PortableFallbackDescriptor {
        renderer: RendererDescriptor {
            id: "canonical-discussion-link",
            description: "a link to participate on the canonical work",
        },
        preserves: &["canonical work identity", "participation location"],
        semantic_losses: &["destination-local thread and participation"],
    },
    portability: PortabilityLevel::CanonicalOnlyInteraction,
};

const REGISTERED: &[CapabilityDescriptor] = &[
    CALLOUT,
    QUIZ,
    RUNNABLE_CODE,
    EMBED,
    CITATION,
    WORK_CREDIT,
    HOSTED_DISCUSSION,
];

pub fn registered() -> &'static [CapabilityDescriptor] {
    REGISTERED
}

/// Resolve a capability without changing its authored semantic payload.
///
/// Unknown and malformed identifiers remain attached to their original
/// content and receive one bounded, source-scoped diagnostic.
pub fn resolve(occurrence: CapabilityOccurrence<'_>) -> CapabilityResolution<'_> {
    let descriptor = valid_id(occurrence.id)
        .then(|| registered().iter().find(|item| item.id == occurrence.id))
        .flatten();
    let code = if descriptor.is_some() {
        None
    } else if valid_id(occurrence.id) {
        Some(CapabilityDiagnosticCode::UnknownCapability)
    } else {
        Some(CapabilityDiagnosticCode::MalformedIdentifier)
    };
    let diagnostic = code.map(|code| CapabilityDiagnostic {
        code,
        capability_id: bounded_id(occurrence.id),
        source: occurrence.source,
    });
    CapabilityResolution {
        occurrence,
        descriptor,
        diagnostic,
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CAPABILITY_ID_BYTES
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn bounded_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_graphic())
        .take(MAX_DIAGNOSTIC_ID_BYTES)
        .collect()
}

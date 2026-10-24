//! Contracts for publishing capabilities attached to rendered Markdown.

pub const MAX_CAPABILITY_ID_LENGTH: usize = 64;
pub const MAX_DIAGNOSTIC_MESSAGE_LENGTH: usize = 240;
pub const MAX_CAPABILITY_DIAGNOSTICS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortabilityLevel {
    FullyPortable,
    GracefullyTransformed,
    CanonicalOnlyInteraction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityDiagnosticCode {
    UnknownCapability,
    MalformedIdentifier,
    MalformedContent,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityDiagnostic {
    pub code: CapabilityDiagnosticCode,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityDescriptor {
    /// Stable, product-owned identifier. Invalid identifiers use `"invalid"`.
    pub id: String,
    /// Meaning authored by the writer; the source content remains canonical.
    pub authored_semantics: &'static str,
    /// Renderer used for the native open.blog presentation, when available.
    pub native_renderer: Option<&'static str>,
    /// Renderer for a useful static representation where one is defined.
    pub fallback_renderer: Option<&'static str>,
    pub portability: PortabilityLevel,
    /// Diagnostics are scoped to this capability occurrence.
    pub diagnostics: Vec<CapabilityDiagnostic>,
}

impl CapabilityDescriptor {
    /// Describe a capability without changing or consuming its authored Markdown.
    pub fn describe(identifier: &str, native_renderer: Option<&'static str>) -> Self {
        if !valid_identifier(identifier) {
            let mut descriptor = Self {
                id: "invalid".into(),
                authored_semantics: "Unrecognized authored capability.",
                native_renderer: None,
                fallback_renderer: Some("untransformed-markdown"),
                portability: PortabilityLevel::CanonicalOnlyInteraction,
                diagnostics: Vec::new(),
            };
            descriptor.add_diagnostic(
                CapabilityDiagnosticCode::MalformedIdentifier,
                "Malformed capability identifier; authored Markdown is left unchanged.",
            );
            return descriptor;
        }

        let (semantics, fallback_renderer, portability) = match identifier {
            "knowledge-check" => (
                "A question with answer choices and an author-designated correct answer.",
                Some("static-question-and-choices"),
                PortabilityLevel::GracefullyTransformed,
            ),
            "runnable-code" => (
                "Source code with an explicit reader execution affordance.",
                Some("pre-code"),
                PortabilityLevel::GracefullyTransformed,
            ),
            "web-sandbox" => (
                "An HTML, CSS, and JavaScript exercise with an isolated preview.",
                Some("source-code"),
                PortabilityLevel::GracefullyTransformed,
            ),
            "comments" => (
                "Reader discussion hosted with the canonical article.",
                Some("canonical-link"),
                PortabilityLevel::CanonicalOnlyInteraction,
            ),
            _ => {
                let mut descriptor = Self {
                    id: identifier.to_string(),
                    authored_semantics: "Unrecognized authored capability.",
                    native_renderer: None,
                    fallback_renderer: Some("untransformed-markdown"),
                    portability: PortabilityLevel::CanonicalOnlyInteraction,
                    diagnostics: Vec::new(),
                };
                descriptor.add_diagnostic(
                    CapabilityDiagnosticCode::UnknownCapability,
                    "Unknown capability; preserve its authored content unchanged.",
                );
                return descriptor;
            }
        };

        Self {
            id: identifier.to_string(),
            authored_semantics: semantics,
            native_renderer,
            fallback_renderer,
            portability,
            diagnostics: Vec::new(),
        }
    }

    pub fn add_diagnostic(&mut self, code: CapabilityDiagnosticCode, message: &str) {
        if self.diagnostics.len() == MAX_CAPABILITY_DIAGNOSTICS {
            return;
        }
        self.diagnostics.push(CapabilityDiagnostic {
            code,
            message: bounded_message(message),
        });
    }
}

fn bounded_message(message: &str) -> String {
    let end = message
        .char_indices()
        .take_while(|(index, character)| {
            index + character.len_utf8() <= MAX_DIAGNOSTIC_MESSAGE_LENGTH
        })
        .map(|(index, character)| index + character.len_utf8())
        .last()
        .unwrap_or(0);
    message[..end].to_string()
}

fn valid_identifier(identifier: &str) -> bool {
    let bytes = identifier.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_CAPABILITY_ID_LENGTH
        && bytes[0].is_ascii_lowercase()
        && bytes[bytes.len() - 1] != b'-'
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_capabilities_have_semantics_and_fallbacks() {
        let descriptor = CapabilityDescriptor::describe("knowledge-check", Some("ob-quiz"));
        assert_eq!(descriptor.id, "knowledge-check");
        assert!(descriptor.authored_semantics.contains("answer choices"));
        assert_eq!(descriptor.native_renderer, Some("ob-quiz"));
        assert_eq!(
            descriptor.fallback_renderer,
            Some("static-question-and-choices")
        );
        assert_eq!(
            descriptor.portability,
            PortabilityLevel::GracefullyTransformed
        );
        assert!(descriptor.diagnostics.is_empty());
    }

    #[test]
    fn comments_are_a_canonical_only_interaction() {
        let descriptor = CapabilityDescriptor::describe("comments", Some("ob-comments"));
        assert_eq!(
            descriptor.portability,
            PortabilityLevel::CanonicalOnlyInteraction
        );
        assert_eq!(descriptor.fallback_renderer, Some("canonical-link"));
        assert!(descriptor.diagnostics.is_empty());
    }

    #[test]
    fn unknown_capabilities_are_bounded_and_preserve_their_identifier() {
        let descriptor = CapabilityDescriptor::describe("future-capability", None);
        assert_eq!(descriptor.id, "future-capability");
        assert_eq!(
            descriptor.diagnostics[0].code,
            CapabilityDiagnosticCode::UnknownCapability
        );
        assert!(descriptor.diagnostics[0].message.len() <= MAX_DIAGNOSTIC_MESSAGE_LENGTH);
        assert_eq!(descriptor.fallback_renderer, Some("untransformed-markdown"));
    }

    #[test]
    fn malformed_identifiers_get_a_bounded_diagnostic() {
        let descriptor = CapabilityDescriptor::describe(&"x".repeat(128), None);
        assert_eq!(descriptor.id, "invalid");
        assert_eq!(
            descriptor.diagnostics[0].code,
            CapabilityDiagnosticCode::MalformedIdentifier
        );
        assert_eq!(descriptor.diagnostics.len(), 1);
    }

    #[test]
    fn malformed_content_diagnostics_do_not_include_unbounded_source_text() {
        let mut descriptor = CapabilityDescriptor::describe("knowledge-check", Some("ob-quiz"));
        descriptor.add_diagnostic(
            CapabilityDiagnosticCode::MalformedContent,
            &"x".repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH * 2),
        );
        assert_eq!(
            descriptor.diagnostics[0].message.len(),
            MAX_DIAGNOSTIC_MESSAGE_LENGTH
        );
    }

    #[test]
    fn diagnostics_are_bounded_by_bytes_for_multibyte_messages() {
        let mut descriptor = CapabilityDescriptor::describe("knowledge-check", Some("ob-quiz"));
        descriptor.add_diagnostic(
            CapabilityDiagnosticCode::MalformedContent,
            &"é".repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH),
        );
        assert!(descriptor.diagnostics[0].message.len() <= MAX_DIAGNOSTIC_MESSAGE_LENGTH);
    }

    #[test]
    fn diagnostic_count_and_message_length_are_bounded() {
        let mut descriptor = CapabilityDescriptor::describe("knowledge-check", Some("ob-quiz"));
        let long_message = "x".repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH + 50);
        for _ in 0..MAX_CAPABILITY_DIAGNOSTICS + 1 {
            descriptor.add_diagnostic(CapabilityDiagnosticCode::MalformedContent, &long_message);
        }
        assert_eq!(descriptor.diagnostics.len(), MAX_CAPABILITY_DIAGNOSTICS);
        assert!(descriptor
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.message.len() == MAX_DIAGNOSTIC_MESSAGE_LENGTH));
    }
}

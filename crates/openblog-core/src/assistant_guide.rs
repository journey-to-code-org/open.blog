//! Authoritative publishing-engine facts supplied to author-time assistants.
//!
//! These contracts live in the deterministic core so network adapters cannot
//! invent a second description of supported open.blog syntax or profiles.

use crate::profile::{ARTICLE_ID, FIELD_JOURNAL_ID, RECIPE_ID, RESEARCH_ID, VIDEO_ID};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineCapability {
    pub id: &'static str,
    pub contract: String,
}

pub const ENGINE_GUIDE_VERSION: u32 = 1;

pub fn engine_capabilities() -> Vec<EngineCapability> {
    let capability = |id, contract: &str| EngineCapability {
        id,
        contract: contract.to_string(),
    };
    vec![
        capability(
            "quiz-fence",
            "Fenced blocks whose info string is `quiz` are native open.blog syntax. Valid quiz blocks render as interactive knowledge checks with reader feedback; invalid quiz blocks are reported by open.blog validation. Do not claim that a valid quiz fence renders as raw Markdown, exposes its answer as plain text, or requires the article to explain the renderer syntax. You may review the question, choices, answer, and explanation for authoring quality.",
        ),
        capability(
            "runnable-rust-fence",
            "Fenced Rust code blocks marked `runnable` are native open.blog syntax. They render as editable interactive examples with Run, Reset, and Copy controls plus an optional Rust Playground fallback. Do not claim that the `runnable` option is unsupported merely because it is not standard Markdown. You may review the example itself and whether running remote code is appropriately framed.",
        ),
        capability(
            "code-fence-options",
            "Fenced code may use open.blog options for titles, line numbers, highlighted lines, and runnable Rust. Preserve valid fence info strings and do not rewrite them as prose.",
        ),
        capability(
            "supported-embeds",
            "A supported YouTube or CodePen URL standing alone in a paragraph can render as an embed when embeds are enabled. Inline links remain links. Do not suggest raw iframe HTML when the native URL form is sufficient.",
        ),
        EngineCapability {
            id: "content-profiles",
            contract: format!(
                "The built-in post content profile IDs are `{ARTICLE_ID}`, `{RECIPE_ID}`, `{VIDEO_ID}`, `{FIELD_JOURNAL_ID}`, and `{RESEARCH_ID}`. Profiles add field-specific validation and publishing behavior; unknown profile IDs are preserved with fallback guidance. Do not invent front matter fields or silently change a profile."
            ),
        },
        capability(
            "source-ownership",
            "Markdown and front matter are author-owned source. The Visual editor is a source-preserving view and protects syntax it cannot safely edit. Assistant output is always a proposal and must never claim it saved, published, or changed source by itself.",
        ),
        capability(
            "publishing-schedule",
            "Drafts remain unpublished. Future-dated posts are scheduled and become public on the first build after their scheduled instant. Do not claim that adding a future date publishes immediately.",
        ),
        capability(
            "evidence-boundary",
            "Citations are in-text pointers and references describe supporting works. open.blog checks authored structure and resolvability but does not certify truth, authority, peer review, accessibility conformance, or search ranking. External research is off unless the request explicitly says otherwise.",
        ),
        capability(
            "markdown-output",
            "Use portable Markdown for authored prose. Do not emit front matter, raw HTML, a fenced block, or a new heading when asked only for a short inline prose completion. Preserve the author's voice and avoid repeating the nearby prefix.",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile;

    #[test]
    fn profile_contract_is_derived_from_every_builtin_profile_id() {
        let contract = engine_capabilities()
            .into_iter()
            .find(|capability| capability.id == "content-profiles")
            .unwrap()
            .contract;
        for profile in profile::catalog() {
            assert!(contract.contains(&format!("`{}`", profile.id)));
        }
    }
}

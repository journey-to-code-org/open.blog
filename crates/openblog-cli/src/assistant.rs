//! Provider-neutral author-time AI requests.
//!
//! This module owns network provider boundaries and normalized structured
//! results. The publishing core deliberately remains deterministic and
//! network-free.

use std::fmt;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value as Json};

pub const ASSISTANT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssistantRequest {
    pub schema_version: u32,
    pub task: AssistantTask,
    pub model: String,
    pub source: AssistantSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssistantTask {
    KnowledgeChecks { count: KnowledgeCheckCount },
}

impl AssistantTask {
    pub fn expected_output(&self) -> ExpectedOutput {
        match self {
            Self::KnowledgeChecks { .. } => ExpectedOutput::KnowledgeChecks,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KnowledgeCheckCount(u8);

impl KnowledgeCheckCount {
    pub fn new(count: u8) -> Result<Self, AssistantError> {
        if (1..=3).contains(&count) {
            Ok(Self(count))
        } else {
            Err(AssistantError::new(
                AssistantErrorKind::InvalidConfiguration,
                "Knowledge-check count must be between one and three",
            ))
        }
    }

    fn get(self) -> u8 {
        self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssistantSource {
    pub content: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExpectedOutput {
    KnowledgeChecks,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct KnowledgeCheck {
    pub prompt: String,
    pub choices: Vec<String>,
    #[serde(rename = "correctIndex")]
    pub correct_index: usize,
    pub explanation: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct KnowledgeCheckSet {
    pub questions: Vec<KnowledgeCheck>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssistantResult {
    KnowledgeChecks(KnowledgeCheckSet),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssistantErrorKind {
    NotConfigured,
    InvalidConfiguration,
    MissingCredential,
    Transport,
    Timeout,
    ProviderStatus,
    ResponseRead,
    InvalidJson,
    InvalidResult,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssistantError {
    pub kind: AssistantErrorKind,
    message: String,
}

impl AssistantError {
    fn new(kind: AssistantErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn public_message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for AssistantError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

pub trait AssistantProvider {
    fn generate(&self, request: &AssistantRequest) -> Result<AssistantResult, AssistantError>;
}

/// Compatibility adapter for the existing author-configured quiz endpoint.
///
/// The credential is kept private and is never included in `Debug`, errors,
/// request payloads, or provider responses returned to the browser.
pub struct LegacyQuizEndpoint {
    endpoint: String,
    credential: String,
    timeout: Duration,
}

impl LegacyQuizEndpoint {
    pub fn new(
        endpoint: &str,
        credential: Option<String>,
        timeout: Duration,
        allow_insecure_loopback: bool,
    ) -> Result<Self, AssistantError> {
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            return Err(AssistantError::new(
                AssistantErrorKind::NotConfigured,
                "Quiz generation is not configured",
            ));
        }
        let permitted = endpoint.starts_with("https://")
            || (allow_insecure_loopback && endpoint.starts_with("http://127.0.0.1:"));
        if !permitted {
            return Err(AssistantError::new(
                AssistantErrorKind::InvalidConfiguration,
                "Quiz generation endpoint must use HTTPS",
            ));
        }
        let credential = credential.unwrap_or_default();
        if credential.trim().is_empty() {
            return Err(AssistantError::new(
                AssistantErrorKind::MissingCredential,
                "OPENBLOG_LESSONS_API_KEY is not set",
            ));
        }
        Ok(Self {
            endpoint: endpoint.to_string(),
            credential: credential.trim().to_string(),
            timeout,
        })
    }
}

impl AssistantProvider for LegacyQuizEndpoint {
    fn generate(&self, request: &AssistantRequest) -> Result<AssistantResult, AssistantError> {
        let payload = legacy_quiz_payload(request)?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(self.timeout))
            .user_agent(concat!(
                "open.blog-admin/",
                env!("CARGO_PKG_VERSION"),
                " (+https://github.com/journey-to-code-org/open.blog)"
            ))
            .build()
            .into();
        let mut response = match agent
            .post(&self.endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", &format!("Bearer {}", self.credential))
            .send(payload.to_string())
        {
            Ok(response) => response,
            Err(ureq::Error::StatusCode(status)) => {
                return Err(AssistantError::new(
                    AssistantErrorKind::ProviderStatus,
                    format!("Quiz generation provider returned HTTP {status}"),
                ))
            }
            Err(ureq::Error::Timeout(_)) => {
                return Err(AssistantError::new(
                    AssistantErrorKind::Timeout,
                    "Quiz generation provider timed out",
                ))
            }
            Err(_) => {
                return Err(AssistantError::new(
                    AssistantErrorKind::Transport,
                    "Quiz generation provider request failed",
                ))
            }
        };
        let bytes = response
            .body_mut()
            .with_config()
            .limit(128 * 1024)
            .read_to_vec()
            .map_err(|_| {
                AssistantError::new(
                    AssistantErrorKind::ResponseRead,
                    "Cannot read quiz generation response",
                )
            })?;
        let value: Json = serde_json::from_slice(&bytes).map_err(|_| {
            AssistantError::new(
                AssistantErrorKind::InvalidJson,
                "Generation endpoint returned invalid JSON",
            )
        })?;
        validate_knowledge_checks(&value).map(AssistantResult::KnowledgeChecks)
    }
}

pub fn legacy_quiz_payload(request: &AssistantRequest) -> Result<Json, AssistantError> {
    if request.schema_version != ASSISTANT_SCHEMA_VERSION {
        return Err(AssistantError::new(
            AssistantErrorKind::InvalidConfiguration,
            "Unsupported assistant request schema",
        ));
    }
    let AssistantTask::KnowledgeChecks { count } = request.task;
    let expected_output = request.task.expected_output();
    Ok(json!({
        "model": request.model,
        "context": request.source.content,
        "count": count.get(),
        "task": "Draft short multiple-choice knowledge checks grounded only in the supplied article context. Return JSON only.",
        "responseSchema": match expected_output {
            ExpectedOutput::KnowledgeChecks => json!({
            "questions": [{
                "prompt": "string",
                "choices": ["string", "string"],
                "correctIndex": 0,
                "explanation": "string"
            }]
        })}
    }))
}

pub fn validate_knowledge_checks(value: &Json) -> Result<KnowledgeCheckSet, AssistantError> {
    let questions = value["questions"].as_array().ok_or_else(|| {
        AssistantError::new(
            AssistantErrorKind::InvalidResult,
            "generation response needs a `questions` array",
        )
    })?;
    if !(1..=3).contains(&questions.len()) {
        return Err(AssistantError::new(
            AssistantErrorKind::InvalidResult,
            "generation response needs between one and three questions",
        ));
    }
    let mut clean = Vec::with_capacity(questions.len());
    for (number, question) in questions.iter().enumerate() {
        let prompt = question["prompt"].as_str().unwrap_or("").trim();
        let choices = question["choices"].as_array().ok_or_else(|| {
            AssistantError::new(
                AssistantErrorKind::InvalidResult,
                format!("question {} needs a choices array", number + 1),
            )
        })?;
        let correct = question["correctIndex"].as_u64().ok_or_else(|| {
            AssistantError::new(
                AssistantErrorKind::InvalidResult,
                format!("question {} needs a correctIndex", number + 1),
            )
        })? as usize;
        let explanation = question["explanation"].as_str().unwrap_or("").trim();
        if prompt.is_empty() || prompt.chars().count() > 500 {
            return Err(AssistantError::new(
                AssistantErrorKind::InvalidResult,
                format!("question {} has an invalid prompt", number + 1),
            ));
        }
        if !(2..=4).contains(&choices.len()) || correct >= choices.len() {
            return Err(AssistantError::new(
                AssistantErrorKind::InvalidResult,
                format!(
                    "question {} needs two to four choices and a valid correctIndex",
                    number + 1
                ),
            ));
        }
        let mut clean_choices = Vec::with_capacity(choices.len());
        for choice in choices {
            let text = choice.as_str().unwrap_or("").trim();
            if text.is_empty() || text.chars().count() > 300 {
                return Err(AssistantError::new(
                    AssistantErrorKind::InvalidResult,
                    format!("question {} has an invalid choice", number + 1),
                ));
            }
            clean_choices.push(text.to_string());
        }
        if explanation.chars().count() > 1000 {
            return Err(AssistantError::new(
                AssistantErrorKind::InvalidResult,
                format!(
                    "question {} has an explanation that is too long",
                    number + 1
                ),
            ));
        }
        clean.push(KnowledgeCheck {
            prompt: prompt.to_string(),
            choices: clean_choices,
            correct_index: correct,
            explanation: explanation.to_string(),
        });
    }
    Ok(KnowledgeCheckSet { questions: clean })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalized_quiz_request_keeps_the_legacy_payload_shape() {
        let request = AssistantRequest {
            schema_version: ASSISTANT_SCHEMA_VERSION,
            task: AssistantTask::KnowledgeChecks {
                count: KnowledgeCheckCount::new(2).unwrap(),
            },
            model: "test-model".into(),
            source: AssistantSource {
                content: "Ownership moves a value.".into(),
            },
        };

        assert_eq!(
            legacy_quiz_payload(&request).unwrap(),
            json!({
                "model": "test-model",
                "context": "Ownership moves a value.",
                "count": 2,
                "task": "Draft short multiple-choice knowledge checks grounded only in the supplied article context. Return JSON only.",
                "responseSchema": {
                    "questions": [{
                        "prompt": "string",
                        "choices": ["string", "string"],
                        "correctIndex": 0,
                        "explanation": "string"
                    }]
                }
            })
        );
    }

    #[test]
    fn knowledge_check_count_rejects_impossible_requests() {
        for invalid in [0, 4, u8::MAX] {
            assert_eq!(
                KnowledgeCheckCount::new(invalid).unwrap_err().kind,
                AssistantErrorKind::InvalidConfiguration
            );
        }
    }

    #[test]
    fn knowledge_check_results_are_typed_and_strictly_validated() {
        let value = json!({
            "questions": [{
                "prompt": " What stays local? ",
                "choices": [" Attempts ", "Posts"],
                "correctIndex": 0,
                "explanation": " Reader attempts. "
            }]
        });
        let result = validate_knowledge_checks(&value).unwrap();
        assert_eq!(
            result.questions,
            vec![KnowledgeCheck {
                prompt: "What stays local?".into(),
                choices: vec!["Attempts".into(), "Posts".into()],
                correct_index: 0,
                explanation: "Reader attempts.".into(),
            }]
        );
        for bad in [
            json!({ "questions": [] }),
            json!({ "questions": [{ "prompt": "Q", "choices": ["A"], "correctIndex": 0 }] }),
            json!({ "questions": [{ "prompt": "Q", "choices": ["A", "B"], "correctIndex": 2 }] }),
            json!({ "questions": [{ "prompt": "", "choices": ["A", "B"], "correctIndex": 0 }] }),
        ] {
            assert_eq!(
                validate_knowledge_checks(&bad).unwrap_err().kind,
                AssistantErrorKind::InvalidResult
            );
        }
    }

    #[test]
    fn configuration_errors_never_expose_the_credential() {
        let error = match LegacyQuizEndpoint::new(
            "http://example.com/generate",
            Some("top-secret".into()),
            Duration::from_secs(1),
            false,
        ) {
            Ok(_) => panic!("insecure endpoint must fail"),
            Err(error) => error,
        };
        assert_eq!(error.kind, AssistantErrorKind::InvalidConfiguration);
        assert!(!error.to_string().contains("top-secret"));
    }
}

//! Studio's diagram preview (#566, #646): `GET diagram/templates` lists the examples a diagram can
//! start from, and `POST diagram/preview` checks one ` ```mermaid ` fence and draws it with the
//! same core code the build uses, so what the form shows is what the post will show.
//!
//! Studio runs under `script-src 'self'` with no WebAssembly, and keeps every one of its files on
//! the phone, so the preview is drawn here rather than in the page. The answer's SVG is the build's
//! sanitized output; Studio shows it only as an image it made itself (`blob:`), never as markup.
//! Drawing is bounded by the renderer's own deadline and by the source and option limits below.

use crate::http::{Request, Response};
use serde_json::json;

/// The most a preview request may carry: the source's limit (16 KiB) and three options' (1 KiB
/// each), with room for the JSON around them.
const MAX_REQUEST_BYTES: usize = 24 * 1024;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PreviewRequest {
    /// The fence's info string, exactly as the form will write it: `mermaid title="…" …`.
    info: String,
    /// The lines between the fences.
    source: String,
}

/// `GET diagram/templates`: the examples, in order (`id`, `label`, `source`).
pub(super) fn templates() -> Response {
    #[cfg(feature = "diagram-rendering")]
    {
        Response::json(
            200,
            &json!({ "templates": openblog_core::diagram::TEMPLATES }),
        )
    }
    #[cfg(not(feature = "diagram-rendering"))]
    not_drawn()
}

/// `POST diagram/preview`: `{ svg, alt }`, or 422 `{ code: "diagram", field, line, column,
/// error }` naming what is wrong and where, in the renderer's words.
pub(super) fn preview(req: &Request) -> Response {
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::json(
            413,
            &json!({ "error": "The diagram is too large to draw.", "code": "too-large" }),
        );
    }
    let Ok(body) = serde_json::from_slice::<PreviewRequest>(&req.body) else {
        return Response::json(
            400,
            &json!({ "error": "This request is not valid.", "code": "invalid" }),
        );
    };
    draw(&body.info, &body.source)
}

#[cfg(feature = "diagram-rendering")]
fn draw(info: &str, source: &str) -> Response {
    let checked = openblog_core::diagram::validate_source(info, source);
    let drawn = checked.and_then(|diagram| {
        openblog_core::diagram_svg::render_diagnostic(&diagram, 1)
            .map(|svg| (svg, diagram.alternative_text()))
            .map_err(|failure| openblog_core::diagram::Finding {
                line: failure.position.map_or(1, |(line, _)| line),
                column: failure.position.map_or(1, |(_, column)| column),
                message: failure.message,
            })
    });
    match drawn {
        Ok((svg, alt)) => Response::json(200, &json!({ "svg": svg, "alt": alt })),
        Err(finding) => Response::json(
            422,
            &json!({
                "error": finding.message,
                "code": "diagram",
                // A problem in the options is the title's, the description's or the words
                // under it; anything else is in the diagram itself.
                "field": field_of(&finding.message),
                "line": finding.line,
                "column": finding.column,
            }),
        ),
    }
}

#[cfg(not(feature = "diagram-rendering"))]
fn draw(_info: &str, _source: &str) -> Response {
    not_drawn()
}

#[cfg(not(feature = "diagram-rendering"))]
fn not_drawn() -> Response {
    Response::json(
        501,
        &json!({ "error": "This server was built without diagrams.", "code": "not-drawn" }),
    )
}

/// Which of the form's boxes a finding is about.
#[cfg_attr(not(feature = "diagram-rendering"), allow(dead_code))]
fn field_of(message: &str) -> &'static str {
    for field in ["title", "description", "caption"] {
        if message.contains(&format!("`{field}`")) || message.starts_with(&format!("{field} ")) {
            return field;
        }
    }
    "source"
}

#[cfg(all(test, feature = "diagram-rendering"))]
mod tests {
    use super::*;

    fn request(body: serde_json::Value) -> Request {
        let mut req = Request::default();
        req.method = "POST".into();
        req.body = body.to_string().into_bytes();
        req
    }

    fn body(response: &Response) -> serde_json::Value {
        serde_json::from_slice(&response.body).unwrap()
    }

    const FLOW: &str = "flowchart LR\n  A --> B\n";

    #[test]
    fn a_described_diagram_is_drawn_as_the_build_draws_it() {
        let info = r#"mermaid title="Two steps" description="A leads to B.""#;
        let answer = preview(&request(json!({ "info": info, "source": FLOW })));
        assert_eq!(
            answer.status,
            200,
            "{}",
            String::from_utf8_lossy(&answer.body)
        );
        let answer = body(&answer);
        let built = openblog_core::diagram_svg::render_diagnostic(
            &openblog_core::diagram::validate_source(info, FLOW).unwrap(),
            1,
        )
        .unwrap();
        assert_eq!(answer["svg"], json!(built));
        assert_eq!(answer["alt"], "Two steps: A leads to B.");
        let svg = answer["svg"].as_str().unwrap();
        assert!(svg.starts_with("<svg") && !svg.contains("<script"));
    }

    #[test]
    fn a_diagram_with_no_description_is_refused_with_its_reason() {
        let answer = preview(&request(json!({ "info": "mermaid", "source": FLOW })));
        assert_eq!(answer.status, 422);
        let answer = body(&answer);
        assert_eq!(answer["code"], "diagram");
        assert!(answer["error"].as_str().unwrap().len() > 3);
        assert!(answer["line"].as_u64().unwrap() >= 1);
    }

    #[test]
    fn source_that_does_not_parse_says_where() {
        let info = r#"mermaid title="Broken" description="It does not parse.""#;
        let answer = preview(&request(
            json!({ "info": info, "source": "flowchart LR\n  A -->\n" }),
        ));
        assert_eq!(answer.status, 422);
        assert_eq!(body(&answer)["field"], "source");
    }

    #[test]
    fn other_fences_unknown_fields_and_oversized_requests_are_refused() {
        let wrong = preview(&request(json!({ "info": "rust", "source": FLOW })));
        assert_eq!(wrong.status, 422);
        let extra = preview(&request(
            json!({ "info": "mermaid", "source": FLOW, "x": 1 }),
        ));
        assert_eq!(extra.status, 400);
        let huge = "A --> B\n".repeat(4000);
        let large = preview(&request(json!({ "info": "mermaid", "source": huge })));
        assert_eq!(large.status, 413);
    }

    #[test]
    fn the_templates_are_the_engines() {
        let answer = body(&templates());
        let ids: Vec<_> = answer["templates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap().to_string())
            .collect();
        let engine: Vec<_> = openblog_core::diagram::TEMPLATES
            .iter()
            .map(|t| t.id.to_string())
            .collect();
        assert_eq!(ids, engine);
    }

    #[test]
    fn a_finding_names_the_box_it_is_about() {
        assert_eq!(
            field_of("diagram option `title` has an unclosed quote"),
            "title"
        );
        assert_eq!(field_of("description must be a single line"), "description");
        assert_eq!(field_of("Parse error on line 2"), "source");
    }
}

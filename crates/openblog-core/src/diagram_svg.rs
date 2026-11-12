//! Opt-in static diagram rendering. Not yet connected to Markdown or publication.

use crate::{diagram::Diagram, escape};

const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE: &str = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";
const MAX_SOURCE_BYTES: usize = 16 * 1024;
const MAX_ALT_BYTES: usize = 1024;
const MAX_SVG_BYTES: usize = 1_000_000;

/// Render on native hosts with a cooperative deadline.
#[cfg(not(target_arch = "wasm32"))]
pub fn render(diagram: &Diagram, ordinal: usize) -> Result<String, String> {
    let control = merman::OperationControl::new().with_deadline(std::time::Duration::from_secs(2));
    render_with_control(diagram, ordinal, control)
}

/// Render inside a host-controlled Web Worker. The host must terminate it on timeout.
#[cfg(target_arch = "wasm32")]
pub fn render_in_worker(diagram: &Diagram, ordinal: usize) -> Result<String, String> {
    render_with_control(diagram, ordinal, merman::OperationControl::new())
}

fn render_with_control(
    diagram: &Diagram,
    ordinal: usize,
    control: merman::OperationControl,
) -> Result<String, String> {
    if diagram.source.len() > MAX_SOURCE_BYTES {
        return Err(format!("diagram source exceeds {MAX_SOURCE_BYTES} bytes"));
    }
    for (name, value) in [
        ("title", diagram.title.as_str()),
        ("description", diagram.description.as_str()),
    ] {
        if value.trim().is_empty()
            || value.len() > MAX_ALT_BYTES
            || value.chars().any(|character| {
                !matches!(character, '\u{9}' | '\u{a}' | '\u{d}')
                    && (character < '\u{20}' || character == '\u{fffe}' || character == '\u{ffff}')
            })
        {
            return Err(format!(
                "diagram {name} is empty, too long or contains invalid XML"
            ));
        }
    }
    if diagram.source.trim_start().starts_with("---")
        || diagram.source.contains("%%{")
        || diagram.source.lines().any(|line| {
            line.trim_start()
                .strip_prefix("click")
                .is_some_and(|rest| rest.starts_with(char::is_whitespace))
        })
    {
        return Err("diagram interaction and configuration directives are not supported".into());
    }
    let mut policy = merman::svg::RenderResourcePolicy::constrained();
    for (name, value) in [
        ("max_source_bytes", MAX_SOURCE_BYTES),
        ("max_model_items", 200),
        ("max_svg_bytes", MAX_SVG_BYTES),
    ] {
        policy
            .apply_override(name, value)
            .map_err(|error| error.to_string())?;
    }
    let prefix = format!("ob-diagram-{ordinal}");
    let config =
        merman::SourcePresentationConfig::from_value(serde_json::json!({"htmlLabels": false}));
    let request = merman::SvgRequest {
        environment: merman::SvgEnvironment::deterministic().with_resource_policy(policy),
        pipeline: Some(merman::svg::SvgPipeline::resvg_safe().with_static_inline_contract(&prefix)),
        ..merman::SvgRequest::default()
    };
    let output = merman::Renderer::new()
        .with_presentation_engine(merman::MermaidEngine::new().with_site_config(config))
        .with_parse_options(merman::ParseOptions::strict())
        .render(merman::RenderRequest::svg(
            &diagram.source,
            control,
            request,
        ))
        .map_err(|error| error.to_string())?;
    let merman::RenderOutput::Svg(Some(svg)) = output else {
        return Err("diagram renderer produced no SVG".into());
    };
    accessible_svg(svg.svg(), diagram, &prefix)
}

/// The renderer's static-inline pipeline validates the XML, SVG/CSS allowlists and local
/// references. This additional boundary forbids its otherwise allowed links and raster images.
fn accessible_svg(svg: &str, diagram: &Diagram, prefix: &str) -> Result<String, String> {
    if svg.len() > MAX_SVG_BYTES {
        return Err(format!("diagram SVG exceeds {MAX_SVG_BYTES} bytes"));
    }
    let doc =
        roxmltree::Document::parse(svg).map_err(|error| format!("invalid diagram SVG: {error}"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" || root.tag_name().namespace() != Some(SVG_NAMESPACE) {
        return Err("diagram renderer returned a non-SVG document".into());
    }
    let title_id = format!("{prefix}-accessible-title");
    let desc_id = format!("{prefix}-accessible-description");
    for node in doc.descendants().filter(|node| node.is_element()) {
        let name = node.tag_name().name();
        if node.tag_name().namespace() != Some(SVG_NAMESPACE)
            || matches!(
                name.to_ascii_lowercase().as_str(),
                "a" | "image" | "foreignobject" | "script"
            )
        {
            return Err(format!("diagram SVG contains forbidden element `{name}`"));
        }
        for attr in node.attributes() {
            let name = attr.name();
            if name.eq_ignore_ascii_case("id")
                && (attr.value() == title_id || attr.value() == desc_id)
            {
                return Err("diagram SVG collides with its accessible text IDs".into());
            }
            if name.to_ascii_lowercase().starts_with("on")
                || name.eq_ignore_ascii_case("base")
                || (name.eq_ignore_ascii_case("href") && !attr.value().starts_with('#'))
            {
                return Err(format!("diagram SVG contains forbidden attribute `{name}`"));
            }
        }
    }
    let start = root.range().start;
    let mut quote = None;
    let mut end = None;
    for (offset, byte) in svg.as_bytes()[start..].iter().copied().enumerate() {
        match (quote, byte) {
            (None, b'"' | b'\'') => quote = Some(byte),
            (Some(current), byte) if current == byte => quote = None,
            (None, b'>') => {
                end = Some(start + offset + 1);
                break;
            }
            _ => {}
        }
    }
    let end = end.ok_or("diagram SVG has an incomplete root element")?;
    if svg[start..end].trim_end().ends_with("/>") {
        return Err("diagram SVG has an empty root element".into());
    }
    let mut output = String::from(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"",
    );
    for attr in root.attributes() {
        if matches!(
            attr.name(),
            "role" | "aria-labelledby" | "aria-describedby" | "aria-roledescription"
        ) {
            continue;
        }
        let namespace = match attr.namespace() {
            None => "",
            Some(XML_NAMESPACE) => "xml:",
            Some(XLINK_NAMESPACE) => "xlink:",
            Some(_) => {
                return Err(format!(
                    "diagram SVG root has an unsupported attribute namespace for `{}`",
                    attr.name()
                ))
            }
        };
        output.push_str(&format!(
            " {namespace}{}=\"{}\"",
            attr.name(),
            escape::xml(attr.value())
        ));
    }
    output.push_str(&format!(
        " role=\"img\" aria-labelledby=\"{title_id} {desc_id}\"><title id=\"{title_id}\">{}</title><desc id=\"{desc_id}\">{}</desc>",
        escape::xml(&diagram.title), escape::xml(&diagram.description)
    ));
    output.push_str(&svg[end..]);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagram(source: &str) -> Diagram {
        crate::diagram::discover(&format!(
            "```mermaid title=\"Fallback\" description=\"Description\"\n{source}\n```"
        ))
        .remove(0)
        .unwrap()
    }

    #[test]
    fn renders_accessible_scoped_svg() {
        let diagram = diagram("flowchart LR\nA --> B");
        let first = render(&diagram, 1).unwrap();
        let second = render(&diagram, 2).unwrap();
        let one = roxmltree::Document::parse(&first).unwrap();
        let two = roxmltree::Document::parse(&second).unwrap();
        assert_eq!(one.root_element().attribute("role"), Some("img"));
        assert_eq!(
            one.root_element().attribute("aria-labelledby"),
            Some("ob-diagram-1-accessible-title ob-diagram-1-accessible-description")
        );
        assert_eq!(
            one.descendants()
                .find(|node| node.attribute("id") == Some("ob-diagram-1-accessible-title"))
                .unwrap()
                .text(),
            Some("Fallback")
        );
        let ids = |doc: &roxmltree::Document<'_>| {
            doc.descendants()
                .filter_map(|node| node.attribute("id").map(str::to_owned))
                .collect::<std::collections::BTreeSet<_>>()
        };
        assert!(ids(&one).is_disjoint(&ids(&two)));
        assert_eq!(first, render(&diagram, 1).unwrap());
    }

    #[test]
    fn rejects_interaction_directives_and_bad_svg() {
        for source in [
            "flowchart LR\nA --> B\nclick A \"https://example.test\"",
            "%%{init: {}}%%\nflowchart LR\nA --> B",
        ] {
            assert!(render(&diagram(source), 1)
                .unwrap_err()
                .contains("directives"));
        }
        let d = diagram("flowchart LR\nA --> B");
        for element in [
            "<script/>",
            "<image/>",
            "<a href=\"https://example.test\"/>",
            "<foreignObject/>",
        ] {
            let svg = format!("<svg xmlns=\"{SVG_NAMESPACE}\">{element}</svg>");
            assert!(accessible_svg(&svg, &d, "test").is_err());
        }
    }

    #[test]
    fn renders_shared_fixtures_and_rejects_malformed_input() {
        for source in [
            include_str!("../../../tests/fixtures/diagrams/flowchart.mmd"),
            include_str!("../../../tests/fixtures/diagrams/sequence.mmd"),
            include_str!("../../../tests/fixtures/diagrams/gitgraph.mmd"),
            include_str!("../../../tests/fixtures/diagrams/state.mmd"),
            include_str!("../../../tests/fixtures/diagrams/er.mmd"),
            include_str!("../../../tests/fixtures/diagrams/class.mmd"),
            include_str!("../../../tests/fixtures/diagrams/c4.mmd"),
        ] {
            let result = render(&diagram(source), 7).unwrap();
            let parsed = roxmltree::Document::parse(&result).unwrap();
            assert_eq!(parsed.root_element().attribute("role"), Some("img"));
        }
        assert!(render(
            &diagram(include_str!(
                "../../../tests/fixtures/diagrams/malformed.mmd"
            )),
            1
        )
        .is_err());
    }

    #[test]
    fn rejects_oversized_source_and_escapes_accessible_text() {
        let mut d = diagram("flowchart LR\nA --> B");
        d.title = "A & <B>".into();
        d.description = "C & <D>".into();
        let output = render(&d, 1).unwrap();
        let parsed = roxmltree::Document::parse(&output).unwrap();
        assert_eq!(
            parsed
                .descendants()
                .find(|node| node.attribute("id") == Some("ob-diagram-1-accessible-title"))
                .unwrap()
                .text(),
            Some("A & <B>")
        );
        d.source = "x".repeat(MAX_SOURCE_BYTES + 1);
        assert!(render(&d, 1).unwrap_err().contains("exceeds"));
        d.source = "flowchart LR\nA --> B".into();
        d.title = "bad\u{0}title".into();
        assert!(render(&d, 1).unwrap_err().contains("invalid XML"));
    }

    #[test]
    fn rejects_a_diagram_exceeding_the_model_budget() {
        let mut d = diagram("flowchart LR\nA --> B");
        d.source = format!(
            "flowchart LR\n{}",
            (0..300)
                .map(|index| format!("n{index}[Node {index}]\n"))
                .collect::<String>()
        );
        assert!(d.source.len() < MAX_SOURCE_BYTES);
        assert!(render(&d, 1).is_err());
    }

    #[test]
    fn rejects_hostile_input_or_produces_audited_svg() {
        for source in [
            include_str!("../../../tests/fixtures/diagrams/hostile/click.mmd"),
            include_str!("../../../tests/fixtures/diagrams/hostile/directive.mmd"),
            include_str!("../../../tests/fixtures/diagrams/hostile/html.mmd"),
        ] {
            if let Ok(output) = render(&diagram(source), 1) {
                let parsed = roxmltree::Document::parse(&output).unwrap();
                for node in parsed.descendants().filter(|node| node.is_element()) {
                    assert!(!matches!(
                        node.tag_name().name().to_ascii_lowercase().as_str(),
                        "a" | "image" | "foreignobject" | "script"
                    ));
                    for attr in node.attributes() {
                        assert!(!attr.name().to_ascii_lowercase().starts_with("on"));
                        if attr.name().eq_ignore_ascii_case("href") {
                            assert!(attr.value().starts_with('#'));
                        }
                    }
                }
            }
        }
    }
}

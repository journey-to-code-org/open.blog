#[cfg(feature = "merman")]
pub fn render_merman(source: &str) -> Result<String, String> {
    let config = merman::SourcePresentationConfig::from_value(serde_json::json!({
        "htmlLabels": false
    }));
    let output = merman::Renderer::new()
        .with_presentation_engine(merman::MermaidEngine::new().with_site_config(config))
        .with_parse_options(merman::ParseOptions::strict())
        .render(merman::RenderRequest::svg(
            source,
            merman::OperationControl::new(),
            merman::SvgRequest::default(),
        ))
        .map_err(|error| error.to_string())?;
    match output {
        merman::RenderOutput::Svg(Some(svg)) => Ok(svg.svg().to_owned()),
        _ => Err("renderer returned no SVG".into()),
    }
}

#[cfg(all(feature = "merman", not(target_arch = "wasm32")))]
pub fn render_merman_bounded(
    source: &str,
    prefix: &str,
    max_model_items: usize,
    timeout: std::time::Duration,
) -> Result<String, String> {
    let control = merman::OperationControl::new().with_deadline(timeout);
    render_merman_with_control(source, prefix, max_model_items, control)
}

#[cfg(feature = "merman")]
fn render_merman_with_control(
    source: &str,
    prefix: &str,
    max_model_items: usize,
    control: merman::OperationControl,
) -> Result<String, String> {
    let mut policy = merman::svg::RenderResourcePolicy::constrained();
    for (name, value) in [
        ("max_source_bytes", 16 * 1024),
        ("max_model_items", max_model_items),
        ("max_svg_bytes", 1_000_000),
    ] {
        policy
            .apply_override(name, value)
            .map_err(|error| error.to_string())?;
    }
    let config =
        merman::SourcePresentationConfig::from_value(serde_json::json!({"htmlLabels": false}));
    let request = merman::SvgRequest {
        environment: merman::SvgEnvironment::deterministic().with_resource_policy(policy),
        pipeline: Some(merman::svg::SvgPipeline::resvg_safe().with_static_inline_contract(prefix)),
        ..merman::SvgRequest::default()
    };
    let output = merman::Renderer::new()
        .with_presentation_engine(merman::MermaidEngine::new().with_site_config(config))
        .with_parse_options(merman::ParseOptions::strict())
        .render(merman::RenderRequest::svg(source, control, request))
        .map_err(|error| error.to_string())?;
    match output {
        merman::RenderOutput::Svg(Some(svg)) => Ok(svg.svg().to_owned()),
        _ => Err("renderer returned no SVG".into()),
    }
}

#[cfg(all(test, feature = "merman", not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn constrained_policy_renders_the_small_fixture_corpus() {
        for source in [
            include_str!("../../../tests/fixtures/diagrams/flowchart.mmd"),
            include_str!("../../../tests/fixtures/diagrams/sequence.mmd"),
            include_str!("../../../tests/fixtures/diagrams/gitgraph.mmd"),
            include_str!("../../../tests/fixtures/diagrams/state.mmd"),
            include_str!("../../../tests/fixtures/diagrams/er.mmd"),
            include_str!("../../../tests/fixtures/diagrams/class.mmd"),
            include_str!("../../../tests/fixtures/diagrams/c4.mmd"),
        ] {
            let svg = render_merman_bounded(source, "ob-diagram-test", 200, Duration::from_secs(2))
                .unwrap();
            assert!(svg.starts_with("<svg"));
        }
    }

    #[test]
    fn constrained_policy_rejects_source_and_model_limits() {
        let large_source = format!("flowchart LR\n{}", "A".repeat(16 * 1024));
        let error = render_merman_bounded(
            &large_source,
            "ob-diagram-test",
            200,
            Duration::from_secs(2),
        )
        .unwrap_err();
        assert!(error.contains("max_source_bytes"), "{error}");
        let many_nodes = format!(
            "flowchart LR\n{}",
            (0..100).map(|n| format!("N{n}\n")).collect::<String>()
        );
        let error =
            render_merman_bounded(&many_nodes, "ob-diagram-test", 10, Duration::from_secs(2))
                .unwrap_err();
        assert!(error.contains("max_model_items"), "{error}");
    }

    #[test]
    fn expired_cooperative_deadline_is_reported() {
        let error = render_merman_bounded(
            "flowchart LR\nA --> B",
            "ob-diagram-test",
            200,
            Duration::ZERO,
        )
        .unwrap_err();
        assert!(
            error.to_lowercase().contains("deadline") || error.to_lowercase().contains("cancel"),
            "{error}"
        );
    }

    #[test]
    fn static_inline_contract_scopes_ids_for_multiple_diagrams() {
        let ids = |svg: &str| {
            let doc = roxmltree::Document::parse(svg).unwrap();
            let mut ids = std::collections::BTreeSet::new();
            for id in doc.descendants().filter_map(|node| node.attribute("id")) {
                assert!(ids.insert(id.to_owned()), "duplicate ID {id}");
            }
            ids
        };
        for source in [
            include_str!("../../../tests/fixtures/diagrams/flowchart.mmd"),
            include_str!("../../../tests/fixtures/diagrams/sequence.mmd"),
            include_str!("../../../tests/fixtures/diagrams/gitgraph.mmd"),
            include_str!("../../../tests/fixtures/diagrams/state.mmd"),
            include_str!("../../../tests/fixtures/diagrams/er.mmd"),
            include_str!("../../../tests/fixtures/diagrams/class.mmd"),
            include_str!("../../../tests/fixtures/diagrams/c4.mmd"),
        ] {
            let first =
                render_merman_bounded(source, "diagram-one", 200, Duration::from_secs(2)).unwrap();
            let second =
                render_merman_bounded(source, "diagram-two", 200, Duration::from_secs(2)).unwrap();
            let first_ids = ids(&first);
            let second_ids = ids(&second);
            assert!(!first_ids.is_empty());
            assert!(first_ids.is_disjoint(&second_ids));
        }
    }

    #[test]
    fn static_inline_contract_rejects_or_neutralizes_hostile_fixtures() {
        let mut rendered = 0;
        for (name, source) in [
            (
                "click",
                include_str!("../../../tests/fixtures/diagrams/hostile/click.mmd"),
            ),
            (
                "directive",
                include_str!("../../../tests/fixtures/diagrams/hostile/directive.mmd"),
            ),
            (
                "html",
                include_str!("../../../tests/fixtures/diagrams/hostile/html.mmd"),
            ),
        ] {
            let svg =
                match render_merman_bounded(source, "diagram-hostile", 200, Duration::from_secs(2))
                {
                    Ok(svg) => {
                        rendered += 1;
                        svg
                    }
                    Err(error) => {
                        println!("{name}: rejected: {error}");
                        continue;
                    }
                };
            let doc = roxmltree::Document::parse(&svg).unwrap();
            for node in doc.descendants().filter(|node| node.is_element()) {
                assert!(!matches!(
                    node.tag_name().name().to_ascii_lowercase().as_str(),
                    "script" | "foreignobject" | "image"
                ));
                for attribute in node.attributes() {
                    let name = attribute.name().to_ascii_lowercase();
                    assert!(!name.starts_with("on"));
                    if name == "href" {
                        assert!(
                            attribute.value().starts_with('#'),
                            "non-fragment href: {}",
                            attribute.value()
                        );
                    }
                }
            }
            let lower = svg.to_ascii_lowercase();
            assert!(!lower.contains("javascript:"));
            println!("{name}: rendered without inspected active elements or attributes");
        }
        assert!(rendered > 0);
    }
}

#[cfg(all(feature = "merman", target_arch = "wasm32"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn render_merman_wasm(source: &str) -> Result<String, wasm_bindgen::JsValue> {
    render_merman(source).map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

#[cfg(all(feature = "merman", target_arch = "wasm32"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn render_merman_static_wasm(
    source: &str,
    prefix: &str,
) -> Result<String, wasm_bindgen::JsValue> {
    render_merman_with_control(source, prefix, 200, merman::OperationControl::new())
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

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
    max_model_items: usize,
    timeout: std::time::Duration,
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
        ..merman::SvgRequest::default()
    };
    let control = merman::OperationControl::new().with_deadline(timeout);
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
            let svg = render_merman_bounded(source, 200, Duration::from_secs(2)).unwrap();
            assert!(svg.starts_with("<svg"));
        }
    }

    #[test]
    fn constrained_policy_rejects_source_and_model_limits() {
        let large_source = format!("flowchart LR\n{}", "A".repeat(16 * 1024));
        let error = render_merman_bounded(&large_source, 200, Duration::from_secs(2)).unwrap_err();
        assert!(error.contains("max_source_bytes"), "{error}");
        let many_nodes = format!(
            "flowchart LR\n{}",
            (0..100).map(|n| format!("N{n}\n")).collect::<String>()
        );
        let error = render_merman_bounded(&many_nodes, 10, Duration::from_secs(2)).unwrap_err();
        assert!(error.contains("max_model_items"), "{error}");
    }

    #[test]
    fn expired_cooperative_deadline_is_reported() {
        let error =
            render_merman_bounded("flowchart LR\nA --> B", 200, Duration::ZERO).unwrap_err();
        assert!(
            error.to_lowercase().contains("deadline") || error.to_lowercase().contains("cancel"),
            "{error}"
        );
    }
}

#[cfg(all(feature = "merman", target_arch = "wasm32"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn render_merman_wasm(source: &str) -> Result<String, wasm_bindgen::JsValue> {
    render_merman(source).map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

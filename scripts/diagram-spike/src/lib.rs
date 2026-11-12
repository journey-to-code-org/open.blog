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

#[cfg(all(feature = "merman", target_arch = "wasm32"))]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn render_merman_wasm(source: &str) -> Result<String, wasm_bindgen::JsValue> {
    render_merman(source).map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

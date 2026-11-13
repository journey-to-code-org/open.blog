//! Opt-in static diagram rendering for Markdown publication and editor previews.

use crate::{diagram::Diagram, escape};

const SVG_NAMESPACE: &str = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE: &str = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";
const MAX_SOURCE_BYTES: usize = 16 * 1024;
const MAX_ALT_BYTES: usize = 1024;
const MAX_SVG_BYTES: usize = 1_000_000;

#[cfg(not(target_arch = "wasm32"))]
const CACHE_MAX_BYTES: usize = 8 * 1024 * 1024;
#[cfg(not(target_arch = "wasm32"))]
const CACHE_MAX_ENTRIES: usize = 32;
#[cfg(not(target_arch = "wasm32"))]
static CACHE: std::sync::OnceLock<std::sync::Mutex<RenderCache>> = std::sync::OnceLock::new();

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct RenderCache {
    entries: std::collections::BTreeMap<[u8; 32], String>,
    order: std::collections::VecDeque<[u8; 32]>,
    bytes: usize,
}

#[cfg(not(target_arch = "wasm32"))]
impl RenderCache {
    fn get(&mut self, key: &[u8; 32]) -> Option<String> {
        let value = self.entries.get(key)?.clone();
        self.order.retain(|entry| entry != key);
        self.order.push_back(*key);
        Some(value)
    }

    fn insert(&mut self, key: [u8; 32], svg: String) {
        if svg.len() > CACHE_MAX_BYTES {
            return;
        }
        if let Some(previous) = self.entries.remove(&key) {
            self.bytes -= previous.len();
            self.order.retain(|entry| *entry != key);
        }
        while self.entries.len() >= CACHE_MAX_ENTRIES || self.bytes + svg.len() > CACHE_MAX_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.bytes -= removed.len();
            }
        }
        self.bytes += svg.len();
        self.entries.insert(key, svg);
        self.order.push_back(key);
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn cache_key(diagram: &Diagram, ordinal: usize) -> [u8; 32] {
    use blake2::{Blake2s256, Digest};
    let mut digest = Blake2s256::new();
    for value in [
        "merman-0.10.0-static-inline-v1",
        &diagram.source,
        &diagram.title,
        &diagram.description,
        diagram.options.title.as_deref().unwrap_or(""),
        diagram.options.description.as_deref().unwrap_or(""),
        diagram.options.caption.as_deref().unwrap_or(""),
        diagram.options.source.as_deref().unwrap_or(""),
    ] {
        digest.update((value.len() as u64).to_le_bytes());
        digest.update(value.as_bytes());
    }
    digest.update((ordinal as u64).to_le_bytes());
    digest.finalize().into()
}

/// A renderer diagnostic, with a source position when the parser provides one.
#[derive(Debug)]
pub struct RenderFailure {
    pub message: String,
    pub position: Option<(usize, usize)>,
}

impl From<String> for RenderFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            position: None,
        }
    }
}

impl From<&str> for RenderFailure {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

/// Render on native hosts with a cooperative deadline.
#[cfg(not(target_arch = "wasm32"))]
pub fn render(diagram: &Diagram, ordinal: usize) -> Result<String, String> {
    render_diagnostic(diagram, ordinal).map_err(|error| error.message)
}

/// Render on native hosts, retaining structured parser positions when available.
#[cfg(not(target_arch = "wasm32"))]
pub fn render_diagnostic(diagram: &Diagram, ordinal: usize) -> Result<String, RenderFailure> {
    let control = merman::OperationControl::new().with_deadline(std::time::Duration::from_secs(2));
    if diagram.source.len() > MAX_SOURCE_BYTES
        || diagram.title.len() > MAX_ALT_BYTES
        || diagram.description.len() > MAX_ALT_BYTES
        || [
            &diagram.options.title,
            &diagram.options.description,
            &diagram.options.caption,
            &diagram.options.source,
        ]
        .iter()
        .any(|value| {
            value
                .as_ref()
                .is_some_and(|text| text.len() > MAX_ALT_BYTES)
        })
    {
        return render_with_control(diagram, ordinal, control);
    }
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(RenderCache::default()));
    let key = cache_key(diagram, ordinal);
    if let Some(svg) = cache
        .lock()
        .map_err(|_| RenderFailure::from("diagram render cache lock is poisoned"))?
        .get(&key)
    {
        return Ok(svg);
    }
    let svg = render_with_control(diagram, ordinal, control)?;
    cache
        .lock()
        .map_err(|_| RenderFailure::from("diagram render cache lock is poisoned"))?
        .insert(key, svg.clone());
    Ok(svg)
}

/// Render inside a host-controlled Web Worker. The host must terminate it on timeout.
#[cfg(target_arch = "wasm32")]
pub fn render_in_worker(diagram: &Diagram, ordinal: usize) -> Result<String, String> {
    render_diagnostic_in_worker(diagram, ordinal).map_err(|error| error.message)
}

/// Render inside a host-controlled Worker, retaining structured parser positions.
#[cfg(target_arch = "wasm32")]
pub fn render_diagnostic_in_worker(
    diagram: &Diagram,
    ordinal: usize,
) -> Result<String, RenderFailure> {
    render_with_control(diagram, ordinal, merman::OperationControl::new())
}

fn render_with_control(
    diagram: &Diagram,
    ordinal: usize,
    control: merman::OperationControl,
) -> Result<String, RenderFailure> {
    if diagram.source.len() > MAX_SOURCE_BYTES {
        return Err(format!("diagram source exceeds {MAX_SOURCE_BYTES} bytes").into());
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
            return Err(
                format!("diagram {name} is empty, too long or contains invalid XML").into(),
            );
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
        .map_err(|error| {
            let position = match &error {
                merman::RenderError::Parse(diagnostic) => diagnostic
                    .terminal_diagnostic_details()
                    .span
                    .and_then(|span| source_position(&diagram.source, span.start)),
                _ => None,
            };
            RenderFailure {
                message: error.to_string(),
                position,
            }
        })?;
    let merman::RenderOutput::Svg(Some(svg)) = output else {
        return Err("diagram renderer produced no SVG".into());
    };
    accessible_svg(svg.svg(), diagram, &prefix).map_err(Into::into)
}

fn source_position(source: &str, offset: usize) -> Option<(usize, usize)> {
    let prefix = source.get(..offset)?;
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let column = prefix.rsplit('\n').next()?.chars().count() + 1;
    Some((line, column))
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
    let mut ids = std::collections::BTreeSet::new();
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
            if name.eq_ignore_ascii_case("id") {
                if attr.value() == title_id || attr.value() == desc_id {
                    return Err("diagram SVG collides with its accessible text IDs".into());
                }
                if !ids.insert(attr.value()) {
                    return Err("diagram SVG contains duplicate IDs".into());
                }
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
    if output.len() > MAX_SVG_BYTES {
        return Err(format!("diagram SVG exceeds {MAX_SVG_BYTES} bytes"));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_keys_include_source_options_renderer_and_svg_scope() {
        let original = diagram("flowchart LR\nA --> B");
        let key = cache_key(&original, 1);
        assert_eq!(key, cache_key(&original, 1));
        assert_ne!(key, cache_key(&original, 2));
        let mut changed = original.clone();
        changed.source.push_str("\nB --> C");
        assert_ne!(key, cache_key(&changed, 1));
        changed = original.clone();
        changed.options.caption = Some("A caption".into());
        assert_ne!(key, cache_key(&changed, 1));
        changed = original;
        changed.title.push('!');
        assert_ne!(key, cache_key(&changed, 1));
    }

    #[test]
    fn render_cache_is_bounded_and_evicts_least_recently_used() {
        let mut cache = RenderCache::default();
        for index in 0..CACHE_MAX_ENTRIES {
            let mut key = [0; 32];
            key[0] = index as u8;
            cache.insert(key, "svg".into());
        }
        assert_eq!(cache.get(&[0; 32]).as_deref(), Some("svg"));
        let mut next = [0; 32];
        next[0] = CACHE_MAX_ENTRIES as u8;
        cache.insert(next, "svg".into());
        let mut evicted = [0; 32];
        evicted[0] = 1;
        assert!(cache.get(&evicted).is_none());
        assert!(cache.get(&[0; 32]).is_some());
        cache.insert([255; 32], "x".repeat(CACHE_MAX_BYTES));
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.bytes, CACHE_MAX_BYTES);
        cache.insert([254; 32], "x".repeat(CACHE_MAX_BYTES + 1));
        assert_eq!(cache.entries.len(), 1);
    }

    #[test]
    fn successful_render_is_cached_but_failures_are_not() {
        let valid = diagram("flowchart LR\nCacheNode --> OtherNode");
        let invalid = diagram("flowchart LR\nCacheNode[Unclosed --> OtherNode");
        let first = render_diagnostic(&valid, 41).unwrap();
        assert_eq!(render_diagnostic(&valid, 41).unwrap(), first);
        assert!(render_diagnostic(&invalid, 42).is_err());
        let cache = CACHE.get().unwrap().lock().unwrap();
        assert_eq!(cache.entries.get(&cache_key(&valid, 41)), Some(&first));
        assert!(!cache.entries.contains_key(&cache_key(&invalid, 42)));
    }

    #[test]
    fn parser_positions_count_unicode_characters_and_reject_invalid_offsets() {
        let source = "first\néx\nlast";
        assert_eq!(source_position(source, 8), Some((2, 2)));
        assert_eq!(source_position(source, 7), None);
        assert_eq!(source_position(source, source.len() + 1), None);
    }

    #[test]
    fn parser_error_preserves_structured_source_position() {
        let input = diagram("flowchart LR\nA[Unclosed label --> B\n");
        let error = render_diagnostic(&input, 1).unwrap_err();
        assert!(
            error.position.is_some_and(|(line, _)| line >= 2),
            "{error:?}"
        );
    }

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
    fn rejects_duplicate_ids_event_handlers_and_external_references() {
        let d = diagram("flowchart LR\nA --> B");
        for element in [
            "<g id=\"duplicate\"/><path id=\"duplicate\"/>",
            "<g id=\"test-accessible-title\"/>",
            "<g OnLoAd=\"alert(1)\"/>",
            "<use href=\"https://example.test/other.svg#shape\"/>",
            "<use href=\"//example.test/other.svg#shape\"/>",
            "<use href=\"javascript:alert(1)\"/>",
            "<use href=\"data:image/svg+xml,x\"/>",
            "<g xmlns=\"http://www.w3.org/1999/xhtml\"/>",
        ] {
            let svg = format!("<svg xmlns=\"{SVG_NAMESPACE}\">{element}</svg>");
            assert!(accessible_svg(&svg, &d, "test").is_err(), "{element}");
        }
        let svg =
            format!("<svg xmlns=\"{SVG_NAMESPACE}\"><g id=\"local\"/><use href=\"#local\"/></svg>");
        assert!(accessible_svg(&svg, &d, "test").is_ok());
    }

    #[test]
    fn svg_limit_applies_after_accessible_markup_is_added() {
        let d = diagram("flowchart LR\nA --> B");
        let open = format!("<svg xmlns=\"{SVG_NAMESPACE}\"><text>");
        let close = "</text></svg>";
        let padding = MAX_SVG_BYTES - open.len() - close.len();
        let svg = format!("{open}{}{close}", "x".repeat(padding));
        assert_eq!(svg.len(), MAX_SVG_BYTES);
        assert!(accessible_svg(&svg, &d, "test")
            .unwrap_err()
            .contains("exceeds"));
        let smaller = format!("{open}{}{close}", "x".repeat(padding - 1024));
        assert!(accessible_svg(&smaller, &d, "test").is_ok());
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
    fn model_budget_rejects_large_node_sets_across_diagram_families() {
        type Case = (&'static str, fn(usize) -> String);
        let cases: [Case; 7] = [
            ("flowchart LR", |n| format!("n{n}[Node {n}]")),
            ("stateDiagram-v2", |n| format!("[*] --> S{n}")),
            ("classDiagram", |n| format!("class C{n}")),
            ("erDiagram", |n| format!("ENTITY{n} {{\n string field\n}}")),
            ("sequenceDiagram", |n| format!("participant P{n}")),
            ("gitGraph", |n| format!("commit id: \"c{n}\"")),
            ("C4Context", |n| format!("Person(p{n}, \"Person {n}\")")),
        ];
        for (header, node) in cases {
            let source = format!(
                "{header}\n{}\n",
                (0..201).map(node).collect::<Vec<_>>().join("\n")
            );
            assert!(source.len() < MAX_SOURCE_BYTES, "{header}");
            let error = match render(&diagram(&source), 1) {
                Ok(_) => panic!("{header}: exceeded model budget without refusal"),
                Err(error) => error,
            };
            assert!(error.contains("max_model_items"), "{header}: {error}");
        }
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

//! Server-rendered theme components (ADR 0409).
//!
//! A component a theme declares with a Zubra `source` is rendered at build time with the values its
//! landing section gives, so the element has its content before its script runs: readers without
//! JavaScript, and Admin's preview (which runs no scripts), see the component itself rather than its
//! fallback line. Parts only the browser can compute (today's date, the window size) are left for the
//! element to fill in, with Zubra's partial rendering.
//!
//! open.blog does not link Zubra's compiler. It runs the `zubra` command when one is installed
//! (`npm i -g @zubra/compiler`, or the Rust CLI), or the command in `OPENBLOG_ZUBRA`, so the engine
//! keeps its dependencies and its Rust version, and the HTML is the compiler's own. Without the
//! command nothing is rendered ahead and each element is written empty, exactly as before. A source
//! that cannot be compiled is a warning, never a failed build: the element still renders in the
//! browser.

use std::path::Path;

use openblog_core::components::Component;
use openblog_core::theme::ThemeSet;
use openblog_core::Site;

/// The values the element is rendered with: each declared setting the section gives, or its
/// default; a toggle that is off is left out.
fn values(
    component: &Component,
    given: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    for prop in &component.props {
        let value = given
            .get(&prop.name)
            .filter(|v| !v.is_null() && v.as_str() != Some(""))
            .or(prop.default.as_ref());
        match value {
            Some(serde_json::Value::Bool(false)) | None => {}
            Some(value) => {
                out.insert(prop.name.clone(), value.clone());
            }
        }
    }
    serde_json::Value::Object(out)
}

/// The element's content from Zubra's output: what is between its own opening and closing tags.
fn inner(html: &str, tag: &str) -> Option<String> {
    let open = html.find(&format!("<{tag}"))?;
    let start = open + html[open..].find('>')? + 1;
    let end = html.rfind(&format!("</{tag}>"))?;
    (end >= start).then(|| html[start..end].trim_matches('\n').to_string())
}

/// The command that runs Zubra's compiler: `OPENBLOG_ZUBRA` (a program and any leading arguments,
/// such as `npx -y @zubra/compiler@5.8.0`), or `zubra` when it is on the path. Worked out once.
fn command() -> Option<&'static [String]> {
    static FOUND: std::sync::OnceLock<Option<Vec<String>>> = std::sync::OnceLock::new();
    FOUND
        .get_or_init(|| {
            let words: Vec<String> = match std::env::var("OPENBLOG_ZUBRA") {
                Ok(value) if !value.trim().is_empty() => {
                    value.split_whitespace().map(str::to_string).collect()
                }
                _ => vec!["zubra".to_string()],
            };
            let (program, args) = words.split_first()?;
            let runs = std::process::Command::new(program)
                .args(args)
                .arg("help")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok();
            runs.then_some(words)
        })
        .as_deref()
}

/// Rendered content by source, its modification time and the values, so Admin's live preview does
/// not run the compiler again for a page it has already rendered.
fn cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Fill `site.component_html` for the landing page's component sections, from the theme the site is
/// wearing. Problems are added to the site's warnings.
pub fn render(root: &Path, themes: &ThemeSet, site: &mut Site) {
    let Some(landing) = site.landing.clone() else {
        return;
    };
    let Ok(theme) = themes.resolve(&site.config.theme) else {
        return;
    };
    let themes_dir = root.join(&site.config.paths.themes);
    for section in &landing.sections {
        let openblog_core::landing::SectionKind::Component(placed) = &section.kind else {
            continue;
        };
        let Some(component) = theme.components.get(&placed.tag) else {
            continue;
        };
        let Some(rel) = component.source.strip_prefix("/themes/") else {
            continue;
        };
        let Some(command) = command() else {
            return;
        };
        // A post setting is rendered with the post's address. The element's attribute carries the
        // site's base path; here the address stays root-relative, because the page's links are
        // given the base path when the page is written, and a link would otherwise get it twice.
        let mut given = placed.props.clone();
        for (name, value) in given.iter_mut() {
            if !component.picks_post(name) {
                continue;
            }
            let address = value.as_str().and_then(|slug| {
                site.posts
                    .iter()
                    .find(|post| post.slug == slug && !post.draft)
                    .map(|post| post.url.clone())
            });
            *value = address.map_or(serde_json::Value::Null, serde_json::Value::String);
        }
        match render_one(command, &themes_dir, rel, component, &given) {
            Ok(html) => {
                site.component_html.insert(section.id.clone(), html);
            }
            Err(problem) => site.warnings.push(format!(
                "content/landing.json: section `{}`: the component `{}` is left to the browser, because its source could not be rendered: {problem}",
                section.id, placed.tag
            )),
        }
    }
}

fn render_one(
    command: &[String],
    themes_dir: &Path,
    rel: &str,
    component: &Component,
    given: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, String> {
    let path = themes_dir.join(rel);
    let modified = std::fs::metadata(&path)
        .and_then(|meta| meta.modified())
        .map_err(|error| format!("cannot read themes/{rel} ({error})"))?;
    let props = values(component, given).to_string();
    let key = format!("{}\u{0}{modified:?}\u{0}{props}", path.display());
    if let Some(html) = cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).cloned())
    {
        return Ok(html);
    }
    let props_file = std::env::temp_dir().join(format!(
        "openblog-zubra-props-{}-{}.json",
        std::process::id(),
        cache().lock().map(|cache| cache.len()).unwrap_or(0)
    ));
    std::fs::write(&props_file, &props).map_err(|error| error.to_string())?;
    let (program, args) = command.split_first().ok_or("no zubra command")?;
    let output = std::process::Command::new(program)
        .args(args)
        .arg("compile")
        .arg(&path)
        .arg("--props")
        .arg(&props_file)
        .arg("--partial")
        .output();
    std::fs::remove_file(&props_file).ok();
    let output = output.map_err(|error| format!("cannot run zubra ({error})"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() || !stdout.contains(&format!("<{}", component.tag)) {
        let said = String::from_utf8_lossy(&output.stderr);
        let first = said
            .lines()
            .chain(stdout.lines())
            .find(|line| !line.trim().is_empty())
            .unwrap_or("zubra did not render it");
        return Err(first.chars().take(300).collect());
    }
    let html = inner(&stdout, &component.tag)
        .ok_or_else(|| format!("its output has no <{}> element", component.tag))?;
    if let Ok(mut cache) = cache().lock() {
        if cache.len() > 256 {
            cache.clear();
        }
        cache.insert(key, html.clone());
    }
    Ok(html)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_content_is_what_sits_inside_the_element() {
        let html = "<holiday-countdown holiday=\"christmas\">\n  <p class=\"sign\">Counting down to Christmas</p>\n</holiday-countdown>\n";
        assert_eq!(
            inner(html, "holiday-countdown").unwrap(),
            "  <p class=\"sign\">Counting down to Christmas</p>"
        );
        assert_eq!(inner("<other></other>", "holiday-countdown"), None);
    }

    #[test]
    fn values_take_defaults_and_leave_out_toggles_that_are_off() {
        let component = Component::check(
            "holiday-countdown",
            &serde_json::from_value(serde_json::json!({
                "label": "Countdown sign", "script": "x.js",
                "props": [
                    { "name": "holiday", "type": "choice", "label": "Holiday", "default": "thanksgiving",
                      "choices": [ { "value": "thanksgiving", "label": "T" }, { "value": "christmas", "label": "C" } ] },
                    { "name": "sparkle", "type": "toggle", "label": "Sparkle" }
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        let given = serde_json::json!({ "sparkle": false });
        assert_eq!(
            values(&component, given.as_object().unwrap()),
            serde_json::json!({ "holiday": "thanksgiving" })
        );
    }

    /// Runs only where a `zubra` command is installed (or `OPENBLOG_ZUBRA` names one); CI installs it.
    #[test]
    fn a_zubra_source_renders_with_the_sections_values_and_leaves_the_browser_its_part() {
        let Some(command) = command() else {
            eprintln!("skipped: no zubra command");
            return;
        };
        let dir = std::env::temp_dir().join(format!("openblog-zb-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("house/components")).unwrap();
        std::fs::write(
            dir.join("house/components/hello-sign.zb"),
            "<script>\n  let clicks = null\n</script>\n<hello-sign name=\"friend\">\n  <p class=\"sign\">Hello, {name}!</p>\n  <p class=\"live\">{clicks}</p>\n</hello-sign>\n",
        )
        .unwrap();
        let component = Component::check(
            "hello-sign",
            &serde_json::from_value(serde_json::json!({
                "label": "Hello sign", "script": "components/hello-sign.js",
                "source": "components/hello-sign.zb",
                "props": [ { "name": "name", "type": "text", "label": "Name" } ]
            }))
            .unwrap(),
        )
        .unwrap();
        let given = serde_json::json!({ "name": "<Grammi>" });
        let html = render_one(
            command,
            &dir,
            "house/components/hello-sign.zb",
            &component,
            given.as_object().unwrap(),
        )
        .unwrap();
        assert!(html.contains("Hello, &lt;Grammi&gt;!"), "{html}");
        assert!(!html.contains("<Grammi>"), "values are escaped");
        assert!(
            !html.contains("<hello-sign"),
            "only the content, the engine writes the element"
        );

        let missing = render_one(
            command,
            &dir,
            "house/components/nope.zb",
            &component,
            given.as_object().unwrap(),
        );
        assert!(missing.unwrap_err().contains("cannot read"));
        std::fs::remove_dir_all(&dir).ok();
    }
}

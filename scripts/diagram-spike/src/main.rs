use std::fs;
use std::path::PathBuf;
use std::time::Instant;

trait Renderer {
    fn render(&self, source: &str) -> Result<String, String>;
}

#[cfg(feature = "merman")]
struct Merman;
#[cfg(feature = "merman")]
impl Renderer for Merman {
    fn render(&self, source: &str) -> Result<String, String> {
        openblog_diagram_spike::render_merman(source)
    }
}

#[cfg(feature = "ferrigura")]
struct Ferrigura;
#[cfg(feature = "ferrigura")]
impl Renderer for Ferrigura {
    fn render(&self, source: &str) -> Result<String, String> {
        ferrigura::render(source, &ferrigura::Value::empty_object())
            .map_err(|error| error.to_string())
    }
}

#[cfg(feature = "mermaid")]
struct Mermaid;
#[cfg(feature = "mermaid")]
impl Renderer for Mermaid {
    fn render(&self, source: &str) -> Result<String, String> {
        mermaid_rs_renderer::render(source).map_err(|error| error.to_string())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut renderers: Vec<(&str, Box<dyn Renderer>)> = Vec::new();
    #[cfg(feature = "merman")]
    renderers.push(("merman", Box::new(Merman)));
    #[cfg(feature = "ferrigura")]
    renderers.push(("ferrigura", Box::new(Ferrigura)));
    #[cfg(feature = "mermaid")]
    renderers.push(("mermaid-rs-renderer", Box::new(Mermaid)));
    if renderers.is_empty() {
        return Err("select at least one renderer feature".into());
    }
    let argument = std::env::args().nth(1);
    let mut corpus =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/diagrams");
    if argument.as_deref() == Some("--hostile") {
        corpus.push("hostile");
    }
    let mut paths = fs::read_dir(corpus)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    paths.retain(|path| path.extension().is_some_and(|ext| ext == "mmd"));
    paths.sort();
    let mut fixtures = paths
        .iter()
        .map(|path| {
            Ok((
                path.file_name().unwrap().to_string_lossy().into_owned(),
                fs::read_to_string(path)?,
            ))
        })
        .collect::<Result<Vec<_>, std::io::Error>>()?;
    if let Some(size) = argument.filter(|value| value != "--hostile") {
        let count: usize = size.parse()?;
        if count == 0 || count > 10_000 {
            return Err("large fixture node count must be between 1 and 10000".into());
        }
        let mut source = String::from("flowchart LR\n");
        for node in 0..count {
            source.push_str(&format!("  N{node}[Node {node}]\n"));
        }
        fixtures = vec![(format!("large-{count}"), source)];
    }
    for (name, renderer) in renderers {
        for (fixture, source) in &fixtures {
            let start = Instant::now();
            let first =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| renderer.render(source)));
            let elapsed = start.elapsed().as_millis();
            match first {
                Ok(Ok(svg)) => {
                    if let Some(directory) = std::env::var_os("DIAGRAM_SPIKE_OUTPUT") {
                        let directory = PathBuf::from(directory);
                        fs::create_dir_all(&directory)?;
                        fs::write(directory.join(format!("{name}-{fixture}.svg")), &svg)?;
                    }
                    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        renderer.render(source)
                    }));
                    let has = |key| {
                        source
                            .lines()
                            .find_map(|line| line.trim().strip_prefix(key))
                            .is_some_and(|text| svg.contains(text.trim()))
                    };
                    println!(
                        "{name}\t{fixture}\tok\t{}\t{}\t{}\t{}\t{}",
                        svg.len(),
                        again
                            .as_ref()
                            .is_ok_and(|second| second.as_ref().is_ok_and(|second| second == &svg)),
                        has("accTitle:"),
                        has("accDescr:"),
                        elapsed
                    );
                }
                Ok(Err(error)) => println!("{name}\t{fixture}\terror\t{error}"),
                Err(_) => println!("{name}\t{fixture}\tpanic"),
            }
        }
    }
    Ok(())
}

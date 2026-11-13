use std::io::Read;

fn main() {
    let mut source = String::new();
    std::io::stdin()
        .read_to_string(&mut source)
        .expect("read diagram source");
    let info = std::env::args().nth(1).unwrap_or_else(|| "mermaid".into());
    println!("{}", openblog_wasm::render_diagram(&info, &source, 1));
}

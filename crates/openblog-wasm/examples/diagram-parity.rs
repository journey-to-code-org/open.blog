use std::io::Read;

fn main() {
    let mut source = String::new();
    std::io::stdin()
        .read_to_string(&mut source)
        .expect("read diagram source");
    println!("{}", openblog_wasm::render_diagram("mermaid", &source, 1));
}

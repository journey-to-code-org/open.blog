const fs = require("node:fs");
const path = require("node:path");

const [bindingDirectory, nativeDirectory, mode] = process.argv.slice(2);
if (!bindingDirectory || !nativeDirectory) {
  throw new Error("Provide the wasm-bindgen output directory and native SVG output directory.");
}
const wasm = require(path.resolve(bindingDirectory, "openblog_diagram_spike.js"));
const render = mode === "--static"
  ? (source) => wasm.render_merman_static_wasm(source, "diagram-parity")
  : (source) => wasm.render_merman_wasm(source);
const nativePrefix = mode === "--static" ? "merman-static" : "merman";
const corpus = path.resolve(__dirname, "../../tests/fixtures/diagrams");
for (const fixture of fs.readdirSync(corpus).filter((name) => name.endsWith(".mmd")).sort()) {
  const source = fs.readFileSync(path.join(corpus, fixture), "utf8");
  if (fixture === "malformed.mmd") {
    let message;
    try {
      render(source);
    } catch (error) {
      message = String(error);
    }
    if (!message?.includes("Unterminated node label")) {
      throw new Error(`${fixture}: unexpected WASM result: ${message}`);
    }
    console.log(`${fixture}: rejected`);
    continue;
  }
  const native = fs.readFileSync(path.join(nativeDirectory, `${nativePrefix}-${fixture}.svg`), "utf8");
  const actual = render(source);
  if (actual !== native) throw new Error(`${fixture}: native and WASM SVG differ`);
  console.log(`${fixture}: identical`);
}

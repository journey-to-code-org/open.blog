const fs = require("node:fs");
const path = require("node:path");

const [bindingDirectory, nativeDirectory] = process.argv.slice(2);
if (!bindingDirectory || !nativeDirectory) {
  throw new Error("Provide the wasm-bindgen output directory and native SVG output directory.");
}
const wasm = require(path.resolve(bindingDirectory, "openblog_diagram_spike.js"));
const corpus = path.resolve(__dirname, "../../tests/fixtures/diagrams");
for (const fixture of fs.readdirSync(corpus).filter((name) => name.endsWith(".mmd")).sort()) {
  const source = fs.readFileSync(path.join(corpus, fixture), "utf8");
  if (fixture === "malformed.mmd") {
    let message;
    try {
      wasm.render_merman_wasm(source);
    } catch (error) {
      message = String(error);
    }
    if (!message?.includes("Unterminated node label")) {
      throw new Error(`${fixture}: unexpected WASM result: ${message}`);
    }
    console.log(`${fixture}: rejected`);
    continue;
  }
  const native = fs.readFileSync(path.join(nativeDirectory, `merman-${fixture}.svg`), "utf8");
  const actual = wasm.render_merman_wasm(source);
  if (actual !== native) throw new Error(`${fixture}: native and WASM SVG differ`);
  console.log(`${fixture}: identical`);
}

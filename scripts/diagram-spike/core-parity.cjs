const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [bindingDirectory, nativeProgram] = process.argv.slice(2);
if (!bindingDirectory || !nativeProgram) {
  throw new Error("Provide the wasm-bindgen output directory and native parity program.");
}
const wasm = require(path.resolve(bindingDirectory, "openblog_wasm.js"));
const corpus = path.resolve(__dirname, "../../tests/fixtures/diagrams");
for (const fixture of fs.readdirSync(corpus).filter((name) => name.endsWith(".mmd")).sort()) {
  const source = fs.readFileSync(path.join(corpus, fixture), "utf8");
  const info = fixture === "c4.mmd" ? 'mermaid title="System context"' : "mermaid";
  const native = spawnSync(path.resolve(nativeProgram), [info], { input: source, encoding: "utf8" });
  if (native.status !== 0) throw new Error(`${fixture}: native error: ${native.stderr}`);
  const expected = JSON.parse(native.stdout);
  const actual = JSON.parse(wasm.renderDiagram(info, source, 1));
  if (fixture === "malformed.mmd") {
    if (!expected.error || !actual.error) throw new Error(`${fixture}: expected both to reject`);
  } else if (expected.svg !== actual.svg || !actual.svg) {
    throw new Error(`${fixture}: native and WASM SVG differ`);
  }
  console.log(`${fixture}: ${actual.error ? "rejected" : "identical"}`);
}

for (const source of [
  "flowchart LR\naccDescr {\naccTitle: Misleading title\nDescription only\n}\nA --> B\n",
  'flowchart LR\naccDescr: A description\nA["Label\naccTitle: Misleading title\nend"] --> B\n',
]) {
  const native = spawnSync(path.resolve(nativeProgram), { input: source, encoding: "utf8" });
  if (native.status !== 0) throw new Error(`native error: ${native.stderr}`);
  const expected = JSON.parse(native.stdout);
  const actual = JSON.parse(wasm.renderDiagram("mermaid", source, 1));
  if (!expected.error || expected.error !== actual.error) {
    throw new Error("misleading accessibility text was not rejected consistently");
  }
}
console.log("misleading accessibility text: rejected consistently");

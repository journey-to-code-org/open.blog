const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../../tests/browser/node_modules/playwright");

async function main() {
  const [nativeDirectory, outputDirectory] = process.argv.slice(2);
  if (!nativeDirectory || !outputDirectory) {
    throw new Error("Provide the native SVG and reference output directories.");
  }
  fs.mkdirSync(outputDirectory, { recursive: true });
  const corpus = path.resolve(__dirname, "../../tests/fixtures/diagrams");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
    for (const fixture of fs.readdirSync(corpus).filter((name) => name.endsWith(".mmd") && name !== "malformed.mmd").sort()) {
      await page.setContent("<!doctype html><html><body></body></html>");
      await page.addScriptTag({ path: path.join(__dirname, "node_modules/mermaid/dist/mermaid.min.js") });
      const source = fs.readFileSync(path.join(corpus, fixture), "utf8");
      const reference = await page.evaluate(async (text) => {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict", flowchart: { htmlLabels: false } });
        return (await window.mermaid.render("reference", text)).svg;
      }, source);
      fs.writeFileSync(path.join(outputDirectory, `mermaid-${fixture}.svg`), reference);
      const candidates = ["merman", "ferrigura", "mermaid-rs-renderer"].map((name) => ({
        name,
        svg: fs.readFileSync(path.join(nativeDirectory, `${name}-${fixture}.svg`), "utf8"),
      }));
      const panels = [{ name: "Official Mermaid", svg: reference }, ...candidates]
        .map(({ name, svg }) => {
          const document = `<!doctype html><style>body{margin:0}svg{max-width:100%;height:auto}</style>${svg}`;
          const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
          return `<section><h2>${name}</h2><iframe title="${name}" srcdoc="${escaped}"></iframe></section>`;
        })
        .join("");
      await page.setContent(`<!doctype html><style>body{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;font:16px sans-serif}section{border:1px solid #999;padding:8px}iframe{width:100%;height:800px;border:0}</style>${panels}`);
      await page.screenshot({ path: path.join(outputDirectory, `${fixture}.png`), fullPage: true });
      console.log(`${fixture}: reference SVG and comparison screenshot written`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("../../tests/browser/node_modules/playwright");

async function main() {
  const [bindingDirectory, nativeDirectory] = process.argv.slice(2);
  if (!bindingDirectory || !nativeDirectory) {
    throw new Error("Provide the web wasm-bindgen output directory and native SVG output directory.");
  }
  const names = new Map([
    ["/openblog_diagram_spike.js", "text/javascript"],
    ["/openblog_diagram_spike_bg.wasm", "application/wasm"],
  ]);
  const server = http.createServer((request, response) => {
    const type = names.get(request.url);
    if (!type) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": type });
    response.end(fs.readFileSync(path.join(bindingDirectory, request.url.slice(1))));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/openblog_diagram_spike.js`);
    const corpus = path.resolve(__dirname, "../../tests/fixtures/diagrams");
    for (const fixture of fs.readdirSync(corpus).filter((name) => name.endsWith(".mmd")).sort()) {
      const source = fs.readFileSync(path.join(corpus, fixture), "utf8");
      const result = await page.evaluate(async ({ origin, source }) => {
        const wasm = await import(`${origin}/openblog_diagram_spike.js`);
        await wasm.default();
        try {
          return { svg: wasm.render_merman_wasm(source) };
        } catch (error) {
          return { error: String(error) };
        }
      }, { origin, source });
      if (fixture === "malformed.mmd") {
        if (!result.error?.includes("Unterminated node label")) {
          throw new Error(`${fixture}: unexpected browser result: ${result.error}`);
        }
        console.log(`${fixture}: rejected`);
        continue;
      }
      const native = fs.readFileSync(path.join(nativeDirectory, `merman-${fixture}.svg`), "utf8");
      if (result.svg !== native) throw new Error(`${fixture}: native and browser SVG differ: ${result.error || "different bytes"}`);
      console.log(`${fixture}: identical`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

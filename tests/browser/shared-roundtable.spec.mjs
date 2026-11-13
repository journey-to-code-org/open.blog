import { test, expect } from "@playwright/test";
import axe from "axe-core";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
let root;
const servers = [];
const origins = new Map();

test.setTimeout(180000);

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(360000);
  root = mkdtempSync(join(tmpdir(), "openblog-roundtable-browser-"));
  execFileSync("cargo", [
    "test", "--locked", "-p", "openblog-cli", "--bin", "openblog", "generate_roundtable_browser_fixtures",
    "--", "--ignored",
  ], {
    cwd: repository,
    env: { ...process.env, OPENBLOG_ROUNDTABLE_FIXTURES: root },
    stdio: "pipe",
    timeout: 180000,
  });
  for (const count of [2, 3, 6]) {
    const base = resolve(root, String(count));
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      let path = resolve(base, `.${url.pathname}`);
      if (path !== base && !path.startsWith(`${base}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) path = join(path, "index.html");
      if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
      createReadStream(path).pipe(response);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    origins.set(count, `http://127.0.0.1:${server.address().port}`);
  }
});

test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((done, reject) => server.close((error) => error ? reject(error) : done()))));
  if (root) removeTree(root);
});

for (const count of [2, 3, 6]) {
  test(`${count} published perspectives are ordered and accessible at 400px`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    const path = readFileSync(join(root, String(count), "page-path.txt"), "utf8");
    const response = await page.goto(`${origins.get(count)}/${path}`);
    expect(response.status()).toBe(200);
    const reflection = page.locator(".ob-reflection-roundtable");
    await expect(reflection).toBeVisible();
    const names = Array.from({ length: count }, (_, n) => n === 0 ? "Mikey" : `Writer ${String(n).padStart(2, "0")}`);
    const order = [
      ...names.slice(Math.floor(count / 2)), ...names.slice(0, Math.floor(count / 2)),
      ...names.slice().reverse(),
    ];
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(reflection.locator("h2.ob-turn-author")).toHaveText(order);
    await expect(reflection.locator("section.ob-turn")).toHaveCount(count * 2);
    const sizes = await page.evaluate(() => ({
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      heading: parseFloat(getComputedStyle(document.querySelector(".ob-turn-author")).fontSize),
    }));
    expect(sizes.heading).toBeCloseTo(sizes.root * 1.1, 1);
    const positions = await reflection.locator("section.ob-turn").evaluateAll((sections) =>
      sections.map((section) => ({ left: section.getBoundingClientRect().left, top: section.getBoundingClientRect().top })),
    );
    expect(positions.every((position) => Math.abs(position.left - positions[0].left) <= 1)).toBe(true);
    expect(positions.every((position, index) => index === 0 || position.top > positions[index - 1].top)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const overflowing = await reflection.evaluate((region) => {
      const limit = document.documentElement.clientWidth;
      return [region, ...region.querySelectorAll("*")]
        .filter((node) => node.getBoundingClientRect().right > limit + 1)
        .map((node) => `${node.tagName}.${node.className}`);
    });
    expect(overflowing).toEqual([]);
    await page.evaluate(axe.source);
    const result = await page.evaluate(async () => window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    }));
    expect(result.violations).toEqual([]);
  });
}

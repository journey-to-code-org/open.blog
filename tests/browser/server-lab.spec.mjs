import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test.use({ channel: "chrome" });

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const asset = (path) => readFileSync(join(repository, path), "utf8");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/assets/base.css"></head><body><main class="ob-container">
<h1>Server lab</h1><ob-server-lab data-lesson="connections"><p>The fallback remains useful without JavaScript.</p></ob-server-lab>
</main><script type="module" src="/assets/components/ob-server-lab.js"></script></body></html>`;

let server;
let origin;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const files = {
      "/assets/base.css": ["text/css", asset("web/base.css")],
      "/assets/components/ob-lab.js": ["text/javascript", asset("web/components/ob-lab.js")],
      "/assets/components/ob-server-lab.js": ["text/javascript", asset("web/components/ob-server-lab.js")],
      "/assets/components/ob-server-model.js": ["text/javascript", asset("web/components/ob-server-model.js")],
    };
    if (path === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(html);
      return;
    }
    if (path === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const file = files[path];
    if (file) {
      response.writeHead(200, { "content-type": file[0] });
      response.end(file[1]);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("the lab exercises connection and select scheduling models", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin);

  await expect(page.getByRole("region", { name: "Server" }).getByText("One connection loop", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect Alice" }).click();
  await page.getByRole("button", { name: "Connect Bob" }).click();
  await expect(page.locator(".ob-server-clients li", { hasText: "Bob" })).toContainText("waiting");
  await page.getByRole("button", { name: "Bob: look" }).click();
  await expect(page.getByRole("status")).toContainText("bytes wait");

  await page.getByLabel("Lesson view").selectOption("select");
  await page.getByRole("button", { name: "World message arrives" }).click();
  await page.getByRole("button", { name: "Player input arrives" }).click();
  await page.getByRole("button", { name: "Run select!" }).click();
  await expect(page.getByRole("status")).toContainText("world message branch");
  await expect(page.getByRole("list", { name: "Waiting work" })).toContainText("player input");
  expect(errors).toEqual([]);
});

test("the lab fits a narrow viewport and keeps its fallback without JavaScript", async ({ page, browser }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(origin);
  await expect(page.locator("ob-server-lab")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const context = await browser.newContext({ javaScriptEnabled: false });
  const noScript = await context.newPage();
  await noScript.goto(origin);
  await expect(noScript.getByText("The fallback remains useful without JavaScript.")).toBeVisible();
  await context.close();
});

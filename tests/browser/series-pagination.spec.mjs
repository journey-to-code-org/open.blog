import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test.use({ channel: "chrome" });

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const asset = (path) => readFileSync(join(repository, path), "utf8");
const cards = Array.from(
  { length: 8 },
  (_, index) =>
    `<li class="ob-card"><a class="ob-card-link" href="/series/${index + 1}/"><span class="ob-card-body"><h3 class="ob-card-title">Series ${index + 1}</h3></span></a></li>`,
).join("\n");
const posts = Array.from(
  { length: 8 },
  (_, index) =>
    `<li class="ob-card"><a class="ob-card-link" href="/post-${index + 1}/"><span class="ob-card-body"><h3 class="ob-card-title">Post ${index + 1}</h3></span></a></li>`,
).join("\n");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/assets/base.css"></head><body><main class="ob-container">
<h1>Series</h1><ob-list-pagination page-size="6" page-param="series-page" item-label="series">
<ul class="ob-list ob-list-cards ob-series-list">${cards}</ul>
</ob-list-pagination></main><script type="module" src="/assets/components/ob-list-pagination.js"></script></body></html>`;
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/assets/base.css"></head><body><main class="ob-container">
<section><h1>Latest</h1><ob-list-pagination page-size="6" page-param="latest-page" item-label="posts">
<ul class="ob-list ob-list-cards latest-list">${posts}</ul></ob-list-pagination></section>
<section><h2>Series</h2><ob-list-pagination page-size="6" page-param="series-page" item-label="series">
<ul class="ob-list ob-list-cards ob-series-list">${cards}</ul></ob-list-pagination></section>
</main><script type="module" src="/assets/components/ob-list-pagination.js"></script></body></html>`;

let server;
let origin;
let documentRequests = 0;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const files = {
      "/assets/base.css": ["text/css", asset("web/base.css")],
      "/assets/components/ob-list-pagination.js": ["text/javascript", asset("web/components/ob-list-pagination.js")],
      "/assets/components/list-pagination.js": ["text/javascript", asset("web/components/list-pagination.js")],
    };
    if (path === "/" || path === "/series/") {
      documentRequests += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end(path === "/" ? landing : html);
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

test("series pages change the URL and visible cards without loading another document", async ({ page }) => {
  documentRequests = 0;
  await page.goto(`${origin}/series/`);
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await expect(page.locator(".ob-card:visible")).toHaveCount(6);
  expect(documentRequests).toBe(1);

  await page.getByRole("link", { name: "Older series" }).click();
  await expect(page).toHaveURL(`${origin}/series/?series-page=2`);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(page.locator(".ob-card:visible")).toHaveCount(2);
  await expect(page.locator(":focus")).toHaveText("Series 7");
  expect(documentRequests).toBe(1);

  await page.goBack();
  await expect(page).toHaveURL(`${origin}/series/`);
  await expect(page.locator(".ob-card:visible")).toHaveCount(6);
  expect(documentRequests).toBe(1);
});

test("a shared page URL opens the requested series page and invalid values normalize", async ({ page }) => {
  await page.goto(`${origin}/series/?series-page=2`);
  await expect(page.locator(".ob-card:visible")).toHaveCount(2);
  await expect(page.getByText("Page 2 of 2")).toBeVisible();

  await page.goto(`${origin}/series/?series-page=nope`);
  await expect(page).toHaveURL(`${origin}/series/`);
  await expect(page.locator(".ob-card:visible")).toHaveCount(6);
});

test("latest posts and series paginate independently on the landing page", async ({ page }) => {
  documentRequests = 0;
  await page.goto(`${origin}/`);
  await expect(page.locator(".latest-list > li:visible")).toHaveCount(6);
  await expect(page.locator(".ob-series-list > li:visible")).toHaveCount(6);

  await page.getByRole("navigation", { name: "Posts pages" }).getByRole("link", { name: "Older posts" }).click();
  await expect(page).toHaveURL(`${origin}/?latest-page=2`);
  await expect(page.locator(".latest-list > li:visible")).toHaveCount(2);
  await expect(page.locator(".ob-series-list > li:visible")).toHaveCount(6);

  await page.getByRole("navigation", { name: "Series pages" }).getByRole("link", { name: "Older series" }).click();
  await expect(page).toHaveURL(`${origin}/?latest-page=2&series-page=2`);
  await expect(page.locator(".latest-list > li:visible")).toHaveCount(2);
  await expect(page.locator(".ob-series-list > li:visible")).toHaveCount(2);
  expect(documentRequests).toBe(1);
});

test("without JavaScript every series remains available", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${origin}/series/`);
  await expect(page.locator(".ob-card:visible")).toHaveCount(8);
  await expect(page.getByRole("navigation", { name: "Series pages" })).toHaveCount(0);
  await context.close();
});

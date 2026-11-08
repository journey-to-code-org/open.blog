import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTree } from "./teardown.mjs";

// The approved Webmentions a canonical post lists (story #402, ADR 0366), as a reader sees them
// in a browser: a labelled region with a level-two heading and a numbered list of plain links,
// the notice that only each site's address was checked, a hostile title shown as text, no image
// or script from the other site, the same page with JavaScript off, keyboard focus on every
// link, and a phone width without sideways scrolling. A post that opted out lists nothing.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const HOSTILE = '<img src=x onerror="window.__hit=1"> Brioche, & more';
let root;
let site;

const post = (title, extra = "") => `---
title: ${title}
date: 2026-10-01
${extra}---

A loaf that rises overnight.
`;

test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "openblog-mentions-"));
  site = join(root, "site");
  mkdirSync(join(site, "content", "posts"), { recursive: true });
  writeFileSync(
    join(site, "openblog.json"),
    JSON.stringify({
      title: "Bread at home",
      url: "https://bread.example.org",
      webmention: { receive: { enabled: true, endpoint: "https://bread.example.org/api/webmention" } },
    }),
  );
  writeFileSync(join(site, "content", "posts", "overnight-loaf.md"), post("Overnight loaf"));
  writeFileSync(join(site, "content", "posts", "quiet-loaf.md"), post("Quiet loaf", "webmentions: false\n"));
  const mention = (id, postPath, fields) => ({ id, post: postPath, approved: "2026-10-29", ...fields });
  writeFileSync(
    join(site, "content", "webmentions.json"),
    JSON.stringify({
      version: 1,
      mentions: [
        mention("m-0000000000000001", "posts/overnight-loaf.md", {
          source: "https://crumb.example/notes/loaf?ref=1&x=2",
          title: HOSTILE,
          author: "Ana",
          published: "2026-10-20",
        }),
        mention("m-0000000000000002", "posts/overnight-loaf.md", { source: "https://oven.example/p/7" }),
        mention("m-0000000000000003", "posts/quiet-loaf.md", { source: "https://crumb.example/quiet" }),
      ],
    }),
  );
  execFileSync(binary, ["build", "--root", site], { stdio: "pipe" });
});

test.afterAll(() => removeTree(root));

const page_of = (slug) => pathToFileURL(join(site, "dist", "posts", slug, "index.html")).href;

test("the mentions section is a labelled list of plain links that reads and tabs well", async ({ page }) => {
  await page.goto(page_of("overnight-loaf"));
  const region = page.getByRole("region", { name: "Mentions" });
  await expect(region).toHaveCount(1);
  await expect(region.getByRole("heading", { level: 2, name: "Mentions" })).toBeVisible();
  await expect(region).toContainText("only the site's address was checked");

  const items = region.getByRole("list").getByRole("listitem");
  await expect(items).toHaveCount(2);
  // A title is the other site's own words, shown as text and never as markup.
  const first = region.getByRole("link", { name: HOSTILE });
  await expect(first).toHaveAttribute("href", "https://crumb.example/notes/loaf?ref=1&x=2");
  await expect(first).toHaveAttribute("rel", /\bnofollow\b/);
  await expect(first).toHaveAttribute("rel", /\bugc\b/);
  await expect(first).toHaveAttribute("rel", /\bnoreferrer\b/);
  await expect(items.first()).toContainText("on crumb.example");
  await expect(items.first()).toContainText("by Ana, as the page says");
  await expect(items.first().locator("time")).toHaveAttribute("datetime", "2026-10-20");
  // A mention with no title is named by its host, so the link still has a name.
  await expect(region.getByRole("link", { name: "oven.example" })).toHaveAttribute("href", "https://oven.example/p/7");
  await expect(region.locator("img, script, iframe, object, embed, svg")).toHaveCount(0);
  expect(await page.evaluate(() => window.__hit)).toBeUndefined();

  // Every mention link is reached from the keyboard and shows where focus is.
  const reached = [];
  for (let i = 0; i < 60 && reached.length < 2; i += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el?.closest("#ob-mentions")) return null;
      const style = getComputedStyle(el);
      return { href: el.getAttribute("href"), outline: style.outlineStyle, shadow: style.boxShadow };
    });
    if (focused) reached.push(focused);
  }
  expect(reached.map((item) => item.href)).toEqual(["https://crumb.example/notes/loaf?ref=1&x=2", "https://oven.example/p/7"]);
  for (const item of reached) expect(item.outline !== "none" || item.shadow !== "none").toBe(true);
});

test("the section is the same without JavaScript and fits a phone", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 700 } });
  const page = await context.newPage();
  await page.goto(page_of("overnight-loaf"));
  const region = page.getByRole("region", { name: "Mentions" });
  await expect(region.getByRole("listitem")).toHaveCount(2);
  await expect(region.getByRole("link", { name: HOSTILE })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const section = document.getElementById("ob-mentions");
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      section: section.scrollWidth - section.clientWidth,
    };
  });
  expect(overflow.page).toBeLessThanOrEqual(1);
  expect(overflow.section).toBeLessThanOrEqual(1);
  await context.close();
});

test("a post that opted out lists no mention and advertises no endpoint", async ({ page }) => {
  await page.goto(page_of("quiet-loaf"));
  await expect(page.getByRole("region", { name: "Mentions" })).toHaveCount(0);
  await expect(page.locator('link[rel="webmention"]')).toHaveCount(0);
  const listed = readFileSync(join(site, "dist", "posts", "overnight-loaf", "index.html"), "utf8");
  expect(listed).toContain('<link rel="webmention" href="https://bread.example.org/api/webmention">');
});

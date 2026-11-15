import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";
import { starterSections } from "../../web/studio/parts/landing-rules.js";

// A recipe home page and a recipe listing at phone width (#557): the owner sets a course and a cuisine
// in plain words in Admin, and a reader with no JavaScript browses the recipes by them.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const viewport = { width: 375, height: 800 };
let parent;
let root;
const servers = [];
let origin;

test.use({ viewport });

const recipe = (title, date, fields) =>
  `---\ntitle: ${title}\ndate: ${date}\nprofile: recipe\n${fields}\n---\n## Ingredients\n\n- Water\n\n## Steps\n\n1. Boil.\n`;

/** A fresh site with an admin user; `fill` writes its content before the server starts. */
async function startSite(folder, fill) {
  const siteRoot = join(parent, folder);
  execFileSync(binary, ["init", siteRoot, "--no-voice"], { stdio: "pipe" });
  execFileSync(binary, ["user", "add", "writer", "--root", siteRoot], {
    env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe",
  });
  fill(join(siteRoot, "content", "posts"), join(siteRoot, "content", "pages"), siteRoot);
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const address = `http://127.0.0.1:${port}`;
  const process_ = spawn(binary, ["serve", "--admin", "--root", siteRoot, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  servers.push(process_);
  let output = "";
  process_.stdout.on("data", (data) => { output += data; });
  process_.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (process_.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${address}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
  return { root: siteRoot, origin: address };
}

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-recipe-listing-"));
  ({ root, origin } = await startSite("site", (posts) => {
    writeFileSync(join(posts, "tiramisu.md"), recipe("Tiramisu", "2026-10-03", "course: Dessert\ncuisine: Italian"));
    writeFileSync(join(posts, "collard-greens.md"), recipe("Collard greens", "2026-10-02", "course: Dinner\ncuisine: Southern"));
    writeFileSync(join(posts, "old-soup.md"), recipe("Old soup", "2026-10-01", "category: Soup"));
    writeFileSync(join(posts, "long-name.md"), recipe("Long name", "2026-09-30", `cuisine: ${"Longwinded".repeat(8)}`));
    writeFileSync(join(posts, "garden.md"), "---\ntitle: Garden notes\ndate: 2026-10-04\n---\nWords.\n");
    writeFileSync(join(posts, "news.md"), "---\ntitle: News\ndate: 2026-09-01\ncategory: Politics\ndescription: The news.\n---\nWords.\n");
    writeFileSync(join(posts, "old-chowder.md"), recipe("Old chowder", "2026-08-30", "category: Chowder"));
    // The front page uses the Recipes layout, as Front page's ready-made layout writes it (R15: set up
    // from the file, not through the old Admin's builder).
    writeFileSync(join(posts, "..", "landing.json"), JSON.stringify({ format: "openblog-landing", version: 1, sections: starterSections("recipes") }));
  }));
});

test.afterAll(async () => {
  for (const server of servers) {
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
  }
  removeTree(parent);
});

const view = (page, name) => page.getByRole("button", { name, exact: true });
const save = (page) => page.getByRole("button", { name: "Save", exact: true }).click();
const postFile = (slug) => {
  const posts = join(root, "content", "posts");
  const name = readdirSync(posts).find((file) => file.includes(slug));
  return readFileSync(join(posts, name), "utf8");
};
const landingFile = () => join(root, "content", "landing.json");
const stored = () => JSON.parse(readFileSync(landingFile(), "utf8"));

test("a reader with no JavaScript browses the recipes by course", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  const page = await context.newPage();
  await page.goto(`${origin}/`);
  const home = page.locator("#ob-home-latest");
  await expect(home.getByRole("link", { name: "All recipes", exact: true })).toBeVisible();
  await expect(home).toContainText("Tiramisu");
  await expect(home).not.toContainText("Garden notes");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Recipes" }).click();
  await expect(page).toHaveURL(`${origin}/recipes/`);
  await expect(page.locator("body")).not.toContainText("Garden notes");

  const filters = page.getByRole("navigation", { name: "Browse recipes" });
  await filters.locator("summary").filter({ hasText: "By course" }).click();
  await filters.getByRole("link", { name: /^Dessert/ }).click();
  await expect(page).toHaveURL(`${origin}/recipes/course/dessert/`);
  const current = page.getByRole("navigation", { name: "Browse recipes" }).locator('[aria-current="page"]');
  await expect(current).toContainText("Dessert");
  await expect(current.locator("strong")).toHaveText("Dessert");
  await expect(page.locator(".ob-recipe-filter-current")).toBeVisible();
  await expect(page.locator(".ob-recipe-filter-current")).toHaveText("Dessert");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Dessert recipes");
  await expect(page.getByRole("link", { name: /Tiramisu/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Collard greens/ })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Browse recipes" }).getByRole("link", { name: "All recipes" }).click();
  await expect(page).toHaveURL(`${origin}/recipes/`);
  await expect(page.getByRole("link", { name: /Collard greens/ })).toBeVisible();
  await context.close();
});

test("the listing fits a phone and its chips are big enough to tap", async ({ page }) => {
  for (const address of ["/recipes/", "/recipes/course/dessert/"]) {
    await page.goto(`${origin}${address}`);
    const sizes = await page.evaluate(() => ({
      opened: document.querySelectorAll(".ob-recipe-filters details").forEach((group) => { group.open = true; }),
      page: document.documentElement.scrollWidth,
      screen: window.innerWidth,
      chip: Math.min(...[...document.querySelectorAll(".ob-recipe-filters a")].map((chip) => chip.getBoundingClientRect().height)),
    }));
    expect(sizes.page, address).toBeLessThanOrEqual(sizes.screen);
    expect(sizes.chip, address).toBeGreaterThanOrEqual(44);
  }
  // On the page still open: the count stands apart from its label, and the list from the filters.
  const gaps = await page.evaluate(() => {
    const nav = document.querySelector(".ob-recipe-filters");
    const current = nav.querySelector('[aria-current="page"]');
    return {
      count: current.querySelector(".ob-count").getBoundingClientRect().left - current.querySelector("strong").getBoundingClientRect().right,
      list: nav.nextElementSibling.getBoundingClientRect().top - nav.getBoundingClientRect().bottom,
    };
  });
  expect(gaps.count).toBeGreaterThanOrEqual(4);
  expect(gaps.list).toBeGreaterThanOrEqual(16);
});

test("on a phone a long site name wraps beside the theme button, and the links keep their own row", async ({ page }) => {
  const site = await startSite("long-name", (_posts, _pages, siteRoot) => {
    const file = join(siteRoot, "openblog.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...config, title: "Grandmother's Very Own Collection of Family Kitchen Recipes" }, null, 2));
  });
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto(`${site.origin}/`);
    const toggle = page.locator("ob-theme-toggle button");
    await expect(toggle).toBeVisible();
    const brand = await page.locator(".ob-brand").boundingBox();
    const button = await toggle.boundingBox();
    const nav = await page.locator(".ob-nav").boundingBox();
    const label = `at ${width}px`;
    expect(button.x, label).toBeGreaterThanOrEqual(brand.x + brand.width);
    expect(button.y, label).toBeLessThan(brand.y + brand.height);
    expect(nav.y, label).toBeGreaterThanOrEqual(brand.y + brand.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBeLessThanOrEqual(0);
  }
});

test("on a small phone a reader with no JavaScript meets a recipe on the first screen, however many filters there are", async ({ browser }) => {
  const names = {
    courses: ["Breakfast", "Brunch", "Lunch", "Dinner", "Appetizer", "Side dish", "Soup", "Salad", "Main course", "Dessert", "Snack", "Drink", "Bread", "Holiday", "Sauce"],
    cuisines: ["American", "Southern", "Mexican", "Italian", "French", "Greek", "Mediterranean", "Middle Eastern", "Indian", "Chinese", "Japanese", "Thai", "Cajun", "Polish"],
  };
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  // A few of each, six of each, and more than anyone would fit on a screen.
  for (const [courseCount, cuisineCount] of [[3, 3], [6, 6], [15, 14]]) {
    const courses = [...names.courses.slice(-courseCount)];
    const cuisines = names.cuisines.slice(0, cuisineCount);
    const site = await startSite(`filters-${courseCount}`, (posts) => {
      courses.forEach((course, index) => {
        const day = String(index + 1).padStart(2, "0");
        writeFileSync(join(posts, `dish-${index}.md`), recipe(`Dish ${index}`, `2026-10-${day}`, `course: ${course}\ncuisine: ${cuisines[index % cuisines.length]}`));
      });
    });
    const slug = courses.at(-1).toLowerCase();
    for (const address of ["/recipes/", `/recipes/course/${slug}/`]) {
      await page.goto(`${site.origin}${address}`);
      const label = `${courseCount} and ${cuisineCount} at ${address}`;
      const first = (await page.locator("main h3").first().boundingBox());
      expect(first.y + first.height, label).toBeLessThanOrEqual(640);
      const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
      expect(widths.page, label).toBeLessThanOrEqual(widths.screen);
    }
    // The filter page says which filter it is without opening anything.
    await expect(page.locator(".ob-recipe-filter-current")).toHaveText(courses.at(-1));
    await expect(page.locator(".ob-recipe-filter-current")).toBeInViewport();
  }
  await context.close();
});

test("on a small phone a reader with JavaScript meets a recipe on the first screen, and the Recipes link costs no row of its own", async ({ page }) => {
  const without = await startSite("header-without", () => {});
  const site = await startSite("header-with", (posts) => {
    writeFileSync(join(posts, "tiramisu.md"), recipe("Tiramisu", "2026-10-03", "course: Dessert\ncuisine: Italian"));
  });
  const settledHeader = async (at, address) => {
    await page.goto(`${at}${address}`);
    await expect(page.locator("ob-theme-toggle")).toBeVisible();
    return (await page.locator(".ob-header").boundingBox()).height;
  };
  for (const width of [320, 330, 340, 360, 375]) {
    await page.setViewportSize({ width, height: 568 });
    const label = `${width} wide`;
    const before = await settledHeader(without.origin, "/archive/");
    const after = await settledHeader(site.origin, "/archive/");
    expect(after, label).toBeLessThanOrEqual(568 / 3);
    expect(after - before, label).toBeLessThanOrEqual(0);

    await settledHeader(site.origin, "/recipes/");
    const first = await page.locator("main h3").first().boundingBox();
    expect(first.y + first.height, label).toBeLessThanOrEqual(568);
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
    expect(widths.page, label).toBeLessThanOrEqual(widths.screen);
  }
});

test("the filter groups open without JavaScript, and name themselves without their triangle", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await page.goto(`${origin}/recipes/`);
  const filters = page.getByRole("navigation", { name: "Browse recipes" });
  const dessert = filters.getByRole("link", { name: /^Dessert/ });
  await expect(dessert).toBeHidden();
  const group = filters.locator("summary").filter({ hasText: "By course" });
  expect((await group.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await filters.ariaSnapshot()).not.toMatch(/[\u25B8\u25BE]/);
  await group.click();
  expect(await filters.ariaSnapshot()).not.toMatch(/[\u25B8\u25BE]/);
  await dessert.click();
  await expect(page).toHaveURL(`${origin}/recipes/course/dessert/`);
  await context.close();
});

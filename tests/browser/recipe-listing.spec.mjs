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
    expect((await fetch(`${address}/admin/`)).ok).toBe(true);
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

async function signIn(page, at = origin) {
  await page.goto(`${at}/admin/`);
  await page.getByLabel("Username", { exact: true }).fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-action="logout"]')).toBeVisible();
}

const view = (page, name) => page.getByRole("button", { name, exact: true });
const save = (page) => page.getByRole("button", { name: "Save", exact: true }).click();
const postFile = (slug) => {
  const posts = join(root, "content", "posts");
  const name = readdirSync(posts).find((file) => file.includes(slug));
  return readFileSync(join(posts, name), "utf8");
};
const landingFile = () => join(root, "content", "landing.json");
const stored = () => JSON.parse(readFileSync(landingFile(), "utf8"));

test("the owner sets a course in plain words and the recipe is listed under it", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("link", { name: /New recipe/ })).toBeVisible();
  await page.getByRole("link", { name: /New recipe/ }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Lemon cake");
  await view(page, "Settings").click();

  const course = page.getByLabel("Course", { exact: true });
  await expect(course).toBeVisible();
  await expect(page.getByLabel("Cuisine", { exact: true })).toBeVisible();
  await expect(page.getByText("Readers can browse your recipes by this.").first()).toBeVisible();
  await expect(page.locator('#oba-profile-course-list option[value="Dessert"]')).toBeAttached();
  await expect(page.locator('#oba-profile-cuisine-list option[value="Southern"]')).toBeAttached();
  await expect(course).toHaveAttribute("autocapitalize", "words");

  await course.fill("Dessert");
  await page.getByRole("radio", { name: "Published", exact: true }).check();
  await save(page);
  await expect(() => {
    expect(postFile("lemon-cake")).toMatch(/^course: Dessert$/m);
  }).toPass();
  await expect(async () => {
    const listed = await (await fetch(`${origin}/recipes/course/dessert/`)).text();
    expect(listed).toContain("Lemon cake");
  }).toPass();
});

test("a recipe with no course says what it is missing, and publishing it leads to the field", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /New recipe/ }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Teatime scones");

  await view(page, "Site preview").click();
  const advice = page.locator("[data-recipe-advice]");
  await expect(advice).toContainText("so readers can browse your recipes");

  await view(page, "Settings").click();
  await expect(page.getByLabel("Course", { exact: true })).toHaveAccessibleDescription(/Use a comma for more than one/);
  await page.getByRole("radio", { name: "Published", exact: true }).check();
  await save(page);
  const nudge = page.locator("[data-recipe-filter-nudge]");
  await expect(nudge).toContainText("so readers can browse your recipes");
  await nudge.getByRole("button", { name: "Add a course" }).click();
  const course = page.getByLabel("Course", { exact: true });
  await expect(course).toBeFocused();
  await expect(course).toBeInViewport();

  await course.fill("Teatime");
  await save(page);
  await expect(() => {
    expect(postFile("teatime-scones")).toMatch(/^course: Teatime$/m);
  }).toPass();
  await expect(nudge).toHaveCount(0);

  // The value she just used is offered on the next recipe, without reloading.
  await page.evaluate(() => { location.hash = "#/new/recipe"; });
  await view(page, "Settings").click();
  await expect(page.locator('#oba-profile-course-list option[value="Teatime"]')).toBeAttached();
});

test("trying Recipe on an article and going back leaves its category alone", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/edit/posts%2Fnews.md`);
  await view(page, "Settings").click();
  await page.locator("#oba-profile").selectOption("recipe");
  await expect(page.getByLabel("Course", { exact: true })).toHaveValue("Politics");
  await page.locator("#oba-profile").selectOption("article");
  await expect(page.getByLabel("Course", { exact: true })).toHaveCount(0);
  await save(page);
  await expect(() => {
    expect(postFile("news")).toMatch(/^profile: article$/m);
  }).toPass();
  const saved = postFile("news");
  expect(saved).toMatch(/^category: Politics$/m);
  expect(saved).not.toMatch(/^course:/m);
});

test("a recipe moved to another profile does not keep a course it was only showing", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/edit/posts%2Fold-chowder.md`);
  await view(page, "Settings").click();
  await expect(page.getByLabel("Course", { exact: true })).toHaveValue("Chowder");
  await page.locator("#oba-profile").selectOption("article");
  await save(page);
  await expect(() => {
    expect(postFile("old-chowder")).toMatch(/^profile: article$/m);
  }).toPass();
  expect(postFile("old-chowder")).not.toMatch(/^course:/m);
});

test("a course written as category shows in the field and is saved under the field's own name", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/edit/posts%2Fold-soup.md`);
  await view(page, "Settings").click();
  const course = page.getByLabel("Course", { exact: true });
  await expect(course).toHaveValue("Soup");
  // Saving is a press of the button; the value moves to the field's own name.
  await save(page);
  await expect(() => {
    const saved = postFile("old-soup");
    expect(saved).toMatch(/^course: Soup$/m);
    expect(saved).not.toMatch(/^category:/m);
  }).toPass();
});

test("a course saved from another name stays when the profile is changed afterwards", async ({ page }) => {
  const migrated = await startSite("migrated", (posts) => {
    writeFileSync(join(posts, "soup.md"), recipe("Soup", "2026-10-01", "category: Soup"));
    writeFileSync(join(posts, "stew.md"), recipe("Stew", "2026-10-02", "category: Stew"));
  });
  const file = (name) => readFileSync(join(migrated.root, "content", "posts", name), "utf8");
  await signIn(page, migrated.origin);

  await page.goto(`${migrated.origin}/admin/#/edit/posts%2Fsoup.md`);
  await view(page, "Settings").click();
  const course = page.getByLabel("Course", { exact: true });
  await expect(course).toHaveValue("Soup");
  await save(page);
  await expect(() => expect(file("soup.md")).toMatch(/^course: Soup$/m)).toPass();
  await page.locator("#oba-profile").selectOption("article");
  await page.locator("#oba-profile").selectOption("recipe");
  await expect(course).toHaveValue("Soup");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Soup again");
  await save(page);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  expect(file("soup.md")).toMatch(/^title: Soup again$/m);
  expect(file("soup.md")).toMatch(/^course: Soup$/m);

  await page.goto(`${migrated.origin}/admin/#/edit/posts%2Fstew.md`);
  await view(page, "Settings").click();
  await expect(course).toHaveValue("Stew");
  await save(page);
  await expect(() => expect(file("stew.md")).toMatch(/^course: Stew$/m)).toPass();
  await page.locator("#oba-profile").selectOption("article");
  await save(page);
  await expect(() => expect(file("stew.md")).toMatch(/^profile: article$/m)).toPass();
  expect(file("stew.md")).toMatch(/^course: Stew$/m);
});

test("with the recipe list turned off, Admin does not ask for a course so readers can browse", async ({ page }) => {
  const off = await startSite("listing-off", (_posts, _pages, siteRoot) => {
    const path = join(siteRoot, "openblog.json");
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), recipes: { listing: false } }));
  });
  await signIn(page, off.origin);
  await page.getByRole("link", { name: /New recipe/ }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Plain scones");
  await view(page, "Site preview").click();
  await expect(page.locator("[data-recipe-advice]")).not.toContainText("so readers can browse");
  await view(page, "Settings").click();
  await expect(page.getByLabel("Course", { exact: true })).toHaveAccessibleDescription(/What kind of dish it is/);
  await expect(page.getByText("Readers can browse your recipes by this.")).toHaveCount(0);
  await page.getByRole("radio", { name: "Published", exact: true }).check();
  await save(page);
  await expect(page.getByText("Saved and live.")).toBeVisible();
  await expect(page.locator("[data-recipe-filter-nudge]")).toHaveCount(0);
  expect((await fetch(`${off.origin}/recipes/`)).status).toBe(404);

  await page.goto(`${off.origin}/admin/#/landing`);
  await page.getByRole("button", { name: "Choose a ready-made layout" }).click();
  const card = page.locator("[data-landing-starters]").getByRole("button", { name: /^Recipes/ });
  await expect(card).toContainText("Your newest recipes up front.");
  await expect(card).not.toContainText("browse");
});

test("the Recipes layout asks for recipes, and an all-posts section is left as it was", async ({ page }) => {
  writeFileSync(landingFile(), JSON.stringify({ format: "openblog-landing", version: 1, sections: [{ id: "all", type: "latest-posts", heading: "Everything" }] }));
  await signIn(page);
  await page.goto(`${origin}/admin/#/landing`);
  await expect(page.getByRole("heading", { level: 2, name: "Sections" })).toBeVisible();

  const section = page.locator('[data-section="all"]');
  await section.getByRole("button", { name: /^Edit/ }).click();
  await section.getByRole("textbox", { name: /Heading/ }).fill("Everything new");
  await save(page);
  await expect(page.locator("[data-landing-status]")).toContainText("Saved");
  expect(stored().sections[0].heading).toBe("Everything new");
  expect(stored().sections[0]).not.toHaveProperty("show");

  await section.getByLabel(/What to show/).selectOption("recipes");
  await save(page);
  await expect(page.locator("[data-landing-status]")).toContainText("Saved");
  expect(stored().sections[0].show).toBe("recipes");
  await section.getByRole("button", { name: "Done" }).click();
  await expect(section).toContainText("(only recipes)");

  await page.getByRole("button", { name: "Choose a ready-made layout" }).click();
  await page.locator("[data-landing-starters]").getByRole("button", { name: "Recipes" }).click();
  await page.locator("[data-landing-confirm]").getByRole("button", { name: "Replace my sections" }).click();
  await save(page);
  await expect(page.locator("[data-landing-status]")).toContainText("Saved");
  const latest = stored().sections.find((candidate) => candidate.type === "latest-posts");
  expect(latest.show).toBe("recipes");
  expect(JSON.stringify(stored())).not.toContain("/recipes/");
});

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

test("with her own Recipes page in the header, a reader with no JavaScript still reaches the list and its filters", async ({ browser, page }) => {
  const own = await startSite("own-page", (posts, pages) => {
    writeFileSync(join(pages, "recipes.md"), "---\ntitle: Recipes\nnav: true\n---\nMy favourites.\n");
    writeFileSync(join(posts, "tiramisu.md"), recipe("Tiramisu", "2026-10-03", "course: Dessert\ncuisine: Italian"));
    writeFileSync(join(posts, "emoji.md"), recipe("Cake", "2026-10-02", "course: \u{1F370}"));
  });
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  const reader = await context.newPage();
  await reader.goto(`${own.origin}/`);
  const nav = reader.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Recipes", exact: true })).toHaveAttribute("href", "/recipes/");
  await nav.getByRole("link", { name: "All recipes", exact: true }).click();
  await expect(reader).toHaveURL(`${own.origin}/recipes/all/`);
  const browse = reader.getByRole("navigation", { name: "Browse recipes" });
  await browse.locator("summary").filter({ hasText: "By course" }).click();
  await browse.getByRole("link", { name: /^Dessert/ }).click();
  await expect(reader).toHaveURL(`${own.origin}/recipes/course/dessert/`);

  // The recipe's own card leads there too.
  await reader.getByRole("link", { name: /Tiramisu/ }).click();
  await reader.locator(".ob-recipe-facts").getByRole("link", { name: "Italian" }).click();
  await expect(reader).toHaveURL(`${own.origin}/recipes/cuisine/italian/`);
  await context.close();

  // The owner is told, unfolded, on the first screen Admin shows her and in a preview.
  await signIn(page, own.origin);
  const notes = page.locator("[data-recipe-notes]");
  await expect(notes).toBeVisible();
  await expect(notes).toContainText("the automatic list of recipes is at /recipes/all/");
  await expect(notes).toContainText('open your page "Recipes", and in Settings change its Slug');
  await expect(notes).toContainText("no letters or numbers");
  await page.goto(`${own.origin}/admin/#/edit/pages%2Frecipes.md`);
  await view(page, "Settings").click();
  await expect(page.getByLabel("Slug", { exact: true })).toHaveAccessibleDescription(/last part of this page's web address.*such as/);
  await view(page, "Site preview").click();
  await expect(page.locator("[data-recipe-notes]")).toBeVisible();
  await expect(page.locator("[data-recipe-notes]")).toContainText("/recipes/all/");
  await expect(page.locator("[data-site-warnings]")).not.toContainText("/recipes/all/");
});

test("the notes neither hold up Overview nor break it", async ({ page }) => {
  await signIn(page, origin);
  await page.goto(`${origin}/admin/#/look`);
  await expect(page.getByRole("heading", { level: 1, name: "Customize look" })).toBeVisible();

  let release;
  const held = new Promise((done) => { release = done; });
  await page.route("**/admin/api/recipe-notes", async (route) => { await held; await route.abort(); });
  await page.evaluate(() => { location.hash = "#/overview"; });
  await expect(page.locator(".oba-overview-metrics")).toBeVisible();
  release();
  await page.waitForEvent("requestfailed", (request) => request.url().endsWith("/recipe-notes"));
  await expect(page.locator(".oba-overview-metrics")).toBeVisible();
  await expect(page.locator("[data-recipe-notes]")).toHaveCount(0);
});

for (const slow of ["#/overview", "#/posts"]) {
  test(`a slow ${slow} does not draw over the page she moved to`, async ({ page }) => {
    await signIn(page, origin);
    await page.goto(`${origin}/admin/#/look`);
    await expect(page.getByRole("heading", { level: 1, name: "Customize look" })).toBeVisible();

    let release;
    const held = new Promise((done) => { release = done; });
    await page.route("**/admin/api/status", async (route) => { await held; await route.continue(); });
    await page.evaluate((hash) => { location.hash = hash; }, slow);
    await page.evaluate(() => { location.hash = "#/social"; });
    const social = page.getByRole("heading", { level: 2, name: "Social accounts" });
    await expect(social).toBeVisible();

    const answered = page.waitForResponse("**/admin/api/status");
    release();
    await answered;
    await page.evaluate(() => new Promise((done) => setTimeout(done, 200)));
    await expect(social).toBeVisible();
    await expect(page).toHaveURL(/#\/social$/);
  });
}

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

test("a second course the field never showed survives a save, and clearing the field clears it", async ({ page }) => {
  const imported = await startSite("two-courses", (posts) => {
    writeFileSync(join(posts, "cake.md"), recipe("Cake", "2026-10-01", "course: Dessert\ncategory: Wordpress import"));
    writeFileSync(join(posts, "soup.md"), recipe("Soup", "2026-10-02", "category: Soup\nrecipeCategory: Old"));
  });
  const file = (name) => readFileSync(join(imported.root, "content", "posts", name), "utf8");
  await signIn(page, imported.origin);

  await page.goto(`${imported.origin}/admin/#/edit/posts%2Fcake.md`);
  await view(page, "Settings").click();
  const course = page.getByLabel("Course", { exact: true });
  await expect(course).toHaveValue("Dessert");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Cake again");
  await save(page);
  await expect(() => expect(file("cake.md")).toMatch(/^title: Cake again$/m)).toPass();
  expect(file("cake.md")).toMatch(/^course: Dessert$/m);
  expect(file("cake.md")).toMatch(/^category: Wordpress import$/m);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(page.locator("#oba-profile")).toBeEnabled();

  // A fresh load, so nothing of the last recipe's save is still in flight.
  await page.goto("about:blank");
  await page.goto(`${imported.origin}/admin/#/edit/posts%2Fsoup.md`);
  await view(page, "Settings").click();
  await expect(course).toHaveValue("Soup");
  await save(page);
  await expect(() => expect(file("soup.md")).toMatch(/^course: Soup$/m)).toPass();
  expect(file("soup.md")).not.toMatch(/^category:/m);
  expect(file("soup.md")).toMatch(/^recipeCategory: Old$/m);

  await course.fill("");
  await save(page);
  await expect(() => expect(file("soup.md")).not.toMatch(/^course:/m)).toPass();
  expect(file("soup.md")).not.toMatch(/^recipeCategory:/m);
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

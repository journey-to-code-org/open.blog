import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axeClean, guardProviders, open, startSite, stopSite } from "./helper-site.mjs";
import { api, eraseVoice } from "./voice-site.mjs";

// About your blog (Studio ONB1, docs/specs/studio/onb1/): the first-run questions that open a
// Getting started run, the summary that says what shows and why, suggested site changes applied
// only on a press, the offer to learn how she writes, and Studio showing only what each login
// uses: the navigation, Find, Home, Write and the turned-off page; What you use; My stories and
// Stories you could tell. Grammi on a phone, Mikey by keyboard on a desktop. No test reaches a
// provider.

const KEY = "sk-ant-api03-ONB1-BROWSER-KNOWN-KEY-9z8y7x";
const STORY = "the first year I hosted I forgot the rolls in the oven ONB1-STORY-MARK-3301";
let site;
let unstubbed;

test.use({ serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("onb1", { env: { OPENBLOG_STUDIO_ONBOARDING: "on" }, users: ["grammi", "mikey", "dana"] }); });
test.afterAll(async () => { await stopSite(site); site = null; });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const screen = (page) => page.locator(".studio-welcome");
const question = (page, name) => screen(page).getByRole("heading", { name, level: 2 });
const choose = (page, name) => screen(page).getByRole("radio", { name: new RegExp(`^${name}`) }).click();
const next = (page) => screen(page).locator(".studio-start-primary").getByRole("button", { name: "Next" }).click();
const navLabels = (page) => page.locator("dashboard-shell").evaluate((shell) => shell.nav.map((item) => item.label));
const config = () => readFileSync(join(site.dir, "openblog.json"));

/** Find's items, as the palette has them once opened. */
async function findLabels(page) {
  await page.keyboard.press("Control+k");
  await expect(page.locator("command-palette .palette-option").first()).toBeVisible();
  const labels = await page.locator("command-palette").evaluate((palette) => palette.items.map((item) => item.label));
  await page.keyboard.press("Escape");
  return labels;
}

/** From nothing for `user`: unanswered, no Getting started record, no pieces, and a key so the run starts at the stories. */
async function fresh(page, user) {
  await open(page, site, "#/posts", user);
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await eraseVoice(page, site);
  await api(page, site, "POST", "onboarding/reset", { user });
  const areas = await (await page.request.get(`${site.origin}/admin/api/areas`)).json();
  const reset = await api(page, site, "PUT", "areas", { etag: areas.etag, onboarding: { state: "pending" }, hidden: [], shown: [], answers: {}, kind: null, showEverything: false });
  expect(reset.status).toBe(200);
  const settings = await (await page.request.get(`${site.origin}/admin/api/assistant/settings`)).json();
  if (settings.credential?.state !== "saved") {
    const saved = await api(page, site, "PUT", "assistant/settings", { provider: "anthropic", model: settings.model || "claude-test", etag: settings.etag, credentialAction: "replace", credential: KEY });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }
}

async function home(page) {
  await page.goto("about:blank");
  await page.goto(`${site.origin}/admin/studio/#/`);
}

test("Grammi on a phone: the questions, the summary, a story, and finding it again while writing", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await fresh(page, "grammi");
  const before = config();
  const draws = [];
  const drawn = [];
  page.on("request", (request) => { if (request.url().endsWith("/admin/api/voice/draw")) draws.push(request.postDataJSON()); });
  page.on("response", async (response) => { if (response.url().endsWith("/admin/api/voice/draw")) drawn.push(await response.json().catch(() => ({}))); });

  // First sign-in: About your blog, not Home.
  await home(page);
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(question(page, "What will you mostly write?")).toBeFocused();
  await expect(screen(page)).toContainText("Question 1 of 6");
  await expect(screen(page).locator(".studio-start-hello")).toHaveText("Welcome");
  await expect(page.getByRole("button", { name: /^Find/ })).toBeHidden();
  await axeClean(page, "question 1", ".studio-welcome");

  await choose(page, "Recipes and family stories");
  await next(page);
  await expect(question(page, "Will anyone else write with you?")).toBeFocused();
  await choose(page, "Just me");
  await next(page);
  await expect(question(page, "Should your blog dress up for holidays and seasons?")).toBeFocused();
  await choose(page, "Yes");
  await next(page);
  // A reload resumes at the same question with the same answers; nothing was saved yet.
  await page.reload();
  await expect(question(page, "Do you want to share posts beyond your blog?")).toBeVisible();
  expect((await (await page.request.get(`${site.origin}/admin/api/areas`)).json()).preferences.onboarding.state).toBe("pending");
  // Back keeps earlier answers.
  await screen(page).getByRole("button", { name: "Back" }).click();
  await expect(question(page, "Should your blog dress up for holidays and seasons?")).toBeVisible();
  await expect(screen(page).getByRole("radio", { name: /^Yes/ })).toHaveAttribute("aria-checked", "true");
  await next(page);
  await choose(page, "Maybe later");
  await next(page);
  await choose(page, "Yes");
  await next(page);
  await expect(question(page, "How much would you like to see?")).toBeVisible();
  await screen(page).getByRole("button", { name: "Skip this one" }).click();

  // The summary says what shows and why, in her words.
  await expect(screen(page).getByRole("heading", { name: "Here is what your blog will show you" })).toBeFocused();
  const shown = screen(page).locator("section").filter({ has: page.getByRole("heading", { name: "Shown" }) });
  await expect(shown).toContainText("Recipes Because you write recipes and family stories.");
  await expect(shown).toContainText("Seasons and holidays Because your blog dresses up for the seasons.");
  await expect(shown).toContainText("Pages Already on your blog.");
  const tucked = screen(page).locator("section").filter({ has: page.getByRole("heading", { name: "Tucked away" }) });
  await expect(tucked).toContainText("Sharing You said maybe later.");
  await expect(tucked).toContainText("Research You write recipes and family stories.");
  await expect(tucked).toContainText("Code and diagrams");
  await axeClean(page, "summary", ".studio-welcome");
  await screen(page).getByRole("button", { name: "Save these" }).click();
  await expect(page.locator("toast-region")).toContainText("Saved. Your blog now shows what you need.");

  // Suggestions: each opens its own screen; going on changes nothing.
  await expect(screen(page).getByRole("heading", { name: "Want your blog set up to match?" })).toBeFocused();
  await expect(screen(page)).toContainText("Choose decorations for the seasons");
  await expect(screen(page)).toContainText("Let readers comment");
  await axeClean(page, "suggestions", ".studio-welcome");
  await next(page);
  expect(config().equals(before), "declining every suggestion leaves openblog.json byte for byte").toBe(true);

  // The offer: Start goes on to Getting started's stories, drawn from the sets that suit her blog.
  await expect(screen(page).getByRole("heading", { name: "Want your blog to learn how you write?" })).toBeFocused();
  await expect(screen(page)).toContainText("One of them is always a true story from your life.");
  await axeClean(page, "voice offer", ".studio-welcome");
  await screen(page).getByRole("link", { name: "Start" }).click();
  await expect(page.locator(".studio-start").getByRole("heading", { name: "Tell a few short stories", level: 2 })).toBeFocused();
  await expect.poll(() => draws.length).toBeGreaterThan(0);
  expect(draws[0]).toMatchObject({ packs: ["stories", "people", "reviews"], story: true });
  await expect.poll(() => drawn.length).toBeGreaterThan(0);
  // A true story (the draw always has one): the Stories set is what My stories gathers.
  const storyAt = drawn[0].prompts.findIndex((prompt) => prompt.pack === "stories");
  expect(storyAt).toBeGreaterThanOrEqual(0);
  await page.locator(".studio-start choice-cards [role=radio]").nth(storyAt).click();
  await page.locator(".studio-start").getByRole("button", { name: "Type it", exact: true }).click();
  const box = page.locator("textarea.studio-voice-rough");
  await expect(box).toBeFocused();
  await box.pressSequentially(STORY, { delay: 2 });
  await page.locator(".studio-start").getByRole("button", { name: "I'm done" }).click();
  await expect(page.locator(".studio-start")).toContainText("Kept. That's 1 of 3.");
  await page.locator(".studio-start").getByRole("button", { name: "That's enough for now" }).click();
  // She skips the voice guide.
  await page.locator(".studio-start").getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".studio-start").getByRole("heading", { name: "You're ready" })).toBeFocused();

  // What she sees now: no Sharing or Research anywhere; Decorations, because she said yes.
  await home(page);
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
  const nav = await navLabels(page);
  expect(nav).toContain("Decorations");
  expect(nav).not.toContain("Sharing");
  const find = await findLabels(page);
  expect(find).toContain("Write a new recipe");
  expect(find).toContain("Turn on Sharing");
  expect(find).toContain("Turn on Research");
  expect(find.some((label) => /^(Start research|Your research)/.test(label))).toBe(false);

  // My stories lists the story; Write's Stories you could tell shows it beside a recipe.
  await page.evaluate(() => { location.hash = "#/stories"; });
  await expect(page.getByRole("heading", { name: "My stories", level: 2 })).toBeFocused();
  const row = page.locator(".studio-story-row").first();
  await expect(row).toContainText("the first year I hosted I forgot the rolls");
  await axeClean(page, "my stories", ".studio-stories-page");
  await page.evaluate(() => { location.hash = "#/write/new/recipe"; });
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Dinner rolls");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Stories you could tell" }).click();
  const sheet = page.locator("side-sheet dialog[open]");
  await expect(sheet).toContainText("the first year I hosted");
  await sheet.getByRole("button", { name: /^Read it: / }).first().click();
  await expect(sheet.locator(".studio-story-text")).toContainText(STORY);
  await expect(sheet).toContainText("It isn't put in your post. Copy what you need.");
  await page.keyboard.press("Escape");
});

test("Mikey by keyboard: a technical blog shows nothing seasonal or recipe-shaped, and every part is one step away", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fresh(page, "mikey");
  await home(page);
  await expect(question(page, "What will you mostly write?")).toBeFocused();

  // The questions by keyboard: arrows choose, Ctrl Enter goes on.
  await page.keyboard.press("Tab");
  await expect(screen(page).getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Space");
  await expect(screen(page).getByRole("radio", { name: /^Technical writing and code/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Control+Enter");
  await expect(question(page, "Will anyone else write with you?")).toBeFocused();
  await page.keyboard.press("Control+Enter"); // no choice: skipped
  await expect(question(page, "Should your blog dress up for holidays and seasons?")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await expect(screen(page).getByRole("radio", { name: /^No/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Control+Enter");
  await expect(question(page, "Do you want to share posts beyond your blog?")).toBeFocused();
  // Back by keyboard keeps the answer.
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(question(page, "Should your blog dress up for holidays and seasons?")).toBeFocused();
  await expect(screen(page).getByRole("radio", { name: /^No/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Control+Enter");
  for (const name of ["Do you want to share posts beyond your blog?", "Do you want readers to comment or react?", "How much would you like to see?"]) {
    await expect(question(page, name)).toBeFocused();
    await page.keyboard.press("Control+Enter");
  }
  await expect(screen(page).getByRole("heading", { name: "Here is what your blog will show you" })).toBeFocused();
  await page.keyboard.press("Control+Enter"); // Save these
  await expect(page.locator("toast-region")).toContainText("Saved.");
  await expect(screen(page).getByRole("heading", { name: "Want your blog to learn how you write?" })).toBeFocused();
  await screen(page).getByRole("button", { name: "Later" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
  await expect(page.locator(".studio-home-start-card section")).toContainText("Finish getting started");

  // Nothing seasonal, recipe-shaped or of a business, anywhere.
  const nav = await navLabels(page);
  for (const gone of ["Decorations", "Cards", "Gifts", "Services", "Reviews", "Business", "Reminders", "New job"]) expect(nav, gone).not.toContain(gone);
  const find = await findLabels(page);
  for (const gone of ["Write a new recipe", "Put a look up now", "Decorations", "Business facts"]) expect(find, gone).not.toContain(gone);
  expect(find).toContain("Turn on Seasons and holidays");
  expect(find).toContain("Turn on Recipes");
  expect(find).toContain("What you use");
  await page.evaluate(() => { location.hash = "#/write"; });
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await page.getByRole("button", { name: /^About this post/ }).click();
  const about = page.locator("side-sheet.studio-about-sheet").first();
  await expect(about.getByRole("radio", { name: "A story" })).toBeVisible();
  await expect(about.getByRole("radio", { name: "A recipe" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A tucked-away address says so, and Turn it on opens it.
  await page.evaluate(() => { location.hash = "#/decorations"; });
  await expect(page.getByRole("heading", { name: "Seasons and holidays is turned off for you" })).toBeFocused();
  await axeClean(page, "turned off", ".studio-turned-off");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Turn it on" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("toast-region")).toContainText("Seasons and holidays is on.");
  await expect(page.getByRole("heading", { name: "Seasons and holidays is turned off for you" })).toHaveCount(0);
  await expect.poll(() => navLabels(page)).toContain("Decorations");

  // Find turns on Recipes in one step.
  await page.keyboard.press("Control+k");
  await page.locator("command-palette input").fill("Turn on Recipes");
  await page.keyboard.press("Enter");
  await expect(page.locator("toast-region")).toContainText("Recipes is on.");
  expect(await findLabels(page)).toContain("Write a new recipe");

  // What you use: Code and diagrams off and on again, by keyboard; the shell follows at once.
  await page.evaluate(() => { location.hash = "#/what-you-use"; });
  await expect(page.getByRole("heading", { name: "What you use", level: 2 })).toBeFocused();
  await expect(page.locator(".studio-use-used")).toContainText("Pages");
  await expect(page.locator(".studio-use-used")).toContainText("In use on your blog, so it stays.");
  const teaching = page.getByRole("switch", { name: /^Teaching/ });
  await expect(teaching).toHaveAttribute("aria-checked", "false");
  await teaching.focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".studio-use")).toContainText("Saved.");
  await expect(teaching).toHaveAttribute("aria-checked", "true");
  expect((await (await page.request.get(`${site.origin}/admin/api/areas`)).json()).preferences.areas.hidden).not.toContain("teaching");
  const code = page.getByRole("switch", { name: /^Code and diagrams/ });
  await code.focus();
  await page.keyboard.press("Space");
  await expect(code).toHaveAttribute("aria-checked", "false");
  expect(await findLabels(page)).toContain("Turn on Code and diagrams");
  await code.focus();
  await page.keyboard.press("Space");
  await expect(code).toHaveAttribute("aria-checked", "true");
  await axeClean(page, "what you use", ".studio-use");
});

test("a site that already has recipes, answered as technical, keeps them with the reason", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await fresh(page, "dana");
  writeFileSync(join(site.dir, "content", "posts", "2026-11-01-pie.md"), "---\ntitle: Pie\ndate: 2026-11-01\nprofile: recipe\n---\n\nBake it.\n");
  try {
    await home(page);
    await choose(page, "Technical writing and code");
    await next(page);
    await page.evaluate(() => { location.hash = location.hash.replace(/#\/welcome\/together/, "#/welcome/summary"); });
    const shown = screen(page).locator("section").filter({ has: page.getByRole("heading", { name: "Shown" }) });
    await expect(shown).toContainText("Recipes Already on your blog.");
    await screen(page).getByRole("button", { name: "Save these" }).click();
    await expect(page.locator("toast-region")).toContainText("Saved.");
    // Nothing to suggest for a technical blog: straight to the offer. No thanks remembers it.
    await expect(screen(page).getByRole("heading", { name: "Want your blog to learn how you write?" })).toBeFocused();
    await screen(page).getByRole("button", { name: "No thanks" }).click();
    await expect(page.locator("toast-region")).toContainText("It's under Getting started in the menu");
    expect((await (await page.request.get(`${site.origin}/admin/api/voice/status`)).json()).invitationDismissed).toBe(true);
    expect(await findLabels(page)).toContain("Write a new recipe");
    await page.evaluate(() => { location.hash = "#/write"; });
    await expect(page.getByRole("heading", { name: "What are you writing?" })).toBeVisible();
    await expect(page.getByRole("link", { name: /A recipe/ })).toBeVisible();
  } finally {
    writeFileSync(join(site.dir, "content", "posts", "2026-11-01-pie.md"), "");
    await api(page, site, "DELETE", `document?path=${encodeURIComponent("posts/2026-11-01-pie.md")}`, {}).catch(() => {});
  }
});

test("a documentation blog is offered the section: the exact change is one layer deeper, and Do this makes only that change", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fresh(page, "mikey");
  const before = config().toString();
  await page.goto("about:blank");
  await page.goto(`${site.origin}/admin/studio/#/welcome/summary?a=kind.docs`);
  await screen(page).getByRole("button", { name: "Save these" }).click();
  await expect(screen(page).getByRole("heading", { name: "Want your blog set up to match?" })).toBeFocused();
  const card = screen(page).locator("content-card").filter({ hasText: "Add a documentation section" });
  await card.locator("summary").click();
  const change = card.locator("pre");
  await expect(change).toContainText('+   "enabled": true');
  expect(config().toString(), "nothing changes before the press").toBe(before);
  await card.getByRole("button", { name: "Do this: Add a documentation section" }).click();
  await expect(card).toContainText("Done. Readers will see it after the next update.");
  const after = config().toString();
  expect(JSON.parse(after).docs.enabled).toBe(true);
  const removed = before.split("\n").filter((line) => !after.split("\n").includes(line));
  const shownRemoved = (await change.textContent()).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
  expect(removed).toEqual(shownRemoved);
  writeFileSync(join(site.dir, "openblog.json"), before);
});

test("edges: a save that fails puts the switch back, another window's change is adopted, and dark mode passes axe", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await fresh(page, "dana");
  const areas = await (await page.request.get(`${site.origin}/admin/api/areas`)).json();
  expect((await api(page, site, "PUT", "areas", { etag: areas.etag, onboarding: { state: "done" }, hidden: ["seasonal"] })).status).toBe(200);
  await page.goto("about:blank");
  await page.goto(`${site.origin}/admin/studio/#/what-you-use`);
  await expect(page.getByRole("heading", { name: "What you use", level: 2 })).toBeFocused();
  await axeClean(page, "what you use, dark", ".studio-use");

  // The server refuses: the switch goes back and the page says so.
  await page.route("**/admin/api/areas", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 500, json: { error: "disk full" } }) : route.fallback()));
  const research = page.getByRole("switch", { name: /^Research/ });
  await expect(research).toHaveAttribute("aria-checked", "true");
  await research.click();
  await expect(page.locator(".studio-use")).toContainText("That wasn't saved. Try again.");
  await expect(research).toHaveAttribute("aria-checked", "true");
  await page.unroute("**/admin/api/areas");

  // Another window turns Seasons and holidays on; coming back to this one shows it.
  const now = await (await page.request.get(`${site.origin}/admin/api/areas`)).json();
  expect((await api(page, site, "PUT", "areas", { etag: now.etag, hidden: [] })).status).toBe(200);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => navLabels(page)).toContain("Decorations");
  // What you use shows the newer choices too.
  await page.evaluate(() => { location.hash = "#/"; });
  await page.evaluate(() => { location.hash = "#/what-you-use"; });
  await expect(page.getByRole("switch", { name: /^Seasons and holidays/ })).toHaveAttribute("aria-checked", "true");

  // The questions in dark mode.
  await page.goto(`${site.origin}/admin/studio/#/welcome`);
  await expect(question(page, "What will you mostly write?")).toBeFocused();
  await axeClean(page, "question, dark", ".studio-welcome");
});

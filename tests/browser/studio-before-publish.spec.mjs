import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Before you publish (Studio R7): the first Publish of a post with suggestions opens the sheet;
// Fix it changes her words with Undo; a post with nothing to show publishes straight away; Update
// doesn't nag; the real shared card replaces R5's rough one; a job the build would refuse waits
// under Needs fixing first with Go to it; keyboard only, 320 px, axe. A cooking site and a job.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let dir;
let child;
let origin;

const CLEAN = "---\ntitle: A clean post\ndate: 2026-10-01\ndraft: true\ntags: [walks]\ndescription: A summary that says what the post is about in a sentence or two.\n---\n\nPlain words with nothing to fix.\n";
const MESSY = "---\ntitle: Apple cake\ndate: 2026-10-02\ndraft: true\n---\n\nThe cake.\n\n![](/images/cake.jpg)\n\nRead more [here](https://example.com/cake).\n";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block", timezoneId: "America/New_York" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-ready-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Sam Writer", url: "https://writer.example" };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  execFileSync(binary, ["user", "add", "sam", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }
  removeTree(dir);
});

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
  page.on("pageerror", (error) => { throw error; });
});

async function open(page, hash) {
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("sam");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function openPost(page, file, text) {
  if (text !== undefined) writeFileSync(join(dir, "content", "posts", file), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${file}`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
  await expect(status(page)).not.toHaveText("");
}

const fileOf = (file) => readFileSync(join(dir, "content", "posts", file), "utf8");
const status = (page) => page.locator(".studio-write > [role=status]");
const ready = (page) => page.locator("side-sheet.studio-ready-sheet dialog").filter({ has: page.getByRole("heading", { name: /^(Before you publish|Check this post)$/, level: 2 }) }).first();
const readyStatus = (page) => ready(page).locator(".studio-ready-status");
const publish = (page) => page.locator(".studio-write-bar").getByRole("button", { name: /^(Publish|Schedule|Update)$/ });

async function axeClean(page, label, root) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  const sideways = await page.evaluate((selector) => [...document.querySelectorAll(`${selector} *`)].some((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX === "auto"), root);
  expect(sideways, `${label}: nothing scrolls sideways`).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

test("a post with nothing to show publishes straight away, and Update never opens the sheet", async ({ page }) => {
  await openPost(page, "2026-10-01-clean.md", CLEAN);
  const previews = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/preview")) previews.push(request.postDataJSON()); });
  await publish(page).click();
  await expect.poll(() => fileOf("2026-10-01-clean.md")).not.toContain("draft: true");
  await expect(ready(page)).toBeHidden();
  expect(previews.at(-1).only, "the check asks for the checks only").toBe("checks");
  // Published: Update with a suggestion doesn't open it.
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("A clean post, with a title much too long for a search page to show it all");
  await publish(page).click();
  await expect.poll(() => fileOf("2026-10-01-clean.md")).toContain("much too long");
  await expect(ready(page)).toBeHidden();
  // The side card names it for a published post, with the last check's line.
  await expect(page.getByRole("button", { name: /^Check this post:/ })).toBeVisible();
});

test("the first Publish with suggestions opens the sheet: the real card, Fix it with Undo, and Publish from it", async ({ page }) => {
  await openPost(page, "2026-10-02-cake.md", MESSY);
  await expect(page.getByRole("button", { name: /^Before you publish: 2 suggestions so far$/ })).toBeVisible();
  await publish(page).click();
  await expect(ready(page)).toBeVisible();
  await expect(readyStatus(page)).toBeFocused();
  await expect(readyStatus(page)).toContainText(/\d+ suggestions\. None of them stop you publishing\./);
  expect(fileOf("2026-10-02-cake.md"), "nothing published yet").toContain("draft: true");
  // When it's shared: the real card from the server, with its notes.
  const card = ready(page).locator("figure.studio-share-card");
  await expect(card).toContainText("Apple cake");
  await expect(card.locator(".studio-share-card-address")).toContainText("/cake/");
  await expect(ready(page).getByText("No summary, so your first lines are used.")).toBeVisible();
  // Suggestions: R6's own, written once, then search hints.
  const list = ready(page).locator(".studio-ready-suggestions");
  await expect(list.getByText("No tags yet. A tag puts it with your other posts on the same topic.")).toBeVisible();
  await expect(list.getByRole("button", { name: /^Show me: / }).first()).toBeVisible();
  // A vague link: Fix it asks for words, changes them, and Undo puts them back.
  const vague = list.locator("li").filter({ hasText: "here" }).first();
  await vague.getByRole("button", { name: /Change the words|Fix it/ }).click();
  await vague.getByRole("textbox").fill("the cake recipe");
  await vague.getByRole("button", { name: "Use these words" }).click();
  await expect(ready(page).locator(".studio-ready-did")).toContainText("Fixed.");
  await expect.poll(() => fileOf("2026-10-02-cake.md"), { timeout: 10000 }).toContain("[the cake recipe](https://example.com/cake)");
  await ready(page).locator(".studio-ready-did").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => fileOf("2026-10-02-cake.md"), { timeout: 10000 }).toContain("[here](https://example.com/cake)");
  await axeClean(page, "Before you publish", "side-sheet.studio-ready-sheet");
  // Publish from inside the sheet publishes, and never reopens it.
  await ready(page).locator("[slot=actions]").getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => fileOf("2026-10-02-cake.md")).not.toContain("draft: true");
  await expect(ready(page)).toBeHidden();
  await expect(status(page)).toContainText("Published");
});

test("Checking: from the moment Publish is pressed, the button is busy and the status says so, even behind a save", async ({ page }) => {
  await openPost(page, "2026-10-04-slow.md", CLEAN.replace("A clean post", "A slow post").replace("2026-10-01", "2026-10-04"));
  // A save already on its way, and a check that takes its time.
  let releaseSave;
  const saveHeld = new Promise((done) => { releaseSave = done; });
  await page.route("**/admin/api/document?**", async (route) => { if (route.request().method() === "PUT") await saveHeld; await route.continue(); });
  await page.route("**/admin/api/document", async (route) => { if (route.request().method() === "PUT") await saveHeld; await route.continue(); });
  let releaseCheck;
  const checkHeld = new Promise((done) => { releaseCheck = done; });
  await page.route("**/admin/api/preview", async (route) => { await checkHeld; await route.continue(); });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("A slow post, changed");
  let saveSeen;
  const saveSent = new Promise((done) => { saveSeen = done; });
  page.on("request", (request) => { if (request.method() === "PUT" && request.url().includes("/api/document")) saveSeen(); });
  await saveSent; // the draft saves by itself a moment after the change, and is held on its way
  const button = page.locator(".studio-write-bar > action-button").last().locator("button");
  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true", { timeout: 500 });
  await expect(button).toHaveText(/Checking…/, { timeout: 500 });
  await expect(status(page)).toHaveText("Checking your post…", { timeout: 500 });
  releaseSave();
  // Still checking while the check runs, whatever else repaints Write.
  await page.waitForTimeout(300);
  await expect(status(page)).toHaveText("Checking your post…");
  await expect(button).toHaveAttribute("aria-busy", "true");
  releaseCheck();
  await expect.poll(() => fileOf("2026-10-04-slow.md")).not.toContain("draft: true");
  await expect(status(page)).toContainText("Published");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("keyboard only: the side card opens it, Escape closes it and focus goes back", async ({ page }) => {
  await openPost(page, "2026-10-03-pie.md", MESSY.replace("Apple cake", "Pear pie").replace("2026-10-02", "2026-10-03"));
  const side = page.getByRole("button", { name: /^Before you publish:/ });
  await side.focus();
  await page.keyboard.press("Enter");
  await expect(ready(page)).toBeVisible();
  await expect(ready(page).locator("span[slot=heading]")).toBeFocused();
  await expect(readyStatus(page)).toContainText("suggestions", { timeout: 15000 });
  // Tab stays inside the sheet.
  for (let i = 0; i < 25; i += 1) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("side-sheet.studio-ready-sheet")))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(ready(page)).toBeHidden();
  await expect(side).toBeFocused();
  await expect(side).toHaveAccessibleName(/^Before you publish: \d+ suggestions$/);
  // ?sheet=ready opens it, and the address loses the query on close.
  await open(page, `#/write/${encodeURIComponent("posts/2026-10-03-pie.md")}?sheet=ready`);
  await expect(ready(page)).toBeVisible();
  expect(page.url()).not.toContain("sheet=ready");
  // The old editor's Social pane opens it too.
  await open(page, `#/edit/posts/2026-10-03-pie.md?pane=social`);
  await expect(ready(page)).toBeVisible();
});

test("a job the build would refuse waits under Needs fixing first, with Go to it; fixing it publishes", async ({ page }) => {
  const file = "2026-10-04-gutters.md";
  writeFileSync(join(dir, "content", "posts", file), "---\ntitle: Gutters\ndate: 2026-10-04\ndraft: true\nprofile: job\njob:\n  trade: roofing\n  started: 2026-10-01\n  finished: 2026-10-02\n---\n\n## Problem\n\nLeaks.\n\n## Solution\n\nNew gutters.\n\n## Process\n\nOne day.\n\n## Outcome\n\nDry.\n");
  await openPost(page, file);
  await publish(page).click();
  await expect(ready(page)).toBeVisible();
  const blocks = ready(page).locator(".studio-ready-blocks");
  await expect(blocks.getByRole("heading", { name: /^Needs fixing first \(\d\)$/ })).toBeVisible();
  await expect(blocks).toContainText("Add the town.");
  await expect(readyStatus(page)).toContainText(/needs? fixing before your post can go up/);
  const go = ready(page).locator("[slot=actions]").getByRole("button", { name: "Publish" });
  await expect(go).toHaveAttribute("aria-disabled", "true");
  await expect(ready(page).getByText("Fix the things under Needs fixing first. Your words are kept.")).toBeVisible();
  // aria-disabled stays focusable: pressing it says why it waits and goes to the first blocker.
  await go.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest(".studio-ready-blocks")))).toBe(true);
  expect(fileOf(file)).toContain("draft: true");
  await blocks.getByRole("button", { name: "Go to it: Add the town." }).click();
  await expect(ready(page)).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Town" })).toBeFocused();
  await axeClean(page, "Write after Go to it", "#studio-main");
});

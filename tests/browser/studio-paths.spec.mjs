import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

test.use({ serviceWorkers: "block" });

// Studio R13: reading paths (ported from reading-paths.spec). A path is made step by step; Move is a menu and
// Alt+Shift+arrows (never drag); saving is explicit and the order is saved by saving the whole path; a reason held
// by a step that became first is asked about once and Undo brings it back; delete has Undo; a change made
// somewhere else is asked about; the old addresses open the new screens; and the editor passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const HOSTILE = "<img src=x onerror=alert(1)>";
let root;
let server;
let origin;

const pathFile = (slug) => join(root, "content", "paths", `${slug}.json`);
const stored = (slug) => (existsSync(pathFile(slug)) ? readFileSync(pathFile(slug), "utf8") : null);
const post = (name, title, extra = "") => writeFileSync(join(root, "content", "posts", `${name}.md`), `---\ntitle: ${title}\ndate: 2026-01-01\n${extra}---\nBody of ${title}.\n`);
const step = (id, slug, transition) => ({ id, target: { kind: "post", slug }, ...(transition ? { transition } : {}) });
const next = (why = "It continues the thread.") => ({ relationship: "next", why });
const writePath = (slug, value) => {
  mkdirSync(dirname(pathFile(slug)), { recursive: true });
  writeFileSync(pathFile(slug), `${JSON.stringify({ format: "openblog-reading-path", version: 1, ...value }, null, 2)}\n`);
};
const three = (title = "A tour") => ({ title, status: "draft", steps: [step("one", "alpha"), step("two", "bravo", next("Bravo follows alpha.")), step("three", "charlie", next("Charlie follows bravo."))] });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-paths-"));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "openblog.json"), JSON.stringify({ title: "Paths test", url: "https://paths.example.org", author: { name: "Alex" } }));
  post("alpha", "Alpha post");
  post("bravo", "Bravo post");
  post("charlie", "Charlie post");
  post("hostile", HOSTILE);
  post("drafty", "Secret draft title", "draft: true\n");
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(root);
});

async function signIn(page, hash = "#/paths") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const field = (page, label) => page.getByRole("textbox", { name: label });
const stepCard = (page, n) => page.locator(".studio-path-step").nth(n);
const stepNames = (page) => page.locator(".studio-path-step-title").allTextContents();

async function addStep(page, title) {
  await page.getByRole("button", { name: "Add a step", exact: true }).click();
  await page.getByRole("button", { name: title, exact: true }).click();
}

test("a reading path is made step by step, saved as a draft, and written in the file's own form", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "No reading paths yet" })).toBeVisible();
  await page.getByRole("button", { name: "Make a reading path" }).click();
  await expect(page).toHaveURL(/#\/paths\/new$/);
  await field(page, "Title").fill("Start here: the tour");
  await expect(field(page, "Address")).toHaveValue("start-here-the-tour");
  await addStep(page, "Alpha post");
  await expect(stepCard(page, 0)).toContainText("Step 1: Alpha post");
  await addStep(page, "Bravo post");
  // The second step asks how it relates and why it follows.
  await expect(page.getByRole("heading", { name: "Bravo post" })).toBeVisible();
  await page.getByRole("combobox", { name: "How it relates to the step before" }).selectOption("builds-on");
  await field(page, "Why it follows, in your words").fill("Bravo builds on alpha.");
  await page.getByRole("button", { name: "Keep this step" }).click();
  await expect(stepCard(page, 1)).toContainText("Bravo builds on alpha.");
  // Alpha can't be posted twice, and the draft post is never offered.
  await page.getByRole("button", { name: "Add a step", exact: true }).click();
  await expect(page.getByRole("button", { name: "Alpha post", exact: true })).toHaveCount(0);
  await expect(page.getByText("Secret draft title")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(stored("start-here-the-tour")).toBeNull();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved as a draft. Readers don't see it.").first()).toBeVisible();
  await expect(page).toHaveURL(/#\/path\/start-here-the-tour$/);
  const file = JSON.parse(stored("start-here-the-tour"));
  expect(file.format).toBe("openblog-reading-path");
  expect(file.steps.map((s) => s.id)).toEqual(["alpha", "bravo"]);
  expect(file.steps[0].transition).toBeUndefined();
  expect(file.steps[1].transition).toEqual({ relationship: "builds-on", why: "Bravo builds on alpha." });
  // The address is fixed now.
  await expect(page.getByText("Its address is start-here-the-tour. It can't be changed.")).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/paths`);
  await expect(page.getByRole("link", { name: "Start here: the tour" })).toBeVisible();
  await expect(page.getByText("Draft · 2 steps")).toBeVisible();
});

test("Move is a menu and Alt+Shift keys, the order is saved by Save, and nothing drags", async ({ page }) => {
  writePath("order", three("Order"));
  await signIn(page, "#/path/order");
  await expect(stepCard(page, 2)).toBeVisible();
  expect(await page.locator("[draggable=true]").count()).toBe(0);
  // The menu.
  await page.getByRole("button", { name: /^Move\s+Charlie post/ }).click();
  await page.getByRole("menuitem", { name: "Move to the start" }).click();
  expect(await stepNames(page)).toEqual(["Step 1: Charlie post", "Step 2: Alpha post", "Step 3: Bravo post"]);
  await expect(page.getByText("Charlie post is step 1 of 3 now. Not saved yet.")).toBeVisible();
  expect(JSON.parse(stored("order")).steps.map((s) => s.id)).toEqual(["one", "two", "three"]);
  // Keys, on the focused card: the card keeps focus.
  await stepCard(page, 0).focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  expect(await stepNames(page)).toEqual(["Step 1: Alpha post", "Step 2: Charlie post", "Step 3: Bravo post"]);
  await expect(stepCard(page, 1)).toBeFocused();
  await page.keyboard.press("Alt+Shift+End");
  await expect(stepCard(page, 2)).toBeFocused();
  expect(await stepNames(page)).toEqual(["Step 1: Alpha post", "Step 2: Bravo post", "Step 3: Charlie post"]);
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(stepCard(page, 1)).toBeFocused();
  await page.keyboard.press("Alt+Shift+Home");
  await expect(stepCard(page, 0)).toBeFocused();
  expect(await stepNames(page)).toEqual(["Step 1: Charlie post", "Step 2: Alpha post", "Step 3: Bravo post"]);
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(stepCard(page, 1)).toBeFocused();
  expect(await stepNames(page)).toEqual(["Step 1: Alpha post", "Step 2: Charlie post", "Step 3: Bravo post"]);
  // Leaving asks; Save writes the whole path in the new order.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved as a draft. Readers don't see it.").first()).toBeVisible();
  expect(JSON.parse(stored("order")).steps.map((s) => s.id)).toEqual(["one", "three", "two"]);
});

test("a reason held by a step that became first is kept, Save asks once, and Undo brings it back", async ({ page }) => {
  writePath("held", three("Held"));
  const before = stored("held");
  await signIn(page, "#/path/held");
  await expect(stepCard(page, 2)).toBeVisible();
  // Bravo moves to the front: its reason is kept on screen but not in the file.
  await page.getByRole("button", { name: /^Move\s+Bravo post/ }).click();
  await page.getByRole("menuitem", { name: "Move to the start" }).click();
  await expect(stepCard(page, 0)).toContainText("The reason you wrote is kept");
  // Alpha now follows bravo and has no reason of its own: Save says what to write first.
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Choose how this step relates to the one before.").first()).toBeVisible();
  expect(stored("held")).toBe(before);
  // Move it back and forth: the reason survives.
  await page.getByRole("button", { name: /^Move\s+Bravo post/ }).click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  expect(await stepNames(page)).toEqual(["Step 1: Alpha post", "Step 2: Bravo post", "Step 3: Charlie post"]);
  await expect(stepCard(page, 1)).toContainText("Bravo follows alpha.");
  // Take the first step out so the second becomes first, holding its reason: Save asks once.
  await page.getByRole("button", { name: /^Take it out\s+Alpha post/ }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: "Save without the reason for “Bravo post”?" })).toBeVisible();
  await page.getByRole("button", { name: "Go back" }).click();
  expect(stored("held")).toBe(before);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Save without it" }).click();
  await expect(page.getByText("Saved as a draft. Readers don't see it.").first()).toBeVisible();
  expect(JSON.parse(stored("held")).steps[0].transition).toBeUndefined();
  // Undo puts the file back exactly as it was.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Put back as it was.").first()).toBeVisible();
  expect(stored("held")).toBe(before);
  expect(await stepNames(page)).toEqual(["Step 1: Alpha post", "Step 2: Bravo post", "Step 3: Charlie post"]);
});

test("Publish, Update and make it a draft again say what readers can see, and Undo reverses each", async ({ page }) => {
  writePath("live", three("Live"));
  const draft = stored("live");
  await signIn(page, "#/path/live");
  await expect(page.getByRole("heading", { name: "Live", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/Saved as published, but your site isn't showing reading paths yet\./).first()).toBeVisible();
  expect(JSON.parse(stored("live")).status).toBe("published");
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Put back as it was.").first()).toBeVisible();
  expect(stored("live")).toBe(draft);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
  // A published path can be made a draft again from More.
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Make it a draft again" }).click();
  await expect(page.getByText("It's a draft again. Readers don't see it.").first()).toBeVisible();
  expect(JSON.parse(stored("live")).status).toBe("draft");
});

test("deleting asks only when it's live, and Undo on the list brings it back", async ({ page }) => {
  writePath("gone", three("To delete"));
  const before = stored("gone");
  await signIn(page, "#/path/gone");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Delete “To delete”?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep it" }).click();
  expect(stored("gone")).toBe(before);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/#\/paths$/);
  await expect(page.getByText("Deleted “To delete”.")).toBeVisible();
  expect(stored("gone")).toBeNull();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("link", { name: "To delete" })).toBeVisible();
  expect(stored("gone")).toBe(before);
});

test("a change made somewhere else is asked about, and what readers will see comes from the server's words", async ({ page }) => {
  writePath("shared", three("Shared"));
  await signIn(page, "#/path/shared");
  await expect(page.getByRole("heading", { name: "Shared", level: 2 })).toBeVisible();
  await field(page, "Title").fill("Shared, my way");
  writePath("shared", { ...three("Shared elsewhere") });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: "Changed somewhere else" })).toBeVisible();
  await page.getByRole("button", { name: "Show the other version" }).click();
  await expect(page.getByRole("heading", { name: "Shared elsewhere" })).toBeVisible();
  // Preview: only she sees it; a hostile title is text.
  await page.getByRole("button", { name: "See what readers will see" }).click();
  await expect(page.getByText("Only you see this page. Nothing is published by looking.")).toBeVisible();
  await expect(page.getByText("This is a draft. It shows what readers would see if you published it now.")).toBeVisible();
  await expect(page.locator(".studio-preview-step").first()).toContainText("Alpha post");
});

test("an old address opens the new screen, and an unreadable file stays listed", async ({ page }) => {
  writePath("old", three("Old"));
  writeFileSync(pathFile("broken"), "{ not json");
  await signIn(page, "#/paths/edit/old");
  await expect(page).toHaveURL(/#\/path\/old$/);
  await expect(page.getByRole("heading", { name: "Old" })).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/paths`);
  await expect(page.getByText("Can't be read yet").first()).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/path/broken`);
  await expect(page.getByText("This path's file can't be read, so it can't be edited here.")).toBeVisible();
});

test("the editor passes axe at 320 px without sideways scrolling", async ({ page }) => {
  writePath("small", three("Small"));
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, "#/path/small");
  await expect(stepCard(page, 2)).toBeVisible();
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  const wide = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
  expect(wide).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto(`${origin}/admin/studio/#/paths`);
  await expect(page.getByRole("link", { name: "Small" })).toBeVisible();
  await page.evaluate(axeSource);
  expect(await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => v.id))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

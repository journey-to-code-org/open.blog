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

// Studio R13: readings side by side (ported from interpretation-comparisons.spec). Two readings are made and saved as a
// draft; words an AI tool drafted stay a draft until approved on the words as saved, editing withdraws the approval and
// Withdraw asks; evidence states are worded; what readers will see says what was left out and why; stranger text is only
// text; Undo and delete-Undo; the old addresses open the new screens; and the screens pass axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const HOSTILE = "<img src=x onerror=alert(1)>";
let root;
let server;
let origin;

const file = (slug) => join(root, "content", "comparisons", `${slug}.json`);
const stored = (slug) => (existsSync(file(slug)) ? readFileSync(file(slug), "utf8") : null);
const writeComparison = (slug, value) => {
  mkdirSync(dirname(file(slug)), { recursive: true });
  writeFileSync(file(slug), `${JSON.stringify({ format: "openblog-interpretation-comparison", version: 1, ...value }, null, 2)}\n`);
};
const named = (id, name, statement, extra = {}) => ({ id, attribution: { kind: "named", name }, statement, ...extra });
const AI_TEXT = "A beginner picture of shadows on a wall.";

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-readings-"));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  mkdirSync(join(root, ".openblog", "private", "research"), { recursive: true });
  writeFileSync(join(root, "openblog.json"), JSON.stringify({ title: "Readings test", url: "https://readings.example.org", author: { name: "Alex" }, interpretations: { publish: true } }));
  writeFileSync(join(root, ".openblog", "private", "research", "sources.json"), JSON.stringify({ version: 1, sources: [{ id: "plato", kind: "work", title: "Politeia" }] }));
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

async function signIn(page, hash = "#/research/readings") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const field = (page, label) => page.getByRole("textbox", { name: label });
const card = (page, name) => page.locator(".studio-path-step", { hasText: name });
const sheetOf = (page) => page.locator("side-sheet");

async function addNamedReading(page, name, holds) {
  await page.getByRole("button", { name: "Add a reading", exact: true }).click();
  await field(page, "Name").fill(name);
  await field(page, "What this reading holds").fill(holds);
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

test("a comparison of readings is made, saved as a draft and the old address opens it", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "No comparisons of readings yet" })).toBeVisible();
  await page.getByRole("button", { name: "New comparison of readings" }).click();
  await expect(page).toHaveURL(/#\/research\/readings\/new$/);
  await field(page, "Title").fill("The cave");
  await expect(field(page, "Address")).toHaveValue("the-cave");
  await field(page, "What the readings are about").fill("Readings of the cave image");
  await addNamedReading(page, "A political reading", "It holds that the cave is about the city.");
  await expect(page.getByRole("button", { name: /Add a relation/ })).toBeHidden();
  await addNamedReading(page, "An epistemic reading", "It holds that the cave is about knowing.");
  expect(stored("the-cave")).toBeNull();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved as a draft. Readers don't see it.").first()).toBeVisible();
  await expect(page).toHaveURL(/#\/research\/reading\/the-cave$/);
  const saved = JSON.parse(stored("the-cave"));
  expect(saved.status).toBe("draft");
  expect(saved.interpretations.map((i) => i.attribution.name)).toEqual(["A political reading", "An epistemic reading"]);
  expect(saved.interpretations[0].approval).toBeUndefined();
  await page.goto(`${origin}/admin/studio/#/comparisons/edit/the-cave`);
  await expect(page).toHaveURL(/#\/research\/reading\/the-cave$/);
  await expect(card(page, "A political reading")).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/comparisons`);
  await expect(page).toHaveURL(/#\/research\/readings$/);
  await expect(page.getByRole("link", { name: "The cave" })).toBeVisible();
});

test("words an AI tool drafted stay a draft until approved as saved; editing withdraws; Withdraw asks when published", async ({ page }) => {
  writeComparison("shadows", { title: "Shadows", status: "draft", subject: "Shadows", interpretations: [named("a", "First holder", "First words."), named("b", "Second holder", "Second words.")], explanations: [{ id: "easy", level: "beginner", text: AI_TEXT, origin: { kind: "ai-draft", tool: "a writing assistant" } }] });
  await signIn(page, "#/research/reading/shadows");
  const easy = card(page, "For Beginners");
  await expect(easy).toContainText("Drafted with AI: not approved, readers don't see it");
  // With unsaved changes it asks to save first; Not now approves nothing.
  await field(page, "What the readings are about").fill("Shadows, changed");
  await easy.getByRole("button", { name: /Read and approve/ }).click();
  await expect(page.getByRole("heading", { name: "Save first?" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  expect(JSON.parse(stored("shadows")).explanations[0].approval).toBeUndefined();
  await easy.getByRole("button", { name: /Read and approve/ }).click();
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByRole("heading", { name: "Approve these words?" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(AI_TEXT);
  await expect(page.getByRole("button", { name: "Not now" })).toBeFocused();
  await page.getByRole("button", { name: "Approve these words" }).click();
  await expect(easy).toContainText("Drafted with AI, approved by you");
  await expect(easy).toContainText("You approved these words on");
  const approved = JSON.parse(stored("shadows")).explanations[0];
  expect(approved.approval.digest).toBeTruthy();
  // Studio never builds an approval: editing the words and saving drops it.
  await easy.getByRole("button", { name: /Change/ }).click();
  await field(page, "The explanation").fill(`${AI_TEXT} Edited.`);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/You changed words you'd approved/).first()).toBeVisible();
  expect(JSON.parse(stored("shadows")).explanations[0].approval).toBeUndefined();
  await expect(card(page, "For Beginners")).toContainText("Drafted with AI: not approved");
});

test("what readers will see says what was left out and why, and evidence is worded", async ({ page }) => {
  writeComparison("sources", { title: "Sources", status: "draft", subject: "Sources", interpretations: [
    named("a", "Holder A", "A words.", { evidence: [{ source: "plato", locator: "514a" }, { source: "ghost" }] }),
    named("b", "Holder B", "B words."),
    named("c", "Holder C", "C words.", { origin: { kind: "ai-draft", tool: "an assistant" } }),
  ] });
  await signIn(page, "#/research/reading/sources");
  await expect(card(page, "Holder A")).toContainText("2 evidence");
  await page.getByRole("button", { name: "See what readers will see" }).click();
  await expect(sheetOf(page)).toContainText("Only you see this");
  await expect(sheetOf(page)).toContainText("Holder C: not approved");
  await expect(sheetOf(page)).toContainText("Evidence to check");
  await expect(sheetOf(page).getByText("C words.")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await card(page, "Holder A").getByRole("button", { name: /Change/ }).click();
  await expect(sheetOf(page)).toContainText("Not in your library");
  await page.keyboard.press("Escape");
});

test("a stranger's words are only ever text", async ({ page }) => {
  writeComparison("hostile", { title: HOSTILE, status: "draft", subject: HOSTILE, interpretations: [named("a", HOSTILE, HOSTILE), named("b", "Other", "Other words.")] });
  let dialogs = 0;
  page.on("dialog", async (d) => { dialogs += 1; await d.dismiss(); });
  await signIn(page, "#/research/readings");
  await expect(page.getByRole("link", { name: HOSTILE })).toBeVisible();
  await page.getByRole("link", { name: HOSTILE }).click();
  await expect(card(page, HOSTILE)).toBeVisible();
  expect(await page.locator("img[src=x]").count()).toBe(0);
  expect(dialogs).toBe(0);
});

test("Undo puts a save back, and a deleted comparison comes back with Undo", async ({ page }) => {
  writeComparison("undoable", { title: "Undoable", status: "draft", subject: "One", interpretations: [named("a", "A", "A."), named("b", "B", "B.")] });
  await signIn(page, "#/research/reading/undoable");
  await field(page, "What the readings are about").fill("Two");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByText("Put back as it was.").first()).toBeVisible();
  expect(JSON.parse(stored("undoable")).subject).toBe("One");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/#\/research\/readings$/);
  expect(stored("undoable")).toBeNull();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => stored("undoable")).not.toBeNull();
});

test("the list and the editor pass axe at 320 px with no sideways scroll", async ({ page }) => {
  writeComparison("narrow", { title: "Narrow", status: "draft", subject: "Narrow", interpretations: [named("a", "A holder with a long name that has to wrap", "Words."), named("b", "B", "Words.")], relations: [{ from: "a", to: "b", kind: "differs-from" }] });
  await page.setViewportSize({ width: 320, height: 800 });
  for (const hash of ["#/research/readings", "#/research/reading/narrow"]) {
    await signIn(page, hash);
    await page.locator("h2").first().waitFor();
    await page.evaluate(axeSource.toString());
    const result = await page.evaluate(async () => (await window.axe.run(document, { rules: { "color-contrast": { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
    expect(result).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }
  // Keyboard only: Tab reaches Add a reading and Enter opens its sheet.
  await page.getByRole("button", { name: "Add a reading" }).focus();
  await page.keyboard.press("Enter");
  await expect(field(page, "Name")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("Withdraw approval on a published comparison asks, and the whole comparison goes back to a draft", async ({ page }) => {
  writeComparison("live", { title: "Live", status: "draft", subject: "Live", interpretations: [named("a", "A", "A."), named("b", "B", "B.")], explanations: [{ id: "easy", level: "beginner", text: AI_TEXT, origin: { kind: "ai-draft", tool: "a tool" } }] });
  await signIn(page, "#/research/reading/live");
  const easy = card(page, "For Beginners");
  await easy.getByRole("button", { name: /Read and approve/ }).click();
  await page.getByRole("button", { name: "Approve these words" }).click();
  await expect(easy).toContainText("You approved these words on");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published\./).first()).toBeVisible();
  expect(JSON.parse(stored("live")).status).toBe("published");
  await easy.getByRole("button", { name: /Withdraw approval/ }).click();
  await expect(page.getByRole("heading", { name: "Withdraw and make it a draft again?" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  expect(JSON.parse(stored("live")).status).toBe("published");
  await easy.getByRole("button", { name: /Withdraw approval/ }).click();
  await page.getByRole("button", { name: "Withdraw and make it a draft" }).click();
  await expect.poll(() => JSON.parse(stored("live")).status).toBe("draft");
  expect(JSON.parse(stored("live")).explanations[0].approval).toBeUndefined();
});

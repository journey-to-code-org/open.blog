import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 3 (docs/specs/studio/slice-3/brief.md): Decorations reads today's look in words,
// puts a look up now and undoes it byte for byte, changes one season's last day without touching
// anything else in openblog.json, shows a look in a sandboxed preview, and passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-decorations-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "12-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
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

const config = () => readFileSync(join(root, "openblog.json"), "utf8");

async function signIn(page, hash = "#/decorations") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function labelOf(page, name) {
  const state = await page.evaluate(async () => (await fetch("/admin/api/seasons", { credentials: "same-origin" })).json());
  return state.themes.find((theme) => theme.name === name).label;
}

async function axeViolations(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }));
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("today's look is said in words, and the screen passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(/^Your blog (is|wears)/);
  await expect(page.getByRole("switch", { name: "Change by itself with the calendar" })).toBeChecked();
  const paper = await labelOf(page, "paper");
  await expect(page.getByRole("button", { name: new RegExp(`^Season 1 of 2: ${escape(paper)}, December 1 to January 6`) })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("put a look up now, then Undo gives back the identical file", async ({ page }) => {
  await signIn(page);
  const paper = await labelOf(page, "paper");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Find a post or something to do…").fill(`Put up ${paper}`);
  await expect(page.locator("command-palette .palette-option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Next year's dates don't change.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Put it up now" }).click();
  // "is up here." when the public site lives elsewhere and nothing sends it out (this test site).
  await expect(page.getByText(new RegExp(`^${escape(paper)} is up( here)?\\.`)).first()).toBeVisible();
  await expect.poll(config).toContain('"upNow": {\n      "theme": "paper",');
  expect(config().replace(/,\n    "upNow": \{\n[^}]*\}\n/, "\n")).toBe(original);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(config).toBe(original);
});

test("changing one season's last day changes only that value", async ({ page }) => {
  await signIn(page);
  const paper = await labelOf(page, "paper");
  await page.getByRole("button", { name: new RegExp(`^Season 1 of 2: ${escape(paper)}`) }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("group", { name: "Last day" }).getByRole("combobox", { name: "Day" }).selectOption("10");
  await sheet.getByRole("button", { name: "Use these dates" }).click();
  await expect(page.getByText("Not saved yet.", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect.poll(config).toBe(original.replace('"end": "01-06"', '"end": "01-10"'));
  writeFileSync(join(root, "openblog.json"), original);
});

test("turning the calendar off and on again leaves nothing to save", async ({ page }) => {
  await signIn(page);
  const toggle = page.getByRole("switch", { name: "Change by itself with the calendar" });
  await toggle.click();
  await expect(page.getByText("Not saved yet.", { exact: true })).toBeVisible();
  await toggle.click();
  await expect(page.getByText("Not saved yet.", { exact: true })).toBeHidden();
  expect(config()).toBe(original);
});

test("See how it looks shows a look in a sandboxed frame and writes nothing", async ({ page }) => {
  await signIn(page);
  const paper = await labelOf(page, "paper");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Find a post or something to do…").fill(`See how it looks in ${paper}`);
  await expect(page.locator("command-palette .palette-option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  const frame = page.locator("iframe.studio-preview-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(page.frameLocator("iframe.studio-preview-frame").locator("body")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Back to decorations" })).toBeFocused();
  expect(config()).toBe(original);
});

test("putting a look up keeps her unsaved calendar changes", async ({ page }) => {
  writeFileSync(join(root, "openblog.json"), original);
  await signIn(page);
  const paper = await labelOf(page, "paper");
  await page.getByRole("button", { name: new RegExp(`^Season 1 of 2: ${escape(paper)}`) }).focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect(page.getByText("Not saved yet.", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Find a post or something to do…").fill(`Put up ${paper}`);
  await expect(page.locator("command-palette .palette-option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Put it up now" }).click();
  await expect.poll(config).toContain('"upNow"');
  await expect(page.getByText("Not saved yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Season 2 of 2: ${escape(paper)}`) })).toBeVisible();
  expect(config().indexOf('"theme": "paper"')).toBeLessThan(config().indexOf('"theme": "demo"'));
  writeFileSync(join(root, "openblog.json"), original);
});

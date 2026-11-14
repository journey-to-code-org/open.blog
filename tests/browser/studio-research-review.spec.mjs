import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

// Research checks in Before you publish (Studio R7), ported from publication-review.spec.mjs:
// publishing a research post always opens the sheet; a citation the build would refuse blocks it
// and can't be marked as checked; an advisory finding never blocks, is marked as checked from the
// keyboard, stays listed and counted, and Undo takes the mark back; Show me goes to the line; a
// plain post publishes as before; 320 px and axe.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const LIBRARY = {
  version: 1,
  sources: [
    { id: "plato", kind: "work", title: "Politeia" },
    { id: "slings", kind: "edition", of: "plato", title: "Platonis Rempublicam", rights: { status: "publicDomain", note: "ob-private-rights-note" } },
  ],
};
const ATLAS = { version: 2, entries: [{ id: "plato-person", kind: "person", label: "Plato", visibility: "approved" }, { id: "the-good", kind: "concept", label: "ob-private-label The Good" }], relationships: [] };
const BODY = "## Abstract\n\nThe cave educates [@slings, page 514].\n\nSee [Plato](/atlas/plato-person/) and [the Good](/atlas/the-good/).\n\nAlso [@nobody].\n\n## References\n";
const POST = `---\ntitle: Cave\ndate: 2026-10-01\nprofile: research\ncitations: notes\ndraft: true\n---\n\n${BODY}`;
const FIXED = POST.replace("\n\nAlso [@nobody].", "");
let root;
let server;
let origin;

const research = (name) => join(root, ".openblog", "private", "research", name);
const post = (name) => join(root, "content", "posts", name);

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block", timezoneId: "America/New_York" });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-review-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  mkdirSync(dirname(research("sources.json")), { recursive: true });
  writeFileSync(research("sources.json"), JSON.stringify(LIBRARY));
  writeFileSync(research("notebook.json"), JSON.stringify({ version: 1, passages: [], notes: [] }));
  writeFileSync(research("atlas.json"), JSON.stringify(ATLAS));
  const config = JSON.parse(readFileSync(join(root, "openblog.json"), "utf8"));
  config.knowledgeAtlas = { publish: true };
  writeFileSync(join(root, "openblog.json"), JSON.stringify(config, null, 2));
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

test.beforeEach(({ page }) => {
  rmSync(research("acknowledgements.json"), { force: true });
  page.on("pageerror", (error) => { throw error; });
});

async function openPost(page, name, text) {
  writeFileSync(post(name), text);
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/#/write/${encodeURIComponent(`posts/${name}`)}`);
  const username = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

const ready = (page) => page.locator("side-sheet.studio-ready-sheet dialog").filter({ has: page.getByRole("heading", { name: "Before you publish", level: 2 }) }).first();
const checks = (page) => ready(page).locator("section.studio-review");
const publish = (page) => page.locator(".studio-write-bar").getByRole("button", { name: "Publish" });

test("a research post always opens the sheet; what the build refuses blocks and can't be marked", async ({ page }) => {
  await openPost(page, "cave.md", POST);
  await publish(page).click();
  await expect(ready(page)).toBeVisible();
  await expect(checks(page).getByRole("heading", { name: "Research checks" })).toBeVisible();
  await expect(checks(page)).toContainText("These are prompts from your research checks, not verdicts");
  const blocking = checks(page).locator(".studio-review-blocking");
  await expect(blocking.getByRole("heading", { name: /^Needs fixing before it can go up \(\d\)$/ })).toBeVisible();
  await expect(blocking).toContainText("This can't be marked as checked");
  await expect(blocking.getByRole("button", { name: /^Mark as checked/ })).toHaveCount(0);
  await expect(ready(page).locator(".studio-ready-status")).toContainText(/needs? fixing before your post can go up/);
  await expect(ready(page).locator("[slot=actions]").getByRole("button", { name: "Publish" })).toHaveAttribute("aria-disabled", "true");
  // Server words sit in <bdi>, as text.
  expect(await checks(page).locator("bdi").count()).toBeGreaterThan(0);
  expect(readFileSync(post("cave.md"), "utf8")).toContain("draft: true");
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(300);
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("side-sheet.studio-ready-sheet"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("an advisory finding is marked as checked from the keyboard, stays counted, and Undo takes it back", async ({ page }) => {
  await openPost(page, "cave2.md", FIXED);
  await publish(page).click();
  await expect(ready(page)).toBeVisible();
  const mark = checks(page).getByRole("button", { name: /^Mark as checked: / }).first();
  await expect(mark).toBeVisible({ timeout: 15000 });
  await expect(mark).toHaveAttribute("aria-pressed", "false");
  const counts = checks(page).locator(".studio-review-counts");
  const before = await counts.textContent();
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(mark).toHaveAttribute("aria-pressed", "true");
  await expect(ready(page).locator(".studio-ready-did")).toContainText("Marked as checked. It stays on the list and in the count.");
  await expect(counts).toContainText("(1 checked)");
  expect(await counts.textContent()).not.toBe(before);
  expect(existsSync(research("acknowledgements.json"))).toBe(true);
  await expect(checks(page).getByText("You marked this as checked. It stays on the list until it changes.")).toBeVisible();
  await ready(page).locator(".studio-ready-did").getByRole("button", { name: "Undo" }).click();
  await expect(mark).toHaveAttribute("aria-pressed", "false");
  await expect(counts).not.toContainText("checked)");
  // Nothing blocks: Publish from the sheet publishes.
  await ready(page).locator("[slot=actions]").getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => readFileSync(post("cave2.md"), "utf8")).not.toContain("draft: true");
});

test("Show me goes to the line in her words", async ({ page }) => {
  await openPost(page, "cave3.md", POST);
  await publish(page).click();
  const show = checks(page).getByRole("button", { name: /^Show me: In your words, near “Also @nobody\.”|^Show me: In your words, near “Also \[@nobody\]\.”/ }).first();
  await expect(show).toBeVisible({ timeout: 15000 });
  await show.click();
  await expect(ready(page)).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const box = document.activeElement;
    return box && "selectionStart" in box ? box.value.slice(box.selectionStart, box.selectionEnd) : "";
  })).toBe("Also [@nobody].");
});

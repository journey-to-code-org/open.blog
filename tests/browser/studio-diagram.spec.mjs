import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// A diagram in Studio (#646): Add something › A diagram (the details layer) starts from an
// example, is drawn by the server with the build's renderer and shown as a picture the page made,
// refuses one the build would refuse, says why by its box, and is a card Change can open again.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg==", "base64");
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-diagram-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "static", "images", "uploads", "2026"), { recursive: true });
  for (const name of ["dough.png", "loaf.png"]) writeFileSync(join(dir, "static", "images", "uploads", "2026", name), PNG);
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
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
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

const front = (title) => `---\ntitle: ${title}\ndate: 2026-01-01\ndraft: true\n---\n`;
const fileOf = (name) => readFileSync(join(dir, "content", "posts", `${name}.md`), "utf8");

async function openPost(page, name, text, query = "") {
  writeFileSync(join(dir, "content", "posts", `${name}.md`), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${name}.md`)}${query}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

async function axeClean(page, label, root = "side-sheet.studio-add-sheet") {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  expect(await page.evaluate((selector) => { const body = document.querySelector(selector)?.querySelector(".sheet-body, dialog"); return body ? body.scrollWidth > body.clientWidth + 1 : false; }, root), `${label}: the sheet scrolls sideways`).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

async function addFromWords(page) {
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.getByRole("dialog", { name: "Add something" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function diagramForm(page) {
  const sheet = await addFromWords(page);
  const details = sheet.locator("details.studio-add-details");
  if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click();
  await sheet.getByRole("button", { name: "A diagram", exact: true }).click();
  const form = page.getByRole("dialog", { name: "A diagram" });
  await expect(form).toBeVisible();
  return form;
}

test("a diagram from an example: drawn as a picture, added as a card, written as a mermaid fence, changed again", async ({ page }) => {
  await openPost(page, "flow", `${front("Flow")}\nHow the pieces talk.\n`);
  const form = await diagramForm(page);
  // Nothing filled in: each box says what it needs, and nothing goes in.
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Say what it shows, or write accDescr: in the diagram.")).toBeVisible();
  await form.getByRole("combobox", { name: "Start from an example" }).selectOption("system-design");
  await expect(form.getByRole("textbox", { name: "The diagram" })).toHaveValue(/accTitle: Example system design/);
  const drawn = page.waitForResponse((r) => r.url().endsWith("/admin/api/diagram/preview"));
  await form.getByRole("button", { name: "Draw it" }).click();
  expect((await drawn).status()).toBe(200);
  const picture = form.locator("img.studio-diagram-picture");
  await expect(picture).toHaveAttribute("alt", "Example system design: A client connects to an API that reads a database.");
  await expect(picture).toHaveAttribute("src", /^blob:/);
  // The drawing is never placed as markup in the page.
  expect(await form.locator("svg").count()).toBe(0);
  await form.getByRole("textbox", { name: "Words under it" }).fill("Where a request goes");
  await axeClean(page, "the diagram form");
  await form.getByRole("button", { name: "Add it" }).click();
  const card = page.getByRole("group", { name: "Diagram: Example system design" });
  await expect(card).toBeVisible();
  await expect.poll(() => fileOf("flow")).toContain('```mermaid caption="Where a request goes"\nflowchart LR\n  accTitle: Example system design\n');
  // Change opens the same form, filled in; a source the build refuses is said, and nothing changes.
  await card.getByRole("button", { name: /^Change/ }).click();
  const change = page.getByRole("dialog", { name: "A diagram" });
  await expect(change.getByRole("textbox", { name: "Words under it" })).toHaveValue("Where a request goes");
  await change.getByRole("textbox", { name: "The diagram" }).fill("flowchart LR\n  accTitle: Broken\n  accDescr: It does not parse.\n  A -->");
  await change.getByRole("button", { name: "Done" }).click();
  await expect(change.getByText(/^It can't be drawn: /)).toBeVisible();
  await expect.poll(() => fileOf("flow")).toContain("Client --> API");
});

test("A diagram waits for a signal and keeps what was typed", async ({ page }) => {
  await openPost(page, "offline", `${front("Offline")}\nWords.\n`);
  const form = await diagramForm(page);
  await form.getByRole("textbox", { name: "The diagram" }).fill("flowchart LR\n  A --> B");
  await form.getByRole("textbox", { name: "Title" }).fill("Two steps");
  await form.getByRole("textbox", { name: "What it shows" }).fill("A leads to B.");
  await page.route("**/admin/api/diagram/preview", (route) => route.abort("internetdisconnected"));
  await form.getByRole("button", { name: "Draw it" }).click();
  await expect(form.getByText("Drawing it needs a signal. Your diagram is kept in the form.")).toBeVisible();
  await page.unroute("**/admin/api/diagram/preview");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Diagram: Two steps" })).toBeVisible();
  await expect.poll(() => fileOf("offline")).toContain('```mermaid title="Two steps" description="A leads to B."\nflowchart LR\n  A --> B\n```');
});

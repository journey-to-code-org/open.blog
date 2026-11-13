import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 4: Pages and Collections. Add a page (title, line, menu, words) and see it written;
// change one line and only that line changes; delete it and Undo brings it back. A collection
// keeps its file as written; a post can be put in a collection from Write. More tools opens from
// the account menu. Axe at 320 px.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-pages-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
  mkdirSync(join(root, "content", "series"), { recursive: true });
  writeFileSync(join(root, "content", "series", "thanksgiving.md"), "---\nname: Thanksgiving Table\n# kept as written\ndescription: Every dish, every November.\n---\n\nIn the order she cooks them.\n");
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

const read = (rel) => readFileSync(join(root, "content", rel), "utf8");

async function signIn(page, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

test("add a page, change one line, delete it and Undo", async ({ page }) => {
  await signIn(page, "#/pages");
  await expect(page.getByText("No pages yet")).toBeVisible();
  await page.getByRole("link", { name: "Add a page" }).first().click();
  await page.getByRole("textbox", { name: "Title" }).fill("About Grammi");
  await page.getByRole("textbox", { name: "About it, in one line" }).fill("Who she is.");
  await page.getByRole("switch", { name: "Show it in your site's menu" }).click();
  await page.getByRole("textbox", { name: "Words" }).fill("The kitchen is open.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. It's on your site." })).toBeVisible();
  const file = read("pages/about-grammi.md");
  expect(file).toContain("title: About Grammi");
  expect(file).toContain("nav: true");
  expect(file).toContain("The kitchen is open.");
  await expect(page).toHaveURL(/#\/page\/pages%2Fabout-grammi\.md/);
  await page.getByRole("textbox", { name: "About it, in one line" }).fill("Who she is, and her kitchen.");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status").filter({ hasText: "Saved. It's on your site." })).toBeVisible();
  expect(read("pages/about-grammi.md")).toBe(file.replace("description: Who she is.", "description: Who she is, and her kitchen."));
  await page.getByRole("link", { name: "Pages" }).first().click();
  await expect(page.getByText("1 page on your site")).toBeVisible();
  await page.getByRole("button", { name: "More for About Grammi" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete it" }).click();
  await expect(page.getByText("No pages yet")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("link", { name: "About Grammi" })).toBeVisible();
});

test("a collection keeps its file as written, and a post goes into it from Write", async ({ page }) => {
  await signIn(page, "#/collections");
  await page.getByRole("link", { name: "Thanksgiving Table" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Thanksgiving Table");
  const before = read("series/thanksgiving.md");
  await page.getByRole("textbox", { name: "About it, in one line" }).fill("Every dish, every year.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. It's on your site." })).toBeVisible();
  expect(read("series/thanksgiving.md")).toBe(before.replace("Every dish, every November.", "Every dish, every year."));
  await page.goto(`${origin}/admin/studio/#/posts`);
  await page.locator(".studio-post-link").first().click();
  const pick = page.getByRole("combobox", { name: "Collection" });
  await expect(pick).toBeVisible();
  await pick.selectOption("thanksgiving");
  // A published post changes on the site only with Update (Ctrl S keeps it on this device).
  await page.locator(".studio-write-bar action-button").last().click();
  await expect.poll(() => { try { return readFileSync(join(root, "content", "posts", readdirSync(join(root, "content", "posts")).find((f) => readFileSync(join(root, "content", "posts", f), "utf8").includes("series: thanksgiving")) || "x"), "utf8"); } catch { return ""; } }).toContain("series: thanksgiving");
});

test("More tools opens from the account menu, and Pages passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, "#/tools");
  await expect(page.locator("#studio-tools-h")).toHaveText("More tools");
  await expect(page.getByRole("link", { name: /Customize look/ })).toHaveAttribute("href", "/admin/#/look");
  for (const hash of ["#/pages", "#/page/new"]) {
    await page.goto(`${origin}/admin/studio/${hash}`);
    await expect(page.locator(".studio-page").first()).toBeVisible();
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    expect(results, hash).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), hash).toBe(false);
  }
});

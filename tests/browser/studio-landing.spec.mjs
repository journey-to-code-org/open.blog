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

// Studio slice 6: Front page. Start from a layout, change a section in the side sheet, add the
// theme's own piece (a little tree with a choice setting), move it, hide it, remove it and Undo,
// Save (content/landing.json), see it, and bring back an earlier version. Axe at 320 px.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-landing-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
  mkdirSync(join(root, "themes", "toyland"), { recursive: true });
  writeFileSync(join(root, "themes", "toyland", "tree.js"), "customElements.define('little-tree', class extends HTMLElement {});\n");
  writeFileSync(join(root, "themes", "toyland", "theme.json"), JSON.stringify({
    label: "Toyland", extends: "paper",
    components: { "little-tree": { label: "Little tree", description: "A tree you decorate.", script: "tree.js", fallback: "A little tree.",
      props: [{ name: "topper", type: "choice", label: "On top", default: "star", choices: [{ value: "star", label: "A star" }, { value: "bow", label: "A bow" }] }] } },
  }));
  // The theme's own things are offered when every look the site wears has them: one look here.
  writeFileSync(configPath, text.replace(/^\{/, '{\n  "theme": "toyland",'));
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

const landing = () => JSON.parse(readFileSync(join(root, "content", "landing.json"), "utf8"));

async function signIn(page) {
  await page.goto(`${origin}/admin/studio/#/front-page`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.locator("#studio-landing-h")).toBeVisible();
}

test("build a front page: a layout, a change, the theme's tree, move, hide, remove and Undo, save", async ({ page }) => {
  await signIn(page);
  const rows = page.locator(".studio-landing-row");
  if (!(await rows.filter({ hasText: "Welcome banner" }).count())) {
    if (!(await rows.count())) await page.getByRole("button", { name: "Welcome", exact: true }).click();
    else {
      await page.getByRole("button", { name: "Add a section" }).click();
      await page.locator("side-sheet").getByRole("button", { name: /Welcome banner/ }).click();
      await page.locator("side-sheet").getByRole("button", { name: "Done" }).click();
    }
  }
  const first = rows.filter({ hasText: "Welcome banner" }).first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: /^Change / }).click();
  const sheet = page.locator("side-sheet");
  await sheet.getByRole("textbox", { name: "Welcome heading" }).fill("Welcome to Toyland");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Welcome banner changed. Not saved yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add a section" }).click();
  await sheet.getByRole("button", { name: /Little tree/ }).click();
  await sheet.getByRole("combobox", { name: "On top" }).selectOption("bow");
  await sheet.getByRole("button", { name: "Done" }).click();
  const tree = rows.filter({ hasText: "Little tree" });
  await expect(tree).toBeVisible();
  await tree.getByRole("button", { name: /More for Little tree/ }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(page.getByText(/Little tree is number \d+ of \d+ now/)).toBeVisible();
  await tree.getByRole("button", { name: /More for Little tree/ }).click();
  await page.getByRole("menuitem", { name: "Hide it for now" }).click();
  await expect(tree.getByText("Hidden")).toBeVisible();
  const count = await rows.count();
  await first.getByRole("button", { name: /More for/ }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(rows).toHaveCount(count - 1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(count);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("toast-region")).toContainText(/Saved|site/);
  const saved = landing();
  const treeSection = saved.sections.find((s) => s.type === "component");
  expect(treeSection).toMatchObject({ tag: "little-tree", hidden: true, props: { topper: "bow" } });
  expect(saved.sections.find((s) => s.type === "welcome").heading).toBe("Welcome to Toyland");
  const preview = page.waitForResponse((r) => r.url().endsWith("/admin/api/landing/preview"));
  await page.getByRole("button", { name: "See how it looks" }).click();
  expect((await preview).status()).toBe(200);
  await page.getByRole("button", { name: "Back to your front page" }).click();
});

test("an earlier version comes back, and the front page passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page);
  const before = landing();
  const first = page.locator(".studio-landing-row").filter({ hasText: "Welcome banner" }).first();
  await first.getByRole("button", { name: /^Change / }).click();
  await page.locator("side-sheet").getByRole("textbox", { name: "Welcome heading" }).fill("A second heading");
  await page.locator("side-sheet").getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => landing().sections.find((s) => s.type === "welcome").heading).toBe("A second heading");
  await page.getByText("Earlier versions").click();
  await page.getByRole("button", { name: /Bring this back/ }).first().click();
  await expect.poll(() => landing().sections.find((s) => s.type === "welcome").heading).toBe(before.sections.find((s) => s.type === "welcome").heading);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

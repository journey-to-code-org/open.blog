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

// Studio slice 7: Look. Choose a ready-made look, a main color, a text size and the dark button;
// Save writes only appearance and colorSchemeToggle; back to the theme's own leaves every other
// setting as it was; the preview answers; axe at 320 px.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-look-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
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

async function signIn(page) {
  await page.goto(`${origin}/admin/studio/#/look`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.locator("#studio-look-h")).toBeVisible();
}

test("choose a look, a color, a size and the dark button; save; then back to the theme's own", async ({ page }) => {
  await signIn(page);
  const before = config();
  const looks = page.getByRole("combobox", { name: "Looks" });
  await looks.selectOption({ index: 2 });
  await page.getByRole("button", { name: "Teal" }).click();
  await expect(page.getByText("Chosen: Teal.")).toBeVisible();
  await page.getByRole("combobox", { name: "Text size" }).selectOption("large");
  await page.getByRole("combobox", { name: "A light and dark button for readers" }).selectOption("no");
  const preview = page.waitForResponse((r) => r.url().endsWith("/admin/api/look/preview"));
  await page.getByRole("button", { name: "See how it looks" }).click();
  expect((await preview).status()).toBe(200);
  await page.getByRole("button", { name: "Back to how your site looks" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect.poll(() => JSON.parse(config()).appearance?.textSize).toBe("large");
  await expect.poll(() => JSON.parse(config()).colorSchemeToggle, { timeout: 30000 }).toBe(false);
  const saved = JSON.parse(config());
  expect(saved.appearance.accent).toBe("#0f766e");
  expect(saved.colorSchemeToggle).toBe(false);
  const was = JSON.parse(before);
  for (const key of Object.keys(was)) if (key !== "appearance" && key !== "colorSchemeToggle") expect(saved[key], key).toEqual(was[key]);
  await page.getByRole("button", { name: "Use the theme's own for everything" }).click();
  await page.getByRole("combobox", { name: "A light and dark button for readers" }).selectOption("theme");
  await page.getByRole("button", { name: "Save" }).click();
  // Everything as it was: no look, and the button back to the theme's say (a null line is kept as
  // written, the same as no line).
  await expect.poll(() => JSON.parse(config()).appearance).toBeUndefined();
  // The dark-mode save comes second and may wait for the first save's send-out to free the lock.
  await expect.poll(() => JSON.parse(config()).colorSchemeToggle ?? null, { timeout: 30000 }).toBe(null);
  const back = JSON.parse(config());
  delete back.colorSchemeToggle;
  const original = JSON.parse(before);
  delete original.colorSchemeToggle;
  expect(back).toEqual(original);
});

test("Look passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

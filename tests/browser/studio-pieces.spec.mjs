import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 3b (docs/specs/studio/slice-3b/brief.md): "What's hanging" takes one decoration
// down and puts it back byte for byte, swaps a garland for another version, previews it, and passes
// axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-pieces-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "festive",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
  mkdirSync(join(root, "themes", "festive"), { recursive: true });
  writeFileSync(join(root, "themes", "festive", "theme.json"), JSON.stringify({
    label: "Festive", extends: "paper",
    tokens: { decorGarland: "url(g.svg)", ghSnow: "on" },
    decorations: {
      garland: { label: "Garland", tokens: ["decorGarland"], off: { decorGarland: "none" },
        variants: { toyshelf: { label: "From the toy shelf", tokens: { decorGarland: "url(toys.svg)" } } } },
      snow: { label: "Snow", tokens: ["ghSnow"], off: { ghSnow: "none" } },
    },
  }, null, 2));
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
  await page.goto(`${origin}/admin/studio/#/decorations`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "What's hanging" })).toBeVisible();
}

test("taking the snow down and putting it back leaves openblog.json as it was", async ({ page }) => {
  await signIn(page);
  const before = config();
  const hanging = page.getByRole("region", { name: "What's hanging" });
  await hanging.getByRole("switch", { name: /Snow/ }).click();
  await expect(hanging.getByRole("status")).toContainText("Snow is down.");
  expect(config()).toContain('"snow": false');
  await hanging.getByRole("button", { name: "Put it back" }).click();
  await expect(hanging.getByRole("status")).toContainText("Snow is up.");
  expect(config()).toBe(before);
});

test("choosing another garland saves it, and the preview wears it", async ({ page }) => {
  await signIn(page);
  const hanging = page.getByRole("region", { name: "What's hanging" });
  await hanging.getByRole("combobox", { name: "Which garland" }).selectOption("toyshelf", { timeout: 8000 });
  await expect(hanging.getByRole("status")).toContainText("from the toy shelf");
  expect(config()).toContain('"garland": "toyshelf"');
  const preview = page.waitForResponse((r) => r.url().endsWith("/admin/api/decorations/preview"), { timeout: 10000 });
  await hanging.getByRole("button", { name: /^See how Festive looks/ }).click({ timeout: 8000 });
  expect((await preview).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Back to decorations" })).toBeVisible();
  await page.getByRole("button", { name: "Back to decorations" }).click({ timeout: 8000 });
  // Leave it as it came for the next test.
  await hanging.getByRole("combobox", { name: "Which garland" }).selectOption("_usual", { timeout: 8000 });
  await expect(hanging.getByRole("status")).toContainText("Garland is up.");
});

test("What's hanging passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector(".studio-deco-hanging"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Admin on a new site at phone width: the Simple workspace shows what a personal blog needs,
// keeps the rest reachable, and leaves the buttons a recipe needs on screen (#559).

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let parent;
let server;
let origin;

test.use({ viewport: { width: 375, height: 800 } });

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-simple-"));
  const root = join(parent, "site");
  execFileSync(binary, ["init", root, "--no-voice"], { stdio: "pipe" });
  execFileSync(binary, ["user", "add", "writer", "--root", root], {
    env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe",
  });
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
    expect((await fetch(`${origin}/admin/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(parent);
});

async function signIn(page) {
  await page.goto(`${origin}/admin/`);
  await page.getByLabel("Username", { exact: true }).fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-action="logout"]')).toBeVisible();
}

const navigation = (page) => page.getByRole("navigation", { name: "Admin tools" });
const onScreen = async (locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
};

test("a new owner sees only the essentials, and the rest is one step away", async ({ page }) => {
  await signIn(page);
  await expect(navigation(page).getByRole("link")).toHaveText(["Overview", "Posts", "Pages", "Landing page", "Customize look", "Seasons", "Design a theme"]);
  await expect(page.locator("[data-voice-invitation]")).toHaveCount(0);
  await expect(page.getByText("Not a git repository")).toHaveCount(0);
  await onScreen(navigation(page).getByRole("link", { name: "Customize look" }));
  const recipe = await page.getByRole("link", { name: /New recipe/ }).boundingBox();
  expect(recipe.y + recipe.height).toBeLessThanOrEqual(800);

  await page.getByRole("button", { name: "Advanced tools" }).click();
  await page.locator("[data-simple-pages]").getByRole("button", { name: "Reading paths" }).click();
  await expect(page).toHaveURL(/#\/paths$/);
  await expect(navigation(page).getByRole("link", { name: "Reading paths" })).toBeVisible();
});

test("the editor leads with writing and keeps list buttons on screen", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/new/recipe`);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture research" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /knowledge check/ })).toHaveCount(0);
  const toolbar = page.locator(".oba-format-toolbar");
  await onScreen(toolbar.getByRole("button", { name: /Bullet/ }));
  await onScreen(toolbar.getByRole("button", { name: /Number/ }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(toolbar.getByRole("button", { name: "Cite a source" })).toBeHidden();
  await expect(toolbar.getByRole("button", { name: "Abstract" })).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#oba-profile").selectOption("research");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(toolbar.getByRole("button", { name: "Cite a source" })).toBeVisible();
});

test("a block card keeps its buttons readable on a phone", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/new/posts`);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown", exact: true }).fill("> [!TIP]\n> Use ripe lemons.\n");
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  const remove = page.locator(".oba-protected-block").getByRole("button", { name: /Remove/ });
  await expect(remove).toBeVisible();
  const box = await remove.boundingBox();
  expect(box.width).toBeGreaterThan(box.height);
  await onScreen(remove);
});

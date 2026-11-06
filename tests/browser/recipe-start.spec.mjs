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

// The real Admin at phone width: someone who has never heard of Markdown starts a recipe, and is told
// in everyday words what it still needs (#555, #556).

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let parent;
let server;
let origin;

test.use({ viewport: { width: 375, height: 800 } });

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-recipe-start-"));
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
  await expect(page.getByRole("link", { name: /New recipe/ })).toBeVisible();
}

const visual = (page) => page.getByRole("textbox", { name: "Visual editor" });
const view = (page, name) => page.getByRole("button", { name, exact: true });

test("New recipe opens a laid-out recipe whose sample becomes a real recipe", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /New recipe/ }).click();
  await expect(visual(page).getByRole("heading", { name: "Ingredients" })).toBeVisible();
  await expect(visual(page).getByRole("heading", { name: "Steps" })).toBeVisible();
  await expect(visual(page).getByText("2 cups flour")).toBeVisible();

  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Lemon cake");
  await view(page, "Settings").click();
  await expect(page.locator("#oba-profile")).toHaveValue("recipe");

  await view(page, "Site preview").click();
  const frame = page.frameLocator("iframe").first();
  await expect(frame.getByRole("heading", { name: "Lemon cake" }).first()).toBeVisible();
  await expect(frame.locator("ob-recipe")).toHaveCount(1);
  await expect(frame.getByText("2 cups flour").first()).toBeVisible();
});

test("typing over a triple-clicked sample line replaces only that line", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /New recipe/ }).click();
  await visual(page).getByText("2 cups flour").click({ clickCount: 3 });
  await page.keyboard.type("3 lemons");
  await expect(visual(page).locator("li").nth(0)).toHaveText("3 lemons");
  await expect(visual(page).locator("li").nth(1)).toHaveText("1 tsp salt");

  await visual(page).getByText("1 1/2 cups milk").click({ clickCount: 3 });
  await page.keyboard.type("1 cup sugar");
  await expect(visual(page).locator("li").nth(2)).toHaveText("1 cup sugar");
  await expect(visual(page).getByRole("heading", { name: "Steps" })).toBeVisible();
});

test("choosing Recipe fills an empty post and never touches written text", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/new/posts`);
  await view(page, "Settings").click();
  await page.locator("#oba-profile").selectOption("recipe");
  await expect(page.getByText("Sample sections were added in Write")).toBeVisible();
  await view(page, "Write").click();
  await expect(visual(page).getByRole("heading", { name: "Ingredients" })).toBeVisible();

  await page.goto(`${origin}/admin/`);
  await page.goto(`${origin}/admin/#/new/posts`);
  await page.reload();
  await expect(visual(page)).toBeVisible();
  await visual(page).click();
  await page.keyboard.type("Nana's cake is the best.");
  await view(page, "Settings").click();
  await page.locator("#oba-profile").selectOption("recipe");
  await expect(page.getByText("Sample sections were added in Write")).toHaveCount(0);
  await view(page, "Write").click();
  await expect(visual(page)).toHaveText(/^\s*Nana's cake is the best\.\s*$/);
});

test("a recipe with no lists is told what to do in everyday words", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/new/posts`);
  await expect(visual(page)).toBeVisible();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Plain cake");
  await visual(page).click();
  await page.keyboard.type("Flour and eggs. Bake it.");
  await view(page, "Settings").click();
  await page.locator("#oba-profile").selectOption("recipe");
  await view(page, "Site preview").click();

  const advice = page.locator("[data-recipe-advice]");
  await expect(advice).toContainText("make a heading called Ingredients");
  await expect(advice).toContainText("make a heading called Steps");
  await expect(advice).toContainText("Upload cover");
  const notice = advice.locator("..");
  await expect(notice).not.toContainText("## Ingredients");

  const site = page.locator("[data-site-warnings]");
  await expect(site.getByText("author.name")).toBeHidden();
  await site.locator("summary").click();
  await expect(site.getByText("author.name")).toBeVisible();
});

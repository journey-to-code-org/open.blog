import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 2 (docs/specs/studio/slice-2/brief.md): recipe boxes that keep the file as written,
// photos, See how it looks, take it off my site, delete with Undo, and a new recipe from Home.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const PIE = "---\ntitle: Grammi's Pumpkin Pie\ndate: 2026-11-06\ndraft: true\nseries: thanksgiving\nprofile: recipe\nservings: 8\nprep: 15 min\ncook: 45 min\ntags: [thanksgiving]\ncover: \"\"\n---\n\n\nMama taught me this one.\n\n## Ingredients\n\n- 1 can pumpkin\n- 2 eggs\n- 1 cup sugar\n\n## Steps\n\n1. Heat the oven to 425.\n2. Mix it all.\n3. Bake for 45 minutes.\n\n## Grammi's notes\n\nLet it cool before slicing.\n";
const PIE_REL = "posts/2026-11-06-pumpkin-pie.md";
// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-recipes-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  writeFileSync(join(root, "content", PIE_REL), PIE);
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

async function signIn(page, hash = "") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

async function axeViolations(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }));
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const pie = () => readFileSync(join(root, "content", PIE_REL), "utf8");
const openPie = async (page) => {
  await signIn(page, `#/write/${encodeURIComponent(PIE_REL)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Grammi's Pumpkin Pie");
};
const menuChoice = async (page, trigger, item) => {
  await trigger.click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};

test("the recipe boxes change only the lines she changed", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  await openPie(page);
  await expect(page.getByRole("textbox", { name: "Ingredient 2 of 3" })).toHaveValue("2 eggs");
  await expect(page.getByRole("textbox", { name: "Serves", exact: true })).toHaveValue("8");
  await page.getByRole("textbox", { name: "Ingredient 2 of 3" }).fill("3 eggs");
  await page.getByRole("textbox", { name: "Serves", exact: true }).fill("10");
  // Move step 3 up, from its menu.
  await menuChoice(page, page.getByRole("button", { name: "Move or remove step 3" }), "Move up");
  await expect(page.getByRole("textbox", { name: "Step 2 of 3" })).toHaveValue("Bake for 45 minutes.");
  await expect(page.getByText("Draft · saved", { exact: false })).toBeVisible({ timeout: 10000 });
  const expected = PIE.replace("- 2 eggs", "- 3 eggs").replace("servings: 8", "servings: 10")
    .replace("2. Mix it all.\n3. Bake for 45 minutes.", "2. Bake for 45 minutes.\n3. Mix it all.");
  expect(pie()).toBe(expected);
  writeFileSync(join(root, "content", PIE_REL), PIE);
});

test("Enter adds an ingredient and keys move it, announced", async ({ page }) => {
  await openPie(page);
  const third = page.getByRole("textbox", { name: "Ingredient 3 of 3" });
  await third.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Ingredient 4 of 4" })).toBeFocused();
  await page.keyboard.type("1 tsp cinnamon");
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect(page.getByRole("textbox", { name: "Ingredient 3 of 4" })).toHaveValue("1 tsp cinnamon");
  await expect(page.getByText("Moved to ingredient 3 of 4.")).toBeAttached();
  await page.keyboard.press("Control+s");
  await expect.poll(pie).toContain("- 2 eggs\n- 1 tsp cinnamon\n- 1 cup sugar\n");
  writeFileSync(join(root, "content", PIE_REL), PIE);
});

test("a photo goes into her story with its description", async ({ page }) => {
  await openPie(page);
  await page.getByRole("button", { name: "Put a photo in" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Put a photo in" });
  await dialog.locator("input[type=file]").setInputFiles({ name: "pie-cooling.png", mimeType: "image/png", buffer: PNG });
  await dialog.getByRole("button", { name: "Put it in" }).click();
  await expect(dialog.getByText("Describe the photo first")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Describe the photo" }).fill("Pie cooling on the windowsill");
  await dialog.getByRole("button", { name: "Put it in" }).click();
  await expect(page.getByRole("textbox", { name: "Your story" })).toHaveValue(/Mama taught me this one\.\n\n!\[Pie cooling on the windowsill\]\(\/images\/uploads\/.+\.png\)/);
  await page.keyboard.press("Control+s");
  await expect.poll(pie).toMatch(/Mama taught me this one\.\n\n!\[Pie cooling on the windowsill\]\(\/images\/uploads\/[^)]+\)\n\n## Ingredients/);
  writeFileSync(join(root, "content", PIE_REL), PIE);
});

test("Pictures lists photos and adds more", async ({ page }) => {
  await signIn(page, "#/pictures");
  await expect(page.getByRole("heading", { name: "Pictures", level: 2 })).toBeAttached();
  await page.locator("file-drop input[type=file]").first().setInputFiles([{ name: "first.png", mimeType: "image/png", buffer: PNG }, { name: "second.png", mimeType: "image/png", buffer: PNG }]);
  await expect(page.getByText("Added 2 photos.")).toBeVisible();
  await expect(page.getByRole("button", { name: "second", exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("See how it looks shows the recipe in a sandboxed frame and publishes nothing", async ({ page }) => {
  await openPie(page);
  await page.getByRole("button", { name: "See how it looks" }).click();
  const frame = page.locator("iframe.studio-preview-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const inner = page.frameLocator("iframe.studio-preview-frame");
  await expect(inner.locator("li", { hasText: "1 can pumpkin" }).first()).toBeVisible({ timeout: 30000 });
  await expect(inner.getByText("Bake for 45 minutes").first()).toBeVisible();
  expect(pie()).toBe(PIE);
  await page.getByRole("button", { name: "Back to writing" }).click();
});

test("publish, take it off her site, and the draft line is all that changes", async ({ page }) => {
  await openPie(page);
  await page.keyboard.press("Control+Enter");
  await expect.poll(pie).toBe(PIE.replace("draft: true\n", ""));
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  await menuChoice(page, page.getByRole("button", { name: "More", exact: true }), "Take it off my site");
  await page.getByRole("dialog").getByRole("button", { name: "Take it off my site" }).click();
  await expect(page.getByText(/It's a draft again/)).toBeVisible();
  expect(pie()).toContain("\ndraft: true\n");
  expect(pie().replace("draft: true\n", "")).toBe(PIE.replace("draft: true\n", ""));
  writeFileSync(join(root, "content", PIE_REL), PIE);
});

test("delete a draft from Posts, then Undo brings back the identical file", async ({ page }) => {
  const rel = "posts/2026-11-12-pumpkin-bread.md";
  const text = "---\ntitle: Pumpkin bread\ndraft: true\n---\nTwo loaves.\n";
  writeFileSync(join(root, "content", rel), text);
  await signIn(page, "#/posts");
  await menuChoice(page, page.getByRole("button", { name: "More for Pumpkin bread" }), "Delete");
  await expect(page.getByText("Deleted “Pumpkin bread”.")).toBeVisible();
  expect(existsSync(join(root, "content", rel))).toBe(false);
  await expect(page.getByRole("button", { name: "Undo" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("“Pumpkin bread” is back.")).toBeVisible();
  expect(readFileSync(join(root, "content", rel), "utf8")).toBe(text);
});

test("a new recipe starts from Home with empty boxes", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Write something new" }).first().click();
  await expect(page.getByRole("heading", { name: "What are you writing?" })).toBeVisible();
  await page.getByRole("link", { name: /A recipe/ }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Ingredient 1 of 1" })).toHaveValue("");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Sweet potato pie");
  await page.getByRole("textbox", { name: "Ingredient 1 of 1" }).fill("3 sweet potatoes");
  await expect(page).toHaveURL(/#\/write\/posts%2F.*sweet-potato-pie/, { timeout: 10000 });
  const file = readdirSync(join(root, "content", "posts")).find((name) => name.includes("sweet-potato-pie"));
  const text = readFileSync(join(root, "content", "posts", file), "utf8");
  expect(text).toContain("profile: recipe");
  expect(text).toContain("## Ingredients\n\n- 3 sweet potatoes");
  expect(await axeViolations(page)).toEqual([]);
});

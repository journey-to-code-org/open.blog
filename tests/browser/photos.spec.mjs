import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Admin at phone width: a large photo is added without a thought for its size, shown as a picture,
// and used again wherever a picture is asked for (#558).

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let parent;
let root;
let server;
let origin;

test.use({ viewport: { width: 375, height: 800 } });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-photos-"));
  root = join(parent, "site");
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

/** A noisy 4000 by 3000 JPEG made in the page: heavy, as a phone's photo is. */
async function largePhoto(page, name) {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(4000, 3000);
    for (let at = 0; at < pixels.data.length; at += 4) {
      const noise = Math.random() * 90;
      pixels.data[at] = 120 + noise;
      pixels.data[at + 1] = 90 + noise;
      pixels.data[at + 2] = 40 + noise;
      pixels.data[at + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.98));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (let at = 0; at < bytes.length; at += 32768) text += String.fromCharCode(...bytes.subarray(at, at + 32768));
    return btoa(text);
  });
  return { name, mimeType: "image/jpeg", buffer: Buffer.from(encoded, "base64") };
}

const picker = (page) => page.locator("[data-photo-picker]");
const view = (page, name) => page.getByRole("button", { name, exact: true });

async function fitsThePhone(page) {
  const overflow = await page.evaluate(() => {
    const dialog = document.querySelector("[data-photo-picker]");
    const box = dialog.getBoundingClientRect();
    return { left: box.left, right: box.right, inner: innerWidth, scroll: dialog.scrollWidth - dialog.clientWidth };
  });
  expect(overflow.left).toBeGreaterThanOrEqual(0);
  expect(overflow.right).toBeLessThanOrEqual(overflow.inner);
  expect(overflow.scroll).toBeLessThanOrEqual(0);
}

test("a large photo becomes the cover, shown as a picture and light on the site", async ({ page }) => {
  test.setTimeout(120000);
  await signIn(page);
  await page.getByRole("link", { name: /New recipe/ }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Lemon cake");
  await view(page, "Settings").click();

  const cover = page.locator(".oba-cover-field");
  await expect(cover).toContainText("No cover photo yet.");
  await expect(page.locator("#oba-cover")).toBeHidden();
  await expect(cover.locator('[data-action="cover-remove"]')).toBeHidden();

  await cover.getByRole("button", { name: "Add cover photo" }).click();
  await expect(picker(page)).toContainText("No photos yet.");
  await fitsThePhone(page);
  const photo = await largePhoto(page, "IMG_2031.jpg");
  expect(photo.buffer.length).toBeGreaterThan(5 * 1024 * 1024);
  await picker(page).locator("[data-photo-file]").setInputFiles(photo);
  await expect(picker(page)).toHaveCount(0, { timeout: 60000 });

  const shown = cover.locator("img");
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((image) => image.naturalWidth)).toBe(2000);
  await expect(cover.getByRole("button", { name: "Change cover photo" })).toBeVisible();

  await page.getByLabel("Describe the picture").fill("A lemon cake on a blue plate");
  // A Pin's own words are folded away until wanted, and saved as the card fields (#393).
  const pinWords = page.locator("[data-card-words]");
  await expect(page.getByLabel("Pin title")).toBeHidden();
  await pinWords.getByText("Words for a Pinterest Pin").click();
  await page.getByLabel("Pin title").fill("Lemon cake  that stays moist");
  await page.getByLabel("Pin description").fill("One bowl, one hour.");
  const wide = await pinWords.evaluate((details) => details.getBoundingClientRect().right - innerWidth);
  expect(wide).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".oba-save-state")).toHaveText("Saved");

  const folder = join(root, "static", "images", "uploads", String(new Date().getFullYear()));
  const [stored] = readdirSync(folder);
  expect(stored).toBe("img-2031.jpg");
  expect(statSync(join(folder, stored)).size).toBeLessThan(photo.buffer.length / 2);
  const posts = join(root, "content", "posts");
  const saved = readdirSync(posts).find((name) => name.includes("lemon-cake"));
  const source = readFileSync(join(posts, saved), "utf8");
  expect(source).toContain(`/images/uploads/${new Date().getFullYear()}/img-2031.jpg`);
  expect(source).toContain("A lemon cake on a blue plate");
  expect(source).toMatch(/^cardTitle: "?Lemon cake that stays moist"?$/m);
  expect(source).toMatch(/^cardDescription: "?One bowl, one hour\."?$/m);
});

test("Insert image shows earlier photos as pictures and asks for a description", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: /New recipe/ }).click();
  await page.getByRole("textbox", { name: "Visual editor" }).click();
  await page.locator('[data-action="insert-image"]').click();

  const earlier = picker(page).getByRole("button", { name: "Use img-2031" });
  await expect(earlier.locator("img")).toBeVisible();
  await expect.poll(() => earlier.locator("img").evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(picker(page)).not.toContainText("null");
  await fitsThePhone(page);
  await earlier.click();

  await picker(page).getByRole("button", { name: "Add picture" }).click();
  await expect(picker(page).getByRole("alert")).toContainText("Describe the picture");
  await picker(page).getByLabel("Describe the picture").fill("Slices of lemon cake");
  await picker(page).getByRole("button", { name: "Add picture" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Visual editor" }).getByRole("img", { name: "Slices of lemon cake" })).toBeVisible();
});

test("a landing page's picture is chosen from the same photos", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/landing`);
  await page.getByRole("button", { name: "Add a section" }).click();
  await page.locator('[data-add-type="image"]').click();
  await page.getByRole("button", { name: "Choose a photo" }).click();
  await picker(page).getByRole("button", { name: "Use img-2031" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByLabel("Picture address")).toHaveValue(/\/images\/uploads\/\d+\/img-2031\.jpg$/);
});

test("a picture in a landing page's text is chosen from the same photos", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/landing`);
  await page.getByRole("button", { name: "Add a section" }).click();
  await page.locator('[data-add-type="rich-text"]').click();
  await page.locator('[data-rich="image"]').click();
  const panel = page.locator('[data-rich-panel="image"]');
  await panel.getByRole("button", { name: "Choose a photo" }).click();
  await picker(page).getByRole("button", { name: "Use img-2031" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(panel.getByLabel("Where the picture is")).toHaveValue(/\/images\/uploads\/\d+\/img-2031\.jpg$/);
});

test("a picture that cannot be used says why, in the picker", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/new/recipe`);
  await view(page, "Settings").click();
  await page.getByRole("button", { name: "Add cover photo" }).click();
  await picker(page).locator("[data-photo-file]").setInputFiles({
    name: "IMG_0001.HEIC",
    mimeType: "image/heic",
    buffer: Buffer.from("\0\0\0\x18ftypheic\0\0\0\0heicmif1", "latin1"),
  });
  await expect(picker(page).getByRole("status")).toContainText("HEIC format");
  await expect(picker(page).getByRole("button", { name: "Add a new photo" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add cover photo" })).toBeVisible();
});

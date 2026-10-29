import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Capture view at 400px (ADRs 0400 to 0402): photos, remembered picks and notes become one
// unpublished job draft; a dropped connection keeps the capture and sends it once; a voice note is bounded.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
let root;
let server;
let origin;

test.use({ viewport: { width: 400, height: 800 } });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-capture-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
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
  removeTree(root);
});

async function openCapture(page) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.goto(`${origin}/admin/#/capture`);
  await expect(page.locator("[data-job-capture]")).toBeVisible();
}

// No control or region is wider than the viewport (a small tolerance, never tuned to one platform's fonts).
async function expectNoOverflow(page, selector) {
  const wider = await page.locator(selector).evaluate((region) => {
    const limit = document.documentElement.clientWidth + 2;
    const offenders = [region, ...region.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > limit);
    return offenders.map((node) => `${node.tagName}.${node.className}`);
  });
  expect(wider).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
}

const photo = (name) => ({ name, mimeType: "image/png", buffer: PNG });
const drafts = () => {
  const dir = join(root, "content", "posts");
  return readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}-(flooring|job)-.*-[0-9a-f]{6}\.md$/.test(name)).map((name) => join(dir, name));
};

test("three photos and notes become one unpublished job draft, and the picks are remembered", async ({ page }) => {
  await openCapture(page);
  const view = page.locator("[data-job-capture]");
  await expect(view.getByText("Add photos", { exact: true })).toBeVisible();
  for (const label of ["Trade", "Service", "Town", "Notes"]) await expect(view.getByLabel(label, { exact: true })).toBeVisible();
  for (const control of await view.locator("select, input[type=text], textarea, button, label.oba-btn").all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(43);
  }
  await expectNoOverflow(page, "[data-job-capture]");

  await view.getByLabel("Add photos", { exact: true }).setInputFiles([photo("front.png"), photo("a very long photo name from my phone camera roll 2026.png"), photo("rear.png")]);
  await expect(view.locator(".oba-capture-photo")).toHaveCount(3);
  await expectNoOverflow(page, "[data-job-capture]");
  await view.getByLabel("Trade", { exact: true }).selectOption("flooring");
  await view.getByLabel("Service", { exact: true }).fill("hardwood-install");
  await view.getByLabel("Town", { exact: true }).fill("Springfield");
  await view.getByLabel("Notes", { exact: true }).fill("Floor squeaked by the back door. Pulled two boards.");
  await view.getByRole("button", { name: "Save draft" }).click();
  await expect(view.locator("[data-capture-saved]")).toContainText("Saved as a draft");
  await expectNoOverflow(page, "[data-job-capture]");

  const [file] = drafts();
  const source = readFileSync(file, "utf8");
  expect(source).toMatch(/draft: "?true"?/);
  expect(source).toMatch(/profile: job/);
  expect(source).toContain("Floor squeaked by the back door.");
  expect(source.match(/!\[Photo \d from the job\]\(\/images\/uploads\//g)).toHaveLength(3);
  expect(source).toMatch(/Springfield/);

  await page.getByRole("link", { name: "Open it in Write" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Flooring in Springfield");

  // The draft is listed with the other posts, and the picks come back on the next visit.
  await page.goto(`${origin}/admin/#/posts`);
  await expect(page.getByText("Flooring in Springfield").first()).toBeVisible();
  await page.goto(`${origin}/admin/#/capture`);
  const again = page.locator("[data-job-capture]");
  await expect(again.getByLabel("Trade", { exact: true })).toHaveValue("flooring");
  await expect(again.getByLabel("Service", { exact: true })).toHaveValue("hardwood-install");
  await expect(again.getByRole("group", { name: "Recent towns" }).getByRole("button", { name: "Springfield" })).toBeVisible();
  await again.getByRole("button", { name: "Springfield" }).click();
  await expect(again.getByLabel("Town", { exact: true })).toHaveValue("Springfield");
});

test("an empty capture is refused with a sentence and nothing is saved", async ({ page }) => {
  await openCapture(page);
  const before = drafts().length;
  await page.locator("[data-job-capture]").getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator("[data-capture-status]")).toContainText("Add a photo or a few words first.");
  expect(drafts().length).toBe(before);
});

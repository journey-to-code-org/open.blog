import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Words for YouTube (Studio R7): the title, description and tags are `openblog video`'s, byte for
// byte; Copy puts them on the clipboard (or selects them when it can't); a problem YouTube won't
// take is listed with Show me, which selects the chapter's line; axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const EXAMPLE = "2026-10-24-zhalendor-gate-of-embers.md";
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block", timezoneId: "America/New_York" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-youtube-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.url = "https://videos.example.org";
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  copyFileSync(join(repository, "content", "posts", EXAMPLE), join(dir, "content", "posts", EXAMPLE));
  execFileSync(binary, ["user", "add", "sam", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
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
  page.on("pageerror", (error) => { throw error; });
});

async function open(page, hash) {
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("sam");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function openPost(page, file, text) {
  if (text !== undefined) writeFileSync(join(dir, "content", "posts", file), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${file}`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

const sheet = (page) => page.locator("side-sheet.studio-ready-sheet dialog").filter({ has: page.getByRole("heading", { name: "Words for YouTube", level: 2 }) }).first();

test("the words are openblog video's, byte for byte, and Copy puts them on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const engine = JSON.parse(execFileSync(binary, ["video", "zhalendor-gate-of-embers", "--json", "--root", dir], { cwd: dir }).toString());
  await openPost(page, EXAMPLE);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Words for YouTube" }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByText("Paste these into YouTube when you put your video up. Nothing here changes your video.")).toBeVisible();
  const description = sheet(page).getByRole("textbox", { name: "Description" });
  await expect(description).toHaveValue(engine.description);
  await expect(sheet(page).getByRole("textbox", { name: "Title" })).toHaveValue(engine.title);
  await expect(sheet(page).getByRole("textbox", { name: "Tags" })).toHaveValue(engine.tags.join(", "));
  expect(engine.description).toContain("Read the article: https://videos.example.org/");
  await expect(sheet(page).getByText(/^\d+ chapters, from the lines in your words that start with a time\.$/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Copy description" }).click();
  await expect(page.getByText("Description copied. Paste it into YouTube.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(engine.description);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("side-sheet.studio-ready-sheet"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => v.id));
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("a problem YouTube won't take is listed above, never stops Copy, and Show me selects the chapter line", async ({ page }) => {
  const file = "2026-10-25-short.md";
  await openPost(page, file, "---\ntitle: A short one\ndate: 2026-10-25\ndraft: true\nprofile: video\nduration: 2:00\n---\n\nIntro words.\n\n0:05 Late start\n0:30 Middle\n1:00 End\n");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Words for YouTube" }).click();
  await expect(sheet(page).getByRole("heading", { name: "Before YouTube will take these (1)" })).toBeVisible();
  await expect(sheet(page).getByText("The first chapter has to start at 0:00.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Copy description" })).toBeEnabled();
  await expect(sheet(page).getByText("Keep the video private on YouTube until this post is on your site.")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Show me: The first chapter has to start at 0:00." }).click();
  await expect(sheet(page)).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const box = document.activeElement;
    return box && "selectionStart" in box ? box.value.slice(box.selectionStart, box.selectionEnd) : "";
  })).toBe("0:05 Late start");
});

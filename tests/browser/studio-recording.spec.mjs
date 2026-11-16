import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// A recording to listen to with a post (#645): Write's "Put a recording with it" chooses a recording,
// says anyone with its address can listen before it goes on the blog, reads its length, takes the
// words said into the post under Transcript, and saves it all with the post; taking it off removes
// it from the post and says the recording stays on the blog.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg==", "base64");
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-recording-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "static", "images", "uploads", "2026"), { recursive: true });
  for (const name of ["dough.png", "loaf.png"]) writeFileSync(join(dir, "static", "images", "uploads", "2026", name), PNG);
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
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
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
  page.on("pageerror", (error) => { throw error; });
});

async function open(page, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

const front = (title) => `---\ntitle: ${title}\ndate: 2026-01-01\ndraft: true\n---\n`;
const fileOf = (name) => readFileSync(join(dir, "content", "posts", `${name}.md`), "utf8");

async function openPost(page, name, text, query = "") {
  writeFileSync(join(dir, "content", "posts", `${name}.md`), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${name}.md`)}${query}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

async function axeClean(page, label, root = "side-sheet.studio-add-sheet") {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  expect(await page.evaluate((selector) => { const body = document.querySelector(selector)?.querySelector(".sheet-body, dialog"); return body ? body.scrollWidth > body.clientWidth + 1 : false; }, root), `${label}: the sheet scrolls sideways`).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}


/** A one-second, 8 kHz, 8-bit mono WAV: the smallest recording the server recognises. */
function wav(seconds = 1) {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds, 128);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function saveDraft(page) {
  await page.getByRole("textbox", { name: "Title", exact: true }).focus();
  await page.keyboard.press("Control+s");
}

test("a recording goes on the blog when she says so, with its length and the words said, and saves with the post", async ({ page }) => {
  await openPost(page, "episode", `${front("Episode one")}\nWe talk about bread.\n`);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Put a recording with it" }).click();
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "A recording to listen to" }) });
  await expect(sheet.getByText("It needs the words said, written out")).toBeVisible();
  await sheet.locator("file-drop input[type=file]").setInputFiles({ name: "episode-one.wav", mimeType: "audio/wav", buffer: wav(2) });
  // Nothing has gone anywhere yet: it says who can listen, before the button that sends it.
  await expect(sheet.getByText("Chosen: episode-one.wav")).toBeVisible();
  await expect(sheet.getByText(/anyone with its address can listen, even before you publish the post/)).toBeVisible();
  const sent = page.waitForResponse((r) => r.url().endsWith("/admin/api/episode-audio") && r.request().method() === "POST");
  await sheet.getByRole("button", { name: "Put it on your blog" }).click();
  expect((await sent).status()).toBe(201);
  await expect(sheet.locator(".studio-did")).toContainText("It's on your blog. It goes with the post when the post is saved.");
  await expect(sheet.getByRole("textbox", { name: "How long it is" })).toHaveValue("0:02");
  await sheet.getByRole("textbox", { name: "The words said" }).fill("Hello, and welcome.\nToday: bread.");
  await sheet.getByRole("button", { name: "Put them in my post" }).click();
  await expect(sheet.getByText("The words said are in your post, under Transcript. Change them there.")).toBeVisible();
  // Parts, for whoever set up the site: a mistake is named by its line.
  await sheet.locator("summary", { hasText: "For the person who set up your site" }).click();
  const parts = sheet.getByRole("textbox", { name: "Parts of the recording" });
  await parts.fill("0:00 Hello\n0:05 Bread");
  await expect(sheet.getByText("Line 2: it starts after the recording ends.")).toBeVisible();
  await parts.fill("0:00 Hello\n0:01 Bread | /about/");
  await axeClean(page, "the recording sheet", "side-sheet");
  await page.keyboard.press("Escape");
  await expect(page.locator(".studio-recording-card")).toContainText("0:02 long");
  await saveDraft(page);
  await expect.poll(() => fileOf("episode")).toMatch(/audio:\n[\s\S]*url: \/audio\/uploads\/[0-9a-f]+\.wav/);
  const saved = fileOf("episode");
  expect(saved).toContain("type: audio/wav");
  expect(saved).toMatch(/durationSeconds: "?2"?/);
  expect(saved).toMatch(/title: Bread/);
  expect(saved).toContain("## Transcript\n\nHello, and welcome.\nToday: bread.");
  const url = /url: (\/audio\/uploads\/[0-9a-f]+\.wav)/.exec(saved)[1];
  expect(existsSync(join(dir, "static", url))).toBe(true);

  // Taken off: the post no longer has it, and the recording stays on the blog.
  await page.locator(".studio-recording-card").getByRole("button", { name: "Change the recording" }).click();
  await sheet.getByRole("button", { name: "Take the recording off this post" }).click();
  await expect(sheet.locator(".studio-did")).toContainText("The recording comes off this post when it's saved. It stays on your blog.");
  await page.keyboard.press("Escape");
  await expect(page.locator(".studio-recording-card")).toBeHidden();
  await saveDraft(page);
  await expect.poll(() => fileOf("episode")).not.toContain("audio:");
  expect(existsSync(join(dir, "static", url))).toBe(true);
});

test("a recording that isn't one is refused in her words, and nothing changes", async ({ page }) => {
  await openPost(page, "not-sound", `${front("Not sound")}\nWords.\n`);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Put a recording with it" }).click();
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "A recording to listen to" }) });
  await sheet.locator("file-drop input[type=file]").setInputFiles({ name: "notes.wav", mimeType: "audio/wav", buffer: Buffer.from("just some words, not a recording") });
  await sheet.getByRole("button", { name: "Put it on your blog" }).click();
  await expect(sheet.locator(".studio-did")).toContainText("That isn't a recording your blog can play. Choose another.");
  await page.keyboard.press("Escape");
  await expect(page.locator(".studio-recording-card")).toBeHidden();
});

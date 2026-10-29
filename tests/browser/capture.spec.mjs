import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Capture view at 400px (ADRs 0296 to 0298): photos, remembered picks and notes become one
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
  return readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}-(flooring|job|roofing)-.*-[0-9a-f]{6}\.md$/.test(name)).map((name) => join(dir, name));
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

const draftsIn = (town) => drafts().filter((file) => file.toLowerCase().includes(town));

async function fillCapture(view, town) {
  await view.getByLabel("Add photos", { exact: true }).setInputFiles([photo("one.png"), photo("two.png")]);
  await view.getByLabel("Trade", { exact: true }).selectOption("roofing");
  await view.getByLabel("Town", { exact: true }).fill(town);
  await view.getByLabel("Notes", { exact: true }).fill("Flashing lifted at the valley.");
}

test("offline, a capture is kept on the device and sends once when the connection returns", async ({ page, context }) => {
  await openCapture(page);
  const view = page.locator("[data-job-capture]");
  await fillCapture(view, "Offlinetown");
  await context.setOffline(true);
  await view.getByRole("button", { name: "Save draft" }).click();
  const pending = view.locator("[data-capture-pending-list]");
  await expect(pending).toBeVisible();
  await expect(pending).toContainText("Waiting for a connection.");
  await expect(view.locator("[data-capture-status]")).toContainText("kept on this device");
  await expect(view.getByLabel("Notes", { exact: true })).toHaveValue("");
  await expectNoOverflow(page, "[data-job-capture]");
  expect(draftsIn("offlinetown")).toHaveLength(0);

  await context.setOffline(false);
  await expect(view.locator("[data-capture-saved]")).toContainText("Saved as a draft");
  await expect(pending).toBeHidden();
  await expect.poll(() => draftsIn("offlinetown").length).toBe(1);
  const source = readFileSync(draftsIn("offlinetown")[0], "utf8");
  expect(source.match(/!\[Photo \d from the job\]\(\/images\/uploads\/captures\/capture-[0-9a-f]{12}-[01]\.png\)/g)).toHaveLength(2);
});

test("a kept capture survives a reload, sends on request without a second draft, and can be discarded", async ({ page }) => {
  await openCapture(page);
  const view = page.locator("[data-job-capture]");
  await page.route(/\/admin\/api\/(upload|document)/, (route) => route.abort("connectionrefused"));
  await fillCapture(view, "Reloadville");
  await view.getByRole("button", { name: "Save draft" }).click();
  const pending = view.locator("[data-capture-pending-list]");
  await expect(pending).toContainText("Waiting for a connection.");

  await page.reload();
  const again = page.locator("[data-job-capture]");
  await expect(again.locator("[data-capture-pending-list]")).toContainText("Waiting for a connection.");
  expect(draftsIn("reloadville")).toHaveLength(0);

  await page.unroute(/\/admin\/api\/(upload|document)/);
  await again.getByRole("button", { name: /^Send now/ }).click();
  await expect(again.locator("[data-capture-saved]")).toContainText("Saved as a draft");
  await expect.poll(() => draftsIn("reloadville").length).toBe(1);

  // Sending again after a reload finds nothing waiting and makes no second draft.
  await page.reload();
  await expect(page.locator("[data-job-capture]")).toBeVisible();
  await expect(page.locator("[data-capture-pending-list]")).toBeHidden();
  expect(draftsIn("reloadville")).toHaveLength(1);

  await page.route(/\/admin\/api\/(upload|document)/, (route) => route.abort("connectionrefused"));
  await fillCapture(page.locator("[data-job-capture]"), "Binton");
  await page.locator("[data-job-capture]").getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator("[data-capture-pending-list]")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^Discard/ }).click();
  await expect(page.locator("[data-capture-pending-list]")).toBeHidden();
});

// A stand-in for the browser's recorder and microphone, so the run is deterministic and needs no device.
const fakeMicrophone = ({ denied, supported }) => {
  window.__mic = { asked: 0, open: 0, stopped: 0 };
  navigator.mediaDevices.getUserMedia = async () => {
    window.__mic.asked += 1;
    if (denied) throw Object.assign(new Error(denied), { name: denied });
    window.__mic.open += 1;
    return { getTracks: () => [{ stop() { window.__mic.stopped += 1; } }] };
  };
  class FakeRecorder {
    static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }
    constructor(stream, options) { this.mimeType = options?.mimeType || ""; this.state = "inactive"; this.slices = 0; }
    start() { this.state = "recording"; this.emit(); }
    emit() {
      const bytes = this.slices++ === 0 ? [0x1a, 0x45, 0xdf, 0xa3, ...new Array(300).fill(7)] : new Array(300).fill(7);
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: "audio/webm" }) });
    }
    stop() { this.state = "inactive"; this.emit(); setTimeout(() => this.onstop?.(), 0); }
  }
  if (supported) window.MediaRecorder = FakeRecorder;
  else delete window.MediaRecorder;
};

const voiceFiles = () => {
  const dir = join(root, ".openblog", "captures");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".audio.webm")) : [];
};

test("a voice note is recorded only after a tap, kept privately with the draft and never published", async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { denied: "", supported: true });
  await openCapture(page);
  const view = page.locator("[data-job-capture]");
  const voice = view.locator("[data-capture-voice]");
  await expect(voice.getByRole("button", { name: "Record a voice note" })).toBeVisible();
  await expect(voice).toContainText("Up to 3 minutes");
  expect((await voice.getByRole("button", { name: "Record a voice note" }).boundingBox()).height).toBeGreaterThanOrEqual(43);

  // A script cannot start it: only a real tap can.
  await voice.getByRole("button", { name: "Record a voice note" }).evaluate((button) => button.click());
  await expect(view.locator("[data-capture-status]")).toContainText("only when you tap Record");
  expect(await page.evaluate(() => window.__mic.asked)).toBe(0);

  await voice.getByRole("button", { name: "Record a voice note" }).click();
  await expect(voice.locator("[data-capture-timer]")).toContainText("Recording 0:0");
  await expect(voice.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await expect(voice.getByRole("button", { name: "Discard" })).toBeVisible();
  await expectNoOverflow(page, "[data-job-capture]");
  await voice.getByRole("button", { name: "Stop recording" }).click();
  await expect(voice.locator("audio")).toBeVisible();
  await expect(voice).toContainText("kept on your own server");
  expect(await page.evaluate(() => window.__mic)).toEqual({ asked: 1, open: 1, stopped: 1 });
  await expectNoOverflow(page, "[data-job-capture]");

  await view.getByLabel("Town", { exact: true }).fill("Voiceburg");
  const before = voiceFiles().length;
  await view.getByRole("button", { name: "Save draft" }).click();
  await expect(view.locator("[data-capture-saved]")).toContainText("voice note is kept privately");
  await expect.poll(() => voiceFiles().length).toBe(before + 1);
  await expect.poll(() => draftsIn("voiceburg").length).toBe(1);
  const source = readFileSync(draftsIn("voiceburg")[0], "utf8");
  expect(source).not.toMatch(/audio|webm/i);
  const files = voiceFiles();
  const ledger = readdirSync(join(root, ".openblog", "captures")).filter((name) => name.endsWith(".json"));
  expect(ledger.some((name) => readFileSync(join(root, ".openblog", "captures", name), "utf8").includes(".audio.webm"))).toBe(true);
  expect(files.every((name) => !existsSync(join(root, "static", name)) && !existsSync(join(root, "dist", name)))).toBe(true);
});

test("a recording can be stopped and discarded, and a discarded one is never sent", async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { denied: "", supported: true });
  await openCapture(page);
  const view = page.locator("[data-job-capture]");
  const voice = view.locator("[data-capture-voice]");
  await voice.getByRole("button", { name: "Record a voice note" }).click();
  await voice.getByRole("button", { name: "Discard" }).click();
  await expect(view.locator("[data-capture-status]")).toContainText("Recording discarded");
  await expect(voice.getByRole("button", { name: "Record a voice note" })).toBeVisible();
  expect(await page.evaluate(() => window.__mic)).toEqual({ asked: 1, open: 1, stopped: 1 });

  await voice.getByRole("button", { name: "Record a voice note" }).click();
  await voice.getByRole("button", { name: "Stop recording" }).click();
  await voice.getByRole("button", { name: "Discard voice note" }).click();
  await expect(voice.locator("audio")).toHaveCount(0);
  await expect(voice.getByRole("button", { name: "Record a voice note" })).toBeFocused();
  const before = voiceFiles().length;
  await view.getByRole("button", { name: "Save draft" }).click();
  await expect(view.locator("[data-capture-status]")).toContainText("Add a photo or a few words first.");
  expect(voiceFiles().length).toBe(before);
});

test("a recording stops at the three minute limit by itself", async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { denied: "", supported: true });
  await openCapture(page);
  await page.clock.install();
  const view = page.locator("[data-job-capture]");
  const voice = view.locator("[data-capture-voice]");
  await voice.getByRole("button", { name: "Record a voice note" }).click();
  await expect(voice.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.clock.fastForward(181_000);
  await expect(voice.locator("audio")).toBeVisible();
  await expect(view.locator("[data-capture-status]")).toContainText("three minute limit");
  await expect(voice).toContainText("3:00");
  expect(await page.evaluate(() => window.__mic.stopped)).toBe(1);
});

test("without a recorder or with the microphone blocked, typing still works and nothing is left recording", async ({ page, browser }) => {
  const plain = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await plain.addInitScript(fakeMicrophone, { denied: "", supported: false });
  await openCapture(plain);
  const absent = plain.locator("[data-capture-voice]");
  await expect(absent).toContainText("cannot record audio");
  await expect(absent.getByRole("button")).toHaveCount(0);
  await expect(plain.locator("[data-job-capture]").getByLabel("Notes", { exact: true })).toBeVisible();
  await plain.close();

  await page.addInitScript(fakeMicrophone, { denied: "NotAllowedError", supported: true });
  await openCapture(page);
  const view = page.locator("[data-job-capture]");
  await view.getByRole("button", { name: "Record a voice note" }).click();
  await expect(view.locator("[data-capture-status]")).toContainText("microphone is blocked");
  await expect(view.getByRole("button", { name: "Record a voice note" })).toBeEnabled();
  expect(await page.evaluate(() => window.__mic.open)).toBe(0);
});

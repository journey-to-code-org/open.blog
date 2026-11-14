import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// New job (Studio R4), ported from capture.spec.mjs and grown: on a real `openblog serve --admin`
// for a roofing site at 400 px. Photos (made smaller on the phone), a voice note, a few words and the
// remembered picks become one draft; no signal keeps it on the phone and it goes on `online`; a reload
// mid-job loses nothing; a job the old Admin kept is read and sent; two windows make one draft; a
// background sign-in lapse asks nothing; Grammi's blog never gets the database; axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg==", "base64");
let trade;
let plain;

// The worker keeps Studio's files since R4 (G35); a page it controls sends its requests past page.route,
// so the stand-ins here would be skipped. These tests don't need it.
test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  return port;
}

async function startAdmin(name, { roofing }) {
  const dir = mkdtempSync(join(tmpdir(), `openblog-new-job-${name}-`));
  if (roofing) {
    execFileSync(binary, ["init", dir, "--starter", "trade", "--trade", "roofing", "--no-voice"], { stdio: "pipe" });
    mkdirSync(join(dir, "content", "services"), { recursive: true });
    writeFileSync(join(dir, "content", "services", "roof-repair.md"), "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks found and fixed.\n---\nWe fix leaks.\n");
  } else {
    mkdirSync(join(dir, "content", "posts"), { recursive: true });
    writeFileSync(join(dir, "content", "posts", "pie.md"), "---\ntitle: Pie\ndate: 2026-10-01\n---\nA pie.\n");
    writeFileSync(join(dir, "openblog.json"), JSON.stringify({ title: "Grammi's House", url: "https://grammis.example", author: { name: "Grammi" } }));
  }
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const port = await freePort();
  const child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const origin = `http://127.0.0.1:${port}`;
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
  return { child, dir, origin };
}

test.beforeAll(async () => {
  trade = await startAdmin("roofing", { roofing: true });
  plain = await startAdmin("grammi", { roofing: false });
});

test.afterAll(async () => {
  for (const server of [trade, plain]) {
    if (server?.child && server.child.exitCode === null) {
      const stopped = once(server.child, "exit");
      server.child.kill();
      await stopped;
    }
    removeTree(server?.dir);
  }
});

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
});

async function signIn(page, server, hash = "#/new-job") {
  await page.goto(`${server.origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function openNewJob(page, server = trade, query = "") {
  await signIn(page, server, `#/new-job${query}`);
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
}

const screen = (page) => page.locator(".studio-new-job");
const status = (page) => page.locator(".studio-new-job > [role=status]");
const photo = (name) => ({ name, mimeType: "image/png", buffer: PNG });
const draftsIn = (server, town) => {
  const dir = join(server.dir, "content", "posts");
  return readdirSync(dir).filter((name) => name.toLowerCase().includes(town.toLowerCase())).map((name) => join(dir, name));
};
const notesBox = (page) => page.getByRole("textbox", { name: "What did you do?", exact: true });
const saveButton = (page) => page.getByRole("button", { name: "Save this job", exact: true });
const waitingCards = (page) => page.locator("[data-waiting]");

async function choosePhotos(page, files) {
  await page.locator("[data-library] input[type=file]").setInputFiles(files);
}

async function fillJob(page, town, words = "Flashing lifted at the valley.") {
  await choosePhotos(page, [photo("one.png"), photo("two.png")]);
  await expect(page.locator(".studio-thumb img")).toHaveCount(2);
  if (await page.getByRole("button", { name: "Change", exact: true }).isVisible()) await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("combobox", { name: "Service", exact: true }).selectOption("roof-repair");
  await page.getByRole("textbox", { name: "Town", exact: true }).fill(town);
  await notesBox(page).fill(words);
}

async function axeClean(page, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("#studio-main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

/** Records in the old Admin's list on this phone, read straight from IndexedDB (never making it). */
const stored = (page) => page.evaluate(async () => !(await indexedDB.databases()).some((db) => db.name === "openblog-capture") ? [] : new Promise((done) => {
  const request = indexedDB.open("openblog-capture", 1);
  request.onsuccess = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("captures")) { db.close(); done([]); return; }
    const read = db.transaction("captures", "readonly").objectStore("captures").getAll();
    read.onsuccess = () => { db.close(); done(read.result.map((r) => ({ id: r.id, v: r.v, attempts: r.attempts, failed: r.failed, lastError: r.lastError, by: r.by, sent: r.sent, photos: r.photos?.length }))); };
  };
}));

test("photos, words and the remembered picks become one draft, the photos made smaller first", async ({ page }) => {
  await openNewJob(page);
  await expect(page.getByText("Take photos and say what you did. It's kept on this computer until there's a signal, then goes to your blog as a draft.")).toBeVisible();
  await expect(page.locator("[data-camera] .drop-main")).toHaveText("Take a photo");
  await expect(page.locator("[data-camera] input[type=file]")).toHaveAttribute("capture", "environment");
  await expect(page.locator("[data-library] input[type=file]")).toHaveAttribute("multiple", "");
  await expect(saveButton(page)).toBeInViewport();
  for (const control of await screen(page).locator("action-button button, select, input[type=text], textarea, label.drop-button").all()) {
    if (await control.isVisible()) expect((await control.boundingBox()).height, await control.evaluate((n) => n.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(43);
  }
  // The site has one trade: it isn't asked.
  await expect(page.getByRole("combobox", { name: "Trade", exact: true })).toBeHidden();
  await choosePhotos(page, [photo("front.png"), photo("a very long photo name from my phone camera roll 2026.png"), photo("rear.png")]);
  await expect(page.locator(".studio-thumb img")).toHaveCount(3);
  await expect(page.getByText("3 of 12 photos")).toBeVisible();
  await page.getByRole("button", { name: "Remove photo 2" }).click();
  await expect(status(page)).toHaveText("Removed photo 2.");
  await expect(page.locator(".studio-thumb img")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Service", exact: true }).selectOption("roof-repair");
  await page.getByRole("textbox", { name: "Town", exact: true }).fill("Elkins");
  await notesBox(page).fill("Leak by the chimney. <img src=x onerror=alert(1)>");
  await saveButton(page).click();
  await expect(status(page)).toContainText("Saved on this computer.");
  await expect(status(page)).toBeFocused();
  await expect(page.getByRole("heading", { name: "Sent this visit" })).toBeVisible();
  await expect.poll(() => draftsIn(trade, "roof-repair-in-elkins").length).toBe(1);
  const source = readFileSync(draftsIn(trade, "roof-repair-in-elkins")[0], "utf8");
  expect(source).toMatch(/draft: "?true"?/);
  expect(source).toMatch(/profile: job/);
  expect(source).toMatch(/service: roof-repair/);
  expect(source).toMatch(/town: Elkins/);
  expect(source).toContain("Leak by the chimney. <img src=x onerror=alert(1)>");
  // Made smaller on the phone: a JPEG, whatever was picked.
  expect(source.match(/!\[Photo \d from the job\]\(\/images\/uploads\/captures\/capture-[0-9a-f]{12}-[01]\.jpg\)/g)).toHaveLength(2);
  expect(await page.locator("img[src=x]").count()).toBe(0);
  expect(await stored(page)).toEqual([]);

  // The toast's Finish it opens the draft in Write.
  await page.locator(".studio-sent-list a", { hasText: "Finish it" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Roof repair in Elkins");

  // The picks come back as one line, with Change.
  await page.goto(`${trade.origin}/admin/studio/#/new-job`);
  await expect(page.getByText("Roofing · Roof repair · Elkins")).toBeVisible();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Service", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Use Elkins" })).toBeVisible();
  await axeClean(page, "New job");
});

test("an empty job is refused with a sentence, and Take a photo has the focus", async ({ page }) => {
  await openNewJob(page);
  await saveButton(page).click();
  await expect(page.getByRole("alert")).toContainText("Add a photo, a voice note or a few words first.");
  await expect(page.locator("[data-camera] input[type=file]")).toBeFocused();
  expect(await stored(page)).toEqual([]);
});

test("with no signal a job is kept on this phone, and it goes by itself when the signal comes back", async ({ page, context }) => {
  await openNewJob(page);
  await fillJob(page, "Beverly");
  await context.setOffline(true);
  await saveButton(page).click();
  await expect(status(page)).toContainText("Saved on this computer.");
  await expect(notesBox(page)).toHaveValue("");
  await expect(waitingCards(page)).toHaveCount(1);
  await expect(waitingCards(page).first()).toContainText(/Waiting/);
  await expect(page.getByText("1 job waiting on this computer.")).toBeVisible();
  const [kept] = await stored(page);
  expect(kept.v).toBe(1);
  expect(kept.by).toBe("writer");
  expect(draftsIn(trade, "beverly")).toHaveLength(0);
  await axeClean(page, "a waiting card");

  await context.setOffline(false);
  await expect(waitingCards(page)).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => draftsIn(trade, "beverly").length).toBe(1);
  expect(await stored(page)).toEqual([]);
});

test("a kept job survives a reload, sends on Send now without a second draft, and Throw it away asks once", async ({ page }) => {
  await openNewJob(page);
  await page.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await fillJob(page, "Davis");
  await saveButton(page).click();
  await expect(waitingCards(page).first()).toContainText("No signal when it last tried");
  await page.reload();
  await expect(waitingCards(page)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Roof repair in Davis" })).toBeVisible();
  expect(draftsIn(trade, "davis")).toHaveLength(0);

  await page.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await page.getByRole("button", { name: "Send Roof repair in Davis now" }).click();
  await expect(waitingCards(page)).toHaveCount(0);
  await expect.poll(() => draftsIn(trade, "davis").length).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
  expect(draftsIn(trade, "davis")).toHaveLength(1);

  await page.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await fillJob(page, "Thomas");
  await saveButton(page).click();
  await expect(waitingCards(page)).toHaveCount(1);
  await page.getByRole("button", { name: "More for Roof repair in Thomas" }).click();
  await page.getByRole("menuitem", { name: "Throw it away…" }).click();
  const dialog = page.getByRole("dialog", { name: "Throw away Roof repair in Thomas?" });
  await expect(dialog).toContainText("Its 2 photos and words are only on this computer, so they'll be gone for good.");
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(waitingCards(page)).toHaveCount(1);
  await page.getByRole("button", { name: "More for Roof repair in Thomas" }).click();
  await page.getByRole("menuitem", { name: "Throw it away…" }).click();
  await page.getByRole("dialog", { name: "Throw away Roof repair in Thomas?" }).getByRole("button", { name: "Throw it away" }).click();
  await expect(waitingCards(page)).toHaveCount(0);
  await expect(status(page)).toHaveText("Thrown away.");
  expect(await stored(page)).toEqual([]);
  await page.unroute(/\/admin\/api\/(upload|document|capture\?)/);
});

test("a reload in the middle of a job puts back every photo and word", async ({ page }) => {
  await openNewJob(page);
  await fillJob(page, "Parsons", "Half typed when the camera opened");
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator(".studio-thumb img")).toHaveCount(2);
  await expect(notesBox(page)).toHaveValue("Half typed when the camera opened");
  await expect(status(page)).toContainText("Picked up where you left off, today at");
  expect(await stored(page)).toEqual([], "a half-made job is never on the list the old Admin sends");
  await saveButton(page).click();
  await expect.poll(() => draftsIn(trade, "parsons").length).toBe(1);
  await page.reload();
  await expect(page.locator(".studio-thumb img")).toHaveCount(0);
  await expect(notesBox(page)).toHaveValue("");
});

// A stand-in for the recorder and microphone, so the run needs no device (from capture.spec.mjs).
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

test("a voice note is recorded after a tap, turned into words only after she's told where it goes, and kept privately", async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { denied: "", supported: true });
  const sent = [];
  await page.route(/\/admin\/api\/assistant\/transcribe$/, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true, engine: "provider", provider: "open-ai", destination: "https://api.openai.com", model: "gpt-4o-mini-transcribe", leavesServer: true } });
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { transcript: "Replaced the flashing. <img src=x onerror=alert(1)>", truncated: false } });
  });
  await openNewJob(page);
  const voice = page.locator("[data-voice]");
  await expect(voice.getByText("Up to 3 minutes.")).toBeVisible();
  expect(await page.evaluate(() => window.__mic.asked)).toBe(0);
  await voice.getByRole("button", { name: "Record a voice note" }).click();
  await expect(voice.getByRole("button", { name: "Stop" })).toBeFocused();
  await expect(voice.getByText(/Recording 0:0\d of 3:00/)).toBeVisible();
  await voice.getByRole("button", { name: "Stop" }).click();
  await expect(voice.locator("audio")).toBeVisible();
  await expect(voice.locator("audio")).toHaveAttribute("aria-label", "Your voice note");
  await expect(status(page)).toContainText("Stopped. Your voice note is");
  expect(await page.evaluate(() => window.__mic.stopped)).toBeGreaterThan(0);

  await notesBox(page).fill("Typed first.");
  await voice.getByRole("button", { name: "Turn it into words" }).click();
  const sheet = page.getByRole("dialog", { name: "Turn your voice note into words" });
  await expect(sheet).toContainText("Your voice note goes to OpenAI to be turned into words. Only the recording goes: not your photos or your notes.");
  await expect(sheet).not.toContainText("gpt-4o");
  await sheet.getByRole("button", { name: "Not now" }).click();
  expect(sent).toEqual([]);
  await voice.getByRole("button", { name: "Turn it into words" }).click();
  await page.getByRole("dialog", { name: "Turn your voice note into words" }).getByRole("button", { name: "Turn it into words" }).click();
  await expect(notesBox(page)).toHaveValue("Typed first.\n\nReplaced the flashing. &lt;img src=x onerror=alert(1)>");
  expect(sent).toHaveLength(1);
  expect(sent[0].confirmed).toBe(true);
  await expect(status(page)).toContainText("A computer wrote them from your voice note, so read them through.");
  await page.locator(".studio-notifications-undo").getByRole("button", { name: "Undo" }).click();
  await expect(notesBox(page)).toHaveValue("Typed first.");
  await expect(status(page)).toHaveText("Taken out. Your words are as they were.");
  expect(await page.locator("img[src=x]").count()).toBe(0);
  await axeClean(page, "New job with a voice note");

  await page.getByRole("textbox", { name: "Town", exact: true }).fill("Voicetown");
  await saveButton(page).click();
  await expect.poll(() => draftsIn(trade, "voicetown").length).toBe(1);
  const notes = readdirSync(join(trade.dir, ".openblog", "captures")).filter((name) => name.endsWith(".audio.webm"));
  expect(notes.length).toBeGreaterThan(0);
  expect(readFileSync(draftsIn(trade, "voicetown")[0], "utf8")).not.toMatch(/webm|audio/);
});

test("a refused microphone shows only this phone's steps, and typing still works", async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { denied: "NotAllowedError", supported: true });
  await openNewJob(page);
  const voice = page.locator("[data-voice]");
  await voice.getByRole("button", { name: "Record a voice note" }).click();
  await expect(voice).toContainText("Your blog isn't allowed to use the microphone on this computer. To change that:");
  await expect(voice.locator("ol li")).toHaveCount(1);
  await expect(voice).toContainText("Or type a few words instead.");
});

test("a job the old Admin kept is on the list, sent by Studio, and Home says so first", async ({ page }) => {
  await signIn(page, trade, "#/posts");
  await page.evaluate(async () => {
    const queue = await import("/admin/capture-queue.js");
    const store = await queue.openIndexedStore();
    const png = new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0))], { type: "image/png" });
    const make = (id, town, at) => queue.makeRecord({ id, fields: { trade: "roofing", service: "roof-repair", town, notes: "Kept by the old Admin." }, photos: [{ name: "old.png", type: "image/png", size: png.size, blob: png }], audio: null }, new Date(at));
    await store.put(make("0123456789abcdef0123456789abcdef", "Oldtown", "2026-11-12T10:00:00Z"));
    await store.put(make("0123456789abcdef0123456789abcdee", "Oldville", "2026-11-12T11:00:00Z"));
  });
  // Nothing sends until a Studio page is open with its sender: stop it at the door to see Home.
  await page.route(/\/admin\/api\/capture\?/, (route) => route.abort("connectionrefused"));
  await page.goto(`${trade.origin}/admin/studio/#/`);
  await expect(page.getByRole("heading", { name: "2 jobs waiting on this computer" })).toBeVisible();
  await page.unroute(/\/admin\/api\/capture\?/);
  await expect(page.locator("[data-home-jobs]").getByRole("button", { name: "Send now" })).toBeVisible();
  await expect(page.locator("[data-home-jobs]").getByRole("link", { name: "See them" })).toHaveAttribute("href", "#/new-job?focus=waiting");
  await axeClean(page, "Home with jobs waiting");
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect.poll(() => draftsIn(trade, "oldtown").length + draftsIn(trade, "oldville").length).toBe(2);
  await expect(page.locator("[data-home-jobs]")).toBeEmpty();
  expect(await stored(page)).toEqual([]);
});

test("two windows sending one job make one draft, and the list loses nothing", async ({ page, context }) => {
  await openNewJob(page);
  await page.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await fillJob(page, "Twotown");
  await saveButton(page).click();
  await expect(waitingCards(page)).toHaveCount(1);
  const other = await context.newPage();
  other.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}`); });
  await other.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await other.goto(`${trade.origin}/admin/studio/#/new-job`);
  await expect(waitingCards(other)).toHaveCount(1);
  await page.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await other.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await Promise.all([
    page.getByRole("button", { name: "Send Roof repair in Twotown now" }).click(),
    other.getByRole("button", { name: "Send Roof repair in Twotown now" }).click(),
  ]);
  await expect(waitingCards(page)).toHaveCount(0);
  await expect(waitingCards(other)).toHaveCount(0);
  await expect.poll(() => draftsIn(trade, "twotown").length).toBe(1);
  expect(await stored(page)).toEqual([]);
  await other.close();
});

test("the old Admin sending and Studio sending on one phone make one draft each and lose nothing", async ({ page, context }) => {
  await openNewJob(page);
  // The old Admin's own modules, in a window of their own, keep a job and send it as they always did.
  const old = await context.newPage();
  await old.goto(`${trade.origin}/admin/#/posts`);
  await page.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await fillJob(page, "Mixtown");
  await saveButton(page).click();
  await expect(waitingCards(page)).toHaveCount(1);
  await page.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await Promise.all([
    old.evaluate(async () => {
      const queue = await import("/admin/capture-queue.js");
      const capture = await import("/admin/job-capture.js");
      const { csrf } = await (await fetch("/admin/api/session")).json();
      const api = { async call(method, path, { json, body, headers = {} } = {}) {
        const response = await fetch(`/admin/api/${path}`, { method, headers: { "X-CSRF-Token": csrf, ...(json ? { "Content-Type": "application/json" } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw Object.assign(new Error(data?.error || "no"), { status: response.status });
        return data;
      } };
      const store = await queue.openIndexedStore();
      const list = queue.createCaptureQueue({ store, send: (record) => capture.sendCapture({ api, capture: record, scaffold: "", now: new Date(record.createdAt) }) });
      return list.flush();
    }),
    // Studio's sender goes at the same moment, as it does when the signal comes back.
    page.evaluate(() => dispatchEvent(new Event("online"))),
  ]);
  await expect.poll(() => draftsIn(trade, "mixtown").length).toBe(1);
  await expect(waitingCards(page)).toHaveCount(0);
  expect(await stored(page)).toEqual([]);
  await old.close();
});

test("a sign-in that lapsed while sending by itself shows Needs you and asks nothing; Sign in sends it", async ({ page, context }) => {
  await openNewJob(page);
  await page.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await fillJob(page, "Lapsetown");
  await saveButton(page).click();
  await expect(waitingCards(page)).toHaveCount(1);
  await page.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await context.clearCookies();
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(waitingCards(page).first()).toContainText("Sign in again to send it.");
  await expect(waitingCards(page).first().locator("status-badge")).toHaveText("Needs you");
  await expect(page.locator("modal-dialog[open]")).toHaveCount(0);
  expect(draftsIn(trade, "lapsetown")).toHaveLength(0);
  await axeClean(page, "a card that needs her");
  await page.getByRole("button", { name: "Sign in: Roof repair in Lapsetown" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in again" });
  await dialog.getByRole("textbox", { name: "Your name", exact: true }).fill("writer");
  await dialog.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(() => draftsIn(trade, "lapsetown").length).toBe(1);
  await expect(waitingCards(page)).toHaveCount(0);
});

test("the old Admin's Capture opens New job", async ({ page }) => {
  await signIn(page, trade, "#/");
  await page.goto(`${trade.origin}/admin/#/capture`);
  await expect(page).toHaveURL(/\/admin\/studio\/#\/new-job$/);
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
  await page.goto(`${trade.origin}/admin/studio/#/capture/anything`);
  await expect(page).toHaveURL(/#\/new-job$/);
  // On a trade site New job is in the navigation and the account menu, and Home offers it.
  await page.goto(`${trade.origin}/admin/studio/#/`);
  await expect(page.getByRole("link", { name: "Add a job from the site" })).toBeVisible();
});

test("Grammi's blog: nothing about jobs, no database made, and an old link says what it's for", async ({ page }) => {
  await signIn(page, plain, "#/");
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add a job from the site" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain("openblog-capture");
  await page.goto(`${plain.origin}/admin/studio/#/capture`);
  await expect(page.getByRole("heading", { name: "Your blog isn't set up for jobs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Write something new" })).toBeVisible();
  await page.goto(`${plain.origin}/admin/studio/#/write`);
  await expect(page.getByRole("link", { name: /A job/ })).toHaveCount(0);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name))).not.toContain("openblog-capture");
  expect(existsSync(join(plain.dir, ".openblog", "captures"))).toBe(false);
});

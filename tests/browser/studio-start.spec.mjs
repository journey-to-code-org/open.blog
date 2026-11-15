import { test, expect } from "@playwright/test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axeClean, guardProviders, open, restartSite, startSite, stopSite } from "./helper-site.mjs";
import { api, eraseVoice } from "./voice-site.mjs";

// Getting started (Studio R9b, #/start): the server's switch in every value (and the server's
// environment beating the site's file), the key step with R8's rules, stories typed and told out
// loud, the voice step, You're ready, Finish later, a practice run that keeps nothing, the one
// reminder in Write, and Home's lines. No test reaches a real provider: the key check and the
// voice guide are answered here, and what "hears" a recording is a command on this computer.

const KEY = "sk-ant-api03-R9B-BROWSER-KNOWN-KEY-1a2b3c4d5e6f";
const TYPED = "we always made two pies TYPED-STORY-MARK-4417";
const SPOKEN = "My grandmother kept bees SPOKEN-STORY-MARK-5521";
const HEARS = { OPENBLOG_TRANSCRIBE_COMMAND: JSON.stringify(["sh", "-c", `echo '${SPOKEN}'`]) };
let site;
let unstubbed;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.afterAll(async () => { await stopSite(site); site = null; });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const screen = (page) => page.locator(".studio-start");
const heading = (page, name) => screen(page).getByRole("heading", { name, level: 2 });
const bar = (page) => screen(page).locator(".studio-start-bar");
const keyField = (page) => screen(page).getByRole("textbox", { name: "Paste the key", exact: true });
const keyFile = () => join(site.dir, ".openblog", "private", "assistant", "api-key");
const recordDir = () => join(site.dir, ".openblog", "private", "onboarding");
const realRecords = () => (existsSync(recordDir()) ? readdirSync(recordDir()).filter((name) => name.endsWith(".json")) : []);
const voiceFiles = () => { const dir = join(site.dir, ".openblog", "private", "context", "voice"); return existsSync(dir) ? readdirSync(dir) : []; };
const record = async (page) => (await (await page.request.get(`${site.origin}/admin/api/onboarding`)).json());

/** Start again from nothing for `user`: no record, no pieces. Opens a screen that never auto-opens. */
async function fresh(page, { user = "sam", keepKey = false } = {}) {
  await open(page, site, "#/posts", user);
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await eraseVoice(page, site);
  await api(page, site, "POST", "onboarding/reset", { user });
  if (!keepKey && existsSync(keyFile())) {
    const settings = await (await page.request.get(`${site.origin}/admin/api/assistant/settings`)).json();
    await api(page, site, "PUT", "assistant/settings", { provider: settings.provider, generationEndpoint: settings.generationEndpoint, model: settings.model, etag: settings.etag, credentialAction: "clear" });
  }
}

/** Save a key the way the screen does, so the key step isn't shown. */
async function saveKey(page) {
  const settings = await (await page.request.get(`${site.origin}/admin/api/assistant/settings`)).json();
  const saved = await api(page, site, "PUT", "assistant/settings", { provider: "anthropic", model: settings.model || "claude-test", etag: settings.etag, credentialAction: "replace", credential: KEY });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

async function home(page) {
  await page.goto("about:blank");
  await page.goto(`${site.origin}/admin/studio/#/`);
}

/** Everything the page could read back: the DOM with every field value, and every store. */
async function everythingThePageHolds(page) {
  return page.evaluate(async () => {
    const parts = [];
    const walk = (root) => {
      parts.push(root.innerHTML ?? "");
      for (const node of root.querySelectorAll("*")) {
        if ("value" in node && typeof node.value === "string") parts.push(node.value);
        for (const attribute of node.attributes) parts.push(attribute.value);
        if (node.shadowRoot) walk(node.shadowRoot);
      }
    };
    walk(document.documentElement);
    parts.push(document.title, location.href, document.cookie);
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i += 1) parts.push(store.key(i), store.getItem(store.key(i)));
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((resolve, reject) => { const opening = indexedDB.open(info.name); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
      for (const name of db.objectStoreNames) {
        const rows = await new Promise((resolve) => { const all = db.transaction(name).objectStore(name).getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => resolve([]); });
        parts.push(JSON.stringify(rows));
      }
      db.close();
    }
    parts.push(JSON.stringify(history.state ?? ""));
    return parts.join("\n");
  });
}

/** Type one story against the clock and finish it. */
async function typeStory(page, text, { card = 0 } = {}) {
  await screen(page).locator("choice-cards [role=radio]").nth(card).click();
  await screen(page).getByRole("button", { name: "Type it", exact: true }).click();
  const box = screen(page).locator("textarea.studio-voice-rough");
  await expect(box).toBeFocused();
  await box.pressSequentially(text, { delay: 2 });
  await screen(page).getByRole("button", { name: "I'm done" }).click();
}

// ---------------------------------------------------------------- the switch

test.describe("the switch", () => {
  test.beforeAll(async () => { site = await startSite("start-switch", { env: { OPENBLOG_STUDIO_ONBOARDING: "off" }, users: ["dana"] }); });
  test.afterAll(async () => { await stopSite(site); site = null; });

  test("off in the server's environment beats on in the site's file: it never opens, but the account menu still runs it", async ({ page }) => {
    expect(JSON.parse(readFileSync(join(site.dir, "openblog.json"), "utf8")).studio.onboarding, "a new site says on").toBe("on");
    await open(page, site, "#/");
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await expect(page.locator(".studio-home-start-card section")).toHaveCount(0);
    expect((await (await page.request.get(`${site.origin}/admin/api/meta`)).json()).onboarding).toEqual({ mode: "off", practice: false, due: false, step: expect.any(String), total: expect.any(Number), resume: false });
    expect(realRecords()).toEqual([]);
    // From the account menu it runs, and writes her real record.
    await page.locator("dashboard-shell header dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Getting started", exact: true }).click();
    await expect(heading(page, "Turn on your writing helper")).toBeFocused();
    await expect(page).toHaveURL(/#\/start\/helper$/);
    expect(realRecords()).toHaveLength(1);
    // No reminder in Write while it is off.
    let asked = 0;
    await page.route("**/admin/api/onboarding/nudge", (route) => { asked += 1; return route.fallback(); });
    await screen(page).locator(".studio-start-bar dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Skip the rest" }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await open(page, site, "#/write/new/story");
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
    await page.waitForTimeout(600);
    expect(asked).toBe(0);
    await expect(page.locator(".studio-story-nudge-card")).toHaveCount(0);
  });

  test("the site's file alone (on) opens it at Home on the first load, but not over another address", async ({ page }) => {
    await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: null });
    await fresh(page);
    // A link to somewhere else opens that; Home then shows the card.
    await open(page, site, "#/posts");
    await expect(page).toHaveURL(/#\/posts$/);
    await page.evaluate(() => { location.hash = "#/"; });
    const card = page.locator(".studio-home-start-card section");
    await expect(card.getByRole("heading", { name: "Finish getting started" })).toBeVisible();
    await expect(card).toContainText("Step 1 of 3: Turn on your writing helper.");
    // A fresh load at Home opens it.
    await home(page);
    await expect(page).toHaveURL(/#\/start\/helper$/);
    await expect(heading(page, "Turn on your writing helper")).toBeFocused();
    await expect(screen(page).locator(".studio-start-hello")).toHaveText("Welcome");
    await expect(screen(page).locator(".studio-meta").first()).toHaveText("Step 1 of 3");
    await expect(screen(page).getByRole("navigation", { name: "Getting started, step 1 of 3" })).toBeVisible();
    // The frame: no navigation, no Find; the account menu stays, and so does sign out.
    await expect(page.locator("dashboard-shell .shell > nav")).toBeHidden();
    await expect(page.getByRole("button", { name: /^Find/ })).toBeHidden();
    await page.locator("dashboard-shell header dropdown-menu button").first().click();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");
    expect((await record(page)).mode).toBe("on");
    await axeClean(page, "key step", ".studio-start");
  });

  test("the server's environment wins over the site's file in both directions, and a value that isn't one is off with a reason", async ({ page }) => {
    const config = join(site.dir, "openblog.json");
    const original = readFileSync(config, "utf8");
    const json = JSON.parse(original);
    json.studio.onboarding = "off";
    writeFileSync(config, JSON.stringify(json, null, 2));
    try {
      await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "on" });
      await fresh(page);
      await home(page);
      await expect(page).toHaveURL(/#\/start\/helper$/);
      const accounts = await (await page.request.get(`${site.origin}/admin/api/onboarding/accounts`)).json();
      expect([accounts.mode, accounts.source]).toEqual(["on", "environment"]);

      await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "sometimes" });
      await open(page, site, "#/");
      await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
      const details = page.locator(".studio-start-details");
      await details.locator("summary").click();
      await expect(details).toContainText("Getting started is off, set by the server's environment.");
      await expect(details).toContainText("sometimes");
      expect(site.output).toContain("OPENBLOG_STUDIO_ONBOARDING");
    } finally {
      writeFileSync(config, original);
    }
  });

  test("on:<round> shows it again once to an account that finished another round", async ({ page }) => {
    await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "on" });
    await fresh(page);
    await home(page);
    await expect(heading(page, "Turn on your writing helper")).toBeFocused();
    await screen(page).locator(".studio-start-bar dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Skip the rest" }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await expect(page.locator("toast-region")).toContainText("Okay. Getting started is in the menu if you want it.");
    await home(page);
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await expect(page.locator(".studio-home-start-card section")).toHaveCount(0);

    await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "on:2026-11-20" });
    await open(page, site, "#/");
    await expect(page).toHaveURL(/#\/start\/helper$/);
    await screen(page).locator(".studio-start-bar dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Skip the rest" }).click();
    await home(page);
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    expect((await record(page)).record.round).toBe("2026-11-20");
  });
});

// ---------------------------------------------------------------- the steps

// A stand-in for the recorder and microphone, so the run needs no device (from studio-new-job.spec.mjs).
const fakeMicrophone = ({ denied, supported }) => {
  if (!navigator.mediaDevices) return; // about:blank
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

/** A proposal as the server answers `assistant/voice-guide`. */
const proposal = () => ({
  schemaVersion: 1, markdown: "# Voice\n\n## How you start\n- You open with what you always did\n", portableAllowed: false,
  merge: { changes: 0, lines: ["# Voice", "", "## How you start", "- You open with what you always did"],
    sections: [{ heading: "How you start", traits: [{ status: "added", proposed: { statement: "You open with what you always did", quote: "we always made two pies", sample: "a-rough.md", oneSample: true } }] }],
    unknown: [], freeText: false, ownSections: [] },
  current: { exists: false, visibility: null, content: null }, diff: "+++ voice.md (proposed)\n+# Voice\n",
  targets: { portable: { exists: false, valid: true, etag: null }, private: { exists: false, valid: true, etag: null } },
  samples: [], skill: { id: "voice-guide", version: "1" }, provider: { type: "anthropic", model: "test" }, research: { enabled: false },
});

test.describe("the steps", () => {
  test.beforeAll(async () => { site = await startSite("start-steps", { env: { OPENBLOG_STUDIO_ONBOARDING: "on", ...HEARS } }); });
  test.afterAll(async () => { await stopSite(site); site = null; });

  test("the key step keeps R8's rules: a wrong shape is caught, a refused key is cleared at once, an accepted one goes on, and the key is nowhere afterwards", async ({ page }) => {
    const consoleLines = [];
    page.on("console", (message) => consoleLines.push(message.text()));
    await fresh(page);
    await home(page);
    await expect(heading(page, "Turn on your writing helper")).toBeFocused();
    await expect(bar(page).getByRole("button", { name: "‹ Back" })).toBeHidden();
    const field = keyField(page);
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveAttribute("autocomplete", "new-password");
    const save = bar(page).getByRole("button", { name: "Save the key" });

    // Nothing typed.
    await save.click();
    await expect(screen(page)).toContainText("Paste the key first.");

    // Her blog password, say: caught before anything is sent.
    const sentBodies = [];
    page.on("request", (request) => { if (/assistant\/settings$/.test(request.url()) && request.method() === "PUT") sentBodies.push(request.postData() || ""); });
    await field.fill("hunter2-not-a-key");
    await save.click();
    await expect(screen(page)).toContainText("That doesn't look like a Anthropic key. Check you pasted the key, not a password.");
    expect(sentBodies).toEqual([]);
    await expect(bar(page).getByRole("button", { name: "Save it anyway" })).toBeVisible();

    // The company refuses the key: the field is empty and the saved key is removed again.
    let verdict = { status: 502, json: { error: "Anthropic returned HTTP 401", code: "key-rejected" } };
    await page.route("**/admin/api/assistant/check", (route) => route.fulfill(verdict));
    await field.fill(KEY);
    await bar(page).getByRole("button", { name: "Save the key" }).click();
    await expect(screen(page)).toContainText("Anthropic didn't accept that key. Check you copied all of it, then paste it again.");
    await expect(field).toHaveValue("");
    await expect(field).toBeFocused();
    expect(existsSync(keyFile()), "a refused key never sits there").toBe(false);
    expect(await everythingThePageHolds(page)).not.toContain("R9B-BROWSER-KNOWN");

    // Leaving with something typed asks once, without showing it.
    await field.fill(KEY);
    await bar(page).getByRole("button", { name: "Finish later" }).click();
    const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Leave without saving the key?" });
    await expect(dialog.getByRole("button", { name: "Stay" })).toBeFocused();
    expect(await dialog.innerText()).not.toContain("R9B");
    await dialog.getByRole("button", { name: "Stay" }).click();
    await expect(page.locator("modal-dialog[open]")).toHaveCount(0);
    await expect(field).toBeFocused();

    // Accepted.
    verdict = { json: { ok: true } };
    await page.keyboard.press("Control+Enter");
    await expect(screen(page)).toContainText("Anthropic accepted the key. Your writing helper is on.");
    const next = bar(page).getByRole("button", { name: "Next: tell a few stories" });
    await expect(next).toBeFocused();
    expect(readFileSync(keyFile(), "utf8")).toContain(KEY);
    // Saved, removed again when refused, saved: the key only ever travelled inside those requests.
    expect(sentBodies.map((body) => JSON.parse(body).credentialAction)).toEqual(["replace", "clear", "replace"]);
    expect(await everythingThePageHolds(page)).not.toContain("R9B-BROWSER-KNOWN");
    expect(consoleLines.join("\n")).not.toContain("R9B-BROWSER-KNOWN");
    expect(site.output).not.toContain("R9B-BROWSER-KNOWN");

    await next.click();
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    await expect(page).toHaveURL(/#\/start\/stories$/);
    await expect(screen(page).locator(".studio-meta").first()).toHaveText("Step 2 of 3");
    await expect(screen(page).locator(".studio-start-hello")).toHaveCount(0);
    expect((await record(page)).record.steps.helper).toBe("done");
    // Back is a button here (an installed app has no browser Back).
    await bar(page).getByRole("button", { name: "‹ Back" }).click();
    await expect(heading(page, "Turn on your writing helper")).toBeFocused();
  });

  test("Skip — the person who set up your site will set this up: the step is skipped and the stories come next", async ({ page }) => {
    await fresh(page);
    await home(page);
    await screen(page).getByRole("button", { name: "Skip — the person who set up your site will set this up" }).click();
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    expect((await record(page)).record.steps.helper).toBe("skipped");
    expect(existsSync(keyFile())).toBe(false);
    await axeClean(page, "stories step", ".studio-start");
  });

  test("a key already on the site: no key step and no mention of one; a typed story resumes after a reload and is kept private", async ({ page }) => {
    await fresh(page);
    await saveKey(page);
    await home(page);
    await expect(page).toHaveURL(/#\/start\/stories$/);
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    await expect(screen(page).locator(".studio-meta").first()).toHaveText("Step 1 of 2");
    await expect(screen(page).locator(".studio-start-hello")).toHaveText("Welcome");
    expect(await screen(page).innerText()).not.toMatch(/\bkey\b/i);
    await expect(screen(page).locator(".studio-start-progress")).toHaveText("0 of 3 told");
    await expect(screen(page).locator("choice-cards [role=radio]")).toHaveCount(3);

    // Choosing how before choosing what says so.
    await screen(page).getByRole("button", { name: "Type it", exact: true }).click();
    await expect(screen(page)).toContainText("Choose a prompt first.");

    await screen(page).locator("choice-cards [role=radio]").first().click();
    await screen(page).getByRole("button", { name: "Type it", exact: true }).click();
    const box = screen(page).locator("textarea.studio-voice-rough");
    await expect(box).toBeFocused();
    await box.pressSequentially("we always made two pies", { delay: 2 });
    await expect(screen(page).locator(".studio-voice-save")).toHaveText("Saved.");

    // A reload mid-story lands on the same step, inside the clock, with her words.
    await page.reload();
    await expect(page).toHaveURL(/#\/start\/stories$/);
    await expect(screen(page).locator("textarea.studio-voice-rough")).toHaveValue("we always made two pies");
    await expect(screen(page).getByRole("timer", { name: "Time left" })).toBeVisible();
    await screen(page).locator("textarea.studio-voice-rough").pressSequentially(" TYPED-STORY-MARK-4417", { delay: 2 });
    await screen(page).getByRole("button", { name: "I'm done" }).click();
    await expect(screen(page).locator(".studio-start-progress")).toHaveText("1 of 3 told");
    await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
    await expect(bar(page).getByRole("button", { name: "Tell another" })).toBeFocused();
    await expect(screen(page).locator(".studio-voice-row")).toContainText("· typed · 6 words");

    // Private: in the private folder only, never among the site's posts or its built pages.
    const files = voiceFiles();
    expect(files).toHaveLength(1);
    const story = readFileSync(join(site.dir, ".openblog", "private", "context", "voice", files[0]), "utf8");
    expect(story).toContain(TYPED);
    expect(story).toMatch(/^by: sam$/m);
    expect(story).toMatch(/^told: typed$/m);
    expect(site.output).not.toContain("TYPED-STORY-MARK");
    const rec = (await record(page)).record;
    expect(rec.stories).toHaveLength(1);
    expect(JSON.stringify(rec)).not.toContain("TYPED-STORY-MARK");

    // Read it, then throw it away.
    await screen(page).getByRole("button", { name: /^Read it: / }).click();
    const sheet = page.locator("side-sheet dialog[open]");
    await expect(sheet.getByRole("region", { name: "Your rough draft, as you wrote it" })).toHaveText(TYPED);
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
    await screen(page).getByRole("button", { name: /^Throw this one away: / }).click();
    const ask = page.locator("modal-dialog dialog").filter({ hasText: "Throw away this story?" });
    await expect(ask.getByRole("button", { name: "Keep it" })).toBeFocused();
    await ask.getByRole("button", { name: "Throw it away" }).click();
    await expect(screen(page).locator(".studio-start-progress")).toHaveText("0 of 3 told");
    expect(voiceFiles()).toEqual([]);
    expect((await record(page)).record.stories).toEqual([]);
  });
  test("a story told out loud: nothing is recorded or sent before she says so, the recording survives a reload, and only the words are kept", async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { denied: "", supported: true });
    const sent = [];
    page.on("request", (request) => { if (/voice\/spoken/.test(request.url())) sent.push(request.url()); });
    await fresh(page);
    await saveKey(page);
    await home(page);
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    await screen(page).locator("choice-cards [role=radio]").first().click();
    await screen(page).getByRole("button", { name: "Say it out loud", exact: true }).click();

    // Before anything is recorded: where it goes. Here the site's own computer hears it.
    const sheet = page.locator("side-sheet.studio-story-sheet dialog[open]");
    await expect(sheet).toContainText("Before you start");
    await expect(sheet.getByRole("region", { name: "Where your recording goes" })).toContainText("Nothing leaves it.");
    expect(await page.evaluate(() => window.__mic.asked), "the microphone isn't asked for before she taps").toBe(0);
    await sheet.getByRole("button", { name: "Start recording" }).click();
    await expect(screen(page).getByRole("timer")).toContainText("Recording 0:0");
    expect(await page.evaluate(() => window.__mic.asked)).toBe(1);
    // Escape never stops a recording.
    await page.keyboard.press("Escape");
    await expect(screen(page).getByRole("timer")).toBeVisible();
    await screen(page).getByRole("button", { name: "Stop recording" }).click();
    await expect(screen(page).locator("audio[aria-label='Your recording']")).toBeVisible();
    await expect(screen(page).getByRole("button", { name: "Use this recording" })).toBeFocused();
    expect(sent).toEqual([]);
    await axeClean(page, "a recorded story", ".studio-start");

    // Kept on this phone: Home says so, and signing out asks first.
    await page.evaluate(() => { location.hash = "#/"; });
    const kept = page.locator(".studio-home-story-kept content-card");
    await expect(kept).toContainText("A recorded story is kept on this phone.");
    await page.locator("dashboard-shell header dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    const asking = page.locator("modal-dialog dialog").filter({ hasText: "a recorded story that hasn't been turned into words" });
    await expect(asking.getByRole("button", { name: "Stay signed in" })).toBeFocused();
    await asking.getByRole("button", { name: "Stay signed in" }).click();
    await kept.getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/#\/start\/stories$/);

    // A reload (the app closed): the recording is still here, and still nothing has gone anywhere.
    await page.reload();
    await expect(screen(page)).toContainText("Your recording stopped when you left. It's kept on this phone.");
    expect(sent).toEqual([]);
    await screen(page).getByRole("button", { name: "Use this recording" }).click();
    // A new visit says where it goes again before it goes.
    await expect(sheet.getByRole("region", { name: "Where your recording goes" })).toBeVisible();
    expect(sent).toEqual([]);
    await sheet.getByRole("button", { name: "Use this recording" }).click();
    const heard = screen(page).getByRole("region", { name: "Your story, as you said it" });
    await expect(heard).toHaveText(SPOKEN);
    expect(await heard.evaluate((node) => node.isContentEditable || node.matches("textarea, input"))).toBe(false);
    expect(sent).toHaveLength(1);
    await expect(screen(page).locator(".studio-start-progress")).toHaveText("1 of 3 told");
    await expect(screen(page).locator(".studio-voice-row")).toContainText("· told out loud · 5 words");

    // Only the words are kept: no recording on the phone, none on the server, nothing in its output.
    expect(await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const opening = indexedDB.open("studio-story"); opening.onsuccess = () => resolve(opening.result); });
      return new Promise((resolve) => { const all = db.transaction("recording").objectStore("recording").getAll(); all.onsuccess = () => resolve(all.result.length); });
    })).toBe(0);
    const tmp = join(recordDir(), "tmp");
    expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([]);
    const files = voiceFiles();
    expect(files).toHaveLength(1);
    const story = readFileSync(join(site.dir, ".openblog", "private", "context", "voice", files[0]), "utf8");
    expect(story).toMatch(/^told: spoken$/m);
    expect(story).toContain(SPOKEN);
    expect(site.output).not.toContain("SPOKEN-STORY-MARK");
    expect(site.output).toMatch(/voice: spoken piece saved for sam \(5 words\)/);
    // In Your writing voice it carries a word and a shape of its own.
    await page.evaluate(() => { location.hash = "#/voice"; });
    await expect(page.locator(".studio-voice-hub")).toContainText("◎ Told out loud");
  });

  test("the microphone refused: this phone's own steps, and Type it instead keeps the prompt she chose", async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { denied: "NotAllowedError", supported: true });
    await fresh(page);
    await saveKey(page);
    await home(page);
    await screen(page).locator("choice-cards [role=radio]").nth(1).click();
    const title = await screen(page).locator("choice-cards [role=radio]").nth(1).innerText();
    await screen(page).getByRole("button", { name: "Say it out loud", exact: true }).click();
    await page.locator("side-sheet.studio-story-sheet dialog[open]").getByRole("button", { name: "Start recording" }).click();
    await expect(screen(page)).toContainText("isn't allowed to use the microphone");
    await screen(page).getByRole("button", { name: "Type it", exact: true }).last().click();
    await expect(screen(page).locator("textarea.studio-voice-rough")).toBeFocused();
    await expect(screen(page)).toContainText(title.split("\n")[0].trim());
    await screen(page).getByRole("button", { name: "Start over" }).click();
    await page.locator("modal-dialog dialog").getByRole("button", { name: "Start over" }).click();
  });

  test("stories, then the helper learns from them only after the box says what goes; You're ready marks her done and it doesn't open again", async ({ page }) => {
    const consoleLines = [];
    page.on("console", (message) => consoleLines.push(message.text()));
    await fresh(page);
    await saveKey(page);
    await home(page);
    await typeStory(page, TYPED);
    await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
    await bar(page).getByRole("button", { name: "That's enough for now" }).click();

    await expect(heading(page, "Let your helper learn how you sound")).toBeFocused();
    await expect(page).toHaveURL(/#\/start\/voice$/);
    await expect(screen(page).locator(".studio-meta").first()).toHaveText("Step 2 of 2");
    const sentGuide = [];
    await page.route("**/admin/api/assistant/voice-guide", (route) => { sentGuide.push(route.request().postDataJSON()); return route.fulfill({ json: proposal() }); });
    await expect(screen(page).getByRole("group", { name: "Learn from these stories" })).toBeVisible();
    await expect(screen(page).locator(".studio-guide-pieces input[type=checkbox]")).toHaveCount(1);
    await expect(screen(page).locator(".studio-guide-pieces input[type=checkbox]")).toBeChecked();
    await expect(screen(page).locator(".studio-goes")).toContainText("Anthropic");
    expect(sentGuide, "nothing is sent before she presses").toEqual([]);
    await axeClean(page, "voice step", ".studio-start");
    await screen(page).getByRole("button", { name: "Let my helper learn" }).click();
    await expect(screen(page)).toContainText("What your helper noticed");
    expect(sentGuide).toHaveLength(1);
    expect(existsSync(join(site.dir, ".openblog", "private", "context", "voice.md")), "nothing is saved until she says so").toBe(false);
    await screen(page).getByRole("button", { name: "Save my voice guide" }).click();
    await expect.poll(() => existsSync(join(site.dir, ".openblog", "private", "context", "voice.md"))).toBe(true);
    const next = bar(page).getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeFocused();
    await next.click();

    await expect(heading(page, "You're ready")).toBeFocused();
    await expect(page).toHaveURL(/#\/start\/done$/);
    const lines = screen(page).locator(".studio-start-done li");
    await expect(lines).toHaveText([/✓\s+Done:\s+Your writing helper is on\./, /✓\s+Done:\s+1 story kept, private\./, /✓\s+Done:\s+Your helper has learned how you sound\./]);
    await expect(screen(page).getByRole("link", { name: "See your stories" })).toHaveAttribute("href", "#/voice");
    // (A new site comes with posts, so it isn't "your first".)
    await expect(bar(page).getByRole("link", { name: "Write a post" })).toHaveAttribute("href", "#/write/new");
    await expect(bar(page).getByRole("button", { name: "Finish later" })).toBeHidden();
    await axeClean(page, "done", ".studio-start");
    const rec = (await record(page)).record;
    expect([rec.status, rec.step, rec.steps.voice]).toEqual(["done", "done", "done"]);
    expect(site.output).toMatch(/onboarding: sam finished/);
    expect(site.output).not.toContain("TYPED-STORY-MARK");
    expect(consoleLines.join("\n")).not.toContain("TYPED-STORY-MARK");
    // Nothing of Getting started is kept in this phone's storage.
    expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) => /start|onboard/i.test(key) && key !== "studio:last-start"))).toEqual([]);

    // Not again by itself, no card; Home's own invitation stays away too.
    await home(page);
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await expect(page.locator(".studio-home-start-card section")).toHaveCount(0);
    await expect(page.locator(".studio-home-voice-invite section")).toHaveCount(0);
    // The browser's Back to a step's address shows You're ready, never a new run.
    await page.evaluate(() => { location.hash = "#/start/voice"; });
    await expect(heading(page, "You're ready")).toBeFocused();
    expect((await record(page)).record.status).toBe("done");
    // From the account menu: a new run at the first needed step, in the same round.
    await page.locator("dashboard-shell header dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Getting started", exact: true }).click();
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    const again = (await record(page)).record;
    expect([again.status, again.round]).toEqual(["in-progress", "1"]);
    await expect(screen(page).locator(".studio-voice-row")).toHaveCount(0);
    expect(voiceFiles(), "her stories are untouched by a new run").toHaveLength(1);
  });

  test("Finish later keeps the step: Home shows the card and it doesn't open by itself again for 20 hours", async ({ page }) => {
    await fresh(page);
    await saveKey(page);
    await home(page);
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    await bar(page).getByRole("button", { name: "Finish later" }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await expect(page.locator("toast-region")).toContainText("It'll be here when you come back.");
    const card = page.locator(".studio-home-start-card section");
    await expect(card).toContainText("Step 1 of 2: Tell a few short stories.");
    await home(page);
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await expect(card).toBeVisible();
    // 21 hours on, a fresh load opens it where she left it, and says so.
    await page.clock.install({ time: new Date(Date.now() + 21 * 3600 * 1000) });
    await home(page);
    await expect(page).toHaveURL(/#\/start\/stories$/);
    await expect(screen(page)).toContainText("Picked up where you left off.");
  });

  test("keyboard only, with reduced motion: skip the stories, and the voice step is passed over with the reason on the last screen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fresh(page);
    await saveKey(page);
    await home(page);
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".studio-start")).animationName)).toBe("none");
    const skip = screen(page).getByRole("button", { name: "Skip stories for now" });
    for (let i = 0; i < 30 && !(await skip.evaluate((node) => node === document.activeElement)); i += 1) await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(heading(page, "You're ready")).toBeFocused();
    await expect(screen(page).locator(".studio-start-done li")).toHaveText([/✓\s+Done:\s+Your writing helper is on\./, /–\s+Not yet:\s+No stories yet\./, /–\s+Not yet:\s+When your writing helper is on, it can learn from your stories/]);
    const rec = (await record(page)).record;
    expect([rec.status, rec.steps.stories, rec.steps.voice]).toEqual(["done", "skipped", "not-ready"]);
    // Finished is finished: no Back from here, by button or by key.
    await expect(bar(page).getByRole("button", { name: "‹ Back" })).toBeHidden();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(heading(page, "You're ready")).toBeFocused();
    await expect(page).toHaveURL(/#\/start\/done$/);
  });
});

// ---------------------------------------------------------------- A piece, the reminder, Home

const recordFile = () => join(recordDir(), realRecords()[0]);
/** Pretend the reminder was last shown on other days (the server decides by its own clock). */
function shownOn(days) {
  const kept = JSON.parse(readFileSync(recordFile(), "utf8"));
  kept.nudge = { ...(kept.nudge || {}), shown: days };
  writeFileSync(recordFile(), JSON.stringify(kept));
}
const nudgeCard = (page) => page.locator(".studio-story-nudge-card");
async function newPost(page) {
  await open(page, site, "#/write/new/story");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

test.describe("afterwards", () => {
  test.beforeAll(async () => { site = await startSite("start-after", { env: { OPENBLOG_STUDIO_ONBOARDING: "on" }, users: ["dana"] }); });
  test.afterAll(async () => { await stopSite(site); site = null; });

  test("A piece can be thrown away from More, after a question that says it can't be brought back", async ({ page }) => {
    await fresh(page);
    await saveKey(page);
    await home(page);
    await typeStory(page, TYPED);
    await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
    const id = (await record(page)).record.stories[0];
    await bar(page).getByRole("button", { name: "Finish later" }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    await page.evaluate((piece) => { location.hash = `#/voice/piece/${piece}`; }, id);
    const piece = page.locator(".studio-voice-piece-page");
    await expect(piece.getByRole("region", { name: "Your rough draft, as you wrote it" })).toHaveText(TYPED);
    await piece.locator(".studio-voice-top dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Throw this piece away…" }).click();
    const ask = page.locator("modal-dialog dialog").filter({ hasText: "It can't be brought back." });
    await expect(ask).toContainText("Throw away “");
    await expect(ask.getByRole("button", { name: "Keep it" })).toBeFocused();
    await ask.getByRole("button", { name: "Keep it" }).click();
    expect(voiceFiles()).toHaveLength(1);
    await piece.locator(".studio-voice-top dropdown-menu button").first().click();
    await page.getByRole("menuitem", { name: "Throw this piece away…" }).click();
    await ask.getByRole("button", { name: "Throw it away" }).click();
    await expect(page).toHaveURL(/#\/voice$/);
    await expect(page.locator("toast-region")).toContainText("Thrown away.");
    expect(voiceFiles()).toEqual([]);
  });

  test("the reminder in Write: only on a new post, only when she left the stories untold, three times at most and a week apart", async ({ page }) => {
    await fresh(page);
    await saveKey(page);
    await home(page);
    await screen(page).getByRole("button", { name: "Skip stories for now" }).click();
    await expect(heading(page, "You're ready")).toBeFocused();

    // Never on a post that exists.
    let asked = 0;
    await page.route("**/admin/api/onboarding/nudge", (route) => { if (route.request().method() === "GET") asked += 1; return route.fallback(); });
    await open(page, site, `#/write/${encodeURIComponent("posts/hello-world.md")}`);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
    await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
    await page.waitForTimeout(400);
    expect(asked).toBe(0);
    await expect(nudgeCard(page)).toHaveCount(0);

    // A new post: the card, above the title, and it doesn't take the focus.
    await newPost(page);
    await expect(nudgeCard(page).getByRole("heading", { name: "Want your helper to sound like you?", level: 3 })).toBeVisible();
    await expect(nudgeCard(page)).toContainText("the stories never appear on your blog.");
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
    await expect.poll(async () => (await record(page)).record.nudge.shown.length).toBe(1);
    await axeClean(page, "the reminder", ".studio-write");
    // Typing doesn't move or remove it.
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Soup");
    await expect(nudgeCard(page)).toBeVisible();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("");
    await nudgeCard(page).getByRole("button", { name: "Not now" }).click();
    await expect(nudgeCard(page)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
    await expect(page.locator("toast-region")).toContainText("Okay. It's under Getting started whenever you want it.");

    // Not again this week.
    await newPost(page);
    await page.waitForTimeout(500);
    await expect(nudgeCard(page)).toHaveCount(0);

    // A week on: again. Don't ask again, and Undo.
    shownOn(["2026-01-01"]);
    await newPost(page);
    await expect(nudgeCard(page)).toBeVisible();
    await nudgeCard(page).getByRole("button", { name: "Don't ask again" }).click();
    await expect(nudgeCard(page)).toHaveCount(0);
    await expect(page.locator("toast-region")).toContainText("Okay, it won't ask again. Getting started is in the menu if you change your mind.");
    expect((await record(page)).record.nudge.stopped).toBe(true);
    await page.locator(".studio-story-nudge").getByRole("button", { name: "Undo" }).click();
    await expect(nudgeCard(page)).toBeVisible();
    expect((await record(page)).record.nudge.stopped).toBe(false);

    // The third time is the last.
    shownOn(["2026-01-01", "2026-01-10"]);
    await newPost(page);
    await expect(nudgeCard(page)).toBeVisible();
    await expect.poll(async () => (await record(page)).record.nudge.shown.length).toBe(3);
    shownOn(["2026-01-01", "2026-01-10", "2026-01-20"]);
    await newPost(page);
    await page.waitForTimeout(500);
    await expect(nudgeCard(page)).toHaveCount(0);
  });

  test("the reminder never shows once she has typed, and Tell a few stories now comes back to her post", async ({ page }) => {
    await fresh(page);
    await saveKey(page);
    await home(page);
    await screen(page).getByRole("button", { name: "Skip stories for now" }).click();
    await expect(heading(page, "You're ready")).toBeFocused();

    // The answer comes late and she is already typing: nothing appears under her fingers.
    let release = null;
    const held = new Promise((done) => { release = done; });
    let slow = true;
    await page.route("**/admin/api/onboarding/nudge", async (route) => {
      if (route.request().method() === "GET" && slow) await held;
      return route.fallback().catch(() => {});
    });
    await newPost(page);
    await page.getByRole("textbox", { name: "Title", exact: true }).pressSequentially("Soup", { delay: 5 });
    release();
    await page.waitForTimeout(800);
    await expect(nudgeCard(page)).toHaveCount(0);
    expect((await record(page)).record.nudge.shown).toEqual([]);

    // In time: the card; saying yes leaves through Write's own guard and comes back here.
    slow = false;
    await newPost(page);
    await expect(nudgeCard(page)).toBeVisible();
    await nudgeCard(page).getByRole("button", { name: "Tell a few stories now" }).click();
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    await expect(page).toHaveURL(/#\/start\/stories\?back=/);
    await expect(bar(page).getByRole("button", { name: "Finish later" })).toHaveCount(0);
    await typeStory(page, TYPED);
    await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
    await bar(page).getByRole("button", { name: "Back to your post" }).click();
    await expect(page).toHaveURL(/#\/write/);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
    // With a story of her own, it is never due again.
    shownOn([]);
    await newPost(page);
    await page.waitForTimeout(500);
    await expect(nudgeCard(page)).toHaveCount(0);
  });

  test("Home, for whoever helps: the switch, every account's line with no story in it, and Show it again with Undo", async ({ page }) => {
    await fresh(page);
    await saveKey(page);
    await home(page);
    await typeStory(page, TYPED);
    await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
    await bar(page).getByRole("button", { name: "Finish later" }).click();
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeFocused();
    const details = page.locator(".studio-start-details");
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").click();
    await expect(details).toContainText("Getting started is on, set by the server's environment.");
    const rows = details.locator(".studio-start-account");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(/sam · in progress · stories 1 of 3 · round 1 · started \d{4}-\d\d-\d\d/);
    await expect(rows.nth(1)).toContainText("dana · not started");
    await expect(rows.nth(1).getByRole("button")).toHaveCount(0);
    await expect(details).toContainText("Their stories stay; erase them under Your writing voice.");
    expect(await details.innerText()).not.toContain("TYPED-STORY-MARK");
    await axeClean(page, "Home with the details open", ".studio-home");

    await rows.nth(0).getByRole("button", { name: "Show it again at next sign-in: sam" }).click();
    await expect(details).toContainText("Next time, sam will see Getting started.");
    await expect(rows.nth(0)).toContainText("sam · not started");
    expect(realRecords()).toEqual([]);
    expect(voiceFiles(), "a reset never touches her stories").toHaveLength(1);
    expect(site.output).toMatch(/onboarding: sam reset sam/);
    await details.getByRole("button", { name: "Undo" }).click();
    await expect(details).toContainText("Undone: sam is back where they were.");
    await expect(rows.nth(0)).toContainText("sam · in progress · stories 1 of 3");
    expect(realRecords()).toHaveLength(1);
    expect(site.output).not.toContain("TYPED-STORY-MARK");
  });
});

// ---------------------------------------------------------------- a practice run

test.describe("rehearse", () => {
  test.beforeAll(async () => { site = await startSite("start-rehearse", { env: { OPENBLOG_STUDIO_ONBOARDING: "on" } }); });
  test.afterAll(async () => { await stopSite(site); site = null; });

  test("a practice run opens every time, says so on every step, keeps no story and no voice guide, and never touches her record", async ({ page }) => {
    // Her real record first: in progress, nothing told.
    await fresh(page);
    await saveKey(page);
    await home(page);
    await expect(heading(page, "Tell a few short stories")).toBeFocused();
    const realBefore = readFileSync(recordFile(), "utf8");
    const practiceDir = join(recordDir(), "practice");

    await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "rehearse" });
    await open(page, site, "#/");
    await expect(page).toHaveURL(/#\/start\/stories$/);
    const strip = screen(page).locator(".studio-banner alert-banner");
    await expect(strip).toContainText("Practice run: stories and voice guides made here aren't kept. A key you save is kept.");
    expect((await (await page.request.get(`${site.origin}/admin/api/meta`)).json()).onboarding).toMatchObject({ mode: "rehearse", practice: true, due: true });
    await typeStory(page, TYPED);
    await expect(screen(page)).toContainText("Kept. That's 1 of 3.");
    expect(voiceFiles(), "a practice story is never among her pieces").toEqual([]);
    expect(existsSync(practiceDir)).toBe(true);
    await axeClean(page, "practice stories", ".studio-start");
    await bar(page).getByRole("button", { name: "That's enough for now" }).click();

    await expect(heading(page, "Let your helper learn how you sound")).toBeFocused();
    await expect(strip).toBeVisible();
    const sentGuide = [];
    await page.route("**/admin/api/assistant/voice-guide", (route) => { sentGuide.push(route.request().postDataJSON()); return route.fulfill({ json: proposal() }); });
    await screen(page).getByRole("button", { name: "Let my helper learn" }).click();
    await expect(screen(page)).toContainText("What your helper noticed");
    expect(sentGuide[0].practice).toBe(true);
    await expect(screen(page).getByRole("button", { name: "Save my voice guide" })).toHaveCount(0);
    const noSave = screen(page).getByRole("button", { name: "Practice: not saved" });
    await expect(noSave).toHaveAttribute("aria-disabled", "true");
    await noSave.click({ force: true });
    await page.keyboard.press("Control+Enter");
    await bar(page).getByRole("button", { name: "Next", exact: true }).click();
    await expect(heading(page, "You're ready")).toBeFocused();
    await expect(strip).toBeVisible();
    expect(existsSync(join(site.dir, ".openblog", "private", "context", "voice.md")), "a practice guide is never saved").toBe(false);
    expect(readFileSync(recordFile(), "utf8"), "her real record is exactly as it was").toBe(realBefore);
    expect(realRecords()).toHaveLength(1);

    // Nothing of it in Your writing voice.
    await page.evaluate(() => { location.hash = "#/voice"; });
    await expect(page.locator(".studio-voice-hub")).toBeVisible();
    await expect(page.locator(".studio-voice-hub .studio-voice-row")).toHaveCount(0);
    // And it opens again at the next load, from the start, whatever was finished.
    await home(page);
    await expect(page).toHaveURL(/#\/start\/stories$/);
    await expect(screen(page).locator(".studio-start-progress")).toHaveText("0 of 3 told");
    expect(site.output).not.toContain("TYPED-STORY-MARK");

    // Back to on: practice is cleared when the server starts, and she is where she really was.
    await restartSite(site, { OPENBLOG_STUDIO_ONBOARDING: "on" });
    expect(existsSync(practiceDir)).toBe(false);
    expect(site.output).toMatch(/onboarding: cleared practice/);
    await open(page, site, "#/");
    await expect(page).toHaveURL(/#\/start\/stories$/);
    await expect(screen(page).locator(".studio-banner alert-banner")).toHaveCount(0);
    await expect(screen(page).locator(".studio-start-progress")).toHaveText("0 of 3 told");
    expect(readFileSync(recordFile(), "utf8")).toBe(realBefore);
  });
});

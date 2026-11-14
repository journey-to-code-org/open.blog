import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

// Notifications in Studio (R3): the real binary and Admin routes, against a scripted stand-in for
// the hosted push function. The browser's notification permission is granted and its PushManager is
// stubbed (headless Chrome has no push service), so the screen's own steps run for real: the worker
// at /admin/sw.js, the sign-up, the server's list. Also: the account menu, the quiet link on
// Comments, a tapped notification's message going through the router, the old Admin's bridge, and
// axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const KEY = `adm_${randomBytes(24).toString("hex")}`;
const PUBLIC = "BNJXQLrFqB91iIEvDTQE-lvUxvYyB_Hj57arqlCDifnNudW0TeOybFZdAm45MSdoDRrmo7yK48iuCh2rOHYV7MM";
const IPAD = { id: "22222222-2222-4222-8222-222222222222", device: "0".repeat(32), label: "Kitchen iPad", kinds: ["comment", "quote"], createdAt: "2026-11-01T12:00:00.000Z", lastSentAt: null };
let hosted;
let hostedPort;
let configured;
let plain;
const state = { devices: [], seen: [], tests: [] };

const freePort = async () => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  return port;
};
const uuid = (() => {
  let n = 0;
  return () => `${String(++n).padStart(8, "0")}-1111-4111-8111-111111111111`;
})();

// The hosted push function, as far as Admin can tell (netlify/functions/push.mjs's shapes).
function handleHosted(request, response, body) {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, value) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/__reset") {
    Object.assign(state, { devices: [structuredClone(IPAD)], seen: [], tests: [], failTests: false });
    return send(200, {});
  }
  const route = url.pathname.replace(/^\/api\/push\/?/, "");
  const input = body ? JSON.parse(body) : {};
  state.seen.push({ method: request.method, route, body: input });
  if (request.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: "unauthorized" });
  if (request.method === "GET" && route === "status") {
    return send(200, {
      enabled: true, publicKey: PUBLIC, otherApps: true, limits: { devices: 20 },
      kinds: [{ id: "comment", label: "New comments" }, { id: "feedback", label: "Reader feedback" }, { id: "quote", label: "Quote requests" }, { id: "app", label: "Your other apps" }],
      devices: state.devices,
    });
  }
  if (request.method === "POST" && route === "devices") {
    const hash = createHash("sha256").update(input.subscription.endpoint).digest("hex").slice(0, 32);
    let device = state.devices.find((d) => d.device === hash);
    if (!device) {
      device = { id: uuid(), device: hash, createdAt: new Date().toISOString(), lastSentAt: null };
      state.devices.push(device);
    }
    Object.assign(device, { label: input.label, kinds: input.kinds });
    return send(200, { device });
  }
  let match = /^devices\/([^/]+)\/remove$/.exec(route);
  if (match) {
    state.devices = state.devices.filter((d) => d.id !== match[1]);
    return send(200, { removed: true });
  }
  match = /^devices\/([^/]+)$/.exec(route);
  if (match) {
    const device = state.devices.find((d) => d.id === match[1]);
    if (!device) return send(404, { error: "not-found" });
    Object.assign(device, input);
    return send(200, { device });
  }
  if (request.method === "POST" && route === "test") {
    if (state.failTests) return send(502, { error: "send-failed" });
    const device = state.devices.find((d) => d.id === input.id);
    if (!device) return send(404, { error: "not-found" });
    state.tests.push(device.id);
    device.lastSentAt = new Date().toISOString();
    return send(200, { sent: true });
  }
  return send(404, { error: "not-found" });
}

async function startAdmin(name, environment) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), `openblog-studio-notifications-${name}-`));
  mkdirSync(join(dir, "content", "posts"), { recursive: true });
  writeFileSync(join(dir, "content", "posts", "one.md"), "---\ntitle: One\ndate: 2026-10-01\n---\nA post.\n");
  writeFileSync(join(dir, "openblog.json"), JSON.stringify({ title: "Grammi's House", url: "https://grammis.example", author: { name: "Grammi" }, engagement: { enabled: true, endpoint: "https://comments.example/api" } }));
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const env = { ...process.env, ...environment };
  if (!environment.OPENBLOG_PUSH_ENDPOINT) {
    delete env.OPENBLOG_PUSH_ENDPOINT;
    delete env.OPENBLOG_PUSH_ADMIN_KEY;
  }
  const child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
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
  hosted = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => handleHosted(request, response, body));
  });
  hosted.listen(0, "127.0.0.1");
  await once(hosted, "listening");
  hostedPort = hosted.address().port;
  configured = await startAdmin("on", { OPENBLOG_PUSH_ENDPOINT: `http://127.0.0.1:${hostedPort}/api/push`, OPENBLOG_PUSH_ADMIN_KEY: KEY });
  plain = await startAdmin("off", {});
});

test.afterAll(async () => {
  for (const server of [configured, plain]) {
    if (server?.child && server.child.exitCode === null) {
      const stopped = once(server.child, "exit");
      server.child.kill();
      await stopped;
    }
  }
  await new Promise((done) => hosted?.close(done) || done());
  for (const server of [configured, plain]) removeTree(server?.dir);
});

test.beforeEach(async ({ page, context }) => {
  await fetch(`http://127.0.0.1:${hostedPort}/__reset`, { method: "POST", body: "{}" });
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
  for (const server of [configured, plain]) await context.grantPermissions(["notifications"], { origin: server.origin });
  // Headless Chrome has no push service: the sign-up is stood in for, kept in localStorage like a real one is kept by the browser.
  // A phone whose answer was reset (localStorage "test:permission" = "default") is asked again; and
  // "test:standalone" stands in for the app opened from its icon.
  await context.addInitScript(() => {
    if (globalThis.Notification) {
      const real = Object.getOwnPropertyDescriptor(Notification, "permission").get;
      const ask = Notification.requestPermission.bind(Notification);
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => localStorage.getItem("test:permission") || real.call(Notification) });
      Notification.requestPermission = async () => (localStorage.getItem("test:permission") ? (localStorage.removeItem("test:permission"), "granted") : ask());
    }
    if (localStorage.getItem("test:standalone")) {
      const media = globalThis.matchMedia.bind(globalThis);
      globalThis.matchMedia = (query) => (/display-mode: standalone/.test(query) ? { matches: true, media: query, addEventListener() {}, removeEventListener() {} } : media(query));
    }
  });
  await context.addInitScript(() => {
    if (!globalThis.PushManager) return;
    const KEY = "test:push-subscription";
    const make = (data) => ({
      endpoint: data.endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: data.endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }),
      unsubscribe: async () => { localStorage.removeItem(KEY); return true; },
    });
    PushManager.prototype.getSubscription = async function getSubscription() {
      const held = localStorage.getItem(KEY);
      return held ? make(JSON.parse(held)) : null;
    };
    PushManager.prototype.subscribe = async function subscribe(options) {
      if (!options?.userVisibleOnly || !options.applicationServerKey) throw new DOMException("bad options", "NotAllowedError");
      const data = { endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}` };
      localStorage.setItem(KEY, JSON.stringify(data));
      return make(data);
    };
  });
});

async function open(page, server, hash = "#/notifications") {
  await page.goto(`${server.origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

const here = (page) => page.locator(".studio-here");
const statusLine = (page) => page.locator(".studio-notifications > [role=status]");

async function axeClean(page, selector, label) {
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), selector);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
}

test("without push settings, Notifications says so, and the old addresses still land there", async ({ page }) => {
  await open(page, plain, "#/notifications/devices");
  await expect(page.getByText("Notifications aren't set up for your blog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/notifications");
  await expect(page.getByRole("button", { name: "Turn on notifications" })).toHaveCount(0);
  await expect(page.locator(".studio-quiet-link a")).toHaveCount(0);
});

test("turn on, change a switch, send a test, turn off and Undo, then remove another computer", async ({ page }) => {
  await open(page, configured);
  await expect(page.locator("#studio-notifications-h")).toBeFocused();
  await expect(page.locator("h1")).toHaveText("Notifications");
  const card = here(page);
  await expect(card.getByRole("heading", { name: "This computer" })).toBeVisible();
  await expect(card.locator("status-badge")).toHaveText("Off");
  await expect(card.getByRole("group", { name: "Tell me when" })).toBeVisible();
  await expect(card.getByRole("switch", { name: "Someone leaves a comment" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("switch", { name: /Someone asks for a quote/ })).toHaveCount(0);
  await expect(page.locator("li[data-device]")).toHaveCount(1);
  await expect(page.locator("li[data-device]")).toContainText("Tells you about comments and quote requests.");
  await expect(page.locator("li[data-device]")).toContainText("Hasn't told you anything yet.");

  // A switch before turning on decides what this one hears about.
  await card.getByRole("switch", { name: "News from your other apps" }).click();
  await card.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(statusLine(page)).toHaveText("On. A test is on its way to this computer.");
  await expect(card.locator("status-badge")).toHaveText("On");
  await expect(card.getByRole("heading", { name: "This computer" })).toBeFocused();
  const mine = state.devices.find((d) => d.id !== IPAD.id);
  expect(mine.label).toBe("Linux computer");
  expect(mine.kinds).toEqual(["comment", "feedback"]);
  expect(state.tests).toEqual([mine.id]);
  await expect(card).toContainText("This computer is called “Linux computer”.");

  // Switches save at once, keeping what this screen doesn't show.
  await card.getByRole("switch", { name: "A reader sends you a note about a post" }).click();
  await expect(statusLine(page)).toHaveText("Saved. This computer will tell you about comments.");
  expect(state.devices.find((d) => d.id === mine.id).kinds).toEqual(["comment"]);

  // A test that fails clears the old status, so "Saved…" doesn't sit beside the trouble.
  state.failTests = true;
  await card.getByRole("button", { name: "Send a test" }).click();
  await expect(card.locator("[role=alert]")).toBeVisible();
  await expect(statusLine(page)).toHaveText("");
  state.failTests = false;
  await card.getByRole("button", { name: "Send a test" }).click();
  await expect(statusLine(page)).toHaveText("Sent. It should show up in a few seconds.");
  expect(state.tests).toEqual([mine.id, mine.id]);
  // Turn off sits apart from Send a test: after "Didn't see the test?".
  expect(await card.evaluate((node) => {
    const details = [...node.querySelectorAll("details")].find((d) => d.textContent.includes("Didn't see the test?"));
    const off = [...node.querySelectorAll("action-button")].find((b) => b.textContent.includes("Turn off"));
    return Boolean(details.compareDocumentPosition(off) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  // Turn off: off the list first, then Undo puts it back with the same name and kinds, without asking.
  await card.getByRole("button", { name: "Turn off on this computer" }).click();
  await expect(statusLine(page)).toHaveText("Off. This computer won't get notifications.");
  await expect(card.getByRole("button", { name: "Turn on notifications" })).toBeFocused();
  expect(state.devices.map((d) => d.id)).toEqual([IPAD.id]);
  expect(await page.evaluate(() => localStorage.getItem("test:push-subscription"))).toBeNull();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(statusLine(page)).toHaveText("On again.");
  const back = state.devices.find((d) => d.id !== IPAD.id);
  expect(back.label).toBe("Linux computer");
  expect(back.kinds).toEqual(["comment"]);
  await expect(card.locator("status-badge")).toHaveText("On");
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // Undo stays, with no timeout, until she does something else on the screen; turning on again takes it away.
  await card.getByRole("button", { name: "Turn off on this computer" }).click();
  await expect(statusLine(page)).toHaveText("Off. This computer won't get notifications.");
  await page.waitForTimeout(1500);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await card.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(card.locator("status-badge")).toHaveText("On");
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await card.getByRole("button", { name: "Turn off on this computer" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await card.getByRole("switch", { name: "Someone leaves a comment" }).click();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await card.getByRole("switch", { name: "Someone leaves a comment" }).click();
  await card.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(card.locator("status-badge")).toHaveText("On");

  // Another computer: Remove asks, keeps on Keep it, goes on Remove.
  const ipad = page.locator(`li[data-device="${IPAD.id}"]`);
  await ipad.getByRole("button", { name: "Remove Kitchen iPad" }).click();
  await expect(page.getByText("Remove Kitchen iPad?")).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(statusLine(page)).toHaveText("Removed Kitchen iPad.");
  await expect(page.locator("li[data-device]")).toHaveCount(0);
  await expect(page.getByText("No other phones or computers get notifications.")).toBeVisible();
  await expect(page.locator("#studio-others-h")).toBeFocused();

  // The blog's one worker, at /admin/ only; Studio never registers its own.
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => [r.scope, (r.active || r.waiting || r.installing)?.scriptURL]));
  expect(scopes).toEqual([[`${configured.origin}/admin/`, `${configured.origin}/admin/sw.js`]]);
  for (const text of [await page.locator("body").innerText()]) expect(text).not.toContain("fcm.googleapis.com");
});

test("turning on again where the server still has this computer keeps its name and her choices", async ({ page }) => {
  await open(page, configured);
  // This computer's sign-up is still on the list, named and chosen in the old Admin; only its answer was reset.
  const endpoint = "https://fcm.googleapis.com/fcm/send/kept-one";
  const hash = createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
  const kept = { id: "33333333-3333-4333-8333-333333333333", device: hash, label: "Grammi's laptop", kinds: ["comment", "quote"], createdAt: "2026-10-01T12:00:00.000Z", lastSentAt: null };
  await page.evaluate((value) => {
    localStorage.setItem("test:push-subscription", JSON.stringify({ endpoint: value }));
    localStorage.setItem("test:permission", "default");
  }, endpoint);
  // Not on the list yet: removed from another phone or computer.
  await page.reload();
  const card = here(page);
  await expect(card).toContainText("This computer was removed from the phones your blog tells, so it's off.");
  state.devices.push(structuredClone(kept));
  await page.reload();
  await expect(card).not.toContainText("was removed");
  await expect(card.locator("status-badge")).toHaveText("Off");
  // The switches show what she saved, not every kind.
  await expect(card.getByRole("switch", { name: "Someone leaves a comment" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("switch", { name: "A reader sends you a note about a post" })).toHaveAttribute("aria-checked", "false");
  await card.getByRole("button", { name: "Turn on notifications" }).click();
  await expect(card.locator("status-badge")).toHaveText("On");
  const after = state.devices.find((d) => d.device === hash);
  expect(after.id).toBe(kept.id);
  expect(after.label).toBe("Grammi's laptop");
  expect(after.kinds).toEqual(["comment", "quote"]);
  await expect(card).toContainText("This computer is called “Grammi's laptop”.");
});

test("another computer: send it a test, change what it tells you (asking before losing a change), rename it", async ({ page }) => {
  await open(page, configured);
  const ipad = page.locator(`li[data-device="${IPAD.id}"]`);
  await ipad.getByRole("button", { name: "More for Kitchen iPad" }).click();
  await page.getByRole("menuitem", { name: "Send it a test" }).click();
  await expect(statusLine(page)).toHaveText("Sent to Kitchen iPad. Check that it showed up there.");

  await ipad.getByRole("button", { name: "More for Kitchen iPad" }).click();
  await page.getByRole("menuitem", { name: "Change what it tells you…" }).click();
  const sheet = page.locator("side-sheet dialog[open]");
  await expect(page.getByRole("heading", { name: "What Kitchen iPad tells you" })).toBeFocused();
  await sheet.getByRole("switch", { name: "Someone leaves a comment" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Save these changes?")).toBeVisible();
  await page.locator("modal-dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(statusLine(page)).toHaveText("Saved. Nothing is on, so Kitchen iPad stays quiet.");
  // Quote isn't offered on this site, so it's kept as the server had it.
  expect(state.devices.find((d) => d.id === IPAD.id).kinds).toEqual(["quote"]);

  await ipad.getByRole("button", { name: "More for Kitchen iPad" }).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const field = page.getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  // A name is needed, so it isn't marked optional.
  await expect(page.locator("modal-dialog text-field label")).not.toContainText("optional");
  await field.fill("");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByText("Give it a name, like Work phone.")).toBeVisible();
  await field.fill("Grammi's iPad");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(statusLine(page)).toHaveText("Renamed to “Grammi's iPad”.");
  await expect(page.getByRole("heading", { name: "Grammi's iPad" })).toBeFocused();
});

test("the account menu, the palette, the quiet link on Comments, and a tapped notification's message", async ({ page }) => {
  await open(page, configured, "#/comments");
  const link = page.getByRole("link", { name: "Get a notification on this computer when someone comments" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator("h1")).toHaveText("Notifications");
  await here(page).getByRole("button", { name: "Turn on notifications" }).click();
  await expect(here(page).locator("status-badge")).toHaveText("On");
  await page.goto(`${configured.origin}/admin/studio/#/comments`);
  await expect(page.locator(".studio-comments")).toBeVisible();
  await expect(page.locator(".studio-quiet-link a")).toHaveCount(0);

  // A tapped notification asks this window to move: through the router.
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open", hash: "#/notifications" } })));
  await expect(page.locator("h1")).toHaveText("Notifications");
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "open", hash: "javascript:alert(1)" } })));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/notifications");

  // Find, with each thing to do listed once.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Notifications");
  await expect(page.getByRole("option", { name: /^Notifications/ }).first()).toBeVisible();
  for (let i = 0; i < "Notifications".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("Send a test");
  await expect(page.getByRole("option", { name: /^Send a test notification/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("Find's Open the old Admin stays there in the installed app", async ({ page }) => {
  await open(page, configured, "#/");
  await page.evaluate(() => localStorage.setItem("test:standalone", "1"));
  await page.reload();
  await expect(page.locator("h1")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Open the old Admin");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => Boolean(customElements.get("ob-admin")));
  await expect(page).toHaveURL(`${configured.origin}/admin/#/`);
});

test("the old Admin's Notifications opens Studio's, keeping the Home Screen sheet", async ({ page }) => {
  await open(page, configured, "#/");
  await page.goto(`${configured.origin}/admin/#/notifications`);
  await expect(page).toHaveURL(`${configured.origin}/admin/studio/#/notifications`);
  await expect(page.locator("h1")).toHaveText("Notifications");
  await page.goto(`${configured.origin}/admin/#/notifications?sheet=home-screen`);
  await expect(page.getByRole("heading", { name: "Install your blog as an app" })).toBeFocused();
});

test("Notifications and Add to Home Screen pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await open(page, configured);
  await expect(here(page).locator("status-badge")).toHaveText("Off");
  await axeClean(page, "#studio", "off");
  // The switches' words wrap between words, never inside one.
  const broken = await page.evaluate(() => [...document.querySelectorAll(".studio-kinds toggle-switch .label")].flatMap((label) => {
    const text = label.firstChild;
    const words = [];
    for (const match of text.data.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (lines.size > 1) words.push(match[0]);
    }
    return words;
  }));
  expect(await page.locator(".studio-kinds toggle-switch .label").count()).toBeGreaterThan(0);
  expect(broken, "words split across lines at 320 px").toEqual([]);
  await here(page).getByRole("button", { name: "Turn on notifications" }).click();
  await expect(here(page).locator("status-badge")).toHaveText("On");
  await here(page).getByText("Didn't see the test?").click();
  await axeClean(page, "#studio", "on");
  await page.goto(`${configured.origin}/admin/studio/#/notifications?sheet=home-screen`);
  await expect(page.getByRole("heading", { name: "Install your blog as an app" })).toBeFocused();
  await expect(page.locator("side-sheet dialog[open]")).toContainText("Look for the Install button at the right end of the bar at the top where the address is. Or open the menu (the three dots at the top right) and choose Install.");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/notifications");
  await axeClean(page, "side-sheet", "home screen sheet");
  await page.keyboard.press("Escape");
  await expect(page.locator("side-sheet dialog[open]")).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// The Requests screen of quote requests in Admin (ADR 0384, #517 and #518), from the real binary and the real Admin
// Studio at phone width, against a scripted stand-in for the hosted quote function. Nothing real is contacted.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const KEY = `adm_${randomBytes(24).toString("hex")}`;
const LONG = "Wellington".repeat(9);
let hosted;
let hostedPort;
let configured;
let plain;
const state = { requests: [], seen: [], failErase: false, retention: { days: 30, source: "host" } };

const freePort = async () => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  return port;
};

const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-${String(n).repeat(12)}`;
const seed = () => [
  { id: id(1), status: "new", name: LONG, phone: "+1 360 555 0101", email: "pat@example.com", town: "Bend", service: "Fencing", description: "Replace forty feet of cedar fence.\nSecond line.", page: null, photoCount: 1, photos: [{ url: "https://example.invalid/storage/v1/object/sign/openblog-quote-photos/a/1.jpg?token=t", type: "image/jpeg" }], createdAt: "2026-10-29T10:00:00.000Z", handledAt: null, archivedAt: null, eraseAfter: null, notify: "off", client_hash: "no" },
  { id: id(2), status: "new", name: "Sam Lee", phone: "+1 360 555 0102", email: null, town: "Sisters", service: "Decks", description: "A small deck, about ten by twelve.", page: null, photoCount: 0, photos: [], createdAt: "2026-10-28T10:00:00.000Z", handledAt: null, archivedAt: null, eraseAfter: null, notify: "off" },
];

function handleHosted(request, response, body) {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, value) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/__reset") {
    Object.assign(state, { requests: seed(), seen: [], failErase: false, retention: { days: 30, source: "host" } });
    return send(200, {});
  }
  if (url.pathname === "/__fail-email") {
    Object.assign(state.requests[1], { notify: "failed", notifyAttempts: 1, notifyError: "network" });
    return send(200, {});
  }
  if (url.pathname === "/__retention-unset") {
    state.retention = { days: null, source: null };
    return send(200, {});
  }
  if (url.pathname === "/__fail-erase") {
    state.failErase = true;
    return send(200, {});
  }
  state.seen.push({ method: request.method, path: url.pathname + url.search, authorized: request.headers.authorization === `Bearer ${KEY}`, actor: request.headers["x-openblog-actor"] });
  if (request.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: "unauthorized" });
  const route = url.pathname.replace(/^\/api\/quote\/?/, "");
  const input = body ? JSON.parse(body) : {};
  if (request.method === "GET" && route === "requests") {
    const status = url.searchParams.get("status");
    const service = url.searchParams.get("service");
    const rows = state.requests.filter((r) => (!status || r.status === status) && (!service || r.service === service));
    return send(200, { requests: rows, services: [...new Set(state.requests.map((r) => r.service))].sort(), retentionDays: state.retention.days, retentionSource: state.retention.source, notifyEnabled: true });
  }
  if (request.method === "POST" && route === "notifications/retry") {
    const failed = state.requests.filter((r) => r.notify === "failed");
    for (const r of failed) Object.assign(r, { notify: "sent", notifyAttempts: r.notifyAttempts + 1, notifyError: null });
    return send(200, { tried: failed.length, sent: failed.length, failed: 0, gaveUp: 0 });
  }
  let match = /^requests\/([^/]+)\/status$/.exec(route);
  if (request.method === "POST" && match) {
    const row = state.requests.find((r) => r.id === match[1]);
    row.status = input.status;
    row.eraseAfter = input.status === "archived" ? new Date(Date.now() + 30 * 86400000).toISOString() : null;
    return send(200, { id: row.id, status: row.status });
  }
  if (request.method === "GET" && route === "export") return send(200, { csv: "id,name\r\n", count: state.requests.length, filename: "quote-requests-start-to-now.csv" });
  if (request.method === "POST" && route === "erase/preview") return send(200, { count: input.ids.length, photos: 1, expiresAt: new Date(Date.now() + 600000).toISOString(), token: "sealed.token" });
  if (request.method === "POST" && route === "erase") {
    if (state.failErase) return send(502, { error: "erase-failed" });
    state.requests = state.requests.filter((r) => !input.ids.includes(r.id));
    return send(200, { erased: input.ids.length, verified: true });
  }
  if (request.method === "POST" && route === "retention/run") return send(200, { enabled: true, erased: 0 });
  if (request.method === "POST" && route === "retention") {
    state.retention = { days: input.days, source: input.days ? "admin" : null };
    return send(200, { retentionDays: state.retention.days, retentionSource: state.retention.source });
  }
  return send(404, { error: "not-found" });
}

async function startAdmin(name, environment) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), `openblog-quote-${name}-`));
  mkdirSync(join(dir, "content", "posts"), { recursive: true });
  writeFileSync(join(dir, "content", "posts", "one.md"), "---\ntitle: One\ndate: 2026-10-01\n---\nA post.\n");
  writeFileSync(join(dir, "openblog.json"), JSON.stringify({ title: "Quote", url: "https://quote.example.org", author: { name: "Site Author" } }));
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const env = { ...process.env, ...environment };
  if (!environment.OPENBLOG_QUOTE_ENDPOINT) {
    delete env.OPENBLOG_QUOTE_ENDPOINT;
    delete env.OPENBLOG_QUOTE_ADMIN_KEY;
  }
  const child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const origin = `http://127.0.0.1:${port}`;
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/`)).ok).toBe(true);
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
  configured = await startAdmin("on", { OPENBLOG_QUOTE_ENDPOINT: `http://127.0.0.1:${hostedPort}/api/quote`, OPENBLOG_QUOTE_ADMIN_KEY: KEY });
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
  for (const server of [configured, plain]) {
    try { rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ }
  }
});

test.beforeEach(async ({ page, context }) => {
  await fetch(`http://127.0.0.1:${hostedPort}/__reset`, { method: "POST", body: "{}" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.setViewportSize({ width: 400, height: 800 });
  page.on("dialog", (dialog) => {
    throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`);
  });
});

async function openQuotes(page, server, hash = "#/quotes") {
  await page.goto(`${server.origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-action="logout"]')).toBeVisible();
  }
  await page.goto(`${server.origin}/admin/${hash}`);
}
const overflow = (page) => page.locator("[data-quote-requests]").evaluate((node) => ({ region: node.scrollWidth - node.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth }));

test("without quote settings the page says so, offers nothing, and the navigation does not mention it", async ({ page }) => {
  await openQuotes(page, plain, "#/overview");
  await expect(page.locator('[data-action="logout"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Quote requests" })).toHaveCount(0);
  await page.goto(`${plain.origin}/admin/#/quotes`);
  await expect(page.getByRole("heading", { level: 2, name: "Quote requests" }).first()).toBeVisible();
  await expect(page.locator("[data-quote-off]")).toContainText("Quote requests are not set up");
  const status = await page.evaluate(async () => (await fetch("/admin/api/quote/requests", { credentials: "same-origin" })).status);
  expect(status).toBe(404);
});

test("requests read well at 400 px: newest first, status words, copy, handle, archive with a countdown, all by keyboard", async ({ page }) => {
  await openQuotes(page, configured, "#/overview");
  await page.getByRole("link", { name: "Quote requests" }).click();
  const cards = page.locator("[data-request]");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("New");
  expect(await overflow(page)).toEqual({ region: 0, page: 0 });
  expect(JSON.stringify(state.seen)).not.toContain("client_hash");
  expect(state.seen.every((call) => call.authorized && call.actor === "writer")).toBe(true);
  await expect(cards.first().locator("img")).toHaveAttribute("alt", /Photo 1 from Wellington/);

  await cards.nth(1).getByRole("button", { name: /^Copy phone/ }).click();
  await expect(page.locator("[data-quote-status]")).toContainText("Copied phone");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("+1 360 555 0102");

  const second = cards.nth(1);
  await second.getByRole("button", { name: "Mark handled" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-request]").nth(1)).toContainText("Handled");
  await page.locator("[data-request]").nth(1).getByRole("button", { name: "Archive" }).click();
  await expect(page.locator("[data-quote-countdown]")).toContainText(/Erased automatically in (29|30) days/);
  expect(await overflow(page)).toEqual({ region: 0, page: 0 });

  await page.locator('select[data-filter="status"]').selectOption("archived");
  await expect(page.locator("[data-request]")).toHaveCount(1);
  await expect(page.locator("[data-request]")).toContainText("Sam Lee");
});

test("the owner sets how long archived requests are kept, at 400 px and by keyboard (ADR 0387)", async ({ page }) => {
  await fetch(`http://127.0.0.1:${hostedPort}/__retention-unset`, { method: "POST", body: "{}" });
  await openQuotes(page, configured, "#/quotes");
  const days = page.getByLabel("Days after archiving");
  await expect(days).toBeVisible();
  await expect(page.locator("[data-quote-retention]")).toContainText("kept until you erase them");
  await days.fill("14");
  await page.getByRole("button", { name: "Save", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-quote-status]")).toContainText("erased automatically 14 days after you archive them");
  expect(state.retention).toEqual({ days: 14, source: "admin" });
  await expect(page.getByLabel("Days after archiving")).toHaveValue("14");
  expect(await overflow(page)).toEqual({ region: 0, page: 0 });
  await page.getByRole("button", { name: "Keep until I erase them" }).click();
  await expect(page.locator("[data-quote-status]")).toContainText("kept until you erase them");
  expect(state.retention).toEqual({ days: null, source: null });
});

test("export downloads a CSV and erase is previewed, confirmed, verified; a failed erase keeps everything", async ({ page }) => {
  await openQuotes(page, configured);
  await expect(page.locator("[data-request]")).toHaveCount(2);
  await page.locator(".oba-quotes-export summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toBe("quote-requests-start-to-now.csv");

  const erase = page.locator('button[data-action="erase"]');
  await expect(erase).toBeDisabled();
  await page.locator("[data-request]").nth(1).getByLabel(/Select Sam Lee for erase/).check();
  await expect(erase).toBeEnabled();
  await erase.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Erase 1 request?");
  await expect(dialog).toBeFocused();
  expect(state.requests.length).toBe(2);
  await fetch(`http://127.0.0.1:${hostedPort}/__fail-erase`, { method: "POST", body: "{}" });
  await dialog.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.locator("[data-quote-status]")).toContainText("still here");
  expect(state.requests.length).toBe(2);
  await expect(page.locator("[data-request]")).toHaveCount(2);

  await fetch(`http://127.0.0.1:${hostedPort}/__reset`, { method: "POST", body: "{}" });
  await page.reload();
  await page.locator(".oba-quotes-export summary").click();
  await page.locator("[data-request]").nth(1).getByLabel(/Select Sam Lee for erase/).check();
  await page.locator('button[data-action="erase"]').click();
  await page.getByRole("button", { name: "Erase permanently" }).click();
  await expect(page.locator("[data-quote-status]")).toContainText("Erased 1 request and checked afterward");
  await expect(page.locator("[data-request]")).toHaveCount(1);
  expect(await overflow(page)).toEqual({ region: 0, page: 0 });
});

test("an email that did not go out is shown on its request at 400 px and is sent again by keyboard (#516)", async ({ page }) => {
  await fetch(`http://127.0.0.1:${hostedPort}/__fail-email`, { method: "POST", body: "{}" });
  await openQuotes(page, configured);
  await expect(page.locator("[data-request]")).toHaveCount(2);
  await expect(page.locator("[data-quote-emails]")).toContainText("did not go out");
  await expect(page.locator("[data-request]").nth(1).locator("[data-quote-email]")).toContainText("could not be reached");
  expect(await overflow(page)).toEqual({ region: 0, page: 0 });
  await page.getByRole("button", { name: "Send those emails again" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-quote-status]")).toContainText("Sent 1 email.");
  await expect(page.locator("[data-quote-emails]")).toHaveCount(0);
  expect(state.seen.some((call) => call.method === "POST" && call.path === "/api/quote/notifications/retry" && call.authorized)).toBe(true);
});

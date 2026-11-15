import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slices 10b and 10c: Requests, Reminders and Sharing on a trade site. Quote and sharing
// settings are set where Admin runs (pointing nowhere), so their screens are in the navigation; the
// hosted answers are mocked at the Admin API. Requests: Call dials the number, customers' words stay
// text, Mark handled has Undo, erasing is checked first and asked once. Reminders: Start a draft
// opens Write; Not now snoozes. Sharing: grouped by what needs her, Don't share it asks, and the
// composer sends one share per chosen account with its own key. Each passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const key = randomBytes(24).toString("hex");
const HOSTILE = "<img src=x onerror=alert(1)>";
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-trade-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  const configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.business = { trade: "roofing" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], {
    cwd: repository, stdio: "pipe",
    env: { ...process.env, OPENBLOG_QUOTE_ENDPOINT: "http://127.0.0.1:9/api/quote", OPENBLOG_QUOTE_ADMIN_KEY: key, OPENBLOG_SOCIAL_ENDPOINT: "http://127.0.0.1:9/api/social", OPENBLOG_SOCIAL_ADMIN_KEY: key },
  });
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

async function signIn(page, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function mockQuotes(page) {
  const calls = [];
  const requests = [
    { id: UUID(1), status: "new", name: "Pat Miller", phone: "(304) 555-0101", email: "pat@example.com", town: "Elkins", service: "Roof repair", description: `Water coming in. ${HOSTILE}`, photos: [], photoCount: 0, createdAt: new Date().toISOString(), notify: "sent", notifyAttempts: 1 },
    { id: UUID(2), status: "new", name: "Sam Lee", phone: "304 555 0102", town: "Davis", service: "Gutters", description: "Gutters full.", photos: [], photoCount: 0, createdAt: new Date(Date.now() - 3600000).toISOString(), notify: "failed", notifyError: "timeout", notifyAttempts: 2 },
  ];
  await page.route("**/admin/api/quote/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/quote/", "");
    const body = route.request().postDataJSON?.() ?? null;
    calls.push({ path, body });
    if (path === "status") return json(route, 200, { enabled: true, state: "on" });
    if (path === "requests") return json(route, 200, { requests, unreadable: 0, services: ["Roof repair", "Gutters"], retentionDays: null, retentionSource: null, notifyEnabled: true });
    if (path.endsWith("/status")) { const r = requests.find((x) => path.includes(x.id)); r.status = body.status; return json(route, 200, { id: r.id, status: r.status }); }
    if (path === "erase/preview") return json(route, 200, { count: 1, photos: 0, token: "t".repeat(32), expiresAt: null });
    if (path === "erase") { requests.splice(requests.findIndex((r) => body.ids.includes(r.id)), 1); return json(route, 200, { erased: 1, verified: true, photosPending: 0 }); }
    return json(route, 404, { error: "not found" });
  });
  return calls;
}

test("Requests: Call dials the number, words stay text, Mark handled undoes, erasing asks after checking", async ({ page }) => {
  const calls = await mockQuotes(page);
  await signIn(page, "#/quotes");
  for (const item of ["Requests", "Reminders", "Sharing"]) await expect(page.getByRole("link", { name: item, exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who's asking for a quote?" })).toBeVisible();
  const pat = page.locator(".studio-comment", { hasText: "Pat Miller" });
  await expect(pat.getByText(HOSTILE, { exact: false })).toBeVisible();
  await expect(pat.getByRole("link", { name: "Call Pat Miller at (304) 555-0101" })).toHaveAttribute("href", "tel:3045550101");
  await expect(page.getByText("The email about 1 request didn't reach you.")).toBeVisible();
  await pat.getByRole("button", { name: "Mark handled" }).click();
  await expect(pat).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-comment", { hasText: "Pat Miller" })).toBeVisible();
  expect(calls.filter((c) => c.path.endsWith("/status")).map((c) => c.body.status)).toEqual(["handled", "new"]);
  const sam = page.locator(".studio-comment", { hasText: "Sam Lee" });
  await sam.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Erase this request" }).click();
  await expect(page.getByRole("heading", { name: "Erase Sam Lee's request?" })).toBeVisible();
  await page.getByRole("button", { name: "Erase for good" }).click();
  await expect(sam).toHaveCount(0);
  expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(["erase/preview", "erase"]));
  expect(calls.find((c) => c.path === "erase").body.token).toBe("t".repeat(32));
});

test("Reminders: Start a draft opens Write; Not now snoozes", async ({ page }) => {
  const asked = [];
  await page.route("**/admin/api/seasonal**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/admin/api/", "");
    asked.push({ path, body: route.request().postDataJSON?.() ?? null });
    if (path === "seasonal") return json(route, 200, { enabled: true, etag: "e1", trade: "roofing", entries: [], topics: [], today: "2026-11-13", voiceReady: false, reminders: [
      { key: "roofing-winter-2026", id: "roofing-winter", topic: "Get the roof ready before winter", prompt: "Gutters, flashing and loose shingles.", opens: "2026-09-01", closes: "2026-11-30", status: "due", snoozedUntil: null, document: null },
      { key: "roofing-storm-2027", id: "roofing-storm", topic: "After a storm", prompt: "What to check.", opens: "2027-05-15", closes: "2027-07-01", status: "upcoming", snoozedUntil: null, document: null },
    ] });
    if (path === "seasonal/snooze") return json(route, 200, { key: "roofing-winter-2026", snoozedUntil: "2026-11-20" });
    if (path === "seasonal/open") return json(route, 200, { key: "roofing-winter-2026", document: "posts/portable-lesson.md", path: "content/posts/portable-lesson.md", created: true, draft: true });
    return json(route, 404, { error: "not found" });
  });
  await signIn(page, "#/reminders");
  await expect(page.getByRole("heading", { name: "What's worth writing about now?" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".studio-reminders p[role=status]")).toContainText("I'll remind you again");
  expect(asked.find((a) => a.path === "seasonal/snooze").body).toEqual({ key: "roofing-winter-2026", days: 7 });
  await page.getByRole("button", { name: "Start a draft" }).click();
  await expect(page).toHaveURL(/#\/write\/posts%2Fportable-lesson\.md$/);
});

async function mockSharing(page) {
  const sent = [];
  const items = [
    { id: UUID(11), version: 1, work: "/portable-lesson/", caption: "Ice dams", status: "failed", delivery: "failed", lastErrorCode: "provider-rejected", scheduledFor: "2026-11-12T09:00:00Z", destination: { provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" } },
    { id: UUID(12), version: 3, work: "/portable-lesson/", caption: "Storm tips", status: "scheduled", scheduledFor: "2026-11-20T09:00:00Z", destination: { provider: "bluesky", displayName: "@ridgeline", kind: "account" } },
  ];
  await page.route("**/admin/api/social/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/social/", "");
    const body = route.request().postDataJSON?.() ?? null;
    if (path === "destinations") return json(route, 200, { destinations: [{ id: UUID(21), provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" }, { id: UUID(22), provider: "bluesky", displayName: "@ridgeline", kind: "account" }] });
    if (path === "posts") return json(route, 200, { posts: [{ work: "/portable-lesson/", title: "Ice dams: what to do", eligible: true, canonicalUrl: "https://example.org/portable-lesson/" }] });
    if (path === "accounts") return json(route, 200, { accounts: [{ id: UUID(21), provider: "facebook", displayName: "Ridgeline Roofing", status: "active", health: "ok" }] });
    if (path === "announcements" && route.request().method() === "GET") return json(route, 200, { announcements: items });
    if (path === "announcements" && route.request().method() === "POST") { sent.push(body); return json(route, 200, { announcement: { id: UUID(30 + sent.length), status: "scheduled" } }); }
    if (path === "announcements/cancel") { sent.push({ cancel: url.searchParams.get("id"), ...body }); items.splice(1, 1); return json(route, 200, {}); }
    if (path === "announcements/retry") { sent.push({ retry: url.searchParams.get("id"), ...body }); items[0].status = "scheduled"; items[0].delivery = "pending"; return json(route, 200, {}); }
    return json(route, 404, { error: "not found" });
  });
  return sent;
}

test("Sharing: grouped by what needs her; Try again; Don't share it asks; the composer sends one per account", async ({ page }) => {
  const sent = await mockSharing(page);
  await signIn(page, "#/sharing");
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  await expect(page.locator(".studio-sharing h3")).toContainText(["Needs you", "Going out"]);
  await expect(page.getByText("It refused the post.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".studio-sharing p[role=status]")).toHaveText("It'll be tried again within a minute.");
  expect(sent[0]).toEqual({ retry: UUID(11), version: 1 });
  const storm = page.locator(".studio-comment", { hasText: "Storm tips" });
  await storm.getByRole("button", { name: "Don't share it" }).click();
  await page.getByRole("button", { name: "Don't share it" }).last().click();
  await expect(storm).toHaveCount(0);
  await page.getByRole("link", { name: "Share a post" }).click();
  await expect(page.getByRole("heading", { name: "Share a post" , level: 2 })).toBeVisible();
  await expect(page.getByText("20 of 300 (Bluesky is the shortest)")).toBeVisible();
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  const shares = sent.filter((s) => s.accountId);
  expect(shares.map((s) => s.accountId)).toEqual([UUID(21), UUID(22)]);
  expect(new Set(shares.map((s) => s.idempotencyKey)).size).toBe(2);
  expect(shares[0]).toMatchObject({ work: "/portable-lesson/", caption: "Ice dams: what to do" });
  expect(Date.parse(shares[0].scheduledFor) - Date.now()).toBeGreaterThan(3 * 60 * 1000);
});

test("Requests, Reminders, Sharing and the composer pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockQuotes(page);
  await mockSharing(page);
  for (const hash of ["#/quotes", "#/reminders", "#/sharing", "#/sharing/new"]) {
    await signIn(page, hash);
    await expect(page.locator(".studio-page h2").first()).toBeVisible();
    await page.waitForTimeout(500);
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    expect(results, hash).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), hash).toBe(false);
  }
});

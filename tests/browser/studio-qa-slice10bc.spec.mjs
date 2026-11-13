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

// QA probes for Studio slices 10b and 10c (Requests, Reminders, Sharing, Home lines). Hosted
// services point nowhere; their answers are mocked at the Admin API. Tests named "regression:" hold
// today and should keep holding; tests named "bug:" fail on 5d7e95e because of a real defect.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const key = randomBytes(24).toString("hex");
const HOSTILE = "<img src=x onerror=\"window.__pwned=1\">";
const SHOTS = process.env.QA_SHOTS || "";
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-qa10-"));
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
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }) : null);
const activeText = (page) => page.evaluate(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el ? `${el.tagName.toLowerCase()}:${(el.textContent || "").trim().slice(0, 60)}` : "none";
});

function quoteRequests() {
  return [
    { id: UUID(1), status: "new", name: `Pat ${HOSTILE}`, phone: "+1 (304) 555-0101", email: "pat@example.com?cc=thief%40evil.example&body=Send%20your%20bank%20details", town: HOSTILE, service: "Roof repair", description: `Water coming in. ${HOSTILE}`, page: "/", photos: [], photoCount: 0, createdAt: new Date().toISOString(), notify: "sent", notifyAttempts: 1 },
    { id: UUID(2), status: "new", name: "Sam Lee", phone: "javascript:alert(1)", town: "Davis", service: "Gutters", description: "Gutters full.", photos: [], photoCount: 0, createdAt: new Date(Date.now() - 3600000).toISOString(), notify: "sent", notifyAttempts: 1 },
  ];
}

async function mockQuotes(page, { failStatusAfter = Infinity, requests = quoteRequests(), listStatus = 200, listBody = null } = {}) {
  const calls = [];
  let statusCalls = 0;
  await page.route("**/admin/api/quote/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/quote/", "");
    const body = route.request().postDataJSON?.() ?? null;
    calls.push({ path, body, method: route.request().method() });
    if (path === "status") return json(route, 200, { enabled: true, state: "on" });
    if (path === "requests") return listStatus === 200 ? json(route, 200, { requests, unreadable: 0, services: [], retentionDays: null, retentionSource: null, notifyEnabled: true }) : json(route, listStatus, listBody);
    if (path.endsWith("/status")) {
      statusCalls += 1;
      if (statusCalls > failStatusAfter) return json(route, 502, { error: "The quote function failed; try again", code: null });
      const r = requests.find((x) => path.includes(x.id)); r.status = body.status; return json(route, 200, { id: r.id, status: r.status });
    }
    if (path === "erase/preview") return json(route, 200, { count: 1, photos: 0, token: "t".repeat(32), expiresAt: null });
    if (path === "erase") { requests.splice(requests.findIndex((r) => body.ids.includes(r.id)), 1); return json(route, 200, { erased: 1, verified: true, photosPending: 0 }); }
    return json(route, 404, { error: "not found" });
  });
  return calls;
}

// ---- Requests --------------------------------------------------------------------------------

test("regression: request fields are text, Call keeps digits only, a hostile phone becomes digits only", async ({ page }) => {
  await mockQuotes(page);
  await signIn(page, "#/quotes");
  const pat = page.locator(".studio-comment").first();
  await expect(pat).toContainText(HOSTILE);
  expect(await page.evaluate(() => [window.__pwned, document.querySelectorAll("main img[src='x']").length])).toEqual([undefined, 0]);
  await expect(pat.getByRole("link", { name: /^Call / })).toHaveAttribute("href", "tel:+13045550101");
  const sam = page.locator(".studio-comment", { hasText: "Sam Lee" });
  // "javascript:alert(1)" keeps only its digit: tel:1, never a script address.
  await expect(sam.getByRole("link", { name: /^Call / })).toHaveAttribute("href", "tel:1");
  for (const href of await page.locator("main a[href^='tel:']").evaluateAll((all) => all.map((a) => a.getAttribute("href")))) expect(href).toMatch(/^tel:\+?[0-9]+$/);
  expect(await page.locator("a[href^='javascript:']").count()).toBe(0);
});

test("Email builds mailto from a stranger's address without encoding, so ?cc= and &body= ride along", async ({ page }) => {
  await mockQuotes(page);
  await signIn(page, "#/quotes");
  const email = page.locator(".studio-comment").first().locator("action-button", { hasText: "Email" });
  const href = await email.evaluate((el) => el.href);
  expect(href).not.toMatch(/\?|&/);
});

test("Undo that fails to save still says Undone", async ({ page }) => {
  await mockQuotes(page, { failStatusAfter: 1 });
  await signIn(page, "#/quotes");
  await page.locator(".studio-comment", { hasText: "Sam Lee" }).getByRole("button", { name: "Mark handled" }).click();
  await expect(page.locator(".studio-quotes p[role=status]")).toHaveText("Sam Lee: handled.");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(500);
  await shot(page, "quotes-undo-failed");
  await expect(page.locator(".studio-quotes p[role=status]")).not.toContainText("Undone");
});

test("regression: Mark handled moves focus to the next card's heading", async ({ page }) => {
  await mockQuotes(page);
  await signIn(page, "#/quotes");
  await page.locator(".studio-comment").first().getByRole("button", { name: "Mark handled" }).click();
  await expect(page.locator(".studio-comment")).toHaveCount(1);
  expect(await activeText(page)).toBe("h3:Sam Lee");
});

test("regression: handling the last New request keeps focus off the page body", async ({ page }) => {
  const one = quoteRequests().slice(1);
  await mockQuotes(page, { requests: one });
  await signIn(page, "#/quotes");
  await page.getByRole("button", { name: "Mark handled" }).click();
  await expect(page.getByText("No new requests")).toBeVisible();
  expect(await activeText(page)).not.toMatch(/^body/);
});

test("after Undo, focus goes back to the request, never to the page body", async ({ page }) => {
  await mockQuotes(page);
  await signIn(page, "#/quotes");
  await page.locator(".studio-comment", { hasText: "Sam Lee" }).getByRole("button", { name: "Mark handled" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-comment", { hasText: "Sam Lee" })).toBeVisible();
  expect(await activeText(page)).not.toMatch(/^body/);
});

test("regression: erase is previewed first; Keep it erases nothing; Erase for good sends the preview's token", async ({ page }) => {
  const calls = await mockQuotes(page);
  await signIn(page, "#/quotes");
  const sam = page.locator(".studio-comment", { hasText: "Sam Lee" });
  await sam.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Erase this request" }).click();
  await expect(page.getByRole("heading", { name: "Erase Sam Lee's request?" })).toBeVisible();
  expect(calls.map((c) => c.path)).toContain("erase/preview");
  // The dialog moves focus to its safe choice as it opens.
  await expect.poll(() => activeText(page)).toMatch(/Keep it/);
  await page.keyboard.press("Enter");
  expect(calls.map((c) => c.path)).not.toContain("erase");
  await sam.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Erase this request" }).click();
  await page.getByRole("button", { name: "Erase for good" }).click();
  await expect(sam).toHaveCount(0);
  const erase = calls.filter((c) => c.path === "erase");
  expect(erase).toHaveLength(1);
  expect(erase[0].body).toEqual({ ids: [UUID(2)], token: "t".repeat(32) });
  expect(calls.filter((c) => c.path === "erase/preview")).toHaveLength(2);
});

test("regression: a failed load never shows the server's words or setting names", async ({ page }) => {
  await mockQuotes(page, { listStatus: 502, listBody: { error: "The quote function did not accept Admin's key; check OPENBLOG_QUOTE_ADMIN_KEY", code: null } });
  await signIn(page, "#/quotes");
  await expect(page.getByText("Your quote requests didn't load")).toBeVisible();
  const firstLayer = await page.locator(".studio-quotes").evaluate((el) => [...el.children].filter((c) => c.tagName !== "DETAILS").map((c) => c.innerText).join(" "));
  expect(firstLayer).not.toMatch(/OPENBLOG|502|function/);
});

test("regression: keyboard reaches Call, Mark handled and More; Escape closes More", async ({ page }) => {
  await mockQuotes(page);
  await signIn(page, "#/quotes");
  await expect(page.locator(".studio-comment")).toHaveCount(2);
  page.locator(".studio-quotes h2").focus();
  const seen = [];
  for (let i = 0; i < 25; i += 1) { await page.keyboard.press("Tab"); seen.push(await activeText(page)); }
  expect(seen.some((s) => /Call/.test(s))).toBe(true);
  expect(seen.some((s) => /Mark handled/.test(s))).toBe(true);
  const more = page.locator(".studio-comment").first().getByRole("button", { name: /More/ });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Copy phone" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Copy phone" })).toBeHidden();
  expect(await activeText(page)).toMatch(/More/);
});

const strayNull = (locator) => locator.evaluate((el) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) if (n.nodeValue.trim() === "null") return true;
  return false;
});

test("with fewer than two services, the word null shows under Which requests", async ({ page }) => {
  await mockQuotes(page);
  await signIn(page, "#/quotes");
  await expect(page.locator(".studio-comment")).toHaveCount(2);
  expect(await strayNull(page.locator(".studio-quotes"))).toBe(false);
});

test("with only due reminders (or only coming up), the word null shows on Reminders", async ({ page }) => {
  await page.route("**/admin/api/seasonal**", (route) => json(route, 200, SEASONAL));
  await signIn(page, "#/reminders");
  await expect(page.getByRole("heading", { name: "Time to write" })).toBeVisible();
  expect(await strayNull(page.locator(".studio-reminders"))).toBe(false);
});

// ---- Reminders and Home ------------------------------------------------------------------------

const SEASONAL = {
  enabled: true, etag: "e1", trade: "roofing", entries: [], topics: [], today: "2026-11-13", voiceReady: false, reminders: [
    { key: "roofing-winter-2026", id: "roofing-winter", topic: `Winter ${HOSTILE}`, prompt: `Gutters. ${HOSTILE}`, opens: "2026-09-01", closes: "2026-11-30", status: "due", snoozedUntil: null, document: null },
  ],
};

test("regression: Start a draft only opens a draft; nothing publishes, rebuilds or sends; topics stay text", async ({ page }) => {
  const writes = [];
  page.on("request", (r) => { if (r.url().includes("/admin/api/") && r.method() !== "GET") writes.push(new URL(r.url()).pathname); });
  await page.route("**/admin/api/seasonal**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/admin/api/", "");
    if (path === "seasonal") return json(route, 200, SEASONAL);
    if (path === "seasonal/open") return json(route, 200, { key: "roofing-winter-2026", document: "posts/portable-lesson.md", created: true, draft: true });
    return json(route, 404, { error: "not found" });
  });
  await signIn(page, "#/reminders");
  await expect(page.locator(".studio-reminders")).toContainText(HOSTILE);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  writes.length = 0;
  await page.getByRole("button", { name: "Start a draft" }).click();
  await expect(page).toHaveURL(/#\/write\//);
  await page.waitForTimeout(800);
  expect(writes.filter((w) => !/\/(login|session)$/.test(w))).toEqual(["/admin/api/seasonal/open"]);
});

test("regression: a 409 with an etag reloads and says so", async ({ page }) => {
  await page.route("**/admin/api/seasonal**", async (route) => {
    if (route.request().method() === "PUT") return json(route, 409, { error: "changed", etag: "e2" });
    return json(route, 200, SEASONAL);
  });
  await signIn(page, "#/reminders");
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Turn reminders off" }).click();
  await expect(page.locator(".studio-reminders p[role=status]")).toHaveText("These changed on another device. Here they are now; make your change again.");
});

test("regression: Home lines show when there's something and stay silent when their services fail", async ({ page }) => {
  let fail = false;
  await page.route("**/admin/api/quote/requests", (route) => (fail ? json(route, 502, { error: "The quote function failed; try again" }) : json(route, 200, { requests: quoteRequests(), unreadable: 0, services: [], notifyEnabled: true })));
  await page.route("**/admin/api/seasonal", (route) => (fail ? json(route, 500, { error: "boom" }) : json(route, 200, SEASONAL)));
  await signIn(page, "#/");
  await expect(page.locator(".studio-waiting")).toContainText("2 new quote requests");
  await expect(page.locator(".studio-waiting")).toContainText(`Time to write: Winter ${HOSTILE}`);
  fail = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator(".studio-waiting")).toBeEmpty();
  await expect(page.locator("main alert-banner")).toHaveCount(0);
});

// ---- Sharing -----------------------------------------------------------------------------------

async function mockSharing(page, { onCreate } = {}) {
  const sent = [];
  const byKey = new Map();
  const items = [
    { id: UUID(11), version: 1, work: "/portable-lesson/", caption: `Ice dams ${HOSTILE}`, status: "failed", delivery: "failed", lastErrorCode: "provider-rejected", scheduledFor: "2026-11-12T09:00:00Z", destination: { provider: "facebook", displayName: `Ridgeline ${HOSTILE}`, kind: "page" } },
  ];
  await page.route("**/admin/api/social/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/social/", "");
    const body = route.request().postDataJSON?.() ?? null;
    if (path === "destinations") return json(route, 200, { destinations: [{ id: UUID(21), provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" }, { id: UUID(22), provider: "bluesky", displayName: "@ridgeline", kind: "account" }] });
    if (path === "posts") return json(route, 200, { posts: [{ work: "/portable-lesson/", title: "Ice dams: what to do", eligible: true, canonicalUrl: "https://example.org/portable-lesson/" }] });
    if (path === "accounts") return json(route, 200, { accounts: [] });
    if (path === "announcements" && route.request().method() === "GET") return json(route, 200, { announcements: items });
    if (path === "announcements" && route.request().method() === "POST") {
      sent.push(body);
      // As the hosted function does (ADR 0309): same key, same request replays; same key, different request is 409.
      const before = byKey.get(body.idempotencyKey);
      if (before) {
        const same = before.caption === body.caption && before.scheduledFor === body.scheduledFor && before.work === body.work;
        return same ? json(route, 200, { announcement: { id: UUID(40) }, replayed: true }) : json(route, 409, { error: "That request key was already used for a different announcement.", code: "idempotency-conflict" });
      }
      const answer = onCreate?.(body, sent.length);
      if (answer?.stored) byKey.set(body.idempotencyKey, body);
      if (answer?.status) return json(route, answer.status, answer.body || {});
      byKey.set(body.idempotencyKey, body);
      return json(route, 200, { announcement: { id: UUID(30 + sent.length), status: "scheduled" } });
    }
    return json(route, 404, { error: "not found" });
  });
  return sent;
}

test("regression: Sharing shows captions and account names as text", async ({ page }) => {
  await mockSharing(page);
  await signIn(page, "#/sharing");
  await expect(page.locator(".studio-sharing")).toContainText(`Ice dams ${HOSTILE}`);
  await expect(page.locator(".studio-sharing")).toContainText(`Ridgeline ${HOSTILE}`);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
});

test("In a few minutes is earlier than now + 5 minutes (seconds are cut off)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-13T15:00:45Z"));
  const sent = await mockSharing(page);
  await signIn(page, "#/sharing/new");
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  for (const s of sent) expect(Date.parse(s.scheduledFor)).toBeGreaterThanOrEqual(Date.parse("2026-11-13T15:05:45Z"));
});

test("regression: after a refused share, Share it again sends only the refused account, with its first key", async ({ page }) => {
  const sent = await mockSharing(page, { onCreate: (body, n) => (n === 2 ? { status: 422, body: { error: "too long", code: "caption-too-long" } } : null) });
  await signIn(page, "#/sharing/new");
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.locator(".studio-share-new p[role=status]")).toContainText("Shared to Facebook. Bluesky didn't take it");
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  expect(sent.map((s) => s.accountId)).toEqual([UUID(21), UUID(22), UUID(22)]);
  expect(sent[2].idempotencyKey).toBe(sent[1].idempotencyKey);
});

test("a 422 caption code lands in the status line, not on the caption field", async ({ page }) => {
  await mockSharing(page, { onCreate: () => ({ status: 422, body: { error: "too long", code: "caption-too-long" } }) });
  await signIn(page, "#/sharing/new");
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.locator(".studio-share-new p[role=status]")).toContainText("didn't take it");
  expect(await page.locator(".studio-share-new text-field").first().evaluate((el) => el.error || "")).not.toBe("");
});

test("regression: after an unknown outcome (timeout), Studio says it may have gone and never sends it again", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-13T15:00:10Z"));
  // Bluesky's first try was stored by the hosted function, but the answer never came back.
  const sent = await mockSharing(page, { onCreate: (body, n) => (n === 2 ? { stored: true, status: 504, body: { error: "The hosted social function timed out." } } : null) });
  await signIn(page, "#/sharing/new");
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.locator(".studio-share-new p[role=status]")).toContainText("Your blog didn't hear back from Bluesky; it may have it.");
  await page.clock.setFixedTime(new Date("2026-11-13T15:01:10Z"));
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page.locator(".studio-share-new p[role=status]")).toHaveText("Choose at least one account to share to.");
  expect(sent.length).toBe(2);
});

test("regression: a session that expires mid-share signs in again and resends the same key", async ({ page }) => {
  let expired = true;
  const sent = await mockSharing(page);
  await signIn(page, "#/sharing/new");
  await page.route("**/admin/api/social/announcements", async (route) => {
    if (route.request().method() === "POST" && expired && route.request().postDataJSON().accountId === UUID(22)) { expired = false; sent.push({ ...route.request().postDataJSON(), expired: true }); return json(route, 401, { error: "Sign in" }); }
    return route.fallback();
  });
  await page.getByRole("button", { name: "Share it" }).click();
  await page.getByRole("textbox", { name: "Your name", exact: true }).fill("writer");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  const bluesky = sent.filter((s) => s.accountId === UUID(22));
  expect(bluesky).toHaveLength(2);
  expect(bluesky[1].idempotencyKey).toBe(bluesky[0].idempotencyKey);
  expect(sent.filter((s) => s.accountId === UUID(21))).toHaveLength(1);
});

test("regression: double-clicking Share it sends one share per account", async ({ page }) => {
  const sent = await mockSharing(page);
  await signIn(page, "#/sharing/new");
  await page.getByRole("button", { name: "Share it" }).dblclick();
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(sent.length).toBe(2);
});

test("regression: leaving with a changed caption asks; Leave without sharing shares nothing", async ({ page }) => {
  const sent = await mockSharing(page);
  await signIn(page, "#/sharing/new");
  await page.getByRole("textbox", { name: "What to say" }).fill("Ice dams can ruin a roof.");
  await page.getByRole("link", { name: "Back to Sharing" }).click();
  await expect(page.getByRole("heading", { name: "Share this post?" })).toBeVisible();
  await page.getByRole("button", { name: "Leave without sharing" }).click();
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("regression: hosted-key-rejected on load says to tell the person who set it up, without server words", async ({ page }) => {
  await page.route("**/admin/api/social/destinations", (route) => json(route, 502, { error: "OPENBLOG_SOCIAL_ADMIN_KEY rejected", code: "hosted-key-rejected" }));
  await signIn(page, "#/sharing");
  await expect(page.locator(".studio-sharing")).toContainText("Sharing isn't working right now. Tell the person who set up your site.");
  const firstLayer = await page.locator(".studio-comment-main").innerText();
  expect(firstLayer).not.toMatch(/OPENBLOG/);
});

// ---- Every screen, dark and reduced motion -----------------------------------------------------

test("regression: dark mode with reduced motion passes axe (contrast included) at 320 px on every screen", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 800 });
  await mockQuotes(page);
  await mockSharing(page);
  await page.route("**/admin/api/seasonal", (route) => json(route, 200, SEASONAL));
  for (const hash of ["#/quotes", "#/reminders", "#/sharing", "#/sharing/new", "#/tools", "#/"]) {
    await signIn(page, hash);
    await expect(page.locator(".studio-page h2").first()).toBeVisible();
    await page.waitForTimeout(700);
    await shot(page, `dark-320-${hash.replace(/\W+/g, "_")}`);
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    expect(results, hash).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), hash).toBe(false);
  }
});

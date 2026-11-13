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

// The seasonal settings, as the server keeps them: bundled topics changed by entries, own topics added.
function seasonalServer() {
  const BUNDLED = [
    { id: "roofing-winter", topic: "Get the roof ready before winter", prompt: "Gutters, flashing and loose shingles.", start: "09-01", end: "10-31" },
    { id: "roofing-ice", topic: "Ice dams", prompt: "What do you tell people about ice dams?", start: "12-01", end: "02-28" },
  ];
  const state = { etag: 1, entries: [], puts: [] };
  const describe = () => ({
    enabled: true, etag: `e${state.etag}`, trade: "roofing", entries: state.entries, today: "2026-11-13", voiceReady: false,
    topics: [
      ...BUNDLED.map((t) => ({ ...t, ...(state.entries.find((e) => e.id === t.id) || {}), disabled: Boolean(state.entries.find((e) => e.id === t.id)?.disabled), custom: false })),
      ...state.entries.filter((e) => !BUNDLED.some((t) => t.id === e.id)).map((e) => ({ ...e, disabled: Boolean(e.disabled), custom: true })),
    ].map(({ id, topic, prompt, start, end, disabled, custom }) => ({ id, topic, prompt, start, end, disabled, custom })),
    reminders: [{ key: "roofing-winter-2026", id: "roofing-winter", topic: "Get the roof ready before winter", prompt: "Gutters.", opens: "2026-09-01", closes: "2026-11-30", status: "due", snoozedUntil: null, document: null }],
  });
  return { state, describe };
}

async function mockSeasonal(page, server = seasonalServer()) {
  await page.route("**/admin/api/seasonal**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/admin/api/", "");
    if (path !== "seasonal") return json(route, 404, { error: "not found" });
    if (route.request().method() === "GET") return json(route, 200, server.describe());
    const body = route.request().postDataJSON();
    server.state.puts.push(body);
    if (server.state.conflictNext) { server.state.conflictNext = false; server.state.etag += 1; return json(route, 409, { ...server.describe(), error: "changed" }); }
    if (body.etag !== `e${server.state.etag}`) return json(route, 409, { ...server.describe(), error: "changed" });
    server.state.entries = body.seasonalPrompts.topics;
    server.state.etag += 1;
    return json(route, 200, server.describe());
  });
  return server;
}

test("Reminders: change a topic's words and dates, turn one off with Undo, add and remove her own; leaving asks", async ({ page }) => {
  const server = await mockSeasonal(page);
  await signIn(page, "#/reminders");
  await expect(page.getByRole("heading", { name: "What's worth writing about now?" })).toBeVisible();
  await expect(page.locator("a[href^='/admin/']")).toHaveCount(0);
  // From the card: its form opens with the first field focused.
  await page.locator(".studio-reminders .studio-comment").first().getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Change its dates…" }).click();
  const sheet = page.locator("side-sheet");
  await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Topic" })).toBeFocused();
  const save = sheet.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await sheet.getByRole("combobox", { name: "Starts, month" }).selectOption({ label: "October" });
  await sheet.getByRole("combobox", { name: "Ends, month" }).selectOption({ label: "February" });
  await expect(sheet.getByText("Runs across the new year.")).toBeVisible();
  await sheet.getByRole("textbox", { name: "What to write about" }).fill(`Ladders and gutters. ${HOSTILE}`);
  await save.click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Saved. Studio suggests “Get the roof ready before winter” from October 1 to February 29.");
  expect(server.state.puts.at(-1)).toEqual({ etag: "e1", seasonalPrompts: { enabled: true, topics: [{ id: "roofing-winter", topic: "Get the roof ready before winter", prompt: `Ladders and gutters. ${HOSTILE}`, start: "10-01", end: "02-29" }] } });
  // Put back the original, with Undo.
  const winter = sheet.locator("[data-topic='roofing-winter']");
  await winter.getByRole("button", { name: /Change/ }).click();
  await winter.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Put back the original" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("“Get the roof ready before winter” is back to how it came.");
  expect(server.state.entries).toEqual([]);
  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => server.state.entries.length).toBe(1);
  // Turn Ice dams off, then Undo.
  const ice = sheet.locator("[data-topic='roofing-ice']");
  await ice.getByRole("switch", { name: "Suggest this" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Studio won't suggest “Ice dams” any more.");
  expect(server.state.entries.find((e) => e.id === "roofing-ice")).toEqual({ id: "roofing-ice", disabled: true });
  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("“Ice dams” is back.");
  // Add her own: a name is needed first.
  await sheet.getByRole("button", { name: "Add your own topic" }).click();
  await sheet.getByRole("button", { name: "Add it" }).click();
  await expect(sheet.getByText("Give the topic a name.")).toBeVisible();
  await expect(sheet.locator("[data-topic='new']").getByRole("textbox", { name: "Topic" })).toBeFocused();
  await sheet.locator("[data-topic='new']").getByRole("textbox", { name: "Topic" }).fill("Gutter day");
  await sheet.locator("[data-topic='new']").getByRole("textbox", { name: "What to write about" }).fill("Why clean gutters matter.");
  await sheet.getByRole("button", { name: "Add it" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Added. Studio suggests “Gutter day” from November 13 to December 13.");
  await expect(sheet.locator("[data-topic='own-gutter-day'] h3")).toBeFocused();
  expect(server.state.entries.at(-1)).toEqual({ id: "own-gutter-day", topic: "Gutter day", prompt: "Why clean gutters matter.", start: "11-13", end: "12-13" });
  // Strangers' text stays text.
  expect(await page.locator("img[src=x]").count()).toBe(0);
  // Remove her own: asks once, then Undo puts it back.
  const own = sheet.locator("[data-topic='own-gutter-day']");
  await own.getByRole("button", { name: /Change/ }).click();
  await own.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Remove this topic…" }).click();
  await expect(page.getByRole("heading", { name: "Remove “Gutter day”?" })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Removed “Gutter day”.");
  expect(server.state.entries.some((e) => e.id === "own-gutter-day")).toBe(false);
  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect(sheet.locator("[data-topic='own-gutter-day']")).toBeVisible();
  // Another device changed them: her open form keeps what she typed.
  await ice.getByRole("button", { name: /Change/ }).click();
  await ice.getByRole("textbox", { name: "Topic" }).fill("Ice dams and icicles");
  server.state.conflictNext = true;
  await ice.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("These changed on another device. Here they are now; press Save again.");
  await expect(ice.getByRole("textbox", { name: "Topic" })).toHaveValue("Ice dams and icicles");
  // Leaving with the changed form asks first, and staying keeps it.
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.getByRole("heading", { name: "Save this topic?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/reminders$/);
  await expect(ice.getByRole("textbox", { name: "Topic" })).toHaveValue("Ice dams and icicles");
  // Escape on the sheet asks too; Leave without saving closes it.
  await ice.getByRole("textbox", { name: "Topic" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Save this topic?" })).toBeVisible();
  await page.getByRole("button", { name: "Leave without saving" }).click();
  await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toHaveCount(0);
});

const CUTOFF = "2026-10-14T12:00:00Z";

function mockQuoteSheets(page, { retentionDays = null, retentionSource = null, wouldErase = 3, tooOld = false } = {}) {
  const calls = [];
  return page.route("**/admin/api/quote/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/quote/", "");
    const body = route.request().postDataJSON?.() ?? null;
    calls.push({ path, query: Object.fromEntries(url.searchParams), body });
    if (path === "status") return json(route, 200, { enabled: true, state: "on" });
    if (path === "requests") return json(route, 200, { requests: [{ id: UUID(1), status: "archived", name: "Pat Miller", phone: "304", town: "Elkins", service: "Roof", description: "x", photos: [], photoCount: 0, createdAt: new Date().toISOString(), notify: "sent", notifyAttempts: 1 }], unreadable: 0, services: [], retentionDays, retentionSource, notifyEnabled: true });
    if (path === "export") return json(route, 200, url.searchParams.get("from") === "2026-01-01" ? { csv: "", filename: "q.csv", count: 0 } : { csv: "name\nPat\n", filename: "quote-requests.csv", count: 14 });
    if (path === "retention") return json(route, 200, { retentionDays: body.days, retentionSource: body.days ? "admin" : null });
    if (path === "retention/run" && tooOld) return json(route, 409, { error: "The quote function is older than this Admin and could erase without counting first; deploy the current netlify/functions/quote.mjs", code: "hosted-too-old" });
    if (path === "retention/run") return json(route, 200, body.dryRun ? { enabled: true, wouldErase, photos: 2, before: CUTOFF } : { enabled: true, erased: wouldErase, photosPending: 1 });
    return json(route, 404, { error: "not found" });
  }).then(() => calls);
}

test("Requests: download chosen days; clean up archived requests, checked first and asked once", async ({ page }) => {
  const calls = await mockQuoteSheets(page);
  await signIn(page, "#/quotes");
  await expect(page.getByRole("heading", { name: "Who's asking for a quote?" })).toBeVisible();
  await expect(page.locator("a[href^='/admin/']")).toHaveCount(0);
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Download a spreadsheet…" }).click();
  const sheet = page.locator("side-sheet");
  await expect(sheet.getByRole("heading", { name: "Download a spreadsheet" })).toBeVisible();
  await sheet.getByLabel("From").fill("2026-11-05");
  await sheet.getByLabel("To").fill("2026-11-01");
  await sheet.getByRole("button", { name: "Download" }).click();
  await expect(sheet.getByText("Pick a day on or after November 5.")).toBeVisible();
  await sheet.getByLabel("From").fill("2026-11-01");
  await sheet.getByLabel("To").fill("2026-11-13");
  const download = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("quote-requests.csv");
  await expect(sheet.locator("p[role=status]")).toHaveText("Downloaded 14 requests from November 1 to November 13.");
  expect(calls.find((c) => c.path === "export").query).toEqual({ from: "2026-11-01", to: "2026-11-13" });
  await sheet.getByLabel("From").fill("2026-01-01");
  await sheet.getByLabel("To").fill("2026-01-02");
  await sheet.getByRole("button", { name: "Download" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("No requests in those days, so there's nothing to download.");
  await sheet.getByRole("button", { name: "Done" }).click();
  // Clean up: on, a bad number is said on the field, then saved.
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Clean up archived requests…" }).click();
  await expect(sheet.getByRole("heading", { name: "Clean up archived requests" })).toBeVisible();
  await sheet.getByRole("switch", { name: "Erase archived requests by themselves" }).click();
  const days = sheet.getByRole("textbox", { name: "After how many days" });
  await expect(days).toHaveValue("30");
  await days.fill("0");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.getByText("Write a number of days from 1 to 3650.")).toBeVisible();
  await days.fill("30");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Saved. Archived requests are erased 30 days after you archive them.");
  expect(calls.find((c) => c.path === "retention").body).toEqual({ days: 30 });
  // Erase the old ones now: a dry run first, then asked once.
  await sheet.getByRole("button", { name: "Erase the old ones now" }).click();
  await expect(page.getByRole("heading", { name: "Erase 3 old requests now?" })).toBeVisible();
  await expect(page.getByText("They were archived more than 30 days ago. They and their 2 photos go for good; this can't be undone.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep them" })).toBeFocused();
  await page.getByRole("button", { name: "Erase for good" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Erased 3 old requests. 1 photo is still being removed; nothing points to it.");
  // The erase takes only what was counted: it passes the count's cutoff.
  expect(calls.filter((c) => c.path === "retention/run").map((c) => c.body)).toEqual([{ dryRun: true }, { before: CUTOFF }]);
  // A changed setting asks before leaving.
  await sheet.getByRole("switch", { name: "Erase archived requests by themselves" }).click();
  await page.evaluate(() => { location.hash = "#/"; });
  await expect(page.getByRole("heading", { name: "Save this?" })).toBeVisible();
  await page.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
});

test("Requests: a host-set period shows no fields, and nothing old enough says so", async ({ page }) => {
  const calls = await mockQuoteSheets(page, { retentionDays: 30, retentionSource: "host", wouldErase: 0 });
  await signIn(page, "#/quotes");
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Clean up archived requests…" }).click();
  const sheet = page.locator("side-sheet");
  await expect(sheet.getByText("Archived requests are erased 30 days after you archive them. The person who set up your site chose this.")).toBeVisible();
  await expect(sheet.getByRole("switch")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Erase the old ones now" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Nothing is old enough to erase yet.");
  expect(calls.filter((c) => c.path === "retention/run").map((c) => c.body)).toEqual([{ dryRun: true }]);
});

test("Requests: an older requests service is said in plain words, and nothing is erased", async ({ page }) => {
  const calls = await mockQuoteSheets(page, { retentionDays: 30, retentionSource: "admin", tooOld: true });
  await signIn(page, "#/quotes");
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Clean up archived requests…" }).click();
  const sheet = page.locator("side-sheet");
  await sheet.getByRole("button", { name: "Erase the old ones now" }).click();
  await expect(sheet.locator("p[role=status]")).toHaveText("Your requests service needs updating before Studio can clean up. Tell the person who set up your site.");
  await expect(page.getByRole("heading", { name: /Erase .* now\?/ })).toHaveCount(0);
  const details = sheet.locator("details");
  await details.locator("summary").click();
  await expect(details).toContainText("409 (hosted-too-old)");
  expect(calls.filter((c) => c.path === "retention/run").map((c) => c.body)).toEqual([{ dryRun: true }]);
});

test("Escape on “Save this topic?” goes back to the sheet with her edits, and sheets keep opening", async ({ page }) => {
  await mockSeasonal(page);
  await signIn(page, "#/reminders");
  const sheet = page.locator("side-sheet");
  const openSheet = async () => {
    await page.getByRole("button", { name: /More/ }).first().click();
    await page.getByRole("menuitem", { name: "Change topics and dates…" }).click();
    await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toBeVisible();
  };
  await openSheet();
  const ice = sheet.locator("[data-topic='roofing-ice']");
  await ice.getByRole("button", { name: /Change/ }).click();
  await ice.getByRole("textbox", { name: "Topic" }).fill("Ice dams and icicles");
  for (let round = 0; round < 2; round += 1) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Save this topic?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Save this topic?" })).toHaveCount(0);
    await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toBeVisible();
    await expect(ice.getByRole("textbox", { name: "Topic" })).toHaveValue("Ice dams and icicles");
    expect(await page.evaluate(() => Boolean(document.querySelector("side-sheet")?.contains(document.activeElement)))).toBe(true);
  }
  // The × asks too, and Escape there also keeps the sheet and her edits.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Save this topic?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Save this topic?" })).toHaveCount(0);
  await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toBeVisible();
  await expect(ice.getByRole("textbox", { name: "Topic" })).toHaveValue("Ice dams and icicles");
  expect(await page.evaluate(() => Boolean(document.querySelector("side-sheet")?.contains(document.activeElement)))).toBe(true);
  // Leaving without saving closes it; it opens again, and again after an Escape with nothing changed.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave without saving" }).click();
  await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toHaveCount(0);
  await openSheet();
  await expect(ice.getByRole("textbox", { name: "Topic" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("heading", { name: "Topics for roofing" })).toHaveCount(0);
  await openSheet();
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

async function mockSharingRows(page, { patchCode = null } = {}) {
  const sent = [];
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 11) + "09:00:00Z";
  const items = [
    { id: UUID(41), version: 2, work: "/portable-lesson/", caption: `Ice dams ${HOSTILE}`, status: "unknown", delivery: "unknown", lastErrorCode: "timeout", scheduledFor: "2026-11-12T09:00:00Z", destination: { provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" } },
    { id: UUID(42), version: 3, work: "/portable-lesson/", caption: "Storm tips", status: "scheduled", scheduledFor: soon, destination: { provider: "bluesky", displayName: "@ridgeline", kind: "account" } },
    { id: UUID(43), version: 1, work: "/portable-lesson/", caption: "Going now", status: "claimed", delivery: "processing", scheduledFor: "2026-11-13T09:00:00Z", destination: { provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" } },
  ];
  await page.route("**/admin/api/social/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/social/", "");
    const method = route.request().method();
    const body = route.request().postDataJSON?.() ?? null;
    if (path === "destinations") return json(route, 200, { destinations: [{ id: UUID(21), provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" }, { id: UUID(22), provider: "bluesky", displayName: "@ridgeline", kind: "account" }] });
    if (path === "posts") return json(route, 200, { posts: [{ work: "/portable-lesson/", title: "Ice dams: what to do", eligible: true, canonicalUrl: "https://example.org/portable-lesson/" }] });
    if (path === "accounts") return json(route, 200, { accounts: [] });
    if (path === "announcements/health") return json(route, 200, { health: { installed: true, alerts: ["backlog-overdue", "provider-not-configured", "needs-review"], overdue: 1, waitingOnProvider: 2, needsReview: 1 } });
    if (path === "announcements" && method === "GET") return json(route, 200, { announcements: items });
    if (path === "preview") { sent.push({ preview: body }); return json(route, 200, { ok: true, caption: body.caption, link: "https://example.org/portable-lesson/", card: { title: "Ice dams: what to do", description: "Before winter." }, cover: null, problems: [] }); }
    if (path === "announcements" && method === "PATCH") {
      sent.push({ patch: url.searchParams.get("id"), ...body });
      if (patchCode) return json(route, 409, { error: "x", code: patchCode });
      const item = items.find((i) => i.id === url.searchParams.get("id"));
      Object.assign(item, body.caption ? { caption: body.caption } : {}, body.scheduledFor ? { scheduledFor: body.scheduledFor } : {}, { version: item.version + 1 });
      return json(route, 200, { announcement: item });
    }
    if (path === "announcements/resolve") {
      sent.push({ resolve: url.searchParams.get("id"), ...body });
      Object.assign(items[0], body.outcome === "published" ? { status: "published", delivery: "published", lastErrorCode: null } : { status: "failed", delivery: "failed", lastErrorCode: "reviewed-not-posted" });
      return json(route, 200, { announcement: items[0] });
    }
    if (path === "announcements/attempts") return json(route, 200, { delivery: "unknown", timelineExact: true, timeline: [
      { at: "2026-11-12T09:00:00Z", change: "created", state: "pending", attemptNo: 0, code: null, scheduledFor: null },
      { at: "2026-11-12T09:01:00Z", change: "status", state: "retrying", attemptNo: 1, code: "provider-unavailable", scheduledFor: null },
      { at: "2026-11-12T09:07:00Z", change: "status", state: "unknown", attemptNo: 2, code: "timeout", scheduledFor: null },
    ], attempts: [{ attemptNo: 1, outcome: "transient", httpStatus: 503, errorCode: "provider-unavailable" }, { attemptNo: 2, outcome: "unknown", httpStatus: null, errorCode: "timeout" }] });
    return json(route, 404, { error: "not found" });
  });
  return sent;
}

test("Sharing: change a share's words or time with its preview, check an unclear one, see its history, and hear when it's late", async ({ page }) => {
  const sent = await mockSharingRows(page);
  await signIn(page, "#/sharing");
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  await expect(page.locator(".studio-sharing a[href='/admin/#/announcements']")).toHaveCount(0);
  await expect(page.getByText("Shares are running late")).toBeVisible();
  await expect(page.getByText("2 shares are waiting for an account that isn't set up to post.", { exact: false })).toBeVisible();
  const going = page.locator(".studio-comment", { hasText: "Going now" });
  await expect(going.getByText("It's going out now. This updates in a minute.")).toBeVisible();
  await expect(going.locator(".studio-comment-actions")).toHaveCount(0);
  // Change: only what changed is sent, after a preview.
  const storm = page.locator(".studio-comment", { hasText: "Storm tips" });
  await storm.getByRole("button", { name: "Change" }).click();
  const sheet = page.locator("side-sheet");
  const caption = sheet.getByRole("textbox", { name: "What to say" });
  await expect(caption).toBeFocused();
  await expect(caption).toHaveValue("Storm tips");
  await expect(sheet.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await caption.fill("Storm tips: what to check after hail");
  await expect(sheet.getByText("36 of 300")).toBeVisible();
  await expect(sheet.getByText("How it looks on Bluesky")).toBeVisible();
  await sheet.getByText("How it looks on Bluesky").click();
  await expect(sheet.getByText(/On Bluesky the link is a card with the post's title/)).toBeVisible();
  expect(sent.find((s) => s.preview).preview).toMatchObject({ provider: "bluesky", caption: "Storm tips: what to check after hail", work: "/portable-lesson/" });
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".studio-sharing p[role=status]")).toHaveText(/^Changed\. It goes out .+\.$/);
  const patch = sent.find((s) => s.patch);
  expect(patch).toEqual({ patch: UUID(42), version: 3, timeZone: expect.any(String), caption: "Storm tips: what to check after hail" });
  await expect(page.locator(".studio-comment", { hasText: "Storm tips" }).locator("h4")).toBeFocused();
  // Time alone: no caption sent.
  await page.locator(".studio-comment", { hasText: "Storm tips" }).getByRole("button", { name: "Change" }).click();
  await sheet.getByRole("textbox", { name: "Time" }).fill("10:30");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".studio-sharing p[role=status]")).toHaveText(/at 10:30 AM\.$/);
  const second = sent.filter((s) => s.patch)[1];
  expect(second.caption).toBeUndefined();
  expect(second.version).toBe(4);
  expect(second.scheduledFor).toMatch(/T\d\d:30:00Z$/);
  // Leaving a changed share asks.
  await page.locator(".studio-comment", { hasText: "Storm tips" }).getByRole("button", { name: "Change" }).click();
  await caption.fill("Half typed");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Save your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Leave without saving" }).click();
  await expect(sheet.getByRole("textbox", { name: "What to say" })).toHaveCount(0);
  expect(sent.filter((s) => s.patch)).toHaveLength(2);
  // Check it: Save waits for her answer; no post id needed.
  const ice = page.locator(`.studio-comment[data-id="${UUID(41)}"]`);
  await expect(ice.getByText(HOSTILE, { exact: false })).toBeVisible();
  await ice.getByRole("button", { name: "Check it" }).click();
  await expect(sheet.getByText("Facebook didn't say whether it posted. Look at your Facebook Page, Ridgeline Roofing. Is it there?")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await sheet.getByText("It's there", { exact: true }).click();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".studio-sharing p[role=status]")).toHaveText("Marked as shared.");
  expect(sent.find((s) => s.resolve)).toEqual({ resolve: UUID(41), version: 2, outcome: "published" });
  // Its history, newest last.
  await page.locator(`.studio-comment[data-id="${UUID(41)}"]`).getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Show its history" }).click();
  await expect(sheet.getByRole("heading", { name: "What happened to this share" })).toBeVisible();
  await expect(sheet.locator("ol li")).toHaveCount(3);
  await expect(sheet.locator("ol li").nth(1)).toHaveText(/tried, didn't go out\. Facebook was busy\.$/);
  await expect(sheet.getByText("Tried 2 times.")).toBeVisible();
  expect(await page.locator("img[src=x]").count()).toBe(0);
});

test("Sharing: a share that started going out can't be changed, and says so", async ({ page }) => {
  await mockSharingRows(page, { patchCode: "not-editable" });
  await signIn(page, "#/sharing");
  await page.locator(".studio-comment", { hasText: "Storm tips" }).getByRole("button", { name: "Change" }).click();
  await page.locator("side-sheet").getByRole("textbox", { name: "What to say" }).fill("New words");
  await page.locator("side-sheet").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".studio-sharing p[role=status]")).toHaveText("It started going out, so it can't be changed now.");
  await expect(page.locator("side-sheet").getByRole("textbox", { name: "What to say" })).toHaveCount(0);
});

test("Share a post shows how it looks on each kind of account chosen", async ({ page }) => {
  const sent = await mockSharingRows(page);
  await signIn(page, "#/sharing/new");
  await expect(page.getByRole("heading", { name: "Share a post", level: 2 })).toBeVisible();
  await expect(page.getByText("How it looks on Facebook")).toBeVisible();
  await expect(page.getByText("How it looks on Bluesky")).toBeVisible();
  expect(sent.filter((s) => s.preview).map((s) => s.preview.provider).sort()).toEqual(["bluesky", "facebook"]);
});

async function axeClean(page, selector, label) {
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), selector);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  expect(await page.evaluate((sel) => { const d = document.querySelector(sel); return d ? d.scrollWidth > d.clientWidth + 1 : false; }, `${selector} dialog`), `${label} sheet`).toBe(false);
}

test("R1 sheets on Reminders and Requests pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockSeasonal(page);
  await mockQuoteSheets(page, { retentionDays: 30, retentionSource: "admin" });
  await signIn(page, "#/reminders");
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Change topics and dates…" }).click();
  await page.locator("side-sheet [data-topic='roofing-ice']").getByRole("button", { name: /Change/ }).click();
  await axeClean(page, "side-sheet", "topics sheet");
  await page.locator("side-sheet").getByRole("button", { name: "Cancel" }).click();
  await page.keyboard.press("Escape");
  await signIn(page, "#/quotes");
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Download a spreadsheet…" }).click();
  await axeClean(page, "side-sheet", "download sheet");
  await page.locator("side-sheet").getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /More/ }).first().click();
  await page.getByRole("menuitem", { name: "Clean up archived requests…" }).click();
  await axeClean(page, "side-sheet", "clean-up sheet");
});

test("R1 sheets on Sharing pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockSharingRows(page);
  await signIn(page, "#/sharing");
  await expect(page.getByText("Shares are running late")).toBeVisible();
  await axeClean(page, "main", "sharing with its banner");
  await page.locator(".studio-comment", { hasText: "Storm tips" }).getByRole("button", { name: "Change" }).click();
  await expect(page.getByText("How it looks on Bluesky")).toBeVisible();
  await axeClean(page, "side-sheet", "change sheet");
  await page.locator("side-sheet").getByRole("button", { name: "Cancel" }).click();
  await page.locator(`.studio-comment[data-id="${UUID(41)}"]`).getByRole("button", { name: "Check it" }).click();
  await axeClean(page, "side-sheet", "check sheet");
  await page.locator("side-sheet").getByRole("button", { name: "Cancel" }).click();
  await page.locator(`.studio-comment[data-id="${UUID(41)}"]`).getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Show its history" }).click();
  await expect(page.getByText("Tried 2 times.")).toBeVisible();
  await axeClean(page, "side-sheet", "history sheet");
});

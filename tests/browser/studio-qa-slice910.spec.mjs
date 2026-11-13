import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// QA probes for Studio slices 9 (Cards, Visitors) and 10a (Business, Services, Reviews). Two sites:
// Grammi's (greeting cards set up, the built-in counter on, no trade) and Dana's trade site. Probes
// marked "BUG" fail today and demonstrate a defect; the rest guard behaviour that holds.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const key = randomBytes(24).toString("hex");
const RICKY = "11111111-1111-4111-8111-111111111111";
const JIMMY = "22222222-2222-4222-8222-222222222222";
const sent = [];
let fake;
let grammi;
let trade;

async function start(root, env = {}) {
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe", env: { ...process.env, ...env } });
  let output = "";
  server.stdout.on("data", (d) => { output += d; });
  server.stderr.on("data", (d) => { output += d; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
  return { root, server, origin };
}

function site(name) {
  const root = mkdtempSync(join(tmpdir(), `openblog-qa910-${name}-`));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  return root;
}

test.beforeAll(async () => {
  const contacts = [
    { id: RICKY, name: "Ricky", email: "ricky@example.com", birthday: "1990-09-07" },
    { id: JIMMY, name: "Jimmy", email: "jimmy@example.com", birthday: null },
  ];
  const cards = [
    { id: "33333333-3333-4333-8333-333333333333", contactId: JIMMY, design: "christmas", subject: "Merry Christmas", message: "Love you", signOff: "Love, Grammi", sendOn: "2026-12-25", hour: 8, timeZone: "America/New_York", yearly: false, status: "failed", nextSendAt: null, lastSentAt: null, attempts: 3, error: "rejected" },
  ];
  fake = createHttpServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${key}`) return reply(401, { error: "unauthorized" });
    const path = req.url.replace(/^\/api\/greetings\/?/, "");
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", async () => {
      const body = raw ? JSON.parse(raw) : {};
      if (path === "status") return reply(200, { timeZone: "America/New_York", from: { name: "Grammi", email: "grammi@example.com" }, designs: [{ id: "birthday", label: "Birthday", subject: "Happy birthday, {name}!" }, { id: "just-because", label: "Just because", subject: "Thinking of you" }, { id: "christmas", label: "Christmas", subject: "Merry Christmas" }] });
      if (path === "contacts" && req.method === "GET") return reply(200, { contacts });
      if (path === "cards" && req.method === "GET") return reply(200, { cards });
      // The real function names the field it refuses (netlify/lib/greeting-card.mjs).
      if (path === "cards" && body.message === "BAD DAY") return reply(400, { error: "invalid-day", field: "sendOn" });
      if (path === "cards") {
        await new Promise((r) => setTimeout(r, 400)); // slow, so a double click lands while saving
        const card = { id: randomUUID(), ...body, status: "scheduled", nextSendAt: new Date(Date.now() + 30 * 86400000).toISOString(), lastSentAt: null, attempts: 0, error: null };
        cards.push(card); sent.push(body);
        return reply(200, { card });
      }
      return reply(404, { error: "not-found" });
    });
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  grammi = await start(site("grammi"), { OPENBLOG_GREETINGS_ENDPOINT: `http://127.0.0.1:${fake.address().port}/api/greetings`, OPENBLOG_GREETINGS_ADMIN_KEY: key });

  const root = site("trade");
  const configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.business = { trade: "roofing", displayName: "Ridgeline Roofing", phone: "+13045550142" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  mkdirSync(join(root, "content", "services"), { recursive: true });
  mkdirSync(join(root, "content", "proof"), { recursive: true });
  writeFileSync(join(root, "content", "services", "gutters.md"), [
    "---", "version: \"1\"", "id: gutters", "name: Gutter cleaning", "summary: We clear the gutters.", "includes: Downspouts",
    "faq.1.question: First question?", "faq.1.answer: First answer.", "faq.2.question: Second question?", "faq.2.answer: Second answer.",
    "crew: Dana and Sam", "---", "", "Body words.", "",
  ].join("\n"));
  trade = await start(root);
  trade.configPath = configPath;
});

test.afterAll(async () => {
  fake?.close();
  for (const s of [grammi, trade]) {
    if (s?.server && s.server.exitCode === null) { const stopped = once(s.server, "exit"); s.server.kill(); await stopped; }
    if (s?.root) removeTree(s.root);
  }
});

async function signIn(page, origin, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const nav = (page) => page.locator("dashboard-shell, nav").first();

// ---- Grammi's site ---------------------------------------------------------------------------

test("Grammi's nav has Cards and Visitors but never Services, Reviews or Business", async ({ page }) => {
  await signIn(page, grammi.origin, "#/");
  await expect(page.getByRole("link", { name: "Cards", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Visitors", exact: true }).first()).toBeVisible();
  for (const item of ["Services", "Reviews", "Business"]) await expect(page.getByRole("link", { name: item, exact: true })).toHaveCount(0);
});

test("a design name keeps its capital (\"Jimmy's Christmas card\", not \"christmas\")", async ({ page }) => {
  await signIn(page, grammi.origin, "#/");
  await expect(page.getByRole("link", { name: /Jimmy's Christmas card didn't go out/ })).toBeVisible({ timeout: 8000 });
});

test("Escape on 'Pick up where you left off?' keeps the draft on the device", async ({ page }) => {
  await signIn(page, grammi.origin, "#/cards/new");
  await page.getByRole("textbox", { name: "Your message" }).fill("Words I must not lose");
  await page.goto(`${grammi.origin}/admin/studio/#/`);
  const leave = page.getByRole("button", { name: "Leave for now" });
  if (await leave.isVisible().catch(() => false)) await leave.click();
  await page.goto(`${grammi.origin}/admin/studio/#/cards/new`);
  await expect(page.getByRole("button", { name: "Pick up" })).toBeVisible();
  await page.keyboard.press("Escape"); // she closes the question without answering
  // Closing it keeps the words: they're picked up, not thrown away.
  await expect(page.getByRole("textbox", { name: "Your message" })).toHaveValue("Words I must not lose");
});

test("a 400 for the day lands on the 'Send it on' field", async ({ page }) => {
  await signIn(page, grammi.origin, "#/cards/new?for=" + JIMMY);
  const fresh = page.getByRole("button", { name: "Start fresh" });
  if (await fresh.isVisible({ timeout: 1500 }).catch(() => false)) await fresh.click();
  await page.getByRole("textbox", { name: "Your message" }).fill("BAD DAY");
  await page.getByRole("button", { name: "Schedule this card" }).click();
  await expect(page.locator(".studio-card-edit p[role=status]")).toHaveText("Pick a day from the calendar");
  // The spec: "A 400 with data.field puts its message on that field, focuses it".
  // date-field has no error slot yet, so its description carries the problem.
  await expect(page.locator("date-field").first()).toContainText("Pick a day from the calendar");
});

test("double-clicking Schedule this card sends one card", async ({ page }) => {
  await signIn(page, grammi.origin, "#/cards/new?for=" + JIMMY);
  const fresh = page.getByRole("button", { name: "Start fresh" });
  if (await fresh.isVisible({ timeout: 1500 }).catch(() => false)) await fresh.click();
  await page.getByRole("textbox", { name: "Your message" }).fill("Only once");
  const before = sent.length;
  await page.getByRole("button", { name: "Schedule this card" }).dblclick();
  await expect(page.getByRole("heading", { name: "Who gets a card?" })).toBeVisible();
  expect(sent.length - before).toBe(1);
});

test("Escape on the Add someone sheet asks before throwing away what was typed", async ({ page }) => {
  await signIn(page, grammi.origin, "#/cards");
  await page.locator(".studio-card-people").getByRole("button", { name: "Add someone" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Pappy");
  await page.keyboard.press("Escape");
  // Spec: "Escape closes and asks first if anything was typed."
  await expect(page.getByRole("dialog").filter({ hasText: /Pappy|typed|throw|lose/i })).toBeVisible({ timeout: 3000 });
});

test("Visitors never shows a raw address on the first layer, even for unmatched pages", async ({ page }) => {
  await page.route("**/admin/api/analytics?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    days: 30, from: "2026-10-14", to: "2026-11-13", views: 30, uniques: 9, allTimeViews: 30, firstDay: "2026-10-01",
    series: Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, views: 1, uniques: 1 })),
    topPosts: [{ path: "/", views: 5, uniques: 4, allTime: 5 }, { path: "/secret-draft/", views: 3, uniques: 2, allTime: 3 }, { path: "javascript:alert(1)", views: 1, uniques: 1, allTime: 1 }],
    referrers: [{ host: "facebook.com", views: 2 }], agentRequests: 0, agents: [], agentPages: [],
  }) }));
  await signIn(page, grammi.origin, "#/visitors");
  await expect(page.getByText("9 people visited")).toBeVisible();
  await expect(page.getByText("Your front page")).toBeVisible();
  await expect(page.getByText("Other pages: 4 visits")).toBeVisible();
  const first = await page.locator(".studio-visitors").innerText();
  expect(first).not.toMatch(/secret-draft|javascript:|\/\w/);
});

test("Visitors says the counter isn't answering on a 502, with Try again", async ({ page }) => {
  await page.route("**/admin/api/analytics?**", (route) => route.fulfill({ status: 502, contentType: "application/json", body: "{}" }));
  await signIn(page, grammi.origin, "#/visitors/7");
  await expect(page.getByText("Your visitor numbers aren't answering right now. Try again in a few minutes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

// ---- Dana's trade site ------------------------------------------------------------------------

test("editing a service keeps its extra keys and its questions in order", async ({ page }) => {
  await signIn(page, trade.origin, "#/service/services%2Fgutters.md");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Gutter cleaning");
  await page.getByRole("textbox", { name: "In one sentence" }).fill("We clear the gutters and downspouts.");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect.poll(() => readFileSync(join(trade.root, "content", "services", "gutters.md"), "utf8")).toContain("downspouts.");
  const file = readFileSync(join(trade.root, "content", "services", "gutters.md"), "utf8");
  expect(file).toContain("crew: Dana and Sam");
  expect(file.indexOf("First question?")).toBeLessThan(file.indexOf("Second question?"));
  expect(file).toContain("Body words.");
});

test("'Show the other version' after a business conflict keeps the phone in her format", async ({ page }) => {
  await signIn(page, trade.origin, "#/business");
  await expect(page.getByRole("textbox", { name: "Phone" })).toHaveValue("(304) 555-0142");
  const config = JSON.parse(readFileSync(trade.configPath, "utf8"));
  config.business.phone = "+13045550199";
  writeFileSync(trade.configPath, `${JSON.stringify(config, null, 2)}\n`);
  await page.getByRole("textbox", { name: "Email" }).fill("dana@example.com");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Show the other version" }).click();
  await expect(page.getByText("Here are the facts from the other device.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Phone" })).toHaveValue("(304) 555-0199");
});

test("a copied review's link can't be changed while the site still says it was copied from it", async ({ page }) => {
  await page.route("**/admin/api/assistant/context/url/retrieve", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    sourceUrl: "https://g.page/r/ridgeline/review", canonicalUrl: "https://www.google.com/maps/reviews/ridgeline", retrievedAt: "2026-11-13T10:00:00Z", text: "Great job <img src=x onerror=alert(1)>",
  }) }));
  await signIn(page, trade.origin, "#/review/new");
  await page.getByRole("textbox", { name: "Link to the review" }).first().fill("https://g.page/r/ridgeline/review");
  await page.getByRole("button", { name: "Copy the review" }).click();
  await expect(page.getByText("Copied. Check each line against the page, then Save.")).toBeVisible();
  // Strangers' words stay text.
  await expect(page.locator("main img[src=x]")).toHaveCount(0);
  const link = page.locator(".studio-card-form").getByRole("textbox", { name: "Link to the review" });
  // ADR 0391 / spec: the link is read-only after a copy (with "Paste a different link" to clear the copy).
  await expect(link).not.toBeEditable();
});

test("a failed Business save is said where she pressed Save, not only in a banner off screen", async ({ page }) => {
  await signIn(page, trade.origin, "#/business");
  await page.getByRole("textbox", { name: "License number" }).fill("WV2");
  await page.route("**/admin/api/business", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 413, contentType: "application/json", body: "{}" }) : r.continue()));
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".studio-business .studio-banner alert-banner")).toHaveCount(1);
  // The status line (or the banner, scrolled to) must say it; today the banner sits above the fold.
  const said = await page.locator(".studio-business p[role=status]").innerText();
  const seen = await page.locator(".studio-business .studio-banner alert-banner").evaluate((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  expect(said !== "" || seen).toBe(true);
});

test("Saving business facts that name a trade on a fresh site shows Services and Reviews at once", async ({ page }) => {
  await signIn(page, grammi.origin, "#/business");
  await expect(page.getByRole("heading", { name: "What should customers know about you?" })).toBeVisible();
  await expect(page.getByText("This is for a business site")).toBeVisible();
  await page.getByRole("combobox", { name: "Your trade" }).selectOption({ index: 1 });
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  // A recipe blog is asked before it becomes a business site.
  await page.getByRole("button", { name: "Make it a business site" }).click();
  await expect(page.getByText("Everything's saved.")).toBeVisible();
  // Spec: "Mikey starts a trade site by naming the trade in Business facts ..., and the three appear at once."
  await expect(page.getByRole("link", { name: "Services", exact: true }).first()).toBeVisible({ timeout: 5000 });
});


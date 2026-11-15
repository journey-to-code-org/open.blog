import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 9: Cards. A stand-in greetings function (the real one is netlify/functions/greetings.mjs)
// behind the real Admin proxy. Cards shows in the navigation only when it's set up; a birthday card
// is written for someone with a birthday (every year, on their day), previewed and scheduled; a card
// that didn't go out is listed first; stopping asks and Undo brings it back; people are added; Home
// says what goes out this week; unsaved words wait on the device; and it passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const key = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let fake;
const sent = [];
const RICKY = "11111111-1111-4111-8111-111111111111";
const JIMMY = "22222222-2222-4222-8222-222222222222";
let contacts;
let cards;

const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().replace(/\.\d+Z$/, "Z");

test.beforeAll(async () => {
  contacts = [
    { id: RICKY, name: "Ricky", email: "ricky@example.com", birthday: "1990-09-07" },
    { id: JIMMY, name: "Jimmy", email: "jimmy@example.com", birthday: null },
  ];
  cards = [
    { id: "33333333-3333-4333-8333-333333333333", contactId: JIMMY, design: "christmas", subject: "Merry Christmas", message: "Love you", signOff: "Love, Grammi", sendOn: "2026-12-25", hour: 8, timeZone: "America/New_York", yearly: false, status: "failed", nextSendAt: null, lastSentAt: null, attempts: 3, error: "rejected" },
    { id: "44444444-4444-4444-8444-444444444444", contactId: RICKY, design: "just-because", subject: "Hi", message: "Thinking of you", signOff: "Love, Grammi", sendOn: soon(2).slice(0, 10), hour: 8, timeZone: "America/New_York", yearly: false, status: "scheduled", nextSendAt: soon(2), lastSentAt: null, attempts: 0, error: null },
  ];
  fake = createHttpServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${key}`) return reply(401, { error: "unauthorized" });
    const path = req.url.replace(/^\/api\/greetings\/?/, "");
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (path === "status") return reply(200, { timeZone: "America/New_York", from: { name: "Grammi", email: "grammi@example.com" }, designs: [{ id: "birthday", label: "Birthday", subject: "Happy birthday, {name}!" }, { id: "just-because", label: "Just because", subject: "Thinking of you" }, { id: "christmas", label: "Christmas", subject: "Merry Christmas" }] });
      if (path === "contacts" && req.method === "GET") return reply(200, { contacts });
      if (path === "contacts") {
        if (!body.name) return reply(400, { error: "name-required", field: "name" });
        const contact = { id: randomUUID(), name: body.name, email: body.email, birthday: body.birthday || null };
        contacts.push(contact);
        return reply(200, { contact });
      }
      if (path === "cards" && req.method === "GET") return reply(200, { cards });
      if (path === "preview") return reply(200, { subject: "Happy birthday, Ricky!", html: "<p>Happy birthday, Ricky!</p>", sendsAt: soon(30) });
      if (path === "test") { sent.push(body); return reply(200, { to: "grammi@example.com" }); }
      const make = (id) => ({ id, ...body, status: "scheduled", nextSendAt: soon(30), lastSentAt: null, attempts: 0, error: null });
      if (path === "cards") { const card = make(randomUUID()); cards.push(card); sent.push(body); return reply(200, { card }); }
      const [, id, action] = path.split("/");
      const found = cards.find((c) => c.id === id);
      if (!found) return reply(404, { error: "not-found" });
      if (action === "cancel") { found.status = "cancelled"; return reply(200, { card: found }); }
      Object.assign(found, make(id));
      return reply(200, { card: found });
    });
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  root = mkdtempSync(join(tmpdir(), "openblog-studio-cards-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], {
    cwd: repository, stdio: "pipe",
    env: { ...process.env, OPENBLOG_GREETINGS_ENDPOINT: `http://127.0.0.1:${fake.address().port}/api/greetings`, OPENBLOG_GREETINGS_ADMIN_KEY: key },
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
  fake?.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(root);
});

async function signIn(page, hash = "#/cards") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

test("Cards lists what didn't go out first, and Home says what goes out this week", async ({ page }) => {
  await signIn(page, "#/");
  await expect(page.getByRole("link", { name: /Jimmy's Christmas card didn't go out/ })).toBeVisible();
  await page.getByRole("link", { name: "Cards" }).first().click();
  await expect(page.getByRole("heading", { name: "Who gets a card?" })).toBeVisible();
  await expect(page.locator(".studio-card-sections h3")).toHaveText(["Didn't go out", "Coming up"]);
  await expect(page.getByText(/Didn't go out: the email service turned it down; the address may be wrong/)).toBeVisible();
  await expect(page.getByText("Birthday September 7")).toBeVisible();
});

test("a birthday card for Ricky starts on his birthday every year, previews, tests and schedules", async ({ page }) => {
  await signIn(page);
  await page.locator(".studio-card-people").getByRole("link", { name: "Write to Ricky" }).click();
  await expect(page.getByRole("heading", { name: "Write a card", level: 2 })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Send it every year" })).toBeChecked();
  await expect(page.getByText(/^Next one: /)).toBeVisible();
  await page.getByRole("textbox", { name: "Your message" }).fill("Happy birthday ");
  await page.getByRole("button", { name: "Add their name" }).click();
  await expect(page.getByRole("textbox", { name: "Your message" })).toHaveValue("Happy birthday {name}");
  await page.getByRole("button", { name: "See the card" }).click();
  await expect(page.frameLocator("iframe.studio-card-frame").getByText("Happy birthday, Ricky!")).toBeVisible();
  await page.getByRole("button", { name: "Send me a test" }).click();
  await expect(page.locator(".studio-card-edit p[role=status]")).toHaveText("Sent a test to grammi@example.com. Check your email. Your card isn't scheduled yet.");
  await page.getByRole("button", { name: "Schedule this card" }).click();
  await expect(page.getByRole("heading", { name: "Who gets a card?" })).toBeVisible();
  const scheduled = sent.at(-1);
  expect(scheduled).toMatchObject({ contactId: RICKY, design: "birthday", sendOn: "1990-09-07", yearly: true, message: "Happy birthday {name}", signOff: "Love, Grammi", hour: 8, timeZone: "America/New_York" });
});

test("unsaved words wait on the device, and leaving asks first", async ({ page }) => {
  await signIn(page, "#/cards/new");
  await page.getByRole("textbox", { name: "Your message" }).fill("Saving this for later");
  await page.getByRole("link", { name: "Back to your cards" }).click();
  await expect(page.getByRole("heading", { name: "Leave without scheduling this card?" })).toBeVisible();
  await page.getByRole("button", { name: "Leave for now" }).click();
  await expect(page.getByRole("heading", { name: "Who gets a card?" })).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/cards/new`);
  await page.getByRole("button", { name: "Pick up" }).click();
  await expect(page.getByRole("textbox", { name: "Your message" })).toHaveValue("Saving this for later");
});

test("stopping a card asks, and Undo brings it back; adding someone says what's missing", async ({ page }) => {
  await signIn(page);
  const card = page.locator(".studio-comment", { hasText: "Just because" });
  await card.getByRole("button", { name: "Don't send it" }).click();
  await page.getByRole("button", { name: "Don't send it" }).last().click();
  await expect(page.getByText("Stopped. That card won't be sent.").first()).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-comment", { hasText: "Just because" })).toBeVisible();
  await page.locator(".studio-card-people").getByRole("button", { name: "Add someone" }).click();
  await page.getByRole("button", { name: "Add to your people" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Add the person's name" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Pappy");
  await page.getByRole("textbox", { name: "Email address" }).fill("pappy@example.com");
  await page.getByRole("button", { name: "Add to your people" }).click();
  await expect(page.locator(".studio-cards p[role=status]")).toHaveText("Added Pappy.");
});

test("Cards and the editor pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const hash of ["#/cards", "#/cards/new"]) {
    await signIn(page, hash);
    await expect(page.locator(".studio-page h2").first()).toBeVisible();
    await page.waitForTimeout(300);
    const pick = page.getByRole("button", { name: "Start fresh" });
    if (await pick.isVisible().catch(() => false)) await pick.click();
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    expect(results, hash).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), hash).toBe(false);
  }
});

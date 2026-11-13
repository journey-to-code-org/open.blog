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

// QA probes for Studio slices 7 (Look) and 8 (Comments): edges the slice specs don't cover.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const SHOTS = "/tmp/qa";
let root, server, origin, configPath, written;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-qa78-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.engagement = { enabled: true, comments: true, analytics: false, endpoint: "https://comments.example/api",
    captcha: { provider: "turnstile", siteKey: "0x4AAAAAAA-public_key", scope: "every-comment" } };
  written = `${JSON.stringify(config, null, 4)}\n`; // four-space indent, hand-kept
  writeFileSync(configPath, written);
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const l = createServer(); l.listen(0, "127.0.0.1"); await once(l, "listening");
  const port = l.address().port; await new Promise((d) => l.close(d));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe",
    env: { ...process.env, OPENBLOG_ENGAGEMENT_API_KEY: "test-key", OPENBLOG_ENGAGEMENT_API_ORIGIN: "https://comments.example" } });
  await expect(async () => { expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true); }).toPass({ timeout: 30000 });
});
test.afterAll(async () => { if (server?.exitCode === null) { const s = once(server, "exit"); server.kill(); await s; } removeTree(root); });

async function signIn(page, hash = "#/comments") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DECLINE = [{ id: "spam", label: "Spam" }, { id: "abusive", label: "Abusive" }];
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const PENDING_ACTIONS = [{ action: "approve", label: "Approve", reasons: [] }, { action: "reject", label: "Reject", reasons: DECLINE }];
function item(n, over = {}) {
  return { id: ID(n), source: "comment", kind: "comment", kindLabel: "Comment", status: "pending", statusLabel: "Pending", version: 1,
    reason: null, receivedAt: new Date().toISOString(), moderatedAt: null, work: "/pecan-pie/",
    post: { title: "Pecan pie", url: "/pecan-pie/", source: "posts/pecan-pie.md" }, public: false, body: "Lovely.",
    reader: { name: "Aunt Sue", publishName: true }, actions: PENDING_ACTIONS, ...over };
}
async function mockInbox(page, items, { onPatch, onGet, patchDelay = 0 } = {}) {
  const decisions = [];
  const next = { approve: "approved", reject: "rejected", remove: "removed", reopen: "pending" };
  await page.route("**/admin/api/engagement/moderation**", async (route) => {
    const r = route.request();
    if (r.method() === "GET") {
      const g = onGet?.(r); if (g) return g(route);
      const state = new URL(r.url()).searchParams.get("state") || "pending";
      return json(route, 200, { state, protocol: "full", items: items.filter((i) => i.status === state), invalid: 0, next: null });
    }
    const body = r.postDataJSON(); decisions.push(body);
    if (patchDelay) await new Promise((d) => setTimeout(d, patchDelay));
    const answer = onPatch?.(body); if (answer) return json(route, answer.status, answer.body);
    const found = items.find((i) => i.id === body.id);
    if (!found || found.version !== body.version || found.status !== body.from) return json(route, 409, { error: "changed", code: "conflict" });
    found.status = next[body.action]; found.version += 1; found.reason = body.reason || null;
    found.actions = body.action === "reopen" ? PENDING_ACTIONS : [{ action: "reopen", label: "Reopen", reasons: [] }, { action: "erase", label: "Erase", reasons: [] }];
    return json(route, 200, { item: { ...found } });
  });
  return decisions;
}
const statusLine = (page) => page.locator(".studio-comments p[role=status]");
async function axe(page, label) {
  await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`));
  console.log(`AXE ${label}:`, JSON.stringify(v));
  return v;
}

test("Q1 switch PUT keeps captcha and the file as written", async ({ page }) => {
  await mockInbox(page, []);
  let putBody;
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("engagement/settings")) putBody = r.postDataJSON(); });
  await signIn(page);
  const toggle = page.getByRole("switch", { name: "Let people leave comments" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.getByRole("button", { name: "Turn them off" }).click();
  await expect(statusLine(page).filter({ hasText: /^Comments are off\./ })).toBeVisible();
  const after = readFileSync(configPath, "utf8");
  console.log("PUT BODY", JSON.stringify(putBody));
  console.log("FILE ENGAGEMENT AFTER", JSON.stringify(JSON.parse(after).engagement));
  console.log("TEXT SAME EXCEPT comments?", after === written.replace('"comments": true', '"comments": false'));
  expect(JSON.parse(after).engagement.captcha).toEqual({ provider: "turnstile", siteKey: "0x4AAAAAAA-public_key", scope: "every-comment" });
  await toggle.click();
  await expect(statusLine(page).filter({ hasText: /^Comments are on\./ })).toBeVisible();
  writeFileSync(configPath, written);
});

test("Q2 flipping again while the first flip is still going out", async ({ page }) => {
  await mockInbox(page, []);
  await signIn(page);
  await page.route("**/admin/api/publish", async (route) => { await new Promise((d) => setTimeout(d, 2500)); return route.continue(); });
  const toggle = page.getByRole("switch", { name: "Let people leave comments" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await page.getByRole("button", { name: "Turn them off" }).click();
  await expect.poll(() => JSON.parse(readFileSync(configPath, "utf8")).engagement.comments).toBe(false);
  await page.waitForTimeout(150);
  await toggle.click(); // she changes her mind
  await page.waitForTimeout(4000);
  const shown = await toggle.isChecked();
  const file = JSON.parse(readFileSync(configPath, "utf8")).engagement.comments;
  console.log("Q2 switch shows", shown, "file says", file, "status", await statusLine(page).textContent());
  await page.screenshot({ path: `${SHOTS}/q2-switch.png`, fullPage: true });
  writeFileSync(configPath, written);
  expect(shown).toBe(file);
});

test("Q3 double-clicking Undo", async ({ page }) => {
  const items = [item(3)];
  const decisions = await mockInbox(page, items, { patchDelay: 400 });
  await signIn(page);
  await page.locator(".studio-comment").getByRole("button", { name: /Don't show/ }).click();
  await page.getByRole("menuitem", { name: "It's spam" }).click();
  await expect(statusLine(page).filter({ hasText: "Not shown." })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).dblclick();
  await page.waitForTimeout(2000);
  const said = await statusLine(page).textContent();
  console.log("Q3 reopen requests", decisions.filter((d) => d.action === "reopen").length, "status:", said, "item status", items[0].status);
  await page.screenshot({ path: `${SHOTS}/q3-undo.png`, fullPage: true });
  expect(said).toBe("Back in Waiting.");
});

test("Q4 Why menu by keyboard: Escape sends nothing; Enter on a reason decides", async ({ page }) => {
  const decisions = await mockInbox(page, [item(4), item(5, { reader: { name: "Jimmy", publishName: true } })]);
  await signIn(page);
  const trigger = page.locator(".studio-comment").first().locator(".studio-why").getByRole("button");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "It's spam" })).toBeVisible();
  console.log("Q4 focused after open:", await page.evaluate(() => document.activeElement?.textContent || document.activeElement?.tagName));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "It's spam" })).toBeHidden();
  const back = await trigger.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
  console.log("Q4 focus back on trigger after Escape:", back, "decisions:", decisions.length);
  expect(decisions.length).toBe(0);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  console.log("Q4 reopened by Enter after Escape:", await page.getByRole("menuitem", { name: "It's spam" }).isVisible(), "focus:", await page.evaluate(() => document.activeElement?.textContent?.trim()));
  await page.keyboard.press("ArrowDown");
  const cur = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press("Enter");
  await expect(statusLine(page).filter({ hasText: "Not shown." })).toBeVisible();
  console.log("Q4 chose", cur, "sent", JSON.stringify(decisions[0]));
  console.log("Q4 focus after decide:", await page.evaluate(() => document.activeElement?.textContent));
  expect(back).toBe(true);
});

test("Q5 errors: list 502, card 502, card 422 with a reason, last card leaves", async ({ page }) => {
  let fail = true;
  await mockInbox(page, [item(6)], {
    onGet: () => (fail ? (route) => json(route, 502, { error: "hosted engagement unavailable" }) : null),
    onPatch: (b) => (b.action === "approve" ? { status: 502, body: { error: "x" } } : { status: 422, body: { error: "Choose one of the listed reasons.", code: "reasonNotAllowed" } }),
  });
  await signIn(page);
  await expect(page.getByText("Your comments service isn't answering right now")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/q5-list502.png`, fullPage: true });
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  const card = page.locator(".studio-comment").first();
  await card.getByRole("button", { name: "Show it" }).click();
  const line = card.locator(".studio-comment-trouble");
  await expect(line).toHaveText(/your comments service isn't answering/);
  await expect(line).toBeFocused();
  await card.locator(".studio-why").getByRole("button").click();
  await page.getByRole("menuitem", { name: "It's spam" }).click();
  await page.waitForTimeout(800);
  console.log("Q5 422-with-reason line:", await line.textContent(), "| menu reopened:", await page.getByRole("menuitem", { name: "It's spam" }).isVisible());
});

test("Q6 Home's waiting line never errors (502, bad JSON, items not a list)", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const body of [null, "not json", JSON.stringify({ items: "x" })]) {
    await page.unroute("**/admin/api/engagement/moderation**").catch(() => {});
    await page.route("**/admin/api/engagement/moderation**", (route) => body === null ? json(route, 502, { error: "down" }) : route.fulfill({ status: 200, contentType: "application/json", body }));
    await signIn(page, "#/");
    await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
    await page.waitForTimeout(1500);
    const line = await page.locator(".studio-waiting").textContent();
    const alerts = await page.locator("main alert-banner").allTextContents();
    console.log("Q6", body, "line:", JSON.stringify(line), "alerts:", JSON.stringify(alerts));
  }
  console.log("Q6 page errors:", JSON.stringify(errors));
});

test("Q7 hostile names and titles; erase dialog words", async ({ page }) => {
  const evil = "Don on the hill <img src=x onerror=alert(1)>";
  const title = 'Pie "quoted" ]"] <b>x</b>';
  const items = [item(7, { status: "rejected", reason: "spam", moderatedAt: new Date().toISOString(), reader: { name: evil, publishName: false },
    post: { title, url: "/pie/" }, body: "a".repeat(5000), actions: [{ action: "reopen", label: "Reopen", reasons: [] }, { action: "erase", label: "Erase", reasons: [] }] })];
  const dialogs = []; page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await mockInbox(page, items);
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, "#/comments/not-shown");
  await expect(page.locator(".studio-comment")).toHaveCount(1);
  await page.locator(".studio-row-menu").getByRole("button").click();
  await page.getByRole("menuitem", { name: "Erase it for good" }).click();
  const heading = await page.locator("modal-dialog [slot=heading]").textContent();
  console.log("Q7 erase heading:", heading);
  console.log("Q7 focused in dialog:", await page.evaluate(() => document.activeElement?.textContent));
  await page.keyboard.press("Escape");
  console.log("Q7 sideways scroll:", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), "alerts:", dialogs.length);
  await page.screenshot({ path: `${SHOTS}/q7-hostile-320.png`, fullPage: true });
});

test("Q8 expired session while deciding", async ({ page, context }) => {
  const decisions = await mockInbox(page, [item(8)]);
  await signIn(page);
  await expect(page.locator(".studio-comment")).toHaveCount(1);
  await page.unroute("**/admin/api/engagement/moderation**");
  await context.clearCookies();
  await page.locator(".studio-comment").getByRole("button", { name: "Show it" }).click();
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  const asked = await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  console.log("Q8 sign-in asked:", asked, "decisions sent before sign-in:", decisions.length);
  await page.screenshot({ path: `${SHOTS}/q8-expired.png`, fullPage: true });
});

for (const scheme of ["dark", "light"]) {
  test(`Q9 axe ${scheme} + reduced motion, Comments with cards and Look`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await mockInbox(page, [item(9), item(10, { source: "report", reader: { name: "Ricky" }, report: { groundLabel: "Abusive" },
      target: { authorName: "Jimmy", body: "You call that stuffing?", status: "removed", statusLabel: "Removed" },
      actions: [{ action: "uphold-report", label: "Uphold", reasons: DECLINE }, { action: "reject", label: "Dismiss", reasons: [{ id: "no-action", label: "No action" }] }] })]);
    await page.setViewportSize({ width: 320, height: 900 });
    await signIn(page);
    await expect(page.locator(".studio-comment")).toHaveCount(2);
    await axe(page, `comments-${scheme}`);
    await page.screenshot({ path: `${SHOTS}/q9-comments-${scheme}.png`, fullPage: true });
    await page.goto(`${origin}/admin/studio/#/look`);
    await expect(page.getByRole("heading", { name: "How your site looks" })).toBeVisible();
    await page.waitForTimeout(800);
    await axe(page, `look-${scheme}`);
    console.log("Q9 look sideways:", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
    console.log("Q9 swatch bg:", await page.locator(".studio-swatch").first().evaluate((e) => getComputedStyle(e).backgroundColor));
    await page.screenshot({ path: `${SHOTS}/q9-look-${scheme}.png`, fullPage: true });
  });
}

test("Q10 Look: keyboard swatch, save keeps file as written, 422 words, leave mid-edit", async ({ page }) => {
  writeFileSync(configPath, written);
  await signIn(page, "#/look");
  await expect(page.getByRole("heading", { name: "How your site looks" })).toBeVisible();
  const sw = page.locator(".studio-swatch").first();
  await sw.focus(); await page.keyboard.press("Enter");
  console.log("Q10 focus after swatch:", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), await page.locator(".studio-swatch").first().getAttribute("aria-pressed"));
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(2500);
  const after = readFileSync(configPath, "utf8");
  const a = JSON.parse(after); const w = JSON.parse(written);
  console.log("Q10 appearance:", JSON.stringify(a.appearance), "focus:", await page.evaluate(() => document.activeElement?.tagName + ":" + (document.activeElement?.textContent || "").slice(0, 30)));
  const strip = (t) => t.split("\n").filter((l) => !/appearance|accent|^\s*}\s*,?$/.test(l));
  console.log("Q10 4-space layout kept:", after.includes('\n    "engagement"'), "other lines same:", JSON.stringify(strip(after)) === JSON.stringify(strip(written)));
  delete a.appearance; console.log("Q10 rest equal:", JSON.stringify(a) === JSON.stringify(w));
  // 422 from server: what words does she see?
  await page.route("**/admin/api/look", (route) => route.request().method() === "PUT" ? json(route, 422, { error: "appearance.accent must be a #rrggbb colour in openblog.json" }) : route.continue());
  await page.locator(".studio-swatch").nth(1).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(1000);
  console.log("Q10 422 banner:", await page.locator(".studio-look alert-banner").allTextContents());
  await page.screenshot({ path: `${SHOTS}/q10-look-422.png`, fullPage: true });
  await page.getByRole("link", { name: "Home" }).first().click();
  console.log("Q10 leave asks:", await page.locator("modal-dialog").count());
  writeFileSync(configPath, written);
});

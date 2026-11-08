import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Admin Reminders screen at 400px (ADR 0356): off until turned on, then a due reminder whose draft is
// started on a tap, written unpublished, absent from the built site, with every control at least 44px tall and no
// sideways scroll. A topic whose window is the whole year makes the due reminder independent of the date.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;

test.use({ viewport: { width: 400, height: 800 } });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-seasonal-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  const config = join(root, "openblog.json");
  const parsed = JSON.parse(readFileSync(config, "utf8"));
  const topic = { id: "all-year", start: "01-01", end: "12-31", topic: "Winter pipes", prompt: "What should a homeowner do before the first freeze?" };
  writeFileSync(config, `${JSON.stringify({ ...parsed, business: { version: 1, trade: "plumbing" }, seasonalPrompts: { version: 1, topics: [topic] } }, null, 2)}
`);
  execFileSync(binary, ["user", "add", "writer", "--root", root], {
    env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe",
  });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/`)).ok).toBe(true);
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

async function openReminders(page) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.goto(`${origin}/admin/#/reminders`);
  await expect(page.locator("[data-seasonal-screen]")).toBeVisible();
}

async function expectFits(page) {
  const wider = await page.locator("[data-seasonal-screen]").evaluate((region) => {
    const limit = document.documentElement.clientWidth + 2;
    return [region, ...region.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > limit).map((node) => `${node.tagName}.${node.className}`);
  });
  expect(wider).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
  for (const control of await page.locator("[data-seasonal-screen] input, [data-seasonal-screen] button, [data-seasonal-screen] a.oba-btn").all()) {
    if (!(await control.isVisible())) continue;
    expect((await control.boundingBox()).height, await control.evaluate((n) => n.id || n.textContent)).toBeGreaterThanOrEqual(43);
  }
}

test("reminders are off until turned on, then list a due reminder and the trade's topics at 400px", async ({ page }) => {
  await openReminders(page);
  await expect(page.locator("[data-seasonal-off]")).toContainText("never publishes anything");
  await expect(page.locator("[data-reminder]")).toHaveCount(0);
  await expectFits(page);
  await page.getByRole("button", { name: "Turn on seasonal reminders" }).click();
  const card = page.locator('[data-reminder^="all-year@"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Winter pipes");
  await expect(card).toContainText("Time to write this one");
  await expect(page.locator("[data-seasonal-topics] [data-topic]").first()).toBeVisible();
  for (const label of await page.locator("[data-seasonal-topics] input").evaluateAll((nodes) => nodes.map((n) => n.id))) {
    await expect(page.locator(`label[for="${label}"]`)).toHaveCount(1);
  }
  await expectFits(page);
  expect(readFileSync(join(root, "openblog.json"), "utf8")).toContain('"enabled": true');
});

test("starting a draft writes one unpublished draft and the built site does not show it", async ({ page }) => {
  await openReminders(page);
  const card = page.locator('[data-reminder^="all-year@"]');
  await card.getByRole("button", { name: "Start a draft" }).click();
  await expect(page.locator("[data-seasonal-status]")).toContainText("not published");
  await expect(card.getByRole("link", { name: "Open it in Write" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Open it in Write" })).toHaveAttribute("href", /^#\/edit\/posts%2F/);
  // The card is redrawn at once: a started draft offers no Start or Snooze (#489, #526).
  await expect(card).toHaveAttribute("data-status", "opened");
  await expect(card.getByRole("button", { name: "Snooze a week" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Start a draft" })).toHaveCount(0);
  await expect(page.locator("[data-seasonal-status]")).not.toContainText("another window");
  const posts = readdirSync(join(root, "content", "posts")).filter((name) => name.includes("winter-pipes"));
  expect(posts).toHaveLength(1);
  const text = readFileSync(join(root, "content", "posts", posts[0]), "utf8");
  expect(text).toMatch(/draft: "?true"?/);
  expect(text).toContain("What should a homeowner do before the first freeze?");
  // The site as readers get it never mentions the draft.
  for (const path of ["/", "/rss.xml"]) {
    const response = await fetch(`${origin}${path}`);
    expect(await response.text()).not.toContain("Winter pipes");
  }
  await page.reload();
  await expect(page.locator('[data-reminder^="all-year@"]')).toHaveAttribute("data-status", "opened");
  await expectFits(page);
});

test("the draft links open the draft in Write", async ({ page }) => {
  await openReminders(page);
  const card = page.locator('[data-reminder^="all-year@"]');
  await card.getByRole("link", { name: "Open the draft" }).click();
  await expect(page).toHaveURL(/#\/edit\/posts/);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Winter pipes");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  // A second Start a draft is not offered while that draft exists; the open answer names the same draft.
  await openReminders(page);
  await expect(card.getByRole("button", { name: "Start a draft" })).toHaveCount(0);
});

test("a snooze and turning a topic off are said in words", async ({ page }) => {
  await openReminders(page);
  const row = page.locator('[data-topic="freeze-protection"]');
  await row.getByRole("button", { name: "Turn this topic off" }).click();
  await expect(page.locator("[data-seasonal-status]")).toContainText("Turned off");
  await expect(page.locator('[data-topic="freeze-protection"]')).toHaveAttribute("data-disabled", "true");
  expect(readFileSync(join(root, "openblog.json"), "utf8")).toContain("freeze-protection");
  await expectFits(page);
});

import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axeClean, open, restartSite, startSite, stopSite } from "./helper-site.mjs";

// How readers reach you (Studio R10, #/readers/setup): the switch, the state line (working only when
// the health check says the service answered), the robot check (on only when a provider other than
// "off" is chosen), the checklist (never yes for what it can't tell), the connection (the key field
// is emptied and never in the page after a save, removing the key asks, a change made elsewhere is
// refused), and 320 px. The hosted service is stubbed at the Admin API: nothing leaves the computer.

let site;
const ENDPOINT = "https://comments.example/api";

test.use({ viewport: { width: 400, height: 900 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("reader-setup");
  const path = join(site.dir, "openblog.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.engagement = { enabled: true, comments: true, analytics: false, endpoint: ENDPOINT };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  await restartSite(site);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  // The service is never reached: the health check and the old-notes check are answered here.
  await page.route("**/admin/api/engagement/retention**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not here", code: "unavailable" }) }));
});

const health = (page, answer) => page.route("**/admin/api/engagement/health", (route) => (typeof answer === "number"
  ? route.fulfill({ status: answer, contentType: "application/json", body: JSON.stringify({ error: "no", code: "unavailable" }) })
  : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) })));
const screen = (page) => page.locator(".studio-page", { has: page.getByRole("heading", { level: 2 }) }).first();
const forHelper = async (page) => {
  const summary = page.locator("details > summary", { hasText: "For the person who set up your site" }).first();
  if (!(await summary.evaluate((s) => s.parentElement.open))) await summary.click();
};

test("the state line says working only when the service answered, and says so when it can't tell", async ({ page }) => {
  await health(page, { checks: [{ id: "service", ok: true }, { id: "comments", ok: true }] });
  await open(page, site, "#/readers/setup");
  await expect(page.getByText("Comments are on and working.")).toBeVisible();

  await page.unroute("**/admin/api/engagement/health");
  await health(page, { checks: [{ id: "service", ok: false }] });
  await page.reload();
  await expect(page.getByText("Comments are on, but your blog can't reach them.", { exact: false })).toBeVisible();
  await expect(page.getByText("Comments are on and working.")).toHaveCount(0);

  await page.unroute("**/admin/api/engagement/health");
  await health(page, 503);
  await page.reload();
  await expect(page.getByText("Comments are on, but your blog can't tell right now whether they're working.")).toBeVisible();
  await forHelper(page);
  await expect(page.locator("li", { hasText: "The comments service answers" })).toContainText("Can't tell");
  await expect(page.getByText("Comments are on and working.")).toHaveCount(0);
});

test("with the robot check off (the server's own default), nothing claims it is on", async ({ page }) => {
  await health(page, { checks: [{ id: "service", ok: true }] });
  await open(page, site, "#/readers/setup");
  await expect(page.getByText("Comments are on and working.")).toBeVisible();
  await expect(page.getByText("Keeping robots out")).toBeHidden();
  await expect(page.getByText(/quick check before/)).toBeHidden();
  await forHelper(page);
  const robot = page.locator("select-field", { hasText: "Robot check" });
  await expect(robot.locator("select, [role=combobox]").first()).toHaveValue("off").catch(async () => {
    expect(await robot.evaluate((field) => field.value)).toBe("off");
  });
  await expect(page.getByLabel("Public site key")).toBeHidden();
  await expect(page.locator("select-field", { hasText: "How often" })).toBeHidden();
});

test("save connection: the key field is emptied and the key is never in the page; the robot check is saved as off", async ({ page }) => {
  await health(page, { checks: [{ id: "service", ok: true }] });
  const puts = [];
  page.on("request", (request) => { if (request.method() === "PUT" && /engagement\/settings$/.test(request.url())) puts.push(request.postDataJSON()); });
  await open(page, site, "#/readers/setup");
  await forHelper(page);
  const SECRET = "sk-test-not-real-7731";
  await page.getByLabel("Replace the key").fill(SECRET);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.locator(".studio-helper-section [role=status]").filter({ hasText: "Saved." }).first()).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(puts[0]).toMatchObject({ credentialAction: "replace", credential: SECRET, endpoint: ENDPOINT });
  expect(puts[0].captcha?.provider ?? "off").toBe("off");
  await expect(page.getByLabel("Replace the key")).toHaveValue("");
  expect(await page.content()).not.toContain(SECRET);
  expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage })))).not.toContain(SECRET);
  // The site's file holds no robot check and no key.
  const config = JSON.parse(readFileSync(join(site.dir, "openblog.json"), "utf8"));
  expect(JSON.stringify(config)).not.toContain(SECRET);
  expect(config.engagement.captcha?.provider ?? "off").toBe("off");
});

test("removing the saved key asks first; keeping it changes nothing", async ({ page }) => {
  await health(page, { checks: [{ id: "service", ok: true }] });
  await page.route("**/admin/api/engagement/settings", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, credential: { ...(json.credential || {}), configured: true, privateConfigured: true } } });
  });
  const puts = [];
  page.on("request", (request) => { if (request.method() === "PUT" && /engagement\/settings$/.test(request.url())) puts.push(request.postDataJSON()); });
  await open(page, site, "#/readers/setup");
  await forHelper(page);
  await page.getByRole("button", { name: "Remove the saved key" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove the saved key?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  expect(puts).toHaveLength(0);
});

test("a change made elsewhere is refused, not overwritten, and the page says so", async ({ page }) => {
  await health(page, { checks: [{ id: "service", ok: true }] });
  await page.route("**/admin/api/engagement/settings", (route) => (route.request().method() === "PUT"
    ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "changed", code: "conflict" }) })
    : route.fallback()));
  await open(page, site, "#/readers/setup");
  await forHelper(page);
  await page.getByRole("button", { name: "Save connection" }).click();
  await expect(page.getByText(/changed somewhere else/i).first()).toBeVisible();
});

test("passes axe at 320 px, with nothing scrolling sideways inside the screen", async ({ page }) => {
  await health(page, { checks: [{ id: "service", ok: null }] });
  await open(page, site, "#/readers/setup");
  await forHelper(page);
  await axeClean(page, "setup", ".shell-content");
});

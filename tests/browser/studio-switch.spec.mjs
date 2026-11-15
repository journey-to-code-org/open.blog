import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// R15, the switch: the old Admin is gone and its address opens Studio. One address from each row of
// docs/specs/studio/r15/spec.md "Every old address still works", against a real `openblog serve
// --admin`: /admin/ (with a query, which goes), a bookmark with its #…, a notice queued before R10,
// an invitation link from before G119 (no token left behind), and an installed app from before R3
// with no signal, which the worker sends to Studio's kept copy. Then the one-time offer of unsaved
// Front page changes the old Admin kept in the browser, with axe on its banner.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "allow" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-switch-"));
  execFileSync(binary, ["init", dir, "--starter", "trade", "--trade", "roofing", "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "content", "services"), { recursive: true });
  writeFileSync(join(dir, "content", "services", "roof-repair.md"), "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks found and fixed.\n---\nWe fix leaks.\n");
  writeFileSync(join(dir, "content", "posts", "2026-11-01-old-bookmark.md"), "---\ntitle: An old bookmark\ndate: 2026-11-01\n---\nWords.\n");
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }
  removeTree(dir);
});

async function signIn(page) {
  await page.goto(`${origin}/admin/studio/#/`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
}

const home = (page) => page.getByRole("heading", { name: "What would you like to do?" });

test("the old address opens Studio Home, with or without a query, and says it is a 302 that is never kept", async ({ page }) => {
  await signIn(page);
  for (const path of ["/admin", "/admin/", "/admin/?from=bookmark"]) {
    await page.goto(`${origin}${path}`);
    await expect(page).toHaveURL(/\/admin\/studio\/(#\/)?$/);
    await expect(home(page)).toBeVisible();
  }
  const answer = await fetch(`${origin}/admin/?x=1`, { redirect: "manual" });
  expect(answer.status).toBe(302);
  expect(answer.headers.get("location")).toBe("/admin/studio/");
  expect(answer.headers.get("cache-control")).toBe("no-store");
  expect(answer.headers.get("content-security-policy")).toContain("default-src 'self'");
  expect((await fetch(`${origin}/admin/admin.js`, { redirect: "manual" })).status).toBe(302);
});

test("a bookmark, a notice queued before R10, a checklist answer and an old invitation each land on their screen", async ({ page }) => {
  await signIn(page);
  // A Safari bookmark of a post in the old editor: Write on that post, and Studio's address in the bar.
  await page.goto(`${origin}/admin/#/edit/posts%2F2026-11-01-old-bookmark.md`);
  await expect(page).toHaveURL(`${origin}/admin/studio/#/write/posts%2F2026-11-01-old-bookmark.md`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("An old bookmark");
  // A notice sent before R10 (engagement.mjs), tapped outside the worker: Readers.
  await page.goto(`${origin}/admin/#/moderation`);
  await expect(page).toHaveURL(`${origin}/admin/studio/#/readers`);
  // An R1 checklist answer kept with the old Capture address: New job.
  await page.goto(`${origin}/admin/#/capture`);
  await expect(page).toHaveURL(`${origin}/admin/studio/#/new-job`);
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
  // More tools and the not-yet page are gone: their addresses open what replaced them.
  await page.goto(`${origin}/admin/studio/#/tools`);
  await expect(page).toHaveURL(/\/admin\/studio\/(#\/)?$/);
  await page.goto(`${origin}/admin/studio/#/not-yet/distribution`);
  await expect(page).toHaveURL(`${origin}/admin/studio/#/sharing?view=posts`);
  // An invitation link from before G119: Join, and the token is in neither the address nor history.
  await page.goto(`${origin}/admin/#/shared/accept/tok-from-an-old-message`);
  await expect(page).toHaveURL(/\/admin\/studio\/#\/together\/join/);
  expect(page.url()).not.toContain("tok-from-an-old-message");
  expect(await page.evaluate(() => location.href)).not.toContain("tok-from-an-old-message");
});

test("an app installed before R3 opens Studio from the kept copy with no signal", async ({ page, context }) => {
  await signIn(page);
  // The worker is in charge and has kept this release's files.
  await expect.poll(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/admin/");
    const names = await caches.keys();
    const kept = names.length ? await (await caches.open(names[0])).keys() : [];
    return Boolean(navigator.serviceWorker.controller) && reg?.scope.endsWith("/admin/") && kept.length > 20;
  }), { timeout: 20000 }).toBe(true);
  await context.setOffline(true);
  try {
    // Its start_url is still /admin/ (iOS never reads the manifest again).
    await page.goto(`${origin}/admin/`);
    await expect(page).toHaveURL(/\/admin\/studio\/(#\/)?$/);
    await expect(home(page)).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("unsaved Front page changes the old Admin kept are offered once, brought back as unsaved work, and their key goes", async ({ page }) => {
  await signIn(page);
  const key = "ob-landing-draft:writer";
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    v: 1, base: null, savedAt: "2026-11-10T15:30:00.000Z",
    page: { sections: [{ id: "kept-text", type: "rich-text", markdown: "Words she never saved in the old Admin." }] },
  })), key);
  await page.goto(`${origin}/admin/#/landing`);
  await expect(page).toHaveURL(`${origin}/admin/studio/#/front-page`);
  const banner = page.locator('alert-banner[data-old-draft="landing"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Bring back changes you didn't save?");
  await expect(banner).toContainText("They were kept on this computer before your blog's screens changed.");
  await banner.locator("summary").click();
  await expect(banner).toContainText(key);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector('alert-banner[data-old-draft]'), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await banner.getByRole("button", { name: "Bring them back" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator(".studio-landing .studio-lede")).toContainText("Changes not saved yet.");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  // Leaving asks first: they are unsaved work like any other.
  await page.goto(`${origin}/admin/studio/#/`);
  await expect(page.getByRole("button", { name: "Leave without saving" })).toBeVisible();
  await page.getByRole("button", { name: "Leave without saving" }).click();
  // Offered once: with the key gone there is nothing to offer.
  await page.goto(`${origin}/admin/studio/#/front-page`);
  await expect(page.locator(".studio-landing-list")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("alert-banner[data-old-draft]")).toHaveCount(0);
});

test("Throw them away asks once, and a copy the same as what's saved is never offered", async ({ page }) => {
  await signIn(page);
  const key = "ob-look-draft:writer";
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ v: 1, base: null, savedAt: "2026-11-10T15:30:00.000Z", page: { corners: "round" } })), key);
  await page.goto(`${origin}/admin/studio/#/look`);
  const banner = page.locator('alert-banner[data-old-draft="look"]');
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Throw them away" }).click();
  await page.getByRole("button", { name: "Keep them" }).click();
  await expect(banner).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull();
  await banner.getByRole("button", { name: "Throw them away" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Throw them away" }).click();
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  // A copy equal to what is saved: nothing to bring back, so no banner, and the copy is done with.
  await page.evaluate(async (key) => {
    const saved = (await (await fetch("/admin/api/look")).json()).look || {};
    const same = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string" && value !== "" && value !== "theme"));
    localStorage.setItem(key, JSON.stringify({ v: 1, base: null, savedAt: "2026-11-10T15:30:00.000Z", page: same }));
  }, key);
  await page.goto(`${origin}/admin/studio/#/`);
  await page.goto(`${origin}/admin/studio/#/look`);
  await expect(page.getByRole("heading", { name: "How your site looks" })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  await expect(page.locator("alert-banner[data-old-draft]")).toHaveCount(0);
});

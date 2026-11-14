import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Opening with no signal (Studio R4 G35): after one visit, the worker's copy of Studio's own files
// opens New job with the network off, a job is kept, and it goes when the network comes back. The
// worker keeps nothing but Studio's files: never an API reply, never the old Admin's pages.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "allow" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-offline-"));
  execFileSync(binary, ["init", dir, "--starter", "trade", "--trade", "roofing", "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "content", "services"), { recursive: true });
  writeFileSync(join(dir, "content", "services", "roof-repair.md"), "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks found and fixed.\n---\nWe fix leaks.\n");
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

async function visitOnce(page) {
  await page.goto(`${origin}/admin/studio/#/new-job`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
  // The worker is in charge and has kept this release's files.
  await expect.poll(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/admin/");
    const names = await caches.keys();
    const kept = names.length ? await (await caches.open(names[0])).keys() : [];
    return Boolean(navigator.serviceWorker.controller) && reg?.active?.scriptURL.endsWith("/admin/sw.js") && reg.scope.endsWith("/admin/") && kept.length > 20;
  }), { timeout: 20000 }).toBe(true);
}

const drafts = (town) => readdirSync(join(dir, "content", "posts")).filter((name) => name.includes(town));

test("after one visit New job opens with no signal, keeps a job, and sends it when the signal comes back", async ({ page, context }) => {
  await visitOnce(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
  await page.getByRole("textbox", { name: "What did you do?", exact: true }).fill("Patched the ridge, no signal up here.");
  await page.getByRole("textbox", { name: "Town", exact: true }).fill("Nosignal");
  await page.getByRole("button", { name: "Save this job", exact: true }).click();
  await expect(page.locator(".studio-new-job > [role=status]")).toContainText("Saved on this computer.");
  await expect(page.locator("[data-waiting]")).toHaveCount(1);
  expect(drafts("nosignal")).toHaveLength(0);
  await context.setOffline(false);
  await expect(page.locator("[data-waiting]")).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => drafts("nosignal").length).toBe(1);
});

test("the worker keeps only Studio's own files: never an API reply, never the old Admin", async ({ page }) => {
  await visitOnce(page);
  await page.goto(`${origin}/admin/studio/#/`);
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/posts`);
  await page.waitForTimeout(500);
  const kept = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) out.push(`${name} ${new URL(request.url).pathname}${new URL(request.url).search}`);
    return out;
  });
  expect(kept.length).toBeGreaterThan(20);
  for (const entry of kept) {
    expect(entry, entry).toMatch(/^studio-[0-9a-f]{16} \/admin\/studio\//);
    expect(entry, entry).not.toMatch(/\/api\/|\?/);
  }
  expect((await page.evaluate(async () => (await caches.keys()).length))).toBe(1);
});

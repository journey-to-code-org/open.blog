import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import http from "node:http";
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

async function visitOnce(page, at = origin) {
  await page.goto(`${at}/admin/studio/#/new-job`);
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

/**
 * A proxy in front of the test server that can play the next release: its worker script under a new
 * version, and one of Studio's files that doesn't come. (Playwright can't route a worker's own script.)
 */
async function nextReleaseProxy() {
  const target = new URL(origin);
  const mode = { version: "", block: "" };
  const server = http.createServer((request, response) => {
    if (mode.block && request.url.startsWith(mode.block)) {
      request.socket.destroy();
      return;
    }
    const upstream = http.request({ host: target.hostname, port: target.port, path: request.url, method: request.method, headers: request.headers }, (reply) => {
      if (mode.version && request.url.startsWith("/admin/sw.js")) {
        const chunks = [];
        reply.on("data", (chunk) => chunks.push(chunk));
        reply.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8").replace(/"version":"[0-9a-f]{16}"/, `"version":"${mode.version}"`);
          response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
          response.end(body);
        });
        return;
      }
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { mode, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

test("a new release whose install loses one file never takes over: the previous one still opens with no signal", async ({ page, context }) => {
  const proxy = await nextReleaseProxy();
  try {
    await visitOnce(page, proxy.origin);
    const before = await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("studio-")));
    expect(before).toHaveLength(1);
    // The next release: the same files under a new version, and New job's own file doesn't come.
    proxy.mode.version = "0000000000000002";
    proxy.mode.block = "/admin/studio/screens/new-job.js";
    const outcome = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/admin/");
      const settled = new Promise((resolve) => reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker.addEventListener("statechange", () => { if (["redundant", "activated"].includes(worker.state)) resolve(worker.state); });
      }));
      await reg.update().catch(() => {});
      return Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve("no update seen"), 20000))]);
    });
    expect(outcome).toBe("redundant");
    expect(await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("studio-")))).toEqual(before);
    proxy.mode.version = "";
    proxy.mode.block = "";
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save this job", exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await proxy.close();
  }
});

test("a server that takes 15 s to answer: New job opens from the kept copy in a few seconds", async ({ page, context }) => {
  await visitOnce(page);
  // Studio's own files crawl; the API (signed in, meta) answers as usual.
  await context.route(/\/admin\/studio\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await route.continue().catch(() => {});
  });
  const started = Date.now();
  await page.reload({ waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible({ timeout: 12000 });
  expect(Date.now() - started).toBeLessThan(12000);
  await context.unroute(/\/admin\/studio\//);
});

test("Details show the worker's, the page's and the server's release, and Clear saved pages deletes only Studio's copies", async ({ page, context }) => {
  await visitOnce(page);
  const version = /"version":"([0-9a-f]{16})"/.exec(await (await fetch(`${origin}/admin/sw.js`)).text())[1];
  // A job waits on this phone: clearing the pages must leave it be.
  await context.setOffline(true);
  await page.getByRole("textbox", { name: "What did you do?", exact: true }).fill("Stays through a clear.");
  await page.getByRole("button", { name: "Save this job", exact: true }).click();
  await expect(page.locator("[data-waiting]")).toHaveCount(1);
  await context.setOffline(false);
  await page.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  await context.route(/\/admin\/api\/(upload|document|capture\?)/, (route) => route.abort("connectionrefused"));
  const details = page.locator(".studio-account-side details").last();
  await details.locator("summary").click();
  await expect(details).toContainText(`releases: worker ${version} · page ${version} · server ${version}`);
  await expect(details.locator("[data-release-mismatch]")).toHaveCount(0);
  // A marker in Studio's copy, and a cache that isn't Studio's: only the first goes.
  await page.evaluate(async () => {
    const [name] = (await caches.keys()).filter((key) => key.startsWith("studio-"));
    await (await caches.open(name)).put("/admin/studio/__marker", new Response("x"));
    await (await caches.open("not-studio")).put("/elsewhere", new Response("y"));
  });
  await details.getByRole("button", { name: "Clear saved pages" }).click();
  await expect(page.getByRole("heading", { name: "New job", level: 2 })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/admin/studio/__marker")))).toBe(false);
  expect(await page.evaluate(async () => Boolean(await caches.match("/elsewhere", { cacheName: "not-studio" })))).toBe(true);
  await page.evaluate(() => caches.delete("not-studio"));
  await expect(page.locator("[data-waiting]")).toHaveCount(1);
  // The worker is still there, and keeps the pages again from here on.
  expect(await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/admin/")))).toBe(true);
  await context.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await page.unroute(/\/admin\/api\/(upload|document|capture\?)/);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(page.locator("[data-waiting]")).toHaveCount(0, { timeout: 15000 });
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

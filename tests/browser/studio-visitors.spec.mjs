import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 9: Visitors. The built-in counter is on by default, so Visitors is in the navigation.
// The counter's summary is mocked at the Admin API so the numbers are steady; it names what they
// read by title (never a raw address), changes range by address, says when counting is off, and
// passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let firstPost;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-visitors-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
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

async function signIn(page, hash = "#/visitors") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

async function mockCounter(page, { status = 200 } = {}) {
  const asked = [];
  await page.route("**/admin/api/analytics?**", async (route) => {
    const days = Number(new URL(route.request().url()).searchParams.get("days"));
    asked.push(days);
    if (status !== 200) return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: "off" }) });
    try {
      const posts = await (await page.request.get(`${origin}/admin/api/documents?kind=posts`)).json();
      firstPost = (posts?.items || posts || []).find((p) => p.url) || null;
    } catch {
      // The page closed while answering; the next answer looks again.
    }
    const series = Array.from({ length: days }, (_, i) => ({ day: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, views: i === 3 ? 48 : 5, uniques: 3 }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      days, from: "2026-10-01", to: "2026-11-13", views: 612, uniques: 214, allTimeViews: 2000, firstDay: "2026-01-01", series,
      topPosts: [{ path: firstPost?.url || "/x/", views: 120, uniques: 88, allTime: 1040 }, { path: "/tags/pies/", views: 40, uniques: 30, allTime: 40 }],
      referrers: [{ host: "facebook.com", views: 52 }], agentRequests: 9, agents: [], agentPages: [],
    }) });
  });
  return asked;
}

test("Visitors says how many people came and what they read, by title", async ({ page }) => {
  const asked = await mockCounter(page);
  await signIn(page);
  await expect(page.getByRole("link", { name: "Visitors" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who's been reading?" })).toBeVisible();
  await expect(page.getByText("214 people visited")).toBeVisible();
  await expect(page.getByText("They looked at 612 pages.")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Visits per day, busiest .* with 48\.$/ })).toBeVisible();
  expect(firstPost).toBeTruthy();
  await expect(page.locator(".studio-visitors").getByRole("link", { name: firstPost.title })).toBeVisible();
  await expect(page.getByText("Other pages: 40 visits")).toBeVisible();
  await expect(page.locator(".studio-visitors").getByText("facebook.com")).toBeVisible();
  await expect(page.locator(".studio-visitors").getByText("/tags/pies/")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Over the last" }).selectOption("7");
  await expect(page).toHaveURL(/#\/visitors\/7$/);
  await expect.poll(() => asked.at(-1)).toBe(7);
});

test("when counting is off, Visitors says so plainly", async ({ page }) => {
  await mockCounter(page, { status: 404 });
  await signIn(page);
  await expect(page.getByText("Visitor counting is switched off.")).toBeVisible();
});

test("Visitors passes axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockCounter(page);
  await signIn(page);
  await expect(page.getByText("214 people visited")).toBeVisible();
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Admin Share this job screen at 400px (story #488, ADR 0396): a published job opened from Write shows
// Google Business Profile, Facebook and Nextdoor with their words and where each stands, a by-hand place is marked
// as posted and stays so after a reload, and nothing is sent anywhere. Social publishing is not configured here, so
// a Facebook Page is posted by hand too.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const JOB = `---
title: New oak floor in Maple Falls
date: 2026-10-21
description: Sanded, stained and sealed a worn oak floor.
profile: job
job:
  trade: flooring
  service: hardwood-install
  place:
    town: Maple Falls
    region: WA
  started: 2026-10-14
  finished: 2026-10-16
---
Done.
`;
let root;
let server;
let origin;

test.use({ viewport: { width: 400, height: 800 } });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-job-share-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  writeFileSync(join(root, "content", "posts", "new-oak-floor.md"), JOB);
  execFileSync(binary, ["user", "add", "writer", "--root", root], {
    env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe",
  });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("OPENBLOG_SOCIAL")) delete env[name];
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
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

async function signIn(page) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-action="logout"]')).toBeVisible();
  }
}

async function expectFits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
  for (const control of await page.locator("[data-job-share] button, [data-job-share] a.oba-btn").all()) {
    if (!(await control.isVisible())) continue;
    expect((await control.boundingBox()).height, await control.evaluate((n) => n.textContent)).toBeGreaterThanOrEqual(43);
  }
}

test("a published job opened from Write shows each place, and a by-hand post is remembered", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/#/edit/${encodeURIComponent("posts/new-oak-floor.md")}`);
  // Write offers the screen under the Job form, in the document's settings.
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  const target = page.locator('[data-pane-target="settings"]');
  if (!(await target.isVisible())) await page.locator(".oba-editor-advanced > summary").click();
  await target.click();
  await page.getByRole("link", { name: "Share this job" }).click();
  await expect(page).toHaveURL(/#\/share\/posts%2Fnew-oak-floor\.md$/);
  const places = page.locator("[data-job-share-places] > li");
  await expect(places).toHaveCount(3);
  for (const name of ["Google Business Profile", "Facebook", "Nextdoor"]) await expect(page.locator("[data-job-share]")).toContainText(name);
  const nextdoor = page.locator('[data-destination="nextdoor"]');
  await expect(nextdoor.locator("[data-job-share-words]")).toContainText("Hardwood install in Maple Falls, WA.");
  await expect(nextdoor.locator("[data-job-share-standing]")).toHaveText("Not shared yet.");
  await expect(nextdoor.getByRole("link", { name: "Open Nextdoor" })).toHaveAttribute("href", /^https:\/\/nextdoor\.com\/sharekit\//);
  // No connected Page here, so Facebook is by hand too, and says how to change that.
  await expect(page.locator('[data-destination="facebook"]')).toContainText("Connect your Facebook Page");
  await expect(page.locator('[data-action="job-share-facebook"]')).toHaveCount(0);
  await expectFits(page);
  await nextdoor.getByRole("button", { name: "I posted it" }).click();
  await expect(page.locator("[data-job-share-status]")).toContainText("you posted it on Nextdoor");
  await expect(nextdoor.locator("[data-job-share-standing]")).toContainText("You posted it by hand on");
  const record = JSON.parse(readFileSync(join(root, ".openblog", "job-shares.json"), "utf8"));
  expect(Object.values(record.jobs)[0].nextdoor.status).toBe("posted-by-hand");
  await page.reload();
  await expect(page.locator('[data-destination="nextdoor"] [data-job-share-standing]')).toContainText("You posted it by hand on");
});

test("a draft job says it must be published first", async ({ page }) => {
  writeFileSync(join(root, "content", "posts", "draft-job.md"), JOB.replace("profile: job", "draft: true\nprofile: job"));
  await signIn(page);
  await page.goto(`${origin}/admin/#/share/${encodeURIComponent("posts/draft-job.md")}`);
  await expect(page.locator("[data-job-share-status]")).toContainText("Publish it first");
  await expect(page.locator("[data-job-share-places]")).toHaveCount(0);
  expect(existsSync(join(root, "content", "posts", "draft-job.md"))).toBe(true);
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The real Admin Reviews screen at 400px (ADR 0389): the list and the form fit the screen with 44px, named
// controls; a review typed in by hand or copied from its link is saved to proof/ and reaches the Reviews page,
// the job it is linked to and the jobs list. Copying goes through the Assistant's URL snapshot route; here that
// route is answered by a scripted fake, so no real site is ever contacted.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;

test.use({ viewport: { width: 400, height: 800 } });
test.describe.configure({ mode: "serial" });

const JOB = `---
title: New oak floor in Bend
date: 2026-10-16
profile: job
job:
  trade: flooring
  service: hardwood-install
  place:
    town: Bend
    region: OR
  started: 2026-10-14
  finished: 2026-10-16
  review: dana-r-2026-10-20
---
## Result

A new oak floor.
`;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-reviews-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "content", "posts", "2026-10-16-oak-floor.md"), JOB);
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

async function signedIn(page, hash) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.goto(`${origin}/admin/${hash}`);
}

// No control or region is wider than the viewport (a small tolerance, never tuned to one platform's fonts).
async function expectNoOverflow(page, selector) {
  const wider = await page.locator(selector).evaluate((region) => {
    const limit = document.documentElement.clientWidth + 2;
    const offenders = [region, ...region.querySelectorAll("*")].filter((node) => node.getBoundingClientRect().right > limit);
    return offenders.map((node) => `${node.tagName}.${node.className}`);
  });
  expect(wider).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2)).toBe(true);
}

async function expectTouchTargets(page) {
  for (const control of await page.locator("[data-reviews-screen] input:not([type=checkbox]), [data-reviews-screen] select, [data-reviews-screen] textarea, [data-reviews-screen] button, [data-reviews-screen] a.oba-btn").all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box.height, await control.evaluate((node) => node.getAttribute("aria-label") || node.id || node.textContent)).toBeGreaterThanOrEqual(43);
  }
}

const status = (page) => page.locator("[data-reviews-status]");
const file = (name) => join(root, "content", "proof", name);

test("an empty list invites a first review and the form fits 400px with 44px, named controls", async ({ page }) => {
  await signedIn(page, "#/reviews");
  await expect(page.locator('[data-reviews-screen="list"]')).toBeVisible();
  await expect(page.locator("[data-reviews-empty]")).toContainText("No reviews yet");
  await expectNoOverflow(page, "[data-reviews-screen]");
  await page.getByRole("link", { name: "Add a review" }).click();
  await expect(page.locator('[data-reviews-screen="form"]')).toBeVisible();
  for (const label of ["Reviewer's name", "Day it was written", "Where it was left", "Stars", "The review", "Id", "Keep this as a draft"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Copy the page" })).toBeVisible();
  await expectNoOverflow(page, "[data-reviews-screen]");
  await expectTouchTargets(page);
});

test("a rating or link the build would refuse is said beside its field and nothing is saved", async ({ page }) => {
  await signedIn(page, "#/reviews/new");
  await page.getByLabel("Reviewer's name", { exact: true }).fill("Sam");
  await page.getByLabel("Day it was written", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Where it was left", { exact: true }).selectOption("google");
  await page.locator('[data-review-field="sourceUrl"]').fill("https://google.example.com/r");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(status(page)).toContainText("2 things need fixing");
  await expect(page.locator('[data-problem-for="sourceUrl"]')).toContainText("not on Google");
  await expect(page.locator('[data-problem-for="text"]')).toContainText("Add the review's words");
  expect(existsSync(file("sam-2026-10-01.md"))).toBe(false);
});

test("a review copied from its link is saved with where it came from and reaches the site", async ({ page }) => {
  const asked = [];
  await page.route("**/admin/api/assistant/context/url/retrieve", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ snapshot: { sourceUrl: "https://g.page/r/crew/review", canonicalUrl: "https://www.google.com/maps/reviews/crew", retrievedAt: "2026-11-08T15:04:05Z", contentType: "text/html", text: "Dana R.\n\nOn time and careful. Would hire again." } }),
    });
  });
  await signedIn(page, "#/reviews/new");
  await page.getByLabel("Link to copy from", { exact: true }).fill("https://g.page/r/crew/review");
  await page.getByRole("button", { name: "Copy the page" }).click();
  await expect(page.locator("[data-review-fetch-status]")).toContainText("Copied");
  expect(asked).toEqual([{ url: "https://g.page/r/crew/review", confirmed: true }]);
  await expect(page.locator('[data-review-field="sourceUrl"]')).toHaveValue("https://g.page/r/crew/review");
  await expect(page.locator('[data-review-field="sourceUrl"]')).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Where it was left", { exact: true })).toHaveValue("google");
  await expect(page.locator('[data-review-provenance="snapshot"]')).toContainText("Copied from its link");
  await expect(page.locator("[data-review-page-text]")).toHaveValue(/On time and careful/);

  await page.getByLabel("Reviewer's name", { exact: true }).fill("Dana R.");
  await page.getByLabel("Day it was written", { exact: true }).fill("2026-10-20");
  await expect(page.getByLabel("Id", { exact: true })).toHaveValue("dana-r-2026-10-20");
  await page.getByLabel("Stars", { exact: true }).selectOption("5");
  await page.getByLabel("The review", { exact: true }).fill("On time and careful. Would hire again.");
  await expectNoOverflow(page, "[data-reviews-screen]");
  await expectTouchTargets(page);
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(status(page)).toContainText("Saved.");
  await expect(page).toHaveURL(/#\/reviews\/edit\/proof%2Fdana-r-2026-10-20\.md$/);
  expect(asked).toHaveLength(1);

  const text = readFileSync(file("dana-r-2026-10-20.md"), "utf8");
  expect(text).toContain("provenance: snapshot");
  expect(text).toContain("2026-11-08T15:04:05Z");
  expect(text).toContain("rating: 5");
  expect(text).toContain("On time and careful. Would hire again.");

  const reviews = await (await fetch(`${origin}/reviews/`)).text();
  expect(reviews).toContain("Dana R.");
  expect(reviews).toContain("About the job:");
  expect(reviews).toContain('"@type":"Review"');
  const jobs = await (await fetch(`${origin}/jobs/`)).text();
  expect(jobs).toContain("Review by Dana R. on Google");
});

test("a review typed in by hand says so, and the list shows it", async ({ page }) => {
  await signedIn(page, "#/reviews/new");
  await page.getByLabel("Reviewer's name", { exact: true }).fill("Lee");
  await page.getByLabel("Day it was written", { exact: true }).fill("2026-10-02");
  await page.getByLabel("Where it was left", { exact: true }).selectOption("facebook");
  await page.locator('[data-review-field="sourceUrl"]').fill("https://www.facebook.com/crew/reviews/1");
  await expect(page.locator('[data-review-provenance="entered"]')).toBeVisible();
  await page.getByLabel("The review", { exact: true }).fill("Friendly crew.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(status(page)).toContainText("Saved.");
  const text = readFileSync(file("lee-2026-10-02.md"), "utf8");
  expect(text).toContain("provenance: entered");
  expect(text).not.toContain("retrievedAt");
  expect(text).not.toContain("rating");

  await signedIn(page, "#/reviews");
  await expect(page.locator("[data-review-row]")).toHaveCount(2);
  await expectNoOverflow(page, "[data-reviews-screen]");
  const reviews = await (await fetch(`${origin}/reviews/`)).text();
  expect(reviews).toContain("Typed in from the original review.");
});

test("a second review with a taken id is told to change the id, and nothing is overwritten", async ({ page }) => {
  const before = readFileSync(file("lee-2026-10-02.md"), "utf8");
  await signedIn(page, "#/reviews/new");
  await page.getByLabel("Reviewer's name", { exact: true }).fill("Lee");
  await page.getByLabel("Day it was written", { exact: true }).fill("2026-10-02");
  await page.getByLabel("Where it was left", { exact: true }).selectOption("facebook");
  await page.locator('[data-review-field="sourceUrl"]').fill("https://www.facebook.com/crew/reviews/2");
  await page.getByLabel("The review", { exact: true }).fill("Second Lee.");
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(status(page)).toContainText("already have a review called lee-2026-10-02");
  await expect(status(page)).not.toContainText("Reload");
  await expect(page.locator('[data-problem-for="id"]')).toContainText("already used");
  expect(readFileSync(file("lee-2026-10-02.md"), "utf8")).toBe(before);
});

test("a review a published job shows cannot be made a draft, so the site keeps building", async ({ page }) => {
  const before = readFileSync(file("dana-r-2026-10-20.md"), "utf8");
  await signedIn(page, `#/reviews/edit/${encodeURIComponent("proof/dana-r-2026-10-20.md")}`);
  await expect(page.getByLabel("Reviewer's name", { exact: true })).toHaveValue("Dana R.");
  await page.getByLabel("Keep this as a draft").check();
  await page.getByRole("button", { name: "Save review" }).click();
  await expect(status(page)).toContainText("shows this review");
  await expect(status(page)).toContainText("choose another review for that job first");
  expect(readFileSync(file("dana-r-2026-10-20.md"), "utf8")).toBe(before);
});

test("a refused copy is said in plain words and leaves typing it in", async ({ page }) => {
  await page.route("**/admin/api/assistant/context/url/retrieve", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "URL context cannot retrieve local or private network addresses" }) }));
  await signedIn(page, "#/reviews/new");
  await page.getByLabel("Link to copy from", { exact: true }).fill("http://192.168.1.2/review");
  await page.getByRole("button", { name: "Copy the page" }).click();
  await expect(page.locator("[data-review-fetch-status]")).toContainText("private or local address");
  await expect(page.locator("[data-review-fetch-status]")).toContainText("type the review in");
  await expect(page.locator('[data-review-field="sourceUrl"]')).not.toHaveAttribute("readonly", "");
});

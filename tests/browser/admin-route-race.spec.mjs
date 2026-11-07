import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Moving on while an Admin view loads: its answer arrives on the page the owner moved to, and that
// page stays as it is. Each test holds the answers open, moves away, lets them go, and checks that
// nothing was mounted since. Every route `onHash` dispatches is listed, and a test holds the list to it.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const POST_PATH = "<path>";
const TOKEN = `abc.${"0".repeat(64)}`;

// Views that load before they draw, and views that draw first and load into what they drew.
const SLOW_ROUTES = [
  "#/overview",
  "#/posts",
  "#/pages",
  `#/edit/${POST_PATH}`,
  "#/analytics",
  "#/moderation",
  "#/feedback",
  "#/contributors",
  "#/voice",
  "#/voice/library",
  "#/capture",
  "#/landing",
  "#/announcements",
  "#/paths",
  "#/paths/new",
  "#/comparisons",
  "#/comparisons/new",
  "#/appearance",
  "#/look",
  "#/business",
  "#/services",
  "#/research/overview",
  "#/research/sources",
  "#/research/notebook",
  "#/research/atlas",
  "#/research/compare",
  "#/research/public",
  "#/shared",
  "#/shared/new",
  `#/shared/accept/${TOKEN}`,
];
// Routes with nothing to hold: Social is where the tests land, and a new document opens at once.
const OTHER_HEADS = ["social", "new"];

let parent;
let origin;
let server;
let postPath;

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-route-race-"));
  const root = join(parent, "site");
  execFileSync(binary, ["init", root, "--no-voice"], { stdio: "pipe" });
  execFileSync(binary, ["user", "add", "writer", "--root", root], {
    env: { ...process.env, OPENBLOG_PASSWORD: password },
    stdio: "pipe",
  });
  writeFileSync(join(root, "content", "posts", "garden.md"), "---\ntitle: Garden notes\ndate: 2026-10-04\n---\nWords.\n");
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "ignore" });
  await expect(async () => {
    expect((await fetch(`${origin}/admin/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server?.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(parent);
});

async function signIn(page) {
  await page.goto(`${origin}/admin/#/social`);
  await page.getByLabel("Username", { exact: true }).fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-action="logout"]')).toBeVisible();
  postPath ??= await page.evaluate(async () => {
    const list = await (await fetch("/admin/api/documents?kind=posts")).json();
    return list.items.find((item) => item.title === "Garden notes").path;
  });
}

/** Hold every answer the page asks for while `hold` is on; `release` lets them all go. */
async function holdAnswers(page) {
  const held = [];
  const open = new Set();
  let holding = true;
  let release;
  const released = new Promise((done) => { release = done; });
  page.on("request", (request) => { if (request.url().includes("/admin/api/")) open.add(request); });
  const finished = (request) => open.delete(request);
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  await page.route("**/admin/api/**", async (route) => {
    if (!holding) return route.continue();
    held.push(route.request().url());
    await released;
    await route.continue().catch(() => {});
  });
  return {
    held,
    stop() { holding = false; },
    /** Let the answers go, and wait until the views they woke have had every chance to draw. */
    async release() {
      holding = false;
      release();
      await expect(async () => {
        expect(open.size).toBe(0);
      }).toPass({ timeout: 20000 });
      await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
      expect(open.size).toBe(0);
    },
  };
}

/** Change the address and return once Admin has handled it, which draws a view that loads nothing first. */
const moveTo = (page, hash) =>
  page.evaluate(
    (target) =>
      new Promise((done) => {
        addEventListener("hashchange", () => setTimeout(done), { once: true });
        location.hash = target;
      }),
    hash,
  );

/** Tag what is drawn now. A later mount takes the tag away. */
const tagPage = (page) => page.evaluate(() => { document.querySelector("ob-admin").firstElementChild.dataset.raceTag = "still-here"; });
const tagged = (page) => page.locator('ob-admin > [data-race-tag="still-here"]');

const socialHeading = (page) => page.getByRole("heading", { level: 2, name: "Social accounts" });

async function expectStillOnSocial(page) {
  await expect(tagged(page)).toHaveCount(1);
  await expect(socialHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/#\/social$/);
  const state = await page.evaluate(() => {
    const admin = document.querySelector("ob-admin");
    return { route: admin.activeRoute, editor: Boolean(admin.editor), unsaved: admin.hasUnsavedWork(), hash: admin.currentHash };
  });
  expect(state).toEqual({ route: "social", editor: false, unsaved: false, hash: "#/social" });
}

test("the list here covers every route Admin dispatches", () => {
  const source = readFileSync(join(repository, "web", "admin", "admin.js"), "utf8");
  const start = source.indexOf("  async onHash() {");
  const onHash = source.slice(start, source.indexOf("\n  }\n", start));
  const dispatched = [...onHash.matchAll(/head === "(\w+)"/g)].map((match) => match[1]);
  expect(dispatched.length).toBeGreaterThan(15);
  const listed = new Set([...SLOW_ROUTES.map((route) => route.slice(2).split("/")[0]), ...OTHER_HEADS]);
  expect(dispatched.filter((head) => !listed.has(head))).toEqual([]);
});

for (const slow of SLOW_ROUTES) {
  test(`moving on from ${slow.replace(TOKEN, "<token>")} while it loads leaves her where she went`, async ({ page }) => {
    await signIn(page);
    await expect(socialHeading(page)).toBeVisible();
    const answers = await holdAnswers(page);
    await moveTo(page, slow.replace(POST_PATH, encodeURIComponent(postPath)));
    await expect(async () => {
      expect(answers.held.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });
    answers.stop();
    await moveTo(page, "#/social");
    await expect(socialHeading(page)).toBeVisible();
    await tagPage(page);
    await answers.release();
    await expectStillOnSocial(page);
  });
}

test("a slow view does not draw over the draft she went back to", async ({ page }) => {
  await signIn(page);
  await moveTo(page, `#/edit/${encodeURIComponent(postPath)}`);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Garden notes");
  await tagPage(page);
  const answers = await holdAnswers(page);
  await moveTo(page, "#/overview");
  answers.stop();
  // Back to the draft still on screen, which is not reloaded.
  await page.evaluate(() => new Promise((done) => {
    addEventListener("hashchange", () => setTimeout(done), { once: true });
    history.back();
  }));
  await answers.release();
  await expect(tagged(page)).toHaveCount(1);
  await expect(page).toHaveURL(/#\/edit\//);
  expect(await page.evaluate(() => Boolean(document.querySelector("ob-admin").editor))).toBe(true);
});

test("a kept draft comes back and stays when the panel she left it for answers late", async ({ page }) => {
  await signIn(page);
  await moveTo(page, "#/new/posts");
  await page.getByLabel("Title", { exact: true }).fill("Soup for Tuesday");
  await expect.poll(() => page.evaluate(() => document.querySelector("ob-admin").hasUnsavedView())).toBe(true);

  let release;
  const released = new Promise((done) => { release = done; });
  await page.route("**/admin/api/research/notebook", async (route) => { await released; await route.continue(); });
  await moveTo(page, "#/research/notebook");
  expect(await page.evaluate(() => [...document.querySelector("ob-admin").kept.keys()])).toEqual(["draft"]);
  await moveTo(page, "#/new/posts");
  const title = page.getByLabel("Title", { exact: true });
  await expect.poll(() => page.evaluate(() => document.querySelector("ob-admin").kept.size)).toBe(0);
  await tagPage(page);

  const answered = page.waitForResponse("**/admin/api/research/notebook");
  release();
  await answered;
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(tagged(page)).toHaveCount(1);
  await expect(title).toHaveValue("Soup for Tuesday");
  expect(await page.evaluate(() => Boolean(document.querySelector("ob-admin").editor))).toBe(true);
});

test("a kept panel she stopped returning to stays kept, and comes back later", async ({ page }) => {
  await signIn(page);
  await moveTo(page, "#/research/sources");
  await page.getByRole("button", { name: "New source" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Kept while moving");
  await moveTo(page, "#/research/notebook");
  const heading = page.locator("#oba-page-heading");
  await expect(heading).toHaveText("Research notebook");

  // Coming back first checks the session; she moves on before it answers.
  let release;
  const released = new Promise((done) => { release = done; });
  let checked = false;
  await page.route("**/admin/api/session", async (route) => {
    if (checked) return route.continue();
    checked = true;
    await released;
    await route.continue();
  });
  await moveTo(page, "#/research/sources");
  await moveTo(page, "#/research/atlas");
  await expect(heading).toHaveText("Knowledge Atlas");
  await tagPage(page);
  release();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(tagged(page)).toHaveCount(1);
  await expect(page).toHaveURL(/#\/research\/atlas$/);

  await moveTo(page, "#/research/sources");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Kept while moving");
  page.once("dialog", (dialog) => dialog.accept());
  await moveTo(page, "#/social");
});

test("staying put when asked drops the page she had started to move to", async ({ page }) => {
  await signIn(page);
  await moveTo(page, "#/look");
  await page.locator('[data-control="textSize"].oba-look-control input[data-choice="extra-large"]').check();
  await expect(page.locator("[data-look-dirty]")).toContainText("unsaved changes");
  await tagPage(page);

  const answers = await holdAnswers(page);
  page.once("dialog", (dialog) => dialog.accept());
  await moveTo(page, "#/overview");
  answers.stop();
  // The same unsaved changes are still there to ask about; this time she stays.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => { location.hash = "#/contributors"; });
  await expect(page).toHaveURL(/#\/look$/);
  await answers.release();
  await expect(tagged(page)).toHaveCount(1);
  await expect(page).toHaveURL(/#\/look$/);
});

test("signing out while a view loads keeps the sign-in form on screen", async ({ page }) => {
  await signIn(page);
  await expect(socialHeading(page)).toBeVisible();
  // The server answers before she signs out, and the answer reaches the page after, so it is a real one.
  let release;
  const released = new Promise((done) => { release = done; });
  await page.route("**/admin/api/appearance", async (route) => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
  });
  const asked = page.waitForRequest("**/admin/api/appearance");
  await moveTo(page, "#/appearance");
  await asked;
  await page.locator('[data-action="logout"]').click();
  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toBeVisible();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  release();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(username).toBeVisible();
  await expect(page.locator('[data-action="logout"]')).toHaveCount(0);
});

test("signing back in does not let an answer from before she signed out draw", async ({ page }) => {
  await signIn(page);
  await expect(socialHeading(page)).toBeVisible();
  let releaseAppearance;
  const appearanceReleased = new Promise((done) => { releaseAppearance = done; });
  let asked = 0;
  await page.route("**/admin/api/appearance", async (route) => {
    asked += 1;
    if (asked > 1) return route.continue();
    const response = await route.fetch();
    await appearanceReleased;
    await route.fulfill({ response });
  });
  const appearanceAsked = page.waitForRequest("**/admin/api/appearance");
  await moveTo(page, "#/appearance");
  await appearanceAsked;
  await page.locator('[data-action="logout"]').click();
  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toBeVisible();

  // Signed in, and Admin is still reading its settings when the old answer arrives.
  let releaseMeta;
  const metaReleased = new Promise((done) => { releaseMeta = done; });
  await page.route("**/admin/api/meta", async (route) => { await metaReleased; await route.continue(); });
  const metaAsked = page.waitForRequest("**/admin/api/meta");
  await username.fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await metaAsked;
  releaseAppearance();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(username).toBeVisible();
  await expect(page.locator('[data-action="logout"]')).toHaveCount(0);

  releaseMeta();
  await expect(page.locator("#oba-page-heading")).toHaveText("Appearance");
  expect(asked).toBe(2);
});

const adminState = (page) =>
  page.evaluate(() => {
    const admin = document.querySelector("ob-admin");
    return { editor: Boolean(admin.editor), unsaved: admin.hasUnsavedWork(), view: admin.hasUnsavedView(), kept: [...admin.kept.keys()], hash: admin.currentHash };
  });

/** Count the questions the page asks, answering each as `answer` says. */
function answerQuestions(page, answer) {
  const asked = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    return answer.accept ? dialog.accept() : dialog.dismiss();
  });
  return asked;
}

async function typeNewDraft(page, title) {
  await moveTo(page, "#/new/posts");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await expect.poll(() => page.evaluate(() => document.querySelector("ob-admin").hasUnsavedView())).toBe(true);
}

test("going back to a draft she agreed to leave keeps it protected", async ({ page }) => {
  await signIn(page);
  await typeNewDraft(page, "Soup for Tuesday");
  await tagPage(page);
  const answer = { accept: true };
  const asked = answerQuestions(page, answer);
  const answers = await holdAnswers(page);
  await moveTo(page, "#/posts");
  expect(asked).toHaveLength(1);
  answers.stop();
  await page.evaluate(() => new Promise((done) => {
    addEventListener("hashchange", () => setTimeout(done), { once: true });
    history.back();
  }));
  await answers.release();
  await expect(tagged(page)).toHaveCount(1);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup for Tuesday");
  expect(await adminState(page)).toEqual({ editor: true, unsaved: true, view: true, kept: [], hash: "#/new/posts" });

  // Leaving again asks again, and the draft stays when she says no.
  answer.accept = false;
  await page.evaluate(() => { location.hash = "#/posts"; });
  await expect.poll(() => asked.length).toBe(2);
  await expect(page).toHaveURL(/#\/new\/posts$/);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup for Tuesday");
});

test("staying on a kept draft while a panel loads gives her the working draft back", async ({ page }) => {
  await signIn(page);
  await typeNewDraft(page, "Soup for Wednesday");
  let release;
  const released = new Promise((done) => { release = done; });
  await page.route("**/admin/api/research/notebook", async (route) => { await released; await route.continue(); });
  await moveTo(page, "#/research/notebook");
  expect((await adminState(page)).kept).toEqual(["draft"]);

  const answer = { accept: false };
  const asked = answerQuestions(page, answer);
  await moveTo(page, "#/social");
  expect(asked).toHaveLength(1);
  await expect(page).toHaveURL(/#\/new\/posts$/);
  await expect.poll(() => adminState(page)).toEqual({ editor: true, unsaved: true, view: true, kept: [], hash: "#/new/posts" });
  release();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup for Wednesday");

  // It saves from the keyboard, and once saved nothing is left to ask about.
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/admin/api/document"));
  await page.keyboard.press("Control+s");
  await saved;
  await expect(page).toHaveURL(/#\/edit\//);
  await expect.poll(() => adminState(page).then((state) => state.unsaved)).toBe(false);
  await moveTo(page, "#/social");
  await expect(socialHeading(page)).toBeVisible();
  expect(asked).toHaveLength(1);
});

test("staying on a kept research panel while another loads gives her the panel back", async ({ page }) => {
  await signIn(page);
  await moveTo(page, "#/research/sources");
  await page.getByRole("button", { name: "New source" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Kept and stayed on");
  let release;
  const released = new Promise((done) => { release = done; });
  await page.route("**/admin/api/research/notebook", async (route) => { await released; await route.continue(); });
  await moveTo(page, "#/research/notebook");
  expect((await adminState(page)).kept).toEqual(["sources"]);

  const answer = { accept: false };
  answerQuestions(page, answer);
  await moveTo(page, "#/social");
  await expect(page).toHaveURL(/#\/research\/sources$/);
  await expect.poll(() => adminState(page).then((state) => [state.kept, state.view])).toEqual([[], true]);
  release();
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Kept and stayed on");
  answer.accept = true;
  await moveTo(page, "#/social");
});

/** Open a draft and start saving it, with the save held until the returned function runs. */
async function startHeldSave(page, title) {
  await typeNewDraft(page, title);
  let release;
  const released = new Promise((done) => { release = done; });
  await page.route("**/admin/api/document", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await released;
    await route.continue();
  });
  const asked = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/admin/api/document"));
  const answered = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/admin/api/document"));
  await page.keyboard.press("Control+s");
  await asked;
  return async () => {
    release();
    await answered;
    await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  };
}

test("a save that finishes after she left leaves her on the page she moved to", async ({ page }) => {
  await signIn(page);
  const finishSave = await startHeldSave(page, "Soup saved late");
  // Typed after the save began, so what it saved is not the latest; none of that is Social's business.
  await page.getByLabel("Title", { exact: true }).fill("Soup saved later");
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/social");
  await expect(socialHeading(page)).toBeVisible();
  await tagPage(page);
  await finishSave();
  await expectStillOnSocial(page);
});

test("a save that finishes while the next page loads leaves the address alone", async ({ page }) => {
  await signIn(page);
  const finishSave = await startHeldSave(page, "Soup saved midway");
  let release;
  const released = new Promise((done) => { release = done; });
  await page.route("**/admin/api/documents**", async (route) => { await released; await route.continue(); });
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/posts");
  await finishSave();
  await expect(page).toHaveURL(/#\/posts$/);
  release();
  await expect.poll(() => adminState(page)).toMatchObject({ editor: false, unsaved: false, hash: "#/posts" });
  await expect(page).toHaveURL(/#\/posts$/);
});

test("a rebuild that finishes after she moved on does not bring the list back", async ({ page }) => {
  await signIn(page);
  await moveTo(page, "#/posts");
  const rebuild = page.getByRole("button", { name: /rebuild/i });
  await expect(rebuild).toBeVisible();
  const answers = await holdAnswers(page);
  await rebuild.click();
  await expect(async () => {
    expect(answers.held.length).toBeGreaterThan(0);
  }).toPass({ timeout: 10000 });
  answers.stop();
  await moveTo(page, "#/social");
  await expect(socialHeading(page)).toBeVisible();
  await tagPage(page);
  await answers.release();
  await expectStillOnSocial(page);
});

test("answering an invitation opens the shared list with what happened", async ({ page }) => {
  await signIn(page);
  await page.route("**/admin/api/contributors", (route) => route.fulfill({ json: { contributors: {}, etag: "x" } }));
  await page.route("**/admin/api/collaboration/invitations/decline", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/admin/api/collaboration/publications", (route) => route.fulfill({ json: { publications: [] } }));
  await moveTo(page, `#/shared/accept/${TOKEN}`);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation declined." })).toBeVisible();
  await expect(page).toHaveURL(/#\/shared$/);
  // The address changing does not load the list again over the outcome.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(page.getByRole("status").filter({ hasText: "Invitation declined." })).toBeVisible();
});

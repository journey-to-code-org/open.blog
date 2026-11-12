import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  "#/seasons",
  "#/announcements",
  `#/share/${POST_PATH}`,
  "#/paths",
  "#/paths/new",
  "#/comparisons",
  "#/comparisons/new",
  "#/appearance",
  "#/look",
  "#/business",
  "#/reminders",
  "#/distribution",
  "#/quotes",
  "#/services",
  "#/reviews",
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
let siteRoot;

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-route-race-"));
  const root = (siteRoot = join(parent, "site"));
  execFileSync(binary, ["init", root, "--no-voice"], { stdio: "pipe" });
  execFileSync(binary, ["user", "add", "writer", "--root", root], {
    env: { ...process.env, OPENBLOG_PASSWORD: password },
    stdio: "pipe",
  });
  writeFileSync(join(root, "content", "posts", "garden.md"), "---\ntitle: Garden notes\ndate: 2026-10-04\n---\nWords.\n");
  writeFileSync(join(root, "content", "posts", "walnut.md"), "---\ntitle: Walnut notes\ndate: 2026-10-05\n---\nWords.\n");
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

/**
 * Hold the requests that match until `release`, then let them through or give them `answer`.
 * `release` returns once they are answered and what they woke has had every chance to draw.
 */
async function holdRequests(page, pattern, { method, answer } = {}) {
  const requests = [];
  let seen;
  const asked = new Promise((done) => { seen = done; });
  let open;
  const released = new Promise((done) => { open = done; });
  await page.route(pattern, async (route) => {
    if (method && route.request().method() !== method) return route.fallback();
    requests.push(route.request());
    seen();
    await released;
    await (answer ? route.fulfill(answer) : route.continue()).catch(() => {});
  });
  return {
    asked,
    async release() {
      open();
      await Promise.all(requests.map((request) => request.response().catch(() => {})));
      await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
    },
  };
}

const holdNextPage = (page) => holdRequests(page, "**/admin/api/documents**");
const openRoute = (page) => page.evaluate(() => document.querySelector("ob-admin").activeRoute);

/** Open a post of its own and ask to trash it, with the delete held. */
async function startHeldTrash(page, name) {
  writeFileSync(join(siteRoot, "content", "posts", `${name}.md`), `---\ntitle: ${name}\ndate: 2026-10-04\n---\nWords.\n`);
  const path = await page.evaluate(async (title) => {
    const list = await (await fetch("/admin/api/documents?kind=posts")).json();
    return list.items.find((item) => item.title === title).path;
  }, name);
  await moveTo(page, `#/edit/${encodeURIComponent(path)}`);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(name);
  const trash = await holdRequests(page, "**/admin/api/document?path=*", { method: "DELETE" });
  page.once("dialog", (dialog) => dialog.accept());
  // What the Move to trash button calls; the button itself sits in a pane that may be closed.
  await page.evaluate(() => { document.querySelector("ob-admin").editor.remove(); });
  await trash.asked;
  return trash;
}

test("a draft that reaches the trash after she left does not touch the new draft she started", async ({ page }) => {
  await signIn(page);
  const trash = await startHeldTrash(page, "trash-then-draft");
  await typeNewDraft(page, "Soup for Thursday");
  await tagPage(page);
  await trash.release();
  await expect(tagged(page)).toHaveCount(1);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup for Thursday");
  expect(await adminState(page)).toEqual({ editor: true, unsaved: true, view: true, kept: [], hash: "#/new/posts" });
  await expect(page).toHaveURL(/#\/new\/posts$/);
});

test("a draft that reaches the trash after she left does not pull her off the page she moved to", async ({ page }) => {
  await signIn(page);
  const trash = await startHeldTrash(page, "trash-then-social");
  await moveTo(page, "#/social");
  await expect(socialHeading(page)).toBeVisible();
  await tagPage(page);
  await trash.release();
  await expectStillOnSocial(page);
});

test("a kept draft that reaches the trash is no longer kept, and she stays on the panel she opened", async ({ page }) => {
  await signIn(page);
  const trash = await startHeldTrash(page, "trash-while-kept");
  await page.getByLabel("Title", { exact: true }).fill("trash-while-kept, edited");
  await expect.poll(() => adminState(page).then((state) => state.view)).toBe(true);
  await moveTo(page, "#/research/notebook");
  await expect(page.locator("#oba-page-heading")).toHaveText("Research notebook");
  expect((await adminState(page)).kept).toEqual(["draft"]);
  await tagPage(page);
  await trash.release();
  await expect(tagged(page)).toHaveCount(1);
  await expect(page).toHaveURL(/#\/research\/notebook$/);
  expect(await adminState(page)).toMatchObject({ unsaved: false, kept: [] });
  expect(await page.evaluate(() => document.querySelector("ob-admin").workspaceDraft)).toBeNull();
});

test("a draft that reaches the trash while the next page loads leaves the address on that page", async ({ page }) => {
  await signIn(page);
  const trash = await startHeldTrash(page, "trash-while-loading");
  const list = await holdNextPage(page);
  await moveTo(page, "#/pages");
  await list.asked;
  await trash.release();
  await expect(page).toHaveURL(/#\/pages$/);
  await list.release();
  await expect.poll(() => openRoute(page)).toBe("pages");
  await expect(page).toHaveURL(/#\/pages$/);
});

test("a draft that reaches the trash while she stays on it opens the list", async ({ page }) => {
  await signIn(page);
  const trash = await startHeldTrash(page, "trash-and-stay");
  await trash.release();
  await expect(page).toHaveURL(/#\/posts$/);
  await expect.poll(() => openRoute(page)).toBe("posts");
  expect(await adminState(page)).toMatchObject({ editor: false, unsaved: false, hash: "#/posts" });
});

const SIGNED_OUT = { status: 401, contentType: "application/json", body: '{"error":"Sign in again."}' };

test("a session that ends on a page she left still keeps the draft she moved on to", async ({ page }) => {
  await signIn(page);
  const ended = await holdRequests(page, "**/admin/api/social/**", { answer: SIGNED_OUT });
  await moveTo(page, "#/announcements");
  await ended.asked;
  await typeNewDraft(page, "Soup Saturday");
  await ended.release();
  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toBeVisible();
  expect(await adminState(page)).toMatchObject({ editor: false, kept: ["draft"] });

  await username.fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup Saturday");
  expect(await adminState(page)).toEqual({ editor: true, unsaved: true, view: true, kept: [], hash: "#/new/posts" });
});

test("a second page learning the session ended does not redraw the sign-in form she is filling in", async ({ page }) => {
  await signIn(page);
  const first = await holdRequests(page, "**/admin/api/social/**", { answer: SIGNED_OUT });
  await moveTo(page, "#/announcements");
  await first.asked;
  const second = await holdRequests(page, "**/admin/api/documents?kind=services", { answer: SIGNED_OUT });
  await moveTo(page, "#/services");
  await second.asked;
  await typeNewDraft(page, "Soup Sunday");
  await first.release();
  const username = page.getByLabel("Username", { exact: true });
  await username.fill("writer");
  await second.release();
  await expect(username).toHaveValue("writer");
  expect((await adminState(page)).kept).toEqual(["draft"]);
});

test("a session that ends while the next page loads does not keep a draft she agreed to leave", async ({ page }) => {
  await signIn(page);
  await typeNewDraft(page, "Soup given up");
  answerQuestions(page, { accept: true });
  const ended = await holdRequests(page, "**/admin/api/documents**", { answer: SIGNED_OUT });
  await moveTo(page, "#/posts");
  await ended.asked;
  await ended.release();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  expect(await adminState(page)).toMatchObject({ unsaved: false, kept: [] });
  await expect(page.locator("[data-login-kept]")).toHaveCount(0);
});

/** The other things with a first save and a delete of their own, from a new form or a stored file. */
const OWN_EDITORS = {
  "reading path": {
    list: "#/paths",
    request: "**/admin/api/reading-paths",
    save: "Save reading path",
    newHash: "#/paths/new",
    async fill(page, slug) {
      await page.getByLabel("Title (required)").fill("A first tour");
      await page.getByLabel("Address name").fill(slug);
      const picker = page.getByLabel("Post or atlas entry", { exact: true });
      for (const label of (await picker.locator("option").allTextContents()).filter((text) => /Garden notes|Walnut notes/.test(text))) {
        await picker.selectOption({ label });
        await page.getByRole("button", { name: "Add step", exact: true }).click();
      }
      await page.locator("#oba-paths-step-1-relationship").selectOption("builds-on");
      for (const why of await page.locator("textarea:visible").all()) {
        if (!(await why.inputValue())) await why.fill("It continues the thread.");
      }
    },
    /** Store one, and return its address. */
    store(slug) {
      mkdirSync(join(siteRoot, "content", "paths"), { recursive: true });
      const steps = [
        { id: "a", target: { kind: "post", slug: "garden" }, transition: { relationship: "next", why: "x" } },
        { id: "b", target: { kind: "post", slug: "walnut" } },
      ];
      writeFileSync(join(siteRoot, "content", "paths", `${slug}.json`), JSON.stringify({ format: "openblog-reading-path", version: 1, title: "Tour", description: "d", steps }, null, 2));
      return `#/paths/edit/${slug}`;
    },
  },
  comparison: {
    list: "#/comparisons",
    request: "**/admin/api/comparisons",
    save: "Save comparison",
    newHash: "#/comparisons/new",
    async fill(page, slug) {
      await page.getByLabel("Title (required)", { exact: true }).fill("The cave");
      await page.getByLabel("Address name", { exact: true }).fill(slug);
      await page.getByLabel("What the readings are about, in neutral words (required)").fill("Readings of the cave image");
      for (const [index, name] of ["A political reading", "An epistemic reading"].entries()) {
        await page.getByRole("button", { name: "Add an interpretation", exact: true }).click();
        const card = page.locator(".oba-cmp-items > ol").first().locator("> li").nth(index);
        await card.getByLabel("Name (required)").fill(name);
        await card.getByLabel("What this reading holds, in your words (required)").fill(`${name} holds something.`);
      }
    },
    store(slug) {
      mkdirSync(join(siteRoot, "content", "comparisons"), { recursive: true });
      const interpretations = ["one", "two"].map((id) => ({ id, attribution: { kind: "named", name: id }, statement: `${id} holds something.` }));
      writeFileSync(join(siteRoot, "content", "comparisons", `${slug}.json`), JSON.stringify({ format: "openblog-interpretation-comparison", version: 1, title: "Cave", subject: "Readings", interpretations }, null, 2));
      return `#/comparisons/edit/${slug}`;
    },
  },
};

async function openOwnEditor(page, hash) {
  await moveTo(page, hash);
  await expect(page.locator('[data-action="save"]')).toBeVisible();
}

for (const [name, kind] of Object.entries(OWN_EDITORS)) {
  const slug = name.replace(" ", "-");

  test(`a first save of a ${name} that finishes while the next page loads leaves the address alone`, async ({ page }) => {
    await signIn(page);
    await openOwnEditor(page, kind.newHash);
    await kind.fill(page, `first-${slug}`);
    const saved = await holdRequests(page, kind.request, { method: "POST" });
    await page.getByRole("button", { name: kind.save, exact: true }).click();
    await saved.asked;
    const list = await holdNextPage(page);
    answerQuestions(page, { accept: true });
    await moveTo(page, "#/posts");
    await list.asked;
    await saved.release();
    await expect(page).toHaveURL(/#\/posts$/);
    await list.release();
    await expect.poll(() => openRoute(page)).toBe("posts");
    await expect(page).toHaveURL(/#\/posts$/);
    expect((await adminState(page)).hash).toBe("#/posts");
  });

  test(`a ${name} that reaches the trash after she left does not pull her off the page she moved to`, async ({ page }) => {
    await signIn(page);
    await openOwnEditor(page, kind.store(`gone-${slug}`));
    const trash = await holdRequests(page, `${kind.request}?slug=*`, { method: "DELETE" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-action="delete"]').click();
    await trash.asked;
    await moveTo(page, "#/social");
    await expect(socialHeading(page)).toBeVisible();
    await tagPage(page);
    await trash.release();
    await expectStillOnSocial(page);
  });

  test(`a ${name} that reaches the trash while the next page loads leaves the address on that page`, async ({ page }) => {
    await signIn(page);
    await openOwnEditor(page, kind.store(`going-${slug}`));
    const trash = await holdRequests(page, `${kind.request}?slug=*`, { method: "DELETE" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-action="delete"]').click();
    await trash.asked;
    const list = await holdNextPage(page);
    await moveTo(page, "#/posts");
    await list.asked;
    await trash.release();
    await expect(page).toHaveURL(/#\/posts$/);
    await list.release();
    await expect.poll(() => openRoute(page)).toBe("posts");
  });

  test(`a ${name} that reaches the trash while she stays on it opens the list`, async ({ page }) => {
    await signIn(page);
    await openOwnEditor(page, kind.store(`stay-${slug}`));
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('[data-action="delete"]').click();
    await expect(page).toHaveURL(new RegExp(`${kind.list}$`));
  });
}

async function fillService(page, title) {
  await moveTo(page, "#/services/new");
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByLabel("Summary", { exact: true }).fill("Solid oak or maple floors, nailed and finished on site.");
}

test("a first save of a service that finishes while the next page loads leaves the address alone", async ({ page }) => {
  await signIn(page);
  await fillService(page, "Hardwood installation");
  const saved = await holdRequests(page, "**/admin/api/document", { method: "POST" });
  await page.getByRole("button", { name: "Save service" }).click();
  await saved.asked;
  const list = await holdNextPage(page);
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/posts");
  await list.asked;
  await saved.release();
  await expect(page).toHaveURL(/#\/posts$/);
  await list.release();
  await expect.poll(() => openRoute(page)).toBe("posts");
  await expect(page).toHaveURL(/#\/posts$/);
  expect((await adminState(page)).hash).toBe("#/posts");
});

test("a first save of a service while she stays takes its address, and a delete while the next page loads does not", async ({ page }) => {
  await signIn(page);
  await fillService(page, "Tile repair");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page).toHaveURL(/#\/services\/edit\//);
  await expect.poll(() => adminState(page).then((state) => state.hash)).toMatch(/^#\/services\/edit\//);

  await page.locator('[data-action="service-delete"]').click();
  const trash = await holdRequests(page, "**/admin/api/document?path=*", { method: "DELETE" });
  await page.locator('[data-action="service-delete-yes"]').click();
  await trash.asked;
  const list = await holdNextPage(page);
  await moveTo(page, "#/posts");
  await list.asked;
  await trash.release();
  await expect(page).toHaveURL(/#\/posts$/);
  await list.release();
  await expect.poll(() => openRoute(page)).toBe("posts");
  await expect(page).toHaveURL(/#\/posts$/);
});

test("a save she starts while the next page loads leaves the address on that page", async ({ page }) => {
  await signIn(page);
  await typeNewDraft(page, "Soup Friday");
  const list = await holdNextPage(page);
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/posts");
  await list.asked;
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/admin/api/document"));
  await page.keyboard.press("Control+s");
  await saved;
  await page.evaluate(() => new Promise((done) => setTimeout(done, 300)));
  await expect(page).toHaveURL(/#\/posts$/);
  await list.release();
  await expect.poll(() => openRoute(page)).toBe("posts");
  await expect(page).toHaveURL(/#\/posts$/);
  expect(await adminState(page)).toMatchObject({ editor: false, hash: "#/posts" });
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

// Views that draw at once and then load into what they drew. Capture belongs here too, but it only
// waits on the server with a queued record to send, so holding answers does not hold it.
for (const slow of ["#/announcements", "#/business", "#/reminders", "#/distribution", "#/services", "#/reviews", "#/voice", "#/research/public"]) {
  test(`${slow} is the open page from when it draws, not when it finishes loading`, async ({ page }) => {
    await signIn(page);
    await expect(socialHeading(page)).toBeVisible();
    const answers = await holdAnswers(page);
    await moveTo(page, slow);
    await expect.poll(() => adminState(page).then((state) => state.hash)).toBe(slow);
    await answers.release();
  });
}

test("a page that loads first is not the open page until it draws", async ({ page }) => {
  await signIn(page);
  await expect(socialHeading(page)).toBeVisible();
  const answers = await holdAnswers(page);
  await moveTo(page, "#/posts");
  await expect.poll(() => answers.held.length).toBeGreaterThan(0);
  expect((await adminState(page)).hash).toBe("#/social");
  await answers.release();
  await expect.poll(() => adminState(page).then((state) => state.hash)).toBe("#/posts");
});

/** Open Announcements with what it loads held, and start a caption while it waits. */
async function typeCaptionWhileLoading(page) {
  await signIn(page);
  await expect(socialHeading(page)).toBeVisible();
  const loading = await holdRequests(page, /\/admin\/api\/social\/(destinations|posts|announcements)/);
  await moveTo(page, "#/announcements");
  await loading.asked;
  const caption = page.locator("textarea").first();
  await caption.fill("Soup night is on");
  await expect.poll(() => adminState(page).then((state) => state.view)).toBe(true);
  return { caption, loading };
}

test("going back from a page still loading asks about what she typed there", async ({ page }) => {
  const { caption, loading } = await typeCaptionWhileLoading(page);
  const asked = answerQuestions(page, { accept: false });
  await page.evaluate(() => { location.hash = "#/social"; });
  await expect.poll(() => asked.length).toBe(1);
  await expect(page).toHaveURL(/#\/announcements$/);
  await expect(caption).toHaveValue("Soup night is on");
  await loading.release();
  await expect(caption).toHaveValue("Soup night is on");
});

test("staying on a page still loading keeps its address, and she can still leave it", async ({ page }) => {
  const { caption, loading } = await typeCaptionWhileLoading(page);
  const answer = { accept: false };
  const asked = answerQuestions(page, answer);
  await page.evaluate(() => { location.hash = "#/posts"; });
  await expect.poll(() => asked.length).toBe(1);
  await expect(page).toHaveURL(/#\/announcements$/);
  await expect(caption).toHaveValue("Soup night is on");
  expect((await adminState(page)).hash).toBe("#/announcements");

  await loading.release();
  await expect(caption).toHaveValue("Soup night is on");
  answer.accept = true;
  await moveTo(page, "#/social");
  await expect(socialHeading(page)).toBeVisible();
  expect(asked).toHaveLength(2);
});

/** Views that draw first, with what they load held and then refused: Admin learns late that the session ended. */
const REFUSED_LATE = {
  "#/announcements": /\/admin\/api\/social\/(destinations|posts|announcements)/,
  "#/research/public": "**/admin/api/research/boundary",
};

for (const [slow, requests] of Object.entries(REFUSED_LATE)) {
  test(`a refusal from ${slow} from before she signed in again leaves her new session alone`, async ({ page, context }) => {
    await signIn(page);
    await expect(socialHeading(page)).toBeVisible();
    const refused = await holdRequests(page, requests, { answer: SIGNED_OUT });
    await moveTo(page, slow);
    await refused.asked;
    await context.clearCookies();
    await moveTo(page, "#/overview");
    const username = page.getByLabel("Username", { exact: true });
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator(".oba-overview-metrics")).toBeVisible();
    await tagPage(page);

    await refused.release();
    await expect(tagged(page)).toHaveCount(1);
    await expect(username).toHaveCount(0);
    await expect(page.locator('[data-action="logout"]')).toBeVisible();
  });

  test(`a refusal from ${slow} does not redraw the sign-in form she is filling in`, async ({ page, context }) => {
    await signIn(page);
    await expect(socialHeading(page)).toBeVisible();
    const refused = await holdRequests(page, requests, { answer: SIGNED_OUT });
    await moveTo(page, slow);
    await refused.asked;
    await context.clearCookies();
    await moveTo(page, "#/overview");
    const username = page.getByLabel("Username", { exact: true });
    await username.fill("writer");
    await refused.release();
    await expect(username).toHaveValue("writer");
  });
}

const draftWayBack = (page) => page.evaluate(() => document.querySelector("ob-admin").workspaceDraft?.hash);

test("a first save that finishes while the next page loads gives the way back the saved address", async ({ page }) => {
  await signIn(page);
  const finishSave = await startHeldSave(page, "Soup way back midway");
  const notebook = await holdRequests(page, "**/admin/api/research/notebook");
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/research/notebook");
  await notebook.asked;
  await finishSave();
  await notebook.release();
  await expect(page.locator("#oba-page-heading")).toHaveText("Research notebook");
  expect(await draftWayBack(page)).toMatch(/^#\/edit\//);
  await moveTo(page, await draftWayBack(page));
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup way back midway");
});

test("a first save that finishes after the next page drew gives the way back the saved address", async ({ page }) => {
  await signIn(page);
  const finishSave = await startHeldSave(page, "Soup way back late");
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/research/notebook");
  await expect(page.locator("#oba-page-heading")).toHaveText("Research notebook");
  await finishSave();
  expect(await draftWayBack(page)).toMatch(/^#\/edit\//);
  await moveTo(page, await draftWayBack(page));
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Soup way back late");
});

test("a late first save leaves the way back to the newer draft she started alone", async ({ page }) => {
  await signIn(page);
  const finishSave = await startHeldSave(page, "Soup left behind");
  answerQuestions(page, { accept: true });
  await moveTo(page, "#/social");
  await expect(socialHeading(page)).toBeVisible();
  await typeNewDraft(page, "Soup started after");
  await tagPage(page);
  await finishSave();
  await expect(tagged(page)).toHaveCount(1);
  expect(await draftWayBack(page)).toBe("#/new/posts");
  await expect(page).toHaveURL(/#\/new\/posts$/);
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

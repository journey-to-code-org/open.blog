import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Shaping what you write together (Studio R14b), against a real server, ported from the old
// Admin's shared-moments and shared-series specs: the layout (a turn moved with the keyboard, saved,
// undone), whose agreement counts (asked once, undone), a new collection and the reading order,
// what we say together (added, agreed, moved), moments (a time with words said there, which need
// their rights), filling in from a link that can't be looked up, and the sign-ins of people
// writing with her. Each sheet passes axe at 320 px with nothing sideways.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const leePassword = randomBytes(24).toString("hex");
let dir;
let child;
let origin;
let id = "";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-shape-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Ann Owner" };
  config.contributors = { "ann-owner": { name: "Ann Owner" }, lee: { name: "Lee Park" } };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  execFileSync(binary, ["user", "add", "ann", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  execFileSync(binary, ["user", "add", "lee", "--co-writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: leePassword }, stdio: "pipe" });
  expect(execFileSync(binary, ["user", "list", "--root", dir]).toString()).toContain("lee  (co-writer)");
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  let output = "";
  child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe" });
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

async function open(page, hash, user = "ann", secret = password) {
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill(user);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(secret);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function axeClean(page, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${label}: nothing sideways`).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

const api = (page, method, path, body) => page.evaluate(async ({ method, path, body }) => {
  const csrf = (await (await fetch("/admin/api/session")).json()).csrf;
  const response = await fetch(`/admin/api/${path}`, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
}, { method, path, body });

const status = (page) => page.locator("side-sheet .studio-did, .studio-together-talk .studio-did").first();

test("a reflection with two writers, set up through the API", async ({ page, browser }) => {
  await open(page, "#/together");
  const made = await api(page, "POST", "collaboration/publications", { title: "What we noticed", guidingQuestion: "What changed?", contributorId: "ann-owner", revealPolicy: "voluntary",
    sources: [{ kind: "video", title: "How to Listen", url: "https://example.org/listen" }, { kind: "book", title: "A book we read" }] });
  expect(made.status).toBe(201);
  id = made.body.publication.publicationId;
  const invited = await api(page, "POST", "collaboration/invitations", { publicationId: id, adminUser: "lee", contributorId: "lee", roles: ["contributor"] });
  expect(invited.status).toBe(201);
  const context = await browser.newContext({ serviceWorkers: "block" });
  const lee = await context.newPage();
  await open(lee, "#/together", "lee", leePassword);
  expect((await api(lee, "POST", "collaboration/invitations/accept", { token: invited.body.token, contributorId: "lee" })).status).toBe(200);
  expect((await api(lee, "PUT", "collaboration/draft", { publicationId: id, expectedRevision: 0, markdown: "Lee's words." })).status).toBe(200);
  await context.close();
  expect((await api(page, "PUT", "collaboration/draft", { publicationId: id, expectedRevision: 0, markdown: "Ann's words." })).status).toBe(200);
});

test("the layout: one of five, a turn moved with the keyboard, saved, and undone", async ({ page }) => {
  await open(page, `#/together/${id}?sheet=layout`);
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "Layout of What we noticed" }) });
  await expect(sheet.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(sheet.locator(".studio-together-turn")).toHaveCount(2);
  await expect(sheet.locator(".studio-together-turn").first()).toContainText("Ann Owner, part 1");
  await sheet.getByRole("radio", { name: /^Back and forth/ }).click();
  await sheet.getByRole("button", { name: "Move Lee Park, part 1 up" }).focus();
  await page.keyboard.press("Enter");
  await expect(sheet.locator(".studio-together-turn").first()).toContainText("Lee Park, part 1");
  await sheet.locator(".studio-together-turn").first().getByRole("button", { name: /^Move Lee Park/ }).first().focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(sheet.locator(".studio-together-turn").first()).toContainText("Ann Owner, part 1");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(sheet.locator(".studio-together-turn").first()).toContainText("Lee Park, part 1");
  await axeClean(page, "Layout");
  await sheet.getByRole("button", { name: "Save the layout" }).click();
  await expect(status(page)).toContainText("Layout saved. Everyone agrees again to the new layout.");
  const saved = await api(page, "GET", `collaboration/reflection?publicationId=${id}`);
  expect(saved.body.structure.layout).toBe("alternatingDialogue");
  expect(saved.body.structure.rounds[0].turns.map((t) => t.draft)).toEqual(["participant-2", "participant-1"]);
  await status(page).getByRole("button", { name: "Undo" }).click();
  await expect(sheet.locator(".studio-together-turn").first()).toContainText("Ann Owner, part 1");
  const undone = await api(page, "GET", `collaboration/reflection?publicationId=${id}`);
  expect(undone.body.structure.layout).toBe("sequential");
});

test("whose agreement counts: asked once, suggested, and changed once everyone agrees", async ({ page, browser }) => {
  await open(page, `#/together/${id}`);
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Rules" }).click();
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "Rules for What we noticed" }) });
  const before = (await api(page, "GET", `collaboration/approval-policy?publicationId=${id}`)).body.policy;
  // A new reflection is agreed as a whole (#650): "their own part" isn't offered.
  await expect(sheet.getByText("Each person agrees to the whole thing, so any change asks everyone again.")).toBeVisible();
  await expect(sheet.getByRole("radio", { name: /^Their own part/ })).toHaveCount(0);
  await sheet.getByRole("radio", { name: /^Everyone who wrote, and people you choose/ }).click();
  await sheet.getByRole("button", { name: "Save the rules" }).click();
  await expect(status(page)).toContainText("Choose at least one person who agrees.");
  await sheet.getByRole("checkbox", { name: "Lee Park" }).check();
  await axeClean(page, "Rules");
  await sheet.getByRole("button", { name: "Save the rules" }).click();
  await page.getByRole("dialog", { name: "Change whose agreement counts?" }).getByRole("button", { name: "Change it" }).click();
  // A change is a suggestion until everyone taking part agrees to it; nothing changed yet.
  await expect(status(page)).toContainText("Suggested. It changes once everyone taking part agrees to it.");
  expect((await api(page, "GET", `collaboration/approval-policy?publicationId=${id}`)).body.policy).toEqual(before);
  await expect(sheet.getByText("Suggested: Everyone who wrote, and people you choose.")).toBeVisible();
  await expect(sheet.getByText("Waiting for Ann Owner and Lee Park to agree to it.")).toBeVisible();
  await sheet.getByRole("button", { name: "Agree to this rule" }).click();
  await expect(status(page)).toContainText("You agreed to the new rule.");
  await status(page).getByRole("button", { name: "Undo" }).click();
  await expect(status(page)).toContainText("You took back your agreement to the new rule.");
  await sheet.getByRole("button", { name: "Agree to this rule" }).click();
  await expect(sheet.getByText("Waiting for Lee Park to agree to it.")).toBeVisible();
  await expect(sheet.getByText("You agreed to it.")).toBeVisible();

  // Lee doesn't run it, but is asked: the reflection says so, and the rule opens from there.
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const lee = await context.newPage();
  await open(lee, `#/together/${id}`, "lee", leePassword);
  await expect(lee.getByText("A new rule was suggested")).toBeVisible();
  await lee.getByRole("button", { name: "See the rule" }).click();
  const leeSheet = lee.locator("side-sheet").filter({ has: lee.getByRole("heading", { name: "Rules for What we noticed" }) });
  await expect(leeSheet.getByRole("button", { name: "Save the rules" })).toHaveCount(0);
  await axeClean(lee, "Rules, as someone who is asked");
  await leeSheet.getByRole("button", { name: "Agree to this rule" }).click();
  await expect(lee.locator("side-sheet .studio-did").first()).toContainText("Everyone agreed, so the new rule is in place.");
  await context.close();
  expect((await api(page, "GET", `collaboration/approval-policy?publicationId=${id}`)).body.policy.requirement).toEqual({ namedAuthors: ["participant-2"] });
});

test("a new collection, the reading order, and a place in it", async ({ page }) => {
  await open(page, `#/together/${id}?sheet=collection`);
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "Collection for What we noticed" }) });
  await sheet.locator("summary", { hasText: "Make a new collection" }).click();
  await sheet.getByRole("textbox", { name: "Its name" }).fill("Letters home");
  await sheet.getByRole("button", { name: "Make a new collection" }).click();
  await expect(status(page)).toContainText("Made.");
  await sheet.getByRole("combobox", { name: "Which collection" }).selectOption("letters-home");
  await sheet.getByRole("textbox", { name: "Its place in the collection" }).fill("two");
  await sheet.getByRole("button", { name: "Save the collection" }).click();
  await expect(sheet.getByText("Use a whole number of 0 or more, or leave it empty.")).toBeVisible();
  await sheet.getByRole("textbox", { name: "Its place in the collection" }).fill("2");
  await sheet.getByRole("button", { name: "See the order" }).click();
  await expect(sheet.getByText("1. This one (not on your blog yet, number 2)")).toBeVisible();
  await axeClean(page, "Collection");
  await sheet.getByRole("button", { name: "Save the collection" }).click();
  await expect(status(page)).toContainText("Saved. Everyone agrees again to where it goes.");
  await expect(sheet.getByText("Letters home, number 2", { exact: true })).toBeVisible();
});

test("what we say together: added, agreed, moved; the words are text", async ({ page }) => {
  await open(page, `#/together/${id}/together`);
  await expect(page.getByRole("heading", { name: "What we say together", level: 2 })).toBeVisible();
  await expect(page.getByText("Nothing said together yet. It's optional.")).toBeVisible();
  await page.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByText("Write what you say together.")).toBeVisible();
  await page.getByRole("textbox", { name: "The words" }).fill("We both <b>slowed</b> down.");
  await page.getByRole("button", { name: "Add it" }).click();
  await expect(page.locator(".studio-did")).toContainText("Added.");
  await page.getByRole("radio", { name: /^Question/ }).click();
  await page.getByRole("button", { name: "Use this question" }).click();
  await page.getByRole("checkbox", { name: "Lee Park" }).check();
  await page.getByRole("button", { name: "Add it" }).click();
  await expect(page.locator(".studio-together-item")).toHaveCount(2);
  const first = page.locator(".studio-together-item").first();
  await expect(first).toContainText("We both <b>slowed</b> down.");
  expect(await first.locator("b").count()).toBe(0);
  await expect(page.locator(".studio-together-item").nth(1)).toContainText("Question, for Ann Owner and Lee Park.");
  await page.locator(".studio-together-item").nth(1).getByRole("button", { name: "Move up" }).click();
  await expect(page.locator(".studio-together-item").first()).toContainText("What are we still wondering about?");
  await page.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-together-item").first()).toContainText("We both");
  await axeClean(page, "What we say together");
});

test("a moment: a time, the words said there with their rights, kept with her part", async ({ page }) => {
  await open(page, `#/together/${id}/write?sheet=moments`);
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "Moments in what started it" }) });
  await expect(sheet.getByText("No moments yet.")).toBeVisible();
  await sheet.getByRole("textbox", { name: "From" }).fill("1:2");
  await sheet.getByRole("button", { name: "Save the moment" }).click();
  await expect(sheet.getByText("Write the time as seconds or h:mm:ss, like 75 or 1:02:03.")).toBeVisible();
  await sheet.getByRole("textbox", { name: "From" }).fill("1:02");
  await sheet.getByRole("textbox", { name: "The words said there (optional)" }).fill("Listen first.");
  await sheet.getByRole("button", { name: "Save the moment" }).click();
  await expect(sheet.getByText("Say what rights apply to the words.", { exact: false }).first()).toBeVisible();
  await sheet.getByRole("combobox", { name: "Rights" }).selectOption("briefQuotation");
  await expect(sheet.getByText("No one is named", { exact: false }).or(sheet.getByText(/doesn't check it/)).first()).toBeVisible();
  await sheet.getByRole("combobox", { name: "Where the words came from" }).selectOption("transcribed");
  await sheet.getByRole("textbox", { name: "Who said it" }).fill("The host");
  await sheet.getByRole("switch", { name: "Put it with my part" }).click();
  await sheet.getByRole("button", { name: "Save the moment" }).click();
  await expect(status(page)).toContainText("Saved. It goes with your part when you let the others read it");
  await expect(sheet.locator(".studio-together-item").first()).toContainText("How to Listen, at 1:02. Goes with your part.");
  await axeClean(page, "Moments");
  await sheet.getByRole("button", { name: /^Take out the moment at/ }).click();
  await expect(status(page)).toContainText("Taken out.");
  await status(page).getByRole("button", { name: "Undo" }).click();
  await expect(sheet.locator(".studio-together-item")).toHaveCount(1);
});

test("filling in from a link that can't be looked up says so and changes nothing", async ({ page }) => {
  await open(page, "#/together/new");
  await page.getByRole("textbox", { name: "Link, if it has one" }).fill("https://example.org/a-page");
  await page.getByRole("button", { name: "Fill in from the link" }).click();
  await expect(page.getByText("Details can only be found for some video and code sites. Type them yourself.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What it's called" })).toHaveValue("");
});

test("the sign-ins of people writing with her: listed in People's details, removed when asked", async ({ page }) => {
  await open(page, `#/together/${id}?sheet=people`);
  const sheet = page.locator("side-sheet").filter({ has: page.getByRole("heading", { name: "People in What we noticed" }) });
  await sheet.getByText("Sign-ins for people writing with you").click();
  await expect(sheet.getByText("lee: in What we noticed")).toBeVisible();
  await axeClean(page, "People with sign-ins");
  await sheet.getByRole("button", { name: "Remove lee's sign-in" }).click();
  await page.getByRole("dialog", { name: "Remove lee's sign-in?" }).getByRole("button", { name: "Remove it" }).click();
  await expect(sheet.locator(".studio-did")).toContainText("Removed the sign-in lee.");
  expect(execFileSync(binary, ["user", "list", "--root", dir]).toString()).not.toContain("lee");
});

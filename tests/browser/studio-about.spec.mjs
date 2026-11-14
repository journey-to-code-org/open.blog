import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// About this post (Studio R5), ported from the old Admin's settings, profiles and credits checks
// and grown: one sheet of the little things with no Save of its own; a summary-only change on a
// published post rewrites one line under the name the post uses; the line under the title clears
// its older names; who wrote it is sent only when it changed, with its etag; a credit file that
// can't be read doesn't stop the title saving; the address is editable only while a post was
// never on the site; a future day with no time is 8 AM her time; the kind changes with Undo on
// the sheet; Find and ?sheet=about open it; axe at 320 px with nothing sideways. Grammi's recipe site.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let dir;
let child;
let origin;

const BREAD = "---\ntitle: Pumpkin bread\ndate: 2026-10-01\nprofile: recipe\nprep: 15 min\nsummary: Moist and spiced.\ndek: From my mother\n---\n\nMy mother's bread.\n\n## Ingredients\n\n- 1 can pumpkin\n\n## Steps\n\n1. Bake it.\n";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block", timezoneId: "America/New_York" });

const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString();

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-about-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Grammi", url: "https://grammishouse.example" };
  config.contributors = { ruth: { name: "Ruth Nichols", url: "https://ruthbakes.example" }, ann: { name: "Ann" } };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(join(dir, "content", "posts", "2026-10-01-pumpkin-bread.md"), BREAD);
  writeFileSync(join(dir, "content", "posts", "2020-01-01-old-pie.md"), "---\ntitle: Old pie\ndate: 2020-01-01\nrecipe: true\n---\n\nPie.\n");
  // In Git, so the server can tell a post that was never on the site (G38).
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  execFileSync(binary, ["user", "add", "grammi", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
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

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
});

async function open(page, hash) {
  // Always a fresh load, even of the address the page is on.
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("grammi");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function openPost(page, file, text) {
  if (text !== undefined) writeFileSync(join(dir, "content", "posts", file), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${file}`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  // Loaded: the status and the About this post line are painted once the post is in.
  await expect(status(page)).not.toHaveText("");
}

const fileOf = (file) => readFileSync(join(dir, "content", "posts", file), "utf8");
const status = (page) => page.locator(".studio-write > [role=status]");
const sheet = (page) => page.locator("side-sheet.studio-about-sheet").first();
const aboutButton = (page) => page.getByRole("button", { name: /^About this post:/ });

async function axeClean(page, label, root = "#studio-main") {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

test("a summary-only change on a published post rewrites one line, under the name the post uses", async ({ page }) => {
  const file = "2026-10-01-pumpkin-bread.md";
  writeFileSync(join(dir, "content", "posts", file), BREAD);
  await openPost(page, file);
  await expect(aboutButton(page)).toContainText("A recipe · Summary set · By Grammi");
  await aboutButton(page).click();
  await expect(sheet(page).getByRole("heading", { name: "About this post" })).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: "A recipe" })).toBeChecked();
  // Grammi's site has no Job choice, and the sheet never shows a job's facts.
  await expect(sheet(page).getByRole("radio", { name: "A job" })).toHaveCount(0);
  await expect(sheet(page).locator("[data-about^='job.']")).toHaveCount(0);
  const summary = sheet(page).getByRole("textbox", { name: "Summary" });
  await expect(summary).toHaveValue("Moist and spiced.");
  await expect(sheet(page).locator(".studio-about-card-summary")).toHaveText("Moist and spiced.");
  await summary.fill("Moist, spiced and easy.");
  await expect(sheet(page).locator(".studio-about-card-summary")).toHaveText("Moist, spiced and easy.");
  await expect(sheet(page).getByText("Press Update to put these on your site.")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(aboutButton(page)).toBeFocused();
  await expect(status(page)).toHaveText("Changed · not on your site yet. Press Update to put them up.");
  await expect(aboutButton(page)).toContainText("Changes not on your site yet");
  expect(fileOf(file), "nothing reaches the site before Update").toBe(BREAD);
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(status(page)).toContainText("Published");
  expect(fileOf(file)).toBe(BREAD.replace("summary: Moist and spiced.", "summary: Moist, spiced and easy."));
});

test("the line under the title is written as subtitle and its older names go; credits are sent only when changed", async ({ page }) => {
  const file = "2026-10-02-cornbread.md";
  const text = "---\ntitle: Cornbread\ndate: 2026-10-02\ndraft: true\nsubheading: Skillet style\n---\n\nHot skillet.\n";
  await openPost(page, file, text);
  const bodies = [];
  page.on("request", (request) => { if (request.method() === "PUT" && request.url().includes("/api/document")) bodies.push(request.postDataJSON()); });
  // A title change: the credit file is never touched.
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Skillet cornbread");
  await expect(status(page)).toHaveText(/Draft · saved/, { timeout: 10000 });
  expect(bodies.at(-1).credits, "no credits key on a title change").toBeUndefined();
  expect("creditEtag" in bodies.at(-1)).toBe(false);
  await aboutButton(page).click();
  const line = sheet(page).getByRole("textbox", { name: "A line under the title" });
  await expect(line).toHaveValue("Skillet style");
  await line.fill("Skillet style, with honey");
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveText(/Draft · saved/, { timeout: 10000 });
  const saved = fileOf(file);
  expect(saved).toContain("subtitle: Skillet style, with honey");
  expect(saved).not.toContain("subheading:");
  expect(bodies.at(-1).credits).toBeUndefined();
});

test("who wrote it: change, add, move and Just me, each sent with its etag; a broken credit file doesn't stop the title", async ({ page }) => {
  const file = "2026-10-03-biscuits.md";
  await openPost(page, file, "---\ntitle: Biscuits\ndate: 2026-10-03\ndraft: true\n---\n\nFlaky.\n");
  await aboutButton(page).click();
  const credits = sheet(page).locator(".studio-about-credits");
  await expect(credits.getByText("Grammi", { exact: true })).toBeVisible();
  await expect(credits.getByText("The name your blog uses on every post.")).toBeVisible();
  await credits.getByRole("button", { name: "Change who wrote it" }).click();
  // People come in the registry's order (Ann, then Ruth); each new line is the next one not listed.
  await credits.getByRole("button", { name: "Add someone", exact: true }).click();
  await expect(credits.getByRole("combobox", { name: "Person 1" })).toHaveValue("ann");
  await credits.getByRole("button", { name: "Add someone", exact: true }).click();
  await expect(credits.getByRole("combobox", { name: "Person 2" })).toHaveValue("ruth");
  await expect(credits.getByRole("button", { name: "Add someone", exact: true }), "everyone is listed").toHaveCount(0);
  await credits.getByRole("button", { name: "Move Ruth Nichols up" }).click();
  await expect(sheet(page).getByText("Ruth Nichols is now number 1 of 2.")).toBeAttached();
  await expect(credits.getByRole("combobox", { name: "Person 1" })).toHaveValue("ruth");
  await expect(credits.getByRole("button", { name: "Move Ruth Nichols up" })).toBeDisabled();
  await expect(aboutButton(page)).toContainText("By Ruth Nichols and Ann");
  await page.keyboard.press("Escape");
  const sidecar = join(dir, "content", "posts", "2026-10-03-biscuits.credits.json");
  await expect.poll(() => existsSync(sidecar), { timeout: 10000 }).toBe(true);
  const written = JSON.parse(readFileSync(sidecar, "utf8")).credits;
  expect(written.map((c) => c.contributor)).toEqual(["ruth", "ann"]);
  expect(written[0].roles).toEqual([{ vocabulary: "crossref", role: "author" }]);
  // Just me: back to the blog's usual name, the credit file goes.
  await aboutButton(page).click();
  await credits.getByRole("button", { name: "Change who wrote it" }).click();
  page.removeAllListeners("dialog");
  await credits.getByRole("button", { name: "Just me" }).click();
  await page.getByRole("dialog", { name: "Name only Grammi, as on your other posts?" }).getByRole("button", { name: "Yes" }).click();
  await expect(credits.getByText("The name your blog uses on every post.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => existsSync(sidecar), { timeout: 10000 }).toBe(false);

  // A credit file that can't be read: everything else still saves.
  writeFileSync(sidecar, "{ not json");
  await openPost(page, file);
  await aboutButton(page).click();
  await expect(sheet(page).getByText("Who wrote this post can't be read right now")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Flaky biscuits");
  await expect(status(page)).toHaveText(/Draft · saved/, { timeout: 10000 });
  expect(fileOf(file)).toContain("title: Flaky biscuits");
  expect(readFileSync(sidecar, "utf8")).toBe("{ not json");
});

test("the address is editable only while a post was never on the site", async ({ page }) => {
  // A draft never committed: editable, with what it will be.
  const file = "2026-10-04-gravy.md";
  await openPost(page, file, "---\ntitle: Gravy\ndate: 2026-10-04\ndraft: true\n---\n\nSmooth.\n");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "About this post" }).click();
  await sheet(page).getByText("Details for the person who set up your site").click();
  const address = sheet(page).getByRole("textbox", { name: "Address on your site" });
  await expect(address).toBeEditable();
  await address.fill("Mom's Gravy");
  await expect(sheet(page).getByText(/Will be: .*\/posts\/mom-s-gravy\//)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveText(/Draft · saved/, { timeout: 10000 });
  expect(fileOf(file)).toContain("slug: Mom's Gravy");
  // A published post moved back to a draft keeps its address; so does a draft with a past date
  // that was committed live.
  await openPost(page, "2026-10-01-pumpkin-bread.md");
  await aboutButton(page).click();
  await expect(sheet(page).getByRole("textbox", { name: "Address on your site" })).not.toBeEditable();
  await expect(sheet(page).getByText(/saved links keep working/)).toBeVisible();
  await page.keyboard.press("Escape");
  const committed = "2026-09-01-stew.md";
  writeFileSync(join(dir, "content", "posts", committed), "---\ntitle: Stew\ndate: 2026-09-01\n---\n\nWarm.\n");
  git("add", "-A");
  git("commit", "-q", "-m", "stew");
  writeFileSync(join(dir, "content", "posts", committed), "---\ntitle: Stew\ndate: 2026-09-01\ndraft: true\n---\n\nWarm.\n");
  await openPost(page, committed);
  await aboutButton(page).click();
  await expect(sheet(page).getByRole("textbox", { name: "Address on your site" })).not.toBeEditable();
});

test("a future day with no time goes up at 8 AM her time, and says when it really goes up", async ({ page }) => {
  await open(page, "#/write/new/story");
  await expect(status(page)).toHaveText("New story. Add a title and your draft will save itself.");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Thanksgiving morning");
  const day = page.locator("date-field input").first();
  await day.fill("2099-11-26");
  await day.dispatchEvent("change");
  await expect(page.getByRole("textbox", { name: "Time (your time)" })).toHaveValue("08:00");
  await expect(page.locator("#studio-when-help")).toHaveText("It goes up at 8 AM unless you change the time.");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(status(page)).toHaveText("Scheduled for Thursday, November 26, 2099 at 8 AM", { timeout: 10000 });
  const saved = execFileSync("grep", ["-rl", "Thanksgiving morning", join(dir, "content", "posts")]).toString().trim();
  expect(readFileSync(saved, "utf8")).toContain("date: 2099-11-26T08:00:00-05:00");
  // This server isn't the public site (its address is elsewhere) and nothing sends it out, so the
  // help makes no promise it can't keep (G37).
  await expect(page.locator("#studio-when-help")).toHaveText("It's ready to go up on Thursday, November 26, 2099 at 8 AM. Your blog puts it up the next time it's sent out after that.");
  // Make it a draft again.
  // On a phone, Save draft (here: Make it a draft again) is in More.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Make it a draft again" }).click();
  await expect(page.getByText("It won't go up on Thursday, November 26, 2099. It's a draft again.")).toBeVisible();
  // A time without a day.
  await day.fill("");
  await day.dispatchEvent("change");
  const time = page.getByRole("textbox", { name: "Time (your time)" });
  await time.fill("09:30");
  await expect(page.getByText("Add the day too, or clear the time.").first()).toBeVisible();
});

test("changing the kind keeps her words, offers the recipe parts, and Undo is on the sheet", async ({ page }) => {
  const file = "2026-10-05-letter.md";
  await openPost(page, file, "---\ntitle: A letter\ndate: 2026-10-05\ndraft: true\n---\n\nDear family.\n");
  await expect(page.getByRole("textbox", { name: "Serves" })).toHaveCount(0);
  await aboutButton(page).click();
  await sheet(page).getByRole("radio", { name: "A recipe" }).check();
  await expect(sheet(page).getByText("Your words stay as they are.")).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name: "This recipe" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Serves" })).toBeAttached();
  await sheet(page).getByRole("button", { name: "Undo" }).click();
  await expect(sheet(page).getByRole("radio", { name: "A story" })).toBeChecked();
  await expect(sheet(page).getByRole("heading", { name: "This recipe" })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: "Undo" })).toHaveCount(0);
  // A legacy recipe shows as a recipe; changing it writes profile: article and keeps the rest.
  await openPost(page, "2020-01-01-old-pie.md");
  await aboutButton(page).click();
  await expect(sheet(page).getByRole("radio", { name: "A recipe" })).toBeChecked();
  await sheet(page).getByRole("radio", { name: "A story" }).check();
  await expect(sheet(page).getByText(/numbers are kept if you change back/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect.poll(() => fileOf("2020-01-01-old-pie.md")).toContain("profile: article");
  expect(fileOf("2020-01-01-old-pie.md")).toContain("recipe: true");
});

test("a check stops the save and says where; Go to it opens the field", async ({ page }) => {
  const file = "2026-10-06-jam.md";
  await openPost(page, file, "---\ntitle: Jam\ndate: 2026-10-06\ndraft: true\nprofile: recipe\n---\n\nSweet.\n");
  await aboutButton(page).click();
  await sheet(page).getByRole("textbox", { name: "Where you found it" }).fill("Aunt Ruth");
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(status(page)).toContainText("Not saved yet: one thing in About this post needs a look.", { timeout: 10000 });
  await status(page).getByRole("button", { name: "Go to it" }).click();
  const found = sheet(page).getByRole("textbox", { name: "Where you found it" });
  await expect(found).toBeFocused();
  await expect(sheet(page).getByText("That needs to be a web address, starting with https://. To thank a person, say so in your words.")).toBeVisible();
  expect(fileOf(file)).not.toContain("adaptedFrom");
  await found.fill("https://example.com/jam");
  await page.keyboard.press("Escape");
  await expect(status(page)).toHaveText(/Draft · saved/, { timeout: 10000 });
  expect(fileOf(file)).toContain("adaptedFrom: https://example.com/jam");
});

test("Find opens the sheet at its groups, and closing a linked sheet takes the query off", async ({ page }) => {
  await open(page, `#/write/${encodeURIComponent("posts/2026-10-01-pumpkin-bread.md")}?sheet=about`);
  await expect(sheet(page).getByRole("heading", { name: "About this post" })).toBeVisible();
  await sheet(page).getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(/#\/write\/posts%2F2026-10-01-pumpkin-bread\.md$/);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Summary for search");
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("textbox", { name: "Summary" })).toBeFocused();
  await page.keyboard.press("Escape");
});

test("Write and About this post pass axe at 320 px with nothing sideways", async ({ page }) => {
  await openPost(page, "2026-10-01-pumpkin-bread.md");
  await axeClean(page, "Write");
  await aboutButton(page).click();
  await sheet(page).getByText("Details for the person who set up your site").click();
  await expect(sheet(page).getByRole("textbox", { name: "Address on your site" })).toBeVisible();
  await axeClean(page, "About this post");
  await page.setViewportSize({ width: 320, height: 800 });
  const sideways = await page.evaluate(() => {
    const body = document.querySelector("side-sheet.studio-about-sheet .sheet-body");
    return body ? body.scrollWidth > body.clientWidth : true;
  });
  expect(sideways, "the sheet doesn't scroll sideways").toBe(false);
});

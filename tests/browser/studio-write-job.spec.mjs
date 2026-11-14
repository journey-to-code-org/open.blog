import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// A job in Write (Studio R4), ported from job-mode.spec.mjs and grown: "A job" from What are you
// writing?, About this job writing the same keys, the four parts kept byte for byte, Before and After
// on each photo, the job check on Publish, the voice note a phone sent (G30) turned into words, and
// Write it up for me asking first. A roofing site at 400 px; axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const SCAFFOLD = "## Problem\n\n## What we found\n\n## What we did\n\n## Result\n\n";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg==", "base64");
let dir;
let child;
let origin;

// The worker keeps Studio's files since R4 (G35); a page it controls sends its requests past page.route,
// so the stand-ins here would be skipped. These tests don't need it.
test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-write-job-"));
  execFileSync(binary, ["init", dir, "--starter", "trade", "--trade", "roofing", "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "content", "services"), { recursive: true });
  writeFileSync(join(dir, "content", "services", "roof-repair.md"), "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks found and fixed.\n---\nWe fix leaks.\n");
  mkdirSync(join(dir, "static", "images", "uploads", "2026"), { recursive: true });
  for (const name of ["before.png", "after.png"]) writeFileSync(join(dir, "static", "images", "uploads", "2026", name), PNG);
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

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
});

async function open(page, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

/** A post written straight to the site, then opened in Write. */
async function openPost(page, name, text) {
  writeFileSync(join(dir, "content", "posts", `${name}.md`), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${name}.md`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
}

const about = (page) => page.locator("[data-job-about]");
const status = (page) => page.locator(".studio-write > [role=status]");
const fileOf = (name) => readFileSync(join(dir, "content", "posts", `${name}.md`), "utf8");
const savedNamed = (part) => readdirSync(join(dir, "content", "posts")).filter((file) => file.includes(part)).map((file) => readFileSync(join(dir, "content", "posts", file), "utf8"));

async function session(page) {
  return page.evaluate(async () => (await (await fetch("/admin/api/session")).json()).csrf);
}

async function axeClean(page, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("#studio-main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

test("A job from What are you writing? starts with today, the four parts, and saves the old Job form's keys", async ({ page }) => {
  await open(page, "#/write");
  await page.getByRole("link", { name: /A job/ }).click();
  await expect(page).toHaveURL(/#\/write\/new\/job$/);
  await expect(status(page)).toHaveText("New job. Add a title and your draft will save itself.");
  await expect(about(page).getByRole("group", { name: "About this job" })).toBeVisible().catch(() => {});
  for (const heading of ["Problem", "What we found", "What we did", "Result"]) await expect(page.getByRole("textbox", { name: heading, exact: true })).toBeVisible();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await expect(about(page).getByLabel("Started", { exact: true })).toHaveValue(today);
  await expect(about(page).getByLabel("Finished", { exact: true })).toHaveValue(today);
  await expect(about(page).getByRole("combobox", { name: "Trade" })).toBeHidden();
  await about(page).getByRole("combobox", { name: "Service" }).selectOption("roof-repair");
  await about(page).getByRole("textbox", { name: "Town" }).fill("Elkins");
  await about(page).getByRole("textbox", { name: "State" }).fill("WV");
  await about(page).getByRole("combobox", { name: "Price shown" }).selectOption("2k-10k");
  await page.getByRole("textbox", { name: "Problem", exact: true }).fill("Leak by the chimney.");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Chimney leak in Elkins");
  await page.keyboard.press("Control+s");
  await expect(page).toHaveURL(/#\/write\/posts%2F/);
  const [source] = savedNamed("chimney-leak-in-elkins");
  expect(source).toMatch(/profile: job/);
  expect(source).toContain("job:\n  costBand: 2k-10k\n");
  expect(source).toMatch(/place:\n    region: WV\n    town: Elkins/);
  expect(source).toMatch(/service: roof-repair/);
  expect(source).toMatch(/trade: roofing/);
  expect(source).toContain(`started: ${today}`);
  expect(source).toContain("## Problem\n\nLeak by the chimney.\n\n## What we found\n\n## What we did\n\n## Result\n");
  await page.reload();
  await expect(about(page).getByRole("textbox", { name: "Town" })).toHaveValue("Elkins");
  await expect(about(page).getByRole("combobox", { name: "Price shown" })).toHaveValue("2k-10k");
  await expect(page.getByRole("textbox", { name: "Problem", exact: true })).toHaveValue("Leak by the chimney.");
  await axeClean(page, "About this job");
  // Posts says which posts are jobs.
  await page.goto(`${origin}/admin/studio/#/posts`);
  await expect(page.locator(".studio-post-row", { hasText: "Chimney leak in Elkins" }).locator("status-badge", { hasText: "Job" })).toBeVisible();
});

test("the four parts come back byte for byte, and any other shape stays one box", async ({ page }) => {
  const odd = "---\ntitle: Odd job\ndate: 2026-10-01\ndraft: true\nprofile: job\njob:\n  trade: roofing\n---\n## Problem\nTight.\n## What we found\n## What we did\n\n\n## Result";
  await openPost(page, "odd-job", odd);
  await expect(page.getByRole("textbox", { name: "Problem", exact: true })).toHaveValue("Tight.");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Odd job.");
  await page.keyboard.press("Control+s");
  await expect(status(page)).toContainText(/Saved|Draft/);
  await expect.poll(() => fileOf("odd-job")).toContain("## Problem\nTight.\n## What we found\n## What we did\n\n\n## Result");

  await openPost(page, "story-job", "---\ntitle: Story job\ndate: 2026-10-01\ndraft: true\nprofile: job\n---\nJust a few lines about the work.\n");
  await expect(page.getByRole("textbox", { name: "Words", exact: true })).toHaveValue(/^Just a few lines about the work\.\n?$/);
  await expect(page.getByRole("textbox", { name: "Problem", exact: true })).toHaveCount(0);
});

test("each photo is marked Before, After or Neither, written in the order they're in the post", async ({ page }) => {
  await openPost(page, "porch", `---\ntitle: Porch roof\ndate: 2026-10-01\ndraft: true\nprofile: job\njob:\n  trade: roofing\n  service: roof-repair\n---\n${SCAFFOLD}![Old porch](/images/uploads/2026/before.png)\n\n![New porch](/images/uploads/2026/after.png)\n`);
  await expect(page.getByText("Mark at least one After photo. It's the one people see when you share the job.")).toBeVisible();
  await page.getByRole("group", { name: "Photo 2 shows" }).getByRole("button", { name: "After" }).click();
  await page.getByRole("group", { name: "Photo 1 shows" }).getByRole("button", { name: "Before" }).click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("porch")).toMatch(/media:\n    after:\n      - \/images\/uploads\/2026\/after\.png\n    before:\n      - \/images\/uploads\/2026\/before\.png/);
  await page.reload();
  await expect(page.getByRole("group", { name: "Photo 2 shows" }).getByRole("button", { name: "After" })).toHaveAttribute("aria-pressed", "true");
  await axeClean(page, "a job with Before and After");
});

test("Publish checks the job first: problems in her words with Go to it, a draft still saves, and fixing it publishes", async ({ page }) => {
  await openPost(page, "gutters", `---\ntitle: Gutters in Beverly\ndate: 2026-10-01\ndraft: true\nprofile: job\njob:\n  trade: roofing\n  service: gutter-guards\n  started: 2026-10-01\n  finished: 2026-10-02\n---\n${SCAFFOLD}`);
  await page.getByRole("button", { name: "Publish" }).click();
  const banner = page.getByRole("alert").filter({ hasText: "Before this job goes on your site" });
  await expect(banner).toContainText("Before this job goes on your site (3)");
  await expect(banner).toContainText("“Gutter guards” isn't one of your services yet. Choose one, or add it under Services first.");
  await expect(banner).toContainText("Add the town.");
  await expect(banner).toContainText("Add the state.");
  await banner.getByRole("button", { name: "Go to it: Add the town." }).click();
  await expect(about(page).getByRole("textbox", { name: "Town" })).toBeFocused();
  await expect(about(page).getByRole("textbox", { name: "Town" })).toHaveAttribute("aria-describedby", /studio-job-problem-/);
  expect(fileOf("gutters")).toMatch(/draft: true/);
  await axeClean(page, "the job check");

  await about(page).getByRole("textbox", { name: "Town" }).fill("Beverly");
  await about(page).getByRole("textbox", { name: "State" }).fill("WV");
  await about(page).getByRole("combobox", { name: "Service" }).selectOption("roof-repair");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => fileOf("gutters")).not.toMatch(/draft: true/);
  await expect(page.getByRole("link", { name: "Share this job" })).toBeVisible();
});

test("a job sent from a phone plays its voice note, and Turn it into words asks first and adds them under Problem", async ({ page }) => {
  await open(page, "#/posts");
  const id = "abcdefabcdefabcdefabcdefabcdef12";
  const path = await page.evaluate(async ({ id, scaffold }) => {
    const { csrf } = await (await fetch("/admin/api/session")).json();
    const note = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(64).fill(7)]);
    await fetch(`/admin/api/capture-audio?capture=${id}`, { method: "POST", headers: { "X-CSRF-Token": csrf, "Content-Type": "application/octet-stream" }, body: note });
    const made = await fetch("/admin/api/document", { method: "POST", headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "posts", captureId: id, fields: { title: "Roof repair in Davis", slug: `roof-repair-in-davis-${id.slice(0, 6)}`, draft: "true", profile: "job", "job.trade": "roofing" }, body: `${scaffold}` }) });
    return (await made.json()).path;
  }, { id, scaffold: SCAFFOLD });
  const sent = [];
  await page.route(/\/admin\/api\/assistant\/transcribe$/, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true, engine: "local", leavesServer: false } });
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { transcript: "Shingles gone by the vent.", truncated: false } });
  });
  await page.goto(`${origin}/admin/studio/#/write/${encodeURIComponent(path)}`);
  await expect(about(page).getByText("Your voice note from the site")).toBeVisible();
  await expect(about(page).locator("audio")).toHaveAttribute("src", `/admin/api/capture-audio?capture=${id}`);
  await about(page).getByRole("button", { name: "Turn it into words" }).click();
  const sheet = page.getByRole("dialog", { name: "Turn your voice note into words" });
  await expect(sheet).toContainText("Your blog turns it into words on its own computer. Nothing leaves it.");
  await sheet.getByRole("button", { name: "Turn it into words" }).click();
  await expect(page.getByRole("textbox", { name: "Problem", exact: true })).toHaveValue("Shingles gone by the vent.");
  expect(sent).toEqual([{ captureId: id, confirmed: true }]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Problem", exact: true })).toHaveValue("");
});

test("Write it up for me says what goes and where, fills the title and four parts, keeps the photos, and Undo takes it back", async ({ page }) => {
  await page.route(/\/admin\/api\/assistant\/status$/, (route) => route.fulfill({ json: { providerType: "anthropic", model: "claude-x", destination: "https://api.anthropic.com", configured: true, state: "ready", message: "", capabilities: {} } }));
  await page.route(/\/admin\/api\/assistant\/context$/, (route) => route.fulfill({ json: { voiceGuides: [] } }));
  const asked = [];
  await page.route(/\/admin\/api\/assistant\/job-draft$/, (route) => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ json: { draft: { title: "New flashing on a chimney in Thomas", description: "A leak stopped in a day. <b>x</b>", sections: { problem: "Water came in by the chimney.", found: "The flashing had lifted.", did: "We put in new flashing.", result: "Dry since the storm." } } } });
  });
  await openPost(page, "notes", `---\ntitle: Roof repair in Thomas\ndate: 2026-10-01\ndraft: true\nprofile: job\njob:\n  trade: roofing\n  service: roof-repair\n  place:\n    town: Thomas\n---\n## Problem\n\nchimney leak flashing lifted fixed it dry now\n\n## What we found\n\n## What we did\n\n## Result\n\n![Photo 1 from the job](/images/uploads/2026/after.png)\n`);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Write it up for me" }).click();
  const sheet = page.getByRole("dialog", { name: "Write it up for me" });
  await expect(sheet).toContainText("Your words in this job (about 8), its service and town go to Anthropic.");
  await expect(sheet).toContainText("Your photos and voice note don't go.");
  await expect(sheet).not.toContainText("claude-x");
  await sheet.getByRole("button", { name: "Write it up" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("New flashing on a chimney in Thomas");
  await expect(page.getByRole("textbox", { name: "What we found", exact: true })).toHaveValue("The flashing had lifted.");
  await expect(page.getByRole("textbox", { name: "Result", exact: true })).toHaveValue("Dry since the storm.\n\n![Photo 1 from the job](/images/uploads/2026/after.png)");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ notes: "chimney leak flashing lifted fixed it dry now", service: "Roof repair", town: "Thomas", contextIds: [] });
  await expect(status(page)).toContainText("Written up. Read it through, then save.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Roof repair in Thomas");
  await expect(page.getByRole("textbox", { name: "Problem", exact: true })).toHaveValue("chimney leak flashing lifted fixed it dry now");
});

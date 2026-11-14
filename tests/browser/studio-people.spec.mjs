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

// People (Studio R5), ported from the old Admin's Contributors and grown: add and change someone
// with her checks beside each field and an id made from the name; a removal the server refuses
// changes nothing and links the posts that name them; a removal can be undone; Add someone who
// isn't listed on a post comes back to that post with the new person on its list; the old
// Settings pane opens About this post and #/contributors opens People; axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

const registry = () => JSON.parse(readFileSync(join(dir, "openblog.json"), "utf8")).contributors || {};

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-people-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Grammi", url: "https://grammishouse.example" };
  config.contributors = { ann: { name: "Ann" }, ruth: { name: "Ruth Nichols", url: "https://www.ruthbakes.example/" } };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(join(dir, "content", "posts", "2026-10-01-cornbread.md"), "---\ntitle: Cornbread\ndate: 2026-10-01\ndraft: true\n---\n\nSkillet.\n");
  writeFileSync(join(dir, "content", "posts", "2026-10-01-cornbread.credits.json"), JSON.stringify({ version: 1, credits: [{ contributor: "ruth", roles: [{ vocabulary: "crossref", role: "author" }] }] }, null, 2));
  writeFileSync(join(dir, "content", "posts", "2026-10-02-pie.md"), "---\ntitle: Pie\ndate: 2026-10-02\ndraft: true\n---\n\nFlaky.\n");
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

const list = (page) => page.locator(".studio-people");

async function axeClean(page, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

test("People lists the blog's own name and everyone else; add and change someone with her checks", async ({ page }) => {
  await open(page, "#/people");
  await expect(page.getByRole("heading", { name: "People", level: 2 })).toBeVisible();
  await expect(list(page).getByText("Grammi", { exact: true })).toBeVisible();
  await expect(list(page).getByText("Your blog's name")).toBeVisible();
  await expect(list(page).getByText("ruthbakes.example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add someone", exact: true }).first().click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Add their name.")).toBeVisible();
  await name.fill("Ruth Baker");
  await page.getByRole("textbox", { name: "Their website" }).fill("ruthbaker");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("A full web address, starting with https://.").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Their website" }).fill("https://ruthbaker.example");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved. Ruth Baker can be chosen on any post.")).toBeVisible();
  expect(registry()["ruth-baker"]).toMatchObject({ name: "Ruth Baker", url: "https://ruthbaker.example" });
  // Change: the id stays, and an ORCID iD needs its check digit.
  await page.getByRole("button", { name: "Change Ruth Baker" }).click();
  await page.getByText("Details for the person who set up your site").last().click();
  await expect(page.getByText("Id: ruth-baker")).toBeVisible();
  await page.getByRole("textbox", { name: "ORCID iD" }).fill("0000-0002-1825-0098");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("That isn't an ORCID iD.")).toBeVisible();
  await page.getByRole("textbox", { name: "ORCID iD" }).fill("0000-0002-1825-0097");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved. Ruth Baker can be chosen on any post.")).toBeVisible();
  expect(registry()["ruth-baker"].orcid).toBe("https://orcid.org/0000-0002-1825-0097");
});

test("a removal the server refuses changes nothing and links the posts; one it allows can be undone", async ({ page }) => {
  await open(page, "#/people");
  const ruth = list(page).locator("[data-person=ruth]");
  page.removeAllListeners("dialog");
  await ruth.getByRole("button", { name: "More for Ruth Nichols" }).click();
  await page.getByRole("menuitem", { name: "Remove…" }).click();
  const ask = page.getByRole("dialog", { name: "Remove Ruth Nichols?" });
  await expect(ask.getByRole("button", { name: "Keep Ruth Nichols" })).toBeFocused();
  await ask.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Ruth Nichols is named on 1 post, so Ruth Nichols stays for now. Take Ruth Nichols off it first:")).toBeVisible();
  const link = page.getByRole("link", { name: "Cornbread" });
  await expect(link).toHaveAttribute("href", "#/write/posts%2F2026-10-01-cornbread.md?sheet=about&group=credits");
  expect(registry().ruth, "nothing changed").toBeTruthy();
  // Ann is named nowhere: removed, then put back.
  await list(page).locator("[data-person=ann]").getByRole("button", { name: "More for Ann" }).click();
  await page.getByRole("menuitem", { name: "Remove…" }).click();
  await page.getByRole("dialog", { name: "Remove Ann?" }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Removed.", { exact: true })).toBeVisible();
  expect(registry().ann).toBeUndefined();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Ann is back.")).toBeVisible();
  expect(registry().ann).toMatchObject({ name: "Ann" });
  // The link opens the post at Who wrote it.
  await open(page, "#/write/posts%2F2026-10-01-cornbread.md?sheet=about&group=credits");
  await expect(page.locator("side-sheet.studio-about-sheet").getByRole("button", { name: "Change who wrote it" })).toBeFocused();
});

test("Add someone who isn't listed comes back to the post with them on its list", async ({ page }) => {
  await open(page, `#/write/${encodeURIComponent("posts/2026-10-02-pie.md")}`);
  await expect(page.locator(".studio-write > [role=status]")).not.toHaveText("");
  await page.getByRole("button", { name: /^About this post:/ }).click();
  const sheet = page.locator("side-sheet.studio-about-sheet");
  await sheet.getByRole("button", { name: "Change who wrote it" }).click();
  await sheet.getByRole("button", { name: "Add someone who isn't listed" }).click();
  await expect(page).toHaveURL(/#\/people\?from=posts%2F2026-10-02-pie\.md&add=1$/);
  await expect(page.getByRole("link", { name: "Back to “Pie”" })).toBeVisible();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toBeFocused();
  await name.fill("Aunt May");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/#\/write\/posts%2F2026-10-02-pie\.md\?sheet=about&group=credits&add=aunt-may$/);
  await expect(sheet.getByRole("combobox", { name: "Person 1" })).toHaveValue("aunt-may");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".studio-write > [role=status]")).toHaveText(/Draft · saved/, { timeout: 10000 });
  const credits = JSON.parse(readFileSync(join(dir, "content", "posts", "2026-10-02-pie.credits.json"), "utf8")).credits;
  expect(credits.map((c) => c.contributor)).toEqual(["aunt-may"]);
});

test("the old Settings pane opens About this post, and #/contributors is People", async ({ page }) => {
  await open(page, `#/edit/${encodeURIComponent("posts/2026-10-02-pie.md")}?pane=settings`);
  await expect(page).toHaveURL(/#\/write\/posts%2F2026-10-02-pie\.md\?sheet=about$/);
  await expect(page.locator("side-sheet.studio-about-sheet").getByRole("heading", { name: "About this post" })).toBeVisible();
  await open(page, "#/contributors");
  await expect(page).toHaveURL(/#\/people$/);
});

test("People passes axe at 320 px with nothing sideways", async ({ page }) => {
  await open(page, "#/contributors");
  await expect(page).toHaveURL(/#\/people$/);
  await expect(page.getByRole("heading", { name: "People", level: 2 })).toBeVisible();
  await expect(list(page).getByText("Ruth Nichols", { exact: true })).toBeVisible();
  await axeClean(page, "People");
  await page.getByRole("button", { name: "Change Ruth Nichols" }).click();
  await expect(page.getByRole("dialog", { name: "Change Ruth Nichols" })).toBeVisible();
  await axeClean(page, "Change someone");
});

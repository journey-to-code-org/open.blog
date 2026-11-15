import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Copy it for another blog (Studio R5), ported from portability.spec.mjs's authenticated preview
// test: each destination shows exactly what it takes, built from what's on her screen (saved or
// not); Copy and Download carry the same bytes and change nothing; the differences there are in
// her words; Mark as checked records this version and says when the words changed since; a
// preview the server refuses disables Copy and Download; axe at 320 px with nothing sideways.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const REL = "posts/portable-lesson.md";
let root;
let server;
let origin;
let source;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-copy-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  source = readFileSync(join(root, "content", REL), "utf8");
  execFileSync(binary, ["user", "add", "portability", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
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

async function open(page, hash) {
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("portability");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
  await expect(page.locator(".studio-write > [role=status]")).not.toHaveText("");
}

const copySheet = (page) => page.locator("side-sheet.studio-copy-sheet");

async function openCopy(page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Copy it for another blog" }).click();
  await expect(copySheet(page).getByRole("combobox", { name: "Where to" })).toBeFocused();
}

test("each destination shows what it takes; Copy and Download carry the same bytes and change nothing", async ({ page, context }) => {
  await open(page, `#/write/${encodeURIComponent(REL)}`);
  // Unsaved words on screen: the copy is made from them.
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  const unsaved = `Unsaved browser regression 😀\n\n${await words.inputValue()}\n\nLiteral example: \`<script>not executable</script>\`\n`;
  await words.fill(unsaved);
  await openCopy(page);
  const sheet = copySheet(page);
  await expect(sheet.getByText("This copies what's on your screen, including changes not on your site yet.")).toBeVisible();
  // Medium: by hand, as Markdown.
  await expect(sheet.getByText("Medium can't take it directly. In Medium choose Import a story, or paste this in.")).toBeVisible();
  const shown = sheet.getByLabel("What will be copied");
  await expect(shown).toContainText("Unsaved browser regression");
  // A web page: in a sandboxed frame, never same-origin.
  await sheet.getByRole("combobox", { name: "Where to" }).selectOption("portable-html");
  const frame = sheet.locator("iframe.studio-copy-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("title", "What will be copied");
  // Plain words: exact, and the same in the clipboard and the download.
  await sheet.getByRole("combobox", { name: "Where to" }).selectOption("portable-text");
  await expect(shown).toContainText("<script>not executable</script>");
  const expected = await shown.textContent();
  await expect(sheet.getByText(/things? looks? different there/)).toBeVisible();
  await expect(sheet.getByText("The quiz becomes a plain question with its answer.")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "Download" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("portable-lesson.txt");
  expect(readFileSync(await download.path(), "utf8")).toBe(expected);
  await expect(page.getByText("Downloaded.")).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await sheet.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied. Paste it wherever you need it.")).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(expected);
  // Ghost: its own words for the differences, and the engine's findings under Details.
  await sheet.getByRole("combobox", { name: "Where to" }).selectOption("destination:ghost");
  await sheet.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied. Paste it into Ghost.")).toBeVisible();
  await sheet.getByText("Details for the person who set up your site").click();
  await expect(sheet.getByText(/Ghost receives hosted image references only|Ghost source=html/).first()).toBeAttached();
  expect(readFileSync(join(root, "content", REL), "utf8"), "copying never saves").toBe(source);
});

test("Mark as checked records this version; a refused preview disables Copy and Download", async ({ page }) => {
  await open(page, `#/write/${encodeURIComponent(REL)}`);
  await openCopy(page);
  const sheet = copySheet(page);
  await sheet.getByRole("combobox", { name: "Where to" }).selectOption("portable-text");
  await sheet.getByText("Details for the person who set up your site").click();
  await sheet.getByRole("button", { name: "Mark as checked" }).first().click();
  await expect(sheet.getByText("Marked as checked for this version.").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  // The words change: the check was for an earlier version.
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await words.fill(`${await words.inputValue()}\n\nOne more line.\n`);
  await openCopy(page);
  await sheet.getByRole("combobox", { name: "Where to" }).selectOption("portable-text");
  await sheet.getByText("Details for the person who set up your site").click();
  await expect(sheet.getByText("Checked for an earlier version; check again.").first()).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  // The server refuses: nothing to copy, and it says so.
  await page.route("**/admin/api/preview", (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Preview regression: invalid capability" }) }));
  await openCopy(page);
  await expect(sheet.getByText("It can't be copied right now")).toBeVisible();
  await expect(sheet.getByText("Preview regression: invalid capability")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
  await expect(sheet.getByRole("button", { name: "Download" })).toBeDisabled();
  expect(readFileSync(join(root, "content", REL), "utf8")).toBe(source);
});

test("Copy it for another blog passes axe at 320 px with nothing sideways", async ({ page }) => {
  await open(page, `#/write/${encodeURIComponent(REL)}`);
  await openCopy(page);
  await expect(copySheet(page).getByLabel("What will be copied")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("side-sheet.studio-copy-sheet"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(await page.evaluate(() => { const body = document.querySelector("side-sheet.studio-copy-sheet .sheet-body"); return body.scrollWidth > body.clientWidth; })).toBe(false);
});

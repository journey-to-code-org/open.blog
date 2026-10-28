import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// Safe writing in the landing Text section (ADR 0350, ADR 0351; #334, #335): pasted content is cleaned
// into the words the editor holds, and plain-language checks offer fixes. Real binary, real Admin.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;

const landingFile = () => join(root, "content", "landing.json");
const stored = () => JSON.parse(readFileSync(landingFile(), "utf8"));
const seed = (markdown) => writeFileSync(landingFile(), JSON.stringify({ format: "openblog-landing", version: 1, sections: [{ id: "text", type: "rich-text", markdown }] }));
const savedMarkdown = () => stored().sections[0].markdown;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-landing-safety-"));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "content", "posts", "one.md"), "---\ntitle: One\ndate: 2026-10-01\n---\nA post.\n");
  writeFileSync(join(root, "openblog.json"), JSON.stringify({ title: "Rich", url: "https://rich.example.org", author: { name: "Site Author" }, home: { heading: "Fresh writing", intro: "Welcome to my blog." } }));
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
    expect((await fetch(`${origin}/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  if (root) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ }
  }
});

test.beforeEach(({ page }) => {
  rmSync(landingFile(), { force: true });
  page.on("dialog", (dialog) => {
    throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`);
  });
});

async function openText(page, markdown) {
  seed(markdown);
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-action="logout"]')).toBeVisible();
  }
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/admin/#/landing`);
  await expect(page.getByRole("heading", { level: 2, name: "Sections" })).toBeVisible();
  await page.locator('[data-section="text"]').getByRole("button", { name: /^Edit/ }).click();
  await expect(editor(page)).toBeVisible();
}

const editor = (page) => page.locator("[data-rich-text]");
const tool = (page, name) => page.locator(`[data-rich="${name}"]`);
const saveAndRead = async (page) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  return savedMarkdown();
};
/** Select all of the text and replace it. */
async function typeOver(page, text) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}


/** Dispatch a paste with the given clipboard parts into the text. */
async function paste(page, { html, plain }) {
  await editor(page).evaluate(
    (node, parts) => {
      const data = new DataTransfer();
      if (parts.html) data.setData("text/html", parts.html);
      if (parts.plain) data.setData("text/plain", parts.plain);
      node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { html, plain },
  );
}

const WORD_LIKE = `<html><head><style>p{font-family:Calibri}</style></head><body><!--StartFragment-->
<h1 style="font-size:20pt" class="MsoTitle">Our menu</h1>
<p class="MsoNormal" style="color:red">We bake <b onclick="window.__hit = 1">fresh</b> bread and <i>pies</i>, see
<a href="https://example.com/menu" style="color:blue">the menu</a> or <a href="javascript:window.__hit = 2">this</a>.</p>
<ul><li>Sourdough</li><li>Rye</li></ul><script>window.__hit = 3</script><!--EndFragment--></body></html>`;

test("pasted Word-style content keeps headings, emphasis, links and lists and nothing else", async ({ page }) => {
  await openText(page, "x");
  await typeOver(page, "");
  await paste(page, { html: WORD_LIKE, plain: "Our menu We bake fresh bread" });
  await expect(editor(page).locator("h2")).toHaveText("Our menu");
  await expect(editor(page).locator("strong")).toHaveText("fresh");
  await expect(editor(page).locator("em")).toHaveText("pies");
  await expect(editor(page).locator("a")).toHaveCount(1);
  await expect(editor(page).locator("li")).toHaveText(["Sourdough", "Rye"]);
  expect(await editor(page).locator("script, style, [style], [class=MsoNormal], [onclick]").count()).toBe(0);
  await expect(page.locator("[data-rich-status]")).toContainText("Ctrl+Shift+V");
  const markdown = await saveAndRead(page);
  expect(markdown).toContain("## Our menu");
  expect(markdown).toContain("We bake **fresh** bread and _pies_");
  expect(markdown).toContain("[the menu](https://example.com/menu)");
  expect(markdown).toContain("- Sourdough\n- Rye");
  expect(markdown).not.toMatch(/javascript:|<\/?[a-z]|onclick|style/i);
  expect(await page.evaluate(() => window.__hit)).toBeUndefined();
});

test("a picture pasted without a description is left out and flagged, not silently added", async ({ page }) => {
  await openText(page, "x");
  await typeOver(page, "");
  await paste(page, {
    html: '<p>Look <img src="https://example.com/a.jpg"> and <img src="https://example.com/b.jpg" alt="A loaf"></p>',
    plain: "Look",
  });
  await expect(editor(page).locator("img")).toHaveCount(1);
  await expect(editor(page).locator("img")).toHaveAttribute("alt", "A loaf");
  await expect(page.locator("[data-rich-status]")).toContainText("One picture was left out because it has no description");
});

test("Ctrl+Shift+V pastes plain text and hostile pasted markup never reaches the text", async ({ page }) => {
  await openText(page, "x");
  await typeOver(page, "");
  // The key press alone (a real one is followed by the browser's own paste event, so it is sent by hand here).
  await editor(page).evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true, bubbles: true })));
  await paste(page, { html: "<p><b>formatted</b></p>", plain: "just words" });
  await expect(editor(page)).toContainText("just words");
  await expect(editor(page).locator("strong")).toHaveCount(0);
  await expect(page.locator("[data-rich-status]")).toContainText("Pasted as plain text.");
  await typeOver(page, "");
  await paste(page, { html: '<p>&lt;img src=x onerror="window.__hit=4"&gt;<img src=x onerror="window.__hit=5"><script>window.__hit=6</script></p>', plain: "" });
  expect(await editor(page).locator("img, script, [onerror]").count()).toBe(0);
  const markdown = await saveAndRead(page);
  expect(markdown).not.toMatch(/<\/?[a-z]/i);
  expect(await page.evaluate(() => window.__hit)).toBeUndefined();
});

test("the post Visual editor cleans pasted content the same way and writes safe Markdown", async ({ page }) => {
  await openText(page, "x");
  await page.goto(`${origin}/admin/#/new/posts`);
  await page.getByRole("button", { name: "Visual", exact: true }).click();
  const visual = page.getByRole("textbox", { name: "Visual editor" });
  await visual.click();
  await visual.evaluate((node, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "plain fallback");
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, WORD_LIKE);
  await expect(visual.locator("h2")).toHaveText("Our menu");
  await expect(visual.locator("strong")).toHaveText("fresh");
  expect(await visual.locator("script, style, [style], [onclick]").count()).toBe(0);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const body = await page.getByRole("textbox", { name: "Markdown", exact: true }).inputValue();
  expect(body).toContain("We bake **fresh** bread and _pies_");
  expect(body).not.toMatch(/javascript:|<\/?[a-z]|onclick/i);
  expect(await page.evaluate(() => window.__hit)).toBeUndefined();
});

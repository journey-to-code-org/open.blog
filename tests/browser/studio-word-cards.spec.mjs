import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Cards in place (Studio R6): her words show photos, tips, tables and pieces as cards with Change
// and Move, never their syntax. A post with every kind opens and saves with no change rewritten;
// Take it out and Undo give back the exact bytes; Done with nothing changed writes nothing; a fence
// that never ends leaves the rest as written; a recipe keeps its boxes with a tip in Your story; a
// job's Before and After follow the cards. Ported from the old Admin's visual-pieces, visual-cards
// and the editor half of photos.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg==", "base64");
let dir;
let child;
let origin;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-word-cards-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "static", "images", "uploads", "2026"), { recursive: true });
  for (const name of ["pie.png", "before.png", "after.png"]) writeFileSync(join(dir, "static", "images", "uploads", "2026", name), PNG);
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
  page.on("pageerror", (error) => { throw error; });
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

const fileOf = (name) => readFileSync(join(dir, "content", "posts", `${name}.md`), "utf8");

async function openPost(page, name, text) {
  writeFileSync(join(dir, "content", "posts", `${name}.md`), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${name}.md`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

async function axeClean(page, label, root = "#studio-main") {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

const front = (title) => `---\ntitle: ${title}\ndate: 2026-01-01\ndraft: true\n---\n`;
const EVERYTHING = `${front("Everything")}
Opening words.

![Pie cooling](/images/uploads/2026/pie.png)

> [!TIP]
> **Make ahead**
>
> Bake the crust the day before.

- [ ] Flour
- [x] Sugar

| Weight | Time |
| --- | --- |
| 12 lb | 3 h |

\`\`\`rust title="main.rs" {2}
fn main() {}
\`\`\`

\`\`\`piece video
provider: youtube
video: dQw4w9WgXcQ
title: Rolling the crust
\`\`\`

https://www.youtube.com/watch?v=dQw4w9WgXcQ

\`\`\`quiz
Which goes first?
- [x] Flour
- [ ] Butter
\`\`\`

<div class="note">Kept as it is.</div>

Closing words with a note.[^1]

[^1]: The note itself.
`;

test("a post with every kind opens as words and cards, and saving with no change rewrites nothing", async ({ page }) => {
  await openPost(page, "everything", EVERYTHING);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await expect(words).toHaveValue("Opening words.");
  for (const name of ["Photo: Pie cooling", "Tip: Make ahead", "Checklist, 2 things", "Table, 2 columns, 1 rows", "Code, rust, 1 lines", "Video: Rolling the crust", "Video from YouTube", "Question for readers: Which goes first?", "Something the person who set up your site added", "Note at the bottom, 1: The note itself."]) {
    await expect(page.getByRole("group", { name, exact: true })).toBeVisible();
  }
  // No syntax in any box she types in.
  for (const value of await page.locator(".studio-word-box textarea").evaluateAll((areas) => areas.map((a) => a.value))) {
    expect(value).not.toMatch(/\[!TIP\]|```|^\||!\[/m);
  }
  await page.keyboard.press("Control+s");
  await expect(page.locator(".studio-write > [role=status]")).not.toContainText("saving");
  expect(fileOf("everything")).toBe(EVERYTHING);
  // A card that can't be changed here says so and can still move.
  const kept = page.getByRole("group", { name: "Something the person who set up your site added" });
  await expect(kept).toContainText("This one can't be changed here.");
  await expect(kept.getByRole("button", { name: /^Change/ })).toHaveCount(0);
  // Only its name on her layer; the source is behind the details for the person who set it up.
  await expect(kept.locator(".studio-piece-lines")).toHaveCount(0);
  await expect(kept.locator("details pre")).toHaveText("<div class=\"note\">Kept as it is.</div>");
  await expect(kept.locator("details pre")).toBeHidden();
  await axeClean(page, "Write with cards");
});

test("Take it out and Undo give back the exact bytes; a move swaps with its neighbour and says where", async ({ page }) => {
  await openPost(page, "moves", EVERYTHING);
  const tip = page.getByRole("group", { name: "Tip: Make ahead" });
  await tip.getByRole("button", { name: /^Move/ }).click();
  await page.getByRole("menuitem", { name: "Take it out" }).click();
  await expect(page.getByRole("group", { name: "Tip: Make ahead" })).toHaveCount(0);
  await expect(page.locator(".studio-piece-status").first()).toHaveText("Tip taken out.");
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByRole("group", { name: "Tip: Make ahead" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("moves")).toBe(EVERYTHING);
  // Move the photo down: it swaps with the tip.
  await page.getByRole("group", { name: "Photo: Pie cooling" }).getByRole("button", { name: /^Move/ }).click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect(page.locator(".studio-piece-status").first()).toHaveText(/Moved down\. It's now after “Tip: Make ahead/);
  await expect(page.getByRole("group", { name: "Photo: Pie cooling" })).toBeFocused();
  // Alt+↑ moves it back.
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("moves")).toBe(EVERYTHING);
});

test("Change with nothing changed writes nothing; a real change writes the same kind", async ({ page }) => {
  await openPost(page, "change", EVERYTHING);
  await page.getByRole("group", { name: "Tip: Make ahead" }).getByRole("button", { name: /^Change/ }).click();
  const sheet = page.getByRole("dialog", { name: "Tip" });
  await expect(sheet.getByRole("textbox", { name: "What it says" })).toHaveValue("Bake the crust the day before.");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("change")).toBe(EVERYTHING);
  // The bare video link stays a bare link.
  await page.getByRole("group", { name: "Video from YouTube" }).getByRole("button", { name: /^Change/ }).click();
  const video = page.getByRole("dialog", { name: "Video" });
  await video.getByRole("textbox", { name: "YouTube or Vimeo link" }).fill("https://youtu.be/aaaaaaaaaaa");
  await video.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".studio-piece-status").first()).toHaveText("Video changed.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("change")).toContain("\n\nhttps://youtu.be/aaaaaaaaaaa\n\n```quiz");
});

test("Change on a photo card: a new description goes in with Done", async ({ page }) => {
  await openPost(page, "photo-change", EVERYTHING);
  await page.getByRole("group", { name: "Photo: Pie cooling" }).getByRole("button", { name: /^Change/ }).click();
  const form = page.getByRole("dialog", { name: "Photo" });
  const describe = form.getByRole("textbox", { name: "Describe the photo" });
  await expect(describe).toHaveValue("Pie cooling");
  await describe.fill("Pie on the sill");
  await form.getByRole("button", { name: "Done" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("group", { name: "Photo: Pie on the sill" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("photo-change")).toBe(EVERYTHING.replace("![Pie cooling]", "![Pie on the sill]"));
});

test("Change on Before and after photos: a new description goes in with Done", async ({ page }) => {
  const pair = "```compare\nbefore: /images/uploads/2026/before.png\nbefore-alt: The dough\nafter: /images/uploads/2026/after.png\nafter-alt: The loaf\n```";
  await openPost(page, "pair-change", `${front("Pair")}\nWords.\n\n${pair}\n`);
  await page.getByRole("group", { name: /^Before and after photos/ }).getByRole("button", { name: /^Change/ }).click();
  const form = page.getByRole("dialog", { name: "Before and after photos" });
  const describe = form.getByRole("group", { name: "After" }).getByRole("textbox", { name: "Describe it" });
  await expect(describe).toHaveValue("The loaf");
  await describe.fill("The loaf, baked");
  await form.getByRole("button", { name: "Done" }).click();
  await expect(form).toBeHidden();
  await expect(page.locator(".studio-piece-status").first()).toHaveText("Before and after photos changed.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("pair-change")).toContain("after-alt: The loaf, baked\n```");
});

test("Add something puts a tip where she was, says where first, and Undo takes it back", async ({ page }) => {
  const text = `${front("Adding")}\nMy mother made this every year.\n\nPreheat the oven.\n`;
  await openPost(page, "adding", text);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await words.click();
  await words.press("Control+Home");
  await words.press("End");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.getByRole("dialog", { name: "Add something" });
  await expect(sheet.locator(".studio-add-where")).toHaveText("It goes in your words, after “My mother made this every…”.");
  await sheet.getByRole("button", { name: "A tip or a note" }).click();
  const form = page.getByRole("dialog", { name: "Tip" });
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Write what the tip says.")).toBeVisible();
  await form.getByRole("textbox", { name: "A few words on top" }).fill("Before you start");
  await form.getByRole("textbox", { name: "What it says" }).fill("Read it all first.");
  await expect(form.locator(".studio-add-sketch")).toContainText("Read it all first.");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("group", { name: "Tip: Before you start" })).toBeFocused();
  await expect(page.locator(".studio-piece-status").first()).toHaveText("Tip added.");
  await page.keyboard.press("Control+s");
  // The same bytes POST pieces writes for a tip with a heading.
  const built = await page.evaluate(async () => {
    const { csrf } = await (await fetch("/admin/api/session")).json();
    const reply = await fetch("/admin/api/pieces", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ kind: "callout", values: [["tone", "success"], ["title", "Before you start"], ["body", "Read it all first."]] }) });
    return (await reply.json()).markdown;
  });
  await expect.poll(() => fileOf("adding")).toBe(`${front("Adding")}\nMy mother made this every year.\n\n${built}\nPreheat the oven.\n`);
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByRole("group", { name: "Tip: Before you start" })).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("adding")).toBe(text);
});

test("Undo after typing takes back only the tip and keeps the typing; a take-out whose place is gone says so", async ({ page }) => {
  const text = `${front("Typed")}\nMy mother made this every year.\n\nPreheat the oven.\n`;
  await openPost(page, "typed", text);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await words.click();
  await words.press("Control+Home");
  await words.press("End");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  await page.getByRole("dialog", { name: "Add something" }).getByRole("button", { name: "A tip or a note" }).click();
  const form = page.getByRole("dialog", { name: "Tip" });
  await form.getByRole("textbox", { name: "What it says" }).fill("Read it all first.");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Tip: Read it all first." })).toBeFocused();
  const last = page.locator(".studio-word-box textarea").last();
  await last.click();
  await last.press("Control+End");
  await last.pressSequentially(" Then wait.");
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByRole("group", { name: "Tip: Read it all first." })).toHaveCount(0);
  await expect(page.locator(".studio-piece-status").first()).toHaveText("Taken back.");
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("typed")).toBe(`${front("Typed")}\nMy mother made this every year.\n\nPreheat the oven. Then wait.\n`);
  // Take out a tip, then rewrite the words on both sides of where it was: Undo can't find its place.
  await openPost(page, "typed-gone", `${front("Gone")}\nAbove.\n\n> [!TIP]\n> Chill the dough.\n\nBelow.\n`);
  await page.getByRole("group", { name: "Tip: Chill the dough." }).getByRole("button", { name: /^Move/ }).click();
  await page.getByRole("menuitem", { name: "Take it out" }).click();
  await words.fill("Something else.");
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.locator(".studio-piece-status").first()).toHaveText("This changed since, so it can't be undone here.");
  await expect(words).toHaveValue("Something else.");
});

test("/ alone on a line opens Add something with the filter ready; 1/2 cup never does; a table goes in with no signal", async ({ page, context }) => {
  await openPost(page, "slash", `${front("Slash")}\nFirst.\n`);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await words.click();
  await words.press("Control+End");
  await words.pressSequentially("\n\n1/2 cup");
  await expect(page.getByRole("dialog", { name: "Add something" })).toBeHidden();
  await words.pressSequentially("\n\n/");
  const sheet = page.getByRole("dialog", { name: "Add something" });
  await expect(sheet).toBeVisible();
  const find = sheet.getByRole("searchbox", { name: "Find something to add" });
  await expect(find).toBeFocused();
  await page.keyboard.type("table");
  await expect(sheet.getByRole("button", { name: "A table" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "A photo" })).toHaveCount(0);
  await context.setOffline(true);
  await sheet.getByRole("button", { name: "A table" }).click();
  const form = page.getByRole("dialog", { name: "Table" });
  await form.getByRole("textbox", { name: "Column 1", exact: true }).fill("Weight");
  await form.getByRole("textbox", { name: "Column 2", exact: true }).fill("Time");
  await form.getByRole("textbox", { name: "Row 1, Weight" }).fill("12 lb");
  await form.getByRole("textbox", { name: "Row 1, Time" }).fill("3 h");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Table, 2 columns, 2 rows" })).toBeFocused();
  await context.setOffline(false);
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("slash")).toBe(`${front("Slash")}\nFirst.\n\n1/2 cup\n\n| Weight | Time |\n| --- | --- |\n| 12 lb | 3 h |\n|  |  |\n`);
});

test("a video waits for a signal with what she filled in, and goes in once there is one", async ({ page, context }) => {
  await openPost(page, "video", `${front("Video")}\nWords.\n`);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add something to Words" }).click();
  await page.getByRole("dialog", { name: "Add something" }).getByRole("button", { name: "A video" }).click();
  const form = page.getByRole("dialog", { name: "Video" });
  await form.getByRole("textbox", { name: "YouTube or Vimeo link" }).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await form.getByRole("textbox", { name: "What it's about" }).fill("Rolling the crust");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form).toContainText("Waiting for a signal. What you filled in is kept here.");
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.getByRole("dialog", { name: "Add something" });
  await sheet.getByRole("button", { name: "Finish adding the video" }).click();
  await expect(page.getByRole("dialog", { name: "Video" }).getByRole("textbox", { name: "What it's about" })).toHaveValue("Rolling the crust");
  await page.getByRole("dialog", { name: "Video" }).getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Video: Rolling the crust" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("video")).toContain("```piece video\nprovider: youtube\nvideo: dQw4w9WgXcQ\ntitle: Rolling the crust\n```");
});

test("a fence that never ends leaves the rest of the box as written", async ({ page }) => {
  const text = `${front("Open")}\nBefore.\n\n![Pie cooling](/images/uploads/2026/pie.png)\n\n\`\`\`js\nlet a = 1;\n\n| not | a table |\n| --- | --- |\n`;
  await openPost(page, "open", text);
  await expect(page.getByRole("group", { name: "Photo: Pie cooling" })).toBeVisible();
  await expect(page.getByText("Part of this post is open as written")).toBeVisible();
  await expect(page.getByRole("group", { name: /^Table/ })).toHaveCount(0);
  await expect(page.locator(".studio-word-box textarea").last()).toHaveValue("```js\nlet a = 1;\n\n| not | a table |\n| --- | --- |");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("open")).toBe(text);
});

test("Show the words as written turns every box into one plain box, for this post and this visit", async ({ page }) => {
  await openPost(page, "written", EVERYTHING);
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.getByRole("dialog", { name: "Add something" });
  await sheet.locator("summary", { hasText: "For the person who set up your site" }).click();
  await sheet.getByRole("switch", { name: "Show the words as written" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Words", exact: true })).toHaveValue(/Opening words\.\n\n!\[Pie cooling\]\(\/images\/uploads\/2026\/pie\.png\)\n\n> \[!TIP\]\n> \*\*Make ahead\*\*[\s\S]*\[\^1\]: The note itself\./);
  await expect(page.locator(".studio-piece-card")).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("written")).toBe(EVERYTHING);
  await page.reload();
  await expect(page.locator(".studio-piece-card")).toHaveCount(0);
});

test("paste from a web page keeps headings, bold and links, and says what it left out", async ({ page }) => {
  await openPost(page, "paste", `${front("Paste")}\nStart.\n`);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await words.click();
  await words.press("Control+End");
  await words.evaluate((area) => {
    const data = new DataTransfer();
    data.setData("text/html", "<h2 style=\"color:red\">Tips</h2><p>Use <b>cold</b> butter, <a href=\"https://example.com/\">see why</a>.</p><img src=\"https://example.com/a.png\">");
    data.setData("text/plain", "Tips Use cold butter");
    area.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(words).toHaveValue(/Start\.## Tips\n\nUse \*\*cold\*\* butter, \[see why\]\(https:\/\/example\.com\/\)\./);
  await expect(page.locator(".studio-piece-status").first()).toContainText("Pasted. Headings, bold and links kept. Fonts and colours left out.");
  await expect(page.locator(".studio-piece-status").first()).toContainText("1 photo was left out because it has no description.");
});

test("Suggestions under the words: a photo with no description is fixed with her words, and Undo is there", async ({ page }) => {
  await openPost(page, "suggest", `${front("Suggest")}\nWords.\n\n![](/images/uploads/2026/pie.png)\n\n[click here](https://example.com/)\n`);
  const box = page.locator(".studio-suggestions-box");
  await expect(box.locator(":scope > summary")).toHaveText("2 suggestions for your words", { timeout: 5000 }).catch(async () => {
    await page.getByRole("textbox", { name: "Words", exact: true }).press("End");
    await page.getByRole("textbox", { name: "Words", exact: true }).pressSequentially(" ");
    await expect(box.locator(":scope > summary")).toHaveText("2 suggestions for your words");
  });
  await box.locator(":scope > summary").click();
  await box.getByRole("button", { name: "Describe it" }).click();
  await box.getByRole("textbox", { name: "Describe the photo" }).fill("A pie on the sill");
  await box.getByRole("button", { name: "Use these words" }).click();
  await expect(page.getByRole("group", { name: "Photo: A pie on the sill" })).toBeVisible();
  await expect(box.locator(":scope > summary")).toHaveText("1 suggestion for your words");
  await axeClean(page, "Suggestions");
});

test("a recipe with a tip in Your story stays in boxes, and its rows never take cards", async ({ page }) => {
  const text = `---\ntitle: Pie\ndate: 2026-01-01\ndraft: true\nprofile: recipe\n---\nMama taught me.\n\n> [!TIP]\n> Chill the dough.\n\n## Ingredients\n\n- 1 cup flour\n- 2 eggs\n\n## Steps\n\n1. Mix.\n2. Bake for 45 minutes.\n`;
  await openPost(page, "pie", text);
  await expect(page.getByRole("textbox", { name: "Ingredient 1 of 2" })).toHaveValue("1 cup flour");
  await expect(page.getByRole("group", { name: "Tip: Chill the dough." })).toBeVisible();
  await page.getByRole("button", { name: "Add something to Your story" }).click();
  await expect(page.getByRole("dialog", { name: "Add something" }).locator(".studio-add-where")).toHaveText("It goes at the end of Your story.");
  await page.getByRole("dialog", { name: "Add something" }).getByRole("button", { name: "Never mind" }).click();
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("pie")).toBe(text);
});

test("the forms for the person who set up the site: code, runnable code, a CodePen and a footnote", async ({ page }) => {
  await openPost(page, "mikey", `${front("Mikey")}\nCode below.\n`);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  const add = async (name) => {
    await words.click();
    await words.press("Control+End");
    await page.getByRole("button", { name: "Add something to Words" }).click();
    const sheet = page.getByRole("dialog", { name: "Add something" });
    const details = sheet.locator("details.studio-add-details");
    if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click();
    await sheet.getByRole("button", { name, exact: true }).click();
  };
  await add("Code");
  let form = page.getByRole("dialog", { name: "Code" });
  await form.getByRole("textbox", { name: "Language" }).fill("rust");
  await form.getByRole("textbox", { name: "Highlight lines" }).fill("two");
  await form.getByRole("textbox", { name: "Code", exact: true }).fill("fn main() {}");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Line numbers look like 2,4-6.")).toBeVisible();
  await form.getByRole("textbox", { name: "Highlight lines" }).fill("1");
  await axeClean(page, "Code form", "side-sheet.studio-add-sheet");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Code, rust, 1 lines" })).toBeVisible();
  await add("A CodePen");
  form = page.getByRole("dialog", { name: "A CodePen" });
  await form.getByRole("textbox", { name: "Pen address" }).fill("https://example.com/pen");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("That isn't a CodePen address.")).toBeVisible();
  await form.getByRole("textbox", { name: "Pen address" }).fill("https://codepen.io/someone/pen/abcd");
  await form.getByRole("button", { name: "Add it" }).click();
  await add("A footnote");
  form = page.getByRole("dialog", { name: "Footnote" });
  await form.getByRole("textbox", { name: "Note text" }).fill("Read the docs.");
  await form.getByRole("button", { name: "Add it" }).click();
  await add("Code readers can run");
  form = page.getByRole("dialog", { name: "Code readers can run" });
  await form.getByRole("textbox", { name: "Title" }).fill("Hello");
  await form.getByRole("textbox", { name: "What to try" }).fill("Run it.");
  await form.getByRole("button", { name: "Add it" }).click();
  await page.keyboard.press("Control+s");
  const saved = await expect.poll(() => fileOf("mikey")).toContain("**Runnable example: Hello**");
  const source = fileOf("mikey");
  expect(source).toContain("```rust {1}\nfn main() {}\n```");
  expect(source).toContain("https://codepen.io/someone/pen/abcd");
  expect(source).toMatch(/\[\^1\]\n*/);
  expect(source).toContain("[^1]: Read the docs.");
  expect(source).toContain("```rust runnable title=\"Hello\"");
  void saved;
});

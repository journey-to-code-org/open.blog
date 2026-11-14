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

// Add something (Studio R6): the sheet, its two groups and its search, the ways in (button, ?add=,
// Find), each form's checks said beside the field (including the server's coded refusals, G44),
// pieces the server writes, a link and a heading that stay words, leaving a filled-in form, and
// axe at 320 px on the sheet and every form. Ported from the old Admin's add-something and
// before-after-editor specs.

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
  dir = mkdtempSync(join(tmpdir(), "openblog-add-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  mkdirSync(join(dir, "static", "images", "uploads", "2026"), { recursive: true });
  for (const name of ["dough.png", "loaf.png"]) writeFileSync(join(dir, "static", "images", "uploads", "2026", name), PNG);
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

const front = (title) => `---\ntitle: ${title}\ndate: 2026-01-01\ndraft: true\n---\n`;
const fileOf = (name) => readFileSync(join(dir, "content", "posts", `${name}.md`), "utf8");

async function openPost(page, name, text, query = "") {
  writeFileSync(join(dir, "content", "posts", `${name}.md`), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${name}.md`)}${query}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

async function axeClean(page, label, root = "side-sheet.studio-add-sheet") {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  expect(await page.evaluate((selector) => { const body = document.querySelector(selector)?.querySelector(".sheet-body, dialog"); return body ? body.scrollWidth > body.clientWidth + 1 : false; }, root), `${label}: the sheet scrolls sideways`).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

async function addFromWords(page) {
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.getByRole("dialog", { name: "Add something" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("the sheet: two groups, a search with an empty state, details kept open for the visit, and axe at 320 px", async ({ page }) => {
  await openPost(page, "sheet", `${front("Sheet")}\nWords.\n`);
  const sheet = await addFromWords(page);
  await expect(sheet.getByRole("heading", { name: "Most used", level: 3 })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "More things", level: 3 })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "A photo", exact: true })).toHaveAccessibleDescription("One of your photos, with a few words about it.");
  for (const name of ["A tip or a note", "A checklist", "A table", "A video", "A link", "A heading", "Before and after photos", "A quote", "Questions and answers", "A question for readers", "A button", "Links to your other pages", "A map"]) {
    await expect(sheet.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(sheet.getByRole("button", { name: "Code", exact: true })).toBeHidden();
  await axeClean(page, "the Add something sheet");
  const find = sheet.getByRole("searchbox", { name: "Find something to add" });
  await find.fill("gallery");
  await expect(sheet.getByText("Nothing called “gallery”.")).toBeVisible();
  await find.fill("table");
  await expect(sheet.locator("[data-item]")).toHaveCount(1);
  await find.fill("");
  await sheet.locator("summary", { hasText: "For the person who set up your site" }).click();
  await expect(sheet.getByRole("button", { name: "Code", exact: true })).toBeVisible();
  await expect(sheet).toContainText("POST /admin/api/pieces");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Add something to Words" })).toBeFocused();
  await addFromWords(page);
  await expect(page.getByRole("dialog", { name: "Add something" }).getByRole("button", { name: "Code", exact: true })).toBeVisible();
});

test("?add=1 opens the sheet and ?add=table its form; Find has Add a table; the address loses the query", async ({ page }) => {
  await openPost(page, "routes", `${front("Routes")}\nWords.\n`, "?add=1");
  await expect(page.getByRole("dialog", { name: "Add something" })).toBeVisible();
  await expect(page).toHaveURL(/#\/write\/posts%2Froutes\.md$/);
  await page.keyboard.press("Escape");
  await openPost(page, "routes", `${front("Routes")}\nWords.\n`, "?add=table");
  await expect(page.getByRole("dialog", { name: "Table" })).toBeVisible();
  await page.getByRole("dialog", { name: "Table" }).getByRole("button", { name: "‹ Everything you can add" }).click();
  await expect(page.getByRole("dialog", { name: "Add something" })).toBeVisible();
  await page.getByRole("dialog", { name: "Add something" }).getByRole("button", { name: "Never mind" }).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Add a table");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Table" })).toBeVisible();
});

test("leaving a filled-in form asks once: Leave it out keeps the words as they were", async ({ page }) => {
  const text = `${front("Leave")}\nWords.\n`;
  await openPost(page, "leave", text);
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A heading", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Heading" });
  await form.getByRole("textbox", { name: "Heading" }).fill("Half done");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("dialog", { name: "Add this heading?" });
  await expect(ask).toContainText("You filled it in but didn't add it.");
  await ask.getByRole("button", { name: "Leave it out" }).click();
  await expect(form).toBeHidden();
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(300);
  expect(fileOf("leave")).toBe(text);
});

test("a button the server writes: a wrong email is said beside its field, then it goes in as a card", async ({ page }) => {
  await openPost(page, "button", `${front("Button")}\nWords.\n`);
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A button", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Button" });
  await form.getByRole("textbox", { name: "What it says" }).fill("Order a cake");
  await form.getByRole("button", { name: "An email" }).click();
  await form.getByRole("textbox", { name: "Address, email or number" }).fill("not-an-email");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("That doesn't look like an email address.")).toBeVisible();
  await form.getByRole("textbox", { name: "Address, email or number" }).fill("orders@example.com");
  await axeClean(page, "the button form");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Button: Order a cake" })).toBeFocused();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("button")).toContain("```piece button\nlabel: Order a cake\nhref: mailto:orders@example.com\n```");
});

test("Ctrl+Enter pressed twice on a slow server adds the button once", async ({ page }) => {
  await openPost(page, "twice", `${front("Twice")}\nWords.\n`);
  await page.route("**/admin/api/pieces", async (route) => { await new Promise((done) => setTimeout(done, 800)); await route.continue(); });
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A button", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Button" });
  await form.getByRole("textbox", { name: "What it says" }).fill("Order a cake");
  await form.getByRole("textbox", { name: "Address, email or number" }).fill("https://example.com/order");
  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("group", { name: "Button: Order a cake" })).toHaveCount(1);
  await page.waitForTimeout(1200);
  await expect(page.getByRole("group", { name: "Button: Order a cake" })).toHaveCount(1);
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("twice").split("```piece button").length).toBe(2);
});

test("questions and answers: the server's coded refusal lands on the right row", async ({ page }) => {
  await openPost(page, "faq", `${front("Faq")}\nWords.\n`);
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "Questions and answers", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Questions and answers" });
  await form.getByRole("textbox", { name: "Question 1" }).fill("Can I freeze it?");
  await form.getByRole("textbox", { name: "Answer 1" }).fill("Yes, for a month.");
  await form.getByRole("button", { name: "Add a question" }).click();
  await expect(form.getByRole("textbox", { name: "Question 2" })).toBeFocused();
  await form.getByRole("textbox", { name: "Answer 2" }).fill("Overnight.");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByRole("textbox", { name: "Question 2" })).toBeFocused();
  await expect(form.getByText("Write the question.")).toBeVisible();
  await form.getByRole("textbox", { name: "Question 2" }).fill("How long does it keep?");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Questions and answers, 2" })).toBeVisible();
});

test("a map from a map link: a short link says why, a long one is found; no tiles are loaded", async ({ page }) => {
  await openPost(page, "map", `${front("Map")}\nWords.\n`);
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A map", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Map" });
  await form.getByRole("textbox", { name: "Place name" }).fill("Elkins, West Virginia");
  await form.getByRole("textbox", { name: "Map link" }).fill("https://maps.app.goo.gl/abc");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("That's a short link, which doesn't say where the place is.")).toBeVisible();
  await form.getByRole("textbox", { name: "Map link" }).fill("https://www.openstreetmap.org/#map=15/38.9262/-79.8467");
  await expect(form.getByText("Found it: 38.93, −79.85.")).toBeVisible();
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Map: Elkins, West Virginia" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("map")).toContain("```piece map\nprovider: openstreetmap\nlabel: Elkins, West Virginia\nlat: 38.9262\nlon: -79.8467\n```");
});

test("before and after photos from her photos, with a name for each side", async ({ page }) => {
  await openPost(page, "pair", `${front("Pair")}\nWords.\n`);
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "Before and after photos", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Before and after photos" });
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Choose the before photo.")).toBeVisible();
  const before = form.getByRole("group", { name: "Before" });
  const after = form.getByRole("group", { name: "After" });
  await before.getByRole("button", { name: "dough" }).click();
  await before.getByRole("textbox", { name: "Describe it" }).fill("The dough, risen");
  await before.getByRole("textbox", { name: "Name for this side" }).fill("The dough");
  await after.getByRole("button", { name: "loaf" }).click();
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Describe the after photo.")).toBeVisible();
  await after.getByRole("textbox", { name: "Describe it" }).fill("The loaf, baked");
  await after.getByRole("textbox", { name: "Name for this side" }).fill("The loaf");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Before and after photos: The dough, The loaf" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("pair")).toContain("```compare\nbefore: /images/uploads/2026/dough.png\nbefore-alt: The dough, risen\nbefore-label: The dough\nafter: /images/uploads/2026/loaf.png\nafter-alt: The loaf, baked\nafter-label: The loaf\n```");
});

test("a link stays words: added on the selected words, then changed and taken off from inside it", async ({ page }) => {
  await openPost(page, "link", `${front("Link")}\nSee my crust recipe today.\n`);
  const words = page.getByRole("textbox", { name: "Words", exact: true });
  await words.click();
  await words.evaluate((area) => { area.focus(); area.setSelectionRange(4, 19); area.dispatchEvent(new Event("select")); });
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A link", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Link" });
  // The form puts focus in its first field once it shows; wait for that before typing elsewhere.
  await expect(form.getByRole("textbox", { name: "Words to show" })).toBeFocused();
  await expect(form.getByRole("textbox", { name: "Words to show" })).toHaveValue("my crust recipe");
  await form.getByRole("textbox", { name: "Web address" }).fill("http://example.com");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("That needs to be a web address, starting with https://.")).toBeVisible();
  await form.getByRole("textbox", { name: "Web address" }).fill("https://example.com/crust/");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(words).toHaveValue("See [my crust recipe](https://example.com/crust/) today.");
  await words.evaluate((area) => { area.focus(); area.setSelectionRange(8, 8); area.dispatchEvent(new Event("select")); });
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const change = page.getByRole("dialog", { name: "Change this link" });
  await change.getByRole("button", { name: "Take the link off" }).click();
  await expect(words).toHaveValue("See my crust recipe today.");
});

test("a question for readers: each check said in her words, then it goes in as the quiz the build reads", async ({ page }) => {
  await openPost(page, "quiz", `${front("Quiz")}\nWords.\n`);
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A question for readers", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Question for readers" });
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Write the question.")).toBeVisible();
  await form.getByRole("textbox", { name: "The question" }).fill("What goes in first?");
  await form.getByRole("textbox", { name: "Answer 1" }).first().fill("Flour");
  await form.getByRole("textbox", { name: "Answer 2" }).first().fill("See [this](https://example.com)");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("A question for readers can't hold links or photos.")).toBeVisible();
  await form.getByRole("textbox", { name: "Answer 2" }).first().fill("Butter");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form.getByText("Choose the right answer.")).toBeVisible();
  await form.getByRole("group", { name: "Answer 1" }).getByText("This one is right").click();
  await axeClean(page, "the question for readers form");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(page.getByRole("group", { name: "Question for readers: What goes in first?" })).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(() => fileOf("quiz")).toContain("```quiz\nWhat goes in first?\n- [x] Flour\n- [ ] Butter\n```");
});

test("a server that doesn't answer keeps what she filled in and offers Try again", async ({ page }) => {
  await openPost(page, "fail", `${front("Fail")}\nWords.\n`);
  await page.route("**/admin/api/pieces", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{\"error\":\"down\"}" }));
  const sheet = await addFromWords(page);
  await sheet.getByRole("button", { name: "A video", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Video" });
  await form.getByRole("textbox", { name: "YouTube or Vimeo link" }).fill("https://vimeo.com/76979871");
  await form.getByRole("textbox", { name: "What it's about" }).fill("Shaping the loaf");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(form).toContainText("Your blog didn't answer, so it isn't in yet. What you filled in is kept.");
  await page.unroute("**/admin/api/pieces");
  await form.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("group", { name: "Video: Shaping the loaf" })).toBeVisible();
});

test("every form passes axe at 320 px without sideways scroll", async ({ page }) => {
  await openPost(page, "forms", `${front("Forms")}\nWords.\n`);
  for (const [item, title] of [["A photo", "Photo"], ["A tip or a note", "Tip"], ["A checklist", "Checklist"], ["A table", "Table"], ["A video", "Video"], ["A link", "Link"], ["A heading", "Heading"], ["A quote", "Quote"], ["Links to your other pages", "Links"], ["Opening hours", "Opening hours"], ["How to reach you", "How to reach you"]]) {
    const sheet = await addFromWords(page);
    const details = sheet.locator("details.studio-add-details");
    if (!(await details.evaluate((d) => d.open))) await details.locator("summary").click();
    await sheet.getByRole("button", { name: item, exact: true }).click();
    const form = page.getByRole("dialog", { name: title });
    await expect(form).toBeVisible();
    await axeClean(page, `the ${title} form`);
    await form.getByRole("button", { name: "‹ Everything you can add" }).click();
    await page.getByRole("dialog", { name: "Add something" }).getByRole("button", { name: "Never mind" }).click();
    await expect(page.getByRole("dialog", { name: "Add something" })).toBeHidden();
  }
});

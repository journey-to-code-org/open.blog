import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The published page of a post with author-written supplements (ADRs 0170-0173) from the real build
// and the real stylesheet and component: the standard, guided and deep-dive controls by keyboard
// and screen-reader name, state and description, a page that is complete without JavaScript, the
// choice kept on the device (and the page working when storage is blocked), reduced motion, a
// 320 CSS pixel and 400% zoom reflow measured on the article region, a warning that no mode hides,
// and links into a hidden supplement.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const contract = JSON.parse(readFileSync(join(repository, "tests", "fixtures", "reading-modes.json"), "utf8"));
const STORAGE_KEY = contract.storageKey;
const LONG_WORD = "Supercalifragilistic".repeat(8);
const LIBRARY = JSON.stringify({
  version: 1,
  sources: [
    { id: "plato-republic", kind: "work", title: "Politeia", creators: [{ name: "Plato", role: "author" }] },
    { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam", issued: "2003" },
  ],
});
const BODY = `The article opens here and never changes.

> [!supplement kind=definition level=guided] Aporia
> A state of puzzlement. ${LONG_WORD}

The argument goes on [@plato-republic].

> [!supplement kind=evidence level=deep-dive] The manuscripts
> ### Manuscripts
> Three witnesses agree [@slings-2003].
>
> > [!supplement kind=further-reading]
> > Read the edition.

> [!supplement kind=context] Handling
> Notes before the warning.
>
> > [!WARNING]
> > Do not heat the mixture.

The article ends here.
`;
const post = (title, front) => `---\ntitle: ${title}\ndate: 2026-10-20\n${front}citations: notes\n---\n${BODY}`;
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-reading-modes-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  const library = join(root, ".openblog", "private", "research", "sources.json");
  mkdirSync(dirname(library), { recursive: true });
  writeFileSync(library, LIBRARY);
  writeFileSync(join(root, "content", "posts", "modes.md"), post("Reading modes", "readingModes: true\n"));
  writeFileSync(join(root, "content", "posts", "guided.md"), post("Opens guided", "readingModes: {default: guided}\n"));
  writeFileSync(join(root, "content", "posts", "plain.md"), "---\ntitle: Plain\ndate: 2026-10-20\n---\nNo supplements here.\n\n> An ordinary quote.\n");
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/modes/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

const control = (page) => page.getByRole("group", { name: "Reading mode", exact: true });
const radio = (page, name) => page.getByRole("radio", { name, exact: true });
const supplement = (page, id) => page.locator(`#ob-supplement-${id}`);
const visibleSupplements = (page) =>
  page.locator(".ob-supplement").evaluateAll((nodes) => nodes.filter((node) => node.checkVisibility()).map((node) => node.id));
const stored = (page) => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);

async function open(page, slug = "modes", hash = "") {
  await page.goto(`${origin}/${slug}/${hash}`);
  await expect(control(page)).toBeVisible();
}

test("without JavaScript every supplement is written out visible, labelled and bounded, and no control exists", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${origin}/modes/`);
  await expect(page.locator("ob-reading-modes")).toHaveAttribute("default", "standard");
  await expect(control(page)).toHaveCount(0);
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-1", "ob-supplement-2", "ob-supplement-3", "ob-supplement-4"]);
  await expect(page.getByText("Do not heat the mixture.")).toBeVisible();
  await expect(page.getByText("Read the edition.")).toBeVisible();
  // Each supplement is a named group that starts with its label and ends with an end line.
  await expect(page.getByRole("group", { name: /Definition guided supplement Aporia/ })).toBeVisible();
  for (const end of ["definition", "evidence", "further reading", "context"]) {
    await expect(page.getByText(`End of ${end} supplement.`, { exact: true })).toBeVisible();
  }
  expect(await page.locator("[hidden].ob-supplement").count()).toBe(0);
  // The labelled quote is real structure, so it still reads as set apart with no stylesheet.
  await expect(page.locator("#ob-supplement-1 > blockquote")).toBeVisible();
  // A real heading inside a supplement, outside the table of contents.
  await expect(page.locator("#ob-supplement-2-h1")).toHaveText("Manuscripts");
  await context.close();
});

test("a post without supplements has no reading-mode element at all", async ({ page }) => {
  await page.goto(`${origin}/plain/`);
  await expect(page.getByRole("heading", { level: 1, name: "Plain" })).toBeVisible();
  await expect(page.locator("ob-reading-modes")).toHaveCount(0);
  await expect(control(page)).toHaveCount(0);
});

test("the group, its radios, their states and descriptions have screen-reader names", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("radio")).toHaveCount(3);
  for (const name of ["Standard", "Guided", "Deep dive"]) await expect(radio(page, name)).toBeVisible();
  // Standard unless the author chose another default; only one is selected.
  await expect(radio(page, "Standard")).toBeChecked();
  await expect(radio(page, "Guided")).not.toBeChecked();
  await expect(radio(page, "Deep dive")).not.toBeChecked();
  await expect(radio(page, "Standard")).toHaveAccessibleDescription(/The article, with 1 supplement that holds a warning\./);
  await expect(radio(page, "Guided")).toHaveAccessibleDescription(/short explanations: 2 of 4 supplements shown/);
  await expect(radio(page, "Deep dive")).toHaveAccessibleDescription(/everything the author added: 4 of 4 supplements shown/);
  await expect(page.getByRole("button", { name: "Use the author’s default" })).toBeDisabled();
  // Nothing is saved until the reader chooses.
  expect(await stored(page)).toBeNull();
});

test("standard hides the supplements but never a warning; guided and deep dive show more", async ({ page }) => {
  await open(page);
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-4"]);
  await expect(page.getByText("Do not heat the mixture.")).toBeVisible();
  await expect(supplement(page, 4)).toHaveAttribute("data-ob-always", "");
  await radio(page, "Guided").check();
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-1", "ob-supplement-4"]);
  await radio(page, "Deep dive").check();
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-1", "ob-supplement-2", "ob-supplement-3", "ob-supplement-4"]);
  await radio(page, "Standard").check();
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-4"]);
  await expect(page.getByText("Do not heat the mixture.")).toBeVisible();
});

test("the article is the same words, headings and citations in every mode", async ({ page }) => {
  await open(page);
  const article = () =>
    page.locator(".ob-prose").evaluate((node) => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll(".ob-supplement").forEach((item) => item.remove());
      return {
        text: copy.textContent.replace(/\s+/g, " ").trim(),
        headings: [...copy.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => `${heading.id}:${heading.textContent}`),
        notes: [...copy.querySelectorAll(".footnote-definition")].map((item) => item.id),
      };
    });
  const standard = await article();
  expect(standard.text).toContain("The article opens here and never changes.");
  for (const name of ["Guided", "Deep dive", "Standard"]) {
    await radio(page, name).check();
    expect(await article()).toEqual(standard);
  }
});

test("keyboard: arrows move inside the group and select, Tab leaves it, nothing traps focus", async ({ page }) => {
  await open(page);
  await radio(page, "Standard").focus();
  await page.keyboard.press("ArrowRight");
  await expect(radio(page, "Guided")).toBeChecked();
  await expect(radio(page, "Guided")).toBeFocused();
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-1", "ob-supplement-4"]);
  await page.keyboard.press("ArrowRight");
  await expect(radio(page, "Deep dive")).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(radio(page, "Guided")).toBeChecked();
  // The group is one tab stop; the next Tab reaches the reset button and the one after leaves.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Use the author’s default" })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await control(page).evaluate((group) => group.contains(document.activeElement))).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(radio(page, "Guided")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await control(page).evaluate((group) => group.contains(document.activeElement))).toBe(false);
});

test("a change is announced to screen readers in one polite status region", async ({ page }) => {
  await open(page);
  await expect(page.locator("ob-reading-modes [role=status]")).toHaveText("");
  await radio(page, "Guided").check();
  await expect(page.locator("ob-reading-modes [role=status]")).toHaveText("Guided reading. Showing 2 of 4 supplements.");
  await radio(page, "Deep dive").check();
  await expect(page.locator("ob-reading-modes [role=status]")).toHaveText("Deep dive reading. Showing 4 of 4 supplements.");
  await radio(page, "Standard").check();
  await expect(page.locator("ob-reading-modes [role=status]")).toHaveText("Standard reading. Showing 1 of 4 supplements.");
  await expect(page.locator("ob-reading-modes [role=status]")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("ob-reading-modes [role=status]")).toHaveCount(1);
});

test("the choice is kept on this device, is resettable, and nothing is sent anywhere", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request));
  await open(page);
  await radio(page, "Deep dive").check();
  expect(await stored(page)).toBe("deep-dive");
  await page.reload();
  await expect(radio(page, "Deep dive")).toBeChecked();
  expect(await visibleSupplements(page)).toHaveLength(4);
  const reset = page.getByRole("button", { name: "Use the author’s default" });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(radio(page, "Standard")).toBeChecked();
  expect(await stored(page)).toBeNull();
  await expect(page.locator("ob-reading-modes [role=status]")).toContainText("Your saved choice was cleared.");
  await expect(reset).toBeDisabled();
  // A value that is not a mode is ignored, not trusted.
  await page.evaluate((key) => localStorage.setItem(key, "<img src=x onerror=alert(1)>"), STORAGE_KEY);
  await page.reload();
  await expect(radio(page, "Standard")).toBeChecked();
  // Nothing was sent: no write of any kind, and no address carries the mode or the key.
  expect(requests.filter((request) => request.method() !== "GET")).toEqual([]);
  const addresses = requests.map((request) => new URL(request.url())).filter((url) => !url.pathname.endsWith(".js"));
  expect(addresses.some((url) => `${url.search}${url.hash}`.includes("deep-dive") || url.href.includes("deep-dive"))).toBe(false);
});

test("the author's default opens the post and reset returns to it; a saved choice wins", async ({ page }) => {
  await open(page, "guided");
  await expect(radio(page, "Guided")).toBeChecked();
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-1", "ob-supplement-4"]);
  await radio(page, "Deep dive").check();
  await page.reload();
  await expect(radio(page, "Deep dive")).toBeChecked();
  await page.getByRole("button", { name: "Use the author’s default" }).click();
  await expect(radio(page, "Guided")).toBeChecked();
  expect(await stored(page)).toBeNull();
});

test("blocked storage never breaks the page and the announcement says the choice was not saved", async ({ page }) => {
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException("denied", "SecurityError"); };
    Storage.prototype.getItem = deny;
    Storage.prototype.setItem = deny;
    Storage.prototype.removeItem = deny;
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(radio(page, "Standard")).toBeChecked();
  await radio(page, "Guided").check();
  expect(await visibleSupplements(page)).toEqual(["ob-supplement-1", "ob-supplement-4"]);
  await expect(page.locator("ob-reading-modes [role=status]")).toContainText("could not be saved on this device");
  await page.getByRole("button", { name: "Use the author’s default" }).waitFor({ state: "attached" });
  expect(errors).toEqual([]);
});

test("motion: supplements fade in only when the reader has not asked for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  await radio(page, "Guided").check();
  expect(await supplement(page, 1).evaluate((node) => getComputedStyle(node).animationName)).toBe("ob-supplement-in");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await radio(page, "Standard").check();
  await radio(page, "Guided").check();
  expect(await supplement(page, 1).evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
  expect(await supplement(page, 1).evaluate((node) => getComputedStyle(node).transitionDuration)).toMatch(/^0s/);
});

test("a link into a hidden supplement shows it, moves focus and says so", async ({ page }) => {
  await open(page, "modes", "#ob-supplement-2-h1");
  await expect(supplement(page, 2)).toBeVisible();
  await expect(page.locator("#ob-supplement-2-h1")).toBeVisible();
  await expect(page.locator("#ob-supplement-2-h1")).toBeFocused();
  await expect(page.locator("ob-reading-modes [role=status]")).toContainText("Showed the evidence supplement");
  // Only what the link needs: the other hidden supplement stays hidden, the mode is unchanged.
  await expect(supplement(page, 1)).toBeHidden();
  await expect(radio(page, "Standard")).toBeChecked();
  // Choosing a mode puts the reader's choice back in charge.
  await radio(page, "Guided").check();
  await expect(supplement(page, 2)).toBeHidden();
});

test("a note cited only inside a supplement names it, and following that note shows the supplement", async ({ page }) => {
  await open(page);
  const note = page.locator("[data-ob-supplement]:not(.ob-supplement)");
  await expect(note).toHaveCount(1);
  await expect(note).toHaveAttribute("data-ob-supplement", "ob-supplement-2");
  const id = await note.getAttribute("id");
  await expect(supplement(page, 2)).toBeHidden();
  await page.evaluate((target) => { location.hash = `#${target}`; }, id);
  await expect(supplement(page, 2)).toBeVisible();
  // The back-link from the note lands on the marker inside the supplement.
  await note.getByRole("link", { name: /Back/ }).click();
  await expect(supplement(page, 2)).toBeVisible();
  // The article's own note is not tied to a supplement.
  await expect(page.locator(".footnote-definition:not([data-ob-supplement])")).toHaveCount(1);
});

test("at 320 CSS pixels the article region reflows with no sideways scrolling in any mode", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  for (const name of ["Standard", "Guided", "Deep dive"]) {
    await radio(page, name).check();
    const measured = await page.evaluate(() => {
      const article = document.querySelector("article");
      const group = document.querySelector(".ob-reading-controls").getBoundingClientRect();
      const box = article.getBoundingClientRect();
      const wide = [...article.querySelectorAll("*")].filter((node) => node.checkVisibility() && node.getBoundingClientRect().right > box.right + 1);
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        article: article.scrollWidth - article.clientWidth,
        groupFits: group.left >= box.left - 1 && group.right <= box.right + 1,
        overflowing: wide.map((node) => node.tagName + "." + node.className),
      };
    });
    expect(measured.page, name).toBeLessThanOrEqual(0);
    expect(measured.article, name).toBeLessThanOrEqual(0);
    expect(measured.groupFits, name).toBe(true);
    expect(measured.overflowing, name).toEqual([]);
  }
});

test("at 400% zoom the control still reaches, labels and operates every option", async ({ browser }) => {
  // 400% of a 1280 pixel window is a 320 by 256 CSS pixel viewport at four device pixels per pixel.
  const context = await browser.newContext({ viewport: { width: 320, height: 256 }, deviceScaleFactor: 4 });
  const page = await context.newPage();
  await open(page);
  for (const name of ["Standard", "Guided", "Deep dive"]) {
    const option = radio(page, name);
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeVisible();
    const label = page.getByText(name, { exact: true }).first();
    const box = await label.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.x + box.width).toBeLessThanOrEqual(320 + 1);
  }
  await page.getByText("Deep dive", { exact: true }).first().click();
  await expect(radio(page, "Deep dive")).toBeChecked();
  expect(await visibleSupplements(page)).toHaveLength(4);
  const overflow = await page.evaluate(() => document.querySelector("article").scrollWidth - document.querySelector("article").clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

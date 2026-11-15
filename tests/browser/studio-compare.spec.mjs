import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, readPrivate } from "./research-site.mjs";

// Compare (Studio R12, #/research/compare[/<id>]): ports the old Admin's compare.spec. An alignment
// of places in two versions, read side by side with every word exactly as kept; copying words
// whose rights aren't cleared asks once; private notes stay out unless included; Undo where the
// old Admin asked; 320 px and axe.

let site;
const BLOOM = { id: "republic-bloom", kind: "translation", of: "plato-republic", title: "Republic, tr. Bloom", language: "en", creators: [{ name: "Allan Bloom", role: "translator" }] };
const GREEK = { id: "passage-grc", source: "republic-bloom", excerpt: { text: "  Next, then, make an image of our nature\n  in its education ", language: "en" }, locators: [{ kind: "page", value: "193" }] };
const NOTE = "PRIVATE-PLACE-NOTE-55";

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
test.beforeAll(async () => {
  site = await startSite("research-compare");
  const api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION, BLOOM]);
  await addEntries(api, [PASSAGE, GREEK]);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

const stored = () => JSON.parse(readPrivate(site, "alignments.json"));
const screen = (page) => page.locator(".studio-research-compare");

test("add an alignment of two versions: words read exactly, it's private, and a change has Undo", async ({ page }) => {
  await open(page, site, "#/research/compare");
  await expect(page.getByRole("heading", { name: "Compare versions", level: 2 })).toBeFocused();
  await expect(screen(page)).toContainText("Nothing to compare yet");
  await page.getByRole("button", { name: "Add an alignment" }).first().click();
  const form = page.locator(".studio-compare-pane");
  await expect(form).toContainText("never that they mean the same thing");
  await form.getByRole("textbox", { name: "Name" }).fill("The cave, opening");
  await form.getByRole("combobox", { name: "Version for place 1" }).selectOption("republic-slings");
  await form.getByRole("combobox", { name: "Passage from your notebook for place 1" }).selectOption("passage-1");
  await form.getByRole("combobox", { name: "Version for place 2" }).selectOption("republic-bloom");
  await form.getByRole("combobox", { name: "Passage from your notebook for place 2" }).selectOption("passage-grc");
  await form.getByRole("textbox", { name: "Your note on place 2" }).fill(NOTE);
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(screen(page)).toContainText("Alignment added.");
  const alignment = stored().alignments[0];
  expect(alignment).toMatchObject({ id: "the-cave-opening", label: "The cave, opening", visibility: "private" });
  expect(alignment.members.map((m) => [m.source, m.passage])).toEqual([["republic-slings", "passage-1"], ["republic-bloom", "passage-grc"]]);
  await expect(screen(page)).toContainText("Private: not published.");
  const words = page.locator(".studio-compare-words");
  await expect(words).toHaveCount(2);
  expect(await words.nth(1).evaluate((el) => el.textContent)).toBe(GREEK.excerpt.text);
  await expect(page.locator(".studio-compare-side")).toBeVisible();

  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.locator(".studio-compare-pane").getByRole("textbox", { name: "Your reasoning" }).fill("Both open the image.");
  await page.locator(".studio-compare-pane").getByRole("button", { name: "Save", exact: true }).click();
  await expect(screen(page)).toContainText("Alignment saved.");
  expect(stored().alignments[0].rationale).toBe("Both open the image.");
  await page.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(screen(page)).toContainText("Undone.");
  expect(stored().alignments[0].rationale).toBeUndefined();
});

test("downloading places asks once when rights aren't cleared, keeps the words exact, and leaves notes out unless asked", async ({ page }) => {
  await open(page, site, "#/research/compare/the-cave-opening");
  await page.getByRole("button", { name: "Download" }).click();
  await expect(screen(page)).toContainText("Select at least one place first.");
  await page.getByRole("checkbox", { name: "Select place 2" }).check();
  await expect(screen(page)).toContainText("1 places selected.");
  await page.getByRole("button", { name: "Download" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Copy words whose rights aren't cleared?");
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeFocused();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Copy them" }).click()]);
  expect(download.suggestedFilename()).toBe("alignment-the-cave-opening.txt");
  const text = readFileSync(await download.path(), "utf8");
  expect(text).toContain(`The exact words, from your notebook:\n${GREEK.excerpt.text}\n`);
  expect(text).not.toContain(NOTE);
  expect(text).not.toContain(PASSAGE.excerpt.text, "an unselected place stays out");
  await page.getByRole("checkbox", { name: "Include my notes on places" }).check();
  const [again] = await Promise.all([page.waitForEvent("download"), (async () => {
    await page.getByRole("button", { name: "Download" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Copy them" }).click();
  })()]);
  expect(readFileSync(await again.path(), "utf8")).toContain(`Your note: ${NOTE}`);
});

test("taking out an alignment has Undo, and the old address opens Compare", async ({ page }) => {
  await open(page, site, "#/compare/the-cave-opening");
  await expect(page).toHaveURL(/#\/research\/compare\/the-cave-opening$/);
  await expect(page.locator(".studio-compare-pane h3").first()).toHaveText("The cave, opening");
  await page.locator(".studio-research-entry-head dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take out this alignment" }).click();
  await expect(screen(page)).toContainText("Alignment taken out.");
  expect(stored().alignments).toEqual([]);
  await page.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(screen(page)).toContainText("Undone.");
  expect(stored().alignments[0].id).toBe("the-cave-opening");
});

test.describe("at 320 px", () => {
  test.use({ viewport: { width: 320, height: 720 } });
  test("versions follow one another, with no sideways scroll, and pass axe", async ({ page }) => {
    await open(page, site, "#/research/compare/the-cave-opening");
    await expect(page.locator(".studio-compare-column")).toHaveCount(2);
    const [a, b] = await page.locator(".studio-compare-column").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(b).toBeGreaterThan(a);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await axeClean(page, "Compare, an alignment", ".studio-research-compare");
    await page.getByRole("button", { name: "Change", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await axeClean(page, "Compare, the form", ".studio-research-compare");
  });
});

import { test, expect } from "@playwright/test";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, readPost, writePost } from "./research-site.mjs";

// Citing while she writes (Studio R11): Cite in Add something, Cited here chips, quotation cards
// and Your research. Ports the old Admin's citations.spec (insert from the keyboard and Undo the
// exact words, Escape leaves the words alone, a stale library refused then accepted, an unknown
// place reported) and draft-research.spec (a quotation with its citation, one source gives one
// citation, a note goes in only when converted, keyboard and 320 px; the Visual-mode cases went
// with Visual mode).

let site;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-cite");
  const api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION]);
  await addEntries(api, [PASSAGE, { id: "note-1", kind: "observation", text: "The fire is the sun.\n\nAnd *more*.", passages: ["passage-1"] }]);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

async function openPost(page, file, text) {
  writePost(site, file, text);
  await open(page, site, `#/write/${encodeURIComponent(`posts/${file}`)}`);
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}
const words = (page) => page.getByRole("textbox", { name: "Words", exact: true });
async function caretAt(page, text) {
  const area = words(page);
  await area.click();
  await area.evaluate((node, at) => { const i = node.value.indexOf(at) + at.length; node.setSelectionRange(i, i); node.dispatchEvent(new Event("select")); node.dispatchEvent(new KeyboardEvent("keyup")); }, text);
}

test("cite from the keyboard: the marker goes in at the caret, a chip says it, the first one turns on notes, and Undo takes both back", async ({ page }) => {
  const original = "---\ntitle: The cave\ndraft: true\n---\n\nThe prisoners see only shadows.\n";
  await openPost(page, "cave.md", original);
  await caretAt(page, "only shadows");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.locator("side-sheet.studio-add-sheet");
  await sheet.getByRole("button", { name: /A citation/ }).click();
  await expect(sheet).toContainText("It goes in your words, after");
  await sheet.getByRole("searchbox", { name: "Find a source" }).fill("slings");
  await sheet.getByRole("radio", { name: "Republic, tr. Slings" }).check();
  await sheet.getByRole("button", { name: "Add another place" }).click();
  await sheet.getByRole("textbox", { name: "Place 1", exact: true }).fill("514");
  await expect(sheet).toContainText("Reads as: Republic, tr. Slings, p. 514");
  await page.keyboard.press("Control+Enter");
  await expect(words(page)).toHaveValue("The prisoners see only shadows [@republic-slings, page 514].");
  await expect(page.locator(".studio-cited-here")).toContainText("Republic, tr. Slings, p. 514");
  await expect(page.locator(".studio-piece-said")).toContainText("Cited. Your sources will show as numbered notes at the end.");
  // About this post › Sources in this post shows the choice it made.
  await page.getByRole("button", { name: /About this post/ }).click();
  const about = page.locator("side-sheet.studio-about-sheet");
  await expect(about.getByRole("radio", { name: "Numbered notes at the end" })).toBeChecked();
  await about.getByRole("button", { name: "Done" }).click();
  // Undo takes back the citation and the choice: with neither, the group isn't there.
  await page.locator(".studio-piece-said").getByRole("button", { name: "Undo" }).click();
  await expect(words(page)).toHaveValue("The prisoners see only shadows.");
  await page.getByRole("button", { name: /About this post/ }).click();
  await expect(about.locator(".studio-sources-in-post")).toBeHidden();
});

test("chips: Change opens the citation filled in; Show me selects it; Take it out removes it and one space, with Undo", async ({ page }) => {
  await openPost(page, "chips.md", "---\ntitle: Chips\ndraft: true\ncitations: notes\n---\n\nShadows [@republic-slings, page 514] and fire [@nobody].\n");
  const chips = page.locator(".studio-cited-here .studio-cite-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toContainText("Not in your library: nobody");
  await chips.first().getByRole("button").click();
  await page.getByRole("menuitem", { name: "Show me" }).click();
  const selected = await words(page).evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd));
  expect(selected).toBe("[@republic-slings, page 514]");
  await chips.first().getByRole("button").click();
  await page.getByRole("menuitem", { name: "Change" }).click();
  const sheet = page.locator("side-sheet.studio-add-sheet");
  await expect(sheet.getByRole("radio", { name: "Republic, tr. Slings" })).toBeChecked();
  await expect(sheet.getByRole("textbox", { name: "Place 1", exact: true })).toHaveValue("514");
  // Done with nothing changed writes nothing.
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(words(page)).toHaveValue("Shadows [@republic-slings, page 514] and fire [@nobody].");
  await chips.nth(1).getByRole("button").click();
  await page.getByRole("menuitem", { name: "Take it out" }).click();
  await expect(words(page)).toHaveValue("Shadows [@republic-slings, page 514] and fire.");
  await expect(page.locator(".studio-piece-said")).toContainText("Citation taken out.");
  await page.locator(".studio-piece-said").getByRole("button", { name: "Undo" }).click();
  await expect(words(page)).toHaveValue("Shadows [@republic-slings, page 514] and fire [@nobody].");
});

test("a citation can't go inside a link: Cite says why and won't put it in", async ({ page }) => {
  await openPost(page, "link.md", "---\ntitle: Link\ndraft: true\n---\n\nSee [the cave story](https://example.com/cave) here.\n");
  await caretAt(page, "the cave");
  // With the caret in a link Add something changes the link, so Cite comes from Find.
  await page.keyboard.press("Control+k");
  await page.locator("command-palette input").fill("Add a citation");
  await page.keyboard.press("Enter");
  const sheet = page.locator("side-sheet.studio-add-sheet");
  await expect(sheet).toContainText("A citation can't go inside a link. Put your cursor after it.");
  await expect(sheet.getByRole("button", { name: "Cite it" })).toBeDisabled();
});

test("a quotation from her notebook goes in exactly as kept with its citation, as a card she can move and undo", async ({ page }) => {
  await openPost(page, "quote.md", "---\ntitle: Quote\ndraft: true\ncitations: notes\n---\n\nFirst paragraph.\n\nSecond paragraph.\n");
  await caretAt(page, "First paragraph.");
  await page.locator(".studio-write-bar dropdown-menu, .studio-write dropdown-menu").first().getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Your research…" }).click();
  const panel = page.locator("side-sheet").filter({ hasText: "Only what you put in goes into this post." });
  await panel.getByRole("button", { name: /Passage: Republic, tr. Slings, page 514/ }).click();
  await expect(panel.locator("blockquote")).toHaveText("and they see only their own shadows");
  await panel.getByRole("button", { name: "Put the quotation in" }).click();
  // Rights nobody has checked: asked once, Not now has focus.
  const dialog = page.locator("modal-dialog");
  await expect(dialog).toContainText("Quote words whose rights nobody has checked?");
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeFocused();
  await dialog.getByRole("button", { name: "Quote them" }).click();
  await page.keyboard.press("Escape");
  const card = page.locator('[data-card-kind="quotation"]');
  await expect(card).toContainText("Quotation");
  await expect(card).toContainText("and they see only their own shadows");
  await expect(card).toContainText("From Republic, tr. Slings, p. 514");
  await page.keyboard.press("Control+s");
  await expect.poll(() => readPost(site, "quote.md")).toContain("First paragraph.\n\n> and they see only their own shadows [@republic-slings, page 514]\n\nSecond paragraph.");
  // Move it down, then Undo.
  await card.locator("dropdown-menu").getByRole("button").click();
  await page.getByRole("menuitem", { name: "Move down" }).click();
  await expect(page.locator(".studio-piece-said")).toContainText(/Moved/);
  await page.locator(".studio-piece-said").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-piece-said")).toContainText("Taken back.");
});

test("a note goes in only when she turns it into her own words, after one question", async ({ page }) => {
  await openPost(page, "note.md", "---\ntitle: Note\ndraft: true\n---\n\nMy words.\n");
  await caretAt(page, "My words.");
  await page.locator(".studio-write dropdown-menu").first().getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Your research…" }).click();
  const panel = page.locator("side-sheet").filter({ hasText: "Only what you put in goes into this post." });
  await expect(panel.getByRole("button", { name: /^Note:/ })).toHaveCount(0);
  await panel.getByRole("combobox", { name: "Show" }).selectOption("notes");
  await panel.getByRole("button", { name: /^Note: Observation/ }).click();
  await panel.getByRole("button", { name: "Turn into my own words…" }).click();
  const dialog = page.locator("modal-dialog");
  await expect(dialog).toContainText("Put this note in your post as your own words?");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(words(page)).toHaveValue("My words.");
  await panel.getByRole("button", { name: "Turn into my own words…" }).click();
  await page.locator("modal-dialog").getByRole("button", { name: "Put it in" }).click();
  await expect(words(page)).toHaveValue("My words.\n\nThe fire is the sun.\n\nAnd \\*more\\*.");
});

test("with no signal, Cite waits and keeps what she chose, even across a reload", async ({ page }) => {
  await openPost(page, "offline.md", "---\ntitle: Offline\ndraft: true\n---\n\nWords here.\n");
  await caretAt(page, "Words here.");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.locator("side-sheet.studio-add-sheet");
  await sheet.getByRole("button", { name: /A citation/ }).click();
  await sheet.getByRole("radio", { name: "Republic", exact: true }).check();
  await page.route("**/admin/api/citations/check", (route) => route.abort());
  await sheet.getByRole("button", { name: "Cite it" }).click();
  await expect(sheet).toContainText("Waiting for a signal. What you chose is kept here.");
  await expect(words(page)).toHaveValue("Words here.");
  await page.unroute("**/admin/api/citations/check");
  await page.reload();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
  await caretAt(page, "Words here.");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  await page.locator("side-sheet.studio-add-sheet").getByRole("button", { name: /A citation/ }).click();
  await expect(page.locator("side-sheet.studio-add-sheet").getByRole("radio", { name: "Republic", exact: true })).toBeChecked();
});

test("Your research docks beside the words at 1280 px and is a sheet at 400 px; both pass axe", async ({ page }) => {
  await openPost(page, "dock.md", "---\ntitle: Dock\ndraft: true\nprofile: research\n---\n\nShadows [@republic-slings, page 514].\n");
  await page.locator(".studio-write dropdown-menu").first().getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Your research…" }).click();
  await expect(page.locator("side-sheet .studio-yours")).toBeVisible();
  await axeClean(page, "Your research as a sheet", "side-sheet:has(.studio-yours)");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".studio-write dropdown-menu").first().getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Your research…" }).click();
  const aside = page.locator("aside.studio-your-research");
  await expect(aside).toBeVisible();
  await expect(aside.getByRole("heading", { name: "Your research", level: 2 })).toBeFocused();
  // Write stays editable while it's docked.
  await words(page).click();
  await page.keyboard.type(" More.");
  await expect(words(page)).toHaveValue(/More\./);
  await aside.getByRole("button", { name: "Close your research" }).click();
  await expect(aside).toHaveCount(0);
});

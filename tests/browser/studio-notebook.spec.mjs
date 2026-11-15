import { test, expect } from "@playwright/test";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, readPrivate } from "./research-site.mjs";

// The notebook (Studio R11, #/research/notebook): passages and notes, a search whose words never
// reach an address, Undo where the old Admin asked, and copies that ask once. Ports the notebook
// cases of the old Admin's research-workspace.spec (a kept draft, a conflict that keeps it).

let site;
const SECRET = "PRIVATE-NOTE-7781";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-notebook");
  const api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION]);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

const notebook = () => JSON.parse(readPrivate(site, "notebook.json"));

test("keep a passage with a note about it: the exact words as typed, the places as rows, and the note linked", async ({ page }) => {
  await open(page, site, "#/research/notebook");
  await expect(page.getByRole("heading", { name: "Your notebook", level: 2 })).toBeFocused();
  await expect(page.locator(".studio-research-notebook")).toContainText("Nothing kept yet");
  await page.getByRole("button", { name: "Keep a passage" }).first().click();
  const form = page.locator(".studio-research-entry");
  await form.getByRole("combobox", { name: "From" }).selectOption("republic-slings");
  const words = "  and they see only\ntheir own *shadows*  ";
  await form.getByRole("textbox", { name: "The exact words" }).fill(words);
  await form.getByRole("button", { name: "Add another place" }).click();
  await form.getByRole("textbox", { name: "Place 1", exact: true }).fill("514");
  await form.getByRole("textbox", { name: "Place 1 ends at" }).fill("515");
  await form.getByRole("textbox", { name: "Your note" }).fill(`Is the fire the sun? ${SECRET}`);
  await form.getByRole("button", { name: "Keep it" }).click();
  await expect(page.locator(".studio-research-notebook")).toContainText("Kept in your notebook.");
  const stored = notebook();
  const passage = stored.passages[0];
  expect(passage.excerpt.text).toBe(words);
  expect(passage.locators).toEqual([{ kind: "page", value: "514", to: "515" }]);
  expect(stored.notes[0].passages).toEqual([passage.id]);
  expect(stored.notes[0].text).toContain(SECRET);
});

test("search travels in the request body, never the address, and says where it found the words", async ({ page }) => {
  const urls = [];
  page.on("request", (request) => urls.push(request.url()));
  await open(page, site, "#/research/notebook");
  await page.getByRole("searchbox", { name: "Search your notebook" }).fill("shadows");
  await expect(page.locator(".studio-research-notebook")).toContainText(/1 found/);
  await expect(page.locator(".studio-research-list")).toContainText("Found in: the exact words");
  expect(urls.filter((url) => /shadows/.test(url))).toEqual([]);
  expect(page.url()).not.toMatch(/shadows/);
});

test("changing a passage gives Undo; taking out a note gives Undo; a passage notes point to can't be taken out", async ({ page }) => {
  const before = notebook();
  const passageId = before.passages[0].id;
  await open(page, site, `#/research/notebook/${passageId}`);
  const entry = page.locator(".studio-research-entry");
  await expect(entry.getByRole("textbox", { name: "The exact words" })).toHaveValue(before.passages[0].excerpt.text);
  await expect(entry).toContainText("A passage stays with its source.");
  await expect(entry).toContainText(/Also about this passage \(1\)/);
  await entry.getByRole("textbox", { name: "Language (optional)" }).fill("Greek");
  await entry.getByRole("button", { name: "Save changes" }).click();
  await expect(entry).toContainText("Saved.");
  expect(notebook().passages[0].excerpt.language).toBe("el");
  await entry.getByRole("button", { name: "Undo" }).click();
  await expect(entry).toContainText("Undone.");
  expect(notebook().passages[0].excerpt.language).toBe(before.passages[0].excerpt.language);
  // A passage with a note about it: the server refuses, and she's told why.
  await entry.locator(".studio-research-buttons dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take it out" }).click();
  await expect(page.locator(".studio-research-notebook")).toContainText(/notes are about this passage/);
  expect(notebook().passages.length).toBe(1);
  // The note can go, and Undo puts it back as it was.
  const noteId = notebook().notes[0].id;
  await open(page, site, `#/research/notebook/${noteId}`);
  await page.locator(".studio-research-buttons dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take it out" }).click();
  await expect(page.locator(".studio-research-notebook")).toContainText("Taken out of your notebook.");
  expect(notebook().notes.length).toBe(0);
  await page.locator(".studio-research-notebook .studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-research-notebook")).toContainText("Undone.");
  expect(notebook().notes.map((n) => n.id)).toEqual([noteId]);
});

test("a note that fails after its passage is kept says so on the note, and the passage stays", async ({ page }) => {
  await open(page, site, "#/research/notebook");
  await page.route("**/admin/api/research/notes", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, json: { error: "disk" } }) : route.fallback()));
  await page.getByRole("button", { name: "Keep a passage" }).first().click();
  const form = page.locator(".studio-research-entry");
  await form.getByRole("combobox", { name: "From" }).selectOption("republic-slings");
  await form.getByRole("textbox", { name: "The exact words" }).fill("the sun is the cause");
  await form.getByRole("textbox", { name: "Your note" }).fill("A note that won't save.");
  const count = notebook().passages.length;
  await form.getByRole("button", { name: "Keep it" }).click();
  await expect(form).toContainText("The passage is kept, but the note isn't.");
  expect(notebook().passages.length).toBe(count + 1);
});

test("save a copy asks once and Not now has focus; bring in a copy checks first and adds only", async ({ page }) => {
  await open(page, site, "#/research/notebook");
  await page.locator(".studio-research-top dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Save a copy of your notebook…" }).click();
  const dialog = page.locator("modal-dialog");
  await expect(dialog).toContainText("Keep it somewhere private");
  await expect(dialog.getByRole("button", { name: "Not now" })).toBeFocused();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save the copy" }).click();
  const file = await download;
  await expect(page.locator(".studio-research-notebook")).toContainText(/Saved .+: \d+ passages and \d+ notes\./);
  const content = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  // Bring the same copy in: everything is already here.
  await page.locator(".studio-research-top dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Bring in a notebook copy…" }).click();
  const sheet = page.locator("side-sheet").filter({ hasText: "Bring in a notebook copy" });
  await sheet.locator("input[type=file]").setInputFiles({ name: "copy.json", mimeType: "application/json", buffer: Buffer.from(content) });
  await sheet.getByRole("button", { name: "Check what it would do" }).click();
  await expect(sheet).toContainText(/0 to add, \d+ already here, 0 in conflict\./);
  await expect(sheet.getByRole("button", { name: /^Bring in \d/ })).toBeHidden();
});

test("the notebook from the keyboard, at 320 px, with an entry open", async ({ page }) => {
  await addEntries(await apiFor(site), [{ ...PASSAGE, id: "passage-keys" }]);
  await open(page, site, "#/research/notebook/passage-keys");
  await expect(page.locator(".studio-research-entry")).toBeVisible();
  await axeClean(page, "Notebook with a passage open", ".studio-research-notebook");
  await page.getByRole("button", { name: "‹ Your notebook" }).click();
  await expect(page.locator(".studio-research-side")).toBeVisible();
  await axeClean(page, "Notebook, the list", ".studio-research-notebook");
});

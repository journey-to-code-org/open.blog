import { test, expect } from "@playwright/test";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { TRANSLATION, WORK, addSources, apiFor, readPrivate, writePost, writePrivate } from "./research-site.mjs";

// Research home and Sources (Studio R11, docs/specs/studio/r11/ux.md). Ports the old Admin's
// research-workspace.spec (the redirects, the steps from a first source to a cited post, an
// unreadable store in its own step, kept forms across screens, keyboard, 320 px) and adds the gate
// (G92): a site that doesn't use research sees none of it, and Find's developer entry opens home.

let plain;
let site;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  plain = await startSite("research-gate");
  site = await startSite("research-home");
});
test.afterAll(async () => { await stopSite(plain); await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

const RESEARCH_WORDS = /\b(research|citation|cite|quotation|sources in this post|notebook)\b/i;

test("a site that doesn't use research sees none of it, and Find's developer entry opens Research home", async ({ page }) => {
  const asked = [];
  page.on("request", (request) => { if (/\/admin\/api\/(sources|research\/|citations\/)/.test(request.url())) asked.push(request.url()); });
  await open(page, plain, "#/");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  const nav = await page.locator("dashboard-shell nav, .studio-shell nav").first().innerText().catch(() => "");
  expect(nav).not.toMatch(/Research/);
  // Write: no Cite or quotation in Add something, nothing under the words, no research in About this post.
  writePost(plain, "plain.md", "---\ntitle: Plain\ndraft: true\n---\n\nJust words.\n");
  await open(page, plain, `#/write/${encodeURIComponent("posts/plain.md")}`);
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "Add something to Words" }).click();
  const sheet = page.locator("side-sheet.studio-add-sheet");
  await expect(sheet.getByRole("button", { name: /A photo/ })).toBeVisible();
  await expect(sheet).not.toContainText(/citation|quotation/i);
  await page.keyboard.press("Escape");
  expect(await page.locator(".studio-cited-here, .studio-under-words, .studio-sources-in-post").count()).toBe(0);
  // Find has the developer's door only.
  await page.keyboard.press("Control+k");
  const palette = page.locator("command-palette");
  await palette.locator("input").fill("research");
  await expect(palette.getByText("Start research (for the person who set up your site)")).toBeVisible();
  await palette.locator("input").fill("notebook");
  await expect(palette.getByText("Keep a passage")).toHaveCount(0);
  await palette.locator("input").fill("research");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/research$/);
  await expect(page.getByRole("heading", { name: "Start your research", level: 2 })).toBeVisible();
  // Nothing was asked of the research API until the developer opened it.
  expect(asked.filter((url) => !/\/admin\/api\/(sources|research\/(notebook|atlas|alignments))$/.test(url))).toEqual([]);
  expect(asked.length).toBeGreaterThan(0);
});

test("an empty library: Research home leads to the first source, every step says it's private, and nothing overflows", async ({ page }) => {
  await open(page, site, "#/research");
  await expect(page.getByRole("heading", { name: "Start your research", level: 2 })).toBeFocused();
  const home = page.locator(".studio-research-home");
  await expect(home.getByRole("link", { name: "Add your first source" }).first()).toHaveAttribute("href", "#/research/sources?new=1");
  await expect(home.locator(".studio-research-step")).toHaveCount(5);
  await expect(home.locator('[data-step="relate"]')).toContainText("Optional.");
  await expect(home.locator('[data-step="public"] status-badge')).toHaveText("Readers see this");
  await expect(home.locator('[data-step="source"]')).toContainText("Not started: your library is empty.");
  await expect(home.locator('[data-step="source"] status-badge')).toHaveText("Private");
  await expect(home.locator('[data-step="cite"] status-badge')).toHaveText("Readers see this");
  await expect(home).toContainText("Everything here is private.");
  const text = await home.evaluate((node) => [...node.querySelectorAll(":scope > :not(details)")].map((c) => c.innerText).join("\n"));
  expect(text).not.toMatch(/\b(json|revision|\.openblog|capture|metadata|sync)\b/i);
  await axeClean(page, "Research home", ".studio-research-home");
});

test("the old research addresses open the same places in Studio", async ({ page }) => {
  await open(page, site, "#/research/overview");
  await expect(page).toHaveURL(/#\/research$/);
  await open(page, site, "#/sources");
  await expect(page).toHaveURL(/#\/research\/sources$/);
  await expect(page.getByRole("heading", { name: "Your sources", level: 2 })).toBeVisible();
  await open(page, site, "#/research/nope");
  await expect(page).toHaveURL(/#\/research$/);
  // R12: the atlas, Compare and What readers see are Studio's own.
  await open(page, site, "#/atlas");
  await expect(page).toHaveURL(/#\/research\/atlas$/);
  await expect(page.getByRole("heading", { name: "Your atlas", level: 2 })).toBeVisible();
  await open(page, site, "#/compare");
  await expect(page).toHaveURL(/#\/research\/compare$/);
  await open(page, site, "#/research/public");
  await expect(page.getByRole("heading", { name: "What readers see from your research", level: 2 })).toBeVisible();
});

test("add a source with people and identifiers as rows, then edit it and undo", async ({ page }) => {
  await open(page, site, "#/research/sources");
  await page.getByRole("button", { name: "Add a source" }).first().click();
  const form = page.locator(".studio-research-form");
  await form.getByRole("textbox", { name: "Title" }).fill("Republic");
  await expect(form.getByRole("textbox", { name: "Key" })).toHaveValue("republic");
  await form.getByRole("textbox", { name: "Key" }).fill("plato-republic");
  await form.getByRole("button", { name: "Add a person" }).click();
  await form.getByRole("textbox", { name: "Name of person 1" }).fill("Plato");
  await form.getByRole("button", { name: "Add an identifier" }).click();
  await form.getByRole("textbox", { name: "Identifier 1" }).fill("10.1000/1");
  await form.getByRole("button", { name: "Add the source" }).click();
  await expect(page.locator(".studio-research-sources")).toContainText("Source added. To set it aside, archive it.");
  const stored = JSON.parse(readPrivate(site, "sources.json"));
  const record = stored.sources.find((s) => s.id === "plato-republic");
  expect(record.creators).toEqual([{ name: "Plato", role: "author" }]);
  expect(record.identifiers).toEqual([{ scheme: "doi", value: "10.1000/1" }]);
  // Edit, then Undo puts the record back.
  await page.locator('[data-source="plato-republic"]').click();
  await form.getByRole("textbox", { name: "Title" }).fill("Politeia");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toContainText("Saved.");
  expect(JSON.parse(readPrivate(site, "sources.json")).sources.find((s) => s.id === "plato-republic").title).toBe("Politeia");
  await form.getByRole("button", { name: "Undo" }).click();
  await expect(form).toContainText("Undone.");
  expect(JSON.parse(readPrivate(site, "sources.json")).sources.find((s) => s.id === "plato-republic").title).toBe("Republic");
});

test("archive says posts still show it, and Undo restores it", async ({ page }) => {
  const api = await apiFor(site);
  if (!(await api.call("GET", "sources")).json.sources.some((s) => s.id === "republic-slings")) await addSources(api, [TRANSLATION]);
  await open(page, site, "#/research/sources/republic-slings");
  const form = page.locator(".studio-research-form");
  await expect(form.getByRole("textbox", { name: "Title" })).toHaveValue("Republic, tr. Slings");
  await form.locator("dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Archive this source" }).click();
  await expect(form).toContainText("Archived. Posts that cite it still show it.");
  expect(JSON.parse(readPrivate(site, "sources.json")).sources.find((s) => s.id === "republic-slings").archived).toBe(true);
  await form.getByRole("button", { name: "Undo" }).click();
  await expect(form).toContainText("Undone.");
  expect(JSON.parse(readPrivate(site, "sources.json")).sources.find((s) => s.id === "republic-slings").archived).toBeFalsy();
});

test("a library changed elsewhere keeps her changes, and Keep mine saves them on the newer library", async ({ page }) => {
  const api = await apiFor(site);
  if (!(await api.call("GET", "sources")).json.sources.some((s) => s.id === "republic-slings")) await addSources(api, [TRANSLATION]);
  await open(page, site, "#/research/sources/republic-slings");
  const form = page.locator(".studio-research-form");
  await form.getByRole("textbox", { name: "Date (optional)" }).fill("2003, revised");
  // Someone changes the library in another tab.
  const library = await api.call("GET", "sources");
  const other = library.json.sources.find((s) => s.id === "republic-slings");
  expect((await api.call("PUT", "sources", { revision: library.json.revision, source: { ...other, title: "Republic, tr. Slings (OCT)" } })).status).toBe(200);
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form.locator("alert-banner")).toContainText("Your library changed somewhere else, so nothing was saved. Your changes are still here.");
  await expect(form.getByRole("textbox", { name: "Date (optional)" })).toHaveValue("2003, revised");
  await form.getByRole("button", { name: "Keep mine, on the newer library" }).click();
  await expect(form).toContainText("Your changes now sit on the newer library. Check them, then save.");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toContainText("Saved.");
  expect(JSON.parse(readPrivate(site, "sources.json")).sources.find((s) => s.id === "republic-slings").issued).toBe("2003, revised");
});

test("import checks first, says what it would do in her words, and imports only when asked; export saves a file", async ({ page }) => {
  await open(page, site, "#/research/sources");
  await page.locator(".studio-research-top dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Import sources…" }).click();
  const sheet = page.locator("side-sheet").filter({ hasText: "Import sources" });
  await expect(sheet).toContainText("never removes any");
  const csl = JSON.stringify([{ id: "item-1", type: "book", title: "Meno <img src=x onerror=alert(1)>", author: [{ family: "Plato" }], issued: { "date-parts": [[1956]] } }]);
  await sheet.getByRole("textbox", { name: "Or paste it" }).fill(csl);
  const before = readPrivate(site, "sources.json");
  await sheet.getByRole("button", { name: "Check what it would do" }).click();
  await expect(sheet).toContainText("1 new");
  expect(await sheet.locator("img").count()).toBe(0);
  expect(readPrivate(site, "sources.json")).toBe(before);
  // Editing the text after a check hides Import until it is checked again.
  await sheet.getByRole("textbox", { name: "Or paste it" }).fill(`${csl} `);
  await expect(sheet.getByRole("button", { name: /^Import \d/ })).toBeHidden();
  await expect(sheet).toContainText("The text changed. Check it again.");
  await sheet.getByRole("button", { name: "Check what it would do" }).click();
  await sheet.getByRole("button", { name: "Import 1" }).click();
  await expect(sheet).toContainText("Imported:");
  expect(JSON.parse(readPrivate(site, "sources.json")).sources.some((s) => /Meno/.test(s.title || ""))).toBe(true);
  await page.keyboard.press("Escape");
  // Export: a file made in the page.
  await page.locator(".studio-research-top dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Export your library…" }).click();
  const exportSheet = page.locator("side-sheet").filter({ hasText: "Export your library" });
  await exportSheet.getByText("BibTeX", { exact: true }).click();
  const download = page.waitForEvent("download");
  await exportSheet.getByRole("button", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toBe("open-blog-sources.bib");
  await expect(exportSheet).toContainText(/Saved open-blog-sources\.bib: \d+ sources\./);
});

test("an unsaved source is kept while she visits the notebook, said on every research screen, and comes back as she left it", async ({ page }) => {
  await open(page, site, "#/research/sources");
  await page.getByRole("button", { name: "Add a source" }).first().click();
  const form = page.locator(".studio-research-form");
  await form.getByRole("textbox", { name: "Title" }).fill("Phaedo");
  // At 400 px the area's tabs are a select (six links don't fit under 30rem).
  await page.getByRole("combobox", { name: "Part of your research" }).selectOption("notebook");
  await expect(page.getByRole("heading", { name: "Your notebook", level: 2 })).toBeVisible();
  await expect(page.locator(".studio-research-kept")).toContainText("You have an unsaved source: “Phaedo”.");
  await page.locator(".studio-research-kept").getByRole("link", { name: "Go back to it" }).click();
  await expect(page.locator(".studio-research-form").getByRole("textbox", { name: "Title" })).toHaveValue("Phaedo");
  await expect(page.locator(".studio-research-form").getByRole("textbox", { name: "Key" })).toHaveValue("phaedo");
  // Leaving research asks first.
  await page.evaluate(() => { location.hash = "#/posts"; });
  const dialog = page.locator("modal-dialog");
  await expect(dialog).toContainText("Leave your research with unsaved changes?");
  await dialog.getByRole("button", { name: "Stay in research" }).click();
  await expect(page).toHaveURL(/#\/research\/sources/);
  await page.locator(".studio-research-form").getByRole("button", { name: "Add the source" }).click();
  await expect(page.locator(".studio-research-sources")).toContainText("Source added.");
});

test("a library that can't be read says so in her words, changes nothing, and shows the file only to the helper", async ({ page }) => {
  const broken = await startSite("research-broken");
  try {
    writePrivate(broken, "sources.json", "{ not json");
    await open(page, broken, "#/research");
    const home = page.locator(".studio-research-home");
    await expect(home.locator("alert-banner").first()).toContainText("Your source library can't be read, so nothing here changed.");
    await expect(home.locator('[data-step="source"]')).toContainText("can't be read");
    const visible = await home.locator("alert-banner").first().evaluate((node) => [...node.querySelectorAll(":scope > p")].map((p) => p.innerText).join(" "));
    expect(visible).not.toMatch(/sources\.json|invalid-json/);
    await expect(home.locator("alert-banner details").first()).toContainText("sources.json");
    expect(readPrivate(broken, "sources.json")).toBe("{ not json");
  } finally {
    await stopSite(broken);
  }
});

test("Sources from the keyboard alone, at 320 px, with the form open: rows, Undo and focus all reachable", async ({ page }) => {
  const api = await apiFor(site);
  const have = (await api.call("GET", "sources")).json.sources.map((s) => s.id);
  await addSources(api, [WORK, TRANSLATION].filter((s) => !have.includes(s.id)));
  await open(page, site, "#/research/sources");
  await expect(page.getByRole("heading", { name: "Your sources", level: 2 })).toBeFocused();
  const first = page.locator(".studio-research-row-button").first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".studio-research-row-button").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".studio-research-form")).toBeVisible();
  await axeClean(page, "Sources with a source open", ".studio-research-sources");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".studio-research-side")).toBeVisible();
  await axeClean(page, "Sources, the list", ".studio-research-sources");
});

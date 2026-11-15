import { test, expect } from "@playwright/test";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, readPrivate } from "./research-site.mjs";

// The atlas and Chronology (Studio R12, #/research/atlas[/…]): ports the old Admin's atlas.spec
// and chronology.spec. An entry with its kind and other names, a link someone asserted with its
// evidence, a dating typed as a plain year with BCE (never a negative number), Undo where the old
// Admin asked, the old addresses, keyboard only, 320 px and axe.

let site;
let api;

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-atlas");
  api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION]);
  await addEntries(api, [PASSAGE, { id: "note-good", kind: "observation", text: "The good is like the sun.", concepts: ["the-good"] }]);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

const atlas = () => JSON.parse(readPrivate(site, "atlas.json"));
const screen = (page) => page.locator(".studio-research-atlas");

test("add an entry: its key comes from its name, it's private, and a change has Undo", async ({ page }) => {
  await open(page, site, "#/research/atlas");
  await expect(page.getByRole("heading", { name: "Your atlas", level: 2 })).toBeFocused();
  await expect(screen(page)).toContainText("Your atlas is empty");
  await expect(screen(page)).toContainText("Concepts your notes use, not in your atlas yet:");
  await page.getByRole("button", { name: "Add an entry" }).first().click();
  const form = page.locator(".studio-research-entry");
  await form.getByRole("combobox", { name: "Kind" }).selectOption("person");
  await form.getByRole("textbox", { name: "Name" }).fill("Plato");
  await expect(form.getByRole("textbox", { name: "Key" })).toHaveValue("plato");
  await form.getByRole("button", { name: "Add another name" }).click();
  await form.getByRole("textbox", { name: "Other name 1" }).fill("Aristocles");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(screen(page)).toContainText("Added to your atlas.");
  await expect(page.locator(".studio-research-entry h3")).toHaveText("Plato");
  await expect(page.locator(".studio-research-entry")).toContainText("also called Aristocles");
  expect(atlas().entries[0]).toMatchObject({ id: "plato", kind: "person", label: "Plato", aliases: ["Aristocles"], visibility: "private" });

  await page.getByRole("button", { name: "Change this entry" }).click();
  await page.locator(".studio-research-entry").getByRole("textbox", { name: "Summary" }).fill("An Athenian philosopher.");
  await page.locator(".studio-research-entry").getByRole("button", { name: "Save", exact: true }).click();
  await expect(screen(page)).toContainText("Saved to your atlas.");
  expect(atlas().entries[0].summary).toBe("An Athenian philosopher.");
  await page.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(screen(page)).toContainText("Undone.");
  expect(atlas().entries[0].summary).toBeUndefined();
});

test("a dating is a plain year with BCE: c. 428 BCE is stored as -428 and reads back the same", async ({ page }) => {
  await open(page, site, "#/research/atlas/plato");
  await page.getByRole("button", { name: "Change this entry" }).click();
  const form = page.locator(".studio-research-entry");
  await form.getByRole("button", { name: "Add a dating" }).click();
  const dating = form.locator("[data-dating='0']");
  await dating.getByRole("combobox", { name: "What it dates" }).selectOption("birth");
  await dating.getByRole("textbox", { name: /^Year/ }).fill("428");
  await dating.getByRole("button", { name: "BCE" }).first().click();
  await dating.getByRole("checkbox", { name: "About (c.)" }).check();
  await dating.getByRole("checkbox", { name: "A draft with no evidence yet" }).check();
  await expect(dating).toContainText("Reads as: c. 428 BCE");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(screen(page)).toContainText("Saved to your atlas.");
  const stored = atlas().entries[0].dates[0];
  expect(stored).toMatchObject({ aspect: "birth", date: { at: { year: -428, circa: true } }, unsourced: true });
  await expect(page.locator(".studio-research-entry")).toContainText("birth c. 428 BCE");
  await open(page, site, "#/research/atlas/chronology");
  await expect(page.getByRole("heading", { name: "Chronology" })).toBeVisible();
  await expect(screen(page)).toContainText("c. 428 BCE");
  await expect(screen(page)).toContainText("5th century BCE");
});

test("a link someone asserted, with evidence from a source, shows from both sides; taking it out has Undo", async ({ page }) => {
  const current = await api.call("GET", "research/atlas");
  expect((await api.call("POST", "research/atlas/entries", { revision: current.json.revision, entry: { id: "politeia", kind: "work", label: "Politeia", visibility: "private" } })).status).toBe(201);
  await open(page, site, "#/research/atlas/plato");
  await page.getByRole("button", { name: "Add a link from Plato" }).click();
  const form = page.locator(".studio-research-entry");
  await form.getByRole("combobox", { name: "What kind of link" }).selectOption("authored");
  await form.getByRole("combobox", { name: "to", exact: true }).selectOption("politeia");
  await form.getByRole("button", { name: "Add evidence" }).first().click();
  await form.getByRole("combobox", { name: "Source of evidence 1" }).selectOption("republic-slings");
  await form.getByRole("button", { name: "Add another place" }).first().click();
  await form.getByRole("textbox", { name: "Place 1", exact: true }).first().fill("327a");
  await form.getByRole("button", { name: "Add it" }).click();
  await expect(screen(page)).toContainText("Added to your atlas.");
  const link = atlas().relationships[0];
  expect(link).toMatchObject({ kind: "authored", from: "plato", to: "politeia", assertedBy: { kind: "author" } });
  expect(link.evidence[0]).toMatchObject({ source: "republic-slings", locators: [{ kind: "page", value: "327a" }] });
  await expect(page.locator(".studio-research-entry")).toContainText("Links from Plato (1)");
  await expect(page.locator(".studio-research-entry")).toContainText("Plato authored Politeia — Tentative — you say so, on 1 pieces of evidence");
  await expect(page.locator(".studio-research-entry")).toContainText("Only links someone asserted.");

  await page.getByRole("link", { name: "Change" }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/research/atlas/relationships/${link.id}$`));
  await expect(page.getByRole("heading", { name: "Change the link" })).toBeVisible();
  await page.locator(".studio-research-buttons dropdown-menu").getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take out this link" }).click();
  await expect(screen(page)).toContainText("Taken out of your atlas.");
  expect(atlas().relationships).toEqual([]);
  await page.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(screen(page)).toContainText("Undone.");
  expect(atlas().relationships[0].id).toBe(link.id);
});

test("a concept her notes use opens as a new entry, and the old addresses open the atlas", async ({ page }) => {
  await open(page, site, "#/research/atlas");
  await page.getByRole("button", { name: "the-good" }).click();
  const form = page.locator(".studio-research-entry");
  await expect(form.getByRole("combobox", { name: "Kind" })).toHaveValue("concept");
  await expect(form.getByRole("textbox", { name: "Key" })).toHaveValue("the-good");
  await page.goto(`${site.origin}/admin/studio/#/atlas/plato`);
  await expect(page).toHaveURL(/#\/research\/atlas\/plato$/);
  await expect(page.locator(".studio-research-entry h3")).toHaveText("Plato");
});

test.describe("at 320 px", () => {
  test.use({ viewport: { width: 320, height: 720 } });
  test("the atlas and an entry from the keyboard, with no sideways scroll, pass axe", async ({ page }) => {
    await open(page, site, "#/research/atlas");
    await expect(page.locator(".studio-research-picker")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await axeClean(page, "Atlas, the list", ".studio-research-atlas");
    await page.getByRole("link", { name: /^Plato/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".studio-research-entry h3")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await axeClean(page, "Atlas, an entry", ".studio-research-atlas");
    await page.getByRole("button", { name: "Change this entry" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await axeClean(page, "Atlas, the entry form", ".studio-research-atlas");
    await open(page, site, "#/research/atlas/chronology");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await axeClean(page, "Chronology", ".studio-research-atlas");
  });
});

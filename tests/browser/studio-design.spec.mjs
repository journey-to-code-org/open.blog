import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asAnthropic, asNotSetUp, axeClean, guardProviders, open, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";

// Describe a new look (Studio R9, #/look/design), against a stubbed helper and the site's own
// preview and save routes: the helper off hides Look's card; a draft shows its colours in light
// and dark; colours the helper got wrong, and a colour she picks by hand, come back from the
// server made readable, with a sentence saying what changed; the preview sheet has Light and
// Dark; a name she already has is refused; a saved look can be put up, and undone only until then.

let site;
let unstubbed;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("design"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
  await asAnthropic(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const screen = (page) => page.locator(".studio-design");
const result = (page) => page.locator(".studio-design-result");
const swatch = (page, role) => result(page).locator(`.studio-design-swatch[data-role="${role}"]`);
const said = (page) => result(page).locator(".studio-did").first();

const draftOf = (label, over = {}) => ({
  label, summary: "Deep reds and greens with warm gold links, on a soft cream page.", colorScheme: "light",
  light: { page: "#fbf8f2", surface: "#ffffff", text: "#1d2a22", muted: "#6b7a70", border: "#dfe5dc", accent: "#c4283c", ...(over.light || {}) },
  dark: { page: "#0e1c19", surface: "#142720", text: "#f4efe4", muted: "#9aa89e", border: "#2c4a3d", accent: "#e8c060", ...(over.dark || {}) },
  font: "classic-serif", headingFont: "modern-sans", roundness: "soft", textSize: "large",
});

/** Answer "Draft a look" the way the server would for this draft: its own preview route makes the colours readable. */
async function stubDraft(page, draft, { delay = 0, fail = null } = {}) {
  const sent = [];
  await page.route("**/admin/api/theme-draft", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.push(route.request().postDataJSON());
    if (delay) await new Promise((done) => setTimeout(done, delay));
    if (fail) return route.fulfill(fail);
    const made = typeof draft === "function" ? draft(sent.length) : draft;
    // The site's real preview route does the readable-colour work, so the stub can't drift from it.
    const token = (await (await page.request.get(`${site.origin}/admin/api/session`)).json()).csrf;
    const preview = await (await page.request.post(`${site.origin}/admin/api/theme-draft/preview`, { headers: { "X-CSRF-Token": token }, data: { draft: made, mode: "light" } })).json();
    return route.fulfill({ json: { draft: made, theme: { label: made.label, extends: "base", colors: preview.colors }, notes: preview.notes, changes: preview.changes, extends: "base", proposal: true } }).catch(() => {});
  });
  return sent;
}

async function describe(page, words = "Warm and cozy, deep red and pine green.") {
  await open(page, site, "#/look/design");
  await screen(page).getByRole("textbox", { name: "Describe the look you want" }).fill(words);
  await screen(page).getByRole("button", { name: "Draft a look" }).click();
}

test("Look offers Describe a new look only while the helper is set up", async ({ page }) => {
  await open(page, site, "#/look");
  const card = page.locator(".studio-look-design");
  await expect(card.getByRole("heading", { name: "Make a new look from your words" })).toBeVisible();
  await card.getByRole("link", { name: "Describe a new look" }).click();
  await expect(page).toHaveURL(/#\/look\/design$/);
  await expect(page.getByRole("heading", { name: "Describe a new look", level: 2 })).toBeFocused();
  // The navigation still says Look.
  await page.unroute("**/admin/api/assistant/status");
  await asNotSetUp(page);
  await open(page, site, "#/look");
  await expect(page.locator(".studio-look-design")).toBeHidden();
  // Find still opens the screen, which says why it can't draft.
  await open(page, site, "#/design");
  await expect(page).toHaveURL(/#\/look\/design$/);
  await expect(screen(page)).toContainText("Your writing helper isn't turned on, so it can't draft a look.");
  await expect(screen(page).getByRole("button", { name: "Draft a look" })).toHaveCount(0);
});

test("describe: what goes is said first, an idea fills the box, an empty box says so and sends nothing", async ({ page }) => {
  const sent = await stubDraft(page, draftOf("Warm and cozy"));
  await open(page, site, "#/look/design");
  await expect(screen(page)).toContainText("What goes to Anthropic: your description, your site's name and the name of the look you start from. Nothing else.");
  await screen(page).getByRole("button", { name: "Draft a look" }).click();
  await expect(screen(page).getByText("Describe the look you want in a few words first.")).toBeVisible();
  expect(sent).toEqual([]);
  const ideas = screen(page).getByRole("group", { name: "Or start from an idea" }).getByRole("button");
  await expect(ideas).toHaveText(["Warm and cozy", "Spring garden", "Bold and clear", "Fall harvest", "Calm night"]);
  await ideas.nth(2).click();
  const box = screen(page).getByRole("textbox", { name: "Describe the look you want" });
  await expect(box).toHaveValue("Bold and clear: navy, white and one strong red, square corners, easy to read from across a room.");
  await expect(box).toBeFocused();
  await screen(page).locator(".studio-goes-words summary").click();
  await expect(screen(page).locator(".studio-goes-exact").first()).toContainText("Your description: Bold and clear: navy");
  await axeClean(page, "describe a new look", ".studio-design");
  await page.keyboard.press("Control+Enter");
  await expect(result(page).getByRole("heading", { name: "Warm and cozy", level: 2 })).toBeFocused();
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0]).sort()).toEqual(["base", "description", "previous"]);
  expect(sent[0].previous).toBeNull();
});

test("the result: colours by name in light and dark, Easy to read with a shape, lettering in Look's words; a helper's unreadable colours come back fixed and said", async ({ page }) => {
  // The helper proposes pale grey writing on cream, and a page colour equal to the writing in dark.
  await stubDraft(page, draftOf("Warm and cozy", { light: { text: "#c8c8c8" }, dark: { text: "#0e1c19" } }));
  await describe(page);
  await expect(result(page)).toContainText("Deep reds and greens with warm gold links, on a soft cream page.");
  await expect(result(page).locator(".studio-design-role")).toHaveText(["Page", "Boxes", "Writing", "Quiet writing (dates and notes)", "Edges", "Links and buttons"]);
  await expect(swatch(page, "text")).toContainText("✓ Easy to read");
  await expect(swatch(page, "page")).not.toContainText("Easy to read");
  await expect(result(page)).toContainText("Lettering: Classic for writing, Modern for headings. Corners: Soft. Writing size: Large.");
  const note = result(page).locator("alert-banner").filter({ hasText: "Changed a little so it's easy to read" });
  await expect(note).toContainText("In light mode, the writing is a little darker so it's easy to read.");
  await expect(note).toContainText(/In dark mode, the writing (is a little lighter so it's easy to read|couldn't be made easy to read, so it uses white instead)\./);
  // The swatch shows the colour as it will be, not the one proposed.
  const shown = await swatch(page, "text").locator(".studio-design-chip").evaluate((chip) => getComputedStyle(chip).getPropertyValue("--swatch").trim());
  expect(shown).not.toBe("#c8c8c8");
  await result(page).getByRole("button", { name: "Dark", exact: true }).click();
  const dark = await swatch(page, "page").locator(".studio-design-chip").evaluate((chip) => getComputedStyle(chip).getPropertyValue("--swatch").trim());
  expect(dark).toBe("#0e1c19");
  // Hex values and ratios are for the helper person.
  await expect(result(page).getByText("#0e1c19", { exact: false }).first()).toBeHidden();
  await result(page).locator("details.studio-voice-details > summary").click();
  await expect(result(page).locator("details.studio-voice-details")).toContainText(/Text on page: \d+(\.\d)? to 1/);
  await axeClean(page, "a drafted look", ".studio-design");
});

test("Change Writing to #777777 on white: the server makes it a little darker, the swatch shows that, and Undo puts hers back", async ({ page }) => {
  await stubDraft(page, draftOf("Plain", { light: { page: "#ffffff", surface: "#ffffff" } }));
  await describe(page);
  const previews = [];
  page.on("request", (request) => { if (/theme-draft\/preview$/.test(request.url())) previews.push(request.postDataJSON()); });
  const before = await swatch(page, "text").locator(".studio-design-chip").evaluate((chip) => getComputedStyle(chip).getPropertyValue("--swatch").trim());
  await expect(swatch(page, "text").getByRole("button", { name: "Change Writing" })).toBeVisible();
  const picker = swatch(page, "text").locator('input[type="color"]');
  await expect(picker).toHaveAttribute("aria-label", "Writing color");
  await picker.evaluate((input) => { input.value = "#777777"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(said(page)).toContainText("Writing changed, and made a little darker so it's easy to read.");
  expect(previews.at(-1).draft.light.text).toBe("#777777");
  const shown = await swatch(page, "text").locator(".studio-design-chip").evaluate((chip) => getComputedStyle(chip).getPropertyValue("--swatch").trim());
  expect(shown).not.toBe("#777777");
  expect(shown).not.toBe(before);
  await expect(swatch(page, "text")).toContainText("✓ Easy to read");
  await expect(result(page).locator("alert-banner")).toContainText("In light mode, the writing is a little darker so it's easy to read.");
  await expect(swatch(page, "text").getByRole("button", { name: "Use the suggested Writing" })).toBeVisible();
  await said(page).getByRole("button", { name: "Undo" }).click();
  await expect(said(page)).toContainText("Writing is back as it was.");
  expect(await swatch(page, "text").locator(".studio-design-chip").evaluate((chip) => getComputedStyle(chip).getPropertyValue("--swatch").trim())).toBe(before);
  // A colour that reads fine is simply changed.
  await swatch(page, "border").locator('input[type="color"]').evaluate((input) => { input.value = "#aaaaaa"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await expect(said(page)).toContainText("Edges changed.");
});

test("See it on your front page: the sheet shows her own front page in the draft, Light and Dark", async ({ page }) => {
  await stubDraft(page, draftOf("Warm and cozy"));
  await describe(page);
  const modes = [];
  page.on("request", (request) => { if (/theme-draft\/preview$/.test(request.url())) modes.push(request.postDataJSON().mode); });
  await result(page).getByRole("button", { name: "See it on your front page" }).click();
  const sheet = page.locator("side-sheet.studio-preview-sheet dialog");
  await expect(sheet).toContainText("Only you can see this. Nothing is saved yet.");
  const frame = sheet.locator('iframe[title="Your front page in the new look"]');
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute("sandbox")).toBe("allow-scripts");
  await expect(page.frameLocator('iframe[title="Your front page in the new look"]').locator("html")).toHaveAttribute("data-theme", "light");
  await sheet.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.frameLocator('iframe[title="Your front page in the new look"]').locator("html")).toHaveAttribute("data-theme", "dark");
  expect(modes).toEqual(["light", "dark"]);
  await axeClean(page, "the new look's preview", "side-sheet.studio-preview-sheet");
  await sheet.getByRole("button", { name: "Back to your new look" }).click();
  await expect(sheet).toBeHidden();
});

test("Change it sends the draft so far and can step back; leaving a draft asks; typing alone does not", async ({ page }) => {
  const sent = await stubDraft(page, (n) => draftOf(n === 1 ? "First idea" : "Warmer idea", n === 1 ? {} : { light: { accent: "#a51d2d" } }));
  await open(page, site, "#/look/design");
  await screen(page).getByRole("textbox", { name: "Describe the look you want" }).fill("Something warm.");
  // Typing in the description alone is not unsaved work.
  await page.getByRole("link", { name: "Look", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/look$/);
  await describe(page, "Something warm.");
  await expect(result(page).getByRole("heading", { name: "First idea" })).toBeVisible();
  await expect(result(page).getByRole("button", { name: "Back to the one before" })).toBeHidden();
  await result(page).getByRole("textbox", { name: "Want something different? Say what to change" }).fill("a little warmer");
  await result(page).getByRole("button", { name: "Change it" }).click();
  await expect(result(page).getByRole("heading", { name: "Warmer idea" })).toBeFocused();
  expect(sent[1].previous.label).toBe("First idea");
  await expect(result(page).getByRole("textbox", { name: "Want something different? Say what to change" })).toHaveValue("");
  await result(page).getByRole("button", { name: "Back to the one before" }).click();
  await expect(result(page).getByRole("heading", { name: "First idea" })).toBeVisible();
  await expect(said(page)).toContainText("Back to the one before.");
  await page.getByRole("link", { name: "Look", exact: true }).first().click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Leave without saving this look?" });
  await expect(dialog).toContainText("The look your helper drafted isn't kept anywhere.");
  await expect(dialog.getByRole("button", { name: "Stay" })).toBeFocused();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/#\/look\/design$/);
});

test("save: a name she has is refused; saved, it can be undone; put up from Decorations, it can't be", async ({ page }) => {
  await stubDraft(page, draftOf("Warm and cozy", { light: { text: "#c8c8c8" } }));
  await describe(page);
  const name = result(page).getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue("Warm and cozy");
  await name.fill("");
  await result(page).getByRole("button", { name: "Save this look" }).click();
  await expect(result(page).getByText("Give your new look a name.")).toBeVisible();
  const existing = (await (await page.request.get(`${site.origin}/admin/api/theme-draft`)).json()).themes.find((t) => t.name !== "base");
  await name.fill(existing.label.toUpperCase());
  await page.keyboard.press("Control+s");
  await expect(result(page).getByText(`You already have a look called “${existing.label.toUpperCase()}”. Choose another name.`)).toBeVisible();
  await name.fill("Warm and cozy");
  await result(page).getByRole("button", { name: "Save this look" }).click();
  const card = result(page).locator(".studio-design-saved content-card");
  await expect(card).toBeFocused();
  await expect(card).toContainText("Saved as “Warm and cozy”. It isn't on your site yet.");
  const file = join(site.dir, "themes/warm-and-cozy/theme.json");
  const written = JSON.parse(readFileSync(file, "utf8"));
  // What was saved is what the server made readable, not what the helper proposed.
  expect(written.colors.light.text).not.toBe("#c8c8c8");
  await expect(card.getByRole("link", { name: "Put it up now" })).toHaveAttribute("href", "#/decorations?do=putup&look=warm-and-cozy");
  await expect(card.getByRole("link", { name: "Add it to your calendar" })).toHaveAttribute("href", "#/decorations?add=warm-and-cozy");
  // Saved is not unsaved work: leaving doesn't ask. Undo removes just that look.
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(said(page)).toContainText("“Warm and cozy” is gone.");
  expect(existsSync(file)).toBe(false);
  await expect(result(page).getByRole("button", { name: "Save this look" })).toBeFocused();

  // Saved again and put up: Decorations asks about this look, and Undo then refuses in words.
  await result(page).getByRole("button", { name: "Save this look" }).click();
  await expect(card).toContainText("Saved as “Warm and cozy”.");
  const config = JSON.parse(readFileSync(join(site.dir, "openblog.json"), "utf8"));
  writeFileSync(join(site.dir, "openblog.json"), JSON.stringify({ ...config, seasons: { version: 1, enabled: false, windows: [], upNow: { theme: "warm-and-cozy", until: "2099-01-01" } } }, null, 2));
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card.locator(".studio-did")).toContainText("“Warm and cozy” is in use or was changed, so it stays.");
  expect(existsSync(file)).toBe(true);
  writeFileSync(join(site.dir, "openblog.json"), JSON.stringify(config, null, 2));
  await card.getByRole("link", { name: "Put it up now" }).click();
  await expect(page).toHaveURL(/#\/decorations$/);
  await expect(page.locator("modal-dialog dialog").filter({ hasText: "Put Warm and cozy up now?" })).toBeVisible();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Not yet" }).click();
  // And the calendar link starts a season with it.
  await open(page, site, "#/decorations?add=warm-and-cozy");
  await expect(page.locator(".studio-decorations")).toContainText("Not saved yet");
  await expect(page.locator(".studio-decorations")).toContainText("Warm and cozy");
});

test("failures are in her words: the helper's idea unusable, the company busy, and Stop waiting changes nothing", async ({ page }) => {
  const stub = { fail: { status: 502, json: { error: "Assistant provider returned an invalid theme", code: "invalid-result" } } };
  await page.route("**/admin/api/theme-draft", (route) => (route.request().method() === "POST" ? route.fulfill(stub.fail) : route.fallback()));
  await describe(page);
  await expect(screen(page)).toContainText("Your helper's idea couldn't be used, so nothing changed. Try again, or say it another way.");
  await expect(result(page)).toBeHidden();
  stub.fail = { status: 502, json: { error: "Assistant provider returned HTTP 429", code: "provider-busy", retryAfter: 20 } };
  await screen(page).getByRole("button", { name: "Draft a look" }).click();
  await expect(screen(page)).toContainText("Anthropic is busy");
  stub.fail = { status: 400, json: { error: "Describe the look in at most 1000 characters", code: "too-long", field: "description", max: 1000 } };
  await screen(page).getByRole("button", { name: "Draft a look" }).click();
  await expect(screen(page).getByText(/Say it a little shorter\./)).toBeVisible();
});

test("keyboard only: describe, draft, name and save without a pointer", async ({ page }) => {
  await stubDraft(page, draftOf("Keyboard look"));
  await open(page, site, "#/look/design");
  const box = screen(page).getByRole("textbox", { name: "Describe the look you want" });
  await box.focus();
  await page.keyboard.type("Calm and plain.");
  await page.keyboard.press("Control+Enter");
  await expect(result(page).getByRole("heading", { name: "Keyboard look" })).toBeFocused();
  await page.keyboard.press("Control+s");
  await expect(result(page).locator(".studio-design-saved content-card")).toContainText("Saved as “Keyboard look”.");
  expect(existsSync(join(site.dir, "themes/keyboard-look/theme.json"))).toBe(true);
});

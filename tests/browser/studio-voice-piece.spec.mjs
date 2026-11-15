import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { axeClean, guardProviders, open, startSite, stopSite } from "./helper-site.mjs";
import { api, eraseVoice, polish, prompts, writeRough } from "./voice-site.mjs";

// A piece (Studio R9, #/voice/piece/<id>). Ports the old Admin's admin-voice-open (the rough draft
// read only, polish, a conflict's three choices, reset, move, make a post, a taken name, 404) and
// admin-voice-guard (unsaved polish asks before leaving, a copy kept on this phone and offered
// back); adds R9's Undo on Start the copy over, on Use the saved one and on Turn it into a post,
// and the sign-out question.

let site;
let unstubbed;
let rough;
let prompt;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("voice-piece"); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
  await open(page, site, "#/");
  await eraseVoice(page, site);
  await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ob-voice-")).forEach((key) => localStorage.removeItem(key)));
  [prompt] = await prompts(page, site);
  rough = await writeRough(page, site, prompt.id, "i made the crust to thin");
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const screen = (page) => page.locator(".studio-voice-piece-page");
const title = (page) => screen(page).getByRole("textbox", { name: "Title" });
const body = (page) => screen(page).getByRole("textbox", { name: "Polished copy" });
const save = (page) => screen(page).getByRole("button", { name: "Save polished copy" });
const said = (page) => screen(page).locator(".studio-voice-polish-view .studio-did");
const polishedCopy = (page) => page.evaluate((file) => JSON.parse(localStorage.getItem(`ob-voice-polished:sam:${file}`) || "null"), rough.file);
const roughBytes = () => readFileSync(join(site.dir, rough.path));

test("a rough piece: the heading has focus, the rough draft is read only, and the copy starts as it", async ({ page }) => {
  await open(page, site, `#/voice/piece/${rough.id}`);
  await expect(screen(page).getByRole("heading", { name: prompt.title, level: 2 })).toBeFocused();
  await expect(screen(page)).toContainText(/Rough draft only · \w+ \d+, \d{4}/);
  const region = screen(page).getByRole("region", { name: "Your rough draft, as you wrote it" });
  await expect(region).toHaveText("i made the crust to thin");
  await expect(screen(page)).toContainText("A rough draft stays exactly as you wrote it, typos and all");
  await expect(screen(page).getByRole("heading", { name: "Polish a copy", level: 3 })).toBeVisible();
  await expect(body(page)).toHaveValue("i made the crust to thin");
  await expect(screen(page).getByRole("button", { name: "Start the copy over" })).toBeDisabled();
  // No button makes a post from a rough draft.
  await expect(screen(page).getByRole("button", { name: "Turn it into a post" })).toBeHidden();
  await axeClean(page, "a rough piece", ".studio-voice-piece-page");
});

test("polish, save, and the rough draft's file never changes; a polished piece opens in its editor", async ({ page }) => {
  const before = roughBytes();
  await open(page, site, `#/voice/piece/${rough.id}`);
  await title(page).fill("The thin crust");
  await body(page).fill("I made the crust too thin.");
  await expect(screen(page)).toContainText("Changes not saved. A copy is kept on this phone.");
  await expect.poll(() => polishedCopy(page)).toMatchObject({ v: 1, base: null, title: "The thin crust", body: "I made the crust too thin." });
  await page.keyboard.press("Control+s");
  await expect(said(page)).toContainText("Saved.");
  await expect(screen(page)).toContainText("All changes saved.");
  await expect(screen(page).getByRole("heading", { name: "Your polished copy", level: 3 })).toBeVisible();
  expect(await polishedCopy(page)).toBeNull();
  expect(roughBytes().equals(before)).toBe(true);
  await open(page, site, `#/voice/piece/${rough.id}`);
  await expect(screen(page)).toContainText(/Rough draft and polished copy · /);
  await expect(body(page)).toBeFocused();
  await expect(body(page)).toHaveValue("I made the crust too thin.");
  await axeClean(page, "a polished piece", ".studio-voice-piece-page");
});

test("too long and empty are said by the box, and nothing is sent", async ({ page }) => {
  const saves = [];
  page.on("request", (request) => { if (/voice\/samples/.test(request.url()) && request.method() !== "GET") saves.push(request.url()); });
  await open(page, site, `#/voice/piece/${rough.id}`);
  await body(page).fill("");
  await save(page).click();
  await expect(said(page)).toContainText("There's nothing to save yet.");
  await body(page).evaluate((box) => { const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(box, "x".repeat(60 * 1024 + 1)); box.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(screen(page)).toContainText("That's longer than a piece can hold. Shorten it a little before saving.");
  await save(page).click();
  expect(saves).toEqual([]);
});

test("Start the copy over applies at once, isn't saved, and Undo brings her words back", async ({ page }) => {
  await polish(page, site, rough, "Tidy", "A tidy version.");
  await open(page, site, `#/voice/piece/${rough.id}`);
  await body(page).fill("A tidy version, improved.");
  await screen(page).getByRole("button", { name: "Start the copy over" }).click();
  await expect(body(page)).toHaveValue("i made the crust to thin");
  await expect(said(page)).toContainText("Your rough draft is back in the copy. Not saved yet.");
  await said(page).getByRole("button", { name: "Undo" }).click();
  await expect(body(page)).toHaveValue("A tidy version, improved.");
  await expect(title(page)).toHaveValue("Tidy");
});

test("changed somewhere else: nothing is lost, and each of the three choices does what it says", async ({ page }) => {
  const saved = await polish(page, site, rough, "Tidy", "The first saved version.");
  await open(page, site, `#/voice/piece/${rough.id}`);
  await body(page).fill("Mine, typed here on this phone.");
  // Meanwhile, another window saves.
  const other = await api(page, site, "PUT", `voice/samples/${saved.id}`, { revision: saved.revision, title: "Tidy", body: "Theirs, saved from somewhere else entirely." });
  expect(other.status).toBe(200);
  await save(page).click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "This copy was changed somewhere else" });
  await expect(dialog).toContainText("Yours has 6 words; the saved one has 6. Nothing is lost: yours is still here.");
  await expect(dialog.getByRole("button", { name: "Keep changing mine" })).toBeFocused();
  await axeClean(page, "the conflict question", "modal-dialog.studio-dialog");
  await dialog.getByRole("button", { name: "Keep changing mine" }).click();
  await expect(body(page)).toHaveValue("Mine, typed here on this phone.");
  expect((await polishedCopy(page)).body).toBe("Mine, typed here on this phone.");

  await save(page).click();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Save mine over it" }).click();
  await expect(said(page)).toContainText("Saved.");
  const now = await (await page.request.get(`${site.origin}/admin/api/voice/samples/${saved.id}`)).json();
  expect(now.body).toBe("Mine, typed here on this phone.");

  // Again, and this time the saved one is used; Undo brings hers back.
  await api(page, site, "PUT", `voice/samples/${saved.id}`, { revision: now.revision, title: "Tidy", body: "Theirs again." });
  await body(page).fill("Mine again.");
  await save(page).click();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Use the saved one" }).click();
  await expect(body(page)).toHaveValue("Theirs again.");
  await expect(said(page)).toContainText("Showing the saved one.");
  await said(page).getByRole("button", { name: "Undo" }).click();
  await expect(body(page)).toHaveValue("Mine again.");
});

test("unsaved polish: leaving asks, a copy stays on this phone, and coming back offers it (or throws it away, with Undo)", async ({ page }) => {
  await polish(page, site, rough, "Tidy", "Saved words.");
  await open(page, site, `#/voice/piece/${rough.id}`);
  await body(page).fill("Saved words, and more I didn't save.");
  await screen(page).getByRole("link", { name: "Back to your pieces" }).click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Save your polished copy?" });
  await expect(dialog).toContainText("You changed it and didn't save. A copy stays on this phone.");
  await dialog.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(/#\/voice$/);
  expect((await polishedCopy(page)).body).toBe("Saved words, and more I didn't save.");
  // Home names what is kept only here.
  await open(page, site, "#/");
  const kept = page.locator(".studio-home-voice-kept");
  await expect(kept).toContainText("Your writing voice: changes kept on this phone.");
  await kept.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(new RegExp(`#/voice/piece/${rough.id}$`));
  const offer = screen(page).locator("alert-banner").filter({ hasText: "Bring back your unsaved changes?" });
  await expect(offer).toContainText("Changes you didn't save are kept on this phone.");
  await expect(body(page)).toHaveValue("Saved words.");
  await offer.getByRole("button", { name: "Throw them away" }).click();
  await expect(said(page)).toContainText("Thrown away.");
  expect(await polishedCopy(page)).toBeNull();
  await said(page).getByRole("button", { name: "Undo" }).click();
  await screen(page).locator("alert-banner").getByRole("button", { name: "Bring them back" }).click();
  await expect(body(page)).toHaveValue("Saved words, and more I didn't save.");
  await expect(screen(page)).toContainText("Changes not saved.");
});

test("signing out with unsaved polish asks first; staying keeps it, going clears every voice copy and nothing else", async ({ page }) => {
  await polish(page, site, rough, "Tidy", "Saved words.");
  await open(page, site, `#/voice/piece/${rough.id}`);
  await body(page).fill("Not saved yet.");
  await expect.poll(() => polishedCopy(page)).not.toBeNull();
  await open(page, site, "#/");
  await page.evaluate(() => localStorage.setItem("something-else", "stays"));
  const signOut = async () => { await page.locator("dashboard-shell").getByRole("button", { name: /sam/i }).click(); await page.getByRole("menuitem", { name: "Sign out" }).click(); };
  await signOut();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Sign out and throw away your unsaved writing?" });
  await expect(dialog).toContainText("Changes to your writing voice are kept only on this phone.");
  await expect(dialog.getByRole("button", { name: "Stay signed in" })).toBeFocused();
  await dialog.getByRole("button", { name: "Stay signed in" }).click();
  expect(await polishedCopy(page)).not.toBeNull();
  await signOut();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your name", exact: true })).toBeVisible();
  expect(await page.evaluate(() => [Object.keys(localStorage).filter((key) => key.startsWith("ob-voice-")), localStorage.getItem("something-else")])).toEqual([[], "stays"]);
});

test("Turn it into a post makes a draft from the saved copy, with Open it and Undo; a taken name says what to change", async ({ page }) => {
  await polish(page, site, rough, "The thin crust", "I made the crust too thin.");
  await open(page, site, `#/voice/piece/${rough.id}`);
  const make = screen(page).getByRole("button", { name: "Turn it into a post" });
  await expect(screen(page)).toContainText("Makes a draft post from your saved polished copy. It isn't published until you publish it.");
  // Unsaved changes first: the post is made from the saved copy.
  await body(page).fill("I made the crust too thin. More.");
  await make.click();
  await expect(said(page)).toContainText("Save your polished copy first. The post is made from the saved copy.");
  await expect(save(page)).toBeFocused();
  await save(page).click();
  await expect(said(page)).toContainText("Saved.");
  await make.click();
  await expect(said(page)).toContainText("Made a draft post. It isn't published.");
  const link = said(page).getByRole("link", { name: "Open it" });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^#\/write\/posts%2F.*the-thin-crust\.md$/);
  const file = join(site.dir, "content", decodeURIComponent(href.slice("#/write/".length)));
  expect(readFileSync(file, "utf8")).toMatch(/draft: "?true/);
  // Again: the name is taken.
  await make.click();
  await expect(said(page)).toContainText("A post with this name already exists. Change the title of your polished copy, save, and try again.");
  await expect(title(page)).toBeFocused();
  // Undo the first one (made again under a new title).
  await title(page).fill("A thinner crust");
  await save(page).click();
  await expect(said(page)).toContainText("Saved.");
  await make.click();
  await expect(said(page)).toContainText("Made a draft post.");
  const second = join(site.dir, "content", decodeURIComponent((await said(page).getByRole("link", { name: "Open it" }).getAttribute("href")).slice("#/write/".length)));
  expect(existsSync(second)).toBe(true);
  await said(page).getByRole("button", { name: "Undo" }).click();
  await expect(said(page)).toContainText("The draft post is gone. Your piece didn't change.");
  expect(existsSync(second)).toBe(false);
  expect(existsSync(file)).toBe(true);
});

test("where it's kept and moving it are for the helper person, with Undo; her layer never says private or portable", async ({ page }) => {
  await open(page, site, `#/voice/piece/${rough.id}`);
  const her = await screen(page).evaluate((node) => [...node.querySelectorAll(":scope > *, .studio-voice-piece > section")].filter((c) => !c.matches("details")).map((c) => c.innerText).join("\n"));
  expect(her).not.toMatch(/\b(portable|private|revision|sample)\b/i);
  const details = screen(page).locator("details.studio-voice-details");
  await details.locator("summary").click();
  await expect(details).toContainText("Private: .openblog/private/context/voice/");
  const bytes = roughBytes();
  await details.getByRole("button", { name: "Make portable" }).click();
  await expect(details).toContainText("Moved to portable. Copied byte for byte.");
  await expect(details).toContainText("Portable: assistant/context/voice/");
  expect(readFileSync(join(site.dir, "assistant/context/voice", rough.file)).equals(bytes)).toBe(true);
  await details.getByRole("button", { name: "Undo" }).click();
  await expect(details).toContainText("Moved to private.");
  expect(existsSync(join(site.dir, "assistant/context/voice", rough.file))).toBe(false);
  expect(roughBytes().equals(bytes)).toBe(true);
});

test("a piece that's gone says so and leads back; an old library address opens its piece", async ({ page }) => {
  await open(page, site, "#/voice/piece/2020-01-01-nothing-rough");
  await expect(screen(page)).toContainText("This piece isn't there any more. It may have been moved or erased.");
  await screen(page).getByRole("link", { name: "Back to your pieces" }).click();
  await expect(page).toHaveURL(/#\/voice$/);
  await open(page, site, `#/voice/library/${rough.id}`);
  await expect(page).toHaveURL(new RegExp(`#/voice/piece/${rough.id}$`));
  await expect(screen(page).getByRole("region", { name: "Your rough draft, as you wrote it" })).toBeVisible();
});

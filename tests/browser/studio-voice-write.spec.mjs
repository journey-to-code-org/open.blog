import { test, expect } from "@playwright/test";
import { axeClean, guardProviders, open, startSite, stopSite } from "./helper-site.mjs";
import { api, eraseVoice, prompts } from "./voice-site.mjs";

// Write a piece (Studio R9, #/voice/write). Ports the old Admin's voice-session cases (draw,
// start, finish, start over, already open, autosave, a too-late save, leaving asks),
// voice-accessibility (focus moves, the timer is not live, the marks are said, axe on each step,
// reduced motion) and admin-voice-draft's page cases (a reload resumes with no time back, a lock
// that fails keeps the copy). Writing needs no helper: this site has none.

let site;
let unstubbed;
const MARK = "ROUGH-WORDS-MARK-5521";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("voice-write"); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
  await open(page, site, "#/");
  await eraseVoice(page, site);
  await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ob-voice-")).forEach((key) => localStorage.removeItem(key)));
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const screen = (page) => page.locator(".studio-voice-write-page");
const rough = (page) => screen(page).locator("textarea.studio-voice-rough");
const cards = (page) => screen(page).locator("choice-cards [role=radio]");
const copyOnPhone = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("ob-voice-draft:sam") || "null"));

async function startWriting(page) {
  await open(page, site, "#/voice/write");
  await expect(cards(page)).toHaveCount(3);
  await cards(page).first().click();
  await screen(page).getByRole("button", { name: "Start writing" }).click();
  await expect(rough(page)).toBeFocused();
}

test("choose: three prompts, Start waits for a choice and says why, three others avoid the ones shown", async ({ page }) => {
  const draws = [];
  page.on("request", (request) => { if (/voice\/draw$/.test(request.url())) draws.push(request.postDataJSON()); });
  await open(page, site, "#/voice/write");
  await expect(screen(page).getByRole("heading", { name: "What would you like to write about?", level: 2 })).toBeFocused();
  await expect(cards(page)).toHaveCount(3);
  await expect(screen(page)).toContainText("You get three minutes. Nothing gets corrected, and it never appears on your blog.");
  const first = await cards(page).allInnerTexts();
  const start = screen(page).getByRole("button", { name: "Start writing" });
  await expect(start).toHaveAttribute("aria-disabled", "true");
  // (Playwright won't press a button that says it's unavailable; she can, and is told why.)
  await start.click({ force: true });
  await expect(screen(page).getByText("Choose a prompt first.")).toBeVisible();
  expect(await page.request.get(`${site.origin}/admin/api/voice/status`).then((r) => r.json())).toMatchObject({ session: { open: false } });
  await axeClean(page, "choose", ".studio-voice-write-page");
  await screen(page).getByRole("button", { name: "Show me three others" }).click();
  await expect(screen(page).getByText("Here are three others.")).toBeVisible();
  await expect(cards(page).first()).toBeFocused();
  expect(draws.at(-1).exclude).toHaveLength(3);
  expect(await cards(page).allInnerTexts()).not.toEqual(first);
  // Private, three minutes: nothing about where it's kept is asked before writing.
  await expect(screen(page).getByText(/portable|private/i)).toHaveCount(0);
});

test("a set in the address draws from it and says so; a set the site dropped draws from every set", async ({ page }) => {
  const [prompt] = await prompts(page, site);
  await open(page, site, `#/voice/write?pack=${prompt.pack}`);
  await expect(screen(page)).toContainText(`Showing prompts from ${prompt.packTitle}.`);
  await screen(page).getByRole("button", { name: "Show prompts from every set" }).click();
  await expect(screen(page).getByText("Showing prompts from")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/voice\/write$/);
  await open(page, site, "#/voice/write?pack=a-set-long-gone");
  await expect(cards(page)).toHaveCount(3);
  await expect(screen(page).getByText("Showing prompts from")).toHaveCount(0);
  // The old Admin's link to one set still works.
  await open(page, site, `#/voice?pack=${prompt.pack}`);
  await expect(page).toHaveURL(new RegExp(`#/voice/write\\?pack=${prompt.pack}$`));
});

test("write: the box refuses every correction, the clock is a timer that isn't live, and typing is saved and kept here", async ({ page }) => {
  const started = [];
  page.on("request", (request) => { if (/voice\/session\/start$/.test(request.url())) started.push(request.postDataJSON()); });
  await startWriting(page);
  expect(started).toHaveLength(1);
  expect(Object.keys(started[0])).toEqual(["promptId"]);
  const attributes = await rough(page).evaluate((box) => Object.fromEntries(["spellcheck", "autocorrect", "autocapitalize", "autocomplete", "writingsuggestions", "data-gramm", "data-gramm_editor", "data-enable-grammarly", "data-voice-rough"].map((name) => [name, box.getAttribute(name)])));
  expect(attributes).toEqual({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", autocomplete: "off", writingsuggestions: "false", "data-gramm": "false", "data-gramm_editor": "false", "data-enable-grammarly": "false", "data-voice-rough": "true" });
  const timer = screen(page).getByRole("timer", { name: "Time left" });
  await expect(timer).toHaveText(/^[23]:\d\d$/);
  expect(await timer.evaluate((node) => node.closest("[aria-live]"))).toBeNull();
  await expect(screen(page).locator(".studio-voice-timer")).toContainText("●");
  await expect(screen(page).locator(".studio-voice-timer")).toContainText("Writing");
  // The box takes at least 40% of the screen.
  expect(await rough(page).evaluate((box) => box.getBoundingClientRect().height / window.innerHeight)).toBeGreaterThanOrEqual(0.4);
  await rough(page).pressSequentially(`i made the crust to thin ${MARK}`);
  await expect(screen(page)).toContainText("5 words.".replace("5", "7"));
  await expect.poll(() => copyOnPhone(page)).toMatchObject({ v: 1, text: `i made the crust to thin ${MARK}` });
  expect(Object.keys(await copyOnPhone(page)).sort()).toEqual(["deadline", "savedAt", "sessionId", "text", "v"]);
  await expect(screen(page).locator(".studio-voice-save")).toHaveText("Saved.");
  const session = await (await page.request.get(`${site.origin}/admin/api/voice/session`)).json();
  expect(session.draft).toBe(`i made the crust to thin ${MARK}`);
  await axeClean(page, "write", ".studio-voice-write-page");
});

test("a reload resumes the same piece with the server's clock: no time comes back", async ({ page }) => {
  await startWriting(page);
  await rough(page).pressSequentially("in the middle of a sentence");
  await expect(screen(page).locator(".studio-voice-save")).toHaveText("Saved.");
  // Make the server's deadline 100 seconds away, as if 80 had passed.
  await page.waitForTimeout(1200);
  const before = await (await page.request.get(`${site.origin}/admin/api/voice/session`)).json();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(rough(page)).toHaveValue("in the middle of a sentence");
  await expect(rough(page)).toBeFocused();
  const shown = await screen(page).getByRole("timer").innerText();
  const [minutes, seconds] = shown.split(":").map(Number);
  expect(minutes * 60 + seconds).toBeLessThanOrEqual(before.remainingSeconds);
  await expect(screen(page).locator("[data-voice-announce]")).toHaveText(/Back where you were\. .* left\./);
  const starts = await (await page.request.get(`${site.origin}/admin/api/voice/status`)).json();
  expect(starts.session.sessionId).toBe(before.sessionId);
});

test("a longer copy on this phone wins when the server missed some typing", async ({ page }) => {
  await startWriting(page);
  await rough(page).pressSequentially("the server has this");
  await expect(screen(page).locator(".studio-voice-save")).toHaveText("Saved.");
  // The signal drops: saves fail, the copy on the phone keeps up.
  await page.route("**/admin/api/voice/session/draft", (route) => route.abort());
  await rough(page).pressSequentially(" and the phone kept more");
  await expect(screen(page).locator(".studio-voice-save")).toHaveText("Waiting for a signal. Your writing is kept on this phone.");
  await expect.poll(async () => (await copyOnPhone(page))?.text).toBe("the server has this and the phone kept more");
  await page.unroute("**/admin/api/voice/session/draft");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(rough(page)).toHaveValue("the server has this and the phone kept more");
  await expect.poll(async () => (await (await page.request.get(`${site.origin}/admin/api/voice/session`)).json()).draft).toBe("the server has this and the phone kept more");
});

test("I'm done with nothing written explains and keeps the clock; with words it saves the rough draft exactly", async ({ page }) => {
  await startWriting(page);
  await screen(page).getByRole("button", { name: "I'm done" }).click();
  await expect(screen(page).getByText("Nothing's written yet, so there's nothing to save. Write something, or start over.")).toBeVisible();
  await expect(rough(page)).toBeEditable();
  await expect(screen(page).locator(".studio-voice-timer")).toContainText("Writing");
  const text = `i dont fix   typos here\n  ${MARK}`;
  await rough(page).fill(text);
  await page.keyboard.press("Control+Enter");
  const heading = screen(page).getByRole("heading", { name: "Your rough draft is saved", level: 2 });
  await expect(heading).toBeFocused();
  await expect(screen(page).locator("[data-voice-announce]")).toHaveText("Your rough draft is saved as you wrote it.");
  // Read only, in a region, word for word.
  const region = screen(page).getByRole("region", { name: "Your rough draft, as you wrote it" });
  expect(await region.evaluate((node) => [node.tagName, node.textContent, node.isContentEditable])).toEqual(["DIV", text, false]);
  await expect(screen(page).locator("textarea.studio-voice-rough")).toHaveCount(0);
  // The copy on the phone has done its job.
  expect(await copyOnPhone(page)).toBeNull();
  // The polished copy starts as a copy, with spelling help on.
  const body = screen(page).getByRole("textbox", { name: "Polished copy" });
  await expect(body).toHaveValue(text);
  expect(await body.getAttribute("spellcheck")).not.toBe("false");
  await expect(screen(page)).toContainText("Not saved yet. It starts as a copy of your rough draft.");
  await axeClean(page, "saved, then polish", ".studio-voice-write-page");
  // Write another goes back to choosing (nothing is unsaved yet).
  await screen(page).getByRole("button", { name: "Write another" }).click();
  await expect(screen(page).getByRole("heading", { name: "What would you like to write about?" })).toBeFocused();
});

test("Start over asks once, keeps nothing, and goes back to choosing", async ({ page }) => {
  await startWriting(page);
  await rough(page).fill("to be thrown away");
  await expect.poll(() => copyOnPhone(page)).not.toBeNull();
  await screen(page).getByRole("button", { name: "Start over" }).click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Start over and keep nothing?" });
  await expect(dialog.getByRole("button", { name: "Keep writing" })).toBeFocused();
  await axeClean(page, "start over", "modal-dialog.studio-dialog");
  await dialog.getByRole("button", { name: "Keep writing" }).click();
  await expect(rough(page)).toHaveValue("to be thrown away");
  await screen(page).getByRole("button", { name: "Start over" }).click();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Start over" }).click();
  await expect(screen(page).getByText("Started over. Nothing was kept.")).toBeVisible();
  expect(await copyOnPhone(page)).toBeNull();
  expect((await (await page.request.get(`${site.origin}/admin/api/voice/samples`)).json()).samples).toEqual([]);
});

test("leaving while the clock runs asks first, and the words are kept either way", async ({ page }) => {
  await startWriting(page);
  await rough(page).fill("still writing this");
  await screen(page).getByRole("link", { name: "Your writing voice" }).first().click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Stop writing for now?" });
  await expect(dialog).toContainText(/The clock keeps going\. Come back within .* to keep writing; after that, your rough draft is saved as it is\./);
  await expect(dialog.getByRole("button", { name: "Keep writing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep writing" }).click();
  await expect(page).toHaveURL(/#\/voice\/write$/);
  await expect(rough(page)).toBeFocused();
  await screen(page).getByRole("link", { name: "Your writing voice" }).first().click();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/#\/voice$/);
  expect((await (await page.request.get(`${site.origin}/admin/api/voice/session`)).json()).draft).toBe("still writing this");
  expect((await copyOnPhone(page)).text).toBe("still writing this");
  await expect(page.locator(".studio-voice-hub").getByRole("link", { name: "Keep writing" })).toBeVisible();
});

test("a piece open somewhere else: keep writing it, or throw it away after asking", async ({ page }) => {
  const [prompt] = await prompts(page, site);
  await api(page, site, "POST", "voice/session/start", { promptId: prompt.id });
  await open(page, site, "#/voice/write");
  // Opening the page resumes it (the same piece, the same clock).
  await expect(rough(page)).toBeFocused();
  await expect(screen(page).getByRole("heading", { name: prompt.title, level: 2 })).toBeVisible();
  // A page left on Choose that then presses Start gets the card.
  await page.route("**/admin/api/voice/session", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { state: "none" } }) : route.fallback()));
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(cards(page)).toHaveCount(3);
  await cards(page).first().click();
  await screen(page).getByRole("button", { name: "Start writing" }).click();
  const card = screen(page).locator(".studio-voice-open");
  await expect(card.getByRole("heading", { name: "You have a piece in progress" })).toBeFocused();
  await expect(card).toContainText(`You started “${prompt.title}” somewhere else and the clock is still running.`);
  await axeClean(page, "already open", ".studio-voice-write-page");
  await card.getByRole("button", { name: "Throw it away" }).click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: `Throw away “${prompt.title}”?` });
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();
  await dialog.getByRole("button", { name: "Throw it away" }).click();
  await expect(screen(page).getByText("Thrown away. Nothing was kept.")).toBeVisible();
  expect((await (await page.request.get(`${site.origin}/admin/api/voice/status`)).json()).session.open).toBe(false);
});

test("a save refused as too late saves the rough draft instead of losing it", async ({ page }) => {
  await startWriting(page);
  await rough(page).pressSequentially("words before the bell");
  await expect(screen(page).locator(".studio-voice-save")).toHaveText("Saved.");
  let tooLate = true;
  await page.route("**/admin/api/voice/session/draft", (route) => (tooLate ? route.fulfill({ status: 409, json: { error: "Time is up.", timeUp: true, code: "time-up" } }) : route.fallback()));
  await rough(page).pressSequentially(" and a few more");
  await expect(screen(page).getByRole("heading", { name: "Your rough draft is saved", level: 2 })).toBeVisible();
  await expect(screen(page).locator("[data-voice-announce]")).toHaveText("Time's up. Your rough draft is saved as you wrote it.");
  tooLate = false;
  await expect(screen(page).getByRole("region", { name: "Your rough draft, as you wrote it" })).toHaveText("words before the bell and a few more");
});

test("when saving the rough draft never reaches the server, the words stay on this phone and the page says so", async ({ page }) => {
  test.setTimeout(90000);
  await startWriting(page);
  await rough(page).fill(`kept on the phone ${MARK}`);
  await page.route("**/admin/api/voice/session/**", (route) => route.abort());
  await page.clock.install();
  await screen(page).getByRole("button", { name: "I'm done" }).click();
  await expect(screen(page).getByText("Saving your rough draft… trying again.")).toBeVisible();
  const failed = screen(page).getByText("Your rough draft couldn't be saved just now. Your latest words are kept on this phone; open this page again when you have a signal.");
  for (let i = 0; i < 30 && !(await failed.isVisible()); i += 1) { await page.clock.runFor(3100); await page.waitForTimeout(100); }
  await expect(failed).toBeVisible();
  expect((await copyOnPhone(page)).text).toBe(`kept on the phone ${MARK}`);
});

test("reduced motion: nothing on the page animates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startWriting(page);
  const moving = await screen(page).evaluate((node) => [node, ...node.querySelectorAll("*")].filter((el) => {
    const style = getComputedStyle(el);
    return style.animationName !== "none" && parseFloat(style.animationDuration) > 0.01;
  }).length);
  expect(moving).toBe(0);
});

test("her words appear in no log line the server wrote", async ({ page }) => {
  await startWriting(page);
  await rough(page).fill(`never in a log ${MARK}`);
  await screen(page).getByRole("button", { name: "I'm done" }).click();
  await expect(screen(page).getByRole("heading", { name: "Your rough draft is saved" })).toBeVisible();
  expect(site.output).not.toContain(MARK);
});

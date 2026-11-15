import { test, expect } from "@playwright/test";
import { asAnthropic, axeClean, fileOf, guardProviders, openPost, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";

// Suggestions as she types (Studio R8): off until she turns it on beside the words that say what
// goes; a line under her words for as long as it is on; a suggestion is plain words she takes with
// Tab (or Use it) and skips with Escape; anything she does meanwhile drops it. Ports the old
// Admin's autocomplete cases: opt-in, the bounded request, Tab and Escape, and the stale drop.

let site;
let unstubbed;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("suggest"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
  await asAnthropic(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const STORY = "---\ntitle: Butter pie\ndate: 2026-10-05\ndraft: true\n---\n\nThe crust wants cold butter\n";
const sheet = (page) => page.locator("side-sheet.studio-helper-sheet dialog");
const card = (page) => page.locator(".studio-helper-open");
const words = (page) => page.locator('[data-box="words"] textarea').first();
const line = (page) => page.locator(".studio-suggest-line");
const suggestion = (page) => page.locator(".studio-suggest-card");

async function stubComplete(page, reply, { delay = 0 } = {}) {
  const sent = [];
  await page.unroute("**/admin/api/assistant/complete").catch(() => {});
  await page.route("**/admin/api/assistant/complete", async (route) => {
    sent.push(route.request().postDataJSON());
    if (delay) await new Promise((done) => setTimeout(done, delay));
    const answer = typeof reply === "function" ? reply(sent.length) : reply;
    return answer.status ? route.fulfill({ status: answer.status, json: answer.json }) : route.fulfill({ json: answer });
  });
  return sent;
}

async function turnOn(page) {
  await card(page).getByRole("button").click();
  const toggle = sheet(page).getByRole("switch", { name: "Suggest the next words as I type" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await sheet(page).locator(".studio-ready-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet(page)).toBeHidden();
}

async function typeAtEnd(page, text) {
  await words(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("off by default; on only from the sheet that says what goes; a line shows while it is on", async ({ page }) => {
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const sent = await stubComplete(page, { completion: " and a light hand." });
  await expect(line(page)).toBeHidden();
  await typeAtEnd(page, " and plenty of it");
  await page.waitForTimeout(1500);
  expect(sent, "nothing is asked until she turns it on").toEqual([]);

  await card(page).getByRole("button").click();
  await expect(sheet(page)).toContainText("While this is on, each time you stop typing your post goes to Anthropic, which suggests the next few words. Nothing goes in unless you choose it.");
  const toggle = sheet(page).getByRole("switch", { name: "Suggest the next words as I type" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.locator("toast-region")).toContainText("Suggestions as you type are on for this post.");
  await axeClean(page, "Writing helper, suggestions on", "side-sheet.studio-helper-sheet");
  await sheet(page).locator(".studio-ready-actions").getByRole("button", { name: "Close", exact: true }).click();
  await expect(line(page)).toContainText("Suggestions as you type: on");
  await expect(line(page).getByRole("button", { name: "Turn off", exact: true })).toBeVisible();

  // A pause asks once, with her unsaved words on each side of the caret, and nothing about where she was.
  await typeAtEnd(page, ", always");
  await expect(suggestion(page)).toBeVisible({ timeout: 8000 });
  expect(sent).toHaveLength(1);
  expect(sent[0].source.prefix).toBe("The crust wants cold butter and plenty of it, always");
  expect(sent[0].source.suffix).toBe("");
  expect(sent[0].source.title).toBe("Butter pie");
  expect(sent[0].source.editorMode).toBe("markdown");
  expect(sent[0].contextIds).toEqual([]);
  await expect(suggestion(page)).toContainText("Suggestion");
  await expect(suggestion(page)).toContainText("and a light hand.");
  await expect(page.locator(".studio-visually-hidden[aria-live=polite]").filter({ hasText: "Press Tab to use it, Escape to skip." })).toHaveText("Suggestion: “and a light hand.”. Press Tab to use it, Escape to skip.");

  // Tab takes it, as plain words at her caret, with Undo under the box.
  await page.keyboard.press("Tab");
  await expect(words(page)).toHaveValue("The crust wants cold butter and plenty of it, always and a light hand.");
  await expect(words(page)).toBeFocused();
  await expect(suggestion(page)).toBeHidden();
  await page.locator('[data-box="words"]').getByRole("button", { name: "Undo", exact: true }).click();
  await expect(words(page)).toHaveValue("The crust wants cold butter and plenty of it, always");

  // Turn off: the line goes, and typing asks nothing more.
  await line(page).getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(line(page)).toBeHidden();
  const before = sent.length;
  await typeAtEnd(page, " and then some more words");
  await page.waitForTimeout(1500);
  expect(sent.length).toBe(before);
  // It is for this visit only: a reload starts off again, and nothing was kept to say otherwise.
  await expect.poll(() => fileOf(site, "2026-10-05-pie.md"), { timeout: 10000 }).toContain("and then some more words");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(line(page)).toBeHidden();
  const kept = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
  expect(kept.filter((key) => /suggest|helper|complet/i.test(key)), "nothing remembers that it was on").toEqual([]);
});

test("Escape skips it, typing or moving drops it, and a late answer is never put in", async ({ page }) => {
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  let sent = await stubComplete(page, { completion: "and a light hand." });
  await turnOn(page);
  await typeAtEnd(page, " every time");
  await expect(suggestion(page)).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await expect(suggestion(page)).toBeHidden();
  await expect(words(page)).toHaveValue("The crust wants cold butter every time");
  await expect(words(page)).toBeFocused();
  // With nothing showing, Tab moves focus as usual: no trap.
  await page.keyboard.press("Tab");
  await expect(words(page)).not.toBeFocused();

  // Shown, then she moves the caret: dropped without a word.
  await typeAtEnd(page, " you bake");
  await expect(suggestion(page)).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Home");
  await expect(suggestion(page)).toBeHidden();

  // Asked for, then she types before it answers: the answer is stale and never shows.
  sent = await stubComplete(page, { completion: "LATE WORDS" }, { delay: 1500 });
  await typeAtEnd(page, " for the family");
  await expect.poll(() => sent.length, { timeout: 8000 }).toBe(1);
  await page.keyboard.type(" on Sunday");
  await page.waitForTimeout(1200);
  await expect(page.locator("body")).not.toContainText("LATE WORDS");
  await expect(words(page)).not.toHaveValue(/LATE WORDS/);
  // One request at a time: the newer pause waited for the first to finish, then asked.
  await expect.poll(() => sent.length, { timeout: 8000 }).toBe(2);
  expect(sent[1].source.prefix.endsWith("for the family on Sunday")).toBe(true);

  // Never in the title, and never with only a few letters written.
  const count = sent.length;
  await page.getByRole("textbox", { name: "Title", exact: true }).click();
  await page.keyboard.type(" for a long weekend away");
  await page.waitForTimeout(1500);
  expect(sent.length).toBe(count);
});

test("what comes back is only ever plain words; markup is dropped; three failures turn it off and say why", async ({ page }) => {
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const replies = [
    { completion: "<img src=x onerror=alert(1)> click [here](https://evil.example)" },
    { completion: "# A heading she never asked for" },
    { completion: { not: "text" } },
  ];
  let sent = await stubComplete(page, (n) => replies[n - 1] || { completion: "plain words" });
  await turnOn(page);
  for (const more of [" one more", " two more", " three more"]) {
    const before = sent.length;
    await typeAtEnd(page, more);
    await expect.poll(() => sent.length, { timeout: 8000 }).toBe(before + 1);
    await page.waitForTimeout(400);
    await expect(suggestion(page)).toBeHidden();
  }
  expect(await page.locator(".studio-write img[src='x'], .studio-write a[href*='evil']").count()).toBe(0);
  await typeAtEnd(page, " four more");
  await expect(suggestion(page)).toContainText("plain words", { timeout: 8000 });
  await page.keyboard.press("Escape");

  // Busy is silent (the next pause tries again); a refused key stops it and says so.
  sent = await stubComplete(page, (n) => (n === 1 ? { status: 429, json: { error: "x", code: "concurrency-limit" } } : { status: 502, json: { error: "Anthropic returned HTTP 401", code: "key-rejected" } }));
  await typeAtEnd(page, " five more");
  await expect.poll(() => sent.length, { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(300);
  await expect(line(page)).toContainText("Suggestions as you type: on");
  await typeAtEnd(page, " six more");
  await expect(line(page)).toContainText("Suggestions as you type stopped: Anthropic didn't accept the key for your blog. Tell the person who set up your site.", { timeout: 8000 });
  await expect(line(page).getByRole("button", { name: "Turn off", exact: true })).toBeHidden();
  const stopped = sent.length;
  await typeAtEnd(page, " seven more");
  await page.waitForTimeout(1500);
  expect(sent.length, "stopped means stopped").toBe(stopped);
});

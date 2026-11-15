import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asAnthropic, asNotSetUp, axeClean, guardProviders, open, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";
import { eraseVoice, polish, prompts, writeRough } from "./voice-site.mjs";

// Your voice guide (Studio R9, #/voice/guide). Ports the old Admin's guide cases (proposing names
// the selected pieces and writes nothing, no piece or over budget makes no request, saving writes
// only through the context save, discarding writes nothing, portable blocked, private first, a
// merged guide is joined only when every change is chosen, check notes) and adds R9's: the pieces
// are ticked for her, the box says what goes to which company before anything is sent, her Save
// writes where the guide already is, and a saved guide can be undone.

let site;
let unstubbed;
let pieces;
const MARK = "GUIDE-PIECE-MARK-9902";
const GUIDE_FILE = ".openblog/private/context/voice.md";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("voice-guide"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
  await asAnthropic(page);
  await open(page, site, "#/");
  await eraseVoice(page, site);
  const all = await prompts(page, site);
  const first = await writeRough(page, site, all[0].id, `ever burn a crust? i did. then it burned again ${MARK}`);
  await polish(page, site, first, "Burnt", "Ever burn a crust? I did.");
  const second = await writeRough(page, site, all[1].id, "we always make two pies");
  pieces = { all, first, second };
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const screen = (page) => page.locator(".studio-voice-guide-page");
const goes = (page) => screen(page).locator(".studio-goes");
const boxes = (page) => screen(page).locator(".studio-guide-pieces input[type=checkbox]");

const trait = (statement, quote, sample, more = {}) => ({ statement, quote, sample, oneSample: false, ...more });
/** A proposal as the server answers: one kept line, one new, one change to choose. */
function proposal({ current = { exists: false, visibility: null, content: null }, changes = 1, portableAllowed = false, targets } = {}) {
  const changed = { status: "changed", change: 0, current: trait("You use we for family", "we always make two pies", "b-rough.md"), proposed: trait("You say we, never I, about family", "we always make two pies", "b-rough.md"), check: null };
  return {
    schemaVersion: 1, markdown: changes ? null : "# Voice\n\n## How you start\n- You open with a question\n", portableAllowed,
    merge: {
      changes,
      lines: ["# Voice", "", "## How you start", "- You open with a question", ...(changes ? [{ change: 0, current: "- You use we for family", proposed: "- You say we, never I, about family" }] : [])],
      sections: [{ heading: "How you start", traits: [
        { status: "kept", current: trait("You open with a question", "ever burn a crust?", "a-rough.md"), check: "not-in-sample" },
        { status: "added", proposed: trait("Short sentences when it matters", "then it burned again", "a-rough.md", { oneSample: true }) },
        ...(changes ? [changed] : []),
      ] }],
      unknown: [{ status: "added", text: "How you end a story" }], freeText: true, ownSections: ["My own notes"],
    },
    current, diff: "--- voice.md (saved)\n+++ voice.md (proposed)\n@@ -1 +1,2 @@\n # Voice\n+- Short sentences when it matters\n",
    targets: targets || { portable: { exists: false, valid: true, etag: null }, private: { exists: current.exists && current.visibility === "private", valid: true, etag: current.etag ?? null } },
    samples: [], skill: { id: "voice-guide", version: "1" }, provider: { type: "generic-https", model: "test" }, research: { enabled: false },
  };
}

async function stubGuide(page, reply, { delay = 0 } = {}) {
  const sent = [];
  await page.route("**/admin/api/assistant/voice-guide", async (route) => {
    sent.push(route.request().postDataJSON());
    if (delay) await new Promise((done) => setTimeout(done, delay));
    const answer = typeof reply === "function" ? reply() : reply;
    return (answer.status ? route.fulfill({ status: answer.status, json: answer.json }) : route.fulfill({ json: answer })).catch(() => {});
  });
  return sent;
}

test("step 1: the pieces are ticked for her, rough first, and the box says what goes to Anthropic before anything is sent", async ({ page }) => {
  const sent = await stubGuide(page, proposal());
  await open(page, site, "#/voice/guide");
  await expect(screen(page).getByRole("heading", { name: "Your voice guide", level: 2 })).toBeFocused();
  await expect(screen(page).getByRole("group", { name: "Learn from these pieces" })).toBeVisible();
  await expect(boxes(page)).toHaveCount(3);
  for (const box of await boxes(page).all()) await expect(box).toBeChecked();
  const labels = await screen(page).locator(".studio-guide-pieces label").allInnerTexts();
  expect(labels[0]).toMatch(/ · rough · \d+ words$/);
  expect(labels.filter((label) => / · polished · /.test(label))).toHaveLength(1);
  await expect(goes(page).getByRole("heading", { name: "What goes to Anthropic" })).toBeVisible();
  await expect(goes(page)).toContainText(/The pieces you ticked, about \d+ words/);
  await expect(goes(page)).toContainText("Not your posts, photos, or anything about your readers. Anthropic's own rules cover what it keeps.");
  await expect(goes(page).getByText("Your voice guide as it is now")).toHaveCount(0);
  // Word for word: her own text, read only, asked for only when opened.
  await goes(page).locator("summary").click();
  await expect(goes(page).locator("pre")).toContainText(MARK);
  expect(sent).toEqual([]);
  await axeClean(page, "voice guide, step 1", ".studio-voice-guide-page");
  // Unticking changes what goes; none ticked says so and asks nothing.
  for (const box of await boxes(page).all()) await box.uncheck();
  const make = screen(page).getByRole("button", { name: "Make my voice guide" });
  await expect(make).toHaveAttribute("aria-disabled", "true");
  await make.click({ force: true });
  await expect(screen(page).getByText("Tick at least one piece.")).toBeVisible();
  expect(sent).toEqual([]);
  await boxes(page).first().check();
  await make.click();
  await expect(screen(page).getByRole("heading", { name: "What your helper noticed", level: 2 })).toBeFocused();
  expect(sent).toHaveLength(1);
  expect(sent[0].sampleIds).toHaveLength(1);
  expect(sent[0].sampleIds[0]).toMatch(/^voice:private:.*-rough\.md$/);
  expect(existsSync(join(site.dir, GUIDE_FILE))).toBe(false);
});

test("more than the helper reads at once is refused before any request", async ({ page }) => {
  const sent = await stubGuide(page, proposal());
  await page.route("**/admin/api/assistant/context?content=none", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), voiceBudget: { samples: 2, characters: 120000 } } });
  });
  await open(page, site, "#/voice/guide");
  await expect(boxes(page)).toHaveCount(3);
  expect(await boxes(page).evaluateAll((list) => list.filter((box) => box.checked).length)).toBe(2);
  for (const box of await boxes(page).all()) await box.check();
  await expect(screen(page).getByText("That's more than your helper reads at once. Untick a few.")).toBeVisible();
  await screen(page).getByRole("button", { name: "Make my voice guide" }).click({ force: true });
  expect(sent).toEqual([]);
});

test("step 2: each line quotes her words, a change waits for her choice, and Save writes the guide she chose, private", async ({ page }) => {
  await stubGuide(page, proposal());
  const saves = [];
  page.on("request", (request) => { if (/assistant\/context$/.test(request.url()) && request.method() === "PUT") saves.push(request.postDataJSON()); });
  await open(page, site, "#/voice/guide");
  await screen(page).getByRole("button", { name: "Make my voice guide" }).click();
  await expect(screen(page)).toContainText("Each line quotes your own words. Nothing is saved until you press Save. Your helper can be wrong.");
  await expect(screen(page).getByRole("heading", { name: "How you start", level: 3 })).toBeVisible();
  await expect(screen(page).locator(".studio-guide-trait").nth(0)).toContainText("Kept");
  await expect(screen(page).locator(".studio-guide-trait").nth(0)).toContainText("These words aren't in that piece any more. It's kept; check it.");
  await expect(screen(page).locator(".studio-guide-trait").nth(1)).toContainText("New");
  await expect(screen(page).locator(".studio-guide-trait").nth(1)).toContainText("(from one piece only)");
  await expect(screen(page).locator(".studio-guide-quote").first()).toHaveText("“ever burn a crust?”");
  await expect(screen(page)).toContainText("Your own words outside these lines stay where they are.");
  await expect(screen(page)).toContainText("Your own sections stay: My own notes.");
  await expect(screen(page).getByRole("heading", { name: "What it doesn't know yet" })).toBeVisible();
  const change = screen(page).getByRole("group", { name: "Changed: You use we for family" });
  await expect(change.getByRole("radio")).toHaveCount(2);
  await expect(screen(page)).toContainText("Choose for each change before saving (1 left).");
  const save = screen(page).getByRole("button", { name: "Save my voice guide" });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await save.click({ force: true });
  expect(saves).toEqual([]);
  await axeClean(page, "voice guide, step 2", ".studio-voice-guide-page");
  await change.getByRole("radio", { name: /Keep what you had/ }).check();
  await expect(screen(page)).toContainText("Every change is chosen.");
  await page.keyboard.press("Control+Enter");
  await expect(screen(page).locator(".studio-guide > .studio-did")).toContainText("Voice guide saved.");
  expect(saves).toEqual([{ contextType: "voice", visibility: "private", content: "# Voice\n\n## How you start\n- You open with a question\n- You use we for family\n", etag: null }]);
  expect(readFileSync(join(site.dir, GUIDE_FILE), "utf8")).toBe("# Voice\n\n## How you start\n- You open with a question\n- You use we for family\n");
  // Undo: there was no guide before, so there is none again.
  await screen(page).locator(".studio-guide > .studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(screen(page).locator(".studio-guide > .studio-did")).toContainText("Your voice guide is back as it was.");
  expect(existsSync(join(site.dir, GUIDE_FILE))).toBe(false);
});

test("with a guide already: it goes too and says so, Read it shows it, and Undo puts the text before back", async ({ page }) => {
  await open(page, site, "#/");
  const token = (await (await page.request.get(`${site.origin}/admin/api/session`)).json()).csrf;
  const made = await page.request.put(`${site.origin}/admin/api/assistant/context`, { headers: { "X-CSRF-Token": token }, data: { contextType: "voice", visibility: "private", content: "# Voice\n\n- The guide before\n", etag: null } });
  expect(made.status(), await made.text()).toBe(200);
  const etag = (await made.json()).document.etag;
  await stubGuide(page, proposal({ changes: 0, current: { exists: true, visibility: "private", content: "# Voice\n\n- The guide before\n", etag } }));
  await open(page, site, "#/voice/guide?read=1");
  const now = screen(page).locator("details").filter({ hasText: "Your guide as it is now" });
  await expect(now.locator("pre")).toHaveText("# Voice\n\n- The guide before\n");
  await expect(goes(page)).toContainText("Your voice guide as it is now");
  await screen(page).getByRole("button", { name: "Update my voice guide" }).click();
  await expect(screen(page).getByRole("heading", { name: "What your helper noticed" })).toBeVisible();
  await screen(page).getByRole("button", { name: "Save my voice guide" }).click();
  await expect(screen(page).locator(".studio-guide > .studio-did")).toContainText("Voice guide saved.");
  expect(readFileSync(join(site.dir, GUIDE_FILE), "utf8")).toBe("# Voice\n\n## How you start\n- You open with a question\n");
  await screen(page).locator(".studio-guide > .studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(screen(page).locator(".studio-guide > .studio-did")).toContainText("Your voice guide is back as it was.");
  expect(readFileSync(join(site.dir, GUIDE_FILE), "utf8")).toBe("# Voice\n\n- The guide before\n");
});

test("Don't save these writes nothing; leaving step 2 asks; the details hold the diff, both saves and the blocked reason", async ({ page }) => {
  await stubGuide(page, proposal({ changes: 0 }));
  const saves = [];
  page.on("request", (request) => { if (/assistant\/context$/.test(request.url()) && request.method() !== "GET") saves.push(request.method()); });
  await open(page, site, "#/voice/guide");
  await screen(page).getByRole("button", { name: "Make my voice guide" }).click();
  await expect(screen(page).getByRole("heading", { name: "What your helper noticed" })).toBeVisible();
  // Her layer never shows the machinery.
  await expect(screen(page).getByText("Save as portable")).toBeHidden();
  const details = screen(page).locator(".studio-guide details.studio-voice-details");
  await details.locator("summary").first().click();
  await expect(details.locator(".studio-guide-diff")).toContainText("+- Short sentences when it matters");
  await expect(details.getByRole("button", { name: "Save as private" })).toBeEnabled();
  await expect(details.getByRole("button", { name: "Save as portable" })).toBeDisabled();
  await expect(details).toContainText("It quotes private pieces, so it can only be kept private.");
  await expect(details).toContainText("Made by voice-guide 1 with test.");
  // Leaving asks.
  await screen(page).getByRole("link", { name: "Your writing voice" }).click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Leave without saving your voice guide?" });
  await expect(dialog).toContainText("What your helper noticed isn't kept anywhere.");
  await expect(dialog.getByRole("button", { name: "Stay" })).toBeFocused();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/#\/voice\/guide$/);
  await screen(page).getByRole("button", { name: "Don't save these" }).click();
  await expect(screen(page).locator(".studio-guide > .studio-did")).toContainText("Nothing was saved.");
  await expect(boxes(page).first()).toBeFocused();
  expect(saves).toEqual([]);
  expect(existsSync(join(site.dir, GUIDE_FILE))).toBe(false);
});

test("failures are said in her words with the code for the helper person, and waiting can be stopped", async ({ page }) => {
  let answer = { status: 502, json: { error: "Assistant provider returned HTTP 401", code: "key-rejected" } };
  await stubGuide(page, () => answer);
  await open(page, site, "#/voice/guide");
  const make = screen(page).getByRole("button", { name: "Make my voice guide" });
  await make.click();
  await expect(screen(page)).toContainText("Anthropic didn't accept the key for your blog.");
  answer = { status: 409, json: { error: "The voice-guide skill cannot be used: missing." } };
  await make.click();
  await expect(screen(page)).toContainText("Your helper can't make a voice guide right now.");
  answer = { status: 400, json: { error: "Too many selected sampleIds", code: "too-many" } };
  await make.click();
  await expect(screen(page)).toContainText("That's more than your helper reads at once. Untick a few.");
  await expect(screen(page).getByRole("heading", { name: "What your helper noticed" })).toHaveCount(0);
});

test("Stop waiting drops a slow answer: nothing is shown and nothing is saved", async ({ page }) => {
  await page.clock.install();
  await stubGuide(page, proposal(), { delay: 3000 });
  await open(page, site, "#/voice/guide");
  await screen(page).getByRole("button", { name: "Make my voice guide" }).click();
  await expect(screen(page)).toContainText("Reading your pieces… This can take a minute.");
  await page.clock.runFor(20500);
  await expect(screen(page)).toContainText("Still reading.");
  await screen(page).getByRole("button", { name: "Stop waiting" }).click();
  await expect(screen(page)).toContainText("Stopped waiting. Nothing was saved.");
  await page.waitForTimeout(3500);
  await expect(screen(page).getByRole("heading", { name: "What your helper noticed" })).toHaveCount(0);
});

test("the helper off: the page says so and sends nothing; the helper person gets the way to set it up", async ({ page }) => {
  await page.unroute("**/admin/api/assistant/status");
  await asNotSetUp(page);
  await open(page, site, "#/voice/guide");
  await expect(screen(page)).toContainText("Your writing helper isn't turned on, so it can't make a voice guide yet.");
  await expect(screen(page)).toContainText("Tell the person who set up your site.");
  await expect(screen(page).getByRole("button", { name: /voice guide/ })).toHaveCount(0);
  await screen(page).locator("details summary").click();
  await expect(screen(page).getByRole("link", { name: "Set it up" })).toHaveAttribute("href", "#/helper?setup=1");
});

test("the Writing helper screen says where the voice guide comes from", async ({ page }) => {
  await open(page, site, "#/helper");
  const line = page.locator(".studio-helper-voice");
  await expect(line).toContainText("Write a few short pieces so your helper learns how you sound.");
  await expect(line.getByRole("link", { name: "Your writing voice" })).toHaveAttribute("href", "#/voice");
});

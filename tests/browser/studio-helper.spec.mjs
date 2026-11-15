import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asAnthropic, asNotSetUp, axeClean, fileOf, guardProviders, open, openPost, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";

// The Writing helper sheet in Write (Studio R8): nothing leaves before she presses Read it over,
// and the sheet says what goes to which company first; what comes back is shown as text, used one
// press at a time with Undo, and never trusted. Ports the old Admin's Review cases (a selection
// sent as a passage, a suggestion applied and undone, voice match on selected text) and adds the
// states: not set up, each way a read can fail, and a read that finishes while the sheet is closed.

let site;
let unstubbed;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
// The site's helper is on, pointed at an address that can't resolve; each test answers for it.
test.beforeAll(async () => { site = await startSite("helper"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const STORY = "---\ntitle: Butter pie\ndate: 2026-10-05\ndraft: true\ntags: [pie]\ndescription: A pie with a lot of butter.\n---\n\nI use alot of butter in this pie.\n\n## Making the crust\n\nKeep the butter cold and work fast.\n";
const BODY = "I use alot of butter in this pie.\n\n## Making the crust\n\nKeep the butter cold and work fast.\n";
const sheet = (page) => page.locator("side-sheet.studio-helper-sheet dialog");
const card = (page) => page.locator(".studio-helper-open");
const words = (page) => page.locator('[data-box="words"] textarea').first();
const status = (page) => sheet(page).locator(".studio-ready-status").first();
const goes = (page) => sheet(page).locator(".studio-goes");
const closeButton = (page) => sheet(page).locator(".studio-ready-actions").getByRole("button", { name: "Close", exact: true });
/** Her words as the box holds them, with one change. */
const wordsWith = (from = "", to = "") => BODY.trimEnd().replace(from, to);
const at = (needle) => Array.from(BODY.slice(0, BODY.indexOf(needle))).length;
const finding = (evidence, suggestion, more = {}) => ({
  id: `f-${at(evidence)}`, skillId: "copy-review", skillVersion: "1", category: "spelling", severity: "low", title: "A fix", explanation: "“A lot” is two words.",
  range: { start: at(evidence), end: at(evidence) + Array.from(evidence).length }, evidence, suggestion, sources: [], verification: "unverified-advice", ...more,
});
const review = (findings) => ({ reviewId: "r1", schemaVersion: 1, sourceHash: "h", scope: {}, skills: [], context: [], provider: {}, research: { enabled: false }, createdAt: "2026-11-14T10:00:00Z", findings });

/** Answer Read it over with `reply` (a body, or `{ status, json }`), and collect what was sent. */
async function stubReview(page, reply, { delay = 0 } = {}) {
  const sent = [];
  await page.unroute("**/admin/api/assistant/review").catch(() => {});
  await page.route("**/admin/api/assistant/review", async (route) => {
    sent.push(route.request().postDataJSON());
    if (delay) await new Promise((done) => setTimeout(done, delay));
    const answer = typeof reply === "function" ? reply(sent.length) : reply;
    if (answer === "garbage") return route.fulfill({ status: 200, contentType: "text/html", body: "<html>not json</html>" });
    // She may have stopped waiting: an answer nobody is listening for is simply dropped.
    return (answer.status ? route.fulfill({ status: answer.status, json: answer.json }) : route.fulfill({ json: answer })).catch(() => {});
  });
  return sent;
}

async function selectWords(page, text) {
  await words(page).evaluate((area, needle) => {
    const start = area.value.indexOf(needle);
    area.focus();
    area.setSelectionRange(start, start + needle.length);
    area.dispatchEvent(new Event("select", { bubbles: true }));
  }, text);
}

test("not set up: no card and no More item; Find opens the sheet, which says so and offers Set it up", async ({ page }) => {
  await asNotSetUp(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await expect(card(page)).toBeHidden();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Writing helper…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("combobox", { name: "Find" }).fill("Writing helper");
  await page.getByRole("option", { name: "Writing helper", exact: true }).first().click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText("Your writing helper isn't turned on");
  await expect(sheet(page)).toContainText("The person who set up your site can turn it on.");
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).toHaveCount(0);
  await sheet(page).locator("details").filter({ hasText: "For the person who set up your site" }).locator("summary").click();
  await expect(sheet(page)).toContainText("No address is set.");
  await axeClean(page, "Writing helper, not set up", "side-sheet.studio-helper-sheet");
  await sheet(page).getByRole("button", { name: "Set it up", exact: true }).click();
  await expect(page).toHaveURL(/#\/helper\?setup=1/);
  await expect(page.getByRole("combobox", { name: "Company" })).toBeFocused();
});

test("Read it over a selection: it says what goes first, sends only on her press, and each use has Undo", async ({ page }) => {
  test.setTimeout(120000);
  await asAnthropic(page);
  const posts = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/admin\/api\/(assistant|quiz)\//.test(request.url())) posts.push(new URL(request.url()).pathname); });
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole("button")).toHaveAccessibleName("Writing helper: Read it over, or get a quiz.");
  const sent = await stubReview(page, review([
    finding("alot of butter", "a lot of butter"),
    finding("work fast", null, { explanation: "Say why speed matters <img src=x onerror=alert(1)> [click](https://evil.example).", verification: "supplied-context" }),
  ]));

  await selectWords(page, "I use alot of butter in this pie.");
  await card(page).getByRole("button").click();
  await expect(sheet(page).locator("span[slot=heading]")).toBeFocused();
  await expect(status(page)).toContainText("Your helper reads what you choose and suggests changes. Nothing changes until you say so.");
  // What she had selected is what will be read, though tapping the card moved focus.
  await expect(sheet(page).getByRole("radio", { name: "The words I selected (8 words)", exact: true })).toBeChecked();
  await expect(sheet(page).getByRole("checkbox", { name: "Spelling, grammar and clear sentences" })).toBeChecked();
  await expect(sheet(page).getByRole("checkbox", { name: "How it flows from start to finish" })).toHaveCount(0);
  await expect(goes(page).getByRole("heading", { name: "What goes to Anthropic" })).toBeVisible();
  await expect(goes(page)).toContainText("Your title and the words you selected, about 8, and the rest of the post, so it reads them in place");
  await expect(goes(page)).toContainText("This post's details: when it appears, tags, summary");
  await expect(goes(page)).toContainText("Not your photos, other posts, or anything about your readers. It doesn't look anything up on the web. Anthropic's own rules cover what it keeps.");
  await goes(page).locator("summary").click();
  const exact = goes(page).getByLabel("Word for word");
  await expect(exact).toContainText("Title: Butter pie");
  await expect(exact).toContainText("Reading this part:\nI use alot of butter in this pie.");
  await expect(exact).toContainText("Keep the butter cold and work fast.");
  expect(posts, "nothing has left yet").toEqual([]);

  // The whole post offers more to look for, and says so in what goes.
  await sheet(page).getByRole("radio", { name: "The whole post", exact: true }).check();
  await expect(sheet(page).getByRole("checkbox", { name: "How it flows from start to finish" })).toBeVisible();
  await expect(goes(page)).toContainText("Your title and your words, about 19");
  await sheet(page).getByRole("checkbox", { name: "Spelling, grammar and clear sentences" }).uncheck();
  await expect(sheet(page)).toContainText("Choose at least one thing to look for.");
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).toHaveAttribute("aria-disabled", "true");
  // Still focusable, and pressing it sends nothing.
  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click({ force: true });
  expect(posts).toEqual([]);
  await sheet(page).getByRole("checkbox", { name: "Spelling, grammar and clear sentences" }).check();
  await sheet(page).getByRole("radio", { name: "The words I selected (8 words)", exact: true }).check();
  await axeClean(page, "Writing helper, Read it over", "side-sheet.studio-helper-sheet");

  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click();
  await expect(sheet(page).getByRole("heading", { name: "What your helper found", level: 2 })).toBeVisible();
  expect(posts).toEqual(["/admin/api/assistant/review"]);
  expect(sent[0].passage).toEqual({ kind: "selection", start: 0, end: 33 });
  expect(sent[0].skillIds).toEqual(["copy-review"]);
  expect(sent[0].contextIds).toEqual([]);
  expect(sent[0].source.title).toBe("Butter pie");
  expect(sent[0].source.markdown).toBe(BODY.trimEnd());
  expect(Object.keys(sent[0].source.metadata).sort()).toEqual(["date", "description", "draft", "tags"]);

  await expect(sheet(page).locator(".studio-found [role=status]").first()).toContainText("2 suggestions. From your writing helper. It can be wrong.");
  const first = sheet(page).locator('[data-finding="1"]');
  await expect(first).toContainText("In Words");
  await expect(first).toContainText("“alot of butter”");
  await expect(first).toContainText("“A lot” is two words.");
  await expect(first).toContainText("Try: “a lot of butter”");
  // What a helper says is text: no picture, no link, no button of its making.
  const second = sheet(page).locator('[data-finding="2"]');
  await expect(second).toContainText("Say why speed matters <img src=x onerror=alert(1)> [click](https://evil.example).");
  await expect(second).toContainText("Based on your notes.");
  expect(await sheet(page).locator(".studio-found img, .studio-found a[href], .studio-found iframe, .studio-found script").count()).toBe(0);
  await expect(second.getByRole("button", { name: /^Use this/ })).toHaveCount(0);
  await expect(sheet(page).getByRole("button", { name: /^Use all/ })).toBeHidden();
  await axeClean(page, "What your helper found", "side-sheet.studio-helper-sheet");

  // Use this: only those words change, in her box. Undo puts them back exactly.
  await first.getByRole("button", { name: "Use this: change “alot of butter” to “a lot of butter”", exact: true }).click();
  await expect(words(page)).toHaveValue(wordsWith("alot", "a lot"));
  await expect(first).toContainText("Used");
  await expect(sheet(page).locator(".studio-ready-did")).toContainText("Changed.");
  await expect(sheet(page).locator(".studio-found [role=status]").first()).toContainText("1 suggestion.");
  await first.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(words(page)).toHaveValue(wordsWith());
  await expect(first.getByRole("button", { name: /^Use this/ })).toBeVisible();

  // Not this one sets it aside; Bring it back returns it. Nothing is sent for either.
  await second.getByRole("button", { name: "Not this one: suggestion 2", exact: true }).click();
  await expect(sheet(page).locator('[data-finding="2"]')).toHaveCount(0);
  await sheet(page).locator("summary").filter({ hasText: "Not this one (1)" }).click();
  await sheet(page).getByRole("button", { name: "Bring it back: suggestion 2", exact: true }).click();
  await expect(sheet(page).locator('[data-finding="2"]')).toBeVisible();

  // Use it again and close: the draft saves itself as usual, and the box offers Undo too.
  await first.getByRole("button", { name: /^Use this/ }).click();
  await closeButton(page).click();
  await expect(sheet(page)).toBeHidden();
  await expect(card(page).getByRole("button")).toHaveAccessibleName("Writing helper: 1 suggestion left");
  await expect.poll(() => fileOf(site, "2026-10-05-pie.md"), { timeout: 10000 }).toContain("I use a lot of butter in this pie.");
  await page.locator('[data-box="words"]').getByRole("button", { name: "Undo", exact: true }).click();
  await expect(words(page)).toHaveValue(wordsWith());
  await expect.poll(() => fileOf(site, "2026-10-05-pie.md"), { timeout: 10000 }).toContain("I use alot of butter in this pie.");

  // Show me closes the sheet and selects the words in her box.
  await card(page).getByRole("button").click();
  await sheet(page).getByRole("button", { name: "Show me: suggestion 2, In Words", exact: true }).click();
  await expect(sheet(page)).toBeHidden();
  await expect.poll(() => page.evaluate(() => { const area = document.activeElement; return area?.value?.slice(area.selectionStart, area.selectionEnd); })).toBe("work fast");
  expect(posts).toEqual(["/admin/api/assistant/review"]);
});

test("each way a read can fail says so in her words, and her post is unchanged", async ({ page }) => {
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await card(page).getByRole("button").click();
  const read = sheet(page).getByRole("button", { name: "Read it over", exact: true });
  await expect(read).toBeVisible();
  const cases = [
    [{ status: 502, json: { error: "Anthropic returned HTTP 401", code: "key-rejected" } }, "Anthropic didn't accept the key for your blog. Tell the person who set up your site."],
    [{ status: 502, json: { error: "Anthropic returned HTTP 429", code: "provider-busy", retryAfter: 30 } }, "Anthropic is busy right now. Try again in a few minutes."],
    [{ status: 502, json: { error: "Anthropic returned HTTP 500", code: "provider-down" } }, "Anthropic didn't answer, so nothing came back. Your words are as they were. Try again later."],
    [{ status: 504, json: { error: "Anthropic request timed out", code: "timeout" } }, "Anthropic took too long, so nothing came back. Try a smaller part."],
    [{ status: 502, json: { error: "Anthropic returned invalid result JSON", code: "invalid-result" } }, "Your helper sent back something that didn't make sense, so nothing changed. Try again."],
    [{ status: 429, json: { error: "Two Assistant operations are already running; try again shortly", code: "concurrency-limit" } }, "Your writing helper is busy with something else. Try again in a minute."],
    [{ status: 502, json: { error: "Anthropic declined this Assistant request", code: "refused" } }, "Anthropic wouldn't answer this one. Your words are as they were."],
    ["garbage", "Your helper sent back something that didn't make sense, so nothing changed. Try again."],
    [review([{ evidence: 7, nonsense: true }, "not a finding"]), "Your helper found nothing to change. It can miss things."],
  ];
  for (const [reply, said] of cases) {
    await stubReview(page, reply);
    await read.click();
    await expect(status(page), said).toContainText(said);
    await expect(status(page)).toBeFocused();
    // Never a code, a status number or the server's sentence on her layer.
    const herWords = await status(page).evaluate((node) => { const copy = node.cloneNode(true); copy.querySelector("details")?.remove(); return copy.textContent; });
    expect(herWords).not.toMatch(/HTTP|\b[45]\d\d\b|code|JSON|Assistant/);
    await expect(sheet(page).getByRole("heading", { name: "Writing helper", level: 2 })).toBeVisible();
  }
  // The refused key offers the way to setup, for the person who set it up only.
  await stubReview(page, cases[0][0]);
  await read.click();
  await status(page).locator("summary").click();
  await expect(status(page)).toContainText("The key was refused (HTTP 401/403). Replace it on the Writing helper screen.");
  await expect(status(page).getByRole("button", { name: "Go to setup", exact: true })).toBeVisible();
  await expect(words(page)).toHaveValue(wordsWith());
  expect(fileOf(site, "2026-10-05-pie.md")).toBe(STORY);

  // No signal: said as a state, and nothing is sent or kept to send later.
  const sent = await stubReview(page, review([]));
  await page.context().setOffline(true);
  await expect(status(page)).toContainText("Your helper needs a signal. Your words are kept here.");
  await expect(read).toHaveAttribute("aria-disabled", "true");
  await read.click({ force: true });
  await page.context().setOffline(false);
  await expect(status(page)).toContainText("Your helper reads what you choose");
  await page.waitForTimeout(500);
  expect(sent, "nothing was held back to send when the signal returned").toEqual([]);

  // Turned off while she was writing: the sheet says so and redraws as not set up.
  await stubReview(page, { status: 503, json: { error: "OPENBLOG_LESSONS_API_KEY is not set", code: "missing-credential" } });
  await page.route("**/admin/api/assistant/status", (route) => route.fulfill({ json: { configured: false, reason: "no-key", providerType: "generic-https", model: "", destination: null, capabilities: {} } }));
  await read.click();
  await expect(sheet(page)).toContainText("Your writing helper isn't turned on");
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).toHaveCount(0);
});

test("Escape while it reads keeps the answer: the card says it finished, and opens to what it found", async ({ page }) => {
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await stubReview(page, review([finding("alot of butter", "a lot of butter")]), { delay: 1500 });
  await card(page).getByRole("button").click();
  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click();
  await expect(status(page)).toContainText("Reading it over… This can take a minute.");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(card(page).getByRole("button")).toBeFocused();
  await expect(card(page).getByRole("button")).toHaveAccessibleName("Writing helper: Reading it over…");
  await expect(card(page).getByRole("button")).toHaveAccessibleName("Writing helper: Your helper finished reading. 1 suggestion.", { timeout: 8000 });
  await expect(page.locator("toast-region")).toContainText("Your helper finished reading.");
  await page.keyboard.press("Enter");
  await expect(sheet(page).getByRole("heading", { name: "What your helper found", level: 2 })).toBeVisible();
  await expect(sheet(page).locator('[data-finding="1"]')).toContainText("Try: “a lot of butter”");
  // Alt+Left goes back to the form; nothing depends on the browser's Back.
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(sheet(page).locator("span[slot=heading]")).toBeFocused();
  await expect(page).toHaveURL(/#\/write\/posts%2F2026-10-05-pie\.md$/);
});

test("a long read says it is still reading, and Stop waiting leaves her post alone and drops the late answer", async ({ page }) => {
  test.setTimeout(90000);
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const sent = await stubReview(page, review([finding("alot of butter", "a lot of butter")]), { delay: 24000 });
  await card(page).getByRole("button").click();
  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click();
  await expect(status(page)).toContainText("Reading it over… This can take a minute.");
  await expect(sheet(page).getByRole("button", { name: "Stop waiting", exact: true })).toBeHidden();
  await expect(status(page)).toContainText("Still reading. Long posts take longer.", { timeout: 25000 });
  await sheet(page).getByRole("button", { name: "Stop waiting", exact: true }).click();
  await expect(status(page)).toContainText("Stopped waiting. Nothing changed in your post.");
  await expect(status(page)).toBeFocused();
  await status(page).locator("summary").click();
  await expect(status(page)).toContainText("The request may still finish on the server and holds one of its two places until it does.");
  // The answer arrives after she stopped: it is not shown, and nothing changes.
  await page.waitForTimeout(6000);
  expect(sent).toHaveLength(1);
  await expect(sheet(page).getByRole("heading", { name: "What your helper found", level: 2 })).toHaveCount(0);
  await expect(words(page)).toHaveValue(wordsWith());
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).not.toHaveAttribute("aria-disabled", "true");
});

test("keyboard only: open it, read with Ctrl+Enter, use all, and Tab never leaves the sheet", async ({ page }) => {
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const sent = await stubReview(page, review([finding("alot of butter", "a lot of butter"), finding("work fast", "work quickly", { explanation: "Plainer." })]));
  await card(page).getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator("span[slot=heading]")).toBeFocused();
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("side-sheet.studio-helper-sheet")))).toBe(true);
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("side-sheet.studio-helper-sheet"))), "Tab stays in the sheet").toBe(true);
  }
  await page.keyboard.press("Control+Enter");
  await expect(sheet(page).getByRole("heading", { name: "What your helper found", level: 2 })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].passage, "with nothing selected, the whole post").toBeUndefined();
  await expect(sheet(page).getByRole("button", { name: "Use all 2", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(words(page)).toHaveValue("I use a lot of butter in this pie.\n\n## Making the crust\n\nKeep the butter cold and work quickly.");
  await expect(sheet(page).locator(".studio-ready-did")).toContainText("Changed 2 places.");
  // One Undo puts both back, byte for byte.
  await sheet(page).locator(".studio-ready-did").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(words(page)).toHaveValue(BODY.trimEnd());
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(card(page).getByRole("button")).toBeFocused();
});

test("a recipe: a suggestion in Your story changes that box only, and one in an ingredient row is advice", async ({ page }) => {
  await asAnthropic(page);
  const recipe = "---\ntitle: Apple pie\ndate: 2026-10-06\ndraft: true\nprofile: recipe\nservings: \"8\"\n---\n\nMy mother made this alot.\n\n## Ingredients\n\n- 2 cups flour\n- 1 cup buter\n\n## Method\n\n1. Mix it all.\n\n## Notes\n\nKeep it cold.\n";
  await openPost(page, site, "2026-10-06-apple.md", recipe);
  const body = recipe.split("---\n\n")[1];
  const place = (needle) => Array.from(body.slice(0, body.indexOf(needle))).length;
  const one = (evidence, suggestion) => ({ id: evidence, skillId: "copy-review", skillVersion: "1", category: "spelling", severity: "low", title: "x", explanation: `Fix “${evidence}”.`, range: { start: place(evidence), end: place(evidence) + evidence.length }, evidence, suggestion, sources: [], verification: "unverified-advice" });
  await stubReview(page, review([one("alot", "a lot"), one("buter", "butter"), one("alot.\n\n## Ingredients", "a lot.\n\n## What you need")]));
  await card(page).getByRole("button").click();
  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click();
  await expect(sheet(page).locator('[data-finding="1"]')).toContainText("In Your story");
  // In a row, or across the story and a heading: shown, with Show me, never Use this.
  await expect(sheet(page).getByRole("button", { name: /^Use this/ })).toHaveCount(1);
  await expect(sheet(page).locator('[data-finding="3"]')).toContainText("Near “");
  await sheet(page).getByRole("button", { name: /^Use this/ }).click();
  await expect(page.locator('[data-box="story"] textarea').first()).toHaveValue("My mother made this a lot.");
  await closeButton(page).click();
  // The recipe is still in its boxes, and the row is as she wrote it.
  await expect(page.locator('[data-box="story"]')).toBeVisible();
  await expect.poll(() => fileOf(site, "2026-10-06-apple.md"), { timeout: 10000 }).toContain("My mother made this a lot.");
  expect(fileOf(site, "2026-10-06-apple.md")).toContain("- 1 cup buter");
});

test("with a voice guide: Sound like me and the closer match go only when she chooses them", async ({ page }) => {
  await asAnthropic(page);
  // A site with a guide and two notes (the catalog is the server's, with these added).
  await page.route("**/admin/api/assistant/context?**", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.voiceGuides = [{ id: "private:voice", name: "voice.md", contextType: "voice", visibility: "private", exists: true, valid: true, characters: 300, etag: "g" }];
    json.documents = json.documents.map((doc) => (doc.id === "private:author" ? { ...doc, exists: true, valid: true, characters: 24, etag: "a" } : doc));
    await route.fulfill({ response, json });
  });
  await page.route("**/admin/api/assistant/context/item?**", (route) => route.fulfill({ json: { id: "x", name: "note", visibility: "private", characters: 24, content: new URL(route.request().url()).searchParams.get("id") === "private:voice" ? "I write short sentences." : "I bake for my family." } }));
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const sent = await stubReview(page, review([finding("alot of butter", "a lot of butter", { skillId: "voice-match" })]));
  await selectWords(page, "I use alot of butter in this pie.");
  await card(page).getByRole("button").click();
  await expect(sheet(page).getByRole("checkbox", { name: "Whether it sounds like me" })).not.toBeChecked();
  await expect(sheet(page).getByRole("switch", { name: "Sound like me" })).not.toBeChecked();
  await expect(sheet(page).getByRole("switch", { name: "Use what your helper knows about you" })).toBeChecked();
  await expect(goes(page)).toContainText("Your notes: About you");
  await expect(goes(page)).not.toContainText("Your voice guide");
  await sheet(page).getByRole("checkbox", { name: "Whether it sounds like me" }).check();
  await sheet(page).getByRole("switch", { name: "Sound like me" }).click();
  await expect(goes(page)).toContainText("Your voice guide");
  await goes(page).locator("summary").click();
  await expect(goes(page).getByLabel("Word for word")).toContainText("About you:\nI bake for my family.");
  await expect(goes(page).getByLabel("Word for word")).toContainText("Your voice guide:\nI write short sentences.");
  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click();
  await expect(sheet(page).getByRole("heading", { name: "What your helper found", level: 2 })).toBeVisible();
  expect(sent[0].skillIds).toEqual(["copy-review", "voice-review", "voice-match"]);
  expect(sent[0].contextIds).toEqual(["private:author", "private:voice"]);
  expect(sent[0].passage.kind).toBe("selection");
  // Its suggestion applies to exactly the selected words and comes back with Undo.
  await sheet(page).getByRole("button", { name: /^Use this/ }).click();
  await expect(words(page)).toHaveValue(wordsWith("alot", "a lot"));
  await sheet(page).locator('[data-finding="1"]').getByRole("button", { name: "Undo", exact: true }).click();
  await expect(words(page)).toHaveValue(wordsWith());

  // With the notes switched off, they don't go, and the list says so before she presses.
  await page.keyboard.press("Alt+ArrowLeft");
  await sheet(page).getByRole("switch", { name: "Use what your helper knows about you" }).click();
  await expect(goes(page)).not.toContainText("Your notes");
  await sheet(page).getByRole("button", { name: "Read it over", exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].contextIds).toEqual(["private:voice"]);
});

test("Tell your helper about this post saves a private note and sends nothing to any company", async ({ page }) => {
  await asAnthropic(page);
  const posts = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/admin/api/") && !request.url().endsWith("/login")) posts.push(new URL(request.url()).pathname); });
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await card(page).getByRole("button").click();
  await sheet(page).locator("summary").filter({ hasText: "Tell your helper about this post" }).click();
  await sheet(page).getByRole("textbox", { name: "Who it's for", exact: true }).fill("People new to baking");
  await sheet(page).getByRole("textbox", { name: "What you want it to do", exact: true }).fill("Get them through a first crust");
  const note = join(site.dir, ".openblog", "private", "context", "posts", "2026-10-05-pie.md");
  await expect.poll(() => (existsSync(note) ? readFileSync(note, "utf8") : ""), { timeout: 10000 }).toContain("Get them through a first crust");
  await expect(sheet(page).locator(".studio-post-note .studio-note-status")).toHaveText("Saved.", { timeout: 8000 });
  expect(readFileSync(note, "utf8")).toContain("People new to baking");
  expect(existsSync(join(site.dir, "assistant", "context", "posts", "2026-10-05-pie.md")), "a new note is private").toBe(false);
  expect(posts).toEqual([]);
  // And it is named in what goes from then on.
  await expect(goes(page)).toContainText("Your notes: About this post");
});

test("an old Admin link to the Assistant pane opens the sheet", async ({ page }) => {
  await asAnthropic(page);
  writeFileSync(join(site.dir, "content", "posts", "2026-10-05-pie.md"), STORY);
  await open(page, site, "#/edit/posts/2026-10-05-pie.md?pane=assistant");
  await expect(sheet(page).getByRole("heading", { name: "Writing helper", level: 2 })).toBeVisible();
  await expect(page).toHaveURL(/#\/write\/posts%2F2026-10-05-pie\.md$/);
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).toBeVisible();
});

test("the page's policy no longer allows WebAssembly or framing CodePen, and Studio still loads with no report", async ({ page }) => {
  const violations = [];
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (event) => window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`)); });
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await asAnthropic(page);
  const response = await page.request.get(`${site.origin}/admin/studio/`);
  const policy = response.headers()["content-security-policy"];
  expect(policy).toBe("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https: blob:; media-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  expect((await page.request.get(`${site.origin}/admin/`)).headers()["content-security-policy"]).toBe(policy);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await card(page).getByRole("button").click();
  await expect(sheet(page).getByRole("button", { name: "Read it over", exact: true })).toBeVisible();
  await closeButton(page).click();
  // The preview keeps its own policy, and still opens.
  await page.getByRole("button", { name: "See how it looks", exact: true }).click();
  await expect(page.locator("iframe").first()).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(violations).toEqual([]);
});

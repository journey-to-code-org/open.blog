import { test, expect } from "@playwright/test";
import { asNotSetUp, axeClean, guardProviders, open, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";
import { eraseVoice, polish, prompts, writeRough } from "./voice-site.mjs";

// Your writing voice (Studio R9, #/voice): the hub. Ports the old Admin's admin-voice-library
// (sets in order, rows newest first, badges in a word and a shape, a draw from one set, the empty
// state, unreadable files apart), admin-voice-erase (nothing until asked, the list shown, Keep it,
// clean) and admin-voice-context-warning (her line, the server's sentence in details); adds the
// guide card's states and that no piece's words are loaded here.

let site;
let unstubbed;
const MARK = "PRIVATE-PIECE-MARK-7731";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("voice-hub"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const hub = (page) => page.locator(".studio-voice-hub");

test("empty: what a piece is, one way to start, and nothing technical", async ({ page }) => {
  await open(page, site, "#/voice");
  await expect(page.getByRole("heading", { name: "Your writing voice", level: 2 })).toBeFocused();
  await expect(hub(page)).toContainText("They never appear on your blog.");
  await expect(hub(page).getByRole("heading", { name: "No pieces yet" })).toBeVisible();
  await expect(hub(page).getByRole("link", { name: "Write a piece" })).toHaveAttribute("href", "#/voice/write");
  // No pieces yet, so the guide can't be made: it says what to do first.
  await expect(hub(page)).toContainText("Write a piece or two first.");
  const text = await hub(page).evaluate((node) => [...node.children].filter((c) => !c.matches("details")).map((c) => c.innerText).join("\n"));
  expect(text).not.toMatch(/\b(sample|portable|session|catalog|revision|pack)\b/i);
  await axeClean(page, "the empty hub", ".studio-voice-hub");
});

test("pieces by set, newest first, with badges in a word and a shape; nothing of their words is loaded", async ({ page }) => {
  await open(page, site, "#/voice");
  await eraseVoice(page, site);
  const all = await prompts(page, site);
  const [first, second] = all.filter((p) => p.pack === all[0].pack);
  const rough = await writeRough(page, site, first.id, `i wrote this fast ${MARK}`);
  await polish(page, site, rough, "A tidy title", `I wrote this fast. ${MARK}`);
  await writeRough(page, site, second.id, `another one ${MARK}`);
  const seen = [];
  page.on("response", async (response) => { if (/\/admin\/api\//.test(response.url())) seen.push(await response.text().catch(() => "")); });
  await open(page, site, "#/voice");
  const set = hub(page).locator(`[data-set="${first.pack}"]`);
  await expect(set.getByRole("heading", { level: 3 })).toHaveText(first.packTitle);
  await expect(set).toContainText(/2 of \d+ written, 1 polished/);
  const rows = set.locator(".studio-voice-row");
  await expect(rows).toHaveCount(2);
  const polished = rows.filter({ hasText: first.title });
  await expect(polished.locator("status-badge")).toHaveText(["◇ Rough", "◆ Polished"]);
  await expect(polished.getByRole("link", { name: `Open: ${first.title}` })).toHaveAttribute("href", `#/voice/piece/${rough.id}`);
  await expect(rows.filter({ hasText: second.title }).locator("status-badge")).toHaveText(["◇ Rough"]);
  await expect(hub(page)).toContainText("2 written, 1 polished.");
  await expect(set.getByRole("link", { name: `Write one from ${first.packTitle}` })).toHaveAttribute("href", `#/voice/write?pack=${first.pack}`);
  await expect(hub(page).getByRole("heading", { name: "Not written yet" })).toBeVisible();
  await expect(hub(page)).toContainText(`Not polished yet: ${second.title}.`);
  // The guide can be made now, and the page never asked for a piece's words.
  await expect(hub(page).getByRole("link", { name: "Make my voice guide" })).toHaveAttribute("href", "#/voice/guide");
  expect(seen.join("\n")).not.toContain(MARK);
  expect(await page.content()).not.toContain(MARK);
  // Where each file is kept is for the helper person, one step deeper.
  await expect(hub(page).getByText(".openblog/private/context/voice/", { exact: false }).first()).toBeHidden();
  await hub(page).locator("details.studio-voice-details > summary").click();
  await expect(hub(page).locator(".studio-voice-files li").first()).toContainText("Private: .openblog/private/context/voice/");
  await axeClean(page, "the hub with pieces", ".studio-voice-hub");
});

test("a piece in progress replaces Write a piece with Keep writing, and says how long is left", async ({ page }) => {
  await open(page, site, "#/voice");
  await eraseVoice(page, site);
  const [prompt] = await prompts(page, site);
  const token = (await (await page.request.get(`${site.origin}/admin/api/session`)).json()).csrf;
  await page.request.post(`${site.origin}/admin/api/voice/session/start`, { headers: { "X-CSRF-Token": token }, data: { promptId: prompt.id } });
  await open(page, site, "#/voice");
  await expect(hub(page)).toContainText(new RegExp(`You have a piece in progress: “${prompt.title}”, [123] minutes?( \\d+ seconds)? left\\.`));
  await expect(hub(page).getByRole("link", { name: "Keep writing" })).toHaveAttribute("href", "#/voice/write");
  await expect(hub(page).getByRole("link", { name: "Write a piece" })).toHaveCount(0);
});

test("the helper off: pieces still work, and the guide card says who can turn it on", async ({ page }) => {
  await asNotSetUp(page);
  await open(page, site, "#/voice");
  await eraseVoice(page, site);
  await open(page, site, "#/voice");
  await expect(hub(page)).toContainText("Your writing helper isn't turned on, so it can't make a voice guide yet.");
  await expect(hub(page)).toContainText("Tell the person who set up your site.");
  await expect(hub(page).getByRole("link", { name: "Write a piece" })).toBeVisible();
});

test("voice writing that Git tracks: her line, and the server's sentence only in details", async ({ page }) => {
  await page.route("**/admin/api/assistant/context?content=none", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), privateSafety: { warning: "Git tracks .openblog/private/context/voice/x-rough.md; run git rm --cached." } } });
  });
  await open(page, site, "#/voice");
  const banner = hub(page).locator("alert-banner").filter({ hasText: "Your voice writing may not stay private." });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Tell the person who set up your site.");
  await expect(banner.getByText("git rm --cached", { exact: false })).toBeHidden();
  await banner.locator("summary").click();
  await expect(banner.getByText("git rm --cached", { exact: false })).toBeVisible();
});

test("erase asks once, lists what goes, keeps it on Keep it, and clears the copies on this phone when done", async ({ page }) => {
  await open(page, site, "#/voice");
  await eraseVoice(page, site);
  const [prompt] = await prompts(page, site);
  const rough = await writeRough(page, site, prompt.id, `to be erased ${MARK}`);
  await polish(page, site, rough, "Title", "polished");
  const erases = [];
  page.on("request", (request) => { if (/\/admin\/api\/voice\/erase$/.test(request.url())) erases.push(`${request.method()} ${request.postData() || ""}`); });
  await open(page, site, "#/voice");
  await page.evaluate(() => {
    localStorage.setItem("ob-voice-polished:sam:x-rough.md", JSON.stringify({ v: 1, base: null, title: "t", body: "kept here", savedAt: Date.now() }));
    localStorage.setItem("studio:site-name", "stays");
  });
  expect(erases).toEqual([]);
  await hub(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Erase all your voice writing…" }).click();
  const dialog = page.locator("modal-dialog dialog").filter({ hasText: "Erase all your voice writing?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This erases 1 piece from your blog's computer. It can't be undone.");
  await expect(dialog).toContainText("Copies kept on this phone go too.");
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();
  await expect(dialog.getByText("-rough.md (sample)", { exact: false })).toBeHidden();
  await dialog.locator("summary").click();
  await expect(dialog.locator("li")).toHaveCount(2);
  await axeClean(page, "the erase dialog", "modal-dialog.studio-dialog");
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toHaveCount(0);
  expect(erases).toEqual(["GET "]);
  await expect(hub(page).locator(".studio-voice-row")).toHaveCount(1);

  await hub(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Erase all your voice writing…" }).click();
  await page.locator("modal-dialog dialog").getByRole("button", { name: "Erase it all" }).click();
  await expect(page.getByText("Erased. Checked again: nothing is left.")).toBeVisible();
  await expect(hub(page).getByRole("heading", { name: "No pieces yet" })).toBeVisible();
  // Studio sent the server's own word; she never typed one.
  expect(erases.at(-1)).toBe('POST {"confirm":"erase"}');
  expect(await page.evaluate(() => [localStorage.getItem("ob-voice-polished:sam:x-rough.md"), localStorage.getItem("studio:site-name")])).toEqual([null, "stays"]);
  // With nothing left, it says so and asks nothing.
  await hub(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Erase all your voice writing…" }).click();
  await expect(page.getByText("There's nothing to erase.")).toBeVisible();
});

test("an erase that leaves files says so, with the paths for the helper person; a failure erases nothing", async ({ page }) => {
  await open(page, site, "#/voice");
  await eraseVoice(page, site);
  const [prompt] = await prompts(page, site);
  await writeRough(page, site, prompt.id, "words");
  let answer = { status: 200, json: { erased: [], remaining: [".openblog/private/context/voice/stuck-rough.md"], clean: false } };
  await page.route("**/admin/api/voice/erase", (route) => (route.request().method() === "POST" ? route.fulfill(answer) : route.fallback()));
  await open(page, site, "#/voice");
  const eraseIt = async () => {
    await hub(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Erase all your voice writing…" }).click();
    await page.locator("modal-dialog dialog").getByRole("button", { name: "Erase it all" }).click();
  };
  await eraseIt();
  const partial = hub(page).locator("alert-banner").filter({ hasText: "Most of it is erased, but some files are still there." });
  await expect(partial).toBeVisible();
  await partial.locator("summary").click();
  await expect(partial).toContainText("stuck-rough.md");
  answer = { status: 500, json: { error: "Cannot move a file in the project" } };
  await eraseIt();
  await expect(hub(page).locator(".studio-did")).toContainText("Nothing was erased.");
  await expect(hub(page).locator(".studio-voice-row")).toHaveCount(1);
});

test("no signal: the hub says so in words, never an error code", async ({ page }) => {
  await open(page, site, "#/");
  await page.route("**/admin/api/voice/status", (route) => route.abort());
  await page.evaluate(() => { location.hash = "#/voice"; });
  await expect(hub(page)).toContainText("Your pieces need a signal to show. Anything you were writing is kept on this phone.");
});

test("old addresses open their new screens, and Find knows the names", async ({ page }) => {
  await open(page, site, "#/voice/library");
  await expect(page).toHaveURL(/#\/voice$/);
  await expect(page.getByRole("heading", { name: "Your writing voice", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("combobox", { name: "Find" }).fill("voice");
  for (const name of ["Your writing voice", "Your voice guide"]) await expect(page.getByRole("option", { name, exact: true }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Find" }).fill("Write a piece");
  await page.getByRole("option", { name: "Write a piece", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/voice\/write$/);
});

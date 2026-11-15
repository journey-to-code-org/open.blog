import { test, expect } from "@playwright/test";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, readPrivate, writePost } from "./research-site.mjs";

// Claims and evidence (Studio R12, Write ?sheet=claims): ports the old Admin's claims.spec. A claim
// made from words selected in one part of the post, checked against the saved post (decision 12);
// evidence in three columns that are never combined; a private passage is never what readers see;
// the old Evidence address opens it; Undo; axe.

let site;
const BODY = "The prisoners see only shadows. Then one of them is freed.";

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-claims");
  const api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION]);
  await addEntries(api, [PASSAGE]);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

const claims = () => JSON.parse(readPrivate(site, "claims.json"));
const sheet = (page) => page.locator(".studio-claims");
const words = (page) => page.getByRole("textbox", { name: "Words", exact: true });

async function openClaims(page, file, text, hash = "?sheet=claims") {
  writePost(site, file, text);
  await open(page, site, `#/write/${encodeURIComponent(`posts/${file}`)}${hash}`);
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
  await expect(sheet(page)).toBeVisible();
}
async function select(page, text) {
  await words(page).evaluate((node, find) => {
    const at = node.value.indexOf(find);
    node.focus();
    node.setSelectionRange(at, at + find.length);
    node.dispatchEvent(new Event("select"));
  }, text);
}

test("a claim from the selected words is saved privately and is in place; evidence is linked in its own column, with Undo", async ({ page }) => {
  await openClaims(page, "cave.md", `---\ntitle: The cave\ndraft: true\nprofile: research\n---\n\n${BODY}\n`);
  await expect(sheet(page)).toContainText("Nothing here scores evidence or decides what's true");
  await sheet(page).getByRole("button", { name: "Make a claim from the selected words" }).click();
  await expect(sheet(page)).toContainText("Select the words of the claim in your post first.");
  await select(page, "see only shadows");
  await sheet(page).getByRole("button", { name: "Make a claim from the selected words" }).click();
  await expect(sheet(page)).toContainText("About the words: “see only shadows”");
  await sheet(page).getByRole("textbox", { name: "The claim, in your words" }).fill("Prisoners mistake shadows for things.");
  await sheet(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet(page)).toContainText("Saved privately.");
  const claim = claims().claims[0];
  expect(claim).toMatchObject({ statement: "Prisoners mistake shadows for things.", visibility: "private", anchor: { text: "see only shadows" } });
  await expect(sheet(page).locator(`[data-claim="${claim.id}"]`)).toContainText("In place.");

  await sheet(page).getByRole("button", { name: `Link evidence to: ${claim.statement}` }).click();
  await sheet(page).getByRole("radio", { name: "Supports" }).check();
  await sheet(page).getByRole("combobox", { name: "Source" }).selectOption("republic-slings");
  await sheet(page).getByRole("combobox", { name: "Passage" }).selectOption("passage-1");
  await sheet(page).getByRole("button", { name: "Add another place" }).click();
  await sheet(page).getByRole("textbox", { name: "Place 1", exact: true }).fill("514");
  await sheet(page).getByRole("checkbox", { name: "Readers can see it" }).check();
  await sheet(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet(page)).toContainText("never a private passage", { ignoreCase: true });
  await sheet(page).getByRole("checkbox", { name: "Readers can see it" }).uncheck();
  await sheet(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet(page)).toContainText("Evidence saved privately.");
  const link = claims().links[0];
  expect(link).toMatchObject({ claim: claim.id, relation: "supports", evidence: { source: "republic-slings", passage: "passage-1", locators: [{ kind: "page", value: "514" }] }, visibility: "private" });
  const card = sheet(page).locator(`[data-claim="${claim.id}"]`);
  await expect(card.locator("[data-relation='supports'] h5")).toHaveText("Supports (1)");
  await expect(card.locator("[data-relation='contradicts'] h5")).toHaveText("Contradicts (0)");

  await card.getByRole("button", { name: "Take it out" }).first().click();
  await expect(sheet(page)).toContainText("Taken out.");
  expect(claims().links).toEqual([]);
  await sheet(page).locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(sheet(page)).toContainText("Undone.");
  expect(claims().links[0].id).toBe(link.id);
});

test("words found twice, or across two parts, are refused before anything is saved", async ({ page }) => {
  await openClaims(page, "twice.md", "---\ntitle: Twice\ndraft: true\nprofile: research\n---\n\nThe fire. The fire again.\n\nA second part.\n");
  await select(page, "The fire");
  await sheet(page).getByRole("button", { name: "Make a claim from the selected words" }).click();
  await expect(sheet(page)).toContainText("Those words are in your post twice.");
  await select(page, "again.\n\nA second");
  await sheet(page).getByRole("button", { name: "Make a claim from the selected words" }).click();
  await expect(sheet(page)).toContainText("Select words inside one paragraph, heading, list or quote.");
  expect(claims().claims.filter((c) => c.post === "twice")).toEqual([]);
});

test("the old Evidence address opens Claims and evidence on the claim, and the sheet passes axe", async ({ page }) => {
  const id = claims().claims[0].id;
  await open(page, site, `#/edit/posts/cave.md?pane=evidence`);
  await expect(page).toHaveURL(/#\/write\/posts%2Fcave\.md/);
  await expect(sheet(page)).toBeVisible();
  await open(page, site, `#/write/${encodeURIComponent("posts/cave.md")}?sheet=claims&claim=${id}`);
  await expect(sheet(page).locator(`[data-claim="${id}"] h4`)).toBeFocused();
  await axeClean(page, "Claims and evidence", ".studio-claims");
});

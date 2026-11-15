import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, writePost } from "./research-site.mjs";

// For readers (Studio R12, in Your research): ports the old Admin's curation.spec by setup through
// the API. A published post that cites a source can offer it to readers; choosing never makes
// anything public that isn't already; Stop showing, Show it again and Take it out each have Undo;
// the private note planted in the notebook never reaches the page.

let site;
const SECRET = "PRIVATE-CURATION-MARKER";
const POST = `---\ntitle: The cave\ndate: 2026-01-07\nprofile: research\ncitations: notes\n---\n\nShadows [@republic-slings, page 514].\n`;

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-readers");
  const config = join(site.dir, "openblog.json");
  const json = JSON.parse(readFileSync(config, "utf8"));
  json.curatedContext = { publish: true };
  writeFileSync(config, JSON.stringify(json, null, 2));
  const api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION]);
  await addEntries(api, [PASSAGE, { id: "note-secret", kind: "observation", text: `${SECRET} never shown`, passages: ["passage-1"] }]);
  writePost(site, "2026-01-07-the-cave.md", POST);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

const selections = () => {
  try { return JSON.parse(readFileSync(join(site.dir, ".openblog", "private", "research", "selections.json"), "utf8")).selections || []; } catch { return []; }
};

test("choose a cited source for readers, see what they get, stop showing and take it out, each with Undo", async ({ page }) => {
  await open(page, site, `#/write/${encodeURIComponent("posts/2026-01-07-the-cave.md")}?sheet=research`);
  const readers = page.locator(".studio-for-readers");
  await expect(readers.getByRole("heading", { name: "For readers of this post" })).toBeVisible();
  await expect(readers).toContainText("Choosing never makes anything public that isn't already.");
  await expect(readers).toContainText("Chosen for readers (0)");
  await readers.locator("summary", { hasText: "Republic, tr. Slings" }).click();
  await readers.getByRole("button", { name: "Choose this source as a reference" }).click();
  await expect(readers).toContainText("Chosen for readers.");
  await expect(readers).toContainText("Chosen for readers (1)");
  expect(selections().map((s) => [s.kind, s.target])).toEqual([["reference", "republic-slings"]]);
  const row = readers.locator("[data-selection]").first();
  await expect(row).toContainText("Reference: Republic, tr. Slings");

  await row.getByRole("button", { name: "Stop showing" }).click();
  await expect(readers).toContainText("Readers won't get it now.");
  expect(selections()[0].state).toBe("withdrawn");
  await readers.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(readers).toContainText("Undone.");
  expect(selections()[0].state).not.toBe("withdrawn");

  await readers.locator("[data-selection]").first().getByRole("button", { name: "Take it out" }).click();
  await expect(readers).toContainText("Taken out of what readers get.");
  expect(selections()).toEqual([]);
  await readers.locator(".studio-did").getByRole("button", { name: "Undo" }).click();
  await expect(readers).toContainText("Undone.");
  expect(selections().map((s) => s.target)).toEqual(["republic-slings"]);
  await expect(page.locator("body")).not.toContainText(SECRET);
  await axeClean(page, "For readers", ".studio-for-readers");
});

import { test, expect } from "@playwright/test";
import { axeClean, open, startSite, stopSite } from "./helper-site.mjs";
import { PASSAGE, TRANSLATION, WORK, addEntries, addSources, apiFor, writePost } from "./research-site.mjs";

// What readers see (Studio R12, #/research/public): ports the old Admin's research-readiness.spec,
// with public-boundary's setup through the API. Each part says what's shown, exactly, and why
// everything else stays private; the whole site's research checks follow, each with Open it. A
// private note planted with a secret never reaches the page.

let site;
const SECRET = "PRIVATE-BOUNDARY-SECRET-31";

test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-public");
  const api = await apiFor(site);
  await addSources(api, [WORK, TRANSLATION]);
  await addEntries(api, [PASSAGE, { id: "note-secret", kind: "observation", text: `${SECRET}`, passages: ["passage-1"] }]);
  const atlas = await api.call("GET", "research/atlas");
  expect((await api.call("POST", "research/atlas/entries", { revision: atlas.json.revision, entry: { id: "plato", kind: "person", label: "Plato", visibility: "approved" } })).status).toBe(201);
  writePost(site, "2026-01-07-the-cave.md", `---\ntitle: The cave\ndate: 2026-01-07\nprofile: research\ncitations: notes\n---\n\nShadows [@republic-slings, page 514].\n`);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

test("what readers see, part by part: a cited source shown, an approved entry held back by the site, and nothing private", async ({ page }) => {
  await open(page, site, "#/research/public");
  const screen = page.locator(".studio-research-public");
  await expect(page.getByRole("heading", { name: "What readers see from your research", level: 2 })).toBeFocused();
  await expect(screen.getByRole("status").first()).toContainText(/\d+ shown\. \d+ stay private\./);
  const sources = screen.locator("[data-store='citations']");
  await expect(sources.locator("h3")).toContainText("Sources your posts cite");
  await expect(sources.locator("[data-public-item='source:republic-slings']")).toBeVisible();
  await sources.locator("[data-public-item='source:republic-slings'] summary").click();
  await expect(sources.locator("[data-public-item='source:republic-slings'] .studio-public-fields")).toBeVisible();
  const atlas = screen.locator("[data-store='atlas']");
  await expect(atlas.locator("[data-public-item='entry:plato']")).toContainText("Your blog doesn't publish this yet.");
  await expect(atlas.locator("[data-public-item='entry:plato']").getByRole("link", { name: "Open it" })).toHaveAttribute("href", "#/research/atlas/plato");
  await expect(page.locator("body")).not.toContainText(SECRET);

  const checks = screen.locator(".studio-review");
  await expect(checks.getByRole("heading", { name: "Research checks" })).toBeVisible();
  await expect(checks).toContainText("Found by a check");
  await expect(checks.getByRole("link", { name: "Open it" }).first()).toHaveAttribute("href", /^#\/write\/posts%2F2026-01-07-the-cave\.md/);
  await expect(checks.getByRole("button", { name: "Show me" })).toHaveCount(0, { timeout: 1000 });
  await page.getByRole("button", { name: "Check again" }).first().click();
  await expect(screen.getByRole("status").first()).toContainText("Checked again.");
  await axeClean(page, "What readers see", ".studio-research-public");
});

test("from Research home, the five steps lead here, and the tabs reach every research screen", async ({ page }) => {
  await open(page, site, "#/research");
  const steps = page.locator(".studio-research-step");
  await expect(steps).toHaveCount(5);
  await expect(page.locator("[data-step='relate']")).toContainText("Optional.");
  await expect(page.locator("[data-step='relate']")).toContainText("1 atlas entries and 0 alignments.");
  await page.locator("[data-step='public']").getByRole("link", { name: "See what readers see" }).click();
  await expect(page).toHaveURL(/#\/research\/public$/);
  const tabs = page.getByRole("navigation", { name: "Part of your research" });
  for (const name of ["Overview", "Sources", "Notebook", "Atlas", "Compare", "What readers see"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
});

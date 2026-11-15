import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { open, repository, startSite, stopSite } from "./helper-site.mjs";
import { TRANSLATION, WORK, addSources, apiFor, readPost, writePost } from "./research-site.mjs";
import { splitBlocks } from "../../web/studio/parts/word-blocks.js";

// Every research example post opens in Write and saves unchanged (Studio R11): the repository's
// research examples and tests/fixtures/research-posts. Each opens with its chips and quotation
// cards drawn, every box of words is visited and left (which redraws its cards), and a save leaves
// the file as it was, byte for byte; a save that must write (a new title) leaves the words as
// they were. The pure half is tests/web/studio-research-examples.test.mjs.

const sources = [join(repository, "tests/fixtures/research-posts"), join(repository, "content/posts"), join(repository, "tests/fixtures/portable-html"),
  ...readdirSync(join(repository, "examples"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(repository, "examples", e.name, "content/posts"))];
const examples = sources.filter((dir) => existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => join(dir, n)))
  .map((file) => ({ file, text: readFileSync(file, "utf8") }))
  .filter(({ text }) => /^profile:\s*research\s*$/m.test(text) || /^citations:/m.test(text) || /\[@/.test(text));
// A copy that saves as a draft, so Save writes it (a published example would wait for Update).
const asDraft = (text) => (/^draft:/m.test(text) ? text : text.replace(/^---(\r?\n)/, "---$1draft: true$1"));
const bodyOf = (text) => text.slice((/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text) || [""])[0].length);

let site;
test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
test.beforeAll(async () => {
  site = await startSite("research-examples");
  await addSources(await apiFor(site), [WORK, TRANSLATION]);
});
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => { throw error; }); });

test("there are research examples, the fixtures among them", () => {
  expect(examples.length).toBeGreaterThanOrEqual(8);
});

for (const { file, text } of examples) {
  const name = `${basename(file, ".md")}-${examples.findIndex((e) => e.file === file)}.md`;
  test(`${file.slice(repository.length + 1)} opens in Write and saves unchanged`, async ({ page }) => {
    const original = asDraft(text);
    writePost(site, name, original);
    await open(page, site, `#/write/${encodeURIComponent(`posts/${name}`)}`);
    await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
    // Its quotations are cards and its citations chips, as the pure test expects.
    const quotations = splitBlocks(bodyOf(original)).filter((block) => block.kind === "quotation").length;
    await expect(page.locator('[data-card-kind="quotation"]')).toHaveCount(quotations);
    // Visit and leave every box of words: each redraws its cards when left.
    const areas = page.locator(".studio-word-box textarea");
    for (let i = 0; i < await areas.count(); i += 1) {
      await areas.nth(i).focus();
      await areas.nth(i).press("End");
    }
    await page.getByRole("textbox", { name: "Title", exact: true }).focus();
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(600);
    expect(readPost(site, name)).toBe(original);
    // A save that has to write: a new title, and the words exactly as they were.
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.fill(`${await title.inputValue()} (again)`);
    await page.keyboard.press("Control+s");
    await expect.poll(() => readPost(site, name)).toContain("(again)");
    expect(bodyOf(readPost(site, name))).toBe(bodyOf(original));
  });
}

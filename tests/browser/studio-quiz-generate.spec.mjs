import { test, expect } from "@playwright/test";
import { asAnthropic, asNotSetUp, axeClean, fileOf, guardProviders, openPost, startSite, stopSite, turnHelperOnDirect } from "./helper-site.mjs";

// Write questions for me and Draft it for me (Studio R8): R6's forms for A question for readers
// and Code readers can run gain a button that asks the writing helper to fill them in. It says
// what goes first (only the words, never the title or notes); what comes back fills the form, not
// the post; Put back what I had restores it; and a written answer that carries a link is refused
// on Add it like one she typed. Ports the old Admin's "Generate draft" cases.

let site;
let unstubbed;

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.beforeAll(async () => { site = await startSite("quiz-generate"); await turnHelperOnDirect(site); });
test.afterAll(async () => { await stopSite(site); });
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  unstubbed = await guardProviders(page);
});
test.afterEach(() => { expect(unstubbed, "no test reaches a provider it didn't stub").toEqual([]); });

const STORY = "---\ntitle: Butter pie\ndate: 2026-10-05\ndraft: true\n---\n\nOpening words about pie.\n\n## Making the crust\n\nKeep the butter cold and work fast.\n";
const sheet = (page) => page.locator("side-sheet.studio-add-sheet dialog");
const words = (page) => page.locator('[data-box="words"] textarea').first();

async function openForm(page, name) {
  await words(page).click();
  await page.keyboard.press("Control+End");
  await page.locator('[data-box="words"]').getByRole("button", { name: "Add something to Words" }).click();
  await expect(sheet(page)).toBeVisible();
  if (name === "Code readers can run") await sheet(page).locator("details.studio-add-details > summary").click();
  await sheet(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

test("Write questions for me: says what goes, fills the form, can be put back, and a link in an answer is refused", async ({ page }) => {
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const sent = [];
  await page.route("**/admin/api/quiz/generate", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { questions: [
      { prompt: "What keeps a crust flaky?", choices: ["Cold butter", "Warm butter", "See https://evil.example/now"], correctIndex: 0, explanation: "Cold fat makes layers." },
      { prompt: "How should you work?", choices: ["Fast", "Slowly"], correctIndex: 0, explanation: "<img src=x onerror=alert(1)>" },
    ] } });
  });
  await openForm(page, "A question for readers");
  // Something she started, so the step says it will be replaced.
  await sheet(page).getByRole("textbox", { name: "The question", exact: true }).fill("My own question?");
  await sheet(page).getByRole("button", { name: "Write questions for me", exact: true }).click();
  await expect(sheet(page).getByRole("heading", { name: "Write questions for me", level: 2 })).toBeVisible();
  await expect(sheet(page).getByRole("combobox", { name: "How many questions" })).toHaveValue("2");
  const goes = sheet(page).locator(".studio-goes");
  await expect(goes.getByRole("heading", { name: "What goes to Anthropic" })).toBeVisible();
  await expect(goes).toContainText("The part you're in, about 11 words (“Making the crust”)");
  await expect(goes).toContainText("Nothing else: not your title, notes, photos or readers. It writes questions with answers for you to check. Nothing goes in your post until you press Add it.");
  await goes.locator("summary").click();
  await expect(goes.getByLabel("Word for word")).toHaveText("## Making the crust\n\nKeep the butter cold and work fast.");
  await expect(sheet(page)).toContainText("This replaces the question you started.");
  expect(sent, "nothing has left yet").toEqual([]);
  await axeClean(page, "Write questions for me", "side-sheet.studio-add-sheet");

  await sheet(page).getByRole("button", { name: "Write them", exact: true }).click();
  await expect(sheet(page).locator(".studio-generated")).toBeVisible();
  expect(sent).toEqual([{ context: "## Making the crust\n\nKeep the butter cold and work fast.", count: 2 }]);
  await expect(sheet(page).locator(".studio-generated")).toContainText("Written. Check each answer before you add it. Your helper can be wrong.");
  await expect(sheet(page).getByRole("textbox", { name: "The question", exact: true }).first()).toHaveValue("What keeps a crust flaky?");
  await expect(sheet(page).getByRole("textbox", { name: "Answer 3", exact: true })).toHaveValue("See https://evil.example/now");
  await expect(sheet(page).getByRole("radio", { name: "This one is right" }).first()).toBeChecked();
  // What it wrote is text in her boxes: no picture was made from it.
  expect(await sheet(page).locator("img[src='x']").count()).toBe(0);
  expect(fileOf(site, "2026-10-05-pie.md"), "nothing is in her post yet").toBe(STORY);

  // A link in a written answer is refused on Add it, with R6's own words.
  await sheet(page).getByRole("button", { name: "Add it", exact: true }).click();
  await expect(sheet(page)).toContainText("A question for readers can't hold links or photos.");
  expect(fileOf(site, "2026-10-05-pie.md")).toBe(STORY);

  // Put back what I had restores her own question exactly.
  await sheet(page).getByRole("button", { name: "Put back what I had", exact: true }).click();
  await expect(sheet(page).getByRole("textbox", { name: "The question", exact: true })).toHaveValue("My own question?");
  await expect(sheet(page).getByRole("textbox", { name: "The question", exact: true })).toHaveCount(1);
  await expect(sheet(page).locator(".studio-generated")).toContainText("Back as you had it.");
});

test("a clean written question goes in only on Add it, and each failure says so in her words", async ({ page }) => {
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  let reply = { status: 502, json: { error: "Anthropic returned HTTP 429", code: "provider-busy" } };
  const sent = [];
  await page.route("**/admin/api/quiz/generate", (route) => {
    sent.push(route.request().postDataJSON());
    return reply.status ? route.fulfill({ status: reply.status, json: reply.json }) : route.fulfill({ json: reply });
  });
  await openForm(page, "A question for readers");
  await sheet(page).getByRole("button", { name: "Write questions for me", exact: true }).click();
  await sheet(page).getByRole("combobox", { name: "How many questions" }).selectOption("1");
  await sheet(page).getByRole("button", { name: "Write them", exact: true }).click();
  await expect(sheet(page)).toContainText("Anthropic is busy right now. Try again in a few minutes.");
  reply = { questions: [{ prompt: 7, choices: "nope" }] };
  await sheet(page).getByRole("button", { name: "Write them", exact: true }).click();
  await expect(sheet(page)).toContainText("Your helper sent back something that didn't make sense, so nothing changed. Try again.");
  reply = { questions: [{ prompt: "What keeps a crust flaky?", choices: ["Cold butter", "Warm butter"], correctIndex: 0, explanation: "Cold fat makes layers." }] };
  await sheet(page).getByRole("button", { name: "Write them", exact: true }).click();
  await expect(sheet(page).getByRole("textbox", { name: "The question", exact: true })).toHaveValue("What keeps a crust flaky?");
  expect(sent.at(-1).count).toBe(1);
  await sheet(page).getByRole("button", { name: "Add it", exact: true }).click();
  await expect.poll(() => fileOf(site, "2026-10-05-pie.md"), { timeout: 10000 }).toContain("```quiz\nWhat keeps a crust flaky?\n- [x] Cold butter\n- [ ] Warm butter\n> Cold fat makes layers.\n```");
});

test("Draft it for me fills Code readers can run, with the kind and language she chose, and nothing runs", async ({ page }) => {
  await asAnthropic(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  const sent = [];
  await page.route("**/admin/api/assistant/code-interaction", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { kind: "example", language: "bash", title: "Count the layers", instructions: "Run it and read the count.", code: "fn main() {\n    println!(\"{}\", 3 * 9);\n}", expectedOutput: "", hint: "", explanation: "Each fold triples the layers." } });
  });
  await openForm(page, "Code readers can run");
  await sheet(page).getByRole("button", { name: "Draft it for me", exact: true }).click();
  await expect(sheet(page).locator(".studio-goes")).toContainText("What goes to Anthropic");
  await expect(sheet(page).locator(".studio-goes")).toContainText("Nothing runs here");
  await axeClean(page, "Draft it for me", "side-sheet.studio-add-sheet");
  await sheet(page).getByRole("button", { name: "Draft it", exact: true }).click();
  expect(sent).toEqual([{ context: "## Making the crust\n\nKeep the butter cold and work fast.", kind: "example", language: "rust" }]);
  await expect(sheet(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Count the layers");
  await expect(sheet(page).locator(".studio-generated")).toContainText("Drafted. Read the code before you add it. It can be wrong, and nothing has run.");
  await expect(sheet(page).getByRole("combobox", { name: "Language" })).toHaveValue("rust");
  await sheet(page).getByRole("button", { name: "Add it", exact: true }).click();
  await expect.poll(() => fileOf(site, "2026-10-05-pie.md"), { timeout: 10000 }).toContain("```rust runnable title=\"Count the layers\"");
});

test("not set up, or with no signal: the forms have no button to ask the helper", async ({ page, context }) => {
  await asNotSetUp(page);
  await openPost(page, site, "2026-10-05-pie.md", STORY);
  await openForm(page, "A question for readers");
  await expect(sheet(page).getByRole("textbox", { name: "The question", exact: true })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Write questions for me", exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await context.setOffline(false);
});

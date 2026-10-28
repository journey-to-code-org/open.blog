import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// The Landing page builder in Admin (ADR 0353, #316), from the real binary and the real Admin
// Studio: add, edit, reorder (buttons and keyboard), hide, delete and undo, inline validation in
// plain words, and no field anywhere that takes HTML or CSS.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;

const landingFile = () => join(root, "content", "landing.json");
const stored = () => JSON.parse(readFileSync(landingFile(), "utf8"));
const seed = (sections) => writeFileSync(landingFile(), JSON.stringify({ format: "openblog-landing", version: 1, sections }));
const THREE = () => [
  { id: "hello", type: "welcome", heading: "Hello there", subheading: "A friendly place." },
  { id: "text", type: "rich-text", markdown: "About this blog." },
  { id: "latest", type: "latest-posts", heading: "Newest" },
];

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-landing-builder-"));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "content", "posts", "one.md"), "---\ntitle: One\ndate: 2026-10-01\n---\nA post.\n");
  writeFileSync(join(root, "openblog.json"), JSON.stringify({ title: "Builder", url: "https://builder.example.org", author: { name: "Site Author" }, home: { heading: "Fresh writing", intro: "Welcome to my blog." } }));
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  if (root) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ }
  }
});

test.beforeEach(({ page }) => {
  rmSync(landingFile(), { force: true });
  page.on("dialog", (dialog) => {
    throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`);
  });
});

async function openLanding(page) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-action="logout"]')).toBeVisible();
  }
  await page.goto(`${origin}/admin/#/landing`);
  await expect(page.getByRole("heading", { level: 2, name: "Sections" })).toBeVisible();
}

const order = (page) => page.locator("[data-section]").evaluateAll((nodes) => nodes.map((node) => node.dataset.section));
const card = (page, id) => page.locator(`[data-section="${id}"]`);

test("a site with no landing page starts from what visitors see now and changes nothing until saved", async ({ page }) => {
  await openLanding(page);
  await expect(page.locator("[data-landing-legacy]")).toContainText("You have not built a landing page yet");
  expect(await order(page)).toEqual(["intro", "latest", "series"]);
  await expect(page.locator("[data-landing-count]")).toHaveText("3 of 40 sections");
  expect(existsSync(landingFile())).toBe(false);
});

test("Add a section lists every type in plain words with a sample, and adds the choice with a form", async ({ page }) => {
  await openLanding(page);
  await page.getByRole("button", { name: "Add a section" }).click();
  const picker = page.locator("#oba-landing-picker");
  await expect(picker.getByRole("heading", { name: "What would you like to add?" })).toBeVisible();
  await expect(picker.locator("[data-add-type]")).toHaveCount(14);
  await expect(picker.locator('[data-add-type="welcome"]')).toContainText("A big welcome with a button.");
  await expect(picker.locator('[data-add-type="welcome"]')).toContainText("For example:");
  await picker.locator('[data-add-type="rich-text"]').click();
  await expect(picker).toBeHidden();
  const added = card(page, "rich-text");
  await expect(added.getByRole("textbox", { name: "Your text (optional)" })).toBeFocused();
  await added.getByRole("textbox", { name: "Your text (optional)" }).fill("Hello from the **builder**.");
  await expect(added.locator(".oba-landing-card-summary")).toHaveText("Hello from the **builder**.");
  await added.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections.at(-1)).toEqual({ id: "rich-text", type: "rich-text", markdown: "Hello from the **builder**." });
});

test("Escape closes the picker and puts focus back on the button that opened it", async ({ page }) => {
  await openLanding(page);
  const add = page.getByRole("button", { name: "Add a section" });
  await add.click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#oba-landing-picker")).toBeHidden();
  await expect(add).toBeFocused();
});

test("an edit form has typed inputs only: nothing takes HTML or CSS", async ({ page }) => {
  seed(THREE());
  await openLanding(page);
  for (const id of ["hello", "text", "latest"]) {
    await card(page, id).getByRole("button", { name: /^Edit/ }).click();
    const names = await card(page, id).locator("input, textarea, select").evaluateAll((nodes) => nodes.map((node) => `${node.id} ${node.name} ${node.type}`.toLowerCase()));
    for (const name of names) expect(name).not.toMatch(/html|css|style|script|markup/);
    await card(page, id).getByRole("button", { name: "Done" }).click();
  }
  await page.getByRole("button", { name: "Add a section" }).click();
  await expect(page.locator("#oba-landing-picker")).not.toContainText(/\bHTML\b|\bCSS\b/);
  // Markup typed into a text field stays text.
  await card(page, "text").getByRole("button", { name: /^Edit/ }).click();
  await card(page, "text").getByLabel("Your text").fill("<script>window.__x=1</script> plain");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections[1].markdown).toBe("<script>window.__x=1</script> plain");
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
});

test("a field explains what is wrong in plain words once it has been left, and Save refuses with the reason", async ({ page }) => {
  seed(THREE());
  await openLanding(page);
  await card(page, "hello").getByRole("button", { name: /^Edit/ }).click();
  const heading = card(page, "hello").getByLabel("Welcome heading");
  await heading.fill("");
  await expect(card(page, "hello").locator(".oba-field-error:not([hidden])")).toHaveCount(0);
  await heading.blur();
  await expect(card(page, "hello").locator(".oba-field-error:not([hidden])")).toHaveText("Welcome heading is needed.");
  await expect(heading).toHaveAttribute("aria-invalid", "true");
  await expect(heading).toHaveAccessibleDescription(/Welcome heading is needed/);
  await expect(card(page, "hello").locator(".oba-landing-attention")).toHaveText("1 thing needs attention");
  const before = readFileSync(landingFile(), "utf8");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Nothing was saved: 1 thing needs attention");
  expect(readFileSync(landingFile(), "utf8")).toBe(before);
  await heading.fill("Hello again");
  await expect(card(page, "hello").locator(".oba-field-error:not([hidden])")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections[0].heading).toBe("Hello again");
});

test("an address and an email are checked as they are typed, with the fix in words", async ({ page }) => {
  seed([{ id: "go", type: "buttons", items: [{ label: "Read", href: "/archive/", style: "primary" }] }, { id: "c", type: "contact", email: "me@example.com" }]);
  await openLanding(page);
  await card(page, "go").getByRole("button", { name: /^Edit/ }).click();
  const href = card(page, "go").getByLabel("Where it goes");
  await expect(href).toHaveAttribute("type", "url");
  await href.fill("http://example.com");
  await href.blur();
  await expect(card(page, "go").locator(".oba-field-error:not([hidden])")).toHaveText("Use https:// rather than http://.");
  await card(page, "c").getByRole("button", { name: /^Edit/ }).click();
  await expect(card(page, "c").getByLabel("Email (optional)")).toHaveAttribute("type", "email");
  await expect(card(page, "c").getByLabel("Phone number (optional)")).toHaveAttribute("type", "tel");
  const email = card(page, "c").getByLabel("Email (optional)");
  await email.fill("not-an-email");
  await email.blur();
  await expect(card(page, "c").locator(".oba-field-error:not([hidden])")).toHaveText("That does not look like an email address.");
});

test("sections move with real buttons, with the keyboard, and the result is announced", async ({ page }) => {
  seed(THREE());
  await openLanding(page);
  const down = (id) => card(page, id).locator('[data-action="move-down"]');
  const up = (id) => card(page, id).locator('[data-action="move-up"]');
  await expect(up("hello")).toBeDisabled();
  await expect(down("latest")).toBeDisabled();
  await expect(down("hello")).toHaveAccessibleName("Move down, Welcome banner “Hello there” (section 1 of 3)");
  await down("hello").click();
  expect(await order(page)).toEqual(["text", "hello", "latest"]);
  await expect(page.locator("[data-landing-status]")).toHaveText("Welcome banner moved down to position 2 of 3.");
  await expect(down("hello")).toBeFocused();
  // The keyboard alone: Tab to a button and press Enter or Space.
  await down("hello").focus();
  await page.keyboard.press("Enter");
  expect(await order(page)).toEqual(["text", "latest", "hello"]);
  // At the end of the list Move down is disabled, so focus passes to Move up.
  await expect(up("hello")).toBeFocused();
  await page.keyboard.press("Space");
  expect(await order(page)).toEqual(["text", "hello", "latest"]);
  // Alt with the arrow keys moves the focused card too.
  await up("hello").focus();
  await page.keyboard.press("Alt+ArrowUp");
  expect(await order(page)).toEqual(["hello", "text", "latest"]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections.map((section) => section.id)).toEqual(["hello", "text", "latest"]);
});

test("hide keeps a section and says so; show brings it back", async ({ page }) => {
  seed(THREE());
  await openLanding(page);
  const hide = card(page, "text").locator('[data-action="hide"]');
  await expect(hide).toHaveText("Hide");
  await hide.click();
  await expect(card(page, "text")).toContainText("hidden from visitors");
  await expect(hide).toHaveText("Show");
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await expect(hide).toBeFocused();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections[1].hidden).toBe(true);
  await hide.click();
  await expect(page.locator("[data-landing-status]")).toContainText("is shown to visitors again");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections[1].hidden).toBeUndefined();
});

test("delete is undone into the same place, by button or after moving on", async ({ page }) => {
  seed(THREE());
  await openLanding(page);
  await card(page, "text").locator('[data-action="delete"]').click();
  expect(await order(page)).toEqual(["hello", "latest"]);
  await expect(page.locator("[data-landing-toast]")).toContainText("Deleted Text");
  // Focus moves to the card that took its place.
  await expect(card(page, "latest").getByRole("button", { name: /^Edit/ })).toBeFocused();
  await page.locator('[data-landing-toast] [data-action="undo"]').click();
  expect(await order(page)).toEqual(["hello", "text", "latest"]);
  await expect(page.locator("[data-landing-toast]")).toBeHidden();
  await expect(card(page, "text").getByRole("button", { name: /^Edit/ })).toBeFocused();
  // Nothing was written by any of that.
  expect(stored().sections.map((section) => section.id)).toEqual(["hello", "text", "latest"]);
  // Deleting the last card moves focus to Add a section; Dismiss keeps the deletion.
  await card(page, "latest").locator('[data-action="delete"]').click();
  await card(page, "text").locator('[data-action="delete"]').click();
  await card(page, "hello").locator('[data-action="delete"]').click();
  await expect(page.getByRole("button", { name: "Add a section" })).toBeFocused();
  await expect(page.locator("[data-landing-empty]")).toBeVisible();
  await page.locator('[data-landing-toast] [data-action="dismiss-undo"]').click();
  await expect(page.locator("[data-landing-toast]")).toBeHidden();
  expect(await order(page)).toEqual([]);
});

test("lists add and remove rows with real buttons and keep their labels", async ({ page }) => {
  seed([{ id: "faq", type: "faq", items: [{ question: "Is it free?", answer: "Yes." }] }]);
  await openLanding(page);
  await card(page, "faq").getByRole("button", { name: /^Edit/ }).click();
  await card(page, "faq").getByRole("button", { name: "Add another question" }).click();
  await expect(card(page, "faq").getByLabel("Question", { exact: true })).toHaveCount(2);
  await card(page, "faq").getByLabel("Question", { exact: true }).nth(1).fill("Why?");
  await card(page, "faq").getByLabel("Answer", { exact: true }).nth(1).fill("Because.");
  await card(page, "faq").getByRole("button", { name: "Remove Question 1" }).click();
  await expect(card(page, "faq").getByLabel("Question", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections[0].items).toEqual([{ question: "Why?", answer: "Because." }]);
});

test("a featured post is chosen from the published posts by name", async ({ page }) => {
  await openLanding(page);
  await page.getByRole("button", { name: "Add a section" }).click();
  await page.locator('[data-add-type="featured-post"]').click();
  const pick = card(page, "featured-post").getByLabel("Which post");
  await expect(pick).toHaveJSProperty("tagName", "SELECT");
  await pick.selectOption({ label: "One" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
  expect(stored().sections.at(-1)).toMatchObject({ type: "featured-post", post: "one" });
});

// ----- the live preview (ADR 0354, #327)

const preview = (page) => page.frameLocator("[data-landing-frame]");
const watchRequests = (page) => {
  const seen = [];
  page.on("request", (request) => seen.push({ method: request.method(), url: request.url() }));
  return seen;
};

test.describe("preview beside the builder on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("shows unsaved edits within a second or two, matches the built page, and writes nothing", async ({ page }) => {
    seed(THREE());
    const before = readFileSync(landingFile(), "utf8");
    const seen = watchRequests(page);
    await openLanding(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator("[data-landing-side]")).toBeVisible();
    await expect(preview(page).getByRole("heading", { name: "Hello there" })).toBeVisible();
    // An unsaved edit appears in the preview.
    await card(page, "hello").getByRole("button", { name: /^Edit/ }).click();
    await card(page, "hello").getByLabel("Welcome heading").fill("A brand new welcome");
    await expect(preview(page).getByRole("heading", { name: "A brand new welcome" })).toBeVisible({ timeout: 2500 });
    // A moved section changes the order in the preview.
    await card(page, "hello").getByRole("button", { name: "Done" }).click();
    await card(page, "hello").locator('[data-action="move-down"]').click();
    await expect.poll(async () => preview(page).locator(".ob-home-section").evaluateAll((nodes) => nodes.map((node) => node.id)), { timeout: 2500 }).toEqual(["ob-home-text", "ob-home-hello", "ob-home-latest"]);
    // Nothing is stored and nothing was saved or published to get here.
    expect(readFileSync(landingFile(), "utf8")).toBe(before);
    expect(seen.filter((r) => r.url.includes("/admin/api/") && !["GET", "POST"].includes(r.method))).toEqual([]);
    expect(seen.filter((r) => r.method === "POST" && !/\/admin\/api\/(landing\/preview|login)$/.test(r.url))).toEqual([]);
    // Parity: once saved, the built home page has the same sections in the same order and text.
    const shown = await preview(page).locator(".ob-home-section").evaluateAll((nodes) => nodes.map((node) => ({ id: node.id, text: node.innerText.replace(/\s+/g, "") })));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("[data-landing-status]")).toContainText("Saved.");
    const html = await (await page.request.get(`${origin}/`)).text();
    const built = await page.evaluate((markup) => {
      const doc = new DOMParser().parseFromString(markup, "text/html");
      return [...doc.querySelectorAll(".ob-home-section")].map((node) => ({ id: node.id, text: node.textContent.replace(/\s+/g, "") }));
    }, html);
    expect(built.map((section) => section.id)).toEqual(shown.map((section) => section.id));
    expect(built.map((section) => section.id)).toEqual(["ob-home-text", "ob-home-hello", "ob-home-latest"]);
    for (const [index, section] of shown.entries()) expect(built[index].text).toBe(section.text);
  });

  test("the size switch is keyboard operable, announces the active size and scales the frame", async ({ page }) => {
    seed(THREE());
    await openLanding(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const group = page.getByRole("group", { name: "Preview size" });
    await expect(group.getByRole("button", { name: "Phone" })).toHaveAttribute("aria-pressed", "true");
    const frame = page.locator("[data-landing-frame]");
    await expect(frame).toHaveCSS("width", "375px");
    await group.getByRole("button", { name: "Tablet" }).focus();
    await page.keyboard.press("Enter");
    await expect(group.getByRole("button", { name: "Tablet" })).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "Phone" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("[data-preview-status]")).toHaveText("Tablet view, 768 pixels wide.");
    await expect(frame).toHaveCSS("width", "768px");
    await expect(frame).toHaveAccessibleName(/tablet view/);
    await group.getByRole("button", { name: "Desktop" }).focus();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-preview-status]")).toHaveText("Desktop view, 1280 pixels wide.");
    // The frame is scaled to the space it has, so it never grows wider than its column.
    const box = await page.locator(".oba-landing-stage").boundingBox();
    const framed = await frame.boundingBox();
    expect(framed.width).toBeLessThanOrEqual(box.width + 1);
    await expect(preview(page).getByRole("heading", { name: "Hello there" })).toBeVisible();
  });

  test("a section that is not complete yet is left out of the preview, and the preview says so", async ({ page }) => {
    seed(THREE());
    await openLanding(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "Add a section" }).click();
    await page.locator('[data-add-type="image"]').click();
    await expect(page.locator("[data-preview-note]")).toHaveText("1 section needs attention and is left out of this preview.", { timeout: 2500 });
    await expect(preview(page).getByRole("heading", { name: "Hello there" })).toBeVisible();
  });

  test("the preview loads nothing from outside this site and runs no scripts", async ({ page }) => {
    seed([{ id: "text", type: "rich-text", markdown: "<script>window.top.__pwned = 1</script> plain" }, ...THREE().slice(2)]);
    const seen = watchRequests(page);
    await openLanding(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(preview(page).locator("#ob-home-text")).toBeVisible();
    await expect(preview(page).locator("#ob-home-text")).toContainText("<script>window.top.__pwned = 1</script>");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    const outside = seen.filter((request) => /^https?:/.test(request.url) && !request.url.startsWith(origin));
    expect(outside).toEqual([]);
  });
});

test.describe("preview as a full-screen sheet on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("opens over the builder with an obvious Back, keeps focus inside, and returns focus", async ({ page }) => {
    seed(THREE());
    const before = readFileSync(landingFile(), "utf8");
    await openLanding(page);
    const open = page.getByRole("button", { name: "Preview", exact: true });
    await open.click();
    const sheet = page.locator("[data-landing-sheet]");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Preview" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Back to editing" })).toBeFocused();
    await expect(page.locator("[data-landing-side]")).toBeHidden();
    await expect(preview(page).getByRole("heading", { name: "Hello there" })).toBeVisible();
    // The sheet fills the screen and the frame fits without sideways scrolling.
    const box = await sheet.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(374);
    expect(box.height).toBeGreaterThanOrEqual(660);
    expect(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByRole("group", { name: "Preview size" }).getByRole("button", { name: "Desktop" }).click();
    expect(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    // Tab never reaches the builder behind the sheet: focus is in the sheet, or has left the page.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => {
        const active = document.activeElement;
        return !active || active === document.body || Boolean(active.closest("[data-landing-sheet]"));
      })).toBe(true);
    }
    await page.locator("[data-landing-sheet]").getByRole("button", { name: "Back to editing" }).focus();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
    // Back works too, and nothing was stored.
    await open.click();
    await sheet.getByRole("button", { name: "Back to editing" }).click();
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
    expect(readFileSync(landingFile(), "utf8")).toBe(before);
  });
});

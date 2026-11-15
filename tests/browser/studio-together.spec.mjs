import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Writing together (Studio R14a), against a real server, ported from the old Admin's
// shared-drafts spec and grown into the whole loop: an owner starts one ("when everyone's ready"
// is what is sent), invites someone new and copies the link; that person opens it in a second
// browser (the token is out of the address before the first request), chooses a password and lands
// on the reflection, seeing only Writing together while the server refuses everything else; both
// write (two tabs keep both), share, read each other as text, see it in a sandbox, agree, take it
// back and agree again; the owner publishes and the post is there, signed by both; the co-writer
// has no Publish; put away can be undone. Each screen passes axe at 320 px with nothing sideways.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const leePassword = `lee-${randomBytes(12).toString("hex")}`;
let dir;
let child;
let origin;
let output = "";
let id = "";
let link = "";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-together-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Ann Owner" };
  config.contributors = { "ann-owner": { name: "Ann Owner" }, lee: { name: "Lee Park" } };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  execFileSync(binary, ["user", "add", "ann", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }
  removeTree(dir);
});

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
});

async function signIn(page, user, secret) {
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill(user);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(secret);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function open(page, hash, user = "ann", secret = password) {
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  await signIn(page, user, secret);
}

async function axeClean(page, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.body, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${label}: nothing sideways`).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

const status = (page) => page.locator(".studio-did");

test("an owner starts writing together, keyboard only, and it shares when everyone's ready", async ({ page }) => {
  await open(page, "#/posts");
  await expect(page.getByRole("link", { name: "Write something with others" })).toBeVisible();
  await page.getByRole("link", { name: "Write something with others" }).click();
  await expect(page).toHaveURL(/#\/together\/new$/);
  await expect(page.getByRole("heading", { name: "Start writing together", level: 2 })).toBeVisible();
  await axeClean(page, "Start writing together");
  // Start with nothing typed: the first check, on its field.
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Give it a name, like the title of the video.").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What it's called" })).toBeFocused();
  await page.keyboard.type("How to Listen");
  await page.getByRole("textbox", { name: "Link, if it has one" }).fill("javascript:alert(1)");
  await page.getByRole("textbox", { name: "The question you each answer" }).fill("What changed how you see your work?");
  await page.getByRole("textbox", { name: "A name for it" }).fill("What we noticed");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("A full web address, starting with https://.").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Link, if it has one" }).fill("https://example.org/listen");
  // Her name is the one matching the blog's; the sharing choice starts at "When everyone's ready".
  await expect(page.getByRole("combobox", { name: "Your name on it" })).toHaveValue("ann-owner");
  const sent = page.waitForRequest((r) => r.url().endsWith("/admin/api/collaboration/publications") && r.method() === "POST");
  await page.getByRole("button", { name: "Start", exact: true }).focus();
  await page.keyboard.press("Enter");
  const body = (await sent).postDataJSON();
  expect(body.revealPolicy).toBe("allReady");
  await expect(page).toHaveURL(/#\/together\/shared-[0-9a-f]{12}$/);
  id = page.url().match(/shared-[0-9a-f]{12}/)[0];
  await expect(page.getByText("Started. Only you can see it until you invite someone.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we noticed", level: 2 })).toBeVisible();
  await expect(page.getByText("Invite someone to write with you.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open How to Listen in a new tab" })).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await axeClean(page, "The reflection");
});

test("she invites someone new by name, and the link is shown once to copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, `#/together/${id}`);
  await page.getByRole("button", { name: /^Invite someone: / }).click();
  const sheet = page.locator("side-sheet");
  await expect(sheet.getByRole("heading", { name: "People in What we noticed" })).toBeVisible();
  await sheet.getByRole("combobox", { name: "Their name" }).selectOption("lee");
  await expect(sheet.getByRole("textbox", { name: "Sign-in name" })).toHaveValue("leepark");
  await sheet.getByRole("button", { name: "Make the invitation link" }).click();
  await expect(sheet.getByText(/^Send this link to Lee Park yourself\. It works once, until/)).toBeVisible();
  await expect(sheet.getByText("You won't see this link again. If it's lost, make a new one.")).toBeVisible();
  link = await sheet.getByRole("textbox", { name: "The invitation link" }).inputValue();
  expect(link).toMatch(new RegExp(`^${origin}/admin/studio/#/together/join/${id}\\.[0-9a-f]{64}$`));
  await sheet.getByRole("button", { name: "Copy the link" }).click();
  await expect(sheet.getByText("Copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await expect(sheet.getByText(/Waiting for Lee Park to say yes, until/).first()).toBeVisible();
  await axeClean(page, "People sheet");
  // Nothing on disk holds the token, and the server never logged it.
  const secret = link.split(".").pop();
  expect(output).not.toContain(secret);
});

test("the person invited opens the link, chooses a password, and sees only Writing together", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const secret = link.split(".").pop();
  const requests = [];
  page.on("request", (request) => requests.push({ url: request.url(), at: page.url() }));
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Write together", level: 1 })).toBeVisible();
  // Out of the address before the first request, and never in a request's address.
  const api = requests.filter((r) => r.url.includes("/admin/api/"));
  expect(api.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.url).not.toContain(secret);
    if (request.url.includes("/admin/api/")) expect(request.at).not.toContain(secret);
  }
  expect(page.url()).not.toContain(secret);
  // The entry it opened with was replaced, not added to: going back leaves Studio altogether.
  expect(await page.evaluate(() => history.length)).toBe(2);
  expect(await page.evaluate((s) => [JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some((v) => v.includes(s)), secret)).toBe(false);
  await expect(page.getByText("Ann Owner invited you to write about:")).toBeVisible();
  await expect(page.getByText("You'll write a part, signed Lee Park.")).toBeVisible();
  await expect(page.getByText("Your sign-in name: leepark")).toBeVisible();
  await axeClean(page, "Join");
  await page.getByRole("textbox", { name: "Choose a password" }).fill("short");
  await page.getByRole("textbox", { name: "Type it again" }).fill("short");
  await page.getByRole("button", { name: "Say yes" }).click();
  await expect(page.getByText("At least 12 characters.")).toBeVisible();
  await page.getByRole("textbox", { name: "Choose a password" }).fill(leePassword);
  await page.getByRole("textbox", { name: "Type it again" }).fill(`${leePassword}x`);
  await page.getByRole("button", { name: "Say yes" }).click();
  await expect(page.getByText("The two passwords don't match.")).toBeVisible();
  await page.getByRole("textbox", { name: "Type it again" }).fill(leePassword);
  await page.getByRole("button", { name: "Say yes" }).click();
  await expect(page).toHaveURL(new RegExp(`#/together/${id}$`));
  await expect(page.getByText("You're in. Write your part when you're ready.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we noticed", level: 2 })).toBeVisible();
  // Their only screen: the navigation is Writing together, Home is it, and Find lists only it.
  const nav = await page.locator("dashboard-shell").evaluate((shell) => shell.nav.map((item) => item.label));
  expect(nav).toEqual(["Writing together · 1 waiting on you"]);
  await page.goto(`${origin}/admin/studio/#/`);
  await expect(page.getByRole("heading", { name: "Writing together", level: 2 })).toBeVisible();
  await page.goto(`${origin}/admin/studio/#/settings`);
  await expect(page.getByRole("heading", { name: "Writing together", level: 2 })).toBeVisible();
  // The server is the safety: everything else is refused, and meta holds nothing of the site's.
  const answers = await page.evaluate(async () => {
    const csrf = (await (await fetch("/admin/api/session")).json()).csrf;
    const ask = async (method, path, body) => (await fetch(`/admin/api/${path}`, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined })).status;
    const meta = await (await fetch("/admin/api/meta")).json();
    return {
      meta: Object.keys(meta).sort(),
      document: await ask("GET", "document?path=posts/hello.md"),
      documents: await ask("GET", "documents"),
      contributors: await ask("PUT", "contributors", { contributors: {} }),
      social: await ask("GET", "social/status"),
      assistant: await ask("GET", "assistant/settings"),
      publish: await ask("POST", "collaboration/publish", { publicationId: "x" }),
      start: await ask("POST", "collaboration/publications", {}),
    };
  });
  expect(answers.meta).toEqual(["account", "now", "siteTitle", "siteUrl", "studioWords", "together"]);
  for (const [route, code] of Object.entries(answers)) if (route !== "meta") expect(code, route).toBe(403);
  const kept = await page.evaluate(() => localStorage.getItem("studio:last-start"));
  expect(Object.keys(JSON.parse(kept).meta).sort()).toEqual(["account", "now", "siteTitle", "siteUrl", "studioWords", "together"]);
  await axeClean(page, "Writing together, co-writer");
  // The link was used once: open it again and it says so.
  await page.goto(link);
  await expect(page.locator("main")).toBeVisible();
  await page.goto("about:blank");
  const again = await browser.newContext({ serviceWorkers: "block" });
  const fresh = await again.newPage();
  await fresh.goto(link);
  await expect(fresh.getByText("This link doesn't work any more. Ask the person who sent it for a new one.")).toBeVisible();
  await again.close();
  await context.close();
  expect(output).not.toContain(secret);
});

async function writePart(page, words) {
  const box = page.getByRole("textbox", { name: "Your words", exact: true });
  await box.click();
  await box.fill(words);
}

test("both write, share, and read each other's words as text; two tabs never lose words", async ({ page, browser }) => {
  // The owner writes and shares first.
  await open(page, `#/together/${id}/write`);
  await expect(page.getByRole("heading", { name: "Your part", level: 2 })).toBeVisible();
  await expect(page.getByText("What stood out to you, and why?")).toBeVisible();
  await page.getByRole("button", { name: "Add “What stood out to you, and why?” to your words" }).click();
  await expect(status(page)).toContainText("Added to your words.");
  await writePart(page, "I kept thinking about the pause before an answer.\n\nAnd **this** stays as typed.");
  await expect(page.locator(".studio-part-status")).toHaveText("Kept on this computer. Press Save to keep it on your blog.");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".studio-part-status")).toHaveText("Saved · only you can read it.");
  // A new part is a card in place, and Take out puts it back as it was.
  await page.getByRole("button", { name: "Start a new part" }).click();
  await expect(page.locator(".studio-part-break")).toHaveCount(1);
  await page.getByRole("button", { name: "Take out the start of part 2" }).click();
  await expect(page.locator(".studio-part-break")).toHaveCount(0);
  await axeClean(page, "Your part");
  await page.getByRole("button", { name: "Let the others read it" }).click();
  const ask = page.getByRole("dialog", { name: "Let the others read your part as it is now?" });
  await ask.getByRole("button", { name: "Let them read it" }).click();
  await expect(status(page)).toContainText("Ready. You'll all read each other's parts when everyone's ready.");
  await expect(page.getByRole("button", { name: "Not yet after all" })).toBeVisible();

  // The co-writer, in two tabs.
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const one = await context.newPage();
  await open(one, `#/together/${id}/write`, "leepark", leePassword);
  await expect(one.getByRole("heading", { name: "Your part", level: 2 })).toBeVisible();
  const two = await context.newPage();
  await two.goto(`${origin}/admin/studio/#/together/${id}/write`);
  await expect(two.getByRole("heading", { name: "Your part", level: 2 })).toBeVisible();
  await writePart(one, "From the first tab.");
  await one.keyboard.press("Control+s");
  await expect(one.locator(".studio-part-status")).toHaveText("Saved · only you can read it.");
  await writePart(two, "From the second tab <script>alert(1)</script>.");
  await two.keyboard.press("Control+s");
  const conflict = two.locator(".studio-part-conflict");
  await expect(conflict).toContainText("You changed your part somewhere else too.");
  await expect(conflict).toContainText("From the first tab.");
  await expect(conflict).toContainText("From the second tab <script>alert(1)</script>.");
  await expect(two.getByRole("textbox", { name: "Your words", exact: true })).toHaveValue("From the second tab <script>alert(1)</script>.");
  await conflict.getByRole("button", { name: "Keep mine" }).click();
  await expect(two.locator(".studio-part-status")).toHaveText("Saved · only you can read it.");
  await two.getByRole("button", { name: "Let the others read it" }).click();
  await two.getByRole("dialog", { name: "Let the others read your part as it is now?" }).getByRole("button", { name: "Let them read it" }).click();
  await expect(status(two)).toContainText("Shared. You can read everyone's parts now.");
  await two.getByRole("link", { name: "Read them" }).click();
  await expect(two.getByRole("heading", { name: "Everyone's parts", level: 2 })).toBeVisible();
  const ann = two.locator(".studio-together-part", { has: two.getByRole("heading", { name: "Ann Owner" }) });
  await expect(ann).toContainText("And **this** stays as typed.");
  expect(await ann.locator("b, strong, script").count()).toBe(0);
  // Their own words, in their own tab, are text too: the script is shown, never run.
  const own = two.locator(".studio-together-part", { has: two.getByRole("heading", { name: "Your part" }) });
  await expect(own).toContainText("<script>alert(1)</script>");
  expect(await own.locator("script").count()).toBe(0);
  await expect(ann.locator("p[dir=auto]").first()).toBeVisible();
  // As readers will see it: the server's document in a frame with no allowances.
  await two.getByRole("button", { name: "See it as readers will" }).click();
  const frame = two.locator("iframe.studio-together-frame");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(frame).toHaveAttribute("title", "What we noticed, as readers will see it. Not published.");
  await axeClean(two, "Everyone's parts");
  // Agree, take it back, agree again.
  await two.getByRole("button", { name: "Agree to publish What we noticed" }).click();
  await two.getByRole("dialog", { name: "Agree to publish exactly what you just read?" }).getByRole("button", { name: "Agree", exact: true }).click();
  await expect(status(two)).toContainText("Agreed.");
  await status(two).getByRole("button", { name: "Undo" }).click();
  await expect(status(two)).toContainText("Your agreement is taken back.");
  await two.getByRole("button", { name: "Agree to publish What we noticed" }).click();
  await two.getByRole("dialog", { name: "Agree to publish exactly what you just read?" }).getByRole("button", { name: "Agree", exact: true }).click();
  await expect(status(two)).toContainText("Agreed.");
  await context.close();
});

test("the owner agrees and publishes; the co-writer never has Publish; put away can be undone", async ({ page, browser }) => {
  await open(page, `#/together/${id}/read?preview=1`);
  await expect(page.locator("iframe.studio-together-frame")).toBeVisible();
  await page.getByRole("button", { name: "Agree to publish What we noticed" }).click();
  await page.getByRole("dialog", { name: "Agree to publish exactly what you just read?" }).getByRole("button", { name: "Agree", exact: true }).click();
  await expect(status(page)).toContainText("Agreed.");

  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const lee = await context.newPage();
  await open(lee, `#/together/${id}`, "leepark", leePassword);
  await expect(lee.getByText("Everyone agreed. Waiting for Ann Owner to publish it.")).toBeVisible();
  await expect(lee.getByRole("button", { name: /^Publish/ })).toHaveCount(0);
  await context.close();

  await open(page, `#/together/${id}`);
  await expect(page.getByText("Everyone agreed.", { exact: true })).toBeVisible();
  // Agreed, but a part has markup the blog won't publish: refused, nothing written, in her words.
  await page.getByRole("button", { name: "Publish: What we noticed" }).click();
  await page.getByRole("dialog", { name: "Put “What we noticed” on your blog now?" }).getByRole("button", { name: "Publish", exact: true }).click();
  await expect(status(page)).toContainText("Someone's part has something your blog can't publish safely.");
  expect(existsSync(join(dir, "content", "posts", `${id}.md`))).toBe(false);

  // Lee changes their part: sharing the change says who agreed to the earlier words.
  const again = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const fix = await again.newPage();
  await open(fix, `#/together/${id}/write`, "leepark", leePassword);
  await writePart(fix, "From the second tab, plainly.");
  await expect(fix.locator(".studio-part-status")).toHaveText("Kept on this computer. Press Save to keep it on your blog.");
  await fix.getByRole("button", { name: "Let them read your changes" }).click();
  const share = fix.getByRole("dialog", { name: "Let the others read your part as it is now?" });
  await expect(share).toContainText("Ann Owner agreed to your earlier words. They'll need to read and agree again.");
  await share.getByRole("button", { name: "Let them read it" }).click();
  await expect(status(fix)).toContainText("Ready. You'll all read each other's parts when everyone's ready.");
  // The change reaches her once she lets them read hers again; then they both read and agree.
  await open(page, `#/together/${id}`);
  await expect(page.getByText("Someone shared a new version of their part. Let the others read yours again, and you'll all read the new one.")).toBeVisible();
  await page.getByRole("link", { name: "Let the others read it: What we noticed" }).click();
  await page.getByRole("button", { name: "Let the others read it" }).click();
  await page.getByRole("dialog", { name: "Let the others read your part as it is now?" }).getByRole("button", { name: "Let them read it" }).click();
  await expect(status(page)).toContainText("Shared. You can read everyone's parts now.");
  // Each approves their own part (the rule's scope), so only Lee, who changed theirs, agrees again;
  // she reads the new words and is told her agreement still stands.
  await open(page, `#/together/${id}/read?preview=1`);
  await expect(page.locator(".studio-together-part").filter({ hasText: "From the second tab, plainly." })).toHaveCount(1);
  await expect(page.getByText("You agreed to exactly this.")).toBeVisible();
  for (const [who, user, secret] of [[fix, "leepark", leePassword]]) {
    await open(who, `#/together/${id}/read?preview=1`, user, secret);
    await expect(who.locator("iframe.studio-together-frame")).toBeVisible();
    await expect(who.locator(".studio-together-part").filter({ hasText: "From the second tab, plainly." })).toHaveCount(1);
    await who.getByRole("button", { name: "Agree to publish What we noticed" }).click();
    await who.getByRole("dialog", { name: "Agree to publish exactly what you just read?" }).getByRole("button", { name: "Agree", exact: true }).click();
    await expect(status(who)).toContainText("Agreed.");
  }
  await again.close();
  await open(page, `#/together/${id}`);
  await page.getByRole("button", { name: "Publish: What we noticed" }).click();
  const ask = page.getByRole("dialog", { name: "Put “What we noticed” on your blog now?" });
  await expect(ask).toContainText("It will be signed by Ann Owner and Lee Park.");
  await ask.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(status(page)).toContainText("It's on your blog.");
  const post = join(dir, "content", "posts", `${id}.md`);
  expect(existsSync(post)).toBe(true);
  const credits = JSON.parse(readFileSync(join(dir, "content", "posts", `${id}.credits.json`), "utf8")).credits.map((c) => c.contributor);
  expect(credits).toEqual(["ann-owner", "lee"]);
  await expect(page.getByRole("link", { name: "Open it" }).first()).toHaveAttribute("href", `#/write/${encodeURIComponent(`posts/${id}.md`)}`);
});

test("a reflection she no longer wants is put away and brought back, with nothing thrown away", async ({ page }) => {
  await open(page, "#/together/new");
  await page.getByRole("textbox", { name: "What it's called" }).fill("A book we read");
  await page.getByRole("textbox", { name: "A name for it" }).fill("Letters home");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Letters home", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /^More/ }).click();
  await page.getByRole("menuitem", { name: "Put it away" }).click();
  await expect(status(page)).toContainText("Put away. Nothing was thrown away.");
  await status(page).getByRole("button", { name: "Undo" }).click();
  await expect(status(page)).toContainText("It's back.");
  await page.evaluate(async () => {
    const csrf = (await (await fetch("/admin/api/session")).json()).csrf;
    await fetch("/admin/api/collaboration/publications", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ title: "A second one", contributorId: "ann-owner", revealPolicy: "voluntary", sources: [{ kind: "other", title: "A walk" }] }) });
  });
  await open(page, "#/together");
  await expect(page.getByRole("heading", { name: "Writing together", level: 2 })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Letters home: Just started\./ })).toBeVisible();
  // ↑/↓ move between the cards; Enter opens the one in focus.
  const links = page.locator("a.studio-together-open");
  await links.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(links.first()).toBeFocused();
  await page.getByRole("button", { name: "On your blog", exact: true }).click();
  await expect(page.getByRole("link", { name: /^What we noticed: On your blog\./ })).toBeVisible();
  await axeClean(page, "Writing together");
});

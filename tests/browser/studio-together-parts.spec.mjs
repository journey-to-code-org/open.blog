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

// Writing together, the parts the server had and the screens didn't (#705), against a real server:
// a writer adds a part of their own, saves it, moves it and takes one out, all by keyboard, and all
// of them are shared together; a layout that still names a part taken out says so and is started
// again; and under "Only the people each writer chooses" a writer chooses who reads, and someone
// who only reads sees just that, under its writer's name. Each screen passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const samPassword = `sam-${randomBytes(12).toString("hex")}`;
let dir;
let child;
let origin;
let output = "";

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-together-parts-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Ann Owner" };
  config.contributors = { "ann-owner": { name: "Ann Owner" }, sam: { name: "Sam Reader" } };
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

/** What the screen said last; `parts` is the line under "Your other parts". */
const status = (page) => page.locator(".studio-did:not(.studio-extra .studio-did)");
const parts = (page) => page.locator(".studio-extra .studio-did");

/** One call to the server as the page's sign-in, for setting a scene the other spec covers by hand. */
const call = (page, method, path, body) => page.evaluate(async ([method, path, body]) => {
  const csrf = (await (await fetch("/admin/api/session")).json()).csrf;
  const reply = await fetch(`/admin/api/${path}`, { method, headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: body ? JSON.stringify(body) : undefined });
  return { status: reply.status, body: await reply.json().catch(() => null) };
}, [method, path, body]);

async function start(page, title, revealPolicy = "allReady") {
  await open(page, "#/together");
  const made = await call(page, "POST", "collaboration/publications", { title, guidingQuestion: "What changed?", contributorId: "ann-owner", revealPolicy, sources: [{ kind: "other", title: "How to Listen", url: "", creator: "", publisher: "", published: "", isbn: "" }] });
  expect(made.status).toBe(201);
  return made.body.publication.publicationId;
}

const part = (page, n) => page.getByRole("textbox", { name: `Part ${n}` });

test("a writer adds, saves, moves and takes out a part by keyboard, and shares them all together", async ({ page }) => {
  const id = await start(page, "Several parts");
  await open(page, `#/together/${id}/write`);
  await page.getByRole("textbox", { name: "Your words" }).fill("Ann's first part.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved · only you can read it.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your other parts" })).toBeVisible();

  // Add two, by keyboard; each is kept on the server at once and says so.
  const add = page.getByRole("button", { name: "Add another part" });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(parts(page)).toContainText("Part 2 added. Only you can read it.");
  await part(page, 2).fill("Ann's second part.");
  await page.getByRole("button", { name: "Save this part" }).first().click();
  await expect(parts(page)).toContainText("Part 2 saved. Only you can read it.");
  await page.waitForTimeout(300); // saving puts the cursor back in the part a moment later
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(parts(page)).toContainText("Part 3 added.");
  await part(page, 3).fill("Ann's third part.");
  await page.getByRole("button", { name: "Save this part" }).nth(1).click();
  await expect(parts(page)).toContainText("Part 3 saved.");
  await page.waitForTimeout(300);
  await axeClean(page, "Your part, with other parts");

  // Move the third up: it is part 2 now, and stays so after a reload.
  await page.getByRole("button", { name: "Move part 3 up" }).focus();
  await page.keyboard.press("Enter");
  await expect(parts(page)).toContainText("Moved. It is part 2 now.");
  await expect(part(page, 2)).toHaveValue("Ann's third part.");
  await open(page, `#/together/${id}/write`);
  await expect(part(page, 2)).toHaveValue("Ann's third part.");
  await expect(part(page, 3)).toHaveValue("Ann's second part.");

  // Take one out: it asks once, in plain words, and Escape leaves it alone.
  await page.getByRole("button", { name: "Take part 3 out" }).click();
  const ask = page.getByRole("dialog", { name: "Take part 3 out for good?" });
  await expect(ask).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(part(page, 3)).toHaveCount(1);
  await page.getByRole("button", { name: "Take part 3 out" }).click();
  await page.getByRole("dialog", { name: "Take part 3 out for good?" }).getByRole("button", { name: "Take it out" }).click();
  await expect(parts(page)).toContainText("Taken out.");
  await expect(part(page, 3)).toHaveCount(0);

  // Sharing takes both parts together, and says so first.
  await page.getByRole("button", { name: "Let the others read it" }).click();
  const share = page.getByRole("dialog", { name: "Let the others read your part as it is now?" });
  await expect(share.getByText("All 2 of your parts go together, as they are now.")).toBeVisible();
  await share.getByRole("button", { name: "Let them read it" }).click();
  await expect(status(page)).toContainText(/Ready|Shared/);
  const listed = await call(page, "GET", `collaboration/contributions?publicationId=${id}`);
  expect(listed.body.contributions.map((one) => one.markdown)).toEqual(["Ann's first part.", "Ann's third part."]);
  expect((await call(page, "GET", `collaboration/reveal?publicationId=${id}`)).body.ready).toBe(true);

  // A saved layout that names a part since taken out: said plainly, and started again once asked.
  await open(page, `#/together/${id}?sheet=layout`);
  await page.getByRole("button", { name: "Save the layout" }).click();
  await expect(page.getByText("Layout saved.", { exact: false }).first()).toBeVisible();
  await open(page, `#/together/${id}/write`);
  await page.getByRole("button", { name: "Not yet after all" }).click();
  await page.getByRole("button", { name: "Take part 2 out" }).click();
  await page.getByRole("dialog", { name: "Take part 2 out for good?" }).getByRole("button", { name: "Take it out" }).click();
  await expect(parts(page)).toContainText("Taken out.");
  expect((await call(page, "GET", `collaboration/reflection?publicationId=${id}`)).status).toBe(409);
  await open(page, `#/together/${id}?sheet=layout`);
  await expect(page.getByText("This layout has a part in it that was taken out")).toBeVisible();
  await axeClean(page, "Layout, with a part taken out");
  await page.getByRole("button", { name: "Start the layout again" }).click();
  const again = page.getByRole("dialog", { name: "Start the layout again?" });
  await again.getByRole("button", { name: "Leave it" }).click();
  await expect(page.getByText("This layout has a part in it that was taken out")).toBeVisible();
  await page.getByRole("button", { name: "Start the layout again" }).click();
  await page.getByRole("dialog", { name: "Start the layout again?" }).getByRole("button", { name: "Start the layout again" }).click();
  await expect(page.getByText("This layout has a part in it that was taken out")).toHaveCount(0);
  expect((await call(page, "GET", `collaboration/reflection?publicationId=${id}`)).status).toBe(200);
});

test("only the people each writer chooses: a writer chooses, and someone who only reads sees just that", async ({ page, browser }) => {
  const id = await start(page, "For chosen readers");
  await open(page, `#/together/${id}`);
  await page.getByRole("button", { name: "Only the people each writer chooses" }).click();
  await page.getByRole("dialog", { name: "Change when you read each other's parts?" }).getByRole("button", { name: "Change it" }).click();
  await expect(status(page).first()).toContainText("Changed.");
  await expect(async () => {
    expect((await call(page, "GET", `collaboration/reveal?publicationId=${id}`)).body.policy).toBe("namedRecipients");
  }).toPass({ timeout: 10000 });

  const invited = await call(page, "POST", "collaboration/invitations", { publicationId: id, contributorId: "sam", roles: ["reader"], newAccount: { signInName: "sam" } });
  expect(invited.status).toBe(201);
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });
  const sam = await context.newPage();
  await sam.goto(`${origin}${invited.body.link}`);
  await sam.getByRole("textbox", { name: "Choose a password" }).fill(samPassword);
  await sam.getByRole("textbox", { name: "Type it again" }).fill(samPassword);
  await sam.getByRole("button", { name: "Say yes" }).click();
  await expect(sam).toHaveURL(new RegExp(`#/together/${id}$`));

  // Nothing yet for the reader, said plainly.
  await sam.goto(`${origin}/admin/studio/#/together/${id}/read`);
  await expect(sam.getByRole("heading", { name: "Shared with you" })).toBeVisible();
  await expect(sam.getByText("Nobody has shared a part with you yet.")).toBeVisible();

  // The writer writes two parts and chooses who reads them.
  await open(page, `#/together/${id}/write`);
  await page.getByRole("textbox", { name: "Your words" }).fill("Only for Sam, part one.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved · only you can read it.").first()).toBeVisible();
  await page.getByRole("button", { name: "Add another part" }).click();
  await part(page, 2).fill("Only for Sam, part two.");
  await page.getByRole("button", { name: "Save this part" }).click();
  await expect(parts(page)).toContainText("Part 2 saved.");
  await expect(page.getByRole("button", { name: "Not yet after all" })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose who reads it" }).click();
  const dialog = page.getByRole("dialog", { name: "Who reads your part as it is now?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Let them read it" }).click();
  await expect(dialog.getByText("Choose at least one person.")).toBeVisible();
  await axeClean(page, "Choose who reads it");
  await dialog.getByRole("checkbox", { name: "Sam Reader" }).check();
  await dialog.getByRole("button", { name: "Let them read it" }).click();
  await expect(status(page)).toContainText("Shared with Sam Reader. They can read the words you had just now.");
  await expect(page.getByText("Sam Reader can read your words as they are saved now.")).toBeVisible();

  // The reader sees both parts under the writer's name, and nothing to agree to.
  await sam.goto("about:blank");
  await sam.goto(`${origin}/admin/studio/#/together/${id}/read`);
  await expect(sam.getByRole("heading", { name: "From Ann Owner" })).toBeVisible();
  await expect(sam.getByText("Only for Sam, part one.")).toBeVisible();
  await expect(sam.getByText("Only for Sam, part two.")).toBeVisible();
  await expect(sam.getByRole("button", { name: /agree/i })).toHaveCount(0);
  await axeClean(sam, "Shared with you");

  // A change after choosing stays with the writer, and the screen says who is behind.
  await part(page, 2).fill("Only for Sam, part two, changed.");
  await page.getByRole("button", { name: "Save this part" }).click();
  await expect(parts(page)).toContainText("Part 2 saved.");
  await open(page, `#/together/${id}/write`);
  await expect(page.getByText("Sam Reader can read what you had before your last change.", { exact: false })).toBeVisible();
  await axeClean(page, "Your part, with someone chosen");
  await sam.goto("about:blank");
  await sam.goto(`${origin}/admin/studio/#/together/${id}/read`);
  await expect(sam.getByText("Only for Sam, part two.", { exact: true })).toBeVisible();
  await context.close();
});

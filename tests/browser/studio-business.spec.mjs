import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 10a: Business, Services and Reviews on a trade site. The site names a trade, so the
// three show in the navigation (and Grammi's site, in other specs, never shows them). Business facts
// keep the phone in her format, say what needs fixing beside the field, and rewrite only `business`;
// a service is added with what's included and a question; a review is typed in, and a copy from a
// link fills the link and platform without guessing the name; and each passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let configPath;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-business-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.business = { trade: "roofing" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  mkdirSync(join(root, "content", "services"), { recursive: true });
  mkdirSync(join(root, "content", "proof"), { recursive: true });
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
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(root);
});

async function signIn(page, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

test("Business facts: problems beside the field, the phone in her format, and only business rewritten", async ({ page }) => {
  await signIn(page, "#/business");
  for (const item of ["Services", "Reviews", "Business"]) await expect(page.getByRole("link", { name: item, exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What should customers know about you?" })).toBeVisible();
  const before = JSON.parse(readFileSync(configPath, "utf8"));
  await page.getByRole("textbox", { name: "Name customers know you by" }).fill("Ridgeline Roofing");
  await page.getByRole("textbox", { name: "Email" }).fill("not an email");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Type one email address, like office@example.com.")).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).fill("dana@example.com");
  await page.getByRole("textbox", { name: "Phone" }).fill("304-555-0142");
  await page.getByRole("combobox", { name: "Monday", exact: true }).selectOption("open");
  await expect(page.getByLabel("Monday opens")).toBeVisible();
  await page.getByRole("button", { name: "Copy Monday to Tuesday–Friday" }).click();
  await expect(page.locator(".studio-business-footer")).toHaveText(/Ridgeline Roofing · \(304\) 555-0142 · Open Monday to Friday, 8 AM to 5 PM/);
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Everything's saved.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Phone" })).toHaveValue("(304) 555-0142");
  const after = JSON.parse(readFileSync(configPath, "utf8"));
  expect(after.business).toMatchObject({ displayName: "Ridgeline Roofing", phone: "+13045550142", email: "dana@example.com", trade: "roofing" });
  expect(Object.keys(after.business.hours).sort()).toEqual(["friday", "monday", "thursday", "tuesday", "wednesday"]);
  delete after.business; delete before.business;
  expect(after).toEqual(before);
});

test("a service is added with what's included and a question, then kept off the site", async ({ page }) => {
  await signIn(page, "#/services");
  await expect(page.getByRole("heading", { name: "No services yet" })).toBeVisible();
  await page.getByRole("link", { name: "Add a service" }).first().click();
  await page.getByRole("textbox", { name: "Name" }).fill("Roof repair");
  await page.getByRole("textbox", { name: "In one sentence" }).fill("We find the leak and fix it.");
  await page.getByRole("button", { name: "Add an item" }).click();
  await page.getByRole("textbox", { name: "Included" }).fill("Finding the leak");
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByRole("textbox", { name: "Question" }).fill("Do you work in the rain?");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".studio-banner")).toContainText("Answer (number 1): Add an answer.");
  await page.getByRole("textbox", { name: "Answer" }).fill("Only to tarp it.");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/service\/services%2Froof-repair\.md$/);
  const file = readFileSync(join(root, "content", "services", "roof-repair.md"), "utf8");
  expect(file).toContain("name: Roof repair");
  expect(file).toContain("Finding the leak");
  expect(file).toContain("Only to tarp it.");
  expect(file).toContain("Do you work in the rain?");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Keep it off your site for now" }).click();
  await expect.poll(() => readFileSync(join(root, "content", "services", "roof-repair.md"), "utf8")).toMatch(/draft: "?true"?/);
  await page.goto(`${origin}/admin/studio/#/services`);
  await expect(page.locator(".studio-post-row", { hasText: "Roof repair" })).toContainText("Off your site");
});

test("a review is copied from its link without guessing the name, then typed in and saved", async ({ page }) => {
  await page.route("**/admin/api/assistant/context/url/retrieve", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    sourceUrl: "https://g.page/r/ridgeline/review", canonicalUrl: "https://www.google.com/maps/reviews/ridgeline", retrievedAt: "2026-11-13T10:00:00Z", text: "They fixed our roof in a day. <b>Great</b>",
  }) }));
  await signIn(page, "#/review/new");
  await page.getByRole("textbox", { name: "Link to the review" }).first().fill("https://g.page/r/ridgeline/review");
  await page.getByRole("button", { name: "Copy the review" }).click();
  await expect(page.getByText("Copied. Check each line against the page, then Save.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reviewer's name" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Where it was left" })).toHaveValue("google");
  await expect(page.getByRole("textbox", { name: "The review", exact: true })).toHaveValue("They fixed our roof in a day. <b>Great</b>");
  await page.getByRole("textbox", { name: "Reviewer's name" }).fill("Pat M.");
  await page.getByLabel("Day it was written").fill("2026-10-20");
  await page.getByRole("combobox", { name: "Stars" }).selectOption("5");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/review\/proof%2F/);
  const files = readdirSync(join(root, "content", "proof"));
  expect(files.length).toBe(1);
  const file = readFileSync(join(root, "content", "proof", files[0]), "utf8");
  expect(file).toContain("author: Pat M.");
  expect(file).toContain("provenance: snapshot");
  await page.goto(`${origin}/admin/studio/#/reviews`);
  await expect(page.locator(".studio-post-row", { hasText: "Pat M." })).toContainText("5 stars · Google · October 20, 2026");
});

test("Business, a service and a review pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const hash of ["#/business", "#/service/new", "#/review/new", "#/reviews"]) {
    await signIn(page, hash);
    await expect(page.locator(".studio-page").first()).toBeVisible();
    await page.waitForTimeout(400);
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
    expect(results, hash).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), hash).toBe(false);
  }
});

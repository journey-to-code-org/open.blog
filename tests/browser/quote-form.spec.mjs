import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

// The real site's quote form at 400px (ADRs 0381 and 0382): labelled, big enough to tap, no sideways
// scroll, problems said beside each field and announced, a plain confirmation, a failure that says
// nothing was sent, and a form that is complete without JavaScript. The hosted function is faked.
// axe-core (a dev dependency of these tests, pinned in package.json) checks the form against WCAG 2.1 A
// and AA in each state a visitor sees, in the light and the dark scheme (#515).

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
let root;
let server;
let origin;

const POST = `---
title: Fence repair
date: 2026-10-24
---
We fix fences.

\`\`\`quote
service: Fence repair
service: New fence
\`\`\`

The end.
`;

test.use({ viewport: { width: 400, height: 900 } });

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-quote-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  const config = join(root, "openblog.json");
  const parsed = JSON.parse(readFileSync(config, "utf8"));
  parsed.quote = { enabled: true };
  parsed.serviceAreas = { version: 1, areas: [{ town: "Bend", region: "OR" }, { town: "Sisters", region: "OR" }] };
  writeFileSync(config, `${JSON.stringify(parsed, null, 2)}\n`);
  writeFileSync(join(root, "content", "posts", "fence-repair.md"), POST);
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/fence-repair/`)).ok).toBe(true);
  }).toPass({ timeout: 60000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(root);
});

async function open(page, { submit } = {}) {
  const posted = [];
  await page.route("**/api/quote/token", (route) => route.fulfill({ json: { token: "test-token" } }));
  await page.route("**/api/quote/submit", async (route) => {
    posted.push(route.request().postData() || "");
    await route.fulfill(submit ?? { status: 201, json: { status: "received" } });
  });
  await page.goto(`${origin}/fence-repair/`);
  await expect(page.locator("ob-quote form")).toBeVisible();
  // The script has fetched its token once the form is enhanced.
  await expect(page.locator("ob-quote form[data-enhanced]")).toHaveCount(1);
  await page.waitForTimeout(150);
  return posted;
}

async function fill(page) {
  await page.getByLabel("Your name").fill("Pat Smith");
  await page.getByLabel("Phone").fill("360 555 0142");
  await page.getByLabel("Town").selectOption("Bend, OR");
  await page.getByLabel("Service you need").selectOption("Fence repair");
  await page.getByLabel("What do you need done?").fill("Replace forty feet of cedar fence.");
}

test("every control is labelled, easy to tap and inside the screen", async ({ page }) => {
  await open(page);
  for (const label of ["Your name", "Phone", "Email (optional)", "Town", "Service you need", "What do you need done?", "Photos (optional)"]) {
    await expect(page.getByLabel(label)).toBeVisible();
  }
  for (const control of await page.locator(".ob-quote-field input:not([type=file]), .ob-quote-field select, .ob-quote-field textarea, .ob-quote-send").all()) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
  }
  const region = await page.locator("ob-quote").evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(region.scroll).toBeLessThanOrEqual(region.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("ob-quote option")).toContainText(["Choose one", "Bend, OR", "Sisters, OR", "Fence repair", "New fence"]);
  // The honeypot is not in the way of a person or a screen reader.
  await expect(page.locator(".ob-quote-trap")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".ob-quote-trap input")).not.toBeInViewport();
});

test("an empty form says what is wrong beside each field, sends nothing and moves focus", async ({ page }) => {
  const posted = await open(page);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByLabel("Your name")).toBeFocused();
  await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#ob-quote-1-name-error")).toHaveText("Enter your name.");
  await expect(page.locator("#ob-quote-1-description-error")).toContainText("Write at least a sentence");
  await expect(page.locator(".ob-quote-status")).toContainText("Some details need fixing");
  // The description ties to its error and hint for assistive technology.
  expect(await page.getByLabel("What do you need done?").getAttribute("aria-describedby")).toContain("ob-quote-1-description-error");
  expect(posted).toEqual([]);
});

test("a good request is sent once with its token and ends in a plain confirmation", async ({ page }) => {
  const posted = await open(page);
  await fill(page);
  await page.getByRole("button", { name: "Send request" }).click();
  const done = page.locator(".ob-quote-done");
  await expect(done).toHaveText(/Thank you\. We have your request/);
  await expect(done).toHaveAttribute("role", "status");
  await expect(done).toBeFocused();
  await expect(page.locator("ob-quote form")).toHaveCount(0);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toContain('name="token"');
  expect(posted[0]).toContain("test-token");
  expect(posted[0]).toContain("Pat Smith");
});

test("a failure says nothing was sent and keeps what was typed", async ({ page }) => {
  await open(page, { submit: { status: 503, json: { error: "storage-unavailable" } } });
  await fill(page);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".ob-quote-status")).toContainText("nothing was sent");
  await expect(page.getByLabel("Your name")).toHaveValue("Pat Smith");
  await expect(page.getByRole("button", { name: "Send request" })).toBeEnabled();
});

test("a time-out does not say the request was not saved (ADR 0388)", async ({ page }) => {
  await open(page, { submit: { status: 504, json: { error: "timeout" } } });
  await fill(page);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".ob-quote-status")).toContainText("It may have been saved");
  await expect(page.locator(".ob-quote-status")).not.toContainText("nothing was sent");
});

test("a field problem from the server is shown beside the field", async ({ page }) => {
  await open(page, { submit: { status: 422, json: { error: "invalid", fields: [{ field: "phone", reason: "invalid" }] } } });
  await fill(page);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator("#ob-quote-1-phone-error")).toHaveText("Please check this field.");
  await expect(page.getByLabel("Phone")).toBeFocused();
});

test("without JavaScript the form is complete and posts to the function", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 400, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${origin}/fence-repair/`);
  const form = page.locator("ob-quote form");
  await expect(form).toHaveAttribute("method", "post");
  await expect(form).toHaveAttribute("action", "/api/quote/submit");
  await expect(form).toHaveAttribute("enctype", "multipart/form-data");
  await expect(page.getByLabel("Your name")).toHaveAttribute("required", "");
  await expect(page.getByRole("button", { name: "Send request" })).toBeVisible();
  await context.close();
});

async function axeViolations(page, covers = ["label", "color-contrast"]) {
  // Evaluated rather than added as a script tag, so the page's content security policy stays as it is.
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.evaluate(axeSource);
  const result = await page.evaluate(() =>
    window.axe.run({ include: [["ob-quote"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }),
  );
  // The run really covered the form: rules such as labels and contrast passed on it.
  expect(result.passes.map((rule) => rule.id)).toEqual(expect.arrayContaining(covers));
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

for (const colorScheme of ["light", "dark"]) {
  test(`axe finds no WCAG A or AA problem in the form, its errors or its confirmation (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
    expect(await axeViolations(page)).toEqual([]);
    await fill(page);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.locator(".ob-quote-done")).toBeVisible();
    // The form is gone; only the confirmation is left to check.
    expect(await axeViolations(page, ["color-contrast"])).toEqual([]);
  });
}

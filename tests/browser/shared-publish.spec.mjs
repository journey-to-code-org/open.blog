import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { removeTree } from "./teardown.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;
let server;
let origin;

test.setTimeout(180000);
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(360000);
  root = mkdtempSync(join(tmpdir(), "openblog-publish-browser-"));
  execFileSync("cargo", ["build", "--locked", "-p", "openblog-cli"], { cwd: repository, stdio: "pipe", timeout: 180000 });
  execFileSync("cargo", ["test", "--locked", "-p", "openblog-cli", "--bin", "openblog", "generate_approval_browser_fixture", "--", "--ignored"], {
    cwd: repository, env: { ...process.env, OPENBLOG_APPROVAL_FIXTURE: root }, stdio: "pipe", timeout: 180000,
  });
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
    expect((await fetch(`${origin}/admin/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  if (root) removeTree(root);
});

async function open(page, username, password) {
  await page.goto(`${origin}/admin/`);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto(`${origin}/admin/#/shared`);
  await page.locator("summary", { hasText: "Your draft" }).click();
  await expect(page.getByLabel("Your reflection (Markdown)")).toBeVisible();
}

test("authors choose credits and approve before a coordinator publishes the exact piece", async ({ browser, page }) => {
  const otherContext = await browser.newContext();
  const grace = await otherContext.newPage();
  try {
    await page.setViewportSize({ width: 400, height: 800 });
    await open(page, "mikey", "correct horse battery");
    await open(grace, "grace", "another correct horse");
    for (const [author, kind] of [[page, "profile"], [grace, "uncredited"]]) {
      await author.locator("summary", { hasText: "My public credit" }).click();
      await author.getByLabel("My public credit").selectOption(kind);
      await author.getByRole("button", { name: "Save my credit" }).click();
      await expect(author.getByText("Your credit choice was saved.", { exact: false })).toBeVisible();
    }
    await page.locator("summary", { hasText: "Publish shared reflection" }).click();
    await page.evaluate(axe.source);
    const audit = await page.evaluate(() => window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    }));
    expect(audit.violations).toEqual([]);
    await page.getByLabel("I intend to publish the current approved piece publicly.").check();
    await page.getByRole("button", { name: "Publish approved piece" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /approve/i })).toBeVisible();
    for (const author of [page, grace]) {
      await author.getByRole("button", { name: "Review the combined piece" }).click();
      await author.getByRole("checkbox", { name: /I approve publishing exactly the piece I reviewed/ }).check();
      await author.getByRole("button", { name: "Approve this piece" }).click();
      await expect(author.getByText("Your approval was recorded.", { exact: false })).toBeVisible();
    }
    await page.getByLabel("I intend to publish the current approved piece publicly.").check();
    await page.getByRole("button", { name: "Publish approved piece" }).click();
    await expect(page.getByText("The approved piece was published.")).toBeVisible();
    const html = await page.request.get(`${origin}/feed.json`);
    const feed = await html.json();
    const item = feed.items.find((entry) => entry.content_html?.includes("GRACE-SECRET"));
    expect(item).toBeTruthy();
    expect(item.authors.map((author) => author.name)).toEqual(["Mikey"]);
    expect(JSON.stringify(item)).not.toContain("grace");
    expect(readFileSync(join(root, "dist", "feed.json"), "utf8")).toContain("GRACE-SECRET");
  } finally {
    await otherContext.close();
  }
});

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
const binary = join(process.env.CARGO_TARGET_DIR || join(repository, "target"), "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;
let server;
let origin;

test.setTimeout(180000);
test.use({ actionTimeout: 10000, navigationTimeout: 15000 });
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(360000);
  root = mkdtempSync(join(tmpdir(), "openblog-multi-browser-"));
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

test("two authors share, review and publish every contribution", async ({ browser, page }) => {
  const otherContext = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const grace = await otherContext.newPage();
  try {
    await page.setViewportSize({ width: 400, height: 800 });
    await open(page, "mikey", "correct horse battery");
    await open(grace, "grace", "another correct horse");
    await page.getByLabel("New contribution (Markdown)").fill("EXTRA-PRIVATE-PERSPECTIVE");
    await page.getByRole("button", { name: "Add contribution" }).click();
    await expect(page.getByLabel("Contribution 2 text")).toHaveValue("EXTRA-PRIVATE-PERSPECTIVE");
    await grace.reload();
    await grace.locator("summary", { hasText: "Your draft" }).click();
    await expect(grace.locator("body")).not.toContainText("EXTRA-PRIVATE-PERSPECTIVE");
    expect(await (await page.request.get(`${origin}/feed.json`)).text()).not.toContain("EXTRA-PRIVATE-PERSPECTIVE");
    await page.getByRole("button", { name: "Take back my offer" }).click();
    await page.getByRole("button", { name: "Offer all my contributions to the group" }).click();
    const confirmation = page.getByRole("group", { name: "Share 2 contributions?" });
    await expect(confirmation).toBeFocused();
    await page.evaluate(axe.source);
    expect((await page.evaluate(() => window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    }))).violations).toEqual([]);
    await confirmation.getByRole("button", { name: "Share these revisions" }).click();
    await grace.getByRole("button", { name: "Take back my offer" }).click();
    await grace.getByRole("button", { name: "Offer revision 1 to the group" }).click();
    await grace.getByRole("button", { name: "Share revision 1" }).click();
    await grace.reload();
    await grace.locator("summary", { hasText: "Your draft" }).click();
    await expect(grace.getByLabel("Additional text from Mikey")).toContainText("EXTRA-PRIVATE-PERSPECTIVE");
    for (const author of [page, grace]) {
      await author.locator("summary", { hasText: "My public credit" }).click();
      await author.getByLabel("My public credit").selectOption("profile");
      await author.getByRole("button", { name: "Save my credit" }).click();
      await expect(author.getByText("Your credit choice was saved.", { exact: false })).toBeVisible();
    }
    for (const author of [page, grace]) {
      await author.getByRole("button", { name: "Review the combined piece" }).click();
      await expect(author.frameLocator('iframe[title="Combined piece preview, not published"]').getByText("EXTRA-PRIVATE-PERSPECTIVE")).toBeVisible();
      await author.getByRole("checkbox", { name: /I approve publishing exactly the piece I reviewed/ }).check();
      await author.getByRole("button", { name: "Approve this piece" }).click();
      await expect(author.getByText("Your approval was recorded.", { exact: false })).toBeVisible();
    }
    await page.locator("summary", { hasText: "Publish shared reflection" }).click();
    await page.getByLabel("I intend to publish the current approved piece publicly.").check();
    await page.getByRole("button", { name: "Publish approved piece" }).click();
    await expect(page.getByText("The approved piece was published.")).toBeVisible();
    const feed = JSON.parse(readFileSync(join(root, "dist", "feed.json"), "utf8"));
    const item = feed.items.find((entry) => entry.content_html?.includes("EXTRA-PRIVATE-PERSPECTIVE"));
    expect(item).toBeTruthy();
    const slug = new URL(item.url).pathname.split("/").filter(Boolean).at(-1);
    const markdown = execFileSync(binary, ["export", slug, "--format", "markdown", "--root", root], { encoding: "utf8" });
    for (const output of [item.content_html, item.content_text, markdown]) {
      const positions = ["MIKEY-SECRET", "EXTRA-PRIVATE-PERSPECTIVE", "GRACE-SECRET"].map((text) => output.indexOf(text));
      expect(positions[0]).toBeGreaterThanOrEqual(0);
      expect(positions[1]).toBeGreaterThan(positions[0]);
      expect(positions[2]).toBeGreaterThan(positions[1]);
    }
  } finally {
    await otherContext.close();
  }
});

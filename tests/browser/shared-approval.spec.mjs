import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
let root;
let server;
let origin;

test.setTimeout(180000);
test.use({ actionTimeout: 10000, navigationTimeout: 15000 });

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(360000);
  root = mkdtempSync(join(tmpdir(), "openblog-approval-browser-"));
  execFileSync("cargo", ["build", "--locked", "-p", "openblog-cli"], { cwd: repository, stdio: "pipe", timeout: 180000 });
  execFileSync("cargo", ["test", "--locked", "-p", "openblog-cli", "generate_approval_browser_fixture", "--", "--ignored"], {
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

async function openDraft(page, username, password) {
  await page.goto(`${origin}/admin/`);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto(`${origin}/admin/#/shared`);
  await page.locator("summary", { hasText: "Your draft" }).click();
  await expect(page.getByLabel("Your reflection (Markdown)")).toBeVisible();
}

test("authors review, refuse a stale approval, approve and withdraw against the real API", async ({ browser, page }) => {
  const graceContext = await browser.newContext();
  const grace = await graceContext.newPage();
  try {
    await page.setViewportSize({ width: 400, height: 800 });
    await openDraft(page, "mikey", "correct horse battery");
    await openDraft(grace, "grace", "another correct horse");
    await page.getByRole("button", { name: "Review the combined piece" }).click();
    const consent = page.getByRole("checkbox", { name: /I approve publishing exactly the piece I reviewed/ });
    await expect(consent).toBeVisible();

    await grace.getByLabel("Your reflection (Markdown)").fill("GRACE-UPDATED");
    await grace.getByRole("button", { name: "Save draft" }).click();
    await expect(grace.getByText("Saved as revision 2.", { exact: false }).first()).toBeVisible();
    await expect(grace.getByText("You have offered revision 1, not your latest revision 2.", { exact: false })).toBeVisible();
    await grace.getByRole("button", { name: "Take back my offer" }).click();
    await grace.getByRole("button", { name: "Offer revision 2 to the group" }).click();
    await grace.getByRole("button", { name: "Share revision 2" }).click();
    await consent.check();
    await page.getByRole("button", { name: "Approve this piece" }).click();
    await expect(page.getByText(/piece changed after you read it/i)).toBeVisible();
    await page.getByRole("button", { name: "Review the combined piece" }).click();
    await expect(page.frameLocator('iframe[title="Combined piece preview, not published"]').getByText("GRACE-UPDATED")).toBeVisible();
    await consent.check();
    await page.getByRole("button", { name: "Approve this piece" }).click();
    await expect(page.getByText("Your approval was recorded.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Review the combined piece" }).click();
    await expect(page.getByRole("list", { name: "Authors in the combined piece" })).toContainText(/Mikey.*approved/i);
    await page.getByRole("button", { name: "Withdraw my approval" }).click();
    await expect(page.getByText("Your approval was withdrawn.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Review the combined piece" }).click();
    await expect(page.getByRole("list", { name: "Authors in the combined piece" })).toContainText(/Mikey.*awaiting/i);
  } finally {
    await graceContext.close();
  }
});

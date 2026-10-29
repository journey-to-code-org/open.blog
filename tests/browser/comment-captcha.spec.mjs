import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
import { removeTree } from "./teardown.mjs";

let root, server, origin;
const endpoint = "https://captcha.example/api";
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-captcha-"));
  writeFileSync(join(root, "openblog.json"), JSON.stringify({ title: "Captcha", url: "https://blog.example", postPath: "/{slug}/", engagement: { enabled: true, endpoint, captcha: { enabled: true, siteKey: "public-test-key" } } }));
  mkdirSync(join(root, "content/posts"), { recursive: true });
  writeFileSync(join(root, "content/posts/post.md"), "---\ntitle: Post\ndate: 2026-10-20\n---\nA post.");
  execFileSync(join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog"), ["build", "--root", root], { stdio: "pipe" });
  server = createServer((req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = join(root, "dist", path.endsWith("/") ? `${path}index.html` : path);
      res.setHeader("Content-Type", extname(file) === ".js" ? "text/javascript" : extname(file) === ".css" ? "text/css" : "text/html");
      res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise((done) => server?.close(done));
  removeTree(root);
});

async function routes(page, { blocked = false, reject = false } = {}) {
  const state = { loads: 0, submissions: [], blocked, reject };
  await page.route("https://challenges.cloudflare.com/**", (route) => {
    state.loads++;
    if (state.blocked) return route.abort();
    return route.fulfill({ contentType: "text/javascript", body: `window.turnstile={render(container, options){ window.challengeOptions=options; const button=document.createElement('button'); button.type='button'; button.textContent='Verify human'; button.onclick=()=>options.callback('challenge-token'); container.replaceChildren(button); return 'widget'; },remove(){ document.querySelector('[aria-label="Comment verification"]').replaceChildren(); }};` });
  });
  await page.route(`${endpoint}/comments**`, (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { comments: [] } });
    state.submissions.push(route.request().postDataJSON());
    if (state.reject) { state.reject = false; return route.fulfill({ status: 403, json: { code: "captcha_required", error: "Verify again. Your text is kept." } }); }
    return route.fulfill({ status: 202, json: { status: "pending", captchaSession: { pass: "signed-test-pass", expiresAt: Date.now() / 1000 + 1800 } } });
  });
  return state;
}

test("lazy challenge, keyboard completion, pass reuse across navigation and expiry", async ({ page }) => {
  const state = await routes(page);
  await page.goto(`${origin}/post/`);
  await expect(page.locator(".ob-comments-status")).toHaveText("No approved comments yet.");
  expect(state.loads).toBe(0);
  await page.getByLabel("Name", { exact: true }).fill("Reader");
  await page.getByLabel("Comment", { exact: true }).fill("First draft");
  await page.getByRole("button", { name: "Verify human", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ob-comments-status")).toContainText("Verification complete");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".ob-comments-status")).toContainText("submitted for moderation");
  expect(state.submissions[0].captchaToken).toBe("challenge-token");
  await page.reload();
  await page.getByLabel("Name", { exact: true }).fill("Reader");
  await page.getByLabel("Comment", { exact: true }).fill("Second draft");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".ob-comments-status")).toContainText("submitted for moderation");
  expect(state.loads).toBe(1);
  expect(state.submissions[1].captchaPass).toBe("signed-test-pass");
  state.reject = true;
  await page.getByLabel("Name", { exact: true }).fill("Reader");
  await page.getByLabel("Comment", { exact: true }).fill("A rejected pass keeps this draft");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("A rejected pass keeps this draft");
  await page.getByRole("button", { name: "Verify human", exact: true }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".ob-comments-status")).toContainText("submitted for moderation");

  await page.evaluate(() => { for (const key of Object.keys(sessionStorage)) { const value = JSON.parse(sessionStorage[key]); value.expiresAt = 0; sessionStorage[key] = JSON.stringify(value); } });
  await page.reload();
  await page.getByLabel("Comment", { exact: true }).focus();
  await expect(page.getByRole("button", { name: "Verify human", exact: true })).toBeVisible();
});

test("blocked provider retries and rejected passes keep typed text", async ({ page }) => {
  const state = await routes(page, { blocked: true });
  await page.goto(`${origin}/post/`);
  await page.getByLabel("Name", { exact: true }).fill("Reader");
  await page.getByLabel("Comment", { exact: true }).fill("Keep these words");
  await expect(page.getByRole("button", { name: "Retry verification" })).toBeVisible();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("Keep these words");
  state.blocked = false;
  await page.getByRole("button", { name: "Retry verification" }).click();
  await page.getByRole("button", { name: "Verify human", exact: true }).click();
  state.reject = true;
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("Keep these words");
  await page.getByRole("button", { name: "Verify human", exact: true }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".ob-comments-status")).toContainText("submitted for moderation");
});

test("no JavaScript keeps the existing fallback", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${origin}/post/`);
  await expect(page.locator("ob-comments")).toContainText("Comments require JavaScript.");
  await context.close();
});

test("storage denial retains the pass in memory and challenge expiry retains the draft", async ({ page }) => {
  const state = await routes(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage blocked"); } });
  });
  await page.goto(`${origin}/post/`);
  await page.getByLabel("Name", { exact: true }).fill("Reader");
  await page.getByLabel("Comment", { exact: true }).fill("Keep my draft");
  await page.getByRole("button", { name: "Verify human", exact: true }).click();
  await page.evaluate(() => window.challengeOptions["expired-callback"]());
  await expect(page.getByRole("button", { name: "Retry verification" })).toBeVisible();
  await expect(page.getByLabel("Comment", { exact: true })).toHaveValue("Keep my draft");
  await page.getByRole("button", { name: "Retry verification" }).click();
  await page.getByRole("button", { name: "Verify human", exact: true }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".ob-comments-status")).toContainText("submitted for moderation");
  await page.getByLabel("Name", { exact: true }).fill("Reader");
  await page.getByLabel("Comment", { exact: true }).fill("Another comment");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".ob-comments-status")).toContainText("submitted for moderation");
  expect(state.submissions[1].captchaPass).toBe("signed-test-pass");
});

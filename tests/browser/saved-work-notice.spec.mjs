import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// What the owner is told on a host that resets its files (ADR 0353). The push goes to a real local
// repository whose hook answers the way a host answers a push with no credential. Every server starts as
// render.yaml leaves it when nobody fills in the prompts: blank settings, which must not stop startup.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const NOTICE = "[data-files-may-vanish]";
const LINE = "[data-files-may-vanish-line]";
let parent;
const servers = [];

test.use({ viewport: { width: 375, height: 800 } });

const blanks = { OPENBLOG_GIT_TOKEN: "", OPENBLOG_WORKSPACE_SUPABASE_URL: "", OPENBLOG_WORKSPACE_SECRET_KEY: "", OPENBLOG_WORKSPACE_NAMESPACE: "" };

/** A site in Git with one post waiting to publish, and a remote that refuses the push. */
async function startSite(folder, hostSettings) {
  const siteRoot = join(parent, folder);
  execFileSync(binary, ["init", siteRoot, "--no-voice"], { stdio: "pipe" });
  execFileSync(binary, ["user", "add", "writer", "--root", siteRoot], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const remote = join(parent, `${folder}-remote.git`);
  mkdirSync(remote);
  execFileSync("git", ["init", "--bare", "-q"], { cwd: remote, stdio: "pipe" });
  mkdirSync(join(remote, "hooks"), { recursive: true });
  const hook = join(remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho \"fatal: Authentication failed for 'https://github.com/me/blog.git/'\" >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const git = (...args) => execFileSync("git", args, { cwd: siteRoot, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", remote);
  writeFileSync(join(siteRoot, "content", "posts", "soup.md"), "---\ntitle: Soup\ndate: 2026-10-01\n---\nWords.\n");

  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  const env = { ...process.env, ...blanks, ...hostSettings };
  // The machine running these specs must not decide the answer.
  for (const name of ["RENDER", "OPENBLOG_FILES_RESET"]) if (!(name in hostSettings)) delete env[name];
  const server = spawn(binary, ["serve", "--admin", "--root", siteRoot, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
  servers.push(server);
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  const address = `http://127.0.0.1:${port}`;
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${address}/admin/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
  return address;
}

async function signIn(page, origin) {
  await page.goto(`${origin}/admin/`);
  await page.getByLabel("Username", { exact: true }).fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-action="logout"]')).toBeVisible();
}

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

let render;
let local;
let saidToLast;

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-saved-work-"));
  render = await startSite("render", { RENDER: "true" });
  local = await startSite("local", {});
  saidToLast = await startSite("said-to-last", { RENDER: "true", OPENBLOG_FILES_RESET: "0" });
});

test.afterAll(async () => {
  for (const server of servers) {
    if (server.exitCode === null) {
      server.kill();
      await once(server, "exit");
    }
  }
  if (parent) removeTree(parent);
});

test("on Render with nothing set up, Overview says so once and the other pages carry one line", async ({ page }) => {
  await signIn(page, render);
  await page.goto(`${render}/admin/#/overview`);
  const notice = page.locator(NOTICE);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("can vanish");
  await expect(notice).toContainText("whoever set up this site");
  await expect(page.locator(".oba-overview-metrics")).toContainText("Not published");
  await expect(page.locator(".oba-publish .oba-small").first()).toBeVisible();
  await expect(page.locator(LINE)).toHaveCount(0);
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.goto(`${render}/admin/#/posts`);
  const line = page.locator(LINE);
  await expect(line).toBeVisible();
  await expect(page.locator(NOTICE)).toHaveCount(0);
  expect(await noSidewaysScroll(page)).toBe(true);
  await line.click();
  await expect(page.locator(NOTICE)).toBeVisible();
});

test("on Render a saved post says it can vanish, and the Landing page does not say Save keeps it", async ({ page }) => {
  await signIn(page, render);
  await page.goto(`${render}/admin/#/edit/posts/soup.md`);
  await expect(page.locator(LINE)).toBeVisible();
  const title = page.getByLabel("Title", { exact: true });
  await expect(title).toBeVisible();
  await title.fill("Soup again");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("can still vanish if the server restarts")).toBeVisible();

  await page.goto(`${render}/admin/#/landing`);
  const help = page.locator("[data-landing-help]");
  await help.locator("summary").click();
  await expect(help).toContainText("Holds your changes for now");
  await expect(help).not.toContainText("Keeps your changes");
});

test("a Publish with no credential reads in plain words and keeps the detail folded", async ({ page }) => {
  await signIn(page, render);
  await page.goto(`${render}/admin/#/posts`);
  const box = page.locator(".oba-publish");
  await box.getByRole("button", { name: "Publish", exact: true }).click();
  const said = box.getByRole("alert");
  await expect(said).toContainText("does not have permission");
  await expect(said).toContainText("can vanish when it restarts");
  await expect(said).not.toContainText("git push");
  const detail = box.locator("[data-publish-detail]");
  await expect(detail).toBeVisible();
  await expect(detail.locator("pre")).toBeHidden();
  await detail.locator("summary").click();
  await expect(detail.locator("pre")).toContainText("git push failed");
  expect(await noSidewaysScroll(page)).toBe(true);
});

test("the Landing page's Publish says the same when it fails", async ({ page }) => {
  await signIn(page, render);
  await page.goto(`${render}/admin/#/landing`);
  await page.locator('[data-landing-status]').waitFor({ state: "attached" });
  const publish = page.locator('.oba-landing-actions [data-action="publish"]');
  await expect(publish).toBeEnabled();
  await publish.click();
  const said = page.locator("[data-landing-status]");
  await expect(said).toContainText("Publishing did not work.");
  await expect(said).toContainText("does not have permission");
  await expect(said).not.toContainText("git push");
  await expect(page.locator(".oba-landing-actions [data-publish-detail] summary")).toBeVisible();
});

for (const [name, origin] of [["on a local machine", () => local], ["when the setting says the files last", () => saidToLast]]) {
  test(`${name} nothing warns, and Save still says it keeps your changes`, async ({ page }) => {
    await signIn(page, origin());
    await page.goto(`${origin()}/admin/#/overview`);
    await expect(page.locator(".oba-overview-metrics")).toBeVisible();
    await expect(page.locator(".oba-publish button")).toBeVisible();
    await expect(page.locator(NOTICE)).toHaveCount(0);
    await expect(page.locator(LINE)).toHaveCount(0);

    await page.goto(`${origin()}/admin/#/landing`);
    const help = page.locator("[data-landing-help]");
    await help.locator("summary").click();
    await expect(help).toContainText("Keeps your changes");
    await expect(page.locator(LINE)).toHaveCount(0);
  });
}

test("on a local machine a refused Publish says the saved work is still here", async ({ page }) => {
  await signIn(page, local);
  await page.goto(`${local}/admin/#/posts`);
  const box = page.locator(".oba-publish");
  await box.getByRole("button", { name: "Publish", exact: true }).click();
  const said = box.getByRole("alert");
  await expect(said).toContainText("does not have permission");
  await expect(said).toContainText("still here");
  await expect(said).not.toContainText("vanish");
});

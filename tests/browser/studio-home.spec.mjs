import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 5: Home says how the whole site is doing. With nothing waiting, one calm line; with
// a change waiting to go out (a git repository with a remote), it says so and Put them on my site
// pushes it; Rebuild works from the details; axe at 320 px.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;
let remote;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-home-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  remote = mkdtempSync(join(tmpdir(), "openblog-studio-home-remote-"));
  execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "start");
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "main");
  git("config", "user.name", "Grammi");
  git("config", "user.email", "grammi@example.com");
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
  removeTree(remote);
});

async function signIn(page) {
  await page.goto(`${origin}/admin/studio/#/`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

test("Home says all is well, then that a change is waiting, and sends it out", async ({ page }) => {
  await signIn(page);
  const health = page.locator(".studio-health");
  await expect(health.getByText("Everything you've saved is on your site.")).toBeVisible();
  writeFileSync(join(root, "content", "posts", "a-new-note.md"), "---\ntitle: A new note\ndate: 2026-01-02\n---\n\nHello.\n");
  await page.reload();
  await expect(health.getByText("1 change is saved here but isn't on your public site yet.")).toBeVisible();
  await health.getByRole("button", { name: "Put them on my site" }).click();
  await expect(page.getByText("Done. Your readers will see the changes in a few minutes.")).toBeVisible();
  await expect(health.getByText("Everything you've saved is on your site.")).toBeVisible();
  expect(execFileSync("git", ["--git-dir", remote, "log", "--oneline", "-1", "main"]).toString()).toMatch(/Send out what's waiting/);
});

test("Rebuild is in the details, and Home passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page);
  const health = page.locator(".studio-health");
  await health.getByText("For the person who set up your site").click();
  await expect(health.getByText("main → ")).toBeVisible();
  await health.getByRole("button", { name: "Rebuild the site now" }).click();
  await expect(page.getByText("Your site is up to date.")).toBeVisible();
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("an old Admin address opens its Studio screen, and one not in Studio yet says so", async ({ page }) => {
  await signIn(page);
  await page.goto(`${origin}/admin/studio/#/greetings`);
  await expect(page).toHaveURL(/#\/cards$/);
  await page.goto(`${origin}/admin/studio/#/research`);
  await expect(page).toHaveURL(/#\/not-yet\/research$/);
  await expect(page.getByRole("heading", { name: "Research isn't in Studio yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Research in the old Admin" })).toHaveAttribute("href", "/admin/#/research");
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio, the new Admin at /admin/studio/ (docs/specs/studio/brief.md, slice 1 finish line):
// sign in, write and publish from a phone, find with the keyboard, keep her words through a
// conflict, and pass axe and a 320 px width on every screen.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
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

async function signIn(page, hash = "") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

async function axeViolations(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] }));
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const posts = () => readdirSync(join(root, "content", "posts"));

test("a wrong password says so and keeps her on the sign-in page", async ({ page }) => {
  await page.goto(`${origin}/admin/studio/`);
  await page.getByRole("textbox", { name: "Your name", exact: true }).fill("writer");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("not-it");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Not signed in")).toBeVisible();
});

test("Grammi writes and publishes Pumpkin bread on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 860 });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await page.getByRole("link", { name: "Write something new" }).first().click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Pumpkin bread");
  await page.getByRole("textbox", { name: "Words", exact: true }).fill("Two loaves, one for the neighbors.\n\nBake for 60 minutes.");
  await expect(page.getByText(/Draft · saved/)).toBeVisible({ timeout: 10000 });
  const file = posts().find((name) => name.endsWith("pumpkin-bread.md"));
  expect(file).toBeTruthy();
  expect(readFileSync(join(root, "content", "posts", file), "utf8")).toContain("Two loaves");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/Published\b/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeHidden();
  await page.goto(`${origin}/admin/studio/#/posts`);
  const row = page.getByRole("listitem").filter({ hasText: "Pumpkin bread" });
  await expect(row.getByText("Published")).toBeVisible();
});

test("Mikey finds a post with the keyboard", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await page.keyboard.press("Control+k");
  const search = page.getByPlaceholder("Find a post or something to do…");
  await expect(search).toBeFocused();
  await search.fill("Pumpkin");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/write\/.*pumpkin-bread/);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Pumpkin bread");
});

test("a change made elsewhere never loses her words", async ({ page }) => {
  await signIn(page, "#/posts");
  await page.getByRole("link", { name: /Pumpkin bread/ }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Pumpkin bread");
  const file = join(root, "content", "posts", posts().find((name) => name.endsWith("pumpkin-bread.md")));
  writeFileSync(file, readFileSync(file, "utf8").replace("Two loaves", "Three loaves"));
  await page.getByRole("textbox", { name: "Words", exact: true }).fill("My own words.");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByText("Changed somewhere else")).toBeVisible();
  await page.getByRole("button", { name: "Show the other version" }).click();
  await expect(page.getByRole("textbox", { name: "Words", exact: true })).toHaveValue(/Three loaves/);
  await expect(page.getByText("My own words.")).toBeVisible();
  expect(existsSync(file)).toBe(true);
});

for (const [name, hash] of [["Home", ""], ["Posts", "#/posts"], ["Write", "#/write"]]) {
  test(`${name} passes axe and fits 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await signIn(page, hash);
    await page.waitForTimeout(800);
    expect(await axeViolations(page)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import axe from "axe-core";
import { removeTree } from "./teardown.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
let parent;
let root;
let server;
let origin;

test.use({ viewport: { width: 400, height: 800 } });

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), "openblog-diagram-editor-"));
  root = join(parent, "site");
  execFileSync(binary, ["init", root, "--no-voice"], { stdio: "pipe" });
  execFileSync(binary, ["user", "add", "writer", "--root", root], {
    env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe",
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
  removeTree(parent);
});

test("diagram templates preview, validate and insert at 400px", async ({ page }) => {
  const wasmRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("diagram-wasm/")) wasmRequests.push(request.url());
  });
  await page.goto(`${origin}/admin/`);
  await page.getByLabel("Username", { exact: true }).fill("writer");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.goto(`${origin}/admin/#/new/posts`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Diagram example");
  expect(wasmRequests).toHaveLength(0);
  if (process.env.OPENBLOG_DIAGRAM_TEST_MODE === "disabled") {
    await expect(page.getByRole("button", { name: "Add diagram" })).toHaveCount(0);
    return;
  }
  await page.getByRole("button", { name: "Add diagram" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a diagram" });
  const noticeLink = dialog.getByRole("link", { name: "Diagram renderer licenses and source" });
  const notices = await page.request.get(new URL(await noticeLink.getAttribute("href"), origin).href);
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain("Mozilla Public License");
  await expect(dialog.getByRole("img", { name: "Diagram preview" })).toBeVisible({ timeout: 30000 });
  await expect.poll(() => dialog.getByRole("img", { name: "Diagram preview" }).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.getByLabel("Example").locator("option")).toHaveCount(5);
  await expect(dialog.getByRole("button", { name: "Insert diagram" })).toBeEnabled();
  await page.evaluate(axe.source);
  const accessibility = await page.evaluate(async () => window.axe.run(document.querySelector(".oba-diagram-dialog"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect(accessibility.violations).toEqual([]);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  await dialog.getByLabel("Mermaid source").fill("flowchart LR\nA --> B");
  await expect(dialog.getByRole("status")).toContainText("accTitle", { timeout: 30000 });
  await expect(dialog.getByRole("button", { name: "Insert diagram" })).toBeDisabled();
  await dialog.getByLabel("Mermaid source").fill("flowchart LR\naccTitle: Broken\naccDescr: Broken\nA[Unclosed label --> B");
  await expect(dialog.getByRole("status")).toContainText(/line [2-9][0-9]*, column [1-9][0-9]*/, { timeout: 30000 });
  await expect(dialog.getByRole("button", { name: "Insert diagram" })).toBeDisabled();
  await dialog.getByLabel("Example").selectOption("request-flow");
  await expect(dialog.getByRole("img", { name: "Diagram preview" })).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("button", { name: "Insert diagram" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => readdirSync(join(root, "content", "posts")).filter((name) => name.includes("diagram-example")).length).toBe(1);
  const file = readdirSync(join(root, "content", "posts")).find((name) => name.includes("diagram-example"));
  const saved = readFileSync(join(root, "content", "posts", file), "utf8");
  expect(saved).toContain("```mermaid");
  expect(saved).toContain("accDescr: A client asks a server for a response.");
  expect(wasmRequests.length).toBeGreaterThan(0);
});

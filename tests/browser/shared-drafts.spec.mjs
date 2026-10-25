import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// The real Admin Studio page and sign-in, with the collaboration API replaced by a small in-memory
// stand-in that checks the expected revision the way the server does. This exercises the writer's
// draft panel in a browser: keyboard use, a phone viewport, going offline, two tabs, large text.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const PUBLICATION = "shared-0a1b2c3d4e5f";
const LIMIT = 100000;
let root;
let server;
let origin;
let store;
let offline;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-drafts-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
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
  if (root) rmSync(root, { recursive: true, force: true });
});

const stamp = (number) => ({ number, contributionId: "participant-1", digest: "d" });
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function install(context) {
  store = { number: 0, markdown: "" };
  offline = false;
  await context.route("**/admin/api/collaboration/**", async (route) => {
    const method = route.request().method();
    if (offline && method !== "GET") return route.abort("internetdisconnected");
    const path = new URL(route.request().url()).pathname.replace("/admin/api/collaboration/", "");
    if (path === "publications") {
      return json(route, 200, { publications: [{ publicationId: PUBLICATION, roles: ["contributor"], title: "A shared reflection", guidingQuestion: "What stayed with you?", sources: [] }] });
    }
    if (path === "draft" && method === "GET") return json(route, 200, { draft: store.number ? { stamp: stamp(store.number), markdown: store.markdown } : null });
    if (path === "draft" && method === "PUT") {
      const body = route.request().postDataJSON();
      if (body.markdown.length > LIMIT) return json(route, 413, { error: "That draft is too large." });
      if (body.expectedRevision !== store.number) {
        return json(route, 409, { error: "Your draft changed since you last read it.", current: { stamp: stamp(store.number), markdown: store.markdown } });
      }
      store = { number: store.number + 1, markdown: body.markdown };
      return json(route, 200, { stamp: stamp(store.number) });
    }
    if (path === "reveal") return json(route, 200, { policy: "voluntary", ready: false, canSetPolicy: false, slots: [] });
    return json(route, 404, { error: "not found" });
  });
}

async function openPanel(page) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.goto(`${origin}/admin/#/shared`);
  await page.locator("summary", { hasText: "Your draft" }).click();
  await expect(editor(page)).toBeVisible();
}

const editor = (page) => page.getByLabel("Your reflection (Markdown)");
const saveDraft = (page) => page.getByRole("button", { name: "Save draft" });

test("the draft can be written and saved with the keyboard alone", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  await editor(page).focus();
  await page.keyboard.type("Typed without a mouse.");
  await saveDraft(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved as revision 1/).first()).toBeVisible();
  expect(store.markdown).toBe("Typed without a mouse.");
});

test("on a phone-sized screen the draft panel does not scroll sideways", async ({ page, context }) => {
  await install(context);
  await page.setViewportSize({ width: 320, height: 700 });
  await openPanel(page);
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".oba-draft, .oba-draft *")].filter((node) => node.getBoundingClientRect().right > limit + 1).map((node) => node.className || node.tagName);
  });
  expect(wide).toEqual([]);
  await expect(editor(page)).toBeVisible();
});

test("going offline keeps the text and says so, and saving works again afterwards", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  await editor(page).fill("Written on a train.");
  offline = true;
  await saveDraft(page).click();
  await expect(page.getByRole("alert").first()).toContainText(/offline|could not reach/i);
  await expect(editor(page)).toHaveValue("Written on a train.");
  expect(store.number).toBe(0);
  offline = false;
  await saveDraft(page).click();
  await expect(page.getByText(/Saved as revision 1/).first()).toBeVisible();
});

test("a second tab saving first leads to a recovery choice and nothing is overwritten", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  const other = await context.newPage();
  await openPanel(other);
  await editor(other).fill("From the other tab.");
  await saveDraft(other).click();
  await expect(other.getByText(/Saved as revision 1/).first()).toBeVisible();
  await editor(page).fill("From the first tab.");
  await saveDraft(page).click();
  await expect(page.getByRole("heading", { name: "Your draft changed elsewhere" })).toBeFocused();
  expect(store.markdown).toBe("From the other tab.");
  await expect(editor(page)).toHaveValue("From the first tab.");
  await page.getByRole("button", { name: "Save my text as a new revision" }).click();
  await expect(page.getByText(/Saved as revision 2/).first()).toBeVisible();
  expect(store.markdown).toBe("From the first tab.");
});

test("a large draft saves, and one that is too large is refused without losing the text", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  const large = "word ".repeat(15000);
  await editor(page).fill(large);
  await saveDraft(page).click();
  await expect(page.getByText(/Saved as revision 1/).first()).toBeVisible();
  expect(store.markdown.length).toBe(large.length);
  const tooLarge = "word ".repeat(30000);
  await editor(page).fill(tooLarge);
  await saveDraft(page).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(editor(page)).toHaveValue(tooLarge);
  expect(store.number).toBe(1);
});

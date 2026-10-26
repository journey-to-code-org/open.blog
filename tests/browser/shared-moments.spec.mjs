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
// stand-in that checks the expected revision and the time format the way the server does. This
// exercises the media moments panel in a browser: keyboard use at phone width, malformed times,
// several media, a source with no link, and a save that lost a race.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const PUBLICATION = "shared-0a1b2c3d4e5f";
const SOURCES = [
  { id: "source-1", kind: "video", kindLabel: "Video", title: "A talk on video", url: "https://www.youtube.com/watch?v=abcdefghijk" },
  { id: "source-2", kind: "book", kindLabel: "Book", title: "A book without a link", url: null },
  { id: "source-3", kind: "podcast", kindLabel: "Podcast", title: "A podcast", url: "https://podcasts.example/12" },
];
const TIME = /^(\d+(?::[0-5]\d){0,2})(?:\.\d+)?$/;
let root;
let server;
let origin;
let moments;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-moments-"));
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

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function seconds(value) {
  return value.split(".")[0].split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function stored(id, moment) {
  const first = moment.locators[0];
  const location = first.kind === "timestamp" ? (first.to ? `from ${first.value} to ${first.to}` : `at ${first.value}`) : `${first.kind} ${first.value}`;
  const source = SOURCES.find((entry) => entry.id === moment.source);
  const time = moment.locators.find((locator) => locator.kind === "timestamp");
  const link = !source?.url ? null : source.id === "source-1" && time ? { href: `${source.url}&t=${seconds(time.value)}s`, atTime: true } : { href: source.url, atTime: false };
  return { id, quotation: null, observation: null, ...moment, location, link };
}

async function install(context) {
  moments = { revision: 0, next: 0, moments: [], shared: [], sources: SOURCES, you: "p-me" };
  await context.route("**/admin/api/collaboration/**", async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname.replace("/admin/api/collaboration/", "");
    if (path === "publications") {
      return json(route, 200, { publications: [{ publicationId: PUBLICATION, roles: ["contributor"], title: "A shared reflection", guidingQuestion: "What stayed with you?", sources: [] }] });
    }
    if (path === "draft" && method === "GET") return json(route, 200, { draft: null });
    if (path === "reveal") return json(route, 200, { policy: "voluntary", ready: false, canSetPolicy: false, slots: [] });
    if (path === "moments" && method === "GET") return json(route, 200, moments);
    if (path === "moments" && method === "POST") {
      const body = route.request().postDataJSON();
      if (body.expectedRevision !== moments.revision) return json(route, 409, { error: "The moments changed since you read them. Reload to see the current moments; what you typed is still here and nothing was changed." });
      const change = body.change;
      if (change.moment && change.moment.locators.some((locator) => locator.kind === "timestamp" && !TIME.test(locator.value))) {
        return json(route, 422, { error: "Give a location: a timestamp as seconds or h:mm:ss.", field: "locators" });
      }
      let list = moments.moments.slice();
      let next = moments.next;
      if (change.action === "add") list.push(stored(`moment-${(next += 1)}`, change.moment));
      if (change.action === "edit") list = list.map((moment) => (moment.id === change.id ? stored(change.id, change.moment) : moment));
      if (change.action === "remove") list = list.filter((moment) => moment.id !== change.id);
      moments = { ...moments, revision: moments.revision + 1, next, moments: list };
      return json(route, 200, moments);
    }
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
  await expect(page.getByRole("heading", { name: "Moments in the sources" })).toBeVisible();
}

const panel = (page) => page.locator(".oba-moments");

test("a moment is captured with the keyboard alone at phone width, and a malformed time is caught first", async ({ page, context }) => {
  await install(context);
  await page.setViewportSize({ width: 320, height: 700 });
  await openPanel(page);
  await panel(page).getByLabel("Source", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(panel(page).getByLabel("Source", { exact: true })).toHaveValue("source-1");
  await panel(page).getByLabel("Location", { exact: true }).focus();
  await page.keyboard.type("1:60");
  await panel(page).getByLabel("Your observation (Markdown, optional)").focus();
  await page.keyboard.type("The pause before the answer.");
  await panel(page).getByRole("button", { name: "Add moment" }).focus();
  await page.keyboard.press("Enter");
  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("seconds or h:mm:ss");
  await expect(alert).toBeFocused();
  await expect(panel(page).getByLabel("Location", { exact: true })).toHaveAttribute("aria-invalid", "true");
  expect(moments.moments).toEqual([]);
  await panel(page).getByLabel("Location", { exact: true }).fill("1:02");
  await panel(page).getByRole("button", { name: "Add moment" }).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByText(/Moment 1 of 1\./)).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Edit moment 1 of 1" })).toBeFocused();
  await expect(panel(page).getByLabel("Your observation (Markdown, optional)")).toHaveValue("");
  expect(moments.moments[0].observation).toBe("The pause before the answer.");
  await expect(panel(page).getByRole("link", { name: /Open the source at 1:02/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=62s");
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".oba-moments, .oba-moments *")].filter((node) => node.getBoundingClientRect().right > limit + 1).map((node) => node.className || node.tagName);
  });
  expect(wide).toEqual([]);
});

test("several media list in source order, and a source with no link keeps the location as text", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  const add = async (source, kind, value, words) => {
    await panel(page).getByLabel("Source", { exact: true }).selectOption(source);
    await panel(page).getByLabel("Kind of location").selectOption(kind);
    await panel(page).getByLabel("Location", { exact: true }).fill(value);
    await panel(page).getByLabel("Your observation (Markdown, optional)").fill(words);
    await panel(page).getByRole("button", { name: "Add moment" }).click();
    await expect(panel(page).getByRole("status")).toContainText("Moment added");
  };
  await add("source-3", "timestamp", "5:00", "On the podcast.");
  await add("source-2", "page", "12", "In the book.");
  await add("source-1", "timestamp", "0:30", "On the video.");
  const items = panel(page).locator(".oba-moments-list > li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("A talk on video");
  await expect(items.nth(1)).toContainText("This source has no link. The location is kept with the moment.");
  await expect(items.nth(2).getByRole("link", { name: /find the location yourself/ })).toHaveAttribute("href", "https://podcasts.example/12");
});

test("a save that lost a race keeps everything typed and stores it on retry", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  moments = { ...moments, revision: 3, next: 1, moments: [stored("moment-1", { source: "source-3", locators: [{ kind: "timestamp", value: "9" }], observation: "Made in another tab.", intent: "private" })] };
  await panel(page).getByLabel("Source", { exact: true }).selectOption("source-1");
  await panel(page).getByLabel("Location", { exact: true }).fill("2:00");
  await panel(page).getByLabel("Quoted words").fill("Words I typed carefully.");
  await panel(page).getByLabel("Rights").selectOption("briefQuotation");
  await panel(page).getByLabel("Where the words came from").selectOption("transcribed");
  await panel(page).getByRole("button", { name: "Add moment" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("changed since you read them");
  await expect(panel(page).getByText("Made in another tab.")).toBeVisible();
  await expect(panel(page).getByLabel("Quoted words")).toHaveValue("Words I typed carefully.");
  await expect(panel(page).getByLabel("Location", { exact: true })).toHaveValue("2:00");
  await panel(page).getByRole("button", { name: "Add moment" }).click();
  await expect(panel(page).locator(".oba-moments-list > li")).toHaveCount(2);
  expect(moments.moments[1].quotation).toEqual({ text: "Words I typed carefully.", rights: "briefQuotation", provenance: "transcribed" });
});

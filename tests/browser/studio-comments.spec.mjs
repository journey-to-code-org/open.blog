import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 8: Comments. The hosted inbox is mocked at the Admin API (as moderation-inbox.spec
// does); the settings switch is the real Admin. Comments shows in the navigation only when it's set
// up; a waiting comment is shown with one press; saying no asks why and can be undone; a report is
// kept quietly; a 409 reloads; other kinds link to the full inbox; Home says what's waiting; the
// switch rewrites only engagement; and the screen passes axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const HOSTILE = "<img src=x onerror=alert(1)>";
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-comments-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.engagement = { enabled: true, comments: true, analytics: false, endpoint: "https://comments.example/api" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], {
    cwd: repository, stdio: "pipe",
    env: { ...process.env, OPENBLOG_ENGAGEMENT_API_KEY: "test-key", OPENBLOG_ENGAGEMENT_API_ORIGIN: "https://comments.example" },
  });
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

async function signIn(page, hash = "#/comments") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DECLINE = [{ id: "spam", label: "Spam" }, { id: "abusive", label: "Abusive" }, { id: "other", label: "Other" }];
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function item(n, over = {}) {
  return {
    id: ID(n), source: "comment", kind: "comment", kindLabel: "Comment", status: "pending", statusLabel: "Pending",
    version: 1, revision: 1, reason: null, reasonLabel: null, receivedAt: new Date().toISOString(), moderatedAt: null,
    work: "/pecan-pie/", post: { title: "Pecan pie", url: "/pecan-pie/", source: "posts/pecan-pie.md" },
    role: "site-admin", mode: "open", public: false, body: `Just how Mama made it. ${HOSTILE}`, details: {},
    reader: { name: "Aunt Sue", publishName: true },
    actions: [
      { action: "approve", label: "Approve", reasons: [], guidance: "" },
      { action: "request-clarification", label: "Ask to clarify", reasons: [{ id: "unclear", label: "Unclear" }], guidance: "" },
      { action: "reject", label: "Reject", reasons: DECLINE, guidance: "" },
    ],
    ...over,
  };
}

/** A stand-in hosted inbox: items by state; decisions move them and bump their version. */
async function mockInbox(page, items, { onPatch } = {}) {
  const decisions = [];
  const next = { approve: "approved", reject: "rejected", remove: "removed", reopen: "pending", "uphold-report": "approved" };
  await page.route("**/admin/api/engagement/moderation**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const state = new URL(request.url()).searchParams.get("state") || "pending";
      return json(route, 200, { state, kind: "", protocol: "full", items: items.filter((i) => i.status === state), invalid: 0, next: null });
    }
    const body = request.postDataJSON();
    decisions.push(body);
    const answer = onPatch?.(body);
    if (answer) return json(route, answer.status, answer.body);
    const found = items.find((i) => i.id === body.id);
    if (!found || found.version !== body.version) return json(route, 409, { error: "changed", code: "conflict", item: found });
    found.status = next[body.action];
    found.version += 1;
    found.reason = body.reason || null;
    if (body.action === "reject" || body.action === "remove") found.actions = [{ action: "reopen", label: "Reopen", reasons: [] }];
    if (body.action === "reopen") found.actions = item(0).actions;
    return json(route, 200, { item: { ...found }, published: false, publishError: null });
  });
  return decisions;
}

test("a waiting comment is shown with one press, and the text is never read as markup", async ({ page }) => {
  const items = [item(1), item(2, { reader: { name: "Jimmy", publishName: true }, body: "Needs more butter." })];
  const decisions = await mockInbox(page, items);
  await signIn(page);
  await expect(page.getByRole("link", { name: "Comments" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What have people said?" })).toBeVisible();
  const sue = page.locator(".studio-comment", { hasText: "Aunt Sue" });
  await expect(sue.getByText(HOSTILE, { exact: false })).toBeVisible();
  await expect(sue.getByRole("link", { name: "Pecan pie on your site, opens in a new tab" })).toBeVisible();
  // Clarifying is for scholarly notes; Studio never offers it.
  await expect(page.getByRole("button", { name: /clarify/i })).toHaveCount(0);
  await sue.getByRole("button", { name: "Show it" }).click();
  await expect(page.locator(".studio-comments p[role=status]").filter({ hasText: "Shown under “Pecan pie”" })).toBeVisible();
  await expect(sue).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Jimmy" })).toBeFocused();
  expect(decisions[0]).toEqual({ source: "comment", id: ID(1), action: "approve", from: "pending", version: 1 });
});

test("saying no asks why, and Undo puts it back in Waiting", async ({ page }) => {
  const items = [item(3)];
  const decisions = await mockInbox(page, items);
  await signIn(page);
  const sue = page.locator(".studio-comment", { hasText: "Aunt Sue" });
  await sue.getByRole("button", { name: /Don't show/ }).click();
  await page.getByRole("menuitem", { name: "It's spam" }).click();
  await expect(page.locator(".studio-comments p[role=status]").filter({ hasText: "Not shown. Nobody else sees it." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nothing waiting" })).toBeVisible();
  expect(decisions[0]).toMatchObject({ action: "reject", reason: "spam", version: 1 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-comment", { hasText: "Aunt Sue" })).toBeVisible();
  expect(decisions[1]).toMatchObject({ action: "reopen", from: "rejected", version: 2 });
  // Not shown lists what she turned away, with why.
  await page.goto(`${origin}/admin/studio/#/comments/not-shown`);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
});

test("a report is kept quietly; another kind of note links to the full inbox; a 409 reloads", async ({ page }) => {
  const reported = item(4, {
    source: "report", kind: "abuse-report", kindLabel: "Report", reader: { publishName: false }, body: "Rude.",
    report: { ground: "abusive", groundLabel: "Abusive" },
    target: { source: "comment", id: ID(9), kind: "comment", kindLabel: "Comment", status: "approved", statusLabel: "Approved", authorName: "Jimmy", body: "You call that stuffing?" },
    actions: [
      { action: "uphold-report", label: "Uphold", reasons: [{ id: "abusive", label: "Abusive" }] },
      { action: "reject", label: "Dismiss", reasons: [{ id: "no-action", label: "No action" }] },
    ],
  });
  const scholarly = item(5, { source: "feedback", kind: "correction-suggestion", kindLabel: "Suggested correction" });
  const stale = item(6, { reader: { name: "Ricky", publishName: true } });
  let conflictOnce = true;
  const decisions = await mockInbox(page, [reported, scholarly, stale], {
    onPatch: (body) => {
      if (body.id === ID(6) && conflictOnce) {
        conflictOnce = false;
        stale.version = 7;
        stale.body = "Edited since.";
        return { status: 409, body: { error: "changed", code: "conflict" } };
      }
      return null;
    },
  });
  await signIn(page);
  const card = page.locator(".studio-comment", { hasText: "reported a comment" });
  await expect(card.getByText("Reported", { exact: true })).toBeVisible();
  await expect(card.getByText("You call that stuffing?")).toBeVisible();
  await card.getByRole("button", { name: "Keep the comment" }).click();
  await expect(page.locator(".studio-comments p[role=status]").filter({ hasText: "Kept. The comment stays where it is." })).toBeVisible();
  expect(decisions[0]).toMatchObject({ source: "report", action: "reject", reason: "no-action" });
  await expect(page.getByRole("link", { name: "Open in the full inbox" }).first()).toHaveAttribute("href", "/admin/#/moderation/pending");
  const ricky = page.locator(".studio-comment", { hasText: "Ricky" });
  await ricky.getByRole("button", { name: "Show it" }).click();
  await expect(ricky.getByText("This comment changed somewhere else just now.")).toBeVisible();
  await expect(ricky.getByText("Edited since.")).toBeVisible();
  await ricky.getByRole("button", { name: "Show it" }).click();
  await expect(ricky).toHaveCount(0);
  expect(decisions.at(-1)).toMatchObject({ id: ID(6), version: 7 });
});

test("Home says what's waiting, and the switch rewrites only engagement", async ({ page }) => {
  await mockInbox(page, [item(7), item(8)]);
  await signIn(page, "#/");
  await expect(page.getByRole("link", { name: "2 comments are waiting for you" })).toHaveAttribute("href", "#/comments");
  const before = readFileSync(join(root, "openblog.json"), "utf8");
  await page.goto(`${origin}/admin/studio/#/comments`);
  const toggle = page.getByRole("switch", { name: "Let people leave comments" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page.locator(".studio-comments p[role=status]").filter({ hasText: /^Comments are off\./ })).toBeVisible();
  await expect(page.getByText("Comments are switched off", { exact: true })).toBeVisible();
  const after = JSON.parse(readFileSync(join(root, "openblog.json"), "utf8"));
  expect(after.engagement.comments).toBe(false);
  const was = JSON.parse(before);
  delete was.engagement;
  delete after.engagement;
  expect(after).toEqual(was);
  await toggle.click();
  await expect(page.locator(".studio-comments p[role=status]").filter({ hasText: /^Comments are on\./ })).toBeVisible();
});

test("Comments passes axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockInbox(page, [item(10, { body: "x".repeat(900) })]);
  await signIn(page);
  await expect(page.getByRole("button", { name: "Read all" })).toBeVisible();
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

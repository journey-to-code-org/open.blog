import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// Moderating passage feedback and publishing what was approved (#83, ADR 0095). The hosted queue
// is mocked at the Admin API (the real Admin keeps the hosted token and talks to the hosted
// function itself); responses, revision notes and the canonical page are the real server's.
// Covers keyboard-only moderation, a moved passage that must be confirmed before approval, reasons,
// conflicts, the author's response and revision note, escaping, no JavaScript and 320px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const ENDPOINT = "https://feedback.example/api";
const HOSTILE = "<img src=x onerror=alert(1)>";
const POST = `---
title: Tides
date: 2026-10-20
---
The moon causes the tides. The sun matters too.

## Methods

We measured the tides twice a day. The tides rose.

## Results

The tides rose again.
`;
const QUESTION_ID = "00000000-0000-4000-8000-0000000000a1";
const WHOLE_ID = "00000000-0000-4000-8000-0000000000a2";
const PUBLISHED = {
  version: 1,
  items: [
    {
      id: QUESTION_ID,
      post: "posts/tides.md",
      work: "/tides/",
      kind: "question",
      body: `Why twice? ${HOSTILE}`,
      revision: "p1:00000000000000000000000000000000",
      target: { version: 1, kind: "quote", section: "methods", exact: "twice a day", prefix: "Methods We measured the tides ", suffix: ". The tides rose.", start: 30 },
      received: "2026-10-26",
      approved: "2026-10-27",
      name: "Ada",
    },
    {
      id: WHOLE_ID,
      post: "posts/tides.md",
      work: "/tides/",
      kind: "alternative-interpretation",
      body: "Read the whole post as a field diary.",
      revision: "p1:00000000000000000000000000000000",
      target: { version: 1, kind: "work" },
      received: "2026-10-26",
      approved: "2026-10-27",
    },
  ],
};
let root;
let server;
let origin;

const feedbackFile = () => join(root, "content", "reader-feedback.json");
const postFile = () => join(root, "content", "posts", "tides.md");

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-feedback-moderation-"));
  writeFileSync(join(root, "openblog.json"), JSON.stringify({
    title: "Feedback",
    url: "https://feedback-site.example.org",
    postPath: "/{slug}/",
    author: { name: "A" },
    engagement: { enabled: true, comments: false, analytics: false, feedback: true, endpoint: ENDPOINT },
  }));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(postFile(), POST);
  writeFileSync(feedbackFile(), `${JSON.stringify(PUBLISHED, null, 2)}\n`);
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

async function signIn(page) {
  await page.goto(`${origin}/admin/`);
  const username = page.getByLabel("Username", { exact: true });
  if (await username.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await username.fill("writer");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator('[data-action="logout"]')).toBeVisible();
  }
}

const reasons = [
  { id: "spam", label: "Spam" },
  { id: "off-topic", label: "Off topic" },
  { id: "other", label: "Other" },
];

/** A queue item as the Admin server describes it. */
function queueItem(id, check, extra = {}) {
  const stale = check === "stale";
  return {
    id,
    status: "pending",
    statusLabel: "Pending",
    version: 2,
    moderatedAt: null,
    reason: null,
    reasonLabel: null,
    kind: stale ? "correction-suggestion" : "question",
    kindLabel: stale ? "Suggested correction" : "Question",
    body: stale ? `It was three times a day. ${HOSTILE}` : "Which harbour?",
    details: stale ? { suggestedText: "We measured the tides three times a day." } : {},
    work: "/tides/",
    post: { title: "Tides", source: "posts/tides.md", url: "/tides/" },
    receivedAt: "2026-10-26T10:00:00Z",
    reader: stale ? { name: "Grace Private", publishName: false } : { publishName: false },
    passage: stale
      ? { check: "stale", reason: "quoteNotFound", explanation: "Stale: the post changed after the reader saw it, and the words the reader quoted are no longer in the post. The reader's quotation is shown as they sent it; it will not be quoted on the post.", revisionSeen: "p1:11111111111111111111111111111111", revisionNow: "p1:22222222222222222222222222222222", acknowledge: true, quoted: "four times", sectionSeen: "methods" }
      : { check: "current", explanation: "Current: the reader saw the revision that is published now, and the passage is in “Methods”.", revisionSeen: "p1:22222222222222222222222222222222", revisionNow: "p1:22222222222222222222222222222222", acknowledge: false, sectionNow: "Methods" },
    publicPreview: { work: "/tides/", revision: "p1:11111111111111111111111111111111", received: "2026-10-26", stale },
    actions: [
      { action: "approve", label: "Approve", reasons: [] },
      { action: "reject", label: "Reject", reasons },
    ],
    published: null,
    ...extra,
  };
}

test("pending feedback is moderated from the keyboard, and a moved passage must be confirmed first", async ({ page }) => {
  const STALE = "00000000-0000-4000-8000-0000000000b1";
  const CURRENT = "00000000-0000-4000-8000-0000000000b2";
  let queue = [queueItem(STALE, "stale"), queueItem(CURRENT, "current")];
  const changes = [];
  let answer = null;
  await page.route(`${origin}/admin/api/engagement/feedback?**`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "pending", items: queue, invalid: 1 }) });
  });
  await page.route(`${origin}/admin/api/engagement/feedback`, async (route) => {
    const request = route.request();
    expect(request.method()).toBe("PATCH");
    const body = request.postDataJSON();
    changes.push(body);
    if (answer) {
      await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
      return;
    }
    queue = queue.filter((item) => item.id !== body.id);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: { id: body.id }, published: body.action === "approve", publishError: null }) });
  });
  const dialogs = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await signIn(page);
  await page.goto(`${origin}/admin/#/feedback`);
  await expect(page.getByRole("heading", { name: "Moderation queue", level: 2 })).toBeVisible();
  await expect(page.getByText("2 pending items. 1 item was not valid and is not shown.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Pending", exact: true })).toHaveAttribute("aria-current", "page");

  const stale = page.locator(`[data-feedback-id="${STALE}"]`);
  await expect(stale.getByRole("heading", { name: "Suggested correction on “Tides”", level: 3 })).toBeVisible();
  await expect(stale.locator('.oba-feedback-passage[data-check="stale"]')).toContainText("Stale.");
  await expect(stale.locator(".oba-feedback-passage blockquote")).toHaveText("four times");
  await expect(stale.getByText(`It was three times a day. ${HOSTILE}`)).toBeVisible();
  await expect(stale.getByText("The name stays private", { exact: false })).toBeVisible();
  await expect(stale.getByText("without a quotation, because the passage has changed", { exact: false })).toBeVisible();

  // Approving a moved passage before confirming it is refused with focus on the confirmation.
  await stale.getByRole("button", { name: "Approve", exact: true }).focus();
  await page.keyboard.press("Enter");
  const confirm = stale.getByRole("checkbox", { name: /I have read the passage as it is published now/ });
  await expect(confirm).toBeFocused();
  await expect(stale.getByText("Confirm that you read the passage as it is now before approving.")).toBeVisible();
  expect(changes).toHaveLength(0);
  await page.keyboard.press("Space");
  await expect(confirm).toBeChecked();
  await stale.getByRole("button", { name: "Approve", exact: true }).focus();
  await page.keyboard.press("Enter");
  const status = page.locator(".oba-feedback-section").first().locator('[role="status"]').first();
  await expect(status).toHaveText("Approved and published on “Tides”. Rebuild or publish to update the live site.");
  await expect(status).toBeFocused();
  expect(changes[0]).toEqual({ id: STALE, action: "approve", from: "pending", version: 2, acknowledge: "stale" });

  // A rejection needs a reason, chosen with the keyboard.
  const current = page.locator(`[data-feedback-id="${CURRENT}"]`);
  await expect(current.getByRole("checkbox")).toHaveCount(0);
  await current.getByRole("button", { name: "Reject", exact: true }).focus();
  await page.keyboard.press("Enter");
  const reason = current.getByLabel("Reason to reject");
  await expect(reason).toBeFocused();
  await reason.selectOption("off-topic");
  answer = { status: 409, body: { error: "This item changed since you loaded it. Review it again before acting.", code: "conflict" } };
  await current.getByRole("button", { name: "Reject", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toContainText("This item changed since you loaded it.");
  expect(changes[1]).toEqual({ id: CURRENT, action: "reject", from: "pending", version: 2, reason: "off-topic" });
  answer = null;
  await page.locator(`[data-feedback-id="${CURRENT}"]`).getByLabel("Reason to reject").selectOption("spam");
  await page.locator(`[data-feedback-id="${CURRENT}"]`).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(status).toHaveText("Rejected. Nothing was published.");
  await expect(page.locator("[data-feedback-id]")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("the author's response and revision note are saved to the site's files and shown on the canonical page", async ({ page }) => {
  const dialogs = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await signIn(page);
  await page.goto(`${origin}/admin/#/feedback`);
  // No hosted token is saved, so the queue explains itself; what the site publishes still works.
  await expect(page.getByText("Feedback could not be loaded. Hosted engagement admin credential is not configured")).toBeVisible();
  await expect(page.getByText("2 notes published on your posts.")).toBeVisible();

  const card = page.locator(`#oba-published-${QUESTION_ID}`);
  await expect(card.getByRole("heading", { name: "Question on “Tides”", level: 3 })).toBeVisible();
  await expect(card.getByText("quoting “twice a day”", { exact: false })).toBeVisible();
  const response = card.getByLabel("Your public response");
  await response.focus();
  await page.keyboard.type("We measured twice; see the methods note. <b>bold</b>");
  await card.getByRole("button", { name: "Save response", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(card.getByText("Response saved.", { exact: false })).toBeVisible();
  expect(JSON.parse(readFileSync(feedbackFile(), "utf8")).items.find((item) => item.id === QUESTION_ID).response.text)
    .toBe("We measured twice; see the methods note. <b>bold</b>");

  // A file changed elsewhere since the page loaded is a conflict, and nothing is written.
  const changed = JSON.parse(readFileSync(feedbackFile(), "utf8"));
  changed.items[1].body = "Edited by hand.";
  writeFileSync(feedbackFile(), `${JSON.stringify(changed, null, 2)}\n`);
  const before = readFileSync(feedbackFile(), "utf8");
  await response.fill("A second answer.");
  await card.getByRole("button", { name: "Save response", exact: true }).click();
  await expect(card.getByText("The published feedback changed since you loaded it.", { exact: false })).toBeVisible();
  expect(readFileSync(feedbackFile(), "utf8")).toBe(before);

  await page.reload();
  const fresh = page.locator(`#oba-published-${QUESTION_ID}`);
  await fresh.locator("summary").focus();
  await page.keyboard.press("Enter");
  await fresh.getByLabel("What changed").fill("Clarified how often the tides were measured.");
  await fresh.getByLabel("Date of the change").fill("2026-10-28");
  await fresh.getByRole("button", { name: "Add revision note", exact: true }).click();
  await expect(fresh.getByText("Revision note added", { exact: false })).toBeVisible();
  expect(readFileSync(postFile(), "utf8")).toContain("2026-10-28: Clarified how often the tides were measured.");

  await page.goto(`${origin}/tides/`);
  const notes = page.locator("#ob-reader-feedback");
  await expect(notes.getByRole("heading", { name: "Reader questions and responses", level: 2 })).toBeVisible();
  await expect(notes.getByRole("heading", { name: "Question about Methods", level: 3 })).toBeVisible();
  await expect(notes.locator("blockquote").first()).toHaveText("twice a day");
  await expect(notes.getByText(`Why twice? ${HOSTILE}`)).toBeVisible();
  await expect(notes.getByText("We measured twice; see the methods note. <b>bold</b>")).toBeVisible();
  await expect(notes.locator("img, b")).toHaveCount(0);
  await expect(page.getByText("Clarified how often the tides were measured.")).toBeVisible();
  expect(dialogs).toEqual([]);
});

test("the canonical page lists approved notes without JavaScript and at 320px", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${origin}/tides/`);
  const notes = page.locator("#ob-reader-feedback");
  await expect(notes).toBeVisible();
  await expect(notes).toHaveAttribute("aria-labelledby", "ob-reader-feedback-title");
  await expect(notes.getByRole("heading", { name: "Another interpretation about the whole post", level: 3 })).toBeVisible();
  await expect(notes.getByText("From Ada", { exact: false })).toBeVisible();
  await expect(notes.getByText("From a reader", { exact: false })).toBeVisible();
  await expect(notes.getByRole("link", { name: "Methods" })).toHaveAttribute("href", "#methods");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // The notes come before the form that asks for more.
  const order = await page.evaluate(() => {
    const notes = document.getElementById("ob-reader-feedback");
    const form = document.getElementById("ob-feedback");
    return Boolean(notes.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await context.close();
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Publishing what was approved of passage feedback (#83, ADR 0083): responses, revision notes and
// the canonical page are the real server's. Deciding on feedback is the moderation inbox's
// (moderation-inbox.spec.mjs, ADR 0105). Covers the author's response and revision note, a
// conflicting file, escaping, no JavaScript and 320px.

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

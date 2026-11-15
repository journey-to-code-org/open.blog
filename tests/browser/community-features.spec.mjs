import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Featuring an approved reflection (#229, ADRs 0176 to 0182). The reader's side, in the real site
// with the hosted function mocked at its routes: an unticked feature choice on the form that says
// copies may remain, and a choice on the private receipt for the text the reader sees, saying so
// when an earlier agreement does not cover it. The editor's side, in the real Admin with the
// hosted inbox mocked at the Admin API: a card that offers featuring only on the reader's agreement,
// a preview that is the public form with the fixed notice, a note, taking a feature off, and the
// banner for features that must come off or are hidden. Everything is keyboard operable, and the
// regions are measured at 320px and at 400% zoom.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const ENDPOINT = "https://features.example/api";
const RECEIPT = "F".repeat(43);
const HOSTILE = "<img src=x onerror=alert(1)>";
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST = "---\ntitle: Tides\ndate: 2026-10-20\n---\nThe moon causes the tides.\n\n## Methods\n\nWe measured the tides twice a day.\n";
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-community-features-"));
  writeFileSync(join(root, "openblog.json"), JSON.stringify({
    title: "Features",
    url: "https://features-site.example.org",
    postPath: "/{slug}/",
    author: { name: "A" },
    engagement: { enabled: true, comments: false, analytics: false, feedback: true, receipts: true, endpoint: ENDPOINT },
    participation: { kinds: { "third-perspective": "open" } },
  }));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "content", "posts", "tides.md"), POST);
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

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

// ---- The reader

async function mockFeedback(page) {
  const sent = [];
  await page.route(`${ENDPOINT}/feedback`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    sent.push(route.request().postDataJSON());
    return json(route, 202, { status: "pending", receipt: RECEIPT });
  });
  return sent;
}

const overflowOf = (page, selector) =>
  page.evaluate((selector) => {
    const region = document.querySelector(selector);
    const limit = document.documentElement.clientWidth;
    const elements = [region, ...region.querySelectorAll("*")];
    const offenders = elements.filter((element) => element.getBoundingClientRect().right > limit + 1).map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
    return { overflow: Math.max(region.scrollWidth - region.clientWidth, 0), offenders };
  }, selector);

test("the form's feature choice is unticked, separate, says copies may remain, and is sent only when ticked", async ({ page }) => {
  const sent = await mockFeedback(page);
  await page.goto(`${origin}/tides/`);
  await page.waitForFunction(() => customElements.get("ob-third-perspective") !== undefined);
  const form = page.getByRole("region", { name: "Offer a Third Perspective" });
  const feature = form.getByRole("checkbox", { name: "An editor may feature my reflection in a community section" });
  await expect(feature).not.toBeChecked();
  await expect(feature).toHaveAccessibleDescription(/Separate from publishing it\./);
  await expect(feature).toHaveAccessibleDescription(/copies already published may remain/);
  await expect(feature).toHaveAccessibleDescription(/does not mean anyone agrees with it/);
  await form.getByLabel("Your reflection", { exact: true }).fill("A reading of the tides.");
  await form.getByRole("radio", { name: "Yes, publish it on this page if a moderator approves it" }).check();
  // Keyboard: reach the choice by tabbing and tick it with the space bar.
  await feature.focus();
  await page.keyboard.press("Space");
  await expect(feature).toBeChecked();
  await form.getByRole("button", { name: "Send for review" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ob-third-perspective-status")).toHaveText("Sent for review.");
  expect(sent[0].consent).toEqual({ publish: true, clarification: false, feature: true });
  // The receipt shows what was agreed, as its own choice.
  await expect(page.getByRole("checkbox", { name: "An editor may feature this reflection in a community section" })).toBeChecked();

  // Unticked, nothing is sent as agreed.
  await page.reload();
  await page.waitForFunction(() => customElements.get("ob-third-perspective") !== undefined);
  const again = page.getByRole("region", { name: "Offer a Third Perspective" });
  await again.getByLabel("Your reflection", { exact: true }).fill("Another reading.");
  await again.getByRole("radio", { name: "Yes, publish it on this page if a moderator approves it" }).check();
  await again.getByRole("button", { name: "Send for review" }).click();
  await expect(page.locator(".ob-third-perspective-status")).toHaveText("Sent for review.");
  expect(sent[1].consent.feature).toBe(false);
});

test("a receipt asks again for a changed text, and agreeing or declining is saved by version", async ({ page }) => {
  const reads = [];
  let item = { kind: "third-perspective", status: "approved", version: 4, work: "/tides/", receivedAt: "2026-10-26T10:00:00Z", clarification: null, consent: true, published: true, purged: false, body: "My own reading.", details: {}, feature: { revision: 2, agreed: false, earlier: true } };
  await page.route(`${ENDPOINT}/receipt`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const body = route.request().postDataJSON();
    reads.push(body);
    if (body.action === "feature") {
      if (body.expectedVersion !== item.version) return json(route, 409, { error: "changed", code: "conflict", item });
      item = { ...item, version: item.version + 1, feature: { revision: 2, agreed: body.consent === true, earlier: false } };
    }
    return json(route, 200, { item });
  });
  await page.goto(`${origin}/tides/`);
  const manager = page.locator("#ob-third-perspective .ob-receipt-manage");
  await manager.locator("summary").click();
  await manager.getByLabel("Your receipt").fill(RECEIPT);
  await manager.getByLabel("Your receipt").press("Enter");
  const box = manager.getByRole("checkbox", { name: "An editor may feature this reflection in a community section" });
  await expect(box).not.toBeChecked();
  await expect(box).toHaveAccessibleDescription(/You agreed to feature an earlier text\. That does not cover this one\./);
  await expect(box).toHaveAccessibleDescription(/Copies already published may remain/);
  await box.focus();
  await page.keyboard.press("Space");
  await expect(manager.getByRole("status")).toHaveText("Saved: an editor may feature this text.");
  expect(reads.at(-1)).toEqual({ receipt: RECEIPT, action: "feature", consent: true, revisionSeen: 2, expectedVersion: 4 });
  await expect(manager.getByRole("checkbox", { name: "An editor may feature this reflection in a community section" })).toBeChecked();
  // Declining is immediate and names no revision.
  await manager.getByRole("checkbox", { name: "An editor may feature this reflection in a community section" }).uncheck();
  await expect(manager.getByRole("status")).toHaveText("Saved: it will not be featured.");
  expect(reads.at(-1)).toEqual({ receipt: RECEIPT, action: "feature", consent: false, expectedVersion: 5 });
  // Withdrawing says a feature and a name stay in the site's history.
  await expect(manager.getByLabel(/may remain, and that a feature or a name that was published stays in them/)).toBeVisible();
});

// ---- The editor

const approve = { action: "approve", label: "Approve", reasons: [], guidance: "" };
function reflection(n, extra = {}) {
  return {
    id: ID(n), source: "feedback", kind: "third-perspective", kindLabel: "Third Perspective", status: "approved", statusLabel: "Approved",
    version: 5, revision: 1, reason: null, reasonLabel: null, receivedAt: "2026-10-26T10:00:00Z", moderatedAt: "2026-10-27T09:00:00Z",
    work: "/tides/", post: { title: "Tides", url: "/tides/", source: "posts/tides.md" }, role: "site-admin", mode: "open", public: true,
    clarification: { askedAboutThisText: false, consent: false }, body: `A reading of the tides. ${HOSTILE}`, details: {},
    reader: { publishName: false }, published: true, mayBeShown: true, nameNarrowed: false, featureConsent: "agreed", actions: [], ...extra,
  };
}
const page_ = (items, extra = {}) => ({ state: "approved", kind: "third-perspective", protocol: "full", items, invalid: 0, next: null, ...extra });
// ---- Rollback and a hosted service that cannot be asked

// ---- Mixed prompts

// ---- Reflow


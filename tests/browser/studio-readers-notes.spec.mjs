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


// Studio R10, the card's extras (docs/specs/studio/r10/ux.md "The card" 8, 9, 12, 17, "Shown notes",
// "Record what you decided", "Answer as", "Ideas for later", "Banners", "Undo"): ported from the old
// inbox (moderation-inbox, feedback-moderation, suggestion-inbox, community-features, continuations,
// author-responses specs). The hosted inbox and its routes are stubbed at the Admin API; the real
// server serves Studio. Nothing leaves the computer.
test.use({ serviceWorkers: "block" });

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-readers-notes-"));
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
    env: { ...process.env, OPENBLOG_ENGAGEMENT_API_KEY: "test-key", OPENBLOG_ENGAGEMENT_API_ORIGIN: "https://comments.example", OPENBLOG_STUDIO_ONBOARDING: "off" },
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

async function signIn(page, hash = "#/readers/shown") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const POST = { title: "Pecan pie", url: "/pecan-pie/", source: "posts/pecan-pie.md" };
const base = (n, over) => ({
  id: ID(n), source: "feedback", status: "approved", version: 2, revision: 1, receivedAt: new Date().toISOString(), moderatedAt: new Date().toISOString(),
  work: "/pecan-pie/", post: POST, role: "site-admin", body: "A reader's words.", details: {}, reader: { name: "Ann", publishName: true },
  actions: [{ action: "remove", label: "Remove", reasons: [{ id: "other", label: "Other" }] }], ...over,
});
const question = () => base(1, {
  kind: "question", kindLabel: "Question", body: "Is the crust older than the filling?",
  details: { sourceUrl: "javascript:alert(1)", suggestedText: "Say it was baked twice." },
  evidence: { claim: { id: "c1", label: "C1", statement: "Pecan pie is old", published: true, links: [{ label: "A 1940s cookbook" }] }, source: { id: "s2", published: false } },
  recordDecision: { outcomes: [{ id: "accepted", label: "Accepted", accepted: true }, { id: "accepted-as-evidence", label: "Accepted as evidence", accepted: true }, { id: "declined", label: "Declined" }],
    claimEvidence: [{ claim: "c1", link: "l1", label: "C1: A 1940s cookbook" }], extents: [{ id: "full", label: "All of it" }, { id: "partial", label: "Part of it" }], declineReasons: [{ id: "no", label: "Not convinced" }], revisionNotes: ["Fixed the date."], post: "posts/pecan-pie.md", expectedDecisions: 0, itemRevision: 1 },
});
const reflection = () => base(2, {
  kind: "third-perspective", kindLabel: "Reflection", featureConsent: "agreed", reader: { name: "‮Ruth", publishName: true },
  details: { prompt: "What stayed with you?" }, perspective: { about: "work", consent: { publish: true, showName: true, number: 7 } },
  answerAs: { author: "writer", standing: { state: "current" } },
});
const idea = () => base(3, {
  kind: "future-suggestion", kindLabel: "Idea for later", body: "Write about sorghum syrup.",
  suggestion: { typeLabel: "A topic", url: "https://example.org/sorghum", hints: { title: "Sorghum" }, standing: { label: "Open" }, contact: "ann@example.org", notice: "", export: { label: "Copy" }, link: { kinds: [{ id: "draft", label: "A draft" }], guidance: "" } },
});
const answer = () => base(4, { kind: "author-response", kindLabel: "Author's answer", response: { author: "writer", mine: true, withdrawable: true, standing: { state: "current" } } });
const unpublished = () => base(5, { kind: "correction-suggestion", kindLabel: "Suggested correction", published: false, reader: { name: "Lee", publishName: true } });

/** The stand-in hosted service: what it was asked, by path. */
async function stub(page, items, { published = [{ id: ID(1), response: { text: "Thanks, I checked." } }], audit = {}, features = { features: [] } } = {}) {
  const calls = [];
  const log = (route) => { const r = route.request(); calls.push({ method: r.method(), path: new URL(r.url()).pathname.replace("/admin/api/", ""), body: r.postData() ? r.postDataJSON() : null }); };
  await page.route("**/admin/api/engagement/**", async (route) => {
    log(route);
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/admin/api/", "");
    if (path === "engagement/moderation" && request.method() === "GET") {
      const state = new URL(request.url()).searchParams.get("state") || "pending";
      return json(route, 200, { state, kind: "", protocol: "full", items: items.filter((i) => i.status === state), invalid: 0, next: null });
    }
    if (path === "engagement/feedback/published") return json(route, 200, { etag: "e1", items: published });
    if (path === "engagement/third-perspectives/published") return json(route, 200, audit);
    if (path === "engagement/community/features") return json(route, 200, features);
    if (path === "engagement/continuations" && request.method() === "GET") return json(route, 200, { links: [], works: [{ path: "/later/", title: "A later post" }] });
    if (path === "engagement/feedback/response") return json(route, 200, { etag: `e${calls.length}` });
    if (path === "engagement/continuations/link") return json(route, 200, { link: { id: "l1" } });
    if (path === "engagement/continuations/preview") return json(route, 200, { preview: { from: "Pecan pie", to: "A later post", note: null } });
    if (path === "engagement/community/preview") return json(route, 200, { preview: { response: { body: "A reader's words." }, context: "" }, willPublish: false });
    if (path === "engagement/moderation/decision") return json(route, 200, { decision: { label: "Accepted" }, outcomePublished: false });
    if (path === "engagement/settings" || path === "engagement/health") return route.fallback();
    return json(route, 200, {});
  });
  return calls;
}
const sent = (calls, path) => calls.filter((c) => c.method !== "GET" && c.path === path);
const card = (page, text) => page.locator(".studio-reader", { hasText: text });

test("a shown question: their link is text with Copy (never a link it isn't), their wording, what they point to; your answer under it saves and Undo puts it back", async ({ page }) => {
  const calls = await stub(page, [question()]);
  await signIn(page);
  const q = card(page, "Is the crust older");
  await expect(q.getByText("Their link")).toBeVisible();
  await expect(q.getByText("javascript:alert(1)")).toBeVisible();
  await expect(q.getByRole("link", { name: /Open their link/ })).toHaveCount(0);
  await expect(q.locator("a[href^='javascript']")).toHaveCount(0);
  await expect(q.getByText("Nothing checked this link.")).toBeVisible();
  await expect(q.getByText("Their wording")).toBeVisible();
  await expect(q.getByText("Say it was baked twice.")).toBeVisible();
  await expect(q.getByText("What they point to")).toBeVisible();
  await expect(q.getByText("The claim: C1, “Pecan pie is old”")).toBeVisible();
  await expect(q.getByRole("link", { name: "Open the claim in Claims and evidence" })).toHaveAttribute("href", "#/write/posts%2Fpecan-pie.md?sheet=claims&claim=c1");
  await expect(q.getByText("Something they named isn't on this post any more.")).toBeVisible();
  const field = q.getByRole("textbox", { name: "Your answer under it" });
  await expect(field).toHaveValue("Thanks, I checked.");
  await field.fill("Thanks: I checked the 1940s book.");
  await q.getByRole("button", { name: "Save your answer" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Your answer is saved." })).toBeVisible();
  expect(sent(calls, "engagement/feedback/response")[0].body).toEqual({ id: ID(1), etag: "e1", response: "Thanks: I checked the 1940s book." });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => sent(calls, "engagement/feedback/response").length).toBe(2);
  expect(sent(calls, "engagement/feedback/response")[1].body.response).toBe("Thanks, I checked.");
  await expect(page.locator("main p[role=status]").filter({ hasText: "Your answer is back as it was." })).toBeVisible();
  // An empty answer is refused on the field, and nothing is sent.
  await q.getByRole("textbox", { name: "Your answer under it" }).fill("  ");
  await q.getByRole("button", { name: "Save your answer" }).click();
  await expect(q.getByText("Write your answer first, or use Remove your answer.").first()).toBeVisible();
  expect(sent(calls, "engagement/feedback/response")).toHaveLength(2);
});

test("Note what changed and Record what you decided: each checks first, then sends only what it takes", async ({ page }) => {
  const calls = await stub(page, [question()]);
  await signIn(page);
  const q = card(page, "Is the crust older");
  await q.getByRole("button", { name: "Note what changed" }).click();
  const sheet = page.locator("side-sheet");
  await expect(sheet.getByRole("heading", { name: "Note what changed in your post" })).toBeVisible();
  await sheet.getByRole("button", { name: "Add the note" }).click();
  await expect(sheet.getByText("Say what changed first.").first()).toBeVisible();
  expect(sent(calls, "engagement/feedback/revision-note")).toHaveLength(0);
  await sheet.getByRole("textbox", { name: "What changed" }).fill("The date is 1898, not 1930.");
  await sheet.getByRole("button", { name: "Add the note" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Added to your post's list of changes." })).toBeVisible();
  expect(sent(calls, "engagement/feedback/revision-note")[0].body).toMatchObject({ post: "posts/pecan-pie.md", note: "The date is 1898, not 1930.", claim: "" });

  await q.getByRole("button", { name: "Record what you decided" }).click();
  await expect(sheet.getByRole("heading", { name: "Record what you decided" })).toBeVisible();
  await sheet.getByRole("button", { name: "Record it" }).click();
  await expect(sheet.getByText("Choose what you decided.").first()).toBeVisible();
  await sheet.getByRole("radio", { name: /^Accepted$/ }).click();
  await sheet.getByRole("radio", { name: /All of it/ }).click();
  await sheet.getByRole("button", { name: "Record it" }).click();
  await expect(sheet.getByText(/Choose the note that says what changed/).first()).toBeVisible();
  await sheet.getByRole("combobox", { name: "The note about what changed" }).selectOption("Fixed the date.");
  await expect(sheet.getByText("You're recording: accepted.")).toBeVisible();
  await sheet.getByRole("button", { name: "Record it" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Recorded. Your post and their note didn't change." })).toBeVisible();
  const body = sent(calls, "engagement/moderation/decision")[0].body;
  expect(body).toMatchObject({ id: ID(1), outcome: "accepted", extent: "full", revisionNote: { post: "posts/pecan-pie.md", note: "Fixed the date." } });
  expect(body.declineReason).toBeUndefined();
});

test("a shown reflection: what it's about, the reader's name kept apart; Feature it and Link to a later post, each with Undo", async ({ page }) => {
  const calls = await stub(page, [reflection()]);
  await signIn(page);
  const r = card(page, "What stayed with you");
  await expect(r.getByText("About this reflection")).toBeVisible();
  await expect(r.getByText("About the whole post.")).toBeVisible();
  await expect(r.getByText("They agree to it being shown with their name.")).toBeVisible();
  await r.getByRole("button", { name: "Feature it on the post" }).click();
  const sheet = page.locator("side-sheet");
  await expect(sheet.getByText("The reader agreed to have this text featured.")).toBeVisible();
  await sheet.getByRole("textbox", { name: "Your note" }).fill("It says what the recipe can't.");
  await sheet.getByRole("button", { name: "Feature it" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Featured on “Pecan pie”." })).toBeVisible();
  expect(sent(calls, "engagement/community/feature")[0].body).toEqual({ id: ID(2), context: "It says what the recipe can't.", expectedVersion: 2 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => sent(calls, "engagement/community/unfeature").length).toBe(1);

  await r.getByRole("button", { name: "Link to a later post" }).click();
  await sheet.getByRole("button", { name: "Link them" }).click();
  await expect(sheet.getByText("Choose the later post first.").first()).toBeVisible();
  await sheet.getByRole("combobox", { name: "Later post" }).selectOption("/later/");
  await sheet.getByRole("button", { name: "Link them" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Linked." })).toBeVisible();
  expect(sent(calls, "engagement/continuations/link")[0].body).toEqual({ id: ID(2), to: "/later/", relation: "takes-up", note: null, expectedVersion: 2 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => sent(calls, "engagement/continuations/unlink").map((c) => c.body)).toEqual([{ id: "l1" }]);
});

test("an idea for later: how to reach them with Copy, Copy to your research notes, Link to what you made", async ({ page }) => {
  const calls = await stub(page, [idea()]);
  await signIn(page);
  const i = card(page, "sorghum syrup");
  await expect(i.getByText("About this idea")).toBeVisible();
  await expect(i.getByText("Title (their words): Sorghum")).toBeVisible();
  await expect(i.getByText("ann@example.org")).toBeVisible();
  await expect(i.locator("a[href^='mailto:']")).toHaveCount(0);
  await expect(i.getByRole("button", { name: "Copy how to reach them" })).toBeVisible();
  await expect(i.getByRole("link", { name: /Open their link/ })).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await i.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Copy to your research notes" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Copied to your research notes. Nothing was shown, fetched or sent." })).toBeVisible();
  expect(sent(calls, "engagement/suggestions/export")[0].body).toEqual({ id: ID(3), version: 2 });
  await i.getByRole("button", { name: "Link to what you made" }).click();
  const sheet = page.locator("side-sheet");
  await sheet.getByRole("button", { name: "Record the link" }).click();
  await expect(sheet.getByText("Choose what you made.").first()).toBeVisible();
  await sheet.getByRole("combobox", { name: "What you made" }).selectOption("draft");
  await sheet.getByRole("textbox", { name: "Which one" }).fill("sorghum-syrup");
  await sheet.getByRole("button", { name: "Record the link" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Recorded. Nothing was made, shown or sent." })).toBeVisible();
  expect(sent(calls, "engagement/suggestions/link")[0].body).toEqual({ id: ID(3), version: 2, conversion: { kind: "draft", id: "sorghum-syrup" } });
});

test("an author answers a reflection and can take an answer back, after one question", async ({ page }) => {
  const calls = await stub(page, [reflection(), answer()]);
  await signIn(page);
  const r = card(page, "What stayed with you");
  await r.getByRole("button", { name: "Send it for a yes" }).click();
  await expect(r.getByText("Write your answer first.").first()).toBeVisible();
  await r.getByRole("textbox", { name: "Answer as writer" }).fill("Thank you for reading it so closely.");
  await r.getByRole("button", { name: "Send it for a yes" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Sent. It waits for a coordinator." })).toBeVisible();
  expect(sent(calls, "engagement/author-response")[0].body).toEqual({ parent: ID(2), parentVersion: 2, body: "Thank you for reading it so closely." });
  const a = page.locator(".studio-reader").filter({ has: page.getByRole("button", { name: "Take my answer back" }) });
  await a.getByRole("button", { name: "Take my answer back" }).click();
  const dialog = page.getByRole("dialog", { name: "Take your answer back?" });
  await dialog.getByRole("button", { name: "Keep it" }).click();
  expect(calls.filter((c) => c.method === "PATCH" && c.path === "engagement/author-response")).toHaveLength(0);
  await a.getByRole("button", { name: "Take my answer back" }).click();
  await page.getByRole("dialog", { name: "Take your answer back?" }).getByRole("button", { name: "Take it back" }).click();
  await expect(page.locator("main p[role=status]").filter({ hasText: "Taken back. It isn't shown anywhere." })).toBeVisible();
  expect(calls.filter((c) => c.method === "PATCH" && c.path === "engagement/author-response")[0].body).toEqual({ id: ID(4), version: 2 });
});

test("banners say what must come off, each with its button; fixing what's on the post offers Undo, the opposite call", async ({ page }) => {
  const calls = await stub(page, [unpublished()], { audit: { mustComeOff: [{ id: "p9", post: "Apple cake" }] } });
  await signIn(page);
  const banner = page.locator("alert-banner[data-audit='readers.auditMustGo']");
  await expect(banner).toContainText("1 reflections must come off their posts");
  await expect(banner).toContainText("“Apple cake”");
  await banner.getByRole("button", { name: "Take it off the post" }).click();
  await expect.poll(() => sent(calls, "engagement/third-perspectives/unpublish").map((c) => c.body)).toEqual([{ id: "p9" }]);
  const c = card(page, "Lee");
  await c.getByRole("button", { name: "Put it on the post" }).click();
  await expect.poll(() => sent(calls, "engagement/feedback/publish").length).toBe(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => sent(calls, "engagement/feedback/unpublish").length).toBe(1);
  await expect(page.locator("main p[role=status]").filter({ hasText: "The post is back as it was." })).toBeVisible();
});

test("a check of what's on the posts that fails is said, never silent; one refused as not hers says nothing", async ({ page }) => {
  await stub(page, [question()]);
  await page.route("**/admin/api/engagement/third-perspectives/published", (route) => json(route, 502, { error: "down", code: "service-down" }));
  await signIn(page);
  await expect(page.locator("alert-banner[data-audit='readers.auditFailed']")).toContainText("couldn't check what's on your posts just now");
  await expect(page.locator("alert-banner[data-audit='readers.auditFailed']").getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a tapped notification: one that's gone and no signal say different, true things", async ({ page }) => {
  await stub(page, []);
  await page.route("**/admin/api/engagement/moderation/item**", (route) => json(route, 404, { error: "gone", code: "gone" }));
  await signIn(page, `#/readers?item=feedback:${ID(77)}`);
  await expect(page.locator("main p[role=status]").filter({ hasText: "The one you tapped isn't there any more." })).toBeVisible();
  await page.unroute("**/admin/api/engagement/moderation/item**");
  await page.route("**/admin/api/engagement/moderation/item**", (route) => route.abort());
  await page.goto(`${origin}/admin/studio/#/readers?item=feedback:${ID(78)}`);
  await page.reload();
  await expect(page.locator("main p[role=status]").filter({ hasText: "can't reach your site right now" })).toBeVisible();
  await expect(page.getByText("This was already decided somewhere else.")).toHaveCount(0);
});

test("X selects the focused card with Select on; at 320 px the time keeps its comma, nothing scrolls sideways, axe is clean", async ({ page }) => {
  const waiting = (n, name) => ({ ...base(n, { kind: "comment", source: "comment", kindLabel: "Comment", status: "pending", reader: { name, publishName: true } }), actions: [{ action: "approve", label: "Approve", reasons: [] }, { action: "reject", label: "Reject", reasons: [{ id: "spam", label: "Spam" }] }] });
  await stub(page, [waiting(31, "Ann"), waiting(32, "Bea")]);
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, "#/readers");
  await page.getByText("Select", { exact: true }).click();
  await page.getByRole("heading", { name: "Ann" }).focus();
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: /Select .*Ann/ })).toBeChecked();
  await expect(page.getByText("1 selected")).toBeVisible();
  // The comma stays with the time: no line of the meta starts with one.
  const starts = await page.locator(".studio-reader-meta").first().evaluate((meta) => {
    const range = document.createRange();
    const out = [];
    for (const node of meta.querySelectorAll("*")) {
      for (const text of [...node.childNodes].filter((n) => n.nodeType === 3 && n.textContent.startsWith(","))) {
        range.setStart(text, 0); range.setEnd(text, 1);
        const comma = range.getBoundingClientRect();
        const left = meta.getBoundingClientRect().left;
        out.push(Math.round(comma.left - left));
      }
    }
    return out;
  });
  for (const at of starts) expect(at, "a comma starting a line").toBeGreaterThan(4);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => v.id));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => [...document.querySelectorAll(".shell-content")].some((b) => b.scrollWidth > b.clientWidth + 1))).toBe(false);
});

test("The evidence you recorded opens the post's Claims and evidence, on the claim she chooses", async ({ page }) => {
  await stub(page, [question()]);
  await signIn(page);
  const q = card(page, "Is the crust older");
  await q.getByRole("button", { name: "Record what you decided" }).click();
  const sheet = page.locator("side-sheet");
  await sheet.getByRole("radio", { name: /Accepted as evidence/ }).click();
  const open = sheet.getByRole("link", { name: "Open Claims and evidence" });
  await expect(open).toHaveAttribute("href", "#/write/posts%2Fpecan-pie.md?sheet=claims");
  await sheet.getByRole("combobox", { name: "The evidence you recorded" }).selectOption("c1 l1");
  await expect(open).toHaveAttribute("href", "#/write/posts%2Fpecan-pie.md?sheet=claims&claim=c1");
});

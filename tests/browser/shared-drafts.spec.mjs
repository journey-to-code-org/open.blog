import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import axe from "axe-core";
import { removeTree } from "./teardown.mjs";

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
let synthesis;

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
  removeTree(root);
});

const stamp = (number) => ({ number, contributionId: "participant-1", digest: "d" });
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function install(context, { coordinator = false } = {}) {
  store = { number: 0, markdown: "" };
  synthesis = { revision: 0, items: [], authors: [{ id: "p-me", displayName: "Writer" }], you: "p-me" };
  offline = false;
  if (coordinator) await context.route("**/admin/api/contributors", (route) => json(route, 200, { contributors: { writer: { name: "Writer" } } }));
  await context.route("**/admin/api/collaboration/**", async (route) => {
    const method = route.request().method();
    if (offline && method !== "GET") return route.abort("internetdisconnected");
    const path = new URL(route.request().url()).pathname.replace("/admin/api/collaboration/", "");
    if (path === "publications") {
      return json(route, 200, { publications: [{ publicationId: PUBLICATION, roles: coordinator ? ["coordinator", "contributor"] : ["contributor"], title: "A shared reflection", guidingQuestion: "What stayed with you?", sources: [] }] });
    }
    if (coordinator && path === "members") return json(route, 200, {
      revision: 0, members: [{ participantId: "p-other", displayName: "Another writer", adminUser: "other", contributorId: "other", roles: ["contributor"], canChangeRoles: true, canRemove: true }],
    });
    if (coordinator && path === "invitations") return json(route, 200, { invitations: [] });
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
    if (path === "synthesis" && method === "GET") return json(route, 200, synthesis);
    if (path === "synthesis" && method === "POST") {
      const body = route.request().postDataJSON();
      if (body.expectedRevision !== synthesis.revision) return json(route, 409, { error: "The continuing conversation changed since you read it." });
      const me = synthesis.authors[0];
      const items = synthesis.items.map((item) => ({ ...item }));
      if (body.change.action === "add") {
        items.push({ id: `syn-${items.length + 1}`, kind: body.change.kind, markdown: body.change.markdown, revision: 1, contributors: [me], approved: [], awaiting: [me], mine: true, approvedByYou: false });
      } else if (body.change.action === "approve") {
        for (const item of items) if (item.id === body.change.id) Object.assign(item, { approved: [me], awaiting: [], approvedByYou: true });
      }
      synthesis = { ...synthesis, revision: synthesis.revision + 1, items };
      return json(route, 200, synthesis);
    }
    if (coordinator && path === "reflection") return json(route, 200, {
      structure: null, canArrange: true,
      participants: [{ id: "p-me", displayName: "Writer" }, { id: "p-other", displayName: "Another writer" }],
    });
    if (coordinator && path === "approval-policy") return json(route, 200, {
      policy: { requirement: "allAuthors", scope: "wholePiece" }, revision: 0,
      summary: "Every author must approve the whole piece.", required: ["Writer", "Another writer"],
      missing: ["Writer", "Another writer"], mayDropApprovers: true,
      approvers: [{ participantId: "p-me", displayName: "Writer" }, { participantId: "p-other", displayName: "Another writer" }],
    });
    if (path === "reveal") return json(route, 200, coordinator
      ? { policy: "allReady", ready: false, canSetPolicy: true, slots: [
          { participantId: "p-me", displayName: "Writer", kind: "own", markdown: store.markdown },
          { participantId: "p-other", displayName: "Another writer", kind: "private", ready: false },
        ] }
      : { policy: "voluntary", ready: false, canSetPolicy: false, slots: [] });
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

test("the private draft and conflict recovery are accessible at 400px", async ({ page, context }) => {
  await install(context);
  await page.setViewportSize({ width: 400, height: 800 });
  await openPanel(page);
  await page.evaluate(axe.source);
  const audit = async () => page.evaluate(async () => window.axe.run(document.querySelector(".oba-draft"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect((await audit()).violations).toEqual([]);
  await editor(page).fill("My unsaved perspective.");
  store = { number: 1, markdown: "Another saved perspective." };
  await saveDraft(page).click();
  await expect(page.getByRole("heading", { name: "Your draft changed elsewhere" })).toBeFocused();
  expect((await audit()).violations).toEqual([]);
  await expect(editor(page)).toHaveValue("My unsaved perspective.");
});

test("restoring after a conflict keeps edits made while deciding", async ({ page, context }) => {
  await install(context);
  await openPanel(page);
  await editor(page).fill("Original unsaved text.");
  store = { number: 1, markdown: "Newer saved text." };
  await saveDraft(page).click();
  await expect(page.getByRole("heading", { name: "Your draft changed elsewhere" })).toBeVisible();
  await editor(page).fill("Edited while deciding.");
  await page.getByRole("button", { name: "Use the newer copy instead" }).click();
  await expect(editor(page)).toHaveValue("Newer saved text.");
  await page.getByRole("button", { name: "Restore my earlier text" }).click();
  await expect(editor(page)).toHaveValue("Edited while deciding.");
});

test("sharing, arrangement and approval controls are accessible at 400px", async ({ page, context }) => {
  await install(context, { coordinator: true });
  store = { number: 1, markdown: "My draft." };
  await page.setViewportSize({ width: 400, height: 800 });
  await openPanel(page);
  await expect(page.getByRole("heading", { name: "Layout and arrangement" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval rule" })).toBeVisible();
  await page.getByRole("button", { name: "Offer revision 1 to the group" }).click();
  await expect(page.getByRole("group", { name: "Share revision 1?" })).toBeFocused();
  await page.evaluate(axe.source);
  const result = await page.evaluate(async () => window.axe.run(document.querySelector(".oba-draft"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("members and invitations are accessible by keyboard at 400px", async ({ page, context }) => {
  await install(context, { coordinator: true });
  await context.route("**/admin/api/collaboration/invitations", (route) => json(route, 422, { error: "That account cannot be invited." }));
  await page.setViewportSize({ width: 400, height: 800 });
  await openPanel(page);
  const summary = page.locator("summary", { hasText: "Members and invitations" });
  await summary.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator(".oba-invitations").filter({ has: summary });
  await expect(panel.getByRole("button", { name: "Change roles for Another writer" })).toBeVisible();
  await page.evaluate(axe.source);
  const audit = () => page.evaluate(() => window.axe.run(document.querySelector(".oba-invitations:not(.oba-draft):not(.oba-series)"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect((await audit()).violations).toEqual([]);
  await panel.getByRole("button", { name: "Create invitation link" }).press("Enter");
  await expect(panel.getByRole("alert")).toBeFocused();
  expect((await audit()).violations).toEqual([]);
  await panel.getByLabel("Their sign-in name").fill("other");
  await panel.getByRole("button", { name: "Create invitation link" }).press("Enter");
  await expect(panel.getByRole("alert")).toContainText("That account cannot be invited.");
  await expect(panel.getByRole("alert")).toBeFocused();
  const change = panel.getByRole("button", { name: "Change roles for Another writer" });
  await change.press("Enter");
  const roles = panel.getByRole("group", { name: "Roles for Another writer" });
  await roles.locator("input:checked").uncheck();
  await roles.getByRole("button", { name: "Review change" }).press("Enter");
  await expect(panel.getByRole("alert")).toContainText("Choose at least one role");
  await expect(panel.getByRole("alert")).toBeFocused();
  expect((await audit()).violations).toEqual([]);
  await roles.getByRole("button", { name: "Cancel" }).press("Enter");
  await expect(change).toBeFocused();
  const remove = panel.getByRole("button", { name: "Remove access for Another writer" });
  await remove.press("Enter");
  await expect(panel.getByRole("group", { name: "Remove Another writer?" })).toBeFocused();
  expect((await audit()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a named release confirms the selected recipients and revision at 400px", async ({ page, context }) => {
  await install(context);
  store = { number: 1, markdown: "Private words." };
  let released;
  await context.route("**/admin/api/collaboration/reveal?**", (route) => json(route, 200, {
    policy: "namedRecipients", ready: false, canSetPolicy: false, slots: [
      { participantId: "p-me", displayName: "Writer", kind: "own", mayReceive: false, markdown: store.markdown },
      { participantId: "p-other", displayName: "Another writer", kind: "private", mayReceive: true },
      { participantId: "p-absent", displayName: "Former writer", kind: "private", mayReceive: false },
    ],
  }));
  await context.route("**/admin/api/collaboration/reveal/named", (route) => {
    released = route.request().postDataJSON();
    return json(route, 200, { released: true });
  });
  await page.setViewportSize({ width: 400, height: 800 });
  await openPanel(page);
  await page.getByRole("button", { name: "Choose who receives revision 1" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Choose at least one recipient.");
  await page.getByRole("checkbox", { name: "Another writer" }).check();
  await page.getByRole("button", { name: "Choose who receives revision 1" }).click();
  const confirmation = page.getByRole("group", { name: "Share revision 1?" });
  await expect(confirmation).toBeFocused();
  await expect(confirmation).toContainText("Another writer");
  await expect(confirmation).not.toContainText("Former writer");
  await page.evaluate(axe.source);
  const result = await page.evaluate(() => window.axe.run(document.querySelector(".oba-draft"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect(result.violations).toEqual([]);
  await confirmation.getByRole("button", { name: "Share revision 1" }).click();
  await expect.poll(() => released).toEqual({ publicationId: PUBLICATION, revision: 1, recipients: ["p-other"] });
  await expect(page.getByText("Revision 1 was shared with the selected people.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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

// The combined preview: two authors in mixed states. The document is the stand-in's, carrying the
// real policy and frame headers from the server code, so this checks what the browser does with
// them: the empty-sandbox frame loads, nothing in it runs or fetches, and the page is labelled.
const previewPolicy = readFileSync(join(repository, "crates", "openblog-core", "src", "preview.rs"), "utf8")
  .match(/PREVIEW_CSP: &str = "([\s\S]*?)";/)[1]
  .replace(/\\\s+/g, "");
const TRACKER = "https://tracker.invalid/pixel.gif";
const previewDocument = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview, not published: A shared reflection</title></head><body>
<p role="note"><strong>Preview, not published.</strong> Only authors of this piece can see it.</p>
<p role="status">Incomplete: some sections are not shared with you at their current revision.</p>
<h1>A shared reflection</h1>
<section><p>Writer (you): revision 1.</p><div><p>Writer's own words.</p><script>document.body.insertAdjacentHTML("beforeend", '<i id="ran"></i>')</script><img src="${TRACKER}" alt=""><a href="javascript:document.title='clicked'">link</a></div></section>
<section><p>Bo: not shared with you at its current revision.</p></section>
</body></html>`;

test("the combined preview loads in an empty sandbox, runs and fetches nothing, and is labelled", async ({ page, context }) => {
  await install(context);
  const trackerRequests = [];
  // Count only requests that reach the network: Chromium still reports CSP-blocked ones as request events.
  await context.route("https://tracker.invalid/**", (route) => { trackerRequests.push(route.request().url()); return route.abort(); });
  await context.route("**/admin/api/collaboration/reveal?**", (route) => json(route, 200, {
    policy: "voluntary", ready: false, canSetPolicy: false,
    slots: [
      { participantId: "p1", displayName: "Writer", kind: "own", ready: false, stamp: stamp(1), markdown: "Writer's own words." },
      { participantId: "p2", displayName: "Bo", kind: "private", ready: false, stamp: null, markdown: null },
    ],
  }));
  await context.route("**/admin/api/collaboration/preview?**", (route) => json(route, 200, {
    preview: {
      complete: false, ready: false, seen: null, previewUrl: "/admin/api/preview/" + "a".repeat(64),
      sections: [
        { participantId: "p1", displayName: "Writer", shown: true, revision: 1, approval: "awaiting", required: true, errors: [] },
        { participantId: "p2", displayName: "Bo", shown: false, revision: null, approval: "awaiting", required: true, errors: [] },
      ],
    },
  }));
  let framed = 0;
  await context.route("**/admin/api/preview/**", (route) => {
    framed += 1;
    return route.fulfill({
      status: 200, contentType: "text/html; charset=utf-8", body: previewDocument,
      headers: { "Content-Security-Policy": previewPolicy, "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer" },
    });
  });
  await openPanel(page);
  await page.getByRole("button", { name: "Review the combined piece" }).click();

  const frame = page.locator('iframe[title="Combined piece preview, not published"]');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(frame).toHaveAttribute("src", /^\/admin\/api\/preview\/[0-9a-f]{64}$/);
  const inside = page.frameLocator('iframe[title="Combined piece preview, not published"]');
  await expect(inside.getByRole("note")).toContainText("Preview, not published.");
  await expect(inside.getByRole("status")).toContainText("Incomplete");
  await expect(inside.getByText("Writer's own words.")).toBeVisible();
  await expect(inside.getByText("Bo: not shared with you at its current revision.")).toBeVisible();
  expect(framed).toBeGreaterThan(0);

  // Nothing ran in the frame and nothing was fetched from it.
  await expect(inside.locator("#ran")).toHaveCount(0);
  await expect(inside.locator("#ran")).toHaveCount(0);
  expect(trackerRequests).toEqual([]);

  // The Admin page announces the same state and lists each author, without any prose from Bo.
  await expect(page.getByRole("status").filter({ hasText: "Preview, not published." })).toContainText("Incomplete");
  await expect(page.getByRole("list", { name: "Authors in the combined piece" })).toContainText("Bo: not shared with you at its current revision");
  await expect(page.getByRole("list", { name: "Authors in the combined piece" })).not.toContainText("private words");
  await expect(page.getByRole("button", { name: "Approve this piece" })).toHaveCount(0);
});

test("approval requires a complete preview and explicit credit consent; stale reviews are refused", async ({ page, context }) => {
  await install(context, { coordinator: true });
  store = { number: 1, markdown: "My draft." };
  let token = "reviewed-revision";
  let requests = [];
  let stale = true;
  await context.route("**/admin/api/collaboration/preview?**", (route) => json(route, 200, {
    preview: {
      complete: true, ready: false, seen: token, previewUrl: "/admin/api/preview/" + "a".repeat(64),
      sections: [{ participantId: "p-me", displayName: "Writer", shown: true, revision: 1, approval: "awaiting", required: true, errors: [] }],
    },
  }));
  await context.route("**/admin/api/preview/**", (route) => route.fulfill({
    status: 200, contentType: "text/html", body: previewDocument,
    headers: { "Content-Security-Policy": previewPolicy },
  }));
  await context.route("**/admin/api/collaboration/approve", (route) => {
    requests.push(route.request().postDataJSON());
    if (stale) return json(route, 409, { error: "The piece changed after you read it. Reload the combined preview." });
    return json(route, 200, { approved: true });
  });
  let withdrawals = 0;
  await context.route("**/admin/api/collaboration/approve/withdraw", (route) => {
    withdrawals += 1;
    expect(route.request().postDataJSON()).toEqual({ publicationId: PUBLICATION });
    return json(route, 200, { withdrawn: true });
  });
  await page.setViewportSize({ width: 400, height: 800 });
  await openPanel(page);
  await page.getByRole("button", { name: "Review the combined piece" }).click();
  const consent = page.getByRole("checkbox", { name: /I approve publishing exactly the piece I reviewed/ });
  const approve = page.getByRole("button", { name: "Approve this piece" });
  await expect(approve).toBeDisabled();
  await consent.check();
  await expect(approve).toBeEnabled();
  await page.evaluate(axe.source);
  const audit = await page.evaluate(async () => window.axe.run(document.querySelector(".oba-preview-review"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect(audit.violations).toEqual([]);
  await approve.click();
  expect(requests[0]).toEqual({ publicationId: PUBLICATION, seen: token, affirmed: true });
  await expect(page.getByText("The piece changed after you read it. Reload the combined preview.")).toBeVisible();
  await expect(approve).toHaveCount(0);
  token = "new-reviewed-revision";
  stale = false;
  await page.getByRole("button", { name: "Review the combined piece" }).click();
  await consent.check();
  await approve.click();
  expect(requests[1]).toEqual({ publicationId: PUBLICATION, seen: token, affirmed: true });
  await expect(page.getByText("Your approval was recorded.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review the combined piece" })).toBeFocused();
  await page.getByRole("button", { name: "Review the combined piece" }).click();
  await page.getByRole("button", { name: "Withdraw my approval" }).click();
  expect(withdrawals).toBe(1);
  await expect(page.getByText("Your approval was withdrawn.", { exact: false })).toBeVisible();
});

test("the continuing conversation works with the keyboard alone at phone width, and focus is never lost", async ({ page, context }) => {
  await install(context);
  await page.setViewportSize({ width: 320, height: 700 });
  await openPanel(page);
  const heading = page.getByRole("heading", { name: "Continuing conversation" });
  await expect(heading).toBeVisible();
  const text = page.locator(".oba-synthesis-form textarea");
  await text.focus();
  await page.keyboard.type("We both noticed the pause.");
  await page.getByRole("button", { name: "Add item" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Item 1 of 1\. Agreement, speaking for Writer/)).toBeVisible();
  await expect(heading).toBeFocused();
  expect(synthesis.items[0].markdown).toBe("We both noticed the pause.");
  await page.getByRole("button", { name: "Approve this item" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "You approved this" })).toBeDisabled();
  await expect(page.locator(".oba-synthesis-item").getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await page.locator(".oba-synthesis-item").getByRole("button", { name: "Edit", exact: true }).press("Enter");
  await expect(page.getByLabel("Edit item text")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Edit cancelled. Nothing was changed.")).toBeVisible();
  await expect(page.locator(".oba-synthesis-item").getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".oba-synthesis, .oba-synthesis *")].filter((node) => node.getBoundingClientRect().right > limit + 1).map((node) => node.className || node.tagName);
  });
  expect(wide).toEqual([]);
});

test("continuing conversation and item editing pass axe at 400px", async ({ page, context }) => {
  await install(context);
  await page.setViewportSize({ width: 400, height: 800 });
  await openPanel(page);
  await page.evaluate(axe.source);
  const audit = () => page.evaluate(() => window.axe.run(document.querySelector(".oba-synthesis"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  }));
  expect((await audit()).violations).toEqual([]);
  await page.locator(".oba-synthesis-form textarea").fill("A shared thought.");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText(/Item 1 of 1/)).toBeVisible();
  await page.locator(".oba-synthesis-item").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Edit item text")).toBeFocused();
  expect((await audit()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

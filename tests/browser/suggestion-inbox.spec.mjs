import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// Suggestions for future work in the editors' inbox (#227, ADRs 0190 to 0195). The hosted inbox is
// mocked at the Admin API (the real Admin keeps the hosted token, resolves each item's actor and
// sends only what that actor may see); everything else is the real Admin. Covers a suggestion read as
// the reader's own unchecked statements with hostile text kept as text, its link left for the editor
// to open, accepting and declining from the keyboard with words that never speak of publication, the
// private contact shown only where the server sent it, possible duplicates pointed out without a
// number, the explicit copy into a private research note, conflicts and refusals, and 320px and 400%
// zoom without horizontal scrolling.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const ENDPOINT = "https://inbox.example/api";
const HOSTILE = "<img src=x onerror=alert(1)>";
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-suggestion-inbox-"));
  writeFileSync(join(root, "openblog.json"), JSON.stringify({
    title: "Inbox",
    url: "https://inbox-site.example.org",
    postPath: "/{slug}/",
    author: { name: "A" },
    engagement: { enabled: true, comments: false, analytics: false, endpoint: ENDPOINT, receipts: true },
    participation: { kinds: { "future-suggestion": "open" } },
  }));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "content", "posts", "tides.md"), "---\ntitle: Tides\ndate: 2026-10-20\n---\nThe moon causes the tides.\n");
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

const DECLINE = [{ id: "off-topic", label: "Off topic" }, { id: "duplicate", label: "Duplicate" }, { id: "other", label: "Other" }];
const CLARIFY = [{ id: "unclear", label: "Unclear" }, { id: "needs-source", label: "Needs a source" }];
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOTICE = "Accepted means the editors are interested in exploring this. It does not mean they agree with it, have checked it, or have permission to use it.";
const approve = { action: "approve", label: "Approve", reasons: [], guidance: "Accepts it into the editors’ private list and publishes nothing. It means only that you are interested in exploring it, not that you agree with it, have checked it or may use it." };
const reject = { action: "reject", label: "Reject", reasons: DECLINE, guidance: "Never shown. Its text is due to be purged 30 days after this decision." };
const clarify = { action: "request-clarification", label: "Ask to clarify", reasons: CLARIFY, guidance: "Asks the reader, through their private receipt, to revise it; nothing is e-mailed." };

/** A suggestion as the Admin server describes it to the signed-in account. */
function suggestion(n, extra = {}, details = {}) {
  return {
    id: ID(n),
    source: "feedback",
    kind: "future-suggestion",
    kindLabel: "Suggestion for future work",
    status: "pending",
    statusLabel: "Pending",
    version: 3,
    revision: 1,
    reason: null,
    reasonLabel: null,
    receivedAt: "2026-10-26T10:00:00Z",
    moderatedAt: null,
    work: "/tides/",
    post: { title: "Tides", url: "/tides/", source: "posts/tides.md" },
    role: "site-admin",
    mode: "open",
    public: false,
    published: false,
    clarification: { askedAboutThisText: false, consent: true },
    body: `Her letters from the 1850 survey would help. ${HOSTILE}`,
    details: {},
    reader: { name: "Private Person", publishName: false },
    suggestion: {
      type: "text",
      typeLabel: "Text to read",
      url: "https://example.org/letters",
      hints: { title: `The survey letters ${HOSTILE}`, creators: [], year: "c. 1850", publisher: null, identifiers: [{ scheme: "doi", value: "10.1234/abc" }] },
      about: { series: "tides" },
      missing: ["a creator"],
      notice: NOTICE,
      standing: { id: "received", label: "Received" },
      received: "2026-10-26",
      contact: "ada@example.org",
      export: null,
      ...details,
    },
    actions: [approve, clarify, reject],
    ...extra,
  };
}

const page_ = (items, extra = {}) => ({ state: "pending", kind: "future-suggestion", protocol: "protected", items, invalid: 0, next: null, ...extra });
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const queueStatus = (page) => page.locator(".oba-feedback-section").first().locator('p[role="status"]').first();

test("an editor reads a suggestion as the reader's own words and accepts it from the keyboard, with nothing published", async ({ page }) => {
  let items = [suggestion(1), suggestion(2, { reader: { publishName: false }, suggestion: undefined, body: "A question." }, {})];
  items[1] = suggestion(2, { reader: { publishName: true, name: "Grace" } }, { type: "audio", typeLabel: "Audio to hear", url: null, hints: { title: null, creators: [], year: null, publisher: null, identifiers: [] }, about: null, missing: ["a link or identifier", "a title", "a creator"], contact: null });
  items[0].similar = [{ id: ID(2), source: "feedback", kindLabel: "Suggestion for future work", receivedAt: "2026-10-26T10:00:00Z", reason: "the same source" }];
  const changes = [];
  await page.route(`${origin}/admin/api/engagement/moderation?**`, (route) => json(route, 200, page_(items)));
  await page.route(`${origin}/admin/api/engagement/moderation`, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const body = route.request().postDataJSON();
    changes.push(body);
    items = items.filter((item) => item.id !== body.id);
    return json(route, 200, { item: { id: body.id, status: "approved" }, published: false, publishError: null });
  });
  const dialogs = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await signIn(page);
  await page.goto(`${origin}/admin/#/moderation?kind=future-suggestion`);
  await expect(page.getByRole("heading", { name: "Moderation queue", level: 2 })).toBeVisible();
  await expect(queueStatus(page)).toHaveText("2 pending items.");
  await expect(page.getByLabel("Kind", { exact: true })).toHaveValue("future-suggestion");

  const card = page.locator(`[data-moderation-id="${ID(1)}"]`);
  await expect(card.getByRole("heading", { name: "Suggestion for future work on “Tides”", level: 3 })).toBeVisible();
  await expect(card.getByRole("heading", { name: "The reader’s suggestion", level: 4 })).toBeVisible();
  await expect(card.getByText(`Her letters from the 1850 survey would help. ${HOSTILE}`)).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  // Every statement about the source is the reader's, and nothing is called checked.
  await expect(card.getByText("Kind: Text to read.")).toBeVisible();
  await expect(card.getByText(`Title (the reader’s words): The survey letters ${HOSTILE}`)).toBeVisible();
  await expect(card.getByText("DOI (not checked): 10.1234/abc")).toBeVisible();
  await expect(card.getByText("About the series: tides")).toBeVisible();
  await expect(card.getByText("Still to find: a creator.")).toBeVisible();
  const link = card.getByRole("link", { name: "https://example.org/letters" });
  await expect(link).toHaveAttribute("href", "https://example.org/letters");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(card).toContainText("nothing fetched it for you");
  // The contact the server sent, with what happens to it.
  await expect(card.getByText("Contact the reader agreed to: ada@example.org.", { exact: false })).toBeVisible();
  await expect(card).toContainText("this site never e-mails it");
  await expect(card.getByText("The name stays private: the reader did not agree to be thanked by it.", { exact: false })).toBeVisible();
  await expect(card.getByText(NOTICE)).toBeVisible();
  // No count, rank or vote anywhere.
  const text = await card.innerText();
  for (const word of ["votes", "rank", "popular", "most requested"]) expect(text.toLowerCase()).not.toContain(word);
  // A duplicate is pointed out as a cue, with a link that moves focus, and no number.
  await expect(card.getByText("Possibly about the same thing")).toBeVisible();
  await card.getByRole("link", { name: /Suggestion for future work received/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Suggestion for future work on “Tides”", level: 3 }).nth(1)).toBeFocused();
  // The second card shows the name the reader agreed to be thanked by and no contact.
  const second = page.locator(`[data-moderation-id="${ID(2)}"]`);
  await expect(second.getByText("From Grace, who agreed that you may thank them by this name", { exact: false })).toBeVisible();
  await expect(second.getByText("Contact the reader agreed to")).toHaveCount(0);
  await expect(second.getByText("Still to find: a link or identifier, a title, a creator.")).toBeVisible();

  // Accepting is its own decision, with guidance that says nothing is published.
  const accept = card.getByRole("button", { name: "Approve", exact: true });
  await expect(accept).toHaveAccessibleDescription(/publishes nothing/);
  await accept.focus();
  await page.keyboard.press("Enter");
  await expect(queueStatus(page)).toContainText("Accepted into the editors’ list. Nothing was published or e-mailed.");
  await expect(queueStatus(page)).toContainText("not that you agree with it, have checked it or may use it");
  await expect(queueStatus(page)).toBeFocused();
  expect(changes).toEqual([{ source: "feedback", id: ID(1), action: "approve", from: "pending", version: 3 }]);
  expect(dialogs).toEqual([]);
});

test("declining needs a reason and is worded as not taken forward, never as a verdict", async ({ page }) => {
  let items = [suggestion(3)];
  const changes = [];
  await page.route(`${origin}/admin/api/engagement/moderation?**`, (route) => json(route, 200, page_(items)));
  await page.route(`${origin}/admin/api/engagement/moderation`, async (route) => {
    changes.push(route.request().postDataJSON());
    items = [];
    return json(route, 200, { item: { id: ID(3), status: "rejected" }, published: false, publishError: null });
  });
  await signIn(page);
  await page.goto(`${origin}/admin/#/moderation?kind=future-suggestion`);
  const card = page.locator(`[data-moderation-id="${ID(3)}"]`);
  await card.getByRole("button", { name: "Reject", exact: true }).focus();
  await page.keyboard.press("Enter");
  const why = card.getByLabel("Reason to reject");
  await expect(why).toBeFocused();
  await expect(card.locator('p[role="status"]')).toHaveText("Choose a reason first.");
  await why.selectOption("off-topic");
  await card.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(queueStatus(page)).toHaveText("Not taken forward. Nothing was published or e-mailed.");
  expect(changes).toEqual([{ source: "feedback", id: ID(3), action: "reject", from: "pending", version: 3, reason: "off-topic" }]);
});

test("a coordinator sees the suggestion but never the contact or the private name, and no export", async ({ page }) => {
  const items = [suggestion(4, { role: "coordinator", reader: { publishName: false, private: true } }, { contact: null, export: null })];
  await page.route(`${origin}/admin/api/engagement/moderation?**`, (route) => json(route, 200, page_(items)));
  await signIn(page);
  await page.goto(`${origin}/admin/#/moderation?kind=future-suggestion`);
  const card = page.locator(`[data-moderation-id="${ID(4)}"]`);
  await expect(card.getByText("You moderate this as a coordinator", { exact: false })).toBeVisible();
  await expect(card.getByText("The reader gave a name that only the site Admin can see.")).toBeVisible();
  const text = await card.innerText();
  expect(text).not.toContain("ada@example.org");
  expect(text).not.toContain("Private Person");
  await expect(card.getByText("Contact the reader agreed to")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Copy into a private research note" })).toHaveCount(0);
});

test("an accepted suggestion is copied into a private research note only when the author asks, and a conflict says so", async ({ page }) => {
  const accepted = suggestion(5, {
    status: "approved", statusLabel: "Approved", version: 4, moderatedAt: "2026-10-27T10:00:00Z",
    actions: [{ action: "remove", label: "Close it", reasons: DECLINE, guidance: "Closes it with this reason. It was never shown." }],
  }, {
    standing: { id: "interested", label: "Editors are interested" },
    export: { label: "Copy into a private research note", guidance: "Starts a note in your private research notebook from this suggestion, labelled as unverified reader text with where it came from. It copies no name, no contact and no time, fetches nothing, publishes nothing and changes nothing about the suggestion." },
  });
  const exports = [];
  let answer = { status: 201, body: { ok: true, note: { id: "suggestion-00000000" }, revision: "r1", item: null } };
  await page.route(`${origin}/admin/api/engagement/moderation?**`, (route) => json(route, 200, page_([accepted], { state: "approved" })));
  await page.route(`${origin}/admin/api/engagement/suggestions/export`, async (route) => {
    exports.push(route.request().postDataJSON());
    return json(route, answer.status, answer.body);
  });
  await signIn(page);
  await page.goto(`${origin}/admin/#/moderation/approved?kind=future-suggestion`);
  const card = page.locator(`[data-moderation-id="${ID(5)}"]`);
  await expect(card.getByText("Stands as: Editors are interested.")).toBeVisible();
  await expect(card).not.toContainText("Published on the post");
  await expect(card.getByRole("button", { name: /Publish on the post|Take it off/ })).toHaveCount(0);
  const button = card.getByRole("button", { name: "Copy into a private research note" });
  await expect(button).toHaveAccessibleDescription(/copies no name, no contact and no time, fetches nothing, publishes nothing/);
  expect(exports).toEqual([]);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(card.locator('p[role="status"]')).toContainText("A private research note was made (suggestion-00000000). Nothing was published, fetched or e-mailed, and the suggestion is unchanged.");
  expect(exports).toEqual([{ id: ID(5), version: 4 }]);
  // A refusal says why and keeps the card.
  answer = { status: 422, body: { error: "The id suggestion-00000000 is already used by a note.", code: "invalid" } };
  await button.click();
  await expect(card.locator('p[role="status"]')).toContainText("already used");
  await expect(card).toBeVisible();
});

for (const [name, viewport, zoom] of [["320px", { width: 320, height: 900 }, 1], ["400% zoom", { width: 1280, height: 800 }, 4]]) {
  test(`at ${name} a suggestion's card reflows without scrolling sideways`, async ({ browser }) => {
    const size = zoom === 1 ? viewport : { width: viewport.width / zoom, height: viewport.height / zoom };
    const context = await browser.newContext({ viewport: size, reducedMotion: "reduce" });
    const page = await context.newPage();
    const long = "x".repeat(400);
    const items = [suggestion(6, { body: long }, {
      url: `https://example.org/${"a".repeat(300)}`,
      hints: { title: long, creators: [long], year: null, publisher: long, identifiers: [{ scheme: "doi", value: `10.1234/${long}` }] },
      export: { label: "Copy into a private research note", guidance: "Starts a note." },
      contact: `${"a".repeat(60)}@${"b".repeat(60)}.example.org`,
    })];
    await page.route(`${origin}/admin/api/engagement/moderation?**`, (route) => json(route, 200, page_(items)));
    await signIn(page);
    await page.goto(`${origin}/admin/#/moderation?kind=future-suggestion`);
    await expect(queueStatus(page)).toHaveText("1 pending item.");
    const card = page.locator(`[data-moderation-id="${ID(6)}"]`);
    await expect(card.getByText("Kind: Text to read.")).toBeVisible();
    const width = size.width;
    const wide = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      return [...document.querySelectorAll(".oba-moderation-item, .oba-moderation-item *")]
        .filter((element) => element.getBoundingClientRect().right > limit + 1)
        .map((element) => element.className || element.tagName);
    });
    expect(wide).toEqual([]);
    expect(await card.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    for (const control of await card.locator("button, select, input, a").all()) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await context.close();
  });
}

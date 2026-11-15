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

// Continuation links (#231, ADRs 0218 to 0223). The reader's side, in the real site with JavaScript
// switched off: the earlier page lists where a question went, the later page lists what it
// continues, each as ordinary links reached from the keyboard, with a link to an unpublished page
// absent, no reader text and no overflow at 320px. The editor's side, in the real Admin with the
// hosted inbox mocked at the Admin API: a card that offers linking only to the site Admin for an
// approved item, a preview with the fixed notice, a link that is refused with a code, the list of
// links with their standing, removal, and the sweep of withdrawn submissions.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HOSTILE = "<img src=x onerror=alert(1)>";
const NOTE = "The next episode returns to the neap tides.";
const post = (title, extra = "") => `---\ntitle: ${title}\ndate: 2026-10-20\n${extra}---\nThe body of ${title}.\n`;
const edge = (id, to, extra = {}) => ({ id, kind: "question", origin: ID(1), from: "/tides/", to, relation: "takes-up", linked: "2026-10-27", ...extra });
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-continuations-"));
  writeFileSync(join(root, "openblog.json"), JSON.stringify({
    title: "Continuations",
    url: "https://continuations.example.org",
    postPath: "/{slug}/",
    author: { name: "A" },
    engagement: { enabled: true, comments: false, analytics: false, feedback: true, receipts: true, endpoint: "https://continuations.example/api" },
  }));
  mkdirSync(join(root, "content", "posts"), { recursive: true });
  writeFileSync(join(root, "content", "posts", "tides.md"), post("Tides"));
  writeFileSync(join(root, "content", "posts", "neaps.md"), post("Neap tides", "series: ocean\n"));
  writeFileSync(join(root, "content", "posts", "springs.md"), post(`Spring ${HOSTILE}`));
  writeFileSync(join(root, "content", "posts", "later.md"), post("Not yet", "draft: true\n"));
  writeFileSync(join(root, "content", "continuations.json"), `${JSON.stringify({
    version: 1,
    items: [
      edge("a", "/neaps/", { series: "ocean", note: NOTE }),
      edge("b", "/springs/"),
      edge("c", "/later/"),
    ],
  }, null, 2)}\n`);
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

const CORS = { "access-control-allow-origin": "*" };
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });

const overflowOf = (page, selector) =>
  page.evaluate((selector) => {
    const region = document.querySelector(selector);
    const limit = document.documentElement.clientWidth;
    const elements = [region, ...region.querySelectorAll("*")];
    const offenders = elements.filter((element) => element.getBoundingClientRect().right > limit + 1).map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
    return { overflow: Math.max(region.scrollWidth - region.clientWidth, 0), offenders };
  }, selector);

// ---- The reader

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the earlier page lists where the question went and the later page lists what it continues", async ({ page }) => {
    await page.goto(`${origin}/tides/`);
    const earlier = page.getByRole("region", { name: "Where this question went" });
    await expect(earlier).toBeVisible();
    await expect(earlier).toContainText("These links connect later work to earlier questions and reflections.");
    await expect(earlier).toContainText("does not mean the earlier submission caused it");
    // Two published targets; the draft is absent, and so is anything of its title.
    await expect(earlier.getByRole("listitem")).toHaveCount(2);
    await expect(earlier.getByRole("link", { name: "Neap tides" })).toHaveAttribute("href", "/neaps/");
    await expect(earlier).toContainText(NOTE);
    await expect(earlier).toContainText("in the series ocean");
    await expect(earlier).not.toContainText("Not yet");
    // The hostile title is text, never markup.
    await expect(earlier.getByRole("link", { name: `Spring ${HOSTILE}` })).toBeVisible();
    await expect(earlier.locator("img")).toHaveCount(0);
    // No form, count or subscription belongs to it.
    await expect(earlier.locator("form, input, button, script")).toHaveCount(0);
    await expect(earlier).not.toContainText(/subscribe|popular|\d+ readers/i);
  });

  test("the link is followed from the keyboard, and the way back is a link too", async ({ page }) => {
    await page.goto(`${origin}/tides/`);
    const link = page.getByRole("region", { name: "Where this question went" }).getByRole("link", { name: "Neap tides" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/neaps/`);
    const later = page.getByRole("region", { name: "Earlier questions this continues" });
    await expect(later).toContainText("a reader's question");
    await expect(later).not.toContainText("The moon");
    const back = later.getByRole("link", { name: "Tides" });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/tides/`);
  });

  test("an item has a stable anchor that scrolls to it", async ({ page }) => {
    await page.goto(`${origin}/tides/#ob-continuation-a`);
    await expect(page.locator("#ob-continuation-a")).toBeInViewport();
    await expect(page.locator("#ob-continuation-a")).toContainText("Neap tides");
  });

  test("the region fits at 320px and at 400% zoom, with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [320, 1280 / 4]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${origin}/tides/`);
      const result = await overflowOf(page, "#ob-continuations");
      expect(result.offenders, `at ${width}px`).toEqual([]);
      expect(result.overflow, `at ${width}px`).toBe(0);
    }
  });
});

// ---- The editor

const approve = { action: "approve", label: "Approve", reasons: [], guidance: "" };
function item(n, extra = {}) {
  return {
    id: ID(n), source: "feedback", kind: "third-perspective", kindLabel: "Third Perspective", status: "approved", statusLabel: "Approved",
    version: 5, revision: 1, reason: null, reasonLabel: null, receivedAt: "2026-10-26T10:00:00Z", moderatedAt: "2026-10-27T09:00:00Z",
    work: "/tides/", post: { title: "Tides", url: "/tides/", source: "posts/tides.md" }, role: "site-admin", mode: "open", public: true,
    clarification: { askedAboutThisText: false, consent: false }, body: `A reading of the tides. ${HOSTILE}`, details: {},
    reader: { publishName: false }, published: true, mayBeShown: true, nameNarrowed: false, featureConsent: "not-agreed", actions: [approve].slice(1), ...extra,
  };
}
const page_ = (items, extra = {}) => ({ state: "approved", kind: "third-perspective", protocol: "full", items, invalid: 0, next: null, ...extra });
const WORKS = [{ path: "/neaps/", title: "Neap tides", series: "ocean" }, { path: "/springs/", title: "Spring tides", series: null }];
const NOTICE = "These links connect later work to earlier questions and reflections.";


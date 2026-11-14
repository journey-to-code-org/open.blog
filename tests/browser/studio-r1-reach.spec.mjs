import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// The worker keeps Studio's files since R4 (G35); a page it controls sends its requests past page.route,
// so the stand-ins here would be skipped. These tests don't need it.
test.use({ serviceWorkers: "block" });

// Studio R1, "Did my work get out, and what's next?": Home's "Get your site ready" list and recipe
// notes, Share this job (a Facebook Page through her shares, Nextdoor by hand with Undo), "Where
// each post went" as a view of Sharing, and the old addresses that now open them. The job, its
// by-hand record, the checklist and the recipe notes are the real server's; only the hosted social
// function is mocked at the Admin API. Each screen passes axe at 320 px without sideways scrolling.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const key = randomBytes(24).toString("hex");
const HOSTILE = "<img src=x onerror=alert(1)>";
const JOB = "posts%2Fmaple-roof.md";
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-r1-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  const configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.business = { trade: "roofing" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(root, "content", "posts", "maple-roof.md"), [
    "---", "title: New roof on Maple Street", "date: 2026-10-21", "description: A worn roof replaced before winter.", "profile: job", "job:",
    "  trade: roofing", "  service: roof-replacement", "  place:", "    town: Elkins", "    region: WV", "  started: 2026-10-14", "  finished: 2026-10-16",
    "---", "Tore off the old shingles and laid new ones.", ""].join("\n"));
  // A recipe whose course has no letters, and her own page at the recipe list's address.
  writeFileSync(join(root, "content", "posts", "pie.md"), ["---", "title: Pecan pie", "date: 2026-10-01", "profile: recipe", "course: \"???\"", "---", "Bake it.", ""].join("\n"));
  mkdirSync(join(root, "content", "pages"), { recursive: true });
  writeFileSync(join(root, "content", "pages", "recipes.md"), ["---", "title: My recipes", "slug: recipes", "---", `Mine. ${HOSTILE}`, ""].join("\n"));
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], {
    cwd: repository, stdio: "pipe",
    env: { ...process.env, OPENBLOG_SOCIAL_ENDPOINT: "http://127.0.0.1:9/api/social", OPENBLOG_SOCIAL_ADMIN_KEY: key },
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

async function signIn(page, hash) {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PAGE = { id: UUID(21), provider: "facebook", displayName: "Ridgeline Roofing", kind: "page" };

/** The hosted social function: one connected Page, the shares she made, and what's already out. */
async function mockSocial(page) {
  const sent = [];
  const shares = [
    { id: UUID(51), version: 1, work: "/portable-lesson/", canonicalUrl: "https://portable.example.org/portable-lesson/", caption: "Lesson", status: "published", delivery: "published", providerPostId: null, checkedByOwner: true, attemptCount: 1, updatedAt: "2026-11-02T10:00:00Z", scheduledFor: "2026-11-02T10:00:00Z", destination: { provider: "bluesky", displayName: "@ridgeline" } },
    { id: UUID(52), version: 2, work: "/portable-lesson/", canonicalUrl: "https://portable.example.org/portable-lesson/", caption: "Lesson", status: "unknown", delivery: "unknown", lastErrorCode: "timeout", attemptCount: 1, updatedAt: "2026-11-03T10:00:00Z", scheduledFor: "2026-11-03T10:00:00Z", destination: PAGE },
  ];
  await page.route("**/admin/api/social/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/social/", "");
    const method = route.request().method();
    const body = route.request().postDataJSON?.() ?? null;
    if (path === "destinations") return json(route, 200, { destinations: [PAGE] });
    if (path === "posts") return json(route, 200, { posts: [{ work: "/portable-lesson/", title: "Portable lesson", eligible: true }, { work: "/maple-roof/", title: "New roof on Maple Street", eligible: true }] });
    if (path === "accounts") return json(route, 200, { accounts: [] });
    if (path === "announcements/health") return json(route, 200, { health: { installed: true, alerts: [] } });
    if (path === "announcements" && method === "GET") {
      const work = url.searchParams.get("work");
      return json(route, 200, { announcements: work ? shares.filter((s) => s.work === work) : shares });
    }
    if (path === "announcements" && method === "POST") {
      sent.push(body);
      const made = { id: UUID(60 + sent.length), version: 1, work: body.work, canonicalUrl: `https://portable.example.org${body.work}`, caption: body.caption, status: "scheduled", delivery: "pending", scheduledFor: body.scheduledFor, createdAt: new Date().toISOString(), destination: PAGE };
      shares.push(made);
      return json(route, 200, { announcement: made, replayed: false });
    }
    if (path === "announcements/resolve") { sent.push({ resolve: url.searchParams.get("id"), ...body }); return json(route, 200, { announcement: shares[1] }); }
    if (path === "preview") return json(route, 200, { ok: true, problems: [] });
    return json(route, 404, { error: "not found" });
  });
  return sent;
}

async function axeClean(page, selector, label) {
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), selector);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
}

test("Home: Get your site ready ticks from the files, opens Studio screens, hides with Undo; recipe notes in her words", async ({ page }) => {
  await mockSocial(page);
  await signIn(page, "#/");
  const ready = page.locator(".studio-checklist");
  await expect(ready.getByRole("heading", { name: "Get your site ready" })).toBeVisible();
  await expect(ready.getByText("1 of 5 done")).toBeVisible();
  const job = ready.locator("[data-step=job]");
  await expect(job.getByText("Done", { exact: true })).toBeVisible();
  // The first open step says how, with its button; sharing a job opens Share this job.
  await expect(ready.locator("[data-step=business]").getByText("So customers can reach you.")).toBeVisible();
  await expect(ready.getByRole("link", { name: "Open Business facts: Add your phone number or email" })).toHaveAttribute("href", "#/business");
  await expect(ready.getByRole("link", { name: "Share your newest job: Share a job where customers look" })).toHaveAttribute("href", `#/sharing/job/${JOB}`);
  // Recipe notes: her words, a link to her page, and her page's title only as text.
  const notes = page.locator(".studio-recipe-notes");
  await expect(notes.getByText("Your recipe list has moved to a new spot on your blog, because your page “My recipes” uses its usual one. Links to it still work.")).toBeVisible();
  await expect(notes.getByText("Readers can't browse by a course with no name. Give it a word, like Dessert.")).toBeVisible();
  await expect(notes.getByRole("link", { name: "Open “My recipes”" })).toHaveAttribute("href", "#/page/pages%2Frecipes.md");
  // No path, address or broken-looking name on her layer; they wait in details for Mikey.
  const notesDetails = notes.locator("details");
  await expect(notesDetails).not.toHaveAttribute("open", "");
  const herLayer = await notes.evaluate((el) => [...el.querySelectorAll(".studio-recipe-note")].map((n) => n.textContent).join(" "));
  expect(herLayer).not.toMatch(/Settings|Slug|address|\/recipes\/all\/|\?\?\?/);
  await notesDetails.locator("summary").click();
  await expect(notesDetails).toContainText("now at /recipes/all/");
  await expect(notesDetails).toContainText('course "???"');
  // Hide, then Undo.
  await ready.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Hide this list" }).click();
  await expect(page.getByText("Hidden. Find “Get your site ready” to see it again.").first()).toBeVisible();
  expect(JSON.parse(readFileSync(join(root, ".openblog", "trade-checklist.json"), "utf8"))).toEqual({ dismissed: true });
  await ready.getByRole("button", { name: "Undo" }).click();
  await expect(ready.getByRole("heading", { name: "Get your site ready" })).toBeFocused();
  // Hidden survives a reload; Find brings it back.
  await ready.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Hide this list" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(page.locator(".studio-recipe-notes")).toBeVisible();
  await expect(page.locator(".studio-checklist h3")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Find a post or something to do…").fill("Get your site ready");
  await expect(page.locator("command-palette .palette-option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".studio-checklist").getByRole("heading", { name: "Get your site ready" })).toBeVisible();
});

test("Share this job: post to the connected Page once, copy the words, say I posted it with Undo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const sent = await mockSocial(page);
  await signIn(page, "#/share/posts%2Fmaple-roof.md");
  await expect(page).toHaveURL(new RegExp(`#/sharing/job/${JOB.replace("%", "%")}$`));
  await expect(page.getByRole("heading", { name: "Share this job", level: 2 })).toBeVisible();
  await expect(page.getByText("New roof on Maple Street. Post it where customers look.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Sharing" })).toHaveAttribute("href", "#/sharing");
  const facebook = page.locator("[data-destination=facebook]");
  await expect(facebook.getByText("Not yet")).toBeVisible();
  await facebook.getByRole("button", { name: "Post to Ridgeline Roofing" }).click();
  await expect(page.locator(".studio-job-share p[role=status]")).toHaveText("On its way to Ridgeline Roofing in about 5 minutes.");
  await expect(facebook.getByText("Going out")).toBeVisible();
  await expect(facebook.getByRole("button", { name: "Post to Ridgeline Roofing" })).toHaveCount(0, { timeout: 2000 });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ accountId: PAGE.id, work: "/maple-roof/", caption: expect.stringContaining("Roof replacement in Elkins, WV.") });
  expect(sent[0].idempotencyKey).toMatch(/^ob-[0-9a-f]{32}$/);
  expect(Date.parse(sent[0].scheduledFor) - Date.now()).toBeGreaterThan(3 * 60 * 1000);
  // Nextdoor, by hand.
  const nextdoor = page.locator("[data-destination=nextdoor]");
  await expect(nextdoor.getByRole("region", { name: "Words for Nextdoor" })).toContainText("A worn roof replaced before winter.");
  await nextdoor.getByRole("button", { name: "Copy the words for Nextdoor" }).click();
  await expect(page.locator(".studio-job-share p[role=status]")).toHaveText("Copied. Paste them into Nextdoor.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Roof replacement in Elkins, WV.");
  await expect(nextdoor.getByRole("link", { name: "Open Nextdoor (opens a new tab)" })).toHaveAttribute("target", "_blank");
  await nextdoor.getByRole("button", { name: "I posted it on Nextdoor" }).click();
  await expect(page.locator(".studio-job-share p[role=status]")).toHaveText("Noted: you posted it on Nextdoor.");
  await expect(nextdoor.getByText("You posted it")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(nextdoor.getByText("Not yet")).toBeVisible();
  expect(readFileSync(join(root, ".openblog", "job-shares.json"), "utf8")).not.toContain("nextdoor");
  // Google: by hand, with the Learn more line.
  await expect(page.locator("[data-destination=google-business-profile]").getByText("Add a Learn more button with the link, and the photo.")).toBeVisible();
  // Mark Nextdoor for good, for "Where each post went".
  await nextdoor.getByRole("button", { name: "I posted it on Nextdoor" }).click();
  await expect(nextdoor.getByText("You posted it")).toBeVisible();
});

test("Where each post went: a view of Sharing with its places, Check it, and the days", async ({ page }) => {
  await mockSocial(page);
  await signIn(page, "#/distribution");
  await expect(page).toHaveURL(/#\/sharing\?view=posts$/);
  await expect(page.getByRole("button", { name: "Where each post went", pressed: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Reached \d+ places? in the last 30 days$/ })).toBeVisible();
  const lesson = page.locator(".studio-where section", { hasText: "A lesson that travels" });
  await expect(lesson.getByText("Bluesky, @ridgeline ·")).toBeVisible();
  await expect(lesson.locator("[data-destination=bluesky]").getByText("Shared", { exact: true })).toBeVisible();
  await lesson.locator("[data-destination=bluesky] summary").click();
  await expect(lesson.getByText("rests on: your word")).toBeVisible();
  // The job she posted by hand in the test before (the files are shared across tests).
  await expect(page.locator("[data-destination=nextdoor]").getByText("You posted it")).toBeVisible();
  // An unclear one links to its row in Going out, with Check it open.
  await lesson.getByRole("link", { name: "Check it: Facebook, Ridgeline Roofing" }).click();
  await expect(page).toHaveURL(/#\/sharing\?check=/);
  await expect(page.locator("side-sheet").getByText("Facebook didn't say whether it posted.", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  // Back to the view, then the last year.
  await page.goto(`${origin}/admin/studio/#/sharing?view=posts`);
  await page.getByRole("button", { name: /More for where each post went/ }).click();
  await page.getByRole("menuitem", { name: "Show the last year" }).click();
  await expect(page).toHaveURL(/#\/sharing\?view=posts&days=365$/);
  await expect(page.getByRole("heading", { name: /in the last year$/ })).toBeVisible();
  // The switch goes back to Going out.
  await page.getByRole("button", { name: "Going out" }).click();
  await expect(page).toHaveURL(/#\/sharing$/);
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
});

test("Write and Posts offer Share this job on a published job", async ({ page }) => {
  await mockSocial(page);
  await signIn(page, `#/write/${JOB}`);
  await expect(page.getByRole("link", { name: "Share this job" })).toHaveAttribute("href", `#/sharing/job/${JOB}?from=write`);
  await page.getByRole("link", { name: "Share this job" }).click();
  await expect(page.getByRole("link", { name: "Back to Write" })).toHaveAttribute("href", `#/write/${JOB}`);
  await page.goto(`${origin}/admin/studio/#/posts`);
  const row = page.locator(".studio-post-row", { hasText: "New roof on Maple Street" });
  await row.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name: "Share this job" }).click();
  await expect(page).toHaveURL(new RegExp(`#/sharing/job/${JOB}$`));
});

test("Home, Share this job and Where each post went pass axe at 320 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockSocial(page);
  for (const hash of ["#/", `#/sharing/job/${JOB}`, "#/sharing?view=posts"]) {
    await signIn(page, hash);
    await expect(page.locator(".studio-page h2").first()).toBeVisible();
    if (hash === "#/") await expect(page.locator(".studio-recipe-notes")).toBeVisible();
    if (hash.includes("/job/")) await expect(page.locator("[data-destination=nextdoor]")).toBeVisible();
    if (hash.endsWith("view=posts")) await expect(page.locator(".studio-where h3")).toBeVisible();
    await axeClean(page, "main", hash);
  }
  expect(await page.locator("img[src=x]").count()).toBe(0);
});

test("Share this job: after the job changed, the post buttons come back, and Undo puts back the earlier mark", async ({ page }) => {
  await mockSocial(page);
  // A job that isn't there offers nothing to open.
  await signIn(page, "#/sharing/job/posts%2Fgone.md");
  const banner = page.locator(".studio-job-share alert-banner");
  await expect(banner).toContainText("Your blog couldn't find this job. It may have been deleted or renamed.");
  await expect(page.getByRole("link", { name: "Open it in Write" })).toHaveCount(0);
  await expect(banner.getByRole("button", { name: "Try again" })).toHaveCount(0);
  // Nextdoor was marked earlier; then she changed the job's words.
  const file = join(root, "content", "posts", "maple-roof.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("A worn roof replaced before winter.", "A worn roof replaced before the snow."));
  const before = JSON.parse(readFileSync(join(root, ".openblog", "job-shares.json"), "utf8")).jobs["posts/maple-roof.md"].nextdoor;
  expect(before.status).toBe("posted-by-hand");
  await page.evaluate(() => { location.hash = "#/sharing/job/posts%2Fmaple-roof.md"; });
  const nextdoor = page.locator("[data-destination=nextdoor]");
  await expect(nextdoor.getByText("You changed the job since. Post the new words if you like.")).toBeVisible();
  await expect(nextdoor.getByRole("button", { name: "Copy the words for Nextdoor" })).toBeVisible();
  await expect(nextdoor.getByRole("link", { name: "Open Nextdoor (opens a new tab)" })).toBeVisible();
  await nextdoor.getByRole("button", { name: "I posted it on Nextdoor" }).click();
  await expect(page.locator(".studio-job-share p[role=status]")).toHaveText("Noted: you posted it on Nextdoor.");
  await expect(nextdoor.getByText("You changed the job since.")).toHaveCount(0);
  // Undo takes back only the new mark, and the earlier one is there again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".studio-job-share p[role=status]")).toHaveText("Undone. Nextdoor is back to how it was.");
  await expect(nextdoor.getByText("You changed the job since. Post the new words if you like.")).toBeVisible();
  expect(JSON.parse(readFileSync(join(root, ".openblog", "job-shares.json"), "utf8")).jobs["posts/maple-roof.md"].nextdoor).toEqual(before);
});

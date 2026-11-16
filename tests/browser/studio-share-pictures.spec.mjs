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

// The worker keeps Studio's files; a page it controls sends its requests past page.route, so the
// stand-ins for the hosted social function here would be skipped.
test.use({ serviceWorkers: "block", viewport: { width: 400, height: 800 } });

// #656: the pictures that go with a share. Share a post shows the exact picture each Bluesky,
// LinkedIn or Facebook account would get, with its description, before she chooses to send it, and
// only then does the share carry the approval; Share this job sends a finished job's after photo to a
// Facebook Page only once she has described it, seen it and said yes. The hosted social function is
// stood in for at the Admin API; the job and its photo are the real server's.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const key = randomBytes(24).toString("hex");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsAlDCYqRhQw4mvRvpvpExGKxWCwWi8VisVj8N16B+mj7BBLoxAAAAABJRU5ErkJggg==", "base64");
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
let root;
let server;
let origin;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-pictures-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  cpSync(join(repository, "themes", "paper"), join(root, "themes", "paper"), { recursive: true });
  const configPath = join(root, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.business = { trade: "roofing" };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  mkdirSync(join(root, "static", "images"), { recursive: true });
  writeFileSync(join(root, "static", "images", "roof-after.png"), PNG);
  writeFileSync(join(root, "content", "posts", "maple-roof.md"), [
    "---", "title: New roof on Maple Street", "date: 2026-10-21", "description: A worn roof replaced before winter.", "profile: job", "job:",
    "  trade: roofing", "  service: roof-replacement", "  place:", "    town: Elkins", "    region: WV", "  started: 2026-10-14", "  finished: 2026-10-16",
    "  media:", "    after:", "      - /images/roof-after.png",
    "---", "Tore off the old shingles and laid new ones.", ""].join("\n"));
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
const SKY = { id: UUID(22), provider: "bluesky", displayName: "@ridgeline.example" };
const LINKEDIN = { id: UUID(23), provider: "linkedin", displayName: "Ridgeline on LinkedIn", kind: "person" };

/** The hosted social function: three connected accounts, previews of the cover, and what was sent. */
async function mockSocial(page) {
  const sent = [];
  const previews = [];
  await page.route("**/admin/api/social/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/admin/api/social/", "");
    const method = route.request().method();
    const body = route.request().postDataJSON?.() ?? null;
    if (path === "destinations") return json(route, 200, { destinations: [PAGE, SKY, LINKEDIN] });
    if (path === "posts") return json(route, 200, { posts: [{ work: "/portable-lesson/", title: "Portable lesson", eligible: true }] });
    if (path === "announcements/health") return json(route, 200, { health: { installed: true, alerts: [] } });
    if (path === "announcements" && method === "GET") return json(route, 200, { announcements: [] });
    if (path === "announcements/media-preview") {
      previews.push(body);
      const resized = body.accountId === SKY.id;
      return json(route, 200, { media: { approvalDigest: `approved-${body.accountId}-${body.fallback || "text"}`, snapshot: { description: "The lesson's cover: a chalkboard", version: resized ? 2 : 1 } }, imageDataUrl: DATA_URL });
    }
    if (path === "job-photo-preview") {
      previews.push(body);
      return json(route, 200, { approvalDigest: `photo-${body.description.length}`, description: body.description, imageDataUrl: DATA_URL });
    }
    if (path === "announcements" && method === "POST") {
      sent.push({ route: path, ...body });
      return json(route, 200, { announcement: { id: UUID(60 + sent.length), version: 1, work: body.work, caption: body.caption, status: "scheduled", delivery: "pending", scheduledFor: body.scheduledFor, destination: PAGE }, replayed: false });
    }
    if (path === "job-photo-schedule") {
      sent.push({ route: path, ...body });
      return json(route, 200, { announcement: { id: UUID(80), version: 1, work: "/maple-roof/", status: "scheduled", delivery: "pending", scheduledFor: body.scheduledFor, destination: PAGE }, replayed: false });
    }
    if (path === "preview") return json(route, 200, { ok: true, problems: [] });
    return json(route, 404, { error: "not found" });
  });
  return { sent, previews };
}

async function axeClean(page, selector, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), selector);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

test("Share a post: each account's picture is shown as it goes, and only the one she said yes to goes with it", async ({ page }) => {
  const { sent, previews } = await mockSocial(page);
  await signIn(page, "#/sharing/new");
  await expect(page.getByRole("heading", { name: "Share a post", level: 2 })).toBeVisible();
  const pictures = page.locator(".studio-share-pictures");
  await expect(pictures.getByRole("heading", { name: "The picture that goes with it" })).toBeVisible();
  // Bluesky: shown as it goes (made smaller), no description goes, then she says yes.
  const sky = pictures.locator(`[data-account="${SKY.id}"]`);
  await expect(sky.getByRole("combobox", { name: "If the picture can't go" })).toHaveCount(0);
  await sky.getByRole("button", { name: /^Show the picture that goes to/ }).click();
  await expect(sky.locator("img.studio-share-picture")).toHaveAttribute("alt", "The lesson's cover: a chalkboard");
  await expect(sky.getByText("Bluesky shows it with no description.", { exact: false })).toBeVisible();
  await expect(sky.getByText("Made smaller to fit Bluesky. This is exactly what goes.")).toBeVisible();
  await sky.getByRole("switch", { name: /^Send this picture to/ }).click();
  // LinkedIn: what happens if it can't go is hers to choose, and choosing again asks to look again.
  const linkedin = pictures.locator(`[data-account="${LINKEDIN.id}"]`);
  await linkedin.getByRole("button", { name: /^Show the picture that goes to/ }).click();
  await expect(linkedin.getByText("The description goes with it, for people who can't see it.")).toBeVisible();
  await linkedin.getByRole("combobox", { name: "If the picture can't go" }).selectOption("stop");
  await expect(linkedin.locator("img")).toHaveCount(0);
  await axeClean(page, ".studio-share-new", "Share a post with pictures");
  await page.getByRole("button", { name: "Share it" }).click();
  await expect(page).toHaveURL(/#\/sharing$/);
  expect(previews.find((p) => p.accountId === SKY.id)).toEqual({ accountId: SKY.id, work: "/portable-lesson/" });
  expect(previews.filter((p) => p.accountId === LINKEDIN.id).map((p) => p.fallback)).toEqual(["text"]);
  const byAccount = Object.fromEntries(sent.map((s) => [s.accountId, s]));
  expect(byAccount[SKY.id].media).toEqual({ approvalDigest: `approved-${SKY.id}-text`, snapshot: { description: "The lesson's cover: a chalkboard", version: 2 } });
  expect(byAccount[LINKEDIN.id].media).toBeUndefined();
  expect(byAccount[PAGE.id].media).toBeUndefined();
});

test("Share this job: the after photo goes to the Page only after she describes it, sees it and says yes", async ({ page }) => {
  const { sent, previews } = await mockSocial(page);
  await signIn(page, "#/sharing/job/posts%2Fmaple-roof.md");
  const facebook = page.locator("[data-destination=facebook]");
  await expect(facebook.getByText("The photo that goes to Ridgeline Roofing")).toBeVisible();
  // Post first: it says what's missing, and nothing goes.
  await facebook.getByRole("button", { name: "Post to Ridgeline Roofing" }).click();
  await expect(facebook.getByText("Describe the photo, look at what goes, and choose Send this photo first.")).toBeVisible();
  await facebook.getByRole("button", { name: "Show what goes" }).click();
  await expect(facebook.getByText("Describe the photo first.")).toBeVisible();
  await facebook.getByRole("textbox", { name: "Describe the photo" }).fill("New charcoal shingles on a two-storey house");
  await facebook.getByRole("button", { name: "Show what goes" }).click();
  await expect(facebook.locator("img.studio-share-picture")).toHaveAttribute("alt", "New charcoal shingles on a two-storey house");
  await facebook.getByRole("switch", { name: "Send this photo and description" }).click();
  await axeClean(page, ".studio-job-share", "Share this job with a photo");
  await facebook.getByRole("button", { name: "Post to Ridgeline Roofing" }).click();
  await expect(page.locator(".studio-job-share p[role=status]")).toHaveText("On its way to Ridgeline Roofing in about 5 minutes.");
  expect(previews.at(-1)).toMatchObject({ path: "posts/maple-roof.md", description: "New charcoal shingles on a two-storey house" });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ route: "job-photo-schedule", path: "posts/maple-roof.md", accountId: PAGE.id, approvalDigest: "photo-43", description: "New charcoal shingles on a two-storey house", digest: previews.at(-1).digest });
  expect(sent[0].idempotencyKey).toMatch(/^ob-[0-9a-f]{32}$/);
  expect(sent[0].work).toBeUndefined();
});

import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Your route (Studio R7): a route file is read on the phone with no signal and nothing sent; every
// route starts hidden; the drawings show exactly what readers will see; the exact route asks once
// and goes cleaned, held privately until the post is live (G47); Take the route off has Undo.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let dir;
let child;
let origin;

const TRIP = "---\ntitle: Ridge walk\ndate: 2026-10-05\ndraft: true\nprofile: field-journal\nlocation: North woods\nconditions: Dry and windy\ntags: [walks]\n---\n\nA good day out.\n";

/** A walk north of about 3 km with heights, times, a waypoint at home and the watch's details. */
function routeFile() {
  const points = [];
  for (let i = 0; i <= 30; i += 1) {
    points.push(`<trkpt lat="${(42 + i * 0.0009).toFixed(6)}" lon="-72.000000"><ele>${100 + i * 2}</ele><time>2026-10-05T10:${String(i).padStart(2, "0")}:00Z</time><extensions><hr>120</hr></extensions></trkpt>`);
  }
  return `<?xml version="1.0"?><gpx version="1.1" creator="Watch 9000 serial 77"><metadata><name>Home loop</name><time>2026-10-05T10:00:00Z</time></metadata><wpt lat="41.99" lon="-72.01"><name>My house</name></wpt><trk><name>Morning</name><trkseg>${points.join("")}</trkseg></trk></gpx>`;
}

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block", timezoneId: "America/New_York" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "openblog-route-"));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: "Sam Walker", url: "https://walker.example" };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(join(dir, "ridge.gpx"), routeFile());
  execFileSync(binary, ["user", "add", "sam", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }
  removeTree(dir);
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
});

async function open(page, hash) {
  if (page.url().startsWith(origin)) await page.goto("about:blank");
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("sam");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

async function openPost(page, file, text) {
  if (text !== undefined) writeFileSync(join(dir, "content", "posts", file), text);
  await open(page, `#/write/${encodeURIComponent(`posts/${file}`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

const fileOf = (file) => readFileSync(join(dir, "content", "posts", file), "utf8");
const sheet = (page) => page.locator("side-sheet.studio-ready-sheet dialog").filter({ has: page.getByRole("heading", { name: "Your route", level: 2 }) }).first();
const choice = (page, name) => sheet(page).getByRole("radio", { name, exact: true });
const walk = (root) => (existsSync(root) ? readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith(".gpx")) : []);

async function axeClean(page, label, root) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
  await page.setViewportSize({ width: 400, height: 800 });
}

test("a route file is read with no signal, starts hidden, and the drawings show what readers will see", async ({ page, context }) => {
  const file = "2026-10-05-ridge.md";
  await openPost(page, file, TRIP);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Add your route" }).click();
  await expect(sheet(page)).toBeVisible();
  const sent = [];
  page.on("request", (request) => { if (!request.url().startsWith("data:")) sent.push(request.url()); });
  await context.setOffline(true);
  await sheet(page).locator("file-drop input[type=file]").setInputFiles(join(dir, "ridge.gpx"));
  await expect(sheet(page).getByText("From “ridge.gpx”:")).toBeVisible();
  await expect(sheet(page)).toContainText(/3(\.\d+)? km · 60 m climb · 30 min/);
  expect(sent.filter((url) => url.includes("/api/")), "reading the file sends nothing").toEqual([]);
  await expect(choice(page, "Don't show it")).toBeChecked();
  await expect(sheet(page).getByRole("img")).toHaveCount(0);
  await expect(sheet(page).getByText(/^Readers see the numbers only: 3(\.\d+)? km/)).toBeVisible();
  await expect(sheet(page).getByRole("switch", { name: "Show a drawing of the climb" })).not.toBeChecked();

  await choice(page, "The shape, without where it starts and ends").check();
  await expect(sheet(page).getByRole("combobox", { name: "Leave off at each end" })).toHaveValue("500");
  await expect(sheet(page).getByRole("img", { name: "Drawing of your route as readers see it, without the first and last 500 m" })).toBeVisible();
  await expect(sheet(page).getByRole("img", { name: "Drawing of the climb" })).toBeVisible();
  await axeClean(page, "Your route", "side-sheet.studio-ready-sheet");

  // The exact route asks once; Keep it hidden (focused) leaves the choice as it was.
  await choice(page, "The exact route").check();
  const ask = page.locator("modal-dialog").filter({ hasText: "Show the exact route?" });
  await expect(ask).toContainText("Times and your app's details are taken out first.");
  await expect(ask.getByRole("button", { name: "Keep it hidden" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(choice(page, "The shape, without where it starts and ends")).toBeChecked();
  await context.setOffline(false);

  // Use this route: the values are written, and a draft save keeps no shape it shouldn't.
  await sheet(page).getByRole("button", { name: "Use this route" }).click();
  await expect(sheet(page).locator(".studio-ready-did")).toContainText("Route added. Route: readers see a drawing without the first and last 500 m.");
  await expect.poll(() => fileOf(file), { timeout: 10000 }).toContain("locationPrivacy: trimmed");
  const saved = fileOf(file);
  expect(saved).toMatch(/distanceKm: "?3/);
  expect(saved).toContain("elevationGainM: ");
  expect(saved).toContain("duration: 30 min");
  expect(saved).toContain("routeShape: ");
  expect(saved).not.toMatch(/42\.0|-72\.0/, "no position is written");
  // Undo puts every key back.
  await sheet(page).locator(".studio-ready-did").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => fileOf(file), { timeout: 10000 }).not.toContain("routeShape");
  expect(fileOf(file)).not.toContain("distanceKm");
});

test("the exact route goes cleaned, held privately on a draft or a scheduled post, and public only once live", async ({ page }) => {
  const file = "2026-10-06-peak.md";
  await openPost(page, file, TRIP.replace("Ridge walk", "Peak walk").replace("2026-10-05", "2026-10-06"));
  const uploads = [];
  const saves = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/track-upload") && request.method() === "POST") uploads.push(request.postData() || "");
    if (request.url().includes("/api/document") && ["PUT", "POST"].includes(request.method())) saves.push(request.postDataJSON());
  });
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Add your route" }).click();
  await sheet(page).locator("file-drop input[type=file]").setInputFiles(join(dir, "ridge.gpx"));
  await expect(sheet(page).getByText(/only the numbers go to your blog, and a drawing of the climb if you switch it on\./)).toBeVisible();
  await choice(page, "The exact route").check();
  await page.locator("modal-dialog").getByRole("button", { name: "Show it" }).click();
  await expect(choice(page, "The exact route")).toBeChecked();
  await expect(sheet(page).getByText("Readers can download it.")).toBeVisible();
  // What the sheet says goes is true for the choice: the cleaned file goes too.
  await expect(sheet(page).getByText(/a cleaned copy of the route file goes to your blog too, times and your app's details taken out\./)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Use this route" }).click();
  await expect(sheet(page).locator(".studio-ready-did")).toContainText("Your route file waits, private, until your post is on your site.");
  // Cleaned on the phone before it left: no times, waypoints, names or the watch's details.
  expect(uploads).toHaveLength(1);
  for (const gone of ["<time", "<wpt", "<metadata", "<extensions", "<name", "Watch 9000", "My house"]) expect(uploads[0]).not.toContain(gone);
  // A draft save sends the token (G47): the server holds the file privately.
  await expect.poll(() => fileOf(file), { timeout: 10000 }).toContain("route: /tracks/uploads/");
  expect(saves.some((body) => body.trackToken)).toBe(true);
  const route = fileOf(file).match(/route: (\/tracks\/uploads\/\S+)/)[1];
  expect(walk(join(dir, "static", "tracks"))).toEqual([]);
  expect(walk(join(dir, "dist", "tracks")), "a draft's route file is never in the built site").toEqual([]);
  expect(walk(join(dir, ".openblog", "pending-tracks", "held")).length).toBe(1);
  const held = readFileSync(join(dir, ".openblog", "pending-tracks", "held", route.replace("/tracks/uploads/", "")), "utf8");
  expect(held).not.toContain("<time");
  // Schedule is allowed: no note keeps it from a day to come.
  await expect(page.getByText(/can't be scheduled/)).toHaveCount(0);
  // Publish: the file goes up with the post.
  await page.keyboard.press("Escape");
  await page.locator(".studio-write-bar").getByRole("button", { name: "Publish" }).click();
  const readySheet = page.locator("side-sheet.studio-ready-sheet dialog").filter({ has: page.getByRole("heading", { name: "Before you publish", level: 2 }) });
  await expect(readySheet).toBeVisible();
  await expect(readySheet.getByText(/Readers can see exactly where you started and finished/)).toBeVisible();
  await readySheet.locator("[slot=actions]").getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => fileOf(file), { timeout: 10000 }).not.toContain("draft: true");
  await expect.poll(() => existsSync(join(dir, "static", route.slice(1)))).toBe(true);
  await expect.poll(() => existsSync(join(dir, "dist", route.slice(1)))).toBe(true);
});

test("Take the route off clears it, and Undo puts it back", async ({ page }) => {
  const file = "2026-10-07-loop.md";
  await openPost(page, file, `${TRIP.replace("Ridge walk", "Loop").replace("2026-10-05", "2026-10-07").replace("tags:", "distanceKm: 4.2\nlocationPrivacy: approximate\nrouteShape: 0,10 500,50 1000,90\ntags:")}`);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Change your route" }).click();
  await expect(choice(page, "The whole shape")).toBeChecked();
  await expect(sheet(page).getByRole("img", { name: "Drawing of your route as readers see it, the whole route" })).toBeVisible();
  // More needs the file; less works at once.
  await choice(page, "The exact route").check();
  await page.locator("modal-dialog").getByRole("button", { name: "Show it" }).click();
  await expect(sheet(page).getByText("Choose your route file again to show it this way.")).toBeVisible();
  await expect(choice(page, "The whole shape")).toBeChecked();
  await choice(page, "Don't show it").check();
  await expect.poll(() => fileOf(file), { timeout: 10000 }).toContain("locationPrivacy: hidden");
  expect(fileOf(file)).not.toContain("routeShape");
  await sheet(page).locator(".studio-ready-did").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => fileOf(file), { timeout: 10000 }).toContain("routeShape: 0,10 500,50 1000,90");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take the route off" }).click();
  await expect.poll(() => fileOf(file), { timeout: 10000 }).not.toContain("distanceKm");
  await sheet(page).locator(".studio-ready-did").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => fileOf(file), { timeout: 10000 }).toContain("distanceKm: 4.2");
});

test("Where refuses a street address with words on the field, and nothing saves until it's an area", async ({ page }) => {
  const file = "2026-10-08-where.md";
  await openPost(page, file, TRIP.replace("Ridge walk", "Where walk"));
  await page.getByRole("button", { name: /^About this post:/ }).click();
  const where = page.getByRole("textbox", { name: "Where", exact: true });
  await where.fill("12 Laurel Lane");
  await where.press("Tab");
  await expect(page.locator(".studio-write > [role=status]")).toContainText("Not saved yet: one thing in About this post needs a look.", { timeout: 8000 });
  await page.waitForTimeout(3500);
  expect(fileOf(file), "an address never reaches the file").not.toContain("Laurel");
  // The words sit on the field itself, in the open sheet.
  await expect(page.locator("text-field").filter({ has: where }).getByText("Just an area's name, not a street address or a house number.")).toBeVisible();
  await where.fill("Dolly Sods");
  await expect.poll(() => fileOf(file), { timeout: 10000 }).toContain("location: Dolly Sods");
});

test("Your trip in Before you publish: every button has its own name", async ({ page }) => {
  await openPost(page, "2026-10-09-names.md", TRIP.replace("Ridge walk", "Names walk"));
  await page.getByRole("button", { name: /^Before you publish:/ }).click();
  const trip = page.locator("side-sheet.studio-ready-sheet section.studio-ready-trip");
  await expect(trip.getByRole("button", { name: /^Add your route: / })).toBeVisible({ timeout: 15000 });
  const names = await trip.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label") || b.textContent.trim()));
  expect(names.length).toBeGreaterThan(1);
  expect(new Set(names).size, names.join(" | ")).toBe(names.length);
});

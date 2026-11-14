import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio's words (docs/studio-words.md): Grammi's House names Mikey and signs cards with love
// through `studio.words`, with one mistake; a plain site gets the built-in words. Her layer shows
// the site's words and never a problem; Home's details list what changed and what was dropped;
// a change carrying markup is shown as text; axe stays clean.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const key = randomBytes(16).toString("hex");
const RICKY = "11111111-1111-4111-8111-111111111111";

const GRAMMI = {
  vars: { helper: "Mikey", owner: "Grammi" },
  text: {
    "cards.signOff": "Love, {owner}",
    "recipe.notesHeading": "{owner}'s notes",
    "decorations.everyday": "Your house is wearing its everyday look: {theme}.",
    "decorations.decorated": "Your house is decorated for {theme}.",
    "common.ask": "Ask <b>{helper}</b>.",
    "card.signoff": "Love",
  },
};

test.use({ viewport: { width: 400, height: 800 }, serviceWorkers: "block" });

const sites = {};
let fake;

async function startSite(name, words) {
  const dir = mkdtempSync(join(tmpdir(), `openblog-words-${name}-`));
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  const configPath = join(dir, "openblog.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.author = { ...(config.author || {}), name: name === "grammi" ? "Grammi" : "" };
  if (words) config.studio = { words };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  const env = { ...process.env, OPENBLOG_GREETINGS_ENDPOINT: `http://127.0.0.1:${fake.address().port}/api/greetings`, OPENBLOG_GREETINGS_ADMIN_KEY: key };
  delete env.OPENBLOG_STUDIO_WORDS_PATH;
  const child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const origin = `http://127.0.0.1:${port}`;
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
  sites[name] = { dir, child, origin };
}

test.beforeAll(async () => {
  fake = createHttpServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${key}`) return reply(401, { error: "unauthorized" });
    const path = req.url.replace(/^\/api\/greetings\/?/, "").split("?")[0];
    if (path === "status") return reply(200, { timeZone: "America/New_York", from: { name: "Grammi", email: "grammi@example.com" }, designs: [{ id: "birthday", label: "Birthday", subject: "Happy birthday, {name}!" }, { id: "just-because", label: "Just because", subject: "Thinking of you" }] });
    if (path === "contacts") return reply(200, { contacts: [{ id: RICKY, name: "Ricky", email: "ricky@example.com", birthday: "1990-09-07" }] });
    if (path === "cards") return reply(200, { cards: [] });
    return reply(404, { error: "not-found" });
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  await startSite("grammi", GRAMMI);
  await startSite("plain", null);
});

test.afterAll(async () => {
  for (const { child, dir } of Object.values(sites)) {
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
    removeTree(dir);
  }
  fake?.close();
});

async function open(page, site, hash) {
  await page.goto(`${sites[site].origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

const homeDetails = (page) => page.locator(".studio-health details");

test("Grammi's House: her screens say Mikey, and Home's details list the words and the one mistake", async ({ page }) => {
  await open(page, "grammi", "#/");
  const details = homeDetails(page);
  await expect(details.locator("summary")).toHaveText("For Mikey");
  // A problem is never on her layer: only inside the closed details.
  await expect(page.getByText("card.signoff isn't a word id. Did you mean cards.signOff?")).toBeHidden();
  await details.locator("summary").click();
  const words = details.locator(".studio-health-words");
  await expect(words.getByRole("heading", { name: "Words" })).toBeVisible();
  await expect(words).toContainText("6 changed by this site.");
  await expect(words).toContainText("cards.signOff: Love, {owner} (site)");
  await expect(words).toContainText("helper: Mikey (site)");
  await expect(words.getByText("card.signoff isn't a word id. Did you mean cards.signOff?")).toBeVisible();
  // The server dropped the change with markup, said why, and nothing here is ever markup.
  await expect(words).not.toContainText("common.ask: ");
  await expect(words.getByText("common.ask has < or >, and words are shown as text only.")).toBeVisible();
  expect(await page.locator("#studio-main b").count()).toBe(0);
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("#studio-main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => v.id));
  expect(violations).toEqual([]);
});

test("Grammi's House: a new card starts \"Love, Grammi\"", async ({ page }) => {
  await open(page, "grammi", "#/cards");
  await page.locator(".studio-card-people").getByRole("link", { name: "Write to Ricky" }).click();
  await expect(page.getByRole("heading", { name: "Write a card", level: 2 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Sign it" })).toHaveValue("Love, Grammi");
});

test("a site with no words of its own gets the built-in words, and no Words in Home's details", async ({ page }) => {
  await open(page, "plain", "#/");
  const details = homeDetails(page);
  await expect(details.locator("summary")).toHaveText("For the person who set up your site");
  await details.locator("summary").click();
  await expect(details.locator(".studio-health-words")).toHaveCount(0);
  await open(page, "plain", "#/cards");
  await page.locator(".studio-card-people").getByRole("link", { name: "Write to Ricky" }).click();
  await expect(page.getByRole("textbox", { name: "Sign it" })).toHaveValue("");
});

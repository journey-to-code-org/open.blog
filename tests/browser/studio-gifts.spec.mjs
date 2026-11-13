import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Studio slice 3b: Gifts. A stand-in gifts service (the real one is netlify/functions/gifts.mjs) holds
// one wrapped gift and one ready to open. Gifts shows in the navigation only when it's set up, says
// what's waiting, opens a gift into its card, takes one off the tree, turns names off, and passes
// axe at 320 px.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;
let fake;
const giftsKey = randomBytes(24).toString("hex");

test.beforeAll(async () => {
  const gifts = [
    { id: "11111111-1111-4111-8111-111111111111", from: "Ava", showName: true, kind: "note", wrap: "plaid", createdAt: "2026-11-13T08:00:00Z", opensAt: "2026-12-25T05:00:00Z", canOpen: false, opened: false, openedAt: null, onTree: true },
    { id: "22222222-2222-4222-8222-222222222222", from: "Uncle Jim", showName: false, kind: "card", wrap: "gold", createdAt: "2026-11-12T08:00:00Z", opensAt: "2026-11-12T05:00:00Z", canOpen: true, opened: false, openedAt: null, onTree: true },
  ];
  const contents = { "22222222-2222-4222-8222-222222222222": { card: { design: "holly", message: "Save me some pie", signOff: "Jim", stickers: [{ kind: "star", x: 20, y: 30 }] } } };
  let showNames = true;
  let familyCode = "Pumpkin Pie";
  fake = createHttpServer((req, res) => {
    const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${giftsKey}`) return reply(401, { error: "unauthorized" });
    const path = req.url.replace("/api/gifts/admin/", "");
    if (path === "list") return reply(200, { gifts, showNames, familyCode, opensAt: "2026-12-25T05:00:00Z" });
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (path === "settings") {
        const change = JSON.parse(body);
        if ("showNames" in change) showNames = change.showNames;
        if ("familyCode" in change) familyCode = change.familyCode;
        return reply(200, { showNames, familyCode });
      }
      const [id, action] = path.split("/");
      const gift = gifts.find((g) => g.id === id);
      if (!gift) return reply(404, { error: "not-found" });
      if (action === "open") {
        if (!gift.canOpen) return reply(423, { error: "not-yet", opensAt: gift.opensAt });
        Object.assign(gift, { opened: true, openedAt: "2026-11-13T09:00:00Z" }, contents[id]);
        return reply(200, { gift });
      }
      if (action === "hide" || action === "show") { gift.onTree = action === "show"; return reply(200, { gift }); }
      return reply(404, { error: "not-found" });
    });
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  root = mkdtempSync(join(tmpdir(), "openblog-studio-gifts-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe", env: { ...process.env, OPENBLOG_GIFTS_ENDPOINT: `http://127.0.0.1:${fake.address().port}/api/gifts`, OPENBLOG_GIFTS_ADMIN_KEY: giftsKey } });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  fake?.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  removeTree(root);
});

async function signIn(page, hash = "#/gifts") {
  await page.goto(`${origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

test("Gifts says what's waiting, keeps a wrapped gift wrapped, and opens one that's ready into its card", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("link", { name: "Gifts" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Merry Christmas! 1 gift to open/ })).toBeVisible();
  await expect(page.getByText("Wrapped until Christmas")).toBeVisible();
  await expect(page.getByText(/This name is hidden on your tree/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Ava's gift" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open the next gift (from Uncle Jim)" }).click();
  await expect(page.getByRole("img", { name: /A card from Uncle Jim: Save me some pie, signed Jim/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uncle Jim" })).toBeFocused();
  await expect(page.getByRole("button", { name: /Open the next gift/ })).toBeHidden();
});

test("taking a gift off the tree asks first and keeps it; names can be turned off", async ({ page }) => {
  await signIn(page);
  const ava = page.locator(".studio-gift", { hasText: "Ava" });
  await ava.getByRole("button", { name: "Take it off the tree" }).click();
  await page.getByRole("button", { name: "Take it off the tree" }).last().click();
  await expect(ava.getByText("Not on your tree. It's kept here.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ava" })).toBeFocused();
  await ava.getByRole("button", { name: "Put it back on the tree" }).click();
  await expect(ava.getByRole("button", { name: "Take it off the tree" })).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Show who each gift is from on your tree" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(ava.getByText("Names are turned off on your tree", { exact: false })).toBeVisible();
});

test("the family password shows on Gifts and can be changed", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("Pumpkin Pie")).toBeVisible();
  await page.getByRole("button", { name: "Change it" }).click();
  const field = page.getByRole("textbox", { name: "New family password" });
  await expect(field).toBeFocused();
  await field.fill("abc");
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(page.getByText("Use at least 6 letters or numbers.")).toBeVisible();
  await field.fill("Snowy Owl 2026");
  await page.getByRole("button", { name: "Save the new password" }).click();
  await expect(page.getByText("Snowy Owl 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change it" })).toBeFocused();
});

test("Gifts passes axe at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page);
  await expect(page.locator(".studio-gift").first()).toBeVisible();
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => (await window.axe.run(document.querySelector(".studio-gifts"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(results).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

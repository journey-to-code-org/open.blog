import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// A theme component's `places` setting in Studio (ADR 0434), against a real server: the owner hangs
// things on a picture by tapping it, picks one up and drags it, does the same from the keyboard,
// takes one off, and what is saved is exactly the list of spots the server allows. axe at 320 px.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
let root;
let server;
let origin;
let original;

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-studio-places-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  for (const theme of ["paper", "demo"]) cpSync(join(repository, "themes", theme), join(root, "themes", theme), { recursive: true });
  const configPath = join(root, "openblog.json");
  const text = readFileSync(configPath, "utf8");
  const close = text.lastIndexOf("}");
  // Two seasons laid out the way an owner writes them: documented key order, one window per object.
  original = `${text.slice(0, close).trimEnd()},\n  "seasons": {\n    "version": 1,\n    "enabled": true,\n    "windows": [\n      {\n        "theme": "paper",\n        "start": "11-01",\n        "end": "01-06"\n      },\n      {\n        "theme": "demo",\n        "start": "07-01",\n        "end": "07-31"\n      }\n    ]\n  }\n}\n`;
  writeFileSync(configPath, original);
  mkdirSync(join(root, "themes", "toyland"), { recursive: true });
  writeFileSync(join(root, "themes", "toyland", "tree.js"), "customElements.define('little-tree', class extends HTMLElement {});\n");
  const art = (inside) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120">${inside}</svg>\n`;
  writeFileSync(join(root, "themes", "toyland", "tree.svg"), art('<path d="M50 5 95 100H5Z" fill="#2f6b3f"/><path d="M44 100h12v18H44z" fill="#7a4a26"/>'));
  writeFileSync(join(root, "themes", "toyland", "star.svg"), art('<circle cx="50" cy="60" r="45" fill="#f2c14e"/>'));
  writeFileSync(join(root, "themes", "toyland", "theme.json"), JSON.stringify({
    label: "Toyland", extends: "paper",
    components: { "little-tree": { label: "Little tree", description: "A tree you decorate.", script: "tree.js", fallback: "A little tree.",
      props: [{ name: "hung", type: "places", label: "What hangs on it", picture: "tree.svg", max: 3, default: "star@50,20",
        choices: [{ value: "star", label: "Star", image: "star.svg" }, { value: "red-ball", label: "Red ball" }] }] } },
  }));
  // The theme's own things are offered when every look the site wears has them: one look here.
  writeFileSync(configPath, text.replace(/^\{/, '{\n  "theme": "toyland",'));
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

const landing = () => JSON.parse(readFileSync(join(root, "content", "landing.json"), "utf8"));

async function signIn(page) {
  await page.goto(`${origin}/admin/studio/#/front-page`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.locator("#studio-landing-h")).toBeVisible();
}

// Empty until the page has been saved once.
const hung = () => { try { return landing().sections.find((section) => section.tag === "little-tree")?.props?.hung ?? ""; } catch { return ""; } };

test("she hangs things on the picture by tapping, dragging and from the keyboard, and it is saved as spots", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add a section" }).click();
  await page.getByRole("button", { name: /Little tree/ }).first().click();
  const editor = page.locator(".studio-places");
  const said = editor.getByRole("status");
  const picture = editor.locator(".studio-places-picture");
  await expect(editor.getByText("What hangs on it")).toBeVisible();
  // It starts with the component's own layout: one star at the top.
  await expect(editor.getByRole("button", { name: "Star, at the top" })).toBeVisible();
  await expect(picture.locator(".studio-places-thing")).toHaveCount(1);

  // Tap: choose Red ball, then the picture where it goes.
  await editor.getByRole("button", { name: "Red ball", exact: true }).click();
  await expect(said).toContainText("Red ball: now tap the picture where it goes");
  await picture.scrollIntoViewIfNeeded();
  let box = await picture.boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await expect(said).toHaveText("Red ball added at the bottom right.");
  await expect(editor.getByRole("button", { name: "Red ball, at the bottom right" })).toHaveAttribute("aria-pressed", "true");

  // Drag it to the left.
  await picture.scrollIntoViewIfNeeded();
  box = await picture.boundingBox();
  const ball = await picture.locator(".studio-places-thing").nth(1).boundingBox();
  await page.mouse.move(ball.x + ball.width / 2, ball.y + ball.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await expect(said).toHaveText("Red ball is on the left now.");

  // Keyboard: Shift and Enter adds one without pointing; the arrows move it; it holds three.
  const star = editor.getByRole("button", { name: "Star", exact: true });
  await star.focus();
  await page.keyboard.press("Shift+Enter");
  await expect(said).toHaveText("Star added in the middle.");
  await expect(editor.getByRole("button", { name: "Star", exact: true })).toBeDisabled();
  const added = editor.getByRole("button", { name: "Star, in the middle" });
  await added.focus();
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowDown");
  await expect(said).toHaveText("Star is at the bottom now.");
  // The buttons do the same for whichever is picked up.
  await editor.getByRole("button", { name: "Up", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Star, at the bottom" })).toBeFocused();

  // Take the first star off, from the keyboard.
  await editor.getByRole("button", { name: "Star, at the top" }).focus();
  await page.keyboard.press("Delete");
  await expect(said).toHaveText("Star taken off.");
  await expect(picture.locator(".studio-places-thing")).toHaveCount(2);
  await expect(editor.getByRole("button", { name: "Star", exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(axeSource);
  const found = await page.evaluate(async () => (await window.axe.run(document.querySelector(".studio-places"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`));
  expect(found).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

  await page.getByRole("button", { name: "Keep this change" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(hung).toMatch(/^red-ball@\d{1,3},\d{1,3};star@\d{1,3},\d{1,3}$/);
  const [, x, y] = /^red-ball@(\d+),(\d+)/.exec(hung());
  expect(Number(x)).toBeLessThan(34);
  expect(Number(y)).toBeGreaterThan(33);
  expect(Number(y)).toBeLessThan(67);

  // The published page carries the list as one attribute, and nothing else of hers.
  await expect.poll(async () => (await (await fetch(`${origin}/`)).text()).match(/<little-tree[^>]*>/)?.[0] || "", { timeout: 20000 }).toContain(`hung="${hung()}"`);
});

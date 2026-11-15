// Shared by the writing helper's browser specs (Studio R8): a site with one user, a server, and a
// guard that fails any test whose page reaches a helper route it didn't stub. No test ever calls a
// real provider: the site's helper points at an address that cannot resolve (.invalid), and every
// provider-backed route is answered by the test.
import { expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/** The routes that would reach a provider. A test stubs the ones it uses. */
export const PROVIDER_ROUTES = /\/admin\/api\/(assistant\/(review|complete|check|code-interaction|job-draft|voice-guide|theme-draft)|quiz\/generate)(\?|$)/;

export async function startSite(tag, { env: extra = {}, users = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `openblog-${tag}-`));
  const password = randomBytes(24).toString("hex");
  execFileSync(binary, ["init", dir, "--no-voice"], { stdio: "pipe" });
  for (const name of ["sam", ...users]) execFileSync(binary, ["user", "add", name, "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const site = { dir, password, origin: "", child: null, output: "" };
  await serve(site, extra);
  return site;
}

/**
 * Start (or start again, with other variables) the server for `site`. A new site says Getting
 * started is on (G80); every spec but Getting started's own runs with the server's switch off,
 * which wins over the site's file. `null` removes a variable.
 */
async function serve(site, extra = {}) {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  site.origin = `http://127.0.0.1:${port}`;
  // No provider key from the environment may leak into a test server.
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/_API_KEY$/.test(name))), OPENBLOG_STUDIO_ONBOARDING: "off", ...extra };
  for (const [name, value] of Object.entries(env)) if (value === null || value === undefined) delete env[name];
  const child = spawn(binary, ["serve", "--admin", "--root", site.dir, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
  site.child = child;
  child.stdout.on("data", (data) => { site.output += data; });
  child.stderr.on("data", (data) => { site.output += data; });
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${site.output}`);
    expect((await fetch(`${site.origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
}

/** Stop the server and start it again on the same site with other variables (a new address: sign in again). */
export async function restartSite(site, extra = {}) {
  if (site.child && site.child.exitCode === null) {
    const stopped = once(site.child, "exit");
    site.child.kill();
    await stopped;
  }
  await serve(site, extra);
}

export async function stopSite(site) {
  if (site?.child && site.child.exitCode === null) {
    const stopped = once(site.child, "exit");
    site.child.kill();
    await stopped;
  }
  if (site?.dir) removeTree(site.dir);
}

/** Fail the test if the page reaches a provider-backed route the test didn't answer itself. */
export async function guardProviders(page) {
  const unstubbed = [];
  await page.route(PROVIDER_ROUTES, (route) => {
    if (route.request().method() === "GET") return route.fallback();
    unstubbed.push(`${route.request().method()} ${route.request().url()}`);
    return route.fulfill({ status: 599, json: { error: "a test reached a provider route it did not stub" } });
  });
  return unstubbed;
}

export async function open(page, site, hash, user = "sam") {
  if (page.url().startsWith(site.origin)) await page.goto("about:blank");
  await page.goto(`${site.origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill(user);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(site.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(name).toHaveCount(0);
  }
}

export async function openPost(page, site, file, text) {
  if (text !== undefined) writeFileSync(join(site.dir, "content", "posts", file), text);
  await open(page, site, `#/write/${encodeURIComponent(`posts/${file}`)}`);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.locator(".studio-write")).not.toHaveAttribute("aria-busy", "true");
}

export const fileOf = (site, file) => readFileSync(join(site.dir, "content", "posts", file), "utf8");

/** The session's CSRF token, for a request the test makes itself. */
export async function csrf(page, site) {
  return (await (await page.request.get(`${site.origin}/admin/api/session`)).json()).csrf;
}

/**
 * Turn the helper on for the site, the way the screen does (a PUT from this computer): a custom
 * address that cannot resolve, so nothing a test forgets to stub can reach a real provider.
 */
export async function turnHelperOn(page, site, key = "test-key-not-real") {
  const token = await csrf(page, site);
  const settings = await (await page.request.get(`${site.origin}/admin/api/assistant/settings`)).json();
  const saved = await page.request.put(`${site.origin}/admin/api/assistant/settings`, {
    headers: { "X-CSRF-Token": token },
    data: { provider: "custom-https", generationEndpoint: "https://helper.invalid/v1", model: "test", etag: settings.etag, credentialAction: "replace", credential: key },
  });
  expect(saved.status(), await saved.text()).toBe(200);
}

/** The same, before any page exists: signs in with fetch and saves the settings from this computer. */
export async function turnHelperOnDirect(site, key = "test-key-not-real") {
  const login = await fetch(`${site.origin}/admin/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "sam", password: site.password }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const token = (await login.json()).csrf;
  const settings = await (await fetch(`${site.origin}/admin/api/assistant/settings`, { headers: { Cookie: cookie } })).json();
  const saved = await fetch(`${site.origin}/admin/api/assistant/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": token },
    body: JSON.stringify({ provider: "custom-https", generationEndpoint: "https://helper.invalid/v1", model: "test", etag: settings.etag, credentialAction: "replace", credential: key }),
  });
  expect(saved.status, await saved.text()).toBe(200);
}

/** Answer `assistant/status` as a site whose helper was never set up. */
export async function asNotSetUp(page) {
  await page.route("**/admin/api/assistant/status", (route) => route.fulfill({ json: {
    providerType: "generic-https", model: "", destination: null, configured: false, state: "missing", message: "", reason: "no-endpoint", credential: { state: "not-set" }, company: "",
    capabilities: { review: true, interactions: true, context: true, knowledgeChecks: true, codeInteractions: true, autocomplete: true },
  } }));
}

/** Answer `assistant/status` as the real server does, but naming a well-known company. */
export async function asAnthropic(page) {
  await page.route("**/admin/api/assistant/status", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, company: "Anthropic", providerType: "anthropic", destination: "https://api.anthropic.com" } });
  });
}

export async function axeClean(page, label, root) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (selector) => (await window.axe.run(document.querySelector(selector), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), root);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${label}: no sideways scroll`).toBe(false);
  // Nothing inside the sheet or screen is wider than it either.
  const wide = await page.evaluate((selector) => {
    const host = document.querySelector(selector);
    const box = (host.querySelector("dialog") || host).getBoundingClientRect();
    return [...host.querySelectorAll("*")].filter((node) => node.getClientRects().length && node.getBoundingClientRect().right > Math.max(box.right, window.innerWidth) + 1).map((node) => node.tagName.toLowerCase() + (node.className ? `.${String(node.className).split(" ")[0]}` : "")).slice(0, 5);
  }, root);
  expect(wide, `${label}: nothing wider than the screen`).toEqual([]);
  await page.setViewportSize({ width: 400, height: 800 });
}

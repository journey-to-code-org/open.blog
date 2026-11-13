import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { removeTree } from "./teardown.mjs";

// Your accounts in Studio (R2, ported from social-accounts.spec.mjs): the real binary and the real
// Admin routes, against a scripted stand-in for the hosted social function that knows `returns` and
// answers its callback with the 303 back to Studio (G6). The providers' own pages are stood in for
// by the browser (page.route): no provider is ever contacted.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const password = randomBytes(24).toString("hex");
const KEY = `adm_${randomBytes(24).toString("hex")}`;
const TOKEN = "AQX-must-never-reach-the-page";
const LONG = "Lantern".repeat(14);
const APP_PASSWORD = "abcd-efgh-ijkl-mnop";
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const MASTODON = "https://social.example.net";
let hosted;
let hostedPort;
let configured;
let plain;
const state = { accounts: [], connections: [], announcements: [], seen: [], signIns: [], returns: true };

const freePort = async () => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  return port;
};

const uuid = (() => {
  let n = 0;
  return () => `${String(++n).padStart(8, "0")}-0000-4000-8000-000000000000`;
})();

const credential = (scopes = []) => ({ status: "active", accessExpiresAt: "2026-12-28T10:00:00Z", refreshExpiresAt: "2027-10-29T10:00:00Z", scopes, lastRefreshedAt: null });
const newConnection = (provider, extra = {}) => ({ id: uuid(), provider, status: "pending", expiresAt: new Date(Date.now() + 600000).toISOString(), createdAt: new Date().toISOString(), createdBy: "writer", reauthAccountId: null, requestedScopes: [], grantedScopes: [], errorCode: null, message: null, destinations: [], notes: [], ...extra });

// The hosted function, as far as Admin and the browser can tell: the key and actor are checked,
// replies have the shapes of netlify/functions/social.mjs, and extra fields (a token) are included
// on purpose for Admin to drop. Its callback trusts only the attempt it finds.
function handleHosted(request, response, body) {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, value) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname.startsWith("/__")) {
    if (url.pathname === "/__reset") Object.assign(state, { accounts: [], connections: [], announcements: [], seen: [], signIns: [], returns: true });
    return send(200, {});
  }
  const route = url.pathname.replace(/^\/api\/social\/?/, "");
  // The provider's redirect: no key; the attempt is found by its state (here, its id).
  const back = /^callback\/(\w+)$/.exec(route);
  if (back) {
    const connection = state.connections.find((c) => c.id === url.searchParams.get("state") && c.provider === back[1]);
    if (!connection) {
      response.writeHead(400, { "content-type": "text/html" });
      return response.end("<h1>Not connected</h1>");
    }
    if (connection.status === "pending") {
      if (url.searchParams.get("error")) Object.assign(connection, { status: "failed", errorCode: "denied", message: "You said no, so nothing was connected." });
      else if (connection.reauthAccountId) {
        connection.status = "completed";
        Object.assign(state.accounts.find((a) => a.id === connection.reauthAccountId), { health: "ok", status: "connected" });
      } else if (connection.provider === "linkedin") {
        Object.assign(connection, {
          status: "authorized", grantedScopes: ["openid", "profile", "w_member_social"],
          destinations: [{ id: "urn:li:person:abc", kind: "member", name: "Ada Lovelace", eligible: true, reason: null }, { id: "urn:li:organization:7", kind: "organization", name: LONG, eligible: false, reason: "missing-scope" }],
          notes: [{ code: "organizations-not-approved", text: "LinkedIn refused the organization lookup." }],
        });
      } else {
        Object.assign(connection, {
          status: "authorized", grantedScopes: ["pages_show_list", "pages_manage_posts"],
          destinations: [{ id: "111", kind: "page", name: "Grammi's House", eligible: true, reason: null }, { id: "222", kind: "page", name: "Rick's Bait Shop", eligible: false, reason: "no-posting-role" }],
          notes: [{ code: "app-review-unverified", text: "Meta's App Review status can't be read." }],
        });
      }
    }
    if (connection.returnTo) {
      response.writeHead(303, { location: `${connection.returnTo}#/sharing/accounts?connection=${connection.id}`, "referrer-policy": "no-referrer" });
      return response.end();
    }
    response.writeHead(200, { "content-type": "text/html" });
    return response.end("<h1>Facebook said yes</h1><p>You can close this tab and go back to your blog.</p>");
  }
  const actor = request.headers["x-openblog-actor"];
  const input = body ? JSON.parse(body) : {};
  state.seen.push({ method: request.method, path: url.pathname, actor, body: input });
  if (request.headers.authorization !== `Bearer ${KEY}` || actor !== "writer") return send(401, { error: "unauthorized", message: "Not authorized." });
  if (request.method === "GET" && route === "status") {
    return send(200, {
      enabled: true, returns: state.returns, problems: [],
      providers: [
        { provider: "linkedin", label: "LinkedIn", redirectUri: "https://blog.example.com/api/social/callback/linkedin", version: "202510", scopes: ["openid", "profile", "w_member_social"], requiredScopes: ["openid", "profile", "w_member_social"], organizations: false, pkce: false, clientSecret: TOKEN },
        { provider: "facebook", label: "Facebook", redirectUri: "https://blog.example.com/api/social/callback/facebook", version: "v23.0", scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"], requiredScopes: ["pages_show_list", "pages_manage_posts"], organizations: false, pkce: false },
        { provider: "bluesky", label: "Bluesky", login: "app-password", redirectUri: null, version: "atproto", scopes: [], requiredScopes: [], organizations: false, pkce: false },
        { provider: "mastodon", label: "Mastodon", login: "oauth", redirectUri: "https://blog.example.com/api/social/callback/mastodon", version: "v1", scopes: ["read:accounts", "write:statuses", "read:statuses", "write:media"], requiredScopes: ["read:accounts", "write:statuses"], organizations: false, pkce: true, instance: MASTODON, visibility: "unlisted", media: "cover" },
      ],
    });
  }
  if (request.method === "GET" && route === "accounts") return send(200, { accounts: state.accounts.map((a) => ({ ...a, accessToken: TOKEN })) });
  if (request.method === "GET" && route === "connections") return send(200, { connections: state.connections });
  if (request.method === "GET" && route === "announcements") return send(200, { announcements: state.announcements });
  if (request.method === "GET" && route === "destinations") return send(200, { destinations: state.accounts.filter((a) => a.status !== "disconnected").map((a) => ({ id: a.id, provider: a.provider, kind: a.kind, displayName: a.displayName, status: a.status })) });
  if (request.method === "POST" && route === "announcements/retry") {
    const item = state.announcements.find((a) => a.id === url.searchParams.get("id"));
    Object.assign(item, { status: "scheduled", delivery: "pending", lastErrorCode: null, version: item.version + 1 });
    return send(200, { announcement: item });
  }
  if (request.method === "POST" && route === "connections" && input.appPassword) {
    state.signIns.push(input);
    const connection = newConnection("bluesky", { status: "authorized", expiresAt: new Date(Date.now() + 1800000).toISOString(), destinations: [{ id: DID, kind: "account", name: `@${input.identifier}`, eligible: true, reason: null }] });
    state.connections.unshift(connection);
    return send(201, { connection, accessJwt: TOKEN });
  }
  if (request.method === "POST" && route === "connections") {
    const connection = newConnection(input.provider);
    connection.returnTo = input.returnTo || null;
    state.connections.unshift(connection);
    const authorizeUrl = input.provider === "mastodon" ? `${MASTODON}/oauth/authorize?client_id=x&state=${connection.id}` : `https://www.${input.provider}.com/dialog/oauth?client_id=x&state=${connection.id}`;
    return send(201, { connection, authorizeUrl });
  }
  let match = /^connections\/([^/]+)\/select$/.exec(route);
  if (match) {
    const connection = state.connections.find((c) => c.id === match[1]);
    const destination = connection.destinations.find((d) => d.id === input.destination);
    if (!destination.eligible) return send(409, { error: "destination-not-eligible", message: "That destination cannot be used." });
    connection.status = "completed";
    const account = { id: uuid(), provider: connection.provider, kind: destination.kind, externalId: destination.id, displayName: destination.name, status: "connected", health: "ok", connectedBy: "writer", createdAt: new Date().toISOString(), updatedAt: "2026-10-29T10:00:00Z", disconnectedAt: null, credential: credential(connection.grantedScopes) };
    state.accounts.unshift(account);
    return send(201, { account, credential: { accessToken: TOKEN } });
  }
  match = /^connections\/([^/]+)\/cancel$/.exec(route);
  if (match) {
    const connection = state.connections.find((c) => c.id === match[1]);
    connection.status = "canceled";
    return send(200, { connection });
  }
  match = /^accounts\/([^/]+)\/(reconnect|disconnect)$/.exec(route);
  if (match) {
    const account = state.accounts.find((a) => a.id === match[1]);
    if (match[2] === "disconnect") {
      const canceled = state.announcements.filter((a) => a.accountId === account.id && a.status === "scheduled").length;
      Object.assign(account, { status: "disconnected", health: "disconnected", disconnectedAt: "2026-10-29T12:00:00Z", credential: null, canceledAnnouncements: canceled });
      return send(200, { account });
    }
    if (input.appPassword) {
      state.signIns.push(input);
      Object.assign(account, { health: "ok" });
      return send(201, { connection: newConnection("bluesky", { status: "completed", reauthAccountId: account.id }) });
    }
    const connection = newConnection(account.provider, { reauthAccountId: account.id });
    connection.returnTo = input.returnTo || null;
    state.connections.unshift(connection);
    return send(201, { connection, authorizeUrl: `https://www.${account.provider}.com/dialog/oauth?state=${connection.id}` });
  }
  return send(404, { error: "not-found", message: "Not found." });
}

async function startAdmin(name, environment, extra = {}) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), `openblog-studio-accounts-${name}-`));
  mkdirSync(join(dir, "content", "posts"), { recursive: true });
  writeFileSync(join(dir, "content", "posts", "one.md"), "---\ntitle: One\ndate: 2026-10-01\n---\nA post.\n");
  writeFileSync(join(dir, "openblog.json"), JSON.stringify({ title: "Grammi's House", url: "https://social.example.org", author: { name: "Grammi" }, ...extra }));
  execFileSync(binary, ["user", "add", "writer", "--root", dir], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const env = { ...process.env, ...environment };
  if (!environment.OPENBLOG_SOCIAL_ENDPOINT) {
    delete env.OPENBLOG_SOCIAL_ENDPOINT;
    delete env.OPENBLOG_SOCIAL_ADMIN_KEY;
  }
  const child = spawn(binary, ["serve", "--admin", "--root", dir, "--port", String(port)], { cwd: repository, stdio: "pipe", env });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const origin = `http://127.0.0.1:${port}`;
  await expect(async () => {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
  return { child, dir, origin };
}

test.beforeAll(async () => {
  hosted = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => handleHosted(request, response, body));
  });
  hosted.listen(0, "127.0.0.1");
  await once(hosted, "listening");
  hostedPort = hosted.address().port;
  configured = await startAdmin("on", { OPENBLOG_SOCIAL_ENDPOINT: `http://127.0.0.1:${hostedPort}/api/social`, OPENBLOG_SOCIAL_ADMIN_KEY: KEY });
  // A trade site has Sharing (Share this job) even without accounts, so Your accounts says "not set up".
  plain = await startAdmin("off", {}, { business: { trade: "roofing" } });
});

test.afterAll(async () => {
  for (const server of [configured, plain]) {
    if (server?.child && server.child.exitCode === null) {
      const stopped = once(server.child, "exit");
      server.child.kill();
      await stopped;
    }
  }
  await new Promise((done) => hosted?.close(done) || done());
  for (const server of [configured, plain]) removeTree(server?.dir);
});

test.beforeEach(async ({ page }) => {
  await fetch(`http://127.0.0.1:${hostedPort}/__reset`, { method: "POST", body: "{}" });
  page.on("dialog", (dialog) => { throw new Error(`unexpected ${dialog.type()}: ${dialog.message()}`); });
  // The providers' sign-in pages: "Say yes" and "Say no" go to the function's callback, as a provider would.
  await page.route(/^https:\/\/(www\.(facebook|linkedin)\.com|social\.example\.net)\//, (route) => {
    const url = new URL(route.request().url());
    const provider = url.hostname.includes("facebook") ? "facebook" : url.hostname.includes("linkedin") ? "linkedin" : "mastodon";
    const id = url.searchParams.get("state");
    const callback = `http://127.0.0.1:${hostedPort}/api/social/callback/${provider}?state=${id}`;
    return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><title>Sign in</title><h1>Sign in to ${provider}</h1><a href="${callback}&code=ok">Say yes</a> <a href="${callback}&error=access_denied">Say no</a>` });
  });
});

async function openAccounts(page, server, hash = "#/sharing/accounts") {
  await page.goto(`${server.origin}/admin/studio/${hash}`);
  const name = page.getByRole("textbox", { name: "Your name", exact: true });
  if (await name.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false)) {
    await name.fill("writer");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
}

const sheet = (page) => page.locator("side-sheet dialog[open]");
const heading = (page, name) => page.getByRole("heading", { name, exact: true });

async function axeClean(page, selector, label) {
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const results = await page.evaluate(async (sel) => (await window.axe.run(document.querySelector(sel), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), selector);
  expect(results, label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), label).toBe(false);
}

async function connectFacebook(page) {
  await page.locator('li[data-provider="facebook"]').getByRole("button", { name: "Connect Facebook" }).click();
  await expect(heading(page, "Connect Facebook")).toBeFocused();
  await sheet(page).getByRole("button", { name: "Continue to Facebook" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to facebook" })).toBeVisible();
}

test("without sharing settings Your accounts says so, offers nothing, and the browser reaches nothing", async ({ page }) => {
  await openAccounts(page, plain);
  await expect(page.locator("#studio-accounts-page-h")).toBeVisible();
  await expect(page.getByText("Sharing to Facebook isn't set up")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Connect / })).toHaveCount(0);
  const status = await page.evaluate(async () => (await fetch("/admin/api/social/accounts", { credentials: "same-origin" })).status);
  expect(status).toBe(404);
  // A way back that lands on a site without sharing is still taken out of the address.
  await page.goto(`${plain.origin}/admin/studio/#/sharing/accounts?connection=00000001-0000-4000-8000-000000000000`);
  await expect(page.getByText("Sharing to Facebook isn't set up")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
});

test("connect Facebook in the same tab: say yes, come back to the choice, pick by keyboard, and see the account", async ({ page }) => {
  await openAccounts(page, configured);
  await expect(page.locator("#studio-accounts-page-h")).toBeFocused();
  // One "Your accounts" to see: the shell's title. The screen's h2 is there for focus and screen readers.
  await expect(page.locator("h1")).toHaveText("Your accounts");
  expect(await page.locator("h1, h2").filter({ hasText: /^Your accounts$/ }).evaluateAll((nodes) => nodes.filter((n) => n.getBoundingClientRect().height > 1).length)).toBe(1);
  await page.locator('li[data-provider="facebook"]').getByRole("button", { name: "Connect Facebook" }).click();
  const connect = sheet(page);
  await expect(heading(page, "Connect Facebook")).toBeFocused();
  await expect(connect).toContainText("See the Pages you run");
  await expect(connect).toContainText("Leave every box ticked.");
  await expect(connect).not.toContainText("you can say no");
  await connect.getByText("Details for the person who set up your site").click();
  await expect(connect.locator("code")).toHaveText("https://blog.example.com/api/social/callback/facebook");
  await expect(connect).toContainText("pages_read_engagement: See basic details of your Pages (optional)");
  await connect.getByRole("button", { name: "Continue to Facebook" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to facebook" })).toBeVisible();
  // Admin named this very Studio as the way back, from the request it checked.
  const started = state.seen.find((call) => call.method === "POST" && call.path === "/api/social/connections");
  expect(started.body).toEqual({ provider: "facebook", returnTo: `${configured.origin}/admin/studio/` });

  await page.getByRole("link", { name: "Say yes" }).click();
  const choose = heading(page, "Where should Facebook posts go?");
  await expect(choose).toBeFocused();
  // The id is read once, then taken out of the address.
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
  const group = page.getByRole("group", { name: "Where should Facebook posts go?" });
  const mine = group.getByRole("radio", { name: "Grammi's House, Facebook Page" });
  const other = group.getByRole("radio", { name: "Rick's Bait Shop, Facebook Page" });
  await expect(mine).toBeChecked();
  await expect(other).toBeDisabled();
  await expect(other).toHaveAccessibleDescription("Facebook doesn't let your account post on this Page.");
  await mine.focus();
  await page.keyboard.press("Tab");
  const go = sheet(page).getByRole("button", { name: "Connect Grammi's House" });
  await expect(go).toBeFocused();
  await page.keyboard.press("Enter");
  const card = page.locator("li[data-account]");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "Grammi's House" })).toBeFocused();
  await expect(card).toContainText("Facebook Page");
  await expect(card.locator("status-badge")).toHaveText("Connected");
  await expect(page.locator(".studio-accounts [role=status]").first()).toContainText("Connected. Your blog can post to Grammi's House on Facebook now.");
  for (const text of [await page.locator("body").innerText(), await page.content()]) expect(text).not.toContain(TOKEN);
  // Back never runs the return again.
  await page.goBack();
  await expect(sheet(page)).toHaveCount(0);
});

test("saying no comes back to step 1 with the reason and Try again", async ({ page }) => {
  await openAccounts(page, configured);
  await connectFacebook(page);
  await page.getByRole("link", { name: "Say no" }).click();
  await expect(heading(page, "Connect Facebook")).toBeFocused();
  await expect(sheet(page)).toContainText("You said no on Facebook, so nothing was connected.");
  await expect(sheet(page).getByRole("button", { name: "Try connecting Facebook again" })).toBeVisible();
});

test("Back from Facebook's sign-in page shows the connection isn't finished, and Don't connect stops it", async ({ page }) => {
  await openAccounts(page, configured);
  await connectFacebook(page);
  await page.goBack();
  const card = page.locator("li[data-connection]");
  await expect(card.getByRole("heading", { name: "You didn't finish connecting Facebook" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Start connecting Facebook again" })).toBeVisible();
  await card.getByRole("button", { name: "Don't connect Facebook" }).click();
  await expect(page.locator(".studio-accounts [role=status]").first()).toHaveText("Stopped. Nothing was connected.");
  await expect(heading(page, "Add an account")).toBeFocused();
  await expect(page.locator("li[data-connection]")).toHaveCount(0);
  expect(state.connections[0].status).toBe("canceled");
});

test("a foreign ?connection= is ignored and taken out; an unknown one is said plainly", async ({ page }) => {
  await openAccounts(page, configured, "#/sharing/accounts?connection=https%3A%2F%2Fevil.example%2F");
  await expect(page.locator("#studio-accounts-page-h")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByText("Your blog couldn't find that connection")).toHaveCount(0);
  await page.goto(`${configured.origin}/admin/studio/#/sharing/accounts?connection=99999999-0000-4000-8000-000000000000`);
  await expect(page.getByText("Your blog couldn't find that connection. If your account isn't listed, connect it again.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
});

test("an account that needs reconnecting: Reconnect in the same tab, then Try them again, and Disconnect asks once", async ({ page }) => {
  const id = uuid();
  state.accounts.push({ id, provider: "facebook", kind: "page", externalId: "111", displayName: "Grammi's House", status: "needs-reauth", health: "needs-reauth", connectedBy: "writer", createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", disconnectedAt: null, credential: credential(["pages_manage_posts"]) });
  state.announcements.push({ id: uuid(), accountId: id, destination: { id, provider: "facebook", displayName: "Grammi's House", kind: "page" }, work: "/one/", caption: "One", scheduledFor: "2026-11-10T10:00:00Z", status: "failed", delivery: "failed", lastErrorCode: "provider-auth", version: 3, retryable: true });
  state.announcements.push({ id: uuid(), accountId: id, destination: { id, provider: "facebook", displayName: "Grammi's House", kind: "page" }, work: "/one/", caption: "Two", scheduledFor: "2026-11-20T10:00:00Z", status: "scheduled", delivery: "pending", lastErrorCode: null, version: 1 });
  await openAccounts(page, configured, `#/sharing/accounts`);
  const card = page.locator(`li[data-account="${id}"]`);
  await expect(card.locator("status-badge")).toHaveText("Needs reconnecting");
  await expect(card).toContainText("Facebook stopped taking posts from your blog. Reconnect it, signing in to the Facebook account you used the first time.");
  await expect(card).toContainText("1 post is waiting for it.");
  await card.getByRole("button", { name: "Reconnect Grammi's House" }).click();
  await expect(heading(page, "Reconnect Grammi's House")).toBeFocused();
  await expect(sheet(page)).toContainText("Use the Facebook account you used the first time. If Facebook shows someone else's name, tell the person who set up your site.");
  await sheet(page).getByRole("button", { name: "Continue to Facebook" }).click();
  await page.getByRole("link", { name: "Say yes" }).click();
  await expect(page.getByText("Reconnected. Grammi's House works again.")).toBeVisible();
  await expect(card.getByRole("heading", { name: "Grammi's House" })).toBeFocused();
  await expect(card.locator("status-badge")).toHaveText("Connected");
  await card.getByRole("button", { name: "Try them again: Grammi's House" }).click();
  await expect(page.locator(".studio-accounts [role=status]").first()).toHaveText("1 post will be tried again within a minute.");
  expect(state.seen.filter((call) => call.path.endsWith("/announcements/retry")).map((call) => call.body)).toEqual([{ version: 3 }]);

  // Disconnect: asks once, Keep it connected first.
  await card.getByRole("button", { name: "More for Grammi's House" }).click();
  await page.getByRole("menuitem", { name: "Disconnect…" }).click();
  const dialog = page.getByRole("dialog", { name: "Disconnect Grammi's House?" });
  await expect(dialog).toContainText("2 posts waiting to go there won't be shared.");
  await expect(dialog.getByRole("button", { name: "Keep it connected" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep it connected" }).click();
  expect(state.seen.some((call) => call.path.endsWith("/disconnect"))).toBe(false);
  await card.getByRole("button", { name: "More for Grammi's House" }).click();
  await page.getByRole("menuitem", { name: "Disconnect…" }).click();
  await page.getByRole("dialog", { name: "Disconnect Grammi's House?" }).getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator(".studio-accounts [role=status]").first()).toHaveText("Disconnected Grammi's House. 2 waiting posts won't be shared.");
  await expect(page.locator("li[data-account]")).toHaveCount(0);
});

test("Bluesky by keyboard: a refused shape empties the password, a good one is sent once and never shown", async ({ page }) => {
  await openAccounts(page, configured, "#/sharing/accounts?connect=bluesky");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
  const name = sheet(page).getByRole("textbox", { name: "Your Bluesky name" });
  const secret = sheet(page).getByLabel("App password");
  await expect(name).toBeFocused();
  await expect(secret).toHaveAttribute("type", "password");
  await expect(name).toHaveAttribute("autocapitalize", "none");
  await expect(sheet(page)).toContainText("Bluesky lets you make a separate password just for your blog");
  await page.keyboard.type("ada.bsky.social");
  await page.keyboard.press("Tab");
  await expect(secret).toBeFocused();
  await page.keyboard.type("my real password");
  await page.keyboard.press("Enter");
  await expect(sheet(page)).toContainText("That isn't an app password. One looks like abcd-efgh-ijkl-mnop. Never use your real password.");
  await expect(secret).toHaveValue("");
  await expect(secret).toBeFocused();
  expect(state.signIns).toEqual([]);
  await page.keyboard.type(APP_PASSWORD);
  await page.keyboard.press("Enter");
  await expect(heading(page, "Where should Bluesky posts go?")).toBeFocused();
  expect(state.signIns).toEqual([{ provider: "bluesky", identifier: "ada.bsky.social", appPassword: APP_PASSWORD }]);
  await sheet(page).getByRole("button", { name: "Connect @ada.bsky.social" }).click();
  const card = page.locator("li[data-account]");
  await expect(card).toContainText("@ada.bsky.social");
  for (const text of [await page.locator("body").innerText(), await page.content()]) {
    expect(text).not.toContain(APP_PASSWORD);
    expect(text).not.toContain(TOKEN);
  }
});

test("leaving the Bluesky sheet with a typed name asks first", async ({ page }) => {
  await openAccounts(page, configured);
  await page.locator('li[data-provider="bluesky"]').getByRole("button", { name: "Connect Bluesky" }).click();
  await sheet(page).getByRole("textbox", { name: "Your Bluesky name" }).fill("ada.bsky.social");
  await page.keyboard.press("Escape");
  const question = page.getByRole("dialog", { name: "Connect Bluesky?" });
  await expect(question).toContainText("You typed your Bluesky name and didn't connect.");
  await question.getByRole("button", { name: "Leave without connecting" }).click();
  await expect(sheet(page)).toHaveCount(0);
});

test("leaving a Bluesky reconnect with a changed name asks in reconnect words", async ({ page }) => {
  const id = uuid();
  state.accounts.push({ id, provider: "bluesky", kind: "account", externalId: DID, displayName: "@ada.bsky.social", status: "needs-reauth", health: "needs-reauth", connectedBy: "writer", createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", disconnectedAt: null, credential: credential() });
  await openAccounts(page, configured);
  await page.locator(`li[data-account="${id}"]`).getByRole("button", { name: "Reconnect @ada.bsky.social" }).click();
  await sheet(page).getByRole("textbox", { name: "Your Bluesky name" }).fill("ada2.bsky.social");
  await page.keyboard.press("Escape");
  const question = page.getByRole("dialog", { name: "Reconnect @ada.bsky.social?" });
  await expect(question).toContainText("You typed your Bluesky name and didn't reconnect.");
  await expect(question.getByRole("button", { name: "Reconnect @ada.bsky.social" })).toBeVisible();
  await question.getByRole("button", { name: "Leave without reconnecting" }).click();
  await expect(sheet(page)).toHaveCount(0);
});

test("without a way back (an older sharing service), Facebook opens in a new tab she opens herself", async ({ page }) => {
  state.returns = false;
  await openAccounts(page, configured);
  await page.locator('li[data-provider="linkedin"]').getByRole("button", { name: "Connect LinkedIn" }).click();
  await sheet(page).getByRole("button", { name: "Continue to LinkedIn" }).click();
  const open = sheet(page).getByRole("link", { name: "Open LinkedIn, in a new tab" });
  await expect(open).toHaveAttribute("href", /^https:\/\/www\.linkedin\.com\//);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
  expect(state.seen.find((call) => call.method === "POST" && call.path === "/api/social/connections").body).toEqual({ provider: "linkedin" });
  // She says yes in the other tab, then comes back.
  const tab = await page.context().newPage();
  await tab.route(/^https:\/\/www\.linkedin\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<a href="http://127.0.0.1:${hostedPort}/api/social/callback/linkedin?state=${new URL(route.request().url()).searchParams.get("state")}&code=ok">Say yes</a>` }));
  await tab.goto(await open.getAttribute("href"));
  await tab.getByRole("link", { name: "Say yes" }).click();
  await expect(tab.getByRole("heading", { name: "Facebook said yes" })).toBeVisible();
  await tab.close();
  await sheet(page).getByRole("button", { name: "I've said yes" }).click();
  await expect(heading(page, "Where should LinkedIn posts go?")).toBeFocused();
  await expect(page.getByRole("radio", { name: /Lantern/ })).toBeDisabled();
});

test("new tab, she says no on Facebook: I've said yes closes the waiting step and opens step 1 with the reason and Try again", async ({ page }) => {
  state.returns = false;
  await openAccounts(page, configured);
  await page.locator('li[data-provider="facebook"]').getByRole("button", { name: "Connect Facebook" }).click();
  await sheet(page).getByRole("button", { name: "Continue to Facebook" }).click();
  const open = sheet(page).getByRole("link", { name: "Open Facebook, in a new tab" });
  const tab = await page.context().newPage();
  await tab.route(/^https:\/\/www\.facebook\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<a href="http://127.0.0.1:${hostedPort}/api/social/callback/facebook?state=${new URL(route.request().url()).searchParams.get("state")}&error=access_denied">Say no</a>` }));
  await tab.goto(await open.getAttribute("href"));
  await tab.getByRole("link", { name: "Say no" }).click();
  await tab.close();
  await sheet(page).getByRole("button", { name: "I've said yes" }).click();
  await expect(heading(page, "Connect Facebook")).toBeFocused();
  await expect(sheet(page)).toContainText("You said no on Facebook, so nothing was connected.");
  await expect(sheet(page).getByRole("button", { name: "Try connecting Facebook again" })).toBeVisible();
  // It stays open: the closing of the waiting step never catches up with it.
  await page.waitForTimeout(500);
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page)).toContainText("You said no on Facebook");
});

test("coming back while Facebook is still finishing: the finishing step gives way to the choice once it's ready", async ({ page }) => {
  const connection = newConnection("facebook", { status: "exchanging" });
  state.connections.unshift(connection);
  await openAccounts(page, configured, `#/sharing/accounts?connection=${connection.id}`);
  await expect(sheet(page)).toContainText("Facebook said yes");
  await expect(sheet(page).locator(`[data-finishing="${connection.id}"]`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
  Object.assign(connection, {
    status: "authorized", grantedScopes: ["pages_show_list", "pages_manage_posts"],
    destinations: [{ id: "111", kind: "page", name: "Grammi's House", eligible: true, reason: null }],
  });
  await expect(heading(page, "Where should Facebook posts go?")).toBeFocused({ timeout: 10000 });
  await page.waitForTimeout(500);
  await expect(sheet(page)).toHaveCount(1);
  await expect(sheet(page).getByRole("radio", { name: "Grammi's House, Facebook Page" })).toBeChecked();
});

test("same tab or new tab is decided by the start's own reply, not by what the page read when it loaded", async ({ page }) => {
  // The page loaded saying it returns; by the time she presses Continue, it doesn't.
  await openAccounts(page, configured);
  await expect(page.locator('li[data-provider="linkedin"]')).toBeVisible();
  state.returns = false;
  await page.locator('li[data-provider="linkedin"]').getByRole("button", { name: "Connect LinkedIn" }).click();
  await sheet(page).getByRole("button", { name: "Continue to LinkedIn" }).click();
  await expect(sheet(page).getByRole("link", { name: "Open LinkedIn, in a new tab" })).toBeVisible();
  expect(page.url()).toContain("/admin/studio/");
  await sheet(page).getByRole("button", { name: "Don't connect LinkedIn" }).click();
  // And the other way round: loaded saying no, the start named a way back, so she goes in this tab.
  await page.reload();
  await expect(page.locator('li[data-provider="facebook"]')).toBeVisible();
  state.returns = true;
  await connectFacebook(page);
});

test("a Page that stopped being allowed while she chose shows the reason the server gives now", async ({ page }) => {
  const connection = newConnection("facebook", {
    status: "authorized", returnTo: null, grantedScopes: ["pages_show_list", "pages_manage_posts"],
    destinations: [{ id: "111", kind: "page", name: "Grammi's House", eligible: true, reason: null }, { id: "333", kind: "page", name: "Jimmy's Diner", eligible: true, reason: null }],
  });
  state.connections.unshift(connection);
  await openAccounts(page, configured, `#/sharing/accounts?connection=${connection.id}`);
  await expect(heading(page, "Where should Facebook posts go?")).toBeFocused();
  const mine = sheet(page).getByRole("radio", { name: "Grammi's House, Facebook Page" });
  await mine.check();
  // Meanwhile her role on the Page was taken away.
  Object.assign(connection.destinations[0], { eligible: false, reason: "no-posting-role" });
  await sheet(page).getByRole("button", { name: "Connect Grammi's House" }).click();
  await expect(mine).toBeDisabled();
  await expect(mine).toHaveAccessibleDescription("Facebook doesn't let your account post on this Page.");
  await expect(sheet(page).getByRole("button", { name: "Connect this one" })).toBeVisible();
});

test("Mastodon: the only address followed is that instance's own sign-in page", async ({ page }) => {
  await openAccounts(page, configured);
  const card = page.locator('li[data-provider="mastodon"]');
  await expect(card).toContainText("Post as your account on social.example.net.");
  await card.getByRole("button", { name: "Connect Mastodon" }).click();
  await expect(sheet(page)).toContainText("Anyone with the link can see them, but they stay out of public timelines.");
  await expect(sheet(page)).toContainText("Your post's photo goes with it.");
  await sheet(page).getByRole("button", { name: "Continue to Mastodon" }).click();
  await expect(page).toHaveURL(/^https:\/\/social\.example\.net\/oauth\/authorize\?/);
});

test("Sharing links to Your accounts in the same tab, never to the old Admin; #/social opens Your accounts", async ({ page }) => {
  const id = uuid();
  state.accounts.push({ id, provider: "facebook", kind: "page", externalId: "111", displayName: "Grammi's House", status: "connected", health: "expiring", connectedBy: "writer", createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", disconnectedAt: null, credential: { ...credential(), accessExpiresAt: "2026-11-20T10:00:00Z", refreshExpiresAt: null } });
  await openAccounts(page, configured, "#/sharing");
  await expect(page.getByRole("heading", { name: "Where have your posts been shared?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage your accounts" })).toHaveAttribute("href", "#/sharing/accounts");
  await expect(page.getByRole("link", { name: "Reconnect Grammi's House" })).toHaveAttribute("href", `#/sharing/accounts?reconnect=${id}`);
  expect(await page.locator('a[href*="/admin/"], a[target="_blank"]').count()).toBe(0);
  await page.getByRole("link", { name: "Reconnect Grammi's House" }).click();
  await expect(heading(page, "Reconnect Grammi's House")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.goto(`${configured.origin}/admin/studio/#/social/anything`);
  await expect(page.locator("#studio-accounts-page-h")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/sharing/accounts");
});

test("Your accounts and each sheet pass axe at 320 px without sideways scrolling, even with a very long name", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const id = uuid();
  state.accounts.push({ id, provider: "linkedin", kind: "organization", externalId: `urn:li:organization:${"9".repeat(120)}`, displayName: LONG, status: "connected", health: "needs-reauth", connectedBy: "writer", createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z", disconnectedAt: null, credential: credential(["w_member_social"]) });
  await openAccounts(page, configured);
  await expect(page.locator("li[data-account]")).toContainText(LONG);
  await axeClean(page, "main", "Your accounts");
  await page.locator('li[data-provider="facebook"]').getByRole("button", { name: "Connect Facebook" }).click();
  await sheet(page).getByText("Details for the person who set up your site").click();
  await axeClean(page, "side-sheet dialog[open]", "Connect Facebook");
  await page.keyboard.press("Escape");
  await page.locator('li[data-provider="bluesky"]').getByRole("button", { name: "Connect Bluesky" }).click();
  await axeClean(page, "side-sheet dialog[open]", "Connect Bluesky");
  await page.keyboard.press("Escape");
  await page.locator(`li[data-account="${id}"]`).getByRole("button", { name: `Reconnect ${LONG}` }).click();
  await axeClean(page, "side-sheet dialog[open]", "Reconnect");
  await page.keyboard.press("Escape");
  await page.locator('li[data-provider="facebook"]').getByRole("button", { name: "Connect Facebook" }).click();
  await sheet(page).getByRole("button", { name: "Continue to Facebook" }).click();
  await page.getByRole("link", { name: "Say yes" }).click();
  await expect(heading(page, "Where should Facebook posts go?")).toBeFocused();
  await axeClean(page, "side-sheet dialog[open]", "Choose");
  const heights = await page.locator("side-sheet dialog[open] .action-button, side-sheet dialog[open] .studio-link-button, side-sheet dialog[open] label").evaluateAll((nodes) => nodes.filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect().height));
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(43);
});

// The blog's one service worker (web/studio/sw.js, Studio R3 G24), run against a fake `self`: it
// shows what was sent in plain words with the badge, turns old Admin addresses into Studio's, asks an
// open Studio window to move (never navigates it, which would skip the leave-guard), opens a window
// otherwise, and never opens http:, javascript: or another site's page from a notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://grammis.example";
const source = readFileSync(new URL("../../web/studio/sw.js", import.meta.url), "utf8");

/** A fake Cache Storage: named maps of path → response. */
function fakeCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return { put: async (key, response) => { store.set(typeof key === "string" ? key : new URL(key.url).pathname, response); } };
  };
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (key, { cacheName } = {}) => stores.get(cacheName)?.get(key),
  };
}

function worker({ windows = [], release, caches = fakeCaches(), fetch = async () => { throw new TypeError("offline"); } } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const clients = windows.map((url) => ({
    url,
    focused: 0,
    messages: [],
    navigated: [],
    async focus() { this.focused += 1; return this; },
    postMessage(message) { this.messages.push({ ...message }); },
    async navigate(to) { this.navigated.push(to); return this; },
  }));
  const self = {
    location: new URL(`${ORIGIN}/admin/sw.js`),
    registration: { scope: `${ORIGIN}/admin/`, showNotification: async (title, options) => { shown.push({ title, ...options }); } },
    clients: {
      claim: async () => {},
      matchAll: async (options) => { assert.deepEqual({ ...options }, { type: "window", includeUncontrolled: true }); return clients; },
      openWindow: async (url) => { opened.push(url); return null; },
    },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  if (release) self.STUDIO_RELEASE = release;
  const Request = class { constructor(url, init = {}) { this.url = new URL(url, ORIGIN).href; Object.assign(this, init); } };
  const URLPattern = class { constructor(init) { this.pathname = init.pathname; } };
  vm.runInNewContext(source, { self, URL, String, console, caches, fetch, Request, Promise, URLPattern });
  const fire = async (type, event) => {
    let done = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => { done = p; } });
    await done;
  };
  const request = (url, method = "GET") => {
    let answered = null;
    const waits = [];
    listeners.fetch({ request: { url: new URL(url, ORIGIN).href, method }, respondWith: (p) => { answered = p; }, waitUntil: (p) => waits.push(p) });
    return { answered, settle: async () => { const value = answered ? await answered.catch((e) => e) : null; await Promise.all(waits); return value; } };
  };
  return {
    shown, opened, clients, listeners, caches, request, fire,
    push: (notice) => fire("push", { data: notice === undefined ? null : { json: () => (typeof notice === "string" ? JSON.parse(notice) : notice) } }),
    tap: (url) => {
      const notification = { data: { url }, closed: false, close() { this.closed = true; } };
      return fire("notificationclick", { notification }).then(() => notification);
    },
  };
}

// R4 G35 narrows R3's "caches nothing" to "never an API reply": it keeps Studio's own files only.
const response = (body, type = "basic", ok = true) => ({ body, type, ok, clone() { return response(body, type, ok); } });
const RELEASE = { version: "abc123", files: ["/admin/studio/", "/admin/studio/studio.js", "/admin/studio/screens/new-job.js"] };

test("installing keeps exactly the release's own files, and never asks the server for anything else", async () => {
  const asked = [];
  const w = worker({ release: RELEASE, fetch: async (request) => { asked.push(new URL(request.url).pathname); return response(`body of ${request.url}`); } });
  assert.deepEqual(Object.keys(w.listeners).sort(), ["activate", "fetch", "install", "notificationclick", "push"]);
  await w.fire("install", {});
  assert.deepEqual(asked.sort(), [...RELEASE.files].sort());
  assert.deepEqual([...w.caches.stores.keys()], ["studio-abc123"]);
  assert.deepEqual([...w.caches.stores.get("studio-abc123").keys()].sort(), [...RELEASE.files].sort());
});

test("where the browser can, everything but Studio's files goes straight to the network without the worker", async () => {
  const w = worker({ release: { version: "v", files: [] } });
  const routes = [];
  const waits = [];
  w.listeners.install({ addRoutes: async (rules) => { routes.push(rules); }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(routes.length, 1);
  assert.equal(routes[0][0].source, "network");
  assert.equal(routes[0][0].condition.not.urlPattern.pathname, "/admin/studio/*");
  // A browser without "not" gets the API sent past it at least.
  const older = [];
  const waits2 = [];
  w.listeners.install({ addRoutes: async (rules) => { if (rules[0].condition.not) throw new TypeError("no not"); older.push(rules); }, waitUntil: (p) => waits2.push(p) });
  await Promise.all(waits2);
  assert.equal(older[0][0].condition.urlPattern.pathname, "/admin/api/*");
});

test("a new release's worker deletes the old copy of Studio, and nothing else", async () => {
  const caches = fakeCaches({ "studio-old": { "/admin/studio/": response("old") }, "someone-elses": { "/x": response("x") } });
  const w = worker({ release: RELEASE, caches });
  await w.fire("activate", {});
  assert.deepEqual([...caches.stores.keys()].sort(), ["someone-elses"]);
});

test("an API reply, the old Admin's pages and anything not a GET pass by untouched and are never kept", async () => {
  const asked = [];
  const w = worker({ release: RELEASE, fetch: async (request) => { asked.push(request.url); return response("live"); } });
  for (const [url, method] of [
    ["/admin/api/meta", "GET"], ["/admin/api/session", "GET"], ["/admin/api/document?path=posts/a.md", "GET"],
    ["/admin/studio/api/x", "GET"], ["/admin/", "GET"], ["/admin/admin.js", "GET"], ["/admin/sw.js", "GET"],
    ["/admin/studio/studio.js", "POST"], ["/admin/studio/studio.js?x=1", "GET"], ["https://elsewhere.example/admin/studio/", "GET"], ["/posts/a/", "GET"],
  ]) {
    const r = w.request(url, method);
    assert.equal(r.answered, null, `${method} ${url}`);
  }
  assert.deepEqual(asked, []);
  assert.deepEqual([...w.caches.stores.keys()], []);
});

test("with a signal Studio's files come from the server and the copy is refreshed; with none, the kept copy opens", async () => {
  let online = true;
  const w = worker({ release: RELEASE, fetch: async (request) => { if (!online) throw new TypeError("Failed to fetch"); return response(`fresh ${new URL(request.url).pathname}`); } });
  const page = w.request("/admin/studio/");
  assert.equal((await page.settle()).body, "fresh /admin/studio/");
  assert.equal(w.caches.stores.get("studio-abc123").get("/admin/studio/").body, "fresh /admin/studio/");
  // The page under its other name is the same page, kept once.
  await w.request("/admin/studio/index.html").settle();
  online = false;
  assert.equal((await w.request("/admin/studio/").settle()).body, "fresh /admin/studio/index.html");
  assert.equal((await w.request("/admin/studio/index.html").settle()).body, "fresh /admin/studio/index.html");
  const missing = await w.request("/admin/studio/never-kept.js").settle();
  assert.ok(missing instanceof TypeError, "nothing kept: it fails as the network did");
  // A reply that isn't the server's own (an error page, an opaque one) is never kept.
  online = true;
  const odd = worker({ release: RELEASE, fetch: async () => response("error", "basic", false) });
  await odd.request("/admin/studio/studio.js").settle();
  assert.equal(odd.caches.stores.get("studio-abc123")?.get("/admin/studio/studio.js"), undefined);
});

test("the worker's keeps and the rules' copy are the same function", async () => {
  const rules = readFileSync(new URL("../../web/studio/parts/worker-rules.js", import.meta.url), "utf8");
  const body = (code) => {
    const start = code.indexOf("function keeps(");
    assert.ok(start >= 0);
    return code.slice(start, code.indexOf("\n}\n", start) + 2);
  };
  assert.equal(body(rules), body(source));
  const { keeps } = await import("../../web/studio/parts/worker-rules.js");
  assert.equal(keeps(`${ORIGIN}/admin/studio/screens/new-job.js`, "GET", ORIGIN), true);
  assert.equal(keeps(`${ORIGIN}/admin/api/meta`, "GET", ORIGIN), false);
});

test("a notice is shown clipped, with the badge and icon, and its address made Studio's", async () => {
  const w = worker();
  await w.push({ title: "Linda left a comment", body: "On “Pumpkin pie”: “Tried this”", url: "/admin/#/moderation", tag: "comment-1" });
  await w.push({ title: "x".repeat(200), body: "y".repeat(400), url: "/admin/studio/#/quotes" });
  await w.push(undefined);
  await w.push("not json at all".replace(/.*/, "null"));
  assert.equal(w.shown[0].title, "Linda left a comment");
  assert.equal(w.shown[0].badge, "/admin/icons/badge-96.png");
  assert.equal(w.shown[0].icon, "/admin/icons/icon-192.png");
  assert.equal(w.shown[0].tag, "comment-1");
  assert.equal(w.shown[0].data.url, `${ORIGIN}/admin/studio/#/moderation`);
  assert.equal(w.shown[1].title.length, 80);
  assert.equal(w.shown[1].body.length, 180);
  assert.equal(w.shown[1].data.url, `${ORIGIN}/admin/studio/#/quotes`);
  assert.equal(w.shown[2].title, "Something new on your blog");
  assert.equal(w.shown[2].data.url, `${ORIGIN}/admin/studio/`);
  assert.equal(w.shown[3].title, "Something new on your blog");
});

test("old Admin addresses become Studio's; other places fall back to Studio's Home", async () => {
  const w = worker();
  const cases = [
    ["/admin/#/feedback", `${ORIGIN}/admin/studio/#/feedback`],
    ["/admin/#/notifications", `${ORIGIN}/admin/studio/#/notifications`],
    ["/admin/", `${ORIGIN}/admin/studio/`],
    ["/admin", `${ORIGIN}/admin/studio/`],
    [`${ORIGIN}/admin/#/quotes`, `${ORIGIN}/admin/studio/#/quotes`],
    ["/admin/studio/#/comments/shown", `${ORIGIN}/admin/studio/#/comments/shown`],
    ["https://family.example/tree", "https://family.example/tree"],
    ["http://family.example/tree", `${ORIGIN}/admin/studio/`],
    ["javascript:alert(1)", `${ORIGIN}/admin/studio/`],
    ["data:text/html,hi", `${ORIGIN}/admin/studio/`],
    ["https://user:pw@family.example/", `${ORIGIN}/admin/studio/`],
    ["/posts/pumpkin-pie/", `${ORIGIN}/admin/studio/`],
    ["/admin/admin.js", `${ORIGIN}/admin/studio/`],
    ["", `${ORIGIN}/admin/studio/`],
  ];
  for (const [url] of cases) await w.push({ title: "t", url });
  assert.deepEqual(w.shown.map((n) => n.data.url), cases.map(([, want]) => want));
});

test("tapping with Studio open focuses it and asks it to move, so its leave-guard asks first", async () => {
  const w = worker({ windows: [`${ORIGIN}/admin/#/overview`, `${ORIGIN}/admin/studio/#/write/posts%2Fpie.md`] });
  const tapped = await w.tap(`${ORIGIN}/admin/studio/#/comments`);
  assert.equal(tapped.closed, true);
  const [old, studio] = w.clients;
  assert.equal(studio.focused, 1);
  assert.deepEqual(studio.messages, [{ type: "open", hash: "#/comments" }]);
  assert.deepEqual(studio.navigated, [], "never navigated: that would reload without asking");
  assert.deepEqual(old.messages, []);
  assert.deepEqual(w.opened, []);
});

test("a notice the old worker showed is rewritten when tapped; Home is #/", async () => {
  const w = worker({ windows: [`${ORIGIN}/admin/studio/`] });
  await w.tap(`${ORIGIN}/admin/#/moderation`);
  await w.tap(`${ORIGIN}/admin/`);
  assert.deepEqual(w.clients[0].messages, [{ type: "open", hash: "#/moderation" }, { type: "open", hash: "#/" }]);
});

test("with no Studio window, or for another app's page, a window is opened instead", async () => {
  const none = worker({ windows: [`${ORIGIN}/admin/#/overview`] });
  await none.tap(`${ORIGIN}/admin/studio/#/quotes`);
  assert.deepEqual(none.opened, [`${ORIGIN}/admin/studio/#/quotes`]);
  assert.deepEqual(none.clients[0].navigated, []);

  const app = worker({ windows: [`${ORIGIN}/admin/studio/`] });
  await app.tap("https://family.example/tree");
  assert.deepEqual(app.opened, ["https://family.example/tree"]);
  assert.deepEqual(app.clients[0].messages, []);

  const foreign = worker();
  await foreign.tap("http://evil.example/");
  await foreign.tap(undefined);
  assert.deepEqual(foreign.opened, [`${ORIGIN}/admin/studio/`, `${ORIGIN}/admin/studio/`]);
});

test("the worker's studioAddress and the rules' copy are the same function", async () => {
  const rules = readFileSync(new URL("../../web/studio/parts/notification-rules.js", import.meta.url), "utf8");
  const body = (code) => {
    const start = code.indexOf("function studioAddress(");
    assert.ok(start >= 0);
    const end = code.indexOf("\n}\n", start);
    return code.slice(start, end + 2);
  };
  assert.equal(body(rules), body(source));
  const { studioAddress } = await import("../../web/studio/parts/notification-rules.js");
  assert.equal(studioAddress("/admin/#/quotes", ORIGIN), `${ORIGIN}/admin/studio/#/quotes`);
  assert.equal(studioAddress("javascript:alert(1)", ORIGIN), `${ORIGIN}/admin/studio/`);
});

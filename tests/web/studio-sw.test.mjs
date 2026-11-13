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

function worker({ windows = [] } = {}) {
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
  vm.runInNewContext(source, { self, URL, String, console });
  const fire = async (type, event) => {
    let done = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => { done = p; } });
    await done;
  };
  return {
    shown, opened, clients, listeners,
    push: (notice) => fire("push", { data: notice === undefined ? null : { json: () => (typeof notice === "string" ? JSON.parse(notice) : notice) } }),
    tap: (url) => {
      const notification = { data: { url }, closed: false, close() { this.closed = true; } };
      return fire("notificationclick", { notification }).then(() => notification);
    },
  };
}

test("it only shows and opens: no fetch handler, no cache", () => {
  const w = worker();
  assert.deepEqual(Object.keys(w.listeners).sort(), ["activate", "install", "notificationclick", "push"]);
  assert.doesNotMatch(source, /caches\.|addEventListener\("fetch"/);
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

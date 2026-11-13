// The Notifications screen (ADR 0412): honest when it isn't set up, an iPhone told to add Admin to
// the Home Screen first, turning on for this device (permission, subscription, saved, test sent),
// picking what a device hears about, matching this browser by a hash of its endpoint, and turning
// it off again.
import assert from "node:assert/strict";
import test from "node:test";

import { OFF_TEXT, browserState, createNotifications, endpointHash, guessLabel } from "../../web/admin/notifications.js";
import { type, withDom } from "./dom-shim.mjs";
import { all, flush, text } from "./voice-harness.mjs";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const PUBLIC = "BNJXQLrFqB91iIEvDTQE-lvUxvYyB_Hj57arqlCDifnNudW0TeOybFZdAm45MSdoDRrmo7yK48iuCh2rOHYV7MM";
const KINDS = [
  { id: "comment", label: "New comments" },
  { id: "feedback", label: "Reader feedback" },
  { id: "quote", label: "Quote requests" },
  { id: "app", label: "Your other apps (gifts, games and the like)" },
];
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

function server({ enabled = true, devices = [], otherApps = true } = {}) {
  const state = { devices };
  return {
    state,
    calls: [],
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (path === "push/status") return enabled ? { enabled: true, state: "on", publicKey: PUBLIC, kinds: KINDS, otherApps, devices: structuredClone(state.devices) } : { enabled: false, state: "off" };
      if (path === "push/devices" && method === "POST") {
        const device = { id: "11111111-1111-4111-8111-111111111111", device: await endpointHash(options.json.subscription.endpoint), label: options.json.label, kinds: options.json.kinds, createdAt: new Date(NOW).toISOString(), lastSentAt: null };
        state.devices.push(device);
        return { device };
      }
      const change = /^push\/devices\/([^/]+)$/.exec(path);
      if (change) {
        const device = state.devices.find((d) => d.id === change[1]);
        Object.assign(device, options.json);
        return { device: structuredClone(device) };
      }
      const remove = /^push\/devices\/([^/]+)\/remove$/.exec(path);
      if (remove) {
        state.devices = state.devices.filter((d) => d.id !== remove[1]);
        return { removed: true };
      }
      if (path === "push/test") return { sent: true };
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
}

/** A browser that can get pushes, with what it was asked to do. */
function browser({ userAgent = PIXEL, permission = "default", answer = "granted", standalone = false, capable = true } = {}) {
  let subscription = null;
  const asked = [];
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async (options) => {
      asked.push(["subscribe", options]);
      subscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/this-phone",
        toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/this-phone", keys: { p256dh: "p", auth: "a" } }),
        unsubscribe: async () => {
          asked.push(["unsubscribe"]);
          subscription = null;
          return true;
        },
      };
      return subscription;
    },
  };
  const registration = { pushManager };
  const navigator = {
    userAgent,
    platform: "Linux",
    maxTouchPoints: 0,
    standalone,
    serviceWorker: capable ? { register: async (url, options) => { asked.push(["register", url, options.scope]); return registration; }, ready: Promise.resolve(registration), getRegistration: async () => registration } : undefined,
  };
  const Notification = { permission, requestPermission: async () => { asked.push(["permission"]); Notification.permission = answer; return answer; } };
  const window = { matchMedia: () => ({ matches: standalone }), ...(capable ? { PushManager: function PushManager() {}, Notification } : {}) };
  return { navigator, window, asked, existing: () => subscription };
}

async function open(api, b) {
  const view = createNotifications({ api, navigator: b.navigator, window: b.window, now: () => NOW });
  document.body.append(view.element);
  await view.load();
  await flush();
  return view.element;
}
const action = (root, name) => all(root, "button").find((node) => node.dataset.action === name);
const kind = (root, id) => all(root, "input").find((node) => node.getAttribute("data-kind") === id);
const click = async (node) => {
  node.dispatch("click", { target: node });
  await flush();
};
const toggle = async (node) => {
  node.checked = !node.checked;
  node.dispatch("change", { target: node });
  await flush();
};

test("a device gets a sensible name, and the browser says what it can do", async () => {
  assert.equal(guessLabel(IPHONE), "iPhone");
  assert.equal(guessLabel(PIXEL), "Android phone");
  assert.equal(guessLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "Windows computer");
  assert.equal(browserState(browser({ userAgent: IPHONE, capable: false })), "install-first");
  assert.equal(browserState(browser({ capable: false })), "unsupported");
  assert.equal(browserState(browser({ permission: "denied" })), "denied");
  assert.equal(browserState(browser()), "ready");
  assert.equal((await endpointHash("https://fcm.googleapis.com/x")).length, 32);
});

test("not set up: the page says so and asks for nothing else", withDom(async () => {
  const api = server({ enabled: false });
  const root = await open(api, browser());
  assert.match(text(root), new RegExp(OFF_TEXT.off.slice(0, 30)));
  assert.equal(all(root, "button").length, 0);
  assert.deepEqual(api.calls.map((c) => c.path), ["push/status"]);
}));

test("an iPhone in Safari is told to add Admin to the Home Screen first", withDom(async () => {
  const root = await open(server(), browser({ userAgent: IPHONE, capable: false }));
  assert.match(text(root), /Add to Home Screen/);
  assert.equal(action(root, "turn-on"), undefined);
}));

test("turning on asks once, saves this device with what it picked, and sends a test", withDom(async () => {
  const api = server();
  const b = browser();
  const root = await open(api, b);
  assert.match(text(root), /Get a buzz on this device/);
  const name = all(root, "input").find((node) => node.getAttribute("data-field") === "label");
  assert.equal(name.value, "Android phone");
  await type(name, "Grammi's phone");
  await toggle(kind(root, "quote"));
  await click(action(root, "turn-on"));

  assert.deepEqual(b.asked.map((a) => a[0]), ["permission", "register", "subscribe"]);
  const subscribe = b.asked.find((a) => a[0] === "subscribe")[1];
  assert.equal(subscribe.userVisibleOnly, true);
  assert.equal(subscribe.applicationServerKey.length, 65, "the site's public key, as bytes");
  const saved = api.calls.find((c) => c.path === "push/devices");
  assert.deepEqual(saved.body, { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/this-phone", keys: { p256dh: "p", auth: "a" } }, label: "Grammi's phone", kinds: ["comment", "feedback", "app"] });
  assert.ok(api.calls.some((c) => c.path === "push/test"));
  assert.match(text(root), /Grammi's phone gets notifications/);
  assert.match(text(root), /A test notification is on its way/);
}));

test("this browser is recognised by the hash of its endpoint; it can change what it hears, and turn off", withDom(async () => {
  const b = browser({ permission: "granted" });
  await b.navigator.serviceWorker.getRegistration().then((r) => r.pushManager.subscribe({}));
  const mine = { id: "11111111-1111-4111-8111-111111111111", device: await endpointHash("https://fcm.googleapis.com/fcm/send/this-phone"), label: "Grammi's phone", kinds: ["comment", "app"], createdAt: "2026-11-12T12:00:00Z", lastSentAt: "2026-11-13T11:00:00Z" };
  const laptop = { id: "22222222-2222-4222-8222-222222222222", device: "0".repeat(32), label: "Kitchen laptop", kinds: ["quote"], createdAt: "2026-11-12T12:00:00Z", lastSentAt: null };
  const api = server({ devices: [mine, laptop] });
  const root = await open(api, b);
  assert.match(text(root), /Grammi's phone gets notifications; last buzzed 60 minutes ago/);
  assert.match(text(root), /Kitchen laptop: quote requests; nothing sent yet/);
  assert.equal(kind(root, "comment").checked, true);
  assert.equal(kind(root, "quote").checked, false);

  await toggle(kind(root, "comment"));
  assert.deepEqual(api.calls.at(-1), { method: "POST", path: `push/devices/${mine.id}`, body: { kinds: ["app"] } });

  await click(action(root, "turn-off"));
  assert.ok(api.calls.some((c) => c.path === `push/devices/${mine.id}/remove`));
  assert.equal(b.existing(), null, "the browser's subscription is dropped too");
  assert.match(text(root), /Off\. This device won't get notifications/);
}));

test("without the notify key, 'other apps' isn't offered", withDom(async () => {
  const api = server({ otherApps: false });
  const root = await open(api, browser());
  assert.equal(kind(root, "app"), undefined);
  assert.ok(kind(root, "comment"));
  await click(action(root, "turn-on"));
  assert.deepEqual(api.calls.find((c) => c.path === "push/devices").body.kinds, ["comment", "feedback", "quote"]);
}));

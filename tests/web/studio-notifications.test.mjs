// This phone's notifications (Studio R3, parts/push-here.js), ported from the flows in
// admin-notifications.test.mjs: turning on asks the phone first, registers only /admin/sw.js at
// /admin/, saves the name and kinds and sends a test; this browser is found on the list by the hash
// of its endpoint; a sign-up made with an old key is made again; turning off removes it on the
// server before the sign-up goes; Undo signs up again without asking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PushStop, createPushHere, registerWorker } from "../../web/studio/parts/push-here.js";
import { endpointHash, keyBytes } from "../../web/studio/parts/notification-rules.js";

const PUBLIC = "BNJXQLrFqB91iIEvDTQE-lvUxvYyB_Hj57arqlCDifnNudW0TeOybFZdAm45MSdoDRrmo7yK48iuCh2rOHYV7MM";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-phone";
const ID = "11111111-1111-4111-8111-111111111111";

function server({ fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async post(path, json) {
      calls.push({ path, body: json });
      if (fail[path]) throw fail[path];
      if (path === "push/devices") return { device: { id: ID, device: await endpointHash(json.subscription.endpoint), label: json.label, kinds: json.kinds } };
      if (path === "push/test") return { sent: true };
      if (/remove$/.test(path)) return { removed: true };
      throw new Error(`unexpected ${path}`);
    },
  };
}

/** A phone that can get notifications, with every step it was asked to take, in order. */
function browser({ permission = "default", answer = "granted", key = PUBLIC, existing = false, subscribeFails = false } = {}) {
  const asked = [];
  let subscription = null;
  const make = (k) => ({
    endpoint: ENDPOINT,
    options: { applicationServerKey: keyBytes(k).buffer },
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => { asked.push("unsubscribe"); subscription = null; return true; },
  });
  if (existing) subscription = make(key);
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: async (options) => {
      asked.push("subscribe");
      if (subscribeFails) throw new Error("AbortError");
      assert.equal(options.userVisibleOnly, true);
      assert.equal(options.applicationServerKey.length, 65);
      subscription = make(PUBLIC);
      return subscription;
    },
  };
  const registration = { pushManager };
  const Notification = {
    permission,
    requestPermission: () => { asked.push("permission"); Notification.permission = answer; return Promise.resolve(answer); },
  };
  const navigator = {
    serviceWorker: {
      register: async (url, options) => { asked.push(`register ${url} ${options.scope}`); return registration; },
      ready: Promise.resolve(registration),
      getRegistration: async (scope) => { asked.push(`get ${scope}`); return registration; },
    },
  };
  return { navigator, window: { isSecureContext: true, Notification, PushManager() {} }, asked, current: () => subscription };
}

test("the worker is only ever /admin/sw.js at /admin/, and only in a secure context", async () => {
  const b = browser();
  await registerWorker(b.navigator, b.window);
  assert.deepEqual(b.asked, ["register /admin/sw.js /admin/"]);
  const plain = browser();
  assert.equal(await registerWorker(plain.navigator, { isSecureContext: false }), null);
  assert.deepEqual(plain.asked, []);
  assert.equal(await registerWorker({}, {}), null);
});

test("turning on asks the phone before anything else, saves this phone with its kinds, and sends a test", async () => {
  const api = server();
  const b = browser();
  const here = createPushHere({ api, navigator: b.navigator, window: b.window });
  const pending = here.turnOn({ publicKey: PUBLIC, label: "Grammi's phone", kinds: ["comment", "app"] });
  assert.deepEqual(b.asked, ["permission"], "asked inside the press, before any await");
  const result = await pending;
  assert.deepEqual(b.asked, ["permission", "register /admin/sw.js /admin/", "subscribe"]);
  assert.deepEqual(api.calls[0], { path: "push/devices", body: { subscription: { endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }, label: "Grammi's phone", kinds: ["comment", "app"] } });
  assert.deepEqual(api.calls[1], { path: "push/test", body: { id: ID } });
  assert.equal(result.tested, true);
  assert.equal(result.device.label, "Grammi's phone");
});

test("already allowed: no question; a sign-up with this key is reused, one with an old key made again", async () => {
  const same = browser({ permission: "granted", existing: true });
  await createPushHere({ api: server(), navigator: same.navigator, window: same.window }).turnOn({ publicKey: PUBLIC, label: "x", kinds: [] });
  assert.deepEqual(same.asked, ["register /admin/sw.js /admin/"]);

  const OLD = `A${PUBLIC.slice(1, -1)}A`;
  const stale = browser({ permission: "granted", existing: true, key: OLD });
  await createPushHere({ api: server(), navigator: stale.navigator, window: stale.window }).turnOn({ publicKey: PUBLIC, label: "x", kinds: [] });
  assert.deepEqual(stale.asked, ["register /admin/sw.js /admin/", "unsubscribe", "subscribe"]);
});

test("where turning on stops before the server, it says which step; a failed test still turns it on", async () => {
  const stop = async (b) => {
    const api = server();
    const error = await createPushHere({ api, navigator: b.navigator, window: b.window }).turnOn({ publicKey: PUBLIC, label: "x", kinds: [] }).catch((e) => e);
    assert.equal(api.calls.length, 0);
    return error;
  };
  assert.equal((await stop(browser({ answer: "default" }))).reason, "dismissed");
  assert.equal((await stop(browser({ answer: "denied" }))).reason, "denied");
  assert.equal((await stop(browser({ subscribeFails: true }))).reason, "refused");
  const broken = browser();
  broken.navigator.serviceWorker.register = async () => { throw new Error("SecurityError"); };
  assert.ok((await stop(broken)) instanceof PushStop);

  const failing = { status: 502, data: { code: "send-failed" } };
  const api = server({ fail: { "push/test": failing } });
  const b = browser();
  const result = await createPushHere({ api, navigator: b.navigator, window: b.window }).turnOn({ publicKey: PUBLIC, label: "x", kinds: [] });
  assert.equal(result.tested, failing);
  assert.equal(result.device.id, ID);

  const full = server({ fail: { "push/devices": { status: 409, data: { code: "too-many" } } } });
  const c = browser();
  await assert.rejects(createPushHere({ api: full, navigator: c.navigator, window: c.window }).turnOn({ publicKey: PUBLIC, label: "x", kinds: [] }), (e) => e.status === 409);
});

test("this browser is found on the list by the hash of its endpoint", async () => {
  const b = browser({ permission: "granted", existing: true });
  const here = createPushHere({ api: server(), navigator: b.navigator, window: b.window });
  const mine = { id: ID, device: await endpointHash(ENDPOINT) };
  const found = await here.findMine([{ id: "x", device: "0".repeat(32) }, mine]);
  assert.equal(found.mine, mine);
  assert.equal(found.hash, mine.device);
  assert.equal((await here.findMine([{ id: "x", device: "0".repeat(32) }])).mine, null);
  const none = browser();
  assert.deepEqual(await createPushHere({ api: server(), navigator: none.navigator, window: none.window }).findMine([mine]), { subscription: null, hash: null, mine: null });
});

test("turning off removes it on the server first; if that fails the sign-up stays; Undo signs up again without asking", async () => {
  const order = [];
  const b = browser({ permission: "granted", existing: true });
  const api = server();
  const post = api.post.bind(api);
  api.post = (path, json) => { order.push(path); return post(path, json); };
  b.current().unsubscribe = async () => { order.push("unsubscribe"); return true; };
  const here = createPushHere({ api, navigator: b.navigator, window: b.window });
  await here.turnOff({ id: ID });
  assert.deepEqual(order, [`push/devices/${ID}/remove`, "unsubscribe"]);

  const kept = browser({ permission: "granted", existing: true });
  const refusing = server({ fail: { [`push/devices/${ID}/remove`]: { status: 502, data: { code: "hosted-unavailable" } } } });
  await assert.rejects(createPushHere({ api: refusing, navigator: kept.navigator, window: kept.window }).turnOff({ id: ID }));
  assert.ok(kept.current(), "the sign-up stays when the server didn't take it off");

  const again = browser({ permission: "granted" });
  const undoApi = server();
  await createPushHere({ api: undoApi, navigator: again.navigator, window: again.window }).undo({ publicKey: PUBLIC, label: "Kitchen iPad", kinds: ["quote"] });
  assert.ok(!again.asked.includes("permission"));
  assert.deepEqual(undoApi.calls.map((c) => c.path), ["push/devices"], "no test on Undo");
  assert.deepEqual(undoApi.calls[0].body.kinds, ["quote"]);
  assert.equal(undoApi.calls[0].body.label, "Kitchen iPad");

  const gone = browser({ permission: "default" });
  const error = await createPushHere({ api: server(), navigator: gone.navigator, window: gone.window }).undo({ publicKey: PUBLIC, label: "x", kinds: [] }).catch((e) => e);
  assert.equal(error.reason, "dismissed");
});

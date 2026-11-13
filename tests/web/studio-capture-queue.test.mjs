// Ported from admin-capture-queue.test.mjs (Studio R4): the same database, version and format as the
// old Admin's, forever, with Studio's additive keys; sending moved to studio-job-sender.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DB_NAME,
  DB_VERSION,
  QUEUE_LIMITS,
  RECORD_VERSION,
  STORE_NAME,
  captureBytes,
  createCaptureQueue,
  createMemoryStore,
  errorCode,
  errorText,
  isRetryable,
  makeRecord,
  openIndexedStore,
  queueLimits,
  readRecord,
  roomProblem,
  storeExists,
} from "../../web/studio/parts/capture-queue.js";
import * as old from "../../web/admin/capture-queue.js";
import { readFileSync } from "node:fs";

const idOf = (n) => String(n).padStart(32, "0");
const photo = (name, size = 100) => ({ name, type: "image/jpeg", size, blob: new Blob([new Uint8Array(size)]) });
const capture = (n, extra = {}) => ({
  id: idOf(n),
  fields: { trade: "roofing", service: "roof-repair", town: "Elkins", notes: "Words" },
  photos: [photo("a.jpg")],
  audio: null,
  ...extra,
});
const apiError = (status, message = "no", data = null) => Object.assign(new Error(message), { status, data });

test("the database, its version, store and record version are the old Admin's, and never change", () => {
  assert.equal(DB_NAME, "openblog-capture");
  assert.equal(STORE_NAME, "captures");
  assert.equal(RECORD_VERSION, 1);
  assert.equal(DB_VERSION, 1);
  assert.equal(DB_NAME, old.DB_NAME);
  assert.equal(STORE_NAME, old.STORE_NAME);
  assert.equal(RECORD_VERSION, old.RECORD_VERSION);
  assert.match(readFileSync(new URL("../../web/admin/capture-queue.js", import.meta.url), "utf8"), /const DB_VERSION = 1;/);
  assert.deepEqual(QUEUE_LIMITS, old.QUEUE_LIMITS);
});

test("a record is the old format plus who saved it, and each side reads the other's", () => {
  const now = new Date("2026-11-13T16:40:00Z");
  const mine = makeRecord(capture(1), now, "dana");
  const theirs = old.makeRecord(capture(1), now);
  const { by, ...rest } = mine;
  assert.equal(by, "dana");
  assert.deepEqual(rest, theirs, "the same keys and values as the old Admin's");
  assert.equal(readRecord(theirs).state, "ok");
  assert.equal(old.readRecord(mine).state, "ok", "the old Admin reads Studio's records");
  assert.deepEqual(Object.keys(makeRecord(capture(2))).sort(), ["attempts", "audio", "createdAt", "failed", "fields", "id", "lastError", "photos", "v"]);
});

test("a stored value is read defensively: newer versions are kept, damage is reported, nothing throws", () => {
  const good = makeRecord(capture(1));
  assert.deepEqual(readRecord({ ...good, v: 2 }), { state: "newer", id: idOf(1) });
  assert.equal(readRecord({ ...good, v: 0 }).state, "unreadable");
  assert.equal(readRecord(null).state, "unreadable");
  assert.equal(readRecord("text").state, "unreadable");
  assert.equal(readRecord({ ...good, id: "../x" }).state, "unreadable");
  assert.equal(readRecord({ ...good, photos: [{ name: "a", size: 1 }] }).state, "unreadable");
  assert.equal(readRecord({ ...good, photos: Array.from({ length: 13 }, () => photo("a.jpg")) }).state, "unreadable");
  assert.equal(readRecord({ ...good, fields: { ...good.fields, notes: "x".repeat(8001) } }).state, "unreadable");
  assert.equal(readRecord({ ...good, audio: { type: "audio/webm" } }).state, "unreadable");
  const clipped = readRecord({ ...good, lastError: "e".repeat(500), attempts: -3 }).record;
  assert.equal(clipped.lastError.length, 200);
  assert.equal(clipped.attempts, 0);
  const sent = readRecord({ ...good, sent: { path: "posts/a.md", skipped: ["IMG_1.HEIC", 7], removed: "yes" } }).record.sent;
  assert.deepEqual(sent, { path: "posts/a.md", skipped: ["IMG_1.HEIC"], removed: false, audio: "" });
  assert.equal(readRecord({ ...good, sent: { path: "" } }).record.sent, undefined);
});

test("the bounds are finite and named by code: count, bytes per job and bytes in total", () => {
  assert.deepEqual(queueLimits({}), QUEUE_LIMITS);
  assert.equal(queueLimits({ capture: { maxQueued: 2 } }).maxQueued, 2);
  const small = { ...QUEUE_LIMITS, maxQueued: 2, maxCaptureBytes: 1000, maxQueueBytes: 1500 };
  const entry = (n, size) => ({ state: "ok", record: makeRecord(capture(n, { photos: [photo("a.jpg", size)] })) });
  assert.equal(roomProblem([], entry(1, 900).record, small), "");
  assert.equal(roomProblem([], entry(1, 1001).record, small), "maxCaptureBytes");
  assert.equal(roomProblem([entry(1, 900)], entry(2, 700).record, small), "maxQueueBytes");
  assert.equal(roomProblem([entry(1, 1), entry(2, 1)], entry(3, 1).record, small), "maxQueued");
  assert.equal(captureBytes({ photos: [photo("a", 5), photo("b", 7)], audio: { size: 11 } }), 23);
});

test("no answer, a time limit, a busy or failing blog is worth trying again; a refusal isn't", () => {
  for (const error of [new TypeError("Failed to fetch"), apiError(0), apiError(500), apiError(503), apiError(408), apiError(429), apiError(409, "busy", { code: "busy" })]) assert.equal(isRetryable(error), true, error.status);
  for (const error of [apiError(400), apiError(409), apiError(413), apiError(422), apiError(401)]) assert.equal(isRetryable(error), false, error.status);
  assert.equal(errorCode(errorText("offline", "Waiting for a signal.")), "offline");
  assert.equal(errorCode("Waiting for a connection."), "", "the old Admin's words have no code");
});

test("adding keeps a job, says which limit stops one, and a phone out of room is reported, not thrown", async () => {
  const store = createMemoryStore();
  const queue = createCaptureQueue({ store, limits: { ...QUEUE_LIMITS, maxQueued: 2 } });
  assert.equal((await queue.add(capture(1), new Date(), "dana")).ok, true);
  await store.put({ v: 2, id: idOf(9), shape: "from the future" });
  assert.deepEqual(await queue.add(capture(3)), { ok: false, code: "maxQueued" });
  assert.equal(queue.entries().length, 2);
  const full = createCaptureQueue({ store: { ...createMemoryStore(), put: async () => { throw new DOMException("full", "QuotaExceededError"); } } });
  assert.deepEqual(await full.add(capture(1)), { ok: false, code: "write", quota: true });
});

test("a change keeps every key it doesn't know, and a newer or unreadable record is never changed", async () => {
  const store = createMemoryStore();
  const queue = createCaptureQueue({ store });
  const kept = { ...makeRecord(capture(1)), fromLater: { x: 1 } };
  await store.put(kept);
  assert.equal(await queue.update(idOf(1), { attempts: 1 }), true);
  assert.deepEqual(await store.get(idOf(1)), { ...kept, attempts: 1 });
  const newer = { v: 2, id: idOf(2), shape: "from the future" };
  const broken = { v: 1, id: idOf(3), photos: "no" };
  await store.put(newer);
  await store.put(broken);
  assert.equal(await queue.update(idOf(2), { attempts: 9 }), false);
  assert.equal(await queue.update(idOf(3), { attempts: 9 }), false);
  assert.equal(await store.get(idOf(2)), newer);
  assert.equal(await store.get(idOf(3)), broken);
  await queue.refresh();
  assert.deepEqual(queue.entries().map((e) => e.state).sort(), ["newer", "ok", "unreadable"]);
  await queue.discard(idOf(2));
  assert.equal(await store.get(idOf(2)), undefined, "only when she throws it away");
});

test("without IndexedDB there's no store, and asking whether one exists never makes one", async () => {
  assert.equal(await openIndexedStore(null), null);
  assert.equal(await openIndexedStore({ open() { throw new Error("blocked"); } }), null);
  const failing = { open() { const request = {}; queueMicrotask(() => request.onerror?.()); return request; } };
  assert.equal(await openIndexedStore(failing), null);
  let opened = 0;
  const listing = (names) => ({ open() { opened += 1; }, databases: async () => names.map((name) => ({ name, version: 1 })) });
  assert.equal(await storeExists(listing(["studio-new-job"])), false);
  assert.equal(await storeExists(listing(["openblog-capture"])), true);
  assert.equal(await storeExists({ open() { opened += 1; } }), null);
  assert.equal(await storeExists(null), false);
  assert.equal(opened, 0);
});

test("a page asking for a newer version is let in: this one closes", async () => {
  let database;
  const factory = {
    open(name, version) {
      assert.equal(name, "openblog-capture");
      assert.equal(version, 1);
      const request = {};
      database = { objectStoreNames: { contains: () => true }, closed: false, close() { this.closed = true; } };
      queueMicrotask(() => { request.result = database; request.onsuccess(); });
      return request;
    },
  };
  const store = await openIndexedStore(factory);
  database.onversionchange();
  assert.equal(database.closed, true);
  assert.equal(store.closed, true);
});

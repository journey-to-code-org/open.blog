// The jobs waiting on this phone (ADR 0297), moved from web/admin/capture-queue.js for the old
// Admin's retirement (Studio R4, docs/specs/studio/r4/ux.md). Studio and the old Admin read and write
// the same IndexedDB under the same rules, so nothing has to move:
//
// - Same database, version, format, forever: `openblog-capture`, version 1, store `captures`, key
//   `id`, record `v: 1`. Never bump the version, never delete the database or clear the store; close
//   on `versionchange`. A record is removed only after a send the server answered with a path, or
//   when she throws it away. A record this build can't read, or a newer one, is left byte for byte.
// - Additive keys only: `by` (who saved it) and `sent` ({ path, skipped, removed }). The old Admin
//   ignores them. A change is merged into the stored value as it is, so keys this build doesn't
//   know are kept.
//
// Stored format, version 1. One record per job, keyed by its id:
//   { v: 1, id, createdAt, fields: { trade, service, town, notes, draft? },
//     photos: [{ name, type, size, blob }], audio: null | { type, size, seconds, blob },
//     attempts, failed, lastError, by?, sent? }
// `lastError` starts with the reason's code in brackets ("[offline] ...") so the words can be chosen
// again later; the old Admin shows it as it is.
//
// Plain functions and a queue over any store with put/get/all/remove (tested in
// tests/web/studio-capture-queue.test.mjs with an in-memory store); `openIndexedStore` is the
// browser's. A test keeps the constants and the format the same as the old Admin's copy.

import { normalizeDraft } from "./capture-assistant-rules.js";

export const RECORD_VERSION = 1;
export const DB_NAME = "openblog-capture";
export const STORE_NAME = "captures";
export const DB_VERSION = 1;
const MAX_ERROR = 200;
const MAX_NAME = 120;
const ID = /^[0-9a-f]{32}$/;

export const QUEUE_LIMITS = Object.freeze({
  maxPhotos: 12,
  maxNotesChars: 8000,
  maxQueued: 5,
  maxCaptureBytes: 60 * 1024 * 1024,
  maxQueueBytes: 120 * 1024 * 1024,
});

/** The queue's bounds as the server advertised them, with the defaults for any it did not. */
export function queueLimits(meta = {}) {
  const limits = { ...QUEUE_LIMITS };
  for (const key of Object.keys(limits)) {
    const value = meta?.capture?.[key];
    if (Number.isFinite(value) && value > 0) limits[key] = value;
  }
  return limits;
}

const clip = (value, length) => String(value ?? "").slice(0, length);

/** The bytes a job holds: its photos and its voice note. */
export function captureBytes(capture) {
  return capture.photos.reduce((sum, photo) => sum + (photo.size || 0), 0) + (capture.audio?.size || 0);
}

/** The draft entry of a record's fields: a bounded draft, or nothing. */
const draftField = (draft) => {
  const clean = normalizeDraft(draft);
  return clean ? { draft: clean } : {};
};

/** What a send left behind: the draft's path, photos that couldn't go, or that it was deleted there since. */
function sentField(sent) {
  if (!sent || typeof sent !== "object" || typeof sent.path !== "string" || !sent.path) return {};
  const skipped = Array.isArray(sent.skipped) ? sent.skipped.filter((name) => typeof name === "string").map((name) => clip(name, MAX_NAME)).slice(0, 12) : [];
  return { sent: { path: clip(sent.path, 300), skipped, removed: sent.removed === true, audio: sent.audio === "refused" ? "refused" : "" } };
}

/** The record to store for a job. Only the fields of the format are copied, and who saved it. */
export function makeRecord(capture, now = new Date(), by = "") {
  const { trade, service, town, notes } = capture.fields;
  return {
    v: RECORD_VERSION,
    id: capture.id,
    createdAt: now.toISOString(),
    fields: { trade: clip(trade, 80), service: clip(service, 80), town: clip(town, 80), notes: String(notes ?? ""), ...draftField(capture.fields.draft) },
    photos: capture.photos.map(({ name, type, size, blob }) => ({ name: clip(name, MAX_NAME), type: clip(type, 100), size, blob })),
    audio: capture.audio ? { type: clip(capture.audio.type, 100), size: capture.audio.size, seconds: capture.audio.seconds, blob: capture.audio.blob } : null,
    attempts: 0,
    failed: false,
    lastError: "",
    ...(by ? { by: clip(by, 80) } : {}),
  };
}

/**
 * What a stored value is: `{ state: "ok", record }`, `{ state: "newer", id }` for a version this build
 * does not know (left exactly as it is), or `{ state: "unreadable", id }`.
 */
export function readRecord(raw, limits = QUEUE_LIMITS) {
  const id = typeof raw?.id === "string" ? raw.id : "";
  if (!raw || typeof raw !== "object") return { state: "unreadable", id };
  if (raw.v !== RECORD_VERSION) return Number.isInteger(raw.v) && raw.v > RECORD_VERSION ? { state: "newer", id } : { state: "unreadable", id };
  const blobs = (items) => Array.isArray(items) && items.every((item) => item && item.blob instanceof Blob && Number.isFinite(item.size) && item.size >= 0);
  const limit = limits.maxPhotos ?? QUEUE_LIMITS.maxPhotos;
  const notes = typeof raw.fields?.notes === "string" ? raw.fields.notes : "";
  if (!ID.test(id) || !raw.fields || !blobs(raw.photos) || raw.photos.length > limit || notes.length > (limits.maxNotesChars ?? QUEUE_LIMITS.maxNotesChars)) {
    return { state: "unreadable", id };
  }
  if (raw.audio !== null && raw.audio !== undefined && !blobs([raw.audio])) return { state: "unreadable", id };
  const field = (value) => clip(typeof value === "string" ? value : "", 80);
  return {
    state: "ok",
    record: {
      v: RECORD_VERSION,
      id,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
      fields: { trade: field(raw.fields.trade), service: field(raw.fields.service), town: field(raw.fields.town), notes, ...draftField(raw.fields.draft) },
      photos: raw.photos.map(({ name, type, size, blob }) => ({ name: clip(name, MAX_NAME), type: clip(type, 100), size, blob })),
      audio: raw.audio ? { type: clip(raw.audio.type, 100), size: raw.audio.size, seconds: Number(raw.audio.seconds) || 0, blob: raw.audio.blob } : null,
      attempts: Number.isInteger(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
      failed: raw.failed === true,
      lastError: clip(raw.lastError, MAX_ERROR),
      ...(typeof raw.by === "string" && raw.by ? { by: clip(raw.by, 80) } : {}),
      ...sentField(raw.sent),
    },
  };
}

/**
 * Whether the queue can take one more job: "" when it can, otherwise the limit it would pass:
 * `maxQueued`, `maxCaptureBytes` or `maxQueueBytes` (words in parts/job-words.js).
 */
export function roomProblem(entries, record, limits = QUEUE_LIMITS) {
  if (entries.length >= limits.maxQueued) return "maxQueued";
  const bytes = captureBytes(record);
  if (bytes > limits.maxCaptureBytes) return "maxCaptureBytes";
  const held = entries.reduce((sum, entry) => sum + (entry.record ? captureBytes(entry.record) : 0), 0);
  if (held + bytes > limits.maxQueueBytes) return "maxQueueBytes";
  return "";
}

/**
 * A send that should be tried again later: no answer at all (status 0 or none), a time limit, a busy
 * or failing server, or a lock held a moment too long.
 */
export const isRetryable = (error) => error?.status === undefined || error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429 || (error.status === 409 && error.data?.code === "busy");

/** `lastError` for a reason: "[code] words", clipped. */
export const errorText = (code, words = "") => clip(`[${code}] ${words}`.trim(), MAX_ERROR);

/** The code in a stored `lastError` ("[offline] …" → "offline"), or "" for an old Admin's text. */
export const errorCode = (lastError) => /^\[([a-z0-9-]+)\]/.exec(String(lastError || ""))?.[1] || "";

/** An in-memory store with the same calls as the IndexedDB one: for tests and nothing else. */
export function createMemoryStore() {
  const records = new Map();
  return {
    async put(record) { records.set(record.id, record); },
    async get(id) { return records.get(id); },
    async all() { return [...records.values()]; },
    async remove(id) { records.delete(id); },
  };
}

const done = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

const asking = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Whether this browser already holds the database, without opening it (opening would make an empty
 * one on a phone that never kept a job). `true`, `false`, or `null` when the browser can't say.
 */
export async function storeExists(factory = globalThis.indexedDB) {
  if (!factory) return false;
  if (typeof factory.databases !== "function") return null;
  try {
    return (await factory.databases()).some((db) => db?.name === DB_NAME);
  } catch {
    return null;
  }
}

/**
 * The browser's store, or null when IndexedDB is missing, blocked or refuses to open (private modes,
 * policies). Opening makes the database when it isn't there, so callers that must not (a phone that
 * isn't a trade site) ask `storeExists` first. Another page asking for a newer version is let in: this
 * one closes, and every later call fails rather than holding it up.
 */
export function openIndexedStore(factory = globalThis.indexedDB) {
  return new Promise((resolve) => {
    if (!factory) return resolve(null);
    let request;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const database = request.result;
      const store = {
        closed: false,
        async put(record) {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).put(record);
          await done(transaction);
        },
        get: (id) => asking(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id)),
        all: () => asking(database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll()),
        async remove(id) {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).delete(id);
          await done(transaction);
        },
        close() {
          store.closed = true;
          database.close();
        },
      };
      // Another page's update: close at once to let it in. The sender opens it again when it's next
      // needed (an add answers `closed` meanwhile), so a save never reads as a phone out of room.
      database.onversionchange = () => store.close();
      // The browser can close it too (Safari does when the phone is short of memory).
      database.onclose = () => { store.closed = true; };
      resolve(store);
    };
  });
}

/**
 * The queue over a store: `{ entries, refresh, add, update, remove, discard }`. `onChange` is told
 * whenever `entries()` changes. Sending is parts/job-sender.js's.
 */
export function createCaptureQueue({ store, limits = QUEUE_LIMITS, onChange = () => {} }) {
  let entries = [];

  const refresh = async () => {
    const read = (await store.all()).map((raw) => {
      const entry = readRecord(raw, limits);
      return { ...entry, id: entry.record?.id ?? entry.id };
    });
    entries = read.sort((a, b) => String(a.record?.createdAt ?? "").localeCompare(String(b.record?.createdAt ?? "")));
    onChange();
    return entries;
  };

  return {
    entries: () => entries,
    refresh,
    /**
     * Keep a job on this phone. Resolves `{ ok: true, record }`, or `{ ok: false, code }` with a
     * `roomProblem` code, `closed` when the list was closed under it (another window's update; the
     * caller opens it again), or `write` when the phone couldn't keep it. Never throws.
     */
    async add(capture, now = new Date(), by = "") {
      if (store.closed) return { ok: false, code: "closed" };
      try {
        await refresh();
        const record = makeRecord(capture, now, by);
        const code = roomProblem(entries, record, limits);
        if (code) return { ok: false, code };
        await store.put(record);
        await refresh();
        return { ok: true, record };
      } catch (error) {
        if (store.closed || error?.name === "InvalidStateError") return { ok: false, code: "closed" };
        return { ok: false, code: "write", quota: error?.name === "QuotaExceededError" };
      }
    },
    /**
     * Change a readable record's own keys, merged into the value as stored, so keys this build
     * doesn't know are kept. A record that is gone, unreadable or newer is left alone.
     */
    async update(id, changes) {
      const raw = await store.get(id);
      if (readRecord(raw, limits).state !== "ok") return false;
      await store.put({ ...raw, ...changes });
      return true;
    },
    /** Take a record off this phone: only after its send was answered with a path. */
    async remove(id) {
      await store.remove(id);
    },
    /** She threw it away. */
    async discard(id) {
      await store.remove(id);
      await refresh();
    },
  };
}

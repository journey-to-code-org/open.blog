// The copies of her writing kept on this phone (Studio R9), lifted from the old Admin's voice.js
// (ADR 0273). Two records in localStorage, on the same origin as the old Admin, so a copy made in
// either survives the switch:
//
//   ob-voice-draft:<user>                  { v: 1, sessionId, deadline, text, savedAt }
//   ob-voice-polished:<user>:<roughFile>   { v: 1, base, title, body, savedAt }
//
// The names, the versions and the fields never change. A record that doesn't parse or has another
// `v` is ignored, never rewritten or deleted. Nothing over 60 KiB is kept; a rough copy lasts a
// day, a polished one 30. A copy is removed only when its work is safe on the server, when she
// throws it away, on sign-out, or when someone else signs in; never because a request failed.
// `storage` is a function, so a phone that refuses (a private window) is handled where it is read:
// the copy then lives in page memory and every screen says so. No page, no network.
import { VOICE_LIMITS, byteLength, copyIsPastGrace } from "./voice-rules.js";

const DRAFT_VERSION = 1;
const POLISHED_VERSION = 1;
const memory = new Map();
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** How long a copy of private text may stay on this phone. */
export const ROUGH_COPY_TTL_MS = 24 * 60 * 60 * 1000;
export const POLISHED_COPY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const stale = (record, ttl, now) => !Number.isFinite(record.savedAt) || now - record.savedAt > ttl;

export const draftKey = (user) => `ob-voice-draft:${user}`;
export const polishedKey = (user, roughFile) => `ob-voice-polished:${user}:${roughFile}`;

const validDraft = (record) => isObject(record) && record.v === DRAFT_VERSION && typeof record.sessionId === "string" && typeof record.text === "string" && typeof record.deadline === "string" && Number.isFinite(record.savedAt);
const validPolished = (record) => isObject(record) && record.v === POLISHED_VERSION && (record.base === null || typeof record.base === "string") && typeof record.title === "string" && typeof record.body === "string";

function createStore(key, storage, { valid, ttl, make, size }) {
  let blocked = false;
  return {
    get inMemoryOnly() { return blocked; },
    load(now = Date.now()) {
      let found = null;
      let inStorage = false;
      try {
        const text = storage()?.getItem(key);
        const record = text ? JSON.parse(text) : null;
        if (valid(record)) { found = record; inStorage = true; }
      } catch {
        blocked = true;
      }
      found = found || memory.get(key) || null;
      if (found && stale(found, ttl, now)) {
        // An expired copy of ours goes; whatever else sits under the key (a newer shape) stays.
        memory.delete(key);
        if (inStorage) { try { storage()?.removeItem(key); } catch { blocked = true; } }
        return null;
      }
      return found;
    },
    /** Keep the record. One over the limit is not kept (the server would refuse it too). */
    save(fields, now = Date.now()) {
      if (byteLength(size(fields)) > VOICE_LIMITS.maxDraftBytes) return false;
      const record = make(fields, now);
      memory.set(key, record);
      try {
        storage().setItem(key, JSON.stringify(record));
        blocked = false;
      } catch {
        blocked = true;
      }
      return true;
    },
    clear() {
      memory.delete(key);
      try { storage()?.removeItem(key); } catch { blocked = true; }
    },
  };
}

/** The rough draft in progress, one record per sign-in. */
export function createVoiceDraftStore(key, storage = () => globalThis.localStorage) {
  return createStore(key, storage, {
    valid: validDraft, ttl: ROUGH_COPY_TTL_MS, size: (f) => f.text,
    make: ({ sessionId, deadline, text }, now) => ({ v: DRAFT_VERSION, sessionId, deadline, text, savedAt: now }),
  });
}

/** Unsaved changes to a polished copy, one record per rough draft. */
export function createPolishedDraftStore(key, storage = () => globalThis.localStorage) {
  return createStore(key, storage, {
    valid: validPolished, ttl: POLISHED_COPY_TTL_MS, size: (f) => f.body,
    make: ({ base, title, body }, now) => ({ v: POLISHED_VERSION, base: base ?? null, title, body, savedAt: now }),
  });
}

const isVoiceKey = (key) => typeof key === "string" && (key.startsWith("ob-voice-draft:") || key.startsWith("ob-voice-polished:"));

/**
 * Remove voice copies on this phone, by their two prefixes only: nothing else in storage is
 * touched. Signing out removes every one. Signing in removes every copy except `keepUser`'s, so a
 * sign-in that ran out gives the same person her unsaved writing back, and nobody else sees it.
 * Never throws.
 */
export function clearVoiceCopies(storage = () => globalThis.localStorage, { keepUser = null } = {}) {
  const kept = (key) => keepUser !== null && (key === draftKey(keepUser) || key.startsWith(`ob-voice-polished:${keepUser}:`));
  const goes = (key) => isVoiceKey(key) && !kept(key);
  try {
    const store = storage();
    if (store) {
      const keys = [];
      for (let i = 0; i < store.length; i += 1) keys.push(store.key(i));
      for (const key of keys) if (goes(key)) store.removeItem(key);
    }
  } catch {
    // Blocked storage holds nothing to clear.
  }
  for (const key of [...memory.keys()]) if (goes(key)) memory.delete(key);
}

/** This user's records as `[key, record]`, read only: an unreadable one is skipped, never touched. */
function recordsOf(storage, user) {
  const out = [];
  const seen = new Set();
  const take = (key, record) => { if (!seen.has(key)) { seen.add(key); out.push([key, record]); } };
  try {
    const store = storage();
    for (let i = 0; store && i < store.length; i += 1) {
      const key = store.key(i);
      if (key !== draftKey(user) && !String(key).startsWith(`ob-voice-polished:${user}:`)) continue;
      try { take(key, JSON.parse(store.getItem(key))); } catch { /* not ours to read */ }
    }
  } catch {
    // Blocked storage: memory below is all there is.
  }
  for (const [key, record] of memory) if (key === draftKey(user) || key.startsWith(`ob-voice-polished:${user}:`)) take(key, record);
  return out;
}

/**
 * What of hers is kept only on this phone, for Home's list: `[{ kind: "rough" | "polished",
 * roughFile? }]`. A rough copy counts while its session could still be saved (its deadline plus
 * the grace isn't past, or it holds words the server may lack); a polished copy while it's fresh.
 */
export function voiceCopiesOnPhone(storage = () => globalThis.localStorage, user = "", now = Date.now()) {
  if (!user) return [];
  const found = [];
  for (const [key, record] of recordsOf(storage, user)) {
    if (key === draftKey(user)) {
      if (validDraft(record) && !stale(record, ROUGH_COPY_TTL_MS, now) && record.text.trim() && !copyIsPastGrace(record, now)) found.push({ kind: "rough" });
    } else if (validPolished(record) && !stale(record, POLISHED_COPY_TTL_MS, now)) {
      found.push({ kind: "polished", roughFile: key.slice(`ob-voice-polished:${user}:`.length) });
    }
  }
  return found;
}

/** Whether signing out now would throw away writing kept only here (so it asks first). */
export function voiceCopiesAtRisk(storage = () => globalThis.localStorage, user = "", now = Date.now()) {
  return voiceCopiesOnPhone(storage, user, now).length > 0;
}

/** For tests: forget the copies held in page memory. */
export function forgetMemoryCopies() { memory.clear(); }

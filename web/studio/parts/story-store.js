// A recorded story, kept on this phone until it has been turned into words (Studio R9b,
// principle 4). IndexedDB `studio-story` v1, store `recording`, key = the signed-in user, record
// `{ v: 1, promptId, type, seconds, savedAt, blob }`: a permanent shape. Removed only when the
// server answered with a piece, when she tells it again or throws it away, on sign-out, or when
// someone else signs in. The database is opened only when it already exists (or to keep a
// recording), so a phone that never recorded gets nothing. Every call degrades to "nothing kept".
import { STORY_DB, readRecording, recordingRecord } from "./story-rules.js";

const idb = () => globalThis.indexedDB;
const request = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function exists() {
  try {
    if (typeof idb()?.databases !== "function") return true; // can't tell: opening is the only way
    return (await idb().databases()).some((db) => db.name === STORY_DB.name);
  } catch {
    return false;
  }
}

function open() {
  return new Promise((resolve, reject) => {
    const req = idb().open(STORY_DB.name, STORY_DB.version);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORY_DB.store)) req.result.createObjectStore(STORY_DB.store); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, work, { create = false } = {}) {
  if (!idb() || (!create && !(await exists()))) return null;
  const db = await open();
  try {
    if (!db.objectStoreNames.contains(STORY_DB.store)) return null;
    const tx = db.transaction(STORY_DB.store, mode);
    const result = await work(tx.objectStore(STORY_DB.store));
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    return result;
  } finally {
    db.close();
  }
}

/** Keep a finished recording for `user`. Resolves true when it is on the phone. */
export async function keepRecording(user, recording) {
  const record = recordingRecord(recording);
  if (!user || !record) return false;
  try {
    await run("readwrite", (store) => request(store.put(record, user)), { create: true });
    return true;
  } catch {
    return false;
  }
}

/** The recording kept for `user`, or null. A record of another shape is ignored and left alone. */
export async function keptRecording(user) {
  if (!user) return null;
  try {
    return readRecording(await run("readonly", (store) => request(store.get(user))));
  } catch {
    return null;
  }
}

/** Remove `user`'s recording (it became a piece, she told it again, or she threw it away). */
export async function forgetRecording(user) {
  if (!user) return;
  try {
    await run("readwrite", (store) => request(store.delete(user)));
  } catch {
    // Nothing was kept, or it can't be reached: nothing to remove.
  }
}

/** Remove every recording but `keepUser`'s (sign-out: all of them; sign-in: everyone else's). */
export async function clearRecordings({ keepUser = null } = {}) {
  try {
    await run("readwrite", async (store) => {
      const keys = await request(store.getAllKeys());
      for (const key of keys) if (key !== keepUser) store.delete(key);
    });
  } catch {
    // As above.
  }
}

/** Whether `user` has a recording waiting (for Home, and the sign-out question). */
export async function hasRecording(user) {
  return Boolean(await keptRecording(user));
}

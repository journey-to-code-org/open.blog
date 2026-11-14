// The job she's in the middle of on New job (Studio R4): iPhones can reload the page when the
// camera opens, so the form is kept as she goes, in its own database, `studio-new-job` (version 1,
// store `open`, key = who's signed in). Never in `openblog-capture`, so the old Admin can't send a
// half-made job. `keep`, `get` and `clear` never throw: keeping is a help, not a promise.

export const DB_NAME = "studio-new-job";
export const DB_VERSION = 1;
export const STORE_NAME = "open";

function openDb(factory) {
  return new Promise((resolve) => {
    if (!factory) return resolve(null);
    let request;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

const run = (db, mode, work) => new Promise((resolve, reject) => {
  const transaction = db.transaction(STORE_NAME, mode);
  const result = work(transaction.objectStore(STORE_NAME));
  transaction.oncomplete = () => resolve(result?.result);
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

/** `{ keep(user, job), get(user), clear(user) }` over the browser's IndexedDB (or `factory`). */
export function createJobInProgress(factory = globalThis.indexedDB) {
  let db = null;
  const ready = async () => (db ||= await openDb(factory));
  return {
    async keep(user, job) {
      try {
        const opened = await ready();
        if (!opened) return false;
        await run(opened, "readwrite", (store) => store.put({ ...job, keptAt: new Date().toISOString() }, String(user || "")));
        return true;
      } catch {
        return false;
      }
    },
    async get(user) {
      try {
        const opened = await ready();
        if (!opened) return null;
        const job = await run(opened, "readonly", (store) => store.get(String(user || "")));
        return job && typeof job === "object" && typeof job.id === "string" ? job : null;
      } catch {
        return null;
      }
    },
    async clear(user) {
      try {
        const opened = await ready();
        if (!opened) return;
        await run(opened, "readwrite", (store) => store.delete(String(user || "")));
      } catch {
        // Nothing kept is nothing to clear.
      }
    },
  };
}

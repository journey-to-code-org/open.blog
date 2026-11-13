// Edits to published posts, kept on this device until they are on the site. DOM-free: works over
// any Storage-like object. Storage can be missing, full or blocked; every call degrades to a no-op.

const PREFIX = "studio:kept:";

function safely(action, fallback) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

/**
 * Kept edits for one signed-in user, keyed `studio:kept:<user>:<path>`, so a different user
 * never sees another's.
 * @param {{ getItem(key: string): string|null, setItem(key: string, value: string): void, removeItem(key: string): void } | null | undefined} storage
 * @param {string} user
 * @param {{ now?: () => Date }} [options]
 * @returns {{
 *   keep(path: string, etag: string, form: object): boolean,
 *   get(path: string): { etag: string, form: object, at: string } | null,
 *   clear(path: string): void,
 * }}
 */
export function createKept(storage, user, { now = () => new Date() } = {}) {
  const usable = Boolean(storage) && typeof user === "string" && user !== "";
  const keyFor = (path) => `${PREFIX}${user}:${path}`;

  return {
    /** Keeps the form for a post opened at `etag`. Returns whether it was stored. */
    keep(path, etag, form) {
      if (!usable || !path) return false;
      return safely(() => {
        storage.setItem(keyFor(path), JSON.stringify({ etag: String(etag ?? ""), form, at: now().toISOString() }));
        return true;
      }, false);
    },

    /** The kept edits for a post, or null when there are none or they can't be read. */
    get(path) {
      if (!usable || !path) return null;
      return safely(() => {
        const raw = storage.getItem(keyFor(path));
        if (raw == null) return null;
        const value = JSON.parse(raw);
        if (!value || typeof value !== "object" || !value.form || typeof value.form !== "object") return null;
        return { etag: String(value.etag ?? ""), form: value.form, at: String(value.at ?? "") };
      }, null);
    },

    /** Forgets the kept edits for a post (after Update, or "Use what's on the site"). */
    clear(path) {
      if (!usable || !path) return;
      safely(() => storage.removeItem(keyFor(path)), undefined);
    },
  };
}

// Undo for a reading path or a reading comparison: the server keeps the file a write replaced and
// answers its name (`replaced`, G97); putting it back sends that name with the revision now stored.
// One slot, kept while she moves between the list and the editor, gone when she closes it, does
// something else to the same thing, or reloads. Studio R13; docs/specs/studio/r13/ux.md.
import { h } from "./dom.js";

let slot = null;
const listeners = new Set();
const tell = () => listeners.forEach((fn) => fn(slot));

/**
 * Remember what a write replaced: `{ base, slug, name, revision, title, what }`. `base` is the route
 * (`reading-paths` or `comparisons`); `revision` is what is stored now (null when the file is gone, after
 * a delete); `what` is "save" or "delete".
 */
export function remember(entry) {
  slot = entry && entry.name ? { ...entry } : null;
  tell();
}

export const current = (base) => (slot && slot.base === base ? slot : null);
export const forget = () => remember(null);

/** Called with the slot whenever it changes; returns what stops listening. */
export function watch(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Put the copy back. Resolves `{ reply }` on success; `{ gone }` when the name is gone (404), `{ changed }`
 * when the file changed since (409), `{ error }` otherwise. The slot is cleared on success and on gone.
 */
export async function putBack(api, entry) {
  try {
    const reply = await api.post(`${entry.base}/restore`, { slug: entry.slug, name: entry.name, revision: entry.revision ?? null });
    forget();
    return { reply };
  } catch (error) {
    if (error.status === 404) { forget(); return { gone: true }; }
    if (error.status === 409) return { changed: true };
    return { error };
  }
}

/** The line that offers Undo: the words, an Undo button and a way to dismiss it. The caller says every word. */
export function undoLine({ words, undo, dismiss, onUndo, onClose }) {
  return h("div", { class: "studio-undo-line", role: "status", "aria-live": "polite" },
    h("span", { text: words }), " ",
    h("action-button", { variant: "secondary", size: "sm", onClick: onUndo }, undo),
    h("action-button", { variant: "secondary", size: "sm", onClick: onClose }, dismiss));
}

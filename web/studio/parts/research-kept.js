// Research forms kept while she moves between research screens (Studio R11, decision 7): a source,
// passage or note she was changing stays filled in when she opens another research screen or goes
// back to her post, and comes back exactly as she left it. In memory only: nothing private is
// written to storage, so a reload or closing the app ends them (and asks first). Pure, DOM-free.

const kept = new Map();

/** Keep a form: `{ screen, id, what, name, hash, state, scroll }`. */
export function keepForm(key, entry) {
  kept.set(key, { ...entry, key });
}

/** The form kept under `key`, taken out of the list (it is open again), or null. */
export function takeForm(key) {
  const entry = kept.get(key) || null;
  kept.delete(key);
  return entry;
}

/** The form kept under `key`, still kept, or null. */
export const peekForm = (key) => kept.get(key) || null;

/** Every kept form, oldest first. */
export const keptForms = () => [...kept.values()];

/** Leave one out (she chose Never mind, or saved it). */
export const dropForm = (key) => { kept.delete(key); };

/** Leave them all out (she left research and said so). */
export const dropAll = () => { kept.clear(); };

// Bringing back what the old Admin kept unsaved (R15 ⚑ 4), in words any blog can use
// (docs/studio-words.md). Pure data, read with `say()` from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  "restore.oldHeading": { text: "Bring back changes you didn't save?", layer: "her" },
  "restore.oldText": { text: "They were kept on this {noun} before {product}'s screens changed.", layer: "her" },
  "restore.bringBack": { text: "Bring them back", layer: "her" },
  "restore.throwAway": { text: "Throw them away", layer: "her" },
  "restore.throwAsk": { text: "Throw away the changes you didn't save?", layer: "her" },
  "restore.throwText": { text: "What's saved stays as it is. The changes can't come back after this.", layer: "her" },
  "restore.keep": { text: "Keep them", layer: "her" },
  "restore.broughtBack": { text: "Brought back. They aren't saved yet: look them over, then Save.", layer: "her" },
  "restore.thrown": { text: "Thrown away. What's saved is unchanged.", layer: "her" },
  "restore.details": { text: "Kept as {key}, last changed {when}.", layer: "details" },
};

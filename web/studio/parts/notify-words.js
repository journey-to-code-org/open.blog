// Notifications, in words any blog can use (docs/studio-words.md). Pure data, read with `say()`
// from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  // The push function knows no app names (one notify key for all of them), so they're named by what they are.
  "notify.appSwitch": { text: "News from your other apps", layer: "her" },
  "notify.nameHelp": { text: "So you can tell them apart, like Work phone.", layer: "her" },
  "notify.nameMissing": { text: "Give it a name, like Work phone.", layer: "her" },
  "notify.canTurnOn": { text: "{helper} can turn them on. Your blog works the same without them.", layer: "her" },
};

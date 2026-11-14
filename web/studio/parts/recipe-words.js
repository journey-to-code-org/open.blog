// Recipes, in words a site may change (docs/studio-words.md). Pure data, read with `say()` from
// words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  // Written into a new recipe's Markdown as its heading: only new recipes change.
  "recipe.notesHeading": { text: "Notes", layer: "her", max: 60 },
  "recipe.askAddName": { text: "This recipe doesn't say who wrote it. Ask {helper} to add your name.", layer: "her" },
};

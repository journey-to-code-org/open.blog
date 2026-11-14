// Pages and collections, in words any blog can use (docs/studio-words.md): the examples name
// things every site might have, never one owner's. Pure data, read with `say()` from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  "kinds.pagesAbout": { text: "Pages stay put, like About or Contact. Posts come and go by date.", layer: "her" },
  "kinds.collectionsAbout": { text: "A collection gathers posts on one page, like all your posts on one topic. Put a post in one from the post itself.", layer: "her" },
  "kinds.collectionsEmpty": { text: "A collection gathers posts on one page, like all your posts on one topic.", layer: "her" },
  "write.collectionHelp": { text: "Put it with others, like all your posts on one topic.", layer: "her" },
};

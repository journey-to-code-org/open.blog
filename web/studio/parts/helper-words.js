// Sentences that point her to {helper}, from screens and parts with no words file of their own
// (docs/studio-words.md). Each id is named for its area; when an area gains a `*-words.js` file,
// its ids move there with the same names. Pure data, read with `say()` from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  "about.aliasFix": { text: "An old address in this post can't be used. {helper} can fix it in the file.", layer: "her" },
  "copy.notReady": { text: "Your blog can't make a copy for it right now. Try another, or tell {helper}.", layer: "her" },
  "checklist.freeSpot": { text: "Ask {helper} to free that spot.", layer: "her" },
  "undo.mayFind": { text: "“{title}” can't come back from here. {helper} may still find it.", layer: "her" },
  "undo.askHelp": { text: "There's a new {one} with that name now. Ask {helper} to help bring this one back.", layer: "her" },
  "home.filesVanish": { text: "This server doesn't keep its files when it restarts. Ask {helper} to fix that.", layer: "her" },
  "home.notUpdated": { text: "Your site couldn't be updated. Your work is saved. Let {helper} know; the details are under Your site.", layer: "her" },
  "look.notAccepted": { text: "Your site's settings didn't accept these choices. Your choices are still here; try a different one, or tell {helper}.", layer: "her" },
  "install.signInFirst": { text: "You'll sign in once more from the new icon, so have your password handy. If you don't know it, ask {helper} first.", layer: "her" },
};

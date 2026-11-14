// Words many screens share: how she is pointed to the person who helps her with her site. Each is
// a word id a site can change (docs/studio-words.md); `{helper}` is "the person who set up your
// site" unless the site names someone. Pure data, read with `say()` from words.js.

/** @type {Record<string, { text: string, layer: "her" | "details", max?: number, bare?: string }>} */
export const WORDS = {
  "common.tell": { text: "Tell {helper}.", layer: "her" },
  "common.ask": { text: "Ask {helper}.", layer: "her" },
  "common.letKnow": { text: "Let {helper} know.", layer: "her" },
  "common.forHelper": { text: "For {helper}", layer: "her" },
  "common.detailsFor": { text: "Details for {helper}", layer: "her" },
  "common.canTurnOn": { text: "{helper} can turn it on.", layer: "her" },
  "common.chose": { text: "{helper} chose this.", layer: "her" },
  "common.canChange": { text: "{helper} can change that.", layer: "her" },
  "common.keepsHappening": { text: "Try again, and if it keeps happening, tell {helper}.", layer: "her" },
};

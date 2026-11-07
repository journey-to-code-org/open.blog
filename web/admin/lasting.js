// What Admin tells the owner when what she saves may not last (ADR 0353). Plain text only. The server
// decides when this applies and sends it as `filesMayVanish`.

export const FILES_MAY_VANISH_TITLE = "Your saved work is not safe here yet";

export const FILES_MAY_VANISH_BODY = "The server this site runs on starts fresh when it restarts, and that can happen at any time: after a quiet spell, or after you publish. When it does, drafts, saved changes and photos that were not published can vanish. Ask whoever set up this site to look up “Keep your work safe” in its setup guide. Until then, keep your own copy of anything you would hate to lose.";

/** The one line every other page carries. It links to the notice on Overview. */
export const FILES_MAY_VANISH_SHORT = "Saved work can vanish if the server restarts";

const SAVED_CAN_VANISH = "It can still vanish if the server restarts. Only what you publish is kept.";

/** A save's own message, with the truth about it added where saving does not keep things. */
export function savedMessage(message, filesMayVanish) {
  return filesMayVanish ? `${message} ${SAVED_CAN_VANISH}` : message;
}

/** The line in the bar under Save. The bar is what she is looking at, so a save's warning has to be there too. */
export function savedLine(filesMayVanish, savedOnThisVisit) {
  return filesMayVanish && savedOnThisVisit ? "All changes saved. They can vanish if the server restarts, until you publish." : "All changes saved.";
}

/** The Landing page's words for Save, in its Help list and its tour, where Save does not keep things. */
export const SAVE_MEANING_FOR_NOW = "Holds your changes for now. They can vanish if the server restarts, until you publish.";

export const TOUR_LAST_STEP_FOR_NOW = "Preview shows your page the way visitors will see it. Save holds your changes for now, but they can vanish if the server restarts. Publish (make it live) puts your saved page on your site and keeps it.";

/** The Help list as this site should say it. */
export function glossaryFor(glossary, filesMayVanish) {
  if (!filesMayVanish) return glossary;
  return glossary.map((entry) => (entry.term === "Save" ? { ...entry, meaning: SAVE_MEANING_FOR_NOW } : entry));
}

/** A tour step's words as this site should say them: only the step about Save differs. */
export function tourBodyFor(step, filesMayVanish) {
  return filesMayVanish && step.body.includes("Save keeps your changes") ? TOUR_LAST_STEP_FOR_NOW : step.body;
}

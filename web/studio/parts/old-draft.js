// Unsaved Front page and Look changes the old Admin kept in this browser (R15 ⚑ 4), offered back
// once. The old Admin kept them under `ob-landing-draft:<user>` and `ob-look-draft:<user>` with
// `createDraftStore` (parts/landing-rules.js, the same code). When one is there and differs from
// what is saved, a banner asks: Bring them back puts them in the form as unsaved work (so leaving
// asks first), Throw them away asks once. Either removes that one key; nothing else is touched.
// docs/specs/studio/r15/spec.md.
import { h, toast } from "./dom.js";
import { ask } from "./dialogs.js";
import { createDraftStore, draftTimeText } from "./landing-rules.js";
import { deviceNoun, herePhone } from "./notification-rules.js";
import { say } from "./words.js";

/** The old Admin's key for a screen's unsaved copy: "landing" or "look". */
export const oldDraftKey = (screen, user) => `ob-${screen}-draft:${user}`;

/**
 * Offer the old copy, if there is one worth offering, in `host`.
 * @param {{ host: HTMLElement, screen: "landing"|"look", user: string, saved: object,
 *   same: (a: object, b: object) => boolean, isContent?: (page: object) => boolean,
 *   restore: (page: object) => void, storage?: () => Storage }} options
 * @returns {boolean} whether a banner is shown
 */
export function offerOldDraft({ host, screen, user, saved, same, isContent, restore, storage }) {
  if (!user) return false;
  const key = oldDraftKey(screen, user);
  const store = createDraftStore(key, storage, isContent);
  const record = store.load();
  if (!record) return false;
  // The same as what is saved: nothing to bring back, so the copy has done its job.
  if (same(record.page, saved)) {
    store.clear();
    return false;
  }
  const device = deviceNoun(herePhone({ navigator: globalThis.navigator, window: globalThis }));
  const done = (words) => {
    store.clear();
    banner.remove();
    toast(words);
  };
  const bring = h("action-button", { size: "sm", onClick: () => { restore(structuredClone(record.page)); done(say("restore.broughtBack")); } }, say("restore.bringBack"));
  const away = h("action-button", { size: "sm", variant: "secondary", onClick: async () => {
    const choice = await ask({ heading: say("restore.throwAsk"), text: say("restore.throwText"),
      choices: [{ label: say("restore.keep"), value: "keep", variant: "secondary" }, { label: say("restore.throwAway"), value: "away", variant: "destructive" }] });
    if (choice === "away") done(say("restore.thrown"));
    else away.focus?.();
  } }, say("restore.throwAway"));
  const banner = h("alert-banner", { variant: "info", heading: say("restore.oldHeading"), "data-old-draft": screen },
    h("p", { text: say("restore.oldText", { noun: device }) }),
    h("div", { class: "studio-row" }, bring, away),
    h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
      h("p", { class: "studio-mono", text: say("restore.details", { key, when: draftTimeText(record.savedAt) || "at an unknown time" }) })));
  host.append(banner);
  return true;
}

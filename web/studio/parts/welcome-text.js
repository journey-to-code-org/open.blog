// About your blog's words by question and choice (ONB1): every id literal, so each is checked to
// exist and to be used. Read after configureWords(), so a site's own words apply.
import { say } from "./words.js";

const QUESTION = {
  kind: () => say("welcome.q.kind"),
  together: () => say("welcome.q.together"),
  seasons: () => say("welcome.q.seasons"),
  sharing: () => say("welcome.q.sharing"),
  readers: () => say("welcome.q.readers"),
  amount: () => say("welcome.q.amount"),
};

const CHOICE = {
  "kind.technical": () => say("welcome.c.kind.technical"),
  "kind.recipes": () => say("welcome.c.kind.recipes"),
  "kind.trade": () => say("welcome.c.kind.trade"),
  "kind.teaching": () => say("welcome.c.kind.teaching"),
  "kind.research": () => say("welcome.c.kind.research"),
  "kind.podcast": () => say("welcome.c.kind.podcast"),
  "kind.docs": () => say("welcome.c.kind.docs"),
  "kind.personal": () => say("welcome.c.kind.personal"),
  "together.solo": () => say("welcome.c.together.solo"),
  "together.few": () => say("welcome.c.together.few"),
  "seasons.yes": () => say("welcome.c.seasons.yes"),
  "seasons.no": () => say("welcome.c.seasons.no"),
  "sharing.yes": () => say("welcome.c.sharing.yes"),
  "sharing.later": () => say("welcome.c.sharing.later"),
  "sharing.no": () => say("welcome.c.sharing.no"),
  "readers.yes": () => say("welcome.c.readers.yes"),
  "readers.no": () => say("welcome.c.readers.no"),
  "amount.essentials": () => say("welcome.c.amount.essentials"),
  "amount.everything": () => say("welcome.c.amount.everything"),
};

const HELP = {
  "together.few": () => say("welcome.h.together.few"),
  "seasons.yes": () => say("welcome.h.seasons.yes"),
  "sharing.yes": () => say("welcome.h.sharing.yes"),
  "amount.essentials": () => say("welcome.h.amount.essentials"),
  "amount.everything": () => say("welcome.h.amount.everything"),
};

const WHAT = {
  technical: () => say("welcome.w.technical"),
  recipes: () => say("welcome.w.recipes"),
  trade: () => say("welcome.w.trade"),
  teaching: () => say("welcome.w.teaching"),
  research: () => say("welcome.w.research"),
  podcast: () => say("welcome.w.podcast"),
  docs: () => say("welcome.w.docs"),
  personal: () => say("welcome.w.personal"),
};

/** The question, in her words. */
export const questionText = (id) => QUESTION[id]?.() || "";
/** A choice's words. */
export const choiceText = (question, choice) => CHOICE[`${question}.${choice}`]?.() || "";
/** The line under a choice, or "". */
export const choiceHelp = (question, choice) => HELP[`${question}.${choice}`]?.() || "";

/**
 * Why an area is shown or tucked away, in her words. `reason` is `areasFor`'s `{ why }`;
 * `answers` the answers it came from.
 */
export function reasonText(reason = {}, answers = {}) {
  const what = WHAT[answers.kind]?.() || "";
  switch (reason.why) {
    case "kind": return say("welcome.why.kind", { what });
    case "together": return say("welcome.why.together");
    case "seasons": return say("welcome.why.seasons");
    case "sharing": return say("welcome.why.sharing");
    case "readers": return say("welcome.why.readers");
    case "inUse": return say("welcome.why.inUse");
    case "hidden.kind": return say("welcome.why.hidden.kind", { what });
    case "hidden.together": return say("welcome.why.hidden.together");
    case "hidden.seasons": return say("welcome.why.hidden.seasons");
    case "hidden.sharing": return say("welcome.why.hidden.sharing", { answer: choiceText("sharing", answers.sharing).toLowerCase() });
    case "hidden.readers": return say("welcome.why.hidden.readers");
    default: return say("welcome.why.unasked");
  }
}

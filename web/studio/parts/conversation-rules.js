// What we say together's rules (Studio R14b), lifted from the old Admin's continuing conversation:
// the kinds of thing said together, each with a question to start from, an item as words, and a
// move that never loses or repeats one. Pure and DOM-free; words come from say().
import { say } from "./words.js";
import { joinNames } from "./together-rules.js";

/** The kinds, each with a question she may use, change or ignore. */
export const SYNTHESIS_KINDS = Object.freeze([
  { value: "agreement", words: () => say("talk.kindAgreement"), prompt: () => say("talk.promptAgreement") },
  { value: "difference", words: () => say("talk.kindDifference"), prompt: () => say("talk.promptDifference") },
  { value: "question", words: () => say("talk.kindQuestion"), prompt: () => say("talk.promptQuestion") },
  { value: "application", words: () => say("talk.kindApplication"), prompt: () => say("talk.promptApplication") },
  { value: "uncertainty", words: () => say("talk.kindUncertainty"), prompt: () => say("talk.promptUncertainty") },
]);

export function synthesisKindLabel(kind) {
  return SYNTHESIS_KINDS.find((item) => item.value === kind)?.words() || say("talk.kindOther");
}

const names = (people) => joinNames((people || []).map((person) => person.displayName));

/** One item as words: its kind, who it speaks for, who agreed and who is still to agree. */
export function synthesisItemText(item) {
  return say("talk.itemLine", {
    kind: synthesisKindLabel(item?.kind),
    speaking: names(item?.contributors) || say("talk.noOne"),
    agreed: names(item?.approved) || say("talk.noOneYet"),
    waiting: names(item?.awaiting) || say("talk.noOne"),
  });
}

/** The new order of item ids after moving one by `delta`, or null when it can't move. */
export function moveSynthesisItem(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The change to send for an item she adds: kind, words, and the others it speaks for. */
export function synthesisAddChange({ kind, markdown, others = [] }) {
  const words = String(markdown ?? "");
  if (!words.trim()) return { error: say("talk.needWords"), field: "words" };
  return { change: { action: "add", kind: SYNTHESIS_KINDS.some((k) => k.value === kind) ? kind : "agreement", markdown: words, others: [...new Set(others)] } };
}

/** Where the "questions to start from" choice is remembered for one sign-in; the old Admin's key is read once. */
export const promptsKey = (user) => `studio:together:${user}:promptsHidden`;
export const OLD_PROMPTS_KEY = "ob-admin-synthesis-prompts-dismissed";

// About your blog (ONB1): the first-run questions, what each answer does to the areas, and how
// the answers ride in the address until they are saved. Pure: no page, no network, no storage.
import { AREA_IDS, KIND_AREAS, KINDS } from "./area-rules.js";

/** The questions, in order, with their choices (`crates/openblog-cli/src/admin_preferences.rs` QUESTIONS). */
export const QUESTIONS = Object.freeze([
  { id: "kind", choices: Object.keys(KINDS) },
  { id: "together", choices: ["solo", "few"] },
  { id: "seasons", choices: ["yes", "no"] },
  { id: "sharing", choices: ["yes", "later", "no"] },
  { id: "readers", choices: ["yes", "no"] },
  { id: "amount", choices: ["essentials", "everything"] },
]);
export const QUESTION_IDS = Object.freeze(QUESTIONS.map((q) => q.id));
/** The screens after the questions. */
export const AFTER = Object.freeze(["summary", "suggestions", "voice"]);

/** Only known questions with known choices. */
export function cleanAnswers(answers = {}) {
  const out = {};
  for (const { id, choices } of QUESTIONS) {
    const choice = answers?.[id];
    if (typeof choice === "string" && choices.includes(choice)) out[id] = choice;
  }
  return out;
}

/** Answers as the address carries them: `kind.recipes~seasons.yes` (question order). */
export function answersQuery(answers = {}) {
  const clean = cleanAnswers(answers);
  return QUESTION_IDS.filter((id) => clean[id]).map((id) => `${id}.${clean[id]}`).join("~");
}

/** The answers in an address's `a=`; anything unknown is left out. */
export function answersFrom(query = "") {
  const out = {};
  for (const pair of String(query || "").split("~")) {
    const [id, choice] = pair.split(".");
    if (id && choice) out[id] = choice;
  }
  return cleanAnswers(out);
}

/** The address of a screen of About your blog, carrying the answers. */
export function welcomeHash(step, answers = {}) {
  const a = answersQuery(answers);
  const base = step && step !== QUESTION_IDS[0] ? `#/welcome/${step}` : "#/welcome";
  return a ? `${base}?a=${a}` : base;
}

/** The screen a `#/welcome/<arg>` address is: a question id, an AFTER id, or the first question. */
export function welcomeStep(arg = "") {
  return QUESTION_IDS.includes(arg) || AFTER.includes(arg) ? arg : QUESTION_IDS[0];
}

/** The screen after `step` (a question, then summary). Suggestions and the voice offer follow by their own rule. */
export function stepAfter(step) {
  const at = QUESTION_IDS.indexOf(step);
  if (at >= 0) return at + 1 < QUESTION_IDS.length ? QUESTION_IDS[at + 1] : "summary";
  const after = AFTER.indexOf(step);
  return after >= 0 && after + 1 < AFTER.length ? AFTER[after + 1] : null;
}

/** The screen before `step`, or null on the first question. */
export function stepBefore(step) {
  const at = QUESTION_IDS.indexOf(step);
  if (at > 0) return QUESTION_IDS[at - 1];
  if (at === 0) return null;
  const after = AFTER.indexOf(step);
  return after > 0 ? AFTER[after - 1] : after === 0 ? QUESTION_IDS.at(-1) : null;
}

/** "Question n of 6": the place of a question (1-based), 0 when it isn't one. */
export const questionNumber = (step) => QUESTION_IDS.indexOf(step) + 1;

/** Which answer hides an area, when one does. */
const HIDER = Object.freeze({ seasonal: ["seasons", "no"], sharing: ["sharing", ["later", "no"]], readers: ["readers", "no"], together: ["together", "solo"] });
/** Which answer turns an area on, when one does (besides a kind). */
const SHOWER = Object.freeze({ seasonal: ["seasons", "yes"], sharing: ["sharing", "yes"], readers: ["readers", "yes"], together: ["together", "few"] });

/**
 * What the answers do: `{ shown, hidden, reasons, showEverything }`. `reasons[area]` is
 * `{ why, question? }` with `why` one of `kind`, `together`, `seasons`, `sharing`, `readers`,
 * `inUse`, `unasked` for a shown area and `hidden.<question>` for a hidden one. Only an explicit
 * answer hides; an area the site uses is always shown ("Already on your blog").
 */
export function areasFor(answers = {}, inUse = []) {
  const a = cleanAnswers(answers);
  const used = new Set((Array.isArray(inUse) ? inUse : []).filter((id) => AREA_IDS.includes(id)));
  const kindAreas = a.kind ? KINDS[a.kind].areas : null;
  const shown = [];
  const hidden = [];
  const reasons = {};
  for (const id of AREA_IDS) {
    let hide = null;
    let why = null;
    if (KIND_AREAS.includes(id) && kindAreas) {
      if (kindAreas.includes(id)) why = { why: "kind", question: "kind" };
      else hide = { why: "hidden.kind", question: "kind" };
    } else if (HIDER[id]) {
      const [question, no] = HIDER[id];
      const [, yes] = SHOWER[id];
      if (a[question] === yes) why = { why: question, question };
      else if (a[question] && (Array.isArray(no) ? no.includes(a[question]) : a[question] === no)) hide = { why: `hidden.${question}`, question };
    }
    if (used.has(id)) {
      shown.push(id);
      reasons[id] = { why: "inUse" };
    } else if (hide) {
      hidden.push(id);
      reasons[id] = hide;
    } else {
      shown.push(id);
      reasons[id] = why || { why: "unasked" };
    }
  }
  return { shown, hidden, reasons, showEverything: a.amount === "everything" };
}

/** The `PUT areas` body that saves the answers (without its etag). */
export function savePatch(answers = {}, inUse = []) {
  const a = cleanAnswers(answers);
  const result = areasFor(a, inUse);
  return { onboarding: { state: "done" }, kind: a.kind || null, answers: a, shown: result.shown, hidden: result.hidden, showEverything: result.showEverything };
}

/** Answers to start from: the address's, else this login's saved ones, else init's kind. */
export function startingAnswers(fromAddress, saved = {}, hint = null) {
  if (Object.keys(fromAddress || {}).length) return cleanAnswers(fromAddress);
  const kept = cleanAnswers(saved || {});
  if (Object.keys(kept).length) return kept;
  return hint && KINDS[hint] ? { kind: hint } : {};
}

/**
 * Whether a fresh Getting started run should begin with the questions: this login hasn't answered
 * them (a practice run included: rehearsing as her shows them while hers are unanswered).
 */
export const asksFirst = (areas = {}) => (areas?.onboarding?.state || "pending") === "pending";

// Suggestions as she types (Studio R8): when a pause asks the helper for the next few words, what
// that request carries, and when an answer is too old to use. Lifted from the old Admin's
// autocomplete (ADR 0287: an 850 ms pause, Tab to take it, a stale answer dropped). Pure.
//
// It is off until she turns it on, for one post and one visit, and what comes back is plain words
// that go in only when she chooses.
import { helperSource, moreThanWords } from "./helper-rules.js";

/** How long she stops typing before one is asked for. */
export const PAUSE_MS = 850;
/** The fewest letters before her caret, in that box, worth suggesting from. */
export const MIN_PREFIX = 12;
/** The most of the box sent on each side of her caret, and the longest post it works on (the server's limits). */
export const MAX_SIDE = 8000;
export const MAX_POST = 100_000;
/** Failures in a row before it turns itself off. */
export const MAX_FAILURES = 3;

/** The boxes it works in: her words, never a title, a summary, a row of a recipe or a card. */
export const SUGGEST_BOXES = Object.freeze(["words", "story", "notes", "problem", "found", "did", "result"]);

const letters = (text) => Array.from(String(text ?? "")).length;

/**
 * Whether a pause asks for a suggestion. `capture` is `{ kind (the box's kind), prefix, body,
 * inCard, selecting, online, busy }`. `{ ask: true }`, or `{ ask: false, why }` where `why` is
 * "place" (not a box of her words), "short", "long" (the post is too long: it turns off),
 * "signal", "busy" (one is on its way: a newer pause waits) or "selecting".
 */
export function shouldSuggest(capture = {}) {
  if (!SUGGEST_BOXES.includes(capture.kind) || capture.inCard) return { ask: false, why: "place" };
  if (capture.selecting) return { ask: false, why: "selecting" };
  if (letters(capture.body) > MAX_POST) return { ask: false, why: "long" };
  if (letters(String(capture.prefix ?? "").trim()) < MIN_PREFIX) return { ask: false, why: "short" };
  if (capture.online === false) return { ask: false, why: "signal" };
  if (capture.busy) return { ask: false, why: "busy" };
  return { ask: true, why: "" };
}

/** The last `max` letters of a text, never cutting a character in half. */
const tail = (text, max) => Array.from(String(text ?? "")).slice(-max).join("");
const head = (text, max) => Array.from(String(text ?? "")).slice(0, max).join("");

/**
 * The body of `POST assistant/complete`: her title, the post's details without anything that says
 * where she was, her words, and the box's text before and after her caret.
 */
export function completionRequest(capture = {}, form = {}, contextIds = []) {
  return {
    source: {
      title: String(form.title ?? ""),
      metadata: helperSource(form),
      markdown: String(form.body ?? ""),
      prefix: tail(capture.prefix, MAX_SIDE),
      suffix: head(capture.suffix, MAX_SIDE),
      editorMode: "markdown",
    },
    contextIds: [...new Set(contextIds)],
  };
}

/** What a capture is compared by: the box, her caret, her words and everything else that was sent. */
export function captureKey(capture = {}, form = {}, contextIds = []) {
  return JSON.stringify([capture.box, capture.at, String(capture.prefix ?? ""), String(capture.suffix ?? ""), String(form.title ?? ""), helperSource(form), [...contextIds].sort()]);
}

/**
 * Whether an answer still fits: nothing she typed, moved to, or changed in the title, details or
 * notes since it was asked for. A stale answer is dropped without a word.
 */
export function captureIsCurrent(captured, now) {
  return typeof captured === "string" && captured.length > 0 && captured === now;
}

/**
 * The suggested words made plain before they are shown or go into her words: one paragraph of
 * text, no control characters, nothing that is more than words (helper-rules `moreThanWords`:
 * markup, a link, an address, code, or the start of a heading, a list or a quote); cut at 400 letters. "" when nothing usable is left.
 */
export function plainCompletion(text) {
  if (typeof text !== "string") return "";
  const whole = text.replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  // The same rule as a suggestion from Read it over, on everything that came back, before its
  // lines are joined: more than words never goes in.
  if (moreThanWords(text)) return "";
  const clean = whole.split(/\n\s*\n/)[0].replace(/\n+/g, " ");
  return Array.from(clean).slice(0, 400).join("").replace(/\s+$/, "");
}

/** Her box's words with the suggestion put in at her caret: `{ text, at }` (the caret after it). */
export function insertCompletion(value, at, words) {
  const text = String(value ?? "");
  const caret = Math.max(0, Math.min(Number(at) || 0, text.length));
  const before = text.slice(0, caret);
  // One space between her last word and the suggestion, never two.
  const joined = before && !/\s$/.test(before) && !/^[\s.,;:!?)'’”]/.test(words) ? ` ${words}` : /\s$/.test(before) ? words.replace(/^\s+/, "") : words;
  return { text: before + joined + text.slice(caret), at: caret + joined.length };
}

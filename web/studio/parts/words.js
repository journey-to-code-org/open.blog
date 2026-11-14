// Studio's words: every sentence a site may change, by a stable id (docs/studio-words.md).
//
//   say("common.tell")                     → "Tell the person who set up your site."
//   say("people.cantRemove", { name })     → per-call values fill {name}
//
// Defaults live beside the words they replace, in pure `parts/*-words.js` files that export
// `WORDS`; this module gathers them (`catalog()`). A site's changes arrive in `meta.studioWords`
// (checked by the server) and are put in place with `configureWords()` before the shell starts.
// Changes are checked again here, and one that fails is ignored: the built-in words show.
//
// Three variables fill every sentence: `{helper}` (who helps her with the site), `{product}` (what
// she calls her site) and `{owner}` (her name; may be empty, when an id's `bare` text is used).
// A variable that starts a sentence starts with a capital. An unknown id throws: callers
// pass a literal id, so the tests find every one. What `say()` returns is text: it is placed with
// `textContent` or non-address attributes only, never as markup, an address or a style. Pure.
import { WORDS as common } from "./common-words.js";
import { WORDS as helper } from "./helper-words.js";
import { WORDS as cards } from "./card-words.js";
import { WORDS as decorations } from "./season-words.js";
import { WORDS as jobs } from "./job-words.js";
import { WORDS as kinds } from "./kind-words.js";
import { WORDS as notify } from "./notify-words.js";
import { WORDS as photo } from "./photo-words.js";
import { WORDS as quotes } from "./quote-words.js";
import { WORDS as recipe } from "./recipe-words.js";
import { WORDS as share } from "./share-words.js";
import { WORDS as social } from "./social-words.js";
import { WORDS as add } from "./add-words.js";
import { WORDS as pieces } from "./piece-words.js";
import { WORDS as forms } from "./form-words.js";
import { HER_BANNED } from "./plain-words.js";

/** The three variables and their built-in values. */
export const DEFAULT_VARS = Object.freeze({ helper: "the person who set up your site", product: "your blog", owner: "" });
export const GLOBAL_VARS = Object.freeze(Object.keys(DEFAULT_VARS));
export const ID_PATTERN = /^[a-z]+(\.[a-zA-Z0-9]+)+$/;
const VAR_MAX = 60;

let merged = null;
/** Every id with its default: `{ text, layer, max, bare?, vars }`. Built on first use. */
export function catalog() {
  if (merged) return merged;
  const out = {};
  for (const words of [common, helper, cards, decorations, jobs, kinds, notify, photo, quotes, recipe, share, social, add, pieces, forms]) {
    for (const [id, entry] of Object.entries(words || {})) {
      if (id in out) throw new Error(`word id ${id} is defined twice`);
      out[id] = Object.freeze({ ...entry, max: maxFor(entry), vars: varsIn(entry.text) });
    }
  }
  merged = Object.freeze(out);
  return merged;
}

/** The variables a text uses, in order, once each. */
export function varsIn(text) {
  return [...new Set([...String(text).matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]))];
}

/** The longest a changed text may be: its own `max`, else twice the default (at least 40), at most 240. */
export function maxFor(entry) {
  return entry.max ?? Math.min(240, Math.max(40, 2 * String(entry.text).length));
}

let vars = { ...DEFAULT_VARS };
let text = {};

/** Why a changed text can't be used, or "" when it can (the client's re-check). */
export function overrideProblem(id, value) {
  const entry = catalog()[id];
  if (!entry) return "not a word id";
  if (typeof value !== "string") return "not text";
  if (!value.trim() && !(entry.bare === "" && value === "")) return "empty";
  if (value.length > entry.max) return "too long";
  if (/[<>]/.test(value)) return "has < or >";
  const allowed = new Set([...GLOBAL_VARS, ...entry.vars]);
  if (varsIn(value).some((name) => !allowed.has(name))) return "unknown variable";
  if (entry.layer === "her" && HER_BANNED.test(value)) return "a word she never sees";
  return "";
}

/** Why a variable's value can't be used, or "". */
export function varProblem(name, value) {
  if (!GLOBAL_VARS.includes(name)) return "not a variable";
  if (typeof value !== "string") return "not text";
  if (value.length > VAR_MAX) return "too long";
  if (/[{}<>]/.test(value)) return "has a brace or < >";
  if (name !== "owner" && !value.trim()) return "empty";
  if (HER_BANNED.test(value)) return "a word she never sees";
  return "";
}

/**
 * Put a site's words in place, from `meta.studioWords` ({ vars, text }). Anything that fails the
 * checks above is left out. Called with nothing, it goes back to the built-in words.
 */
export function configureWords(studioWords) {
  vars = { ...DEFAULT_VARS };
  text = {};
  const given = studioWords && typeof studioWords === "object" ? studioWords : {};
  for (const [name, value] of Object.entries(given.vars || {})) if (!varProblem(name, value)) vars[name] = value.trim();
  for (const [id, value] of Object.entries(given.text || {})) if (!overrideProblem(id, value)) text[id] = value;
}

/** The variables in effect (for Details). */
export const wordVars = () => ({ ...vars });

const capital = (value) => value.charAt(0).toUpperCase() + value.slice(1);

/** Fill in the variables; one that starts a sentence (the text's start, or after . ! ? and a space) starts with a capital. */
function fillIn(words, values) {
  let out = "";
  let from = 0;
  for (const m of words.matchAll(/\{([a-zA-Z]+)\}/g)) {
    out += words.slice(from, m.index);
    from = m.index + m[0].length;
    if (!(m[1] in values)) { out += m[0]; continue; }
    const value = String(values[m[1]] ?? "");
    out += /(^|[.!?]\s+)$/.test(out) ? capital(value) : value;
  }
  return out + words.slice(from);
}

/**
 * The words for `id`, with the site's change if it has one, its variables filled in.
 * @param {string} id a literal id, like "common.tell"
 * @param {Record<string, string|number>} [values] values for the id's own variables
 */
export function say(id, values = {}) {
  const entry = catalog()[id];
  if (!entry) throw new Error(`say(): ${id} isn't a word id`);
  const all = { ...vars, ...values };
  const own = text[id];
  let words = own ?? entry.text;
  // With no name for her, words that need it give way: a site's change to the built-in words when
  // those don't name her, else the id's `bare` words.
  const usesOwner = (t) => varsIn(t).includes("owner");
  if (!String(all.owner || "").trim() && usesOwner(words)) {
    if (own !== undefined && !usesOwner(entry.text)) words = entry.text;
    else if (entry.bare !== undefined) words = entry.bare;
  }
  return fillIn(words, all);
}

/**
 * Home's details, "Words" (for {helper} only, never her layer): what a site's words change and what
 * was dropped, from `meta.studioWords`. `null` when nothing is changed and nothing is wrong.
 * @returns {{ summary: string, changes: string[], problems: string[] } | null}
 */
export function wordsInEffect(studioWords) {
  const given = studioWords && typeof studioWords === "object" ? studioWords : {};
  const from = given.from && typeof given.from === "object" ? given.from : {};
  const value = (key) => (key in (given.vars || {}) && GLOBAL_VARS.includes(key) ? given.vars[key] : (given.text || {})[key]);
  const keys = Object.keys(from).filter((key) => typeof value(key) === "string").sort();
  const problems = (Array.isArray(given.problems) ? given.problems : []).map((p) => String(p?.words ?? "")).filter(Boolean);
  if (!keys.length && !problems.length) return null;
  const count = (place) => keys.filter((key) => from[key] === place).length;
  const site = count("site");
  const server = count("server");
  const parts = [site ? `${site} changed by this site` : "", server ? `${server} by the server's file` : ""].filter(Boolean);
  const summary = parts.length ? `${parts.join(", ")}.` : "Nothing changed.";
  const place = (p) => (p === "server" ? "server's file" : "site");
  return { summary, changes: keys.map((key) => `${key}: ${value(key)} (${place(from[key])})`), problems };
}

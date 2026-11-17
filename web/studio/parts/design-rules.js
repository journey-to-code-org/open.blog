// The rules of Describe a new look (Studio R9, docs/specs/studio/r9/ux.md), lifted from the old
// Admin's theme-designer.js (ADR 0410) with its behaviour and tests, and what R9 adds: a colour
// she changes by hand, an early warning when it will be hard to read, the server's notes in her
// words, and going back to the draft before. Pure: no page, no network.
//
// The server decides every colour that is saved. `contrastRatio` here is a port of
// `look_contrast::contrast` so the page can warn early; it never chooses what is kept.
import { say } from "./words.js";
import { CHOICES, CONTROL_TEXT } from "./look-rules.js";

export const MAX_DESCRIPTION = 1000;
export const MAX_LABEL = 40;
/** How many drafts "Back to the one before" can step through (page memory only). */
export const MAX_HISTORY = 20;

/** The six colours of a scheme, in the order she sees them. */
export const ROLES = Object.freeze(["page", "surface", "text", "muted", "border", "accent"]);
/** The roles that carry writing: each gets "Easy to read". */
export const WRITING_ROLES = Object.freeze(["text", "muted", "accent"]);

/** A role's name in her words. */
export function roleName(role) {
  switch (role) {
    case "page": return say("design.rolePage");
    case "surface": return say("design.roleSurface");
    case "text": return say("design.roleText");
    case "muted": return say("design.roleMuted");
    case "border": return say("design.roleBorder");
    default: return say("design.roleAccent");
  }
}

/** Ideas to start from, generic by rule: `[{ name, text }]`, read when asked (after the site's words). */
export function IDEAS() {
  return [
    { name: say("design.idea1Name"), text: say("design.idea1") },
    { name: say("design.idea2Name"), text: say("design.idea2") },
    { name: say("design.idea3Name"), text: say("design.idea3") },
    { name: say("design.idea4Name"), text: say("design.idea4") },
    { name: say("design.idea5Name"), text: say("design.idea5") },
  ];
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const HEX = /^#[0-9a-f]{6}$/;
/** `#abc` or `#AABBCC` as `#aabbcc`, or null for anything else (never a name, a function or CSS). */
export function normalHex(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (HEX.test(text)) return text;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/**
 * The swatches of one scheme, as the server made them: `[{ key, label, color }]`. `colors` is the
 * made theme's (`theme.colors` from a draft, or `colors` from a preview); a value that isn't a
 * plain hex colour is left out, so nothing else ever reaches a style.
 */
export function swatches(theme, scheme) {
  const colors = isObject(theme?.colors?.[scheme]) ? theme.colors[scheme] : {};
  return ROLES.filter((key) => normalHex(colors[key])).map((key) => ({ key, label: roleName(key), color: normalHex(colors[key]) }));
}

/** What is wrong with a description, in her words, or "". */
export function descriptionProblem(text) {
  const value = String(text ?? "").trim();
  if (!value) return say("design.describeEmpty");
  if ([...value].length > MAX_DESCRIPTION) return say("design.describeLong", { n: [...value].length.toLocaleString("en-US") });
  return "";
}

/** What is wrong with a look's name, or "". `taken` are the names she already has. */
export function labelProblem(text, taken = []) {
  const value = String(text ?? "").trim();
  if (!value) return say("design.nameEmpty");
  if ([...value].length > MAX_LABEL) return say("design.nameLong");
  if (/[\u0000-\u001f]/u.test(String(text))) return say("design.nameLine");
  if (taken.some((name) => String(name).trim().toLowerCase() === value.toLowerCase())) return say("design.nameTaken", { name: value });
  return "";
}

/** The draft with a new name, as the server will check it again. */
export function renamed(draft, label) {
  return { ...draft, label: String(label ?? "").trim() };
}

/** The Start from choices: every look of the site except the plain engine default, by name. */
export function startFrom(options) {
  const themes = Array.isArray(options?.themes) ? options.themes : [];
  return themes
    .filter((theme) => typeof theme?.name === "string" && (theme.name !== "base" || options.current === "base"))
    .map((theme) => ({ value: theme.name, label: String(theme.label || theme.name) }));
}

/**
 * The look Start from begins on: the one that is up (`wearing`, from the seasons), then the
 * stored one (`current`), then the first. A site decorated by the calendar stores its plain look,
 * so starting there would drop the season's touches she is looking at.
 */
export function startDefault(themes = [], current = "", wearing = "") {
  const has = (name) => Boolean(name) && themes.some((theme) => theme.value === name);
  return has(wearing) ? wearing : has(current) ? current : (themes[0]?.value || "");
}

/**
 * The draft with one colour changed by hand, or null when `hex` isn't a colour or the role isn't
 * one of the six: nothing but a checked hex ever enters a draft.
 */
export function withColor(draft, scheme, role, hex) {
  const color = normalHex(hex);
  if (!color || !ROLES.includes(role) || (scheme !== "light" && scheme !== "dark") || !isObject(draft?.[scheme])) return null;
  return { ...draft, [scheme]: { ...draft[scheme], [role]: color } };
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const n = (at) => parseInt(hex.slice(at, at + 2), 16);
  return 0.2126 * channel(n(1)) + 0.7152 * channel(n(3)) + 0.0722 * channel(n(5));
};

/** The contrast of two hex colours, 1 to 21, as `look_contrast::contrast` gives it; 0 when either isn't a colour. */
export function contrastRatio(hexA, hexB) {
  const a = normalHex(hexA);
  const b = normalHex(hexB);
  if (!a || !b) return 0;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * How each writing colour reads on the page and on boxes: `[{ role, ground, ratio, ok }]`, `ok`
 * at 4.5 to 1. For the early warning and for {helper}'s details; the server decides.
 */
export function readablePairs(colors = {}) {
  const pairs = [];
  for (const role of WRITING_ROLES) {
    for (const ground of ["page", "surface"]) {
      const ratio = contrastRatio(colors[role], colors[ground]);
      if (ratio) pairs.push({ role, ground, ratio: Math.round(ratio * 10) / 10, ok: ratio >= 4.5 });
    }
  }
  return pairs;
}

/** Whether a colour she picked for `role` will be moved by the server (a writing colour under 4.5 to 1, or a ground that makes one so). */
export function willAdjust(colors = {}, role) {
  const pairs = readablePairs(colors);
  if (WRITING_ROLES.includes(role)) return pairs.some((pair) => pair.role === role && !pair.ok);
  if (role === "page" || role === "surface") return pairs.some((pair) => pair.ground === role && !pair.ok);
  return false;
}

const PLURAL_ROLES = new Set(["surface", "border", "accent"]);
const schemeWords = (scheme) => (scheme === "dark" ? say("design.inDark") : say("design.inLight"));
const replacementWords = (name) => (name === "black" ? say("design.withBlack") : name === "white" ? say("design.withWhite") : name === "page" ? say("design.withPage") : say("design.withText"));
/** A role's name inside a sentence: lower case ("the writing"). */
const inSentence = (role) => { const name = roleName(role); return name.charAt(0).toLowerCase() + name.slice(1); };

/**
 * One readability note in her words. `note` is the server's (G67): `{ scheme, role, change:
 * "darker" | "lighter" | "replaced", with? }`; a plain sentence (an older server) is shown as it is.
 */
export function noteWords(note) {
  if (typeof note === "string") return note;
  if (!isObject(note)) return "";
  const vars = { scheme: schemeWords(note.scheme), role: inSentence(note.role) };
  // Boxes, edges, links and buttons are many things: "are", "they".
  const many = PLURAL_ROLES.has(note.role);
  if (note.change === "darker") return many ? say("design.noteDarkerMany", vars) : say("design.noteDarker", vars);
  if (note.change === "lighter") return many ? say("design.noteLighterMany", vars) : say("design.noteLighter", vars);
  if (note.change === "replaced") {
    const with_ = { ...vars, replacement: replacementWords(note.with) };
    return many ? say("design.noteReplacedMany", with_) : say("design.noteReplaced", with_);
  }
  return typeof note.words === "string" ? note.words : "";
}

/**
 * What to say after she picked a colour, from the server's notes for that role and scheme:
 * `{ kind: "picked" | "adjusted" | "replaced", words }`.
 */
export function pickedWords(changes = [], scheme, role) {
  const name = roleName(role);
  const note = (Array.isArray(changes) ? changes : []).find((c) => isObject(c) && c.scheme === scheme && c.role === role);
  if (note?.change === "darker" || note?.change === "lighter") return { kind: "adjusted", words: say("design.colorAdjusted", { role: name, way: note.change === "darker" ? say("design.darker") : say("design.lighter") }) };
  if (note?.change === "replaced") return { kind: "replaced", words: say("design.colorReplaced", { role: name, replacement: replacementWords(note.with) }) };
  return { kind: "picked", words: say("design.colorPicked", { role: name }) };
}

const choiceLabel = (list, id) => (CHOICES[list] || []).find((choice) => choice.id === id)?.label;

/** "Lettering: Classic for writing, Modern for headings. Corners: Soft. Writing size: Large." */
export function letteringLine(draft = {}, baseLabel = "") {
  const from = say("design.fromBase", { base: baseLabel || say("design.baseOwn") });
  return say("design.letteringLine", {
    body: choiceLabel("fontStyle", draft.font) || from,
    heading: choiceLabel("fontStyle", draft.headingFont) || from,
    corners: choiceLabel("roundness", draft.roundness) || from,
    size: choiceLabel("textSize", draft.textSize) || from,
  });
}

/**
 * Which of Look's choices still apply on top of a new look: `{ accent, others: [names] }`.
 * `look` is the stored look (`GET look`.look), `honored` the controls the look honours (or the
 * preview's `lookApplied`).
 */
export function lookOverrides(look = {}, honored = null) {
  const set = Object.keys(isObject(look) ? look : {}).filter((key) => key !== "version" && look[key] && CONTROL_TEXT[key] && (!Array.isArray(honored) || honored.includes(key)));
  return { accent: set.includes("accent"), others: set.filter((key) => key !== "accent").map((key) => CONTROL_TEXT[key].label) };
}

/** Keep `entry` as the newest step of the history (at most `MAX_HISTORY`). */
export function pushDraft(history = [], entry) {
  return [...history, entry].slice(-MAX_HISTORY);
}

/** Step back one: `{ history, entry }` with the entry to show, or null when there is none before. */
export function backDraft(history = []) {
  if (history.length < 2) return null;
  const next = history.slice(0, -1);
  return { history: next, entry: next.at(-1) };
}

/**
 * One failed design call beyond R8's `helperProblem`: `{ code, words, field }` for the codes of
 * the look routes (G65), or null when it is a helper problem.
 */
/**
 * What Undo of a saved look says when it can't: `{ words, again }`, where `again` offers Undo once
 * more (no signal, or the server stumbled). Too late and in use say so; nothing was removed.
 */
export function undoWords(error = {}, name = "") {
  const status = Number(error?.status) || 0;
  const code = typeof error?.data?.code === "string" ? error.data.code : "";
  if (status === 0) return { words: say("design.undoNoSignal", { name }), again: true };
  if (code === "expired") return { words: say("design.undoExpired", { name }), again: false };
  if (code === "in-use") return { words: say("design.undoTooLate", { name }), again: false };
  return { words: say("design.notSaved"), again: true };
}

export function designProblem(error = {}) {
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const status = Number(error?.status) || 0;
  const code = typeof data.code === "string" ? data.code : "";
  const out = (c, words, field = "") => ({ code: c, words, field, details: typeof data.error === "string" ? data.error : "" });
  if (status === 0) return out("no-signal", say("design.noSignal"));
  switch (code) {
    case "no-description": return out(code, say("design.describeEmpty"), "description");
    case "too-long": return out(code, say("design.describeLong", { n: "1,000+" }), "description");
    case "base-gone": return out(code, say("design.baseGone"), "base");
    case "invalid-result": return out(code, say("design.badIdea"));
    case "name-taken": case "exists": return out(code, say("design.nameTaken", { name: String(data.name || "") }), "name");
    case "bad-draft": return out(code, say("design.cantSave"));
    case "in-use": case "expired": return out(code, "");
    default: break;
  }
  if (status === 422) return out("content", say("design.previewFailed"));
  if (status >= 500 && !code) return out("server", say("design.notSaved"));
  return null;
}

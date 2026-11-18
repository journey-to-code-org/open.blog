// Your part's rules (Studio R14a), lifted from the old Admin's draft panel: ideas to start from,
// putting words in at the caret, part breaks as cards in place, what the status line says, and
// other people's words as paragraphs of text. Pure and DOM-free.
//
//   joinParts(partBlocks(text)) === text, byte for byte, for every text.
import { say } from "./words.js";

/** The line that starts a new part (ADR 0029). Readers never see it. */
export const PART_MARKER_LINE = "<!-- openblog:part -->";
/** How many versions of one part the server keeps (`MAX_REVISIONS_PER_DRAFT`). */
export const MAX_VERSIONS = 200;
/** When the status starts saying how many saves are left. */
export const NEARLY_FULL = 190;

/** Optional starting points; she can ignore, edit or delete any of them. */
export const reflectionPrompts = () => [say("part.idea1"), say("part.idea2"), say("part.idea3"), say("part.idea4")];

/** What an idea puts in her words: a plain quote that is hers once it is in. */
export function promptInsertion(prompt) {
  return `> ${String(prompt).replace(/\s+/g, " ").trim()}\n\n`;
}

/** Insert text at a selection (or at the end), returning the new text and where the caret goes. */
export function insertAtSelection(text, start, end, insertion) {
  const length = text.length;
  const from = Number.isInteger(start) && start >= 0 && start <= length ? start : length;
  const to = Number.isInteger(end) && end >= from && end <= length ? end : from;
  return { text: text.slice(0, from) + insertion + text.slice(to), caret: from + insertion.length };
}

/** What Start a new part puts at the caret: the marker alone on its own line. */
export function partBreakInsertion() {
  return `\n${PART_MARKER_LINE}\n`;
}

const isMarker = (line) => line.replace(/\n$/, "").replace(/\r$/, "") === PART_MARKER_LINE;

/**
 * Her part as boxes of words with a part-break card between them, split exactly where the
 * server splits it (`reflection::split_parts`): `[{ kind: "words", text }, { kind: "break", raw },
 * ...]`, always starting and ending with words (perhaps empty).
 */
export function partBlocks(text) {
  const source = String(text ?? "");
  const blocks = [];
  let words = "";
  for (const line of source.split(/(?<=\n)/)) {
    if (line && isMarker(line)) {
      blocks.push({ kind: "words", text: words }, { kind: "break", raw: line });
      words = "";
    } else {
      words += line;
    }
  }
  blocks.push({ kind: "words", text: words });
  return blocks;
}

/**
 * The text again. A break is a line of its own, so words she edited that now end without a
 * newline get one before it; untouched text comes back byte for byte.
 */
export function joinParts(blocks) {
  let out = "";
  for (const [index, block] of blocks.entries()) {
    if (block.kind === "break") {
      if (out && !out.endsWith("\n")) out += "\n";
      out += block.raw.endsWith("\n") || !blocks[index + 1]?.text ? block.raw : `${block.raw}\n`;
    } else {
      out += block.text;
    }
  }
  return out;
}

/** How many parts her words have. */
export const partCount = (text) => partBlocks(text).filter((block) => block.kind === "break").length + 1;

/** Take the `n`th break out (0 for the first): the parts on either side become one. */
export function removePartBreak(text, n) {
  const blocks = partBlocks(text);
  const at = blocks.findIndex((block, index) => block.kind === "break" && blocks.slice(0, index).filter((b) => b.kind === "break").length === n);
  if (at < 0) return String(text ?? "");
  const [a, b] = [blocks[at - 1].text, blocks[at + 1].text];
  // The two parts' words stay two paragraphs.
  const joined = a.trim() && b.trim() && !/\n[ \t]*\r?\n$/.test(a) ? `${a.replace(/\n?$/, "\n")}\n${b}` : a + b;
  return joinParts([...blocks.slice(0, at - 1), { kind: "words", text: joined }, ...blocks.slice(at + 2)]);
}

/** Paragraph runs: `[{ text, gap }]` where `gap` is the blank lines after it, so joining them gives the words back. */
function paragraphs(text) {
  const runs = [];
  const re = /(\n[ \t]*\r?\n[\s]*)/g;
  let from = 0;
  for (const m of String(text).matchAll(re)) {
    runs.push({ text: text.slice(from, m.index), gap: m[0] });
    from = m.index + m[0].length;
  }
  runs.push({ text: text.slice(from), gap: "" });
  return runs.filter((run, index, all) => run.text !== "" || index === all.length - 1 || run.gap !== "");
}

const glue = (runs) => runs.map((run) => run.text + run.gap).join("");

/**
 * Move the `n`th break by one paragraph: up (`by` -1) takes the last paragraph before it into the
 * part after; down (+1) the other way. Nothing is lost; null when it can't move.
 */
export function movePartBreak(text, n, by) {
  const blocks = partBlocks(text);
  const at = blocks.findIndex((block, index) => block.kind === "break" && blocks.slice(0, index).filter((b) => b.kind === "break").length === n);
  if (at < 0) return null;
  const before = paragraphs(blocks[at - 1].text.replace(/\n$/, ""));
  const after = paragraphs(blocks[at + 1].text);
  const content = (runs) => runs.filter((run) => run.text.trim());
  if (by < 0) {
    if (!content(before).length) return null;
    const last = before.pop();
    while (before.length && !before[before.length - 1].text.trim()) before.pop();
    const head = glue(before).replace(/\s+$/, "");
    const rest = glue(after);
    blocks[at - 1] = { kind: "words", text: head ? `${head}\n` : "" };
    blocks[at + 1] = { kind: "words", text: rest.trim() ? `${last.text}\n\n${rest}` : `${last.text}\n` };
  } else {
    if (!content(after).length) return null;
    const first = after.shift();
    const head = glue(before).replace(/\s+$/, "");
    blocks[at - 1] = { kind: "words", text: head ? `${head}\n\n${first.text}\n` : `${first.text}\n` };
    blocks[at + 1] = { kind: "words", text: glue(after).replace(/^\s+/, "") };
  }
  return joinParts(blocks);
}

/**
 * Someone's part as plain text to read: paragraphs, and a thin rule labelled "Part 2" where a
 * new part starts. Never markup.
 * @returns {Array<{ kind: "p", text: string } | { kind: "break", label: string }>}
 */
export function partParagraphs(markdown) {
  const out = [];
  let number = 1;
  for (const block of partBlocks(markdown)) {
    if (block.kind === "break") {
      number += 1;
      out.push({ kind: "break", label: say("part.breakLabel", { n: number }) });
      continue;
    }
    for (const run of block.text.split(/\n[ \t]*\r?\n/)) {
      const words = run.replace(/\r/g, "").trim();
      if (words) out.push({ kind: "p", text: words });
    }
  }
  return out;
}

/**
 * The status line, with no version numbers: one id's words. `state` is one of saving, conflict,
 * offline, kept (on this computer, not yet saved), changedSince (shared, then changed), shared,
 * saved, empty.
 */
export function draftStateText({ saving = false, offline = false, kept = false, dirty = false, saved = 0, shared = false, changedSince = false } = {}) {
  if (saving) return say("part.saving");
  if (offline && (dirty || kept)) return say("part.waitingSignal");
  if (dirty || kept) return say("part.keptHere");
  if (shared && changedSince) return say("part.changedSince");
  if (shared) return say("part.sharedStatus");
  if (saved > 0) return say("part.saved");
  return say("part.nothingYet");
}

/** Saves left, said only when there are few: "" until 190 versions. */
export function savesLeftText(number) {
  const left = MAX_VERSIONS - Number(number || 0);
  if (left <= 0) return say("part.full");
  return Number(number || 0) >= NEARLY_FULL ? say("part.nearlyFull", { n: left }) : "";
}

/**
 * How her part is kept as she types. Until a working copy exists on the server (G114), every
 * change is kept on this computer and a version is sent on Save, on leaving and before sharing,
 * so typing never spends versions. ⚑ 6.
 */
export function partSaveMode(meta) {
  return meta?.together?.workingCopy === true ? "working" : "version";
}

// ---- several parts per writer (#705): `GET collaboration/contributions`

/**
 * A writer's own parts as the server lists them, split into the first (the part every writer
 * has: its id is the writer's own) and the ones added after it, in her order. Each is
 * `{ id, number, text }`. Anything that isn't a part with an id is left out.
 */
export function ownParts(reply) {
  const views = (Array.isArray(reply?.contributions) ? reply.contributions : [])
    .filter((view) => typeof view?.stamp?.contributionId === "string" && view.stamp.contributionId)
    .map((view) => ({ id: view.stamp.contributionId, mine: view.stamp.contributionId === view.stamp.authorParticipantId,
      number: Number.isInteger(view.stamp.number) ? view.stamp.number : 0, text: String(view.markdown ?? "") }));
  const first = views.find((view) => view.mine) || null;
  const part = ({ id, number, text }) => ({ id, number, text });
  return { first: first ? part(first) : null, extras: views.filter((view) => view !== first).map(part),
    orderRevision: Number.isInteger(reply?.orderRevision) ? reply.orderRevision : 0 };
}

/** The body that moves one added part by one place: the order she saw and the one she wants, the first part first in both. */
export function partOrderPayload(publicationId, first, extras, index, by, orderRevision) {
  const to = index + by;
  if (!first || index < 0 || index >= extras.length || to < 0 || to >= extras.length) return null;
  const ids = extras.map((part) => part.id);
  const next = [...ids];
  [next[index], next[to]] = [next[to], next[index]];
  return { publicationId, expectedRevision: orderRevision, expected: [first.id, ...ids], order: [first.id, ...next] };
}

/** What "Let the others read it" offers when she has added parts: every current part at its saved version. */
export function partOffers(first, extras) {
  return [first, ...extras].filter(Boolean).map((part) => ({ contributionId: part.id, revision: part.number }));
}

/** The number of the first added part with no words, counted as she sees them (the first part is 1), or 0. */
export function emptyAddedPart(extras) {
  const at = extras.findIndex((part) => !String(part.text ?? "").trim());
  return at < 0 ? 0 : at + 2;
}

// ---- sharing with people you choose (#705)

/** The people a writer may name, from the reveal slots: `{ id, name }`, in the server's order. */
export function readerChoices(slots) {
  return (Array.isArray(slots) ? slots : [])
    .filter((slot) => slot?.mayReceive === true && typeof slot.participantId === "string" && slot.participantId)
    .map((slot) => ({ id: slot.participantId, name: String(slot.displayName || "") }));
}

/**
 * Whom she has already chosen, from her own reveal slots: `{ newest, earlier }`, each a list of
 * names. `newest` hold her latest saved words in every part; `earlier` were chosen before a change.
 */
export function chosenReaders(slots) {
  const out = { newest: [], earlier: [] };
  for (const slot of Array.isArray(slots) ? slots : []) {
    if (typeof slot?.chosen !== "boolean") continue;
    (slot.chosen ? out.newest : out.earlier).push(String(slot.displayName || ""));
  }
  return out;
}

/**
 * What someone was chosen to read, as `[{ name, texts }]`: one entry per writer in the order
 * the server gave, each with that writer's parts in order. The name is the one the server sent
 * beside the part, else the one the list of people has, else "".
 */
export function sharedWithYou(reply, people) {
  const names = new Map((Array.isArray(people) ? people : []).map((person) => [person?.id || person?.participantId, String(person?.displayName || "")]));
  const writers = new Map();
  for (const view of Array.isArray(reply?.contributions) ? reply.contributions : []) {
    const author = view?.stamp?.authorParticipantId;
    if (typeof author !== "string") continue;
    if (!writers.has(author)) writers.set(author, { name: String(view.authorName || names.get(author) || ""), texts: [] });
    writers.get(author).texts.push(String(view.markdown ?? ""));
  }
  return [...writers.values()];
}

// The notebook's rules (Studio R11, Notebook): passages (the exact words she read, with where they
// are) and notes (her own observations and questions), search, and what a notebook copy would
// bring in. Pure, DOM-free. Lifted from the old Admin (web/admin/admin.js "research notebook
// capture", removed in R15) with places as rows rather than typed lines, and every sentence a word
// id. Quoted words are kept exactly: never trimmed, normalised or reflowed.
import { say } from "./words.js";
import { sourceLabel } from "./source-rules.js";

export const QUESTION_STATES = Object.freeze(["open", "resolved"]);
export const NOTE_KINDS = Object.freeze(["observation", "question"]);
/** The kinds of place a passage or citation names. */
export const PLACE_KINDS = Object.freeze(["page", "folio", "line", "section", "chapter", "canonical", "timestamp"]);

const MAX_NOTEBOOK_TEXT_CHARS = 20000;
export const MAX_PASSAGE_LOCATORS = 8;
const NOTEBOOK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const codePoints = (value) => [...String(value ?? "")].length;

/** A kind of place in her words ("page", "canonical place"); an extension kind as written. */
export function placeKindWords(kind) {
  switch (kind) {
    case "page": return say("place.page");
    case "folio": return say("place.folio");
    case "line": return say("place.line");
    case "section": return say("place.section");
    case "chapter": return say("place.chapter");
    case "canonical": return say("place.canonical");
    case "timestamp": return say("place.timestamp");
    default: return String(kind || "").replace(/^x-csl-/, "").replace(/^x-/, "");
  }
}

/**
 * One place in her words: "page 514", "page 514 to 520". Built here rather than as one sentence,
 * because it sits inside other words (a sentence's first variable would start with a capital).
 */
export function placeText(locator) {
  const kind = placeKindWords(locator?.kind);
  const value = String(locator?.value ?? "");
  return [kind, value, ...(locator?.to ? [say("place.through"), String(locator.to)] : [])].filter(Boolean).join(" ");
}

/** A passage's places, joined: "page 514, line 3". */
export function locatorText(locators) {
  return (Array.isArray(locators) ? locators : []).map(placeText).filter(Boolean).join(", ");
}

/** The JSON body for a notebook search: only the filters that are set. It travels in a POST body, never the address. */
export function notebookSearchBody(filters) {
  const body = {};
  for (const [key, name] of [["query", "q"], ["source", "source"], ["locator", "locator"], ["concept", "concept"], ["state", "state"]]) {
    const value = String(filters?.[key] ?? "").trim();
    if (value) body[name] = value;
  }
  if (filters?.archived) body.includeArchived = true;
  return body;
}

export function searchIsActive(filters) {
  return ["query", "source", "locator", "concept", "state"].some((key) => String(filters?.[key] ?? "").trim());
}

/** How many filters (not the words) are set, for "Filters (2)". */
export function filterCount(filters) {
  return ["source", "locator", "concept", "state"].filter((key) => String(filters?.[key] ?? "").trim()).length + (filters?.archived ? 1 : 0);
}

/** Where a search hit matched, in her words: "the exact words, your note". */
export function hitContext(hit) {
  const where = [];
  for (const field of Array.isArray(hit?.matched) ? hit.matched : []) {
    if (field === "excerpt") where.push(say("notebook.inWords"));
    else if (field === "text") where.push(say("notebook.inNote"));
    else if (field === "source") where.push(say("notebook.inSource"));
  }
  return [...new Set(where)].join(", ");
}

/** One line for a notebook copy's preview. */
export function notebookImportSummary(plan) {
  const counts = plan?.counts || {};
  return say("notebook.bringSummary", { add: counts.create || 0, same: counts.unchanged || 0, conflicts: counts.conflict || 0 });
}

/** The preview rows worth reading: what would be added and what clashes, never entry text. */
export function notebookImportRows(plan) {
  return (plan?.entries || [])
    .filter((entry) => entry.action !== "unchanged")
    .map((entry) => ({ action: entry.action, name: entry.collection === "passages" ? say("notebook.bringPassage", { id: String(entry.id) }) : say("notebook.bringNote", { id: String(entry.id) }), message: entry.message || "" }));
}

/** A fresh, readable id no passage or note uses. Passages and notes share one id space. */
export function suggestEntryId(prefix, existingIds = []) {
  const used = new Set(existingIds);
  let number = used.size + 1;
  while (used.has(`${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}

/** Sources she may quote or note: not archived, ordered by name. */
export function captureSources(sources) {
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => !source.archived)
    .sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
}

function textLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** One place per line as `kind: value`, with a range written `kind: value to value` (the old form). */
export function parseLocatorLines(value) {
  return textLines(value).map((line) => {
    const cut = line.indexOf(":");
    if (cut < 0) return { kind: "", value: line };
    const kind = line.slice(0, cut).trim().toLowerCase();
    const rest = line.slice(cut + 1).trim();
    const range = rest.indexOf(" to ");
    return range < 0 ? { kind, value: rest } : { kind, value: rest.slice(0, range).trim(), to: rest.slice(range + 4).trim() };
  });
}

export function formatLocatorLines(locators) {
  return (Array.isArray(locators) ? locators : []).map((locator) => `${locator?.kind ?? ""}: ${locator?.value ?? ""}${locator?.to ? ` to ${locator.to}` : ""}`).join("\n");
}

/** Places as rows `{ kind, value, to }`; nothing is changed. */
export function placeRows(locators) {
  return (Array.isArray(locators) ? locators : [])
    .filter((locator) => locator && typeof locator === "object")
    .map((locator) => ({ kind: String(locator.kind ?? ""), value: String(locator.value ?? ""), to: String(locator.to ?? "") }));
}

/** Rows back to places: an empty row is left out; `to` only when given. */
export function rowsToLocators(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.kind ?? "").trim() || String(row?.value ?? "").trim() || String(row?.to ?? "").trim())
    .map((row) => {
      const locator = { kind: String(row.kind ?? "").trim(), value: String(row.value ?? "").trim() };
      const to = String(row.to ?? "").trim();
      if (to) locator.to = to;
      return locator;
    });
}

/** The first row (from 1) that has a value but no kind, or a kind but no value; 0 when all are whole. */
export function badPlace(rows) {
  const index = rowsToLocators(rows).findIndex((locator) => !locator.kind || !locator.value);
  return index + 1;
}

export function parseConceptList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

// An entry she did not change keeps its stored object, so fields this release does not know survive.
function keepUnchanged(parsed, original, same) {
  return parsed.map((entry, index) => (Array.isArray(original) && original[index] && same(original[index], entry) ? original[index] : entry));
}

export function passageDraft(record = null, source = "") {
  const passage = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof passage.id === "string" ? passage.id : "",
    source: typeof passage.source === "string" ? passage.source : source,
    excerpt: typeof passage.excerpt?.text === "string" ? passage.excerpt.text : "",
    language: typeof passage.excerpt?.language === "string" ? passage.excerpt.language : "",
    locators: placeRows(passage.locators),
  };
}

/** The full passage to send. The exact words go as typed; unknown stored fields are carried over. */
export function passageDraftPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  delete record.locators;
  record.id = String(draft.id || "").trim();
  record.source = draft.source;
  const excerpt = { ...(original.excerpt || {}), text: String(draft.excerpt ?? "") };
  const language = String(draft.language || "").trim();
  if (language) excerpt.language = original.excerpt?.language?.trim() === language ? original.excerpt.language : language;
  else delete excerpt.language;
  record.excerpt = excerpt;
  const locators = keepUnchanged(rowsToLocators(draft.locators), original.locators, (a, b) => a.kind === b.kind && a.value === b.value && (a.to ?? "") === (b.to ?? ""));
  if (locators.length) record.locators = locators;
  const order = [...Object.keys(original).filter((key) => key in record), ...Object.keys(record).filter((key) => !(key in original))];
  return Object.fromEntries(order.map((key) => [key, record[key]]));
}

/** A quick check before sending, as `{ field, id, vars }` or null; the server stays authoritative. */
export function validatePassageDraft(draft, sources = []) {
  if (!draft.source || !sources.some((source) => source.id === draft.source)) return { field: "source", id: "notebook.badSource" };
  if (!String(draft.excerpt ?? "").trim()) return { field: "excerpt", id: "research.fill" };
  if (codePoints(draft.excerpt) > MAX_NOTEBOOK_TEXT_CHARS) return { field: "excerpt", id: "research.tooLarge" };
  const locators = rowsToLocators(draft.locators);
  if (locators.length > MAX_PASSAGE_LOCATORS) return { field: "locators", id: "notebook.placeLimit" };
  const bad = badPlace(draft.locators);
  if (bad) return { field: "locators", id: "notebook.badPlace", vars: { n: bad }, row: bad - 1 };
  return null;
}

export function noteDraft(record = null) {
  const note = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof note.id === "string" ? note.id : "",
    kind: typeof note.kind === "string" ? note.kind : "observation",
    text: typeof note.text === "string" ? note.text : "",
    passages: Array.isArray(note.passages) ? [...note.passages] : [],
    sources: Array.isArray(note.sources) ? [...note.sources] : [],
    concepts: Array.isArray(note.concepts) ? [...note.concepts] : [],
    status: note.status === "resolved" ? "resolved" : "open",
  };
}

export function noteDraftPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  for (const field of ["passages", "sources", "concepts"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  record.text = String(draft.text ?? "");
  if (draft.passages.length) record.passages = [...draft.passages];
  if (draft.sources.length) record.sources = [...draft.sources];
  const concepts = parseConceptList(draft.concepts);
  if (concepts.length) record.concepts = Array.isArray(original.concepts) && original.concepts.join("\n") === concepts.join("\n") ? original.concepts : concepts;
  // Only a question has a state, and a question that never had one stays open without writing it.
  delete record.status;
  if (draft.kind === "question" && (draft.status === "resolved" || (original.status && draft.status))) record.status = draft.status;
  const order = [...Object.keys(original).filter((key) => key in record), ...Object.keys(record).filter((key) => !(key in original))];
  return Object.fromEntries(order.map((key) => [key, record[key]]));
}

export function validateNoteDraft(draft) {
  if (!String(draft.text ?? "").trim()) return { field: "text", id: "research.fill" };
  if (codePoints(draft.text) > MAX_NOTEBOOK_TEXT_CHARS) return { field: "text", id: "research.tooLarge" };
  if (parseConceptList(draft.concepts).some((concept) => !NOTEBOOK_SLUG.test(concept) || concept.length > 64)) return { field: "concepts", id: "notebook.badConcept" };
  return null;
}

/** Map a server diagnostic's field path to the form control that edits it. */
export function notebookDiagnosticControl(field) {
  const name = String(field || "").replace(/\[\d+\].*$/, "").split(".")[0];
  if (name === "excerpt") return String(field).endsWith("language") ? "language" : "excerpt";
  return { source: "source", locators: "locators", text: "text", kind: "kind", passages: "passages", sources: "sources", concepts: "concepts" }[name] || "";
}

/** A short plain-text label for a passage or note in lists; never markup. */
export function entryPreview(entry, limit = 90) {
  const text = String(entry?.excerpt?.text ?? entry?.text ?? entry?.preview ?? "").replace(/\s+/g, " ").trim();
  const points = [...text];
  return points.length > limit ? `${points.slice(0, limit - 1).join("")}…` : text;
}

/** A note's kind line: "Observation", "Question · open", "Question · answered". */
export function noteKindWords(note) {
  if (note?.kind !== "question") return say("notebook.observation");
  return note.status === "resolved" ? say("notebook.questionAnswered") : say("notebook.questionOpen");
}

/** The ids every passage and note use (one id space). */
export const entryIds = (notebook) => [...(notebook?.passages || []), ...(notebook?.notes || [])].map((entry) => entry.id);

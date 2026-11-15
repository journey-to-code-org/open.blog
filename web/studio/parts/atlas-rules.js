// The atlas (Studio R12): entries, links between them and their datings, as the old Admin's
// knowledge-atlas helpers (web/admin/admin.js l.3895–5500), lifted. Drafts and payloads keep every
// field they don't edit; checks return {field, id, vars} in her words; text that is data (names,
// keys, the server's link readings) is composed in code, never at the start of a sentence id.
import { say } from "./words.js";
import { sayId } from "./research-says.js";
import { sourceLabel } from "./source-rules.js";
import { formatLocatorLines, parseLocatorLines, MAX_PASSAGE_LOCATORS } from "./notebook-rules.js";

export function textLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// An entry the author did not change keeps its stored object, so fields this
// release does not understand survive a round trip through the text boxes.
export function keepUnchanged(parsed, original, same) {
  return parsed.map((entry, index) => (Array.isArray(original) && original[index] && same(original[index], entry) ? original[index] : entry));
}

export const NOTEBOOK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const codePoints = (value) => [...String(value ?? "")].length;

// ---------------------------------------------------------------- knowledge atlas

/** The kinds of atlas entry, in the order the form offers them. */
export const ATLAS_ENTRY_KINDS = Object.freeze(["person", "work", "concept", "movement", "event"].map((kind) => Object.freeze({ kind })));

/** How firmly the asserting party holds a link or dating; never how widely it is accepted. */
export const ATLAS_CONFIDENCE = Object.freeze(["tentative", "plausible", "strong"].map((value) => Object.freeze({ value })));

/** An entry kind in her words. */
export function entryKindWords(kind) {
  return { person: say("atlas.kindPerson"), work: say("atlas.kindWork"), concept: say("atlas.kindConcept"), movement: say("atlas.kindMovement"), event: say("atlas.kindEvent") }[kind] || String(kind || "");
}

/** How firmly, in her words. */
export function firmWords(value) {
  return { tentative: say("atlas.firmTentative"), plausible: say("atlas.firmPlausible"), strong: say("atlas.firmStrong") }[value] || say("atlas.firmTentative");
}

export const MAX_ATLAS_SHORT_CHARS = 200;

export const MAX_ATLAS_SUMMARY_CHARS = 20000;

export const MAX_ATLAS_UNCERTAINTY_CHARS = 2000;

export const MAX_ATLAS_ALIASES = 20;

export const MAX_ATLAS_EVIDENCE = 20;

export const MAX_ATLAS_DISSENTS = 20;

export const sameLocator = (a, b) => a.kind === b.kind && a.value === b.value && (a.to ?? "") === (b.to ?? "");

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The atlas identifier rule: a lowercase ASCII slug of at most 64 bytes. */
export function validAtlasId(value) {
  const text = String(value ?? "");
  return text.length <= 64 && NOTEBOOK_SLUG.test(text);
}

/** A readable identifier made from a label that nothing in the atlas uses yet. */
export function suggestAtlasId(text, used = [], fallback = "entry") {
  const taken = new Set(used);
  let base = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56)
    .replace(/-+$/, "");
  if (!base) base = fallback;
  if (!taken.has(base)) return base;
  let number = 2;
  while (taken.has(`${base}-${number}`)) number += 1;
  return `${base}-${number}`;
}

export const foldAtlasText = (value) => String(value ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** Entries of one kind (or any) whose id, label or other names contain every word of the query. */
export function atlasFilterEntries(entries, { query = "", kind = "" } = {}) {
  const words = foldAtlasText(query).split(" ").filter(Boolean);
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (!words.length) return true;
    const haystack = foldAtlasText([entry.id, entry.label, ...(entry.aliases || [])].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}

export function atlasKindSpec(kinds, kind) {
  return (kinds?.relationships || []).find((item) => item.kind === kind) || null;
}

/**
 * Entries that may stand at one end (`from` or `to`) of a relationship kind,
 * read from the server's table of endpoint kinds. `other` is the entry chosen
 * for the opposite end: it is never offered (no self-relationships) and it
 * narrows a kind that joins two entries of one kind. With no kind chosen,
 * every other entry is offered.
 */
export function atlasEndpointChoices(kinds, kind, end, entries, other = null) {
  const spec = atlasKindSpec(kinds, kind);
  const allowed = spec ? new Set(end === "from" ? spec.from : spec.to) : null;
  return (Array.isArray(entries) ? entries : []).filter(
    (entry) => (!allowed || allowed.has(entry.kind)) && (!spec?.sameKind || !other || entry.kind === other.kind) && (!other || entry.id !== other.id),
  );
}

/** An entry's name; a missing one says so around its key. */
export function atlasEntryName(entries, id) {
  const entry = (entries || []).find((item) => item.id === id);
  return entry ? String(entry.label) : [String(id), say("atlas.missingMark")].join(" ");
}

/** Who holds a position, in her words. */
export function atlasAttributionText(attribution, sources = []) {
  if (attribution?.kind === "source") {
    const source = (sources || []).find((item) => item.id === attribution.source);
    return source ? sourceLabel(source) : String(attribution.source || "");
  }
  if (attribution?.kind === "named") return String(attribution.name || "") || say("atlas.unnamed");
  return say("atlas.you");
}

/**
 * A link's standing, from recorded dissent only: there are no words for agreement, because
 * nothing in the atlas can establish it.
 */
export function atlasStandingText(relationship, sources = []) {
  const dissents = Array.isArray(relationship?.contestedBy) ? relationship.contestedBy : [];
  if (!dissents.length) return "";
  return say("atlas.contested", { who: dissents.map((dissent) => atlasAttributionText(dissent.by, sources)).join("; ") });
}

export function atlasConfidenceText(relationship) {
  return firmWords(relationship?.confidence || "tentative");
}

export function atlasEvidenceText(relationship) {
  if (relationship?.unsourced || !relationship?.evidence?.length) return say("atlas.noEvidence");
  return say("atlas.evidenceCount", { count: relationship.evidence.length });
}

/**
 * A link read in its stored direction, such as "Plato authored Politeia": names are data and the
 * kind's reading is the server's (`kinds`), so this is composed in code, never through a sentence id.
 */
export function atlasRelationshipSentence(relationship, entries = [], kinds = null) {
  const spec = atlasKindSpec(kinds, relationship?.kind);
  const reading = String(spec?.reading || spec?.label || relationship?.kind || "").replace(/-/g, " ");
  return [atlasEntryName(entries, relationship.from), reading, atlasEntryName(entries, relationship.to)].join(" ");
}

/** One line of Explore: "{link} — {firmness} — {who} say so, on {count} pieces of evidence". */
export function atlasLinkLine(relationship, { entries = [], kinds = null, sources = [] } = {}) {
  const who = atlasAttributionText(relationship?.assertedBy, sources);
  const evidence = relationship?.unsourced || !relationship?.evidence?.length ? say("atlas.noEvidence") : [who, say("atlas.saySoOn", { count: relationship.evidence.length })].join(" ");
  return [atlasRelationshipSentence(relationship, entries, kinds), firmWords(relationship?.confidence), evidence].join(" — ");
}

/** Map a server diagnostic's field path to the atlas form control that edits it. */
export function atlasDiagnosticControl(field, type = "entry") {
  const path = String(field || "");
  const name = path.replace(/\[\d+\].*$/, "").split(".")[0];
  const evidenceControl = (prefix, rest) => {
    const found = rest.match(/^evidence\[(\d+)\]\.?(source|passage|locators)?/);
    return found ? `${prefix}evidence-${found[1]}-${found[2] || "source"}` : "";
  };
  const party = (prefix, rest) => (rest.endsWith("source") ? `${prefix}-source` : rest.endsWith("name") ? `${prefix}-name` : prefix);
  if (name === "dates") {
    const dating = path.match(/^dates\[(\d+)\](?:\.(.*))?$/);
    if (!dating) return "dates";
    const [, index, rest = ""] = dating;
    const prefix = `dating-${index}`;
    if (["id", "aspect", "confidence", "unsourced", "note"].includes(rest)) return `${prefix}-${rest}`;
    if (rest === "visibility") return `${prefix}-approved`;
    if (rest.startsWith("assertedBy")) return party(`${prefix}-asserted`, rest);
    if (rest.startsWith("evidence")) return evidenceControl(`${prefix}-`, rest) || `${prefix}-evidence`;
    const date = rest.match(/^date(?:\.(at|from|to|notBefore|notAfter|unknown|relative)(?:\.(\w+))?)?/);
    if (!date) return prefix;
    const [, slot, key] = date;
    if (!slot || slot === "unknown") return `${prefix}-form`;
    if (slot === "relative") return `${prefix}-relative-${["order", "entry", "aspect"].includes(key) ? key : "entry"}`;
    const base = `${prefix}-${DATE_SLOT_IDS[slot]}`;
    if (["month", "day", "calendar", "circa"].includes(key)) return `${base}-${key}`;
    if (["year", "decade", "century"].includes(key)) return `${base}-value`;
    return `${base}-precision`;
  }
  if (type === "entry") return { id: "id", kind: "kind", label: "label", aliases: "aliases", summary: "summary", source: "source", visibility: "approved" }[name] || "";
  const dissent = path.match(/^contestedBy\[(\d+)\](?:\.(.*))?$/);
  if (dissent) {
    const [, index, rest = ""] = dissent;
    if (rest.startsWith("by")) return party(`dissent-${index}`, rest);
    if (rest === "note") return `dissent-${index}-note`;
    return evidenceControl(`dissent-${index}-`, rest) || `dissent-${index}`;
  }
  if (name === "contestedBy") return "contested";
  if (name === "assertedBy") return party("asserted", path);
  if (name === "evidence") return evidenceControl("", path) || "evidence";
  return { id: "kind", kind: "kind", from: "from", to: "to", confidence: "confidence", unsourced: "unsourced", uncertainty: "uncertainty", visibility: "approved" }[name] || "";
}

/** Server diagnostics as one line of text; a cycle or a blocking relationship names the relationship. */
/** What a save did to the published atlas, as a word id: "" when the site doesn't publish it. */
export function atlasBuildText(build) {
  if (!build || typeof build !== "object" || build.pending) return "";
  return build.ok ? "atlas.rebuilt" : "atlas.rebuildFailed";
}

/** The server's own sentences, for the details under For {helper} (never her words). */
export function atlasErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return String(error?.data?.error || error?.message || "");
  return diagnostics
    .map((item) => `${item.code ? `${item.code} ` : ""}${item.id && ["cycle", "still-linked"].includes(item.code) ? `${item.id} ` : ""}${item.field ? `${item.field}: ` : ""}${item.message || ""}`)
    .join(" ");
}

export function atlasAttributionDraft(record) {
  const value = record && typeof record === "object" ? record : { kind: "author" };
  return {
    original: structuredClone(value),
    kind: ["author", "source", "named"].includes(value.kind) ? value.kind : "author",
    source: typeof value.source === "string" ? value.source : "",
    name: typeof value.name === "string" ? value.name : "",
  };
}

export function atlasAttributionPayload(draft) {
  const record = { ...draft.original };
  delete record.source;
  delete record.name;
  record.kind = draft.kind;
  if (draft.kind === "source") record.source = draft.source;
  if (draft.kind === "named") record.name = String(draft.name ?? "").trim();
  return record;
}

/** `from` is the item's index in the stored list it was read from, or null for a new item. */
export function atlasEvidenceDraft(record = {}, from = null) {
  const value = record && typeof record === "object" ? record : {};
  return { original: structuredClone(value), from: Number.isInteger(from) ? from : null, source: typeof value.source === "string" ? value.source : "", passage: typeof value.passage === "string" ? value.passage : "", locators: formatLocatorLines(value.locators) };
}

export function atlasEvidencePayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  delete record.locators;
  delete record.passage;
  record.source = draft.source;
  const locators = keepUnchanged(parseLocatorLines(draft.locators), original.locators, sameLocator);
  if (locators.length) record.locators = locators;
  if (draft.passage) record.passage = draft.passage;
  return record;
}

export function atlasEntryDraft(record = null, prefill = {}) {
  const entry = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof entry.id === "string" ? entry.id : String(prefill.id || ""),
    kind: typeof entry.kind === "string" ? entry.kind : ATLAS_ENTRY_KINDS.some((item) => item.kind === prefill.kind) ? prefill.kind : "concept",
    label: typeof entry.label === "string" ? entry.label : String(prefill.label || ""),
    aliases: (Array.isArray(entry.aliases) ? entry.aliases : []).join("\n"),
    summary: typeof entry.summary === "string" ? entry.summary : "",
    source: typeof entry.source === "string" ? entry.source : "",
    datings: (Array.isArray(entry.dates) ? entry.dates : []).map((dating) => atlasDatingDraft(dating)),
    approved: entry.visibility === "approved",
  };
}

/** The full entry to send, carrying unknown fields on the entry and at every level of its datings. */
export function atlasEntryPayload(draft) {
  const original = draft.original || {};
  const record = { ...original };
  for (const field of ["aliases", "summary", "source", "dates"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  record.label = String(draft.label ?? "").trim();
  const aliases = textLines(draft.aliases);
  if (aliases.length) record.aliases = aliases;
  if (String(draft.summary ?? "").trim()) record.summary = draft.summary;
  if (draft.kind === "work" && draft.source) record.source = draft.source;
  const dates = (draft.datings || []).map(atlasDatingPayload);
  if (dates.length) record.dates = dates;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

/** A quick, advisory check; the server's validation stays authoritative. */
export function validateAtlasEntryDraft(draft, { sources = [], used = [], creating = false } = {}) {
  if (creating) {
    if (!validAtlasId(draft.id)) return { field: "id", id: "sources.badKey" };
    if (used.includes(draft.id)) return { field: "id", id: "atlas.keyTaken" };
  }
  const label = String(draft.label ?? "").trim();
  if (!label) return { field: "label", id: "atlas.needName" };
  if (codePoints(label) > MAX_ATLAS_SHORT_CHARS) return { field: "label", id: "research.tooLong", vars: { max: MAX_ATLAS_SHORT_CHARS } };
  const aliases = textLines(draft.aliases);
  if (aliases.length > MAX_ATLAS_ALIASES) return { field: "aliases", id: "atlas.tooManyNames", vars: { max: MAX_ATLAS_ALIASES } };
  if (aliases.some((alias) => codePoints(alias) > MAX_ATLAS_SHORT_CHARS)) return { field: "aliases", id: "research.tooLong", vars: { max: MAX_ATLAS_SHORT_CHARS } };
  if (new Set(aliases).size !== aliases.length) return { field: "aliases", id: "atlas.sameName" };
  if (codePoints(draft.summary) > MAX_ATLAS_SUMMARY_CHARS) return { field: "summary", id: "research.tooLong", vars: { max: MAX_ATLAS_SUMMARY_CHARS } };
  if (draft.kind === "work" && draft.source && !sources.some((source) => source.id === draft.source && source.kind === "work")) return { field: "source", id: "atlas.chooseWork" };
  return null;
}

export function atlasRelationshipDraft(record = null, prefill = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof value.id === "string" ? value.id : "",
    kind: typeof value.kind === "string" ? value.kind : String(prefill.kind || ""),
    from: typeof value.from === "string" ? value.from : String(prefill.from || ""),
    to: typeof value.to === "string" ? value.to : String(prefill.to || ""),
    assertedBy: atlasAttributionDraft(value.assertedBy),
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === value.confidence) ? value.confidence : "tentative",
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => atlasEvidenceDraft(item, index)),
    unsourced: Boolean(value.unsourced),
    uncertainty: typeof value.uncertainty === "string" ? value.uncertainty : "",
    contestedBy: (Array.isArray(value.contestedBy) ? value.contestedBy : []).map((item, index) => atlasDissentDraft(item, index)),
    datings: (Array.isArray(value.dates) ? value.dates : []).map((dating) => atlasDatingDraft(dating)),
    approved: value.visibility === "approved",
  };
}

/** `from` is the dissent's index in the stored `contestedBy`, or null for a new dissent. */
export function atlasDissentDraft(record = {}, from = null) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: structuredClone(value),
    from: Number.isInteger(from) ? from : null,
    by: atlasAttributionDraft(value.by),
    note: typeof value.note === "string" ? value.note : "",
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => atlasEvidenceDraft(item, index)),
  };
}

/**
 * Rests a relationship draft on a newer stored copy. Every nested item read
 * from the store takes the newer copy of the item it came from, wherever that
 * item still exists, so fields added elsewhere at any level survive the save.
 * A dissent rests on the newer dissent known by its party while that party is
 * unique in the opened and the newer lists; when several share a party, the
 * same opened note or evidence must also match, and if that still leaves
 * several, only the one at the dissent's own index qualifies. Evidence rests on the newer item known by its
 * source and passage (see `rebaseAtlasEvidence`). When an item cannot be told
 * apart from another, the draft keeps its own copy rather than take that
 * item's fields.
 */
export function rebaseAtlasRelationshipDraft(draft, current) {
  const text = (value) => (typeof value === "string" ? value : "");
  const object = (value) => value && typeof value === "object";
  const party = (value) => (object(value) ? value : {});
  const partyKey = (dissent) => {
    const by = party(dissent?.by);
    return JSON.stringify([text(by.kind), text(by.source), text(by.name)]);
  };
  const evidenceKey = (dissent) =>
    JSON.stringify((Array.isArray(dissent?.evidence) ? dissent.evidence : []).map((item) => [text(item?.source), text(item?.passage), JSON.stringify(Array.isArray(item?.locators) ? item.locators : [])]));
  const openedFrom = draft.original?.dates;
  const openedEvidence = draft.original?.evidence;
  const openedDissents = Array.isArray(draft.original?.contestedBy)
    ? draft.original.contestedBy
    : draft.contestedBy.filter((item) => Number.isInteger(item.from)).map((item) => item.original);
  draft.original = structuredClone(current);
  draft.assertedBy.original = structuredClone(current.assertedBy || { kind: "author" });
  rebaseAtlasEvidence(draft.evidence, current.evidence, openedEvidence);
  const newerList = Array.isArray(current.contestedBy) ? current.contestedBy : [];
  for (const dissent of draft.contestedBy) {
    if (!Number.isInteger(dissent.from) || !object(dissent.original)) continue;
    const key = partyKey(dissent.original);
    const sameParty = (list) => list.filter((value) => object(value) && partyKey(value) === key);
    const candidates = sameParty(newerList);
    const openedSame = sameParty(openedDissents);
    let newer = null;
    if (candidates.length === 1 && openedSame.length === 1) newer = candidates[0];
    else {
      // Several dissents share the party: the same opened note or evidence must tell them apart.
      const alike = (value) => (text(dissent.original.note) ? text(value.note) === text(dissent.original.note) : !text(value.note) && evidenceKey(value) === evidenceKey(dissent.original));
      const matching = candidates.filter(alike);
      const openedMatching = openedSame.filter(alike);
      if (matching.length === 1 && openedMatching.length === 1) newer = matching[0];
      else if (matching.length === openedMatching.length && matching.includes(newerList[dissent.from])) newer = newerList[dissent.from];
    }
    if (!newer) continue;
    const opened = dissent.original?.evidence;
    dissent.original = structuredClone(newer);
    dissent.from = newerList.indexOf(newer);
    dissent.by.original = structuredClone(newer.by || { kind: "author" });
    rebaseAtlasEvidence(dissent.evidence, newer.evidence, opened);
  }
  // Datings carry ids, so they rest on the newer copy by identity, never by position.
  rebaseAtlasDatings(draft.datings || [], current.dates, openedFrom);
  return draft;
}

/** The full relationship to send, carrying unknown fields at every level the form edits. */
export function atlasRelationshipPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["evidence", "unsourced", "uncertainty", "contestedBy", "dates"]) delete record[field];
  record.id = String(draft.id || "").trim();
  record.kind = draft.kind;
  record.from = draft.from;
  record.to = draft.to;
  record.assertedBy = atlasAttributionPayload(draft.assertedBy);
  record.confidence = draft.confidence;
  const evidence = draft.evidence.map(atlasEvidencePayload);
  if (evidence.length) record.evidence = evidence;
  else if (draft.unsourced) record.unsourced = true;
  if (String(draft.uncertainty ?? "").trim()) record.uncertainty = draft.uncertainty;
  const dissents = draft.contestedBy.map((dissent) => {
    const item = { ...dissent.original };
    delete item.note;
    delete item.evidence;
    item.by = atlasAttributionPayload(dissent.by);
    const cited = dissent.evidence.map(atlasEvidencePayload);
    if (cited.length) item.evidence = cited;
    if (String(dissent.note ?? "").trim()) item.note = dissent.note;
    return item;
  });
  if (dissents.length) record.contestedBy = dissents;
  const dates = (draft.datings || []).map(atlasDatingPayload);
  if (dates.length) record.dates = dates;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

export function atlasPartyProblem(party, sources, prefix) {
  if (party.kind === "source" && !sources.some((source) => source.id === party.source)) return { field: `${prefix}-source`, id: "atlas.chooseHolder" };
  if (party.kind === "named") {
    const name = String(party.name ?? "").trim();
    if (!name) return { field: `${prefix}-name`, id: "atlas.nameHolder" };
    if (codePoints(name) > MAX_ATLAS_SHORT_CHARS) return { field: `${prefix}-name`, id: "research.tooLong", vars: { max: MAX_ATLAS_SHORT_CHARS } };
  }
  return null;
}

export function atlasEvidenceProblem(list, sources, passages, prefix, noun) {
  for (const [index, item] of list.entries()) {
    const base = `${prefix}evidence-${index}`;
    if (!sources.some((source) => source.id === item.source)) return { field: `${base}-source`, id: "atlas.chooseEvidenceSource", vars: { n: index + 1 } };
    const locators = parseLocatorLines(item.locators);
    if (locators.length > MAX_PASSAGE_LOCATORS) return { field: `${base}-locators`, id: "atlas.tooManyPlaces", vars: { max: MAX_PASSAGE_LOCATORS } };
    const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
    if (bad >= 0) return { field: `${base}-locators`, id: "notebook.badPlace", vars: { n: bad + 1 } };
    if (item.passage) {
      const passage = passages.find((candidate) => candidate.id === item.passage);
      if (!passage) return { field: `${base}-passage`, id: "atlas.passageGone", vars: { n: index + 1 } };
      if (passage.source !== item.source) return { field: `${base}-passage`, id: "atlas.passageOtherSource", vars: { n: index + 1 } };
    }
  }
  return null;
}

/** A quick, advisory check of a relationship; the server's validation stays authoritative. */
export function validateAtlasRelationshipDraft(draft, { entries = [], kinds = null, sources = [], passages = [] } = {}) {
  const spec = atlasKindSpec(kinds, draft.kind);
  if (!spec) return { field: "kind", id: "atlas.chooseLinkKind" };
  const from = entries.find((entry) => entry.id === draft.from);
  const to = entries.find((entry) => entry.id === draft.to);
  if (!from) return { field: "from", id: "atlas.chooseFrom" };
  if (!spec.from.includes(from.kind)) return { field: "from", id: "atlas.badEnds" };
  if (!to) return { field: "to", id: "atlas.chooseTo" };
  if (to.id === from.id) return { field: "to", id: "atlas.self" };
  if (!spec.to.includes(to.kind)) return { field: "to", id: "atlas.badEnds" };
  if (spec.sameKind && to.kind !== from.kind) return { field: "to", id: "atlas.sameKindEnds" };
  const party = atlasPartyProblem(draft.assertedBy, sources, "asserted");
  if (party) return party;
  if (draft.evidence.length > MAX_ATLAS_EVIDENCE) return { field: "evidence", id: "atlas.tooMuchEvidence", vars: { max: MAX_ATLAS_EVIDENCE } };
  const evidence = atlasEvidenceProblem(draft.evidence, sources, passages, "", "evidence");
  if (evidence) return evidence;
  if (!draft.evidence.length && !draft.unsourced) return { field: "evidence", id: "atlas.needEvidence" };
  if (!draft.evidence.length && draft.confidence === "strong") return { field: "confidence", id: "atlas.strongNeedsEvidence" };
  if (codePoints(draft.uncertainty) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: "uncertainty", id: "research.tooLong", vars: { max: MAX_ATLAS_UNCERTAINTY_CHARS } };
  if (draft.contestedBy.length > MAX_ATLAS_DISSENTS) return { field: "contested", id: "atlas.tooManyDissents", vars: { max: MAX_ATLAS_DISSENTS } };
  for (const [index, dissent] of draft.contestedBy.entries()) {
    const prefix = `dissent-${index}`;
    const problem = atlasPartyProblem(dissent.by, sources, prefix) || atlasEvidenceProblem(dissent.evidence, sources, passages, `${prefix}-`, `dissent ${index + 1} evidence`);
    if (problem) return problem;
    if (!dissent.evidence.length && !String(dissent.note ?? "").trim()) return { field: `${prefix}-note`, id: "atlas.dissentNeedsWhy", vars: { n: index + 1 } };
    if (codePoints(dissent.note) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: `${prefix}-note`, id: "research.tooLong", vars: { max: MAX_ATLAS_UNCERTAINTY_CHARS } };
  }
  if (draft.approved) {
    if (!draft.evidence.length) return { field: "approved", id: "atlas.showNeedsEvidence" };
    const notebookPointer = [...draft.evidence, ...draft.contestedBy.flatMap((dissent) => dissent.evidence)].some((item) => item.passage);
    if (notebookPointer) return { field: "approved", id: "atlas.showNoPassage" };
  }
  return null;
}

export const ATLAS_ASPECTS = Object.freeze(["span", "birth", "death", "active", "composition", "publication", "emergence"]);

export const SHORT_MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const DATE_SLOTS = ["at", "from", "to", "notBefore", "notAfter"];

export const DATE_SLOT_IDS = Object.freeze({ at: "at", from: "from", to: "to", notBefore: "not-before", notAfter: "not-after" });

export const FORM_SLOTS = Object.freeze({ at: ["at"], range: ["from", "to"], window: ["notBefore", "notAfter"], unknown: [], relative: [] });

export const DATE_FORM_KEYS = ["at", "from", "to", "notBefore", "notAfter", "unknown", "relative"];

export const POINT_KEYS = ["year", "month", "day", "decade", "century", "circa", "calendar"];

export const RELATIVE_KEYS = ["order", "entry", "aspect"];

export const DATING_KEYS = ["id", "aspect", "date", "assertedBy", "confidence", "evidence", "unsourced", "note", "visibility"];

export const DEFAULT_MAX_DATINGS = 20;

export const DEFAULT_MAX_YEAR = 100000;

/** What a dating dates, in her words ("birth", "activity"), for the middle of a sentence. */
export const aspectNoun = (aspect) => ({ span: say("atlas.aspectSpan"), birth: say("atlas.aspectBirth"), death: say("atlas.aspectDeath"), active: say("atlas.aspectActive"), composition: say("atlas.aspectComposition"), publication: say("atlas.aspectPublication"), emergence: say("atlas.aspectEmergence") }[aspect] || String(aspect || ""));

export const extrasOf = (value, known) => {
  const extras = {};
  if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) if (!known.includes(key)) extras[key] = structuredClone(item);
  return extras;
};

/** A whole number typed as digits only, or NaN. */
export const wholeNumber = (text) => (/^\d+$/.test(String(text ?? "").trim()) ? Number(String(text).trim()) : NaN);

export const daysInMonth = (month) => (month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** The aspects an owner may be dated by, read from the server's table: an entry kind, or "relationship". */
export function atlasAspects(kinds, owner) {
  return (kinds?.aspects || []).filter((spec) => (owner === "relationship" ? spec.relationship : (spec.entries || []).includes(owner)));
}

/** A historical year in words: negative is BCE, and there is no year 0 (decision 13). */
export function atlasYearText(year) {
  return [String(Math.abs(year)), year < 0 ? say("atlas.bce") : say("atlas.ce")].join(" ");
}

/** Her year and era as the stored year: 1 BCE is -1, and there is no year 0 (NaN). */
export function eraYear(year, era) {
  const n = wholeNumber(year);
  if (!(n >= 1)) return NaN;
  return era === "bce" ? -n : n;
}

/** A stored year as her year and era; 0 or a non-integer is no year at all. */
export function yearEra(year) {
  if (!Number.isInteger(year) || year === 0) return { year: "", era: "ce" };
  return { year: String(Math.abs(year)), era: year < 0 ? "bce" : "ce" };
}

export const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
};

/** A point read back at its own precision, as the core writes it: "c. 428 BCE", "the 380s BCE". */
export function atlasPointText(point) {
  if (!point || typeof point !== "object") return "";
  const era = (n) => (n < 0 ? say("atlas.bce") : say("atlas.ce"));
  const parts = point.circa ? [say("atlas.circa")] : [];
  if (Number.isInteger(point.year) && point.year !== 0) {
    if (Number.isInteger(point.month) && Number.isInteger(point.day)) parts.push(String(point.day));
    if (Number.isInteger(point.month)) parts.push(SHORT_MONTHS[point.month - 1] || "?");
    parts.push(atlasYearText(point.year));
  } else if (Number.isInteger(point.decade) && point.decade !== 0) {
    if (!point.circa) parts.push(say("atlas.the"));
    parts.push(`${Math.abs(point.decade)}s`, era(point.decade));
  } else if (Number.isInteger(point.century) && point.century !== 0) {
    parts.push(ordinal(Math.abs(point.century)), say("atlas.century"), era(point.century));
  } else return "";
  if (point.calendar === "gregorian" || point.calendar === "julian") parts.push(`(${point.calendar})`);
  return parts.join(" ");
}

/** A date as stated, as the core writes it; a relative dating names the other entry when `entries` are given. */
export function atlasDateText(date, entries = null) {
  const value = date && typeof date === "object" ? date : {};
  const ends = (a, b, both, and, first, last) => {
    if (a && b) return [both, atlasPointText(a), and, atlasPointText(b)].join(" ");
    if (a) return [first, atlasPointText(a)].join(" ");
    if (b) return [last, atlasPointText(b)].join(" ");
    return say("atlas.open");
  };
  if (value.at) return atlasPointText(value.at);
  if (value.from || value.to) return ends(value.from, value.to, say("atlas.from"), say("atlas.to"), say("atlas.from"), say("atlas.until"));
  if (value.notBefore || value.notAfter) return ends(value.notBefore, value.notAfter, say("atlas.between"), say("atlas.and"), say("atlas.notBefore"), say("atlas.notAfter"));
  if (value.unknown === true) return say("atlas.unknown");
  const relative = value.relative;
  if (relative && typeof relative === "object") {
    const order = { before: say("atlas.before"), after: say("atlas.after"), during: say("atlas.during") }[relative.order] || String(relative.order || "");
    if (!entries) return [order, String(relative.entry || ""), String(relative.aspect || "")].join(" ");
    return [order, say("atlas.the"), aspectNoun(relative.aspect), say("atlas.of"), atlasEntryName(entries, relative.entry)].join(" ");
  }
  return "";
}

/** `fallback` is the precision of a point the record does not state: "open" (an omitted end) or a precision for a new point. */
export function atlasPointDraft(point = null, fallback = "open") {
  const value = point && typeof point === "object" && !Array.isArray(point) ? point : null;
  const draft = { extras: extrasOf(value, POINT_KEYS), precision: value ? "year" : fallback, magnitude: "", era: "ce", month: "", day: "", circa: Boolean(value?.circa), calendar: ["gregorian", "julian"].includes(value?.calendar) ? value.calendar : "" };
  const signed = (n) => {
    draft.magnitude = String(Math.abs(n));
    draft.era = n < 0 ? "bce" : "ce";
  };
  if (Number.isInteger(value?.year)) {
    signed(value.year);
    if (Number.isInteger(value.month)) {
      draft.month = String(value.month);
      draft.precision = "month";
      if (Number.isInteger(value.day)) {
        draft.day = String(value.day);
        draft.precision = "day";
      }
    }
  } else if (Number.isInteger(value?.decade)) {
    signed(value.decade);
    draft.precision = "decade";
  } else if (Number.isInteger(value?.century)) {
    signed(value.century);
    draft.precision = "century";
  }
  return draft;
}

/** The point to send, or undefined for an open end. Unknown fields the point carried are kept. */
export function atlasPointPayload(draft) {
  if (!draft || draft.precision === "open") return undefined;
  const sign = draft.era === "bce" ? -1 : 1;
  const record = {};
  if (draft.precision === "decade") record.decade = sign * wholeNumber(draft.magnitude);
  else if (draft.precision === "century") record.century = sign * wholeNumber(draft.magnitude);
  else {
    record.year = sign * wholeNumber(draft.magnitude);
    if (draft.precision === "month" || draft.precision === "day") {
      record.month = wholeNumber(draft.month);
      if (draft.precision === "day") record.day = wholeNumber(draft.day);
    }
  }
  if (draft.circa) record.circa = true;
  if (draft.calendar && (draft.precision === "month" || draft.precision === "day")) record.calendar = draft.calendar;
  for (const [key, value] of Object.entries(draft.extras || {})) if (!(key in record)) record[key] = structuredClone(value);
  return record;
}

/**
 * One dating as the editor holds it. `storedId` is the identity of the stored
 * dating it was read from (null for a new one): a draft rests on a newer
 * stored copy by that identity, never by its position in the list.
 */
export function atlasDatingDraft(record = null, defaults = {}) {
  const value = record && typeof record === "object" ? record : {};
  const date = value.date && typeof value.date === "object" ? value.date : {};
  const form = date.at ? "at" : date.from || date.to ? "range" : date.notBefore || date.notAfter ? "window" : date.unknown === true ? "unknown" : date.relative ? "relative" : "at";
  const relative = date.relative && typeof date.relative === "object" ? date.relative : {};
  const points = {};
  for (const slot of DATE_SLOTS) {
    // A slot of the stored form that is absent is an open end; other slots wait, blank, in case the form changes.
    const stated = Boolean(record) && FORM_SLOTS[form].includes(slot);
    points[slot] = atlasPointDraft(date[slot], slot === "at" || (!stated && (slot === "from" || slot === "notBefore")) ? "year" : "open");
  }
  return {
    storedId: record && typeof value.id === "string" ? value.id : null,
    original: record ? structuredClone(record) : {},
    id: typeof value.id === "string" ? value.id : String(defaults.id || ""),
    idTouched: Boolean(record),
    aspect: typeof value.aspect === "string" ? value.aspect : String(defaults.aspect || ""),
    form,
    points,
    dateExtras: extrasOf(date, DATE_FORM_KEYS),
    relative: {
      extras: extrasOf(relative, RELATIVE_KEYS),
      order: ["before", "after", "during"].includes(relative.order) ? relative.order : "after",
      entry: typeof relative.entry === "string" ? relative.entry : "",
      aspect: typeof relative.aspect === "string" ? relative.aspect : "",
    },
    assertedBy: atlasAttributionDraft(value.assertedBy),
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === value.confidence) ? value.confidence : "tentative",
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((item, index) => atlasEvidenceDraft(item, index)),
    unsourced: Boolean(value.unsourced),
    note: typeof value.note === "string" ? value.note : "",
    approved: value.visibility === "approved",
  };
}

/** The full dating to send, carrying unknown fields on the dating, its date, its points and its relative target. */
export function atlasDatingPayload(draft) {
  const date = {};
  if (draft.form === "unknown") date.unknown = true;
  else if (draft.form === "relative") {
    date.relative = { order: draft.relative.order, entry: draft.relative.entry, aspect: draft.relative.aspect };
    for (const [key, value] of Object.entries(draft.relative.extras || {})) if (!(key in date.relative)) date.relative[key] = structuredClone(value);
  } else {
    for (const slot of FORM_SLOTS[draft.form] || []) {
      const point = atlasPointPayload(draft.points[slot]);
      if (point) date[slot] = point;
    }
  }
  for (const [key, value] of Object.entries(draft.dateExtras || {})) if (!(key in date)) date[key] = structuredClone(value);
  const record = { id: String(draft.id || "").trim(), aspect: draft.aspect, date, assertedBy: atlasAttributionPayload(draft.assertedBy), confidence: draft.confidence };
  const evidence = draft.evidence.map(atlasEvidencePayload);
  if (evidence.length) record.evidence = evidence;
  else if (draft.unsourced) record.unsourced = true;
  if (String(draft.note ?? "").trim()) record.note = draft.note;
  record.visibility = draft.approved ? "approved" : "private";
  for (const [key, value] of Object.entries(draft.original || {})) if (!DATING_KEYS.includes(key) && !(key in record)) record[key] = structuredClone(value);
  return record;
}

/** What a dating draft reads as, for the editor's live text; incomplete points say so rather than guess. */
export function atlasDatingReading(draft, entries = []) {
  if (draft.form === "unknown") return say("atlas.unknown");
  if (draft.form === "relative") {
    const { order, entry, aspect } = draft.relative;
    if (!entry || !aspect) return say("atlas.notCompleteOther");
    return atlasDateText({ relative: { order, entry, aspect } }, entries);
  }
  const date = atlasDatingPayload({ ...draft, original: {}, dateExtras: {}, evidence: [], assertedBy: { original: {}, kind: "author" } }).date;
  const slots = FORM_SLOTS[draft.form] || [];
  if (slots.some((slot) => date[slot] && !atlasPointText(date[slot]))) return say("atlas.notComplete");
  if (draft.form === "at" && !date.at) return say("atlas.notComplete");
  return atlasDateText(date);
}

export function pointKeys(point) {
  const years = Number.isInteger(point.year) ? [point.year, point.year] : Number.isInteger(point.decade) ? (point.decade > 0 ? [point.decade, point.decade + 9] : [point.decade - 9, point.decade]) : point.century > 0 ? [(point.century - 1) * 100 + 1, point.century * 100] : [point.century * 100, point.century * 100 + 99];
  const month = Number.isInteger(point.month) ? point.month : null;
  return {
    years,
    first: month ? [point.year, month, point.day || 1] : [years[0], 1, 1],
    last: month ? [point.year, month, point.day || daysInMonth(month)] : [years[1], 12, 31],
  };
}

export const compareKeys = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether `start` can begin no later than `end` ends, as the core decides it: months and days only within one calendar. */
export function notReversed(start, end) {
  const [a, b] = [pointKeys(start), pointKeys(end)];
  return (start.calendar || "") === (end.calendar || "") ? compareKeys(a.first, b.last) <= 0 : a.years[0] <= b.years[1];
}

export function atlasPointProblem(point, base, name, maxYear) {
  if (point.precision === "open") return null;
  const n = wholeNumber(point.magnitude);
  if (point.precision === "decade") {
    if (!(n >= 10 && n % 10 === 0 && n + 9 <= maxYear)) return { field: `${base}-value`, id: "atlas.badDecade" };
    return null;
  }
  if (point.precision === "century") {
    if (!(n >= 1 && n <= maxYear / 100)) return { field: `${base}-value`, id: "atlas.badCentury", vars: { max: maxYear / 100 } };
    return null;
  }
  if (!(n >= 1 && n <= maxYear)) return { field: `${base}-value`, id: "atlas.badYear", vars: { max: maxYear } };
  if (point.precision === "month" || point.precision === "day") {
    const month = wholeNumber(point.month);
    if (!(month >= 1 && month <= 12)) return { field: `${base}-month`, id: "atlas.chooseMonth" };
    if (point.precision === "day") {
      const day = wholeNumber(point.day);
      if (!(day >= 1 && day <= daysInMonth(month))) return { field: `${base}-day`, id: "atlas.badDay", vars: { max: daysInMonth(month) } };
    }
  }
  return null;
}

/**
 * A quick, advisory check of an item's datings; the server stays
 * authoritative. Fields name the dating's controls (`dating-1-at-value`).
 * `used` lists every identifier a new dating may not take.
 */
export function validateAtlasDatings(datings, { owner = "", ownerId = "", kinds = null, entries = [], sources = [], passages = [], used = [] } = {}) {
  const max = kinds?.maxDatings || DEFAULT_MAX_DATINGS;
  const maxYear = kinds?.maxYear || DEFAULT_MAX_YEAR;
  if (datings.length > max) return { field: "dates", id: "atlas.tooManyDatings", vars: { max } };
  const allowed = atlasAspects(kinds, owner);
  const seen = new Set();
  for (const [index, dating] of datings.entries()) {
    const p = `dating-${index}`;
    const name = `Dating ${index + 1}`;
    const id = String(dating.id || "").trim();
    if (!validAtlasId(id)) return { field: `${p}-id`, id: "sources.badKey" };
    if (used.includes(id) || seen.has(id)) return { field: `${p}-id`, id: "atlas.keyTaken" };
    seen.add(id);
    const spec = allowed.find((item) => item.aspect === dating.aspect);
    if (!spec) return { field: `${p}-aspect`, id: "atlas.chooseAspect" };
    if (dating.form === "range" && !spec.durative) return { field: `${p}-form`, id: "atlas.oneTime" };
    const slots = FORM_SLOTS[dating.form] || [];
    for (const slot of slots) {
      const problem = atlasPointProblem(dating.points[slot], `${p}-${DATE_SLOT_IDS[slot]}`, name, maxYear);
      if (problem) return problem;
    }
    if (slots.length === 2) {
      const [start, end] = slots.map((slot) => atlasPointPayload(dating.points[slot]));
      if (!start && !end) return { field: `${p}-${DATE_SLOT_IDS[slots[0]]}-precision`, id: "atlas.needOneEnd" };
      if (start && end && !notReversed(start, end)) return { field: `${p}-${DATE_SLOT_IDS[slots[1]]}-value`, id: "atlas.reversed" };
    }
    if (dating.form === "relative") {
      const target = entries.find((entry) => entry.id === dating.relative.entry);
      if (!target) return { field: `${p}-relative-entry`, id: "atlas.chooseOther" };
      const aspect = atlasAspects(kinds, target.kind).find((item) => item.aspect === dating.relative.aspect);
      if (!aspect) return { field: `${p}-relative-aspect`, id: "atlas.badAspect" };
      if (dating.relative.order === "during" && !aspect.durative) return { field: `${p}-relative-aspect`, id: "atlas.duringLasts" };
      if (target.id === ownerId && aspect.aspect === dating.aspect) return { field: `${p}-relative-aspect`, id: "atlas.againstItself" };
    }
    const party = atlasPartyProblem(dating.assertedBy, sources, `${p}-asserted`);
    if (party) return party;
    if (dating.evidence.length > MAX_ATLAS_EVIDENCE) return { field: `${p}-evidence`, id: "atlas.tooMuchEvidence", vars: { max: MAX_ATLAS_EVIDENCE } };
    const evidence = atlasEvidenceProblem(dating.evidence, sources, passages, `${p}-`, `${name.toLowerCase()} evidence`);
    if (evidence) return evidence;
    if (!dating.evidence.length && !dating.unsourced) return { field: `${p}-evidence`, id: "atlas.needEvidence" };
    if (!dating.evidence.length && dating.confidence === "strong") return { field: `${p}-confidence`, id: "atlas.strongNeedsEvidence" };
    if (codePoints(dating.note) > MAX_ATLAS_UNCERTAINTY_CHARS) return { field: `${p}-note`, id: "research.tooLong", vars: { max: MAX_ATLAS_UNCERTAINTY_CHARS } };
    if (dating.approved) {
      if (!dating.evidence.length) return { field: `${p}-approved`, id: "atlas.showNeedsEvidence" };
      if (dating.evidence.some((item) => item.passage)) return { field: `${p}-approved`, id: "atlas.showNoPassage" };
    }
  }
  return null;
}

/**
 * Rests nested evidence drafts on a newer stored list. Evidence has no id, so
 * an item is known by its source and passage, but only while that pair is
 * unambiguous: exactly one item in the copy the draft was opened from
 * (`opened`) and exactly one in the newer list share it, and the draft rests
 * on that newer item wherever it now sits. When several items share the pair,
 * the newer item must also carry the opened copy's locators; if that still
 * leaves several, only the one at the draft's own index qualifies. Otherwise
 * the draft keeps its own copy rather than borrow another item's fields.
 */
export function rebaseAtlasEvidence(drafts, list, opened) {
  const text = (value) => (typeof value === "string" ? value : "");
  const object = (value) => value && typeof value === "object";
  const pair = (value) => (object(value) ? JSON.stringify([text(value.source), text(value.passage)]) : null);
  const locators = (value) => (Array.isArray(value?.locators) ? value.locators : []);
  const sameLocators = (a, b) => {
    const [x, y] = [locators(a), locators(b)];
    return x.length === y.length && x.every((item, index) => object(item) && object(y[index]) && sameLocator(item, y[index]));
  };
  const items = Array.isArray(list) ? list : [];
  const before = Array.isArray(opened) ? opened : drafts.filter((item) => Number.isInteger(item.from)).map((item) => item.original);
  const count = (values, key) => values.filter((value) => pair(value) === key).length;
  for (const item of drafts) {
    if (!Number.isInteger(item.from) || !object(item.original)) continue;
    const key = pair(item.original);
    const candidates = items.filter((value) => pair(value) === key);
    let newer = null;
    if (candidates.length === 1 && count(before, key) === 1) newer = candidates[0];
    else {
      const matching = candidates.filter((value) => sameLocators(value, item.original));
      const openedMatching = before.filter((value) => pair(value) === key && sameLocators(value, item.original));
      // Identical opened items cannot be told apart by content: the position
      // counts only while the group of identical items is the same size.
      if (matching.length === 1 && openedMatching.length === 1) newer = matching[0];
      else if (matching.length === openedMatching.length && matching.includes(items[item.from])) newer = items[item.from];
    }
    if (!newer) continue;
    item.original = structuredClone(newer);
    item.from = items.indexOf(newer);
  }
}

/**
 * Rests an item's dating drafts on the newer stored datings, by identity:
 * each draft read from the store takes the newer copy of the dating with the
 * same id, wherever it now sits, so fields added elsewhere at every level
 * survive. A dating removed elsewhere keeps the draft's copy. A dating added
 * elsewhere (not in the copy the draft was opened from) joins the draft, so
 * keeping the draft never drops it. Returns how many were added.
 */
export function rebaseAtlasDatings(datings, stored, openedFrom = []) {
  const list = (Array.isArray(stored) ? stored : []).filter((item) => item && typeof item === "object" && typeof item.id === "string");
  const byId = new Map(list.map((item) => [item.id, item]));
  for (const dating of datings) {
    const newer = dating.storedId ? byId.get(dating.storedId) : null;
    if (!newer) continue;
    const date = newer.date && typeof newer.date === "object" ? newer.date : {};
    const opened = dating.original?.evidence;
    dating.original = structuredClone(newer);
    dating.dateExtras = extrasOf(date, DATE_FORM_KEYS);
    for (const slot of DATE_SLOTS) if (date[slot] && typeof date[slot] === "object") dating.points[slot].extras = extrasOf(date[slot], POINT_KEYS);
    if (date.relative && typeof date.relative === "object") dating.relative.extras = extrasOf(date.relative, RELATIVE_KEYS);
    dating.assertedBy.original = structuredClone(newer.assertedBy || { kind: "author" });
    rebaseAtlasEvidence(dating.evidence, newer.evidence, opened);
  }
  const known = new Set([...(Array.isArray(openedFrom) ? openedFrom : []).map((item) => item?.id), ...datings.map((dating) => dating.storedId).filter(Boolean)]);
  const added = list.filter((item) => !known.has(item.id)).map((item) => atlasDatingDraft(item));
  datings.push(...added);
  return added.length;
}

/** Rests an entry draft on a newer stored copy: its own unknown fields, and its datings by identity. */
export function rebaseAtlasEntryDraft(draft, current) {
  const openedFrom = draft.original?.dates;
  draft.original = structuredClone(current);
  rebaseAtlasDatings(draft.datings, current?.dates, openedFrom);
  return draft;
}

/** What the When group says about an item's datings. */
export function atlasDatesText(count) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  return n ? say("atlas.datingsCount", { count: n }) : say("atlas.noDatingsHere");
}

/** The explorer's time window from the filter fields, in historical years (negative is BCE). */
export function atlasChronologyWindow(filters = {}, maxYear = DEFAULT_MAX_YEAR) {
  const read = (text, era) => {
    if (!String(text ?? "").trim()) return { year: null };
    const n = wholeNumber(text);
    if (!(n >= 1 && n <= maxYear)) return { problem: true };
    return { year: era === "bce" ? -n : n };
  };
  const from = read(filters.fromYear, filters.fromEra || "bce");
  const to = read(filters.toYear, filters.toEra || "ce");
  if (from.problem || to.problem) return { active: false, from: null, to: null, problem: "atlas.windowBad" };
  if (from.year !== null && to.year !== null && from.year > to.year) return { active: false, from: from.year, to: to.year, problem: "atlas.windowReversed" };
  return { active: from.year !== null || to.year !== null, from: from.year, to: to.year, problem: "" };
}

/** The heading a dated aspect is listed under: the century, decade or year it begins in. */
export function atlasChronologyGroupLabel(year, zoom = "century") {
  if (zoom === "none") return "";
  if (!Number.isInteger(year)) return say("atlas.openStart");
  const era = year < 0 ? say("atlas.bce") : say("atlas.ce");
  const magnitude = Math.abs(year);
  if (zoom === "year") return atlasYearText(year);
  if (zoom === "decade") {
    const decade = Math.floor(magnitude / 10) * 10;
    return decade ? [say("atlas.the"), `${decade}s`, era].join(" ") : ["1–9", era].join(" ");
  }
  return [ordinal(Math.ceil(magnitude / 100)), say("atlas.century"), era].join(" ");
}

/** The name of a dated item: an entry's label, or a relationship read in its stored direction. */
export function atlasOwnerName(state, collection, id) {
  if (collection === "entries") return atlasEntryName(state.entries, id);
  const relationship = (state.relationships || []).find((item) => item.id === id);
  return relationship ? atlasRelationshipSentence(relationship, state.entries, state.kinds) : [String(id), say("atlas.missingMark")].join(" ");
}

/**
 * The chronology explorer's model, from the server's chronology index. A
 * dated aspect (one item's datings of one aspect) keeps all its competing
 * datings together, in the index's one display order. Filters show or hide a
 * whole dated aspect and never one of its competing datings: a dating outside
 * the time window is kept and marked when a competitor falls inside it. A
 * dated aspect with no absolute dating is listed apart, never placed in time.
 */
export function atlasChronologyModel(state, filters = {}) {
  const chronology = state.chronology || {};
  const timeline = Array.isArray(chronology.timeline) ? chronology.timeline : [];
  const prompts = Array.isArray(chronology.prompts) ? chronology.prompts : [];
  const promptCount = new Map();
  for (const prompt of prompts) for (const id of prompt.datings || []) promptCount.set(id, (promptCount.get(id) || 0) + 1);
  const records = new Map();
  for (const item of [...(state.entries || []), ...(state.relationships || [])]) for (const dating of item.dates || []) records.set(dating.id, dating);
  const rows = [];
  const byKey = new Map();
  for (const item of timeline) {
    const key = `${item.collection}:${item.owner}:${item.aspect}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, owner: item.owner, collection: item.collection, aspect: item.aspect, name: atlasOwnerName(state, item.collection, item.owner), datings: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.datings.push({ ...item, record: records.get(item.id) || null, prompts: promptCount.get(item.id) || 0, inWindow: null });
  }
  const years = atlasChronologyWindow(filters, state.kinds?.maxYear);
  const overlaps = (dating) => (dating.endYear ?? Infinity) >= (years.from ?? -Infinity) && (dating.startYear ?? -Infinity) <= (years.to ?? Infinity);
  for (const row of rows) {
    row.placed = row.datings.find((dating) => dating.placement === "dated") || null;
    row.startYear = row.placed ? row.placed.startYear : null;
    for (const dating of row.datings) dating.inWindow = years.active && dating.placement === "dated" ? overlaps(dating) : null;
  }
  const words = foldAtlasText(filters.query).split(" ").filter(Boolean);
  const matches = (row) => {
    if (filters.aspect && row.aspect !== filters.aspect) return false;
    if (filters.competing && row.datings.length < 2) return false;
    if (filters.prompted && !row.datings.some((dating) => dating.prompts)) return false;
    if (words.length) {
      const haystack = foldAtlasText(`${row.owner} ${row.name}`);
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    if (years.active && row.placed) return row.datings.some((dating) => dating.inWindow);
    return true;
  };
  const shown = rows.filter(matches);
  const zoom = ["century", "decade", "year", "none"].includes(filters.zoom) ? filters.zoom : "century";
  const groups = [];
  for (const row of shown.filter((item) => item.placed)) {
    const label = atlasChronologyGroupLabel(row.startYear, zoom);
    if (groups.length && groups[groups.length - 1].label === label) groups[groups.length - 1].rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  const relative = shown.flatMap((row) => row.datings.filter((dating) => dating.placement === "relative").map((dating) => ({ row, dating })));
  return {
    rows,
    groups,
    unplaced: shown.filter((row) => !row.placed),
    relative,
    prompts,
    unlisted: Number.isInteger(chronology.unlisted) ? chronology.unlisted : 0,
    years,
    zoom,
    total: { rows: rows.length, datings: timeline.length },
    shown: { rows: shown.length, datings: shown.reduce((sum, row) => sum + row.datings.length, 0) },
  };
}

/** What Chronology shows, in her words: the counts, then each filter in force. */
export function atlasChronologyStatus(model, filters = {}) {
  const parts = [say("atlas.showing", { shown: model.shown.datings, total: model.total.datings })];
  if (filters.aspect) parts.push(say("atlas.onlyAspect", { aspect: aspectNoun(filters.aspect) }));
  if (model.years.active) {
    if (model.years.from !== null) parts.push(say("atlas.fromYear", { year: atlasYearText(model.years.from) }));
    if (model.years.to !== null) parts.push(say("atlas.toYear", { year: atlasYearText(model.years.to) }));
  }
  if (filters.competing) parts.push(say("atlas.onlyCompeting"));
  if (filters.prompted) parts.push(say("atlas.onlyPrompted"));
  const text = parts.join(" · ");
  return model.years.problem ? `${text}. ${sayId(model.years.problem)}` : text;
}


// Readings side by side as rules: the editor's model (a file's JSON in, the same file out, every field
// kept), the ids of new items, who holds a reading, how items stand, the problems found before a save is
// sent and the ones the server sent, and what the list and the preview say. The server owns every rule,
// the canonical form and every approval: nothing here decides whether words are approved, and the editor
// never builds an approval. DOM-free, tested. Lifted from the old Admin's comparison helpers
// (web/admin/admin.js, "Interpretation comparisons"). Studio R13; docs/specs/studio/r13/ux.md.
import { say } from "./words.js";

export const LIMITS = Object.freeze({ title: 120, subject: 600, statement: 4000, uncertainty: 1000, explanation: 6000, note: 400, address: 64 });
const ADDRESS = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const blank = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
const list = (value) => (Array.isArray(value) ? value : []);

/** An editor draft from the file's JSON. Fields the editor doesn't show travel inside the copies. */
export function readingDraft(comparison = null, slug = "") {
  const source = comparison && typeof comparison === "object" ? structuredClone(comparison) : {};
  delete source.format;
  delete source.version;
  return {
    ...source,
    slug,
    title: typeof source.title === "string" ? source.title : "",
    subject: typeof source.subject === "string" ? source.subject : "",
    status: source.status === "published" ? "published" : "draft",
    interpretations: list(source.interpretations).map((item) => ({ ...item, evidence: list(item.evidence) })),
    relations: list(source.relations),
    explanations: list(source.explanations).map((item) => ({ ...item, evidence: list(item.evidence) })),
  };
}

function itemPayload(item, optional) {
  const out = { ...item };
  for (const key of optional) if (blank(out[key])) delete out[key];
  if (out.evidence.length) {
    out.evidence = out.evidence.map((ref) => {
      const copy = { ...ref };
      if (blank(copy.locator)) delete copy.locator;
      return copy;
    });
  } else delete out.evidence;
  if (out.origin?.kind !== "ai-draft" && Object.keys(out.origin || {}).length <= 1) delete out.origin;
  else if (blank(out.origin.draftedAt)) {
    out.origin = { ...out.origin };
    delete out.origin.draftedAt;
  }
  if (!out.approval) delete out.approval;
  return out;
}

/** The JSON a save sends: no slug, empty optional fields left out, an approval only as the server stored it. */
export function readingPayload(draft) {
  const { slug: _slug, interpretations, relations, explanations, ...rest } = draft;
  const out = { ...rest };
  out.interpretations = interpretations.map((item) => {
    const copy = itemPayload(item, ["uncertainty", "language", "translationOf"]);
    if (copy.attribution && blank(copy.attribution.certainty)) {
      copy.attribution = { ...copy.attribution };
      delete copy.attribution.certainty;
    }
    return copy;
  });
  if (relations.length) {
    out.relations = relations.map((relation) => {
      const copy = { ...relation };
      if (blank(copy.note)) delete copy.note;
      return copy;
    });
  }
  if (explanations.length) out.explanations = explanations.map((item) => itemPayload(item, ["about"]));
  return out;
}

export const readingSame = (a, b) => JSON.stringify(readingPayload(a)) === JSON.stringify(readingPayload(b));

/** A unique item id (a lowercase slug, at most 64 characters) built from `base`. */
export function newId(items, base) {
  const stem = String(base).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56).replace(/-+$/g, "") || "item";
  const used = new Set(items.map((item) => item.id));
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n += 1) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

/** A new reading. Who holds it is chosen by her; there is no default name. */
export const newReading = (items) => ({ id: newId(items, "reading"), attribution: { kind: "named", name: "" }, statement: "", evidence: [] });

/** A new explanation at a level, about the whole comparison unless `about` names a reading. */
export function newExplanation(items, level = "beginner", about = "") {
  const item = { id: newId(items, `${level}${about ? `-${about}` : ""}`), level, text: "", evidence: [] };
  if (about) item.about = about;
  return item;
}

/** The attribution as another kind, keeping only the certainty she recorded. */
export function attributionAs(attribution, kind) {
  const next = { kind, ...(kind === "named" ? { name: "" } : kind === "source" ? { source: "" } : { description: "" }) };
  if (attribution?.certainty) next.certainty = attribution.certainty;
  return next;
}

/** Mark an item as drafted by an AI tool, or as her own words; its approval goes with the change. */
export function setOrigin(item, ai, tool = "") {
  if (ai) item.origin = { kind: "ai-draft", tool: item.origin?.tool || tool };
  else delete item.origin;
  delete item.approval;
  return item;
}

/** What names a reading, for headings and the relation pickers ("" when nothing is set yet). */
export function whoHolds(attribution, sources = []) {
  if (!attribution) return "";
  if (attribution.kind === "source") {
    const found = sources.find((source) => source.id === attribution.source);
    return found ? found.title : attribution.source || "";
  }
  return (attribution.kind === "anonymous" ? attribution.description : attribution.name) || "";
}

/** The heading of a reading: who holds it, or "Someone unknown" while nothing is written. */
export const readingWho = (item, sources = []) => whoHolds(item.attribution, sources) || say("readings.someone");

/** The state facts for an item id from the server's `states`, or null. */
export const stateOf = (states, id) => (Array.isArray(states) ? states.find((s) => s.id === id) || null : null);

/** How an item stands, in words (a badge says it; never colour alone). */
export function standingWords(state) {
  switch (state?.standing) {
    case "authored": return say("readings.standingAuthored");
    case "approved": return say("readings.standingApproved");
    case "awaiting-approval": return say("readings.standingAwaiting");
    case "stale": return say("readings.standingStale");
    default: return say("readings.standingUnknown");
  }
}

/** One evidence reference's state, in words. Missing evidence is shown, never blocking. */
export function evidenceWords(state) {
  switch (state) {
    case "public": return say("readings.evidencePublic");
    case "private": return say("readings.evidencePrivate");
    case "missing": return say("readings.evidenceMissing");
    default: return say("readings.evidenceUnchecked");
  }
}

export const certaintyWords = (value) => {
  switch (value) {
    case "stated": return say("readings.certaintyStated");
    case "attributed": return say("readings.certaintyAttributed");
    case "uncertain": return say("readings.certaintyUncertain");
    case "disputed": return say("readings.certaintyDisputed");
    default: return say("readings.certaintyNone");
  }
};

export const levelWords = (value) => (value === "student" ? say("readings.levelStudent") : value === "scholarly" ? say("readings.levelScholarly") : say("readings.levelBeginner"));

export const relationKindWords = (value) => {
  switch (value) {
    case "agrees-with": return say("readings.relAgrees");
    case "builds-on": return say("readings.relBuilds");
    case "responds-to": return say("readings.relResponds");
    default: return say("readings.relDiffers");
  }
};

/** Whether a relation reads the same either way round. */
export const symmetric = (kind) => kind === "differs-from" || kind === "agrees-with";

/** The evidence an explanation may use: only what its reading already cites (a whole-comparison one may use any reading's). */
export function explanationEvidenceChoices(draft, explanation) {
  const pool = explanation.about ? draft.interpretations.filter((i) => i.id === explanation.about) : draft.interpretations;
  const seen = new Set();
  const out = [];
  for (const item of pool) {
    for (const ref of item.evidence) {
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, ref: { ...ref } });
    }
  }
  return out;
}

export const refKey = (ref) => (ref.link !== undefined ? `link:${ref.link}` : `source:${ref.source}|${ref.locator || ""}`);

/** Taking a reading out takes out the relations that name it and the explanations about it. */
export function takeOutReading(draft, id) {
  draft.interpretations = draft.interpretations.filter((i) => i.id !== id);
  draft.relations = draft.relations.filter((r) => r.from !== id && r.to !== id);
  draft.explanations = draft.explanations.filter((x) => x.about !== id);
}

/** File-only facts of an explanation that the card shows and a save carries untouched. */
export function fileFacts(explanation) {
  const facts = [];
  if (list(explanation.authors).length) facts.push(say("readings.factAuthors", { authors: explanation.authors.join(", ") }));
  if (!blank(explanation.prerequisite)) facts.push(say("readings.factBefore", { text: explanation.prerequisite }));
  if (list(explanation.modes).length) facts.push(say("readings.factModes", { modes: explanation.modes.join(", ") }));
  if (!blank(explanation.translationOf)) facts.push(say("readings.factTranslates", { other: explanation.translationOf }));
  return facts;
}

/**
 * Problems found without the server, as `{ field, item, code }`; nothing is sent while any stands. `item` is
 * an item id or null. Codes: required (field), bad-address, duplicate-id, too-long, ai-tool.
 */
export function localProblems(draft, { isNew = true } = {}) {
  const found = [];
  const add = (field, item, code) => found.push({ field, item, code });
  if (blank(draft.title)) add("title", null, "required");
  else if (draft.title.length > LIMITS.title) add("title", null, "too-long");
  if (blank(draft.subject)) add("subject", null, "required");
  else if (draft.subject.length > LIMITS.subject) add("subject", null, "too-long");
  if (isNew && (!ADDRESS.test(draft.slug || "") || draft.slug.length > LIMITS.address)) add("address", null, "bad-address");
  const seen = new Set();
  const check = (item) => {
    if (seen.has(item.id)) add("id", item.id, "duplicate-id");
    seen.add(item.id);
  };
  for (const item of draft.interpretations) {
    check(item);
    const a = item.attribution || {};
    if (blank(a.kind === "source" ? a.source : a.kind === "anonymous" ? a.description : a.name)) add("attribution", item.id, "required");
    if (blank(item.statement)) add("statement", item.id, "required");
    else if (item.statement.length > LIMITS.statement) add("statement", item.id, "too-long");
    if (!blank(item.uncertainty) && item.uncertainty.length > LIMITS.uncertainty) add("uncertainty", item.id, "too-long");
    if (item.origin?.kind === "ai-draft" && blank(item.origin.tool)) add("tool", item.id, "ai-tool");
  }
  for (const item of draft.explanations) {
    check(item);
    if (blank(item.text)) add("text", item.id, "required");
    else if (item.text.length > LIMITS.explanation) add("text", item.id, "too-long");
    if (item.origin?.kind === "ai-draft" && blank(item.origin.tool)) add("tool", item.id, "ai-tool");
  }
  return found;
}

/** The server's `problems[]` as `{ field, item, code }` (G98 gives `code` and `field`; `item` names the item). */
export function readingsProblem(error) {
  const data = error?.data || {};
  const rows = Array.isArray(data.problems) ? data.problems : [];
  return rows.map((p) => ({ field: p.field || "", item: p.item ?? null, code: p.code || "bad-value", message: p.message || "" }));
}

/** A problem as her words. Literal ids only; the server's sentence is kept for the details layer by the caller. */
export function problemWords(code, field = "") {
  switch (code) {
    case "required":
      if (field === "title") return say("readings.pTitle");
      if (field === "subject") return say("readings.pSubject");
      if (field === "statement") return say("readings.pStatement");
      if (field === "text") return say("readings.pExplanation");
      return say("readings.pWho");
    case "ai-tool": return say("readings.pTool");
    case "bad-address": return say("readings.pAddress");
    case "too-long": return say("readings.pTooLong");
    case "too-many": return say("readings.pTooMany");
    case "duplicate-id": return say("readings.pDuplicate");
    case "unknown-reference": return say("readings.pUnknown");
    case "self-relation": return say("readings.pSelf");
    case "explanation-evidence": return say("readings.pEvidence");
    case "approval-added": return say("readings.pApproval");
    case "judgement-field": return say("readings.pJudgement");
    default: return say("readings.pBadValue");
  }
}

/** A refused call's own answer in her words: G98's top-level `code`, then today's flags. */
export function errorWords(error) {
  const data = error?.data || {};
  const code = data.code || (data.conflict ? "changed" : data.exists ? "exists" : data.stale ? "stale" : data.notAi ? "not-ai" : data.needsUnpublish ? "needs-unpublish" : "");
  switch (code) {
    case "changed": return say("readings.eChanged");
    case "exists": return say("readings.eExists");
    case "missing": return say("readings.eMissing");
    case "too-large": return say("readings.eTooLarge");
    case "storage": return say("readings.eStorage");
    case "stale": return say("readings.approvalTextChanged");
    case "not-ai": return say("readings.eNotAi");
    case "no-approval": return say("readings.eNoApproval");
    default: return say("readings.eGeneric");
  }
}

/** The list's line for one comparison: its standing, as words. */
export function listLine(item) {
  if (!item.valid) return say("readings.rowUnreadable");
  if (item.status !== "published") return say("readings.rowDraft");
  return item.shown === false ? say("readings.rowNotShown") : say("readings.rowShown");
}

export const countsLine = (item) => say("readings.rowCounts", { readings: item.interpretations, explanations: item.explanations });
export const waitingLine = (count) => (count === 1 ? say("readings.waitingOne") : say("readings.waiting", { count }));

/** Why the projection left something out, in her words (author-only). */
export function leftOutWords(reason) {
  switch (reason) {
    case "awaiting-approval": return say("readings.leftAwaiting");
    case "stale-approval": return say("readings.leftStale");
    case "subject-withheld": return say("readings.leftSubject");
    case "evidence-not-public": return say("readings.leftEvidence");
    case "attribution-not-public": return say("readings.leftAttribution");
    case "withdrawn": return say("readings.leftWithdrawn");
    case "draft": return say("readings.leftDraft");
    case "too-few-interpretations": return say("readings.leftTooFew");
    default: return say("readings.leftDraft");
  }
}

/** One "left out" line: `{name}: {why}`, the name being the item's own (a reading's holder, an explanation's level). */
export function leftOutLine(entry, nameOf) {
  return say("readings.leftOutLine", { name: nameOf(entry.id), why: leftOutWords(entry.reason) });
}

/** The words after a save: what happened and where readers can see it. */
export function savedWords({ wasPublished, status, shown, siteOn, url, droppedWho }) {
  if (droppedWho) return say("readings.approvalDropped", { who: droppedWho });
  if (status !== "published") return wasPublished ? say("readings.wasDrafted") : say("readings.savedDraft");
  if (siteOn === false) return say("readings.publishedSiteOff");
  if (shown === false) return say("readings.publishedHidden");
  return wasPublished ? say("readings.updated") : say("readings.published", { url });
}

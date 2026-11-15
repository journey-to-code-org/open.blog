// Claims and evidence (Studio R12): her statements in a post and how her sources bear on them, as
// the old Admin's claims helpers (the old Admin's admin.js l.6310–7110), lifted; the Visual-editor
// selection mapping is gone with Visual mode (Studio's boxes are the Markdown). Nothing here scores
// evidence or decides what's true, and a citation alone links nothing.
import { say } from "./words.js";
import { parseLocatorLines } from "./notebook-rules.js";
import { ATLAS_CONFIDENCE, atlasEvidenceDraft, atlasEvidencePayload } from "./atlas-rules.js";


// ---------------------------------------------------------------- claims and evidence links

/** How a source bears on a claim, as she reads it. Never defaulted: a citation alone asserts none. */
export const CLAIM_RELATIONS = Object.freeze(["supports", "contradicts", "contextualizes"].map((value) => Object.freeze({ value })));

/** A relation in her words: the choice, and its column heading. */
export function relationWords(value) {
  return { supports: say("claims.supports"), contradicts: say("claims.contradicts"), contextualizes: say("claims.context") }[value] || "";
}

/** What a person, never the software, has done to check a link. */
export const CLAIM_REVIEW_STATES = Object.freeze(["unreviewed", "location-checked", "reviewed"].map((value) => Object.freeze({ value })));

export function reviewStateWords(value) {
  return { unreviewed: say("claims.reviewNone"), "location-checked": say("claims.reviewPlace"), reviewed: say("claims.reviewRead") }[value] || say("claims.reviewNone");
}

export const MAX_CLAIM_STATEMENT_CHARS = 2000;

export const MAX_CLAIM_RATIONALE_CHARS = 4000;

export const CLAIM_UNSAFE_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export const claimEncoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

/** The UTF-8 length of a string, which is how claim anchors count. */
export function utf8Length(text) {
  const value = String(text ?? "");
  if (claimEncoder) return claimEncoder.encode(value).length;
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * The anchor for a selection in the Markdown body, in the server's terms: UTF-8 byte offsets into
 * the saved draft's anchor text (CRLF folded to LF, leading newlines dropped as a save drops them),
 * with surrounding spaces trimmed. Returns `{ anchor }` or `{ error }`; the server checks it again.
 */
export function claimSelectionAnchor(body, start, end) {
  const raw = String(body ?? "");
  let from = Math.max(0, Math.min(Number(start) || 0, raw.length));
  let to = Math.max(from, Math.min(Number(end) || 0, raw.length));
  while (from < to && /\s/.test(raw[from])) from += 1;
  while (to > from && /\s/.test(raw[to - 1])) to -= 1;
  if (from === to) return { error: "claims.selectFirst" };
  const lead = raw.match(/^[\r\n]*/)[0].length;
  if (from < lead) return { error: "claims.selectFirst" };
  const fold = (text) => text.replace(/\r\n/g, "\n");
  const text = fold(raw.slice(from, to));
  if (CLAIM_UNSAFE_TEXT.test(text) || text.includes("\r")) return { error: "claims.plainWords" };
  if ([...text].length > MAX_CLAIM_STATEMENT_CHARS) return { error: "claims.tooMuch", vars: { max: MAX_CLAIM_STATEMENT_CHARS } };
  const offset = utf8Length(fold(raw.slice(lead, from)));
  return { anchor: { start: offset, end: offset + utf8Length(text), text } };
}

/** Where a claim's words stand, as a word id (claims are checked against the saved post, decision 12). */
export function claimAnchorStatusText(status) {
  switch (status?.status) {
    case "verified": return "claims.inPlace";
    case "moved": return "claims.moved";
    case "stale": return status.missingPost ? "claims.saveFirst" : "claims.lost";
    case "ambiguous": return "claims.ambiguous";
    default: return "claims.whole";
  }
}

/** Links of one claim grouped by relation, each in file order. Nothing is netted, ranked or hidden. */
export function claimLinkColumns(links, claimId) {
  const columns = { supports: [], contradicts: [], contextualizes: [] };
  for (const link of Array.isArray(links) ? links : []) if (link.claim === claimId && columns[link.relation]) columns[link.relation].push(link);
  return columns;
}

/**
 * The evidence gaps and review prompts (ADR 0074) about one claim and its links, in the order the
 * server reviewed them, which is the order `openblog check` prints. Only well-formed findings are kept.
 */
export function claimFindings(findings, claimId) {
  return (Array.isArray(findings) ? findings : []).filter(
    (finding) => finding && finding.object?.claim === claimId && typeof finding.code === "string" && typeof finding.message === "string" && typeof finding.repair === "string",
  );
}

export const CLAIM_FINDING_OUTCOMES = Object.freeze(["detected", "potential", "needs-review"]);

/** A post's findings in her words: each outcome counted apart, framed as gaps, never as a verdict. */
export function claimFindingsSummary(findings) {
  const list = Array.isArray(findings) ? findings : [];
  if (!list.length) return say("claims.summaryNone");
  const count = (outcome) => list.filter((finding) => finding.outcome === outcome).length;
  return say("claims.summary", { detected: count("detected"), potential: count("potential"), review: count("needs-review") });
}

/** Counts per relation, deliberately three figures that are never combined. */
export function claimCountsText(counts = {}) {
  return say("claims.counts", { supports: counts.supports || 0, contradicts: counts.contradicts || 0, context: counts.contextualizes || 0 });
}

export function claimDraft(record = null, prefill = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof value.id === "string" ? value.id : prefill.id || "",
    post: typeof value.post === "string" ? value.post : prefill.post || "",
    statement: typeof value.statement === "string" ? value.statement : prefill.statement || "",
    anchor: value.anchor && typeof value.anchor === "object" ? structuredClone(value.anchor) : prefill.anchor || null,
    uncertainty: typeof value.uncertainty === "string" ? value.uncertainty : "",
    approved: value.visibility === "approved",
  };
}

/** The full claim to send. Unknown fields of the stored record, and its attribution and origin, carry over. */
export function claimPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["anchor", "uncertainty"]) delete record[field];
  record.id = draft.id;
  record.post = draft.post;
  record.statement = String(draft.statement ?? "").trim();
  if (draft.anchor) record.anchor = { ...(draft.original?.anchor || {}), ...draft.anchor };
  const uncertainty = String(draft.uncertainty ?? "").trim();
  if (uncertainty) record.uncertainty = uncertainty;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

export function evidenceLinkDraft(record = null, prefill = {}) {
  const value = record && typeof record === "object" ? record : {};
  return {
    original: record ? structuredClone(record) : null,
    id: typeof value.id === "string" ? value.id : prefill.id || "",
    claim: typeof value.claim === "string" ? value.claim : prefill.claim || "",
    // Never defaulted: the author names how the source bears on the claim.
    relation: CLAIM_RELATIONS.some((item) => item.value === value.relation) ? value.relation : "",
    evidence: atlasEvidenceDraft(value.evidence || {}, record ? 0 : null),
    rationale: typeof value.rationale === "string" ? value.rationale : "",
    confidence: ATLAS_CONFIDENCE.some((item) => item.value === value.confidence) ? value.confidence : "tentative",
    uncertainty: typeof value.uncertainty === "string" ? value.uncertainty : "",
    reviewState: CLAIM_REVIEW_STATES.some((item) => item.value === value.reviewState) ? value.reviewState : "unreviewed",
    approved: value.visibility === "approved",
  };
}

export function evidenceLinkPayload(draft) {
  const record = { ...(draft.original || {}) };
  for (const field of ["rationale", "uncertainty"]) delete record[field];
  record.id = draft.id;
  record.claim = draft.claim;
  record.relation = draft.relation;
  record.evidence = atlasEvidencePayload(draft.evidence);
  const rationale = String(draft.rationale ?? "").trim();
  if (rationale) record.rationale = rationale;
  record.confidence = draft.confidence;
  const uncertainty = String(draft.uncertainty ?? "").trim();
  if (uncertainty) record.uncertainty = uncertainty;
  record.reviewState = draft.reviewState;
  record.visibility = draft.approved ? "approved" : "private";
  return record;
}

export function validateEvidenceLinkDraft(draft, { sources = [], passages = [] } = {}) {
  if (!CLAIM_RELATIONS.some((item) => item.value === draft.relation)) return { field: "relation", id: "claims.chooseRelation" };
  const source = draft.evidence.source;
  if (!source) return { field: "source", id: "claims.chooseSource" };
  if (!sources.some((item) => item.id === source)) return { field: "source", id: "notebook.badSource" };
  if (draft.evidence.passage) {
    const passage = passages.find((item) => item.id === draft.evidence.passage);
    if (!passage) return { field: "passage", id: "notebook.badPassage" };
    if (passage.source !== source) return { field: "passage", id: "claims.passageOtherSource" };
    if (draft.approved) return { field: "passage", id: "claims.noPassagePublic" };
  }
  if (parseLocatorLines(draft.evidence.locators).some((locator) => !locator.kind || !locator.value)) return { field: "locators", id: "claims.badPlace" };
  for (const [field, text, max] of [["rationale", draft.rationale, MAX_CLAIM_RATIONALE_CHARS], ["uncertainty", draft.uncertainty, 2000]]) {
    if ([...String(text ?? "")].length > max) return { field, id: "research.tooLong", vars: { max } };
    if (CLAIM_UNSAFE_TEXT.test(String(text ?? "").replace(/[\n\t]/g, " "))) return { field, id: "claims.plainWords" };
  }
  if (draft.approved && draft.original?.origin === "suggested" && draft.reviewState !== "reviewed") return { field: "approved", id: "claims.reviewSuggested" };
  return null;
}

/** A server diagnostic's field, mapped to the claims form control that edits it. */
export function claimDiagnosticControl(field, type = "claim") {
  const path = String(field || "");
  if (type === "claim") return { statement: "statement", uncertainty: "uncertainty", visibility: "approved", post: "statement", anchor: "statement" }[path.split(".")[0]] || "";
  if (path.startsWith("evidence.passage")) return "passage";
  if (path.startsWith("evidence.locators")) return "locators";
  if (path.startsWith("evidence")) return "source";
  return { relation: "relation", rationale: "rationale", confidence: "confidence", uncertainty: "uncertainty", reviewState: "review", visibility: "approved", claim: "relation" }[path.split(".")[0]] || "";
}

/** The server's own sentences, for the details under For {helper}. */
export function claimsErrorMessage(error) {
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  if (!diagnostics.length) return String(error?.data?.error || error?.message || "");
  return diagnostics.map((item) => `${item.code ? `${item.code} ` : ""}${item.field ? `${item.field}: ` : ""}${item.message || ""}`).join(" ");
}

/**
 * A selection in one words box as body offsets for claimSelectionAnchor (new, R12): Studio's boxes
 * are the Markdown, so a box's offsets map directly once the box's own place in the body is known.
 * `box` is {start, text} (where the box's text starts in the body); the selection must stay inside
 * one part of the words (a paragraph, heading, list or quote), else { error: "claims.onePart" }.
 */
export function boxSelectionToBody(box, start, end) {
  const text = String(box?.text ?? "");
  const from = Math.max(0, Math.min(Number(start) || 0, text.length));
  const to = Math.max(from, Math.min(Number(end) || 0, text.length));
  if (from === to) return { error: "claims.selectFirst" };
  if (/\n[ \t]*\n/.test(text.slice(from, to).trim())) return { error: "claims.onePart" };
  const base = Number(box?.start) || 0;
  return { start: base + from, end: base + to };
}

/** How many times the selected words occur in the body: a claim needs them once (claims.twice). */
export function occurrences(body, words) {
  const text = String(body ?? "");
  const needle = String(words ?? "").trim();
  if (!needle) return 0;
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) count += 1;
  return count;
}


// For readers (Studio R12): research she chooses to show beside a post, as the old Admin's "Selected
// for readers" helpers (web/admin/admin.js l.2930–3540), lifted. Choosing never makes anything public
// that isn't already; why something stays private is said as a rule, never as a judgement.
import { say } from "./words.js";
import { sayId } from "./research-says.js";

const KIND_IDS = Object.freeze({
  reference: "curate.kindReference", "contextual-entry": "curate.kindEntry", relationship: "curate.kindLink", timeline: "curate.kindDating",
  comparison: "curate.kindComparison", "source-annotation": "curate.kindComment", explanation: "curate.kindExplanation",
});
/** What a choice chooses. */
export const CURATION_KINDS = Object.freeze(Object.keys(KIND_IDS));
export const curationKindWords = (kind) => (KIND_IDS[kind] ? sayId(KIND_IDS[kind]) : "");

const WHY_IDS = Object.freeze({
  withdrawn: "public.whyWithdrawn", stale: "public.whyStale", "target-missing": "public.whyGone", "not-approved": "public.whyNotShown",
  "not-published": "public.whyNotPublished", "source-private": "public.whyNoPost", "post-not-published": "public.whyPostNotUp",
  "dependency-missing": "public.whyNeedsGone", "dependency-withheld": "public.whyNeedsHeld", cycle: "public.whyLoop",
});
/** Why a choice gives readers nothing: the reason codes the server sends. */
export const CURATION_WHY = Object.freeze(Object.keys(WHY_IDS));
export const curationWhyWords = (why) => (WHY_IDS[why] ? sayId(WHY_IDS[why]) : say("public.whyHeld"));

const FIELD_IDS = Object.freeze({
  creators: "public.fieldPeople", title: "public.fieldTitle", csl: "public.fieldCsl", identifiers: "public.fieldIdentifiers", issued: "public.fieldIssued",
  language: "public.fieldLanguage", aliases: "public.fieldAliases", source: "public.fieldWork", summary: "public.fieldSummary", assertedBy: "public.fieldWho",
  confidence: "public.fieldFirm", contestedBy: "public.fieldDisputed", evidence: "public.fieldEvidence", standing: "public.fieldStanding",
  uncertainty: "public.fieldDoubt", date: "public.fieldDate", note: "public.fieldNote", placement: "public.fieldPlacement", text: "public.fieldWords",
  startYear: "public.fieldFirstYear", endYear: "public.fieldLastYear", correspondence: "public.fieldCorrespondence", correspondenceLabel: "public.fieldCorrespondence",
  rationale: "public.fieldReasoning", recordedBy: "public.fieldRecordedBy", versions: "public.fieldVersions", wording: "public.fieldWording", by: "public.fieldBy",
  locator: "public.fieldWhere", label: "public.fieldName", url: "public.fieldAddress", key: "public.fieldKey", kind: "public.fieldKind", from: "public.fieldFrom",
  to: "public.fieldTo", inverseLabel: "public.fieldOtherWay", id: "public.fieldKey", owner: "public.fieldDates", ownerType: "public.fieldDates", aspect: "public.fieldAspect",
});
/** The optional fields she may list for readers (the server's names). */
export const CURATION_FIELDS = Object.freeze(["creators", "title", "csl", "identifiers", "issued", "language", "aliases", "source", "summary", "assertedBy", "confidence",
  "contestedBy", "evidence", "standing", "uncertainty", "date", "note", "placement", "text", "startYear", "endYear", "correspondence", "correspondenceLabel",
  "rationale", "recordedBy", "versions", "wording", "by", "locator"]);
/** A field's name in her words; an unknown one stays as the server named it. */
export const curationFieldWords = (name) => (FIELD_IDS[name] ? sayId(FIELD_IDS[name]) : String(name));

/** A plain-text reading of one public value: a party, an evidence item, a list, a date. */
export function curationValueText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(curationValueText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    if (value.kind === "author") return say("atlas.you");
    if (value.kind === "named" && value.name) return String(value.name);
    if (value.kind === "source" && value.source) return String(value.source);
    if (value.name && Object.keys(value).every((key) => ["name", "role", "family", "given"].includes(key))) return value.role ? `${value.name} (${value.role})` : String(value.name);
    if (value.source) {
      const where = Array.isArray(value.locators) ? value.locators.map((l) => [l.kind, l.value, l.to ? say("place.through") : "", l.to || ""].filter(Boolean).join(" ")).join(", ") : "";
      return `${value.source}${where ? `, ${where}` : ""}`;
    }
    if (value.scheme && value.value) return `${value.scheme}: ${value.value}`;
    return JSON.stringify(value);
  }
  return String(value);
}

/** What readers get of one published item, as rows (name, value) in its own field order, identity first. */
export function curationItemRows(item) {
  const content = item?.content && typeof item.content === "object" ? item.content : {};
  const first = ["title", "label", "by", "text", "key", "id", "kind", "from", "to", "url"];
  const names = [...first.filter((name) => name in content), ...Object.keys(content).filter((name) => !first.includes(name))];
  return names.map((name) => ({ name, label: curationFieldWords(name), value: curationValueText(content[name]) })).filter((row) => row.value !== "");
}

/** A choice's name: what it chooses, by its public name when it has one (kind, then the name, in code). */
export function curationSelectionName(selection) {
  const name = String(selection?.label || selection?.target || selection?.id || "");
  const kind = curationKindWords(selection?.kind);
  return kind ? `${kind}: ${name}` : name;
}

/** One choice's state in words: shown, or the rule that keeps it back. */
export function curationStatusText(selection) {
  if (selection?.status !== "withheld") return say("curate.shown");
  return curationWhyWords(selection.why);
}

/** The ids with `id` moved by `delta` places, or the same order when it cannot move that way. */
export function curationMove(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids.slice();
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** The slug a post will have, as the server writes one, or "" while it has none. */
export function curationPostSlug(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 200);
}


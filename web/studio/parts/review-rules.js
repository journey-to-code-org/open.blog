// Research checks before a research post goes up (Studio R7, ADR 0123): which posts have them,
// how each group and gate reads in her words, where a finding is, and what Mark as checked sends.
// Pure. Lifted from the old Admin (the old Admin's admin.js `researchReviewApplies`,
// `publicationReviewPlace`, `publicationReviewCountsText`; removed in R15): the counts sentence and
// the place stay verbatim for the details, so they read as `openblog check` prints them.
import { say } from "./words.js";

/** Whether publishing a post is preceded by the research review: a research post, or one with citations. */
export function researchReviewApplies(fields, profile = "") {
  const chosen = String(profile || fields?.profile || "").trim().toLowerCase();
  return chosen === "research" || String(fields?.citations ?? "").trim() !== "";
}

/** The groups in the order the server sends them, with their words. */
export const REVIEW_GROUPS = Object.freeze(["blocking", "detected", "potential", "needs-review"]);

/** A group's heading (with its count) and help. */
export function groupWords(name, count) {
  const n = String(count);
  switch (name) {
    case "blocking": return { heading: say("review.blocking", { count: n }), help: say("review.blockingHelp") };
    case "detected": return { heading: say("review.detected", { count: n }), help: say("review.detectedHelp") };
    case "potential": return { heading: say("review.potential", { count: n }), help: say("review.potentialHelp") };
    default: return { heading: say("review.needsReview", { count: n }), help: say("review.needsReviewHelp") };
  }
}

/** Why a finding can't be marked as checked, or "" for one that can. */
export function gateWords(gate) {
  if (gate === "advisory") return "";
  if (gate === "withholds") return say("review.gateWithholds");
  if (gate === "refuses-when-published") return say("review.gateRefusesWhenPublished");
  return say("review.gateRefuses");
}

/** Whether a post finding sits in the front matter field it names rather than in the body. */
const fieldFinding = (scope, firstBodyLine) => Boolean(scope.field) && !(Number(scope.line) >= firstBodyLine);

/** Studio's names for a post's fields, as she sees them. */
const FIELD_NAMES = { title: "Title", description: "Summary", summary: "Summary", subtitle: "A line under the title", tags: "Tags", date: "When it appears", cover: "Cover photo", coverAlt: "Cover photo", series: "Collection" };
const RESEARCH_THINGS = { claim: "claim", "evidence-link": "claim", source: "source", interpretation: "source", passage: "passage", note: "note", entry: "entry", relationship: "relationship", dating: "date", alignment: "comparison" };

/**
 * Where a finding is, in her words: near a line of her words (its first 30 letters), in a field,
 * in another post, or in her research by its own id. `body` is her words as they stand.
 */
export function reviewPlaceWords(finding, { post = "", firstBodyLine = 1, body = "" } = {}) {
  const scope = finding?.scope || {};
  if (scope.object === "post") {
    if (scope.path && post && scope.path !== post) return say("review.placeOtherPost");
    if (fieldFinding(scope, firstBodyLine)) return say("review.placeField", { field: FIELD_NAMES[scope.field] || "the post's details" });
    if (Number.isInteger(scope.line)) {
      const line = String(body).split("\n")[Math.max(0, scope.line - firstBodyLine)] || "";
      const words = line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s*)/, "")
        .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
      if (!words) return say("review.placeWords");
      const chars = [...words];
      return say("review.placeLine", { words: chars.length > 30 ? `${chars.slice(0, 30).join("").trimEnd()}…` : words });
    }
    return say("review.placeWords");
  }
  const thing = RESEARCH_THINGS[scope.object];
  if (thing) return say("review.placeResearch", { thing, id: String(scope.id || "") }).trim();
  return say("review.placeNotes");
}

/**
 * Where Show me goes: `{ kind: "line", line }` (a line of her words, from 1) or `{ kind: "field",
 * field }`, or null when the place isn't in this post (research objects get theirs in R11/R12).
 */
export function reviewTarget(finding, { post = "", firstBodyLine = 1 } = {}) {
  const scope = finding?.scope || {};
  if (scope.object !== "post") return null;
  if (scope.path && post && scope.path !== post) return null;
  if (fieldFinding(scope, firstBodyLine)) return { kind: "field", field: scope.field };
  if (Number.isInteger(scope.line)) return { kind: "line", line: Math.max(1, scope.line - firstBodyLine + 1) };
  return null;
}

/** The place as the old review and `openblog check` say it, for the details (verbatim). */
export function publicationReviewPlace(finding, { post = "", firstBodyLine = 1 } = {}) {
  if (typeof finding?.place === "string" && finding.place) return finding.place;
  const scope = finding?.scope || {};
  const id = scope.id ? ` ${scope.id}` : "";
  switch (scope.object) {
    case "post": {
      if (scope.path && post && scope.path !== post) return `the post ${scope.path}`;
      if (fieldFinding(scope, firstBodyLine)) return `the draft's ${scope.field} field`;
      if (Number.isInteger(scope.line)) return `line ${Math.max(1, scope.line - firstBodyLine + 1)} of the draft`;
      return "the draft";
    }
    case "claim": return `claim${id}`;
    case "evidence-link": return `evidence link${id}`;
    case "source": return `source${id}`;
    case "interpretation": return `interpretation${id}`;
    case "passage": return `notebook passage${id}`;
    case "note": return `notebook note${id}`;
    case "entry": return `atlas entry${id}`;
    case "relationship": return `atlas relationship${id}`;
    case "dating": return `dating${id}`;
    case "alignment": return `comparison${id}${scope.field ? `, ${scope.field}` : ""}`;
    case "source-library": return "the source library";
    case "notebook": return "the research notebook";
    case "atlas": return "the Knowledge Atlas";
    case "claims-file": return "the claims file";
    case "alignments-file": return "the alignments file";
    case "selections-file": return "the curated selections file";
    default: return "your research";
  }
}

/** Each outcome counted apart, with how many are acknowledged: `openblog check`'s sentence, verbatim. */
export function publicationReviewCountsText(review) {
  const counts = review?.counts || {};
  const part = (label, count) => `${label}: ${Number(count?.found) || 0}${Number(count?.acknowledged) ? ` (${Number(count.acknowledged)} acknowledged)` : ""}`;
  const blocking = (review?.groups || []).find((group) => group.name === "blocking")?.findings?.length || 0;
  return `${blocking ? `${blocking} must be fixed ${review?.scope === "site" ? "before the next build" : "before publishing"}. ` : ""}${[part("Detected", counts.detected), part("Potential", counts.potential), part("Needs review", counts.needsReview)].join(". ")}.`;
}

/** The counts in her words: "Found by a check: 2 (1 checked). Might need a look: 0. Only you can check: 3." */
export function reviewCountsWords(review) {
  const counts = review?.counts || {};
  const part = (count) => {
    const found = String(Number(count?.found) || 0);
    const checked = Number(count?.acknowledged) || 0;
    return checked ? say("review.countChecked", { count: found, checked: String(checked) }) : found;
  };
  return say("review.counts", { detected: part(counts.detected), potential: part(counts.potential), review: part(counts.needsReview) });
}

/** What a mark says under its finding ("" for none). */
export function markWords(state) {
  if (state === "current") return say("review.marked");
  if (state === "stale") return say("review.markedStale");
  return "";
}

/** Exactly what Mark as checked sends: the finding's key and fingerprint, with the review's revision. */
export function acknowledgementRequest(entry, revision) {
  const scope = entry?.scope || {};
  return {
    revision,
    acknowledgement: {
      validator: entry.validator,
      code: entry.code,
      object: scope.object,
      ...(scope.path ? { path: scope.path } : {}),
      ...(scope.id ? { id: scope.id } : {}),
      ...(scope.field ? { field: scope.field } : {}),
      fingerprint: entry.fingerprint,
    },
  };
}

/** A refused mark in her words (G51 codes; "changed" reloads the review). */
export function markProblem(error) {
  const code = error?.data?.code || "";
  if (error?.status === 0) return say("review.markNoSignal");
  if (error?.status === 409 || code === "changed" || error?.data?.conflict) return say("review.markChanged");
  return say("review.markRefused");
}

/** How many findings the build would refuse (they block Publish). */
export const blockingCount = (review) => (review?.groups || []).find((group) => group.name === "blocking")?.findings?.length || 0;

/** The groups to show, in order, each with its findings (positions resolved). */
export function reviewGroups(review) {
  const findings = Array.isArray(review?.findings) ? review.findings : [];
  const groups = Array.isArray(review?.groups) ? review.groups : [];
  return REVIEW_GROUPS.flatMap((name) => {
    const group = groups.find((g) => g.name === name);
    const list = (group?.findings || []).map((position) => findings[position]).filter(Boolean);
    return list.length ? [{ name, findings: list }] : [];
  });
}

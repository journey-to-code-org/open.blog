// What readers see (Studio R12): the server's preview of what the next build publishes from her
// research and what stays private, with why, as the old Admin's boundary helpers
// (web/admin/admin.js l.8412–8520), lifted into her words. Never a score.
import { say } from "./words.js";
import { sayId } from "./research-says.js";
import { atlasLinkHash, researchHash } from "./research-rules.js";

const STORE_IDS = Object.freeze({
  citations: "public.storeSources", "claim-evidence": "public.storeClaims", atlas: "public.storeAtlas", datings: "public.storeDatings",
  comparisons: "public.storeComparisons", "context-links": "public.storeLinks", curated: "public.storeChosen",
  "reading-paths": "public.storePaths", interpretations: "public.storeInterpretations",
});
/** Each part of the preview, in the order the server lists them; the data files repeat a part and aren't shown. */
export const BOUNDARY_STORES = Object.freeze(Object.keys(STORE_IDS));
export const HIDDEN_PROJECTIONS = Object.freeze(["atlas-query", "curated-context"]);
export const boundaryStoreWords = (projection) => (STORE_IDS[projection] ? sayId(STORE_IDS[projection]) : String(projection || ""));

const REASON_IDS = Object.freeze({
  "projection-off": "public.whySiteOff", "not-approved": "public.whyNotShown", unsourced: "public.whyUnsourced", "notebook-passage": "public.whyPassage",
  "private-dependency": "public.whyNeedsHeld", "contradiction-withheld": "public.whyContradiction", "post-not-published": "public.whyPostNotUp",
  "stale-approval": "public.whyStale", "unsafe-url": "public.whyAddress", "private-identifier": "public.whyIdentifier", rights: "public.whyRights",
  length: "public.whyLength", "stale-anchor": "public.whyWordsMoved", "page-not-published": "public.whyPageNotUp", withdrawn: "public.whyWithdrawn",
  "stale-selection": "public.whyStale", "missing-target": "public.whyGone", "selection-cycle": "public.whyLoop", "over-limit": "public.whyTooBig",
  inconsistent: "public.whyDisagrees",
});
/** The reason codes the server can give for keeping something back. */
export const BOUNDARY_REASONS = Object.freeze(Object.keys(REASON_IDS));
export const boundaryReasonWords = (reason) => (REASON_IDS[reason] ? sayId(REASON_IDS[reason]) : say("public.whyHeld"));

/**
 * Where an item of the preview is changed, as a Studio address, or null. A dating opens what it
 * dates; a claim or an evidence link opens its post's Claims and evidence, when `postPaths` (a Map
 * from post slug to saved path) says where the post is.
 */
export function boundaryItemHash(item, { postPaths = null } = {}) {
  const id = String(item?.id || "");
  switch (item?.kind) {
    case "source": return researchHash("sources", id);
    case "entry": case "atlas-page": return researchHash("atlas", id);
    case "relationship": return atlasLinkHash(id);
    case "dating": {
      const owner = String(item?.owner?.id || "");
      if (!owner) return researchHash("atlas");
      return item.owner.kind === "relationship" ? atlasLinkHash(owner) : researchHash("atlas", owner);
    }
    case "comparison": case "comparison-page": return researchHash("compare", id);
    case "claim": case "evidence-link": {
      const path = postPaths?.get?.(String(item?.posts?.[0] || ""));
      if (!path) return null;
      const claim = item.kind === "claim" ? id : String(item?.claim || "");
      return `#/write/${encodeURIComponent(path)}?sheet=claims${claim ? `&claim=${encodeURIComponent(claim)}` : ""}`;
    }
    default: return null;
  }
}

/** What the preview shows and keeps back, counted ({shown, held}); the data files add nothing shown. */
export function boundaryCounts(manifest) {
  const reports = Array.isArray(manifest?.projections) ? manifest.projections : [];
  const shown = reports.reduce((sum, report) => sum + (HIDDEN_PROJECTIONS.includes(report.projection) ? 0 : report.published?.length || 0), 0);
  const held = reports.reduce((sum, report) => sum + (report.withheld?.length || 0), 0);
  return { shown, held };
}

/** The counts in her words. */
export function boundaryCountsText(manifest) {
  return say("public.counts", boundaryCounts(manifest));
}

/** The parts to show, in order, each with its items: the data files are folded away. */
export function boundaryGroups(manifest) {
  const reports = Array.isArray(manifest?.projections) ? manifest.projections : [];
  return reports.filter((report) => !HIDDEN_PROJECTIONS.includes(report.projection)).map((report) => ({
    projection: String(report.projection || ""),
    enabled: report.enabled !== false,
    blocked: typeof report.blocked === "string" ? report.blocked : "",
    switch: typeof report.switch === "string" ? report.switch : "",
    published: Array.isArray(report.published) ? report.published : [],
    withheld: Array.isArray(report.withheld) ? report.withheld : [],
  }));
}

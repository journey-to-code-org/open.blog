// Research's own rules (Studio R11–R12): whether this site uses research at all (G92), its screens
// and addresses, the steps on Research home, the forms kept while she moves between research
// screens, and what every answer from the server means in her words. Pure, DOM-free. The address
// map is lifted from the old Admin's `canonicalAdminHash` research map (web/admin/admin.js,
// removed in R15).
import { say } from "./words.js";
import { diagnosticRow, sourceDiagnosticControl } from "./source-rules.js";
import { notebookDiagnosticControl } from "./notebook-rules.js";
import { atlasDiagnosticControl } from "./atlas-rules.js";
import { alignmentDiagnosticControl } from "./compare-rules.js";
import { claimDiagnosticControl } from "./claims-rules.js";

/** Whether this site uses research (G92). Until a server says, never. */
export const researchUsed = (meta) => meta?.siteUses?.research === true;

/** Research's screens, in the order research travels, with the slice that brings each. */
export const RESEARCH_SCREENS = Object.freeze([
  Object.freeze({ id: "overview", path: "", tab: "research.tabOverview" }),
  Object.freeze({ id: "sources", path: "sources", takesId: true, tab: "research.tabSources" }),
  Object.freeze({ id: "notebook", path: "notebook", takesId: true, tab: "research.tabNotebook" }),
  Object.freeze({ id: "atlas", path: "atlas", takesId: true, tab: "research.tabAtlas" }),
  Object.freeze({ id: "compare", path: "compare", takesId: true, tab: "research.tabCompare" }),
  Object.freeze({ id: "public", path: "public", tab: "research.tabPublic" }),
  // R13: only on a site that has readings side by side (its own screen, the list).
  Object.freeze({ id: "readings", path: "readings", tab: "research.tabReadings", when: (meta) => meta?.siteUses?.readings === true }),
]);

/** Research screens that aren't in Studio yet (none since R12); one would open "Not in Studio yet". */
export const RESEARCH_NOT_YET = Object.freeze(new Set());

/** The screens she can reach now, on this site (`meta`). */
export const builtScreens = (meta) => RESEARCH_SCREENS.filter((screen) => !RESEARCH_NOT_YET.has(screen.id) && (!screen.when || screen.when(meta)));

/**
 * Claims and evidence in a post's Write, on one claim when `claim` is given; "" without a post
 * path. Readers (R10) links here from "What they point to" and "The evidence you recorded".
 */
export function claimsHash(path, claim = "") {
  const where = String(path || "");
  if (!/\.md$/.test(where)) return "";
  return `#/write/${encodeURIComponent(where)}?sheet=claims${claim ? `&claim=${encodeURIComponent(String(claim))}` : ""}`;
}

/** The address of one link between atlas entries. */
export const atlasLinkHash = (id) => `#/research/atlas/relationships/${encodeURIComponent(String(id || ""))}`;

/** The address of a research screen, and of one item in it. */
export function researchHash(screen, id = "") {
  const known = RESEARCH_SCREENS.find((item) => item.id === screen) || RESEARCH_SCREENS[0];
  if (!known.path) return "#/research";
  return `#/research/${known.path}${id && known.takesId ? `/${encodeURIComponent(id)}` : ""}`;
}

/**
 * Where an old research address goes now, or null when it is Studio's own. `name` is the first
 * part of the address, `rest` the parts after it, `search` the query (kept). Bare `#/research` was
 * the old notebook's, and is now Research home (decision 11).
 */
export function researchRoute(name, rest = [], search = "") {
  const tail = search ? `?${search}` : "";
  const item = rest.join("/");
  if (name === "sources") return `#/research/sources${item ? `/${item}` : ""}${tail}`;
  if (name === "atlas") return `#/research/atlas${item ? `/${item}` : ""}${tail}`;
  if (name === "compare") return `#/research/compare${item ? `/${item}` : ""}${tail}`;
  if (name !== "research") return undefined;
  if (!rest.length) return null;
  const [screen] = rest;
  if (screen === "overview") return `#/research${tail}`;
  const known = RESEARCH_SCREENS.find((entry) => entry.path && entry.path === screen);
  if (!known) return `#/research${tail}`;
  if (RESEARCH_NOT_YET.has(known.id)) return "#/not-yet/research";
  return null;
}

/**
 * Where a research check's finding opens (R7's Before you publish › Research checks, "Open it"):
 * its research screen for a source, a passage or a note; "" for anything else.
 */
export function openItHash(scope, { post = "", site = false } = {}) {
  const id = String(scope?.id || "");
  const path = String(scope?.path || post || "");
  const claims = (claim) => claimsHash(path, claim);
  switch (scope?.object) {
    case "source": return id ? researchHash("sources", id) : "";
    case "source-library": case "interpretation": return researchHash("sources");
    case "passage": case "note": return id ? researchHash("notebook", id) : "";
    case "notebook": return researchHash("notebook");
    case "entry": return id ? researchHash("atlas", id) : "";
    case "relationship": return id ? atlasLinkHash(id) : "";
    case "dating": case "atlas": return researchHash("atlas");
    case "alignment": return researchHash("compare", id);
    case "alignments-file": return researchHash("compare");
    case "claim": return claims(id);
    case "evidence-link": return claims(String((Array.isArray(scope?.related) ? scope.related : []).find((item) => item?.kind === "claim")?.id || ""));
    case "claims-file": return claims("");
    case "post": return site && /\.md$/.test(path) ? `#/write/${encodeURIComponent(path)}` : "";
    default: return "";
  }
}

// ---- Research home

/**
 * The steps on Research home and the one primary action: the first step not done. `library` and
 * `notebook` are the loaded stores (or `{ failed: true }`); `post` is the post she came from.
 */
export function workflowSteps({ library = null, notebook = null, atlas = null, alignments = null, post = null } = {}) {
  const sources = Array.isArray(library?.sources) ? library.sources.filter((source) => !source.archived) : [];
  const passages = Array.isArray(notebook?.passages) ? notebook.passages.filter((entry) => !entry.archived) : [];
  const notes = Array.isArray(notebook?.notes) ? notebook.notes.filter((entry) => !entry.archived) : [];
  const entries = Array.isArray(atlas?.entries) ? atlas.entries.length : 0;
  const aligned = Array.isArray(alignments?.alignments) ? alignments.alignments.length : 0;
  const steps = [
    { id: "source", heading: say("research.stepSource"), text: say("research.stepSourceText"), visibility: "private",
      state: library?.failed ? say("research.unreadable", { what: say("research.whatLibrary") }) : sources.length ? say("research.stepSourceDone", { count: sources.length }) : say("research.stepSourceNone"),
      done: sources.length > 0, open: { label: sources.length ? say("research.openSources") : say("research.addFirst"), href: researchHash("sources") } },
    { id: "passage", heading: say("research.stepPassage"), text: say("research.stepPassageText"), visibility: "private",
      state: notebook?.failed ? say("research.unreadable", { what: say("research.whatNotebook") }) : passages.length || notes.length ? say("research.stepPassageDone", { passages: passages.length, notes: notes.length }) : say("research.stepPassageNone"),
      done: passages.length > 0, open: { label: say("research.openNotebook"), href: researchHash("notebook") } },
    { id: "relate", heading: say("research.stepRelate"), text: say("research.stepRelateText"), visibility: "private", optional: true,
      state: atlas?.failed || alignments?.failed ? say("research.unreadable", { what: atlas?.failed ? say("research.whatAtlas") : say("research.whatAlignments") })
        : entries || aligned ? say("research.stepRelateDone", { entries, alignments: aligned }) : say("research.stepRelateNone"),
      done: entries > 0 || aligned > 0, links: [{ label: say("research.openAtlas"), href: researchHash("atlas") }, { label: say("research.openCompare"), href: researchHash("compare") }] },
    { id: "cite", heading: say("research.stepCite"), text: say("research.stepCiteText"), visibility: "readers",
      state: post ? say("research.stepCitePost", { title: post.title || post.path }) : say("research.stepCiteNoPost"),
      done: false, open: post ? { label: say("research.backToPost"), href: `#/write/${encodeURIComponent(post.path)}` } : { label: say("research.startPost"), href: "#/write/new/story?kind=research" } },
    { id: "public", heading: say("research.stepPublic"), text: say("research.stepPublicText"), visibility: "readers",
      state: "", done: false, open: { label: say("research.openPublic"), href: researchHash("public") } },
  ];
  const first = steps.find((step) => !step.done && !step.optional && !(step.id === "source" && library?.failed) && !(step.id === "passage" && notebook?.failed));
  const primary = first?.id === "source" && !sources.length ? { label: say("research.addFirst"), href: `${researchHash("sources")}?new=1`, step: "source" }
    : first?.id === "passage" ? { label: say("notebook.newPassage"), href: `${researchHash("notebook")}?new=passage`, step: "passage" }
      : { ...steps.find((step) => step.id === "cite").open, step: "cite" };
  return { steps, primary, empty: !sources.length && !passages.length && !notes.length };
}

// ---- kept forms (decision 7): in memory only, never in storage

/** The key a kept form is kept under. */
export const keptKey = (screen, id = "") => `${screen}:${id || "new"}`;

/** What the banner on every research screen says about kept forms, or "" for none. */
export function keptWords(kept) {
  const list = Array.isArray(kept) ? kept : [];
  if (!list.length) return "";
  if (list.length > 1) return say("research.keptMany", { count: list.length });
  const one = list[0];
  const what = one.screen === "sources" ? say("research.whatSource") : one.what === "note" ? say("research.whatNote") : say("research.whatPassage");
  return say("research.kept", { what, name: String(one.name || "") });
}

// ---- what an answer means

/** Every code an answer may carry that is mapped below: G93 codes, then each store's diagnostics. */
export const RESEARCH_CODES = Object.freeze(new Set([
  // G93
  "changed", "conflict", "too-large", "bad-request", "unreadable", "invalid", "storage", "busy",
  // load failures, every store
  "invalid-json", "unsupported-version",
  // the source library (SourceDiagnosticCode)
  "missing-field", "invalid-field", "invalid-id", "duplicate-id", "unknown-kind", "kind-changed", "unknown-source",
  "unresolved-relationship", "invalid-relationship", "ambiguous-relationship", "relationship-cycle", "ambiguous-location",
  "invalid-identifier", "contributor-credit", "still-used", "conflicting-attribution",
  // the notebook (NoteDiagnosticCode)
  "unknown-passage", "unknown-locator-kind", "invalid-locator", "ambiguous-locator", "not-private", "reader-feedback",
  "source-changed", "still-linked", "unknown-entry",
  // citations (CitationDiagnosticCode)
  "too-many-citations", "malformed-citation", "invalid-key", "unknown-key", "too-many-locators",

  // the atlas, claims and alignments (AtlasDiagnosticCode), and choices for readers (curated Code)
  "endpoint-kind", "wrong-source-kind", "self-relationship", "duplicate-relationship", "cycle", "missing-evidence", "evidence-conflict", "invalid-visibility", "private-endpoint", "private-reference", "shadowed-field", "unknown-claim", "duplicate-link", "anchor-mismatch", "undisclosed-contradiction", "unknown-link", "stale-anchor", "ambiguous-anchor", "unknown-post", "invalid-date", "aspect-kind", "duplicate-dating", "unpublished-datings", "unknown-interpretation", "duplicate-member", "conflicting-member", "missing-counterpart", "missing-locator", "missing-original", "stale-locator", "stale-approval", "archived-member", "unknown-alignment", "too-many", "bad-id", "bad-target", "bad-revision", "field-not-allowed", "required-field-missing", "text-required", "text-not-allowed", "text-too-long", "unsafe-text", "attribution-required", "bad-provenance", "bad-requires", "bad-posts", "stale-selection", "target-not-published", "unknown-selection",
]));

const PLACE_WHAT = {
  sources: "research.whatLibrary", notebook: "research.whatNotebook", cite: "research.whatLibrary", draft: "research.whatLibrary",
  atlas: "research.whatAtlas", link: "research.whatAtlas", claims: "research.whatClaims", evidence: "research.whatClaims",
  compare: "research.whatAlignments", curate: "research.whatChoices",
};

function whatWords(place) {
  switch (PLACE_WHAT[place]) {
    case "research.whatNotebook": return say("research.whatNotebook");
    case "research.whatAtlas": return say("research.whatAtlas");
    case "research.whatClaims": return say("research.whatClaims");
    case "research.whatAlignments": return say("research.whatAlignments");
    case "research.whatChoices": return say("research.whatChoices");
    default: return say("research.whatLibrary");
  }
}

/** The R12 stores (atlas, its links, claims and their evidence, aligned passages, choices for readers). */
const R12_PLACES = new Set(["atlas", "link", "claims", "evidence", "compare", "curate"]);

function r12Problem(place, first, codes, out) {
  const field = String(first.field || "");
  const control = place === "atlas" ? atlasDiagnosticControl(field, "entry") : place === "link" ? atlasDiagnosticControl(field, "relationship")
    : place === "compare" ? alignmentDiagnosticControl(field) : place === "claims" ? claimDiagnosticControl(field, "claim")
      : place === "evidence" ? claimDiagnosticControl(field, "link") : "";
  const on = (id, at = control, vars = {}) => (at ? out(id, { field: at, vars }) : out(id, { banner: true, vars }));
  const show = place === "atlas" || place === "link" ? "approved" : control;
  switch (first.code) {
    case "endpoint-kind": return on("atlas.badEnds", control || "from");
    case "self-relationship": return on("atlas.self", control || "to");
    case "duplicate-relationship": return on("atlas.duplicate", control || "to");
    case "cycle": return on("atlas.cycle", control || "to");
    case "missing-evidence":
    case "evidence-conflict": return on("atlas.needEvidence", control || "evidence");
    case "private-endpoint":
    case "private-reference":
    case "invalid-visibility":
    case "unpublished-datings": return on("atlas.cantShow", show || "approved", { what: first.code === "private-reference" ? say("research.whatPassage") : say("atlas.whatEnd") });
    case "invalid-date": return on("atlas.badDate");
    case "aspect-kind": return on("atlas.badAspect");
    case "duplicate-dating": return on("atlas.sameDating");
    case "stale-anchor": return out("claims.lost", { banner: true });
    case "ambiguous-anchor": return out("claims.ambiguous", { banner: true });
    case "anchor-mismatch":
    case "unknown-post": return out("claims.saveFirst", { banner: true });
    case "undisclosed-contradiction": return on("claims.showBoth", "approved");
    case "missing-field":
    case "required-field-missing": return on("research.fill");
    case "duplicate-id": return place === "compare" ? on("compare.keyTaken", "id") : place === "atlas" ? on("atlas.keyTaken", "id") : out("research.failed", { banner: true });
    case "invalid-id":
    case "bad-id": return place === "atlas" || place === "compare" ? on("sources.badKey", "id") : out("research.failed", { banner: true });
    case "unknown-source": return on("notebook.badSource", control || "source");
    case "unknown-passage": return on("notebook.badPassage", control || "passage");
    case "unknown-locator-kind":
    case "invalid-locator":
    case "ambiguous-locator":
    case "missing-locator":
    case "stale-locator": return on("notebook.badPlace", control || "locators", { n: 1 });
    case "still-linked": return out("atlas.stillLinked", { banner: true });
    case "target-not-published": return out("public.whyNoPost", { banner: true });
    case "stale-selection": return out("public.whyStale", { banner: true });
    case "text-required": return on("curate.needText", "text");
    case "text-too-long":
    case "unsafe-text":
    case "text-not-allowed": return on("research.checkField", "text");
    case "attribution-required": return on("curate.needBy", "by");
    default: return control ? on("research.checkField") : out("research.failed", { banner: true });
  }
}

/**
 * What an answer means for her: `{ field, row, id, vars, banner, alert, conflict, signal, details }`.
 * `field` is the control it belongs to ("" for a banner); `id` and `vars` are her words, said with
 * `researchWords()`; `details` holds the server's code and sentence for {helper}. `place` is
 * `sources`, `notebook`, `cite`, `import`, `bring` or `draft`.
 */
export function researchProblem(error, place = "sources") {
  const status = Number(error?.status) || 0;
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
  const first = diagnostics[0] || {};
  const codes = diagnostics.map((item) => item.code).filter(Boolean);
  const code = String(data.code || first.code || "");
  const details = [code || (status ? String(status) : ""), first.field || "", data.error || error?.message || "", first.message && first.message !== data.error ? first.message : ""].filter(Boolean).join(": ");
  const out = (id, extra = {}) => ({ field: "", row: -1, id, vars: {}, banner: false, alert: false, conflict: false, signal: false, signedOut: false, details, ...extra });
  if (status === 401) return out("", { signedOut: true });
  if (status === 0) return out("research.noSignal", { signal: true });
  if (status >= 500 || code === "storage") return out("research.serverDown", { banner: true });
  if (status === 409 && code !== "busy") {
    if (place === "cite") return out("cite.libraryChanged", { field: "source" });
    if (place === "import") return out("sources.importChanged", { banner: true });
    if (place === "bring") return out("notebook.bringBlocked", { banner: true });
    return out(place === "notebook" ? "notebook.conflict" : place === "sources" ? "sources.conflict" : "research.conflict", { banner: true, alert: true, conflict: true, vars: { what: whatWords(place) } });
  }
  if (status === 413 || code === "too-large") return out(place === "import" ? "sources.importTooBig" : "research.tooLarge", { banner: true });
  if (status === 400 || status === 415 || code === "bad-request") return out("research.failed", { banner: true });
  // An import whose only problem is the file itself (`{"items": []}`: not a list of items) isn't CSL JSON.
  const fileOnly = place === "import" && diagnostics.length > 0 && diagnostics.every((d) => d.index == null && !d.sourceId && !d.field);
  if (code === "unreadable" || fileOnly || codes.some((c) => c === "invalid-json" || c === "unsupported-version")) {
    if (place === "import") return out("sources.importNotJson", { banner: true });
    if (place === "bring") return out("notebook.bringNotCopy", { banner: true });
    return out("research.unreadable", { banner: true, alert: true, vars: { what: whatWords(place) } });
  }
  if (place === "cite") {
    if (codes.includes("unknown-key") || codes.includes("invalid-key")) return out("cite.notInLibrary", { field: "source" });
    if (codes.includes("malformed-citation")) return out("cite.malformedNow", { field: "source" });
    if (codes.includes("too-many-locators")) return out("cite.tooManyPlaces", { field: "locators" });
    if (codes.some((c) => ["invalid-locator", "ambiguous-locator", "unknown-locator-kind"].includes(c))) return out("cite.badPlace", { field: "locators", row: 0, vars: { n: 1 } });
    if (codes.includes("too-many-citations")) return out("cite.tooMany", { banner: true });
    return out("research.failed", { banner: true });
  }
  if (R12_PLACES.has(place)) return r12Problem(place, first, codes, out);
  if (place === "import") return out("sources.importBlocked", { banner: true });
  if (place === "bring") return out("notebook.bringBlocked", { banner: true });
  const control = place === "notebook" ? notebookDiagnosticControl(first.field) : sourceDiagnosticControl(first.field);
  const row = diagnosticRow(first.field);
  const on = (field, id, vars = {}) => out(id, { field, row, vars });
  switch (first.code) {
    case "missing-field": return control === "title" ? on("title", "sources.needTitle") : on(control, "research.fill");
    case "invalid-id": return place === "sources" ? on("id", "sources.badKey") : out("research.failed", { banner: true });
    case "duplicate-id": return place === "sources" ? on("id", "sources.keyTaken") : out("research.failed", { banner: true });
    case "unknown-kind":
    case "kind-changed": return on("kind-field", "sources.badKind");
    case "unknown-source": return place === "notebook" ? on("source", "notebook.badSource") : on("of", "sources.badOf");
    case "unresolved-relationship":
    case "invalid-relationship":
    case "ambiguous-relationship": return on(control === "basedOn" ? "basedOn" : "of", "sources.badOf");
    case "relationship-cycle": return on("of", "sources.cycle");
    case "ambiguous-location": return on("locationVolume", "sources.needVolume");
    case "invalid-identifier": return on("identifiers", "sources.badId", { kind: "identifier" });
    case "conflicting-attribution": return on("creators", "sources.anonymousAndNamed");
    case "contributor-credit": return place === "notebook" ? out("notebook.notPrivate", { banner: true }) : on("creators", "sources.notCredit");
    case "still-used": return out("sources.stillUsed", { banner: true });
    case "unknown-passage": return on("passages", "notebook.badPassage");
    case "invalid-locator":
    case "unknown-locator-kind": return on("locators", "notebook.badPlace", { n: Math.max(1, row + 1) });
    case "ambiguous-locator": return on("locators", "notebook.ambiguousPlace");
    case "not-private":
    case "reader-feedback":
    case "source-changed": return out("notebook.notPrivate", { banner: true });
    case "still-linked": return out("notebook.stillLinked", { banner: true, vars: { count: Math.max(1, Number(first.count) || (String(first.message || "").match(/\d+/)?.[0] | 0) || 1) } });
    case "invalid-field": return control ? on(control, "research.checkField") : out("research.failed", { banner: true });
    default: return control ? on(control, "research.checkField") : out("research.failed", { banner: true });
  }
}

/** Her words for a problem from `researchProblem`. Every id is said by name, so the catalog test finds it. */
export function researchWords(problem) {
  const vars = problem?.vars || {};
  switch (problem?.id) {
    case "research.noSignal": return say("research.noSignal");
    case "research.serverDown": return say("research.serverDown");
    case "research.conflict": return say("research.conflict", vars);
    case "research.tooLarge": return say("research.tooLarge");
    case "research.failed": return `${say("research.failed")} ${say("common.tell")}`;
    case "research.unreadable": return `${say("research.unreadable", vars)} ${say("common.tell")}`;
    case "research.fill": return say("research.fill");
    case "atlas.badEnds": return say("atlas.badEnds");
    case "atlas.self": return say("atlas.self");
    case "atlas.duplicate": return say("atlas.duplicate");
    case "atlas.cycle": return say("atlas.cycle");
    case "atlas.needEvidence": return say("atlas.needEvidence");
    case "atlas.cantShow": return say("atlas.cantShow", vars);
    case "atlas.badDate": return say("atlas.badDate");
    case "atlas.badAspect": return say("atlas.badAspect");
    case "atlas.sameDating": return say("atlas.sameDating");
    case "atlas.keyTaken": return say("atlas.keyTaken");
    case "atlas.stillLinked": return say("atlas.stillLinked");
    case "claims.lost": return say("claims.lost");
    case "claims.ambiguous": return say("claims.ambiguous");
    case "claims.saveFirst": return say("claims.saveFirst");
    case "claims.showBoth": return say("claims.showBoth");
    case "compare.keyTaken": return say("compare.keyTaken");
    case "public.whyNoPost": return say("public.whyNoPost");
    case "public.whyStale": return say("public.whyStale");
    case "curate.needText": return say("curate.needText");
    case "curate.needBy": return say("curate.needBy");
    case "research.checkField": return say("research.checkField");
    case "sources.conflict": return say("sources.conflict");
    case "sources.needTitle": return say("sources.needTitle");
    case "sources.badKey": return say("sources.badKey");
    case "sources.keyTaken": return say("sources.keyTaken");
    case "sources.badKind": return say("sources.badKind");
    case "sources.badOf": return say("sources.badOf");
    case "sources.cycle": return say("sources.cycle");
    case "sources.needVolume": return say("sources.needVolume");
    case "sources.badId": return say("sources.badId", vars);
    case "sources.anonymousAndNamed": return say("sources.anonymousAndNamed");
    case "sources.notCredit": return say("sources.notCredit");
    case "sources.stillUsed": return say("sources.stillUsed");
    case "sources.importChanged": return say("sources.importChanged");
    case "sources.importTooBig": return say("sources.importTooBig");
    case "sources.importNotJson": return say("sources.importNotJson");
    case "sources.importBlocked": return say("sources.importBlocked");
    case "notebook.conflict": return say("notebook.conflict");
    case "notebook.badSource": return say("notebook.badSource");
    case "notebook.badPassage": return say("notebook.badPassage");
    case "notebook.badPlace": return say("notebook.badPlace", vars);
    case "notebook.ambiguousPlace": return say("notebook.ambiguousPlace");
    case "notebook.notPrivate": return `${say("notebook.notPrivate")} ${say("common.tell")}`;
    case "notebook.stillLinked": return say("notebook.stillLinked", vars);
    case "notebook.bringBlocked": return say("notebook.bringBlocked");
    case "notebook.bringNotCopy": return say("notebook.bringNotCopy");
    case "cite.libraryChanged": return say("cite.libraryChanged");
    case "cite.notInLibrary": return say("cite.notInLibrary");
    case "cite.malformedNow": return say("cite.malformedNow");
    case "cite.tooManyPlaces": return say("cite.tooManyPlaces");
    case "cite.badPlace": return say("cite.badPlace", vars);
    case "cite.tooMany": return `${say("cite.tooMany")} ${say("common.tell")}`;
    case "cite.waiting": return say("cite.waiting");
    case "cite.needSource": return say("cite.needSource");
    case "notebook.placeLimit": return say("notebook.placeLimit");
    case "notebook.badConcept": return say("notebook.badConcept");
    default: return problem?.id ? `${say("research.failed")} ${say("common.tell")}` : "";
  }
}

// Reading paths as rules: the editor's model (a file's JSON in, the same file out), the order of
// steps, the address suggested from a title, what a step may be related by, the problems found
// before a save is sent and the ones the server sent, and what the list says about a path. The
// server owns every rule; these only shape what it sent and refuse what is certain to be refused.
// DOM-free, tested. Lifted from the old Admin's reading-path helpers (the old Admin's admin.js, "Reading
// paths"); `readingPathOrder` is not lifted (the order is saved by saving the whole path).
// Studio R13; docs/specs/studio/r13/ux.md.
import { say } from "./words.js";

export const LIMITS = Object.freeze({ title: 120, summary: 600, text: 600, prerequisites: 400, steps: 100, address: 64 });
const ADDRESS = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The step a step follows: the nearest earlier step that is not optional (ADR 0210). */
export function followedIndex(steps, index) {
  for (let i = index - 1; i >= 0; i -= 1) if (!steps[i].optional) return i;
  return -1;
}

const blankTransition = () => ({ relationship: "", why: "" });
const isBlank = (value) => typeof value !== "string" || value.trim() === "";
const emptyToNothing = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/**
 * An editor draft from the file's JSON (as the server sends it). Every step carries a transition so
 * one that moves to the front keeps what was written in memory; the payload leaves out the first
 * step's. Fields the editor does not know travel inside the copies and go back untouched, so a save
 * keeps what a newer release wrote.
 */
export function pathDraft(path = null, slug = "") {
  const source = path && typeof path === "object" ? structuredClone(path) : {};
  delete source.format;
  delete source.version;
  const steps = (Array.isArray(source.steps) ? source.steps : []).map((step) => ({
    ...step,
    optional: step.optional === true,
    transition: step.transition ? { ...blankTransition(), ...step.transition } : blankTransition(),
  }));
  return {
    ...source,
    slug,
    title: typeof source.title === "string" ? source.title : "",
    status: source.status === "published" ? "published" : "draft",
    listed: source.listed !== false,
    steps,
  };
}

/** The JSON a save sends: the draft without its address, empty optional fields left out. */
export function pathPayload(draft) {
  const { slug: _slug, steps, ...rest } = draft;
  const out = { ...rest };
  if (emptyToNothing(out.summary) === undefined) delete out.summary;
  if (out.listed === true) delete out.listed;
  out.steps = steps.map((step, index) => {
    const { transition, ...own } = step;
    const next = { ...own };
    for (const key of ["rationale", "prerequisites", "difficulty"]) {
      if (emptyToNothing(next[key]) === undefined) delete next[key];
    }
    if (next.optional !== true) delete next.optional;
    if (index > 0) {
      const t = { ...transition };
      if (emptyToNothing(t.basis) === undefined || t.relationship !== "influenced") delete t.basis;
      next.transition = t;
    }
    return next;
  });
  return out;
}

/** Whether two drafts would save the same file. */
export const pathSame = (a, b) => JSON.stringify(pathPayload(a)) === JSON.stringify(pathPayload(b));

/** A stable step id for a target, unique in the draft: a lowercase hyphenated name of at most 64 characters. */
export function stepId(steps, kind, target) {
  const base = String(target).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56).replace(/-+$/g, "") || kind;
  const used = new Set(steps.map((step) => step.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** A new step for a published target, without a transition's words (she writes them). */
export function newStep(steps, kind, target) {
  return {
    id: stepId(steps, kind, target),
    target: kind === "atlas" ? { kind: "atlas", id: target } : { kind: "post", slug: target },
    optional: false,
    transition: blankTransition(),
  };
}

/** The key a step's target is known by, for "already on this path". */
export const targetKey = (step) => (step.target?.kind === "atlas" ? `atlas:${step.target.id}` : `post:${step.target?.slug}`);

/**
 * The address suggested from a title: lowercase words joined by hyphens, at most 64 characters, never
 * one already taken (`-2`, `-3`…). A title with no letters or numbers suggests "reading-path".
 */
export function suggestAddress(title, taken = []) {
  const used = new Set(taken);
  const base = String(title || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56).replace(/-+$/g, "") || "reading-path";
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The steps in a new order: the step at `from` moves to `to` (zero-based, clamped). Every step keeps its
 * own words, including a reason it cannot show at the front. Returns the new list and where it landed;
 * a move that changes nothing returns the same list.
 */
export function moveTo(steps, from, to) {
  if (!Number.isInteger(from) || from < 0 || from >= steps.length) return { steps, index: from };
  const target = Math.max(0, Math.min(steps.length - 1, Number.isInteger(to) ? to : from));
  if (target === from) return { steps, index: from };
  const next = steps.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return { steps: next, index: target };
}

/** The place a key asks for, or null: Alt+Shift+Up/Down/Home/End. */
export function moveKey(event, index, count) {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  switch (event.key) {
    case "ArrowUp": return Math.max(0, index - 1);
    case "ArrowDown": return Math.min(count - 1, index + 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** The moves a step's menu offers, by its place. */
export function moveChoices(index, count) {
  const out = [];
  if (index > 0) out.push({ value: "first", to: 0 }, { value: "up", to: index - 1 });
  if (index < count - 1) out.push({ value: "down", to: index + 1 }, { value: "last", to: count - 1 });
  return out;
}

/** A reason written for a step that is first now: kept in memory, not in the saved file. */
export function heldReasons(draft) {
  const first = draft.steps[0];
  if (!first) return [];
  const t = first.transition || {};
  return !isBlank(t.why) || t.relationship ? [first] : [];
}

/**
 * What a step may be related by: every kind but "influenced", which joins two atlas entries (the step and
 * the one it follows). `all` is the server's list of values.
 */
export function relationshipChoices(steps, index, all) {
  const followed = steps[followedIndex(steps, index)];
  const atlas = steps[index]?.target?.kind === "atlas" && followed?.target?.kind === "atlas";
  return all.filter((value) => atlas || value !== "influenced");
}

/** The atlas links that join the entry before and this one (G100), in the server's words. */
export function basisChoices(steps, index, links = []) {
  const followed = steps[followedIndex(steps, index)];
  const here = steps[index];
  if (here?.target?.kind !== "atlas" || followed?.target?.kind !== "atlas") return [];
  return links.filter((link) => link.from === followed.target.id && link.to === here.target.id);
}

/** How a step stands now (the server's step states), as a key and whether readers see it. */
export function stateKey(state) {
  if (!state) return { key: "unknown", published: null };
  switch (state.state) {
    case "published": return { key: "published", published: true };
    case "draft": return { key: "draft", published: false };
    case "scheduled": return { key: "scheduled", published: false };
    case "missing": return { key: "missing", published: false };
    default: return { key: "other", published: false };
  }
}

/** A step's own state from the server's list, found by step id. */
export const stateFor = (states, id) => (states || []).find((state) => state.id === id) || null;

/** What a step is called: its post's or entry's title when known, else what it points at. */
export function stepTitle(step, state, targets) {
  if (state?.title) return state.title;
  if (step.target?.kind === "atlas") return targets?.entries?.find((e) => e.id === step.target.id)?.label || step.target.id;
  return targets?.posts?.find((p) => p.slug === step.target?.slug)?.title || step.target?.slug || "";
}

// ---- problems ---------------------------------------------------------------------------------------

/**
 * Problems found without the server, so a save is not sent when it is certain to be refused. Each is
 * `{ step, field, code }` (`step` is an id or null). The server's own list is authoritative and replaces
 * this one on every preview and save.
 */
export function localProblems(draft, relationships = []) {
  const problems = [];
  const add = (step, field, code) => problems.push({ step, field, code });
  if (!String(draft.title || "").trim()) add(null, "title", "required");
  if (!ADDRESS.test(draft.slug || "") || draft.slug.length > LIMITS.address) add(null, "address", "bad-address");
  const known = new Set(relationships);
  const seen = new Set();
  draft.steps.forEach((step, index) => {
    const key = targetKey(step);
    if (seen.has(key)) add(step.id, "target", "repeat-target");
    seen.add(key);
    if (index === 0 && step.optional) add(step.id, "optional", "first-optional");
    if (index === 0) return;
    const t = step.transition || {};
    if (!t.relationship) add(step.id, "relationship", "needs-relationship");
    else if (known.size && !known.has(t.relationship)) add(step.id, "relationship", "needs-relationship");
    if (isBlank(t.why)) add(step.id, "why", "needs-reason");
    if (t.relationship === "influenced") {
      const followed = draft.steps[followedIndex(draft.steps, index)];
      if (step.target?.kind !== "atlas" || followed?.target?.kind !== "atlas") add(step.id, "relationship", "influence-needs-atlas");
      if (isBlank(t.basis)) add(step.id, "basis", "influence-needs-basis");
    }
  });
  return problems;
}

/**
 * What a refused or failed call means: `{ code, problems, conflict }`. `problems` is the server's list
 * as `{ step, field, code }` (today's shapes are read when a code is missing); `code` is the call's own
 * (`changed`, `exists`, `missing`, `invalid`…). The server's sentence is kept for details.
 */
export function pathProblem(error) {
  const data = error?.data || {};
  let code = typeof data.code === "string" ? data.code : "";
  if (!code) {
    if (data.conflict || error?.status === 409) code = data.exists ? "exists" : "changed";
    else if (data.exists) code = "exists";
    else if (data.missing || error?.status === 404) code = "missing";
    else if (Array.isArray(data.problems)) code = "invalid";
  }
  const problems = (Array.isArray(data.problems) ? data.problems : []).map((p) => ({
    step: typeof p.step === "string" ? p.step : null,
    field: typeof p.field === "string" ? p.field : "",
    code: typeof p.code === "string" ? p.code : "bad-value",
    sentence: typeof p.text === "string" ? p.text : p.message || "",
  }));
  return { code, problems, conflict: code === "changed", current: data.current || null, sentence: typeof data.error === "string" ? data.error : error?.message || "" };
}

/** One problem code in her words. Literal ids only: the words test reads them. */
export function problemWords(code, vars = {}) {
  switch (code) {
    case "required": return say("paths.pTitleRequired", vars);
    case "too-long": return say("paths.pTooLong", vars);
    case "bad-address": return say("paths.pAddress", vars);
    case "exists": return say("paths.pAddressTaken", vars);
    case "too-many": return say("paths.pTooMany", vars);
    case "nothing-to-follow": return vars.field === "steps" ? say("paths.pNeedTwo", vars) : say("paths.pNothingToFollow", vars);
    case "duplicate-id": return say("paths.pDuplicate", vars);
    case "unknown-reference": return say("paths.pUnknownTarget", vars);
    case "repeat-target": return say("paths.pRepeat", vars);
    case "first-optional": return say("paths.pFirstOptional", vars);
    case "first-has-reason": return say("paths.pFirstReason", vars);
    case "needs-relationship": return say("paths.pNeedsRelation", vars);
    case "needs-reason": return say("paths.pNeedsReason", vars);
    case "influence-needs-atlas": return say("paths.pInfluenceAtlas", vars);
    case "influence-needs-basis": return say("paths.pInfluenceBasis", vars);
    case "bad-basis": return say("paths.pBadBasis", vars);
    default: return say("paths.pBadValue", vars);
  }
}

/** A refused call's own code in her words (the call, not a field). */
export function errorWords(code, vars = {}) {
  switch (code) {
    case "changed": return say("paths.eChanged", vars);
    case "exists": return say("paths.pAddressTaken", vars);
    case "missing": return say("paths.eMissing", vars);
    case "too-large": return say("paths.eTooLarge", vars);
    case "storage": return say("paths.eStorage", vars);
    default: return say("paths.eGeneric", vars);
  }
}

/** The problem for a field of the path (a title, a summary, an address) as her words, or "". */
export function fieldProblem(problems, field) {
  const found = problems.find((p) => p.step === null && p.field === field);
  if (!found) return "";
  if (field === "title" && found.code === "too-long") return say("paths.pTitleLong");
  if (field === "summary" && found.code === "too-long") return say("paths.pSummaryLong");
  return problemWords(found.code, { field });
}

// ---- words by id ------------------------------------------------------------------------------------

/** A relationship's label (literal ids; a value this release doesn't know shows as it is written). */
export function relationshipWords(value) {
  switch (value) {
    case "next": return say("paths.relNext");
    case "background": return say("paths.relBackground");
    case "builds-on": return say("paths.relBuildsOn");
    case "contrasts-with": return say("paths.relContrastsWith");
    case "responds-to": return say("paths.relRespondsTo");
    case "applies": return say("paths.relApplies");
    case "influenced": return say("paths.relInfluenced");
    default: return String(value);
  }
}

export function difficultyWords(value) {
  switch (value) {
    case "introductory": return say("paths.diffIntroductory");
    case "intermediate": return say("paths.diffIntermediate");
    case "advanced": return say("paths.diffAdvanced");
    default: return say("paths.difficultyNone");
  }
}

/** How a step stands, said. */
export function stateWords(key) {
  switch (key) {
    case "published": return say("paths.statePublished");
    case "draft": return say("paths.stateDraft");
    case "scheduled": return say("paths.stateScheduled");
    case "missing": return say("paths.stateMissing");
    case "other": return say("paths.stateOther");
    default: return say("paths.stateUnknown");
  }
}

/** Why readers don't see a step or a path (the server's diagnostics by kind), said. */
export function diagnosticWords(kind) {
  switch (kind) {
    case "StepUnavailable": return say("paths.diagUnavailable");
    case "TransitionDropped": return say("paths.diagDropped");
    default: return say("paths.diagWithheld");
  }
}

/** The list's line for one path: "Published · 3 steps" and why readers can't see it yet. */
export function listLine(item) {
  if (!item.valid) return say("paths.rowCantRead");
  const status = item.status === "published" ? say("paths.rowPublished") : say("paths.rowDraft");
  const steps = item.steps === 1 ? say("paths.rowOneStep") : say("paths.rowSteps", { count: String(item.steps) });
  return `${status} · ${steps}`;
}

/** Whether readers can't see a published path yet (a step is not published). */
export const notShown = (item) => item.valid && item.status === "published" && item.shown === false;

/** The button that saves: Save draft, Publish or Update. */
export function saveWords(wasPublished, status) {
  if (wasPublished && status === "published") return say("paths.update");
  return status === "published" ? say("paths.publish") : say("paths.saveDraft");
}

/** What a save says afterwards, by what was asked and what the server answered. */
export function savedWords({ wasPublished, status, url, publish, shown }) {
  if (status !== "published") return wasPublished ? say("paths.wasDrafted") : say("paths.savedDraft");
  if (!shown) return say("paths.savedHidden");
  if (!publish) return say("paths.savedPublishedOff");
  if (wasPublished) return say("paths.savedUpdated");
  return url ? say("paths.savedPublished", { url }) : say("paths.savedNow");
}

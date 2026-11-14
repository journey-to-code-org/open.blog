// Moved from web/admin/trade-checklist.js (the old Admin's ten-minute checklist, ADR 0401, #529)
// for the old Admin's retirement: the pure half only, so Studio loads nothing from /admin/. Home
// shows it on a trade site until the owner hides it or every step is done; each step comes from
// `GET trade-checklist`, worked out from the files, so a step ticks only when the site really has
// it. Studio's words for the steps, where each opens, and the recipe notes' words are new in R1;
// docs/specs/studio/r1/ux.md.
import { legacyRoute } from "../router.js";
import { say } from "./words.js";

/** The words for each step the server names, in the server's order. An id this version does not know is skipped. */
export const STEP_TEXT = Object.freeze({
  business: { label: "Add your phone number or email", hint: "So customers can reach you.", action: "Open Business facts" },
  service: { label: "Publish your first service", hint: "Change an example service to your own, then Publish it.", action: "Open Services" },
  job: { label: "Publish your first job", hint: "Photos from the site and a few words about the work.", action: "Start a job" },
  review: { label: "Save your first review", hint: "Copy a real customer's review, or type it in.", action: "Open Reviews" },
  destination: { label: "Share a job where customers look", hint: "Google, Facebook or Nextdoor.", action: "Share your newest job", waiting: "Publish a job first." },
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SAFE_HREF = /^#\/[A-Za-z0-9%._~!*'()\/-]*$/;

/** The steps from a server answer, keeping only known ids, true booleans and safe in-Admin links. */
export function checklistSteps(data) {
  if (!isObject(data) || !Array.isArray(data.steps)) return [];
  return data.steps
    .filter((step) => isObject(step) && Object.hasOwn(STEP_TEXT, step.id))
    .map((step) => ({ id: step.id, done: step.done === true, href: typeof step.href === "string" && SAFE_HREF.test(step.href) ? step.href : null }));
}

/** Whether the list is shown: a trade site, a readable answer, not hidden, and something still to do. */
export function checklistVisible({ dismissed, data }) {
  if (dismissed === true || !isObject(data) || data.applies !== true) return false;
  const steps = checklistSteps(data);
  return steps.length > 0 && steps.some((step) => !step.done);
}

/** Whether every step is done (the list goes, and Home says so once). */
export function checklistDone(data) {
  const steps = checklistSteps(data);
  return isObject(data) && data.applies === true && steps.length > 0 && steps.every((step) => step.done);
}

/**
 * Where a step's button opens in Studio, or null when Studio can't do it yet. Since R4 the job
 * step's old Capture address opens New job.
 * The server's hrefs are old Admin addresses; sharing a job opens Share this job.
 */
export function stepHref(step) {
  if (!step?.href) return null;
  const share = /^#\/edit\/(.+)$/.exec(step.href);
  if (step.id === "destination" && share) return `#/sharing/job/${share[1]}`;
  const studio = legacyRoute(step.href) || step.href;
  return studio.startsWith("#/not-yet/") ? null : studio;
}

/** "3 of 5 done". */
export const progressWords = (steps) => `${steps.filter((step) => step.done).length} of ${steps.length} done`;

// ---- Recipe notes (G14) ---------------------------------------------------------------------

const NOUNS = { post: "post", page: "page", series: "collection" };
const SCREENS = { post: "write", page: "page", series: "collection" };

/** A course or cuisine name worth quoting to her: a string with a letter or digit, nothing hidden. */
function shownName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return name.length <= 80 && /[\p{L}\p{N}]/u.test(name) && !/[\p{Cc}\p{Cf}]/u.test(name) ? name : "";
}

/**
 * One recipe note from `GET recipe-notes` items in her words: { text, open?: { href, label },
 * help, details }. Never "Settings", "Slug", an address or a path: those, and the raw value, go in
 * `details` for the person who set up the site. A name that would look broken is not quoted. Null
 * for a note this version doesn't know.
 */
export function recipeNoteWords(note) {
  if (!isObject(note)) return null;
  const page = isObject(note.page) ? note.page : null;
  const noun = NOUNS[page?.kind] || "page";
  const title = String(page?.title || "");
  const open = page && page.path && !note.byAlias && SCREENS[page.kind]
    ? { href: `#/${SCREENS[page.kind]}/${encodeURIComponent(page.path)}`, label: `Open “${title}”` }
    : null;
  const help = page && note.byAlias ? say("checklist.freeSpot") : "";
  const facet = note.facet === "cuisine" ? "cuisine" : "course";
  const name = shownName(note.value);
  const details = [
    `code ${String(note.code)}`,
    typeof note.address === "string" ? `wanted ${note.address}` : null,
    typeof note.fallback === "string" ? `now at ${note.fallback}` : null,
    "value" in note ? `${facet} ${JSON.stringify(note.value ?? null)}` : null,
    page?.path ? `page ${page.path}` : null,
  ].filter(Boolean);
  const said = (text, link = open, extra = help) => ({ text, open: link, help: extra, details });
  if (note.code === "address-taken") {
    return said(`Your recipe list has moved to a new spot on your blog, because your ${noun} “${title}” uses its usual one. Links to it still work.`);
  }
  if (note.code === "no-address") {
    return said("There's no list of all your recipes, because two pages are using its spot on your blog.");
  }
  if (note.code === "filter-taken") {
    return said(name
      ? `Your ${noun} “${title}” is using the spot for ${name} recipes, so readers can't browse by ${name}.`
      : `Your ${noun} “${title}” is using the spot for one of your ${facet === "cuisine" ? "cuisines" : "courses"}, so readers can't browse by it.`);
  }
  if (note.code === "wordless") {
    const example = facet === "cuisine" ? "Italian" : "Dessert";
    return said(`Readers can't browse by a ${facet} with no name. Give it a word, like ${example}.`, null, "");
  }
  return null;
}

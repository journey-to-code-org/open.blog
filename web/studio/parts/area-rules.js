// Studio's feature areas (ONB1, docs/specs/studio/onb1/): one catalog of what Studio can show, the
// blog kinds that turn areas on, which area every screen belongs to, and what this login sees.
// Pure: no page, no network, no storage. `crates/openblog-cli/src/admin_preferences.rs` keeps the
// same ids (AREA_IDS, KIND_IDS), and a test compares the two.
//
// A new screen picks its area here (`SCREEN_AREAS`), or is essential: the test fails for a screen
// that isn't listed (ADR 0416).
import { say } from "./words.js";

/** The areas a login can hide, in the order What you use lists them. Essentials aren't here. */
export const AREA_IDS = Object.freeze(["pages", "collections", "recipes", "trade", "seasonal", "sharing", "readers", "research", "teaching", "code", "together"]);

// Each area's name and one line, in her words (literal ids: every one is checked to exist).
const NAMES = {
  pages: () => [say("area.pages"), say("area.pagesAbout")],
  collections: () => [say("area.collections"), say("area.collectionsAbout")],
  recipes: () => [say("area.recipes"), say("area.recipesAbout")],
  trade: () => [say("area.trade"), say("area.tradeAbout")],
  seasonal: () => [say("area.seasonal"), say("area.seasonalAbout")],
  sharing: () => [say("area.sharing"), say("area.sharingAbout")],
  readers: () => [say("area.readers"), say("area.readersAbout")],
  research: () => [say("area.research"), say("area.researchAbout")],
  teaching: () => [say("area.teaching"), say("area.teachingAbout")],
  code: () => [say("area.code"), say("area.codeAbout")],
  together: () => [say("area.together"), say("area.togetherAbout")],
};
/** An area's name and its one line, in her words. */
export const areaName = (id) => (NAMES[id] ? NAMES[id]()[0] : String(id));
export const areaAbout = (id) => (NAMES[id] ? NAMES[id]()[1] : "");

/**
 * The kinds of blog (the first question, and `openblog init --kind`): the areas each turns on,
 * and the writing sets whose prompts suit it (Stories always comes too, ADR 0419).
 */
export const KINDS = Object.freeze({
  technical: { areas: ["code", "pages", "collections"], packs: ["teaching", "expertise", "opinions", "craft"] },
  recipes: { areas: ["recipes", "collections"], packs: ["stories", "people", "reviews"] },
  trade: { areas: ["trade", "pages"], packs: ["expertise", "stories", "people", "trades"] },
  teaching: { areas: ["teaching", "pages", "collections"], packs: ["teaching", "stories", "craft"] },
  research: { areas: ["research", "pages"], packs: ["expertise", "opinions", "stories"] },
  podcast: { areas: ["collections"], packs: ["stories", "opinions", "humor"] },
  docs: { areas: ["pages", "code"], packs: ["teaching", "expertise", "craft"] },
  personal: { areas: ["collections"], packs: ["stories", "people", "humor"] },
});
export const KIND_IDS = Object.freeze(Object.keys(KINDS));
/** The areas a kind can turn on (and so, by naming a kind, the ones it can tuck away). */
export const KIND_AREAS = Object.freeze(["recipes", "trade", "research", "teaching", "code", "pages", "collections"]);
/** The set whose prompts are true stories from her life. */
export const STORY_PACK = "stories";

/** The writing sets to draw from for a kind: its own, and Stories always. Unknown → null (any set). */
export function kindPacks(kind) {
  const known = KINDS[kind];
  if (!known) return null;
  return known.packs.includes(STORY_PACK) ? [...known.packs] : [...known.packs, STORY_PACK];
}

/**
 * Every screen's area (the `name` in screens/index.js). `null` is essential: Home, Posts, Write and
 * the rest are always there.
 */
export const SCREEN_AREAS = Object.freeze({
  home: null, posts: null, write: null, pictures: null, look: null, "front-page": null, people: null, notifications: null,
  helper: null, voice: null, stories: null, start: null, welcome: null, "what-you-use": null,
  pages: "pages", page: "pages",
  collections: "collections", collection: "collections",
  "new-job": "trade", services: "trade", service: "trade", reviews: "trade", review: "trade", business: "trade", quotes: "trade", reminders: "trade",
  decorations: "seasonal", cards: "seasonal", gifts: "seasonal",
  sharing: "sharing",
  readers: "readers",
  research: "research",
  paths: "teaching", path: "teaching",
  together: "together",
});

/** The area of a route (`{ name, arg }`), or null when it is essential. Share this job is the business's. */
export function areaOfRoute(route = {}) {
  const name = route.name || "home";
  if (name === "sharing" && String(route.arg || "").startsWith("job/")) return "trade";
  return SCREEN_AREAS[name] ?? null;
}

/** The area of an address (`#/write/new/recipe`, `#/decorations?do=putup`), or null. */
export function areaOfHref(href = "") {
  const raw = String(href || "").replace(/^#\/?/, "");
  const [path] = raw.split("?");
  if (path === "write/new/recipe") return "recipes";
  if (path === "write/new/job") return "trade";
  const [name, ...rest] = path.split("/");
  return areaOfRoute({ name: name || "home", arg: rest.join("/") });
}

/**
 * The areas this login sees: every area but the hidden ones, unless Show everything is on; the
 * areas the site uses (and Writing together, while taking part in one) are always seen. `areas`
 * is `meta.areas`; unknown ids are ignored.
 */
export function visibleAreas(areas = {}, { together = false } = {}) {
  const inUse = new Set((Array.isArray(areas?.inUse) ? areas.inUse : []).filter((id) => AREA_IDS.includes(id)));
  if (together) inUse.add("together");
  const hidden = new Set(areas?.showEverything === true ? [] : (Array.isArray(areas?.areas?.hidden) ? areas.areas.hidden : []).filter((id) => AREA_IDS.includes(id)));
  return new Set(AREA_IDS.filter((id) => !hidden.has(id) || inUse.has(id)));
}

/** Whether the site (or this login, for Writing together) uses an area, so it can't be hidden. */
export function areaInUse(meta, id) {
  if (id === "together" && Number(meta?.together?.takingPart) > 0) return true;
  return Array.isArray(meta?.areas?.inUse) && meta.areas.inUse.includes(id);
}

/** Whether `id` shows for this login. An essential (null) always does. */
export function areaVisible(meta, id) {
  if (!id) return true;
  return visibleAreas(meta?.areas, { together: Number(meta?.together?.takingPart) > 0 }).has(id);
}

/** The areas this login has hidden and the site doesn't use: what Find offers to turn on. */
export function hiddenAreas(meta) {
  const visible = visibleAreas(meta?.areas, { together: Number(meta?.together?.takingPart) > 0 });
  return AREA_IDS.filter((id) => !visible.has(id));
}

/** The `hidden` list after turning `id` on or off (catalog order, once each). */
export function hiddenAfter(hidden = [], id, on) {
  const now = new Set((Array.isArray(hidden) ? hidden : []).filter((x) => AREA_IDS.includes(x)));
  if (on) now.delete(id); else now.add(id);
  return AREA_IDS.filter((x) => now.has(x));
}

/** Whether a Find item (`{ href }`) shows: its address's area is seen. Items with no address do. */
export const paletteItemVisible = (meta, item) => !item?.href || areaVisible(meta, areaOfHref(item.href));

// Studio ONB1: the feature-area catalog (docs/specs/studio/onb1/). Every screen has an area, the
// server keeps the same ids, and what a login sees follows its hidden areas, Show everything, and
// what the site already uses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AREA_IDS, KINDS, KIND_IDS, SCREEN_AREAS, STORY_PACK, areaAbout, areaInUse, areaName, areaOfHref, areaOfRoute,
  areaVisible, hiddenAfter, hiddenAreas, kindPacks, paletteItemVisible, visibleAreas,
} from "../../web/studio/parts/area-rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("every screen in screens/index.js has an area (or is essential)", () => {
  const index = read("web/studio/screens/index.js");
  const names = [...index.matchAll(/\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length > 30, "found the screens");
  const missing = names.filter((name) => !(name in SCREEN_AREAS));
  assert.deepEqual(missing, [], "a new screen picks its area in SCREEN_AREAS");
  for (const area of Object.values(SCREEN_AREAS)) assert.ok(area === null || AREA_IDS.includes(area), String(area));
});

test("the server knows the same areas, kinds and questions", () => {
  const rust = read("crates/openblog-cli/src/admin_preferences.rs");
  const list = (name) => {
    const block = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`).exec(rust);
    return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(list("AREA_IDS"), [...AREA_IDS]);
  assert.deepEqual(list("KIND_IDS"), [...KIND_IDS]);
});

test("every area and kind has its words", () => {
  for (const id of AREA_IDS) {
    assert.ok(areaName(id) && areaName(id) !== id, id);
    assert.ok(areaAbout(id), id);
  }
  for (const [kind, spec] of Object.entries(KINDS)) for (const area of spec.areas) assert.ok(AREA_IDS.includes(area), `${kind}: ${area}`);
});

test("visibleAreas: hidden, Show everything, in use, unknown ids", () => {
  const all = new Set(AREA_IDS);
  const cases = [
    { name: "nothing saved", areas: {}, expect: all },
    { name: "a new login", areas: { onboarding: { state: "pending" }, areas: { hidden: [] } }, expect: all },
    { name: "hidden", areas: { areas: { hidden: ["seasonal", "recipes"] } }, gone: ["seasonal", "recipes"] },
    { name: "Show everything", areas: { showEverything: true, areas: { hidden: ["seasonal", "recipes"] } }, expect: all },
    { name: "in use wins", areas: { inUse: ["recipes"], areas: { hidden: ["seasonal", "recipes"] } }, gone: ["seasonal"] },
    { name: "unknown ids are ignored", areas: { inUse: ["spaceships"], areas: { hidden: ["spaceships", "code"] } }, gone: ["code"] },
    { name: "not a list", areas: { areas: { hidden: "seasonal" } }, expect: all },
  ];
  for (const c of cases) {
    const seen = visibleAreas(c.areas);
    const expect = c.expect || new Set(AREA_IDS.filter((id) => !c.gone.includes(id)));
    assert.deepEqual([...seen].sort(), [...expect].sort(), c.name);
  }
  assert.ok(visibleAreas({ areas: { hidden: ["together"] } }, { together: true }).has("together"), "taking part in one keeps Writing together");
});

test("areaVisible and hiddenAreas read meta", () => {
  const meta = { areas: { inUse: ["pages"], areas: { hidden: ["seasonal", "pages", "trade"] } }, together: { takingPart: 0 } };
  assert.equal(areaVisible(meta, null), true, "essentials always");
  assert.equal(areaVisible(meta, "seasonal"), false);
  assert.equal(areaVisible(meta, "pages"), true);
  assert.deepEqual(hiddenAreas(meta), ["trade", "seasonal"]);
  assert.equal(areaInUse(meta, "pages"), true);
  assert.equal(areaInUse({ together: { takingPart: 2 } }, "together"), true);
  assert.equal(areaVisible({}, "seasonal"), true, "no areas yet: everything shows");
});

test("routes and addresses map to their area", () => {
  assert.equal(areaOfRoute({ name: "decorations" }), "seasonal");
  assert.equal(areaOfRoute({ name: "cards", arg: "new" }), "seasonal");
  assert.equal(areaOfRoute({ name: "sharing", arg: "job/posts%2Fx.md" }), "trade");
  assert.equal(areaOfRoute({ name: "sharing", arg: "accounts" }), "sharing");
  assert.equal(areaOfRoute({ name: "write", arg: "posts/x.md" }), null);
  assert.equal(areaOfRoute({ name: "no-such-screen" }), null);
  assert.equal(areaOfHref("#/write/new/recipe"), "recipes");
  assert.equal(areaOfHref("#/write/new/job"), "trade");
  assert.equal(areaOfHref("#/decorations?do=putup"), "seasonal");
  assert.equal(areaOfHref("#/research/sources"), "research");
  assert.equal(areaOfHref("#/"), null);
  const meta = { areas: { areas: { hidden: ["recipes"] } } };
  assert.equal(paletteItemVisible(meta, { href: "#/write/new/recipe" }), false);
  assert.equal(paletteItemVisible(meta, { href: "#/write/new/story" }), true);
  assert.equal(paletteItemVisible(meta, { id: "signout" }), true);
});

test("turning an area on or off keeps the catalog's order", () => {
  assert.deepEqual(hiddenAfter(["code", "seasonal"], "recipes", false), ["recipes", "seasonal", "code"]);
  assert.deepEqual(hiddenAfter(["code", "seasonal"], "seasonal", true), ["code"]);
  assert.deepEqual(hiddenAfter(undefined, "seasonal", false), ["seasonal"]);
  assert.deepEqual(hiddenAfter(["x"], "code", true), []);
});

test("a kind's writing sets always include a true story", () => {
  assert.deepEqual(kindPacks("technical"), ["teaching", "expertise", "opinions", "craft", STORY_PACK]);
  assert.deepEqual(kindPacks("recipes"), ["stories", "people", "reviews"]);
  for (const kind of KIND_IDS) assert.ok(kindPacks(kind).includes(STORY_PACK), kind);
  assert.equal(kindPacks("astrology"), null);
  const catalog = read("crates/openblog-cli/src/voice_prompts/catalog.md");
  const sets = [...catalog.matchAll(/^## ([a-z-]+):/gm)].map((m) => m[1]);
  for (const kind of KIND_IDS) for (const pack of kindPacks(kind)) assert.ok(sets.includes(pack), `${kind}: ${pack} is a bundled set`);
});

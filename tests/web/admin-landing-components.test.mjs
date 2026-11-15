// Theme components in the Landing page builder (ADR 0408): the picker lists what the theme offers,
// a placed component gets a form built from its declared settings, and a component the theme no
// longer offers says so instead of pretending to be editable.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addSection,
  componentEntries,
  componentFields,
  pagePayload,
  sectionInfo,
  sectionProblems,
  sectionSummary,
  sectionTitle,
  setComponents,
} from "../../web/admin/landing.js";

const COUNTDOWN = {
  tag: "holiday-countdown",
  label: "Countdown sign",
  description: "Days until the holiday.",
  props: [
    { name: "holiday", type: "choice", label: "Which holiday", default: "thanksgiving", choices: [{ value: "thanksgiving", label: "Thanksgiving" }, { value: "christmas", label: "Christmas" }] },
    { name: "note", type: "text", label: "A line under it", maxLength: 40 },
    { name: "size", type: "number", label: "Size", min: 1, max: 3 },
    { name: "sparkle", type: "toggle", label: "Sparkle" },
  ],
};

test("the picker lists the theme's components after the built-in sections", () => {
  setComponents([COUNTDOWN, { nope: true }]);
  const entries = componentEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "component");
  assert.equal(entries[0].tag, "holiday-countdown");
  assert.equal(entries[0].label, "Countdown sign");
});

test("adding a component starts it with its defaults and names it plainly", () => {
  setComponents([COUNTDOWN]);
  const { sections, added } = addSection([], "component", 0, "holiday-countdown");
  assert.deepEqual(added, { id: "holiday-countdown", type: "component", tag: "holiday-countdown", props: { holiday: "thanksgiving" } });
  assert.equal(sectionTitle(added), "Countdown sign");
  assert.equal(sectionSummary(added), "Thanksgiving");
  assert.deepEqual(sectionProblems(added), []);
  const again = addSection(sections, "component", 1, "holiday-countdown").added;
  assert.equal(again.id, "holiday-countdown-2");
  assert.deepEqual(pagePayload({ sections: [added] }).sections[0], added);
});

test("each declared setting becomes a field of the matching kind", () => {
  const fields = componentFields(COUNTDOWN);
  assert.deepEqual(fields.map((f) => [f.name, f.kind]), [["holiday", "select"], ["note", "text"], ["size", "number"], ["sparkle", "toggle"]]);
  assert.deepEqual(fields[0].options, [["thanksgiving", "Thanksgiving"], ["christmas", "Christmas"]]);
  assert.equal(fields[1].max, 40);
  assert.deepEqual([fields[2].min, fields[2].max], [1, 3]);
  const info = sectionInfo("component", { tag: "holiday-countdown" });
  assert.deepEqual(info.fields.map((f) => f.name), ["heading", "props"]);
});

test("settings are held to their declaration before a save", () => {
  setComponents([COUNTDOWN]);
  const section = { id: "sign", type: "component", tag: "holiday-countdown", props: { holiday: "christmas", note: "x".repeat(41), size: 5 } };
  const paths = sectionProblems(section).map((p) => p.path);
  assert.deepEqual(paths.sort(), ["props.note", "props.size"]);
});

test("a component the theme no longer offers says so", () => {
  setComponents([]);
  const section = { id: "sign", type: "component", tag: "holiday-countdown", props: {} };
  assert.match(sectionProblems(section)[0].message, /does not offer this component/);
  assert.match(sectionSummary(section), /Not in your theme/);
  assert.equal(componentEntries().length, 0);
});

test("a date setting is a date picker that takes only a real day", () => {
  const withDay = { ...COUNTDOWN, props: [...COUNTDOWN.props, { name: "day", type: "date", label: "The day" }] };
  setComponents([withDay]);
  const field = componentFields(withDay).at(-1);
  assert.deepEqual([field.name, field.kind, field.required], ["day", "date", false]);
  const sign = (day) => ({ id: "sign", type: "component", tag: "holiday-countdown", props: { holiday: "christmas", day } });
  assert.deepEqual(sectionProblems(sign("1986-06-14")), []);
  assert.deepEqual(sectionProblems(sign("")), [], "an optional day can be left empty");
  for (const bad of ["2026-02-30", "June 14", "2026-6-14"]) {
    assert.match(sectionProblems(sign(bad))[0].message, /must be a day/, bad);
  }
  assert.equal(sectionSummary(sign("1986-06-14")), "Christmas, June 14, 1986");
});

test("a post setting is a list of the site's posts, and may be left empty", () => {
  const withRecipe = { ...COUNTDOWN, props: [...COUNTDOWN.props, { name: "recipe", type: "post", label: "Their favorite" }] };
  setComponents([withRecipe]);
  const field = componentFields(withRecipe).at(-1);
  assert.deepEqual([field.name, field.kind, field.optional], ["recipe", "post", true]);
  const sign = (recipe) => ({ id: "sign", type: "component", tag: "holiday-countdown", props: { holiday: "christmas", recipe } });
  assert.deepEqual(sectionProblems(sign("")), []);
  assert.deepEqual(sectionProblems(sign("meatloaf")), []);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  formFromSeasons,
  nextWindow,
  parseMonthDay,
  sameSeasons,
  sayMonthDay,
  seasonsErrorText,
  seasonsFromForm,
  todaySentence,
  validateForm,
} from "../../web/admin/seasons.js";

const stored = {
  theme: "grammis",
  seasons: {
    enabled: true,
    windows: [
      { theme: "thanksgiving", start: "10-15", end: "11-30" },
      { theme: "christmas", start: "12-01", end: "01-06" },
    ],
  },
  wearing: "thanksgiving",
  next: { day: "2026-12-01", theme: "christmas" },
};
const labels = { grammis: "No decorations", thanksgiving: "Thanksgiving", christmas: "Christmas" };
const labelOf = (name) => labels[name] ?? name;

test("days of the year are read and said in words", () => {
  assert.deepEqual(parseMonthDay("12-01"), { month: 12, day: 1 });
  assert.deepEqual(parseMonthDay("02-29"), { month: 2, day: 29 });
  assert.equal(parseMonthDay("02-30"), null);
  assert.equal(parseMonthDay("13-01"), null);
  assert.equal(parseMonthDay("12-1"), null);
  assert.equal(sayMonthDay({ month: 10, day: 15 }), "October 15");
});

test("the stored seasons round-trip through the form unchanged", () => {
  const form = formFromSeasons(stored);
  assert.equal(form.theme, "grammis");
  assert.equal(form.enabled, true);
  assert.deepEqual(seasonsFromForm(form), {
    theme: "grammis",
    seasons: { version: 1, enabled: true, windows: stored.seasons.windows },
  });
  assert.ok(sameSeasons(form, formFromSeasons(stored)));
  form.windows[1].end = { month: 1, day: 15 };
  assert.ok(!sameSeasons(form, formFromSeasons(stored)));
});

test("a site with no seasons starts switched off with no windows", () => {
  const form = formFromSeasons({ theme: "base" });
  assert.equal(form.enabled, false);
  assert.deepEqual(form.windows, []);
  assert.deepEqual(validateForm(form), []);
});

test("problems are named where they are shown", () => {
  const form = formFromSeasons(stored);
  form.theme = "";
  form.windows[0].theme = "";
  form.windows[1].start = { month: 4, day: 31 };
  const problems = validateForm(form);
  assert.deepEqual(problems.map((p) => [p.field, p.index]), [["theme", undefined], ["window", 0], ["window", 1]]);
  assert.match(problems[2].message, /starts is not a day/);
  const empty = formFromSeasons({ theme: "base", seasons: { enabled: true, windows: [] } });
  assert.match(validateForm(empty)[0].message, /Add a season/);
});

test("the top of the screen says what visitors see today and what comes next", () => {
  assert.equal(todaySentence(stored, labelOf), "Today your site is decorated for Thanksgiving. On December 1 it changes to Christmas.");
  assert.equal(todaySentence({ wearing: "grammis", next: null }, labelOf), "Today your site is decorated for No decorations.");
});

test("a new season starts the day after the last one ends and suggests an unused theme", () => {
  const form = formFromSeasons(stored);
  const themes = [{ name: "grammis" }, { name: "thanksgiving" }, { name: "christmas" }, { name: "easter" }];
  assert.deepEqual(nextWindow(form, themes), { theme: "easter", start: { month: 1, day: 7 }, end: { month: 1, day: 31 } });
  const december = { ...formFromSeasons(stored), windows: [{ theme: "christmas", start: { month: 12, day: 1 }, end: { month: 12, day: 31 } }] };
  assert.deepEqual(nextWindow(december, themes).start, { month: 1, day: 1 });
});

test("errors are said in words", () => {
  assert.match(seasonsErrorText({ status: 409 }), /another window/);
  assert.match(seasonsErrorText({ status: 422, data: { error: "There is no theme called `easter`" } }), /easter/);
  assert.match(seasonsErrorText({}), /connection/);
});

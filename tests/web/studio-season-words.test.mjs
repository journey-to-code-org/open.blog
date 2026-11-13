import { test } from "node:test";
import assert from "node:assert/strict";
import { dayAfter, sayLongDate, todaySentence } from "../../web/studio/parts/season-words.js";

const LABELS = { thanksgiving: "Thanksgiving", christmas: "Christmas", grammis: "No decorations (just the house)", january: "January: snowy morning" };
const label = (name) => LABELS[name] || name;
const now = new Date("2026-11-13T15:00:00Z");
const calendar = { version: 1, enabled: true, windows: [{ theme: "christmas", start: "12-01", end: "01-06" }, { theme: "thanksgiving", start: "11-01", end: "11-30" }] };

test("long dates in her words", () => {
  assert.equal(sayLongDate("2026-12-01", { now }), "Tuesday, December 1");
  assert.equal(sayLongDate("2027-01-06", { now }), "Wednesday, January 6, 2027");
  assert.equal(dayAfter("2026-12-31"), "2027-01-01");
  assert.equal(dayAfter("2028-02-28"), "2028-02-29");
});

test("today's sentence: a season, put up early, the everyday look, and the calendar off", () => {
  assert.deepEqual(todaySentence({ theme: "grammis", seasons: calendar, wearing: "thanksgiving", next: { day: "2026-12-01", theme: "christmas" } }, label, { today: "2026-11-13", now }),
    ["Your house is decorated for Thanksgiving.", "On Tuesday, December 1 it changes to Christmas."]);
  assert.deepEqual(todaySentence({ theme: "grammis", seasons: { ...calendar, upNow: { theme: "christmas", until: "2027-01-06" } }, wearing: "christmas", next: { day: "2027-01-07", theme: "january" } }, label, { today: "2026-11-13", now }),
    ["Your house is decorated for Christmas, put up early. It stays up through Wednesday, January 6, 2027.", "On Thursday, January 7, 2027 it changes to January: snowy morning."]);
  assert.deepEqual(todaySentence({ theme: "grammis", seasons: { ...calendar, windows: [] }, wearing: "grammis", next: null }, label, { today: "2026-11-13", now }),
    ["Your house is wearing its everyday look: No decorations (just the house)."]);
  assert.deepEqual(todaySentence({ theme: "grammis", seasons: { ...calendar, enabled: false }, wearing: "grammis", next: null }, label, { today: "2026-11-13", now }),
    ["Your house wears No decorations (just the house) every day. The calendar is off."]);
});

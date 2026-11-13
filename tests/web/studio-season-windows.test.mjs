import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WINDOWS,
  daysIn,
  monthDay,
  nextChange,
  problems,
  sayMonthDay,
  sayRange,
  switchTimeWords,
  toStored,
  upNowUntil,
  wearingOn,
  windowHolds,
} from "../../web/studio/parts/season-windows.js";

// Grammi's real calendar, as stored under `seasons` in grammis-house/openblog.json.
const GRAMMI = Object.freeze({
  version: 1,
  enabled: true,
  windows: [
    { theme: "christmas", start: "12-01", end: "01-06" },
    { theme: "january", start: "01-07", end: "01-31" },
    { theme: "february", start: "02-01", end: "02-29" },
    { theme: "march", start: "03-01", end: "03-31" },
    { theme: "april", start: "04-01", end: "04-30" },
    { theme: "may", start: "05-01", end: "05-31" },
    { theme: "june", start: "06-01", end: "06-30" },
    { theme: "july", start: "07-01", end: "07-31" },
    { theme: "august", start: "08-01", end: "08-31" },
    { theme: "september", start: "09-01", end: "09-30" },
    { theme: "october", start: "10-01", end: "10-31" },
    { theme: "thanksgiving", start: "11-01", end: "11-30" },
  ],
});
// Her `theme`, worn between seasons.
const HOUSE = "grammis";
const THEMES = [
  { name: "grammis", label: "Grammi's" },
  { name: "christmas", label: "Christmas" },
  { name: "thanksgiving", label: "Thanksgiving" },
  { name: "new-year", label: "New Year" },
  { name: "birthday", label: "Birthday" },
  ...["january", "february", "march", "april", "may", "june", "july", "august", "september", "october"]
    .map((name) => ({ name, label: name[0].toUpperCase() + name.slice(1) })),
];

const wornOn = (seasons, date) => wearingOn(seasons, HOUSE, date.slice(5), { date });
const dayAfter = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

test("month and day words", () => {
  assert.equal(sayMonthDay("12-01"), "December 1");
  assert.equal(sayMonthDay("02-29"), "February 29");
  assert.equal(sayMonthDay("02-30"), "");
  assert.equal(sayMonthDay("1-5"), "");
  assert.equal(sayRange({ start: "12-01", end: "01-06" }), "December 1 to January 6");
  assert.equal(daysIn(2), 29);
  assert.equal(daysIn(4), 30);
  assert.equal(daysIn(12), 31);
  assert.equal(daysIn(13), 0);
  assert.equal(monthDay(1, 6), "01-06");
  assert.equal(monthDay(12, 31), "12-31");
});

test("a window holds both ends and may cross New Year", () => {
  const christmas = GRAMMI.windows[0];
  assert.ok(windowHolds(christmas, "12-01"));
  assert.ok(windowHolds(christmas, "12-31"));
  assert.ok(windowHolds(christmas, "01-01"));
  assert.ok(windowHolds(christmas, "01-06"));
  assert.ok(!windowHolds(christmas, "01-07"));
  assert.ok(!windowHolds(christmas, "11-30"));
  assert.ok(windowHolds({ start: "07-04", end: "07-04" }, "07-04"));
  assert.ok(!windowHolds({ start: "02-30", end: "03-05" }, "03-01"), "a window with an impossible day holds nothing");
});

test("Grammi's calendar at every month boundary, 2026 into 2028", () => {
  // The last day of each month and the first day of the next, through two New Years and a leap day.
  const expected = {
    "01": "january", "02": "february", "03": "march", "04": "april", "05": "may", "06": "june",
    "07": "july", "08": "august", "09": "september", "10": "october", "11": "thanksgiving", "12": "christmas",
  };
  let checked = 0;
  for (let year = 2026; year <= 2028; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const first = `${year}-${monthDay(month, 1)}`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const last = `${year}-${monthDay(month, lastDay)}`;
      const mm = monthDay(month, 1).slice(0, 2);
      // January 1-6 is still Christmas; Christmas runs on through December 31.
      const atFirst = month === 1 ? "christmas" : expected[mm];
      assert.equal(wornOn(GRAMMI, first).theme, atFirst, first);
      assert.equal(wornOn(GRAMMI, last).theme, expected[mm], last);
      // The day after the last is the next month's look, and nextChange from the last day says so.
      if (month !== 12) {
        const change = nextChange(GRAMMI, HOUSE, last);
        assert.deepEqual(change, { day: dayAfter(last), theme: expected[monthDay(month + 1, 1).slice(0, 2)] }, last);
      }
      checked += 1;
    }
  }
  assert.equal(checked, 36);
  // Index is the place in her list.
  assert.deepEqual(wornOn(GRAMMI, "2026-11-13"), { theme: "thanksgiving", index: 11 });
  assert.deepEqual(wornOn(GRAMMI, "2026-12-25"), { theme: "christmas", index: 0 });
});

test("November 30 against December 1 (UTC days)", () => {
  assert.equal(wornOn(GRAMMI, "2026-11-30").theme, "thanksgiving");
  assert.equal(wornOn(GRAMMI, "2026-12-01").theme, "christmas");
  // Today, November 13: the sentence's next change.
  assert.deepEqual(nextChange(GRAMMI, HOUSE, "2026-11-13"), { day: "2026-12-01", theme: "christmas" });
  assert.deepEqual(nextChange(GRAMMI, HOUSE, "2026-11-30"), { day: "2026-12-01", theme: "christmas" });
});

test("crossing New Year", () => {
  assert.deepEqual(nextChange(GRAMMI, HOUSE, "2026-12-20"), { day: "2027-01-07", theme: "january" });
  assert.equal(wornOn(GRAMMI, "2027-01-06").theme, "christmas");
  assert.equal(wornOn(GRAMMI, "2027-01-07").theme, "january");
  // The engine's own house: two seasons and the everyday look between.
  const house = {
    enabled: true,
    windows: [
      { theme: "thanksgiving", start: "10-15", end: "11-30" },
      { theme: "christmas", start: "12-01", end: "01-06" },
    ],
  };
  assert.deepEqual(nextChange(house, HOUSE, "2026-11-12"), { day: "2026-12-01", theme: "christmas" });
  assert.deepEqual(nextChange(house, HOUSE, "2026-12-20"), { day: "2027-01-07", theme: HOUSE });
  assert.deepEqual(nextChange(house, HOUSE, "2027-03-01"), { day: "2027-10-15", theme: "thanksgiving" });
  assert.deepEqual(wearingOn(house, HOUSE, "07-04"), { theme: HOUSE, index: -1 });
});

test("February 29 in 2026 (no leap day) and 2028 (leap day)", () => {
  // Her February window ends "02-29": in 2026 it ends on the 28th, in 2028 on the 29th.
  assert.deepEqual(nextChange(GRAMMI, HOUSE, "2026-02-28"), { day: "2026-03-01", theme: "march" });
  assert.equal(wornOn(GRAMMI, "2028-02-29").theme, "february");
  assert.deepEqual(nextChange(GRAMMI, HOUSE, "2028-02-28"), { day: "2028-03-01", theme: "march" });
  assert.deepEqual(nextChange(GRAMMI, HOUSE, "2028-02-29"), { day: "2028-03-01", theme: "march" });
  // A leap-day look only comes up in a year that has one.
  const leap = { enabled: true, windows: [{ theme: "birthday", start: "02-29", end: "02-29" }] };
  assert.equal(nextChange(leap, HOUSE, "2026-01-01"), null, "no 02-29 within 366 days of 2026-01-01");
  assert.deepEqual(nextChange(leap, HOUSE, "2028-01-01"), { day: "2028-02-29", theme: "birthday" });
  assert.deepEqual(nextChange(leap, HOUSE, "2028-02-29"), { day: "2028-03-01", theme: HOUSE });
  // A window starting 02-29 starts on March 1 in a year without one.
  const fromLeap = { enabled: true, windows: [{ theme: "birthday", start: "02-29", end: "03-05" }] };
  assert.deepEqual(nextChange(fromLeap, HOUSE, "2027-02-27"), { day: "2027-03-01", theme: "birthday" });
  // Put up now from February 10, 2026: her February window comes down on the 28th.
  assert.equal(upNowUntil(GRAMMI, "february", "2026-02-10"), "2026-02-28");
  assert.equal(upNowUntil(GRAMMI, "february", "2028-02-10"), "2028-02-29");
  assert.deepEqual(problems(GRAMMI, THEMES), [], "02-29 is a day of the year");
});

test("turned off, the calendar puts nothing up", () => {
  const off = { ...GRAMMI, enabled: false };
  assert.deepEqual(wornOn(off, "2026-12-25"), { theme: HOUSE, index: -1 });
  assert.equal(nextChange(off, HOUSE, "2026-11-13"), null);
  assert.equal(nextChange(undefined, HOUSE, "2026-11-13"), null);
  assert.equal(nextChange(GRAMMI, HOUSE, "2026-13-01"), null);
});

test("overlaps name the season that wins", () => {
  const seasons = {
    enabled: true,
    windows: [
      { theme: "christmas", start: "12-01", end: "01-06" },
      { theme: "new-year", start: "01-01", end: "01-02" },
      { theme: "birthday", start: "11-20", end: "11-22" },
      { theme: "thanksgiving", start: "11-01", end: "11-30" },
    ],
  };
  assert.deepEqual(problems(seasons, THEMES), [
    { index: 1, words: "Christmas (December 1 to January 6) overlaps New Year (January 1 to January 2). Christmas comes first, so it wins for those days." },
    { index: 3, words: "Birthday (November 20 to November 22) overlaps Thanksgiving (November 1 to November 30). Birthday comes first, so it wins for those days." },
  ]);
  // And the calendar does what the words say.
  assert.equal(wearingOn(seasons, HOUSE, "01-01").theme, "christmas");
  assert.equal(wearingOn(seasons, HOUSE, "11-21").theme, "birthday");
  assert.equal(wearingOn(seasons, HOUSE, "11-23").theme, "thanksgiving");
  // Overlapping only on February 29 still overlaps (leap years).
  const leapOnly = { windows: [
    { theme: "february", start: "02-01", end: "02-29" },
    { theme: "birthday", start: "02-29", end: "03-03" },
  ] };
  assert.equal(problems(leapOnly, THEMES).length, 1);
  // Two windows of the same look are not a problem.
  assert.deepEqual(problems({ windows: [
    { theme: "christmas", start: "12-01", end: "12-31" },
    { theme: "christmas", start: "12-20", end: "01-06" },
  ] }, THEMES), []);
});

test("other problems, in plain words", () => {
  const seasons = { enabled: true, windows: [
    { theme: "xmas", start: "12-01", end: "01-06" },
    { theme: "april", start: "04-01", end: "04-31" },
    { theme: "february", start: "02-30", end: "03-01" },
    { theme: "", start: "", end: "13-01" },
    { theme: "may", end: "05-31" },
  ] };
  assert.deepEqual(problems(seasons, THEMES), [
    { index: 0, words: "Season 1 puts up a look this site does not have (\"xmas\"). Choose another look." },
    { index: 1, words: "April comes down on April 31, but April has only 30 days." },
    { index: 2, words: "February goes up on February 30, but February has only 29 days." },
    { index: 3, words: "Choose the look season 4 puts up." },
    { index: 3, words: "Choose the day Season 4 goes up." },
    { index: 3, words: "The day Season 4 comes down is not a day of the year. Choose another day." },
    { index: 4, words: "Choose the day May goes up." },
  ]);
  const many = { windows: Array.from({ length: MAX_WINDOWS + 2 }, () => ({ theme: "may", start: "05-01", end: "05-01" })) };
  assert.deepEqual(problems(many, THEMES), [{ index: -1, words: "There can be at most 24 seasons. Remove 2 seasons." }]);
  assert.deepEqual(problems(GRAMMI, THEMES.map((t) => t.name)), [], "plain theme names are accepted");
});

test("put up now wins through its last day, then expires", () => {
  const up = { ...GRAMMI, upNow: { theme: "christmas", until: "2027-01-06" } };
  assert.deepEqual(wornOn(up, "2026-11-13"), { theme: "christmas", index: -1, upNow: true });
  assert.deepEqual(wornOn(up, "2027-01-06"), { theme: "christmas", index: -1, upNow: true });
  assert.deepEqual(wornOn(up, "2027-01-07"), { theme: "january", index: 1 });
  // Without a full date there is no knowing whether it has expired: the calendar answers.
  assert.deepEqual(wearingOn(up, HOUSE, "11-13"), { theme: "thanksgiving", index: 11 });
  // Christmas is up now and stays up through her window, so the next change is January 7.
  assert.deepEqual(nextChange(up, HOUSE, "2026-11-13"), { day: "2027-01-07", theme: "january" });
  // A look with no window comes down after `until` and the calendar takes over.
  const toys = { ...GRAMMI, upNow: { theme: "birthday", until: "2026-11-27" } };
  assert.deepEqual(nextChange(toys, HOUSE, "2026-11-13"), { day: "2026-11-28", theme: "thanksgiving" });
  // Expired: ignored.
  const old = { ...GRAMMI, upNow: { theme: "birthday", until: "2026-11-12" } };
  assert.equal(wornOn(old, "2026-11-13").theme, "thanksgiving");
  // It wins even with the calendar off, and the everyday look comes back after.
  const offUp = { ...GRAMMI, enabled: false, upNow: { theme: "christmas", until: "2026-11-20" } };
  assert.equal(wornOn(offUp, "2026-11-13").theme, "christmas");
  assert.deepEqual(nextChange(offUp, HOUSE, "2026-11-13"), { day: "2026-11-21", theme: HOUSE });
});

test("upNowUntil: the end of the look's coming window, or 14 days", () => {
  const christmasEnd = GRAMMI.windows.find((w) => w.theme === "christmas").end;
  assert.equal(christmasEnd, "01-06");
  assert.equal(upNowUntil(GRAMMI, "christmas", "2026-11-13"), `2027-${christmasEnd}`);
  assert.equal(upNowUntil(GRAMMI, "christmas", "2026-11-13"), "2027-01-06");
  // Inside the window already: the end of this one.
  assert.equal(upNowUntil(GRAMMI, "christmas", "2026-12-20"), "2027-01-06");
  assert.equal(upNowUntil(GRAMMI, "christmas", "2027-01-03"), "2027-01-06");
  assert.equal(upNowUntil(GRAMMI, "thanksgiving", "2026-11-13"), "2026-11-30");
  // No window: two weeks.
  assert.equal(upNowUntil(GRAMMI, "birthday", "2026-11-13"), "2026-11-27");
  assert.equal(upNowUntil(GRAMMI, "birthday", "2026-12-25"), "2027-01-08");
  assert.equal(upNowUntil(GRAMMI, "birthday", "nope"), "");
});

test("switch time in her own time zone", () => {
  // December 1 starts at midnight UTC: 7 pm the evening before in New York (EST).
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "America/New_York" }), "the evening before, by about 8 pm your time");
  // In summer (EDT), 8 pm.
  assert.equal(switchTimeWords("2027-07-01", { timeZone: "America/New_York" }), "the evening before, by about 9 pm your time");
  // London: midnight in winter (GMT), 1 am in summer (BST).
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "Europe/London" }), "that morning, by about 1 am your time");
  assert.equal(switchTimeWords("2027-07-01", { timeZone: "Europe/London" }), "that morning, by about 2 am your time");
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "Asia/Tokyo" }), "that morning, by about 10 am your time");
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "UTC" }), "that morning, by about 1 am your time");
  // Half-hour zones, and a build later in the hour.
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "Asia/Kolkata" }), "that morning, by about 6:30 am your time");
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "Pacific/Honolulu" }), "the afternoon before, by about 3 pm your time");
  assert.equal(switchTimeWords("2026-12-01", { timeZone: "America/New_York", buildMinute: 45 }), "the evening before, by about 8:30 pm your time");
  assert.equal(switchTimeWords("2026-02-30", { timeZone: "UTC" }), "");
});

test("toStored writes keys in the documented order", () => {
  const messy = {
    upNow: { until: "2027-01-06", theme: "christmas", extra: 1 },
    windows: [{ end: "01-06", start: "12-01", theme: "christmas", note: "x" }],
    enabled: true,
    version: 1,
  };
  const stored = toStored(messy);
  assert.equal(
    JSON.stringify(stored),
    '{"version":1,"enabled":true,"windows":[{"theme":"christmas","start":"12-01","end":"01-06"}],"upNow":{"theme":"christmas","until":"2027-01-06"}}',
  );
  assert.equal(JSON.stringify(toStored(GRAMMI)), JSON.stringify(GRAMMI), "her calendar is already in order");
  assert.ok(!("upNow" in toStored(GRAMMI)));
  assert.deepEqual(toStored({}), { version: 1, enabled: false, windows: [] });
  // Put up, then undone: the same as before.
  const { upNow, ...undone } = toStored({ ...GRAMMI, upNow: { theme: "christmas", until: "2027-01-06" } });
  assert.ok(upNow);
  assert.deepEqual(undone, toStored(GRAMMI));
});

test("Eastern evening of November 30 is already December 1 for the site (UTC days)", async () => {
  const { wearingOn } = await import("../../web/studio/parts/season-windows.js");
  const seasons = { version: 1, enabled: true, windows: [{ theme: "christmas", start: "12-01", end: "01-06" }, { theme: "thanksgiving", start: "11-01", end: "11-30" }] };
  const utcDay = (instant) => new Date(instant).toISOString().slice(0, 10);
  for (const [instant, theme] of [["2026-11-30T18:30:00-05:00", "thanksgiving"], ["2026-11-30T23:30:00-05:00", "christmas"], ["2026-12-01T00:30:00-05:00", "christmas"]]) {
    const day = utcDay(instant);
    assert.equal(wearingOn(seasons, "grammis", day.slice(5), { date: day }).theme, theme, instant);
  }
});

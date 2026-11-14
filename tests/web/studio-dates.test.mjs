import assert from "node:assert/strict";
import test from "node:test";

import { isFuture, joinInstant, sayDay, sayWhen, splitInstant } from "../../web/studio/parts/dates.js";

const timeZone = "America/New_York";
// Thursday, November 12, 2026, 3 PM in New York.
const now = new Date("2026-11-12T20:00:00Z");
const opts = { now, timeZone };

test("sayWhen: today, yesterday, this year, other years", () => {
  assert.equal(sayWhen("2026-11-12T20:00:00Z", opts), "Today at 3 PM");
  assert.equal(sayWhen("2026-11-11T14:00:00Z", opts), "Yesterday at 9 AM");
  assert.equal(sayWhen("2026-11-27T13:00:00Z", opts), "Friday, November 27 at 8 AM");
  assert.equal(sayWhen("2025-11-03T13:00:00Z", opts), "Monday, November 3, 2025 at 8 AM");
});

test("sayWhen: minutes only when not on the hour; midnight and noon", () => {
  assert.equal(sayWhen("2026-11-12T20:30:00Z", opts), "Today at 3:30 PM");
  assert.equal(sayWhen("2026-11-12T14:05:00Z", opts), "Today at 9:05 AM");
  assert.equal(sayWhen("2026-11-12T05:00:00Z", opts), "Today at 12 AM");
  assert.equal(sayWhen("2026-11-12T17:00:00Z", opts), "Today at 12 PM");
});

test("sayWhen: the day is the zone's day, not UTC's", () => {
  // 03:00 UTC on the 13th is 10 PM on the 12th in New York.
  assert.equal(sayWhen("2026-11-13T03:00:00Z", opts), "Today at 10 PM");
  assert.equal(sayWhen("2026-11-13T03:00:00Z", { now, timeZone: "UTC" }), "Friday, November 13 at 3 AM");
  // An instant with an offset reads the same as its UTC spelling.
  assert.equal(sayWhen("2026-11-27T08:00:00-05:00", opts), "Friday, November 27 at 8 AM");
});

test("sayWhen: a plain date is a day, with no time and no zone shift", () => {
  assert.equal(sayWhen("2026-04-09", opts), "Thursday, April 9");
  assert.equal(sayWhen("2026-11-12", opts), "Today");
  assert.equal(sayWhen("2026-11-11", opts), "Yesterday");
  assert.equal(sayWhen("2025-11-03", opts), "Monday, November 3, 2025");
  // Far east of UTC the plain date is still the same day.
  assert.equal(sayWhen("2026-04-09", { now, timeZone: "Pacific/Kiritimati" }), "Thursday, April 9");
});

test("sayWhen: across DST in America/New_York", () => {
  // 2026-03-08: clocks go forward at 2 AM. 06:59Z is 1:59 AM EST, 07:00Z is 3 AM EDT.
  assert.equal(sayWhen("2026-03-08T06:59:00Z", opts), "Sunday, March 8 at 1:59 AM");
  assert.equal(sayWhen("2026-03-08T07:00:00Z", opts), "Sunday, March 8 at 3 AM");
  // 2026-11-01: clocks go back at 2 AM; 1:30 AM happens twice.
  assert.equal(sayWhen("2026-11-01T05:30:00Z", opts), "Sunday, November 1 at 1:30 AM");
  assert.equal(sayWhen("2026-11-01T06:30:00Z", opts), "Sunday, November 1 at 1:30 AM");
  assert.equal(sayWhen("2026-11-01T12:00:00Z", opts), "Sunday, November 1 at 7 AM");
});

test("sayWhen: empty or unreadable values give no words", () => {
  assert.equal(sayWhen("", opts), "");
  assert.equal(sayWhen(undefined, opts), "");
  assert.equal(sayWhen("not a date", opts), "");
});

test("sayDay gives the day part only", () => {
  assert.equal(sayDay("2026-11-12T20:00:00Z", opts), "Today");
  assert.equal(sayDay("2026-11-11T20:00:00Z", opts), "Yesterday");
  assert.equal(sayDay("2026-11-27T13:00:00Z", opts), "Friday, November 27");
  assert.equal(sayDay("2025-11-03T13:00:00Z", opts), "Monday, November 3, 2025");
  assert.equal(sayDay("2026-04-09", opts), "Thursday, April 9");
});

test("splitInstant: instant → the zone's date and time; plain date → no time", () => {
  assert.deepEqual(splitInstant("2026-11-27T13:00:00Z", timeZone), { date: "2026-11-27", time: "08:00" });
  assert.deepEqual(splitInstant("2026-11-13T03:15:00Z", timeZone), { date: "2026-11-12", time: "22:15" });
  assert.deepEqual(splitInstant("2026-04-09", timeZone), { date: "2026-04-09", time: "" });
  assert.deepEqual(splitInstant("", timeZone), { date: "", time: "" });
  assert.deepEqual(splitInstant("2026-11-12T05:00:00Z", timeZone), { date: "2026-11-12", time: "00:00" });
});

test("joinInstant: empty date, plain date, and an instant with the zone's offset", () => {
  assert.equal(joinInstant({ date: "", time: "08:00" }, timeZone), "");
  assert.equal(joinInstant({ date: "2026-04-09", time: "" }, timeZone), "2026-04-09");
  assert.equal(joinInstant({ date: "2026-11-27", time: "08:00" }, timeZone), "2026-11-27T08:00:00-05:00");
  assert.equal(joinInstant({ date: "2026-07-04", time: "18:30" }, timeZone), "2026-07-04T18:30:00-04:00");
  assert.equal(joinInstant({ date: "2026-07-04", time: "18:30" }, "UTC"), "2026-07-04T18:30:00+00:00");
  assert.equal(joinInstant({ date: "2026-07-04", time: "18:30" }, "Asia/Kolkata"), "2026-07-04T18:30:00+05:30");
  assert.throws(() => joinInstant({ date: "27/11/2026", time: "" }, timeZone), RangeError);
  assert.throws(() => joinInstant({ date: "2026-11-27", time: "25:00" }, timeZone), RangeError);
});

test("joinInstant is DST-correct in America/New_York", () => {
  // The day clocks go forward: before and after the gap.
  assert.equal(joinInstant({ date: "2026-03-08", time: "01:30" }, timeZone), "2026-03-08T01:30:00-05:00");
  assert.equal(joinInstant({ date: "2026-03-08", time: "03:30" }, timeZone), "2026-03-08T03:30:00-04:00");
  // 2:30 AM does not exist that day: it moves forward an hour, as the clock does.
  assert.equal(joinInstant({ date: "2026-03-08", time: "02:30" }, timeZone), "2026-03-08T03:30:00-04:00");
  // The day clocks go back: 1:30 AM is ambiguous and takes the earlier (EDT) one.
  assert.equal(joinInstant({ date: "2026-11-01", time: "01:30" }, timeZone), "2026-11-01T01:30:00-04:00");
  assert.equal(joinInstant({ date: "2026-11-01", time: "08:00" }, timeZone), "2026-11-01T08:00:00-05:00");
  assert.equal(joinInstant({ date: "2026-10-31", time: "23:00" }, timeZone), "2026-10-31T23:00:00-04:00");
});

test("split then join gives the same instant, and a plain date round-trips unchanged", () => {
  for (const value of ["2026-11-27T13:00:00Z", "2026-03-08T07:00:00Z", "2026-11-01T12:00:00Z", "2026-07-04T22:30:00Z"]) {
    const joined = joinInstant(splitInstant(value, timeZone), timeZone);
    assert.equal(Date.parse(joined), Date.parse(value), value);
  }
  assert.equal(joinInstant(splitInstant("2026-04-09", timeZone), timeZone), "2026-04-09");
});

test("isFuture: instants, plain dates (start of the day in the zone), empty", () => {
  assert.equal(isFuture("2026-11-27T13:00:00Z", now, timeZone), true);
  assert.equal(isFuture("2026-11-12T19:59:00Z", now, timeZone), false);
  assert.equal(isFuture("2026-11-12T20:00:00Z", now, timeZone), false);
  assert.equal(isFuture("2026-11-12", now, timeZone), false);
  assert.equal(isFuture("2026-11-13", now, timeZone), true);
  // At 11 PM on the 12th in New York it is already the 13th in UTC; the 13th is still ahead.
  assert.equal(isFuture("2026-11-13", new Date("2026-11-13T04:00:00Z"), timeZone), true);
  assert.equal(isFuture("2026-11-13", new Date("2026-11-13T04:00:00Z"), "UTC"), false);
  assert.equal(isFuture("", now, timeZone), false);
  assert.equal(isFuture("nonsense", now, timeZone), false);
});

test("a future day with no time gets 8 AM her time; a past day and a chosen time stay", async () => {
  const { defaultTime, joinInstant } = await import("../../web/studio/parts/dates.js");
  const now = new Date("2026-11-13T20:00:00Z");
  const zone = "America/New_York";
  assert.equal(defaultTime("2026-11-27", "", now, zone), "08:00");
  assert.equal(joinInstant({ date: "2026-11-27", time: defaultTime("2026-11-27", "", now, zone) }, zone), "2026-11-27T08:00:00-05:00");
  assert.equal(defaultTime("2026-11-27", "17:30", now, zone), "17:30");
  assert.equal(defaultTime("2026-03-03", "", now, zone), "");
  // Today, after 8 AM: no time is made up for her.
  assert.equal(defaultTime("2026-11-13", "", now, zone), "");
  assert.equal(defaultTime("", "", now, zone), "");
});

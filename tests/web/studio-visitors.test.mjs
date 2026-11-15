import { test } from "node:test";
import assert from "node:assert/strict";
import { rangeOf, headline, pagesLine, topReads, peopleWords, seriesLabel, sinceLine, visitorTrouble } from "../../web/studio/parts/visitor-words.js";

const summary = {
  from: "2026-10-15", to: "2026-11-13", views: 612, uniques: 214, firstDay: "2026-11-03",
  topPosts: [
    { path: "/pecan-pie/", views: 120, uniques: 88, allTime: 1040 },
    { path: "/", views: 60, uniques: 50, allTime: 300 },
    { path: "/tags/pies/", views: 40, uniques: 30, allTime: 40 },
    { path: "/cornbread-dressing", views: 70, uniques: 61, allTime: 90 },
  ],
};
const posts = [{ title: "Pecan pie", url: "/pecan-pie/" }, { title: "Cornbread dressing", url: "/cornbread-dressing/" }];

test("ranges are 7, 30 or 90 days, 30 by default", () => {
  assert.equal(rangeOf(""), 30);
  assert.equal(rangeOf("7"), 7);
  assert.equal(rangeOf("365"), 30);
});

test("the numbers are said as people and pages", () => {
  assert.equal(headline(summary), "214 people visited");
  assert.equal(headline({ uniques: 1 }), "1 person visited");
  assert.equal(pagesLine(summary), "They looked at 612 pages.");
  assert.equal(peopleWords(1040), "1,040 people");
});

test("what they read is named by title; other pages only add up", () => {
  const reads = topReads(summary, posts);
  assert.deepEqual(reads.top.map((r) => [r.title, r.people]), [["Pecan pie", 88], ["Your front page", 50], ["Cornbread dressing", 61]]);
  assert.equal(reads.other, 40);
  assert.ok(!JSON.stringify(reads.top).includes("/tags/"));
});

test("the chart's words name the busiest day, and only with a week of days", () => {
  const day = (d) => `[${d}]`;
  const series = Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-0${i + 1}`, views: i === 3 ? 48 : 5 }));
  assert.equal(seriesLabel(series, day), "Visits per day, busiest [2026-11-04] with 48.");
  assert.equal(seriesLabel(series.slice(0, 6), day), "");
  assert.equal(sinceLine(summary, day), "Counting since [2026-11-03].");
  assert.equal(sinceLine({ ...summary, firstDay: "2026-01-01" }, day), "");
});

test("failures are in her words", () => {
  assert.equal(visitorTrouble({ status: 404 }), "Visitor counting is switched off.");
  assert.match(visitorTrouble({ status: 502 }), /aren't answering/);
});

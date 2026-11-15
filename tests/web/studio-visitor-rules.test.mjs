import { test } from "node:test";
import assert from "node:assert/strict";
import { rangeOf, buckets, headline, hostWords, mergeHosts, visitorProblem, chartLabel } from "../../web/studio/parts/visitor-rules.js";

test("ranges are 7, 30, 90 or 365 days, 30 by default", () => {
  assert.equal(rangeOf(""), 30);
  assert.equal(rangeOf("7"), 7);
  assert.equal(rangeOf("365"), 365);
  assert.equal(rangeOf("12"), 30);
});

test("visits are visits, not people", () => {
  assert.equal(headline({ uniques: 214, views: 612 }), "214 visits");
  assert.equal(headline({ uniques: 1, views: 1 }), "1 visit");
});

test("days before counting began are 'not yet', never zero, and never named by the chart's words", () => {
  const series = Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, views: i < 9 ? 0 : 5 }));
  const drawn = buckets(series, 30, "2026-10-10");
  assert.equal(drawn.buckets[0].notYet, true);
  assert.equal(drawn.buckets[9].notYet, false);
  assert.ok(!chartLabel(drawn, (d) => `[${d}]`).includes("[2026-10-01]"));
});

test("hosts are named plainly and merged without www", () => {
  assert.equal(hostWords("www.google.com"), "Google");
  assert.deepEqual(mergeHosts([{ host: "www.google.com", views: 3 }, { host: "google.com", views: 2 }]), [{ name: "Google", views: 5 }]);
});

test("failures are in her words", () => {
  assert.equal(visitorProblem({ status: 404 }), "Visitor counting is switched off.");
  assert.match(visitorProblem({ status: 502 }), /aren't answering/);
});

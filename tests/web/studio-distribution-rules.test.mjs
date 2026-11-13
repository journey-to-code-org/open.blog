// Ported from tests/web/admin-distribution.test.mjs for the old Admin's retirement (R1): the same
// checks of the pure rules, against Studio's copy; the old screen's tests stay with the old Admin
// until R15. "Where it went" keeps unknowns out of what was reached, says what each status rests
// on, and normalizes the hosted social queue by the same rules as the server.
import assert from "node:assert/strict";
import test from "node:test";

import { announcementRow, daysFrom, daysWords, mergeReport, pagePath, placeWords, reachedWords, reconcileRows, totals, unreadableWords } from "../../web/studio/parts/distribution-rules.js";

const announcement = (over = {}) => ({
  destination: { provider: "bluesky", displayName: "@me.bsky.social" },
  canonicalUrl: "https://t.example/a/",
  status: "published",
  providerPostId: "at://did:plc:x/app.bsky.feed.post/3k",
  attemptCount: 1,
  updatedAt: "2026-11-02T10:00:00Z",
  lastErrorCode: null,
  ...over,
});

test("a queue item becomes a row by the server's rules, and anything unknown is left out", () => {
  assert.deepEqual(
    ["published", "unknown", "failed", "canceled", "scheduled", "claimed"].map((status) => announcementRow(announcement({ status }))?.status),
    ["delivered", "unknown", "not-delivered", "not-delivered", "pending", "pending"],
  );
  const row = announcementRow(announcement());
  assert.equal(row.url, "/a/");
  assert.equal(row.evidence, "confirmed");
  assert.equal(row.place, "@me.bsky.social");
  assert.equal(announcementRow(announcement({ status: "teleported" })), null);
  assert.equal(announcementRow(announcement({ destination: { provider: "myspace" } })), null);
  assert.equal(announcementRow(announcement({ canonicalUrl: "javascript:alert(1)" })), null);
  assert.equal(announcementRow(announcement({ providerPostId: "id with spaces" })).remoteId, null);
  assert.equal(announcementRow(announcement({ status: "failed", lastErrorCode: "Bearer xyz rejected" })).problem, "other");
  assert.equal(pagePath("https://t.example/a/?utm_source=x"), "/a/");
});

test("G7: a share she marked as there without the provider's id rests on her word", () => {
  const row = announcementRow(announcement({ providerPostId: null, checkedByOwner: true }));
  assert.equal(row.status, "delivered");
  assert.equal(row.evidence, "author");
  assert.equal(row.remoteId, null);
  assert.equal(announcementRow(announcement({ checkedByOwner: "yes" })).evidence, "confirmed", "only a real true counts");
});

test("one row per post and place, an unknown never overrules a settled outcome, and unknowns are not reached", () => {
  const rows = reconcileRows([
    announcementRow(announcement({ status: "published", updatedAt: "2026-11-01T10:00:00Z" })),
    announcementRow(announcement({ status: "unknown", updatedAt: "2026-11-03T10:00:00Z" })),
    announcementRow(announcement({ status: "unknown", canonicalUrl: "https://t.example/b/" })),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.url === "/a/").status, "delivered");
  assert.equal(rows.find((r) => r.url === "/a/").attempts, 2);
  const sum = totals(rows);
  assert.deepEqual([sum.reached, sum.unknown], [1, 1]);
});

const report = {
  version: 1,
  days: 30,
  visitsAvailable: true,
  arrivals: { bluesky: { "/a/": 7 } },
  families: [{ id: "pinterest", label: "Pinterest", state: "unreadable" }],
  posts: [
    {
      source: "posts/a.md",
      title: "Post A",
      url: "/a/",
      destinations: [
        { destination: "dev", place: "my-dev", status: "delivered", evidence: "confirmed", attempts: 1, permalink: "https://dev.to/t/a-1", visits: { kind: "estimated", value: 3, days: 30 }, providerStats: { kind: "unavailable" } },
        { destination: "reddit", place: "r/rust", status: "by-hand", evidence: "author", attempts: 1, permalink: null, visits: { kind: "estimated", value: 0, days: 30 }, providerStats: { kind: "unavailable" } },
      ],
    },
  ],
};

test("social rows join their posts with the counter's visits; a platform's own numbers are never read", () => {
  const social = [announcementRow(announcement()), announcementRow(announcement({ canonicalUrl: "https://t.example/b/", destination: { provider: "facebook", displayName: "Page" } }))];
  const posts = mergeReport(report, social, (url, destination) => Number(report.arrivals[destination]?.[url] ?? 0));
  assert.deepEqual(posts.map((p) => p.url), ["/a/", "/b/"]);
  const a = posts[0];
  assert.equal(a.rows.length, 3);
  const bluesky = a.rows.find((r) => r.destination === "bluesky");
  assert.deepEqual(bluesky.visits, { kind: "estimated", value: 7, days: 30 });
  assert.deepEqual(bluesky.providerStats, { kind: "unavailable", reason: "not-read" });
  assert.equal(posts[1].title, "/b/", "a post the server didn't list is named by its address");
  const off = mergeReport(report, social, null);
  assert.deepEqual(off[0].rows.find((r) => r.destination === "bluesky").visits, { kind: "unavailable", reason: "counter-off" });
  assert.deepEqual(mergeReport(null, [], null), []);
  assert.equal(totals(a.rows).reached, 3);
});

test("Studio's words for each place, the heading and the days", () => {
  assert.deepEqual(placeWords({ destination: "facebook", place: "Ridgeline Roofing", status: "delivered", evidence: "confirmed", visits: { kind: "estimated", value: 12 } }),
    { place: "Facebook, Ridgeline Roofing", status: "Shared", evidence: "confirmed", visits: "About 12 visits from there" });
  assert.equal(placeWords({ destination: "nextdoor", status: "by-hand", evidence: "author" }).status, "You posted it");
  assert.equal(placeWords({ destination: "nextdoor", status: "by-hand", evidence: "author" }).place, "Nextdoor");
  assert.equal(placeWords({ destination: "pinterest", status: "unknown" }).status, "Check this");
  assert.equal(placeWords({ destination: "dev", status: "pending" }).status, "Going out");
  assert.equal(placeWords({ destination: "dev", status: "not-delivered" }).status, "Didn't go out");
  assert.equal(placeWords({ destination: "youtube", status: "draft" }).status, "Saved there as a draft");
  assert.equal(placeWords({ destination: "dev", status: "delivered", visits: { kind: "estimated", value: 0 } }).visits, "", "no visits line for none");
  assert.equal(placeWords({ destination: "dev", status: "delivered", visits: { kind: "estimated", value: 1 } }).visits, "About 1 visit from there");
  assert.equal(placeWords({ destination: "dev", status: "delivered", visits: { kind: "unavailable" } }).visits, "");
  assert.equal(reachedWords(report.posts[0].destinations, 30), "Reached 2 places in the last 30 days");
  assert.equal(reachedWords([{ status: "delivered" }], 365), "Reached 1 place in the last year");
  assert.equal(daysWords(90), "in the last 90 days");
  assert.deepEqual([daysFrom("90"), daysFrom("365"), daysFrom("7"), daysFrom(undefined)], [90, 365, 30, 30]);
  assert.equal(unreadableWords("Pinterest"), "Your blog couldn't read what went to Pinterest, so it isn't here. Tell the person who set up your site.");
});

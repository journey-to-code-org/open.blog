import assert from "node:assert/strict";
import test from "node:test";

import { announcementRow, createDistributionReport, mergeReport, pagePath, reconcileRows, totals } from "../../web/admin/distribution.js";
import { withDom } from "./dom-shim.mjs";
import { all, flush, text } from "./voice-harness.mjs";

// "Where it went" (#403, #404; ADRs 0402 to 0404): the screen only reads, says what each status rests on,
// keeps unknowns out of what was reached, shows visits as estimated or unavailable and a platform's own
// statistics as unavailable, and normalizes the hosted social queue by the same rules as the server.

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

function fakeApi(answers) {
  const calls = [];
  return {
    calls,
    call: async (method, name) => {
      calls.push(`${method} ${name}`);
      const answer = answers[name.split("?")[0]];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(name) : answer;
    },
  };
}

test("the screen joins social rows to their posts with the counter's visits and says what each rests on", async () => {
  await withDom(async () => {
    const api = fakeApi({ distribution: report, "social/announcements": { announcements: [announcement()] } });
    const view = createDistributionReport({ api, socialEnabled: true });
    document.body.append(view.element);
    await view.load();
    await flush();
    assert.deepEqual(api.calls, ["GET distribution?days=30", "GET social/announcements"], "only reads");
    assert.match(text(view.element.querySelector("h2")), /Reached 3 places/);
    const rows = all(view.element, "li").filter((li) => li.dataset.destination);
    assert.deepEqual(rows.map((r) => r.dataset.destination), ["dev", "reddit", "bluesky"]);
    const bluesky = rows[2];
    assert.match(text(bluesky), /Confirmed by the platform/);
    assert.match(text(bluesky), /About 7 visits in 30 days \(estimated\)/);
    assert.match(text(bluesky), /Platform statistics.*Unavailable/);
    assert.match(text(rows[1]), /Your word/);
    const link = all(rows[0], "a")[0];
    assert.equal(link.attributes.href, "https://dev.to/t/a-1");
    assert.equal(link.attributes.rel, "noopener noreferrer");
    assert.match(text(view.element), /The Pinterest record could not be read/);
  })();
});

test("without the counter or the queue the screen still works and says what is unavailable", async () => {
  await withDom(async () => {
    const quiet = { ...report, visitsAvailable: false, arrivals: {}, families: [], posts: [] };
    const api = fakeApi({ distribution: quiet, "social/announcements": Object.assign(new Error("down"), { status: 502 }) });
    const view = createDistributionReport({ api, socialEnabled: true });
    document.body.append(view.element);
    await view.load();
    await flush();
    assert.match(text(view.element), /Nothing has been sent anywhere yet/);
    assert.match(text(view.element), /Social announcements could not be read just now/);
    assert.match(text(view.element), /built-in counter is off/);
    const merged = mergeReport({ ...quiet, posts: [] }, [announcementRow(announcement())], null);
    assert.equal(merged[0].rows[0].visits.kind, "unavailable");
  })();
});

test("choosing a range asks again for those days; a failed read changes nothing and says so", async () => {
  await withDom(async () => {
    let fail = false;
    const api = fakeApi({ distribution: () => (fail ? Promise.reject(new Error("x")) : report) });
    const view = createDistributionReport({ api });
    document.body.append(view.element);
    await view.load();
    await flush();
    const seven = all(view.element, "button").find((b) => b.dataset.days === "7");
    await seven.click();
    await flush();
    assert.equal(api.calls.at(-1), "GET distribution?days=7");
    assert.equal(seven.attributes["aria-pressed"], "true");
    fail = true;
    await all(view.element, "button").find((b) => b.dataset.days === "90").click();
    await flush();
    assert.match(text(all(view.element, "p").find((p) => p.dataset.distributionStatus)), /could not be read just now/);
    assert.ok(all(view.element, "li").some((li) => li.dataset.destination === "dev"), "the last report stays");
  })();
});

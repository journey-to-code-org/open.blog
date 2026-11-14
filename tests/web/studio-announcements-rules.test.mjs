// Ported from tests/web/admin-announcements.test.mjs for the old Admin's retirement: the same checks,
// against Studio's copy of the rules. Tests of the old screens stay with the old Admin until R15.
// The Admin "Social" screen (epic #353, story #356, ADR 0310): the time in the author's own zone as
// a UTC instant (with the days the clocks change), the caption count, the words for statuses and
// errors, and the panel's behavior against a fake Admin: labelled fields, problems beside them,
// idempotent retries, versioned edits, a confirmed cancel, and a refreshed queue after a lost race.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { holdsLink } from "../../netlify/lib/social-mastodon.mjs";

import {
  CAPTION_LIMIT,
  CAPTION_LIMITS,
  blueskyCardTitle,
  blueskyNotes,
  mastodonNotes,
  captionHoldsLink,
  DELIVERY_BADGES,
  STATUS_BADGES,
  captionCount,
  deliveryOf,
  destinationLabel,
  errorText,
  eventText,
  fieldForCode,
  formatWhen,
  healthLines,
  instantToLocalInput,
  localToInstant,
  lockedReason,
  newKey,
  nextStepText,
  problemWords,
  REFRESH_CODES,
} from "../../web/studio/parts/announcements-rules.js";
import { ApiError, withDom } from "./dom-shim.mjs";
// Importing the Voice harness makes the shared DOM refuse what a real browser would turn into text
// (null, false and arrays passed to append/replaceChildren), which a forgiving shim hid once before.
import "./voice-harness.mjs";

const NY = "America/New_York";

test("a time in the author's zone is the UTC instant it names", () => {
  assert.deepEqual(localToInstant("2026-11-02T09:30", NY), { ok: true, iso: "2026-11-02T14:30:00Z", ambiguous: false }, "standard time");
  assert.deepEqual(localToInstant("2026-07-01T09:30", NY), { ok: true, iso: "2026-07-01T13:30:00Z", ambiguous: false }, "daylight time");
  assert.equal(localToInstant("2026-11-02T09:30", "Asia/Kolkata").iso, "2026-11-02T04:00:00Z");
  assert.equal(localToInstant("2026-11-02T09:30", "UTC").iso, "2026-11-02T09:30:00Z");
  assert.equal(localToInstant("2026-10-26T01:30", "Europe/London").iso, "2026-10-26T01:30:00Z", "after the clocks went back in London");
});

test("the days the clocks change: a skipped time does not exist, a repeated time uses the earlier", () => {
  assert.deepEqual(localToInstant("2026-03-08T02:30", NY), { ok: false, code: "nonexistent" });
  assert.equal(localToInstant("2026-03-08T03:30", NY).iso, "2026-03-08T07:30:00Z");
  const repeated = localToInstant("2026-11-01T01:30", NY);
  assert.deepEqual(repeated, { ok: true, iso: "2026-11-01T05:30:00Z", ambiguous: true });
  assert.equal(localToInstant("2026-11-01T02:30", NY).ambiguous, false);
});

test("input that is not a time is refused with a reason", () => {
  assert.deepEqual(localToInstant("", NY), { ok: false, code: "missing" });
  for (const bad of ["garbage", "2026-02-30T10:00", "2026-13-01T10:00", "2026-11-02T25:00", "2026-11-02", "2026-11-02T09:30:00"]) {
    assert.deepEqual(localToInstant(bad, NY), { ok: false, code: "invalid" }, bad);
  }
  assert.equal(localToInstant("2026-11-02T09:30", "Not/AZone").code, "zone");
});

test("an instant round-trips into a datetime-local value and reads in plain words", () => {
  assert.equal(instantToLocalInput("2026-11-02T14:30:00Z", NY), "2026-11-02T09:30");
  assert.equal(localToInstant(instantToLocalInput("2026-07-01T13:30:00Z", NY), NY).iso, "2026-07-01T13:30:00Z");
  assert.equal(instantToLocalInput("nope", NY), "");
  const words = formatWhen("2026-11-02T14:30:00Z", NY);
  assert.match(words, /Mon/);
  assert.match(words, /09:30/);
  assert.equal(formatWhen("not a time", NY), "not a time");
});

test("the caption count follows the server: code points of the trimmed text", () => {
  assert.deepEqual(captionCount("  hello  "), { count: 5, limit: CAPTION_LIMIT, over: false, text: "5 of 3000 characters" });
  assert.equal(captionCount("😀😀").count, 2);
  assert.equal(captionCount("a\r\nb").count, 3);
  const over = captionCount("a".repeat(CAPTION_LIMIT + 2));
  assert.equal(over.over, true);
  assert.match(over.text, /^2 characters too many/);
});

test("an idempotency key has the shape the server accepts, and is fresh each time", () => {
  const a = newKey();
  assert.match(a, /^[A-Za-z0-9_-]{16,128}$/);
  assert.notEqual(a, newKey());
  assert.match(newKey({ getRandomValues: (bytes) => bytes.fill(7) }), /^ob-0707/);
});

test("statuses and errors have words, and a locked announcement says why", () => {
  for (const status of ["scheduled", "claimed", "published", "failed", "canceled", "unknown"]) {
    assert.ok(STATUS_BADGES[status].text && STATUS_BADGES[status].symbol, status);
  }
  assert.match(lockedReason("claimed"), /no longer be changed/);
  assert.equal(lockedReason("scheduled"), "");
  assert.equal(fieldForCode("caption-too-long"), "caption");
  assert.equal(fieldForCode("time-too-soon"), "time");
  assert.equal(fieldForCode("post-not-published"), "post");
  assert.equal(fieldForCode("canonical-elsewhere"), "post");
  assert.equal(fieldForCode("destination-not-connected"), "destination");
  assert.equal(fieldForCode("unsupported-provider"), "destination");
  assert.equal(fieldForCode("hosted-failed"), "general");
  assert.equal(errorText(new ApiError("x", 422, { error: "Write a caption.", code: "caption-empty" })), "Write a caption.");
  assert.match(errorText(new ApiError("x", 409, { error: "Changed.", code: "stale" })), /refreshed/);
  assert.match(errorText(new ApiError("x", 409, { error: "Only a scheduled one.", code: "not-editable" })), /refreshed/);
  assert.match(errorText(new TypeError("Failed to fetch")), /could not be reached/);
  assert.equal(destinationLabel({ displayName: "Lantern", provider: "facebook", kind: "page" }), "Lantern (Facebook Page)");
});

// ------------------------------------------------------------------ the panel

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const all = (root, selector) => root.querySelectorAll(selector);
const byData = (root, name, value) => all(root, `[${name}]`).filter((node) => (value === undefined ? true : node.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value));
const button = (root, action) => byData(root, "data-action", action)[0];
const text = (node) => node.textContent;

const dest = [
  { id: "d-1", provider: "linkedin", kind: "member", displayName: "Mikey Nichols", status: "connected" },
  { id: "d-2", provider: "facebook", kind: "page", displayName: "Lantern Page", status: "connected" },
  { id: "d-3", provider: "bluesky", kind: "account", displayName: "@ada.bsky.social", status: "connected" },
  { id: "d-4", provider: "mastodon", kind: "account", displayName: "@ada@social.example.org", status: "connected" },
];
const found = [
  { work: "/posts/hello/", title: "Hello", eligible: true, canonicalUrl: "https://blog.example.org/posts/hello/", reason: null },
  { work: "/posts/draft/", title: "Secret draft", eligible: false, canonicalUrl: null, reason: { code: "post-not-published", message: "Only a published post can be announced." } },
];
const row = (over = {}) => ({
  id: "a-1",
  accountId: "d-1",
  destination: dest[0],
  work: "/posts/hello/",
  canonicalUrl: "https://blog.example.org/posts/hello/",
  caption: "A new post is live.",
  scheduledFor: "2099-01-01T15:00:00Z",
  status: "scheduled",
  version: 1,
  lastErrorCode: null,
  editable: true,
  ...over,
});

function fakeAdmin({ queue = [row()], fail = {}, history = {}, health } = {}) {
  const calls = [];
  let current = queue;
  const api = {
    calls,
    async call(method, path, options = {}) {
      calls.push({ method, path, json: options.json });
      const route = `${method} ${path.split("?")[0]}`;
      if (fail[route]) {
        const failure = fail[route];
        if (failure.once) delete fail[route];
        throw failure.error;
      }
      if (route === "GET social/destinations") return { destinations: dest };
      if (route === "GET social/posts") return { posts: found, now: "2026-11-01T12:00:00Z" };
      if (route === "GET social/announcements") return { announcements: current };
      if (route === "POST social/preview") return { ok: true, caption: options.json.caption.trim(), link: "https://blog.example.org/posts/hello/", cover: { image: true, description: "A lantern at dusk" }, scheduledFor: options.json.scheduledFor || null, problems: [] };
      if (route === "POST social/announcements") {
        const made = row({ id: "a-2", caption: options.json.caption, scheduledFor: options.json.scheduledFor });
        current = [made, ...current];
        return { announcement: made, replayed: false };
      }
      if (route === "PATCH social/announcements" || route === "POST social/announcements/reschedule") {
        const made = row({ ...current[0], version: 2, caption: options.json.caption ?? current[0].caption, scheduledFor: options.json.scheduledFor ?? current[0].scheduledFor });
        current = [made];
        return { announcement: made };
      }
      if (route === "POST social/announcements/cancel") {
        const made = row({ ...current[0], status: "canceled", editable: false, version: 2 });
        current = [made];
        return { announcement: made };
      }
      if (route === "POST social/announcements/retry") {
        const made = row({ ...current[0], status: "scheduled", editable: true, retryable: false, version: current[0].version + 1 });
        current = [made];
        return { announcement: made };
      }
      if (route === "POST social/announcements/resolve") {
        const published = options.json.outcome === "published";
        const made = row({ ...current[0], status: published ? "published" : "failed", editable: false, resolvable: false, retryable: !published, version: current[0].version + 1 });
        current = [made];
        return { announcement: made };
      }
      if (route === "GET social/announcements/health" && health) {
        if (health instanceof Error) throw health;
        return { health };
      }
      if (route === "GET social/announcements/attempts") {
        return { ...history, attempts: [{ attemptNo: 1, startedAt: "2026-11-01T12:00:00Z", finishedAt: "2026-11-01T12:00:02Z", outcome: "failed", httpStatus: 503, errorCode: "provider-unavailable", errorDetail: "x", providerPostId: null }, { attemptNo: 2, startedAt: "2026-11-01T12:05:00Z", finishedAt: null, outcome: null, httpStatus: null, errorCode: null, errorDetail: null, providerPostId: null }] };
      }
      throw new Error(`unexpected ${route}`);
    },
  };
  return api;
}

const timers = () => ({ setTimeout: (run) => { timers.last = run; return 1; }, clearTimeout: () => {} });

const fill = (root, id, value) => {
  const node = all(root, "select, textarea, input").find((item) => item.id.endsWith(`-${id}`));
  node.value = value;
  return node;
};

async function compose(root, { caption = "A new post is live.", when = "2026-11-02T09:30" } = {}) {
  fill(root, "destination", "d-1");
  fill(root, "post", "/posts/hello/");
  fill(root, "caption", caption);
  fill(root, "when", when);
}
const submit = (root) => byData(root, "data-social-composer")[0].dispatch("submit");

const failedRow = (over = {}) => row({ id: "a-5", status: "failed", editable: false, retryable: true, version: 4, attemptCount: 3, lastErrorCode: "attempts-exhausted", ...over });
const unknownRow = (over = {}) => row({ id: "a-6", status: "unknown", editable: false, resolvable: true, version: 3, attemptCount: 1, lastErrorCode: "timeout", ...over });
const rowOf = (root) => all(root, "li").filter((node) => node.dataset.announcement)[0];
const listReads = (api) => api.calls.filter((call) => call.method === "GET" && (call.path === "social/announcements" || call.path.startsWith("social/announcements?"))).length;

test("a short code reads as a sentence, and a queue that moved on refreshes", () => {
  assert.match(problemWords("rate-limited"), /slow down/);
  assert.match(problemWords("timeout"), /may or may not have been posted/);
  assert.equal(problemWords("nothing-like-this"), "");
  for (const code of ["stale", "conflict", "not-editable", "not-retryable", "not-resolvable", "needs-resolution"]) assert.ok(REFRESH_CODES.includes(code), code);
  assert.match(errorText(new ApiError("x", 409, { error: "Check first.", code: "needs-resolution" })), /refreshed/);
});

test("each delivery state has a word and a shape, and the waiting ones say what happens next", () => {
  for (const state of ["pending", "processing", "retrying", "published", "failed", "unknown", "canceled"]) {
    assert.ok(DELIVERY_BADGES[state].text && DELIVERY_BADGES[state].symbol, state);
  }
  assert.equal(deliveryOf({ status: "scheduled", lastErrorCode: null }), "pending");
  assert.equal(deliveryOf({ status: "scheduled", lastErrorCode: "deferred" }), "pending");
  assert.equal(deliveryOf({ status: "scheduled", lastErrorCode: "rate-limited" }), "retrying");
  assert.equal(deliveryOf({ status: "claimed" }), "processing");
  assert.equal(deliveryOf({ status: "scheduled", delivery: "retrying" }), "retrying", "the server's word wins");
  assert.equal(deliveryOf({ status: "scheduled", delivery: "__proto__" }), "pending", "an unknown word is not trusted");
  assert.equal(deliveryOf({ status: "bogus" }), "unknown");
  assert.match(nextStepText("retrying"), /tried again by itself/);
  assert.match(nextStepText("processing"), /being sent now/);
  assert.equal(nextStepText("pending"), "");
  assert.match(eventText({ at: "2026-11-01T12:00:00Z", change: "baseline", state: "unknown" }, NY), /Needs checking, history starts here/);
});

test("delivery health reads as sentences, most urgent first, and ignores codes it does not know", () => {
  const lines = healthLines({ installed: true, overdueMinutes: 15, overdue: 2, needsReview: 1, accountsNeedReconnect: 1, alerts: ["backlog-overdue", "accounts-need-reconnect", "needs-review", "made-up"] });
  assert.deepEqual(lines.map((line) => line.code), ["backlog-overdue", "accounts-need-reconnect", "needs-review"]);
  assert.match(lines[0].text, /^2 announcements are more than 15 minutes late\. The delivery worker may not be running/);
  assert.match(lines[1].text, /^1 account needs to be connected again before it can post/);
  assert.match(lines[2].text, /^1 announcement needs you to check whether it was posted/);
  const unset = healthLines({ installed: true, waitingOnProvider: 2, alerts: ["provider-not-configured"] });
  assert.match(unset[0].text, /^2 announcements wait for a provider this site has not set up for posting\. Add its settings and redeploy, or cancel them\./);
  assert.deepEqual(healthLines({ installed: false, alerts: ["backlog-overdue"] }), []);
  assert.deepEqual(healthLines(null), []);
});

test("Bluesky's caption limit is 300, the others' 3000, the same as the server's", () => {
  assert.deepEqual(CAPTION_LIMITS, { linkedin: 3000, facebook: 3000, bluesky: 300, mastodon: 475 });
  assert.equal(CAPTION_LIMIT, 3000);
  assert.equal(destinationLabel(dest[2]), "@ada.bsky.social (Bluesky account)");
  assert.equal(blueskyCardTitle("First line\nsecond"), "First line");
  assert.deepEqual(blueskyNotes("Plain words", "https://blog.example.org/posts/hello/"), ['On Bluesky the link is a card titled "Plain words" that shows blog.example.org, with no picture.']);
  // With the post's public title and description, the card shows those, not the caption (ADR 0386).
  assert.deepEqual(blueskyNotes("Soup is up, see https://blog.example.org/posts/hello/", "https://blog.example.org/posts/hello/", { title: "Hello lanterns", description: "How we light the quay." })[0], 'On Bluesky the link is a card with the post\'s title, "Hello lanterns", and its description, "How we light the quay.", that shows blog.example.org, with no picture.');
  assert.deepEqual(blueskyNotes("Soup", "https://blog.example.org/posts/hello/", { title: "Hello", description: "" })[0], 'On Bluesky the link is a card with the post\'s title, "Hello", that shows blog.example.org, with no picture.');
  assert.equal(blueskyNotes("See https://x.org #tag and @ada.bsky.social", "https://blog.example.org/").length, 3);
});

test("Mastodon's caption limit is 475, and the notes say where the link goes, what notifies and how the cover is described", () => {
  assert.equal(destinationLabel(dest[3]), "@ada@social.example.org (Mastodon account)");
  const link = "https://blog.example.org/posts/hello/";
  assert.deepEqual(mastodonNotes("Plain words", link), ["On Mastodon the link goes after the caption, on its own line; it counts as 23 characters, and Mastodon shows its own preview of it."]);
  assert.deepEqual(mastodonNotes(`Read ${link} now`, link), [],"a caption that holds the link is not given it twice");
  // The same rule as the server's (ADR 0386): brackets and a full stop around the link are not part of it.
  for (const caption of [`Soup (${link})`, `New soup: ${link}.`, `Is it ${link}?`]) {
    assert.deepEqual(mastodonNotes(caption, link), [], caption);
    assert.equal(captionHoldsLink(caption, link), holdsLink(caption, link));
  }
  for (const caption of [`See ${link}x`, "Read (https://en.wikipedia.org/wiki/Bread_(food))", `Soup (${link}).`]) assert.equal(captionHoldsLink(caption, link), holdsLink(caption, link), caption);
  const notes = mastodonNotes("New #rust post, thanks @ada@social.example.org", link, { image: true, description: "A lantern at dusk" });
  assert.equal(notes.length, 4);
  assert.match(notes[1], /#hashtags/);
  assert.match(notes[2], /notifies that person/);
  assert.match(notes[3], /described as: "A lantern at dusk"/);
  assert.match(mastodonNotes("x", link, { image: true, description: null }).at(-1), /no description \(coverAlt\), so it is never attached/);
});


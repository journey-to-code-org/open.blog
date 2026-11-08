import assert from "node:assert/strict";
import test from "node:test";

import {
  blankReview,
  fieldsFromForm,
  formFromDocument,
  formFromSnapshot,
  platformForUrl,
  platformOwnsHost,
  problemsFromServer,
  reviewErrorText,
  reviewId,
  snapshotErrorText,
  snapshotRequest,
  SNAPSHOT_ROUTE,
  validateForm,
} from "../../web/admin/proof.js";

const complete = () => ({
  ...blankReview(),
  id: "dana-r-2026-10-20",
  author: "Dana R.",
  date: "2026-10-20",
  platform: "google",
  sourceUrl: "https://g.page/r/crew/review",
  rating: "5",
  text: "On time and careful.",
});

test("a snapshot is asked for through the Assistant's own URL snapshot route, with the owner's say-so", () => {
  assert.equal(SNAPSHOT_ROUTE, "assistant/context/url/retrieve");
  assert.deepEqual(snapshotRequest("  https://g.page/r/x  "), { url: "https://g.page/r/x", confirmed: true });
});

test("a snapshot fills the link, the platform and the time it was copied, and never the name, day or stars", () => {
  const snapshot = { sourceUrl: "https://maps.app.goo.gl/abc", canonicalUrl: "https://www.google.com/maps/place/x", retrievedAt: "2026-11-08T15:04:05Z", contentType: "text/html", text: "Dana R. ★★★★★ Great floor." };
  const form = formFromSnapshot(blankReview(), snapshot);
  assert.equal(form.sourceUrl, "https://maps.app.goo.gl/abc");
  assert.equal(form.platform, "google");
  assert.equal(form.provenance, "snapshot");
  assert.equal(form.retrievedAt, "2026-11-08T15:04:05Z");
  assert.equal(form.text, "Dana R. ★★★★★ Great floor.");
  assert.equal(form.author, "");
  assert.equal(form.date, "");
  assert.equal(form.rating, "");
  // A page longer than a review fills nothing in, and words already typed are kept.
  assert.equal(formFromSnapshot(blankReview(), { ...snapshot, text: "x".repeat(5001) }).text, "");
  assert.equal(formFromSnapshot({ ...blankReview(), text: "Mine" }, snapshot).text, "Mine");
});

test("the fields written are the form's, with provenance always stated and unknown keys kept", () => {
  const form = formFromDocument({ id: "a", author: "Sam", date: "2026-10-01", platform: "Facebook", sourceUrl: "https://facebook.com/x", provenance: "snapshot", retrievedAt: "2026-11-01T00:00:00Z", future: "kept" }, "Words\r\n");
  assert.equal(form.platform, "facebook");
  assert.equal(form.text, "Words");
  const fields = fieldsFromForm(form);
  assert.equal(fields.version, "1");
  assert.equal(fields.provenance, "snapshot");
  assert.equal(fields.retrievedAt, "2026-11-01T00:00:00Z");
  assert.equal(fields.future, "kept");
  assert.ok(!("rating" in fields));
  const typed = fieldsFromForm({ ...complete(), retrievedAt: "2026-11-01T00:00:00Z" });
  assert.equal(typed.provenance, "entered");
  assert.ok(!("retrievedAt" in typed), "a typed-in review never claims a retrieval time");
});

test("the form refuses what the build refuses", () => {
  assert.deepEqual(validateForm(complete()), []);
  const fieldsOf = (form) => validateForm(form).map((problem) => problem.field);
  assert.deepEqual(fieldsOf({ ...complete(), rating: "6" }), ["rating"]);
  assert.deepEqual(fieldsOf({ ...complete(), rating: "0" }), ["rating"]);
  assert.deepEqual(fieldsOf({ ...complete(), rating: "4.5" }), ["rating"]);
  assert.deepEqual(fieldsOf({ ...complete(), sourceUrl: "https://google.example.com/r" }), ["sourceUrl"]);
  assert.deepEqual(fieldsOf({ ...complete(), sourceUrl: "javascript:alert(1)" }), ["sourceUrl"]);
  assert.deepEqual(fieldsOf({ ...complete(), platform: "other", sourceUrl: "https://example.org/r" }), []);
  assert.deepEqual(fieldsOf({ ...complete(), provenance: "snapshot", retrievedAt: "2026-10-01T00:00:00Z" }), ["date"]);
  assert.deepEqual(fieldsOf(blankReview()).sort(), ["author", "date", "id", "platform", "sourceUrl", "text"]);
  assert.deepEqual(fieldsOf({ ...blankReview(), id: "x", draft: true }), []);
});

test("platforms are matched by their own hosts, as the build does", () => {
  assert.equal(platformForUrl("https://www.facebook.com/crew/reviews"), "facebook");
  assert.equal(platformForUrl("https://www.yelp.co.uk/biz/crew"), "yelp");
  assert.equal(platformForUrl("https://google.example.com/"), "other");
  assert.equal(platformForUrl("not a link"), "other");
  assert.ok(platformOwnsHost("google", "google.co.uk"));
  assert.ok(!platformOwnsHost("google", "notgoogle.com"));
});

test("ids come from the name and the day", () => {
  assert.equal(reviewId("Dana R.", "2026-10-20"), "dana-r-2026-10-20");
  assert.equal(reviewId("Zoë", ""), "zoe");
});

test("the server's sentences land beside their fields", () => {
  const problems = problemsFromServer(["proof/a.md: rating: `9` is not a star rating; use a whole number from 1 to 5; text: add the review's words below the front matter"]);
  assert.deepEqual(problems.map((problem) => problem.field), ["rating", "text"]);
  assert.match(problems[0].message, /^Rating|^`9`/);
});

test("a refused snapshot is said in plain words, with typing it in as the way on", () => {
  for (const [detail, words] of [
    ["URL context cannot retrieve local or private network addresses", /private or local/],
    ["URL context retrieval timed out", /too long/],
    ["URL context response exceeds the 512 KiB limit", /too big/],
    ["URL context source returned HTTP 404", /HTTP 404/],
    ["URL context supports only HTML, Markdown, and plain text", /not a page of text/],
    ["URL context source redirected too many times", /too many times/],
  ]) {
    const text = snapshotErrorText({ status: 502, data: { error: detail } });
    assert.match(text, words, detail);
    assert.match(text, /type the review in/, detail);
  }
  assert.match(snapshotErrorText({ status: 400, data: { error: "Enter a complete HTTP(S) URL" } }), /full link/);
});

test("a shared link that led onto a named platform fills a form that passes its own check", () => {
  const typed = { ...complete(), platform: "", sourceUrl: "", text: "" };
  const form = formFromSnapshot(typed, { sourceUrl: "https://share.google/AbC123", canonicalUrl: "https://www.google.com/maps/place/Crew/reviews", retrievedAt: "2026-11-08T15:04:05Z", text: "Great job." });
  assert.equal(form.platform, "google");
  assert.equal(form.sourceUrl, "https://www.google.com/maps/place/Crew/reviews");
  assert.deepEqual(validateForm(form), []);
  // A link already on the platform is kept as pasted, and one that led nowhere named stays Somewhere else.
  assert.equal(formFromSnapshot(typed, { sourceUrl: "https://g.page/r/crew", canonicalUrl: "https://www.google.com/maps/x", retrievedAt: "2026-11-08T15:04:05Z" }).sourceUrl, "https://g.page/r/crew");
  const own = formFromSnapshot(typed, { sourceUrl: "https://crew.example/r", canonicalUrl: "https://crew.example/reviews", retrievedAt: "2026-11-08T15:04:05Z", text: "Great job." });
  assert.equal(own.platform, "other");
  assert.equal(own.sourceUrl, "https://crew.example/r");
  assert.deepEqual(validateForm(own), []);
});

test("a new review whose id is taken is told to change the id, not to reload", () => {
  const taken = reviewErrorText({ status: 409, data: { error: "A file with that name already exists. Change the title, slug, or date." } }, { creating: true, id: "dana-r-2026-10-20" });
  assert.match(taken, /already have a review called dana-r-2026-10-20/);
  assert.match(taken, /Change the id/);
  assert.doesNotMatch(taken, /Reload/);
  assert.match(reviewErrorText({ status: 409 }), /another window/);
});

// Ported from tests/web/admin-job-share.test.mjs for the old Admin's retirement (R1): the pure
// rules of Share this job against Studio's copy, and Studio's new words for where a place stands
// and what to fix first. The old screen's tests stay with the old Admin until R15.
import assert from "node:assert/strict";
import test from "node:test";

import { facebookAnnouncement, jobShareTrouble, keyFor, offersPosting, troubleAction, newKey, pageOpen, problemWords, soon, standing, standingText, wayFor } from "../../web/studio/parts/job-share-rules.js";

function place(destination, overrides = {}) {
  return {
    version: 1,
    destination,
    label: { "google-business-profile": "Google Business Profile", facebook: "Facebook", nextdoor: "Nextdoor" }[destination],
    route: destination === "nextdoor" ? "by-hand" : "adapter",
    text: "Sanded and sealed.",
    link: "https://floors.example.org/posts/floor/",
    photo: null,
    openUrl: "https://nextdoor.com/sharekit/?source=openblog&body=x",
    problems: [],
    ready: true,
    digest: `digest-${destination}`,
    record: null,
    changedSince: false,
    ...overrides,
  };
}

test("the newest Facebook announcement of this job, and when it's ready to go", () => {
  const older = { work: "/posts/floor/", destination: { provider: "facebook" }, createdAt: "2026-11-01T00:00:00Z", delivery: "failed" };
  const newer = { ...older, createdAt: "2026-11-08T00:00:00Z", delivery: "published" };
  const other = { ...newer, work: "/posts/other/" };
  assert.equal(facebookAnnouncement([older, newer, other], "/posts/floor/"), newer);
  assert.equal(facebookAnnouncement([], "/posts/floor/"), null);
  assert.equal(facebookAnnouncement(null, "/posts/floor/"), null);
  assert.equal(soon(Date.parse("2026-11-08T12:00:00Z")), "2026-11-08T12:05:00Z");
  assert.match(newKey(), /^ob-[0-9a-f]{32}$/);
  assert.equal(keyFor("/posts/floor/", "d1"), "/posts/floor/\nd1");
});

test("a Facebook Page is posted to through the announcements only when it can be", () => {
  const pages = [{ id: "acct-1" }];
  assert.equal(wayFor(place("facebook"), { pages, announcements: true }), "facebook-page");
  assert.equal(wayFor(place("facebook"), { pages: [], announcements: true }), "by-hand");
  assert.equal(wayFor(place("facebook"), { pages, announcements: false }), "by-hand");
  assert.equal(wayFor(place("facebook", { route: "by-hand" }), { pages, announcements: true }), "by-hand");
  assert.equal(wayFor(place("google-business-profile"), { pages, announcements: true }), "by-hand");
  assert.equal(wayFor(place("nextdoor"), { pages, announcements: true }), "by-hand");
});

test("a job already going out on the Page is never offered again; a failed or cancelled one is", () => {
  assert.equal(pageOpen(null), true);
  for (const delivery of ["pending", "processing", "retrying", "published", "unknown"]) assert.equal(pageOpen({ delivery }), false, delivery);
  for (const delivery of ["failed", "canceled"]) assert.equal(pageOpen({ delivery }), true, delivery);
});

test("where a place stands, in Studio's badges", () => {
  const badge = (destination, announcement) => standing(destination, announcement).text;
  assert.equal(badge(place("nextdoor")), "Not yet");
  assert.equal(badge(place("nextdoor", { record: { status: "posted-by-hand" } })), "You posted it");
  assert.equal(badge(place("google-business-profile", { record: { status: "posted" } })), "Done");
  assert.equal(badge(place("google-business-profile", { record: { status: "unknown" } })), "Check this");
  assert.equal(badge(place("google-business-profile", { record: { status: "not-posted" } })), "Didn't go out");
  assert.equal(badge(place("facebook"), { delivery: "pending" }), "Going out");
  assert.equal(badge(place("facebook"), { delivery: "published" }), "Done");
  assert.equal(badge(place("facebook"), { delivery: "unknown" }), "Check this");
  assert.equal(badge(place("facebook"), { delivery: "failed" }), "Didn't go out");
  // Her own mark wins over a Page post that failed (ADR 0397).
  assert.equal(badge(place("facebook", { record: { status: "posted-by-hand" } }), { delivery: "failed" }), "You posted it");
  assert.equal(badge(place("facebook", { record: { status: "posted-by-hand" } }), { delivery: "published" }), "Done");
  assert.equal(standing(place("nextdoor", { record: { status: "posted-by-hand" }, changedSince: true })).changed, true);
  assert.equal(standingText(place("nextdoor", { record: { status: "posted-by-hand" }, changedSince: true })), "You changed the job since. Post the new words if you like.");
  assert.equal(standingText(place("nextdoor")), "");
  assert.equal(standingText(place("nextdoor", { record: { status: "not-posted" }, changedSince: true })), "", "nothing was posted, so nothing changed since");
});

test("what to fix first, and refusals, in her words", () => {
  assert.equal(problemWords("no-photo"), "Add a photo of the finished work to the job.");
  assert.equal(problemWords("link-not-public"), "Publish the job first, so the link works.");
  assert.equal(problemWords("photo-location"), "The first photo may show where your customer lives. Use a copy without location.");
  assert.equal(problemWords("photo-too-small"), "The first after photo can't be used. Pick another in Write.");
  assert.equal(problemWords("teleported"), "Something about the job needs a look in Write.");
  assert.equal(jobShareTrouble({ status: 422, data: { code: "not-shareable" } }), "This isn't a published job, so there's nothing to share.");
  assert.equal(jobShareTrouble({ status: 409, data: { code: "changed" } }), "The job changed while you looked. Here are the new words.");
  assert.equal(jobShareTrouble({ status: 409, data: { code: "sent" } }, "Nextdoor"), "Your site already sent this, or may have. Look on Nextdoor first.");
  assert.equal(jobShareTrouble({ status: 0 }), "Studio couldn't reach your site's server. Check your connection, then try again.");
});

test("a job that isn't there says so and offers nothing to open; a stale Undo says the newer mark stays", () => {
  const missing = { status: 404, data: { code: "not-found" } };
  assert.equal(jobShareTrouble(missing), "Studio couldn't find this job. It may have been deleted or renamed.");
  assert.equal(troubleAction(missing), null);
  assert.equal(troubleAction({ status: 422, data: { code: "not-shareable" } }), "write");
  assert.equal(troubleAction({ status: 500 }), "retry");
  assert.equal(troubleAction({ status: 0 }), "retry");
  assert.equal(jobShareTrouble({ status: 409, data: { code: "marked-again" } }, "Nextdoor"), "You marked Nextdoor again since, so that newer mark stays.");
});

test("the post buttons come back when the job changed since it was posted", () => {
  assert.equal(offersPosting(standing(place("nextdoor"))), true);
  assert.equal(offersPosting(standing(place("nextdoor", { record: { status: "posted-by-hand" } }))), false);
  assert.equal(offersPosting(standing(place("nextdoor", { record: { status: "posted-by-hand" }, changedSince: true }))), true);
  assert.equal(offersPosting(standing(place("google-business-profile", { record: { status: "posted" }, changedSince: true }))), true);
});

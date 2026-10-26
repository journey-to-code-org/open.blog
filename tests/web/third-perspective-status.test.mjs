// A Third Perspective's status (#222, ADR 0115): what a reader is told through their receipt, where
// pending never reads as published and nothing names a moderator, and what Admin offers when the
// published file and the hosted copy disagree, most often after a reader withdrew a reflection.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
const { receiptNoun, receiptStateText } = await import("../../web/components/feedback-receipt.js");
const { feedbackPublicationMismatch, moderationOutcome, perspectiveAuditNotices } = await import("../../web/admin/admin.js");

const perspective = (extra) => ({ kind: "third-perspective", status: "pending", published: false, purged: false, ...extra });

test("a reader's receipt names each state of their reflection, and pending is never published", () => {
  assert.equal(receiptNoun(perspective()), "reflection");
  assert.equal(receiptNoun({ kind: "question" }), "note");
  const pending = receiptStateText(perspective());
  assert.match(pending, /^Waiting for a moderator’s review\. It is not published/);
  assert.doesNotMatch(pending, /is shown on/);
  const asked = receiptStateText(perspective({ status: "clarification", clarification: { reason: "unclear" } }));
  assert.match(asked, /asked you to clarify this reflection because it was not clear\. It is not published\./);
  assert.match(receiptStateText(perspective({ status: "approved", published: true })), /^Approved; it appears on the work’s page as a reader’s reflection, as you agreed, once the site is updated/);
  assert.match(receiptStateText(perspective({ status: "approved", published: false })), /^Approved, but not shown/);
  // Without the hosted consent column the state is unknown, never "not shown".
  const unknown = receiptStateText(perspective({ status: "approved", published: null }));
  assert.match(unknown, /cannot tell whether it is shown/);
  assert.doesNotMatch(unknown, /not shown:/);
  assert.match(receiptStateText(perspective({ status: "rejected" })), /^Not published:/);
  assert.match(receiptStateText(perspective({ status: "removed" })), /^Not published any more:/);
  assert.match(receiptStateText(perspective({ status: "withdrawn", purged: true })), /^You withdrew it, so it is not published\. Its text and your name were deleted/);
  assert.equal(receiptStateText(perspective({ status: "surprise" })), "Its state is not one this page knows.");
  for (const status of ["pending", "clarification", "approved", "rejected", "removed", "withdrawn"]) {
    const words = receiptStateText(perspective({ status, published: status === "approved" }));
    assert.doesNotMatch(words, /mikey|@moderation-token|an author’s/i, status);
    if (status !== "approved") assert.match(words, /not published|not shown|never published/i, status);
  }
  // Passage feedback keeps its own words.
  assert.equal(receiptStateText({ kind: "question", status: "approved", published: true }), "Approved and published on the post.");
});

test("Admin offers to take a withdrawn reflection off its post, and to publish an approved one", () => {
  const card = (extra) => ({ source: "feedback", kind: "third-perspective", ...extra });
  assert.deepEqual(feedbackPublicationMismatch(card({ status: "approved", published: false, mayBeShown: true })), { notice: "Approved, but not on the site yet.", action: "publish", label: "Publish on the post" });
  const withdrawn = feedbackPublicationMismatch(card({ status: "withdrawn", published: true, mayBeShown: false }));
  assert.equal(withdrawn.action, "unpublish");
  assert.match(withdrawn.notice, /withdrew this reflection through their receipt/);
  assert.equal(feedbackPublicationMismatch(card({ status: "approved", published: true, mayBeShown: false })).action, "unpublish", "a consent that no longer allows it");
  assert.equal(feedbackPublicationMismatch(card({ status: "approved", published: true, mayBeShown: true })), null);
  assert.equal(feedbackPublicationMismatch(card({ status: "pending", published: false, mayBeShown: false })), null);
  assert.equal(feedbackPublicationMismatch(card({ status: "approved", published: null, mayBeShown: true })), null, "nothing is claimed when the file cannot be read");
  // A published reflection whose hosted state cannot be told (the flag is off or rolled back) is flagged, not declared fine or condemned.
  const unknown = feedbackPublicationMismatch(card({ status: "approved", published: true, mayBeShown: null }));
  assert.equal(unknown.action, "unpublish");
  assert.match(unknown.notice, /cannot tell whether it may stay/);
  assert.equal(feedbackPublicationMismatch(card({ status: "approved", published: false, mayBeShown: null })), null, "nothing to publish on an unknown state");
});

test("an approval says whether the reflection was published", () => {
  const item = { source: "feedback", kind: "third-perspective", work: "/posts/tides/", post: { title: "Tides" }, perspective: { consent: { number: 2 } } };
  assert.match(moderationOutcome(item, "approve", { published: true }), /consent record 2, as a reader’s reflection on “Tides”\. Nothing was e-mailed\. It is published on the post/);
  assert.match(moderationOutcome(item, "approve", { published: false, publishError: "third-perspectives.json cannot be read." }), /third-perspectives\.json cannot be read\.$/);
});

test("the banner counts published reflections that must come off and those that cannot be checked", () => {
  assert.deepEqual(perspectiveAuditNotices({ mustComeOff: [], unknown: [] }), []);
  assert.deepEqual(perspectiveAuditNotices(undefined), []);
  const [one] = perspectiveAuditNotices({ mustComeOff: [{ id: "a", post: "posts/x.md" }], unknown: [] });
  assert.equal(one.kind, "mustComeOff");
  assert.match(one.text, /^1 published reflection must come off its post/);
  const [many, unknown, truncated] = perspectiveAuditNotices({ mustComeOff: [{}, {}], unknown: [{}], truncated: true });
  assert.match(many.text, /^2 published reflections must come off their posts/);
  assert.match(unknown.text, /^1 published reflection cannot be checked against the hosted copy/);
  assert.equal(truncated.kind, "truncated");
});

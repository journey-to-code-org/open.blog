// A Third Perspective's status (#222, ADR 0115): what a reader is told through their receipt, where
// pending never reads as published and nothing names a moderator, and what Admin offers when the
// published file and the hosted copy disagree, most often after a reader withdrew a reflection.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { get: () => undefined, define: () => {} };
const { receiptNoun, receiptStateText } = await import("../../web/components/feedback-receipt.js");

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



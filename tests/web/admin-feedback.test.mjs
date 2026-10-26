// Reader feedback moderation in Admin (ADR 0095): the request a moderation action sends names the
// state and version the moderator saw and, for a passage that is not current, the passage check
// they confirmed; a reader's private name is labelled as private; the public preview never claims
// a quotation the post no longer has.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEEDBACK_QUEUE_STATES, feedbackModerationRequest, feedbackPreviewText, feedbackReaderLine } from "../../web/admin/admin.js";

const moderation = JSON.parse(readFileSync(new URL("../fixtures/feedback-moderation.json", import.meta.url), "utf8"));

const item = (passage) => ({ id: "00000000-0000-4000-8000-00000000000a", status: "pending", version: 3, passage });

test("the queue lists the participation policy's states that B5 writes", () => {
  for (const state of FEEDBACK_QUEUE_STATES) assert.ok(moderation.rules.states.includes(state), state);
  assert.deepEqual(FEEDBACK_QUEUE_STATES, ["pending", "approved", "rejected", "removed"]);
});

test("a moderation request names what the moderator saw", () => {
  assert.deepEqual(feedbackModerationRequest(item({ check: "current", acknowledge: false }), "approve"), {
    id: "00000000-0000-4000-8000-00000000000a", action: "approve", from: "pending", version: 3,
  });
  assert.deepEqual(feedbackModerationRequest(item({ check: "current", acknowledge: false }), "reject", "off-topic"), {
    id: "00000000-0000-4000-8000-00000000000a", action: "reject", from: "pending", version: 3, reason: "off-topic",
  });
  // A passage that moved or changed is approved only with the check the moderator confirmed.
  const stale = item({ check: "stale", acknowledge: true });
  assert.equal(feedbackModerationRequest(stale, "approve", undefined, false).acknowledge, undefined);
  assert.equal(feedbackModerationRequest(stale, "approve", undefined, true).acknowledge, "stale");
  assert.equal(feedbackModerationRequest(item({ check: "reanchored", acknowledge: true }), "approve", undefined, true).acknowledge, "reanchored");
  assert.equal(feedbackModerationRequest(stale, "reject", "spam", true).acknowledge, undefined, "only an approval confirms a passage");
});

test("a reader's name is marked private unless they agreed to show it", () => {
  assert.equal(feedbackReaderLine(undefined), "From an anonymous reader.");
  assert.equal(feedbackReaderLine({ publishName: false }), "From an anonymous reader.");
  assert.match(feedbackReaderLine({ name: "Ada", publishName: true }), /agreed to show this name/);
  assert.match(feedbackReaderLine({ name: "Ada", publishName: false }), /stays private/);
});

test("the public preview says what the post will show, and never quotes a changed passage", () => {
  assert.equal(
    feedbackPreviewText({ quote: "The sun matters too.", stale: false, received: "2026-10-26", name: "Ada" }),
    "On the post it is shown quoting “The sun matters too.”, as from Ada, received 2026-10-26.",
  );
  assert.equal(
    feedbackPreviewText({ stale: true, received: "2026-10-26" }),
    "On the post it is shown without a quotation, because the passage has changed, as from a reader, received 2026-10-26.",
  );
  assert.equal(feedbackPreviewText(null), "");
});

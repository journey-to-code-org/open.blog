// The moderation inbox in Admin (#225, ADR 0105): its addresses and filters, the request a
// decision sends (what the moderator saw, never who they are), the wording of roles, readers and
// outcomes, counts that never reveal what a viewer may not see, and the published-file mismatch
// B5's view offered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decisionLine,
  decisionOutcome,
  decisionProblem,
  decisionRequest,
  evidenceReviewLines,
  localDay,
  MODERATION_KINDS,
  MODERATION_STATES,
  feedbackPreviewText,
  feedbackPublicationMismatch,
  inboxSummary,
  moderationHash,
  moderationOutcome,
  moderationReaderLine,
  moderationRequest,
  moderationRoleLine,
  parseModerationRoute,
  retentionSummaryLines,
} from "../../web/admin/admin.js";

const transitions = JSON.parse(readFileSync(new URL("../fixtures/participation-transitions.json", import.meta.url), "utf8"));
const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");

test("the inbox lists every state of the one state machine, pending first", () => {
  assert.deepEqual([...MODERATION_STATES].sort(), [...new Set(transitions.cases.map((entry) => entry.state))].sort());
  assert.equal(MODERATION_STATES[0], "pending");
  assert.deepEqual(MODERATION_KINDS.map(([id]) => id), ["", "comment", "question", "source-suggestion", "correction-suggestion", "alternative-interpretation", "abuse-report"]);
});

test("addresses keep the state and kind, and anything unknown falls back to the defaults", () => {
  assert.equal(moderationHash("approved"), "#/moderation/approved");
  assert.equal(moderationHash("removed", "comment"), "#/moderation/removed?kind=comment");
  assert.equal(moderationHash("deleted", "vote"), "#/moderation/pending");
  const params = (query) => new URLSearchParams(query);
  assert.deepEqual(parseModerationRoute("clarification", params("kind=question")), { state: "clarification", kind: "question" });
  assert.deepEqual(parseModerationRoute("../../etc", params("kind=<script>")), { state: "pending", kind: "" });
  // B5's old address still opens the inbox at the state it named.
  assert.deepEqual(parseModerationRoute("removed", params("")), { state: "removed", kind: "" });
  assert.match(admin, /head === "moderation" \|\| head === "feedback"/);
});

test("a decision names what the moderator saw and nothing about who they are", () => {
  const item = { source: "comment", id: "00000000-0000-4000-8000-000000000001", status: "pending", version: 4, role: "coordinator" };
  assert.deepEqual(moderationRequest(item, "approve"), { source: "comment", id: item.id, action: "approve", from: "pending", version: 4 });
  assert.deepEqual(moderationRequest(item, "reject", "spam"), { source: "comment", id: item.id, action: "reject", from: "pending", version: 4, reason: "spam" });
  for (const key of ["role", "actor", "actorRole", "user"]) assert.equal(key in moderationRequest(item, "approve"), false, key);
  // A passage that moved or changed is approved only with the check the moderator confirmed.
  const stale = { ...item, source: "feedback", passage: { check: "stale", acknowledge: true } };
  assert.equal(moderationRequest(stale, "approve", undefined, false).acknowledge, undefined);
  assert.equal(moderationRequest(stale, "approve", undefined, true).acknowledge, "stale");
  assert.equal(moderationRequest(stale, "reject", "spam", true).acknowledge, undefined, "only an approval confirms a passage");
});

test("roles and readers are worded so a private name is never implied to a coordinator", () => {
  assert.match(moderationRoleLine("site-admin"), /site Admin/);
  assert.match(moderationRoleLine("coordinator"), /Only the site Admin sees a reader’s private name or reopens/);
  assert.match(moderationRoleLine("contributing-author"), /A coordinator or the site Admin decides/);
  assert.equal(moderationReaderLine({ name: "Grace", publishName: true }, "comment"), "From Grace, shown with the comment.");
  assert.equal(moderationReaderLine({ publishName: false, private: true }), "The reader gave a name that only the site Admin can see.");
  assert.equal(moderationReaderLine(undefined), "From an anonymous reader.");
  assert.match(moderationReaderLine({ name: "Ada", publishName: true }), /agreed to show this name/);
  assert.match(moderationReaderLine({ name: "Ada", publishName: false }), /stays private/);
});

test("counts say only how many are shown, and clarification and removal read as their own outcomes", () => {
  assert.equal(inboxSummary("pending", 2, false), "2 pending items.");
  assert.equal(inboxSummary("pending", 50, true), "50 pending items. More are listed after these.");
  assert.equal(inboxSummary("clarification", 1, false), "1 item waiting for clarification.");
  assert.equal(inboxSummary("clarification", 0, false), "Nothing is waiting for clarification.");
  assert.equal(inboxSummary("withdrawn", 0, false), "No withdrawn items.");
  const comment = { source: "comment", post: { title: "Tides" }, work: "/posts/tides/" };
  const note = { ...comment, source: "feedback" };
  assert.equal(moderationOutcome(comment, "approve", {}), "Approved. The comment is shown on “Tides”.");
  assert.equal(moderationOutcome(note, "approve", { published: true }), "Approved and published on “Tides”. Rebuild or publish to update the live site.");
  assert.equal(moderationOutcome(note, "request-clarification", {}), "Asked the reader to clarify. Nothing was published or e-mailed.");
  assert.equal(moderationOutcome(note, "reopen", { item: { status: "clarification" } }), "Reopened. It is waiting for clarification again.");
  assert.equal(moderationOutcome(comment, "remove", {}), "Removed from “Tides”.");
  assert.match(moderationOutcome(note, "remove", { published: true, publishError: "reader-feedback.json could not be written" }), /still on the post/);
  assert.equal(moderationOutcome({ ...comment, post: null }, "remove", {}), "Removed from /posts/tides/.");
});

test("the public preview never quotes a changed passage, and a mismatch with the published file is offered a fix", () => {
  assert.equal(
    feedbackPreviewText({ quote: "The sun matters too.", stale: false, received: "2026-10-26", name: "Ada" }),
    "On the post it is shown quoting “The sun matters too.”, as from Ada, received 2026-10-26.",
  );
  assert.equal(feedbackPreviewText({ stale: true, received: "2026-10-26" }), "On the post it is shown without a quotation, because the passage has changed, as from a reader, received 2026-10-26.");
  const card = (status, published) => feedbackPublicationMismatch({ status, published });
  assert.deepEqual(card("approved", false), { notice: "Approved, but not on the site yet.", action: "publish", label: "Publish on the post" });
  assert.deepEqual(card("removed", true), { notice: "Removed, but still on the post.", action: "unpublish", label: "Take it off the post" });
  assert.equal(card("approved", null), null);
  assert.equal(card("pending", true), null);
});

test("the view builds every control as text with its own label, and never as markup", () => {
  const view = admin.slice(admin.indexOf("async showModeration("), admin.indexOf("// ---- editor"));
  assert.doesNotMatch(view, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(view, /h\("label", \{ for: "oba-moderation-kind" \}, "Kind"\)/);
  assert.match(view, /h\("label", \{ for: selectId \}/);
  assert.match(view, /"aria-describedby": guidanceId/);
  assert.match(view, /role: "status", "aria-live": "polite", tabindex: "-1"/);
  assert.match(view, /cards\[0\]\?\.querySelector\("h3"\)\?\.focus\(\)/);
});

// ---- Engagement protection (#226, ADRs 0107 and 0108)

test("abuse reports, upheld reports and deletions are worded without naming any reader", () => {
  assert.equal(moderationReaderLine({ publishName: false }, "report"), "Reports are anonymous: nothing about the reader who sent it is kept.");
  const report = { source: "report", post: { title: "Tides" }, work: "/posts/tides/" };
  assert.equal(moderationOutcome(report, "uphold-report", { removedTarget: true }), "Report upheld. The reported item was removed from “Tides”.");
  assert.match(moderationOutcome(report, "uphold-report", { removedTarget: false }), /already out of public view/);
  assert.match(moderationOutcome(report, "uphold-report", { removedTarget: true, published: true, publishError: "Disk full." }), /still on the post\. Disk full\./);
  assert.equal(moderationOutcome({ source: "comment" }, "erase", {}), "Its text and name were deleted. Only the private record of decisions remains.");
  // A note its reader withdrew and asked to delete must come off the post.
  const withdrawn = feedbackPublicationMismatch({ status: "withdrawn", published: true });
  assert.equal(withdrawn.action, "unpublish");
  assert.match(withdrawn.notice, /asked for it to be deleted/);
  assert.equal(feedbackPublicationMismatch({ status: "withdrawn", published: false }), null);
});

test("the retention dry run says what would happen, and that comments are kept unless opted in", () => {
  const report = {
    periods: { auditDays: 365, comments: false },
    summary: [{ step: "expire", kind: "question", kindLabel: "Question", count: 2 }, { step: "purge-content", kind: "abuse-report", kindLabel: "Abuse report", count: 1 }],
    audit: { comment: 3, feedback: 0, report: 1 },
    truncated: true,
  };
  assert.deepEqual(retentionSummaryLines(report), [
    "2 question items would expire without a decision.",
    "1 abuse report item would have their text, details and names deleted.",
    "4 private records of decisions older than 365 days would be deleted.",
    "Comments are kept until you act, because participation.retention is not set in openblog.json.",
    "More items are due than one run takes; run it again afterwards.",
  ]);
  assert.deepEqual(retentionSummaryLines({ periods: { auditDays: 365, comments: true }, summary: [], audit: {} }), ["Nothing is due: retention would change nothing now."]);
  // The run is a separate, confirmed step after the dry run.
  assert.match(admin, /"GET", "engagement\/retention"/);
  assert.match(admin, /"POST", "engagement\/retention", \{ json: \{ asOf: report\.asOf, audit: auditBox\.checked \} \}/);
  assert.match(admin, /I understand that purged text, details and names cannot be recovered\./);
});

// ---- Correction decisions and evidence (ADRs 0138 and 0139)

const OUTCOMES = [
  { id: "accepted-as-correction", accepted: true },
  { id: "accepted-as-clarification", accepted: true },
  { id: "accepted-as-evidence", accepted: true },
  { id: "declined", accepted: false },
  { id: "already-addressed", accepted: false },
];
const decidable = (extra = {}) => ({
  id: "a1111111-1111-4111-8111-11111111111a",
  recordDecision: { expectedDecisions: 2, itemRevision: 3, outcomes: OUTCOMES, post: "posts/tides.md", ...extra },
});

test("a decision sends what the author saw and only the fields its outcome takes, never who decides", () => {
  const item = decidable();
  const full = { outcome: "declined", extent: "full", declineReason: "maintains-reading", rationale: "Neap tides.", revisionNote: "2026-10-27: x", claimEvidence: "tides tides-noaa", addressedBy: "b", confirmed: true, decided: "2026-10-27" };
  assert.deepEqual(decisionRequest(item, full), {
    id: item.id, expectedDecisions: 2, itemRevision: 3, outcome: "declined", decided: "2026-10-27", declineReason: "maintains-reading", rationale: "Neap tides.",
  });
  assert.deepEqual(decisionRequest(item, { ...full, outcome: "accepted-as-evidence", extent: "partial" }), {
    id: item.id, expectedDecisions: 2, itemRevision: 3, outcome: "accepted-as-evidence", decided: "2026-10-27", extent: "partial", rationale: "Neap tides.",
    revisionNote: { post: "posts/tides.md", note: "2026-10-27: x" }, claimEvidence: { claim: "tides", link: "tides-noaa" },
  });
  assert.equal(decisionRequest(item, { ...full, outcome: "already-addressed", addressedBy: " b1 " }).addressedBy, "b1");
  // The passage check goes only when the passage moved and the author confirmed it.
  assert.equal(decisionRequest(item, full).confirmCheck, undefined);
  assert.equal(decisionRequest(decidable({ confirmCheck: "stale:quoteNotFound" }), full).confirmCheck, "stale:quoteNotFound");
  assert.equal(decisionRequest(decidable({ confirmCheck: "reanchored" }), { ...full, confirmed: false }).confirmCheck, undefined);
  for (const key of ["actor", "role", "actorRole", "account", "decidedBy"]) assert.ok(!(key in decisionRequest(item, full)), key);
  assert.match(localDay(new Date(2026, 9, 7, 23, 59)), /^2026-10-07$/);
});

test("what a decision is missing is named on its own field before anything is sent", () => {
  const item = decidable({ confirmCheck: "reanchored" });
  const cases = [
    [{}, "outcome"],
    [{ outcome: "accepted-as-correction" }, "extent"],
    [{ outcome: "accepted-as-correction", extent: "partial" }, "rationale"],
    [{ outcome: "accepted-as-correction", extent: "full" }, "revisionNote"],
    [{ outcome: "accepted-as-evidence", extent: "full", revisionNote: "n" }, "claimEvidence"],
    [{ outcome: "declined" }, "declineReason"],
    [{ outcome: "declined", declineReason: "other", rationale: "  " }, "rationale"],
    [{ outcome: "already-addressed" }, "revisionNote"],
    [{ outcome: "already-addressed", addressedBy: "b" }, "confirmed"],
  ];
  for (const [values, field] of cases) assert.equal(decisionProblem(item, values)?.field, field, JSON.stringify(values));
  assert.equal(decisionProblem(item, { outcome: "declined", declineReason: "other", rationale: "Why.", confirmed: true }), null);
});

test("decisions and evidence are worded as the author's and the reader's statements, never verdicts", () => {
  assert.equal(
    decisionLine({ label: "Correction", extent: "partial", decided: "2026-10-27", decidedBy: { role: "coordinator", account: "grace" }, inForce: true }),
    "Correction (in part), 2026-10-27 by grace as coordinator",
  );
  assert.match(decisionLine({ label: "Declined by the author", declineReasonLabel: "The author keeps the passage as written", decided: "2026-10-28", decidedBy: { role: "site-admin", account: "@moderation-token" }, inForce: false }), /^Declined by the author: The author keeps the passage as written, 2026-10-28 \(superseded/);
  assert.match(decisionOutcome({ decision: { label: "Clarification" } }), /^Decision recorded: Clarification\. The post, its citations and the Source Library were not changed/);
  // A note already on its post shows the new outcome there; one that is not stays off it.
  assert.match(decisionOutcome({ decision: { label: "Correction" }, outcomePublished: true }), /The outcome now shows on the published note\. Rebuild or publish to update the live site\.$/);
  assert.doesNotMatch(decisionOutcome({ decision: { label: "Correction" }, outcomePublished: false }), /published note/);
  assert.match(decisionOutcome({ decision: { label: "Correction" }, publishError: "reader-feedback.json could not be written" }), /The published note could not be updated: reader-feedback\.json could not be written$/);
  const lines = evidenceReviewLines({
    claim: { id: "cave", published: true, label: "Claim 1", statement: "The cave educates." },
    evidenceLink: { id: "h1", published: false },
    citation: { id: "noaa", published: true, label: "NOAA (2020)" },
    source: { id: "slings", published: true, label: "Slings (2003)" },
    locators: [{ kind: "page", value: "40", to: "41" }],
    stanceLabel: "The reader says it contradicts the passage",
  });
  assert.deepEqual(lines, [
    "Claim: Claim 1, “The cave educates.”.",
    "Evidence for it the reader questions: “h1”, which this post does not publish now.",
    "Cited source the reader questions: NOAA (2020).",
    "Source the reader offers: Slings (2003), at page 40–41.",
    "The reader says it contradicts the passage.",
  ]);
  for (const line of lines) assert.doesNotMatch(line, /private|verified|incorrect|false/i);
  assert.deepEqual(evidenceReviewLines(null), []);
  // The inbox never calls a suggestion a correction on its own: that label comes only from the
  // server's standing, which only the author's decision sets.
  assert.doesNotMatch(admin, /"Correction"|label: "Correction/);
});

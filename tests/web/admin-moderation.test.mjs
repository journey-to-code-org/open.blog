// The moderation inbox in Admin (#225, ADR 0105): its addresses and filters, the request a
// decision sends (what the moderator saw, never who they are), the wording of roles, readers and
// outcomes, counts that never reveal what a viewer may not see, and the published-file mismatch
// B5's view offered.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODERATION_KINDS,
  answerLines,
  answerOffer,
  answerRequest,
  withdrawAnswerRequest,
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
  perspectiveLines,
  retentionSummaryLines,
} from "../../web/admin/admin.js";

const transitions = JSON.parse(readFileSync(new URL("../fixtures/participation-transitions.json", import.meta.url), "utf8"));
const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");

test("the inbox lists every state of the one state machine, pending first", () => {
  assert.deepEqual([...MODERATION_STATES].sort(), [...new Set(transitions.cases.map((entry) => entry.state))].sort());
  assert.equal(MODERATION_STATES[0], "pending");
  assert.deepEqual(MODERATION_KINDS.map(([id]) => id), ["", "comment", "question", "source-suggestion", "correction-suggestion", "alternative-interpretation", "third-perspective", "author-response", "abuse-report"]);
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

test("a Third Perspective's approval names the text revision and consent record shown, and its card says what binds", () => {
  const item = {
    source: "feedback", id: "00000000-0000-4000-8000-000000000001", kind: "third-perspective", status: "pending", version: 3, revision: 2,
    details: { category: "connection", categoryLabel: "A connection", prompt: "What does this bring to mind: another work, idea or source?" },
    perspective: { about: "section", section: "methods", check: "stale", consent: { number: 4, publish: true, showName: false, clarification: true, feature: false }, nameMatchesCredit: true },
    post: { title: "Tides" },
  };
  assert.deepEqual(moderationRequest(item, "approve"), { source: "feedback", id: item.id, action: "approve", from: "pending", version: 3, seenRevision: 2, seenConsent: 4 });
  assert.deepEqual(moderationRequest(item, "reject", "spam"), { source: "feedback", id: item.id, action: "reject", from: "pending", version: 3, reason: "spam" });
  const lines = perspectiveLines(item);
  assert.match(lines[0], /About the section #methods\. That section has changed/);
  assert.match(lines[1], /Prompt: A connection/);
  assert.match(lines[2], /Consent record 4: the reader agrees to publish it without their name, and may be asked to clarify it\. Approving binds this record/);
  assert.match(lines[3], /never shown with the reflection/);
  assert.deepEqual(perspectiveLines({ source: "feedback" }), []);
  assert.match(moderationOutcome(item, "approve", {}), /consent record 4, as a reader’s reflection on “Tides”/);
  assert.equal(moderationReaderLine({ name: "Ada", publishName: true }, "feedback", "third-perspective"), "From Ada, who agreed to show this name if you publish the reflection.");
});

// ---- Author responses (#223, ADR 0166)

const PARENT = "00000000-0000-4000-8000-000000000001";
const perspective = (extra = {}) => ({
  id: PARENT, source: "feedback", kind: "third-perspective", status: "approved", version: 3, revision: 1,
  perspective: { about: "section", section: "ob-by-mina-0", check: "current", consent: { number: 1, publish: true, showName: false, clarification: false }, attributed: { contributor: "mina", author: "MINA", standing: { state: "current", moved: false } } },
  ...extra,
});

test("a reflection about one author's section is worded by author, never by an anchor or a side", () => {
  const lines = perspectiveLines(perspective());
  assert.match(lines[0], /^About one author’s section by MINA\.$/);
  assert.doesNotMatch(lines.join(" "), /ob-by-|left|right|column/);
  const changed = perspectiveLines(perspective({ perspective: { ...perspective().perspective, check: "stale", attributed: { author: "MINA", standing: { state: "stale", reason: "section-changed-or-removed" } } } }));
  assert.match(changed[0], /That author’s section has changed or been removed since the reader read it\./, "never claims which");
  const absent = perspectiveLines(perspective({ perspective: { ...perspective().perspective, check: "stale", attributed: { author: null, standing: { state: "stale", reason: "author-absent" } } } }));
  assert.match(absent[0], /No section by that author is published now\./);
  // An ordinary heading keeps its own wording.
  assert.match(perspectiveLines({ perspective: { about: "section", section: "methods", check: "current", consent: { number: 1, publish: true } } })[0], /^About the section #methods\./);
});

test("an answer's author is offered a form only when the server offered one, and the request names no one", () => {
  assert.equal(answerOffer(perspective()), null, "no offer, no form");
  const offer = answerOffer(perspective({ answerAs: { contributor: "mina", author: "MINA", standing: { state: "current", moved: false } } }));
  assert.equal(offer.heading, "Answer as MINA");
  assert.match(offer.hint, /once a coordinator approves it\. You cannot approve it yourself/);
  assert.doesNotMatch(offer.hint, /changed or been removed/);
  const stale = answerOffer(perspective({ answerAs: { contributor: "mina", author: "MINA", standing: { state: "stale", reason: "section-changed-or-removed" } } }));
  assert.match(stale.hint, /changed or been removed since the reader read it; your answer says so/);
  const request = answerRequest(perspective(), "I meant the harbour.");
  assert.deepEqual(request, { parent: PARENT, parentVersion: 3, body: "I meant the harbour." });
  for (const key of ["actor", "user", "contributor", "participant", "author", "role", "account"]) assert.equal(key in request, false, key);
  assert.deepEqual(withdrawAnswerRequest({ id: "x", version: 2, status: "approved" }), { id: "x", version: 2 });
});

test("a moderator reads whose answer it is, never a participant, and an author is told it is their own", () => {
  const item = { kind: "author-response", response: { parent: PARENT, contributor: "mina", author: "MINA", standing: { state: "current", moved: false }, mine: false } };
  const lines = answerLines(item);
  assert.match(lines[0], /Written by MINA, the author of the section the reader’s reflection is about; the section is still published as the reader read it\./);
  assert.match(lines[1], /never approved by the account that wrote it/);
  assert.equal(lines.length, 2, "no account unless the server sent one");
  const own = answerLines({ ...item, response: { ...item.response, account: "mina-admin", mine: true, standing: { state: "stale", reason: "ambiguous" } } });
  assert.match(own[0], /identical sections, so which was meant cannot be told/);
  assert.ok(own.includes("Written by the account mina-admin."));
  assert.ok(own.includes("This is your own answer."));
  assert.doesNotMatch(own.join(" "), /p-mina|participant/);
  assert.match(moderationReaderLine({ publishName: false }, "feedback", "author-response"), /Written by the author of that section/);
  assert.deepEqual(answerLines({}), []);
});

test("the inbox draws the answer form and the withdrawal as native, labelled controls that keep what was written", () => {
  assert.match(admin, /oba-answer-form/);
  assert.match(admin, /label", \{ for: textId \}, "Your answer, in plain text"/);
  assert.match(admin, /api\.call\("POST", "engagement\/author-response"/);
  assert.match(admin, /api\.call\("PATCH", "engagement\/author-response"/);
  assert.match(admin, /answerRequest\(item, body\)/);
  assert.match(admin, /else text\.focus\(\)/, "a refused answer keeps its text and focus");
  assert.match(admin, /I understand that my answer is taken off the post for good/);
});

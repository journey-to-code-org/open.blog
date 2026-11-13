import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIEWS, viewOf, reasonWords, cardLabel, buttonsFor, quietReason, decidedWords, undoWords,
  decisionLine, waitingLine, troubleWords, decisionRequest,
} from "../../web/studio/parts/comment-words.js";

const DECLINE = [{ id: "spam", label: "Spam" }, { id: "abusive", label: "Abusive" }, { id: "other", label: "Other" }];
const comment = (over = {}) => ({
  id: "c1", source: "comment", kind: "comment", status: "pending", version: 3,
  post: { title: "Pecan pie", url: "/pecan-pie/" }, reader: { name: "Aunt Sue", publishName: true },
  actions: [
    { action: "approve", label: "Approve", reasons: [] },
    { action: "request-clarification", label: "Ask to clarify", reasons: [{ id: "unclear", label: "Unclear" }] },
    { action: "reject", label: "Reject", reasons: DECLINE },
    { action: "erase", label: "Delete its text and name", reasons: [], confirm: "I understand" },
  ],
  ...over,
});
const report = (over = {}) => comment({
  source: "report", kind: "abuse-report", reader: { name: "Ricky" },
  actions: [
    { action: "uphold-report", label: "Uphold", reasons: [{ id: "abusive", label: "Abusive" }] },
    { action: "reject", label: "Dismiss", reasons: [{ id: "no-action", label: "No action" }, { id: "spam", label: "Spam" }] },
  ],
  ...over,
});

test("the four views map to the server's states and unknown addresses are Waiting", () => {
  assert.deepEqual(VIEWS.map((v) => v.state), ["pending", "approved", "rejected", "removed"]);
  assert.equal(viewOf("shown").state, "approved");
  assert.equal(viewOf("nonsense").state, "pending");
  assert.ok(!VIEWS.some((v) => v.state === "clarification"));
});

test("a waiting comment offers Show it and Don't show; clarifying is never offered; erase goes to More", () => {
  const { top, more } = buttonsFor(comment());
  assert.deepEqual(top.map((b) => [b.label, b.primary, b.asks]), [["Show it", true, false], ["Don't show", false, true]]);
  assert.deepEqual(more.map((b) => b.label), ["Erase it for good"]);
});

test("an unknown server action still shows in More, under its own label", () => {
  const { more } = buttonsFor(comment({ actions: [{ action: "pin", label: "Pin it", reasons: [] }] }));
  assert.deepEqual(more.map((b) => [b.action, b.label]), [["pin", "Pin it"]]);
});

test("Keep the comment sends no-action quietly when offered, and asks otherwise", () => {
  const { top } = buttonsFor(report());
  assert.deepEqual(top.map((b) => [b.label, b.asks]), [["Take the comment down", true], ["Keep the comment", false]]);
  assert.equal(quietReason(report().actions[1]), "no-action");
  const asking = buttonsFor(report({ actions: [{ action: "reject", label: "Dismiss", reasons: [{ id: "spam", label: "Spam" }] }] }));
  assert.equal(asking.top[0].asks, true);
});

test("reasons are her words, reports have their own, and unknown ones keep the server's label", () => {
  assert.equal(reasonWords({ id: "abusive", label: "Abusive" }), "It's unkind");
  assert.equal(reasonWords({ id: "spam", label: "Spam" }, { report: true }), "The report is spam");
  assert.equal(reasonWords({ id: "new-one", label: "Something new" }), "Something new");
});

test("labels and decision words name the person and the post", () => {
  assert.equal(cardLabel(comment()), "Aunt Sue's comment on Pecan pie");
  assert.equal(cardLabel(comment({ reader: {}, post: null })), "Someone's comment");
  assert.equal(cardLabel(report()), "Ricky's report on Pecan pie");
  assert.match(decidedWords(comment(), "approve"), /^Shown under “Pecan pie”\. Visitors can see it now\./);
  assert.equal(decidedWords(comment(), "reject"), "Not shown. Nobody else sees it.");
  assert.equal(decidedWords(report(), "reject"), "Kept. The comment stays where it is.");
});

test("only the no's can be undone", () => {
  assert.equal(undoWords(comment(), "approve"), null);
  assert.equal(undoWords(comment(), "reject"), "Not shown: Aunt Sue's comment on Pecan pie.");
  assert.equal(undoWords(comment(), "remove"), "Taken down: Aunt Sue's comment on Pecan pie.");
  assert.equal(undoWords(report(), "uphold-report"), null);
});

test("a decided card says what was decided, why and when", () => {
  const day = () => "Tuesday, November 10";
  assert.equal(decisionLine(comment({ status: "rejected", reason: "spam", moderatedAt: "x" }), day), "Not shown: it's spam. You decided Tuesday, November 10.");
  assert.equal(decisionLine(comment({ status: "approved", moderatedAt: "x" }), day), "Shown. You decided Tuesday, November 10.");
  assert.equal(decisionLine(report({ status: "rejected" }), day), "You kept the comment.");
});

test("Home's line counts comments and reports, says more than when there's a next page, and is quiet at zero", () => {
  assert.equal(waitingLine({ items: [] }), "");
  assert.equal(waitingLine({ items: [comment()] }), "1 comment is waiting for you");
  assert.equal(waitingLine({ items: [comment(), report(), { source: "feedback" }] }), "2 comments are waiting for you");
  assert.equal(waitingLine({ items: [comment(), comment()], next: "c" }), "More than 2 comments are waiting for you");
});

test("failures are in her words", () => {
  assert.match(troubleWords({ status: 502 }, "list"), /isn't answering right now/);
  assert.match(troubleWords({}, "card"), /couldn't reach your site's server/);
  assert.equal(troubleWords({ status: 500 }, "card"), "That didn't go through. Nothing changed. Try again.");
});

test("a decision names the item as loaded and says nothing about who is acting", () => {
  assert.deepEqual(decisionRequest(comment(), "reject", "spam"), { source: "comment", id: "c1", action: "reject", from: "pending", version: 3, reason: "spam" });
  assert.deepEqual(decisionRequest(comment(), "approve"), { source: "comment", id: "c1", action: "approve", from: "pending", version: 3 });
});

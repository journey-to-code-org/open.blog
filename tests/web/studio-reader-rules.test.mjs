import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIEWS, viewOf, shownViews, buttonsFor, cardLabel, decisionRequest, didWords, undoWords, readersRoute, readersHash, parseItemRef,
  waitingLine, readerProblem, problemWords, reasonWords, needsAcknowledge, publicationState, fixRoute, readerWords,
} from "../../web/studio/parts/reader-rules.js";
import {
  setupState, setupStateWords, settingsRequest, setupProblem, keyStatus, retentionRequest, retentionCount, retentionLines,
} from "../../web/studio/parts/reader-setup-rules.js";

const DECLINE = [{ id: "spam", label: "Spam" }, { id: "abusive", label: "Abusive" }, { id: "other", label: "Other" }];
const comment = (over = {}) => ({
  id: "c1", source: "comment", kind: "comment", status: "pending", version: 3,
  post: { title: "Pecan pie", url: "/pecan-pie/" }, reader: { name: "Aunt Sue", publishName: true },
  actions: [
    { action: "approve", label: "Approve", reasons: [] },
    { action: "request-clarification", label: "Ask", reasons: [{ id: "unclear", label: "Unclear" }] },
    { action: "reject", label: "Reject", reasons: DECLINE },
    { action: "erase", label: "Delete", reasons: [], confirm: "I understand" },
  ],
  ...over,
});

test("views map to the server's states; unknown addresses are Waiting; the extra views need more than comments", () => {
  assert.deepEqual(VIEWS.map((v) => v.state), ["pending", "clarification", "approved", "rejected", "removed", "withdrawn"]);
  assert.equal(viewOf("shown").state, "approved");
  assert.equal(viewOf("nonsense").id, "");
  assert.deepEqual(shownViews(false).map((v) => v.id), ["", "shown", "not-shown", "taken-down"]);
  assert.equal(shownViews(true).length, 6);
});

test("a waiting comment offers Show it first; every button is one the server offered; erase goes to More", () => {
  const { top, more } = buttonsFor(comment());
  assert.deepEqual(top.map((b) => [b.action, b.primary, b.asks]), [["approve", true, false], ["reject", false, true], ["request-clarification", false, true]]);
  assert.deepEqual(more.map((b) => b.action), ["erase"]);
  assert.deepEqual(buttonsFor(comment({ actions: [] })).top, []);
});

test("a decision sends what the server sent: version, state it was in, and the reason only when asked", () => {
  assert.deepEqual(decisionRequest(comment(), "reject", "spam"), { source: "comment", id: "c1", action: "reject", from: "pending", version: 3, reason: "spam" });
  assert.deepEqual(decisionRequest(comment(), "approve", ""), { source: "comment", id: "c1", action: "approve", from: "pending", version: 3 });
  assert.equal(needsAcknowledge({ passage: { acknowledge: true } }, "approve"), true);
  assert.equal(needsAcknowledge({}, "approve"), false);
});

test("labels and decision words name the person and the post; only a no can be undone", () => {
  assert.equal(cardLabel(comment()), "Comment from Aunt Sue on Pecan pie");
  assert.match(didWords(comment(), "approve").text, /Pecan pie/);
  assert.equal(undoWords(comment(), "approve"), null);
  assert.match(undoWords(comment(), "reject"), /Not shown/);
});

test("old Admin and Studio addresses land in Readers", () => {
  for (const name of ["comments", "moderation", "feedback"]) assert.equal(readersRoute(name, [], ""), "#/readers");
  assert.equal(readersRoute("analytics", [], ""), "#/readers/visitors");
  assert.equal(readersRoute("visitors", ["7"], ""), "#/readers/visitors/7");
  assert.equal(readersRoute("posts", [], ""), null);
  assert.equal(readersHash("shown", "reflection", "comment:c1"), "#/readers/shown?kind=reflection&item=comment%3Ac1");
  assert.deepEqual(parseItemRef("comment:c1"), { source: "comment", id: "c1" });
});

test("Home's line counts what is waiting and is quiet at zero", () => {
  assert.equal(waitingLine({ items: [comment()] }), "1 comment is waiting for you");
  assert.equal(waitingLine({ items: [] }), "");
});

test("failures are in her words, never a status; a conflict asks to reload", () => {
  assert.equal(readerProblem({ status: 409 }, "card").reload, true);
  assert.equal(readerProblem({ status: 503 }, "list").id, "readers.listServiceDown");
  assert.match(problemWords(readerProblem({ status: 0 })), /signal/);
  assert.equal(readerWords("readers.changedHere").length > 0, true);
  assert.equal(readerWords("not.an.id"), "");
});

test("reasons are her words; one the server invented keeps its label", () => {
  assert.equal(reasonWords({ id: "abusive", label: "Abusive" }), "It's unkind");
  assert.equal(reasonWords({ id: "zzz", label: "Server label" }), "Server label");
});

test("publication fixes name the file route that fixes them", () => {
  const state = publicationState({ kind: "third-perspective", published: false, mayBeShown: true });
  assert.deepEqual([state.level, state.action], ["warning", "publish"]);
  assert.equal(fixRoute({ kind: "author-response" }, "publish"), "engagement/author-responses/publish");
  assert.equal(publicationState({ kind: "future-suggestion" }), null);
});

test("setup: state line, the saved body never carries a key unless replacing it, and the old-notes run repeats its check", () => {
  assert.equal(setupState({ enabled: true, comments: false }, { engagement: true }).id, "readers.setupOff");
  assert.equal(setupState({ enabled: true, endpoint: "https://x.example" }, { engagement: true }).id, "readers.setupWorking");
  assert.match(setupStateWords({ id: "readers.setupNotWorking", helper: "tell" }), /tell/i);
  const settings = { enabled: true, comments: true, analytics: true, endpoint: "https://x.example/", etag: "e1", feedback: true, captcha: { provider: "turnstile", scope: "session", siteKey: "k" } };
  const keep = settingsRequest(settings, {});
  assert.equal("credential" in keep, false);
  assert.deepEqual([keep.endpoint, keep.etag, keep.credentialAction, keep.feedback], ["https://x.example", "e1", "keep", true]);
  assert.equal(settingsRequest(settings, { credentialAction: "replace", credential: " secret " }).credential, "secret");
  assert.equal(setupProblem({ enabled: true, endpoint: "http://x.example" }).field, "endpoint");
  assert.equal(setupProblem({ enabled: true, endpoint: "https://x.example", credentialAction: "replace", credential: "" }).field, "credential");
  assert.equal(setupProblem({ enabled: true, endpoint: "https://x.example" }), null);
  assert.ok(!keyStatus({ configured: true }).includes("secret"));
  const report = { asOf: "2026-11-14T00:00:00Z", summary: [{ step: "expire", kind: "feedback", count: 2 }, { step: "purge", kind: "feedback", count: 1 }], audit: { a: 3 }, periods: { comments: false } };
  assert.deepEqual(retentionRequest(report, false), { asOf: "2026-11-14T00:00:00Z", audit: false });
  assert.equal(retentionCount(report), 3);
  assert.ok(retentionLines(report).length >= 3);
});

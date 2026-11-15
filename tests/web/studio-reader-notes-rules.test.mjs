// What a reader's note brings with it (Studio R10): the rules lifted from the old Admin's inbox, with
// her words. Every line about a reader's words keeps them apart given `isolating`.
import assert from "node:assert/strict";
import test from "node:test";

import { configureWords, isolating, partsPlain } from "../../web/studio/parts/words.js";
import * as R from "../../web/studio/parts/reader-notes-rules.js";

configureWords();
const reflection = (over = {}) => ({
  id: "r1", version: 3, source: "feedback", kind: "third-perspective", status: "approved", role: "site-admin", featureConsent: "agreed",
  details: { prompt: "What stayed with you?" },
  perspective: { about: "section", attributed: { author: "‮Ann" }, check: "stale", consent: { publish: true, showName: false, number: 4 }, nameMatchesCredit: true },
  ...over,
});

test("their link and wording come from details; only http(s) is ever a link", () => {
  assert.deepEqual(R.theirOffer({ details: { sourceUrl: "https://x.example/a", suggestedText: "Say it so." } }), { link: "https://x.example/a", wording: "Say it so." });
  assert.deepEqual(R.theirOffer({ suggestion: { url: "https://y.example" } }), { link: "https://y.example", wording: "" });
  assert.equal(R.openableLink("javascript:alert(1)"), false);
  assert.equal(R.openableLink("data:text/html,x"), false);
  assert.equal(R.openableLink("https://x.example"), true);
});

test("about lines: a reflection, an idea and an answer, in her words, with the reader's words apart", () => {
  assert.equal(R.aboutHeading(reflection()), "readers.aboutReflection");
  const text = R.aboutLines(reflection());
  assert.deepEqual(text, ["About ‮Ann's part.", "That part has changed since they read it.", "They answered: “What stayed with you?”", "They agree to it being shown without their name.", "Their name matches an author of this post. It's never shown with a reflection."]);
  const parts = R.aboutLines(reflection(), isolating);
  assert.deepEqual(parts.map(partsPlain), text);
  assert.deepEqual(parts[0], ["About ", { isolate: "‮Ann" }, "'s part."]);
  assert.equal(R.aboutLines(reflection({ perspective: { about: "work", consent: { publish: false } } }))[0], "About the whole post.");
  assert.match(R.aboutLines(reflection({ perspective: { about: "work", consent: { publish: false } } })).at(-1), /no longer agree/);
  const idea = { suggestion: { typeLabel: "A book", hints: { title: "Pie", creators: ["A", "B"], identifiers: [{ scheme: "isbn", value: "123" }] }, missing: ["year"], standing: { label: "Open" }, outcome: { label: "Kept" }, conversions: [{ kind: "draft", at: "2026-11-01T00:00:00Z" }] } };
  assert.equal(R.aboutHeading(idea), "readers.aboutIdea");
  assert.deepEqual(R.aboutLines(idea), ["A book", "Title (their words): Pie", "Who made it (their words): A; B", "ISBN (not checked) (their words): 123", "Still to find: year.", "It stands as: Open.", "You marked it: Kept.", "Linked to a draft on 2026-11-01."]);
  const answer = { response: { author: "Sam", standing: { moved: true }, mine: true } };
  assert.deepEqual(R.aboutLines(answer), ["Sam wrote this as the author of the part the reflection is about.", "That part is still on the post, in another place.", "This is your own answer."]);
});

test("what they point to: each thing named, and a thing no longer on the post says so", () => {
  const lines = R.evidenceLines({ claim: { label: "C1", statement: "Pies are old", published: true }, source: { id: "s9", published: false } });
  assert.deepEqual(lines, ["The claim: C1, “Pies are old”", "A source they offer: s9", "Something they named isn't on this post any more."]);
  assert.deepEqual(R.evidenceLines(null), []);
});

test("featuring and linking are offered only where the old inbox offered them", () => {
  assert.deepEqual(R.featureCardState(reflection()), { kind: "choose" });
  assert.equal(R.featureCardState(reflection({ role: "coordinator" })), null);
  assert.equal(R.featureCardState(reflection({ status: "pending" })), null);
  assert.equal(R.featureCardState(reflection({ featureConsent: "earlier-text" })).kind, "unavailable");
  assert.equal(R.featureCardState(reflection(), { standing: "covered" }).kind, "featured");
  assert.match(R.featureStandingText({ standing: "mustComeOff" }), /must come off/);
  assert.deepEqual(R.featureRequest(reflection(), "  worth it "), { id: "r1", context: "worth it", expectedVersion: 3 });
  assert.equal(R.continuationCardState(reflection()), true);
  assert.equal(R.continuationCardState(reflection({ purged: true })), false);
  assert.equal(R.continuationCardState({ ...reflection(), kind: "comment" }), false);
  assert.deepEqual(R.continuationRequest(reflection(), { to: "/b/", note: " " }), { id: "r1", to: "/b/", relation: "takes-up", note: null, expectedVersion: 3 });
  assert.equal(R.relations(reflection()).length, 2);
  assert.equal(R.relations({ kind: "future-suggestion" }).length, 3);
  assert.equal(R.linkLine({ from: "A", to: "B", relation: "revisits", linked: "2026-11-02T10:00:00Z" }), "“A” to “B”, the later post comes back to it, 2026-11-02.");
  assert.match(R.continuationStandingText({ hidden: "to-not-published" }), /later post isn't published/);
});

test("an author's answer, taking it back, and linking an idea", () => {
  assert.equal(R.answerOffer({}), null);
  assert.deepEqual(R.answerOffer({ answerAs: { author: "Sam", standing: { state: "stale" } } }).author, "Sam");
  assert.match(R.answerOffer({ answerAs: { author: "Sam", standing: { state: "stale" } } }).help, /changed since/);
  assert.deepEqual(R.answerRequest({ id: "a", version: 2 }, "Thanks"), { parent: "a", parentVersion: 2, body: "Thanks" });
  assert.deepEqual(R.withdrawAnswerRequest({ id: "a", version: 2 }), { id: "a", version: 2 });
  assert.deepEqual(R.linkRequest({ id: "i", version: 1 }, "", "x"), { ok: false, id: "readers.ideaLinkNeedWhat", field: "kind" });
  assert.deepEqual(R.linkRequest({ id: "i", version: 1 }, "draft", " "), { ok: false, id: "readers.ideaLinkNeedWhich", field: "target" });
  assert.deepEqual(R.linkRequest({ id: "i", version: 1 }, "draft", " apple-pie "), { ok: true, body: { id: "i", version: 1, conversion: { kind: "draft", id: "apple-pie" } } });
});

test("record what you decided: fields follow the outcome, problems name their field, the body carries only what it takes", () => {
  const offer = { outcomes: [{ id: "accepted", accepted: true }, { id: "declined" }, { id: "already-addressed" }], post: "posts/a.md", confirmCheck: "c1", expectedDecisions: 2, itemRevision: 5 };
  const item = { id: "q", recordDecision: offer };
  assert.deepEqual(R.decisionFields(offer, {}), ["outcome"]);
  assert.deepEqual(R.decisionFields(offer, { outcome: "accepted" }), ["outcome", "extent", "rationale", "revisionNote", "decided", "confirmed"]);
  assert.deepEqual(R.decisionFields(offer, { outcome: "declined" }), ["outcome", "declineReason", "rationale", "decided", "confirmed"]);
  assert.deepEqual(R.decisionProblem(item, {}), { field: "outcome", id: "readers.decideNeedOutcome" });
  assert.deepEqual(R.decisionProblem(item, { outcome: "declined", declineReason: "x" }), { field: "rationale", id: "readers.decideNeedWords" });
  assert.deepEqual(R.decisionProblem(item, { outcome: "accepted", extent: "full" }), { field: "revisionNote", id: "readers.decideNeedNote" });
  assert.deepEqual(R.decisionProblem(item, { outcome: "accepted", extent: "full", revisionNote: "n" }), { field: "confirmed", id: "readers.decideNeedConfirm" });
  assert.equal(R.decisionProblem(item, { outcome: "accepted", extent: "full", revisionNote: "n", confirmed: true }), null);
  assert.deepEqual(R.outcomeRequest(item, { outcome: "accepted", extent: "full", revisionNote: "n", confirmed: true, decided: "2026-11-15", declineReason: "ignored" }),
    { id: "q", expectedDecisions: 2, itemRevision: 5, outcome: "accepted", decided: "2026-11-15", extent: "full", revisionNote: { post: "posts/a.md", note: "n" }, confirmCheck: "c1" });
  assert.match(R.outcomeWords({ outcomePublished: true }), /shows on their note/);
  assert.match(R.localDay(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test("a note about what changed is checked before it goes", () => {
  assert.deepEqual(R.changeRequest("posts/a.md", { note: " " }), { ok: false, field: "note", id: "readers.changeEmpty" });
  assert.equal(R.changeRequest("posts/a.md", { note: "x".repeat(201) }).id, "readers.changeLong");
  assert.equal(R.changeRequest("posts/a.md", { note: "Fixed", claim: "Bad Claim" }).field, "claim");
  assert.deepEqual(R.changeRequest("posts/a.md", { note: " Fixed ", date: "2026-11-15" }), { ok: true, body: { post: "posts/a.md", date: "2026-11-15", claim: "", note: "Fixed" } });
});

test("banners: must-come-off is danger with one button each; a failed check is said, a 403 isn't", () => {
  const banners = R.auditBanners({ mustComeOff: [{ id: "p1", post: "Pie" }], nameNarrowed: [{ id: "p2", post: "Tart" }], answersMustComeOff: [], unknown: [], truncated: true }, { features: [{ id: "f1", post: "Cake", standing: "mustComeOff" }] });
  assert.deepEqual(banners.map((b) => [b.level, b.id]), [["danger", "readers.auditMustGo"], ["info", "readers.auditName"], ["info", "readers.auditTruncated"], ["danger", "readers.featureAuditMustGo"]]);
  assert.deepEqual(banners[0].entries, [{ id: "p1", title: "Pie", route: "third-perspectives", operation: "unpublish", button: "readers.fixUnpublishButton" }]);
  assert.equal(banners[1].entries[0].operation, "publish");
  assert.equal(banners[3].entries[0].route, "community");
  assert.equal(R.bannerWords(banners[0]), "1 reflections must come off their posts: the reader took them back, or no longer agrees.");
  assert.deepEqual(R.auditBanners({ failed: { status: 403 } }, { failed: { status: 403 } }), []);
  assert.deepEqual(R.auditBanners({ failed: { status: 502 } }, { failed: { status: 0 } }).map((b) => b.id), ["readers.auditFailed"]);
  assert.deepEqual(R.auditBanners({}, {}), []);
});

test("a fix's Undo is the opposite call; problems are said by code", () => {
  assert.equal(R.fixOpposite("publish"), "unpublish");
  assert.equal(R.fixOpposite("unpublish"), "publish");
  assert.equal(R.fixOpposite("publish-decision"), "");
  assert.equal(R.extrasProblem({}, "answer").id, "readers.noSignal");
  assert.equal(R.extrasProblem({ status: 409 }, "answer").id, "readers.answerChanged");
  assert.equal(R.extrasProblem({ status: 422, data: { code: "note-refused" } }, "feature").id, "readers.noteRefused");
  assert.equal(R.extrasProblem({ status: 409, data: { code: "already-linked" } }, "link").id, "readers.alreadyLinked");
  assert.equal(R.extrasProblem({ status: 409 }, "decide").id, "readers.decideChanged");
  assert.equal(R.extrasProblem({ status: 409, data: { code: "parent-unavailable" } }, "answerAs").id, "readers.answerAsGone");
  for (const problem of [{ id: "readers.changeLong", vars: { max: 200 } }, { id: "readers.decideNeedConfirm" }, { id: "nope" }]) assert.ok(R.noteWords(problem).length > 5);
});

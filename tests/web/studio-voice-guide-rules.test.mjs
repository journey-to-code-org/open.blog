// Your voice guide's rules (Studio R9). Ports the old Admin's admin-assistant-voice guide cases
// (diff lines, the save request, portable blocked, private first, assemble only when decided,
// check notes) and adds R9's: the pieces ticked for her stay inside the budget and prefer rough
// drafts, her Save never writes portable when it mustn't, and what goes is computed from her ticks.
import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDE_BUDGET, defaultGuidePieces, guideBudget, guideContent, guideHasNews, guidePieces, guideProblem, guideSaveTarget, guideSelection, guideWhatGoes, sampleContextId,
  voiceGuideAssemble, voiceGuideCheckNote, voiceGuideDiffLines, voiceGuidePendingChanges, voiceGuidePortableNote, voiceGuideSaveRequest, voiceGuideTraitParts,
} from "../../web/studio/parts/voice-guide-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";

const sample = (file, stage, date, over = {}) => ({ valid: true, visibility: "private", file, id: file.replace(/\.md$/, ""), stage, date, words: 100, promptTitle: "A mistake I made", ...over });
const piece = (id, stage, characters, date = "2026-11-01T09:00:00Z") => ({ id, title: id, stage, words: Math.round(characters / 6), characters, date });

test("a diff is classified line by line and never relies on colour alone", () => {
  const lines = voiceGuideDiffLines("--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same\n");
  assert.deepEqual(lines.map((l) => l.kind), ["header", "header", "header", "remove", "add", "context"]);
  assert.ok(lines.every((l) => l.text.length > 0), "each line keeps its own + or -");
  assert.deepEqual(voiceGuideDiffLines(""), []);
});

test("a save carries the revision the proposal was made against and an explicit place", () => {
  const proposal = { portableAllowed: true, targets: { portable: { exists: true, valid: true, etag: "abc" }, private: { exists: false, valid: true, etag: null } } };
  assert.deepEqual(voiceGuideSaveRequest(proposal, "portable", "# Voice\n"), { contextType: "voice", visibility: "portable", content: "# Voice\n", etag: "abc" });
  assert.deepEqual(voiceGuideSaveRequest(proposal, "private", "# Voice\n"), { contextType: "voice", visibility: "private", content: "# Voice\n", etag: null });
  assert.equal(voiceGuideSaveRequest(proposal, "elsewhere", "x"), null);
  assert.equal(voiceGuideSaveRequest(proposal, "private", "   "), null, "an empty guide is never saved");
  assert.equal(voiceGuideSaveRequest({ ...proposal, targets: { ...proposal.targets, private: { valid: false } } }, "private", "x"), null);
  assert.equal(voiceGuideSaveRequest({}, "private", "x"), null);
});

test("a guide quoting private pieces can't be saved as portable, and says why", () => {
  configureWords();
  const proposal = { portableAllowed: false, targets: { portable: { exists: false, valid: true }, private: { exists: false, valid: true } } };
  assert.equal(voiceGuideSaveRequest(proposal, "portable", "x"), null);
  assert.ok(voiceGuideSaveRequest(proposal, "private", "x"));
  assert.equal(voiceGuidePortableNote(proposal), "It quotes private pieces, so it can only be kept private.");
  assert.equal(voiceGuidePortableNote({ portableAllowed: true }), "");
});

test("her Save writes where the guide already is, or private; never portable when it mustn't", () => {
  const targets = { portable: { valid: true, exists: true }, private: { valid: true, exists: false } };
  assert.equal(guideSaveTarget({ current: { exists: false }, targets }), "private", "no guide yet: private");
  assert.equal(guideSaveTarget({ current: { exists: true, visibility: "private" }, targets }), "private");
  assert.equal(guideSaveTarget({ current: { exists: true, visibility: "portable" }, portableAllowed: true, targets }), "portable");
  assert.equal(guideSaveTarget({ current: { exists: true, visibility: "portable" }, portableAllowed: false, targets }), "private", "it quotes private pieces now");
  assert.equal(guideSaveTarget({ current: { exists: true, visibility: "portable" }, portableAllowed: true, targets: { portable: { valid: false } } }), "private", "the portable file can't be used");
  assert.equal(guideSaveTarget({}), "private");
  // Whatever the proposal says, a blocked portable is never the answer.
  for (const visibility of ["portable", "private", undefined]) for (const exists of [true, false]) {
    assert.notEqual(guideSaveTarget({ current: { exists, visibility }, portableAllowed: false, targets }), "portable");
  }
});

test("a merged guide is joined only once every change is chosen, from the server's own lines", () => {
  const lines = ["# Voice", "", { change: 0, current: "- old one", proposed: "- new one" }, "- kept", { change: 1, current: "- a", proposed: "- b" }];
  assert.equal(voiceGuideAssemble(lines, {}), null);
  assert.equal(voiceGuideAssemble(lines, { 0: "current" }), null, "one left");
  assert.equal(voiceGuideAssemble(lines, { 0: "current", 1: "proposed" }), "# Voice\n\n- old one\n- kept\n- b\n");
  assert.equal(voiceGuideAssemble(lines, { 0: "something", 1: "proposed" }), null, "only the two choices count");
  assert.equal(voiceGuideAssemble(["a", "b"], {}), "a\nb\n");
  assert.equal(voiceGuidePendingChanges({ changes: 2 }, {}), 2);
  assert.equal(voiceGuidePendingChanges({ changes: 2 }, { 0: "current" }), 1);
  assert.equal(voiceGuidePendingChanges({ changes: 2 }, { 0: "current", 1: "proposed" }), 0);
  assert.equal(voiceGuidePendingChanges({}, {}), 0);
});

test("hand edits win; with none, her choices are joined; with nothing to choose, the proposal as written", () => {
  const proposal = { markdown: null, merge: { changes: 1, lines: ["# V", { change: 0, current: "- a", proposed: "- b" }] } };
  assert.equal(guideContent(proposal, {}), null, "not until she has chosen");
  assert.equal(guideContent(proposal, { 0: "proposed" }), "# V\n- b\n");
  assert.equal(guideContent(proposal, { 0: "proposed" }, "# Mine\n"), "# Mine\n");
  assert.equal(guideContent({ markdown: "# V\n" }, {}), "# V\n");
  assert.equal(guideContent({}, {}), null);
});

test("a trait is parts placed as text, and a kept trait's quote check is explained", () => {
  configureWords();
  assert.deepEqual(voiceGuideTraitParts({ statement: "You open with a question", quote: "Ever burn a crust?", sample: "2026-10-20-a-rough.md", oneSample: true }),
    { statement: "You open with a question", quote: "Ever burn a crust?", piece: "2026-10-20-a-rough.md", oneSample: true });
  assert.deepEqual(voiceGuideTraitParts({ statement: "<b>x</b>" }), { statement: "<b>x</b>", quote: "", piece: "", oneSample: false }, "markup is only ever text");
  assert.equal(voiceGuideCheckNote("sample-missing"), "The piece this quotes is gone, so it couldn't be checked. It's kept.");
  assert.equal(voiceGuideCheckNote("not-in-sample"), "These words aren't in that piece any more. It's kept; check it.");
  assert.equal(voiceGuideCheckNote("ok"), "");
  assert.equal(voiceGuideCheckNote(undefined), "");
});

test("the pieces she may learn from: readable ones, newest first, rough before polished of the same day", () => {
  const samples = [
    sample("2026-10-20-a-polished.md", "polished", "2026-10-20T09:05:00Z"), sample("2026-10-20-a-rough.md", "rough", "2026-10-20T09:00:00Z"),
    sample("2026-10-22-b-rough.md", "rough", "2026-10-22T09:00:00Z", { visibility: "portable", promptTitle: "", title: "Typed title" }),
    { ...sample("2026-10-23-c-rough.md", "rough", "2026-10-23T09:00:00Z"), valid: false },
  ];
  const catalog = { voiceSamples: [{ id: "voice:private:2026-10-20-a-rough.md", characters: 1234 }] };
  const pieces = guidePieces(samples, catalog);
  assert.deepEqual(pieces.map((p) => p.id), ["voice:portable:2026-10-22-b-rough.md", "voice:private:2026-10-20-a-rough.md", "voice:private:2026-10-20-a-polished.md"]);
  assert.equal(pieces[1].characters, 1234, "the catalog's count of letters");
  assert.equal(pieces[0].characters, 600, "guessed from the words until the catalog answers");
  assert.equal(pieces[0].title, "Typed title");
  assert.equal(sampleContextId({ visibility: "private", file: "x.md" }), "voice:private:x.md");
  assert.deepEqual(guidePieces(), []);
});

test("the pieces ticked for her never exceed 8 or 120,000 letters, and prefer rough drafts", () => {
  assert.deepEqual(GUIDE_BUDGET, { samples: 8, characters: 120_000 });
  const many = [...Array.from({ length: 6 }, (_, i) => piece(`p${i}`, "polished", 1000)), ...Array.from({ length: 6 }, (_, i) => piece(`r${i}`, "rough", 1000))];
  const ticked = defaultGuidePieces(many);
  assert.equal(ticked.length, 8);
  assert.deepEqual(ticked.slice(0, 6), ["r0", "r1", "r2", "r3", "r4", "r5"], "every rough draft before any polished copy");
  const big = [piece("r-big", "rough", 119_000), piece("r-next", "rough", 2_000), piece("r-small", "rough", 900), piece("p", "polished", 500)];
  assert.deepEqual(defaultGuidePieces(big), ["r-big", "r-small"], "one that would pass the limit is skipped, a smaller one still fits");
  for (let seed = 1; seed < 60; seed += 1) {
    const pieces = Array.from({ length: seed % 14 }, (_, i) => piece(`x${i}`, i % 3 ? "rough" : "polished", ((seed * 7919 + i * 104729) % 70_000) + 1));
    const picked = pieces.filter((p) => defaultGuidePieces(pieces).includes(p.id));
    assert.ok(picked.length <= 8, `seed ${seed}: at most 8`);
    assert.ok(picked.reduce((sum, p) => sum + p.characters, 0) <= 120_000, `seed ${seed}: at most 120,000 letters`);
  }
  assert.deepEqual(defaultGuidePieces([]), []);
  assert.deepEqual(guideBudget({ voiceBudget: { samples: 4, characters: 1000 } }), { samples: 4, characters: 1000 });
  assert.deepEqual(guideBudget({}), { samples: 8, characters: 120_000 });
  assert.deepEqual(defaultGuidePieces(many, { samples: 2, characters: 120_000 }), ["r0", "r1"]);
});

test("her ticks are checked against the budget before anything is asked", () => {
  const pieces = [piece("a", "rough", 60_000), piece("b", "rough", 60_000), piece("c", "polished", 600)];
  assert.deepEqual(guideSelection(pieces, []), { ids: [], count: 0, words: 0, characters: 0, over: false, none: true });
  assert.equal(guideSelection(pieces, ["a", "b"]).over, false);
  assert.equal(guideSelection(pieces, ["a", "b", "c"]).over, true, "over the letters");
  const nine = Array.from({ length: 9 }, (_, i) => piece(`n${i}`, "rough", 10));
  assert.equal(guideSelection(nine, nine.map((p) => p.id)).over, true, "over the count");
  assert.deepEqual(guideSelection(pieces, ["c", "ghost"]).ids, ["c"], "only pieces that exist are sent");
});

test("what goes is computed from her ticks only, names the company, and lists the guide only when one exists", () => {
  configureWords();
  const selection = guideSelection([piece("a", "rough", 6000), piece("b", "rough", 5040)], ["a", "b"]);
  assert.deepEqual(guideWhatGoes(selection, true, "Anthropic"), {
    heading: "What goes to Anthropic",
    lines: ["The pieces you ticked, about 1,840 words", "Your voice guide as it is now"],
    never: "Not your posts, photos, or anything about your readers. Anthropic's own rules cover what it keeps.",
  });
  assert.deepEqual(guideWhatGoes(selection, false, "OpenAI").lines, ["The pieces you ticked, about 1,840 words"]);
});

test("a proposal with nothing new says so, and the guide's own refusals have her words", () => {
  configureWords();
  const same = { current: { exists: true }, merge: { changes: 0, sections: [{ heading: "h", traits: [{ status: "unchanged" }, { status: "kept" }] }], unknown: [{ status: "kept" }] } };
  assert.equal(guideHasNews(same), false);
  assert.equal(guideHasNews({ ...same, merge: { ...same.merge, changes: 1 } }), true);
  assert.equal(guideHasNews({ ...same, merge: { ...same.merge, sections: [{ traits: [{ status: "added" }] }] } }), true);
  assert.equal(guideHasNews({ current: { exists: false }, merge: { changes: 0 } }), true, "a first guide is all news");
  assert.equal(guideProblem({ status: 400, data: { code: "too-many" } }), "That's more than your helper reads at once. Untick a few.");
  assert.equal(guideProblem({ status: 400, data: { code: "over-budget" } }), "That's more than your helper reads at once. Untick a few.");
  assert.equal(guideProblem({ status: 400, data: { code: "no-pieces" } }), "Tick at least one piece.");
  assert.equal(guideProblem({ status: 409, data: { error: "The voice-guide skill cannot be used" } }), "Your helper can't make a voice guide right now.");
  assert.equal(guideProblem({ status: 502, data: { code: "provider-down" } }), "", "a helper problem is R8's to say");
});

// Studio ONB1.7.4: My stories. Which pieces are stories, in what order, and what a row says.
import test from "node:test";
import assert from "node:assert/strict";
import { STORY_SETS, marksAfter, opening, polishedOf, storiesFrom, storyTitle } from "../../web/studio/parts/story-list-rules.js";

const piece = (id, extra = {}) => ({ id, file: `${id}.md`, valid: true, stage: "rough", pack: "craft", date: "2026-11-01", words: 100, ...extra });

test("stories are rough pieces from the story sets, or marked by her", () => {
  const samples = [
    piece("a", { pack: "stories", date: "2026-11-03" }),
    piece("b", { pack: "people", date: "2026-11-05" }),
    piece("c", { pack: "getting-started", date: "2026-11-04" }),
    piece("d", { pack: "craft" }),
    piece("e", { pack: "opinions" }),
    piece("f", { pack: "stories", stage: "polished", roughOf: "a.md" }),
    piece("g", { pack: "stories", valid: false }),
    piece("h", { pack: "stories", by: "someone-else" }),
  ];
  const { stories, others } = storiesFrom(samples, ["e"], "grammi");
  assert.deepEqual(stories.map((s) => s.id), ["b", "c", "a", "e"], "newest first");
  assert.equal(stories.find((s) => s.id === "e").marked, true);
  assert.equal(stories.find((s) => s.id === "a").marked, false);
  assert.deepEqual(others.map((s) => s.id), ["d"]);
  assert.deepEqual(STORY_SETS, ["stories", "people", "getting-started"]);
  assert.deepEqual(storiesFrom(null, null, "").stories, []);
});

test("a row's words", () => {
  assert.equal(storyTitle({ promptTitle: "A mistake I made", title: "x" }), "A mistake I made");
  assert.equal(storyTitle({ title: "Mine" }), "Mine");
  assert.equal(opening("It was   the first\nThanksgiving we hosted, and nobody told me how big a turkey really gets.", 6), "It was the first Thanksgiving we…");
  assert.equal(opening("Short one."), "Short one.");
  assert.equal(opening(""), "");
});

test("the polished copy of a story, and marks", () => {
  const samples = [piece("a"), piece("a-p", { stage: "polished", roughOf: "a.md" })];
  assert.equal(polishedOf(samples, samples[0]).id, "a-p");
  assert.equal(polishedOf(samples, piece("z")), null);
  assert.deepEqual(marksAfter(["x"], "y", true), ["x", "y"]);
  assert.deepEqual(marksAfter(["x", "y"], "x", false), ["y"]);
  assert.deepEqual(marksAfter(["x"], "x", true), ["x"]);
});

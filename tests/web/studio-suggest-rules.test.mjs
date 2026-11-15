// Suggestions as she types (Studio R8). Ports the old Admin's admin-assistant-autocomplete rules
// (a bounded request, a response dropped after the words, the caret, the title, the details or the
// notes changed) in their Studio form, and adds where it never asks: titles, rows, cards, and
// under twelve letters.
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_FAILURES, MAX_POST, MAX_SIDE, MIN_PREFIX, PAUSE_MS, captureIsCurrent, captureKey, completionRequest, insertCompletion, plainCompletion, shouldSuggest } from "../../web/studio/parts/suggest-rules.js";

const here = (more = {}) => ({ kind: "words", prefix: "The crust wants cold butter", suffix: "", body: "The crust wants cold butter", online: true, busy: false, ...more });

test("it waits the old Admin's pause and gives up after three failures", () => {
  assert.equal(PAUSE_MS, 850);
  assert.equal(MIN_PREFIX, 12);
  assert.equal(MAX_FAILURES, 3);
});

test("a pause asks only in a box of her words, with enough written before the caret", () => {
  assert.deepEqual(shouldSuggest(here()), { ask: true, why: "" });
  for (const kind of ["story", "notes", "problem", "found", "did", "result"]) assert.equal(shouldSuggest(here({ kind })).ask, true, kind);
  // Never in a title, a summary, a row of a recipe, or anything that isn't a box of her words.
  for (const kind of ["title", "summary", "ingredient", "step", "", undefined]) assert.deepEqual(shouldSuggest(here({ kind })), { ask: false, why: "place" }, String(kind));
  assert.deepEqual(shouldSuggest(here({ inCard: true })), { ask: false, why: "place" });
  assert.deepEqual(shouldSuggest(here({ prefix: "Cold butter" })), { ask: false, why: "short" }, "eleven letters");
  assert.deepEqual(shouldSuggest(here({ prefix: "   Cold butter   " })), { ask: false, why: "short" }, "spaces don't count");
  assert.equal(shouldSuggest(here({ prefix: "Cold butter." })).ask, true, "twelve");
  assert.deepEqual(shouldSuggest(here({ selecting: true })), { ask: false, why: "selecting" });
  assert.deepEqual(shouldSuggest(here({ body: "x".repeat(MAX_POST + 1) })), { ask: false, why: "long" });
  assert.equal(shouldSuggest(here({ body: "x".repeat(MAX_POST) })).ask, true);
  assert.deepEqual(shouldSuggest(here({ online: false })), { ask: false, why: "signal" });
  assert.deepEqual(shouldSuggest(here({ busy: true })), { ask: false, why: "busy" }, "one request at a time: a newer pause waits");
});

test("the request carries her unsaved words, bounded on each side of the caret, and never where she was", () => {
  const form = { title: "Pie", body: "Story.\n\nThe crust wants cold butter", fields: { tags: ["pie"], trackToken: "tok-1", routeShape: "0,0", _mine: 1 } };
  const request = completionRequest({ prefix: "The crust wants cold butter", suffix: " and a light hand." }, form, ["private:author", "private:author"]);
  assert.deepEqual(request, {
    source: { title: "Pie", metadata: { tags: ["pie"] }, markdown: form.body, prefix: "The crust wants cold butter", suffix: " and a light hand.", editorMode: "markdown" },
    contextIds: ["private:author"],
  });
  const long = completionRequest({ prefix: `${"a".repeat(MAX_SIDE)}🏮END`, suffix: `START🏮${"b".repeat(MAX_SIDE)}` }, form, []);
  assert.equal(Array.from(long.source.prefix).length, MAX_SIDE);
  assert.equal(long.source.prefix.endsWith("🏮END"), true, "the words nearest her caret are the ones kept");
  assert.equal(Array.from(long.source.suffix).length, MAX_SIDE);
  assert.equal(long.source.suffix.startsWith("START🏮"), true);
});

test("an answer is dropped once anything it was asked for has changed", () => {
  const form = { title: "Pie", body: "Body", fields: { tags: ["a"] } };
  const capture = { box: 0, at: 4, prefix: "Body", suffix: "" };
  const asked = captureKey(capture, form, ["private:author"]);
  assert.equal(captureIsCurrent(asked, captureKey(capture, form, ["private:author"])), true);
  assert.equal(captureIsCurrent(asked, captureKey({ ...capture, prefix: "Body!", at: 5 }, form, ["private:author"])), false, "she typed");
  assert.equal(captureIsCurrent(asked, captureKey({ ...capture, at: 2, prefix: "Bo", suffix: "dy" }, form, ["private:author"])), false, "she moved the caret");
  assert.equal(captureIsCurrent(asked, captureKey({ ...capture, box: 1 }, form, ["private:author"])), false, "another box");
  assert.equal(captureIsCurrent(asked, captureKey(capture, { ...form, title: "Pies" }, ["private:author"])), false, "the title");
  assert.equal(captureIsCurrent(asked, captureKey(capture, { ...form, fields: { tags: ["b"] } }, ["private:author"])), false, "the details");
  assert.equal(captureIsCurrent(asked, captureKey(capture, form, [])), false, "the notes");
  assert.equal(captureIsCurrent(asked, ""), false, "she left her words");
  assert.equal(captureIsCurrent("", ""), false, "nothing was captured");
  // Where she was changing doesn't count: it was never sent.
  assert.equal(captureIsCurrent(asked, captureKey(capture, { ...form, fields: { tags: ["a"], trackToken: "new" } }, ["private:author"])), true);
});

test("suggested words are made plain before they are shown or go in", () => {
  assert.equal(plainCompletion(" and a light hand."), " and a light hand.");
  assert.equal(plainCompletion("and so on\u0000‮​  "), "and so on");
  assert.equal(plainCompletion("first line\nsecond line\n\nanother paragraph"), "first line second line", "one paragraph");
  for (const bad of ["# A heading", "- a list", "1. a list", "> a quote", "```js\ncode\n```", "<script>alert(1)</script>", "a <b>bold</b> word", "see [this](https://evil.example)", "![x](y)", "| a | b |", "use `code`"]) {
    assert.equal(plainCompletion(bad), "", bad);
  }
  assert.equal(Array.from(plainCompletion("x".repeat(900))).length, 400);
  assert.equal(plainCompletion(null), "");
  assert.equal(plainCompletion({ completion: "x" }), "", "only text is text");
});

test("the words go in at her caret, with one space and no more", () => {
  assert.deepEqual(insertCompletion("Cold butter", 11, "and a light hand."), { text: "Cold butter and a light hand.", at: 29 });
  assert.deepEqual(insertCompletion("Cold butter ", 12, " and a light hand."), { text: "Cold butter and a light hand.", at: 29 });
  assert.deepEqual(insertCompletion("Cold butter", 11, ", always."), { text: "Cold butter, always.", at: 20 });
  assert.deepEqual(insertCompletion("Cold  here", 5, "butter"), { text: "Cold butter here", at: 11 }, "in the middle of her words");
  assert.deepEqual(insertCompletion("", 0, "Start"), { text: "Start", at: 5 });
  assert.deepEqual(insertCompletion("abc", 99, "d").text, "abc d");
});

test("a suggestion that starts a new paragraph is only its first words", () => {
  assert.equal(plainCompletion("\n\nNext comes the filling."), "Next comes the filling.");
});

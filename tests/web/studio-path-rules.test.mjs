import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  basisChoices, difficultyWords, diagnosticWords, errorWords, fieldProblem, followedIndex, heldReasons, listLine, localProblems,
  moveChoices, moveKey, moveTo, newStep, notShown, pathDraft, pathPayload, pathProblem, pathSame, problemWords, relationshipChoices,
  relationshipWords, savedWords, saveWords, stateFor, stateKey, stateWords, stepId, stepTitle, suggestAddress, targetKey,
} from "../../web/studio/parts/path-rules.js";

// The editor's model, against the golden file the Rust contract tests round-trip byte for byte
// (crates/openblog-core/tests/fixtures/reading-path.json): one fixture, both sides.
const golden = JSON.parse(readFileSync(new URL("../../crates/openblog-core/tests/fixtures/reading-path.json", import.meta.url), "utf8"));
const RELATIONSHIPS = ["next", "background", "builds-on", "contrasts-with", "responds-to", "applies", "influenced"];
const without = (file) => {
  const { format: _format, version: _version, ...rest } = file;
  return rest;
};
const order = (steps) => steps.map((step) => step.id);

test("the golden file survives the editor model unchanged, unknown fields included", () => {
  const draft = pathDraft(golden, "golden");
  assert.equal(draft.slug, "golden");
  assert.deepEqual(pathPayload(draft), without(golden));
  assert.ok(pathSame(draft, pathDraft(pathPayload(draft), "golden")));
  assert.deepEqual(draft["x-future"], { kept: [1, 2] });
});

test("empty optional fields are left out and listed defaults are not written", () => {
  const draft = pathDraft(golden, "g");
  draft.summary = "   ";
  draft.listed = true;
  draft.steps[0].rationale = "";
  draft.steps[0].difficulty = "";
  draft.steps[1].transition.basis = "stale";
  const payload = pathPayload(draft);
  assert.equal("summary" in payload, false);
  assert.equal("listed" in payload, false);
  assert.equal("rationale" in payload.steps[0], false);
  assert.equal("difficulty" in payload.steps[0], false);
  assert.equal("basis" in payload.steps[1].transition, false, "a basis belongs to influenced alone");
  draft.listed = false;
  assert.equal(pathPayload(draft).listed, false);
});

test("a step that moves to the front keeps its reason in memory but the file never carries it", () => {
  const draft = pathDraft(golden, "g");
  const moved = moveTo(draft.steps, 1, 0);
  assert.equal(moved.index, 0);
  draft.steps = moved.steps;
  assert.equal(draft.steps[0].id, "plato");
  assert.equal(draft.steps[0].transition.why, "The first step assumes some knowledge of the man who wrote the image.");
  assert.equal("transition" in pathPayload(draft).steps[0], false);
  // Save will ask: this step holds a reason the file cannot carry.
  assert.deepEqual(order(heldReasons(draft)), ["plato"]);
  // The step that moved down now follows something and needs words of its own.
  assert.ok(localProblems(draft, RELATIONSHIPS).some((p) => p.step === "cave" && p.code === "needs-relationship"));
  // Moving back restores it exactly, and nothing is held any more.
  draft.steps = moveTo(draft.steps, 0, 1).steps;
  assert.equal(pathPayload(draft).steps[1].transition.why, golden.steps[1].transition.why);
  assert.deepEqual(heldReasons(draft), []);
});

test("moving clamps, never loses or duplicates a step and never reorders on a no-op", () => {
  const steps = ["a", "b", "c"].map((id) => ({ id }));
  assert.deepEqual(order(moveTo(steps, 2, 0).steps), ["c", "a", "b"]);
  assert.deepEqual(order(moveTo(steps, 0, 99).steps), ["b", "c", "a"]);
  assert.deepEqual(order(moveTo(steps, 1, -5).steps), ["b", "a", "c"]);
  assert.equal(moveTo(steps, 1, 1).steps, steps);
  assert.equal(moveTo(steps, 7, 0).steps, steps);
  for (let from = 0; from < 3; from += 1) for (let to = -1; to < 5; to += 1) {
    assert.deepEqual(order(moveTo(steps, from, to).steps).sort(), ["a", "b", "c"], `${from} to ${to}`);
  }
});

test("the move keys are Alt+Shift+arrows, Home and End, and nothing else", () => {
  const key = (name, extra = {}) => moveKey({ key: name, altKey: true, shiftKey: true, ...extra }, 2, 5);
  assert.equal(key("ArrowUp"), 1);
  assert.equal(key("ArrowDown"), 3);
  assert.equal(key("Home"), 0);
  assert.equal(key("End"), 4);
  assert.equal(moveKey({ key: "ArrowUp", altKey: true, shiftKey: true }, 0, 5), 0, "clamped at the start");
  assert.equal(moveKey({ key: "ArrowDown", altKey: true, shiftKey: true }, 4, 5), 4, "clamped at the end");
  assert.equal(moveKey({ key: "ArrowUp", altKey: true }, 2, 5), null);
  assert.equal(moveKey({ key: "ArrowUp", shiftKey: true }, 2, 5), null);
  assert.equal(key("ArrowUp", { ctrlKey: true }), null);
  assert.equal(key("a"), null);
  assert.deepEqual(moveChoices(0, 3).map((c) => c.value), ["down", "last"]);
  assert.deepEqual(moveChoices(1, 3).map((c) => c.value), ["first", "up", "down", "last"]);
  assert.deepEqual(moveChoices(2, 3).map((c) => c.value), ["first", "up"]);
  assert.deepEqual(moveChoices(0, 1), []);
});

test("a step follows the nearest earlier step that is not optional", () => {
  const steps = [{ optional: false }, { optional: true }, { optional: true }, { optional: false }];
  assert.equal(followedIndex(steps, 0), -1);
  assert.equal(followedIndex(steps, 1), 0);
  assert.equal(followedIndex(steps, 2), 0);
  assert.equal(followedIndex(steps, 3), 0);
});

test("new steps get unique plain ids and start without words, so she writes them", () => {
  const steps = [];
  const one = newStep(steps, "post", "The Cave!");
  assert.equal(one.id, "the-cave");
  assert.deepEqual(one.target, { kind: "post", slug: "The Cave!" });
  assert.deepEqual(one.transition, { relationship: "", why: "" });
  steps.push(one);
  assert.equal(stepId(steps, "post", "the cave"), "the-cave-2");
  assert.equal(newStep(steps, "atlas", "plato").target.kind, "atlas");
  assert.equal(stepId([], "post", "日本語"), "post");
  assert.ok(stepId([], "post", "x".repeat(200)).length <= 64);
  assert.equal(targetKey(one), "post:The Cave!");
  assert.equal(targetKey(newStep([], "atlas", "plato")), "atlas:plato");
});

test("the address is suggested from the title, never collides and is at most 64 letters", () => {
  assert.equal(suggestAddress("Start here: the cave!"), "start-here-the-cave");
  assert.equal(suggestAddress("Start here", ["start-here"]), "start-here-2");
  assert.equal(suggestAddress("Start here", ["start-here", "start-here-2"]), "start-here-3");
  assert.equal(suggestAddress("日本語"), "reading-path");
  assert.equal(suggestAddress(""), "reading-path");
  assert.ok(suggestAddress("x".repeat(300), []).length <= 64);
  const taken = ["x".repeat(56)];
  const next = suggestAddress("x".repeat(300), taken);
  assert.ok(next.length <= 64 && !taken.includes(next));
});

test("influence is offered only between two atlas entries, with the links that join them", () => {
  const atlas = (id) => ({ id, target: { kind: "atlas", id } });
  const post = (id) => ({ id, target: { kind: "post", slug: id } });
  assert.ok(relationshipChoices([atlas("plato"), atlas("stoics")], 1, RELATIONSHIPS).includes("influenced"));
  assert.ok(!relationshipChoices([post("a"), atlas("stoics")], 1, RELATIONSHIPS).includes("influenced"));
  assert.ok(!relationshipChoices([atlas("plato"), post("b")], 1, RELATIONSHIPS).includes("influenced"));
  const links = [{ id: "r1", from: "plato", to: "stoics" }, { id: "r2", from: "stoics", to: "plato" }, { id: "r3", from: "plato", to: "other" }];
  assert.deepEqual(basisChoices([atlas("plato"), atlas("stoics")], 1, links).map((l) => l.id), ["r1"]);
  assert.deepEqual(basisChoices([post("a"), atlas("stoics")], 1, links), []);
  // A side step in between does not change what the entry follows.
  const side = { ...atlas("side"), optional: true };
  assert.deepEqual(basisChoices([atlas("plato"), side, atlas("stoics")], 2, links).map((l) => l.id), ["r1"]);
});

test("problems the server would refuse are found before sending, scoped to the step", () => {
  const draft = pathDraft(golden, "golden");
  assert.deepEqual(localProblems(draft, RELATIONSHIPS), []);
  draft.title = " ";
  draft.steps[1].transition.why = "";
  draft.steps[2].transition.relationship = "";
  draft.steps[0].optional = true;
  const found = localProblems(draft, RELATIONSHIPS);
  assert.ok(found.some((p) => p.step === null && p.field === "title" && p.code === "required"));
  assert.ok(found.some((p) => p.step === "plato" && p.code === "needs-reason"));
  assert.ok(found.some((p) => p.step === "stoics" && p.code === "needs-relationship"));
  assert.ok(found.some((p) => p.step === "cave" && p.code === "first-optional"));
  const posts = pathDraft({ title: "T", steps: [{ id: "a", target: { kind: "post", slug: "a" } }, { id: "b", target: { kind: "post", slug: "b" }, transition: { relationship: "influenced", why: "w" } }] }, "t");
  const codes = localProblems(posts, RELATIONSHIPS).map((p) => p.code);
  assert.ok(codes.includes("influence-needs-atlas") && codes.includes("influence-needs-basis"));
  const twice = pathDraft({ title: "T", steps: [{ id: "a", target: { kind: "post", slug: "x" } }, { id: "b", target: { kind: "post", slug: "x" }, transition: { relationship: "next", why: "w" } }] }, "Bad Slug");
  const both = localProblems(twice, RELATIONSHIPS).map((p) => p.code);
  assert.ok(both.includes("repeat-target") && both.includes("bad-address"));
});

test("step states are keys with a plain word each, and an unpublished step says readers won't see it", () => {
  assert.deepEqual(stateKey({ state: "published" }), { key: "published", published: true });
  for (const state of ["draft", "scheduled", "missing", "unpublished"]) {
    const info = stateKey({ state });
    assert.equal(info.published, false, state);
    assert.match(stateWords(info.key), /won't see this step/, state);
  }
  assert.equal(stateKey(undefined).published, null);
  assert.equal(stateFor([{ id: "a", state: "draft" }], "a").state, "draft");
  assert.equal(stateFor([], "a"), null);
  assert.equal(stepTitle({ target: { kind: "post", slug: "x" } }, { title: "The cave" }, null), "The cave");
  assert.equal(stepTitle({ target: { kind: "post", slug: "x" } }, null, { posts: [{ slug: "x", title: "X post" }] }), "X post");
  assert.equal(stepTitle({ target: { kind: "atlas", id: "plato" } }, null, { entries: [{ id: "plato", label: "Plato" }] }), "Plato");
});

test("every code the server can send reads as a plain sentence, and an unknown one never goes silent", () => {
  const codes = ["required", "too-long", "bad-address", "exists", "too-many", "nothing-to-follow", "duplicate-id", "unknown-reference", "repeat-target",
    "first-optional", "first-has-reason", "needs-relationship", "needs-reason", "influence-needs-atlas", "influence-needs-basis", "bad-basis", "bad-value", "from-a-future-release"];
  const words = new Set();
  for (const code of codes) {
    const text = problemWords(code);
    assert.ok(text && !/[`{}]/.test(text), code);
    words.add(text);
  }
  assert.ok(words.size >= 17, "each code has its own words, the future one falls back");
  assert.notEqual(problemWords("nothing-to-follow", { field: "steps" }), problemWords("nothing-to-follow", { field: "" }), "a published path with one step says what's needed");
  for (const code of ["changed", "exists", "missing", "too-large", "storage", "bad-request", ""]) assert.ok(errorWords(code), code);
});

test("today's answers and tomorrow's codes both read: a conflict, a taken address, a refusal with problems", () => {
  assert.equal(pathProblem({ status: 409, data: { conflict: true, current: { revision: "r" } } }).code, "changed");
  assert.equal(pathProblem({ status: 409, data: { conflict: true, current: { revision: "r" } } }).conflict, true);
  assert.equal(pathProblem({ status: 409, data: { exists: true } }).code, "exists");
  assert.equal(pathProblem({ status: 404, data: { missing: true } }).code, "missing");
  const refused = pathProblem({ status: 422, data: { code: "invalid", error: "Plain", problems: [{ step: "two", code: "needs-reason", field: "why", text: "sentence" }, { message: "old shape" }] } });
  assert.equal(refused.code, "invalid");
  assert.deepEqual(refused.problems.map((p) => [p.step, p.field, p.code]), [["two", "why", "needs-reason"], [null, "", "bad-value"]]);
  assert.equal(refused.sentence, "Plain");
  assert.equal(pathProblem({ message: "boom" }).sentence, "boom");
  assert.equal(pathProblem({ status: 422, data: { problems: [] } }).code, "invalid");
  assert.equal(fieldProblem([{ step: null, field: "title", code: "too-long" }], "title"), "That title is too long.");
  assert.equal(fieldProblem([{ step: "a", field: "title", code: "required" }], "title"), "");
});

test("the list says what a path is and why readers can't see it", () => {
  assert.equal(listLine({ valid: false }), "Can't be read yet");
  assert.equal(listLine({ valid: true, status: "draft", steps: 2 }), "Draft · 2 steps");
  assert.equal(listLine({ valid: true, status: "published", steps: 1 }), "Published · 1 step");
  assert.equal(notShown({ valid: true, status: "published", shown: false }), true);
  assert.equal(notShown({ valid: true, status: "draft", shown: false }), false);
  assert.equal(notShown({ valid: true, status: "published", shown: true }), false);
});

test("the save button and what a save says follow what was asked and what readers can see", () => {
  assert.equal(saveWords(false, "draft"), "Save draft");
  assert.equal(saveWords(false, "published"), "Publish");
  assert.equal(saveWords(true, "published"), "Update");
  assert.match(savedWords({ wasPublished: false, status: "published", url: "/paths/x/", publish: true, shown: true }), /\/paths\/x\//);
  assert.match(savedWords({ wasPublished: false, status: "published", url: null, publish: false, shown: true }), /isn't showing reading paths/);
  assert.match(savedWords({ wasPublished: false, status: "published", url: null, publish: true, shown: false }), /a step isn't published/);
  assert.equal(savedWords({ wasPublished: true, status: "published", url: "/paths/x/", publish: true, shown: true }), "Updated.");
  assert.match(savedWords({ wasPublished: true, status: "draft" }), /draft again/);
  assert.match(savedWords({ wasPublished: false, status: "draft" }), /Saved as a draft/);
});

test("relationships, difficulties and reasons have her words, and a value from a newer release shows as written", () => {
  for (const value of RELATIONSHIPS) assert.notEqual(relationshipWords(value), value, value);
  assert.equal(relationshipWords("from-the-future"), "from-the-future");
  for (const value of ["introductory", "intermediate", "advanced"]) assert.ok(difficultyWords(value));
  for (const kind of ["StepUnavailable", "TransitionDropped", "PathWithheld", "x"]) assert.ok(diagnosticWords(kind));
});

// Stories told out loud (Studio R9b): whether anything can hear, what is said before she starts,
// the one record kept on the phone, and her words for each refusal.
import assert from "node:assert/strict";
import test from "node:test";

import { STORY_DB, STORY_MAX_BYTES, STORY_MAX_SECONDS, readRecording, recordingRecord, sayAvailable, sayGoes, spokenProblem, storyClock } from "../../web/studio/parts/story-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";

configureWords();

test("Say it out loud is offered only when something can hear", () => {
  // A helper whose company can't take audio, and no key that can hear.
  assert.equal(sayAvailable({ available: false, engine: "none" }), false);
  assert.equal(sayAvailable(null), false);
  assert.equal(sayAvailable({}), false);
  assert.equal(sayAvailable({ available: "yes" }), false);
  assert.equal(sayAvailable({ available: true, engine: "local", leavesServer: false }), true);
  assert.equal(sayAvailable({ available: true, engine: "hearing", company: "OpenAI" }), true);
});

test("before she starts: the company is named, or it says nothing leaves", () => {
  const local = sayGoes({ available: true, engine: "local", leavesServer: false });
  assert.equal(local.local, true);
  assert.equal(local.company, "");
  assert.ok(local.lines.length && local.heading);
  const company = sayGoes({ available: true, engine: "hearing", company: "OpenAI" });
  assert.equal(company.local, false);
  assert.equal(company.company, "OpenAI");
  assert.match(company.heading, /OpenAI/);
  assert.match(company.never, /OpenAI/);
  // A name that isn't one is never shown as given.
  assert.equal(sayGoes({ company: "<b>x</b>" }).company, "another company");
  assert.equal(sayGoes({}).company, "another company");
});

test("the kept recording has one shape; another version is ignored and never rewritten", () => {
  const blob = { type: "audio/webm", size: 10 };
  const record = recordingRecord({ promptId: "a-meal-you-love", seconds: 500, blob }, 1000);
  assert.deepEqual(record, { v: 1, promptId: "a-meal-you-love", type: "audio/webm", seconds: STORY_MAX_SECONDS, savedAt: 1000, blob });
  assert.equal(recordingRecord({ promptId: "", blob }), null);
  assert.equal(recordingRecord({ promptId: "x", blob: null }), null);
  assert.deepEqual(readRecording(record), record);
  const newer = Object.freeze({ v: 2, promptId: "x", blob, extra: true });
  assert.equal(readRecording(newer), null);
  assert.deepEqual(newer, { v: 2, promptId: "x", blob, extra: true }, "left exactly as it was");
  assert.equal(readRecording(null), null);
  assert.equal(readRecording({ v: 1, promptId: "x" }), null);
  assert.deepEqual(STORY_DB, { name: "studio-story", version: 1, store: "recording" });
  assert.equal(STORY_MAX_SECONDS, 180);
  assert.equal(STORY_MAX_BYTES, 12 * 1024 * 1024);
  assert.equal(storyClock(127), "2:07");
  assert.equal(storyClock(-4), "0:00");
});

test("every refusal has her words, and the recording is kept to try again", () => {
  const codes = ["empty-transcript", "too-large", "not-audio", "no-transcriber", "bad-prompt", "refused", "practice-only", "key-rejected", "provider-busy", "timeout"];
  for (const code of codes) {
    const problem = spokenProblem({ status: 422, data: { code, error: "the server's sentence" } });
    assert.ok(problem.words.length > 10, code);
    assert.equal(problem.keep, true, code);
    assert.equal(problem.details, "the server's sentence");
    assert.doesNotMatch(problem.words, /transcri|provider|server|error/i, code);
  }
  assert.equal(spokenProblem({ status: 409, data: { code: "no-transcriber" } }).gone, true);
  assert.equal(spokenProblem({ status: 409, data: { code: "not-configured" } }).code, "no-transcriber");
  assert.equal(spokenProblem({ status: 413 }).code, "too-large");
  assert.equal(spokenProblem({ status: 415 }).code, "not-audio");
  assert.deepEqual([spokenProblem({ status: 0 }).code, spokenProblem({ status: 0 }).signal], ["no-signal", true]);
  assert.equal(spokenProblem({ status: 500 }).code, "other");
});

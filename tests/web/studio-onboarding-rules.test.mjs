// Getting started's rules (Studio R9b): which steps show, when it opens by itself, how the record
// moves, what the last screen says, and when the reminder in Write may show.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_OPEN_GAP_MS, NUDGE_GAP_DAYS, NUDGE_MAX, STORIES_ASKED, doneLines, homeCard, isNewPostRoute, keyNeedsHelper, modeLine, needsKey, neverSetUp, nextStep, nudgeAllowed, nudgeDue, previousStep,
  recordAfter, startDecision, startProblem, startSteps, stepName, stepNumber, stepRoute, storyProgress, storyRows,
} from "../../web/studio/parts/onboarding-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";

configureWords();
const env = { configured: true, credential: { state: "environment" }, providerType: "anthropic" };
const saved = { configured: true, credential: { state: "saved" }, providerType: "anthropic" };
const none = { configured: false, credential: { state: "not-set" }, providerType: "anthropic" };
const other = { configured: false, credential: { state: "other-provider" }, providerType: "openai" };
const custom = { configured: false, credential: { state: "not-set" }, providerType: "custom-https", reason: "no-endpoint" };

test("the key step shows only when the site has no usable key", () => {
  assert.equal(needsKey(env), false);
  assert.equal(needsKey(saved), false);
  assert.equal(needsKey(none), true);
  assert.equal(needsKey(other), true);
  assert.deepEqual(startSteps(env, { stories: 0 }).steps, ["stories", "voice"]);
  assert.equal(startSteps(env).states.helper, "not-needed");
  assert.deepEqual(startSteps(saved).steps, ["stories", "voice"]);
  assert.deepEqual(startSteps(none).steps, ["helper", "stories", "voice"]);
  assert.deepEqual(startSteps(other).steps, ["helper", "stories", "voice"]);
  assert.equal(startSteps(custom).total, 3);
  assert.equal(keyNeedsHelper(custom), true, "a custom address can't be set up by pasting a key");
  assert.equal(keyNeedsHelper(none), false);
  // A new site says "custom, no address": nobody chose that, so she gets the default company.
  const untouched = { provider: "custom-https", generationEndpoint: "", model: "" };
  assert.equal(neverSetUp(untouched), true);
  assert.equal(keyNeedsHelper(custom, untouched), false);
  const chosen = { provider: "custom-https", generationEndpoint: "https://helper.example/v1", model: "m" };
  assert.equal(neverSetUp(chosen), false);
  assert.equal(keyNeedsHelper({ ...custom, reason: "" }, chosen), true, "an address someone chose is theirs to finish");
  assert.equal(neverSetUp({ provider: "anthropic", generationEndpoint: "" }), false);
  assert.equal(keyNeedsHelper({ ...none, reason: "bad-endpoint" }, { provider: "anthropic", generationEndpoint: "" }), true);
  assert.equal(neverSetUp(null), false);
});

test("the voice step isn't ready without a helper that is on, or without a story", () => {
  assert.equal(startSteps(env, { stories: 0 }).states.voice, "not-ready");
  assert.equal(startSteps(none, { stories: 2 }).states.voice, "not-ready");
  assert.equal(startSteps(env, { stories: 1 }).states.voice, "pending");
  assert.equal(startSteps(env, { stories: 1 }, { total: 2, steps: { voice: "done" } }).states.voice, "done");
});

test("the numbering is fixed when the run starts, and a step that isn't ready is passed over without renumbering", () => {
  // Started with no key (3 steps); the key was saved since: still 3, the first one done.
  const plan = startSteps(saved, { stories: 0 }, { total: 3, steps: {} });
  assert.equal(plan.total, 3);
  assert.equal(plan.states.helper, "done");
  assert.equal(stepNumber(plan, "stories"), 2);
  assert.equal(nextStep(plan, "stories"), "done", "voice isn't ready: straight to the end");
  assert.equal(previousStep(plan, "done"), "stories");
  assert.equal(previousStep(plan, "helper"), null);
  const ready = startSteps(saved, { stories: 1 }, { total: 3, steps: {} });
  assert.equal(nextStep(ready, "helper"), "stories");
  assert.equal(nextStep(ready, "stories"), "voice");
  assert.equal(nextStep(ready, "voice"), "done");
  assert.equal(previousStep(ready, "done"), "voice");
  assert.equal(stepNumber(ready, "done"), 0);
});

test("addresses and names of the steps", () => {
  assert.equal(stepRoute("helper"), "#/start/helper");
  assert.equal(stepRoute("done"), "#/start/done");
  assert.equal(stepRoute("../x"), "#/start");
  assert.equal(stepRoute("stories", "back=%23%2Fwrite"), "#/start/stories?back=%23%2Fwrite");
  assert.equal(stepName("helper"), "Turn on your writing helper");
  assert.equal(stepName("stories"), "Tell a few short stories");
  assert.equal(stepName("voice"), "Let your helper learn how you sound");
});

test("it opens by itself only on a fresh load that came to Home, when due", () => {
  const due = { mode: "on", practice: false, due: true, step: "stories", total: 2, resume: false };
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(startDecision(due, { name: "home", arg: "" }, now), "open");
  assert.equal(startDecision(due, {}, now), "open", "no address at all is Home");
  assert.equal(startDecision(due, { name: "home", arg: "" }, now, { fresh: false }), "none", "never from the copy kept for no signal");
  assert.equal(startDecision(due, { name: "comments", arg: "" }, now), "card", "a tapped notification opens what it says");
  assert.equal(startDecision(due, { name: "write", arg: "new" }, now), "card");
  assert.equal(startDecision({ ...due, due: false }, { name: "home" }, now), "none");
  assert.equal(startDecision({ mode: "off", due: false, resume: true }, { name: "home" }, now), "none", "off never shows by itself");
  assert.equal(startDecision({ mode: "on", due: false, resume: true }, { name: "home" }, now), "card");
  assert.equal(startDecision(null, { name: "home" }, now), "none");
});

test("after Finish later it waits 20 hours; a practice run opens every time", () => {
  const due = { mode: "on", practice: false, due: true, step: "stories", total: 2, resume: true };
  const now = Date.parse("2026-11-20T12:00:00Z");
  const at = (hours) => ({ lastAutoOpen: new Date(now - hours * 3600 * 1000).toISOString() });
  assert.equal(AUTO_OPEN_GAP_MS, 20 * 3600 * 1000);
  assert.equal(startDecision(due, { name: "home" }, now, { record: at(1) }), "card");
  assert.equal(startDecision(due, { name: "home" }, now, { record: at(19.9) }), "card");
  assert.equal(startDecision(due, { name: "home" }, now, { record: at(20) }), "open");
  assert.equal(startDecision(due, { name: "home" }, now, { record: { lastAutoOpen: "nonsense" } }), "open");
  assert.equal(startDecision({ ...due, mode: "rehearse", practice: true }, { name: "home" }, now, { record: at(1) }), "open");
});

test("Home's card names the step she left", () => {
  assert.equal(homeCard(null), null);
  assert.equal(homeCard({ mode: "off", due: false, resume: false }), null);
  assert.equal(homeCard({ mode: "on", due: false, resume: false }), null, "finished: no card");
  assert.deepEqual(homeCard({ mode: "on", due: true, resume: true, step: "stories", total: 3 }), { n: 2, total: 3, step: "stories", name: "Tell a few short stories" });
  assert.deepEqual(homeCard({ mode: "on", due: true, resume: false, step: "helper", total: 2 }), { n: 1, total: 2, step: "stories", name: "Tell a few short stories" });
  assert.equal(homeCard({ mode: "off", due: false, resume: true, step: "voice", total: 2 }).n, 2, "run from the menu while off, and left half way");
});

test("the record moves by what she did", () => {
  const plan = startSteps(none, { stories: 0 }, { total: 3, steps: {} });
  assert.deepEqual(recordAfter(plan, "step-done", "helper"), { step: "stories", steps: { helper: "done" } });
  assert.deepEqual(recordAfter(plan, "step-skipped", "helper"), { step: "stories", steps: { helper: "skipped" } });
  assert.deepEqual(recordAfter(plan, "step-skipped", "stories"), { step: "done", steps: { stories: "skipped", voice: "not-ready" } }, "no stories: the voice step is passed over, and says so");
  const ready = startSteps(saved, { stories: 2 }, { total: 2, steps: {} });
  assert.deepEqual(recordAfter(ready, "step-done", "stories"), { step: "voice", steps: { stories: "done" } });
  assert.deepEqual(recordAfter(ready, "step-done", "voice"), { step: "done", steps: { voice: "done" } });
  assert.deepEqual(recordAfter(ready, "step-not-ready", "voice"), { step: "done", steps: { voice: "not-ready" } });
  assert.deepEqual(recordAfter(ready, "skip-rest"), { status: "skipped" });
  assert.deepEqual(recordAfter(ready, "finished"), { status: "done", step: "done" });
  assert.deepEqual(recordAfter(ready, "step-done", "nonsense"), {});
  assert.deepEqual(recordAfter(ready, "anything"), {});
});

test("the last screen says each thing with a word and a mark, for every combination", () => {
  for (const on of [true, false]) {
    for (const stories of [0, 1, 3]) {
      for (const voice of ["done", "skipped", "not-ready"]) {
        const lines = doneLines({ steps: { voice } }, { configured: on }, stories);
        assert.equal(lines.length, 3);
        assert.deepEqual(lines.map((line) => line.ok), [on, stories > 0, voice === "done"]);
        for (const line of lines) assert.ok(line.words.length > 10);
      }
    }
  }
  assert.equal(doneLines({}, { configured: true }, 1)[1].words, "1 story kept, private.");
  assert.equal(doneLines({}, { configured: true }, 3)[1].words, "3 stories kept, private.");
  assert.match(doneLines({}, { configured: false }, 0)[0].words, /isn't on yet/);
});

test("the stories of this run, in the order told, and never more than three counted", () => {
  const pieces = [
    { id: "b", valid: true, stage: "rough", promptTitle: "A day you still remember", words: 88, told: "spoken" },
    { id: "a", valid: true, stage: "rough", title: "A meal you love", words: 1 },
    { id: "c", valid: true, stage: "polished", title: "Polished" },
    { id: "d", valid: false, stage: "rough", title: "Broken" },
  ];
  const rows = storyRows(pieces, ["a", "gone", "b", "c", "d"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
  assert.equal(rows[0].line, "A meal you love · typed · 1 word");
  assert.equal(rows[1].line, "A day you still remember · told out loud · 88 words");
  assert.equal(STORIES_ASKED, 3);
  assert.equal(storyProgress(0), 0);
  assert.equal(storyProgress(2), 2);
  assert.equal(storyProgress(7), 3);
  assert.equal(storyProgress(-1), 0);
  assert.equal(storyProgress("x"), 0);
});

test("the reminder is due only when she left the stories untold, and never too often", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const skipped = { status: "done", steps: { stories: "skipped" }, nudge: { shown: [], stopped: false } };
  assert.equal(NUDGE_GAP_DAYS, 7);
  assert.equal(NUDGE_MAX, 3);
  assert.equal(nudgeDue(skipped, 0, now), true);
  assert.equal(nudgeDue({ status: "skipped", steps: { stories: "pending" } }, 0, now), true, "Skip the rest before telling one");
  assert.equal(nudgeDue({ status: "done", steps: { stories: "done" } }, 0, now), false, "never when the stories are done");
  assert.equal(nudgeDue({ status: "skipped", steps: { stories: "done" } }, 0, now), false);
  assert.equal(nudgeDue({ status: "in-progress", steps: { stories: "pending" } }, 0, now), false);
  assert.equal(nudgeDue(skipped, 1, now), false, "she has pieces of her own");
  assert.equal(nudgeDue({ ...skipped, nudge: { shown: [], stopped: true } }, 0, now), false);
  assert.equal(nudgeDue({ ...skipped, nudge: { shown: ["2026-10-01", "2026-10-10", "2026-10-20"] } }, 0, now), false, "three times at most");
  assert.equal(nudgeDue({ ...skipped, nudge: { shown: ["2026-11-14"] } }, 0, now), false, "six days ago");
  assert.equal(nudgeDue({ ...skipped, nudge: { shown: ["2026-11-13"] } }, 0, now), true, "seven days ago");
  assert.equal(nudgeDue(skipped, 0, now, "off"), false);
  assert.equal(nudgeDue(null, 0, now), false);
});

test("the card shows only as a new post opens, and never once she has typed", () => {
  assert.equal(nudgeAllowed(false, true), true);
  assert.equal(nudgeAllowed(true, true), false);
  assert.equal(nudgeAllowed(false, false), false);
  assert.equal(isNewPostRoute({ name: "write", arg: "" }), true);
  assert.equal(isNewPostRoute({ name: "write", arg: "new" }), true);
  assert.equal(isNewPostRoute({ name: "write", arg: "new/recipe" }), true);
  assert.equal(isNewPostRoute({ name: "write", arg: "posts/soup.md" }), false);
  assert.equal(isNewPostRoute({ name: "home", arg: "" }), false);
});

test("problems: a newer record somewhere else is handled without words", () => {
  assert.deepEqual([startProblem({ status: 0 }).code, startProblem({ status: 0 }).signal], ["no-signal", true]);
  for (const code of ["stale", "bad-step", "practice-only"]) {
    const problem = startProblem({ status: 409, data: { code } });
    assert.equal(problem.quiet, true);
    assert.equal(problem.words, "");
  }
  assert.equal(startProblem({ status: 404, data: { code: "unknown-user" } }).words, "That account isn't on this site any more.");
  const other = startProblem({ status: 500, data: { error: "disk full" } });
  assert.equal(other.words, "Getting started didn't load.");
  assert.equal(other.details, "disk full");
});

test("for whoever helps: the switch in effect, where it was set, and each problem", () => {
  assert.equal(modeLine({ mode: "on", round: "1", sourceWords: "the server's environment" }).words, "Getting started is on, set by the server's environment.");
  assert.equal(modeLine({ mode: "on", round: "2026-11-20", sourceWords: "openblog.json" }).words, "Getting started is on (round 2026-11-20), set by openblog.json.");
  assert.equal(modeLine({ mode: "rehearse", sourceWords: "the server's environment" }).words, "Getting started is rehearse, set by the server's environment.");
  assert.deepEqual(modeLine({ mode: "off", sourceWords: "nothing (off)", problems: ["bad value"] }).problems, ["bad value"]);
});

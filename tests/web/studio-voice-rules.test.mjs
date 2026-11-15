// Your writing voice's rules (Studio R9, docs/specs/studio/r9/ux.md). Ports the pure cases of the
// old Admin's admin-voice-session (clock, countdown, labels), admin-voice-access (the announcer's
// marks, resumed, the gap), admin-voice-draft (reconcile, the expired plan), admin-voice-guard
// (polishedDirty), admin-voice-library (grouping, order, coverage, gaps) and
// admin-voice-invitation (the rule), with her words as word ids; adds what R9 decided.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUGH_ATTRIBUTES, STAGE_BADGES, VOICE_LIMITS, byteLength, copyIsPastGrace, coverageText, createAnnouncer, createCountdown, dateText, eraseSummary, expiredPlan, formatClock,
  gapLines, groupLibrary, guideCard, invitationVisible, pieceHash, polishedDirty, reconcileDraft, sessionView, spokenTime, timerLabel, timerState, voiceHash, voiceProblem, wordCount, wordsText,
} from "../../web/studio/parts/voice-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";

const file = (over) => ({ valid: true, visibility: "private", words: 100, bytes: 500, guidance: null, revision: "r", ...over });
const rough = (prompt, pack, day, over = {}) =>
  file({ id: `${day}-${prompt}-rough`, file: `${day}-${prompt}-rough.md`, stage: "rough", pack, prompt, promptTitle: prompt, title: prompt, date: `${day}T09:00:00Z`, ...over });
const polished = (prompt, pack, day, over = {}) =>
  file({ id: `${day}-${prompt}-polished`, file: `${day}-${prompt}-polished.md`, stage: "polished", pack, prompt, promptTitle: prompt, title: prompt, date: `${day}T09:00:00Z`, roughOf: `${day}-${prompt}-rough.md`, ...over });
const coverage = [
  { id: "teaching", title: "Teaching", summary: "", total: 2, withRough: 0, withPolished: 0, prompts: [{ id: "explain", title: "Explain it", rough: false, polished: false }] },
  { id: "stories", title: "Stories", summary: "", total: 4, withRough: 3, withPolished: 1, prompts: [{ id: "a-mistake", title: "A mistake I made", rough: true, polished: true }, { id: "a-surprise", title: "A surprise", rough: true, polished: false }] },
  { id: "opinions", title: "Opinions", summary: "", total: 1, withRough: 0, withPolished: 0, prompts: [] },
];
const samples = () => [
  rough("a-journey", "stories", "2026-10-01"),
  rough("a-mistake", "stories", "2026-10-20"),
  polished("a-mistake", "stories", "2026-10-20", { date: "2026-10-25T09:00:00Z", words: 135, visibility: "portable" }),
  rough("a-surprise", "stories", "2026-10-22"),
];
const listing = (over = {}) => ({ samples: samples(), coverage, warnings: [], ...over });

test("the time is said in digits, in words, and in a shape as well as a colour", () => {
  configureWords();
  assert.equal(formatClock(180), "3:00");
  assert.equal(formatClock(30), "0:30");
  assert.equal(formatClock(-4), "0:00");
  assert.equal(formatClock(59.2), "1:00");
  assert.equal(spokenTime(60), "1 minute");
  assert.equal(spokenTime(30), "30 seconds");
  assert.equal(spokenTime(65), "1 minute 5 seconds");
  assert.equal(spokenTime(1), "1 second");
  assert.equal(spokenTime(0), "0 seconds");
  assert.equal(timerState(31), "running");
  assert.equal(timerState(30), "warning");
  assert.equal(timerState(0), "locked");
  assert.equal(timerState(90, true), "locked");
  const states = [timerLabel(120), timerLabel(20), timerLabel(0)];
  assert.deepEqual(states.map((s) => s.symbol), ["●", "▲", "■"], "a different shape for each state");
  assert.deepEqual(states.map((s) => s.id), ["voice.timerWriting", "voice.timerLeft", "voice.timerUp"]);
  assert.deepEqual(states.map((s) => s.text), ["Writing", "20 seconds left", "Time's up"]);
  assert.equal(wordCount("  one two\nthree  "), 3);
  assert.equal(wordCount(""), 0);
  assert.equal(wordsText(1), "1 word");
  assert.equal(wordsText(64), "64 words");
  assert.equal(byteLength("é"), 2);
});

test("the countdown follows the server's time left and never gives time back", () => {
  let now = 0;
  const countdown = createCountdown(() => now);
  assert.equal(countdown.started, false);
  assert.equal(countdown.remaining(), 0);
  countdown.sync(180);
  assert.equal(countdown.remaining(), 180);
  now = 60_000;
  assert.equal(countdown.remaining(), 120);
  countdown.sync(150); // a late answer that says more than is left
  assert.equal(countdown.remaining(), 120, "never more time than she had");
  countdown.sync(100);
  assert.equal(countdown.remaining(), 100, "the server may say less");
  now = 170_000;
  assert.equal(countdown.expired(), true);
  assert.equal(countdown.remaining(), 0);
  countdown.reset();
  assert.equal(countdown.started, false);
});

test("the announcer says one minute and thirty seconds once each, then the lock, never twice within the gap", () => {
  configureWords();
  const announcer = createAnnouncer();
  assert.equal(announcer.update(180, 0), null, "a piece that just started says nothing");
  assert.equal(announcer.update(61, 119_000), null);
  assert.deepEqual(announcer.update(60, 120_000), { id: "voice.announceLeft", vars: { time: "1 minute" }, text: "1 minute left." });
  assert.equal(announcer.update(59, 121_000), null, "once");
  assert.equal(announcer.update(30, 150_000).text, "30 seconds left.");
  assert.equal(announcer.update(29, 151_000), null);
  assert.equal(announcer.update(0, 180_000), null, "the lock is an event, not a tick");
  assert.equal(announcer.lock(true).text, "Time's up. Your rough draft is saved as you wrote it.");
  assert.equal(announcer.lock(true), null, "said once");
  assert.equal(createAnnouncer().lock(false).text, "Your rough draft is saved as you wrote it.", "I'm done never says time's up");
});

test("a resumed piece says where it stands once, and a mark too soon after is not repeated", () => {
  const announcer = createAnnouncer({ resumed: true });
  assert.equal(announcer.update(70, 0).text, "Back where you were. 1 minute 10 seconds left.");
  assert.equal(announcer.update(60, 10_000), null, "inside the gap: not said, and never said later");
  assert.equal(announcer.update(30, 40_000).text, "30 seconds left.");
  // A piece resumed inside the last half minute has passed both marks.
  const late = createAnnouncer({ resumed: true });
  assert.match(late.update(20, 0).text, /20 seconds left/);
  assert.equal(late.update(10, 30_000), null);
});

test("a save that restates the clock between the marks never silences the thirty second mark", () => {
  const announcer = createAnnouncer();
  announcer.update(180, 0);
  assert.ok(announcer.update(60, 120_000));
  assert.ok(announcer.update(30, 120_000 + VOICE_LIMITS.announceGapMs), "30 s comes at least the gap after 60 s");
});

test("reconciling: the longer draft wins for the same session, and a copy of another never does", () => {
  const local = { sessionId: "s@1", text: "twelve chars", deadline: "d", savedAt: 1 };
  assert.deepEqual(reconcileDraft({ sessionId: "s@1", serverDraft: "short" }, local), { text: "twelve chars", from: "phone", push: true });
  assert.deepEqual(reconcileDraft({ sessionId: "s@1", serverDraft: "much longer than the copy" }, local), { text: "much longer than the copy", from: "server", push: false });
  assert.equal(reconcileDraft({ sessionId: "s@1", serverDraft: "same" }, { ...local, text: "same" }).from, "server");
  assert.equal(reconcileDraft({ sessionId: "s@2", serverDraft: "a" }, local).text, "a");
  assert.equal(reconcileDraft({ sessionId: "s@1", serverDraft: "a" }, null).text, "a");
  assert.equal(reconcileDraft({ sessionId: "s@1", serverDraft: null }, null).text, "");
});

test("an expired piece is planned from the longer copy only if it was kept before the deadline plus the grace", () => {
  const deadline = "2026-10-28T09:03:00.000Z";
  const at = Date.parse(deadline);
  const session = { open: true, expired: true, sessionId: "s@1", deadline, draftChars: 5 };
  const local = (savedAt, textValue = "a longer draft") => ({ sessionId: "s@1", text: textValue, deadline, savedAt });
  assert.equal(expiredPlan(session, local(at - 1000)).useDevice, true);
  assert.equal(expiredPlan(session, local(at + 9000)).useDevice, true, "inside the server's ten second grace");
  assert.equal(expiredPlan(session, local(at + 11000)).useDevice, false, "kept after the grace: no extra time");
  assert.equal(expiredPlan(session, local(at - 1000, "tiny")).useDevice, false, "the server already has more");
  assert.equal(expiredPlan(session, { ...local(at - 1000), sessionId: "other@1" }).useDevice, false);
  assert.equal(expiredPlan({ ...session, expired: false }, local(at - 1000)).useDevice, false, "an open piece just resumes");
  assert.equal(expiredPlan({ open: false }, local(at - 1000)).useDevice, false);
  assert.equal(expiredPlan(session, null).useDevice, false);
  assert.equal(expiredPlan(session, local(at - 1000, "   ")).useDevice, false);
  assert.equal(copyIsPastGrace({ deadline }, at + 10_001), true);
  assert.equal(copyIsPastGrace({ deadline }, at + 9_000), false);
  assert.equal(copyIsPastGrace({ deadline: "nonsense" }, at), false);
});

test("the polished copy is unsaved only when its title or words differ", () => {
  const base = { title: "T", body: "words" };
  assert.equal(polishedDirty({ title: "T", body: "words" }, base), false);
  assert.equal(polishedDirty({ title: "T2", body: "words" }, base), true);
  assert.equal(polishedDirty({ title: "T", body: "words " }, base), true);
});

test("the server's answer decides the step: choose, write, time's up elsewhere, or saved", () => {
  assert.deepEqual(sessionView({ state: "none" }), { step: "choose", notice: "" });
  assert.deepEqual(sessionView({ state: "discarded" }), { step: "choose", notice: "discarded" });
  assert.deepEqual(sessionView({ state: "active" }), { step: "write", resumed: true });
  assert.deepEqual(sessionView({ state: "finishing", retryAfterSeconds: 10 }), { step: "finishing", retryAfterSeconds: 10 });
  assert.deepEqual(sessionView({ state: "locked", expired: true }), { step: "saved", expired: true });
  assert.deepEqual(sessionView(null), { step: "choose", notice: "" });
});

test("the hub follows the catalog's order of sets and puts the newest row first", () => {
  const library = groupLibrary(listing());
  assert.deepEqual(library.groups.map((g) => g.id), ["teaching", "stories", "opinions"]);
  assert.deepEqual(library.groups[1].rows.map((r) => r.prompt), ["a-mistake", "a-surprise", "a-journey"]);
  assert.deepEqual(library.groups[0].rows, []);
  assert.equal(library.empty, false);
  assert.equal(library.written, 3);
  assert.equal(library.polished, 1);
  const [row] = library.groups[1].rows;
  assert.deepEqual(row.badges, ["rough", "polished"]);
  assert.equal(row.words, 135, "the polished copy's words");
  assert.equal(row.date, "2026-10-25T09:00:00Z", "the newest file's date");
  assert.equal(row.id, "2026-10-20-a-mistake-rough", "a row opens by its rough draft");
  assert.equal(JSON.stringify(groupLibrary(listing())), JSON.stringify(groupLibrary(listing({ samples: samples().reverse() }))), "whatever order the server listed them in");
  const tied = listing({ samples: [rough("a-surprise", "stories", "2026-10-20"), rough("a-journey", "stories", "2026-10-20")] });
  assert.deepEqual(groupLibrary(tied).groups[1].rows.map((r) => r.prompt), ["a-journey", "a-surprise"], "equal dates: by file name");
});

test("pieces of a set the site dropped are a last group, unreadable files are apart, and every answer is its own row", () => {
  const data = listing({ samples: [...samples(), rough("old-prompt", "retired", "2026-09-01"), file({ valid: false, file: "2026-10-01-x-rough.md", guidance: "Repair it.", visibility: "portable" })] });
  const library = groupLibrary(data);
  assert.deepEqual(library.other.rows.map((r) => r.prompt), ["old-prompt"]);
  assert.deepEqual(library.invalid.map((f) => f.file), ["2026-10-01-x-rough.md"]);
  assert.equal(groupLibrary(listing({ samples: [file({ valid: false, file: "a.md" })] })).empty, false, "an unreadable file is not an empty hub");
  assert.equal(groupLibrary({ samples: [], coverage }).empty, true);
  const twice = groupLibrary(listing({ samples: [rough("a-mistake", "stories", "2026-10-20"), rough("a-mistake", "stories", "2026-10-27"), polished("a-mistake", "stories", "2026-10-27")] }));
  assert.deepEqual(twice.groups[1].rows.map((r) => [r.date.slice(0, 10), r.badges.join("+")]), [["2026-10-27", "rough+polished"], ["2026-10-20", "rough"]]);
  // A polished copy whose rough draft is missing is a row of its own, with no rough.
  const orphan = groupLibrary(listing({ samples: [polished("a-mistake", "stories", "2026-10-20")] })).groups[1].rows[0];
  assert.equal(orphan.rough, null);
  assert.deepEqual(orphan.badges, ["polished"]);
});

test("coverage, gaps and dates are code, in plain words", () => {
  assert.equal(coverageText({ total: 4, withRough: 2, withPolished: 1 }), "2 of 4 written, 1 polished");
  assert.equal(coverageText({ total: 1, withRough: 1, withPolished: 0 }), "1 of 1 written");
  assert.deepEqual(gapLines({ unansweredPacks: ["teaching", "x"], roughOnlyPrompts: ["a-surprise"], oneSampleTraits: [{ statement: "Short sentences", section: "Rhythm" }] }, coverage), [
    { kind: "packs", items: ["Teaching", "x"] }, { kind: "rough-only", items: ["A surprise"] }, { kind: "one-sample", items: ["Short sentences (Rhythm)"] },
  ]);
  assert.deepEqual(gapLines(null), []);
  assert.deepEqual(gapLines({}), []);
  assert.equal(dateText("2026-11-12T09:00:00Z"), "Nov 12, 2026");
  assert.equal(dateText("nope"), "");
  assert.deepEqual(Object.keys(STAGE_BADGES), ["rough", "polished"]);
  assert.notEqual(STAGE_BADGES.rough.symbol, STAGE_BADGES.polished.symbol, "a shape as well as a word");
});

test("the rough box refuses every correction a page can refuse", () => {
  assert.deepEqual({ ...ROUGH_ATTRIBUTES }, {
    spellcheck: "false", autocorrect: "off", autocapitalize: "off", autocomplete: "off", writingsuggestions: "false",
    "data-gramm": "false", "data-gramm_editor": "false", "data-enable-grammarly": "false", "data-voice-rough": "true",
  });
  assert.ok(Object.isFrozen(ROUGH_ATTRIBUTES));
});

test("the guide card: helper off, nothing written, none yet, one made, one that can't be read", () => {
  const on = { configured: true };
  assert.equal(guideCard({ configured: false }, { id: "private:voice" }, samples()).state, "helper-off");
  assert.equal(guideCard(null, null, samples()).state, "helper-off");
  assert.equal(guideCard(on, null, []).state, "needs-pieces");
  assert.equal(guideCard(on, null, [file({ valid: false })]).state, "needs-pieces");
  assert.equal(guideCard(on, null, samples()).state, "none");
  assert.equal(guideCard(on, { id: "private:voice" }, []).state, "has");
  assert.equal(guideCard(on, null, samples(), { broken: true }).state, "broken");
});

test("an erase is summed up by what goes, and its files are for the details", () => {
  const plan = { confirm: "erase", items: [
    { path: ".openblog/private/context/voice/2026-10-20-a-rough.md", kind: "sample" }, { path: ".openblog/private/context/voice/2026-10-20-a-polished.md", kind: "sample" },
    { path: "assistant/context/voice/2026-10-21-b-rough.md", kind: "sample" }, { path: ".openblog/private/context/voice.md", kind: "guide" }, { path: ".openblog/private/voice/session.json", kind: "session" },
  ] };
  const summary = eraseSummary(plan);
  assert.equal(summary.what, "2 pieces, your voice guide and a piece in progress");
  assert.equal(summary.files, 5);
  assert.equal(summary.items[3].kind, "guide");
  assert.equal(eraseSummary({ items: [{ path: "a-rough.md", kind: "sample" }] }).what, "1 piece");
  assert.equal(eraseSummary({ items: [{ path: "x.swp", kind: "editor-file" }] }).what, "1 leftover file");
  assert.deepEqual(eraseSummary({ items: [] }), { what: "", files: 0, items: [] });
  assert.equal(eraseSummary(null).files, 0);
});

test("the invitation shows only with a helper, no pieces, nothing in progress and no dismissal", () => {
  const status = { samples: 0, session: { open: false } };
  assert.equal(invitationVisible({ dismissed: false, status, helperReady: true }), true);
  assert.equal(invitationVisible({ dismissed: true, status, helperReady: true }), false);
  assert.equal(invitationVisible({ dismissed: false, status: { ...status, invitationDismissed: true }, helperReady: true }), false, "the server remembers No thanks (G64)");
  assert.equal(invitationVisible({ dismissed: false, status, helperReady: false }), false, "useless without a helper");
  assert.equal(invitationVisible({ dismissed: false, status: { samples: 1, session: { open: false } }, helperReady: true }), false);
  assert.equal(invitationVisible({ dismissed: false, status: { samples: 0, session: { open: true } }, helperReady: true }), false);
  assert.equal(invitationVisible({ dismissed: false, status: null, helperReady: true }), false, "a status that couldn't be read shows nothing");
  assert.equal(invitationVisible({ dismissed: false, status, helperReady: true, onboardingOwnsIt: true }), false, "never asked in two places (R9b)");
  assert.equal(invitationVisible(), false);
});

test("addresses", () => {
  assert.equal(voiceHash(), "#/voice/write");
  assert.equal(voiceHash("stories & more"), "#/voice/write?pack=stories%20%26%20more");
  assert.equal(pieceHash("2026-10-20-a-rough"), "#/voice/piece/2026-10-20-a-rough");
  assert.equal(pieceHash(), "#/voice");
});

test("every refusal has a code and, where the screen has no words of its own, a sentence that never holds her writing", () => {
  configureWords();
  const fail = (status, data) => voiceProblem({ status, data });
  assert.deepEqual([fail(0).code, fail(0).signal], ["no-signal", true]);
  assert.equal(fail(401, {}).code, "signed-out");
  for (const code of ["already-open", "time-up", "empty", "conflict", "pack-gone", "not-polished", "confirm-word"]) {
    assert.deepEqual([fail(409, { code }).code, fail(409, { code }).words], [code, ""], `${code}: the screen's own words`);
  }
  assert.equal(fail(409, { code: "other-session" }).words, "This piece was finished somewhere else.");
  assert.equal(fail(409, { code: "no-session" }).words, "This piece was finished somewhere else.");
  assert.equal(fail(413, { code: "too-long" }).words, "That's more than a piece can hold. What's here is saved.");
  assert.match(fail(409, { code: "slug-taken" }).words, /A post with this name already exists/);
  assert.match(fail(422, { code: "invalid" }).words, /no line breaks/);
  assert.match(fail(404, { code: "gone" }).words, /isn't there any more/);
  assert.equal(fail(500, { error: "disk full at the project/x" }).words, "Your blog couldn't do that just now. Your writing is kept on this phone.");
  assert.equal(fail(500, { error: "disk full" }).details, "disk full", "the server's sentence is for details only");
  // Before G63: today's flags mean the same.
  for (const [flag, code] of [["alreadyOpen", "already-open"], ["timeUp", "time-up"], ["otherSession", "other-session"], ["noSession", "no-session"], ["empty", "empty"], ["conflict", "conflict"], ["refused", "refused"], ["ambiguous", "ambiguous"], ["invalid", "invalid"]]) {
    assert.equal(fail(409, { [flag]: true }).code, code, flag);
  }
  assert.equal(fail(413, {}).code, "too-long");
  assert.equal(fail(404, {}).code, "gone");
});

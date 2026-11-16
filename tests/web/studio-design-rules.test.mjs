// Describe a new look's rules (Studio R9). Ports the old Admin's admin-theme-designer cases and
// adds R9's: a colour changed by hand is only ever a checked hex, the early warning agrees with
// the server's own arithmetic (a fixture shared with a Rust test), every kind of note has her
// words, and the ideas name no person, food or site.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IDEAS, undoWords, MAX_DESCRIPTION, MAX_HISTORY, MAX_LABEL, ROLES, backDraft, contrastRatio, descriptionProblem, designProblem, labelProblem, letteringLine, lookOverrides, normalHex, noteWords,
  pickedWords, pushDraft, readablePairs, renamed, roleName, startFrom, swatches, willAdjust, withColor,
} from "../../web/studio/parts/design-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const theme = { colors: { light: { page: "#fbf8f2", surface: "#ffffff", text: "#1d2a22", muted: "#6b7a70", border: "#dfe5dc", accent: "#b02236", glow: "#fff0f0" }, dark: { page: "#0e1c19", text: "#f4efe4", accent: "url(x)" } } };
const draft = { label: "Warm", summary: "s", light: { page: "#ffffff", surface: "#ffffff", text: "#111111", muted: "#555555", border: "#dddddd", accent: "#a51d2d" }, dark: { page: "#000000", surface: "#111111", text: "#ffffff", muted: "#bbbbbb", border: "#333333", accent: "#e8c060" }, font: "classic-serif", headingFont: "modern-sans", roundness: "soft", textSize: "large" };

test("swatches show the six colours an owner recognises, in a fixed order, and only real colours", () => {
  configureWords();
  assert.deepEqual(swatches(theme, "light").map((s) => s.label), ["Page", "Boxes", "Writing", "Quiet writing (dates and notes)", "Edges", "Links and buttons"]);
  assert.equal(swatches(theme, "light")[5].color, "#b02236");
  assert.deepEqual(swatches(theme, "dark").map((s) => s.key), ["page", "text"], "a value that isn't a hex colour never reaches a style");
  assert.deepEqual(swatches(null, "light"), []);
  assert.deepEqual(ROLES.map(roleName), ["Page", "Boxes", "Writing", "Quiet writing (dates and notes)", "Edges", "Links and buttons"]);
});

test("a description and a name are checked in her words", () => {
  configureWords();
  assert.match(descriptionProblem("   "), /few words/);
  assert.equal(descriptionProblem("x".repeat(MAX_DESCRIPTION + 1)), "That's 1,001 letters; the most is 1,000. Say it a little shorter.");
  assert.equal(descriptionProblem(IDEAS()[0].text), "");
  assert.equal(labelProblem(""), "Give your new look a name.");
  assert.equal(labelProblem("x".repeat(MAX_LABEL + 1)), "Keep the name to 40 letters or fewer.");
  assert.equal(labelProblem("two\nlines"), "Keep the name on one line.");
  assert.equal(labelProblem("Warm and cozy"), "");
  assert.equal(labelProblem(" warm AND cozy ", ["Everyday", "Warm and Cozy"]), "You already have a look called “warm AND cozy”. Choose another name.");
});

test("renaming keeps the rest of the draft", () => {
  assert.deepEqual(renamed({ label: "Old", summary: "s", font: "theme" }, "  New name "), { label: "New name", summary: "s", font: "theme" });
});

test("Start from lists the site's looks, leaving out the engine's plain default unless it is worn", () => {
  const options = { current: "everyday", themes: [{ name: "base", label: "Base" }, { name: "winter", label: "Winter" }, { name: "everyday", label: "Everyday" }] };
  assert.deepEqual(startFrom(options), [{ value: "winter", label: "Winter" }, { value: "everyday", label: "Everyday" }]);
  assert.equal(startFrom({ current: "base", themes: [{ name: "base", label: "Base" }] }).length, 1);
  assert.deepEqual(startFrom(null), []);
});

test("the five ideas are generic, in her words, and each fits the box", () => {
  configureWords();
  const ideas = IDEAS();
  assert.deepEqual(ideas.map((idea) => idea.name), ["Warm and cozy", "Spring garden", "Bold and clear", "Fall harvest", "Calm night"]);
  for (const idea of ideas) {
    assert.ok(idea.text.startsWith(`${idea.name}: `), idea.name);
    assert.equal(descriptionProblem(idea.text), "");
    assert.doesNotMatch(idea.text, HER_BANNED);
    assert.doesNotMatch(idea.text, /Christmas|kitchen|Grammi|Fourth of July|picnic|cranberry/i, "no one owner's season, food or family");
  }
});

test("a colour changed by hand is only ever a checked hex in one of the six places", () => {
  const changed = withColor(draft, "light", "text", "#777777");
  assert.equal(changed.light.text, "#777777");
  assert.equal(draft.light.text, "#111111", "the draft before is untouched");
  assert.equal(changed.dark, draft.dark);
  assert.equal(withColor(draft, "dark", "accent", "#ABC").dark.accent, "#aabbcc");
  for (const bad of ["red", "#12345", "#gggggg", "rgb(0,0,0)", "#fff;}body{display:none", "url(x)", "", null, undefined, 7]) {
    assert.equal(withColor(draft, "light", "text", bad), null, String(bad));
  }
  assert.equal(withColor(draft, "light", "background-image", "#ffffff"), null, "not one of the six");
  assert.equal(withColor(draft, "sepia", "text", "#ffffff"), null);
  assert.equal(withColor({}, "light", "text", "#ffffff"), null);
  assert.equal(normalHex(" #FFF "), "#ffffff");
  assert.equal(normalHex("fff"), null);
});

test("contrastRatio equals look_contrast::contrast on the shared pairs", () => {
  const { pairs } = JSON.parse(readFileSync(join(repository, "tests/fixtures/contrast-pairs.json"), "utf8"));
  assert.ok(pairs.length >= 40);
  for (const { a, b, ratio } of pairs) {
    assert.ok(Math.abs(contrastRatio(a, b) - ratio) < 0.0006, `${a} on ${b}`);
    assert.ok(Math.abs(contrastRatio(b, a) - ratio) < 0.0006, "either way round");
  }
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("red", "#ffffff"), 0, "not a colour: no answer, never a guess");
});

test("the early warning: a writing colour under 4.5 to 1 on the page or the boxes will be adjusted", () => {
  const colors = { page: "#ffffff", surface: "#ffffff", text: "#777777", muted: "#555555", accent: "#a51d2d", border: "#eeeeee" };
  assert.equal(willAdjust(colors, "text"), true, "#777 on white is 4.48");
  assert.equal(willAdjust({ ...colors, text: "#767676" }, "text"), false, "#767676 on white is 4.54");
  assert.equal(willAdjust(colors, "muted"), false);
  assert.equal(willAdjust(colors, "border"), false, "edges carry no writing");
  assert.equal(willAdjust({ ...colors, text: "#111111", page: "#222222" }, "page"), true, "a page colour that makes the writing hard to read");
  const pairs = readablePairs(colors);
  assert.equal(pairs.length, 6, "three writing colours on two grounds");
  assert.deepEqual(pairs.find((p) => p.role === "text" && p.ground === "page"), { role: "text", ground: "page", ratio: 4.5, ok: false });
  assert.deepEqual(readablePairs({}), []);
});

test("every kind of note has her words, and an older server's sentence shows as it is", () => {
  configureWords();
  assert.equal(noteWords({ scheme: "dark", role: "muted", change: "lighter" }), "In dark mode, the quiet writing (dates and notes) is a little lighter so it's easy to read.");
  assert.equal(noteWords({ scheme: "light", role: "text", change: "darker" }), "In light mode, the writing is a little darker so it's easy to read.");
  assert.equal(noteWords({ scheme: "light", role: "accent", change: "replaced", with: "text" }), "In light mode, the links and buttons couldn't be made easy to read, so they use the writing color instead.");
  // A role that is many things reads as many: "the links and buttons are", "the edges are".
  assert.equal(noteWords({ scheme: "light", role: "accent", change: "darker" }), "In light mode, the links and buttons are a little darker so they're easy to read.");
  assert.equal(noteWords({ scheme: "dark", role: "border", change: "lighter" }), "In dark mode, the edges are a little lighter so they're easy to read.");
  assert.equal(noteWords({ scheme: "dark", role: "surface", change: "lighter" }), "In dark mode, the boxes are a little lighter so they're easy to read.");
  assert.equal(noteWords({ scheme: "light", role: "text", change: "replaced", with: "black" }), "In light mode, the writing couldn't be made easy to read, so it uses black instead.");
  assert.match(noteWords({ scheme: "dark", role: "text", change: "replaced", with: "white" }), /uses white instead/);
  assert.match(noteWords({ scheme: "dark", role: "surface", change: "replaced", with: "page" }), /the boxes couldn't be made easy to read, so they use the page color instead/);
  assert.equal(noteWords("In light mode, the writing was made a little darker so it is easy to read."), "In light mode, the writing was made a little darker so it is easy to read.");
  assert.equal(noteWords({ scheme: "light", role: "text", change: "new-kind", words: "The server's own sentence." }), "The server's own sentence.");
  assert.equal(noteWords(null), "");
});

test("after a pick: changed, changed and made darker or lighter, or replaced", () => {
  configureWords();
  const changes = [{ scheme: "light", role: "text", change: "darker" }, { scheme: "dark", role: "muted", change: "lighter" }, { scheme: "light", role: "accent", change: "replaced", with: "text" }];
  assert.deepEqual(pickedWords(changes, "light", "text"), { kind: "adjusted", words: "Writing changed, and made a little darker so it's easy to read." });
  assert.equal(pickedWords(changes, "dark", "muted").words, "Quiet writing (dates and notes) changed, and made a little lighter so it's easy to read.");
  assert.deepEqual(pickedWords(changes, "light", "accent"), { kind: "replaced", words: "Links and buttons couldn't be made easy to read, so it uses the writing color instead." });
  assert.deepEqual(pickedWords(changes, "dark", "text"), { kind: "picked", words: "Writing changed." }, "another scheme's note isn't this one's");
  assert.equal(pickedWords(undefined, "light", "page").words, "Page changed.");
});

test("lettering, corners and size are said with Look's own names; the look she starts from where unchanged", () => {
  configureWords();
  assert.equal(letteringLine(draft, "Everyday"), "Lettering: Classic for writing, Modern for headings. Corners: Soft. Writing size: Large.");
  assert.equal(letteringLine({ font: "theme", headingFont: "theme", roundness: "theme", textSize: "theme" }, "Everyday"),
    "Lettering: as in Everyday for writing, as in Everyday for headings. Corners: as in Everyday. Writing size: as in Everyday.");
});

test("Look's choices that still apply on top are named, the main colour apart", () => {
  assert.deepEqual(lookOverrides({ version: 1, accent: "#2457d6", roundness: "square", textSize: "large" }), { accent: true, others: ["Text size", "Corners"].sort().reverse().sort() });
  assert.deepEqual(lookOverrides({ version: 1, accent: "#2457d6", roundness: "square" }, ["roundness"]), { accent: false, others: ["Corners"] }, "only what this look honours");
  assert.deepEqual(lookOverrides({}), { accent: false, others: [] });
  assert.deepEqual(lookOverrides(null), { accent: false, others: [] });
});

test("Back to the one before steps through drafts kept in page memory, twenty at most", () => {
  let history = [];
  for (let i = 0; i < MAX_HISTORY + 5; i += 1) history = pushDraft(history, { n: i });
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(history[0].n, 5, "the oldest go");
  const back = backDraft(history);
  assert.equal(back.entry.n, MAX_HISTORY + 3);
  assert.equal(back.history.length, MAX_HISTORY - 1);
  assert.equal(backDraft([{ n: 1 }]), null, "nothing before the first");
  assert.equal(backDraft([]), null);
});

test("the look routes' refusals have her words, and a helper problem is left to R8", () => {
  configureWords();
  const fail = (status, data) => designProblem({ status, data });
  assert.equal(fail(0).words, "Drafting a look needs a signal. What you typed is kept here.");
  assert.deepEqual([fail(400, { code: "no-description" }).words, fail(400, { code: "no-description" }).field], ["Describe the look you want in a few words first.", "description"]);
  assert.match(fail(400, { code: "too-long" }).words, /Say it a little shorter/);
  assert.equal(fail(422, { code: "base-gone" }).words, "That look isn't on your site any more. Choose another to start from.");
  assert.match(fail(502, { code: "invalid-result" }).words, /couldn't be used, so nothing changed/);
  assert.equal(fail(409, { code: "name-taken", name: "Warm" }).words, "You already have a look called “Warm”. Choose another name.");
  assert.equal(fail(409, { code: "exists" }).field, "name");
  assert.equal(fail(422, { code: "bad-draft", error: "This theme cannot be used: `light.text`…" }).words, "This look couldn't be saved. Try drafting it again.");
  assert.equal(fail(422, { error: "content problems" }).words, "Your front page couldn't be shown just now. Your new look is still here.");
  assert.equal(fail(500, {}).words, "That wasn't saved. Try again in a moment.");
  assert.equal(fail(502, { code: "provider-down" }), null);
  assert.equal(fail(404, { code: "not-configured" }), null);
  assert.equal(fail(409, { code: "in-use" }).words, "", "the screen's own words");
});

test("Undo of a saved look says what really happened: no signal, too late, or in use", () => {
  configureWords();
  const why = (status, data) => undoWords({ status, data }, "Fog");
  assert.deepEqual(why(0), { words: "There's no signal, so “Fog” is still saved. Try Undo again when you have one.", again: true });
  assert.deepEqual(why(409, { code: "expired" }), { words: "It's been more than 10 minutes, so “Fog” can't be undone. It stays.", again: false });
  assert.deepEqual(why(409, { code: "in-use" }), { words: "“Fog” is in use or was changed, so it stays.", again: false });
  assert.equal(why(500, {}).words, "That wasn't saved. Try again in a moment.");
  assert.equal(why(500, {}).again, true);
});

test("Start from begins on the look that is up, then the stored one, then the first", async () => {
  const { startDefault } = await import("../../web/studio/parts/design-rules.js");
  const themes = [{ value: "christmas", label: "Christmas" }, { value: "grammis", label: "No decorations" }, { value: "thanksgiving", label: "Thanksgiving" }];
  assert.equal(startDefault(themes, "grammis", "thanksgiving"), "thanksgiving");
  assert.equal(startDefault(themes, "grammis", ""), "grammis");
  assert.equal(startDefault(themes, "grammis", "gone"), "grammis", "a look that is up but not offered is passed over");
  assert.equal(startDefault(themes, "base", ""), "christmas");
  assert.equal(startDefault([], "grammis", "thanksgiving"), "");
});

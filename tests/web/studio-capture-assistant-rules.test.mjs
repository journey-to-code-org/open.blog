// Ported from admin-capture-assistant.test.mjs (Studio R4): the pure half. The sheets that ask
// first are tested in the browser (studio-new-job.spec.mjs, studio-write-job.spec.mjs).
import assert from "node:assert/strict";
import test from "node:test";

import { DRAFT_LIMITS, SECTION_KEYS, appendTranscript, draftBody, draftIsWords, normalizeDraft, plainNotes } from "../../web/studio/parts/capture-assistant-rules.js";
import * as old from "../../web/admin/capture-assistant.js";

test("a transcript is made plain before it can reach the post's Markdown, the same as the old Admin did", () => {
  const said = "# Heading\n> quote\n- list\n1. one\n<script>x</script> [link](javascript:x) &amp; ```\n---";
  assert.equal(plainNotes(said), old.plainNotes(said));
  assert.equal(plainNotes("<b>hi</b>"), "&lt;b>hi&lt;/b>");
  assert.equal(plainNotes("[x](y)"), "\\[x](y)");
  assert.equal(plainNotes("# not a heading"), "\\# not a heading");
});

test("a transcript goes under her typed words and the bound is kept", () => {
  assert.deepEqual(appendTranscript("Typed.  ", "Said.", 100), { notes: "Typed.\n\nSaid.", clipped: false });
  assert.deepEqual(appendTranscript("", "Said.", 100), { notes: "Said.", clipped: false });
  assert.deepEqual(appendTranscript("abc", "defgh", 6), { notes: "abc\n\nd", clipped: true });
});

test("a write-up is read defensively, bounded and never empty", () => {
  assert.equal(normalizeDraft(null), null);
  assert.equal(normalizeDraft({ title: " ", sections: {} }), null);
  const long = normalizeDraft({ title: "t".repeat(500), description: "line\none", sections: { problem: "p".repeat(5000), extra: "no" } });
  assert.equal(long.title.length, DRAFT_LIMITS.title);
  assert.equal(long.description, "line one");
  assert.equal(long.sections.problem.length, DRAFT_LIMITS.section);
  assert.deepEqual(Object.keys(long.sections), [...SECTION_KEYS]);
});

test("a write-up fills the scaffold's own headings and nothing else", () => {
  const sections = { problem: "Leak", found: "", did: "Fixed", result: "Dry" };
  assert.equal(draftBody({ scaffold: "## A\n\n## B\n\n## C\n\n## D\n\n", sections }), "## A\n\nLeak\n\n## B\n\n## C\n\nFixed\n\n## D\n\nDry\n\n");
  assert.equal(draftBody({ sections }), old.draftBody({ sections }));
});

// Studio R8, B1: a write-up goes into her post's boxes, so it is words or it is nothing.
test("a write-up with a link, a picture, markup or an address in it is not used", () => {
  const draft = (over = {}, sections = {}) => normalizeDraft({ title: "Water heater swap", description: "Replaced a leaking tank.", sections: { problem: "It leaked.", found: "A cracked seal.", did: "Replaced it.\n\n- new valve\n- new seal", result: "Dry.", ...sections }, ...over });
  assert.equal(draftIsWords(draft()), true, "paragraphs and a plain list are words");
  for (const bad of ["See [our site](https://evil.example).", "<img src=x onerror=alert(1)>", "![x](https://evil.example/p.png)", "Call `now`", "https://evil.example/video", "Visit www.evil.example", "write to a@evil.example", "[x]: https://evil.example"]) {
    assert.equal(draftIsWords(draft({}, { did: bad })), false, bad);
    assert.equal(draftIsWords(draft({ title: bad })), false, `title: ${bad}`);
    assert.equal(draftIsWords(draft({ description: bad })), false, `description: ${bad}`);
  }
  // A part can't start a heading (a new box), a fence or the top of a file.
  for (const bad of ["Fine.\n## Another part", "~~~\ncode\n~~~", "---"]) assert.equal(draftIsWords(draft({}, { found: bad })), false, bad);
  assert.equal(draftIsWords(draft({ title: "# Heading" })), false);
  assert.equal(draftIsWords(null), false);
});

// What the writing helper knows (Studio R8). Ports the old Admin's "assistant context disclosure…",
// "…references and immutable post snapshots", "post context fields round-trip…", the voice budget
// and disclosure cases (admin-assistant-voice) and the URL-context rules (admin-url-context) in
// their Studio form, and adds: new notes are private, a note is saved with the version it was read
// with, and nothing that no longer exists is ever sent.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTE_MAX_BYTES, VOICE_REQUEST_BUDGET, contextDisclosure, contextLabel, defaultContextIds, keptWords, noteOf, noteProblem, noteSaveRequest, notesPresent, pageAddressOk, pageFileId, postContextFields,
  referenceNameOk, voiceBudget, voiceGuideOf,
} from "../../web/studio/parts/helper-context-rules.js";
import { configureWords } from "../../web/studio/parts/words.js";

const sample = (file, characters, more = {}) => ({ id: `voice:private:${file}`, name: file, path: `.openblog/private/context/voice/${file}`, kind: "voiceSample", stage: "rough", pack: "stories", visibility: "private", characters, exists: true, valid: true, ...more });

test("context disclosure names selected documents, visibility, and character counts", () => {
  assert.deepEqual(contextDisclosure([
    { id: "portable:author", name: "author.md", visibility: "portable", characters: 120, exists: true, valid: true },
    { id: "private:site", name: "site.md", visibility: "private", characters: 48, exists: true, valid: true },
    { id: "private:author", name: "author.md", visibility: "private", characters: 0, exists: true, valid: false },
  ], new Set(["portable:author", "private:site", "private:author"])), {
    documents: [{ name: "author.md", visibility: "portable", characters: 120 }, { name: "site.md", visibility: "private", characters: 48 }],
    totalCharacters: 168,
  });
});

test("disclosure includes selected references and immutable post snapshots", () => {
  assert.deepEqual(contextDisclosure([
    { id: "portable:reference:notes.md", name: "notes.md", visibility: "portable", kind: "reference", characters: 18, exists: true, valid: true },
    { id: "post:posts/lesson.md", name: "lesson.md", path: "posts/lesson.md", visibility: "source", kind: "postSnapshot", characters: 42, exists: true, valid: true },
  ], new Set(["portable:reference:notes.md", "post:posts/lesson.md"])), {
    documents: [{ name: "notes.md", visibility: "portable", characters: 18, kind: "reference", path: undefined }, { name: "lesson.md", visibility: "source", characters: 42, kind: "postSnapshot", path: "posts/lesson.md" }],
    totalCharacters: 60,
  });
});

test("post context fields round-trip from the spec-defined Markdown headings", () => {
  assert.deepEqual(postContextFields("## Goal\n\nTeach context.\n\n## Audience\n\nAuthors\n\n## Learning outcomes\n\nSelect sources.\n\n## Sources\n\nSpec\n\n## Constraints\n\nStay bounded.\n"),
    { goal: "Teach context.", audience: "Authors", learningOutcomes: "Select sources.", sources: "Spec", constraints: "Stay bounded." });
  assert.equal(postContextFields("<!-- openblog:constraints:start -->\n## Constraints\n\nKeep this heading:\n\n## Required examples\n\nTwo.\n<!-- openblog:constraints:end -->\n").constraints, "Keep this heading:\n\n## Required examples\n\nTwo.");
  assert.deepEqual(postContextFields(""), { goal: "", audience: "", learningOutcomes: "", sources: "", constraints: "" });
});

test("a voice sample is named with its stage, pack, where it's kept and its size", () => {
  const document = sample("2026-10-28-a-mistake-i-made-rough.md", 120);
  assert.equal(contextLabel(document), ".openblog/private/context/voice/2026-10-28-a-mistake-i-made-rough.md · Voice sample · rough · stories · Private · 120 characters");
  assert.deepEqual(contextDisclosure([document], new Set([document.id])).documents[0], { name: document.name, visibility: "private", characters: 120, kind: "voiceSample", path: document.path, stage: "rough", pack: "stories" });
  assert.equal(contextLabel({ id: "portable:author", name: "author.md", visibility: "portable", characters: 5 }), "author.md · Portable · 5 characters");
  assert.equal(contextLabel({ name: "voice.md", contextType: "voice", visibility: "portable", characters: 321 }), "voice.md · Voice guide · Portable · 321 characters");
  assert.equal(contextLabel({ name: "lesson.md", path: "posts/lesson.md", kind: "postSnapshot", characters: 42 }), "posts/lesson.md · Post snapshot · 42 characters");
});

test("the voice budget counts selected, valid samples only", () => {
  const documents = [sample("a-rough.md", 100), sample("b-rough.md", 50), sample("c-rough.md", 10, { valid: false }), { id: "portable:author", name: "author.md", characters: 999999, exists: true, valid: true }];
  const budget = voiceBudget(documents, new Set(documents.map((document) => document.id)));
  assert.deepEqual([budget.samples, budget.characters, budget.over, budget.message], [2, 150, false, ""]);
  assert.equal(voiceBudget(documents, new Set()).samples, 0);
});

test("a selection over the request budget is refused before any request", () => {
  const tooMany = Array.from({ length: VOICE_REQUEST_BUDGET.samples + 1 }, (_, index) => sample(`s${index}-rough.md`, 10));
  const many = voiceBudget(tooMany, new Set(tooMany.map((document) => document.id)));
  assert.equal(many.over, true);
  assert.match(many.message, /at most 8/);
  const tooLong = [sample("long-rough.md", VOICE_REQUEST_BUDGET.characters + 1)];
  assert.match(voiceBudget(tooLong, new Set([tooLong[0].id])).message, /at most 120000/);
  assert.equal(voiceBudget(tooLong, new Set([tooLong[0].id]), { samples: 2, characters: 500000 }).over, false);
});

const CATALOG = {
  documents: [
    { id: "portable:author", contextType: "author", visibility: "portable", name: "author.md", exists: true, valid: true, etag: "pa" },
    { id: "private:author", contextType: "author", visibility: "private", name: "author.md", exists: false, valid: true, etag: null },
    { id: "portable:site", contextType: "site", visibility: "portable", name: "site.md", exists: false, valid: true, etag: null },
    { id: "private:site", contextType: "site", visibility: "private", name: "site.md", exists: true, valid: false, etag: "bad" },
  ],
  voiceGuides: [
    { id: "portable:voice", contextType: "voice", visibility: "portable", exists: true, valid: true },
    { id: "private:voice", contextType: "voice", visibility: "private", exists: true, valid: true },
  ],
  references: [{ id: "private:reference:style.md", name: "style.md", visibility: "private", exists: true, valid: true }, { id: "portable:reference:old.md", name: "old.md", visibility: "portable", exists: true, valid: false }],
};

test("her note is the private one when it exists, else the shared one; a new note is private", () => {
  assert.equal(noteOf(CATALOG, "author").doc.id, "portable:author", "an existing shared note stays where it is");
  assert.equal(noteOf({ documents: [...CATALOG.documents, { id: "private:author", contextType: "author", visibility: "private", exists: true, valid: true }].reverse() }, "author").doc.visibility, "private");
  assert.equal(noteOf({ documents: [{ id: "private:author", contextType: "author", visibility: "private", exists: true }, { id: "portable:author", contextType: "author", visibility: "portable", exists: true }] }, "author").both, true);
  const fresh = noteOf({}, "site").doc;
  assert.deepEqual([fresh.visibility, fresh.exists, fresh.etag], ["private", false, null]);
  assert.deepEqual(noteOf({ documents: [] }, "post").doc.visibility, "private");
});

test("only notes that exist and can be read go; the voice guide goes only with Sound like me", () => {
  assert.deepEqual(notesPresent(CATALOG), [{ id: "portable:author", type: "author" }], "an unreadable note is never sent");
  assert.deepEqual(voiceGuideOf(CATALOG), { id: "private:voice", visibility: "private" }, "the private guide first");
  assert.equal(voiceGuideOf({ voiceGuides: [{ id: "portable:voice", contextType: "voice", exists: true, valid: false }] }), null);
  assert.deepEqual(defaultContextIds(CATALOG, { useNotes: true, soundLikeMe: false }), ["portable:author"]);
  assert.deepEqual(defaultContextIds(CATALOG, { useNotes: false, soundLikeMe: true }), ["private:voice"]);
  assert.deepEqual(defaultContextIds(CATALOG, { useNotes: false, soundLikeMe: false }), []);
  assert.deepEqual(defaultContextIds(CATALOG, { useNotes: false, extra: ["private:reference:style.md", "portable:reference:old.md", "private:reference:gone.md", "private:reference:style.md"] }), ["private:reference:style.md"]);
  assert.equal(defaultContextIds({ references: Array.from({ length: 30 }, (_, n) => ({ id: `private:reference:r${n}.md`, exists: true, valid: true })) }, { useNotes: false, extra: Array.from({ length: 30 }, (_, n) => `private:reference:r${n}.md`) }).length, 16);
});

test("a note saves with the version it was read with, and emptying it removes the file", () => {
  const doc = { contextType: "author", visibility: "private", exists: true, etag: "e1" };
  assert.deepEqual(noteSaveRequest(doc, "I write the way I talk.  \r\n\n"), { method: "PUT", body: { contextType: "author", visibility: "private", content: "I write the way I talk.\n", etag: "e1" } });
  assert.deepEqual(noteSaveRequest({ ...doc, exists: false, etag: "stale" }, "New."), { method: "PUT", body: { contextType: "author", visibility: "private", content: "New.\n", etag: null } }, "a new note says there was none");
  assert.deepEqual(noteSaveRequest(doc, "   \n"), { method: "DELETE", body: { contextType: "author", visibility: "private", etag: "e1" } });
  assert.deepEqual(noteSaveRequest({ ...doc, exists: false }, ""), { none: true });
  assert.deepEqual(noteSaveRequest({ ...doc, visibility: "portable" }, "x").body.visibility, "portable", "a shared note stays shared");
  assert.deepEqual(noteSaveRequest(doc, "é".repeat(NOTE_MAX_BYTES / 2)), { problem: "too-long" });
  // A post note sends its five parts, never a file.
  const post = { contextType: "post", visibility: "private", exists: false, etag: null };
  assert.deepEqual(noteSaveRequest(post, { audience: " New bakers ", goal: "A first crust" }, { path: "posts/pie.md" }), {
    method: "PUT", body: { contextType: "post", visibility: "private", documentPath: "posts/pie.md", fields: { goal: "A first crust", audience: "New bakers", learningOutcomes: "", sources: "", constraints: "" }, etag: null },
  });
  assert.deepEqual(noteSaveRequest({ ...post, exists: true, etag: "p" }, { audience: " ", goal: "" }, { path: "posts/pie.md" }), { method: "DELETE", body: { contextType: "post", visibility: "private", documentPath: "posts/pie.md", etag: "p" } });
});

test("a note that didn't save says why in her words, and where it's kept is for the helper person", () => {
  configureWords();
  assert.deepEqual(noteProblem({ status: 0 }), { words: "Waiting for a signal to save this note. It's kept while this page is open.", conflict: false, signal: true });
  assert.equal(noteProblem({ status: 409 }).words, "This note was changed somewhere else. Here it is now; make your change again.");
  assert.equal(noteProblem({ status: 409 }).conflict, true);
  assert.equal(noteProblem({ status: 413 }).words, "That's too long for your helper. Shorten it a little.");
  assert.equal(noteProblem({ status: 500, message: "disk full at /srv" }).words, "That note wasn't saved. Try again.");
  assert.equal(keptWords({ contextType: "author", visibility: "private", name: "author.md" }), "Kept private: .openblog/private/context/author.md, out of Git.");
  assert.equal(keptWords({ contextType: "post", visibility: "portable", name: "pie.md" }), "Shared with the project: assistant/context/posts/pie.md, in Git.");
});

test("a text she adds needs a safe name, and a web page needs a whole address", () => {
  for (const name of ["style.md", "notes-2.txt", "A_b.md"]) assert.equal(referenceNameOk(name), true, name);
  for (const name of ["", "style", "../x.md", "a/b.md", ".hidden.md", "x.html", "name with space.md"]) assert.equal(referenceNameOk(name), false, name);
  assert.equal(pageAddressOk("https://example.com/a?b=1"), true);
  for (const address of ["", "example.com", "ftp://example.com", "https://user:pw@example.com/", "javascript:alert(1)"]) assert.equal(pageAddressOk(address), false, address);
  assert.equal(pageFileId("https://www.Example.com/some/page"), "www-example-com");
  assert.equal(pageFileId("not an address"), "page");
});

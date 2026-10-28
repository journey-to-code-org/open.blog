import test from "node:test";
import assert from "node:assert/strict";

import { Editor, VOICE_REQUEST_BUDGET, assistantContextDisclosure, assistantContextLabel, assistantReviewSummary, assistantVoiceBudget } from "../../web/admin/admin.js";

const sample = (name, characters, extra = {}) => ({
  id: `voice:private:${name}`,
  kind: "voiceSample",
  name,
  path: `.openblog/private/context/voice/${name}`,
  visibility: "private",
  stage: "rough",
  pack: "stories",
  prompt: "a-mistake-i-made",
  characters,
  exists: true,
  valid: true,
  ...extra,
});

test("a voice sample is disclosed with its stage, pack, visibility and size", () => {
  const document = sample("2026-10-28-a-mistake-i-made-rough.md", 120);
  assert.equal(assistantContextLabel(document), ".openblog/private/context/voice/2026-10-28-a-mistake-i-made-rough.md · Voice sample · rough · stories · Private · 120 characters");
  const disclosure = assistantContextDisclosure([document], new Set([document.id]));
  assert.deepEqual(disclosure.documents[0], { name: document.name, visibility: "private", characters: 120, kind: "voiceSample", path: document.path, stage: "rough", pack: "stories" });
  assert.equal(disclosure.totalCharacters, 120);
  assert.deepEqual(assistantReviewSummary({ context: [document], selectedContextIds: new Set([document.id]) }).context, [assistantContextLabel(document)]);
});

test("existing context kinds keep their disclosure wording", () => {
  const author = { id: "portable:author", name: "author.md", visibility: "portable", characters: 5, exists: true, valid: true };
  assert.equal(assistantContextLabel(author), "author.md · Portable · 5 characters");
  assert.deepEqual(assistantContextDisclosure([author], new Set([author.id])).documents, [{ name: "author.md", visibility: "portable", characters: 5 }]);
});

test("the voice budget counts selected, valid samples only", () => {
  const documents = [sample("a-rough.md", 100), sample("b-rough.md", 50), sample("c-rough.md", 10, { valid: false }), { id: "portable:author", name: "author.md", characters: 999999, exists: true, valid: true }];
  const budget = assistantVoiceBudget(documents, new Set(documents.map((document) => document.id)));
  assert.equal(budget.samples, 2);
  assert.equal(budget.characters, 150);
  assert.equal(budget.over, false);
  assert.equal(budget.message, "");
  assert.equal(assistantVoiceBudget(documents, new Set()).samples, 0);
});

test("a selection over the request budget is refused with a plain reason", () => {
  const tooMany = Array.from({ length: VOICE_REQUEST_BUDGET.samples + 1 }, (_, index) => sample(`s${index}-rough.md`, 10));
  const many = assistantVoiceBudget(tooMany, new Set(tooMany.map((document) => document.id)));
  assert.equal(many.over, true);
  assert.match(many.message, /at most 8/);
  const tooLong = [sample("long-rough.md", VOICE_REQUEST_BUDGET.characters + 1)];
  const long = assistantVoiceBudget(tooLong, new Set([tooLong[0].id]));
  assert.equal(long.over, true);
  assert.match(long.message, /at most 120000/);
  const custom = assistantVoiceBudget(tooLong, new Set([tooLong[0].id]), { samples: 2, characters: 500000 });
  assert.equal(custom.over, false);
});

function autocompleteEditor(call, documents, selected) {
  const editor = new Editor({ meta: {}, api: { call } }, { kind: "posts", path: "posts/draft.md", fields: {}, body: "" });
  const value = "The lantern opened into a quiet hall";
  editor.ui = {
    body: { value, selectionStart: value.length, selectionEnd: value.length },
    title: { value: "Unsaved title" },
    assistantCompletion: { hidden: true },
    assistantCompletionText: { textContent: "" },
    assistantAutocompleteStatus: { textContent: "" },
  };
  editor.editorMode = "markdown";
  editor.assistantAutocompleteEnabled = true;
  editor.assistantAutocompleteGeneration = 1;
  editor.assistantContextDocuments = documents;
  editor.assistantContextSelected = new Set(selected);
  editor.collect = () => ({ draft: "true" });
  return editor;
}

test("autocomplete refuses an over-budget voice selection before any request", async () => {
  const calls = [];
  const documents = Array.from({ length: 9 }, (_, index) => sample(`s${index}-rough.md`, 10));
  const editor = autocompleteEditor(async (...args) => calls.push(args), documents, documents.map((document) => document.id));
  await editor.requestAssistantAutocomplete(1);
  assert.deepEqual(calls, []);
  assert.match(editor.ui.assistantAutocompleteStatus.textContent, /at most 8/);
});

test("autocomplete names selected voice samples by id and sends nothing else about them", async () => {
  const calls = [];
  const documents = [sample("a-rough.md", 10)];
  const editor = autocompleteEditor(async (method, path, request) => {
    calls.push({ method, path, request });
    return { completion: "" };
  }, documents, [documents[0].id]);
  await editor.requestAssistantAutocomplete(1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request.json.contextIds, ["voice:private:a-rough.md"]);
  assert.equal(JSON.stringify(calls[0].request).includes("characters"), false, "the browser names a sample; it never supplies its text or size");
});

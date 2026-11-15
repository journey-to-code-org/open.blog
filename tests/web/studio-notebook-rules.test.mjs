// The notebook's rules (Studio R11), ported from the old Admin's admin-research-notebook.test.mjs:
// its pure cases keep their behaviour, with places as rows instead of typed lines and messages as
// word ids. The old view cases (capture with a note, a partial save, a scoped rejection, a stale
// revision, lists, search, backlinks, remove, archive, export and import) are
// studio-notebook.spec.mjs and studio-research.spec.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import {
  captureSources, entryPreview, filterCount, formatLocatorLines, hitContext, locatorText, noteDraft, noteDraftPayload, noteKindWords, notebookDiagnosticControl,
  notebookImportRows, notebookImportSummary, notebookSearchBody, parseConceptList, parseLocatorLines, passageDraft, passageDraftPayload, placeRows, placeText,
  rowsToLocators, searchIsActive, suggestEntryId, validateNoteDraft, validatePassageDraft, badPlace,
} from "../../web/studio/parts/notebook-rules.js";

const HOSTILE = `<img src=x onerror=alert(1)> ἰδὲ γὰρ "quoted" & [link](javascript:x)`;
const SOURCES = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία" },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam" },
  { id: "old", kind: "edition", of: "plato-republic", title: "Old", archived: true },
];
const PASSAGE = () => ({
  id: "passage-1", source: "slings-2003",
  excerpt: { text: HOSTILE, language: "grc", scan: "p1.png" },
  locators: [{ kind: "page", value: "514", hint: true }, { kind: "canonical", value: "514a", to: "520a" }],
  visibility: "private", extra: 1,
});
const NOTE = () => ({ id: "note-2", kind: "question", text: "Why a cave?", passages: ["passage-1"], sources: ["plato-republic"], concepts: ["allegory"], visibility: "private" });

test("places parse one per line (the old form), keep ranges, and format back losslessly; rows keep them as they are", () => {
  const lines = "page: 514\nfolio: 12r\ncanonical: 514a to 520a\nx-stephanus: 514a\n\nloose";
  assert.deepEqual(parseLocatorLines(lines), [
    { kind: "page", value: "514" }, { kind: "folio", value: "12r" }, { kind: "canonical", value: "514a", to: "520a" }, { kind: "x-stephanus", value: "514a" }, { kind: "", value: "loose" },
  ]);
  const stored = PASSAGE().locators;
  assert.deepEqual(parseLocatorLines(formatLocatorLines(stored)), [{ kind: "page", value: "514" }, stored[1]]);
  assert.deepEqual(parseConceptList("Allegory, the-good  allegory\n"), ["allegory", "the-good"]);
  assert.deepEqual(parseConceptList(["Allegory", "the-good", "allegory"]), ["allegory", "the-good"], "a tag list reads the same");
  assert.deepEqual(placeRows(stored), [{ kind: "page", value: "514", to: "" }, { kind: "canonical", value: "514a", to: "520a" }]);
  assert.deepEqual(rowsToLocators([{ kind: "page", value: " 515 ", to: "" }, { kind: "", value: "", to: "" }, { kind: "line", value: "3", to: " 5 " }]), [{ kind: "page", value: "515" }, { kind: "line", value: "3", to: "5" }]);
  assert.equal(badPlace([{ kind: "page", value: "1" }, { kind: "page", value: "" }]), 2);
  assert.equal(badPlace([{ kind: "page", value: "1" }]), 0);
});

test("a place reads in her words", () => {
  assert.equal(placeText({ kind: "page", value: "514" }), "page 514");
  assert.equal(placeText({ kind: "canonical", value: "514a", to: "520a" }), "canonical place 514a to 520a");
  assert.equal(placeText({ kind: "timestamp", value: "1:02:30" }), "time 1:02:30");
  assert.equal(placeText({ kind: "x-csl-folio-side", value: "12v" }), "folio-side 12v");
  assert.equal(locatorText(PASSAGE().locators), "page 514, canonical place 514a to 520a");
});

test("a passage payload sends the exact words and carries every unknown field", () => {
  const stored = PASSAGE();
  assert.deepEqual(passageDraftPayload(passageDraft(stored)), stored, "an untouched draft is the stored passage");
  assert.equal(JSON.stringify(passageDraftPayload(passageDraft(stored))), JSON.stringify(stored), "in the same order");
  const draft = passageDraft(stored);
  draft.excerpt = `  ${HOSTILE}\n\n  second paragraph  `;
  draft.language = "";
  draft.locators = [{ kind: "page", value: "515", to: "" }];
  const payload = passageDraftPayload(draft);
  assert.equal(payload.excerpt.text, `  ${HOSTILE}\n\n  second paragraph  `, "quoted words are neither trimmed nor interpreted");
  assert.equal(payload.excerpt.scan, "p1.png");
  assert.equal("language" in payload.excerpt, false);
  assert.deepEqual(payload.locators, [{ kind: "page", value: "515" }]);
  assert.equal(payload.extra, 1);
  const fresh = Object.assign(passageDraft(null, "slings-2003"), { id: "passage-9", excerpt: "x" });
  assert.deepEqual(passageDraftPayload(fresh), { id: "passage-9", source: "slings-2003", excerpt: { text: "x" } });
});

test("a note payload keeps unknown fields and drops emptied links", () => {
  const stored = NOTE();
  assert.deepEqual(noteDraftPayload(noteDraft(stored)), stored);
  const draft = noteDraft({ ...stored, mood: "curious" });
  draft.passages = [];
  draft.concepts = [];
  const payload = noteDraftPayload(draft);
  assert.equal(payload.mood, "curious");
  assert.equal("passages" in payload, false);
  assert.equal("concepts" in payload, false);
});

test("the advisory checks name the first problem and the control that fixes it", () => {
  const sources = SOURCES();
  const check = (changes) => validatePassageDraft(Object.assign(passageDraft(null), changes), sources);
  assert.equal(check({ excerpt: "x" }).field, "source");
  assert.equal(check({ source: "absent", excerpt: "x" }).id, "notebook.badSource");
  assert.equal(check({ source: "slings-2003", excerpt: "  \n " }).field, "excerpt");
  assert.equal(check({ source: "slings-2003", excerpt: "ὁ".repeat(20001) }).field, "excerpt");
  assert.equal(check({ source: "slings-2003", excerpt: "ὁ".repeat(20000) }), null, "long Unicode is counted by character");
  assert.deepEqual(check({ source: "slings-2003", excerpt: "x", locators: [{ kind: "page", value: "" }] }), { field: "locators", id: "notebook.badPlace", vars: { n: 1 }, row: 0 });
  assert.equal(check({ source: "slings-2003", excerpt: "x", locators: Array(9).fill({ kind: "page", value: "1" }) }).id, "notebook.placeLimit");
  assert.equal(validateNoteDraft(noteDraft()).field, "text");
  assert.equal(validateNoteDraft({ ...noteDraft(), text: "ok", concepts: ["Bad Concept!"] }).field, "concepts");
  assert.equal(validateNoteDraft({ ...noteDraft(), text: "ok", concepts: ["fine", "ok-too"] }), null);
  assert.equal(notebookDiagnosticControl("excerpt.text"), "excerpt");
  assert.equal(notebookDiagnosticControl("excerpt.language"), "language");
  assert.equal(notebookDiagnosticControl("locators[1].value"), "locators");
  assert.equal(notebookDiagnosticControl("source"), "source");
  assert.equal(notebookDiagnosticControl("unheard"), "");
});

test("ids are fresh, archived sources are not offered, and previews never split a character", () => {
  assert.equal(suggestEntryId("passage", []), "passage-1");
  assert.equal(suggestEntryId("note", ["passage-1", "note-2"]), "note-3");
  assert.equal(suggestEntryId("note", ["note-3", "a", "b"]), "note-4");
  const offered = captureSources(SOURCES()).map((source) => source.id);
  assert.equal(offered.length, 2);
  assert.ok(!offered.includes("old"));
  assert.equal(entryPreview({ excerpt: { text: "🙂".repeat(200) } }, 10), `${"🙂".repeat(9)}…`);
  assert.equal(entryPreview({ text: "a\n\n  b" }), "a b");
});

test("search bodies carry only the filters that are set, and never go in an address", () => {
  assert.deepEqual(notebookSearchBody({}), {});
  assert.deepEqual(notebookSearchBody({ query: " the cave ", source: "slings-2003", locator: "page", concept: "allegory", state: "open" }), { q: "the cave", source: "slings-2003", locator: "page", concept: "allegory", state: "open" });
  assert.deepEqual(notebookSearchBody({ query: "a&b=c#" }), { q: "a&b=c#" });
  assert.equal(searchIsActive({ query: "  " }), false);
  assert.equal(searchIsActive({ state: "resolved" }), true);
  assert.equal(filterCount({ query: "x", source: "a", archived: true }), 2, "the words aren't a filter");
  assert.equal(hitContext({ matched: ["excerpt", "source", "excerpt"] }), "the exact words, the source");
  assert.equal(hitContext({ matched: ["text"] }), "your note");
  assert.equal(hitContext({}), "");
});

test("a question can be marked answered, an unset state stays unwritten, and an observation never carries one", () => {
  const question = { id: "q", kind: "question", text: "Why?" };
  assert.equal(noteDraft(question).status, "open");
  assert.ok(!("status" in noteDraftPayload(noteDraft(question))), "an untouched question stays as stored");
  const resolved = noteDraft(question);
  resolved.status = "resolved";
  assert.equal(noteDraftPayload(resolved).status, "resolved");
  const reopened = noteDraft({ ...question, status: "resolved" });
  reopened.status = "open";
  assert.equal(noteDraftPayload(reopened).status, "open", "a state she wrote is kept when reopened");
  const observation = noteDraft({ ...question, status: "resolved" });
  observation.kind = "observation";
  assert.ok(!("status" in noteDraftPayload(observation)));
  assert.equal(noteKindWords({ kind: "question", status: "resolved" }), "Question · answered");
  assert.equal(noteKindWords({ kind: "question" }), "Question · open");
  assert.equal(noteKindWords({ kind: "observation" }), "Observation");
});

test("the search body asks for archived entries only when shown, and copy previews never hold entry text", () => {
  assert.deepEqual(notebookSearchBody({ query: "x", archived: true }), { q: "x", includeArchived: true });
  assert.deepEqual(notebookSearchBody({ query: "x", archived: false }), { q: "x" });
  const plan = { counts: { create: 1, unchanged: 2, conflict: 1 }, entries: [
    { id: "a", collection: "notes", action: "create", text: "PRIVATE" },
    { id: "b", collection: "passages", action: "unchanged" },
    { id: "c", collection: "passages", action: "conflict", message: "a different passage in this notebook already uses this id" },
  ] };
  assert.equal(notebookImportSummary(plan), "1 to add, 2 already here, 1 in conflict.");
  assert.deepEqual(notebookImportRows(plan).map((row) => [row.action, row.name]), [["create", "Note a"], ["conflict", "Passage c"]]);
  assert.doesNotMatch(JSON.stringify(notebookImportRows(plan)), /PRIVATE/);
});

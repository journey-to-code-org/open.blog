// Citations in her words (Studio R11), ported from the old Admin's admin-citations.test.mjs: the
// pure cases keep their behaviour, with places as rows and messages as word ids. Visual mode's
// cases went with Visual mode (Studio's words box is the Markdown); the dialog's cases are
// studio-cite.spec.mjs. New: chips per box, taking a citation out, and the first citation's notes.
import assert from "node:assert/strict";
import test from "node:test";

import {
  citationAt, citationDraftPayload, citationFailure, citationInsertionProblem, citationLabel, citationLocatorsFromPassage, citationProblem, citationReadable,
  citationSourceChoices, citationSpans, citationStyleField, citationsIn, formatCitationText, insertCitationText, parseCitationText, removeCitation, shortPlaces,
  validateCitationDraft,
} from "../../web/studio/parts/cite-rules.js";
import { pieceChange, undoPieceChange } from "../../web/studio/parts/word-blocks.js";

class ApiError extends Error { constructor(message, status, data) { super(message); this.status = status; this.data = data; } }
const SOURCES = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία", creators: [{ name: "Plato" }] },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam", creators: [{ name: "S. R. Slings" }] },
  { id: "old-edition", kind: "edition", title: "Old", archived: true },
];
const PASSAGES = () => [{ id: "passage-1", source: "slings-2003", preview: "ὁ δὲ Σωκράτης <b>", locators: [{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a" }] }];

test("citation spans skip code, escapes, links and definitions, and keep Unicode offsets", () => {
  const markdown = [
    "Intro [@slings-2003, page 5] and `[@code]` and \\[@escaped] and [@link](https://example.com) and [@ref][r].",
    "```", "[@fenced]", "```",
    "[@def]: https://example.com",
    "Πολιτεία [@plato-republic, section Βιβλίον ζ] 🙂 [@Bad Key]",
  ].join("\n");
  const spans = citationSpans(markdown);
  assert.deepEqual(spans.map((span) => span.text), ["[@slings-2003, page 5]", "[@plato-republic, section Βιβλίον ζ]", "[@Bad Key]"]);
  for (const span of spans) assert.equal(markdown.slice(span.start, span.end), span.text);
  assert.equal(citationAt(markdown, markdown.indexOf("page 5"))?.text, "[@slings-2003, page 5]");
  assert.equal(citationAt(markdown, markdown.indexOf("] and `") + 1), null, "a caret just after a citation adds a new one");
  assert.equal(citationAt(markdown, spans[0].start, spans[0].end)?.text, spans[0].text);
  assert.equal(citationAt(markdown, markdown.indexOf("[@code]") + 3), null);
});

test("citation text parses to parts and formats back, with ranges and Unicode", () => {
  for (const text of ["[@plato-republic]", "[@slings-2003, page 514 to 520; canonical 514a; section Βιβλίον ζ]", "[@x, x-stephanus 514a]"]) {
    assert.equal(formatCitationText(parseCitationText(text)), text);
  }
  assert.deepEqual(parseCitationText("[@slings-2003, page 514 to 520]"), { key: "slings-2003", locators: [{ kind: "page", value: "514", to: "520" }] });
  assert.equal(parseCitationText("[see](x)"), null);
  assert.equal(parseCitationText("[@a] tail"), null);
  assert.equal(citationReadable(parseCitationText("[@Bad Key]")), false);
  assert.equal(citationReadable(parseCitationText("[@ok, page]")), false, "a place needs a value");
  assert.equal(citationReadable(parseCitationText("[@ok, wizard 5]")), false);
  assert.equal(citationReadable(parseCitationText("[@ok, x-side 5; page 2 to 3]")), true);
});

test("a passage's places are copied as kind, value and end only", () => {
  const passage = { ...PASSAGES()[0], locators: [{ kind: "page", value: "514", hint: true, privateNote: "no" }, { kind: "canonical", value: "514a", to: "520a", scan: "p1.png" }, { kind: 5 }] };
  assert.deepEqual(citationLocatorsFromPassage(passage), [{ kind: "page", value: "514" }, { kind: "canonical", value: "514a", to: "520a" }]);
  assert.deepEqual(citationDraftPayload({ source: "slings-2003", locators: [{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a", to: "" }] }), {
    key: "slings-2003", locators: [{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a" }],
  });
  assert.deepEqual(citationDraftPayload({ source: "slings-2003", locators: "page: 514 to 520\ncanonical: 514a" }).locators.length, 2, "the old lines still read");
});

test("inserting changes only the insertion point, and replacing changes only the edited citation", () => {
  const draft = "Claim one[^1] and a claim.\n\n[^1]: A hand-written footnote [@not-touched].\n";
  const at = draft.indexOf(" and");
  const inserted = insertCitationText(draft, at, at, "[@slings-2003, page 5]");
  assert.equal(inserted.value, "Claim one[^1] [@slings-2003, page 5] and a claim.\n\n[^1]: A hand-written footnote [@not-touched].\n");
  assert.equal(inserted.start, at + " [@slings-2003, page 5]".length);
  assert.equal(inserted.start, inserted.end);
  assert.equal(insertCitationText("A claim ", 8, 8, "[@x]").value, "A claim [@x]");
  assert.equal(insertCitationText("Keep this selected.", 5, 18, "[@x]").value, "Keep this selected [@x].", "the selected words stay and the citation follows them");
  assert.equal(insertCitationText("A claim(x)", 7, 7, "[@x]").value, "A claim [@x] (x)", "a ( right after would make it a link");
  const span = citationSpans(draft).find((item) => item.text === "[@not-touched]");
  assert.equal(insertCitationText(draft, span.start + 3, span.start + 3, "[@slings-2003]", span).value, draft.replace("[@not-touched]", "[@slings-2003]"));
});

test("advisory checks and failures point at the right field, in her words", () => {
  assert.deepEqual(validateCitationDraft({ source: "", locators: [] }, SOURCES()), { field: "source", id: "cite.needSource" });
  assert.equal(validateCitationDraft({ source: "gone", locators: [] }, SOURCES()).id, "cite.notInLibrary");
  assert.deepEqual(validateCitationDraft({ source: "slings-2003", locators: [{ kind: "page", value: "" }] }, SOURCES()), { field: "locators", id: "cite.badPlace", vars: { n: 1 }, row: 0 });
  assert.equal(validateCitationDraft({ source: "slings-2003", locators: Array(9).fill({ kind: "line", value: "1" }) }, SOURCES()).id, "cite.tooManyPlaces");
  assert.equal(validateCitationDraft({ source: "slings-2003", locators: [{ kind: "page", value: "5" }] }, SOURCES()), null);
  assert.equal(citationFailure(new ApiError("x", 422, { diagnostics: [{ code: "unknown-key", message: "no source" }] })).field, "source");
  assert.equal(citationFailure(new ApiError("x", 422, { diagnostics: [{ code: "ambiguous-locator", message: "page on a work" }] })).field, "locators");
  assert.deepEqual(citationProblem(new ApiError("x", 409, { error: "changed" })), { field: "source", id: "cite.libraryChanged" });
  assert.equal(citationProblem(new ApiError("offline", 0)).id, "cite.waiting", "no signal waits; it doesn't fail");
  assert.equal(citationProblem(new ApiError("x", 422, { diagnostics: [{ code: "too-many-citations" }] })).id, "cite.tooMany");
  assert.deepEqual(citationSourceChoices(SOURCES(), "", "").map((source) => source.id), ["slings-2003", "plato-republic"], "archived sources are not offered");
  assert.deepEqual(citationSourceChoices(SOURCES(), "", "old-edition").map((source) => source.id).sort(), ["old-edition", "plato-republic", "slings-2003"]);
  assert.deepEqual(citationSourceChoices(SOURCES(), "πολι").map((source) => source.id), ["plato-republic"]);
});

test("a citation can't go inside code or link text", () => {
  const markdown = "See [the [@kept] link](https://example.com) and `code` here.\n\n```\nfenced\n```\n";
  assert.equal(citationInsertionProblem(markdown, markdown.indexOf("the")), "link");
  assert.equal(citationInsertionProblem(markdown, markdown.indexOf("example")), "link");
  assert.equal(citationInsertionProblem(markdown, markdown.indexOf("ode")), "code");
  assert.equal(citationInsertionProblem(markdown, markdown.indexOf("fenced")), "code");
  assert.equal(citationInsertionProblem(markdown, markdown.indexOf(" and")), "");
  assert.equal(citationInsertionProblem(markdown, 0), "");
  assert.equal(citationInsertionProblem(markdown, markdown.indexOf(" here")), "");
});

test("a citation can't go in autolinks, indented code, spans and links over lines, or HTML", () => {
  const at = (markdown, needle, shift = 1) => citationInsertionProblem(markdown, markdown.indexOf(needle) + shift);
  assert.equal(at("See <https://example.com/a> now.", "example"), "link");
  assert.equal(at("Write <someone@example.com> now.", "example"), "link");
  assert.equal(at("See <https://example.com/a> now.", " now"), "");
  assert.equal(at("Text.\n\n    indented code\n", "code"), "code");
  assert.equal(at("Text.\n\n\tindented code\n", "code"), "code");
  assert.equal(at("Text\n    continued here.\n", "continued"), "");
  assert.equal(at("A `code\nspan` here.", "span", 0), "code");
  assert.equal(at("A `code\nspan` here.", " here"), "");
  assert.equal(at("A [link\ntext](https://example.com) end.", "text"), "link");
  assert.equal(at("A [link](https://\nexample.com) end.", "example"), "link");
  assert.equal(at("A [link\ntext](https://example.com) end.", " end"), "");
  assert.equal(at("Text <!-- a\nnote --> after.", "note"), "html");
  assert.equal(at("Text <!-- a\nnote --> after.", " after"), "");
  assert.equal(at("<!--\nhidden\n-->\n\nVisible.", "hidden"), "html");
  assert.equal(at("<!--\nhidden\n-->\n\nVisible.", "Visible"), "");
  assert.equal(at("<div>\ninside block\n</div>\n\nOutside.", "inside"), "html");
  assert.equal(at("<div>\ninside block\n</div>\n\nOutside.", "Outside"), "");
  assert.equal(at("<span class=\"x\">\n\nAfter.", "class"), "html");
  assert.equal(at("Text <span title=\"a b\">kept</span>.", "a b"), "html");
  assert.equal(at("Text <span title=\"a b\">kept</span>.", "kept"), "");
  assert.equal(at("<pre>\nraw\n\nstill raw\n</pre>\nAfter.", "still"), "html");
  assert.equal(at("[label]: https://example.com\n", "example"), "link");
  assert.equal(at("> Quoted text.\n", "Quoted"), "");
  assert.equal(at("- Listed text.\n", "Listed"), "");
  assert.equal(at("> ```\n> fenced\n> ```\n", "fenced"), "code");
  assert.equal(at("- ```\n  fenced\n  ```\n", "fenced"), "code");
});

test("chips: one per citation outside code, never inside a link, in reading order", () => {
  const box = "See [the [@in-link] story](https://x) and `[@in-code]`. Shadows [@slings-2003, page 514] and [@Bad Key] and [@gone].";
  const chips = citationsIn(box);
  assert.deepEqual(chips.map((chip) => chip.text), ["[@slings-2003, page 514]", "[@Bad Key]", "[@gone]"]);
  assert.deepEqual(chips.map((chip) => chip.readable), [true, false, true]);
  assert.equal(chips[1].citation, null, "a citation that can't be read offers Show me only");
  assert.equal(citationLabel(chips[0].citation, SOURCES()), "Platonis Rempublicam, p. 514");
  assert.equal(citationLabel(chips[2].citation, SOURCES()), "gone", "a key not in the library shows as itself");
  assert.equal(citationLabel(chips[0].citation, []), "slings-2003, p. 514", "with no library loaded, the key");
  assert.equal(shortPlaces([{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a" }, { kind: "timestamp", value: "1:02" }, { kind: "x-folio-side", value: "12v" }]), "pp. 514–520, 514a, at 1:02, folio side 12v");
  assert.deepEqual(citationsIn(""), []);
});

test("taking a citation out removes it and one space beside it, and Undo puts back the exact words", () => {
  const box = "Shadows [@slings-2003, page 514] and fire.";
  const [span] = citationsIn(box);
  const out = removeCitation(box, span);
  assert.deepEqual(out, { text: "Shadows and fire.", at: 7 });
  assert.equal(removeCitation("[@a] starts", citationsIn("[@a] starts")[0]).text, "starts", "with no space before, the one after");
  assert.equal(removeCitation(box, { ...span, text: "[@other]" }), null, "a span that moved isn't taken out");
  const change = pieceChange(box, out.text);
  assert.equal(undoPieceChange(change, out.text).text, box);
  const typedSince = `${out.text} More words.`;
  assert.equal(undoPieceChange(change, typedSince).text, `${box} More words.`, "what she typed since stays");
});

test("the first citation turns on numbered notes once; a post that chose keeps its choice", () => {
  assert.equal(citationStyleField({}, true), "notes");
  assert.equal(citationStyleField({ citations: "" }, true), "notes");
  assert.equal(citationStyleField({ citations: "bibliography" }, true), null);
  assert.equal(citationStyleField({ citations: "false" }, true), null, "a written choice, even off, is hers");
  assert.equal(citationStyleField({}, false), null, "not the first: nothing changes");
});

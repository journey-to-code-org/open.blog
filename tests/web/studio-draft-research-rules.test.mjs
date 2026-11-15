// Your research's rules (Studio R11), ported from the old Admin's admin-draft-research.test.mjs:
// someone else's words written so they render exactly, a quotation ends with its citation, a note
// she turns into her own words, where a block goes, what the list holds and who sees each. The
// editor and Visual-mode cases went with Visual mode; the panel's cases are
// studio-cite.spec.mjs. (Abstract and References are R6's, in studio-research-sections.)
import assert from "node:assert/strict";
import test from "node:test";

import {
  contextLinkMarkdown, convertedNoteMarkdown, draftResearchItems, insertMarkdownBlock, languageTag, literalMarkdownLine, quotationMarkdown, rightsAsk,
} from "../../web/studio/parts/draft-research-rules.js";
import { joinBlocks, parseQuotation, quotedWords, splitBlocks } from "../../web/studio/parts/word-blocks.js";

const rendered = (markdown) => markdown
  .replace(/\\([\\*_`[\]])/g, "$1")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const DATA = () => ({
  library: {
    revision: "lib-1",
    sources: [
      { id: "plato", kind: "work", title: "Πολιτεία" },
      { id: "slings", kind: "edition", of: "plato", title: "Platonis Rempublicam", rightsStatus: { status: "publicDomain", label: "x" } },
      { id: "bloom", kind: "translation", of: "plato", language: "en", title: "The Republic of Plato", rightsStatus: { status: "unknown", label: "x" } },
      { id: "gone", kind: "edition", of: "plato", title: "Archived edition", archived: true },
    ],
    interpretations: [{ id: "reading-1", kind: "reading", source: "slings", locators: [{ kind: "page", value: "514" }], language: "en", text: "A reading of the cave" }],
  },
  notebook: {
    revision: "nb-1",
    passages: [
      { id: "cave", source: "slings", locators: [{ kind: "page", value: "514", to: "515" }], excerpt: { text: "ἰδὲ γὰρ *οἷον* [ἐν] <b>x</b>", language: "grc" }, notes: 1 },
      { id: "den", source: "bloom", locators: [], excerpt: { text: "Behold! human beings living in an underground den" }, notes: 0 },
    ],
    notes: [{ id: "why", kind: "question", status: "open", text: "PRIVATE-NOTE why a cave?", passages: ["cave"] }],
  },
  atlas: { publish: true, url: "/atlas/", entries: [{ id: "plato-person", kind: "person", label: "Plato", aliases: ["Aristocles"], approved: true, url: "/atlas/plato-person/" }] },
  comparisons: { publish: false, url: "/comparisons/", items: [{ id: "cave-places", label: "The cave", approved: true, url: null }] },
});

test("someone else's words are written so they render exactly and nothing in them becomes markup", () => {
  const hostile = [
    "<script>alert(1)</script> & &amp; [x](javascript:alert(1)) ![i](x) *em* _u_ `code` \\ | ~~s~~",
    "# not a heading", "> not a quote", "- not a list", "+ nor this", "1. not numbered", "2) nor this", "=====",
    "    not code, and trailing spaces  ", "\tTabbed", "[^1]: not a footnote [@not-a-citation]", "Ελληνικά and עברית stay as they are",
  ];
  for (const line of hostile) {
    const markdown = literalMarkdownLine(line);
    assert.equal(rendered(markdown), line, `${line} renders as written`);
    assert.doesNotMatch(markdown, /<|^[#>+=-]|^\d+[.)]|^\s|\s$|(?<!\\)\[@|~~|(?<!\\)[*_`[\]]/u, `${line} carries no live markup`);
  }
});

test("a quotation is a block quote of the exact words ending with its citation, and reads back as a card", () => {
  assert.equal(quotationMarkdown("One line.", "[@slings, page 514]"), "> One line. [@slings, page 514]");
  assert.equal(quotationMarkdown("\n\nFirst *line*\n\nsecond [line]\n\n", "[@s]"), "> First \\*line\\*\n> \n> second \\[line\\] [@s]", "blank lines at either end go; one inside is a paragraph break");
  assert.equal(quotationMarkdown("Text", "[@x](javascript:alert(1))"), "", "only a citation is accepted");
  assert.equal(quotationMarkdown("Text", ""), "");
  assert.equal(quotationMarkdown("   \n  ", "[@s]"), "", "no words, no quotation");
  assert.equal(convertedNoteMarkdown("My *own* thought\nwith two lines\n\n# and a second paragraph"), "My \\*own\\* thought\nwith two lines\n\n&#35; and a second paragraph");
  // What goes in is a quotation card, and its words read back exactly as kept.
  const words = "ἰδὲ γὰρ *οἷον* [ἐν] <b>x</b>\n\n  a second paragraph & more  ";
  const block = quotationMarkdown(words, "[@slings, page 514]");
  const text = `Before.\n\n${block}\n\nAfter.\n`;
  const blocks = splitBlocks(text);
  assert.deepEqual(blocks.map((b) => b.kind), ["", "quotation", ""]);
  assert.equal(joinBlocks(blocks), text);
  const quote = parseQuotation(blocks[1].source);
  assert.equal(quote.citation, "[@slings, page 514]");
  assert.deepEqual(quote.lines.map(quotedWords).filter((l) => l), ["ἰδὲ γὰρ *οἷον* [ἐν] <b>x</b>", "  a second paragraph & more  "], "exactly as kept, spaces too");
});

test("research links are made only for published atlas and aligned passages pages", () => {
  assert.equal(contextLinkMarkdown("Plato [the] *philosopher*", "/atlas/plato/"), "[Plato \\[the\\] \\*philosopher\\*](/atlas/plato/)");
  assert.equal(contextLinkMarkdown("The cave", "/comparisons/cave-places/"), "[The cave](/comparisons/cave-places/)");
  for (const url of ["javascript:alert(1)", "/atlas/../private/", "https://example.com/atlas/x/", "/atlas/x", "/notes/x/", "", null]) assert.equal(contextLinkMarkdown("Label", url), "", `${url} is never linked`);
  assert.equal(contextLinkMarkdown("   ", "/atlas/x/"), "");
});

test("a block goes after the paragraph the caret is in, never inside code or HTML", () => {
  const draft = "First line\nsecond line.\n\nNext paragraph.\n";
  const block = "> Q [@s]";
  const middle = insertMarkdownBlock(draft, 3, 8, block);
  assert.equal(middle.value, "First line\nsecond line.\n\n> Q [@s]\n\nNext paragraph.\n", "the paragraph is not split and the selection stays");
  assert.equal(middle.start, "First line\nsecond line.\n\n> Q [@s]".length);
  assert.equal(insertMarkdownBlock(draft, draft.length, draft.length, block).value, `${draft}\n${block}\n`);
  assert.equal(insertMarkdownBlock("", 0, 0, block).value, `${block}\n`);
  assert.equal(insertMarkdownBlock("A\n\n\n\nB", 3, 3, block).value, "A\n\n> Q [@s]\n\nB", "on a blank line it goes there, between blank lines");
  assert.equal(insertMarkdownBlock("- one\n- two\n\nAfter", 2, 2, block).value, "- one\n- two\n\n> Q [@s]\n\nAfter", "after a whole list");
  assert.deepEqual(insertMarkdownBlock("```\ncode\n```\n", 6, 6, block), { problem: "code" });
  assert.deepEqual(insertMarkdownBlock("<div>\nhtml\n</div>\n", 8, 8, block), { problem: "html" });
});

test("the list holds research by kind, private, keeps her notes out unless asked, and searches folded", () => {
  const keys = (items) => items.map((item) => `${item.type}:${item.id}`);
  const all = draftResearchItems(DATA(), "", "all");
  assert.ok(keys(all).includes("passage:cave"));
  assert.ok(!keys(all).includes("source:gone"), "archived sources are left out, as in Cite");
  assert.ok(!keys(all).some((key) => key.startsWith("note:")), "her notes are never listed under Everything");
  assert.doesNotMatch(JSON.stringify(all.map((item) => [item.title, item.preview])), /PRIVATE-NOTE/);
  assert.deepEqual(keys(draftResearchItems(DATA(), "", "notes")), ["note:why"]);
  assert.equal(draftResearchItems(DATA(), "", "notes")[0].visibility, "private");
  assert.deepEqual(keys(draftResearchItems(DATA(), "οιον", "all")), ["passage:cave"], "accents are folded");
  assert.deepEqual(keys(draftResearchItems(DATA(), "", "interpretations")), ["interpretation:reading-1"]);
  assert.equal(draftResearchItems(DATA(), "", "interpretations")[0].title, "Reading of Platonis Rempublicam");
  assert.equal(draftResearchItems(DATA(), "", "passages")[0].title, "Platonis Rempublicam, page 514 to 515");
  assert.deepEqual(draftResearchItems({}, "", "all"), []);
});

test("rights that ask once, and language tags safe for a lang attribute", () => {
  assert.equal(rightsAsk({ status: "unknown" }), true);
  assert.equal(rightsAsk({ status: "rightsReserved" }), true);
  assert.equal(rightsAsk(null), true, "no statement is nobody has checked");
  assert.equal(rightsAsk({ status: "publicDomain" }), false);
  assert.equal(languageTag("grc"), "grc");
  assert.equal(languageTag("en-GB"), "en-GB");
  assert.equal(languageTag("en\" onload=x"), "");
});

// Every research example post opens in Write's cards and saves back byte for byte (Studio R11):
// the repository's own research examples and the fixtures in tests/fixtures/research-posts
// (hand-written and broken citations, code, links, HTML, quotations in several scripts, CRLF, an
// unclosed fence). Their words split into boxes and cards and join back exactly; each quotation
// is a card and each citation outside code, links and HTML is a chip; a chip's Change with nothing
// changed would write the same words. The browser half is studio-research-examples.spec.mjs.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { joinBlocks, parseQuotation, splitBlocks } from "../../web/studio/parts/word-blocks.js";
import { cardForm, cardSummary } from "../../web/studio/parts/piece-words.js";
import { citationsIn, insertCitationText } from "../../web/studio/parts/cite-rules.js";

const repo = new URL("../../", import.meta.url).pathname;

/** Every research example post: a research post, one that chose a citation style, or one that cites. */
export function researchExamples() {
  const dirs = [join(repo, "tests/fixtures/research-posts"), join(repo, "content/posts"), join(repo, "tests/fixtures/portable-html"),
    ...readdirSync(join(repo, "examples"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(repo, "examples", e.name, "content/posts"))];
  const files = dirs.filter((dir) => existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((name) => name.endsWith(".md")).map((name) => join(dir, name)));
  return files.map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter(({ text }) => /^profile:\s*research\s*$/m.test(text) || /^citations:/m.test(text) || /\[@/.test(text));
}

/** A post's words: everything after its front matter, as Write's boxes hold them. */
export function bodyOf(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

const examples = researchExamples();

test("there are research examples to open, the fixtures among them", () => {
  assert.ok(examples.length >= 8, `found ${examples.length}`);
  for (const name of ["cave.md", "hand-written.md", "quotations.md", "crlf.md", "unclosed.md"]) assert.ok(examples.some((e) => e.file.endsWith(`research-posts/${name}`)), name);
});

for (const { file, text } of examples) {
  const name = file.slice(repo.length);
  test(`${name}: opens in boxes and cards and saves back byte for byte`, () => {
    const body = bodyOf(text);
    const blocks = splitBlocks(body);
    assert.equal(joinBlocks(blocks), body);
    for (const block of blocks) {
      if (block.type === "card") {
        // Every card draws without throwing, and a quotation's Change is Cite for its citation.
        cardSummary(block);
        if (block.kind === "quotation") {
          assert.equal(cardForm(block), "quotation");
          const quote = parseQuotation(block.source);
          assert.equal(block.source.slice(quote.at, quote.at + quote.citation.length), quote.citation);
        }
        continue;
      }
      // Each chip's Change, Done with nothing changed: the same words.
      for (const span of citationsIn(block.source)) {
        assert.equal(block.source.slice(span.start, span.end), span.text);
        const same = insertCitationText(block.source, span.start, span.end, span.text, span);
        assert.equal(same.value, block.source);
      }
    }
  });
}

test("the fixtures' quotations are cards and nothing else is", () => {
  const kinds = (file) => splitBlocks(bodyOf(examples.find((e) => e.file.endsWith(`research-posts/${file}`)).text)).filter((b) => b.type === "card").map((b) => b.kind);
  assert.deepEqual(kinds("cave.md").filter((k) => k === "quotation").length, 1);
  assert.deepEqual(kinds("quotations.md").filter((k) => k === "quotation").length, 3, "Greek, Hebrew and the escaped one; not the plain quote, the tip, two citations or a lazy line");
  assert.ok(kinds("quotations.md").includes("callout"));
  assert.deepEqual(kinds("crlf.md"), ["quotation"]);
  assert.ok(!kinds("unclosed.md").includes("quotation"), "inside a fence that never closes nothing is a card");
});

test("chips: citations outside code, links and HTML only, in reading order", () => {
  const body = bodyOf(examples.find((e) => e.file.endsWith("research-posts/hand-written.md")).text);
  const texts = splitBlocks(body).filter((b) => b.type === "words").flatMap((b) => citationsIn(b.source).map((s) => s.text));
  assert.deepEqual(texts, ["[@Manual Key]", "[@plato-republic, canonical 514a]", "[@plato-republic]"]);
  const readable = splitBlocks(body).filter((b) => b.type === "words").flatMap((b) => citationsIn(b.source)).map((s) => s.readable);
  assert.deepEqual(readable, [false, true, true], "a key with spaces can't be read: its chip offers Show me only");
});

// Her words as boxes and cards (Studio R6, parts/word-blocks.js). Safety first: every post in
// examples/ and content/ comes back byte for byte, a card that is taken out and put back gives the
// same bytes, and a fence that never ends leaves the rest as written.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addFootnote, addRoom, blockKind, fillBlock, insertBlock, joinBlocks, moveBlock, nextFootnote, removeBlock, replaceBlock,
  segmentAt, splitBlocks, splitChunks, withEndRoom,
} from "../../web/studio/parts/word-blocks.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : []; });
const bodyOf = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
const shape = (text) => splitBlocks(text).map((b) => `${b.type}:${b.kind}`);

test("every post in examples/ and content/ round-trips through splitBlocks/joinBlocks byte for byte", () => {
  const files = [...walk(join(repository, "examples")), ...walk(join(repository, "content"))];
  assert.ok(files.length > 20, `${files.length} posts`);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const value of [text, bodyOf(text), bodyOf(text).replace(/\n/g, "\r\n")]) {
      assert.equal(joinBlocks(splitBlocks(value)), value, file);
      const { lead, chunks } = splitChunks(value);
      assert.equal(lead + chunks.map((c) => c.source + c.gap).join(""), value, `${file} (chunks)`);
      // A box with nothing typed in it after a card writes nothing.
      assert.equal(joinBlocks(withEndRoom(splitBlocks(value))), value, `${file} (with room)`);
    }
  }
});

test("each kind of thing in her words is a card; everything else stays words", () => {
  const cases = [
    ["![Pie](/images/uploads/a.png)", "photo"],
    ["![Pie](https://example.com/a.png)", "photo-web"],
    ["> [!TIP]\n> x", "callout"],
    ["- [ ] a\n- [x] b", "tasklist"],
    ["| a | b |\n| --- | --- |\n| 1 | 2 |", "table"],
    ["```piece video\nprovider: youtube\n```", "piece"],
    ["```compare\nbefore: /a.png\n```", "compare"],
    ["```quiz\nQ?\n- [x] a\n- [ ] b\n```", "quiz"],
    ["```rust\nfn main() {}\n```", "code"],
    ["```rust runnable title=\"x\"\nfn main() {}\n```", "runnable"],
    ["~~~\ncode\n~~~", "code"],
    ["```demo git-sandbox\n```", "demo"],
    ["```quote\n```", "quote-form"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video-link"],
    ["https://codepen.io/a/pen/b", "codepen-link"],
    ["[^1]: A note.", "footnote"],
    ["<div class=\"x\">raw</div>", "html"],
    ["<!-- a comment -->", "html"],
    ["    indented code", "indented"],
  ];
  for (const [source, kind] of cases) assert.deepEqual(shape(`Words.\n\n${source}\n\nMore.`), ["words:", `card:${kind}`, "words:"], source);
  for (const words of ["1/2 cup flour", "<b>Bold</b> start", "Setext\n===", "---", "~~gone~~", "[ref]: /x", "- a\n- b", "> just a quote", "# Heading"]) {
    assert.deepEqual(shape(`Words.\n\n${words}\n\nMore.`), ["words:"], words);
  }
  assert.equal(blockKind("- item\n\n    continued", ""), "");
  assert.deepEqual(shape("- item\n\n    more of the item\n"), ["words:"], "indented text under a list item is the list's");
});

test("a fence that never ends makes the rest of the box words, as written, and says on which line", () => {
  const text = "Before.\n\n![P](/images/uploads/a.png)\n\n```js\nlet a;\n\n| a | b |\n| --- | --- |\n";
  const blocks = splitBlocks(text);
  assert.deepEqual(blocks.map((b) => `${b.type}:${b.kind}`), ["words:", "card:photo", "words:"]);
  assert.equal(blocks[2].asWritten, true);
  assert.equal(blocks[2].line, 5);
  assert.equal(blocks[2].source, "```js\nlet a;\n\n| a | b |\n| --- | --- |");
  assert.equal(joinBlocks(blocks), text);
  assert.equal(moveBlock(text, blocks[1].start, 1), null, "nothing moves into it");
});

test("typing into an empty box after a card, or between two, makes its own paragraph and keeps the ending", () => {
  const text = "Words.\n\n![P](/images/uploads/a.png)\n";
  let blocks = withEndRoom(splitBlocks(text));
  assert.equal(blocks.length, 3);
  blocks = fillBlock(blocks, 2, "After.");
  assert.equal(joinBlocks(blocks), "Words.\n\n![P](/images/uploads/a.png)\n\nAfter.\n");
  const two = "> [!TIP]\n> a\n\n> [!NOTE]\n> b";
  blocks = fillBlock(addRoom(splitBlocks(two), 1), 1, "Between.");
  assert.equal(joinBlocks(blocks), "> [!TIP]\n> a\n\nBetween.\n\n> [!NOTE]\n> b");
  blocks = fillBlock(addRoom(splitBlocks(`\n${two}`), 0), 0, "First.");
  assert.equal(joinBlocks(blocks), "\nFirst.\n\n> [!TIP]\n> a\n\n> [!NOTE]\n> b");
  // Emptied by her: the space around it closes up.
  blocks = splitBlocks("One.\n\n![P](/images/uploads/a.png)\n\nTwo.\n");
  assert.equal(joinBlocks(fillBlock(blocks, 2, "")), "One.\n\n![P](/images/uploads/a.png)\n");
});

test("insertBlock: in place of a line that is only /, else after the paragraph holding the caret", () => {
  const text = "One.\n\n/\n\nTwo.\n";
  const put = insertBlock(text, 7, "> [!TIP]\n> x");
  assert.equal(put.text, "One.\n\n> [!TIP]\n> x\n\nTwo.\n");
  assert.equal(put.text.slice(put.start, put.end), "> [!TIP]\n> x");
  assert.equal(insertBlock("One.\n\n/", 7, "| a |\n| --- |").text, "One.\n\n| a |\n| --- |");
  assert.equal(insertBlock("1/2 cup", 3, "X").text, "1/2 cup\n\nX", "1/2 cup is words, never the slash");
  assert.equal(insertBlock("First line\nsecond line.\n\nNext.", 2, "X").text, "First line\nsecond line.\n\nX\n\nNext.");
  assert.equal(insertBlock("", 0, "X").text, "X");
  assert.equal(insertBlock("Words.\n", undefined, "X").text, "Words.\n\nX\n");
  const fenced = "A.\n\n```js\nlet a;\n\nlet b;\n```\n\nB.";
  assert.equal(insertBlock(fenced, 12, "X").text, "A.\n\n```js\nlet a;\n\nlet b;\n```\n\nX\n\nB.", "never inside a fence");
});

test("Take it out, then put the old text back, is the exact bytes; moves swap neighbours and keep paragraphs apart", () => {
  const text = "Intro.\n\n![P](/images/uploads/a.png)\n\n> [!TIP]\n> x\n\nEnd.\n";
  const blocks = splitBlocks(text);
  const photo = blocks.find((b) => b.kind === "photo");
  const out = removeBlock(text, photo.start);
  assert.equal(out.text, "Intro.\n\n> [!TIP]\n> x\n\nEnd.\n");
  const down = moveBlock(text, photo.start, 1);
  assert.equal(down.text, "Intro.\n\n> [!TIP]\n> x\n\n![P](/images/uploads/a.png)\n\nEnd.\n");
  assert.equal(down.text.slice(down.start, down.start + photo.source.length), photo.source);
  const back = moveBlock(down.text, down.start, -1);
  assert.equal(back.text, text);
  assert.equal(moveBlock(text, splitBlocks(text)[0].start, -1), null);
  // A card right after a fence (no empty line) moves without joining what it lands next to.
  const tight = "Para.\n```js\nx\n```\nAfter.";
  const code = splitBlocks(tight).find((b) => b.kind === "code");
  assert.equal(moveBlock(tight, code.start, -1).text, "```js\nx\n```\n\nPara.\n\nAfter.");
  assert.equal(replaceBlock(text, photo.start, photo.source, "![Q](/images/uploads/b.png)").text, text.replace("![P](/images/uploads/a.png)", "![Q](/images/uploads/b.png)"));
  assert.equal(replaceBlock(text, photo.start + 1, photo.source, "x"), null, "a card that moved is not overwritten");
});

test("footnotes: the next free number at the caret, the note at the end", () => {
  assert.equal(nextFootnote("a[^1] b[^3]"), 2);
  const put = addFootnote("One.\n\nTwo.\n", 4, "  A   note. ");
  assert.equal(put.text, "One.[^1]\n\nTwo.\n\n[^1]: A note.\n");
  assert.equal(put.caret, 8);
});

test("segmentAt finds the block holding an offset", () => {
  const blocks = splitBlocks("A.\n\n![P](/images/uploads/a.png)\n\nB.");
  assert.equal(segmentAt(blocks, 0), 0);
  assert.equal(segmentAt(blocks, 6), 1);
  assert.equal(segmentAt(blocks, 40), 2);
});

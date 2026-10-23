import assert from "node:assert/strict";
import test from "node:test";

import { applyMarkdownCommand } from "../../web/admin/admin.js";

test("inline formatting wraps selections and selects placeholders", () => {
  assert.deepEqual(applyMarkdownCommand("make this clear", 5, 9, "bold"), {
    value: "make **this** clear",
    start: 7,
    end: 11,
  });
  assert.deepEqual(applyMarkdownCommand("", 0, 0, "italic"), {
    value: "_italic text_",
    start: 1,
    end: 12,
  });
});

test("link formatting preserves text and selects the URL for replacement", () => {
  assert.deepEqual(applyMarkdownCommand("read docs", 5, 9, "link"), {
    value: "read [docs](https://)",
    start: 12,
    end: 20,
  });
});

test("block formatting expands to complete selected lines", () => {
  assert.deepEqual(applyMarkdownCommand("Intro\nFirst\nSecond\nEnd", 8, 17, "quote"), {
    value: "Intro\n> First\n> Second\nEnd",
    start: 6,
    end: 22,
  });
  assert.equal(applyMarkdownCommand("# Old heading", 3, 3, "heading").value, "## Old heading");
});

test("block formatting respects newline selection boundaries", () => {
  assert.equal(applyMarkdownCommand("one\ntwo\nthree", 0, 4, "quote").value, "> one\ntwo\nthree");
  assert.equal(applyMarkdownCommand("\nnext", 0, 0, "heading").value, "## \nnext");
});

test("code formatting chooses inline or fenced Markdown", () => {
  assert.equal(applyMarkdownCommand("const x = 1", 0, 5, "code").value, "`const` x = 1");
  assert.equal(applyMarkdownCommand("one\ntwo", 0, 7, "code").value, "```\none\ntwo\n```");
  assert.equal(applyMarkdownCommand("a ` b", 0, 5, "code").value, "``a ` b``");
  assert.equal(applyMarkdownCommand("one\n```\ntwo", 0, 11, "code").value, "````\none\n```\ntwo\n````");
  assert.equal(applyMarkdownCommand("`foo", 0, 4, "code").value, "`` `foo ``");
  assert.equal(applyMarkdownCommand("foo`", 0, 4, "code").value, "`` foo` ``");
  assert.equal(applyMarkdownCommand("`foo`", 0, 5, "code").value, "`` `foo` ``");
  assert.equal(applyMarkdownCommand(" foo ", 0, 5, "code").value, "`  foo  `");
  assert.equal(applyMarkdownCommand("   ", 0, 3, "code").value, "`   `");
});

test("multiline code fences stay on their own lines beside prose", () => {
  const edit = applyMarkdownCommand("prefix one\ntwo suffix", 7, 14, "code");
  assert.equal(edit.value, "prefix \n```\none\ntwo\n```\n suffix");
  assert.deepEqual([edit.start, edit.end], [12, 19]);
  assert.equal(applyMarkdownCommand("one\ntwo\n", 0, 8, "code").value, "```\none\ntwo\n```");
});

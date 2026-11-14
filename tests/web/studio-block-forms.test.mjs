// The block forms' rules (Studio R6), ported from tests/web/admin-block-forms.test.mjs and the client
// half of admin-compare.test.mjs: a form is offered only when it writes a block back exactly, and a
// tip with a heading is written the way the engine writes it.
import assert from "node:assert/strict";
import test from "node:test";
import {
  calloutMarkdown, editableBlockKind, embedProblem, headingAt, linkAt, parseCallout, parseEmbed, parsePieceFence,
  parseTable, parseTaskList, quoteAt, quoteMarkdown, tableMarkdown, taskListMarkdown, hasHtmlTag,
} from "../../web/studio/parts/block-forms.js";

test("a callout opens a form and writes the same Markdown back", () => {
  const source = "> [!WARNING]\n> Hot pan.\n>\n> Really hot.\n";
  assert.equal(editableBlockKind("Callout", source), "callout");
  const parsed = parseCallout(source);
  assert.deepEqual(parsed, { kind: "WARNING", title: "", text: "Hot pan.\n\nReally hot." });
  assert.equal(`${calloutMarkdown(parsed)}\n`, source);
  assert.equal(calloutMarkdown({ ...parsed, kind: "TIP" }), "> [!TIP]\n> Hot pan.\n>\n> Really hot.");
});

test("a tip with a heading reads back, and is written the same bytes as the engine's (Piece::to_markdown)", () => {
  // From crates/openblog-cli: POST pieces { kind: callout, tone: success, title, body }.
  const engine = "> [!TIP]\n> **Make ahead**\n>\n> Bake the crust the day before.\n>\n> Keep it wrapped.\n";
  const parsed = parseCallout(engine);
  assert.deepEqual(parsed, { kind: "TIP", title: "Make ahead", text: "Bake the crust the day before.\n\nKeep it wrapped." });
  assert.equal(`${calloutMarkdown(parsed)}\n`, engine);
  assert.equal(calloutMarkdown({ kind: "NOTE", title: "  Two\nlines ", text: "x" }), "> [!NOTE]\n> **Two lines**\n>\n> x");
});

test("a callout the form would rewrite stays as it is", () => {
  for (const source of ["> [!NOTE]\n>   indented\n", "> [!NOTE]\n> a\n> > nested\n", "> [!NOTE]\n"]) {
    const kind = editableBlockKind("Callout", source);
    if (kind) assert.equal(`${calloutMarkdown(parseCallout(source))}\n`, source, source);
  }
  assert.equal(parseCallout("> [!NOTE]\n>text\n"), null, "a missing space would be rewritten");
});

test("task lists keep their checked state and refuse nesting", () => {
  const source = "- [ ] Buy flour\n- [x] Preheat\n";
  assert.deepEqual(parseTaskList(source), [{ checked: false, text: "Buy flour" }, { checked: true, text: "Preheat" }]);
  assert.equal(`${taskListMarkdown(parseTaskList(source))}\n`, source);
  assert.equal(parseTaskList("- [ ] a\n  - [ ] nested\n"), null);
  assert.equal(parseTaskList("- [ ] a\n- plain\n"), null);
});

test("tables add and remove rows and columns and escape bars", () => {
  const source = "| Name | Qty |\n| :--- | ---: |\n| Flour | 2 |\n| Salt | 1 |\n";
  const table = parseTable(source);
  assert.deepEqual(table.header, ["Name", "Qty"]);
  assert.deepEqual(table.align, ["left", "right"]);
  assert.equal(`${tableMarkdown(table)}\n`, source);
  table.rows.push(["Yeast", "a|b"]);
  table.header.push("Note");
  table.align.push("");
  table.rows.forEach((row) => row.push(""));
  assert.equal(tableMarkdown(table).split("\n").at(-1), "| Yeast | a\\|b |  |");
  assert.equal(parseTable("| a | b |\n| --- | --- |\n| only one |\n"), null);
  assert.equal(parseTable("| a | b |\n| --- | --- |\n| `x|y` | z |\n"), null);
});

test("tables and task lists the form would rewrite have no form", () => {
  for (const source of ["|a|b|\n|---|---|\n|1|2|\n", "| a | b |\n|:-:|--:|\n| 1 | 2 |\n", "| a | b |\n| --- | --- |\n| 1 | 2 |  \n", "| a | b |\n| ----- | --- |\n| 1 | 2 |\n"]) {
    assert.equal(parseTable(source), null, source);
  }
  for (const source of ["* [ ] a\n* [x] b\n", "- [X] a\n", "- [ ] a  \n", "- [ ]  two spaces\n"]) assert.equal(parseTaskList(source), null, source);
});

test("an embed is a provider and an address", () => {
  assert.deepEqual(parseEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ\n"), { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.equal(parseEmbed("https://codepen.io/a/pen/b\n").provider, "codepen");
  assert.equal(embedProblem("codepen", "https://www.youtube.com/watch?v=dQw4w9WgXcQ").includes("not a CodePen address"), true);
  assert.equal(embedProblem("youtube", "https://youtu.be/dQw4w9WgXcQ"), "");
});

test("a piece fence is read for its form, exactly as the engine writes it; unknown or repeated fields have no form", () => {
  const source = "```piece hours\nnote: Closed on holidays.\ndays: Mon\nhours: 9 to 5\ndays: Tue\nhours: Closed\n```\n";
  assert.deepEqual(parsePieceFence(source).values, [["note", "Closed on holidays."], ["days", "Mon"], ["hours", "9 to 5"], ["days", "Tue"], ["hours", "Closed"]]);
  assert.deepEqual(parsePieceFence("````piece faq\nquestion: Why?\nanswer: Because.\n  \n  Really.\n````\n").values[1], ["answer", "Because.\n\nReally."]);
  const hours = { kind: "hours", fields: [{ name: "note" }], list: { fields: [{ name: "days" }, { name: "hours" }] } };
  assert.equal(editableBlockKind("Piece", source, [hours]), "piece");
  assert.equal(parsePieceFence("```piece hours\nnote: x\nbogus: y\n```\n", hours), null);
  assert.equal(parsePieceFence("```piece hours\nnote: x\nnote: y\n```\n", hours), null);
  assert.equal(editableBlockKind("Piece", "```piece nothing\nnote: y\n```\n", [hours]), "");
  // Before and after (the client half of admin-compare).
  const compare = { kind: "compare", fields: ["before", "before-alt", "after", "after-alt", "before-caption", "after-caption"].map((name) => ({ name })) };
  const fence = "```compare\nbefore: /images/a.jpg\nbefore-alt: The old floor\nafter: /images/b.jpg\nafter-alt: The new floor\n```\n";
  assert.deepEqual(parsePieceFence(fence, compare).values[1], ["before-alt", "The old floor"]);
  assert.equal(editableBlockKind("Before and after", fence, [compare]), "piece");
  assert.equal(editableBlockKind("Before and after", fence.replace("```\n", "after: /c.jpg\n```\n"), [compare]), "");
});

test("a quote, a heading and a link at the caret, read only when they'd be written back the same", () => {
  assert.equal(quoteMarkdown({ words: "Be kind.\nAlways.", who: "Mom" }), "> Be kind.\n> Always.\n>\n> — Mom");
  assert.deepEqual(quoteAt("Hi.\n\n> Be kind.\n>\n> — Mom\n\nEnd", 8), { start: 5, end: 25, words: "Be kind.", who: "Mom" });
  assert.equal(quoteAt("> [!TIP]\n> x", 3), null, "a tip is a card, not a quote");
  assert.equal(quoteAt(">  two spaces", 3), null);
  assert.deepEqual(headingAt("x\n## Hello there\ny", 5), { start: 2, end: 16, level: 2, words: "Hello there" });
  assert.equal(headingAt("# Title\n", 3), null);
  assert.deepEqual(linkAt("See [my \\] pie](/pie/) now", 6), { start: 4, end: 22, words: "my ] pie", href: "/pie/" });
  assert.equal(linkAt("![photo](/a.png)", 3), null, "a photo is not a link");
  assert.equal(hasHtmlTag("a < b"), false);
  assert.equal(hasHtmlTag("<b>x"), true);
});

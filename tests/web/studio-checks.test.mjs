// Ported from tests/web/admin-checks.test.mjs for Studio R6 (parts/checks.js is the old Admin's,
// copied whole); the old Admin's copy and its test go in R15.
import assert from "node:assert/strict";
import test from "node:test";

import { CHECK_LIMITS, applyFix, checkMarkdown, checksSummary } from "../../web/studio/parts/checks.js";

const rules = (markdown, options) => checkMarkdown(markdown, options).map((issue) => issue.rule);
const only = (markdown, rule, options) => checkMarkdown(markdown, options).find((issue) => issue.rule === rule);

test("a picture with no description is found and the fix writes the owner's words into that picture only", () => {
  const md = "Intro ![](https://example.com/a.jpg) and ![A loaf](https://example.com/b.jpg).";
  assert.deepEqual(rules(md), ["picture-description"]);
  const issue = only(md, "picture-description");
  assert.match(issue.message, /no description/);
  assert.equal(issue.fix.prompt, "What does the picture show?");
  const fixed = applyFix(md, issue, "A round [loaf] <b>");
  assert.equal(fixed.markdown, "Intro ![A round loaf b](https://example.com/a.jpg) and ![A loaf](https://example.com/b.jpg).");
  assert.equal(applyFix(md, issue, "   ").changed, false, "an empty answer changes nothing");
});

test("links that say click here, here or read more are flagged and relabelled", () => {
  for (const label of ["click here", "Here", "Read more", "this link", "More."]) {
    const md = `See [${label}](https://example.com/menu) now.`;
    const issue = only(md, "vague-link");
    assert.ok(issue, label);
    assert.equal(applyFix(md, issue, "our menu").markdown, "See [our menu](https://example.com/menu) now.");
  }
  assert.deepEqual(rules("See [the menu](https://example.com/menu) now."), []);
});

test("empty links and links with no address are flagged", () => {
  const md = "A [](https://example.com/x) and a [named]() one.";
  assert.deepEqual(rules(md), ["empty-link", "empty-address"]);
  assert.equal(applyFix(md, only(md, "empty-link"), "the page").markdown, "A [the page](https://example.com/x) and a [named]() one.");
  assert.equal(only(md, "empty-address").fix, null, "no safe fix for a missing address");
});

test("a skipped heading level can be moved to the next level", () => {
  const md = "## One\n\ntext\n\n#### Deep\n\nmore";
  const issue = only(md, "heading-skip");
  assert.match(issue.message, /level 2 to level 4/);
  assert.equal(applyFix(md, issue).markdown, "## One\n\ntext\n\n### Deep\n\nmore");
  assert.deepEqual(rules("## One\n\n### Two\n\n## Three"), []);
  assert.equal(only("### First", "heading-skip")?.fix.replace, "##", "the page title is the first level");
  assert.deepEqual(rules("## A\n\n### B", { headingBase: 1 }), []);
});

test("very long paragraphs and shouting are noticed, with no fix", () => {
  const long = Array.from({ length: CHECK_LIMITS.longParagraphWords + 5 }, (_, i) => `word${i}`).join(" ");
  const issue = only(long, "long-paragraph");
  assert.ok(issue);
  assert.equal(issue.fix, null);
  assert.deepEqual(rules("# WELCOME TO OUR BIG SALE TODAY\n\nOPEN EVERY DAY OF THE WEEK FOR YOU"), ["all-caps", "all-caps"]);
  assert.deepEqual(rules("We use NASA and HTML and CSS here."), []);
  assert.deepEqual(rules("OK, FAQ."), []);
});

test("http addresses are found in links, pictures and autolinks, and upgraded in place", () => {
  const md = "[a](http://example.com/a) ![b](http://example.com/b.jpg) <http://example.com/c> [l](http://localhost:3000/x)";
  const issues = checkMarkdown(md).filter((i) => i.rule === "insecure-address");
  assert.equal(issues.length, 3, "localhost is left alone");
  let out = md;
  for (const issue of [...issues].reverse()) out = applyFix(out, issue).markdown;
  assert.equal(out, "[a](https://example.com/a) ![b](https://example.com/b.jpg) <https://example.com/c> [l](http://localhost:3000/x)");
});

test("code is never checked", () => {
  const md = "```\n[click here](http://example.com) ![](x)\n```\n\nUse `[here](http://a.b)` in text.";
  assert.deepEqual(rules(md), []);
});

test("HTML tags are reported only when asked, and never block", () => {
  assert.deepEqual(rules("A <kbd>Ctrl</kbd> key"), []);
  assert.deepEqual(rules("A <kbd>Ctrl</kbd> key", { html: true }), ["html"]);
  assert.deepEqual(rules("See <https://example.com>.", { html: true }), []);
});

test("a fix changes nothing when the text moved or the fix is missing", () => {
  const md = "Intro ![](https://example.com/a.jpg)";
  const issue = only(md, "picture-description");
  const moved = `New line\n${md}`;
  assert.equal(applyFix(moved, issue, "A loaf").changed, false);
  assert.equal(applyFix(moved, issue, "A loaf").markdown, moved);
  assert.equal(applyFix(md, { fix: null }).changed, false);
  assert.equal(applyFix(md, null).changed, false);
  assert.equal(applyFix(md, { fix: { kind: "describe", at: [999, 1000], expect: "", before: "", after: "" } }, "x").changed, false);
  assert.equal(applyFix(md, { fix: { kind: "evil", at: [0, 0], expect: "", before: "", after: "" } }, "x").changed, false);
});

test("empty, malformed and huge input never throws and is bounded", () => {
  for (const input of [undefined, null, 7, "", "   ", "[", "![](", "[a](", "```", "#", "# ", "\u0000", "<", "[](", "((((("]) {
    assert.doesNotThrow(() => checkMarkdown(input, { html: true }), String(input));
  }
  assert.deepEqual(checkMarkdown(""), []);
  const many = "![](x) ".repeat(500);
  assert.equal(checkMarkdown(many).length, CHECK_LIMITS.issues);
  assert.doesNotThrow(() => checkMarkdown("a".repeat(CHECK_LIMITS.characters * 2)));
  assert.doesNotThrow(() => checkMarkdown("[".repeat(20000)));
});

test("the summary is one plain sentence", () => {
  assert.equal(checksSummary([]), "No suggestions. Nothing to fix.");
  assert.equal(checksSummary([{}]), "1 suggestion for this text.");
  assert.equal(checksSummary([{}, {}]), "2 suggestions for this text.");
});

// ---- Studio R6: Suggestions say each one in her words

import { checkWords, suggestionsHeading } from "../../web/studio/parts/checks.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

test("each suggestion is said in her words, with the fix's label, and HTML only for the person who set up the site", () => {
  const text = "Intro.\n\n![](/images/a.png)\n\n[click here](https://example.com/)\n\n<b>x</b>\n";
  const issues = checkMarkdown(text, { html: true });
  const said = issues.map((issue) => checkWords(issue, text));
  assert.deepEqual(said.map((s) => s.fix), ["Describe it", "Change the words", ""]);
  assert.equal(said[0].words, "A photo has no description, so people who can't see it won't know what it shows.");
  assert.equal(said[1].words, "The link “click here” doesn't say where it goes. Words that name the place are easier to follow.");
  assert.equal(said[2].words, "Line 7 has an HTML tag. It is kept and shown as written.");
  for (const s of said.slice(0, 2)) assert.doesNotMatch(s.words, HER_BANNED);
  assert.equal(suggestionsHeading(0), "");
  assert.equal(suggestionsHeading(1), "1 suggestion for your words");
  assert.equal(suggestionsHeading(3), "3 suggestions for your words");
});

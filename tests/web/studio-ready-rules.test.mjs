// Before you publish (Studio R7): one list of what the checks found, when the sheet opens by
// itself, the real card's notes and picture, and the search hints. Ports admin-readiness.test.mjs
// (her/hint split, no score) and admin-behavior's "accessibility findings are grouped…" in their
// Studio form: needs-review findings never count, and the engine's finding that repeats an R6
// suggestion at the same place is dropped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  a11yItems, a11yWords, bodyPlace, buildProblems, cardAddress, cardImageSrc, cardNotes, mergeSuggestions, readyLine, readyProblem, readyState,
  searchHints, shouldOpenOnPublish,
} from "../../web/studio/parts/ready-rules.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";
import { catalog } from "../../web/studio/parts/words.js";

const finding = (code, outcome, source = {}, extra = {}) => ({ code, outcome, scope: "content", source: { path: "posts/pie.md", line: null, column: null, field: null, ...source }, message: `server: ${code}`, repair: "r", references: ["WCAG-2.2-1.1.1"], ...extra });

test("engine findings in her words: suggestions, worth a look (never counted), details", () => {
  const body = "Intro.\n\n![IMG_2041.jpg](/images/a.jpg)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const items = a11yItems([
    finding("image-alt-review", "needs-review", { field: "coverAlt" }),
    finding("image-alt-placeholder", "potential", { line: 9 }),
    finding("table-structure-review", "needs-review", { line: 11 }),
    finding("media-alternatives-review", "needs-review", { line: 7 }),
    finding("embed-accessibility-review", "needs-review", { line: 7 }),
    finding("raw-html-review", "needs-review", { line: 7 }),
    finding("document-language-missing", "detected", { path: "openblog.json", field: "language" }, { scope: "site" }),
    finding("something-new", "detected", { line: 7 }),
    finding("something-else", "needs-review", { line: 7 }),
  ], { body, firstBodyLine: 7, coverAlt: "" });
  assert.deepEqual(items.suggestions.map((s) => s.id), ["cover-description", "photo-file-name", "something-new"]);
  assert.equal(items.suggestions[0].words, "Your cover photo has no description, so people who can't see it won't know what it shows.");
  assert.equal(items.suggestions[0].fix, "describe-cover");
  assert.equal(items.suggestions[1].words, "A photo's description looks like a file name (“IMG_2041.jpg”). Say what it shows instead.");
  assert.equal(items.suggestions[1].line, 3, "the line counted in her words");
  assert.equal(items.suggestions[2].words, "Something here may be hard for some readers to use.");
  assert.deepEqual(items.worth.map((w) => w.id), ["table-structure-review", "media-alternatives-review", "embed-accessibility-review", "something-else"]);
  assert.deepEqual(items.details.map((d) => d.id), ["raw-html-review", "document-language-missing"]);
  assert.equal(a11yWords("image-alt-placeholder", finding("image-alt-placeholder", "potential", { field: "coverAlt" }), { coverAlt: "DSC_0001.JPG" }).words, "Your cover photo's description looks like a file name (“DSC_0001.JPG”). Say what it shows instead.");
});

test("a cover with no description is listed once, and an engine finding R6 already shows is dropped", () => {
  const server = a11yItems([
    finding("image-alt-review", "needs-review", { field: "coverAlt" }),
    finding("image-alt-review", "needs-review", { line: 9 }),
    finding("link-purpose-review", "potential", { line: 11 }),
    finding("heading-level-skip", "potential", { line: 20 }),
  ], { body: "a\n\n![](/x.jpg)\n\n[here](https://a.example)\n" + "x\n".repeat(20), firstBodyLine: 7 }).suggestions;
  const local = [{ rule: "picture-description", line: 3, words: "A photo has no description" }, { rule: "vague-link", line: 5, words: "vague" }];
  const merged = mergeSuggestions(local, server);
  assert.deepEqual(merged.map((m) => m.rule || m.id), ["cover-description", "picture-description", "vague-link", "heading-level-skip"]);
  assert.equal(merged.filter((m) => /cover/.test(m.id || "")).length, 1);
  assert.equal(merged.find((m) => m.id === "heading-level-skip").line, 14, "a skip R6 didn't see stays");
  // Without lines on R6's side (several boxes), any of that kind is enough to drop the engine's.
  assert.deepEqual(mergeSuggestions([{ rule: "vague-link" }], [{ id: "link-purpose-review", same: "vague-link", line: 5 }]), [{ rule: "vague-link", from: "local" }]);
  assert.deepEqual(mergeSuggestions([], [{ id: "recipe:no-author" }, { id: "recipe:no-image" }], { has: { noName: true, noPicture: true } }), []);
});

test("Worth a look never counts, and the state's words say what stops publishing", () => {
  assert.deepEqual(readyState({ worth: [1, 2] }), { state: "nothing", words: "Nothing to check.", blocks: 0, suggestions: 0, worth: 2, blocked: false, waiting: false });
  assert.equal(readyState({ suggestions: [1] }).words, "1 suggestion. It doesn't stop you publishing.");
  assert.equal(readyState({ suggestions: [1, 2] }).words, "2 suggestions. None of them stop you publishing.");
  const blocked = readyState({ blocks: [1], suggestions: [1, 2] });
  assert.equal(blocked.words, "1 thing needs fixing before your post can go up. Also 2 suggestions.");
  assert.equal(blocked.blocked, true);
  assert.equal(readyState({ blocks: [1, 2], suggestions: [1] }).words, "2 things need fixing before your post can go up. Also 1 suggestion.");
  assert.equal(readyState({ research: { groups: [{ name: "blocking", findings: [0] }] } }).blocks, 1, "research blockers count here");
  assert.equal(readyState({ failure: "offline", device: "iPad" }).words, "Waiting for a signal to check the rest. What's here was checked on this iPad.");
  assert.equal(readyState({ failure: "server" }).words, "Some checks didn't run, so this list may be missing things. You can still publish.");
  assert.equal(readyState({ failure: "research" }).blocked, true, "a research post waits until its checks run");
  assert.equal(readyState({ checking: true }).words, "Checking your post…");
});

test("it opens by itself only on the first Publish, with something to show", () => {
  const open = (state, result, extra = {}) => shouldOpenOnPublish({ state, intent: "publish", result: { blocks: 0, suggestions: 0, ...result }, ...extra });
  assert.equal(open("draft", {}), false, "Publish with nothing found opens no sheet");
  assert.equal(open("draft", { worth: 3 }), false, "Worth a look alone doesn't open it");
  assert.equal(open("draft", { suggestions: 1 }), true);
  assert.equal(open("new", { suggestions: 1 }), true);
  assert.equal(open("draft", { exactRoute: true }), true);
  assert.equal(open("draft", { failure: "server" }), true);
  assert.equal(open("draft", { failure: "offline", suggestions: 3 }), false, "no signal: the save path keeps her work");
  assert.equal(open("draft", {}, { research: true }), true, "a research post always opens it");
  assert.equal(open("published", { suggestions: 4 }), false, "Update doesn't nag");
  assert.equal(open("published", { blocks: 1 }), true, "Update opens it only with a blocker");
  assert.equal(open("scheduled", { suggestions: 1 }), false);
  assert.equal(open("draft", { suggestions: 1 }, { fromSheet: true }), false, "Publish from inside the sheet publishes");
  assert.equal(shouldOpenOnPublish({ state: "draft", intent: "draft", result: { blocks: 1 } }), false);
});

test("the side card's line", () => {
  assert.equal(readyLine({}), "Not checked yet");
  assert.equal(readyLine({ local: 2 }), "2 suggestions so far");
  assert.equal(readyLine({ local: 1 }), "1 suggestion so far");
  assert.equal(readyLine({ checked: true, blocks: 1, suggestions: 3 }), "1 thing needs fixing");
  assert.equal(readyLine({ checked: true, suggestions: 2 }), "2 suggestions");
  assert.equal(readyLine({ checked: true }), "Nothing to check");
  assert.equal(readyLine({ checked: true, changed: true, suggestions: 2 }), "Changed since the last check");
});

test("search hints: her suggestions apart from the hints, and no score", () => {
  const body = `A direct answer explains why the method works and when a reader should use it in practice.\n\n## Method\n\n${"word ".repeat(160)}\n\nSee [the guide](https://example.com/guide).`;
  const good = searchHints({ title: "How to do something well", description: "A sufficiently descriptive summary that explains the useful answer in this post.", tags: ["howto"], body }, { authorReady: true });
  assert.deepEqual(good, { her: [], hints: [] });
  const weak = searchHints({ title: "T".repeat(82), description: "Short.", subtitle: "s".repeat(172), tags: [], body: "## Only a heading\n\nshort" }, {});
  assert.deepEqual(weak.her.map((h) => h.id), ["title-long", "no-tags", "no-name"]);
  assert.equal(weak.her[0].words, "Google shows about 65 letters of a title; this one has 82. The rest may be cut off.");
  assert.equal(weak.her[2].words, "Your blog doesn't have your name yet, so the post doesn't say who wrote it. Tell the person who set up your site.");
  assert.deepEqual(weak.hints.map((h) => h.id), ["summary-short", "subtitle-long", "direct-opening", "depth", "external-source"]);
  assert.equal(weak.hints[1].words, "Line under the title is 172 letters; 160 or fewer reads as one line.");
  assert.equal(searchHints({ title: "Hi", tags: ["a"], body }, { authorReady: true }).her.length, 0, "a short title is not a problem");
  assert.equal(searchHints({ title: "x", tags: [], body, credited: true }, {}).her.map((h) => h.id).join(), "no-tags", "a credited person names the post");
  assert.ok(!("score" in weak));
  // Code never counts as content (admin-readiness: code examples do not affect content signals).
  const code = searchHints({ title: "x", tags: ["a"], body: "```\n## Not a heading\n[x](https://a.example)\n```\n\nShort." }, { authorReady: true });
  assert.ok(code.hints.some((h) => h.id === "sections") && code.hints.some((h) => h.id === "external-source"));
});

test("the card: notes, the picture's address, and the address as people read it", () => {
  assert.deepEqual(cardNotes({ image: "" }, {}).map((n) => n.id), ["no-summary", "no-picture"]);
  const long = cardNotes({ image: "/images/a.jpg" }, { description: "x".repeat(212) });
  assert.equal(long[0].words, "Google usually shows about 160 letters; this summary has 212. The rest may be cut off.");
  assert.equal(long[0].button, "Change the summary");
  assert.deepEqual(cardNotes({ image: "https://cdn.example/a.jpg" }, { description: "Fine." }), []);
  assert.equal(cardImageSrc("https://blog.example.org/images/a.jpg", "https://blog.example.org"), "/images/a.jpg");
  assert.equal(cardImageSrc("https://blog.example.org/site/images/a.jpg", "https://blog.example.org/site/"), "/images/a.jpg");
  assert.equal(cardImageSrc("/images/a.jpg", ""), "/images/a.jpg");
  assert.equal(cardImageSrc("https://cdn.example/a.jpg", "https://blog.example.org"), "https://cdn.example/a.jpg");
  assert.equal(cardImageSrc("http://cdn.example/a.jpg", "https://blog.example.org"), "", "never plain http");
  assert.equal(cardImageSrc("javascript:alert(1)", ""), "");
  assert.equal(cardImageSrc("data:image/png;base64,AAAA", ""), "");
  assert.equal(cardImageSrc("//evil.example/a.jpg", ""), "");
  assert.equal(cardAddress("https://blog.example.org/pie/"), "blog.example.org/pie/");
});

test("lines above her words are fields; failures are named", () => {
  assert.equal(bodyPlace(3, 7, "a\nb"), null);
  assert.equal(bodyPlace(7, 7, "a\nb"), 1);
  assert.equal(bodyPlace(8, 7, "a\nb"), 2);
  assert.equal(bodyPlace(9, 7, "a\nb"), null);
  assert.equal(readyProblem({ status: 0 }), "offline");
  assert.equal(readyProblem({ status: 401 }), "signed-out");
  assert.equal(readyProblem({ status: 413 }), "too-long");
  assert.equal(readyProblem({ status: 422, data: { code: "build" } }), "build");
  assert.equal(readyProblem({ status: 422, data: { error: "posts/x.md: bad" } }), "build", "before G46 any 422");
  assert.equal(readyProblem({ status: 500 }), "server");
  assert.equal(readyProblem({ status: 422, data: { code: "site-build" } }), "server", "another post's problem doesn't block this one");
  assert.deepEqual(buildProblems({ data: { error: "e", problems: [{ message: "a" }, "b"] } }), ["a", "b"]);
  assert.deepEqual(buildProblems({ data: { error: "e" } }), ["e"]);
});

test("no her-layer string in the R7 rules says Studio, Admin or a word she never sees", () => {
  const dir = new URL("../../web/studio/parts/", import.meta.url);
  for (const file of ["ready-rules.js", "route-rules.js", "video-rules.js", "review-rules.js", "recipe-advice.js"]) {
    const code = readFileSync(new URL(file, dir), "utf8").split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join("\n");
    const literals = [...code.matchAll(/"([^"\\]{12,})"|`([^`]{12,})`/g)].map((m) => m[1] || m[2]).filter((text) => / /.test(text) && /^[A-Z]/.test(text));
    for (const text of literals) assert.doesNotMatch(text, /\b(Studio|Admin)\b/, `${file}: ${text}`);
  }
  for (const [id, entry] of Object.entries(catalog())) {
    if (!/^(ready|review|youtube|recipe)\./.test(id) || entry.layer !== "her") continue;
    assert.doesNotMatch(entry.text, HER_BANNED, id);
  }
});

test("a research post's Publish waits while its research checks run, and only then", () => {
  const running = readyState({ checking: true, researchPending: true });
  assert.equal(running.blocked, true, "Publish waits");
  assert.equal(running.waiting, true);
  assert.equal(running.words, "Checking your post…");
  assert.equal(readyState({ checking: true }).blocked, false, "any other post's Publish stays on while checks run");
  assert.equal(readyState({ research: { groups: [] } }).blocked, false, "the checks answered: nothing waits");
});

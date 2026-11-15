import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  MAX_VERSIONS, NEARLY_FULL, PART_MARKER_LINE, draftStateText, insertAtSelection, joinParts, movePartBreak, partBlocks,
  partBreakInsertion, partCount, partParagraphs, partSaveMode, promptInsertion, reflectionPrompts, removePartBreak, savesLeftText,
} from "../../web/studio/parts/part-rules.js";
import { joinToken, joinProblem, JOIN_HASH } from "../../web/studio/parts/join-rules.js";
import { say } from "../../web/studio/parts/words.js";

// Your part (Studio R14a), ported from the old admin-shared-drafts (prompts, save state, part
// break, failures) and grown: part breaks as cards that round-trip byte for byte, and the token
// that is read once from an invitation address.

test("ideas are plain optional quotes, put in where the caret is, and hers once they are in", () => {
  assert.equal(reflectionPrompts().length, 4);
  assert.equal(promptInsertion("  What   stood\nout? "), "> What stood out?\n\n");
  assert.deepEqual(insertAtSelection("ab", 1, 1, "X"), { text: "aXb", caret: 2 });
  assert.deepEqual(insertAtSelection("ab", 0, 2, "X"), { text: "X", caret: 1 });
  assert.deepEqual(insertAtSelection("ab", undefined, undefined, "X"), { text: "abX", caret: 3 });
  assert.deepEqual(insertAtSelection("ab", 9, 9, "X"), { text: "abX", caret: 3 });
});

test("a new part is the marker alone on its own line, exactly as the server splits it", () => {
  assert.equal(PART_MARKER_LINE, "<!-- openblog:part -->");
  assert.equal(partBreakInsertion(), "\n<!-- openblog:part -->\n");
  assert.equal(insertAtSelection("ab", 1, 1, partBreakInsertion()).text, "a\n<!-- openblog:part -->\nb");
  const rust = readFileSync(new URL("../../crates/openblog-core/src/reflection.rs", import.meta.url), "utf8");
  assert.match(rust, new RegExp(`PART_MARKER: &str = "${PART_MARKER_LINE}"`));
});

const FIXTURES = [
  "",
  "One part only.",
  "Hello\n\nworld\n<!-- openblog:part -->\nSecond\r\n<!-- openblog:part -->\r\nthird",
  "<!-- openblog:part -->\n",
  "<!-- openblog:part -->\n<!-- openblog:part -->\n",
  "a\n <!-- openblog:part -->\nnot a break: it is indented",
  "text <!-- openblog:part --> in a line\n",
  "ends with a marker\n<!-- openblog:part -->",
  "emoji 🌊 and right-to-left שלום\n<!-- openblog:part -->\n\n\nafter blank lines\n\n",
  "```\n<!-- openblog:part -->\n```\n",
  "<script>alert(1)</script>\n<!-- openblog:part -->\n[x](javascript:alert(1))",
];

test("her part as boxes and part-break cards comes back byte for byte, for every fixture", () => {
  for (const text of FIXTURES) {
    assert.equal(joinParts(partBlocks(text)), text, JSON.stringify(text));
    const blocks = partBlocks(text);
    assert.equal(blocks[0].kind, "words");
    assert.equal(blocks.at(-1).kind, "words");
  }
  assert.equal(partCount(FIXTURES[2]), 3);
  assert.equal(partCount("a\n <!-- openblog:part -->\nb"), 1, "an indented marker is words, as on the server");
  // A box she edited that lost its last newline still keeps the break on a line of its own.
  const blocks = partBlocks("a\n<!-- openblog:part -->\nb");
  blocks[0] = { kind: "words", text: "a, edited" };
  assert.equal(joinParts(blocks), "a, edited\n<!-- openblog:part -->\nb");
});

const words = (text) => text.replace(/<!-- openblog:part -->/g, "").replace(/\s+/g, " ").trim();

test("moving a part break by a paragraph never loses or repeats a word", () => {
  const text = "One para.\n\nTwo para.\n<!-- openblog:part -->\nThree.\n\nFour.\n";
  const up = movePartBreak(text, 0, -1);
  assert.equal(up, "One para.\n<!-- openblog:part -->\nTwo para.\n\nThree.\n\nFour.\n");
  const down = movePartBreak(text, 0, 1);
  assert.equal(down, "One para.\n\nTwo para.\n\nThree.\n<!-- openblog:part -->\nFour.\n");
  for (const moved of [up, down]) assert.equal(words(moved), words(text));
  assert.equal(partCount(up), 2);
  // At either end there is nowhere to go.
  assert.equal(movePartBreak("<!-- openblog:part -->\nonly after\n", 0, -1), null);
  assert.equal(movePartBreak("only before\n<!-- openblog:part -->\n", 0, 1), null);
  assert.equal(movePartBreak(text, 3, 1), null);
  // Moving up then down returns to two parts with every word.
  assert.equal(words(movePartBreak(up, 0, 1)), words(text));
});

test("taking a break out joins the parts and keeps them two paragraphs", () => {
  const text = "One para.\n\nTwo para.\n<!-- openblog:part -->\nThree.\n";
  assert.equal(removePartBreak(text, 0), "One para.\n\nTwo para.\n\nThree.\n");
  assert.equal(removePartBreak("a\n\n<!-- openblog:part -->\nb", 0), "a\n\nb");
  assert.equal(removePartBreak(text, 5), text);
  assert.equal(partCount(removePartBreak(FIXTURES[2], 1)), 2);
});

test("someone's part to read is paragraphs of text and a thin rule where a part starts", () => {
  assert.deepEqual(partParagraphs("One.\n\nTwo\nlines.\n<!-- openblog:part -->\nThree."), [
    { kind: "p", text: "One." }, { kind: "p", text: "Two\nlines." }, { kind: "break", label: "Part 2" }, { kind: "p", text: "Three." },
  ]);
  // Markup stays text: nothing is parsed.
  assert.deepEqual(partParagraphs("<script>alert(1)</script>"), [{ kind: "p", text: "<script>alert(1)</script>" }]);
  assert.deepEqual(partParagraphs(""), []);
});

test("the status line is words, never a version number", () => {
  assert.equal(draftStateText({}), say("part.nothingYet"));
  assert.equal(draftStateText({ saved: 3 }), say("part.saved"));
  assert.equal(draftStateText({ saved: 3, dirty: true }), say("part.keptHere"));
  assert.equal(draftStateText({ dirty: true, offline: true }), say("part.waitingSignal"));
  assert.equal(draftStateText({ saving: true, dirty: true }), say("part.saving"));
  assert.equal(draftStateText({ saved: 2, shared: true }), say("part.sharedStatus"));
  assert.equal(draftStateText({ saved: 2, shared: true, changedSince: true }), say("part.changedSince"));
  for (const state of [{}, { saved: 7 }, { saved: 7, dirty: true }]) assert.doesNotMatch(draftStateText(state), /\d/);
});

test("saves left are said only near the end, and typing never spends them (⚑ 6)", () => {
  assert.equal(MAX_VERSIONS, 200);
  assert.equal(savesLeftText(10), "");
  assert.equal(savesLeftText(NEARLY_FULL), "You can save this part 10 more times. Let the others read it, or tell the person who set up your site.");
  assert.equal(savesLeftText(200), say("part.full"));
  assert.equal(partSaveMode({}), "version");
  assert.equal(partSaveMode({ together: { workingCopy: true } }), "working");
  const rust = readFileSync(new URL("../../crates/openblog-core/src/draft.rs", import.meta.url), "utf8");
  assert.match(rust, /MAX_REVISIONS_PER_DRAFT: usize = 200/);
});

// ---- the token in an invitation address

const SECRET = "0123456789abcdef".repeat(4);

test("a token is read from either invitation address and the address shown instead holds none", () => {
  for (const hash of [`#/together/join/shared-0a1b2c3d4e5f.${SECRET}`, `#/shared/accept/shared-0a1b2c3d4e5f.${SECRET}`, `#together/join/shared-0a1b2c3d4e5f.${SECRET}`]) {
    const found = joinToken(hash);
    assert.deepEqual(found, { token: `shared-0a1b2c3d4e5f.${SECRET}`, hash: JOIN_HASH }, hash);
    assert.ok(!found.hash.includes(SECRET));
  }
  for (const bad of ["", "#/together", "#/together/join", "#/together/join/", "#/together/join/x", `#/together/join/a.${"g".repeat(64)}`,
    `#/together/join/a.${SECRET}?x=1`, `#/together/join/a.${SECRET}/more`, `#/edit/accept/a.${SECRET}`, `#/shared/new`, `#/together/join/A.${SECRET}`, `#/together/join/%E0%A4%A.${SECRET}`]) {
    assert.equal(joinToken(bad), null, bad);
  }
});

test("a refused join says one thing in her words", () => {
  assert.equal(joinProblem({ status: 404, data: { code: "invalid-invitation" } }), say("join.notWorking"));
  assert.equal(joinProblem({ status: 429, data: { code: "too-many-tries" } }), say("join.tooMany"));
  assert.equal(joinProblem({ status: 422, data: { code: "password" } }), say("join.passwordShort"));
  assert.equal(joinProblem({ status: 0 }), say("join.noSignal"));
});

const studio = new URL("../../web/studio/", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

test("the token lives only in memory: nothing that holds it touches storage, a log, a query or a toast", () => {
  const files = ["studio.js", "screens/together-join.js", "parts/join-rules.js"].map((f) => readFileSync(join(studio, f), "utf8"));
  for (const text of files) {
    assert.doesNotMatch(text, /(localStorage|sessionStorage)\.(setItem|getItem)\([^)]*(token|held)/i);
    assert.doesNotMatch(text, /console\./);
    assert.doesNotMatch(text, /\?token=|token=\$\{/);
    assert.doesNotMatch(text, /toast\([^)]*(token|held)/);
  }
  const joinScreen = files[1];
  assert.match(joinScreen, /"X-Openblog-Invitation": held/, "sent in the header only");
  // studio.js takes it out of the address before its first request.
  const start = files[0];
  assert.ok(start.indexOf("history.replaceState(null, \"\", invitation.hash)") < start.indexOf("start();"));
  assert.ok(start.indexOf("history.replaceState(null, \"\", invitation.hash)") < start.indexOf("api.session()"));
  // No other Studio file reads it.
  for (const file of walk(studio).filter((f) => f.endsWith(".js") && !/together-join|join-rules|studio\.js$/.test(f))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /X-Openblog-Invitation|holdJoinToken\(/, file);
  }
});

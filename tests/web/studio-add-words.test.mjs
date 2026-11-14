// Add something's menu and the cards' words (Studio R6): the items in two groups, where a thing
// goes, and what each card says and which form changes it.
import assert from "node:assert/strict";
import test from "node:test";
import { addItems, filterItems, whereItGoes } from "../../web/studio/parts/add-words.js";
import { blockThing, cardForm, cardSummary } from "../../web/studio/parts/piece-words.js";
import { splitBlocks } from "../../web/studio/parts/word-blocks.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

const hours = { kind: "hours", fields: [{ name: "note", required: false }], list: { max: 14, fields: [{ name: "days", required: true }, { name: "hours", required: true }] } };
const PIECES = ["button", "image", "video", "map", "hours", "contact", "social", "faq", "callout"].map((kind) => (kind === "hours" ? hours : { kind, fields: [] }));

test("the menu: two groups for her, the rest in details; jobs, trade sites and research posts get theirs first", () => {
  const meta = { pieces: PIECES, compare: { kind: "compare" } };
  const plain = addItems(meta, {});
  assert.deepEqual(plain.most.map((i) => i.id), ["photo", "tip", "checklist", "table", "video", "link", "heading"]);
  assert.deepEqual(plain.more.map((i) => i.id), ["compare", "quote", "faq", "quiz", "button", "social", "map"]);
  assert.deepEqual(plain.details.map((i) => i.id), ["code", "runnable", "codepen", "footnote", "hours", "contact"]);
  assert.equal(addItems(meta, { kind: "job" }).most[0].id, "compare");
  assert.deepEqual(addItems({ ...meta, siteUses: { trade: true } }, {}).most.slice(-2).map((i) => i.id), ["hours", "contact"]);
  assert.deepEqual(addItems(meta, { kind: "research" }).most.slice(-2).map((i) => i.id), ["abstract", "references"]);
  // An older server without some pieces: those items are left out.
  assert.equal(addItems({ pieces: [] }, {}).most.some((i) => i.id === "video"), false);
  assert.equal(addItems({ pieces: [] }, {}).more.some((i) => i.id === "compare"), false);
  for (const item of [...plain.most, ...plain.more]) assert.doesNotMatch(`${item.name} ${item.about}`, HER_BANNED, item.id);
  assert.deepEqual(filterItems(plain.most, "/TAB").map((i) => i.id), ["table"]);
  assert.deepEqual(filterItems(plain.most, "tick").map((i) => i.id), ["checklist"]);
});

test("where it goes is said before she adds it", () => {
  const text = "My mother made this every Thanksgiving.\n\nPreheat the oven.";
  assert.equal(whereItGoes("Your story", text, 5), "It goes in Your story, after “My mother made this every…”.");
  assert.equal(whereItGoes("your words", text, text.length), "It goes at the end of your words.");
  assert.equal(whereItGoes("Notes", "", 0), "It goes in Notes.");
  assert.equal(whereItGoes("your words", "\n\nWords.", 0), "It goes at the start of your words.");
});

test("each card says what it is and which form changes it; a card the form can't write back has none", () => {
  const text = "![Pie](/images/uploads/a.png)\n\n![Elsewhere](https://example.com/a.png)\n\n> [!WARNING]\n> **Hot**\n>\n> Careful.\n\n- [ ] a\n- [x] b\n- [ ] c\n- [ ] d\n- [ ] e\n\n| a | b | c | d |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n\n```piece faq\nquestion: Q1\nanswer: A\n```\n\n```piece faq\nquestion: Q1\nbogus: x\n```\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n\n[^2]: Note.\n\n<div>x</div>";
  const cards = splitBlocks(text).filter((b) => b.type === "card");
  const meta = [{ kind: "faq", fields: [], list: { fields: [{ name: "question" }, { name: "answer" }] } }];
  assert.deepEqual(cards.map((b) => cardSummary(b).name), ["Photo: Pie", "Photo: Elsewhere", "Watch out: Hot", "Checklist, 5 things", "Table, 4 columns, 1 rows", "Questions and answers, 1", "Questions and answers, 1", "Video from YouTube", "Note at the bottom, 2: Note.", "Something the person who set up your site added"]);
  assert.deepEqual(cards.map((b) => cardForm(b, meta)), ["photo", "", "tip", "checklist", "table", "faq", "", "video", "footnote", ""]);
  assert.deepEqual(cardSummary(cards[3]).more, "+1 more");
  assert.deepEqual(cardSummary(cards[4]).more, "+1 more columns");
  assert.equal(cardSummary(cards[1]).lines.at(-1), "This photo is on another website.");
  assert.deepEqual(cards.slice(0, 4).map((b) => blockThing(b)), ["Photo", "Photo", "Watch out", "Checklist"]);
  // A photo line with an unusual escape the writer wouldn't keep has no form.
  assert.equal(cardForm(splitBlocks("![a\\_b](/images/uploads/a.png)")[0], meta), "");
});

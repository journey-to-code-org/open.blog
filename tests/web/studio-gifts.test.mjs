import { test } from "node:test";
import assert from "node:assert/strict";
import { fromWords, giftsHeadline } from "../../web/studio/screens/gifts.js";
import { wrapLines } from "../../web/studio/parts/gift-card.js";

const now = Date.parse("2026-11-13T12:00:00Z");
const opens = "2026-12-25T05:00:00Z";
const gift = (over = {}) => ({ id: "x", from: "Ava", opened: false, canOpen: false, showName: true, createdAt: "2026-11-13", ...over });

test("the headline says how many are waiting and when they open, in her words", () => {
  assert.equal(giftsHeadline([], opens, now), "No gifts under your tree yet");
  assert.equal(giftsHeadline([gift()], opens, now), "1 gift waiting under your tree. You can open it Christmas morning, in 42 days.");
  assert.equal(giftsHeadline([gift(), gift()], opens, Date.parse("2026-12-24T12:00:00Z")), "2 gifts waiting under your tree. You can open them Christmas morning, tomorrow morning.");
  assert.equal(giftsHeadline([gift({ canOpen: true }), gift({ opened: true })], opens, now), "Merry Christmas! 1 gift to open");
  assert.equal(giftsHeadline([gift({ opened: true }), gift({ opened: true })], opens, now), "You've opened all 2 gifts");
});

test("who sees the giver's name is said plainly", () => {
  assert.equal(fromWords(gift({ showName: false }), true), "Only you see this name");
  assert.equal(fromWords(gift(), true), "Their name shows on your tree");
  assert.match(fromWords(gift(), false), /names are off/);
});

test("a card's message wraps at spaces, keeps its paragraphs, and stops at nine lines", () => {
  assert.deepEqual(wrapLines("Merry Christmas Grammi\nSave me some pie", 15), ["Merry Christmas", "Grammi", "Save me some", "pie"]);
  assert.equal(wrapLines("a\n".repeat(20)).length, 9);
});

import { writeCommands } from "../../web/studio/parts/write-page.js";

test("the post's commands follow its state", () => {
  const ids = (over) => writeCommands({ state: "draft", path: "posts/x.md", url: "", recipe: false, boxes: false, saveLabel: "Save draft", narrow: false, mac: false, ...over }).map((c) => c.id);
  assert.ok(!ids({}).includes("takeoff"));
  assert.ok(ids({ state: "published", url: "/x/" }).includes("takeoff"));
  assert.ok(ids({ state: "published", url: "/x/" }).includes("view"));
  assert.deepEqual(ids({ path: "" }).filter((id) => id === "old"), []);
  assert.ok(ids({ recipe: true, boxes: true }).includes("plain"));
  assert.ok(ids({ narrow: true }).includes("draft"));
});

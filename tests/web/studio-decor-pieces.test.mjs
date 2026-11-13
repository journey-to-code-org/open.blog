import { test } from "node:test";
import assert from "node:assert/strict";
import { changeWords, withChoice } from "../../web/studio/parts/decor-pieces.js";

const garland = { id: "garland", label: "Garland", variants: [{ id: "toyshelf", label: "From the toy shelf" }] };

test("changeWords says what's up, down, or which version", () => {
  assert.equal(changeWords(garland, false), "Garland is down.");
  assert.equal(changeWords(garland, null), "Garland is up.");
  assert.equal(changeWords(garland, "toyshelf"), "Garland is up: from the toy shelf.");
});

test("withChoice changes one piece and drops looks left as they come", () => {
  const all = { christmas: { snow: false } };
  assert.deepEqual(withChoice(all, "christmas", "garland", "toyshelf"), { christmas: { snow: false, garland: "toyshelf" } });
  assert.deepEqual(withChoice(all, "christmas", "snow", null), {});
  assert.deepEqual(withChoice({}, "thanksgiving", "banner", false), { thanksgiving: { banner: false } });
  assert.deepEqual(all, { christmas: { snow: false } }, "the saved choices are not changed in place");
});

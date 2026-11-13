import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { AMOUNT_ADVICE, adviceFor } from "../../web/studio/parts/recipe-advice.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const UNKNOWN = "Something in this recipe needs a look.";

/** Every code `recipe_check.rs` can report, read from its `as_str`. */
function engineCodes() {
  const source = readFileSync(join(root, "crates/openblog-core/src/recipe_check.rs"), "utf8");
  const block = source.slice(source.indexOf("pub fn as_str"), source.indexOf("pub fn message"));
  return [...block.matchAll(/=> "([a-z-]+)"/g)].map((m) => m[1]);
}

// A problem as the preview route's `recipeProblems` carries it (recipe_check.rs `Problem`).
const problem = (code, extra = {}) => ({ code, severity: "warning", message: "engine text", ...extra });

test("every engine code has its own words, as plain sentences", () => {
  const codes = engineCodes();
  assert.equal(codes.length, 22, "the closed list in recipe_check.rs");
  for (const code of codes) {
    const advice = adviceFor(problem(code, { ingredient: 3, step: 3, field: "cook" }));
    assert.notEqual(advice.words, UNKNOWN, code);
    assert.equal(advice.code, code);
    assert.match(advice.words, /^[A-Z"].*[.]$/s, code);
    assert.doesNotMatch(advice.words, /Settings|`|prepTime|cookTime|adaptedFrom|\bservings\b|\b(?:prep|cook|total):/, `${code}: Studio's words, not the file's`);
  }
});

test("the design's words for the list problems, with targets to the row", () => {
  assert.deepEqual(adviceFor(problem("no-ingredients")), { words: "There are no ingredients yet.", target: { list: "ingredients", index: 0 }, code: "no-ingredients" });
  assert.deepEqual(adviceFor(problem("no-steps")), { words: "There are no steps yet.", target: { list: "steps", index: 0 }, code: "no-steps" });
  assert.deepEqual(adviceFor(problem("empty-ingredient", { ingredient: 3 })), { words: "Ingredient 3 is empty. Write it or remove it.", target: { list: "ingredients", index: 2 }, code: "empty-ingredient" });
  assert.deepEqual(adviceFor(problem("empty-step", { step: 2 })).target, { list: "steps", index: 1 });
  assert.deepEqual(adviceFor(problem("numbered-step", { step: 2 })), { words: "Step 2 starts with its own number. Take it out; Studio numbers the steps.", target: { list: "steps", index: 1 }, code: "numbered-step" });
  for (const code of ["zero-quantity", "descending-range", "duplicate-ingredient", "mixed-unit-systems"]) {
    const advice = adviceFor(problem(code, { ingredient: 5 }));
    assert.deepEqual(advice.target, { list: "ingredients", index: 4 }, code);
    assert.match(advice.words, /^Ingredient 5 /, code);
  }
});

test("the amount warning is the softer one, and never blames her", () => {
  assert.equal(AMOUNT_ADVICE, "If you can, start with a number, like 2 or 1/2, so readers can make more. \"A pinch\" is fine too.");
  const advice = adviceFor(problem("unreadable-quantity", { ingredient: 3 }));
  assert.equal(advice.words, `Look at ingredient 3. ${AMOUNT_ADVICE}`);
  assert.deepEqual(advice.target, { list: "ingredients", index: 2 });
});

test("the design's words for the fields, with Studio's field names", () => {
  assert.deepEqual(adviceFor(problem("servings-not-numeric", { field: "servings" })), {
    words: "Serves should start with a number, like 8, so readers can make more or less.", target: { field: "servings" }, code: "servings-not-numeric",
  });
  assert.deepEqual(adviceFor(problem("time-not-exported", { field: "cook" })), {
    words: "Time to cook can't be read as a length of time. Write it like 20 minutes.", target: { field: "cook" }, code: "time-not-exported",
  });
  assert.equal(adviceFor(problem("time-not-exported", { field: "prep" })).words, "Time to get ready can't be read as a length of time. Write it like 20 minutes.");
  assert.equal(adviceFor(problem("time-not-exported", { field: "total" })).words, "Total time can't be read as a length of time. Write it like 20 minutes.");
  assert.deepEqual(adviceFor(problem("zero-time", { field: "prep" })).target, { field: "prep" });
  assert.equal(adviceFor(problem("incomplete-times", { field: "total" })).words, "Only one of the times is filled in. Add the other.");
  assert.deepEqual(adviceFor(problem("no-image")).target, { field: "cover" });
  assert.deepEqual(adviceFor(problem("calories-without-yield", { field: "calories" })).target, { field: "servings" });
});

test("incomplete times goes to the empty one, under whatever name the post uses", () => {
  const p = problem("incomplete-times", { field: "total" });
  assert.deepEqual(adviceFor(p, { prep: "15 min" }).target, { field: "cook" });
  assert.deepEqual(adviceFor(p, { cook: "30 min" }).target, { field: "prep" });
  assert.deepEqual(adviceFor(p, { prepTime: "15 min", cook: "" }).target, { field: "cook" });
  assert.deepEqual(adviceFor(p).target, { field: "prep" });
});

test("site setup problems name who can help and go nowhere", () => {
  for (const code of ["no-canonical-address", "no-author", "canonical-elsewhere"]) {
    const advice = adviceFor(problem(code));
    assert.equal(advice.target, null, code);
    assert.match(advice.words, /person who set up your site/, code);
  }
});

test("Studio's own checks: no course, and TODO lines left", () => {
  assert.deepEqual(adviceFor({ code: "no-course" }), { words: "Add a course, like Dessert, so readers find it with the others.", target: { field: "course" }, code: "no-course" });
  assert.deepEqual(adviceFor({ code: "todo-left" }), { words: "Some lines still say TODO.", target: null, code: "todo-left" });
});

test("unknown codes, and junk, get the gentle catch-all with the code kept", () => {
  assert.deepEqual(adviceFor(problem("new-check-from-the-future")), { words: UNKNOWN, target: null, code: "new-check-from-the-future" });
  assert.deepEqual(adviceFor({ code: "toString" }), { words: UNKNOWN, target: null, code: "toString" });
  assert.deepEqual(adviceFor(undefined), { words: UNKNOWN, target: null, code: "" });
  assert.deepEqual(adviceFor(null), { words: UNKNOWN, target: null, code: "" });
});

import assert from "node:assert/strict";
import test from "node:test";

import { RECIPE_FIELD_NAMES, isRecipe, recipeKeys } from "../../web/studio/parts/recipe-fields.js";

const CANONICAL = { servings: "servings", prep: "prepTime", cook: "cookTime", course: "course", cuisine: "cuisine", series: "series" };

test("a post with none of the fields gets the canonical names", () => {
  assert.deepEqual(recipeKeys({ title: "Rolls" }), CANONICAL);
  assert.deepEqual(recipeKeys({}), CANONICAL);
  assert.deepEqual(recipeKeys(undefined), CANONICAL);
});

test("Grammi's own names are kept: her prep: stays prep:", () => {
  // As in grammis-house's pumpkin pie front matter.
  const fields = { title: "Grammi's Pumpkin Pie", profile: "recipe", course: "Dessert", cuisine: "American", servings: "8", prep: "15 min", cook: "30 min", series: "thanksgiving" };
  assert.deepEqual(recipeKeys(fields), { servings: "servings", prep: "prep", cook: "cook", course: "course", cuisine: "cuisine", series: "series" });
});

test("every alias is found", () => {
  assert.deepEqual(recipeKeys({ serves: "4", prep_time: "10 min", cook_time: "1 hr", recipeCategory: "Dinner" }),
    { ...CANONICAL, servings: "serves", prep: "prep_time", cook: "cook_time", course: "recipeCategory" });
  assert.equal(recipeKeys({ category: "Bread" }).course, "category");
  assert.equal(recipeKeys({ cookTime: "5 min" }).cook, "cookTime");
});

test("with two names, the filled one wins in the engine's order; a blank one is used only when none is filled", () => {
  assert.equal(recipeKeys({ prepTime: "10 min", prep: "15 min" }).prep, "prepTime", "first filled name, as the engine reads");
  assert.equal(recipeKeys({ prepTime: "", prep: "15 min" }).prep, "prep", "the engine skips a blank name");
  assert.equal(recipeKeys({ prep: "" }).prep, "prep", "a blank name already there is reused");
  assert.equal(recipeKeys({ course: [], category: ["Dessert"] }).course, "category");
  assert.equal(recipeKeys({ serves: "  " }).servings, "serves");
});

test("RECIPE_FIELD_NAMES lists the canonical name first", () => {
  for (const [name, names] of Object.entries(RECIPE_FIELD_NAMES)) assert.equal(names[0], CANONICAL[name], name);
});

test("isRecipe: profile recipe, or a legacy marker with no profile", () => {
  assert.equal(isRecipe({ profile: "recipe" }), true);
  assert.equal(isRecipe({ profile: " Recipe " }), true);
  assert.equal(isRecipe({ recipe: "true" }), true);
  assert.equal(isRecipe({ recipe: true }), true);
  assert.equal(isRecipe({ recipe: "yes" }), true);
  assert.equal(isRecipe({ recipe: "On" }), true);
  assert.equal(isRecipe({ type: "recipe" }), true);
  assert.equal(isRecipe({ layout: "Recipe" }), true);
  assert.equal(isRecipe({ kind: "RECIPE" }), true);
  assert.equal(isRecipe({ profile: "" , layout: "recipe" }), true, "a blank profile says nothing");
});

test("isRecipe: not a recipe", () => {
  assert.equal(isRecipe({}), false);
  assert.equal(isRecipe(undefined), false);
  assert.equal(isRecipe({ title: "A story" }), false);
  assert.equal(isRecipe({ recipe: "false" }), false);
  assert.equal(isRecipe({ recipe: "grilled-cheese" }), false);
  assert.equal(isRecipe({ layout: "post" }), false);
  assert.equal(isRecipe({ profile: "article", recipe: "true" }), false, "another profile wins over a legacy marker");
  assert.equal(isRecipe({ profile: "field-journal", layout: "recipe" }), false);
  assert.equal(isRecipe({ tags: ["recipe"] }), false);
});

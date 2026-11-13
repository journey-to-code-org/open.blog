// Which front-matter names a recipe's fields use in this post, and whether a post is a recipe at
// all, by the engine's rules (`recipe.rs` field lookups, `profile.rs` legacy markers). DOM-free.

/** Each recipe field Studio edits, with the names the engine reads, first one canonical. */
export const RECIPE_FIELD_NAMES = Object.freeze({
  servings: Object.freeze(["servings", "serves"]),
  prep: Object.freeze(["prepTime", "prep", "prep_time"]),
  cook: Object.freeze(["cookTime", "cook", "cook_time"]),
  course: Object.freeze(["course", "category", "recipeCategory"]),
  cuisine: Object.freeze(["cuisine"]),
  series: Object.freeze(["series"]),
});

const filled = (value) => (Array.isArray(value) ? value.some((v) => String(v ?? "").trim()) : String(value ?? "").trim() !== "");

/**
 * The key each recipe field is written under in this post, so her `prep:` stays `prep:` and a
 * new `prepTime:` never shadows it. A name with a value wins, in the engine's order (it skips
 * blank ones too); then a name that is there but blank; else the canonical name.
 * @param {Record<string, unknown>} fields the post's front matter fields
 * @returns {{ servings: string, prep: string, cook: string, course: string, cuisine: string, series: string }}
 */
export function recipeKeys(fields) {
  const has = (key) => fields != null && Object.hasOwn(fields, key);
  const keys = {};
  for (const [name, names] of Object.entries(RECIPE_FIELD_NAMES)) {
    keys[name] = names.find((key) => has(key) && filled(fields[key])) ?? names.find(has) ?? names[0];
  }
  return keys;
}

const word = (value) => (typeof value === "string" ? value.trim().toLowerCase() : typeof value === "boolean" ? String(value) : "");

/**
 * Whether a post is a recipe: `profile: recipe` (any case), or, with no profile, the legacy
 * markers `recipe: true` (or yes, on) or `type`, `layout` or `kind` set to recipe. Another
 * profile wins over a legacy marker.
 * @param {Record<string, unknown>} fields
 * @returns {boolean}
 */
export function isRecipe(fields) {
  if (!fields) return false;
  const profile = word(fields.profile);
  if (profile) return profile === "recipe";
  if (["true", "yes", "on"].includes(word(fields.recipe))) return true;
  return ["type", "layout", "kind"].some((key) => word(fields[key]) === "recipe");
}

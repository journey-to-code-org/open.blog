// What to do about each recipe problem See how it looks finds, in her words and with Studio's
// field names, and where "Go to it" takes her. The codes are `recipe_check.rs`'s; the preview
// reply lists them as `recipeProblems`: { code, severity, ingredient?, step?, field?, message }.
// `ingredient` and `step` count from 1. DOM-free.

import { recipeKeys } from "./recipe-fields.js";
import { say } from "./words.js";

/** The names Studio shows for the time fields the check names. */
const TIME_NAMES = { prep: "Time to get ready", cook: "Time to cook", total: "Time from start to table" };

const ingredient = (n) => ({ list: "ingredients", index: Math.max(0, n - 1) });
const step = (n) => ({ list: "steps", index: Math.max(0, n - 1) });

/** The softer amount warning: "A pinch" is a fine amount, it just can't be doubled. */
export const AMOUNT_ADVICE = "If you can, start with a number, like 2 or 1/2, so readers can make more. \"A pinch\" is fine too.";

/** Words and target for each code; `n` is the ingredient or step number, `p` the whole problem. */
const ADVICE = {
  "no-ingredients": () => ["There are no ingredients yet.", ingredient(1)],
  "no-steps": () => ["There are no steps yet.", step(1)],
  "empty-ingredient": (n) => [`Ingredient ${n} is empty. Write it or remove it.`, ingredient(n)],
  "empty-step": (n) => [`Step ${n} is empty. Write it or remove it.`, step(n)],
  "unreadable-quantity": (n) => [`Look at ingredient ${n}. ${AMOUNT_ADVICE}`, ingredient(n)],
  "zero-quantity": (n) => [`Ingredient ${n} has an amount of zero. Write the amount, or leave the number out.`, ingredient(n)],
  "descending-range": (n) => [`Ingredient ${n} has a range that runs backwards. Put the smaller amount first, like 2-3.`, ingredient(n)],
  "duplicate-ingredient": (n) => [`Ingredient ${n} is in the list twice. Remove one of them.`, ingredient(n)],
  "mixed-unit-systems": (n) => [`Ingredient ${n} uses cups, ounces or pounds while others use grams or millilitres, or the other way round. Nothing was changed. You could give both, like 1 cup (240 ml).`, ingredient(n)],
  "numbered-step": (n) => [`Step ${n} starts with its own number. Take it out; Studio numbers the steps.`, step(n)],
  "unlisted-text": () => ["Some words under Ingredients or Steps aren't in the list. Readers see them, but recipe apps won't. Put them in a row, or in your notes.", null],
  "servings-not-numeric": () => ["Serves should start with a number, like 8, so readers can make more or less.", { field: "servings" }],
  "time-not-exported": (n, p) => [`${TIME_NAMES[p.field] || "A time"} can't be read as a length of time. Write it like 20 minutes.`, timeTarget(p.field)],
  "zero-time": (n, p) => [`${TIME_NAMES[p.field] || "A time"} is zero. Write how long it takes, or clear it.`, timeTarget(p.field)],
  "total-shorter-than-parts": () => ["Time from start to table is shorter than the time to get ready and the time to cook together.", { field: "total" }],
  "incomplete-times": (n, p, fields) => ["Only one of the times is filled in. Add the other.", { field: missingTime(fields) }],
  "calories-without-yield": () => ["Calories don't say what they're for. Fill in Serves.", { field: "servings" }],
  "unreadable-adapted-from": () => ["Where you found it should be a web address starting with https://.", { field: "adaptedFrom" }],
  "no-image": () => ["Add a cover photo. Many recipe apps and search results look for one.", { field: "cover" }],
  "canonical-elsewhere": () => [`This recipe says its original is on another website, so recipe apps are sent there. ${say("common.ask")}`, null],
  "no-canonical-address": () => [`Your site's web address isn't set up, so recipe apps can't link back here. ${say("common.ask")}`, null],
  "no-author": () => [say("recipe.askAddName"), null],
  // Studio's own checks, not the engine's (design §5): no course or cuisine, and TODO lines left.
  "no-course": () => ["Add a course, like Dessert, so readers find it with the others.", { field: "course" }],
  "todo-left": () => ["Some lines still say TODO.", null],
};

function timeTarget(field) {
  return { field: field === "prep" || field === "cook" || field === "total" ? field : "prep" };
}

/** The time she hasn't filled in yet: Time to get ready unless only that one is filled in. */
function missingTime(fields) {
  if (!fields) return "prep";
  const keys = recipeKeys(fields);
  return String(fields[keys.prep] ?? "").trim() && !String(fields[keys.cook] ?? "").trim() ? "cook" : "prep";
}

/**
 * Her words for one recipe problem, and where "Go to it" takes her: `{ list: "ingredients" |
 * "steps", index }` (0-based row), `{ field }` (servings, prep, cook, total, course, cover,
 * adaptedFrom) or null when there is nowhere to go. An unknown code gets "Something in this
 * recipe needs a look."; `code` is kept for Details.
 * Besides the engine's codes, `no-course` and `todo-left` are Studio's own (design §5).
 * @param {{ code?: string, ingredient?: number, step?: number, field?: string }} problem
 * @param {Record<string, unknown>} [fields] the post's fields, to tell which time is missing
 * @returns {{ words: string, target: object | null, code: string }}
 */
export function adviceFor(problem, fields) {
  const code = String(problem?.code ?? "");
  const advice = Object.hasOwn(ADVICE, code) ? ADVICE[code] : null;
  if (!advice) return { words: "Something in this recipe needs a look.", target: null, code };
  const n = Number(problem.ingredient ?? problem.step) || 1;
  const [words, target] = advice(n, problem, fields);
  return { words, target, code };
}

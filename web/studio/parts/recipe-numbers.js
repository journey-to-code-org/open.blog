// A recipe's numbers (Serves, Time to get ready, Time to cook) on her layer, and Course, Cuisine and
// Part of a set behind "More about this recipe". Each is written under whichever name the post
// already uses (her `prep:` stays `prep:`), so nothing is duplicated or shadowed.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { recipeKeys } from "./recipe-fields.js";

const NUMBERS = [
  { name: "servings", label: "Serves", help: "A number, like 8, so readers can make more or less.", inputmode: "decimal" },
  { name: "prep", label: "Time to get ready", help: "Like 15 minutes or 1 hour." },
  { name: "cook", label: "Time to cook", help: "Like 45 minutes." },
];
const ABOUT = [
  { name: "course", label: "Course", help: "Like Dessert or Dinner. Readers can find recipes by it." },
  { name: "cuisine", label: "Cuisine", help: "Where the dish comes from, like Southern or Italian." },
  { name: "series", label: "Part of a set", help: "A name shared by recipes that go together, like thanksgiving." },
];

const text = (value) => (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value));

/** The fields, with `values()` → { <the post's own key>: text } for every one shown. */
export async function recipeNumbers(fields, { onChange, suggestions = {} }) {
  await use("text-field", "side-sheet", "cluster-layout");
  const keys = recipeKeys(fields || {});
  const keyOf = (name) => keys[name] || name;
  const make = ({ name, label, help, inputmode }) => h("text-field", {
    label, description: help, value: text(fields?.[keyOf(name)]), inputmode,
    "data-field": name, list: undefined, suggestions: suggestions[name],
    onValuechange: () => onChange?.(),
  });
  const numbers = NUMBERS.map(make);
  const about = ABOUT.map(make);
  const sheet = h("side-sheet", { label: "More about this recipe", side: "right" },
    h("span", { slot: "heading", text: "More about this recipe" }), ...about);
  const element = h("div", { class: "studio-recipe-numbers" }, h("cluster-layout", { gap: "0.75rem" }, ...numbers), sheet);
  const all = [...NUMBERS, ...ABOUT].map((spec, index) => [spec.name, [...numbers, ...about][index]]);
  return {
    element,
    values: () => Object.fromEntries(all.map(([name, field]) => [keyOf(name), String(field.value || "").trim()])),
    set(values) {
      for (const [name, field] of all) field.value = text(values?.[keyOf(name)]);
    },
    openAbout: () => { sheet.open = true; },
    focus(name) {
      const found = all.find(([n]) => n === name);
      if (!found) return;
      if (ABOUT.some((spec) => spec.name === name)) sheet.open = true;
      requestAnimationFrame(() => found[1].querySelector("input")?.focus());
    },
  };
}

// "What are you writing?": a recipe or a story. Home keeps one button (Write something new); this
// is the first question after it. Sites with no recipe kind skip it.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";

export async function createNewPost() {
  await use("content-card", "auto-grid");
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-new-q" },
    h("h2", { id: "studio-new-q", class: "studio-question", tabindex: "-1", text: "What are you writing?" }),
    h("auto-grid", { min: "15rem" },
      h("content-card", { heading: "A recipe", href: "#/write/new/recipe" }, h("p", { class: "studio-meta", text: "Ingredients, steps, and how long it takes." })),
      h("content-card", { heading: "A story", href: "#/write/new/story" }, h("p", { class: "studio-meta", text: "Words and photos, like a letter or a memory." }))));
  return { title: "New post", element, focus: () => element.querySelector("h2").focus() };
}

/** Whether this site has a recipe kind of post (meta.profiles lists it). */
export function hasRecipes(meta) {
  return Array.isArray(meta?.profiles) && meta.profiles.some((profile) => profile?.id === "recipe");
}

// "What are you writing?": a recipe, a story or (on a trade site, R4) a job. Home keeps one button
// (Write something new); this is the first question after it. Sites with neither skip it.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { tradeSite } from "../parts/record-kinds.js";

export async function createNewPost({ meta } = {}) {
  await use("content-card", "auto-grid");
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-new-q" },
    h("h2", { id: "studio-new-q", class: "studio-question", tabindex: "-1", text: "What are you writing?" }),
    h("auto-grid", { min: "15rem" },
      hasRecipes(meta) ? h("content-card", { heading: "A recipe", href: "#/write/new/recipe" }, h("p", { class: "studio-meta", text: "Ingredients, steps, and how long it takes." })) : null,
      h("content-card", { heading: "A story", href: "#/write/new/story" }, h("p", { class: "studio-meta", text: "Words and photos, like a letter or a memory." })),
      tradeSite(meta) ? h("content-card", { heading: "A job", href: "#/write/new/job" }, h("p", { class: "studio-meta", text: "Photos and what you did, for customers to see." })) : null));
  return { title: "New post", element, focus: () => element.querySelector("h2").focus() };
}

/** Whether this site has a recipe kind of post (meta.profiles lists it). */
export function hasRecipes(meta) {
  return Array.isArray(meta?.profiles) && meta.profiles.some((profile) => profile?.id === "recipe");
}

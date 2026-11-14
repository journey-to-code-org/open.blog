// The body of a post: one Words box, or for a recipe that fits them, the recipe boxes, or a job's
// four parts. Every box of her words shows photos, tips, tables and pieces as cards in place
// (word-box.js) with Put a photo in and Add something under it (R6). Write asks it for the text
// and tells it when to switch.
import { h, toast } from "./dom.js";
import { say } from "./words.js";
import { use } from "../zubra.js";
import { parseRecipeBody } from "./recipe-body.js";
import { recipeEditor } from "./recipe-editor.js";
import { jobEditor } from "./job-body.js";
import { createWordBox } from "./word-box.js";

/** `onChange()` after every edit; `pieces` is Add something's host (add-menu.js) for every box. */
export async function createBodyHost({ onChange, pieces }) {
  await use("text-field", "action-button", "alert-banner", "dropdown-menu", "status-badge", "toggle-switch");
  let recipe = null; // the recipe boxes, when the body fits them
  let plainWhy = ""; // why a recipe is open in one box
  let parts = null; // a job's four parts, when its body is them (R4)
  let job = null; // { scaffold, extra(url), help, removed(url) } for a job post
  const current = () => (recipe ? recipe.body() : parts ? parts.body() : words.value);
  const host = { ...pieces, changed: (box) => { pieces.changed?.(box); onChange?.(); } };
  const words = createWordBox({ label: "Words", name: "Words", place: say("add.yourWords"), rows: 18, description: say("add.wordsHelp"), host, data: { "data-box": "words" } });
  const element = h("div", { class: "studio-body" });

  /** Show `text`, in the recipe boxes when `boxes` and it fits them, else in one box. */
  async function set(text, { boxes = false, job: jobOptions = null } = {}) {
    recipe = null;
    parts = null;
    plainWhy = "";
    job = jobOptions;
    if (job) {
      parts = jobEditor(text, job.scaffold, { host });
      if (parts) {
        element.replaceChildren(parts.element, ...(job.help ? [h("p", { class: "studio-help", text: job.help })] : []));
        // Photo cards are numbered across all four parts, which only exist now.
        for (const box of parts.boxes()) box.redraw();
        return;
      }
    }
    if (boxes) {
      const parsed = parseRecipeBody(text);
      if (parsed.ok) {
        recipe = await recipeEditor(parsed, { onChange, host });
        element.replaceChildren(recipe.element);
        return;
      }
      plainWhy = parsed.line ? `${parsed.reason} (line ${parsed.line})` : parsed.reason;
    }
    words.value = text;
    element.replaceChildren(
      ...(plainWhy ? [h("alert-banner", { variant: "info", heading: "This recipe is open in one box" }, "So nothing in it gets moved around. ",
        h("details", {}, h("summary", { text: "Why?" }), h("p", { text: plainWhy })))] : []),
      words.element, ...(job?.help ? [h("p", { class: "studio-help", text: job.help })] : []));
  }

  return {
    element,
    set,
    text: current,
    /** Every box of her words, in order (Add something, Find, Suggestions). */
    boxes: () => (recipe ? recipe.boxes() : parts ? parts.boxes() : [words]),
    /** A job's four parts when its body is them: `{ get(i), set(i, text), focus(i) }`, else null. */
    jobParts: () => parts,
    /** Draw the cards again (photos renumbered, or the words as written turned on), except `but`. */
    redrawPhotos: (but = null) => { for (const box of (recipe ? recipe.boxes() : parts ? parts.boxes() : [words])) if (box !== but) box.redraw(); },
    usesBoxes: () => Boolean(recipe),
    plainWhy: () => plainWhy,
    /** The whole body with one box's text as `text` (See it in your post), nothing redrawn. */
    bodyWith: (box, text) => box.with(text, () => current()),
    /** Switch to one box (always works) or to the boxes (says why when it can't). */
    async toPlain() {
      if (!recipe) return;
      await set(recipe.body(), { boxes: false });
      words.focus();
    },
    async toBoxes() {
      const text = words.value;
      const parsed = parseRecipeBody(text);
      if (!parsed.ok) {
        toast(`This recipe can't use the boxes: ${parsed.reason}${parsed.line ? ` (line ${parsed.line})` : ""}.`, { variant: "warning" });
        return;
      }
      await set(text, { boxes: true });
    },
    /** "Go to it" from See how it looks: a row, the story or notes, or the one box. */
    focus(target) {
      if (recipe) recipe.focus(target);
      else if (parts) parts.focus(0);
      else words.focus();
    },
  };
}

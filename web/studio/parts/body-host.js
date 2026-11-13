// The body of a post: one Words box, or for a recipe that fits them, the recipe boxes. Photos go in
// at the cursor and show as photos underneath. Write asks it for the text and tells it when to switch.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { choosePicture } from "./picture-picker.js";
import { photoStrip, withoutPhoto } from "./photo-strip.js";
import { imageMarkdown, insertParagraph } from "./image-markdown.js";
import { parseRecipeBody } from "./recipe-body.js";
import { recipeEditor } from "./recipe-editor.js";

/** `onChange()` after every edit; `maxBytes` for photos. */
export async function createBodyHost({ api, maxBytes = 0, onChange }) {
  await use("text-field", "action-button", "alert-banner");
  let recipe = null; // the recipe boxes, when the body fits them
  let plainWhy = ""; // why a recipe is open in one box
  const changed = () => {
    if (!recipe) strip.update(String(words.value || ""));
    onChange?.();
  };
  const words = h("text-field", { label: "Words", class: "studio-writing", rows: 18, description: "Leave an empty line between paragraphs. For a list, start each line with a dash (-).", onValuechange: () => changed() });
  const strip = photoStrip({ onRemove: (photo) => { words.value = withoutPhoto(String(words.value || ""), photo.line); changed(); } });
  const photoButton = h("action-button", { variant: "secondary", class: "studio-put-photo", onClick: (e) => putPhoto("words", e.currentTarget) }, "Put a photo in");
  const element = h("div", { class: "studio-body" });

  /** Show `text`, in the recipe boxes when `boxes` and it fits them, else in one box. */
  async function set(text, { boxes = false } = {}) {
    recipe = null;
    plainWhy = "";
    if (boxes) {
      const parsed = parseRecipeBody(text);
      if (parsed.ok) {
        recipe = await recipeEditor(parsed, { onChange: changed, onPutPhoto: putPhoto });
        element.replaceChildren(recipe.element);
        return;
      }
      plainWhy = parsed.line ? `${parsed.reason} (line ${parsed.line})` : parsed.reason;
    }
    words.value = text;
    element.replaceChildren(
      ...(plainWhy ? [h("alert-banner", { variant: "info", heading: "This recipe is open in one box" }, "So nothing in it gets moved around. ",
        h("details", {}, h("summary", { text: "Why?" }), h("p", { text: plainWhy })))] : []),
      words, strip.element, photoButton);
    strip.update(text);
  }

  async function putPhoto(target, opener) {
    const box = target === "words" ? words : recipe?.box(target);
    const area = box?.querySelector("textarea");
    const cursor = area ? area.selectionEnd ?? area.value.length : 0;
    const picked = await choosePicture(api, { maxBytes });
    if (!picked) { opener?.focus(); return; }
    const current = target === "words" ? String(words.value || "") : recipe.get(target);
    const placed = insertParagraph(current, cursor, imageMarkdown(picked.url, picked.description));
    if (target === "words") { words.value = placed.text; changed(); } else recipe.set(target, placed.text);
    toast(`Photo put in your ${target === "notes" ? "notes" : target === "story" ? "story" : "post"}.`);
    requestAnimationFrame(() => {
      const again = box.querySelector("textarea");
      again?.focus();
      again?.setSelectionRange(placed.cursor, placed.cursor);
    });
  }

  return {
    element,
    set,
    text: () => (recipe ? recipe.body() : String(words.value || "")),
    usesBoxes: () => Boolean(recipe),
    plainWhy: () => plainWhy,
    /** Switch to one box (always works) or to the boxes (says why when it can't). */
    async toPlain() {
      if (!recipe) return;
      await set(recipe.body(), { boxes: false });
      words.querySelector("textarea")?.focus();
    },
    async toBoxes() {
      const text = String(words.value || "");
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
      else words.querySelector("textarea")?.focus();
    },
  };
}

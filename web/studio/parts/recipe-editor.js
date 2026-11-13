// The recipe boxes: Your story, Ingredients (one row each), Steps (numbered rows), and the notes.
// They read and write the same body the site already understands (## Ingredients with "- " rows,
// ## Steps with "1." rows), through recipe-body.js, so scaling and timers keep working and anything
// Studio doesn't edit is kept byte for byte.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { splitPasted, writeRecipeBody } from "./recipe-body.js";

const LISTS = {
  ingredients: { one: "Ingredient", add: "Add an ingredient", legend: "Ingredients", help: "Start with the amount: 2 cups flour. Press Return for the next one.", rows: 1 },
  steps: { one: "Step", add: "Add a step", legend: "Steps", help: "Write times like “bake for 45 minutes” and readers get a timer.", rows: 2 },
};

/**
 * Build the editor from a parsed body. `onChange()` runs after every edit; `onPutPhoto(target)`
 * asks for a photo for "story" or "notes".
 */
export async function recipeEditor(parsed, { onChange, onPutPhoto }) {
  await use("text-field", "action-button", "dropdown-menu");
  const state = {
    story: parsed.story || "",
    ingredients: parsed.ingredients?.length ? [...parsed.ingredients] : [""],
    steps: parsed.steps?.length ? [...parsed.steps] : [""],
    notes: parsed.notes ? parsed.notes.text : "",
  };
  const notesHeading = parsed.notes?.heading || "Grammi's notes";
  const changed = () => onChange?.();

  const story = h("text-field", { label: "Your story", class: "studio-writing", rows: 8, value: state.story,
    description: "Who taught you this, the year it went wrong, who asks for seconds.",
    onValuechange: (e) => { state.story = e.detail; changed(); } });
  const notes = h("text-field", { label: notesHeading, class: "studio-writing", rows: 5, value: state.notes,
    description: "Tips, swaps, what not to do.",
    onValuechange: (e) => { state.notes = e.detail; changed(); } });
  const lists = { ingredients: listBox("ingredients"), steps: listBox("steps") };
  const others = parsed.others?.length
    ? h("p", { class: "studio-help studio-others", text: `Also in this post: ${parsed.others.map((o) => `“${o.heading}”`).join(", ")}. Studio keeps ${parsed.others.length === 1 ? "it" : "them"} just as ${parsed.others.length === 1 ? "it is" : "they are"}.` })
    : null;
  const element = h("div", { class: "studio-recipe" },
    story, h("action-button", { variant: "secondary", class: "studio-put-photo", onClick: (e) => onPutPhoto?.("story", e.currentTarget) }, "Put a photo in"),
    lists.ingredients.element, lists.steps.element,
    notes, h("action-button", { variant: "secondary", class: "studio-put-photo", onClick: (e) => onPutPhoto?.("notes", e.currentTarget) }, "Put a photo in"),
    others);

  // One list (ingredients or steps): rows of a text field and a "Move or remove" menu.
  function listBox(kind) {
    const words = LISTS[kind];
    const live = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
    const rows = h("ol", { class: "studio-rows", "aria-label": words.legend });
    const helpId = `studio-${kind}-help`;
    const box = h("fieldset", { class: "studio-list-box" },
      h("legend", { text: words.legend }),
      h("p", { id: helpId, class: "studio-help", text: words.help }),
      rows,
      h("action-button", { variant: "secondary", onClick: () => addRow(state[kind].length) }, words.add),
      live);

    const say = (text) => { live.textContent = ""; requestAnimationFrame(() => { live.textContent = text; }); };
    const field = (index) => rows.children[index]?.querySelector("input, textarea");

    function draw(focusIndex = -1, caret = null) {
      const items = state[kind];
      rows.replaceChildren(...items.map((text, index) => row(text, index, items.length)));
      if (focusIndex >= 0) {
        requestAnimationFrame(() => {
          const input = field(focusIndex);
          input?.focus();
          if (input && caret !== null) input.setSelectionRange(caret, caret);
        });
      }
    }

    function row(text, index, count) {
      const name = `${words.one} ${index + 1} of ${count}`;
      const input = h("text-field", { label: name, value: text, rows: words.rows > 1 ? words.rows : undefined, class: "studio-row-field",
        onValuechange: (e) => { state[kind][index] = e.detail; changed(); } });
      const menu = h("dropdown-menu", {
        class: "studio-row-menu",
        items: [
          { value: "up", label: "Move up", disabled: index === 0 },
          { value: "down", label: "Move down", disabled: index === count - 1 },
          { value: "remove", label: `Remove this ${words.one.toLowerCase()}` },
        ],
        onItemselect: (e) => {
          if (e.detail === "up") move(index, -1, "menu");
          if (e.detail === "down") move(index, 1, "menu");
          if (e.detail === "remove") remove(index);
        },
      }, h("span", { slot: "label" }, "Move or remove", h("span", { class: "studio-visually-hidden", text: ` ${words.one.toLowerCase()} ${index + 1}` })));
      const li = h("li", { class: "studio-row-item" }, input, menu);
      input.addEventListener("keydown", (event) => onKey(event, index));
      input.addEventListener("paste", (event) => onPaste(event, index));
      input.setAttribute("data-help", helpId);
      return li;
    }

    function onKey(event, index) {
      if (event.altKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const caret = event.target.selectionStart ?? null;
        move(index, event.key === "ArrowUp" ? -1 : 1, "keys", caret);
      } else if (kind === "ingredients" && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        addRow(index + 1);
      } else if (event.key === "Backspace" && !event.target.value && state[kind].length > 1) {
        event.preventDefault();
        remove(index, true);
      }
    }

    function onPaste(event, index) {
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!text.includes("\n")) return;
      const lines = splitPasted(text, kind);
      if (lines.length < 2) return;
      event.preventDefault();
      const items = state[kind];
      const replace = !String(items[index] || "").trim();
      if (replace) items.splice(index, 1, ...lines);
      else items.splice(index + 1, 0, ...lines);
      draw(replace ? index + lines.length - 1 : index + lines.length);
      say(`Added ${lines.length} ${words.one.toLowerCase()}s.`);
      changed();
    }

    function addRow(at) {
      state[kind].splice(at, 0, "");
      draw(at);
      say(`${words.one} ${at + 1} of ${state[kind].length} added.`);
      changed();
    }

    function remove(index, fromKeys = false) {
      state[kind].splice(index, 1);
      if (!state[kind].length) state[kind].push("");
      const next = Math.max(0, index - 1);
      draw(fromKeys ? next : Math.min(index, state[kind].length - 1), fromKeys ? (state[kind][next] || "").length : null);
      say(`Removed ${words.one.toLowerCase()} ${index + 1}. ${state[kind].length} left.`);
      changed();
    }

    function move(index, by, how, caret = null) {
      const to = index + by;
      const items = state[kind];
      if (to < 0 || to >= items.length) {
        say(`Can't move ${by < 0 ? "up" : "down"}: this is the ${by < 0 ? "first" : "last"} ${words.one.toLowerCase()}.`);
        return;
      }
      [items[index], items[to]] = [items[to], items[index]];
      draw(how === "keys" ? to : -1, caret);
      if (how === "menu") requestAnimationFrame(() => rows.children[to]?.querySelector("dropdown-menu button")?.focus());
      rows.children[to]?.classList.add("studio-row-moved");
      say(`Moved to ${words.one.toLowerCase()} ${to + 1} of ${items.length}.`);
      changed();
    }

    draw();
    return { element: box, focusRow: (index) => field(index)?.focus() };
  }

  return {
    element,
    /** The whole body, written back in the site's recipe shape. */
    body: () => writeRecipeBody({ ...parsed, story: state.story, ingredients: state.ingredients, steps: state.steps, notes: parsed.notes || state.notes.trim() ? { heading: notesHeading, text: state.notes } : null }),
    /** Where "Go to it" in See how it looks takes her. */
    focus(target) {
      if (target?.list) lists[target.list].focusRow(target.index || 0);
      else (target?.field === "notes" ? notes : story).querySelector("textarea, input")?.focus();
    },
    /** The text box a photo goes into. */
    box: (target) => (target === "notes" ? notes : story),
    /** Put text into the story or notes (after a photo goes in). */
    set(target, text) {
      const field = target === "notes" ? notes : story;
      field.value = text;
      state[target] = text;
      changed();
    },
    get: (target) => state[target],
  };
}

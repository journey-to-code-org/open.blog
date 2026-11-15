// Questions that need an answer before going on: one modal-dialog, the words, and buttons.
// Resolves to the chosen button's value, or null when closed without one (Escape, the ×).
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { partsText } from "./words.js";
import { partsNodes } from "./stranger.js";

// `heading` and each line of `text` are a string or parts from `sayParts()` (someone else's words
// placed in their own isolated node).

export async function ask({ heading, text, choices, focus = 0 }) {
  await use("modal-dialog", "action-button");
  return new Promise((resolve) => {
    let answered = false;
    const lines = typeof text === "string" || (Array.isArray(text) && text.some((part) => part && typeof part === "object" && "isolate" in part)) ? [text] : [].concat(text);
    const dialog = h("modal-dialog", { label: partsText(heading), class: "studio-dialog" },
      h("span", { slot: "heading" }, ...partsNodes(heading)),
      ...lines.map((line) => h("p", {}, ...partsNodes(line))),
      ...choices.map((choice, index) => h("action-button", {
        slot: "actions",
        variant: choice.variant || (index === 0 ? "primary" : "secondary"),
        onClick: () => { answered = true; dialog.open = false; dialog.remove(); resolve(choice.value); },
      }, choice.label)));
    dialog.addEventListener("openchange", (event) => {
      if (!event.detail && !answered) { dialog.remove(); resolve(null); }
    });
    document.body.append(dialog);
    dialog.open = true;
    // Start on the first answer (or the one `focus` names, the safe one), not the ×.
    requestAnimationFrame(() => dialog.querySelectorAll("action-button .action-button")[focus]?.focus());
  });
}

// Questions that need an answer before going on: one modal-dialog, the words, and buttons.
// Resolves to the chosen button's value, or null when closed without one (Escape, the ×).
import { h } from "./dom.js";
import { use } from "../zubra.js";

export async function ask({ heading, text, choices }) {
  await use("modal-dialog", "action-button");
  return new Promise((resolve) => {
    let answered = false;
    const dialog = h("modal-dialog", { label: heading, class: "studio-dialog" },
      h("span", { slot: "heading", text: heading }),
      ...[].concat(text).map((line) => h("p", { text: line })),
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
  });
}

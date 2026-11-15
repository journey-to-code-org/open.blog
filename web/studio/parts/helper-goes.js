// "What goes to <company>" (Studio R8): the box that sits above every button that sends something
// to another company. One line per thing that goes, what never goes, and Word for word: the exact
// text, read-only. Everything is placed as text; what it lists is computed from her choices only.
import { fill, h } from "./dom.js";
import { say } from "./words.js";

let uid = 0;

/**
 * `{ element, set({ heading, lines, never }), words(loader) }`. `loader()` gives the exact text
 * (a string, or a promise of one) and is asked only when she opens Word for word.
 */
export function createGoesBox() {
  const id = `studio-goes-${++uid}`;
  const heading = h("h4", { class: "studio-goes-heading", id });
  const list = h("ul", { class: "studio-goes-list" });
  const never = h("p", { class: "studio-goes-never" });
  const exact = h("pre", { class: "studio-goes-exact", tabindex: "0", "aria-label": say("helper.wordForWord") });
  const details = h("details", { class: "studio-goes-words" }, h("summary", { text: say("helper.wordForWord") }), exact);
  const element = h("section", { class: "studio-goes", "aria-labelledby": id, "aria-live": "polite" }, heading, list, never, details);
  let loader = null;
  let turn = 0;

  async function fillExact() {
    if (!details.open || !loader) return;
    const mine = ++turn;
    exact.textContent = say("helper.wfwLoading");
    let text = "";
    try {
      text = await loader();
    } catch {
      text = say("helper.wfwCant");
    }
    if (mine === turn) exact.textContent = String(text ?? "");
  }
  details.addEventListener("toggle", fillExact);

  return {
    element,
    /** Say what goes. Called again whenever her choices change. */
    set({ heading: title, lines = [], never: not = "" }) {
      heading.textContent = title;
      fill(list, ...lines.map((line) => h("li", { text: line })));
      never.textContent = not;
      never.hidden = !not;
      fillExact();
    },
    words(next) { loader = next; fillExact(); },
  };
}

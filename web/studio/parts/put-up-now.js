// Put it up now: a look goes up today and stays up through a day she chooses, then the calendar
// takes over again. Next year's dates never move (it's `seasons.upNow`, which expires by itself).
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { sayLongDate } from "./season-words.js";

/**
 * Ask. `looks` [{ value, label }], `look` the one to start on, `untilFor(look)` → "YYYY-MM-DD",
 * `words({ look, until })` → the sentences that say what comes down and when the calendar takes over.
 * Resolves to { theme, until } or null.
 */
export async function askPutUpNow({ looks, look, untilFor, words, unsaved = false }) {
  await use("modal-dialog", "select-field", "date-field", "action-button");
  return new Promise((resolve) => {
    let done = false;
    const state = { look, until: untilFor(look) };
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.open = false;
      dialog.remove();
      resolve(value);
    };
    const label = () => looks.find((l) => l.value === state.look)?.label || state.look;
    const heading = h("span", { slot: "heading", text: `Put ${label()} up now?` });
    const said = h("div", { "aria-live": "polite" });
    const until = h("date-field", { label: "Keep it up through", value: state.until, description: "After this day, your calendar takes over.",
      onValuechange: (e) => { if (e.detail) { state.until = e.detail; draw(); } } });
    const which = h("select-field", { label: "Which look", options: looks, value: state.look,
      onValuechange: (e) => { state.look = e.detail; state.until = untilFor(state.look); until.value = state.until; draw(); } });
    function draw() {
      heading.textContent = `Put ${label()} up now?`;
      said.replaceChildren(...words({ look: state.look, until: state.until }).map((line) => h("p", { text: line })),
        ...(unsaved ? [h("p", { class: "studio-help", text: "Your other changes stay here, not saved yet." })] : []));
    }
    const dialog = h("modal-dialog", { label: "Put it up now", class: "studio-dialog" }, heading, said, which, until,
      h("action-button", { slot: "actions", onClick: () => finish({ theme: state.look, until: state.until }) }, "Put it up now"),
      h("action-button", { slot: "actions", variant: "secondary", onClick: () => finish(null) }, "Not yet"));
    dialog.addEventListener("openchange", (e) => { if (!e.detail) finish(null); });
    draw();
    document.body.append(dialog);
    dialog.open = true;
    requestAnimationFrame(() => dialog.querySelector("action-button .action-button")?.focus());
  });
}

export { sayLongDate };

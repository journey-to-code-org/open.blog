// Readers, deciding many at once (Studio R10, split from screens/readers.js): Select puts a
// checkbox on each card in Waiting that can be decided in bulk, a bar says how many are chosen and
// shows or hides them together, and the list's keys work while a card has focus (WCAG 2.1.4).
// docs/specs/studio/r10/ux.md.
import { h, toast } from "./dom.js";
import { ask } from "./dialogs.js";
import { say } from "./words.js";
import { reasonWords, readerProblem, problemWords, bulkEligible, sharedReasons, bulkRequest, bulkOutcome, bulkWords, bulkLine } from "./reader-rules.js";

/**
 * @param {{ api: object, view: object, state: { items: object[] }, list: HTMLElement, status: HTMLElement, heading: HTMLElement,
 *   bulkBar: HTMLElement, selectBox: HTMLInputElement, selectLabel: HTMLElement, draw: () => void, focusCard: (ref: string) => void,
 *   decisions: { offerBulkUndo: (done: object[]) => void, clearUndo: () => void } }} ctx
 */
export function createReaderBulk(ctx) {
  const { api, view, state, list, status, heading, bulkBar, selectBox, selectLabel, draw, focusCard, decisions } = ctx;
  let selecting = false;
  const chosen = new Set();
  const ref = (item) => `${item.source}:${item.id}`;
  const eligible = () => state.items.filter(bulkEligible);
  const picked = () => state.items.filter((i) => chosen.has(ref(i)));

  function selectCheckbox(item, label) {
    const ok = bulkEligible(item);
    const box = h("input", { type: "checkbox", "aria-label": say("readers.selectOne", { label }), checked: chosen.has(ref(item)), disabled: !ok, class: "studio-select-one" });
    if (!ok) box.setAttribute("aria-describedby", `studio-bulk-no-${item.id}`);
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(ref(item)); else chosen.delete(ref(item));
      drawBar();
    });
    return h("span", { class: "studio-select-cell" }, box, ok ? null : h("span", { id: `studio-bulk-no-${item.id}`, class: "studio-visually-hidden", text: say("readers.bulkNotThis") }));
  }

  function setSelecting(on) {
    selecting = on && view.state === "pending";
    if (!selecting) chosen.clear();
    selectBox.checked = selecting;
    draw();
    if (selecting) selectLabel.querySelector("input")?.focus();
  }

  function drawBar() {
    const canSelect = view.state === "pending" && eligible().length >= 2;
    selectLabel.hidden = !canSelect && !selecting;
    if (!canSelect && selecting) { selecting = false; chosen.clear(); selectBox.checked = false; }
    for (const r of [...chosen]) if (!state.items.some((i) => ref(i) === r)) chosen.delete(r);
    bulkBar.hidden = !selecting;
    if (!selecting) { bulkBar.replaceChildren(); return; }
    const n = chosen.size;
    bulkBar.replaceChildren(
      h("span", { class: "studio-bulk-count", role: "status", "aria-live": "polite", text: say("readers.selected", { n }) }),
      h("action-button", { variant: "secondary", size: "sm", onClick: () => { eligible().forEach((i) => chosen.add(ref(i))); draw(); } }, say("readers.selectAll", { m: eligible().length })),
      h("action-button", { size: "sm", disabled: n < 1, onClick: () => bulkAsk("approve") }, say("readers.bulkShow", { n })),
      h("action-button", { variant: "secondary", size: "sm", disabled: n < 1, onClick: () => bulkAsk("reject") }, say("readers.bulkHide", { n })),
      h("action-button", { variant: "ghost", size: "sm", onClick: () => setSelecting(false) }, say("readers.cancel")),
    );
  }

  async function bulkAsk(action) {
    const them = picked();
    if (!them.length) return;
    let reason = null;
    if (action === "approve") {
      if (them.length >= 2) {
        const choice = await ask({
          heading: say("readers.bulkShowTitle", { n: them.length }), text: say("readers.bulkShowText"),
          choices: [{ label: say("readers.bulkShowYes"), value: "yes", variant: "secondary" }, { label: say("readers.bulkNotNow"), value: "no" }], focus: 1,
        });
        if (choice !== "yes") return;
      }
    } else {
      const reasons = sharedReasons(them);
      const choice = await ask({
        heading: say("readers.bulkHideTitle", { n: them.length }), text: say("readers.bulkHideText"),
        choices: [...reasons.map((r) => ({ label: reasonWords(r), value: r.id, variant: "secondary" })), { label: say("readers.cancel"), value: "", variant: "ghost" }],
      });
      if (!choice) return;
      reason = choice;
    }
    return bulkRun(them, action, reason);
  }

  async function bulkRun(them, action, reason) {
    bulkBar.querySelectorAll("action-button").forEach((b) => { b.disabled = true; });
    let reply;
    try {
      reply = await api.patch("engagement/moderation/batch", bulkRequest(them, action, reason));
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = problemWords(readerProblem(error, "list"));
      drawBar();
      return;
    }
    const outcome = bulkOutcome(them, reply);
    const gone = new Set(outcome.done.map(ref));
    state.items = state.items.filter((i) => !gone.has(ref(i)));
    outcome.done.forEach((i) => chosen.delete(ref(i)));
    draw();
    for (const { item, code } of outcome.failed) {
      const line = list.querySelector(`[data-ref="${ref(item)}"] .studio-comment-trouble`);
      if (line) { line.textContent = bulkLine(code); line.hidden = false; }
    }
    const said = bulkWords(outcome, action);
    status.textContent = said;
    toast(said);
    if (outcome.done.length && action === "reject") decisions.offerBulkUndo(outcome.done);
    else decisions.clearUndo();
    const near = outcome.failed[0] ? ref(outcome.failed[0].item) : state.items[0] ? ref(state.items[0]) : "";
    if (near) focusCard(near); else heading.focus();
  }

  return { selectCheckbox, setSelecting, drawBar, selecting: () => selecting };
}

/** The list's keys, only while a card has focus: j/k move, s shows, n/t open hide/take down, u undoes, x selects. */
export function readerKeys(list, { runUndo, selecting }) {
  list.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable], dropdown-menu, [role=menu]")) return;
    const card = event.target.closest?.(".studio-reader");
    if (!card) return;
    const key = event.key.toLowerCase();
    const cards = [...list.querySelectorAll(".studio-reader")];
    const at = cards.indexOf(card);
    if (key === "j" || key === "k") {
      const target = cards[at + (key === "j" ? 1 : -1)];
      if (target) { event.preventDefault(); target.querySelector(".studio-comment-who")?.focus(); }
    } else if (key === "s") {
      card.querySelector('action-button[data-action="approve"] button, action-button[data-action="approve"]')?.click();
    } else if (key === "n" || key === "t") {
      const menu = card.querySelector(`dropdown-menu[data-action="${key === "n" ? "reject" : "remove"}"]`);
      (menu?.querySelector("button") || menu)?.click();
    } else if (key === "u") {
      runUndo();
    } else if (key === "x") {
      // Select (with Select on): the card's own checkbox.
      const box = card.querySelector("input[type=checkbox].studio-reader-select, input[type=checkbox]");
      if (!selecting() || !box || box.disabled) return;
      box.click();
    } else return;
    if (key !== "j" && key !== "k") event.preventDefault();
  });
}

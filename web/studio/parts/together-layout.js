// Layout (Studio R14b, the reflection's ?sheet=layout): how everyone's parts sit on the page and in
// what order. Whoever runs it chooses one of five layouts and arranges rounds of turns (whose part,
// which part of theirs, an optional label), moving them with buttons or Alt+↑/↓. Saving names the
// revision it was built on; one saved elsewhere first reloads around what she chose. Saving asks
// everyone to agree again, and says so; Undo puts the previous layout back. Nobody's words are read.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { ask } from "./dialogs.js";
import { staleArrangement, togetherProblem } from "./together-rules.js";
import { ARRANGEMENT_LAYOUTS, arrangementDraft, arrangementPayload, moveItem, nextRoundId, turnWords, validateArrangement } from "./arrange-rules.js";

export async function createLayoutSheet({ api, id, onChange }) {
  await use("action-button", "alert-banner", "choice-cards", "select-field", "text-field");
  const sheet = await createSheet({ label: say("layout.title"), wide: true });
  const did = createDidLine();
  let data = null; // { structure, participants, canArrange }
  let draft = null;
  let start = "";
  const dirty = () => Boolean(draft) && JSON.stringify(draft) !== start;
  const body = h("div", { class: "studio-together-shape" });

  async function open(summary, opener) {
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    sheet.show({ heading: say("layout.sheetTitle", { title }), opener, dirty, save: () => save(),
      question: { heading: say("together.leaveAsk"), text: say("layout.clearsAgreement"), save: say("layout.save"), leave: say("together.leaveGo") },
      children: [h("p", { class: "studio-help", text: say("layout.lede") }), did.element, body],
      focus: () => body.querySelector("button, input, select")?.focus() });
    await load();
  }

  async function load(keepChoices = false) {
    try {
      data = await api.get(`collaboration/reflection?publicationId=${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.status === 401) throw error;
      // #705: the saved layout names a part its writer took out. Nothing of it can be shown;
      // whoever can read every current part may start it again.
      const stale = staleArrangement(error);
      if (stale) { drawStale(stale.revision); return; }
      did.tell(togetherProblem(error).words, { variant: "problem" });
      return;
    }
    const fresh = arrangementDraft(data.structure, data.participants);
    if (keepChoices && draft) draft = { ...draft, revision: fresh.revision };
    else draft = fresh;
    start = keepChoices ? start : JSON.stringify(draft);
    draw();
  }

  /** The layout can't be read because a part in it was taken out: say so, and offer to start again. */
  function drawStale(revision) {
    draft = null;
    start = "";
    const again = h("action-button", { onClick: () => restart(revision, again) }, say("layout.startAgain"));
    fill(body, h("alert-banner", { variant: "warning", heading: say("layout.staleTitle") }, h("p", { text: say("layout.staleText") })),
      h("p", { class: "studio-help", text: say("layout.startAgainHelp") }), h("div", { class: "studio-row" }, again));
  }

  async function restart(revision, opener) {
    const choice = await ask({ heading: say("layout.startAgainAsk"), text: [say("layout.startAgainText"), say("layout.clearsAgreement")],
      choices: [{ label: say("layout.startAgain"), value: "go" }, { label: say("layout.startAgainNo"), value: "no", variant: "secondary" }] });
    if (choice !== "go") { opener?.focus?.(); return; }
    try {
      await api.post("collaboration/reflection/reset", { publicationId: id, expectedRevision: revision, confirmed: true });
      did.tell(say("layout.startedAgain"));
      await load();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      // Someone else restarted it first, or she can't read every part yet: the sheet shows which.
      await load();
      if (!draft) did.tell(error.status === 409 ? say("layout.startAgainNeedsAll") : togetherProblem(error).words, { variant: "problem" });
    }
  }

  function draw(focusSelector = "") {
    const people = data.participants || [];
    const can = data.canArrange;
    const layout = h("choice-cards", { label: say("layout.choose"), value: draft.layout, items: ARRANGEMENT_LAYOUTS.map((l) => ({ id: l.value, title: l.words(), detail: l.help() })),
      onValuechange: (e) => { draft.layout = e.detail || draft.layout; } });
    if (!can) layout.setAttribute("inert", "");
    const rounds = draft.rounds.map((round, r) => {
      const prompt = h("text-field", { label: say("layout.roundPrompt"), description: say("layout.roundPromptHelp"), value: round.prompt, readonly: !can,
        onValuechange: (e) => { round.prompt = String(e.detail ?? ""); } });
      const turns = round.turns.map((turn, t) => {
        const name = turnWords(turn, people);
        const label = h("text-field", { label: say("layout.turnLabel"), description: say("layout.turnLabelHelp"), value: turn.label, readonly: !can, onValuechange: (e) => { turn.label = String(e.detail ?? ""); } });
        const move = (by) => { round.turns = moveItem(round.turns, t, by); draw(`[data-turn="${r}-${Math.max(0, Math.min(round.turns.length - 1, t + by))}"] .studio-move-${by < 0 ? "up" : "down"}`); };
        return h("li", { class: "studio-together-turn", "data-turn": `${r}-${t}`, onKeydown: (e) => {
          if (can && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(e.key === "ArrowUp" ? -1 : 1); }
        } },
        h("p", {}, h("bdi", { class: "studio-stranger", text: name })), label,
        can ? h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", size: "sm", class: "studio-move-up", label: say("layout.moveTurnUp", { name: people.find((p) => p.id === turn.draft)?.displayName || "", part: turn.part + 1 }), "aria-keyshortcuts": "Alt+ArrowUp", onClick: () => move(-1) }, say("layout.moveUp")),
          h("action-button", { variant: "secondary", size: "sm", class: "studio-move-down", label: say("layout.moveTurnDown", { name: people.find((p) => p.id === turn.draft)?.displayName || "", part: turn.part + 1 }), "aria-keyshortcuts": "Alt+ArrowDown", onClick: () => move(1) }, say("layout.moveDown")),
          h("action-button", { variant: "ghost", size: "sm", onClick: () => { round.turns.splice(t, 1); draw(); } }, say("layout.removeTurn"))) : null);
      });
      const who = h("select-field", { label: say("layout.turnPerson"), options: people.map((p) => ({ value: p.id, label: p.displayName })), value: people[0]?.id || "" });
      const part = h("text-field", { label: say("layout.turnPart"), inputmode: "numeric", value: "1" });
      const add = can ? h("div", { class: "studio-together-addturn" }, who, part,
        h("action-button", { variant: "secondary", onClick: () => {
          const n = Number(String(part.value || "1").trim());
          round.turns.push({ draft: String(who.value || people[0]?.id || ""), part: Number.isInteger(n) && n > 0 ? n - 1 : 0, label: "" });
          draw(`[data-turn="${r}-${round.turns.length - 1}"] input`);
        } }, say("layout.addTurn"))) : null;
      return h("section", { class: "studio-together-round", "aria-labelledby": `studio-round-${r}` },
        h("h4", { id: `studio-round-${r}`, class: "studio-together-h4", text: say("layout.round", { n: r + 1 }) }), prompt,
        h("ol", { class: "studio-together-turns" }, ...turns), add,
        can && draft.rounds.length > 1 ? h("action-button", { variant: "ghost", size: "sm", onClick: () => { draft.rounds.splice(r, 1); draw(); } }, say("layout.removeRound")) : null);
    });
    body.replaceChildren(layout, ...rounds,
      can ? h("action-button", { variant: "secondary", onClick: () => { draft.rounds.push({ id: nextRoundId(draft.rounds), prompt: "", turns: [] }); draw(".studio-together-round:last-of-type input"); } }, say("layout.addRound")) : null,
      can ? h("div", { class: "studio-sheet-footer" }, h("p", { class: "studio-help", text: say("layout.clearsAgreement") }), h("action-button", { onClick: () => save() }, say("layout.save")))
        : h("p", { class: "studio-help", text: say("layout.readOnly") }),
      h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("pre", { class: "studio-mono", tabindex: "0", text: JSON.stringify(data.structure ?? null, null, 2) })));
    // Focus goes back at once, so a second Alt+Arrow (or a held key) is not lost on the page while the
    // list is redrawn; and again on the next frame, in case a part draws itself late.
    const refocus = () => (body.querySelector(`${focusSelector}`)?.querySelector?.("button, input") || body.querySelector(focusSelector))?.focus?.();
    if (focusSelector) { refocus(); requestAnimationFrame(() => { if (!body.contains(document.activeElement)) refocus(); }); }
  }

  async function save(undoing = null) {
    const problem = validateArrangement(draft);
    if (problem) { did.tell(problem.words, { variant: "problem" }); return false; }
    const before = undoing ? null : JSON.parse(start);
    try {
      await api.put("collaboration/reflection", { publicationId: id, expectedRevision: draft.revision, structure: arrangementPayload(draft) });
      did.tell(say("layout.saved"), before ? { undo: async () => { draft = { ...before, revision: draft.revision }; await save(true); }, undoLabel: say("part.undo") } : {});
      await load();
      onChange?.();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      const said = togetherProblem(error);
      if (said.code === "changed") {
        did.tell(say("together.changedElsewhere", { what: say("layout.title") }), { variant: "problem" });
        await load(true);
      } else {
        did.tell(said.words, { variant: "problem" });
      }
      return false;
    }
  }

  return { sheet, open };
}

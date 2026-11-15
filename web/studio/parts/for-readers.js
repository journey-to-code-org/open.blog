// For readers (Studio R12, in Your research): research she chooses to show beside this post. Each
// choice says what readers get, exactly, or the rule that keeps it back; choosing never makes
// anything public that isn't already. Every change has Undo (the inverse call); a change made
// elsewhere reloads her choices and says so.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { sayId } from "./research-says.js";
import { curationItemRows, curationMove, curationSelectionName, curationStatusText, curationFieldWords } from "./curation-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { createDidLine } from "./did-line.js";
import { forHelper } from "./research-ui.js";

/** `{ api, post() }` → `{ element, load() }`; `post()` is this post's slug. */
export function createForReaders({ api, post }) {
  let view = null;
  const said = createDidLine();
  const chosen = h("div");
  const offer = h("div");
  const element = h("section", { class: "studio-section studio-for-readers", "aria-labelledby": "studio-for-readers-h" },
    h("h3", { id: "studio-for-readers-h", text: say("curate.title") }), h("p", { class: "studio-help", text: say("curate.lede") }), said.element, chosen, offer);

  const mine = () => (view?.selections || []).filter((s) => s.appliesToPost).sort((a, b) => (a.positions?.[post()] ?? 1e9) - (b.positions?.[post()] ?? 1e9));
  const preview = (id) => (view?.preview?.items || []).find((item) => item.id === id) || null;

  async function load() {
    const slug = post();
    if (!slug) { fill(chosen, h("p", { class: "studio-help", text: say("curate.saveFirst") })); fill(offer); return; }
    try {
      view = await api.get(`research/curation?post=${encodeURIComponent(slug)}`);
      paint();
    } catch (error) {
      if (error?.status === 401) throw error;
      fill(chosen, h("p", { class: "studio-help", text: researchWords(researchProblem(error, "curate")) }));
      fill(offer);
    }
  }

  async function send(method, path, body, { words, undo = null } = {}) {
    try {
      const reply = await api.call(method, path, { json: { revision: view.revision, post: post(), ...body } });
      view = { ...view, ...reply };
      paint();
      said.tell(words, undo ? { undo, undoLabel: say("research.undo") } : {});
      return reply;
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = researchProblem(error, "curate");
      if (problem.conflict) { await load(); said.tell(say("curate.changed"), { variant: "problem" }); return null; }
      said.tell(researchWords(problem) || sayId(problem.id, problem.vars || {}), { variant: "problem" });
      return null;
    }
  }

  const select = (selection, words) => send("POST", "research/curation/selections", { selection }, {
    words, undo: () => { const added = view.selections.find((s) => s.kind === selection.kind && s.target === selection.target); if (added) send("DELETE", "research/curation/selections", { id: added.id }, { words: say("research.undone") }); },
  });
  const requestOf = (s) => ({ kind: s.kind, target: s.target, ...(s.fields?.length ? { optionalFields: s.fields.filter((f) => !["by", "text"].includes(f)) } : {}), ...(s.text ? { text: s.text } : {}), ...(s.by ? { by: s.by } : {}) });

  function chosenRow(selection, index, list) {
    const item = preview(selection.id);
    const rows = item ? curationItemRows(item) : [];
    const order = list.map((s) => s.id);
    const move = (delta) => {
      const next = curationMove(order, selection.id, delta);
      send("PUT", "research/curation/order", { order: next }, { words: say("curate.moved"), undo: () => send("PUT", "research/curation/order", { order }, { words: say("research.undone") }) });
    };
    const shownNow = selection.status !== "withheld";
    const again = selection.state === "withdrawn" || selection.why === "stale";
    return h("li", { "data-selection": selection.id, "data-state": shownNow ? "shown" : "held" },
      h("p", {}, h("bdi", { text: curationSelectionName(selection) })), h("p", { class: "studio-help", text: curationStatusText(selection) }),
      rows.length ? h("details", {}, h("summary", { text: say("curate.seeWhat") }), h("dl", { class: "studio-public-fields" }, rows.flatMap((row) => [h("dt", { text: row.label }), h("dd", { class: "studio-stranger", dir: "auto", text: row.value })]))) : null,
      h("div", { class: "studio-row" },
        index > 0 ? h("action-button", { variant: "ghost", size: "sm", label: say("curate.moveUpLabel", { name: curationSelectionName(selection) }), onClick: () => move(-1) }, say("curate.moveUp")) : null,
        index < list.length - 1 ? h("action-button", { variant: "ghost", size: "sm", label: say("curate.moveDownLabel", { name: curationSelectionName(selection) }), onClick: () => move(1) }, say("curate.moveDown")) : null,
        again ? h("action-button", { variant: "secondary", size: "sm", onClick: () => send("PUT", "research/curation/selections", { id: selection.id, action: "reselect" }, { words: say("curate.shownAgain"), undo: () => send("PUT", "research/curation/selections", { id: selection.id, action: "withdraw" }, { words: say("research.undone") }) }) }, say("curate.showAgain"))
          : h("action-button", { variant: "secondary", size: "sm", onClick: () => send("PUT", "research/curation/selections", { id: selection.id, action: "withdraw" }, { words: say("curate.stopped"), undo: () => send("PUT", "research/curation/selections", { id: selection.id, action: "reselect" }, { words: say("research.undone") }) }) }, say("curate.stop")),
        h("action-button", { variant: "ghost", size: "sm", onClick: () => send("DELETE", "research/curation/selections", { id: selection.id }, { words: say("curate.takenOut"), undo: () => select(requestOf(selection), say("research.undone")) }) }, say("curate.takeOut"))),
      forHelper(`id: ${selection.id}`, `${selection.status || ""} ${selection.why || ""}`));
  }

  function chooser(kind, target, label, { text = false } = {}) {
    const spec = (view?.kinds || []).find((k) => k.kind === kind) || { optional: [], text: false };
    const taken = (view?.selections || []).some((s) => s.kind === kind && s.target === target);
    if (taken) return null;
    const fields = new Set();
    const boxes = (spec.optional || []).map((name) => {
      const id = `studio-curate-${kind}-${target}-${name}`.replace(/[^a-zA-Z0-9-]/g, "-");
      return h("div", { class: "studio-choice" }, h("input", { type: "checkbox", id, class: "studio-radio", onChange: (e) => { if (e.target.checked) fields.add(name); else fields.delete(name); } }), h("label", { for: id, text: curationFieldWords(name) }));
    });
    let words = "";
    let by = "";
    const textFields = text || spec.text ? [h("text-field", { label: say("curate.text"), rows: 3, onValuechange: (e) => { words = String(e.detail ?? ""); } }),
      h("text-field", { label: say("curate.by"), onValuechange: (e) => { by = String(e.detail ?? ""); } })] : [];
    return h("div", { class: "studio-curate-choose" }, ...boxes, ...textFields,
      h("action-button", { variant: "secondary", size: "sm", onClick: () => {
        if (textFields.length && !words.trim()) { said.tell(say("curate.needText"), { variant: "problem" }); return; }
        if (textFields.length && !by.trim()) { said.tell(say("curate.needBy"), { variant: "problem" }); return; }
        select({ kind, target, ...(fields.size ? { optionalFields: [...fields] } : {}), ...(textFields.length ? { text: words, by } : {}) }, say("curate.chosen"));
      } }, label));
  }

  function paint() {
    const list = mine();
    fill(chosen, h("h4", { text: say("curate.chosenTitle", { count: list.length }) }),
      list.length ? h("ol", { class: "studio-research-also" }, list.map((s, i) => chosenRow(s, i, list))) : h("p", { class: "studio-help", text: say("curate.noneChosen") }));
    const c = view?.candidates || {};
    const groups = [
      ...(c.sources || []).map((s) => [s.label || s.id, [chooser("reference", s.id, say("curate.chooseSource")), chooser("source-annotation", s.id, say("curate.chooseComment"), { text: true })]]),
      ...(c.entries || []).map((e) => [e.label || e.id, [chooser("contextual-entry", e.id, say("curate.chooseEntry")), chooser("explanation", e.id, say("curate.chooseExplanation"), { text: true })]]),
      ...(c.datings || []).map((d) => [d.label || d.id, [chooser("timeline", d.id, say("curate.chooseDating", { date: String(d.label || d.id) }))]]),
      ...(c.relationships || []).map((r) => [r.label || r.id, [chooser("relationship", r.id, say("curate.chooseLink", { label: String(r.label || r.id) }))]]),
      ...(c.comparisons || []).map((r) => [r.label || r.id, [chooser("comparison", r.id, say("curate.chooseComparison"))]]),
    ].filter(([, parts]) => parts.some(Boolean));
    fill(offer, h("h4", { text: say("curate.chooseTitle") }),
      groups.length ? h("ul", { class: "studio-research-also" }, groups.map(([name, parts]) => h("li", {}, h("details", {}, h("summary", {}, h("bdi", { text: String(name) })), ...parts.filter(Boolean)))))
        : h("p", { class: "studio-help", text: say("curate.notYet") }));
  }

  return { element, load };
}

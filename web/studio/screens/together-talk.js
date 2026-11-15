// What we say together (Studio R14b, #/together/<id>/together): after everyone's parts, what you say
// together. Each item speaks for the people named on it and each of them agrees to it. She adds one
// (a question to start from, which she can hide), agrees, changes its words, takes her name off, or
// moves it; each can be undone. A change made elsewhere first reloads the list around what she typed.
// Every item's words are text.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say, isolating } from "../parts/words.js";
import { partsNodes } from "../parts/stranger.js";
import { createDidLine } from "../parts/did-line.js";
import { ask } from "../parts/dialogs.js";
import { togetherProblem } from "../parts/together-rules.js";
import { OLD_PROMPTS_KEY, SYNTHESIS_KINDS, moveSynthesisItem, promptsKey, synthesisAddChange, synthesisItemText } from "../parts/conversation-rules.js";

const storage = () => { try { return globalThis.localStorage; } catch { return null; } };

/** The questions-to-start-from choice for one sign-in, reading the old Admin's key once. */
function ideasHidden(user) {
  const store = storage();
  try {
    const own = store?.getItem(promptsKey(user));
    if (own !== null && own !== undefined) return own === "1";
    const old = store?.getItem(OLD_PROMPTS_KEY) === "1";
    if (old) store?.setItem(promptsKey(user), "1");
    return old;
  } catch {
    return false;
  }
}

export async function createTogetherTalk(context, id) {
  const { api } = context;
  const coWriter = context.meta?.account === "co-writer";
  await use("action-button", "alert-banner", "breadcrumb-trail", "choice-cards", "skeleton-block", "text-field");
  const heading = h("h2", { id: "studio-talk-h", class: "studio-question", tabindex: "-1", text: say("talk.title") });
  const crumb = h("breadcrumb-trail", { items: [] });
  const back = h("a", { class: "studio-more-link studio-back", href: `#/together/${encodeURIComponent(id)}` });
  const did = createDidLine();
  const list = h("ol", { class: "studio-together-items", "aria-busy": "true" });
  const form = h("div", { class: "studio-together-shape" });
  const element = h("section", { class: "studio-page studio-together-talk", "aria-labelledby": "studio-talk-h" },
    crumb, back, heading, h("p", { class: "studio-lede", text: say("talk.lede") }), h("p", { class: "studio-help", text: say("talk.clearsAgreement") }), did.element, list, form);
  let data = null;
  let typed = { kind: "agreement", markdown: "", others: [] };

  async function load() {
    let summary = null;
    try {
      const [listed, set] = await Promise.all([api.get("collaboration/publications"), api.get(`collaboration/synthesis?publicationId=${encodeURIComponent(id)}`)]);
      summary = (listed.publications || []).find((s) => s.publicationId === id) || null;
      data = set;
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      fill(list, h("li", {}, h("alert-banner", { variant: "info" }, error.status === 404 ? say("talk.cantWrite") : togetherProblem(error).words)));
      form.replaceChildren();
      return;
    }
    const title = summary?.title || summary?.guidingQuestion || say("together.untitled");
    back.textContent = say("together.backTo", { title });
    crumb.items = [...(coWriter ? [] : [{ label: say("together.home"), href: "#/" }]), { label: say("together.nav"), href: "#/together" },
      { label: title, href: `#/together/${encodeURIComponent(id)}` }, { label: say("talk.title"), href: "" }];
    draw();
  }

  function draw(focus = "") {
    list.removeAttribute("aria-busy");
    const items = data.items || [];
    const ids = items.map((item) => item.id);
    fill(list, ...(items.length ? items.map((item, index) => itemRow(item, index, ids)) : [h("li", { class: "studio-help", text: say("talk.empty") })]));
    drawForm();
    if (focus) requestAnimationFrame(() => element.querySelector(focus)?.querySelector?.("button")?.focus());
  }

  function itemRow(item, index, ids) {
    const words = h("div", { class: "studio-stranger studio-together-words", dir: "auto" }, ...String(item.markdown || "").split(/\n[ \t]*\n/).map((p) => h("p", { dir: "auto", text: p.trim() })));
    const short = String(item.markdown || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const actions = h("div", { class: "studio-row" },
      !item.approvedByYou && (item.awaiting || []).some((p) => p.id === data.you) ? h("action-button", { size: "sm", label: say("talk.agreeLabel", { words: short }), onClick: () => send({ action: "approve", id: item.id }, say("talk.agreed")) }, say("talk.agree")) : null,
      item.approvedByYou ? h("span", { class: "studio-help", text: say("talk.youAgreed") }) : null,
      item.mine ? h("action-button", { variant: "secondary", size: "sm", onClick: () => edit(item) }, say("talk.edit")) : null,
      item.mine ? h("action-button", { variant: "ghost", size: "sm", onClick: () => send({ action: "withdraw", id: item.id }, say("talk.tookMyName"),
        () => ({ action: "edit", id: item.id, addContributors: [data.you] })) }, say("talk.takeMyName")) : null,
      h("action-button", { variant: "secondary", size: "sm", class: `studio-talk-up-${index}`, onClick: () => move(ids, item.id, -1, index) }, say("talk.moveUp")),
      h("action-button", { variant: "secondary", size: "sm", class: `studio-talk-down-${index}`, onClick: () => move(ids, item.id, 1, index) }, say("talk.moveDown")));
    return h("li", { class: "studio-together-item", "data-item": item.id },
      h("p", { class: "studio-help" }, ...partsNodes(synthesisItemText(item, isolating))), words, actions);
  }

  function move(ids, itemId, by, index) {
    const order = moveSynthesisItem(ids, itemId, by);
    if (!order) return;
    send({ action: "reorder", order }, say("talk.moved"), () => ({ action: "reorder", order: ids }), `.studio-talk-${by < 0 ? "up" : "down"}-${index + by}`);
  }

  function edit(item) {
    const row = list.querySelector(`[data-item="${CSS.escape(item.id)}"]`);
    const box = h("text-field", { label: say("talk.words"), rows: 5, value: item.markdown });
    const save = h("action-button", { onClick: () => send({ action: "edit", id: item.id, markdown: String(box.value || "") }, say("talk.edited"), () => ({ action: "edit", id: item.id, markdown: item.markdown })) }, say("talk.editSave"));
    row?.replaceChildren(box, h("div", { class: "studio-row" }, save, h("action-button", { variant: "secondary", onClick: () => draw() }, say("talk.cancel"))));
    requestAnimationFrame(() => box.querySelector("textarea")?.focus());
  }

  function drawForm() {
    const kind = SYNTHESIS_KINDS.find((k) => k.value === typed.kind) || SYNTHESIS_KINDS[0];
    const kinds = h("choice-cards", { label: say("talk.what"), value: typed.kind, items: SYNTHESIS_KINDS.map((k) => ({ id: k.value, title: k.words() })), onValuechange: (e) => { typed.kind = e.detail || typed.kind; drawForm(); } });
    const hidden = ideasHidden(api.user);
    const idea = hidden ? null : h("p", { class: "studio-row" }, h("span", { class: "studio-help", text: kind.prompt() }),
      h("action-button", { variant: "ghost", size: "sm", onClick: () => { typed.markdown = `${kind.prompt()}\n\n${typed.markdown}`; drawForm(); } }, say("talk.useIdea")));
    const toggle = h("action-button", { variant: "ghost", size: "sm", onClick: () => {
      try { if (hidden) storage()?.removeItem(promptsKey(api.user)); else storage()?.setItem(promptsKey(api.user), "1"); } catch { /* a convenience */ }
      drawForm();
    } }, hidden ? say("talk.showIdeas") : say("talk.hideIdeas"));
    const words = h("text-field", { label: say("talk.words"), description: say("talk.wordsHelp"), rows: 5, value: typed.markdown, onValuechange: (e) => { typed.markdown = String(e.detail ?? ""); } });
    const others = (data.authors || []).filter((a) => a.id !== data.you);
    const ticks = others.length ? h("fieldset", { class: "studio-together-ticks" }, h("legend", { text: say("talk.speaksFor") }),
      ...others.map((person) => h("label", { class: "studio-tick-label studio-row" },
        h("input", { type: "checkbox", checked: typed.others.includes(person.id), onChange: (e) => { typed.others = e.target.checked ? [...typed.others, person.id] : typed.others.filter((x) => x !== person.id); } }),
        h("bdi", { class: "studio-stranger", text: person.displayName })))) : null;
    const add = h("action-button", { onClick: async () => {
      const asked = synthesisAddChange(typed);
      if (asked.error) { words.error = asked.error; words.querySelector("textarea")?.focus(); return; }
      if (await send(asked.change, say("talk.added"))) typed = { kind: typed.kind, markdown: "", others: [] };
      drawForm();
    } }, say("talk.save"));
    form.replaceChildren(h("h3", { class: "studio-together-h3", text: say("talk.add") }), kinds, idea, toggle, words, ticks, add);
  }

  /** Send one change; `undo` builds the change that takes it back. True when it went. */
  async function send(change, said, undo = null, focus = "") {
    try {
      data = await api.post("collaboration/synthesis", { publicationId: id, expectedRevision: data.revision, change });
      did.tell(said, undo ? { undo: async () => { await send(undo(), say("talk.moved")); }, undoLabel: say("part.undo") } : {});
      draw(focus);
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      const problem = togetherProblem(error);
      did.tell(problem.code === "changed" ? say("together.changedElsewhere", { what: say("talk.title") }) : problem.words, { variant: "problem" });
      try { data = await api.get(`collaboration/synthesis?publicationId=${encodeURIComponent(id)}`); draw(); } catch (again) { if (again.status === 401) throw again; }
      return false;
    }
  }

  return { title: say("talk.title"), element, load, focus: () => heading.focus(),
    isDirty: () => Boolean(typed.markdown.trim()),
    async leave() {
      if (!typed.markdown.trim()) return true;
      const choice = await ask({ heading: say("together.leaveAsk"), text: say("together.leaveText"),
        choices: [{ label: say("together.leaveStay"), value: "stay" }, { label: say("together.leaveGo"), value: "go", variant: "secondary" }] });
      return choice === "go";
    } };
}

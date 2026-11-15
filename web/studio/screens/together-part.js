// Your part (Studio R14a, #/together/<id>/write): she writes her own part, and nobody else's. Every
// change is kept on this computer as she types (⚑ 6: until the server keeps a working copy, G114),
// and sent as a version on Save (Ctrl/⌘ S), on leaving, and before she lets the others read it, so
// typing never spends the 200 versions a part may have. A save another tab or device made first is
// never overwritten without her press: both are shown, and hers stays on screen. Part breaks are
// cards in place (New part here, Move up, Move down, Take out); the marker itself is shown only
// with Show the words as written.
import { fill, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say, sayParts, isolating } from "../parts/words.js";
import { ask } from "../parts/dialogs.js";
import { createDidLine } from "../parts/did-line.js";
import { createKept } from "../parts/kept.js";
import { sayWhen } from "../parts/dates.js";
import { joinNames, togetherProblem } from "../parts/together-rules.js";
import { offeredMomentsText } from "../parts/moment-rules.js";
import { createMomentsSheet } from "../parts/together-moments.js";
import {
  draftStateText, insertAtSelection, joinParts, movePartBreak, partBlocks, partBreakInsertion, promptInsertion,
  reflectionPrompts, removePartBreak, savesLeftText,
} from "../parts/part-rules.js";

const storage = () => { try { return globalThis.localStorage; } catch { return null; } };

export async function createTogetherPart(context, id, route = {}) {
  const { api } = context;
  const coWriter = context.meta?.account === "co-writer";
  await use("action-button", "alert-banner", "breadcrumb-trail", "skeleton-block", "text-field", "toggle-switch");
  const key = `together/${id}`;
  const kept = createKept(storage(), api.user);
  const hiddenKey = `studio:together:${api.user}:promptsHidden`;
  const heading = h("h2", { id: "studio-part-h", class: "studio-question", tabindex: "-1", text: say("part.title") });
  const crumb = h("breadcrumb-trail", { items: [] });
  const back = h("a", { class: "studio-more-link studio-back", href: `#/together/${encodeURIComponent(id)}` });
  const question = h("p", { class: "studio-lede" });
  const status = h("p", { class: "studio-help studio-part-status", role: "status", "aria-live": "polite" });
  const left = h("p", { class: "studio-help" });
  const banner = h("div");
  const ideas = h("details", { class: "studio-together-ideas" });
  const editor = h("div", { class: "studio-part-editor" });
  const did = createDidLine();
  const saveButton = h("action-button", { variant: "secondary", "aria-keyshortcuts": "Control+S Meta+S", onClick: () => save() }, say("part.save"));
  const breakButton = h("action-button", { variant: "secondary", onClick: () => addBreak() }, say("part.newPart"));
  const raw = h("toggle-switch", { label: say("part.asWritten"), onCheckedchange: () => drawEditor(true) });
  // R14b: the moments her part points to.
  const moments = await createMomentsSheet({ api, id });
  const momentsButton = h("action-button", { variant: "secondary", onClick: (e) => moments.open(e.currentTarget) }, say("moments.button"));
  const bar = h("div", { class: "studio-write-bar studio-together-bar" });
  const details = h("details", { class: "studio-help" });
  const body = h("div", { class: "studio-part-body", "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const element = h("section", { class: "studio-page studio-together-part", "aria-labelledby": "studio-part-h" }, crumb, back, heading, body);

  let summary = null;
  let reveal = { policy: "independent", ready: false };
  let saved = { number: 0, text: "" };
  let text = "";
  let caret = null; // { index, start, end } in the words box she was in
  let saving = false;
  let offline = false;
  let mine = null; // her words after "Use the other one", until she leaves
  const dirty = () => text !== saved.text;
  const focusSoon = (node) => requestAnimationFrame(() => (node?.querySelector?.("textarea, button, input") || node)?.focus?.());

  async function load() {
    let found;
    try {
      const listed = await api.get("collaboration/publications");
      found = (listed.publications || []).find((s) => s.publicationId === id) || null;
    } catch (error) {
      if (error.status === 401) throw error;
      return openKeptOnly(error);
    }
    if (!found) {
      fill(body, h("alert-banner", { variant: "info" }, h("p", { text: say("together.gone") }), h("action-button", { href: "#/together", variant: "secondary" }, say("together.backToList"))));
      body.removeAttribute("aria-busy");
      return;
    }
    summary = found;
    paintHead();
    if (!summary.you?.drafter) {
      fill(body, h("alert-banner", { variant: "info" }, h("p", { text: say("part.cantWrite") })));
      body.removeAttribute("aria-busy");
      return;
    }
    try {
      const [draft, shared] = await Promise.all([
        api.get(`collaboration/draft?publicationId=${encodeURIComponent(id)}`),
        api.get(`collaboration/reveal?publicationId=${encodeURIComponent(id)}`),
      ]);
      saved = { number: draft?.draft?.stamp?.number || 0, text: draft?.draft?.markdown || "" };
      reveal = { policy: shared?.policy || "independent", ready: Boolean(shared?.ready) };
    } catch (error) {
      if (error.status === 401) throw error;
      return problem(error);
    }
    text = saved.text;
    const copy = kept.get(key);
    if (copy && copy.form.words !== saved.text) {
      fill(banner, h("alert-banner", { variant: "info" }, h("p", { text: say("part.keptNewer", { when: sayWhen(copy.at) }) }),
        h("div", { class: "studio-row" },
          h("action-button", { onClick: () => { text = String(copy.form.words || ""); banner.replaceChildren(); drawEditor(); paint(); } }, say("part.useKept")),
          h("action-button", { variant: "secondary", onClick: () => { kept.clear(key); banner.replaceChildren(); paint(); } }, say("part.useSaved")))));
    } else if (copy) {
      kept.clear(key);
    }
    drawAll();
  }

  /** No signal: her part opens from what this computer kept, and every keystroke is kept again. */
  function openKeptOnly(error) {
    const copy = kept.get(key);
    if (error.status !== 0 || !copy) return problem(error);
    offline = true;
    summary = { publicationId: id, you: { drafter: true }, people: [] };
    saved = { number: Number(copy.etag) || 0, text: "" };
    text = String(copy.form.words || "");
    paintHead();
    drawAll();
    return undefined;
  }

  function problem(error) {
    body.removeAttribute("aria-busy");
    fill(body, h("alert-banner", { variant: error.status === 0 ? "info" : "danger" }, togetherProblem(error, "part").words,
      h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
  }

  function paintHead() {
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    back.textContent = say("together.backTo", { title });
    crumb.items = [...(coWriter ? [] : [{ label: say("together.home"), href: "#/" }]), { label: say("together.nav"), href: "#/together" },
      { label: title, href: `#/together/${encodeURIComponent(id)}` }, { label: say("part.title"), href: "" }];
    question.replaceChildren(summary.guidingQuestion ? h("bdi", { class: "studio-stranger", dir: "auto", text: summary.guidingQuestion }) : "");
  }

  function drawAll() {
    body.removeAttribute("aria-busy");
    drawIdeas();
    drawEditor();
    fill(body, question, status, left, banner, ideas, editor, h("div", { class: "studio-row" }, saveButton, breakButton, momentsButton), raw,
      h("p", { class: "studio-help", text: say("part.newPartHelp") }), did.element, bar, details);
    paint();
    if (route.query?.sheet === "moments" && !moments.sheet.isOpen) {
      route.query.sheet = "";
      moments.open(momentsButton);
    }
  }

  function drawIdeas() {
    let hidden = false;
    try { hidden = storage()?.getItem(hiddenKey) === "1"; } catch { hidden = false; }
    ideas.open = !hidden;
    const toggle = h("action-button", { variant: "ghost", size: "sm", onClick: () => {
      const next = ideas.open;
      try { if (next) storage()?.setItem(hiddenKey, "1"); else storage()?.removeItem(hiddenKey); } catch { /* a convenience only */ }
      ideas.open = !next;
      toggle.textContent = ideas.open ? say("part.hideIdeas") : say("part.showIdeas");
    } }, hidden ? say("part.showIdeas") : say("part.hideIdeas"));
    fill(ideas, h("summary", { text: say("part.ideas") }),
      h("ul", { class: "studio-together-idea-list" }, ...reflectionPrompts().map((idea) => h("li", { class: "studio-row" },
        h("span", { text: idea }), h("action-button", { variant: "secondary", size: "sm", label: say("part.addIdeaLabel", { idea }), onClick: () => putIn(promptInsertion(idea), say("part.ideaAdded")) }, say("part.addIdea"))))),
      toggle);
  }

  /** Where her caret is, as an offset in the whole part. */
  function offset() {
    const blocks = partBlocks(text);
    if (raw.checked) {
      const area = editor.querySelector("textarea");
      return { start: area?.selectionStart ?? text.length, end: area?.selectionEnd ?? text.length };
    }
    if (!caret) return { start: text.length, end: text.length };
    const before = joinParts(blocks.slice(0, caret.index)).length;
    return { start: before + caret.start, end: before + caret.end };
  }

  function putIn(insertion, said) {
    const was = text;
    const at = offset();
    text = insertAtSelection(text, at.start, at.end, insertion).text;
    drawEditor();
    edited();
    did.tell(said, { undo: () => { text = was; drawEditor(); edited(); did.clear(); }, undoLabel: say("part.undo") });
  }

  function addBreak() {
    putIn(partBreakInsertion(), say("part.newPartAdded"));
  }

  function drawEditor(fromToggle = false) {
    if (raw.checked) {
      const field = h("text-field", { label: say("part.asWrittenLabel"), rows: 14, value: text, class: "studio-part-raw", onValuechange: (e) => { text = String(e.detail ?? ""); edited(); } });
      fill(editor, field);
      if (fromToggle) focusSoon(field);
      return;
    }
    const blocks = partBlocks(text);
    const count = blocks.filter((b) => b.kind === "break").length + 1;
    let part = 0;
    let breakNumber = 0;
    fill(editor, ...blocks.map((block, index) => {
      if (block.kind === "break") {
        const n = breakNumber++;
        return breakCard(n, part);
      }
      part += 1;
      const field = h("text-field", { label: count > 1 ? say("part.wordsPart", { n: part }) : say("part.words"), rows: 8, value: block.text, class: "studio-part-words",
        onValuechange: (e) => { const next = partBlocks(text); next[index] = { kind: "words", text: String(e.detail ?? "") }; text = joinParts(next); edited(); } });
      field.addEventListener("keyup", () => remember(index, field));
      field.addEventListener("click", () => remember(index, field));
      field.addEventListener("focusout", () => remember(index, field));
      return field;
    }));
    if (fromToggle) focusSoon(editor.querySelector("text-field"));
  }

  function remember(index, field) {
    const area = field.querySelector("textarea");
    if (area) caret = { index, start: area.selectionStart, end: area.selectionEnd };
  }

  function breakCard(n, startsPart) {
    const move = (by) => {
      const next = movePartBreak(text, n, by);
      if (next === null) return;
      const was = text;
      text = next;
      drawEditor();
      edited();
      did.tell(say("part.moved"), { undo: () => { text = was; drawEditor(); edited(); }, undoLabel: say("part.undo") });
      focusSoon(editor.querySelectorAll(".studio-part-break")[n]?.querySelector(by < 0 ? ".studio-part-up" : ".studio-part-down"));
    };
    const takeOut = () => {
      const was = text;
      text = removePartBreak(text, n);
      drawEditor();
      edited();
      did.tell(say("part.tookOut"), { undo: () => { text = was; drawEditor(); edited(); }, undoLabel: say("part.undo"), focus: true });
    };
    const label = say("part.breakLabel", { n: startsPart + 1 });
    return h("div", { class: "studio-part-break", role: "group", "aria-label": label, onKeydown: (e) => {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(e.key === "ArrowUp" ? -1 : 1); }
    } },
    h("p", { class: "studio-part-break-label" }, h("strong", { text: say("part.newPartHere") }), " ", h("span", { class: "studio-help", text: label })),
    h("div", { class: "studio-row" },
      h("action-button", { variant: "secondary", size: "sm", class: "studio-part-up", label: say("part.moveUpLabel", { n: startsPart + 1 }), "aria-keyshortcuts": "Alt+ArrowUp", onClick: () => move(-1) }, say("part.moveUp")),
      h("action-button", { variant: "secondary", size: "sm", class: "studio-part-down", label: say("part.moveDownLabel", { n: startsPart + 1 }), "aria-keyshortcuts": "Alt+ArrowDown", onClick: () => move(1) }, say("part.moveDown")),
      h("action-button", { variant: "ghost", size: "sm", label: say("part.takeOutLabel", { n: startsPart + 1 }), onClick: takeOut }, say("part.takeOut"))));
  }

  function edited() {
    if (dirty()) kept.keep(key, String(saved.number), { words: text });
    else kept.clear(key);
    paint();
  }

  function paint() {
    const you = summary?.you || {};
    const changedSince = you.shared && (you.changedSinceShared || dirty());
    status.textContent = you.needsReshare && !dirty() ? say("together.stepReshare") : draftStateText({ saving, offline, dirty: dirty(), saved: saved.number, shared: you.shared, changedSince });
    left.textContent = savesLeftText(saved.number);
    left.hidden = !left.textContent;
    let primary = null;
    if (!you.shared && text.trim()) primary = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => share() }, say("part.share"));
    else if (changedSince && text.trim()) primary = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => share() }, say("part.shareChanges"));
    else if (you.needsReshare && text.trim()) primary = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => share() }, say("part.share"));
    const notYet = reveal.ready && !changedSince ? h("action-button", { variant: "secondary", onClick: () => takeBack() }, say("part.notYet")) : null;
    fill(bar, notYet, primary);
    bar.hidden = !notYet && !primary;
    fill(details, h("summary", { text: say("common.forHelper") }), h("p", { text: say("part.privateLede") }),
      h("p", { text: say("part.details", { n: saved.number }) }),
      h("p", { class: "studio-mono", text: `.openblog/private/collaboration/drafts/${id}.json` }));
  }

  /** Send the words on screen as a version. True once saved. */
  async function save() {
    if (saving || !summary?.you?.drafter) return false;
    if (!dirty()) { paint(); return true; }
    saving = true;
    paint();
    try {
      const reply = await api.put("collaboration/draft", { publicationId: id, expectedRevision: saved.number, markdown: text });
      saved = { number: reply?.stamp?.number || saved.number + 1, text };
      offline = false;
      kept.clear(key);
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 0) { offline = true; return false; }
      if (error.status === 409 && error.data?.current) { conflict(error.data.current); return false; }
      if (error.status === 404) { accessChanged(); return false; }
      did.tell(togetherProblem(error, "part").words, { variant: "problem" });
      return false;
    } finally {
      saving = false;
      paint();
    }
  }

  /** Her access changed while she wrote: the words stay on screen, and she can copy them. */
  function accessChanged() {
    fill(banner, h("alert-banner", { variant: "warning", role: "alert" }, h("p", { text: say("together.accessChanged") }),
      h("div", { class: "studio-row" },
        h("action-button", { onClick: async () => {
          try { await navigator.clipboard.writeText(text); did.tell(say("together.copiedWords")); } catch { did.tell(say("people.copyYourself")); }
        } }, say("together.copyMyWords")),
        h("action-button", { variant: "secondary", href: "#/together" }, say("together.backToList")))));
  }

  function conflict(current) {
    const theirs = String(current.markdown || "");
    const words = (value) => h("div", { class: "studio-part-copy", tabindex: "0", text: value });
    const block = h("div", { class: "studio-part-conflict", role: "alert" },
      h("p", {}, h("strong", { text: say("part.conflict") }), " ", say("part.conflictText")),
      h("h4", { class: "studio-together-h4", text: say("part.onBlogNow") }), words(theirs),
      h("h4", { class: "studio-together-h4", text: say("part.onScreen") }), words(text),
      h("div", { class: "studio-row" },
        h("action-button", { onClick: async () => { saved = { number: current.stamp?.number || saved.number, text: theirs }; banner.replaceChildren(); await save(); } }, say("part.keepMine")),
        h("action-button", { variant: "secondary", onClick: () => {
          mine = text;
          saved = { number: current.stamp?.number || saved.number, text: theirs };
          text = theirs;
          kept.clear(key);
          fill(banner, h("p", { class: "studio-row" }, h("action-button", { variant: "secondary", onClick: () => { text = mine; mine = null; banner.replaceChildren(); drawEditor(); edited(); } }, say("part.bringMineBack"))));
          drawEditor();
          paint();
        } }, say("part.useOther")),
        h("action-button", { variant: "ghost", onClick: () => { banner.replaceChildren(); paint(); } }, say("part.decideLater"))));
    fill(banner, block);
    focusSoon(block.querySelector("action-button"));
  }

  async function share() {
    if (!text.trim()) { did.tell(say("part.needWords"), { variant: "problem" }); return; }
    if (reveal.policy === "independent") { did.tell(say("part.cantShareNever"), { variant: "problem" }); return; }
    const agreed = (summary.people || []).filter((p) => !p.you && p.where === "agreed").map((p) => p.displayName);
    const lines = [reveal.policy === "voluntary" ? say("part.shareAskVoluntary") : say("part.shareAskText")];
    if (summary.you?.shared && agreed.length) lines.push(sayParts("part.reagreeWarn", { names: joinNames(agreed, isolating) }, ["names"]));
    const choice = await ask({ heading: say("part.shareAsk"), text: lines, choices: [{ label: say("part.shareGo"), value: "go" }, { label: say("part.shareNo"), value: "no", variant: "secondary" }] });
    if (choice !== "go") return;
    if (dirty() && !(await save())) return;
    try {
      const reply = await api.put("collaboration/reveal/ready", { publicationId: id, revision: saved.number });
      const read = { label: say("part.readThem"), href: `#/together/${encodeURIComponent(id)}/read` };
      const words = reply?.revealed ? say("part.sharedNow") : say("part.sharedWaiting");
      const about = offeredMomentsText(reply);
      did.tell(about ? `${words} ${about}` : words, { link: reply?.revealed ? read : null });
      toast(words);
      await refresh();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error, "part").words, { variant: "problem" });
    }
  }

  async function takeBack() {
    try {
      await api.put("collaboration/reveal/ready", { publicationId: id, revision: null });
      did.tell(say("part.notYetDone"));
      await refresh();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(togetherProblem(error, "part").words, { variant: "problem" });
    }
  }

  async function refresh() {
    try {
      const [listed, shared] = await Promise.all([api.get("collaboration/publications"), api.get(`collaboration/reveal?publicationId=${encodeURIComponent(id)}`)]);
      summary = (listed.publications || []).find((s) => s.publicationId === id) || summary;
      reveal = { policy: shared?.policy || reveal.policy, ready: Boolean(shared?.ready) };
    } catch (error) {
      if (error.status === 401) throw error;
    }
    paint();
  }

  // Back with a signal: what waited is sent as a version, by itself.
  const online = () => { if (offline && dirty()) save(); };
  addEventListener("online", online);

  return {
    title: say("part.title"),
    element,
    load,
    palette: [{ id: "save", label: say("part.save"), group: "Do" }, { id: "share", label: say("part.share"), group: "Do" }],
    keys: ["save", "publish"],
    command: (which) => { if (which === "save") save(); if (which === "publish" || which === "share") share(); },
    isDirty: () => dirty() || moments.sheet.isDirty(),
    focus: () => heading.focus(),
    async leave() {
      if (!(await moments.sheet.leave())) return false;
      if (!dirty() || !summary?.you?.drafter) { removeEventListener("online", online); return true; }
      const choice = await ask({ heading: say("part.leaveAsk"), text: say("part.leaveText"),
        choices: [{ label: say("part.leaveSave"), value: "save" }, { label: say("part.leaveGo"), value: "go", variant: "secondary" }] });
      if (choice === "save" && !(await save())) return false;
      if (!choice) return false;
      removeEventListener("online", online);
      return true;
    },
    route,
  };
}

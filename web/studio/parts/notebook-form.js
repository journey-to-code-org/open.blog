// A passage or a note (Studio R11, Notebook; also Write's Keep these words as a passage). A
// passage is the exact words she read, from one source, with where they are; a new one can carry
// a note about it. A note is her own observation or question, about passages, sources and
// concepts. The exact words are kept as typed. Saving says what happened; changing one gives Undo.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { createDidLine } from "./did-line.js";
import {
  MAX_PASSAGE_LOCATORS, captureSources, entryIds, entryPreview, locatorText, noteDraft, noteDraftPayload, passageDraft, passageDraftPayload,
  suggestEntryId, validateNoteDraft, validatePassageDraft,
} from "./notebook-rules.js";
import { sourceLabel } from "./source-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { dropUnsent, forHelper, keepUnsent, languageName, languageTagFor, placesEditor, stranger, unsentBanner } from "./research-ui.js";

let uid = 0;

/** Checkboxes for a few things she picks (native, as R5–R10). `{ element, value() }`. */
function checklist(legend, items, chosen, onChange) {
  const id = `studio-notebook-list-${++uid}`;
  const picked = new Set(chosen);
  const element = h("fieldset", { class: "studio-field-group studio-research-checks" }, h("legend", { text: legend }),
    items.length ? items.map((item, index) => {
      const inputId = `${id}-${index}`;
      return h("div", { class: "studio-choice" },
        h("input", { type: "checkbox", id: inputId, class: "studio-radio", checked: picked.has(item.value), onChange: (e) => { if (e.target.checked) picked.add(item.value); else picked.delete(item.value); onChange([...picked]); } }),
        h("label", { for: inputId }, stranger("span", item.label)));
    }) : h("p", { class: "studio-help", text: say("notebook.alsoNone") }));
  return { element, value: () => [...picked] };
}

/**
 * `type` is "passage" or "note"; `state()` gives `{ revision, passages, notes, sources }`.
 * `onSaved(reply, info)` takes the new notebook. `prefill` fills a new passage's words (Write).
 */
export function createNotebookForm({ api, state, type = "passage", record = null, restore = null, prefill = "", source = "", onSaved, allowFollow = true }) {
  const isPassage = type === "passage";
  let draft = restore?.draft || (isPassage ? passageDraft(record, source) : noteDraft(record));
  if (!record && !restore && isPassage && prefill) draft.excerpt = prefill;
  const baseline = JSON.stringify(isPassage ? passageDraft(record, source) : noteDraft(record));
  let follow = restore?.follow || { kind: "observation", text: "" };
  let languageShown = restore?.languageShown ?? languageName(draft.language);
  const isNew = !draft.original;
  const said = createDidLine();
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const controls = {};
  const fields = h("div", { class: "studio-form-fields" });
  const dirty = () => JSON.stringify(draft) !== baseline || Boolean(follow.text.trim());

  function drawPassage() {
    const { sources } = state();
    const choices = captureSources(sources);
    if (draft.source && !choices.some((s) => s.id === draft.source)) {
      const kept = sources.find((s) => s.id === draft.source);
      if (kept) choices.unshift(kept);
    }
    const from = h("select-field", { label: say("notebook.from"), value: draft.source, disabled: !isNew || null,
      description: isNew ? say("notebook.fromHelp") : say("notebook.sourceFixed"),
      options: [{ value: "", label: say("sources.choose") }, ...choices.map((s) => ({ value: s.id, label: sourceLabel(s) }))],
      onValuechange: (e) => { draft.source = String(e.detail ?? ""); } });
    const words = h("text-field", { label: say("notebook.words"), rows: 5, value: draft.excerpt, description: say("notebook.wordsHelp"), class: "studio-stranger-field",
      onValuechange: (e) => { draft.excerpt = String(e.detail ?? ""); } });
    const language = h("text-field", { label: say("notebook.language"), value: languageShown, description: say("sources.languageHelp"),
      onValuechange: (e) => { languageShown = String(e.detail ?? ""); const stored = passageDraft(record).language; draft.language = record && languageShown === languageName(stored) ? stored : languageTagFor(languageShown); } });
    const where = placesEditor({ legend: say("notebook.where"), rows: draft.locators, max: MAX_PASSAGE_LOCATORS, addLabel: say("notebook.addPlace"), onChange: () => { draft.locators = where.rows(); } });
    Object.assign(controls, { source: from, excerpt: words, language, locators: where });
    const parts = [from, words, language, where.element, h("p", { class: "studio-help", text: say("notebook.placeLimit") })];
    if (isNew && allowFollow) {
      const followKind = h("segmented-control", { label: say("notebook.kind"), value: follow.kind,
        options: [{ value: "observation", label: say("notebook.kindObservation") }, { value: "question", label: say("notebook.kindQuestion") }],
        onValuechange: (e) => { follow.kind = String(e.detail || "observation"); } });
      const followText = h("text-field", { label: say("notebook.note"), rows: 3, value: follow.text, description: say("notebook.followHelp"), onValuechange: (e) => { follow.text = String(e.detail ?? ""); } });
      controls.follow = followText;
      parts.push(h("fieldset", { class: "studio-field-group" }, h("legend", { text: say("notebook.follow") }), followKind, followText));
    }
    fill(fields, ...parts);
  }

  function drawNote() {
    const { passages, sources } = state();
    const kind = h("segmented-control", { label: say("notebook.kind"), value: draft.kind,
      options: [{ value: "observation", label: say("notebook.kindObservation") }, { value: "question", label: say("notebook.kindQuestion") }],
      onValuechange: (e) => { draft.kind = String(e.detail || "observation"); drawNote(); } });
    const answered = draft.kind === "question" ? h("toggle-switch", { label: say("notebook.isAnswered"), checked: draft.status === "resolved", onCheckedchange: (e) => { draft.status = e.detail ? "resolved" : "open"; } }) : null;
    const text = h("text-field", { label: say("notebook.note"), rows: 5, value: draft.text, description: say("notebook.noteHelp"), onValuechange: (e) => { draft.text = String(e.detail ?? ""); } });
    const sourceName = (id) => sourceLabel(sources.find((s) => s.id === id) || { id });
    const passageItems = (passages || []).filter((p) => !p.archived || draft.passages.includes(p.id)).map((p) => ({ value: p.id, label: `${sourceName(p.source)} — “${entryPreview(p, 50)}” (${p.id})` }));
    const sourceItems = captureSources(sources).map((s) => ({ value: s.id, label: sourceLabel(s) }));
    const aboutPassages = checklist(say("notebook.aboutPassages"), passageItems, draft.passages, (list) => { draft.passages = list; });
    const aboutSources = checklist(say("notebook.aboutSources"), sourceItems, draft.sources, (list) => { draft.sources = list; });
    const concepts = h("tag-input", { label: say("notebook.concepts"), value: draft.concepts, onValuechange: (e) => { draft.concepts = [...(e.detail || [])]; } });
    Object.assign(controls, { kind, text, passages: aboutPassages.element, sources: aboutSources.element, concepts });
    fill(fields, kind, answered, text, aboutPassages.element, aboutSources.element, concepts, h("p", { class: "studio-help", text: say("notebook.conceptsHelp") }));
  }

  const draw = () => (isPassage ? drawPassage() : drawNote());

  function clear() {
    fill(banner);
    for (const control of Object.values(controls)) {
      if (typeof control?.error === "function") control.error("");
      else if (control && "error" in control) control.error = "";
    }
  }
  function show(problem) {
    const words = researchWords(problem);
    const control = controls[problem.field];
    if (control && !problem.banner) {
      if (typeof control.error === "function") control.error(words, problem.row ?? -1);
      else control.error = words;
      requestAnimationFrame(() => (typeof control.focusRow === "function" ? control.focusRow(Math.max(0, problem.row ?? 0)) : (control.querySelector?.("input, textarea, select, button") || control).focus?.()));
    } else {
      fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: problem.alert ? "alert" : null }, h("p", { text: words }), problem.details ? forHelper(problem.details) : null));
    }
  }

  async function save() {
    clear();
    const { sources } = state();
    const problem = isPassage ? validatePassageDraft(draft, sources) : validateNoteDraft(draft);
    if (problem) { show({ ...problem, vars: problem.vars || {}, banner: false }); return false; }
    if (isNew && !draft.id) draft.id = suggestEntryId(isPassage ? "passage" : "note", entryIds(state()));
    const payload = isPassage ? passageDraftPayload(draft) : noteDraftPayload(draft);
    const was = draft.original;
    const path = isPassage ? "research/passages" : "research/notes";
    said.tell(say("research.saving"));
    let reply;
    try {
      reply = await api.call(isNew ? "POST" : "PUT", path, { json: { revision: state().revision, [isPassage ? "passage" : "note"]: payload } });
    } catch (error) {
      if (error?.status === 401) throw error;
      said.clear();
      if (isNew) draft.id = "";
      const problem = researchProblem(error, "notebook");
      if (problem.signal) {
        keepUnsent("notebook", { key: draft.original ? draft.id : `new-${type}`, type, state: { draft: structuredClone(draft), follow: { ...follow }, languageShown, type } });
        fill(banner, unsentBanner(() => { dropUnsent("notebook"); fill(banner); }));
        return false;
      }
      show(problem);
      return false;
    }
    said.clear();
    dropUnsent("notebook");
    // A new passage's note, if she wrote one: the passage is kept even when the note isn't.
    if (isPassage && isNew && follow.text.trim()) {
      const ids = [...entryIds(reply), payload.id];
      const note = noteDraftPayload({ ...noteDraft(null), id: suggestEntryId("note", ids), kind: follow.kind, text: follow.text, passages: [payload.id] });
      try {
        reply = await api.post("research/notes", { revision: reply.revision, note });
        follow = { kind: "observation", text: "" };
      } catch (error) {
        if (error?.status === 401) throw error;
        onSaved(reply, { added: true, was: null, id: payload.id, type, partial: true });
        if (controls.follow) controls.follow.error = say("notebook.notePartial");
        return false;
      }
    }
    onSaved(reply, { added: isNew, was, id: payload.id, type });
    return true;
  }

  draw();
  const element = h("div", { class: "studio-research-form" }, banner, fields, said.element);
  element.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); save(); }
  });
  return {
    element,
    dirty,
    save,
    id: () => draft.id,
    name: () => (isPassage ? `${sourceLabel(state().sources.find((s) => s.id === draft.source) || { id: draft.source })}${locatorText(draft.locators) ? `, ${locatorText(draft.locators)}` : ""}` : entryPreview(draft, 40)),
    snapshot: () => ({ draft: structuredClone(draft), follow: { ...follow }, languageShown }),
    focus: () => (isPassage ? (isNew && !draft.source ? controls.source : controls.excerpt) : controls.text)?.querySelector?.("select, textarea, input")?.focus?.(),
    tell: (words, options) => said.tell(words, options),
  };
}

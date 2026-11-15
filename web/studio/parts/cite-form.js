// Cite (Studio R11, Add something step 2): find a source in her library, start from a passage if
// she likes (only its source and places are copied: the exact words and her notes stay private),
// say where in the source, and see how it reads. Cite it asks the server, which writes exactly the
// text a build reads; nothing changes her words until it answers. Changing a citation opens the
// same form filled in; Done with nothing changed writes nothing. With no signal what she chose is
// kept here until she presses Cite it again.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import {
  citationDraftPayload, citationInsertionProblem, citationLabel, citationLocatorsFromPassage, citationSourceChoices, formatCitationText, validateCitationDraft,
} from "./cite-rules.js";
import { MAX_PASSAGE_LOCATORS, entryPreview, locatorText, placeRows } from "./notebook-rules.js";
import { sourceKindWords, sourceLabel } from "./source-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { forHelper, placesEditor, stranger } from "./research-ui.js";
import { remember } from "./research-cache.js";

const store = (() => { try { return globalThis.sessionStorage; } catch { return null; } })();
const keep = (key, value) => { try { if (value === null) store?.removeItem(key); else store?.setItem(key, JSON.stringify(value)); } catch { /* this page only */ } };
const kept = (key) => { try { return JSON.parse(store?.getItem(key) || "null"); } catch { return null; } };

/** What Cite says when a citation can't go where the caret is, or "". */
export function refusalWords(problem) {
  if (problem === "code") return say("cite.refusedCode");
  if (problem === "link") return say("cite.refusedLink");
  if (problem === "html" || problem === "kept") return say("cite.refusedKept");
  return "";
}

/**
 * Show Cite in Add something's `sheet`. `span` is the citation being changed (`{ start, end,
 * citation }` in the box's words); `quotation` says it is a quotation card's. `onCited({ markdown,
 * label, span })` puts it in; `passage` starts from a notebook passage by id.
 */
export async function showCiteForm({ api, sheet, path, box, caret, span = null, quotation = false, passage = "", back, afterClose, where: whereWords, asWritten, opener, onCited }) {
  const changing = Boolean(span);
  const waitingKey = `studio-add:${path || "new"}:cite`;
  const saved = changing ? null : kept(waitingKey);
  const draft = { source: span?.citation?.key || saved?.source || "", locators: placeRows(span?.citation?.locators || saved?.locators || []), query: "" };
  const start = JSON.stringify(citationDraftPayload(draft));
  const state = { revision: "", sources: [], passages: [], notebookAvailable: true };
  let busy = false;
  const banner = h("div", { "aria-live": "polite" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const sourceError = h("p", { class: "studio-field-error", id: "studio-cite-source-error", hidden: true });
  const reads = h("p", { class: "studio-cite-reads", "aria-live": "polite" });
  const writes = h("p", { class: "studio-mono" });
  const count = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const sourceList = h("div", { class: "studio-cite-sources", role: "group", tabindex: "0", "aria-label": say("cite.source"), "aria-describedby": "studio-cite-source-help studio-cite-source-error" });
  const find = h("text-field", { label: say("cite.find"), type: "search", onValuechange: (e) => { draft.query = String(e.detail ?? ""); drawSources(); } });
  const passageField = h("div");
  const where = placesEditor({ legend: say("cite.where"), help: say("cite.whereHelp"), rows: draft.locators, max: MAX_PASSAGE_LOCATORS, addLabel: say("notebook.addPlace"),
    onChange: () => { draft.locators = where.rows(); drawReads(); } });
  const refusal = asWritten ? "kept" : changing ? "" : citationInsertionProblem(box?.value ?? "", caret ?? 0);
  const citeIt = h("action-button", { class: "studio-add-it", onClick: () => commit() }, changing ? say("form.done") : say("cite.citeIt"));
  const never = h("action-button", { variant: "secondary", onClick: () => sheet.cancel() }, say("add.never"));
  const lede = h("p", { class: "studio-help studio-add-where", id: "studio-cite-where", text: refusal ? refusalWords(refusal) : changing ? (quotation ? say("quotation.changeHelp") : "") : where_() });
  function where_() { return typeof whereWords === "function" ? whereWords() : ""; }
  if (refusal) {
    citeIt.disabled = true;
    citeIt.setAttribute("aria-describedby", "studio-cite-where");
  }

  const sourceById = (id) => state.sources.find((source) => source.id === id);

  function drawSources() {
    const choices = citationSourceChoices(state.sources, draft.query, draft.source);
    const chosen = sourceById(draft.source);
    if (chosen && !choices.includes(chosen)) choices.unshift(chosen);
    count.textContent = say("cite.count", { count: choices.length });
    if (!state.sources.length) {
      fill(sourceList, h("p", { class: "studio-help", text: say("cite.emptyLibrary") }), h("a", { class: "studio-more-link", href: "#/research/sources?new=1", text: say("cite.addSource") }));
      return;
    }
    fill(sourceList, ...choices.map((source, index) => {
      const id = `studio-cite-source-${index}`;
      const year = String(source.issued || "").match(/\d{1,4}(?:\s*(?:BCE|CE|BC|AD))?/)?.[0] || "";
      const line = [say("cite.sourceLine", { kind: sourceKindWords(source.kind).name, year }).replace(/, $/, ""), source.archived ? say("cite.archived") : ""].filter(Boolean).join(" · ");
      return h("div", { class: "studio-choice" },
        h("input", { type: "radio", name: "studio-cite-source", id, value: source.id, class: "studio-radio", checked: source.id === draft.source, "aria-describedby": `${id}-line`,
          onChange: () => { draft.source = source.id; sourceError.hidden = true; drawReads(); } }),
        h("label", { for: id }, stranger("span", sourceLabel(source))),
        h("p", { id: `${id}-line`, class: "studio-help", text: line }));
    }));
  }

  function drawPassages() {
    if (state.notebookAvailable === false) { fill(passageField, h("p", { class: "studio-help", text: say("cite.noNotebook") })); return; }
    const passages = state.passages || [];
    const options = [{ value: "", label: passages.length ? say("cite.choosePassage") : say("cite.noPassages") },
      // Titles and places are shown as written, so the line is built here, not as a sentence.
      ...passages.map((item) => ({ value: item.id, label: `${sourceLabel(sourceById(item.source) || { id: item.source })} — “${entryPreview({ text: item.preview }, 60)}” (${locatorText(item.locators) || "—"})` }))];
    fill(passageField, h("select-field", { label: say("cite.fromPassage"), options, value: "", disabled: !passages.length || null, onValuechange: (e) => usePassage(String(e.detail || "")) }));
  }

  function usePassage(id) {
    const item = (state.passages || []).find((entry) => entry.id === id);
    if (!item) return;
    draft.source = item.source;
    draft.locators = placeRows(citationLocatorsFromPassage(item));
    where.set(draft.locators);
    drawSources();
    drawReads();
    status.textContent = say("cite.copiedFromPassage");
  }

  function drawReads(label = "") {
    if (!draft.source) { reads.textContent = say("cite.readsNone"); writes.textContent = ""; return; }
    const payload = citationDraftPayload(draft);
    reads.textContent = say("cite.reads", { label: label || citationLabel(payload, state.sources) });
    writes.textContent = `${say("cite.writes", { markdown: formatCitationText(payload) })} ${say("cite.keyLine", { key: payload.key })}`;
  }

  function fail(problem) {
    const words = researchWords(problem);
    if (problem.field === "source") {
      sourceError.textContent = words;
      sourceError.hidden = false;
      (sourceList.querySelector("input:checked") || sourceList.querySelector("input") || sourceList).focus();
    } else if (problem.field === "locators") {
      where.error(words, problem.row ?? 0);
      where.focusRow(Math.max(0, problem.row ?? 0));
    } else {
      fill(banner, h("alert-banner", { variant: problem.signal || problem.id === "cite.waiting" ? "info" : "warning", role: "alert" }, h("p", { text: words }), problem.details ? forHelper(problem.details) : null));
    }
  }

  async function commit() {
    if (busy || refusal) return;
    fill(banner);
    sourceError.hidden = true;
    where.error("");
    const payload = citationDraftPayload(draft);
    if (changing && JSON.stringify(payload) === start) { sheet.close(); return; }
    const problem = validateCitationDraft(draft, state.sources);
    if (problem) { fail({ ...problem, vars: problem.vars || {} }); return; }
    busy = true;
    citeIt.loading = true;
    status.textContent = say("cite.checking");
    try {
      const reply = await api.post("citations/check", { revision: state.revision, citation: payload, post: path || undefined });
      busy = false;
      citeIt.loading = false;
      status.textContent = "";
      keep(waitingKey, null);
      sheet.close();
      onCited({ markdown: reply.markdown, label: reply.label || citationLabel(payload, state.sources), span });
    } catch (error) {
      busy = false;
      citeIt.loading = false;
      status.textContent = "";
      if (error?.status === 401) throw error;
      if (!error?.status) {
        keep(waitingKey, { source: draft.source, locators: citationDraftPayload(draft).locators });
        fail({ id: "cite.waiting", field: "", vars: {} });
        return;
      }
      if (error.status === 409 && typeof error.data?.revision === "string") {
        state.revision = error.data.revision;
        if (Array.isArray(error.data.sources)) state.sources = error.data.sources;
        remember({ sources: state.sources, revision: state.revision });
        drawSources();
      }
      fail(researchProblem(error, "cite"));
    }
  }

  const content = [
    changing ? null : h("action-button", { variant: "link", class: "studio-add-back", onClick: () => back() }, say("add.back")),
    lede, banner,
    find, count,
    h("div", { class: "studio-field-group" }, h("p", { class: "studio-label", text: say("cite.source") }), h("p", { class: "studio-help", id: "studio-cite-source-help", text: say("cite.sourceHelp") }), sourceList, sourceError),
    passageField,
    where.element,
    reads,
    h("details", { class: "studio-form-details" }, h("summary", { text: say("common.forHelper") }), writes),
    h("div", { class: "studio-sheet-footer studio-add-footer" }, status, h("cluster-layout", { gap: "0.5rem" }, never, citeIt)),
  ];
  const dirty = () => JSON.stringify(citationDraftPayload(draft)) !== start;
  const question = { heading: say("cite.title"), text: say("form.addThisText"), save: changing ? say("form.done") : say("cite.citeIt"), leave: say("form.leaveOut") };
  sheet.show({ heading: changing ? say("cite.changeTitle") : say("cite.title"), children: content, opener, onClose: () => afterClose?.(),
    dirty, save: () => commit().then(() => !sheet.isOpen), question,
    focus: () => (changing ? sourceList.querySelector("input:checked") || sourceList : find.querySelector("input"))?.focus() });
  sheet.element.onkeydown = (event) => {
    if (event.altKey && event.key === "ArrowLeft" && !changing) { event.preventDefault(); back(); }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
  };

  drawReads();
  fill(sourceList, h("p", { class: "studio-help", text: say("yours.loading") }));
  try {
    const library = await api.get("citations/library");
    state.revision = library.revision;
    state.sources = library.sources || [];
    state.passages = library.passages || [];
    state.notebookAvailable = library.notebookAvailable !== false;
    remember(library);
  } catch (error) {
    if (error?.status === 401) throw error;
    fill(banner, h("alert-banner", { variant: "info" }, error?.status ? say("research.failed") : say("cite.waiting")));
  }
  drawSources();
  drawPassages();
  if (passage) usePassage(passage);
  drawReads();
}

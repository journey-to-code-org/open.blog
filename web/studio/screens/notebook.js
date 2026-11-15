// Notebook (Studio R11, #/research/notebook[/<id>]): "What did I read, and what do I think about
// it?" Passages and notes, a search (its words travel only in a request body, never the address),
// filters, and one entry open beside the list with what else is about it. Keep a passage is the
// one primary action; Write a note is beside it; copies are under More. Changing, archiving or
// taking out an entry gives Undo (decision 8). Everything here is private, and says so.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { createDidLine } from "../parts/did-line.js";
import { PLACE_KINDS, captureSources, entryPreview, filterCount, hitContext, locatorText, noteKindWords, notebookSearchBody, placeKindWords, searchIsActive } from "../parts/notebook-rules.js";
import { sourceLabel } from "../parts/source-rules.js";
import { keptKey, researchHash, researchProblem, researchWords } from "../parts/research-rules.js";
import { dropForm, keepForm, takeForm } from "../parts/research-kept.js";
import { forHelper, guardUnload, leaveResearch, researchFrame, researchPost, stranger, unsent } from "../parts/research-ui.js";
import { createNotebookForm } from "../parts/notebook-form.js";
import { createNotebookCopies } from "../parts/notebook-copy.js";

export async function createNotebook(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "empty-state", "file-drop", "segmented-control", "select-field", "side-sheet", "skeleton-block", "status-badge", "tag-input", "text-field", "toggle-switch");
  guardUnload();
  const frame = researchFrame({ screen: "notebook", go: (hash) => context.go(hash) });
  const state = { revision: "", passages: [], notes: [], sources: [], file: "" };
  const filters = { query: "", source: "", locator: "", concept: "", state: "", archived: false };
  let view = "passages";
  let hits = null; // search results, or null when not searching
  let open = null; // { form, key, type, record }
  let searchTurn = 0;
  const wanted = route.arg?.replace(/^notebook\/?/, "") || "";
  const said = createDidLine();
  const heading = h("h2", { id: "studio-notebook-h", class: "studio-question", tabindex: "-1", text: say("notebook.title") });
  const copies = await createNotebookCopies({ api, state: () => state, onBrought: (reply) => { apply(reply); paint(); }, tell: (words, options) => said.tell(words, options) });
  const more = h("dropdown-menu", { label: say("research.more"), items: [{ value: "copy", label: say("notebook.copyOpen") }, { value: "bring", label: say("notebook.bringOpen") }],
    onItemselect: (event) => { if (event.detail === "copy") copies.saveCopy(); else copies.bringIn(more); } });
  const keepPassage = h("action-button", { class: "studio-primary", onClick: () => openEntry("passage", null) }, say("notebook.newPassage"));
  const writeNote = h("action-button", { variant: "secondary", onClick: () => openEntry("note", null) }, say("notebook.newNote"));
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const search = h("text-field", { label: say("notebook.search"), type: "search", description: say("notebook.searchHelp"), onValuechange: (e) => { filters.query = String(e.detail ?? ""); runSearch(); } });
  const sourceFilter = h("select-field", { label: say("notebook.source"), value: "", options: [], onValuechange: (e) => { filters.source = String(e.detail ?? ""); runSearch(); } });
  const placeFilter = h("select-field", { label: say("notebook.placeKind"), value: "", options: [{ value: "", label: say("notebook.anyPlace") }, ...PLACE_KINDS.map((kind) => ({ value: kind, label: placeKindWords(kind) }))],
    onValuechange: (e) => { filters.locator = String(e.detail ?? ""); runSearch(); } });
  const conceptFilter = h("text-field", { label: say("notebook.concept"), onValuechange: (e) => { filters.concept = String(e.detail ?? "").trim().toLowerCase(); runSearch(); } });
  const questionFilter = h("select-field", { label: say("notebook.questions"), value: "", options: [{ value: "", label: say("notebook.all") }, { value: "open", label: say("notebook.open") }, { value: "resolved", label: say("notebook.answered") }],
    onValuechange: (e) => { filters.state = String(e.detail ?? ""); runSearch(); } });
  const archivedBox = h("input", { type: "checkbox", id: "studio-notebook-archived", class: "studio-radio", onChange: (e) => { filters.archived = e.target.checked; runSearch(); } });
  const filterSummary = h("summary", { text: say("notebook.filters", { count: 0 }) });
  const filterBox = h("details", { class: "studio-research-filterbox" }, filterSummary,
    h("div", { class: "studio-research-filters" }, sourceFilter, placeFilter, conceptFilter, questionFilter,
      h("div", { class: "studio-choice" }, archivedBox, h("label", { for: "studio-notebook-archived", text: say("notebook.showArchived") })),
      h("action-button", { variant: "ghost", size: "sm", onClick: () => clearFilters() }, say("notebook.clear"))));
  const switcher = h("segmented-control", { label: say("notebook.listLabel"), value: view, options: [{ value: "passages", label: say("notebook.passages") }, { value: "notes", label: say("notebook.notes") }],
    onValuechange: (e) => { view = String(e.detail || "passages"); paint(); } });
  const count = h("p", { class: "studio-meta", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "studio-research-list", "aria-busy": "true" }, h("skeleton-block", { lines: 4 }));
  const side = h("div", { class: "studio-research-side" }, search, filterBox, switcher, count, list);
  const entry = h("div", { class: "studio-research-entry", hidden: true });
  const columns = h("div", { class: "studio-research-columns" }, side, entry);
  const details = h("div");
  const element = h("section", { class: "studio-page studio-research-notebook", "aria-labelledby": "studio-notebook-h" },
    frame.element, h("div", { class: "studio-research-top" }, heading, more), h("div", { class: "studio-row" }, keepPassage, writeNote), banner, said.element, columns, details);

  const sourceName = (id) => sourceLabel(state.sources.find((source) => source.id === id) || { id, kind: "" });
  const passageTitle = (passage) => {
    const place = locatorText(passage.locators);
    return place ? `${sourceName(passage.source)}, ${place}` : sourceName(passage.source);
  };

  function apply(reply) {
    if (typeof reply.revision === "string") state.revision = reply.revision;
    for (const key of ["passages", "notes", "sources"]) if (Array.isArray(reply[key])) state[key] = reply[key];
    if (reply.file) state.file = reply.file;
  }

  function paintFilters() {
    sourceFilter.options = [{ value: "", label: say("notebook.anySource") }, ...captureSources(state.sources).map((source) => ({ value: source.id, label: sourceLabel(source) }))];
    sourceFilter.value = filters.source;
    filterSummary.textContent = say("notebook.filters", { count: filterCount(filters) });
  }

  function row(item, type) {
    const passage = type === "passage";
    const archived = item.archived;
    const title = passage ? passageTitle(item) : noteKindWords(item);
    const missing = !passage && (item.passages || []).some((id) => !state.passages.some((p) => p.id === id));
    const button = h("button", { type: "button", class: "studio-research-row-button", "data-entry": item.id, "aria-current": open?.key === item.id ? "true" : null,
      onClick: () => openEntry(type, item) },
    h("strong", { text: title }), stranger("span", entryPreview(item, 90), { className: "studio-research-preview", lang: passage ? item.excerpt?.language : "" }),
    missing ? h("span", { class: "studio-help", text: say("notebook.aboutMissing") }) : null,
    archived ? h("status-badge", { variant: "neutral" }, say("sources.archivedBadge")) : null);
    return h("li", {}, button);
  }

  function rowsList(items) {
    const ul = h("ul", { class: "studio-research-rows-list" }, items);
    ul.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = [...ul.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))].focus();
    });
    return ul;
  }

  function paint() {
    list.removeAttribute("aria-busy");
    paintFilters();
    const live = captureSources(state.sources);
    if (!state.sources.length || !live.length) {
      count.textContent = "";
      switcher.hidden = true;
      fill(list, h("empty-state", { heading: say("notebook.emptyTitle") }, say("notebook.needSource"),
        h("action-button", { slot: "actions", href: `${researchHash("sources")}?new=1` }, say("sources.add"))));
      return;
    }
    if (hits) {
      switcher.hidden = true;
      count.textContent = hits.length ? say("notebook.results", { count: hits.length }) : "";
      if (!hits.length) { fill(list, h("p", { class: "studio-help", text: say("notebook.noResults") })); return; }
      fill(list, rowsList(hits.map((hit) => {
        const item = (hit.entry === "passage" ? state.passages : state.notes).find((entry_) => entry_.id === hit.id) || { id: hit.id, text: hit.snippet, passages: [] };
        const li = row(item, hit.entry);
        const where = hitContext(hit);
        if (where) li.querySelector("button").append(h("span", { class: "studio-help", text: say("notebook.matchedIn", { where }) }));
        return li;
      })));
      return;
    }
    switcher.hidden = false;
    const passages = state.passages.filter((p) => filters.archived || !p.archived);
    const notes = state.notes.filter((n) => filters.archived || !n.archived);
    if (!state.passages.length && !state.notes.length) {
      count.textContent = "";
      fill(list, h("empty-state", { heading: say("notebook.emptyTitle") }, say("notebook.emptyText"),
        h("action-button", { slot: "actions", onClick: () => openEntry("passage", null) }, say("notebook.newPassage"))));
      return;
    }
    const items = view === "notes" ? notes : passages;
    count.textContent = "";
    fill(list, items.length ? rowsList(items.map((item) => row(item, view === "notes" ? "note" : "passage")))
      : h("p", { class: "studio-help", text: view === "notes" ? say("notebook.noNotes") : say("notebook.noPassages") }));
  }

  async function runSearch() {
    paintFilters();
    if (!searchIsActive(filters) && !filters.archived) { hits = null; paint(); return; }
    if (!searchIsActive(filters) && filters.archived) { hits = null; paint(); return; }
    const turn = ++searchTurn;
    try {
      const reply = await api.post("research/search", notebookSearchBody(filters));
      if (turn !== searchTurn) return;
      hits = Array.isArray(reply.hits) ? reply.hits : [];
      paint();
    } catch (error) {
      if (error?.status === 401) throw error;
      if (turn !== searchTurn) return;
      hits = [];
      paint();
      said.tell(researchWords(researchProblem(error, "notebook")), { variant: "problem" });
    }
  }

  function clearFilters() {
    Object.assign(filters, { source: "", locator: "", concept: "", state: "", archived: false });
    sourceFilter.value = ""; placeFilter.value = ""; conceptFilter.value = ""; questionFilter.value = ""; archivedBox.checked = false;
    runSearch();
  }

  function keepOpen() {
    if (!open || !open.form.dirty()) return;
    keepForm(keptKey("notebook", open.key), { screen: "notebook", id: open.key, what: open.type, name: open.form.name(), hash: entryHash(open.type, open.key), state: { ...open.form.snapshot(), type: open.type } });
  }
  const entryHash = (type, key) => (key.startsWith("new-") ? `${researchHash("notebook")}?new=${type}` : researchHash("notebook", key));

  async function alsoAbout(holder, type, record) {
    const targets = type === "passage" ? [["passage", record.id, (n) => say("notebook.alsoPassage", { count: n })], ["source", record.source, (n) => say("notebook.alsoSource", { source: sourceName(record.source), count: n })]]
      : (record.concepts || []).map((concept) => ["concept", concept, (n) => say("notebook.alsoConcept", { concept, count: n })]);
    const sections = [];
    for (const [kind, id, words] of targets) {
      try {
        const reply = await api.post("research/backlinks", { type: kind, id });
        const items = (reply.entries || []).filter((item) => item.id !== record.id);
        sections.push(h("section", { class: "studio-section" }, h("h4", { text: words(items.length) }),
          items.length ? h("ul", { class: "studio-research-also" }, items.map((item) => h("li", {},
            h("a", { href: researchHash("notebook", item.id) }, h("span", { text: item.entry === "note" ? noteKindWords({ kind: item.kind, status: item.state }) : say("notebook.passageHeading") }), ": ", stranger("span", item.preview || item.id)))))
            : h("p", { class: "studio-help", text: say("notebook.alsoNone") })));
      } catch (error) {
        if (error?.status === 401) throw error;
      }
    }
    fill(holder, ...sections);
  }

  function openEntry(type, record, { restore = null } = {}) {
    keepOpen();
    const key = record?.id || `new-${type}`;
    const kept = restore || takeForm(keptKey("notebook", key));
    const form = createNotebookForm({ api, state: () => state, type: kept?.state?.type || type, record, restore: kept?.state || null,
      source: route.query?.source || "", onSaved: (reply, info) => saved(reply, info) });
    open = { form, key, type, record };
    const isNew = !record;
    const entryMore = isNew ? null : h("dropdown-menu", {
      label: say("research.more"),
      items: [
        record.archived ? { value: "restore", label: say("notebook.restore") } : { value: "archive", label: say("notebook.archive") },
        { value: "remove", label: say("notebook.takeOut") },
        ...(type === "passage" && researchPost() ? [{ value: "cite", label: say("notebook.citeIt") }] : []),
      ],
      onItemselect: (event) => {
        if (event.detail === "archive" || event.detail === "restore") archive(type, record.id, event.detail === "archive");
        if (event.detail === "remove") remove(type, record);
        if (event.detail === "cite") context.go(`#/write/${encodeURIComponent(researchPost().path)}?add=cite&passage=${encodeURIComponent(record.id)}`);
      },
    });
    const saveButton = h("action-button", { class: "studio-primary", onClick: () => form.save() }, isNew ? say("notebook.keep") : say("notebook.save"));
    const close = h("action-button", { variant: "secondary", onClick: () => closeEntry(true) }, say("notebook.neverMind"));
    const also = h("div", { class: "studio-research-also-wrap" });
    fill(entry,
      h("action-button", { variant: "link", class: "studio-back studio-research-entry-back", onClick: () => closeEntry(true) }, say("notebook.backToList")),
      h("div", { class: "studio-research-entry-head" }, h("h3", { tabindex: "-1", text: isNew ? (type === "passage" ? say("notebook.newPassage") : say("notebook.newNote")) : type === "passage" ? say("notebook.passageHeading") : say("notebook.noteHeading") }),
        h("status-badge", { variant: "neutral" }, say("research.private"))),
      h("p", { class: "studio-help", text: say("notebook.privateLine") }),
      record?.archived ? h("p", { class: "studio-help", text: say("notebook.archivedLine") }) : null,
      form.element,
      h("div", { class: "studio-row studio-research-buttons" }, saveButton, close, entryMore),
      also,
      record ? forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }), `id: ${record.id}`) : null);
    entry.hidden = false;
    element.classList.add("studio-research-open");
    context.replaceRoute?.(entryHash(type, key));
    frame.crumbs([{ label: say("notebook.title"), href: researchHash("notebook") }, { label: isNew ? (type === "passage" ? say("notebook.newPassage") : say("notebook.newNote")) : form.name(), href: "" }]);
    frame.paintKept(keptKey("notebook", key));
    paint();
    if (record) alsoAbout(also, type, record);
    requestAnimationFrame(() => form.focus());
  }

  function closeEntry(focusList = true) {
    if (open) dropForm(keptKey("notebook", open.key));
    const was = open?.key;
    open = null;
    fill(entry);
    entry.hidden = true;
    element.classList.remove("studio-research-open");
    context.replaceRoute?.(researchHash("notebook"));
    frame.crumbs([{ label: say("notebook.title"), href: "" }]);
    frame.paintKept();
    paint();
    if (focusList) requestAnimationFrame(() => (list.querySelector(`[data-entry="${CSS.escape(was || "")}"]`) || heading).focus());
  }

  function recordOf(type, id) {
    return (type === "passage" ? state.passages : state.notes).find((item) => item.id === id) || null;
  }

  function saved(reply, { added, was, id, type, partial }) {
    apply(reply);
    dropForm(keptKey("notebook", open?.key || ""));
    view = type === "note" ? "notes" : "passages";
    switcher.value = view;
    if (added && !partial) {
      closeEntry(false);
      said.tell(say("notebook.kept"));
      requestAnimationFrame(() => list.querySelector(`[data-entry="${CSS.escape(id)}"]`)?.focus());
      return;
    }
    if (partial) { said.tell(say("notebook.kept")); return; }
    openEntry(type, recordOf(type, id));
    open?.form.tell(say("notebook.saved"), { undo: () => undoSave(type, was), undoLabel: say("research.undo") });
  }

  async function undoSave(type, was) {
    try {
      const reply = await api.put(type === "passage" ? "research/passages" : "research/notes", { revision: state.revision, [type]: was });
      apply(reply);
      openEntry(type, recordOf(type, was.id));
      open?.form.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      open?.form.tell(error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "notebook")), { variant: "problem" });
    }
  }

  async function archive(type, id, archived, { undoing = false } = {}) {
    try {
      const reply = await api.post("research/archive", { revision: state.revision, type, id, archived });
      apply(reply);
      openEntry(type, recordOf(type, id));
      open?.form.tell(undoing ? say("research.undone") : archived ? say("notebook.archived") : say("notebook.restored"),
        undoing ? {} : { undo: () => archive(type, id, !archived, { undoing: true }), undoLabel: say("research.undo") });
    } catch (error) {
      if (error?.status === 401) throw error;
      open?.form.tell(researchWords(researchProblem(error, "notebook")), { variant: "problem" });
    }
  }

  async function remove(type, record) {
    try {
      const reply = await api.call("DELETE", type === "passage" ? "research/passages" : "research/notes", { json: { revision: state.revision, id: record.id } });
      apply(reply);
      closeEntry(true);
      said.tell(say("notebook.takenOut"), { undo: () => putBack(type, record), undoLabel: say("research.undo") });
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = researchProblem(error, "notebook");
      const linked = problem.id === "notebook.stillLinked";
      const count_ = state.notes.filter((note) => (note.passages || []).includes(record.id)).length;
      open?.form.tell(linked ? say("notebook.stillLinked", { count: count_ || 1 }) : researchWords(problem), { variant: "problem" });
      if (linked) {
        filters.query = record.id;
        search.value = record.id;
        said.tell(say("notebook.stillLinked", { count: count_ || 1 }), { link: { label: say("notebook.showThem"), href: researchHash("notebook") } });
      }
    }
  }

  async function putBack(type, record) {
    try {
      const reply = await api.post(type === "passage" ? "research/passages" : "research/notes", { revision: state.revision, [type]: record });
      apply(reply);
      paint();
      said.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(error?.data?.diagnostics?.some((d) => d.code === "duplicate-id") ? say("research.undoTaken") : error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "notebook")), { variant: "problem" });
    }
  }

  async function load() {
    frame.paintKept(open ? keptKey("notebook", open.key) : "");
    frame.paintBack();
    fill(banner);
    try {
      apply(await api.get("research/notebook"));
    } catch (error) {
      if (error?.status === 401) throw error;
      list.removeAttribute("aria-busy");
      fill(list);
      const problem = researchProblem(error, "notebook");
      fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: problem.alert ? "alert" : null }, h("p", { text: researchWords(problem) }),
        problem.signal ? h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("research.tryAgain")) : forHelper(problem.details, say("research.detailsRepair"))));
      return;
    }
    paint();
    fill(details, forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }),
      say("research.detailsCounts", { active: [...state.passages, ...state.notes].filter((e) => !e.archived).length, archived: [...state.passages, ...state.notes].filter((e) => e.archived).length })));
    const waiting = unsent("notebook");
    if (waiting && !open) {
      const record = (waiting.type === "note" ? state.notes : state.passages).find((entry_) => entry_.id === waiting.key) || null;
      openEntry(waiting.type || "passage", record, { restore: { state: waiting.state } });
    } else if (wanted) {
      const passage = state.passages.find((p) => p.id === wanted);
      const note = state.notes.find((n) => n.id === wanted);
      if (passage || note) openEntry(passage ? "passage" : "note", passage || note);
    } else if (route.query?.new === "passage" || route.query?.new === "note") openEntry(route.query.new, null);
    if (route.query?.copy) copies.saveCopy();
    if (route.query?.search) requestAnimationFrame(() => search.querySelector("input")?.focus());
  }

  return {
    title: say("notebook.title"),
    element: h("div", {}, element, copies.element),
    load,
    reload: load,
    focus: () => heading.focus(),
    isDirty: () => Boolean(open?.form.dirty()),
    leave: async () => {
      if (!(await copies.leave())) return false;
      return leaveResearch({ dirty: () => Boolean(open?.form.dirty()), current: open ? keptKey("notebook", open.key) : "", keep: () => keepOpen() });
    },
    palette: [
      { id: "notebook-passage", label: say("notebook.newPassage"), group: "This screen" },
      { id: "notebook-note", label: say("notebook.newNote"), group: "This screen" },
      { id: "notebook-search", label: say("notebook.search"), group: "This screen" },
      { id: "notebook-copy", label: say("notebook.copyOpen"), group: "This screen" },
    ],
    keys: ["save"],
    command: (id) => {
      if (id === "notebook-passage") openEntry("passage", null);
      if (id === "notebook-note") openEntry("note", null);
      if (id === "notebook-search") search.querySelector("input")?.focus();
      if (id === "notebook-copy") copies.saveCopy();
      if (id === "save") open?.form.save();
    },
  };
}

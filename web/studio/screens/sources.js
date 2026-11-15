// Sources (Studio R11, #/research/sources[/<key>]): "What have I read, and how do I point to it?"
// Her library: find a source by title, person, key or identifier, filter by type and by archived,
// and open one beside the list (on a phone, full width with ‹ Your sources). Add a source is the
// one primary action; Import and Export are under More. Saving and archiving say what happened,
// with Undo. A form she leaves for another research screen or her post is kept (decision 7).
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { createDidLine } from "../parts/did-line.js";
import { SOURCE_KINDS, filterSources, sourceKindWords, sourceLabel } from "../parts/source-rules.js";
import { keptKey, researchHash, researchProblem, researchWords } from "../parts/research-rules.js";
import { dropForm, keepForm, takeForm } from "../parts/research-kept.js";
import { forHelper, guardUnload, languageName, leaveResearch, researchFrame, stranger, unsent } from "../parts/research-ui.js";
import { createSourceForm } from "../parts/source-form.js";
import { createSourceSheets } from "../parts/source-import.js";

export async function createSources(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "choice-cards", "dropdown-menu", "empty-state", "file-drop", "select-field", "side-sheet", "skeleton-block", "status-badge", "text-field");
  guardUnload();
  const frame = researchFrame({ screen: "sources", go: (hash) => context.go(hash), meta: context.meta });
  const state = { revision: "", sources: [], uses: {}, file: "", stored: false };
  const filters = { query: "", kind: "all", archived: "active" };
  let open = null; // { form, key }
  const wanted = route.arg?.replace(/^sources\/?/, "") || "";
  const said = createDidLine();
  const heading = h("h2", { id: "studio-sources-h", class: "studio-question", tabindex: "-1", text: say("sources.title") });
  const sheets = await createSourceSheets({ api, state: () => state, onImported: (reply) => { apply(reply); paintList(); } });
  const more = h("dropdown-menu", { label: say("research.more"), items: [{ value: "import", label: say("sources.importOpen") }, { value: "export", label: say("sources.exportOpen") }],
    onItemselect: (event) => { const opener = more; if (event.detail === "import") sheets.openImport(opener); else sheets.openExport(opener); } });
  const add = h("action-button", { class: "studio-primary", onClick: () => openSource(null) }, say("sources.add"));
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const find = h("text-field", { label: say("sources.find"), type: "search", description: say("sources.findHelp"), onValuechange: (e) => { filters.query = String(e.detail ?? ""); paintList(); } });
  const kind = h("select-field", { label: say("sources.typeFilter"), value: "all",
    options: [{ value: "all", label: say("sources.typeAll") }, ...SOURCE_KINDS.map((id) => ({ value: id, label: sourceKindWords(id).plural }))],
    onValuechange: (e) => { filters.kind = String(e.detail || "all"); paintList(); } });
  const show = h("select-field", { label: say("sources.show"), value: "active",
    options: [{ value: "active", label: say("sources.showActive") }, { value: "archived", label: say("sources.showArchived") }, { value: "all", label: say("sources.showBoth") }],
    onValuechange: (e) => { filters.archived = String(e.detail || "active"); paintList(); } });
  const count = h("p", { class: "studio-meta", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "studio-research-list", "aria-busy": "true" }, h("skeleton-block", { lines: 4 }));
  const listSide = h("div", { class: "studio-research-side" }, h("div", { class: "studio-research-filters" }, find, kind, show), count, list);
  const entry = h("div", { class: "studio-research-entry", hidden: true });
  const columns = h("div", { class: "studio-research-columns" }, listSide, entry);
  const details = h("div");
  const element = h("section", { class: "studio-page studio-research-sources", "aria-labelledby": "studio-sources-h" },
    frame.element, h("div", { class: "studio-research-top" }, heading, more), h("div", {}, add), banner, said.element, columns, details);

  function apply(reply) {
    if (typeof reply.revision === "string") state.revision = reply.revision;
    if (Array.isArray(reply.sources)) state.sources = reply.sources;
    if (reply.uses && typeof reply.uses === "object") state.uses = reply.uses;
    if (reply.file) state.file = reply.file;
    if (reply.source) {
      const index = state.sources.findIndex((source) => source.id === reply.source.id);
      if (index >= 0) state.sources[index] = reply.source; else state.sources.push(reply.source);
    }
  }

  function paintList() {
    list.removeAttribute("aria-busy");
    const shown = filterSources(state.sources, filters);
    count.textContent = state.sources.length ? say("sources.count", { shown: shown.length, total: state.sources.length }) : "";
    if (!state.sources.length) {
      fill(list, h("empty-state", { heading: say("sources.emptyTitle") }, say("sources.emptyText"),
        h("action-button", { slot: "actions", onClick: () => openSource(null) }, say("sources.add"))));
      return;
    }
    if (!shown.length) {
      const allArchived = filters.archived === "active" && state.sources.every((source) => source.archived);
      fill(list, h("p", { class: "studio-help", text: allArchived ? say("sources.allArchived") : say("sources.noMatch") }));
      return;
    }
    const rows = shown.map((source) => {
      const line = [sourceKindWords(source.kind).name, languageName(source.language), source.issued].filter(Boolean).join(" · ");
      const button = h("button", { type: "button", class: "studio-research-row-button", "data-source": source.id, "aria-current": open?.key === source.id ? "true" : null,
        onClick: () => openSource(source) },
      stranger("strong", sourceLabel(source)), h("span", { class: "studio-meta", text: line }),
      source.archived ? h("status-badge", { variant: "neutral" }, say("sources.archivedBadge")) : null);
      return h("li", {}, button);
    });
    const ul = h("ul", { class: "studio-research-rows-list" }, rows);
    ul.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = [...ul.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))].focus();
    });
    fill(list, ul);
  }

  function paintDetails() {
    fill(details, forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }),
      say("research.detailsCounts", { active: state.sources.filter((s) => !s.archived).length, archived: state.sources.filter((s) => s.archived).length })));
  }

  /** Open a source (null: a new one) beside the list, or a kept draft of it. */
  function openSource(record, { restore = null } = {}) {
    if (open && open.form.dirty()) keepForm(keptKey("sources", open.key), { screen: "sources", id: open.key, name: open.form.name(), hash: researchHash("sources", open.key === "new" ? "" : open.key) + (open.key === "new" ? "?new=1" : ""), state: open.form.snapshot() });
    const key = record?.id || "new";
    const kept = restore || takeForm(keptKey("sources", key));
    const form = createSourceForm({
      api, state: () => state, record, kind: "work", restore: kept?.state || null,
      onSaved: (reply, { added, was, id }) => saved(reply, { added, was, id }),
      onClose: () => close(),
      onArchived: (id, archived) => archive(id, archived),
    });
    open = { form, key };
    fill(entry, h("action-button", { variant: "link", class: "studio-back studio-research-entry-back", onClick: () => close() }, say("sources.backToList")), form.element);
    entry.hidden = false;
    element.classList.add("studio-research-open");
    context.replaceRoute?.(record ? researchHash("sources", record.id) : `${researchHash("sources")}?new=1`);
    frame.crumbs([{ label: say("sources.title"), href: researchHash("sources") }, { label: record ? sourceLabel(record) : say("sources.newHeading"), href: "" }]);
    frame.paintKept(keptKey("sources", key));
    paintList();
    requestAnimationFrame(() => form.focus());
  }

  function close() {
    if (open) dropForm(keptKey("sources", open.key));
    const was = open?.key;
    open = null;
    fill(entry);
    entry.hidden = true;
    element.classList.remove("studio-research-open");
    context.replaceRoute?.(researchHash("sources"));
    frame.crumbs([{ label: say("sources.title"), href: "" }]);
    frame.paintKept();
    paintList();
    requestAnimationFrame(() => (list.querySelector(`[data-source="${CSS.escape(was || "")}"]`) || heading).focus());
  }

  async function saved(reply, { added, was, id }) {
    apply(reply);
    dropForm(keptKey("sources", open?.key || "new"));
    await refresh();
    const record = state.sources.find((source) => source.id === id);
    if (added) {
      close();
      said.tell(`${say("sources.added")} ${say("sources.addedHelp")}`);
      requestAnimationFrame(() => list.querySelector(`[data-source="${CSS.escape(id)}"]`)?.focus());
    } else {
      openSource(record || null);
      open?.form.tell(say("sources.saved"), { undo: () => undoSave(was), undoLabel: say("research.undo"), focus: false });
    }
    buildWords(reply);
  }

  function buildWords(reply) {
    if (reply?.build && reply.build.ok === false) said.tell(say("sources.rebuildFailed"), { variant: "problem" });
  }

  async function undoSave(was) {
    try {
      const reply = await api.put("sources", { revision: state.revision, source: was });
      apply(reply);
      openSource(state.sources.find((source) => source.id === was.id) || null);
      open?.form.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      open?.form.tell(error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "sources")), { variant: "problem" });
    }
  }

  async function archive(id, archived, { undoing = false } = {}) {
    try {
      const reply = await api.post("sources/archive", { revision: state.revision, id, archived });
      apply(reply);
      const record = state.sources.find((source) => source.id === id);
      openSource(record || null);
      const words = undoing ? say("research.undone") : archived ? say("sources.archived") : say("sources.restored");
      open?.form.tell(words, undoing ? {} : { undo: () => archive(id, !archived, { undoing: true }), undoLabel: say("research.undo") });
      buildWords(reply);
    } catch (error) {
      if (error?.status === 401) throw error;
      open?.form.tell(researchWords(researchProblem(error, "sources")), { variant: "problem" });
    }
  }

  async function refresh() {
    try {
      apply(await api.get("sources"));
    } catch (error) {
      if (error?.status === 401) throw error;
    }
  }

  async function load() {
    frame.paintKept(open ? keptKey("sources", open.key) : "");
    frame.paintBack();
    fill(banner);
    try {
      apply(await api.get("sources"));
    } catch (error) {
      if (error?.status === 401) throw error;
      list.removeAttribute("aria-busy");
      const problem = researchProblem(error, "sources");
      fill(list);
      fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: problem.alert ? "alert" : null },
        h("p", { text: researchWords(problem) }), problem.signal ? h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("research.tryAgain")) : forHelper(problem.details, say("research.detailsRepair"))));
      return;
    }
    paintList();
    paintDetails();
    // A form she couldn't send with no signal comes back filled in (decision 7).
    const waiting = unsent("sources");
    if (waiting && !open) {
      openSource(waiting.key === "new" ? null : state.sources.find((source) => source.id === waiting.key) || null, { restore: { state: waiting.state } });
    } else if (wanted) {
      const record = state.sources.find((source) => source.id === wanted);
      if (record) openSource(record);
    } else if (route.query?.new) openSource(null);
    if (route.query?.import) sheets.openImport(more);
    if (route.query?.export) sheets.openExport(more);
  }

  return {
    title: say("sources.title"),
    element: h("div", {}, element, sheets.element),
    load,
    reload: load,
    focus: () => heading.focus(),
    isDirty: () => Boolean(open?.form.dirty()),
    leave: async () => {
      if (!(await sheets.leave())) return false;
      return leaveResearch({
        dirty: () => Boolean(open?.form.dirty()),
        current: open ? keptKey("sources", open.key) : "",
        keep: () => keepForm(keptKey("sources", open.key), { screen: "sources", id: open.key, name: open.form.name(), hash: open.key === "new" ? `${researchHash("sources")}?new=1` : researchHash("sources", open.key), state: open.form.snapshot() }),
      });
    },
    palette: [
      { id: "source-add", label: say("sources.add"), group: "This screen" },
      { id: "source-import", label: say("sources.importOpen"), group: "This screen" },
      { id: "source-export", label: say("sources.exportOpen"), group: "This screen" },
    ],
    keys: ["save"],
    command: (id) => {
      if (id === "source-add") openSource(null);
      if (id === "source-import") sheets.openImport(more);
      if (id === "source-export") sheets.openExport(more);
      if (id === "save") open?.form.save();
    },
  };
}

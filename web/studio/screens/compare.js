// Compare (Studio R12, #/research/compare[/<id>]): "How do versions of this passage line up?" One
// alignment open at a time, its versions side by side on a wide screen (one after another below
// 70rem, same order), every place's words exactly as kept. Copy or download places asks once when
// a version's rights aren't cleared. Changing or taking out an alignment gives Undo (decision 8).
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { createDidLine } from "../parts/did-line.js";
import { ask } from "../parts/dialogs.js";
import { atlasAttributionText, firmWords } from "../parts/atlas-rules.js";
import { alignmentNotice, applyAlignmentState, comparisonBuildText, comparisonColumns, comparisonExportText, correspondenceWords, publicPlaceText, rightsToConfirm, textDirection } from "../parts/compare-rules.js";
import { rightsText } from "../parts/source-rules.js";
import { keptKey, researchHash, researchProblem, researchWords } from "../parts/research-rules.js";
import { dropForm, keepForm, takeForm } from "../parts/research-kept.js";
import { forHelper, guardUnload, leaveResearch, researchFrame, saveFile, stranger } from "../parts/research-ui.js";
import { checkbox } from "../parts/atlas-dates.js";
import { createAlignmentForm } from "../parts/alignment-form.js";

const browser = () => {
  const agent = String(globalThis.navigator?.userAgent || "");
  return /Firefox\//.test(agent) ? "Firefox" : /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : say("compare.browser");
};

export async function createCompare(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "empty-state", "select-field", "skeleton-block", "status-badge", "text-field");
  guardUnload();
  const frame = researchFrame({ screen: "compare", go: (hash) => context.go(hash) });
  const state = applyAlignmentState({}, {});
  const wanted = decodeURIComponent(String(route.arg || "").replace(/^compare\/?/, ""));
  let version = "";
  let shown = "";
  let open = null;
  let layout = "side";
  let normalized = false;
  let notes = false;
  let selected = new Set();
  const said = createDidLine();
  const heading = h("h2", { id: "studio-compare-h", class: "studio-question", tabindex: "-1", text: say("compare.title") });
  const add = h("action-button", { class: "studio-primary", onClick: () => openForm(null) }, say("compare.add"));
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const versionFilter = h("select-field", { label: say("compare.versionFilter"), value: "", options: [], onValuechange: (e) => { version = String(e.detail || ""); paintList(); } });
  const list = h("div", { class: "studio-research-list", "aria-busy": "true" }, h("skeleton-block", { lines: 3 }));
  const pane = h("div", { class: "studio-research-entry studio-compare-pane", hidden: true });
  const details = h("div");
  const element = h("section", { class: "studio-page studio-research-compare", "aria-labelledby": "studio-compare-h" },
    frame.element, heading, h("div", { class: "studio-row" }, add), banner, said.element,
    h("div", { class: "studio-research-columns" }, h("div", { class: "studio-research-side" }, versionFilter, list), pane), details);

  const byId = (id) => state.alignments.find((item) => item.id === id) || null;
  const nameOf = (alignment) => String(alignment?.label || alignment?.id || "");
  const memberKey = (m) => (typeof m?.interpretation === "string" ? `i:${m.interpretation}` : `s:${m?.source}`);

  function paintList() {
    list.removeAttribute("aria-busy");
    const versions = [...new Map(state.alignments.flatMap((a) => a.members || []).filter((m) => typeof m.source === "string").map((m) => [m.source, m.source])).keys()];
    versionFilter.options = [{ value: "", label: say("compare.allVersions") }, ...versions.map((id) => ({ value: id, label: comparisonColumns({ members: [{ source: id }] }, state)[0]?.title || id }))];
    versionFilter.value = version;
    versionFilter.hidden = !state.alignments.length;
    if (!state.alignments.length) {
      fill(list, h("empty-state", { heading: say("compare.emptyTitle") }, say("compare.emptyText"), h("action-button", { slot: "actions", onClick: () => openForm(null) }, say("compare.add"))));
      return;
    }
    const items = state.alignments.filter((a) => !version || (a.members || []).some((m) => m.source === version));
    fill(list, h("ul", { class: "studio-research-rows-list" }, items.map((a) => h("li", {},
      h("a", { class: "studio-research-row-button", href: researchHash("compare", a.id), "aria-current": shown === a.id ? "true" : null },
        h("strong", { class: "studio-stranger", dir: "auto", text: nameOf(a) }),
        h("span", { class: "studio-help", text: say("compare.versionsCount", { count: new Set((a.members || []).map(memberKey)).size }) }),
        h("status-badge", { variant: a.visibility === "approved" ? "success" : "neutral" }, a.visibility === "approved" ? say("atlas.readersCan") : say("research.private")))))));
  }

  function publicationLine(alignment) {
    if (alignment.visibility !== "approved") return h("p", { class: "studio-help", "data-compare-publication": "private", text: say("compare.private") });
    if (!state.publication.publish) return h("p", { class: "studio-help", "data-compare-publication": "approved", text: say("compare.approvedNotPublished") });
    const address = `${state.publication.url || "/comparisons/"}${alignment.id}/`;
    return h("p", { class: "studio-help", "data-compare-publication": "published" }, say("compare.published", { address }), " ",
      h("a", { class: "studio-more-link", href: address, target: "_blank", rel: "noopener", text: say("research.open") }), " ", say("compare.rightsYours"));
  }

  function columnsView(alignment, columns) {
    const statuses = state.publication.places?.[alignment.id];
    return h("div", { class: `studio-compare-columns${layout === "side" ? " studio-compare-side" : ""}` }, columns.map((column, c) => h("section", { class: "studio-compare-column", "aria-labelledby": `studio-compare-col-${c}` },
      h("h3", { id: `studio-compare-col-${c}`, class: "studio-stranger", dir: "auto", text: column.title }),
      h("p", { class: "studio-help", text: column.kindText }),
      column.maker ? h("p", { class: "studio-help", text: column.maker }) : null,
      h("p", { class: "studio-help", text: say("compare.rights", { label: rightsText(column.rights) }) }),
      column.facts.length ? h("ul", { class: "studio-help" }, column.facts.map((fact) => h("li", {}, `${fact.label}: `, ...fact.parts.map((part) => (typeof part === "string" ? part : h("bdi", { text: part.text })))))) : null,
      h("ol", { class: "studio-compare-places" }, column.places.map((place) => {
        const box = checkbox(say("compare.selectPlace", { n: place.index + 1 }), selected.has(place.index), (on) => { if (on) selected.add(place.index); else selected.delete(place.index); paintSelected(); });
        const status = Array.isArray(statuses) ? statuses[place.index] : "";
        return h("li", { value: String(place.index + 1), "data-place": String(place.index) },
          h("p", { class: "studio-help", text: place.locator }),
          place.absent ? h("p", { text: say("compare.absent") })
            : place.missingPassage ? h("p", { text: say("compare.missingPassage") })
              : place.original ? h("blockquote", { class: "studio-stranger studio-compare-words", lang: place.original.language || null, dir: textDirection(place.original.language), text: place.original.text })
                : h("p", { class: "studio-help", text: say("compare.locatedOnly") }),
          place.normalized ? (normalized ? h("div", {}, h("p", { class: "studio-help", text: say("compare.normalized") }), stranger("p", place.normalized.text, { lang: place.normalized.language }),
            place.normalized.note ? h("p", { class: "studio-help", text: say("compare.placeNote", { note: place.normalized.note }) }) : null)
            : h("p", { class: "studio-help", text: say("compare.normalizedHidden") })) : null,
          place.note ? h("p", { class: "studio-help", text: say("compare.placeNote", { note: place.note }) }) : null,
          place.notices.length ? place.notices.map(() => h("p", { class: "studio-help", text: say("compare.checkPlace") })) : null,
          status ? h("p", { class: "studio-help", "data-compare-public": status, text: publicPlaceText(status, state.publication.maxExcerptChars) }) : null,
          box.element);
      })))));
  }

  const selectedLine = h("p", { class: "studio-meta", role: "status", "aria-live": "polite" });
  const paintSelected = () => { selectedLine.textContent = say("compare.selected", { count: selected.size }); };

  async function copyOrSave(alignment, columns, how) {
    if (!selected.size) { said.tell(say("compare.selectFirst"), { variant: "problem" }); return; }
    if (rightsToConfirm(columns, selected).length) {
      const choice = await ask({ heading: say("compare.rightsTitle"), text: say("compare.rightsText"), focus: 1,
        choices: [{ label: say("compare.copyThem"), value: "go", variant: "secondary" }, { label: say("compare.notNow"), value: "stay" }] });
      if (choice !== "go") return;
    }
    const text = comparisonExportText(alignment, columns, selected, { normalized, notes, correspondence: correspondenceWords(alignment.correspondence), notice: alignmentNotice() });
    if (how === "download") { saveFile(`alignment-${alignment.id}.txt`, text, "text/plain;charset=utf-8"); said.tell(say("compare.downloaded", { id: alignment.id })); return; }
    try {
      await navigator.clipboard.writeText(text);
      said.tell(say("compare.copied", { count: selected.size }));
    } catch {
      said.tell(say("compare.copyYourself", { app: browser() }));
      exportBox.replaceChildren(h("text-field", { label: say("compare.theText"), rows: 8, value: text, readonly: true }));
    }
  }
  const exportBox = h("div");

  function showAlignment(id) {
    const alignment = byId(id);
    if (!alignment) { said.tell(say("compare.gone")); return; }
    shown = id;
    selected = new Set();
    paintList();
    const columns = comparisonColumns(alignment, state);
    const reading = h("div");
    const paintReading = () => fill(reading, columnsView(alignment, columns));
    const side = h("fieldset", { class: "studio-field-group studio-compare-layout" }, h("legend", { text: say("compare.layout") }),
      ...[["side", say("compare.sideBySide")], ["stack", say("compare.oneAfter")]].map(([value, label]) => {
        const inputId = `studio-compare-layout-${value}`;
        return h("div", { class: "studio-choice" }, h("input", { type: "radio", name: "studio-compare-layout", id: inputId, class: "studio-radio", value, checked: layout === value, onChange: () => { layout = value; paintReading(); } }), h("label", { for: inputId, text: label }));
      }));
    const norm = checkbox(say("compare.showNormalized"), normalized, (on) => { normalized = on; paintReading(); });
    const withNotes = checkbox(say("compare.includeNotes"), notes, (on) => { notes = on; }, say("compare.notesHelp"));
    const more = h("dropdown-menu", { label: say("research.more"), items: [{ value: "remove", label: say("compare.takeOut") }], onItemselect: (e) => { if (e.detail === "remove") remove(alignment); } });
    paintReading();
    paintSelected();
    exportBox.replaceChildren();
    fill(pane,
      h("action-button", { variant: "link", class: "studio-back studio-research-entry-back", href: researchHash("compare") }, say("compare.backToList")),
      h("div", { class: "studio-research-entry-head" }, h("h3", { tabindex: "-1", class: "studio-stranger", dir: "auto", text: nameOf(alignment) }),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => openForm(alignment) }, say("compare.edit")), more),
      h("p", { text: correspondenceWords(alignment.correspondence) }),
      h("p", { class: "studio-help", text: [say("compare.versionsCount", { count: columns.length }), firmWords(alignment.confidence), say("compare.recordedByWho", { who: atlasAttributionText(alignment.recordedBy, state.sources) })].join(" · ") }),
      alignment.rationale ? h("p", {}, `${say("compare.why")} `, h("bdi", { text: alignment.rationale })) : null,
      alignment.uncertainty ? h("p", {}, `${say("compare.uncertain")} `, h("bdi", { text: alignment.uncertainty })) : null,
      publicationLine(alignment), side, norm.element, reading,
      h("section", { class: "studio-section", "aria-labelledby": "studio-compare-copy-h" }, h("h4", { id: "studio-compare-copy-h", text: say("compare.copyTitle") }), selectedLine, withNotes.element,
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", size: "sm", onClick: () => { columns.forEach((col) => col.places.forEach((p) => selected.add(p.index))); paintReading(); paintSelected(); } }, say("compare.selectAll")),
          h("action-button", { variant: "secondary", size: "sm", onClick: () => copyOrSave(alignment, columns, "copy") }, say("compare.copy")),
          h("action-button", { variant: "secondary", size: "sm", onClick: () => copyOrSave(alignment, columns, "download") }, say("compare.download"))), exportBox),
      h("p", { class: "studio-help", text: alignmentNotice() }),
      forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }), `id: ${alignment.id}`, state.notice || ""));
    pane.hidden = false;
    element.classList.add("studio-research-open");
    frame.crumbs([{ label: say("compare.title"), href: researchHash("compare") }, { label: nameOf(alignment), href: "" }]);
    requestAnimationFrame(() => pane.querySelector("h3")?.focus());
  }

  function keepOpen() {
    if (open?.form.dirty()) keepForm(keptKey("compare", open.key), { screen: "compare", id: open.key, what: "alignment", name: open.form.name(), hash: open.hash, state: open.form.snapshot() });
  }

  function openForm(record) {
    keepOpen();
    const key = record?.id || "new";
    const kept = takeForm(keptKey("compare", key));
    const form = createAlignmentForm({ api, state: () => state, record, restore: kept?.state || null, onSaved: (reply, info) => saved(reply, info) });
    open = { form, key, hash: record ? researchHash("compare", record.id) : researchHash("compare") };
    const title = record ? say("compare.editTitle", { name: nameOf(record) }) : say("compare.add");
    fill(pane, h("h3", { tabindex: "-1", text: title }), form.element,
      h("div", { class: "studio-row studio-research-buttons" }, h("action-button", { class: "studio-primary", onClick: () => form.save() }, record ? say("atlas.save") : say("atlas.addIt")),
        h("action-button", { variant: "secondary", onClick: () => { dropForm(keptKey("compare", key)); open = null; if (record) showAlignment(record.id); else { pane.hidden = true; heading.focus(); } } }, say("notebook.neverMind"))));
    pane.hidden = false;
    element.classList.add("studio-research-open");
    frame.paintKept(keptKey("compare", key));
    requestAnimationFrame(() => form.focus());
  }

  const buildWords = (reply) => { const id = comparisonBuildText(reply?.build); return id === "compare.rebuilt" ? say("compare.rebuilt") : id === "compare.rebuildFailed" ? say("compare.rebuildFailed") : ""; };

  function saved(reply, { added, was, id }) {
    applyAlignmentState(state, reply);
    if (open) dropForm(keptKey("compare", open.key));
    open = null;
    frame.paintKept();
    context.replaceRoute?.(researchHash("compare", id));
    showAlignment(id);
    said.tell([added ? say("compare.added") : say("compare.saved"), buildWords(reply)].filter(Boolean).join(" "), added ? {} : { undo: () => undo(was), undoLabel: say("research.undo") });
  }

  async function undo(was) {
    try {
      applyAlignmentState(state, await api.put("research/alignments", { revision: state.revision, alignment: was }));
      showAlignment(was.id);
      said.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "compare")), { variant: "problem" });
    }
  }

  async function remove(alignment) {
    try {
      const reply = await api.call("DELETE", "research/alignments", { json: { revision: state.revision, id: alignment.id } });
      applyAlignmentState(state, reply);
      shown = "";
      pane.hidden = true;
      element.classList.remove("studio-research-open");
      paintList();
      context.replaceRoute?.(researchHash("compare"));
      said.tell([say("compare.removed"), buildWords(reply)].filter(Boolean).join(" "), { undo: () => putBack(alignment), undoLabel: say("research.undo"), focus: true });
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(researchWords(researchProblem(error, "compare")), { variant: "problem" });
    }
  }

  async function putBack(alignment) {
    try {
      applyAlignmentState(state, await api.post("research/alignments", { revision: state.revision, alignment }));
      paintList();
      said.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(error?.data?.diagnostics?.some((d) => d.code === "duplicate-id") ? say("research.undoTaken") : researchWords(researchProblem(error, "compare")), { variant: "problem" });
    }
  }

  async function load() {
    frame.paintKept(open ? keptKey("compare", open.key) : "");
    frame.paintBack();
    frame.crumbs([{ label: say("compare.title"), href: "" }]);
    fill(banner);
    try {
      applyAlignmentState(state, await api.get("research/alignments"));
    } catch (error) {
      if (error?.status === 401) throw error;
      list.removeAttribute("aria-busy");
      fill(list);
      const problem = researchProblem(error, "compare");
      fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: problem.alert ? "alert" : null }, h("p", { text: researchWords(problem) }), forHelper(problem.details)));
      return;
    }
    paintList();
    fill(details, forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") })));
    if (wanted && byId(wanted)) showAlignment(wanted);
    else if (route.query?.new === "1") openForm(null);
  }

  return {
    title: say("compare.title"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    isDirty: () => Boolean(open?.form.dirty()),
    leave: () => leaveResearch({ dirty: () => Boolean(open?.form.dirty()), current: open ? keptKey("compare", open.key) : "", keep: () => keepOpen() }),
    palette: [{ id: "compare-add", label: say("compare.add"), group: "This screen" }],
    keys: ["save"],
    command: (id) => { if (id === "compare-add") openForm(null); if (id === "save") open?.form.save(); },
  };
}

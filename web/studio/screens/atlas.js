// Atlas (Studio R12, #/research/atlas[/<id>|/relationships/<id>|/chronology]): "Who said what about
// whom, and when?" Entries (people, works, concepts, movements, events), the links someone asserted
// between them, and their datings. Add an entry is the one primary action. Changing or taking out
// an entry or a link gives Undo (decision 8); everything stays private until she lets readers see
// it, and the atlas is published only when her blog publishes it.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { createDidLine } from "../parts/did-line.js";
import { ATLAS_ENTRY_KINDS, suggestAtlasId, atlasAttributionText, atlasBuildText, atlasDateText, atlasFilterEntries, atlasLinkLine, entryKindWords, firmWords, aspectNoun } from "../parts/atlas-rules.js";
import { atlasLinkHash, keptKey, researchHash, researchProblem, researchWords } from "../parts/research-rules.js";
import { dropForm, keepForm, takeForm } from "../parts/research-kept.js";
import { forHelper, guardUnload, leaveResearch, researchFrame, stranger } from "../parts/research-ui.js";
import { createAtlasForm } from "../parts/atlas-form.js";
import { createChronology } from "../parts/chronology.js";

export async function createAtlas(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "empty-state", "segmented-control", "select-field", "skeleton-block", "status-badge", "text-field");
  guardUnload();
  const frame = researchFrame({ screen: "atlas", go: (hash) => context.go(hash) });
  const state = { revision: "", entries: [], relationships: [], kinds: null, sources: [], passages: [], notices: [], missingConcepts: [], chronology: {}, file: "", publishes: context.meta?.research?.atlasPublishes === true };
  const filters = { query: "", kind: "" };
  const arg = String(route.arg || "").replace(/^atlas\/?/, "");
  let open = null; // { form, key, type } while a form is open
  let shown = ""; // the entry whose page is open
  const said = createDidLine();
  const heading = h("h2", { id: "studio-atlas-h", class: "studio-question", tabindex: "-1", text: say("atlas.title") });
  const addEntry = h("action-button", { class: "studio-primary", onClick: () => openForm("entry", null) }, say("atlas.add"));
  const chronologyLink = h("action-button", { variant: "secondary", href: `${researchHash("atlas")}/chronology` }, say("atlas.chronology"));
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const find = h("text-field", { label: say("atlas.find"), type: "search", onValuechange: (e) => { filters.query = String(e.detail ?? ""); paintList(); } });
  const kind = h("select-field", { label: say("atlas.kind"), value: "", options: [{ value: "", label: say("atlas.anyKind") }, ...ATLAS_ENTRY_KINDS.map((k) => ({ value: k.kind, label: entryKindWords(k.kind) }))],
    onValuechange: (e) => { filters.kind = String(e.detail || ""); paintList(); } });
  const missing = h("div", { class: "studio-atlas-missing" });
  const count = h("p", { class: "studio-meta", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "studio-research-list", "aria-busy": "true" }, h("skeleton-block", { lines: 4 }));
  const side = h("div", { class: "studio-research-side" }, find, kind, missing, count, list);
  const pane = h("div", { class: "studio-research-entry", hidden: true });
  const chronology = createChronology();
  const columns = h("div", { class: "studio-research-columns" }, side, pane);
  const details = h("div");
  const element = h("section", { class: "studio-page studio-research-atlas", "aria-labelledby": "studio-atlas-h" },
    frame.element, h("div", { class: "studio-research-top" }, heading, chronologyLink), h("div", { class: "studio-row" }, addEntry), banner, said.element, columns, details);

  function apply(reply) {
    for (const key of ["revision", "entries", "relationships", "kinds", "sources", "passages", "notices", "missingConcepts", "chronology", "file"]) if (reply?.[key] !== undefined) state[key] = reply[key];
  }
  const entryOf = (id) => state.entries.find((entry) => entry.id === id) || null;
  const linkOf = (id) => state.relationships.find((link) => link.id === id) || null;
  const badge = (item) => h("status-badge", { variant: item?.visibility === "approved" ? "success" : "neutral" }, item?.visibility === "approved" ? say("atlas.readersCan") : say("research.private"));

  function paintList() {
    list.removeAttribute("aria-busy");
    fill(missing, state.missingConcepts?.length ? [h("p", { class: "studio-help", text: say("atlas.missingConcepts") }),
      h("div", { class: "studio-row" }, state.missingConcepts.map((concept) => h("action-button", { variant: "secondary", size: "sm",
        onClick: () => openForm("entry", null, { prefill: { kind: "concept", label: String(concept), id: String(concept) } }) }, String(concept))))] : []);
    if (!state.entries.length) {
      count.textContent = "";
      fill(list, h("empty-state", { heading: say("atlas.emptyTitle") }, say("atlas.emptyText"), h("action-button", { slot: "actions", onClick: () => openForm("entry", null) }, say("atlas.add"))));
      return;
    }
    const items = atlasFilterEntries(state.entries, filters);
    count.textContent = say("atlas.count", { shown: items.length, total: state.entries.length });
    const ul = h("ul", { class: "studio-research-rows-list" }, items.map((entry) => h("li", {},
      h("a", { class: "studio-research-row-button", href: researchHash("atlas", entry.id), "data-entry": entry.id, "aria-current": shown === entry.id ? "true" : null },
        h("strong", { class: "studio-stranger", dir: "auto", text: String(entry.label) }), h("span", { class: "studio-help", text: entryKindWords(entry.kind) }), badge(entry)))));
    ul.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const links = [...ul.querySelectorAll("a")];
      const at = links.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      links[Math.max(0, Math.min(links.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))].focus();
    });
    fill(list, items.length ? ul : h("p", { class: "studio-help", text: say("atlas.noneMatch") }));
  }

  function showPane(...children) {
    fill(pane, h("action-button", { variant: "link", class: "studio-back studio-research-entry-back", href: researchHash("atlas") }, say("atlas.backToList")), ...children);
    pane.hidden = false;
    element.classList.add("studio-research-open");
  }
  function hidePane() {
    fill(pane);
    pane.hidden = true;
    element.classList.remove("studio-research-open");
  }

  async function showEntry(id) {
    const entry = entryOf(id);
    if (!entry) { hidePane(); said.tell(say("atlas.gone")); return; }
    shown = id;
    paintList();
    context.replaceRoute?.(researchHash("atlas", id));
    frame.crumbs([{ label: say("atlas.title"), href: researchHash("atlas") }, { label: String(entry.label), href: "" }]);
    const links = h("div", { "aria-busy": "true" }, h("skeleton-block", { lines: 2 }));
    const approve = h("input", { type: "checkbox", id: "studio-atlas-approve", class: "studio-radio", checked: entry.visibility === "approved", "aria-describedby": "studio-atlas-approve-help",
      onChange: (e) => setShown(entry, e.target.checked) });
    const dates = (entry.dates || []).map((dating) => h("li", {}, h("span", { text: [aspectNoun(dating.aspect), atlasDateText(dating.date, state.entries)].join(" ") }), " — ",
      h("span", { text: [atlasAttributionText(dating.assertedBy, state.sources), firmWords(dating.confidence)].join(", ") })));
    const more = h("dropdown-menu", { label: say("research.more"), items: [{ value: "remove", label: say("atlas.takeOut") }], onItemselect: (e) => { if (e.detail === "remove") remove("entry", entry); } });
    showPane(
      h("div", { class: "studio-research-entry-head" }, h("h3", { tabindex: "-1", class: "studio-stranger", dir: "auto", text: String(entry.label) }), badge(entry)),
      h("p", { class: "studio-help", text: [entryKindWords(entry.kind), ...(entry.aliases?.length ? [say("atlas.alsoCalled", { names: entry.aliases.join(", ") })] : [])].join(" · ") }),
      entry.summary ? stranger("p", entry.summary) : null,
      h("div", { class: "studio-choice" }, approve, h("label", { for: "studio-atlas-approve", text: say("atlas.readersSee") }),
        h("p", { id: "studio-atlas-approve-help", class: "studio-help", text: `${say("atlas.approveHelp")}${state.publishes ? "" : ` ${say("atlas.notPublished")}`}` })),
      links,
      h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", size: "sm", onClick: () => openForm("link", null, { prefill: { from: entry.id } }) }, say("atlas.addFrom", { name: String(entry.label) })),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => openForm("link", null, { prefill: { to: entry.id } }) }, say("atlas.addTo", { name: String(entry.label) }))),
      h("section", { class: "studio-section" }, h("h4", { text: say("atlas.whenCount", { count: (entry.dates || []).length }) }),
        dates.length ? h("ul", { class: "studio-research-also" }, dates) : h("p", { class: "studio-help", text: say("atlas.noDatingsHere") })),
      h("div", { class: "studio-row studio-research-buttons" }, h("action-button", { class: "studio-primary", onClick: () => openForm("entry", entry) }, say("atlas.edit")), more),
      forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }), `id: ${entry.id}`));
    try {
      const reply = await api.post("research/atlas/explore", { id });
      if (shown !== id) return;
      const line = (incident) => {
        const link = incident.relationship || {};
        const otherId = incident.other?.id;
        return h("li", { "data-link": String(link.id || "") }, h("span", { text: atlasLinkLine(link, { entries: state.entries, kinds: state.kinds, sources: state.sources }) }),
          incident.standing === "contested" ? h("span", { class: "studio-help", text: ` ${say("atlas.isContested")}` }) : null,
          h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", size: "sm", href: atlasLinkHash(link.id) }, say("atlas.editLink")),
            otherId ? h("action-button", { variant: "ghost", size: "sm", href: researchHash("atlas", otherId) }, say("atlas.explore", { name: String(incident.other?.label || otherId) })) : null));
      };
      const outgoing = Array.isArray(reply.outgoing) ? reply.outgoing : [];
      const incoming = Array.isArray(reply.incoming) ? reply.incoming : [];
      links.removeAttribute("aria-busy");
      fill(links,
        h("section", { class: "studio-section" }, h("h4", { text: say("atlas.linksFrom", { name: String(entry.label), count: outgoing.length }) }), outgoing.length ? h("ul", { class: "studio-research-also" }, outgoing.map(line)) : null),
        h("section", { class: "studio-section" }, h("h4", { text: say("atlas.linksTo", { name: String(entry.label), count: incoming.length }) }), incoming.length ? h("ul", { class: "studio-research-also" }, incoming.map(line)) : null),
        h("p", { class: "studio-help", text: say("atlas.exploreNote") }),
        Array.isArray(reply.notes) && entry.kind === "concept" ? h("p", {}, h("a", { href: `${researchHash("notebook")}?concept=${encodeURIComponent(entry.id)}`, text: say("atlas.notesHere", { count: reply.notes.length }) })) : null);
    } catch (error) {
      if (error?.status === 401) throw error;
      links.removeAttribute("aria-busy");
      fill(links, h("p", { class: "studio-help", text: researchWords(researchProblem(error, "atlas")) }));
    }
    requestAnimationFrame(() => pane.querySelector("h3")?.focus());
  }

  function keepOpen() {
    if (!open || !open.form.dirty()) return;
    keepForm(keptKey("atlas", open.key), { screen: "atlas", id: open.key, what: open.type === "entry" ? "entry" : "link", name: open.form.name(), hash: open.hash, state: open.form.snapshot() });
  }

  function openForm(type, record, { prefill = {}, restore = null } = {}) {
    keepOpen();
    const key = record?.id ? `${type}-${record.id}` : `new-${type}`;
    const kept = restore || takeForm(keptKey("atlas", key));
    const form = createAtlasForm({ api, state: () => state, type, record, prefill, restore: kept?.state || null, onSaved: (reply, info) => saved(reply, info) });
    const hash = record ? (type === "entry" ? researchHash("atlas", record.id) : atlasLinkHash(record.id)) : researchHash("atlas");
    open = { form, key, type, hash };
    const isNew = !record;
    const title = isNew ? (type === "entry" ? say("atlas.add") : say("atlas.addLink")) : type === "entry" ? say("atlas.editEntry") : say("atlas.editLinkTitle");
    if (record) context.replaceRoute?.(hash);
    const more = !isNew && type === "link" ? h("dropdown-menu", { label: say("research.more"), items: [{ value: "remove", label: say("atlas.takeOutLink") }], onItemselect: (e) => { if (e.detail === "remove") remove("link", record); } }) : null;
    showPane(
      h("div", { class: "studio-research-entry-head" }, h("h3", { tabindex: "-1", text: title }), record ? badge(record) : h("status-badge", { variant: "neutral" }, say("research.private"))),
      type === "link" ? h("p", { class: "studio-help", text: say("atlas.linkLede") }) : null,
      form.element,
      h("div", { class: "studio-row studio-research-buttons" }, h("action-button", { class: "studio-primary", onClick: () => form.save() }, isNew ? say("atlas.addIt") : say("atlas.save")),
        h("action-button", { variant: "secondary", onClick: () => closeForm(record) }, say("notebook.neverMind")), more),
      record ? forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }), `id: ${record.id}`) : null);
    frame.crumbs([{ label: say("atlas.title"), href: researchHash("atlas") }, { label: title, href: "" }]);
    frame.paintKept(keptKey("atlas", key));
    requestAnimationFrame(() => form.focus());
  }

  function closeForm(record) {
    if (open) dropForm(keptKey("atlas", open.key));
    open = null;
    frame.paintKept();
    if (record && entryOf(record.id)) showEntry(record.id);
    else if (record && linkOf(record.id)) showEntry(linkOf(record.id).from);
    else { hidePane(); frame.crumbs([{ label: say("atlas.title"), href: "" }]); requestAnimationFrame(() => heading.focus()); }
  }

  const buildWords = (reply) => { const id = atlasBuildText(reply?.build); return id === "atlas.rebuilt" ? say("atlas.rebuilt") : id === "atlas.rebuildFailed" ? say("atlas.rebuildFailed") : ""; };
  const withBuild = (words, reply) => [words, buildWords(reply)].filter(Boolean).join(" ");

  function saved(reply, { added, was, id, type }) {
    apply(reply);
    if (open) dropForm(keptKey("atlas", open.key));
    open = null;
    frame.paintKept();
    paintList();
    const entryId = type === "entry" ? id : linkOf(id)?.from || "";
    // The address is the page she sees: a link is shown from its entry's side.
    context.replaceRoute?.(entryId ? researchHash("atlas", entryId) : researchHash("atlas"));
    if (entryId) showEntry(entryId); else hidePane();
    said.tell(withBuild(added ? say("atlas.added") : say("atlas.saved"), reply), added ? {} : { undo: () => undoSave(type, was), undoLabel: say("research.undo") });
  }

  async function undoSave(type, was) {
    try {
      const reply = await api.put(type === "entry" ? "research/atlas/entries" : "research/atlas/relationships", { revision: state.revision, [type === "entry" ? "entry" : "relationship"]: was });
      apply(reply);
      paintList();
      if (type === "entry") showEntry(was.id);
      said.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "atlas")), { variant: "problem" });
    }
  }

  async function setShown(entry, on) {
    const record = { ...entry, visibility: on ? "approved" : "private" };
    try {
      const reply = await api.put("research/atlas/entries", { revision: state.revision, entry: record });
      apply(reply);
      paintList();
      showEntry(entry.id);
      said.tell(withBuild(on ? say("atlas.nowShown") : say("atlas.nowPrivate"), reply), { undo: () => undoSave("entry", entry), undoLabel: say("research.undo") });
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = researchProblem(error, "atlas");
      said.tell(researchWords(problem), { variant: "problem" });
      showEntry(entry.id);
    }
  }

  async function remove(type, record) {
    try {
      const reply = await api.call("DELETE", type === "entry" ? "research/atlas/entries" : "research/atlas/relationships", { json: { revision: state.revision, id: record.id } });
      apply(reply);
      open = null;
      hidePane();
      paintList();
      context.replaceRoute?.(researchHash("atlas"));
      const notes = Array.isArray(reply.unresolvedNotes) ? reply.unresolvedNotes : [];
      const words = [say("atlas.removed"), notes.length ? say("atlas.removedNotes", { count: notes.length, list: notes.join(", ") }) : "", buildWords(reply)].filter(Boolean).join(" ");
      said.tell(words, { undo: () => putBack(type, record), undoLabel: say("research.undo"), focus: true });
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(researchWords(researchProblem(error, type === "entry" ? "atlas" : "link")), { variant: "problem" });
    }
  }

  async function putBack(type, record) {
    try {
      const reply = await api.post(type === "entry" ? "research/atlas/entries" : "research/atlas/relationships", { revision: state.revision, [type === "entry" ? "entry" : "relationship"]: record });
      apply(reply);
      paintList();
      said.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(error?.data?.diagnostics?.some((d) => d.code === "duplicate-id") ? say("research.undoTaken") : error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "atlas")), { variant: "problem" });
    }
  }

  async function load() {
    frame.paintKept(open ? keptKey("atlas", open.key) : "");
    frame.paintBack();
    fill(banner);
    try {
      apply(await api.get("research/atlas"));
    } catch (error) {
      if (error?.status === 401) throw error;
      list.removeAttribute("aria-busy");
      fill(list);
      const problem = researchProblem(error, "atlas");
      fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: problem.alert ? "alert" : null }, h("p", { text: researchWords(problem) }),
        problem.signal ? h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("research.tryAgain")) : forHelper(problem.details)));
      return;
    }
    paintList();
    fill(details, forHelper(say("research.detailsFile", { file: String(state.file || ""), revision: String(state.revision || "—") }),
      ...(state.notices || []).map((notice) => `${notice.code || ""} ${notice.id || ""}: ${notice.message || ""}`)));
    if (arg === "chronology") {
      columns.hidden = true;
      addEntry.hidden = true;
      chronologyLink.hidden = true;
      element.append(chronology.element);
      frame.crumbs([{ label: say("atlas.title"), href: researchHash("atlas") }, { label: say("atlas.chronology"), href: "" }]);
      chronology.paint(state);
      return;
    }
    frame.crumbs([{ label: say("atlas.title"), href: "" }]);
    const link = arg.match(/^relationships\/(.+)$/);
    if (link) {
      const record = linkOf(decodeURIComponent(link[1]));
      if (record) openForm("link", record); else said.tell(say("atlas.gone"));
    } else if (arg) showEntry(decodeURIComponent(arg));
    else if (route.query?.new === "1") {
      const label = String(route.query.label || "");
      openForm("entry", null, { prefill: { kind: route.query.kind || "concept", label, id: label ? suggestAtlasId(label, state.entries.map((e) => e.id)) : "" } });
    }
  }

  return {
    title: say("atlas.title"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    isDirty: () => Boolean(open?.form.dirty()),
    leave: () => leaveResearch({ dirty: () => Boolean(open?.form.dirty()), current: open ? keptKey("atlas", open.key) : "", keep: () => keepOpen() }),
    palette: [{ id: "atlas-add", label: say("atlas.add"), group: "This screen" }, { id: "atlas-chronology", label: say("atlas.chronology"), group: "This screen" }],
    keys: ["save"],
    command: (id) => {
      if (id === "atlas-add") openForm("entry", null);
      if (id === "atlas-chronology") context.go(`${researchHash("atlas")}/chronology`);
      if (id === "save") open?.form.save();
    },
  };
}

// One source, new or kept (Studio R11, Sources): the fields its type has, in her words; people and
// identifiers as rows; the key filled from the title until she types one. Saving says what
// happened with Undo (the record as it was, written back on the new revision); a library changed
// elsewhere keeps her changes and offers the newer copy or hers on top of it. Rights statements
// are shown, never edited here (decision 9). Every value is text.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { createDidLine } from "./did-line.js";
import { ask } from "./dialogs.js";
import {
  IDENTIFIER_SCHEMES, SOURCE_CREATOR_ROLES, SOURCE_KINDS, SOURCE_LOCATION_SCHEMES, rightsText, roleWords, schemeWords, sourceDependents, sourceDraft,
  sourceDraftPayload, sourceFieldsForKind, sourceKindWords, sourceLabel, sourceRelationOptions, sourceTargetVolumes, suggestKey, validateSourceDraft,
} from "./source-rules.js";
import { placeKindWords } from "./notebook-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { dropUnsent, forHelper, identifierAddress, keepUnsent, languageName, languageTagFor, openLink, rowsEditor, stranger, unsentBanner } from "./research-ui.js";
import { schemeWords as idName } from "./source-rules.js";

/**
 * `state()` gives `{ revision, sources, uses, file }`; `onSaved(reply, { added })` takes the new
 * library; `onClose()` closes the form. `restore` is a kept draft to open with.
 */
export function createSourceForm({ api, state, record = null, kind = "work", restore = null, onSaved, onClose, onArchived }) {
  let draft = restore?.draft || sourceDraft(record, kind);
  const baseline = JSON.stringify(sourceDraft(record, kind));
  let keyTyped = Boolean(record) || Boolean(restore?.keyTyped);
  let languageShown = restore?.languageShown ?? languageName(draft.language);
  const isNew = !draft.original;
  const said = createDidLine();
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const fields = h("div", { class: "studio-form-fields" });
  const under = h("div", { class: "studio-research-under" });
  const controls = {};
  const wrap = h("div", { class: "studio-research-form" });

  const changed = () => { banner.querySelector("[data-saved]")?.remove(); };
  const dirty = () => JSON.stringify(draft) !== baseline;

  function text(name, label, { help = "", value = "", onChange, readOnly = false } = {}) {
    const field = h("text-field", { label, value, description: help, readonly: readOnly || null, onValuechange: (e) => { onChange(String(e.detail ?? "")); changed(); } });
    controls[name] = field;
    return field;
  }
  function select(name, label, options, value, onChange, help = "") {
    const field = h("select-field", { label, options, value, description: help, onValuechange: (e) => { onChange(String(e.detail ?? "")); changed(); } });
    controls[name] = field;
    return field;
  }

  function draw() {
    const shape = sourceFieldsForKind(draft.kind);
    const { sources } = state();
    const kindWords = sourceKindWords(draft.kind);
    const parts = [];
    if (isNew) {
      const type = h("choice-cards", { label: say("sources.type"), value: draft.kind,
        items: SOURCE_KINDS.map((id) => ({ id, title: sourceKindWords(id).name, detail: sourceKindWords(id).help })),
        onValuechange: (e) => { if (e.detail) { draft.kind = e.detail; draw(); } } });
      controls["kind-field"] = type;
      parts.push(type);
    } else {
      parts.push(h("p", { class: "studio-meta", text: `${kindWords.name} · ${say("sources.key")} ${draft.id}` }), h("p", { class: "studio-help", text: say("sources.typeFixed") }));
    }
    parts.push(text("title", shape.titleRequired ? say("sources.titleField") : say("sources.optional", { label: say("sources.titleField") }), {
      value: draft.title, onChange: (value) => {
        draft.title = value;
        if (isNew && !keyTyped) {
          draft.id = suggestKey(value, sources.map((s) => s.id));
          if (controls.id) controls.id.value = draft.id;
        }
      } }));
    if (shape.of) {
      const options = sourceRelationOptions(sources, draft.kind, "of", draft.id).map((s) => ({ value: s.id, label: sourceLabel(s) }));
      parts.push(select("of", draft.kind === "reference" ? say("sources.ofReference") : say("sources.of"), [{ value: "", label: say("sources.choose") }, ...options], draft.of, (value) => { draft.of = value; if (draft.kind === "reference") draw(); }));
    }
    if (shape.basedOn) {
      const options = sourceRelationOptions(sources, draft.kind, "basedOn", draft.id).map((s) => ({ value: s.id, label: sourceLabel(s) }));
      parts.push(select("basedOn", say("sources.basedOn"), [{ value: "", label: say("sources.none") }, ...options], draft.basedOn, (value) => { draft.basedOn = value; }, say("sources.basedOnHelp")));
    }
    parts.push(text("language", shape.languageRequired ? say("sources.language") : say("sources.optional", { label: say("sources.language") }), {
      help: say("sources.languageHelp"), value: languageShown,
      onChange: (value) => { languageShown = value; draft.language = value === languageName(sourceDraft(record).language) && record ? sourceDraft(record).language : languageTagFor(value); } }));
    parts.push(text("issued", say("sources.issued"), { help: say("sources.issuedHelp"), value: draft.issued, onChange: (value) => { draft.issued = value; } }));
    if (shape.location) {
      const volumes = sourceTargetVolumes(sources, draft.of);
      const schemes = [{ value: "", label: say("place.choose") }, ...SOURCE_LOCATION_SCHEMES.map((value) => ({ value, label: placeKindWords(value) }))];
      if (draft.locationScheme && !SOURCE_LOCATION_SCHEMES.includes(draft.locationScheme)) schemes.push({ value: draft.locationScheme, label: placeKindWords(draft.locationScheme) });
      parts.push(h("fieldset", { class: "studio-field-group" }, h("legend", { text: say("sources.where") }),
        select("locationScheme", say("place.kind"), schemes, draft.locationScheme, (value) => { draft.locationScheme = value; }),
        text("locationValue", say("sources.place"), { help: say("sources.placeHelp"), value: draft.locationValue, onChange: (value) => { draft.locationValue = value; } }),
        volumes > 0 || draft.locationVolume ? text("locationVolume", say("sources.volume"), { help: say("sources.volumeHelp"), value: draft.locationVolume, onChange: (value) => { draft.locationVolume = value; } }) : null));
    }
    const people = rowsEditor({
      legend: say("sources.people"), help: say("sources.peopleHelp"), rows: draft.creators, addLabel: say("sources.addPerson"),
      takeOutLabel: (n) => say("sources.personTakeOut", { n }), blank: () => ({ name: "", role: "author" }),
      onChange: () => { draft.creators = people.rows(); changed(); },
      make: (row, n, set) => {
        const roles = [...SOURCE_CREATOR_ROLES, ""];
        if (row.role && !roles.includes(row.role)) roles.push(row.role);
        return [
          h("text-field", { label: say("sources.personName", { n }), value: row.name, onValuechange: (e) => set({ name: String(e.detail ?? "") }) }),
          h("select-field", { label: say("sources.personRole", { n }), value: row.role, options: roles.map((role) => ({ value: role, label: roleWords(role) })), onValuechange: (e) => set({ role: String(e.detail ?? "") }) }),
        ];
      },
    });
    controls.creators = people;
    parts.push(people.element);
    const ids = rowsEditor({
      legend: say("sources.ids"), help: say("sources.idsHelp"), rows: draft.identifiers, addLabel: say("sources.addId"),
      takeOutLabel: (n) => say("sources.idTakeOut", { n }), blank: () => ({ scheme: "doi", value: "" }),
      onChange: () => { draft.identifiers = ids.rows(); changed(); },
      make: (row, n, set) => {
        const schemes = [...IDENTIFIER_SCHEMES];
        if (row.scheme && !schemes.includes(row.scheme)) schemes.push(row.scheme);
        return [
          h("select-field", { label: say("sources.idKind", { n }), value: row.scheme, options: schemes.map((scheme) => ({ value: scheme, label: schemeWords(scheme) })), onValuechange: (e) => set({ scheme: String(e.detail ?? "") }) }),
          h("text-field", { label: say("sources.idValue", { n }), value: row.value, class: "studio-mono-field", onValuechange: (e) => set({ value: String(e.detail ?? "") }) }),
        ];
      },
    });
    controls.identifiers = ids;
    parts.push(ids.element);
    parts.push(text("id", say("sources.key"), { help: isNew ? say("sources.keyHelp") : say("sources.keyFixed"), value: draft.id, readOnly: !isNew,
      onChange: (value) => { draft.id = value.trim(); keyTyped = true; } }));
    fill(fields, ...parts);
    drawUnder();
  }

  function drawUnder() {
    const { sources, uses } = state();
    const lines = [];
    const dependents = draft.original ? sourceDependents(sources, draft.id) : [];
    if (dependents.length) lines.push(h("p", { class: "studio-help", text: say("sources.dependents", { count: dependents.length }) }));
    const use = uses?.[draft.id];
    if (use?.citedBy?.length) {
      lines.push(h("p", { class: "studio-help", text: say("sources.citedIn", { count: use.citedBy.length }) }),
        h("ul", { class: "studio-research-cited" }, use.citedBy.map((post) => h("li", {}, h("a", { href: `#/write/${encodeURIComponent(String(post.path))}` }, stranger("span", post.title || post.path))))));
    }
    if (use && (use.usedBy?.passages || use.usedBy?.notes)) lines.push(h("p", { class: "studio-help", text: say("sources.usedIn", { passages: use.usedBy.passages || 0, notes: use.usedBy.notes || 0 }) }));
    const openable = (draft.original?.identifiers || []).map((identifier) => ({ identifier, href: identifierAddress(identifier) })).filter((item) => item.href);
    if (openable.length) {
      lines.push(h("ul", { class: "studio-research-cited" }, openable.map(({ identifier, href }) => h("li", {}, h("span", { class: "studio-mono", text: `${idName(identifier.scheme)} ${identifier.value} ` }), openLink(href)))),
        h("p", { class: "studio-help", text: say("research.notChecked") }));
    }
    const rights = draft.original?.rights ? { status: draft.original.rights.status || "unknown", license: draft.original.rights.license, note: draft.original.rights.note } : null;
    if (rights) lines.push(h("p", { class: "studio-help" }, stranger("bdi", say("sources.rights", { label: rightsText(rights) }))), h("p", { class: "studio-help", text: say("sources.rightsHelp") }));
    fill(under, ...lines);
  }

  function clearErrors() {
    for (const control of Object.values(controls)) {
      if (typeof control?.error === "function") control.error("");
      else if (control && "error" in control) control.error = "";
    }
  }
  function showProblem(problem) {
    const words = researchWords(problem);
    const control = controls[problem.field];
    if (control && !problem.banner) {
      if (typeof control.error === "function") control.error(words, problem.row ?? -1);
      else control.error = words;
      requestAnimationFrame(() => {
        if (typeof control.focusRow === "function") control.focusRow(Math.max(0, problem.row ?? 0));
        else (control.querySelector?.("input, textarea, select, button") || control).focus?.();
      });
    } else {
      fill(banner, h("alert-banner", { variant: problem.signal ? "info" : "warning", role: problem.alert ? "alert" : null },
        h("p", { text: words }), problem.details ? forHelper(problem.details) : null));
    }
  }

  /** Save (or add). Resolves true once the server has it. */
  async function save() {
    clearErrors();
    fill(banner);
    const problem = validateSourceDraft(draft, state().sources);
    if (problem) { showProblem({ ...problem, banner: false, vars: problem.vars || {} }); return false; }
    const payload = sourceDraftPayload(draft);
    const was = draft.original;
    said.tell(say("research.saving"));
    try {
      const reply = await api.call(isNew ? "POST" : "PUT", "sources", { json: { revision: state().revision, source: payload } });
      said.clear();
      dropUnsent("sources");
      draft = sourceDraft(reply.source || payload);
      onSaved(reply, { added: isNew, was, id: payload.id, undo: isNew ? null : was });
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      said.clear();
      const found = researchProblem(error, "sources");
      if (found.conflict) { conflict(error); return false; }
      if (found.signal) {
        keepUnsent("sources", { key: draft.original ? draft.id : "new", state: { draft: structuredClone(draft), keyTyped, languageShown } });
        fill(banner, unsentBanner(() => { dropUnsent("sources"); fill(banner); }));
        return false;
      }
      showProblem(found);
      return false;
    }
  }

  function conflict(error) {
    const current = error?.data?.current || null;
    const revision = error?.data?.revision || null;
    const gone = Boolean(draft.original) && !current;
    fill(banner, h("alert-banner", { variant: "warning", role: "alert" },
      h("p", { text: gone ? say("sources.goneElsewhere") : say("sources.conflict") }),
      h("div", { class: "studio-row" },
        gone ? h("action-button", { variant: "secondary", onClick: () => onClose(true) }, say("sources.leaveMine"))
          : h("action-button", { variant: "secondary", onClick: () => { if (revision) state().revision = revision; draft = sourceDraft(current || draft.original, draft.kind); languageShown = languageName(draft.language); fill(banner); draw(); } }, say("sources.useNewer")),
        gone ? null : h("action-button", { variant: "secondary", onClick: () => {
          if (revision) state().revision = revision;
          if (current) draft.original = structuredClone(current);
          fill(banner, h("p", { class: "studio-help", role: "status", text: say("sources.keptMine") }));
        } }, say("sources.keepMine")))));
  }

  async function neverMind() {
    if (!dirty()) { onClose(false); return; }
    const choice = await ask({ heading: say("sources.dropTitle"), text: [], choices: [{ label: say("sources.dropStay"), value: "stay" }, { label: say("sources.dropGo"), value: "go", variant: "secondary" }] });
    if (choice === "go") onClose(true);
  }

  const saveButton = h("action-button", { class: "studio-primary", onClick: () => save() }, isNew ? say("sources.addIt") : say("sources.save"));
  const closeButton = h("action-button", { variant: "secondary", onClick: () => neverMind() }, say("sources.close"));
  const more = isNew ? null : h("dropdown-menu", {
    label: say("research.more"),
    items: [
      draft.original?.archived ? { value: "restore", label: say("sources.restore") } : { value: "archive", label: say("sources.archive") },
      { value: "copy", label: say("sources.copyKey") },
    ],
    onItemselect: (event) => {
      if (event.detail === "copy") copyKey();
      else onArchived?.(draft.id, event.detail === "archive");
    },
  });
  const paintClose = () => { closeButton.textContent = ""; closeButton.append(dirty() ? say("sources.neverMind") : say("sources.close")); };
  wrap.addEventListener("valuechange", () => requestAnimationFrame(paintClose));
  wrap.addEventListener("click", () => requestAnimationFrame(paintClose));

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(draft.id);
      said.tell(say("sources.keyCopied"));
    } catch {
      controls.id?.querySelector("input")?.select();
    }
  }

  const raw = draft.original ? h("pre", { class: "studio-mono studio-research-raw", tabindex: "0", "aria-label": say("sources.detailsRecord"), text: JSON.stringify(draft.original, null, 2) }) : null;
  draw();
  fill(wrap,
    h("h3", { class: "studio-research-form-h", tabindex: "-1", text: isNew ? say("sources.newHeading") : sourceLabel(draft.original) }),
    banner, fields, under,
    h("div", { class: "studio-row studio-research-buttons" }, saveButton, closeButton, more),
    said.element,
    forHelper(say("research.detailsFile", { file: String(state().file || ""), revision: String(state().revision || "—") }), say("sources.detailsRights"), raw));
  wrap.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); save(); }
  });

  return {
    element: wrap,
    dirty,
    save,
    id: () => draft.id,
    name: () => draft.title || draft.id,
    snapshot: () => ({ draft: structuredClone(draft), keyTyped, languageShown }),
    focus: () => (isNew ? controls["kind-field"] : controls.title)?.querySelector?.("input, button")?.focus?.() || wrap.querySelector("h3")?.focus(),
    tell: (words, options) => said.tell(words, options),
  };
}

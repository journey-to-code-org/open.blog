// The atlas forms' shared parts (Studio R12): who says so, the evidence rows, and When (datings),
// with years typed as plain years and BCE or CE, never as negative numbers (decision 13). Each
// control registers under the field name the rules use (`dating-0-at-value`), so a problem from
// the checks or the server lands on its own control.
import { h } from "./dom.js";
import { say } from "./words.js";
import { sourceLabel } from "./source-rules.js";
import { formatLocatorLines, parseLocatorLines, placeRows, rowsToLocators } from "./notebook-rules.js";
import {
  ATLAS_CONFIDENCE, DATE_SLOT_IDS, FORM_SLOTS, MAX_ATLAS_EVIDENCE, SHORT_MONTHS, aspectNoun, atlasAspects, atlasAttributionDraft,
  atlasDatingDraft, atlasDatingReading, atlasEntryName, atlasEvidenceDraft, atlasPointDraft, firmWords, suggestAtlasId,
} from "./atlas-rules.js";
import { choiceGroup, placesEditor, rowsEditor } from "./research-ui.js";

/** A form's controls by field name, so a problem lands on its own control. */
export function fieldRegistry() {
  const controls = new Map();
  return {
    add(name, control) { controls.set(name, control); return control; },
    clear() { for (const control of controls.values()) setError(control, ""); },
    show(name, words, row = -1) {
      const control = controls.get(name) || [...controls.entries()].find(([key]) => name.startsWith(`${key}-`) || key.startsWith(name))?.[1];
      if (!control) return false;
      setError(control, words, row);
      requestAnimationFrame(() => (control.focus ? control.focus() : control.element?.querySelector?.("input, select, textarea")?.focus()));
      return true;
    },
  };
}

function setError(control, words, row = -1) {
  if (typeof control?.error === "function") control.error(words, row);
  else if (control && "error" in control) control.error = words;
}

const checkbox = (label, checked, onChange, help = "") => {
  const id = `studio-atlas-check-${Math.random().toString(36).slice(2, 9)}`;
  const input = h("input", { type: "checkbox", id, class: "studio-radio", checked, "aria-describedby": help ? `${id}-help` : null, onChange: (e) => onChange(e.target.checked) });
  const element = h("div", { class: "studio-choice" }, input, h("label", { for: id, text: label }), help ? h("p", { id: `${id}-help`, class: "studio-help", text: help }) : null);
  return { element, input, get checked() { return input.checked; }, focus: () => input.focus(), error: undefined };
};
export { checkbox };

/** Firmness as a select: Tentative · Plausible · Strong. */
export function firmField(value, onChange, fields, name) {
  return fields.add(name, h("select-field", { label: say("atlas.firm"), description: say("atlas.firmHelp"), value,
    options: ATLAS_CONFIDENCE.map((item) => ({ value: item.value, label: firmWords(item.value) })), onValuechange: (e) => onChange(String(e.detail || "tentative")) }));
}

/** Who says so: you, a source in her library, or a named person or group. Mutates `draft`. */
export function whoSaysSo(draft, { sources = [], fields, name, legend = say("atlas.who") }) {
  const sourceField = fields.add(`${name}-source`, h("select-field", { label: say("atlas.whichSource"), value: draft.source,
    options: [{ value: "", label: say("atlas.chooseSourceOption") }, ...sources.map((source) => ({ value: source.id, label: sourceLabel(source) }))],
    onValuechange: (e) => { draft.source = String(e.detail || ""); } }));
  const nameField = fields.add(`${name}-name`, h("text-field", { label: say("atlas.whoName"), value: draft.name, onValuechange: (e) => { draft.name = String(e.detail ?? ""); } }));
  const show = () => { sourceField.hidden = draft.kind !== "source"; nameField.hidden = draft.kind !== "named"; };
  const group = fields.add(name, choiceGroup({ legend, value: draft.kind,
    choices: [{ value: "author", label: say("atlas.byYou") }, { value: "source", label: say("atlas.bySource") }, { value: "named", label: say("atlas.byNamed") }],
    onChange: (kind) => { draft.kind = kind; show(); } }));
  show();
  return h("div", { class: "studio-atlas-who" }, group.element, sourceField, nameField);
}

/** Evidence rows (a source, a passage from it, and where in it). `list` is mutated in place. */
export function evidenceRows(list, { sources = [], passages = [], fields, prefix = "", onChange = () => {} }) {
  const rows = list.map((item) => ({ ...item, places: placeRows(parseLocatorLines(item.locators)) }));
  const write = (next) => {
    list.splice(0, list.length, ...next.map(({ places, ...item }) => ({ ...item, locators: formatLocatorLines(rowsToLocators(places)) })));
    onChange();
  };
  const editor = fields.add(`${prefix}evidence`, rowsEditor({
    legend: say("atlas.evidence"), help: say("atlas.evidenceHelp"), rows, max: MAX_ATLAS_EVIDENCE,
    addLabel: say("atlas.addEvidence"), takeOutLabel: (n) => say("atlas.takeOutEvidence", { n }),
    blank: () => ({ ...atlasEvidenceDraft({}, null), places: [] }),
    onChange: () => write(editor.rows()),
    make: (row, n, set) => {
      const passageField = h("select-field", { label: say("atlas.evidencePassage", { n }), value: row.passage, options: [] });
      const fillPassages = (source) => {
        passageField.options = [{ value: "", label: say("atlas.noPassage") }, ...passages.filter((p) => p.source === source && !p.archived).map((p) => ({ value: p.id, label: String(p.preview || p.id).slice(0, 80) }))];
        passageField.value = row.passage && passages.some((p) => p.id === row.passage && p.source === source) ? row.passage : "";
      };
      fillPassages(row.source);
      passageField.addEventListener("valuechange", (e) => set({ passage: String(e.detail || "") }));
      const sourceField = fields.add(`${prefix}evidence-${n - 1}-source`, h("select-field", { label: say("atlas.evidenceSource", { n }), value: row.source,
        options: [{ value: "", label: say("atlas.chooseSourceOption") }, ...sources.map((source) => ({ value: source.id, label: sourceLabel(source) }))],
        onValuechange: (e) => { const source = String(e.detail || ""); set({ source, passage: "" }); fillPassages(source); } }));
      fields.add(`${prefix}evidence-${n - 1}-passage`, passageField);
      const places = fields.add(`${prefix}evidence-${n - 1}-locators`, placesEditor({ legend: say("atlas.whereIn", { n }), rows: row.places, addLabel: say("notebook.addPlace"),
        onChange: () => set({ places: places.rows() }) }));
      return [sourceField, passageField, places.element];
    },
  }));
  return editor.element;
}

// ---- When

const PRECISIONS = ["year", "month", "day", "decade", "century"];
const precisionWords = (p) => ({ open: say("atlas.precisionOpen"), year: say("atlas.precisionYear"), month: say("atlas.precisionMonth"), day: say("atlas.precisionDay"), decade: say("atlas.precisionDecade"), century: say("atlas.precisionCentury") }[p] || p);
const formWords = (f) => ({ at: say("atlas.formAt"), range: say("atlas.formRange"), window: say("atlas.formWindow"), unknown: say("atlas.formUnknown"), relative: say("atlas.formRelative") }[f] || f);
const slotWords = (slot) => ({ at: say("atlas.slotAt"), from: say("atlas.slotFrom"), to: say("atlas.slotTo"), notBefore: say("atlas.slotNotBefore"), notAfter: say("atlas.slotNotAfter") }[slot] || slot);

function pointEditor(point, { slot, base, fields, onChange, n }) {
  const open = slot !== "at";
  const what = say("atlas.dateLabel", { n, which: slotWords(slot) });
  const precision = fields.add(`${base}-precision`, h("select-field", { label: say("atlas.precision", { which: what }), value: point.precision,
    options: [...(open ? ["open"] : []), ...PRECISIONS].map((p) => ({ value: p, label: precisionWords(p) })), onValuechange: (e) => { point.precision = String(e.detail); show(); onChange(); } }));
  const year = fields.add(`${base}-value`, h("text-field", { label: say("atlas.year", { which: what }), inputmode: "numeric", value: point.magnitude, description: say("atlas.yearHelp"),
    onValuechange: (e) => { point.magnitude = String(e.detail ?? "").trim(); onChange(); } }));
  const era = h("segmented-control", { label: say("atlas.era", { which: what }), value: point.era, options: [{ value: "bce", label: say("atlas.bce") }, { value: "ce", label: say("atlas.ce") }],
    onValuechange: (e) => { point.era = String(e.detail || "ce"); onChange(); } });
  const month = fields.add(`${base}-month`, h("select-field", { label: say("atlas.month", { which: what }), value: point.month,
    options: [{ value: "", label: say("atlas.chooseMonth") }, ...SHORT_MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))], onValuechange: (e) => { point.month = String(e.detail || ""); onChange(); } }));
  const day = fields.add(`${base}-day`, h("text-field", { label: say("atlas.day", { which: what }), inputmode: "numeric", value: point.day, onValuechange: (e) => { point.day = String(e.detail ?? "").trim(); onChange(); } }));
  const circa = checkbox(say("atlas.about"), point.circa, (on) => { point.circa = on; onChange(); });
  fields.add(`${base}-circa`, circa);
  function show() {
    const off = point.precision === "open";
    year.hidden = off; era.hidden = off; circa.element.hidden = off;
    year.label = point.precision === "decade" ? say("atlas.decade", { which: what }) : point.precision === "century" ? say("atlas.centuryNumber", { which: what }) : say("atlas.year", { which: what });
    month.hidden = !(point.precision === "month" || point.precision === "day");
    day.hidden = point.precision !== "day";
  }
  show();
  return h("fieldset", { class: "studio-field-group studio-atlas-point" }, h("legend", { text: slotWords(slot) }), precision, h("div", { class: "studio-row studio-atlas-year" }, year, era), month, day, circa.element);
}

/**
 * When: the datings of an entry (`owner` its kind) or of a link (`owner` "relationship").
 * `datings` holds atlasDatingDraft objects and is mutated. `{ element }`.
 */
export function datingsEditor(datings, { owner, ownerId = "", kinds, entries = [], sources = [], passages = [], used = [], fields, onChange = () => {} }) {
  const holder = h("div", { class: "studio-atlas-datings" });
  const count = h("p", { class: "studio-help" });
  const reading = new Map();
  const aspects = atlasAspects(kinds, owner);
  const add = h("action-button", { variant: "secondary", size: "sm", onClick: () => {
    const aspect = aspects[0]?.aspect || "";
    const taken = [...used, ...datings.map((d) => d.id)];
    datings.push(atlasDatingDraft(null, { id: suggestAtlasId(`${ownerId || "dating"}-${aspect}`, taken, "dating"), aspect }));
    draw();
    onChange();
    requestAnimationFrame(() => holder.lastElementChild?.querySelector("select, input")?.focus());
  } }, say("atlas.addDating"));
  const refresh = () => {
    for (const [dating, line] of reading) line.textContent = say("atlas.readsAs", { date: atlasDatingReading(dating, entries) });
    onChange();
  };
  function one(dating, index) {
    const n = index + 1;
    const p = `dating-${index}`;
    const aspect = fields.add(`${p}-aspect`, h("select-field", { label: say("atlas.whatItDates"), value: dating.aspect,
      options: aspects.map((spec) => ({ value: spec.aspect, label: aspectNoun(spec.aspect) })), onValuechange: (e) => { dating.aspect = String(e.detail || ""); refresh(); } }));
    const form = fields.add(`${p}-form`, h("select-field", { label: say("atlas.howDated"), value: dating.form,
      options: ["at", "range", "window", "unknown", "relative"].map((f) => ({ value: f, label: formWords(f) })), onValuechange: (e) => { dating.form = String(e.detail || "at"); draw(); refresh(); } }));
    const points = (FORM_SLOTS[dating.form] || []).map((slot) => pointEditor(dating.points[slot] ||= atlasPointDraft(null, "year"), { slot, base: `${p}-${DATE_SLOT_IDS[slot]}`, fields, onChange: refresh, n }));
    let relative = null;
    if (dating.form === "relative") {
      const order = h("select-field", { label: say("atlas.order"), value: dating.relative.order,
        options: ["before", "after", "during"].map((o) => ({ value: o, label: { before: say("atlas.before"), after: say("atlas.after"), during: say("atlas.during") }[o] })), onValuechange: (e) => { dating.relative.order = String(e.detail); refresh(); } });
      fields.add(`${p}-relative-order`, order);
      const otherAspect = fields.add(`${p}-relative-aspect`, h("select-field", { label: say("atlas.otherAspect"), value: dating.relative.aspect, options: [] }));
      const fillAspects = () => {
        const target = entries.find((entry) => entry.id === dating.relative.entry);
        otherAspect.options = [{ value: "", label: say("atlas.chooseAspectOption") }, ...(target ? atlasAspects(kinds, target.kind) : []).map((spec) => ({ value: spec.aspect, label: aspectNoun(spec.aspect) }))];
        otherAspect.value = dating.relative.aspect;
      };
      otherAspect.addEventListener("valuechange", (e) => { dating.relative.aspect = String(e.detail || ""); refresh(); });
      const other = fields.add(`${p}-relative-entry`, h("select-field", { label: say("atlas.otherEntry"), value: dating.relative.entry,
        options: [{ value: "", label: say("atlas.chooseEntryOption") }, ...entries.map((entry) => ({ value: entry.id, label: atlasEntryName(entries, entry.id) }))],
        onValuechange: (e) => { dating.relative.entry = String(e.detail || ""); dating.relative.aspect = ""; fillAspects(); refresh(); } }));
      fillAspects();
      relative = h("div", { class: "studio-atlas-relative" }, order, other, otherAspect);
    }
    const unsourced = checkbox(say("atlas.unsourced"), dating.unsourced, (on) => { dating.unsourced = on; onChange(); });
    fields.add(`${p}-unsourced`, unsourced);
    const note = fields.add(`${p}-note`, h("text-field", { label: say("atlas.datingNote"), value: dating.note, rows: 2, onValuechange: (e) => { dating.note = String(e.detail ?? ""); onChange(); } }));
    const approved = checkbox(say("atlas.readersSee"), dating.approved, (on) => { dating.approved = on; onChange(); }, say("atlas.datingApproveHelp"));
    fields.add(`${p}-approved`, approved);
    const line = h("p", { class: "studio-help studio-atlas-reading", "aria-live": "polite" });
    reading.set(dating, line);
    const takeOut = h("action-button", { variant: "ghost", size: "sm", onClick: () => { datings.splice(index, 1); draw(); onChange(); requestAnimationFrame(() => add.focus?.()); } }, say("atlas.takeOutDating", { n }));
    return h("fieldset", { class: "studio-field-group studio-atlas-dating", "data-dating": String(index) }, h("legend", { text: say("atlas.datingN", { n }) }),
      aspect, form, ...points, relative, line,
      whoSaysSo(dating.assertedBy ||= atlasAttributionDraft(null), { sources, fields, name: `${p}-asserted` }),
      firmField(dating.confidence, (v) => { dating.confidence = v; onChange(); }, fields, `${p}-confidence`),
      evidenceRows(dating.evidence, { sources, passages, fields, prefix: `${p}-`, onChange }),
      unsourced.element, note, approved.element, takeOut);
  }
  function draw() {
    reading.clear();
    holder.replaceChildren(...datings.map(one));
    count.textContent = datings.length ? say("atlas.datingsCount", { count: datings.length }) : say("atlas.noDatingsHere");
    add.hidden = datings.length >= (kinds?.maxDatings || 20) || !aspects.length;
    for (const [dating, l] of reading) l.textContent = say("atlas.readsAs", { date: atlasDatingReading(dating, entries) });
  }
  draw();
  fields.add("dates", { element: holder, error: undefined });
  return h("section", { class: "studio-section studio-atlas-when" }, h("h4", { text: say("atlas.when") }), count, h("p", { class: "studio-help", text: say("atlas.whenHelp") }), holder, add);
}

// Edit alignment (Studio R12): which places in which versions she reads as corresponding, never
// that they mean the same thing. Versions and places are rows; words are kept exactly as typed.
import { h } from "./dom.js";
import { say } from "./words.js";
import { sayId } from "./research-says.js";
import { sourceLabel } from "./source-rules.js";
import { formatLocatorLines, parseLocatorLines, placeRows, rowsToLocators } from "./notebook-rules.js";
import { suggestAtlasId } from "./atlas-rules.js";
import {
  ALIGNMENT_CORRESPONDENCES, MAX_ALIGNMENT_MEMBERS, alignableSources, alignmentDraft, alignmentErrorMessage, alignmentMemberDraft, alignmentPayload,
  correspondenceWords, rebaseAlignmentDraft, validateAlignmentDraft,
} from "./compare-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { checkbox, fieldRegistry, firmField, whoSaysSo } from "./atlas-dates.js";
import { choiceGroup, forHelper, placesEditor, rowsEditor } from "./research-ui.js";

/** `{ element, save(), dirty(), name(), focus(), snapshot() }`. */
export function createAlignmentForm({ api, state, record = null, restore = null, onSaved }) {
  const fields = fieldRegistry();
  const isNew = !record;
  let draft = restore?.draft || alignmentDraft(record);
  const start = JSON.stringify(alignmentPayload(draft));
  let keyTouched = !isNew;
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const body = h("div", { class: "studio-research-form" });
  const element = h("form", { class: "studio-alignment-form", novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } }, banner, body);
  const s = () => state();

  function member(row, n, set) {
    const i = n - 1;
    const versions = alignableSources(s().sources);
    const type = choiceGroup({ legend: say("compare.placeType", { n }), value: row.type, choices: [{ value: "source", label: say("compare.aVersion") }, { value: "interpretation", label: say("compare.anInterpretation") }],
      onChange: (value) => { set({ type: value }); draw(); } });
    const parts = [type.element];
    if (row.type === "interpretation") {
      parts.push(fields.add(`member-${i}-interpretation`, h("select-field", { label: say("compare.whichInterpretation", { n }), value: row.interpretation,
        options: [{ value: "", label: say("compare.chooseOption") }, ...s().interpretations.map((item) => ({ value: item.id, label: [item.kind === "rendering" ? say("compare.rendering") : say("compare.reading"), String(item.id)].join(" ") }))],
        onValuechange: (e) => set({ interpretation: String(e.detail || "") }) })));
    } else {
      const passage = fields.add(`member-${i}-passage`, h("select-field", { label: say("compare.passage", { n }), value: row.passage, options: [] }));
      const fillPassages = (source) => {
        passage.options = [{ value: "", label: say("atlas.noPassage") }, ...s().passages.filter((p) => p.source === source && !p.archived).map((p) => ({ value: p.id, label: String(p.preview || p.excerpt?.text || p.id).slice(0, 80) }))];
        passage.value = s().passages.some((p) => p.id === row.passage && p.source === source) ? row.passage : "";
      };
      fillPassages(row.source);
      passage.addEventListener("valuechange", (e) => set({ passage: String(e.detail || "") }));
      const absent = checkbox(say("compare.absentHere"), row.absent, (on) => { set({ absent: on }); draw(); });
      fields.add(`member-${i}-absent`, absent);
      const places = fields.add(`member-${i}-locators`, placesEditor({ legend: say("compare.where", { n }), rows: placeRows(parseLocatorLines(row.locators)), addLabel: say("notebook.addPlace"),
        onChange: () => set({ locators: formatLocatorLines(rowsToLocators(places.rows())) }) }));
      parts.push(fields.add(`member-${i}-source`, h("select-field", { label: say("compare.version", { n }), value: row.source,
        options: [{ value: "", label: say("compare.chooseOption") }, ...versions.map((source) => ({ value: source.id, label: sourceLabel(source) }))],
        onValuechange: (e) => { const source = String(e.detail || ""); set({ source, passage: "" }); fillPassages(source); } })), absent.element);
      if (!row.absent) parts.push(passage, places.element);
    }
    if (row.type === "interpretation" || (!row.absent && row.passage)) {
      parts.push(fields.add(`member-${i}-normalized`, h("text-field", { label: say("compare.normalizedWording", { n }), rows: 2, value: row.normalized, class: "studio-stranger-field", onValuechange: (e) => set({ normalized: String(e.detail ?? "") }) })),
        fields.add(`member-${i}-normalized-note`, h("text-field", { label: say("compare.normalizedNote", { n }), value: row.normalizedNote, onValuechange: (e) => set({ normalizedNote: String(e.detail ?? "") }) })));
    }
    parts.push(fields.add(`member-${i}-note`, h("text-field", { label: say("compare.placeNoteField", { n }), value: row.note, onValuechange: (e) => set({ note: String(e.detail ?? "") }) })));
    return parts;
  }

  function draw() {
    const name = fields.add("label", h("text-field", { label: say("compare.name"), value: draft.label, class: "studio-stranger-field",
      onValuechange: (e) => { draft.label = String(e.detail ?? ""); if (isNew && !keyTouched) { draft.id = suggestAtlasId(draft.label, s().alignments.map((a) => a.id), "alignment"); key.value = draft.id; } } }));
    const key = fields.add("id", h("text-field", { label: say("atlas.key"), value: draft.id, hidden: !isNew, description: say("atlas.keyHelp"), onValuechange: (e) => { draft.id = String(e.detail ?? "").trim(); keyTouched = true; } }));
    const members = fields.add("members", rowsEditor({ legend: say("compare.places"), rows: draft.members, max: MAX_ALIGNMENT_MEMBERS,
      addLabel: say("compare.addPlace"), takeOutLabel: (n) => say("compare.takeOutPlace", { n }), blank: () => alignmentMemberDraft(),
      onChange: () => { draft.members = members.rows(); }, make: member }));
    const correspondence = fields.add("correspondence", choiceGroup({ legend: say("compare.howCorrespond"), value: draft.correspondence,
      choices: ALIGNMENT_CORRESPONDENCES.map((item) => ({ value: item.value, label: correspondenceWords(item.value) })), onChange: (v) => { draft.correspondence = v; } }));
    const rationale = fields.add("rationale", h("text-field", { label: say("compare.reasoning"), rows: 3, value: draft.rationale, onValuechange: (e) => { draft.rationale = String(e.detail ?? ""); } }));
    const uncertainty = fields.add("uncertainty", h("text-field", { label: say("atlas.uncertainty"), rows: 2, value: draft.uncertainty, onValuechange: (e) => { draft.uncertainty = String(e.detail ?? ""); } }));
    const approved = fields.add("approved", checkbox(say("atlas.readersSee"), draft.approved, (on) => { draft.approved = on; },
      `${say("compare.approveHelp")}${s().publication?.publish ? "" : ` ${say("compare.notPublishedHelp")}`}`));
    body.replaceChildren(h("p", { class: "studio-help", text: say("compare.editLede") }), name, key, members.element, correspondence.element, rationale,
      firmField(draft.confidence, (v) => { draft.confidence = v; }, fields, "confidence"), uncertainty,
      whoSaysSo(draft.recordedBy, { sources: s().sources, fields, name: "recorded", legend: say("compare.recordedBy") }), approved.element);
  }

  async function save() {
    fields.clear();
    const problem = validateAlignmentDraft(draft, { used: s().alignments.map((a) => a.id), creating: isNew, sources: s().sources, passages: s().passages, interpretations: s().interpretations });
    if (problem) {
      const words = sayId(problem.id, problem.vars || {});
      if (!fields.show(problem.field, words)) banner.replaceChildren(h("alert-banner", { variant: "warning" }, h("p", { text: words })));
      return false;
    }
    banner.replaceChildren();
    const payload = alignmentPayload(draft);
    try {
      const reply = await api.call(isNew ? "POST" : "PUT", "research/alignments", { json: { revision: s().revision, alignment: payload } });
      onSaved(reply, { added: isNew, was: record ? structuredClone(record) : null, id: payload.id });
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      const found = researchProblem(error, "compare");
      if (found.conflict) {
        const current = error?.data?.current || null;
        if (typeof error?.data?.revision === "string") s().revision = error.data.revision;
        banner.replaceChildren(h("alert-banner", { variant: "warning", role: "alert" }, h("p", { text: say("research.conflict", { what: say("research.whatAlignments") }) }),
          h("div", { class: "studio-row" },
            current ? h("action-button", { variant: "secondary", size: "sm", onClick: () => { draft = alignmentDraft(current); banner.replaceChildren(); draw(); } }, say("research.useNewer")) : null,
            h("action-button", { variant: "secondary", size: "sm", onClick: () => { if (current) rebaseAlignmentDraft(draft, current); banner.replaceChildren(h("p", { class: "studio-help", text: say("research.keptMine") })); } }, say("research.keepMine")))));
        return false;
      }
      const words = researchWords(found) || sayId(found.id, found.vars || {});
      if (!found.field || !fields.show(found.field, words)) banner.replaceChildren(h("alert-banner", { variant: "warning" }, h("p", { text: words }), forHelper(found.details, alignmentErrorMessage(error))));
      return false;
    }
  }

  draw();
  return {
    element,
    save,
    dirty: () => JSON.stringify(alignmentPayload(draft)) !== start,
    name: () => String(draft.label || draft.id || say("compare.newAlignment")),
    focus: () => body.querySelector("input, select")?.focus?.(),
    snapshot: () => ({ draft }),
  };
}

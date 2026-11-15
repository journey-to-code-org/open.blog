// An atlas entry or a link between entries (Studio R12): the form, its checks and its save. A
// change made elsewhere keeps her changes and offers the newer copy, or hers on the newer one.
// Saving hands the server's answer to the screen (`onSaved`), which says so and offers Undo.
import { h } from "./dom.js";
import { say } from "./words.js";
import { sayId } from "./research-says.js";
import { sourceLabel } from "./source-rules.js";
import {
  ATLAS_ENTRY_KINDS, atlasEndpointChoices, atlasEntryDraft, atlasEntryName, atlasEntryPayload, atlasErrorMessage, atlasKindSpec, atlasRelationshipDraft,
  atlasRelationshipPayload, atlasDissentDraft, entryKindWords, rebaseAtlasEntryDraft, rebaseAtlasRelationshipDraft, suggestAtlasId,
  validateAtlasDatings, validateAtlasEntryDraft, validateAtlasRelationshipDraft,
} from "./atlas-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { checkbox, datingsEditor, evidenceRows, fieldRegistry, firmField, whoSaysSo } from "./atlas-dates.js";
import { forHelper, rowsEditor } from "./research-ui.js";

const say_ = (problem) => sayId(problem.id, problem.vars || {});

/**
 * `type` "entry" or "link"; `record` the stored one, or null for new (`prefill` then: kind, label,
 * from, to). `{ element, save(), dirty(), name(), focus(), snapshot() }`.
 */
export function createAtlasForm({ api, state, type, record = null, prefill = {}, restore = null, onSaved }) {
  const fields = fieldRegistry();
  const isNew = !record;
  const entry = type === "entry";
  let draft = restore?.draft || (entry ? atlasEntryDraft(record, prefill) : atlasRelationshipDraft(record, prefill));
  const start = JSON.stringify(entry ? atlasEntryPayload(draft) : atlasRelationshipPayload(draft));
  let keyTouched = !isNew;
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const body = h("div", { class: "studio-research-form" });
  const element = h("form", { class: "studio-atlas-form", novalidate: true, onSubmit: (e) => { e.preventDefault(); save(); } }, banner, body);
  const s = () => state();
  const usedIds = () => [...s().entries.map((e) => e.id), ...s().relationships.map((r) => r.id), ...[...s().entries, ...s().relationships].flatMap((item) => (item.dates || []).map((d) => d.id))];

  function drawEntry() {
    const kind = fields.add("kind", h("select-field", { label: say("atlas.kind"), value: draft.kind,
      options: ATLAS_ENTRY_KINDS.map((item) => ({ value: item.kind, label: entryKindWords(item.kind) })), onValuechange: (e) => { draft.kind = String(e.detail); draw(); } }));
    const label = fields.add("label", h("text-field", { label: say("atlas.label"), value: draft.label, required: true, class: "studio-stranger-field",
      onValuechange: (e) => { draft.label = String(e.detail ?? ""); if (isNew && !keyTouched) { draft.id = suggestAtlasId(draft.label, usedIds()); key.value = draft.id; } } }));
    const key = fields.add("id", h("text-field", { label: say("atlas.key"), value: draft.id, description: say("atlas.keyHelp"), hidden: !isNew,
      onValuechange: (e) => { draft.id = String(e.detail ?? "").trim(); keyTouched = true; } }));
    const aliases = fields.add("aliases", rowsEditor({ legend: say("atlas.aliases"), rows: String(draft.aliases || "").split("\n").filter((line) => line.trim()).map((name) => ({ name })),
      addLabel: say("atlas.addAlias"), takeOutLabel: (n) => say("atlas.takeOutAlias", { n }), blank: () => ({ name: "" }),
      onChange: () => { draft.aliases = aliases.rows().map((row) => row.name).join("\n"); },
      make: (row, n, set) => [h("text-field", { label: say("atlas.aliasRow", { n }), value: row.name, onValuechange: (e) => set({ name: String(e.detail ?? "") }) })] }));
    const summary = fields.add("summary", h("text-field", { label: say("atlas.summary"), rows: 4, value: draft.summary, description: say("atlas.summaryHelp"), onValuechange: (e) => { draft.summary = String(e.detail ?? ""); } }));
    const works = s().sources.filter((source) => source.kind === "work");
    const work = fields.add("source", h("select-field", { label: say("atlas.work"), value: draft.source, hidden: draft.kind !== "work",
      options: [{ value: "", label: say("atlas.noWork") }, ...works.map((source) => ({ value: source.id, label: sourceLabel(source) }))], onValuechange: (e) => { draft.source = String(e.detail || ""); } }));
    const approved = fields.add("approved", checkbox(say("atlas.readersSee"), draft.approved, (on) => { draft.approved = on; },
      `${say("atlas.approveHelp")}${s().publishes ? "" : ` ${say("atlas.notPublished")}`}`));
    body.replaceChildren(kind, label, key, aliases.element, summary, work, approved.element,
      datingsEditor(draft.datings, { owner: draft.kind, ownerId: draft.id, kinds: s().kinds, entries: s().entries, sources: s().sources, passages: s().passages, used: usedIds(), fields }));
  }

  function drawLink() {
    const kinds = s().kinds?.relationships || [];
    const spec = atlasKindSpec(s().kinds, draft.kind);
    const kind = fields.add("kind", h("select-field", { label: say("atlas.linkKind"), value: draft.kind, description: spec ? say("atlas.linkKindReads", { reading: String(draft.kind).replace(/-/g, " "), inverse: String(spec.inverse || "") }) : "",
      options: [{ value: "", label: say("atlas.chooseLinkKindOption") }, ...kinds.map((k) => ({ value: k.kind, label: String(k.kind).replace(/-/g, " ") }))], onValuechange: (e) => { draft.kind = String(e.detail || ""); draw(); } }));
    const ends = (end) => {
      const other = s().entries.find((item) => item.id === (end === "from" ? draft.to : draft.from)) || null;
      return fields.add(end, h("select-field", { label: end === "from" ? say("atlas.from") : say("atlas.to"), value: draft[end], description: end === "to" ? say("atlas.endsHelp") : "",
        options: [{ value: "", label: say("atlas.chooseEntryOption") }, ...atlasEndpointChoices(s().kinds, draft.kind, end, s().entries, other).map((item) => ({ value: item.id, label: `${item.label} (${entryKindWords(item.kind)})` }))],
        onValuechange: (e) => { draft[end] = String(e.detail || ""); draw(); } }));
    };
    const unsourced = fields.add("unsourced", checkbox(say("atlas.unsourced"), draft.unsourced, (on) => { draft.unsourced = on; }));
    unsourced.element.hidden = draft.evidence.length > 0;
    const uncertainty = fields.add("uncertainty", h("text-field", { label: say("atlas.uncertainty"), rows: 2, value: draft.uncertainty, onValuechange: (e) => { draft.uncertainty = String(e.detail ?? ""); } }));
    const dissents = fields.add("contested", rowsEditor({ legend: say("atlas.dissents"), help: say("atlas.dissentsHelp"), rows: draft.contestedBy, max: 20,
      addLabel: say("atlas.addDissent"), takeOutLabel: (n) => say("atlas.takeOutDissent", { n }), blank: () => atlasDissentDraft({ by: { kind: "named", name: "" } }, null),
      onChange: () => { draft.contestedBy = dissents.rows(); },
      make: (row, n, set) => [
        whoSaysSo(row.by, { sources: s().sources, fields, name: `dissent-${n - 1}`, legend: say("atlas.dissentWho", { n }) }),
        fields.add(`dissent-${n - 1}-note`, h("text-field", { label: say("atlas.dissentNote", { n }), rows: 2, value: row.note, onValuechange: (e) => set({ note: String(e.detail ?? "") }) })),
        evidenceRows(row.evidence, { sources: s().sources, passages: s().passages, fields, prefix: `dissent-${n - 1}-` }),
      ] }));
    const approved = fields.add("approved", checkbox(say("atlas.readersSee"), draft.approved, (on) => { draft.approved = on; }, say("atlas.linkApproveHelp")));
    body.replaceChildren(kind, ends("from"), ends("to"),
      whoSaysSo(draft.assertedBy, { sources: s().sources, fields, name: "asserted" }),
      firmField(draft.confidence, (v) => { draft.confidence = v; }, fields, "confidence"),
      evidenceRows(draft.evidence, { sources: s().sources, passages: s().passages, fields, onChange: () => { unsourced.element.hidden = draft.evidence.length > 0; } }),
      unsourced.element, uncertainty, dissents.element, approved.element,
      datingsEditor(draft.datings, { owner: "relationship", ownerId: draft.id || `${draft.from}-${draft.kind}-${draft.to}`, kinds: s().kinds, entries: s().entries, sources: s().sources, passages: s().passages, used: usedIds(), fields }));
  }

  const draw = () => (entry ? drawEntry() : drawLink());

  function check() {
    fields.clear();
    const context = { sources: s().sources, passages: s().passages, entries: s().entries, kinds: s().kinds };
    const ownDatings = new Set((record?.dates || []).map((d) => d.id));
    const used = usedIds().filter((id) => !ownDatings.has(id) && id !== record?.id);
    const problem = entry ? validateAtlasEntryDraft(draft, { sources: s().sources, used: usedIds(), creating: isNew })
      : validateAtlasRelationshipDraft(draft, context);
    const dates = problem || validateAtlasDatings(draft.datings, { owner: entry ? draft.kind : "relationship", ownerId: draft.id, kinds: s().kinds, entries: s().entries, sources: s().sources, passages: s().passages, used });
    if (!dates) return true;
    if (!fields.show(dates.field, say_(dates))) banner.replaceChildren(h("alert-banner", { variant: "warning" }, h("p", { text: say_(dates) })));
    return false;
  }

  async function save() {
    if (!check()) return false;
    banner.replaceChildren();
    if (!entry && isNew) draft.id = suggestAtlasId(`${draft.from}-${draft.kind}-${draft.to}`, usedIds(), "link");
    const payload = entry ? atlasEntryPayload(draft) : atlasRelationshipPayload(draft);
    const path = entry ? "research/atlas/entries" : "research/atlas/relationships";
    try {
      const reply = await api.call(isNew ? "POST" : "PUT", path, { json: { revision: s().revision, [entry ? "entry" : "relationship"]: payload } });
      onSaved(reply, { added: isNew, was: record ? structuredClone(record) : null, id: payload.id, type });
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = researchProblem(error, entry ? "atlas" : "link");
      if (problem.conflict) { conflict(error); return false; }
      const words = researchWords(problem) || say_(problem);
      if (!problem.field || !fields.show(problem.field, words)) {
        banner.replaceChildren(h("alert-banner", { variant: problem.signal ? "info" : "warning" }, h("p", { text: words }), forHelper(problem.details, atlasErrorMessage(error))));
      }
      return false;
    }
  }

  function conflict(error) {
    const current = error?.data?.current || null;
    if (typeof error?.data?.revision === "string") s().revision = error.data.revision;
    const what = say("research.whatAtlas");
    banner.replaceChildren(h("alert-banner", { variant: "warning", role: "alert" }, h("p", { text: say("research.conflict", { what }) }),
      h("div", { class: "studio-row" },
        current ? h("action-button", { variant: "secondary", size: "sm", onClick: () => { draft = entry ? atlasEntryDraft(current) : atlasRelationshipDraft(current); banner.replaceChildren(); draw(); } }, say("research.useNewer")) : null,
        h("action-button", { variant: "secondary", size: "sm", onClick: () => {
          if (current) { if (entry) rebaseAtlasEntryDraft(draft, current); else rebaseAtlasRelationshipDraft(draft, current); }
          banner.replaceChildren(h("p", { class: "studio-help", text: say("research.keptMine") }));
        } }, say("research.keepMine")))));
  }

  draw();
  return {
    element,
    save,
    dirty: () => JSON.stringify(entry ? atlasEntryPayload(draft) : atlasRelationshipPayload(draft)) !== start,
    name: () => (entry ? String(draft.label || draft.id || say("atlas.newEntry")) : [atlasEntryName(s().entries, draft.from), String(draft.kind || "").replace(/-/g, " "), atlasEntryName(s().entries, draft.to)].join(" ")),
    focus: () => body.querySelector("select, input, textarea")?.focus?.(),
    snapshot: () => ({ draft, type }),
  };
}

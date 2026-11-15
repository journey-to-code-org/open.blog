// Chronology (Studio R12, #/research/atlas/chronology): every dating in her atlas as words.
// Competing datings stand side by side; nothing is preferred, merged or averaged, and the order is
// for reading only. Prompts are prompts, never verdicts.
import { h } from "./dom.js";
import { say } from "./words.js";
import { ATLAS_ASPECTS, aspectNoun, atlasAttributionText, atlasChronologyModel, atlasChronologyStatus, atlasOwnerName, firmWords } from "./atlas-rules.js";
import { researchHash, atlasLinkHash } from "./research-rules.js";
import { checkbox } from "./atlas-dates.js";
import { forHelper } from "./research-ui.js";

/** `{ element, paint(state) }`; filters live in the page only, never in the address. */
export function createChronology() {
  const filters = { query: "", aspect: "", fromYear: "", fromEra: "bce", toYear: "", toEra: "ce", zoom: "century", competing: false, prompted: false };
  let state = null;
  const query = h("text-field", { label: say("atlas.chronologyFind"), type: "search", onValuechange: (e) => { filters.query = String(e.detail ?? ""); paint(); } });
  const aspect = h("select-field", { label: say("atlas.whatItDates"), value: "", options: [{ value: "", label: say("atlas.anyAspect") }, ...ATLAS_ASPECTS.map((a) => ({ value: a, label: aspectNoun(a) }))],
    onValuechange: (e) => { filters.aspect = String(e.detail || ""); paint(); } });
  const year = (which) => {
    const field = h("text-field", { label: which === "from" ? say("atlas.windowFrom") : say("atlas.windowTo"), inputmode: "numeric", onValuechange: (e) => { filters[`${which}Year`] = String(e.detail ?? ""); paint(); } });
    const era = h("segmented-control", { label: which === "from" ? say("atlas.windowFromEra") : say("atlas.windowToEra"), value: filters[`${which}Era`],
      options: [{ value: "bce", label: say("atlas.bce") }, { value: "ce", label: say("atlas.ce") }], onValuechange: (e) => { filters[`${which}Era`] = String(e.detail || "ce"); paint(); } });
    return { field, era, element: h("div", { class: "studio-row studio-atlas-year" }, field, era) };
  };
  const from = year("from");
  const to = year("to");
  const zoom = h("select-field", { label: say("atlas.groupBy"), value: filters.zoom,
    options: [{ value: "century", label: say("atlas.precisionCentury") }, { value: "decade", label: say("atlas.precisionDecade") }, { value: "year", label: say("atlas.precisionYear") }],
    onValuechange: (e) => { filters.zoom = String(e.detail || "century"); paint(); } });
  const competing = checkbox(say("atlas.onlyCompetingBox"), false, (on) => { filters.competing = on; paint(); });
  const prompted = checkbox(say("atlas.onlyPromptedBox"), false, (on) => { filters.prompted = on; paint(); });
  const clear = h("action-button", { variant: "ghost", size: "sm", onClick: () => {
    Object.assign(filters, { query: "", aspect: "", fromYear: "", toYear: "", competing: false, prompted: false });
    query.value = ""; aspect.value = ""; from.field.value = ""; to.field.value = ""; competing.input.checked = false; prompted.input.checked = false;
    paint();
  } }, say("notebook.clear"));
  const status = h("p", { class: "studio-meta", role: "status", "aria-live": "polite" });
  const results = h("div", { class: "studio-atlas-chronology" });
  const element = h("section", { class: "studio-section", "aria-labelledby": "studio-chronology-h" },
    h("h3", { id: "studio-chronology-h", tabindex: "-1", text: say("atlas.chronology") }),
    h("p", { class: "studio-help", text: say("atlas.chronologyLede") }),
    h("fieldset", { class: "studio-field-group studio-research-filters" }, h("legend", { text: say("atlas.chronologyFilters") }),
      query, aspect, from.element, to.element, h("p", { class: "studio-help", text: say("atlas.windowHelp") }), zoom, competing.element, prompted.element, clear),
    status, results);

  const ownerHash = (row) => (row.collection === "relationships" ? atlasLinkHash(row.owner) : researchHash("atlas", row.owner));
  const datingLine = (dating) => {
    const record = dating.record;
    const who = record ? atlasAttributionText(record.assertedBy, state.sources) : "";
    const parts = [String(dating.text || ""), who, record ? firmWords(record.confidence) : ""].filter(Boolean);
    return h("li", { "data-dating": String(dating.id), "data-out-of-window": dating.inWindow === false ? "true" : null },
      h("span", { text: parts.join(" — ") }),
      dating.inWindow === false ? h("span", { class: "studio-help", text: ` ${say("atlas.outsideWindow")}` }) : null,
      dating.prompts ? h("status-badge", { variant: "warning" }, say("atlas.toCheck")) : null);
  };
  const rowView = (row) => h("li", { class: "studio-atlas-chrono-row" },
    h("a", { href: ownerHash(row), text: row.name }), " ", h("span", { class: "studio-help", text: aspectNoun(row.aspect) }),
    h("ul", { "aria-label": say("atlas.datingsOf", { aspect: aspectNoun(row.aspect), name: row.name }) }, row.datings.map(datingLine)));

  function paint(next = state) {
    state = next;
    if (!state) return;
    const model = atlasChronologyModel(state, filters);
    status.textContent = atlasChronologyStatus(model, filters);
    if (!model.total.datings) { results.replaceChildren(h("p", { class: "studio-help", text: say("atlas.noDatings") })); return; }
    const sections = [];
    sections.push(h("section", { class: "studio-section" }, h("h4", { text: say("atlas.timeline") }), h("p", { class: "studio-help", text: say("atlas.timelineNote") }),
      ...model.groups.map((group) => h("div", {}, group.label ? h("h5", { text: group.label }) : null, h("ul", { class: "studio-research-also" }, group.rows.map(rowView))))));
    if (model.unplaced.length) sections.push(h("section", { class: "studio-section" }, h("h4", { text: say("atlas.unplaced", { count: model.unplaced.length }) }), h("ul", { class: "studio-research-also" }, model.unplaced.map(rowView))));
    if (model.relative.length) sections.push(h("section", { class: "studio-section" }, h("h4", { text: say("atlas.relative", { count: model.relative.length }) }),
      h("ul", { class: "studio-research-also" }, model.relative.map(({ row, dating }) => h("li", {}, h("a", { href: ownerHash(row), text: row.name }), " ", h("span", { text: String(dating.text || "") }))))));
    if (model.prompts.length) sections.push(h("section", { class: "studio-section" }, h("h4", { text: say("atlas.toCheckCount", { count: model.prompts.length }) }), h("p", { class: "studio-help", text: say("atlas.checkNote") }),
      h("ul", { class: "studio-research-also" }, model.prompts.map((prompt, i) => {
        const ids = Array.isArray(prompt.datings) ? prompt.datings : [];
        const row = model.rows.find((r) => r.datings.some((d) => ids.includes(d.id)));
        return h("li", {}, row ? h("a", { class: "studio-more-link", href: ownerHash(row), text: say("atlas.checkDating", { n: i + 1, name: atlasOwnerName(state, row.collection, row.owner) }) }) : null,
          forHelper(`${prompt.code || ""}: ${prompt.message || ""}`));
      }))));
    results.replaceChildren(...sections);
  }
  return { element, paint, focus: () => element.querySelector("h3")?.focus() };
}

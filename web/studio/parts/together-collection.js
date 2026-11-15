// Collection (Studio R14b, the reflection's ?sheet=collection): which collection it joins and its
// place there, with the reading order it would have. Whoever runs it chooses; someone in charge can
// make a new collection. Saving asks everyone to agree again and says so; one saved elsewhere first
// keeps her choice in the form beside the stored one. Once it is published, it changes from the post.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say, isolating } from "./words.js";
import { partsNodes } from "./stranger.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { togetherProblem } from "./together-rules.js";
import { NEW_SERIES, NO_SERIES, keepStoredSeries, seriesPartText, seriesPlacementRequest, seriesPlacementText, seriesSlug } from "./arrange-rules.js";

export async function createCollectionSheet({ api, id, onChange }) {
  await use("action-button", "alert-banner", "select-field", "text-field");
  const sheet = await createSheet({ label: say("collection.title"), wide: false });
  const did = createDidLine();
  const body = h("div", { class: "studio-together-shape" });
  let data = null;
  let typed = false;

  async function open(summary, opener) {
    const title = summary.title || summary.guidingQuestion || say("together.untitled");
    typed = false;
    sheet.show({ heading: say("collection.sheetTitle", { title }), opener, dirty: () => typed, save: () => save(),
      question: { heading: say("together.leaveAsk"), text: say("collection.clearsAgreement"), save: say("collection.save"), leave: say("together.leaveGo") },
      children: [h("p", { class: "studio-help", text: say("collection.lede") }), did.element, body], focus: () => body.querySelector("select, input, button")?.focus() });
    await load();
  }

  let which = null;
  let name = null;
  let place = null;

  async function load(keep = false) {
    try {
      data = await api.get(`collaboration/series?publicationId=${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.status === 401) throw error;
      body.replaceChildren(h("p", { class: "studio-help", text: togetherProblem(error).words }));
      return;
    }
    const stored = data.placement;
    const storedSlug = stored ? (data.series || []).find((s) => s.slug === stored.series || s.slug === seriesSlug(stored.series))?.slug || "" : "";
    const chosen = keep && which ? String(which.value) : stored ? storedSlug || NEW_SERIES : NO_SERIES;
    which = h("select-field", { label: say("collection.which"), value: chosen,
      options: [{ value: NO_SERIES, label: say("collection.none") }, ...(data.series || []).map((s) => ({ value: s.slug, label: s.name || s.slug })), ...(data.canCreate ? [{ value: NEW_SERIES, label: say("collection.new") }] : [])],
      onValuechange: () => { typed = true; paint(); } });
    name = h("text-field", { label: say("collection.newName"), value: keep && name ? String(name.value || "") : stored && !storedSlug ? stored.series : "", onValuechange: () => { typed = true; } });
    place = h("text-field", { label: say("collection.place"), description: say("collection.placeHelp"), inputmode: "numeric", value: keep && place ? String(place.value || "") : stored?.order ?? "", onValuechange: () => { typed = true; } });
    const can = data.canPlace;
    const order = h("ol", { class: "studio-together-lines" }, ...(data.preview?.parts || []).map((part, index) => h("li", {}, ...partsNodes(seriesPartText(part, index, isolating)))));
    const make = data.canCreate ? makeForm() : null;
    const see = h("action-button", { variant: "secondary", onClick: async () => {
      const chosen = String(which.value ?? "");
      const series = chosen === NEW_SERIES ? String(name.value || "").trim() : chosen;
      if (!series) { order.replaceChildren(); return; }
      const query = new URLSearchParams({ publicationId: id, series, ...(String(place.value || "").trim() ? { order: String(place.value).trim() } : {}) });
      try {
        const shown = await api.get(`collaboration/series?${query}`);
        order.replaceChildren(...(shown.preview?.parts || []).map((part, index) => h("li", {}, ...partsNodes(seriesPartText(part, index, isolating)))));
      } catch (error) {
        if (error.status === 401) throw error;
        did.tell(togetherProblem(error).words, { variant: "problem" });
      }
    } }, say("collection.preview"));
    body.replaceChildren(h("p", { role: "status", text: seriesPlacementText(stored ? (data.series || []).find((s) => s.slug === storedSlug)?.name || stored.series : "", stored?.order) }),
      which, name, place, can ? h("div", {}, see) : null, order,
      can ? h("div", { class: "studio-sheet-footer" }, h("p", { class: "studio-help", text: say("collection.clearsAgreement") }), h("action-button", { onClick: () => save() }, say("collection.save")))
        : h("p", { class: "studio-help", text: data.published ? say("collection.published") : say("collection.readOnly") }),
      make);
    if (!can) for (const node of [which, name, place]) node.setAttribute("inert", "");
    paint();
  }

  function paint() {
    if (name) name.hidden = which?.value !== NEW_SERIES;
  }

  function makeForm() {
    const title = h("text-field", { label: say("collection.makeName"), maxlength: 120 });
    const premise = h("text-field", { label: say("collection.makePremise"), maxlength: 240 });
    const go = h("action-button", { variant: "secondary", onClick: async () => {
      title.error = "";
      if (!String(title.value || "").trim()) { title.error = say("collection.needName"); title.querySelector("input")?.focus(); return; }
      go.loading = true;
      try {
        await api.post("collaboration/series/create", { publicationId: id, title: String(title.value).trim(), premise: String(premise.value || "").trim() });
        did.tell(say("collection.made"));
        await load(true);
      } catch (error) {
        if (error.status === 401) throw error;
        did.tell(togetherProblem(error).words, { variant: "problem" });
      } finally {
        go.loading = false;
      }
    } }, say("collection.make"));
    return h("details", { class: "studio-help" }, h("summary", { text: say("collection.make") }), title, premise, go);
  }

  async function save(undo = undefined) {
    let placement;
    if (undo !== undefined) placement = undo;
    else {
      const asked = seriesPlacementRequest(String(which.value ?? ""), name.value, place.value);
      if (asked.error) {
        const field = asked.field === "order" ? place : name;
        field.error = asked.error;
        field.querySelector("input")?.focus();
        return false;
      }
      const storedSlug = data.placement ? (data.series || []).find((s) => s.slug === seriesSlug(data.placement.series))?.slug : undefined;
      placement = keepStoredSeries(asked.placement, data.placement, storedSlug);
    }
    const previous = data.placement ?? null;
    try {
      await api.put("collaboration/series", { publicationId: id, expectedRevision: data.revision, placement });
      typed = false;
      did.tell(placement ? say("collection.saved") : say("collection.removed"), undo === undefined ? { undo: () => save(previous), undoLabel: say("part.undo") } : {});
      await load();
      onChange?.();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      const said = togetherProblem(error);
      if (said.code === "changed") { did.tell(say("together.changedElsewhere", { what: say("collection.title") }), { variant: "problem" }); await load(true); }
      else did.tell(said.words, { variant: "problem" });
      return false;
    }
  }

  return { sheet, open };
}

// Your research beside her words (Studio R11, decision 6): search passages, sources and
// interpretations (her notes only when she asks for them), and put in a quotation with its
// citation, a citation alone, or a note as her own words. Someone else's words go in exactly as
// kept; words whose rights aren't cleared ask once; a note goes in only through its own question.
// Each part of her research is read on its own, so one that can't be read never hides the rest.
import { fill, h } from "./dom.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { draftResearchItems, languageTag, rightsAsk, rightsOf, rightsText } from "./draft-research-rules.js";
import { citationLocatorsFromPassage } from "./cite-rules.js";
import { MAX_PASSAGE_LOCATORS, locatorText, placeRows, rowsToLocators } from "./notebook-rules.js";
import { sourceLabel } from "./source-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { forHelper, placesEditor, stranger } from "./research-ui.js";
import { remember } from "./research-cache.js";
import { researchReviewApplies } from "./review-rules.js";

/**
 * `ctx`: `{ api, path(), request(), kind(), quote(passage, markdown), cite(markdown),
 * convert(note), keepPassage(), openChecks(opener), headingId }`. `quote`, `cite` and `convert`
 * return "" once it's in, or the words to say when it couldn't go there.
 */
export function createYourResearch(ctx) {
  let data = null;
  let query = "";
  let filter = "all";
  let detail = null;
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const parts = h("div", { "aria-live": "polite" });
  const results = h("div", { class: "studio-yours-results" });
  const count = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const checks = h("div", { class: "studio-yours-checks" });
  const search = h("text-field", { label: say("yours.search"), type: "search", onValuechange: (e) => { query = String(e.detail ?? ""); paint(); } });
  const show = h("select-field", { label: say("yours.show"), value: filter,
    options: [{ value: "all", label: say("yours.showAll") }, { value: "passages", label: say("yours.showPassages") }, { value: "sources", label: say("yours.showSources") },
      { value: "interpretations", label: say("yours.showInterpretations") }, { value: "notes", label: say("yours.showNotes") }],
    onValuechange: (e) => { filter = String(e.detail || "all"); paint(); } });
  const list = h("div", { class: "studio-yours-list" }, search, show, count, results);
  const view = h("div", { class: "studio-yours-view" }, list);
  const element = h("div", { class: "studio-yours" },
    h("p", { class: "studio-help", text: say("yours.lede") }), parts, view, status, checks,
    h("div", { class: "studio-row" },
      h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("yours.refresh")),
      h("action-button", { variant: "secondary", size: "sm", onClick: () => ctx.keepPassage() }, say("yours.keepNew"))));

  const sources = () => (Array.isArray(data?.library?.sources) ? data.library.sources : []);
  const sourceOf = (id) => sources().find((source) => source.id === id) || null;
  const TYPES = { passage: () => say("yours.typePassage"), source: () => say("yours.typeSource"), interpretation: () => say("yours.typeInterpretation"), note: () => say("yours.typeNote") };
  const typeWords = (type) => TYPES[type]?.() || "";

  function paintParts() {
    const failed = [];
    for (const [key, what] of [["library", say("research.whatLibrary")], ["notebook", say("research.whatNotebook")]]) {
      const part = data?.[key];
      if (part?.error) failed.push(h("alert-banner", { variant: "warning" }, h("p", { text: say("yours.partFailed", { what }) }), forHelper(String(part.file || ""), String(part.error))));
    }
    fill(parts, ...failed);
  }

  function paint() {
    if (detail) return;
    // Atlas entries and aligned passages are R12's, shown once it draws them.
    const items = data ? draftResearchItems(data, query, filter).filter((item) => item.type in TYPES) : [];
    count.textContent = data ? say("yours.count", { count: items.length }) : "";
    if (!data) return;
    if (!items.length) { fill(results, h("p", { class: "studio-help", text: filter === "notes" ? say("yours.noNotes") : say("yours.none") })); return; }
    fill(results, h("ul", { class: "studio-research-rows-list" }, items.slice(0, 50).map((item) => {
      const visibility = say("research.private");
      const button = h("button", { type: "button", class: "studio-research-row-button", "data-yours": `${item.type}:${item.id}`,
        "aria-label": say("yours.rowName", { type: typeWords(item.type), title: item.title, visibility }), onClick: () => open(item) },
      h("span", { class: "studio-yours-type" }, h("status-badge", { variant: "neutral" }, typeWords(item.type)), " ", h("status-badge", { variant: "outline" }, visibility)),
      stranger("strong", item.title), item.preview ? stranger("span", item.preview, { className: "studio-research-preview" }) : null);
      return h("li", {}, button);
    })));
  }

  function back() {
    detail = null;
    fill(view, list);
    paint();
    requestAnimationFrame(() => search.querySelector("input")?.focus());
  }

  function open(item) {
    detail = item;
    const record = item.record;
    const backButton = h("action-button", { variant: "link", class: "studio-back", onClick: () => back() }, say("yours.back"));
    const said = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const tell = (words) => { said.textContent = words; };
    let body = [];
    if (item.type === "passage") {
      const source = sourceOf(record.source);
      const rights = source?.rightsStatus || null;
      const where = locatorText(record.locators);
      body = [
        h("h3", { tabindex: "-1", text: say("yours.passageFrom", { source: source ? sourceLabel(source) : String(record.source) }) }),
        h("blockquote", { class: "studio-yours-quote studio-stranger", dir: "auto", lang: languageTag(record.excerpt?.language) || null, text: String(record.excerpt?.text ?? "") }),
        h("p", { class: "studio-help", text: where || say("yours.noPlace") }),
        h("p", { class: "studio-help" }, stranger("bdi", say("yours.rights", { label: rightsText(rights) }))),
        record.notes ? h("p", { class: "studio-help", text: say("yours.linkedNotes", { count: record.notes }) }) : null,
        h("p", { class: "studio-help", text: say("yours.quoteHelp") }),
        h("div", { class: "studio-row" },
          h("action-button", { class: "studio-primary", onClick: () => quote(record, rights, tell) }, say("yours.quoteIt")),
          h("action-button", { variant: "secondary", onClick: () => citeOnly({ key: record.source, locators: citationLocatorsFromPassage(record) }, tell) }, say("yours.citeOnly"))),
        h("a", { class: "studio-more-link", href: `#/research/notebook/${encodeURIComponent(record.id)}`, text: say("yours.openNotebook") }),
      ];
    } else if (item.type === "source") {
      const where = placesEditor({ legend: say("sources.where"), help: say("cite.whereHelp"), rows: [], max: MAX_PASSAGE_LOCATORS, addLabel: say("notebook.addPlace") });
      body = [
        h("h3", { tabindex: "-1" }, stranger("span", item.title)),
        h("p", { class: "studio-meta", text: item.preview }),
        where.element,
        h("p", { class: "studio-help", text: say("yours.sourceHelp") }),
        h("div", { class: "studio-row" }, h("action-button", { class: "studio-primary", onClick: () => citeOnly({ key: record.id, locators: rowsToLocators(where.rows()) }, tell) }, say("cite.citeIt"))),
        h("a", { class: "studio-more-link", href: `#/research/sources/${encodeURIComponent(record.id)}`, text: say("yours.openSources") }),
      ];
    } else if (item.type === "interpretation") {
      body = [
        h("h3", { tabindex: "-1", text: item.title }),
        h("blockquote", { class: "studio-yours-quote studio-stranger", dir: "auto", lang: languageTag(record.language) || null, text: String(record.text ?? "") }),
        h("p", { class: "studio-help", text: say("yours.interpretationNever") }),
        h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", onClick: () => citeOnly({ key: record.source, locators: placeRows(record.locators).map((row) => ({ kind: row.kind, value: row.value, ...(row.to ? { to: row.to } : {}) })) }, tell) }, say("yours.citeInterpreted"))),
      ];
    } else {
      body = [
        h("h3", { tabindex: "-1", text: item.title }),
        stranger("p", record.text, { className: "studio-yours-note" }),
        h("p", { class: "studio-help", text: say("yours.noteLine") }),
        h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", onClick: () => convert(record, tell) }, say("yours.convert"))),
      ];
    }
    fill(view, backButton, ...body, said);
    requestAnimationFrame(() => view.querySelector("h3")?.focus());
  }

  async function check(citation) {
    const reply = await ctx.api.post("citations/check", { revision: data?.library?.revision || "", citation, post: ctx.path() || undefined });
    if (!reply?.markdown) throw Object.assign(new Error("no citation"), { status: 200, noCitation: true });
    return reply;
  }

  function failed(error, tell) {
    if (error?.status === 401) throw error;
    if (error?.noCitation) { tell(say("yours.noCitation")); return; }
    if (!error?.status) { tell(say("cite.waiting")); return; }
    tell(researchWords(researchProblem(error, "cite")));
  }

  async function quote(passage, rights, tell) {
    if (rightsAsk(rights)) {
      const state = rightsOf(rights)?.status === "rightsReserved" ? say("yours.rightsReserved") : say("yours.rightsUnknown");
      const choice = await ask({ heading: say("yours.rightsTitle", { state }), text: say("yours.rightsText"),
        choices: [{ label: say("yours.rightsGo"), value: "go", variant: "secondary" }, { label: say("yours.rightsStay"), value: "stay", variant: "primary" }], focus: 1 });
      if (choice !== "go") return;
    }
    try {
      const reply = await check({ key: passage.source, locators: citationLocatorsFromPassage(passage) });
      const refused = ctx.quote(passage, reply.markdown);
      if (refused) tell(refused);
    } catch (error) { failed(error, tell); }
  }

  async function citeOnly(citation, tell) {
    try {
      const reply = await check(citation);
      const refused = ctx.cite(reply.markdown);
      if (refused) tell(refused);
    } catch (error) { failed(error, tell); }
  }

  async function convert(note, tell) {
    const choice = await ask({ heading: say("yours.convertTitle"), text: say("yours.convertText"),
      choices: [{ label: say("yours.convertGo"), value: "go", variant: "secondary" }, { label: say("yours.convertStay"), value: "stay", variant: "primary" }], focus: 1 });
    if (choice !== "go") return;
    const refused = ctx.convert(note);
    if (refused) tell(refused);
  }

  async function paintChecks() {
    const request = ctx.request();
    const applies = researchReviewApplies(request.fields, ctx.kind() === "research" ? "research" : "");
    if (!applies) { fill(checks, h("p", { class: "studio-help", text: say("yours.checksNot") })); return; }
    const open = h("action-button", { variant: "link", onClick: (e) => ctx.openChecks(e.currentTarget) }, say("yours.checksOpen"));
    try {
      const review = await ctx.api.post("research/review", request);
      const found = Array.isArray(review?.findings) ? review.findings.length : 0;
      fill(checks, h("p", { class: "studio-help" }, found ? say("yours.checks", { count: found }) : say("yours.checksNone"), " ", open));
    } catch (error) {
      if (error?.status === 401) throw error;
      fill(checks, h("p", { class: "studio-help" }, open));
    }
  }

  async function load(nextFilter = null) {
    if (nextFilter) { filter = nextFilter; show.value = nextFilter; }
    status.textContent = say("yours.loading");
    try {
      data = await ctx.api.get("research/draft");
      remember(data);
      status.textContent = "";
    } catch (error) {
      if (error?.status === 401) throw error;
      status.textContent = researchWords(researchProblem(error, "draft"));
    }
    paintParts();
    if (detail) back(); else paint();
    paintChecks().catch(() => {});
  }

  return { element, load, focus: () => search.querySelector("input")?.focus(), back };
}

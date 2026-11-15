// Claims and evidence (Studio R12, Write ?sheet=claims[&claim=<id>]): her statements in this post
// and how her sources bear on each, in three columns that are never combined. A claim is made from
// words selected in one part of the post and is checked against the saved post (decision 12): a
// draft saves itself first; a published post with changes waits for Update. Private to her unless
// she lets readers see it; nothing here scores evidence or decides what's true.
import { h, fill } from "./dom.js";
import { say } from "./words.js";
import { sayId } from "./research-says.js";
import { sourceLabel } from "./source-rules.js";
import { locatorText, formatLocatorLines, parseLocatorLines, placeRows, rowsToLocators, suggestEntryId } from "./notebook-rules.js";
import { firmWords } from "./atlas-rules.js";
import {
  CLAIM_RELATIONS, CLAIM_REVIEW_STATES, boxSelectionToBody, claimAnchorStatusText, claimDraft, claimFindings, claimFindingsSummary, claimLinkColumns, claimPayload,
  claimSelectionAnchor, claimsErrorMessage, evidenceLinkDraft, evidenceLinkPayload, occurrences, relationWords, reviewStateWords, validateEvidenceLinkDraft,
} from "./claims-rules.js";
import { researchProblem, researchWords } from "./research-rules.js";
import { checkbox, fieldRegistry, firmField } from "./atlas-dates.js";
import { choiceGroup, forHelper, placesEditor } from "./research-ui.js";
import { createDidLine } from "./did-line.js";

const short = (text, n = 80) => { const t = String(text ?? ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** `ctx`: { api, path(), saved() → {etag, dirty, state}, saveDraft(), boxes() }. `{ element, load(claim), focus() }`. */
export function createClaimsSheet(ctx) {
  const { api } = ctx;
  let view = null;
  let focusClaim = "";
  const said = createDidLine();
  const summary = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const make = h("action-button", { class: "studio-primary", onClick: () => startClaim() }, say("claims.make"));
  const formSlot = h("div");
  const cards = h("div", { class: "studio-claims-cards" });
  const element = h("div", { class: "studio-claims" }, h("p", { class: "studio-lede", text: say("claims.lede") }), make, said.element, formSlot, summary, cards);

  const sources = () => view?.sources || [];
  const passages = () => view?.passages || [];
  const mine = () => (view?.claims || []).filter((claim) => view?.post && claim.post === view.post);
  const sourceName = (id) => sourceLabel(sources().find((s) => s.id === id) || { id, kind: "" });

  async function load(claim = "") {
    if (claim) focusClaim = claim;
    try {
      view = await api.get(`research/claims?path=${encodeURIComponent(ctx.path())}`);
    } catch (error) {
      if (error?.status === 401) throw error;
      fill(cards, h("p", { class: "studio-help", text: researchWords(researchProblem(error, "claims")) }));
      return;
    }
    paint();
  }

  function paint() {
    const findings = (view?.findings || []).filter((f) => mine().some((c) => c.id === f.object?.claim));
    summary.textContent = claimFindingsSummary(findings);
    fill(cards, mine().length ? mine().map(card) : h("p", { class: "studio-help", text: say("claims.none") }));
    if (focusClaim) {
      const target = cards.querySelector(`[data-claim="${CSS.escape(focusClaim)}"] h4`);
      focusClaim = "";
      requestAnimationFrame(() => target?.focus());
    }
  }

  function card(claim) {
    const anchor = view.anchors?.[claim.id] || {};
    const statusId = claimAnchorStatusText(anchor);
    const found = anchor.status === "verified" || !claim.anchor;
    const columns = claimLinkColumns(view.links, claim.id);
    const findings = claimFindings(view.findings, claim.id);
    const columnView = (relation, noneId) => h("section", { class: "studio-claims-column", "data-relation": relation },
      h("h5", { text: say("claims.column", { what: relationWords(relation), count: columns[relation].length }) }),
      columns[relation].length ? h("ul", {}, columns[relation].map((link) => h("li", { "data-link": link.id },
        h("span", { text: [sourceName(link.evidence?.source), locatorText(link.evidence?.locators)].filter(Boolean).join(", ") }), " — ",
        h("span", { class: "studio-help", text: [firmWords(link.confidence), reviewStateWords(link.reviewState), link.visibility === "approved" ? say("atlas.readersCan") : say("research.private")].join(" · ") }),
        link.rationale ? h("p", { class: "studio-help" }, h("bdi", { text: link.rationale })) : null,
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", size: "sm", onClick: () => evidenceForm(claim, link) }, say("claims.changeLink")),
          h("action-button", { variant: "ghost", size: "sm", onClick: () => remove("link", link) }, say("claims.takeOutLink")))))) : h("p", { class: "studio-help", text: noneId }));
    return h("article", { class: "studio-section studio-claims-card", "data-claim": claim.id },
      h("h4", { tabindex: "-1" }, h("bdi", { text: claim.statement })),
      claim.anchor?.text ? h("p", { class: "studio-help" }, say("claims.words", { text: short(claim.anchor.text, 160) })) : null,
      h("p", { class: "studio-help", "data-anchor": String(anchor.status || "none"), text: sayId(statusId) }),
      claim.uncertainty ? h("p", { class: "studio-help" }, `${say("claims.doubtful")} `, h("bdi", { text: claim.uncertainty })) : null,
      h("status-badge", { variant: claim.visibility === "approved" ? "success" : "neutral" }, claim.visibility === "approved" ? say("atlas.readersCan") : say("research.private")),
      h("div", { class: "studio-claims-columns" }, columnView("supports", say("claims.noneSupports")), columnView("contradicts", say("claims.noneContradicts")), columnView("contextualizes", say("claims.noneContext"))),
      findings.length ? h("section", { class: "studio-section" }, h("h5", { text: say("claims.gaps", { count: findings.length }) }),
        h("ul", {}, findings.map((f) => h("li", {}, h("bdi", { text: String(f.message) }), " ", `${say("review.next")} `, h("bdi", { text: String(f.repair) }))))) : null,
      h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", size: "sm", disabled: !found, label: say("claims.linkFor", { statement: short(claim.statement) }), onClick: () => evidenceForm(claim, null) }, say("claims.link")),
        anchor.status === "moved" && Number.isInteger(anchor.start) ? h("action-button", { variant: "secondary", size: "sm", onClick: () => follow(claim, anchor) }, say("claims.follow")) : null,
        anchor.status === "stale" || anchor.status === "ambiguous" ? h("action-button", { variant: "secondary", size: "sm", onClick: () => startClaim(claim) }, say("claims.selectAgain")) : null,
        h("action-button", { variant: "secondary", size: "sm", onClick: () => claimForm(claim, null) }, say("claims.change")),
        h("action-button", { variant: "ghost", size: "sm", onClick: () => remove("claim", claim) }, say("claims.takeOut"))),
      found ? null : h("p", { class: "studio-help", text: say("claims.findFirst") }),
      forHelper(`id: ${claim.id}`, `${anchor.status || "none"}`));
  }

  /** The selection as an anchor on the saved post, or her words for why not. */
  async function anchorFromSelection() {
    const boxes = ctx.boxes();
    const box = boxes.find((b) => b.selection?.()) || boxes[0];
    const range = box?.selectionRange?.();
    const words = box?.selection?.() || "";
    if (!box || !range || !words.trim()) return { error: say("claims.selectFirst") };
    if (boxes.length > 1) return { error: say("claims.onePart") };
    const at = boxSelectionToBody({ start: 0, text: box.value }, range.start, range.end);
    if (at.error) return { error: sayId(at.error) };
    if (occurrences(box.value, words) > 1) return { error: say("claims.twice") };
    let saved = ctx.saved();
    if (saved.dirty || !saved.etag) {
      if (saved.state === "published" || saved.state === "scheduled") return { error: say("claims.saveFirst") };
      await ctx.saveDraft();
      saved = ctx.saved();
      if (saved.dirty || !saved.etag) return { error: say("claims.saveFirst") };
    }
    const local = claimSelectionAnchor(box.value, at.start, at.end);
    if (local.error) return { error: sayId(local.error, local.vars || {}) };
    try {
      const reply = await api.post("research/claims/anchor", { path: ctx.path(), etag: saved.etag, ...local.anchor });
      if (reply.status !== "verified") return { error: sayId(claimAnchorStatusText(reply)) };
      if (reply.post && view) view.post = reply.post;
      return { anchor: reply.anchor || local.anchor };
    } catch (error) {
      if (error?.status === 401) throw error;
      return { error: error?.status === 409 || error?.data?.draftChanged ? say("claims.saveFirst") : researchWords(researchProblem(error, "claims")) };
    }
  }

  async function startClaim(existing = null) {
    said.clear();
    const found = await anchorFromSelection();
    if (found.error) { said.tell(found.error, { variant: "problem" }); return; }
    if (existing) { await saveClaim(claimDraft(existing), existing, { anchor: found.anchor, words: say("claims.followed") }); return; }
    claimForm(null, found.anchor);
  }

  function claimForm(record, anchor) {
    const fields = fieldRegistry();
    const used = (view?.claims || []).map((c) => c.id);
    const draft = claimDraft(record, { id: suggestEntryId("claim", used), post: view?.post || "", anchor });
    const banner = h("div");
    const statement = fields.add("statement", h("text-field", { label: say("claims.statement"), rows: 3, required: true, value: draft.statement, onValuechange: (e) => { draft.statement = String(e.detail ?? ""); } }));
    const doubt = fields.add("uncertainty", h("text-field", { label: say("claims.doubtfulField"), rows: 2, value: draft.uncertainty, onValuechange: (e) => { draft.uncertainty = String(e.detail ?? ""); } }));
    const approved = fields.add("approved", checkbox(say("atlas.readersSee"), draft.approved, (on) => { draft.approved = on; }, say("claims.approveHelp")));
    const done = () => fill(formSlot);
    fill(formSlot, h("section", { class: "studio-section studio-claims-form" }, h("h4", { tabindex: "-1", text: record ? say("claims.change") : say("claims.make") }), banner,
      (draft.anchor?.text) ? h("p", { class: "studio-help", text: say("claims.words", { text: short(draft.anchor.text, 160) }) }) : null,
      statement, doubt, approved.element,
      h("div", { class: "studio-row" }, h("action-button", { class: "studio-primary", onClick: () => {
        fields.clear();
        if (!String(draft.statement).trim()) { fields.show("statement", say("research.fill")); return; }
        saveClaim(draft, record, { fields, banner, then: done });
      } }, say("claims.save")), h("action-button", { variant: "secondary", onClick: done }, say("notebook.neverMind")))));
    requestAnimationFrame(() => formSlot.querySelector("h4")?.focus());
  }

  async function saveClaim(draft, record, { anchor = null, fields = null, banner = null, then = () => {}, words = "" } = {}) {
    if (anchor) draft.anchor = anchor;
    try {
      const reply = await api.call(record ? "PUT" : "POST", "research/claims/claims", { json: { revision: view.revision, claim: claimPayload(draft) } });
      view = { ...view, ...reply };
      then();
      paint();
      said.tell(words || say("claims.saved"), record ? { undo: () => put("claim", record), undoLabel: say("research.undo") } : {});
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = researchProblem(error, "claims");
      const text = researchWords(problem) || sayId(problem.id, problem.vars || {});
      if (problem.conflict) await load();
      if (!(fields && problem.field && fields.show(problem.field, text))) (banner ? fill(banner, h("alert-banner", { variant: "warning" }, h("p", { text }), forHelper(problem.details, claimsErrorMessage(error)))) : said.tell(text, { variant: "problem" }));
    }
  }

  const follow = (claim, anchor) => saveClaim(claimDraft(claim), claim, { anchor: { start: anchor.start, end: anchor.start + (claim.anchor.end - claim.anchor.start), text: claim.anchor.text }, words: say("claims.followed") });

  function evidenceForm(claim, record) {
    const fields = fieldRegistry();
    const used = (view?.links || []).map((l) => l.id);
    const draft = evidenceLinkDraft(record, { id: suggestEntryId("link", used), claim: claim.id });
    const banner = h("div");
    const relation = fields.add("relation", choiceGroup({ legend: say("claims.relation"), help: say("claims.relationHelp"), value: draft.relation,
      choices: CLAIM_RELATIONS.map((item) => ({ value: item.value, label: relationWords(item.value) })), onChange: (v) => { draft.relation = v; } }));
    const passage = fields.add("passage", h("select-field", { label: say("claims.passage"), description: say("claims.passageHelp"), value: draft.evidence.passage, options: [] }));
    const fillPassages = () => {
      passage.options = [{ value: "", label: say("atlas.noPassage") }, ...passages().filter((p) => p.source === draft.evidence.source && !p.archived).map((p) => ({ value: p.id, label: short(p.preview || p.id) }))];
      passage.value = draft.evidence.passage;
    };
    passage.addEventListener("valuechange", (e) => { draft.evidence.passage = String(e.detail || ""); });
    const source = fields.add("source", h("select-field", { label: say("claims.source"), value: draft.evidence.source,
      options: [{ value: "", label: say("atlas.chooseSourceOption") }, ...sources().map((s) => ({ value: s.id, label: sourceLabel(s) }))],
      onValuechange: (e) => { draft.evidence.source = String(e.detail || ""); draft.evidence.passage = ""; fillPassages(); } }));
    fillPassages();
    const places = fields.add("locators", placesEditor({ legend: say("claims.where"), rows: placeRows(parseLocatorLines(draft.evidence.locators)), addLabel: say("notebook.addPlace"),
      onChange: () => { draft.evidence.locators = formatLocatorLines(rowsToLocators(places.rows())); } }));
    const rationale = fields.add("rationale", h("text-field", { label: say("claims.why"), rows: 2, value: draft.rationale, onValuechange: (e) => { draft.rationale = String(e.detail ?? ""); } }));
    const uncertainty = fields.add("uncertainty", h("text-field", { label: say("atlas.uncertainty"), rows: 2, value: draft.uncertainty, onValuechange: (e) => { draft.uncertainty = String(e.detail ?? ""); } }));
    const review = fields.add("review", h("select-field", { label: say("claims.checked"), value: draft.reviewState,
      options: CLAIM_REVIEW_STATES.map((item) => ({ value: item.value, label: reviewStateWords(item.value) })), onValuechange: (e) => { draft.reviewState = String(e.detail); } }));
    const approved = fields.add("approved", checkbox(say("atlas.readersSee"), draft.approved, (on) => { draft.approved = on; }, `${say("claims.linkApproveHelp")} ${say("claims.noPassagePublic")}`));
    const done = () => fill(formSlot);
    const saveIt = async () => {
      fields.clear();
      const problem = validateEvidenceLinkDraft(draft, { sources: sources(), passages: passages() });
      if (problem) { const text = sayId(problem.id, problem.vars || {}); if (!fields.show(problem.field, text)) fill(banner, h("p", { class: "studio-field-error", text })); return; }
      try {
        const reply = await api.call(record ? "PUT" : "POST", "research/claims/links", { json: { revision: view.revision, link: evidenceLinkPayload(draft) } });
        view = { ...view, ...reply };
        done();
        paint();
        said.tell(say("claims.linkSaved"), record ? { undo: () => put("link", record), undoLabel: say("research.undo") } : {});
      } catch (error) {
        if (error?.status === 401) throw error;
        const found = researchProblem(error, "evidence");
        const text = researchWords(found) || sayId(found.id, found.vars || {});
        if (!(found.field && fields.show(found.field, text))) fill(banner, h("alert-banner", { variant: "warning" }, h("p", { text }), forHelper(found.details, claimsErrorMessage(error))));
      }
    };
    fill(formSlot, h("section", { class: "studio-section studio-claims-form" }, h("h4", { tabindex: "-1" }, say("claims.linkTitle"), " ", h("bdi", { text: short(claim.statement) })), banner,
      relation.element, source, passage, places.element, rationale, firmField(draft.confidence, (v) => { draft.confidence = v; }, fields, "confidence"), uncertainty, review, approved.element,
      h("div", { class: "studio-row" }, h("action-button", { class: "studio-primary", onClick: saveIt }, say("claims.save")), h("action-button", { variant: "secondary", onClick: done }, say("notebook.neverMind")))));
    requestAnimationFrame(() => formSlot.querySelector("h4")?.focus());
  }

  async function put(type, was) {
    try {
      view = { ...view, ...(await api.put(type === "claim" ? "research/claims/claims" : "research/claims/links", { revision: view.revision, [type]: was })) };
      paint();
      said.tell(say("research.undone"));
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(error?.status === 409 ? say("research.undoChanged") : researchWords(researchProblem(error, "claims")), { variant: "problem" });
    }
  }

  async function remove(type, record) {
    try {
      view = { ...view, ...(await api.call("DELETE", type === "claim" ? "research/claims/claims" : "research/claims/links", { json: { revision: view.revision, id: record.id } })) };
      paint();
      said.tell(say("claims.removed"), { undo: async () => {
        try {
          view = { ...view, ...(await api.post(type === "claim" ? "research/claims/claims" : "research/claims/links", { revision: view.revision, [type]: record })) };
          paint();
          said.tell(say("research.undone"));
        } catch (error) {
          if (error?.status === 401) throw error;
          said.tell(error?.data?.diagnostics?.some((d) => d.code === "duplicate-id") ? say("research.undoTaken") : researchWords(researchProblem(error, "claims")), { variant: "problem" });
        }
      }, undoLabel: say("research.undo"), focus: true });
    } catch (error) {
      if (error?.status === 401) throw error;
      said.tell(researchWords(researchProblem(error, "claims")), { variant: "problem" });
    }
  }

  return { element, load, focus: () => make.querySelector("button")?.focus() };
}

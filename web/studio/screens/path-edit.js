// A reading path: its title, address and line, its steps in order (Move, Change, Take it out), what
// readers will see, and Save draft / Publish / Update. Saving is explicit; the order is saved by saving
// the whole path. Undo puts back what a save replaced. Studio R13; docs/specs/studio/r13/ux.md.
// The rules are parts/path-rules.js; the server owns every rule and the saved file.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sendOut, wentOutWords } from "../parts/publish.js";
import { say } from "../parts/words.js";
import { pathPreview } from "../parts/path-preview.js";
import * as undo from "../parts/path-undo.js";
import * as R from "../parts/path-rules.js";

const BASE = "reading-paths";

export async function createPathEdit(context, route) {
  const { api, meta, go } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "select-field", "side-sheet", "skeleton-block", "status-badge", "text-field", "toggle-switch");
  const isNew = !route.arg || route.arg === "new";
  let slug = isNew ? "" : route.arg;
  let revision = null;
  let saved = null; // the path as on the server (null: not saved yet)
  let draft = R.pathDraft(null, slug);
  let states = [];
  let targets = null;
  let publish = false;
  let url = null;
  let source = "";
  let unreadable = false;
  let addressTouched = false;
  let removed = null; // the last step taken out, for Undo: { step, index }
  let problems = []; // { step, field, code } the last save found
  let loaded = false;
  let previewTimer = 0;
  let previewOpen = false;
  let previewReply = null;

  const trail = h("breadcrumb-trail", { items: [{ label: say("paths.crumbHome"), href: "#/" }, { label: say("paths.nav"), href: "#/paths" }, { label: say("paths.untitled"), href: "" }] });
  const back = h("a", { class: "studio-back", href: "#/paths", text: say("paths.back") });
  const heading = h("h2", { id: "studio-path-h", class: "studio-question", tabindex: "-1", text: say("paths.newHeading") });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const undoSlot = h("div", { "aria-live": "polite" });
  const title = h("text-field", { label: say("paths.fieldTitle"), maxlength: R.LIMITS.title, class: "studio-writing", onValuechange: () => edited("title") });
  const address = h("text-field", { label: say("paths.fieldAddress"), description: say("paths.addressHelp"), maxlength: R.LIMITS.address, onValuechange: () => { addressTouched = true; edited("address"); } });
  const addressLine = h("p", { class: "studio-help", hidden: true });
  const summary = h("text-field", { label: say("paths.fieldSummary"), rows: 3, maxlength: R.LIMITS.summary, onValuechange: () => edited("summary") });
  const listed = h("toggle-switch", { label: say("paths.listed"), description: say("paths.listedHelp"), checked: true, onCheckedchange: () => edited("listed") });
  const stepsHeading = h("h3", { id: "studio-path-steps-h", text: say("paths.stepsHeading") });
  const stepsLede = h("p", { class: "studio-help", text: say("paths.stepsLede") });
  const moveHelp = h("p", { class: "studio-help", text: say("paths.moveKeys") });
  const list = h("ol", { class: "studio-path-steps", "aria-labelledby": "studio-path-steps-h" });
  const count = h("p", { class: "studio-help" });
  const add = h("action-button", { variant: "secondary", onClick: () => addStep() }, say("paths.addStep"));
  const saveButton = h("action-button", { onClick: () => save() }, say("paths.saveDraft"));
  const publishButton = h("action-button", { variant: "secondary", onClick: () => save({ status: "published" }) }, say("paths.publish"));
  const see = h("action-button", { variant: "secondary", onClick: (e) => seeReaders(e.currentTarget) }, say("paths.seeReaders"));
  const more = h("dropdown-menu", { class: "studio-row-menu", items: [], onItemselect: (e) => moreAction(e.detail) }, h("span", { slot: "label" }, say("paths.more")));
  const sheet = h("side-sheet", { label: say("paths.sheetHeading"), side: "right" });
  const form = h("div", { class: "studio-path-form" }, title, address, addressLine, summary, listed);
  const bar = h("div", { class: "studio-write-bar studio-path-bar" }, see, publishButton, saveButton, more);
  const stepsSection = h("section", { class: "studio-section", "aria-labelledby": "studio-path-steps-h" }, stepsHeading, stepsLede, moveHelp, list, count, add);
  // A path that exists shows nothing she can type in until it has loaded: what she typed first would
  // be replaced by the saved path when it arrived.
  const waiting = h("skeleton-block", { lines: 6, hidden: isNew });
  const element = h("section", { class: "studio-page studio-path", "aria-labelledby": "studio-path-h" },
    h("div", { class: "studio-write-top" }, trail, back), heading, status, undoSlot, banner, waiting, form, stepsSection, bar, sheet);
  const showEditor = (on) => {
    for (const part of [form, stepsSection, bar]) part.hidden = !on;
    waiting.hidden = true;
    if (on) element.removeAttribute("aria-busy");
  };
  if (!isNew) {
    for (const part of [form, stepsSection, bar]) part.hidden = true;
    element.setAttribute("aria-busy", "true");
  }

  const dirty = () => loaded && !unreadable && (!saved ? Boolean(draft.title.trim() || draft.steps.length || (draft.summary || "").trim()) : !R.pathSame(draft, saved));
  const relationships = () => (targets?.relationships || []).map((r) => r.value);
  const stepState = (step) => R.stateFor(states, step.id);
  const nameOf = (step) => R.stepTitle(step, stepState(step), targets);
  const byId = (id) => draft.steps.find((s) => s.id === id);

  // ---- drawing ------------------------------------------------------------------------------------

  function paintHead() {
    // A file that can't be read is an error state, not a new path: nothing to add, save or publish.
    const here = unreadable ? say("paths.unreadableHeading") : saved ? draft.title || say("paths.untitled") : say("paths.newHeading");
    heading.textContent = here;
    trail.items = [{ label: say("paths.crumbHome"), href: "#/" }, { label: say("paths.nav"), href: "#/paths" }, { label: here, href: "" }];
    for (const control of [saveButton, add, count, list]) control.hidden = unreadable;
    const wasPublished = saved?.status === "published";
    saveButton.textContent = wasPublished ? say("paths.update") : say("paths.saveDraft");
    publishButton.hidden = wasPublished || draft.status === "published";
    if (wasPublished) saveButton.textContent = R.saveWords(true, "published");
    address.hidden = Boolean(saved);
    addressLine.hidden = !saved;
    if (unreadable) publishButton.hidden = true;
    if (saved) addressLine.textContent = say("paths.addressFixed", { address: slug });
    more.items = [
      ...(wasPublished ? [{ value: "draft", label: say("paths.makeDraft") }] : []),
      ...(saved ? [{ value: "delete", label: say("paths.delete") }] : []),
      { value: "written", label: say("paths.asWritten") },
    ];
    count.textContent = say("paths.stepsLeft", { count: String(draft.steps.length), limit: String(R.LIMITS.steps) });
    add.hidden = unreadable || draft.steps.length >= R.LIMITS.steps || !targets;
  }

  function stepCard(step, index) {
    const st = R.stateKey(stepState(step));
    const name = nameOf(step);
    const found = problems.filter((p) => p.step === step.id);
    const prior = index > 0 ? draft.steps[R.followedIndex(draft.steps, index)] : null;
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: R.moveChoices(index, draft.steps.length).map((c) => ({ value: c.value, label: moveLabel(c.value) })),
      onItemselect: (e) => move(step.id, R.moveChoices(index, draft.steps.length).find((c) => c.value === e.detail)?.to),
    }, h("span", { slot: "label" }, say("paths.move"), h("span", { class: "studio-visually-hidden", text: ` ${name}` })));
    const card = h("li", { class: "studio-path-step", "data-id": step.id, tabindex: "-1", "aria-label": say("paths.stepHeading", { number: String(index + 1), title: name }), onKeydown: (e) => {
      if (e.target !== card) return;
      const to = R.moveKey(e, index, draft.steps.length);
      if (to === null) return;
      e.preventDefault();
      move(step.id, to);
    } },
    h("strong", { class: "studio-path-step-title", text: say("paths.stepHeading", { number: String(index + 1), title: name }) }),
    st.published === false ? h("status-badge", { variant: "warning" }, R.stateWords(st.key)) : null,
    step.optional ? h("status-badge", { variant: "neutral" }, say("paths.stepOptional")) : null,
    found.length ? h("status-badge", { variant: "danger" }, say("paths.stepNeedsLook")) : null,
    index > 0 && prior ? h("p", { class: "studio-help", text: `${say("paths.relatesTo", { title: nameOf(prior) })} ${step.transition.relationship ? `${R.relationshipWords(step.transition.relationship)}. ` : ""}${step.transition.why || ""}`.trim() }) : null,
    index === 0 && R.heldReasons(draft).includes(step) ? h("p", { class: "studio-help", text: say("paths.keptReason") }) : null,
    ...found.map((p) => h("p", { class: "studio-error", role: "alert", text: R.problemWords(p.code, { field: p.field }) })),
    h("div", { class: "studio-row" },
      h("action-button", { variant: "secondary", size: "sm", onClick: () => editStep(step) }, say("paths.change"), h("span", { class: "studio-visually-hidden", text: ` ${name}` })),
      menu.items.length ? menu : null,
      h("action-button", { variant: "secondary", size: "sm", onClick: () => takeOut(step) }, say("paths.takeOut"), h("span", { class: "studio-visually-hidden", text: ` ${name}` }))));
    return card;
  }

  function moveLabel(value) {
    switch (value) {
      case "first": return say("paths.moveFirst");
      case "up": return say("paths.moveUp");
      case "down": return say("paths.moveDown");
      default: return say("paths.moveLast");
    }
  }

  function paint() {
    paintHead();
    if (!draft.steps.length) list.replaceChildren(h("li", { class: "studio-help", text: say("paths.stepsEmpty") }));
    else list.replaceChildren(...draft.steps.map(stepCard));
  }

  const focusStep = (id) => requestAnimationFrame(() => list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus());

  // ---- editing ------------------------------------------------------------------------------------

  function edited(field) {
    if (field === "title") {
      draft.title = String(title.value ?? "");
      if (!saved && !addressTouched) { draft.slug = R.suggestAddress(draft.title, takenAddresses); address.value = draft.slug; }
    }
    if (field === "address") draft.slug = String(address.value ?? "").trim();
    if (field === "summary") draft.summary = String(summary.value ?? "");
    if (field === "listed") draft.listed = listed.checked === true;
    if (field === "title") paintHead();
    changed();
  }

  let takenAddresses = [];
  function changed() {
    if (problems.length) { problems = []; banner.replaceChildren(); }
    schedulePreview();
  }

  function move(id, to) {
    const from = draft.steps.findIndex((s) => s.id === id);
    if (from < 0 || to === undefined) return;
    const moved = R.moveTo(draft.steps, from, to);
    if (moved.steps === draft.steps) return;
    draft.steps = moved.steps;
    status.textContent = say("paths.moved", { title: nameOf(moved.steps[moved.index]), number: String(moved.index + 1), count: String(draft.steps.length) });
    changed();
    paint();
    focusStep(id);
  }

  function takeOut(step) {
    const index = draft.steps.indexOf(step);
    removed = { step, index };
    draft.steps = draft.steps.filter((s) => s !== step);
    const name = nameOf(step);
    const back = h("action-button", { variant: "secondary", size: "sm", onClick: () => {
      draft.steps.splice(Math.min(removed.index, draft.steps.length), 0, removed.step);
      const id = removed.step.id;
      removed = null;
      status.textContent = say("paths.stepBack", { title: name });
      changed();
      paint();
      focusStep(id);
    } }, say("paths.undoStep"));
    status.replaceChildren(h("span", { text: `${say("paths.tookOut", { title: name })} ` }), back);
    changed();
    paint();
    requestAnimationFrame(() => (back.querySelector("button") || list.querySelector(".studio-path-step"))?.focus());
  }

  // ---- a step's sheet -----------------------------------------------------------------------------

  function editStep(step, { fresh = false } = {}) {
    const index = draft.steps.indexOf(step);
    const first = index === 0;
    const mine = { ...step, transition: { ...step.transition } };
    const name = nameOf(step);
    const choices = R.relationshipChoices(draft.steps, index, relationships());
    const relation = h("select-field", { label: say("paths.howItRelates"), options: [{ value: "", label: say("paths.chooseOne") }, ...choices.map((v) => ({ value: v, label: R.relationshipWords(v) }))], value: mine.transition.relationship, onValuechange: () => { mine.transition.relationship = relation.value; drawBasis(); } });
    const why = h("text-field", { label: say("paths.why"), description: say("paths.whyHelp"), rows: 3, maxlength: R.LIMITS.text, value: mine.transition.why, onValuechange: () => { mine.transition.why = String(why.value ?? ""); } });
    const links = R.basisChoices(draft.steps, index, targets?.atlasLinks || []);
    const basis = h("select-field", { label: say("paths.basis"), description: say("paths.basisHelp"), options: links.length ? [{ value: "", label: say("paths.chooseOne") }, ...links.map((l) => ({ value: l.id, label: l.label }))] : [{ value: "", label: say("paths.basisNone") }], value: mine.transition.basis || "", onValuechange: () => { mine.transition.basis = basis.value; } });
    const drawBasis = () => { basis.hidden = mine.transition.relationship !== "influenced"; };
    const rationale = h("text-field", { label: say("paths.rationale"), rows: 3, maxlength: R.LIMITS.text, value: mine.rationale || "", onValuechange: () => { mine.rationale = String(rationale.value ?? ""); } });
    const prerequisites = h("text-field", { label: say("paths.prerequisites"), rows: 2, maxlength: R.LIMITS.prerequisites, value: mine.prerequisites || "", onValuechange: () => { mine.prerequisites = String(prerequisites.value ?? ""); } });
    const difficulty = h("select-field", { label: say("paths.difficulty"), options: [{ value: "", label: say("paths.difficultyNone") }, ...(targets?.difficulties || []).map((v) => ({ value: v, label: R.difficultyWords(v) }))], value: mine.difficulty || "", onValuechange: () => { mine.difficulty = difficulty.value; } });
    const optional = h("toggle-switch", { label: say("paths.optional"), description: say("paths.optionalHelp"), checked: mine.optional === true, disabled: first, onCheckedchange: () => { mine.optional = optional.checked === true; } });
    drawBasis();
    const keep = () => {
      Object.assign(step, { rationale: mine.rationale, prerequisites: mine.prerequisites, difficulty: mine.difficulty, optional: first ? false : mine.optional, transition: mine.transition });
      sheet.open = false;
      changed();
      paint();
      focusStep(step.id);
    };
    sheet.replaceChildren(
      h("span", { slot: "heading", text: name }),
      first ? null : h("p", { class: "studio-help", text: say("paths.relatesTo", { title: nameOf(draft.steps[R.followedIndex(draft.steps, index)] || step) }) }),
      first ? null : relation, first ? null : why, first ? null : basis,
      rationale, prerequisites, difficulty, optional,
      h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: say("paths.stepIdDetails", { id: step.id }) })),
      h("div", { class: "studio-sheet-actions" },
        h("action-button", { onClick: keep }, say("paths.sheetKeep")),
        h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; if (fresh) { draft.steps = draft.steps.filter((s) => s !== step); changed(); paint(); } } }, say("paths.sheetCancel"))));
    sheet.open = true;
    requestAnimationFrame(() => (first ? rationale : relation).focus?.());
  }

  // ---- adding a step ------------------------------------------------------------------------------

  function addStep() {
    if (!targets || unreadable) return;
    const used = new Set(draft.steps.map(R.targetKey));
    const search = h("text-field", { label: say("paths.addSearch"), onValuechange: () => drawList() });
    const results = h("div", { "aria-live": "polite" });
    const kinds = [
      { kind: "post", heading: say("paths.addPosts"), items: (targets.posts || []).map((p) => ({ target: p.slug, label: p.title || p.slug })) },
      { kind: "atlas", heading: say("paths.addEntries"), items: (targets.entries || []).map((e) => ({ target: e.id, label: e.label })) },
    ];
    function drawList() {
      const needle = String(search.value ?? "").trim().toLowerCase();
      const groups = kinds.map((group) => ({ ...group, items: group.items.filter((item) => !used.has(group.kind === "atlas" ? `atlas:${item.target}` : `post:${item.target}`) && (!needle || item.label.toLowerCase().includes(needle))) })).filter((group) => group.items.length);
      if (!groups.length) {
        results.replaceChildren(h("p", { class: "studio-help", text: needle ? say("paths.addNoMatch") : say("paths.addNone") }));
        return;
      }
      results.replaceChildren(...groups.map((group) => h("section", {}, h("h4", { text: group.heading }), h("ul", { class: "studio-pick-list" }, group.items.map((item) => h("li", {},
        h("button", { type: "button", class: "studio-pick", onClick: () => pick(group.kind, item) }, h("strong", { text: item.label }))))))));
    }
    function pick(kind, item) {
      if (draft.steps.length >= R.LIMITS.steps) { toast(say("paths.noMoreSteps"), { variant: "warning" }); return; }
      const step = R.newStep(draft.steps, kind, item.target);
      draft.steps.push(step);
      sheet.open = false;
      changed();
      paint();
      if (draft.steps.length > 1) {
        status.textContent = say("paths.added", { title: item.label });
        editStep(step, { fresh: true });
      } else {
        status.textContent = say("paths.addedFirst", { title: item.label });
        focusStep(step.id);
      }
    }
    sheet.replaceChildren(h("span", { slot: "heading", text: say("paths.addHeading") }), search, results);
    drawList();
    sheet.open = true;
    requestAnimationFrame(() => search.focus?.());
  }

  // ---- reading what the server answers -------------------------------------------------------------

  function adopt(reply, { keep = null } = {}) {
    slug = reply.slug || slug;
    revision = reply.revision ?? null;
    unreadable = reply.valid === false;
    source = reply.source || "";
    publish = reply.publish === true;
    url = reply.url || null;
    states = reply.states || [];
    if (unreadable) {
      saved = null;
      draft = R.pathDraft(null, slug);
    } else {
      saved = R.pathDraft(reply.path, slug);
      draft = keep || structuredClone(saved);
    }
    title.value = draft.title;
    address.value = draft.slug;
    summary.value = draft.summary || "";
    listed.checked = draft.listed !== false;
    form.hidden = unreadable;
    problems = [];
    banner.replaceChildren();
    if (unreadable) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("paths.unreadable") }, say("common.tell"),
        h("details", { class: "studio-help", open: true }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: (reply.problems || []).map((p) => p.text || p.message).join(" ") || source }))));
    }
    paint();
  }

  async function load() {
    try {
      const [loadedTargets, reply, all] = await Promise.all([
        api.get(`${BASE}/targets`).catch(() => null),
        isNew ? Promise.resolve(null) : api.get(`${BASE}/path?slug=${encodeURIComponent(slug)}`),
        api.get(BASE).catch(() => ({ items: [] })),
      ]);
      targets = loadedTargets;
      takenAddresses = (all.items || []).map((i) => i.slug);
      publish = all.publish === true;
      if (!loadedTargets || targets.problem) banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("paths.targetsTrouble") }, say("common.tell")));
      showEditor(true);
      if (reply) adopt(reply);
      else paint();
      loaded = true;
      const entry = undo.current(BASE);
      if (entry && entry.what === "delete") undo.forget();
      drawUndo(undo.current(BASE));
    } catch (error) {
      waiting.hidden = true;
      element.removeAttribute("aria-busy");
      const problem = R.pathProblem(error);
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: R.errorWords(problem.code === "missing" ? "missing" : "") },
        h("action-button", { variant: "secondary", onClick: () => load() }, say("paths.tryAgain")), h("a", { href: "#/paths", text: say("paths.back") })));
    }
  }

  // ---- saving -------------------------------------------------------------------------------------

  async function save({ status: nextStatus } = {}) {
    if (unreadable) return false;
    const target = nextStatus || draft.status;
    const mineNow = { ...draft, status: target };
    problems = R.localProblems(mineNow, relationships());
    if (problems.length) { showProblems(); paint(); return false; }
    if (saved && R.pathSame(mineNow, saved)) { toast(say("paths.nothingChanged")); return true; }
    const held = R.heldReasons(mineNow);
    if (held.length) {
      const choice = await ask({ heading: say("paths.heldAskHeading", { title: nameOf(held[0]) }), text: say("paths.heldAskText"), choices: [{ label: say("paths.heldAskYes"), value: "yes" }, { label: say("paths.heldAskNo"), value: "no", variant: "secondary" }] });
      if (choice !== "yes") return false;
    }
    const wasPublished = saved?.status === "published";
    saveButton.loading = true;
    publishButton.loading = true;
    try {
      const sent = structuredClone(mineNow);
      const body = { slug: sent.slug, path: R.pathPayload(sent) };
      const reply = saved ? await api.call("PUT", BASE, { json: { ...body, revision } }) : await api.post(BASE, body);
      const wasNew = !saved;
      const shown = reply.projection ? reply.projection.withheld === false : true;
      adopt(reply, { keep: R.pathSame({ ...draft, status: mineNow.status }, mineNow) ? null : draft });
      takenAddresses = [...new Set([...takenAddresses, slug])];
      if (wasNew) context.replaceRoute?.(`#/path/${encodeURIComponent(slug)}`);
      const said = R.savedWords({ wasPublished, status: sent.status, url, publish, shown });
      if (reply.replaced) undo.remember({ base: BASE, slug, name: reply.replaced, revision, title: draft.title, what: "save", said });
      drawUndo(undo.current(BASE));
      status.textContent = said;
      const out = await sendOut(api, `${saved?.status === "published" || sent.status === "published" ? "Update" : "Change"} the reading path ${draft.title.trim()}`);
      const sentWords = wentOutWords(out, { meta, action: "saved" });
      toast(`${said} ${sentWords.words.replace(/^Saved\.\s*/, "")}`.trim(), { variant: sentWords.variant, duration: out.sent === "failed" ? 0 : undefined });
      schedulePreview();
      return true;
    } catch (error) {
      return failed(error, mineNow);
    } finally {
      saveButton.loading = false;
      publishButton.loading = false;
    }
  }

  function showProblems() {
    const items = problems.map((p) => {
      const step = p.step ? byId(p.step) : null;
      return h("li", {}, step ? R.problemWords(p.code, { field: p.field }) : R.fieldProblem([p], p.field) || R.problemWords(p.code), " ",
        step ? h("action-button", { variant: "secondary", size: "sm", onClick: () => { editStep(step); } }, say("paths.goToStep", { title: nameOf(step) })) : null);
    });
    banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("paths.problemsHeading") },
      problems.length === 1 ? say("paths.problemsOne") : say("paths.problemsMany", { count: String(problems.length) }), h("ul", {}, items)));
    title.error = R.fieldProblem(problems, "title");
    address.error = R.fieldProblem(problems, "address");
  }

  async function failed(error, mineNow) {
    const p = R.pathProblem(error);
    if (p.code === "changed" && saved) return conflict(p.current, mineNow);
    if (p.code === "exists") {
      address.error = R.problemWords("exists");
      address.hidden = false;
      address.querySelector("input")?.focus();
      return false;
    }
    if (p.problems.length) {
      problems = p.problems.map((x) => ({ step: x.step, field: x.field, code: x.code }));
      showProblems();
      paint();
      return false;
    }
    banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("paths.problemsHeading") }, R.errorWords(p.code),
      p.sentence ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${say("paths.eSentence")} ${p.sentence}` })) : null));
    return false;
  }

  async function conflict(current, mineNow) {
    const choice = await ask({ heading: say("paths.changedHeading"), text: say("paths.changedText"), choices: [{ label: say("paths.useMine"), value: "mine" }, { label: say("paths.showTheirs"), value: "theirs", variant: "secondary" }] });
    if (!choice) return false;
    const fresh = current || await api.get(`${BASE}/path?slug=${encodeURIComponent(slug)}`).catch(() => null);
    if (!fresh) return false;
    if (choice === "mine") {
      const sure = await ask({ heading: say("paths.useMineSure"), text: say("paths.useMineSureText"), choices: [{ label: say("paths.useMineYes"), value: "yes" }, { label: say("paths.heldAskNo"), value: "no", variant: "secondary" }] });
      if (sure !== "yes") return false;
      revision = fresh.revision;
      saved = R.pathDraft(fresh.path, slug);
      return save({ status: mineNow.status });
    }
    adopt(fresh);
    toast(say("paths.theirsShown"));
    return false;
  }

  // ---- more ---------------------------------------------------------------------------------------

  async function moreAction(what) {
    if (what === "draft") await save({ status: "draft" });
    if (what === "delete") await remove();
    if (what === "written") showWritten();
  }

  async function remove() {
    if (!saved) return;
    const live = saved.status === "published";
    const choice = await ask({ heading: say("paths.deleteAsk", { title: draft.title }), text: live ? say("paths.deleteAskLive") : say("paths.deleteAskText"), choices: [{ label: say("paths.delete"), value: "delete", variant: "destructive" }, { label: say("paths.keepIt"), value: "keep", variant: "secondary" }], focus: 1 });
    if (choice !== "delete") return;
    try {
      const reply = await api.call("DELETE", `${BASE}?slug=${encodeURIComponent(slug)}&revision=${encodeURIComponent(revision)}`);
      const name = draft.title;
      saved = draft; // nothing left to protect
      loaded = false;
      undo.remember({ base: BASE, slug, name: reply.replaced || reply.trashedTo, revision: null, title: name, what: "delete" });
      sendOut(api, `Delete the reading path ${name.trim()}`).catch(() => {});
      go("#/paths");
    } catch (error) {
      const p = R.pathProblem(error);
      if (p.code === "changed") { await load(); }
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("paths.problemsHeading") }, R.errorWords(p.code)));
    }
  }

  function drawUndo(entry) {
    if (!entry || entry.what !== "save") { undoSlot.replaceChildren(); return; }
    undoSlot.replaceChildren(undo.undoLine({ words: entry.said || say("paths.savedNow"), undo: say("paths.undo"), dismiss: say("paths.dismiss"), onUndo: () => undoSave(entry), onClose: () => undo.forget() }));
  }
  undo.watch((entry) => { if (loaded) drawUndo(entry && entry.base === BASE ? entry : null); });

  async function undoSave(entry) {
    const out = await undo.putBack(api, { ...entry, revision });
    if (out.reply) {
      adopt(out.reply);
      undo.remember({ base: BASE, slug, name: out.reply.replaced, revision, title: draft.title, what: "save", said: say("paths.undone") });
      status.textContent = say("paths.undone");
      toast(say("paths.undone"));
      sendOut(api, `Change the reading path ${draft.title.trim()}`).catch(() => {});
      return;
    }
    toast(say("paths.undoFailed"), { variant: "warning", duration: 0 });
  }

  function showWritten() {
    const text = unreadable || !saved ? source : source || JSON.stringify(R.pathPayload(draft), null, 2);
    sheet.replaceChildren(
      h("span", { slot: "heading", text: say("paths.writtenHeading") }),
      h("p", { class: "studio-help", text: say("paths.writtenHelp") }),
      h("pre", { class: "studio-mono studio-written", tabindex: "0", text }),
      h("div", { class: "studio-sheet-actions" }, h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; } }, say("paths.writtenClose"))));
    sheet.open = true;
  }

  // ---- what readers will see ----------------------------------------------------------------------

  async function seeReaders(opener) {
    previewOpen = true;
    const body = h("div", { "aria-live": "polite" }, h("p", { class: "studio-help", text: say("paths.previewRefresh") }));
    const close = h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; } }, say("paths.previewClose"));
    sheet.replaceChildren(h("span", { slot: "heading", text: say("paths.previewHeading") }), h("p", { class: "studio-help", text: say("paths.previewOnlyYou") }), close, body);
    sheet.open = true;
    const onClose = (e) => { if (e.detail) return; previewOpen = false; sheet.removeEventListener("openchange", onClose); opener?.focus?.(); };
    sheet.addEventListener("openchange", onClose);
    previewTarget = body;
    await refreshPreview();
    requestAnimationFrame(() => close.querySelector("button")?.focus());
  }

  let previewTarget = null;
  async function refreshPreview() {
    if (!previewOpen || !previewTarget) return;
    try {
      previewReply = await api.post(`${BASE}/preview`, { slug: draft.slug || "preview", path: R.pathPayload(draft) });
      states = previewReply.states || states;
      previewTarget.replaceChildren(...pathPreview(previewReply, { titleOf: (id) => (byId(id) ? nameOf(byId(id)) : id) }));
    } catch {
      previewTarget.replaceChildren(h("p", { class: "studio-help", role: "alert", text: say("paths.previewFailed") }));
    }
  }
  function schedulePreview() {
    if (!previewOpen) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 600);
  }

  async function leave() {
    if (!dirty()) return true;
    const choice = await ask({ heading: say("paths.leaveHeading"), text: say("paths.leaveText"), choices: [{ label: say("paths.leaveSave"), value: "save" }, { label: say("paths.leaveGo"), value: "go", variant: "secondary" }] });
    if (choice === "save") return save();
    return choice === "go";
  }

  return {
    title: say("paths.nav"),
    element,
    load,
    leave,
    isDirty: dirty,
    focus: () => heading.focus(),
    get palette() {
      return [
        { id: "add", label: say("paths.findAdd"), group: say("paths.nav") },
        { id: "see", label: say("paths.seeReaders"), group: say("paths.nav") },
        { id: "save", label: say("paths.findSave"), group: say("paths.nav"), hint: "Ctrl S" },
        { id: "written", label: say("paths.asWritten"), group: say("paths.nav") },
        ...(undo.current(BASE) ? [{ id: "undo", label: say("paths.findUndo", { last: undo.current(BASE).what === "delete" ? say("paths.lastDelete", { title: undo.current(BASE).title }) : say("paths.lastSave") }), group: say("paths.nav") }] : []),
      ];
    },
    keys: ["save", "publish"],
    command(id) {
      if (id === "add") addStep();
      if (id === "see") seeReaders(null);
      if (id === "save" || id === "publish") save();
      if (id === "written") showWritten();
      if (id === "undo" && undo.current(BASE)) undoSave(undo.current(BASE));
    },
  };
}

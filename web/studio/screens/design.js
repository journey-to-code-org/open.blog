// Describe a new look (Studio R9, #/look/design): "Make a new look from my words." She describes
// it, her writing helper drafts it, she sees it on her own front page in light and dark, changes
// it by words or changes any one colour by hand, names it, saves it, and puts it up. Saving makes
// a new look; nothing she already has changes.
//
// The server decides every colour that is saved: preview and save both rebuild from the draft and
// make each colour that carries writing easy to read, and this screen shows what the server made
// and says what changed. The page may warn early; it never saves a colour of its own. What a
// helper returns (the name, the summary) is placed as text; a colour reaches the page only as a
// checked hex in a custom property (as Look's swatches). Look's own controls are not here: this screen says which
// of them still apply on top.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { ask } from "../parts/dialogs.js";
import { innerAria } from "../parts/inner-button.js";
import { showPreview } from "../parts/preview.js";
import { createDidLine } from "../parts/did-line.js";
import { clip, companyName, helperProblem } from "../parts/helper-rules.js";
import {
  IDEAS, MAX_DESCRIPTION, MAX_LABEL, WRITING_ROLES, backDraft, descriptionProblem, designProblem, labelProblem, letteringLine, lookOverrides, noteWords, pickedWords, pushDraft,
  readablePairs, renamed, roleName, startFrom, swatches, willAdjust, withColor,
} from "../parts/design-rules.js";

const STILL_MS = 20000;

export async function createDesign(context) {
  const { api, meta } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "content-card", "empty-state", "segmented-control", "select-field", "text-field", "loading-spinner", "skeleton-block");
  let status = null;
  let options = { themes: [], current: "" };
  let look = null;
  let entry = null; // { draft, theme, changes, suggested }
  let history = [];
  let scheme = "light";
  let waiting = null;
  let savedAs = null; // { name, label, undoToken, path }
  let lookApplied = null;

  const heading = h("h2", { id: "studio-design-h", class: "studio-question", tabindex: "-1", text: say("design.title") });
  const base = h("select-field", { label: say("design.baseLabel"), description: say("design.baseHelp"), options: [], value: "" });
  const words = h("text-field", { label: say("design.describeLabel"), rows: 4, maxlength: MAX_DESCRIPTION, placeholder: say("design.describePlaceholder") });
  const ideas = h("div", { class: "studio-row studio-design-ideas", role: "group", "aria-label": say("design.ideasLabel") });
  const goes = h("p", { class: "studio-goes studio-design-goes" });
  const exact = h("pre", { class: "studio-goes-exact", tabindex: "0", "aria-label": say("common.wordForWord") });
  const goesDetails = h("details", { class: "studio-goes-words" }, h("summary", { text: say("common.wordForWord") }), exact);
  const working = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const draftButton = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => askHelper(false) }, say("design.draft"));
  const form = h("div", { class: "studio-design-form" });
  const result = h("section", { class: "studio-design-result", hidden: true, "aria-labelledby": "studio-design-result-h" });
  const body = h("div", { class: "studio-design-columns" }, form, result);
  const element = h("section", { class: "studio-page studio-design", "aria-labelledby": "studio-design-h" },
    h("breadcrumb-trail", { items: [{ label: say("design.home"), href: "#/" }, { label: say("design.look"), href: "#/look" }, { label: say("design.title"), href: "" }] }),
    heading, h("p", { class: "studio-lede", text: say("design.lede") }), body);

  const company = () => companyName(status || {});
  const baseLabel = () => options.themes.find((t) => t.value === base.value)?.label || say("design.baseOwn");
  const forHelper = (...lines) => (lines.filter(Boolean).length ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), ...lines.filter(Boolean).map((line) => h("p", { class: "studio-mono", text: String(line) }))) : null);
  const online = () => globalThis.navigator?.onLine !== false;

  function paintGoes(changing = false) {
    goes.textContent = say("design.goes", { company: company() });
    const description = String((changing ? change.value : words.value) ?? "").trim();
    exact.textContent = [
      changing ? say("design.wfwChange", { description }) : say("design.wfwDescription", { description }),
      say("design.wfwSite", { site: String(meta.siteTitle || "") }),
      say("design.wfwBase", { base: baseLabel() }),
      ...(changing && entry ? [say("design.wfwPrevious", { draft: JSON.stringify(renamed(entry.draft, name.value || entry.draft.label)) })] : []),
    ].join("\n");
  }
  goesDetails.addEventListener("toggle", () => paintGoes(document.activeElement === change.querySelector("textarea")));
  words.addEventListener("valuechange", () => { words.error = ""; paintGoes(); });
  base.addEventListener("valuechange", () => paintGoes());

  // ---- the result's own parts
  const resultHeading = h("h2", { id: "studio-design-result-h", class: "studio-question", tabindex: "-1" });
  const summary = h("p", { class: "studio-lede" });
  const notes = h("div", { class: "studio-banner" });
  const schemePick = h("segmented-control", { label: say("design.schemeLabel"), value: "light", options: [{ value: "light", label: say("design.schemeLight") }, { value: "dark", label: say("design.schemeDark") }],
    onValuechange: (event) => { scheme = event.detail === "dark" ? "dark" : "light"; paintColors(); } });
  const colors = h("ul", { class: "studio-design-swatches" });
  const said = createDidLine();
  const lookNote = h("div", {});
  const lettering = h("p", { class: "studio-help" });
  const see = h("action-button", { variant: "secondary", onClick: (event) => preview(event.currentTarget) }, say("design.see"));
  const change = h("text-field", { label: say("design.changeLabel"), rows: 2, maxlength: MAX_DESCRIPTION, placeholder: say("design.changePlaceholder") });
  const changeButton = h("action-button", { variant: "secondary", onClick: () => askHelper(true) }, say("design.change"));
  const back = h("button", { type: "button", class: "studio-link-button", hidden: true, onClick: () => stepBack() }, say("design.back"));
  const name = h("text-field", { label: say("design.nameLabel"), description: say("design.nameHelp"), maxlength: MAX_LABEL });
  const saveButton = h("action-button", { "aria-keyshortcuts": "Control+S Meta+S", onClick: () => save() }, say("design.save"));
  const savedCard = h("div", { class: "studio-design-saved" });
  const details = h("details", { class: "studio-voice-details" }, h("summary", { text: say("common.forHelper") }));
  const detailsBody = h("div", {});
  details.append(detailsBody);
  change.addEventListener("valuechange", () => { change.error = ""; });
  name.addEventListener("valuechange", () => { name.error = ""; });

  function paintColors() {
    if (!entry) return;
    const given = entry.draft[scheme] || {};
    const pairs = readablePairs(entry.theme?.colors?.[scheme] || {});
    fill(colors, ...swatches(entry.theme, scheme).map((swatch) => {
      // `swatch.color` is a checked #rrggbb (design-rules `swatches`); set as Look sets its own swatches.
      const chip = h("span", { class: "studio-design-chip", "aria-hidden": "true", style: `--swatch: ${swatch.color}` });
      const writing = WRITING_ROLES.includes(swatch.key);
      const easy = writing && pairs.filter((pair) => pair.role === swatch.key).every((pair) => pair.ok);
      const picker = h("input", { type: "color", class: "studio-design-picker", value: given[swatch.key] || swatch.color, "aria-label": say("design.colorLabel", { role: swatch.label }), tabindex: "-1" });
      picker.addEventListener("change", () => pick(swatch.key, picker.value));
      const button = h("action-button", { variant: "ghost", size: "sm", onClick: () => { if (picker.showPicker) picker.showPicker(); else picker.click(); } }, say("design.changeShort"));
      innerAria(button, { "aria-label": say("design.changeColor", { role: swatch.label }) });
      const suggested = entry.suggested?.[scheme]?.[swatch.key];
      const useSuggested = suggested && suggested !== given[swatch.key]
        ? h("button", { type: "button", class: "studio-link-button", onClick: () => pick(swatch.key, suggested) }, say("design.useSuggested", { role: swatch.label })) : null;
      return h("li", { class: "studio-design-swatch", "data-role": swatch.key },
        chip, h("span", { class: "studio-design-role", text: swatch.label }),
        easy ? h("span", { class: "studio-design-easy" }, h("span", { "aria-hidden": "true", text: "✓ " }), say("design.easyToRead")) : null,
        h("span", { class: "studio-design-change" }, button, picker), useSuggested);
    }));
    paintDetails();
  }

  function paintNotes() {
    const lines = (entry?.changes?.length ? entry.changes : entry?.notes || []).map(noteWords).filter(Boolean);
    fill(notes, lines.length ? h("alert-banner", { variant: "info", heading: say("design.madeReadable") }, h("ul", {}, lines.map((line) => h("li", { text: line })))) : null);
  }

  function paintLookNote() {
    const over = lookOverrides(look?.look || {}, lookApplied || look?.honored || null);
    fill(lookNote,
      over.accent ? h("p", { class: "studio-help" }, h("span", { text: `${say("design.lookAccentNote")} ` }), h("a", { href: "#/look", text: say("design.lookLink") })) : null,
      over.others.length ? h("p", { class: "studio-help", text: say("design.lookOverrides", { choices: over.others.join(", ") }) }) : null);
  }

  function paintDetails() {
    if (!entry) return;
    const given = entry.draft[scheme] || {};
    const made = entry.theme?.colors?.[scheme] || {};
    fill(detailsBody,
      h("p", { class: "studio-help", text: say("design.detailsBase", { base: String(entry.extends || base.value || "") }) }),
      h("p", { class: "studio-help", text: say("design.detailsColors", { scheme }) }),
      h("ul", { class: "studio-voice-files" },
        ...swatches(entry.theme, scheme).map((swatch) => h("li", { class: "studio-mono", text: say("design.detailsColor", { role: swatch.key, given: String(given[swatch.key] || "—"), made: String(made[swatch.key] || "—") }) })),
        ...readablePairs(made).map((pair) => h("li", { class: "studio-mono", text: say("design.detailsRatio", { role: pair.role, ground: pair.ground, ratio: pair.ratio }) }))),
      lookApplied ? h("p", { class: "studio-help", text: say("design.detailsLook", { list: lookApplied.join(", ") || "—" }) }) : null,
      h("p", { class: "studio-help", text: say("design.detailsDraft") }),
      h("pre", { class: "studio-goes-exact", tabindex: "0", text: JSON.stringify(entry.draft, null, 2) }),
      savedAs ? h("p", { class: "studio-mono", text: say("design.detailsPath", { path: String(savedAs.path || "") }) }) : null,
      h("p", { class: "studio-help", text: say("design.detailsLimits") }));
  }

  /** Show a draft and what the server made of it. */
  function show(next, { focus = true, keepName = false } = {}) {
    entry = next;
    savedAs = null;
    fill(savedCard);
    resultHeading.textContent = clip(String(entry.draft.label || ""), MAX_LABEL).text;
    summary.textContent = clip(String(entry.draft.summary || ""), 300).text;
    if (!keepName) name.value = String(entry.draft.label || "");
    lettering.textContent = letteringLine(entry.draft, baseLabel());
    back.hidden = history.length < 2;
    saveButton.hidden = false;
    result.hidden = false;
    paintNotes();
    paintColors();
    paintLookNote();
    if (focus) requestAnimationFrame(() => resultHeading.focus());
  }

  // ---- asking the helper (a first draft, or a change in words)
  async function askHelper(changing) {
    if (waiting) return;
    const field = changing ? change : words;
    const problem = descriptionProblem(field.value);
    if (problem) { field.error = problem; field.querySelector("textarea")?.focus(); return; }
    if (!online()) { working.textContent = say("design.noSignal"); return; }
    const turn = {};
    waiting = turn;
    const button = changing ? changeButton : draftButton;
    button.loading = true;
    fill(working, h("loading-spinner", { size: "sm", "aria-hidden": "true" }), h("span", { text: ` ${changing ? say("design.changing") : say("design.drafting")}` }));
    const still = setTimeout(() => {
      if (waiting !== turn) return;
      fill(working, h("span", { text: `${say("design.still")} ` }), h("button", { type: "button", class: "studio-link-button", onClick: () => { waiting = null; button.loading = false; working.textContent = say("design.stopped"); } }, say("common.stopWaiting")));
    }, STILL_MS);
    try {
      const answer = await api.post("theme-draft", { description: String(field.value).trim(), previous: changing && entry ? renamed(entry.draft, name.value || entry.draft.label) : null, base: base.value || null, confirmed: true });
      if (waiting !== turn) return; // she stopped waiting: nothing changes
      const next = { draft: answer.draft, theme: answer.theme, changes: answer.changes || [], notes: answer.notes || [], extends: answer.extends, suggested: { light: { ...answer.draft.light }, dark: { ...answer.draft.dark } } };
      history = pushDraft(history, next);
      lookApplied = null;
      show(next);
      if (changing) change.value = "";
      working.textContent = say("design.resultNote");
    } catch (error) {
      if (error?.status === 401) throw error;
      if (waiting !== turn) return;
      tellProblem(error, { field });
    } finally {
      clearTimeout(still);
      if (waiting === turn) { waiting = null; button.loading = false; }
    }
  }

  /** A failure in her words, in the status line or on its field; the server's sentence for {helper}. */
  function tellProblem(error, { field = null, line = working } = {}) {
    const own = designProblem(error);
    const found = own ? null : helperProblem(error, { company: company() });
    if (found?.off) { load(); return; }
    const sentence = own ? own.words : found.words;
    if (own?.field === "description" && field) { field.error = sentence; field.querySelector("textarea")?.focus(); fill(line); return; }
    if (own?.field === "name") { name.error = own.code === "name-taken" || own.code === "exists" ? say("design.nameTaken", { name: String(name.value).trim() }) : sentence; name.querySelector("input")?.focus(); fill(line); return; }
    fill(line, h("span", { text: sentence }), forHelper(`${own?.code || found?.code || ""} ${error?.status || ""}`.trim(), own?.details, ...(found?.details || [])));
  }

  function stepBack() {
    const before = backDraft(history);
    if (!before) return;
    history = before.history;
    show(before.entry, { focus: false });
    said.tell(say("design.backDone"));
  }

  // ---- one colour, by hand: the server makes it readable, and the swatch shows what it made
  async function pick(role, hex) {
    const next = withColor(entry?.draft, scheme, role, hex);
    if (!next) return;
    const before = entry;
    const label = roleName(role);
    const early = willAdjust(next[scheme], role);
    if (early) said.tell(say("design.colorWillAdjust"));
    try {
      const reply = await api.post("theme-draft/preview", { draft: renamed(next, name.value || next.label), mode: scheme, base: base.value || null });
      const made = { draft: next, theme: { ...entry.theme, colors: reply.colors }, changes: reply.changes || [], notes: reply.notes || [], extends: entry.extends, suggested: entry.suggested };
      lookApplied = Array.isArray(reply.lookApplied) ? reply.lookApplied : null;
      history = pushDraft(history, made);
      show(made, { focus: false, keepName: true });
      said.tell(pickedWords(made.changes, scheme, role).words, { undoLabel: say("design.colorUndo"), undo: () => {
        history = backDraft(history)?.history || history;
        show(before, { focus: false, keepName: true });
        said.tell(say("design.colorUndone", { role: label }));
      } });
      requestAnimationFrame(() => colors.querySelector(`[data-role="${role}"] action-button button`)?.focus());
    } catch (error) {
      if (error?.status === 401) throw error;
      // Nothing of hers changed: the swatch still shows the colour before.
      paintColors();
      tellProblem(error, { line: said.element });
      said.element.hidden = false;
    }
  }

  function preview(opener) {
    if (!entry) return null;
    return showPreview(api, {
      opener,
      request: async (mode) => {
        const reply = await api.post("theme-draft/preview", { draft: renamed(entry.draft, name.value || entry.draft.label), mode: mode || scheme, base: base.value || null });
        lookApplied = Array.isArray(reply.lookApplied) ? reply.lookApplied : lookApplied;
        paintLookNote();
        return reply;
      },
      modes: { label: say("design.schemeLabel"), value: scheme, options: [{ value: "light", label: say("design.schemeLight") }, { value: "dark", label: say("design.schemeDark") }] },
      heading: say("design.previewHeading"), backLabel: say("design.previewBack"), note: say("design.previewNote"), frameTitle: say("design.previewFrame"),
    });
  }

  // ---- save, then put it up
  async function save() {
    if (!entry || savedAs) return false;
    const problem = labelProblem(name.value, options.themes.map((t) => t.label));
    if (problem) { name.error = problem; name.querySelector("input")?.focus(); return false; }
    saveButton.loading = true;
    try {
      const reply = await api.post("theme-draft/save", { draft: renamed(entry.draft, name.value), base: base.value || null });
      savedAs = { name: reply.name, label: reply.label, undoToken: reply.undoToken || "", path: reply.path };
      options.themes.push({ value: reply.name, label: reply.label });
      saveButton.hidden = true;
      paintSaved(reply);
      paintDetails();
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      tellProblem(error, { line: said.element });
      said.element.hidden = false;
      return false;
    } finally {
      saveButton.loading = false;
    }
  }

  function paintSaved(reply) {
    const label = String(reply.label || "");
    const line = createDidLine();
    const card = h("content-card", { heading: reply.buildError ? say("design.savedNotBuilt", { name: label }) : say("design.saved", { name: label }) },
      reply.buildError ? forHelper(reply.buildError) : null,
      h("div", { class: "studio-row" },
        h("action-button", { href: `#/decorations?do=putup&look=${encodeURIComponent(reply.name)}` }, say("design.putUp")),
        h("action-button", { variant: "secondary", href: `#/decorations?add=${encodeURIComponent(reply.name)}` }, say("design.addSeason")),
        h("action-button", { variant: "ghost", onClick: () => another() }, say("design.another"))),
      line.element);
    card.setAttribute("tabindex", "-1");
    fill(savedCard, card);
    line.tell(say("design.savedToast", { name: label }), reply.undoToken ? { undoLabel: say("design.undo"), undo: () => undoSave(line, label) } : {});
    requestAnimationFrame(() => card.focus());
  }

  async function undoSave(line, label) {
    const was = savedAs;
    try {
      await api.call("DELETE", `theme-draft/${encodeURIComponent(was.name)}?undo=${encodeURIComponent(was.undoToken)}`);
      options.themes = options.themes.filter((t) => t.value !== was.name);
      savedAs = null;
      fill(savedCard);
      saveButton.hidden = false;
      said.tell(say("design.unsaved", { name: label }));
      paintDetails();
      requestAnimationFrame(() => saveButton.querySelector("button")?.focus());
    } catch (error) {
      if (error?.status === 401) throw error;
      // In use, changed, or too late: nothing was removed, and it says so.
      line.tell(designProblem(error)?.code ? say("design.undoTooLate", { name: label }) : say("design.notSaved"), { variant: "problem" });
    }
  }

  function another() {
    entry = null;
    history = [];
    savedAs = null;
    result.hidden = true;
    words.value = "";
    working.textContent = "";
    requestAnimationFrame(() => words.querySelector("textarea")?.focus());
  }

  fill(result, resultHeading, summary, notes,
    schemePick, colors, said.element, lookNote, lettering,
    h("div", { class: "studio-row" }, see),
    change, h("div", { class: "studio-row" }, changeButton, back),
    name, savedCard, details,
    h("div", { class: "studio-write-bar" }, saveButton));

  async function load() {
    fill(form, h("skeleton-block", { lines: 5 }));
    try {
      status = await api.get("assistant/status");
    } catch (error) {
      if (error?.status === 401) throw error;
      status = null;
    }
    if (!status || status.configured !== true) {
      result.hidden = true;
      fill(form, !status && !online()
        ? h("alert-banner", { variant: "info" }, say("design.noSignal"))
        : h("empty-state", { heading: say("design.helperOff") }, say("common.tell"),
          h("details", { slot: "actions", class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("a", { class: "studio-more-link", href: "#/helper?setup=1", text: say("design.setUp") }))));
      return;
    }
    try {
      const raw = await api.get("theme-draft");
      options = { themes: startFrom(raw), current: raw.current || "" };
      look = await api.get("look").catch(() => null);
    } catch (error) {
      if (error?.status === 401) throw error;
      fill(form, h("alert-banner", { variant: "danger", heading: say("design.loadFailed") }, h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      return;
    }
    base.options = options.themes.length ? options.themes : [{ value: "", label: say("design.baseOwn") }];
    base.value = options.themes.some((t) => t.value === options.current) ? options.current : (options.themes[0]?.value || "");
    fill(ideas, ...IDEAS().map((idea) => h("action-button", { variant: "secondary", size: "sm", onClick: () => { words.value = idea.text; words.error = ""; paintGoes(); words.querySelector("textarea")?.focus(); } }, idea.name)));
    paintGoes();
    fill(form, base, words,
      h("p", { class: "studio-help", id: "studio-design-ideas-l", text: say("design.ideasLabel") }), ideas,
      goes, goesDetails, working,
      h("div", { class: "studio-write-bar" }, draftButton));
  }

  return {
    title: say("design.title"),
    element,
    load,
    focus: () => heading.focus(),
    // A draft not saved is unsaved work; typing in the description alone is not.
    isDirty: () => Boolean(entry) && !savedAs,
    async leave() {
      if (!entry || savedAs) return true;
      const choice = await ask({ heading: say("design.leaveAsk"), text: say("design.leaveText"),
        choices: [{ label: say("design.leaveGo"), value: "go", variant: "secondary" }, { label: say("design.leaveStay"), value: "stay" }], focus: 1 });
      return choice === "go";
    },
    keys: ["save", "publish"],
    command(id) {
      if (id === "save") { if (entry && !savedAs) save(); return; }
      if (id === "publish") {
        if (change.contains(document.activeElement)) askHelper(true);
        else if (words.contains(document.activeElement) || !entry) askHelper(false);
      }
    },
  };
}

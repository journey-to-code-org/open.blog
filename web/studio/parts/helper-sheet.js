// Writing helper (Studio R8): the sheet in Write that answers "Help me with this post, and tell me
// exactly what you're sending first." Step 1 is Read it over: what to read, what to look for, and
// a live list of what goes to which company, above the one button that sends it. Step 2 is What
// your helper found (helper-found.js). Below: suggestions as she types, what she tells it about
// this post, and a job's Write it up for me. The machinery is under For {helper}.
//
// Nothing leaves before she presses Read it over; what the list says is computed from her choices
// only; results live in this page's memory for this visit and nowhere else.
import { fill, glyph, h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { trapFocus } from "./focus-trap.js";
import { innerAria } from "./inner-button.js";
import { createGoesBox } from "./helper-goes.js";
import { createFound } from "./helper-found.js";
import { createPostNote } from "./helper-notes.js";
import {
  companyName, detailLines, helperProblem, helperState, lookForChoices, orderFindings, passageFor, reasonWords, reviewRequest, scopeOf, skillsFor, sourceChanged, stateWords, whatGoes,
} from "./helper-rules.js";
import { defaultContextIds, notesPresent, voiceBudget, voiceGuideOf } from "./helper-context-rules.js";

const STILL_MS = 20000;
let uid = 0;

/** A native checkbox with its label (Zubra UI has none yet; as R5–R7). */
function tick(label, checked, onChange, { help = "" } = {}) {
  const id = `studio-helper-tick-${++uid}`;
  const input = h("input", { type: "checkbox", id, class: "studio-tick" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return { input, element: h("div", { class: "studio-helper-tick" }, h("label", { class: "studio-tick-label", for: id }, input, h("span", { text: label })), help ? h("p", { class: "studio-help", text: help }) : null) };
}

/**
 * `write` is Write's side: `{ path(), kind(), form(), boxes(), target(), isJob(), writeUp(opener),
 * suggest, go(hash), changedLine() }`. `form()` is `{ title, body, fields, boxes: [{ name, value }] }`.
 */
export async function createHelperSheet({ api, write }) {
  await use("side-sheet", "action-button", "alert-banner", "loading-spinner", "skeleton-block", "text-field", "toggle-switch", "content-card", "empty-state", "select-field");
  const heading = h("span", { slot: "heading", tabindex: "-1" });
  const status = h("p", { class: "studio-ready-status", role: "status", tabindex: "-1" });
  const formHost = h("div", { class: "studio-ready-body studio-helper-form" });
  const back = h("action-button", { variant: "link", class: "studio-step-back", hidden: true, "aria-keyshortcuts": "Alt+ArrowLeft", onClick: () => showForm({ focus: true }) }, glyph("‹ "), say("found.back"));
  const close_ = h("action-button", { variant: "secondary", onClick: () => close() }, say("helper.close"));
  const useAllLabel = h("span", {});
  const useAll = h("action-button", { hidden: true, onClick: () => found.useAll() }, useAllLabel);
  const element = h("side-sheet", { label: say("helper.name"), side: "right", class: "studio-ready-sheet studio-helper-sheet" },
    heading, back, status, formHost, h("div", { slot: "actions", class: "studio-ready-actions" }, close_, useAll));
  trapFocus(element, () => element.open);
  element.addEventListener("openchange", (event) => { if (event.target === element && !event.detail) finish(); });
  element.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (step === "found") { if (!useAll.hidden) found.useAll(); } else read();
    }
    if (event.altKey && event.key === "ArrowLeft" && step === "found") { event.preventDefault(); showForm({ focus: true }); }
  });

  const found = createFound({
    write,
    closeAndShow: (fn) => { close({ refocus: false }); requestAnimationFrame(() => requestAnimationFrame(fn)); },
    changed: () => { paintFooter(); write.changedLine(); },
  });
  found.element.hidden = true;
  status.after(found.element);
  const goes = createGoesBox();
  const postNote = createPostNote({ api, path: () => write.path(), onSaved: () => { catalog = null; loadCatalog().then(paintGoes); } });

  let opener = null;
  let shown = false;
  let step = "form"; // "form" | "found"
  let helper = null; // assistant/status
  let loading = false;
  let catalog = null; // assistant/context?content=none
  let skills = null;
  let target = null; // what she had selected when the sheet opened
  let reading = null; // { turn, controller, timer, sent }
  let turn = 0;
  let finishedClosed = false;
  let lastWords = ""; // what the last read said (nothing found, or what went wrong)
  let lastProblem = null;
  const choice = { read: "whole", look: new Set(["copy"]), others: new Set(), notes: true, voice: false, extra: new Set(), post: "" };
  let looked = false; // her look-for choices were set from this post's defaults once

  const online = () => globalThis.navigator?.onLine !== false;
  const company = () => companyName(helper || {});
  const state = () => helperState(helper, { online: online(), loading: loading && !helper });

  // ---- what she chose, and the request it makes
  function chosen() {
    const form = write.form();
    const guide = catalog ? voiceGuideOf(catalog) : null;
    const reads = passageFor(target, choice.read, form);
    const scope = scopeOf(reads.choice);
    const look = lookForChoices(skills || [], { kind: write.kind() }, guide, scope);
    const ticked = look.choices.filter((c) => choice.look.has(c.id)).map((c) => c.id);
    const skillIds = skillsFor(ticked, scope, skills || [], look.others.filter((o) => o.fits && choice.others.has(o.id)).map((o) => o.id));
    const contextIds = defaultContextIds(catalog || {}, { useNotes: choice.notes, soundLikeMe: choice.voice && Boolean(guide), extra: [...choice.extra, ...(choice.post ? [choice.post] : [])] });
    const request = reviewRequest({ form, passage: reads.passage, skillIds, contextIds });
    const samples = voiceBudget(catalog?.voiceSamples || [], new Set(contextIds), catalog?.voiceBudget || undefined);
    return { form, guide, reads, scope, look, ticked, skillIds, contextIds, request, samples };
  }

  /** Why Read it over can't go yet, in her words, or "". */
  function waits(c) {
    if (!online()) return say("helper.noSignal");
    if (c.reads.error === "too-long") return say("helper.tooMuch");
    if (c.reads.error === "empty") return say("helper.nothingThere");
    if (!c.skillIds.length) return say("helper.lookNone");
    if (c.samples.over) return say("helper.budgetOver");
    return "";
  }

  // ---- the exact words that go (Word for word)
  async function exactWords(c) {
    const parts = [say("helper.wfwTitle", { title: c.request.source.title })];
    if (c.reads.passage) parts.push("", say("helper.wfwReading"), c.reads.text);
    parts.push("", say("helper.wfwWords"), c.request.source.markdown);
    const lines = detailLines(c.request.source.metadata);
    if (lines.length) parts.push("", say("helper.wfwDetails"), ...lines);
    const info = whatGoes(c.request, catalog || {}, helper || {}, { skills: skills || [] });
    for (const item of info.sent) {
      let text = "";
      try {
        text = String((await api.get(`assistant/context/item?id=${encodeURIComponent(item.id)}`))?.content ?? "");
      } catch {
        text = say("helper.wfwCant");
      }
      parts.push("", say("helper.wfwNote", { name: item.label }), text.trimEnd());
    }
    return parts.join("\n");
  }

  // ---- step 1: the form
  let parts = null; // the controls of the form, built once the helper is known to be ready

  function buildForm() {
    const c = chosen();
    const readHelp = h("p", { class: "studio-help", id: "studio-helper-read-help", "aria-live": "polite" });
    const group = `studio-helper-read-${++uid}`;
    const radio = (value, label) => {
      const id = `${group}-${value}`;
      const input = h("input", { type: "radio", name: group, id, value, class: "studio-tick" });
      input.checked = choice.read === value;
      input.addEventListener("change", () => { if (input.checked) { choice.read = value; repaint(); } });
      return h("div", { class: "studio-choice" }, input, h("label", { for: id, text: label }));
    };
    const reads = h("fieldset", { class: "studio-field-group studio-choices", "aria-describedby": "studio-helper-read-help" }, h("legend", { text: say("helper.whatToRead") }),
      radio("whole", say("helper.whole")),
      target && target.words > 0 ? radio("selected", target.words === 1 ? say("helper.selectedOne") : say("helper.selectedCount", { count: target.words.toLocaleString("en-US") })) : null,
      target ? radio("part", say("helper.part")) : null,
      readHelp);
    const lookError = h("p", { class: "studio-help studio-row-note", id: "studio-helper-look-help", "aria-live": "polite" });
    const lookList = h("div", {});
    const look = h("fieldset", { class: "studio-field-group studio-choices", "aria-describedby": "studio-helper-look-help" }, h("legend", { text: say("helper.lookFor") }), lookList, lookError);
    const voice = h("toggle-switch", { label: say("helper.soundLikeMe"), checked: choice.voice, hidden: !c.guide, onCheckedchange: (e) => { choice.voice = Boolean(e.detail ?? voice.checked); repaint(); } });
    const notes = h("toggle-switch", { label: say("helper.useNotes"), checked: choice.notes, onCheckedchange: (e) => { choice.notes = Boolean(e.detail ?? notes.checked); repaint(); } });
    const go = h("action-button", { class: "studio-helper-go", onClick: () => read() }, say("helper.readOver"));
    const waitsNote = h("p", { class: "studio-help", id: "studio-helper-waits", "aria-live": "polite" });
    const stop = h("action-button", { variant: "secondary", size: "sm", hidden: true, onClick: () => stopWaiting() }, say("helper.stopWaiting"));

    // More help
    const suggestGoes = h("p", { class: "studio-help", id: "studio-helper-suggest-goes" });
    const suggestNotes = h("p", { class: "studio-help" });
    const suggest = h("toggle-switch", { label: say("suggest.toggle"), checked: write.suggest.isOn(), "aria-describedby": "studio-helper-suggest-goes", onCheckedchange: (e) => write.suggest.set(Boolean(e.detail ?? suggest.checked)) });
    const writeUp = write.isJob() && write.canWriteUp() ? h("action-button", { variant: "secondary", onClick: (e) => { const from = opener; close({ refocus: false }); write.writeUp(from || e.currentTarget); } }, say("helper.writeUp")) : null;

    // For {helper}: every other skill, anything else to send, and what the request carries.
    const otherSkills = h("div", {});
    const alsoSend = h("div", {});
    const budget = h("p", { class: "studio-help", "aria-live": "polite" });
    const sends = h("ul", { class: "studio-help studio-mono studio-helper-sends" });
    const billed = h("p", { class: "studio-help", text: say("suggest.billed") });
    const details = h("details", { class: "studio-ready-details studio-helper-details" }, h("summary", { text: say("common.forHelper") }),
      h("h4", { text: say("helper.otherSkills") }), otherSkills, h("h4", { text: say("helper.alsoSend") }), alsoSend, budget, sends, billed);

    fill(formHost, 
      h("section", { class: "studio-ready-group" }, h("h3", { text: say("helper.readOver") }), reads, look, voice, notes, goes.element, waitsNote,
        h("div", { class: "studio-helper-run" }, go, stop)),
      h("section", { class: "studio-ready-group" }, h("h3", { text: say("helper.moreHelp") }), suggestGoes, suggestNotes, suggest, postNote.element, writeUp),
      details);
    parts = { reads, readHelp, lookList, lookError, voice, notes, go, waitsNote, stop, suggest, suggestGoes, suggestNotes, otherSkills, alsoSend, budget, sends };
    goes.words(() => exactWords(chosen()));
    paintExtras();
    repaint();
  }

  /** The pickers under For {helper}: built from the catalog, redrawn only when it changes. */
  function paintExtras() {
    if (!parts) return;
    const texts = [...(catalog?.references || []), ...(catalog?.documents || []).filter((doc) => doc.contextType === "reference")].filter((doc) => doc.exists && doc.valid);
    const samples = (catalog?.voiceSamples || []).filter((doc) => doc.exists && doc.valid);
    const posts = (catalog?.postSnapshots || []).filter((doc) => doc.valid && doc.path !== write.path());
    const pick = (doc) => tick(String(doc.title || doc.name || doc.path || doc.id), choice.extra.has(doc.id), (on) => { if (on) choice.extra.add(doc.id); else choice.extra.delete(doc.id); repaint(); }).element;
    const post = posts.length ? h("select-field", {
      label: say("helper.alsoPost"), value: choice.post,
      options: [{ value: "", label: say("helper.alsoNone") }, ...posts.slice(0, 500).map((doc) => ({ value: doc.id, label: String(doc.path || doc.name) }))],
      onValuechange: () => { choice.post = String(post.value || ""); repaint(); },
    }) : null;
    fill(parts.alsoSend, ...texts.map(pick), ...samples.map(pick), post, !texts.length && !samples.length && !post ? h("p", { class: "studio-help", text: say("helper.alsoNone") }) : null);
  }

  /** Everything that follows her choices: which rows show, what goes, whether the button can go. */
  function repaint() {
    if (!parts) return;
    const c = chosen();
    // What to look for: only the choices that fit what is read. The boxes are drawn again only
    // when the choices themselves change (what is read changed), never under her finger.
    const lookKey = JSON.stringify([c.look.choices.map((item) => item.id), c.look.others.map((item) => [item.id, item.fits])]);
    if (lookKey !== parts.lookKey) {
      parts.lookKey = lookKey;
      fill(parts.lookList, ...c.look.choices.map((item) => tick(item.label, choice.look.has(item.id), (on) => { if (on) choice.look.add(item.id); else choice.look.delete(item.id); repaint(); }).element));
      fill(parts.otherSkills, ...c.look.others.map((item) => {
        const one = tick(item.label, choice.others.has(item.id) && item.fits, (on) => { if (on) choice.others.add(item.id); else choice.others.delete(item.id); repaint(); }, { help: item.fits ? "" : say("helper.skillNoFit") });
        one.input.disabled = !item.fits;
        return one.element;
      }), c.look.others.length ? null : h("p", { class: "studio-help", text: say("helper.alsoNone") }));
    }
    parts.voice.hidden = !c.guide;
    parts.notes.hidden = !notesPresent(catalog || {}).length;
    parts.readHelp.textContent = c.reads.error === "too-long" ? say("helper.tooMuch") : c.reads.error === "empty" ? say("helper.nothingThere") : c.reads.label || "";
    const why = waits(c);
    parts.lookError.textContent = !c.skillIds.length ? say("helper.lookNone") : "";
    parts.waitsNote.textContent = why && why !== parts.readHelp.textContent && why !== parts.lookError.textContent ? why : "";
    innerAria(parts.go, { "aria-disabled": why ? "true" : null, "aria-describedby": why ? "studio-helper-waits studio-helper-read-help studio-helper-look-help" : null });
    parts.budget.textContent = c.samples.samples ? say("helper.budget", {
      samples: c.samples.samples, maxSamples: c.samples.budget.samples, letters: c.samples.characters.toLocaleString("en-US"), maxLetters: Number(c.samples.budget.characters).toLocaleString("en-US"),
    }) : "";
    paintGoes(c);
  }

  function paintGoes(c = parts ? chosen() : null) {
    if (!parts || !c) return;
    const info = whatGoes(c.request, catalog || {}, helper || {}, { skills: skills || [] });
    goes.set({ heading: info.heading, lines: info.lines, never: info.never });
    fill(parts.sends, ...info.details.map((line) => h("li", { text: line })));
    parts.suggestGoes.textContent = say("suggest.what", { company: info.company });
    const notes = info.sent.filter((item) => item.kind === "note" || item.kind === "voice").map((item) => item.label);
    parts.suggestNotes.textContent = notes.length ? say("suggest.whatNotes", { list: notes.join(", ") }) : "";
    parts.suggestNotes.hidden = !notes.length;
  }

  function paintStatus() {
    const s = state();
    if (reading) return;
    const spinner = s.state === "checking" ? h("loading-spinner", { size: "sm", label: "" }) : null;
    // No signal is said whatever happened before it. Not set up: the words are the empty state
    // below, and the status only says what just happened.
    const words = s.state === "no-signal" ? stateWords(s) : lastWords || (s.state === "off" ? "" : stateWords(s));
    fill(status, spinner, h("span", { text: words }));
    if (s.state !== "no-signal" && (lastProblem?.details.length || lastProblem?.setup)) {
      status.append(h("details", { class: "studio-help studio-ready-nothing" }, h("summary", { text: say("common.forHelper") }),
        ...lastProblem.details.map((line) => h("p", { text: line })),
        lastProblem.setup ? h("action-button", { variant: "link", onClick: () => goSetup() }, say("helper.goToSetup")) : null));
    }
  }

  function goSetup() {
    close({ refocus: false });
    write.go("#/helper?setup=1");
  }

  /** Draw step 1 for the state the helper is in. */
  function showForm({ focus = false } = {}) {
    step = "form";
    heading.textContent = say("helper.name");
    element.label = say("helper.name");
    back.hidden = true;
    found.element.hidden = true;
    formHost.hidden = false;
    const s = state();
    if (s.state === "checking") {
      parts = null;
      fill(formHost, h("skeleton-block", { lines: 6 }));
    } else if (s.state === "off") {
      parts = null;
      fill(formHost, h("empty-state", { heading: say("helper.offHeading") }, say("helper.offText")),
        h("details", { class: "studio-ready-details" }, h("summary", { text: say("common.forHelper") }), h("p", { text: reasonWords(s.reason) }),
          h("action-button", { variant: "secondary", onClick: () => goSetup() }, say("helper.setItUp"))));
    } else {
      buildForm();
    }
    paintStatus();
    paintFooter();
    if (focus) requestAnimationFrame(() => heading.focus());
  }

  function showFound({ focus = true } = {}) {
    step = "found";
    finishedClosed = false;
    heading.textContent = say("found.heading");
    element.label = say("found.heading");
    back.hidden = false;
    formHost.hidden = true;
    found.element.hidden = false;
    status.replaceChildren();
    found.redraw();
    paintFooter();
    write.changedLine();
    if (focus) requestAnimationFrame(() => found.status.focus());
  }

  function paintFooter() {
    const can = step === "found" ? found.applicable() : 0;
    useAll.hidden = can < 2;
    useAllLabel.textContent = can >= 2 ? say("found.useAll", { count: can }) : "";
  }

  // ---- reading it over
  async function read() {
    if (reading || !parts || state().state !== "ready") return;
    const c = chosen();
    if (waits(c)) { repaint(); (parts.reads.querySelector("input:checked") || parts.go.querySelector("button"))?.focus(); return; }
    const mine = ++turn;
    lastWords = "";
    lastProblem = null;
    const controller = new AbortController();
    reading = { turn: mine, controller, sent: c.request.source };
    parts.go.loading = true;
    fill(status, h("loading-spinner", { size: "sm", label: "" }), h("span", { text: say("helper.reading") }));
    reading.timer = setTimeout(() => {
      if (reading?.turn !== mine) return;
      fill(status, h("loading-spinner", { size: "sm", label: "" }), h("span", { text: say("helper.stillReading") }));
      if (parts) parts.stop.hidden = false;
    }, STILL_MS);
    write.changedLine();
    let reply = null;
    let problem = null;
    try {
      // `confirmed` is said here and nowhere else: this runs only from her press of Read it over, on
      // the sheet that lists what goes. The server refuses a review that doesn't say it.
      reply = await api.call("POST", "assistant/review", { json: { ...c.request, confirmed: true }, signal: controller.signal });
    } catch (error) {
      problem = helperProblem(error, { company: company(), task: "review" });
    }
    // An answer that can't be read as one is the same as one that made no sense.
    if (!problem && (!reply || typeof reply !== "object" || !Array.isArray(reply.findings))) problem = helperProblem({ status: 502, data: { code: "invalid-result" } }, { company: company(), task: "review" });
    if (mine !== turn) return; // she stopped waiting: the answer, whenever it comes, is not used
    clearTimeout(reading.timer);
    reading = null;
    if (parts) { parts.go.loading = false; parts.stop.hidden = true; }
    if (problem) {
      lastWords = problem.words;
      lastProblem = problem;
      if (problem.off) { helper = { ...(helper || {}), configured: false }; lastProblem = null; await loadStatus(); showForm(); status.focus(); write.changedLine(); return; }
      paintStatus();
      write.changedLine();
      if (shown) status.focus();
      return;
    }
    // What came back is untrusted: only well-formed suggestions are kept, in post order.
    const findings = orderFindings(reply?.findings);
    const now = write.form();
    const changedWhile = sourceChanged(c.request.source, reviewRequest({ form: now }).source);
    if (!findings.length) {
      found.clear();
      lastWords = changedWhile ? `${say("helper.foundNothing")} ${say("helper.changedWhile")}` : say("helper.foundNothing");
      paintStatus();
      write.changedLine();
      if (shown) status.focus();
      return;
    }
    found.show(findings, { changedWhile });
    if (shown) showFound();
    else { finishedClosed = true; toast(say("helper.finishedToast")); write.changedLine(); }
  }

  function stopWaiting() {
    if (!reading) return;
    turn += 1;
    clearTimeout(reading.timer);
    reading.controller.abort();
    reading = null;
    if (parts) { parts.go.loading = false; parts.stop.hidden = true; }
    lastWords = say("helper.stopped");
    lastProblem = { details: [say("helper.stoppedDetail")], setup: false };
    paintStatus();
    write.changedLine();
    status.focus();
  }

  // ---- loading
  async function loadStatus() {
    loading = true;
    try {
      helper = await api.get("assistant/status");
    } catch (error) {
      if (error?.status !== 0) helper = { configured: false, reason: "" };
    } finally {
      loading = false;
    }
  }

  async function loadCatalog() {
    try {
      const path = write.path();
      catalog = await api.get(`assistant/context?content=none${path ? `&path=${encodeURIComponent(path)}` : ""}`);
    } catch {
      catalog = catalog || {};
    }
  }

  async function loadSkills() {
    if (skills) return;
    try {
      skills = (await api.get("assistant/skills"))?.skills || [];
    } catch {
      skills = null;
    }
  }

  // ---- opening and closing
  async function open({ from = document.activeElement, part = "" } = {}) {
    opener = from;
    // What she had selected, before anything else moves focus.
    target = write.target();
    // With words selected, those are what is read; else the whole post.
    choice.read = target?.words > 0 ? "selected" : "whole";
    if (!element.isConnected) document.body.append(element);
    element.open = true;
    shown = true;
    const hasResults = found.has() && (finishedClosed || step === "found");
    if (hasResults && !part) { showFound(); }
    else { showForm(); requestAnimationFrame(() => requestAnimationFrame(() => heading.focus())); }
    await Promise.all([loadStatus(), loadCatalog(), loadSkills()]);
    if (!shown) return;
    if (!looked && skills) {
      looked = true;
      const guide = voiceGuideOf(catalog || {});
      choice.look = new Set(lookForChoices(skills, { kind: write.kind() }, guide, "document").choices.filter((c) => c.on).map((c) => c.id));
    }
    if (step === "form" && !reading) showForm();
    if (part === "note") postNote.open();
    if (part === "suggest" && parts) parts.suggest.querySelector("button, input")?.focus();
    write.changedLine();
  }

  function finish({ refocus = true } = {}) {
    if (!shown) return;
    shown = false;
    postNote.flush();
    const target_ = opener;
    opener = null;
    write.changedLine();
    if (refocus && target_?.isConnected) requestAnimationFrame(() => (target_.querySelector?.("button, a, input") || target_).focus?.());
  }

  function close(options) { if (!shown) return; element.open = false; finish(options); }

  write.suggest.onChange((on) => { if (parts?.suggest && parts.suggest.checked !== on) parts.suggest.checked = on; });
  addEventListener("online", () => { if (shown && step === "form") showForm(); });
  addEventListener("offline", () => { lastWords = ""; lastProblem = null; if (shown && step === "form") { paintStatus(); repaint(); } });

  return {
    element,
    open,
    close,
    get isOpen() { return shown; },
    /** For the side card: what the helper is doing or has left. */
    line() {
      if (reading) return { kind: "reading" };
      if (!online()) return { kind: "no-signal" };
      if (found.has() && finishedClosed) return { kind: "finished", count: found.left() };
      if (found.has()) return { kind: "left", count: found.left() };
      return { kind: "idle" };
    },
    /** Leaving Write: a note being typed is saved first; nothing else of hers is here to lose. */
    async leave() {
      turn += 1;
      reading?.controller.abort();
      await postNote.flush();
      postNote.stop();
      if (shown) close({ refocus: false });
      return true;
    },
  };
}

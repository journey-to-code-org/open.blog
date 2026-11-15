// Your voice guide's two steps (Studio R9), shared by #/voice/guide and Getting started (R9b).
// Step 1: the pieces ticked for her, and exactly what goes to which company, above the one button
// that sends it. Step 2: what the helper noticed, line by line, each quoting her own words; for
// each change she chooses Keep what you had or Use the new one; nothing is saved until she says.
//
// Nothing leaves before she presses the button; what the box lists is computed from her ticks
// only. Statements, quotes and headings come from a helper: they are placed as text, quotes in
// <bdi>, clipped with Show all. The helper never edits a piece, and its reply is never applied to
// anything but the guide she then approves.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { innerAria } from "./inner-button.js";
import { createGoesBox } from "./helper-goes.js";
import { createDidLine } from "./did-line.js";
import { clip, companyName, helperProblem } from "./helper-rules.js";
import { wordsText } from "./voice-rules.js";
import {
  defaultGuidePieces, guideBudget, guideContent, guideHasNews, guideProblem, guideSaveTarget, guideSelection, guideWhatGoes, voiceGuideCheckNote, voiceGuideDiffLines,
  voiceGuidePendingChanges, voiceGuidePortableNote, voiceGuideSaveRequest, voiceGuideTraitParts,
} from "./voice-guide-rules.js";

const STILL_MS = 20000;
let uid = 0;

/** Text from a helper, clipped at 600 letters with Show all. */
function clipped(text, tag = "span") {
  const whole = String(text ?? "");
  const cut = clip(whole, 600);
  const node = h(tag, { text: cut.text });
  if (!cut.clipped) return node;
  const all = h("button", { type: "button", class: "studio-link-button", onClick: () => { node.textContent = whole; all.remove(); } }, say("voice.showAll"));
  return h("span", {}, node, " ", all);
}

/**
 * `{ element, load(), isDirty(), leave(), keys(key), step() }`.
 *
 * - `status`: `assistant/status` (the company is named from it).
 * - `pieces`: `guidePieces(...)`; `catalog`: the light context catalog (budget, the guide's descriptor).
 * - `guide`: `{ id, visibility }` of the guide that exists, or null.
 * - `words`: `{ from, propose, proposeNew, row(piece), saved, practiceSave }` to rename the list and the button (R9b's stories).
 * - `practice`: propose for real, never save (R9b's practice run); `extra` rides on the request.
 * - `barStart`: nodes put at the start of step 1's bar (R9b's Back and Not now).
 * - `onSaved(visibility)`, `onDiscarded()`, `onProblem(problem)`.
 */
export async function createGuideSteps({ api, status, pieces = [], catalog = {}, guide = null, words = {}, practice = false, extra = {}, barStart = [], onSaved = () => {}, onDiscarded = () => {}, onProblem = () => {}, onStep = () => {} }) {
  await use("action-button", "alert-banner", "status-badge", "loading-spinner", "modal-dialog");
  const id = `studio-guide-${++uid}`;
  const company = companyName(status || {});
  const budget = guideBudget(catalog);
  let ticked = new Set(defaultGuidePieces(pieces, budget));
  let proposal = null;
  let choices = {};
  let edited = null; // {helper}'s own text, once typed in details
  let waiting = null;
  let step = "choose";

  const stage = h("div", { class: "studio-guide-steps" });
  const said = createDidLine();
  const element = h("div", { class: "studio-guide" }, stage, said.element);
  const helperDetails = (lines) => (lines.filter(Boolean).length ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), ...lines.filter(Boolean).map((line) => h("p", { class: "studio-mono", text: String(line) }))) : null);

  // ---- step 1: choose pieces, see what goes
  function showChoose({ focus = false } = {}) {
    step = "choose";
    onStep(step);
    proposal = null;
    choices = {};
    edited = null;
    const goes = createGoesBox();
    const problem = h("p", { class: "studio-field-error", id: `${id}-problem`, role: "alert", hidden: true });
    const working = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const propose = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => send() }, guide ? (words.propose || say("voice.guidePropose")) : (words.proposeNew || say("voice.guideProposeNew")));
    const list = h("fieldset", { class: "studio-guide-pieces", "aria-describedby": `${id}-help ${id}-problem` },
      h("legend", { text: words.from || say("voice.guideFrom") }),
      ...pieces.map((piece, index) => {
        const box = h("input", { type: "checkbox", class: "studio-tick", id: `${id}-p${index}` });
        box.checked = ticked.has(piece.id);
        box.addEventListener("change", () => { if (box.checked) ticked.add(piece.id); else ticked.delete(piece.id); paint(); });
        const label = words.row ? words.row(piece) : say("voice.guideRow", { title: piece.title, stage: piece.stage === "polished" ? say("voice.guideStagePolished") : say("voice.guideStageRough"), words: wordsText(piece.words) });
        return h("label", { class: "studio-tick-label", for: `${id}-p${index}` }, box, h("span", { text: label }));
      }));
    const selection = () => guideSelection(pieces, [...ticked], budget);
    function paint() {
      const chosen = selection();
      const info = guideWhatGoes(chosen, Boolean(guide), company);
      goes.set(info);
      problem.textContent = chosen.over ? say("voice.guideOver") : "";
      problem.hidden = !chosen.over;
      // Never `disabled`: pressed with too many or none, it says why.
      innerAria(propose, { "aria-disabled": chosen.over || chosen.none ? "true" : null });
    }
    // Word for word: the text of each ticked piece and of the guide, read only, asked for when opened.
    goes.words(async () => {
      const ids = [...selection().ids, ...(guide ? [guide.id] : [])];
      const texts = [];
      for (const contextId of ids) {
        const item = await api.get(`assistant/context/item?id=${encodeURIComponent(contextId)}`);
        texts.push(`${item.name || contextId}\n\n${item.content ?? ""}`);
      }
      return texts.join("\n\n----\n\n");
    });

    async function send() {
      const chosen = selection();
      if (chosen.none) { problem.textContent = say("voice.guideNoneTicked"); problem.hidden = false; list.querySelector("input")?.focus(); return; }
      if (chosen.over) { problem.textContent = say("voice.guideOver"); problem.hidden = false; list.querySelector("input")?.focus(); return; }
      if (waiting) return;
      const turn = {};
      waiting = turn;
      propose.loading = true;
      fill(working, h("loading-spinner", { size: "sm", "aria-hidden": "true" }), h("span", { text: ` ${say("voice.guideWorking")}` }));
      const still = setTimeout(() => {
        if (waiting !== turn) return;
        fill(working, h("span", { text: `${say("voice.guideStill")} ` }), h("button", { type: "button", class: "studio-link-button", onClick: () => {
          waiting = null;
          propose.loading = false;
          working.textContent = say("voice.guideStopped");
        } }, say("common.stopWaiting")));
      }, STILL_MS);
      try {
        const reply = await api.post("assistant/voice-guide", { sampleIds: chosen.ids, ...(guide ? { guide: guide.visibility } : {}), ...extra });
        if (waiting !== turn) return; // she stopped waiting: nothing is shown, nothing was saved
        proposal = reply;
        showResult();
      } catch (error) {
        if (error?.status === 401) throw error;
        if (waiting !== turn) return;
        const own = guideProblem(error);
        const found = helperProblem(error, { company });
        const sentence = own || found.words;
        fill(working, h("span", { text: sentence }), helperDetails([found.code ? `${found.code} ${error?.status || ""}` : "", ...found.details]));
        onProblem({ ...found, words: sentence });
      } finally {
        clearTimeout(still);
        if (waiting === turn) { waiting = null; propose.loading = false; }
      }
    }
    currentSend = send;
    paint();
    fill(stage,
      list,
      h("p", { class: "studio-help", id: `${id}-help`, text: say("voice.guideFromHelp") }),
      problem, goes.element, working,
      h("div", { class: "studio-write-bar" }, ...barStart, propose));
    if (focus) requestAnimationFrame(() => list.querySelector("input")?.focus());
  }
  let currentSend = () => {};

  // ---- step 2: what the helper noticed
  function showResult() {
    step = "result";
    onStep(step);
    const merge = proposal.merge || {};
    const pendingNote = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const saveLabel = practice ? (words.practiceSave || say("voice.guideSave")) : say("voice.guideSave");
    const save = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => saveTo(guideSaveTarget(proposal)) }, saveLabel);
    const discard = h("action-button", { variant: "secondary", onClick: () => { said.tell(say("voice.guideDiscarded")); showChoose({ focus: true }); onDiscarded(); } }, say("voice.guideDiscard"));
    const editor = h("textarea", { class: "studio-guide-text studio-mono", rows: "14", spellcheck: "false", id: `${id}-text` });
    editor.addEventListener("input", () => { edited = editor.value; });
    const wait = h("p", { class: "studio-help", text: say("voice.guideEditWait") });
    const detailSaves = ["private", "portable"].map((visibility) => {
      const blocked = proposal.targets?.[visibility]?.valid === false || (visibility === "portable" && proposal.portableAllowed === false);
      return { visibility, blocked, button: h("action-button", { variant: "secondary", size: "sm", onClick: () => saveTo(visibility) }, visibility === "private" ? say("voice.savePrivate") : say("voice.savePortable")) };
    });

    function refresh() {
      const pending = voiceGuidePendingChanges(merge, choices);
      const ready = pending === 0;
      if (ready && edited === null) editor.value = guideContent(proposal, choices) ?? "";
      editor.readOnly = !ready;
      wait.hidden = ready;
      pendingNote.textContent = pending ? say("voice.guidePending", { n: pending }) : merge.changes ? say("voice.guideDecided") : guideHasNews(proposal) ? "" : say("voice.guideNothingNew");
      innerAria(save, { "aria-disabled": !ready || practice ? "true" : null });
      for (const item of detailSaves) item.button.disabled = !ready || item.blocked || practice;
    }

    const tag = (status) => {
      const label = status === "added" ? say("voice.tagNew") : status === "unchanged" ? say("voice.tagSame") : status === "changed" ? say("voice.tagChanged") : say("voice.tagKept");
      return h("status-badge", { variant: status === "added" ? "success" : status === "changed" ? "warning" : "neutral" }, label);
    };
    const traitLine = (trait, check) => {
      const parts = voiceGuideTraitParts(trait);
      const note = voiceGuideCheckNote(check);
      return [
        clipped(`${parts.statement}:`),
        " ", h("bdi", { class: "studio-guide-quote" }, clipped(`“${parts.quote}”`)),
        parts.piece ? h("span", { class: "studio-meta", text: ` ${say("voice.traitFrom", { piece: clip(parts.piece, 80).text })}` }) : null,
        parts.oneSample ? h("span", { class: "studio-meta", text: ` ${say("voice.traitOne")}` }) : null,
        note ? h("span", { class: "studio-guide-check", text: ` ${note}` }) : null,
      ];
    };
    const item = (entry) => {
      if (entry.status === "changed") {
        const name = `${id}-change-${entry.change}`;
        const option = (value, label, trait, check) => {
          const optionId = `${name}-${value}`;
          const radio = h("input", { type: "radio", id: optionId, name, value, class: "studio-tick" });
          radio.checked = choices[entry.change] === value;
          radio.addEventListener("change", () => { choices[entry.change] = value; refresh(); });
          return h("label", { class: "studio-tick-label studio-guide-option", for: optionId }, radio, h("span", {}, h("strong", { text: `${label}: ` }), ...traitLine(trait, check)));
        };
        return h("li", { class: "studio-guide-trait" }, h("fieldset", { class: "studio-guide-change" },
          h("legend", {}, clipped(say("voice.choiceLegend", { statement: String(entry.current?.statement ?? "") }))),
          option("current", say("voice.choiceKeep"), entry.current, entry.check), option("proposed", say("voice.choiceTake"), entry.proposed, null)));
      }
      const trait = entry.status === "added" ? entry.proposed : entry.current;
      return h("li", { class: "studio-guide-trait" }, tag(entry.status), " ", ...traitLine(trait, entry.check));
    };
    const unknown = (merge.unknown || []).length ? h("section", { class: "studio-section" },
      h("h3", { text: say("voice.guideUnknown") }),
      h("ul", { class: "studio-guide-traits" }, merge.unknown.map((entry) => h("li", { class: "studio-guide-trait" }, tag(entry.status === "added" ? "added" : "kept"), " ", clipped(entry.text))))) : null;
    const diff = voiceGuideDiffLines(proposal.diff);
    const moveSlot = h("div", {});
    const oneSample = (merge.sections || []).flatMap((s) => s.traits || []).map((t) => (t.status === "added" ? t.proposed : t.current)).filter((t) => t?.oneSample).map((t) => clip(String(t.statement), 80).text);
    const heading = h("h2", { class: "studio-question", tabindex: "-1", text: say("voice.guideResultHeading") });
    fill(stage,
      h("action-button", { variant: "link", class: "studio-step-back", "aria-keyshortcuts": "Alt+ArrowLeft", onClick: () => backToChoose() }, `‹ ${say("voice.guideBack")}`),
      heading,
      h("p", { class: "studio-help", role: "status", text: say("voice.guideResultNote") }),
      merge.freeText ? h("p", { class: "studio-help", text: say("voice.guideFreeKept") }) : null,
      merge.ownSections?.length ? h("p", { class: "studio-help", text: say("voice.guideOwnSections", { sections: merge.ownSections.map((s) => clip(String(s), 60).text).join(", ") }) }) : null,
      ...(merge.sections || []).map((section) => h("section", { class: "studio-section" }, h("h3", {}, clipped(section.heading)), h("ul", { class: "studio-guide-traits" }, (section.traits || []).map(item)))),
      unknown, pendingNote,
      h("details", { class: "studio-voice-details" }, h("summary", { text: say("common.forHelper") }),
        h("h4", { text: say("voice.guideDiff") }),
        diff.length ? h("pre", { class: "studio-guide-diff", tabindex: "0" }, diff.map((line) => h("span", { "data-diff": line.kind, text: `${line.text}\n` }))) : null,
        h("label", { class: "studio-voice-label", for: `${id}-text`, text: say("voice.guideEditLabel") }), editor, wait,
        h("div", { class: "studio-row" }, ...detailSaves.map((s) => s.button)),
        proposal.portableAllowed === false ? h("p", { class: "studio-help", text: voiceGuidePortableNote(proposal) }) : null,
        h("p", { class: "studio-help", text: say("voice.guideMade", { skill: `${clip(String(proposal.skill?.id || "?"), 60).text} ${clip(String(proposal.skill?.version || ""), 20).text}`.trim(), model: clip(String(proposal.provider?.model || status?.model || "?"), 80).text }) }),
        h("p", { class: "studio-help", text: say("voice.guideProvenance") }),
        oneSample.length ? h("p", { class: "studio-help", text: say("voice.guideOneSample", { list: oneSample.join("; ") }) }) : null,
        moveSlot),
      h("div", { class: "studio-write-bar" }, discard, save));
    currentSend = () => { if (voiceGuidePendingChanges(merge, choices) === 0 && !practice) saveTo(guideSaveTarget(proposal)); };
    refresh();
    requestAnimationFrame(() => heading.focus());

    async function saveTo(visibility) {
      if (practice) return;
      const pending = voiceGuidePendingChanges(merge, choices);
      if (pending) { pendingNote.textContent = say("voice.guidePending", { n: pending }); stage.querySelector(".studio-guide-change input")?.focus(); return; }
      const content = guideContent(proposal, choices, edited);
      const request = voiceGuideSaveRequest(proposal, visibility, content);
      if (!request) { said.tell(visibility === "portable" ? voiceGuidePortableNote(proposal) || say("voice.guideNotSaved") : say("voice.guideNotSaved"), { variant: "problem" }); return; }
      save.loading = true;
      try {
        const reply = await api.put("assistant/context", request);
        const before = proposal.targets?.[visibility]?.exists ? (proposal.current?.exists && proposal.current.visibility === visibility ? proposal.current.content : null) : null;
        const existed = Boolean(proposal.targets?.[visibility]?.exists);
        const etag = reply?.document?.etag ?? null;
        proposal = null;
        guide = { id: `${visibility}:voice`, visibility };
        showChoose();
        said.tell(words.saved || say("voice.guideSaved"), {
          undoLabel: say("voice.undo"),
          // Back as it was: the text before, or no file when there was none.
          undo: existed && typeof before !== "string" ? null : async () => {
            try {
              if (existed) await api.put("assistant/context", { contextType: "voice", visibility, content: before, etag });
              else await api.call("DELETE", "assistant/context", { json: { contextType: "voice", visibility, etag } });
              said.tell(say("voice.guideUndone"));
              onSaved(null);
            } catch (error) {
              if (error?.status === 401) throw error;
              said.tell(say("voice.guideChanged"), { variant: "problem" });
            }
          },
        });
        onSaved(visibility);
      } catch (error) {
        if (error?.status === 401) throw error;
        const found = helperProblem(error, { company });
        said.tell(error?.status === 409 ? say("voice.guideChanged") : found.signal ? found.words : say("voice.guideNotSaved"), { variant: "problem" });
        const lines = helperDetails([`${error?.status || 0}`, ...found.details]);
        if (lines) said.element.append(lines);
      } finally {
        save.loading = false;
      }
    }
  }

  async function backToChoose() {
    if (await leave()) showChoose({ focus: true });
  }

  /** Leaving step 2 without saving asks: what the helper noticed isn't kept anywhere. */
  async function leave() {
    if (step !== "result" || !proposal) return true;
    const choice = await ask({ heading: say("voice.guideLeaveAsk"), text: say("voice.guideLeaveText"),
      choices: [{ label: say("voice.guideLeaveGo"), value: "go", variant: "secondary" }, { label: say("voice.guideLeaveStay"), value: "stay" }], focus: 1 });
    if (choice !== "go") return false;
    proposal = null;
    return true;
  }

  showChoose();
  return {
    element,
    isDirty: () => step === "result" && Boolean(proposal),
    leave,
    step: () => step,
    keys(key) {
      if (key === "enter") { currentSend(); return true; }
      if (key === "back" && step === "result") { backToChoose(); return true; }
      return false;
    },
  };
}

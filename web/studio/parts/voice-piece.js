// A piece's rough draft and its polished copy (Studio R9), shared by Write a piece (after the
// rough draft is saved) and A piece. Lifted from the old Admin's voice-polished.js (ADR 0272,
// 0273): the rough draft is shown, never edited (a plain region: nothing to type into, nothing for
// an extension to attach to); the polished copy is hers to change, with spelling help on, a copy
// of unsaved changes kept on this phone, and a choice when it was changed somewhere else.
//
// New in Studio: Start the copy over applies at once with Undo; Turn it into a post offers Undo;
// where the files are kept, and moving them, sit under For {helper}. All text is placed as text.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { createDidLine } from "./did-line.js";
import { VOICE_LIMITS, byteLength, polishedDirty, voiceProblem, wordCount, wordsText } from "./voice-rules.js";
import { createPolishedDraftStore, polishedKey } from "./voice-copies.js";

let uid = 0;

/**
 * `rough` is the rough draft as the server describes it (`id`, `file`, `title`, `body`, `words`,
 * `visibility`, `path`, `bytes`, `revision`, `promptTitle`); `polished` its saved polished copy,
 * or null (the editor then starts as a copy of the rough draft).
 * Returns `{ element, isDirty(), isBusy(), save(), focus(), keys(key), destroy() }`.
 */
export async function createVoicePiece({ api, user = "", rough, polished = null, storage, go = () => {}, onChange = () => {}, onSaved = () => {}, clock = globalThis }) {
  await use("action-button", "alert-banner", "text-field", "modal-dialog");
  const id = `studio-voice-piece-${++uid}`;
  const drafts = createPolishedDraftStore(polishedKey(user, rough.file), storage);
  let saved = polished;
  let revision = polished?.revision ?? null;
  let baseline = polished ? { title: polished.title, body: polished.body } : { title: rough.title, body: rough.body };
  let busy = false;
  let timer = null;
  let alive = true;

  // ---- the rough draft, read only
  const roughText = h("div", { class: "studio-voice-rough-text", tabindex: "0", role: "region", "aria-label": say("voice.roughRegion"), text: String(rough.body ?? "") });
  const roughSection = h("section", { class: "studio-voice-rough-view", "aria-labelledby": `${id}-rough-h` },
    h("h3", { id: `${id}-rough-h`, text: say("voice.roughHeading") }),
    h("p", { class: "studio-help", text: say("voice.lockedNote") }),
    roughText,
    h("p", { class: "studio-help", text: `${wordsText(rough.words ?? wordCount(rough.body))}.` }));

  // ---- the polished copy
  const title = h("text-field", { label: say("voice.polishTitle"), maxlength: 200, autocomplete: "off", class: "studio-voice-title" });
  const body = h("text-field", { label: say("voice.polishBody"), rows: 12, class: "studio-voice-polish" });
  const count = h("p", { class: "studio-help", id: `${id}-count`, role: "status" });
  const status = createDidLine();
  const restoreSlot = h("div", { class: "studio-banner" });
  const saveButton = h("action-button", { "aria-keyshortcuts": "Control+S Meta+S", onClick: () => save() }, say("voice.polishSave"));
  const reset = h("action-button", { variant: "ghost", onClick: () => startOver() }, say("voice.polishReset"));
  const polishHeading = h("h3", { id: `${id}-polish-h` });
  const makePost = h("action-button", { variant: "secondary", onClick: () => promote() }, say("voice.makePost"));
  const after = h("div", { class: "studio-voice-after", hidden: true }, h("div", { class: "studio-row" }, makePost), h("p", { class: "studio-help", text: say("voice.makePostHelp") }));
  const where = h("div", { class: "studio-voice-where" });
  const details = h("details", { class: "studio-voice-details" }, h("summary", { text: say("common.forHelper") }), where);

  const current = () => ({ title: String(title.value ?? ""), body: String(body.value ?? "") });
  const isDirty = () => polishedDirty(current(), baseline);
  const put = (values) => { title.value = values.title; body.value = values.body; };
  const bodyBox = () => body.querySelector("textarea");
  const focusBody = () => requestAnimationFrame(() => bodyBox()?.focus());

  function paint() {
    const text = current();
    const tooLong = byteLength(text.body) > VOICE_LIMITS.maxDraftBytes;
    body.error = tooLong ? say("voice.polishTooLong") : "";
    const state = isDirty() ? (drafts.inMemoryOnly ? say("voice.polishDirtyMemory") : say("voice.polishDirty")) : saved ? say("voice.polishClean") : say("voice.polishNew");
    count.textContent = `${wordsText(wordCount(text.body))}. ${state}`;
    reset.disabled = text.body === rough.body && text.title === rough.title;
    polishHeading.textContent = saved ? say("voice.polishEditHeading") : say("voice.polishHeading");
    after.hidden = !saved;
  }
  function keepCopy() {
    clock.clearTimeout(timer);
    timer = clock.setTimeout(() => {
      timer = null;
      // An editor taken off the page (signing out, another screen) writes nothing back.
      if (!alive || !body.isConnected) return;
      if (isDirty()) drafts.save({ base: revision, ...current() });
      else drafts.clear();
    }, VOICE_LIMITS.localSaveMs);
  }
  function changed() {
    paint();
    keepCopy();
    onChange(isDirty());
  }
  title.addEventListener("valuechange", changed);
  body.addEventListener("valuechange", changed);

  // ---- start the copy over: at once, with Undo
  function startOver() {
    const before = current();
    if (before.body === rough.body && before.title === rough.title) return;
    put({ title: rough.title, body: rough.body });
    changed();
    status.tell(say("voice.polishResetDone"), { undoLabel: say("voice.undo"), undo: () => { put(before); changed(); status.clear(); focusBody(); } });
    focusBody();
  }

  // ---- a copy of unsaved changes found on this phone
  function offerRestore(copy) {
    const banner = h("alert-banner", { variant: "info", heading: say("voice.restoreHeading") },
      h("p", { text: copy.base === revision ? say("voice.restoreText") : say("voice.restoreTextChanged") }),
      h("div", { class: "studio-row" },
        h("action-button", { onClick: () => {
          put(copy);
          // Changes made on top of an older copy are checked against that one, so a change made
          // somewhere else since is her choice and not an overwrite.
          revision = copy.base;
          fill(restoreSlot);
          paint();
          onChange(isDirty());
          focusBody();
        } }, say("voice.restoreYes")),
        h("action-button", { variant: "secondary", onClick: () => {
          drafts.clear();
          fill(restoreSlot);
          status.tell(say("voice.restoreThrown"), { undoLabel: say("voice.undo"), undo: () => { drafts.save({ base: copy.base, title: copy.title, body: copy.body }); status.clear(); offerRestore(copy); } });
          focusBody();
        } }, say("voice.restoreNo"))));
    fill(restoreSlot, banner);
  }

  // ---- saving
  function applySaved(result, sent) {
    saved = result;
    revision = result.revision;
    baseline = { title: result.title, body: result.body };
    // What she typed while the save was out stays: only an untouched editor takes the saved text.
    const untouched = current().title === sent.title && current().body === sent.body;
    if (untouched) put(baseline);
    fill(restoreSlot);
    if (untouched) drafts.clear();
    else drafts.save({ base: revision, ...current() });
    return untouched;
  }
  async function save() {
    if (busy) return false;
    const sent = current();
    if (byteLength(sent.body) > VOICE_LIMITS.maxDraftBytes) { paint(); focusBody(); return false; }
    if (!sent.body.trim()) { status.tell(say("voice.polishEmpty"), { variant: "problem" }); focusBody(); return false; }
    busy = true;
    saveButton.loading = true;
    try {
      const result = saved
        ? await api.call("PUT", `voice/samples/${encodeURIComponent(saved.id)}`, { json: { revision, ...sent } })
        : await api.post("voice/samples", { roughOf: rough.file, ...sent });
      const untouched = applySaved(result, sent);
      paint();
      onChange(isDirty());
      status.tell(untouched ? say("voice.polishSaved") : say("voice.polishSavedTyping"));
      onSaved(result);
      return untouched;
    } catch (error) {
      if (error?.status === 401) throw error;
      // Whatever went wrong, a copy of the work is on this phone now.
      drafts.save({ base: revision, ...current() });
      const problem = voiceProblem(error);
      if (problem.code === "conflict") await conflict(error.data?.current || null);
      else if (problem.code === "refused" || problem.code === "not-polished") tellProblem(say("voice.cantPolish"), problem);
      else tellProblem(problem.words, problem);
      return false;
    } finally {
      busy = false;
      saveButton.loading = false;
    }
  }
  function tellProblem(words, problem) {
    status.tell(words || say("voice.serverTrouble"), { variant: "problem" });
    if (problem?.details) status.element.append(h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${problem.code}: ${problem.details}` })));
  }

  // ---- the copy was changed somewhere else
  async function conflict(latest) {
    const mine = current();
    const choice = await ask({
      heading: say("voice.conflictHeading"),
      text: latest ? say("voice.conflictText", { mine: wordCount(mine.body), theirs: wordCount(latest.body) }) : say("voice.conflictGone"),
      choices: latest
        ? [{ label: say("voice.conflictMine"), value: "mine" }, { label: say("voice.conflictTheirs"), value: "theirs", variant: "secondary" }, { label: say("voice.conflictKeep"), value: "keep", variant: "secondary" }]
        : [{ label: say("voice.conflictKeep"), value: "keep" }],
      focus: latest ? 2 : 0,
    });
    if (choice === "mine" && latest) {
      revision = latest.revision;
      saved = latest;
      busy = false;
      await save();
    } else if (choice === "theirs" && latest) {
      const before = { saved, revision, baseline, text: mine };
      saved = latest;
      revision = latest.revision;
      baseline = { title: latest.title, body: latest.body };
      put(baseline);
      drafts.clear();
      paint();
      onChange(isDirty());
      status.tell(say("voice.conflictUsedSaved"), { undoLabel: say("voice.undo"), undo: () => { put(before.text); changed(); status.clear(); focusBody(); } });
    } else {
      if (!latest) { saved = null; revision = null; }
      paint();
      focusBody();
    }
  }

  // ---- turn it into a post
  async function promote() {
    if (!saved) return;
    if (isDirty()) { status.tell(say("voice.makePostSaveFirst"), { variant: "problem" }); saveButton.querySelector("button")?.focus(); return; }
    makePost.loading = true;
    status.tell(say("voice.makingPost"));
    try {
      const made = await api.post(`voice/samples/${encodeURIComponent(saved.id)}/promote`, {});
      const edit = String(made.editPath || "");
      status.tell(say("voice.madePost"), {
        link: { label: say("voice.openPost"), href: `#/write/${encodeURIComponent(edit)}` },
        undoLabel: say("voice.undo"),
        undo: async () => {
          try {
            await api.call("DELETE", `document?path=${encodeURIComponent(edit)}`);
            status.tell(say("voice.madePostUndone"));
          } catch (error) {
            if (error?.status === 401) throw error;
            tellProblem(say("voice.serverTrouble"), voiceProblem(error));
          }
        },
      });
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = voiceProblem(error);
      if (problem.code === "slug-taken") { status.tell(say("voice.postTaken"), { variant: "problem" }); title.querySelector("input")?.focus(); }
      else tellProblem(problem.words, problem);
    } finally {
      makePost.loading = false;
    }
  }

  // ---- for {helper}: where the files are kept, and moving the pair
  function paintWhere() {
    const line = (file) => {
      const place = file.visibility === "portable" ? say("voice.wherePortable", { path: String(file.path || "") }) : say("voice.wherePrivate", { path: String(file.path || "") });
      return h("li", { class: "studio-mono", text: say("voice.fileLine", { where: place, bytes: Number(file.bytes) || 0, revision: String(file.revision || "").slice(0, 12) }) });
    };
    const to = rough.visibility === "portable" ? "private" : "portable";
    const moveStatus = createDidLine();
    const move = async (target, { undoable = true } = {}) => {
      try {
        const reply = await api.post(`voice/samples/${encodeURIComponent(rough.id)}/visibility`, { visibility: target });
        const was = rough.visibility;
        rough.visibility = reply.visibility;
        for (const moved of reply.moved || []) {
          if (moved.file === rough.file) Object.assign(rough, { path: moved.path, revision: moved.revision });
          else if (saved && moved.file === saved.file) Object.assign(saved, { path: moved.path, visibility: moved.visibility });
        }
        paintWhere();
        // paintWhere made a new line: say it there.
        where.querySelector(".studio-did")?.remove();
        const said = createDidLine();
        where.append(said.element);
        said.tell(say("voice.moved", { where: reply.visibility }), undoable ? { undoLabel: say("voice.moveUndo"), undo: () => move(was, { undoable: false }) } : {});
      } catch (error) {
        if (error?.status === 401) throw error;
        moveStatus.tell(say("voice.moveFailed", { reason: voiceProblem(error).details || String(error?.status || "") }), { variant: "problem" });
      }
    };
    fill(where,
      h("ul", { class: "studio-voice-files" }, line(rough), saved ? line(saved) : null),
      h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", size: "sm", onClick: () => move(to) }, to === "portable" ? say("voice.makePortable") : say("voice.makePrivate"))),
      moveStatus.element);
  }

  const element = h("div", { class: "studio-voice-piece" },
    roughSection,
    h("section", { class: "studio-voice-polish-view", "aria-labelledby": `${id}-polish-h` },
      polishHeading,
      h("p", { class: "studio-help", text: say("voice.polishHelp") }),
      restoreSlot, title, body, count,
      h("div", { class: "studio-row" }, reset),
      status.element, after),
    details);
  put(baseline);
  paint();
  paintWhere();
  const copy = drafts.load();
  if (copy && polishedDirty({ title: copy.title, body: copy.body }, baseline)) offerRestore(copy);
  else if (copy) drafts.clear();

  return {
    element,
    /** The button the screen's bar shows. */
    saveButton,
    isDirty,
    isBusy: () => busy,
    save,
    hasSaved: () => Boolean(saved),
    focus: () => (saved ? focusBody() : null),
    /** "Save your polished copy first." with focus on Save. */
    saveFirst() { status.tell(say("voice.saveFirst"), { variant: "problem" }); saveButton.querySelector("button")?.focus(); },
    /** The leave question for unsaved polish: true to go. */
    async leave() {
      if (!isDirty()) return true;
      const choice = await ask({ heading: say("voice.leavePolishAsk"), text: say("voice.leavePolishText"),
        choices: [{ label: say("voice.leavePolishSave"), value: "save" }, { label: say("voice.leavePolishGo"), value: "go", variant: "secondary" }] });
      if (choice === "save") return Boolean(await save());
      // "A copy stays on this phone": kept now, not when a timer would have got to it.
      if (choice === "go") drafts.save({ base: revision, ...current() });
      return choice === "go";
    },
    keys(key) { if (key === "s" || key === "enter") { save(); return true; } return false; },
    /** `forget`: the piece itself is gone, so the copy kept on this phone goes too. */
    destroy({ forget = false } = {}) { alive = false; clock.clearTimeout(timer); if (forget) drafts.clear(); },
    go,
  };
}

// A recording to listen to with a post (#604, #645): Write's "Put a recording with it" (More, Find)
// and, once a post has one, a card under About this post. The sheet chooses a recording (a file on
// this phone or computer, or a voice note already on the blog) and puts it on the blog only when she
// presses for it, after saying anyone with its address can hear it; reads how long it is from the
// recording itself; takes the words said (typed, pasted or, where the blog can, turned into words
// after saying what goes where) into her post under Transcript, which a published recording needs;
// and, in details, the parts of the recording. It has no Save: it saves with the post.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { askToTranscribe, transcribeSetup } from "./voice-words.js";
import { newCaptureId } from "./new-job-rules.js";
import {
  MAX_RECORDING_BYTES, MAX_TRANSCRIBE_BYTES, hasTranscript, parseParts, parseTime, partLines, recordingFrom, recordingValues, sendProblem, timeWords, withTranscript,
} from "./recording-rules.js";

const mb = (bytes) => (Number(bytes) / (1024 * 1024)).toFixed(1);

/**
 * `fields()` is the post's fields as last saved, `body()` her words and `setBody(text)` puts new
 * words in; `changed()` says the post changed.
 * Returns `{ card, sheet, load(fields), open(opener), values() }`.
 */
export async function createWriteRecording({ api, fields, body, setBody, changed }) {
  await use("action-button", "file-drop", "select-field", "text-field", "alert-banner");
  const sheet = await createSheet({ label: say("recording.title"), wide: false });
  const askSheet = await createSheet({ label: say("recording.wordsTitle"), wide: false });
  const did = createDidLine();
  const content = h("div", { class: "studio-record-sheet" });
  const cardLine = h("span");
  const card = h("div", { class: "studio-row studio-recording-card", hidden: true },
    h("span", { class: "studio-label", text: say("recording.title") }), cardLine,
    h("action-button", { variant: "secondary", size: "sm", label: say("recording.changeLabel"), onClick: (e) => open(e.currentTarget) }, say("recording.change")));
  let state = null; // { url, type, sizeBytes, duration, parts } or null
  let chosen = null; // { file } or { note } waiting to go on the blog
  let notes = null;
  let setup = null;
  let partsText = "";
  let partsProblem = "";

  function load(loaded = {}) {
    const found = recordingFrom(loaded);
    state = found ? { url: found.url, type: found.type, sizeBytes: found.sizeBytes, duration: found.duration, parts: found.parts } : null;
    partsText = partLines(state?.parts || []);
    partsProblem = "";
    paintCard();
  }

  function paintCard() {
    card.hidden = !state;
    cardLine.textContent = state ? (state.duration !== null ? say("recording.cardLength", { length: timeWords(state.duration) }) : say("recording.cardNoLength")) : "";
  }

  function edited() {
    paintCard();
    changed();
  }

  async function open(opener) {
    chosen = null;
    sheet.show({ heading: say("recording.title"), opener, children: [h("p", { class: "studio-help", text: say("recording.lede") }), did.element, content],
      focus: () => content.querySelector("button, input, select, textarea")?.focus() });
    draw();
    if (!setup && globalThis.navigator?.onLine !== false) transcribeSetup(api).then((found) => { setup = found; draw(); });
  }

  function draw() {
    // A recording put on the blog this visit plays from what she chose: the blog's copy is served
    // once the post is saved and the site rebuilt.
    const local = state?.recording;
    if (local?.file && !local.src) local.src = URL.createObjectURL(local.file);
    const src = local?.file ? local.src : local?.note ? `/admin/api/capture-audio?capture=${encodeURIComponent(local.note.id)}` : state?.url;
    const heard = state ? h("audio", { class: "studio-audio", controls: true, preload: "metadata", src, "aria-label": say("recording.listen") }) : null;
    const length = h("text-field", { label: say("recording.length"), description: say("recording.lengthHelp"), inputmode: "numeric",
      value: state?.duration != null ? timeWords(state.duration) : "", onValuechange: (e) => setLength(e.target, String(e.target?.value ?? "")) });
    const words = wordsSaid();
    const off = state ? h("action-button", { variant: "secondary", onClick: () => takeOff() }, say("recording.takeOff")) : null;
    content.replaceChildren(
      state ? h("section", { class: "studio-recording-now", "aria-label": say("recording.now") }, heard, length) : null,
      choose(),
      state ? words : null,
      state ? partsDetails() : null,
      off);
  }

  // ---- choosing a recording and putting it on the blog
  function choose() {
    const drop = h("file-drop", { label: state ? say("recording.another") : say("recording.choose"), hint: say("recording.chooseHint", { max: mb(MAX_RECORDING_BYTES) }), accept: "audio/*", multiple: false });
    drop.addEventListener("fileschange", (event) => {
      const [file] = event.detail || [];
      if (!file) return;
      if (file.size > MAX_RECORDING_BYTES) { did.tell(say("recording.tooBig"), { variant: "problem" }); return; }
      chosen = { file };
      draw();
    });
    const noteChoice = h("select-field", { label: say("recording.voiceNote"), value: chosen?.note?.id || "",
      options: [{ value: "", label: notes === null ? say("recording.notesLoading") : notes.length ? say("recording.noteNone") : say("recording.notesNone") },
        ...(notes || []).map((note, i) => ({ value: note.id, label: say("recording.noteLabel", { n: i + 1, size: mb(note.bytes) }) }))],
      onValuechange: (e) => { const note = (notes || []).find((n) => n.id === e.detail); chosen = note ? { note } : null; draw(); } });
    if (notes === null) {
      notes = [];
      api.get("episode-voice-notes").then((reply) => { notes = Array.isArray(reply?.notes) ? reply.notes : []; draw(); })
        .catch((error) => { if (error.status === 401) throw error; notes = []; draw(); });
    }
    const send = chosen ? h("div", { class: "studio-recording-send" },
      h("p", { class: "studio-help", text: chosen.file ? say("recording.chosenFile", { name: chosen.file.name, size: mb(chosen.file.size) }) : say("recording.chosenNote") }),
      h("p", { text: say("recording.goesPublic") }),
      h("action-button", { onClick: (e) => putOn(e.currentTarget) }, say("recording.putOn"))) : null;
    return h("section", { class: "studio-recording-choose", "aria-label": state ? say("recording.another") : say("recording.choose") }, drop, notes?.length || notes === null ? noteChoice : null, send);
  }

  async function putOn(button) {
    const picked = chosen;
    if (!picked) return;
    button.loading = true;
    try {
      const source = picked.file
        ? await api.call("POST", "episode-audio", { body: picked.file, headers: { "Content-Type": "application/octet-stream" } })
        : await api.call("POST", `episode-audio?capture=${encodeURIComponent(picked.note.id)}`, { body: new Uint8Array(), headers: { "Content-Type": "application/octet-stream" } });
      const before = state;
      state = { url: source.url, type: source.type, sizeBytes: source.sizeBytes, duration: before?.duration ?? null, parts: before?.parts || [] };
      chosen = null;
      const length = await lengthOf(picked);
      if (length !== null) state.duration = length;
      state.recording = picked; // for Turn it into words, this visit only
      did.tell(say("recording.putOnDone"), before ? {} : { undo: () => { state = before; draw(); edited(); }, undoLabel: say("part.undo") });
      draw();
      edited();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(sendProblem(error.status), { variant: "problem" });
    } finally {
      button.loading = false;
    }
  }

  /** How long the recording is, read by the page from the recording itself; null when it can't tell. */
  function lengthOf(picked) {
    return new Promise((resolve) => {
      const src = picked.file ? URL.createObjectURL(picked.file) : `/admin/api/capture-audio?capture=${encodeURIComponent(picked.note.id)}`;
      const player = new Audio();
      const done = (value) => { if (picked.file) URL.revokeObjectURL(src); resolve(value); };
      const timer = setTimeout(() => done(null), 5000);
      player.preload = "metadata";
      player.addEventListener("loadedmetadata", () => { clearTimeout(timer); done(Number.isFinite(player.duration) && player.duration > 0 ? Math.round(player.duration) : null); });
      player.addEventListener("error", () => { clearTimeout(timer); done(null); });
      player.src = src;
    });
  }

  function setLength(field, text) {
    const seconds = text.trim() ? parseTime(text) : null;
    field.error = text.trim() && (seconds === null || seconds < 1) ? say("recording.lengthBad") : "";
    if (field.error) return;
    state.duration = seconds;
    edited();
  }

  // ---- the words said
  function wordsSaid() {
    if (hasTranscript(body(), fields())) return h("p", { class: "studio-help", text: say("recording.wordsIn") });
    const box = h("text-field", { label: say("recording.words"), description: say("recording.wordsHelp"), rows: 6, maxlength: 20000 });
    const put = h("action-button", { variant: "secondary", onClick: () => {
      const said = String(box.value || "").trim();
      if (!said) { box.error = say("recording.wordsNeeded"); return; }
      setBody(withTranscript(body(), said));
      did.tell(say("recording.wordsPut"));
      draw();
    } }, say("recording.wordsPutIn"));
    const source = state?.recording;
    const canHear = setup?.available && source && (source.note || source.file.size <= MAX_TRANSCRIBE_BYTES);
    const hear = canHear ? h("action-button", { variant: "secondary", onClick: (e) => hearIt(e.currentTarget, box) }, say("recording.turnIntoWords")) : null;
    return h("section", { class: "studio-recording-words", "aria-label": say("recording.words") },
      h("p", { text: say("recording.wordsWhy") }), box, h("div", { class: "studio-row" }, hear, put));
  }

  async function hearIt(opener, box) {
    const source = state.recording;
    const result = await askToTranscribe({ api, sheet: askSheet, captureId: source.note ? source.note.id : newCaptureId(), blob: source.file || null, disclosure: setup.disclosure, opener });
    if (!result) return;
    if (result.error !== undefined) {
      if (result.hide) setup = { available: false };
      if (result.error) did.tell(result.error, { variant: "problem" });
      draw();
      return;
    }
    box.value = result.transcript;
    did.tell(result.truncated ? say("recording.heardPart") : say("recording.heard"));
  }

  // ---- the parts of the recording, for {helper}
  function partsDetails() {
    const box = h("text-field", { label: say("recording.parts"), description: say("recording.partsHelp"), rows: 4, class: "studio-mono-field", value: partsText,
      onValuechange: (e) => {
        partsText = String(e.target?.value ?? "");
        const read = parseParts(partsText, state.duration);
        partsProblem = read.error || "";
        box.error = partsProblem;
        if (!read.error) { state.parts = read.parts; edited(); }
      } });
    box.error = partsProblem;
    return h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), box,
      h("dl", { class: "studio-details" },
        h("dt", { text: say("recording.file") }), h("dd", { class: "studio-mono", text: `${state.url} (${state.type}, ${state.sizeBytes} bytes)` })));
  }

  function takeOff() {
    const before = state;
    state = null;
    did.tell(say("recording.tookOff"), { undo: () => { state = before; draw(); edited(); }, undoLabel: say("part.undo") });
    draw();
    edited();
  }

  return {
    card,
    sheet,
    load,
    open,
    /** The `audio.*` values for the save: none when the post never had a recording and still has none. */
    values: () => {
      const saved = fields() || {};
      return state || Object.keys(saved).some((key) => key.startsWith("audio.")) ? recordingValues(state, saved) : {};
    },
  };
}

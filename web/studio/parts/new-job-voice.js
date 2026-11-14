// New job's voice note (Studio R4): Record, Stop, Record again, Throw it away, and Turn it into
// words, over the old Admin's recorder (parts/capture-recorder.js, unchanged). The button's name
// follows the state; the live region hears "Recording" once, "30 seconds left" once and "Stopped";
// the ticking timer is not read out. Leaving or hiding the page while recording stops and keeps it.
import { h } from "./dom.js";
import { ask } from "./dialogs.js";
import { audioLimits, clock, createRecorder } from "./capture-recorder.js";
import { appendTranscript } from "./capture-assistant-rules.js";
import { RECORD_WORDS, lengthWords, micSteps } from "./job-words.js";
import { askToTranscribe, transcribeSetup } from "./voice-words.js";

/**
 * `{ meta, here, noun, api, sheet, captureId(), notes (text-field), maxNotes, say(words), offerUndo(words, undo), onChange() }`.
 * Returns `{ element, note(), set(note, { left }), stop(), discard(), recording(), destroy() }`.
 */
export function createVoiceNote({ meta, here, noun, api, sheet, captureId, notes, maxNotes, say, offerUndo, onChange, recorderOptions = {} }) {
  const limits = audioLimits(meta);
  let note = null;
  let preview = "";
  let problem = "";
  let warned = false;
  let setup = null;
  let checking = false;
  let leftNote = false;
  let wasRecording = false;
  const body = h("div", { class: "studio-voice-body" });
  const element = h("fieldset", { class: "studio-voice", "data-voice": "true" }, h("legend", { text: "Voice note" }), body);

  const recorder = createRecorder({
    ...recorderOptions,
    limits,
    onChange: (state) => {
      if (state === "recorded") {
        const done = recorder.result();
        keep({ type: done.type, size: done.size, seconds: done.seconds, blob: done.blob });
        problem = ["time", "size", "error"].includes(done.reason) ? done.reason : "";
        say(problem ? RECORD_WORDS[problem] : `Stopped. Your voice note is ${clock(done.seconds)} long.`);
      } else if (state === "idle" && !note && problem === "" && recorder.result() === null && wasRecording) {
        say(RECORD_WORDS.empty);
      }
      wasRecording = state === "recording";
      draw();
    },
    onTick: (seconds) => {
      const timer = body.querySelector("[data-timer]");
      if (timer) timer.textContent = `Recording ${clock(seconds)} of ${clock(limits.maxAudioSeconds)}`;
      if (!warned && limits.maxAudioSeconds - seconds <= 30) {
        warned = true;
        say("30 seconds left.");
      }
    },
  });

  function keep(next) {
    if (preview) URL.revokeObjectURL(preview);
    note = next;
    preview = next ? URL.createObjectURL(next.blob) : "";
    onChange();
  }

  const button = (label, props, onClick) => h("action-button", { variant: "secondary", ...props, onClick }, label);

  async function start(event) {
    problem = "";
    warned = false;
    const started = await recorder.start(event);
    if (started.ok) {
      say("Recording.");
      requestAnimationFrame(() => body.querySelector("[data-stop] button")?.focus());
      return;
    }
    problem = started.reason;
    draw();
    say(started.reason === "denied" ? RECORD_WORDS.denied(noun) : RECORD_WORDS.unavailable);
  }

  async function throwAway() {
    if (recorder.state === "recording") {
      recorder.discard();
      keep(null);
      say(RECORD_WORDS.thrown);
      draw();
      focusRecord();
      return;
    }
    const choice = await ask({ heading: "Throw away your voice note?", text: "It's only on this phone, so it'll be gone for good.", choices: [{ label: "Keep it", value: "keep" }, { label: "Throw it away", value: "throw", variant: "destructive" }] });
    if (choice !== "throw") return;
    recorder.discard();
    keep(null);
    problem = "";
    say(RECORD_WORDS.thrown);
    draw();
    focusRecord();
  }

  async function again() {
    const choice = await ask({ heading: RECORD_WORDS.replace, text: "The one you have now is thrown away.", choices: [{ label: "Replace", value: "replace" }, { label: "Keep it", value: "keep", variant: "secondary" }] });
    if (choice !== "replace") return;
    recorder.discard();
    keep(null);
    draw();
    say("Your voice note is thrown away. Tap Record a voice note to say it again.");
    focusRecord();
  }

  const focusRecord = () => requestAnimationFrame(() => body.querySelector("[data-record] button")?.focus());

  async function toWords(event) {
    if (!setup?.available) return;
    const result = await askToTranscribe({ api, sheet, captureId: captureId(), blob: note.blob, disclosure: setup.disclosure, opener: event.currentTarget });
    if (!result) return;
    if (result.error !== undefined) {
      if (result.hide) setup = { available: false };
      if (result.error) say(result.error);
      draw();
      return;
    }
    const before = String(notes.value || "");
    const next = appendTranscript(before, result.transcript, maxNotes);
    notes.value = next.notes;
    notes.dispatchEvent(new CustomEvent("valuechange", { detail: next.notes, bubbles: true }));
    const words = `Added to your words. A computer wrote them from your voice note, so read them through.${next.clipped || result.truncated ? " It was long, so the end was left off." : ""}`;
    offerUndo(words, () => {
      notes.value = before;
      notes.dispatchEvent(new CustomEvent("valuechange", { detail: before, bubbles: true }));
      say("Taken out. Your words are as they were.");
    });
  }

  function draw() {
    const state = recorder.state;
    const online = globalThis.navigator?.onLine !== false;
    if (!recorder.support.supported && !note) {
      body.replaceChildren(h("p", { class: "studio-help", text: RECORD_WORDS.unsupported }));
      return;
    }
    if (state === "recording") {
      body.replaceChildren(
        h("p", { class: "studio-recording" }, h("span", { class: "studio-recording-dot", "aria-hidden": "true" }), h("span", { "data-timer": "true", "aria-live": "off", text: `Recording 0:00 of ${clock(limits.maxAudioSeconds)}` })),
        h("div", { class: "studio-row" },
          h("action-button", { "data-stop": "true", onClick: () => recorder.stop() }, "Stop"),
          button("Throw it away", { label: "Throw away the recording" }, throwAway)));
      return;
    }
    if (note && state !== "starting") {
      const player = h("audio", { controls: true, src: preview, "aria-label": "Your voice note", class: "studio-audio" });
      const canWords = online && setup?.available;
      if (online && !setup && !checking) {
        checking = true;
        transcribeSetup(api).then((found) => { setup = found; checking = false; draw(); });
      }
      body.replaceChildren(
        leftNote ? h("p", { class: "studio-help", text: RECORD_WORDS.left }) : null,
        player,
        h("p", { class: "studio-help", text: lengthWords(clock(note.seconds)) }),
        h("div", { class: "studio-row" },
          button("Record again", { "data-again": "true" }, again),
          button("Throw it away", { label: "Throw away your voice note" }, throwAway),
          canWords ? button("Turn it into words", { "data-words": "true" }, toWords) : null),
        !online ? h("p", { class: "studio-help", text: "When there's a signal, you can turn it into words here or later, when you finish the job." }) : null);
      return;
    }
    const why = problem === "denied"
      ? h("div", { class: "studio-help", role: "note" }, h("p", { text: RECORD_WORDS.denied(noun) }), h("ol", { class: "studio-steps" }, ...micSteps(here).map((line) => h("li", { text: line }))), h("p", { text: RECORD_WORDS.deniedAfter }))
      : problem === "unavailable" ? h("p", { class: "studio-help", text: RECORD_WORDS.unavailable })
        : null;
    body.replaceChildren(
      h("action-button", { variant: "secondary", "data-record": "true", loading: state === "starting", onClick: start }, state === "starting" ? "Starting…" : "Record a voice note"),
      h("p", { class: "studio-help", text: state === "starting" ? RECORD_WORDS.starting : RECORD_WORDS.idle(limits.maxAudioSeconds) }),
      why);
  }

  // Leaving or hiding the page while recording stops it and keeps what was said.
  const hidden = () => {
    if (document.visibilityState === "hidden" && recorder.state === "recording") {
      leftNote = true;
      recorder.stop();
    }
  };
  document.addEventListener("visibilitychange", hidden);
  addEventListener("pagehide", hidden);
  addEventListener("online", draw);
  addEventListener("offline", draw);
  draw();

  return {
    element,
    note: () => note,
    left: () => leftNote,
    /** A note kept from before (the page reloaded). */
    set(kept, { left = false } = {}) {
      keep(kept || null);
      leftNote = Boolean(kept && left);
      draw();
    },
    /** Stop a running recording and keep it; `left`: because she left the screen. */
    async stop({ left = false } = {}) {
      if (recorder.state === "recording") {
        leftNote = left;
        await recorder.stop();
      }
    },
    /** Start clean for the next job. */
    reset() {
      recorder.discard();
      keep(null);
      problem = "";
      leftNote = false;
      draw();
    },
    recording: () => recorder.state === "recording" || recorder.state === "starting",
    focus: () => body.querySelector("action-button button")?.focus(),
    destroy() {
      document.removeEventListener("visibilitychange", hidden);
      removeEventListener("pagehide", hidden);
      removeEventListener("online", draw);
      removeEventListener("offline", draw);
      recorder.discard();
      if (preview) URL.revokeObjectURL(preview);
    },
  };
}

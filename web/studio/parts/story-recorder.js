// Say it out loud (Studio R9b): one story, recorded on this phone, then turned into words by the
// site's own transcriber and kept as a rough draft. Built on R4's recorder (capture-recorder.js),
// which never starts without a tap and stops itself at the limit.
//
// Privacy, in order: nothing is recorded before she taps; before the first recording (and before
// a kept recording is sent in a new visit) a sheet says where it goes, by company, or that
// nothing leaves the site; the recording is sent only when she presses Use this recording; it is
// kept on this phone until the server has answered with a piece, and never after. Her words and
// the recording are never logged. What comes back is text: shown read only, with textContent.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { innerAria } from "./inner-button.js";
import { createRecorder } from "./capture-recorder.js";
import { micSteps } from "./job-words.js";
import { helperProblem } from "./helper-rules.js";
import { STORY_MAX_BYTES, STORY_MAX_SECONDS, sayGoes, spokenProblem, storyClock } from "./story-rules.js";
import { forgetRecording, keepRecording, keptRecording } from "./story-store.js";

const STILL_MS = 20000;

/**
 * `{ element, begin(prompt, event), restore(), busy(), stop() }`.
 *
 * - `transcribe`: `GET assistant/transcribe` (who hears: a company, or the site's own computer).
 * - `query`: added to the request's address (`practice=1` in a practice run).
 * - `onPiece(reply, prompt)`: the story is kept (`reply` is `{ id, words, text }`).
 * - `onType(prompt)`: she chose to type it instead. `onGone()`: nothing can hear any more.
 */
export async function createStoryRecorder({ api, user, here = {}, noun = "phone", transcribe = {}, query = "", onPiece = () => {}, onType = () => {}, onGone = () => {}, recorderOptions = {} }) {
  await use("action-button", "side-sheet", "alert-banner", "loading-spinner", "modal-dialog");
  const body = h("div", { class: "studio-story-recorder" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const element = h("div", { class: "studio-story-say", hidden: true }, body, status);
  let prompt = null;
  let recording = null; // { blob, type, seconds, reason }
  let preview = "";
  let confirmed = false; // the Before you start sheet was answered in this visit
  let sending = false;
  let left = false;
  let state = "idle"; // idle | starting | recording | recorded | denied | unavailable | cant | turning

  const recorder = createRecorder({
    ...recorderOptions,
    limits: { maxAudioSeconds: STORY_MAX_SECONDS, maxAudioBytes: STORY_MAX_BYTES - 64 * 1024 },
    onChange: (next) => {
      if (next === "recorded") {
        const done = recorder.result();
        keep({ blob: done.blob, type: done.type, seconds: done.seconds, reason: done.reason });
        return;
      }
      if (next === "starting" || next === "recording") { state = next; draw(); }
    },
    onTick: (seconds) => {
      const timer = body.querySelector("[data-story-timer]");
      if (timer) timer.textContent = say("start.recording", { time: storyClock(seconds) });
    },
  });

  // A recording stops when the app goes to the background, and is kept.
  const hidden = () => { if (globalThis.document?.visibilityState === "hidden" && recorder.state === "recording") { left = true; recorder.stop(); } };
  globalThis.document?.addEventListener("visibilitychange", hidden);

  function keep(next) {
    if (preview) URL.revokeObjectURL(preview);
    recording = next;
    preview = next ? URL.createObjectURL(next.blob) : "";
    state = next ? "recorded" : "idle";
    // Written to this phone at once: a reload, or the app being closed, loses nothing.
    if (next && prompt) keepRecording(user, { promptId: prompt.id, type: next.type, seconds: next.seconds, blob: next.blob });
    draw();
  }

  function draw() {
    element.hidden = state === "idle";
    const typeInstead = () => h("action-button", { variant: "secondary", onClick: () => { const p = prompt; reset(); onType(p); } }, say("start.typeIt"));
    if (state === "starting") {
      fill(body, h("p", { text: say("start.recStarting") }));
    } else if (state === "recording") {
      const stop = h("action-button", { onClick: () => recorder.stop() }, say("start.recStop"));
      innerAria(stop, { "aria-label": say("start.recStopName") });
      fill(body, h("p", { class: "studio-story-live" }, h("span", { class: "studio-story-dot", "aria-hidden": "true" }),
        h("span", { role: "timer", "data-story-timer": "", text: say("start.recording", { time: storyClock(0) }) })), h("div", { class: "studio-row" }, stop));
      requestAnimationFrame(() => stop.querySelector("button")?.focus());
    } else if (state === "recorded" && recording) {
      const why = left ? say("start.recLeft") : recording.reason === "time" ? say("start.recTime") : recording.reason === "error" ? say("start.recError") : "";
      const audio = h("audio", { controls: true, class: "studio-story-audio", "aria-label": say("start.recListen"), src: preview });
      const useIt = h("action-button", { onClick: () => send() }, say("start.recUse"));
      const again = h("action-button", { variant: "secondary", onClick: async (event) => {
        const opener = event.currentTarget;
        const choice = await ask({ heading: say("start.recAgainAsk"), text: [], choices: [{ label: say("start.recAgainYes"), value: "again", variant: "destructive" }, { label: say("start.recKeep"), value: "keep", variant: "secondary" }], focus: 1 });
        if (choice !== "again") { opener.querySelector("button")?.focus(); return; }
        await forgetRecording(user);
        left = false;
        keep(null);
        status.textContent = "";
        if (prompt) offer(prompt);
      } }, say("start.recAgain"));
      fill(body, why ? h("p", { text: why }) : null, audio, h("p", { class: "studio-help", text: say("start.recLength", { time: storyClock(recording.seconds) }) }), h("div", { class: "studio-row" }, useIt, again));
      requestAnimationFrame(() => useIt.querySelector("button")?.focus());
    } else if (state === "turning") {
      fill(body, h("p", { class: "studio-row" }, h("loading-spinner", { size: "sm", "aria-hidden": "true" }), h("span", { "data-story-turning": "", text: say("start.turning") })));
    } else if (state === "denied") {
      fill(body, h("p", { text: say("start.recDenied", { phone: noun }) }), h("ol", { class: "studio-steps" }, ...micSteps(here).map((line) => h("li", { text: line }))), h("p", { text: say("start.recOrType") }), h("div", { class: "studio-row" }, typeInstead()));
    } else if (state === "unavailable") {
      fill(body, h("p", { text: say("start.recUnavailable") }), h("div", { class: "studio-row" },
        h("action-button", { onClick: (event) => record(event) }, say("start.recTryAgain")), typeInstead()));
    } else if (state === "cant") {
      fill(body, h("p", { text: say("start.recCant") }), h("div", { class: "studio-row" }, typeInstead()));
    } else {
      fill(body);
    }
  }

  function reset() {
    if (recorder.state === "recording" || recorder.state === "starting") recorder.discard?.();
    state = "idle";
    status.textContent = "";
    draw();
  }

  /** Start the recorder from her tap (`event` must be that tap). */
  async function record(event) {
    left = false;
    status.textContent = "";
    if (!recorder.support.supported) { state = "cant"; draw(); return; }
    const started = await recorder.start(event);
    if (started.ok) return;
    state = started.reason === "denied" ? "denied" : started.reason === "unsupported" ? "cant" : started.reason === "busy" ? state : "unavailable";
    draw();
  }

  /** The Before you start sheet: where the recording goes, then one button. Resolves the tap, or null. */
  function disclose(primaryLabel) {
    return new Promise((resolve) => {
      const goes = sayGoes(transcribe);
      let answered = false;
      const done = (value) => { if (answered) return; answered = true; sheet.open = false; sheet.remove(); resolve(value); };
      const sheet = h("side-sheet", { label: say("start.sayHeading"), side: "right", class: "studio-wide-sheet studio-story-sheet" },
        h("span", { slot: "heading", text: say("start.sayHeading") }),
        h("section", { class: "studio-goes", "aria-label": goes.heading },
          h("h4", { class: "studio-goes-heading", text: goes.heading }),
          h("ul", { class: "studio-goes-list" }, goes.lines.map((line) => h("li", { text: line }))),
          h("p", { class: "studio-goes-never", text: goes.never })),
        h("div", { slot: "actions", class: "studio-row" },
          h("action-button", { variant: "secondary", onClick: () => done("type") }, say("start.sayType")),
          h("action-button", { onClick: (event) => done(event) }, primaryLabel)));
      sheet.addEventListener("openchange", (event) => { if (event.target === sheet && !event.detail) done(null); });
      document.body.append(sheet);
      sheet.open = true;
      requestAnimationFrame(() => sheet.querySelector("action-button:last-of-type button")?.focus());
    });
  }

  /** She chose Say it out loud for `next`: the sheet first (once a visit), then the recorder. */
  async function offer(next, event = null) {
    prompt = next;
    if (!recorder.support.supported) { state = "cant"; draw(); return; }
    if (confirmed && event) { await record(event); return; }
    const answer = await disclose(say("start.sayStart"));
    if (answer === "type") { const p = prompt; reset(); onType(p); return; }
    if (!answer) return;
    confirmed = true;
    await record(answer);
  }

  /** Use this recording: send it, show the words, forget the recording. */
  async function send() {
    if (sending || !recording || !prompt) return;
    // A recording kept from an earlier visit: say where it goes before it goes anywhere.
    if (!confirmed) {
      const answer = await disclose(say("start.recUse"));
      if (answer === "type") { const p = prompt; state = "recorded"; onType(p); return; }
      if (!answer) return;
      confirmed = true;
    }
    sending = true;
    state = "turning";
    draw();
    status.textContent = "";
    const still = setTimeout(() => { const line = body.querySelector("[data-story-turning]"); if (line) line.textContent = say("start.turningStill"); }, STILL_MS);
    try {
      const path = `voice/spoken?promptId=${encodeURIComponent(prompt.id)}${query ? `&${query}` : ""}`;
      const reply = await api.call("POST", path, { body: recording.blob, headers: { "Content-Type": recording.type || "audio/webm" } });
      // Only now that the server has the story is the recording removed from this phone.
      await forgetRecording(user);
      const told = prompt;
      if (preview) URL.revokeObjectURL(preview);
      preview = "";
      recording = null;
      left = false;
      state = "idle";
      draw();
      onPiece(reply, told);
    } catch (error) {
      if (error?.status === 401) throw error;
      // Whatever went wrong, the recording is still on this phone.
      state = "recorded";
      draw();
      const own = spokenProblem(error);
      // A company's own failure (busy, down, the key refused) is hers to read as "that couldn't
      // be turned into words"; which kind it was is for {helper}.
      const provider = helperProblem(error, { company: sayGoes(transcribe).company });
      fill(status, h("span", { text: own.words }),
        h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }),
          h("p", { class: "studio-mono", text: say("start.sayEngine", { engine: String(transcribe.engine || "?"), seconds: Math.round(recording.seconds), bytes: recording.blob.size }) }),
          h("p", { class: "studio-mono", text: [`${own.code} ${error?.status || 0}`, own.details, ...provider.details].filter(Boolean).join(" · ") })));
      if (own.gone) { reset(); onGone(); }
    } finally {
      clearTimeout(still);
      sending = false;
    }
  }

  return {
    element,
    /** Say it out loud for `next` (a prompt); `event` is her tap, when the sheet was already answered. */
    begin: (next, event) => offer(next, event),
    /** A recording kept from before (a reload, the app closed): show it, ready to use. Resolves its prompt id, or "". */
    async restore() {
      const kept = await keptRecording(user);
      if (!kept) return "";
      prompt = { id: kept.promptId };
      left = true;
      recording = { blob: kept.blob, type: kept.type, seconds: kept.seconds, reason: "" };
      if (preview) URL.revokeObjectURL(preview);
      preview = URL.createObjectURL(kept.blob);
      state = "recorded";
      draw();
      return kept.promptId;
    },
    setPrompt(next) { if (next) prompt = next; },
    busy: () => state === "recording" || state === "starting" || sending,
    hasRecording: () => Boolean(recording),
    /** Leaving: a recording in progress stops and is kept. */
    stop() {
      globalThis.document?.removeEventListener("visibilitychange", hidden);
      if (recorder.state === "recording") { left = true; recorder.stop(); }
      if (preview) URL.revokeObjectURL(preview);
    },
  };
}

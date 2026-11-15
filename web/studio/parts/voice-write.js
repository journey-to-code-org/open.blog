// Write a piece (Studio R9): choose a prompt, then write for three minutes against a clock the
// server owns. Lifted from the old Admin's voice-session.js (ADR 0272, 0273) with its rules: the
// rough box turns off every correction a page can refuse, the clock is a display and never gives
// time back, the draft goes to the server a moment after typing stops and a copy stays on this
// phone, and "I'm done" (or the time running out) saves the rough draft exactly as written.
//
// One section; its steps replace each other, and focus moves to each step's heading (Write: to
// the box). Shared with Getting started (R9b), which draws its own prompts (`choose: false`) and
// is told when a piece is saved. Her words are never logged, never put in an error and never sent
// anywhere but the site's own voice routes. The rough box is a native textarea on purpose: the
// attributes that keep the browser and its extensions away must sit on the box itself (Zubra UI's
// text-field doesn't pass them through yet).
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { innerAria } from "./inner-button.js";
import {
  ROUGH_ATTRIBUTES, VOICE_LIMITS, copyIsPastGrace, createAnnouncer, createCountdown, expiredPlan, formatClock, reconcileDraft, sessionView, spokenTime, timerLabel, voiceProblem, wordCount, wordsText,
} from "./voice-rules.js";
import { createVoiceDraftStore, draftKey } from "./voice-copies.js";

let uid = 0;
const LOCK_TRIES = 8;

/** "About 120 to 250 words.", or "" when the prompt gives no range. */
export const wordRange = (prompt) => (Number(prompt?.wordsMax) > 0 ? say("voice.wordRange", { min: prompt.wordsMin, max: prompt.wordsMax }) : "");

/**
 * `{ element, load(), start(promptId), showChoose(options), isRunning(), isBusy(), leave(), keys(key), destroy() }`.
 *
 * - `pack`: draw only from this set (a set the site dropped draws from every set).
 * - `choose: false`: the host draws and chooses; it is told `onChoose({ notice })` when this part
 *   has nothing in progress, and calls `start(promptId)`.
 * - `onSaved(answer)`: the rough draft is saved (`answer` is the lock's: `{ sample, expired, words }`).
 * - `extra`: fields added to every request body (Getting started's practice run).
 */
export async function createVoiceWrite({ api, user = "", pack = null, choose = true, extra = {}, storage, onSaved = () => {}, onChoose = () => {}, onPack = () => {}, backHref = "", clock = globalThis }) {
  await use("action-button", "choice-cards", "alert-banner", "skeleton-block", "modal-dialog");
  const base = `studio-voice-${++uid}`;
  // One polite region for the whole part, outside the steps: only the marks, resumed and the lock.
  const live = h("p", { class: "studio-visually-hidden", role: "status", "aria-live": "polite", "data-voice-announce": "" });
  const stage = h("div", { class: "studio-voice-stage" });
  const element = h("div", { class: "studio-voice-write" }, live, stage);
  const drafts = createVoiceDraftStore(draftKey(user), storage);
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const body = (fields) => ({ ...fields, ...extra });
  // A practice run (Getting started in rehearse) reads its own library too.
  const practice = extra.practice === true;
  const readQuery = practice ? "?practice=1" : "";

  let generation = 0;
  let stop = () => {};
  let running = null; // the Write step's own handle while the clock runs
  let finishing = false;
  let currentKeys = () => false;

  const announce = (message) => {
    if (!message) return;
    live.textContent = "";
    live.textContent = message.text;
  };
  const render = (...nodes) => {
    stop();
    stop = () => {};
    running = null;
    currentKeys = () => false;
    fill(stage, ...nodes);
  };
  const heading = (text, id) => h("h2", { id, class: "studio-question", tabindex: "-1", text });
  const focusHeading = () => requestAnimationFrame(() => stage.querySelector("h2")?.focus());
  /** A failure in her words, with the server's sentence for {helper} underneath. */
  const problemLine = (error) => {
    const problem = voiceProblem(error);
    return [h("span", { text: problem.words || say("voice.serverTrouble") }),
      problem.details ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${problem.code}: ${problem.details}` })) : null];
  };

  // ---- loading: where the server says she is

  async function load() {
    const mine = ++generation;
    finishing = false;
    render(h("p", { class: "studio-help", role: "status", text: say("voice.loading") }), h("skeleton-block", { lines: 4 }));
    try {
      // A copy on this phone may hold more than the server after a lost signal. If the time ran
      // out, the server still decides: it takes that text only within its grace. No time comes back.
      const local = drafts.load();
      // (A practice run has no status of its own to check a copy against: the resume below decides.)
      if (local && !practice) {
        const standing = await api.get("voice/status");
        if (mine !== generation) return;
        if (!standing.session?.open && copyIsPastGrace(local)) drafts.clear();
        else if (expiredPlan(standing.session, local).useDevice) {
          try {
            const reply = await api.post("voice/session/lock", body({ sessionId: standing.session.sessionId, text: local.text }));
            if (mine !== generation) return;
            drafts.clear();
            saved(reply);
            return;
          } catch (error) {
            if (error?.status === 401) throw error;
            // The server's own resume below saves what it had.
          }
        }
      }
      const answer = await api.get(`voice/session${readQuery}`);
      if (mine !== generation) return;
      enter(answer);
    } catch (error) {
      if (error?.status === 401) throw error;
      if (mine === generation) showProblem(error);
    }
  }

  function enter(answer) {
    const view = sessionView(answer);
    if (view.step === "finishing") return showFinishing(view);
    // A piece that is over leaves no copy behind: the rough draft is on the server.
    if (view.step !== "write") drafts.clear();
    if (view.step === "write") return showWrite(answer, { resumed: true });
    if (view.step === "saved") return saved(answer);
    return toChoose({ notice: view.notice === "discarded" ? say("voice.discarded") : "" });
  }

  function saved(answer) {
    render();
    onSaved(answer);
  }

  function toChoose(options = {}) {
    if (choose) return showChoose(options);
    render();
    return onChoose(options);
  }

  function showProblem(error) {
    render(heading(say("voice.writeTitle"), `${base}-h`),
      h("alert-banner", { variant: error?.status === 0 ? "info" : "danger" }, ...problemLine(error)),
      h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
    focusHeading();
  }

  function showFinishing(view) {
    const mine = generation;
    render(heading(say("voice.finishingHeading"), `${base}-h`),
      h("p", { role: "status", text: say("voice.finishingText") }),
      h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", onClick: () => load() }, say("voice.checkAgain"))));
    focusHeading();
    const timer = clock.setTimeout(() => { if (mine === generation && element.isConnected) load(); }, view.retryAfterSeconds * 1000 + 500);
    stop = () => clock.clearTimeout(timer);
  }

  // ---- step 1: choose

  async function showChoose({ notice = "", focus = true } = {}) {
    const mine = ++generation;
    finishing = false;
    let from = pack;
    let drawn;
    try {
      try {
        drawn = await api.post("voice/draw", body(from ? { pack: from } : {}));
      } catch (error) {
        // A set the site no longer offers draws from every set, silently.
        if (!from || error?.status !== 404) throw error;
        from = null;
        onPack(null);
        drawn = await api.post("voice/draw", body({}));
      }
    } catch (error) {
      if (error?.status === 401) throw error;
      if (mine === generation) showProblem(error);
      return;
    }
    if (mine !== generation) return;
    let shown = drawn.prompts || [];
    let selected = "";
    const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const chooseFirst = h("p", { class: "studio-field-error", id: `${base}-first`, hidden: true, text: say("voice.chooseFirst") });
    const notices = h("div", { class: "studio-banner" });
    const cards = h("choice-cards", { label: say("voice.chooseLegend"), class: "studio-voice-cards", "aria-describedby": `${base}-first`, onValuechange: (event) => { selected = event.detail || ""; paint(); } });
    const startButton = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => begin() }, say("voice.start"));
    const more = h("action-button", { variant: "secondary", onClick: () => redraw() }, say("voice.drawMore"));
    const setCards = () => {
      selected = "";
      cards.items = shown.map((prompt) => ({ id: prompt.id, title: String(prompt.title || ""), detail: [prompt.invitation, wordRange(prompt)].filter(Boolean).join(" "), note: String(prompt.packTitle || "") }));
      cards.value = "";
      paint();
    };
    function paint() {
      // Never `disabled`: she can press it and be told why nothing started.
      innerAria(startButton, { "aria-disabled": selected ? null : "true", "aria-describedby": selected ? null : `${base}-first` });
      if (selected) chooseFirst.hidden = true;
    }
    async function redraw() {
      more.loading = true;
      try {
        const next = await api.post("voice/draw", body({ exclude: shown.map((p) => p.id), ...(from ? { pack: from } : {}) }));
        if (mine !== generation) return;
        shown = next.prompts || [];
        setCards();
        status.textContent = say("voice.drewMore");
        requestAnimationFrame(() => cards.querySelector("button")?.focus());
      } catch (error) {
        if (error?.status === 401) throw error;
        fill(status, ...problemLine(error));
      } finally {
        more.loading = false;
      }
    }
    async function begin() {
      if (!selected) {
        chooseFirst.hidden = false;
        cards.querySelector("button")?.focus();
        return;
      }
      await start(selected, { button: startButton, status, notices });
    }
    setCards();
    const packTitle = from ? (shown.find((p) => p.pack === from)?.packTitle || from) : "";
    const minutes = Math.round(VOICE_LIMITS.defaultSeconds / 60);
    render(
      backHref ? h("a", { class: "studio-more-link studio-back", href: backHref, text: `‹ ${say("voice.back")}` }) : null,
      heading(say("voice.chooseHeading"), `${base}-h`),
      notice ? h("p", { class: "studio-help", role: "status", text: notice }) : null,
      from ? h("p", { class: "studio-help" }, h("span", { text: `${say("voice.fromPack", { pack: packTitle })} ` }),
        h("button", { type: "button", class: "studio-link-button", onClick: () => { pack = null; onPack(null); showChoose(); } }, say("voice.fromEveryPack"))) : null,
      notices,
      h("p", { class: "studio-help studio-voice-legend", "aria-hidden": "true", text: say("voice.chooseLegend") }),
      cards, chooseFirst,
      drawn.rule ? h("p", { class: "studio-voice-rule", text: String(drawn.rule) }) : null,
      h("p", { class: "studio-help", text: minutes === 3 ? say("voice.chooseHelp") : say("voice.chooseHelpTime", { minutes }) }),
      status,
      h("div", { class: "studio-write-bar" }, more, startButton));
    currentKeys = (key) => { if (key === "enter") { begin(); return true; } return false; };
    if (focus) focusHeading();
  }

  /** Begin the one piece. A piece already open somewhere else shows its card instead. */
  async function start(promptId, { button = null, status = null, notices = null } = {}) {
    const mine = generation;
    if (button) button.loading = true;
    if (status) status.textContent = say("voice.starting");
    try {
      const session = await api.post("voice/session/start", body({ promptId }));
      if (mine === generation) showWrite(session);
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      if (mine !== generation) return false;
      const problem = voiceProblem(error);
      if (problem.code === "already-open") {
        if (status) status.textContent = "";
        showOpen(error.data || {}, notices);
      } else if (status) {
        if (problem.code === "refused") fill(status, h("span", { text: say("voice.startRefused") }), ...problemLine(error).slice(1));
        else fill(status, ...problemLine(error));
      } else showProblem(error);
      return false;
    } finally {
      if (button) button.loading = false;
    }
  }

  /** A piece is already open (another tab, a terminal): keep writing it, save it, or throw it away. */
  function showOpen(info, slot) {
    const title = String(info.promptTitle || info.promptId || "");
    const headingId = `${base}-open`;
    const box = h("section", { class: "studio-voice-open", "aria-labelledby": headingId },
      h("h3", { id: headingId, tabindex: "-1", text: say("voice.openHeading") }),
      h("p", { text: info.expired ? say("voice.openExpired", { title }) : say("voice.openActive", { title }) }),
      h("div", { class: "studio-row" },
        h("action-button", { onClick: () => load() }, info.expired ? say("voice.openLock") : say("voice.openContinue")),
        h("action-button", { variant: "secondary", onClick: async (event) => {
          const opener = event.currentTarget;
          const choice = await ask({ heading: say("voice.scrapAsk", { title }), text: say("voice.scrapText"),
            choices: [{ label: say("voice.scrapYes"), value: "scrap", variant: "destructive" }, { label: say("voice.scrapNo"), value: "keep", variant: "secondary" }], focus: 1 });
          if (choice !== "scrap") { opener.querySelector("button")?.focus(); return; }
          try {
            await api.call("DELETE", "voice/session", { json: body({ sessionId: info.sessionId ?? null }) });
            drafts.clear();
            toChoose({ notice: say("voice.scrapped") });
          } catch (error) {
            if (error?.status === 401) throw error;
            box.append(h("p", { class: "studio-field-error", role: "alert" }, ...problemLine(error)));
          }
        } }, say("voice.openScrap"))));
    if (slot) fill(slot, box); else render(heading(say("voice.writeTitle"), `${base}-h`), box);
    requestAnimationFrame(() => box.querySelector("h3")?.focus());
  }

  // ---- step 2: write

  function showWrite(session, { resumed = false } = {}) {
    const mine = ++generation;
    finishing = false;
    const countdown = createCountdown(now);
    const announcer = createAnnouncer({ resumed });
    countdown.sync(session.remainingSeconds);
    const sessionId = session.sessionId;
    const roughId = `${base}-rough`;
    const rough = h("textarea", { ...ROUGH_ATTRIBUTES, class: "studio-voice-rough", id: roughId, rows: "12", "aria-describedby": `${base}-help ${base}-count` });
    // Set as attributes too, whatever h() decided: the browser reads them from the box itself.
    for (const [name, value] of Object.entries(ROUGH_ATTRIBUTES)) rough.setAttribute(name, value);
    // The longer of this phone's copy and the server's draft wins when both are this piece's; a
    // copy of another piece is stale and is dropped.
    const copy = drafts.load();
    if (copy && copy.sessionId !== sessionId) drafts.clear();
    const choice = reconcileDraft({ sessionId, serverDraft: session.draft }, copy && copy.sessionId === sessionId ? copy : null);
    rough.value = choice.text;

    const clockText = h("span", { class: "studio-voice-clock", role: "timer", "aria-label": say("voice.timerName"), text: formatClock(countdown.remaining()) });
    const symbol = h("span", { class: "studio-voice-symbol", "aria-hidden": "true" });
    const stateText = h("span", { class: "studio-voice-timer-state" });
    const timerBox = h("p", { class: "studio-voice-timer", "data-state": "running" }, symbol, clockText, stateText);
    const count = h("p", { class: "studio-help", id: `${base}-count` });
    const saveLine = h("p", { class: "studio-help studio-voice-save", role: "status", "aria-live": "polite" });
    const message = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const done = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => finish("early") }, say("voice.finish"));
    const over = h("action-button", { variant: "secondary", onClick: () => askStartOver() }, say("voice.startOver"));
    let lastShown = -1;
    let lastSent = String(session.draft || "");
    let saving = false;
    let timer = null;
    let copyTimer = null;

    const keepCopy = ({ evenWhileFinishing = false } = {}) => {
      clock.clearTimeout(copyTimer);
      // A part that was replaced (signing out, another screen) never writes private text back.
      if (mine !== generation || !element.isConnected) return;
      if ((finishing && !evenWhileFinishing) || !rough.value) return;
      drafts.save({ sessionId, deadline: session.deadline, text: rough.value });
    };
    const leaving = () => { if (mine === generation) keepCopy(); };
    globalThis.addEventListener?.("pagehide", leaving);

    const paintCount = () => { count.textContent = [`${wordsText(wordCount(rough.value))}.`, wordRange(session)].filter(Boolean).join(" "); };
    const paintTimer = () => {
      const remaining = countdown.remaining();
      if (remaining === lastShown) return;
      lastShown = remaining;
      const label = timerLabel(remaining, finishing);
      clockText.textContent = formatClock(remaining);
      timerBox.dataset.state = label.state;
      symbol.textContent = label.symbol;
      stateText.textContent = label.text;
    };
    const kept = () => (drafts.inMemoryOnly ? say("voice.phoneRefused") : say("voice.keptPhone"));

    async function flush() {
      if (finishing || mine !== generation || saving) return;
      const text = rough.value;
      if (text === lastSent) return;
      saving = true;
      try {
        const reply = await api.call("PUT", "voice/session/draft", { json: body({ sessionId, text }) });
        lastSent = text;
        countdown.sync(reply.remainingSeconds);
        if (mine === generation) saveLine.textContent = say("voice.saved");
      } catch (error) {
        if (mine !== generation) return;
        const problem = voiceProblem(error);
        if (problem.code === "time-up") finish("time");
        else if (problem.code === "no-session" || problem.code === "other-session") { drafts.clear(); toChoose({ notice: say("voice.sessionMoved") }); }
        else if (problem.code === "too-long") saveLine.textContent = say("voice.roughTooLong");
        else saveLine.textContent = kept();
      } finally {
        saving = false;
        if (mine === generation && !finishing && rough.value !== lastSent) schedule(VOICE_LIMITS.autosaveMs * 2);
      }
    }
    function schedule(ms = VOICE_LIMITS.autosaveMs) {
      clock.clearTimeout(timer);
      timer = clock.setTimeout(() => flush(), ms);
    }
    rough.addEventListener("input", () => {
      paintCount();
      schedule();
      clock.clearTimeout(copyTimer);
      copyTimer = clock.setTimeout(keepCopy, VOICE_LIMITS.localSaveMs);
    });

    async function finish(reason) {
      if (finishing || mine !== generation) return;
      // The latest words go to this phone first, in case the lock never reaches the server.
      if (rough.value !== lastSent) keepCopy();
      finishing = true;
      clock.clearTimeout(timer);
      clock.clearTimeout(copyTimer);
      rough.readOnly = true;
      done.loading = true;
      over.disabled = true;
      lastShown = -1;
      paintTimer();
      message.textContent = say("voice.locking");
      announce(announcer.lock(reason !== "early"));
      const text = rough.value;
      for (let attempt = 0; attempt < LOCK_TRIES; attempt += 1) {
        try {
          const reply = await api.call("POST", "voice/session/lock", { json: body({ sessionId, text }), retry: attempt === 0 });
          if (mine === generation) {
            // The rough draft is on the server and can never change: the copy has done its job.
            drafts.clear();
            saved(reply);
          }
          return;
        } catch (error) {
          if (mine !== generation) return;
          const problem = voiceProblem(error);
          if (problem.code === "empty") {
            // Nothing written: I'm done carries on, and a finished clock leaves the server to drop it.
            if (reason === "early" && !countdown.expired()) {
              finishing = false;
              rough.readOnly = false;
              done.loading = false;
              over.disabled = false;
              lastShown = -1;
              paintTimer();
              message.textContent = say("voice.nothingYet");
              rough.focus();
            } else load();
            return;
          }
          if (problem.code === "no-session" || problem.code === "other-session") { load(); return; }
          message.textContent = say("voice.lockRetry");
          await new Promise((resolve) => clock.setTimeout(resolve, 3000));
          if (mine !== generation) return;
        }
      }
      done.loading = false;
      message.textContent = text === lastSent ? say("voice.lockFailedSent") : drafts.inMemoryOnly ? say("voice.lockFailedMemory") : say("voice.lockFailedPhone");
    }

    async function askStartOver() {
      const choiceMade = await ask({ heading: say("voice.startOverAsk"), text: say("voice.startOverText"),
        choices: [{ label: say("voice.startOverYes"), value: "over", variant: "destructive" }, { label: say("voice.keepWriting"), value: "keep", variant: "secondary" }], focus: 1 });
      if (choiceMade !== "over") { rough.focus(); return; }
      try {
        await api.call("DELETE", "voice/session", { json: body({ sessionId }) });
        drafts.clear();
        if (mine === generation) toChoose({ notice: say("voice.startedOver") });
      } catch (error) {
        if (error?.status === 401) throw error;
        // A newer piece opened elsewhere: this page is out of date and nothing was thrown away.
        if (voiceProblem(error).code === "other-session") load();
        else fill(message, ...problemLine(error));
      }
    }

    paintCount();
    paintTimer();
    if (choice.push) {
      // The server is behind this phone's copy (a lost signal): bring it up to date at once.
      saveLine.textContent = say("voice.restoredCopy");
      schedule(0);
    }
    render(
      heading(String(session.title || ""), `${base}-h`),
      session.invitation ? h("p", { class: "studio-lede", text: String(session.invitation) }) : null,
      timerBox,
      h("label", { class: "studio-voice-label", for: roughId, text: say("voice.roughLabel") }),
      rough,
      h("p", { class: "studio-help", id: `${base}-help`, text: say("voice.roughHelp") }),
      count, saveLine, message,
      h("div", { class: "studio-write-bar studio-voice-bar" }, over, done));
    if (rough.value) keepCopy();
    const tick = clock.setInterval(() => {
      if (mine !== generation) return;
      // Studio moved to another screen: the display stops with this one (the server's clock doesn't).
      if (!element.isConnected) { generation += 1; stop(); return; }
      paintTimer();
      if (!finishing) announce(announcer.update(countdown.remaining(), now()));
      if (!finishing && countdown.expired()) finish("time");
    }, 250);
    stop = () => {
      clock.clearInterval(tick);
      clock.clearTimeout(timer);
      clock.clearTimeout(copyTimer);
      globalThis.removeEventListener?.("pagehide", leaving);
    };
    running = {
      remaining: () => countdown.remaining(),
      /** Before leaving: the latest words to this phone and, if they can go, to the server. */
      async settle() { keepCopy(); await flush().catch(() => {}); },
      focus: () => rough.focus(),
    };
    currentKeys = (key) => { if (key === "enter" && !finishing) { finish("early"); return true; } return false; };
    // The cursor is in the box the moment writing starts, so typing begins without a tap.
    requestAnimationFrame(() => rough.focus());
    // A page that was away may find the time already gone.
    if (countdown.expired()) finish("time");
  }

  return {
    element,
    load,
    start: (promptId, options) => start(promptId, options),
    showChoose,
    /** True while the clock runs: leaving asks first, and a reload warns. */
    isRunning: () => Boolean(running) && !finishing && running.remaining() > 0,
    isBusy: () => finishing,
    /** Ask before leaving while the clock runs; the copy is kept either way. Resolves true to go. */
    async leave() {
      if (!running || finishing || running.remaining() <= 0) return true;
      const here = running;
      await here.settle();
      const choice = await ask({ heading: say("voice.leaveAsk"), text: say("voice.leaveText", { time: spokenTime(here.remaining()) }),
        choices: [{ label: say("voice.leaveGo"), value: "go", variant: "secondary" }, { label: say("voice.leaveStay"), value: "stay" }], focus: 1 });
      if (choice !== "go") { here.focus(); return false; }
      return true;
    },
    keys: (key) => currentKeys(key),
    destroy() { generation += 1; stop(); },
  };
}

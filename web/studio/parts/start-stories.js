// Getting started, step: Tell a few short stories (Studio R9b). Stories are R9 pieces from the
// Getting started set: private, never published, never sent anywhere unless she says so. Typed
// stories use R9's three-minute clock and rough box unchanged (voice-write.js); spoken ones are
// recorded on this phone and turned into words by the site's own transcriber (story-recorder.js),
// offered only when something can hear. Nothing here needs the writing helper.
//
// Three is the ask; one is enough. Each can be read back and thrown away. In a practice run the
// stories go to the practice library and are never among her pieces.
import { kindPacks } from "./area-rules.js";
import { fill, h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { innerAria } from "./inner-button.js";
import { createVoiceWrite, wordRange } from "./voice-write.js";
import { createStoryRecorder } from "./story-recorder.js";
import { STORIES_ASKED, storyProgress, storyRows } from "./onboarding-rules.js";
import { sayAvailable } from "./story-rules.js";
import { voiceProblem, wordsText } from "./voice-rules.js";
import { deviceNoun, herePhone } from "./notification-rules.js";

const SET = "getting-started";
let uid = 0;

/**
 * `{ element, load(), primary(), isDirty(), leave(), stop() }`. `frame` is the start screen's:
 * `{ bar(primary, extras), done(state), record(), save(patch), practice }`.
 */
export async function createStartStories({ api, frame, kind = null }) {
  // ONB1.7.1: with a kind of blog, prompts from the sets that suit it, always with one true story.
  const kindSets = kindPacks(kind);
  await use("action-button", "choice-cards", "side-sheet", "alert-banner", "skeleton-block", "modal-dialog");
  const id = `studio-stories-${++uid}`;
  const practice = frame.practice === true;
  const query = practice ? "practice=1" : "";
  const extra = practice ? { practice: true } : {};
  const here = herePhone({ navigator: globalThis.navigator, window: globalThis });
  let pieces = [];
  // Who can hear, asked once: a company (named before anything is recorded), the site's own
  // computer, or nothing (then Say it out loud isn't offered at all).
  let transcribe = (await api.get("assistant/transcribe").catch(() => null)) || {};
  let shown = [];
  let selected = "";
  let mode = "choose"; // choose | writing | saying | after
  let heardText = "";

  const progress = h("p", { class: "studio-start-progress", role: "status", "aria-live": "polite" });
  const said = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const rows = h("div", { class: "studio-start-rows" });
  const chooser = h("div", { class: "studio-start-chooser" });
  const heard = h("div", { class: "studio-start-heard" });
  const element = h("div", { class: "studio-start-step" });

  const writer = await createVoiceWrite({
    api, user: api.user, choose: false, extra,
    onSaved: (answer) => storyKept(answer?.sample, "typed"),
    onChoose: ({ notice = "" } = {}) => { mode = told().length ? "after" : "choose"; if (notice) said.textContent = notice; paint(); },
  });
  const recorder = await createStoryRecorder({
    api, user: api.user, here, noun: deviceNoun(here), query,
    transcribe,
    onPiece: (reply) => { heardText = String(reply?.text ?? ""); storyKept(reply?.sample || { id: reply?.id, words: reply?.words }, "spoken"); },
    onType: (prompt) => { if (prompt?.id) { selected = prompt.id; typeIt(); } else { mode = "choose"; paint(); } },
    onGone: () => { transcribe = { available: false }; mode = "choose"; paint(); },
  });

  const told = () => storyRows(pieces, frame.record()?.stories || []);
  const toldPrompts = () => pieces.filter((piece) => (frame.record()?.stories || []).includes(piece.id)).map((piece) => piece.prompt).filter(Boolean);

  async function loadPieces() {
    try {
      pieces = (await api.get(`voice/samples${query ? `?${query}` : ""}`)).samples || [];
    } catch (error) {
      if (error?.status === 401) throw error;
    }
  }

  async function draw({ exclude = [] } = {}) {
    const avoid = [...new Set([...toldPrompts(), ...exclude])].slice(0, 12);
    let drawn;
    try {
      drawn = await api.post("voice/draw", { ...(kindSets ? { packs: kindSets, story: true } : { pack: SET }), exclude: avoid, ...extra });
    } catch (error) {
      // A site whose own prompts dropped the set draws from every set (R9's fallback).
      if (error?.status !== 404) throw error;
      drawn = await api.post("voice/draw", { exclude: avoid, ...extra });
    }
    shown = drawn.prompts || [];
    selected = "";
  }

  function paintProgress() {
    progress.textContent = say("start.storiesProgress", { n: storyProgress(told().length) });
  }

  function paintRows() {
    const list = told();
    fill(rows, list.length ? h("h3", { class: "studio-start-rows-h", text: say("start.storiesKept") }) : null,
      list.length ? h("ul", { class: "studio-voice-rows" }, list.map((row) => {
        const read = h("action-button", { variant: "secondary", size: "sm", onClick: (event) => readIt(row, event.currentTarget) }, say("start.readIt"));
        innerAria(read, { "aria-label": say("start.readItName", { title: row.title }) });
        const away = h("action-button", { variant: "ghost", size: "sm", onClick: (event) => throwAway(row, event.currentTarget) }, say("start.storyThrow"));
        innerAria(away, { "aria-label": say("start.storyThrowName", { title: row.title }) });
        return h("li", { class: "studio-voice-row" }, h("span", { class: "studio-voice-row-text", text: row.line }), h("span", { class: "studio-row" }, read, away));
      })) : null);
  }

  function paintChooser() {
    const cards = h("choice-cards", { label: say("start.chooseLegend"), class: "studio-voice-cards", onValuechange: (event) => { selected = event.detail || ""; first.hidden = true; paintHow(); } });
    cards.items = shown.map((prompt) => ({ id: prompt.id, title: String(prompt.title || ""), detail: [prompt.invitation, wordRange(prompt)].filter(Boolean).join(" ") }));
    cards.value = selected;
    const first = h("p", { class: "studio-field-error", id: `${id}-first`, hidden: true, text: say("voice.chooseFirst") });
    const how = h("div", { class: "studio-start-how" });
    const more = h("action-button", { variant: "secondary", onClick: async () => {
      more.loading = true;
      try {
        await draw({ exclude: shown.map((prompt) => prompt.id) });
        paintChooser();
        said.textContent = say("voice.drewMore");
        requestAnimationFrame(() => chooser.querySelector("choice-cards button")?.focus());
      } catch (error) {
        if (error?.status === 401) throw error;
        said.textContent = voiceProblem(error).words;
      } finally {
        more.loading = false;
      }
    } }, say("voice.drawMore"));
    const needChoice = (run) => (event) => {
      if (!selected) { first.hidden = false; chooser.querySelector("choice-cards button")?.focus(); return; }
      run(event);
    };
    function paintHow() {
      const canSay = sayAvailable(transcribe);
      fill(how,
        h("p", { class: "studio-start-how-legend", id: `${id}-how`, text: say("start.howLegend") }),
        h("div", { class: "studio-row studio-start-ways", role: "group", "aria-labelledby": `${id}-how` },
          h("action-button", { onClick: needChoice(() => typeIt()) }, say("start.typeIt")),
          canSay ? h("action-button", { variant: "secondary", onClick: needChoice((event) => sayIt(event)) }, say("start.sayIt")) : null),
        h("p", { class: "studio-help", text: say("start.typeItHelp") }),
        canSay ? h("p", { class: "studio-help", text: say("start.sayItHelp") }) : null);
    }
    paintHow();
    fill(chooser,
      h("p", { class: "studio-help studio-voice-legend", "aria-hidden": "true", text: say("start.chooseLegend") }),
      cards, first, h("div", { class: "studio-row" }, more), how,
      told().length ? null : h("div", { class: "studio-row" }, h("action-button", { variant: "ghost", onClick: () => frame.done("skipped") }, say("start.skipStories"))));
  }

  function paintHeard() {
    if (!heardText) { fill(heard); return; }
    fill(heard,
      h("h3", { text: say("start.heard") }),
      h("p", { class: "studio-help", text: say("start.heardNote") }),
      h("div", { class: "studio-voice-rough-text", tabindex: "0", role: "region", "aria-label": say("start.heardRegion"), text: heardText }),
      h("p", { class: "studio-help", text: `${wordsText(heardText.trim().split(/\s+/).filter(Boolean).length)}.` }));
  }

  function paint() {
    paintProgress();
    paintRows();
    const count = told().length;
    const intro = [
      h("p", { class: "studio-lede", text: say("start.storiesLede") }),
      h("p", { class: "studio-start-private", text: say("start.storiesPrivate") }),
    ];
    if (mode === "writing") {
      fill(element, progress, writer.element, said);
      frame.bar(null);
      return;
    }
    if (mode === "saying") {
      fill(element, ...intro, progress, recorder.element, said, rows);
      frame.bar(null);
      return;
    }
    if (mode === "after") {
      paintHeard();
      const done = count >= STORIES_ASKED;
      fill(element, ...intro, progress, said, heard, rows, recorder.element);
      const next = h("action-button", { onClick: () => frame.done("done") }, done ? say("start.next") : say("start.enough"));
      if (done) { frame.bar(next); return; }
      const another = h("action-button", { onClick: () => tellAnother() }, say("start.tellAnother"));
      next.variant = "secondary";
      frame.bar(another, [next]);
      return;
    }
    paintChooser();
    fill(element, ...intro, progress, chooser, said, recorder.element, rows);
    // No primary until a way is chosen; with a story told already, Next is there.
    frame.bar(count ? h("action-button", { variant: "secondary", onClick: () => frame.done("done") }, say("start.enough")) : null);
  }

  async function tellAnother() {
    heardText = "";
    said.textContent = "";
    try {
      await draw();
    } catch (error) {
      if (error?.status === 401) throw error;
      said.textContent = voiceProblem(error).words;
    }
    mode = "choose";
    paint();
    requestAnimationFrame(() => chooser.querySelector("choice-cards button")?.focus());
  }

  async function typeIt() {
    said.textContent = "";
    mode = "writing";
    paint();
    const started = await writer.start(selected, { status: said });
    if (!started && !writer.isRunning()) { mode = told().length ? "after" : "choose"; paint(); }
  }

  async function sayIt(event) {
    const prompt = shown.find((p) => p.id === selected);
    if (!prompt) return;
    mode = "saying";
    paint();
    await recorder.begin(prompt, event);
    if (!recorder.busy() && !recorder.hasRecording() && recorder.element.hidden) { mode = told().length ? "after" : "choose"; paint(); }
  }

  /** A story is on the server: remember it in this run, say so, and offer the next thing. */
  async function storyKept(sample, how) {
    if (!sample?.id) { mode = "choose"; paint(); return; }
    await loadPieces();
    // The list may not say how it was told yet (an older server): this run knows.
    pieces = pieces.map((piece) => (piece.id === sample.id && !piece.told ? { ...piece, told: how } : piece));
    const stories = [...new Set([...(frame.record()?.stories || []), sample.id])];
    await frame.save({ stories, steps: { stories: "done" } });
    if (how !== "spoken") heardText = "";
    const n = storyProgress(told().length);
    mode = "after";
    paint();
    said.textContent = n >= STORIES_ASKED ? say("start.storiesDone") : say("start.storySaved", { n });
    requestAnimationFrame(() => frame.focusPrimary());
  }

  async function readIt(row, opener) {
    let text = "";
    try {
      text = String((await api.get(`voice/samples/${encodeURIComponent(row.id)}${query ? `?${query}` : ""}`)).body ?? "");
    } catch (error) {
      if (error?.status === 401) throw error;
      said.textContent = voiceProblem(error).code === "gone" ? say("start.storyGone") : voiceProblem(error).words;
      return;
    }
    const close = () => { sheet.open = false; sheet.remove(); opener?.querySelector?.("button")?.focus(); };
    const sheet = h("side-sheet", { label: row.title, side: "right", class: "studio-wide-sheet" },
      h("span", { slot: "heading", text: row.title }),
      h("div", { class: "studio-voice-rough-text", tabindex: "0", role: "region", "aria-label": row.told === "spoken" ? say("start.heardRegion") : say("voice.roughRegion"), text }),
      h("div", { slot: "actions" }, h("action-button", { variant: "secondary", onClick: close }, say("start.readClose"))));
    sheet.addEventListener("openchange", (event) => { if (event.target === sheet && !event.detail) { sheet.remove(); opener?.querySelector?.("button")?.focus(); } });
    document.body.append(sheet);
    sheet.open = true;
  }

  async function throwAway(row, opener) {
    const choice = await ask({ heading: say("start.storyThrowAsk"), text: say("start.storyThrowText"),
      choices: [{ label: say("start.storyThrowYes"), value: "throw", variant: "destructive" }, { label: say("start.storyThrowNo"), value: "keep", variant: "secondary" }], focus: 1 });
    if (choice !== "throw") { opener?.querySelector?.("button")?.focus(); return; }
    try {
      await api.call("DELETE", `voice/samples/${encodeURIComponent(row.id)}${query ? `?${query}` : ""}`, { json: {} });
    } catch (error) {
      if (error?.status === 401) throw error;
      const code = error?.data?.code;
      if (code !== "gone") { said.textContent = code === "in-session" ? say("start.storyBusy") : voiceProblem(error).words; return; }
      said.textContent = say("start.storyGone");
    }
    await loadPieces();
    const stories = (frame.record()?.stories || []).filter((kept) => kept !== row.id);
    await frame.save({ stories, ...(stories.length ? {} : { steps: { stories: "pending" } }) });
    heardText = "";
    toast(say("start.storyThrown"));
    if (!stories.length) { await draw().catch(() => {}); mode = "choose"; }
    paint();
    requestAnimationFrame(() => (rows.querySelector("button") || chooser.querySelector("choice-cards button") || element)?.focus?.());
  }

  async function load() {
    await loadPieces();
    await draw();
    // A typed story in progress (a reload, another phone) resumes inside its clock; a recording
    // kept on this phone shows ready to use.
    mode = told().length ? "after" : "choose";
    paint();
    mode = "writing";
    fill(element, progress, writer.element, said);
    frame.bar(null);
    await writer.load();
    if (!writer.isRunning() && !writer.isBusy()) {
      mode = told().length ? "after" : "choose";
      const kept = await recorder.restore();
      if (kept) {
        const prompt = shown.find((p) => p.id === kept);
        if (prompt) recorder.setPrompt(prompt);
        mode = "saying";
      }
      paint();
    }
  }

  return {
    element,
    load,
    primary: () => writer.keys("enter"),
    isDirty: () => writer.isRunning() || recorder.busy(),
    /** Leaving while the clock runs asks first (R9's question); a recording in progress stops and is kept. */
    async leave() {
      if (!(await writer.leave())) return false;
      recorder.stop();
      writer.destroy();
      return true;
    },
    stop() { recorder.stop(); writer.destroy(); },
  };
}

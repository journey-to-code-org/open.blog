// Getting started, step: Let your helper learn how you sound (Studio R9b). R9's voice guide
// steps (voice-guide-steps.js) with this account's stories: the "what goes" box names the company
// with Word for word, nothing is sent until she presses, and nothing is saved until Save my
// voice guide. In a practice run the proposal is made for real from the practice stories, and
// Save is replaced by "Practice: not saved".
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { createGuideSteps } from "./voice-guide-steps.js";
import { guidePieces } from "./voice-guide-rules.js";
import { voiceGuideOf } from "./helper-context-rules.js";
import { companyName } from "./helper-rules.js";
import { wordsText } from "./voice-rules.js";

/**
 * `{ element, load(), primary(), isDirty(), leave() }`. `frame` is the start screen's:
 * `{ bar(primary, extras), done(state), save(patch), record(), practice }`.
 */
export async function createStartVoice({ api, frame, status }) {
  await use("action-button", "alert-banner");
  const practice = frame.practice === true;
  const host = h("div", { class: "studio-voice-host" });
  const said = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const element = h("div", { class: "studio-start-step" }, h("p", { class: "studio-lede", text: say("start.voiceLede") }), host, said);
  let steps = null;
  let settled = false;

  const next = (state) => h("action-button", { onClick: () => frame.done(state) }, say("start.next"));

  async function load() {
    const query = practice ? "?practice=1" : "";
    const [listing, catalog] = await Promise.all([api.get(`voice/samples${query}`), practice ? Promise.resolve({}) : api.get("assistant/context?content=none")]);
    const mine = new Set(frame.record()?.stories || []);
    // Only her own stories (G79): the ones told in this run, and any piece that says it is hers.
    const own = (listing.samples || []).filter((piece) => mine.has(piece.id) || piece.by === api.user);
    const pieces = guidePieces(own.map((piece) => (practice ? { ...piece, visibility: "private" } : piece)), catalog);
    const told = new Map(own.map((piece) => [`voice:${piece.visibility}:${piece.file}`, piece.told === "spoken" ? "spoken" : "typed"]));
    steps = await createGuideSteps({
      api, status, pieces, catalog, guide: practice ? null : voiceGuideOf(catalog), practice,
      extra: practice ? { practice: true } : {},
      exact: practice ? async (ids) => {
        const texts = [];
        for (const id of ids) {
          const file = id.split(":").pop().replace(/\.md$/, "");
          texts.push(String((await api.get(`voice/samples/${encodeURIComponent(file)}?practice=1`)).body ?? ""));
        }
        return texts.join("\n\n----\n\n");
      } : null,
      words: {
        from: say("start.voiceFrom"), propose: say("start.voiceLearn"), proposeNew: say("start.voiceLearn"), saved: say("start.voiceSaved"), practiceSave: say("start.practiceNoSave"),
        row: (piece) => (told.get(piece.id) === "spoken" ? say("start.voiceRowSpoken", { title: piece.title, words: wordsText(piece.words) }) : say("start.voiceRowTyped", { title: piece.title, words: wordsText(piece.words) })),
      },
      barStart: [h("action-button", { variant: "secondary", onClick: () => frame.done("skipped") }, say("start.voiceSkip"))],
      onStep: (step) => { if (step === "result" && practice) frame.bar(next("skipped")); else if (!settled) frame.bar(null); },
      onSaved: async (visibility) => {
        // Saved (or, after Undo, back as it was): the step is settled either way, and Next is there.
        settled = true;
        await frame.save({ steps: { voice: visibility ? "done" : "skipped" } });
        frame.bar(next(visibility ? "done" : "skipped"));
        if (visibility) requestAnimationFrame(() => frame.focusPrimary());
      },
      onDiscarded: () => frame.done("skipped"),
      onProblem: (problem) => {
        if (problem.code !== "key-rejected") return;
        // Her stories are kept; the helper can't learn until the key is right.
        fill(host, h("alert-banner", { variant: "warning" }, say("start.voiceKeyProblem", { company: companyName(status || {}) })));
        frame.bar(next("not-ready"));
      },
    });
    fill(host, steps.element);
    frame.bar(null);
  }

  return {
    element,
    load,
    primary: () => steps?.keys("enter"),
    isDirty: () => Boolean(steps?.isDirty()) && !practice,
    leave: async () => (steps && !practice ? steps.leave() : true),
    back: () => steps?.keys("back"),
  };
}

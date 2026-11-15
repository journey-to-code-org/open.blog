// The one gentle reminder in Write (Studio R9b): "Want your helper to sound like you?" Only as a
// new post opens, only when the server says it is due (she left the stories without telling one,
// has none of her own, hasn't said Don't ask again, has seen it fewer than three times, and not
// this week), and never once she has typed in this visit. It doesn't move or close by itself.
// Any failure means no card this time, without a word.
import { fill, h, toast } from "./dom.js";
import { say } from "./words.js";
import { createDidLine } from "./did-line.js";
import { nudgeAllowed } from "./onboarding-rules.js";

/** How long Write waits for the server's answer before giving up for this visit. */
export const NUDGE_WAIT_MS = 1500;

/**
 * `{ element, load() }`. `isNew()` is whether this is a new post; `typed()` whether she has typed
 * in this visit; `go()` leaves for the stories (through Write's own leave-guard); `focusTitle()`.
 */
export function createStoryNudge({ api, meta, isNew, typed, go, focusTitle, clock = globalThis }) {
  const said = createDidLine();
  const host = h("div", { class: "studio-story-nudge-host" });
  const element = h("div", { class: "studio-story-nudge", hidden: true }, host, said.element);
  const tell = (event) => api.post("onboarding/nudge", { event, newPost: true }).catch((error) => { if (error?.status === 401) throw error; });

  function gone(words) {
    fill(host);
    toast(words);
    focusTitle();
  }

  function show() {
    const headingId = "studio-story-nudge-h";
    fill(host, h("section", { class: "studio-comment studio-story-nudge-card", "aria-labelledby": headingId },
      h("h3", { id: headingId, text: say("write.storyNudgeHeading") }),
      h("p", { text: say("write.storyNudgeText") }),
      h("div", { class: "studio-comment-actions" },
        h("action-button", { onClick: async () => { await tell("accepted"); go(); } }, say("write.storyNudgeYes")),
        h("action-button", { variant: "secondary", onClick: async () => { await tell("later"); element.hidden = true; gone(say("write.storyNudgeLaterDone")); } }, say("write.storyNudgeLater"))),
      h("action-button", { variant: "ghost", onClick: async () => {
        // Said once, kept everywhere: Home's invitation to write a first piece goes with it.
        await tell("stop");
        await api.post("voice/invitation", { dismissed: true }).catch(() => {});
        gone(say("write.storyNudgeStopped"));
        said.tell(say("write.storyNudgeStopped"), { undoLabel: say("write.storyNudgeUndo"), undo: async () => {
          await tell("unstop");
          await api.post("voice/invitation", { dismissed: false }).catch(() => {});
          said.clear();
          show();
        } });
      } }, say("write.storyNudgeStop"))));
    element.hidden = false;
  }

  async function load() {
    if (!meta?.onboarding || meta.onboarding.mode === "off" || !nudgeAllowed(typed(), isNew())) return;
    let timer = 0;
    const late = new Promise((resolve) => { timer = clock.setTimeout(() => resolve(null), NUDGE_WAIT_MS); });
    const answer = await Promise.race([api.get("onboarding/nudge").catch(() => null), late]);
    clock.clearTimeout(timer);
    // If she has typed before the answer came, it isn't shown: nothing moves under her fingers.
    if (answer?.due !== true || !nudgeAllowed(typed(), isNew())) return;
    show();
    tell("shown");
  }

  return { element, load };
}

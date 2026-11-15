// Your voice guide (Studio R9, #/voice/guide): "Write down how I sound, from my pieces." The two
// steps are parts/voice-guide-steps.js; this screen loads what they need, shows the guide as it
// is now (read only, asked for when opened), and keeps Move under For {helper}. Needs the helper:
// without it, the page says so and points {helper} to the setup.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { ask } from "../parts/dialogs.js";
import { createDidLine } from "../parts/did-line.js";
import { createGuideSteps } from "../parts/voice-guide-steps.js";
import { guidePieces } from "../parts/voice-guide-rules.js";
import { voiceGuideOf } from "../parts/helper-context-rules.js";
import { voiceProblem } from "../parts/voice-rules.js";

export async function createVoiceGuideScreen(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "empty-state", "skeleton-block");
  const heading = h("h2", { id: "studio-guide-h", class: "studio-question", tabindex: "-1", text: say("voice.guideHeading") });
  const now = h("div", {});
  const host = h("div", { class: "studio-voice-host" }, h("skeleton-block", { lines: 5 }));
  const whereSlot = h("div", {});
  const element = h("section", { class: "studio-page studio-voice-guide-page", "aria-labelledby": "studio-guide-h" },
    h("breadcrumb-trail", { items: [{ label: say("voice.home"), href: "#/" }, { label: say("voice.title"), href: "#/voice" }, { label: say("voice.guideCrumb"), href: "" }] }),
    heading, h("p", { class: "studio-lede", text: say("voice.guideLede") }), now, host, whereSlot);
  let steps = null;

  /** The guide as it is now: read only, fetched only when she opens it. */
  function paintNow(guide) {
    if (!guide) { fill(now); return; }
    const text = h("pre", { class: "studio-guide-now", tabindex: "0", "aria-label": say("voice.guideNow") });
    const details = h("details", { class: "studio-voice-details" }, h("summary", { text: say("voice.guideNow") }), text);
    let asked = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || asked) return;
      asked = true;
      text.textContent = say("voice.guideNowLoading");
      try {
        const item = await api.get(`assistant/context/item?id=${encodeURIComponent(guide.id)}`);
        text.textContent = String(item.content ?? "");
      } catch (error) {
        if (error?.status === 401) throw error;
        asked = false;
        text.textContent = say("voice.guideNowFailed");
      }
    });
    fill(now, details);
    if (route.query?.read === "1") { details.open = true; requestAnimationFrame(() => details.querySelector("summary")?.focus()); }
  }

  /** For {helper}: where the guide is kept, and moving it (the server's plan, a confirm, Undo). */
  function paintWhere(guide) {
    const said = createDidLine();
    const path = guide ? (guide.visibility === "portable" ? "assistant/context/voice.md" : ".openblog/private/context/voice.md") : "";
    const to = guide?.visibility === "portable" ? "private" : "portable";
    async function move(target, { undoable = true } = {}) {
      try {
        const plan = (await api.get(`voice/guide/move?to=${encodeURIComponent(target)}`)).move;
        if (undoable) {
          const choice = await ask({ heading: say("voice.guideMoveAsk"), text: say("voice.guideMovePlan", { from: String(plan.fromPath), to: String(plan.toPath), bytes: Number(plan.bytes) || 0 }),
            choices: [{ label: say("voice.guideMoveYes"), value: "move" }, { label: say("voice.guideMoveNo"), value: "leave", variant: "secondary" }], focus: 1 });
          if (choice !== "move") return;
        }
        await api.post("voice/guide/move", { to: target });
        await load();
        const line = createDidLine();
        whereSlot.querySelector("details")?.append(line.element);
        if (whereSlot.querySelector("details")) whereSlot.querySelector("details").open = true;
        line.tell(say("voice.guideMoved", { where: target }), undoable ? { undoLabel: say("voice.undo"), undo: () => move(target === "portable" ? "private" : "portable", { undoable: false }) } : {});
      } catch (error) {
        if (error?.status === 401) throw error;
        said.tell(say("voice.moveFailed", { reason: voiceProblem(error).details || String(error?.status || "") }), { variant: "problem" });
      }
    }
    fill(whereSlot, h("details", { class: "studio-voice-details" }, h("summary", { text: say("common.forHelper") }),
      h("p", { class: "studio-mono", text: guide ? say("voice.guideWhere", { path }) : say("voice.guideWhereNone") }),
      guide ? h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", size: "sm", onClick: () => move(to) }, say("voice.guideMove", { where: to }))) : null,
      said.element));
  }

  async function load() {
    let status;
    let listing;
    let catalog;
    try {
      status = await api.get("assistant/status");
      [listing, catalog] = await Promise.all([api.get("voice/samples"), api.get("assistant/context?content=none")]);
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = voiceProblem(error);
      fill(host, h("alert-banner", { variant: problem.signal ? "info" : "danger" }, h("p", { text: problem.signal ? say("voice.noSignalList") : say("voice.loadFailed") }),
        h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
      return;
    }
    if (status.configured !== true) {
      fill(now);
      fill(whereSlot);
      fill(host, h("empty-state", { heading: say("voice.guideHelperOff") }, say("common.tell"),
        h("details", { slot: "actions", class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("a", { class: "studio-more-link", href: "#/helper?setup=1", text: say("voice.setUpHelper") }))));
      return;
    }
    const pieces = guidePieces(listing.samples || [], catalog);
    const guide = voiceGuideOf(catalog);
    paintNow(guide);
    paintWhere(guide);
    if (!pieces.length) {
      fill(host, h("empty-state", { heading: say("voice.guideNeedsPieces") }, h("action-button", { slot: "actions", href: "#/voice/write", size: "lg" }, say("voice.writeOne"))));
      return;
    }
    steps = await createGuideSteps({
      api, status, pieces, catalog, guide,
      onSaved: (visibility) => { const next = visibility ? { id: `${visibility}:voice`, visibility } : guide; paintNow(next); paintWhere(next); },
    });
    fill(host, steps.element);
  }

  element.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft" && steps?.keys("back")) event.preventDefault();
  });

  return {
    title: say("voice.guideHeading"),
    element,
    load,
    focus: () => { if (route.query?.read !== "1") heading.focus(); },
    isDirty: () => Boolean(steps?.isDirty()),
    leave: async () => (steps ? steps.leave() : true),
    keys: ["publish"],
    command(id) { if (id === "publish") steps?.keys("enter"); },
  };
}

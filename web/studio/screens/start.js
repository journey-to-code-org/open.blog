// Getting started (Studio R9b, #/start → #/start/<step>): "Get me ready to write, and teach the
// helper how I sound." At most three short steps: turn on the writing helper (only when the site
// has no key), tell a few short stories, let the helper learn from them; then You're ready. Each
// step is skippable and resumable: where she is lives in her record on the server (never in this
// phone's storage), so a reload, a closed app or another phone lands on the same step.
//
// The frame hides the navigation and Find (chrome: "focus") but keeps the account menu, so
// sign-out is always there, and every step has Back, Finish later and Skip the rest: nothing
// depends on the browser's Back. In a practice run (the server is rehearsing) every step says so,
// and nothing personal is kept.
import { fill, glyph, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { innerAria } from "../parts/inner-button.js";
import { doneLines, needsKey, nextStep, previousStep, recordAfter, startProblem, startSteps, stepName, stepNumber, stepRoute } from "../parts/onboarding-rules.js";
import { createStartKey } from "../parts/start-key.js";
import { createStartStories } from "../parts/start-stories.js";
import { createStartVoice } from "../parts/start-voice.js";

// When this window last moved between steps itself, so arriving at a step right after isn't
// announced as "picked up where you left off".
let movedAt = 0;

/** A Write address to go back to (from the reminder), and nothing else. */
const backRoute = (value) => (typeof value === "string" && /^#\/write(\/[^\s]*)?$/.test(value) && value.length <= 300 ? value : "");

export async function createStart(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "dropdown-menu", "step-indicator", "skeleton-block", "content-card");
  const back = backRoute(route.query?.back);
  const query = back ? `back=${encodeURIComponent(back)}` : "";
  let info = null;
  let record = null;
  let etag = "";
  let status = null;
  let plan = null;
  let step = "";
  let part = null;
  let practice = false;

  const welcome = h("div", { class: "studio-start-welcome" });
  const strip = h("div", { class: "studio-banner" });
  const indicator = h("step-indicator", { class: "studio-start-indicator", onStepselect: async (event) => {
    // Only back to a step already passed (the same as ‹ Back, more than once).
    const to = plan?.steps[event.detail];
    if (!to || event.detail >= stepNumber(plan, step) - 1 || !(await leaveStep())) return;
    movedAt = Date.now();
    context.go(stepRoute(to, query));
  } });
  const stepOf = h("p", { class: "studio-meta" });
  const progress = h("div", { class: "studio-start-progress-row" }, stepOf, indicator);
  const heading = h("h2", { id: "studio-start-h", class: "studio-question", tabindex: "-1" });
  const announce = h("p", { class: "studio-visually-hidden", role: "status", "aria-live": "polite" });
  const resumed = h("p", { class: "studio-help", role: "status" });
  const host = h("div", { class: "studio-start-host" }, h("skeleton-block", { lines: 5 }));
  const backButton = h("action-button", { variant: "ghost", "aria-keyshortcuts": "Alt+ArrowLeft", onClick: () => goBack() }, glyph("‹ "), say("start.back"));
  const later = h("action-button", { variant: "ghost", onClick: () => finishLater() }, back ? say("start.backToPost") : say("start.finishLater"));
  const more = h("dropdown-menu", { label: say("start.more"), class: "studio-row-menu", items: [{ value: "skip", label: say("start.skipRest") }], onItemselect: (event) => { if (event.detail === "skip") skipRest(); } });
  const extras = h("span", { class: "studio-start-extras studio-row" });
  const primarySlot = h("span", { class: "studio-start-primary" });
  const bar = h("div", { class: "studio-write-bar studio-start-bar" }, backButton, later, more, extras, primarySlot);
  const element = h("section", { class: "studio-page studio-start", "aria-labelledby": "studio-start-h" }, welcome, strip, progress, heading, announce, resumed, host, bar);

  innerAria(more, { "aria-label": say("start.moreName") });

  const frame = {
    get practice() { return practice; },
    record: () => record,
    /** The step's own button (or none), and quieter ones beside it. */
    bar(primary, extra = []) {
      fill(primarySlot, primary || null);
      fill(extras, ...extra);
    },
    focusPrimary: () => (primarySlot.querySelector("button") || heading).focus(),
    save: (patch) => save(patch),
    /** Settle this step (`done`, `skipped` or `not-ready`) and move to the next. */
    async done(state) {
      const event = state === "done" ? "step-done" : state === "not-ready" ? "step-not-ready" : "step-skipped";
      // What she has told since this step opened counts (the voice step needs a story).
      plan = startSteps(status, { stories: (record?.stories || []).length }, record);
      const patch = recordAfter(plan, event, step);
      const saved = await save(patch);
      if (!saved) return;
      movedAt = Date.now();
      context.go(stepRoute(patch.step || nextStep(plan, step), query));
    },
  };

  /** Write her record. A newer one somewhere else (another phone) is adopted quietly, and its step shown. */
  async function save(patch) {
    try {
      const reply = await api.put("onboarding", { etag, ...patch, ...(practice ? { practice: true } : {}) });
      record = reply.record;
      etag = reply.etag;
      return true;
    } catch (error) {
      if (error?.status === 401) throw error;
      const problem = startProblem(error);
      if (problem.code === "stale" && error.data?.record) {
        record = error.data.record;
        etag = error.data.etag || "";
        movedAt = Date.now();
        context.go(stepRoute(record.step, query));
        return false;
      }
      if (!problem.quiet) toast(problem.words, { variant: "warning" });
      return false;
    }
  }

  async function leaveStep() {
    return part?.leave ? part.leave() : true;
  }

  async function goBack() {
    const before = plan && step !== "done" ? previousStep(plan, step) : null;
    if (!before || !(await leaveStep())) return;
    movedAt = Date.now();
    context.go(stepRoute(before, query));
  }

  async function finishLater() {
    if (!(await leaveStep())) return;
    part?.stop?.();
    part = null;
    if (back) { context.go(back); return; }
    // The server's time: it won't open by itself again for a while, and Home keeps its card.
    await save({ lastAutoOpen: true });
    await context.refreshMeta?.();
    toast(say("start.laterToast"));
    context.go("#/");
  }

  async function skipRest() {
    if (!(await leaveStep())) return;
    part?.stop?.();
    part = null;
    // Nothing is lost: everything already told is kept.
    if (!(await save({ status: "skipped" }))) return;
    toast(say("start.skipRestDone"));
    await context.refreshMeta?.();
    context.go("#/");
  }

  function paintFrame() {
    const n = stepNumber(plan, step);
    const shown = n > 0;
    progress.hidden = !shown;
    if (shown) {
      stepOf.textContent = say("start.stepOf", { n, total: plan.total });
      indicator.steps = plan.steps.map(stepName);
      indicator.current = n - 1;
      // The component hides each step's words on a narrow screen: every button keeps its name,
      // and only a step already passed can be pressed.
      requestAnimationFrame(() => {
        indicator.querySelector("nav")?.setAttribute("aria-label", say("start.stepName", { n, total: plan.total }));
        indicator.querySelectorAll("button").forEach((button, index) => {
          button.setAttribute("aria-label", say("start.stepAnnounce", { n: index + 1, total: plan.total, step: stepName(plan.steps[index]) }));
          if (index >= n - 1) button.setAttribute("aria-disabled", "true"); else button.removeAttribute("aria-disabled");
        });
      });
      announce.textContent = say("start.stepAnnounce", { n, total: plan.total, step: stepName(step) });
    }
    fill(welcome, n === 1 ? h("p", { class: "studio-start-hello", text: say("start.welcome") }) : null, n === 1 ? h("p", { class: "studio-lede", text: say("start.welcomeLede") }) : null);
    fill(strip, practice ? h("alert-banner", { variant: "info" }, say("start.practice")) : null);
    backButton.hidden = !plan || step === "done" || !previousStep(plan, step);
    more.hidden = step === "done";
    later.hidden = step === "done";
    heading.textContent = step === "helper" ? say("start.keyHeading") : step === "stories" ? say("start.storiesHeading") : step === "voice" ? say("start.voiceHeading") : say("start.doneHeading");
  }

  async function showDone() {
    // Reaching this screen is what "done" means.
    if (record?.status === "in-progress") await save({ status: "done", step: "done" });
    await context.refreshMeta?.();
    let stories = (record?.stories || []).length;
    try {
      const listing = await api.get(`voice/samples${practice ? "?practice=1" : ""}`);
      stories = (listing.samples || []).filter((piece) => piece.valid && piece.stage === "rough" && ((record?.stories || []).includes(piece.id) || piece.by === api.user)).length;
    } catch (error) {
      if (error?.status === 401) throw error;
    }
    const hasPosts = await context.posts?.list().then((items) => items.length > 0, () => false);
    fill(host,
      h("ul", { class: "studio-start-done" }, doneLines(record, status, stories).map((line) => h("li", {},
        h("span", { "aria-hidden": "true", text: line.ok ? "✓ " : "– " }), h("span", { class: "studio-visually-hidden", text: `${line.ok ? say("start.markDone") : say("start.markNotYet")} ` }), line.words))),
      h("a", { class: "studio-more-link", href: "#/voice", text: say("start.doneSeeStories") }));
    frame.bar(
      back ? h("action-button", { href: back }, say("start.backToPost")) : h("action-button", { href: "#/write/new" }, hasPosts ? say("start.doneWriteAgain") : say("start.doneWrite")),
      [h("action-button", { variant: "secondary", href: "#/" }, say("start.doneHome"))]);
  }

  function showProblem(error) {
    const problem = startProblem(error);
    progress.hidden = true;
    backButton.hidden = true;
    more.hidden = true;
    heading.textContent = say("start.title");
    fill(host, h("alert-banner", { variant: problem.signal ? "info" : "danger" }, h("p", { text: problem.words || say("start.loadFailed") }),
      problem.details ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${problem.code}: ${problem.details}` })) : null,
      h("action-button", { variant: "secondary", onClick: () => load() }, say("common.tryAgain"))));
    frame.bar(null);
  }

  async function load() {
    frame.bar(null);
    try {
      [info, status] = await Promise.all([api.get("onboarding"), api.get("assistant/status")]);
    } catch (error) {
      if (error?.status === 401) throw error;
      showProblem(error);
      return;
    }
    practice = info.practice === true;
    record = info.record;
    etag = info.etag || "";
    const existed = Boolean(record);
    if (!record) {
      if (!(await save({ total: needsKey(status) ? 3 : 2 }))) { if (!record) { showProblem({ status: 500 }); return; } }
    } else if (record.status !== "in-progress" && (!route.arg || route.query?.again || (back && route.arg !== "done"))) {
      // From the menu (#/start), Find or the reminder in Write, once finished: a new run at the
      // first needed step, in the same round. A step's own address after finishing (the
      // browser's Back) shows You're ready.
      if (!(await save({ restart: true, total: needsKey(status) ? 3 : 2 }))) return;
    }
    plan = startSteps(status, { stories: (record.stories || []).length }, record);
    let wanted = record.status !== "in-progress" ? "done" : ["helper", "stories", "voice", "done"].includes(route.arg) ? route.arg : record.step || plan.steps[0];
    if (wanted === "helper" && !plan.steps.includes("helper")) wanted = "stories";
    if (wanted === "voice" && plan.states.voice === "not-ready") { await save({ steps: { voice: "not-ready" } }); wanted = "done"; }
    step = wanted;
    if (route.arg !== step || route.query?.again) context.replaceRoute?.(stepRoute(step, query));
    if (record.status === "in-progress" && record.step !== step && step !== "done") await save({ step });
    paintFrame();
    resumed.textContent = existed && step !== "done" && Date.now() - movedAt > 3000 && record.status === "in-progress" && (step !== plan.steps[0] || (record.stories || []).length || record.lastAutoOpen) ? say("start.resumed") : "";
    try {
      if (step === "helper") part = await createStartKey({ api, frame });
      else if (step === "stories") part = await createStartStories({ api, frame, kind: context.meta?.areas?.kind || null });
      else if (step === "voice") part = await createStartVoice({ api, frame, status });
      else part = null;
      if (part) {
        fill(host, part.element);
        await part.load();
      } else {
        await showDone();
      }
    } catch (error) {
      if (error?.status === 401) throw error;
      showProblem(error);
    }
  }

  element.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft" && !document.querySelector("modal-dialog[open], side-sheet[open]")) {
      event.preventDefault();
      if (!part?.back?.()) goBack();
    }
  });

  return {
    title: say("start.title"),
    element,
    load,
    focus: () => { if (!host.contains(document.activeElement) || document.activeElement === document.body) heading.focus(); },
    isDirty: () => Boolean(part?.isDirty?.()),
    async leave() {
      if (!(await leaveStep())) return false;
      part?.stop?.();
      part?.clearKey?.();
      return true;
    },
    keys: ["publish"],
    command(id) { if (id === "publish") part?.primary?.(); },
  };
}

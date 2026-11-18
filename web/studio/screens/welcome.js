// About your blog (ONB1, #/welcome[/<question>|/summary|/suggestions|/voice]?a=...): "What is my
// blog, so it shows me what I need?" Up to six questions, one per screen, each skippable; a summary
// that says what will show and why; site changes the answers suggest, applied only on a press;
// and the offer to learn how she writes, which goes on to Getting started's stories.
//
// It is the opening of a Getting started run (R9b) while this login hasn't answered, and is asked
// again from What you use. Answers ride in the address until Save these, so a reload or Back
// resumes exactly and nothing is kept on the phone or sent before then. The frame hides the
// navigation and Find (chrome "focus"); the account menu stays.
import { fill, glyph, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { innerAria } from "../parts/inner-button.js";
import { QUESTIONS, QUESTION_IDS, answersFrom, areasFor, questionNumber, savePatch, startingAnswers, stepAfter, stepBefore, welcomeHash, welcomeStep } from "../parts/welcome-rules.js";
import { createWelcomeAfter } from "../parts/welcome-after.js";
import { choiceHelp, choiceText, questionText } from "../parts/welcome-text.js";

export async function createWelcome(context, route = {}) {
  const { meta } = context;
  await use("action-button", "alert-banner", "choice-cards", "dropdown-menu", "content-card", "skeleton-block");
  const step = welcomeStep(route.arg);
  const fromAddress = answersFrom(route.query?.a);
  const answers = startingAnswers(fromAddress, meta.areas?.answers, meta.areas?.hint);
  const practice = context.areas?.practice === true || meta.onboarding?.practice === true;
  const preselected = !Object.keys(fromAddress).length && !Object.keys(meta.areas?.answers || {}).length && answers.kind === meta.areas?.hint && Boolean(answers.kind);
  const go = (to, a = answers) => context.go(welcomeHash(to, a));

  const top = h("div", { class: "studio-start-welcome" });
  const strip = h("div", { class: "studio-banner" });
  const of = h("p", { class: "studio-meta", role: "status" });
  const heading = h("h2", { id: "studio-welcome-h", class: "studio-question", tabindex: "-1" });
  const host = h("div", { class: "studio-start-host" });
  const backButton = h("action-button", { variant: "ghost", "aria-keyshortcuts": "Alt+ArrowLeft", onClick: () => back() }, glyph("‹ "), say("welcome.back"));
  const skipOne = h("action-button", { variant: "ghost", onClick: () => next(true) }, say("welcome.skipOne"));
  const more = h("dropdown-menu", { label: say("welcome.more"), class: "studio-row-menu", items: [{ value: "skip", label: say("welcome.skipAll") }], onItemselect: (event) => { if (event.detail === "skip") skipAll(); } });
  innerAria(more, { "aria-label": say("welcome.moreName") });
  const extras = h("span", { class: "studio-start-extras studio-row" });
  const primarySlot = h("span", { class: "studio-start-primary" });
  const bar = h("div", { class: "studio-write-bar studio-start-bar" }, backButton, skipOne, more, extras, primarySlot);
  const element = h("section", { class: "studio-page studio-start studio-welcome", "aria-labelledby": "studio-welcome-h" }, top, strip, of, heading, host, bar);

  const frame = {
    bar(primary, extra = []) { fill(primarySlot, primary || null); fill(extras, ...extra); },
    heading: (text) => { heading.textContent = text; },
    host,
    answers,
    go,
    practice,
  };

  let selected = "";
  function question() {
    const n = questionNumber(step);
    const spec = QUESTIONS[n - 1];
    selected = answers[step] || "";
    fill(top, n === 1 ? h("p", { class: "studio-start-hello", text: say("welcome.hello") }) : null, n === 1 ? h("p", { class: "studio-lede", text: say("welcome.lede") }) : null);
    of.textContent = say("welcome.of", { n, total: QUESTION_IDS.length });
    heading.textContent = questionText(step);
    const forHelper = h("p", { class: "studio-mono" });
    const paintHelper = () => {
      const result = selected ? areasFor({ [step]: selected }, []) : null;
      const turned = result ? result.shown.filter((id) => result.reasons[id].why !== "unasked") : [];
      forHelper.textContent = turned.length ? say("welcome.forHelper", { areas: turned.join(", ") }) : say("welcome.forHelperNone");
    };
    const cards = h("choice-cards", { label: questionText(step), class: "studio-welcome-cards", onValuechange: (event) => { selected = event.detail || ""; paintHelper(); } });
    cards.items = spec.choices.map((choice) => ({ id: choice, title: choiceText(step, choice), detail: choiceHelp(step, choice) }));
    cards.value = selected;
    paintHelper();
    fill(host,
      preselected && step === "kind" ? h("p", { class: "studio-help", text: say("welcome.fromInit") }) : null,
      cards,
      h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), forHelper));
    backButton.hidden = n === 1;
    skipOne.hidden = false;
    more.hidden = false;
    frame.bar(h("action-button", { onClick: () => next(false) }, say("welcome.next")));
  }

  function next(skip) {
    const a = { ...answers };
    if (skip) delete a[step];
    else if (selected) a[step] = selected;
    else delete a[step];
    go(stepAfter(step), a);
  }

  function back() {
    const before = stepBefore(step);
    if (before) go(before);
  }

  async function skipAll() {
    const saved = await context.areas.save({ onboarding: { state: "skipped" } });
    if (!saved.ok && saved.code !== "stale") {
      toast(saved.code === "no-signal" ? say("welcome.noSignal") : say("welcome.notSaved"), { variant: "warning" });
      return;
    }
    toast(say("welcome.skippedToast"));
    go("voice");
  }

  function load() {
    fill(strip, practice ? h("alert-banner", { variant: "info" }, say("welcome.practice")) : null);
    if (QUESTION_IDS.includes(step)) {
      question();
      // Answers the screen started from (saved, or init's kind) go into the address, so a reload keeps them.
      if (!Object.keys(fromAddress).length && Object.keys(answers).length) context.replaceRoute?.(welcomeHash(step, answers));
      return;
    }
    fill(top);
    of.textContent = "";
    skipOne.hidden = true;
    more.hidden = true;
    backButton.hidden = step === "voice";
    return createWelcomeAfter(context, step, frame).catch((error) => {
      if (error?.status === 401) throw error;
      fill(host, h("alert-banner", { variant: "danger" }, say("welcome.notSaved")));
    });
  }

  element.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowLeft" && !document.querySelector("modal-dialog[open], side-sheet[open]")) {
      event.preventDefault();
      if (!backButton.hidden) back();
    }
  });

  return {
    title: say("welcome.title"),
    element,
    load,
    focus: () => heading.focus(),
    keys: ["publish"],
    command(id) { if (id === "publish") primarySlot.querySelector("action-button")?.click(); },
  };
}


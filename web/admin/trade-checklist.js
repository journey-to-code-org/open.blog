// The ten-minute checklist for a trade site (ADR 0401, #529). Admin's home shows it on a trade site until the owner
// dismisses it. Each step comes from `GET /admin/api/trade-checklist`, which works it out from the files every time,
// so a step is ticked only when the site really has it. Nothing here records a click as progress.

import { el } from "./block-forms.js";

/** The words for each step the server names, in the server's order. An id this version does not know is skipped. */
export const STEP_TEXT = Object.freeze({
  business: { label: "Add your phone number or email", hint: "Under Business facts, so customers can reach you.", action: "Open Business facts" },
  service: { label: "Publish your first service", hint: "Edit one of the example services, then turn off Keep this as a draft.", action: "Open Services" },
  job: { label: "Publish your first job", hint: "Take photos on site with Capture, then finish and publish the job.", action: "Start a job" },
  review: { label: "Save your first review", hint: "Copy a real customer review from its link, or type it in.", action: "Open Reviews" },
  destination: { label: "Share a job where customers look", hint: "Open a published job and choose Share this job: Google, Facebook or Nextdoor.", action: "Open your newest job", waiting: "Publish a job first; then you can share it." },
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SAFE_HREF = /^#\/[A-Za-z0-9%._~!*'()\/-]*$/;

/** The steps from a server answer, keeping only known ids, true booleans and safe in-Admin links. */
export function checklistSteps(data) {
  if (!isObject(data) || !Array.isArray(data.steps)) return [];
  return data.steps
    .filter((step) => isObject(step) && Object.hasOwn(STEP_TEXT, step.id))
    .map((step) => ({ id: step.id, done: step.done === true, href: typeof step.href === "string" && SAFE_HREF.test(step.href) ? step.href : null }));
}

/** Whether the card is shown: a trade site, a readable answer, not dismissed, and something still to do. */
export function checklistVisible({ dismissed, data }) {
  if (dismissed === true || !isObject(data) || data.applies !== true) return false;
  const steps = checklistSteps(data);
  return steps.length > 0 && steps.some((step) => !step.done);
}

let uid = 0;

/** The card. `onDismiss` resolves false (or throws) when the choice could not be saved; the card then stays. */
export function buildTradeChecklist({ data, onDismiss, onGone = () => {} }) {
  const id = `oba-trade-checklist-${++uid}`;
  const steps = checklistSteps(data);
  const done = steps.filter((step) => step.done).length;
  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-trade-checklist-status": "true" });
  const dismiss = el(
    "button",
    {
      class: "oba-btn",
      type: "button",
      "data-action": "trade-checklist-dismiss",
      "aria-label": "Hide this checklist",
      onClick: async () => {
        dismiss.disabled = true;
        let saved = false;
        try {
          saved = (await onDismiss()) !== false;
        } catch {
          saved = false;
        }
        if (saved) {
          element.remove();
          onGone();
          return;
        }
        dismiss.disabled = false;
        status.textContent = "That could not be remembered just now, so the checklist stays. Try again later.";
      },
    },
    "Hide",
  );
  const items = steps.map((step) => {
    const text = STEP_TEXT[step.id];
    const state = step.done ? "Done" : "To do";
    const action = step.done
      ? null
      : step.href
        ? el("a", { class: "oba-btn", href: step.href, "data-action": `trade-checklist-${step.id}` }, text.action)
        : el("span", { class: "oba-small" }, text.waiting || "");
    return el(
      "li",
      { class: `oba-trade-step${step.done ? " oba-trade-step-done" : ""}`, "data-step": step.id, "data-done": step.done ? "true" : "false" },
      el("span", { class: "oba-trade-step-mark", "aria-hidden": "true" }, step.done ? "✓" : "○"),
      el("span", { class: "oba-trade-step-text" }, el("strong", {}, text.label), el("span", { class: "oba-sr" }, ` (${state})`), el("span", { class: "oba-small" }, text.hint)),
      action,
    );
  });
  const element = el(
    "section",
    { class: "oba-notice oba-trade-checklist", "aria-labelledby": id, "data-trade-checklist": "true" },
    el("h2", { id }, "Your site in ten minutes"),
    el("p", {}, `${done} of ${steps.length} done. Each step ticks itself once your site has it.`),
    el("ol", { class: "oba-trade-steps" }, ...items),
    el("div", { class: "oba-landing-actions" }, dismiss),
    status,
  );
  return { element };
}

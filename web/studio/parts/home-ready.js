// Home's "Get your site ready" list on a trade site (the ten-minute checklist, ADR 0401) and the
// notes about her recipe list (G14), R1. Each step ticks itself from the files (the server works it
// out); hiding the list is the one thing remembered (G13). Titles and values are only ever text.
// docs/specs/studio/r1/ux.md.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { STEP_TEXT, checklistDone, checklistSteps, checklistVisible, progressWords, recipeNoteWords, stepHref } from "./checklist-rules.js";

const SAID_READY = "studio:checklist:ready-said";

/** The recipe notes banner, or null when there's nothing to say (never a failure). */
export async function recipeNotesBanner(api) {
  await use("alert-banner", "action-button");
  let items = [];
  try {
    items = (await api.get("recipe-notes")).items || [];
  } catch (error) {
    if (error.status === 401) throw error;
    return null;
  }
  const notes = items.map(recipeNoteWords).filter(Boolean);
  if (!notes.length) return null;
  return h("alert-banner", { variant: "info", heading: "About your recipe list", class: "studio-recipe-notes" },
    ...notes.map((note) => h("div", { class: "studio-recipe-note" },
      h("p", { text: note.text }),
      note.open ? h("action-button", { variant: "secondary", size: "sm", href: note.open.href }, note.open.label) : null,
      note.help ? h("p", { class: "studio-help", text: note.help }) : null)));
}

/**
 * The checklist on Home: { element, load, show() }. `show()` brings a hidden list back (Find:
 * "Get your site ready").
 */
export async function createReadyList({ api }) {
  await use("action-button", "alert-banner", "dropdown-menu", "status-badge");
  const element = h("section", { class: "studio-section studio-checklist", "aria-labelledby": "studio-ready-h", hidden: true });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  let data = null;

  async function load() {
    try {
      data = await api.get("trade-checklist");
    } catch (error) {
      if (error.status === 401) throw error;
      data = null; // Home never shows a failure here.
    }
    draw();
  }

  function draw() {
    if (checklistDone(data) && data?.dismissed !== true) {
      element.hidden = true;
      element.replaceChildren();
      let said = false;
      try { said = localStorage.getItem(SAID_READY) === "1"; localStorage.setItem(SAID_READY, "1"); } catch { said = true; }
      if (!said) toast("Your site is ready.");
      return;
    }
    if (!checklistVisible({ dismissed: data?.dismissed, data })) {
      element.hidden = true;
      element.replaceChildren(status);
      return;
    }
    const steps = checklistSteps(data);
    const firstOpen = steps.find((step) => !step.done);
    const menu = h("dropdown-menu", { class: "studio-row-menu", items: [{ value: "hide", label: "Hide this list" }], onItemselect: () => hide(menu) },
      h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: " for get your site ready" })));
    element.hidden = false;
    element.replaceChildren(
      h("div", { class: "studio-comment-head" }, h("h3", { id: "studio-ready-h", class: "studio-comment-who", tabindex: "-1", text: "Get your site ready" }), menu),
      h("p", { class: "studio-help", text: progressWords(steps) }),
      h("ol", { "aria-label": "Steps" }, ...steps.map((step) => {
        const text = STEP_TEXT[step.id];
        const href = stepHref(step);
        const first = step === firstOpen;
        const action = step.done ? null
          : href ? h("action-button", { variant: "secondary", size: first ? "md" : "sm", href, label: `${text.action}: ${text.label}` }, first ? text.action : "Open")
            : null;
        return h("li", { "data-step": step.id, "data-done": step.done ? "true" : "false" },
          h("div", { class: "studio-step-head" },
            h("strong", { text: text.label }),
            step.done ? h("status-badge", { variant: "success" }, "Done") : h("span", { class: "studio-visually-hidden", text: "Not done yet" }),
            first ? null : action),
          first ? h("p", { class: "studio-help", text: href || !text.waiting ? text.hint : text.waiting }) : null,
          !step.done && !href && !first && text.waiting ? h("p", { class: "studio-help", text: text.waiting }) : null,
          first ? action : null);
      })),
      status);
  }

  async function setDismissed(dismissed) {
    await api.put("trade-checklist", { dismissed });
    data = { ...data, dismissed };
  }

  async function hide(menu) {
    try {
      await setDismissed(true);
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = "That couldn't be remembered just now, so the list stays. Try again later.";
      menu?.querySelector("button")?.focus();
      return;
    }
    const words = "Hidden. Find “Get your site ready” to see it again.";
    const undo = h("action-button", { size: "sm", onClick: () => show() }, "Undo");
    element.hidden = false;
    element.replaceChildren(h("alert-banner", { variant: "info", dismissible: true, heading: words }, undo), status);
    toast(words);
    requestAnimationFrame(() => undo.querySelector("button")?.focus());
  }

  async function show() {
    try {
      await setDismissed(false);
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = "That didn't go through. Try again.";
      return;
    }
    draw();
    requestAnimationFrame(() => element.querySelector("h3")?.focus());
  }

  return { element, load, show, get applies() { return data?.applies === true; } };
}

// The Design a theme screen (ADR 0410): describe the look you want in your own words, and the Assistant
// drafts a theme you can preview, change ("a bit warmer"), name and save. Saving makes a new theme;
// it changes nothing you already have, and you put it on from Seasons when you want it.
//
// The Assistant only proposes six colours for light and dark, a font, a corner style and a text size.
// The server checks every proposal, makes every colour that carries writing easy to read, and says what
// it changed; this screen only shows what the server sends. The pure functions at the top are the
// contract and are tested without a page.

import { el } from "./block-forms.js";

/** Ideas to start from, for an owner who does not know where to begin. */
export const IDEAS = Object.freeze([
  "Cozy Christmas kitchen: cranberry red, pine green and a little gold, with big easy-to-read writing.",
  "Spring garden: soft greens and lilac on a light page, gentle and airy.",
  "Fourth of July picnic: navy, barn red and white, cheerful and bold.",
  "Fall harvest: pumpkin, wheat and deep brown, warm like a farm table.",
  "Snowy evening: dark blue night with warm candlelight gold.",
]);

export const MAX_DESCRIPTION = 1000;
export const MAX_LABEL = 40;
const SWATCH_KEYS = Object.freeze([
  ["page", "Page"],
  ["surface", "Boxes"],
  ["text", "Writing"],
  ["muted", "Quiet writing"],
  ["border", "Edges"],
  ["accent", "Links and buttons"],
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The swatches to show for one scheme of a made theme (after the server made it readable). */
export function swatches(theme, scheme) {
  const colors = isObject(theme?.colors?.[scheme]) ? theme.colors[scheme] : {};
  return SWATCH_KEYS.filter(([key]) => typeof colors[key] === "string").map(([key, label]) => ({ key, label, color: colors[key] }));
}

/** What is wrong with a description, in plain words, or "". */
export function descriptionProblem(text) {
  const value = String(text ?? "").trim();
  if (!value) return "Describe the look you want in a few words first.";
  if ([...value].length > MAX_DESCRIPTION) return `That is ${[...value].length} characters; the most is ${MAX_DESCRIPTION}. Say it a little shorter.`;
  return "";
}

/** What is wrong with a theme name, in plain words, or "". */
export function labelProblem(text) {
  const value = String(text ?? "").trim();
  if (!value) return "Give your theme a name.";
  if ([...value].length > MAX_LABEL) return `Keep the name to ${MAX_LABEL} characters or fewer.`;
  if (/[\u0000-\u001f]/u.test(value)) return "Keep the name on one line.";
  return "";
}

/** The draft with a new name, as the server will check it again. */
export function renamed(draft, label) {
  return { ...draft, label: String(label ?? "").trim() };
}

/** The Start from choices: every theme of the site except the plain engine default, by name. */
export function startFrom(options) {
  const themes = Array.isArray(options?.themes) ? options.themes : [];
  return themes
    .filter((theme) => typeof theme?.name === "string" && (theme.name !== "base" || options.current === "base"))
    .map((theme) => ({ value: theme.name, label: theme.label || theme.name }));
}

/** A plain-words account of a failed request. */
export function designerErrorText(error) {
  const code = error?.data?.code;
  if (error?.status === 401) return "Your session has ended. Sign in again to keep going.";
  if (code === "not-configured" || error?.status === 404) return "The Assistant is not set up on this site yet, so it cannot draft a theme. Someone with access to the site's settings can turn it on (see the Admin guide, Optional AI assistance).";
  if (code === "concurrency-limit" || error?.status === 429) return "The Assistant is busy with something else. Wait a moment and try again.";
  if (code === "invalid-result" || error?.status === 502) return "The Assistant's idea could not be used, so nothing changed. Try again, or say it a different way.";
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `That did not work. ${detail}` : "That did not work. Check your connection and try again.";
}

export function createThemeDesigner({ api, makeFrame }) {
  let draft = null;
  let theme = null;
  let mode = "light";
  let busy = false;
  let destroyed = false;

  const root = el("div", { class: "oba-designer", "data-designer-screen": "true" });
  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-designer-status": "true" });
  const say = (message, kind = "small") => {
    status.className = kind === "error" ? "oba-error" : kind === "ok" ? "oba-ok" : "oba-small";
    status.setAttribute("role", kind === "error" ? "alert" : "status");
    status.textContent = message;
  };

  // ----- start from: the new theme keeps this theme's layout and decorations
  const base = el("select", { id: "oba-designer-base", "data-designer-base": "true" });
  base.addEventListener("change", () => refreshPreview());

  // ----- describe
  const words = el("textarea", { id: "oba-designer-words", rows: 4, maxlength: MAX_DESCRIPTION, "data-designer-words": "true", placeholder: "For example: warm like my kitchen at Christmas, deep red and pine green, big easy-to-read writing." });
  const ideas = el("div", { class: "oba-designer-ideas", role: "group", "aria-label": "Ideas to start from" },
    ...IDEAS.map((idea) => el("button", { class: "oba-btn oba-designer-idea", type: "button", onClick: () => { words.value = idea; words.focus(); } }, idea.split(":")[0])),
  );
  const draftButton = el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "designer-draft", onClick: () => ask(false) }, "Draft a theme");

  // ----- the result
  const result = el("section", { class: "oba-designer-result", hidden: true, "aria-labelledby": "oba-designer-result-title", "data-designer-result": "true" });
  const title = el("h3", { id: "oba-designer-result-title", tabindex: "-1" });
  const summary = el("p", { class: "oba-designer-summary" });
  const notes = el("ul", { class: "oba-designer-notes", "data-designer-notes": "true" });
  const palette = el("div", { class: "oba-designer-swatches", "data-designer-swatches": "true" });
  const modeButtons = ["light", "dark"].map((id) =>
    el("button", { class: "oba-btn", type: "button", "data-mode": id, "aria-pressed": String(id === mode), onClick: () => { mode = id; showPalette(); refreshPreview(); } }, id === "light" ? "Light" : "Dark"),
  );
  const frame = makeFrame ? makeFrame({ title: "Preview of your site in this theme" }) : null;
  const change = el("textarea", { id: "oba-designer-change", rows: 2, maxlength: MAX_DESCRIPTION, "data-designer-change": "true", placeholder: "For example: a little warmer, and less green." });
  const changeButton = el("button", { class: "oba-btn", type: "button", "data-action": "designer-change", onClick: () => ask(true) }, "Change it");
  const name = el("input", { id: "oba-designer-name", type: "text", maxlength: MAX_LABEL, "data-designer-name": "true" });
  const nameProblem = el("p", { class: "oba-field-error", hidden: true });
  const saveButton = el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "designer-save", onClick: () => save() }, "Save this theme");
  const savedBox = el("div", { class: "oba-notice", hidden: true, "data-designer-saved": "true" });

  // Set through the style object: the Admin's content policy refuses inline style attributes.
  const chip = (color) => {
    const node = el("span", { class: "oba-designer-chip", "aria-hidden": "true" });
    node.style.backgroundColor = color;
    return node;
  };

  const showPalette = () => {
    for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    palette.replaceChildren(...swatches(theme, mode).map((swatch) =>
      el("span", { class: "oba-designer-swatch" },
        chip(swatch.color),
        el("span", {}, swatch.label),
      ),
    ));
  };

  async function refreshPreview() {
    if (!frame || !draft) return;
    try {
      const preview = await api.call("POST", "theme-draft/preview", { json: { draft: renamed(draft, name.value || draft.label), mode, base: base.value || null } });
      if (destroyed) return;
      frame.show(preview.previewUrl);
    } catch (error) {
      if (error?.status === 401) throw error;
      frame.say?.("The preview could not be made just now.");
    }
  }

  const show = (answer) => {
    draft = answer.draft;
    theme = answer.theme;
    title.textContent = draft.label;
    summary.textContent = draft.summary || "";
    name.value = draft.label;
    const adjusted = Array.isArray(answer.notes) ? answer.notes : [];
    notes.hidden = !adjusted.length;
    notes.replaceChildren(...adjusted.map((note) => el("li", {}, note)));
    savedBox.hidden = true;
    result.hidden = false;
    showPalette();
    refreshPreview();
    title.focus();
  };

  async function ask(changing) {
    if (busy) return;
    const text = changing ? change.value : words.value;
    const problem = descriptionProblem(text);
    if (problem) {
      say(problem, "error");
      (changing ? change : words).focus();
      return;
    }
    busy = true;
    draftButton.disabled = changeButton.disabled = true;
    say(changing ? "Asking the Assistant to change it…" : "Asking the Assistant for a theme… this can take a little while.");
    try {
      const answer = await api.call("POST", "theme-draft", { json: { description: text, previous: changing ? renamed(draft, name.value || draft.label) : null, base: base.value || null } });
      if (destroyed) return;
      show(answer);
      if (changing) change.value = "";
      say("Here is an idea. Look at the preview, change it if you like, then save it.", "ok");
    } catch (error) {
      if (error?.status === 401) throw error;
      say(designerErrorText(error), "error");
    } finally {
      busy = false;
      draftButton.disabled = changeButton.disabled = false;
    }
  }

  async function save() {
    if (busy || !draft) return;
    const problem = labelProblem(name.value);
    nameProblem.hidden = !problem;
    nameProblem.textContent = problem;
    if (problem) {
      name.focus();
      return;
    }
    busy = true;
    saveButton.disabled = true;
    say("Saving your theme…");
    try {
      const saved = await api.call("POST", "theme-draft/save", { json: { draft: renamed(draft, name.value), base: base.value || null } });
      if (destroyed) return;
      savedBox.hidden = false;
      savedBox.replaceChildren(
        el("p", {}, `Saved as “${saved.label}”. Nothing on your site has changed yet.`),
        el("p", {}, "To put it on, open ", el("a", { href: "#/seasons" }, "Seasons"), ": choose it for your site now, or add it as a season so it goes up on its own days."),
      );
      say(saved.buildError ? `Saved, but your site could not be rebuilt yet: ${saved.buildError}` : "Saved.", saved.buildError ? "error" : "ok");
    } catch (error) {
      if (error?.status === 401) throw error;
      say(designerErrorText(error), "error");
    } finally {
      busy = false;
      saveButton.disabled = false;
    }
  }

  result.append(
    title,
    summary,
    notes,
    el("div", { class: "oba-designer-modes", role: "group", "aria-label": "Light or dark" }, ...modeButtons),
    palette,
    frame ? frame.root : el("p", {}, "No preview available."),
    el("div", { class: "oba-field" }, el("label", { for: change.id }, "Want something different? Say what to change"), change, changeButton),
    el("div", { class: "oba-field" }, el("label", { for: name.id }, "Name"), name, nameProblem),
    el("div", { class: "oba-toolbar" }, saveButton),
    savedBox,
  );

  root.append(
    el("section", { class: "oba-contributor-intro" }, el("p", {}, "Describe the look you want in your own words: the colours, the feeling, how big the writing should be. The Assistant drafts a theme, you see it on your own site, and nothing changes until you save it and choose to put it on.")),
    el("div", { class: "oba-field" },
      el("label", { for: base.id }, "Start from"),
      el("p", { class: "oba-help" }, "Your new theme keeps this one's layout and decorations, like its garland or snow, and changes the colours and writing."),
      base,
    ),
    el("div", { class: "oba-field" }, el("label", { for: words.id }, "Describe the look you want"), words),
    el("p", { class: "oba-small" }, "Or start from an idea:"),
    ideas,
    el("div", { class: "oba-toolbar" }, draftButton),
    status,
    result,
  );

  /** Fill the Start from list with the site's themes, the one it wears now chosen. */
  async function load() {
    try {
      const options = await api.call("GET", "theme-draft");
      if (destroyed) return;
      base.replaceChildren(...startFrom(options).map((option) => el("option", { value: option.value }, option.label)));
      base.value = options.current || "";
    } catch (error) {
      if (error?.status === 401) throw error;
      base.replaceChildren(el("option", { value: "" }, "Your site's theme"));
    }
  }

  return {
    element: root,
    load,
    isDirty: () => Boolean(draft) && savedBox.hidden,
    isBusy: () => busy,
    destroy: () => {
      destroyed = true;
    },
  };
}

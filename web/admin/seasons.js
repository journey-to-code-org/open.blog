// The Seasons screen (ADR 0407): choose the theme your site wears, and, if you like, let the calendar
// change it: Thanksgiving from October 15, Christmas from December 1, your everyday look in between.
// It is the only place in Admin that sets the site theme.
//
// Written for someone who decorates a house, not a developer: months by name, days from a list, one
// switch for "change with the calendar", and a sentence that says what visitors see today and what
// comes next. Every control is native and at least 44px tall. The server judges the save again, so a
// rule can never pass here and fail there.
//
// The pure functions at the top are the contract and are tested without a page.

import { el } from "./block-forms.js";

export const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);
/** Days in each month; February allows the 29th, which is the 28th in a year without one. */
export const MONTH_DAYS = Object.freeze([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
export const MAX_WINDOWS = 24;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pad = (n) => String(n).padStart(2, "0");

/** `"12-01"` as `{ month: 12, day: 1 }`, or null when it is not a day of the year. */
export function parseMonthDay(text) {
  const match = /^(\d{2})-(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > MONTH_DAYS[month - 1]) return null;
  return { month, day };
}

export const monthDayText = ({ month, day }) => `${pad(month)}-${pad(day)}`;

/** "December 1": how a day of the year is said on the screen. */
export const sayMonthDay = ({ month, day }) => `${MONTHS[month - 1]} ${day}`;

/** The form for what the server sent. */
export function formFromSeasons(result) {
  const seasons = isObject(result?.seasons) ? result.seasons : {};
  const windows = Array.isArray(seasons.windows) ? seasons.windows : [];
  return {
    theme: typeof result?.theme === "string" ? result.theme : "",
    enabled: seasons.enabled === true,
    windows: windows.map((window) => ({
      theme: String(window?.theme ?? ""),
      start: parseMonthDay(window?.start) ?? { month: 1, day: 1 },
      end: parseMonthDay(window?.end) ?? { month: 1, day: 1 },
    })),
  };
}

/** What the server is sent. */
export function seasonsFromForm(form) {
  return {
    theme: form.theme,
    seasons: {
      version: 1,
      enabled: form.enabled === true,
      windows: form.windows.map((window) => ({
        theme: window.theme,
        start: monthDayText(window.start),
        end: monthDayText(window.end),
      })),
    },
  };
}

export const sameSeasons = (a, b) => JSON.stringify(seasonsFromForm(a)) === JSON.stringify(seasonsFromForm(b));

/** Every problem, each tied to where it is shown: `{ field, index?, message }`. */
export function validateForm(form) {
  const problems = [];
  if (!form.theme) problems.push({ field: "theme", message: "Choose the theme your site wears." });
  if (form.windows.length > MAX_WINDOWS) problems.push({ field: "windows", message: `List at most ${MAX_WINDOWS} seasons.` });
  form.windows.forEach((window, index) => {
    if (!window.theme) problems.push({ field: "window", index, message: "Choose what this season puts up." });
    for (const [key, word] of [["start", "starts"], ["end", "ends"]]) {
      const { month, day } = window[key];
      if (!(month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1])) {
        problems.push({ field: "window", index, message: `The day it ${word} is not a day of the year.` });
      }
    }
  });
  if (form.enabled && !form.windows.length) {
    problems.push({ field: "windows", message: "Add a season, or turn off changing with the calendar." });
  }
  return problems;
}

/** The sentence at the top: what visitors see today, and what changes next. */
export function todaySentence(result, labelOf = (name) => name) {
  const wearing = result?.wearing;
  if (!wearing) return "";
  const parts = [`Today your site is decorated for ${labelOf(wearing)}.`];
  const next = result?.next;
  const day = parseMonthDay(String(next?.day ?? "").slice(5));
  if (next && day) parts.push(`On ${sayMonthDay(day)} it changes to ${labelOf(next.theme)}.`);
  return parts.join(" ");
}

/** A friendly message for a failed request. */
export function seasonsErrorText(error) {
  const status = error?.status;
  if (status === 401) return "Your session ended. Sign in again to save.";
  if (status === 409) return "The seasons changed in another window or by someone else. Reload them, then make your changes again.";
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `The seasons were not saved. ${detail}` : "The seasons were not saved. Check your connection and try again.";
}

/** A new season that starts the day after the last one ends and lasts about a month. */
export function nextWindow(form, themes) {
  const last = form.windows.at(-1);
  const start = last ? { ...last.end } : { month: 1, day: 1 };
  if (last) {
    start.day += 1;
    if (start.day > MONTH_DAYS[start.month - 1]) {
      start.day = 1;
      start.month = start.month === 12 ? 1 : start.month + 1;
    }
  }
  const end = { month: start.month, day: Math.min(start.day + 29, MONTH_DAYS[start.month - 1]) };
  const unused = themes.find((theme) => theme.name !== form.theme && !form.windows.some((w) => w.theme === theme.name));
  return { theme: unused?.name ?? themes[0]?.name ?? "", start, end };
}

let uid = 0;

export function createSeasons({ api }) {
  const id = `oba-seasons-${++uid}`;
  let form = formFromSeasons({});
  let saved = formFromSeasons({});
  let etag = "";
  let themes = [];
  let latest = null;
  let busy = false;
  let destroyed = false;

  const root = el("div", { class: "oba-seasons", "data-seasons-screen": "true" });
  const today = el("p", { class: "oba-seasons-today", "data-seasons-today": "true" });
  const status = el("p", { class: "oba-small oba-seasons-status", role: "status", "aria-live": "polite", "data-seasons-status": "true" });
  const conflict = el("div", { class: "oba-notice", hidden: true, "data-seasons-conflict": "true" });
  const body = el("form", { class: "oba-seasons-form", novalidate: true, "aria-label": "Seasons", onSubmit: (event) => { event.preventDefault(); save(); } });
  const saveButton = el("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-action": "seasons-save" }, "Save seasons");
  const dirtyNote = el("span", { class: "oba-small", "data-seasons-dirty": "true" });

  const labelOf = (name) => themes.find((theme) => theme.name === name)?.label || name;
  const say = (message, kind = "small") => {
    status.className = `oba-seasons-status oba-${kind === "error" ? "error" : kind === "ok" ? "ok" : "small"}`;
    status.setAttribute("role", kind === "error" ? "alert" : "status");
    status.textContent = message;
  };
  const isDirty = () => !sameSeasons(form, saved);
  const changed = () => {
    dirtyNote.textContent = isDirty() ? "You have unsaved changes." : "All changes saved.";
  };

  const themeSelect = (value, label, onChange, extra = {}) => {
    const control = el("select", { ...extra }, ...themes.map((theme) => el("option", { value: theme.name }, theme.label || theme.name)));
    control.value = value;
    control.setAttribute("aria-label", label);
    control.addEventListener("change", () => onChange(control.value));
    return control;
  };
  const dayPicker = (value, label, onChange) => {
    const month = el("select", { "aria-label": `${label}: month` }, ...MONTHS.map((name, i) => el("option", { value: String(i + 1) }, name)));
    const day = el("select", { "aria-label": `${label}: day` });
    const fillDays = () => {
      const count = MONTH_DAYS[Number(month.value) - 1];
      day.replaceChildren(...Array.from({ length: count }, (_, i) => el("option", { value: String(i + 1) }, String(i + 1))));
    };
    month.value = String(value.month);
    fillDays();
    day.value = String(Math.min(value.day, MONTH_DAYS[value.month - 1]));
    month.addEventListener("change", () => {
      const keep = Number(day.value);
      fillDays();
      day.value = String(Math.min(keep, MONTH_DAYS[Number(month.value) - 1]));
      onChange({ month: Number(month.value), day: Number(day.value) });
    });
    day.addEventListener("change", () => onChange({ month: Number(month.value), day: Number(day.value) }));
    return el("span", { class: "oba-seasons-day" }, month, day);
  };

  const windowRow = (window, index) => {
    const row = el("li", { class: "oba-seasons-window", "data-season-index": String(index) },
      el("div", { class: "oba-seasons-window-line" },
        themeSelect(window.theme, `Season ${index + 1}: what goes up`, (value) => { window.theme = value; changed(); }, { "data-season-theme": "true" }),
        el("span", {}, "from"),
        dayPicker(window.start, `Season ${index + 1} starts`, (value) => { window.start = value; changed(); }),
        el("span", {}, "until"),
        dayPicker(window.end, `Season ${index + 1} ends`, (value) => { window.end = value; changed(); }),
      ),
      el("div", { class: "oba-seasons-window-actions" },
        el("button", { class: "oba-btn", type: "button", disabled: index === 0, "aria-label": `Move season ${index + 1} up`, onClick: () => move(index, -1) }, "Move up"),
        el("button", { class: "oba-btn", type: "button", disabled: index === form.windows.length - 1, "aria-label": `Move season ${index + 1} down`, onClick: () => move(index, 1) }, "Move down"),
        el("button", { class: "oba-btn oba-btn-danger", type: "button", "data-action": "season-remove", onClick: () => { form.windows.splice(index, 1); build(); say(`Removed. Not saved yet.`); } }, "Remove"),
      ),
      el("p", { class: "oba-error", hidden: true, "data-problem-for": `window-${index}` }),
    );
    return row;
  };
  const move = (index, by) => {
    const [window] = form.windows.splice(index, 1);
    form.windows.splice(index + by, 0, window);
    build();
    root.querySelector(`[data-season-index="${index + by}"] select`)?.focus();
  };

  const build = () => {
    const everyday = el("div", { class: "oba-field" },
      el("label", { for: `${id}-theme` }, form.enabled ? "Between seasons, your site wears" : "Your site wears"),
      el("p", { class: "oba-help" }, form.enabled
        ? "Your everyday look, on any day none of your seasons covers."
        : "This is the look every visitor sees until you change it."),
      themeSelect(form.theme, "", (value) => { form.theme = value; changed(); }, { id: `${id}-theme`, "data-seasons-theme": "true" }),
      el("p", { class: "oba-error", hidden: true, "data-problem-for": "theme" }),
    );
    everyday.querySelector("select").removeAttribute("aria-label");

    const toggle = el("input", { id: `${id}-enabled`, type: "checkbox", checked: form.enabled, "data-seasons-enabled": "true" });
    toggle.addEventListener("change", () => {
      form.enabled = toggle.checked;
      if (form.enabled && !form.windows.length) form.windows.push(nextWindow(form, themes));
      build();
      root.querySelector(`#${id}-enabled`)?.focus();
    });

    const calendar = el("fieldset", { class: "oba-seasons-calendar", hidden: !form.enabled },
      el("legend", {}, "Your seasons"),
      el("p", { class: "oba-help" }, "Each season puts up its decorations on its first day and takes them down after its last. A season can run past New Year. If two overlap, the one higher in the list wins."),
      el("ol", { class: "oba-seasons-list" }, ...form.windows.map(windowRow)),
      el("p", { class: "oba-error", hidden: true, "data-problem-for": "windows" }),
      el("button", { class: "oba-btn", type: "button", "data-action": "season-add", disabled: form.windows.length >= MAX_WINDOWS, onClick: () => {
        form.windows.push(nextWindow(form, themes));
        build();
        root.querySelector(`[data-season-index="${form.windows.length - 1}"] select`)?.focus();
      } }, "Add a season"),
    );

    body.replaceChildren(
      el("div", { class: "oba-field oba-seasons-switch" },
        el("label", { for: toggle.id }, toggle, " Change the decorations with the calendar"),
        el("p", { class: "oba-help" }, "Your site switches by itself on the days you choose. Nothing else on your site changes."),
      ),
      calendar,
      everyday,
      el("div", { class: "oba-seasons-actions" }, saveButton, dirtyNote),
    );
    changed();
  };

  const showProblems = (problems) => {
    for (const node of root.querySelectorAll("[data-problem-for]")) {
      node.hidden = true;
      node.textContent = "";
    }
    let first = null;
    for (const problem of problems) {
      const key = problem.field === "window" ? `window-${problem.index}` : problem.field;
      const node = root.querySelector(`[data-problem-for="${key}"]`);
      if (!node) continue;
      node.hidden = false;
      node.textContent = node.textContent ? `${node.textContent} ${problem.message}` : problem.message;
      first ||= node.closest(".oba-field, .oba-seasons-window, fieldset")?.querySelector("select, button");
    }
    return first;
  };

  const apply = (result) => {
    latest = result;
    etag = result.etag;
    themes = Array.isArray(result.themes) ? result.themes : [];
    saved = formFromSeasons(result);
    form = formFromSeasons(result);
    today.textContent = todaySentence(result, labelOf);
    build();
  };

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      apply(await api.call("GET", "seasons"));
    } catch (error) {
      if (error?.status === 401) throw error;
      say(seasonsErrorText(error), "error");
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  async function save() {
    if (busy) return false;
    const problems = validateForm(form);
    if (problems.length) {
      say(problems.length === 1 ? "One thing needs fixing before this can be saved." : `${problems.length} things need fixing before this can be saved.`, "error");
      showProblems(problems)?.focus?.();
      return false;
    }
    showProblems([]);
    busy = true;
    saveButton.disabled = true;
    say("Saving…");
    try {
      const result = await api.call("PUT", "seasons", { json: { etag, ...seasonsFromForm(form) } });
      if (destroyed) return false;
      apply(result);
      conflict.hidden = true;
      if (result.buildError) say(`Saved, but your site could not be rebuilt yet: ${result.buildError}`, "error");
      else say(`Saved. ${todaySentence(result, labelOf)} Make your site live to publish the change.`, "ok");
      return true;
    } catch (error) {
      if (destroyed) return false;
      if (error?.status === 409) {
        conflict.hidden = false;
        conflict.replaceChildren(
          el("p", {}, seasonsErrorText(error)),
          el("button", { class: "oba-btn", type: "button", onClick: async () => { conflict.hidden = true; await load(); say("Loaded the latest seasons.", "ok"); } }, "Reload the latest seasons"),
        );
      }
      say(seasonsErrorText(error), "error");
      return false;
    } finally {
      busy = false;
      saveButton.disabled = false;
    }
  }

  root.append(
    el("section", { class: "oba-contributor-intro" }, el("p", {}, "Decorate your site for the time of year, the way you decorate a house. Pick the look for each holiday once, and your site puts it up and takes it down on the days you choose. A collection or post with its own look keeps it whatever the season.")),
    today,
    status,
    conflict,
    body,
  );

  return {
    element: root,
    load,
    save,
    isDirty,
    isBusy: () => busy,
    latest: () => latest,
    destroy: () => {
      destroyed = true;
    },
  };
}

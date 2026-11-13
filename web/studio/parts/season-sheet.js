// One season, changed in a sheet: its look, the day it goes up and the day it comes down (months by
// name, days from a list; seasons come back every year, so there's no year). Resolves to the
// changed season, or null when she chose Never mind.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { MONTHS, daysIn, monthDay } from "./season-windows.js";

const split = (mmdd) => {
  const [month, day] = String(mmdd || "12-01").split("-").map(Number);
  return { month: month || 12, day: day || 1 };
};

/** `looks` are [{ value: name, label }] sorted by label. `number`/`count` name it ("Season 2 of 12"). */
export async function editSeason({ season, looks, number, count, onPreview }) {
  await use("side-sheet", "select-field", "action-button", "cluster-layout");
  return new Promise((resolve) => {
    let done = false;
    const state = { theme: season.theme || looks[0]?.value || "", start: split(season.start), end: split(season.end) };
    const sheet = h("side-sheet", { label: "Season", side: "right", class: "studio-season-sheet" });
    const finish = (value) => {
      if (done) return;
      done = true;
      sheet.open = false;
      sheet.remove();
      resolve(value);
    };
    sheet.addEventListener("openchange", (e) => { if (!e.detail) finish(null); });
    const label = () => looks.find((look) => look.value === state.theme)?.label || state.theme;
    const heading = h("span", { slot: "heading", text: label() || "New season" });
    const look = h("select-field", { label: "Look", options: looks, value: state.theme,
      onValuechange: (e) => { state.theme = e.detail; heading.textContent = label(); } });
    const crossing = h("p", { class: "studio-help", "aria-live": "polite" });
    const leapNote = h("p", { class: "studio-help", "aria-live": "polite" });
    const dayPicker = (which, legend, help) => {
      const days = () => Array.from({ length: daysIn(state[which].month) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
      const day = h("select-field", { label: "Day", options: days(), value: String(state[which].day),
        onValuechange: (e) => { state[which].day = Number(e.detail); notes(); } });
      const month = h("select-field", { label: "Month", options: MONTHS.map((name, i) => ({ value: String(i + 1), label: name })), value: String(state[which].month),
        onValuechange: (e) => {
          state[which].month = Number(e.detail);
          state[which].day = Math.min(state[which].day, daysIn(state[which].month));
          day.options = days();
          day.value = String(state[which].day);
          notes();
        } });
      return h("fieldset", { class: "studio-when" }, h("legend", { text: legend }),
        h("cluster-layout", { gap: "0.75rem" }, month, day), help ? h("p", { class: "studio-help", text: help }) : null);
    };
    function notes() {
      const start = monthDay(state.start.month, state.start.day);
      const end = monthDay(state.end.month, state.end.day);
      crossing.textContent = end < start ? "This season runs past New Year." : "";
      leapNote.textContent = end === "02-29" ? "In years without a February 29, it ends on the 28th."
        : start === "02-29" ? "In years without a February 29, it starts on March 1." : "";
    }
    const value = () => ({ theme: state.theme, start: monthDay(state.start.month, state.start.day), end: monthDay(state.end.month, state.end.day) });
    sheet.append(heading,
      h("p", { class: "studio-help", text: `Season ${number} of ${count}` }),
      look,
      h("action-button", { variant: "secondary", onClick: (e) => onPreview?.(state.theme, e.currentTarget) }, "See how it looks"),
      dayPicker("start", "First day"),
      dayPicker("end", "Last day", "It comes down after this day."),
      crossing, leapNote,
      h("cluster-layout", { gap: "0.5rem" },
        h("action-button", { onClick: () => finish(value()) }, "Done"),
        h("action-button", { variant: "secondary", onClick: () => finish(null) }, "Never mind")));
    sheet.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish({ ...value(), andSave: true }); }
    });
    notes();
    document.body.append(sheet);
    sheet.open = true;
    requestAnimationFrame(() => look.querySelector("select")?.focus());
  });
}

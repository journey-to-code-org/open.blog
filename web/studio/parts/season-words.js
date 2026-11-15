// Today's sentence and the words around putting a look up, from GET seasons and her calendar.
// DOM-free, tested.
import { say } from "./words.js";

/** Word ids a site may change (docs/studio-words.md): {product} is "your blog" unless it says. */
export const WORDS = {
  "decorations.calendarOff": { text: "{product} wears {theme} every day. The calendar is off.", layer: "her" },
  "decorations.putUpEarly": { text: "{product} is decorated for {theme}, put up early. It stays up through {until}.", layer: "her" },
  "decorations.decorated": { text: "{product} is decorated for {theme}.", layer: "her" },
  "decorations.everyday": { text: "{product} is wearing its everyday look: {theme}.", layer: "her" },
  "decorations.betweenOff": { text: "The look {product} wears while the calendar is off.", layer: "her" },
  "decorations.noSeasons": { text: "Add one, like Christmas from December 1 to January 6, and {product} changes by itself.", layer: "her" },
  "decorations.byItself": { text: "{product} changes by itself on the days below.", layer: "her" },
  "decorations.whenYouSave": { text: "When you save, {product} wears {theme} every day. Your seasons are kept for when you turn this back on.", layer: "her" },
  "decorations.everyDay": { text: "{product} wears {theme} every day.", layer: "her" },
};

const DAY = 86400000;

/** "2026-12-01" → "Tuesday, December 1" (the year only when it isn't this year). */
export function sayLongDate(ymd, { now = new Date() } = {}) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  const words = at.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return y === now.getUTCFullYear() ? words : `${words}, ${y}`;
}

/** The day after "YYYY-MM-DD". */
export function dayAfter(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + DAY).toISOString().slice(0, 10);
}

/**
 * The top sentence. `state` is GET seasons ({ theme, seasons, wearing, next }); `label(name)` gives a
 * look's label; `seasonal(name)` says whether a calendar season uses that look.
 */
export function todaySentence(state, label, { today, now = new Date() } = {}) {
  const wearing = state.wearing;
  const up = state.seasons?.upNow;
  const isUp = up && up.until >= today && up.theme === wearing;
  const off = !state.seasons?.enabled && !isUp;
  const lines = [];
  if (off) {
    lines.push(say("decorations.calendarOff", { theme: label(state.theme) }));
    return lines;
  }
  const inSeason = (state.seasons?.windows || []).some((w) => w.theme === wearing) || isUp;
  if (isUp) lines.push(say("decorations.putUpEarly", { theme: label(wearing), until: sayLongDate(up.until, { now }) }));
  else if (inSeason && wearing !== state.theme) lines.push(say("decorations.decorated", { theme: label(wearing) }));
  else lines.push(say("decorations.everyday", { theme: label(wearing) }));
  if (state.next) lines.push(`On ${sayLongDate(state.next.day, { now })} it changes to ${label(state.next.theme)}.`);
  return lines;
}

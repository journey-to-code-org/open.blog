// The calendar rules of Decorations (slice 3), DOM-free: which look the site wears on a day, when
// that next changes, what "put it up now" lasts until, the problems in a calendar in plain words,
// and when a change reaches readers in the owner's own time.
//
// These mirror the engine (`crates/openblog-core/src/seasons.rs`) exactly:
// - a window holds a day counting both ends; a window whose end comes before its start crosses
//   New Year ("12-01" to "01-06");
// - the first window holding the day wins;
// - the day is the UTC day;
// - "02-29" is a day of the year; in a year without one it simply never comes, so a window ending
//   "02-29" ends on the 28th and a window starting "02-29" starts on March 1 (by walking real days);
// - nothing changes when `enabled` is false, and the next change is looked for up to 366 days out.
// `upNow { theme, until }` (decisions A1) wins over the calendar through `until`, inclusive.

/** Month names, January first. */
export const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);
/** Days in each month; February allows the 29th, as the engine does. */
const MONTH_DAYS = Object.freeze([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
/** The most windows a site may list (engine `MAX_WINDOWS`). */
export const MAX_WINDOWS = 24;
/** How long a look put up now lasts when it has no window of its own. */
export const UP_NOW_DAYS = 14;
/** How far ahead the next change is looked for (engine `next_change`). */
const LOOK_AHEAD = 366;

const DAY_MS = 86400000;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, "0");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** `{ month, day }` for "MM-DD", or null when it is not a day of the year (02-29 allowed). */
function parseMonthDay(text) {
  const match = MONTH_DAY.exec(typeof text === "string" ? text.trim() : "");
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > MONTH_DAYS[month - 1]) return null;
  return { month, day };
}

/** The UTC day number of a real "YYYY-MM-DD", or null. */
function dayNumber(date) {
  const match = DATE.exec(typeof date === "string" ? date.trim() : "");
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

/** "YYYY-MM-DD" of a UTC day number. */
const dateOf = (number) => new Date(number * DAY_MS).toISOString().slice(0, 10);

const windowsOf = (seasons) => (isObject(seasons) && Array.isArray(seasons.windows) ? seasons.windows : []);

/**
 * "MM-DD" for a month (1-12) and day.
 * @param {number} month
 * @param {number} day
 * @returns {string}
 */
export function monthDay(month, day) {
  return `${pad(month)}-${pad(day)}`;
}

/**
 * Days a month can have: February gives 29, as a window may end on the 29th.
 * @param {number} month 1-12
 * @returns {number} 0 for a month that does not exist
 */
export function daysIn(month) {
  return MONTH_DAYS[month - 1] ?? 0;
}

/**
 * "December 1" for "12-01"; "" when it is not a day of the year.
 * @param {string} mmdd
 * @returns {string}
 */
export function sayMonthDay(mmdd) {
  const parsed = parseMonthDay(mmdd);
  return parsed ? `${MONTHS[parsed.month - 1]} ${parsed.day}` : "";
}

/**
 * "December 1 to January 6" for a window.
 * @param {{ start: string, end: string }} window
 * @returns {string}
 */
export function sayRange(window) {
  return `${sayMonthDay(window?.start)} to ${sayMonthDay(window?.end)}`;
}

/**
 * Whether a window holds a day of the year, counting both ends. A window whose end comes before
 * its start crosses New Year. A window with a day that is not a day of the year holds nothing.
 * @param {{ start: string, end: string }} window
 * @param {string} mmdd
 * @returns {boolean}
 */
export function windowHolds(window, mmdd) {
  const start = parseMonthDay(window?.start);
  const end = parseMonthDay(window?.end);
  const day = parseMonthDay(mmdd);
  if (!start || !end || !day) return false;
  const [s, e, d] = [monthDay(start.month, start.day), monthDay(end.month, end.day), monthDay(day.month, day.day)];
  return s <= e ? s <= d && d <= e : d >= s || d <= e;
}

/** The `upNow` that holds a full date, or null. */
function activeUpNow(seasons, date) {
  const upNow = isObject(seasons) ? seasons.upNow : null;
  if (!isObject(upNow) || typeof upNow.theme !== "string" || !upNow.theme) return null;
  const today = dayNumber(date);
  const until = dayNumber(upNow.until);
  return today !== null && until !== null && today <= until ? upNow : null;
}

/**
 * The look the site wears on a day: the first enabled window holding it, else `fallbackTheme`
 * (index -1, between seasons). With `{ date: "YYYY-MM-DD" }`, an `upNow` whose `until` is on or
 * after that date wins (index -1, `upNow: true`), whether or not the calendar is on.
 * @param {{ enabled?: boolean, windows?: {theme: string, start: string, end: string}[], upNow?: {theme: string, until: string} }} seasons
 * @param {string} fallbackTheme the site's own `theme`
 * @param {string} mmdd the UTC day of the year
 * @param {{ date?: string }} [options]
 * @returns {{ theme: string, index: number, upNow?: true }}
 */
export function wearingOn(seasons, fallbackTheme, mmdd, { date } = {}) {
  const upNow = date ? activeUpNow(seasons, date) : null;
  if (upNow) return { theme: upNow.theme, index: -1, upNow: true };
  if (isObject(seasons) && seasons.enabled === true) {
    const index = windowsOf(seasons).findIndex((window) => windowHolds(window, mmdd));
    if (index >= 0) return { theme: windowsOf(seasons)[index].theme, index };
  }
  return { theme: fallbackTheme, index: -1 };
}

const wornOnDay = (seasons, fallbackTheme, number) => {
  const date = dateOf(number);
  return wearingOn(seasons, fallbackTheme, date.slice(5), { date }).theme;
};

/**
 * The next day the worn look changes, after `date` (UTC days): `upNow` ending, a window starting
 * or ending, across New Year, with 02-29 only in leap years. Null when nothing changes within 366
 * days (or the calendar is off and nothing is up now).
 * @param {object} seasons
 * @param {string} fallbackTheme
 * @param {string} date "YYYY-MM-DD"
 * @returns {{ day: string, theme: string } | null}
 */
export function nextChange(seasons, fallbackTheme, date) {
  const today = dayNumber(date);
  if (today === null) return null;
  const wearing = wornOnDay(seasons, fallbackTheme, today);
  for (let ahead = 1; ahead <= LOOK_AHEAD; ahead += 1) {
    const theme = wornOnDay(seasons, fallbackTheme, today + ahead);
    if (theme !== wearing) return { day: dateOf(today + ahead), theme };
  }
  return null;
}

/**
 * The `until` for putting a look up now on `date`: the last day of that look's window that holds
 * `date` or comes next (crossing New Year; a window ending 02-29 ends on the 28th in a year
 * without one). When the look has no window, `date` plus 14 days. Windows are read whether or not
 * the calendar is on.
 * @param {object} seasons
 * @param {string} theme
 * @param {string} date "YYYY-MM-DD"
 * @returns {string} "YYYY-MM-DD", or "" for a date that is not a day
 */
export function upNowUntil(seasons, theme, date) {
  const today = dayNumber(date);
  if (today === null) return "";
  const own = windowsOf(seasons).filter((window) => window?.theme === theme && parseMonthDay(window.start) && parseMonthDay(window.end));
  const holds = (window, number) => windowHolds(window, dateOf(number).slice(5));
  for (let ahead = 0; ahead <= LOOK_AHEAD; ahead += 1) {
    const window = own.find((w) => holds(w, today + ahead));
    if (!window) continue;
    let last = today + ahead;
    while (last - today < LOOK_AHEAD && holds(window, last + 1)) last += 1;
    return dateOf(last);
  }
  return dateOf(today + UP_NOW_DAYS);
}

/** Every day of the year (leap year, so 02-29 counts) a window holds. */
function daysHeld(window) {
  const held = new Set();
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= MONTH_DAYS[month - 1]; day += 1) {
      const mmdd = monthDay(month, day);
      if (windowHolds(window, mmdd)) held.add(mmdd);
    }
  }
  return held;
}

/**
 * The calendar's problems in plain words, each `{ index, words }`, where `index` is the season's
 * place in the list (-1 for the list as a whole). Covers: a look the site does not have, a missing
 * or impossible first or last day (February 29 is allowed), more than 24 seasons, and seasons
 * that overlap, naming the one that wins. The overlap is tied to the later season, which loses.
 * Two windows of the same look that overlap are not a problem: the same look is up either way.
 * @param {{ windows?: {theme: string, start: string, end: string}[] }} seasons
 * @param {Array<string | { name: string, label?: string }>} themes the site's themes
 * @returns {{ index: number, words: string }[]}
 */
export function problems(seasons, themes) {
  const list = windowsOf(seasons);
  const known = new Map();
  for (const theme of Array.isArray(themes) ? themes : []) {
    const name = typeof theme === "string" ? theme : theme?.name;
    if (typeof name === "string" && name) known.set(name, (typeof theme === "object" && theme.label) || name);
  }
  const labelOf = (name) => known.get(name) || name;
  const out = [];
  if (list.length > MAX_WINDOWS) {
    const extra = list.length - MAX_WINDOWS;
    out.push({ index: -1, words: `There can be at most ${MAX_WINDOWS} seasons. Remove ${extra} ${extra === 1 ? "season" : "seasons"}.` });
  }
  list.forEach((window, index) => {
    const theme = typeof window?.theme === "string" ? window.theme : "";
    const name = known.has(theme) ? labelOf(theme) : `Season ${index + 1}`;
    if (!theme) out.push({ index, words: `Choose the look season ${index + 1} puts up.` });
    else if (!known.has(theme)) out.push({ index, words: `Season ${index + 1} puts up a look this site does not have ("${theme}"). Choose another look.` });
    for (const [key, verb] of [["start", "goes up"], ["end", "comes down"]]) {
      const text = typeof window?.[key] === "string" ? window[key].trim() : "";
      if (!text) {
        out.push({ index, words: `Choose the day ${name} ${verb}.` });
        continue;
      }
      if (parseMonthDay(text)) continue;
      const match = MONTH_DAY.exec(text);
      const month = match ? Number(match[1]) : 0;
      out.push({
        index,
        words: month >= 1 && month <= 12
          ? `${name} ${verb} on ${MONTHS[month - 1]} ${Number(match[2])}, but ${MONTHS[month - 1]} has only ${MONTH_DAYS[month - 1]} days.`
          : `The day ${name} ${verb} is not a day of the year. Choose another day.`,
      });
    }
  });
  const held = list.map((window) => (parseMonthDay(window?.start) && parseMonthDay(window?.end) ? daysHeld(window) : null));
  for (let later = 1; later < list.length; later += 1) {
    if (!held[later]) continue;
    for (let first = 0; first < later; first += 1) {
      if (!held[first] || list[first].theme === list[later].theme) continue;
      if (![...held[later]].some((day) => held[first].has(day))) continue;
      const winner = labelOf(list[first].theme);
      out.push({
        index: later,
        words: `${winner} (${sayRange(list[first])}) overlaps ${labelOf(list[later].theme)} (${sayRange(list[later])}). ${winner} comes first, so it wins for those days.`,
      });
    }
  }
  return out;
}

/**
 * When a change on `date` (a UTC day) reaches readers, in the owner's time: the build that day
 * runs at `buildMinute` past UTC midnight, said down to the half hour. "the evening
 * before, around 7 pm your time" (New York), "that morning, around 9 am your time" (Tokyo),
 * "just after midnight" (UTC, London in winter).
 * @param {string} date "YYYY-MM-DD"
 * @param {{ timeZone?: string, buildMinute?: number }} [options]
 * @returns {string} "" for a date that is not a day
 */
export function switchTimeWords(date, { timeZone, buildMinute = 17 } = {}) {
  const day = dayNumber(date);
  if (day === null) return "";
  // The build that day runs between buildMinute and buildMinute + 60 past UTC midnight; say the
  // local time it starts, down to the half hour (7:17 → "7 pm", 5:47 in India → "5:30 am").
  const instant = day * DAY_MS + buildMinute * 60000;
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  parts.minute = parts.minute < 30 ? 0 : 30;
  const hour = parts.hour % 24;
  const local = Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS;
  if (local === day && hour === 0 && parts.minute === 0) return "just after midnight";
  const clock = `${hour % 12 || 12}${parts.minute ? `:${pad(parts.minute)}` : ""} ${hour < 12 ? "am" : "pm"}`;
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const when = local < day ? `the ${part} before` : local > day ? `the ${part} after` : `that ${part}`;
  return `${when}, around ${clock} your time`;
}

/**
 * The seasons object as stored: `version`, `enabled`, `windows` (each `theme`, `start`, `end`),
 * then `upNow` (`theme`, `until`) only when present. For comparing and sending.
 * @param {object} seasons
 * @returns {{ version: 1, enabled: boolean, windows: {theme: string, start: string, end: string}[], upNow?: {theme: string, until: string} }}
 */
export function toStored(seasons) {
  const stored = {
    version: 1,
    enabled: isObject(seasons) && seasons.enabled === true,
    windows: windowsOf(seasons).map((window) => ({ theme: window?.theme, start: window?.start, end: window?.end })),
  };
  if (isObject(seasons) && isObject(seasons.upNow)) {
    stored.upNow = { theme: seasons.upNow.theme, until: seasons.upNow.until };
  }
  return stored;
}

// Dates in words, and the date + time fields <-> the value Studio sends. DOM-free.
//
// Values come from the server as RFC 3339 instants ("2026-11-27T13:00:00Z") or as plain dates
// ("2026-04-09"). A plain date has no time and no zone: it is a day on the calendar, shown and
// sent back as that day.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86400000;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const formatters = new Map();

function partsFormatter(timeZone) {
  const key = timeZone || "";
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }));
  }
  return formatters.get(key);
}

/** The wall-clock parts of an instant (ms) in a zone, as numbers. */
function wallParts(ms, timeZone) {
  const out = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** The zone's offset from UTC at an instant, in ms (east positive). */
function offsetAt(ms, timeZone) {
  const p = wallParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n, size = 2) => String(n).padStart(size, "0");

function ymd(p) {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function offsetText(offsetMs) {
  const sign = offsetMs < 0 ? "-" : "+";
  const minutes = Math.round(Math.abs(offsetMs) / 60000);
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * The instant (ms) of a wall time in a zone. Ambiguous times (the repeated hour when clocks go
 * back) take the earlier instant; times that do not exist (the hour skipped when clocks go
 * forward) move forward by the size of the gap, as a clock would.
 */
function wallToMs(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  for (const offset of before === after ? [before] : [before, after]) {
    if (offsetAt(wall - offset, timeZone) === offset) return wall - offset;
  }
  return wall - before;
}

/** Parses a value into { dateOnly, y, m, d } for plain dates or { dateOnly: false, ms }. */
function parse(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { dateOnly: false, ms: value.getTime() };
  const text = String(value ?? "").trim();
  if (!text) return null;
  const plain = DATE_ONLY.exec(text);
  if (plain) return { dateOnly: true, y: Number(plain[1]), m: Number(plain[2]), d: Number(plain[3]) };
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : { dateOnly: false, ms };
}

function clockWords(hour, minute) {
  const period = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${h} ${period}` : `${h}:${pad(minute)} ${period}`;
}

/** Day words for a calendar day { y, m, d }, relative to today's calendar day in the zone. */
function dayWords({ y, m, d }, now, timeZone) {
  const today = wallParts(now.getTime(), timeZone);
  const dayNumber = Date.UTC(y, m - 1, d) / DAY_MS;
  const todayNumber = Date.UTC(today.year, today.month - 1, today.day) / DAY_MS;
  if (dayNumber === todayNumber) return "Today";
  if (dayNumber === todayNumber - 1) return "Yesterday";
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const words = `${weekday}, ${MONTHS[m - 1]} ${d}`;
  return y === today.year ? words : `${words}, ${y}`;
}

function calendarDay(parsed, timeZone) {
  if (parsed.dateOnly) return { y: parsed.y, m: parsed.m, d: parsed.d };
  const p = wallParts(parsed.ms, timeZone);
  return { y: p.year, m: p.month, d: p.day, hour: p.hour, minute: p.minute };
}

/**
 * A date in words: "Today at 3 PM", "Yesterday at 9:30 AM", "Friday, November 27 at 8 AM",
 * "Monday, November 3, 2025 at 8 AM". A plain date ("2026-04-09") gives the day alone.
 * Returns "" for an empty or unreadable value.
 * @param {string|Date} iso
 * @param {{ now?: Date, timeZone?: string }} [options]
 */
export function sayWhen(iso, { now = new Date(), timeZone } = {}) {
  const parsed = parse(iso);
  if (!parsed) return "";
  const day = calendarDay(parsed, timeZone);
  const words = dayWords(day, now, timeZone);
  return parsed.dateOnly ? words : `${words} at ${clockWords(day.hour, day.minute)}`;
}

/**
 * Just the day of a date in words: "Today", "Yesterday", "Friday, November 27",
 * "Monday, November 3, 2025". Returns "" for an empty or unreadable value.
 * @param {string|Date} iso
 * @param {{ now?: Date, timeZone?: string }} [options]
 */
export function sayDay(iso, { now = new Date(), timeZone } = {}) {
  const parsed = parse(iso);
  if (!parsed) return "";
  return dayWords(calendarDay(parsed, timeZone), now, timeZone);
}

/**
 * Splits a value into what the date field and the time field show, in the zone:
 * { date: "YYYY-MM-DD", time: "HH:MM" }. A plain date gives time ""; empty gives both "".
 * @param {string|Date} value
 * @param {string} [timeZone]
 */
export function splitInstant(value, timeZone) {
  const parsed = parse(value);
  if (!parsed) return { date: "", time: "" };
  if (parsed.dateOnly) return { date: ymd({ year: parsed.y, month: parsed.m, day: parsed.d }), time: "" };
  const p = wallParts(parsed.ms, timeZone);
  return { date: ymd(p), time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/**
 * The value to send for the date and time fields: "" with no date, "YYYY-MM-DD" with no time,
 * else an RFC 3339 instant carrying the zone's offset for that wall time
 * ("2026-11-27T08:00:00-05:00"). Throws a RangeError for a malformed date or time.
 * @param {{ date?: string, time?: string }} fields
 * @param {string} [timeZone]
 */
export function joinInstant({ date = "", time = "" } = {}, timeZone) {
  const dateText = String(date ?? "").trim();
  const timeText = String(time ?? "").trim();
  if (!dateText) return "";
  const d = DATE_ONLY.exec(dateText);
  if (!d) throw new RangeError(`Not a date: ${dateText}`);
  if (!timeText) return dateText;
  const t = TIME.exec(timeText);
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) throw new RangeError(`Not a time: ${timeText}`);
  const ms = wallToMs(Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]), timeZone);
  const p = wallParts(ms, timeZone);
  return `${ymd(p)}T${pad(p.hour)}:${pad(p.minute)}:00${offsetText(offsetAt(ms, timeZone))}`;
}

/**
 * Whether a value is later than now. A plain date counts as the start of that day in the zone.
 * Empty or unreadable values are not in the future.
 * @param {string|Date} value
 * @param {Date} [now]
 * @param {string} [timeZone] defaults to the runtime's
 */
export function isFuture(value, now = new Date(), timeZone) {
  const parsed = parse(value);
  if (!parsed) return false;
  const ms = parsed.dateOnly ? wallToMs(parsed.y, parsed.m, parsed.d, 0, 0, timeZone) : parsed.ms;
  return ms > now.getTime();
}

/**
 * When the blog's server counts a value as reached. The engine has no time zone, so a plain date
 * is the start of that day in world time (UTC), the evening before in the Americas; anything else
 * is its own instant. `null` for an empty or unreadable value.
 * @param {string|Date} value
 * @returns {Date|null}
 */
export function serverInstant(value) {
  const parsed = parse(value);
  if (!parsed) return null;
  return new Date(parsed.dateOnly ? Date.UTC(parsed.y, parsed.m - 1, parsed.d) : parsed.ms);
}

/** Whether a value is a plain date, with no time of day. */
export const isDayOnly = (value) => DATE_ONLY.test(String(value ?? "").trim());

/**
 * Whether the server hasn't reached a value yet (a post with it is still scheduled there).
 * @param {string|Date} value
 * @param {Date} [now]
 */
export function isFutureOnServer(value, now = new Date()) {
  const at = serverInstant(value);
  return Boolean(at) && at.getTime() > now.getTime();
}

/**
 * A short day for a badge: "Nov 27", or "Nov 27, 2027" in another year. "" when unreadable.
 * @param {string|Date} iso
 * @param {{ now?: Date, timeZone?: string }} [options]
 */
export function sayShortDay(iso, { now = new Date(), timeZone } = {}) {
  const parsed = parse(iso);
  if (!parsed) return "";
  const { y, m, d } = calendarDay(parsed, timeZone);
  const words = `${MONTHS[m - 1].slice(0, 3)} ${d}`;
  return y === wallParts(now.getTime(), timeZone).year ? words : `${words}, ${y}`;
}

/**
 * The time of day alone: "3:35 PM", "8 AM". "" for an empty, unreadable or date-only value.
 * @param {string|Date} iso
 * @param {{ timeZone?: string }} [options]
 */
export function sayClock(iso, { timeZone } = {}) {
  const parsed = parse(iso);
  if (!parsed || parsed.dateOnly) return "";
  const { hour, minute } = calendarDay(parsed, timeZone);
  return clockWords(hour, minute);
}

/**
 * The time a day she picks gets when she leaves the time empty: 8:00 AM her time for a future day
 * (a post scheduled for Thanksgiving goes up that morning, not at midnight UTC the evening
 * before), else what she has. Studio R5, Decided 1.
 * @param {string} date "YYYY-MM-DD" from the date field
 * @param {string} time "HH:MM" from the time field ("" when empty)
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function defaultTime(date, time, now = new Date(), timeZone) {
  if (String(time || "").trim() || !DATE_ONLY.test(String(date || "").trim())) return String(time || "");
  const [y, m, d] = String(date).trim().split("-").map(Number);
  return wallToMs(y, m, d, 8, 0, timeZone) > now.getTime() ? "08:00" : "";
}

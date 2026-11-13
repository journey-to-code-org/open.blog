// Today's sentence and the words around putting a look up, from GET seasons and her calendar.
// DOM-free, tested.

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
    lines.push(`Your house wears ${label(state.theme)} every day. The calendar is off.`);
    return lines;
  }
  const inSeason = (state.seasons?.windows || []).some((w) => w.theme === wearing) || isUp;
  if (isUp) lines.push(`Your house is decorated for ${label(wearing)}, put up early. It stays up through ${sayLongDate(up.until, { now })}.`);
  else if (inSeason && wearing !== state.theme) lines.push(`Your house is decorated for ${label(wearing)}.`);
  else lines.push(`Your house is wearing its everyday look: ${label(wearing)}.`);
  if (state.next) lines.push(`On ${sayLongDate(state.next.day, { now })} it changes to ${label(state.next.theme)}.`);
  return lines;
}

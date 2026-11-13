// Visitors in her words: how many people came, which recipes they read (by title, never a raw
// address), and a spoken summary of the days. DOM-free, tested. Studio slice 9;
// docs/specs/studio/slice-9/ux.md.

export const RANGES = [7, 30, 90];

/** The range an address names (default 30). */
export const rangeOf = (arg) => (RANGES.includes(Number(arg)) ? Number(arg) : 30);

const number = (n) => new Intl.NumberFormat("en-US").format(n || 0);
const trim = (path) => String(path || "").replace(/\/+$/, "") || "/";

export function headline(summary) {
  const people = summary.uniques || 0;
  return people === 1 ? "1 person visited" : `${number(people)} people visited`;
}

export function pagesLine(summary) {
  const views = summary.views || 0;
  return views === 1 ? "They looked at 1 page." : `They looked at ${number(views)} pages.`;
}

/**
 * The pages they read most, by title: `{ top: [{ title, url, people, allTime }], other }`, where
 * `other` adds up visits to pages that aren't posts. `/` is "Your front page".
 */
export function topReads(summary, posts, { limit = 10 } = {}) {
  const byUrl = new Map(posts.filter((p) => p.url).map((p) => [trim(p.url), p]));
  const top = [];
  let other = 0;
  for (const row of summary.topPosts || []) {
    const path = trim(row.path);
    const post = byUrl.get(path);
    if (path === "/") top.push({ title: "Your front page", url: "/", people: row.uniques || 0, allTime: row.allTime || 0 });
    else if (post) top.push({ title: post.title || "Untitled", url: post.url, people: row.uniques || 0, allTime: row.allTime || 0 });
    else other += row.views || 0;
  }
  return { top: top.slice(0, limit), more: top.slice(limit), other };
}

/** "88 people" / "1 person". */
export const peopleWords = (n) => (n === 1 ? "1 person" : `${number(n)} people`);

/** The chart's spoken label, or "" when there are too few days to show one. */
export function seriesLabel(series, sayDay) {
  const days = (series || []).filter((d) => typeof d.views === "number");
  if (days.length < 7) return "";
  const busiest = days.reduce((a, b) => (b.views > a.views ? b : a));
  if (!busiest.views) return "";
  return `Visits per day, busiest ${sayDay(busiest.day)} with ${number(busiest.views)}.`;
}

/** "Counting since Tuesday, November 3." when counting started inside the range, else "". */
export function sinceLine(summary, sayDay) {
  if (!summary.firstDay || !summary.from || summary.firstDay <= summary.from) return "";
  return `Counting since ${sayDay(summary.firstDay)}.`;
}

/** A failure in her words. */
export function visitorTrouble(error) {
  const status = error?.status ?? 0;
  if (!status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  if (status === 404) return "Visitor counting is switched off.";
  if (status === 502 || status === 503 || status === 504) return "Your visitor numbers aren't answering right now. Try again in a few minutes.";
  return "Your visitor numbers didn't load. Try again, and if it keeps happening, tell the person who set up your site.";
}

// Visitors as rules: the four ranges, the buckets a chart draws (days, weeks, months), the names of
// the sites readers came from, and honest wording. It counts visits and says so; it never compares a
// period with another, rounds to "1.2K" or draws a zero for a time before counting began. DOM-free,
// tested. Studio R10; docs/specs/studio/r10/ux.md, "Visitors".
import { say } from "./words.js";

export const RANGES = Object.freeze([7, 30, 90, 365]);

/** The range an address names (default 30). */
export const rangeOf = (arg) => (RANGES.includes(Number(arg)) ? Number(arg) : 30);

/** The range's label in the picker. */
export function rangeLabel(days) {
  return days === 7 ? say("visitors.range7") : days === 90 ? say("visitors.range90") : days === 365 ? say("visitors.rangeYear") : say("visitors.range30");
}

/** "Visitors in the last 7 days" in Find. */
export const rangeFind = (days) => say("visitors.findRange", { range: rangeLabel(days) });

/** Exact numbers with grouping, never "1.2K". */
export const number = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

const trim = (path) => String(path || "").replace(/\/+$/, "") || "/";

// ---- dates (UTC, so a clock change never moves a day) ------------------------------------------------

const parseDay = (day) => {
  const [y, m, d] = String(day).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
/** The Monday on or before a day. */
const mondayOf = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;

/**
 * What the chart draws: `{ unit, buckets: [{ key, start, end, visits, opened, partial, notYet }] }`.
 * 7 and 30 days are days; 90 is calendar weeks starting Monday; 365 is the calendar months touched.
 * A bucket that ends before `firstDay` (counting hadn't begun) is `notYet`, never a zero; one after it
 * with nothing is a real zero. `partial` marks the first and last week or month when the range cuts
 * them. Totals equal the series' sums.
 */
export function buckets(series, days, firstDay = "") {
  const rows = (series || []).filter((d) => d && d.day).map((d) => ({ day: d.day, ms: parseDay(d.day), visits: Number(d.uniques) || 0, opened: Number(d.views) || 0 }))
    .sort((a, b) => a.ms - b.ms);
  const unit = days === 365 ? "month" : days === 90 ? "week" : "day";
  if (!rows.length) return { unit, buckets: [] };
  const first = firstDay ? parseDay(firstDay) : null;
  const keyOf = (ms) => {
    if (unit === "day") return isoDay(ms);
    if (unit === "week") return isoDay(mondayOf(ms));
    return isoDay(ms).slice(0, 7);
  };
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r.ms);
    const bucket = map.get(key) || { key, visits: 0, opened: 0, min: r.ms, max: r.ms };
    bucket.visits += r.visits;
    bucket.opened += r.opened;
    bucket.min = Math.min(bucket.min, r.ms);
    bucket.max = Math.max(bucket.max, r.ms);
    map.set(key, bucket);
  }
  const out = [...map.values()].map((b) => {
    let start = b.min;
    let end = b.max;
    let whole = true;
    if (unit === "week") {
      start = parseDay(b.key);
      end = start + 6 * DAY;
    } else if (unit === "month") {
      const [y, m] = b.key.split("-").map(Number);
      start = Date.UTC(y, m - 1, 1);
      end = Date.UTC(y, m, 0);
    }
    whole = b.min <= start && b.max >= end;
    return {
      key: b.key, start: isoDay(start), end: isoDay(end), visits: b.visits, opened: b.opened,
      partial: unit !== "day" && !whole, notYet: first !== null && end < first,
    };
  });
  return { unit, buckets: out };
}

/** The first and last bucket are the only ones a range can cut. */
const monthName = (key) => new Date(parseDay(`${key}-01`)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** A bucket as words: a day, "the week of Monday, March 2", or "March 2026". */
export function periodWords(bucket, unit, sayDay) {
  if (unit === "day") return sayDay(bucket.key);
  if (unit === "week") return say("visitors.weekOf", { day: sayDay(bucket.key) });
  return monthName(bucket.key);
}

const unitWords = (unit) => (unit === "month" ? say("visitors.unitMonth") : unit === "week" ? say("visitors.unitWeek") : say("visitors.unitDay"));
export { unitWords };

/** The chart's spoken label; the busiest bucket is named here and nowhere else; never a `notYet` bucket. */
export function chartLabel(drawn, sayDay) {
  const counted = drawn.buckets.filter((b) => !b.notYet);
  const unit = unitWords(drawn.unit);
  const busiest = counted.reduce((a, b) => (!a || b.visits > a.visits ? b : a), null);
  if (!busiest || !busiest.visits || counted.length < 2) return say("visitors.chartLabelNone", { unit });
  return say("visitors.chartLabel", { unit, period: periodWords(busiest, drawn.unit, sayDay), n: number(busiest.visits) });
}

/** A bar's height class (twentieths), so Studio sets no inline style. */
export function barClass(visits, most) {
  return `studio-bar-${Math.round(((visits || 0) / Math.max(1, most)) * 20)}`;
}

// ---- the numbers ---------------------------------------------------------------------------------

/** The headline: `{ id, vars }` for "{n} visits" / "1 visit", from `uniques`. */
export function headlineParts(summary) {
  const n = summary.uniques || 0;
  return n === 1 ? { id: "visitors.visit1", vars: {} } : { id: "visitors.visits", vars: { n: number(n) } };
}

export const headline = (summary) => {
  const p = headlineParts(summary);
  return p.id === "visitors.visit1" ? say("visitors.visit1") : say("visitors.visits", p.vars);
};

export const openedLine = (summary) => ((summary.views || 0) === 1 ? say("visitors.opened1") : say("visitors.opened", { n: number(summary.views) }));

/** "1 visit" / "2,104 visits". */
export const visitsWords = (n) => (n === 1 ? say("visitors.visit1") : say("visitors.visitsFor", { n: number(n) }));

/** "Counting since Tuesday, March 3." when counting began inside the range, else "". */
export function sinceLine(summary, sayDay) {
  if (!summary.firstDay || !summary.from || summary.firstDay <= summary.from) return "";
  return say("visitors.since", { day: sayDay(summary.firstDay) });
}

/** The server keeps fewer days than the range asks for. */
export function keptLine(summary, days) {
  const kept = Number(summary.keptDays);
  return kept > 0 && kept < days ? say("visitors.keptFor", { n: number(kept) }) : "";
}

/**
 * The pages they read most, by title: `{ top, more, other }`; `other` adds up visits to pages that
 * aren't posts. `/` is "Your front page". Visits, never people.
 */
export function topReads(summary, posts, { limit = 10 } = {}) {
  const byUrl = new Map(posts.filter((p) => p.url).map((p) => [trim(p.url), p]));
  const top = [];
  let other = 0;
  for (const row of summary.topPosts || []) {
    const path = trim(row.path);
    const post = byUrl.get(path);
    if (path === "/") top.push({ title: say("visitors.frontPage"), url: "/", visits: row.uniques || 0, views: row.views || 0, allTime: row.allTime || 0 });
    else if (post) top.push({ title: post.title || say("visitors.untitled"), url: post.url, visits: row.uniques || 0, views: row.views || 0, allTime: row.allTime || 0 });
    else other += row.uniques || 0;
  }
  return { top: top.slice(0, limit), more: top.slice(limit), other };
}

// ---- where they came from ---------------------------------------------------------------------------

const HOSTS = [
  [/^(www\.)?google\.[a-z.]+$/, "Google"], [/^(www\.)?bing\.com$/, "Bing"], [/^(www\.)?duckduckgo\.com$/, "DuckDuckGo"],
  [/^([a-z]+\.)?facebook\.com$/, "Facebook"], [/^([a-z]+\.)?instagram\.com$/, "Instagram"], [/^(www\.)?nextdoor\.com$/, "Nextdoor"],
  [/^([a-z]+\.)?pinterest\.[a-z.]+$/, "Pinterest"], [/^(t\.co|x\.com|twitter\.com|www\.twitter\.com)$/, "X"], [/^bsky\.app$/, "Bluesky"],
  [/^(www\.)?linkedin\.com$|^lnkd\.in$/, "LinkedIn"], [/^(www\.|out\.)?reddit\.com$/, "Reddit"], [/^news\.ycombinator\.com$/, "Hacker News"],
];

/** A host in words: a site she knows by name, else the host as text. Never a link. */
export function hostWords(host) {
  const h = String(host || "").toLowerCase().trim();
  for (const [pattern, name] of HOSTS) if (pattern.test(h)) return name;
  return String(host || "").trim();
}

/** Referrers by name, same names merged, most first: `[{ name, views }]`. */
export function mergeHosts(referrers) {
  const merged = new Map();
  for (const r of referrers || []) {
    const name = hostWords(r.host);
    if (!name) continue;
    merged.set(name, (merged.get(name) || 0) + (Number(r.views) || 0));
  }
  return [...merged].map(([name, views]) => ({ name, views })).sort((a, b) => b.views - a.views || a.name.localeCompare(b.name));
}

/** What "How these numbers are counted" says: `[{ id }]`; the last two only for the built-in counter. */
export function howLines(counter) {
  const lines = [{ id: "visitors.how1", text: say("visitors.how1") }, { id: "visitors.how2", text: say("visitors.how2") }, { id: "visitors.how3", text: say("visitors.how3") }];
  if (counter !== "hosted") lines.push({ id: "visitors.how4", text: say("visitors.how4") }, { id: "visitors.how5", text: say("visitors.how5") });
  return lines;
}

/** A failure in her words. */
export function visitorProblem(error) {
  const status = error?.status ?? 0;
  if (!status) return say("visitors.noSignal");
  if (status === 404) return say("visitors.off");
  if (status === 502 || status === 503 || status === 504) return say("visitors.serviceDown");
  return `${say("visitors.failed")} ${say("common.keepsHappening")}`;
}

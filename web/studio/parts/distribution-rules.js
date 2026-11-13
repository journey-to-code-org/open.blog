// Moved from web/admin/distribution.js (the old Admin's "Where it went", epic DIST8, ADRs 0402 to
// 0404) for the old Admin's retirement: the pure half only, so Studio loads nothing from /admin/.
// Every post and every place it went, read from the owner's own records (`GET distribution`) plus
// the social shares in the hosted queue, which are normalized here by the same rules the server
// uses. A platform's own numbers are never read. Studio's words (`placeWords`) are new in R1;
// docs/specs/studio/r1/ux.md.

export const DESTINATION_NAMES = Object.freeze({
  dev: "DEV",
  hashnode: "Hashnode",
  ghost: "Ghost",
  wordpress: "WordPress",
  medium: "Medium",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  pinterest: "Pinterest",
  youtube: "YouTube",
  "hacker-news": "Hacker News",
  reddit: "Reddit",
  "product-hunt": "Product Hunt",
  "google-business-profile": "Google Business Profile",
  nextdoor: "Nextdoor",
});

const SETTLED = new Set(["delivered", "by-hand", "not-delivered"]);
const ID = /^[A-Za-z0-9\-_.:/@]{1,200}$/;
const CODE = /^[a-z0-9-]{1,40}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A page path from an absolute post address, or null. */
export function pagePath(address) {
  try {
    const url = new URL(address);
    return url.protocol === "https:" || url.protocol === "http:" ? url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * One announcement from the hosted queue as a row, by the same rules as `openblog_core::outcome`:
 * published is confirmed, unknown is never counted as reached, a failure or a cancel is not delivered,
 * and anything waiting is pending. A share the owner marked as there without the provider's id
 * (G7, `checkedByOwner`) rests on her word. Null for a provider or status this version does not know.
 */
export function announcementRow(item) {
  if (!isObject(item)) return null;
  const destination = item.destination?.provider;
  if (!Object.hasOwn(DESTINATION_NAMES, destination)) return null;
  const [status, evidence] = {
    published: ["delivered", item.checkedByOwner === true ? "author" : "confirmed"],
    unknown: ["unknown", "unknown"],
    failed: ["not-delivered", "confirmed"],
    canceled: ["not-delivered", "author"],
    scheduled: ["pending", "unknown"],
    claimed: ["pending", "unknown"],
  }[item.status] || [];
  if (!status) return null;
  const path = typeof item.canonicalUrl === "string" ? pagePath(item.canonicalUrl) : null;
  if (!path) return null;
  const name = typeof item.destination.displayName === "string" ? item.destination.displayName.trim().slice(0, 80) : "";
  return {
    url: path,
    destination,
    place: name || null,
    status,
    evidence,
    remoteId: typeof item.providerPostId === "string" && ID.test(item.providerPostId) ? item.providerPostId : null,
    permalink: null,
    attempts: Math.min(Math.max(Number.isInteger(item.attemptCount) ? item.attemptCount : 1, 1), 1000),
    lastUpdateAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    problem: typeof item.lastErrorCode === "string" ? (CODE.test(item.lastErrorCode) ? item.lastErrorCode : "other") : null,
    // Studio links an unclear one to its row in Going out.
    announcement: typeof item.id === "string" ? item.id : null,
  };
}

const time = (value) => {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : null;
};

/** One row per post, destination and place: the newest settled outcome wins and an unknown never overrules one. */
export function reconcileRows(rows) {
  const kept = new Map();
  for (const row of rows) {
    const key = `${row.url}\u0000${row.destination}\u0000${row.place ?? ""}`;
    const old = kept.get(key);
    if (!old) {
      kept.set(key, { ...row });
      continue;
    }
    const newer = (time(row.lastUpdateAt) ?? -1) > (time(old.lastUpdateAt) ?? -1);
    const oldSettled = SETTLED.has(old.status);
    const newSettled = SETTLED.has(row.status);
    const replace = oldSettled && !newSettled && row.status === "unknown" ? false : !oldSettled && newSettled ? newer || old.status === "unknown" : newer;
    const attempts = Math.min(old.attempts + row.attempts, 1000);
    kept.set(key, { ...(replace ? row : old), attempts });
  }
  return [...kept.values()];
}

/** Totals over rows: only delivered and by-hand count as reached. */
export function totals(rows) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  const delivered = count("delivered");
  const byHand = count("by-hand");
  return { delivered, byHand, draft: count("draft"), pending: count("pending"), unknown: count("unknown"), notDelivered: count("not-delivered"), reached: delivered + byHand };
}

/** The server's posts and the social rows together, grouped by post page, with every visit kept as the server said. */
export function mergeReport(report, social, visits) {
  const posts = new Map();
  for (const post of Array.isArray(report?.posts) ? report.posts : []) {
    posts.set(post.url, { title: post.title, url: post.url, rows: (post.destinations || []).map((row) => ({ ...row })) });
  }
  const titles = new Map([...posts.values()].map((post) => [post.url, post.title]));
  for (const row of reconcileRows(social)) {
    const post = posts.get(row.url) || { title: titles.get(row.url) || row.url, url: row.url, rows: [] };
    const counted = visits ? visits(row.url, row.destination) : null;
    post.rows.push({
      ...row,
      visits: counted === null ? { kind: "unavailable", reason: "counter-off" } : { kind: "estimated", value: counted, days: report?.days },
      providerStats: { kind: "unavailable", reason: "not-read" },
    });
    posts.set(row.url, post);
  }
  return [...posts.values()];
}

// ---- Studio's words (R1) --------------------------------------------------------------------

const STATUS_WORDS = Object.freeze({
  delivered: "Shared",
  "by-hand": "You posted it",
  pending: "Going out",
  unknown: "Check this",
  "not-delivered": "Didn't go out",
  draft: "Saved there as a draft",
});

const EVIDENCE_WORDS = Object.freeze({ confirmed: "confirmed", author: "your word", unknown: "not settled yet" });

/** "Facebook, Ridgeline Roofing" and "Shared", for one row; visits only when counted and above zero. */
export function placeWords(row) {
  const name = DESTINATION_NAMES[row?.destination] || String(row?.destination || "Somewhere");
  const visits = row?.visits?.kind === "estimated" && row.visits.value > 0
    ? `About ${row.visits.value} ${row.visits.value === 1 ? "visit" : "visits"} from there`
    : "";
  return {
    place: row?.place ? `${name}, ${row.place}` : name,
    status: STATUS_WORDS[row?.status] || "Check this",
    evidence: EVIDENCE_WORDS[row?.evidence] || EVIDENCE_WORDS.unknown,
    visits,
  };
}

/** "in the last 30 days", "in the last year". */
export const daysWords = (days) => (Number(days) === 365 ? "in the last year" : `in the last ${Number(days) || 30} days`);

/** The heading: "Reached 14 places in the last 30 days". */
export function reachedWords(rows, days) {
  const reached = totals(rows).reached;
  return `Reached ${reached} ${reached === 1 ? "place" : "places"} ${daysWords(days)}`;
}

/** The days Studio offers: 30, 90 and a year. */
export const DAY_CHOICES = Object.freeze([30, 90, 365]);
export const daysFrom = (value) => (DAY_CHOICES.includes(Number(value)) ? Number(value) : 30);

/** The one line for each record that couldn't be read, in her words. */
export const unreadableWords = (label) => `Your blog couldn't read what went to ${label}, so it isn't here. Tell the person who set up your site.`;

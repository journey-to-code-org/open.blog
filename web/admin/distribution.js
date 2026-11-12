// `#/distribution`, "Where it went" (epic DIST8, #403 and #404; ADRs 0402 to 0404).
//
// Every post and every place it went, read from the author's own records by
// `GET /admin/api/distribution`, plus the social announcements in the hosted queue, which only the
// browser can reach and which are normalized here by the same rules the server uses. Each status says
// what it rests on (the provider's answer, the author's word, or nothing yet), each visit count says
// it is estimated or unavailable, and a platform's own statistics are always shown as unavailable,
// because open.blog never asks a platform for them. This screen only reads.

import { el } from "./block-forms.js";

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

const STATUS_WORDS = Object.freeze({
  delivered: "Delivered",
  "by-hand": "Posted by hand",
  draft: "Draft or private",
  pending: "Waiting",
  unknown: "Unknown: check, then settle it",
  "not-delivered": "Not delivered",
});

const EVIDENCE_WORDS = Object.freeze({
  confirmed: "Confirmed by the platform",
  author: "Your word",
  unknown: "Not settled yet",
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
 * and anything waiting is pending. Null for a provider or status this version does not know.
 */
export function announcementRow(item) {
  if (!isObject(item)) return null;
  const destination = item.destination?.provider;
  if (!Object.hasOwn(DESTINATION_NAMES, destination)) return null;
  const [status, evidence] = {
    published: ["delivered", "confirmed"],
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

function visitsText(visits) {
  if (visits?.kind === "estimated") return `About ${visits.value} ${visits.value === 1 ? "visit" : "visits"} in ${visits.days} days (estimated)`;
  return "Unavailable: the built-in counter is off and no counter elsewhere was pulled";
}

let uid = 0;

/** The screen. `api.call(method, name)` is Admin's API; `socialEnabled` says whether the hosted queue exists. */
export function createDistributionReport({ api, socialEnabled = false }) {
  const id = `oba-distribution-${++uid}`;
  let destroyed = false;
  let busy = false;
  let days = 30;
  const root = el("div", { class: "oba-distribution", "data-distribution-screen": "true" });
  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-distribution-status": "true" });
  const body = el("div", { class: "oba-distribution-body" });
  const choose = (n, label) =>
    el(
      "button",
      {
        class: "oba-btn",
        type: "button",
        "data-days": String(n),
        "aria-pressed": n === days ? "true" : "false",
        onClick: () => {
          if (busy || n === days) return;
          days = n;
          for (const button of range.querySelectorAll("[data-days]")) button.setAttribute("aria-pressed", button.dataset.days === String(n) ? "true" : "false");
          load();
        },
      },
      label,
    );
  const range = el("div", { class: "oba-distribution-range", role: "group", "aria-label": "Visits over" }, choose(7, "7 days"), choose(30, "30 days"), choose(90, "90 days"));
  root.append(
    el("p", {}, "Every place your posts went, from your own records. open.blog asked no platform for any of this, so a platform's own statistics are shown as unavailable."),
    range,
    status,
    body,
  );

  const rowNode = (row) => {
    const name = DESTINATION_NAMES[row.destination] || row.destination;
    const facts = [
      ["Status", STATUS_WORDS[row.status] || row.status],
      ["Rests on", EVIDENCE_WORDS[row.evidence] || EVIDENCE_WORDS.unknown],
      ["Visits from there", visitsText(row.visits)],
      ["Platform statistics", "Unavailable: open.blog does not read them"],
    ];
    if (row.attempts > 1) facts.push(["Attempts", String(row.attempts)]);
    if (row.lastUpdateAt) facts.push(["Last change", row.lastUpdateAt]);
    if (row.problem) facts.push(["Problem code", row.problem]);
    return el(
      "li",
      { class: "oba-distribution-row", "data-destination": row.destination, "data-status": row.status, "data-evidence": row.evidence },
      el("h4", {}, row.place ? `${name} (${row.place})` : name),
      el("dl", {}, ...facts.flatMap(([term, value]) => [el("dt", {}, term), el("dd", {}, value)])),
      row.permalink ? el("p", {}, el("a", { href: row.permalink, rel: "noopener noreferrer", target: "_blank" }, `See it on ${name}`)) : null,
    );
  };

  const render = (report, posts, socialState) => {
    const all = posts.flatMap((post) => post.rows);
    const sum = totals(all);
    const notes = [];
    for (const family of Array.isArray(report.families) ? report.families : []) {
      if (family.state === "unreadable") notes.push(`The ${family.label} record could not be read, so it is not here.`);
    }
    if (socialState === "unreadable") notes.push("Social announcements could not be read just now, so they are not here.");
    if (report.visitsAvailable === false) notes.push("Visits are unavailable because the built-in counter is off (analytics.builtin) and no counter elsewhere was pulled (openblog analytics pull).");
    body.replaceChildren(
      el(
        "section",
        { "aria-labelledby": `${id}-sum`, class: "oba-distribution-summary" },
        el("h2", { id: `${id}-sum` }, `Reached ${sum.reached} ${sum.reached === 1 ? "place" : "places"}`),
        el("p", {}, `${sum.delivered} confirmed by the platform, ${sum.byHand} posted by hand. Unknown: ${sum.unknown}. Waiting: ${sum.pending}. Drafts or private: ${sum.draft}. Not delivered: ${sum.notDelivered}.`),
        ...notes.map((note) => el("p", { class: "oba-small", "data-distribution-note": "true" }, note)),
      ),
      posts.length
        ? el(
            "ul",
            { class: "oba-distribution-posts", "aria-label": "Posts" },
            ...posts.map((post) =>
              el(
                "li",
                { class: "oba-distribution-post", "data-url": post.url },
                el("h3", {}, el("a", { href: post.url, target: "_blank", rel: "noopener" }, post.title)),
                el("ul", { class: "oba-distribution-rows" }, ...post.rows.map(rowNode)),
              ),
            ),
          )
        : el("p", { class: "oba-notice", "data-distribution-empty": "true" }, "Nothing has been sent anywhere yet. When you cross-post, pin, announce, submit or share a post, it shows up here."),
    );
  };

  async function load() {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    status.textContent = "Reading your records…";
    try {
      const report = await api.call("GET", `distribution?days=${days}`);
      let social = [];
      let socialState = "absent";
      if (socialEnabled) {
        try {
          const answer = await api.call("GET", "social/announcements");
          social = (Array.isArray(answer?.announcements) ? answer.announcements : []).map(announcementRow).filter(Boolean);
          socialState = "read";
        } catch (error) {
          if (error?.status === 401) throw error;
          socialState = "unreadable";
        }
      }
      if (destroyed) return;
      // The counter's arrivals for social rows come back from the server per page and destination.
      const arrivals = isObject(report?.arrivals) ? report.arrivals : null;
      const visits = report?.visitsAvailable ? (url, destination) => Number(arrivals?.[destination]?.[url] ?? 0) : null;
      render(report, mergeReport(report, social, visits), socialState);
      status.textContent = "";
    } catch (error) {
      if (error?.status === 401) throw error;
      if (!destroyed) {
        status.setAttribute("role", "alert");
        status.textContent = "The report could not be read just now. Nothing was changed. Try again in a moment.";
      }
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  }

  return {
    element: root,
    load,
    isDirty: () => false,
    isBusy: () => busy,
    destroy: () => {
      destroyed = true;
    },
  };
}

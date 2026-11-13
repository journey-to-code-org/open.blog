// Sharing in her words: where a post went out and what's going out next, grouped by what she needs
// to do; the badge for each; the shortest caption limit across the accounts she chose; and account
// health. DOM-free, tested. Studio slice 10c; docs/specs/studio/slice-10bc/ux.md.
import { sayWhen } from "./dates.js";

const LIMITS = { linkedin: 3000, facebook: 3000, bluesky: 300, mastodon: 475 };
const PROVIDERS = { linkedin: "LinkedIn", facebook: "Facebook", bluesky: "Bluesky", mastodon: "Mastodon" };
const KINDS = { member: "profile", page: "Page", account: "account", organization: "page" };

export const providerName = (provider) => PROVIDERS[provider] || String(provider || "");

/** "Facebook, Ridgeline Roofing". */
const placeWord = (d) => (d?.kind === "page" || d?.kind === "organization" ? "Page" : "account");

/** Check it's question: where to look, naming the account only when it has a name. */
export function checkQuestion(d) {
  const name = providerName(d?.provider);
  if (!name) return "Studio couldn't tell whether it posted. Look at the account it was going to. Is it there?";
  const shown = typeof d?.displayName === "string" ? d.displayName.trim() : "";
  return `${name} didn't say whether it posted. Look at your ${name} ${placeWord(d)}${shown ? `, ${shown}` : ""}. Is it there?`;
}

export const accountLabel = (d) => (d ? `${providerName(d.provider)}, ${d.displayName}` : "An account");

/** The delivery state, the server's or worked out the old Admin's way. */
export function deliveryOf(item) {
  const known = ["pending", "processing", "retrying", "published", "failed", "unknown", "canceled"];
  if (known.includes(item?.delivery)) return item.delivery;
  if (item?.status === "scheduled") return !item.lastErrorCode || item.lastErrorCode === "deferred" ? "pending" : "retrying";
  if (item?.status === "claimed") return "processing";
  return known.includes(item?.status) ? item.status : "unknown";
}

/** The badge, in words. */
export const BADGES = {
  pending: "Scheduled",
  processing: "Sending",
  retrying: "Trying again",
  published: "Shared",
  failed: "Didn't go out",
  unknown: "Check this",
  canceled: "Not shared",
};

/** Needs you, Going out, Shared; cancelled ones aren't listed. */
export function groups(items) {
  const by = (states) => items.filter((i) => states.includes(deliveryOf(i)));
  const time = (a, b) => String(a.scheduledFor || "").localeCompare(String(b.scheduledFor || ""));
  return [
    { id: "needs", heading: "Needs you", items: by(["failed", "unknown"]).sort(time) },
    { id: "going", heading: "Going out", items: by(["pending", "processing", "retrying"]).sort(time) },
    { id: "shared", heading: "Shared", items: by(["published"]).sort(time).reverse() },
  ].filter((g) => g.items.length);
}

/** The caption's count against the shortest limit of the chosen accounts. */
export function captionWords(caption, providers) {
  const count = Array.from(String(caption || "").replace(/\r\n?/g, "\n").trim()).length;
  const chosen = [...new Set(providers)].filter(Boolean);
  if (!chosen.length) return { count, over: false, text: `${count} characters` };
  const limit = Math.min(...chosen.map((p) => LIMITS[p] || 3000));
  const shortest = chosen.find((p) => (LIMITS[p] || 3000) === limit);
  const which = chosen.length > 1 ? ` (${providerName(shortest)} is the shortest)` : "";
  const over = count > limit;
  return { count, limit, over, text: over ? `${count - limit} characters too many for ${providerName(shortest)}` : `${count} of ${limit}${which}` };
}

/** What a card says about an account's health, or "". */
export function healthWords(account) {
  const name = providerName(account.provider);
  if (account.health === "expiring") return `${name} stops working soon. Reconnect it, signing in as the same account.`;
  if (account.health === "needs-reauth") return `${name} stopped working. Reconnect it, signing in as the same account.`;
  if (account.health === "disconnected") return "Disconnected.";
  return "";
}

export const HEALTH_BADGES = { ok: "Connected", expiring: "Expiring soon", "needs-reauth": "Needs reconnecting", disconnected: "Disconnected" };

/** The list's problem line for a failed or unclear share. */
const PROBLEMS = {
  "rate-limited": "The site asked us to slow down.",
  "provider-unavailable": "It couldn't take it just then.",
  "provider-rejected": "It refused the post.",
  "provider-auth": "It refused the saved sign-in. Reconnect the account.",
  "needs-reauth": "The account needs reconnecting.",
  "account-not-connected": "That account isn't connected any more.",
  "attempts-exhausted": "It was tried as many times as allowed.",
  timeout: "It didn't answer, so it may or may not have been shared.",
  "not-delivered": "It said the post didn't go out.",
  "needs-review": "Studio couldn't tell whether it went out. Look at the account.",
  "account-disconnected": "Its account was disconnected.",
};
export const problemLine = (code) => PROBLEMS[code] || (code ? "Something went wrong." : "");

/** Whether a failed share needs the account reconnected rather than trying again. */
export const needsReconnect = (code) => code === "provider-auth" || code === "needs-reauth" || code === "account-not-connected";

/** "On its way. Facebook and Bluesky get it in about 5 minutes." */
export function sentWords(names, when) {
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `On its way. ${list} ${names.length === 1 ? "gets" : "get"} it ${when}.`;
}

/** A failure in her words; server text (which may name settings) goes in details. */
export function shareTrouble(error) {
  const status = error?.status ?? 0;
  const code = error?.data?.code;
  if (!status) return "Studio couldn't reach your site's server. Check your connection, then try again.";
  if (code === "hosted-key-rejected" || code === "hosted-unavailable" || status === 404) return "Sharing isn't working right now. Tell the person who set up your site.";
  if (status === 502 || status === 503 || status === 504) return "Studio couldn't reach your sharing service. Try again in a minute.";
  return "That didn't go through. Try again.";
}

// ---- R1: a share's history and running late (docs/specs/studio/r1/ux.md) ------------------

const BUSY = {
  "rate-limited": (p) => `${p} asked Studio to slow down.`,
  "provider-unavailable": (p) => `${p} was busy.`,
  timeout: (p) => `${p} didn't answer.`,
  "lease-expired": () => "Studio stopped before it heard back.",
  "reviewed-not-posted": () => "You checked: it wasn't there.",
  deferred: () => "Studio ran out of time and will try again.",
};
const why = (code, provider) => (code ? (BUSY[code] ? BUSY[code](providerName(provider) || "It") : problemLine(code)) : "");

const STATE_WORDS = {
  pending: "scheduled.",
  processing: "sending.",
  retrying: "tried, didn't go out.",
  published: "shared.",
  failed: "didn't go out.",
  unknown: "sent, but there was no clear answer.",
  canceled: "not shared.",
};

/**
 * One line of a share's history in her words, newest last: "Friday, November 20 at 3:05 PM:
 * scheduled." The day is said only when `withDay` (the first line of each day).
 */
export function historyLine(event, { withDay = true, provider = "", timeZone, now = new Date() } = {}) {
  const at = sayWhen(event?.at, { now, timeZone });
  const when = withDay || !at.includes(" at ") ? at : at.split(" at ").pop();
  let what;
  if (event?.change === "baseline") what = "the history starts here.";
  else if (event?.change === "rescheduled") what = `time changed${event.scheduledFor ? ` to ${sayWhen(event.scheduledFor, { now, timeZone })}` : ""}.`;
  else if (event?.change === "edited") what = "words changed.";
  else if (event?.change === "created") what = "scheduled.";
  else if (event?.change === "note") what = "a problem was noted.";
  else what = STATE_WORDS[event?.state] || "changed.";
  const reason = event?.code && event.state !== "published" && event.state !== "pending" ? why(event.code, provider) : "";
  return `${when ? `${when}: ` : ""}${what}${reason ? ` ${reason}` : ""}`;
}

/** Every line, the day said once per day. */
export function historyLines(timeline, options = {}) {
  let lastDay = "";
  return (Array.isArray(timeline) ? timeline : []).map((event) => {
    const day = String(event?.at || "").slice(0, 10);
    const line = historyLine(event, { ...options, withDay: day !== lastDay });
    lastDay = day;
    return line;
  });
}

/** "Tried 2 times.", or "" before any try. */
export const triedWords = (attempts) => {
  const n = Array.isArray(attempts) ? attempts.length : 0;
  return n ? `Tried ${n === 1 ? "once" : `${n} times`}.` : "";
};

/**
 * The one banner Sharing shows when shares are late or waiting on an account the site can't post
 * to; the other alerts are rows already, or Mikey's (details). Null when nothing to say.
 */
export function lateBanner(health) {
  if (!health || health.installed !== true || !Array.isArray(health.alerts)) return null;
  const lines = [];
  const late = health.alerts.includes("backlog-overdue");
  if (late) lines.push("Some posts should have gone out by now. Tell the person who set up your site.");
  if (health.alerts.includes("provider-not-configured")) {
    const n = Number.isSafeInteger(health.waitingOnProvider) && health.waitingOnProvider > 0 ? health.waitingOnProvider : 0;
    lines.push(`${n === 1 ? "1 share is" : n ? `${n} shares are` : "Some shares are"} waiting for an account that isn't set up to post. Tell the person who set up your site, or choose Don't share it.`);
  }
  if (!lines.length) return null;
  return { heading: late ? "Shares are running late" : "Some shares can't go out yet", lines };
}

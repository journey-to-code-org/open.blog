// Moved from web/admin/announcements.js (the old Admin's model) for the old Admin's retirement: the
// pure rules only, so Studio loads nothing from /admin/. Studio draws its own screen.
// Admin "Social" screen (epic #353, story #356, ADR 0307): compose an announcement of a published
// post for a connected account, see how it will look, choose a time in the author's own zone, and
// manage the queue (edit, reschedule, cancel). Everything here talks to Admin's own
// /admin/api/social/* routes; the browser never sees a key, a token or Supabase.
//
// The pure helpers at the top carry the rules a person needs while typing (the time in their zone
// as a UTC instant, the caption count, the words for a status or an error) and are tested without
// a DOM. The panel below builds labelled, keyboard-operable controls with the shared `el()`; it
// never writes markup from data, only text nodes.


export const CAPTION_LIMIT = 3000;
/** Each destination's caption limit, as the server holds it (social_schedule.rs, social-schedule.mjs). */
export const CAPTION_LIMITS = Object.freeze({ linkedin: 3000, facebook: 3000, bluesky: 300, mastodon: 475 });
export const captionLimitFor = (provider) => CAPTION_LIMITS[provider] || CAPTION_LIMIT;

/** The title Bluesky's link card shows: the caption's first line, plain (ADR 0358). */
export function blueskyCardTitle(caption) {
  const line = String(caption ?? "").split("\n")[0].replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(line).slice(0, 300).join("") || "Read the full post";
}

const plainLine = (value, max) => Array.from(String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("");

/**
 * What Bluesky will make of a caption, said plainly for the preview. `card` is the preview's
 * `{ title, description }` of the post's public page (its og:title and og:description), which the
 * card shows (ADR 0386); without it the card falls back to the caption's first line.
 */
export function blueskyNotes(caption, link, card = null) {
  const notes = [];
  let host = "";
  try {
    host = new URL(link).hostname;
  } catch {
    host = "";
  }
  const title = plainLine(card?.title, 300);
  const description = plainLine(card?.description, 300);
  if (link && title) notes.push(`On Bluesky the link is a card with the post's title, "${title}"${description ? `, and its description, "${description}"` : ""}${host ? `, that shows ${host}` : ""}, with no picture.`);
  else if (link) notes.push(`On Bluesky the link is a card titled "${blueskyCardTitle(caption)}"${host ? ` that shows ${host}` : ""}, with no picture.`);
  if (/\bhttps?:\/\/|(^|\s)#[\p{L}\p{N}_]/u.test(caption)) notes.push("Links and #hashtags in the caption become clickable on Bluesky.");
  if (/(^|\s)@[a-z0-9]/i.test(caption)) notes.push("@mentions stay plain text on Bluesky; nobody is notified.");
  return notes;
}

/**
 * Whether the caption already holds `link`, read as Mastodon reads links: a closing bracket or a
 * full stop after it is not part of it unless the link opened that bracket itself. The same rule as
 * `holdsLink` in netlify/lib/social-mastodon.mjs (ADR 0386), so the preview says what will be sent.
 */
export function captionHoldsLink(caption, link) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const occurrences = (text, char) => text.split(char).length - 1;
  for (const match of String(caption ?? "").matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gu)) {
    let found = match[0];
    while (/[.,;:!?)\]}]$/u.test(found)) {
      const last = found.at(-1);
      if (pairs[last] && occurrences(found, pairs[last]) >= occurrences(found, last)) break;
      found = found.slice(0, -1);
    }
    if (found === link) return true;
  }
  return false;
}

/**
 * What Mastodon will make of a caption, said plainly for the preview (ADR 0360). `cover` is the
 * preview's `{ image, description }` of the post's public page, or null.
 */
export function mastodonNotes(caption, link, cover = null) {
  const notes = [];
  if (link && !captionHoldsLink(caption, link)) notes.push("On Mastodon the link goes after the caption, on its own line; it counts as 23 characters, and Mastodon shows its own preview of it.");
  if (/(^|\s)#[\p{L}\p{N}_]/u.test(caption)) notes.push("#hashtags in the caption become clickable on Mastodon.");
  if (/(^|\s)@[a-z0-9_]+@[a-z0-9.-]+\.[a-z]/i.test(caption)) notes.push("On Mastodon an @name@server in the caption notifies that person.");
  if (cover?.image && cover.description) notes.push(`Where the server attaches cover images to Mastodon posts, the post's cover goes with it, described as: "${cover.description}".`);
  else if (cover?.image) notes.push("The post's cover image has no description (coverAlt), so it is never attached on Mastodon.");
  return notes;
}
const PREVIEW_DELAY_MS = 350;

// ---------------------------------------------------------------------- time

/** The browser's own IANA zone name, or "UTC" where it cannot say. */
export function browserZone() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const PARTS = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

/** Minutes the zone is ahead of UTC at the instant `ms` (negative west of Greenwich). */
export function zoneOffsetMinutes(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { ...PARTS, timeZone: zone }).formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * A wall-clock time in `zone` ("2026-11-02T09:30", what a datetime-local field holds) as the UTC
 * instant it names. A time the clocks skip over does not exist (`nonexistent`); a time they repeat
 * happens twice, and the earlier one is used (`ambiguous`).
 */
export function localToInstant(value, zone) {
  const match = LOCAL_INPUT.exec(String(value ?? ""));
  if (!match) return { ok: false, code: value ? "invalid" : "missing" };
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const real = new Date(wall);
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day || real.getUTCHours() !== hour || real.getUTCMinutes() !== minute) {
    return { ok: false, code: "invalid" };
  }
  try {
    const offsets = new Set([zoneOffsetMinutes(wall - 86400000, zone), zoneOffsetMinutes(wall + 86400000, zone), zoneOffsetMinutes(wall, zone)]);
    const found = [...offsets].map((offset) => wall - offset * 60000).filter((candidate) => zoneOffsetMinutes(candidate, zone) === (wall - candidate) / 60000);
    const unique = [...new Set(found)].sort((a, b) => a - b);
    if (!unique.length) return { ok: false, code: "nonexistent" };
    return { ok: true, iso: `${new Date(unique[0]).toISOString().slice(0, 16)}:00Z`, ambiguous: unique.length > 1 };
  } catch {
    return { ok: false, code: "zone" };
  }
}

/** A UTC instant as the value for a datetime-local field in `zone`. */
export function instantToLocalInput(iso, zone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const shifted = new Date(ms + zoneOffsetMinutes(ms, zone) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** "Mon, 2 Nov 2026, 09:30 GMT" for an instant in `zone`; the ISO text if it cannot be read. */
export function formatWhen(iso, zone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso ?? "");
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone, timeZoneName: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

// ------------------------------------------------------------------- caption

/** Characters as the server counts them (code points of the trimmed text), against the limit. */
export function captionCount(text, limit = CAPTION_LIMIT) {
  const count = Array.from(String(text ?? "").replace(/\r\n?/g, "\n").trim()).length;
  const over = count > limit;
  return { count, limit, over, text: over ? `${count - limit} characters too many (${count} of ${limit})` : `${count} of ${limit} characters` };
}

/** A fresh idempotency key: one per composed announcement, kept across retries of the same one. */
export function newKey(cryptoSource = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  if (cryptoSource?.getRandomValues) cryptoSource.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `ob-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// -------------------------------------------------------------------- words

/** A status as a word and a shape, never a color alone. */
export const STATUS_BADGES = Object.freeze({
  scheduled: { symbol: "◷", text: "Scheduled" },
  claimed: { symbol: "…", text: "Sending" },
  published: { symbol: "✓", text: "Published" },
  failed: { symbol: "✕", text: "Failed" },
  canceled: { symbol: "⊘", text: "Canceled" },
  unknown: { symbol: "?", text: "Needs checking" },
});

/**
 * The author's seven delivery states (ADR 0323), as a word and a shape. A scheduled announcement
 * that has never gone wrong is "Scheduled"; one waiting to be tried again is "Retrying".
 */
export const DELIVERY_BADGES = Object.freeze({
  pending: { symbol: "◷", text: "Scheduled" },
  processing: { symbol: "…", text: "Sending" },
  retrying: { symbol: "↻", text: "Retrying" },
  published: { symbol: "✓", text: "Published" },
  failed: { symbol: "✕", text: "Failed" },
  unknown: { symbol: "?", text: "Needs checking" },
  canceled: { symbol: "⊘", text: "Canceled" },
});

/**
 * The delivery state of an announcement: the server's, or the same rule applied here to an older
 * server's reply (netlify/lib/social-status.mjs).
 */
export function deliveryOf(item) {
  if (Object.hasOwn(DELIVERY_BADGES, item?.delivery || "")) return item.delivery;
  if (item?.status === "scheduled") return !item.lastErrorCode || item.lastErrorCode === "deferred" ? "pending" : "retrying";
  if (item?.status === "claimed") return "processing";
  return Object.hasOwn(DELIVERY_BADGES, item?.status || "") ? item.status : "unknown";
}

/** What happens next, for the states where nothing is asked of the author. */
const NEXT_STEP = Object.freeze({
  processing: "It is being sent now. Reload in a minute to see how it went.",
  retrying: "Nothing to do: it is tried again by itself. You can still edit or cancel it.",
});
export const nextStepText = (state) => NEXT_STEP[state] || "";

const CHANGE_WORDS = Object.freeze({
  baseline: "history starts here",
  created: "",
  status: "",
  rescheduled: "time changed",
  edited: "caption changed",
  note: "new problem noted",
});

/** One status history event in words, with its time in the author's zone. */
export function eventText(event, zone) {
  const badge = DELIVERY_BADGES[event?.state] || { text: "Unknown state" };
  const parts = [`${formatWhen(event?.at, zone)}: ${badge.text}`];
  const change = CHANGE_WORDS[event?.change] || "";
  if (change) parts.push(change);
  if (event?.attemptNo > 0 && event.change === "status") parts.push(`try ${event.attemptNo}`);
  if (event?.change === "rescheduled" && event.scheduledFor) parts.push(`now ${formatWhen(event.scheduledFor, zone)}`);
  let line = parts.join(", ");
  if (event?.code) line += `. ${problemWords(event.code) || event.code}`;
  return line;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Delivery health (ADR 0324) in sentences, most urgent first. Only counts and fixed alert codes
 * come from the server; an alert this screen does not know is not shown.
 */
export function healthLines(health) {
  if (!health || health.installed !== true) return [];
  const n = (name) => (Number.isSafeInteger(health[name]) && health[name] > 0 ? health[name] : 0);
  const lines = {
    "backlog-overdue": () => `${plural(n("overdue"), "announcement is", "announcements are")} more than ${plural(health.overdueMinutes || 15, "minute", "minutes")} late. The delivery worker may not be running: check its schedule and its log.`,
    "expired-leases": () => `${plural(n("expiredLeases"), "delivery", "deliveries")} stopped before finishing. The next run picks them up; nothing is sent twice.`,
    "provider-not-configured": () => `${plural(n("waitingOnProvider"), "announcement waits", "announcements wait")} for a provider this site has not set up for posting. Add its settings and redeploy, or cancel ${n("waitingOnProvider") === 1 ? "it" : "them"}.`,
    "accounts-need-reconnect": () => `${plural(n("accountsNeedReconnect"), "account needs", "accounts need")} to be connected again before ${n("accountsNeedReconnect") === 1 ? "it" : "they"} can post.`,
    "needs-review": () => `${plural(n("needsReview"), "announcement needs", "announcements need")} you to check whether ${n("needsReview") === 1 ? "it was" : "they were"} posted.`,
    "failed-recently": () => `${plural(n("failedRecently"), "announcement", "announcements")} failed in the last day.`,
    "stale-connections": () => `${plural(n("staleConnections"), "unfinished account connection", "unfinished account connections")} expired and will be cleaned up.`,
  };
  return (Array.isArray(health.alerts) ? health.alerts : []).filter((code) => Object.hasOwn(lines, code)).map((code) => ({ code, text: lines[code]() }));
}

const WHY_LOCKED = Object.freeze({
  claimed: "A sender has picked this up, so it can no longer be changed.",
  published: "This was posted, so it can no longer be changed.",
  failed: "This could not be posted.",
  canceled: "This was canceled.",
  unknown: "The result is not known yet; it will not be sent again until it is checked.",
});

/** Server codes that mean the queue moved on while the author looked: the list is refreshed. */
export const REFRESH_CODES = Object.freeze(["stale", "conflict", "not-editable", "not-retryable", "not-resolvable", "needs-resolution"]);

/** What a short code kept on a failed or unchecked announcement means, in words. */
const PROBLEM_WORDS = Object.freeze({
  "rate-limited": "The provider asked us to slow down.",
  "provider-unavailable": "The provider could not take it just now.",
  "provider-rejected": "The provider refused the post.",
  "provider-auth": "The provider refused the saved sign-in. Connect the account again.",
  "needs-reauth": "The account must be connected again.",
  "account-not-connected": "The destination is no longer connected.",
  "unsupported-provider": "This destination cannot be posted to yet.",
  "attempts-exhausted": "It was tried the allowed number of times.",
  timeout: "The provider did not answer, so it may or may not have been posted.",
  "lease-expired": "The sender stopped before it knew the result.",
  "not-delivered": "The provider confirmed it was not posted.",
  "reviewed-not-posted": "You checked and it was not posted.",
  "needs-review": "It could not be checked automatically. Look at the account.",
  "credential-error": "The saved sign-in could not be used.",
  "account-disconnected": "Its account was disconnected, so it was canceled.",
  deferred: "The sender ran out of time and gave it back unused.",
});

export const problemWords = (code) => PROBLEM_WORDS[code] || "";

export const lockedReason = (status) => WHY_LOCKED[status] || "";

/** Which field a server error code belongs to: destination, post, caption, time, or general. */
export function fieldForCode(code) {
  if (/^caption-/.test(code || "")) return "caption";
  if (/^time-/.test(code || "")) return "time";
  if (/^(post-|canonical-|url-)/.test(code || "")) return "post";
  if (/^(destination-|unsupported-provider|invalid-account)/.test(code || "")) return "destination";
  return "general";
}

/** The sentence to show for a failed call. A server message is already plain text with no secrets. */
export function errorText(error) {
  const message = error?.data?.error || (error?.status ? error.message : "");
  if (REFRESH_CODES.includes(error?.data?.code)) return `${message} The list has been refreshed.`;
  if (message) return message;
  return "Admin could not be reached. Check your connection and try again.";
}

const providerName = (provider) => ({ linkedin: "LinkedIn", facebook: "Facebook", bluesky: "Bluesky", mastodon: "Mastodon" })[provider] || String(provider || "");
const kindName = (kind) => ({ member: "profile", page: "Page", account: "account" })[kind] || String(kind || "");

/** "Mikey Nichols (LinkedIn profile)". */
export const destinationLabel = (destination) => (destination ? `${destination.displayName} (${providerName(destination.provider)} ${kindName(destination.kind)})` : "Unknown destination");

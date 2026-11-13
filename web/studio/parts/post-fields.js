// The save rules (architecture §1): Studio's keys merged into the fields the server sent, the
// draft / publish / schedule rule, and the status words. DOM-free.

import { isFuture, joinInstant, sayWhen, splitInstant } from "./dates.js";

/** The front-matter keys Studio edits. Every other key is sent back as it came. */
export const STUDIO_KEYS = Object.freeze(["title", "date", "tags", "cover", "coverAlt", "draft"]);

/** Keys never sent: leaving them out keeps the credit sidecar and tracks as they are. */
const NEVER_SEND = ["credits", "creditEtag", "captureId", "trackToken"];

const text = (value) => (typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : "");

/**
 * The form's values from a `GET document` reply. `fields` values are strings or string lists;
 * `draft` arrives as "true".
 * @param {{ fields?: Record<string, string|string[]>, body?: string }} doc
 * @returns {{ title: string, date: string, tags: string[], cover: string, coverAlt: string, draft: boolean, body: string }}
 */
export function formFromDocument(doc) {
  const fields = doc?.fields || {};
  const tags = Array.isArray(fields.tags) ? fields.tags.map(String) : text(fields.tags) ? [fields.tags] : [];
  return {
    title: text(fields.title),
    date: text(fields.date),
    tags,
    cover: text(fields.cover),
    coverAlt: text(fields.coverAlt),
    draft: text(fields.draft).trim().toLowerCase() === "true",
    body: typeof doc?.body === "string" ? doc.body.replace(/^(?:[ \t]*\r?\n)+/, "") : "",
  };
}

/** Tags trimmed, empties and case-insensitive duplicates dropped, first spelling and order kept. */
function cleanTags(tags) {
  const seen = new Set();
  const out = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const trimmed = String(tag ?? "").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

const orNull = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
};

/** Whether two date values mean the same thing: the same text, or the same instant. */
function sameDate(a, b) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (x === y) return true;
  if (!x || !y || /^\d{4}-\d{2}-\d{2}$/.test(x) || /^\d{4}-\d{2}-\d{2}$/.test(y)) return false;
  const mx = Date.parse(x);
  return !Number.isNaN(mx) && mx === Date.parse(y);
}

/** Now as an instant with the zone's offset, to the minute. */
function nowInstant(now, timeZone) {
  return joinInstant(splitInstant(now, timeZone), timeZone);
}

/**
 * The `fields` to send on save: a new object with every received key kept as it came, then
 * Studio's keys from the form (empty → null, so the server removes them). Never includes
 * `credits`, `creditEtag`, `captureId` or `trackToken`.
 * Date: unchanged → the received value as it came; changed → the form's value; publishing with
 * no date → the received date if it is in the past, else now.
 * @param {Record<string, unknown>} received the `fields` of the `GET document` reply ({} for new)
 * @param {{ title?: string, date?: string, tags?: string[], cover?: string, coverAlt?: string }} form
 *   `date` is the value to send (see `joinInstant`)
 * @param {"draft"|"publish"} intent
 * @param {{ now?: Date, timeZone?: string }} [options]
 */
/** Empty stays as it arrived ("" stays "", missing stays missing); otherwise orNull. */
function keepEmpty(received, key, value) {
  const text = String(value ?? "").trim();
  if (!text && received && received[key] === "") return "";
  return orNull(value);
}

export function fieldsToSend(received, form, intent, { now = new Date(), timeZone } = {}) {
  if (intent !== "draft" && intent !== "publish") throw new TypeError(`Unknown intent: ${intent}`);
  const fields = {};
  for (const [key, value] of Object.entries(received || {})) {
    if (NEVER_SEND.includes(key)) continue;
    fields[key] = Array.isArray(value) ? [...value] : value;
  }
  fields.title = orNull(form?.title);
  const tags = cleanTags(form?.tags);
  fields.tags = tags.length ? tags : null;
  fields.cover = keepEmpty(received, "cover", form?.cover);
  fields.coverAlt = keepEmpty(received, "coverAlt", form?.coverAlt);
  fields.draft = intent === "draft" ? true : null;

  const had = received?.date;
  const picked = String(form?.date ?? "").trim();
  let date;
  if (picked && had != null && sameDate(picked, had)) date = had;
  else date = picked || null;
  if (intent === "publish" && !date) {
    const past = had != null && String(had).trim() && !isFuture(had, now, timeZone);
    date = past ? had : nowInstant(now, timeZone);
  }
  fields.date = date;
  return fields;
}

/**
 * Whether a post is a draft, scheduled or published. A posts-list item carries `status` (which
 * may also be "error"); a document is a draft by its `draft` field, else scheduled when its date
 * is in the future.
 * @param {{ status?: string, fields?: Record<string, unknown> }} post
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {"draft"|"scheduled"|"published"|"error"}
 */
export function postState(post, now = new Date(), timeZone) {
  if (post && typeof post.status === "string" && !post.fields) return post.status;
  const form = formFromDocument(post);
  if (form.draft) return "draft";
  return isFuture(form.date, now, timeZone) ? "scheduled" : "published";
}

/**
 * The words of Write's primary button: "Update" for a published post, "Schedule" when the
 * date is in the future, else "Publish".
 * @param {string} state
 * @param {string} formDate the value to send for the date
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function primaryAction(state, formDate, now = new Date(), timeZone) {
  if (state === "published") return "Update";
  return isFuture(formDate, now, timeZone) ? "Schedule" : "Publish";
}

const lowerFirstWord = (words) => words.replace(/^(Today|Yesterday)\b/, (w) => w.toLowerCase());

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 3", or "Nov 3, 2025" in another year; "today" for today. */
function shortDay(value, now, timeZone) {
  const { date } = splitInstant(value, timeZone);
  if (!date) return "";
  const today = splitInstant(now, timeZone).date;
  if (date === today) return "today";
  const [y, m, d] = date.split("-").map(Number);
  const words = `${SHORT_MONTHS[m - 1]} ${d}`;
  return String(y) === today.slice(0, 4) ? words : `${words}, ${y}`;
}

function savedWords(savedAt, now, timeZone) {
  const ms = savedAt instanceof Date ? savedAt.getTime() : Date.parse(savedAt);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor((now.getTime() - ms) / 60000);
  if (minutes < 1) return "saved just now";
  if (minutes < 60) return `saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return `saved ${lowerFirstWord(sayWhen(new Date(ms), { now, timeZone }))}`;
}

/**
 * Write's status line in words:
 * new → "Add a title and your draft will save itself."; draft → "Draft · saved just now" /
 * "Draft · saved 2 minutes ago"; published with unsent changes → "Published Nov 3 · changes not
 * on your site yet"; published → "Published today at 4 PM"; scheduled → "Scheduled for Friday,
 * November 27 at 8 AM".
 * @param {{ state: "new"|"draft"|"scheduled"|"published", savedAt?: string|Date, dirtyPublished?: boolean, date?: string }} info
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function statusLine({ state, savedAt, dirtyPublished = false, date } = {}, now = new Date(), timeZone) {
  const when = (value) => sayWhen(value, { now, timeZone });
  if (state === "draft") {
    const saved = savedAt ? savedWords(savedAt, now, timeZone) : "";
    return saved ? `Draft · ${saved}` : "Draft";
  }
  if (state === "scheduled") return date ? `Scheduled for ${when(date)}` : "Scheduled";
  if (state === "published") {
    if (dirtyPublished) {
      const day = date ? shortDay(date, now, timeZone) : "";
      return `Published${day ? ` ${day}` : ""} · changes not on your site yet`;
    }
    return date ? `Published ${lowerFirstWord(when(date))}` : "Published";
  }
  return "Add a title and your draft will save itself.";
}

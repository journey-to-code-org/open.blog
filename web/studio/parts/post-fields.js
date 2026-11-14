// The save rules (architecture §1): Studio's keys merged into the fields the server sent, the
// draft / publish / schedule rule, and the status words. DOM-free.

import { isFuture, joinInstant, sayDay, sayWhen, splitInstant } from "./dates.js";

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
 * "Draft · saved 2 minutes ago"; published with unsent changes → "Changed · not on your site yet.
 * Press Update to put them up."; published → "Published today at 4 PM"; scheduled → "Scheduled for Friday,
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
    // R5: what she changed stays visible until Update or a discard.
    if (dirtyPublished) return "Changed · not on your site yet. Press Update to put them up.";
    return date ? `Published ${lowerFirstWord(when(date))}` : "Published";
  }
  return "Add a title and your draft will save itself.";
}

const sameValue = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => String(item) === String(b[i]));
  return String(a ?? "") === String(b ?? "");
};

/**
 * Just what changed, for a save that keeps the file as written (`frontMatter: "keep"`): keys
 * whose value differs from what was received, and `null` for keys being removed. A key left out
 * stays as it is on the server, so an unchanged field is never sent back.
 * @param {Record<string, unknown>} received
 * @param {Record<string, unknown>} fields the full set `fieldsToSend` built
 */
export function onlyChanges(received, fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    const had = received?.[key];
    if (value === null || value === undefined || value === "") {
      if (had !== undefined && String(had ?? "").trim() !== "" && !(Array.isArray(had) && !had.length)) out[key] = null;
      continue;
    }
    if (had === undefined || !sameValue(had, value)) out[key] = value;
  }
  return out;
}

/**
 * The help under When it appears, by what it is and when it goes up (G37 `meta.schedule`):
 * { words, ask? } where `ask` is the question Update asks before taking a live post off until then.
 * @param {{ state: string, date: string, time?: string, schedule?: string|null, defaulted?: boolean, problem?: string }} info
 *   `date` is the value to send; `defaulted` when the time was filled in as 8 AM for her
 */
export function whenHelp({ state, date, time = "", schedule = null, defaulted = false, problem = "" } = {}, now = new Date(), timeZone) {
  if (problem) return { words: problem, error: true };
  const value = String(date || "").trim();
  if (!value) return { words: "Leave it empty to use the day you publish." };
  const when = sayWhen(value, { now, timeZone });
  const future = isFuture(value, now, timeZone);
  if (future && state === "published") return { words: `Your post comes off your site until ${when}.`, ask: { heading: `Take it off until ${sayDay(value, { now, timeZone })}?`, yes: "Yes, schedule it", no: "Keep it up" } };
  if (future) {
    if (defaulted) return { words: "It goes up at 8 AM unless you change the time." };
    if (schedule === "self") return { words: `It goes up by itself on ${when}, even with your blog closed.` };
    return { words: `It's ready to go up on ${when}. Your blog puts it up the next time it's sent out after that.` };
  }
  if (state !== "published" && state !== "scheduled") return { words: `That day has passed, so it will show as published on ${sayDay(value, { now, timeZone }).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}.` };
  return { words: "Leave it empty to use the day you publish." };
}

/** "Add the day too, or clear the time." when a time has no day, else "". */
export function whenProblem(date, time) {
  return String(time || "").trim() && !String(date || "").trim() ? "Add the day too, or clear the time." : "";
}

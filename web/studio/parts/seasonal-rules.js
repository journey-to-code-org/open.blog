// Moved from web/admin/seasonal.js (the old Admin's model) for the old Admin's retirement: the
// pure rules only, so Studio loads nothing from /admin/. Studio draws its own screen.
// The Reminders screen (ADR 0356, #526): seasonal prompts that keep a trade site from going quiet.
// A reminder only ever opens an unpublished draft with its prompt; nothing here publishes, and the
// Assistant is offered, never started. Designed at 400px first: one column, 44px targets, every
// state said in words. The server judges every change again.
//
// The pure functions at the top are the contract and are tested without a page.


export const STATUS_TEXT = Object.freeze({
  due: "Time to write this one",
  upcoming: "Coming up",
  snoozed: "Snoozed",
  opened: "Draft started",
});

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "09-15" as "Sep 15", or the text unchanged when it is not a month and day. */
export function monthDayText(value) {
  const match = MONTH_DAY.exec(String(value ?? ""));
  return match ? `${MONTHS[Number(match[1]) - 1]} ${Number(match[2])}` : String(value ?? "");
}

/** "2026-09-01" as "Sep 1, 2026". */
export function dayText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : String(value ?? "");
}

const upsert = (entries, id, change) => {
  const list = entries.map((entry) => ({ ...entry }));
  const found = list.find((entry) => entry.id === id);
  if (found) Object.assign(found, change);
  else list.push({ id, ...change });
  return list;
};

/** The stored entries with one topic turned off or on. A turned-on topic with nothing else to say is dropped. */
export function withDisabled(entries, id, disabled) {
  const list = upsert(entries, id, disabled ? { disabled: true } : {});
  return list
    .map((entry) => {
      if (entry.id !== id || disabled) return entry;
      const { disabled: _off, ...rest } = entry;
      return rest;
    })
    .filter((entry) => Object.keys(entry).length > 1);
}

/** The stored entries with one topic's window moved. */
export function withWindow(entries, id, start, end) {
  return upsert(entries, id, { start, end });
}

/** Problems with a typed window, in plain words; an empty list is fine. */
export function windowProblems(start, end) {
  const problems = [];
  if (!MONTH_DAY.test(start)) problems.push("Write the first day as month-day, like 09-15.");
  if (!MONTH_DAY.test(end)) problems.push("Write the last day as month-day, like 11-15.");
  return problems;
}

// ---- Studio's topics sheet (R1, G4): her own topics and changed words. The server checks again
// (core seasonal.rs `parse_entry`, `incomplete`); these keep Studio from sending what it refuses.

/** The most changed or added topics a site may keep (core `MAX_ENTRIES`). */
export const MAX_TOPICS = 60;
export const MAX_TOPIC_WORDS = 80;
export const MAX_PROMPT_WORDS = 600;
const MAX_ID = 40;

/** The stored entries with one topic's words changed. */
export function withWords(entries, id, { topic, prompt }) {
  return upsert(entries, id, { topic: String(topic ?? "").trim(), prompt: String(prompt ?? "").trim() });
}

/** An id for her own topic: `own-<slug>` (never a bundled id of any trade), at most 40 characters,
 *  with `-2`, `-3`... when the site already has it. */
export function ownTopicId(topic, entries = []) {
  const slug = String(topic ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const taken = new Set(entries.map((entry) => entry.id));
  const base = `own-${slug || "topic"}`.slice(0, MAX_ID).replace(/-+$/, "");
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const tail = `-${n}`;
    const id = `${base.slice(0, MAX_ID - tail.length).replace(/-+$/, "")}${tail}`;
    if (!taken.has(id)) return id;
  }
}

/** The stored entries with her own topic added (every field stated, as the server requires). */
export function withTopic(entries, { topic, prompt, start, end }) {
  const id = ownTopicId(topic, entries);
  return [...entries.map((entry) => ({ ...entry })), { id, topic: String(topic ?? "").trim(), prompt: String(prompt ?? "").trim(), start, end }];
}

/** The stored entries without one topic's entry: her own topic goes, a bundled one is as it came. */
export function withoutTopic(entries, id) {
  return entries.filter((entry) => entry.id !== id).map((entry) => ({ ...entry }));
}

/** Whether a topic's words or dates were changed from how they came (a bundled topic with an entry
 *  holding more than its id and on/off). */
export function changedFromBundled(entries, id) {
  const entry = entries.find((e) => e.id === id);
  return Boolean(entry && ["topic", "prompt", "start", "end"].some((key) => key in entry));
}

/** Problems with a topic's words, by field, in her words; an empty object is fine. */
export function topicProblems({ topic, prompt }) {
  const problems = {};
  if (!String(topic ?? "").trim()) problems.topic = "Give the topic a name.";
  else if (Array.from(String(topic).trim()).length > MAX_TOPIC_WORDS) problems.topic = `Keep the name to ${MAX_TOPIC_WORDS} characters.`;
  if (!String(prompt ?? "").trim()) problems.prompt = "Say what to write about, in a sentence or two.";
  else if (Array.from(String(prompt).trim()).length > MAX_PROMPT_WORDS) problems.prompt = `Keep it to ${MAX_PROMPT_WORDS} characters.`;
  return problems;
}

/** Whether one more entry would pass the most a site may keep. */
export const tooManyTopics = (entries, id = null) => !entries.some((entry) => entry.id === id) && entries.length >= MAX_TOPICS;

export const TOO_MANY_TOPICS = `You have ${MAX_TOPICS} topics changed or added, the most there can be. Remove one first.`;

const ERROR_TEXT = Object.freeze({
  401: "You were signed out. Sign in again, then try again.",
  404: "That reminder is no longer listed. Reload to see today's list.",
  409: "These settings changed in another window. Reload them, then try again.",
});

export function seasonalErrorText(error) {
  const status = error?.status;
  // A 409 is a settings conflict only when the server sent the settings back with it. Any other 409
  // (a draft already started, reminders turned off) carries the server's own reason, which is said.
  const reason = String(error?.data?.error || "").trim().replace(/[.;]*$/, "");
  if (status === 409 && reason && !error?.data?.etag) return `${reason}. Reload to see today's list.`;
  if (ERROR_TEXT[status]) return ERROR_TEXT[status];
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `That did not work. ${detail}` : "That did not work. Check your connection and try again.";
}

let uid = 0;

/** The editor link for a draft the server named by its document path (`posts/...`), as every other
 *  Admin screen links to Write. */
export function editHref(document) {
  return `#/edit/${encodeURIComponent(document)}`;
}


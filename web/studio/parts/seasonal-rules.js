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


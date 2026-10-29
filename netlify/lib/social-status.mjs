// Delivery status and history of a scheduled social post as the author sees it (epic #353, story
// #359, ADR 0323). Pure: no network, no storage, no clock.
//
// The queue keeps six stored statuses (`scheduled`, `claimed`, `published`, `failed`, `unknown`,
// `canceled`, ADR 0308). An author needs seven delivery states, because a `scheduled` post that has
// never been tried and one waiting to be tried again are different things to wait for:
//
//   pending     scheduled, nothing has gone wrong yet (also: given back unused by a run that ran out of time)
//   processing  a worker holds it under a lease and may be calling the provider now
//   retrying    scheduled again after a try that certainly did not post; `next_attempt_at` says when
//   published   the provider confirmed it and named the post
//   failed      it will not be sent again by itself; the author may fix the cause and try again
//   unknown     it may have posted; it is looked up, then settled by the author, never resent blindly
//   canceled    the author canceled it, or its account was disconnected
//
// The same rule is written in SQL (`openblog_social_delivery_state`, supabase/social-history.sql) so
// the recorded history and the live row can never disagree; tests pin the two together.
//
// Nothing here reads a token, a key, a lease owner or anything a provider wrote: only statuses,
// fixed short codes, attempt numbers and times.

export const DELIVERY_STATES = Object.freeze(["pending", "processing", "retrying", "published", "failed", "unknown", "canceled"]);
const STORED = Object.freeze(["scheduled", "claimed", "published", "failed", "unknown", "canceled"]);
const CODE = /^[a-z][a-z0-9-]{0,39}$/;
// A code that gives the attempt back without counting it as a problem.
const QUIET_CODES = Object.freeze(["deferred"]);
// Codes an attempt ends with when the worker will try again by itself (ADR 0318).
const RETRY_CODES = Object.freeze(["provider-unavailable", "rate-limited", "lease-expired", "credential-error", "deferred"]);
export const CHANGES = Object.freeze(["baseline", "created", "status", "rescheduled", "edited", "note"]);

const codeOrNull = (value) => (typeof value === "string" && CODE.test(value) ? value : null);

/** The delivery state of a stored status and its last problem code. Unknown input is `null`. */
export function stateOf(status, lastErrorCode = null) {
  if (!STORED.includes(status)) return null;
  if (status === "scheduled") {
    const code = codeOrNull(lastErrorCode);
    return code === null || QUIET_CODES.includes(code) ? "pending" : "retrying";
  }
  if (status === "claimed") return "processing";
  return status;
}

/** The delivery state of a stored post row. */
export const deliveryState = (row) => stateOf(row?.status, row?.last_error_code ?? null);

/**
 * What the author can do in each state, and what the screen should say happens next. `actions` are
 * the only buttons the screen offers; the hosted routes refuse anything else regardless.
 */
export const NEXT_STEPS = Object.freeze({
  pending: Object.freeze({ actions: Object.freeze(["edit", "cancel"]), next: "waits" }),
  processing: Object.freeze({ actions: Object.freeze([]), next: "sending" }),
  retrying: Object.freeze({ actions: Object.freeze(["edit", "cancel"]), next: "retries" }),
  published: Object.freeze({ actions: Object.freeze([]), next: "done" }),
  failed: Object.freeze({ actions: Object.freeze(["retry"]), next: "fix-and-retry" }),
  unknown: Object.freeze({ actions: Object.freeze(["resolve"]), next: "check-account" }),
  canceled: Object.freeze({ actions: Object.freeze([]), next: "done" }),
});

const instant = (value) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
};

/**
 * Recorded history (rows of `openblog_social_post_events`) as the author sees it, oldest first.
 * A row that does not have the recorded shape is left out rather than guessed at.
 */
export function timelineFromEvents(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const at = instant(row?.at);
    const state = DELIVERY_STATES.includes(row?.state) ? row.state : null;
    const change = CHANGES.includes(row?.change) ? row.change : null;
    if (!at || !state || !change) continue;
    out.push({
      at,
      change,
      state,
      attemptNo: Number.isSafeInteger(row.attempt_no) && row.attempt_no >= 0 ? row.attempt_no : 0,
      code: codeOrNull(row.code),
      scheduledFor: row.scheduled_for ? instant(row.scheduled_for) : null,
    });
  }
  return out;
}

/**
 * A history rebuilt from the post and its attempts, for a site that has not installed the recorded
 * history (supabase/social-history.sql). It is honest but incomplete: it cannot show edits,
 * reschedules, or an unknown outcome that a person later settled, so the reply marks it `exact: false`.
 */
export function derivedTimeline(row, attempts) {
  if (!row) return [];
  const events = [];
  const push = (at, change, state, attemptNo = 0, code = null) => {
    const when = instant(at);
    if (when && state) events.push({ at: when, change, state, attemptNo, code: codeOrNull(code), scheduledFor: null });
  };
  push(row.created_at, "created", "pending");
  const tries = (Array.isArray(attempts) ? attempts : []).filter((a) => Number.isSafeInteger(a?.attempt_no)).sort((a, b) => a.attempt_no - b.attempt_no);
  for (const attempt of tries) {
    push(attempt.started_at, "status", "processing", attempt.attempt_no);
    if (!attempt.finished_at) continue;
    const code = codeOrNull(attempt.error_code);
    let state;
    if (attempt.outcome === "published") state = "published";
    else if (attempt.outcome === "unknown") state = "unknown";
    else if (code && QUIET_CODES.includes(code)) state = "pending";
    else if (code && RETRY_CODES.includes(code)) state = "retrying";
    else state = "failed";
    push(attempt.finished_at, "status", state, attempt.attempt_no, code);
  }
  if (row.status === "canceled") push(row.canceled_at, "status", "canceled", row.attempt_count || 0, row.last_error_code);
  // The live row is the truth: if the attempts end somewhere else (a person settled it, or the
  // author put a failed one back in the queue), say where it is now.
  const now = deliveryState(row);
  const last = events[events.length - 1];
  if (now && last && last.state !== now) push(row.updated_at, "status", now, row.attempt_count || 0, row.last_error_code);
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

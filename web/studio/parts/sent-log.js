// The short log of jobs sent from this phone (Studio R4), for Mikey's Details only, never her layer:
// localStorage `studio-sent-jobs`, the last 20, oldest first. Each entry is
// `{ captureId, path, sentAt, skipped, duplicate, by }`, where `by` is who saved the job (kept even
// when she sent it as herself). Read defensively; a phone that won't keep it just has no log.
// DOM-free and tested (tests/web/studio-sent-log.test.mjs).

export const SENT_LOG_KEY = "studio-sent-jobs";
export const SENT_LOG_MAX = 20;

const clip = (value, length) => (typeof value === "string" ? value.slice(0, length) : "");

/** One entry as it may be kept: only the known keys, each of its type, clipped. Null when unusable. */
function cleanEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const captureId = clip(raw.captureId, 64);
  const path = clip(raw.path, 300);
  if (!captureId || !path) return null;
  const when = raw.sentAt instanceof Date ? raw.sentAt : new Date(typeof raw.sentAt === "string" ? raw.sentAt : NaN);
  return {
    captureId,
    path,
    sentAt: Number.isNaN(when.getTime()) ? "" : when.toISOString(),
    skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((name) => typeof name === "string").map((name) => name.slice(0, 120)).slice(0, 12) : [],
    duplicate: raw.duplicate === true,
    by: clip(raw.by, 80),
  };
}

/** The log, oldest first; [] when there's none or it can't be read. */
export function readSentLog(storage) {
  try {
    const kept = JSON.parse(storage?.getItem(SENT_LOG_KEY) || "[]");
    return Array.isArray(kept) ? kept.map(cleanEntry).filter(Boolean).slice(-SENT_LOG_MAX) : [];
  } catch {
    return [];
  }
}

/** Add one sent job, keeping the last 20. Never throws. */
export function addToSentLog(storage, entry) {
  const clean = cleanEntry({ sentAt: new Date(), ...entry });
  if (!clean) return;
  try {
    storage?.setItem(SENT_LOG_KEY, JSON.stringify([...readSentLog(storage), clean].slice(-SENT_LOG_MAX)));
  } catch {
    // Not kept: the log is only for Details.
  }
}

/** Details' lines for the log. */
export function sentLogLines(log) {
  const head = `sent on this phone (last ${SENT_LOG_MAX}, ${SENT_LOG_KEY}): ${log.length || "none"}`;
  return [head, ...log.map((entry) => `${entry.sentAt || "(when unknown)"} ${entry.captureId} → ${entry.path}; by ${entry.by || "(not recorded)"}${entry.duplicate ? "; duplicate" : ""}${entry.skipped.length ? `; skipped ${entry.skipped.join(", ")}` : ""}`)];
}

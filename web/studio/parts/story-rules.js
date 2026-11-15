// Stories told out loud (Studio R9b): whether anything can hear, what the sheet says before she
// starts, the one record a finished recording is kept in on this phone, and what each refusal
// means in her words. Pure: no page, no network, no storage.
import { say } from "./words.js";

/** The longest a story can be, in seconds (the recorder's cap; the server allows a little more). */
export const STORY_MAX_SECONDS = 180;
/** The largest recording sent (the server's limit). */
export const STORY_MAX_BYTES = 12 * 1024 * 1024;
/** IndexedDB `studio-story` v1 / `recording` / key = user. The shape is permanent. */
export const STORY_DB = Object.freeze({ name: "studio-story", version: 1, store: "recording" });
const RECORD_VERSION = 1;

/** Whether Say it out loud is offered: something on the site can hear (`GET assistant/transcribe`). */
export const sayAvailable = (transcribe) => Boolean(transcribe && transcribe.available === true);

/**
 * What the Before you start sheet says: `{ local, heading, lines, never }`. A local engine keeps
 * the recording on the site's own computer; otherwise the company is named, and only the
 * recording goes.
 */
export function sayGoes(transcribe = {}) {
  const local = transcribe?.engine === "local" || transcribe?.leavesServer === false;
  if (local) return { local: true, company: "", heading: say("start.sayLocalHeading"), lines: [say("start.sayGoesLocal")], never: say("start.sayNotKept") };
  const company = plain(transcribe?.company) || "another company";
  return { local: false, company, heading: say("common.whatGoes", { company }), lines: [say("start.sayGoesProvider")], never: `${say("start.sayGoesOnly", { company })} ${say("start.sayNotKept")}` };
}

const plain = (value) => (typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} .-]{0,62}$/u.test(value.trim()) ? value.trim() : "");

/**
 * The record a finished recording is kept in until it is turned into words: `{ v: 1, promptId,
 * type, seconds, savedAt, blob }`, or null when there is nothing to keep.
 */
export function recordingRecord({ promptId, type, seconds, blob }, now = Date.now()) {
  if (!blob || !promptId) return null;
  return { v: RECORD_VERSION, promptId: String(promptId), type: String(type || blob.type || "audio/webm"), seconds: Math.max(0, Math.min(STORY_MAX_SECONDS, Number(seconds) || 0)), savedAt: now, blob };
}

/** A kept record, if it is one this release understands; anything else is ignored and never rewritten. */
export function readRecording(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== RECORD_VERSION) return null;
  if (typeof raw.promptId !== "string" || !raw.promptId || !raw.blob) return null;
  return { v: RECORD_VERSION, promptId: raw.promptId, type: String(raw.type || "audio/webm"), seconds: Number(raw.seconds) || 0, savedAt: Number(raw.savedAt) || 0, blob: raw.blob };
}

/** "2:07", for "Recording {time} of 3:00" and "{time} long.". */
export function storyClock(seconds) {
  const whole = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * One failed "Use this recording": `{ code, words, keep, gone, signal }`. `keep` is true whenever
 * the recording stays on this phone to try again (every case but one that can't ever work);
 * `gone` means nothing can hear any more, so Say it out loud is no longer offered.
 */
export function spokenProblem(error = {}) {
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const status = Number(error?.status) || 0;
  const code = (typeof data.code === "string" && data.code) || (status === 413 ? "too-large" : status === 415 ? "not-audio" : "");
  const out = (c, words, extra = {}) => ({ code: c, words, keep: true, gone: false, signal: false, details: typeof data.error === "string" ? data.error : "", ...extra });
  if (status === 0) return out("no-signal", say("start.sayNoSignal"), { signal: true });
  switch (code) {
    case "empty-transcript": return out(code, say("start.heardNothing"));
    case "too-large": return out(code, say("start.recTooBig"));
    case "not-audio": return out(code, say("start.recUnreadable"));
    case "no-transcriber": case "not-configured": return out("no-transcriber", say("start.sayGone"), { gone: true });
    case "bad-prompt": case "refused": case "practice-only": return out(code, say("start.storyRefused"));
    default: return out(code || "other", say("start.turnFailed"));
  }
}

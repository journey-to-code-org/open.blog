// The logic behind Admin's Voice view (ADR 0370 to 0372): the countdown, what the page announces
// and when, the copy of a draft kept on this device, how that copy and the server's are reconciled,
// the library's grouping, and the invitation's rule. Nothing here touches the document, so every
// rule is a plain function a test can call at an exact second.
//
// The clock on the page is a display. The server owns the deadline: it refuses a draft from the
// deadline on and accepts a final text only within a short grace. This file never extends a session.

export const VOICE_LIMITS = Object.freeze({
  defaultSeconds: 180,
  warningSeconds: 30,
  graceSeconds: 10,
  /** The most text a draft can hold; the server refuses more. */
  maxDraftBytes: 60 * 1024,
  /** How long typing pauses before the draft is sent to the server. */
  autosaveMs: 1500,
  /** How long typing pauses before the copy on this device is refreshed. */
  localSaveMs: 300,
  /** No timer announcement comes sooner than this after the last one. */
  announceGapMs: 30000,
});

/** The words that explain why a rough draft cannot be edited (ADR 0266). */
export const ROUGH_NOTE =
  "A rough draft stays exactly as you wrote it, typos and all, so it keeps showing how you really write. To fix or reshape it, polish a copy: that is yours to edit.";

export const PRIVATE_NOTE = "Private: kept only in this project's private folder, never committed, published or exported.";
export const PORTABLE_NOTE = "Portable: kept with your project's Assistant files, so it can be committed and shared with the project.";

const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
export function byteLength(text) {
  const value = String(text ?? "");
  return encoder ? encoder.encode(value).length : unescape(encodeURIComponent(value)).length;
}

/** Whitespace-separated words, as the server counts them. */
export function wordCount(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const wordsText = (count) => `${count} ${count === 1 ? "word" : "words"}`;

/** `3:00`, `0:30`, `0:00`. */
export function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The time left in words, for a screen reader: "1 minute", "30 seconds", "1 minute 5 seconds". */
export function spokenTime(seconds) {
  const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const parts = [];
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (rest || !minutes) parts.push(`${rest} ${rest === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

/** `running`, `warning` (the last 30 seconds) or `locked`. */
export function timerState(remaining, locked = false) {
  if (locked || remaining <= 0) return "locked";
  return remaining <= VOICE_LIMITS.warningSeconds ? "warning" : "running";
}

/**
 * What the timer says in text and a shape, never in color alone: the symbol is a different shape for each
 * state, and the words say what it means.
 */
export function timerLabel(remaining, locked = false) {
  const state = timerState(remaining, locked);
  if (state === "locked") return { state, symbol: "■", text: "Time is up" };
  if (state === "warning") return { state, symbol: "▲", text: `${spokenTime(remaining)} left` };
  return { state, symbol: "●", text: "Writing" };
}

/**
 * A countdown driven by the server's remaining time. `now` is a monotonic clock in milliseconds. Each answer
 * from the server restates the time left, and the countdown only ever moves the end sooner: an answer that
 * arrives late can not give the author more time than they had.
 */
export function createCountdown(now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())) {
  let end = null;
  return {
    sync(remainingSeconds) {
      const next = now() + Math.max(0, Number(remainingSeconds) || 0) * 1000;
      end = end === null ? next : Math.min(end, next);
    },
    reset() {
      end = null;
    },
    get started() {
      return end !== null;
    },
    remaining() {
      return end === null ? 0 : Math.max(0, Math.ceil((end - now()) / 1000));
    },
    expired() {
      return end !== null && now() >= end;
    },
  };
}

/** The sentence for a failed call. The server's sentences never contain the author's text. */
export function voiceErrorText(error) {
  const sentence = error?.data?.error;
  if (typeof sentence === "string" && sentence) return sentence;
  if (error?.status === 401) return "Your sign-in ended. Sign in again; the copy of your writing on this device is kept.";
  if (error?.status === 413) return "That is longer than a sample can hold.";
  if (error?.status >= 500) return "The server could not do that just now. Your writing is kept on this device.";
  return "The server could not be reached. Your writing is kept on this device.";
}

// ---------------------------------------------------------------- polished drafts

/** Whether the polished editor differs from the state that was saved (or pre-filled), so the guard asks. */
export function polishedDirty(current, baseline) {
  return current.title !== baseline.title || current.body !== baseline.body;
}

// ---------------------------------------------------------------- the invitation

/** The hash for the Voice view, with the pack a session should draw from if one is named. */
export const voiceHash = (pack) => (pack ? `#/voice?pack=${encodeURIComponent(pack)}` : "#/voice");
export const libraryHash = (id) => (id ? `#/voice/library/${encodeURIComponent(id)}` : "#/voice/library");

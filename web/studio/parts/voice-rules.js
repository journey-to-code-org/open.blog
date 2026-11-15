// The rules of Your writing voice (Studio R9, docs/specs/studio/r9/ux.md), lifted from the old
// Admin's voice.js and voice-session.js (ADR 0266, 0271 to 0273) with their behaviour and tests:
// the countdown, what the page says aloud and when, how a copy on this phone and the server's are
// reconciled, the hub's grouping, the invitation's rule, and what each refusal means in her words.
// Pure: no page, no network, no storage (copies live in voice-copies.js).
//
// The clock on the page is a display. The server owns the deadline: it refuses a draft from the
// deadline on and accepts a final text only within a short grace. Nothing here extends a piece.
import { say } from "./words.js";

export const VOICE_LIMITS = Object.freeze({
  defaultSeconds: 180,
  warningSeconds: 30,
  graceSeconds: 10,
  /** The most text a piece can hold; the server refuses more. */
  maxDraftBytes: 60 * 1024,
  /** How long typing pauses before the draft is sent to the server. */
  autosaveMs: 1500,
  /** How long typing pauses before the copy on this phone is refreshed. */
  localSaveMs: 300,
  /** No timer announcement comes sooner than this after the last one. */
  announceGapMs: 25000,
});

/** What keeps the browser, and the tools that sit on top of it, away from the rough text. */
export const ROUGH_ATTRIBUTES = Object.freeze({
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
  autocomplete: "off",
  writingsuggestions: "false",
  "data-gramm": "false",
  "data-gramm_editor": "false",
  "data-enable-grammarly": "false",
  "data-voice-rough": "true",
});

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

export const wordsText = (count) => `${Number(count) || 0} ${Number(count) === 1 ? "word" : "words"}`;

/** `3:00`, `0:30`, `0:00`. */
export function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The time left in words: "1 minute", "30 seconds", "1 minute 5 seconds". */
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
 * What the timer says in words and a shape, never in colour alone: `{ state, symbol, id, vars,
 * text }`. The symbol is a different shape for each state.
 */
export function timerLabel(remaining, locked = false) {
  const state = timerState(remaining, locked);
  if (state === "locked") return { state, symbol: "■", id: "voice.timerUp", vars: {}, text: say("voice.timerUp") };
  if (state === "warning") {
    const vars = { time: spokenTime(remaining) };
    return { state, symbol: "▲", id: "voice.timerLeft", vars, text: say("voice.timerLeft", vars) };
  }
  return { state, symbol: "●", id: "voice.timerWriting", vars: {}, text: say("voice.timerWriting") };
}

/**
 * A countdown driven by the server's remaining time. `now` is a monotonic clock in milliseconds.
 * Each answer from the server restates the time left, and the countdown only ever moves the end
 * sooner: an answer that arrives late can't give her more time than she had.
 */
export function createCountdown(now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())) {
  let end = null;
  return {
    sync(remainingSeconds) {
      const next = now() + Math.max(0, Number(remainingSeconds) || 0) * 1000;
      end = end === null ? next : Math.min(end, next);
    },
    reset() { end = null; },
    get started() { return end !== null; },
    remaining() { return end === null ? 0 : Math.max(0, Math.ceil((end - now()) / 1000)); },
    expired() { return end !== null && now() >= end; },
  };
}

/**
 * What the polite live region says, and when: `{ id, vars, text }` or null. One minute and thirty
 * seconds are each said once as the clock passes them, never within 25 seconds of the last, and
 * the lock is said once when it happens. A resumed piece says where it stands on its first update.
 */
export function createAnnouncer({ gapMs = VOICE_LIMITS.announceGapMs, resumed = false } = {}) {
  const said = new Set();
  let first = true;
  let lastAt = -Infinity;
  let lockSaid = false;
  return {
    update(remaining, nowMs) {
      if (remaining <= 0) return null;
      let message = null;
      if (first) {
        first = false;
        for (const threshold of [60, 30]) if (remaining <= threshold) said.add(threshold);
        if (resumed) {
          const vars = { time: spokenTime(remaining) };
          message = { id: "voice.announceResumed", vars, text: say("voice.announceResumed", vars) };
          lastAt = nowMs;
        }
        return message;
      }
      for (const threshold of [60, 30]) {
        if (remaining <= threshold && !said.has(threshold)) {
          said.add(threshold);
          if (nowMs - lastAt >= gapMs) {
            const vars = { time: spokenTime(threshold) };
            message = { id: "voice.announceLeft", vars, text: say("voice.announceLeft", vars) };
            lastAt = nowMs;
          }
        }
      }
      return message;
    },
    lock(expired = true) {
      if (lockSaid) return null;
      lockSaid = true;
      return expired
        ? { id: "voice.announceTimeUp", vars: {}, text: say("voice.announceTimeUp") }
        : { id: "voice.announceDone", vars: {}, text: say("voice.announceDone") };
    },
  };
}

// ---- a copy on this phone and the server's

/**
 * Which text an open piece continues with. For the text, the longer of the copy on this phone and
 * the server's wins when both belong to the same session, because the one that was cut short is
 * the one that missed some typing. `push` says the server is behind and should be sent the text.
 */
export function reconcileDraft({ sessionId, serverDraft }, local) {
  const server = String(serverDraft ?? "");
  if (local && local.sessionId === sessionId && [...local.text].length > [...server].length) {
    return { text: local.text, from: "phone", push: true };
  }
  return { text: server, from: "server", push: false };
}

/**
 * What to do with a piece whose time ran out while the page was away. Only a copy last kept
 * before the deadline (plus the server's grace) counts, and the server still decides: it takes a
 * final text only within its own grace and otherwise saves what it had. Nothing gives time back.
 */
export function expiredPlan(session, local) {
  if (!session?.open || !session.expired || !local || local.sessionId !== session.sessionId) return { useDevice: false };
  const deadline = Date.parse(session.deadline);
  const keptInTime = Number.isFinite(deadline) && local.savedAt <= deadline + VOICE_LIMITS.graceSeconds * 1000;
  const longer = [...local.text].length > Number(session.draftChars || 0);
  return { useDevice: keptInTime && longer && local.text.trim() !== "" };
}

/** Whether a kept rough copy's session is over for good (its deadline plus the grace is past). */
export function copyIsPastGrace(local, now = Date.now()) {
  const deadline = Date.parse(local?.deadline);
  return Number.isFinite(deadline) && now > deadline + VOICE_LIMITS.graceSeconds * 1000;
}

/** Whether the polished editor differs from what was saved (or pre-filled), so leaving asks. */
export function polishedDirty(current, baseline) {
  return current.title !== baseline.title || current.body !== baseline.body;
}

// ---- where a piece's server answer puts the Write screen

/** `GET voice/session` → the step to show: choose (maybe with a notice), write, finishing, saved. */
export function sessionView(answer) {
  switch (answer?.state) {
    case "active": return { step: "write", resumed: true };
    case "finishing": return { step: "finishing", retryAfterSeconds: Math.max(1, Number(answer.retryAfterSeconds) || 10) };
    case "locked": return { step: "saved", expired: answer.expired === true };
    case "discarded": return { step: "choose", notice: "discarded" };
    default: return { step: "choose", notice: "" };
  }
}

// ---- the hub

const newest = (a, b) => (b.date || "").localeCompare(a.date || "") || a.file.localeCompare(b.file);

/** `2 of 4 written, 1 polished`. */
export function coverageText(pack) {
  const written = `${pack.withRough} of ${pack.total} written`;
  return pack.withPolished ? `${written}, ${pack.withPolished} polished` : written;
}

/** What is missing, as data: `[{ kind: "packs" | "rough-only" | "one-sample", items }]`. */
export function gapLines(gaps, coverage = []) {
  if (!gaps) return [];
  const packTitle = new Map(coverage.map((pack) => [pack.id, pack.title]));
  const promptTitle = new Map(coverage.flatMap((pack) => (pack.prompts || []).map((prompt) => [prompt.id, prompt.title])));
  const lines = [];
  const packs = (gaps.unansweredPacks || []).map((id) => packTitle.get(id) || id);
  if (packs.length) lines.push({ kind: "packs", items: packs });
  const rough = (gaps.roughOnlyPrompts || []).map((id) => promptTitle.get(id) || id);
  if (rough.length) lines.push({ kind: "rough-only", items: rough });
  const traits = (gaps.oneSampleTraits || []).map((t) => `${t.statement} (${t.section})`);
  if (traits.length) lines.push({ kind: "one-sample", items: traits });
  return lines;
}

/** The badge words and a shape for each stage; the shape is not the only signal. */
export const STAGE_BADGES = Object.freeze({
  rough: Object.freeze({ symbol: "◇", id: "voice.badgeRough" }),
  polished: Object.freeze({ symbol: "◆", id: "voice.badgePolished" }),
});

/**
 * The hub as groups. Sets come in the catalog's order, and inside a set each rough draft is a row
 * (newest first) with its own polished copy; a polished copy whose rough draft is missing is a
 * row of its own. Pieces of a set the site no longer offers go in a last group, and files that
 * can't be read in a list of their own.
 */
export function groupLibrary({ samples = [], coverage = [] }) {
  const valid = samples.filter((sample) => sample.valid);
  const rowsFor = (items) => {
    const titleOf = (sample) => sample.promptTitle || sample.title || sample.prompt;
    const roughs = items.filter((sample) => sample.stage === "rough");
    const roughFiles = new Set(roughs.map((sample) => sample.file));
    const polishedOf = new Map();
    const orphans = [];
    for (const sample of items.filter((s) => s.stage === "polished")) {
      if (sample.roughOf && roughFiles.has(sample.roughOf) && !polishedOf.has(sample.roughOf)) polishedOf.set(sample.roughOf, sample);
      else orphans.push(sample);
    }
    const pairs = [
      ...roughs.map((sample) => ({ prompt: sample.prompt, title: titleOf(sample), rough: sample, polished: polishedOf.get(sample.file) || null })),
      ...orphans.map((sample) => ({ prompt: sample.prompt, title: titleOf(sample), rough: null, polished: sample })),
    ];
    const rows = pairs.map((row) => {
      const files = [row.rough, row.polished].filter(Boolean);
      const latest = [...files].sort(newest)[0];
      const best = row.polished || row.rough;
      return { ...row, id: (row.rough || row.polished).id, badges: [row.rough && "rough", row.polished && "polished"].filter(Boolean), words: best.words, visibility: best.visibility, date: latest.date, sort: latest };
    });
    return rows.sort((a, b) => newest(a.sort, b.sort));
  };
  const known = new Set(coverage.map((pack) => pack.id));
  const groups = coverage.map((pack) => ({
    id: pack.id, title: pack.title, summary: pack.summary, coverage: coverageText(pack), pack,
    rows: rowsFor(valid.filter((sample) => sample.pack === pack.id)),
    unwritten: (pack.prompts || []).filter((prompt) => !prompt.rough).length,
  }));
  const otherRows = rowsFor(valid.filter((sample) => !known.has(sample.pack)));
  return {
    groups,
    other: otherRows.length ? { id: "other", rows: otherRows } : null,
    invalid: samples.filter((sample) => !sample.valid).sort((a, b) => a.file.localeCompare(b.file)),
    empty: samples.length === 0,
    written: valid.filter((s) => s.stage === "rough").length,
    polished: valid.filter((s) => s.stage === "polished").length,
  };
}

/** "Nov 12, 2026", or "" for a date that can't be read. */
export function dateText(date) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? "" : value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The voice guide card on the hub: `{ state, primary }` where state is `helper-off`,
 * `needs-pieces`, `broken`, `none` or `has`. `status` is `assistant/status`, `guide` the guide's
 * descriptor from the light catalog (or null), `broken` whether the catalog said it can't be read.
 */
export function guideCard(status, guide, samples, { broken = false } = {}) {
  if (!status || status.configured !== true) return { state: "helper-off" };
  if (broken) return { state: "broken" };
  if (guide) return { state: "has" };
  const pieces = (Array.isArray(samples) ? samples : []).filter((s) => s.valid).length;
  return { state: pieces ? "none" : "needs-pieces" };
}

/**
 * What an erase would remove, as she'd say it: "6 pieces, your voice guide and a piece in
 * progress". `plan` is `GET voice/erase`. Empty when there is nothing.
 */
export function eraseSummary(plan) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const count = (kind) => items.filter((item) => item.kind === kind).length;
  const rough = items.filter((item) => item.kind === "sample" && /-rough\.md$/.test(item.path)).length;
  const samples = count("sample");
  const pieces = rough || (samples ? Math.max(1, Math.ceil(samples / 2)) : 0);
  const parts = [];
  if (pieces) parts.push(`${pieces} ${pieces === 1 ? "piece" : "pieces"}`);
  if (count("guide")) parts.push("your voice guide");
  if (count("session")) parts.push("a piece in progress");
  const other = items.length - samples - count("guide") - count("session");
  if (other > 0) parts.push(`${other} leftover ${other === 1 ? "file" : "files"}`);
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
  return { what, files: items.length, items: items.map((item) => ({ path: String(item.path || ""), kind: String(item.kind || "") })) };
}

// ---- the invitation

/**
 * Whether Home's one-time invitation shows: the helper is set up, she has no pieces, none is in
 * progress, she hasn't said No thanks, and Getting started isn't asking the same thing (R9b). A
 * status the page couldn't read shows nothing.
 */
export function invitationVisible({ dismissed, status, helperReady, onboardingOwnsIt = false } = {}) {
  if (dismissed || onboardingOwnsIt || !helperReady || !status || typeof status !== "object") return false;
  if (status.invitationDismissed === true) return false;
  if (status.session?.open) return false;
  return Number(status.samples) === 0;
}

// ---- addresses

/** Write a piece, drawing from one set when named. */
export const voiceHash = (pack) => (pack ? `#/voice/write?pack=${encodeURIComponent(pack)}` : "#/voice/write");
/** One piece, or the hub. */
export const pieceHash = (id) => (id ? `#/voice/piece/${encodeURIComponent(id)}` : "#/voice");

// ---- when a call fails

/** Today's flags, for a server that doesn't send codes yet (before G63). */
function codeFromFlags(data = {}) {
  for (const [flag, code] of [["alreadyOpen", "already-open"], ["timeUp", "time-up"], ["otherSession", "other-session"], ["noSession", "no-session"],
    ["empty", "empty"], ["conflict", "conflict"], ["ambiguous", "ambiguous"], ["invalid", "invalid"], ["refused", "refused"]]) {
    if (data[flag] === true) return code;
  }
  return "";
}

/**
 * One failed voice call: `{ code, words, details, signal }`. `words` is her sentence ("" when the
 * screen has its own for this code: the in-progress card, the conflict dialog...); `details` is
 * the server's sentence, for {helper}; it never holds her writing.
 */
export function voiceProblem(error = {}) {
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  const status = Number(error?.status) || 0;
  const details = typeof data.error === "string" ? data.error : "";
  const out = (code, words, extra = {}) => ({ code, words, details, signal: false, ...extra });
  if (status === 0) return out("no-signal", say("voice.noSignal"), { signal: true });
  if (status === 401) return out("signed-out", say("voice.signIn"));
  const code = (typeof data.code === "string" && data.code) || codeFromFlags(data) || (status === 413 ? "too-long" : status === 404 ? "gone" : "");
  switch (code) {
    case "already-open": case "time-up": case "empty": case "conflict": case "pack-gone": case "not-polished": case "confirm-word": return out(code, "");
    case "other-session": case "no-session": return out(code, say("voice.sessionMoved"));
    case "too-long": return out(code, say("voice.roughTooLong"));
    case "slug-taken": return out(code, say("voice.postTaken"));
    case "invalid": return out(code, say("voice.polishInvalid"));
    case "gone": return out(code, say("voice.pieceGone"));
    case "refused": case "ambiguous": case "already-there": return out(code, say("voice.serverTrouble"));
    default: return out(code || "other", say("voice.serverTrouble"));
  }
}

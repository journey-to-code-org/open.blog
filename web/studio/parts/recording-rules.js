// A recording to listen to with a post (#604, #645): what Studio reads from and writes to the post's
// `audio:` front matter (as the server's flattened `audio.*` keys), times as people say them, the
// parts of a recording (chapters), and the words said (the transcript a published recording needs).
// Pure: no DOM. The sheet is parts/write-recording.js.
import { say } from "./words.js";

/** The most parts (chapters) the sheet writes, as the old Admin did. */
export const MAX_PARTS = 10;
/** The most a file sent from this phone may be (the server's limit). */
export const MAX_RECORDING_BYTES = 64 * 1024 * 1024;
/** The most a recording sent to be turned into words may be. */
export const MAX_TRANSCRIBE_BYTES = 8 * 1024 * 1024;

const TRANSCRIPT_HEADING = /^ {0,3}#{1,6}[ \t]+transcript[ \t]*#*[ \t]*$/im;

/** "12:03" or "1:02:03" for whole seconds; "" for none. */
export function timeWords(seconds) {
  if (seconds === null || seconds === undefined || seconds === "") return "";
  const total = Number(seconds);
  if (!Number.isInteger(total) || total < 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Whole seconds from "75", "1:15" or "1:02:03"; null when it isn't a time. */
export function parseTime(text) {
  const value = String(text ?? "").trim();
  if (/^\d{1,6}$/.test(value)) return Number(value);
  const parts = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(value);
  if (!parts) return null;
  const [h, m, s] = [Number(parts[1] || 0), Number(parts[2]), Number(parts[3])];
  if (s > 59 || (parts[1] !== undefined && m > 59)) return null;
  return h * 3600 + m * 60 + s;
}

/** The recording as the post has it: `{ url, type, sizeBytes, duration, parts, transcriptFile, other }`, or null. */
export function recordingFrom(fields = {}) {
  const get = (key) => (fields[key] == null ? "" : String(fields[key]));
  if (!get("audio.sources.1.url")) return null;
  const indices = [...new Set(Object.keys(fields).map((key) => /^audio\.chapters\.(\d+)\./.exec(key)?.[1]).filter(Boolean))].sort((a, b) => a - b);
  return {
    url: get("audio.sources.1.url"),
    type: get("audio.sources.1.type"),
    sizeBytes: get("audio.sources.1.sizeBytes"),
    duration: /^\d+$/.test(get("audio.durationSeconds")) ? Number(get("audio.durationSeconds")) : null,
    parts: indices.map((i) => ({ time: Number(get(`audio.chapters.${i}.timeSeconds`)), title: get(`audio.chapters.${i}.title`), link: get(`audio.chapters.${i}.link`) })),
    transcriptFile: get("audio.transcript"),
    // Anything else in `audio:` (a second source, episode numbers) is kept as written.
    other: Object.keys(fields).some((key) => key.startsWith("audio.sources.2.")),
  };
}

/** The parts as lines for the details box: "1:05 Making the dough | /posts/dough/". */
export function partLines(parts = []) {
  return parts.map((p) => `${timeWords(p.time)} ${p.title}${p.link ? ` | ${p.link}` : ""}`).join("\n");
}

/**
 * The parts from the details box, one per line ("1:05 Making the dough", optionally "| link"),
 * checked against the recording's length: `{ parts }` or `{ error, line }` (`error` in words).
 */
export function parseParts(text, duration = null) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > MAX_PARTS) return { error: say("recording.tooManyParts"), line: MAX_PARTS + 1 };
  const parts = [];
  for (const [index, text] of lines.entries()) {
    const match = /^(\S+)\s+([^|]+?)\s*(?:\|\s*(\S+))?$/.exec(text);
    const time = match ? parseTime(match[1]) : null;
    const line = index + 1;
    if (!match || time === null) return { error: say("recording.partBad", { line }), line };
    if (parts.length && time <= parts[parts.length - 1].time) return { error: say("recording.partOrder", { line }), line };
    if (duration !== null && time >= duration) return { error: say("recording.partPastEnd", { line }), line };
    if (match[3] && !/^(\/|https:\/\/)\S+$/.test(match[3])) return { error: say("recording.partLink", { line }), line };
    parts.push({ time, title: match[2], link: match[3] || "" });
  }
  return { parts };
}

/**
 * The `audio.*` values to save for `state` (`{ url, type, sizeBytes, duration, parts }`, or null to
 * take the recording off), with every key the post had and no longer needs set to "" so the save
 * removes it. Keys this sheet doesn't write (a transcript file, a second source) are left alone
 * unless the recording comes off.
 */
export function recordingValues(state, received = {}) {
  const out = {};
  const had = Object.keys(received).filter((key) => key.startsWith("audio."));
  if (!state) {
    for (const key of had) out[key] = "";
    return out;
  }
  out["audio.version"] = String(received["audio.version"] ?? "1");
  out["audio.sources.1.url"] = state.url;
  out["audio.sources.1.type"] = state.type;
  out["audio.sources.1.sizeBytes"] = String(state.sizeBytes);
  out["audio.durationSeconds"] = state.duration === null || state.duration === undefined ? "" : String(state.duration);
  (state.parts || []).forEach((part, i) => {
    out[`audio.chapters.${i + 1}.timeSeconds`] = String(part.time);
    out[`audio.chapters.${i + 1}.title`] = part.title;
    if (part.link) out[`audio.chapters.${i + 1}.link`] = part.link;
  });
  for (const key of had) if (key.startsWith("audio.chapters.") && !(key in out)) out[key] = "";
  return out;
}

/** Whether the post already has the words said: a Transcript heading in it, or a transcript file. */
export function hasTranscript(body = "", fields = {}) {
  return TRANSCRIPT_HEADING.test(String(body)) || Boolean(fields["audio.transcript"]);
}

/** Her words with the words said put at the end, under a Transcript heading. */
export function withTranscript(body = "", words = "") {
  const said = String(words).replace(/\r\n?/g, "\n").trim();
  return `${String(body).replace(/\s+$/, "")}${String(body).trim() ? "\n\n" : ""}## Transcript\n\n${said}\n`;
}

/** What went wrong putting a recording on the blog, in her words, from the server's answer. */
export function sendProblem(status) {
  if (status === 413) return say("recording.tooBig");
  if (status === 415) return say("recording.notSound");
  if (status === 404) return say("recording.noteGone");
  if (!status) return say("recording.needsSignal");
  return say("recording.notSent");
}

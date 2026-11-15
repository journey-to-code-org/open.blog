// What the writing helper knows (Studio R8): her notes about herself, her blog and one post, the
// things {helper} lets it read, and which of them go with a request. Lifted from web/admin/admin.js
// (`assistantContextLabel`, `assistantContextDisclosure`, `assistantVoiceBudget`,
// `postContextFields`) with their behaviour and tests. Pure: no page, no network.
import { say } from "./words.js";

/** The most voice samples and sample letters one request may carry; the server enforces the same numbers. */
export const VOICE_REQUEST_BUDGET = Object.freeze({ samples: 8, characters: 120000 });

/** A note or text that exists and can be read. */
const present = (doc) => Boolean(doc) && doc.exists === true && doc.valid === true && typeof doc.id === "string";

/** How one chosen item is named for {helper}: its file, what it is, where it's kept, how long. */
export function contextLabel(item = {}) {
  const visibility = item.visibility === "private" ? "Private" : "Portable";
  if (item.contextType === "voice") return `${item.path || item.name} · Voice guide · ${visibility} · ${item.characters} characters`;
  if (item.kind === "voiceSample") return `${item.path || item.name} · Voice sample · ${item.stage || "unknown stage"} · ${item.pack || "no pack"} · ${visibility} · ${item.characters} characters`;
  return `${item.path || item.name} · ${item.kind === "postSnapshot" ? "Post snapshot" : visibility} · ${item.characters} characters`;
}

/** The chosen items that exist and are valid, with how much they are in all. */
export function contextDisclosure(documents = [], selectedIds = new Set()) {
  const selected = documents
    .filter((item) => selectedIds.has(item.id) && item.exists && item.valid)
    .map(({ name, visibility, characters, kind, path, stage, pack, contextType }) => ({ name, visibility, characters, ...(kind ? { kind, path } : {}), ...(kind === "voiceSample" ? { stage, pack } : {}), ...(contextType === "voice" ? { contextType } : {}) }));
  return { documents: selected, totalCharacters: selected.reduce((total, item) => total + item.characters, 0) };
}

/**
 * The running total of chosen voice samples against the request budget. `over` is true when the
 * choice must be refused before any request is made; `message` says why, for {helper}.
 */
export function voiceBudget(documents = [], selectedIds = new Set(), budget = VOICE_REQUEST_BUDGET) {
  const chosen = documents.filter((item) => item.kind === "voiceSample" && selectedIds.has(item.id) && item.exists && item.valid);
  const characters = chosen.reduce((total, item) => total + item.characters, 0);
  const reasons = [];
  if (chosen.length > budget.samples) reasons.push(`${chosen.length} voice samples are selected; one request carries at most ${budget.samples}.`);
  if (characters > budget.characters) reasons.push(`The selected voice samples are ${characters} characters; one request carries at most ${budget.characters}.`);
  return { samples: chosen.length, characters, budget, over: reasons.length > 0, message: reasons.join(" ") };
}

/** A post note's five parts, read from its file (the marked form the server writes, or plain headings). */
export function postContextFields(source = "") {
  const headings = { Goal: "goal", Audience: "audience", "Learning outcomes": "learningOutcomes", Sources: "sources", Constraints: "constraints" };
  const fields = { goal: "", audience: "", learningOutcomes: "", sources: "", constraints: "" };
  for (const [heading, key] of Object.entries(headings)) {
    const marker = new RegExp(`<!-- openblog:${key}:start -->\\s*## ${heading}\\s*\\n([\\s\\S]*?)\\n<!-- openblog:${key}:end -->`);
    const match = String(source).match(marker);
    if (match) fields[key] = match[1].trim();
  }
  if (Object.values(fields).some(Boolean)) return fields;
  const sections = String(source).split(/^##\s+(.+)\s*$/m);
  for (let index = 1; index < sections.length; index += 2) {
    const key = headings[sections[index].trim()];
    if (key) fields[key] = (sections[index + 1] || "").trim();
  }
  return fields;
}

/**
 * Her note of one kind (`author`, `site`, `post`), as the screen holds it: the private one when it
 * exists, else the shared one, else a new private one (new notes are private). `{ doc, both }`;
 * `both` is true when a private and a shared note both exist (the private one is used).
 */
export function noteOf(catalog = {}, type) {
  const docs = (catalog.documents || []).filter((doc) => doc?.contextType === type);
  const privateDoc = docs.find((doc) => doc.visibility === "private");
  const shared = docs.find((doc) => doc.visibility === "portable");
  const doc = privateDoc?.exists ? privateDoc : shared?.exists ? shared : privateDoc || { contextType: type, visibility: "private", exists: false, valid: true, etag: null, id: `private:${type}` };
  return { doc, both: Boolean(privateDoc?.exists && shared?.exists) };
}

/** Her notes that exist and can go: `[{ id, type }]`, one per kind (the private one first). */
export function notesPresent(catalog = {}) {
  return ["author", "site", "post"].map((type) => ({ type, doc: noteOf(catalog, type).doc })).filter(({ doc }) => present(doc)).map(({ type, doc }) => ({ id: doc.id, type }));
}

/** The voice guide that can go with a request: the private one first, or null. */
export function voiceGuideOf(catalog = {}) {
  const usable = (catalog.voiceGuides || []).filter((doc) => doc?.contextType === "voice" && present(doc));
  const picked = usable.find((doc) => doc.visibility === "private") || usable[0];
  return picked ? { id: picked.id, visibility: picked.visibility } : null;
}

/**
 * The context ids a request carries from her two switches: her notes (Use what your helper knows
 * about you) and her voice guide (Sound like me), plus whatever {helper} ticked in details.
 */
export function defaultContextIds(catalog = {}, { useNotes = true, soundLikeMe = false, extra = [] } = {}) {
  const ids = [];
  if (useNotes) ids.push(...notesPresent(catalog).map((note) => note.id));
  const guide = voiceGuideOf(catalog);
  if (soundLikeMe && guide) ids.push(guide.id);
  const known = new Set([...(catalog.references || []), ...(catalog.documents || []), ...(catalog.postSnapshots || []), ...(catalog.voiceSamples || [])].filter(present).map((doc) => doc.id));
  ids.push(...extra.filter((id) => known.has(id)));
  return [...new Set(ids)].slice(0, 16);
}

/** The most a note may be: 64 KiB of UTF-8, as the server counts it. */
export const NOTE_MAX_BYTES = 64 * 1024;
export const utf8Length = (text) => new TextEncoder().encode(String(text ?? "")).length;

/**
 * How a note's new words are saved: `{ method: "PUT" | "DELETE", body }`, `{ none: true }` when
 * nothing would change, or `{ problem: "too-long" }`. Emptied words remove the file. A post note
 * sends its five parts as `fields`. Always with the `etag` it was read with, so a change made
 * somewhere else is a conflict, not an overwrite.
 */
export function noteSaveRequest(doc = {}, text, { path = "" } = {}) {
  const post = doc.contextType === "post";
  const base = { contextType: doc.contextType, visibility: doc.visibility === "portable" ? "portable" : "private", ...(post ? { documentPath: path } : {}) };
  const empty = post ? Object.values(text || {}).every((value) => !String(value || "").trim()) : !String(text ?? "").trim();
  if (empty) return doc.exists ? { method: "DELETE", body: { ...base, etag: doc.etag } } : { none: true };
  if (post) {
    const fields = Object.fromEntries(["goal", "audience", "learningOutcomes", "sources", "constraints"].map((key) => [key, String(text?.[key] || "").trim()]));
    if (utf8Length(Object.values(fields).join("\n")) > NOTE_MAX_BYTES - 1024) return { problem: "too-long" };
    return { method: "PUT", body: { ...base, fields, etag: doc.exists ? doc.etag : null } };
  }
  const content = `${String(text).replace(/\r\n?/g, "\n").replace(/\s+$/, "")}\n`;
  if (utf8Length(content) > NOTE_MAX_BYTES) return { problem: "too-long" };
  return { method: "PUT", body: { ...base, content, etag: doc.exists ? doc.etag : null } };
}

/** Why a note didn't save, in her words: `{ words, conflict, signal }`. */
export function noteProblem(error = {}) {
  if (error?.status === 0) return { words: say("hnote.waiting"), conflict: false, signal: true };
  if (error?.status === 409 || error?.status === 404) return { words: say("hnote.conflict"), conflict: true, signal: false };
  if (error?.status === 413) return { words: say("hnote.tooLong"), conflict: false, signal: false };
  return { words: say("hnote.notSaved"), conflict: false, signal: false };
}

/** Where a note is kept, for {helper}. */
export function keptWords(doc = {}) {
  const post = doc.contextType === "post";
  const name = String(doc.name || `${doc.contextType}.md`);
  return doc.visibility === "portable"
    ? say("hnote.keptShared", { path: `assistant/context/${post ? "posts/" : ""}${name}` })
    : say("hnote.keptPrivate", { path: `.openblog/private/context/${post ? "posts/" : ""}${name}` });
}

/** A name for a text {helper} adds: letters, numbers and dashes, ending in .md or .txt. */
export const referenceNameOk = (name) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}\.(md|txt)$/.test(String(name || ""));

/** A page address {helper} may ask for: http(s), with a host, no name or password in it. */
export function pageAddressOk(address) {
  try {
    const url = new URL(String(address || "").trim());
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** A name to keep a fetched page under, from its address: "example-com". */
export function pageFileId(address) {
  try {
    return new URL(address).hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
  } catch {
    return "page";
  }
}

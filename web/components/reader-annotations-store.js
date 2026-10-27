// The reader's own annotation document in the reader's own browser (ADRs 0450-0454).
//
// Pure functions over the validated document of reader-annotations.js, and a
// storage seam that never throws. Reading a post never needs storage: when the
// browser denies it, is full, or holds something this code cannot read, the
// store says so and the page keeps working with what is in memory. A saved
// document that cannot be read is never overwritten, so a failure leaves the
// browser's data exactly as it was.

import { MAX_DOCUMENT_BYTES, createDocument, readDocument, readDocumentJson, serializeDocument } from "./reader-annotations.js";

export const STORAGE_KEY = "openblog.reader-annotations";

/**
 * Read the saved document. Returns { status, document } where status is
 * "empty" (nothing saved, a new document), "ok", "unreadable" (something is
 * saved and is not a valid document; it is left alone) or "blocked" (the
 * browser gives no storage). `storage` is a function returning a Storage, so
 * a denied property access is caught here.
 */
export function readStore(storage) {
  let text;
  try {
    text = storage()?.getItem(STORAGE_KEY);
  } catch {
    return { status: "blocked", document: createDocument() };
  }
  if (text === undefined) return { status: "blocked", document: createDocument() };
  if (text === null) return { status: "empty", document: createDocument() };
  const read = readDocumentJson(text);
  return read.ok ? { status: "ok", document: read.document } : { status: "unreadable", document: createDocument(), problems: read.problems };
}

/**
 * Save a valid document. Returns { ok: true } or { ok: false, reason } where reason is "blocked" (storage
 * denied) or "full" (the browser's quota, or the document's own size limit). Nothing is changed on failure.
 */
export function writeStore(storage, document) {
  const text = serializeDocument(document);
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) return { ok: false, reason: "full" };
  let area;
  try {
    area = storage();
  } catch {
    return { ok: false, reason: "blocked" };
  }
  if (!area) return { ok: false, reason: "blocked" };
  try {
    area.setItem(STORAGE_KEY, text);
    return { ok: true };
  } catch (error) {
    const quota = error && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22 || error.code === 1014);
    return { ok: false, reason: quota ? "full" : "blocked" };
  }
}

/** The time in the contract's one form: UTC, whole seconds. */
export const timestamp = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A fresh id, a lowercase slug no record of the document uses. */
export function newId(document, prefix, random = Math.random) {
  const taken = new Set([...document.annotations, ...document.sources, ...document.trails].map((record) => record.id));
  for (;;) {
    let body = "";
    for (let i = 0; i < 10; i += 1) body += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
    const id = `${prefix}-${body}`;
    if (!taken.has(id)) return id;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// Whatever a change produces is checked by the contract before anyone keeps it.
function checked(value) {
  const read = readDocument(value);
  return read.ok ? { ok: true, document: read.document } : { ok: false, problem: read.problems[0] };
}

/**
 * Add a highlight (no `text`) or a note (`text`) on a work. `target` is a valid passage target, `revision` the
 * revision of the page the reader read. Returns { ok: true, document, id } or { ok: false, problem }.
 */
export function addAnnotation(document, { work, revision, target, text, now = timestamp(), random }) {
  const id = newId(document, text === undefined ? "hl" : "note", random);
  const record = { id, kind: text === undefined ? "highlight" : "note", work, revision, target };
  if (text !== undefined) record.text = text;
  record.createdAt = now;
  record.updatedAt = now;
  const next = clone(document);
  next.annotations.push(record);
  const result = checked(next);
  return result.ok ? { ...result, id } : result;
}

/**
 * Set the note on a highlight (it becomes a note) or replace a note's text. The record keeps its id, work, target,
 * revision and creation time. Returns { ok: true, document } or { ok: false, problem }.
 */
export function setNoteText(document, id, text, now = timestamp()) {
  const next = clone(document);
  const record = next.annotations.find((each) => each.id === id);
  if (!record) return { ok: false, problem: { code: "missing", object: "document", message: "that annotation is no longer saved" } };
  record.kind = "note";
  record.text = text;
  record.updatedAt = now < record.createdAt ? record.createdAt : now;
  return checked(next);
}

/** Delete an annotation and the trail steps that named it. */
export function deleteAnnotation(document, id) {
  const next = clone(document);
  if (!next.annotations.some((each) => each.id === id)) {
    return { ok: false, problem: { code: "missing", object: "document", message: "that annotation is no longer saved" } };
  }
  next.annotations = next.annotations.filter((each) => each.id !== id);
  for (const trail of next.trails) trail.steps = trail.steps.filter((step) => step.ref !== id);
  return checked(next);
}

/** The annotations of one work, in the order the reader made them. */
export const annotationsOf = (document, work) =>
  document.annotations.filter((record) => record.work.site === work.site && record.work.path === work.path);

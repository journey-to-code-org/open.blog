// The data side of saving a post, with no page in it: what a save sends, whether there's anything
// to send, sending it, and what the post is afterwards. Write keeps the words and the buttons.
import { fieldsToSend, onlyChanges } from "./post-fields.js";

/** What a save sends: the received fields, Studio's own keys, and a recipe's numbers. */
export function fieldsForSave(received, form, values, intent, { now = new Date() } = {}) {
  const fields = fieldsToSend(received, { ...values, cover: form.cover, coverAlt: form.coverAlt }, intent, { now });
  for (const [key, value] of Object.entries(values.extra || {})) {
    const had = received[key];
    const shown = Array.isArray(had) ? had.join(", ") : had == null ? "" : String(had);
    if (value === shown) continue; // unchanged: the file keeps its own form (a list stays a list)
    if (value) fields[key] = value;
    else if (key in received) fields[key] = null;
  }
  return fields;
}

/** Nothing changed, so nothing is sent. Publishing a draft, or unscheduling, is still a change. */
export function nothingToSave({ dirty, path, state, intent, force = false }) {
  return !force && !dirty && Boolean(path) && !(intent === "publish" && state === "draft") && !(intent === "draft" && state === "scheduled");
}

/**
 * Send the save: a new post is created; an existing one sends only what changed, kept as written.
 * `credits` rides beside the fields only when who wrote it changed (`undefined` leaves the credit
 * file alone), always with the `creditEtag` the post was opened with (R5).
 */
export function sendPost(api, doc, fields, body, { credits } = {}) {
  const who = credits === undefined ? {} : { credits, creditEtag: doc.creditEtag ?? null };
  return doc.path
    ? api.call("PUT", `document?path=${encodeURIComponent(doc.path)}`, { json: { fields: onlyChanges(doc.fields, fields), body, etag: doc.etag, frontMatter: "keep", ...who } })
    : api.call("POST", "document", { json: { kind: "posts", fields, body, ...who } });
}

/** The post after the server's reply: its file, version, fields (removed ones gone) and state. */
export function afterSave(doc, reply, fields) {
  const kept = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
  return {
    ...doc,
    path: reply.path,
    etag: reply.etag,
    fields: kept,
    url: reply.url || doc.url,
    creditEtag: reply.creditEtag === undefined ? doc.creditEtag : reply.creditEtag,
    state: reply.status === "scheduled" ? "scheduled" : reply.status === "published" ? "published" : "draft",
  };
}

/** Whether the server kept the file as written, and why not. */
export function layoutOf(reply) {
  return reply.layout ? { kept: reply.layout === "kept", reason: reply.layoutReason || "" } : null;
}

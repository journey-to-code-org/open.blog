// New job's rules (Studio R4, docs/specs/studio/r4/ux.md), moved from the pure half of
// web/admin/job-capture.js (ADR 0296) and said in Studio's words: the job's id, the limits, the
// trade, service and town remembered on this phone, the draft's title, fields and body, and what's
// wrong with a photo or a job before it's kept. DOM-free and tested
// (tests/web/studio-new-job-rules.test.mjs).
import { draftBody } from "./capture-assistant-rules.js";
import { localDay, tradeLabel } from "./job-rules.js";

// Unchanged from the old Admin, so a phone keeps what it remembered.
export const PREFS_KEY = "openblog.capture.prefs.v1";
export const PREFS_VERSION = 1;
export const MAX_RECENT_TOWNS = 8;
const MAX_FIELD = 80;

export const DEFAULT_LIMITS = Object.freeze({
  maxPhotos: 12,
  maxNotesChars: 8000,
  maxPhotoBytes: 40 * 1024 * 1024,
  maxAudioSeconds: 180,
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const short = (value) => text(value).slice(0, MAX_FIELD);

/** A new job id: 128 random bits as 32 lowercase hex digits. It is the idempotency key (ADR 0297). */
export function newCaptureId(random = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  random.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The limits the server advertised, with the defaults for any it did not. */
export function captureLimits(meta = {}) {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits)) {
    const value = meta?.capture?.[key];
    if (Number.isFinite(value) && value > 0) limits[key] = value;
  }
  return limits;
}

/** The remembered picks, read defensively: anything unreadable or from another version is an empty memory. */
export function readPrefs(storage) {
  const empty = { trade: "", service: "", towns: [] };
  try {
    const stored = JSON.parse(storage?.getItem(PREFS_KEY) || "null");
    if (!stored || stored.v !== PREFS_VERSION) return empty;
    const towns = [];
    for (const town of Array.isArray(stored.towns) ? stored.towns : []) {
      const name = short(town);
      if (name && !towns.some((known) => known.toLowerCase() === name.toLowerCase())) towns.push(name);
    }
    return { trade: short(stored.trade).toLowerCase(), service: short(stored.service), towns: towns.slice(0, MAX_RECENT_TOWNS) };
  } catch {
    return empty;
  }
}

/** The memory after one more saved job: its picks first, the town moved to the front of a bounded list. */
export function rememberPicks(prefs, { trade, service, town }) {
  const name = short(town);
  const towns = name
    ? [name, ...prefs.towns.filter((known) => known.toLowerCase() !== name.toLowerCase())].slice(0, MAX_RECENT_TOWNS)
    : prefs.towns;
  return { trade: short(trade).toLowerCase() || prefs.trade, service: short(service) || prefs.service, towns };
}

export function writePrefs(storage, prefs) {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify({ v: PREFS_VERSION, ...prefs }));
  } catch {
    // Remembering is optional; the picks are simply not remembered.
  }
}

/** A service's name: its title from `meta.job.services`, or its id in words. */
export function serviceTitle(id, services = []) {
  const known = (Array.isArray(services) ? services : []).find((service) => service && (service.id === id || service === id));
  return text(known?.title) || tradeLabel(id);
}

/**
 * A job's name in her words, until she names it: "Roof repair in Elkins", "Roofing job",
 * "Job notes, November 13".
 */
export function captureTitle({ trade, service, town }, now = new Date(), services = []) {
  const kind = text(service) ? serviceTitle(text(service), services) : text(trade) ? tradeLabel(text(trade)) : "";
  if (kind && text(town)) return `${kind} in ${text(town)}`;
  if (text(service)) return kind;
  if (text(trade)) return `${kind} job`;
  if (text(town)) return `Job in ${text(town)}`;
  return `Job notes, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

/** The file name stem for a job: the title in plain letters, then the start of the id so two jobs never collide. */
export function captureSlug(title, id) {
  const stem = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${stem || "job"}-${id.slice(0, 6)}`;
}

const stamp = (now) => now.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The front matter of the draft a job becomes. Only keys About this job writes (ADR 0287). */
export function captureFields(capture, now = new Date(), services = []) {
  const { trade, service, town, draft } = capture.fields;
  const title = draft?.title || captureTitle(capture.fields, now, services);
  const fields = {
    title,
    slug: captureSlug(title, capture.id),
    date: stamp(now),
    draft: "true",
    profile: "job",
    "job.started": localDay(now),
    "job.finished": localDay(now),
  };
  if (text(trade)) fields["job.trade"] = text(trade).toLowerCase();
  if (text(service)) fields["job.service"] = text(service);
  if (text(town)) fields["job.place.town"] = text(town);
  if (draft?.description) fields.description = draft.description;
  return fields;
}

/** The body: the job scaffold, her words under its first heading, then the photos, each with a plain description to improve. */
export function captureBody({ scaffold = "", notes = "", photoUrls = [], draft = null }) {
  const words = draft ? "" : text(notes);
  let body = draft ? draftBody({ scaffold, sections: draft.sections }) : scaffold;
  if (words) {
    const heading = body.match(/^## .*$/m);
    body = heading ? body.replace(heading[0], `${heading[0]}\n\n${words}`) : `${words}\n\n${body}`;
  }
  if (photoUrls.length) {
    const pictures = photoUrls.map((url, index) => `![Photo ${index + 1} from the job](${url})`).join("\n\n");
    body = `${body.replace(/\s+$/, "")}\n\n${pictures}\n`;
  }
  return body;
}

/** What's wrong with a job before it's kept: "" or `empty`, `photos`, `notes`. */
export function captureProblem(capture, limits = DEFAULT_LIMITS) {
  const { notes } = capture.fields;
  if (!capture.photos.length && !text(notes) && !capture.audio) return "empty";
  if (capture.photos.length > limits.maxPhotos) return "photos";
  if (text(notes).length > limits.maxNotesChars) return "notes";
  return "";
}

/** The iPhone's own photo format, which websites can't show. */
export const isHeic = (file) => /^image\/hei[cf]/i.test(String(file?.type || "")) || /\.hei[cf]$/i.test(String(file?.name || ""));

/**
 * Whether a picked file can be added, after it was shrunk (or kept as it was, when this phone
 * couldn't read it, an iPhone's own format included): "" or `not-photo`, `too-big`.
 */
export function photoProblem(file, limits = DEFAULT_LIMITS) {
  if (file.type && !file.type.startsWith("image/") && !isHeic(file)) return "not-photo";
  if (!file.type && !/\.(jpe?g|png|gif|webp|avif|hei[cf])$/i.test(String(file.name || ""))) return "not-photo";
  if (file.size > limits.maxPhotoBytes) return "too-big";
  return "";
}

const bytes = (count) => `${Number(count).toLocaleString("en-US")} bytes`;

/** Details' lines about the photos in the job: what was picked and what is kept. */
export function photoBytesLines(photos = []) {
  return photos.map((photo, index) => {
    const head = `photo ${index + 1} ${photo.name}`;
    if (photo.busy) return `${head}: getting ready`;
    if (!Number.isFinite(photo.originalSize)) return `${head}: kept ${bytes(photo.size)} (${photo.type}); original not recorded`;
    const original = `original ${bytes(photo.originalSize)} (${photo.originalType || "unknown type"})`;
    if (photo.originalSize === photo.size && photo.originalType === photo.type) return `${head}: ${original}, kept as it was (not made smaller on this phone)`;
    return `${head}: ${original}, kept ${bytes(photo.size)} (${photo.type})`;
  });
}

/** A photo the server refused for good (not an image, too large): the draft goes on without it. */
export const isPermanentPhotoError = (error) => [400, 413, 415, 422].includes(error?.status);

/** How many photos, largest first, to take out so the job fits `maxBytes`. */
export function photosToRemove(photos, otherBytes, maxBytes) {
  const sizes = photos.map((photo) => photo.size || 0).sort((a, b) => b - a);
  let total = sizes.reduce((sum, size) => sum + size, 0) + (otherBytes || 0);
  let count = 0;
  while (total > maxBytes && count < sizes.length) {
    total -= sizes[count];
    count += 1;
  }
  return count;
}

const SAFARI_WARN_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Whether Safari may soon clear a job kept in this window: a Safari tab (not the Home Screen app,
 * which is exempt) clears what a site keeps after 7 days without a visit, so a job waiting more
 * than 5 days gets a warning.
 */
export function safariMayClear(record, here = {}, now = new Date()) {
  if (!record || here.browser !== "safari" || here.standalone || here.inApp) return false;
  const saved = Date.parse(record.createdAt);
  return Number.isFinite(saved) && now.getTime() - saved > SAFARI_WARN_MS;
}

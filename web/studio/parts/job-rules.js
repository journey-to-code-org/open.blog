// Moved from web/admin/job-form.js (ADR 0287) for the old Admin's retirement: the pure half, which
// reads and writes a job post's flattened `job.*` keys exactly as the old Job form did, plus what
// Write's About this job needs: trade names in words and the job's four parts. Studio R4
// (docs/specs/studio/r4/ux.md).

export const JOB_PROFILE = "job";

const KEY = {
  trade: "job.trade",
  service: "job.service",
  town: "job.place.town",
  region: "job.place.region",
  started: "job.started",
  finished: "job.finished",
  costBand: "job.costBand",
  before: "job.media.before",
  after: "job.media.after",
};

// The saved review this job links (ADR 0389). Written only when the draft says, so a caller that
// never asks about it leaves the key as it was.
const REVIEW_KEY = "job.review";

export const COST_BAND_LABELS = {
  "under-500": "Under $500",
  "500-2k": "$500 to $2,000",
  "2k-10k": "$2,000 to $10,000",
  "10k-50k": "$10,000 to $50,000",
  "over-50k": "Over $50,000",
  ask: "Ask for a quote",
};

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const list = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : []);

/** Whether a post is a job. */
export const isJob = (fields) => text(fields?.profile) === JOB_PROFILE;

/** The job's answers, read from the post's front matter fields. */
export function readJobDraft(fields = {}) {
  return {
    trade: text(fields[KEY.trade]).toLowerCase(),
    service: text(fields[KEY.service]),
    town: text(fields[KEY.town]),
    region: text(fields[KEY.region]),
    started: text(fields[KEY.started]),
    finished: text(fields[KEY.finished]),
    costBand: text(fields[KEY.costBand]),
    before: list(fields[KEY.before]),
    after: list(fields[KEY.after]),
    review: text(fields[REVIEW_KEY]),
  };
}

/** The fields with the answers written in. Keys not asked about (hours, materials) are left alone, and so is the review unless the draft names one or clears it. */
export function applyJobDraft(fields, draft) {
  const next = { ...fields };
  for (const [name, key] of Object.entries(KEY)) {
    const value = draft[name];
    const empty = Array.isArray(value) ? value.length === 0 : text(value) === "";
    if (empty) delete next[key];
    else next[key] = Array.isArray(value) ? [...value] : text(value);
  }
  if ("review" in draft) {
    if (text(draft.review)) next[REVIEW_KEY] = text(draft.review);
    else delete next[REVIEW_KEY];
  }
  return next;
}

/** A body is empty enough to take the scaffold when it holds nothing but space. */
export function bodyTakesScaffold(markdown) {
  return text(markdown) === "";
}

/** Today in her own calendar, as `YYYY-MM-DD`. */
export function localDay(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A date field only holds a plain day; anything else is shown empty and kept until she picks one. */
export function dayValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : "";
}

/** A trade id in words: "general-contractor" → "General contractor". */
export function tradeLabel(id) {
  const words = text(id).replaceAll("-", " ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/** The four headings of a job's body, from the scaffold (`meta.job.scaffold`). */
export function scaffoldHeadings(scaffold = "") {
  return (String(scaffold).match(/^## .*$/gm) || []).map((line) => line.slice(3).trim());
}

/**
 * A job body as four boxes, when it is exactly the scaffold's four `## ` headings in order with
 * words under each and nothing before the first: `[{ heading, words }]`; otherwise null, and it
 * stays one box. `joinJobBoxes(jobBoxes(body))` gives back the body byte for byte.
 */
export function jobBoxes(body, scaffold = "") {
  const headings = scaffoldHeadings(scaffold);
  if (headings.length !== 4) return null;
  const source = String(body ?? "");
  const lines = source.split("\n");
  const at = [];
  lines.forEach((line, index) => { if (/^## /.test(line)) at.push(index); });
  if (at.length !== 4 || at[0] !== 0) return null;
  const boxes = [];
  for (let i = 0; i < 4; i += 1) {
    if (lines[at[i]] !== `## ${headings[i]}`) return null;
    const end = i < 3 ? at[i + 1] : lines.length;
    boxes.push({ heading: headings[i], raw: lines.slice(at[i] + 1, end) });
  }
  return boxes.map(({ heading, raw }) => ({ heading, words: spoken(raw), raw }));
}

/** The words under a heading: its lines, without the blank lines around them. */
const spoken = (lines) => lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");

/** The body from four boxes: each heading, a blank line, its words. A box she didn't touch keeps its bytes. */
export function joinJobBoxes(boxes) {
  return boxes.flatMap(({ heading, words = "", raw }) => {
    const said = String(words).replace(/^\n+/, "").replace(/\s+$/, "");
    const kept = Array.isArray(raw) && spoken(raw) === said;
    return [`## ${heading}`, ...(kept ? raw : said ? ["", ...said.split("\n"), ""] : [""])];
  }).join("\n");
}

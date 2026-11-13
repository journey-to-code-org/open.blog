// Moved from web/admin/services.js (the old Admin's model) for the old Admin's retirement: the
// pure rules only, so Studio loads nothing from /admin/. Studio draws its own screen.
// The Services screen (ADR 0313, #511): each thing the business sells, written once. A list of the
// services under `#/services`, and a form for one (`#/services/new`, `#/services/edit/<path>`) with a name,
// an id, a summary, what is included, a price band, a typical timeline, a list of questions and answers, and
// the text that goes on the service's own page. It edits the `services/` collection through the same
// document routes posts, pages and series use; the server judges every file with the build's own rules and
// answers with the same kind of sentence, so a rule can never pass here and fail there.
//
// Designed at 400px first: one column, every control at least 44px tall, every label and message wraps.
// The pure functions at the top are the contract and are tested without a page.
/** The price bands a job or a service may name, the same as the job form's. */
export const COST_BAND_LABELS = {
  "under-500": "Under $500",
  "500-2k": "$500 to $2,000",
  "2k-10k": "$2,000 to $10,000",
  "10k-50k": "$10,000 to $50,000",
  "over-50k": "Over $50,000",
  ask: "Ask for a quote",
};


export const SERVICE_VERSION = 1;

export const LIMITS = Object.freeze({
  id: 60,
  name: 120,
  summary: 300,
  includes: 30,
  include: 160,
  timeline: 80,
  faq: 20,
  question: 200,
  answer: 1000,
});

// Keys the form owns; any other key in a file is carried through a save untouched.
const MANAGED = new Set(["version", "id", "name", "summary", "includes", "priceBand", "typicalTimeline", "draft"]);
const CONTROL = /[\u0000-\u001f\u007f]/;

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const plain = (value) => value !== "" && !CONTROL.test(value);
const sentence = (message) => {
  const text = String(message || "").trim();
  if (!text) return "";
  const capital = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

/** A service id for a name: lowercase letters, digits and hyphens, at most 60 characters. */
export function slugId(name) {
  return clean(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.id)
    .replace(/-+$/g, "");
}

export function isServiceId(value) {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && value.length <= LIMITS.id && value !== "page";
}

export function blankService() {
  return { id: "", name: "", summary: "", includes: [], priceBand: "", typicalTimeline: "", faq: [], draft: false, body: "", extra: {} };
}

const list = (value) => {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const text = clean(value);
  return text ? text.split(",").map(clean).filter(Boolean) : [];
};

/** The form for a stored document: its front matter fields (flattened `faq.<n>.question` keys) and its body. */
export function formFromDocument(fields = {}, body = "") {
  const form = blankService();
  const entries = new Map();
  for (const [key, value] of Object.entries(fields)) {
    const faq = /^faq\.(\d+)\.(question|answer)$/.exec(key);
    if (faq) {
      const entry = entries.get(Number(faq[1])) || { question: "", answer: "" };
      entry[faq[2]] = String(value ?? "");
      entries.set(Number(faq[1]), entry);
    } else if (!MANAGED.has(key) && !/^faq(\.|$)/.test(key)) {
      form.extra[key] = value;
    }
  }
  form.faq = [...entries.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
  form.id = clean(fields.id);
  form.name = clean(fields.name);
  form.summary = clean(fields.summary);
  form.includes = list(fields.includes);
  form.priceBand = clean(fields.priceBand);
  form.typicalTimeline = clean(fields.typicalTimeline);
  form.draft = ["true", "yes", "on"].includes(clean(fields.draft).toLowerCase());
  form.body = typeof body === "string" ? body : "";
  return form;
}

const blankEntry = (entry) => clean(entry.question) === "" && clean(entry.answer) === "";

/** Positions in `form.faq` of the entries a save writes: an entry with neither question nor answer is dropped. */
export function faqSlots(form) {
  return form.faq.map((entry, index) => (blankEntry(entry) ? -1 : index)).filter((index) => index >= 0);
}

/** The front matter fields a save sends: the form's answers, then every key it does not own, as it was. */
export function fieldsFromForm(form) {
  const fields = { ...form.extra, version: String(SERVICE_VERSION), id: clean(form.id), name: clean(form.name), summary: clean(form.summary) };
  const includes = form.includes.map(clean).filter(Boolean);
  if (includes.length) fields.includes = includes;
  if (clean(form.priceBand)) fields.priceBand = clean(form.priceBand);
  if (clean(form.typicalTimeline)) fields.typicalTimeline = clean(form.typicalTimeline);
  if (form.draft) fields.draft = "true";
  faqSlots(form).forEach((index, position) => {
    fields[`faq.${position + 1}.question`] = clean(form.faq[index].question);
    fields[`faq.${position + 1}.answer`] = clean(form.faq[index].answer);
  });
  for (const key of Object.keys(fields)) if (fields[key] === "") delete fields[key];
  return fields;
}

/**
 * The problems the build would find, as `{ field, message, index?, part? }`. A draft is only held to
 * having an id (it names the file); the build warns about the rest and does not publish it.
 */
export function validateForm(form) {
  const problems = [];
  const add = (field, message, extra = {}) => problems.push({ field, message, ...extra });
  const id = clean(form.id);
  if (!id) add("id", "Add a short id, such as hardwood-install. Jobs use it to say which service they were.");
  else if (!isServiceId(id)) add("id", `Use lowercase letters, digits and hyphens, up to ${LIMITS.id} characters, and not "page".`);
  if (form.draft) return problems;

  const text = (field, value, max, label) => {
    const trimmed = clean(value);
    if (!trimmed) add(field, `Add the service's ${label}.`);
    else if (!plain(trimmed) || [...trimmed].length > max) add(field, `Use 1 to ${max} characters of plain text on one line.`);
  };
  text("name", form.name, LIMITS.name, "name");
  text("summary", form.summary, LIMITS.summary, "summary");

  const includes = form.includes.map(clean).filter(Boolean);
  if (includes.length > LIMITS.includes) add("includes", `List at most ${LIMITS.includes} things the service includes.`);
  else if (includes.some((item) => !plain(item) || [...item].length > LIMITS.include)) add("includes", `Each item needs 1 to ${LIMITS.include} characters of plain text.`);

  if (clean(form.priceBand) && !(clean(form.priceBand) in COST_BAND_LABELS)) add("priceBand", "Choose one of the price bands in the list.");
  const timeline = clean(form.typicalTimeline);
  if (timeline && (!plain(timeline) || [...timeline].length > LIMITS.timeline)) add("typicalTimeline", `Use up to ${LIMITS.timeline} characters of plain text, such as 2 to 3 days.`);

  const slots = faqSlots(form);
  if (slots.length > LIMITS.faq) add("faq", `List at most ${LIMITS.faq} questions.`);
  for (const index of slots) {
    const question = clean(form.faq[index].question);
    const answer = clean(form.faq[index].answer);
    if (!question) add("faq", "Add the question this answer is for.", { index, part: "question" });
    else if (!plain(question) || [...question].length > LIMITS.question) add("faq", `A question needs 1 to ${LIMITS.question} characters of plain text.`, { index, part: "question" });
    if (!answer) add("faq", "Add an answer.", { index, part: "answer" });
    else if (!plain(answer) || [...answer].length > LIMITS.answer) add("faq", `An answer needs 1 to ${LIMITS.answer} characters of plain text.`, { index, part: "answer" });
  }
  return problems;
}

const FIELD_NAMES = ["version", "id", "name", "summary", "includes", "priceBand", "typicalTimeline"];

/**
 * The server's problem sentences (`services/x.md: summary: ...; faq entry 2: add an answer`) as the same
 * `{ field, message, index?, part? }` the form produces. `slots` is `faqSlots(form)` for what was sent, because
 * the server counts only the entries that were written.
 */
export function problemsFromServer(items, slots = []) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item).replace(/^[^\s:]*\.md: /, "");
    for (const part of text.split(/; (?=(?:version|id|name|summary|includes|priceBand|typicalTimeline|faq entry \d+|faq): )/)) {
      const entry = /^faq entry (\d+): (.*)$/s.exec(part);
      if (entry) {
        const index = slots[Number(entry[1]) - 1];
        const message = sentence(entry[2]);
        const which = /question/.test(entry[2]) && !/answer/.test(entry[2]) ? "question" : /answer/.test(entry[2]) && !/question/.test(entry[2]) ? "answer" : "";
        out.push({ field: "faq", message, ...(index === undefined ? {} : { index }), ...(which ? { part: which } : {}) });
        continue;
      }
      const named = /^([A-Za-z]+): (.*)$/s.exec(part);
      if (named && (FIELD_NAMES.includes(named[1]) || named[1] === "faq")) {
        out.push({ field: named[1] === "version" ? "" : named[1], message: sentence(named[2]) });
      } else {
        out.push({ field: "", message: sentence(part) });
      }
    }
  }
  return out;
}

const ERROR_TEXT = Object.freeze({
  413: "That is too much to save. Shorten the longest entries and try again.",
  401: "You were signed out. Sign in again, then save.",
});

export function serviceErrorText(error) {
  const status = error?.status;
  if (ERROR_TEXT[status]) return ERROR_TEXT[status];
  if (status === 409) return "This service changed in another window or by someone else. Reload it, then make your changes again.";
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `The service was not saved. ${detail}` : "The service was not saved. Check your connection and try again.";
}

export const PRICE_BAND_CHOICES = Object.freeze(Object.entries(COST_BAND_LABELS));

let uid = 0;


// Suggestions for future work (RD13, ADRs 0190 to 0195): the browser and hosted-function half of the
// contract in crates/openblog-core/src/future_suggestion.rs. Both read
// tests/fixtures/future-suggestion-submissions.json and must agree on every code and record.
//
// A suggestion is a reader's question, text, video, audio or other source for the editors' private
// queue: their own words, an optional public link, optional bibliographic hints (their statement,
// never fetched or verified), an optional series or article it is about, a name they chose and an
// optional, consented way to reach them. It is never public and approving it only means the editors
// are interested; nothing here fetches a link, ranks or counts suggestions, or sends a message.
//
// Everything here is a pure function: nothing is fetched, stored or sent, and a failure is a value
// with a code and a message that names the field and never repeats what the reader wrote.

import { isCanonicalTime, isWorkPath, normalizeSourceUrl } from "./passage-feedback.js";
import { publicUrlProblem } from "./public-url.js";
import { hasLoneSurrogate, isObject, scan, utf8Length, versionOf } from "./third-perspective.js";

export const FUTURE_SUGGESTION_KIND = "future-suggestion";
export const FUTURE_SUGGESTION_LABEL = "Suggestion for future work";
export const FUTURE_SUGGESTION_VERSION = 1;
export const MAX_TEXT_CHARS = 2000;
export const MAX_HINT_CHARS = 300;
export const MAX_CREATOR_CHARS = 200;
export const MAX_CREATORS = 8;
export const MAX_IDENTIFIERS = 4;
export const MAX_IDENTIFIER_CHARS = 128;
export const MAX_IDENTIFIER_URL_CHARS = 2048;
export const MAX_YEAR_CHARS = 32;
export const MAX_CONTACT_BYTES = 254;
export const MAX_ID_CHARS = 64;
export const MAX_READER_NAME_CHARS = 80;
export const MAX_SUBMISSION_BYTES = 12 * 1024;
// Below the 16 KiB of the column's check, measured as Postgres measures jsonb text (a space after
// every `:` and `,`), so a link that percent-encoding made longer never makes the insert fail.
export const MAX_STORED_DETAILS_BYTES = 15 * 1024;
// The build's JSON reader refuses documents nested deeper than this.
const MAX_JSON_DEPTH = 127;

/** The suggestion types, in the order a form offers them, with labels that name an intent. */
export const SUGGESTION_TYPES = Object.freeze([
  Object.freeze({ id: "question", label: "Question for a future piece", words: "Your question" }),
  Object.freeze({ id: "text", label: "Text to read", words: "Why it is worth reading" }),
  Object.freeze({ id: "video", label: "Video to watch", words: "Why it is worth watching" }),
  Object.freeze({ id: "audio", label: "Audio to hear", words: "Why it is worth hearing" }),
  Object.freeze({ id: "source", label: "Other source", words: "What it is and why it matters" }),
]);
const TYPE_IDS = new Set(SUGGESTION_TYPES.map((type) => type.id));
export const IDENTIFIER_SCHEMES = Object.freeze(["doi", "isbn", "issn", "url", "pmid", "pmcid"]);

/** What acceptance means, in the words an editor's screen and a reader's receipt use. */
export const ACCEPTANCE_NOTICE = "Accepted means the editors are interested in exploring this. It does not mean they agree with it, have checked it, or have permission to use it.";

const WHITE_SPACE = "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const TRIM = new RegExp(`^[${WHITE_SPACE}]+|[${WHITE_SPACE}]+$`, "gu");
const SPACES = new RegExp(`[${WHITE_SPACE}]+`, "u");
const codePoint = (character) => character.codePointAt(0);
const isControl = (character) => codePoint(character) <= 0x1f || (codePoint(character) >= 0x7f && codePoint(character) <= 0x9f);
const isBidiControl = (character) => {
  const point = codePoint(character);
  return (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069);
};

const failure = (code, message) => ({ ok: false, error: { code, message } });
const malformed = (message) => failure("malformed", message);

/** Trimmed reader text of 1 to `max` characters without control (other than tab and line breaks) or text-direction characters, or null. */
export function readerText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(TRIM, "");
  const chars = Array.from(text);
  const forbidden = chars.some((c) => (isControl(c) && c !== "\t" && c !== "\n" && c !== "\r") || isBidiControl(c));
  return chars.length >= 1 && chars.length <= max && !forbidden ? text : null;
}

/** A slug as the site writes them (its `slugify`): letters and digits, non-ASCII ones too, lowercased, joined by single hyphens. */
export function slugify(input) {
  let out = "";
  let pendingDash = false;
  for (const character of String(input)) {
    if (/[\p{Alphabetic}\p{N}]/u.test(character)) {
      if (pendingDash && out !== "") out += "-";
      pendingDash = false;
      out += character.toLowerCase();
    } else {
      pendingDash = true;
    }
  }
  return out;
}
export const isSlug = (value) => typeof value === "string" && value !== "" && Array.from(value).length <= MAX_ID_CHARS && slugify(value) === value;

/**
 * A source link a reader gave: an absolute HTTP(S) address without credentials, written as the
 * build writes it, that also passes the one rule for a public address. Returns the normalized link
 * or null.
 */
export function normalizeSuggestionUrl(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized !== null && publicUrlProblem(normalized) === null ? normalized : null;
}

// ---- Identifier shapes, as the Source Library checks them offline

const checkDigits = (value) => Array.from(value).filter((c) => c !== "-" && c !== " ").map((c) => (c === "X" || c === "x" ? 10 : /^[0-9]$/.test(c) ? Number(c) : Number.POSITIVE_INFINITY));

function validIsbn(value) {
  const digits = checkDigits(value);
  const body = (list) => list.every((digit) => digit < 10);
  if (digits.length === 10) {
    const sum = digits.reduce((total, digit, index) => total + digit * (10 - index), 0);
    return body(digits.slice(0, 9)) && digits[9] <= 10 && sum % 11 === 0;
  }
  if (digits.length === 13) {
    const sum = digits.reduce((total, digit, index) => total + (index % 2 === 0 ? digit : digit * 3), 0);
    return body(digits) && sum % 10 === 0;
  }
  return false;
}

function validIssn(value) {
  const digits = checkDigits(value);
  const sum = digits.reduce((total, digit, index) => total + digit * (8 - index), 0);
  return digits.length === 8 && digits.slice(0, 7).every((digit) => digit < 10) && digits[7] <= 10 && sum % 11 === 0;
}

/** A DOI as a bare name, from a bare name, `doi:` or a resolver link; null when it is none. */
function doiName(value) {
  if (/^https?:\/\//i.test(value)) {
    if (value.includes("#") || value.includes("?")) return null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.username !== "" || url.password !== "" || !["doi.org", "dx.doi.org"].includes(url.hostname.toLowerCase())) return null;
    try {
      return decodeURIComponent(url.pathname.replace(/^\//, "")).replace(TRIM, "");
    } catch {
      return null;
    }
  }
  return value.replace(/^doi:/i, "").replace(TRIM, "");
}

function validDoi(value) {
  const name = doiName(value);
  if (name === null || Array.from(name).some((c) => isControl(c) || new RegExp(`^[${WHITE_SPACE}]$`, "u").test(c))) return false;
  const slash = name.indexOf("/");
  if (slash < 0) return false;
  const prefix = name.slice(0, slash);
  const suffix = name.slice(slash + 1);
  return prefix.startsWith("10.") && prefix.length - 3 >= 4 && /^[0-9]+$/.test(prefix.slice(3)) && suffix !== "";
}

const digitsOnly = (text) => text !== "" && text.length <= 12 && /^[0-9]+$/.test(text);

/** An identifier hint as stored: `{scheme, value}` with its value checked for shape, or null. */
function readIdentifier(hint) {
  const scheme = hint.scheme;
  const longest = scheme === "url" ? MAX_IDENTIFIER_URL_CHARS : MAX_IDENTIFIER_CHARS;
  const value = readerText(hint.value, longest);
  if (value === null || !IDENTIFIER_SCHEMES.includes(scheme)) return null;
  if (scheme === "url") {
    const link = normalizeSuggestionUrl(value);
    return link === null ? null : { scheme, value: link };
  }
  if (scheme === "doi" && !validDoi(value)) return null;
  if (scheme === "isbn" && !validIsbn(value)) return null;
  if (scheme === "issn" && !validIssn(value)) return null;
  if (scheme === "pmid" && !digitsOnly(value)) return null;
  if (scheme === "pmcid" && !(value.startsWith("PMC") && digitsOnly(value.slice(3)))) return null;
  return { scheme, value };
}

/** A plain mailbox: one ASCII `local@domain`, no display name, comment, quoting or whitespace. */
export function isPlainAddress(address) {
  if (typeof address !== "string" || utf8Length(address) > MAX_CONTACT_BYTES) return false;
  const at = address.indexOf("@");
  if (at < 0) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const localOk = local.length >= 1 && local.length <= 64 && /^[A-Za-z0-9._%+-]+$/.test(local) && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
  const labels = domain.split(".");
  const domainOk = labels.length >= 2 && labels.every((label) => label.length >= 1 && label.length <= 63 && /^[A-Za-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"));
  return localOk && domainOk;
}

// ---- The submission

const SUBMISSION_FIELDS = new Set(["version", "kind", "type", "text", "url", "hints", "about", "attribution", "contact"]);
const HINT_FIELDS = new Set(["title", "creators", "year", "publisher", "identifiers"]);
const IDENTIFIER_FIELDS = new Set(["scheme", "value"]);
const ATTRIBUTION_FIELDS = new Set(["name", "publishName"]);
const CONTACT_FIELDS = new Set(["address", "followUp"]);
const onlyFields = (value, fields) => Object.keys(value).every((key) => fields.has(key));
const optionalString = (value) => value === undefined || value === null || typeof value === "string";

const absent = (value) => value === undefined || value === null;

/** Whether the shape (types and field names, nothing about content) is what the build's reader accepts. */
function shaped(value) {
  if (!onlyFields(value, SUBMISSION_FIELDS)) return false;
  if (!["kind", "type", "text"].every((key) => typeof value[key] === "string")) return false;
  if (!optionalString(value.url)) return false;
  const { hints, attribution, contact } = value;
  if (!absent(hints)) {
    if (!isObject(hints) || !onlyFields(hints, HINT_FIELDS)) return false;
    if (!optionalString(hints.title) || !optionalString(hints.year) || !optionalString(hints.publisher)) return false;
    if (hints.creators !== undefined && !(Array.isArray(hints.creators) && hints.creators.every((name) => typeof name === "string"))) return false;
    if (hints.identifiers !== undefined) {
      const ok = Array.isArray(hints.identifiers) && hints.identifiers.every((entry) => isObject(entry) && onlyFields(entry, IDENTIFIER_FIELDS) && typeof entry.scheme === "string" && typeof entry.value === "string");
      if (!ok) return false;
    }
  }
  if (!absent(attribution)) {
    if (!isObject(attribution) || !onlyFields(attribution, ATTRIBUTION_FIELDS) || !optionalString(attribution.name)) return false;
    if (attribution.publishName !== undefined && typeof attribution.publishName !== "boolean") return false;
  }
  if (!absent(contact)) {
    if (!isObject(contact) || !onlyFields(contact, CONTACT_FIELDS) || typeof contact.address !== "string" || typeof contact.followUp !== "boolean") return false;
  }
  return true;
}

function readAbout(about) {
  const invalid = (message) => failure("invalidAbout", message);
  if (!isObject(about) || Object.keys(about).length !== 1) return invalid("`about` names exactly one of `series` or `article`");
  if (Object.hasOwn(about, "series")) {
    return typeof about.series === "string" && isSlug(about.series)
      ? { ok: true, about: { series: about.series } }
      : invalid("`about.series` must be a slug as this site writes them: lowercase letters and digits joined by single hyphens");
  }
  if (Object.hasOwn(about, "article")) {
    return typeof about.article === "string" && isWorkPath(about.article)
      ? { ok: true, about: { article: about.article } }
      : invalid("`about.article` must be the site-relative path of a published page");
  }
  return invalid("`about` names exactly one of `series` or `article`");
}

function readHints(hints) {
  const invalid = (message) => failure("invalidHint", message);
  const text = (field, value, max) => {
    if (absent(value)) return { ok: true };
    const read = readerText(value, max);
    return read === null ? invalid(`\`hints.${field}\` must be 1 to ${max} characters of plain text`) : { ok: true, value: read };
  };
  const out = {};
  for (const [field, max] of [["title", MAX_HINT_CHARS], ["year", MAX_YEAR_CHARS], ["publisher", MAX_HINT_CHARS]]) {
    const read = text(field, hints[field], max);
    if (!read.ok) return read;
    if (read.value !== undefined) out[field] = read.value;
  }
  const creators = hints.creators ?? [];
  if (creators.length > MAX_CREATORS) return invalid(`\`hints.creators\` takes at most ${MAX_CREATORS} names`);
  const names = [];
  for (const name of creators) {
    const read = readerText(name, MAX_CREATOR_CHARS);
    if (read === null) return invalid(`each \`hints.creators\` entry must be 1 to ${MAX_CREATOR_CHARS} characters of plain text`);
    names.push(read);
  }
  if (names.length) out.creators = names;
  const identifiers = hints.identifiers ?? [];
  if (identifiers.length > MAX_IDENTIFIERS) return invalid(`\`hints.identifiers\` takes at most ${MAX_IDENTIFIERS}`);
  const read = [];
  for (const hint of identifiers) {
    const identifier = readIdentifier(hint);
    if (identifier === null) return invalid("each `hints.identifiers` entry needs one of the schemes doi, isbn, issn, url, pmid or pmcid and a value of that shape");
    read.push(identifier);
  }
  if (read.length) out.identifiers = read;
  return { ok: true, hints: out };
}

/**
 * Read a submission from JSON text of at most MAX_SUBMISSION_BYTES:
 * `{version, kind, type, text, url?, hints?, about?, attribution?, contact?}`. Returns { ok: true,
 * submission } with a new, frozen submission, or { ok: false, error: { code, message } }. The
 * checks run in the build's order, so both report the same first problem.
 */
export function readSuggestionSubmissionJson(text) {
  const source = String(text);
  if (utf8Length(source) > MAX_SUBMISSION_BYTES) return failure("tooLarge", `a suggestion is larger than ${MAX_SUBMISSION_BYTES} bytes`);
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return malformed("a suggestion is not valid JSON");
  }
  const { spans, deepest, overflow } = scan(source);
  if (deepest > MAX_JSON_DEPTH || overflow || hasLoneSurrogate(value)) return malformed("a suggestion is not valid JSON");
  const version = isObject(value) ? versionOf(spans.get("version")) : null;
  if (version === null) return malformed("a suggestion needs `version` 1");
  if (version > BigInt(FUTURE_SUGGESTION_VERSION)) {
    return failure("unsupportedVersion", `this suggestion is version ${version}, newer than the version ${FUTURE_SUGGESTION_VERSION} this open.blog reads`);
  }
  if (version !== BigInt(FUTURE_SUGGESTION_VERSION)) return malformed("a suggestion needs `version` 1");
  if (!shaped(value)) return malformed("a suggestion has a field this version does not define, or a field of the wrong type");
  if (value.kind !== FUTURE_SUGGESTION_KIND) return failure("wrongKind", "a suggestion's `kind` must be `future-suggestion`");
  if (!TYPE_IDS.has(value.type)) return failure("unknownType", "`type` is not a suggestion type");
  const words = readerText(value.text, MAX_TEXT_CHARS);
  if (words === null) return failure("invalidText", `\`text\` must be 1 to ${MAX_TEXT_CHARS} characters of plain text`);
  const hintsGiven = value.hints ?? {};
  const hintsEmpty = absent(hintsGiven.title) && absent(hintsGiven.year) && absent(hintsGiven.publisher) && (hintsGiven.creators ?? []).length === 0 && (hintsGiven.identifiers ?? []).length === 0;
  if (value.type === "question" && (!absent(value.url) || !hintsEmpty)) return failure("notForQuestion", "a question is words only; send a source as its own suggestion");
  let url = null;
  if (!absent(value.url)) {
    url = normalizeSuggestionUrl(value.url);
    if (url === null) return failure("invalidUrl", "`url` must be an absolute public http: or https: address without credentials");
  }
  let about = null;
  if (!absent(value.about)) {
    const read = readAbout(value.about);
    if (!read.ok) return read;
    about = read.about;
  }
  const attribution = value.attribution ?? {};
  let name = null;
  if (!absent(attribution.name)) {
    const collapsed = attribution.name.split(SPACES).filter((part) => part !== "").join(" ");
    name = readerText(collapsed, MAX_READER_NAME_CHARS);
    if (name === null) return failure("invalidName", `\`attribution.name\` must be 1 to ${MAX_READER_NAME_CHARS} characters of plain text`);
  }
  const publishName = attribution.publishName === true;
  if (name === null && publishName) return failure("consentWithoutName", "`attribution.publishName` needs a name to publish");
  let contact = null;
  if (!absent(value.contact)) {
    if (!value.contact.followUp) return failure("contactWithoutConsent", "`contact` is kept only when `followUp` agrees to be contacted");
    if (!isPlainAddress(value.contact.address)) return failure("invalidContact", "`contact.address` must be one plain e-mail address such as name@example.org");
    contact = { address: value.contact.address, followUp: true };
  }
  const hints = readHints(hintsGiven);
  if (!hints.ok) return hints;
  const submission = { version: FUTURE_SUGGESTION_VERSION, kind: FUTURE_SUGGESTION_KIND, type: value.type, text: words };
  if (url !== null) submission.url = url;
  if (Object.keys(hints.hints).length) submission.hints = hints.hints;
  if (about !== null) submission.about = about;
  if (name !== null) submission.attribution = Object.freeze({ name, publishName });
  if (contact !== null) submission.contact = Object.freeze(contact);
  if (storedDetailsBytes(suggestionDetails(submission)) > MAX_STORED_DETAILS_BYTES) {
    return failure("tooLarge", `a suggestion's links and hints are larger than ${MAX_STORED_DETAILS_BYTES} bytes once stored`);
  }
  return { ok: true, submission: Object.freeze(submission) };
}

const separatorBytes = (value) => {
  if (Array.isArray(value)) return Math.max(0, value.length - 1) + value.reduce((sum, item) => sum + separatorBytes(item), 0);
  if (isObject(value)) {
    const members = Object.values(value);
    return (members.length ? 2 * members.length - 1 : 0) + members.reduce((sum, item) => sum + separatorBytes(item), 0);
  }
  return 0;
};

/** The bytes `details` takes in the hosted table, as Postgres measures `octet_length(details::text)`. */
export const storedDetailsBytes = (details) => utf8Length(JSON.stringify(details)) + separatorBytes(details);

/** The fields a hosted row keeps in `details`, beside the columns that hold the text and the reader's name. */
export function suggestionDetails(submission) {
  const details = { type: submission.type };
  if (submission.url !== undefined) details.url = submission.url;
  if (submission.hints !== undefined) details.hints = submission.hints;
  if (submission.about !== undefined) details.about = submission.about;
  if (submission.contact !== undefined) details.contact = { ...submission.contact };
  return details;
}

/**
 * What a receiver keeps of a hosted submission (ADR 0192): the canonical record, as the build
 * writes it, and the `openblog_feedback` row's columns. `work` is the published page it was sent
 * from and `receivedAt` the receiver's own canonical time; the reader's clock is not used.
 */
export function receiveSuggestion(submission, work, receivedAt) {
  if (!isWorkPath(work)) throw new TypeError("work must be the site-relative path of a published page");
  if (!isCanonicalTime(receivedAt)) throw new TypeError("receivedAt must be a canonical UTC time");
  const attribution = submission.attribution;
  const record = { ...submission, receipt: { work, receivedAt, channel: "hosted" }, revision: 1 };
  return {
    record,
    row: {
      format_version: FUTURE_SUGGESTION_VERSION,
      kind: FUTURE_SUGGESTION_KIND,
      work,
      revision: null,
      target: null,
      body: submission.text,
      details: suggestionDetails(submission),
      seen_at: null,
      received_at: receivedAt,
      channel: "hosted",
      reader_name: attribution?.name ?? null,
      publish_name: attribution?.publishName === true,
    },
  };
}

/** A reader's answer to a clarification request replaces the text and nothing else: the new text, or null. */
export const readClarification = (value) => readerText(value, MAX_TEXT_CHARS);

/** Whether a stored row holds anything private to the site Admin and the reader: a contact, or a name not agreed to be shown. */
export const holdsIdentity = (row) => isObject(row?.details?.contact) || (typeof row?.reader_name === "string" && row.reader_name !== "" && row.publish_name !== true);

/**
 * What clearing a kept suggestion's private identity changes (ADR 0193): its details without the
 * contact, and no name unless the reader agreed to show it. The text, the link, the hints and the
 * page stay.
 */
export function scrubbedIdentity(row) {
  const { contact, ...details } = isObject(row?.details) ? row.details : {};
  return { details, reader_name: row?.publish_name === true ? row.reader_name ?? null : null };
}

/**
 * The copy-and-send path when no hosted service takes the suggestion: plain text a reader can copy
 * into a message to the author. Its last line is the submission's canonical JSON, which the author
 * can read by hand. Nothing is sent anywhere.
 */
export function suggestionCopyText(submission, canonicalUrl = "") {
  const type = SUGGESTION_TYPES.find((entry) => entry.id === submission.type);
  const lines = [`${FUTURE_SUGGESTION_LABEL} (${type ? type.label : submission.type})${canonicalUrl ? ` from ${canonicalUrl}` : ""}`, "", submission.text, ""];
  if (submission.url) lines.push(`Link: ${submission.url}`);
  const hints = submission.hints ?? {};
  if (hints.title) lines.push(`Title: ${hints.title}`);
  if (hints.creators) lines.push(`By: ${hints.creators.join("; ")}`);
  if (hints.year) lines.push(`Year: ${hints.year}`);
  if (hints.publisher) lines.push(`Publisher: ${hints.publisher}`);
  for (const identifier of hints.identifiers ?? []) lines.push(`${identifier.scheme.toUpperCase()}: ${identifier.value}`);
  if (submission.about) lines.push(`About: ${submission.about.series ? `the series ${submission.about.series}` : `the article ${submission.about.article}`}`);
  if (submission.attribution) lines.push(`Name: ${submission.attribution.name} (${submission.attribution.publishName ? "may be shown if used" : "not to be shown"})`);
  if (submission.contact) lines.push(`You may contact me at ${submission.contact.address} about this.`);
  lines.push("", "open.blog suggestion record (for the author; keep it on one line):", JSON.stringify(submission));
  return lines.join("\n");
}

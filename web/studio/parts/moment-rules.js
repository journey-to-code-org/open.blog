// Moments' rules (Studio R14b), lifted from the old Admin's media moments (ADR 0062 to 0065) and
// given her words: where a moment can sit, the rights and where the words came from, reading a
// typed time exactly as the server does, the request, the server's quotation notices, the order
// they read in, and filling in a source's details from its link. Pure and DOM-free.
import { say } from "./words.js";

/** Where in what started it a moment can sit. Folios are never offered. */
export const MOMENT_LOCATOR_KINDS = Object.freeze([
  { value: "timestamp", words: () => say("moments.kindTime"), hint: () => say("moments.kindTimeHint") },
  { value: "page", words: () => say("moments.kindPage"), hint: () => say("moments.kindPageHint") },
  { value: "chapter", words: () => say("moments.kindChapter"), hint: () => say("moments.kindChapterHint") },
  { value: "section", words: () => say("moments.kindSection"), hint: () => say("moments.kindSectionHint") },
  { value: "line", words: () => say("moments.kindLine"), hint: () => say("moments.kindLineHint") },
  { value: "canonical", words: () => say("moments.kindCanonical"), hint: () => say("moments.kindCanonicalHint") },
]);

/** Her statement about quoting the words. No default on purpose: nothing here judges a use (ADR 0065). */
export const QUOTATION_RIGHTS = Object.freeze([
  { value: "unknown", words: () => say("moments.rightsUnknown") },
  { value: "briefQuotation", words: () => say("moments.rightsBrief") },
  { value: "permission", words: () => say("moments.rightsPermission") },
  { value: "openLicense", words: () => say("moments.rightsOpen") },
  { value: "publicDomain", words: () => say("moments.rightsPublicDomain") },
  { value: "ownWords", words: () => say("moments.rightsOwn") },
]);

/** Where the quoted words came from. */
export const QUOTATION_PROVENANCE = Object.freeze([
  { value: "transcribed", words: () => say("moments.provenanceTranscribed") },
  { value: "copied", words: () => say("moments.provenanceCopied") },
  { value: "supplied", words: () => say("moments.provenanceSupplied") },
]);

const MAX_LOCATOR_CHARS = 64;

/**
 * A typed time read the way the server reads it: seconds, m:ss or h:mm:ss, each later part two
 * digits below 60, with an optional fraction. Anything else (1h2m, 1:2, 1:60, a sign, a space) is
 * null rather than a guess.
 */
export function parseMomentTimestamp(text) {
  const match = /^(\d+(?::[0-5]\d){0,2})(?:\.(\d+))?$/.exec(String(text ?? ""));
  if (!match) return null;
  let seconds = 0;
  for (const part of match[1].split(":")) {
    seconds = seconds * 60 + Number(part);
    if (!Number.isSafeInteger(seconds)) return null;
  }
  return { seconds, fraction: (match[2] || "").replace(/0+$/, "") };
}

function timeBefore(a, b) {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds;
  const width = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(width, "0") < b.fraction.padEnd(width, "0");
}

/** What is wrong with a typed place, in her words, or "" when the server would take its shape. */
export function momentLocationError(kind, value, to) {
  for (const [text, end] of [[value, false], [to, true]]) {
    if (end && (text === undefined || text === null || text === "")) continue;
    const typed = String(text ?? "");
    if (!typed) return say("moments.needWhere");
    if (typed.trim() !== typed || [...typed].length > MAX_LOCATOR_CHARS || /[\u0000-\u001f\u007f;[\]]/.test(typed) || typed.includes(" to ")) return say("moments.badWhere");
    if (kind === "timestamp" && !parseMomentTimestamp(typed)) return say("moments.badTime");
  }
  if (kind === "timestamp" && to && !timeBefore(parseMomentTimestamp(value), parseMomentTimestamp(to))) return say("moments.endBefore");
  return "";
}

/**
 * The moment to send for the typed form, or the field to fix and why. `keep` carries what the
 * form doesn't edit (further places, the quotation's language), so changing a moment never drops it.
 */
export function momentPayload(form, keep = {}) {
  if (!form.source) return { error: say("moments.needSource"), field: "source" };
  const locationError = momentLocationError(form.kind, form.value, form.to);
  if (locationError) return { error: locationError, field: form.value && !momentLocationError(form.kind, form.value, "") ? "to" : "value" };
  const locator = { kind: form.kind, value: form.value };
  if (form.to) locator.to = form.to;
  const moment = { source: form.source, locators: [locator, ...(keep.locators || [])], intent: form.publish ? "publication" : "private" };
  if (form.quote) {
    if (!form.rights) return { error: say("moments.needRights"), field: "rights" };
    if (!form.provenance) return { error: say("moments.needProvenance"), field: "provenance" };
    if (form.publish && form.rights === "unknown") return { error: say("moments.uncheckedPrivate"), field: "rights" };
    const quotation = { text: form.quote, rights: form.rights, provenance: form.provenance };
    const speaker = String(form.speaker ?? "").trim();
    if (speaker) quotation.speaker = speaker;
    const rightsNote = String(form.rightsNote ?? "").trim();
    if (rightsNote) quotation.rightsNote = rightsNote;
    if (keep.language) quotation.language = keep.language;
    moment.quotation = quotation;
  }
  if (String(form.observation ?? "").trim()) moment.observation = form.observation;
  if (!moment.quotation && !moment.observation) return { error: say("moments.needSomething"), field: "quote" };
  return { moment };
}

/**
 * The server's notices about typed words (no speaker named; longer than a short quotation),
 * counted in characters as the server counts. They never stop a save. Without the server's guide,
 * none rather than a guess.
 */
export function quotationNotices(form, guide) {
  const text = String(form?.quote ?? "");
  if (!text || !guide?.notices) return [];
  const notices = [];
  const note = (code) => guide.notices[code] && notices.push({ code, message: guide.notices[code] });
  if (!String(form.speaker ?? "").trim()) note("noSpeaker");
  if (Number.isSafeInteger(guide.briefQuotationChars) && [...text].length > guide.briefQuotationChars) note(form.rights === "briefQuotation" ? "longForBriefQuotation" : "long");
  return notices;
}

/** The server's neutral guidance for a rights choice, then that it is her own statement. */
export function rightsGuidanceText(rights, guide) {
  const entry = (guide?.rights || []).find((item) => item.value === rights);
  return [entry?.guidance, say("moments.statement")].filter(Boolean).join(" ");
}

/** Moments in reading order: by the source's place, then by time, then as made. */
export function sortMoments(moments, sources) {
  const place = (moment) => {
    const index = (sources || []).findIndex((source) => source.id === moment.source);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const start = (moment) => {
    const locator = (moment.locators || []).find((entry) => entry.kind === "timestamp");
    return locator ? parseMomentTimestamp(locator.value) : null;
  };
  const made = (moment) => Number(/^moment-(\d+)$/.exec(moment.id || "")?.[1] ?? Number.MAX_SAFE_INTEGER);
  return (moments || []).map((moment, index) => ({ moment, index })).sort((a, b) => {
    const byPlace = place(a.moment) - place(b.moment);
    if (byPlace) return byPlace;
    const [x, y] = [start(a.moment), start(b.moment)];
    if (x && y && (timeBefore(x, y) || timeBefore(y, x))) return timeBefore(x, y) ? -1 : 1;
    if (x && !y) return -1;
    if (y && !x) return 1;
    return made(a.moment) - made(b.moment) || a.index - b.index;
  }).map((entry) => entry.moment);
}

/** One moment as words: in what, where, and who can see it. */
export function momentText(moment, sources, speak = say) {
  const source = (sources || []).find((entry) => entry.id === moment?.source);
  // The source's title and the place are someone's own words: apart, given `isolating`.
  return speak("moments.line", { source: source ? source.title : say("moments.unlisted"), where: moment?.location || "", who: moment?.intent === "publication" ? say("moments.proposed") : say("moments.private") }, [...(source ? ["source"] : []), "where"]);
}

/** The words for a moment's link: whether it opens at the moment. "" when there is no link. */
export function momentLinkText(moment) {
  if (!moment?.link?.href) return "";
  const start = (moment.locators || []).find((entry) => entry.kind === "timestamp")?.value;
  return moment.link.atTime && start ? say("moments.openAt", { at: start }) : say("moments.openSource");
}

/** What sharing a version said about her moments, in her words: "" when they went with it. */
export function offeredMomentsText(result) {
  if (result?.momentsShared === false) return say("moments.changedAfter");
  if (result && "momentsShared" in result && result.momentsShared === null) return say("moments.notShared");
  return "";
}

// ---- Fill in from the link

const SUGGESTED = ["title", "creator", "publisher"];
const FIELD_WORDS = { title: () => say("moments.fieldTitle"), creator: () => say("moments.fieldCreator"), publisher: () => say("moments.fieldPublisher") };

/** Copy suggestions into a source, only into boxes she left empty. Returns which were filled. */
export function applySourceSuggestion(source, suggestion) {
  const applied = [];
  if (!source || !suggestion || suggestion.provenance !== "provider") return applied;
  for (const key of SUGGESTED) {
    const value = suggestion[key];
    if (typeof value === "string" && value.trim() && !String(source[key] ?? "").trim()) {
      source[key] = value.trim();
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Ask the server for optional details about a source's link. Never throws and never blocks
 * writing: every failure becomes a sentence and the source stays as she left it.
 */
export async function lookupSourceDetails(source, call, isCurrent = () => true) {
  const url = String(source?.url ?? "").trim();
  if (!url) return { applied: [], message: say("moments.fillPasteFirst") };
  let result;
  try {
    result = await call({ url });
  } catch {
    return { applied: [], message: say("moments.fillFailed") };
  }
  if (!isCurrent() || String(source?.url ?? "").trim() !== url) return { applied: [], stale: true, message: say("moments.fillStale") };
  if (result?.status === "found" && result.suggestion) {
    const applied = applySourceSuggestion(source, result.suggestion);
    const provider = String(result.suggestion.publisher || result.embed?.provider || "");
    return { applied, provider, message: applied.length ? say("moments.fillDone", { site: provider, fields: applied.map((key) => FIELD_WORDS[key]()).join(", ") }) : say("moments.fillNothing", { site: provider }) };
  }
  if (result?.status === "unavailable") return { applied: [], message: say("moments.fillFailed") };
  return { applied: [], message: say("moments.fillUnsupported") };
}

// Before you publish (Studio R7): what the checks found, in one list, and when it opens by
// itself. Pure: given what the checks answered, the state and the words. Checks suggest; only what
// the build would refuse blocks. Needs-review items can't be "fixed", so they never count and never
// open the sheet. `searchHints` is the old Admin's `analyzeReadiness` (the old Admin's admin.js, removed
// in R15) split in two, her suggestions and the hints for the person who set up the site, with no
// score.
import { say } from "./words.js";

const chars = (text) => [...String(text ?? "")].length;
const LONG_SUMMARY = 160;
const LONG_TITLE = 65;

/** R6's rule each engine accessibility code repeats, when it does: the engine's is then dropped. */
export const SAME_AS_R6 = Object.freeze({
  "image-alt-review": "picture-description",
  "image-alt-placeholder": "picture-file-name",
  "link-name-empty": "empty-link",
  "link-purpose-review": "vague-link",
  "heading-level-skip": "heading-skip",
  "raw-html-review": "html",
});

/** The name a picture's description has in a line of her words (`![IMG_2041.jpg](…)`). */
const altIn = (line) => /!\[([^\]\n]*)\]/.exec(String(line || ""))?.[1]?.trim() || "";

/**
 * Where a finding's line is in her words: the line from 1 counted in her words (`body`), or null
 * when it is above them (a field). `firstBodyLine` is the server's line of her first line.
 */
export function bodyPlace(line, firstBodyLine, body = "") {
  const n = Number(line);
  const first = Number(firstBodyLine) || 1;
  if (!Number.isInteger(n) || n < first) return null;
  const at = n - first + 1;
  const count = String(body).split("\n").length;
  return at <= count ? at : null;
}

/**
 * One engine accessibility finding in her words: `{ list, id, words, fix, field?, line? }` where
 * `list` is "suggestion", "worth" (never counted) or "details" (only for the person who set up the
 * site). `context` gives `{ coverAlt, lineText, line }`.
 */
export function a11yWords(code, finding = {}, context = {}) {
  const field = finding?.source?.field || "";
  const outcome = finding?.outcome || "";
  const place = { field: field || undefined, line: context.line ?? undefined };
  if (field === "coverAlt" && code === "image-alt-review") return { list: "suggestion", id: "cover-description", words: say("ready.coverDescription"), fix: "describe-cover", ...place };
  if (field === "coverAlt" && code === "image-alt-placeholder") return { list: "suggestion", id: "cover-file-name", words: say("ready.coverFileName", { name: context.coverAlt || "" }), fix: "describe-cover", ...place };
  if (code === "image-alt-placeholder") return { list: "suggestion", id: "photo-file-name", words: say("ready.photoFileName", { name: altIn(context.lineText) }), fix: "show", same: "picture-file-name", ...place };
  if (SAME_AS_R6[code] === "html" || code === "document-language-missing" || finding?.scope === "site") return { list: "details", id: code, words: String(finding?.message || ""), fix: null, ...place };
  if (SAME_AS_R6[code]) return { list: "suggestion", id: code, words: say("ready.hardToUse"), fix: "show", same: SAME_AS_R6[code], ...place };
  if (code === "table-structure-review") return { list: "worth", id: code, words: say("ready.table"), fix: "show", ...place };
  if (code === "media-alternatives-review") return { list: "worth", id: code, words: say("ready.media"), fix: "show", ...place };
  if (code === "embed-accessibility-review") return { list: "worth", id: code, words: say("ready.otherSite"), fix: "show", ...place };
  return { list: outcome === "needs-review" ? "worth" : "suggestion", id: code || "unclassified", words: say("ready.hardToUse"), fix: "show", ...place };
}

/**
 * The engine's findings for this post, worded and placed: `{ suggestions, worth, details }`.
 * `body` is her words; `firstBodyLine` from the server; `coverAlt` the cover's description.
 */
export function a11yItems(findings, { body = "", firstBodyLine = 1, coverAlt = "" } = {}) {
  const lines = String(body).split("\n");
  const out = { suggestions: [], worth: [], details: [] };
  for (const finding of Array.isArray(findings) ? findings : []) {
    if (!finding || typeof finding !== "object") continue;
    const line = finding.source?.field ? null : bodyPlace(finding.source?.line, firstBodyLine, body);
    const item = { ...a11yWords(String(finding.code || ""), finding, { coverAlt, lineText: line ? lines[line - 1] : "", line }), finding };
    if (item.line === undefined || item.line === null) delete item.line;
    if (item.list === "suggestion") out.suggestions.push(item);
    else if (item.list === "worth") out.worth.push(item);
    else out.details.push(item);
  }
  return out;
}

/**
 * One list, in post order: R6's suggestions first by place, then the engine's; an engine finding
 * that repeats an R6 suggestion at the same line (or, without a line, any of that kind) is dropped,
 * and so is a recipe's no-author or no-image the search hints or the card already say.
 * `local` items are `{ rule, line? }`; `server` items `{ id, same?, line? }`.
 */
export function mergeSuggestions(local, server, { has = {} } = {}) {
  const kept = (Array.isArray(server) ? server : []).filter((item) => {
    if (item.same) {
      const twins = local.filter((l) => l.rule === item.same);
      if (twins.some((l) => l.line && item.line && l.line === item.line)) return false;
      if (twins.length && (!item.line || twins.every((l) => !l.line))) return false;
    }
    if (item.id === "recipe:no-author" && has.noName) return false;
    if (item.id === "recipe:no-image" && has.noPicture) return false;
    return true;
  });
  const order = (item) => item.line ?? (item.field ? -1 : Number.MAX_SAFE_INTEGER);
  return [...local.map((item) => ({ ...item, from: "local" })), ...kept.map((item) => ({ ...item, from: "server" }))]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => order(a.item) - order(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

const outside = (body) => String(body).replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");

/**
 * Search and sharing: her suggestions (`her`: title-long, no-tags, no-name) and the hints for the
 * person who set up the site (`hints`, never counted). Lifted from `analyzeReadiness` without the
 * score; short titles and a readable address are not problems, and the canonical is R5's.
 */
export function searchHints({ kind = "posts", title = "", subtitle = "", description = "", tags = [], body = "", credited = false } = {}, meta = {}) {
  const her = [];
  const hints = [];
  const titleLength = chars(String(title).trim());
  if (titleLength > LONG_TITLE) her.push({ id: "title-long", words: say("ready.titleLong", { count: String(titleLength) }), fix: "title", field: "title" });
  if (kind === "posts" && !tags.some((tag) => String(tag).trim())) her.push({ id: "no-tags", words: say("ready.noTags"), fix: "tags", field: "tags" });
  if (kind === "posts" && !meta.authorReady && !credited) her.push({ id: "no-name", words: say("ready.noName"), fix: null });
  const text = outside(body).replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  const summary = chars(String(description).trim());
  if (summary && summary < 50) hints.push({ id: "summary-short", words: say("ready.hintSummary", { count: String(summary) }) });
  if (chars(subtitle) > 160) hints.push({ id: "subtitle-long", words: say("ready.hintSubtitle", { count: String(chars(subtitle)) }) });
  const opening = text.split(/\n\s*\n/).map((part) => part.trim()).find((part) => part && !/^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|!\[)/.test(part));
  const openingLength = chars((opening || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_~`]/g, ""));
  if (!openingLength) hints.push({ id: "direct-opening", words: say("ready.hintNoOpening") });
  else if (openingLength < 40 || openingLength > 350) hints.push({ id: "direct-opening", words: say("ready.hintOpening", { count: String(openingLength) }) });
  if (!/^#{2,3}\s+\S/m.test(text)) hints.push({ id: "sections", words: say("ready.hintSections") });
  const wordCount = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  if (wordCount < 150) hints.push({ id: "depth", words: say("ready.hintDepth", { count: String(wordCount) }) });
  if (!/\[[^\]]+\]\(https?:\/\//i.test(text) && !/^\[\^[^\]]+\]:\s*https?:\/\//im.test(text)) hints.push({ id: "external-source", words: say("ready.hintSource") });
  return { her, hints };
}

/** The card's notes (never counted as suggestions): `[{ id, words, button, target }]`. */
export function cardNotes(social, { description = "", cover = "" } = {}) {
  const notes = [];
  const summary = String(description || "").trim();
  if (!summary) notes.push({ id: "no-summary", words: say("ready.cardNoSummary"), button: say("ready.writeSummary"), target: "summary" });
  else if (chars(summary) > LONG_SUMMARY) notes.push({ id: "long-summary", words: say("ready.cardLongSummary", { count: String(chars(summary)) }), button: say("ready.changeSummary"), target: "summary" });
  if (!String(social?.image || cover || "").trim()) notes.push({ id: "no-picture", words: say("ready.cardNoPicture"), button: say("ready.addCover"), target: "cover" });
  return notes;
}

/**
 * Where the card's picture is loaded from: the site-relative path when the address is the blog's
 * own, an https address as it is, and nothing else (no http, no data, no other scheme).
 */
export function cardImageSrc(image, siteUrl = "") {
  const value = String(image || "").trim();
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  let url;
  try { url = new URL(value); } catch { return ""; }
  try {
    const site = siteUrl ? new URL(siteUrl) : null;
    if (site && url.origin === site.origin) {
      const base = site.pathname.replace(/\/$/, "");
      const path = base && url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length) : url.pathname;
      return `${path}${url.search}`;
    }
  } catch { /* no site address */ }
  return url.protocol === "https:" ? url.href : "";
}

/** The card's address as people read it: host and path, no scheme. */
export function cardAddress(url) {
  try {
    const parsed = new URL(String(url));
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, "/");
  } catch {
    return String(url || "");
  }
}

/**
 * Everything the checks found, and what to say: `{ state, words, blocks, suggestions, worth }`.
 * `local` R6/search/trip/video suggestions, `server` the engine's (already merged), `job` the job
 * check's problems, `research` the review (or null), `failure` "offline" | "server" | "too-long" |
 * "build" | "research" | "", `checking` while the server hasn't answered.
 */
export function readyState({ suggestions = [], worth = [], blocks = [], failure = "", checking = false, research = null, researchPending = false, device = "phone" } = {}) {
  const researchBlocks = research ? (research.groups || []).find((g) => g.name === "blocking")?.findings?.length || 0 : 0;
  const blockCount = blocks.length + researchBlocks;
  const n = suggestions.length;
  let state = "nothing";
  let words;
  if (blockCount) {
    state = "blocked";
    words = [blockCount === 1 ? say("ready.oneBlock") : say("ready.blocks", { count: String(blockCount) }), n ? (n === 1 ? say("ready.alsoOne") : say("ready.also", { count: String(n) })) : ""].filter(Boolean).join(" ");
  } else if (failure === "research") {
    state = "blocked";
    words = say("review.didntRun");
  } else if (checking) {
    state = "checking";
    words = say("ready.checking");
  } else if (failure === "offline") {
    state = "offline";
    words = say("ready.noSignal", { phone: device });
  } else if (failure === "too-long") {
    state = "partial";
    words = say("ready.tooLong");
  } else if (failure === "server") {
    state = "partial";
    words = say("ready.someDidntRun");
  } else if (n) {
    state = "suggestions";
    words = n === 1 ? say("ready.oneSuggestion") : say("ready.suggestions", { count: String(n) });
  } else {
    words = say("ready.nothing");
  }
  // A research post waits for its research checks (ADR 0123): Publish is held while they run.
  const waiting = Boolean(researchPending) && !research && !blockCount && failure !== "research";
  return { state, words, blocks: blockCount, suggestions: n, worth: worth.length, blocked: blockCount > 0 || failure === "research" || waiting, waiting };
}

/**
 * The side card's line: `{ checked, changed, blocks, suggestions, local }` where `local` is how
 * many suggestions R6 shows before any check.
 */
export function readyLine({ checked = false, changed = false, blocks = 0, suggestions = 0, local = 0 } = {}) {
  if (!checked) {
    if (!local) return say("ready.lineNotChecked");
    return local === 1 ? say("ready.lineSoFarOne") : say("ready.lineSoFar", { count: String(local) });
  }
  if (changed) return say("ready.lineChanged");
  if (blocks) return blocks === 1 ? say("ready.lineBlockOne") : say("ready.lineBlocks", { count: String(blocks) });
  if (suggestions) return suggestions === 1 ? say("ready.lineOne") : say("ready.lineMany", { count: String(suggestions) });
  return say("ready.lineNothing");
}

/**
 * Whether Publish opens the sheet by itself. Only when the post goes up for the first time
 * (`state` "new" or "draft" and the intent publishes), with something to show: a blocker, a
 * suggestion, the exact route, a server that couldn't check, or a research post (always). Update
 * opens it only when something blocks. Never with no signal, never for Worth a look alone, and
 * never from inside the sheet.
 */
export function shouldOpenOnPublish({ state = "draft", intent = "publish", result = {}, research = false, fromSheet = false } = {}) {
  if (fromSheet || intent !== "publish") return false;
  if (result.failure === "offline") return false;
  if (result.blocks > 0 || result.blocked) return true;
  const first = state === "new" || state === "draft";
  if (!first) return false;
  if (research) return true;
  return result.suggestions > 0 || Boolean(result.exactRoute) || result.failure === "server" || result.failure === "too-long";
}

/**
 * What a failed check means: "offline" (no signal), "build" (the build refuses it, G46), "too-long",
 * "signed-out", "not-found" or "server". Until every answer had its code, today's strings say it.
 */
export function readyProblem(error) {
  if (!error) return "";
  const status = Number(error.status);
  const code = error.data?.code || "";
  if (status === 0 || error.name === "TypeError") return "offline";
  if (status === 401) return "signed-out";
  if (status === 413 || code === "too-large") return "too-long";
  // Another post the build can't make doesn't hold this one back: the checks just didn't run.
  if (code === "site-build") return "server";
  if (code === "build" || (status === 422 && !code)) return "build";
  if (code === "not-found") return "not-found";
  if (status === 422) return "build";
  return "server";
}

/** The problems a build refusal names, for the details (G46 `problems`, else the sentence). */
export function buildProblems(error) {
  const problems = Array.isArray(error?.data?.problems) ? error.data.problems : [];
  const sentences = problems.map((p) => (typeof p === "string" ? p : String(p?.message || ""))).filter(Boolean);
  return sentences.length ? sentences : [String(error?.data?.error || error?.message || "")].filter(Boolean);
}

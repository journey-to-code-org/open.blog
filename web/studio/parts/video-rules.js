// Words for YouTube (Studio R7): the title, description, tags and chapters a video post gives
// YouTube, checked against YouTube's rules. Pure. These mirror the engine (`openblog video`,
// crates/openblog-core/src/video_release.rs: `chapters`, `chapter_problems`, `compose_description`,
// `youtube_tags_chars`) so the sheet works with no signal; with one, the server's own preview
// (`POST video/release`, G50) is used, and a test holds the two together on every video post.
import { say } from "./words.js";

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const TAGS_MAX = 500;
export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_SECONDS = 10;
/** The problem codes the page can check itself (the others need the server's files). */
export const METADATA_CODES = Object.freeze(["title-missing", "title-too-long", "title-angle-brackets", "description-too-long", "description-angle-brackets", "tags-too-long", "chapters-first-not-zero", "chapters-too-few", "chapters-out-of-order", "chapters-duration-missing", "chapters-too-short"]);

const chars = (text) => [...String(text)].length;
const bytes = (text) => new TextEncoder().encode(String(text)).length;

/** Seconds of a chapter time: `M:SS`, `MM:SS`, `MMM:SS` or `H:MM:SS` (the engine's `timestamp_seconds`). */
export function timestampSeconds(stamp) {
  const parts = String(stamp).split(":");
  const number = (part, max) => (part.length && part.length <= max && /^\d+$/.test(part) ? Number(part) : null);
  if (parts.length === 2 && parts[1].length === 2) {
    const [m, s] = [number(parts[0], 3), number(parts[1], 2)];
    return m !== null && s !== null && s < 60 ? m * 60 + s : null;
  }
  if (parts.length === 3 && parts[1].length === 2 && parts[2].length === 2) {
    const [h, m, s] = [number(parts[0], 2), number(parts[1], 2), number(parts[2], 2)];
    return h !== null && m !== null && s !== null && m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
  }
  return null;
}

/** Each line with whether it is inside fenced code (the engine's `outside_fences_keeping`). */
function linesWithFences(markdown) {
  let fence = null;
  return String(markdown).split("\n").map((raw, index) => {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trimStart();
    const marker = trimmed[0] === "`" || trimmed[0] === "~" ? trimmed[0] : null;
    const run = marker ? trimmed.length - trimmed.replace(new RegExp(`^\\${marker}+`), "").length : 0;
    if (fence && marker === fence.marker && run >= fence.run) { fence = null; return { line, index, code: true }; }
    if (fence) return { line, index, code: true };
    if (marker && run >= 3) { fence = { marker, run }; return { line, index, code: true }; }
    return { line, index, code: false };
  });
}

/** The chapter lines of the words, in order: `[{ timestamp, seconds, label, line }]` (line from 0). */
export function videoChapters(body) {
  return linesWithFences(body).flatMap(({ line, index, code }) => {
    if (code) return [];
    let text = line.trim();
    for (const marker of ["- ", "* ", "+ "]) if (text.startsWith(marker)) { text = text.slice(marker.length).trimStart(); break; }
    const split = /\s/.exec(text);
    if (!split) return [];
    const timestamp = text.slice(0, split.index);
    const label = text.slice(split.index).trim();
    const seconds = timestampSeconds(timestamp);
    return seconds !== null && label ? [{ timestamp, seconds, label, line: index }] : [];
  });
}

/** Seconds in a written duration: "12:34", "1:02:03", "PT12M", "2 hr 15 min" (the engine's parser). */
export function durationSeconds(input) {
  const text = String(input ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes(":")) {
    const values = text.split(":").map((part) => (/^\s*\d+\s*$/.test(part) ? Number(part) : NaN));
    if (values.some((value) => !Number.isFinite(value))) return null;
    if (values.length === 2 && values[1] < 60) return values[0] * 60 + values[1];
    if (values.length === 3 && values[1] < 60 && values[2] < 60) return values[0] * 3600 + values[1] * 60 + values[2];
    return null;
  }
  let rest = text.startsWith("pt") ? text.slice(2) : text;
  let total = 0;
  let found = false;
  const units = { h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, s: 1, sec: 1, secs: 1, second: 1, seconds: 1 };
  while (rest.trimStart()) {
    rest = rest.trimStart();
    const match = /^(\d+)\s*([a-z]*)/.exec(rest);
    if (!match || !(match[2] in units)) return null;
    total += Number(match[1]) * units[match[2]];
    found = true;
    rest = rest.slice(match[0].length);
  }
  return found ? total : null;
}

/** YouTube's chapter rules; no chapters at all is fine. `[{ code, line? }]` */
export function chapterProblems(chapters, duration) {
  const out = [];
  if (!chapters.length) return out;
  if (chapters[0].seconds !== 0) out.push({ code: "chapters-first-not-zero", line: chapters[0].line });
  if (chapters.length < CHAPTER_MIN_COUNT) out.push({ code: "chapters-too-few", line: chapters[0].line });
  const backwards = chapters.findIndex((chapter, index) => index > 0 && chapter.seconds <= chapters[index - 1].seconds);
  if (backwards >= 0) out.push({ code: "chapters-out-of-order", line: chapters[backwards].line });
  if (duration === null || duration === undefined) out.push({ code: "chapters-duration-missing", field: "duration" });
  else if (backwards < 0) {
    const short = chapters.findIndex((chapter, index) => index > 0 && chapter.seconds - chapters[index - 1].seconds < CHAPTER_MIN_SECONDS);
    const last = chapters.at(-1).seconds;
    if (short >= 0) out.push({ code: "chapters-too-short", line: chapters[short - 1].line });
    else if (duration < last + CHAPTER_MIN_SECONDS) out.push({ code: "chapters-too-short", line: chapters.at(-1).line });
  }
  return out;
}

/** The description YouTube gets: opening, article address, chapters, AI note (the engine's `compose_description`). */
export function videoDescription({ summary = "", url = "", chapters = [], ai = "" }) {
  const sections = [];
  const opening = String(summary).trim();
  if (opening) sections.push(opening);
  if (url) sections.push(`Read the article: ${url}`);
  if (chapters.length) sections.push(`Chapters\n${chapters.map((c) => `${c.timestamp} ${c.label}`).join("\n")}`);
  const note = String(ai).trim();
  if (note) sections.push(`AI assistance: ${note}`);
  return sections.join("\n\n");
}

/** The length YouTube counts for tags: quotes around a tag with a space, commas between. */
export function youtubeTagsChars(tags) {
  return tags.reduce((sum, tag) => sum + chars(tag) + (String(tag).includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

const value = (fields, key) => String(fields?.[key] ?? "").trim();

/**
 * The words for YouTube from the post as it stands: `{ title, description, tags, chapters,
 * problems: [{ code, ...place }], notes }`. `url` is the post's full address ("" before its first
 * save leaves the article line out), `tags` its tag names, `live` whether it's on the site now, and
 * `excerpt` the first lines the blog uses when the post has no summary.
 */
export function releaseKit(fields, body, { url = "", tags = [], live = false, excerpt = "" } = {}) {
  const title = value(fields, "videoTitle") || value(fields, "title");
  const summary = ["description", "summary", "brief", "excerpt"].map((key) => value(fields, key)).find(Boolean) || "";
  const opening = value(fields, "videoDescription") || summary || String(excerpt).trim();
  const chapters = videoChapters(body);
  const description = videoDescription({ summary: opening, url, chapters, ai: value(fields, "aiDisclosure") });
  const problems = [];
  if (!title) problems.push({ code: "title-missing", field: "title" });
  else if (chars(title) > TITLE_MAX) problems.push({ code: "title-too-long", field: value(fields, "videoTitle") ? "videoTitle" : "title", count: chars(title) });
  if (/[<>]/.test(title)) problems.push({ code: "title-angle-brackets", field: value(fields, "videoTitle") ? "videoTitle" : "title" });
  if (bytes(description) > DESCRIPTION_MAX_BYTES) problems.push({ code: "description-too-long", field: value(fields, "videoDescription") ? "videoDescription" : "description" });
  if (/[<>]/.test(description)) problems.push({ code: "description-angle-brackets", ...bracketPlace(fields, chapters) });
  const tagChars = youtubeTagsChars(tags);
  if (tagChars > TAGS_MAX) problems.push({ code: "tags-too-long", field: "tags", count: tagChars });
  problems.push(...chapterProblems(chapters, durationSeconds(value(fields, "duration"))));
  return { title, description, tags: [...tags], chapters, problems, notes: live ? [] : [{ code: "article-not-public" }], hasAddress: Boolean(url) };
}

function bracketPlace(fields, chapters) {
  for (const key of ["videoDescription", "description"]) if (/[<>]/.test(value(fields, key))) return { field: key };
  const chapter = chapters.find((c) => /[<>]/.test(c.label));
  if (chapter) return { line: chapter.line };
  return /[<>]/.test(value(fields, "aiDisclosure")) ? { field: "aiDisclosure" } : {};
}

/** One problem in her words. */
export function releaseWords(code, detail = {}) {
  switch (code) {
    case "title-missing": return say("youtube.titleMissing");
    case "title-too-long": return say("youtube.titleTooLong", { count: String(detail.count ?? "") });
    case "title-angle-brackets": return say("youtube.titleBrackets");
    case "description-too-long": return say("youtube.descriptionTooLong");
    case "description-angle-brackets": return say("youtube.descriptionBrackets");
    case "tags-too-long": return say("youtube.tagsTooLong", { count: String(detail.count ?? "") });
    case "chapters-first-not-zero": return say("youtube.firstNotZero");
    case "chapters-too-few": return say("youtube.tooFew");
    case "chapters-out-of-order": return say("youtube.outOfOrder");
    case "chapters-duration-missing": return say("youtube.durationMissing");
    case "chapters-too-short": return say("youtube.tooShort");
    case "article-not-public": return say("youtube.keepPrivate");
    default: return say("youtube.other");
  }
}

/**
 * The server's preview (G50) in the kit's shape, keeping only the problems she can fix here; the
 * rest (files, consent) are in details. Places come from the local kit, matched by code.
 */
export function kitFromServer(preview, local) {
  const placeOf = (code) => local.problems.find((p) => p.code === code) || {};
  const problems = (preview.problems || []).filter((p) => METADATA_CODES.includes(p.code)).map((p) => ({ ...placeOf(p.code), code: p.code, message: p.message }));
  const other = [...(preview.problems || []).filter((p) => !METADATA_CODES.includes(p.code)), ...(preview.manual || []), ...(preview.notes || []).filter((n) => n.code !== "article-not-public")];
  return {
    title: preview.title, description: preview.description, tags: preview.tags || [], chapters: local.chapters,
    // The post as it is now decides the note (the server is asked about the post as it would be
    // published); an address that isn't public keeps it too.
    problems, notes: local.notes.length || !preview.articlePublic ? [{ code: "article-not-public" }] : [], hasAddress: true,
    other, status: preview.status, digest: preview.digest, steps: preview.steps || [], slug: preview.slug,
  };
}

/** The one line in Before you publish: ready, or how many things YouTube won't take. */
export function releaseRow(kit) {
  const n = kit.problems.length;
  if (n === 1) return say("youtube.rowProblem");
  if (n) return say("youtube.rowProblems", { count: String(n) });
  return say("youtube.rowReady", { chapters: chapterCountWords(kit.chapters.length) });
}

/** "5 chapters", "1 chapter", "no chapters". */
export function chapterCountWords(count) {
  return count === 1 ? "1 chapter" : count ? `${count} chapters` : "no chapters";
}

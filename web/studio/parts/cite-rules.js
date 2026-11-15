// Citations in her words (Studio R11): where `[@key, page 514]` markers are, whether one can go at
// the caret, reading and writing one, and what a chip under the words says. Pure, DOM-free.
// Lifted from the old Admin (the old Admin's admin.js "citations", removed in R15). The core scanner
// (`openblog_core::citations`) is authoritative: this only finds the text Studio shows as a chip,
// and every citation that goes in comes back checked from `citations/check`. A citation stays in
// her words exactly as she or Studio typed it; nothing here reflows or rewrites one.
import { say } from "./words.js";
import { filterSources, sourceLabel } from "./source-rules.js";
import { parseLocatorLines, rowsToLocators } from "./notebook-rules.js";

export const MAX_CITATION_LOCATORS = 8;
// `[@...]` on one line, not escaped, and not a link (`[@x](url)`, `[@x][ref]`).
const CITATION_TEXT = /(?<!\\)\[@[^[\]\n]*\](?![([])/g;
export const CITATION_WHOLE = /^\[@[^[\]\n]*\]$/;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KNOWN_KINDS = new Set(["page", "folio", "line", "section", "chapter", "canonical", "timestamp"]);

function codeSpanRanges(line) {
  const runs = [...line.matchAll(/`+/g)].map((match) => [match.index, match[0].length]);
  const ranges = [];
  for (let index = 0; index < runs.length; index += 1) {
    const [start, length] = runs[index];
    const close = runs.findIndex(([, other], at) => at > index && other === length);
    if (close < 0) continue;
    ranges.push([start, runs[close][0] + length]);
    index = close;
  }
  return ranges;
}

/** Citations written in her words, outside fenced code and code spans, with their offsets. */
export function citationSpans(markdown) {
  const spans = [];
  let offset = 0;
  let fence = null;
  for (const line of String(markdown ?? "").split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
    } else if (marker) fence = marker[1];
    else {
      const code = codeSpanRanges(line);
      for (const match of line.matchAll(CITATION_TEXT)) {
        const start = match.index;
        const end = start + match[0].length;
        if (code.some(([from, to]) => start < to && end > from)) continue;
        if (/^ {0,3}$/.test(line.slice(0, start)) && line[end] === ":") continue; // a reference definition
        spans.push({ start: offset + start, end: offset + end, text: match[0] });
      }
    }
    offset += line.length + 1;
  }
  return spans;
}

/** The citation the selection is inside (or exactly covers), so Cite changes it instead of adding another. */
export function citationAt(markdown, start, end = start) {
  return citationSpans(markdown).find((span) => (start > span.start && end < span.end) || (start === span.start && end === span.end)) || null;
}

function backslashesBefore(line, at) {
  let count = 0;
  while (at - count > 0 && line[at - count - 1] === "\\") count += 1;
  return count;
}

/** Link and image spans on one line (`[text](dest)`, `![alt](src)`, `[text][ref]`), with nested brackets. */
export function markdownLinkRanges(line) {
  const ranges = [];
  const escaped = (at) => backslashesBefore(line, at) % 2 === 1;
  const matching = (from, open, close) => {
    let depth = 0;
    for (let index = from; index < line.length; index += 1) {
      if (line[index] === "\\") index += 1;
      else if (line[index] === open) depth += 1;
      else if (line[index] === close && --depth === 0) return index;
    }
    return -1;
  };
  for (let open = line.indexOf("["); open >= 0; open = line.indexOf("[", open + 1)) {
    if (escaped(open)) continue;
    const close = matching(open, "[", "]");
    if (close < 0) continue;
    const end = line[close + 1] === "(" ? matching(close + 1, "(", ")") : line[close + 1] === "[" ? matching(close + 1, "[", "]") : -1;
    if (end >= 0) ranges.push([open > 0 && line[open - 1] === "!" ? open - 1 : open, end + 1]);
  }
  return ranges;
}

const HTML_BLOCK_TAGS = new Set("address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul".split(" "));
const HTML_ATTRIBUTES = String.raw`(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?)*`;
const HTML_OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9-]*${HTML_ATTRIBUTES}\s*\/?>`;
const HTML_CLOSE_TAG = String.raw`<\/[A-Za-z][A-Za-z0-9-]*\s*>`;
const HTML_TAG_LINE = new RegExp(String.raw`^(?:${HTML_OPEN_TAG}|${HTML_CLOSE_TAG})\s*$`);
const INLINE_HTML = new RegExp(String.raw`<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>|${HTML_OPEN_TAG}|${HTML_CLOSE_TAG}`, "g");
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/g;

/** A line without its block quote and list markers, so fences and HTML inside containers are seen too. */
function containerContent(line) {
  return line.replace(/^(?: {0,3}>[ \t]?| {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))*/, "");
}

function indentWidth(line) {
  let width = 0;
  for (const character of line) {
    if (character === " ") width += 1;
    else if (character === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

function htmlBlockEnd(content, afterBlank) {
  const rest = /^ {0,3}(<.*)$/.exec(content)?.[1];
  if (!rest) return null;
  const raw = /^<(script|pre|style|textarea)(?:\s|>|$)/i.exec(rest);
  if (raw) return (line) => new RegExp(`</${raw[1]}>`, "i").test(line);
  if (rest.startsWith("<!--")) return (line) => line.includes("-->");
  if (rest.startsWith("<?")) return (line) => line.includes("?>");
  if (rest.startsWith("<![CDATA[")) return (line) => line.includes("]]>");
  if (/^<![A-Za-z]/.test(rest)) return (line) => line.includes(">");
  const tag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s|\/?>|$)/.exec(rest);
  if (tag && HTML_BLOCK_TAGS.has(tag[1].toLowerCase())) return "blank";
  if (afterBlank && HTML_TAG_LINE.test(rest)) return "blank";
  return null;
}

/** Each line as `"code"`, `"html"`, `"blank"` or paragraph `"text"`. */
export function markdownLineKinds(lines) {
  const kinds = [];
  let fence = null;
  let html = null;
  for (const [index, line] of lines.entries()) {
    const content = containerContent(line);
    const blank = !content.trim();
    const previous = kinds[index - 1];
    const afterBlank = previous !== "text";
    if (fence) {
      const marker = /^\s*(`{3,}|~{3,})\s*$/.exec(content);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      kinds.push("code");
    } else if (html) {
      const closes = html === "blank" ? blank : html(line);
      kinds.push(closes && html === "blank" ? "blank" : "html");
      if (closes) html = null;
    } else if (blank) {
      kinds.push("blank");
    } else {
      const marker = /^\s*(`{3,}|~{3,})/.exec(content);
      const end = htmlBlockEnd(content, afterBlank);
      if (marker && !(marker[1][0] === "`" && content.slice(marker[0].length).includes("`"))) {
        fence = marker[1];
        kinds.push("code");
      } else if (afterBlank && indentWidth(line.replace(/^(?: {0,3}>[ \t]?)*/, "")) >= 4) {
        kinds.push("code");
      } else if (end) {
        kinds.push("html");
        if (end === "blank" || !end(line)) html = end;
      } else kinds.push("text");
    }
  }
  return kinds;
}

/**
 * Why a new citation can't go at `at`, where it wouldn't be read as one: `"code"`, `"html"` or
 * `"link"`; otherwise `""`. It errs towards refusing, and the server checks whatever goes in.
 */
export function citationInsertionProblem(markdown, at) {
  const lines = String(markdown ?? "").split("\n");
  const kinds = markdownLineKinds(lines);
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const lineEnd = offset + line.length;
    if (at < offset || at > lineEnd) {
      offset = lineEnd + 1;
      continue;
    }
    const kind = kinds[index];
    if (kind === "code" || kind === "html") return kind;
    if (kind !== "text") return "";
    let first = index;
    while (first > 0 && kinds[first - 1] === "text") first -= 1;
    let last = index;
    while (last + 1 < lines.length && kinds[last + 1] === "text") last += 1;
    const start = lines.slice(0, first).reduce((sum, text) => sum + text.length + 1, 0);
    const paragraph = lines.slice(first, last + 1).join("\n");
    const column = at - start;
    const inside = (ranges) => ranges.some(([from, to]) => column > from && column < to);
    const matches = (pattern) => [...paragraph.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length]);
    if (inside(codeSpanRanges(paragraph))) return "code";
    if (inside(matches(INLINE_HTML))) return "html";
    if (inside(matches(AUTOLINK)) || inside(markdownLinkRanges(paragraph))) return "link";
    if (index === first && /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/.test(containerContent(line))) return "link";
    return "";
  }
  return "";
}

/** Read `[@key, kind value to end; ...]` into parts. The server checks whatever goes in. */
export function parseCitationText(text) {
  const match = /^\[@([^[\]\n]*)\]$/.exec(String(text ?? ""));
  if (!match) return null;
  const inner = match[1];
  const comma = inner.indexOf(",");
  const key = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  const locators = comma < 0
    ? []
    : inner.slice(comma + 1).split(";").map((part) => {
        const trimmed = part.trim();
        const space = trimmed.search(/\s/);
        const kind = space < 0 ? trimmed : trimmed.slice(0, space);
        const rest = space < 0 ? "" : trimmed.slice(space).trim();
        const range = rest.indexOf(" to ");
        return range < 0 ? { kind, value: rest } : { kind, value: rest.slice(0, range).trim(), to: rest.slice(range + 4).trim() };
      });
  return { key, locators };
}

/** Whether parsed parts are a citation the build reads: a key, and each place whole. */
export function citationReadable(parsed) {
  if (!parsed || !KEY.test(parsed.key) || parsed.key.length > 64) return false;
  if (parsed.locators.length > MAX_CITATION_LOCATORS) return false;
  return parsed.locators.every((locator) => locator.value && (KNOWN_KINDS.has(locator.kind) || /^x-[a-z0-9-]+$/.test(locator.kind)));
}

/** The text a citation is written as; a preview only, since the server returns what goes in. */
export function formatCitationText({ key = "", locators = [] } = {}) {
  return `[@${key}${(locators || []).map((locator, index) => `${index ? "; " : ", "}${locator.kind} ${locator.value}${locator.to ? ` to ${locator.to}` : ""}`).join("")}]`;
}

/** A passage's places as a citation uses them: kind, value and end only, never other stored fields. */
export function citationLocatorsFromPassage(passage) {
  return (Array.isArray(passage?.locators) ? passage.locators : [])
    .filter((locator) => typeof locator?.kind === "string" && typeof locator?.value === "string")
    .map((locator) => (typeof locator.to === "string" && locator.to ? { kind: locator.kind, value: locator.value, to: locator.to } : { kind: locator.kind, value: locator.value }));
}

/** What `citations/check` is sent: the key and the places from the rows (or the old lines). */
export function citationDraftPayload(draft) {
  const locators = Array.isArray(draft.locators) ? rowsToLocators(draft.locators) : parseLocatorLines(draft.locators);
  return {
    key: String(draft.source || ""),
    locators: locators.map((locator) => (locator.to ? { kind: locator.kind, value: locator.value, to: locator.to } : { kind: locator.kind, value: locator.value })),
  };
}

/** A quick check before sending, as `{ field, id, vars }` or null; the core resolver stays authoritative. */
export function validateCitationDraft(draft, sources = []) {
  if (!draft.source) return { field: "source", id: "cite.needSource" };
  if (!sources.some((source) => source.id === draft.source)) return { field: "source", id: "cite.notInLibrary" };
  const locators = citationDraftPayload(draft).locators;
  if (locators.length > MAX_CITATION_LOCATORS) return { field: "locators", id: "cite.tooManyPlaces" };
  const bad = locators.findIndex((locator) => !locator.kind || !locator.value);
  if (bad >= 0) return { field: "locators", id: "cite.badPlace", vars: { n: bad + 1 }, row: bad };
  return null;
}

/**
 * Put citation text in her words. A `replace` span (one being changed) is replaced; otherwise it
 * goes at the end of the selection, after a space when it would touch a word, and the selected
 * words stay. The caret lands after it. Nothing else moves.
 */
export function insertCitationText(value, start, end, markdown, replace = null) {
  const text = String(value ?? "");
  if (replace) {
    const next = text.slice(0, replace.start) + markdown + text.slice(replace.end);
    const caret = replace.start + markdown.length;
    return { value: next, start: caret, end: caret };
  }
  const at = Math.max(0, Math.min(text.length, Math.max(start, end)));
  const before = text.slice(0, at);
  const inserted = (before && !/[\s([]$/.test(before) ? " " : "") + markdown;
  const caret = at + inserted.length;
  // A `(` or `[` right after the citation would make it read as a link.
  const after = /^[([]/.test(text.slice(at)) ? " " : "";
  return { value: before + inserted + after + text.slice(at), start: caret, end: caret };
}

/** Sources Cite offers for a search: live ones, plus the one already chosen even if archived. */
export function citationSourceChoices(sources, query = "", keep = "") {
  return filterSources(sources, { query, archived: "all" })
    .filter((source) => !source.archived || source.id === keep)
    .sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)));
}

/** What a failed `citations/check` means, as `{ field, id }` (the server's sentence goes in details). */
export function citationProblem(error) {
  const status = Number(error?.status) || 0;
  const diagnostics = Array.isArray(error?.data?.diagnostics) ? error.data.diagnostics : [];
  const codes = diagnostics.map((item) => item.code);
  if (status === 0) return { field: "", id: "cite.waiting" };
  if (status === 409) return { field: "source", id: "cite.libraryChanged" };
  if (codes.includes("unknown-key") || codes.includes("invalid-key")) return { field: "source", id: "cite.notInLibrary" };
  if (codes.includes("too-many-locators")) return { field: "locators", id: "cite.tooManyPlaces" };
  if (codes.some((code) => ["invalid-locator", "ambiguous-locator", "unknown-locator-kind"].includes(code))) return { field: "locators", id: "cite.badPlace", vars: { n: 1 } };
  if (codes.includes("malformed-citation")) return { field: "source", id: "cite.malformedNow" };
  if (status === 413 || codes.includes("too-large") || codes.includes("too-many-citations")) return { field: "", id: "cite.tooMany" };
  return { field: "", id: "research.failed" };
}
/** The old name. */
export const citationFailure = citationProblem;

// ---- chips

const SHORT = { page: ["p.", "pp."], folio: ["fol.", "fols."], line: ["l.", "ll."], section: ["§", "§§"], chapter: ["ch.", "chs."] };

/** Places as readers see them in English, as the build writes them: "pp. 514–520, 514a". */
export function shortPlaces(locators) {
  return (Array.isArray(locators) ? locators : []).map((locator) => {
    const range = locator.to ? `${locator.value}–${locator.to}` : String(locator.value ?? "");
    if (locator.kind === "canonical") return range;
    if (locator.kind === "timestamp") return `at ${range}`;
    const label = SHORT[locator.kind]?.[locator.to ? 1 : 0] ?? String(locator.kind || "").replace(/^x-csl-/, "").replace(/^x-/, "").replace(/-/g, " ");
    return `${label} ${range}`.trim();
  }).join(", ");
}

/**
 * What a chip says for a citation: the source's name and its places ("Republic, tr. Slings,
 * p. 514"), or the key alone when the library isn't known here.
 */
export function citationLabel(citation, sources = []) {
  const source = (Array.isArray(sources) ? sources : []).find((item) => item.id === citation?.key);
  const name = source ? sourceLabel(source) : String(citation?.key ?? "");
  const places = shortPlaces(citation?.locators);
  return places ? `${name}, ${places}` : name;
}

/**
 * The chips for one box of her words, in reading order: each marker outside code, links and HTML,
 * as `{ start, end, text, citation, readable }`. `citation` is null when it can't be read.
 */
export function citationsIn(text) {
  const value = String(text ?? "");
  return citationSpans(value)
    .filter((span) => !citationInsertionProblem(value, span.start + 1))
    .map((span) => {
      const parsed = parseCitationText(span.text);
      const readable = citationReadable(parsed);
      return { ...span, citation: readable ? parsed : null, readable };
    });
}

/** Take a marker out, with one space beside it (the one before, else the one after). `{ text, at }`. */
export function removeCitation(text, span) {
  const value = String(text ?? "");
  if (value.slice(span.start, span.end) !== span.text) return null;
  let start = span.start;
  let end = span.end;
  if (start > 0 && value[start - 1] === " ") start -= 1;
  else if (value[end] === " ") end += 1;
  return { text: value.slice(0, start) + value.slice(end), at: start };
}

/**
 * What a post's `citations` becomes when a citation goes in: `"notes"` for the first one in a post
 * that hasn't chosen (decision 4), else null (nothing changes).
 */
export function citationStyleField(fields, firstCitation) {
  if (!firstCitation) return null;
  const chosen = String(fields?.citations ?? "").trim();
  return chosen ? null : "notes";
}

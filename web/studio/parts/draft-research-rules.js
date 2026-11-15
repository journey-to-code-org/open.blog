// Your research beside the words (Studio R11): what it lists, and the exact text a quotation or a
// note she turns into her own words becomes. Pure, DOM-free. Lifted from the old Admin
// (web/admin/admin.js "draft-side research panel", ADR 0122; removed in R15): someone else's words
// go in exactly as kept, never trimmed, normalised or dropped, and every character Markdown would
// read as markup is written so it shows as itself.
import { say } from "./words.js";
import { CITATION_WHOLE, insertCitationText } from "./cite-rules.js";
import { markdownLineKinds } from "./cite-rules.js";
import { entryPreview, locatorText, noteKindWords } from "./notebook-rules.js";
import { RIGHTS_NEEDING_CONFIRMATION, rightsOf, rightsText, sourceKindWords, sourceLabel } from "./source-rules.js";

export { RIGHTS_NEEDING_CONFIRMATION, rightsOf, rightsText };

/** Characters a line may not start with, or Markdown reads a block marker, written as references. */
const LINE_START_REFERENCES = Object.freeze({ "#": "&#35;", ">": "&gt;", "-": "&#45;", "+": "&#43;", "=": "&#61;" });
const whitespaceReferences = (space) => [...space].map((character) => (character === "\t" ? "&#9;" : "&#32;")).join("");

/**
 * One line of someone else's words (or of a note she turns into her own) as Markdown that shows
 * exactly that text. `\ * _ ` [ ]` are escaped with a backslash; `&`, `<`, `|` and `~` anywhere, a
 * block marker or a list number at the start, and spaces at either end are written as character
 * references. Nothing is trimmed, normalised or dropped.
 */
export function literalMarkdownLine(line) {
  let text = String(line ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\|/g, "&#124;")
    .replace(/~/g, "&#126;")
    .replace(/[\\*_`[\]]/g, "\\$&");
  text = text.replace(/^[ \t]+/, whitespaceReferences).replace(/[ \t]+$/, whitespaceReferences);
  if (LINE_START_REFERENCES[text[0]]) text = LINE_START_REFERENCES[text[0]] + text.slice(1);
  return text.replace(/^(\d{1,9})([.)])/, (_, digits, mark) => `${digits}${mark === "." ? "&#46;" : "&#41;"}`);
}

/** Lines of text without the blank lines at either end, which a reader never sees. */
function contentLines(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines;
}

/**
 * A passage's words as a block quote ending with its checked citation, or "" when there are no
 * words or the citation isn't one. A blank line inside is a paragraph break within the quote.
 */
export function quotationMarkdown(text, citation) {
  if (!CITATION_WHOLE.test(String(citation ?? ""))) return "";
  const lines = contentLines(text);
  if (!lines.length) return "";
  const body = lines.map((line) => (line.trim() ? literalMarkdownLine(line) : ""));
  body[body.length - 1] += ` ${citation}`;
  return body.map((line) => (line ? `> ${line}` : "> ")).join("\n");
}

/** A note she chose to put in, as paragraphs of her own words: no quotation, no citation, every character as written. */
export function convertedNoteMarkdown(text) {
  const paragraphs = [];
  let current = [];
  for (const line of contentLines(text)) {
    if (line.trim()) current.push(literalMarkdownLine(line));
    else if (current.length) {
      paragraphs.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join("\n"));
  return paragraphs.join("\n\n");
}

/** Root-relative addresses of published atlas entries and aligned passages; nothing else is linked. */
export const CONTEXT_URL = /^\/(?:atlas|comparisons)\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/;

/**
 * Why an atlas entry or a comparison can't be linked yet, as a word id, or "" when the next
 * update publishes it (R12; the old Admin's `contextLinkWarning`). `area` is "atlas" or
 * "comparisons"; `publish` whether the blog publishes that area.
 */
export function contextLinkWarning(item, { area = "atlas", publish = false } = {}) {
  if (item?.url) return "";
  if (!item?.approved) return "yours.notApproved";
  if (!publish) return area === "atlas" ? "yours.siteOff" : "yours.siteOffCompare";
  return "yours.cantPublish";
}

/** A link to a published research page, or "" for any other address. */
export function contextLinkMarkdown(label, url) {
  const text = literalMarkdownLine(String(label ?? "").replace(/\s+/g, " ").trim());
  if (!text || !CONTEXT_URL.test(String(url ?? ""))) return "";
  return `[${text}](${url})`;
}

/**
 * Put a block (a quotation, or her note as paragraphs) after the paragraph the selection ends in,
 * with an empty line either side, so no paragraph is split and the selected words stay. On a blank
 * line it goes there. Inside code or HTML it is refused as `{ problem: "code" | "html" }`.
 */
export function insertMarkdownBlock(value, start, end, block) {
  const text = String(value ?? "");
  const at = Math.max(0, Math.min(text.length, Math.max(start, end)));
  const lines = text.split("\n");
  const kinds = markdownLineKinds(lines);
  let index = 0;
  let offset = 0;
  while (index < lines.length - 1 && at > offset + lines[index].length) {
    offset += lines[index].length + 1;
    index += 1;
  }
  const kind = kinds[index];
  if (kind === "code" || kind === "html") return { problem: kind };
  let position = offset;
  if (kind === "text") {
    let last = index;
    while (last + 1 < lines.length && kinds[last + 1] === "text") {
      offset += lines[last].length + 1;
      last += 1;
    }
    position = offset + lines[last].length;
  }
  const before = text.slice(0, position);
  const after = text.slice(position);
  const lead = !before ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = !after ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const caret = before.length + lead.length + block.length;
  return { value: before + lead + block + trail + after, start: caret, end: caret };
}

/** Put inline text (a link) at the selection's end, spaced like a citation. */
export function insertMarkdownInline(value, start, end, markdown) {
  return insertCitationText(value, start, end, markdown);
}

const fold = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** What Show offers, in order: everything (never her notes), then each kind. */
export const DRAFT_RESEARCH_FILTERS = Object.freeze(["all", "passages", "sources", "context", "interpretations", "notes"]);

/**
 * What Your research lists for a search: passages, sources, interpretations and, only when asked
 * for, her notes. Every item says what it is and whether it is private. Archived sources are left
 * out, as in Cite. Notes never appear under `all`, so private thinking shows only on request.
 * `filter` may also be `context` (R12: atlas entries and aligned passages).
 */
export function draftResearchItems(data, query = "", filter = "all") {
  const list = (value) => (Array.isArray(value) ? value : []);
  const sources = list(data?.library?.sources);
  const sourceName = (id) => {
    const source = sources.find((item) => item.id === id);
    return source ? sourceLabel(source) : String(id ?? "");
  };
  const items = [];
  const want = (kind) => filter === kind || (filter === "all" && kind !== "notes");
  if (want("passages")) {
    for (const passage of list(data?.notebook?.passages)) {
      const where = locatorText(passage.locators);
      items.push({ type: "passage", id: passage.id, title: `${sourceName(passage.source)}${where ? `, ${where}` : ""}`, preview: entryPreview(passage, 80), visibility: "private",
        search: [passage.id, passage.source, sourceName(passage.source), where, passage.excerpt?.text], record: passage });
    }
  }
  if (want("sources")) {
    for (const source of sources.filter((item) => !item.archived)) {
      items.push({ type: "source", id: source.id, title: sourceLabel(source), preview: say("yours.sourceKey", { kind: sourceKindWords(source.kind).name, key: String(source.id) }), visibility: "private",
        search: [source.id, source.title, source.language, ...list(source.creators).map((creator) => creator?.name), ...list(source.identifiers).map((identifier) => identifier?.value)], record: source });
    }
  }
  if (want("context")) {
    for (const entry of list(data?.atlas?.entries)) {
      items.push({ type: "atlas", id: entry.id, title: String(entry.label ?? entry.id), preview: String(entry.id), visibility: entry.url ? "published" : "unpublished", search: [entry.id, entry.label, entry.kind, ...list(entry.aliases)], record: entry });
    }
    for (const comparison of list(data?.comparisons?.items)) {
      items.push({ type: "comparison", id: comparison.id, title: String(comparison.label || comparison.id), preview: String(comparison.id), visibility: comparison.url ? "published" : "unpublished", search: [comparison.id, comparison.label], record: comparison });
    }
  }
  if (want("interpretations")) {
    for (const interpretation of list(data?.library?.interpretations)) {
      const title = interpretation.kind === "rendering" ? say("yours.rendering", { source: sourceName(interpretation.source) }) : say("yours.reading", { source: sourceName(interpretation.source) });
      items.push({ type: "interpretation", id: interpretation.id, title, preview: entryPreview(interpretation, 80), visibility: "private",
        search: [interpretation.id, interpretation.source, sourceName(interpretation.source), interpretation.text], record: interpretation });
    }
  }
  if (want("notes")) {
    for (const note of list(data?.notebook?.notes)) {
      items.push({ type: "note", id: note.id, title: noteKindWords(note), preview: entryPreview(note, 80), visibility: "private", search: [note.id, note.text], record: note });
    }
  }
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (!terms.length) return true;
    const haystack = fold(item.search.filter((part) => typeof part === "string").join("\n"));
    return terms.every((term) => haystack.includes(term));
  });
}

/** Whether quoting a version's words asks first: its rights are unknown or reserved. */
export const rightsAsk = (rights) => RIGHTS_NEEDING_CONFIRMATION.includes(rightsOf(rights)?.status || "unknown");

/** A language tag safe for a `lang` attribute, or "". */
export function languageTag(value) {
  const tag = String(value ?? "").trim();
  return /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : "";
}

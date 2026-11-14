// The Markdown of the things that show as cards in her words (Studio R6): tips and notes, checklists,
// tables, a video or CodePen link alone on a line, and `piece` / `compare` fences. Lifted from the
// old Admin's block-forms.js (ADR 0254) with their rule: a form is offered only when it would write
// the block back exactly as it is, so a card she doesn't change keeps its bytes. Pure, DOM-free.
//
// Studio never builds a `piece` or `compare` fence itself: those come from POST pieces. Tips,
// checklists and tables are written here, and a tip with a heading is written the same way the
// engine writes it (`Piece::to_markdown`), so both agree byte for byte.

const trimEnd = (source) => String(source).replace(/\n+$/, "");

// ----- tips and notes (callouts) ---------------------------------------------------------

export const CALLOUT_KINDS = [
  ["NOTE", "Note"],
  ["TIP", "Tip"],
  ["IMPORTANT", "Important"],
  ["WARNING", "Warning"],
  ["CAUTION", "Caution"],
];

/**
 * `> [!KIND]`, an optional `> **Heading**` with an empty `>` line, then `> text` lines, as
 * `{ kind, title, text }`; `null` when the block is anything else or the form couldn't write it back
 * exactly.
 */
export function parseCallout(source) {
  const lines = trimEnd(source).split("\n");
  const first = /^ {0,3}>\s*\[!([A-Za-z]+)\]\s*$/.exec(lines[0] || "");
  if (!first || !CALLOUT_KINDS.some(([kind]) => kind === first[1].toUpperCase())) return null;
  const body = [];
  for (const line of lines.slice(1)) {
    const match = /^ {0,3}>(?: ?)(.*)$/.exec(line);
    if (!match) return null;
    body.push(match[1]);
  }
  let title = "";
  const heading = /^\*\*([^*\n]+)\*\*$/.exec(body[0] || "");
  if (heading && body.length >= 2 && body[1] === "") {
    title = heading[1];
    body.splice(0, 2);
  }
  const callout = { kind: first[1].toUpperCase(), title, text: body.join("\n") };
  // Offer the form only when it would write exactly what is there now.
  return calloutMarkdown(callout) === trimEnd(source) ? callout : null;
}

/** A tip or note as Markdown (no newline at the end). The heading is `> **…**` then `>`. */
export function calloutMarkdown({ kind, title = "", text }) {
  const head = String(title || "").replace(/\s+/g, " ").trim();
  const body = String(text).replace(/\s+$/, "").split("\n").map((line) => (line ? `> ${line}` : ">"));
  return [`> [!${kind}]`, ...(head ? [`> **${head}**`, ">"] : []), ...body].join("\n");
}

// ----- checklists (task lists) -----------------------------------------------------------

/** `- [ ] item` lines as `[{ checked, text }]`; `null` for nesting, plain items or anything else. */
export function parseTaskList(source) {
  const items = [];
  for (const line of trimEnd(source).split("\n")) {
    const match = /^[-*+] \[([ xX])\] (.*)$/.exec(line);
    if (!match) return null;
    items.push({ checked: match[1] !== " ", text: match[2] });
  }
  // Offer the form only when it would write exactly what is there now.
  return items.length && taskListMarkdown(items) === trimEnd(source) ? items : null;
}

export function taskListMarkdown(items) {
  return items.map(({ checked, text }) => `- [${checked ? "x" : " "}] ${String(text).replace(/\s*\n\s*/g, " ").trim()}`).join("\n");
}

// ----- tables ----------------------------------------------------------------------------

const splitRow = (line) => {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
};

/** A table's rows without checking it can be written back: what a card shows. */
export function tableCells(source) {
  const lines = trimEnd(source).split("\n").filter((line) => line.trim());
  if (lines.length < 2) return null;
  return { header: splitRow(lines[0]), rows: lines.slice(2).map(splitRow) };
}

/** A table as `{ header, align, rows }`; `null` when a row has the wrong number of cells or holds code with a bar. */
export function parseTable(source) {
  const lines = trimEnd(source).split("\n");
  if (lines.length < 2 || !lines[0].includes("|")) return null;
  const header = splitRow(lines[0]);
  const divider = splitRow(lines[1]);
  if (divider.length !== header.length || !divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const rows = [];
  for (const line of lines.slice(2)) {
    if (!line.trim()) return null;
    // A bar inside inline code is a cell break to the parser but looks like text here: leave it be.
    if (/`[^`]*(?<!\\)\|[^`]*`/.test(line)) return null;
    const cells = splitRow(line);
    if (cells.length !== header.length) return null;
    rows.push(cells);
  }
  if (/`[^`]*(?<!\\)\|[^`]*`/.test(lines[0])) return null;
  const align = divider.map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : ""));
  const table = { header, align, rows };
  // Offer the form only when it would write exactly what is there now.
  return tableMarkdown(table) === trimEnd(source) ? table : null;
}

export function tableMarkdown({ header, align, rows }) {
  const cell = (text) => String(text).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
  const line = (cells) => `| ${cells.map(cell).join(" | ")} |`;
  const divider = header.map((_, index) => ({ center: ":---:", right: "---:", left: ":---" })[align[index]] || "---");
  return [line(header), `| ${divider.join(" | ")} |`, ...rows.map(line)].join("\n");
}

// ----- a video or CodePen link alone on a line -------------------------------------------

export const EMBED_PROVIDERS = [
  ["youtube", "YouTube", /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s]*v=[\w-]{11}[^\s]*|youtu\.be\/[\w-]{11}[^\s]*|youtube\.com\/shorts\/[\w-]{11}[^\s]*)$/i, "https://www.youtube.com/watch?v=..."],
  ["codepen", "CodePen", /^https?:\/\/(?:www\.)?codepen\.io\/[\w-]+\/(?:pen|full|details|embed|debug)\/[\w-]+[^\s]*$/i, "https://codepen.io/name/pen/..."],
];

/** A line that is only an address the site shows as a frame, as `{ provider, url }`. */
export function parseEmbed(source) {
  const url = trimEnd(source).trim();
  if (url.includes("\n")) return null;
  const found = EMBED_PROVIDERS.find(([, , pattern]) => pattern.test(url));
  return found ? { provider: found[0], url } : null;
}

export function embedProblem(provider, url) {
  const found = EMBED_PROVIDERS.find(([id]) => id === provider);
  const value = String(url).trim();
  if (!found) return "Choose where the embed comes from.";
  if (!value) return `Enter the ${found[1]} address.`;
  if (!found[2].test(value)) return `That is not a ${found[1]} address the site can embed. It looks like ${found[3]}`;
  return "";
}

// ----- pieces (the ```piece fence) and before and after (```compare) ---------------------

/** Read a `piece` fence, or a `compare` fence, into `{ kind, values }` for the form; the engine validates on save. */
export function parsePieceFence(source, schema = null) {
  const lines = trimEnd(source).split("\n");
  const open = /^ {0,3}(`{3,})(?:piece[ \t]+([a-z]+)|(compare))[ \t]*$/.exec(lines[0] || "");
  if (!open) return null;
  const close = lines[lines.length - 1];
  if (lines.length < 2 || !new RegExp(`^ {0,3}\`{${open[1].length},}[ \\t]*$`).test(close)) return null;
  const values = [];
  for (const line of lines.slice(1, -1)) {
    if (line.startsWith("  ")) {
      if (!values.length) return null;
      values[values.length - 1][1] += `\n${line.slice(2)}`;
    } else if (!line.trim()) {
      if (values.length) values[values.length - 1][1] += "\n";
    } else {
      const match = /^([a-z][a-z-]*): ?(.*)$/.exec(line);
      if (!match) return null;
      values.push([match[1], match[2]]);
    }
  }
  for (const pair of values) pair[1] = pair[1].replace(/\n+$/, "");
  // With the schema known, a field it does not have, or a repeat of a field that is not a list field,
  // is something the form would drop or merge: no form for it.
  if (schema) {
    const top = new Set(schema.fields.map((field) => field.name));
    const listNames = new Set((schema.list?.fields || []).map((field) => field.name));
    const seen = new Set();
    for (const [name] of values) {
      if (!top.has(name) && !listNames.has(name)) return null;
      if (top.has(name) && seen.has(name)) return null;
      seen.add(name);
    }
  }
  return { kind: open[2] || open[3], values };
}

/** Which form edits a block, or "" when none does. `label` is the old Admin's name for it. */
export function editableBlockKind(label, source, pieces = []) {
  if (label === "Callout") return parseCallout(source) ? "callout" : "";
  if (label === "Table") return parseTable(source) ? "table" : "";
  if (label === "Task list") return parseTaskList(source) ? "tasklist" : "";
  if (label === "Embedded media") return parseEmbed(source) ? "embed" : "";
  if (label === "Piece" || label === "Before and after") {
    const parsed = parsePieceFence(source);
    if (!parsed) return "";
    if (!pieces.length) return "piece";
    const schema = pieces.find((piece) => piece.kind === parsed.kind);
    return schema && parsePieceFence(source, schema) ? "piece" : "";
  }
  return "";
}

/** True when text has `<` then a letter, `/`, `!` or `?`: markup a post would render live. */
export function hasHtmlTag(value) {
  return /<[A-Za-z/!?]/.test(String(value));
}

// ----- words that stay words: a quote, a heading, a link at the caret ----------------------

/** A quote: each line of her words after `> `, then `>` and `> — who said it`. */
export function quoteMarkdown({ words, who = "" }) {
  const lines = String(words).replace(/\s+$/, "").split("\n").map((line) => (line.trim() ? `> ${line.trim()}` : ">"));
  const name = String(who || "").replace(/\s+/g, " ").trim();
  return [...lines, ...(name ? [">", `> — ${name}`] : [])].join("\n");
}

/** The paragraph around `at` in `text`: `{ start, end, source }`. */
function paragraphAt(text, at) {
  const value = String(text ?? "");
  const before = value.slice(0, at);
  const start = Math.max(before.lastIndexOf("\n\n") + 2, 0);
  const next = value.indexOf("\n\n", at);
  const end = next < 0 ? value.replace(/\s+$/, "").length : next;
  return { start: before.lastIndexOf("\n\n") < 0 ? 0 : start, end: Math.max(end, start), source: value.slice(before.lastIndexOf("\n\n") < 0 ? 0 : start, Math.max(end, start)) };
}

/** A quote (not a tip) around `at`: `{ start, end, words, who }`, only when it would be written back the same. */
export function quoteAt(text, at) {
  const { start, end, source } = paragraphAt(text, at);
  const lines = source.split("\n");
  if (!lines.length || !lines.every((line) => /^>( |$)/.test(line)) || /^>\s*\[!/.test(lines[0])) return null;
  let who = "";
  let body = lines.map((line) => line.replace(/^> ?/, ""));
  if (body.length >= 3 && body[body.length - 2] === "" && /^— /.test(body[body.length - 1])) {
    who = body[body.length - 1].slice(2);
    body = body.slice(0, -2);
  }
  const quote = { start, end, words: body.join("\n"), who };
  return quoteMarkdown(quote) === source ? quote : null;
}

/** A `## heading` line around `at`: `{ start, end, level, words }`, or null. */
export function headingAt(text, at) {
  const value = String(text ?? "");
  const start = value.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const stop = value.indexOf("\n", at);
  const end = stop < 0 ? value.length : stop;
  const match = /^(#{2,6}) ([^\n#][^\n]*?)$/.exec(value.slice(start, end));
  return match && `${match[1]} ${match[2]}` === value.slice(start, end) ? { start, end, level: match[1].length, words: match[2] } : null;
}

/** A `[words](address)` link the caret is in: `{ start, end, words, href }`, or null. */
export function linkAt(text, at) {
  const value = String(text ?? "");
  for (const match of value.matchAll(/(?<!!)\[((?:\\.|[^\]\\\n])*)\]\(([^()\s]+)\)/g)) {
    if (match.index <= at && at <= match.index + match[0].length) {
      return { start: match.index, end: match.index + match[0].length, words: match[1].replace(/\\(.)/g, "$1"), href: match[2] };
    }
  }
  return null;
}

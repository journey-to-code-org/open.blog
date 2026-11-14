// Her words as boxes and cards (Studio R6): anything in a post's Markdown that isn't plain words
// (a photo, a tip, a checklist, a table, a piece, code...) is a card in place, and the words around
// it are boxes she types in. Pure, DOM-free, and safe above all:
//
//   joinBlocks(splitBlocks(text)) === text, byte for byte, for every text.
//
// A block is a slice of the text; the whitespace between blocks is kept as it was (`gapBefore` on
// the first block, `gapAfter` on each). Words are only ever split on blank lines, and a fence that
// never ends turns everything from it on into one block shown as written, so nothing in it moves.
import { parseEmbed } from "./block-forms.js";

const BLANK = /^[ \t]*\r?$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const PHOTO = /^!\[((?:\\.|[^\]\\])*)\]\(<?([^\s)<>]+)>?(?:\s+"[^"]*")?\)[ \t]*\r?$/;
// HTML that starts a block of its own (CommonMark types 1–6); a lone complete tag is type 7.
const HTML_OPEN = /^ {0,3}(?:<(?:script|pre|style|textarea)(?:\s|>|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[|<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$))/i;
const HTML_LONE_TAG = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*\r?$/;
const HTML_ENDS = [[/^ {0,3}<!--/, /-->/], [/^ {0,3}<(script|pre|style|textarea)\b/i, /<\/(script|pre|style|textarea)>/i], [/^ {0,3}<\?/, /\?>/], [/^ {0,3}<!\[CDATA\[/, /\]\]>/]];
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** The lines of a text with the offset each starts at. */
function linesOf(text) {
  const lines = String(text).split("\n");
  const starts = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return { lines, starts };
}

/** What the fence opened on `line` is: its marker and info, or null. Backtick fences have no ` in the info. */
function fenceOf(line) {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  if (match[2][0] === "`" && match[3].includes("`")) return null;
  return { indent: match[1].length, char: match[2][0], size: match[2].length, info: match[3].trim().replace(/\r$/, "") };
}

const closes = (line, fence) => new RegExp(`^ {0,3}\\${fence.char}{${fence.size},}[ \\t]*\\r?$`).test(line);

/** What a fenced card is, from its info string. */
function fenceKind(info) {
  const word = info.split(/[\s{]/)[0].toLowerCase();
  if (word === "piece") return "piece";
  if (word === "compare") return "compare";
  if (word === "quiz") return "quiz";
  if (word === "demo") return "demo";
  if (word === "quote") return "quote-form";
  if (/(^|\s)runnable(\s|$)/.test(info)) return "runnable";
  return "code";
}

/**
 * What a run of non-blank lines (one paragraph's worth) is, as a card kind, or "" for words.
 * `previous` is the kind of the chunk before (an indented chunk after a list item belongs to it).
 */
export function blockKind(source, previous = "") {
  const lines = String(source).replace(/\n+$/, "").split("\n");
  const first = lines[0] || "";
  if (lines.length === 1) {
    const photo = PHOTO.exec(first);
    if (photo) return /^https:\/\//i.test(photo[2]) ? "photo-web" : photo[2].startsWith("/") ? "photo" : "";
    const embed = parseEmbed(first);
    if (embed) return embed.provider === "codepen" ? "codepen-link" : "video-link";
  }
  const fence = fenceOf(first);
  if (fence && lines.length > 1 && closes(lines[lines.length - 1], fence)) return fenceKind(fence.info);
  if (/^ {0,3}>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(first)) return "callout";
  if (lines.every((line, index) => /^[-*+] \[[ xX]\] /.test(line) || (index > 0 && /^[ \t]+\S/.test(line)))) return "tasklist";
  if (lines.length >= 2 && first.includes("|") && /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*\r?$/.test(lines[1]) && (lines[1].includes("|") || first.trim().startsWith("|"))) return "table";
  if (/^\[\^[^\]\s]+\]:/.test(first)) return "footnote";
  if (HTML_OPEN.test(first) || HTML_LONE_TAG.test(first)) return "html";
  if (previous !== "" && previous !== "indented" && previous !== "list") return lines.every((line) => /^(?: {4}|\t)/.test(line)) ? "indented" : "";
  if (previous === "" && lines.every((line) => /^(?: {4}|\t)/.test(line))) return "indented";
  return "";
}

/**
 * The text as chunks: each card, and each paragraph of words, with the whitespace after it.
 * `{ lead, chunks: [{ type, kind, source, gap, start, line }], open }` where `open` is the line
 * (from 1) of a fence that never ends, from which everything is one chunk of words as written.
 */
export function splitChunks(text) {
  const value = String(text ?? "");
  const { lines, starts } = linesOf(value);
  const chunks = [];
  let i = 0;
  let open = 0;
  let previous = "";
  while (i < lines.length && BLANK.test(lines[i])) i += 1;
  const lead = i < lines.length ? value.slice(0, starts[i]) : value;
  while (i < lines.length) {
    const from = i;
    let to = i;
    let kind = "";
    let asWritten = false;
    const fence = fenceOf(lines[i]);
    if (fence) {
      let close = i + 1;
      while (close < lines.length && !closes(lines[close], fence)) close += 1;
      if (close >= lines.length) {
        // Never ends: the rest is one chunk of words, shown as written.
        open = i + 1;
        to = lines.length - 1;
        while (to > from && BLANK.test(lines[to])) to -= 1;
        asWritten = true;
      } else {
        to = close;
        kind = fenceKind(fence.info);
      }
    } else {
      const ends = HTML_ENDS.find(([starts_]) => starts_.test(lines[i]));
      if (ends && !ends[1].test(lines[i].replace(ends[0], ""))) {
        // A comment (or <pre>, <script>...) runs until its end, blank lines and all.
        while (to + 1 < lines.length && !ends[1].test(lines[to])) to += 1;
      }
      while (to + 1 < lines.length && !BLANK.test(lines[to + 1]) && !fenceOf(lines[to + 1])) to += 1;
      kind = blockKind(lines.slice(from, to + 1).join("\n"), previous);
    }
    const start = starts[from];
    const end = starts[to] + lines[to].length;
    let next = to + 1;
    while (next < lines.length && BLANK.test(lines[next])) next += 1;
    const gapEnd = next < lines.length ? starts[next] : value.length;
    chunks.push({ type: kind ? "card" : "words", kind, source: value.slice(start, end), gap: value.slice(end, gapEnd), start, line: from + 1, ...(asWritten ? { asWritten: true } : {}) });
    previous = kind || (LIST_ITEM.test(lines[to]) || LIST_ITEM.test(lines[from]) ? "list" : "words");
    if (kind === "indented") previous = "indented";
    i = next;
    if (asWritten) break;
  }
  return { lead, chunks, open };
}

/**
 * Her words as blocks: runs of word paragraphs are one block (one box), each card its own.
 * `[{ type: "words" | "card", kind, source, gapBefore, gapAfter, start, line, asWritten? }]`. A text
 * with nothing in it is one empty words block holding its whitespace.
 */
export function splitBlocks(text) {
  const value = String(text ?? "");
  const { lead, chunks } = splitChunks(value);
  if (!chunks.length) return [{ type: "words", kind: "", source: "", gapBefore: value, gapAfter: "", start: 0, line: 1 }];
  const blocks = [];
  for (const chunk of chunks) {
    const last = blocks[blocks.length - 1];
    if (chunk.type === "words" && !chunk.asWritten && last?.type === "words" && !last.asWritten) {
      last.source = value.slice(last.start, chunk.start + chunk.source.length);
      last.gapAfter = chunk.gap;
      continue;
    }
    blocks.push({ type: chunk.type, kind: chunk.kind, source: chunk.source, gapBefore: "", gapAfter: chunk.gap, start: chunk.start, line: chunk.line, ...(chunk.asWritten ? { asWritten: true } : {}) });
  }
  blocks[0].gapBefore = lead;
  return blocks;
}

/**
 * The text again. Unchanged blocks give back the text exactly. A block emptied by her writes
 * nothing, and the whitespace that was around it closes up (the text's own ending is kept).
 */
export function joinBlocks(blocks) {
  if (!blocks.length) return "";
  const kept = blocks.map((block, index) => index).filter((index) => blocks[index].source !== "");
  const lead = blocks[0].gapBefore || "";
  if (!kept.length) return lead + blocks[blocks.length - 1].gapAfter;
  let out = lead;
  kept.forEach((index, n) => {
    out += blocks[index].source;
    out += n === kept.length - 1 ? blocks[blocks.length - 1].gapAfter : blocks[index].gapAfter;
  });
  return out;
}

/** Whitespace that separates two blocks with an empty line, kept as it was when it already does. */
export const blankGap = (gap) => (/\n[ \t]*\r?\n/.test(gap) ? gap : "\n\n");

/**
 * An empty box at `index` (between two cards, before the first, or after the last): it writes
 * nothing until she types in it. The text's leading whitespace stays first.
 */
export function addRoom(blocks, index) {
  const out = blocks.map((block) => ({ ...block }));
  const room = { type: "words", kind: "", source: "", gapBefore: "", gapAfter: "", start: -1, line: 0, room: true };
  if (index === 0 && out.length) {
    room.gapBefore = out[0].gapBefore;
    out[0].gapBefore = "";
  }
  // Last: the text's own ending is read from the last block, so the room carries it too.
  if (index === out.length && out.length) room.gapAfter = out[out.length - 1].gapAfter;
  out.splice(index, 0, room);
  return out;
}

/** The blocks with an empty box after the last one when it is a card (where "Keep writing…" goes). */
export function withEndRoom(blocks) {
  return blocks.length && blocks[blocks.length - 1].type === "card" ? addRoom(blocks, blocks.length) : blocks;
}

/**
 * Words typed into an empty box: the blocks with that box filled in and the whitespace around it
 * made into empty lines, so the words are a paragraph of their own and the text keeps its ending.
 */
export function fillBlock(blocks, index, source) {
  const out = blocks.map((block) => ({ ...block }));
  const block = out[index];
  const wasEmpty = block.source === "";
  block.source = source;
  if (!wasEmpty || source === "") return out;
  const last = out.length - 1;
  const before = out.slice(0, index).findLastIndex((b) => b.source !== "");
  const after = out.findIndex((b, i) => i > index && b.source !== "");
  if (before >= 0 && after < 0 && index === last) {
    block.gapAfter = block.gapAfter || out[before].gapAfter;
    out[before].gapAfter = blankGap(out[before].gapAfter);
  } else if (before >= 0) {
    out[before].gapAfter = blankGap(out[before].gapAfter);
    if (after >= 0) block.gapAfter = blankGap(block.gapAfter);
  } else if (after >= 0) {
    block.gapAfter = blankGap(block.gapAfter);
  }
  return out;
}

/** The lines of `text` around an offset: which line, its start and end. */
function lineAt(text, offset) {
  const at = Math.min(Math.max(0, offset | 0), text.length);
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  return { start, end: end < 0 ? text.length : end };
}

/**
 * Put `markdown` in `text` as its own paragraph at `caret`: in place of a line that is only "/",
 * else after the paragraph holding the caret (at the end with no caret). Returns `{ text, start,
 * end }`, where `start`–`end` is the Markdown in the new text.
 */
export function insertBlock(text, caret, markdown) {
  const value = String(text ?? "");
  const piece = String(markdown ?? "").replace(/\n+$/, "");
  if (!value.trim()) return { text: piece, start: 0, end: piece.length };
  if (Number.isFinite(caret)) {
    const line = lineAt(value, caret);
    if (value.slice(line.start, line.end).replace(/\r$/, "").trim() === "/") {
      const before = value.slice(0, line.start).replace(/[ \t]*\r?\n?$/, "");
      const after = value.slice(line.end).replace(/^\r?\n?/, "");
      const head = before.trim() ? `${before.replace(/(\r?\n[ \t]*)+$/, "")}\n\n` : "";
      const tail = after.trim() ? `\n\n${after.replace(/^([ \t]*\r?\n)+/, "")}` : after.endsWith("\n") || value.endsWith("\n") ? "\n" : "";
      return { text: head + piece + tail, start: head.length, end: head.length + piece.length };
    }
  }
  const { lines, starts } = linesOf(value);
  const at = Number.isFinite(caret) ? Math.min(Math.max(0, Math.trunc(caret)), value.length) : value.length;
  let row = starts.findLastIndex((start) => start <= at);
  while (row >= 0 && BLANK.test(lines[row])) row -= 1;
  if (row < 0) {
    const first = lines.findIndex((line) => !BLANK.test(line));
    const head = value.slice(0, starts[first]);
    return { text: `${head}${piece}\n\n${value.slice(starts[first])}`, start: head.length, end: head.length + piece.length };
  }
  // The end of that paragraph, or of the fence it is in.
  const { chunks } = splitChunks(value);
  const holding = chunks.find((chunk) => chunk.start <= starts[row] && starts[row] <= chunk.start + chunk.source.length);
  const end = holding ? holding.start + holding.source.length : starts[row] + lines[row].length;
  const before = `${value.slice(0, end)}\n\n`;
  const rest = value.slice(end);
  const after = /^\r?\n[ \t]*\r?\n/.test(rest) || rest === "" || /^\r?\n$/.test(rest) ? rest : `\n${rest}`;
  return { text: before + piece + after, start: before.length, end: before.length + piece.length };
}

/** The chunk that starts at `start`, with its index, or null. */
function chunkAt(chunks, start) {
  const index = chunks.findIndex((chunk) => chunk.start === start);
  return index < 0 ? null : { index, chunk: chunks[index] };
}

/** Write chunks back: the lead, each source and the gap after it. */
const joinChunks = (lead, chunks) => lead + chunks.map((chunk) => chunk.source + chunk.gap).join("");

/**
 * Move the card starting at offset `start` one place up (`by` -1) or down (+1): it swaps with the
 * paragraph or card next to it. The whitespace on both sides of the move becomes an empty line, so
 * nothing joins what it lands next to. `{ text, start, neighbour }` (the swapped chunk's source),
 * or null when it can't move.
 */
export function moveBlock(text, start, by) {
  const value = String(text ?? "");
  const { lead, chunks, open } = splitChunks(value);
  const found = chunkAt(chunks, start);
  if (!found) return null;
  const to = found.index + (by < 0 ? -1 : 1);
  if (to < 0 || to >= chunks.length || (open && chunks[to].asWritten)) return null;
  const list = chunks.map((chunk) => ({ ...chunk }));
  const [a, b] = by < 0 ? [to, found.index] : [found.index, to];
  // The gaps stay where they are; the two sources trade places.
  const first = list[a].source;
  list[a].source = list[b].source;
  list[b].source = first;
  list[a].gap = blankGap(list[a].gap);
  if (a > 0) list[a - 1].gap = blankGap(list[a - 1].gap);
  if (b < list.length - 1) list[b].gap = blankGap(list[b].gap);
  const out = joinChunks(lead, list);
  const moved = by < 0 ? a : b;
  const newStart = lead.length + list.slice(0, moved).reduce((sum, chunk) => sum + chunk.source.length + chunk.gap.length, 0);
  return { text: out, start: newStart, neighbour: chunks[to].source };
}

/** Take out the card starting at `start`. `{ text, at }` (where it was), or null. */
export function removeBlock(text, start) {
  const value = String(text ?? "");
  const blocks = splitBlocks(value);
  const index = blocks.findIndex((block) => block.start === start && block.type === "card");
  if (index < 0) {
    // A card inside... never: cards are always blocks of their own.
    return null;
  }
  const next = blocks.map((block, i) => (i === index ? { ...block, source: "" } : block));
  const out = joinBlocks(next);
  return { text: out, at: Math.min(start, out.length) };
}

/** Put `markdown` in place of the card starting at `start` whose source is `source`. Null if it moved. */
export function replaceBlock(text, start, source, markdown) {
  const value = String(text ?? "");
  if (value.slice(start, start + source.length) !== source) return null;
  const piece = String(markdown).replace(/\n+$/, "");
  return { text: value.slice(0, start) + piece + value.slice(start + source.length), start, end: start + piece.length };
}

/** The next free footnote number in a text. */
export function nextFootnote(text) {
  const used = new Set([...String(text ?? "").matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  return n;
}

/**
 * A footnote: `[^n]` at the caret (n the next free number) and `[^n]: note` at the end of the text.
 * `{ text, caret, n }`.
 */
export function addFootnote(text, caret, note) {
  const value = String(text ?? "");
  const n = nextFootnote(value);
  const at = Number.isFinite(caret) ? Math.min(Math.max(0, Math.trunc(caret)), value.length) : value.replace(/\s+$/, "").length;
  const mark = `[^${n}]`;
  const withMark = value.slice(0, at) + mark + value.slice(at);
  const ending = /\n$/.test(value) ? "\n" : "";
  const body = withMark.replace(/\s+$/, "");
  const words = String(note).replace(/\s+/g, " ").trim();
  return { text: `${body}\n\n${mark}: ${words}${ending}`, caret: at + mark.length, n };
}

/** Which block holds offset `at`: its index (a block's end counts as in it). */
export function segmentAt(blocks, at) {
  let offset = blocks[0]?.gapBefore.length || 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const end = offset + blocks[index].source.length;
    if (at <= end) return index;
    offset = end + blocks[index].gapAfter.length;
  }
  return Math.max(0, blocks.length - 1);
}

/**
 * What a piece action changed, for its Undo: the whole lines it touched as they were (`from`) and as
 * they are (`to`), and where. A take-out leaves only blank lines, so it keeps the nearest line of
 * words on each side to find its place again.
 */
export function pieceChange(before, after) {
  const a = String(before);
  const b = String(after);
  const most = Math.min(a.length, b.length);
  let p = 0;
  while (p < most && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < most - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  let start = p === 0 ? 0 : b.lastIndexOf("\n", p - 1) + 1;
  let endB = b.indexOf("\n", b.length - s);
  if (endB < 0) endB = b.length;
  const tail = () => b.length - endB;
  // Lines of words around a change that left none of its own.
  if (!b.slice(start, endB).trim()) {
    while (start > 0) {
      const lineStart = start < 2 ? 0 : b.lastIndexOf("\n", start - 2) + 1;
      const lineEnd = b.indexOf("\n", lineStart);
      start = lineStart;
      if (b.slice(lineStart, lineEnd < 0 ? b.length : lineEnd).trim()) break;
    }
    while (endB < b.length) {
      const next = b.indexOf("\n", endB + 1);
      const lineEnd = next < 0 ? b.length : next;
      const line = b.slice(endB + 1, lineEnd);
      endB = lineEnd;
      if (line.trim()) break;
    }
  }
  return { start, from: a.slice(start, a.length - tail()), to: b.slice(start, endB), length: b.length };
}

/**
 * Undo `change` (from `pieceChange`) in `text` as it is now, keeping everything typed since.
 * `{ text, at }` with the caret moved along, or null when what it changed can't be found intact.
 */
export function undoPieceChange(change, text, caret = null) {
  const now = String(text);
  if (!change) return null;
  // Nothing left to find (the box held only the piece): only an empty box can take it back.
  if (!change.to) return now.trim() ? null : { text: change.from, at: change.from.length };
  const found = [];
  for (let at = now.indexOf(change.to); at >= 0; at = now.indexOf(change.to, at + 1)) found.push(at);
  if (!found.length) return null;
  // Where it was, or that place moved along by what was typed since.
  const typed = now.length - change.length;
  const near = (at) => Math.min(Math.abs(at - change.start), Math.abs(at - change.start - typed));
  const at = found.reduce((best, here) => (near(here) < near(best) ? here : best), found[0]);
  const out = now.slice(0, at) + change.from + now.slice(at + change.to.length);
  const delta = change.from.length - change.to.length;
  let place = at + change.from.length;
  if (Number.isInteger(caret)) place = caret <= at ? caret : caret >= at + change.to.length ? caret + delta : at + change.from.length;
  return { text: out, at: place };
}

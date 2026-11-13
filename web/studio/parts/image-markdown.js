// A picture as Markdown, and where it goes in her words: its own paragraph after the one holding
// the cursor, never in the middle of a sentence. DOM-free.

/**
 * `![description](url)` for a picture on her site. The description has `\`, `[` and `]` escaped
 * and its line breaks turned into spaces, so it can't break out of the brackets.
 * Throws a TypeError unless `url` starts with `/images/uploads/` and has no spaces, parentheses
 * or control characters.
 * @param {string} url
 * @param {string} description
 * @returns {string}
 */
export function imageMarkdown(url, description) {
  const address = String(url ?? "");
  // eslint-disable-next-line no-control-regex
  if (!address.startsWith("/images/uploads/") || /[\s()\u0000-\u001f\u007f]/.test(address)) {
    throw new TypeError(`Not a picture address Studio can put in: ${JSON.stringify(address)}`);
  }
  const words = String(description ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .trim()
    .replace(/[\\[\]]/g, (c) => `\\${c}`);
  return `![${words}](${address})`;
}

const BLANK = /^[ \t]*$/;

/**
 * Put `markdown` in `text` as a paragraph of its own, right after the paragraph that holds
 * `cursor` (or the one before it, when the cursor sits on an empty line). With no cursor it goes
 * at the end. Returns the new text and the cursor just after the picture.
 * @param {string} text
 * @param {number | null | undefined} cursor
 * @param {string} markdown
 * @returns {{ text: string, cursor: number }}
 */
export function insertParagraph(text, cursor, markdown) {
  const value = String(text ?? "");
  const piece = String(markdown ?? "");
  if (!value.trim()) return { text: piece, cursor: piece.length };
  const at = Number.isFinite(cursor) ? Math.min(Math.max(0, Math.trunc(cursor)), value.length) : value.length;

  // The lines, with where each starts.
  const lines = value.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let row = starts.findLastIndex((start) => start <= at);
  // On an empty line: the paragraph before it. Before every paragraph: the start.
  while (row >= 0 && BLANK.test(lines[row])) row -= 1;
  if (row < 0) {
    const first = lines.findIndex((line) => !BLANK.test(line));
    const head = value.slice(0, starts[first]);
    return { text: `${head}${piece}\n\n${value.slice(starts[first])}`, cursor: head.length + piece.length };
  }
  // The end of that paragraph: the last line before an empty one.
  while (row + 1 < lines.length && !BLANK.test(lines[row + 1])) row += 1;
  const end = starts[row] + lines[row].length;
  const before = `${value.slice(0, end)}\n\n${piece}`;
  const after = value.slice(end);
  const rest = /^\n[ \t]*\n/.test(after) || after === "" || after === "\n" ? after : `\n${after}`;
  return { text: before + rest, cursor: before.length };
}

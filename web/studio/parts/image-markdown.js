// A picture as Markdown. Where it goes in her words is word-blocks.js's insertBlock (R6). DOM-free.

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

// Mastodon helpers of the Mastodon destination (epic #382, story #392, ADRs 0359 and 0360). Pure: no
// network, no clock of its own, no secret kept. social-publish.mjs builds and checks a status with
// them; the Admin composer (web/admin/announcements.js) repeats the counting rule for its preview.
//
// What is decided here and why:
//   - the status is the caption, then a blank line and the canonical link, unless the caption
//     already holds that link, read as Mastodon reads it (a closing bracket or full stop after it is
//     not part of it, ADR 0386): Mastodon has no separate link field and makes its own preview card
//     from the first link in the text;
//   - its length is counted as Mastodon counts it, every URL as the instance's
//     `characters_reserved_per_url` (23 by default), mentions at their full length (Mastodon counts
//     only the username, so this is never short);
//   - the Idempotency-Key sent with a status is derived from the announcement's key, never the key
//     itself, so every attempt of one announcement within Mastodon's hour names the same status;
//   - the cover image is found in the canonical page's own og:image and og:image:alt, which the
//     engine writes from the post's `cover` and `coverAlt`; no image without a description is ever
//     attached.

export const STATUS_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const DEFAULT_LIMITS = Object.freeze({ maxCharacters: 500, charactersPerUrl: 23, descriptionLimit: 1500, imageSizeLimit: 16 * 1024 * 1024, mimeTypes: null });
// Never more than this is downloaded for a cover, whatever the instance takes.
export const MAX_COVER_BYTES = 8 * 1024 * 1024;
export const COVER_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gu;
const encoder = new TextEncoder();

// Punctuation after a link ends the sentence, not the link. A closing bracket stays when the link
// opened one itself, as in https://en.wikipedia.org/wiki/Bread_(food).
const TRAILING = /[.,;:!?)\]}]$/u;
const PAIRS = { ")": "(", "]": "[", "}": "{" };
const occurrences = (text, char) => text.split(char).length - 1;
function trimLink(link) {
  let out = link;
  while (TRAILING.test(out)) {
    const last = out.at(-1);
    if (PAIRS[last] && occurrences(out, PAIRS[last]) >= occurrences(out, last)) break;
    out = out.slice(0, -1);
  }
  return out;
}

// Every link in `text` as Mastodon reads it, without the punctuation around it: { index, link }.
export function linksIn(text) {
  return [...String(text ?? "").matchAll(URL_IN_TEXT)].map((match) => ({ index: match.index, link: trimLink(match[0]) }));
}

// Whether the caption already holds `url` as a link of its own (ADR 0386).
export function holdsLink(caption, url) {
  return linksIn(caption).some((found) => found.link === url);
}

// The status text of an announcement.
export function statusText(caption, url) {
  return holdsLink(caption, url) ? caption : `${caption}\n\n${url}`;
}

// The length Mastodon counts for `text`, with every URL counted as `perUrl` characters.
export function statusLength(text, perUrl = DEFAULT_LIMITS.charactersPerUrl) {
  let length = 0;
  let last = 0;
  for (const { index, link } of linksIn(text)) {
    length += Array.from(text.slice(last, index)).length + perUrl;
    last = index + link.length;
  }
  return length + Array.from(text.slice(last)).length;
}

const positive = (value, fallback, max = Number.MAX_SAFE_INTEGER) => (Number.isInteger(value) && value > 0 && value <= max ? value : fallback);

// The limits an instance's GET /api/v2/instance states, each falling back to Mastodon's default.
export function instanceLimits(body) {
  const configuration = body && typeof body === "object" ? body.configuration : null;
  const statuses = configuration?.statuses ?? {};
  const media = configuration?.media_attachments ?? {};
  const types = Array.isArray(media.supported_mime_types) ? media.supported_mime_types.filter((type) => typeof type === "string" && COVER_TYPES.includes(type)) : null;
  return Object.freeze({
    maxCharacters: positive(statuses.max_characters, DEFAULT_LIMITS.maxCharacters, 1_000_000),
    charactersPerUrl: positive(statuses.characters_reserved_per_url, DEFAULT_LIMITS.charactersPerUrl, 10_000),
    descriptionLimit: positive(media.description_limit, DEFAULT_LIMITS.descriptionLimit, 100_000),
    imageSizeLimit: positive(media.image_size_limit, DEFAULT_LIMITS.imageSizeLimit),
    mimeTypes: types ? Object.freeze(types) : null,
  });
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// The Idempotency-Key of one announcement's status: a hash of its idempotency key.
export async function idempotencyHeader(idempotencyKey) {
  if (typeof idempotencyKey !== "string" || !idempotencyKey) return null;
  return `openblog-${hex(await crypto.subtle.digest("SHA-256", encoder.encode(`openblog-mastodon-status:${idempotencyKey}`))).slice(0, 48)}`;
}

// How long a 429 asks us to wait: Retry-After when sent, else X-RateLimit-Reset (an ISO 8601 time).
export function rateLimitWaitMs(retryAfterMs, resetHeader, nowMs) {
  if (retryAfterMs !== null && retryAfterMs !== undefined) return retryAfterMs;
  const text = String(resetHeader ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

// ---- the cover image named by the canonical page

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (value) =>
  value.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

// The first value of each `<meta property|name=... content=...>` in an HTML head.
export function metaTags(html) {
  const found = new Map();
  const head = String(html).slice(0, 512 * 1024);
  for (const tag of head.matchAll(/<meta\b[^>]{0,4000}>/gi)) {
    const attributes = new Map();
    for (const attribute of tag[0].matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attributes.set(attribute[1].toLowerCase(), attribute[3] ?? attribute[4] ?? "");
    const key = (attributes.get("property") || attributes.get("name") || "").toLowerCase();
    if (key && attributes.has("content") && !found.has(key)) found.set(key, decode(attributes.get("content")));
  }
  return found;
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;

// The cover a canonical page names, or null: an https image on the page's own origin with a
// description of at most `descriptionLimit` characters. Without a description there is no cover.
export function coverOf(html, pageUrl, descriptionLimit = DEFAULT_LIMITS.descriptionLimit) {
  const tags = metaTags(html);
  const source = tags.get("og:image");
  const description = (tags.get("og:image:alt") ?? "").replace(/\s+/g, " ").trim();
  if (!source || !description || CONTROL.test(description) || Array.from(description).length > descriptionLimit) return null;
  let image;
  let page;
  try {
    page = new URL(pageUrl);
    image = new URL(source, page);
  } catch {
    return null;
  }
  if (image.protocol !== "https:" || image.origin !== page.origin || image.username || image.password || image.href.length > 2000) return null;
  return { url: image.href, description };
}

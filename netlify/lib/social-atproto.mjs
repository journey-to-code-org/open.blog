// AT Protocol helpers of the Bluesky destination (epic #382, story #391, ADRs 0357 and 0358). Pure:
// no network, no clock of its own, no secret kept. social-providers.mjs signs the author in with
// them and social-publish.mjs builds the post record with them.
//
// What is checked here and why:
//   - an identifier is a handle or a DID, never an email address or anything with a path in it;
//   - an app password must have the shape Bluesky gives app passwords (xxxx-xxxx-xxxx-xxxx), so the
//     author's account password, which can do far more, is refused before it is ever sent;
//   - a session token's expiry is read from its `exp` claim, unverified: it only decides when to
//     refresh, and the provider still checks every token it is given;
//   - facets are computed in UTF-8 byte offsets, as app.bsky.richtext.facet requires;
//   - the record key of a post is a TID derived from the announcement, so the same announcement
//     always names the same record and a lookup by key can say for certain whether it exists.

export const DID = /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.-]{1,253}(%3A\d{1,5})?)$/;
// A handle is a domain name: at least two labels, letters, digits and hyphens, at most 253 characters.
export const HANDLE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
export const SESSION_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
export const POST_COLLECTION = "app.bsky.feed.post";
export const MAX_POST_GRAPHEMES = 300;
export const MAX_POST_BYTES = 3000;

// The identifier as Bluesky reads it: a handle (an @ in front is dropped, case is folded) or a DID.
export function blueskyIdentifier(value) {
  const raw = String(value ?? "").trim();
  if (DID.test(raw)) return raw;
  const handle = raw.replace(/^@/, "").toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

export const validAppPassword = (value) => typeof value === "string" && APP_PASSWORD.test(value.trim().toLowerCase());
export const appPassword = (value) => String(value ?? "").trim().toLowerCase();

// Seconds until a session token's `exp`, or undefined when the token carries none that can be read.
export function tokenSecondsLeft(token, nowMs) {
  try {
    const part = String(token).split(".")[1];
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const exp = Number(json?.exp);
    if (!Number.isFinite(exp)) return undefined;
    const left = Math.floor(exp - nowMs / 1000);
    return left > 0 ? left : 1;
  } catch {
    return undefined;
  }
}

// The `error` name of an XRPC failure body ({ error, message }), only when it is a plain name.
// The message is never read: it is the provider's text.
export function xrpcError(body) {
  const name = body && typeof body === "object" ? body.error : null;
  return typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name) ? name : "";
}

// ---- record keys

const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

// A TID (atproto's timestamp identifier): 64 bits, top bit zero, 53 bits of microseconds since the
// epoch and a 10-bit clock id, written as 13 characters of base32-sortable.
export function tid(micros, clockId) {
  let value = (BigInt(micros) << 10n) | BigInt(clockId & 0x3ff);
  value &= (1n << 63n) - 1n;
  let out = "";
  for (let i = 0; i < 13; i += 1) {
    out = TID_ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

export const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

// The record key of one announcement: the scheduled instant in milliseconds, with three digits of
// microseconds and the clock id taken from a hash of its idempotency key. Two announcements of one
// account would need the same millisecond and the same 20 hash bits to collide; a retry of the same
// announcement always names the same record.
export async function announcementKey({ scheduledFor, idempotencyKey }) {
  const at = Date.parse(scheduledFor ?? "");
  if (!Number.isFinite(at) || at <= 0 || typeof idempotencyKey !== "string" || !idempotencyKey) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`openblog-bluesky-rkey:${idempotencyKey}`)));
  const micros = BigInt(at) * 1000n + BigInt(((digest[0] << 8) | digest[1]) % 1000);
  return tid(micros, (digest[2] << 8) | digest[3]);
}

// ---- rich text

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text).length;

// Links written in full (https:// or http://) and hashtags. Mentions are left as plain text: making
// one needs the mentioned handle resolved to a DID, and a wrong mention would notify a stranger.
const LINK = /\bhttps?:\/\/[^\s<>"'`]+/gu;
const TAG = /(^|\s)#((?!\d+(?:\s|$))[\p{L}\p{N}_]{1,64})/gu;
const TRAILING = /[.,;:!?)\]}'"»”’]+$/u;

// Facets for the links and hashtags in `text`, in UTF-8 byte offsets, ordered by position.
export function facetsFor(text) {
  const facets = [];
  for (const match of text.matchAll(LINK)) {
    let uri = match[0];
    // A sentence's own closing punctuation is not part of the link. The text is never changed: a
    // link that really ends in one of these characters keeps it in the text and only its facet
    // stops short of it.
    const trailing = TRAILING.exec(uri);
    if (trailing) uri = uri.slice(0, uri.length - trailing[0].length);
    try {
      const parsed = new URL(uri);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname.includes(".")) continue;
    } catch {
      continue;
    }
    const start = bytes(text.slice(0, match.index));
    facets.push({ index: { byteStart: start, byteEnd: start + bytes(uri) }, features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  for (const match of text.matchAll(TAG)) {
    const offset = match.index + match[1].length;
    const tag = match[2];
    // A hashtag inside a link already has a facet.
    const start = bytes(text.slice(0, offset));
    const end = start + bytes(`#${tag}`);
    if (facets.some((facet) => start < facet.index.byteEnd && end > facet.index.byteStart)) continue;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: "app.bsky.richtext.facet#tag", tag }] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

// Graphemes as Bluesky counts them, where the runtime can segment; code points otherwise, which
// is never fewer.
export function graphemes(text) {
  if (typeof Intl?.Segmenter === "function") return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length;
  return Array.from(text).length;
}

export const withinPostLimits = (text) => graphemes(text) <= MAX_POST_GRAPHEMES && bytes(text) <= MAX_POST_BYTES;

// The card's title: the caption's first line as plain text, bounded.
export const cardTitle = (caption) =>
  Array.from(
    String(caption ?? "")
      .split("\n")[0]
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, 300)
    .join("") || "Read the full post";

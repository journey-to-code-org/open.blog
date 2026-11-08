// Quote request intake (epic #474, story #485; ADR 0381): settings, the signed form token, bounded
// parsing of a form post, validation and the abuse fence. Pure: no network, no storage. A visitor's
// values never reach a log, an error or a thrown message; errors name fields and fixed reasons only.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 900 * 1024;
export const MAX_TOTAL_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_BODY_BYTES = 4 * 1024 * 1024 + 64 * 1024;
export const MIN_FILL_SECONDS = 3;
export const MAX_FILL_SECONDS = 2 * 60 * 60;
export const PER_CLIENT_PER_HOUR = 5;
export const PER_SITE_PER_HOUR = 60;
export const MIN_SECRET_CHARS = 32;

const SITE_SCOPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const text = (value) => String(value ?? "");

export class QuoteError extends Error {
  constructor(status, code, fields = []) {
    super(code);
    this.name = "QuoteError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const httpsOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
};

// Off unless OPENBLOG_QUOTE_ENABLED is exactly "true". On but incomplete is still off, with the
// names (never the values) of what is wrong.
export function quoteSettings(env = {}) {
  const off = (problems) => ({ enabled: false, problems });
  if (text(env.OPENBLOG_QUOTE_ENABLED).trim() !== "true") return off([]);
  const url = text(env.SUPABASE_URL).replace(/\/$/, "");
  const key = text(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  const siteId = text(env.OPENBLOG_SITE_ID).trim();
  const origin = text(env.OPENBLOG_SITE_ORIGIN).replace(/\/$/, "");
  const secret = text(env.OPENBLOG_QUOTE_SECRET);
  const adminKey = text(env.OPENBLOG_QUOTE_ADMIN_KEY);
  const problems = [];
  if (!httpsOrigin(`${url}/`)) problems.push("SUPABASE_URL");
  if (!key) problems.push("SUPABASE_SECRET_KEY");
  if (!SITE_SCOPE.test(siteId)) problems.push("OPENBLOG_SITE_ID");
  if (!httpsOrigin(`${origin}/`)) problems.push("OPENBLOG_SITE_ORIGIN");
  if (secret.length < MIN_SECRET_CHARS || /\s/.test(secret) || secret === key) problems.push("OPENBLOG_QUOTE_SECRET");
  // The admin key is optional (it only unlocks the notification routes), but when set it must be long
  // and distinct from every other credential.
  if (adminKey && (adminKey.length < MIN_SECRET_CHARS || /\s/.test(adminKey) || adminKey === key || adminKey === secret)) problems.push("OPENBLOG_QUOTE_ADMIN_KEY");
  if (problems.length) return off(problems);
  return { enabled: true, problems: [], url, key, siteId, origin, secret, adminKey };
}

const mac = (secret, label, value) => createHmac("sha256", secret).update(`${label}\n${value}`).digest("base64url");

// A form token is base64url({ t: issued seconds, n: nonce }) + "." + HMAC. Nothing is stored; one
// token sends one request (its hash is unique in the table).
export function issueToken(secret, now) {
  const payload = Buffer.from(JSON.stringify({ t: Math.floor(now / 1000), n: randomBytes(12).toString("hex") })).toString("base64url");
  return `${payload}.${mac(secret, "token", payload)}`;
}

// { ok: true } or { ok: false, reason: "missing" | "malformed" | "forged" | "too-fast" | "expired" }.
export function checkToken(token, secret, now) {
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (token.length > 400 || parts.length !== 2) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(mac(secret, "token", parts[0]));
  const given = Buffer.from(parts[1]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "forged" };
  let value;
  try {
    value = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!value || !Number.isInteger(value.t)) return { ok: false, reason: "malformed" };
  const age = Math.floor(now / 1000) - value.t;
  if (age < MIN_FILL_SECONDS) return { ok: false, reason: "too-fast" };
  if (age > MAX_FILL_SECONDS) return { ok: false, reason: "expired" };
  return { ok: true };
}

export const tokenHash = (secret, token) => mac(secret, "token-hash", token);
export const clientHash = (secret, address) => mac(secret, "client", text(address).slice(0, 100) || "unknown");

const header = (headers, name) => text(headers?.[name] ?? headers?.[name.toLowerCase()]);

// Reads a urlencoded or multipart body into { fields, files }, refusing anything over the bounds.
export function readForm(headers, rawBody, isBase64) {
  const type = header(headers, "content-type") || header(headers, "Content-Type");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(text(rawBody), isBase64 ? "base64" : "utf8");
  if (body.length > MAX_BODY_BYTES) throw new QuoteError(413, "too-large");
  if (/^application\/x-www-form-urlencoded/i.test(type)) {
    const fields = {};
    for (const [name, value] of new URLSearchParams(body.toString("utf8"))) if (!(name in fields)) fields[name] = value;
    return { fields, files: [] };
  }
  const boundary = /^multipart\/form-data;.*boundary=(?:"([^"]{1,200})"|([^;\s]{1,200}))/i.exec(type);
  if (!boundary) throw new QuoteError(415, "unsupported-type");
  return parseMultipart(body, boundary[1] || boundary[2]);
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let at = body.indexOf(delimiter);
  let parts = 0;
  while (at >= 0) {
    at += delimiter.length;
    if (body.subarray(at, at + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, at);
    if (next < 0) throw new QuoteError(400, "malformed");
    if (++parts > 20) throw new QuoteError(400, "malformed");
    const part = body.subarray(at + 2, next - 2); // drop the CRLF after the delimiter and before the next
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) throw new QuoteError(400, "malformed");
    const head = part.subarray(0, split).toString("utf8");
    const content = part.subarray(split + 4);
    const name = /name="([^"\r\n]{1,60})"/i.exec(head)?.[1];
    const filename = /filename="([^"\r\n]*)"/i.exec(head);
    if (name) {
      if (filename) {
        if (filename[1] !== "" || content.length > 0) files.push({ name, bytes: content });
      } else if (!(name in fields)) {
        fields[name] = content.toString("utf8");
      }
    }
    at = next;
  }
  return { fields, files };
}

// Control characters go, C1 (U+0080 to U+009F) included, so what is stored is what Admin shows
// (it reads every control but a line break or tab as unreadable, ADR 0386). So do invisible format marks.
const clean = (value, max) =>
  text(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .slice(0, max + 1);

// The form's phone box carries the same rule as a `pattern` (PHONE_PATTERN in crates/openblog-core/src/quote.rs).
export const PHONE = /^\+?[0-9 ().-]{7,30}$/;
const EMAIL = /^[^\s@<>]{1,100}@[^\s@<>]{1,100}\.[^\s@<>]{2,30}$/;

// The image kinds accepted, decided by the file's own first bytes, never its name or declared type.
export function sniffImage(bytes) {
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
  if (bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

// Every field problem is reported once, by field name, with a fixed reason. { values, photos } on success.
export function validateRequest({ fields, files }) {
  const problems = [];
  const need = (name, max, min = 1) => {
    const value = clean(fields[name], max);
    if (value.length < min) problems.push({ field: name, reason: "required" });
    else if (value.length > max) problems.push({ field: name, reason: "too-long" });
    return value;
  };
  const values = {
    name: need("name", 100),
    phone: need("phone", 30, 7),
    town: need("town", 100),
    service: need("service", 100),
    description: need("description", 2000, 10),
    email: clean(fields.email, 200),
    page: clean(fields.page, 500),
  };
  if (values.phone && !PHONE.test(values.phone)) problems.push({ field: "phone", reason: "invalid" });
  if (values.email && (values.email.length > 200 || !EMAIL.test(values.email))) problems.push({ field: "email", reason: "invalid" });
  if (!/^\/[^\s?#]*$/.test(values.page) || values.page.length > 500) values.page = "";
  if ((values.description.match(/https?:\/\/|www\./gi) || []).length > 2) problems.push({ field: "description", reason: "links" });
  const photoFiles = files.filter((file) => file.name === "photos");
  if (files.length !== photoFiles.length) problems.push({ field: "photos", reason: "unexpected-file" });
  if (photoFiles.length > MAX_PHOTOS) problems.push({ field: "photos", reason: "too-many" });
  let total = 0;
  const photos = [];
  for (const file of photoFiles.slice(0, MAX_PHOTOS)) {
    total += file.bytes.length;
    const kind = sniffImage(file.bytes);
    if (file.bytes.length > MAX_PHOTO_BYTES) problems.push({ field: "photos", reason: "photo-too-large" });
    else if (!kind) problems.push({ field: "photos", reason: "photo-type" });
    else photos.push({ bytes: file.bytes, ...kind });
  }
  if (total > MAX_TOTAL_PHOTO_BYTES) problems.push({ field: "photos", reason: "photos-too-large" });
  if (problems.length) throw new QuoteError(422, "invalid", problems);
  return { values, photos };
}

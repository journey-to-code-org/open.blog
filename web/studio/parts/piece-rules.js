// Rules for the forms that put a piece in her words (Studio R6): what a form sends to POST pieces,
// a video link from an id, a place from a map link, where a button or link goes, and what a refusal
// means. Pure, DOM-free. The engine checks and writes every piece; nothing here builds a fence.

/** The values a form sends: `[name, value]` pairs, empty optional ones left out, required ones always sent. */
export function pieceValues(schema, top = {}, rows = []) {
  const out = [];
  for (const field of schema?.fields || []) {
    const value = String(top[field.name] ?? "").trim();
    if (value || field.required) out.push([field.name, value]);
  }
  for (const row of rows) {
    for (const field of schema?.list?.fields || []) {
      const value = String(row[field.name] ?? "").trim();
      if (value || field.required) out.push([field.name, value]);
    }
  }
  return out;
}

/** A piece's values back as the form holds them: `{ top, rows }` (a row starts at each first list field). */
export function formValues(schema, values = []) {
  const top = {};
  const rows = [];
  const listNames = (schema?.list?.fields || []).map((field) => field.name);
  for (const [name, value] of values) {
    if (!listNames.includes(name)) { top[name] = value; continue; }
    if (name === listNames[0] || !rows.length) rows.push({});
    rows[rows.length - 1][name] = value;
  }
  return { top, rows };
}

/** The address she knows for a video the piece holds by id. */
export function videoLink(provider, id) {
  const value = String(id || "").trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (!value) return "";
  return provider === "vimeo" ? `https://vimeo.com/${value}` : `https://www.youtube.com/watch?v=${value}`;
}

/** Which service a video link is from: "youtube", "vimeo" or "". */
export function videoProvider(url) {
  const value = String(url || "").trim();
  if (/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/)[\w-]{11}|youtu\.be\/[\w-]{11})/i.test(value)) return "youtube";
  if (/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?\d{1,12}(?:[/?#]|$)/i.test(value)) return "vimeo";
  return "";
}

const inRange = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/**
 * The place a map link points at: `{ lat, lon }`, or `{ problem: "short" | "none" | "range" }`.
 * OpenStreetMap (`#map=15/38.93/-79.85`, `?mlat=…&mlon=…`) and Google Maps (`/@38.93,-79.85,15z`,
 * `!3d38.93!4d-79.85`, `?q=38.93,-79.85`) links say where; their short links don't.
 */
export function coordsFromMapLink(link) {
  const value = String(link || "").trim();
  if (!value) return { problem: "none" };
  if (/^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|osm\.org\/go)\//i.test(value)) return { problem: "short" };
  const pairs = [
    /[?&]mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/,
    /#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of pairs) {
    const match = pattern.exec(value);
    if (!match) continue;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    return inRange(lat, lon) ? { lat: round(lat), lon: round(lon) } : { problem: "range" };
  }
  return { problem: "none" };
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** "38.93, −79.85" for "Found it: …". */
export const placeWords = ({ lat, lon }) => `${lat.toFixed(2)}, ${lon.toFixed(2).replace("-", "−")}`;

/**
 * Where a button or link goes, as an address: one of her posts (its address), another website,
 * an email or a phone number. `{ href }` or `{ problem: "email" | "phone" | "address" | "empty" }`.
 */
export function hrefFor(kind, value) {
  const text = String(value || "").trim();
  if (!text) return { problem: "empty" };
  if (kind === "email") {
    const address = text.replace(/^mailto:/i, "");
    return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;.]+$/.test(address) ? { href: `mailto:${address}` } : { problem: "email" };
  }
  if (kind === "phone") {
    const number = text.replace(/^tel:/i, "");
    const digits = (number.match(/\d/g) || []).length;
    return /^[\d +\-().]+$/.test(number) && digits >= 3 && digits <= 20 ? { href: `tel:${number.replace(/[^\d+\-().]/g, "")}` } : { problem: "phone" };
  }
  if (kind === "post") return text.startsWith("/") ? { href: text } : { problem: "address" };
  if (kind === "any") return /^(?:https:\/\/[^\s/]+|\/|#|mailto:\S|tel:[\d+\-().]+$)/i.test(text) && !/\s/.test(text) ? { href: text } : { problem: "address" };
  return /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(text) ? { href: text } : { problem: "address" };
}

/** Which "Where it goes" choice an address is, to fill the form back in. */
export function hrefKind(href) {
  const text = String(href || "");
  if (/^mailto:/i.test(text)) return { kind: "email", value: text.slice(7) };
  if (/^tel:/i.test(text)) return { kind: "phone", value: text.slice(4) };
  if (text.startsWith("/")) return { kind: "post", value: text };
  if (/^https:\/\//i.test(text)) return { kind: "website", value: text };
  return { kind: "any", value: text };
}

/**
 * A refusal from POST pieces as `[{ field, item, code, max }]`: the coded `issues` (G44), or, from
 * an older server, its sentences matched to a field and a code as well as they can be.
 */
export function pieceProblems(data) {
  if (Array.isArray(data?.issues)) {
    return data.issues.filter((p) => p && typeof p === "object").map((p) => ({
      field: typeof p.field === "string" ? p.field : "", item: Number.isInteger(p.item) ? p.item : null,
      code: String(p.code || "invalid"), max: Number.isInteger(p.max) ? p.max : null, message: String(p.message || ""),
    }));
  }
  return (Array.isArray(data?.problems) ? data.problems : []).map((message) => pieceProblem(String(message)));
}

/** One sentence from an older server, as `{ field, code, message }`. */
export function pieceProblem(message) {
  const text = String(message);
  const quoted = /^`([a-z][a-z-]*)`/.exec(text)?.[1] || "";
  const named = [["button label", "label"], ["button address", "href"], ["image address", "src"], ["alt text", "alt"], ["video title", "title"], ["link label", "label"],
    ["link address", "href"], ["the text", "body"], ["an answer", "answer"], ["question", "question"], ["days", "days"], ["hours", "hours"], ["email", "email"], ["phone", "phone"], ["caption", "caption"]]
    .find(([words]) => text.startsWith(words) || text.includes(`(${words})`))?.[1] || "";
  const field = quoted || named || (/video id/.test(text) ? "video" : /^lat /.test(text) ? "lat" : /^lon /.test(text) ? "lon" : "");
  const code = /HTML tags/.test(text) ? "html" : /is required|needs|add at least|add an email/.test(text) ? "required"
    : /the most is|longer than/.test(text) ? "too-long" : /one line/.test(text) ? "one-line" : /video id/.test(text) ? "bad-video"
      : /email is not/.test(text) ? "bad-email" : /phone holds/.test(text) ? "bad-phone" : /must be from/.test(text) ? "out-of-range"
        : /must be one of/.test(text) ? "bad-choice" : /not a field/.test(text) ? "unknown-field" : /not a piece/.test(text) ? "unknown-kind"
          : /address|https/.test(text) ? "bad-address" : "invalid";
  const max = /the most is (\d+)|longer than (\d+)/.exec(text);
  return { field, item: null, code, max: max ? Number(max[1] || max[2]) : null, message: text };
}

/** Problems that belong at the top of the form, not beside a field. */
export const BANNER_CODES = new Set(["unknown-kind", "unknown-field", "repeated", "too-large", "too-many", "bad-request", "invalid"]);

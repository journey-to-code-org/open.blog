// Gifts under the tree (Studio slice 3b): what a gift may hold, when it opens, and the form token
// that keeps robots out. Shared by the gifts function and its tests; nothing here touches storage.
//
// A gift is a note (plain words) or a card. A card is data from fixed lists, never markup: one of
// the designs, a message and a sign-off in plain words, and up to eight stickers, each a kind from
// the list placed on a 0-100 grid. Studio and the guest's page draw it from that data with text
// nodes, so nothing a guest writes is ever HTML.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CardError, oneLine, zonedInstant } from "./greeting-card.mjs";

export { CardError };

export const LIMITS = Object.freeze({ from: 40, note: 1000, message: 300, signOff: 40, stickers: 8, perVisitorPerHour: 5, triesPerHour: 10, perSeason: 200 });
export const WRAPS = Object.freeze(["red", "green", "gold", "blue", "plaid", "stripes"]);
export const DESIGNS = Object.freeze(["snowy-night", "candy-stripe", "holly", "gingerbread", "starry"]);
export const STICKERS = Object.freeze(["star", "heart", "snowflake", "candy-cane", "bell", "mitten", "cookie", "ornament", "holly", "gift"]);

const text = (value) => String(value ?? "");
/** Paragraphs kept, control characters out, trimmed. */
const words = (value, max) => text(value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F\u2028\u2029]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** How the family types the password: case, spaces and punctuation don't matter. */
export const normalizeCode = (value) => text(value).toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");

export function sameCode(given, wanted) {
  const a = Buffer.from(normalizeCode(given));
  const b = Buffer.from(normalizeCode(wanted));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** The card a guest made, checked and rebuilt from known fields. Throws CardError naming the field. */
export function checkCardData(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CardError(422, "card-required", "card");
  const design = text(input.design);
  if (!DESIGNS.includes(design)) throw new CardError(422, "unknown-design", "design");
  const message = words(input.message);
  if (message.length < 1 || message.length > LIMITS.message) throw new CardError(422, "message-length", "message");
  const signOff = oneLine(input.signOff, LIMITS.signOff + 1);
  if (signOff.length > LIMITS.signOff) throw new CardError(422, "sign-off-length", "signOff");
  const list = Array.isArray(input.stickers) ? input.stickers : [];
  if (list.length > LIMITS.stickers) throw new CardError(422, "too-many-stickers", "stickers");
  const stickers = list.map((sticker) => {
    const kind = text(sticker?.kind);
    const x = Number(sticker?.x);
    const y = Number(sticker?.y);
    if (!STICKERS.includes(kind) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 100 || y < 0 || y > 100) {
      throw new CardError(422, "bad-sticker", "stickers");
    }
    return { kind, x, y };
  });
  return { design, message, signOff, stickers };
}

/** A gift as a guest sent it, checked. */
export function checkGift(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CardError(400, "malformed");
  const from = oneLine(input.from, LIMITS.from + 1);
  if (from.length < 1 || from.length > LIMITS.from) throw new CardError(422, "from-length", "from");
  const wrap = WRAPS.includes(text(input.wrap)) ? text(input.wrap) : "red";
  const showName = input.showName === true;
  const kind = text(input.kind);
  if (kind === "note") {
    const note = words(input.note);
    if (note.length < 1 || note.length > LIMITS.note) throw new CardError(422, "note-length", "note");
    return { from, wrap, showName, kind, note, card: null };
  }
  if (kind === "card") return { from, wrap, showName, kind, note: null, card: checkCardData(input.card) };
  throw new CardError(422, "kind", "kind");
}

/** Days after the opening day that a gift left then opens at once (December 25 to January 6). */
export const LATE_DAYS = 13;

/**
 * When a gift left at `now` opens: the next opening day (December 25 unless `monthDay` says
 * otherwise, for a rehearsal) at midnight in `zone`. One left from that day through January 6 opens
 * at once: nobody should wait a year for a late present.
 */
export function opensAt(now, zone, monthDay = "12-25") {
  const [month, day] = monthDay.split("-").map(Number);
  const nowDate = new Date(now);
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric" }).format(nowDate));
  for (const y of [year - 1, year]) {
    const opening = zonedInstant({ year: y, month, day }, 0, zone);
    const lateEnd = zonedInstant({ year: y, month, day: day + LATE_DAYS }, 0, zone);
    if (nowDate >= opening && nowDate < lateEnd) return nowDate;
    if (nowDate < opening) return opening;
  }
  return zonedInstant({ year: year + 1, month, day }, 0, zone);
}

/** The family password as the family types it: at least 6 letters or digits once tidied. */
export function checkFamilyCode(value) {
  const code = text(value).trim().replace(/\s+/g, " ");
  if (normalizeCode(code).length < 6 || code.length > 80) throw new CardError(422, "family-code-length", "familyCode");
  return code;
}

/**
 * The form token: proof a person had the gift form open for a little while before sending it.
 * `ts.nonce.mac`, signed with a key derived from the admin key; good from 3 seconds to 2 hours.
 */
const formKey = (secret) => createHmac("sha256", text(secret)).update("openblog-gifts-form").digest();
export function makeFormToken(secret, now = Date.now()) {
  const body = `${Math.floor(now / 1000)}.${randomBytes(9).toString("base64url")}`;
  return `${body}.${createHmac("sha256", formKey(secret)).update(body).digest("base64url")}`;
}
export function checkFormToken(token, secret, now = Date.now(), { minSeconds = 3, maxSeconds = 2 * 60 * 60 } = {}) {
  const parts = text(token).split(".");
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const want = Buffer.from(createHmac("sha256", formKey(secret)).update(body).digest("base64url"));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  const age = Math.floor(now / 1000) - Number(parts[0]);
  return Number.isFinite(age) && age >= minSeconds && age <= maxSeconds;
}

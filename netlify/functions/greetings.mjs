// Greeting cards, the owner's side (ADR 0411): the address book and the cards, for Admin only.
//
// Every route needs the greetings admin key; nothing here is public. Routes under /api/greetings/:
//   GET status | GET contacts | POST contacts | POST contacts/<id> | POST contacts/<id>/remove
//   GET cards | POST cards | POST cards/<id> | POST cards/<id>/cancel | POST preview | POST test
// Replies are rebuilt from known fields; errors are fixed codes.

import { timingSafeEqual } from "node:crypto";
import { CardError, DESIGNS, LIMITS, checkCard, checkContact, isUuid, nextSendAt, renderCard } from "../lib/greeting-card.mjs";
import { brevoTransport, createGreetingStore, greetingSettings } from "../lib/greeting-store.mjs";

const SECURITY = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (statusCode, value) => ({ statusCode, headers: { ...SECURITY, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(value) });
const lower = (headers) => Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
const sameKey = (given, wanted) => {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(wanted || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};
const MAX_BODY = 32 * 1024;

const contactOut = (row) => ({ id: row.id, name: row.name, email: row.email, birthday: row.birthday || null });
const cardOut = (row) => ({
  id: row.id,
  contactId: row.contact_id,
  design: row.design,
  subject: row.subject,
  message: row.message,
  signOff: row.sign_off || "",
  sendOn: row.send_on,
  hour: row.send_hour,
  timeZone: row.time_zone,
  yearly: row.yearly === true,
  status: row.status,
  nextSendAt: row.next_send_at,
  lastSentAt: row.last_sent_at || null,
  attempts: Number(row.attempts) || 0,
  error: row.error_code || null,
});
const cardRow = (card, next) => ({
  contact_id: card.contactId,
  design: card.design,
  subject: card.subject,
  message: card.message,
  sign_off: card.signOff,
  send_on: card.sendOn,
  send_hour: card.hour,
  time_zone: card.timeZone,
  yearly: card.yearly,
  next_send_at: next.toISOString(),
  status: "scheduled",
  attempts: 0,
  error_code: null,
});

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), transport = null } = {}) {
  return async (event) => {
    const settings = greetingSettings(env);
    if (!settings.enabled) return json(404, { error: "not-enabled" });
    const headers = lower(event.headers);
    const bearer = String(headers.authorization || "").replace(/^Bearer /i, "");
    if (!sameKey(bearer, settings.adminKey)) return json(401, { error: "unauthorized" });
    const method = String(event.httpMethod || "GET").toUpperCase();
    const segments = String(event.path || "").split("/").filter(Boolean);
    const parts = segments.slice(segments.lastIndexOf("greetings") + 1);
    const store = createGreetingStore({ settings, fetchImpl, now });
    const send = transport || brevoTransport({ apiKey: settings.apiKey, fetchImpl });
    const input = () => {
      if (String(event.body || "").length > MAX_BODY) throw new CardError(413, "too-large");
      try {
        const value = JSON.parse(event.body || "{}");
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        // falls through
      }
      throw new CardError(400, "malformed");
    };
    const known = (id) => {
      if (!isUuid(id)) throw new CardError(404, "not-found");
      return id;
    };
    const contactFor = async (id) => {
      const contact = await store.contact(known(id));
      if (!contact) throw new CardError(400, "contact-required", "contactId");
      return contact;
    };

    try {
      const [first, second, third] = parts;
      if (method === "GET" && first === "status" && parts.length === 1) {
        return json(200, {
          enabled: true,
          timeZone: settings.zone,
          from: settings.from,
          designs: Object.entries(DESIGNS).map(([id, d]) => ({ id, label: d.label, subject: d.subject })),
          limits: LIMITS,
        });
      }
      if (first === "contacts") {
        if (method === "GET" && parts.length === 1) return json(200, { contacts: (await store.contacts()).map(contactOut) });
        if (method === "POST" && parts.length === 1) {
          if ((await store.contacts()).length >= LIMITS.contacts) throw new CardError(409, "too-many");
          return json(200, { contact: contactOut(await store.addContact(checkContact(input()))) });
        }
        if (method === "POST" && parts.length === 2) {
          const row = await store.updateContact(known(second), checkContact(input()));
          if (!row) throw new CardError(404, "not-found");
          return json(200, { contact: contactOut(row) });
        }
        if (method === "POST" && parts.length === 3 && third === "remove") {
          await store.removeContact(known(second));
          return json(200, { removed: true });
        }
      }
      if (first === "cards") {
        if (method === "GET" && parts.length === 1) return json(200, { cards: (await store.cards()).map(cardOut) });
        if (method === "POST" && parts.length === 1) {
          const card = checkCard(input(), settings.zone);
          await contactFor(card.contactId);
          if ((await store.cards()).length >= LIMITS.cards) throw new CardError(409, "too-many");
          const next = nextSendAt({ sendOn: card.sendOn, hour: card.hour, zone: card.timeZone, yearly: card.yearly }, now());
          return json(200, { card: cardOut(await store.addCard(cardRow(card, next))) });
        }
        if (method === "POST" && parts.length === 2) {
          const card = checkCard(input(), settings.zone);
          await contactFor(card.contactId);
          const next = nextSendAt({ sendOn: card.sendOn, hour: card.hour, zone: card.timeZone, yearly: card.yearly }, now());
          // A card on its way out can't be changed under the sender.
          const row = await store.updateCard(known(second), cardRow(card, next), { onlyStatus: ["scheduled", "failed", "sent"] });
          if (!row) throw new CardError(409, "busy");
          return json(200, { card: cardOut(row) });
        }
        if (method === "POST" && parts.length === 3 && third === "cancel") {
          const row = await store.updateCard(known(second), { status: "cancelled" }, { onlyStatus: ["scheduled", "failed", "sent"] });
          if (!row) throw new CardError(409, "busy");
          return json(200, { cancelled: true });
        }
      }
      if ((first === "preview" || first === "test") && method === "POST" && parts.length === 1) {
        const value = input();
        const card = checkCard(value, settings.zone);
        const contact = await contactFor(card.contactId);
        const at = nextSendAt({ sendOn: card.sendOn, hour: card.hour, zone: card.timeZone, yearly: card.yearly }, now());
        const sendDay = new Intl.DateTimeFormat("en-CA", { timeZone: card.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
        const mail = renderCard(card, { contact, from: settings.from, siteUrl: settings.siteUrl, siteName: settings.siteName, sendDay });
        if (first === "preview") return json(200, { subject: mail.subject, html: mail.html, sendsAt: at.toISOString() });
        // A test goes to the owner's own sending address, never to the person on the card.
        const result = await send({ ...mail, subject: `[Test] ${mail.subject}`, to: { email: settings.from.email, name: settings.from.name || settings.from.email } });
        return result.ok ? json(200, { sent: true, to: settings.from.email }) : json(502, { error: "send-failed", code: result.code });
      }
      return json(404, { error: "not-found" });
    } catch (error) {
      if (error instanceof CardError) return json(error.status, { error: error.code, field: error.field });
      return json(500, { error: "failed" });
    }
  };
}

export const handler = createHandler();

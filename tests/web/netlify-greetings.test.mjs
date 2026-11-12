// Greeting cards (ADR 0411): the card checks and email, the owner's API, and the hourly sender, all
// against an in-memory stand-in for Supabase and a fake email service.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { ageOn, checkCard, checkContact, nextSendAt, renderCard, zonedInstant } from "../../netlify/lib/greeting-card.mjs";
import { brevoTransport, greetingSettings } from "../../netlify/lib/greeting-store.mjs";
import { createHandler } from "../../netlify/functions/greetings.mjs";
import { createRun } from "../../netlify/functions/greetings-send.mjs";

const ADMIN = "g".repeat(40);
const ENV = {
  OPENBLOG_GREETINGS_ENABLED: "true",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_" + "k".repeat(30),
  OPENBLOG_SITE_ID: "grammis-house",
  OPENBLOG_SITE_ORIGIN: "https://family.example",
  OPENBLOG_SITE_BASE_PATH: "/grammis-house/",
  OPENBLOG_SITE_NAME: "Grammi's House",
  OPENBLOG_GREETINGS_ADMIN_KEY: ADMIN,
  BREVO_API_KEY: "xkeysib-" + "b".repeat(30),
  OPENBLOG_GREETINGS_FROM: "Grammi <grammi@family.example>",
  OPENBLOG_GREETINGS_TIME_ZONE: "America/New_York",
};

// Just enough of PostgREST for the store: eq / in / lte / neq filters, one `or` of the shape the
// sender uses, insert, patch and delete, each answering with the rows it touched.
function fakeSupabase() {
  const tables = { openblog_greeting_contacts: [], openblog_greeting_cards: [] };
  const matches = (row, params) => {
    for (const [key, raw] of params) {
      if (["select", "order", "limit"].includes(key)) continue;
      if (key === "or") {
        const stale = /updated_at\.lt\.([^)]+)\)/.exec(raw)[1];
        if (!(row.status === "scheduled" || (row.status === "sending" && row.updated_at < stale))) return false;
        continue;
      }
      const [op, ...rest] = raw.split(".");
      const value = rest.join(".");
      const have = row[key] === null || row[key] === undefined ? "null" : String(row[key]);
      if (op === "eq" && have !== value) return false;
      if (op === "neq" && have === value) return false;
      if (op === "lte" && !(have <= value)) return false;
      if (op === "in" && !value.slice(1, -1).split(",").includes(have)) return false;
    }
    return true;
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop();
    const rows = tables[table];
    const params = [...u.searchParams.entries()];
    const method = init.method || "GET";
    const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (method === "GET") return reply(rows.filter((r) => matches(r, params)).sort((a, b) => String(a.next_send_at ?? a.name).localeCompare(String(b.next_send_at ?? b.name))));
    if (method === "POST") {
      const at = new Date().toISOString();
      const row = { id: randomUUID(), created_at: at, updated_at: at, attempts: 0, last_sent_at: null, error_code: null, ...JSON.parse(init.body) };
      rows.push(row);
      return reply([row], 201);
    }
    if (method === "PATCH") {
      const touched = rows.filter((r) => matches(r, params));
      for (const r of touched) Object.assign(r, JSON.parse(init.body));
      return reply(touched);
    }
    if (method === "DELETE") {
      const keep = rows.filter((r) => !matches(r, params));
      const gone = rows.filter((r) => matches(r, params)).map((r) => r.id);
      tables[table] = keep;
      if (table === "openblog_greeting_contacts") tables.openblog_greeting_cards = tables.openblog_greeting_cards.filter((c) => !gone.includes(c.contact_id));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${method}`);
  };
  return { tables, fetchImpl };
}

function owner(db, { now = () => Date.parse("2026-11-12T20:00:00Z"), transport } = {}) {
  const handler = createHandler({ env: ENV, fetchImpl: db.fetchImpl, now, transport });
  return async (method, path, body) => {
    const reply = await handler({ httpMethod: method, path: `/api/greetings/${path}`, headers: { authorization: `Bearer ${ADMIN}` }, body: body ? JSON.stringify(body) : "" });
    return { status: reply.statusCode, body: JSON.parse(reply.body) };
  };
}

test("a card goes out at the hour on the wall clock where Grammi lives, daylight saving or not", () => {
  assert.equal(zonedInstant({ year: 2026, month: 11, day: 27 }, 8, "America/New_York").toISOString(), "2026-11-27T13:00:00.000Z");
  assert.equal(zonedInstant({ year: 2027, month: 4, day: 9 }, 8, "America/New_York").toISOString(), "2027-04-09T12:00:00.000Z");
  const now = Date.parse("2026-11-12T20:00:00Z");
  // A yearly card whose day has passed this year waits for next year.
  assert.equal(nextSendAt({ sendOn: "1999-10-04", hour: 8, zone: "America/New_York", yearly: true }, now).toISOString(), "2027-10-04T12:00:00.000Z");
  assert.equal(nextSendAt({ sendOn: "1999-11-27", hour: 8, zone: "America/New_York", yearly: true }, now).toISOString(), "2026-11-27T13:00:00.000Z");
  // After it's sent, the next one is a year on.
  const sent = Date.parse("2026-11-27T13:00:00Z");
  assert.equal(nextSendAt({ sendOn: "1999-11-27", hour: 8, zone: "America/New_York", yearly: true, after: sent }, sent + 60_000).toISOString(), "2027-11-27T13:00:00.000Z");
  // February 29 comes round on the 28th in other years.
  assert.equal(nextSendAt({ sendOn: "2000-02-29", hour: 9, zone: "UTC", yearly: true }, now).toISOString(), "2027-02-28T09:00:00.000Z");
});

test("names, addresses and words are checked, and the email holds them only as text", () => {
  assert.deepEqual(checkContact({ name: " Kristin ", email: "Kristin@Example.com", birthday: "1999-11-27" }), { name: "Kristin", email: "kristin@example.com", birthday: "1999-11-27" });
  assert.throws(() => checkContact({ name: "K", email: "not an address" }), /invalid-email/);
  assert.throws(() => checkContact({ name: "K", email: "k@example.com", birthday: "1999-02-30" }), /invalid-day/);
  assert.throws(() => checkCard({ design: "nope", contactId: randomUUID(), message: "hi", sendOn: "2026-11-27" }), /invalid-design/);
  assert.equal(ageOn("1999-11-27", "2026-11-27"), 27);
  assert.equal(ageOn("1999-11-27", "2026-11-26"), 26);
  const card = checkCard({ design: "birthday", contactId: randomUUID(), message: "Happy {age}th, {name}!\n\n<script>alert(1)</script>", signOff: "Love, Grammi", sendOn: "2026-11-27" }, "America/New_York");
  assert.equal(card.subject, "Happy birthday, {name}!", "a card with no subject takes its design's");
  const mail = renderCard(card, { contact: { name: "Kristin Smith", email: "k@example.com", birthday: "1999-11-27" }, from: { email: "g@example.com" }, siteUrl: "https://family.example/grammis-house/", siteName: "Grammi's House", sendDay: "2026-11-27" });
  assert.equal(mail.subject, "Happy birthday, Kristin!");
  assert.match(mail.text, /Happy 27th, Kristin!/);
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /Love, Grammi/);
  assert.match(mail.html, /href="https:\/\/family\.example\/grammis-house\/"/);
});

test("greeting cards stay off until every setting is there, and say which are missing", () => {
  assert.deepEqual(greetingSettings({}), { enabled: false, problems: [] });
  const half = greetingSettings({ ...ENV, BREVO_API_KEY: "", OPENBLOG_GREETINGS_FROM: "not an address" });
  assert.equal(half.enabled, false);
  assert.deepEqual(half.problems, ["BREVO_API_KEY", "OPENBLOG_GREETINGS_FROM"]);
  const on = greetingSettings(ENV);
  assert.deepEqual(on.from, { name: "Grammi", email: "grammi@family.example" });
  assert.equal(on.siteUrl, "https://family.example/grammis-house/");
});

test("only the owner's key opens the API", async () => {
  const db = fakeSupabase();
  const handler = createHandler({ env: ENV, fetchImpl: db.fetchImpl });
  const reply = await handler({ httpMethod: "GET", path: "/api/greetings/contacts", headers: { authorization: "Bearer " + "x".repeat(40) } });
  assert.equal(reply.statusCode, 401);
  const off = await createHandler({ env: {}, fetchImpl: db.fetchImpl })({ httpMethod: "GET", path: "/api/greetings/contacts", headers: {} });
  assert.equal(off.statusCode, 404);
});

test("the owner keeps an address book and schedules a yearly birthday card", async () => {
  const db = fakeSupabase();
  const api = owner(db);
  const status = await api("GET", "status");
  assert.equal(status.body.timeZone, "America/New_York");
  assert.ok(status.body.designs.some((d) => d.id === "birthday"));

  const added = await api("POST", "contacts", { name: "Kristin", email: "kristin@example.com", birthday: "1999-11-27" });
  assert.equal(added.status, 200);
  const id = added.body.contact.id;
  const bad = await api("POST", "contacts", { name: "", email: "x@example.com" });
  assert.deepEqual([bad.status, bad.body.field], [400, "name"]);

  const card = { contactId: id, design: "birthday", message: "Happy birthday, {name}! Love you to pieces.", signOff: "Love, Grammi", sendOn: "1999-11-27", hour: 8, yearly: true };
  const preview = await api("POST", "preview", card);
  assert.equal(preview.body.subject, "Happy birthday, Kristin!");
  assert.equal(preview.body.sendsAt, "2026-11-27T13:00:00.000Z");
  const scheduled = await api("POST", "cards", card);
  assert.equal(scheduled.body.card.nextSendAt, "2026-11-27T13:00:00.000Z");
  assert.equal(scheduled.body.card.status, "scheduled");
  const list = await api("GET", "cards");
  assert.equal(list.body.cards.length, 1);

  // Cancelling takes it off the list; removing the person removes their cards.
  const second = await api("POST", "cards", { ...card, design: "christmas", sendOn: "2026-12-25", yearly: false });
  await api("POST", `cards/${second.body.card.id}/cancel`, {});
  assert.equal((await api("GET", "cards")).body.cards.length, 1);
  await api("POST", `contacts/${id}/remove`, {});
  assert.equal((await api("GET", "cards")).body.cards.length, 0);
});

test("a test card goes to Grammi herself, never to the person on it", async () => {
  const db = fakeSupabase();
  const sent = [];
  const api = owner(db, { transport: async (mail) => (sent.push(mail), { ok: true, id: "m1" }) });
  const id = (await api("POST", "contacts", { name: "Kaylee", email: "kaylee@example.com" })).body.contact.id;
  const reply = await api("POST", "test", { contactId: id, design: "just-because", message: "Hi {name}", sendOn: "2027-02-22" });
  assert.deepEqual(reply.body, { sent: true, to: "grammi@family.example" });
  assert.equal(sent[0].to.email, "grammi@family.example");
  assert.equal(sent[0].subject, "[Test] A note for you, Kaylee");
});

test("the hourly run sends what's due once, moves a yearly card to next year, and retries a failure", async () => {
  const db = fakeSupabase();
  let clock = Date.parse("2026-11-12T20:00:00Z");
  const now = () => clock;
  const sent = [];
  let outcome = { ok: true, id: "m" };
  const transport = async (mail) => (sent.push(mail), outcome);
  const api = owner(db, { now, transport });
  const kristin = (await api("POST", "contacts", { name: "Kristin", email: "kristin@example.com", birthday: "1999-11-27" })).body.contact.id;
  await api("POST", "cards", { contactId: kristin, design: "birthday", message: "Happy {age}th!", sendOn: "1999-11-27", yearly: true });
  await api("POST", "cards", { contactId: kristin, design: "thanksgiving", message: "Save me a plate.", sendOn: "2026-11-26", hour: 9 });
  const run = createRun({ env: ENV, fetchImpl: db.fetchImpl, now, transport });

  assert.deepEqual(await run(), { enabled: true, sent: 0, failed: 0, retrying: 0, skipped: 0 }, "nothing is due yet");

  clock = Date.parse("2026-11-26T14:30:00Z");
  outcome = { ok: false, code: "provider-error" };
  assert.equal((await run()).retrying, 1);
  const thanksgiving = db.tables.openblog_greeting_cards.find((c) => c.design === "thanksgiving");
  assert.deepEqual([thanksgiving.status, thanksgiving.attempts, thanksgiving.error_code], ["scheduled", 1, "provider-error"]);

  outcome = { ok: true, id: "m" };
  assert.equal((await run()).sent, 1);
  assert.equal(thanksgiving.status, "sent");
  assert.equal((await run()).sent, 0, "a sent card is never sent again");

  clock = Date.parse("2026-11-27T13:05:00Z");
  assert.equal((await run()).sent, 1);
  const birthday = db.tables.openblog_greeting_cards.find((c) => c.design === "birthday");
  assert.equal(birthday.status, "scheduled");
  assert.equal(birthday.next_send_at, "2027-11-27T13:00:00.000Z");
  assert.equal(sent.at(-1).subject, "Happy birthday, Kristin!");
  assert.match(sent.at(-1).text, /Happy 27th!/);
  assert.equal(sent.at(-1).to.email, "kristin@example.com");
});

test("a refused key stops at once instead of trying all night", async () => {
  const db = fakeSupabase();
  let clock = Date.parse("2026-11-12T20:00:00Z");
  const now = () => clock;
  const transport = async () => ({ ok: false, code: "refused-key" });
  const api = owner(db, { now, transport });
  const id = (await api("POST", "contacts", { name: "Jimmy", email: "jimmy@example.com" })).body.contact.id;
  await api("POST", "cards", { contactId: id, design: "just-because", message: "Hi", sendOn: "2026-11-13" });
  clock = Date.parse("2026-11-13T15:00:00Z");
  const report = await createRun({ env: ENV, fetchImpl: db.fetchImpl, now, transport })();
  assert.equal(report.failed, 1);
  assert.equal(db.tables.openblog_greeting_cards[0].status, "failed");
});

test("Brevo is called the way its API asks, and its answers become fixed codes", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push({ url, init }), new Response(JSON.stringify({ messageId: "<abc@brevo>" }), { status: 201 }));
  const send = brevoTransport({ apiKey: "xkeysib-key", fetchImpl });
  const result = await send({ from: { name: "Grammi", email: "g@example.com" }, to: { email: "k@example.com", name: "Kristin" }, subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
  assert.deepEqual(result, { ok: true, id: "<abc@brevo>" });
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(calls[0].init.headers["api-key"], "xkeysib-key");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.sender, { name: "Grammi", email: "g@example.com" });
  assert.deepEqual(body.to, [{ email: "k@example.com", name: "Kristin" }]);
  for (const [status, code] of [[401, "refused-key"], [400, "rejected"], [429, "rate-limited"], [503, "provider-error"]]) {
    const reply = await brevoTransport({ apiKey: "k", fetchImpl: async () => new Response("{}", { status }) })({ from: {}, to: {}, subject: "", html: "", text: "" });
    assert.deepEqual(reply, { ok: false, code });
  }
});

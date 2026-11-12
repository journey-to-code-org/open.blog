import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../../netlify/functions/quote.mjs";
import { issueToken } from "../../netlify/lib/quote-intake.mjs";
import { INLINE_BUDGET_MS, composeMessage, notifySettings, resendTransport } from "../../netlify/lib/quote-notify.mjs";

const SECRET = "q".repeat(40);
const ADMIN = "a".repeat(40);
const ENV = {
  OPENBLOG_QUOTE_ENABLED: "true",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_" + "k".repeat(30),
  OPENBLOG_SITE_ID: "acme",
  OPENBLOG_SITE_ORIGIN: "https://acme.example",
  OPENBLOG_QUOTE_SECRET: SECRET,
  OPENBLOG_QUOTE_ADMIN_KEY: ADMIN,
};
const MAIL = {
  OPENBLOG_QUOTE_NOTIFY_PROVIDER: "resend",
  OPENBLOG_QUOTE_NOTIFY_API_KEY: "re_" + "x".repeat(20),
  OPENBLOG_QUOTE_NOTIFY_TO: "owner@acme.example",
  OPENBLOG_QUOTE_NOTIFY_FROM: "Acme <quotes@acme.example>",
};
const good = { name: "Pat Smith", phone: "+1 360 555 0142", town: "Bend, OR", service: "Fencing", description: "Replace forty feet of cedar fence.", email: "pat@example.com" };

function fakeSupabase() {
  const rows = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const reply = (status, body = "", headers = {}) => new Response(body, { status, headers });
    if (u.pathname.startsWith("/storage/")) return reply(200, "{}");
    if (init.method === "POST") {
      rows.push({ ...JSON.parse(init.body), created_at: new Date().toISOString() });
      return reply(201);
    }
    if (init.method === "PATCH") {
      const id = u.searchParams.get("id").replace("eq.", "");
      Object.assign(rows.find((r) => r.id === id), JSON.parse(init.body));
      return reply(204);
    }
    if (u.searchParams.get("select") === "id") return reply(206, "[]", { "content-range": `0-0/${rows.length}` });
    // Honours the attempt cap, order and limit the store asks for.
    const cap = /^lt\.(\d+)$/.exec(u.searchParams.get("notify_attempts") || "");
    const order = u.searchParams.get("order") || "";
    const found = rows
      .filter((r) => ["failed", "pending"].includes(r.notify_status))
      .filter((r) => !cap || (r.notify_attempts ?? 0) < Number(cap[1]))
      .sort((a, b) => (order.endsWith(".asc") ? 1 : -1) * a.created_at.localeCompare(b.created_at))
      .slice(0, Number(u.searchParams.get("limit") || Infinity));
    return reply(200, JSON.stringify(found), { "content-type": "application/json" });
  };
  return { rows, fetchImpl };
}

function setup({ env = {}, transport, extra = {} } = {}) {
  const fake = fakeSupabase();
  const clock = { now: 1_800_000_000_000 };
  let n = 0;
  const handler = createHandler({ env: { ...ENV, ...env }, fetchImpl: fake.fetchImpl, now: () => clock.now, uuid: () => `00000000-0000-4000-8000-00000000000${++n}`, transport, sleep: async () => {}, ...extra });
  const submit = () => {
    const boundary = "b";
    const body = Object.entries({ ...good, token: issueToken(SECRET, clock.now - 10000) })
      .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
      .join("") + `--${boundary}--\r\n`;
    return handler({ httpMethod: "POST", path: "/api/quote/submit", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, accept: "application/json" }, body });
  };
  const admin = (method, path) => handler({ httpMethod: method, path, headers: { authorization: `Bearer ${ADMIN}` } });
  return { fake, submit, admin, handler };
}

const fakeMailer = (...results) => {
  const sent = [];
  const transport = async (message, key) => {
    sent.push({ message, key });
    return results[Math.min(sent.length - 1, results.length - 1)] ?? { ok: true };
  };
  return { sent, transport };
};

test("notification is off unless a provider is named and complete", () => {
  assert.equal(notifySettings({}).enabled, false);
  assert.deepEqual(notifySettings({ OPENBLOG_QUOTE_NOTIFY_PROVIDER: "resend" }).problems, ["OPENBLOG_QUOTE_NOTIFY_API_KEY", "OPENBLOG_QUOTE_NOTIFY_TO", "OPENBLOG_QUOTE_NOTIFY_FROM"]);
  assert.deepEqual(notifySettings({ ...MAIL, OPENBLOG_QUOTE_NOTIFY_PROVIDER: "carrier-pigeon" }).problems, ["OPENBLOG_QUOTE_NOTIFY_PROVIDER"]);
  assert.equal(notifySettings(MAIL).enabled, true);
});

test("without a provider a request is stored and nothing is sent", async () => {
  const mailer = fakeMailer();
  const t = setup({ transport: mailer.transport });
  assert.equal((await t.submit()).statusCode, 201);
  assert.equal(mailer.sent.length, 0);
  assert.equal(t.fake.rows[0].notify_status, "off");
});

test("the owner is told once, at their own address, without the visitor's contact details", async () => {
  const mailer = fakeMailer();
  const t = setup({ env: MAIL, transport: mailer.transport });
  assert.equal((await t.submit()).statusCode, 201);
  assert.equal(mailer.sent.length, 1);
  const { message, key } = mailer.sent[0];
  assert.deepEqual(message.to, ["owner@acme.example"], "never the visitor");
  assert.equal(key, "quote-00000000-0000-4000-8000-000000000001");
  for (const secret of ["555", "pat@example.com", "cedar", "fence."]) assert.ok(!message.text.includes(secret), secret);
  assert.match(message.subject, /Fencing in Bend, OR/);
  assert.equal(t.fake.rows[0].notify_status, "sent");
  assert.equal(t.fake.rows[0].notify_attempts, 1);
});

test("a failing mailer never loses the request, is visible, and is retried a bounded number of times", async () => {
  const mailer = fakeMailer({ ok: false, code: "provider-error", retryable: true });
  const t = setup({ env: MAIL, transport: mailer.transport });
  const response = await t.submit();
  assert.equal(response.statusCode, 201, "the visitor still gets their confirmation");
  assert.equal(t.fake.rows.length, 1);
  assert.equal(t.fake.rows[0].notify_status, "failed");
  assert.equal(t.fake.rows[0].notify_error_code, "provider-error");
  assert.equal(t.fake.rows[0].notify_attempts, 2, "two inline tries");

  const overview = JSON.parse((await t.admin("GET", "/api/quote/notifications")).body);
  assert.deepEqual(overview.notifications.map((n) => [n.status, n.error]), [["failed", "provider-error"]]);
  assert.ok(!JSON.stringify(overview).includes("Pat"), "no visitor value in the overview");

  for (let i = 0; i < 4; i++) await t.admin("POST", "/api/quote/notifications/retry");
  assert.equal(t.fake.rows[0].notify_attempts, 5, "capped at five tries in all");
  const last = JSON.parse((await t.admin("POST", "/api/quote/notifications/retry")).body);
  assert.deepEqual(last, { tried: 0, sent: 0, failed: 0, gaveUp: 0 }, "a row that used every try is not picked again");
  assert.equal(mailer.sent.length, 5);
});

test("a hung mail provider never holds the visitor past the budget: the request is saved, the email marked failed", { timeout: 5000 }, async () => {
  const hung = [];
  const transport = (message) => new Promise(() => hung.push(message));
  const t = setup({ env: MAIL, transport, extra: { notifyBudgetMs: 150 } });
  const started = Date.now();
  const response = await t.submit();
  const waited = Date.now() - started;
  assert.equal(response.statusCode, 201, "the visitor is told the request was received");
  assert.ok(waited < 2000, `answered in ${waited} ms, not after the provider`);
  assert.equal(t.fake.rows.length, 1);
  assert.deepEqual([t.fake.rows[0].notify_status, t.fake.rows[0].notify_error_code, t.fake.rows[0].notify_attempts], ["failed", "timeout", 1], "no second try without time for it");
  assert.equal(hung.length, 1);
});

test("the inline budget is far under a synchronous function's 10 seconds, and the Resend call is aborted within it", () => {
  assert.ok(INLINE_BUDGET_MS <= 5000);
  assert.ok(INLINE_BUDGET_MS + 3000 < 10_000, "room left for storage before and after");
});

test("requests that used every try do not stop a newer failed email from being sent again", async () => {
  const mailer = fakeMailer({ ok: true });
  const t = setup({ env: MAIL, transport: mailer.transport });
  for (let i = 0; i < 30; i++) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    t.fake.rows.push({ id: `old-${i}`, name: "Pat", town: "Bend", service: "Fencing", photos: [], notify_status: "failed", notify_attempts: 5, notify_error_code: "refused-key", created_at: at });
  }
  t.fake.rows.push({ id: "new", name: "Sam", town: "Bend", service: "Fencing", photos: [], notify_status: "failed", notify_attempts: 1, notify_error_code: "refused-key", created_at: "2026-02-01T00:00:00.000Z" });
  const summary = JSON.parse((await t.admin("POST", "/api/quote/notifications/retry")).body);
  assert.deepEqual(summary, { tried: 1, sent: 1, failed: 0, gaveUp: 0 });
  assert.equal(t.fake.rows.find((r) => r.id === "new").notify_status, "sent");
});

test("the notification routes answer Admin in JSON when storage is down", async () => {
  const down = async () => new Response("", { status: 503 });
  const handler = createHandler({ env: { ...ENV, ...MAIL }, fetchImpl: down, transport: fakeMailer().transport, sleep: async () => {} });
  for (const [method, path] of [["GET", "/api/quote/notifications"], ["POST", "/api/quote/notifications/retry"]]) {
    const response = await handler({ httpMethod: method, path, headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(response.statusCode, 503, path);
    assert.match(String(response.headers["content-type"]), /application\/json/, path);
    assert.deepEqual(JSON.parse(response.body), { error: "storage-unavailable" }, path);
  }
});

test("a retry that works settles the row", async () => {
  const mailer = fakeMailer({ ok: false, code: "network", retryable: true }, { ok: false, code: "network", retryable: true }, { ok: true });
  const t = setup({ env: MAIL, transport: mailer.transport });
  await t.submit();
  assert.equal(t.fake.rows[0].notify_status, "failed");
  const summary = JSON.parse((await t.admin("POST", "/api/quote/notifications/retry")).body);
  assert.equal(summary.sent, 1);
  assert.equal(t.fake.rows[0].notify_status, "sent");
});

test("a refused key is not retried inline", async () => {
  const mailer = fakeMailer({ ok: false, code: "refused-key", retryable: false });
  const t = setup({ env: MAIL, transport: mailer.transport });
  await t.submit();
  assert.equal(mailer.sent.length, 1);
  assert.equal(t.fake.rows[0].notify_error_code, "refused-key");
});

test("a mailer that throws does not lose the request either", async () => {
  const t = setup({ env: MAIL, transport: async () => { throw new Error("boom with Pat Smith"); } });
  const response = await t.submit();
  assert.equal(response.statusCode, 201);
  assert.equal(t.fake.rows[0].notify_status, "failed");
  assert.ok(!response.body.includes("boom"));
});

test("the notification routes need the admin key and are otherwise absent", async () => {
  const t = setup({ env: MAIL, transport: fakeMailer().transport });
  const bad = await t.handler({ httpMethod: "GET", path: "/api/quote/notifications", headers: { authorization: "Bearer nope" } });
  assert.equal(bad.statusCode, 401);
  const none = await t.handler({ httpMethod: "GET", path: "/api/quote/notifications", headers: {} });
  assert.equal(none.statusCode, 401);
  const unset = setup({ env: { OPENBLOG_QUOTE_ADMIN_KEY: "" } });
  assert.equal((await unset.handler({ httpMethod: "GET", path: "/api/quote/notifications", headers: { authorization: `Bearer ${ADMIN}` } })).statusCode, 404);
});

test("the Resend transport sends the documented request and maps failures to fixed codes", async () => {
  const calls = [];
  const reply = (status) => async (url, init) => { calls.push({ url, init }); return new Response("{}", { status }); };
  const message = composeMessage({ ...notifySettings(MAIL) }, { id: "x", values: good, photoCount: 0 });
  assert.deepEqual(await resendTransport({ apiKey: "re_k", fetchImpl: reply(200) })(message, "quote-x"), { ok: true });
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers.authorization, "Bearer re_k");
  assert.equal(calls[0].init.headers["idempotency-key"], "quote-x");
  const code = async (status) => (await resendTransport({ apiKey: "k", fetchImpl: reply(status) })(message, "i")).code;
  assert.equal(await code(401), "refused-key");
  assert.equal(await code(429), "rate-limited");
  assert.equal(await code(503), "provider-error");
  assert.equal(await code(422), "rejected");
  const network = await resendTransport({ apiKey: "k", fetchImpl: async () => { throw new Error("secret detail"); } })(message, "i");
  assert.deepEqual(network, { ok: false, code: "network", retryable: true });
});

test("header-unsafe visitor text cannot reach the subject", () => {
  const message = composeMessage(notifySettings(MAIL), { id: "x", values: { ...good, town: "Bend\r\nBcc: evil@x.example", service: "Fence" }, photoCount: 1 });
  assert.ok(!/[\r\n]/.test(message.subject));
});

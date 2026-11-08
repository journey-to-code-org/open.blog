// The quote function as a local service for `openblog serve` (Render; ADR 0387): the same handler,
// reached only on 127.0.0.1, with the event shape the Netlify function takes, a body bound, the
// visitor address only from the open.blog server, and the daily retention sweep.
import assert from "node:assert/strict";
import test from "node:test";

import { createHandler } from "../../netlify/functions/quote.mjs";
import { createQuoteService, scheduleSweep, servicePort } from "../../scripts/quote-service.mjs";

async function listen(handler, options = {}) {
  const server = createQuoteService({ handler, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("a request reaches the function as the event Netlify would send, and its answer comes back", async () => {
  const events = [];
  const { base, close } = await listen(async (event) => {
    events.push(event);
    return { statusCode: 201, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: '{"status":"received"}' };
  });
  try {
    const response = await fetch(`${base}/api/quote/submit?x=1`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-forwarded-for": "203.0.113.9", "x-nf-client-connection-ip": "6.6.6.6" },
      body: "name=Ann&token=t",
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "received" });
    const [event] = events;
    assert.equal(event.httpMethod, "POST");
    assert.equal(event.path, "/api/quote/submit");
    assert.deepEqual(event.queryStringParameters, { x: "1" });
    assert.equal(event.headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(event.headers["x-forwarded-for"], "203.0.113.9");
    assert.equal(event.headers["x-nf-client-connection-ip"], undefined, "only the open.blog server names the visitor");
    assert.equal(Buffer.from(event.body).toString(), "name=Ann&token=t");
    assert.equal((await fetch(`${base}/admin/x`)).status, 404, "nothing but quote addresses");
  } finally {
    await close();
  }
});

test("an oversized body is refused before the function sees it, and a crash is a plain failure", async () => {
  let calls = 0;
  const { base, close } = await listen(async () => {
    calls += 1;
    throw new Error("boom with a secret");
  }, { maxBytes: 100 });
  try {
    const big = await fetch(`${base}/api/quote/submit`, { method: "POST", body: "x".repeat(500) });
    assert.equal(big.status, 413);
    assert.equal(calls, 0);
    const crash = await fetch(`${base}/api/quote/submit`, { method: "POST", body: "x" });
    assert.equal(crash.status, 500);
    assert.ok(!(await crash.text()).includes("secret"));
  } finally {
    await close();
  }
});

test("the real function answers through the service: off by default, and a token when on", async () => {
  const off = await listen(createHandler({ env: {} }));
  try {
    const response = await fetch(`${off.base}/api/quote/token`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not-enabled" });
  } finally {
    await off.close();
  }
  const env = {
    OPENBLOG_QUOTE_ENABLED: "true",
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_" + "k".repeat(30),
    OPENBLOG_SITE_ID: "acme",
    OPENBLOG_SITE_ORIGIN: "https://acme.example",
    OPENBLOG_QUOTE_SECRET: "q".repeat(40),
  };
  const on = await listen(createHandler({ env, fetchImpl: async () => { throw new Error("no network in tests"); } }));
  try {
    const token = await fetch(`${on.base}/api/quote/token`, { headers: { origin: "https://acme.example" } });
    assert.equal(token.status, 200);
    assert.match((await token.json()).token, /\./);
    const other = await fetch(`${on.base}/api/quote/token`, { headers: { origin: "https://evil.example" } });
    assert.equal(other.status, 403, "the same-origin fence is the function's own");
  } finally {
    await on.close();
  }
});

test("the port is read strictly, and the sweep runs soon after start and then daily", async () => {
  assert.equal(servicePort({}), 8788);
  assert.equal(servicePort({ OPENBLOG_QUOTE_SERVICE_PORT: "9100" }), 9100);
  for (const bad of ["80", "abc", "70000", "9100x"]) assert.equal(servicePort({ OPENBLOG_QUOTE_SERVICE_PORT: bad }), null, bad);
  const set = [];
  const timers = { setTimeout: (fn, ms) => (set.push(["once", ms, fn]), {}), setInterval: (fn, ms) => (set.push(["every", ms, fn]), {}) };
  let swept = 0;
  scheduleSweep({ sweep: async () => { swept += 1; throw new Error("storage down"); }, timers });
  assert.deepEqual(set.map(([kind, ms]) => [kind, ms]), [["once", 5 * 60 * 1000], ["every", 24 * 60 * 60 * 1000]]);
  await set[0][2]();
  assert.equal(swept, 1, "a failed sweep waits for the next turn");
});

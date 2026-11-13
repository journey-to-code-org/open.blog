import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { clientAddress, createRestBridge, createService, mintServiceKey, routeFor } from "../../service/server.mjs";

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};

test("routes: greetings and gifts by name, everything else under /api/ is engagement", () => {
  assert.equal(routeFor("/api/greetings/status"), "greetings");
  assert.equal(routeFor("/api/gifts/tree"), "gifts");
  assert.equal(routeFor("/api/comments"), "engagement");
  assert.equal(routeFor("/api/admin/feedback"), "engagement");
  assert.equal(routeFor("/health"), "health");
  assert.equal(routeFor("/admin/"), null);
  assert.equal(routeFor("/rest/v1/openblog_comments"), null);
});

test("the visitor's address comes only from the proxy's X-Real-IP, and only when trusted", () => {
  assert.equal(clientAddress({ "x-real-ip": "203.0.113.9" }, { trustRealIp: true }), "203.0.113.9");
  assert.equal(clientAddress({ "x-real-ip": "203.0.113.9" }, { trustRealIp: false }), "");
  assert.equal(clientAddress({ "x-real-ip": "1.2.3.4<script>" }, { trustRealIp: true }), "");
});

test("the service key is a PostgREST token for service_role signed with the secret", () => {
  const secret = "s".repeat(40);
  const [head, body, signature] = mintServiceKey(secret).split(".");
  assert.equal(JSON.parse(Buffer.from(body, "base64url")).role, "service_role");
  assert.equal(signature, createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url"));
  assert.throws(() => mintServiceKey("short"));
});

test("a request becomes a function event, and a copied client header from outside is dropped", async () => {
  let seen;
  const server = createService({ trustRealIp: true, handlers: { engagement: async (event) => { seen = event; return { statusCode: 201, headers: { "x-test": "1" }, body: "made" }; } } });
  const base = await listen(server);
  const response = await fetch(`${base}/api/comments?path=/x/`, {
    method: "POST", body: '{"a":1}',
    headers: { "x-real-ip": "198.51.100.7", "x-nf-client-connection-ip": "6.6.6.6" },
  });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), "made");
  assert.equal(seen.httpMethod, "POST");
  assert.equal(seen.path, "/api/comments");
  assert.deepEqual(seen.queryStringParameters, { path: "/x/" });
  assert.equal(seen.body, '{"a":1}');
  assert.equal(seen.headers["x-nf-client-connection-ip"], "198.51.100.7");
  server.close();
});

test("too large is 413, unknown is 404, and a throwing function is a plain 500", async () => {
  const server = createService({ maxBytes: 10, handlers: { greetings: async () => { throw new Error("secret detail"); } } });
  const base = await listen(server);
  assert.equal((await fetch(`${base}/api/comments`, { method: "POST", body: "x".repeat(50) })).status, 404);
  const big = await fetch(`${base}/api/greetings/x`, { method: "POST", body: "x".repeat(50) }).catch(() => null);
  assert.ok(!big || big.status === 413);
  const failed = await fetch(`${base}/api/greetings/status`);
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /secret detail/);
  server.close();
});

test("the bridge passes /rest/v1/<x> to PostgREST's /<x> and nothing else", async () => {
  let path;
  const fake = (await import("node:http")).createServer((req, res) => { path = req.url; res.end("[]"); });
  const target = await listen(fake);
  const bridge = createRestBridge({ target });
  const base = await listen(bridge);
  assert.equal(await (await fetch(`${base}/rest/v1/openblog_comments?select=id`)).text(), "[]");
  assert.equal(path, "/openblog_comments?select=id");
  assert.equal((await fetch(`${base}/openblog_comments`)).status, 404);
  bridge.close();
  fake.close();
});

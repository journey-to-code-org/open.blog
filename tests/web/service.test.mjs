import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { clientAddress, createRestBridge, createService, eventBody, mintServiceKey, publicAddress, routeFor } from "../../service/server.mjs";

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};

test("routes: each function by name, everything else under /api/ is engagement", () => {
  assert.equal(routeFor("/api/greetings/status"), "greetings");
  assert.equal(routeFor("/api/gifts/tree"), "gifts");
  assert.equal(routeFor("/api/push/status"), "push");
  assert.equal(routeFor("/api/quote/requests"), "quote");
  assert.equal(routeFor("/api/quote"), "quote");
  assert.equal(routeFor("/api/social/accounts"), "social");
  assert.equal(routeFor("/api/social-worker"), "social-worker");
  assert.equal(routeFor("/api/webmention"), "webmention");
  assert.equal(routeFor("/api/webmention/inbox"), "webmention");
  assert.equal(routeFor("/api/pushy"), "engagement", "a name is a whole segment");
  assert.equal(routeFor("/storage/v1/object/sign/b/a.jpg"), "storage");
  assert.equal(routeFor("/storage/v1/object/b/a.jpg"), null, "only signed links are public");
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
  const big = await fetch(`${base}/api/greetings/x`, { method: "POST", body: "x".repeat(50) });
  assert.equal(big.status, 413, "a reply, not a dropped connection");
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

test("text bodies arrive as text, anything else as base64 with no byte changed", () => {
  assert.deepEqual(eventBody(Buffer.from('{"a":1}'), "application/json"), { body: '{"a":1}', isBase64Encoded: false });
  assert.deepEqual(eventBody(Buffer.from("source=a"), "application/x-www-form-urlencoded"), { body: "source=a", isBase64Encoded: false });
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x80]);
  const multipart = eventBody(bytes, "multipart/form-data; boundary=x");
  assert.equal(multipart.isBase64Encoded, true);
  assert.deepEqual(Buffer.from(multipart.body, "base64"), bytes);
  assert.deepEqual(eventBody(Buffer.alloc(0), "multipart/form-data"), { body: "", isBase64Encoded: false });
});

test("a quote request may be larger than the other functions' bodies", async () => {
  let size = 0;
  const server = createService({ maxBytes: 10, limits: { quote: 1000 }, handlers: { quote: async (event) => { size = Buffer.from(event.body, "base64").length; return { statusCode: 200, body: "" }; }, greetings: async () => ({ statusCode: 200, body: "" }) } });
  const base = await listen(server);
  const ok = await fetch(`${base}/api/quote`, { method: "POST", body: new Uint8Array(500), headers: { "content-type": "multipart/form-data; boundary=x" } });
  assert.equal(ok.status, 200);
  assert.equal(size, 500);
  assert.equal((await fetch(`${base}/api/quote`, { method: "POST", body: "x".repeat(2000) })).status, 413);
  assert.equal((await fetch(`${base}/api/greetings/x`, { method: "POST", body: "x".repeat(50) })).status, 413);
  server.close();
});

test("the service's public address: given, or Railway's domain, and only https", () => {
  assert.equal(publicAddress({ OPENBLOG_SERVICE_PUBLIC_URL: "https://family.example/" }), "https://family.example");
  assert.equal(publicAddress({ RAILWAY_PUBLIC_DOMAIN: "svc.up.railway.app" }), "https://svc.up.railway.app");
  assert.equal(publicAddress({ OPENBLOG_SERVICE_PUBLIC_URL: "http://family.example" }), "");
  assert.equal(publicAddress({ RAILWAY_PUBLIC_DOMAIN: "bad domain" }), "");
});

test("a path no function answers goes to the site when there is one, and is 404 otherwise", async () => {
  const site = (request, response) => { response.writeHead(200); response.end("page"); };
  const withSite = createService({ handlers: {}, site });
  const base = await listen(withSite);
  assert.equal(await (await fetch(`${base}/posts/x/`)).text(), "page");
  assert.equal((await fetch(`${base}/api/gifts/tree`)).status, 404, "an /api/ path never falls through to the site");
  withSite.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { checkToken, createStorage, objectKey, signToken } from "../../service/storage.mjs";
import { createRestBridge, createService } from "../../service/server.mjs";

const SECRET = "s".repeat(40);
const KEY = "service-key";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};
const auth = { authorization: `Bearer ${KEY}` };

test("object keys stay inside the folder", () => {
  assert.equal(objectKey("site/abc/1.jpg"), "site/abc/1.jpg");
  for (const bad of ["", "../x", "a/../b", "/a", "a//b", "a\\b", "a/.hidden", "a/b.type", "a/b\0"]) assert.equal(objectKey(bad), null, bad);
});

test("a signed token opens one object until it expires", () => {
  const token = signToken(SECRET, "b", "a.jpg", 2000);
  assert.ok(checkToken(SECRET, "b", "a.jpg", token, 1999_000));
  assert.ok(!checkToken(SECRET, "b", "a.jpg", token, 2001_000), "expired");
  assert.ok(!checkToken(SECRET, "b", "other.jpg", token, 1999_000), "another object");
  assert.ok(!checkToken("t".repeat(40), "b", "a.jpg", token, 1999_000), "another secret");
  assert.ok(!checkToken(SECRET, "b", "a.jpg", "2000.forged", 1999_000));
});

test("the functions' calls, through the bridge, and a signed link on the public side", async () => {
  const root = await mkdtemp(join(tmpdir(), "storage-"));
  const storage = createStorage({ root, secret: SECRET, serviceKey: KEY });
  const bridge = createRestBridge({ target: "http://127.0.0.1:9", storage });
  const internal = await listen(bridge);
  const service = createService({ handlers: {}, storage });
  const external = await listen(service);
  const bucket = "openblog-quote-photos";
  try {
    assert.equal((await fetch(`${internal}/storage/v1/object/${bucket}/site/r1/1.jpg`, { method: "POST", body: JPEG, headers: { "content-type": "image/jpeg" } })).status, 401, "the service key is required");
    assert.equal((await fetch(`${internal}/storage/v1/object/${bucket}/site/r1/1.jpg`, { method: "POST", body: JPEG, headers: { ...auth, "content-type": "image/jpeg" } })).status, 200);
    assert.equal((await fetch(`${internal}/storage/v1/object/${bucket}/site/r1/1.jpg`, { method: "POST", body: JPEG, headers: { ...auth, "content-type": "image/jpeg" } })).status, 409, "no silent overwrite");
    assert.equal((await fetch(`${internal}/storage/v1/object/${bucket}/..%2Fescape`, { method: "POST", body: JPEG, headers: auth })).status, 400);

    const listed = await (await fetch(`${internal}/storage/v1/object/list/${bucket}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ prefix: "site/r1", limit: 100 }) })).json();
    assert.deepEqual(listed, [{ name: "1.jpg" }]);

    const signed = await (await fetch(`${internal}/storage/v1/object/sign/${bucket}/site/r1/1.jpg`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) })).json();
    assert.match(signed.signedURL, /^\/object\/sign\/openblog-quote-photos\/site\/r1\/1\.jpg\?token=/);
    const photo = await fetch(`${external}/storage/v1${signed.signedURL}`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), JPEG);
    assert.equal((await fetch(`${external}/storage/v1/object/sign/${bucket}/site/r1/1.jpg?token=1.x`)).status, 404);
    assert.equal((await fetch(`${external}/storage/v1/object/${bucket}/site/r1/1.jpg`)).status, 404, "nothing unsigned is public");

    await fetch(`${internal}/storage/v1/object/${bucket}/site/settings/retention.json`, { method: "POST", headers: { ...auth, "content-type": "application/json", "x-upsert": "true" }, body: '{"days":30}' });
    const retention = await fetch(`${internal}/storage/v1/object/authenticated/${bucket}/site/settings/retention.json`, { headers: auth });
    assert.deepEqual(await retention.json(), { days: 30 });
    const settingsLink = await (await fetch(`${internal}/storage/v1/object/sign/${bucket}/site/settings/retention.json`, { method: "POST", headers: auth, body: "{}" })).json();
    assert.equal((await fetch(`${external}/storage/v1${settingsLink.signedURL}`)).status, 404, "a signed link only ever sends an image");

    assert.equal((await fetch(`${internal}/storage/v1/object/move`, { method: "POST", headers: auth, body: JSON.stringify({ bucketId: bucket, sourceKey: "site/r1/1.jpg", destinationKey: "site/held/1.jpg" }) })).status, 200);
    const removed = await (await fetch(`${internal}/storage/v1/object/${bucket}`, { method: "DELETE", headers: auth, body: JSON.stringify({ prefixes: ["site/held/1.jpg", "site/none.jpg"] }) })).json();
    assert.deepEqual(removed, [{ name: "site/held/1.jpg" }]);
    assert.equal((await fetch(`${internal}/storage/v1/object/${bucket}/site/settings/retention.json`, { method: "DELETE", headers: auth })).status, 200);
    assert.equal((await fetch(`${internal}/storage/v1/object/${bucket}/site/settings/retention.json`, { method: "DELETE", headers: auth })).status, 404);
  } finally {
    bridge.close();
    service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("with no folder, storage is unavailable to the functions", async () => {
  const bridge = createRestBridge({ target: "http://127.0.0.1:9" });
  const base = await listen(bridge);
  assert.equal((await fetch(`${base}/storage/v1/object/b/a.jpg`, { method: "POST", body: "x", headers: auth })).status, 503);
  bridge.close();
});

test("the quote store signs photo links on the public address", async () => {
  const { createStore } = await import("../../netlify/lib/quote-store.mjs");
  const fetchImpl = async () => new Response(JSON.stringify({ signedURL: "/object/sign/b/a.jpg?token=t" }), { status: 200 });
  const store = createStore({ settings: { url: "http://127.0.0.1:54321", publicUrl: "https://family.example", key: "k", siteId: "s" }, fetchImpl });
  assert.equal(await store.signPhoto("a.jpg"), "https://family.example/storage/v1/object/sign/b/a.jpg?token=t");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../../web/studio/api.js";

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

test("a read that finds the site busy is asked again, and a write never is", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => (++calls < 3 ? reply(409, { error: "busy" }) : reply(200, { ok: true })) });
  assert.deepEqual(await api.get("look"), { ok: true });
  assert.equal(calls, 3);
  calls = 0;
  const writes = createApi({ fetchImpl: async () => { calls += 1; return reply(409, { error: "changed" }); } });
  await assert.rejects(writes.put("look", {}), (error) => error.status === 409);
  assert.equal(calls, 1, "a 409 on a save is a real conflict: asked once");
});

test("a read that stays busy says so after a few tries", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => { calls += 1; return reply(409, { error: "busy" }); } });
  await assert.rejects(api.get("look"), (error) => error.status === 409);
  assert.equal(calls, 5);
});

test("a write refused as busy (the lock was taken, nothing happened) is asked again", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => (++calls < 3 ? reply(409, { error: "another content write is active", code: "busy" }) : reply(200, { saved: true })) });
  assert.deepEqual(await api.put("appearance", { etag: "e" }), { saved: true });
  assert.equal(calls, 3);
});

// N7: a request that carries a secret goes once. It is never held to be sent again, by the busy
// retry or after a new sign-in, so the secret is never in memory longer than its one send.
test("a request that carries a secret is never sent again by itself", async () => {
  for (const [path, json] of [
    ["assistant/settings", { provider: "anthropic", credentialAction: "replace", credential: "sk-ant-secret" }],
    ["engagement/settings", { credentialAction: "replace", credential: "tok" }],
    ["social/connections", { provider: "bluesky", identifier: "me.example", appPassword: "abcd-efgh" }],
    ["login", { username: "sam", password: "pw" }],
  ]) {
    let calls = 0;
    const busy = createApi({ fetchImpl: async () => { calls += 1; return reply(409, { error: "another content write is active", code: "busy" }); } });
    await assert.rejects(busy.call("PUT", path, { json }), (error) => error.status === 409, path);
    assert.equal(calls, 1, `${path}: busy, asked once`);

    calls = 0;
    let asked = 0;
    const out = createApi({ fetchImpl: async () => { calls += 1; return reply(401, { error: "Sign in" }); } });
    out.onSignedOut = async () => { asked += 1; };
    await assert.rejects(out.call("PUT", path, { json }), (error) => error.status === 401, path);
    assert.equal(calls, 1, `${path}: signed out, not sent again`);
    assert.equal(asked, 0, `${path}: nothing waits on a sign-in holding the secret`);
  }
  // Keeping or clearing carries no secret, so it is a write like any other.
  let calls = 0;
  const keep = createApi({ fetchImpl: async () => (++calls < 3 ? reply(409, { error: "busy", code: "busy" }) : reply(200, { saved: true })) });
  assert.deepEqual(await keep.put("assistant/settings", { credentialAction: "keep", credential: "" }), { saved: true });
  assert.equal(calls, 3);
});

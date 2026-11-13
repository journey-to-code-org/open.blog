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

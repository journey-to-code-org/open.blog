import { test } from "node:test";
import assert from "node:assert/strict";
import { createPostsStore } from "../../web/studio/parts/store.js";

test("the posts store shares one request and refetches when stale or asked", async () => {
  let calls = 0;
  let clock = 0;
  const api = { get: async () => { calls += 1; return { items: [{ path: `p${calls}` }] }; } };
  const store = createPostsStore(api, { now: () => clock });
  const [a, b] = await Promise.all([store.list(), store.list()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  await store.list();
  assert.equal(calls, 1, "fresh enough: no new request");
  clock += 20000;
  await store.list();
  assert.equal(calls, 2, "too old: asks again");
  store.stale();
  await store.list();
  assert.equal(calls, 3, "marked stale: asks again");
  await store.list({ fresh: true });
  assert.equal(calls, 4);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createKept } from "../../web/studio/parts/kept.js";

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

function throwingStorage() {
  const fail = () => {
    throw new Error("QuotaExceededError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

const at = new Date("2026-11-12T20:00:00Z");
const form = { title: "Sweet potato pie", tags: ["Thanksgiving"], body: "Fixed the typo." };
const path = "posts/2026-11-03-sweet-potato-pie.md";

test("keep, get and clear, keyed by user and path", () => {
  const storage = fakeStorage();
  const kept = createKept(storage, "grammi", { now: () => at });
  assert.equal(kept.get(path), null);
  assert.equal(kept.keep(path, "etag-1", form), true);
  assert.deepEqual([...storage.map.keys()], [`studio:kept:grammi:${path}`]);
  assert.deepEqual(kept.get(path), { etag: "etag-1", form, at: "2026-11-12T20:00:00.000Z" });
  assert.equal(kept.get("posts/other.md"), null);

  kept.keep(path, "etag-2", { ...form, body: "Second change." });
  assert.equal(kept.get(path).etag, "etag-2");
  assert.equal(kept.get(path).form.body, "Second change.");

  kept.clear(path); // after Update
  assert.equal(kept.get(path), null);
  assert.equal(storage.map.size, 0);
});

test("a different user never sees another's kept edits", () => {
  const storage = fakeStorage();
  createKept(storage, "grammi").keep(path, "etag-1", form);
  const mikey = createKept(storage, "mikey");
  assert.equal(mikey.get(path), null);
  mikey.clear(path);
  assert.notEqual(createKept(storage, "grammi").get(path), null, "clearing as another user leaves hers");
  // A user name that is a prefix of another does not collide.
  assert.equal(createKept(storage, "gram").get(`mi:${path}`), null);
});

test("storage that throws degrades to no-ops", () => {
  const kept = createKept(throwingStorage(), "grammi");
  assert.equal(kept.keep(path, "etag-1", form), false);
  assert.equal(kept.get(path), null);
  assert.doesNotThrow(() => kept.clear(path));
});

test("no storage or no user degrades to no-ops", () => {
  for (const kept of [createKept(null, "grammi"), createKept(undefined, "grammi"), createKept(fakeStorage(), "")]) {
    assert.equal(kept.keep(path, "etag-1", form), false);
    assert.equal(kept.get(path), null);
    assert.doesNotThrow(() => kept.clear(path));
  }
});

test("unreadable kept values are ignored", () => {
  const storage = fakeStorage();
  const kept = createKept(storage, "grammi");
  storage.setItem(`studio:kept:grammi:${path}`, "{not json");
  assert.equal(kept.get(path), null);
  storage.setItem(`studio:kept:grammi:${path}`, JSON.stringify({ etag: "x" }));
  assert.equal(kept.get(path), null);
  storage.setItem(`studio:kept:grammi:${path}`, "null");
  assert.equal(kept.get(path), null);
});

// The short log of jobs sent from this phone (Studio R4, Mikey's details): localStorage
// `studio-sent-jobs`, the last 20, read defensively. Never shown on her layer.
import assert from "node:assert/strict";
import test from "node:test";

import { SENT_LOG_KEY, SENT_LOG_MAX, addToSentLog, readSentLog, sentLogLines } from "../../web/studio/parts/sent-log.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

const ID = "0123456789abcdef0123456789abcdef";

test("the log is localStorage studio-sent-jobs, newest last, at most 20", () => {
  assert.equal(SENT_LOG_KEY, "studio-sent-jobs");
  assert.equal(SENT_LOG_MAX, 20);
  const storage = fakeStorage();
  for (let n = 0; n < 25; n += 1) addToSentLog(storage, { captureId: ID, path: `posts/job-${n}.md`, sentAt: new Date(Date.UTC(2026, 10, 13, 10, n)), skipped: n === 3 ? ["IMG_1.HEIC"] : [], duplicate: n === 4, by: "sam" });
  const log = readSentLog(storage);
  assert.equal(log.length, 20);
  assert.equal(log[0].path, "posts/job-5.md");
  assert.equal(log.at(-1).path, "posts/job-24.md");
  assert.equal(log.at(-1).sentAt, "2026-11-13T10:24:00.000Z");
});

test("anything odd in the log is dropped or clipped, and a broken log reads as empty", () => {
  assert.deepEqual(readSentLog(fakeStorage({ "studio-sent-jobs": "not json" })), []);
  assert.deepEqual(readSentLog(fakeStorage({ "studio-sent-jobs": "{\"a\":1}" })), []);
  assert.deepEqual(readSentLog(null), []);
  const storage = fakeStorage({ "studio-sent-jobs": JSON.stringify([null, 3, { captureId: ID, path: "p".repeat(500), sentAt: "x", skipped: "no", duplicate: "yes", by: 7, extra: "<b>" }]) });
  const [only, ...rest] = readSentLog(storage);
  assert.deepEqual(rest, []);
  assert.equal(only.path.length, 300);
  assert.deepEqual(only.skipped, []);
  assert.equal(only.duplicate, false);
  assert.equal(only.by, "");
  assert.equal("extra" in only, false);
  // A phone that won't keep it: nothing thrown.
  assert.doesNotThrow(() => addToSentLog({ getItem: () => null, setItem: () => { throw new Error("full"); } }, { captureId: ID, path: "p" }));
});

test("Details list the log as plain lines", () => {
  const storage = fakeStorage();
  addToSentLog(storage, { captureId: ID, path: "posts/roof.md", sentAt: new Date("2026-11-13T10:00:00Z"), skipped: ["IMG_1.HEIC"], duplicate: true, by: "sam" });
  assert.deepEqual(sentLogLines(readSentLog(storage)), [`sent on this phone (last 20, studio-sent-jobs): 1`, `2026-11-13T10:00:00.000Z ${ID} → posts/roof.md; by sam; duplicate; skipped IMG_1.HEIC`]);
  assert.deepEqual(sentLogLines([]), ["sent on this phone (last 20, studio-sent-jobs): none"]);
});

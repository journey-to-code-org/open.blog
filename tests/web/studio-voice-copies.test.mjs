// The copies of her writing kept on this phone (Studio R9, "Data safety: the ob-voice-* keys").
// Ports the old Admin's admin-voice-draft store cases and proves the keys and record shapes are
// byte for byte the old Admin's, in both directions: a copy made by either is read by the other.
import assert from "node:assert/strict";
import test from "node:test";

import {
  POLISHED_COPY_TTL_MS, ROUGH_COPY_TTL_MS, clearVoiceCopies, createPolishedDraftStore, createVoiceDraftStore, draftKey, forgetMemoryCopies, polishedKey, voiceCopiesAtRisk, voiceCopiesOnPhone,
} from "../../web/studio/parts/voice-copies.js";
import { VOICE_LIMITS } from "../../web/studio/parts/voice-rules.js";
import { readFileSync } from "node:fs";
import { fakeStorage } from "./voice-harness.mjs";

const DAY = 24 * 60 * 60 * 1000;
// What the old Admin's voice.js kept for the same two saves, frozen in R15 before it was deleted.
const frozen = JSON.parse(readFileSync(new URL("./fixtures/old-admin-voice.json", import.meta.url), "utf8"));

test("the copy is bounded, versioned, and ignores records it doesn't recognise", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  const store = createVoiceDraftStore("k", () => storage);
  assert.equal(store.load(10), null);
  assert.equal(store.save({ sessionId: "s@1", deadline: "2026-10-28T09:03:00Z", text: "hello" }, 5), true);
  assert.deepEqual(store.load(10), { v: 1, sessionId: "s@1", deadline: "2026-10-28T09:03:00Z", text: "hello", savedAt: 5 });
  assert.equal(store.save({ sessionId: "s@1", deadline: "d", text: "x".repeat(VOICE_LIMITS.maxDraftBytes + 1) }), false, "more than a piece can hold is not kept");
  assert.equal(store.load(10).text, "hello", "a refused copy leaves the last one");
  const newer = JSON.stringify({ v: 9, sessionId: "s", text: "x", deadline: "d", savedAt: 1 });
  storage.values.set("k", newer);
  assert.equal(store.load(10)?.text, "hello", "a record from another version is not used (the memory copy stands)");
  store.clear();
  assert.equal(store.load(10), null);
});

test("a record with another version, or one that doesn't parse, is never rewritten or deleted by reading", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  const newer = JSON.stringify({ v: 2, sessionId: "s", text: "from a later release", deadline: "d", savedAt: 1, extra: true });
  storage.values.set("ob-voice-draft:grammi", newer);
  storage.values.set("ob-voice-polished:grammi:a-rough.md", "{not json");
  assert.equal(createVoiceDraftStore("ob-voice-draft:grammi", () => storage).load(), null);
  assert.equal(createPolishedDraftStore("ob-voice-polished:grammi:a-rough.md", () => storage).load(), null);
  assert.deepEqual(voiceCopiesOnPhone(() => storage, "grammi"), []);
  assert.equal(storage.values.get("ob-voice-draft:grammi"), newer, "still there, byte for byte");
  assert.equal(storage.values.get("ob-voice-polished:grammi:a-rough.md"), "{not json");
  // An expired record of another shape is left too: only a copy this code understands can expire.
  storage.values.set("ob-voice-draft:grammi", JSON.stringify({ v: 2, savedAt: 0 }));
  createVoiceDraftStore("ob-voice-draft:grammi", () => storage).load(10 * DAY);
  assert.ok(storage.values.has("ob-voice-draft:grammi"));
});

test("a record of another version is never deleted or rewritten: not by clear(), save() or signing in and out", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  const newer = JSON.stringify({ v: 2, sessionId: "s", text: "from a later release", deadline: "d", savedAt: Date.now() });
  const broken = "{not json";
  storage.values.set("ob-voice-draft:grammi", newer);
  storage.values.set("ob-voice-polished:grammi:a.md", broken);
  storage.values.set("ob-voice-draft:mikey", newer);
  const rough = createVoiceDraftStore("ob-voice-draft:grammi", () => storage);
  const polished = createPolishedDraftStore("ob-voice-polished:grammi:a.md", () => storage);
  assert.equal(rough.keptByNewer, true, "read as kept by a newer version");
  assert.equal(polished.keptByNewer, false, "a record that doesn't parse is not a newer version");
  rough.clear();
  polished.clear();
  assert.equal(storage.values.get("ob-voice-draft:grammi"), newer, "clear() leaves it byte for byte");
  assert.equal(storage.values.get("ob-voice-polished:grammi:a.md"), broken);
  assert.equal(rough.save({ sessionId: "mine", deadline: "d", text: "kept on the page" }), true);
  assert.equal(storage.values.get("ob-voice-draft:grammi"), newer, "save() doesn't write over it");
  assert.equal(rough.inMemoryOnly, true, "the copy lives in page memory, and the screen says so");
  assert.equal(rough.load().text, "kept on the page");
  assert.equal(polished.save({ title: "t", body: "b" }), true);
  assert.equal(storage.values.get("ob-voice-polished:grammi:a.md"), broken);
  rough.clear();
  assert.equal(rough.load(), null);
  assert.equal(storage.values.get("ob-voice-draft:grammi"), newer);
  clearVoiceCopies(() => storage, { keepUser: "grammi" });
  clearVoiceCopies(() => storage);
  assert.deepEqual(Object.fromEntries(storage.values), { "ob-voice-draft:grammi": newer, "ob-voice-polished:grammi:a.md": broken, "ob-voice-draft:mikey": newer });
  // Ours, after theirs is gone, is kept on the phone again.
  storage.values.delete("ob-voice-draft:grammi");
  assert.equal(rough.keptByNewer, false);
  rough.save({ sessionId: "mine", deadline: "d", text: "now kept" });
  assert.equal(JSON.parse(storage.values.get("ob-voice-draft:grammi")).text, "now kept");
  assert.equal(rough.inMemoryOnly, false);
});

test("with a phone that refuses, the copy lives in page memory and nothing breaks", () => {
  forgetMemoryCopies();
  const store = createVoiceDraftStore("blocked-key", () => fakeStorage({ blocked: true }));
  assert.equal(store.save({ sessionId: "s@1", deadline: "d", text: "kept" }), true);
  assert.equal(store.inMemoryOnly, true);
  assert.equal(store.load().text, "kept");
  store.clear();
  assert.equal(store.load(), null);
  assert.doesNotThrow(() => clearVoiceCopies(() => fakeStorage({ blocked: true })));
  assert.doesNotThrow(() => clearVoiceCopies(() => { throw new Error("no storage at all"); }));
});

test("a copy of private text expires: a rough draft after a day, a polished copy after thirty", () => {
  forgetMemoryCopies();
  assert.equal(ROUGH_COPY_TTL_MS, DAY);
  assert.equal(POLISHED_COPY_TTL_MS, 30 * DAY);
  const storage = fakeStorage();
  const rough = createVoiceDraftStore("r", () => storage);
  rough.save({ sessionId: "s@1", deadline: "d", text: "words" }, 1000);
  assert.equal(rough.load(1000 + DAY).text, "words");
  assert.equal(rough.load(1001 + DAY), null);
  assert.equal(storage.values.has("r"), false, "an expired copy is removed");
  const polished = createPolishedDraftStore("p", () => storage);
  polished.save({ base: "rev", title: "T", body: "B" }, 1000);
  assert.deepEqual(polished.load(1000 + 30 * DAY), { v: 1, base: "rev", title: "T", body: "B", savedAt: 1000 });
  assert.equal(polished.load(1001 + 30 * DAY), null);
  assert.equal(polished.save({ title: "T", body: "B" }, 5), true);
  assert.equal(polished.load(6).base, null, "a copy not saved yet has no base");
});

test("the keys and records are byte for byte the old Admin's, both ways", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  assert.equal(draftKey("grammi"), "ob-voice-draft:grammi");
  assert.equal(polishedKey("grammi", "2026-10-20-a-rough.md"), "ob-voice-polished:grammi:2026-10-20-a-rough.md");
  // Written by the old Admin's code, read by Studio's.
  for (const [key, value] of frozen.values) storage.values.set(key, value);
  const fromOld = new Map(storage.values);
  assert.deepEqual(createVoiceDraftStore(draftKey("grammi"), () => storage).load(100), { v: 1, sessionId: "a@1", deadline: "2026-10-28T09:03:00Z", text: "typed in the old Admin", savedAt: 77 });
  assert.deepEqual(createPolishedDraftStore(polishedKey("grammi", "a-rough.md"), () => storage).load(100), { v: 1, base: "rev1", title: "Old", body: "polished there", savedAt: 78 });
  // Written by Studio's, the same bytes; read by the old Admin's.
  const mine = fakeStorage();
  createVoiceDraftStore(draftKey("grammi"), () => mine).save({ sessionId: "a@1", deadline: "2026-10-28T09:03:00Z", text: "typed in the old Admin" }, 77);
  createPolishedDraftStore(polishedKey("grammi", "a-rough.md"), () => mine).save({ base: "rev1", title: "Old", body: "polished there" }, 78);
  assert.deepEqual([...mine.values], [...fromOld], "identical keys and identical JSON, so the old Admin read Studio's too");
});

test("signing out clears every voice copy by prefix and nothing else", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  const others = { "studio:last-start": "{}", "ob-voice": "not ours", "ob-voiced-raft:x": "nor this", "openblog-capture": "jobs", "ob-voice-draftx": "nor this" };
  for (const [key, value] of Object.entries(others)) storage.values.set(key, value);
  createVoiceDraftStore(draftKey("grammi"), () => storage).save({ sessionId: "s", deadline: "d", text: "hers" });
  createPolishedDraftStore(polishedKey("grammi", "a.md"), () => storage).save({ title: "t", body: "b" });
  createVoiceDraftStore(draftKey("mikey"), () => storage).save({ sessionId: "s", deadline: "d", text: "his" });
  clearVoiceCopies(() => storage);
  assert.deepEqual(Object.fromEntries(storage.values), others, "every non-voice key untouched");
  assert.equal(createVoiceDraftStore(draftKey("grammi"), () => storage).load(), null, "and the memory copy went too");
});

test("signing in keeps only that person's copies", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  createVoiceDraftStore(draftKey("grammi"), () => storage).save({ sessionId: "s", deadline: "d", text: "hers" });
  createPolishedDraftStore(polishedKey("grammi", "a.md"), () => storage).save({ title: "t", body: "b" });
  createVoiceDraftStore(draftKey("grammi2"), () => storage).save({ sessionId: "s", deadline: "d", text: "a longer name is another person" });
  createPolishedDraftStore(polishedKey("mikey", "a.md"), () => storage).save({ title: "t", body: "b" });
  clearVoiceCopies(() => storage, { keepUser: "grammi" });
  assert.deepEqual([...storage.values.keys()].sort(), ["ob-voice-draft:grammi", "ob-voice-polished:grammi:a.md"]);
});

test("what is kept only here is named for Home and asked about before sign-out; expired copies are not", () => {
  forgetMemoryCopies();
  const storage = fakeStorage();
  const now = Date.parse("2026-11-14T12:00:00Z");
  const open = new Date(now + 60_000).toISOString();
  assert.deepEqual(voiceCopiesOnPhone(() => storage, "grammi", now), []);
  assert.equal(voiceCopiesAtRisk(() => storage, "grammi", now), false);
  createVoiceDraftStore(draftKey("grammi"), () => storage).save({ sessionId: "s", deadline: open, text: "still writing" }, now);
  assert.deepEqual(voiceCopiesOnPhone(() => storage, "grammi", now), [{ kind: "rough" }]);
  assert.equal(voiceCopiesAtRisk(() => storage, "grammi", now), true);
  assert.equal(voiceCopiesAtRisk(() => storage, "mikey", now), false, "another person's copies are not hers");
  // Past the deadline and the grace, the server has what it will keep: nothing is at risk.
  assert.equal(voiceCopiesAtRisk(() => storage, "grammi", now + 60_000 + 11_000), false);
  createPolishedDraftStore(polishedKey("grammi", "2026-10-20-a-rough.md"), () => storage).save({ base: "r", title: "t", body: "changed" }, now);
  assert.deepEqual(voiceCopiesOnPhone(() => storage, "grammi", now + 5 * DAY), [{ kind: "polished", roughFile: "2026-10-20-a-rough.md" }]);
  assert.equal(voiceCopiesAtRisk(() => storage, "grammi", now + 31 * DAY), false, "an expired polished copy isn't asked about");
  assert.deepEqual(voiceCopiesOnPhone(() => storage, "", now), []);
  assert.deepEqual(voiceCopiesOnPhone(() => { throw new Error("blocked"); }, "grammi", now).length, 2, "a phone that refuses: what's in page memory still counts");
});

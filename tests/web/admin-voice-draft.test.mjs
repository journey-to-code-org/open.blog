import assert from "node:assert/strict";
import test from "node:test";

import { createVoiceSession } from "../../web/admin/voice-session.js";
import { VOICE_LIMITS, byteLength, createVoiceDraftStore, expiredPlan, reconcileDraft } from "../../web/admin/voice.js";
import { choose, type, withDom } from "./dom-shim.mjs";
import { all, button, fakeClock, fakeServer, fakeStorage, flush, one, text } from "./voice-harness.mjs";

// Never lose a timed draft (ADR 0372, #446): a bounded copy on this device, a debounced autosave to the
// server, and a reconciliation on load where the server's session wins for the deadline and the longer of the
// two drafts wins for the text. An expired session never gets time back.

let users = 0;
/** A page over a shared server, clock and storage; mounting again is a reload. */
function site({ storage = fakeStorage(), server } = {}) {
  const clock = fakeClock();
  const api = server || fakeServer(clock);
  const user = `drafter-${++users}`;
  const open = async () => {
    const session = createVoiceSession({ api, user, clock, storage: () => storage });
    document.body.append(session.element);
    await session.load();
    await flush();
    return session;
  };
  return { clock, api, storage, user, open, key: `ob-voice-draft:${user}` };
}
const rough = (root) => all(root, "textarea").find((n) => n.dataset.voiceRough === "true");
async function begin(session) {
  const first = all(session.element, "input").find((n) => n.attributes.type === "radio" && n.attributes.name?.endsWith("-prompt"));
  first.checked = true;
  await choose(first, first.value);
  await button(session.element, "voice-start").click();
  await flush();
}
const write = async (session, value) => {
  const box = rough(session.element);
  box.value = value;
  await type(box, value);
};
const stored = (s) => JSON.parse(s.storage.values.get(s.key));

test("the copy on this device is bounded, versioned, and ignores records it does not recognise", () => {
  const storage = fakeStorage();
  const store = createVoiceDraftStore("k", () => storage);
  assert.equal(store.load(), null);
  assert.equal(store.save({ sessionId: "s@1", deadline: "2026-10-28T09:03:00Z", text: "hello" }, 5), true);
  assert.deepEqual(store.load(), { v: 1, sessionId: "s@1", deadline: "2026-10-28T09:03:00Z", text: "hello", savedAt: 5 });
  assert.equal(store.save({ sessionId: "s@1", deadline: "d", text: "x".repeat(VOICE_LIMITS.maxDraftBytes + 1) }), false, "more than a sample can hold is not kept");
  assert.equal(store.load().text, "hello", "a refused copy leaves the last one");
  assert.equal(byteLength("é"), 2);
  storage.values.set("k", JSON.stringify({ v: 9, sessionId: "s", text: "x", deadline: "d", savedAt: 1 }));
  assert.equal(store.load()?.text, "hello", "a record from another version is not used (the memory copy stands)");
  store.clear();
  assert.equal(store.load(), null);
});

test("with storage that throws, the copy lives in memory and nothing breaks", () => {
  const store = createVoiceDraftStore("blocked-key", () => fakeStorage({ blocked: true }));
  assert.equal(store.save({ sessionId: "s@1", deadline: "d", text: "kept" }), true);
  assert.equal(store.inMemoryOnly, true);
  assert.equal(store.load().text, "kept");
  store.clear();
  assert.equal(store.load(), null);
});

test("reconciling: the longer draft wins for the same session, and a copy of another session never does", () => {
  const local = { sessionId: "s@1", text: "twelve chars", deadline: "d", savedAt: 1 };
  assert.deepEqual(reconcileDraft({ sessionId: "s@1", serverDraft: "short" }, local), { text: "twelve chars", from: "device", push: true });
  assert.deepEqual(reconcileDraft({ sessionId: "s@1", serverDraft: "much longer than the copy" }, local), { text: "much longer than the copy", from: "server", push: false });
  assert.equal(reconcileDraft({ sessionId: "s@1", serverDraft: "same" }, { ...local, text: "same" }).from, "server");
  assert.equal(reconcileDraft({ sessionId: "s@2", serverDraft: "a" }, local).text, "a");
  assert.equal(reconcileDraft({ sessionId: "s@1", serverDraft: "a" }, null).text, "a");
  assert.equal(reconcileDraft({ sessionId: "s@1", serverDraft: null }, null).text, "");
});

test("an expired session is planned from the longer copy only if it was kept before the deadline plus the grace", () => {
  const deadline = "2026-10-28T09:03:00.000Z";
  const at = Date.parse(deadline);
  const session = { open: true, expired: true, sessionId: "s@1", deadline, draftChars: 5 };
  const local = (savedAt, textValue = "a longer draft") => ({ sessionId: "s@1", text: textValue, deadline, savedAt });
  assert.equal(expiredPlan(session, local(at - 1000)).useDevice, true);
  assert.equal(expiredPlan(session, local(at + 9000)).useDevice, true, "inside the server's ten second grace");
  assert.equal(expiredPlan(session, local(at + 11000)).useDevice, false, "kept after the grace: no extra time");
  assert.equal(expiredPlan(session, local(at - 1000, "tiny")).useDevice, false, "the server already has more");
  assert.equal(expiredPlan(session, { ...local(at - 1000), sessionId: "other@1" }).useDevice, false);
  assert.equal(expiredPlan({ ...session, expired: false }, local(at - 1000)).useDevice, false, "an open session just resumes");
  assert.equal(expiredPlan({ open: false }, local(at - 1000)).useDevice, false);
  assert.equal(expiredPlan(session, null).useDevice, false);
  assert.equal(expiredPlan(session, local(at - 1000, "   ")).useDevice, false);
});

test("typing keeps a copy on this device after a pause and the server's autosave follows", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    assert.equal(s.storage.values.size, 0, "nothing is kept for an empty draft");
    await write(page, "first words");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    assert.equal(stored(s).text, "first words");
    assert.match(stored(s).sessionId, /^a-mistake-i-made@/);
    assert.equal(s.api.state.session.draft, "", "the server has not been told yet");
    await s.clock.advance(VOICE_LIMITS.autosaveMs);
    assert.equal(s.api.state.session.draft, "first words");
    assert.match(text(one(page.element, "[data-voice-device]")), /copy is kept on this device/);
  })();
});

test("reloading mid-session resumes with the server's deadline and the draft, and gives no time back", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "I was in the middle of a sentence");
    await s.clock.advance(60000);
    page.destroy();
    document.body.replaceChildren();
    const reloaded = await s.open();
    assert.equal(rough(reloaded.element).value, "I was in the middle of a sentence");
    assert.equal(text(one(reloaded.element, "[data-voice-clock]")), "2:00", "the clock continues; it does not restart at 3:00");
    assert.equal(s.api.calls.filter((c) => c.path === "voice/session/start").length, 1);
  })();
});

test("when the copy on this device is longer, it wins for the text and is sent to the server at once", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "server has this");
    await s.clock.advance(2000);
    await write(page, "server has this and the device kept more typing after a dropped connection");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    // The connection dropped before the autosave went out; the page is closed and reopened.
    page.destroy();
    document.body.replaceChildren();
    assert.equal(s.api.state.session.draft, "server has this");
    const reloaded = await s.open();
    assert.equal(rough(reloaded.element).value, "server has this and the device kept more typing after a dropped connection");
    assert.match(text(one(reloaded.element, "[data-voice-savenote]")), /Restored the longer copy/);
    await s.clock.advance(10);
    assert.equal(s.api.state.session.draft, "server has this and the device kept more typing after a dropped connection");
  })();
});

test("when the server's draft is longer, the server wins", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "short");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    // Another surface (the command line) saved more.
    s.api.state.session.draft = "written elsewhere and much longer";
    page.destroy();
    document.body.replaceChildren();
    const reloaded = await s.open();
    assert.equal(rough(reloaded.element).value, "written elsewhere and much longer");
  })();
});

test("a copy that belongs to a different session is dropped, never mixed in", async () => {
  await withDom(async () => {
    const s = site();
    s.storage.setItem(s.key, JSON.stringify({ v: 1, sessionId: "old-prompt@T1", deadline: "d", text: "an old session's words that are long", savedAt: 1 }));
    const page = await s.open();
    await begin(page);
    assert.equal(rough(page.element).value, "");
    assert.equal(s.storage.values.has(s.key), false, "the stale copy was removed");
  })();
});

test("with storage disabled the draft still reaches the server and a reload resumes from it", async () => {
  await withDom(async () => {
    const s = site({ storage: fakeStorage({ blocked: true }) });
    const page = await s.open();
    await begin(page);
    await write(page, "only the server will remember this");
    await s.clock.advance(VOICE_LIMITS.autosaveMs + 10);
    assert.equal(s.api.state.session.draft, "only the server will remember this");
    assert.match(text(one(page.element, "[data-voice-device]")), /would not keep a copy/);
    page.destroy();
    document.body.replaceChildren();
    const reloaded = await s.open();
    assert.equal(rough(reloaded.element).value, "only the server will remember this");
  })();
});

test("a failed autosave leaves the copy on the device and says so; the next pause tries again", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    s.api.state.failures.push({ method: "PUT", path: "voice/session/draft", error: Object.assign(new Error("offline"), { status: 0, data: null }) });
    await write(page, "typed while offline");
    await s.clock.advance(VOICE_LIMITS.autosaveMs + 10);
    assert.match(text(one(page.element, "[data-voice-savenote]")), /could not be reached/);
    assert.equal(stored(s).text, "typed while offline");
    await s.clock.advance(VOICE_LIMITS.autosaveMs * 2 + 10);
    assert.equal(s.api.state.session.draft, "typed while offline");
    assert.match(text(one(page.element, "[data-voice-savenote]")), /Saved on the server/);
  })();
});

test("the copy is cleared once the rough draft is locked, and when the session is scrapped", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "to be locked");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    assert.ok(s.storage.values.has(s.key));
    await button(page.element, "voice-finish").click();
    await flush();
    assert.equal(s.storage.values.has(s.key), false, "locked: the server has the rough draft for good");
  })();
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "to be thrown away");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    await button(page.element, "voice-over").click();
    await button(page.element, "voice-over-confirm").click();
    await flush();
    assert.equal(s.storage.values.has(s.key), false);
  })();
});

test("after the time ran out, a copy kept before the deadline and longer than the server's is locked", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "saved");
    await s.clock.advance(2000);
    await write(page, "saved and then typed more before the deadline with the network down");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    page.destroy();
    document.body.replaceChildren();
    // The page was away until two seconds past the deadline.
    s.api.state.session.deadlineMs = s.clock.now() - 2000;
    const reloaded = await s.open();
    assert.equal(one(reloaded.element, "[data-voice-rough-text]").textContent, "saved and then typed more before the deadline with the network down");
    assert.equal(s.api.calls.filter((c) => c.path === "voice/session/draft" && c.body.text.includes("before the deadline")).length, 0, "no draft was sent after the deadline");
    assert.equal(s.storage.values.has(s.key), false);
  })();
});

test("past the grace the server locks what it saved and the longer copy gets no extra time", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    await write(page, "saved on the server");
    await s.clock.advance(2000);
    await write(page, "saved on the server plus a lot more typed offline");
    await s.clock.advance(VOICE_LIMITS.localSaveMs + 10);
    page.destroy();
    document.body.replaceChildren();
    s.api.state.session.deadlineMs = s.clock.now() - 60000;
    const reloaded = await s.open();
    assert.equal(one(reloaded.element, "[data-voice-rough-text]").textContent, "saved on the server");
    assert.match(text(one(reloaded.element, "[data-voice-locked]")), /time ran out/);
    assert.equal(s.storage.values.has(s.key), false);
  })();
});

test("an expired session with nothing saved is discarded, and the copy goes with it", async () => {
  await withDom(async () => {
    const s = site();
    const page = await s.open();
    await begin(page);
    page.destroy();
    document.body.replaceChildren();
    s.storage.setItem(s.key, JSON.stringify({ v: 1, sessionId: `a-mistake-i-made@T${0}`, deadline: "d", text: "   ", savedAt: Date.now() }));
    s.api.state.session.deadlineMs = s.clock.now() - 5000;
    const reloaded = await s.open();
    assert.match(text(one(reloaded.element, "[data-voice-notice]")), /discarded/);
    assert.equal(s.storage.values.has(s.key), false);
    assert.equal(s.api.state.samples.length, 0);
  })();
});

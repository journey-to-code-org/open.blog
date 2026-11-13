// Studio R4 "Sending": the old queue's send tests (admin-capture-queue, admin-job-capture) ported,
// and the new cases: an old Admin record sent by Studio, two windows make one draft, a save with no
// signal goes on `online`, a background 401 asks nothing, deleted-since sends again under a new id,
// and no database is made on a phone that never kept a job.
import assert from "node:assert/strict";
import test from "node:test";

import { createCaptureQueue, createMemoryStore, makeRecord } from "../../web/studio/parts/capture-queue.js";
import { createJobSender, entryState, freshCopy, retryDelay, sendCapture, sendOutcome, stepWords, timeLimit } from "../../web/studio/parts/job-sender.js";
import * as old from "../../web/admin/capture-queue.js";

const SCAFFOLD = "## Problem\n\n## What we found\n\n## What we did\n\n## Result\n\n";
const idOf = (n) => String(n).padStart(32, "0");
const photo = (name, size = 3) => ({ name, type: "image/jpeg", size, blob: new Blob([new Uint8Array(size)]) });
const capture = (n, extra = {}) => ({
  id: idOf(n),
  fields: { trade: "roofing", service: "roof-repair", town: "Elkins", notes: "Leak" },
  photos: [photo("a.jpg"), photo("b.jpg")],
  audio: null,
  ...extra,
});
const fail = (status, data = null, message = "no") => Object.assign(new Error(message), { status, data });

/** A pretend blog: the same rules as the server's capture routes (ADR 0297, R4 G29). */
function fakeBlog({ user = "dana" } = {}) {
  const blog = { online: true, signedIn: true, drafts: new Map(), photos: new Map(), audio: new Set(), calls: [], asked: 0, refuse: new Map(), skip: new Set(), gate: null };
  blog.api = {
    csrf: "token",
    user,
    onSignedOut: async () => { blog.asked += 1; blog.signedIn = true; },
    async call(method, path, options = {}) {
      blog.calls.push({ method, path, retry: options.retry, signal: options.signal });
      if (blog.gate) await blog.gate;
      if (!blog.online) throw fail(0);
      if (!blog.signedIn) {
        if (options.retry && blog.api.onSignedOut) {
          await blog.api.onSignedOut();
          return blog.api.call(method, path, { ...options, retry: false });
        }
        throw fail(401);
      }
      const [name, search = ""] = path.split("?");
      const query = new URLSearchParams(search);
      if (method === "GET" && name === "capture") {
        const id = query.get("id");
        const photos = [...blog.photos.entries()].filter(([key]) => key.startsWith(id)).map(([key, url]) => ({ slot: Number(key.split(":")[1]), url }));
        const draft = blog.drafts.get(id);
        return { photos, audio: blog.audio.has(id), draft: draft ? { path: draft.path, status: draft.removed ? "removed" : "draft" } : null };
      }
      if (name === "upload") {
        const key = `${query.get("capture")}:${query.get("slot")}`;
        if (blog.skip.has(query.get("name"))) throw fail(415, { code: "heic" });
        blog.photos.set(key, `/images/uploads/captures/${key.replace(":", "-")}.jpg`);
        return { url: blog.photos.get(key) };
      }
      if (name === "capture-audio") {
        blog.audio.add(query.get("capture"));
        return { stored: true };
      }
      if (name === "document") {
        const { captureId, fields, body } = options.json;
        if (blog.refuse.has(captureId)) throw blog.refuse.get(captureId);
        const known = blog.drafts.get(captureId);
        if (known) return { path: known.path, status: known.removed ? "removed" : "draft", duplicate: true };
        const draft = { path: `posts/${fields.slug}.md`, fields, body };
        blog.drafts.set(captureId, draft);
        return { path: draft.path, status: "draft" };
      }
      if (name === "session") return { csrf: "token", user };
      throw fail(404);
    },
  };
  return blog;
}

/** A window: events, and Web Locks when `locks` is given (one shared by the windows). */
function fakeWindow(locks = null) {
  const target = new EventTarget();
  return Object.assign(target, { navigator: locks ? { locks } : {}, document: null, BroadcastChannel: undefined });
}

function fakeLocks() {
  const held = new Set();
  return {
    async request(name, options, task) {
      if (held.has(name)) return task(null);
      held.add(name);
      try {
        return await task({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

const sender = (blog, store, { win = fakeWindow(), trade = true, exists = true } = {}) => createJobSender({
  api: blog.api, meta: { job: { scaffold: SCAFFOLD, services: [{ id: "roof-repair", title: "Roof repair" }] }, siteUses: { trade } },
  title: (record) => record.fields.town, win, exists: async () => exists, openStore: async () => store,
});

test("the timings: a minute or more per request, and tries at 30 s, 1 min, 2 min, then every 5 min", () => {
  assert.equal(timeLimit(0), 60_000);
  assert.equal(timeLimit(25 * 1024 * 120), 120_000);
  assert.deepEqual([1, 2, 3, 4, 9].map(retryDelay), [30_000, 60_000, 120_000, 300_000, 300_000]);
  assert.equal(stepWords({ step: "photo", index: 3, total: 4 }), "Sending photo 3 of 4…");
  assert.equal(stepWords({ step: "audio" }), "Sending the voice note…");
  assert.equal(stepWords({ step: "document" }), "Making the draft…");
});

test("what a failed send means: waiting, sign in, or refused with its code", () => {
  assert.deepEqual(sendOutcome(fail(0)), { kind: "waiting", code: "offline" });
  assert.deepEqual(sendOutcome(fail(503)), { kind: "waiting", code: "server" });
  assert.deepEqual(sendOutcome(fail(409, { code: "busy" })), { kind: "waiting", code: "offline" });
  assert.deepEqual(sendOutcome(fail(401)), { kind: "signin", code: "signin" });
  assert.deepEqual(sendOutcome(fail(403, null, "CSRF token missing")), { kind: "signin", code: "signin" });
  assert.deepEqual(sendOutcome(fail(422, { code: "capture-id" })), { kind: "refused", code: "capture-id" });
  assert.deepEqual(sendOutcome(fail(409, { code: "ledger-version" })), { kind: "refused", code: "ledger-version" });
  assert.deepEqual(sendOutcome(fail(400)), { kind: "refused", code: "refused" });
});

test("where a waiting job stands", () => {
  const ok = (record) => ({ state: "ok", record: { attempts: 0, failed: false, lastError: "", ...record } });
  assert.equal(entryState({ state: "newer" }), "newer");
  assert.equal(entryState({ state: "unreadable" }), "unreadable");
  assert.equal(entryState(ok({})), "waiting");
  assert.equal(entryState(ok({ attempts: 2 })), "tried");
  assert.equal(entryState(ok({}), "dana", { sending: true }), "sending");
  assert.equal(entryState(ok({}), "dana", { signin: true }), "signin");
  assert.equal(entryState(ok({ failed: true })), "refused");
  assert.equal(entryState(ok({ sent: { path: "p", skipped: ["a"] } })), "sent");
  assert.equal(entryState(ok({ sent: { path: "p", removed: true } })), "removed");
  assert.equal(entryState(ok({ by: "sam" }), "dana"), "someone-else");
  assert.equal(entryState(ok({ by: "dana" }), "dana"), "waiting");
  const copy = freshCopy({ v: 1, id: idOf(1), attempts: 3, failed: true, lastError: "x", sent: { path: "p", removed: true }, by: "sam", photos: [] }, idOf(2), "dana");
  assert.deepEqual(copy, { v: 1, id: idOf(2), attempts: 0, failed: false, lastError: "", by: "dana", photos: [] });
});

test("sending asks what arrived, skips it, sends each photo, the voice note and then the draft, with a time limit", async () => {
  const blog = fakeBlog();
  blog.photos.set(`${idOf(1)}:0`, "/images/uploads/captures/already.jpg");
  const steps = [];
  const note = { type: "audio/webm", size: 4, seconds: 2, blob: new Blob(["abcd"]) };
  const result = await sendCapture({ api: blog.api, capture: capture(1, { audio: note }), scaffold: SCAFFOLD, onStep: (step) => steps.push(step.step + (step.index || "")) });
  assert.deepEqual(blog.calls.map((call) => `${call.method} ${call.path.split("?")[0]}`), ["GET capture", "POST upload", "POST capture-audio", "POST document"]);
  assert.match(blog.calls[1].path, /slot=1/, "the photo the server had is not sent again");
  assert.ok(blog.calls.every((call) => call.retry === false), "never asks her to sign in from the background");
  assert.ok(blog.calls.every((call) => call.signal), "every request has a time limit");
  assert.deepEqual(steps, ["photo2", "audio", "document"]);
  assert.equal(result.audio, "kept");
  const body = blog.drafts.get(idOf(1)).body;
  assert.match(body, /already\.jpg[\s\S]*00000000000000000000000000000001-1\.jpg/);
  assert.doesNotMatch(body, /audio|webm/);

  // A draft already made: straight to the document, which answers with it again.
  blog.calls.length = 0;
  const again = await sendCapture({ api: blog.api, capture: capture(1, { audio: note }), scaffold: SCAFFOLD });
  assert.deepEqual(blog.calls.map((call) => call.path.split("?")[0]), ["capture", "document"]);
  assert.equal(again.duplicate, true);

  // A server from before R4 doesn't know the question and still makes one draft.
  const older = fakeBlog();
  const call = older.api.call;
  older.api.call = (method, path, options) => (path.startsWith("capture?") ? Promise.reject(fail(404)) : call(method, path, options));
  assert.equal((await sendCapture({ api: older.api, capture: capture(2), scaffold: SCAFFOLD })).path, "posts/roof-repair-in-elkins-000000.md");
});

test("a photo or voice note her blog refuses for good is skipped and named; anything else stops the send", async () => {
  const blog = fakeBlog();
  blog.skip.add("b.jpg");
  const result = await sendCapture({ api: blog.api, capture: capture(1), scaffold: SCAFFOLD });
  assert.deepEqual(result.skipped, ["b.jpg"]);
  assert.doesNotMatch(blog.drafts.get(idOf(1)).body, /-1\.jpg/);
  blog.online = false;
  await assert.rejects(sendCapture({ api: blog.api, capture: capture(2), scaffold: SCAFFOLD }), (error) => error.status === 0 && error.step === "check");
});

test("a job kept with no signal goes when the signal comes back, and is taken off the phone only then", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  const win = fakeWindow();
  const jobs = sender(blog, store, { win });
  await jobs.start();
  blog.online = false;
  assert.equal((await jobs.add(capture(1))).ok, true);
  assert.equal((await jobs.add(capture(2))).ok, true);
  let result = await jobs.flush();
  assert.equal(result.blocked, "waiting");
  const [first, second] = await store.all();
  assert.equal(first.attempts, 1);
  assert.match(first.lastError, /^\[offline\]/);
  assert.equal(second.attempts, 0, "stops at the first that found no signal");
  assert.equal(first.by, "dana");
  assert.equal(jobs.stateOf(jobs.entries()[0]), "tried");

  blog.online = true;
  win.dispatchEvent(new Event("online"));
  result = await jobs.flush();
  assert.equal((await store.all()).length, 0);
  assert.equal(blog.drafts.size, 2);
  assert.deepEqual(jobs.sentThisVisit().map((sent) => sent.title), ["Elkins", "Elkins"]);
});

test("a job saved by the old Admin is read and sent by Studio, and its write-up still sends as before", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  const written = old.makeRecord({ ...capture(7), fields: { ...capture(7).fields, draft: { title: "New roof", description: "", sections: { problem: "Leak", found: "", did: "Fixed", result: "" } } } }, new Date("2026-11-12T10:00:00Z"));
  await store.put(written);
  const jobs = sender(blog, store);
  assert.equal(await jobs.start(), true);
  await jobs.flush();
  assert.equal((await store.all()).length, 0);
  const draft = blog.drafts.get(idOf(7));
  assert.equal(draft.fields.title, "New roof");
  assert.match(draft.body, /^## Problem\n\nLeak\n\n## What we found\n\n## What we did\n\nFixed/);
});

test("a background 401 marks it Needs you and asks nothing; Send now asks her to sign in, then it goes", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  const jobs = sender(blog, store);
  await jobs.start();
  blog.signedIn = false;
  await jobs.add(capture(1));
  const result = await jobs.flush();
  assert.equal(result.blocked, "signin");
  assert.equal(blog.asked, 0, "no sign-in dialog from the background");
  assert.equal(jobs.stateOf(jobs.entries()[0]), "signin");
  assert.equal((await store.all())[0].failed, false, "nothing is marked refused");
  await jobs.sendNow();
  assert.equal(blog.asked, 1);
  assert.equal((await store.all()).length, 0);
});

test("two windows sending one job make one draft and lose nothing, with or without locks", async () => {
  for (const locks of [null, fakeLocks()]) {
    const blog = fakeBlog();
    const store = createMemoryStore();
    await store.put(makeRecord(capture(1), new Date(), "dana"));
    const one = sender(blog, store, { win: fakeWindow(locks) });
    const two = sender(blog, store, { win: fakeWindow(locks) });
    let open;
    blog.gate = new Promise((resolve) => { open = resolve; });
    const started = Promise.all([one.start(), two.start()]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    open();
    blog.gate = null;
    await started;
    await Promise.all([one.flush(), two.flush()]);
    assert.equal(blog.drafts.size, 1, locks ? "with locks" : "without locks");
    assert.equal((await store.all()).length, 0);
    const documents = blog.calls.filter((call) => call.path === "document").length;
    if (locks) assert.equal(documents, 1, "only one window sends it");
  }
});

test("the old Admin and Studio open together on one store lose nothing: a job either sends or stays", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  // The old Admin keeps a job and starts sending it; Studio sends the same one at the same time.
  const oldQueue = old.createCaptureQueue({ store, send: async (record) => {
    const { path } = await sendCapture({ api: blog.api, capture: record, scaffold: SCAFFOLD });
    return { path, skipped: [] };
  } });
  assert.deepEqual(await oldQueue.add(capture(1)), { ok: true });
  const jobs = sender(blog, store);
  await jobs.start();
  await jobs.add(capture(2));
  await Promise.all([oldQueue.flush(), jobs.flush()]);
  assert.equal(blog.drafts.size, 2);
  assert.equal((await store.all()).length, 0);
});

test("a refused job is marked with its code and the next still goes; Try again sends it when asked", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  const jobs = sender(blog, store);
  await jobs.start();
  blog.refuse.set(idOf(1), fail(422, { code: "capture-id" }, "That capture id is not valid"));
  await store.put(makeRecord(capture(1), new Date("2026-11-13T10:00:00Z"), "dana"));
  await store.put(makeRecord(capture(2), new Date("2026-11-13T10:01:00Z"), "dana"));
  await jobs.flush();
  assert.equal(blog.drafts.has(idOf(2)), true);
  const [left] = await store.all();
  assert.equal(left.failed, true);
  assert.match(left.lastError, /^\[capture-id\]/);
  assert.equal(jobs.stateOf(jobs.entries()[0]), "refused");
  await jobs.flush();
  assert.equal(blog.calls.filter((call) => call.path === "document").length, 2, "a refused job is not hammered");
  blog.refuse.clear();
  await jobs.retry(idOf(1));
  assert.equal((await store.all()).length, 0);
});

test("sent before and deleted since: Send it again goes under a new id, and the old one only goes after the copy is kept", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  blog.drafts.set(idOf(1), { path: "posts/old.md", removed: true });
  await store.put(makeRecord(capture(1), new Date(), "dana"));
  const jobs = sender(blog, store);
  await jobs.start();
  await jobs.flush();
  assert.equal(jobs.stateOf(jobs.entries()[0]), "removed");
  assert.equal((await store.all())[0].sent.removed, true);
  await jobs.flush();
  assert.equal(blog.calls.filter((call) => call.path === "document").length, 1, "not sent by itself again");
  await jobs.sendAgain(idOf(1));
  assert.equal((await store.all()).length, 0);
  assert.equal(blog.drafts.size, 2);
  const fresh = [...blog.drafts.keys()].find((id) => id !== idOf(1));
  assert.match(fresh, /^[0-9a-f]{32}$/);
});

test("photos that couldn't go keep the job as Sent until she says Done", async () => {
  const blog = fakeBlog();
  blog.skip.add("b.jpg");
  const store = createMemoryStore();
  const jobs = sender(blog, store);
  await jobs.start();
  await jobs.add(capture(1));
  await jobs.flush();
  const [kept] = await store.all();
  assert.deepEqual(kept.sent, { path: "posts/roof-repair-in-elkins-000000.md", skipped: ["b.jpg"], audio: "" });
  assert.equal(jobs.stateOf(jobs.entries()[0]), "sent");
  await jobs.flush();
  assert.equal(blog.drafts.size, 1);
  await jobs.done(idOf(1));
  assert.equal((await store.all()).length, 0);
});

test("one saved while someone else was signed in waits for her; a newer or unreadable one is never sent or changed", async () => {
  const blog = fakeBlog();
  const store = createMemoryStore();
  const newer = { v: 2, id: idOf(8), shape: "from the future" };
  const broken = { v: 1, id: idOf(9), photos: "nope" };
  await store.put(newer);
  await store.put(broken);
  await store.put(makeRecord(capture(1), new Date(), "sam"));
  const jobs = sender(blog, store);
  await jobs.start();
  await jobs.flush();
  assert.equal(blog.drafts.size, 0);
  assert.equal(await store.get(idOf(8)), newer);
  assert.equal(await store.get(idOf(9)), broken);
  const states = Object.fromEntries(jobs.entries().map((entry) => [entry.id, jobs.stateOf(entry)]));
  assert.deepEqual(states, { [idOf(8)]: "newer", [idOf(9)]: "unreadable", [idOf(1)]: "someone-else" });
  await jobs.sendAs(idOf(1));
  assert.equal(blog.drafts.size, 1);
  assert.equal(await store.get(idOf(8)), newer);
});

test("a phone that never kept a job gets no database: not on a site that isn't a trade site, not without asking", async () => {
  const blog = fakeBlog();
  let opened = 0;
  const make = (exists, trade) => createJobSender({ api: blog.api, meta: { siteUses: { trade } }, win: fakeWindow(), exists: async () => exists, openStore: async () => { opened += 1; return createMemoryStore(); } });
  assert.equal(await make(false, false).start(), false);
  assert.equal(await make(false, true).start(), false, "not even on a trade site, until a job is kept");
  assert.equal(await make(null, false).start(), false, "a browser that can't say: only on a trade site");
  assert.equal(opened, 0);
  assert.equal(await make(null, true).start(), true);
  assert.equal(await make(true, false).start(), true, "something waiting on any site: the list shows and sends");
  assert.equal(opened, 2);
  const keeper = make(false, false);
  assert.equal((await keeper.add(capture(1))).ok, true, "keeping a job makes it");
});

test("a window that can't keep anything says so, and the queue is never written there", async () => {
  const blog = fakeBlog();
  const jobs = createJobSender({ api: blog.api, meta: {}, win: fakeWindow(), exists: async () => null, openStore: async () => null });
  assert.deepEqual(await jobs.add(capture(1)), { ok: false, code: "no-store" });
  assert.equal(jobs.unusable(), true);
  const sent = await jobs.sendDirect(capture(1));
  assert.equal(sent.path, "posts/roof-repair-in-elkins-000000.md");
});

test("a queue over the same store sees what the sender changed", async () => {
  const store = createMemoryStore();
  const queue = createCaptureQueue({ store });
  await queue.add(capture(1), new Date(), "dana");
  await queue.refresh();
  assert.equal(queue.entries()[0].record.by, "dana");
});

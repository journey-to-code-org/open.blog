// Sending the jobs waiting on this phone (Studio R4, docs/specs/studio/r4/ux.md "Sending"). One
// sender per window, started by the shell, so a job saved with no signal goes when the signal comes
// back, whichever screen is open. The first half is plain functions (tested in
// tests/web/studio-job-sender.test.mjs); `createJobSender` wires them to the browser.
//
// - Never makes the database on a phone that never kept a job: it opens only when the browser lists
//   it, or (when the browser can't say) on a trade site or New job, or to keep a job.
// - Oldest first. Stops at the first "no signal" or "sign in again"; a job her blog refused is
//   marked and the next goes.
// - One window sends a job at a time (Web Lock `openblog-capture:<id>`); the others hear "changed"
//   on `BroadcastChannel("openblog-capture")`. Without locks the server's idempotency keeps it to one
//   draft (ADR 0297).
// - A record is removed only after `document` answered with a path; with photos that couldn't go it
//   stays as `sent` until she says Done.
import { createCaptureQueue, errorCode, errorText, isRetryable, openIndexedStore, queueLimits, storeExists, DB_NAME } from "./capture-queue.js";
import { captureBody, captureFields, isPermanentPhotoError, newCaptureId } from "./new-job-rules.js";

const MIN_TIME_MS = 60_000;
const BYTES_PER_SECOND = 25 * 1024;

/** How long one request may take: a minute, or longer for a big photo on a slow signal. */
export const timeLimit = (bytes = 0) => Math.max(MIN_TIME_MS, Math.ceil((bytes / BYTES_PER_SECOND) * 1000));

/** When to try again after the `tries`-th "no signal": 30 s, 1 min, 2 min, then every 5 min. */
export function retryDelay(tries) {
  return [30_000, 60_000, 120_000][Math.max(0, tries - 1)] ?? 300_000;
}

const limitSignal = (bytes) => (typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeLimit(bytes)) : undefined);

/**
 * Send one job: ask what the server already has (G29), each photo not there yet, the voice note,
 * then the draft. Photos and a voice note her blog refuses for good are skipped and named. Anything
 * else is thrown for the caller, with `step` set to where it stopped. `onStep({ step, index, total })`
 * hears each step. `retry` is api.call's (false: never ask her to sign in from here).
 * Resolves `{ path, skipped, audio, duplicate, removed }`.
 */
export async function sendCapture({ api, capture, scaffold = "", services = [], now = new Date(), retry = false, onStep = () => {} }) {
  const call = (method, path, options = {}, bytes = 0) => api.call(method, path, { retry, signal: limitSignal(bytes), ...options });
  let have = { photos: [], audio: false, draft: null };
  try {
    have = { ...have, ...(await call("GET", `capture?id=${capture.id}`)) };
  } catch (error) {
    // A server from before R4 doesn't know the question; it still makes one draft.
    if (error?.status !== 404 && error?.status !== 405) throw Object.assign(error, { step: "check" });
  }
  const stored = new Map((Array.isArray(have.photos) ? have.photos : []).map((photo) => [photo.slot, photo.url]));
  const photoUrls = [];
  const skipped = [];
  if (!have.draft) {
    for (const [slot, photo] of capture.photos.entries()) {
      if (stored.has(slot)) {
        photoUrls.push(stored.get(slot));
        continue;
      }
      onStep({ step: "photo", index: slot + 1, total: capture.photos.length });
      try {
        const query = new URLSearchParams({ name: photo.name, capture: capture.id, slot: String(slot) });
        const sent = await call("POST", `upload?${query}`, { body: photo.blob, headers: { "Content-Type": "application/octet-stream" } }, photo.size);
        photoUrls.push(sent.url);
      } catch (error) {
        if (!isPermanentPhotoError(error)) throw Object.assign(error, { step: "photo" });
        skipped.push(photo.name);
      }
    }
  } else {
    photoUrls.push(...stored.values());
  }
  // The voice note is kept privately beside the draft, never in its body (ADR 0298).
  let audio = capture.audio ? (have.audio ? "kept" : "none") : "none";
  if (capture.audio && !have.audio && !have.draft) {
    onStep({ step: "audio" });
    try {
      await call("POST", `capture-audio?capture=${capture.id}`, { body: capture.audio.blob, headers: { "Content-Type": "application/octet-stream" } }, capture.audio.size);
      audio = "kept";
    } catch (error) {
      if (!isPermanentPhotoError(error)) throw Object.assign(error, { step: "audio" });
      audio = "refused";
    }
  }
  onStep({ step: "document" });
  let saved;
  try {
    saved = await call("POST", "document", {
      json: {
        kind: "posts",
        captureId: capture.id,
        fields: captureFields(capture, now, services),
        body: captureBody({ scaffold, notes: capture.fields.notes, photoUrls, draft: capture.fields.draft }),
      },
    });
  } catch (error) {
    throw Object.assign(error, { step: "document" });
  }
  if (typeof saved?.path !== "string" || !saved.path) throw Object.assign(new Error("No path"), { status: 502, step: "document" });
  return { path: saved.path, skipped, audio, duplicate: saved.duplicate === true, removed: saved.status === "removed" };
}

/**
 * What a failed send means: `{ kind, code }`. `waiting` (no signal: `offline`; her blog didn't answer:
 * `server`), `signin`, or `refused` (`capture-id`, `ledger-version`, `refused`).
 */
export function sendOutcome(error) {
  const status = error?.status;
  if (status === 401 || (status === 403 && /csrf/i.test(String(error?.message || "")))) return { kind: "signin", code: "signin" };
  if (status === 403) return { kind: "signin", code: "signin" };
  if (isRetryable(error)) return { kind: "waiting", code: status >= 500 ? "server" : "offline" };
  const code = error?.data?.code;
  if (code === "capture-id" || code === "ledger-version") return { kind: "refused", code };
  return { kind: "refused", code: "refused" };
}

/**
 * Where a waiting job stands, for its card: `waiting`, `tried` (no signal last time), `sending`,
 * `signin`, `refused`, `removed` (sent before, deleted there since), `sent` (a photo couldn't go),
 * `someone-else` (saved while another person was signed in), `newer`, `unreadable`.
 * `live` is this window's own knowledge: `{ sending, signin }`.
 */
export function entryState(entry, user = "", live = {}) {
  if (entry.state === "newer") return "newer";
  if (entry.state !== "ok") return "unreadable";
  const record = entry.record;
  if (live.sending) return "sending";
  if (record.sent?.removed) return "removed";
  if (record.sent) return "sent";
  if (record.by && user && record.by !== user) return "someone-else";
  if (record.failed) return "refused";
  if (live.signin) return "signin";
  return record.attempts ? "tried" : "waiting";
}

/** Whether a job goes when the sender runs by itself. */
export const sendsByItself = (state) => state === "waiting" || state === "tried" || state === "signin";

/** A copy to send again under a new id (Send it again): what she made, nothing about earlier tries. */
export function freshCopy(raw, id, user = "") {
  const { sent: _sent, ...rest } = raw;
  return { ...rest, id, attempts: 0, failed: false, lastError: "", ...(user ? { by: user } : {}) };
}

/** "Sending photo 3 of 4…", "Sending the voice note…", "Making the draft…". */
export function stepWords({ step, index, total } = {}) {
  if (step === "photo") return `Sending photo ${index} of ${total}…`;
  if (step === "audio") return "Sending the voice note…";
  if (step === "document") return "Making the draft…";
  return "Sending…";
}

// ---------------------------------------------------------------------------------------------
// The browser half.

/**
 * `{ api, meta, title(record) }`. Returns the sender: `start(options)`, `ensure()`, `add(capture)`,
 * `flush({ manual })`, `sendNow(id)`, `retry(id)`, `sendAgain(id)`, `sendAs(id)`, `done(id)`,
 * `discard(id)`, `entries()`, `stateOf(entry)`, `live(id)`, `sentThisVisit()`, `subscribe(fn)`,
 * `watch(on)`, `available()`, `reload()`.
 */
export function createJobSender({
  api, meta = {}, title = (record) => record.id, win = globalThis, factory = globalThis.indexedDB,
  exists = () => storeExists(factory), openStore = () => openIndexedStore(factory),
}) {
  const limits = queueLimits(meta);
  const listeners = new Set();
  const live = new Map(); // id → { sending, step, signin, triedAt, code }
  const sentHere = [];
  let queue = null;
  let store = null;
  let opening = null;
  let flushing = null;
  let again = false;
  let tries = 0;
  let timer = 0;
  let watching = false;
  let unusable = false;
  let channel = null;

  const emit = (event = { type: "change" }) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A screen that's gone doesn't stop the others hearing.
      }
    }
  };
  const tell = () => channel?.postMessage?.("changed");
  const liveOf = (id) => {
    if (!live.has(id)) live.set(id, {});
    return live.get(id);
  };

  /** A list another window's update closed is forgotten, so the next call opens it again. */
  function forgetClosed() {
    if (store?.closed) {
      queue = null;
      store = null;
    }
  }

  /** `reopen`: it was open a moment ago, so failing now isn't a window that can't keep jobs. */
  async function open(create, { reopen = false } = {}) {
    forgetClosed();
    if (queue) return queue;
    if (opening) return opening;
    opening = (async () => {
      const there = reopen || (await exists());
      if (!create && there === false) return null;
      if (!create && there === null && !(meta.siteUses?.trade === true)) return null;
      store = await openStore();
      if (!store) {
        if (!reopen) unusable = create;
        return null;
      }
      const opened = createCaptureQueue({ store, limits, onChange: () => emit() });
      try {
        await opened.refresh();
      } catch {
        return null;
      }
      queue = opened;
      listen();
      return queue;
    })().finally(() => { opening = null; });
    return opening;
  }

  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    win.addEventListener?.("online", () => flush());
    win.document?.addEventListener?.("visibilitychange", () => {
      if (win.document.visibilityState === "visible") reload().then(() => flush());
    });
    win.addEventListener?.("focus", () => reload());
    try {
      channel = typeof win.BroadcastChannel === "function" ? new win.BroadcastChannel(DB_NAME) : null;
      if (channel) channel.onmessage = () => reload();
    } catch {
      channel = null;
    }
  }

  async function reload() {
    if (!queue) return;
    try {
      await queue.refresh();
    } catch {
      // The database closed for another page's upgrade: what's shown stays until it's back.
    }
  }

  /** Run `task` holding this job's lock, or not at all when another window holds it. */
  async function locked(id, task) {
    const locks = win.navigator?.locks;
    if (!locks?.request) return task();
    return locks.request(`${DB_NAME}:${id}`, { ifAvailable: true }, async (lock) => (lock ? task() : "busy"));
  }

  function schedule() {
    clearTimeout(timer);
    timer = 0;
    if (!watching || !tries) return;
    timer = setTimeout(() => flush(), retryDelay(tries));
  }

  async function ensureSession(retry) {
    if (api.csrf) return;
    await api.call("GET", "session", { retry: false }).then((reply) => {
      api.csrf = reply.csrf;
      api.user = reply.user;
    }).catch(async (error) => {
      if (error?.status === 401 && retry && api.onSignedOut) return api.onSignedOut();
      throw error;
    });
  }

  async function sendOne(entry, { manual }) {
    const id = entry.id;
    const state = liveOf(id);
    return locked(id, async () => {
      // Another window may have sent it a moment ago.
      const current = (await queue.refresh()).find((item) => item.id === id);
      if (!current || current.state !== "ok" || current.record.sent) return "gone";
      state.sending = true;
      state.step = null;
      emit();
      try {
        await ensureSession(manual);
        const result = await sendCapture({
          api, capture: current.record, scaffold: meta.job?.scaffold || "", services: meta.job?.services || [],
          now: new Date(current.record.createdAt), retry: manual,
          onStep: (step) => { state.step = step; emit({ type: "step", id, step }); },
        });
        state.sending = false;
        state.signin = false;
        if (result.removed) {
          await queue.update(id, { sent: { path: result.path, skipped: [], removed: true } });
        } else if (result.skipped.length || result.audio === "refused") {
          await queue.update(id, { sent: { path: result.path, skipped: result.skipped, audio: result.audio === "refused" ? "refused" : "" } });
        } else {
          await queue.remove(id);
        }
        tell();
        if (!result.removed) {
          sentHere.push({ id, title: title(current.record), path: result.path });
          emit({ type: "sent", id, title: title(current.record), path: result.path, quiet: result.duplicate && !manual, skipped: result.skipped, audio: result.audio });
        }
        return "sent";
      } catch (error) {
        state.sending = false;
        const outcome = sendOutcome(error);
        state.code = outcome.code;
        state.triedAt = new Date();
        state.status = error?.status ?? 0;
        state.error = String(error?.message || "").slice(0, 200);
        if (outcome.kind === "signin") {
          state.signin = true;
          return "signin";
        }
        if (outcome.kind === "waiting") {
          await queue.update(id, { attempts: current.record.attempts + 1, lastError: errorText(outcome.code, outcome.code === "server" ? "Your blog didn't answer." : "Waiting for a signal.") }).catch(() => {});
          return "waiting";
        }
        await queue.update(id, { attempts: current.record.attempts + 1, failed: true, lastError: errorText(outcome.code, error?.message || "") }).catch(() => {});
        return "refused";
      } finally {
        state.sending = false;
        await reload();
        emit();
      }
    });
  }

  /**
   * Send what's waiting, oldest first. `manual` (Send now, Try again) may ask her to sign in;
   * otherwise a 401 marks the job "Needs you". `only` limits it to one job. Resolves
   * `{ sent, blocked }` (`blocked`: "", "waiting" or "signin").
   */
  function flush({ manual = false, only = "" } = {}) {
    // Asked again while sending (a job kept a moment ago): one more pass after this one.
    if (flushing && !manual) {
      again = true;
      return flushing;
    }
    const run = async () => {
      if (store?.closed) await open(true, { reopen: true });
      if (!queue) return { sent: 0, blocked: "" };
      let sent = 0;
      let blocked = "";
      await reload();
      const todo = queue.entries().filter((entry) => (only ? entry.id === only : sendsByItself(entryState(entry, api.user, live.get(entry.id))) || (manual && entryState(entry, api.user, live.get(entry.id)) === "signin")));
      emit({ type: "flush", total: todo.length });
      for (const entry of todo) {
        const outcome = await sendOne(entry, { manual });
        if (outcome === "sent") sent += 1;
        if (outcome === "waiting" || outcome === "signin") {
          blocked = outcome;
          break;
        }
      }
      tries = blocked === "waiting" ? tries + 1 : 0;
      schedule();
      emit({ type: "flushed", sent, blocked });
      return { sent, blocked };
    };
    const passes = async () => {
      let result;
      do {
        again = false;
        try {
          result = await run();
        } catch {
          // The list closed under it (another page upgrading it, the phone out of room): nothing
          // was removed, and the next try reads it again.
          result = { sent: 0, blocked: "waiting" };
          emit({ type: "flushed", ...result });
        }
      } while (again && !result.blocked && !only);
      return result;
    };
    const job = (flushing ? flushing.then(passes, passes) : passes()).finally(() => { if (flushing === job) flushing = null; });
    flushing = job;
    return job;
  }

  return {
    /** Open the list if this phone has one (or `create`: make it, to keep a job). Then send what waits. */
    async start({ create = false } = {}) {
      const opened = await open(create);
      if (opened) flush();
      return Boolean(opened);
    },
    ensure: () => open(true),
    available: () => Boolean(queue),
    /** This window can't keep jobs (private mode, a policy): jobs send straight away instead. */
    unusable: () => unusable,
    async add(capture) {
      const wasOpen = Boolean(store);
      if (!(await open(true, { reopen: wasOpen }))) return { ok: false, code: wasOpen ? "closed" : "no-store" };
      let kept = await queue.add(capture, new Date(), api.user);
      if (!kept.ok && kept.code === "closed") {
        // Closed under it (another window's update): open it again and try once more.
        if (typeof store.close === "function") store.close();
        else store.closed = true;
        kept = (await open(true, { reopen: true })) ? await queue.add(capture, new Date(), api.user) : { ok: false, code: "closed" };
      }
      if (kept.ok) {
        tell();
        tries = 0;
        flush();
      }
      return kept;
    },
    /** Send a job straight away without keeping it (a window that can't keep anything). */
    async sendDirect(capture) {
      return sendCapture({ api, capture: { ...capture, createdAt: new Date().toISOString() }, scaffold: meta.job?.scaffold || "", services: meta.job?.services || [], retry: true });
    },
    flush,
    sendNow: () => flush({ manual: true }),
    async retry(id) {
      await queue.update(id, { failed: false, lastError: "" });
      return flush({ manual: true, only: id });
    },
    /** Sent before and deleted there since: a copy under a new id, then the old one goes. */
    async sendAgain(id) {
      if (!queue) return null;
      const fresh = newCaptureId();
      const moved = await locked(id, async () => {
        const value = await store.get(id);
        if (!value) return "gone";
        // The copy first, so the job is never only in memory.
        await store.put(freshCopy(value, fresh, api.user));
        await queue.remove(id);
        return "ok";
      });
      live.delete(id);
      tell();
      await reload();
      return moved === "ok" ? flush({ manual: true, only: fresh }) : null;
    },
    /** Saved while someone else was signed in on this phone: send it as her. */
    async sendAs(id) {
      await queue.update(id, { by: api.user, failed: false, lastError: "" });
      return flush({ manual: true, only: id });
    },
    /** Sent, with photos that couldn't go: she's seen it. */
    async done(id) {
      await queue.remove(id);
      tell();
      await reload();
    },
    /** She threw it away. False when it's being sent (here or in another window): nothing is removed. */
    async discard(id) {
      if (live.get(id)?.sending) return false;
      const done = await locked(id, async () => {
        await queue.discard(id);
        return "gone";
      });
      if (done !== "gone") return false;
      live.delete(id);
      tell();
      await reload();
      return true;
    },
    entries: () => (queue ? queue.entries() : []),
    stateOf: (entry) => entryState(entry, api.user, live.get(entry.id)),
    live: (id) => live.get(id) || {},
    sentThisVisit: () => [...sentHere],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** New job or Home is in view: keep trying after "no signal" (30 s, 1, 2, then every 5 min). */
    watch(on) {
      watching = on;
      schedule();
    },
    reload,
  };
}

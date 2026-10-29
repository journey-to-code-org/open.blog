// Delivery status and history of an announcement (epic #353, story #359, ADR 0700): the seven
// delivery states, what the author may do in each, the recorded history and the one rebuilt from
// the attempts, and the hosted route that serves them. Storage is an in-memory fake.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DELIVERY_STATES, NEXT_STEPS, deliveryState, derivedTimeline, stateOf, timelineFromEvents } from "../../netlify/lib/social-status.mjs";
import { createAnnouncements } from "../../netlify/lib/social-announcements.mjs";
import { socialSettings } from "../../netlify/lib/social-scope.mjs";
import { ADMIN_KEY, SERVICE_KEY, SITE, T0, WORKER_KEY, env, queueStorage } from "./social-queue-fakes.mjs";

const iso = (ms) => new Date(ms).toISOString();

test("every stored status has exactly one delivery state, and a scheduled one is pending until something went wrong", () => {
  assert.deepEqual(DELIVERY_STATES, ["pending", "processing", "retrying", "published", "failed", "unknown", "canceled"]);
  assert.equal(stateOf("scheduled"), "pending");
  assert.equal(stateOf("scheduled", "deferred"), "pending", "a run that gave the attempt back unused is not a problem");
  for (const code of ["provider-unavailable", "rate-limited", "lease-expired", "credential-error"]) assert.equal(stateOf("scheduled", code), "retrying", code);
  assert.equal(stateOf("claimed"), "processing");
  for (const status of ["published", "failed", "unknown", "canceled"]) assert.equal(stateOf(status, "x"), status);
  assert.equal(stateOf("bogus"), null);
  assert.equal(stateOf("__proto__"), null);
  assert.equal(stateOf("scheduled", "Not A Code"), "pending", "a malformed code is not read as a problem");
  assert.equal(deliveryState({ status: "scheduled", last_error_code: "rate-limited" }), "retrying");
  assert.equal(deliveryState(null), null);
});

test("the author is offered only what the hosted routes would allow in each state", () => {
  assert.deepEqual(Object.keys(NEXT_STEPS).sort(), [...DELIVERY_STATES].sort());
  assert.deepEqual(NEXT_STEPS.pending.actions, ["edit", "cancel"]);
  assert.deepEqual(NEXT_STEPS.retrying.actions, ["edit", "cancel"]);
  assert.deepEqual(NEXT_STEPS.processing.actions, []);
  assert.deepEqual(NEXT_STEPS.failed.actions, ["retry"]);
  assert.deepEqual(NEXT_STEPS.unknown.actions, ["resolve"], "an outcome that may have posted is never offered a retry");
  assert.deepEqual(NEXT_STEPS.published.actions, []);
  assert.deepEqual(NEXT_STEPS.canceled.actions, []);
});

test("the SQL and the JavaScript say the same thing about delivery states", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../supabase/social-history.sql", import.meta.url)), "utf8").replace(/\s+/g, " ");
  assert.match(sql, /when p_status = 'scheduled' and \(p_code is null or p_code = 'deferred'\) then 'pending'/);
  assert.match(sql, /when p_status = 'scheduled' then 'retrying'/);
  assert.match(sql, /when p_status = 'claimed' then 'processing'/);
  assert.match(sql, /check \(state in \('pending', 'processing', 'retrying', 'published', 'failed', 'unknown', 'canceled'\)\)/);
});

test("recorded events are read only in their recorded shape", () => {
  const rows = [
    { at: "2026-11-01T12:00:00.123+00:00", change: "created", state: "pending", attempt_no: 0, code: null, scheduled_for: "2026-11-02T09:00:00+00:00", site_id: SITE, post_id: "x", id: 1 },
    { at: "2026-11-01T12:01:00Z", change: "status", state: "retrying", attempt_no: 1, code: "rate-limited" },
    { at: "not a time", change: "status", state: "failed", attempt_no: 2 },
    { at: "2026-11-01T12:02:00Z", change: "status", state: "exploded", attempt_no: 2 },
    { at: "2026-11-01T12:03:00Z", change: "hacked", state: "failed", attempt_no: 2 },
    { at: "2026-11-01T12:04:00Z", change: "note", state: "unknown", attempt_no: -1, code: "Bearer sk_live_123" },
  ];
  const timeline = timelineFromEvents(rows);
  assert.deepEqual(timeline, [
    { at: "2026-11-01T12:00:00Z", change: "created", state: "pending", attemptNo: 0, code: null, scheduledFor: "2026-11-02T09:00:00Z" },
    { at: "2026-11-01T12:01:00Z", change: "status", state: "retrying", attemptNo: 1, code: "rate-limited", scheduledFor: null },
    { at: "2026-11-01T12:04:00Z", change: "note", state: "unknown", attemptNo: 0, code: null, scheduledFor: null },
  ]);
  assert.deepEqual(timelineFromEvents("nope"), []);
});

test("a history rebuilt from the attempts shows each try and ends where the announcement is now", () => {
  const row = { status: "failed", created_at: iso(T0), updated_at: iso(T0 + 600_000), attempt_count: 2, last_error_code: "provider-rejected" };
  const attempts = [
    { attempt_no: 2, started_at: iso(T0 + 300_000), finished_at: iso(T0 + 301_000), outcome: "failed", error_code: "provider-rejected" },
    { attempt_no: 1, started_at: iso(T0 + 60_000), finished_at: iso(T0 + 61_000), outcome: "failed", error_code: "rate-limited" },
  ];
  assert.deepEqual(
    derivedTimeline(row, attempts).map((e) => [e.state, e.attemptNo, e.code]),
    [["pending", 0, null], ["processing", 1, null], ["retrying", 1, "rate-limited"], ["processing", 2, null], ["failed", 2, "provider-rejected"]],
  );
  // A person resolved an unknown outcome as published: the attempt says so; the history says so.
  const settled = derivedTimeline({ status: "published", created_at: iso(T0), updated_at: iso(T0 + 900_000), attempt_count: 1 }, [{ attempt_no: 1, started_at: iso(T0 + 60_000), finished_at: iso(T0 + 61_000), outcome: "published" }]);
  assert.deepEqual(settled.map((e) => e.state), ["pending", "processing", "published"]);
  // A failed one the author put back in the queue: the live row adds where it is now.
  const back = derivedTimeline({ status: "scheduled", created_at: iso(T0), updated_at: iso(T0 + 900_000), attempt_count: 1, last_error_code: null }, [{ attempt_no: 1, started_at: iso(T0 + 60_000), finished_at: iso(T0 + 61_000), outcome: "failed", error_code: "attempts-exhausted" }]);
  assert.deepEqual(back.map((e) => e.state), ["pending", "processing", "failed", "pending"]);
  // In flight, and canceled.
  assert.deepEqual(derivedTimeline({ status: "claimed", created_at: iso(T0), updated_at: iso(T0), attempt_count: 1 }, [{ attempt_no: 1, started_at: iso(T0 + 1000), finished_at: null }]).map((e) => e.state), ["pending", "processing"]);
  assert.deepEqual(derivedTimeline({ status: "canceled", created_at: iso(T0), updated_at: iso(T0 + 5000), canceled_at: iso(T0 + 5000), attempt_count: 0 }, []).map((e) => e.state), ["pending", "canceled"]);
  assert.deepEqual(derivedTimeline(null, []), []);
});

function setup(storage = {}) {
  const fakes = queueStorage({ now: () => T0, ...storage });
  const handle = createAnnouncements({ settings: socialSettings(env()), fetchImpl: fakes.fetchImpl, now: () => T0 });
  const call = (route, query, headers = { authorization: `Bearer ${ADMIN_KEY}`, "x-openblog-actor": "mikey" }) => handle({ method: "GET", route, query, headers });
  return { ...fakes, call };
}

test("the history route rebuilds the timeline when the recorded history is not installed, and says so", async () => {
  const s = setup();
  const post = s.addPost({ status: "scheduled", attempt_count: 1, last_error_code: "provider-unavailable", next_attempt_at: iso(T0 + 60_000) });
  s.attempts.push({ id: "t1", site_id: SITE, post_id: post.id, attempt_no: 1, worker: "@worker", started_at: iso(T0 + 5000), finished_at: iso(T0 + 6000), outcome: "failed", error_code: "provider-unavailable", provider_request_id: "req-hidden" });
  const reply = await s.call("announcements/attempts", `id=${post.id}`);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.delivery, "retrying");
  assert.equal(reply.body.timelineExact, false);
  assert.deepEqual(reply.body.timeline.map((e) => [e.state, e.attemptNo, e.code]), [["pending", 0, null], ["processing", 1, null], ["retrying", 1, "provider-unavailable"]]);
  const list = (await s.call("announcements", "")).body.announcements;
  assert.equal(list[0].delivery, "retrying");
  assert.deepEqual(list[0].actions, ["edit", "cancel"]);
});

test("the history route serves the recorded history of this site's post only, and nothing secret", async () => {
  const events = [];
  const s = setup({ events });
  const post = s.addPost({ status: "failed", attempt_count: 1, last_error_code: "provider-rejected" });
  events.push(
    { id: 1, site_id: SITE, post_id: post.id, at: iso(T0), change: "created", status: "scheduled", state: "pending", attempt_no: 0, code: null, scheduled_for: iso(T0 + 3600_000) },
    { id: 2, site_id: SITE, post_id: post.id, at: iso(T0 + 1000), change: "status", status: "failed", state: "failed", attempt_no: 1, code: "provider-rejected", scheduled_for: iso(T0 + 3600_000) },
  );
  const reply = await s.call("announcements/attempts", `id=${post.id}`);
  assert.equal(reply.status, 200);
  assert.equal(reply.body.timelineExact, true);
  assert.deepEqual(reply.body.timeline.map((e) => [e.change, e.state, e.code]), [["created", "pending", null], ["status", "failed", "provider-rejected"]]);
  const text = JSON.stringify(reply.body);
  for (const hidden of [SITE, SERVICE_KEY, ADMIN_KEY, WORKER_KEY, "@worker"]) assert.equal(text.includes(hidden), false, hidden);
  const asked = s.calls.find((c) => c.name === "openblog_social_post_events");
  assert.match(decodeURIComponent(asked.query), /site_id=eq\.lantern-studios/, "the read is scoped to this site");
  assert.ok(decodeURIComponent(asked.query).includes(`post_id=eq.${post.id}`));

  // Another site's event for the same post id is never shown.
  events.push({ id: 3, site_id: "other-site", post_id: post.id, at: iso(T0 + 2000), change: "status", status: "failed", state: "failed", attempt_no: 1 });
  const foreign = await s.call("announcements/attempts", `id=${post.id}`);
  assert.equal(foreign.body.timeline.length, 2);

  // Only the admin key reads it.
  assert.equal((await s.call("announcements/attempts", `id=${post.id}`, { authorization: `Bearer ${WORKER_KEY}` })).status, 403);
  assert.equal((await s.call("announcements/attempts", `id=${post.id}`, {})).status, 401);
  assert.equal((await s.call("announcements/attempts", `id=${post.id}&site_id=other`)).status, 400);
});

test("a history store that fails is a fixed error, never a guess", async () => {
  const s = setup({ failGet: (name) => name === "openblog_social_post_events", events: [] });
  const post = s.addPost({});
  const reply = await s.call("announcements/attempts", `id=${post.id}`);
  assert.equal(reply.status, 502);
  assert.equal(reply.body.code, "storage-failed");
  assert.equal(JSON.stringify(reply.body).includes("secret"), false);
});

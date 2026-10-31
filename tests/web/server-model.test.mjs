import test from "node:test";
import assert from "node:assert/strict";
import {
  createServerLab, applyServerAction, presentServerLab, serverActions, normalizeServerLesson,
} from "../../web/components/ob-server-model.js";

const run = (state, ...actions) => actions.reduce(applyServerAction, state);

test("an unknown server lesson safely chooses connections", () => {
  assert.equal(normalizeServerLesson("nope"), "connections");
  assert.equal(createServerLab("nope").lesson, "connections");
});

test("a sequential server leaves the second connection waiting until the first leaves", () => {
  let state = run(createServerLab("connections"), "connect-alice", "connect-bob", "send-bob");
  assert.equal(state.clients.find(({ id }) => id === "bob").status, "waiting");
  assert.match(state.log.at(-1), /bytes wait/);
  state = applyServerAction(state, "disconnect-alice");
  assert.equal(state.clients.find(({ id }) => id === "bob").status, "active");
});

test("the waiting connection names whichever client owns the sequential handler", () => {
  const state = run(createServerLab("connections"), "connect-bob", "connect-alice");
  assert.match(state.log.at(-1), /Bob's handler/);
  assert.match(state.clients.find(({ id }) => id === "alice").detail, /Queued by the OS/);
});

test("a worker per client keeps the accept loop free", () => {
  const state = run(createServerLab("connections"), "mode-threaded", "connect-alice", "connect-bob");
  assert.deepEqual(state.clients.map(({ status }) => status), ["active", "active"]);
  assert.match(presentServerLab(state).server, /accept loop stays free/);
});

test("mutex and actor worlds process queued commands one at a time", () => {
  for (const architecture of ["mutex", "actor"]) {
    let state = run(createServerLab("world", architecture), "queue-alice", "queue-bob", "advance");
    assert.equal(state.current.command, "say hello");
    assert.equal(state.queue.length, 1);
    state = applyServerAction(state, "advance");
    assert.equal(state.current, null);
    assert.match(state.log.at(-1), architecture === "mutex" ? /released the lock/ : /receive the next message/);
  }
});

test("async tasks yield while thread workers remain allocated", () => {
  const threads = createServerLab("async", "threads");
  const tasks = createServerLab("async", "tasks");
  assert.match(presentServerLab(threads).server, /3 worker threads; 3 blocked/);
  assert.match(presentServerLab(tasks).server, /waiting tasks occupy no dedicated thread/);
  const ready = applyServerAction(tasks, "ready-bob");
  assert.match(presentServerLab(ready).server, /1 runnable task/);
});

test("select handles the first ready event and leaves later events queued", () => {
  let state = run(createServerLab("select"), "event-world", "event-input", "select-next");
  assert.equal(state.events.length, 1);
  assert.match(state.log.at(-1), /world message branch/);
  state = run(state, "event-shutdown", "select-next", "select-next");
  assert.equal(state.closed, true);
  assert.equal(state.clients[0].status, "closed");
});

test("disabled actions expose why the model cannot advance", () => {
  let state = createServerLab("world");
  const advance = serverActions(state).find(({ id }) => id === "advance");
  assert.equal(advance.disabled, true);
  state = applyServerAction(state, "queue-alice");
  assert.equal(serverActions(state).find(({ id }) => id === "queue-alice").disabled, true);
  assert.equal(applyServerAction(state, "queue-alice"), state);
});

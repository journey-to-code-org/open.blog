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
  let state = run(createServerLab("connections"), "connect-bryce", "connect-ryan", "send-ryan");
  assert.equal(state.clients.find(({ id }) => id === "ryan").status, "waiting");
  assert.match(state.log.at(-1), /bytes wait/);
  state = applyServerAction(state, "disconnect-bryce");
  assert.equal(state.clients.find(({ id }) => id === "ryan").status, "active");
});

test("the waiting connection names whichever client owns the sequential handler", () => {
  const state = run(createServerLab("connections"), "connect-ryan", "connect-bryce");
  assert.match(state.log.at(-1), /Ryan's handler/);
  assert.match(state.clients.find(({ id }) => id === "bryce").detail, /Queued by the OS/);
});

test("a worker per client keeps the accept loop free", () => {
  const state = run(createServerLab("connections"), "mode-threaded", "connect-bryce", "connect-ryan");
  assert.deepEqual(state.clients.map(({ status }) => status), ["active", "active"]);
  assert.match(presentServerLab(state).server, /accept loop stays free/);
});

test("mutex and actor worlds process queued commands one at a time", () => {
  for (const architecture of ["mutex", "actor"]) {
    let state = run(createServerLab("world", architecture), "queue-bryce", "queue-ryan", "advance");
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
  const ready = applyServerAction(tasks, "ready-ryan");
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
  state = applyServerAction(state, "queue-bryce");
  assert.equal(serverActions(state).find(({ id }) => id === "queue-bryce").disabled, true);
  assert.equal(applyServerAction(state, "queue-bryce"), state);
});

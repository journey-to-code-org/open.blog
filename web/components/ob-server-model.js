// Pure model behind <ob-server-lab>. It simulates the scheduling and ownership
// decisions in a multiplayer server; it never opens a socket, starts a thread,
// stores data or waits on a real clock.

export const SERVER_LESSONS = [
  { id: "connections", label: "Connections", note: "Compare one blocking connection loop with one worker per client." },
  { id: "world", label: "Shared world", note: "Queue commands, then compare a mutex with one world owner." },
  { id: "async", label: "Async waiting", note: "See the same waiting clients occupy threads or sleep as tasks." },
  { id: "select", label: "select!", note: "Make several sources ready and handle one branch. The simulator chooses the earliest event so its trace stays repeatable; real select! does not promise FIFO ordering among ready branches." },
];

const CLIENTS = [
  { id: "alice", label: "Alice" },
  { id: "bob", label: "Bob" },
  { id: "cara", label: "Cara" },
];

const lessonIds = new Set(SERVER_LESSONS.map(({ id }) => id));
export const normalizeServerLesson = (lesson) => lessonIds.has(lesson) ? lesson : "connections";

const client = ({ id, label }, status = "disconnected", detail = "Not connected") => ({ id, label, status, detail });
const copy = (state) => ({
  ...state,
  clients: state.clients.map((item) => ({ ...item })),
  queue: state.queue.map((item) => typeof item === "string" ? item : { ...item }),
  events: state.events?.map((item) => ({ ...item })) ?? [],
  log: [...state.log],
  current: state.current ? { ...state.current } : null,
});

function initialConnections(architecture = "sequential") {
  return {
    lesson: "connections", architecture,
    clients: CLIENTS.slice(0, 2).map((item) => client(item)),
    queue: [], events: [], current: null,
    log: [architecture === "sequential"
      ? "The server calls accept(), then handles one client before accepting another."
      : "The accept loop gives each connection to its own worker."],
  };
}

function initialWorld(architecture = "mutex") {
  return {
    lesson: "world", architecture,
    clients: CLIENTS.slice(0, 2).map((item) => client(item, "ready", "Ready to send a command")),
    queue: [], events: [], current: null,
    log: [architecture === "mutex"
      ? "Connection workers share the World through Arc<Mutex<World>>."
      : "Connection workers send messages to the one task that owns the World."],
  };
}

function initialAsync(architecture = "threads") {
  return {
    lesson: "async", architecture,
    clients: CLIENTS.map((item) => client(item, "waiting", architecture === "threads" ? "Thread blocked on input" : "Task asleep until input is ready")),
    queue: [], events: [], current: null,
    log: [architecture === "threads"
      ? "Three connected players occupy three workers, even while all three wait."
      : "Waiting tasks yield. A runtime thread can do other work."],
  };
}

function initialSelect() {
  return {
    lesson: "select", architecture: "select",
    clients: [client(CLIENTS[0], "waiting", "Waiting on three sources")],
    queue: [], events: [], current: null, closed: false,
    log: ["The connection task is waiting for player input, a world message, or shutdown."],
  };
}

export function createServerLab(lesson = "connections", architecture) {
  switch (normalizeServerLesson(lesson)) {
    case "world": return initialWorld(["mutex", "actor"].includes(architecture) ? architecture : "mutex");
    case "async": return initialAsync(["threads", "tasks"].includes(architecture) ? architecture : "threads");
    case "select": return initialSelect();
    default: return initialConnections(["sequential", "threaded"].includes(architecture) ? architecture : "sequential");
  }
}

const action = (id, label, group = "event", disabled = false) => ({ id, label, group, disabled });

export function serverActions(state) {
  const actions = [];
  if (state.lesson === "connections") {
    actions.push(
      action("mode-sequential", "One connection loop", "architecture", state.architecture === "sequential"),
      action("mode-threaded", "Worker per client", "architecture", state.architecture === "threaded"),
    );
    for (const item of state.clients) {
      if (item.status === "disconnected") actions.push(action(`connect-${item.id}`, `Connect ${item.label}`));
      else {
        actions.push(action(`send-${item.id}`, `${item.label}: look`));
        actions.push(action(`disconnect-${item.id}`, `Disconnect ${item.label}`));
      }
    }
  } else if (state.lesson === "world") {
    actions.push(
      action("mode-mutex", "Mutex", "architecture", state.architecture === "mutex"),
      action("mode-actor", "World owner", "architecture", state.architecture === "actor"),
      action("queue-alice", "Alice: say hello", "event", state.clients.find(({ id }) => id === "alice")?.status !== "ready"),
      action("queue-bob", "Bob: look", "event", state.clients.find(({ id }) => id === "bob")?.status !== "ready"),
      action("advance", state.current ? "Finish current command" : "Start next command", "event", !state.current && !state.queue.length),
    );
  } else if (state.lesson === "async") {
    actions.push(
      action("mode-threads", "Thread per client", "architecture", state.architecture === "threads"),
      action("mode-tasks", "Async tasks", "architecture", state.architecture === "tasks"),
    );
    for (const item of state.clients) {
      if (item.status === "waiting") actions.push(action(`ready-${item.id}`, `${item.label} sends input`));
    }
    actions.push(action("run-ready", "Run one ready client", "event", !state.clients.some((item) => item.status === "ready")));
  } else {
    actions.push(
      action("event-input", "Player input arrives", "event", state.closed),
      action("event-world", "World message arrives", "event", state.closed),
      action("event-shutdown", "Shutdown arrives", "event", state.closed),
      action("select-next", "Run select!", "event", state.closed || !state.events.length),
    );
  }
  actions.push(action("reset", "Reset", "reset"));
  return actions;
}

function addLog(state, message) {
  state.log = [...state.log, message].slice(-8);
  return state;
}

function setClient(state, id, status, detail) {
  const item = state.clients.find((entry) => entry.id === id);
  if (item) Object.assign(item, { status, detail });
  return item;
}

function connectionAction(state, id) {
  if (id.startsWith("mode-")) return initialConnections(id.slice(5));
  const next = copy(state);
  const [verb, clientId] = id.split("-");
  const item = next.clients.find((entry) => entry.id === clientId);
  if (!item) return state;
  if (verb === "connect" && item.status === "disconnected") {
    const handler = next.clients.find((entry) => entry.status === "active");
    const busy = next.architecture === "sequential" && Boolean(handler);
    setClient(next, clientId, busy ? "waiting" : "active", busy ? "Queued by the OS; the application has not returned to accept()" : "The server is reading this connection");
    return addLog(next, busy
      ? `${item.label} connected, but ${handler.label}'s handler still owns the one server loop.`
      : `${item.label} connected and has an active handler.`);
  }
  if (verb === "send") {
    return addLog(next, item.status === "waiting"
      ? `${item.label} sent "look". The bytes wait because no handler is reading them.`
      : `${item.label}'s handler read "look" and answered.`);
  }
  if (verb === "disconnect" && item.status !== "disconnected") {
    const wasActive = item.status === "active";
    setClient(next, clientId, "disconnected", "Not connected");
    if (next.architecture === "sequential" && wasActive) {
      const waiting = next.clients.find((entry) => entry.status === "waiting");
      if (waiting) setClient(next, waiting.id, "active", "The server returned to accept() and began reading this connection");
    }
    return addLog(next, `${item.label} disconnected.${next.architecture === "sequential" && wasActive ? " The server can accept the next client now." : ""}`);
  }
  return state;
}

function worldAction(state, id) {
  if (id === "mode-mutex") return initialWorld("mutex");
  if (id === "mode-actor") return initialWorld("actor");
  const next = copy(state);
  if (id === "queue-alice" || id === "queue-bob") {
    const from = id.slice(6);
    if (next.clients.find((entry) => entry.id === from)?.status !== "ready") return state;
    const command = from === "alice" ? "say hello" : "look";
    next.queue.push({ from, command });
    setClient(next, from, "queued", state.architecture === "mutex" ? "Waiting to lock the World" : "Message waiting in the World's inbox");
    return addLog(next, `${from === "alice" ? "Alice" : "Bob"} queued ${JSON.stringify(command)}.`);
  }
  if (id !== "advance") return state;
  if (!next.current && next.queue.length) {
    next.current = next.queue.shift();
    setClient(next, next.current.from, "running", next.architecture === "mutex" ? "Holds the World lock" : "The World owner is handling this message");
    return addLog(next, next.architecture === "mutex"
      ? `${next.current.from} acquired the lock. Other workers cannot enter the World yet.`
      : `The World owner received ${JSON.stringify(next.current.command)}. No other task can mutate its state.`);
  }
  if (next.current) {
    const done = next.current;
    next.current = null;
    setClient(next, done.from, "ready", "Ready to send a command");
    return addLog(next, next.architecture === "mutex"
      ? `${JSON.stringify(done.command)} finished and the guard released the lock.`
      : `${JSON.stringify(done.command)} finished. The World owner can receive the next message.`);
  }
  return state;
}

function asyncAction(state, id) {
  if (id === "mode-threads") return initialAsync("threads");
  if (id === "mode-tasks") return initialAsync("tasks");
  const next = copy(state);
  if (id.startsWith("ready-")) {
    const clientId = id.slice(6);
    const item = setClient(next, clientId, "ready", next.architecture === "threads" ? "Blocked read returned" : "Runtime marked the task ready");
    return item ? addLog(next, `${item.label}'s socket became readable.`) : state;
  }
  if (id === "run-ready") {
    const item = next.clients.find((entry) => entry.status === "ready");
    if (!item) return state;
    setClient(next, item.id, "waiting", next.architecture === "threads" ? "Thread blocked on input" : "Task asleep until input is ready");
    return addLog(next, next.architecture === "threads"
      ? `${item.label}'s worker handled one line, then blocked on read again.`
      : `A runtime worker polled ${item.label}'s task. It handled one line, then yielded again.`);
  }
  return state;
}

function selectAction(state, id) {
  const next = copy(state);
  if (id.startsWith("event-") && !next.closed) {
    const kind = id.slice(6);
    const labels = { input: "player input", world: "world message", shutdown: "shutdown" };
    next.events.push({ kind, label: labels[kind] });
    return addLog(next, `${labels[kind]} became ready.`);
  }
  if (id === "select-next" && next.events.length && !next.closed) {
    const event = next.events.shift();
    if (event.kind === "shutdown") {
      next.closed = true;
      setClient(next, "alice", "closed", "Connection task ended cleanly");
      return addLog(next, "select! chose shutdown. The task closed the connection and stopped waiting.");
    }
    return addLog(next, `select! chose the ${event.label} branch. The other ready sources are still waiting.`);
  }
  return state;
}

export function applyServerAction(state, id) {
  if (id === "reset") return createServerLab(state.lesson, state.architecture);
  switch (state.lesson) {
    case "world": return worldAction(state, id);
    case "async": return asyncAction(state, id);
    case "select": return selectAction(state, id);
    default: return connectionAction(state, id);
  }
}

export function presentServerLab(state) {
  const labels = {
    sequential: "One connection loop", threaded: "Worker per client",
    mutex: "Mutex-protected world", actor: "One world owner",
    threads: "Thread per client", tasks: "Async tasks", select: "tokio::select!",
  };
  let server;
  if (state.lesson === "connections") {
    const active = state.clients.filter((item) => item.status === "active").length;
    const waiting = state.clients.filter((item) => item.status === "waiting").length;
    server = state.architecture === "sequential"
      ? `${active} active handler; ${waiting} connection${waiting === 1 ? "" : "s"} waiting`
      : `${active} active workers; the accept loop stays free`;
  } else if (state.lesson === "world") {
    server = state.current
      ? (state.architecture === "mutex" ? `Lock held for ${state.current.command}` : `World handling ${state.current.command}`)
      : (state.architecture === "mutex" ? "Lock free" : "World waiting for a message");
  } else if (state.lesson === "async") {
    const ready = state.clients.filter((item) => item.status === "ready").length;
    server = state.architecture === "threads"
      ? `${state.clients.length} worker threads; ${state.clients.length - ready} blocked`
      : `${ready} runnable task${ready === 1 ? "" : "s"}; waiting tasks occupy no dedicated thread`;
  } else {
    server = state.closed ? "Connection closed" : `${state.events.length} ready event${state.events.length === 1 ? "" : "s"}`;
  }
  return {
    architecture: labels[state.architecture],
    server,
    queue: state.lesson === "select"
      ? state.events.map(({ label }) => label)
      : state.queue.map((entry) => typeof entry === "string" ? entry : `${entry.from}: ${entry.command}`),
  };
}

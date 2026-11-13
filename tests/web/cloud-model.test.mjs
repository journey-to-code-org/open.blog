import test from "node:test";
import assert from "node:assert/strict";
import {
  SCENARIOS, RUNGS, makeWorld, run, act, probe, pathStates, pathSummary, publicIp,
  startLesson, step, currentGoal, lessonDone,
} from "../../web/components/ob-cloud-model.js";

const IP = "203.0.113.10";
const ec2 = (extra = {}) => makeWorld({ where: "ec2", session: true, firewall: [22, 3000], flags: { keyLocked: true }, ...extra });
const where = (command) => (/^(node|exit|logout|sudo|systemctl|journalctl|pkill|which)\b/.test(command) ? "instance" : "laptop");

function play(world, commands) {
  let result = { world, lines: [], event: null };
  for (const command of commands) result = run(result.world, command, where(command));
  return result;
}

// Finish a lesson by typing each goal's example, on the machine it belongs to.
function finish(session) {
  while (!lessonDone(session)) {
    const goal = currentGoal(session);
    let advanced = false;
    for (const command of [].concat(goal.ex)) {
      const from = where(command);
      const outcome = step(session, run(session.world, command, from), command, from);
      session = outcome.session;
      advanced = outcome.advanced;
    }
    assert.ok(advanced, `"${[].concat(goal.ex).join(" ; ")}" did not finish "${goal.goal}"`);
  }
  return session;
}

test("every lesson can be finished by typing its examples", () => {
  for (const id of Object.keys(SCENARIOS)) assert.ok(lessonDone(finish(startLesson(id))), id);
});

test("every lesson names its machines, its goals and a closing lesson", () => {
  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    assert.ok(scenario.title && scenario.lesson, id);
    assert.ok(scenario.machines.every((machine) => ["laptop", "instance"].includes(machine)), id);
    for (const goal of scenario.goals) assert.ok(goal.goal && goal.hint && goal.ex && typeof goal.done === "function", `${id}: ${goal.goal}`);
  }
  assert.equal(startLesson("no-such-lesson"), null);
});

test("the probe stops at the first rung that fails, in ladder order", () => {
  const healthy = ec2({ app: { port: 443, owner: "systemd", pid: 1 }, firewall: [22, 443], dns: { "shop.example": IP }, cert: { names: ["shop.example"], state: "valid" } });
  const at = (world, url) => probe(world, url).rung;
  assert.equal(at(healthy, "https://shpo.example"), "name");
  assert.equal(at({ ...healthy, firewall: [22] }, "https://shop.example"), "door");
  assert.equal(at({ ...healthy, app: null }, "https://shop.example"), "process");
  assert.equal(at({ ...healthy, cert: { names: ["shop.example"], state: "expired" } }, "https://shop.example"), "padlock");
  assert.equal(at({ ...healthy, cert: { names: ["other.example"], state: "valid" } }, "https://shop.example"), "padlock");
  assert.equal(at({ ...healthy, bug: true }, "https://shop.example"), "app");
  assert.equal(probe(healthy, "https://shop.example").status, 200);
  assert.deepEqual(RUNGS, ["name", "door", "process", "padlock", "app"]);
});

test("the request path marks passed rungs, skips the padlock on plain http, and explains itself", () => {
  const world = makeWorld({ app: { port: 3000, owner: "session", pid: 1 } });
  const okHttp = probe(world, "http://localhost:3000");
  assert.deepEqual(pathStates(okHttp), ["pass", "pass", "pass", "skip", "pass"]);
  assert.match(pathSummary(okHttp), /200/);
  const refused = probe(makeWorld(), "http://localhost:3000");
  assert.deepEqual(pathStates(refused), ["pass", "pass", "fail", "idle", "idle"]);
  assert.match(pathSummary(refused), /Process/);
  assert.deepEqual(pathStates(null), ["idle", "idle", "idle", "idle", "idle"]);
});

test("curl prints the body, adds the status line with -i, and reports each failure like real curl", () => {
  const world = makeWorld({ app: { port: 3000, owner: "session", pid: 1 } });
  assert.equal(run(world, "curl http://localhost:3000").lines.at(-1).text, "Hello from my shop!");
  assert.match(run(world, "curl -i http://localhost:3000/break").lines.at(-1).text, /^HTTP\/1\.1 500 Internal Server Error/);
  assert.match(run(world, "curl http://localhost:4000").lines[1].text, /^curl: \(7\).*Connection refused/);
  assert.match(run(world, "curl http://nope.example").lines[1].text, /^curl: \(6\) Could not resolve host/);
  const closed = ec2({ firewall: [22], app: { port: 3000, owner: "session", pid: 1 } });
  assert.match(run(closed, `curl http://${IP}:3000`).lines[1].text, /^curl: \(28\).*Timeout/);
});

test("localhost on the laptop is not the instance", () => {
  const world = ec2({ app: { port: 3000, owner: "session", pid: 1 } });
  const result = run(world, "curl http://localhost:3000", "laptop");
  assert.equal(result.event.probe.rung, "process");
  assert.match(result.lines.at(-1).text, /your laptop/);
  assert.equal(run(world, "curl http://localhost:3000", "instance").event.probe.status, 200);
});

test("ssh explains each way it can fail before it connects", () => {
  const fresh = ec2({ session: false, flags: {} });
  const ssh = `ssh -i shop-key.pem ec2-user@${IP}`;
  assert.match(run(fresh, ssh).lines.map((l) => l.text).join("\n"), /UNPROTECTED PRIVATE KEY/);
  const locked = run(fresh, "chmod 400 shop-key.pem").world;
  assert.match(run(locked, `ssh ec2-user@${IP}`).lines[1].text, /Permission denied/);
  assert.match(run(locked, `ssh -i shop-key.pem root@${IP}`).lines.at(-1).text, /ec2-user/);
  assert.match(run(locked, "ssh -i shop-key.pem ec2-user@YOUR-IP").lines.at(-1).text, /203\.0\.113\.10/);
  assert.match(run({ ...locked, firewall: [3000] }, ssh).lines[1].text, /timed out/);
  assert.equal(run(locked, ssh).event.kind, "ssh");
});

test("a hand-started app dies with the session; a systemd one survives logout, crash and reboot", () => {
  const byHand = play(ec2(), ["node server.js", "exit"]);
  assert.equal(byHand.world.app, null);
  assert.equal(byHand.event.appDied, true);

  let world = play(ec2(), ["sudo tee /etc/systemd/system/shop.service", "sudo systemctl enable --now shop"]).world;
  assert.equal(world.app.owner, "systemd");
  const pid = world.app.pid;
  world = run(world, "sudo systemctl kill shop", "instance").world;
  assert.ok(world.app && world.app.pid !== pid && world.restarts === 1, "systemd restarts it with a new PID");
  assert.match(run(world, "systemctl status shop", "instance").lines.at(-1).text, /active \(running\)/);
  world = run(world, "sudo reboot", "instance").world;
  assert.equal(world.session, false);
  assert.equal(world.app.owner, "systemd", "enabled services start at boot");
  assert.equal(run(world, `curl http://${IP}:3000`, "laptop").event.probe.status, 200);
});

test("a started but not enabled service does not come back after a reboot", () => {
  const world = play(ec2(), ["sudo tee /etc/systemd/system/shop.service", "sudo systemctl start shop", "sudo reboot"]).world;
  assert.equal(world.app, null);
});

test("starting the service while a hand-started app holds the port fails, with the reason", () => {
  const result = play(ec2(), ["node server.js", "sudo tee /etc/systemd/system/shop.service", "sudo systemctl enable --now shop"]);
  assert.equal(result.world.service.failed, true);
  assert.match(result.lines.map((l) => l.text).join("\n"), /pkill node/);
  assert.match(run(result.world, "journalctl -u shop", "instance").lines.at(-1).text, /EADDRINUSE/);
});

test("commands run on the right machine, and a closed session says so", () => {
  assert.match(run(makeWorld(), "sudo reboot", "laptop").lines.at(-1).text, /instance/);
  assert.match(run(ec2(), "nslookup shop.example", "instance").lines.at(-1).text, /laptop/);
  assert.match(run(ec2({ session: false }), "node server.js", "instance").lines[1].text, /closed/);
  assert.match(run(makeWorld(), "rm -rf /", "laptop").lines[1].text, /command not found/);
});

test("stopping and starting the instance changes its public address", () => {
  const before = ec2();
  const stopped = act(before, "stop").world;
  assert.equal(stopped.host, "stopped");
  const started = act(stopped, "start").world;
  assert.notEqual(publicIp(started), publicIp(before));
  assert.equal(probe(started, `http://${publicIp(before)}:3000`).rung, "door");
});

test("goals take any command that does the job, and hints arrive after misses", () => {
  let session = startLesson("localhost");
  const typeIt = (command) => {
    const outcome = step(session, run(session.world, command, "laptop"), command, "laptop");
    session = outcome.session;
    return outcome;
  };
  assert.equal(typeIt("curl --include http://127.0.0.1:3000/").advanced, true, "--include and 127.0.0.1 count too");
  assert.equal(typeIt("curl http://localhost:3000").advanced, false);
  assert.match(typeIt("curl http://localhost:3000").lines.at(-1).text, /^Hint:/);
  typeIt("ls");
  assert.match(typeIt("ls").lines.at(-1).text, /^One way:/);
  assert.equal(typeIt("help").lines.length, 0, "help never counts as a miss");
});

test("run and act never change the world they are given", () => {
  const world = ec2();
  const snapshot = JSON.stringify(world);
  play(world, ["node server.js", "exit", "sudo reboot"]);
  run(world, "sudo systemctl enable --now shop", "instance");
  act(world, "stop");
  assert.equal(JSON.stringify(world), snapshot);
});

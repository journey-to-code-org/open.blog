// The simulated world behind <ob-cloud-lab>, for lessons about running an app in the cloud.
// Pure functions with no DOM, so every rule here is covered by `node --test`.
//
// A world is one machine running a small shop app, seen from the reader's laptop: whether the host
// is running and at which public address, the SSH session, the node process and who owns it (your
// session or systemd), the security group, a DNS zone, a certificate and the app itself.
// `run(world, typed, from)` takes one command and returns { world, lines, event }; `probe` follows
// one request rung by rung (name, door, process, padlock, app) and says how far it got.
// Nothing is executed, fetched or stored.

export const RUNGS = ["name", "door", "process", "padlock", "app"];
export const RUNG_LABELS = { name: "Name", door: "Door", process: "Process", padlock: "Padlock", app: "App" };

const ADDRESSES = ["203.0.113.10", "203.0.113.47", "203.0.113.82", "203.0.113.115"];
const BODY = { 200: "Hello from my shop!", 500: "Something went wrong inside the app." };
const STATUS_TEXT = { 200: "200 OK", 500: "500 Internal Server Error" };
const HOSTNAME = "ip-172-31-5-20";

const clone = (value) => JSON.parse(JSON.stringify(value));
const line = (kind, text) => ({ kind, text });

export function publicIp(world) {
  return ADDRESSES[world.ipIndex % ADDRESSES.length];
}

export function makeWorld(overrides = {}) {
  return {
    where: "laptop", host: "running", ipIndex: 0, session: true, port: 3000, app: null,
    service: { installed: false, enabled: false, failed: false },
    firewall: null, dns: {}, cert: null, bug: false, pid: 4240, restarts: 0, journal: [], flags: {},
    ...overrides,
  };
}

export function normalise(raw) {
  return String(raw ?? "").trim().replace(/\s+/g, " ").replace(/[\u201c\u201d]/g, '"');
}

export function parseUrl(raw) {
  const match = /^(?:(https?):\/\/)?([a-z0-9.-]+)(?::(\d{1,5}))?(\/\S*)?$/i.exec(raw ?? "");
  if (!match) return null;
  const scheme = (match[1] || "http").toLowerCase();
  return { scheme, host: match[2].toLowerCase(), port: Number(match[3] || (scheme === "https" ? 443 : 80)), path: match[4] || "/" };
}

// Follow one request from `from` ("laptop" or "instance") and stop at the first rung that fails.
// `passed` counts the rungs it got through; `rung` names the one that failed (null on a 200).
export function probe(world, raw, from = "laptop") {
  const target = parseUrl(raw);
  if (!target) {
    return { target: null, address: null, rung: "name", passed: 0, status: null, lines: [line("err", "curl: (3) URL rejected: Malformed input to a URL function")] };
  }
  const { scheme, host, port, path } = target;
  const local = host === "localhost" || host === "127.0.0.1";
  let address = local ? "127.0.0.1" : host;
  const fail = (rung, text, tip) => ({
    target, address, rung, passed: RUNGS.indexOf(rung), status: null,
    lines: [line("err", text), ...(tip ? [line("tip", tip)] : [])],
  });
  const refused = `curl: (7) Failed to connect to ${host} port ${port}: Connection refused`;
  const timeout = `curl: (28) Failed to connect to ${host} port ${port} after 75002 ms: Timeout was reached`;

  if (!local && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    address = world.dns[host];
    if (!address) {
      const tip = /your-ip/.test(host) ? `Replace YOUR-IP with the instance's public address, ${publicIp(world)}.` : null;
      address = null;
      return fail("name", `curl: (6) Could not resolve host: ${host}`, tip);
    }
  }
  if (local && world.where === "ec2" && from === "laptop") {
    return fail("process", refused, "localhost means the computer you typed on: your laptop. The shop runs on the instance.");
  }
  if (!local) {
    const there = world.where === "ec2" && world.host === "running" && address === publicIp(world);
    if (!there) {
      const tip = world.where === "ec2" && world.host !== "running" ? "Nothing answers at that address: the instance isn't running." : null;
      return fail("door", timeout, tip);
    }
    if (world.firewall && !world.firewall.includes(port)) return fail("door", timeout);
  }
  if (!world.app || world.app.port !== port) return fail("process", refused);
  if (scheme === "https") {
    const cert = world.cert;
    const problem = !cert ? "curl: (35) TLS connect error: the server did not present a certificate"
      : cert.state === "expired" ? "curl: (60) SSL certificate problem: certificate has expired"
      : cert.state === "untrusted" ? "curl: (60) SSL certificate problem: self-signed certificate"
      : !cert.names.includes(host) ? `curl: (60) SSL: no alternative certificate subject name matches target host name '${host}'`
      : null;
    if (problem) return fail("padlock", problem);
  }
  const status = world.bug || path === "/break" ? 500 : 200;
  return { target, address, rung: status === 500 ? "app" : null, passed: status === 500 ? 4 : 5, status, lines: [] };
}

// What the request path shows for a probe: pass, skip (no padlock on plain http), fail or idle.
export function pathStates(result) {
  return RUNGS.map((rung, index) => {
    if (!result) return "idle";
    if (index < result.passed) return rung === "padlock" && result.target?.scheme !== "https" ? "skip" : "pass";
    if (index === result.passed && result.rung) return "fail";
    return "idle";
  });
}

// One sentence for the request path's caption.
export function pathSummary(result) {
  if (!result) return "No request yet. Run curl to send one.";
  if (result.status === 200) return "The request got all the way through: 200 OK.";
  if (result.status === 500) return "Every layer worked and the app answered, with an error: 500.";
  const label = RUNG_LABELS[result.rung];
  const what = { name: "the name didn't resolve", door: "nothing let the knock through, so it timed out", process: "nobody was listening, so it was refused", padlock: "the certificate check failed" }[result.rung];
  return `Stopped at ${label}: ${what}.`;
}

function curl(world, args, from) {
  const words = args.split(" ").filter(Boolean);
  const headers = words.some((word) => /^-[a-zA-Z]*[iI]/.test(word) || word === "--include" || word === "--head");
  const url = words.find((word) => !word.startsWith("-"));
  if (!url) return { lines: [line("err", "curl: try 'curl --help' for more information")], event: null };
  const result = probe(world, url, from);
  if (!result.status) return { lines: result.lines, event: { kind: "probe", probe: result } };
  const out = headers
    ? `HTTP/1.1 ${STATUS_TEXT[result.status]}\nContent-Type: text/plain\n\n${BODY[result.status]}`
    : BODY[result.status];
  return { lines: [line("out", out)], event: { kind: "probe", probe: result } };
}

function startApp(world, owner) {
  world.pid += 7;
  world.app = { port: world.port, owner, pid: world.pid };
}

function ssh(world, typed) {
  const target = /(\S+)@(\S+)$/.exec(typed);
  if (!target) return [[line("err", "usage: ssh -i shop-key.pem ec2-user@ADDRESS")]];
  const [, user, host] = target;
  const address = world.dns[host.toLowerCase()] || host;
  const timeout = line("err", `ssh: connect to host ${host} port 22: Operation timed out`);
  if (/your-ip/i.test(host)) {
    return [[line("err", `ssh: Could not resolve hostname ${host}`), line("tip", `Replace YOUR-IP with the instance's public address, ${publicIp(world)}.`)]];
  }
  if (!(world.where === "ec2" && world.host === "running" && address === publicIp(world))) {
    const tip = world.where === "ec2" && world.host === "running" ? `The instance's public address is ${publicIp(world)}.` : "No running instance answers at that address.";
    return [[timeout, line("tip", tip)], { kind: "ssh-failed" }];
  }
  if (world.firewall && !world.firewall.includes(22)) {
    return [[timeout, line("tip", "The security group has no rule for port 22 from your IP.")], { kind: "ssh-failed" }];
  }
  if (!/-i \S*shop-key\.pem/.test(typed)) {
    return [[line("err", `${user}@${host}: Permission denied (publickey).`), line("tip", "Pass the key file: ssh -i shop-key.pem ...")]];
  }
  if (!world.flags.keyLocked) {
    return [[line("err", "WARNING: UNPROTECTED PRIVATE KEY FILE!\nPermissions for 'shop-key.pem' are too open.\nLoad key \"shop-key.pem\": bad permissions"), line("tip", "Lock the key down first: chmod 400 shop-key.pem")]];
  }
  if (user !== "ec2-user") {
    return [[line("err", `${user}@${host}: Permission denied (publickey).`), line("tip", "The default user on Amazon Linux is ec2-user.")]];
  }
  world.session = true;
  return [[line("out", `   ,     #_\n   ~\\_  ####_        Amazon Linux 2023\n  ~~  \\_#####\\\n  ~~     \\###|\n  ~~       \\#/ ___\n   ~~       V~' '->\n    ~~~         /`), line("tip", "Connected. Commands now run on the instance: use the instance tab.")], { kind: "ssh" }];
}

// The app dies. systemd brings it back; a session-owned app stays down.
function crash(world) {
  if (world.app.owner === "systemd") {
    world.restarts += 1;
    startApp(world, "systemd");
    world.journal.push(
      "shop.service: Main process exited, code=killed, status=9/KILL",
      `shop.service: Scheduled restart job, restart counter is at ${world.restarts}.`,
      "Started shop.service - Shop app from the cloud series.",
    );
    return [[line("why", `systemd saw the app die and started it again (new PID ${world.pid}).`)], { kind: "restarted" }];
  }
  world.app = null;
  return [[line("why", "The process is gone. Nothing is watching it, so it stays down.")], { kind: "killed" }];
}

function reboot(world) {
  world.session = false;
  world.app = null;
  if (world.service.installed && world.service.enabled) {
    startApp(world, "systemd");
    world.journal.push("-- Boot --", "Started shop.service - Shop app from the cloud series.");
  }
  const why = world.app
    ? "The instance restarted, and because the service is enabled, systemd started the app at boot."
    : "The instance restarted. Nothing was set to start the app at boot.";
  return [[line("out", `Connection to ${publicIp(world)} closed by remote host.`), line("why", why)], { kind: "rebooted", appUp: Boolean(world.app) }];
}

function status(world) {
  if (!world.service.installed) return [line("err", "Unit shop.service could not be found.")];
  const loaded = `     Loaded: loaded (/etc/systemd/system/shop.service; ${world.service.enabled ? "enabled" : "disabled"}; preset: disabled)`;
  if (world.service.failed) {
    return [line("out", `× shop.service - Shop app from the cloud series\n${loaded}\n     Active: failed (Result: exit-code)`)];
  }
  const active = Boolean(world.app && world.app.owner === "systemd");
  const pid = active ? `\n   Main PID: ${world.app.pid} (node)` : "";
  return [line("out", `${active ? "●" : "○"} shop.service - Shop app from the cloud series\n${loaded}\n     Active: ${active ? "active (running)" : "inactive (dead)"}${pid}`)];
}

const SERVICE_LINK = "Created symlink /etc/systemd/system/multi-user.target.wants/shop.service → /etc/systemd/system/shop.service.";

function systemctl(world, action) {
  if (!world.service.installed) return [[line("err", `Failed to ${action.split(" ")[0]} unit: Unit file shop.service does not exist.`), line("tip", "Write the unit file first (the sudo tee step).")]];
  if (action === "disable") {
    world.service.enabled = false;
    return [[line("out", "Removed \"/etc/systemd/system/multi-user.target.wants/shop.service\".")], { kind: "service", step: "disable" }];
  }
  if (action === "stop") {
    if (world.app?.owner === "systemd") world.app = null;
    return [[], { kind: "service", step: "stop" }];
  }
  const linked = action.startsWith("enable") && !world.service.enabled;
  if (action.startsWith("enable")) world.service.enabled = true;
  const symlink = linked ? [line("out", SERVICE_LINK)] : [];
  if (action === "enable") return [symlink, { kind: "service", step: "enable" }];
  if (world.app && world.app.owner === "session") {
    world.service.failed = true;
    world.journal.push("shop.service: Main process exited, code=exited, status=1/FAILURE", "Error: listen EADDRINUSE: address already in use :::3000");
    return [[...symlink, line("err", "Job for shop.service failed because the control process exited with error code."),
      line("tip", "Your hand-started app still holds port 3000. Stop it with pkill node, then start the service again.")], { kind: "service", step: "failed" }];
  }
  world.service.failed = false;
  if (action === "restart" && world.app) world.app = null;
  if (!world.app) startApp(world, "systemd");
  world.journal.push("Started shop.service - Shop app from the cloud series.");
  return [symlink, { kind: "service", step: "start" }];
}

function instanceCommand(world, typed) {
  if (/^node (?:~\/shop\/|\/home\/ec2-user\/shop\/|shop\/)?server\.js(?: &)?$/.test(typed)) {
    if (world.app) {
      const who = world.app.owner === "systemd" ? "systemd" : "you";
      return [[line("err", "Error: listen EADDRINUSE: address already in use :::3000"), line("tip", `Port 3000 is already taken by the app ${who} started.`)]];
    }
    startApp(world, "session");
    const background = typed.endsWith("&");
    return [[...(background ? [line("out", `[1] ${world.pid}`)] : []), line("out", "Listening on port 3000")], { kind: "started", owner: "session", background }];
  }
  if (/^(?:sudo )?(?:pkill node|killall node|kill(?: -9)? \d+)$/.test(typed) || typed === "sudo systemctl kill shop") {
    if (!world.app) return [[line("err", "No node process is running.")]];
    return crash(world);
  }
  if (typed === "which node") return [[line("out", "/usr/bin/node")]];
  if (/^sudo (?:dnf|yum) install(?: -y)? nodejs$/.test(typed)) return [[line("out", "Installed:\n  nodejs\n\nComplete!")]];
  if (/^sudo tee \/etc\/systemd\/system\/shop\.service\b/.test(typed)) {
    world.service.installed = true;
    world.service.failed = false;
    return [[line("tip", "Unit file written to /etc/systemd/system/shop.service.")], { kind: "service", step: "written" }];
  }
  if (typed === "sudo systemctl daemon-reload") return [[], { kind: "service", step: "reload" }];
  const action = /^sudo systemctl (enable --now|enable|start|restart|stop|disable) shop(?:\.service)?$/.exec(typed);
  if (action) return systemctl(world, action[1]);
  if (/^(?:sudo )?systemctl status shop(?:\.service)?(?: --no-pager)?$/.test(typed)) return [status(world), { kind: "service", step: "status" }];
  if (/^(?:sudo )?journalctl -u shop\b/.test(typed)) {
    return [[line("out", world.journal.length ? world.journal.slice(-8).join("\n") : "-- No entries --")]];
  }
  if (/^sudo (?:reboot|shutdown -r now|systemctl reboot)$/.test(typed)) return reboot(world);
  if (typed === "pwd") return [[line("out", "/home/ec2-user")]];
  if (typed === "ls") return [[line("out", "shop")]];
  return null;
}

const LAPTOP_ONLY = /^(ssh|chmod|icacls|nslookup|dig|host)\b/;
const INSTANCE_ONLY = /^(sudo|systemctl|journalctl|pkill|killall|exit|logout|which)\b/;

const HELP = {
  laptop: "On the laptop: curl [-i] URL, nslookup NAME, dig +short NAME, chmod 400 shop-key.pem, ssh -i shop-key.pem ec2-user@ADDRESS, node server.js, clear.",
  instance: "On the instance: node server.js [&], pkill node, exit, sudo systemctl enable --now shop, systemctl status shop, sudo systemctl kill shop, journalctl -u shop, sudo reboot, curl URL, clear.",
};

// Run one command typed at `from` ("laptop" or "instance"). Returns { world, lines, event }: lines
// are { kind: cmd|out|err|tip|why, text }; event, when set, says what happened, e.g.
// { kind: "probe", probe }, { kind: "ssh" }, { kind: "exit", appDied }, { kind: "rebooted", appUp }.
export function run(input, raw, from = "laptop") {
  const world = clone(input);
  const typed = normalise(raw);
  if (!typed) return { world, lines: [], event: null };
  const prompt = from === "instance" ? `[ec2-user@${HOSTNAME} ~]$` : "you@laptop ~ %";
  const lines = [line("cmd", `${prompt} ${typed}`)];
  const done = (more = [], event = null) => ({ world, lines: [...lines, ...more], event });
  if (typed === "clear") return { world, lines: [], event: { kind: "clear" } };
  if (typed === "help") return done([line("tip", HELP[from])]);
  if (from === "instance" && !world.session) {
    return done([line("err", "This SSH session is closed."), line("tip", "Connect again from the laptop tab.")], { kind: "closed" });
  }
  if (from === "laptop" && INSTANCE_ONLY.test(typed)) {
    return done([line("err", `zsh: command not found: ${typed.split(" ")[0]}`), line("tip", "That command belongs on the instance. Connect with ssh, then use the instance tab.")]);
  }
  if (from === "instance" && LAPTOP_ONLY.test(typed)) return done([line("tip", "That's a laptop command. Switch to the laptop tab to run it.")]);
  if (/^curl\b/.test(typed)) {
    const { lines: out, event } = curl(world, typed.slice(4).trim(), from);
    return done(out, event);
  }
  if (/^(?:nslookup|dig(?: \+short)?|host) \S+$/.test(typed)) {
    const name = typed.split(" ").pop().toLowerCase();
    const address = world.dns[name];
    if (!address) return done([line("err", `** server can't find ${name}: NXDOMAIN`)], { kind: "dns", name, found: false });
    if (typed.startsWith("dig")) return done([line("out", address)], { kind: "dns", name, found: true });
    return done([line("out", `Server:   192.0.2.53\nAddress:  192.0.2.53#53\n\nNon-authoritative answer:\nName:     ${name}\nAddress:  ${address}`)], { kind: "dns", name, found: true });
  }
  if (/^(?:chmod (?:400|600)|icacls) \S*shop-key\.pem\b/.test(typed)) {
    world.flags.keyLocked = true;
    return done([], { kind: "key" });
  }
  if (/^ssh\b/.test(typed)) return done(...ssh(world, typed));
  if (/^(?:exit|logout)$/.test(typed)) {
    world.session = false;
    const died = Boolean(world.app && world.app.owner === "session");
    if (died) world.app = null;
    const why = died ? [line("why", "Your session ended, and the app it started ended with it.")]
      : world.app ? [line("why", "systemd owns the app, so it keeps running after you leave.")] : [];
    return done([line("out", `logout\nConnection to ${publicIp(world)} closed.`), ...why], { kind: "exit", appDied: died });
  }
  if (from === "laptop" && world.where === "laptop" && /^node (?:\S+\/)?server\.js$/.test(typed)) {
    if (world.app) return done([line("err", "Error: listen EADDRINUSE: address already in use :::3000")]);
    startApp(world, "session");
    return done([line("out", "Listening on port 3000")], { kind: "started", owner: "session" });
  }
  if (from === "instance") {
    const handled = instanceCommand(world, typed);
    if (handled) return done(...handled);
  }
  return done([line("err", `${typed.split(" ")[0]}: command not found`), line("tip", 'Type "help" to see what this terminal understands.')]);
}

// Console-side actions a lesson can offer as buttons, the things you'd click in the AWS console.
export function act(input, action) {
  const world = clone(input);
  const say = (text) => ({ world, lines: [line("tip", text)], event: { kind: "console", action } });
  if (action === "stop" && world.host === "running") {
    world.host = "stopped"; world.app = null; world.session = false;
    return say(`Instance stopped. Its public address ${publicIp(world)} was released.`);
  }
  if (action === "start" && world.host === "stopped") {
    world.host = "running"; world.ipIndex += 1;
    if (world.service.installed && world.service.enabled) startApp(world, "systemd");
    return say(`Instance running again with a new public address: ${publicIp(world)}.`);
  }
  if (action === "close-22" && world.firewall) { world.firewall = world.firewall.filter((port) => port !== 22); return say("Removed the port 22 rule from the security group."); }
  if (action === "close-3000" && world.firewall) { world.firewall = world.firewall.filter((port) => port !== 3000); return say("Removed the port 3000 rule from the security group."); }
  if (action === "open-3000" && world.firewall && !world.firewall.includes(3000)) { world.firewall = [...world.firewall, 3000]; return say("Added a rule: port 3000 from anywhere."); }
  if (action === "bug") { world.bug = !world.bug; return say(world.bug ? "Deployed a version of the app with a bug." : "Rolled the bug back."); }
  return { world, lines: [], event: null };
}

// ---------------------------------------------------------------------------------------------
// Lessons. Each starts from a world and lists goals. A goal's `done(world, event)` is checked after
// every command, so any command that genuinely does the job counts, not one exact string. `ex` is
// one accepted way (a string or a list typed in order), used by the tests and offered after misses.

const IP = ADDRESSES[0];
const EC2 = (extra = {}) => makeWorld({ where: "ec2", session: false, firewall: [22, 3000], ...extra });
const probed = (event, test) => event?.kind === "probe" && test(event.probe);
const ok = (event) => probed(event, (p) => p.status === 200);

export const SCENARIOS = {
  "localhost": {
    title: "Who answers on localhost?",
    machines: ["laptop"],
    world: () => makeWorld({ app: { port: 3000, owner: "session", pid: 4240 } }),
    goals: [
      { goal: "Ask the app for its home page, and include the status line.", ex: "curl -i http://localhost:3000", hint: "curl, then -i, then http://localhost:3000.", done: (w, e) => ok(e) && /(?:^| )(?:-[a-zA-Z]*i|--include)\b/.test(e.typed) },
      { goal: "Visit /break and get the app to answer with an error.", ex: "curl -i http://localhost:3000/break", hint: "Same address, with /break on the end.", done: (w, e) => probed(e, (p) => p.status === 500) },
      { goal: "Knock on a door where nobody lives: port 4000.", ex: "curl http://localhost:4000", hint: "Change the port in the address to 4000.", done: (w, e) => probed(e, (p) => p.rung === "process") },
    ],
    lesson: "Same host all three times. A 500 means someone answered; refused means nobody was behind that door.",
  },
  "ec2-first-run": {
    title: "First run on the instance",
    machines: ["laptop", "instance"],
    world: () => EC2(),
    goals: [
      { goal: "Lock the key file so ssh agrees to use it.", ex: "chmod 400 shop-key.pem", hint: "chmod 400, then the key's file name.", done: (w) => Boolean(w.flags.keyLocked) },
      { goal: `Connect to the instance as ec2-user at ${IP}.`, ex: `ssh -i shop-key.pem ec2-user@${IP}`, hint: "ssh -i shop-key.pem ec2-user@ followed by the address.", done: (w, e) => e?.kind === "ssh" },
      { goal: "On the instance, start the app by hand.", ex: "node server.js", hint: "Switch to the instance tab and run node server.js.", done: (w) => w.app?.owner === "session" },
      { goal: "From your laptop, get a 200 from the app over the internet.", ex: `curl http://${IP}:3000`, hint: "On the laptop tab: curl the public address, port 3000.", done: (w, e) => ok(e) && e.from === "laptop" },
      { goal: "Close the SSH session, then check from your laptop whether the app still answers.", ex: ["exit", `curl http://${IP}:3000`], hint: "Type exit on the instance, then curl again from the laptop.", done: (w, e) => !w.session && e?.from === "laptop" && probed(e, (p) => p.rung === "process") },
    ],
    lesson: "The instance stayed on; the process didn't. It belonged to your login session.",
  },
  "systemd": {
    title: "Let systemd own the app",
    machines: ["laptop", "instance"],
    world: () => EC2({ session: true, flags: { keyLocked: true } }),
    goals: [
      { goal: "Write the unit file (the sudo tee step from the article).", ex: "sudo tee /etc/systemd/system/shop.service", hint: "sudo tee /etc/systemd/system/shop.service", done: (w) => w.service.installed },
      { goal: "Start the service now, and at every boot, in one command.", ex: "sudo systemctl enable --now shop", hint: "systemctl can enable and start at once: enable --now.", done: (w) => w.service.enabled && w.app?.owner === "systemd" },
      { goal: "Crash the app on purpose, then check its status.", ex: ["sudo systemctl kill shop", "systemctl status shop"], hint: "sudo systemctl kill shop, then systemctl status shop.", done: (w, e) => w.restarts > 0 && e?.kind === "service" && e.step === "status" },
      { goal: "Reboot the instance.", ex: "sudo reboot", hint: "sudo reboot", done: (w, e) => e?.kind === "rebooted" },
      { goal: "Without logging back in, get a 200 from your laptop.", ex: `curl http://${IP}:3000`, hint: "On the laptop tab: curl the public address, port 3000.", done: (w, e) => ok(e) && e.from === "laptop" && !w.session },
    ],
    lesson: "systemd started the app, not you, so logging out, a crash and a reboot don't take it down.",
  },
  "ladder": {
    title: "Climb the ladder",
    machines: ["laptop"],
    world: () => EC2({
      app: { port: 443, owner: "systemd", pid: 5120 }, port: 443, firewall: [22, 443],
      service: { installed: true, enabled: true, failed: false },
      dns: { "shop.example": IP, "www.shop.example": IP }, cert: { names: ["shop.example"], state: "valid" },
    }),
    goals: [
      { goal: "Find the address behind shop.example.", ex: "nslookup shop.example", hint: "nslookup, then the name.", done: (w, e) => e?.kind === "dns" && e.found },
      { goal: "Misspell the name and watch the first rung fail.", ex: "curl https://shpo.example", hint: "curl a name with a typo, like https://shpo.example.", done: (w, e) => probed(e, (p) => p.rung === "name") },
      { goal: "Ask for https://www.shop.example, a name the certificate doesn't cover.", ex: "curl https://www.shop.example", hint: "curl https://www.shop.example", done: (w, e) => probed(e, (p) => p.rung === "padlock") },
      { goal: "Get the shop's page over HTTPS, with every rung green.", ex: "curl -i https://shop.example", hint: "curl https://shop.example", done: (w, e) => ok(e) && e.probe.target.scheme === "https" },
    ],
    lesson: "Each rung can only fail after every rung before it worked. The error tells you how far the request got.",
  },
};

// A lesson session: the world, which goal is next, and how often the reader has missed it.
export function startLesson(id) {
  const scenario = SCENARIOS[id];
  return scenario ? { id, scenario, world: scenario.world(), index: 0, misses: 0 } : null;
}

export function currentGoal(session) {
  return session.scenario.goals[session.index] ?? null;
}

export function lessonDone(session) {
  return session.index >= session.scenario.goals.length;
}

// Apply one result (from run or act) to a session: advance when the current goal is met, and offer
// a hint, then an example, after misses. Returns { session, lines, advanced }.
export function step(session, result, typed, from) {
  const event = result.event ? { ...result.event, typed: normalise(typed), from } : null;
  const goal = currentGoal(session);
  const next = { ...session, world: result.world };
  if (!goal || !normalise(typed)) return { session: next, lines: [], advanced: false };
  if (goal.done(result.world, event)) {
    return { session: { ...next, index: session.index + 1, misses: 0 }, lines: [line("ok", `✓ ${goal.goal}`)], advanced: true };
  }
  if (event?.kind === "clear" || normalise(typed) === "help") return { session: next, lines: [], advanced: false };
  const misses = session.misses + 1;
  const example = [].concat(goal.ex).join(", then ");
  const lines = misses >= 4 ? [line("tip", `One way: ${example}`)] : misses >= 2 ? [line("tip", `Hint: ${goal.hint}`)] : [];
  return { session: { ...next, misses }, lines, advanced: false };
}

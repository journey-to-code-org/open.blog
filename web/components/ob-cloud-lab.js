// <ob-cloud-lab data-lesson="..."> is a guided cloud practice lab: a pretend laptop terminal and,
// when the lesson has one, a pretend EC2 instance terminal, a checklist of goals, and a request path
// that lights up rung by rung (name, door, process, padlock, app) for every curl. The reader types
// real commands; the simulated world lives in ob-cloud-model.js. Children of the element are the
// no-JavaScript fallback, hidden once the lab starts. Nothing is executed, stored or sent.
import { startLesson, run, step, currentGoal, lessonDone, pathStates, pathSummary, RUNGS, RUNG_LABELS, publicIp } from "./ob-cloud-model.js";
import { recallNew, recallPush, recallKey } from "./ob-practice-model.js";
import { ObLab, defineLab, el as html } from "./ob-lab.js";

const MACHINE_LABELS = { laptop: "Your laptop", instance: "EC2 instance" };
const STATE_WORDS = { pass: "passed", fail: "failed here", skip: "not used (plain http)", idle: "not reached" };

class ObCloudLab extends ObLab {
  setup() {
    this.lessonState = startLesson(this.dataset.lesson);
    if (!this.lessonState) {
      this.fallback.hidden = false;
      return;
    }
    const { scenario } = this.lessonState;
    this.status = html("p", { class: "ob-cloud-status" });
    this.goalText = html("p", { class: "ob-cloud-goal" });
    this.checklist = html("ol", { class: "ob-cloud-goals", "aria-label": "Goals" });
    scenario.goals.forEach((goal) => this.checklist.append(html("li", {}, goal.goal)));

    this.tabs = html("div", { class: "ob-cloud-tabs", role: "group", "aria-label": "Choose a terminal" });
    this.tabButtons = {};
    for (const name of scenario.machines) {
      const button = html("button", { type: "button", class: "ob-cloud-tab" }, MACHINE_LABELS[name]);
      button.addEventListener("click", () => this.choose(name, true));
      this.tabButtons[name] = button;
      this.tabs.append(button);
    }
    this.tabs.hidden = scenario.machines.length < 2;

    this.log = html("div", { class: "ob-cloud-log", role: "log", "aria-live": "polite", tabindex: "0", "aria-label": "Terminal output" });
    this.input = html("input", {
      id: `ob-cloud-input-${Math.random().toString(36).slice(2, 8)}`, class: "ob-cloud-input", type: "text",
      autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "type a command, press Enter",
    });
    this.promptLabel = html("label", { for: this.input.id });
    this.form = html("form", { class: "ob-cloud-form" });
    this.form.append(this.promptLabel, this.input, html("button", { type: "submit" }, "Run"));
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitLine(this.input.value);
    });
    this.input.addEventListener("keydown", (event) => this.recallKeys(event));

    this.path = html("ol", { class: "ob-cloud-path", "aria-label": "How far the last request got" });
    this.pathItems = RUNGS.map((rung) => {
      const item = html("li", { "data-rung": rung, "data-state": "idle" });
      item.append(html("span", { class: "ob-cloud-rung" }, RUNG_LABELS[rung]), html("span", { class: "ob-cloud-rung-state" }, STATE_WORDS.idle));
      this.path.append(item);
      return item;
    });
    this.pathCaption = html("p", { class: "ob-cloud-path-caption", role: "status" });
    const pathBox = html("div", { class: "ob-cloud-pathbox" });
    pathBox.append(html("p", { class: "ob-cloud-path-title" }, "Last request"), this.path, this.pathCaption);

    this.restart = html("button", { type: "button", class: "ob-cloud-restart", hidden: "" }, "Practice again");
    this.restart.addEventListener("click", () => this.reset(true));

    const terminal = html("div", { class: "ob-cloud-terminal" });
    terminal.append(this.tabs, this.log, this.form);
    const body = html("div", { class: "ob-cloud-body" });
    body.append(terminal, pathBox);
    this.append(this.status, this.goalText, this.checklist, body, this.restart);
    this.reset(false);
  }

  reset(focus) {
    this.lessonState = startLesson(this.dataset.lesson);
    const { machines } = this.lessonState.scenario;
    this.recalls = Object.fromEntries(machines.map((name) => [name, recallNew()]));
    this.logs = Object.fromEntries(machines.map((name) => [name, []]));
    this.logs[machines[0]].push({ kind: "tip", text: "Practice terminal. Nothing here touches your computer or AWS. Type help to list commands." });
    if (machines.includes("instance")) this.logs.instance.push({ kind: "tip", text: "Commands typed here run on the instance." });
    this.paintPath(null);
    this.choose(machines[0], focus);
    this.render();
  }

  choose(name, focus) {
    this.current = name;
    for (const [machine, button] of Object.entries(this.tabButtons)) button.setAttribute("aria-pressed", String(machine === name));
    this.dataset.machine = name;
    this.promptLabel.textContent = `Command on ${MACHINE_LABELS[name].toLowerCase()}`;
    this.log.replaceChildren(...this.logs[name].map((entry) => html("p", { class: `ob-cloud-line is-${entry.kind}` }, entry.text)));
    this.log.scrollTop = this.log.scrollHeight;
    if (focus && !this.input.disabled) this.input.focus();
  }

  write(machine, lines) {
    const log = this.logs[machine];
    log.push(...lines);
    if (log.length > 200) log.splice(0, log.length - 200);
    if (machine !== this.current) return;
    for (const entry of lines) this.log.append(html("p", { class: `ob-cloud-line is-${entry.kind}` }, entry.text));
    this.log.scrollTop = this.log.scrollHeight;
  }

  submitLine(raw) {
    const from = this.current;
    this.recalls[from] = recallPush(this.recalls[from], raw);
    this.input.value = "";
    const result = run(this.lessonState.world, raw, from);
    if (result.event?.kind === "clear") {
      this.logs[from] = [];
      this.log.replaceChildren();
    }
    const outcome = step(this.lessonState, result, raw, from);
    this.lessonState = outcome.session;
    this.write(from, [...result.lines, ...outcome.lines]);
    if (result.event?.kind === "probe") this.paintPath(result.event.probe);
    // Connecting moves the reader to the instance; leaving or a reboot brings them back.
    const hasInstance = this.lessonState.scenario.machines.includes("instance");
    if (result.event?.kind === "ssh" && hasInstance) {
      this.write("instance", [{ kind: "tip", text: `Connected to ${publicIp(this.lessonState.world)} as ec2-user.` }]);
      this.choose("instance", true);
    } else if (["exit", "rebooted"].includes(result.event?.kind) && from === "instance") {
      this.write("laptop", [{ kind: "tip", text: "The SSH session closed. You're back on your laptop." }]);
      this.choose("laptop", true);
    }
    this.render();
  }

  recallKeys(event) {
    if (event.isComposing || event.altKey || event.metaKey || event.shiftKey) return;
    const result = recallKey(this.recalls[this.current], event.key, this.input.value, event.ctrlKey);
    if (!result.handled) return;
    event.preventDefault();
    this.recalls[this.current] = result.recall;
    this.input.value = result.value;
  }

  paintPath(result) {
    pathStates(result).forEach((state, index) => {
      const item = this.pathItems[index];
      item.dataset.state = state;
      item.lastChild.textContent = STATE_WORDS[state];
    });
    this.pathCaption.textContent = pathSummary(result);
  }

  render() {
    const { scenario, index } = this.lessonState;
    const total = scenario.goals.length;
    const done = lessonDone(this.lessonState);
    this.status.textContent = done ? `All ${total} goals done` : `Goal ${index + 1} of ${total}`;
    this.goalText.textContent = done ? scenario.lesson : currentGoal(this.lessonState).goal;
    [...this.checklist.children].forEach((item, position) => {
      item.dataset.state = position < index ? "done" : position === index ? "current" : "todo";
      if (position === index) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    this.restart.hidden = !done;
  }
}

defineLab("ob-cloud-lab", ObCloudLab);

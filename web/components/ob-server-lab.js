// <ob-server-lab> is an in-memory multiplayer-server simulator. Readers can
// compare connection, ownership and scheduling designs without opening a real
// socket. Children are the no-JavaScript fallback; nothing is stored or sent.
import {
  SERVER_LESSONS, createServerLab, applyServerAction, presentServerLab,
  serverActions, normalizeServerLesson,
} from "./ob-server-model.js";
import { ObLab, defineLab, el, field } from "./ob-lab.js";

class ObServerLab extends ObLab {
  setup() {
    const lesson = normalizeServerLesson(this.dataset.lesson);
    this.stateValue = createServerLab(lesson);

    this.lessonSelect = el("select");
    for (const item of SERVER_LESSONS) this.lessonSelect.append(el("option", { value: item.id }, item.label));
    this.lessonSelect.value = lesson;
    this.lessonSelect.addEventListener("change", () => {
      this.stateValue = createServerLab(this.lessonSelect.value);
      this.renderLab();
    });

    this.noteNode = el("p", { class: "ob-server-note" });
    this.architectureNode = el("strong", { class: "ob-server-architecture" });
    this.serverDetailNode = el("p", { class: "ob-server-detail" });
    this.clientsNode = el("ul", { class: "ob-server-clients", "aria-label": "Simulated clients" });
    this.queueNode = el("ol", { class: "ob-server-queue", "aria-label": "Waiting work" });
    this.controlsNode = el("div", { class: "ob-server-controls" });
    this.statusNode = el("p", { class: "ob-server-status", role: "status", "aria-live": "polite" });
    this.traceNode = el("ol", { class: "ob-server-trace", "aria-label": "Server event trace" });

    const toolbar = el("div", { class: "ob-server-toolbar" });
    toolbar.append(field("Lesson view", this.lessonSelect, "ob-server-field"));

    const server = el("section", { class: "ob-server-node", "aria-label": "Server" });
    server.append(el("span", { class: "ob-server-kicker" }, "SERVER"), this.architectureNode, this.serverDetailNode);
    const queue = el("section", { class: "ob-server-queue-panel", "aria-label": "Queue" });
    queue.append(el("h3", {}, "Waiting work"), this.queueNode);
    const diagram = el("div", { class: "ob-server-diagram" });
    diagram.append(this.clientsNode, el("span", { class: "ob-server-arrow", "aria-hidden": "true" }, "→"), server,
      el("span", { class: "ob-server-arrow", "aria-hidden": "true" }, "→"), queue);

    const trace = el("section", { class: "ob-server-trace-panel" });
    trace.append(el("h3", {}, "What happened"), this.traceNode);
    this.append(
      el("p", { class: "ob-server-intro" }, "A deterministic server model. It opens no sockets, starts no threads and waits on no real clock."),
      toolbar, this.noteNode, diagram, this.controlsNode, this.statusNode, trace,
    );
    this.renderLab();
  }

  renderLab() {
    const lesson = SERVER_LESSONS.find(({ id }) => id === this.stateValue.lesson);
    const view = presentServerLab(this.stateValue);
    this.noteNode.textContent = lesson.note;
    this.architectureNode.textContent = view.architecture;
    this.serverDetailNode.textContent = view.server;

    this.clientsNode.replaceChildren(...this.stateValue.clients.map((item) => {
      const row = el("li", { "data-state": item.status });
      row.append(el("strong", {}, item.label), el("span", {}, item.status), el("small", {}, item.detail));
      return row;
    }));

    this.queueNode.replaceChildren(...(view.queue.length
      ? view.queue.map((item) => el("li", {}, item))
      : [el("li", { class: "ob-server-empty" }, "(empty)")]));

    const groups = new Map();
    for (const item of serverActions(this.stateValue)) {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    }
    this.controlsNode.replaceChildren(...[...groups].map(([group, actions]) => {
      const box = el("fieldset", { class: `ob-server-control-group ob-server-${group}` });
      box.append(el("legend", {}, group === "architecture" ? "Architecture" : group === "reset" ? "Start over" : "Events"));
      for (const item of actions) {
        const button = el("button", { type: "button" }, item.label);
        button.disabled = item.disabled;
        if (group === "architecture") button.setAttribute("aria-pressed", String(item.disabled));
        button.addEventListener("click", () => {
          this.stateValue = applyServerAction(this.stateValue, item.id);
          this.renderLab();
        });
        box.append(button);
      }
      return box;
    }));

    this.traceNode.replaceChildren(...this.stateValue.log.map((item) => el("li", {}, item)));
    this.statusNode.textContent = this.stateValue.log.at(-1);
  }
}

defineLab("ob-server-lab", ObServerLab);

// Home's card for jobs kept on this phone (Studio R4), on any site, only when something is waiting:
// "2 jobs waiting on this phone", where they stand, Send now (with a signal) and See them. It keeps
// itself up to date while Home is open.
import { h } from "./dom.js";
import { deviceNoun, herePhone } from "./notification-rules.js";
import { flushWords, waitingCount } from "./job-words.js";

const NEEDS = new Set(["signin", "refused", "removed", "someone-else", "newer", "unreadable", "sent"]);

export function homeJobsCard(jobs) {
  const noun = deviceNoun(herePhone({ navigator, window: globalThis }));
  const element = h("div", { class: "studio-home-jobs", "data-home-jobs": "true" });
  let said = "";
  let shown = false;
  function draw() {
    const entries = jobs.entries();
    if (!entries.length) {
      element.replaceChildren();
      return;
    }
    const states = entries.map((entry) => jobs.stateOf(entry));
    const needs = states.filter((state) => NEEDS.has(state)).length;
    const signin = states.includes("signin");
    const words = needs
      ? `${needs} need${needs === 1 ? "s" : ""} you${signin ? ": sign in again to send it" : ""}.`
      : said || (states.includes("sending") ? "Sending now." : "They send by themselves when there's a signal.");
    element.replaceChildren(h("section", { class: "studio-comment studio-home-jobs-card", "aria-labelledby": "studio-home-jobs-h" },
      h("div", { class: "studio-comment-head" },
        h("h3", { id: "studio-home-jobs-h", class: "studio-comment-who", text: waitingCount(entries.length, noun) }),
        needs ? h("status-badge", { variant: "warning" }, "Needs you") : null),
      h("p", { text: words, role: "status" }),
      h("div", { class: "studio-comment-actions" },
        navigator.onLine !== false ? h("action-button", { variant: "secondary", onClick: () => jobs.sendNow() }, "Send now") : null,
        h("action-button", { variant: "link", href: "#/new-job?focus=waiting" }, "See them"))));
  }
  const stop = jobs.subscribe((event) => {
    // Home was left: stop listening (before it is first shown, it is still being built).
    if (element.isConnected) shown = true;
    else if (shown) return stop();
    if (event.type === "flushed") {
      const waiting = jobs.entries().filter((entry) => ["waiting", "tried"].includes(jobs.stateOf(entry))).length;
      said = flushWords({ sent: event.sent, blocked: event.blocked, waiting });
    }
    draw();
    return undefined;
  });
  draw();
  return element;
}

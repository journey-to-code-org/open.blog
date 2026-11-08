// The Reminders screen (ADR 0356, #526): seasonal prompts that keep a trade site from going quiet.
// A reminder only ever opens an unpublished draft with its prompt; nothing here publishes, and the
// Assistant is offered, never started. Designed at 400px first: one column, 44px targets, every
// state said in words. The server judges every change again.
//
// The pure functions at the top are the contract and are tested without a page.

import { el } from "./block-forms.js";

export const STATUS_TEXT = Object.freeze({
  due: "Time to write this one",
  upcoming: "Coming up",
  snoozed: "Snoozed",
  opened: "Draft started",
});

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "09-15" as "Sep 15", or the text unchanged when it is not a month and day. */
export function monthDayText(value) {
  const match = MONTH_DAY.exec(String(value ?? ""));
  return match ? `${MONTHS[Number(match[1]) - 1]} ${Number(match[2])}` : String(value ?? "");
}

/** "2026-09-01" as "Sep 1, 2026". */
export function dayText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return match ? `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}` : String(value ?? "");
}

const upsert = (entries, id, change) => {
  const list = entries.map((entry) => ({ ...entry }));
  const found = list.find((entry) => entry.id === id);
  if (found) Object.assign(found, change);
  else list.push({ id, ...change });
  return list;
};

/** The stored entries with one topic turned off or on. A turned-on topic with nothing else to say is dropped. */
export function withDisabled(entries, id, disabled) {
  const list = upsert(entries, id, disabled ? { disabled: true } : {});
  return list
    .map((entry) => {
      if (entry.id !== id || disabled) return entry;
      const { disabled: _off, ...rest } = entry;
      return rest;
    })
    .filter((entry) => Object.keys(entry).length > 1);
}

/** The stored entries with one topic's window moved. */
export function withWindow(entries, id, start, end) {
  return upsert(entries, id, { start, end });
}

/** Problems with a typed window, in plain words; an empty list is fine. */
export function windowProblems(start, end) {
  const problems = [];
  if (!MONTH_DAY.test(start)) problems.push("Write the first day as month-day, like 09-15.");
  if (!MONTH_DAY.test(end)) problems.push("Write the last day as month-day, like 11-15.");
  return problems;
}

const ERROR_TEXT = Object.freeze({
  401: "You were signed out. Sign in again, then try again.",
  404: "That reminder is no longer listed. Reload to see today's list.",
  409: "These settings changed in another window. Reload them, then try again.",
});

export function seasonalErrorText(error) {
  const status = error?.status;
  // A 409 is a settings conflict only when the server sent the settings back with it. Any other 409
  // (a draft already started, reminders turned off) carries the server's own reason, which is said.
  const reason = String(error?.data?.error || "").trim().replace(/[.;]*$/, "");
  if (status === 409 && reason && !error?.data?.etag) return `${reason}. Reload to see today's list.`;
  if (ERROR_TEXT[status]) return ERROR_TEXT[status];
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `That did not work. ${detail}` : "That did not work. Check your connection and try again.";
}

let uid = 0;

/** The editor link for a draft the server named by its document path (`posts/...`), as every other
 *  Admin screen links to Write. */
export function editHref(document) {
  return `#/edit/${encodeURIComponent(document)}`;
}

export function createSeasonalReminders({ api }) {
  const id = `oba-seasonal-${++uid}`;
  let data = null;
  let busy = false;
  let destroyed = false;
  // What "Start a draft" answered, by reminder key, so the card keeps the link after it is redrawn.
  const started = new Map();

  const root = el("div", { class: "oba-seasonal", "data-seasonal-screen": "true" });
  const status = el("p", { class: "oba-small oba-seasonal-status", role: "status", "aria-live": "polite", "data-seasonal-status": "true" });
  const body = el("div", { class: "oba-seasonal-body" });

  const say = (message, kind = "small") => {
    status.className = `oba-seasonal-status oba-${kind === "error" ? "error" : kind === "ok" ? "ok" : "small"}`;
    status.setAttribute("role", kind === "error" ? "alert" : "status");
    status.textContent = message;
  };

  const run = async (work) => {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await work();
    } catch (error) {
      if (error?.status === 401) throw error;
      if (!destroyed) say(seasonalErrorText(error), "error");
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  };

  const putSettings = async (enabled, entries, done) => {
    const result = await api.call("PUT", "seasonal", { json: { etag: data.etag, seasonalPrompts: { enabled, topics: entries } } });
    if (destroyed) return;
    data = result;
    render();
    say(done, "ok");
  };

  const reminderCard = (reminder) => {
    const actions = [];
    if (reminder.status === "opened") {
      if (reminder.document) actions.push(el("a", { class: "oba-btn", href: editHref(reminder.document), "data-action": "seasonal-edit" }, "Open the draft"));
    } else {
      actions.push(
        el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "seasonal-open", onClick: () => run(() => openDraft(reminder)) }, "Start a draft"),
        el("button", { class: "oba-btn", type: "button", "data-action": "seasonal-snooze", onClick: () => run(() => snooze(reminder)) }, "Snooze a week"),
      );
    }
    actions.push(el("button", { class: "oba-btn", type: "button", "data-action": "seasonal-disable", onClick: () => run(() => putSettings(true, withDisabled(data.entries, reminder.id, true), `Turned off "${reminder.topic}".`)) }, "Turn this topic off"));
    const when = reminder.status === "snoozed" ? `${STATUS_TEXT.snoozed} until ${dayText(reminder.snoozedUntil)}` : STATUS_TEXT[reminder.status] || reminder.status;
    return el("li", { class: "oba-seasonal-card", "data-reminder": reminder.key, "data-status": reminder.status },
      el("h3", {}, reminder.topic),
      el("p", { class: "oba-small" }, `${when}. Window: ${dayText(reminder.opens)} to ${dayText(reminder.closes)}.`),
      el("p", {}, reminder.prompt),
      el("div", { class: "oba-seasonal-actions" }, ...actions),
      startedResult(reminder.key),
    );
  };

  const startedResult = (key) => {
    const result = started.get(key);
    if (!result) return el("div", { class: "oba-seasonal-result", "data-result-for": key, hidden: true });
    return el("div", { class: "oba-seasonal-result", "data-result-for": key },
      result.document ? el("a", { href: editHref(result.document), "data-action": "seasonal-write" }, "Open it in Write") : null,
      result.voiceReady
        ? el("p", { class: "oba-help", "data-seasonal-voice": "true" }, "You have a voice guide or voice samples. In Write, open the Assistant and choose them as context if you want a first draft in your own voice. Nothing is sent until you ask.")
        : null,
    );
  };

  async function openDraft(reminder) {
    say("Starting a draft…");
    const result = await api.call("POST", "seasonal/open", { json: { key: reminder.key } });
    if (destroyed) return;
    started.set(reminder.key, result);
    const found = data.reminders.find((item) => item.key === reminder.key);
    if (found) Object.assign(found, { status: "opened", draft: result.path, document: result.document });
    // Redrawn, so the card no longer offers "Start a draft" or "Snooze a week" for a started draft.
    render();
    say(result.created ? "A draft was started. It is not published." : "That draft was already started. It is not published.", "ok");
  }

  async function snooze(reminder) {
    const result = await api.call("POST", "seasonal/snooze", { json: { key: reminder.key, days: 7 } });
    if (destroyed) return;
    const found = data.reminders.find((item) => item.key === reminder.key);
    if (found) Object.assign(found, { status: "snoozed", snoozedUntil: result.snoozedUntil });
    render();
    say(`Snoozed until ${dayText(result.snoozedUntil)}.`, "ok");
  }

  const topicRow = (topic) => {
    const start = el("input", { id: `${id}-${topic.id}-start`, type: "text", inputmode: "numeric", name: "start", value: topic.start, maxlength: 5, "aria-describedby": `${id}-${topic.id}-problem` });
    const end = el("input", { id: `${id}-${topic.id}-end`, type: "text", inputmode: "numeric", name: "end", value: topic.end, maxlength: 5, "aria-describedby": `${id}-${topic.id}-problem` });
    const problem = el("p", { class: "oba-error", id: `${id}-${topic.id}-problem`, hidden: true });
    const saveWindow = () => {
      const found = windowProblems(start.value.trim(), end.value.trim());
      problem.hidden = found.length === 0;
      problem.textContent = found.join(" ");
      if (found.length) return;
      run(() => putSettings(true, withWindow(data.entries, topic.id, start.value.trim(), end.value.trim()), `Moved "${topic.topic}" to ${monthDayText(start.value.trim())} through ${monthDayText(end.value.trim())}.`));
    };
    return el("li", { class: "oba-seasonal-topic", "data-topic": topic.id, "data-disabled": topic.disabled ? "true" : "false" },
      el("h3", {}, topic.topic, topic.disabled ? el("span", { class: "oba-small" }, " (off)") : null),
      el("p", { class: "oba-small" }, `Usually ${monthDayText(topic.start)} through ${monthDayText(topic.end)}.`),
      el("div", { class: "oba-seasonal-dates" },
        el("div", { class: "oba-field" }, el("label", { for: start.id }, "First day"), start),
        el("div", { class: "oba-field" }, el("label", { for: end.id }, "Last day"), end),
      ),
      problem,
      el("div", { class: "oba-seasonal-actions" },
        el("button", { class: "oba-btn", type: "button", "data-action": "seasonal-move", onClick: saveWindow }, "Save dates"),
        el("button", { class: "oba-btn", type: "button", "data-action": topic.disabled ? "seasonal-enable" : "seasonal-turn-off", onClick: () => run(() => putSettings(true, withDisabled(data.entries, topic.id, !topic.disabled), topic.disabled ? `Turned on "${topic.topic}".` : `Turned off "${topic.topic}".`)) }, topic.disabled ? "Turn this topic on" : "Turn this topic off"),
      ),
    );
  };

  function render() {
    if (!data) return;
    if (!data.enabled) {
      body.replaceChildren(
        el("section", { class: "oba-seasonal-off", "data-seasonal-off": "true" },
          el("p", {}, "Seasonal reminders are off. Turn them on and this page will tell you, at the right time of year, what to write about for your trade. A reminder only starts a draft for you to write. It never publishes anything, and nothing is sent anywhere."),
          el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "seasonal-enable-all", onClick: () => run(() => putSettings(true, data.entries, "Seasonal reminders are on.")) }, "Turn on seasonal reminders"),
        ),
      );
      return;
    }
    const upcoming = data.reminders;
    body.replaceChildren(
      el("section", { "aria-labelledby": `${id}-upcoming` },
        el("h2", { id: `${id}-upcoming` }, "Coming up"),
        upcoming.length
          ? el("ul", { class: "oba-seasonal-list", "data-seasonal-reminders": "true" }, ...upcoming.map(reminderCard))
          : el("p", { "data-seasonal-empty": "true" }, "Nothing is due in the next 30 days. Check back, or look at the topics below."),
      ),
      el("section", { "aria-labelledby": `${id}-topics` },
        el("h2", { id: `${id}-topics` }, `Topics for ${data.trade ? data.trade.replace(/-/g, " ") : "your site"}`),
        data.trade ? null : el("p", { class: "oba-help" }, "Choose your trade in Business facts to get topics written for it. Until then you get general ones."),
        el("ul", { class: "oba-seasonal-list", "data-seasonal-topics": "true" }, ...data.topics.map(topicRow)),
      ),
      el("section", {},
        el("button", { class: "oba-btn", type: "button", "data-action": "seasonal-off", onClick: () => run(() => putSettings(false, data.entries, "Seasonal reminders are off.")) }, "Turn off all seasonal reminders"),
      ),
    );
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      data = await api.call("GET", "seasonal");
      if (!destroyed) render();
    } catch (error) {
      if (error?.status === 401) throw error;
      say(seasonalErrorText(error), "error");
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  root.append(
    el("section", { class: "oba-contributor-intro" }, el("p", {}, "A quiet month does not have to mean a quiet site. At the right time of year this page suggests something to write about for your trade. You decide whether to write it, wait, or skip it. Nothing is published for you.")),
    status,
    body,
  );

  return {
    element: root,
    load,
    isDirty: () => false,
    isBusy: () => busy,
    destroy: () => {
      destroyed = true;
    },
  };
}

// Reminders: what's worth writing about at this time of year. These are writing prompts for her,
// never messages to customers. Start a draft makes an unpublished post with the prompt and opens it in
// Write; nothing here publishes, builds or sends. Not now snoozes a week; skipping a season or turning
// a topic off is one step down. Changing topics and dates, and adding her own, is a sheet
// (parts/topics-sheet.js). Studio slice 10b, R1; docs/specs/studio/slice-10bc/ux.md, r1/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { sayDay } from "../parts/dates.js";
import { postHref } from "../parts/post-list.js";
import * as M from "../parts/seasonal-rules.js";
import { createSheet, guardedLeave } from "../parts/sheet.js";
import { openTopics } from "../parts/topics-sheet.js";

const DAY = 24 * 60 * 60 * 1000;

/** Days from `today` to `day` (both YYYY-MM-DD). */
const daysTo = (day, today) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);

export async function createReminders({ api, go }) {
  await use("action-button", "alert-banner", "dropdown-menu", "empty-state", "skeleton-block", "status-badge");
  let data = null;
  const sheet = await createSheet({ label: "Topics" });
  let topics = null; // the open topics sheet, redrawn when the screen reloads

  const heading = h("h2", { id: "studio-reminders-h", class: "studio-question", tabindex: "-1", text: "What's worth writing about now?" });
  const screenMore = h("dropdown-menu", { class: "studio-row-menu", items: [], onItemselect: (e) => screenCommand(e.detail) },
    h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: " for reminders" })));
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const undoSlot = h("div", { class: "studio-banner" });
  const body = h("div", { class: "studio-card-sections", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const tradeHelp = h("p", { class: "studio-help", hidden: true }, "Pick your trade in ", h("a", { href: "#/business" }, "Business facts"), " for topics about your work.");
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page studio-reminders", "aria-labelledby": "studio-reminders-h" },
    h("div", { class: "studio-today" }, h("div", { class: "studio-comment-head" }, heading, screenMore),
      h("p", { class: "studio-lede", text: "At the right time of year, Studio suggests something your customers are wondering about. You choose: write it, wait, or skip it. Nothing here goes on your site by itself." }),
      tradeHelp),
    undoSlot, banner, status, body, details);

  async function load() {
    body.setAttribute("aria-busy", "true");
    try {
      data = await api.get("seasonal");
      banner.replaceChildren();
      draw();
      if (sheet.isOpen) topics?.redraw();
    } catch (error) {
      if (error.status === 401) throw error;
      body.removeAttribute("aria-busy");
      body.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your reminders didn't load" }, "Check your connection and try again. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
    }
  }

  function draw() {
    body.removeAttribute("aria-busy");
    tradeHelp.hidden = Boolean(data.trade);
    screenMore.items = [
      ...(data.enabled ? [{ value: "off", label: "Turn reminders off" }] : []),
      { value: "topics", label: "Change topics and dates…" },
    ];
    drawDetails();
    if (!data.enabled) {
      body.replaceChildren(h("empty-state", { heading: "Reminders are off" },
        "Turn them on and Studio suggests what to write for your trade, at the right time of year. It never publishes anything.",
        h("action-button", { slot: "actions", onClick: () => setEnabled(true) }, "Turn on reminders")));
      return;
    }
    const due = data.reminders.filter((r) => r.status === "due");
    const later = data.reminders.filter((r) => r.status !== "due");
    if (!due.length && !later.length) {
      body.replaceChildren(h("empty-state", { heading: "Nothing for now" }, "Nothing to write about for the next month. Studio will tell you when something comes up."));
      return;
    }
    body.replaceChildren(...[
      due.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-due-h" }, h("h3", { id: "studio-due-h", text: "Time to write" }),
        h("ul", { class: "studio-comment-list" }, ...due.map((r, i) => card(r, i === 0)))) : null,
      later.length ? h("section", { class: "studio-section", "aria-labelledby": "studio-later-h" }, h("h3", { id: "studio-later-h", text: "Coming up" }),
        h("ul", { class: "studio-comment-list" }, ...later.map((r) => card(r, false)))) : null].filter(Boolean));
  }

  function when(r) {
    if (r.status === "due") return `Best before ${sayDay(r.closes)}.`;
    if (r.status === "snoozed") return `Snoozed until ${sayDay(r.snoozedUntil)}.`;
    if (r.status === "opened") return "Draft started.";
    return `Starts ${sayDay(r.opens)}.`;
  }

  function card(r, first) {
    const headingId = `studio-reminder-${r.key}`;
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: [
        { value: "30", label: "Remind me in a month" },
        { value: "season", label: "Not this season" },
        { value: "stop", label: "Stop suggesting this" },
        { value: "dates", label: "Change its dates…" },
      ],
      onItemselect: (e) => (e.detail === "dates" ? changeTopics(r.id, menu) : e.detail === "stop" ? stopTopic(r) : snooze(r, e.detail === "30" ? 30 : Math.min(90, Math.max(1, daysTo(r.closes, data.today) + 1)), e.detail === "season")),
    }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${r.topic}` })));
    const actions = r.status === "opened"
      ? [r.document ? h("action-button", { href: postHref(r.document) }, "Open it") : null]
      : [h("action-button", { variant: r.status === "due" ? "primary" : "secondary", label: `${r.status === "due" ? "Start a draft" : "Start early"}: ${r.topic}`, onClick: (e) => start(r, e.currentTarget) }, r.status === "due" ? "Start a draft" : "Start early"),
        r.status === "due" ? h("action-button", { variant: "secondary", label: `Not now: ${r.topic}`, onClick: () => snooze(r, 7) }, "Not now") : null];
    return h("li", { class: "studio-comment", "data-key": r.key },
      h("div", { class: "studio-comment-head" },
        h("h4", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: r.topic }),
        r.status === "snoozed" ? h("status-badge", { variant: "neutral" }, "Snoozed") : r.status === "opened" ? h("status-badge", { variant: "info" }, "Draft started") : null,
        r.status === "opened" ? null : menu),
      h("p", { class: "studio-comment-body", text: r.prompt }),
      h("p", { class: "studio-help", text: when(r) }),
      h("div", { class: "studio-comment-actions" }, ...actions.filter(Boolean)));
  }

  async function start(r, button) {
    button.loading = true;
    try {
      const done = await api.post("seasonal/open", { key: r.key });
      if (!done.document) {
        await load();
        status.textContent = "Started a draft, but Studio can't open it here. Find it under Posts.";
        return;
      }
      toast(`${done.created === false ? "You started this one already. Here it is." : "Here's a draft to start from. It's not on your site."}${data.voiceReady ? " The Assistant can help write it in your voice." : ""}`);
      go(postHref(done.document));
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 404) { await load(); status.textContent = "That reminder isn't listed any more."; return; }
      status.textContent = M.seasonalErrorText(error);
    } finally {
      button.loading = false;
    }
  }

  async function snooze(r, days, season = false) {
    try {
      const done = await api.post("seasonal/snooze", { key: r.key, days });
      await load();
      const words = season ? "Skipped until next season." : `I'll remind you again ${sayDay(done.snoozedUntil)}.`;
      status.textContent = words;
      toast(words);
      heading.focus();
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 404) { await load(); status.textContent = "That reminder isn't listed any more."; return; }
      status.textContent = M.seasonalErrorText(error);
    }
  }

  async function put(enabled, entries) {
    try {
      data = await api.put("seasonal", { etag: data.etag, seasonalPrompts: { enabled, topics: entries } });
      draw();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409 && error.data?.etag) {
        await load();
        status.textContent = "These changed on another device. Here they are now; make your change again.";
        return false;
      }
      status.textContent = M.seasonalErrorText(error);
      return false;
    }
  }

  async function stopTopic(r) {
    if (!(await put(true, M.withDisabled(data.entries, r.id, true)))) return;
    const words = `Studio won't suggest “${r.topic}” any more.`;
    status.textContent = words;
    const undo = h("action-button", { size: "sm", onClick: async () => { undoSlot.replaceChildren(); if (await put(true, M.withDisabled(data.entries, r.id, false))) status.textContent = `“${r.topic}” is back.`; } }, "Undo");
    undoSlot.replaceChildren(h("alert-banner", { variant: "info", dismissible: true, heading: words }, undo));
    heading.focus();
  }

  async function setEnabled(on) {
    if (!(await put(on, data.entries))) return;
    const words = on ? "Reminders are on." : "Reminders are off.";
    status.textContent = words;
    toast(words);
    if (!on) {
      const undo = h("action-button", { size: "sm", onClick: async () => { undoSlot.replaceChildren(); await setEnabled(true); } }, "Undo");
      undoSlot.replaceChildren(h("alert-banner", { variant: "info", dismissible: true, heading: words }, undo));
    }
  }

  function screenCommand(value) {
    if (value === "off") setEnabled(false);
    if (value === "topics") changeTopics(null, screenMore);
  }

  async function changeTopics(focusId, opener) {
    if (!data) return;
    topics = await openTopics({
      sheet, api, opener, focusId: focusId && data.topics.some((t) => t.id === focusId) ? focusId : null,
      getData: () => data,
      setData: (reply) => { data = reply; draw(); },
    });
  }

  function drawDetails() {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        `today ${data.today}, trade ${data.trade || "none"}, etag ${data.etag}`,
        ...data.reminders.map((r) => `${r.key} ${r.status} ${r.opens}–${r.closes}${r.snoozedUntil ? ` snoozed ${r.snoozedUntil}` : ""}${r.document ? ` draft ${r.document}` : ""}`),
        `entries ${JSON.stringify(data.entries || [])}`,
      ].map((t) => h("li", { text: t }))));
  }

  return {
    title: "Reminders",
    element,
    load,
    reload: load,
    leave: () => guardedLeave(sheet),
    isDirty: () => sheet.isDirty(),
    focus: () => heading.focus(),
    get palette() {
      if (!data) return [];
      return [
        { id: "topics", label: "Change topics and dates", group: "Reminders" },
        ...data.reminders.filter((r) => r.status === "due").map((r) => ({ id: `start:${r.key}`, label: `Start a draft: ${r.topic}`, group: "Reminders" })),
        { id: "toggle", label: data.enabled ? "Turn reminders off" : "Turn reminders on", group: "Reminders" },
      ];
    },
    command(id) {
      if (id === "toggle") setEnabled(!data.enabled);
      if (id === "topics") changeTopics(null, heading);
      const r = id.startsWith("start:") && data.reminders.find((x) => x.key === id.slice(6));
      if (r) start(r, { loading: false });
    },
  };
}

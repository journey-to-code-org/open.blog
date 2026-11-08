// The Reminders screen (ADR 0356, #526): the pure contract and the screen against a fake server. A
// reminder only starts a draft, snoozes or turns a topic off; the Assistant is mentioned, never started.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createSeasonalReminders,
  dayText,
  monthDayText,
  seasonalErrorText,
  windowProblems,
  withDisabled,
  withWindow,
} from "../../web/admin/seasonal.js";
import { ApiError, tick, withDom } from "./dom-shim.mjs";

const text = (node) => node.textContent.replace(/\s+/g, " ").trim();
const button = (root, action) => root.querySelectorAll("button").find((b) => b.dataset.action === action);

const REMINDER = {
  key: "furnace-tuneup@2026-09-01",
  id: "furnace-tuneup",
  topic: "Furnace tune-up before the cold",
  prompt: "Why a furnace should be checked first.",
  opens: "2026-09-01",
  closes: "2026-10-31",
  status: "due",
  snoozedUntil: null,
  draft: null,
};
const TOPICS = [
  { id: "furnace-tuneup", topic: "Furnace tune-up before the cold", prompt: "p", start: "09-01", end: "10-31", disabled: false, custom: false },
  { id: "ac-tuneup", topic: "Air conditioning check", prompt: "p", start: "04-01", end: "05-31", disabled: false, custom: false },
];

function server(initial = {}) {
  const state = { enabled: true, etag: "e1", entries: [], voiceReady: true, reminders: [structuredClone(REMINDER)], ...initial };
  return {
    state,
    calls: [],
    next: null,
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (this.next) {
        const failure = this.next;
        this.next = null;
        throw failure;
      }
      if (path === "seasonal/open") return { key: options.json.key, path: "content/posts/2026-09-10-furnace.md", document: "posts/2026-09-10-furnace.md", created: true, draft: true, voiceReady: state.voiceReady };
      if (path === "seasonal/snooze") return { key: options.json.key, snoozedUntil: "2026-09-17" };
      if (method === "PUT") {
        state.enabled = options.json.seasonalPrompts.enabled;
        state.entries = options.json.seasonalPrompts.topics;
        state.etag = `e${this.calls.length}`;
      }
      const topics = TOPICS.map((t) => ({ ...t, disabled: state.entries.some((e) => e.id === t.id && e.disabled) }));
      return { enabled: state.enabled, etag: state.etag, trade: "hvac", entries: state.entries, topics, reminders: state.reminders, voiceReady: state.voiceReady };
    },
  };
}

async function mount(api) {
  const view = createSeasonalReminders({ api });
  document.body.append(view.element);
  await view.load();
  await tick();
  return { view, root: view.element };
}

test("dates are said in words and typed windows are checked", () => {
  assert.equal(monthDayText("09-15"), "Sep 15");
  assert.equal(monthDayText("nope"), "nope");
  assert.equal(dayText("2026-09-01"), "Sep 1, 2026");
  assert.deepEqual(windowProblems("09-15", "11-15"), []);
  assert.equal(windowProblems("13-01", "11-15").length, 1);
  assert.equal(windowProblems("", "").length, 2);
});

test("turning a topic off and on keeps only the changes that say something", () => {
  const off = withDisabled([], "ac-tuneup", true);
  assert.deepEqual(off, [{ id: "ac-tuneup", disabled: true }]);
  assert.deepEqual(withDisabled(off, "ac-tuneup", false), []);
  const moved = withWindow(off, "ac-tuneup", "05-01", "06-01");
  assert.deepEqual(moved, [{ id: "ac-tuneup", disabled: true, start: "05-01", end: "06-01" }]);
  assert.deepEqual(withDisabled(moved, "ac-tuneup", false), [{ id: "ac-tuneup", start: "05-01", end: "06-01" }]);
  assert.deepEqual(off, [{ id: "ac-tuneup", disabled: true }], "the input is not changed");
});

test("errors are plain", () => {
  assert.match(seasonalErrorText({ status: 409 }), /changed in another window/);
  assert.match(seasonalErrorText({ status: 409, data: { error: "The reminder settings changed since you opened them; reload before saving", etag: "e1" } }), /changed in another window/);
  // Any other 409 is said in the server's own words, never as a change in another window.
  assert.equal(seasonalErrorText({ status: 409, data: { error: "A draft was already opened for this reminder" } }), "A draft was already opened for this reminder. Reload to see today's list.");
  assert.match(seasonalErrorText({ status: 404 }), /no longer listed/);
  assert.match(seasonalErrorText({ data: { error: "start must be a month and day" } }), /month and day/);
});

test("a site with reminders off is told what turning them on does, and nothing is listed", withDom(async () => {
  const api = server({ enabled: false, reminders: [] });
  const { root } = await mount(api);
  assert.match(text(root), /never publishes anything/);
  assert.equal(root.querySelectorAll("li").length, 0);
  await button(root, "seasonal-enable-all").click();
  await tick();
  assert.deepEqual(api.calls.at(-1).body, { etag: "e1", seasonalPrompts: { enabled: true, topics: [] } });
  assert.ok(root.querySelectorAll("li").length > 0);
}));

test("a due reminder starts a draft that is not published and offers the voice flow without starting it", withDom(async () => {
  const api = server();
  const { root } = await mount(api);
  assert.match(text(root), /Time to write this one/);
  await button(root, "seasonal-open").click();
  await tick();
  assert.deepEqual(api.calls.at(-1), { method: "POST", path: "seasonal/open", body: { key: REMINDER.key } });
  assert.match(text(root), /not published/);
  const link = root.querySelectorAll("a").find((a) => a.dataset.action === "seasonal-write");
  // Write opens a document by its path under the content folder, never the project path.
  assert.equal(link.attributes.href, "#/edit/posts%2F2026-09-10-furnace.md");
  assert.match(text(root), /Nothing is sent until you ask/);
  // Only the open call was made: no assistant, publish or other request.
  assert.deepEqual(api.calls.map((c) => c.path), ["seasonal", "seasonal/open"]);
}));

test("after Start a draft the card is redrawn: no Start or Snooze for a started draft, and the link stays", withDom(async () => {
  const api = server();
  const { root } = await mount(api);
  await button(root, "seasonal-open").click();
  await tick();
  const card = root.querySelectorAll("li").find((li) => li.dataset.reminder === REMINDER.key);
  assert.equal(card.dataset.status, "opened");
  assert.equal(button(root, "seasonal-snooze"), undefined, "a started draft cannot be snoozed");
  assert.equal(button(root, "seasonal-open"), undefined);
  assert.match(text(card), /Draft started/);
  assert.ok(card.querySelectorAll("a").some((a) => a.dataset.action === "seasonal-write"), "the new draft's link is kept");
  assert.match(text(root), /A draft was started\. It is not published\./);
  // Had a second window snoozed it anyway, the server's reason is said, not "another window".
  api.next = new ApiError("conflict", 409, { error: "A draft was already opened for this reminder" });
  await button(root, "seasonal-disable").click();
  await tick();
  assert.match(text(root), /A draft was already opened for this reminder/);
  assert.doesNotMatch(text(root), /another window/);
}));

test("a reminder whose draft was started links to it by its document path", withDom(async () => {
  const opened = { ...structuredClone(REMINDER), status: "opened", draft: "content/posts/2026-09-10-furnace.md", document: "posts/2026-09-10-furnace.md" };
  const { root } = await mount(server({ reminders: [opened] }));
  const link = root.querySelectorAll("a").find((a) => a.dataset.action === "seasonal-edit");
  assert.equal(link.attributes.href, "#/edit/posts%2F2026-09-10-furnace.md");
  assert.equal(button(root, "seasonal-open"), undefined);
}));

test("no voice samples means no voice offer", withDom(async () => {
  const { root } = await mount(server({ voiceReady: false }));
  await button(root, "seasonal-open").click();
  await tick();
  assert.doesNotMatch(text(root), /voice guide/);
}));

test("snooze says until when, and turning a topic off sends the stored changes", withDom(async () => {
  const api = server();
  const { root } = await mount(api);
  await button(root, "seasonal-snooze").click();
  await tick();
  assert.deepEqual(api.calls.at(-1).body, { key: REMINDER.key, days: 7 });
  assert.match(text(root), /Snoozed until Sep 17, 2026/);
  await button(root, "seasonal-disable").click();
  await tick();
  assert.deepEqual(api.calls.at(-1).body.seasonalPrompts, { enabled: true, topics: [{ id: "furnace-tuneup", disabled: true }] });
}));

test("a bad window is said beside its fields and nothing is sent; a good one is saved", withDom(async () => {
  const api = server();
  const { root } = await mount(api);
  const row = root.querySelectorAll("li").find((li) => li.dataset.topic === "ac-tuneup");
  const start = row.querySelectorAll("input").find((i) => i.attributes.name === "start");
  start.value = "13-01";
  const calls = api.calls.length;
  await row.querySelectorAll("button").find((b) => b.dataset.action === "seasonal-move").click();
  await tick();
  assert.equal(api.calls.length, calls);
  assert.match(text(row), /month-day/);
  start.value = "05-01";
  await row.querySelectorAll("button").find((b) => b.dataset.action === "seasonal-move").click();
  await tick();
  assert.deepEqual(api.calls.at(-1).body.seasonalPrompts.topics, [{ id: "ac-tuneup", start: "05-01", end: "05-31" }]);
}));

test("every control has a label and a stale save is explained", withDom(async () => {
  const api = server();
  const { root } = await mount(api);
  const labels = new Set(root.querySelectorAll("label").map((l) => l.attributes.for));
  for (const control of root.querySelectorAll("input")) assert.ok(labels.has(control.id), "input has a label");
  api.next = new ApiError("conflict", 409, {});
  await button(root, "seasonal-disable").click();
  await tick();
  assert.match(text(root), /changed in another window/);
}));

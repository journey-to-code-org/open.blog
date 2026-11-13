// Ported from tests/web/admin-seasonal.test.mjs for the old Admin's retirement: the same checks,
// against Studio's copy of the rules. Tests of the old screens stay with the old Admin until R15.
// The Reminders screen (ADR 0356, #526): the pure contract and the screen against a fake server. A
// reminder only starts a draft, snoozes or turns a topic off; the Assistant is mentioned, never started.
import assert from "node:assert/strict";
import test from "node:test";

import {
  dayText,
  monthDayText,
  seasonalErrorText,
  windowProblems,
  withDisabled,
  withWindow,
} from "../../web/studio/parts/seasonal-rules.js";
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


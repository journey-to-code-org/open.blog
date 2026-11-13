// The Greeting cards screen (ADR 0411): honest when it isn't set up, cards listed in plain words,
// a birthday card that takes its day from the address book and comes every year, a preview shown
// in its own frame, a test that goes to Grammi, and a problem that points at its field.
import assert from "node:assert/strict";
import test from "node:test";

import { OFF_TEXT, cardSummary, createGreetingCards, hourLabel, nextBirthday } from "../../web/admin/greetings.js";
import { ApiError, choose, type, withDom } from "./dom-shim.mjs";
import { all, flush, one, text } from "./voice-harness.mjs";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const KRISTIN = "11111111-1111-4111-8111-111111111111";
const JIMMY = "22222222-2222-4222-8222-222222222222";
const ZONE = "America/New_York";

function server(initial = {}) {
  const state = {
    overview: { enabled: true, state: "on", timeZone: ZONE, from: { name: "Grammi", email: "grammi@example.com" }, designs: [
      { id: "birthday", label: "Birthday", subject: "Happy birthday, {name}!" },
      { id: "christmas", label: "Christmas", subject: "Merry Christmas, {name}!" },
      { id: "just-because", label: "Just because", subject: "A note for you, {name}" },
    ] },
    contacts: [
      { id: KRISTIN, name: "Kristin", email: "kristin@example.com", birthday: "1999-11-27" },
      { id: JIMMY, name: "Jimmy", email: "jimmy@example.com", birthday: null },
    ],
    cards: [],
    ...initial,
  };
  return {
    state,
    calls: [],
    failWith: null,
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (this.failWith && method === "POST") {
        const error = this.failWith;
        this.failWith = null;
        throw error;
      }
      if (path === "greetings/status") return structuredClone(state.overview);
      if (path === "greetings/contacts" && method === "GET") return { contacts: structuredClone(state.contacts) };
      if (path === "greetings/cards" && method === "GET") return { cards: structuredClone(state.cards) };
      if (path === "greetings/cards" && method === "POST") {
        const card = { id: "33333333-3333-4333-8333-333333333333", ...options.json, subject: options.json.subject || "Happy birthday, {name}!", status: "scheduled", nextSendAt: "2026-11-27T13:00:00.000Z", lastSentAt: null, attempts: 0, error: null };
        state.cards.push(card);
        return { card };
      }
      if (path === "greetings/preview") return { subject: "Happy birthday, Kristin!", sendsAt: "2026-11-27T13:00:00.000Z", previewUrl: "/admin/api/preview/abc" };
      if (path === "greetings/test") return { sent: true, to: "grammi@example.com" };
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
}

async function open(api) {
  const view = createGreetingCards({ api, now: () => NOW });
  document.body.append(view.element);
  await view.load();
  await flush();
  return { root: view.element, view };
}
const action = (root, name) => all(root, "button").find((b) => b.dataset.action === name);
const field = (root, name) => all(root, "[data-field]").find((n) => n.getAttribute("data-field") === name);
const click = async (node) => {
  node.dispatch("click", { target: node });
  await flush();
};

test("small helpers say times and birthdays the way Grammi would", () => {
  assert.equal(hourLabel(8), "8 AM");
  assert.equal(hourLabel(12), "12 PM");
  assert.equal(hourLabel(21), "9 PM");
  assert.equal(nextBirthday("1999-11-27", "2026-11-12"), "2026-11-27");
  assert.equal(nextBirthday("1999-10-04", "2026-11-12"), "2027-10-04");
  assert.equal(
    cardSummary({ design: "birthday", status: "scheduled", nextSendAt: "2026-11-27T13:00:00.000Z", yearly: true }, { name: "Kristin" }, ZONE),
    "Birthday card to Kristin goes out Friday, November 27 at 8 AM, and every year after.",
  );
  assert.match(cardSummary({ design: "christmas", status: "failed", error: "rejected" }, { name: "Jimmy" }, ZONE), /didn't go out: the email service turned it down/);
});

test("not set up: the page says so and asks for nothing else", withDom(async () => {
  for (const [overview, expected] of [[{ enabled: false, state: "off" }, OFF_TEXT.off], [{ enabled: false, state: "unavailable" }, OFF_TEXT.unavailable]]) {
    const api = server({ overview });
    const { root } = await open(api);
    assert.match(text(root), new RegExp(expected.slice(0, 30)));
    assert.equal(all(root, "button").length, 0);
    assert.deepEqual(api.calls.map((c) => c.path), ["greetings/status"]);
  }
}));

test("a birthday card takes its day from the address book, comes every year, and can be seen and tested first", withDom(async () => {
  const api = server();
  const { root } = await open(api);
  assert.match(text(root), /No cards yet/);
  assert.match(text(root), /Kristin, kristin@example.com, birthday November 27/);
  await click(action(root, "new-card"));
  const sendOn = field(root, "sendOn");
  assert.equal(sendOn.value, "1999-11-27", "Kristin's birthday, from the address book");
  assert.equal(field(root, "yearly").checked, true);
  assert.match(text(root), /Next one: 2026-11-27/);
  await type(field(root, "message"), "Happy {age}th, {name}! Love you to pieces.");

  await click(action(root, "preview-card"));
  const frame = one(root, "iframe");
  assert.equal(frame.getAttribute("src"), "/admin/api/preview/abc");
  assert.equal(frame.getAttribute("sandbox"), "", "the card can't run anything");
  assert.match(text(root), /goes out Friday, November 27 at 8 AM/);

  await click(action(root, "test-card"));
  assert.match(text(root), /Sent a test to grammi@example.com/);

  await click(action(root, "save-card"));
  const saved = api.calls.find((c) => c.method === "POST" && c.path === "greetings/cards").body;
  assert.deepEqual(saved, { contactId: KRISTIN, design: "birthday", subject: "", message: "Happy {age}th, {name}! Love you to pieces.", signOff: "Love, Grammi", sendOn: "1999-11-27", hour: 8, timeZone: ZONE, yearly: true });
  assert.match(text(root), /Scheduled\. Birthday card to Kristin goes out Friday, November 27 at 8 AM, and every year after/);
}));

test("a one-time card for someone without a birthday, and a refusal that points at its field", withDom(async () => {
  const api = server();
  const { root } = await open(api);
  await click(action(root, "new-card"));
  await choose(field(root, "contactId"), JIMMY);
  const radios = all(root, "input").filter((n) => n.getAttribute("type") === "radio");
  const christmas = radios.find((r) => r.value === "christmas");
  christmas.checked = true;
  christmas.dispatch("change", { target: christmas });
  await flush();
  const yearly = field(root, "yearly");
  yearly.checked = false;
  yearly.dispatch("change", { target: yearly });
  await flush();
  await type(field(root, "sendOn"), "2026-12-25");
  api.failWith = new ApiError("Write a message for the card", 400, { error: "Write a message for the card", field: "message" });
  await click(action(root, "save-card"));
  assert.match(text(root), /Write a message for the card/);
  assert.equal(document.activeElement, field(root, "message"));
  await type(field(root, "message"), "Merry Christmas, {name}!");
  await click(action(root, "save-card"));
  const saved = api.calls.filter((c) => c.method === "POST" && c.path === "greetings/cards").at(-1).body;
  assert.equal(saved.contactId, JIMMY);
  assert.equal(saved.design, "christmas");
  assert.equal(saved.yearly, false);
  assert.equal(saved.sendOn, "2026-12-25");
}));

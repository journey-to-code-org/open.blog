import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardTitle, sections, cardLine, homeCardLine, newCard, nextYearly, cardTrouble, designLabel,
} from "../../web/studio/parts/card-words.js";

const DESIGNS = [{ id: "birthday", label: "Birthday", subject: "Happy birthday!" }, { id: "just-because", label: "Just because", subject: "Thinking of you" }, { id: "christmas", label: "Christmas", subject: "Merry Christmas" }];
const ricky = { id: "r", name: "Ricky", email: "r@example.com", birthday: "1990-09-07" };
const jimmy = { id: "j", name: "Jimmy", email: "j@example.com", birthday: null };
const card = (over = {}) => ({ id: "c", contactId: "r", design: "birthday", subject: "", status: "scheduled", yearly: true, nextSendAt: "2026-11-15T13:00:00Z", lastSentAt: null, timeZone: "America/New_York", ...over });

test("a card is called by whose and which", () => {
  assert.equal(cardTitle(card(), ricky, DESIGNS), "Ricky's birthday card");
  assert.equal(cardTitle(card({ design: "thinking-of-you" }), null), "A thinking of you card");
  assert.equal(designLabel("just-because", DESIGNS), "Just because");
});

test("the list says what didn't go out first, then what's coming, then what went out; cancelled never shows", () => {
  const groups = sections([
    card({ id: "1", status: "sent", lastSentAt: "2026-01-01T00:00:00Z" }),
    card({ id: "2" }),
    card({ id: "3", status: "failed", error: "rejected" }),
    card({ id: "4", status: "cancelled" }),
    card({ id: "5", status: "sending" }),
  ]);
  assert.deepEqual(groups.map((g) => [g.heading, g.cards.map((c) => c.id)]), [["Didn't go out", ["3"]], ["Coming up", ["2", "5"]], ["Sent", ["1"]]]);
});

test("each card's line says when, or what went wrong", () => {
  const when = (iso) => `[${iso}]`;
  assert.equal(cardLine(card({ status: "failed", error: "rejected" }), when), "Didn't go out: the email service turned it down; the address may be wrong. Open it and schedule it again.");
  assert.equal(cardLine(card({ lastSentAt: "2025-09-07T12:00:00Z" }), when), "Goes out [2026-11-15T13:00:00Z]. Last went out [2025-09-07T12:00:00Z].");
  assert.equal(cardLine(card({ status: "sending" }), when), "It's on its way.");
});

test("Home names a failure first, else what goes out this week, else nothing", () => {
  const now = Date.parse("2026-11-13T15:00:00Z"); // a Friday
  assert.equal(homeCardLine([card()], [ricky], { now, designs: DESIGNS }), "Ricky's birthday card goes out on Sunday");
  assert.equal(homeCardLine([card({ nextSendAt: "2026-11-14T13:00:00Z" })], [ricky], { now, designs: DESIGNS }), "Ricky's birthday card goes out tomorrow");
  assert.equal(homeCardLine([card(), card({ id: "x", contactId: "j", design: "christmas", nextSendAt: "2026-11-18T13:00:00Z" })], [ricky, jimmy], { now }), "2 cards go out this week, Ricky's first, on Sunday");
  assert.equal(homeCardLine([card({ status: "failed" })], [ricky], { now }), "Ricky's birthday card didn't go out");
  assert.equal(homeCardLine([card({ nextSendAt: "2026-12-25T13:00:00Z" })], [ricky], { now }), "");
  assert.equal(homeCardLine([], [], { now }), "");
});

test("a new card starts on their birthday, every year, signed as she last signed", () => {
  assert.deepEqual(newCard({ contacts: [ricky, jimmy], designs: DESIGNS, today: "2026-11-13", signOff: "Love, Mom" }),
    { contactId: "r", design: "birthday", subject: "", message: "", signOff: "Love, Mom", sendOn: "1990-09-07", hour: 8, yearly: true });
  const forJimmy = newCard({ contacts: [ricky, jimmy], designs: DESIGNS, forId: "j", today: "2026-11-13" });
  assert.equal(forJimmy.design, "just-because");
  assert.equal(forJimmy.yearly, false);
  assert.equal(forJimmy.sendOn, "2026-11-13");
  assert.equal(forJimmy.signOff, "Love, Grammi");
});

test("a yearly day comes round next year once it has passed", () => {
  assert.equal(nextYearly("1990-09-07", "2026-11-13"), "2027-09-07");
  assert.equal(nextYearly("1990-12-25", "2026-11-13"), "2026-12-25");
});

test("failures are in her words; a field's own message is kept", () => {
  assert.equal(cardTrouble({ status: 400, message: "Add the person's name", data: { field: "name" } }), "Add the person's name");
  assert.equal(cardTrouble({ status: 409, data: { code: "busy" } }), "That card is going out right now. Try again in a minute.");
  assert.match(cardTrouble({ status: 502, data: {} }, "test"), /^The test didn't go out/);
  assert.match(cardTrouble({ status: 504, data: {} }), /isn't answering/);
  assert.match(cardTrouble({}), /couldn't reach/);
});

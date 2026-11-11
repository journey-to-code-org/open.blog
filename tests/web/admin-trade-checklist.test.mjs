import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAdminPreferences } from "../../web/admin/admin.js";
import { STEP_TEXT, buildTradeChecklist, checklistSteps, checklistVisible } from "../../web/admin/trade-checklist.js";
import { withDom } from "./dom-shim.mjs";
import { all, flush, text } from "./voice-harness.mjs";

// The ten-minute checklist (ADR 0401, #529): the card shows what the server says the files hold, links each open
// step into Admin, and only a dismissal is remembered. No click ever ticks a step.

const answer = (done = []) => ({
  applies: true,
  done: done.length,
  total: 5,
  steps: ["business", "service", "job", "review", "destination"].map((id) => ({
    id,
    done: done.includes(id),
    href: id === "destination" ? (done.includes("job") ? "#/edit/posts%2Foak.md" : null) : { business: "#/business", service: "#/services", job: "#/capture", review: "#/reviews" }[id],
  })),
});

test("the card shows on a trade site with something left to do, and never once dismissed or finished", () => {
  assert.equal(checklistVisible({ dismissed: false, data: answer() }), true);
  assert.equal(checklistVisible({ dismissed: true, data: answer() }), false, "dismissed");
  assert.equal(checklistVisible({ dismissed: false, data: { ...answer(), applies: false } }), false, "not a trade site");
  assert.equal(checklistVisible({ dismissed: false, data: answer(["business", "service", "job", "review", "destination"]) }), false, "all done");
  assert.equal(checklistVisible({ dismissed: false, data: null }), false, "no answer shows nothing");
  assert.equal(checklistVisible({ dismissed: false, data: { applies: true, steps: "many" } }), false);
});

test("only known steps, real booleans and in-Admin links are kept from an answer", () => {
  const steps = checklistSteps({
    steps: [
      { id: "business", done: "yes", href: "javascript:alert(1)" },
      { id: "nope", done: true, href: "#/x" },
      { id: "review", done: true, href: "https://example.com/" },
      { id: "job", done: false, href: "#/capture" },
    ],
  });
  assert.deepEqual(steps, [
    { id: "business", done: false, href: null },
    { id: "review", done: true, href: null },
    { id: "job", done: false, href: "#/capture" },
  ]);
});

test("each open step links to where it is done, done steps say so in words, and sharing waits for a job", async () => {
  await withDom(async () => {
    const card = buildTradeChecklist({ data: answer(["business"]), onDismiss: async () => true });
    document.body.append(card.element);
    assert.equal(text(card.element.querySelector("h2")), "Your site in ten minutes");
    assert.equal(card.element.attributes["aria-labelledby"], card.element.querySelector("h2").attributes.id);
    assert.match(text(card.element), /1 of 5 done/);
    const rows = all(card.element, "li");
    assert.deepEqual(rows.map((row) => row.dataset.step), ["business", "service", "job", "review", "destination"]);
    const business = rows[0];
    assert.equal(business.dataset.done, "true");
    assert.match(text(business), /\(Done\)/);
    assert.equal(all(business, "a").length, 0, "a done step offers nothing to click");
    const links = Object.fromEntries(all(card.element, "a").map((a) => [a.dataset.action, a.attributes.href]));
    assert.deepEqual(links, { "trade-checklist-service": "#/services", "trade-checklist-job": "#/capture", "trade-checklist-review": "#/reviews" });
    assert.match(text(rows[4]), /\(To do\)/);
    assert.match(text(rows[4]), new RegExp(STEP_TEXT.destination.waiting));
  })();
});

test("following a link ticks nothing: the next answer from the server is what changes the card", async () => {
  await withDom(async () => {
    const card = buildTradeChecklist({ data: answer(), onDismiss: async () => true });
    document.body.append(card.element);
    const service = all(card.element, "a").find((a) => a.dataset.action === "trade-checklist-service");
    await service.click?.();
    await flush();
    assert.ok(all(card.element, "li").every((row) => row.dataset.done === "false"));
    const later = buildTradeChecklist({ data: answer(["service"]), onDismiss: async () => true });
    assert.equal(all(later.element, "li").find((row) => row.dataset.step === "service").dataset.done, "true");
  })();
});

test("Hide remembers the choice and removes the card; a failed save keeps it and says so", async () => {
  await withDom(async () => {
    const calls = [];
    const card = buildTradeChecklist({ data: answer(), onDismiss: async () => { calls.push("dismiss"); return true; }, onGone: () => calls.push("gone") });
    document.body.append(card.element);
    const hide = all(card.element, "button").find((b) => b.dataset.action === "trade-checklist-dismiss");
    assert.equal(hide.attributes["aria-label"], "Hide this checklist");
    await hide.click();
    await flush();
    assert.deepEqual(calls, ["dismiss", "gone"]);
    assert.equal(card.element.isConnected, false);
  })();
  await withDom(async () => {
    const card = buildTradeChecklist({ data: answer(), onDismiss: async () => { throw new Error("offline"); } });
    document.body.append(card.element);
    const hide = all(card.element, "button").find((b) => b.dataset.action === "trade-checklist-dismiss");
    await hide.click();
    await flush();
    assert.equal(card.element.isConnected, true);
    assert.equal(hide.disabled, false);
    assert.match(text(all(card.element, "p").find((p) => p.dataset.tradeChecklistStatus)), /could not be remembered/);
  })();
});

test("the dismissal is kept in preferences only when set, so other preferences keep their shape", () => {
  assert.equal("tradeChecklistDismissed" in normalizeAdminPreferences({}), false);
  assert.equal("tradeChecklistDismissed" in normalizeAdminPreferences({ tradeChecklistDismissed: "yes" }), false);
  const kept = normalizeAdminPreferences({ preset: "simple", tradeChecklistDismissed: true, voiceInvitationDismissed: true });
  assert.equal(kept.tradeChecklistDismissed, true);
  assert.equal(kept.voiceInvitationDismissed, true);
  assert.equal(normalizeAdminPreferences(kept).tradeChecklistDismissed, true);
});

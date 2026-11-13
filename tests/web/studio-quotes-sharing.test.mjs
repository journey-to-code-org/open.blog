import { test } from "node:test";
import assert from "node:assert/strict";
import { listLabel, LISTS, emailLine, troubleBanner, eraseLine, statusWords, telHref, homeQuoteLine, quoteTrouble } from "../../web/studio/parts/quote-words.js";
import { deliveryOf, groups, captionWords, healthWords, needsReconnect, sentWords, shareTrouble, accountLabel } from "../../web/studio/parts/share-words.js";

const now = Date.parse("2026-11-13T12:00:00Z");
const req = (over = {}) => ({ id: "1", name: "Pat Miller", phone: "(304) 555-0101", status: "new", createdAt: "2026-11-13T09:00:00Z", notify: "sent", notifyAttempts: 1, ...over });

test("the request lists count by status", () => {
  assert.equal(listLabel(LISTS[0], [req(), req({ status: "handled" }), req()]), "New 2");
});

test("Call dials only digits and a leading plus", () => {
  assert.equal(telHref("(304) 555-0101"), "tel:3045550101");
  assert.equal(telHref("+1 304 555 0101 <script>"), "tel:+13045550101");
  assert.equal(telHref("call me"), "");
});

test("email trouble is said once, and trying again is offered only when it can help", () => {
  assert.equal(emailLine(req(), now), "");
  assert.match(emailLine(req({ notify: "failed", notifyError: "timeout" }), now), /didn't reach you: the email service didn't answer in time\./);
  assert.match(emailLine(req({ notify: "pending", createdAt: "2026-11-13T11:00:00Z" }), now), /hasn't gone out yet/);
  assert.equal(troubleBanner([req()], true, now), null);
  assert.equal(troubleBanner([req({ notify: "failed" })], true, now).retry, true);
  assert.equal(troubleBanner([req({ notify: "failed", notifyAttempts: 5 })], true, now).retry, false);
  assert.match(troubleBanner([req({ notify: "failed" })], false, now).text, /turned off/);
});

test("status changes and erasing say what happened, without ISO dates", () => {
  assert.equal(statusWords(req(), "handled"), "Pat Miller: handled.");
  assert.equal(statusWords(req(), "archived", 30), "Archived. It's under Archived. It's erased automatically 30 days after you archive it.");
  assert.equal(eraseLine("2026-11-25T12:00:00Z", now), "Erased automatically in 12 days.");
  assert.equal(eraseLine("2026-11-01T00:00:00Z", now), "Erased automatically within a day.");
});

test("Home's quote line counts only new requests", () => {
  assert.equal(homeQuoteLine([req(), req({ status: "handled" })]), "1 new quote request");
  assert.equal(homeQuoteLine([]), "");
  assert.match(quoteTrouble({ status: 502 }), /aren't answering/);
});

const share = (over = {}) => ({ id: "a", status: "scheduled", scheduledFor: "2026-11-14T09:00:00Z", destination: { provider: "facebook", displayName: "Ridgeline Roofing" }, ...over });

test("shares are grouped by what needs her", () => {
  const sets = groups([share(), share({ id: "b", status: "failed" }), share({ id: "c", status: "published" }), share({ id: "d", status: "canceled" }), share({ id: "e", status: "scheduled", lastErrorCode: "rate-limited" })]);
  assert.deepEqual(sets.map((g) => [g.heading, g.items.map((i) => i.id)]), [["Needs you", ["b"]], ["Going out", ["a", "e"]], ["Shared", ["c"]]]);
  assert.equal(deliveryOf(share({ lastErrorCode: "rate-limited" })), "retrying");
  assert.equal(accountLabel(share().destination), "Facebook, Ridgeline Roofing");
});

test("the caption is counted against the shortest limit of the accounts chosen", () => {
  assert.equal(captionWords("Ice dams", ["facebook", "bluesky"]).text, "8 of 300 (Bluesky is the shortest)");
  assert.equal(captionWords("x".repeat(310), ["bluesky"]).text, "10 characters too many for Bluesky");
  assert.equal(captionWords("hi", []).text, "2 characters");
});

test("account trouble and send words are hers", () => {
  assert.match(healthWords({ provider: "facebook", health: "needs-reauth" }), /^Facebook stopped working/);
  assert.equal(healthWords({ provider: "facebook", health: "ok" }), "");
  assert.equal(needsReconnect("provider-auth"), true);
  assert.equal(sentWords(["Facebook", "Bluesky"], "in about 5 minutes"), "On its way. Facebook and Bluesky get it in about 5 minutes.");
  assert.match(shareTrouble({ status: 502, data: { code: "hosted-key-rejected" } }), /isn't working right now/);
});

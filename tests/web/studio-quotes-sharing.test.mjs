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

// ---- R1: the spreadsheet and clean-up sheets ----
import { dayWords, exportDayProblem, exportWords, retentionWords, retentionDaysProblem, eraseOldQuestion, erasedOldWords } from "../../web/studio/parts/quote-words.js";

test("a download says how many and which days, and nothing when none", () => {
  assert.equal(dayWords("2026-11-01"), "November 1");
  assert.equal(dayWords("nope"), "");
  assert.equal(exportWords(14, "2026-11-01", "2026-11-13"), "Downloaded 14 requests from November 1 to November 13.");
  assert.equal(exportWords(214, "", ""), "Downloaded all 214 requests.");
  assert.equal(exportWords(1, "2026-11-01", ""), "Downloaded 1 request from November 1 on.");
  assert.equal(exportWords(2, "", "2026-11-13"), "Downloaded 2 requests up to November 13.");
  assert.equal(exportWords(0, "2026-11-01", "2026-11-02"), "No requests in those days, so there's nothing to download.");
  assert.equal(exportDayProblem("2026-11-05", "2026-11-01"), "Pick a day on or after November 5.");
  assert.equal(exportDayProblem("2026-11-05", "2026-11-05"), "");
  assert.equal(exportDayProblem("", "2026-11-01"), "");
});

test("how long archived requests stay, and who chose it", () => {
  assert.equal(retentionWords(30, "admin"), "Archived requests are erased 30 days after you archive them.");
  assert.equal(retentionWords(1, "admin"), "Archived requests are erased 1 day after you archive them.");
  assert.equal(retentionWords(30, "host"), "Archived requests are erased 30 days after you archive them. The person who set up your site chose this.");
  assert.equal(retentionWords(null, null), "Archived requests stay until you erase them.");
  for (const good of ["1", "30", " 3650 "]) assert.equal(retentionDaysProblem(good), "", good);
  for (const bad of ["0", "3651", "1.5", "", "thirty", "-3"]) assert.equal(retentionDaysProblem(bad), "Write a number of days from 1 to 3650.", bad);
});

test("erasing old requests asks with the dry run's counts and says what went", () => {
  assert.deepEqual(eraseOldQuestion({ wouldErase: 3, photos: 2 }, 30), { heading: "Erase 3 old requests now?", text: "They were archived more than 30 days ago. They and their 2 photos go for good; this can't be undone." });
  assert.deepEqual(eraseOldQuestion({ wouldErase: 1, photos: 0 }, 1), { heading: "Erase 1 old request now?", text: "It was archived more than 1 day ago. It goes for good; this can't be undone." });
  assert.equal(eraseOldQuestion({ wouldErase: 1, photos: 1 }, 30).text, "It was archived more than 30 days ago. It and its 1 photo go for good; this can't be undone.");
  assert.equal(erasedOldWords({ erased: 3 }), "Erased 3 old requests.");
  assert.equal(erasedOldWords({ erased: 3, photosPending: 1 }), "Erased 3 old requests. 1 photo is still being removed; nothing points to it.");
});

// ---- R1: a share's history and running late ----
import { historyLine, historyLines, triedWords, lateBanner } from "../../web/studio/parts/share-words.js";

test("a share's history in her words, the day said once per day", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const opts = { provider: "facebook", timeZone: "UTC", now };
  const lines = historyLines([
    { at: "2026-11-20T15:05:00Z", change: "created", state: "pending", attemptNo: 0, code: null },
    { at: "2026-11-20T15:06:00Z", change: "status", state: "retrying", attemptNo: 1, code: "provider-unavailable" },
    { at: "2026-11-20T15:12:00Z", change: "status", state: "published", attemptNo: 2, code: null },
    { at: "2026-11-21T09:00:00Z", change: "rescheduled", state: "pending", scheduledFor: "2026-11-21T10:00:00Z" },
  ], opts);
  assert.deepEqual(lines, [
    "Yesterday at 3:05 PM: scheduled.",
    "3:06 PM: tried, didn't go out. Facebook was busy.",
    "3:12 PM: shared.",
    "Today at 9 AM: time changed to Today at 10 AM.",
  ]);
  assert.equal(historyLine({ at: "2026-11-20T15:06:00Z", change: "status", state: "failed", code: "reviewed-not-posted" }, opts), "Yesterday at 3:06 PM: didn't go out. You checked: it wasn't there.");
  assert.equal(historyLine({ at: "2026-11-20T15:06:00Z", change: "edited", state: "pending" }, { ...opts, withDay: false }), "3:06 PM: words changed.");
  assert.equal(historyLine({ at: "2026-11-20T15:06:00Z", change: "status", state: "unknown", code: "timeout" }, opts), "Yesterday at 3:06 PM: sent, but there was no clear answer. Facebook didn't answer.");
  assert.deepEqual(historyLines(null), []);
  assert.equal(triedWords([{}, {}]), "Tried 2 times.");
  assert.equal(triedWords([{}]), "Tried once.");
  assert.equal(triedWords([]), "");
});

test("only running late and waiting on an account reach her, as one banner", () => {
  assert.equal(lateBanner(null), null);
  assert.equal(lateBanner({ installed: false, alerts: ["backlog-overdue"] }), null);
  assert.equal(lateBanner({ installed: true, alerts: ["needs-review", "accounts-need-reconnect", "failed-recently"] }), null, "the rest are rows already, or Mikey's");
  assert.deepEqual(lateBanner({ installed: true, alerts: ["backlog-overdue"], overdue: 3 }), { heading: "Shares are running late", lines: ["Some posts should have gone out by now. Tell the person who set up your site."] });
  assert.deepEqual(lateBanner({ installed: true, alerts: ["provider-not-configured"], waitingOnProvider: 2 }), { heading: "Some shares can't go out yet", lines: ["2 shares are waiting for an account that isn't set up to post. Tell the person who set up your site, or choose Don't share it."] });
  const both = lateBanner({ installed: true, alerts: ["backlog-overdue", "provider-not-configured"], waitingOnProvider: 1 });
  assert.equal(both.heading, "Shares are running late");
  assert.equal(both.lines[1], "1 share is waiting for an account that isn't set up to post. Tell the person who set up your site, or choose Don't share it.");
});

import { cleanupTrouble } from "../../web/studio/parts/quote-words.js";

test("an older requests service is said in plain words, never as a code", () => {
  const said = cleanupTrouble({ status: 409, data: { code: "hosted-too-old" } });
  assert.equal(said, "Your requests service needs updating before Studio can clean up. Tell the person who set up your site.");
  assert.doesNotMatch(said, /409|hosted|function|deploy/i);
  assert.equal(cleanupTrouble({ status: 502 }), quoteTrouble({ status: 502 }));
});

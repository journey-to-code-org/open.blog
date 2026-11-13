import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFormToken, checkGift, makeFormToken, normalizeCode, opensAt, sameCode } from "../../netlify/lib/gift-card.mjs";
import { createHandler, giftSettings } from "../../netlify/functions/gifts.mjs";

const NY = "America/New_York";

test("a gift opens at midnight on Christmas in her time zone, and one left after it waits a year", () => {
  assert.equal(opensAt(Date.parse("2026-11-13T12:00:00Z"), NY).toISOString(), "2026-12-25T05:00:00.000Z");
  assert.equal(opensAt(Date.parse("2026-12-25T15:00:00Z"), NY).toISOString(), "2026-12-25T05:00:00.000Z", "Christmas Day: opens now");
  assert.equal(opensAt(Date.parse("2026-12-26T06:00:00Z"), NY).toISOString(), "2027-12-25T05:00:00.000Z");
  assert.equal(opensAt(Date.parse("2026-11-13T12:00:00Z"), NY, "11-14").toISOString(), "2026-11-14T05:00:00.000Z", "a rehearsal day");
});

test("the family password ignores case, spaces and punctuation", () => {
  assert.equal(normalizeCode(" Pumpkin  Pie! "), "pumpkinpie");
  assert.ok(sameCode("pumpkin pie", "Pumpkin-Pie"));
  assert.ok(!sameCode("pumpkin", "Pumpkin Pie"));
  assert.ok(!sameCode("", ""));
});

test("a note and a card are checked, and a card is data from fixed lists only", () => {
  assert.deepEqual(checkGift({ from: " Ava ", kind: "note", note: "Love you!", showName: true, wrap: "plaid" }),
    { from: "Ava", wrap: "plaid", showName: true, kind: "note", note: "Love you!", card: null });
  const card = checkGift({ from: "Ava", kind: "card", wrap: "nope", card: { design: "holly", message: "Merry\r\nChristmas", signOff: "Ava", stickers: [{ kind: "star", x: 10, y: 90 }] } });
  assert.equal(card.wrap, "red");
  assert.equal(card.showName, false, "names are private unless the giver says otherwise");
  assert.deepEqual(card.card, { design: "holly", message: "Merry\nChristmas", signOff: "Ava", stickers: [{ kind: "star", x: 10, y: 90 }] });
  for (const bad of [
    { from: "", kind: "note", note: "x" },
    { from: "Ava", kind: "note", note: "x".repeat(1001) },
    { from: "Ava", kind: "card", card: { design: "<svg>", message: "hi" } },
    { from: "Ava", kind: "card", card: { design: "holly", message: "hi", stickers: [{ kind: "skull", x: 1, y: 1 }] } },
    { from: "Ava", kind: "card", card: { design: "holly", message: "hi", stickers: [{ kind: "star", x: 101, y: 1 }] } },
    { from: "Ava", kind: "card", card: { design: "holly", message: "hi", stickers: Array(9).fill({ kind: "star", x: 1, y: 1 }) } },
    { from: "Ava", kind: "html", note: "x" },
  ]) assert.throws(() => checkGift(bad), undefined, JSON.stringify(bad));
});

test("the form token must be a few seconds old, not too old, and unaltered", () => {
  const secret = "k".repeat(40);
  const at = Date.parse("2026-12-01T00:00:00Z");
  const token = makeFormToken(secret, at);
  assert.ok(!checkFormToken(token, secret, at + 1000), "too quick");
  assert.ok(checkFormToken(token, secret, at + 5000));
  assert.ok(!checkFormToken(token, secret, at + 3 * 60 * 60 * 1000), "too old");
  assert.ok(!checkFormToken(token, "x".repeat(40), at + 5000), "another key");
  assert.ok(!checkFormToken(token.replace(/.$/, "A"), secret, at + 5000) || token.endsWith("A"));
});

const env = {
  OPENBLOG_GIFTS_ENABLED: "true", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: "a.b.c", OPENBLOG_SITE_ID: "grammis-house",
  OPENBLOG_GIFTS_ADMIN_KEY: "g".repeat(40), OPENBLOG_GIFTS_FAMILY_CODE: "Pumpkin Pie", OPENBLOG_SITE_ORIGIN: "https://family.example",
  OPENBLOG_ANALYTICS_SALT: "s".repeat(32),
};

test("settings name what's missing, and the family password must be at least 6 letters", () => {
  assert.equal(giftSettings({}).enabled, false);
  assert.ok(giftSettings(env).enabled);
  assert.deepEqual(giftSettings({ ...env, OPENBLOG_GIFTS_FAMILY_CODE: "a b" }).problems, ["OPENBLOG_GIFTS_FAMILY_CODE"]);
});

test("submitting needs the site's origin, a seasoned token and the family password, and owner routes need the key", async () => {
  let at = Date.parse("2026-12-01T12:00:00Z");
  const handler = createHandler({ env, now: () => at, fetchImpl: async () => { throw new Error("no storage in this test"); } });
  const call = (method, path, { body, headers = {} } = {}) => handler({ httpMethod: method, path: `/api/gifts/${path}`, headers, body: body ? JSON.stringify(body) : "" });
  const { token } = JSON.parse((await call("GET", "token")).body);
  at += 10000;
  const origin = { origin: "https://family.example" };
  const gift = { token, code: "pumpkin pie", from: "Ava", kind: "note", note: "Hi Grammi" };
  assert.equal((await call("POST", "submit", { body: gift })).statusCode, 403, "no origin");
  assert.equal((await call("POST", "submit", { body: { ...gift, code: "wrong guess" }, headers: origin })).statusCode, 403);
  assert.equal((await call("POST", "submit", { body: { ...gift, token: "x.y.z" }, headers: origin })).statusCode, 400);
  const robot = await call("POST", "submit", { body: { ...gift, website: "spam.example" }, headers: origin });
  assert.equal(robot.statusCode, 200, "a robot is told it worked and nothing is stored");
  assert.equal((await call("POST", "submit", { body: gift, headers: origin })).statusCode, 503, "a real gift reaches storage");
  assert.equal((await call("GET", "admin/list")).statusCode, 401);
  assert.equal((await call("GET", "admin/list", { headers: { authorization: "Bearer nope" } })).statusCode, 401);
});

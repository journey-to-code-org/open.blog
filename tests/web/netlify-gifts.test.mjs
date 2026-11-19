import { test } from "node:test";
import assert from "node:assert/strict";
import { BOWS, bowOf, checkFamilyCode, checkFormToken, checkGift, checkSpot, spotOf, makeFormToken, normalizeCode, opensAt, sameCode } from "../../netlify/lib/gift-card.mjs";
import { createHandler, giftSettings } from "../../netlify/functions/gifts.mjs";

const NY = "America/New_York";

test("a gift opens at midnight on Christmas in her time zone; a late one (to January 6) opens at once", () => {
  assert.equal(opensAt(Date.parse("2026-11-13T12:00:00Z"), NY).toISOString(), "2026-12-25T05:00:00.000Z");
  assert.equal(opensAt(Date.parse("2026-12-25T15:00:00Z"), NY).toISOString(), "2026-12-25T15:00:00.000Z", "Christmas Day: opens now");
  assert.equal(opensAt(Date.parse("2026-12-26T06:00:00Z"), NY).toISOString(), "2026-12-26T06:00:00.000Z");
  assert.equal(opensAt(Date.parse("2027-01-06T20:00:00Z"), NY).toISOString(), "2027-01-06T20:00:00.000Z", "Epiphany, still in time");
  assert.equal(opensAt(Date.parse("2027-01-07T12:00:00Z"), NY).toISOString(), "2027-12-25T05:00:00.000Z", "after the season: next Christmas");
  assert.equal(opensAt(Date.parse("2026-11-13T12:00:00Z"), NY, "11-14").toISOString(), "2026-11-14T05:00:00.000Z", "a rehearsal day");
});

test("the family password ignores case, spaces and punctuation", () => {
  assert.equal(normalizeCode(" Pumpkin  Pie! "), "pumpkinpie");
  assert.ok(sameCode("pumpkin pie", "Pumpkin-Pie"));
  assert.ok(!sameCode("pumpkin", "Pumpkin Pie"));
  assert.ok(!sameCode("", ""));
  assert.equal(checkFamilyCode("  Pumpkin   Pie "), "Pumpkin Pie");
  assert.throws(() => checkFamilyCode("a b c"));
});

test("a note and a card are checked, and a card is data from fixed lists only", () => {
  assert.deepEqual(checkGift({ from: " Ava ", kind: "note", note: "Love you!", showName: true, wrap: "plaid" }),
    { from: "Ava", wrap: "plaid", bow: "gold", showName: true, spot: null, kind: "note", note: "Love you!", card: null });
  // A bow from the fixed list, the gold one when none (or nonsense) is sent, and "none" for a plain box.
  assert.equal(checkGift({ from: "Ava", kind: "note", note: "x", bow: "white" }).bow, "white");
  assert.equal(checkGift({ from: "Ava", kind: "note", note: "x", bow: "none" }).bow, "none");
  assert.equal(checkGift({ from: "Ava", kind: "note", note: "x", bow: "url(evil)" }).bow, "gold");
  assert.equal(bowOf(null), "gold");
  assert.ok(BOWS.includes("none") && BOWS.length === 6);
  // Where it was set down: two whole numbers on the grid, or nothing at all.
  assert.deepEqual(checkGift({ from: "Ava", kind: "note", note: "x", spot: { x: 40, y: 100, z: 9 } }).spot, { x: 40, y: 100 });
  for (const bad of [null, {}, { x: 1 }, { x: "4", y: 5 }, { x: 4.5, y: 5 }, { x: -1, y: 5 }, { x: 5, y: 101 }, [1, 2]]) assert.equal(checkSpot(bad), null, JSON.stringify(bad));
  assert.deepEqual(spotOf({ spot_x: 0, spot_y: 7 }), { x: 0, y: 7 });
  assert.equal(spotOf({ spot_x: null, spot_y: null }), null);
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
  assert.deepEqual(giftSettings({ ...env, OPENBLOG_GIFTS_FAMILY_CODE: "" }).problems, [], "a first password is optional");
});

test("a gift is stored where its giver set it down, and the tree hands that out", async () => {
  let at = Date.parse("2026-12-01T12:00:00Z");
  const rows = [];
  const handler = createHandler({ env, now: () => at, fetchImpl: async (url, init = {}) => {
    const address = String(url);
    if (address.includes("openblog_gift_settings")) return new Response(JSON.stringify([{ show_names: true, family_code: null, anyone: true, ready: true }]), { status: 200 });
    if (address.includes("rpc/openblog_consume_rate_limit")) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    if (address.includes("openblog_gifts") && init.method === "POST") {
      const row = { id: `g${rows.length + 1}`, created_at: new Date(at).toISOString(), ...JSON.parse(init.body) };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (address.includes("openblog_gifts") && address.includes("spot_x,spot_y")) return new Response(JSON.stringify(rows), { status: 200 });
    if (address.includes("openblog_gifts")) return new Response("[]", { status: 200, headers: { "content-range": "*/0" } });
    throw new Error(`no other storage in this test: ${address}`);
  } });
  const call = (method, path, body) => handler({ httpMethod: method, path: `/api/gifts/${path}`, headers: { origin: "https://family.example" }, body: body ? JSON.stringify(body) : "" });
  const { token } = JSON.parse((await call("GET", "token")).body);
  at += 10000;
  const placed = await call("POST", "submit", { token, from: "Ava", kind: "note", note: "hi", wrap: "gold", bow: "red", spot: { x: 30, y: 80 } });
  assert.equal(placed.statusCode, 200, placed.body);
  assert.deepEqual(JSON.parse(placed.body).gift.spot, { x: 30, y: 80 });
  assert.equal(JSON.parse(placed.body).gift.bow, "red");
  assert.equal((await call("POST", "submit", { token, from: "Ben", kind: "note", note: "hi", spot: { x: 300, y: 80 } })).statusCode, 200, "a place off the grid is dropped, not refused");
  assert.deepEqual(rows.map((row) => [row.spot_x, row.spot_y]), [[30, 80], [null, null]]);
  const tree = JSON.parse((await call("GET", "tree")).body);
  assert.deepEqual(tree.gifts.map((gift) => gift.spot), [{ x: 30, y: 80 }, null]);
  assert.deepEqual(tree.gifts.map((gift) => gift.bow), ["red", "gold"]);
  assert.deepEqual(rows.map((row) => row.bow), ["red", "gold"]);
});

test("gifts start open to anyone; she can ask for the family password, and every other guard stays", async () => {
  let at = Date.parse("2026-12-01T12:00:00Z");
  let saved = null; // no settings row yet: a new tree
  let tries = 0;
  const bare = { ...env, OPENBLOG_GIFTS_FAMILY_CODE: "" };
  const handler = createHandler({ env: bare, now: () => at, fetchImpl: async (url, init = {}) => {
    if (String(url).includes("openblog_gift_settings")) {
      if (init.method === "POST") { saved = { ...saved, ...JSON.parse(init.body) }; return new Response("", { status: 201 }); }
      return new Response(JSON.stringify(saved ? [saved] : []), { status: 200 });
    }
    if (String(url).includes("rpc/openblog_consume_rate_limit")) return new Response(JSON.stringify({ allowed: tries++ < 13 }), { status: 200 });
    if (String(url).includes("openblog_gifts") && !init.method) return new Response("[]", { status: 200 });
    throw new Error("no other storage in this test");
  } });
  const call = (method, path, { body, headers = {} } = {}) => handler({ httpMethod: method, path: `/api/gifts/${path}`, headers, body: body ? JSON.stringify(body) : "" });
  const owner = { authorization: `Bearer ${bare.OPENBLOG_GIFTS_ADMIN_KEY}` };
  const origin = { origin: "https://family.example" };
  const { token } = JSON.parse((await call("GET", "token")).body);
  at += 10000;
  const gift = { token, from: "A neighbor", kind: "note", note: "Merry Christmas" };
  // Until she says her tree is ready, the public side shows nothing and takes nothing.
  const before = JSON.parse((await call("GET", "tree")).body);
  assert.deepEqual([before.ready, before.gifts], [false, []]);
  const early = await call("POST", "submit", { body: gift, headers: origin });
  assert.deepEqual([early.statusCode, JSON.parse(early.body).error], [403, "not-ready"]);
  assert.equal((await call("POST", "admin/settings", { body: { ready: "yes" }, headers: owner })).statusCode, 422);
  assert.equal(JSON.parse((await call("POST", "admin/settings", { body: { ready: true }, headers: owner })).body).ready, true);
  assert.equal(JSON.parse((await call("GET", "tree")).body).ready, true);
  assert.equal(JSON.parse((await call("GET", "tree")).body).anyone, true, "a new tree asks nobody");
  assert.equal((await call("POST", "submit", { body: gift, headers: origin })).statusCode, 503, "a gift with no password reaches storage");
  assert.equal((await call("POST", "submit", { body: gift })).statusCode, 403, "still only from the site");
  assert.equal((await call("POST", "submit", { body: { ...gift, token: "x.y.z" }, headers: origin })).statusCode, 400, "still a seasoned token");
  assert.equal((await call("POST", "submit", { body: { ...gift, website: "spam.example" }, headers: origin })).statusCode, 200, "a robot still stores nothing");

  // Asking for a password needs one to ask for.
  assert.equal((await call("POST", "admin/settings", { body: { anyone: "no" }, headers: owner })).statusCode, 422);
  const none = await call("POST", "admin/settings", { body: { anyone: false }, headers: owner });
  assert.equal(none.statusCode, 422);
  assert.equal(JSON.parse(none.body).error, "family-code-needed");
  const asked = await call("POST", "admin/settings", { body: { anyone: false, familyCode: "Pumpkin Pie" }, headers: owner });
  assert.equal(asked.statusCode, 200, asked.body);
  assert.equal(JSON.parse(asked.body).anyone, false);
  assert.equal(saved.anyone, false);
  assert.equal(JSON.parse((await call("GET", "tree")).body).anyone, false, "the form learns to ask");
  assert.equal((await call("POST", "submit", { body: gift, headers: origin })).statusCode, 403, "no password, no gift");
  assert.equal((await call("POST", "submit", { body: { ...gift, code: "pumpkin pie" }, headers: origin })).statusCode, 503, "the password lets it through");
  assert.equal(JSON.parse((await call("POST", "admin/settings", { body: { anyone: true }, headers: owner })).body).anyone, true, "and she can open it again");
  for (let i = 0; i < 12; i += 1) await call("POST", "submit", { body: gift, headers: origin });
  assert.equal((await call("POST", "submit", { body: gift, headers: origin })).statusCode, 429, "still a limit on tries an hour");
});

test("submitting needs the site's origin, a seasoned token and the family password, and owner routes need the key", async () => {
  let at = Date.parse("2026-12-01T12:00:00Z");
  let tries = 0;
  const handler = createHandler({ env, now: () => at, fetchImpl: async (url) => {
    // Only the owner's settings answer: her tree is ready, and the service's first password applies.
    if (String(url).includes("openblog_gift_settings")) return new Response(JSON.stringify([{ show_names: true, family_code: null, anyone: false, ready: true }]), { status: 200 });
    if (String(url).includes("rpc/openblog_consume_rate_limit")) return new Response(JSON.stringify({ allowed: tries++ < 10 }), { status: 200 });
    throw new Error("no other storage in this test");
  } });
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
  for (let i = 0; i < 10; i += 1) await call("POST", "submit", { body: { ...gift, code: "guess" }, headers: origin });
  assert.equal((await call("POST", "submit", { body: gift, headers: origin })).statusCode, 429, "guessing stops after ten tries an hour, even with the right word");
  assert.equal((await call("GET", "admin/list")).statusCode, 401);
  assert.equal((await call("GET", "admin/list", { headers: { authorization: "Bearer nope" } })).statusCode, 401);
});

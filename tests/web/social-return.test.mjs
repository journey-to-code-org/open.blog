// The way back to Studio after a sign-in (Studio R2, G6) and the callback page in her words
// (G19): Admin names where to return, the function checks it and keeps it on the row, and the
// callback redirects only to that stored value, with only the connection's id, in the fragment. No
// request to the callback can choose where the browser goes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHandler } from "../../netlify/functions/social.mjs";
import { OUTCOMES, validReturnTo } from "../../netlify/lib/social-oauth.mjs";
import { authorization, env, fakeWorld, request } from "./social-oauth-fakes.mjs";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const STUDIO = "https://blog.example.com/admin/studio/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const make = ({ schema } = {}) => {
  const w = fakeWorld({
    schema,
    linkedin: {
      "POST www.linkedin.com/oauth/v2/accessToken": { status: 200, body: { access_token: "AQX-a", refresh_token: "AQX-r", expires_in: 5184000, refresh_token_expires_in: 31536000, scope: "openid,profile,w_member_social" } },
      "POST www.linkedin.com/oauth/v2/revoke": { status: 200, body: {} },
      "GET api.linkedin.com/v2/userinfo": { status: 200, body: { sub: "abc123", name: "Ada" } },
    },
    fallback: { status: 404, body: {} },
  });
  const handler = createHandler({ env: env(), fetchImpl: w.fetchImpl, now: () => NOW });
  return { w, handler };
};
const call = async (handler, method, path, body) => {
  const response = await handler(request(method, `/api/social${path}`, { body }));
  return { status: response.statusCode, body: JSON.parse(response.body || "{}") };
};
const callback = (handler, provider, query) => handler({ httpMethod: "GET", path: `/api/social/callback/${provider}`, rawQuery: query, headers: {} });
const rows = (w) => w.db.tables.openblog_social_connections;

test("validReturnTo: only https, or http to this computer, ending exactly in /admin/studio/", () => {
  for (const good of [STUDIO, "https://blog.example.com:8443/admin/studio/", "http://localhost:4000/admin/studio/", "http://127.0.0.1:8080/admin/studio/", "http://[::1]:3000/admin/studio/", "https://xn--grmmi-qua.example/admin/studio/"]) {
    assert.equal(validReturnTo(good), good, good);
  }
  for (const bad of [
    "http://blog.example.com/admin/studio/", // plain http to a real host
    "https://evil.example/admin/studio/x", // another path
    "https://evil.example/admin/", "https://evil.example/", "https://evil.example",
    "https://blog.example.com/admin/studio/?x=1", "https://blog.example.com/admin/studio/#/x", "https://blog.example.com/admin/studio/?",
    "https://u:p@blog.example.com/admin/studio/", "https://blog.example.com@evil.example/admin/studio/",
    "https://BLOG.example.com/admin/studio/", // not written the way URL writes it
    "https://blog.example.com/admin/studio/../studio/", "https://blog.example.com/admin/%73tudio/",
    "javascript:alert(1)//admin/studio/", "//evil.example/admin/studio/", "/admin/studio/",
    "https://[2001:db8::1]/admin/studio/", "http://localhost.evil.example/admin/studio/",
    `https://${"a".repeat(290)}.example/admin/studio/`, " https://blog.example.com/admin/studio/",
    "https://blog.example.com\\@evil.example/admin/studio/", null, undefined, 7, "",
  ]) assert.equal(validReturnTo(bad), null, String(bad));
});

test("the status says the function can send the browser back (returns: true) only once social-return.sql ran", async () => {
  const { handler } = make();
  const status = await call(handler, "GET", "/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.returns, true);
  // Before social-return.sql (no schema version 5, so no return_to column): Admin must name no address.
  const before = await call(make({ schema: [1, 2, 3, 4] }).handler, "GET", "/status");
  assert.equal(before.status, 200);
  assert.equal(before.body.returns, false);
  // The version can't be read (the store refuses or can't be reached): no, and the status still answers.
  const { w, handler: refusing } = make();
  delete w.db.tables.openblog_social_schema;
  const unread = await call(refusing, "GET", "/status");
  assert.equal(unread.status, 200);
  assert.equal(unread.body.returns, false);
  assert.ok(unread.body.providers.length > 0);
});

test("start keeps a valid return address on the row, refuses any other, and writes none when none is given", async () => {
  const { w, handler } = make();
  const plain = await call(handler, "POST", "/connections", { provider: "linkedin" });
  assert.equal(plain.status, 201);
  assert.equal("return_to" in rows(w)[0], false, "a store from before social-return.sql still takes the row");
  const back = await call(handler, "POST", "/connections", { provider: "linkedin", returnTo: STUDIO });
  assert.equal(back.status, 201);
  assert.equal(rows(w)[1].return_to, STUDIO);
  assert.equal(JSON.stringify(back.body).includes("return"), false, "the address is not echoed");
  for (const returnTo of ["https://evil.example/", "http://blog.example.com/admin/studio/", `${STUDIO}?next=https://evil.example`, 42, null]) {
    const refused = await call(handler, "POST", "/connections", { provider: "linkedin", returnTo });
    assert.equal(refused.status, 400, String(returnTo));
    assert.equal(refused.body.error, "invalid-return-to");
  }
  assert.equal(rows(w).length, 2, "nothing was stored for a refused address");
  // Bluesky has no redirect, so a return address is not a field it takes.
  const bluesky = await call(handler, "POST", "/connections", { provider: "bluesky", identifier: "ada.bsky.social", appPassword: "abcd-efgh-ijkl-mnop", returnTo: STUDIO });
  assert.equal(bluesky.status, 400);
});

test("callback: every outcome of a found row goes 303 to the stored Studio with only the connection id", async () => {
  const { w, handler } = make();
  const started = await call(handler, "POST", "/connections", { provider: "linkedin", returnTo: STUDIO });
  const { state } = authorization(started.body.authorizeUrl);
  const yes = await callback(handler, "linkedin", `code=the-code&state=${state}&returnTo=https%3A%2F%2Fevil.example%2F&redirect_uri=https%3A%2F%2Fevil.example`);
  assert.equal(yes.statusCode, 303);
  assert.equal(yes.headers.location, `${STUDIO}#/sharing/accounts?connection=${started.body.connection.id}`);
  assert.match(started.body.connection.id, UUID);
  assert.equal(yes.headers["referrer-policy"], "no-referrer");
  assert.equal(yes.headers["cache-control"], "no-store");
  assert.equal(yes.body, "");
  assert.ok(!yes.headers.location.includes(state) && !yes.headers.location.includes("the-code"), "no state or code travels on");
  assert.equal(rows(w)[0].status, "authorized");

  // A replay of the used state finds the same row: back to the same Studio, which reads its state.
  const replay = await callback(handler, "linkedin", `code=the-code&state=${state}`);
  assert.equal(replay.statusCode, 303);
  assert.equal(replay.headers.location, yes.headers.location);

  // She said no: the same way back, and Studio says why.
  const no = await call(handler, "POST", "/connections", { provider: "linkedin", returnTo: "http://127.0.0.1:4000/admin/studio/" });
  const refused = await callback(handler, "linkedin", `error=access_denied&state=${authorization(no.body.authorizeUrl).state}`);
  assert.equal(refused.statusCode, 303);
  assert.equal(refused.headers.location, `http://127.0.0.1:4000/admin/studio/#/sharing/accounts?connection=${no.body.connection.id}`);
  assert.equal(rows(w).find((row) => row.id === no.body.connection.id).error_code, "denied");
});

test("callback never redirects anywhere but the stored value: no row, another provider, no address, or a tampered one", async () => {
  const { w, handler } = make();
  const started = await call(handler, "POST", "/connections", { provider: "linkedin", returnTo: STUDIO });
  const { state } = authorization(started.body.authorizeUrl);
  for (const query of [`code=x&state=${"A".repeat(43)}`, "code=x", `code=x&state=${state}&state=${state}`]) {
    const page = await callback(handler, "linkedin", query);
    assert.equal(page.statusCode, 400, query);
    assert.equal(page.headers.location, undefined, query);
  }
  const other = await callback(handler, "facebook", `code=x&state=${state}`);
  assert.equal(other.headers.location, undefined, "a state shown to the wrong provider finds nothing");

  // A row without an address (started before G6, or from plain http) ends on the fixed page.
  const old = await call(handler, "POST", "/connections", { provider: "linkedin" });
  const page = await callback(handler, "linkedin", `code=the-code&state=${authorization(old.body.authorizeUrl).state}`);
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers.location, undefined);

  // A stored value that isn't Studio's shape (written by hand in the database) is never followed.
  for (const tampered of ["https://evil.example/", "https://evil.example/admin/studio/x", "javascript:alert(1)"]) {
    const again = await call(handler, "POST", "/connections", { provider: "linkedin", returnTo: STUDIO });
    rows(w).find((row) => row.id === again.body.connection.id).return_to = tampered;
    const result = await callback(handler, "linkedin", `code=the-code&state=${authorization(again.body.authorizeUrl).state}`);
    assert.equal(result.headers.location, undefined, tampered);
    assert.match(result.headers["content-type"], /^text\/html/);
  }
});

test("reconnect keeps the return address for an OAuth sign-in and refuses one beside an app password", async () => {
  const { w, handler } = make();
  const started = await call(handler, "POST", "/connections", { provider: "linkedin" });
  await callback(handler, "linkedin", `code=the-code&state=${authorization(started.body.authorizeUrl).state}`);
  const account = (await call(handler, "POST", `/connections/${started.body.connection.id}/select`, { destination: "urn:li:person:abc123" })).body.account;
  const again = await call(handler, "POST", `/accounts/${account.id}/reconnect`, { returnTo: STUDIO });
  assert.equal(again.status, 201);
  assert.equal(rows(w).find((row) => row.id === again.body.connection.id).return_to, STUDIO);
  const done = await callback(handler, "linkedin", `code=the-code&state=${authorization(again.body.authorizeUrl).state}`);
  assert.equal(done.statusCode, 303);
  assert.equal(done.headers.location, `${STUDIO}#/sharing/accounts?connection=${again.body.connection.id}`);
  assert.equal(rows(w).find((row) => row.id === again.body.connection.id).status, "completed");
  assert.equal((await call(handler, "POST", `/accounts/${account.id}/reconnect`, { returnTo: "https://evil.example/" })).status, 400);
  assert.equal((await call(handler, "POST", `/accounts/${account.id}/reconnect`, { identifier: "ada.bsky.social", appPassword: "abcd-efgh-ijkl-mnop", returnTo: STUDIO })).status, 400);
});

test("G19: the callback page and every outcome call it your blog, never Studio or Admin", async () => {
  for (const [code, words] of Object.entries(OUTCOMES)) {
    assert.doesNotMatch(words, /\bAdmin\b/, code);
    assert.doesNotMatch(words, /\bStudio\b/, code);
    assert.doesNotMatch(words, /\bauthoriz/i, code);
  }
  const { handler } = make();
  const started = await call(handler, "POST", "/connections", { provider: "linkedin" });
  const page = await callback(handler, "linkedin", `code=the-code&state=${authorization(started.body.authorizeUrl).state}`);
  assert.match(page.body, /<h1>LinkedIn said yes<\/h1>/);
  assert.match(page.body, /<title>LinkedIn said yes<\/title>/);
  assert.match(page.body, /Go back to your blog to choose where your posts go\./);
  assert.match(page.body, /You can close this tab and go back to your blog\./);
  assert.doesNotMatch(page.body, /Admin|Studio/);
  const no = await callback(handler, "linkedin", "code=x");
  assert.match(no.body, /<h1>Not connected<\/h1>/);
  assert.match(no.body, /Start again on your blog\./);
  assert.doesNotMatch(no.body, /Studio/);
});

test("social-return.sql adds one checked, nullable column, and its rollback takes exactly that away", () => {
  const strip = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const up = strip(readFileSync(new URL("../../supabase/social-return.sql", import.meta.url), "utf8"));
  const down = strip(readFileSync(new URL("../../supabase/social-return-rollback.sql", import.meta.url), "utf8"));
  assert.match(up, /alter table public\.openblog_social_connections add column if not exists return_to text;/);
  assert.match(up, /insert into public\.openblog_social_schema \(version\) values \(5\) on conflict do nothing/);
  assert.match(up, /if not exists \( select 1 from pg_constraint where conname = 'openblog_social_connections_return_to'/, "running it twice changes nothing");
  assert.match(up, /check \( return_to is null or \( char_length\(return_to\) <= 300/);
  assert.doesNotMatch(up, /\bdrop\b|\btruncate\b|\bdelete\s+from\b|\bupdate public\.|not null default|grant /);
  // The check holds the same shape the function checks: what one takes, the other takes.
  const pattern = new RegExp(up.match(/return_to ~ '([^']+)'/)[1]);
  for (const value of [STUDIO, "http://localhost:4000/admin/studio/", "http://[::1]:3000/admin/studio/"]) assert.ok(pattern.test(value) && validReturnTo(value), value);
  for (const value of ["http://blog.example.com/admin/studio/", "https://evil.example/admin/studio/x", "https://u@evil.example/admin/studio/"]) assert.ok(!pattern.test(value) && !validReturnTo(value), value);
  assert.match(down, /alter table public\.openblog_social_connections drop constraint if exists openblog_social_connections_return_to/);
  assert.match(down, /alter table public\.openblog_social_connections drop column if exists return_to/);
  assert.match(down, /delete from public\.openblog_social_schema where version = 5/);
  assert.doesNotMatch(down, /drop table/);
});

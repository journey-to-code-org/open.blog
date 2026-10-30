// Bluesky sign-in of optional social publishing (epic #382, story #391, task DIST2.1.1, ADR 0760):
// an AT Protocol session opened from an app password, kept sealed, refreshed single-flight, and
// ended on disconnect. The service is scripted; no test reaches a network.
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../netlify/functions/social.mjs";
import { describeProvider, openBlueskySession, ProviderError, refreshWith, serviceOrigin, socialProviders } from "../../netlify/lib/social-providers.mjs";
import { ProviderTokenError } from "../../netlify/lib/social-credentials.mjs";
import { blueskyIdentifier, tokenSecondsLeft, validAppPassword } from "../../netlify/lib/social-atproto.mjs";
import { env, everything, fakeWorld, request } from "./social-oauth-fakes.mjs";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const OTHER_DID = "did:plc:zyxwvutsrqponmlkjihgfedc";
const PASSWORD = "abcd-efgh-ijkl-mnop";
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
// A session token as the service writes it: three base64url parts, `exp` in the middle one.
export const jwt = (exp, tag = "x") => `${b64url({ alg: "ES256K", typ: tag })}.${b64url({ scope: "com.atproto.appPass", sub: DID, exp })}.c2lnbmF0dXJl${tag}`;
const ACCESS = jwt(NOW / 1000 + 7200, "access");
const REFRESH = jwt(NOW / 1000 + 90 * 86400, "refresh");
const session = (over = {}) => ({ status: 200, body: { accessJwt: ACCESS, refreshJwt: REFRESH, handle: "ada.bsky.social", did: DID, active: true, email: "ada@example.com", ...over } });

const CREATE = "POST bsky.social/xrpc/com.atproto.server.createSession";
const REFRESH_ROUTE = "POST bsky.social/xrpc/com.atproto.server.refreshSession";
const DELETE = "POST bsky.social/xrpc/com.atproto.server.deleteSession";

const make = ({ overrides = {}, handlers = {}, accounts = [] } = {}) => {
  const w = fakeWorld({ accounts, fallback: { status: 404, body: {} } });
  Object.assign(w.handlers, { [CREATE]: session(), [DELETE]: { status: 200, body: {} }, ...handlers });
  const handler = createHandler({ env: env({ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true", ...overrides }), fetchImpl: w.fetchImpl, now: () => NOW });
  return { w, handler };
};
const connect = async (handler, body = { provider: "bluesky", identifier: "@Ada.bsky.social", appPassword: PASSWORD }) => {
  const response = await handler(request("POST", "/api/social/connections", { body }));
  return { response, body: JSON.parse(response.body) };
};
const provider = (w) => w.provider.filter((call) => call.host === "bsky.social");

test("settings: Bluesky is offered only when turned on, and only with an https origin as its service", () => {
  assert.equal(socialProviders(env()).bluesky, undefined);
  const on = socialProviders(env({ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true" })).bluesky;
  assert.equal(on.apiBase, "https://bsky.social");
  assert.equal(on.login, "app-password");
  assert.deepEqual(describeProvider(on), { provider: "bluesky", label: "Bluesky", login: "app-password", redirectUri: null, version: "atproto", scopes: [], requiredScopes: [], organizations: false, pkce: false });
  assert.equal(socialProviders(env({ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true", OPENBLOG_SOCIAL_BLUESKY_SERVICE: "https://pds.example.com/" })).bluesky.apiBase, "https://pds.example.com");
  for (const [overrides, name] of [
    [{ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "yes" }, "OPENBLOG_SOCIAL_BLUESKY_ENABLED"],
    [{ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true", OPENBLOG_SOCIAL_BLUESKY_SERVICE: "http://bsky.social" }, "OPENBLOG_SOCIAL_BLUESKY_SERVICE"],
    [{ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true", OPENBLOG_SOCIAL_BLUESKY_SERVICE: "https://bsky.social/xrpc" }, "OPENBLOG_SOCIAL_BLUESKY_SERVICE"],
    [{ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true", OPENBLOG_SOCIAL_BLUESKY_SERVICE: "https://u:p@bsky.social" }, "OPENBLOG_SOCIAL_BLUESKY_SERVICE"],
  ]) {
    const providers = socialProviders(env(overrides));
    assert.equal(providers.bluesky, undefined);
    assert.ok(providers.problems.includes(name), name);
    assert.ok(!everything(providers.problems).includes("u:p"));
  }
  assert.equal(serviceOrigin("https://localhost"), null);
});

test("identifiers and app passwords: a handle or a DID, and only the app-password shape", () => {
  assert.equal(blueskyIdentifier("@Ada.Bsky.Social"), "ada.bsky.social");
  assert.equal(blueskyIdentifier(DID), DID);
  for (const bad of ["ada", "ada@example.com", "https://bsky.app/profile/ada", "did:plc:short", "", null]) assert.equal(blueskyIdentifier(bad), null, String(bad));
  assert.ok(validAppPassword(PASSWORD));
  assert.ok(validAppPassword("ABCD-EFGH-IJKL-MNOP"));
  for (const bad of ["correct horse battery staple", "abcd-efgh-ijkl", "abcd_efgh_ijkl_mnop", ""]) assert.equal(validAppPassword(bad), false, bad);
  assert.equal(tokenSecondsLeft(ACCESS, NOW), 7200);
  assert.equal(tokenSecondsLeft("not-a-token", NOW), undefined);
});

test("connect: one createSession at the service, the session sealed, and the account waiting for the author's choice", async () => {
  const { w, handler } = make();
  const { response, body } = await connect(handler);
  assert.equal(response.statusCode, 201);
  const [call] = provider(w);
  assert.equal(call.url, "https://bsky.social/xrpc/com.atproto.server.createSession");
  assert.equal(body.connection.status, "authorized");
  assert.deepEqual(body.connection.destinations, [{ id: DID, kind: "account", name: "@ada.bsky.social", eligible: true, reason: null }]);
  const stored = JSON.stringify(w.db.tables);
  for (const secret of [PASSWORD, ACCESS, REFRESH, "ada@example.com"]) {
    assert.ok(!stored.includes(secret), "nothing secret is stored in the clear");
    assert.ok(!response.body.includes(secret), "nothing secret is answered");
  }
  // The author chooses the account; the credential is stored with the expiry the token carries.
  const chosen = await handler(request("POST", `/api/social/connections/${body.connection.id}/select`, { body: { destination: DID } }));
  assert.equal(chosen.statusCode, 201);
  const reply = JSON.parse(chosen.body);
  assert.equal(reply.account.provider, "bluesky");
  assert.equal(reply.account.kind, "account");
  assert.equal(reply.account.externalId, DID);
  assert.equal(reply.credential.accessExpiresAt, "2026-10-29T14:00:00.000Z");
  assert.ok(!chosen.body.includes(ACCESS) && !chosen.body.includes(REFRESH));
});

test("connect sends exactly the handle and the app password, as JSON, to the service and nowhere else", async () => {
  const w = fakeWorld({ fallback: { status: 404, body: {} } });
  w.handlers[CREATE] = session();
  const raw = [];
  const spy = async (url, init) => {
    if (!String(url).startsWith("https://project.supabase.co/")) raw.push({ url: String(url), init });
    return w.fetchImpl(url, init);
  };
  const handler = createHandler({ env: env({ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true" }), fetchImpl: spy, now: () => NOW });
  await connect(handler);
  assert.equal(raw.length, 1);
  assert.deepEqual(JSON.parse(raw[0].init.body), { identifier: "ada.bsky.social", password: PASSWORD });
  assert.equal(raw[0].init.headers["content-type"], "application/json");
  assert.equal(raw[0].init.headers.authorization, undefined);
  assert.equal(raw[0].init.redirect, "manual");
});

test("an account password, a bad handle or a missing field is refused before anything is sent", async () => {
  const { w, handler } = make();
  for (const [body, code] of [
    [{ provider: "bluesky", identifier: "ada.bsky.social", appPassword: "my real password" }, "invalid-app-password"],
    [{ provider: "bluesky", identifier: "ada", appPassword: PASSWORD }, "invalid-identifier"],
    [{ provider: "bluesky", identifier: "ada.bsky.social" }, "invalid-app-password"],
    [{ provider: "linkedin", identifier: "ada.bsky.social", appPassword: PASSWORD }, "invalid-request"],
    [{ provider: "bluesky", identifier: "ada.bsky.social", appPassword: PASSWORD, site: "x" }, "site-not-accepted"],
    [{ provider: "bluesky", identifier: "ada.bsky.social", appPassword: PASSWORD, extra: 1 }, "invalid-request"],
  ]) {
    const { response, body: reply } = await connect(handler, body);
    assert.equal(response.statusCode, 400, code);
    assert.equal(reply.error, code);
    assert.ok(!response.body.includes("my real password"));
  }
  // The redirect handshake is not offered for Bluesky.
  const started = await connect(handler, { provider: "bluesky" });
  assert.equal(started.response.statusCode, 400);
  assert.equal(started.body.error, "app-password-required");
  assert.equal(provider(w).length, 0);
});

test("the service's refusals end the attempt with a fixed message and keep nothing", async () => {
  for (const [reply, status, code] of [
    [{ status: 401, body: { error: "AuthenticationRequired", message: "Invalid identifier or password <script>" } }, 400, "credentials-rejected"],
    [{ status: 400, body: { error: "AuthFactorTokenRequired" } }, 400, "credentials-rejected"],
    [{ status: 429, body: { error: "RateLimitExceeded" } }, 429, "provider-rate-limited"],
    [{ status: 502, body: {} }, 503, "provider-unavailable"],
    [new Error("ECONNRESET"), 503, "provider-unavailable"],
    [{ status: 200, body: { accessJwt: "nope", refreshJwt: REFRESH, did: DID, handle: "ada.bsky.social" } }, 500, "provider-error"],
  ]) {
    const { w, handler } = make({ handlers: { [CREATE]: reply } });
    const { response, body } = await connect(handler);
    assert.equal(response.statusCode, status, code);
    assert.equal(body.error, code);
    assert.ok(!response.body.includes("<script>") && !response.body.includes("Invalid identifier"));
    const [row] = w.db.tables.openblog_social_connections;
    assert.equal(row.status, "failed");
    assert.equal(row.envelope, null);
  }
});

test("an inactive account is not offered and its session is ended at once", async () => {
  const { w, handler } = make({ handlers: { [CREATE]: session({ active: false, status: "deactivated" }) } });
  const { response, body } = await connect(handler);
  assert.equal(response.statusCode, 409);
  assert.equal(body.error, "no-destination");
  const ended = provider(w).find((call) => call.path.endsWith("deleteSession"));
  assert.equal(ended.headers.authorization, `Bearer ${REFRESH}`);
  assert.equal(w.db.tables.openblog_social_accounts.length, 0);
});

test("canceling a waiting attempt ends its session and erases it", async () => {
  const { w, handler } = make();
  const { body } = await connect(handler);
  const canceled = await handler(request("POST", `/api/social/connections/${body.connection.id}/cancel`, { body: {} }));
  assert.equal(canceled.statusCode, 200);
  assert.ok(provider(w).some((call) => call.path.endsWith("deleteSession") && call.headers.authorization === `Bearer ${REFRESH}`));
  assert.equal(w.db.tables.openblog_social_connections[0].envelope, null);
});

const connected = async (make_ = make) => {
  const world = make_();
  const { body } = await connect(world.handler);
  const chosen = JSON.parse((await world.handler(request("POST", `/api/social/connections/${body.connection.id}/select`, { body: { destination: DID } }))).body);
  return { ...world, account: chosen.account };
};

test("reconnect signs in again for the same account only", async () => {
  const { w, handler, account } = await connected();
  const NEW_ACCESS = jwt(NOW / 1000 + 7200, "access2");
  w.handlers[CREATE] = session({ accessJwt: NEW_ACCESS });
  const again = await handler(request("POST", `/api/social/accounts/${account.id}/reconnect`, { body: { identifier: "ada.bsky.social", appPassword: PASSWORD } }));
  assert.equal(again.statusCode, 201);
  assert.equal(JSON.parse(again.body).connection.status, "completed");
  // A different account is refused and its fresh session ended.
  w.handlers[CREATE] = session({ did: OTHER_DID, handle: "eve.bsky.social" });
  const before = provider(w).filter((call) => call.path.endsWith("deleteSession")).length;
  const wrong = await handler(request("POST", `/api/social/accounts/${account.id}/reconnect`, { body: { identifier: "eve.bsky.social", appPassword: PASSWORD } }));
  assert.equal(wrong.statusCode, 409);
  assert.equal(JSON.parse(wrong.body).error, "identity-mismatch");
  assert.equal(provider(w).filter((call) => call.path.endsWith("deleteSession")).length, before + 1);
  // Without a sign-in there is nothing to reconnect with.
  const bare = await handler(request("POST", `/api/social/accounts/${account.id}/reconnect`, { body: {} }));
  assert.equal(JSON.parse(bare.body).error, "app-password-required");
});

test("disconnect ends the session at the service and erases the tokens", async () => {
  const { w, handler, account } = await connected();
  const done = await handler(request("POST", `/api/social/accounts/${account.id}/disconnect`, { body: {} }));
  assert.equal(done.statusCode, 200);
  const ended = provider(w).filter((call) => call.path.endsWith("deleteSession"));
  assert.equal(ended.length, 1);
  assert.equal(ended[0].headers.authorization, `Bearer ${REFRESH}`);
  assert.equal(w.db.tables.openblog_social_credentials[0].envelope, null);
});

test("refresh rotates both tokens, and only the service's own word ends the session", async () => {
  const settings = socialProviders(env({ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true" })).bluesky;
  const NEXT_ACCESS = jwt(NOW / 1000 + 7200, "next-access");
  const NEXT_REFRESH = jwt(NOW / 1000 + 90 * 86400, "next-refresh");
  const calls = [];
  const reply = (status, body) => async (url, init) => (calls.push({ url: String(url), init }), { ok: status < 300, status, text: async () => JSON.stringify(body) });
  const fresh = await refreshWith(settings, reply(200, { accessJwt: NEXT_ACCESS, refreshJwt: NEXT_REFRESH, did: DID, handle: "ada.bsky.social" }), () => NOW)(REFRESH);
  assert.deepEqual(fresh, { accessToken: NEXT_ACCESS, refreshToken: NEXT_REFRESH, expiresIn: 7200, refreshExpiresIn: 90 * 86400 });
  assert.equal(calls[0].url, "https://bsky.social/xrpc/com.atproto.server.refreshSession");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${REFRESH}`);
  for (const [status, body, permanent] of [
    [400, { error: "ExpiredToken" }, true],
    [400, { error: "InvalidToken" }, true],
    [401, { error: "AccountTakedown" }, true],
    [400, { error: "InvalidRequest" }, false],
    [500, {}, false],
    [429, { error: "RateLimitExceeded" }, false],
  ]) {
    await assert.rejects(refreshWith(settings, reply(status, body), () => NOW)(REFRESH), (error) => error instanceof ProviderTokenError && error.permanent === permanent);
  }
  await assert.rejects(refreshWith(settings, async () => { throw new Error("offline"); })(REFRESH), (error) => error instanceof ProviderTokenError && !error.permanent);
  // Facebook Page tokens are not refreshed.
  assert.equal(refreshWith(socialProviders(env()).facebook, reply(200, {})), undefined);
});

test("openBlueskySession refuses before sending when the password is not an app password", async () => {
  const settings = socialProviders(env({ OPENBLOG_SOCIAL_BLUESKY_ENABLED: "true" })).bluesky;
  let sent = 0;
  await assert.rejects(openBlueskySession(settings, { identifier: "ada.bsky.social", password: "hunter2hunter2" }, async () => (sent += 1, {})), (error) => error instanceof ProviderError && error.code === "credentials-rejected");
  assert.equal(sent, 0);
});

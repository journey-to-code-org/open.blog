// Mastodon sign-in of optional social publishing (epic #382, story #392, task DIST2.2.1, ADR 0762):
// OAuth 2 against the one instance the deployer names, granular scopes read from the grant, the
// account and the instance's limits discovered, and the token revoked when it is no longer used.
// The instance is scripted; no test reaches a network.
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../netlify/functions/social.mjs";
import { authorizationUrl, checkScopes, describeProvider, ownsGrant, refreshWith, socialProviders } from "../../netlify/lib/social-providers.mjs";
import { ProviderTokenError } from "../../netlify/lib/social-credentials.mjs";
import { CALLBACK_BASE, authorization, env, everything, fakeWorld, request } from "./social-oauth-fakes.mjs";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const INSTANCE = "https://social.example.org";
const HOST = "social.example.org";
const SECRET = "mastodon-client-secret-0003";
const CODE = "mastodon-code-abcdef0123456789";
const TOKEN = "mastodon-access-token-0001";
const ACCOUNT_ID = "109876543210";
const MASTODON = { OPENBLOG_SOCIAL_MASTODON_CLIENT_ID: "md-client-id", OPENBLOG_SOCIAL_MASTODON_CLIENT_SECRET: SECRET, OPENBLOG_SOCIAL_MASTODON_INSTANCE: INSTANCE };
const SCOPES = "read:accounts write:statuses read:statuses write:media";

const TOKEN_ROUTE = `POST ${HOST}/oauth/token`;
const REVOKE = `POST ${HOST}/oauth/revoke`;
const ME = `GET ${HOST}/api/v1/accounts/verify_credentials`;
const INSTANCE_ROUTE = `GET ${HOST}/api/v2/instance`;

const me = (over = {}) => ({ status: 200, body: { id: ACCOUNT_ID, username: "ada", acct: "ada", display_name: "Ada", source: { privacy: "public", note: "secret note" }, ...over } });
const instance = (max = 500) => ({ status: 200, body: { domain: HOST, configuration: { statuses: { max_characters: max, characters_reserved_per_url: 23 }, media_attachments: { description_limit: 1500, image_size_limit: 16777216, supported_mime_types: ["image/jpeg", "image/png"] } } } });

const make = ({ overrides = {}, handlers = {}, accounts = [] } = {}) => {
  const w = fakeWorld({ accounts, fallback: { status: 404, body: {} } });
  Object.assign(w.handlers, { [TOKEN_ROUTE]: { status: 200, body: { access_token: TOKEN, token_type: "Bearer", scope: SCOPES, created_at: NOW / 1000 } }, [ME]: me(), [INSTANCE_ROUTE]: instance(), [REVOKE]: { status: 200, body: {} }, ...handlers });
  const handler = createHandler({ env: env({ ...MASTODON, ...overrides }), fetchImpl: w.fetchImpl, now: () => NOW });
  return { w, handler };
};
const start = async (handler, path = "/api/social/connections", body = { provider: "mastodon" }) => JSON.parse((await handler(request("POST", path, { body }))).body);
const callback = (handler, query) => handler({ httpMethod: "GET", path: "/api/social/callback/mastodon", rawQuery: query, headers: {} });
const atInstance = (w) => w.provider.filter((call) => call.host === HOST);

test("settings: Mastodon is offered only with a client id, secret and an https instance origin", () => {
  assert.equal(socialProviders(env()).mastodon, undefined, "off unless set up");
  const on = socialProviders(env(MASTODON)).mastodon;
  assert.equal(on.authorizeUrl, `${INSTANCE}/oauth/authorize`);
  assert.equal(on.tokenUrl, `${INSTANCE}/oauth/token`);
  assert.equal(on.revokeUrl, `${INSTANCE}/oauth/revoke`);
  assert.equal(on.apiBase, INSTANCE);
  assert.equal(on.redirectUri, `${CALLBACK_BASE}/callback/mastodon`);
  assert.deepEqual([...on.scopes], ["read:accounts", "write:statuses", "read:statuses", "write:media"]);
  assert.deepEqual([...on.requiredScopes], ["read:accounts", "write:statuses"]);
  assert.ok(ownsGrant(on), "a Mastodon token is this connection's own");
  const described = describeProvider(on);
  assert.equal(described.instance, INSTANCE);
  assert.equal(described.visibility, "public");
  assert.equal(described.media, "none");
  assert.ok(!everything(described).includes(SECRET) && !everything(on).includes(SECRET), "the secret never serializes");
  for (const [overrides, name] of [
    [{ OPENBLOG_SOCIAL_MASTODON_INSTANCE: "" }, "OPENBLOG_SOCIAL_MASTODON_INSTANCE"],
    [{ OPENBLOG_SOCIAL_MASTODON_INSTANCE: "http://social.example.org" }, "OPENBLOG_SOCIAL_MASTODON_INSTANCE"],
    [{ OPENBLOG_SOCIAL_MASTODON_INSTANCE: "https://social.example.org/@ada" }, "OPENBLOG_SOCIAL_MASTODON_INSTANCE"],
    [{ OPENBLOG_SOCIAL_MASTODON_INSTANCE: "https://u:p@social.example.org" }, "OPENBLOG_SOCIAL_MASTODON_INSTANCE"],
    [{ OPENBLOG_SOCIAL_MASTODON_VISIBILITY: "direct" }, "OPENBLOG_SOCIAL_MASTODON_VISIBILITY"],
    [{ OPENBLOG_SOCIAL_MASTODON_API_VERSION: "v2" }, "OPENBLOG_SOCIAL_MASTODON_API_VERSION"],
  ]) {
    const providers = socialProviders(env({ ...MASTODON, ...overrides }));
    assert.equal(providers.mastodon, undefined, name);
    assert.ok(providers.problems.includes(name), name);
    assert.ok(!everything(providers.problems).includes("u:p"));
  }
});

test("settings: visibility is a deployer choice, and the cover image only with a delivery long enough for it", () => {
  assert.equal(socialProviders(env({ ...MASTODON, OPENBLOG_SOCIAL_MASTODON_VISIBILITY: "unlisted" })).mastodon.visibility, "unlisted");
  const short = socialProviders(env({ ...MASTODON, OPENBLOG_SOCIAL_MASTODON_MEDIA: "cover" }));
  assert.equal(short.mastodon.media, "none", "the default 4-second delivery is too short for the cover");
  assert.deepEqual([...short.problems].sort(), ["OPENBLOG_SOCIAL_MASTODON_MEDIA", "OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS"]);
  const long = socialProviders(env({ ...MASTODON, OPENBLOG_SOCIAL_MASTODON_MEDIA: "cover", OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS: "15", OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "20" }));
  assert.equal(long.mastodon.media, "cover");
  assert.deepEqual([...long.problems], []);
  const odd = socialProviders(env({ ...MASTODON, OPENBLOG_SOCIAL_MASTODON_MEDIA: "all" }));
  assert.equal(odd.mastodon.media, "none");
  assert.ok(odd.problems.includes("OPENBLOG_SOCIAL_MASTODON_MEDIA"));
});

test("the authorization URL is the instance's own, asks for the granular scopes, and forces a sign-in only to reconnect", () => {
  const settings = socialProviders(env({ ...MASTODON, OPENBLOG_SOCIAL_MASTODON_PKCE: "true" })).mastodon;
  const first = new URL(authorizationUrl(settings, { state: "s", challenge: "c" }));
  assert.equal(first.origin + first.pathname, `${INSTANCE}/oauth/authorize`);
  assert.equal(first.searchParams.get("scope"), SCOPES);
  assert.equal(first.searchParams.get("code_challenge_method"), "S256");
  assert.equal(first.searchParams.get("force_login"), null);
  const again = new URL(authorizationUrl(settings, { state: "s", challenge: null, reauthorize: true }));
  assert.equal(again.searchParams.get("force_login"), "true");
});

test("scopes: a broad scope grants its granular ones, and only reading the account and posting are required", () => {
  const settings = socialProviders(env(MASTODON)).mastodon;
  assert.deepEqual(checkScopes(settings, ["read", "write"]), { missingRequired: [], missingOptional: [] });
  assert.deepEqual(checkScopes(settings, ["read:accounts", "write:statuses"]), { missingRequired: [], missingOptional: ["read:statuses", "write:media"] });
  assert.deepEqual(checkScopes(settings, ["read:accounts"]).missingRequired, ["write:statuses"]);
  assert.deepEqual(checkScopes(settings, ["write:statuses", "follow"]).missingRequired, ["read:accounts"]);
});

test("connect: the code is exchanged at the instance, the account is the one destination and nothing secret is kept plain", async () => {
  const { w, handler } = make();
  const started = await start(handler);
  const { url, state } = authorization(started.authorizeUrl);
  assert.equal(url.origin, INSTANCE);
  const page = await callback(handler, `code=${CODE}&state=${state}`);
  assert.equal(page.statusCode, 200);
  const exchange = atInstance(w).find((call) => call.path === "/oauth/token");
  assert.equal(exchange.form.client_secret, SECRET, "the secret goes in the body");
  assert.equal(exchange.form.redirect_uri, `${CALLBACK_BASE}/callback/mastodon`);
  assert.ok(!exchange.url.includes(SECRET));
  const verify = atInstance(w).find((call) => call.path === "/api/v1/accounts/verify_credentials");
  assert.equal(verify.headers.authorization, `Bearer ${TOKEN}`);
  const instanceCall = atInstance(w).find((call) => call.path === "/api/v2/instance");
  assert.equal(instanceCall.headers.authorization, undefined, "the instance's configuration is public: no token is sent");
  const [connection] = JSON.parse((await handler(request("GET", "/api/social/connections"))).body).connections;
  assert.equal(connection.status, "authorized");
  assert.deepEqual(connection.grantedScopes, SCOPES.split(" "));
  assert.deepEqual(connection.destinations, [{ id: ACCOUNT_ID, kind: "account", name: `@ada@${HOST}`, eligible: true, reason: null }]);
  assert.deepEqual(connection.notes, []);
  const stored = JSON.stringify(w.db.tables);
  for (const secret of [TOKEN, SECRET, CODE, "secret note"]) assert.ok(!stored.includes(secret), "nothing secret is stored in the clear");
  const chosen = await handler(request("POST", `/api/social/connections/${connection.id}/select`, { body: { destination: ACCOUNT_ID } }));
  assert.equal(chosen.statusCode, 201);
  const reply = JSON.parse(chosen.body);
  assert.equal(reply.account.provider, "mastodon");
  assert.equal(reply.account.externalId, ACCOUNT_ID);
  assert.equal(reply.credential.accessExpiresAt, null, "a Mastodon token does not expire");
  assert.ok(!chosen.body.includes(TOKEN));
});

test("discovery says what the grant and the instance leave out, and a suspended account is not offered", async () => {
  const { handler } = make({
    overrides: { OPENBLOG_SOCIAL_MASTODON_MEDIA: "cover", OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS: "15", OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "20" },
    handlers: { [TOKEN_ROUTE]: { status: 200, body: { access_token: TOKEN, scope: "read:accounts write:statuses" } }, [INSTANCE_ROUTE]: instance(280) },
  });
  const { state } = authorization((await start(handler)).authorizeUrl);
  await callback(handler, `code=${CODE}&state=${state}`);
  const [connection] = JSON.parse((await handler(request("GET", "/api/social/connections"))).body).connections;
  assert.deepEqual(connection.notes.map((note) => note.code).sort(), ["instance-limit-low", "media-not-granted", "statuses-not-readable"]);

  const down = make({ handlers: { [INSTANCE_ROUTE]: { status: 503, body: {} } } });
  const begun = authorization((await start(down.handler)).authorizeUrl);
  await callback(down.handler, `code=${CODE}&state=${begun.state}`);
  const [unread] = JSON.parse((await down.handler(request("GET", "/api/social/connections"))).body).connections;
  assert.equal(unread.status, "authorized", "an instance that does not answer its configuration does not stop the connection");
  assert.deepEqual(unread.notes.map((note) => note.code), ["instance-unavailable"]);

  const suspended = make({ handlers: { [ME]: me({ suspended: true }) } });
  const third = authorization((await start(suspended.handler)).authorizeUrl);
  const page = await callback(suspended.handler, `code=${CODE}&state=${third.state}`);
  assert.equal(page.statusCode, 400);
  const [failed] = JSON.parse((await suspended.handler(request("GET", "/api/social/connections"))).body).connections;
  assert.equal(failed.errorCode, "no-destination");
  assert.equal(failed.destinations[0].reason, "account-suspended");
  assert.ok(atInstance(suspended.w).some((call) => call.path === "/oauth/revoke" && call.form.token === TOKEN), "the unused token is revoked");
});

test("a grant without posting is refused and its token revoked; a reply without an account id is unreadable", async () => {
  const narrow = make({ handlers: { [TOKEN_ROUTE]: { status: 200, body: { access_token: TOKEN, scope: "read:accounts" } } } });
  const { state } = authorization((await start(narrow.handler)).authorizeUrl);
  const page = await callback(narrow.handler, `code=${CODE}&state=${state}`);
  assert.equal(page.statusCode, 400);
  const revoke = atInstance(narrow.w).find((call) => call.path === "/oauth/revoke");
  assert.deepEqual(revoke.form, { client_id: "md-client-id", client_secret: SECRET, token: TOKEN });

  const odd = make({ handlers: { [ME]: { status: 200, body: { id: "../../admin", username: "ada" } } } });
  const second = authorization((await start(odd.handler)).authorizeUrl);
  assert.equal((await callback(odd.handler, `code=${CODE}&state=${second.state}`)).statusCode, 400);
  const [failed] = JSON.parse((await odd.handler(request("GET", "/api/social/connections"))).body).connections;
  assert.equal(failed.errorCode, "provider-error");
});

test("disconnect revokes the account's own token, even with another Mastodon account connected", async () => {
  const { w, handler } = make();
  const { state } = authorization((await start(handler)).authorizeUrl);
  await callback(handler, `code=${CODE}&state=${state}`);
  const [connection] = JSON.parse((await handler(request("GET", "/api/social/connections"))).body).connections;
  const { account } = JSON.parse((await handler(request("POST", `/api/social/connections/${connection.id}/select`, { body: { destination: ACCOUNT_ID } }))).body);
  w.db.tables.openblog_social_accounts.push({ id: crypto.randomUUID(), site_id: "lantern-studios", provider: "mastodon", kind: "account", external_id: "42", display_name: "@other", status: "connected" });
  const before = atInstance(w).filter((call) => call.path === "/oauth/revoke").length;
  const done = await handler(request("POST", `/api/social/accounts/${account.id}/disconnect`, { body: {} }));
  assert.equal(done.statusCode, 200);
  const revokes = atInstance(w).filter((call) => call.path === "/oauth/revoke");
  assert.equal(revokes.length, before + 1);
  assert.equal(revokes.at(-1).form.token, TOKEN);
});

test("canceling an authorized attempt revokes its token; a pending one has none to revoke", async () => {
  const { w, handler } = make();
  const pending = await start(handler);
  await handler(request("POST", `/api/social/connections/${pending.connection.id}/cancel`, { body: {} }));
  assert.equal(atInstance(w).filter((call) => call.path === "/oauth/revoke").length, 0);
  const { state } = authorization((await start(handler)).authorizeUrl);
  await callback(handler, `code=${CODE}&state=${state}`);
  const authorized = JSON.parse((await handler(request("GET", "/api/social/connections"))).body).connections.find((c) => c.status === "authorized");
  await handler(request("POST", `/api/social/connections/${authorized.id}/cancel`, { body: {} }));
  const revokes = atInstance(w).filter((call) => call.path === "/oauth/revoke");
  assert.equal(revokes.length, 1);
  assert.equal(revokes[0].form.token, TOKEN);
});

test("reconnect asks the instance to sign in again and finishes only for the same account", async () => {
  const id = crypto.randomUUID();
  const existing = () => ({ id, site_id: "lantern-studios", provider: "mastodon", kind: "account", external_id: ACCOUNT_ID, display_name: `@ada@${HOST}`, status: "needs-reauth" });
  const same = make({ accounts: [existing()] });
  const again = await start(same.handler, `/api/social/accounts/${id}/reconnect`, {});
  const { params, state } = authorization(again.authorizeUrl);
  assert.equal(params.get("force_login"), "true");
  assert.equal((await callback(same.handler, `code=${CODE}&state=${state}`)).statusCode, 200);
  assert.equal(same.w.db.tables.openblog_social_accounts[0].status, "connected");

  const other = make({ accounts: [existing()], handlers: { [ME]: me({ id: "555", username: "eve" }) } });
  const second = authorization((await start(other.handler, `/api/social/accounts/${id}/reconnect`, {})).authorizeUrl);
  assert.equal((await callback(other.handler, `code=${CODE}&state=${second.state}`)).statusCode, 400);
  assert.equal(other.w.db.tables.openblog_social_accounts[0].status, "needs-reauth", "a sign-in as someone else changes nothing");
  assert.ok(atInstance(other.w).some((call) => call.path === "/oauth/revoke"), "and the stranger's token is revoked");
});

test("a token that comes with a refresh token is refreshed with the client credentials; a refusal ends it", async () => {
  const settings = socialProviders(env(MASTODON)).mastodon;
  const calls = [];
  const refresh = refreshWith(settings, async (url, init) => {
    calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(init.body)) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 3600 }) };
  });
  assert.deepEqual(await refresh("old-refresh-token"), { accessToken: "new-access-token", refreshToken: "new-refresh-token", expiresIn: 3600, refreshExpiresIn: undefined });
  assert.equal(calls[0].url, `${INSTANCE}/oauth/token`);
  assert.deepEqual(calls[0].form, { grant_type: "refresh_token", refresh_token: "old-refresh-token", client_id: "md-client-id", client_secret: SECRET });
  const refused = refreshWith(settings, async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "invalid_grant" }) }));
  await assert.rejects(refused("x"), (error) => error instanceof ProviderTokenError && error.permanent === true);
});

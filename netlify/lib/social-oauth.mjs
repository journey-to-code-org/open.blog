// The OAuth authorization-code handshake of optional social publishing (epic #353, story #355,
// ADR 0299). Server-only, behind the site scope of ADR 0293.
//
// An author asks Admin to connect LinkedIn, Facebook or Mastodon (ADR 0359). `start` makes a connection row holding a
// hash of a single-use `state` (and, where the deployer turned it on, a PKCE verifier sealed like a
// credential) and returns the provider's authorization URL. The provider sends the browser back to
// the one exact callback registered for it. `callback` trusts nothing in that request except what
// the stored state proves: it claims the row with a version-checked write (so a replay or a second
// tab finds it spent), exchanges the code, verifies the scopes the author really granted, and keeps
// the tokens sealed until the author picks a destination. The callback needs no Admin key because
// the state is the proof, but it can only finish a connection an authorized Admin started.
//
// Errors are SocialOAuthError with fixed messages. A provider reply, code, state or token is never
// put in an error, a log line or anything returned to Admin.

import { SocialScopeError, scopedQuery } from "./social-scope.mjs";
import { SocialCredentialError, createCredentialStore } from "./social-credentials.mjs";
import { NOTES, REASONS, discover } from "./social-discovery.mjs";
import { SocialTokenError, openCredential, sealCredential } from "./social-tokens.mjs";
import { ProviderError, authorizationUrl, checkScopes, exchangeCode, openBlueskySession, ownsGrant, pkceChallenge, randomToken, revokeAtProvider, sha256Hex, validProvider } from "./social-providers.mjs";
import { blueskyIdentifier, validAppPassword } from "./social-atproto.mjs";

export const PENDING_TTL_MS = 10 * 60 * 1000;
export const AUTHORIZED_TTL_MS = 30 * 60 * 1000;
export const MAX_OPEN_CONNECTIONS = 10;
const CONNECTIONS = "openblog_social_connections";
const ACCOUNTS = "openblog_social_accounts";
const EXCHANGE_LEASE_MS = 2 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[\x21-\x7e]{1,2048}$/;

export class SocialOAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "SocialOAuthError";
    this.status = status;
    this.code = code;
  }
}

// What the callback page says for each way a handshake can end, and what a connection's `message`
// carries (Studio shows it only in details; it says each outcome in its own words). Fixed text only.
export const OUTCOMES = Object.freeze({
  authorized: "Go back to Studio to choose where your posts go.",
  denied: "You said no, so nothing was connected.",
  "invalid-state": "That sign-in link isn't valid or was already used. Start again in Studio.",
  expired: "That took too long, so it stopped. Start again in Studio.",
  "invalid-request": "The reply that came back wasn't valid. Start again in Studio.",
  "scopes-missing": "A permission Studio needs wasn't allowed. Start again in Studio and leave every box ticked.",
  "code-rejected": "The sign-in wasn't accepted. Start again in Studio.",
  "provider-error": "Something went wrong on the other side. Start again in Studio.",
  "provider-unavailable": "It couldn't be reached. Try again in Studio in a few minutes.",
  "identity-mismatch": "That's a different account from the one being reconnected. Sign in to the account you used the first time, then start again in Studio.",
  "no-destination": "Nothing Studio can post to was found for that account.",
  "storage-failed": "The connection couldn't be saved. Start again in Studio.",
  canceled: "This connection was stopped in Studio.",
  "credentials-rejected": "Bluesky didn't accept that name and app password. Check the name, or make a new app password in Bluesky.",
  "provider-rate-limited": "It asked Studio to slow down. Wait a few minutes, then try again.",
});

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const MAX_RETURN_TO_CHARS = 300;

/**
 * Where the callback may send the browser on to (G6): the Studio the author started from, exactly
 * `<origin>/admin/studio/`. `https`, or `http` to a loopback address; no credentials, query or
 * fragment; at most 300 characters; written the way URL writes it. Anything else is null.
 */
export function validReturnTo(value) {
  if (typeof value !== "string" || !value || value.length > MAX_RETURN_TO_CHARS) return null;
  if (/[\s?#@\\]/.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // An https host is a plain name or IPv4 address, as the store's check (social-return.sql) also says.
  const secure = (url.protocol === "https:" && /^[a-z0-9.-]+$/.test(url.hostname)) || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash || url.pathname !== "/admin/studio/") return null;
  return url.href === value ? value : null;
}

// The HTTP status an app-password sign-in failure is answered with: a refusal of what the author
// typed is theirs to fix (400), the rest is the provider's or ours.
const APP_PASSWORD_STATUS = Object.freeze({ "credentials-rejected": 400, "provider-rate-limited": 429, "identity-mismatch": 409, "no-destination": 409, "provider-unavailable": 503 });

const iso = (ms) => new Date(ms).toISOString();

export function createConnector({ settings, providers, fetchImpl = globalThis.fetch, now = () => Date.now(), random } = {}) {
  if (!settings || settings.enabled !== true || !settings.tokenKeys) throw new SocialScopeError(404, "not-enabled", "Social publishing is not enabled.");
  const keyring = settings.tokenKeys;
  const credentials = createCredentialStore({ settings, keyring, fetchImpl, now });

  const rest = async (method, table, query, body) => {
    let response;
    try {
      response = await fetchImpl(`${settings.url}/rest/v1/${table}?${query}`, {
        method,
        headers: { apikey: settings.key, authorization: `Bearer ${settings.key}`, "content-type": "application/json", prefer: "return=representation" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SocialOAuthError(503, "storage-unavailable", "The connection store could not be reached.");
    }
    if (response.status === 409) throw new SocialOAuthError(409, "conflict", "That record already exists or changed.");
    if (!response.ok) throw new SocialOAuthError(response.status >= 500 ? 503 : 500, "storage-failed", "The connection store refused the request.");
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  };

  const owned = (rows) => {
    for (const row of rows) if (row.site_id !== settings.siteId) throw new SocialScopeError(500, "other-site", "A record belongs to another site.");
    return rows;
  };

  const read = async (filters) => owned(await rest("GET", CONNECTIONS, scopedQuery(settings, { select: "*", ...filters }).toString()));

  // A write that applies only to the version (and, where given, the state) the caller read.
  const write = async (row, patch, extra = {}) => {
    const query = scopedQuery(settings, { id: `eq.${row.id}`, version: `eq.${row.version}`, ...extra }).toString();
    const rows = owned(await rest("PATCH", CONNECTIONS, query, { ...patch, version: row.version + 1, updated_at: iso(now()) }));
    return rows[0] || null;
  };

  const seal = async (row, secrets) => {
    const { keyId, envelope } = await sealCredential(keyring, { siteId: settings.siteId, accountId: row.id }, secrets);
    return { key_id: keyId, envelope };
  };
  const open = (row) => openCredential(keyring, { siteId: settings.siteId, accountId: row.id }, row.key_id, row.envelope);

  const finish = (row, status, code, extra = {}) =>
    write(row, { status, error_code: code, envelope: null, key_id: null, completed_at: iso(now()), ...extra }, { status: "in.(pending,exchanging,authorized)" });

  // Past-due open rows become expired and lose their sealed material. Version is not raised: a
  // concurrent claim still filters on its status and version, so it cannot win after this.
  // `exchanging` is a lease: each claim sets a short expires_at, so a claim that died part-way is
  // erased here instead of keeping its sealed tokens forever.
  const expireDue = () =>
    rest("PATCH", CONNECTIONS, scopedQuery(settings, { status: "in.(pending,exchanging,authorized)", expires_at: `lt.${iso(now())}` }).toString(), { status: "expired", error_code: "expired", envelope: null, key_id: null, completed_at: iso(now()), updated_at: iso(now()) });

  // Withdraw a grant after a failed handshake, but never while a live account of the provider could
  // share it (the same rule as disconnect). A failed attempt must not cut off working accounts.
  const withdraw = async (provider, tokens) => {
    // A Bluesky session or a Mastodon token is this attempt's own and is shared with nothing: always end it.
    if (ownsGrant(provider)) return revokeAtProvider(provider, tokens, fetchImpl);
    const live = owned(await rest("GET", ACCOUNTS, scopedQuery(settings, { provider: `eq.${provider.provider}`, status: "neq.disconnected", select: "id" }).toString()));
    if (live.length === 0) await revokeAtProvider(provider, tokens, fetchImpl);
  };

  const connectionOf = (row) => {
    const granted = row.granted_scopes ? row.granted_scopes.split(" ").filter(Boolean) : [];
    return Object.freeze({
      id: row.id,
      provider: row.provider,
      status: row.status,
      expiresAt: row.expires_at,
      requestedScopes: row.requested_scopes.split(" ").filter(Boolean),
      grantedScopes: granted,
      createdBy: row.created_by,
      createdAt: row.created_at,
      reauthAccountId: row.reauth_account_id || null,
      errorCode: row.error_code || null,
      message: row.error_code ? OUTCOMES[row.error_code] || null : null,
      destinations: Array.isArray(row.destinations) ? row.destinations : [],
      notes: (row.notes ? row.notes.split(" ").filter(Boolean) : []).map((code) => ({ code, text: NOTES[code] || "" })).filter((note) => note.text),
    });
  };

  const accountOf = (row) =>
    Object.freeze({
      id: row.id,
      provider: row.provider,
      kind: row.kind,
      externalId: row.external_id,
      displayName: row.display_name,
      status: row.status,
      connectedBy: row.connected_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      disconnectedAt: row.disconnected_at || null,
    });

  const providerOf = (name) => {
    const provider = validProvider(name) ? providers?.[name] : null;
    if (!provider) throw new SocialOAuthError(409, "provider-not-configured", "That provider is not set up on the server.");
    return provider;
  };

  const failureFor = (error) => {
    if (!(error instanceof ProviderError)) return "storage-failed";
    if (error.code === "code-rejected" || error.code === "credentials-rejected") return error.code;
    if (error.code === "rate-limited") return "provider-rate-limited";
    return error.retryable || error.code === "provider-unreachable" ? "provider-unavailable" : "provider-error";
  };

  const remaining = (stamp) => (stamp ? Math.max(1, Math.floor((Date.parse(stamp) - now()) / 1000)) : undefined);

  // The tokens that belong to one destination. LinkedIn shares the member's grant with the
  // organizations that member administers; each Facebook Page has a token of its own.
  const tokensFor = (provider, row, secrets, destination) => {
    if (provider === "facebook") {
      const token = secrets.pageTokens?.[destination.id];
      if (typeof token !== "string" || !token) throw new SocialOAuthError(409, "destination-not-eligible", "Facebook gave no access for this Page. Connect again.");
      return { accessToken: token };
    }
    return { accessToken: secrets.accessToken, refreshToken: secrets.refreshToken, expiresIn: remaining(row.access_expires_at), refreshExpiresIn: remaining(row.refresh_expires_at) };
  };

  // Reconnect: the same provider identity signs in again. A different one is refused and nothing
  // changes, so a sign-in as the wrong person can never swap an account's credentials.
  const reconnect = async ({ connection, provider, tokens, secrets, record, granted, expiry }) => {
    const [account] = owned(await rest("GET", ACCOUNTS, scopedQuery(settings, { id: `eq.${connection.reauth_account_id}`, select: "*" }).toString()));
    const destination = account && record.destinations.find((candidate) => candidate.id === account.external_id);
    const fail = async (code, { revoke = true } = {}) => {
      if (revoke) await withdraw(provider, tokens).catch(() => {});
      await finish(connection, "failed", code, { granted_scopes: granted, ...record });
      return { ok: false, code };
    };
    if (!account || account.provider !== provider.provider || account.status === "disconnected" || !destination) return fail("identity-mismatch");
    if (!destination.eligible) return fail("no-destination");
    try {
      await credentials.save(account.id, tokensFor(provider.provider, { ...connection, ...expiry }, secrets, destination), { scope: granted });
    } catch {
      return fail("storage-failed");
    }
    // The new tokens are stored now: from here nothing is revoked, whatever else fails.
    const patch = () => rest("PATCH", ACCOUNTS, scopedQuery(settings, { id: `eq.${account.id}`, status: "in.(connected,needs-reauth)" }).toString(), { status: "connected", display_name: destination.name, updated_at: iso(now()) });
    try {
      await patch().catch(patch);
    } catch {
      return fail("storage-failed", { revoke: false });
    }
    await finish(connection, "completed", null, { granted_scopes: granted, ...record });
    return { ok: true };
  };

  // After a verified exchange: ask the provider where the grant can post, keep the tokens sealed
  // until the author chooses, or, when reconnecting, finish at once for the same identity only.
  const authorize = async ({ connection, provider, tokens }) => {
    const granted = tokens.granted.join(" ").slice(0, 1000);
    const stop = async (code, extra = {}) => {
      // Nothing usable was kept, so withdraw the grant where the provider allows it (and no live account shares it).
      await withdraw(provider, tokens).catch(() => {});
      await finish(connection, "failed", code, { granted_scopes: granted, ...extra });
      return { ok: false, code };
    };
    let found;
    try {
      found = await discover(provider, tokens, fetchImpl);
    } catch (error) {
      return stop(failureFor(error));
    }
    const record = { destinations: found.destinations, notes: found.notes.join(" ") };
    if (!found.destinations.some((destination) => destination.eligible)) return stop("no-destination", record);
    const secrets = { accessToken: tokens.accessToken };
    if (tokens.refreshToken) secrets.refreshToken = tokens.refreshToken;
    if (provider.provider === "facebook") secrets.pageTokens = found.secrets;
    const expiry = {
      access_expires_at: Number.isFinite(tokens.expiresIn) ? iso(now() + tokens.expiresIn * 1000) : null,
      refresh_expires_at: Number.isFinite(tokens.refreshExpiresIn) ? iso(now() + tokens.refreshExpiresIn * 1000) : null,
    };
    if (connection.reauth_account_id) return reconnect({ connection, provider, tokens, secrets, record, granted, expiry });
    const row = await write(connection, { status: "authorized", granted_scopes: granted, expires_at: iso(now() + AUTHORIZED_TTL_MS), error_code: null, ...record, ...expiry, ...(await seal(connection, secrets)) }, { status: "eq.exchanging" });
    return row ? { ok: true } : { ok: false, code: "storage-failed" };
  };

  const self = {
    connectionOf,
    providerOf,
    rest,
    read,
    write,
    seal,
    open,
    finish,
    expireDue,
    now,
    credentials,
    accountOf,

    // Signs in to an app-password provider (Bluesky, ADR 0357) and leaves the connection waiting
    // for the author's choice, as an OAuth callback would; when reconnecting, it finishes at once
    // for the same account only. The password is used for this one call and kept nowhere. A
    // failure throws a SocialOAuthError with the fixed outcome text, and the attempt is recorded.
    async appPassword({ provider: name, identifier, password, actor, reauthAccountId = null }) {
      const provider = providerOf(name);
      if (provider.login !== "app-password") throw new SocialOAuthError(400, "invalid-request", "That provider is connected through its own sign-in page.");
      if (reauthAccountId !== null && !UUID.test(String(reauthAccountId))) throw new SocialOAuthError(400, "invalid-account", "That is not an account id.");
      if (!blueskyIdentifier(identifier)) throw new SocialOAuthError(400, "invalid-identifier", "Enter your Bluesky handle, such as name.bsky.social.");
      if (!validAppPassword(password)) throw new SocialOAuthError(400, "invalid-app-password", "Enter an app password (four groups of four letters or digits, made in Bluesky's settings), never your account password.");
      await expireDue();
      const openRows = await read({ status: "in.(pending,exchanging)", expires_at: `gt.${iso(now())}`, select: "id" });
      if (openRows.length >= MAX_OPEN_CONNECTIONS) throw new SocialOAuthError(429, "too-many-attempts", "Too many connection attempts are open. Finish or cancel one, or wait ten minutes.");
      const [row] = owned(
        await rest("POST", CONNECTIONS, "", {
          id: crypto.randomUUID(),
          site_id: settings.siteId,
          provider: provider.provider,
          status: "exchanging",
          // No redirect happens; the state is random and never leaves this function.
          state_hash: await sha256Hex(randomToken(random)),
          redirect_uri: provider.apiBase,
          requested_scopes: "",
          pkce: false,
          reauth_account_id: reauthAccountId,
          created_by: actor,
          expires_at: iso(now() + EXCHANGE_LEASE_MS),
        }),
      );
      const refuse = (code) => new SocialOAuthError(APP_PASSWORD_STATUS[code] || 500, code, OUTCOMES[code] || OUTCOMES["storage-failed"]);
      let tokens;
      try {
        tokens = await openBlueskySession(provider, { identifier, password }, fetchImpl, now);
      } catch (error) {
        const code = failureFor(error);
        await finish(row, "failed", code).catch(() => {});
        throw refuse(code);
      }
      const next = await authorize({ connection: row, provider, tokens });
      if (!next.ok) throw refuse(next.code);
      const [done] = await read({ id: `eq.${row.id}` });
      return { connection: connectionOf(done || row) };
    },

    // Whether the store has social-return.sql (schema version 5, the return_to column), so a start
    // may keep a return address (G6). Anything that stops it being read answers no: then Admin names
    // none and Studio offers its new-tab way, which works on any store.
    async returns() {
      try {
        const rows = await rest("GET", "openblog_social_schema", "select=version&version=eq.5");
        return rows.some((row) => Number(row.version) === 5);
      } catch {
        return false;
      }
    },

    // Begins a handshake. Returns what Admin may show and the URL to send the author's browser to.
    async start({ provider: name, actor, reauthAccountId = null, returnTo = undefined }) {
      const provider = providerOf(name);
      // Where the callback sends the browser on to (G6). Only Admin names it, built from the request it
      // checked; it is stored on the row the single-use state finds, never read from the callback.
      if (returnTo !== undefined && !validReturnTo(returnTo)) throw new SocialOAuthError(400, "invalid-return-to", "The return address must be https (or http to this computer) and end in /admin/studio/.");
      if (provider.login === "app-password") throw new SocialOAuthError(400, "app-password-required", "Bluesky is connected with your handle and an app password.");
      if (reauthAccountId !== null && !UUID.test(String(reauthAccountId))) throw new SocialOAuthError(400, "invalid-account", "That is not an account id.");
      await expireDue();
      const openRows = await read({ status: "in.(pending,exchanging)", expires_at: `gt.${iso(now())}`, select: "id" });
      if (openRows.length >= MAX_OPEN_CONNECTIONS) throw new SocialOAuthError(429, "too-many-attempts", "Too many connection attempts are open. Finish or cancel one, or wait ten minutes.");
      const state = randomToken(random);
      const id = crypto.randomUUID();
      const verifier = provider.pkce ? randomToken(random) : null;
      const sealedVerifier = verifier ? await seal({ id }, { verifier }) : { key_id: null, envelope: null };
      const row = {
        id,
        site_id: settings.siteId,
        provider: provider.provider,
        status: "pending",
        state_hash: await sha256Hex(state),
        redirect_uri: provider.redirectUri,
        requested_scopes: provider.scopes.join(" "),
        pkce: provider.pkce,
        reauth_account_id: reauthAccountId,
        created_by: actor,
        expires_at: iso(now() + PENDING_TTL_MS),
        ...sealedVerifier,
        // Written only when there is one, so a store from before social-return.sql still takes the row.
        ...(returnTo ? { return_to: returnTo } : {}),
      };
      const [created] = owned(await rest("POST", CONNECTIONS, "", row));
      return {
        connection: connectionOf(created),
        authorizeUrl: authorizationUrl(provider, { state, challenge: verifier ? await pkceChallenge(verifier) : null, reauthorize: reauthAccountId !== null }),
      };
    },

    // Finishes a handshake from the provider's redirect. It never throws for what a stranger can
    // send: every refusal is { ok: false, code } with a code from OUTCOMES, and the caller shows
    // the fixed text. `params` is the callback's URLSearchParams.
    async callback({ provider: name, params }) {
      const refused = (code) => ({ ok: false, code, text: OUTCOMES[code] });
      const provider = validProvider(name) ? providers?.[name] : null;
      if (!provider) return refused("invalid-request");
      // One value for each name we read. A repeated `state` or `code` is an attack or a bug, not a choice.
      for (const key of ["state", "code", "error"]) if (params.getAll(key).length > 1) return refused("invalid-request");
      const state = params.get("state") || "";
      if (!STATE.test(state)) return refused("invalid-state");
      let row;
      try {
        [row] = await read({ state_hash: `eq.${await sha256Hex(state)}` });
      } catch {
        return refused("storage-failed");
      }
      // Wrong provider or unknown: a fixed page, never a redirect.
      if (!row || row.provider !== provider.provider) return refused("invalid-state");
      // From here a row was found by its single-use state: every outcome may send the browser back to
      // the Studio that started it, with the connection's id, and to nowhere else (G6).
      const back = { connectionId: row.id, returnTo: validReturnTo(row.return_to) };
      const result = await self.finishCallback(row, provider, params);
      return { ...result, ...back };
    },

    async finishCallback(row, provider, params) {
      const refused = (code) => ({ ok: false, code, text: OUTCOMES[code] });
      // Already used, canceled or ended: the same refusal as an unknown state.
      if (row.status !== "pending") return refused("invalid-state");
      try {
        if (Date.parse(row.expires_at) <= now()) {
          await finish(row, "expired", "expired");
          return refused("expired");
        }
        // The claim: only one callback can move this row from pending to exchanging.
        const claimed = await write(row, { status: "exchanging", expires_at: iso(now() + EXCHANGE_LEASE_MS) }, { status: "eq.pending" });
        if (!claimed) return refused("invalid-state");
        const error = params.get("error");
        if (error) {
          const denied = ["access_denied", "user_cancelled_login", "user_cancelled_authorize"].includes(error);
          await finish(claimed, "failed", denied ? "denied" : "provider-error");
          return refused(denied ? "denied" : "provider-error");
        }
        const code = params.get("code") || "";
        if (!CODE.test(code)) {
          await finish(claimed, "failed", "invalid-request");
          return refused("invalid-request");
        }
        let verifier;
        if (claimed.pkce) {
          try {
            verifier = (await open(claimed)).verifier;
          } catch {
            await finish(claimed, "failed", "storage-failed");
            return refused("storage-failed");
          }
        }
        let tokens;
        try {
          tokens = await exchangeCode(provider, { code, verifier }, fetchImpl);
        } catch (failure) {
          const reason = failureFor(failure);
          await finish(claimed, "failed", reason);
          return refused(reason);
        }
        // The scopes the author actually granted, not the ones we asked for.
        const verdict = checkScopes(provider, tokens.granted);
        if (verdict.missingRequired.length) {
          await withdraw(provider, tokens).catch(() => {});
          await finish(claimed, "failed", "scopes-missing", { granted_scopes: tokens.granted.join(" ").slice(0, 1000) });
          return refused("scopes-missing");
        }
        const next = await authorize({ connection: claimed, provider, tokens });
        return next.ok ? { ok: true, code: "authorized", text: OUTCOMES.authorized } : refused(next.code);
      } catch {
        // Storage failed part-way. The row stays `exchanging` until its short lease runs out and expireDue erases it; it cannot be reused.
        return refused("storage-failed");
      }
    },

    // The author chose a destination from an authorized connection: create the account and store its
    // credential, once. A failure puts the connection back so the author can try again.
    async select({ id, destination: destinationId, actor }) {
      if (!UUID.test(String(id))) throw new SocialOAuthError(400, "invalid-connection", "That is not a connection id.");
      if (typeof destinationId !== "string" || !destinationId || destinationId.length > 200) throw new SocialOAuthError(400, "invalid-destination", "Choose a destination from the list.");
      const [row] = await read({ id: `eq.${id}` });
      if (!row) throw new SocialOAuthError(404, "not-found", "No such connection.");
      if (row.status !== "authorized" || row.reauth_account_id) throw new SocialOAuthError(409, "not-authorized", "This connection is not waiting for a choice.");
      if (Date.parse(row.expires_at) <= now()) {
        await finish(row, "expired", "expired");
        throw new SocialOAuthError(409, "expired", OUTCOMES.expired);
      }
      const destination = (Array.isArray(row.destinations) ? row.destinations : []).find((candidate) => candidate.id === destinationId);
      if (!destination) throw new SocialOAuthError(400, "unknown-destination", "That destination is not in the list for this connection.");
      if (!destination.eligible) throw new SocialOAuthError(409, "destination-not-eligible", REASONS[destination.reason] || "That destination cannot be used.");
      const provider = providerOf(row.provider);
      const claimed = await write(row, { status: "exchanging", expires_at: iso(now() + EXCHANGE_LEASE_MS) }, { status: "eq.authorized" });
      if (!claimed) throw new SocialOAuthError(409, "conflict", "The connection changed; try again.");
      let account = null;
      try {
        const secrets = await open(claimed);
        const tokens = tokensFor(provider.provider, claimed, secrets, destination);
        [account] = owned(await rest("POST", ACCOUNTS, "", { site_id: settings.siteId, provider: provider.provider, kind: destination.kind, external_id: destination.id, display_name: destination.name, status: "connected", connected_by: actor }));
        await credentials.save(account.id, tokens, { scope: claimed.granted_scopes || "" });
      } catch (error) {
        if (account) {
          await rest("PATCH", ACCOUNTS, scopedQuery(settings, { id: `eq.${account.id}` }).toString(), { status: "disconnected", disconnected_at: iso(now()), updated_at: iso(now()) }).catch(() => {});
        }
        // Back to authorized, still sealed, so the author can choose again without signing in again.
        const restored = await write(claimed, { status: "authorized", expires_at: row.expires_at }, { status: "eq.exchanging" }).catch(() => null);
        // If it could not be restored, erase the sealed tokens now rather than leave them to the lease.
        if (!restored) await finish(claimed, "failed", "storage-failed").catch(() => {});
        if (error instanceof SocialOAuthError && error.code === "conflict") throw new SocialOAuthError(409, "already-connected", "That account is already connected. Use Reconnect on it instead.");
        if (error instanceof SocialOAuthError || error instanceof SocialCredentialError) throw error;
        throw new SocialOAuthError(500, "storage-failed", "The account could not be saved. Try again.");
      }
      // The account and credential are saved. If this erase fails the short lease erases the tokens.
      await finish(claimed, "completed", null).catch(() => {});
      return { account: accountOf(account), credential: await credentials.describe(account.id) };
    },

    // Cancels an open connection and erases whatever it sealed.
    async cancel(id) {
      if (!UUID.test(String(id))) throw new SocialOAuthError(400, "invalid-connection", "That is not a connection id.");
      const [row] = await read({ id: `eq.${id}` });
      if (!row) throw new SocialOAuthError(404, "not-found", "No such connection.");
      if (!["pending", "authorized", "exchanging"].includes(row.status)) return connectionOf(row);
      // An app-password attempt holds a live session of its own, and an authorized Mastodon attempt a
      // token of its own: end it at the provider first (best effort). A pending OAuth row holds only
      // a PKCE verifier, which revoking would not use.
      const provider = validProvider(row.provider) ? providers?.[row.provider] : null;
      if (ownsGrant(provider) && row.envelope && !row.reauth_account_id && (provider.login === "app-password" || row.status === "authorized")) {
        try {
          await revokeAtProvider(provider, await open(row), fetchImpl);
        } catch {
          // The tokens are erased below either way; the session lapses at the provider.
        }
      }
      const done = await finish(row, "canceled", "canceled");
      if (!done) throw new SocialOAuthError(409, "conflict", "The connection changed; try again.");
      return connectionOf(done);
    },

    async list() {
      await expireDue();
      const rows = await read({ order: "created_at.desc", limit: "20" });
      return rows.map(connectionOf);
    },
  };
  return self;
}

export { SocialTokenError };
